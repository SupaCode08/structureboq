/**
 * Vector-page OCR (ocrRaster with the browser engines) on saved stroke rasters vs their fixtures:
 * text, confidence, box and pass of every word of the 4 passes (eng / tha+eng, flat / turned).
 * Rasters (<set>_p<page>_h|v.gray.gz) and fixtures come from tools/vector-capture.html (browser),
 * after two identical runs. Engines as in browserPipeline.ts: ocrWorker eng psm 6, drawingThaiWorker
 * tha+eng psm 11; language data from eng/tha.traineddata in the repo root.
 * Runs Tesseract (a few minutes), so it is not part of `npm test`:  npm run test:vector
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import zlib from 'zlib';
import Tesseract from 'tesseract.js';
import { ocrRaster } from '../src/pdf/ocr.ts';
import { grayPng } from '../scripts/png.ts';
import { compareWords, summarize, type Word } from './compareWords.ts';

const DIR = 'src/pdf/fixtures/vector/';
const PAGES = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const engines = (async () => {
  const eng = await Tesseract.createWorker('eng');
  await eng.setParameters({ tessedit_pageseg_mode: '6' as any });
  const extra = await Tesseract.createWorker('tha+eng');
  await extra.setParameters({ tessedit_pageseg_mode: '11' as any });
  return [eng, extra];
})();
after(async () => { for (const w of await engines) await w.terminate(); });

test('vector fixtures are present', () => assert.ok(PAGES.length >= 4, `fixtures: ${PAGES.join(', ')}`));

for (const name of PAGES) {
  test(`${name}: ocrRaster matches the fixture`, async () => {
    const fx = JSON.parse(fs.readFileSync(DIR + name + '.json', 'utf8'));
    const [eng, extra] = await engines, words: Word[] = [];
    for (const [ri, side] of (['h', 'v'] as const).entries()) {
      const [width, height] = fx.raster[side];
      const data = new Uint8Array(zlib.gunzipSync(fs.readFileSync(`${DIR}${name}_${side}.gray.gz`)));
      assert.equal(data.length, width * height, `${side} raster size`);
      const img = grayPng(data, width, height);
      for (const [wi, wk] of [eng, extra].entries()) {
        const ws = await ocrRaster(wk as any, img, width, height);
        words.push(...ws.map(w => [ri * 2 + wi, w.text, w.conf, r6(w.x0), r6(w.y0), r6(w.x1), r6(w.y1), ri] as Word));
      }
    }
    const d = compareWords(fx.words, words);
    assert.ok(d.identical, `${name}: ${summarize(d)}`);
  });
}
