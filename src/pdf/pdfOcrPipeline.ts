/**
 * Per-page offline reading of a drawing PDF with pdf.js + tesseract.js.
 * Environment-specific bits (how to hand a raster or an embedded image to tesseract)
 * are injected, so the browser and the Node benchmark run identical logic.
 */
import type { OcrWord, PageOcr } from './types';
import { extractSmallStrokes, rasterize, pageGeometry, type OpsTable } from './vectorText';
import { ocrRaster, unrotate, dedupeWords, type TesseractLike } from './ocr';
import { ocrLabels } from './labelOcr';
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
  const h: [number, number, number][] = lines.h.map(([x0, x1, y]) => {
    const [ax, ay] = turn(x0, y), [bx, by] = turn(x1, y);
    return [Math.min(ax, bx), Math.max(ax, bx), (ay + by) / 2];
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

  if (strokes.small.length >= 200) {
    kind = 'vector_text';
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
        const r = rasterize(strokes.small, vp.width, vp.height, scale, 3, rot);
        const img = await env.toImage(r.data, r.width, r.height);
        clock(`rasterize ${rot ? 'v' : 'h'}`, t0);
        const per = await Promise.all(wks.map(async (wk, i) => {
          const t1 = performance.now();
          const ws = await ocrRaster(wk, img, r.width, r.height);
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
        const wp = await ocrRaster(env.worker, prep.image, prep.width, prep.height);
        clock(`ocr scan ${rot ? 'v' : 'h'}`, t);
        if (prep.image && typeof prep.image.width === 'number') {
          prep.image.width = 0; prep.image.height = 0;
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
            const wr = await ocrRaster(env.worker, raw.image, raw.width, raw.height);
            clock(`ocr raw ${rot ? 'v' : 'h'}`, t);
            if (raw.image && typeof raw.image.width === 'number') {
              raw.image.width = 0; raw.image.height = 0;
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
  if (kind === 'vector_text') words = withGlyphWords(words, glyphWords(strokes.small, vp.width, vp.height, words));
  clock('glyphs', t);
  t = performance.now();
  const { rects, hsegs, vsegs, circles } = pageGeometry(strokes, vp.width, vp.height);
  if (kind === 'vector_text' && strokes.imageCount) rects.push(...await imageBoxesOnPage(page, env.OPS, env.imagePixels, ops));
  clock('geometry', t);
  return { page: pageNo, width: vp.width, height: vp.height, words: dedupeWords(words), rects, hsegs: kind === 'raster' && scanLines ? scanLines.h : hsegs, vsegs: kind === 'raster' && scanLines ? scanLines.v : vsegs, circles: kind === 'raster' && scanCircles ? scanCircles : circles, kind, smallStrokes: strokes.small.length };
}

/** Sheet number from the title block, e.g. "S-04" (bottom-right corner of Thai drawing sheets). */
export function sheetId(words: OcrWord[]): string | undefined {
  const cand = words.filter(w => w.x0 > 0.8 && w.y0 > 0.8).map(w => w.text.replace(/[—–]/g, '-').toUpperCase()).find(t => /^[A-Z]{1,2}-?\d{2}$/.test(t));
  return cand?.replace(/^([A-Z]{1,2})-?/, '$1-');
}

