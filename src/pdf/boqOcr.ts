/**
 * BOQ (ปร.4) pages whose Thai text is drawn as outlines (no text layer): render only the lettering,
 * read it with Thai+English OCR, and hand the words to the normal ปร.4 parser as a PageText.
 *
 * Same code in the browser and in Node (benchmark cache); the environment supplies the OCR worker
 * and how to turn a raster into an image tesseract accepts.
 */
import type { PageText, TextItem } from './types';
import { extractSmallStrokes, rasterize, type OpsTable } from './vectorText';
import type { PdfJsPage } from './pdfOcrPipeline';

export interface ThaiOcrWorker {
  recognize(image: any): Promise<{ data: { confidence: number; words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>;
}

export interface BoqOcrEnv {
  /** worker created with 'tha+eng', page segmentation 6, preserve_interword_spaces 1 */
  worker: ThaiOcrWorker;
  OPS: OpsTable;
  toImage(data: Uint8Array, width: number, height: number): Promise<any> | any;
}

const DPI = 200;

/** Thai OCR writes sara am as nikhahit + sara aa; the parser expects the composed letter. */
export const normalizeThaiOcr = (s: string) => s.replace(/ํา/g, 'ำ').replace(/ํ\s+า/g, 'ำ').trim();

type Turn = 0 | 90 | 270;

/** Raster of the lettering turned so text reads left-to-right; 90 = clockwise. */
function turned(small: ReturnType<typeof extractSmallStrokes>['small'], w: number, h: number, turn: Turn) {
  const r = rasterize(small, w, h, DPI / 72, 1, turn !== 0);
  return turn === 270 ? { ...r, data: Uint8Array.from(r.data).reverse() } : r;
}

/** Image point (normalized) back to the displayed page (normalized). */
function toPage(turn: Turn, u: number, v: number): [number, number] {
  if (turn === 0) return [u, v];
  if (turn === 90) return [v, 1 - u];
  return [1 - v, u];
}

export interface BoqOcrPage extends PageText { confidence: number; turn: Turn }

type OcrBox = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };

/**
 * Thai is written without spaces, so OCR returns a "word" per glyph (vowels and tone marks stacked
 * above/below as their own boxes). Glyphs that touch on the same line are one word again.
 */
export function mergeThaiGlyphs(words: OcrBox[]): OcrBox[] {
  const out: OcrBox[] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last) {
      const h = Math.max(last.bbox.y1 - last.bbox.y0, w.bbox.y1 - w.bbox.y0, 1);
      const overlapY = Math.min(last.bbox.y1, w.bbox.y1) - Math.max(last.bbox.y0, w.bbox.y0);
      const gap = w.bbox.x0 - last.bbox.x1;
      const thai = /[฀-๿]/.test(w.text) || /[฀-๿]$/.test(last.text);
      if (thai && overlapY > -0.2 * h && gap < 0.6 * h && w.bbox.x1 > last.bbox.x0) {
        out[out.length - 1] = {
          text: last.text + w.text,
          confidence: Math.min(last.confidence, w.confidence),
          bbox: { x0: Math.min(last.bbox.x0, w.bbox.x0), y0: Math.min(last.bbox.y0, w.bbox.y0), x1: Math.max(last.bbox.x1, w.bbox.x1), y1: Math.max(last.bbox.y1, w.bbox.y1) },
        };
        continue;
      }
    }
    out.push({ ...w, bbox: { ...w.bbox } });
  }
  return out;
}

export async function ocrBoqPage(page: PdfJsPage, pageNo: number, env: BoqOcrEnv): Promise<BoqOcrPage | null> {
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const s = extractSmallStrokes(ops.fnArray, ops.argsArray, env.OPS, vp.transform, 12, true);
  if (s.small.length < 200) return null;
  // Most ปร.4 sheets in drawing sets are turned on a landscape page; try that first
  const order: Turn[] = vp.width > vp.height ? [270, 90, 0] : [0, 270, 90];
  let best: { turn: Turn; data: Awaited<ReturnType<ThaiOcrWorker['recognize']>>['data']; w: number; h: number } | null = null;
  for (const turn of order) {
    const r = turned(s.small, vp.width, vp.height, turn);
    const { data } = await env.worker.recognize(await env.toImage(r.data, r.width, r.height));
    if (!best || data.confidence > best.data.confidence) best = { turn, data, w: r.width, h: r.height };
    if (data.confidence >= 75) break;
  }
  if (!best) return null;
  const k = 72 / DPI; // raster px -> pt in the upright frame
  const items: TextItem[] = mergeThaiGlyphs(best.data.words.filter(w => w.confidence >= 30 && w.text.trim()))
    .map(w => {
      const [a0, a1] = toPage(best!.turn, w.bbox.x0 / best!.w, w.bbox.y0 / best!.h);
      const [b0, b1] = toPage(best!.turn, w.bbox.x1 / best!.w, w.bbox.y1 / best!.h);
      return {
        str: normalizeThaiOcr(w.text),
        x0: w.bbox.x0 * k, x1: w.bbox.x1 * k, y0: w.bbox.y0 * k, y1: w.bbox.y1 * k,
        nb: [Math.min(a0, b0), Math.min(a1, b1), Math.max(a0, b0), Math.max(a1, b1)] as [number, number, number, number],
      };
    })
    .filter(i => i.str);
  return { page: pageNo, width: best.w * k, height: best.h * k, items, legacyFont: false, ocr: true, rowTolerance: 7, confidence: best.data.confidence, turn: best.turn };
}
