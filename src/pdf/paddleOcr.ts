/**
 * PaddleOCR (PP-OCRv4 detection + recognition, ONNX) over a grayscale raster, same code in browser
 * and Node: the caller passes the onnxruntime module and the model bytes. Reads Latin letters and
 * digits on small scanned lettering far better than tesseract; Thai is left to tesseract.
 */
import type { OcrWord } from './types';
import { unrotate, type Raster } from './ocr';

type Ort = typeof import('onnxruntime-web');
export interface Paddle { ort: Ort; det: any; rec: any; dict: string[]; dispose?: () => Promise<void> }
/** timing only (ms) and counts of one paddleWords call; filled in place, never read back */
export interface PaddleStats { detMs: number; recMs: number; postMs: number; turnedMs: number; detTiles: number; boxes: number; recCalls: number; wordsKept: number }
export const newPaddleStats = (): PaddleStats => ({ detMs: 0, recMs: 0, postMs: 0, turnedMs: 0, detTiles: 0, boxes: 0, recCalls: 0, wordsKept: 0 });

export function wrapSessionWithDispose(session: any): any {
  if (!session || session._wrappedWithDispose) return session;
  const origRun = session.run.bind(session);
  const wrapped = async (feeds: Record<string, any>) => {
    let out: Record<string, any> | undefined;
    try {
      out = await origRun(feeds);
      const copied: Record<string, { dims: readonly number[]; data: Float32Array }> = {};
      for (const k of Object.keys(out!)) {
        const t = out![k];
        const raw = t.data instanceof Float32Array ? t.data : await (typeof t.getData === 'function' ? t.getData() : t.data);
        copied[k] = { dims: t.dims, data: new Float32Array(raw) };
      }
      return copied;
    } finally {
      for (const k of Object.keys(feeds)) {
        try {
          if (typeof feeds[k]?.dispose === 'function') feeds[k].dispose();
        } catch {}
      }
      if (out) {
        for (const k of Object.keys(out)) {
          try {
            if (typeof out[k]?.dispose === 'function') out[k].dispose();
          } catch {}
        }
      }
    }
  };
  session.run = wrapped;
  session._wrappedWithDispose = true;
  return session;
}

export async function disposePaddle(p?: Paddle | null): Promise<void> {
  if (!p) return;
  try { await p.det?.release?.(); } catch {}
  try { await p.rec?.release?.(); } catch {}
  try { p.det?.dispose?.(); } catch {}
  try { p.rec?.dispose?.(); } catch {}
}

export async function loadPaddle(
  ort: Ort,
  det: Uint8Array | string,
  rec: Uint8Array | string,
  dictText: string,
  options?: { executionProviders?: ('webgpu' | 'wasm' | 'cpu')[] }
): Promise<Paddle> {
  const sessionOpts = options?.executionProviders ? { executionProviders: options.executionProviders } : undefined;
  const recSession = await ort.InferenceSession.create(rec as any, sessionOpts);
  let detSession: any = null;
  let detLoading: Promise<any> | null = null;
  const ensureDet = async () => {
    if (!det) throw new Error('det model not provided');
    if (detSession) return detSession;
    detLoading ??= ort.InferenceSession.create(det as any, sessionOpts).then((s: any) => {
      detSession = wrapSessionWithDispose(s);
      return detSession;
    });
    return detLoading;
  };
  return {
    ort,
    get det() { return detSession; },
    ensureDet,
    rec: wrapSessionWithDispose(recSession),
    dict: ['', ...dictText.split(/\r?\n/).filter((_, i, a) => i < a.length - 1 || a[i]), ' '],
    dispose: async () => disposePaddle({ ort, det: detSession, rec: recSession, dict: [] }),
  } as Paddle;
}

const TILE = 960, OVER = 96;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

async function probabilityMap(p: Paddle, r: Raster, st?: PaddleStats) {
  const det = p.det ?? await (p as any).ensureDet?.();
  const map = new Uint8Array(r.width * r.height);
  for (let ty = 0; ty < Math.max(1, r.height - OVER); ty += TILE - OVER)
    for (let tx = 0; tx < Math.max(1, r.width - OVER); tx += TILE - OVER) {
      const w = Math.min(TILE, r.width - tx), h = Math.min(TILE, r.height - ty);
      let blank = true;
      for (let y = 0; y < h && blank; y++)
        for (let x = 0; x < w; x++)
          if (r.data[(ty + y) * r.width + tx + x] !== 255) { blank = false; break; }
      // Leaving map at 0 is the same result, because textBoxes only uses pixels >= 77
      if (blank) continue;
      const W = Math.ceil(w / 32) * 32, H = Math.ceil(h / 32) * 32;
      const input = new Float32Array(3 * W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = (x < w && y < h ? r.data[(ty + y) * r.width + tx + x] : 255) / 255;
        for (let c = 0; c < 3; c++) input[c * W * H + y * W + x] = (v - MEAN[c]) / STD[c];
      }
      if (st) st.detTiles++;
      const out = await det.run({ [det.inputNames[0]]: new p.ort.Tensor('float32', input, [1, 3, H, W]) });
      const prob = out[det.outputNames[0]].data as Float32Array;
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

function cropInput(r: Raster, [x0, y0, x1, y1]: number[], turned: boolean) {
  const cw = Math.max(1, turned ? y1 - y0 : x1 - x0), ch = Math.max(1, turned ? x1 - x0 : y1 - y0);
  const H = 48, rawW = Math.max(16, Math.round((cw * H) / ch));
  const W = Math.ceil(rawW / 32) * 32;
  const input = new Float32Array(3 * W * H);
  input.fill(1.0);
  for (let y = 0; y < H; y++) for (let x = 0; x < rawW; x++) {
    const u = ((x + 0.5) * cw) / rawW, v = ((y + 0.5) * ch) / H;
    const sx = turned ? x0 + v : x0 + u, sy = turned ? y1 - u : y0 + v;
    const g = bilinear(r, sx - 0.5, sy - 0.5) / 255;
    const val = (g - 0.5) / 0.5;
    input[y * W + x] = val;
    input[W * H + y * W + x] = val;
    input[2 * W * H + y * W + x] = val;
  }
  return { input, W, wRatio: W / rawW };
}

function decode(p: Paddle, data: Float32Array, T: number, C: number, offset: number) {
  const chars: { ch: string; t: number; p: number }[] = [];
  let prev = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    const row = offset + t * C;
    for (let c = 1; c < C; c++) if (data[row + c] > data[row + best]) best = c;
    if (best && best !== prev) chars.push({ ch: p.dict[best] ?? '', t, p: data[row + best] });
    prev = best;
  }
  return { chars, T, conf: chars.length ? chars.reduce((a, c) => a + c.p, 0) / chars.length : 0 };
}

// Exported for test
export async function readCrops(p: Paddle, r: Raster, jobs: { box: number[]; turned: boolean }[]): Promise<{ chars: { ch: string; t: number; p: number }[]; T: number; conf: number; wRatio: number }[]> {
  if (!jobs.length) return [];
  const results: { chars: { ch: string; t: number; p: number }[]; T: number; conf: number; wRatio: number }[] = new Array(jobs.length);
  const groups = new Map<number, { idx: number; input: Float32Array; wRatio: number }[]>();
  for (let i = 0; i < jobs.length; i++) {
    const { input, W, wRatio } = cropInput(r, jobs[i].box, jobs[i].turned);
    let g = groups.get(W);
    if (!g) { g = []; groups.set(W, g); }
    g.push({ idx: i, input, wRatio });
  }
  for (const [W, items] of groups) {
    const size = 3 * 48 * W;
    for (let i = 0; i < items.length; i += 32) {
      const chunk = items.slice(i, i + 32), n = chunk.length;
      const batchInput = new Float32Array(n * size);
      for (let j = 0; j < n; j++) batchInput.set(chunk[j].input, j * size);
      const out = await p.rec.run({ [p.rec.inputNames[0]]: new p.ort.Tensor('float32', batchInput, [n, 3, 48, W]) });
      const o = out[p.rec.outputNames[0]], [, T, C] = o.dims as number[], data = o.data as Float32Array;
      for (let j = 0; j < n; j++) results[chunk[j].idx] = { ...decode(p, data, T, C, j * T * C), wRatio: chunk[j].wRatio };
    }
  }
  return results;
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

function decodeWordsFromCrop(
  read: { chars: { ch: string; t: number; p: number }[]; T: number; conf: number; wRatio: number },
  [x0, y0, x1, y1]: number[],
  vertical: boolean,
  rW: number,
  rH: number,
): OcrWord[] {
  if (read.conf < 0.5) return [];
  const out: OcrWord[] = [];
  const len = vertical ? y1 - y0 : x1 - x0, step = (len * read.wRatio) / read.T;
  let cur: typeof read.chars = [];
  const flush = () => {
    const text = cur.map(c => c.ch).join('');
    if (cur.length && /[A-Za-z0-9\u0E00-\u0E7F]/.test(text)) {
      const a0 = Math.max(0, (cur[0].t - 0.5) * step), a1 = Math.min(len, (cur[cur.length - 1].t + 1.5) * step);
      const conf = Math.round((cur.reduce((s, c) => s + c.p, 0) / cur.length) * 100);
      out.push(vertical
        ? { text, conf, vertical: true, x0: x0 / rW, x1: x1 / rW, y0: (y1 - a1) / rH, y1: (y1 - a0) / rH }
        : { text, conf, vertical: false, x0: (x0 + a0) / rW, x1: (x0 + a1) / rW, y0: y0 / rH, y1: y1 / rH });
    }
    cur = [];
  };
  for (const c of read.chars) if (c.ch === ' ') flush(); else cur.push(c);
  flush();
  return out;
}

/** Recognize pre-located text line crops directly (skipping DBNet text detection). */
export async function paddleWordsFromBoxes(
  p: Paddle,
  r: Raster,
  jobs: { box: number[]; turned: boolean }[],
  st?: PaddleStats,
  maxRatio = 14,
): Promise<{ words: OcrWord[]; lines: { text: string; conf: number }[] }> {
  if (!jobs.length) return { words: [], lines: [] };
  const shortIdx: number[] = [];
  const shortJobs: { box: number[]; turned: boolean }[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const [x0, y0, x1, y1] = jobs[i].box;
    const cw = jobs[i].turned ? y1 - y0 : x1 - x0;
    const ch = Math.max(1, jobs[i].turned ? x1 - x0 : y1 - y0);
    if (cw / ch < maxRatio) { shortIdx.push(i); shortJobs.push(jobs[i]); }
  }
  const t = performance.now();
  const results = await readCrops(p, r, shortJobs);
  if (st) {
    st.boxes += shortJobs.length;
    st.recCalls += shortJobs.length;
    st.recMs += performance.now() - t;
  }
  const words: OcrWord[] = [];
  const lines: { text: string; conf: number }[] = jobs.map(() => ({ text: '', conf: 0 }));
  for (let k = 0; k < shortJobs.length; k++) {
    const i = shortIdx[k];
    const read = results[k];
    const text = read.chars.map(c => c.ch).join('');
    const conf = Math.round(read.conf * 100);
    lines[i] = { text, conf };
    words.push(...decodeWordsFromCrop(read, jobs[i].box, jobs[i].turned, r.width, r.height));
  }
  if (st) st.wordsKept += words.length;
  return { words, lines };
}

async function readRaster(p: Paddle, r: Raster, st?: PaddleStats, flatOnly = false): Promise<OcrWord[]> {
  let t = performance.now();
  const map = await probabilityMap(p, r, st);
  if (st) { st.detMs += performance.now() - t; t = performance.now(); }
  const boxes = textBoxes(map, r.width, r.height);
  if (st) { st.postMs += performance.now() - t; st.boxes += boxes.length; }
  const keptBoxes: [number, number, number, number][] = [];
  for (const b of boxes) {
    const [x0, y0, x1, y1] = b;
    // a box at least 3x taller than wide always reads vertical, and the caller drops vertical words
    if (flatOnly && y1 - y0 >= 3 * (x1 - x0)) continue;
    keptBoxes.push(b);
  }
  const p1Jobs: { box: number[]; turned: boolean }[] = [];
  const p2Jobs: { box: number[]; turned: boolean }[] = [];
  for (const b of keptBoxes) {
    const [x0, y0, x1, y1] = b, tall = y1 - y0 >= 1.5 * (x1 - x0);
    p1Jobs.push({ box: b, turned: tall });
    if (tall && y1 - y0 < 3 * (x1 - x0)) p2Jobs.push({ box: b, turned: false });
  }
  t = performance.now();
  const p1Results = await readCrops(p, r, p1Jobs);
  const p2Results = await readCrops(p, r, p2Jobs);
  if (st) {
    st.recCalls += p1Jobs.length + p2Jobs.length;
    st.recMs += performance.now() - t;
  }
  const words: OcrWord[] = [];
  let p2Idx = 0;
  for (let i = 0; i < keptBoxes.length; i++) {
    const b = keptBoxes[i];
    const [x0, y0, x1, y1] = b, tall = y1 - y0 >= 1.5 * (x1 - x0);
    let read = p1Results[i], vertical = tall;
    if (tall && y1 - y0 < 3 * (x1 - x0)) {
      const flat = p2Results[p2Idx++];
      if (flat.conf > read.conf) { read = flat; vertical = false; }
    }
    words.push(...decodeWordsFromCrop(read, b, vertical, r.width, r.height));
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
export async function paddleWords(p: Paddle, raster: Raster, st?: PaddleStats, pass: 'flat' | 'turned' | 'both' | 'upright' = 'both'): Promise<OcrWord[]> {
  const r = smooth(raster);
  if (pass === 'upright') {
    // The caller turned the raster; text that is upright here was read on the flat side.
    const words = (await readRaster(p, r, st, true)).filter(w => !w.vertical);
    if (st) st.wordsKept += words.length;
    return words;
  }
  if (pass === 'flat') {
    const flat = await readRaster(p, r, st);
    if (st) st.wordsKept += flat.length;
    return flat;
  }
  if (pass === 'turned') {
    const t = performance.now();
    const turned = (await readRaster(p, turnClockwise(r), st, true)).filter(w => !w.vertical);
    if (st) { st.turnedMs += performance.now() - t; st.wordsKept += turned.length; }
    return unrotate(turned);
  }
  const flat = await readRaster(p, r, st);
  const t = performance.now();
  // the turned pass also adds its det/rec time to detMs/recMs; turnedMs is the pass as a whole
  const turned = (await readRaster(p, turnClockwise(r), st, true)).filter(w => !w.vertical);
  if (st) { st.turnedMs += performance.now() - t; st.wordsKept += flat.length + turned.length; }
  return [...flat, ...unrotate(turned)];
}
