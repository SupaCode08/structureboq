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
import { toPageText, pageTextToOcr, readTextLayers, type ProcessLog } from './pdfText';
import { parseBoqPages, boqTotalsByVariant } from './boqParser';
import { scheduleMembersFromPage } from './scheduleParser';
import { isVectorTextPage, ocrPdfPage, sheetId, parsePageSpec, partitionDrawingPages, type PdfJsPage } from './pdfOcrPipeline';
export { parsePageSpec, partitionDrawingPages };
import { readSheets } from './sheetReader';
import { reconcileScheduleRows } from '../engine/sourceConflicts';
import { ocrBoqPage } from './boqOcr';
import { prepareScan, estimateSkew, rotateRaster, removeLines, extractLines, findRings, ringsAtLineEnds, orientScan, prepareEmbeddedScan } from './scanPrep';
import { extractSmallStrokes, pageGeometry, rasterize, type Polyline } from './vectorText';
import { titleBlockStrokes, titleBlockVerdict, sheetCodeVerdict, rightColumnRules, photoVerdict } from './titleBlock';
import { vectorTextLines, mergeVectorOcr, filterTitleBlockBoilerplate } from './labelOcr';
import { imageBoxesOnPage, imageGray } from './imageBoxes';
import type { OcrWord, PageOcr, PageText } from './types';
import { laneCount, mapLanes, raceAbort, serialize } from './lanes';
import { cachedRead, cacheWrite, indexedDbStore, pageCacheKey, type CachedOcr, type PageCacheStore } from './pageCache';
import { OCR_ID } from './ocrIdentity';
import { timingSummary, type PageTiming } from './pdfText';

let pageStore: PageCacheStore | null | undefined;
/** this browser's page OCR cache (created on first use; null where IndexedDB is unavailable) */
const store = () => (pageStore === undefined ? (pageStore = indexedDbStore()) : pageStore);
import type { Raster } from './ocr';
import { extractStructuralNotesFromWords, applyGeneralNotesToSpecs, type ExtractedGeneralNotes } from './structuralNotesParser';
import detUrl from '../../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx?url';
import recUrl from '../../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx?url';
import dictUrl from '../../node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt?url';
import thaiRecUrl from '../assets/openthaio2/rec.onnx?url';
import thaiDictUrl from '../assets/openthaio2/rec_dict.txt?url';

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
  const fileKey = key || (doc as any).fingerprints?.[0] || '';
  const k = `${fileKey}:${pageNo}:${dpi}`;
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

async function largestPageImage(page: any): Promise<{ px: any; m: number[] } | null> {
  const ops = await page.getOperatorList();
  const vp1 = page.getViewport({ scale: 1 });
  const vt = vp1.transform;
  type M = number[];
  const mul = (m: M, n: M): M => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  let ctm: M = vt;
  const stack: M[] = [];
  let best: any = null;
  let bestM: M = vt;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    if (fn !== pdfjs.OPS.paintImageXObject) continue;
    const name: string = ops.argsArray[i][0];
    const store = name.startsWith('g_') && page.commonObjs ? page.commonObjs : page.objs;
    if (!store || (typeof store.has === 'function' && !store.has(name))) continue;
    const rawImg: any = await Promise.race([
      new Promise(res => { try { store.get(name, res); } catch { res(null); } }),
      new Promise(res => setTimeout(res, 200, null)),
    ]);
    const w = rawImg?.width || rawImg?.bitmap?.width || 0;
    const h = rawImg?.height || rawImg?.bitmap?.height || 0;
    if (w * h > ((best?.width || best?.bitmap?.width || 0) * (best?.height || best?.bitmap?.height || 0))) {
      best = rawImg;
      bestM = ctm;
    }
  }
  const bestPx = best?.data ? best : bitmapPixels(best);
  if (!bestPx?.data) return null;
  return { px: bestPx, m: bestM };
}

const activeWorkerPromises = new Set<(err: Error) => void>();
let scanPrepWorker: Worker | null = null;
let scanPrepCalls = 0;

// offload scan prep (Otsu, deskew, line removal) off the main thread so page rendering does not freeze the UI
function prepScanInWorker(gray: Uint8Array, W: number, H: number, pageLongPt: number, rotate90: boolean) {
  const w = (scanPrepWorker ??= new Worker(new URL('./scanPrepWorker.ts', import.meta.url), { type: 'module' }));
  const id = ++scanPrepCalls;
  return new Promise<{ raster: Raster; width: number; height: number; lines?: any; circles?: any }>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      activeWorkerPromises.delete(onAbort);
    };
    const onAbort = (err: Error) => { if (!settled) { settled = true; cleanup(); reject(err); } };
    const onMsg = (e: MessageEvent) => {
      if (!e.data || e.data.id !== id) return;
      if (!settled) { settled = true; cleanup(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data); }
    };
    const onErr = (e: ErrorEvent) => {
      try { w.terminate(); } catch {}
      scanPrepWorker = null;
      if (!settled) { settled = true; cleanup(); reject(new Error(e.message || 'scanPrepWorker crashed')); }
    };
    activeWorkerPromises.add(onAbort);
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr, { once: true });
    w.postMessage({ id, gray, W, H, pageLongPt, rotate90 }, [gray.buffer]);
  });
}

const rasterWorkers: (Worker | null)[] = [];
let rasterCalls = 0;

function runRasterWorker(laneIdx: number, payload: { polys: Polyline[]; widthPt: number; heightPt: number; scale: number; pen: number; rotate: boolean; withLines?: boolean }): Promise<{ raster: Raster; lines?: any[] }> {
  const k = laneIdx % 3;
  const w = (rasterWorkers[k] ??= new Worker(new URL('./rasterWorker.ts', import.meta.url), { type: 'module' }));
  const id = ++rasterCalls;
  return new Promise<{ raster: Raster; lines?: any[] }>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      activeWorkerPromises.delete(onAbort);
    };
    const onAbort = (err: Error) => { if (!settled) { settled = true; cleanup(); reject(err); } };
    const onMsg = (e: MessageEvent) => {
      if (!e.data || e.data.id !== id) return;
      if (!settled) {
        settled = true;
        cleanup();
        e.data.error ? reject(new Error(e.data.error)) : resolve({ raster: { data: e.data.data, width: e.data.width, height: e.data.height }, lines: e.data.lines });
      }
    };
    const onErr = (e: ErrorEvent) => {
      try { w.terminate(); } catch {}
      rasterWorkers[k] = null;
      if (!settled) { settled = true; cleanup(); reject(new Error(e.message || 'rasterWorker crashed')); }
    };
    activeWorkerPromises.add(onAbort);
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr, { once: true });
    w.postMessage({ id, ...payload });
  });
}

// offload stroke rasterization off the main thread so vector pages do not freeze the UI
function rasterizeInWorker(polys: Polyline[], widthPt: number, heightPt: number, scale: number, pen: number, rotate: boolean): Promise<Raster> {
  return runRasterWorker(0, { polys, widthPt, heightPt, scale, pen, rotate }).then(r => r.raster).catch(err => {
    if (err?.name === 'AbortError') throw err;
    return rasterize(polys, widthPt, heightPt, scale, pen, rotate);
  });
}

function vectorLinesAndRasterInWorker(laneIdx: number, polys: Polyline[], widthPt: number, heightPt: number, scale: number, pen: number): Promise<{ raster: Raster; lines: any[] }> {
  return runRasterWorker(laneIdx, { polys, widthPt, heightPt, scale, pen, rotate: false, withLines: true }).then(r => ({ raster: r.raster, lines: r.lines || [] })).catch(err => {
    if (err?.name === 'AbortError') throw err;
    return {
      lines: filterTitleBlockBoilerplate(vectorTextLines(polys), widthPt, heightPt),
      raster: rasterize(polys, widthPt, heightPt, scale, pen, false),
    };
  });
}

/** Largest embedded image of a scanned page as a 400-DPI prepared raster (same logic as scripts/scanImage.ts). */
async function embeddedScanForOcr(page: any, rotate90: boolean, prepared = true) {
  const im = await largestPageImage(page);
  if (!im) return null;
  const { px: bestPx, m: bestM } = im;
  const { width: w, height: h } = bestPx;
  let gray = imageGray(bestPx);
  if (!gray) return null;
  const [dx, dy] = [bestM[0], bestM[1]];
  const base = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 180) : (dy > 0 ? 90 : 270);
  const oriented = orientScan(gray, w, h, base, rotate90);
  gray = oriented.gray;
  const { width: W, height: H } = oriented;
  const vp1 = page.getViewport({ scale: 1 });
  if (!prepared) return { image: grayToCanvas(gray, W, H), width: W, height: H, skew: 0 };
  const pageLongPt = Math.max(vp1.width, vp1.height);
  try {
    const { raster, width, height, lines, circles } = await prepScanInWorker(gray, W, H, pageLongPt, rotate90);
    return { image: null, raster, width, height, skew: 0, lines, circles };
  } catch (e) {
    // a failed hand-over leaves gray detached (its buffer went to the worker): nothing left to prepare inline
    if (!gray.byteLength) throw e;
    const { raster, width, height, lines, circles } = prepareEmbeddedScan(gray, W, H, pageLongPt, rotate90);
    return { image: null, raster, width, height, skew: 0, lines, circles };
  }
}

export async function renderForOcr(page: any, scale: number, rotate90: boolean, prepared = true) {
  const emb = await embeddedScanForOcr(page, rotate90, prepared).catch(() => null);
  if (emb) return emb;
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
  return { image: null, raster: prep, width: prep.width, height: prep.height, skew: 0, lines, circles };
}

export interface SheetClassification {
  sheetId?: string;
  isStructural: boolean;
  skip: boolean;
  reason?: string;
}

/** Quickly classify sheet from the bottom-right title block in ~50ms. */
export async function fastClassifySheet(page: any, getWorker: any, pageNo: number, pageCount: number, pageText?: PageText, lane = 0): Promise<SheetClassification> {
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
    // the sheet code is read from the title-block corner only: a header line like "(S01-S09)" elsewhere is not this sheet's code
    const corner = pageText.items.filter(it => it.nb && it.nb[0] >= 0.76 && it.nb[1] >= 0.85);
    const codeText = corner.length ? corner.map(it => it.str).join(' ').toUpperCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ') : norm;
    const mNon = codeText.match(/(?:^|[^A-Z0-9])(A|AR|ARCH|EE|E|SN|SAN|M|ME|AC|ID|L)[-_ ]*0?(\d{1,2})(?:[^0-9]|$)/i);
    const mStr = codeText.match(/(?:^|[^A-Z0-9])(S|ST|STR)[-_ ]*0?(\d{1,2})(?:[^0-9]|$)/i);
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

  // Real text page: return structural right away because its rendered corner would only be OCR noise of text the layer already gave.
  if (pageText && pageText.items.map(i => i.str).join('').trim().length >= 40) {
    return { isStructural: true, skip: false };
  }

  // The corner lettering is vector strokes: re-drawn from the strokes alone at 300 dpi it reads far better than a render of the whole corner.
  try {
    const vpTb = page.getViewport({ scale: 1 });
    const ops = await page.getOperatorList();
    const s = extractSmallStrokes(ops.fnArray, ops.argsArray, pdfjs.OPS as any, vpTb.transform);
    if (s.small.length < 200 && s.imageCount >= 5) {
      return { isStructural: false, skip: true, reason: 'ข้ามหน้าภาพถ่าย/ภาพ render (หลายภาพ ไม่มีลายเส้นแบบ)' };
    }
    if (s.small.length >= 200) {
      const tb = titleBlockStrokes(s.small, vpTb.width, vpTb.height);
      if (tb.polys.length) {
        const sc = 200 / 72;
        const r = rasterize(tb.polys, tb.widthPt, tb.heightPt, sc, 3);
        const lines = vectorTextLines(tb.polys).filter(L => {
          if (L.vertical) return false;
          const w = L.box.x1 - L.box.x0, h = Math.max(1, L.box.y1 - L.box.y0);
          return h >= 4.5 && w / h < 10;
        });
        const jobs = lines.map(L => ({
          box: [
            Math.max(0, Math.floor(L.box.x0 * sc) - 6),
            Math.max(0, Math.floor(L.box.y0 * sc) - 6),
            Math.min(r.width, Math.ceil(L.box.x1 * sc) + 6),
            Math.min(r.height, Math.ceil(L.box.y1 * sc) + 6),
          ],
          turned: false,
        }));
        const gpu = await checkWebGpuAvailability();
        const res = jobs.length ? await readBand(gpu ? 0 : (lane % 2), r, 'flat', undefined, true, undefined, jobs).catch(() => null) : null;
        const texts = res?.lines?.map(l => l.text) || [];
        const v = titleBlockVerdict(texts);
        if (v.skip) return { sheetId: v.id, isStructural: false, skip: true, reason: `ข้ามแผ่นไม่ใช่โครงสร้าง (${v.id})` };
        if (v.structural) return { sheetId: v.id, isStructural: true, skip: false };
      }
      // only reached when no sheet code was read; a sheet's title-block frame has at most 4 such rules
      if (rightColumnRules(s.vsegs, vpTb.width, vpTb.height) >= 6) return { sheetId: 'TABLE', isStructural: false, skip: true, reason: 'ข้ามหน้าตาราง (เช่น BOQ ปร.4) — ไม่มีกรอบชื่อแบบ' };
      // Vector-outline sheet already checked: do not fall through to slow 2000px/3000px Tesseract corner renders,
      // but a render/photo sheet with a drawn title-block frame is still skipped
      const imV = await largestPageImage(page).catch(() => null);
      if (imV) {
        const vp1 = page.getViewport({ scale: 1 });
        const cover = Math.abs(imV.m[0] * imV.m[3] - imV.m[1] * imV.m[2]) / (vp1.width * vp1.height);
        if (photoVerdict(imV.px, cover)) return { isStructural: false, skip: true, reason: 'ข้ามหน้าภาพถ่าย/ภาพ render (ไม่พบรหัสแผ่น)' };
      }
      return { isStructural: true, skip: false };
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message?.includes?.('aborted') || err?.message?.includes?.('destroyed')) throw err;
  }

  const decide = (rawText: string): SheetClassification | null => {
    const norm = rawText.toUpperCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ');

    if (/สารบัญแบบ|สารบัญ|DRAWING\s*LIST|SHEET\s*INDEX/i.test(rawText) || (/รายการประกอบแบบ/i.test(rawText) && !/โครงสร้าง|STRUCTUR|วิศวกรรม/i.test(rawText))) {
      return { sheetId: 'COVER', isStructural: false, skip: true, reason: 'ข้ามสารบัญ / รายการประกอบแบบทั่วไป' };
    }

    const v = sheetCodeVerdict(norm);
    if (v.kind === 'index') {
      return { sheetId: 'INDEX', isStructural: false, skip: true, reason: 'ข้ามสารบัญแบบ (พบทั้ง A และ S)' };
    }
    if (v.kind === 'nonstruct') {
      return { sheetId: v.id, isStructural: false, skip: true, reason: `ข้ามแผ่นไม่ใช่โครงสร้าง (${v.id})` };
    }
    if (v.kind === 'struct') {
      return { sheetId: v.id, isStructural: true, skip: false };
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
    const isStruct = /ฐ[าภ]นร[าภ]ก|ค[าภ]น|เส[าภ]|โครงสร[้้า]ง|โคร?ง?ห?ลั?งค[าภ]|\b[S5]\s*[-_=]\s*\d{1,2}\b|\bS\s?\d{2}\b|ตาราง.*เสา|แบบขยาย/i.test(rawText);

    if (isNonStruct && !isStruct) {
      return { isStructural: false, skip: true, reason: 'ข้ามแบบสถาปัตย์ / งานระบบ' };
    }
    if (isStruct) {
      return { sheetId: 'S', isStructural: true, skip: false };
    }
    return null;
  };

  const im = await largestPageImage(page).catch(() => null);
  if (im) {
    const vp1 = page.getViewport({ scale: 1 });
    const cover = Math.abs(im.m[0] * im.m[3] - im.m[1] * im.m[2]) / (vp1.width * vp1.height);
    if (photoVerdict(im.px, cover)) return { isStructural: false, skip: true, reason: 'ข้ามหน้าภาพถ่าย/ภาพ render (ไม่พบรหัสแผ่น)' };
  }

  const SLOW_RENDER_MS = 8000; // a sheet this heavy would take longer still at 3000 px; it stays undecided and is read as usual
  for (const target of [2000, 3000]) {
    const c = document.createElement('canvas');
    try {
      const vp1 = page.getViewport({ scale: 1 });
      // 2000 px long side catches most scanned sheet codes fast; retry at 3000 px when the first gives no decision
      const scale = target / Math.max(vp1.width, vp1.height);
      const vp = page.getViewport({ scale });
      const cropW = Math.ceil(vp.width * 0.24);
      const cropH = Math.ceil(vp.height * 0.15);
      if (cropW < 50 || cropH < 30) return { isStructural: true, skip: false };

      c.width = cropW;
      c.height = cropH;
      const ctx = c.getContext('2d');
      if (!ctx) return { isStructural: true, skip: false };
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cropW, cropH);

      const t0 = performance.now();
      await page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: [1, 0, 0, 1, -(vp.width - cropW), -(vp.height - cropH)],
      }).promise;
      const renderMs = performance.now() - t0;

      // Skip blank/near-white corner crops without spawning Tesseract
      const imgData = ctx.getImageData(0, 0, cropW, cropH).data;
      let dark = 0;
      const step = 16;
      for (let i = 0; i < imgData.length; i += 4 * step) {
        if (imgData[i] < 220 || imgData[i + 1] < 220 || imgData[i + 2] < 220) dark++;
      }
      if (dark * step * 4 < imgData.length * 0.0015) continue;

      // scanned sheet codes are ~10 px tall at this size: tesseract misses them, PaddleOCR on the GPU reads them
      // (0.1–0.4 s a corner). Worker 0 on the GPU is what the scan read uses anyway, so this also loads it early.
      // Never Paddle on WASM here: single-thread text detection took minutes per corner.
      if (await checkWebGpuAvailability()) {
        const gray = new Uint8Array(cropW * cropH);
        for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (imgData[j] * 77 + imgData[j + 1] * 150 + imgData[j + 2] * 29) >> 8;
        const ws = await readScan({ data: gray, width: cropW, height: cropH }).catch(() => null);
        const dPad = ws?.length ? decide(ws.map(w => w.text).join(' ')) : null;
        if (dPad) return dPad;
      }
      const worker = typeof getWorker === 'function' ? await getWorker() : getWorker;
      const res = await worker.recognize(c);
      const rawText = res?.data?.text || '';
      const decision = decide(rawText);
      if (decision) return decision;
      // scanned corners often read only as sparse text
      const sparse = await (await titleBlockWorker(lane)).recognize(c);
      const d11 = decide(sparse?.data?.text || "");
      if (d11) return d11;
      if (target === 2000 && (renderMs > SLOW_RENDER_MS || rawText.trim().length >= 8)) break;
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.message?.includes?.('aborted') || err?.message?.includes?.('destroyed')) throw err;
      // Graceful fallback
    } finally {
      // Immediate canvas memory disposal
      c.width = 0;
      c.height = 0;
    }
  }
  return { isStructural: true, skip: false };
}

// the file picker already sorted these pages; the same bytes give the same answer
const sortMemo = new Map<string, SheetClassification>();

/** Sorts pages by their title-block corner before any page OCR: 3 at a time, results in page order. */
export async function classifyPages(
  doc: PdfDoc,
  pages: number[],
  pageCount: number,
  textOf: (p: number) => PageText | undefined | Promise<PageText | undefined>,
  onPage?: (done: number, total: number, page: number, cls: SheetClassification) => void,
  abortSignal?: AbortSignal,
): Promise<{ page: number; cls: SheetClassification; ms: number }[]> {
  if (!pages.length) return [];
  let done = 0;
  const n = pages.length;
  const fingerprint = (doc as any).fingerprints?.[0];
  return raceAbort(
    mapLanes(pages, 3, async (p, _index, lane) => {
      if (abortSignal?.aborted) {
        const err = new Error('Classification aborted by user');
        err.name = 'AbortError';
        throw err;
      }
      const key = fingerprint ? `${fingerprint}:${p}:${pageCount > 2 ? 1 : 0}` : null;
      let cls = key ? sortMemo.get(key) : undefined;
      let ms = 0;
      if (!cls) {
        const t0 = performance.now();
        cls = await fastClassifySheet(await doc.getPage(p), () => sortOcrWorker(lane), p, pageCount, await textOf(p), lane);
        ms = performance.now() - t0;
        if (abortSignal?.aborted) {
          const err = new Error('Classification aborted by user');
          err.name = 'AbortError';
          throw err;
        }
        if (key) {
          if (sortMemo.size > 500) {
            const first = sortMemo.keys().next().value;
            if (first) sortMemo.delete(first);
          }
          sortMemo.set(key, cls);
        }
      }
      done++;
      onPage?.(done, n, p, cls);
      return { page: p, cls, ms };
    }),
    abortSignal,
  );
}

/** Pixels of an image pdf.js handed over as an ImageBitmap (RGBA, transparent = paper). */
function bitmapPixels(img: any) {
  const bm = img?.bitmap;
  if (!bm?.width) return null;
  const c = document.createElement('canvas');
  c.width = bm.width; c.height = bm.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bm, 0, 0);
  const px = { width: bm.width, height: bm.height, kind: 3, data: ctx.getImageData(0, 0, bm.width, bm.height).data };
  c.width = 0; c.height = 0;
  return px;
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

/** tesseract.js worker, core and language data served with the app (public/tesseract/), never the CDN: reading works offline and cannot change under us */
const tessFiles = () => {
  const root = new URL(`${import.meta.env.BASE_URL}tesseract/`, location.href).href;
  return { workerPath: `${root}worker.min.js`, corePath: `${root}core`, langPath: `${root}lang` };
};

let thaiWorkerPromise: Promise<any> | null = null;
/** Thai+English OCR for ปร.4 pages whose text is drawn as outlines (language data ~0.9 MB, loaded once). */
async function thaiWorker() {
  if (!thaiWorkerPromise) {
    thaiWorkerPromise = (async () => {
      const T = await import('tesseract.js');
      const w = await T.createWorker('tha+eng', 1, tessFiles());
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
      const w = await T.createWorker('tha+eng', 1, tessFiles());
      await w.setParameters({ tessedit_pageseg_mode: '6' as any });
      return w;
    })();
  }
  return drawingThaiPromise;
}

const extraThaiWorkers: Promise<any>[] = [];
/** Lightweight lane for vector pages: only 1 tha+eng worker (PSM 6 for packed line strips) instead of 4 Tesseract workers. */
async function vectorThaiWorker(k: number): Promise<any> {
  if (k === 0) return drawingThaiWorker();
  return (extraThaiWorkers[k] ??= (async () => {
    const T = await import('tesseract.js');
    const w = await T.createWorker('tha+eng', 1, tessFiles());
    await w.setParameters({ tessedit_pageseg_mode: '6' as any });
    return w;
  })());
}

/** one full set of the four OCR workers a vector page needs; more lanes read other pages at the same time */
export interface OcrLane { worker: any; thai: any; turned: any[] }
const extraLanes: Promise<OcrLane>[] = [];
async function ocrLane(k: number): Promise<OcrLane> {
  if (k === 0) { const [worker, thai, turned] = await Promise.all([ocrWorker(), drawingThaiWorker(), turnedWorkers()]); return { worker, thai, turned }; }
  return (extraLanes[k] ??= (async () => {
    const T = await import('tesseract.js');
    const make = async (lang: string, psm: string) => { const w = await T.createWorker(lang, 1, tessFiles()); await w.setParameters({ tessedit_pageseg_mode: psm as any }); return w; };
    const [worker, thai, ta, tb] = await Promise.all([make('eng', '6'), make('tha+eng', '11'), make('eng', '6'), make('tha+eng', '11')]);
    return { worker, thai, turned: [ta, tb] };
  })());
}

let turnedPromise: Promise<any[]> | null = null;
/** second pair set up like ocrWorker + drawingThaiWorker: reads a vector page's turned raster while they read the flat one */
async function turnedWorkers() {
  if (!turnedPromise) {
    turnedPromise = (async () => {
      const T = await import('tesseract.js');
      return Promise.all([['eng', '6'], ['tha+eng', '11']].map(async ([lang, psm]) => {
        const w = await T.createWorker(lang, 1, tessFiles());
        await w.setParameters({ tessedit_pageseg_mode: psm as any });
        return w;
      }));
    })();
  }
  return turnedPromise;
}

const paddles: (Worker | null)[] = [];
const rasterOf = new WeakMap<object, Raster>(); // the gray raster behind each canvas toImage made, for the Paddle reader
let paddleCalls = 0;
let webGpuAvailable: boolean | null = null;

export interface WorkerOcrResult {
  status: 'success' | 'failed' | 'cancelled';
  words: OcrWord[];
  lines?: { text: string; conf: number }[];
  provider: 'webgpu' | 'wasm';
  error?: string;
  stats?: any;
}

export async function checkWebGpuAvailability(): Promise<boolean> {
  if (webGpuAvailable !== null) return webGpuAvailable;
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
  if (!nav?.gpu) {
    webGpuAvailable = false;
    return false;
  }
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    webGpuAvailable = !!adapter;
    return webGpuAvailable;
  } catch {
    webGpuAvailable = false;
    return false;
  }
}

// one job at a time per Paddle worker: two runs at once on its model hang it
const bandQueues: ReturnType<typeof serialize>[] = [];
function readBand(k: number, raster: Raster, pass: 'flat' | 'turned' | 'both' | 'upright' = 'both', onStats?: (worker: number, stats: any) => void, preferGpu = true, abortSignal?: AbortSignal, jobs?: { box: number[]; turned: boolean }[], mode: 'paddle' | 'thai' = 'paddle') {
  return (bandQueues[k] ??= serialize())(() => readBandNow(k, raster, pass, onStats, preferGpu, abortSignal, jobs, mode));
}

/** One pass ('flat' | 'turned' | 'both' | 'upright') of a scan read by PaddleOCR worker k (paddleWorker.ts). */
function readBandNow(
  k: number,
  raster: Raster,
  pass: 'flat' | 'turned' | 'both' | 'upright' = 'both',
  onStats?: (worker: number, stats: any) => void,
  preferGpu = true,
  abortSignal?: AbortSignal,
  jobs?: { box: number[]; turned: boolean }[],
  mode: 'paddle' | 'thai' = 'paddle',
): Promise<WorkerOcrResult> {
  if (abortSignal?.aborted) {
    return Promise.reject(new DOMException('OCR aborted by user', 'AbortError'));
  }

  const w = (paddles[k] ??= new Worker(new URL('./paddleWorker.ts', import.meta.url), { type: 'module' }));
  const id = ++paddleCalls;

  return new Promise<WorkerOcrResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort);
      }
      activeWorkerPromises.delete(settleReject);
    };

    const settleResolve = (res: WorkerOcrResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      settleReject(new DOMException('OCR aborted by user', 'AbortError'));
    };

    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    activeWorkerPromises.add(settleReject);

    const onMessage = (e: MessageEvent) => {
      if (!e.data || e.data.id !== id) return;
      if (e.data.status === 'failed' || e.data.error) {
        settleReject(new Error(e.data.error || 'PaddleOCR worker failed'));
      } else if (e.data.status === 'cancelled') {
        settleReject(new DOMException('OCR cancelled by worker', 'AbortError'));
      } else {
        if (e.data.stats && onStats) onStats(k, e.data.stats);
        settleResolve({
          status: 'success',
          words: e.data.words || [],
          lines: e.data.lines,
          provider: e.data.provider || 'wasm',
          stats: e.data.stats,
        });
      }
    };

    const onError = (e: ErrorEvent) => {
      try { w.terminate(); } catch {}
      paddles[k] = null;
      settleReject(new Error(e.message || 'PaddleOCR worker crashed'));
    };

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError, { once: true });
    const urls = mode === 'thai' ? { det: '', rec: thaiRecUrl, dict: thaiDictUrl } : { det: detUrl, rec: recUrl, dict: dictUrl };
    w.postMessage({ id, raster, jobs, urls, pass, preferGpu, mode });
  });
}

/** PaddleOCR (WebGPU, flat pass) with the tesseract worker's recognize() shape: the whole raster is read on the first tile, the other tiles give nothing */
function paddleAsEng(k: number, run: <T>(job: () => Promise<T>) => Promise<T>, abortSignal?: AbortSignal, pass: 'flat' | 'turned' | 'both' | 'upright' = 'flat') {
  return {
    recognize: async (img: object, o?: { rectangle?: { left: number; top: number } }) => {
      if (o?.rectangle?.left || o?.rectangle?.top) return { data: { words: [] as any[] } };
      const r = rasterOf.get(img);
      if (!r) throw new Error('paddleAsEng: no raster for this image');
      const res = await run(() => readBand(k, r, pass, undefined, true, abortSignal));
      return { data: { words: res.words.map(w => ({ text: w.text, confidence: w.conf, bbox: { x0: w.x0 * r.width, y0: w.y0 * r.height, x1: w.x1 * r.width, y1: w.y1 * r.height } })) } };
    },
  };
}

/**
 * Full-image scan read by PaddleOCR:
 *  - Primary: WebGPU 1-worker sequential baseline (`pass: 'both'`), preventing duplicate VRAM allocations,
 *    utilizing Dynamic Width (`bucket=0`) with explicit per-tile/crop tensor disposal and 100% exact parity.
 *  - Fallback: WASM 2-worker parallel baseline (`worker 0: flat`, `worker 1: turned`).
 *  - Ultimate fallback: Tesseract if both workers fail.
 */
export async function readScan(
  r: Raster,
  onStats?: (worker: number, stats: any) => void,
  abortSignal?: AbortSignal,
): Promise<OcrWord[]> {
  if (abortSignal?.aborted) {
    throw new DOMException('OCR aborted by user', 'AbortError');
  }

  const hasGpu = await checkWebGpuAvailability();
  if (hasGpu) {
    try {
      const res = await readBand(0, r, 'both', onStats, true, abortSignal);
      // Requirements:
      // When Worker returns status === 'success', accept the result immediately regardless of provider!
      // Even if words is empty, it is a valid completed OCR pass. Never duplicate OCR!
      if (res.status === 'success') {
        if (res.provider === 'wasm') {
          // Worker 0 fell back to WASM internally. Record so subsequent pages bypass WebGPU attempt.
          webGpuAvailable = false;
        }
        return res.words;
      }
    } catch (gpuErr: any) {
      if (gpuErr?.name === 'AbortError' || abortSignal?.aborted) {
        throw gpuErr;
      }
      console.warn('[readScan] WebGPU execution failed; cleanly falling back to WASM 2-worker parallel:', gpuErr);
      webGpuAvailable = false;
    }
  }

  // Fallback: WASM 2-worker parallel baseline
  const n = typeof navigator !== 'undefined' ? Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  if (n < 2) {
    const res = await readBand(0, r, 'both', onStats, false, abortSignal);
    return res.words;
  }
  const [flatRes, turnedRes] = await Promise.all([
    readBand(0, r, 'flat', onStats, false, abortSignal),
    readBand(1, r, 'turned', onStats, false, abortSignal),
  ]);
  return [...flatRes.words, ...turnedRes.words];
}

/** Warm up OCR lanes and WebGPU models ahead of time while the user is choosing pages. */
export async function warmOcrEngines(doc: PdfDoc, pages: number[], abortSignal?: AbortSignal): Promise<void> {
  try {
    if (!pages.length || abortSignal?.aborted) return;
    const page = await doc.getPage(pages[0]);
    if (abortSignal?.aborted) return;
    if (!(await isVectorTextPage(page as any, pdfjs.OPS as any))) return;
    if (abortSignal?.aborted) return;
    const white: Raster = { data: new Uint8Array(32 * 32).fill(255), width: 32, height: 32 };
    const paddle = (async () => {
      if (await checkWebGpuAvailability()) {
        if (abortSignal?.aborted) return;
        await readBand(0, white, 'flat', undefined, true, abortSignal);
      }
    })();
    const thai = readBand(1, white, 'flat', undefined, false, abortSignal, [{ box: [0, 0, 32, 32], turned: false }], 'thai').catch(() => {});
    await Promise.all([paddle, thai]);
  } catch {}
}

/**
 * Terminates all running OCR workers (PaddleOCR and Tesseract.js) and frees all
 * associated memory (WASM heap, WebGPU buffers, language models).
 */
export async function terminateAllWorkers(): Promise<void> {
  // Reject all pending worker promises immediately to prevent hung/dangling promises
  for (const rejectActive of activeWorkerPromises) {
    try {
      rejectActive(new DOMException('Worker terminated by user or session reset', 'AbortError'));
    } catch {}
  }
  activeWorkerPromises.clear();

  if (scanPrepWorker) {
    try { scanPrepWorker.terminate(); } catch {}
    scanPrepWorker = null;
  }
  for (let i = 0; i < rasterWorkers.length; i++) {
    const w = rasterWorkers[i];
    if (w) {
      try { w.terminate(); } catch {}
      rasterWorkers[i] = null;
    }
  }

  // Terminate Paddle workers
  for (let i = 0; i < paddles.length; i++) {
    const w = paddles[i];
    if (w) {
      try { w.terminate(); } catch {}
      paddles[i] = null;
    }
  }
  bandQueues.length = 0;
  // Terminate Tesseract workers
  if (workerPromise) {
    try { const w = await workerPromise; await w?.terminate?.(); } catch {}
    workerPromise = null;
  }
  for (const p of titleBlockPromises.splice(0)) {
    if (p) {
      try { const w = await p; await w?.terminate?.(); } catch {}
    }
  }
  for (const p of sortOcrPromises.splice(0)) {
    if (p) {
      try { const w = await p; await w?.terminate?.(); } catch {}
    }
  }
  if (drawingThaiPromise) {
    try { const w = await drawingThaiPromise; await w?.terminate?.(); } catch {}
    drawingThaiPromise = null;
  }
  if (turnedPromise) {
    try {
      const ws = await turnedPromise;
      for (const w of ws) await w?.terminate?.();
    } catch {}
    turnedPromise = null;
  }
  for (const lane of extraLanes.splice(0)) {
    try { const l = await lane; for (const w of [l.worker, l.thai, ...l.turned]) await w?.terminate?.(); } catch {}
  }
  for (const wp of extraThaiWorkers.splice(0)) {
    if (wp) try { const w = await wp; await w?.terminate?.(); } catch {}
  }
  if (thaiWorkerPromise) {
    try { const w = await thaiWorkerPromise; await w?.terminate?.(); } catch {}
    thaiWorkerPromise = null;
  }
  clearPageCache();
}

const titleBlockPromises: (Promise<any> | null)[] = [];
export async function titleBlockWorker(k = 0) {
  return (titleBlockPromises[k] ??= (async () => {
    const T = await import('tesseract.js');
    const w = await T.createWorker('eng', 1, tessFiles());
    await w.setParameters({ tessedit_pageseg_mode: '11' as any });
    return w;
  })());
}

let workerPromise: Promise<any> | null = null;
export async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await import('tesseract.js');
      const w = await T.createWorker('eng', 1, tessFiles());
      await w.setParameters({ tessedit_pageseg_mode: '6' as any });
      return w;
    })();
  }
  return workerPromise;
}

const sortOcrPromises: (Promise<any> | null)[] = [];
async function sortOcrWorker(k: number) {
  if (k === 0) return ocrWorker();
  return (sortOcrPromises[k] ??= (async () => {
    const T = await import('tesseract.js');
    const w = await T.createWorker('eng', 1, tessFiles());
    await w.setParameters({ tessedit_pageseg_mode: '6' as any });
    return w;
  })());
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
  /** what the page sort found on each page it looked at (automatic mode only) */
  pageMap: { page: number; sheetId?: string; skip: boolean; reason?: string }[];
  extractedNotes?: ExtractedGeneralNotes;
  materialSpecs?: MaterialSpecs;
  /** pages each step opened, by original page number */
  processLog: ProcessLog;
  /** the pages the user selected (undefined = whole file, structural sheets found automatically) */
  requestedPages?: number[];
  /** where the time went: phases, every page, peak JS heap where the browser reports it */
  timing: PageTiming;
}

export async function extractInBrowser(
  doc: PdfDoc,
  fileName: string,
  opts: { pages?: string; footingVariant?: string; cachedOcr?: PageOcr[]; cachedBoqOcr?: PageText[]; abortSignal?: AbortSignal; /** SHA-256 of the file: enables the page OCR cache */ fileSha?: string | null },
  onProgress: (msg: string, frac: number) => void,
): Promise<BrowserExtraction> {
  const checkAbort = () => {
    if (opts.abortSignal?.aborted) {
      const err = new Error('Extraction aborted by user');
      err.name = 'AbortError';
      throw err;
    }
  };
  checkAbort();

  const onAbort = () => {
    terminateAllWorkers();
  };
  opts.abortSignal?.addEventListener('abort', onAbort, { once: true });

  try {
    clearPageCache();
    // timing only (console summary at the end): where reading a file spends its time
    const tStart = performance.now();
    const phase: Record<string, number> = {};
    const perPage: { page: number; how: string; ms: number; steps: string }[] = [];
    let peakHeap = 0;
    const heap = () => { const m = (performance as any).memory?.usedJSHeapSize; if (typeof m === 'number') peakHeap = Math.max(peakHeap, m); };
    heap();
    const warnings: string[] = [];
    const processLog: ProcessLog = [];
    // a selection limits every step, the text layer included: pages outside it are never opened
    const requested = parsePageSpec(opts.pages, doc.numPages, warnings);
    const inSel = (p: number) => !requested || requested.includes(p);
    const texts: PageText[] = await readTextLayers(doc as any, requested, processLog, (i, n) => { checkAbort(); onProgress(`อ่านข้อความหน้า ${i}/${n}`, (0.15 * i) / n); });

  phase['text layer'] = performance.now() - tStart;
  const boqDoc = parseBoqPages([...texts, ...(opts.cachedBoqOcr || []).filter(t => inSel(t.page))], fileName);
  const totals = boqTotalsByVariant(boqDoc);
  const boq = boqDoc.lines.length && Object.keys(totals).length
    ? { fileName, variants: Object.keys(totals), structuralByVariant: totals, warnings: boqDoc.warnings, lineCount: boqDoc.lines.length }
    : null;
  const boqPages = new Set(boqDoc.lines.map(l => l.page));
  // one tag in schedules on several pages: rows stay members, and their disagreements are recorded on each
  const scheduleMembers = reconcileScheduleRows(texts.filter(t => !boqPages.has(t.page) && (!requested || requested.includes(t.page))).flatMap(t => scheduleMembersFromPage(t, fileName)));
  const textPages = new Set(texts.filter(t => t.items.map(i => i.str).join('').trim().length >= 40).map(t => t.page));
  const materialText = texts.filter(t => !boqPages.has(t.page)).flatMap(t => t.items.map(i => i.str)).join(' ');

  let ocrPages: PageOcr[] = (opts.cachedOcr || []).filter(o => inSel(o.page));
  const sheetIds: Record<number, string> = {};
  const strokeLettered = new Set<number>();
  let ocrWallMs = 0, ocrLanes = 1;
  const pageMap: { page: number; sheetId?: string; skip: boolean; reason?: string }[] = [];
  if (!ocrPages.length) {
    const textWords = async (p: number) => { const vp = (await doc.getPage(p)).getViewport({ scale: 1 }); return pageTextToOcr(texts[p - 1], vp.width, vp.height).words; };
    for (const p of textPages) {
      if (boqPages.has(p) || (requested ? !requested.includes(p) : !sheetId(await textWords(p))?.startsWith('S'))) continue;
      const pg = await doc.getPage(p);
      processLog.push({ page: p, step: 'stroke-scan' });
      const ops = await pg.getOperatorList();
      if (extractSmallStrokes(ops.fnArray, ops.argsArray, pdfjs.OPS as any, pg.getViewport({ scale: 1 }).transform).small.length >= 200) strokeLettered.add(p);
    }
    const { ocrCandidates: candidates } = partitionDrawingPages(doc.numPages, textPages, strokeLettered, boqPages, requested);
    // pages of these exact bytes already read by this exact reading code come from the cache, not OCR again
    const hits = new Map<number, CachedOcr>();
    for (const p of candidates) { const h = await cachedRead(store(), pageCacheKey(opts.fileSha, p, OCR_ID)); if (h) hits.set(p, h); }
    if (candidates.length) {
      const needOcr = candidates.some(p => !hits.has(p));
      onProgress(needOcr ? 'เตรียม OCR ในเบราว์เซอร์ (โหลดข้อมูลภาษาครั้งแรก)…' : 'ใช้ผล OCR เดิมของไฟล์นี้', 0.18);
      const structuralOnly = !requested;
      const skippedSet = new Set<number>();
      if (structuralOnly) {
        const list = candidates.filter(p => !hits.has(p));
        const tClassify = performance.now();
        if (list.length) {
          const classResults = await classifyPages(
            doc,
            list,
            doc.numPages,
            p => texts[p - 1],
            (i, n) => onProgress(`คัดหน้า ${i}/${n}…`, 0.18 + (0.1 * i) / n),
            opts.abortSignal,
          );
          for (const { page: p, cls, ms } of classResults) {
            pageMap.push({ page: p, sheetId: cls.sheetId, skip: cls.skip, reason: cls.reason });
            if (cls.sheetId) sheetIds[p] = cls.sheetId;
            if (cls.skip) {
              skippedSet.add(p);
              processLog.push({ page: p, step: 'classify' });
              perPage.push({
                page: p,
                how: `skipped (${cls.reason || cls.sheetId || 'not structural'})`,
                ms: Math.round(ms),
                steps: '',
              });
            }
          }
        }
        phase['classify pages'] = performance.now() - tClassify;
      }
      const pages = structuralOnly ? candidates.filter(p => !skippedSet.has(p)) : candidates;
      // pages are read in lanes: one full set of OCR workers per lane, as many lanes as the machine can feed
      const toRead = pages.filter(p => !hits.has(p)).length;
      const laneN = needOcr ? Math.min(laneCount(navigator.hardwareConcurrency, (navigator as any).deviceMemory), toRead) : 0;
      const tw = performance.now();
      const lanesUsed = new Set<number>([0]);
      phase['load OCR engines'] = performance.now() - tw;
      const renderQueue = serialize(); // one scan render at a time; the Paddle worker queues its own reads, so a read overlaps the next page's render
      let started = 0;
      const readPage = async (p: number, laneIdx: number) => {
        checkAbort();
        const page = await doc.getPage(p);
        onProgress(`อ่านหน้า ${p} (${++started}/${pages.length})…`, 0.28 + (0.62 * started) / pages.length);
        // Yield to browser event loop so spinner and progress bar animate smoothly
        await new Promise(r => setTimeout(r, 16));

        const tp = performance.now();
        const steps: Record<string, number> = {};
        const log: ProcessLog = [];
        const rec = (how: string, extra = '') => ({ page: p, how, ms: Math.round(performance.now() - tp), steps: Object.entries(steps).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(', ') + extra });
        const cached = hits.get(p);

        const paddleDetail: string[] = [];
        const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
        const onStats = (k: number, st: any) => paddleDetail.push(`w${k}: init ${sec(st.initMs)}${st.loads > 1 ? ` (models loaded ${st.loads}x)` : ''}, det ${sec(st.detMs)} (${st.detTiles} tiles), rec ${sec(st.recMs)} (${st.recCalls} crops / ${st.boxes} boxes), post ${sec(st.postMs)}, turned pass ${sec(st.turnedMs)}, words ${st.wordsKept}, total ${sec(st.totalMs)}`);
        let r: CachedOcr;
        let how: string;
        if (cached) {
          r = cached;
          log.push({ page: p, step: 'ocr-cache' });
          how = `cache ${r.kind}`;
        } else {
          const isVec = await isVectorTextPage(page as any, pdfjs.OPS as any);
          const lazyWorker = (get: () => Promise<any>) => ({ recognize: async (...a: any[]) => (await get()).recognize(...a) });
          const lane = isVec
            ? { worker: null as any, thai: null as any, turned: [] as any[] }
            : {
                worker: lazyWorker(ocrWorker),
                thai: lazyWorker(drawingThaiWorker),
                turned: [lazyWorker(() => turnedWorkers().then(t => t[0])), lazyWorker(() => turnedWorkers().then(t => t[1]))],
              };
          lanesUsed.add(isVec ? laneIdx : 0);
          // flat side on Paddle worker 0, turned side on worker 1, so the two sides of a page do not queue on one worker
          const gpu = await checkWebGpuAvailability();
          const eng = gpu ? paddleAsEng(0, job => job(), opts.abortSignal) : null;
          const engTurned = gpu ? paddleAsEng(1, job => job(), opts.abortSignal, 'upright') : null;
          const env = {
            worker: eng ?? lane.worker, extraWorkers: [lane.thai], turnedWorkers: engTurned ? [engTurned, lane.turned[1]] : lane.turned, OPS: pdfjs.OPS as any, imagePixels: bitmapPixels,
            rasterizeAsync: rasterizeInWorker,
            vectorLinesAndRasterAsync: (polys: Polyline[], widthPt: number, heightPt: number, scale: number, pen: number) => vectorLinesAndRasterInWorker(laneIdx, polys, widthPt, heightPt, scale, pen),
            toImage: (d: Uint8Array, w: number, h: number) => {
              // PGM: the same gray pixels tesseract would get from the PNG, without encoding (main thread) and decoding (worker) a PNG for every tile
              const img = new Blob([`P5\n${w} ${h}\n255\n`, d as BlobPart]);
              rasterOf.set(img, { data: d, width: w, height: h } as Raster);
              return img;
            },
            renderPage: (pg: PdfJsPage, _scale: number, rot: boolean, prepared: boolean) => renderQueue(() => renderForOcr(pg, 300 / 72, rot, prepared)),
            readScan: (rs: Raster) => readScan(rs, onStats, opts.abortSignal),
            readVectorLines: async (rs: Raster, jobs: { box: number[]; turned: boolean }[]) => {
              const wk = gpu ? 0 : (laneIdx % Math.max(2, laneN));
              const tPad = performance.now();
              const res = await readBand(wk, rs, 'flat', onStats, gpu, opts.abortSignal, jobs);
              steps['paddle'] = (steps['paddle'] || 0) + (performance.now() - tPad);
              return mergeVectorOcr(res.words, res.lines, jobs, rs, async () => [], async thaiJobs => {
                const tTh = performance.now();
                const thaiWk = gpu ? 1 : wk;
                const tr = await readBand(thaiWk, rs, 'flat', onStats, false, opts.abortSignal, thaiJobs, 'thai');
                steps['thai_ot2'] = (steps['thai_ot2'] || 0) + (performance.now() - tTh);
                return tr.words;
              });
            },
            onTime: (step: string, ms: number) => { steps[step] = (steps[step] || 0) + ms; },
          };
          r = await ocrPdfPage(page as any, p, env as any);
          log.push({ page: p, step: 'ocr' });
          how = `OCR ${r.kind}`;
          // stored as OCR gave it, before the text-layer words are added below
          await cacheWrite(store(), pageCacheKey(opts.fileSha, p, OCR_ID), r);
        }
        heap();
        const note = rec(how, paddleDetail.length ? ` || paddle ${paddleDetail.join(' ; ')}` : '');
        if (textPages.has(p)) r.words.push(...await textWords(p));
        const id = sheetId(r.words);
        if (id) sheetIds[p] = id;
        if (structuralOnly && id && /^(A|EE|E|SN|ID|L)-/i.test(id)) return { log, rec: note, out: null };
        return { log, rec: note, out: r };
      };
      const tOcr = performance.now();
      const done = await raceAbort(mapLanes(pages, Math.max(1, laneN), (p, _k, lane) => readPage(p, lane)), opts.abortSignal);
      // whatever finished first, the log and the pages go on in page order: the reading is the same as one page at a time
      for (const d of done) {
        processLog.push(...d.log);
        perPage.push(d.rec);
        if (d.out) ocrPages.push(d.out);
      }
      ocrWallMs = performance.now() - tOcr;
      ocrLanes = lanesUsed.size;
    }
  }

  phase['OCR pages'] = ocrWallMs;
  onProgress('ประกอบผังกับแบบขยาย…', 0.95);
  const tReader = performance.now();
  const { textSheetPages } = partitionDrawingPages(doc.numPages, textPages, strokeLettered, boqPages, requested);
  const textSheetSet = new Set(textSheetPages);
  const textSheets: PageOcr[] = [];
  for (const t of texts) {
    if (!textSheetSet.has(t.page) || ocrPages.some(o => o.page === t.page)) continue;
    const pg = await doc.getPage(t.page);
    processLog.push({ page: t.page, step: 'text-sheet' });
    const vp = pg.getViewport({ scale: 1 });
    textSheets.push({ ...pageTextToOcr(t, vp.width, vp.height), ...await textSheetGeometry(pg) });
  }
  if (!ocrPages.length && !textSheets.length && !scheduleMembers.length && requested?.length !== 0) {
    warnings.push('ไม่พบแผ่นแบบโครงสร้างที่อ่านได้ — ระบุช่วงหน้าแบบโครงสร้างแล้วลองใหม่');
  }
  const { readings, notes } = readSheets([...ocrPages, ...textSheets]);
  const merged = mergeSheetReadings(readings, fileName, { ...DEFAULT_MERGE_ASSUMPTIONS, footingVariant: opts.footingVariant ?? 'แผ่' });
  phase['reader + merge'] = performance.now() - tReader;
  phase.total = performance.now() - tStart;
  console.groupCollapsed(`[StructBOQ timing] ${fileName}: ${(phase.total / 1000).toFixed(1)} s, ${perPage.filter(x => x.how.startsWith('OCR')).length} pages OCR'd in ${ocrLanes} lane(s), ${perPage.filter(x => x.how.startsWith('skipped')).length} skipped${opts.cachedOcr?.length ? ' (cached OCR)' : ''}`);
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
      pageMap,
      extractedNotes,
      materialSpecs,
      processLog,
      requestedPages: requested,
      timing: timingSummary(phase, perPage, peakHeap || null),
    };
  } finally {
    opts.abortSignal?.removeEventListener('abort', onAbort);
  }
}
