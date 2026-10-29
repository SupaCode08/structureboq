/**
 * Rectangles drawn inside pictures pasted on a vector sheet (shaded footings, outlined stubs), placed
 * on the page through the image transform so the plan reader sees them like drawn rectangles.
 */
import { mul, apply, type Mat, type OpsTable } from './vectorText';

export interface PdfImage { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray; bitmap?: unknown }

type Box = [number, number, number, number];

export function imageGray(img: PdfImage): Uint8Array | null {
  const { width: w, height: h, data, kind } = img;
  if (!data || !w || !h) return null;
  const g = new Uint8Array(w * h);
  if (kind === 1 || data.length < w * h) {
    const rb = Math.ceil(w / 8);
    for (let i = 0; i < w * h; i++) g[i] = (data[Math.floor(i / w) * rb + ((i % w) >> 3)] >> (7 - ((i % w) & 7))) & 1 ? 255 : 0;
    return g;
  }
  const ch = kind === 3 ? 4 : kind === 2 ? 3 : Math.min(4, Math.floor(data.length / (w * h)));
  for (let i = 0; i < w * h; i++) {
    const j = i * ch;
    const a = ch === 4 ? data[j + 3] / 255 : 1;
    g[i] = ch < 3 ? data[j] : (data[j] * 0.3 + data[j + 1] * 0.59 + data[j + 2] * 0.11) * a + 255 * (1 - a);
  }
  return g;
}

export function boxesInRaster(gray: Uint8Array, w: number, h: number, minSide = 6): Box[] {
  const out: Box[] = [];
  const add = (b: Box) => { if (!out.some(o => o.every((v, k) => Math.abs(v - b[k]) <= 1))) out.push(b); };
  const components = (on: (i: number) => boolean, diagonal: boolean) => {
    const label = new Int32Array(w * h).fill(-1);
    const comps: { x0: number; y0: number; x1: number; y1: number; id: number }[] = [];
    const steps = diagonal ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let s = 0; s < w * h; s++) {
      if (label[s] >= 0 || !on(s)) continue;
      const c = { x0: w, y0: h, x1: 0, y1: 0, id: comps.length };
      const stack = [s];
      label[s] = c.id;
      while (stack.length) {
        const i = stack.pop()!, x = i % w, y = (i - x) / w;
        c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
        for (const [dx, dy] of steps) {
          const xx = x + dx, yy = y + dy, j = yy * w + xx;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && label[j] < 0 && on(j)) { label[j] = c.id; stack.push(j); }
        }
      }
      if (c.x1 - c.x0 + 1 >= minSide && c.y1 - c.y0 + 1 >= minSide) comps.push(c);
    }
    return { label, comps };
  };
  const paper = (i: number) => gray[i] >= 230;
  for (const c of components(i => !paper(i), false).comps) {
    let drawn = 0;
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (!paper(y * w + x)) drawn++;
    if (drawn >= 0.95 * (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1)) add([c.x0, c.y0, c.x1 + 1, c.y1 + 1]);
  }
  const ink = components(i => gray[i] < 110, true);
  for (const c of ink.comps) {
    const edge = (x: number, y: number, dx: number, dy: number) => [0, 1, 2].some(k => {
      const xx = x + dx * k, yy = y + dy * k;
      return xx >= c.x0 && xx <= c.x1 && yy >= c.y0 && yy <= c.y1 && ink.label[yy * w + xx] === c.id;
    });
    let hit = 0, tot = 0;
    for (let x = c.x0; x <= c.x1; x++) { tot += 2; hit += +edge(x, c.y0, 0, 1) + +edge(x, c.y1, 0, -1); }
    for (let y = c.y0; y <= c.y1; y++) { tot += 2; hit += +edge(c.x0, y, 1, 0) + +edge(c.x1, y, -1, 0); }
    if (hit >= 0.9 * tot) add([c.x0, c.y0, c.x1 + 1, c.y1 + 1]);
  }
  return out;
}

type Store = { get(name: string, cb: (v: any) => void): void };
export interface ImagePage {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: any[] }>;
  objs?: Store;
  commonObjs?: Store;
}

export async function imageBoxesOnPage(
  page: ImagePage,
  OPS: OpsTable,
  toPixels?: (img: any) => Promise<PdfImage | null> | PdfImage | null,
  opList?: { fnArray: number[]; argsArray: any[] },
): Promise<Box[]> {
  const vp = page.getViewport({ scale: 1 });
  const ops = opList || await page.getOperatorList();
  const out: Box[] = [];
  let ctm = vp.transform as Mat;
  const stack: Mat[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    if (fn !== OPS.paintImageXObject) continue;
    const m = ctm;
    const span = (a: number[], b: number[]): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const [x0, y0, x1, y1] = span(apply(m, 0, 0), apply(m, 1, 1));
    if ((x1 - x0) * (y1 - y0) > 0.5 * vp.width * vp.height) continue;
    const name: string = ops.argsArray[i][0];
    const store = name.startsWith('g_') && page.commonObjs ? page.commonObjs : page.objs;
    let img: any = store ? await Promise.race([
      new Promise(res => { try { store.get(name, res); } catch { res(null); } }),
      new Promise(res => setTimeout(res, 5000, null)),
    ]) : null;
    if (img && !img.data && toPixels) img = await toPixels(img);
    const gray = img?.data && img.width * img.height <= 16e6 ? imageGray(img) : null;
    if (!gray) continue;
    const at = (x: number, y: number) => apply(m, x / img.width, 1 - y / img.height);
    for (const [a, b, c, d] of boxesInRaster(gray, img.width, img.height)) {
      const r = span(at(a + 0.5, b + 0.5), at(c - 0.5, d - 0.5));
      out.push(r.map((v, k) => Math.round((v / (k % 2 ? vp.height : vp.width)) * 1e4) / 1e4) as Box);
    }
  }
  return out;
}
