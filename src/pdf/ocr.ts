/**
 * Tiled OCR over a grayscale raster with tesseract.js — same code in browser and Node.
 * The caller supplies how to turn a raster into something tesseract accepts
 * (a canvas in the browser, a PNG buffer in Node).
 */
import type { OcrWord } from './types';

export interface Raster { data: Uint8Array; width: number; height: number }

export interface TesseractLike {
  recognize(image: any, options?: any): Promise<{ data: { words: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] } }>;
}

export interface OcrOptions {
  tile?: number;
  overlap?: number;
  minConfidence?: number;
  onProgress?: (done: number, total: number) => void;
  crop?: (rect: { left: number; top: number; width: number; height: number }) => Promise<any>;
}

const iou = (a: OcrWord, b: OcrWord) => {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const u = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return u > 0 ? inter / u : 0;
};

/** Words of a raster, boxes normalized to the raster (0..1). */
export async function ocrRaster(worker: TesseractLike, image: any, width: number, height: number, opts: OcrOptions = {}) {
  const T = opts.tile ?? 2048, O = opts.overlap ?? 200, minConf = opts.minConfidence ?? 30;
  const rects: { left: number; top: number; width: number; height: number }[] = [];
  for (let y = 0; y < Math.max(1, height - O); y += T - O)
    for (let x = 0; x < Math.max(1, width - O); x += T - O)
      rects.push({ left: x, top: y, width: Math.min(T, width - x), height: Math.min(T, height - y) });
  const words: { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  let done = 0;
  for (const rectangle of rects) {
    const { data } = opts.crop
      ? await worker.recognize(await opts.crop(rectangle))
      : await worker.recognize(image, { rectangle });
    const dx = opts.crop ? rectangle.left : 0, dy = opts.crop ? rectangle.top : 0;
    for (const w of data.words) {
      if (w.confidence < minConf || !/[A-Za-z0-9]/.test(w.text)) continue;
      words.push({ text: w.text, conf: w.confidence, x0: (w.bbox.x0 + dx) / width, y0: (w.bbox.y0 + dy) / height, x1: (w.bbox.x1 + dx) / width, y1: (w.bbox.y1 + dy) / height });
    }
    opts.onProgress?.(++done, rects.length);
  }
  return words;
}

/** Map words read on the 90°-clockwise-rotated raster back to page coordinates. */
export function unrotate(words: { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }[]): OcrWord[] {
  return words.map(w => ({ text: w.text, conf: w.conf, x0: w.y0, x1: w.y1, y0: 1 - w.x1, y1: 1 - w.x0, vertical: true }));
}

/** Keep one reading per location (tiles overlap); prefer higher confidence, then longer text. */
export function dedupeWords(words: OcrWord[]): OcrWord[] {
  const sorted = [...words].sort((a, b) => b.conf - a.conf || b.text.length - a.text.length);
  const kept: OcrWord[] = [];
  for (const w of sorted) if (!kept.some(k => iou(w, k) > 0.3)) kept.push(w);
  return kept;
}
