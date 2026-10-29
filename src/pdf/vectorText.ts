/**
 * StructBOQ - recover text from CAD drawings whose lettering was exploded into vector strokes.
 *
 * pdf.js gives every path on the page. Lettering is made of many tiny strokes, while grid,
 * beam and dimension lines are long. We keep only the tiny paths, re-draw them on a blank
 * raster (thick pen, no drawing lines touching the letters) and OCR that clean image.
 * Pure TypeScript: runs in the browser and in Node, no native tools.
 */

export type Pt = [number, number];
export type Polyline = Pt[];

/** pdf.js operator ids we use (subset of pdfjs OPS). */
export interface OpsTable {
  save: number; restore: number; transform: number; constructPath: number;
  moveTo: number; lineTo: number; curveTo: number; curveTo2: number; curveTo3: number; closePath: number; rectangle: number;
  paintImageXObject?: number; paintInlineImageXObject?: number;
}

export type Mat = [number, number, number, number, number, number];
export const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m: Mat, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 6): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

export interface PageStrokes {
  /** Small paths (lettering), in viewport units: points, top-left origin, page rotation applied */
  small: Polyline[];
  /** axis-aligned rectangles drawn on the sheet (section outlines, column squares, footings), points */
  rects: [number, number, number, number][];
  /** horizontal line segments >= 8 pt (section outlines, slab and footing edges): x0, y, x1 */
  hsegs: [number, number, number][];
  /** vertical line segments >= 8 pt: x, y0, y1 */
  vsegs: [number, number, number][];
  /** circles 4–40 pt across (grid bubbles, section marks): centre x, y and diameter */
  circles: [number, number, number][];
  /** small round marks (rebar dots in sections): centre x, y and diameter, points */
  dots: [number, number, number][];
  totalPaths: number;
  imageCount: number;
}

/** Axis-aligned closed 4-corner polyline -> its box (CAD often exports rectangles as polylines). */
function asRect(p: Polyline): [number, number, number, number] | null {
  const pts = p.length >= 5 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.5 ? p.slice(0, -1) : p;
  if (pts.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 0.3 && Math.abs(a[1] - b[1]) > 0.3) return null;
  }
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Walks a pdf.js operator list. `viewport` is page.getViewport({scale:1}).transform.
 * `maxSizePt` = largest path bbox side kept as lettering (body text ~2–4 pt, sheet titles up to ~12 pt).
 */
export function extractSmallStrokes(
  fnArray: number[], argsArray: any[], OPS: OpsTable, viewport: number[], maxSizePt = 15,
  /** text-only pages (e.g. a BOQ in Thai outline fonts): round glyphs like ห น บ ว must not be dropped as circles */
  keepCircles = false,
): PageStrokes {
  let ctm: Mat = viewport as Mat;
  const stack: Mat[] = [];
  const small: Polyline[] = [];
  const rects: [number, number, number, number][] = [];
  const hsegs: [number, number, number][] = [];
  const vsegs: [number, number, number][] = [];
  const circles: [number, number, number][] = [];
  const dots: [number, number, number][] = [];
  let total = 0;
  let images = 0;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as Mat);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) images++;
    else if (fn === OPS.constructPath) {
      const [ops, coords] = args as [number[], number[]];
      total++;
      const polys: Polyline[] = [];
      let cur: Polyline = [];
      let start: Pt | null = null;
      let last: Pt = [0, 0];
      let k = 0;
      let curves = 0;
      for (const op of ops) {
        if (op === OPS.moveTo) {
          if (cur.length > 1) polys.push(cur);
          last = apply(ctm, coords[k], coords[k + 1]); k += 2;
          cur = [last]; start = last;
        } else if (op === OPS.lineTo) {
          last = apply(ctm, coords[k], coords[k + 1]); k += 2;
          cur.push(last);
        } else if (op === OPS.curveTo) {
          const p1 = apply(ctm, coords[k], coords[k + 1]), p2 = apply(ctm, coords[k + 2], coords[k + 3]), p3 = apply(ctm, coords[k + 4], coords[k + 5]);
          k += 6; cur.push(...bezier(last, p1, p2, p3)); last = p3; curves++;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          const a = apply(ctm, coords[k], coords[k + 1]), b = apply(ctm, coords[k + 2], coords[k + 3]);
          k += 4; cur.push(...bezier(last, op === OPS.curveTo2 ? last : a, op === OPS.curveTo2 ? a : b, b)); last = b; curves++;
        } else if (op === OPS.rectangle) {
          const x = coords[k], y = coords[k + 1], w = coords[k + 2], h = coords[k + 3]; k += 4;
          if (cur.length > 1) polys.push(cur);
          const r = [apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h), apply(ctm, x, y)];
          polys.push(r); cur = []; last = r[0];
        } else if (op === OPS.closePath) {
          if (start && cur.length) cur.push(start);
        }
      }
      if (cur.length > 1) polys.push(cur);
      if (!polys.length) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of polys) for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const w = x1 - x0, h = y1 - y0;
      const squarish = Math.min(w, h) >= 5 && Math.max(w, h) / Math.max(0.01, Math.min(w, h)) < 1.3;
      let isCircle = !keepCircles && squarish && curves >= 4;
      if (!keepCircles && squarish && !isCircle) {
        const pts = polys.flat();
        if (pts.length >= 12) {
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const r = pts.map(([x, y]) => Math.hypot(x - mx, y - my));
          const mean = r.reduce((a, b) => a + b, 0) / r.length;
          isCircle = r.every(v => Math.abs(v - mean) < 0.12 * mean);
        }
      }
      if (Math.max(w, h) <= maxSizePt && !isCircle) small.push(...polys);
      for (const p of polys) {
        const r = asRect(p);
        if (r && r[2] - r[0] >= 2 && r[3] - r[1] >= 2) rects.push(r);
        for (let q = 1; q < p.length; q++) {
          const [ax, ay] = p[q - 1], [bx, by] = p[q];
          if (Math.abs(ay - by) < 0.3 && Math.abs(ax - bx) >= 8) hsegs.push([Math.min(ax, bx), (ay + by) / 2, Math.max(ax, bx)]);
          else if (Math.abs(ax - bx) < 0.3 && Math.abs(ay - by) >= 8) vsegs.push([(ax + bx) / 2, Math.min(ay, by), Math.max(ay, by)]);
        }
      }
      if (squarish && (curves >= 4 || isCircle) && Math.max(w, h) >= 4 && Math.max(w, h) <= 40) circles.push([(x0 + x1) / 2, (y0 + y1) / 2, Math.max(w, h)]);
      if (curves >= 2 && Math.max(w, h) >= 0.8 && Math.max(w, h) <= 4 && Math.abs(w - h) < 0.35 * Math.max(w, h)) dots.push([(x0 + x1) / 2, (y0 + y1) / 2, Math.max(w, h)]);
    }
  }
  return { small, rects, hsegs, vsegs, circles, dots, totalPaths: total, imageCount: images };
}

/** Drawn geometry as PageOcr stores it: normalized to the displayed page (0..1), rounded to 1e-4. */
export function pageGeometry(s: PageStrokes, w: number, h: number) {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    rects: s.rects.map(r => [r4(r[0] / w), r4(r[1] / h), r4(r[2] / w), r4(r[3] / h)] as [number, number, number, number]),
    hsegs: s.hsegs.map(g => [r4(g[0] / w), r4(g[1] / h), r4(g[2] / w)] as [number, number, number]),
    vsegs: s.vsegs.map(g => [r4(g[0] / w), r4(g[1] / h), r4(g[2] / h)] as [number, number, number]),
    circles: s.circles.map(c => [r4(c[0] / w), r4(c[1] / h), r4(c[2] / w)] as [number, number, number]),
  };
}

/** Grayscale raster (0 = ink, 255 = paper) of polylines drawn with a square pen. */
export function rasterize(polys: Polyline[], widthPt: number, heightPt: number, scale: number, pen = 3, rotate90 = false) {
  const W = Math.ceil((rotate90 ? heightPt : widthPt) * scale);
  const H = Math.ceil((rotate90 ? widthPt : heightPt) * scale);
  const buf = new Uint8Array(W * H).fill(255);
  const half = Math.floor(pen / 2);
  const dot = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    for (let dy = -half; dy <= half; dy++) {
      const yy = yi + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -half; dx <= half; dx++) {
        const xx = xi + dx;
        if (xx >= 0 && xx < W) buf[yy * W + xx] = 0;
      }
    }
  };
  const tf = (p: Pt): Pt => (rotate90 ? [(heightPt - p[1]) * scale, p[0] * scale] : [p[0] * scale, p[1] * scale]);
  for (const poly of polys) {
    for (let i = 1; i < poly.length; i++) {
      const [ax, ay] = tf(poly[i - 1]), [bx, by] = tf(poly[i]);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let s = 0; s <= steps; s++) dot(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
    }
  }
  return { data: buf, width: W, height: H };
}

/**
 * Fill closed polylines (even-odd, so the holes of "O", "B" stay open) into a raster made by
 * `rasterize` with the same size, scale and rotation: lettering drawn as outline fonts reads far
 * better solid than hollow.
 */
export function fillClosed(r: { data: Uint8Array; width: number; height: number }, polys: Polyline[], widthPt: number, heightPt: number, scale: number, rotate90 = false) {
  const tf = (p: Pt): Pt => (rotate90 ? [(heightPt - p[1]) * scale, p[0] * scale] : [p[0] * scale, p[1] * scale]);
  const closed = polys.filter(p => p.length >= 4 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 0.3).map(p => p.map(tf));
  if (!closed.length) return 0;
  const edges: [number, number, number, number][] = [];
  for (const p of closed) for (let i = 1; i < p.length; i++) edges.push([p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]]);
  let filled = 0;
  for (let y = 0; y < r.height; y++) {
    const yc = y + 0.5, xs: number[] = [];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(r.width - 1, Math.floor(xs[k + 1])); x++) { r.data[y * r.width + x] = 0; filled++; }
    }
  }
  return filled;
}
