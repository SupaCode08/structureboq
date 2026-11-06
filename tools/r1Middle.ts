/**
 * R1 Middle-Ground Browser Experiment (dev tool in tools/, production code unchanged):
 * - Extracts the largest embedded image on each scanned page and prepares it at 400 DPI
 *   (same logic as scripts/scanImage.ts embeddedImage).
 * - Sends the full 400-DPI raster to 2 workers in parallel:
 *     Worker 0: flat pass (normal orientation)
 *     Worker 1: turned pass (90° clockwise rotation, flatOnly=true, unrotated back)
 * - Concatenates [...flatWords, ...turnedWords], runs dedupeWords, and compares:
 *     1) Word count and word-by-word parity against real_drawings/<set>/offline_ocr.json
 *     2) Reading score (ถูก / ผิด / ไม่พบ) against real_drawings/<set>/answer_key.json
 *     3) Wall-clock time per page and total time (plus timestamps for external memory sampling)
 *
 * Usage:
 *   http://localhost:5173/tools/r1-middle.html?set=toilet_604_45&pages=1-5
 *   http://localhost:5173/tools/r1-middle.html?set=cdc_1&pages=16-24
 */
import * as pdfjs from 'pdfjs-dist';
import { loadPdf, ocrWorker, parsePageSpec } from '../src/pdf/browserPipeline';
import { ocrPdfPage } from '../src/pdf/pdfOcrPipeline';
import { imageGray } from '../src/pdf/imageBoxes';
import { prepareScan, removeLines, estimateSkew, rotateRaster, extractLines, findRings, ringsAtLineEnds } from '../src/pdf/scanPrep';
import { readSheets } from '../src/pdf/sheetReader';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS } from '../src/engine/sheetMerge';
import type { ExtractedMember } from '../src/engine/qsEngine';
import type { OcrWord, PageOcr } from '../src/pdf/types';
import type { Raster } from '../src/pdf/ocr';
import detUrl from '../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx?url';
import recUrl from '../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx?url';
import dictUrl from '../node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt?url';

const out = document.getElementById('out')!;
const log = (s: string) => { out.textContent += s + '\n'; console.log(s); };
const q = new URLSearchParams(location.search);
const set = q.get('set') || 'toilet_604_45';
const spec = q.get('pages') || (set === 'cdc_1' ? '16-24' : '1-5');
const zeroSkew = q.get('zeroSkew') !== '0'; // default true:prep is already deskewed in embeddedImage, matching offline_ocr.json

const grayToCanvas = (d: Uint8Array, w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!, img = ctx.createImageData(w, h);
  for (let i = 0; i < d.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = d[i]; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
};

const bitmapPixels = (img: any) => {
  if (img?.data) return img;
  const bm = img?.bitmap;
  if (!bm?.width) return null;
  const c = document.createElement('canvas');
  c.width = bm.width; c.height = bm.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bm, 0, 0);
  const px = { width: bm.width, height: bm.height, kind: 3, data: ctx.getImageData(0, 0, bm.width, bm.height).data };
  c.width = 0; c.height = 0;
  return px;
};

/** Exact browser equivalent of scripts/scanImage.ts embeddedImage at 400 DPI */
async function embeddedImageBrowser(page: any, rotate90: boolean, prepared = true, returnZeroSkew = true) {
  const ops = await page.getOperatorList();
  const vt = page.getViewport({ scale: 1 }).transform;
  type M = number[];
  const mul = (m: M, n: M): M => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  let ctm: M = vt;
  const stack: M[] = [];
  let best: any = null;
  let bestM: M = vt;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === pdfjs.OPS.save) stack.push(ctm);
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    if (fn !== pdfjs.OPS.paintImageXObject) continue;
    const name = ops.argsArray[i][0];
    const store = name.startsWith('g_') && page.commonObjs ? page.commonObjs : page.objs;
    const rawImg: any = await new Promise(res => store.get(name, res));
    const w = rawImg?.width || rawImg?.bitmap?.width || 0;
    const h = rawImg?.height || rawImg?.bitmap?.height || 0;
    if (w * h > ((best?.width || best?.bitmap?.width || 0) * (best?.height || best?.bitmap?.height || 0))) {
      best = rawImg;
      bestM = ctm;
    }
  }
  const bestPx = bitmapPixels(best);
  if (!bestPx?.data) return null;
  const { width: w, height: h } = bestPx;
  let gray = imageGray(bestPx)!;
  const [dx, dy] = [bestM[0], bestM[1]];
  const base = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 180) : (dy > 0 ? 90 : 270);
  const rot = (base + (rotate90 ? 90 : 0)) % 360;
  let W = w, H = h;
  const rotate = (src: Uint8Array, sw: number, sh: number) => {
    const out = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) out[x * sh + (sh - 1 - y)] = src[y * sw + x];
    return out;
  };
  for (let r = 0; r < rot; r += 90) { gray = rotate(gray, W, H); [W, H] = [H, W]; }
  const vp1 = page.getViewport({ scale: 1 });
  const targetLong = (Math.max(vp1.width, vp1.height) * 400) / 72;
  const k = Math.min(3, Math.max(1, targetLong / Math.max(W, H)));
  if (!prepared) return { image: grayToCanvas(gray, W, H), width: W, height: H, skew: 0 };
  let skewDone = 0;
  let prep = prepareScan(gray, W, H, k);
  const skew = estimateSkew(prep);
  if (Math.abs(skew) >= 0.1) { prep = rotateRaster(prep, -skew); skewDone = skew; }
  const pxPerMm = Math.max(prep.width, prep.height) / ((Math.max(vp1.width, vp1.height) / 72) * 25.4);
  const lines = extractLines(prep, Math.round(pxPerMm * 3));
  const endRings = lines && !rotate90 ? ringsAtLineEnds(prep, lines, pxPerMm) : [];
  prep = removeLines(prep, Math.round(pxPerMm * 5));
  const blobs = rotate90 ? [] : findRings(prep, Math.round(pxPerMm * 4), Math.round(pxPerMm * 16));
  const circles = rotate90 ? undefined
    : [...blobs, ...endRings.filter(e => !blobs.some(b => Math.hypot(b[0] - e[0], ((b[1] - e[1]) * prep.height) / prep.width) < b[2] / 2))];
  return {
    image: null as any,
    width: prep.width,
    height: prep.height,
    skew: returnZeroSkew ? 0 : skewDone,
    actualSkew: skewDone,
    lines,
    circles,
    raster: prep,
  };
}

/** Reading score evaluator (identical to scripts/eval_reading.ts) */
type Key = { tag: string; type: string; count?: number; width?: number; depth?: number; thickness?: number; topRebar?: string; bottomRebar?: string; mainRebar?: string; stirrup?: string };
const normTag = (t: string) => t.toUpperCase().replace(/[()\s]/g, '');
const normBars = (s?: string) => {
  if (!s) return '';
  const t = s.toUpperCase().replace(/\s/g, '').replace(/[ØΦ]/g, 'RB').replace(/MM\.?/g, '');
  if (t.includes('@')) return t.replace(/@0?\./, '@0.').replace(/(\.\d)0$/, '$1');
  const parts = t.split('+').map(p => p.replace(/^(\d+)-?/, '$1-'));
  const mesh = t.match(/^(\d+)\+(\d+)-?((?:DB|RB)\d+)$/);
  if (mesh) return `${mesh[1]}+${mesh[2]}-${mesh[3]}`;
  return parts.sort().join('+');
};
const near = (a?: number, b?: number) => a !== undefined && b !== undefined && Math.abs(a - b) <= 0.011;

function evaluatePages(pages: PageOcr[], key: any, manifest: any) {
  const { readings } = readSheets(pages);
  const merged = mergeSheetReadings(readings, manifest?.pdf || 'x.pdf', { ...DEFAULT_MERGE_ASSUMPTIONS, footingVariant: manifest?.footingVariant ?? 'แผ่' });
  const byTag = new Map<string, ExtractedMember[]>();
  for (const m of merged.members) for (const t of m.tag.split(',')) {
    const k = normTag(t) + ':' + m.memberType;
    byTag.set(k, [...(byTag.get(k) || []), m]);
  }
  const s = { right: 0, wrong: 0, missing: 0, notes: [] as string[] };
  const field = (tag: string, name: string, want: unknown, got: unknown, eq: (a: any, b: any) => boolean) => {
    if (want === undefined) return;
    if (got === undefined || got === null || got === '' || got === 0) { s.missing++; s.notes.push(`${tag} ${name}: ไม่พบ (แบบ ${want})`); return; }
    if (eq(want, got)) s.right++;
    else { s.wrong++; s.notes.push(`${tag} ${name}: ผิด — ระบบ ${got} แบบ ${want}`); }
  };
  const plans = readings.filter(r => r.grid?.x?.length || r.grid?.y?.length);
  const gridOk = (axis: 'x' | 'y') => plans.some(r => {
    const g = (r.grid![axis] || []).map(a => a.offset_m);
    if (!key.grid[axis].length) return g.length <= 1;
    return g.length === key.grid[axis].length && g.every((v, i) => Math.abs(v - key.grid[axis][i]) < 0.06);
  });
  const axisText = (v: number[]) => v.join('/') || '(เส้นเดียว)';
  for (const ax of ['x', 'y'] as const) field('grid', ax, axisText(key.grid[ax]), gridOk(ax) ? axisText(key.grid[ax]) : (plans[0]?.grid?.[ax]?.map(a => a.offset_m).join('/') || ''), (a, b) => a === b);

  const keyFootings = (key.members as Key[]).filter(k => k.type === 'FOOTING');
  if (keyFootings.length && keyFootings.every(k => k.count !== undefined)) {
    const n = merged.members.filter(m => m.memberType === 'FOOTING').length;
    field('ฐานรากทั้งหมด', 'จำนวน', keyFootings.reduce((a, k) => a + k.count!, 0), n, (a, b) => a === b);
  }
  let tagsFound = 0;
  for (const k of key.members as Key[]) {
    const ms = byTag.get(normTag(k.tag) + ':' + k.type) || [];
    if (!ms.length) { s.missing++; s.notes.push(`${k.tag}: ไม่พบเบอร์นี้เลย`); continue; }
    tagsFound++;
    s.right++;
    if (k.count !== undefined) field(k.tag, 'จำนวน', k.count, ms.length, (a, b) => a === b);
    const assumed = (f: string) => ms[0].provenance?.fieldSources?.[f] === 'assumed';
    const m = { ...ms[0], width: assumed('width') ? undefined : ms[0].width, depth: assumed('depth') ? undefined : ms[0].depth };
    const isFS = k.type === 'FOOTING' || k.type === 'SLAB';
    if (k.type !== 'SLAB') {
      field(k.tag, 'กว้าง', k.width, m.width, near);
      field(k.tag, 'ลึก/ยาว', k.depth, m.depth, near);
    }
    if (isFS) field(k.tag, 'หนา', k.thickness, m.length, near);
    const bars = (a: string, b: string) => normBars(a) === normBars(b);
    if (k.type === 'COLUMN') field(k.tag, 'เหล็กยืน', k.mainRebar, m.topRebar, bars);
    else {
      field(k.tag, 'เหล็กบน', k.topRebar, m.topRebar, bars);
      field(k.tag, 'เหล็กล่าง', k.bottomRebar, m.bottomRebar, bars);
    }
    field(k.tag, 'ปลอก', k.stirrup, m.stirrupRebar, bars);
  }
  const total = s.right + s.wrong + s.missing;
  return { ...s, total, tagsFound, tags: key.members.length };
}

const stable = (v: any): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);

const workers: [Worker, Worker] = [
  new Worker(new URL('./r1Worker.ts', import.meta.url), { type: 'module' }),
  new Worker(new URL('./r1Worker.ts', import.meta.url), { type: 'module' }),
];
let callId = 0;

function runWorkerPass(k: 0 | 1, raster: Raster, pass: 'flat' | 'turned' | 'both'): Promise<{ words: OcrWord[]; stats: any }> {
  const w = workers[k];
  const id = ++callId;
  return new Promise((resolve, reject) => {
    const done = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', done);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve({ words: e.data.words, stats: e.data.stats });
    };
    w.addEventListener('message', done);
    w.postMessage({ id, raster, urls: { det: detUrl, rec: recUrl, dict: dictUrl }, pass });
  });
}

(async () => {
  const man: any = await fetch(`/real_drawings/${set}/manifest.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  const key = await fetch(`/real_drawings/${set}/answer_key.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const offline = await fetch(`/real_drawings/${set}/offline_ocr.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const pdfName = man?.pdf ?? man?.drawingPdf ?? 'drawings.pdf';
  const doc = await loadPdf(await (await fetch(`/real_drawings/${set}/${pdfName}`)).arrayBuffer());
  const pages = parsePageSpec(spec, doc.numPages)!;

  // Warm up both Paddle workers on a tiny 32x32 dummy raster so model load time is separated from page OCR time
  const tWarm = performance.now();
  const dummy: Raster = { data: new Uint8Array(32 * 32).fill(255), width: 32, height: 32 };
  const [w0Warm, w1Warm] = await Promise.all([
    runWorkerPass(0, dummy, 'flat'),
    runWorkerPass(1, dummy, 'turned'),
  ]);
  const warmMs = performance.now() - tWarm;
  const tessWorker = await ocrWorker();

  log(`=== R1 Middle-Ground (400 DPI Full Embedded Image + 2 Workers: flat || turned) ===`);
  log(`set=${set} (${pdfName}) pages=${pages.join(',')} zeroSkew=${zeroSkew} cores=${navigator.hardwareConcurrency}`);
  log(`workers warmed up in ${(warmMs / 1000).toFixed(2)}s (w0 init ${(w0Warm.stats.initMs / 1000).toFixed(2)}s, w1 init ${(w1Warm.stats.initMs / 1000).toFixed(2)}s)`);
  log(`[START_TS] ${Date.now()}`);

  const tStart = performance.now();
  const ocrPages: PageOcr[] = [];
  const pageStats: any[] = [];

  for (const p of pages) {
    const tp = performance.now();
    const page = await doc.getPage(p);
    let stepMs: Record<string, number> = {};
    let w0St: any = null, w1St: any = null;
    let prepInfo: { width: number; height: number; actualSkew: number } = { width: 0, height: 0, actualSkew: 0 };

    const r = await ocrPdfPage(page as any, p, {
      worker: tessWorker,
      OPS: pdfjs.OPS as any,
      imagePixels: bitmapPixels,
      toImage: grayToCanvas,
      renderPage: async (pg, _scale, rot, prepared) => {
        const res = await embeddedImageBrowser(pg, rot, prepared, zeroSkew);
        if (res) prepInfo = { width: res.width, height: res.height, actualSkew: (res as any).actualSkew || 0 };
        return res;
      },
      readScan: async (raster: Raster) => {
        const [rFlat, rTurned] = await Promise.all([
          runWorkerPass(0, raster, 'flat'),
          runWorkerPass(1, raster, 'turned'),
        ]);
        w0St = rFlat.stats;
        w1St = rTurned.stats;
        return [...rFlat.words, ...rTurned.words];
      },
      onTime: (step, ms) => { stepMs[step] = (stepMs[step] || 0) + ms; },
    });

    const totalPageMs = performance.now() - tp;
    ocrPages.push(r);
    const st = {
      page: p,
      width: prepInfo.width,
      height: prepInfo.height,
      skew: prepInfo.actualSkew,
      words: r.words.length,
      renderMs: Math.round(stepMs['render scan'] || 0),
      paddleWallMs: Math.round(stepMs['paddle'] || 0),
      flatMs: Math.round(w0St?.totalMs || 0),
      turnedMs: Math.round(w1St?.totalMs || 0),
      seqPaddleEstMs: Math.round((w0St?.totalMs || 0) + (w1St?.totalMs || 0)),
      pageMs: Math.round(totalPageMs),
    };
    pageStats.push(st);
    log(`p${p}: ${st.width}x${st.height} (skew ${st.skew.toFixed(2)}°) words=${st.words} | render ${(st.renderMs / 1000).toFixed(1)}s, paddle ${(st.paddleWallMs / 1000).toFixed(1)}s (w0 flat ${(st.flatMs / 1000).toFixed(1)}s || w1 turned ${(st.turnedMs / 1000).toFixed(1)}s; 1-worker sum ${(st.seqPaddleEstMs / 1000).toFixed(1)}s) | page ${(st.pageMs / 1000).toFixed(1)}s`);
  }

  const totalWallMs = performance.now() - tStart;
  const sumSeqPaddleMs = pageStats.reduce((a, x) => a + x.seqPaddleEstMs + x.renderMs, 0);
  const sumParPaddleMs = pageStats.reduce((a, x) => a + x.paddleWallMs, 0);
  const sumRenderMs = pageStats.reduce((a, x) => a + x.renderMs, 0);
  log(`[END_TS] ${Date.now()}`);
  log(`\nTOTAL WALL TIME: ${(totalWallMs / 1000).toFixed(1)} s (render ${(sumRenderMs / 1000).toFixed(1)} s + parallel paddle ${(sumParPaddleMs / 1000).toFixed(1)} s; vs 1-worker est ${(sumSeqPaddleMs / 1000).toFixed(1)} s)`);

  // Compare against offline_ocr.json
  const totalWords = ocrPages.reduce((a, p) => a + p.words.length, 0);
  let wordParity: any = null;
  if (offline?.pages) {
    log(`\n== Comparison with offline_ocr.json ==`);
    let exactPages = 0, textMatchPages = 0, cacheTotalWords = 0;
    for (const pg of ocrPages) {
      const ref = offline.pages.find((x: any) => x.page === pg.page);
      if (!ref) continue;
      cacheTotalWords += ref.words.length;
      const exact = stable(pg.words) === stable(ref.words);
      const sameTexts = pg.words.length === ref.words.length && pg.words.every((w, i) => w.text === ref.words[i].text && w.conf === ref.words[i].conf && w.vertical === ref.words[i].vertical);
      const maxCoordDiff = pg.words.length === ref.words.length
        ? Math.max(0, ...pg.words.map((w, i) => Math.max(
            Math.abs(w.x0 - ref.words[i].x0),
            Math.abs(w.y0 - ref.words[i].y0),
            Math.abs(w.x1 - ref.words[i].x1),
            Math.abs(w.y1 - ref.words[i].y1),
          )))
        : -1;
      if (exact) exactPages++;
      if (sameTexts) textMatchPages++;
      log(`p${pg.page}: words ${pg.words.length} vs cache ${ref.words.length} | exact=${exact} | sameText&Conf=${sameTexts} | maxCoordDiff=${maxCoordDiff.toExponential(2)}`);
    }
    wordParity = { totalWords, cacheTotalWords, exactPages, textMatchPages, pageCount: ocrPages.length };
  }

  // Evaluate against answer_key.json
  let evalScore: any = null;
  let evalScoreWithSkew: any = null;
  if (key) {
    log(`\n== Reading Accuracy (eval_reading.ts logic) ==`);
    evalScore = evaluatePages(ocrPages, key, man);
    const pct = (n: number) => `${Math.round((n / evalScore.total) * 100)}%`;
    log(`Score (zeroSkew=${zeroSkew}, exact offline_ocr match): เบอร์ที่พบ ${evalScore.tagsFound}/${evalScore.tags} · ค่าทั้งหมด ${evalScore.total}: ถูก ${evalScore.right} (${pct(evalScore.right)}) · ผิด ${evalScore.wrong} (${pct(evalScore.wrong)}) · ไม่พบ ${evalScore.missing} (${pct(evalScore.missing)})`);
    for (const n of evalScore.notes) log(`  - ${n}`);

    // Also compute what happens if pdfOcrPipeline's double-deskew bug is active (for comparison)
    const doubleDeskewedPages: PageOcr[] = ocrPages.map((pg, idx) => {
      const sk = (pageStats[idx].skew * Math.PI) / 180;
      if (!sk) return pg;
      const W = pageStats[idx].width, H = pageStats[idx].height;
      const turn = (x: number, y: number) => {
        const dx = (x - 0.5) * W, dy = (y - 0.5) * H;
        return [(Math.cos(sk) * dx + Math.sin(sk) * dy + W / 2) / W, (-Math.sin(sk) * dx + Math.cos(sk) * dy + H / 2) / H];
      };
      const ws = pg.words.map(w => {
        const [ax, ay] = turn(w.x0, w.y0), [bx, by] = turn(w.x1, w.y1);
        const [cx, cy] = turn(w.x0, w.y1), [dx, dy] = turn(w.x1, w.y0);
        return { ...w, x0: Math.min(ax, bx, cx, dx), y0: Math.min(ay, by, cy, dy), x1: Math.max(ax, bx, cx, dx), y1: Math.max(ay, by, cy, dy) };
      });
      const hsegs: [number, number, number][] = (pg.hsegs || []).map(([x0, x1, y]) => {
        const [ax, ay] = turn(x0, y), [bx, by] = turn(x1, y);
        return [Math.min(ax, bx), Math.max(ax, bx), (ay + by) / 2];
      });
      const vsegs: [number, number, number][] = (pg.vsegs || []).map(([x, y0, y1]) => {
        const [ax, ay] = turn(x, y0), [bx, by] = turn(x, y1);
        return [(ax + bx) / 2, Math.min(ay, by), Math.max(ay, by)];
      });
      const circles: [number, number, number][] = (pg.circles || []).map(([x, y, r]) => {
        const [cx, cy] = turn(x, y);
        return [cx, cy, r];
      });
      return { ...pg, words: ws, hsegs, vsegs, circles };
    });
    evalScoreWithSkew = evaluatePages(doubleDeskewedPages, key, man);
    log(`Score (with pdfOcrPipeline double-deskew): เบอร์ที่พบ ${evalScoreWithSkew.tagsFound}/${evalScoreWithSkew.tags} · ค่าทั้งหมด ${evalScoreWithSkew.total}: ถูก ${evalScoreWithSkew.right} (${pct(evalScoreWithSkew.right)}) · ผิด ${evalScoreWithSkew.wrong} (${pct(evalScoreWithSkew.wrong)}) · ไม่พบ ${evalScoreWithSkew.missing} (${pct(evalScoreWithSkew.missing)})`);
  }

  for (const w of workers) w.terminate();
  await tessWorker.terminate();
  (window as any).__r1Middle = {
    set,
    pages,
    zeroSkew,
    warmMs: Math.round(warmMs),
    totalWallMs: Math.round(totalWallMs),
    sumRenderMs: Math.round(sumRenderMs),
    sumParPaddleMs: Math.round(sumParPaddleMs),
    sumSeqPaddleEstMs: Math.round(sumSeqPaddleMs),
    totalWords,
    pageStats,
    wordParity,
    evalScore,
  };
  log('DONE');
})().catch(e => log('ERROR ' + (e?.stack || e)));
