import test from 'node:test';
import assert from 'node:assert/strict';
import { ringsAtLineEnds } from './scanPrep.ts';

// frozen copy of the version before the speed fix, to prove the output is unchanged
function reference(
  img: { data: Uint8Array; width: number; height: number },
  lines: { h: [number, number, number][]; v: [number, number, number][] },
  pxPerMm: number,
) {
  const { width: W, height: H, data } = img;
  const ink = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < W && yi < H && !data[yi * W + xi]; };
  const minLen = 4 * pxPerMm;
  const score = (cx: number, cy: number, r: number, skip: number) => {
    const N = 48, tol = Math.max(2, 0.12 * r);
    let hit = 0, n = 0;
    for (let k = 0; k < N; k++) {
      const a = (2 * Math.PI * k) / N;
      const da = Math.abs(((a - skip + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (da < 0.35) continue;
      n++;
      for (let d = -tol; d <= tol; d += 1) if (ink(cx + (r + d) * Math.cos(a), cy + (r + d) * Math.sin(a))) { hit++; break; }
    }
    let inside = 0, tot = 0;
    for (let k = 0; k < 24; k++) for (const f of [0.3, 0.55]) {
      const a = (2 * Math.PI * k) / 24;
      tot++; if (ink(cx + f * r * Math.cos(a), cy + f * r * Math.sin(a))) inside++;
    }
    let near = 0, nn = 0;
    for (let k = 0; k < 36; k++) {
      const a = (2 * Math.PI * k) / 36;
      const da = Math.abs(((a - skip + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (da < 0.5) continue;
      for (const f of [0.72, 1.3]) { nn++; if (ink(cx + f * r * Math.cos(a), cy + f * r * Math.sin(a))) near++; }
    }
    return inside / tot < 0.35 && near / nn < 0.2 ? hit / n : 0;
  };
  const found: [number, number, number][] = [];
  const tryEnd = (ex: number, ey: number, dx: number, dy: number) => {
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

/** Helper to draw synthetic rasters (Uint8Array, 255 = paper, 0 = ink) */
function canvas(W = 600, H = 400) {
  const data = new Uint8Array(W * H).fill(255);
  const dot = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi >= 0 && yi >= 0 && xi < W && yi < H) data[yi * W + xi] = 0;
  };
  const ring = (cx: number, cy: number, r: number, t = 3) => {
    for (let a = 0; a < 2 * Math.PI; a += 0.002) {
      for (let d = -t / 2; d <= t / 2; d += 0.5) {
        dot(cx + (r + d) * Math.cos(a), cy + (r + d) * Math.sin(a));
      }
    }
  };
  const disc = (cx: number, cy: number, r: number) => {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) dot(cx + x, cy + y);
      }
    }
  };
  const hline = (x0: number, x1: number, y: number, t = 2) => {
    for (let x = x0; x <= x1; x++) for (let d = 0; d < t; d++) dot(x, y + d - 1);
  };
  const vline = (x: number, y0: number, y1: number, t = 2) => {
    for (let y = y0; y <= y1; y++) for (let d = 0; d < t; d++) dot(x + d - 1, y);
  };
  return { img: { data, width: W, height: H }, dot, ring, disc, hline, vline };
}

function lcg(seed = 123456789) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('horizontal and vertical lines ending in drawn rings match reference and find rings', () => {
  const c = canvas(600, 400);
  // Horizontal line ending in a drawn ring (radius 30 px = 5 mm @ 6 px/mm)
  c.hline(100, 200, 150);
  c.ring(230, 150, 30);
  // Vertical line ending in a drawn ring
  c.vline(450, 100, 200);
  c.ring(450, 230, 30);

  const lines: { h: [number, number, number][]; v: [number, number, number][] } = {
    h: [[100 / 600, 150 / 400, 200 / 600]],
    v: [[450 / 600, 100 / 400, 200 / 400]],
  };

  const got = ringsAtLineEnds(c.img, lines, 6);
  const ref = reference(c.img, lines, 6);
  assert.deepEqual(got, ref);
  assert.ok(got.length >= 2, `expected at least 2 rings found, got ${got.length}`);
});

test('line ending in a filled disc must be rejected by both and match reference', () => {
  const c = canvas(600, 400);
  c.hline(100, 200, 150);
  c.disc(230, 150, 30);

  const lines: { h: [number, number, number][]; v: [number, number, number][] } = {
    h: [[100 / 600, 150 / 400, 200 / 600]],
    v: [],
  };

  const got = ringsAtLineEnds(c.img, lines, 6);
  const ref = reference(c.img, lines, 6);
  assert.deepEqual(got, ref);
  assert.equal(got.length, 0, 'filled disc must be rejected');
});

test('line ending in nothing finds no rings and matches reference', () => {
  const c = canvas(600, 400);
  c.hline(100, 200, 150);

  const lines: { h: [number, number, number][]; v: [number, number, number][] } = {
    h: [[100 / 600, 150 / 400, 200 / 600]],
    v: [],
  };

  const got = ringsAtLineEnds(c.img, lines, 6);
  const ref = reference(c.img, lines, 6);
  assert.deepEqual(got, ref);
  assert.equal(got.length, 0, 'line ending in nothing must find 0 rings');
});

test('repeated identical segments in lines list produce identical output to reference', () => {
  const c = canvas(600, 400);
  c.hline(100, 200, 150);
  c.ring(230, 150, 30);
  c.vline(450, 100, 200);
  c.ring(450, 230, 30);

  const linesRepeated: { h: [number, number, number][]; v: [number, number, number][] } = {
    h: [
      [100 / 600, 150 / 400, 200 / 600],
      [100 / 600, 150 / 400, 200 / 600],
      [100 / 600, 150 / 400, 200 / 600],
    ],
    v: [
      [450 / 600, 100 / 400, 200 / 400],
      [450 / 600, 100 / 400, 200 / 400],
    ],
  };

  const got = ringsAtLineEnds(c.img, linesRepeated, 6);
  const ref = reference(c.img, linesRepeated, 6);
  assert.deepEqual(got, ref);
  assert.ok(got.length >= 2, `expected at least 2 rings found, got ${got.length}`);
});

test('raster with fixed-seed random ink noise produces identical output to reference', () => {
  const c = canvas(600, 400);
  c.hline(100, 200, 150);
  c.ring(230, 150, 30);
  c.vline(450, 100, 200);
  c.ring(450, 230, 30);

  const rand = lcg(42);
  for (let i = 0; i < 400; i++) {
    const x = Math.floor(rand() * 600);
    const y = Math.floor(rand() * 400);
    c.dot(x, y);
  }

  const lines: { h: [number, number, number][]; v: [number, number, number][] } = {
    h: [[100 / 600, 150 / 400, 200 / 600]],
    v: [[450 / 600, 100 / 400, 200 / 400]],
  };

  const got = ringsAtLineEnds(c.img, lines, 6);
  const ref = reference(c.img, lines, 6);
  assert.deepEqual(got, ref);
});
