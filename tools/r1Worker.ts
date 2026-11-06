/**
 * Dev-only worker for R1 middle-ground experiment (tools/, not part of the app build).
 * Accepts { id, raster, urls, pass?: 'flat' | 'turned' | 'both' }.
 *  - 'flat'  : smooth(raster) -> readRaster(p, r, st, false)
 *  - 'turned': smooth(raster) -> turnClockwise -> readRaster(p, r, st, true).filter(!vertical) -> unrotate
 *  - 'both'  : paddleWords(p, raster, st)
 */
import * as ort from 'onnxruntime-web';
import { loadPaddle, paddleWords, newPaddleStats, type Paddle } from '../src/pdf/paddleOcr';
import { unrotate, type Raster } from '../src/pdf/ocr';
import type { OcrWord } from '../src/pdf/types';

ort.env.wasm.numThreads = 1;
let engine: Promise<Paddle> | null = null;
let loads = 0;
const bytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());

const TILE = 960, OVER = 96;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

function smooth(r: Raster): Raster {
  const { data: d, width: W, height: H } = r, out = new Uint8Array(d.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, y - 1); j <= Math.min(H - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(W - 1, x + 1); i++) { s += d[j * W + i]; n++; }
    out[y * W + x] = s / n;
  }
  return { data: out, width: W, height: H };
}

function turnClockwise(r: Raster): Raster {
  const out = new Uint8Array(r.data.length);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) out[x * r.height + (r.height - 1 - y)] = r.data[y * r.width + x];
  return { data: out, width: r.height, height: r.width };
}

async function probabilityMap(p: Paddle, r: Raster, st: ReturnType<typeof newPaddleStats>) {
  const map = new Uint8Array(r.width * r.height);
  for (let ty = 0; ty < Math.max(1, r.height - OVER); ty += TILE - OVER)
    for (let tx = 0; tx < Math.max(1, r.width - OVER); tx += TILE - OVER) {
      const w = Math.min(TILE, r.width - tx), h = Math.min(TILE, r.height - ty);
      const W = Math.ceil(w / 32) * 32, H = Math.ceil(h / 32) * 32;
      const input = new Float32Array(3 * W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = (x < w && y < h ? r.data[(ty + y) * r.width + tx + x] : 255) / 255;
        for (let c = 0; c < 3; c++) input[c * W * H + y * W + x] = (v - MEAN[c]) / STD[c];
      }
      st.detTiles++;
      const out = await p.det.run({ [p.det.inputNames[0]]: new p.ort.Tensor('float32', input, [1, 3, H, W]) });
      const prob = out[p.det.outputNames[0]].data as Float32Array;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (ty + y) * r.width + tx + x, v = Math.round(prob[y * W + x] * 255);
        if (v > map[i]) map[i] = v;
      }
    }
  return map;
}

function textBoxes(map: Uint8Array, W: number, H: number) {
  const seen = new Uint8Array(W * H), stack: number[] = [], boxes: [number, number, number, number][] = [];
  for (let s = 0; s < map.length; s++) {
    if (seen[s] || map[s] < 77) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, sum = 0, n = 0;
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i - x) / W;
      sum += map[i]; n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
        if (j >= 0 && !seen[j] && map[j] >= 77) { seen[j] = 1; stack.push(j); }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (Math.min(w, h) < 3 || sum / n < 153) continue;
    const d = (w * h * 1.5) / (2 * (w + h));
    boxes.push([Math.max(0, Math.round(x0 - d)), Math.max(0, Math.round(y0 - d)), Math.min(W, Math.round(x1 + 1 + d)), Math.min(H, Math.round(y1 + 1 + d))]);
  }
  return boxes;
}

function bilinear(r: Raster, x: number, y: number) {
  const x0 = Math.max(0, Math.min(r.width - 1, Math.floor(x))), y0 = Math.max(0, Math.min(r.height - 1, Math.floor(y)));
  const x1 = Math.min(r.width - 1, x0 + 1), y1 = Math.min(r.height - 1, y0 + 1), fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
  const d = r.data, w = r.width;
  return (d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx) * (1 - fy) + (d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx) * fy;
}

async function readCrop(p: Paddle, r: Raster, [x0, y0, x1, y1]: number[], turned: boolean) {
  const cw = turned ? y1 - y0 : x1 - x0, ch = turned ? x1 - x0 : y1 - y0;
  const H = 48, W = Math.max(16, Math.round((cw * H) / ch));
  const input = new Float32Array(3 * W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = ((x + 0.5) * cw) / W, v = ((y + 0.5) * ch) / H;
    const sx = turned ? x0 + v : x0 + u, sy = turned ? y1 - u : y0 + v;
    const g = bilinear(r, sx - 0.5, sy - 0.5) / 255;
    for (let c = 0; c < 3; c++) input[c * W * H + y * W + x] = (g - 0.5) / 0.5;
  }
  const out = await p.rec.run({ [p.rec.inputNames[0]]: new p.ort.Tensor('float32', input, [1, 3, H, W]) });
  const o = out[p.rec.outputNames[0]], [, T, C] = o.dims as number[], data = o.data as Float32Array;
  const chars: { ch: string; t: number; p: number }[] = [];
  let prev = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    for (let c = 1; c < C; c++) if (data[t * C + c] > data[t * C + best]) best = c;
    if (best && best !== prev) chars.push({ ch: p.dict[best] ?? '', t, p: data[t * C + best] });
    prev = best;
  }
  return { chars, T, conf: chars.length ? chars.reduce((a, c) => a + c.p, 0) / chars.length : 0 };
}

async function readRaster(p: Paddle, r: Raster, st: ReturnType<typeof newPaddleStats>, flatOnly = false): Promise<OcrWord[]> {
  let t = performance.now();
  const map = await probabilityMap(p, r, st);
  st.detMs += performance.now() - t; t = performance.now();
  const boxes = textBoxes(map, r.width, r.height);
  st.postMs += performance.now() - t; st.boxes += boxes.length;
  const words: OcrWord[] = [];
  for (const b of boxes) {
    const [x0, y0, x1, y1] = b, tall = y1 - y0 >= 1.5 * (x1 - x0);
    if (flatOnly && y1 - y0 >= 3 * (x1 - x0)) continue;
    t = performance.now();
    let read = await readCrop(p, r, b, tall), vertical = tall;
    st.recCalls++;
    if (tall && y1 - y0 < 3 * (x1 - x0)) {
      const flat = await readCrop(p, r, b, false);
      st.recCalls++;
      if (flat.conf > read.conf) { read = flat; vertical = false; }
    }
    st.recMs += performance.now() - t;
    if (read.conf < 0.5) continue;
    const len = vertical ? y1 - y0 : x1 - x0, step = len / read.T;
    let cur: typeof read.chars = [];
    const flush = () => {
      const text = cur.map(c => c.ch).join('');
      if (cur.length && /[A-Za-z0-9]/.test(text)) {
        const a0 = Math.max(0, (cur[0].t - 0.5) * step), a1 = Math.min(len, (cur[cur.length - 1].t + 1.5) * step);
        const conf = Math.round((cur.reduce((s, c) => s + c.p, 0) / cur.length) * 100);
        words.push(vertical
          ? { text, conf, vertical: true, x0: x0 / r.width, x1: x1 / r.width, y0: (y1 - a1) / r.height, y1: (y1 - a0) / r.height }
          : { text, conf, vertical: false, x0: (x0 + a0) / r.width, x1: (x0 + a1) / r.width, y0: y0 / r.height, y1: y1 / r.height });
      }
      cur = [];
    };
    for (const c of read.chars) if (c.ch === ' ') flush(); else cur.push(c);
    flush();
  }
  return words;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, raster, urls, pass = 'both' } = e.data;
  try {
    const t0 = performance.now();
    if (!engine) loads++;
    engine ??= (async () => loadPaddle(ort, await bytes(urls.det), await bytes(urls.rec), await (await fetch(urls.dict)).text()))();
    const p = await engine;
    const initMs = performance.now() - t0, t1 = performance.now(), stats = newPaddleStats();
    let words: OcrWord[];
    if (pass === 'flat') {
      words = await readRaster(p, smooth(raster), stats, false);
      stats.wordsKept = words.length;
    } else if (pass === 'turned') {
      const tTurn = performance.now();
      const turned = (await readRaster(p, turnClockwise(smooth(raster)), stats, true)).filter(w => !w.vertical);
      stats.turnedMs = performance.now() - tTurn;
      stats.wordsKept = turned.length;
      words = unrotate(turned);
    } else {
      words = await paddleWords(p, raster, stats);
    }
    self.postMessage({ id, words, stats: { ...stats, initMs, loads, totalMs: performance.now() - t1 } });
  } catch (err) {
    engine = null;
    self.postMessage({ id, error: String(err) });
  }
};
