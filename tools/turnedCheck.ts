/**
 * Turned-pass diagnostic and experiment (dev tool, not part of the app build; production code unchanged).
 * Reads ONE scanned page the way the upload path does (renderForOcr -> same bands as readScan) and runs:
 *  - mode=prod (default): production paddleWords — the baseline. Recognition calls are counted by
 *    wrapping the model session; the words are printed for saving as a fixture;
 *  - mode=exp: the test-only copy tools/paddleOcrExperiment.ts, with exact box counts from the box
 *    geometry; skip=1 (default) skips recognition of turned-pass boxes at least 3x taller than wide.
 *  - mode=both&rounds=N (default 3): production and experiment on the same raster, order swapped each
 *    round; reports median time, recognition calls and the diff of every run.
 * Every run is compared with the committed fixture src/pdf/fixtures/turned/<set>_p<page>.json only;
 * with no fixture the page reports NO BASELINE (not a pass).
 *
 *   npm run dev, then open
 *   http://localhost:5173/tools/turned-check.html?set=thaisuk_1&page=9&mode=prod
 *   http://localhost:5173/tools/turned-check.html?set=thaisuk_1&page=9&mode=exp&skip=1
 */
import * as ort from 'onnxruntime-web';
import detUrl from '../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx?url';
import recUrl from '../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx?url';
import dictUrl from '../node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt?url';
import { loadPdf, renderForOcr } from '../src/pdf/browserPipeline';
import { loadPaddle, paddleWords } from '../src/pdf/paddleOcr';
import { paddleWordsExperiment, newTurnedDiag, type TurnedDiag } from './paddleOcrExperiment';
import { compareWords, summarize, type Word } from './compareWords';
import type { Raster } from '../src/pdf/ocr';

ort.env.wasm.numThreads = 1; // as in paddleWorker.ts
const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; };
const q = new URLSearchParams(location.search);
const set = q.get('set') || 'thaisuk_1', pageNo = Number(q.get('page') || 9);
const mode = (['exp', 'both'].includes(q.get('mode') || '') ? q.get('mode') : 'prod') as 'prod' | 'exp' | 'both', skip = q.get('skip') !== '0';
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

(async () => {
  const man = await fetch(`/real_drawings/${set}/manifest.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const doc = await loadPdf(await (await fetch(`/real_drawings/${set}/${man?.pdf ?? man?.drawingPdf ?? 'drawings.pdf'}`)).arrayBuffer());
  const prep = await renderForOcr(await doc.getPage(pageNo), 300 / 72, false, true);
  if (!prep?.raster) { log('no raster for this page'); return; }
  const r: Raster = prep.raster;
  log(`${set} p${pageNo} mode=${mode}${mode === 'exp' ? ` skip=${skip ? 1 : 0}` : ''}: raster ${r.width}x${r.height}`);
  const bytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const p = await loadPaddle(ort, await bytes(detUrl), await bytes(recUrl), await (await fetch(dictUrl)).text());
  let recCalls = 0;
  const rec = p.rec.run.bind(p.rec);
  p.rec.run = async (feeds: any) => { recCalls++; return rec(feeds); };

  // same bands as readScan (browserPipeline.ts): n = min(2, cores - 1), 200 px overlap
  const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1)), step = Math.ceil(r.height / n), over = 200;
  const run = async (m: 'prod' | 'exp') => {
    const words: Word[] = [], diags: TurnedDiag[] = [], calls0 = recCalls, t0 = performance.now();
    for (let k = 0; k < n; k++) {
      const y0 = Math.max(0, k * step - over), y1 = Math.min(r.height, (k + 1) * step + over);
      const band: Raster = { data: r.data.slice(y0 * r.width, y1 * r.width), width: r.width, height: y1 - y0 };
      const diag = newTurnedDiag();
      const ws = m === 'exp' ? await paddleWordsExperiment(p, band, skip, diag) : await paddleWords(p, band);
      diags.push(diag);
      words.push(...ws.map(w => [k, w.text, w.conf, r6(w.x0), r6(w.y0), r6(w.x1), r6(w.y1), w.vertical ? 1 : 0] as Word));
    }
    const res = { mode: m, ms: performance.now() - t0, recCalls: recCalls - calls0, words, diags };
    log(`[${m}] time ${(res.ms / 1000).toFixed(1)} s (one thread, bands one after another), recognition calls ${res.recCalls}, words ${words.length}`);
    if (m === 'exp') diags.forEach((d, k) => log(`  band ${k}: flat-pass boxes ${d.flatBoxes}; turned-pass boxes ${d.turnedBoxes} = ${d.turnedTall3} h>=3w + ${d.turnedMid} 1.5w<=h<3w + ${d.turnedFlat} h<1.5w; skipped ${d.skipped}`));
    return res;
  };
  // baseline is the committed fixture only, never a run from this page load
  const fx = await fetch(`/src/pdf/fixtures/turned/${set}_p${pageNo}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const baseline: Word[] | null = fx?.words ?? null;
  if (baseline) log(`baseline: fixture ${set}_p${pageNo}.json (${baseline.length} words, saved ${fx.savedAt}, raster ${fx.raster?.join('x')})`);
  else log('NO BASELINE fixture for this page — nothing to compare, not a pass');
  if (baseline && fx.raster && (fx.raster[0] !== r.width || fx.raster[1] !== r.height)) log(`WARNING raster ${r.width}x${r.height} differs from fixture ${fx.raster.join('x')}`);
  // mode=both alternates the order each round (prod,exp / exp,prod ...) so neither always runs first
  const rounds = mode === 'both' ? Math.max(1, Number(q.get('rounds') || 3)) : 1;
  const results: (Awaited<ReturnType<typeof run>> & { round: number; diff: ReturnType<typeof compareWords> | null })[] = [];
  for (let i = 0; i < rounds; i++) {
    const order: ('prod' | 'exp')[] = mode === 'both' ? (i % 2 ? ['exp', 'prod'] : ['prod', 'exp']) : [mode];
    for (const m of order) {
      const res = await run(m);
      const diff = baseline ? compareWords(baseline, res.words) : null;
      log(`  round ${i + 1} [${m}] vs fixture: ${diff ? summarize(diff) : 'NO BASELINE'}`);
      results.push({ ...res, round: i + 1, diff });
    }
  }
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  const summary: Record<string, unknown> = {};
  for (const m of ['prod', 'exp'] as const) {
    const rs = results.filter(x => x.mode === m);
    if (!rs.length) continue;
    const s = { runs: rs.length, medianMs: Math.round(median(rs.map(x => x.ms))), ms: rs.map(x => Math.round(x.ms)), recCalls: [...new Set(rs.map(x => x.recCalls))],
      identicalToFixture: baseline ? rs.filter(x => x.diff!.identical).length : null };
    summary[m] = s;
    log(`SUMMARY [${m}] runs ${s.runs}: median ${(s.medianMs / 1000).toFixed(1)} s (${s.ms.map(v => (v / 1000).toFixed(1)).join(', ')}), recognition calls ${s.recCalls.join('/')}, identical to fixture ${s.identicalToFixture ?? '-'}/${s.runs}`);
  }
  (window as any).__turnedCheck = { set, page: pageNo, mode, skip, rounds, raster: [r.width, r.height], summary,
    results: results.map(({ words, ...x }) => ({ ...x, words: words.length })) };
  log('done');
})().catch(e => log('ERROR ' + e));
