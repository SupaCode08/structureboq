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
function mergeBoxes(bs: Box[], near: (a: Box, b: Box) => boolean, maxDx?: number): Box[] {
  let cur = bs.map(b => ({ ...b, polys: [...b.polys] }));
  for (let changed = true; changed;) {
    changed = false;
    const out: Box[] = [];
    const active: Box[] = [];
    for (const b of cur.sort((p, q) => p.x0 - q.x0)) {
      if (maxDx !== undefined) {
        const cut = b.x0 - maxDx;
        let w = 0;
        for (let i = 0; i < active.length; i++) {
          if (active[i].x1 >= cut) active[w++] = active[i];
        }
        active.length = w;
      }
      const pool = maxDx !== undefined ? active : out;
      let o: Box | undefined;
      for (let k = pool.length - 1; k >= 0 && k >= pool.length - 400; k--) if (near(pool[k], b)) { o = pool[k]; break; }
      if (o) {
        grow(o, b);
        changed = true;
        // absorbing b expands o, which may now bridge to other boxes already in out
        for (let again = true; again;) {
          again = false;
          for (let k = pool.length - 1; k >= 0 && k >= pool.length - 400; k--) {
            if (pool[k] !== o && near(pool[k], o)) {
              const p = pool[k];
              if (maxDx !== undefined) {
                active.splice(k, 1);
                const oi = out.indexOf(p);
                if (oi >= 0) out.splice(oi, 1);
              } else {
                out.splice(k, 1);
              }
              grow(o, p);
              again = true;
              break;
            }
          }
        }
      } else {
        out.push(b);
        if (maxDx !== undefined) active.push(b);
      }
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
  return mergeBoxes(pb, (a, b) => a.x0 <= b.x1 + 0.2 && b.x0 <= a.x1 + 0.2 && a.y0 <= b.y1 + 0.2 && b.y0 <= a.y1 + 0.2, 0.25);
}

export function textLines(small: Polyline[], glyphs = glyphBoxes(small)): TextLine[] {
  const horiz = (a: Box, b: Box) => {
    const ha = a.y1 - a.y0, hb = b.y1 - b.y0, h = Math.min(Math.max(ha, hb, 1.5), 24);
    if (Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) > 28) return false;
    const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
    return overlap > 0.4 * Math.min(ha, hb, h) && gap < 0.8 * h;
  };
  const vert = (a: Box, b: Box) => {
    const wa = a.x1 - a.x0, wb = b.x1 - b.x0, w = Math.min(Math.max(wa, wb, 1.5), 24);
    if (Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) > 28) return false;
    const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
    return overlap > 0.4 * Math.min(wa, wb, w) && gap < 0.8 * w;
  };
  const H = mergeBoxes(glyphs, horiz, 24), V = mergeBoxes(glyphs, vert, 24);
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
    const wideGlyph = (g.x1 - g.x0) > (g.y1 - g.y0) * 1.15;
    const isVert = nv > nh || (nv === nh && nv >= 2 && wideGlyph);
    const key = isVert ? `v${v.idx[gi]}` : `h${h.idx[gi]}`;
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

export function filterTitleBlockBoilerplate(lines: TextLine[], pageW: number, pageH: number): TextLine[] {
  const rightCount = lines.filter(L => L.box.x0 > 0.86 * pageW).length;
  if (rightCount < 8) return lines;
  return lines.filter(L => !(L.box.x0 > 0.86 * pageW && L.box.y1 < 0.72 * pageH));
}

export function vectorTextLines(small: Polyline[], maxGlyphPt = 28): TextLine[] {
  const glyphs = glyphBoxes(small).filter(g => {
    const w = g.x1 - g.x0, h = g.y1 - g.y0;
    const mn = Math.min(w, h), mx = Math.max(w, h);
    return mn <= maxGlyphPt && mx <= 65 && !(mx > 25 && mn < 2.2);
  });
  return textLines(small, glyphs).filter(L => {
    const w = L.box.x1 - L.box.x0, h = L.box.y1 - L.box.y0;
    const th = L.vertical ? w : h;
    return th >= 1.2 && th <= 30 && Math.max(w, h) >= 2.8 && !(Math.min(w, h) < 0.6 && L.box.polys.length <= 2);
  });
}

export interface StripPlacement {
  idx: number;
  sx: number; sy: number; sw: number; sh: number;
  dx: number; dy: number;
  turned: boolean;
}

/** Pack sparse crop boxes onto one compact grayscale strip for single-pass Thai Tesseract OCR. */
export function packThaiStrip(
  r: { data: Uint8Array; width: number; height: number },
  items: { box: number[]; turned: boolean }[],
): { data: Uint8Array; width: number; height: number; placements: StripPlacement[] } {
  const pad = 16, maxW = 1400;
  const placements: StripPlacement[] = [];
  let cx = pad, cy = pad, rowH = 0, totalW = 0;
  for (let i = 0; i < items.length; i++) {
    const [x0, y0, x1, y1] = items[i].box;
    const sw = x1 - x0, sh = y1 - y0;
    if (sw <= 0 || sh <= 0) continue;
    const dw = items[i].turned ? sh : sw, dh = items[i].turned ? sw : sh;
    if (cx + dw + pad > maxW && cx > pad) { cx = pad; cy += rowH + pad; rowH = 0; }
    placements.push({ idx: i, sx: x0, sy: y0, sw, sh, dx: cx, dy: cy, turned: items[i].turned });
    cx += dw + pad;
    if (cx > totalW) totalW = cx;
    if (dh > rowH) rowH = dh;
  }
  const totalH = Math.max(pad * 2, cy + rowH + pad);
  totalW = Math.max(pad * 2, totalW);
  const out = new Uint8Array(totalW * totalH).fill(255);
  for (const p of placements) {
    for (let y = 0; y < p.sh; y++) for (let x = 0; x < p.sw; x++) {
      const v = r.data[(p.sy + y) * r.width + (p.sx + x)];
      if (p.turned) out[(p.dy + p.sw - 1 - x) * totalW + (p.dx + y)] = v;
      else out[(p.dy + y) * totalW + (p.dx + x)] = v;
    }
  }
  return { data: out, width: totalW, height: totalH, placements };
}

/** Map Tesseract words recognized on a packed strip back to normalized page coordinates. */
export function unpackStripWords(
  tWords: { text?: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[],
  placements: StripPlacement[],
  rW: number,
  rH: number,
): OcrWord[] {
  const out: OcrWord[] = [];
  for (const tw of tWords) {
    const txt = (tw.text || '').trim();
    if (!txt) continue;
    const cx = (tw.bbox.x0 + tw.bbox.x1) / 2, cy = (tw.bbox.y0 + tw.bbox.y1) / 2;
    const pl = placements.find(p => cx >= p.dx - 4 && cx <= p.dx + (p.turned ? p.sh : p.sw) + 4 && cy >= p.dy - 4 && cy <= p.dy + (p.turned ? p.sw : p.sh) + 4);
    if (!pl) continue;
    const dw = pl.turned ? pl.sh : pl.sw, dh = pl.turned ? pl.sw : pl.sh;
    const rx0 = (tw.bbox.x0 - pl.dx) / dw, rx1 = (tw.bbox.x1 - pl.dx) / dw;
    const ry0 = (tw.bbox.y0 - pl.dy) / dh, ry1 = (tw.bbox.y1 - pl.dy) / dh;
    if (pl.turned) {
      out.push({
        text: txt, conf: Math.round(tw.confidence || 0), vertical: true,
        x0: (pl.sx + Math.max(0, ry0) * pl.sw) / rW, x1: (pl.sx + Math.min(1, ry1) * pl.sw) / rW,
        y0: (pl.sy + (1 - Math.min(1, rx1)) * pl.sh) / rH, y1: (pl.sy + (1 - Math.max(0, rx0)) * pl.sh) / rH,
      });
    } else {
      out.push({
        text: txt, conf: Math.round(tw.confidence || 0), vertical: false,
        x0: (pl.sx + Math.max(0, rx0) * pl.sw) / rW, x1: (pl.sx + Math.min(1, rx1) * pl.sw) / rW,
        y0: (pl.sy + Math.max(0, ry0) * pl.sh) / rH, y1: (pl.sy + Math.min(1, ry1) * pl.sh) / rH,
      });
    }
  }
  return out;
}

/** Combine Paddle vector-line results with single-pass Thai strip OCR for Thai/low-confidence lines, without duplicating words. */
export async function mergeVectorOcr(
  paddleWords: OcrWord[],
  paddleLines: { text: string; conf: number }[] | undefined,
  jobs: { box: number[]; turned: boolean }[],
  rs: { data: Uint8Array; width: number; height: number },
  recognizeThai: (strip: { data: Uint8Array; width: number; height: number }) => Promise<{ text?: string; confidence?: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[]>,
  readThaiBoxes?: (thaiJobs: { box: number[]; turned: boolean }[]) => Promise<OcrWord[]>,
): Promise<OcrWord[]> {
  const thaiJobs: { box: number[]; turned: boolean }[] = [];
  if (paddleLines) {
    for (let i = 0; i < jobs.length; i++) {
      const { text, conf } = paddleLines[i] || { text: '', conf: 0 };
      const hasAt = /@/.test(text);
      const [x0, y0, x1, y1] = jobs[i].box;
      const cw = jobs[i].turned ? y1 - y0 : x1 - x0, ch = Math.max(1, jobs[i].turned ? x1 - x0 : y1 - y0);
      const wideProse = cw / ch >= 14;
      const isThaiLike = wideProse || (/[a-z]{4,}/.test(text) && !hasAt) || (/[^\x20-\x7E]/.test(text) && !hasAt) || (conf < 70 && !hasAt && text.length >= 2 && !/^[\d.\-+:xX*/\\()]+$/.test(text));
      if (isThaiLike) thaiJobs.push(jobs[i]);
    }
  }
  if (!thaiJobs.length) return paddleWords;

  let thaiWords: OcrWord[];
  if (readThaiBoxes) {
    thaiWords = await readThaiBoxes(thaiJobs);
  } else {
    const chunks: { box: number[]; turned: boolean }[][] = [];
    if (thaiJobs.length > 30) {
      const nChunks = Math.min(3, Math.ceil(thaiJobs.length / 25));
      const per = Math.ceil(thaiJobs.length / nChunks);
      for (let i = 0; i < thaiJobs.length; i += per) chunks.push(thaiJobs.slice(i, i + per));
    } else {
      chunks.push(thaiJobs);
    }
    thaiWords = (await Promise.all(chunks.map(async ch => {
      const strip = packThaiStrip(rs, ch);
      const tWords = await recognizeThai(strip);
      return unpackStripWords(tWords, strip.placements, rs.width, rs.height);
    }))).flat();
  }

  // Drop Paddle words that overlap a thaiJob box where Tesseract actually produced words (prevents duplicate tags/bars)
  const coveredBoxes = thaiJobs
    .map(({ box: [x0, y0, x1, y1] }) => ({ x0: x0 / rs.width, y0: y0 / rs.height, x1: x1 / rs.width, y1: y1 / rs.height }))
    .filter(b => thaiWords.some(tw => {
      const cx = (tw.x0 + tw.x1) / 2, cy = (tw.y0 + tw.y1) / 2;
      return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1;
    }));

  const keptPaddle = paddleWords.filter(pw => {
    const cx = (pw.x0 + pw.x1) / 2, cy = (pw.y0 + pw.y1) / 2;
    return !coveredBoxes.some(b => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1);
  });

  return [...keptPaddle, ...thaiWords];
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
