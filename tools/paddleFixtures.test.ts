/**
 * Production paddleWords on the 6 saved page rasters vs their fixtures (text, confidence, box, orientation).
 * Rasters (<set>_p<page>.gray.gz) are the browser renderForOcr output, gzip of the 8-bit gray pixels;
 * size is the fixture's "raster". Bands as in the fixtures: 2 bands, 200 px overlap (readScan).
 * Runs the OCR models (about a minute or two), so it is not part of `npm test`:  npm run test:paddle
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import zlib from 'zlib';
import * as ort from 'onnxruntime-web';
import { loadPaddle, paddleWords } from '../src/pdf/paddleOcr.ts';
import { compareWords, summarize, type Word } from './compareWords.ts';

ort.env.wasm.numThreads = 1; // as in paddleWorker.ts and the turned-check page
const DIR = 'src/pdf/fixtures/turned/', M = 'node_modules/@gutenye/ocr-models/assets/';
const PAGES = ['thaisuk_1_p9', 'thaisuk_1_p10', 'house_ready_3_p25', 'house_ready_3_p34', 'cdc_1_p18', 'cdc_1_p22'];
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const paddle = loadPaddle(ort, fs.readFileSync(M + 'ch_PP-OCRv4_det_infer.onnx'), fs.readFileSync(M + 'ch_PP-OCRv4_rec_infer.onnx'), fs.readFileSync(M + 'ppocr_keys_v1.txt', 'utf8'));

for (const name of PAGES) {
  test(`${name}: paddleWords matches the fixture`, async () => {
    const fx = JSON.parse(fs.readFileSync(DIR + name + '.json', 'utf8'));
    const [width, height] = fx.raster;
    const data = new Uint8Array(zlib.gunzipSync(fs.readFileSync(DIR + name + '.gray.gz')));
    assert.equal(data.length, width * height, 'raster size');
    const p = await paddle, n = 2, step = Math.ceil(height / n), over = 200, words: Word[] = [];
    for (let k = 0; k < n; k++) {
      const y0 = Math.max(0, k * step - over), y1 = Math.min(height, (k + 1) * step + over);
      const ws = await paddleWords(p, { data: data.slice(y0 * width, y1 * width), width, height: y1 - y0 });
      words.push(...ws.map(w => [k, w.text, w.conf, r6(w.x0), r6(w.y0), r6(w.x1), r6(w.y1), w.vertical ? 1 : 0] as Word));
    }
    const d = compareWords(fx.words, words);
    assert.ok(d.identical, `${name}: ${summarize(d)}`);
  });
}
