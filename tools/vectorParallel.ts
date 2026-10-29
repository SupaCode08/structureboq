/**
 * Experiment (dev tool, production code unchanged): the 4 Tesseract passes of a vector page
 * (eng / tha+eng on the flat and the turned stroke raster) one after another, as ocrPdfPage runs them,
 * vs all 4 at once on 4 workers. Input is the saved rasters in src/pdf/fixtures/vector/; every run is
 * compared with that page's fixture. Rounds alternate the order (seq,par / par,seq ...).
 * Workers are set up like browserPipeline.ts (eng psm 6, tha+eng psm 11) and created before timing.
 *
 *   npm run dev, then open
 *   http://localhost:5173/tools/vector-parallel.html?page=house_ready_3_p2&rounds=5
 */
import Tesseract from 'tesseract.js';
import { ocrRaster } from '../src/pdf/ocr';
import { compareWords, summarize, type Word } from './compareWords';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };
const q = new URLSearchParams(location.search);
const name = q.get('page') || 'house_ready_3_p2', rounds = Math.max(1, Number(q.get('rounds') || 5));
const DIR = '/src/pdf/fixtures/vector/';
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

const gray = (d: Uint8Array, w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(w, h);
  for (let i = 0; i < d.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = d[i]; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
};
const worker = async (lang: string, psm: string) => { const w = await Tesseract.createWorker(lang); await w.setParameters({ tessedit_pageseg_mode: psm as any }); return w; };

(async () => {
  const fx = await (await fetch(DIR + name + '.json')).json();
  const images = await Promise.all((['h', 'v'] as const).map(async side => {
    const [w, h] = fx.raster[side];
    // the dev server may send .gz with Content-Encoding: gzip, so the browser has already unpacked it
    const raw = new Uint8Array(await (await fetch(`${DIR}${name}_${side}.gray.gz`)).arrayBuffer());
    const data = raw.length === w * h ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if (data.length !== w * h) throw new Error(`${side} raster size ${data.length} != ${w}x${h}`);
    return { img: gray(data, w, h), w, h };
  }));
  const t0 = performance.now();
  // seq uses 2 workers like production; par adds a second pair so each pass has its own worker
  const [eng, extra, eng2, extra2] = await Promise.all([worker('eng', '6'), worker('tha+eng', '11'), worker('eng', '6'), worker('tha+eng', '11')]);
  log(`${name}: rasters h ${fx.raster.h.join('x')} v ${fx.raster.v.join('x')}, fixture ${fx.words.length} words; 4 workers ready in ${((performance.now() - t0) / 1000).toFixed(1)} s; cores ${navigator.hardwareConcurrency}`);
  const pass = async (k: number, wk: any) => {
    const { img, w, h } = images[k >> 1];
    return (await ocrRaster(wk, img, w, h)).map(x => [k, x.text, x.conf, r6(x.x0), r6(x.y0), r6(x.x1), r6(x.y1), k >> 1] as Word);
  };
  const run = async (mode: 'seq' | 'par') => {
    const t = performance.now();
    let per: Word[][];
    if (mode === 'seq') { per = []; for (let k = 0; k < 4; k++) per.push(await pass(k, k % 2 ? extra : eng)); }
    else per = await Promise.all([pass(0, eng), pass(1, extra), pass(2, eng2), pass(3, extra2)]);
    const ms = performance.now() - t, d = compareWords(fx.words, per.flat());
    return { mode, ms, identical: d.identical, diff: summarize(d) };
  };
  const res: Awaited<ReturnType<typeof run>>[] = [];
  for (let i = 0; i < rounds; i++) for (const m of (i % 2 ? ['par', 'seq'] : ['seq', 'par']) as ('seq' | 'par')[]) {
    const r = await run(m);
    res.push(r);
    log(`  round ${i + 1} [${m}] ${(r.ms / 1000).toFixed(1)} s vs fixture: ${r.diff}`);
  }
  const summary: Record<string, any> = {};
  for (const m of ['seq', 'par'] as const) {
    const rs = res.filter(r => r.mode === m), ms = rs.map(r => r.ms).sort((a, b) => a - b);
    summary[m] = { median: median(ms) / 1000, min: ms[0] / 1000, max: ms[ms.length - 1] / 1000, identical: rs.filter(r => r.identical).length, runs: rs.length };
    log(`SUMMARY [${m}] median ${summary[m].median.toFixed(1)} s (min ${summary[m].min.toFixed(1)}, max ${summary[m].max.toFixed(1)}), identical to fixture ${summary[m].identical}/${rs.length}`);
  }
  log(`par / seq median = ${(summary.par.median / summary.seq.median).toFixed(2)}`);
  for (const w of [eng, extra, eng2, extra2]) await w.terminate();
  (window as any).__vectorParallel = { name, rounds, summary };
  log('done');
})().catch(e => log('ERROR ' + e));
