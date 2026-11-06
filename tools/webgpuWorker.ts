/**
 * Prototype Worker for WebGPU vs WASM PaddleOCR Benchmark & Hardening (tools/ only, production src/ untouched).
 * Reuses the exact `paddleWords` / `textBoxes` / `readCrop` algorithm from `../src/pdf/paddleOcr` while:
 *  - Selecting `executionProviders: ['webgpu']` or `['wasm']` explicitly (no silent implicit fallback).
 *  - Using a single session (`det` + `rec`) for sequential `flat` -> `turned` passes on WebGPU.
 *  - Explicitly calling `.dispose()` on every input and output ORT tensor after each 960x960 tile and crop.
 *  - Supporting Recognition Width Bucketing (`bucket = 0 | 64 | 128 | 256`) with white padding (`255`) and aspect-ratio preservation.
 *  - Supporting injected fault modes (`fault`) to verify fallback handling deterministically.
 */
import * as ort from 'onnxruntime-web';
import { paddleWords, newPaddleStats, type Paddle, type PaddleStats } from '../src/pdf/paddleOcr';
import type { Raster } from '../src/pdf/ocr';
import type { OcrWord } from '../src/pdf/types';

ort.env.wasm.numThreads = 1;

let gpuEngine: Promise<{ paddle: Paddle; adapterInfo: any }> | null = null;
let wasmEngine: Promise<Paddle> | null = null;
let gpuLoads = 0;
let wasmLoads = 0;
let tensorsDisposed = 0;
const seenRecShapesGlobal = new Set<number>();

const fetchBytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());

const TILE = 960;
const OVER = 96;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

function textBoxes(map: Float32Array, w: number, h: number): [number, number, number, number][] {
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || map[i] < 0.3) continue;
    let head = 0;
    let tail = 0;
    q[tail++] = i;
    seen[i] = 1;
    let x0 = i % w;
    let x1 = x0;
    let y0 = (i / w) | 0;
    let y1 = y0;
    let sum = 0;
    while (head < tail) {
      const p = q[head++];
      const x = p % w;
      const y = (p / w) | 0;
      sum += map[p];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const n of [p - 1, p + 1, p - w, p + w]) {
        if (n >= 0 && n < w * h && !seen[n] && map[n] >= 0.3 && Math.abs((n % w) - x) <= 1) {
          seen[n] = 1;
          q[tail++] = n;
        }
      }
    }
    if (tail < 12 || sum / tail < 0.5) continue;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const padX = Math.max(3, Math.round(Math.min(bw, bh) * 0.45));
    const padY = Math.max(2, Math.round(Math.min(bw, bh) * 0.35));
    out.push([
      Math.max(0, x0 - padX),
      Math.max(0, y0 - padY),
      Math.min(w, x1 + 1 + padX),
      Math.min(h, y1 + 1 + padY),
    ]);
  }
  return out;
}

export interface BucketingStats {
  bucket: number;
  uniqueRecShapesPage: number;
  uniqueRecShapesCumulative: number;
  newShapesCompiledPage: number;
  minW0: number;
  maxW0: number;
  minWBucket: number;
  maxWBucket: number;
  sampleMappings: { w0: number; wBucket: number }[];
}

async function detectTileBucketed(
  p: Paddle,
  r: Raster,
  ox: number,
  oy: number,
  stats?: PaddleStats,
): Promise<[number, number, number, number][]> {
  const tw = Math.min(TILE, r.width - ox);
  const th = Math.min(TILE, r.height - oy);
  const h = Math.max(32, Math.ceil(th / 32) * 32);
  const w = Math.max(32, Math.ceil(tw / 32) * 32);
  const wh = w * h;
  const input = new Float32Array(3 * wh);
  for (let y = 0; y < h; y++) {
    const sy = oy + Math.min(th - 1, y);
    for (let x = 0; x < w; x++) {
      const g = r.data[sy * r.width + ox + Math.min(tw - 1, x)] / 255;
      const idx = y * w + x;
      input[idx] = (g - MEAN[0]) / STD[0];
      input[wh + idx] = (g - MEAN[1]) / STD[1];
      input[2 * wh + idx] = (g - MEAN[2]) / STD[2];
    }
  }
  const t0 = performance.now();
  const out = await p.det.run({ x: new p.ort.Tensor('float32', input, [1, 3, h, w]) });
  if (stats) {
    stats.detMs += performance.now() - t0;
    stats.detTiles++;
  }
  const map = out[Object.keys(out)[0]].data as Float32Array;
  const t1 = performance.now();
  const boxes = textBoxes(map, w, h)
    .filter(([x0, y0]) => x0 < tw && y0 < th)
    .map(([x0, y0, x1, y1]): [number, number, number, number] => [
      ox + x0,
      oy + y0,
      ox + Math.min(tw, x1),
      oy + Math.min(th, y1),
    ]);
  if (stats) stats.postMs += performance.now() - t1;
  return boxes;
}

/**
 * Recognition crop reader with optional Width Bucketing (`bucket = 0 | 64 | 128 | 256`):
 *  - Original unpadded width at height H=48 is `W0 = Math.max(16, Math.round((cw * H) / ch))` (preserves exact aspect ratio, never crops text).
 *  - Padded width is `W = bucket > 0 ? Math.ceil(W0 / bucket) * bucket : W0`.
 *  - Pixels `0 <= x < W0` sample from the original crop using `u = ((x + 0.5) * cw) / W0`.
 *  - Pixels `W0 <= x < W` are padded with white paper (`255` -> `g = 1.0` -> `(1.0 - 0.5) / 0.5 = +1.0`).
 *  - Character horizontal positions `[a, b]` are mapped back using the unpadded content width `T0 = T * (W0 / W)`:
 *    `step = cw / T0 = (cw * W) / (T * W0)`.
 */
async function readCropBucketed(
  p: Paddle,
  r: Raster,
  box: [number, number, number, number],
  turned: boolean,
  bucket: number,
  bStats: BucketingStats,
  pageShapes: Set<number>,
  stats?: PaddleStats,
): Promise<{ text: string; conf: number; a: number; b: number }[]> {
  const [x0, y0, x1, y1] = box;
  const cw = turned ? y1 - y0 : x1 - x0;
  const ch = turned ? x1 - x0 : y1 - y0;
  const H = 48;
  const W0 = Math.max(16, Math.round((cw * H) / ch));
  const W = bucket > 0 ? Math.ceil(W0 / bucket) * bucket : W0;

  if (W0 < bStats.minW0) bStats.minW0 = W0;
  if (W0 > bStats.maxW0) bStats.maxW0 = W0;
  if (W < bStats.minWBucket) bStats.minWBucket = W;
  if (W > bStats.maxWBucket) bStats.maxWBucket = W;
  if (bStats.sampleMappings.length < 12 && !bStats.sampleMappings.some(m => m.w0 === W0)) {
    bStats.sampleMappings.push({ w0: W0, wBucket: W });
  }
  pageShapes.add(W);
  if (!seenRecShapesGlobal.has(W)) {
    seenRecShapesGlobal.add(W);
    bStats.newShapesCompiledPage++;
  }

  const wh = W * H;
  // Pre-fill with +1.0 (which corresponds to grayscale 255 white paper: (255/255 - 0.5)/0.5 = +1.0)
  const input = new Float32Array(3 * wh).fill(1.0);
  for (let y = 0; y < H; y++) {
    const v = ((y + 0.5) * ch) / H;
    for (let x = 0; x < W0; x++) {
      const u = ((x + 0.5) * cw) / W0;
      const sx = Math.min(r.width - 1, Math.max(0, Math.floor(turned ? x0 + ch - 1 - v : x0 + u)));
      const sy = Math.min(r.height - 1, Math.max(0, Math.floor(turned ? y0 + u : y0 + v)));
      const g = (r.data[sy * r.width + sx] / 255 - 0.5) / 0.5;
      const idx = y * W + x;
      input[idx] = input[wh + idx] = input[2 * wh + idx] = g;
    }
  }
  const t0 = performance.now();
  const out = await p.rec.run({ x: new p.ort.Tensor('float32', input, [1, 3, H, W]) });
  if (stats) {
    stats.recMs += performance.now() - t0;
    stats.recCalls++;
  }
  const t1 = performance.now();
  const t = out[Object.keys(out)[0]];
  const [, T, C] = t.dims;
  const data = t.data as Float32Array;
  // Valid unpadded timesteps (in case white padding at the right edge ever emits anything, clamp to valid content region)
  const T0 = bucket > 0 ? (T * W0) / W : T;
  const maxValidT = bucket > 0 ? Math.min(T, Math.ceil(T0) + 1) : T;
  const chars: { ch: string; p: number; t: number }[] = [];
  let prev = 0;
  for (let i = 0; i < maxValidT; i++) {
    const off = i * C;
    let best = 0;
    let bestP = data[off];
    for (let c = 1; c < C; c++) {
      if (data[off + c] > bestP) {
        bestP = data[off + c];
        best = c;
      }
    }
    if (best !== 0 && best !== prev && best < p.dict.length) {
      chars.push({ ch: p.dict[best], p: bestP, t: Math.min(i, T0 - 0.5) });
    }
    prev = best;
  }
  if (!chars.length) {
    if (stats) stats.postMs += performance.now() - t1;
    return [];
  }
  const step = cw / T0;
  const groups: (typeof chars)[] = [[chars[0]]];
  for (let i = 1; i < chars.length; i++) {
    if (chars[i].ch === ' ') continue;
    const last = groups[groups.length - 1];
    if (chars[i - 1].ch === ' ' && (chars[i].t - last[last.length - 1].t) * step > ch * 0.8) {
      groups.push([chars[i]]);
    } else {
      last.push(chars[i]);
    }
  }
  const res = groups.map(g => ({
    text: g.map(c => c.ch).join(''),
    conf: (g.reduce((s, c) => s + c.p, 0) / g.length) * 100,
    a: Math.max(0, (g[0].t - 0.5) * step),
    b: Math.min(cw, (g[g.length - 1].t + 1.5) * step),
  }));
  if (stats) stats.postMs += performance.now() - t1;
  return res;
}

async function readRasterBucketed(
  p: Paddle,
  r: Raster,
  flatOnly: boolean,
  bucket: number,
  bStats: BucketingStats,
  pageShapes: Set<number>,
  stats?: PaddleStats,
): Promise<OcrWord[]> {
  const step = TILE - OVER;
  const raw: [number, number, number, number][] = [];
  for (let oy = 0; oy < r.height; oy += step) {
    for (let ox = 0; ox < r.width; ox += step) {
      raw.push(...(await detectTileBucketed(p, r, ox, oy, stats)));
      if (ox + TILE >= r.width) break;
    }
    if (oy + TILE >= r.height) break;
  }
  const tPost0 = performance.now();
  const boxes = raw.filter((b, i) => {
    const a = (b[2] - b[0]) * (b[3] - b[1]);
    return !raw.some((o, j) => {
      if (i === j) return false;
      const ix = Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0]));
      const iy = Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1]));
      const oa = (o[2] - o[0]) * (o[3] - o[1]);
      return ix * iy > 0.6 * a && (oa > a || (oa === a && j < i));
    });
  });
  if (stats) {
    stats.postMs += performance.now() - tPost0;
    stats.boxes += boxes.length;
  }
  const words: OcrWord[] = [];
  for (const [x0, y0, x1, y1] of boxes) {
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (flatOnly && bh > bw * 1.5) continue;
    const vertical = !flatOnly && bh > bw * 1.5;
    for (const part of await readCropBucketed(p, r, [x0, y0, x1, y1], vertical, bucket, bStats, pageShapes, stats)) {
      if (!part.text || part.conf < 50) continue;
      const [wx0, wy0, wx1, wy1] = vertical
        ? [x0, y0 + part.a, x1, y0 + part.b]
        : [x0 + part.a, y0, x0 + part.b, y1];
      words.push({
        text: part.text,
        conf: part.conf,
        vertical,
        x0: wx0 / r.width,
        y0: wy0 / r.height,
        x1: wx1 / r.width,
        y1: wy1 / r.height,
      });
    }
  }
  return words;
}

const rotate90 = (r: Raster): Raster => {
  const { width: w, height: h, data } = r;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = data[y * w + x];
  }
  return { data: out, width: h, height: w };
};

async function paddleWordsWithBucketing(
  p: Paddle,
  r: Raster,
  bucket: number,
  stats?: PaddleStats,
  pass: 'flat' | 'turned' | 'both' = 'both',
): Promise<{ words: OcrWord[]; bucketing: BucketingStats }> {
  const pageShapes = new Set<number>();
  const bStats: BucketingStats = {
    bucket,
    uniqueRecShapesPage: 0,
    uniqueRecShapesCumulative: 0,
    newShapesCompiledPage: 0,
    minW0: Infinity,
    maxW0: 0,
    minWBucket: Infinity,
    maxWBucket: 0,
    sampleMappings: [],
  };

  // When bucket === 0, use the exact same code path while still recording shape telemetry
  const flat = pass === 'turned' ? [] : await readRasterBucketed(p, r, false, bucket, bStats, pageShapes, stats);
  let turned: OcrWord[] = [];
  if (pass !== 'flat') {
    const tTurn0 = performance.now();
    turned = (await readRasterBucketed(p, rotate90(r), true, bucket, bStats, pageShapes, stats)).map(w => ({
      text: w.text,
      conf: w.conf,
      vertical: true,
      x0: w.y0,
      y0: 1 - w.x1,
      x1: w.y1,
      y1: 1 - w.x0,
    }));
    if (stats) stats.turnedMs += performance.now() - tTurn0;
  }

  bStats.uniqueRecShapesPage = pageShapes.size;
  bStats.uniqueRecShapesCumulative = seenRecShapesGlobal.size;
  if (bStats.minW0 === Infinity) bStats.minW0 = 0;
  if (bStats.minWBucket === Infinity) bStats.minWBucket = 0;

  return {
    words: pass === 'both' ? [...flat, ...turned] : pass === 'flat' ? flat : turned,
    bucketing: bStats,
  };
}

function wrapSessionWithDispose(session: any) {
  const origRun = session.run.bind(session);
  session.run = async (feeds: Record<string, any>) => {
    let out: Record<string, any> | undefined;
    try {
      out = await origRun(feeds);
      const copied: Record<string, { dims: readonly number[]; data: Float32Array }> = {};
      for (const k of Object.keys(out!)) {
        const t = out![k];
        const raw: Float32Array = t.data instanceof Float32Array ? t.data : await t.getData();
        copied[k] = { dims: t.dims, data: new Float32Array(raw) };
      }
      return copied;
    } finally {
      for (const k of Object.keys(feeds)) {
        try {
          if (typeof feeds[k]?.dispose === 'function') {
            feeds[k].dispose();
            tensorsDisposed++;
          }
        } catch {}
      }
      if (out) {
        for (const k of Object.keys(out)) {
          try {
            if (typeof out[k]?.dispose === 'function') {
              out[k].dispose();
              tensorsDisposed++;
            }
          } catch {}
        }
      }
    }
  };
  return session;
}

async function initWebGpuPaddle(urls: { det: string; rec: string; dict: string }, fault?: string) {
  if (fault === 'no_webgpu') {
    throw new Error('WebGPU unavailable: navigator.gpu is disabled or unsupported');
  }
  const nav = self.navigator as any;
  if (!nav?.gpu) {
    throw new Error('WebGPU unavailable in this browser Worker (navigator.gpu missing)');
  }
  const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('WebGPU requestAdapter() returned null');
  }
  if (fault === 'device_create_fail') {
    throw new Error('WebGPU adapter.requestDevice() failed (device creation rejected)');
  }
  if (fault === 'session_fail') {
    throw new Error('Simulated WebGPU session creation failure (VRAM / shader compilation error)');
  }
  if (fault === 'model_load_fail') {
    // Pass a corrupted/HTML response buffer (as happens on 404 SPA fallback or truncated model download) to InferenceSession.create
    const badBytes = new TextEncoder().encode('<!doctype html><html><body>404 Not Found</body></html>');
    await ort.InferenceSession.create(badBytes, { executionProviders: ['webgpu'] });
  }
  const info = adapter.info || (await adapter.requestAdapterInfo?.().catch(() => ({}))) || {};
  const adapterInfo = {
    vendor: info.vendor || '',
    architecture: info.architecture || '',
    device: info.device || '',
    description: info.description || '',
    maxBufferSize: adapter.limits?.maxBufferSize || 0,
    maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize || 0,
  };
  const [detBytes, recBytes, dictText] = await Promise.all([
    fetchBytes(urls.det),
    fetchBytes(urls.rec),
    fetch(urls.dict).then(r => {
      if (!r.ok) throw new Error(`Dictionary fetch failed: HTTP ${r.status}`);
      return r.text();
    }),
  ]);
  const det = wrapSessionWithDispose(
    await ort.InferenceSession.create(detBytes, { executionProviders: ['webgpu'] }),
  );
  const rec = wrapSessionWithDispose(
    await ort.InferenceSession.create(recBytes, { executionProviders: ['webgpu'] }),
  );
  const dict = ['', ...dictText.split(/\r?\n/).filter((_, i, a) => i < a.length - 1 || a[i]), ' '];
  return { paddle: { ort, det, rec, dict } as Paddle, adapterInfo };
}

async function initWasmPaddle(urls: { det: string; rec: string; dict: string }) {
  const [detBytes, recBytes, dictText] = await Promise.all([
    fetchBytes(urls.det),
    fetchBytes(urls.rec),
    fetch(urls.dict).then(r => r.text()),
  ]);
  const det = wrapSessionWithDispose(
    await ort.InferenceSession.create(detBytes, { executionProviders: ['wasm'] }),
  );
  const rec = wrapSessionWithDispose(
    await ort.InferenceSession.create(recBytes, { executionProviders: ['wasm'] }),
  );
  const dict = ['', ...dictText.split(/\r?\n/).filter((_, i, a) => i < a.length - 1 || a[i]), ' '];
  return { ort, det, rec, dict } as Paddle;
}

self.onmessage = async (e: MessageEvent) => {
  const {
    id,
    raster,
    urls,
    backend = 'wasm',
    pass = 'both',
    bucket,
    resetSession,
    fault,
  }: {
    id: number;
    raster: Raster;
    urls: { det: string; rec: string; dict: string };
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
  } = e.data;

  try {
    const t0 = performance.now();
    const disposedBefore = tensorsDisposed;

    if (resetSession) {
      gpuEngine = null;
      seenRecShapesGlobal.clear();
    }

    if (backend === 'webgpu') {
      if (
        fault === 'no_webgpu' ||
        fault === 'device_create_fail' ||
        fault === 'session_fail' ||
        fault === 'model_load_fail'
      ) {
        await initWebGpuPaddle(urls, fault);
      }
      if (!gpuEngine) {
        gpuLoads++;
        gpuEngine = initWebGpuPaddle(urls);
      }
      const { paddle, adapterInfo } = await gpuEngine;
      const initMs = performance.now() - t0;
      if (fault === 'runtime_error') {
        throw new Error('WebGPU runtime execution error during tile inference');
      }
      if (fault === 'device_lost') {
        gpuEngine = null;
        throw new Error('WebGPU GPUDevice lost during OCR pass (simulated TDR / device.lost)');
      }
      const t1 = performance.now();
      const stats = newPaddleStats();
      let words: OcrWord[];
      let bucketing: BucketingStats | undefined;
      if (bucket !== undefined) {
        const res = await paddleWordsWithBucketing(paddle, raster, bucket, stats, pass);
        words = res.words;
        bucketing = res.bucketing;
      } else {
        words = await paddleWords(paddle, raster, stats, pass);
      }
      self.postMessage({
        id,
        backend: 'webgpu',
        words,
        adapterInfo,
        bucketing,
        stats: {
          ...stats,
          initMs,
          loads: gpuLoads,
          totalMs: performance.now() - t1,
          tensorsDisposed: tensorsDisposed - disposedBefore,
        },
      });
    } else {
      if (!wasmEngine) {
        wasmLoads++;
        wasmEngine = initWasmPaddle(urls);
      }
      const paddle = await wasmEngine;
      const initMs = performance.now() - t0;
      const t1 = performance.now();
      const stats = newPaddleStats();
      let words: OcrWord[];
      let bucketing: BucketingStats | undefined;
      if (bucket !== undefined) {
        const res = await paddleWordsWithBucketing(paddle, raster, bucket, stats, pass);
        words = res.words;
        bucketing = res.bucketing;
      } else {
        words = await paddleWords(paddle, raster, stats, pass);
      }
      self.postMessage({
        id,
        backend: 'wasm',
        words,
        bucketing,
        stats: {
          ...stats,
          initMs,
          loads: wasmLoads,
          totalMs: performance.now() - t1,
          tensorsDisposed: tensorsDisposed - disposedBefore,
        },
      });
    }
  } catch (err: any) {
    if (backend === 'webgpu') gpuEngine = null;
    else wasmEngine = null;
    self.postMessage({
      id,
      backend,
      error: err?.message || String(err),
    });
  }
};
