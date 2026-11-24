/**
 * Per-page offline reading of a drawing PDF with pdf.js + tesseract.js.
 * Environment-specific bits (how to hand a raster or an embedded image to tesseract)
 * are injected, so the browser and the Node benchmark run identical logic.
 */
import type { OcrWord, PageOcr } from './types';
import { extractSmallStrokes, rasterize, pageGeometry, type OpsTable, type Polyline } from './vectorText';
import { ocrRaster, unrotate, dedupeWords, type TesseractLike } from './ocr';
import { filterTitleBlockBoilerplate, ocrLabels, vectorTextLines } from './labelOcr';
import { glyphWords, withGlyphWords } from './glyphRead';
import { imageBoxesOnPage, type PdfImage } from './imageBoxes';
import type { Raster } from './ocr';

export interface PdfJsPage {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: any[] }>;
  rotate?: number;
  objs?: { get(name: string, cb: (v: any) => void): void };
  commonObjs?: { get(name: string, cb: (v: any) => void): void };
}

export interface OcrEnv {
  worker: TesseractLike;
  /** more engines read vector lettering (e.g. 'tha+eng': mixed Thai/Latin labels such as "5+5ø12มม."
   *  that the Latin model alone breaks up); every reading is kept, the surer one wins. Not used on scans. */
  extraWorkers?: TesseractLike[];
  /** a second set of [worker, ...extraWorkers] (same engines, same order) for the turned raster: with it
   *  all vector passes run at once; without it they run one after another. Words keep the same order. */
  turnedWorkers?: TesseractLike[];
  OPS: OpsTable;
  /** grayscale raster -> image accepted by tesseract (canvas / PNG buffer) */
  toImage(data: Uint8Array, width: number, height: number): Promise<any> | any;
  /** rasterize off the main thread (browser worker); same result as rasterize() */
  rasterizeAsync?(polys: Polyline[], widthPt: number, heightPt: number, scale: number, pen: number, rotate: boolean): Promise<Raster>;
  vectorLinesAndRasterAsync?(polys: Polyline[], widthPt: number, heightPt: number, scale: number, pen: number): Promise<{ raster: Raster; lines: ReturnType<typeof vectorTextLines> }>;
  /** full page render for scanned pages (browser canvas); null when unavailable */
  /** prepared = binarized, deskewed, lines removed; returns the skew it corrected (degrees) */
  renderPage?(page: PdfJsPage, scale: number, rotate90: boolean, prepared: boolean): Promise<{ image: any; width: number; height: number; raster?: Raster; skew?: number; lines?: { h: [number, number, number][]; v: [number, number, number][] }; circles?: [number, number, number][] } | null>;
  /** single-line engines (page segmentation 7): vector lettering is read one label at a time
   *  (see labelOcr.ts) instead of in sheet tiles */
  labelWorkers?: TesseractLike[];
  /** with labelWorkers: also read the sheet in tiles and keep both readings */
  tilesToo?: boolean;
  /** largest lettering kept as text, points (default 15; bold detail titles run ~18 pt) */
  maxLetterPt?: number;
  /** pixels of an image object that arrived without them (browser: an ImageBitmap) */
  imagePixels?(img: any): Promise<PdfImage | null> | PdfImage | null;
  /** one-pass scan reader (PaddleOCR, paddleOcr.ts) used instead of the tesseract passes; words normalized to the raster */
  readScan?(raster: Raster): Promise<OcrWord[]>;
  /** fast vector-line reader: recognizes pre-located text-line boxes directly without full-page detection */
  readVectorLines?(raster: Raster, jobs: { box: number[]; turned: boolean }[], scale: number): Promise<OcrWord[]>;
  onProgress?(msg: string): void;
  /** timing only: milliseconds spent in one step of reading this page (no effect on the result) */
  onTime?(step: string, ms: number): void;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
/** Boxes read on the raw scan, moved into the deskewed frame the scan's lines and circles live in. */
function deskewed<T extends Box>(words: T[], skewDeg: number, W: number, H: number): T[] {
  const sk = (skewDeg * Math.PI) / 180;
  if (!sk) return words;
  const turn = (x: number, y: number) => {
    const dx = (x - 0.5) * W, dy = (y - 0.5) * H;
    return [(Math.cos(sk) * dx + Math.sin(sk) * dy + W / 2) / W, (-Math.sin(sk) * dx + Math.cos(sk) * dy + H / 2) / H];
  };
  return words.map(w => {
    const [ax, ay] = turn(w.x0, w.y0), [bx, by] = turn(w.x1, w.y1);
    const [cx, cy] = turn(w.x0, w.y1), [dx, dy] = turn(w.x1, w.y0);
    return { ...w, x0: Math.min(ax, bx, cx, dx), y0: Math.min(ay, by, cy, dy), x1: Math.max(ax, bx, cx, dx), y1: Math.max(ay, by, cy, dy) };
  });
}

function deskewLines(lines: { h: [number, number, number][]; v: [number, number, number][] }, skewDeg: number, W: number, H: number) {
  const sk = (skewDeg * Math.PI) / 180;
  if (!sk) return lines;
  const turn = (x: number, y: number) => {
    const dx = (x - 0.5) * W, dy = (y - 0.5) * H;
    return [(Math.cos(sk) * dx + Math.sin(sk) * dy + W / 2) / W, (-Math.sin(sk) * dx + Math.cos(sk) * dy + H / 2) / H];
  };
  const h: [number, number, number][] = lines.h.map(([x0, y, x1]) => {
    const [ax, ay] = turn(x0, y), [bx, by] = turn(x1, y);
    return [Math.min(ax, bx), (ay + by) / 2, Math.max(ax, bx)];
  });
  const v: [number, number, number][] = lines.v.map(([x, y0, y1]) => {
    const [ax, ay] = turn(x, y0), [bx, by] = turn(x, y1);
    return [(ax + bx) / 2, Math.min(ay, by), Math.max(ay, by)];
  });
  return { h, v };
}

function deskewCircles(circles: [number, number, number][], skewDeg: number, W: number, H: number): [number, number, number][] {
  const sk = (skewDeg * Math.PI) / 180;
  if (!sk) return circles;
  const turn = (x: number, y: number) => {
    const dx = (x - 0.5) * W, dy = (y - 0.5) * H;
    return [(Math.cos(sk) * dx + Math.sin(sk) * dy + W / 2) / W, (-Math.sin(sk) * dx + Math.cos(sk) * dy + H / 2) / H];
  };
  return circles.map(([x, y, r]) => {
    const [cx, cy] = turn(x, y);
    return [cx, cy, r];
  });
}

export type PageKind = 'vector_text' | 'raster' | 'blank';

/** a page with this many lettering strokes is read as vector text, otherwise as a scan or image */
const VECTOR_TEXT_MIN_STROKES = 200;
export async function isVectorTextPage(page: PdfJsPage, OPS: OpsTable, maxLetterPt = 15): Promise<boolean> {
  const ops = await page.getOperatorList();
  return extractSmallStrokes(ops.fnArray, ops.argsArray, OPS, page.getViewport({ scale: 1 }).transform, maxLetterPt).small.length >= VECTOR_TEXT_MIN_STROKES;
}

export async function ocrPdfPage(page: PdfJsPage, pageNo: number, env: OcrEnv, scale = 300 / 72): Promise<PageOcr & { kind: PageKind; smallStrokes: number }> {
  const vp = page.getViewport({ scale: 1 });
  const clock = (step: string, t0: number) => env.onTime?.(step, performance.now() - t0);
  let t = performance.now();
  const ops = await page.getOperatorList();
  const strokes = extractSmallStrokes(ops.fnArray, ops.argsArray, env.OPS, vp.transform, env.maxLetterPt ?? 15);
  let words: OcrWord[] = [];
  let scanLines: { h: [number, number, number][]; v: [number, number, number][] } | undefined;
  let scanCircles: [number, number, number][] | undefined;
  let kind: PageKind = 'blank';
  clock('strokes', t);

  if (strokes.small.length >= VECTOR_TEXT_MIN_STROKES) {
    kind = 'vector_text';
    if (env.readVectorLines) {
      env.onProgress?.(`หน้า ${pageNo}: อ่านตัวอักษรเวกเตอร์แบบเร็ว`);
      const t0 = performance.now();
      const { raster: r, lines } = env.vectorLinesAndRasterAsync
        ? await env.vectorLinesAndRasterAsync(strokes.small, vp.width, vp.height, scale, 3)
        : {
            lines: filterTitleBlockBoilerplate(vectorTextLines(strokes.small), vp.width, vp.height),
            raster: env.rasterizeAsync
              ? await env.rasterizeAsync(strokes.small, vp.width, vp.height, scale, 3, false)
              : rasterize(strokes.small, vp.width, vp.height, scale, 3, false),
          };
      const padPx = 6;
      const jobs = lines.map(L => ({
        box: [
          Math.max(0, Math.floor(L.box.x0 * scale) - padPx),
          Math.max(0, Math.floor(L.box.y0 * scale) - padPx),
          Math.min(r.width, Math.ceil(L.box.x1 * scale) + padPx),
          Math.min(r.height, Math.ceil(L.box.y1 * scale) + padPx),
        ],
        turned: L.vertical,
      }));
      clock('rasterize lines', t0);
      const t1 = performance.now();
      words.push(...await env.readVectorLines(r, jobs, scale));
      clock('ocr lines', t1);
    } else {
      if (env.labelWorkers?.length) {
        env.onProgress?.(`หน้า ${pageNo}: อ่านตัวอักษรทีละป้าย`);
        words.push(...await ocrLabels(strokes.small, vp.width, vp.height, { workers: env.labelWorkers, toImage: env.toImage }));
      }
      if (!env.labelWorkers?.length || env.tilesToo) {
      const engines = [env.worker, ...(env.extraWorkers || [])];
      const turned = env.turnedWorkers?.length === engines.length ? env.turnedWorkers : null;
      // one raster: every engine on it (at once when each engine is its own worker)
      const readSide = async (rot: boolean, wks: TesseractLike[]) => {
        env.onProgress?.(`หน้า ${pageNo}: อ่านตัวอักษรเวกเตอร์${rot ? ' (แนวตั้ง)' : ''}`);
        const t0 = performance.now();
        const r = env.rasterizeAsync
          ? await env.rasterizeAsync(strokes.small, vp.width, vp.height, scale, 3, rot)
          : rasterize(strokes.small, vp.width, vp.height, scale, 3, rot);
        const img = await env.toImage(r.data, r.width, r.height);
        clock(`rasterize ${rot ? 'v' : 'h'}`, t0);
        const crop = async (rect: { left: number; top: number; width: number; height: number }) => {
          const tile = new Uint8Array(rect.width * rect.height);
          for (let row = 0; row < rect.height; row++) {
            const src = (rect.top + row) * r.width + rect.left;
            tile.set(r.data.subarray(src, src + rect.width), row * rect.width);
          }
          return env.toImage(tile, rect.width, rect.height);
        };
        const per = await Promise.all(wks.map(async (wk, i) => {
          const t1 = performance.now();
          const ws = await ocrRaster(wk, img, r.width, r.height, i > 0 ? { crop } : undefined);
          clock(`ocr ${i ? 'extra' : 'eng'} ${rot ? 'v' : 'h'}`, t1);
          return rot ? unrotate(ws) : ws.map(w => ({ ...w, vertical: false }));
        }));
        return per.flat();
      };
      // same word order as reading flat then turned: eng h, extra h, eng v, extra v
      const sides = turned ? await Promise.all([readSide(false, engines), readSide(true, turned)])
        : [await readSide(false, engines), await readSide(true, engines)];
      words.push(...sides.flat());
    }
    }
  } else if (strokes.imageCount > 0 && env.renderPage) {
    kind = 'raster';
    const readOnce = async () => {
      env.onProgress?.(`หน้า ${pageNo}: OCR ภาพสแกน`);
      t = performance.now();
      const prep = await env.renderPage!(page, scale, false, true);
      clock('render scan', t);
      if (!prep?.raster) return false;
      t = performance.now();
      let ws = await env.readScan!(prep.raster);
      clock('paddle', t);
      if (!ws || ws.length < 5) return false;
      if (prep.skew) {
        ws = deskewed(ws, prep.skew, prep.width, prep.height);
        if (prep.lines) scanLines = deskewLines(prep.lines, prep.skew, prep.width, prep.height);
        if (prep.circles) scanCircles = deskewCircles(prep.circles, prep.skew, prep.width, prep.height);
      } else {
        scanLines = prep.lines;
        scanCircles = prep.circles;
      }
      words.push(...ws);
      return true;
    };
    const done = env.readScan && await readOnce().catch(e => { console.warn('PaddleOCR failed, page read with tesseract', e); env.onProgress?.(`หน้า ${pageNo}: PaddleOCR ใช้ไม่ได้ (${e}) — อ่านด้วย tesseract`); return false; });
    if (!done) {
      let needsRot = true;
      for (const rot of [false, true]) {
        if (rot && !needsRot) break;
        env.onProgress?.(`หน้า ${pageNo}: OCR ภาพสแกน${rot ? ' (แนวตั้ง)' : ''}`);
        t = performance.now();
        const prep = await env.renderPage(page, scale, rot, true);
        clock(`render scan ${rot ? 'v' : 'h'}`, t);
        if (!prep) break;
        if (!rot && prep.lines) scanLines = prep.skew ? deskewLines(prep.lines, prep.skew, prep.width, prep.height) : prep.lines;
        if (!rot && prep.circles) scanCircles = prep.skew ? deskewCircles(prep.circles, prep.skew, prep.width, prep.height) : prep.circles;
        t = performance.now();
        const img = prep.image ?? (prep.raster ? await env.toImage(prep.raster.data, prep.width, prep.height) : null);
        const wp = await ocrRaster(env.worker, img, prep.width, prep.height);
        clock(`ocr scan ${rot ? 'v' : 'h'}`, t);
        if (img && typeof img.width === 'number') {
          img.width = 0; img.height = 0;
        }
        const deskewedWp = prep.skew ? deskewed(wp, prep.skew, prep.width, prep.height) : wp;
        words.push(...(rot ? unrotate(deskewedWp) : deskewedWp.map(w => ({ ...w, vertical: false }))));
        if (!rot) {
          // Cross-section and schedule sheets with pure horizontal text do not need rotated OCR
          needsRot = wp.some(w => /(แปลน|ผัง|GRID|AXIS|[A-D]\/\d|\d+\.\d{2})/i.test(w.text)) || wp.length < 15;
        }
        // Only run expensive un-preprocessed raw pass if prepared image failed to yield sufficient words
        if (wp.length < 10) {
          const raw = await env.renderPage(page, scale, rot, false);
          if (raw) {
            t = performance.now();
            const rawImg = raw.image ?? (raw.raster ? await env.toImage(raw.raster.data, raw.width, raw.height) : null);
            const wr = await ocrRaster(env.worker, rawImg, raw.width, raw.height);
            clock(`ocr raw ${rot ? 'v' : 'h'}`, t);
            if (rawImg && typeof rawImg.width === 'number') {
              rawImg.width = 0; rawImg.height = 0;
            }
            words.push(...(rot ? unrotate(wr) : wr.map(w => ({ ...w, vertical: false }))));
          }
        }
      }
    }
  } else if (strokes.imageCount > 0) {
    kind = 'raster';
  }
  t = performance.now();
  if (kind === 'vector_text') words = restoreLeadingOne(withGlyphWords(words, glyphWords(strokes.small, vp.width, vp.height, words)), strokes.small, vp.width, vp.height);
  clock('glyphs', t);
  t = performance.now();
  const { rects, hsegs, vsegs, circles } = pageGeometry(strokes, vp.width, vp.height);
  if (kind === 'vector_text' && strokes.imageCount) rects.push(...await imageBoxesOnPage(page, env.OPS, env.imagePixels, ops));
  clock('geometry', t);
  return { page: pageNo, width: vp.width, height: vp.height, words: dedupeWords(words), rects, hsegs: kind === 'raster' && scanLines ? scanLines.h : hsegs, vsegs: kind === 'raster' && scanLines ? scanLines.v : vsegs, circles: kind === 'raster' && scanCircles ? scanCircles : circles, kind, smallStrokes: strokes.small.length };
}

/**
 * OCR drops a bare "1" (one straight stroke, no serif) in front of a dimension's point: "1.50" comes out ".50", the
 * dimension is rejected and the grid line it measures is lost. Put the "1" back when that stroke is drawn right
 * before the word: across the reading direction, about one letter tall. Vertical words read bottom to top.
 */
export function restoreLeadingOne(words: OcrWord[], small: Polyline[], W: number, H: number): OcrWord[] {
  const bars = small.filter(p => p.length === 2);
  return words.map(w => {
    if (!/^\.\d{2}$/.test(w.text.trim())) return w;
    const v = !!w.vertical;
    const th = v ? (w.x1 - w.x0) * W : (w.y1 - w.y0) * H; // letter height in pt
    const one = bars.find(([[ax, ay], [bx, by]]) => {
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.4 * th || len > 1.3 * th) return false;
      if (v ? Math.abs(ay - by) > 0.3 : Math.abs(ax - bx) > 0.3) return false;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      return v
        ? mx > w.x0 * W && mx < w.x1 * W && my > w.y1 * H - 0.2 * th && my < w.y1 * H + 1.2 * th
        : my > w.y0 * H && my < w.y1 * H && mx < w.x0 * W + 0.2 * th && mx > w.x0 * W - 1.2 * th;
    });
    if (!one) return w;
    const [[ax, ay], [bx, by]] = one;
    return v
      ? { ...w, text: '1' + w.text.trim(), y1: Math.max(w.y1, Math.max(ay, by) / H) }
      : { ...w, text: '1' + w.text.trim(), x0: Math.min(w.x0, Math.min(ax, bx) / W) };
  });
}

/** Sheet number from the title block, e.g. "S-04" (bottom-right corner of Thai drawing sheets). */
export function sheetId(words: OcrWord[]): string | undefined {
  const cand = words.filter(w => w.x0 > 0.8 && w.y0 > 0.8).map(w => w.text.replace(/[—–]/g, '-').toUpperCase()).find(t => /^[A-Z]{1,2}-?\d{2}$/.test(t));
  return cand?.replace(/^([A-Z]{1,2})-?/, '$1-');
}

/**
 * Parses a user-supplied page specification (e.g. "1, 3, 5-8") against a document with `max` pages.
 * - Empty / whitespace input returns `undefined` (preserving automatic structural-only detection).
 * - Non-empty input returns a sorted deduplicated array of valid 1-based page numbers (`[]` if none valid)
 *   and appends human-readable Thai warnings to `warnings` for reversed ranges, invalid tokens, or out-of-range pages.
 */
export function parsePageSpec(spec: string | undefined, max: number, warnings?: string[]): number[] | undefined {
  if (!spec?.trim()) return undefined;
  const out: number[] = [];
  const invalid: string[] = [];
  const over: string[] = [];
  for (const raw of spec.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const single = part.match(/^(\d+)$/);
    if (single) {
      const p = Number(single[1]);
      if (p < 1) invalid.push(part);
      else if (p > max) over.push(String(p));
      else out.push(p);
      continue;
    }
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      if (a < 1 || b < 1) {
        invalid.push(part);
        continue;
      }
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (a > b) warnings?.push(`ช่วงหน้า ${part} เรียงย้อนกลับ — ปรับเป็น ${lo}-${hi}`);
      if (lo > max) {
        over.push(lo === hi ? String(lo) : `${lo}-${hi}`);
      } else {
        if (hi > max) over.push(max + 1 === hi ? String(hi) : `${max + 1}-${hi}`);
        const end = Math.min(hi, max);
        for (let p = lo; p <= end; p++) out.push(p);
      }
      continue;
    }
    invalid.push(part);
  }
  if (invalid.length) warnings?.push(`รูปแบบเลขหน้าไม่ถูกต้อง (${invalid.join(', ')}) — ใช้เลขหน้าตั้งแต่ 1 ถึง ${max}`);
  if (over.length) warnings?.push(`หน้า ${over.join(', ')} เกินจำนวนหน้าทั้งหมด (${max} หน้า) — ข้ามหน้าที่เกิน`);
  const valid = [...new Set(out)].sort((x, y) => x - y);
  if (!valid.length) warnings?.push(`ไม่มีเลขหน้าที่ใช้งานได้จากที่ระบุ ("${spec.trim()}") ในไฟล์ ${max} หน้า — กรุณาระบุเลขหน้า 1-${max}`);
  return valid;
}

/**
 * Partitions drawing pages into OCR candidates (scanned or stroke-lettered) and digital text sheets,
 * excluding BOQ (ปร.4) pages and respecting user-requested page numbers when provided.
 */
export function partitionDrawingPages(
  numPages: number,
  textPages: ReadonlySet<number>,
  strokeLettered: ReadonlySet<number>,
  boqPages: ReadonlySet<number>,
  requested?: number[],
): { ocrCandidates: number[]; textSheetPages: number[] } {
  const pool = (requested ?? Array.from({ length: numPages }, (_, i) => i + 1)).filter(p => p >= 1 && p <= numPages && !boqPages.has(p));
  const ocrCandidates = pool.filter(p => !textPages.has(p) || strokeLettered.has(p));
  const textSheetPages = pool.filter(p => textPages.has(p) && !strokeLettered.has(p));
  return { ocrCandidates, textSheetPages };
}


