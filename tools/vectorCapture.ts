/**
 * Vector-page OCR capture (dev tool, not part of the app build; production code unchanged).
 * For ONE page with vector lettering, does what ocrPdfPage's vector_text branch does before glyphs:
 * extractSmallStrokes -> rasterize (flat and turned) -> ocrRaster with the browser engines
 * (ocrWorker: eng psm 6; a tha+eng psm 11 worker set up like drawingThaiWorker in browserPipeline.ts).
 * The 4 passes run twice; only when both runs give the same words is the capture offered as a fixture
 * (raw ocrRaster words, before unrotate). With save=1 the rasters and the fixture are POSTed to a local
 * receiver at 127.0.0.1:5199 that writes them to src/pdf/fixtures/vector/.
 *
 *   npm run dev, then open
 *   http://localhost:5173/tools/vector-capture.html?set=house_ready_3&page=2&save=1
 */
import * as pdfjs from 'pdfjs-dist';
import { loadPdf, ocrWorker } from '../src/pdf/browserPipeline';
import { extractSmallStrokes, rasterize } from '../src/pdf/vectorText';
import { ocrRaster } from '../src/pdf/ocr';
import { compareWords, summarize, type Word } from './compareWords';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };
const q = new URLSearchParams(location.search);
const set = q.get('set') || 'house_ready_3', pageNo = Number(q.get('page') || 2), save = q.get('save') === '1';
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const PASSES = ['eng h', 'extra h', 'eng v', 'extra v'];

const gray = (d: Uint8Array, w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(w, h);
  for (let i = 0; i < d.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = d[i]; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
};
const post = async (name: string, body: BodyInit) => (await fetch(`http://127.0.0.1:5199/save?name=${name}`, { method: 'POST', body })).text();
const gz = async (d: Uint8Array) => new Response(new Blob([d as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();

(async () => {
  const man = await fetch(`/real_drawings/${set}/manifest.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const doc = await loadPdf(await (await fetch(`/real_drawings/${set}/${man?.pdf ?? man?.drawingPdf ?? 'drawings.pdf'}`)).arrayBuffer());
  const page = await doc.getPage(pageNo), vp = page.getViewport({ scale: 1 }), ops = await page.getOperatorList();
  const strokes = extractSmallStrokes(ops.fnArray, ops.argsArray, pdfjs.OPS as any, vp.transform, 15); // ocrPdfPage default maxLetterPt
  log(`${set} p${pageNo}: ${strokes.small.length} small strokes${strokes.small.length < 200 ? ' — NOT a vector_text page' : ''}`);
  if (strokes.small.length < 200) return;
  const eng = await ocrWorker();
  const T = await import('tesseract.js');
  const extra = await T.createWorker('tha+eng');
  await extra.setParameters({ tessedit_pageseg_mode: '11' as any });
  const rasters = [false, true].map(rot => rasterize(strokes.small, vp.width, vp.height, 300 / 72, 3, rot));
  const runOnce = async () => {
    const words: Word[] = [], ms: number[] = [];
    for (const [ri, r] of rasters.entries()) {
      const img = gray(r.data, r.width, r.height);
      for (const [wi, wk] of [eng, extra].entries()) {
        const t0 = performance.now(), ws = await ocrRaster(wk as any, img, r.width, r.height);
        ms.push(performance.now() - t0);
        words.push(...ws.map(w => [ri * 2 + wi, w.text, w.conf, r6(w.x0), r6(w.y0), r6(w.x1), r6(w.y1), ri] as Word));
      }
    }
    return { words, ms };
  };
  const a = await runOnce();
  log(`run 1: ${a.words.length} words, passes ${a.ms.map((m, i) => `${PASSES[i]} ${(m / 1000).toFixed(1)}s`).join(', ')}`);
  const b = await runOnce();
  log(`run 2: ${b.words.length} words, passes ${b.ms.map((m, i) => `${PASSES[i]} ${(m / 1000).toFixed(1)}s`).join(', ')}`);
  const d = compareWords(a.words, b.words);
  log(`run 2 vs run 1: ${summarize(d)}`);
  (window as any).__vectorCapture = { set, page: pageNo, identical: d.identical, words: a.words.length };
  if (!d.identical) { log('NOT deterministic — no fixture saved'); return; }
  if (save) {
    const name = `${set}_p${pageNo}`;
    for (const [ri, r] of rasters.entries()) log(`saved ${name}_${ri ? 'v' : 'h'}.gray.gz ${await post(`${name}_${ri ? 'v' : 'h'}.gray.gz`, await gz(r.data))} bytes`);
    const fx = { set, page: pageNo, source: 'browser ocrRaster via tools/vector-capture.html (rasterize 300/72 pen 3; eng psm 6, tha+eng psm 11)', savedAt: new Date().toISOString(),
      format: 'words: [pass, text, conf, x0, y0, x1, y1, turned(1/0)], raw ocrRaster boxes normalized to that pass raster (before unrotate), rounded to 1e-6',
      passes: PASSES, raster: { h: [rasters[0].width, rasters[0].height], v: [rasters[1].width, rasters[1].height] }, words: a.words };
    log(`saved ${name}.json ${await post(`${name}.json`, JSON.stringify(fx))} bytes`);
  }
  await extra.terminate();
  log('done');
})().catch(e => log('ERROR ' + e));
