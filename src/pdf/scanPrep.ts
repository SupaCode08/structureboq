/**
 * Prepare a scanned drawing for OCR: drawing lettering is small (2–3 mm), so a 200 dpi scan gives
 * ~12 px letters — below what tesseract reads well (~25–35 px). Upscale to a target resolution and
 * binarize with Otsu's threshold so grey scan noise and hatching do not become letters.
 */
function resample(gray: Uint8Array, w: number, h: number, scale: number): { data: Uint8Array; width: number; height: number } {
  const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, (y + 0.5) / scale - 0.5), y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1), fy = Math.max(0, sy - y0);
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, (x + 0.5) / scale - 0.5), x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1), fx = Math.max(0, sx - x0);
      const a = gray[y0 * w + x0], b = gray[y0 * w + x1], c = gray[y1 * w + x0], d = gray[y1 * w + x1];
      out[y * W + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return { data: out, width: W, height: H };
}

export function prepareScan(gray: Uint8Array, w: number, h: number, scale: number): { data: Uint8Array; width: number; height: number } {
  const { data: out, width: W, height: H } = resample(gray, w, h, scale);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < out.length; i++) hist[out[i]]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = out.length - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] > thr ? 255 : 0;
  return { data: out, width: W, height: H };
}

/**
 * Scan skew in degrees (counter-clockwise positive), from the long horizontal lines a drawing is full
 * of (grid, dimension, border lines): the angle at which the row-projection of ink is sharpest.
 */
export function estimateSkew(img: { data: Uint8Array; width: number; height: number }, maxDeg = 3, step = 0.1): number {
  const { width: W, height: H, data } = img;
  const sx = Math.max(1, Math.floor(W / 900)), sy = Math.max(1, Math.floor(H / 900));
  const pts: [number, number][] = [];
  for (let y = 0; y < H; y += sy) for (let x = 0; x < W; x += sx) if (!data[y * W + x]) pts.push([x, y]);
  if (pts.length < 500) return 0;
  let best = 0, bestScore = -1;
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += step) {
    const t = Math.tan((a * Math.PI) / 180);
    const bins = new Map<number, number>();
    for (const [x, y] of pts) { const b = Math.round((y + x * t) / sy); bins.set(b, (bins.get(b) || 0) + 1); }
    let score = 0; for (const v of bins.values()) score += v * v;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return Number(best.toFixed(2));
}

/** Rotate a binary raster by `deg` around its centre (nearest neighbour, white fill). */
export function rotateRaster(img: { data: Uint8Array; width: number; height: number }, deg: number) {
  if (Math.abs(deg) < 0.05) return img;
  const { width: W, height: H, data } = img;
  const out = new Uint8Array(W * H).fill(255);
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), cx0 = W / 2, cy0 = H / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx0, dy = y - cy0;
    const ux = Math.round(c * dx - s * dy + cx0), uy = Math.round(s * dx + c * dy + cy0);
    if (ux >= 0 && ux < W && uy >= 0 && uy < H) out[y * W + x] = data[uy * W + ux];
  }
  return { data: out, width: W, height: H };
}

/**
 * Straight ink runs of a binary raster as line segments (normalized 0..1): what grid lines, footing
 * outlines and dimension lines are made of. Runs on neighbouring rows / columns with the same span
 * are one line drawn a few pixels thick.
 */
export function extractLines(img: { data: Uint8Array; width: number; height: number }, runMin: number) {
  const { width: W, height: H, data } = img;
  const merge = (runs: [number, number, number][]) => {
    runs.sort((p, q) => p[2] - q[2] || p[0] - q[0]);
    const open: { a0: number; a1: number; b0: number; b1: number }[] = [];
    const out: [number, number, number][] = [];
    for (const [a0, a1, b] of runs) {
      const o = open.find(x => b - x.b1 <= 2 && Math.abs(x.a0 - a0) <= 3 && Math.abs(x.a1 - a1) <= 3);
      if (o) { o.b1 = b; o.a0 = Math.min(o.a0, a0); o.a1 = Math.max(o.a1, a1); continue; }
      open.push({ a0, a1, b0: b, b1: b });
    }
    for (const o of open) if (o.b1 - o.b0 <= 12) out.push([o.a0, (o.b0 + o.b1) / 2, o.a1]);
    return out;
  };
  const hr: [number, number, number][] = [], vr: [number, number, number][] = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (data[y * W + x]) { x++; continue; }
      let e = x; while (e < W && !data[y * W + e]) e++;
      if (e - x >= runMin) hr.push([x, e, y]);
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (data[y * W + x]) { y++; continue; }
      let e = y; while (e < H && !data[e * W + x]) e++;
      if (e - y >= runMin) vr.push([y, e, x]);
      y = e;
    }
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    h: merge(hr).map(([a0, b, a1]) => [r4(a0 / W), r4(b / H), r4(a1 / W)] as [number, number, number]),
    v: merge(vr).map(([a0, b, a1]) => [r4(b / W), r4(a0 / H), r4(a1 / H)] as [number, number, number]),
  };
}

/**
 * Erase straight ink runs longer than `runMin` px (grid, dimension, outline and table lines) from a
 * binary raster, so only lettering is left — what the vector path achieves by drawing only small
 * strokes. Letters are a few mm tall, so a run several letter heights long is a line, not a letter.
 */
export function removeLines(img: { data: Uint8Array; width: number; height: number }, runMin: number) {
  const { width: W, height: H } = img;
  const src = img.data, out = Uint8Array.from(src);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (src[y * W + x]) { x++; continue; }
      let e = x; while (e < W && !src[y * W + e]) e++;
      if (e - x >= runMin) for (let k = x; k < e; k++) out[y * W + k] = 255;
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (src[y * W + x]) { y++; continue; }
      let e = y; while (e < H && !src[e * W + x]) e++;
      if (e - y >= runMin) for (let k = y; k < e; k++) out[k * W + x] = 255;
      y = e;
    }
  }
  return { data: out, width: W, height: H };
}

/**
 * Circles on a binary raster with the long lines already erased: grid bubbles and section marks.
 * A ring is an ink blob about as wide as tall whose pixels all lie near one radius, around most of
 * the circle (the label inside is a separate blob). Returns [cx, cy, diameter / width], normalized
 * like the vector circles (diameter relative to the page width).
 */
export function findRings(img: { data: Uint8Array; width: number; height: number }, minPx: number, maxPx: number) {
  const { width: W, height: H, data } = img;
  const seen = new Uint8Array(W * H);
  const out: [number, number, number][] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (data[start] || seen[start]) continue;
    const px: number[] = [];
    stack.push(start); seen[start] = 1;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, big = false;
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i - x) / W;
      px.push(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x1 - x0 > maxPx * 1.5 || y1 - y0 > maxPx * 1.5) big = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!data[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (big) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < minPx || w > maxPx || Math.abs(w - h) > 0.15 * Math.max(w, h)) continue;
    const cxp = (x0 + x1) / 2, cyp = (y0 + y1) / 2, r = (w + h) / 4;
    let onRing = 0;
    const sectors = new Set<number>();
    for (const i of px) {
      const x = i % W, y = (i - x) / W, d = Math.hypot(x - cxp, y - cyp);
      if (d > 0.72 * r && d < 1.12 * r) { onRing++; sectors.add(Math.floor(((Math.atan2(y - cyp, x - cxp) + Math.PI) / (2 * Math.PI)) * 16) % 16); }
    }
    if (onRing < 0.85 * px.length || sectors.size < 13) continue;
    if (px.length > 0.45 * Math.PI * r * r) continue;
    out.push([Math.round((cxp / W) * 1e4) / 1e4, Math.round((cyp / H) * 1e4) / 1e4, Math.round(((2 * r) / W) * 1e4) / 1e4]);
  }
  return out;
}

/**
 * Grid bubbles at the ends of long lines (scans): a circle of ink just past a line's end, centred on
 * the line. Sampling the circle survives what breaks a blob test on low-resolution scans (a ring
 * broken into arcs, or still joined to a stub of its grid line). `img` is the binarized raster before
 * line removal; lines as extractLines returns them. Returns [cx, cy, diameter / width].
 */
// angles and their cos/sin are fixed, computed once (same values as before)
const precomputeAngles = (N: number) => {
  const arr: { a: number; cos: number; sin: number }[] = [];
  for (let k = 0; k < N; k++) {
    const a = (2 * Math.PI * k) / N;
    arr.push({ a, cos: Math.cos(a), sin: Math.sin(a) });
  }
  return arr;
};
const ANGLES_24 = precomputeAngles(24);
const ANGLES_36 = precomputeAngles(36);
const ANGLES_48 = precomputeAngles(48);

export function ringsAtLineEnds(
  img: { data: Uint8Array; width: number; height: number },
  lines: { h: [number, number, number][]; v: [number, number, number][] },
  pxPerMm: number,
) {
  const { width: W, height: H, data } = img;
  const ink = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && !data[yi * W + xi]; };
  const minLen = 4 * pxPerMm;
  const score = (cx: number, cy: number, r: number, skip: number) => {
    let inside = 0, tot = 0;
    for (const { cos, sin } of ANGLES_24) for (const f of [0.3, 0.55]) {
      tot++; if (ink(cx + f * r * cos, cy + f * r * sin)) inside++;
    }
    let near = 0, nn = 0;
    for (const { a, cos, sin } of ANGLES_36) {
      const da = Math.abs(((a - skip + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (da < 0.5) continue;
      for (const f of [0.72, 1.3]) { nn++; if (ink(cx + f * r * cos, cy + f * r * sin)) near++; }
    }
    if (!(inside / tot < 0.35 && near / nn < 0.2)) return 0;
    const tol = Math.max(2, 0.12 * r);
    let hit = 0, n = 0;
    for (const { a, cos, sin } of ANGLES_48) {
      const da = Math.abs(((a - skip + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (da < 0.35) continue;
      n++;
      for (let d = -tol; d <= tol; d += 1) if (ink(cx + (r + d) * cos, cy + (r + d) * sin)) { hit++; break; }
    }
    return hit / n;
  };
  const found: [number, number, number][] = [];
  const tried = new Set<string>();
  const tryEnd = (ex: number, ey: number, dx: number, dy: number) => {
    const key = `${ex},${ey},${dx},${dy}`;
    if (tried.has(key)) return;
    tried.add(key);
    let best = { s: 0, r: 0, cx: 0, cy: 0 };
    for (let mm = 3; mm <= 8; mm += 0.25) {
      const r = mm * pxPerMm;
      for (const off of [-0.15, 0, 0.15]) {
        const cx = ex + dx * r * (1 + off), cy = ey + dy * r * (1 + off);
        const sc = score(cx, cy, r, Math.atan2(-dy, -dx));
        if (sc > best.s) best = { s: sc, r, cx, cy };
      }
    }
    if (best.s >= 0.8 && !found.some(f => Math.hypot(f[0] - best.cx, f[1] - best.cy) < best.r)) found.push([best.cx, best.cy, 2 * best.r]);
  };
  for (const [x0, y, x1] of lines.h) {
    if ((x1 - x0) * W < minLen) continue;
    tryEnd(x0 * W, y * H, -1, 0); tryEnd(x1 * W, y * H, 1, 0);
  }
  for (const [x, y0, y1] of lines.v) {
    if ((y1 - y0) * H < minLen) continue;
    tryEnd(x * W, y0 * H, 0, -1); tryEnd(x * W, y1 * H, 0, 1);
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return found.map(([cx, cy, d]) => [r4(cx / W), r4(cy / H), r4(d / W)] as [number, number, number]);
}

/** Rotate a scan raster by quarter turns so it matches the page viewport orientation. */
export function orientScan(gray: Uint8Array, w: number, h: number, baseDeg: number, rotate90: boolean) {
  const rot = (baseDeg + (rotate90 ? 90 : 0)) % 360;
  let W = w, H = h;
  const rotate = (src: Uint8Array, sw: number, sh: number) => {
    const out = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) out[x * sh + (sh - 1 - y)] = src[y * sw + x];
    return out;
  };
  let g = gray;
  for (let r = 0; r < rot; r += 90) { g = rotate(g, W, H); [W, H] = [H, W]; }
  return { gray: g, width: W, height: H };
}

export interface EmbeddedScanOpts {
  dpi?: number;
  raw?: boolean;
  noDeskew?: boolean;
  keepLines?: boolean;
  lineMm?: number;
}

/** One copy for the app and the Node measuring scripts, so they cannot drift again. */
export function prepareEmbeddedScan(
  gray: Uint8Array,
  W: number,
  H: number,
  pageLongPt: number,
  rotate90: boolean,
  opts: EmbeddedScanOpts = {},
) {
  const targetLong = (pageLongPt * (opts.dpi ?? 400)) / 72;
  const k = Math.min(3, Math.max(1, targetLong / Math.max(W, H)));
  let prep = opts.raw ? { data: gray, width: W, height: H } : prepareScan(gray, W, H, k);
  if (!opts.raw && !opts.noDeskew) {
    const skew = estimateSkew(prep);
    if (Math.abs(skew) >= 0.1) prep = rotateRaster(prep, -skew);
  }
  const pxPerMm = Math.max(prep.width, prep.height) / ((pageLongPt / 72) * 25.4);
  const lines = opts.raw ? undefined : (rotate90 ? undefined : extractLines(prep, Math.round(pxPerMm * 3)));
  const endRings = lines && !rotate90 ? ringsAtLineEnds(prep, lines, pxPerMm) : [];
  if (!opts.raw && !opts.keepLines) prep = removeLines(prep, Math.round(pxPerMm * (opts.lineMm ?? 5)));
  const blobs = opts.raw || rotate90 ? [] : findRings(prep, Math.round(pxPerMm * 4), Math.round(pxPerMm * 16));
  const circles = opts.raw || rotate90 ? undefined
    : [...blobs, ...endRings.filter(e => !blobs.some(b => Math.hypot(b[0] - e[0], ((b[1] - e[1]) * prep.height) / prep.width) < b[2] / 2))];
  return { raster: prep, width: prep.width, height: prep.height, lines, circles };
}

