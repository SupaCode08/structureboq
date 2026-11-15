/**
 * Offline (no API) reading of drawing sheets, same code path as the browser:
 * pdf.js operator list -> lettering strokes -> raster -> tesseract.js. Caches words per page.
 *
 *   npx tsx scripts/offline_ocr.ts <pdf> <pages e.g. 16,24-36> <out.json>
 *
 * Scanned pages need a page render; in Node the embedded page image is used directly.
 */
import fs from 'fs';
import Tesseract from 'tesseract.js';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ocrPdfPage } from '../src/pdf/pdfOcrPipeline.ts';
import { embeddedImage } from './scanImage.ts';
import * as ort from 'onnxruntime-web';
import { loadPaddle, paddleWords, paddleWordsFromBoxes } from '../src/pdf/paddleOcr.ts';
import { mergeVectorOcr } from '../src/pdf/labelOcr.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('offline_ocr.ts');

function parsePages(spec: string): number[] {
  return spec.split(',').flatMap(p => { const [a, b] = p.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
}

const [pdf, spec, out] = process.argv.slice(2);
if (!pdf || !spec || !out) { console.error('usage: tsx scripts/offline_ocr.ts <pdf> <pages> <out.json>'); process.exit(1); }
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), disableFontFace: true }).promise;
const worker = await Tesseract.createWorker('eng');
// psm 6 like ocrWorker in browserPipeline.ts: the words come out identical to the app's (checked page by page, 2026-11-06).
// OCR_ENG_PSM=11 is what this script used before that date.
await worker.setParameters({ tessedit_pageseg_mode: (process.env.OCR_ENG_PSM ?? '6') as any });
const labelWorkers = [];
if (process.env.LABELS === '1') for (const lang of ['eng', 'tha+eng']) {
  const w = await Tesseract.createWorker(lang);
  await w.setParameters({ tessedit_pageseg_mode: '7' as any });
  labelWorkers.push(w);
}
const extra: Tesseract.Worker[] = [];
for (const lang of (process.env.OCR_EXTRA ?? 'tha+eng').split(',').filter(Boolean)) {
  const w = await Tesseract.createWorker(lang);
  await w.setParameters({ tessedit_pageseg_mode: '11' as any });
  extra.push(w);
}
const M = 'node_modules/@gutenye/ocr-models/assets/';
const paddle = process.env.PADDLE === '0' ? undefined
  : await loadPaddle(ort, fs.readFileSync(M + 'ch_PP-OCRv4_det_infer.onnx'), fs.readFileSync(M + 'ch_PP-OCRv4_rec_infer.onnx'), fs.readFileSync(M + 'ppocr_keys_v1.txt', 'utf8'));
// like the app with WebGPU (paddleAsEng in browserPipeline.ts): Paddle reads the vector raster in place of tesseract eng; VECTOR_PADDLE=0 or PADDLE=0 reads it with tesseract eng (the app without WebGPU)
const rasters = new WeakMap<object, { data: Uint8Array; width: number; height: number }>();
const paddleEng = paddle && process.env.VECTOR_PADDLE !== '0' ? {
  recognize: async (img: object, o?: { rectangle?: { left: number; top: number } }) => {
    if (o?.rectangle?.left || o?.rectangle?.top) return { data: { words: [] } }; // the whole raster is read on the first tile
    const r = rasters.get(img)!;
    const ws = await paddleWords(paddle, r, undefined, 'flat');
    return { data: { words: ws.map(w => ({ text: w.text, confidence: w.conf, bbox: { x0: w.x0 * r.width, y0: w.y0 * r.height, x1: w.x1 * r.width, y1: w.y1 * r.height } })) } };
  },
} : undefined;
const paddleEngTurned = paddle && process.env.VECTOR_PADDLE !== '0' ? {
  recognize: async (img: object, o?: { rectangle?: { left: number; top: number } }) => {
    if (o?.rectangle?.left || o?.rectangle?.top) return { data: { words: [] } }; // the whole raster is read on the first tile
    const r = rasters.get(img)!;
    const ws = await paddleWords(paddle, r, undefined, 'upright');
    return { data: { words: ws.map(w => ({ text: w.text, confidence: w.conf, bbox: { x0: w.x0 * r.width, y0: w.y0 * r.height, x1: w.x1 * r.width, y1: w.y1 * r.height } })) } };
  },
} : undefined;
// shortcut: B1 spike (EXTRA_FLAT_ONLY=1: tha+eng skips the turned raster, told apart as the portrait one; wrong on portrait sheets), measure only
const extraFlat = process.env.EXTRA_FLAT_ONLY === '1' ? extra.map(w => ({
  recognize: (img: object, o?: object) => { const r = rasters.get(img); return r && r.height > r.width ? Promise.resolve({ data: { words: [] } }) : w.recognize(img as any, o as any); },
})) : extra;
const results = [];
for (const p of parsePages(spec)) {
  const page = await doc.getPage(p);
  const t0 = Date.now();
  const r = await ocrPdfPage(page as any, p, {
    worker: (paddleEng ?? worker) as any, extraWorkers: extraFlat as any, turnedWorkers: paddleEng ? [paddleEngTurned, ...extraFlat] as any : undefined, labelWorkers: labelWorkers as any, tilesToo: !!process.env.TILES_TOO,
    OPS: OPS as any,
    // same as the app, the same gray pixels without PNG encoding
    toImage: (d, w, h) => { const img = Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`), Buffer.from(d.buffer, d.byteOffset, d.byteLength)]); rasters.set(img, { data: d, width: w, height: h }); return img; },
    renderPage: (pg, _scale, rot, prepared) => embeddedImage(pg, rot, prepared),
    readScan: paddle && (r => paddleWords(paddle, r)),
    readVectorLines: paddle && process.env.VECTOR_PADDLE !== '0' ? async (rs, jobs) => {
      const res = await paddleWordsFromBoxes(paddle, rs, jobs);
      if (!extra[0]) return res.words;
      return mergeVectorOcr(res.words, res.lines, jobs, rs, async strip => {
        const pgm = Buffer.concat([Buffer.from(`P5\n${strip.width} ${strip.height}\n255\n`), Buffer.from(strip.data)]);
        const tres = await extra[0].recognize(pgm);
        return (tres?.data as any)?.words || [];
      });
    } : undefined,
  }, Number(process.env.OCR_DPI || 300) / 72);
  console.log(`p${p} ${r.kind} strokes=${r.smallStrokes} words=${r.words.length} ${Date.now() - t0}ms`);
  results.push(r);
}
await worker.terminate();
for (const w of [...extra, ...labelWorkers] as any[]) await w.terminate?.();
fs.writeFileSync(out, JSON.stringify({ source: pdf, engine: paddle ? 'paddleocr + tesseract.js (offline)' : 'tesseract.js (offline)', extractedAt: new Date().toISOString(), pages: results }, null, 1));
console.log('saved', out);
