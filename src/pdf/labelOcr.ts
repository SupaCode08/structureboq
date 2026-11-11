/**
 * OCR of vector lettering one label at a time.
 *
 * Reading a whole sheet in tiles mixes every label with its neighbours (hatching, dimension ticks,
 * other words), and the engine guesses the layout. A CAD sheet already tells us where each label is:
 * its strokes. Group strokes into glyphs, glyphs into text lines (written across, or up the sheet),
 * draw each line alone and large, and read it as a single line of text. Every engine reads it; the
 * surer reading is kept.
 */
import type { OcrWord } from './types';
import { rasterize, fillClosed, type Polyline } from './vectorText';
import type { TesseractLike } from './ocr';

export interface Box { x0: number; y0: number; x1: number; y1: number; polys: number[] }

const grow = (o: Box, b: Box) => { o.x0 = Math.min(o.x0, b.x0); o.y0 = Math.min(o.y0, b.y0); o.x1 = Math.max(o.x1, b.x1); o.y1 = Math.max(o.y1, b.y1); o.polys.push(...b.polys); };

/** union boxes that `near` joins, until nothing changes (small n per sheet: a few thousand) */
function mergeBoxes(bs: Box[], near: (a: Box, b: Box) => boolean): Box[] {
  let cur = bs.map(b => ({ ...b, polys: [...b.polys] }));
  for (let changed = true; changed;) {
    changed = false;
    const out: Box[] = [];
    for (const b of cur.sort((p, q) => p.x0 - q.x0)) {
      let o: Box | undefined;
      for (let k = out.length - 1; k >= 0 && k >= out.length - 400; k--) if (near(out[k], b)) { o = out[k]; break; }
      if (o) {
        grow(o, b);
        changed = true;
        // absorbing b expands o, which may now bridge to other boxes already in out
        for (let again = true; again;) {
          again = false;
          for (let k = out.length - 1; k >= 0 && k >= out.length - 400; k--) {
            if (out[k] !== o && near(out[k], o)) {
              const [p] = out.splice(k, 1);
              grow(o, p);
              again = true;
              break;
            }
          }
        }
      } else out.push(b);
    }
    cur = out;
  }
  return cur;
}

export interface TextLine { box: Box; vertical: boolean }

/** Glyphs (touching strokes) grouped into lines of text, horizontal or reading up the sheet. */
/** Touching strokes merged into glyph pieces (a letter, or one part of a multi-part letter). */
export function glyphBoxes(small: Polyline[]): Box[] {
  const pb: Box[] = small.map((p, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1, polys: [i] };
  });
  return mergeBoxes(pb, (a, b) => a.x0 <= b.x1 + 0.2 && b.x0 <= a.x1 + 0.2 && a.y0 <= b.y1 + 0.2 && b.y0 <= a.y1 + 0.2);
}

export function textLines(small: Polyline[], glyphs = glyphBoxes(small)): TextLine[] {
  const horiz = (a: Box, b: Box) => {
    const ha = a.y1 - a.y0, hb = b.y1 - b.y0, h = Math.max(ha, hb, 1.5);
    const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
    return overlap > 0.4 * Math.min(ha, hb, h) && gap < 0.8 * h;
  };
  const vert = (a: Box, b: Box) => {
    const wa = a.x1 - a.x0, wb = b.x1 - b.x0, w = Math.max(wa, wb, 1.5);
    const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
    return overlap > 0.4 * Math.min(wa, wb, w) && gap < 0.8 * w;
  };
  const H = mergeBoxes(glyphs, horiz), V = mergeBoxes(glyphs, vert);
  const lineOf = (ls: Box[]) => {
    const byPoly = new Map<number, number>();
    ls.forEach((L, k) => L.polys.forEach(pi => byPoly.set(pi, k)));
    const idx = glyphs.map(g => byPoly.get(g.polys[0])!);
    const n = new Map<number, number>();
    for (const k of idx) n.set(k, (n.get(k) || 0) + 1);
    return { idx, n };
  };
  const h = lineOf(H), v = lineOf(V);
  const groups = new Map<string, Box[]>();
  glyphs.forEach((g, gi) => {
    const nh = h.n.get(h.idx[gi]) || 1, nv = v.n.get(v.idx[gi]) || 1;
    const key = nv > nh ? `v${v.idx[gi]}` : `h${h.idx[gi]}`;
    const gs = groups.get(key);
    if (gs) gs.push(g); else groups.set(key, [g]);
  });
  return [...groups.entries()].map(([k, gs]) => ({ box: mergeAll(gs), vertical: k[0] === 'v' }));
}

function mergeAll(bs: Box[]): Box {
  const o: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, polys: [] };
  for (const b of bs) grow(o, b);
  return o;
}

export interface LabelOcrEnv {
  workers: TesseractLike[];
  toImage(data: Uint8Array, width: number, height: number): Promise<any> | any;
}

/**
 * Read each text line of a vector sheet. `small` = lettering strokes in points (top-left origin);
 * returns words normalized to the page like tile OCR does.
 */
export async function ocrLabels(small: Polyline[], pageW: number, pageH: number, env: LabelOcrEnv, onProgress?: (done: number, total: number) => void): Promise<OcrWord[]> {
  const lines = textLines(small).filter(L => {
    const w = L.box.x1 - L.box.x0, h = L.box.y1 - L.box.y0;
    const th = L.vertical ? w : h;
    return th >= 1.2 && th <= 30 && Math.max(w, h) >= 1.5;
  });
  const words: OcrWord[] = [];
  let done = 0;
  for (const L of lines) {
    const b = L.box, w = b.x1 - b.x0, h = b.y1 - b.y0;
    const letter = L.vertical ? w : h;
    const sc = 48 / Math.max(letter, 2.5);
    const pad = letter * 0.6;
    const polys = b.polys.map(i => small[i].map(q => [q[0] - b.x0 + pad, q[1] - b.y0 + pad] as [number, number]));
    const pen = Math.max(2, Math.round(sc * 0.35));
    const imgs = L.vertical
      ? [rasterize(polys, w + 2 * pad, h + 2 * pad, sc, pen, true), rasterize(polys.map(p => p.map(([x, y]) => [w + 2 * pad - x, h + 2 * pad - y] as [number, number])), w + 2 * pad, h + 2 * pad, sc, pen, true)]
      : [rasterize(polys, w + 2 * pad, h + 2 * pad, sc, pen, false)];
    if (letter >= 7) {
      const extra = imgs.map((r, k) => {
        const c = { data: Uint8Array.from(r.data), width: r.width, height: r.height };
        const src = L.vertical && k === 1 ? polys.map(p => p.map(([x, y]) => [w + 2 * pad - x, h + 2 * pad - y] as [number, number])) : polys;
        return fillClosed(c, src, w + 2 * pad, h + 2 * pad, sc, L.vertical) ? c : null;
      }).filter(Boolean) as typeof imgs;
      imgs.push(...extra);
    }
    let best: { text: string; conf: number } | null = null;
    const reads: { text: string; conf: number }[] = [];
    for (const r of imgs) {
      const img = await env.toImage(r.data, r.width, r.height);
      for (const wk of env.workers) {
        const { data } = await wk.recognize(img);
        const text = (((data as any).text as string) || '').trim().replace(/\s+/g, ' ');
        if (!text) continue;
        const conf = (data as any).confidence ?? 0;
        const thaiOk = /[฀-๿]{2}/.test(text) || !/[฀-๿]/.test(text);
        const score = thaiOk ? conf : conf - 40;
        reads.push({ text, conf });
        if (!best || score > best.conf) best = { text, conf: score };
      }
    }
    onProgress?.(++done, lines.length);
    const tagTok = (t: string) => t.replace(/^[|(\[\s]+/, '').match(/^([A-Z]{1,3}\d{0,2}[A-Z]?)(?=[(\s,]|$)/)?.[1];
    for (const r of reads) {
      const t = tagTok(r.text);
      if (!t || r.conf < 50 || !/[A-Z]{2}|\d/.test(t) || best?.text.includes(t)) continue;
      const f1 = Math.min(1, (t.length + 1) / Math.max(r.text.length, 1));
      words.push({ text: t, conf: r.conf, x0: b.x0 / pageW, y0: (L.vertical ? b.y1 - f1 * h : b.y0) / pageH, x1: (L.vertical ? b.x1 : b.x0 + f1 * w) / pageW, y1: b.y1 / pageH, vertical: L.vertical });
    }
    if (!best || best.conf < 40 || !/[A-Za-z0-9]/.test(best.text)) continue;
    const len = best.text.length;
    let at = 0;
    for (const tok of best.text.split(' ')) {
      const f0 = at / len, f1 = (at + tok.length) / len;
      at += tok.length + 1;
      if (!/[A-Za-z0-9]/.test(tok)) continue;
      const bx = L.vertical
        ? { x0: b.x0, x1: b.x1, y0: b.y1 - f1 * h, y1: b.y1 - f0 * h }
        : { x0: b.x0 + f0 * w, x1: b.x0 + f1 * w, y0: b.y0, y1: b.y1 };
      words.push({ text: tok, conf: best.conf, x0: bx.x0 / pageW, y0: bx.y0 / pageH, x1: bx.x1 / pageW, y1: bx.y1 / pageH, vertical: L.vertical });
    }
  }
  return words;
}
