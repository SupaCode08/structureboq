/**
 * Reads CAD stroke lettering by shape: every copy of a letter in a drawing is drawn with the same
 * strokes, so letters are matched to each other instead of read one by one. Labels come from the
 * OCR words whose letter count fits; every letter on the sheet is then read by its nearest labelled
 * neighbours, so a "3ø12" OCR garbled in one place is read like its clean copies elsewhere.
 */
import type { OcrWord } from './types';
import type { Polyline } from './vectorText';
import { glyphBoxes, textLines, type Box } from './labelOcr';
import { parseBarNote } from './barNotation';

const GW = 10, GH = 14;

interface Cell { a0: number; a1: number; polys: number[]; bits: Uint8Array; width: number }

function cellsOf(small: Polyline[], vertical: boolean, pieces: Box[]): { cells: Cell[]; h: number } {
  const along = (b: Box) => (vertical ? [-b.y1, -b.y0] : [b.x0, b.x1]);
  const sorted = pieces.map(b => ({ b, r: along(b) })).sort((p, q) => p.r[0] - q.r[0]);
  const groups: { a0: number; a1: number; c0: number; c1: number; polys: number[] }[] = [];
  for (const { b, r } of sorted) {
    const g = groups[groups.length - 1];
    const [c0, c1] = vertical ? [b.x0, b.x1] : [b.y0, b.y1];
    if (g && Math.min(g.a1, r[1]) - Math.max(g.a0, r[0]) > 0.5 * Math.min(g.a1 - g.a0, r[1] - r[0]) + 1e-6) {
      g.a1 = Math.max(g.a1, r[1]); g.c0 = Math.min(g.c0, c0); g.c1 = Math.max(g.c1, c1); g.polys.push(...b.polys);
    } else groups.push({ a0: r[0], a1: r[1], c0, c1, polys: [...b.polys] });
  }
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
  const h = median(groups.map(g => g.c1 - g.c0)), base = median(groups.map(g => g.c1));
  return {
    h,
    cells: groups.map(g => {
      const bits = new Uint8Array(GW * GH);
      const width = Math.max(1, Math.min(GW, Math.ceil(((g.a1 - g.a0) / h) * 8)));
      const at = (x: number, y: number) => {
        const u = (((vertical ? -y : x) - g.a0) / h) * 8, v = (1 - (base - (vertical ? x : y)) / h) * (GH - 4) + 2;
        bits[Math.min(GH - 1, Math.max(0, Math.round(v))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(u)))] = 1;
      };
      for (const pi of g.polys) {
        const p = small[pi];
        for (let k = 0; k < p.length; k++) {
          at(p[k][0], p[k][1]);
          if (k) for (let t = 0.25; t < 1; t += 0.25) at(p[k - 1][0] + (p[k][0] - p[k - 1][0]) * t, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * t);
        }
      }
      return { a0: g.a0, a1: g.a1, polys: g.polys, bits, width };
    }),
  };
}

const distance = (a: Cell, b: Cell) => {
  let d = Math.abs(a.width - b.width) * 4;
  for (let i = 0; i < a.bits.length; i++) d += a.bits[i] ^ b.bits[i];
  return d;
};

/** Words read from letter shapes, in page-normalized boxes; `ocr` = the page's OCR words (labels). */
export function glyphWords(small: Polyline[], pageW: number, pageH: number, ocr: OcrWord[]): OcrWord[] {
  const pieces = glyphBoxes(small);
  const pieceOf = new Map<number, Box>();
  for (const g of pieces) for (const pi of g.polys) pieceOf.set(pi, g);
  const lines = textLines(small, pieces).flatMap(L => {
    const own = [...new Set(L.box.polys.map(pi => pieceOf.get(pi)!))];
    const r = cellsOf(small, L.vertical, own);
    return r.h >= 1.2 && r.h <= 30 ? [{ ...L, ...r }] : [];
  });
  const box = (L: typeof lines[number], a0: number, a1: number) => (L.vertical
    ? { x0: L.box.x0 / pageW, x1: L.box.x1 / pageW, y0: -a1 / pageH, y1: -a0 / pageH }
    : { x0: a0 / pageW, x1: a1 / pageW, y0: L.box.y0 / pageH, y1: L.box.y1 / pageH });
  const known: { cell: Cell; ch: string }[] = [];
  for (const L of lines) {
    for (const w of ocr) {
      if (w.vertical !== L.vertical || w.conf < 50) continue;
      const text = w.text.replace(/\s/g, '');
      const wa0 = L.vertical ? -w.y1 * pageH : w.x0 * pageW, wa1 = L.vertical ? -w.y0 * pageH : w.x1 * pageW;
      const mid = L.vertical ? ((w.x0 + w.x1) / 2) * pageW : ((w.y0 + w.y1) / 2) * pageH;
      if (mid < (L.vertical ? L.box.x0 : L.box.y0) || mid > (L.vertical ? L.box.x1 : L.box.y1)) continue;
      const inside = L.cells.filter(c => (c.a0 + c.a1) / 2 > wa0 && (c.a0 + c.a1) / 2 < wa1);
      if (inside.length && inside.length === [...text].length) inside.forEach((c, k) => known.push({ cell: c, ch: [...text][k] }));
    }
  }
  if (known.length < 30) return [];
  const label = (c: Cell) => {
    const near = known.map(k => ({ ch: k.ch, d: distance(c, k.cell) })).filter(k => k.d <= 6).sort((p, q) => p.d - q.d).slice(0, 7);
    if (near.length < 2) return null;
    const votes = new Map<string, number>();
    for (const k of near) votes.set(k.ch, (votes.get(k.ch) || 0) + 1 / (1 + k.d));
    const [best, score] = [...votes].sort((p, q) => q[1] - p[1])[0];
    const total = [...votes.values()].reduce((a, v) => a + v, 0);
    return score >= 0.6 * total ? best : null;
  };
  const labels = new Map<Cell, string | null>();
  for (const L of lines) for (const c of L.cells) labels.set(c, label(c));
  const unknown: { proto: Cell; cells: Cell[] }[] = [];
  for (const [c, ch] of labels) {
    if (ch !== null) continue;
    const u = unknown.find(k => distance(k.proto, c) <= 6);
    if (u) u.cells.push(c); else unknown.push({ proto: c, cells: [c] });
  }
  const isDigit = (c?: Cell) => !!c && /^\d$/.test(labels.get(c) ?? '');
  for (const u of unknown) {
    let sign = 0, times = 0;
    for (const L of lines) L.cells.forEach((c, k) => {
      if (!u.cells.includes(c) || !isDigit(L.cells[k - 1]) || !isDigit(L.cells[k + 1])) return;
      let j = k - 1;
      while (j > 0 && /^[\d.]$/.test(labels.get(L.cells[j - 1]) ?? '')) j--;
      if (L.cells.slice(j, k).some(o => labels.get(o) === '.')) times++; else sign++;
    });
    const n = sign + times;
    if (n >= 2 && n >= 0.6 * u.cells.length) for (const c of u.cells) labels.set(c, sign >= times ? 'ø' : 'x');
  }
  const out: OcrWord[] = [];
  for (const L of lines) {
    let word: { text: string; a0: number; a1: number } | null = null;
    const flush = () => {
      const text = word?.text.replace(/^\?+(?=ø)/, '').replace(/(?<=\d)[?.]*\?[?.]*(?=[@+]|$)/g, '');
      if (word && text && !text.includes('?') && /[A-Za-z0-9]/.test(text)) out.push({ text, conf: 90, vertical: L.vertical, ...box(L, word.a0, word.a1) });
      word = null;
    };
    for (const c of L.cells) {
      if (word && c.a0 - word.a1 > 0.75 * L.h) flush();
      word ??= { text: '', a0: c.a0, a1: c.a1 };
      word.text += labels.get(c) ?? '?'; word.a1 = c.a1;
    }
    flush();
  }
  return out;
}

/** Shape-read bar notes added to the OCR words, replacing what OCR read in their place. */
export function withGlyphWords(ocr: OcrWord[], glyph: OcrWord[]): OcrWord[] {
  const bars = glyph.filter(g => parseBarNote(g.text));
  const covered = (w: OcrWord) => bars.some(g => g.vertical === w.vertical && (w.x0 + w.x1) / 2 > g.x0 && (w.x0 + w.x1) / 2 < g.x1 && (w.y0 + w.y1) / 2 > g.y0 && (w.y0 + w.y1) / 2 < g.y1);
  return [...ocr.filter(w => !covered(w)), ...bars];
}
