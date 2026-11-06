/**
 * WebGPU vs WASM PaddleOCR Benchmark Prototype (tools/ only — production src/ untouched).
 *
 * Compares:
 *   - Baseline : WASM (2 Workers in parallel: Worker 0 = flat, Worker 1 = turned)
 *   - Candidate: WebGPU (1 GPU Worker sequential: pass = 'both' on a single shared session)
 *
 * Controls:
 *   - Exact same 400-DPI prepared raster, lines, circles, and geometry per page
 *   - Exact same ONNX models (ch_PP-OCRv4_det_infer.onnx + ch_PP-OCRv4_rec_infer.onnx)
 *   - Exact same TILE=960, OVER=96, textBoxes, readCrop, and dedupeWords from src/pdf/paddleOcr.ts
 *   - Warm-up separated from 3 alternating measurement rounds (ABA / BAB)
 *   - Explicit fallback verification for all 5 failure modes
 *   - Accuracy evaluated strictly against real_drawings/<set>/answer_key.json (never offline_ocr.json)
 */
import * as pdfjs from 'pdfjs-dist';
import { loadPdf, parsePageSpec } from '../src/pdf/browserPipeline';
import { toPageText, pageTextToOcr } from '../src/pdf/pdfText';
import { extractSmallStrokes, pageGeometry } from '../src/pdf/vectorText';
import { imageBoxesOnPage, imageGray } from '../src/pdf/imageBoxes';
import { prepareScan, removeLines, estimateSkew, rotateRaster, extractLines, findRings, ringsAtLineEnds } from '../src/pdf/scanPrep';
import { dedupeWords, type Raster } from '../src/pdf/ocr';
import { readSheets } from '../src/pdf/sheetReader';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS } from '../src/engine/sheetMerge';
import type { ExtractedMember } from '../src/engine/qsEngine';
import type { OcrWord, PageOcr } from '../src/pdf/types';
import detUrl from '../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx?url';
import recUrl from '../node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx?url';
import dictUrl from '../node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt?url';

const out = document.getElementById('out')!;
const log = (s: string) => {
  out.textContent += s + '\n';
  console.log(s);
};

const q = new URLSearchParams(location.search);
const mode = q.get('mode') || 'bench'; // 'fallback' | 'bench' | 'all'
const set = q.get('set') || 'cdc_1';
const defaultPages: Record<string, string> = {
  cdc_1: '18,22',
  toilet_604_45: '2',
  house_ready_3: '25,34',
};
const spec = q.get('pages') || defaultPages[set] || '1';
const rounds = Math.max(1, Number(q.get('rounds') || 3));

const MODEL_URLS = { det: detUrl, rec: recUrl, dict: dictUrl };

const bitmapPixels = (img: any) => {
  if (img?.data) return img;
  const bm = img?.bitmap;
  if (!bm?.width) return null;
  const c = document.createElement('canvas');
  c.width = bm.width;
  c.height = bm.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bm, 0, 0);
  const px = { width: bm.width, height: bm.height, kind: 3, data: ctx.getImageData(0, 0, bm.width, bm.height).data };
  c.width = 0;
  c.height = 0;
  return px;
};

/** Prepare 400-DPI scan raster and geometry once so both WASM and WebGPU receive the exact same input. */
async function preparePageInput(page: any, pageNo: number) {
  const t0 = performance.now();
  const vp1 = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const strokes = extractSmallStrokes(ops.fnArray, ops.argsArray, pdfjs.OPS as any, vp1.transform, 15);
  const vt = vp1.transform;
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
  if (!bestPx?.data) throw new Error(`Page ${pageNo}: no embedded raster image found`);
  const { width: w, height: h } = bestPx;
  let gray = imageGray(bestPx)!;
  const [dx, dy] = [bestM[0], bestM[1]];
  const rot = (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 180) : (dy > 0 ? 90 : 270)) % 360;
  let W = w, H = h;
  const rotate = (src: Uint8Array, sw: number, sh: number) => {
    const res = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) res[x * sh + (sh - 1 - y)] = src[y * sw + x];
    return res;
  };
  for (let r = 0; r < rot; r += 90) {
    gray = rotate(gray, W, H);
    [W, H] = [H, W];
  }
  const targetLong = (Math.max(vp1.width, vp1.height) * 400) / 72;
  const k = Math.min(3, Math.max(1, targetLong / Math.max(W, H)));
  let prep = prepareScan(gray, W, H, k);
  const skew = estimateSkew(prep);
  if (Math.abs(skew) >= 0.1) prep = rotateRaster(prep, -skew);
  const pxPerMm = Math.max(prep.width, prep.height) / ((Math.max(vp1.width, vp1.height) / 72) * 25.4);
  const lines = extractLines(prep, Math.round(pxPerMm * 3));
  const endRings = lines ? ringsAtLineEnds(prep, lines, pxPerMm) : [];
  prep = removeLines(prep, Math.round(pxPerMm * 5));
  const blobs = findRings(prep, Math.round(pxPerMm * 4), Math.round(pxPerMm * 16));
  const circles = [...blobs, ...endRings.filter(e => !blobs.some(b => Math.hypot(b[0] - e[0], ((b[1] - e[1]) * prep.height) / prep.width) < b[2] / 2))];
  const geom = pageGeometry(strokes, vp1.width, vp1.height);
  const prepMs = performance.now() - t0;

  return {
    pageNo,
    vpWidth: vp1.width,
    vpHeight: vp1.height,
    raster: prep,
    rects: geom.rects,
    hsegs: lines ? lines.h : geom.hsegs,
    vsegs: lines ? lines.v : geom.vsegs,
    circles: circles.length ? circles : geom.circles,
    prepMs: Math.round(prepMs),
  };
}

// Worker pools:
// - wasmWorkers[0..1]: Baseline 2-Worker WASM pool (flat || turned)
// - gpuWorker        : Candidate 1-Worker WebGPU session (flat -> turned sequential)
const wasmWorkers: [Worker, Worker] = [
  new Worker(new URL('./webgpuWorker.ts', import.meta.url), { type: 'module' }),
  new Worker(new URL('./webgpuWorker.ts', import.meta.url), { type: 'module' }),
];
let gpuWorker = new Worker(new URL('./webgpuWorker.ts', import.meta.url), { type: 'module' });
let msgId = 0;

function recreateGpuWorker() {
  try {
    gpuWorker.terminate();
  } catch {}
  gpuWorker = new Worker(new URL('./webgpuWorker.ts', import.meta.url), { type: 'module' });
}

function callWorker(
  w: Worker,
  payload: {
    raster: Raster;
    backend: 'webgpu' | 'wasm';
    pass?: 'flat' | 'turned' | 'both';
    bucket?: number;
    resetSession?: boolean;
    fault?:
      | 'no_webgpu'
      | 'device_create_fail'
      | 'session_fail'
      | 'model_load_fail'
      | 'runtime_error'
      | 'device_lost';
  },
): Promise<{ words: OcrWord[]; stats: any; adapterInfo?: any; bucketing?: any; backend: string }> {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const done = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', done);
      w.removeEventListener('error', fail);
      w.removeEventListener('messageerror', msgFail);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    const fail = (e: ErrorEvent) => {
      w.removeEventListener('message', done);
      w.removeEventListener('messageerror', msgFail);
      reject(new Error(e.message || `Worker error at ${e.filename}:${e.lineno}`));
    };
    const msgFail = () => {
      w.removeEventListener('message', done);
      w.removeEventListener('error', fail);
      reject(new Error('Worker messageerror'));
    };
    w.addEventListener('message', done);
    w.addEventListener('error', fail, { once: true });
    w.addEventListener('messageerror', msgFail, { once: true });
    w.postMessage({ id, urls: MODEL_URLS, ...payload });
  });
}

/** Baseline: 2 WASM workers running flat and turned in parallel. */
async function runWasmBaseline(raster: Raster, bucket?: number) {
  const t0 = performance.now();
  const [rFlat, rTurned] = await Promise.all([
    callWorker(wasmWorkers[0], { raster, backend: 'wasm', pass: 'flat', bucket }),
    callWorker(wasmWorkers[1], { raster, backend: 'wasm', pass: 'turned', bucket }),
  ]);
  const wallMs = performance.now() - t0;
  const rawWords = [...rFlat.words, ...rTurned.words];
  const words = dedupeWords(rawWords);
  return {
    backend: 'wasm-2w',
    words,
    rawWordCount: rawWords.length,
    wallMs: Math.round(wallMs),
    // Effective critical-path stage breakdown across the 2 parallel workers + sum of both workers
    detMsMax: Math.round(Math.max(rFlat.stats.detMs, rTurned.stats.detMs)),
    recMsMax: Math.round(Math.max(rFlat.stats.recMs, rTurned.stats.recMs)),
    postMsMax: Math.round(Math.max(rFlat.stats.postMs, rTurned.stats.postMs)),
    detMsSum: Math.round(rFlat.stats.detMs + rTurned.stats.detMs),
    recMsSum: Math.round(rFlat.stats.recMs + rTurned.stats.recMs),
    postMsSum: Math.round(rFlat.stats.postMs + rTurned.stats.postMs),
    detTiles: rFlat.stats.detTiles + rTurned.stats.detTiles,
    boxes: rFlat.stats.boxes + rTurned.stats.boxes,
    recCalls: rFlat.stats.recCalls + rTurned.stats.recCalls,
    tensorsDisposed: (rFlat.stats.tensorsDisposed || 0) + (rTurned.stats.tensorsDisposed || 0),
    w0Ms: Math.round(rFlat.stats.totalMs),
    w1Ms: Math.round(rTurned.stats.totalMs),
  };
}

/** Candidate: 1 WebGPU worker running flat then turned sequentially on 1 shared session, with explicit fallback to WASM. */
async function runWebGpuCandidate(
  raster: Raster,
  fault?:
    | 'no_webgpu'
    | 'device_create_fail'
    | 'session_fail'
    | 'model_load_fail'
    | 'runtime_error'
    | 'device_lost',
  bucket?: number,
  resetSession?: boolean,
) {
  const t0 = performance.now();
  try {
    const res = await callWorker(gpuWorker, { raster, backend: 'webgpu', pass: 'both', bucket, resetSession, fault });
    const wallMs = performance.now() - t0;
    const words = dedupeWords(res.words);
    return {
      backend: 'webgpu-1w',
      fellBackToWasm: false,
      fallbackReason: null as string | null,
      adapterInfo: res.adapterInfo,
      bucketing: res.bucketing,
      words,
      rawWordCount: res.words.length,
      wallMs: Math.round(wallMs),
      initMs: Math.round(res.stats.initMs || 0),
      detMs: Math.round(res.stats.detMs),
      recMs: Math.round(res.stats.recMs),
      postMs: Math.round(res.stats.postMs),
      turnedMs: Math.round(res.stats.turnedMs),
      detTiles: res.stats.detTiles,
      boxes: res.stats.boxes,
      recCalls: res.stats.recCalls,
      tensorsDisposed: res.stats.tensorsDisposed || 0,
    };
  } catch (err: any) {
    const reason = err?.message || String(err);
    const fb = await runWasmBaseline(raster, bucket);
    return {
      backend: 'wasm-fallback',
      fellBackToWasm: true,
      fallbackReason: reason,
      adapterInfo: null,
      bucketing: null,
      words: fb.words,
      rawWordCount: fb.rawWordCount,
      wallMs: Math.round(performance.now() - t0),
      initMs: 0,
      detMs: fb.detMsMax,
      recMs: fb.recMsMax,
      postMs: fb.postMsMax,
      turnedMs: fb.w1Ms,
      detTiles: fb.detTiles,
      boxes: fb.boxes,
      recCalls: fb.recCalls,
      tensorsDisposed: fb.tensorsDisposed,
    };
  }
}

/** Compare deduplicated PageOcr words from WebGPU against WASM baseline. */
function compareOcrWords(wasmWords: OcrWord[], gpuWords: OcrWord[]) {
  const used = new Set<number>();
  let matchedBoxes = 0;
  let exactTextMatches = 0;
  let caseInsensitiveMatches = 0;
  let maxCoordDiff = 0;
  let sumCoordDiff = 0;
  const diffs: { wasm: string; gpu: string; confWasm: number; confGpu: number; coordDiff: number }[] = [];

  for (const w of wasmWords) {
    const wcx = (w.x0 + w.x1) / 2;
    const wcy = (w.y0 + w.y1) / 2;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let j = 0; j < gpuWords.length; j++) {
      if (used.has(j) || gpuWords[j].vertical !== w.vertical) continue;
      const g = gpuWords[j];
      const gcx = (g.x0 + g.x1) / 2;
      const gcy = (g.y0 + g.y1) / 2;
      const dist = Math.hypot(wcx - gcx, wcy - gcy);
      if (dist < 0.008 && dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      matchedBoxes++;
      const g = gpuWords[bestIdx];
      const cDiff = Math.max(
        Math.abs(w.x0 - g.x0),
        Math.abs(w.y0 - g.y0),
        Math.abs(w.x1 - g.x1),
        Math.abs(w.y1 - g.y1),
      );
      if (cDiff > maxCoordDiff) maxCoordDiff = cDiff;
      sumCoordDiff += cDiff;
      if (w.text === g.text) {
        exactTextMatches++;
        caseInsensitiveMatches++;
      } else {
        if (w.text.toUpperCase() === g.text.toUpperCase()) caseInsensitiveMatches++;
        if (diffs.length < 15) {
          diffs.push({ wasm: w.text, gpu: g.text, confWasm: w.conf, confGpu: g.conf, coordDiff: Number(cDiff.toExponential(2)) });
        }
      }
    }
  }
  const unmatchedWasm = wasmWords.length - matchedBoxes;
  const unmatchedGpu = gpuWords.length - matchedBoxes;
  const textParityPct = matchedBoxes ? Number(((exactTextMatches / matchedBoxes) * 100).toFixed(2)) : 100;
  const boxMatchPct = wasmWords.length ? Number(((matchedBoxes / wasmWords.length) * 100).toFixed(2)) : 100;
  return {
    wasmCount: wasmWords.length,
    gpuCount: gpuWords.length,
    matchedBoxes,
    boxMatchPct,
    exactTextMatches,
    caseInsensitiveMatches,
    textParityPct,
    unmatchedWasm,
    unmatchedGpu,
    maxCoordDiff: Number(maxCoordDiff.toExponential(3)),
    meanCoordDiff: matchedBoxes ? Number((sumCoordDiff / matchedBoxes).toExponential(3)) : 0,
    sampleDiffs: diffs,
  };
}

/** Evaluate readings against real_drawings/<set>/answer_key.json (identical logic to scripts/eval_reading.ts). */
type Key = {
  tag: string;
  type: string;
  count?: number;
  width?: number;
  depth?: number;
  thickness?: number;
  topRebar?: string;
  bottomRebar?: string;
  mainRebar?: string;
  stirrup?: string;
};
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

function evaluateAnswerKey(pages: PageOcr[], key: any, manifest: any) {
  const { readings } = readSheets(pages);
  const merged = mergeSheetReadings(readings, manifest?.pdf || 'x.pdf', {
    ...DEFAULT_MERGE_ASSUMPTIONS,
    footingVariant: manifest?.footingVariant ?? 'แผ่',
  });
  const byTag = new Map<string, ExtractedMember[]>();
  for (const m of merged.members) {
    for (const t of m.tag.split(',')) {
      const k = normTag(t) + ':' + m.memberType;
      byTag.set(k, [...(byTag.get(k) || []), m]);
    }
  }
  const s = { right: 0, wrong: 0, missing: 0, notes: [] as string[] };
  const field = (tag: string, name: string, want: unknown, got: unknown, eq: (a: any, b: any) => boolean) => {
    if (want === undefined) return;
    if (got === undefined || got === null || got === '' || got === 0) {
      s.missing++;
      s.notes.push(`${tag} ${name}: ไม่พบ (แบบ ${want})`);
      return;
    }
    if (eq(want, got)) s.right++;
    else {
      s.wrong++;
      s.notes.push(`${tag} ${name}: ผิด — ระบบ ${got} แบบ ${want}`);
    }
  };
  const plans = readings.filter(r => r.grid?.x?.length || r.grid?.y?.length);
  const gridOk = (axis: 'x' | 'y') =>
    plans.some(r => {
      const g = (r.grid![axis] || []).map(a => a.offset_m);
      if (!key.grid[axis].length) return g.length <= 1;
      return g.length === key.grid[axis].length && g.every((v, i) => Math.abs(v - key.grid[axis][i]) < 0.06);
    });
  const axisText = (v: number[]) => v.join('/') || '(เส้นเดียว)';
  for (const ax of ['x', 'y'] as const) {
    field('grid', ax, axisText(key.grid[ax]), gridOk(ax) ? axisText(key.grid[ax]) : (plans[0]?.grid?.[ax]?.map(a => a.offset_m).join('/') || ''), (a, b) => a === b);
  }
  const keyFootings = (key.members as Key[]).filter(k => k.type === 'FOOTING');
  if (keyFootings.length && keyFootings.every(k => k.count !== undefined)) {
    const n = merged.members.filter(m => m.memberType === 'FOOTING').length;
    field('ฐานรากทั้งหมด', 'จำนวน', keyFootings.reduce((a, k) => a + k.count!, 0), n, (a, b) => a === b);
  }
  let tagsFound = 0;
  for (const k of key.members as Key[]) {
    const ms = byTag.get(normTag(k.tag) + ':' + k.type) || [];
    if (!ms.length) {
      s.missing++;
      s.notes.push(`${k.tag}: ไม่พบเบอร์นี้เลย`);
      continue;
    }
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

const median = (arr: number[]) => {
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

async function runFallbackAndDigitalSuite() {
  log(`=== 1. WebGPU Fallback & Resilience Suite (7 Fault & Crash Modes) ===`);
  // Small synthetic raster with a dark bar so fallback WASM runs quickly
  const tiny: Raster = { data: new Uint8Array(96 * 96).fill(255), width: 96, height: 96 };
  const faults: (
    | 'no_webgpu'
    | 'device_create_fail'
    | 'session_fail'
    | 'model_load_fail'
    | 'runtime_error'
    | 'device_lost'
  )[] = [
    'no_webgpu',
    'device_create_fail',
    'session_fail',
    'model_load_fail',
    'runtime_error',
    'device_lost',
  ];
  const fallbackResults: any[] = [];
  for (const f of faults) {
    const res = await runWebGpuCandidate(tiny, f);
    const passed = res.fellBackToWasm && res.backend === 'wasm-fallback' && !!res.fallbackReason;
    fallbackResults.push({
      fault: f,
      passed,
      fellBackToWasm: res.fellBackToWasm,
      reason: res.fallbackReason,
      wallMs: res.wallMs,
    });
    log(`  [${passed ? 'PASS' : 'FAIL'}] fault=${f} -> fellBackToWasm=${res.fellBackToWasm} | reason="${res.fallbackReason}" (${res.wallMs}ms)`);
  }
  // 7th fault mode: Worker crash / abrupt worker.terminate() mid-request -> catch & fallback to WASM + recreate GPU worker
  const tCrash = performance.now();
  let crashRes: any = null;
  try {
    const p = callWorker(gpuWorker, { raster: tiny, backend: 'webgpu', pass: 'both' });
    // Abruptly terminate worker to simulate renderer/worker OOM crash
    gpuWorker.terminate();
    // Reject any pending call when worker is terminated from host
    await Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('WebGPU Worker terminated unexpectedly (worker crash / OOM)')), 30)),
    ]);
  } catch (err: any) {
    const reason = err?.message || String(err);
    recreateGpuWorker();
    const fb = await runWasmBaseline(tiny);
    crashRes = {
      fault: 'worker_crash',
      passed: true,
      fellBackToWasm: true,
      reason,
      wallMs: Math.round(performance.now() - tCrash),
      words: fb.words.length,
    };
  }
  if (crashRes) {
    fallbackResults.push(crashRes);
    log(`  [PASS] fault=worker_crash -> fellBackToWasm=true | reason="${crashRes.reason}" (${crashRes.wallMs}ms)`);
  }

  // Verify WebGPU recovers cleanly after device_lost and worker_crash
  const recovery = await runWebGpuCandidate(tiny);
  const recovered = !recovery.fellBackToWasm && recovery.backend === 'webgpu-1w';
  log(`  [${recovered ? 'PASS' : 'FAIL'}] WebGPU session recovery after device_lost & worker_crash -> backend=${recovery.backend} (${recovery.wallMs}ms)`);

  log(`\n=== 2. Digital Text Layer Check (dot32_pavilion page 19 + detail page 20) ===`);
  const dotMan: any = await fetch(`/real_drawings/dot32_pavilion/manifest.json`).then(r => r.json());
  const dotKey: any = await fetch(`/real_drawings/dot32_pavilion/answer_key.json`).then(r => r.json());
  const dotPdf = await loadPdf(await (await fetch(`/real_drawings/dot32_pavilion/${dotMan.pdf || 'drawings.pdf'}`)).arrayBuffer());
  const tDot = performance.now();
  const dotPages: PageOcr[] = [];
  for (const pNo of [16, 17, 18, 19, 20, 21]) {
    const pg = await dotPdf.getPage(pNo);
    const vp = pg.getViewport({ scale: 1 });
    const pt = toPageText(pNo, vp, (await pg.getTextContent()) as any);
    const ops = await pg.getOperatorList();
    const strokes = extractSmallStrokes(ops.fnArray, ops.argsArray, pdfjs.OPS as any, vp.transform);
    const geom = pageGeometry(strokes, vp.width, vp.height);
    if (strokes.imageCount) geom.rects.push(...(await imageBoxesOnPage(pg, pdfjs.OPS as any, bitmapPixels, ops)));
    dotPages.push({ ...pageTextToOcr(pt, vp.width, vp.height), ...geom });
  }
  const { readings: dotReadings } = readSheets(dotPages);
  const dotEval = evaluateAnswerKey(dotPages, dotKey, dotMan);
  const dotMs = Math.round(performance.now() - tDot);
  const p19Reading = dotReadings.find(r => r.page === 19);
  const p19Words = dotPages.find(p => p.page === 19)?.words.length || 0;
  log(`  dot32_pavilion p19 (digital text layer): ${p19Words} words, sheet_type=${p19Reading?.sheet_type}, ${p19Reading?.instances.length || 0} instances | Full digital set (p16-21): Right ${dotEval.right} / Wrong ${dotEval.wrong} / Missing ${dotEval.missing} in ${dotMs}ms (0 OCR calls)`);
  await dotPdf.destroy();

  return {
    fallbackResults,
    recoveredAfterDeviceLost: recovered,
    digitalCheck: {
      set: 'dot32_pavilion',
      page: 19,
      words: p19Words,
      sheetType: p19Reading?.sheet_type,
      instances: p19Reading?.instances.length || 0,
      ms: dotMs,
      evalScore: { right: dotEval.right, wrong: dotEval.wrong, missing: dotEval.missing, total: dotEval.total },
    },
  };
}

const getJsHeapMb = () => {
  const mem = (performance as any).memory;
  return mem ? Number((mem.usedJSHeapSize / (1024 * 1024)).toFixed(1)) : null;
};

/**
 * PART 3.2 — Width Bucketing Experiment:
 * Tests Dynamic (bucket=0), Bucket 64, Bucket 128, and Bucket 256 on the prepared page(s),
 * resetting the WebGPU session (`resetSession = true`) before each bucket mode so Cold Round 1
 * vs Warm Round 2/3 shader compilation overhead, unique `[1, 3, 48, W]` shapes, VRAM behavior,
 * and 100% OCR parity against WASM Baseline (`bucket=0`) are measured cleanly.
 */
async function runBucketingExperiment() {
  const buckets = (q.get('buckets') || '0,64,128,256').split(',').map(x => Number(x.trim()));
  const skipWasm = q.get('skipWasm') === '1';
  const man: any = await fetch(`/real_drawings/${set}/manifest.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  const key: any = await fetch(`/real_drawings/${set}/answer_key.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const pdfName = man?.pdf ?? man?.drawingPdf ?? 'drawings.pdf';
  const doc = await loadPdf(await (await fetch(`/real_drawings/${set}/${pdfName}`)).arrayBuffer());
  const pages = parsePageSpec(spec, doc.numPages)!;

  log(`=== PART 3.2 Width Bucketing Experiment (set=${set}, pages=${pages.join(',')}, buckets=${buckets.join(',')}) ===`);
  const preps: Awaited<ReturnType<typeof preparePageInput>>[] = [];
  for (const p of pages) {
    const pg = await doc.getPage(p);
    const prep = await preparePageInput(pg, p);
    preps.push(prep);
    log(`Prepared p${p}: ${prep.raster.width}x${prep.raster.height} in ${prep.prepMs}ms`);
  }
  await doc.destroy();

  // Warm up WASM and run WASM baseline (unbucketed dynamic width) once per page as reference
  const warmRaster: Raster = { data: new Uint8Array(64 * 64).fill(255), width: 64, height: 64 };
  const wasmRefByPage = new Map<number, Awaited<ReturnType<typeof runWasmBaseline>>>();
  if (!skipWasm) {
    await runWasmBaseline(warmRaster, 0);
    for (const prep of preps) {
      const wRes = await runWasmBaseline(prep.raster, 0);
      wasmRefByPage.set(prep.pageNo, wRes);
      log(`WASM Baseline p${prep.pageNo}: ${wRes.wallMs}ms (detMax=${wRes.detMsMax}ms, recMax=${wRes.recMsMax}ms) words=${wRes.words.length}`);
    }
  }

  const bucketSummaries: any[] = [];

  for (const bucket of buckets) {
    log(`\n--- Testing Bucket Mode: ${bucket === 0 ? 'Dynamic (bucket=0)' : `Bucket ${bucket}px`} ---`);
    // Warm up det + 1 tiny rec shape with resetSession=true so model load/session creation is separated from page 1 shader compilation
    const tSessionInit = performance.now();
    await runWebGpuCandidate(warmRaster, undefined, bucket, true);
    const sessionInitMs = Math.round(performance.now() - tSessionInit);
    log(`  Fresh WebGPU Session initialized in ${sessionInitMs}ms [BUCKET_${bucket}_START_TS=${Date.now()}]`);

    const pageResults: any[] = [];
    const gpuPageOcrs: PageOcr[] = [];

    for (const prep of preps) {
      const wasmRef = wasmRefByPage.get(prep.pageNo);
      // Round 1 (Cold shapes for this page), Round 2 (Warm shapes), Round 3 (Warm shapes)
      const r1 = await runWebGpuCandidate(prep.raster, undefined, bucket, false);
      const r2 = await runWebGpuCandidate(prep.raster, undefined, bucket, false);
      const r3 = await runWebGpuCandidate(prep.raster, undefined, bucket, false);

      const refWords = wasmRef ? wasmRef.words : (bucketSummaries[0]?.pageResults?.find((x: any) => x.page === prep.pageNo)?._words || r2.words);
      const parityVsWasm = compareOcrWords(refWords, r2.words);
      const dynGpuWords = bucket === 0 ? r2.words : (bucketSummaries[0]?.pageResults?.find((x: any) => x.page === prep.pageNo)?._words || refWords);
      const parityVsDynGpu = compareOcrWords(dynGpuWords, r2.words);

      log(
        `  p${prep.pageNo} [bucket=${bucket}]: Cold R1=${(r1.wallMs / 1000).toFixed(2)}s (det=${(r1.detMs / 1000).toFixed(2)}s, rec=${(r1.recMs / 1000).toFixed(2)}s) | Warm R2=${(r2.wallMs / 1000).toFixed(2)}s (rec=${(r2.recMs / 1000).toFixed(2)}s) | Warm R3=${(r3.wallMs / 1000).toFixed(2)}s (rec=${(r3.recMs / 1000).toFixed(2)}s) | shapesPage=${r1.bucketing?.uniqueRecShapesPage} (newCompiled=${r1.bucketing?.newShapesCompiledPage}, cum=${r1.bucketing?.uniqueRecShapesCumulative}) | W0=[${r1.bucketing?.minW0}..${r1.bucketing?.maxW0}] -> W=[${r1.bucketing?.minWBucket}..${r1.bucketing?.maxWBucket}] | parity=${parityVsWasm.textParityPct}% (box=${parityVsWasm.boxMatchPct}%, maxCoordDiff=${parityVsWasm.maxCoordDiff})`,
      );

      gpuPageOcrs.push({
        page: prep.pageNo,
        width: prep.vpWidth,
        height: prep.vpHeight,
        words: r2.words,
        rects: prep.rects,
        hsegs: prep.hsegs,
        vsegs: prep.vsegs,
        circles: prep.circles,
      });

      pageResults.push({
        page: prep.pageNo,
        bucket,
        wasmMs: wasmRef?.wallMs || null,
        wasmRecMs: wasmRef?.recMsMax || null,
        coldR1Ms: r1.wallMs,
        coldR1DetMs: r1.detMs,
        coldR1RecMs: r1.recMs,
        warmR2Ms: r2.wallMs,
        warmR2DetMs: r2.detMs,
        warmR2RecMs: r2.recMs,
        warmR3Ms: r3.wallMs,
        warmR3DetMs: r3.detMs,
        warmR3RecMs: r3.recMs,
        warmMedianMs: median([r2.wallMs, r3.wallMs]),
        warmMedianRecMs: median([r2.recMs, r3.recMs]),
        shaderCompileOverheadMs: Math.max(0, r1.recMs - median([r2.recMs, r3.recMs])),
        bucketing: r1.bucketing,
        parityVsWasm,
        parityVsDynGpu,
        _words: r2.words,
      });
    }

    let evalScore: any = null;
    if (key) {
      evalScore = evaluateAnswerKey(gpuPageOcrs, key, man);
      log(`  Answer Key Score [bucket=${bucket}]: Right ${evalScore.right} / Wrong ${evalScore.wrong} / Missing ${evalScore.missing} (of ${evalScore.total})`);
    }
    log(`  [BUCKET_${bucket}_END_TS=${Date.now()}]`);

    bucketSummaries.push({
      bucket,
      sessionInitMs,
      evalScore,
      pageResults: pageResults.map(({ _words, ...rest }) => rest),
      _pageResultsWithWords: pageResults,
    });
    // Keep _words on bucketSummaries[0] temporarily for parityVsDynGpu
    if (bucket === 0) {
      bucketSummaries[0].pageResults = pageResults;
    }
  }
  if (bucketSummaries[0]?.pageResults) {
    bucketSummaries[0].pageResults = bucketSummaries[0].pageResults.map(({ _words, ...rest }: any) => rest);
  }
  for (const b of bucketSummaries) delete b._pageResultsWithWords;

  return { set, pages, buckets, bucketSummaries };
}

/**
 * PART 3.4 & 3.5 — Continuous Multi-Page Stress Test (1p -> 5p -> 10p -> 30p), Worker Termination & Cancellation:
 * Uses the 5 authorized benchmark pages (`toilet_604_45` p2, `cdc_1` p18, p22, `house_ready_3` p25, p34)
 * prepared at 400 DPI, and runs continuous batches of 1, 5, 10, and 30 pages (cycling through the 5 pages)
 * using the hardened WebGPU worker (`bucket=128`), recording timing, JS heap, tensor disposal, cancellation,
 * and `worker.terminate()` memory release timestamps for external `nvidia-smi` correlation.
 */
async function runContinuousStressSuite() {
  const stressBucket = Number(q.get('bucket') || 128);
  const batches = (q.get('batches') || '1,5,10,30').split(',').map(x => Number(x.trim()));
  log(`=== PART 3.4 & 3.5 Continuous Stress Test (batches=${batches.join(',')}, bucket=${stressBucket}) ===`);

  // Load the 5 authorized benchmark pages once into memory
  const specs: { set: string; page: number }[] = [
    { set: 'toilet_604_45', page: 2 },
    { set: 'cdc_1', page: 18 },
    { set: 'cdc_1', page: 22 },
    { set: 'house_ready_3', page: 25 },
    { set: 'house_ready_3', page: 34 },
  ];
  const pool: { label: string; raster: Raster }[] = [];
  const docsBySet = new Map<string, any>();
  for (const s of specs) {
    if (!docsBySet.has(s.set)) {
      const man: any = await fetch(`/real_drawings/${s.set}/manifest.json`).then(r => r.json());
      const pdfName = man?.pdf ?? man?.drawingPdf ?? 'drawings.pdf';
      const doc = await loadPdf(await (await fetch(`/real_drawings/${s.set}/${pdfName}`)).arrayBuffer());
      docsBySet.set(s.set, doc);
    }
    const doc = docsBySet.get(s.set)!;
    const pg = await doc.getPage(s.page);
    const prep = await preparePageInput(pg, s.page);
    pool.push({ label: `${s.set}:p${s.page}`, raster: prep.raster });
    log(`Loaded stress pool page ${s.set}:p${s.page} (${prep.raster.width}x${prep.raster.height})`);
  }
  for (const doc of docsBySet.values()) await doc.destroy();

  recreateGpuWorker();
  const warmRaster: Raster = { data: new Uint8Array(64 * 64).fill(255), width: 64, height: 64 };
  const tColdInit = performance.now();
  const coldWarmRes = await runWebGpuCandidate(warmRaster, undefined, stressBucket, true);
  const coldInitMs = Math.round(performance.now() - tColdInit);
  log(`Cold WebGPU model load + init: ${coldInitMs}ms (jsHeap=${getJsHeapMb()} MB) [STRESS_INIT_TS=${Date.now()}]`);

  const batchReports: any[] = [];
  for (const nPages of batches) {
    const startTs = Date.now();
    const heapBeforeMb = getJsHeapMb();
    log(`\n[BATCH_${nPages}_START_TS=${startTs}] Starting ${nPages}-page continuous batch (heapBefore=${heapBeforeMb} MB)...`);
    const tBatch0 = performance.now();
    const perPageMs: number[] = [];
    const perPageRecMs: number[] = [];
    const perPageWords: number[] = [];
    let totalDisposed = 0;
    let totalNewShapes = 0;
    let cumShapes = 0;
    let anyFallback = false;

    for (let i = 0; i < nPages; i++) {
      const item = pool[i % pool.length];
      const res = await runWebGpuCandidate(item.raster, undefined, stressBucket, false);
      perPageMs.push(res.wallMs);
      perPageRecMs.push(res.recMs);
      perPageWords.push(res.words.length);
      totalDisposed += res.tensorsDisposed;
      totalNewShapes += res.bucketing?.newShapesCompiledPage || 0;
      cumShapes = res.bucketing?.uniqueRecShapesCumulative || cumShapes;
      if (res.fellBackToWasm) anyFallback = true;
      log(
        `  [${i + 1}/${nPages}] ${item.label}: total=${(res.wallMs / 1000).toFixed(2)}s (det=${(res.detMs / 1000).toFixed(2)}s, rec=${(res.recMs / 1000).toFixed(2)}s) words=${res.words.length} newShapes=${res.bucketing?.newShapesCompiledPage || 0} cumShapes=${cumShapes} disposed=${res.tensorsDisposed}`,
      );
    }

    const totalBatchMs = Math.round(performance.now() - tBatch0);
    const endTs = Date.now();
    const heapAfterMb = getJsHeapMb();
    const avgPageMs = Math.round(perPageMs.reduce((a, b) => a + b, 0) / nPages);
    const firstPageMs = perPageMs[0];
    const lastPageMs = perPageMs[perPageMs.length - 1];
    log(
      `[BATCH_${nPages}_END_TS=${endTs}] Completed ${nPages} pages in ${(totalBatchMs / 1000).toFixed(2)}s (avg=${(avgPageMs / 1000).toFixed(2)}s/page, first=${(firstPageMs / 1000).toFixed(2)}s, last=${(lastPageMs / 1000).toFixed(2)}s, cumShapes=${cumShapes}, totalDisposed=${totalDisposed}, heapAfter=${heapAfterMb} MB)`,
    );

    batchReports.push({
      nPages,
      startTs,
      endTs,
      totalBatchMs,
      avgPageMs,
      medianPageMs: median(perPageMs),
      firstPageMs,
      lastPageMs,
      perPageMs,
      perPageRecMs,
      perPageWords,
      totalDisposed,
      totalNewShapes,
      cumShapes,
      anyFallback,
      heapBeforeMb,
      heapAfterMb,
    });
  }

  // Test mid-run Cancellation (Abort + Worker Termination) and Post-Termination VRAM Release
  log(`\n--- Testing Mid-Run Cancellation & Worker Termination Memory Release ---`);
  const cancelStartTs = Date.now();
  const tCancel0 = performance.now();
  // Start an inference on page 0 and cancel after 150ms via worker.terminate()
  const pending = callWorker(gpuWorker, { raster: pool[0].raster, backend: 'webgpu', pass: 'both', bucket: stressBucket });
  await new Promise(r => setTimeout(r, 150));
  gpuWorker.terminate();
  const cancelLatencyMs = Math.round(performance.now() - tCancel0);
  // Ignore the dangling promise
  pending.catch(() => {});
  const terminateTs = Date.now();
  log(`[WORKER_TERMINATED_TS=${terminateTs}] gpuWorker.terminate() executed in ${cancelLatencyMs}ms (mid-inference cancellation)`);
  // Wait 2.5 seconds so external nvidia-smi sampler captures VRAM after worker termination
  await new Promise(r => setTimeout(r, 2500));
  const postTerminateTs = Date.now();
  const heapPostTerminateMb = getJsHeapMb();
  log(`[POST_TERMINATE_2500MS_TS=${postTerminateTs}] 2.5s after worker.terminate() (jsHeap=${heapPostTerminateMb} MB)`);

  // Recreate worker and verify clean recovery after cancellation/termination
  recreateGpuWorker();
  const recovRes = await runWebGpuCandidate(pool[1].raster, undefined, stressBucket, true);
  log(`[POST_RECOVERY_TS=${Date.now()}] Recreated worker & processed ${pool[1].label} in ${(recovRes.wallMs / 1000).toFixed(2)}s (words=${recovRes.words.length}, fellBack=${recovRes.fellBackToWasm})`);

  return {
    stressBucket,
    coldInitMs,
    adapterInfo: coldWarmRes.adapterInfo,
    batchReports,
    cancellationAndTermination: {
      cancelStartTs,
      terminateTs,
      postTerminateTs,
      cancelLatencyMs,
      heapPostTerminateMb,
      recoveredCleanly: !recovRes.fellBackToWasm && recovRes.words.length > 0,
      recoveryPageMs: recovRes.wallMs,
      recoveryWords: recovRes.words.length,
    },
  };
}

(async () => {
  const nav = navigator as any;
  let mainThreadGpu: any = null;
  if (nav.gpu) {
    const ad = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (ad) {
      const info = ad.info || (await ad.requestAdapterInfo?.().catch(() => ({}))) || {};
      mainThreadGpu = {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        maxBufferSize: ad.limits?.maxBufferSize,
        maxStorageBufferBindingSize: ad.limits?.maxStorageBufferBindingSize,
      };
    }
  }
  log(`=== StructBOQ WebGPU vs WASM Benchmark Prototype ===`);
  log(`Detected GPU (Main Thread): ${JSON.stringify(mainThreadGpu)}`);

  let suiteOut: any = null;
  if (mode === 'fallback' || mode === 'all') {
    suiteOut = await runFallbackAndDigitalSuite();
    if (mode === 'fallback') {
      (window as any).__webgpuBench = { mode, mainThreadGpu, ...suiteOut };
      log('DONE');
      return;
    }
  }
  if (mode === 'bucketing') {
    const bucketingOut = await runBucketingExperiment();
    (window as any).__webgpuBench = { mode, mainThreadGpu, ...bucketingOut };
    log('DONE');
    return;
  }
  if (mode === 'stress') {
    const stressOut = await runContinuousStressSuite();
    (window as any).__webgpuBench = { mode, mainThreadGpu, ...stressOut };
    log('DONE');
    return;
  }

  // Warm up both runtimes on a 64x64 synthetic raster so model loading + initial shader compilation are separated
  const warmRaster: Raster = { data: new Uint8Array(64 * 64).fill(255), width: 64, height: 64 };
  const tWarmWasm = performance.now();
  await runWasmBaseline(warmRaster);
  const wasmWarmMs = Math.round(performance.now() - tWarmWasm);

  const tWarmGpu = performance.now();
  const gpuWarmRes = await runWebGpuCandidate(warmRaster);
  const gpuWarmMs = Math.round(performance.now() - tWarmGpu);
  log(`\nWarm-up completed: WASM 2-Worker=${(wasmWarmMs / 1000).toFixed(2)}s | WebGPU 1-Worker=${(gpuWarmMs / 1000).toFixed(2)}s (fellBack=${gpuWarmRes.fellBackToWasm})`);
  if (gpuWarmRes.adapterInfo) {
    log(`Worker WebGPU Adapter: ${JSON.stringify(gpuWarmRes.adapterInfo)}`);
  }

  const man: any = await fetch(`/real_drawings/${set}/manifest.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  const key: any = await fetch(`/real_drawings/${set}/answer_key.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const pdfName = man?.pdf ?? man?.drawingPdf ?? 'drawings.pdf';
  const doc = await loadPdf(await (await fetch(`/real_drawings/${set}/${pdfName}`)).arrayBuffer());
  const pages = parsePageSpec(spec, doc.numPages)!;

  log(`\nDataset=${set} (${pdfName}) pages=${pages.join(',')} rounds=${rounds}`);
  log(`[BENCH_START_TS] ${Date.now()}`);

  const pageBenchmarks: any[] = [];
  const wasmPageOcrs: PageOcr[] = [];
  const gpuPageOcrs: PageOcr[] = [];

  for (const p of pages) {
    log(`\n--- Preparing Page ${p} (400 DPI) ---`);
    const pg = await doc.getPage(p);
    const prep = await preparePageInput(pg, p);
    log(`p${p}: raster ${prep.raster.width}x${prep.raster.height} prepared in ${(prep.prepMs / 1000).toFixed(2)}s`);

    const wasmRuns: Awaited<ReturnType<typeof runWasmBaseline>>[] = [];
    const gpuRuns: Awaited<ReturnType<typeof runWebGpuCandidate>>[] = [];

    for (let r = 0; r < rounds; r++) {
      const order: ('wasm' | 'webgpu')[] = r % 2 === 0 ? ['wasm', 'webgpu'] : ['webgpu', 'wasm'];
      for (const rt of order) {
        if (rt === 'wasm') {
          const res = await runWasmBaseline(prep.raster);
          wasmRuns.push(res);
          log(`  [Round ${r + 1} WASM 2W  ] total=${(res.wallMs / 1000).toFixed(2)}s (w0=${(res.w0Ms / 1000).toFixed(1)}s || w1=${(res.w1Ms / 1000).toFixed(1)}s; detMax=${(res.detMsMax / 1000).toFixed(1)}s, recMax=${(res.recMsMax / 1000).toFixed(1)}s, postMax=${(res.postMsMax / 1000).toFixed(2)}s) words=${res.words.length} disposed=${res.tensorsDisposed}`);
        } else {
          const res = await runWebGpuCandidate(prep.raster);
          gpuRuns.push(res);
          log(`  [Round ${r + 1} WebGPU 1W] total=${(res.wallMs / 1000).toFixed(2)}s (det=${(res.detMs / 1000).toFixed(2)}s, rec=${(res.recMs / 1000).toFixed(2)}s, post=${(res.postMs / 1000).toFixed(2)}s, turnedPass=${(res.turnedMs / 1000).toFixed(2)}s) words=${res.words.length} disposed=${res.tensorsDisposed} fellBack=${res.fellBackToWasm}`);
        }
      }
    }

    const wasmFinal = wasmRuns[wasmRuns.length - 1];
    const gpuFinal = gpuRuns[gpuRuns.length - 1];
    const parity = compareOcrWords(wasmFinal.words, gpuFinal.words);

    const wasmMedTotal = median(wasmRuns.map(x => x.wallMs));
    const wasmMedDet = median(wasmRuns.map(x => x.detMsMax));
    const wasmMedRec = median(wasmRuns.map(x => x.recMsMax));
    const wasmMedPost = median(wasmRuns.map(x => x.postMsMax));

    const gpuMedTotal = median(gpuRuns.map(x => x.wallMs));
    const gpuMedDet = median(gpuRuns.map(x => x.detMs));
    const gpuMedRec = median(gpuRuns.map(x => x.recMs));
    const gpuMedPost = median(gpuRuns.map(x => x.postMs));

    const ocrSpeedup = Number((wasmMedTotal / Math.max(1, gpuMedTotal)).toFixed(2));
    const pageTotalWasm = prep.prepMs + wasmMedTotal;
    const pageTotalGpu = prep.prepMs + gpuMedTotal;
    const pageSpeedup = Number((pageTotalWasm / Math.max(1, pageTotalGpu)).toFixed(2));

    log(`  => p${p} MEDIAN: WASM OCR ${(wasmMedTotal / 1000).toFixed(2)}s (Page ${(pageTotalWasm / 1000).toFixed(2)}s) vs WebGPU OCR ${(gpuMedTotal / 1000).toFixed(2)}s (Page ${(pageTotalGpu / 1000).toFixed(2)}s) | OCR Speedup=${ocrSpeedup}x | Page Speedup=${pageSpeedup}x`);
    log(`  => p${p} PARITY: words WASM=${parity.wasmCount} vs WebGPU=${parity.gpuCount} | boxMatch=${parity.boxMatchPct}% | textParity=${parity.textParityPct}% | maxCoordDiff=${parity.maxCoordDiff}`);

    wasmPageOcrs.push({
      page: p,
      width: prep.vpWidth,
      height: prep.vpHeight,
      words: wasmFinal.words,
      rects: prep.rects,
      hsegs: prep.hsegs,
      vsegs: prep.vsegs,
      circles: prep.circles,
    });
    gpuPageOcrs.push({
      page: p,
      width: prep.vpWidth,
      height: prep.vpHeight,
      words: gpuFinal.words,
      rects: prep.rects,
      hsegs: prep.hsegs,
      vsegs: prep.vsegs,
      circles: prep.circles,
    });

    pageBenchmarks.push({
      set,
      page: p,
      rasterSize: [prep.raster.width, prep.raster.height],
      prepMs: prep.prepMs,
      wasm: {
        medianOcrMs: wasmMedTotal,
        medianPageMs: pageTotalWasm,
        medianDetMs: wasmMedDet,
        medianRecMs: wasmMedRec,
        medianPostMs: wasmMedPost,
        allOcrMs: wasmRuns.map(x => x.wallMs),
        detTiles: wasmFinal.detTiles,
        boxes: wasmFinal.boxes,
        recCalls: wasmFinal.recCalls,
        words: wasmFinal.words.length,
        tensorsDisposed: wasmFinal.tensorsDisposed,
      },
      webgpu: {
        medianOcrMs: gpuMedTotal,
        medianPageMs: pageTotalGpu,
        medianDetMs: gpuMedDet,
        medianRecMs: gpuMedRec,
        medianPostMs: gpuMedPost,
        allOcrMs: gpuRuns.map(x => x.wallMs),
        detTiles: gpuFinal.detTiles,
        boxes: gpuFinal.boxes,
        recCalls: gpuFinal.recCalls,
        words: gpuFinal.words.length,
        tensorsDisposed: gpuFinal.tensorsDisposed,
        fellBackToWasm: gpuRuns.some(x => x.fellBackToWasm),
      },
      ocrSpeedup,
      pageSpeedup,
      parity,
    });
  }

  log(`[BENCH_END_TS] ${Date.now()}`);

  // Evaluate against answer_key.json on the tested pages (and in full-set context when only a subset of pages was benchmarked)
  let accuracyOnTestedPages: any = null;
  let accuracyInSetContext: any = null;
  if (key) {
    const wasmEval = evaluateAnswerKey(wasmPageOcrs, key, man);
    const gpuEval = evaluateAnswerKey(gpuPageOcrs, key, man);
    accuracyOnTestedPages = { wasm: wasmEval, webgpu: gpuEval };
    log(`\n=== Reading Accuracy on Tested Pages Only (${pages.join(',')}) vs answer_key.json ===`);
    log(`  WASM   2W: tags ${wasmEval.tagsFound}/${wasmEval.tags} | Right ${wasmEval.right} / Wrong ${wasmEval.wrong} / Missing ${wasmEval.missing} (of ${wasmEval.total})`);
    log(`  WebGPU 1W: tags ${gpuEval.tagsFound}/${gpuEval.tags} | Right ${gpuEval.right} / Wrong ${gpuEval.wrong} / Missing ${gpuEval.missing} (of ${gpuEval.total})`);

    const offline = await fetch(`/real_drawings/${set}/offline_ocr.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (offline?.pages) {
      const testedSet = new Set(pages);
      const otherPages: PageOcr[] = offline.pages.filter((x: PageOcr) => !testedSet.has(x.page));
      const wasmFull = [...otherPages, ...wasmPageOcrs].sort((a, b) => a.page - b.page);
      const gpuFull = [...otherPages, ...gpuPageOcrs].sort((a, b) => a.page - b.page);
      const wasmFullEval = evaluateAnswerKey(wasmFull, key, man);
      const gpuFullEval = evaluateAnswerKey(gpuFull, key, man);
      accuracyInSetContext = { wasm: wasmFullEval, webgpu: gpuFullEval };
      log(`=== Reading Accuracy with Tested Pages Substituted into Set vs answer_key.json ===`);
      log(`  WASM   2W: tags ${wasmFullEval.tagsFound}/${wasmFullEval.tags} | Right ${wasmFullEval.right} / Wrong ${wasmFullEval.wrong} / Missing ${wasmFullEval.missing} (of ${wasmFullEval.total})`);
      log(`  WebGPU 1W: tags ${gpuFullEval.tagsFound}/${gpuFullEval.tags} | Right ${gpuFullEval.right} / Wrong ${gpuFullEval.wrong} / Missing ${gpuFullEval.missing} (of ${gpuFullEval.total})`);
    }
  }

  await doc.destroy();
  (window as any).__webgpuBench = {
    set,
    pages,
    rounds,
    mainThreadGpu,
    workerAdapterInfo: gpuWarmRes.adapterInfo,
    wasmWarmMs,
    gpuWarmMs,
    pageBenchmarks,
    accuracyOnTestedPages,
    accuracyInSetContext,
    suiteOut,
  };
  log('DONE');
})().catch(e => log('ERROR ' + (e?.stack || e)));
