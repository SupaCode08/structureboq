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
import { grayPng } from './png.ts';
import { embeddedImage } from './scanImage.ts';
import * as ort from 'onnxruntime-web';
import { loadPaddle, paddleWords } from '../src/pdf/paddleOcr.ts';
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
const extra = [];
for (const lang of (process.env.OCR_EXTRA ?? 'tha+eng').split(',').filter(Boolean)) {
  const w = await Tesseract.createWorker(lang);
  await w.setParameters({ tessedit_pageseg_mode: '11' as any });
  extra.push(w);
}
const M = 'node_modules/@gutenye/ocr-models/assets/';
const paddle = process.env.PADDLE === '0' ? undefined
  : await loadPaddle(ort, fs.readFileSync(M + 'ch_PP-OCRv4_det_infer.onnx'), fs.readFileSync(M + 'ch_PP-OCRv4_rec_infer.onnx'), fs.readFileSync(M + 'ppocr_keys_v1.txt', 'utf8'));
const results = [];
for (const p of parsePages(spec)) {
  const page = await doc.getPage(p);
  const t0 = Date.now();
  const r = await ocrPdfPage(page as any, p, {
    worker: worker as any, extraWorkers: extra as any, labelWorkers: labelWorkers as any, tilesToo: !!process.env.TILES_TOO, OPS: OPS as any,
    toImage: (d, w, h) => grayPng(d, w, h),
    renderPage: (pg, _scale, rot, prepared) => embeddedImage(pg, rot, prepared),
    readScan: paddle && (r => paddleWords(paddle, r)),
  }, Number(process.env.OCR_DPI || 300) / 72);
  console.log(`p${p} ${r.kind} strokes=${r.smallStrokes} words=${r.words.length} ${Date.now() - t0}ms`);
  results.push(r);
}
await worker.terminate();
for (const w of [...extra, ...labelWorkers]) await w.terminate();
fs.writeFileSync(out, JSON.stringify({ source: pdf, engine: paddle ? 'paddleocr + tesseract.js (offline)' : 'tesseract.js (offline)', extractedAt: new Date().toISOString(), pages: results }, null, 1));
console.log('saved', out);
