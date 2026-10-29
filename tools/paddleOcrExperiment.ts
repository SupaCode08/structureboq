/**
 * TEST-ONLY COPY of src/pdf/paddleOcr.ts (tools/, not part of the app build) with an experiment switch:
 * in the turned pass, boxes at least 3x taller than wide can be skipped before recognition (paddleWords
 * would drop their words anyway). Box counts come from the box geometry itself. With the switch off this
 * file must give exactly the production result — tools/turnedCheck.ts checks that against the baseline.
 *
 * PaddleOCR (PP-OCRv4 detection + recognition, ONNX) over a grayscale raster, same code in browser
 * and Node: the caller passes the onnxruntime module and the model bytes. Reads Latin letters and
 * digits on small scanned lettering far better than tesseract; Thai is left to tesseract.
 */
import type { OcrWord } from '../src/pdf/types';
import { unrotate, type Raster } from '../src/pdf/ocr';
import type { Paddle } from '../src/pdf/paddleOcr';
/** exact counts of the turned pass, from box geometry (h = y1 - y0, w = x1 - x0 in raster px) */
export interface TurnedDiag { flatBoxes: number; turnedBoxes: number; turnedTall3: number; turnedMid: number; turnedFlat: number; skipped: number; recCalls: number; recMs: number }
export const newTurnedDiag = (): TurnedDiag => ({ flatBoxes: 0, turnedBoxes: 0, turnedTall3: 0, turnedMid: 0, turnedFlat: 0, skipped: 0, recCalls: 0, recMs: 0 });


/** timing only (ms) and counts of one paddleWords call; filled in place, never read back */
export interface PaddleStats { detMs: number; recMs: number; postMs: number; turnedMs: number; detTiles: number; boxes: number; recCalls: number; wordsKept: number }
export const newPaddleStats = (): PaddleStats => ({ detMs: 0, recMs: 0, postMs: 0, turnedMs: 0, detTiles: 0, boxes: 0, recCalls: 0, wordsKept: 0 });


const TILE = 960, OVER = 96;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

async function probabilityMap(p: Paddle, r: Raster, st?: PaddleStats) {
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
      if (st) st.detTiles++;
      const out = await p.det.run({ [p.det.inputNames[0]]: new p.ort.Tensor('float32', input, [1, 3, H, W]) });
      const prob = out[p.det.outputNames[0]].data as Float32Array;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (ty + y) * r.width + tx + x, v = Math.round(prob[y * W + x] * 255);
        if (v > map[i]) map[i] = v;
      }
    }
  return map;
}

/** Text boxes from the probability map: connected regions above 0.3 whose own mean is above 0.6 (thin dimension figures fill little of their box), grown back by DB's unclip. */
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

/** One crop read left to right (turned: crop rotated so bottom-to-top text reads left to right). */
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

/** 3x3 box blur: bilevel scans read as clean grey strokes (thin "1"s survive the model's resize). */
function smooth(r: Raster): Raster {
  const { data: d, width: W, height: H } = r, out = new Uint8Array(d.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, y - 1); j <= Math.min(H - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(W - 1, x + 1); i++) { s += d[j * W + i]; n++; }
    out[y * W + x] = s / n;
  }
  return { data: out, width: W, height: H };
}

async function readRaster(p: Paddle, r: Raster, st?: PaddleStats, ex?: { turned: boolean; skipTall3: boolean; diag: TurnedDiag }): Promise<OcrWord[]> {
  let t = performance.now();
  const map = await probabilityMap(p, r, st);
  if (st) { st.detMs += performance.now() - t; t = performance.now(); }
  const boxes = textBoxes(map, r.width, r.height);
  if (st) { st.postMs += performance.now() - t; st.boxes += boxes.length; }
  const words: OcrWord[] = [];
  for (const b of boxes) {
    const [x0, y0, x1, y1] = b, tall = y1 - y0 >= 1.5 * (x1 - x0);
    if (ex) {
      const h = y1 - y0, w = x1 - x0;
      if (!ex.turned) ex.diag.flatBoxes++;
      else { ex.diag.turnedBoxes++; if (h >= 3 * w) ex.diag.turnedTall3++; else if (tall) ex.diag.turnedMid++; else ex.diag.turnedFlat++; }
      // EXPERIMENT: such a box is read turned only, comes out vertical, and the turned pass drops vertical words
      if (ex.turned && ex.skipTall3 && h >= 3 * w) { ex.diag.skipped++; continue; }
    }
    t = performance.now();
    const tr = performance.now();
    let read = await readCrop(p, r, b, tall), vertical = tall;
    if (st) st.recCalls++;
    if (ex) ex.diag.recCalls++;
    if (tall && y1 - y0 < 3 * (x1 - x0)) {
      const flat = await readCrop(p, r, b, false);
      if (st) st.recCalls++;
      if (ex) ex.diag.recCalls++;
      if (flat.conf > read.conf) { read = flat; vertical = false; }
    }
    if (st) st.recMs += performance.now() - t;
    if (ex) ex.diag.recMs += performance.now() - tr;
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

/** Raster turned 90° clockwise: text written bottom-to-top reads left to right. */
function turnClockwise(r: Raster): Raster {
  const out = new Uint8Array(r.data.length);
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) out[x * r.height + (r.height - 1 - y)] = r.data[y * r.width + x];
  return { data: out, width: r.height, height: r.width };
}

/** Words of a raster, boxes normalized to the raster (0..1); vertical text (second pass on the turned raster) comes back vertical. */
export async function paddleWordsExperiment(p: Paddle, raster: Raster, skipTall3: boolean, diag: TurnedDiag, st?: PaddleStats): Promise<OcrWord[]> {
  const r = smooth(raster);
  const flat = await readRaster(p, r, st, { turned: false, skipTall3, diag });
  const t = performance.now();
  // the turned pass also adds its det/rec time to detMs/recMs; turnedMs is the pass as a whole
  const turned = (await readRaster(p, turnClockwise(r), st, { turned: true, skipTall3, diag })).filter(w => !w.vertical);
  if (st) { st.turnedMs += performance.now() - t; st.wordsKept += flat.length + turned.length; }
  return [...flat, ...unrotate(turned)];
}
