/**
 * StructBOQ - whole drawing pipeline inside the browser (no server, no API, no local tools).
 *   pdf.js        : text, vector paths, page rendering
 *   PaddleOCR     : OCR of scans (onnxruntime-web WASM, models bundled with the app)
 *   tesseract.js  : OCR of vector lettering and Thai (WASM; language data fetched once from CDN)
 *   rule reader   : grid from dimension chains, tags -> members, details -> sections
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ExtractedMember, MaterialSpecs } from '../engine/qsEngine';
import { DEFAULT_MATERIAL_SPECS } from '../engine/qsEngine';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS, type CompletenessFinding, type SheetReading } from '../engine/sheetMerge';
import type { BoqTotals } from '../engine/boqCompare';
import { toPageText, pageTextToOcr } from './pdfText';
import { parseBoqPages, boqTotalsByVariant } from './boqParser';
import { scheduleMembersFromPage } from './scheduleParser';
import { ocrPdfPage, sheetId, type PdfJsPage } from './pdfOcrPipeline';
import { readSheets } from './sheetReader';
import { ocrBoqPage } from './boqOcr';
import { prepareScan, estimateSkew, rotateRaster, removeLines, extractLines, findRings, ringsAtLineEnds } from './scanPrep';
import { extractSmallStrokes, pageGeometry } from './vectorText';
import { imageBoxesOnPage } from './imageBoxes';
import type { OcrWord, PageOcr, PageText } from './types';
import type { Raster } from './ocr';
import { extractStructuralNotesFromWords, applyGeneralNotesToSpecs, type ExtractedGeneralNotes } from './structuralNotesParser';
import detUrl from '../../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx?url';
import recUrl from '../../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx?url';
import dictUrl from '../../node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
}

const pageCache = new Map<string, string>();

/** Clears all rendered page blob URLs to free browser memory. */
export function clearPageCache() {
  for (const url of pageCache.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  pageCache.clear();
}

/** Rendered page as an object URL (for the evidence viewer). */
export async function renderPageUrl(doc: PdfDoc, pageNo: number, dpi = 110, key = ''): Promise<string> {
  const k = `${key}:${pageNo}:${dpi}`;
  const hit = pageCache.get(k);
  if (hit) return hit;
  // Limit cache size to prevent memory leaks across sessions
  if (pageCache.size > 20) {
    const first = pageCache.keys().next().value;
    if (first) {
      try { URL.revokeObjectURL(pageCache.get(first)!); } catch {}
      pageCache.delete(first);
    }
  }
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/png'));
  const url = URL.createObjectURL(blob);
  pageCache.set(k, url);
  return url;
}

function grayToCanvas(data: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function renderForOcr(page: any, scale: number, rotate90: boolean, prepared = true) {
  const vp1 = page.getViewport({ scale: 1 });
  const maxDim = Math.max(vp1.width, vp1.height);
  // Cap max canvas dimension at 2400 px for crisp OCR on engineering drawings
  const targetMax = 2400;
  const effectiveScale = maxDim > targetMax ? (targetMax / maxDim) : Math.min(scale, Math.max(1.8, targetMax / maxDim));
  const vp = page.getViewport({ scale: effectiveScale, rotation: ((page.rotate || 0) + (rotate90 ? 90 : 0)) % 360 });
  const w = Math.ceil(vp.width);
  const h = Math.ceil(vp.height);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  if (!prepared) return { image: c, width: w, height: h, skew: 0 };
  const px = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
  // Free intermediate render canvas immediately to prevent Chrome memory accumulation
  c.width = 0; c.height = 0;
  let prep = prepareScan(gray, w, h, 1);
  const skew = estimateSkew(prep);
  if (Math.abs(skew) >= 0.1) prep = rotateRaster(prep, -skew);
  const physicalMm = (Math.max(vp1.width, vp1.height) / 72) * 25.4;
  const pxPerMm = Math.max(w, h) / Math.max(1, physicalMm);
  const lines = rotate90 ? undefined : extractLines(prep, Math.round(pxPerMm * 3));
  const endRings = lines ? ringsAtLineEnds(prep, lines, pxPerMm) : [];
  prep = removeLines(prep, Math.round(pxPerMm * 5));
  const blobs = rotate90 ? [] : findRings(prep, Math.round(pxPerMm * 4), Math.round(pxPerMm * 16));
  const circles = rotate90 ? undefined : [...blobs, ...endRings.filter(e => !blobs.some(b => Math.hypot(b[0] - e[0], ((b[1] - e[1]) * prep.height) / prep.width) < b[2] / 2))];
  return { image: grayToCanvas(prep.data, prep.width, prep.height), raster: prep, width: prep.width, height: prep.height, skew: Math.abs(skew) >= 0.1 ? skew : 0, lines, circles };
}

export interface SheetClassification {
  sheetId?: string;
  isStructural: boolean;
  skip: boolean;
  reason?: string;
}

/** Quickly classify sheet from the bottom-right title block in ~50ms. */
export async function fastClassifySheet(page: any, worker: any, pageNo: number, pageCount: number, pageText?: PageText): Promise<SheetClassification> {
  // Page 1 of a multi-sheet drawing set is always the cover sheet (แบบปก / สารบัญ)
  if (pageNo === 1 && pageCount > 2) {
    return { sheetId: 'COVER', isStructural: false, skip: true, reason: 'ข้ามใบปกระเบียบแบบ' };
  }

  // Instant 0ms digital text check if text layer exists
  if (pageText && pageText.items.length >= 3) {
    const raw = pageText.items.map(it => it.str).join(' ');
    const norm = raw.toUpperCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ');
    if (/สารบัญแบบ|สารบัญ|TABLE OF CONTENTS|DRAWING LIST|SHEET INDEX/i.test(raw)) {
      return { sheetId: 'INDEX', isStructural: false, skip: true, reason: 'ข้ามสารบัญแบบ' };
    }
    const mNon = norm.match(/(?:^|[^A-Z0-9])(A|AR|ARCH|EE|E|SN|SAN|M|ME|AC|ID|L)[-_ ]*0?(\d{1,2})(?:[^0-9]|$)/i);
    const mStr = norm.match(/(?:^|[^A-Z0-9])(S|ST|STR)[-_ ]*0?(\d{1,2})(?:[^0-9]|$)/i);
    if (mNon && !mStr) {
      const id = `${mNon[1].toUpperCase()}-${mNon[2].padStart(2, '0')}`;
      return { sheetId: id, isStructural: false, skip: true, reason: `ข้ามแผ่นไม่ใช่โครงสร้าง (${id})` };
    }
    if (mStr) {
      const id = `${mStr[1].toUpperCase()}-${mStr[2].padStart(2, '0')}`;
      return { sheetId: id, isStructural: true, skip: false };
    }
    if (/สถาปัตยกรรม|ผังบริเวณ|สุขาภิบาล|ไฟฟ้า/i.test(raw) && !/ฐานราก|คาน|เสา|โครงสร้าง/i.test(raw)) {
      return { isStructural: false, skip: true, reason: 'ข้ามแบบสถาปัตย์ / งานระบบ' };
    }
  }

  const c = document.createElement('canvas');
  try {
    const vp1 = page.getViewport({ scale: 1 });
    // Scale down large pages so crop is max ~260x140 for fast ~60ms OCR
    const scale = Math.min(1.0, 1000 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale });
    const cropW = Math.min(260, Math.ceil(vp.width * 0.24));
    const cropH = Math.min(140, Math.ceil(vp.height * 0.15));
    if (cropW < 50 || cropH < 30) return { isStructural: true, skip: false };

    c.width = cropW;
    c.height = cropH;
    const ctx = c.getContext('2d');
    if (!ctx) return { isStructural: true, skip: false };
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cropW, cropH);

    await page.render({
      canvasContext: ctx,
      viewport: vp,
      transform: [1, 0, 0, 1, -(vp.width - cropW), -(vp.height - cropH)],
    }).promise;

    const res = await worker.recognize(c);
    const rawText = res?.data?.text || '';
    const norm = rawText.toUpperCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ');

    if (/สารบัญแบบ|สารบัญ|DRAWING\s*LIST|SHEET\s*INDEX/i.test(rawText) || (/รายการประกอบแบบ/i.test(rawText) && !/โครงสร้าง|STRUCTUR|วิศวกรรม/i.test(rawText))) {
      return { sheetId: 'COVER', isStructural: false, skip: true, reason: 'ข้ามสารบัญ / รายการประกอบแบบทั่วไป' };
    }

    // Match discipline prefixes even when OCR attaches symbols or prefixes (e.g. S-01, S01, S--04, A-01, A--02)
    const mNon = norm.match(/(?:^|[^A-Z0-9])(A|AR|ARCH|EE|E|SN|SAN|M|ME|AC|ID|L)[-_ =—–]*0?(\d{1,2})(?:[^0-9]|$)/i);
    const mStr = norm.match(/(?:^|[^A-Z0-9])(S|ST|STR|5)[-_ =—–]*0?(\d{1,2})(?:[^0-9]|$)/i);

    // If both architectural and structural prefixes appear in the same small box, it is a drawing index table
    if (mNon && mStr) {
      return { sheetId: 'INDEX', isStructural: false, skip: true, reason: 'ข้ามสารบัญแบบ (พบทั้ง A และ S)' };
    }

    // Definite non-structural discipline ID
    if (mNon && !mStr) {
      const id = `${mNon[1].toUpperCase()}-${mNon[2].padStart(2, '0')}`;
      return { sheetId: id, isStructural: false, skip: true, reason: `ข้ามแผ่นไม่ใช่โครงสร้าง (${id})` };
    }
    // Definite structural discipline ID
    if (mStr) {
      const id = `${mStr[1].toUpperCase()}-${mStr[2].padStart(2, '0')}`;
      return { sheetId: id, isStructural: true, skip: false };
    }

    // Title keywords
    if (/ARCHITECT|SANITAR|ELECTRI|PLUMBING|INTERIOR/i.test(norm)) {
      return { isStructural: false, skip: true, reason: 'ข้ามแบบสถาปัตย์ / งานระบบ' };
    }
    if (/STRUCTUR|FOUNDATION|BEAM SCHEDULE|COLUMN SCHEDULE/i.test(norm)) {
      return { sheetId: 'S', isStructural: true, skip: false };
    }

    // Thai non-structural keywords (only concepts that NEVER appear in structural drawings)
    const isNonStruct = /สถาปัตยกรรม|ผั?งบริเ?วณ|ส[าภ]?รบ[ััน]?ญ|ร[าภ]ยก[าภ]รปร?ะกอบ|เฟอร?นิเจอร?|ขย[าภ]ยห[้้อ]?งน[้ำ้ๆำ]|ขย[าภ]ยป?ร?ะต[ูตู]|ขย[าภ]ยห?น[้้า]?ต[่่า]ง|ร[ูตู]ปด[้้า]น\s*[1-4A-Dก-ง]|ผั?งฝ[้้า]|ส[ุข]?ข[าภ]ภิบ[าภ]ล|บำบัดน้ำ|ไฟฟ[้้า]|แ[สล]งสว[่่า]ง|เต[้้า]ร[ััน]บ|SINGLE\s*LINE/i.test(rawText);
    const isStruct = /ฐ[าภ]นร[าภ]ก|ค[าภ]น|เส[าภ]|โครงสร[้้า]ง|โคร?ง?ห?ลั?งค[าภ]|S\s*[-_ ]*0?\d|5\s*[-_ ]*0?\d|ตาราง.*เสา|แบบขยาย/i.test(rawText);

    if (isNonStruct && !isStruct) {
      return { isStructural: false, skip: true, reason: 'ข้ามแบบสถาปัตย์ / งานระบบ' };
    }
    if (isStruct) {
      return { sheetId: 'S', isStructural: true, skip: false };
    }
  } catch {
    // Graceful fallback
  } finally {
    // Immediate canvas memory disposal
    c.width = 0;
    c.height = 0;
  }
  return { isStructural: true, skip: false };
}

/** Pixels of an image pdf.js handed over as an ImageBitmap (RGBA, transparent = paper). */
function bitmapPixels(img: any) {
  const bm = img?.bitmap;
  if (!bm?.width) return null;
  const c = document.createElement('canvas');
  c.width = bm.width; c.height = bm.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bm, 0, 0);
  return { width: bm.width, height: bm.height, kind: 3, data: ctx.getImageData(0, 0, bm.width, bm.height).data };
}

/** Drawn geometry of a sheet with a text layer (same as the offline cache: scripts/add_rects.ts). */
async function textSheetGeometry(page: any) {
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const s = extractSmallStrokes(ops.fnArray, ops.argsArray, pdfjs.OPS as any, vp.transform);
  const g = pageGeometry(s, vp.width, vp.height);
  if (s.imageCount) g.rects.push(...await imageBoxesOnPage(page, pdfjs.OPS as any, bitmapPixels, ops));
  return g;
}

let thaiWorkerPromise: Promise<any> | null = null;
/** Thai+English OCR for ปร.4 pages whose text is drawn as outlines (language data ~0.9 MB, loaded once). */
async function thaiWorker() {
  if (!thaiWorkerPromise) {
    thaiWorkerPromise = (async () => {
      const T = await import('tesseract.js');
      const w = await T.createWorker('tha+eng');
      await w.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' as any });
      return w;
    })();
  }
  return thaiWorkerPromise;
}

/** OCR the given pages as ปร.4 sheets (pages without a text layer). */
export async function ocrBoqInBrowser(doc: PdfDoc, pages: number[], onProgress: (msg: string, frac: number) => void): Promise<PageText[]> {
  const worker = await thaiWorker();
  const out: PageText[] = [];
  let i = 0;
  for (const p of pages) {
    onProgress(`อ่าน BOQ ภาษาไทยด้วย OCR หน้า ${p} (${++i}/${pages.length})`, i / pages.length);
    const r = await ocrBoqPage(await doc.getPage(p) as any, p, { worker, OPS: pdfjs.OPS as any, toImage: (d, w, h) => grayToCanvas(d, w, h) });
    if (r) out.push(r);
  }
  return out;
}

let drawingThaiPromise: Promise<any> | null = null;
/** second engine on drawing lettering: Thai+Latin labels ("5+5ø12มม.", "ป-RB6มม.@0.20") */
async function drawingThaiWorker() {
  if (!drawingThaiPromise) {
    drawingThaiPromise = (async () => {
      const T = await import('tesseract.js');
      const w = await T.createWorker('tha+eng');
      await w.setParameters({ tessedit_pageseg_mode: '11' as any });
      return w;
    })();
  }
  return drawingThaiPromise;
}

let turnedPromise: Promise<any[]> | null = null;
/** second pair set up like ocrWorker + drawingThaiWorker: reads a vector page's turned raster while they read the flat one */
async function turnedWorkers() {
  if (!turnedPromise) {
    turnedPromise = (async () => {
      const T = await import('tesseract.js');
      return Promise.all([['eng', '6'], ['tha+eng', '11']].map(async ([lang, psm]) => {
        const w = await T.createWorker(lang);
        await w.setParameters({ tessedit_pageseg_mode: psm as any });
        return w;
      }));
    })();
  }
  return turnedPromise;
}

const paddles: (Worker | null)[] = [];
let paddleCalls = 0;
/** timing only: receives each worker's PaddleStats (+ initMs, loads, totalMs) for the page being read */
let paddleStatsSink: ((worker: number, stats: any) => void) | null = null;
/** One band of a scan read by PaddleOCR worker k (paddleWorker.ts). */
function readBand(k: number, raster: Raster): Promise<OcrWord[]> {
  const w = (paddles[k] ??= new Worker(new URL('./paddleWorker.ts', import.meta.url), { type: 'module' }));
  const id = ++paddleCalls;
  return new Promise((resolve, reject) => {
    const done = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', done);
      if (e.data.stats) paddleStatsSink?.(k, e.data.stats);
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.words);
    };
    w.addEventListener('message', done);
    w.addEventListener('error', e => { paddles[k] = null; reject(new Error(e.message || 'PaddleOCR worker failed')); }, { once: true });
    w.postMessage({ id, raster, urls: { det: detUrl, rec: recUrl, dict: dictUrl } });
  });
}

/**
 * Scan read in horizontal bands, one single-thread worker each (the WASM runtime cannot use threads
 * inside a worker); bands overlap by 400 px and a word is kept by the band whose core holds its centre.
 * A failed worker makes the page fall back to tesseract.
 */
export async function readScan(r: Raster): Promise<OcrWord[]> {
  // Cap workers at 2 to keep Chrome memory ceiling < 250MB while maintaining high throughput
  const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)), step = Math.ceil(r.height / n), over = 200;
  const bands = Array.from({ length: n }, (_, k) => ({ c0: k * step, c1: Math.min(r.height, (k + 1) * step), y0: Math.max(0, k * step - over), y1: Math.min(r.height, (k + 1) * step + over) }));
  const read = await Promise.all(bands.map((b, k) => readBand(k, { data: r.data.slice(b.y0 * r.width, b.y1 * r.width), width: r.width, height: b.y1 - b.y0 })));
  return read.flatMap((ws, k) => {
    const b = bands[k], h = b.y1 - b.y0;
    return ws.map(w => ({ ...w, y0: (b.y0 + w.y0 * h) / r.height, y1: (b.y0 + w.y1 * h) / r.height }))
      .filter(w => ((w.y0 + w.y1) / 2) * r.height >= b.c0 && ((w.y0 + w.y1) / 2) * r.height < b.c1);
  });
}

let workerPromise: Promise<any> | null = null;
export async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await import('tesseract.js');
      const w = await T.createWorker('eng');
      await w.setParameters({ tessedit_pageseg_mode: '6' as any });
      return w;
    })();
  }
  return workerPromise;
}

export interface BrowserExtraction {
  fileName: string;
  pageCount: number;
  members: ExtractedMember[];
  completeness: CompletenessFinding[];
  mergeNotes: string[];
  warnings: string[];
  boq: { fileName: string; variants: string[]; structuralByVariant: Record<string, BoqTotals>; warnings: string[]; lineCount: number } | null;
  ocrPages: PageOcr[];
  sheetIds: Record<number, string>;
  materialText: string;
  /** what the reader found on each sheet (for reviewing the reading step) */
  readings: SheetReading[];
  skipped: { tag: string; page: number; reason: string }[];
  extractedNotes?: ExtractedGeneralNotes;
  materialSpecs?: MaterialSpecs;
}

export function parsePageSpec(spec: string | undefined, max: number): number[] | undefined {
  if (!spec?.trim()) return undefined;
  const out = spec.split(',').flatMap(part => {
    const [a, b] = part.trim().split('-').map(Number);
    if (!a) return [];
    return b ? Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i) : [a];
  });
  return [...new Set(out)].filter(p => p >= 1 && p <= max).sort((x, y) => x - y);
}

/** Sheet number from the title block, e.g. "S-04" (bottom-right corner of Thai drawing sheets). */

export async function extractInBrowser(
  doc: PdfDoc,
  fileName: string,
  opts: { pages?: string; footingVariant?: string; cachedOcr?: PageOcr[]; cachedBoqOcr?: PageText[] },
  onProgress: (msg: string, frac: number) => void,
): Promise<BrowserExtraction> {
  clearPageCache();
  // timing only (console summary at the end): where reading a file spends its time
  const tStart = performance.now();
  const phase: Record<string, number> = {};
  const perPage: { page: number; how: string; ms: number; steps: string }[] = [];
  const warnings: string[] = [];
  const texts: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    texts.push(toPageText(i, vp, (await page.getTextContent()) as any));
    onProgress(`อ่านข้อความหน้า ${i}/${doc.numPages}`, (0.15 * i) / doc.numPages);
  }

  phase['text layer'] = performance.now() - tStart;
  const boqDoc = parseBoqPages([...texts, ...(opts.cachedBoqOcr || [])], fileName);
  const totals = boqTotalsByVariant(boqDoc);
  const boq = boqDoc.lines.length && Object.keys(totals).length
    ? { fileName, variants: Object.keys(totals), structuralByVariant: totals, warnings: boqDoc.warnings, lineCount: boqDoc.lines.length }
    : null;
  const boqPages = new Set(boqDoc.lines.map(l => l.page));
  const scheduleMembers = texts.filter(t => !boqPages.has(t.page)).flatMap(t => scheduleMembersFromPage(t, fileName));
  const textPages = new Set(texts.filter(t => t.items.map(i => i.str).join('').trim().length >= 40).map(t => t.page));
  const materialText = texts.filter(t => !boqPages.has(t.page)).flatMap(t => t.items.map(i => i.str)).join(' ');

  let ocrPages: PageOcr[] = opts.cachedOcr || [];
  const sheetIds: Record<number, string> = {};
  if (!ocrPages.length) {
    const requested = parsePageSpec(opts.pages, doc.numPages);
    const textWords = async (p: number) => { const vp = (await doc.getPage(p)).getViewport({ scale: 1 }); return pageTextToOcr(texts[p - 1], vp.width, vp.height).words; };
    const strokeLettered = new Set<number>();
    for (const p of textPages) {
      if (boqPages.has(p) || (!requested && !sheetId(await textWords(p))?.startsWith('S'))) continue;
      const pg = await doc.getPage(p);
      const ops = await pg.getOperatorList();
      if (extractSmallStrokes(ops.fnArray, ops.argsArray, pdfjs.OPS as any, pg.getViewport({ scale: 1 }).transform).small.length >= 200) strokeLettered.add(p);
    }
    const candidates = requested || Array.from({ length: doc.numPages }, (_, i) => i + 1).filter(p => (!textPages.has(p) || strokeLettered.has(p)) && !boqPages.has(p));
    if (candidates.length) {
      onProgress('เตรียม OCR ในเบราว์เซอร์ (โหลดข้อมูลภาษาครั้งแรก)…', 0.18);
      const tw = performance.now();
      const [worker, thai, turned] = await Promise.all([ocrWorker(), drawingThaiWorker(), turnedWorkers()]);
      phase['load OCR engines'] = performance.now() - tw;
      let steps: Record<string, number> = {};
      const env = {
        worker, extraWorkers: [thai], turnedWorkers: turned, OPS: pdfjs.OPS as any, imagePixels: bitmapPixels,
        toImage: (d: Uint8Array, w: number, h: number) => grayToCanvas(d, w, h),
        renderPage: (pg: PdfJsPage, _scale: number, rot: boolean, prepared: boolean) => renderForOcr(pg, 300 / 72, rot, prepared),
        readScan,
        onTime: (step: string, ms: number) => { steps[step] = (steps[step] || 0) + ms; },
      };
      const pages = candidates;
      const structuralOnly = !requested;
      let i = 0;
      for (const p of pages) {
        i++;
        const page = await doc.getPage(p);
        onProgress(`อ่านหน้า ${p} (${i}/${pages.length})…`, 0.28 + (0.62 * i) / pages.length);
        // Yield to browser event loop so spinner and progress bar animate smoothly
        await new Promise(r => setTimeout(r, 16));

        // When structuralOnly is active, quickly classify sheet before expensive full-page OCR
        const tp = performance.now();
        steps = {};
        const note = (how: string) => perPage.push({ page: p, how, ms: Math.round(performance.now() - tp), steps: Object.entries(steps).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(', ') });
        if (structuralOnly) {
          const cls = await fastClassifySheet(page, env.worker, p, pages.length, texts[p - 1]);
          steps.classify = performance.now() - tp;
          if (cls.sheetId) sheetIds[p] = cls.sheetId;
          if (cls.skip) {
            note(`skipped (${cls.reason || cls.sheetId || 'not structural'})`);
            // Non-structural page (e.g. A-01..A-14, SN-01..03, EE-01..03, Cover/Index) skipped in ~50-150ms
            continue;
          }
        }

        const paddleDetail: string[] = [];
        const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
        paddleStatsSink = (k, st) => paddleDetail.push(`w${k}: init ${sec(st.initMs)}${st.loads > 1 ? ` (models loaded ${st.loads}x)` : ''}, det ${sec(st.detMs)} (${st.detTiles} tiles), rec ${sec(st.recMs)} (${st.recCalls} crops / ${st.boxes} boxes), post ${sec(st.postMs)}, turned pass ${sec(st.turnedMs)}, words ${st.wordsKept}, total ${sec(st.totalMs)}`);
        const r = await ocrPdfPage(page as any, p, env as any);
        paddleStatsSink = null;
        note(`OCR ${r.kind}`);
        if (paddleDetail.length) perPage[perPage.length - 1].steps += ` || paddle ${paddleDetail.join(' ; ')}`;
        if (textPages.has(p)) r.words.push(...await textWords(p));
        const id = sheetId(r.words);
        if (id) sheetIds[p] = id;
        if (structuralOnly && id && /^(A|EE|E|SN|ID|L)-/i.test(id)) continue;
        ocrPages.push(r);
      }
      if (!ocrPages.length) warnings.push('ไม่พบแผ่นแบบโครงสร้างที่อ่านได้ — ระบุช่วงหน้าแบบโครงสร้างแล้วลองใหม่');
    }
  }

  phase['OCR pages'] = perPage.reduce((a, x) => a + x.ms, 0);
  onProgress('ประกอบผังกับแบบขยาย…', 0.95);
  const tReader = performance.now();
  const textSheets: PageOcr[] = [];
  for (const t of texts) {
    if (!textPages.has(t.page) || boqPages.has(t.page) || ocrPages.some(o => o.page === t.page)) continue;
    const pg = await doc.getPage(t.page);
    const vp = pg.getViewport({ scale: 1 });
    textSheets.push({ ...pageTextToOcr(t, vp.width, vp.height), ...await textSheetGeometry(pg) });
  }
  const { readings, notes } = readSheets([...ocrPages, ...textSheets]);
  const merged = mergeSheetReadings(readings, fileName, { ...DEFAULT_MERGE_ASSUMPTIONS, footingVariant: opts.footingVariant ?? 'แผ่' });
  phase['reader + merge'] = performance.now() - tReader;
  phase.total = performance.now() - tStart;
  console.groupCollapsed(`[StructBOQ timing] ${fileName}: ${(phase.total / 1000).toFixed(1)} s, ${perPage.filter(x => x.how.startsWith('OCR')).length} pages OCR'd, ${perPage.filter(x => x.how.startsWith('skipped')).length} skipped${opts.cachedOcr?.length ? ' (cached OCR)' : ''}`);
  console.table(Object.fromEntries(Object.entries(phase).map(([k, v]) => [k, `${(v / 1000).toFixed(1)} s`])));
  console.table(perPage.map(x => ({ page: x.page, how: x.how, seconds: +(x.ms / 1000).toFixed(1), steps: x.steps })));
  console.log(perPage.map(x => `p${x.page} ${(x.ms / 1000).toFixed(1)}s ${x.how} | ${x.steps}`).join('\n'));
  console.groupEnd();

  // Deterministically parse Structural General Notes (รายการประกอบแบบวิศวกรรมโครงสร้าง)
  const allWordSources: { page: number; words: OcrWord[] }[] = [];
  for (const o of ocrPages) {
    allWordSources.push({ page: o.page, words: o.words });
  }
  for (const t of textSheets) {
    if (!allWordSources.some(s => s.page === t.page)) {
      allWordSources.push({ page: t.page, words: t.words });
    }
  }
  for (const t of texts) {
    if (!allWordSources.some(s => s.page === t.page) && t.items.length > 0) {
      const pageWords: OcrWord[] = t.items.map(it => ({
        text: it.str,
        x0: it.x0 / (t.width || 1),
        y0: it.y0 / (t.height || 1),
        x1: it.x1 / (t.width || 1),
        y1: it.y1 / (t.height || 1),
        vertical: false,
        conf: 99,
      }));
      allWordSources.push({ page: t.page, words: pageWords });
    }
  }

  const extractedNotes = extractStructuralNotesFromWords(allWordSources);
  const materialSpecs = applyGeneralNotesToSpecs(DEFAULT_MATERIAL_SPECS, extractedNotes);
  const notesFromGeneral = extractedNotes.evidenceSnippets.map(snip => `[รายการประกอบแบบ] ${snip}`);

  return {
    fileName, pageCount: doc.numPages,
    members: [...scheduleMembers, ...merged.members],
    completeness: merged.completeness,
    mergeNotes: [...notes, ...merged.notes, ...notesFromGeneral],
    warnings: [...warnings, ...boqDoc.warnings],
    boq, ocrPages, sheetIds, materialText,
    readings: readings.map(r => ({ ...r, sheet_id: r.sheet_id || sheetIds[r.page] })),
    skipped: merged.skipped,
    extractedNotes,
    materialSpecs,
  };
}
