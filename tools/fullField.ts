/**
 * Full-field check (dev tool, production code unchanged): ocrPdfPage on the given pages of a real set,
 *  - seq: every recognize call behind one lock and no turnedWorkers = the old order (eng h, extra h, eng v, extra v, one at a time)
 *  - par: turnedWorkers as browserPipeline.ts sets them up (all 4 passes at once)
 * Then each mode's pages go through extractInBrowser as cachedOcr (the same reader, merge and notes as an upload)
 * and every field is compared: words (all keys, in order and as a multiset), page geometry, readings, members, notes...
 * Workers are set up like browserPipeline.ts (ocrWorker eng psm 6; tha+eng psm 11) and created before timing.
 * Logs Date.now() at each mode's start / end so RAM samples taken outside the page can be matched to a mode.
 *
 *   npm run dev, then open
 *   http://localhost:5173/tools/full-field.html?set=dot32_pavilion&pages=16-21
 */
import * as pdfjs from 'pdfjs-dist';
import Tesseract from 'tesseract.js';
import { loadPdf, ocrWorker, extractInBrowser, parsePageSpec } from '../src/pdf/browserPipeline';
import { ocrPdfPage } from '../src/pdf/pdfOcrPipeline';
import { toPageText, pageTextToOcr } from '../src/pdf/pdfText';
import type { PageOcr } from '../src/pdf/types';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; console.log(s); };
const q = new URLSearchParams(location.search);
const set = q.get('set') || 'dot32_pavilion', spec = q.get('pages') || '16-21';

// copies of the private helpers in browserPipeline.ts (grayToCanvas, bitmapPixels)
const grayToCanvas = (d: Uint8Array, w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(w, h);
  for (let i = 0; i < d.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = d[i]; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
};
const bitmapPixels = (img: any) => {
  const bm = img?.bitmap;
  if (!bm?.width) return null;
  const c = document.createElement('canvas');
  c.width = bm.width; c.height = bm.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bm, 0, 0);
  return { width: bm.width, height: bm.height, kind: 3, data: ctx.getImageData(0, 0, bm.width, bm.height).data };
};
const worker = async (lang: string, psm: string) => { const w = await Tesseract.createWorker(lang); await w.setParameters({ tessedit_pageseg_mode: psm as any }); return w; };

/** JSON with sorted keys, so two equal values give the same string whatever order their keys were set in */
const stable = (v: any): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);

/** a, b: arrays. exact = same items in the same order; sameSet = same items in any order */
const cmpList = (a: any[], b: any[]) => {
  const sa = a.map(stable), sb = b.map(stable);
  const exact = sa.length === sb.length && sa.every((s, i) => s === sb[i]);
  const sameSet = stable([...sa].sort()) === stable([...sb].sort());
  const firstDiff = exact ? -1 : sa.findIndex((s, i) => s !== sb[i]);
  return { exact, sameSet, n: [a.length, b.length], firstDiff, at: firstDiff >= 0 ? [sa[firstDiff]?.slice(0, 300), sb[firstDiff]?.slice(0, 300)] : undefined };
};

(async () => {
  const man = await fetch(`/real_drawings/${set}/manifest.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const pdfName = man?.pdf ?? man?.drawingPdf ?? 'drawings.pdf';
  const doc = await loadPdf(await (await fetch(`/real_drawings/${set}/${pdfName}`)).arrayBuffer());
  const pages = parsePageSpec(spec, doc.numPages)!;
  const t0 = performance.now();
  const eng = await ocrWorker(), extra = await worker('tha+eng', '11');
  const turned = await Promise.all([worker('eng', '6'), worker('tha+eng', '11')]);
  log(`${set} (${pdfName}) pages ${pages.join(',')}; 4 workers ready in ${((performance.now() - t0) / 1000).toFixed(1)} s; cores ${navigator.hardwareConcurrency}`);

  // one lock for every recognize call: the old code awaited each pass before starting the next
  let chain: Promise<any> = Promise.resolve();
  const locked = (w: any) => ({ recognize: (...a: any[]) => { const p = chain.then(() => w.recognize(...a)); chain = p.catch(() => {}); return p; } });

  const ocrMode = async (mode: 'seq' | 'par') => {
    const env: any = {
      worker: mode === 'seq' ? locked(eng) : eng, extraWorkers: [mode === 'seq' ? locked(extra) : extra],
      ...(mode === 'par' ? { turnedWorkers: turned } : {}),
      OPS: pdfjs.OPS as any, imagePixels: bitmapPixels, toImage: grayToCanvas,
    };
    log(`[${mode}] start ${Date.now()}`);
    const t = performance.now(), res: PageOcr[] = [], ms: number[] = [];
    for (const p of pages) {
      const tp = performance.now();
      const page = await doc.getPage(p);
      const r = await ocrPdfPage(page as any, p, env);
      // as extractInBrowser does for an OCR'd page that also has a text layer
      const vp = page.getViewport({ scale: 1 }), pt = toPageText(p, vp, (await page.getTextContent()) as any);
      if (pt.items.map(i => i.str).join('').trim().length >= 40) r.words.push(...pageTextToOcr(pt, vp.width, vp.height).words);
      res.push(r);
      ms.push(performance.now() - tp);
    }
    log(`[${mode}] end ${Date.now()} — ${((performance.now() - t) / 1000).toFixed(1)} s (${ms.map((m, i) => `p${pages[i]} ${(m / 1000).toFixed(1)}`).join(', ')})`);
    return res;
  };

  const seq = await ocrMode('seq');
  const par = await ocrMode('par');

  log('\n== words and page fields ==');
  const summary: any = { pages: {}, extraction: {} };
  let wordsOk = 0;
  for (const [i, p] of pages.entries()) {
    const a = seq[i], b = par[i];
    const w = cmpList(a.words, b.words);
    const { words: _wa, ...ra } = a as any, { words: _wb, ...rb } = b as any;
    const rest = stable(ra) === stable(rb);
    if (w.exact && rest) wordsOk++;
    summary.pages[p] = { words: w, otherFields: rest };
    log(`p${p}: words ${w.n[0]} vs ${w.n[1]} — ${w.exact ? 'identical, same order' : w.sameSet ? `same words, ORDER differs from #${w.firstDiff}` : `VALUES differ from #${w.firstDiff}: ${w.at?.join('  ||  ')}`}; geometry/kind fields ${rest ? 'identical' : 'DIFFER'}`);
  }

  log('\n== readings / members / notes (extractInBrowser with cachedOcr) ==');
  const run = async (o: PageOcr[]) => extractInBrowser(doc, pdfName, { cachedOcr: o }, () => {});
  const ea: any = await run(seq), eb: any = await run(par);
  let extOk = 0, extN = 0;
  for (const k of Object.keys(ea)) {
    if (k === 'ocrPages') continue; // compared above
    extN++;
    const va = ea[k], vb = eb[k];
    if (Array.isArray(va)) {
      const c = cmpList(va, vb || []);
      if (c.exact) extOk++;
      summary.extraction[k] = c;
      log(`${k}: ${c.n[0]} vs ${c.n[1]} — ${c.exact ? 'identical' : c.sameSet ? `same items, ORDER differs from #${c.firstDiff}` : `VALUES differ from #${c.firstDiff}: ${c.at?.join('  ||  ')}`}`);
    } else {
      const same = stable(va) === stable(vb);
      if (same) extOk++;
      summary.extraction[k] = { exact: same };
      log(`${k}: ${same ? 'identical' : 'DIFFER'}`);
    }
  }
  log(`\nSUMMARY pages identical (all word fields, order, geometry) ${wordsOk}/${pages.length}; extraction fields identical ${extOk}/${extN}; members ${ea.members.length} vs ${eb.members.length}, readings ${ea.readings.length} vs ${eb.readings.length}`);
  for (const w of [extra, ...turned]) await w.terminate();
  (window as any).__fullField = summary;
  log('done');
})().catch(e => log('ERROR ' + (e?.stack || e)));
