/**
 * StructBOQ - rule-based sheet reader (no AI): OCR words + drawing conventions -> SheetReading.
 *
 *  - Grid lines are recovered from the chain of dimension strings (2.70 | 1.50 | 2.40 ...):
 *    dimension text sits midway between two grid lines, so text positions + values give
 *    both the grid positions and the drawing scale (cross-checked against "1:50").
 *  - Member tags are tied to the grid: a beam tag on a grid row between two grid columns is
 *    that span; a slab tag inside a bay is that bay; a footing tag next to an intersection.
 *  - Section details: the tag under a detail + the small dimensions/bars drawn above it.
 *  - OCR misreads are repaired with the drawing's own tag vocabulary (CB2 -> GB2, GBI -> GB1).
 * Output feeds the same mergeSheetReadings() as the Vision path.
 */
import type { OcrWord, PageOcr } from './types';
import type { SheetReading, PlanInstance, SectionDef, GridAxisMark, LevelMark } from '../engine/sheetMerge';
import { barPhrases, gradeBySize, formatBar, resolveGrade, type BarNote } from './barNotation';

/** Ties set at each spacing step of a tie note ("2-RB6@0.10" -> 2); undefined for a single set. */
const tieSets = (note: BarNote) => (note.kind === 'spacing' && note.legs && note.legs > 1 ? note.legs : undefined);

const TAG = /^(GB|BST|BS|RB|TB|TG|WB|SB|CB|B|CS|C|F|SP|GS|PS|TS|S|ST|D|W|WN|FL|WALL)\d{0,2}[A-Z]?'?$/;
const FOOTING_SIZE = /^F\(?(\d\.\d{2})X(\d\.\d{2})(?:X(\d\.\d{2}))?\)?$/;
const DIM = /^\d{1,2}\.\d{2}$/;
const STEEL = /^(BS|CS)\d*$/;
/** Non-tag words: rooms, annotations, units, and drawing titles that must never become tags */
const NON_TAG_WORDS = new Set([
  'WC', 'LIV', 'DIN', 'BED', 'BATH', 'BALC', 'HALL', 'TERR', 'KIT', 'STORE', 'MAID',
  'CORRIDOR', 'GARAGE', 'PORCH', 'FOYER', 'DECK', 'ROOF', 'PUMP', 'TANK',
  'TYP', 'SYM', 'NTS', 'REV', 'DATE', 'CHK', 'DWG', 'SHT', 'SCALE', 'NORTH',
  'SECTION', 'ELEVATION', 'DETAIL', 'REF', 'PLAN', 'FLOOR', 'LEVEL', 'FINISH',
  'MATERIAL', 'SPEC', 'NOTES', 'NOTE', 'DRAWING', 'PROJECT', 'SHEET', 'TOTAL',
  'MM', 'CM', 'M', 'KG', 'M2', 'M3', 'THB', 'BAHT', 'QTY', 'NO', 'ITEM'
]);

/** sizes written into a label in millimetres: "F1|RCF-800x1500x300", "C1|RC-300x900", "B1 RC-200x400" */
const LABEL_SIZE = /^([A-Z]{1,3}\d{1,2}[A-Z]?)\|?(RCF|RCB|RCC|RC|F|B|C)?-?(\d{3,4})X(\d{3,4})(?:X(\d{3,4}))?$/;

/** Detects whether a page is a Drawing Index / Table of Contents / Structural General Notes sheet */
export function isDrawingIndexSheet(p: PageOcr): boolean {
  const fullText = p.words.map(w => w.text).join(' ');
  if (/สารบัญ(?:แบบ(?:แปลน)?)?|รายการ(?:แผ่น)?แบบ(?:แปลน)?|รายการประกอบแบบ|ข้อกำหนดทั่วไป|DRAWING\s*LIST|SHEET\s*INDEX|LIST\s*OF\s*DRAWINGS|TABLE\s*OF\s*CONTENTS|GENERAL\s*(?:STRUCTURAL\s*)?NOTES/i.test(fullText)) {
    return true;
  }
  // A drawing sheet number format:
  // Must have hyphen/delimiter (S-01, S-11, A-02, 5-09, -05) OR prefix + 2 digits with leading 0 (S01, S02)
  // Must NEVER match structural member tags like S1, S2 (slabs) or ST1 (stairs)
  const isSheetRef = (t: string) =>
    /^(?:S|A|AR|EE|SN|SAN|M|ME|STR)[—–-\ufffd]\d{1,2}\.?$/i.test(t) ||
    /^(?:S|A|AR|EE|SN|SAN|M|ME|STR)0\d\.?$/i.test(t) ||
    /^5[—–-\ufffd]0?\d{1,2}\.?$/.test(t) ||
    /^[-—–-\ufffd]0\d\.?$/.test(t);

  const sheetRefs = p.words.filter(w => isSheetRef(w.text.trim()));
  const uniqueSheetRefs = new Set(sheetRefs.map(w => w.text.trim()));
  if (sheetRefs.length >= 4 && uniqueSheetRefs.size >= 3) {
    if (/แบบเลขที่|แผ่นที่|DRAWING\s*NO|SHEET\s*NO/i.test(fullText) || uniqueSheetRefs.size >= 5) {
      return true;
    }
    // Check if references are vertically stacked in a table column
    const xs = sheetRefs.map(w => cx(w));
    if (xs.some(x => xs.filter(ox => Math.abs(ox - x) < 0.03).length >= 3)) {
      return true;
    }
  }

  const sheetThaiRefs = p.words.filter(w => /แผ่นที่|แบบเลขที่/i.test(w.text)).length;
  if (sheetThaiRefs >= 4) return true;

  // Structural General Notes (numbered clauses + structural specifications)
  const specItems = p.words.filter(w => /^\d\.(?:\d)?\.?$/.test(w.text));
  const hasSpecTerms = p.words.some(w => /ksc|WELDING|COVER|คอนกรีต|เหล็ก|SR—24|SD—40/i.test(w.text));
  // a plan or detail sheet with a notes block still carries its dimension figures
  const dims = p.words.filter(w => DIM.test(w.text)).length;
  if (specItems.length >= 8 && hasSpecTerms && dims < 10) return true;

  return false;
}

/** Bounding box of drawing index tables on a sheet that must be excluded from takeoff */
export function getDrawingIndexTableExclusion(p: PageOcr): number[] | null {
  const isSheetRef = (t: string) =>
    /^(?:S|A|AR|EE|SN|SAN|M|ME|STR)[—–-\ufffd]\d{1,2}\.?$/i.test(t) ||
    /^(?:S|A|AR|EE|SN|SAN|M|ME|STR)0\d\.?$/i.test(t) ||
    /^5[—–-\ufffd]0?\d{1,2}\.?$/.test(t) ||
    /^[-—–-\ufffd]0\d\.?$/.test(t);
  const refs = p.words.filter(w => isSheetRef(w.text.trim()));
  const uniqueRefs = new Set(refs.map(w => w.text.trim()));
  if (refs.length < 3 || uniqueRefs.size < 3) return null;
  const xs = refs.map(w => cx(w));
  for (const x of xs) {
    const colRefs = refs.filter(w => Math.abs(cx(w) - x) < 0.03);
    const colUnique = new Set(colRefs.map(w => w.text.trim()));
    if (colRefs.length >= 3 && colUnique.size >= 3) {
      const minX = Math.min(...colRefs.map(w => w.x0));
      const maxX = Math.max(...colRefs.map(w => w.x1));
      const minY = Math.min(...colRefs.map(w => w.y0));
      const maxY = Math.max(...colRefs.map(w => w.y1));
      return [Math.max(0, minX - 0.35), Math.max(0, minY - 0.05), Math.min(1, maxX + 0.35), Math.min(1, maxY + 0.05)];
    }
  }
  return null;
}

/** A label boxed in by drawn lines on opposite sides is a reference inside a drawing, not a detail title (an underline alone, or a line through the middle, does not count). */
export function tagInsideDrawing(p: PageOcr, w: OcrWord): boolean {
  const h = w.y1 - w.y0, cy = (w.y0 + w.y1) / 2, cx = (w.x0 + w.x1) / 2, wd = w.x1 - w.x0;
  // only a circled label: a tag in a schedule cell is boxed in by the table lines and is still a title
  if (!(p.circles || []).some(c => Math.hypot(c[0] - cx, c[1] - cy) <= c[2])) return false;
  const above = (p.hsegs || []).some(s => s[0] <= w.x1 && s[2] >= w.x0 && s[1] < cy - 0.25 * h && cy - s[1] <= 1.5 * h);
  const below = (p.hsegs || []).some(s => s[0] <= w.x1 && s[2] >= w.x0 && s[1] > cy + 0.25 * h && s[1] - cy <= 1.5 * h);
  const left = (p.vsegs || []).some(s => s[1] <= w.y1 && s[2] >= w.y0 && s[0] < cx - 0.25 * wd && cx - s[0] <= 1.5 * wd);
  const right = (p.vsegs || []).some(s => s[1] <= w.y1 && s[2] >= w.y0 && s[0] > cx + 0.25 * wd && s[0] - cx <= 1.5 * wd);
  return (above && below) || (left && right);
}

const cx = (w: OcrWord) => (w.x0 + w.x1) / 2;
const cy = (w: OcrWord) => (w.y0 + w.y1) / 2;
const box = (w: OcrWord) => [w.y0 * 1000, w.x0 * 1000, w.y1 * 1000, w.x1 * 1000].map(v => Math.round(v));

/** pile note "ขนาด 0.15x0.15x6.00 ม." under "เสาเข็ม … จำนวน N ต้น" */
const PILE_SPEC = /(\d\.\d{2})X(\d\.\d{2})X(\d{1,2}(?:\.\d{1,2})?)$/;

const THAI_TO_ARABIC: Record<string, string> = {
  '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4',
  '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9',
};

function clean(t: string) {
  let u = t.toUpperCase().replace(/[;:]+$/, '').replace(/^[(\[]+|[)\].,]+$/g, '');
  u = u.replace(/[๐-๙]/g, ch => THAI_TO_ARABIC[ch] || ch);
  u = u.replace(/^คาน\s*/i, 'B')
       .replace(/^เสา\s*/i, 'C')
       .replace(/^ฐานราก\s*/i, 'F')
       .replace(/^พื้น\s*/i, 'S')
       .replace(/^บันได\s*/i, 'ST')
       .replace(/^ประตู\s*/i, 'D')
       .replace(/^หน้าต่าง\s*/i, 'W')
       .replace(/^ผนัง\s*/i, 'WALL')
       .replace(/^ผิวพื้น\s*/i, 'FL')
       .replace(/^คด\.?(\d)/i, 'GB$1')
       .replace(/^คร\.?(\d)/i, 'RB$1')
       .replace(/^ค\.?(\d)/i, 'B$1')
       .replace(/^สต\.?(\d)/i, 'C$1')
       .replace(/^ส\.?(\d)/i, 'C$1')
       .replace(/^ฐ\.?(\d)/i, 'F$1')
       .replace(/^พส\.?(\d)/i, 'PS$1')
       .replace(/^พ\.?(\d)/i, 'S$1')
       .replace(/^บ\.?(\d)/i, 'ST$1')
       .replace(/^ด\.?(\d)/i, 'D$1')
       .replace(/^น\.?(\d)/i, 'W$1')
       .replace(/^ผ\.?(\d)/i, 'WALL$1');
  return u.replace(/[“”"'’‘`′]/g, '') + (/[0-9A-Z][’'′]$/.test(u) ? "'" : '');
}

/** Deterministic OCR fixes for tag-like tokens, then vocabulary-constrained ones. */
function repairTag(raw: string, vocab: Set<string>, capitals = !/[a-z]/.test(raw)): { tag: string; repaired: boolean } | null {
  let t = clean(raw);
  if (NON_TAG_WORDS.has(t)) return null;
  if (FOOTING_SIZE.test(t.replace(/,.*$/, ''))) return { tag: t, repaired: false };
  const fixed = t
    .replace(/^([A-Z]{1,3})[IL|!]$/, '$11')
    .replace(/^([A-Z]{1,3})[IL|!]([A-Z])?$/, '$11$2')
    .replace(/^(S|GS|B|GB)O$/, '$10')
    .replace(/^\$/, 'S');
  const lettersOnly = vocab.size > 0 && fixed === t && /^[A-Z]{1,2}T$/.test(fixed) && !/^B?ST$/.test(fixed) && !vocab.has(fixed) && capitals;
  const dup = fixed.match(/^([A-Z]*([A-Z]))(\d)(\d[A-Z]?)$/);
  if (dup && AS_LETTER[dup[3]] === dup[2] && !vocab.has(fixed) && vocab.has(dup[1] + dup[4])) return { tag: dup[1] + dup[4], repaired: false };
  if (TAG.test(fixed) && !lettersOnly && (vocab.size === 0 || vocab.has(fixed) || fixed === t)) return { tag: fixed, repaired: fixed !== t };
  const cands = new Set<string>([
    fixed.replace(/^C(?=B)/, 'G'), fixed.replace(/^8/, 'B'), fixed.replace(/^8/, 'GB'), fixed.replace(/^>/, 'G'),
    fixed.replace(/^5/, 'S'), fixed.replace(/^6/, 'G'), fixed.replace(/^(.*)S$/, '$15'), fixed.replace(/^08/, 'GB'),
    fixed.replace(/^=/, 'B'), fixed.replace(/^2(?=B|F)/, ''), fixed.replace(/^F11$/, 'B1'), fixed.replace(/^F(?=[1-9]$)/, 'B'),
    fixed.replace(/^3(?=[0-9A-Z])/, 'B'), fixed.replace(/^3:(\d)/, 'B$1'), fixed.replace(/^F[L|I]E?$/, 'F1'), fixed.replace(/^FLE$/, 'F1'),
  ]);
  for (const c of cands) if (c !== fixed && TAG.test(c) && vocab.has(c)) return { tag: c, repaired: true };
  if (vocab.size && fixed.length >= 2 && fixed.length <= 5) {
    for (const c of lookAlikes(fixed)) if (c !== fixed && TAG.test(c) && vocab.has(c)) return { tag: c, repaired: true };
  }
  if (TAG.test(fixed) && !lettersOnly && fixed === t) return { tag: fixed, repaired: false };
  if (lettersOnly && TAG.test(fixed)) return { tag: fixed, repaired: false };
  return null;
}

const AS_LETTER: Record<string, string> = { '8': 'B', '3': 'B', '6': 'G', '5': 'S', '0': 'O', '£': 'F', '€': 'F', '$': 'S', '>': 'G', '1': 'I' };
const AS_DIGIT: Record<string, string> = { I: '1', L: '1', '|': '1', '!': '1', J: '1', O: '0', D: '0', Q: '0', S: '5', Z: '2', B: '8', G: '6', T: '7' };
function lookAlikes(t: string): string[] {
  const out: string[] = [];
  for (let k = 1; k < t.length; k++) {
    const head = [...t.slice(0, k)].map(ch => (/[A-Z]/.test(ch) ? ch : AS_LETTER[ch] ?? '')).join('');
    const tail = [...t.slice(k)].map(ch => (/[0-9]/.test(ch) ? ch : AS_DIGIT[ch] ?? ch)).join('');
    if (head.length === k) out.push(head + tail, head + tail.replace(/(\d)([0-9])$/, (_, a, b) => a + (b === '8' ? 'B' : b)));
    if (head.length === k && t.slice(k).includes('T')) out.push(head + [...t.slice(k)].map(ch => (ch === 'T' ? '1' : /[0-9]/.test(ch) ? ch : AS_DIGIT[ch] ?? ch)).join(''));
  }
  return out;
}

/** "F3,C1" / "F3.C1" / "B3,B3A.B3B" -> parts that look like tags */
function splitTags(raw: string, vocab: Set<string>) {
  const t = clean(raw).replace(/([0-9A-Z])\.(?=[A-Z])/g, '$1,').replace(/=/g, ',');
  // "F(0.90X0.90X0.30)" and "F0.90X0.90X0.30" name one footing: the brackets are how it is written, not part of the name
  return t.split(/,/).map(p => p.replace(/^F\((\d[\d.X]*)\)?$/, 'F$1')).map(p => repairTag(p, vocab, !/[a-z]/.test(raw)) ?? completeTag(p, vocab)).filter(Boolean) as { tag: string; repaired: boolean }[];
}

/** A footing name cut short by OCR ("F(0.90X0.90X0" or "95X0.95") is the one footing name of the set it begins. */
// exported only for test
export function completeTag(p: string, vocab: Set<string>) {
  const bare = (v: string) => v.replace(/[()]/g, '');
  const q = bare(p);
  if (q.length >= 6 && /^F\d?\.?\d/.test(q.replace(/^F/, 'F'))) {
    const hits = [...vocab].filter(v => FOOTING_SIZE.test(v) && bare(v).startsWith(q) && bare(v) !== q);
    if (hits.length === 1) return { tag: hits[0], repaired: true };
  }
  // Footing dimension where OCR dropped leading "F(" or "0." (e.g. "95X0.95", "0.95X0.95", "90X0.90", "0.90X0.90X0.30")
  const m = q.match(/^F?\(?0?\.?(\d{2})X0?\.?(\d{2})(?:X0?\.?(\d{2}))?\)?$/i);
  if (m) {
    const w = `0.${m[1]}`, l = `0.${m[2]}`;
    const t = m[3] ? `0.${m[3]}` : null;
    const pat = t ? `F(${w}X${l}X${t})` : `F(${w}X${l})`;
    const match = [...vocab].find(v => {
      const b = bare(v);
      return b.includes(`${w}X${l}`) || b.includes(`${m[1]}X${m[2]}`);
    });
    if (match) return { tag: match, repaired: true };
  }
  // one letter where a footing size has a digit (0 read as p) is that footing when only one name fits
  if (q.startsWith('F') && q.length >= 10) {
    const hits = [...vocab].filter(v => {
      if (!FOOTING_SIZE.test(v)) return false;
      const bv = bare(v);
      if (bv.length !== q.length) return false;
      let diff = -1;
      for (let i = 0; i < q.length; i++) {
        if (q[i] !== bv[i]) {
          if (diff >= 0) return false;
          diff = i;
        }
      }
      return diff >= 0 && /\d/.test(bv[diff]) && !/\d/.test(q[diff]);
    });
    if (hits.length === 1) return { tag: hits[0], repaired: true };
  }
  return null;
}

interface Chain { axis: 'x' | 'y'; dims: { v: number; c: number; w: OcrWord }[]; scale: number; across: number; lines: number[] }

/** Normalized page units per metre at a drawing scale 1:den */
const unitsPerMetre = (den: number, pagePt: number) => (1000 / den) * (72 / 25.4) / pagePt;

function findChains(words: OcrWord[], axis: 'x' | 'y', pagePt: number, den?: number): Chain[] {
  const dims = words.filter(w => DIM.test(clean(w.text)) && (axis === 'y' || !w.vertical))
    .map(w => ({ v: Number(clean(w.text)), c: axis === 'x' ? cx(w) : cy(w), across: axis === 'x' ? cy(w) : cx(w), w }))
    .filter(d => d.v >= 0.5 && d.v <= 15);
  const rows: typeof dims[] = [];
  for (const d of [...dims].sort((a, b) => a.across - b.across)) {
    const r = rows.find(r => Math.abs(r[0].across - d.across) < 0.01);
    if (r) r.push(d); else rows.push([d]);
  }
  const prior = den ? unitsPerMetre(den, pagePt) : undefined;
  const chains: Chain[] = [];
  const emit = (cur: typeof dims, s: number) => {
    const lines = [cur[0].c - (s * cur[0].v) / 2];
    for (const d of cur) lines.push(lines[lines.length - 1] + s * d.v);
    chains.push({ axis, dims: cur, scale: s, across: cur[0].across, lines });
  };
  for (const row of rows) {
    row.sort((a, b) => a.c - b.c);
    if (row.length === 1) { if (prior) emit([row[0]], prior); continue; }
    const pairFit = (i: number, sc: number): { kind: 'direct' | 'gap' | 'none'; k?: number } => {
      const a = row[i], b = row[i + 1], g = b.c - a.c, want = (sc * (a.v + b.v)) / 2;
      if (Math.abs(g - want) / want < 0.08) return { kind: 'direct' };
      const k = g / sc - (a.v + b.v) / 2;
      const same = row.map(d => d.v).find(v => Math.abs(v - k) <= 0.1);
      if (same !== undefined) return { kind: 'gap', k: same };
      if (k >= 0.5 && k <= Math.max(...row.map(d => d.v)) && Math.abs(k - Math.round(k * 20) / 20) <= 0.03) return { kind: 'gap', k: Math.round(k * 20) / 20 };
      return { kind: 'none' };
    };
    const cands = row.slice(0, -1).map((a, i) => (row[i + 1].c - a.c) / ((a.v + row[i + 1].v) / 2)).filter(v => v > 0);
    if (prior) cands.push(prior);
    let best: { sc: number; score: number } | null = null;
    for (const sc of cands) {
      let score = 0, direct = 0;
      for (let i = 0; i + 1 < row.length; i++) { const f = pairFit(i, sc); if (f.kind === 'direct') { score += 1; direct++; } else if (f.kind === 'gap') score += 0.6; }
      const agreesPrior = !!prior && Math.abs(sc - prior) / prior < 0.12;
      if (!direct && !agreesPrior) continue;
      if (prior && !agreesPrior && direct < 2) continue;
      if (prior && Math.abs(sc - prior) / prior < 0.05) score += 0.3;
      if (!best || score > best.score) best = { sc, score };
    }
    if (!best) { if (prior) for (const d of row) emit([d], prior); continue; }
    const clean = row.slice(0, -1).map((_, i) => ({ i, f: pairFit(i, best!.sc) })).filter(x => x.f.kind === 'direct');
    const sc = clean.length ? clean.reduce((acc, x) => acc + (row[x.i + 1].c - row[x.i].c) / ((row[x.i].v + row[x.i + 1].v) / 2), 0) / clean.length : best.sc;
    let cur: typeof dims = [row[0]];
    for (let i = 0; i + 1 < row.length; i++) {
      const f = pairFit(i, sc);
      if (f.kind === 'direct') cur.push(row[i + 1]);
      else if (f.kind === 'gap') {
        const a = row[i];
        cur.push({ v: f.k!, c: a.c + (sc * (a.v + f.k!)) / 2, across: a.across, w: { ...a.w, text: `(${f.k!.toFixed(2)})` } }, row[i + 1]);
      } else {
        if (cur.length >= 2) emit(cur, sc); else if (prior) emit(cur, prior);
        cur = [row[i + 1]];
      }
    }
    if (cur.length >= 2) emit(cur, sc); else if (prior) emit(cur, prior);
  }
  const merged: Chain[] = [];
  for (const c of chains) {
    const partners = chains.filter(o => o !== c && Math.abs(o.across - c.across) < 0.06 && Math.abs(o.scale - c.scale) / c.scale < 0.08
      && o.lines[0] < c.lines[c.lines.length - 1] + 0.01 && c.lines[0] < o.lines[o.lines.length - 1] + 0.01);
    if (!partners.length) continue;
    const lines: number[] = [];
    for (const l of [c, ...partners].flatMap(x => x.lines).sort((a, b) => a - b)) {
      if (!lines.length || l - lines[lines.length - 1] > 0.3 * c.scale) lines.push(l);
    }
    if (lines.length > c.lines.length && !merged.some(m => m.lines.length === lines.length && Math.abs(m.lines[0] - lines[0]) < 0.003)) {
      merged.push({ axis, dims: [...c.dims, ...partners.flatMap(p => p.dims)], scale: c.scale, across: c.across, lines });
    }
  }
  return [...chains, ...merged];
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

interface Plan {
  xs: number[]; ys: number[]; region: [number, number, number, number]; xChain: Chain; yChain: Chain; score: number;
  /** column squares drawn on the plan (centres, normalized) */
  columns?: { x: number; y: number; r: number[] }[];
  /** grid read from the drawn grid lines: bay lengths in metres (dimension where read, measured otherwise) */
  drawn?: { x: number[]; y: number[] };
  /** a single-row (or single-column) plan found from the outlines drawn on its grid lines, not from tags */
  outlined?: boolean;
  /** grid labels read from the bubbles (single-row plans: the row's letter) */
  yLabels?: string[];
  xLabels?: string[];
}

/**
 * Columns are drawn as small squares on the grid crossings, to scale. They give the grid directly:
 * when the squares line up on >= 2 x 2 lines, those lines are the column grid, and a dimension-chain
 * grid that misses them (an OCR-dropped or misread dimension) is replaced.
 */
/**
 * Grid from the grid lines drawn on the plan — the way a person reads it: the grid is the family of
 * long parallel lines that run past the building out to the bubbles; dimension texts between two of
 * them give the bay in metres, and with that the drawing scale, so a bay whose dimension OCR missed
 * (or a sheet whose written scale is wrong) is still measured.
 *
 * Lines: normalized segments (h: x0,y,x1; v: x,y0,y1) from the vector drawing or the cleaned scan.
 */
function gridFromLines(p: PageOcr): Plan[] {
  if (!p.hsegs?.length || !p.vsegs?.length) return [];
  type Line = { c: number; lo: number; hi: number };
  const cluster = (segs: [number, number, number][], vertical: boolean): Line[] => {
    const cl: { c: number; lo: number; hi: number; n: number }[] = [];
    for (const s of segs) {
      const c = vertical ? s[0] : s[1], lo = vertical ? s[1] : s[0], hi = vertical ? s[2] : s[2];
      const k = cl.find(x => Math.abs(x.c - c) < 0.0025);
      if (k) { k.lo = Math.min(k.lo, lo); k.hi = Math.max(k.hi, hi); k.n++; k.c = (k.c * (k.n - 1) + c) / k.n; }
      else cl.push({ c, lo, hi, n: 1 });
    }
    return cl.filter(l => l.hi - l.lo >= 0.15 && l.c > 0.045 && l.c < 0.955).sort((a, b) => a.c - b.c);
  };
  const families = (lines: Line[]): Line[][] => {
    const fam: Line[][] = [];
    for (const l of lines) {
      const f = fam.find(g => g.some(o => Math.abs(o.lo - l.lo) < 0.04 && Math.abs(o.hi - l.hi) < 0.04));
      if (f) f.push(l); else fam.push([l]);
    }
    return fam.filter(f => f.length >= 2);
  };
  const vl = cluster(p.vsegs, true), hl = cluster(p.hsegs, false);
  const vf = families(vl), hf = families(hl);
  const circles = (p.circles || []).filter(c => c[2] > 0.01 && c[2] < 0.045);
  const bubbleOf = (l: Line, vertical: boolean) => circles.find(([x, y, r]) => {
    const rr = vertical ? (r * p.width) / p.height : r;
    const c = vertical ? x : y, along = vertical ? y : x;
    return Math.abs(c - l.c) < 0.003 && (Math.abs(along - l.lo) < 2.5 * rr || Math.abs(along - l.hi) < 2.5 * rr);
  });
  const aligned = (ls: Line[], vertical: boolean) => {
    const withB = ls.map(l => ({ l, b: bubbleOf(l, vertical) })).filter(x => x.b) as { l: Line; b: number[] }[];
    let best: Line[] = [];
    for (const a of withB) {
      const row = withB.filter(o => Math.abs((vertical ? o.b[1] : o.b[0]) - (vertical ? a.b[1] : a.b[0])) < 0.008).map(o => o.l);
      if (row.length > best.length) best = row;
    }
    return best;
  };
  const bv = aligned(vl, true), bh = aligned(hl, false);
  if (bv.length >= 2 && bh.length >= 2) { vf.push(bv); hf.push(bh); }
  const isBubbled = new Set([...bv, ...bh]);
  const dims = p.words.filter(w => DIM.test(clean(w.text))).map(w => ({ v: Number(clean(w.text)), w })).filter(d => d.v >= 0.5 && d.v <= 30);
  const meanExt = (f: Line[]) => f.reduce((a, l) => a + l.hi - l.lo, 0) / f.length;

  /** bays of one axis: dimension texts outside the plan between consecutive lines, and the scale they give */
  const measure = (lines: number[], axis: 'x' | 'y', outerEdge: number, side: -1 | 1) => {
    const bays: (number | null)[] = [];
    const per: number[] = [];
    const acrossOf = (dm: { w: OcrWord }) => (axis === 'x' ? cy(dm.w) : cx(dm.w));
    const cands: { v: number; at: number }[][] = [];
    for (let i = 0; i + 1 < lines.length; i++) {
      const a = lines[i], b = lines[i + 1];
      const d = dims.filter(dm => {
        const along = axis === 'x' ? cx(dm.w) : cy(dm.w), across = axis === 'x' ? cy(dm.w) : cx(dm.w);
        return (axis === 'x' ? !dm.w.vertical : true) && along > a + (b - a) * 0.2 && along < b - (b - a) * 0.2 && (across - outerEdge) * side > -0.005 && Math.abs(across - outerEdge) < 0.12;
      }).sort((m, n) => Math.abs((axis === 'x' ? cy(m.w) : cx(m.w)) - outerEdge) - Math.abs((axis === 'x' ? cy(n.w) : cx(n.w)) - outerEdge))
        .filter(dm => dm.v <= 15);
      cands.push(d.map(dm => ({ v: dm.v, at: acrossOf(dm) })));
    }
    const chainAt = cands.flat().sort((m, n) => Math.abs(m.at - outerEdge) - Math.abs(n.at - outerEdge))[0]?.at;
    for (let i = 0; i < cands.length; i++) {
      const v = cands[i].find(c => chainAt === undefined || Math.abs(c.at - chainAt) < 0.012)?.v ?? null;
      bays.push(v);
      if (v) per.push((lines[i + 1] - lines[i]) / v);
    }
    per.sort((m, n) => m - n);
    return { bays, scale: per.length ? per[Math.floor(per.length / 2)] : undefined, dimmed: per.length };
  };

  const plans: Plan[] = [];
  const splitRuns = (fam: Line[], vertical: boolean): Line[][] => {
    if (fam.length < 4) return [fam];
    const gaps = fam.slice(1).map((l, i) => l.c - fam[i].c);
    const out: Line[][] = [];
    let cur: Line[] = [fam[0]];
    for (let i = 0; i < gaps.length; i++) {
      const others = gaps.filter((_, k) => k !== i);
      const lo = fam[i].c, hi = fam[i + 1].c;
      const dimmed = dims.some(d => { const a = vertical ? cx(d.w) : cy(d.w); return a > lo + 0.2 * (hi - lo) && a < hi - 0.2 * (hi - lo) && (vertical ? !d.w.vertical : true); });
      if (!dimmed && gaps[i] > 2 * Math.max(...others)) { out.push(cur); cur = []; }
      cur.push(fam[i + 1]);
    }
    out.push(cur);
    return out.filter(r => r.length >= 2);
  };
  const vfRuns = vf.flatMap(f => splitRuns(f, true)), hfRuns = hf.flatMap(f => splitRuns(f, false));
  for (const fx of vfRuns) for (const fy of hfRuns) {
    if (fx.length < 2 || fy.length < 2) continue;
    let xs = fx.map(l => l.c), ys = fy.map(l => l.c);
    const vLo = Math.min(...fx.map(l => l.lo)), vHi = Math.max(...fx.map(l => l.hi));
    const hLo = Math.min(...fy.map(l => l.lo)), hHi = Math.max(...fy.map(l => l.hi));
    let mx = measure(xs, 'x', ys[0], -1), my = measure(ys, 'y', xs[0], -1);
    if (!mx.dimmed && !my.dimmed) continue;
    const hasDims = (axis: 'x' | 'y') => dims.some(dm => axis === 'x'
      ? !dm.w.vertical && cy(dm.w) < ys[0] && cy(dm.w) > ys[0] - 0.12 && cx(dm.w) > xs[0] - 0.02 && cx(dm.w) < xs[xs.length - 1] + 0.02
      : cx(dm.w) < xs[0] && cx(dm.w) > xs[0] - 0.12 && cy(dm.w) > ys[0] - 0.02 && cy(dm.w) < ys[ys.length - 1] + 0.02);
    if ((hasDims('x') && !mx.dimmed) || (hasDims('y') && !my.dimmed)) continue;
    const anchor = (lines: number[], m: ReturnType<typeof measure>, axis: 'x' | 'y', outer: number, fam: Line[]) => {
      const idx = m.bays.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
      if (!idx.length) return lines;
      let a = idx[0], b = idx[idx.length - 1] + 1;
      const s0 = m.scale!;
      const overall = dims.filter(dm => dm.v > 0 && Math.abs((axis === 'x' ? cy(dm.w) : cx(dm.w)) - outer) < 0.15).map(dm => dm.v);
      for (const tot of overall) for (let i = 0; i <= a; i++) for (let j = b; j < lines.length; j++) {
        if (Math.abs((lines[j] - lines[i]) / s0 - tot) < 0.1 && j - i > b - a) { a = i; b = j; }
      }
      const lo = fam[a].lo, hi = fam[a].hi;
      const same = (k: number) => (Math.abs(fam[k].lo - lo) < 0.012 && Math.abs(fam[k].hi - hi) < 0.012) || (isBubbled.has(fam[k]) && isBubbled.has(fam[a]));
      const round = (len: number) => { const v = len / s0; return v >= 0.5 && v <= 15 && Math.abs(v - Math.round(v * 20) / 20) < 0.06; };
      while (b + 1 < lines.length && same(b + 1) && round(lines[b + 1] - lines[b])) b++;
      while (a > 0 && same(a - 1) && round(lines[a] - lines[a - 1])) a--;
      return lines.slice(a, b + 1);
    };
    xs = anchor(xs, mx, 'x', ys[0], fx); ys = anchor(ys, my, 'y', xs[0], fy);
    if (xs.length < 2 || ys.length < 2) continue;
    if (!(ys[0] > vLo - 0.01 && ys[ys.length - 1] < vHi + 0.01 && xs[0] > hLo - 0.01 && xs[xs.length - 1] < hHi + 0.01)) continue;
    mx = measure(xs, 'x', ys[0], -1); my = measure(ys, 'y', xs[0], -1);
    const sx = mx.scale ?? (my.scale! * p.height) / p.width, sy = my.scale ?? (mx.scale! * p.width) / p.height;
    const roundBay = (len: number, s: number) => { const m = len / s; return m >= 0.5 && m <= 15 && Math.abs(m - Math.round(m * 20) / 20) < 0.08; };
    const okX = xs.every((v, i) => i === 0 || roundBay(v - xs[i - 1], sx)), okY = ys.every((v, i) => i === 0 || roundBay(v - ys[i - 1], sy));
    if (!okX || !okY) continue;
    const chain = (axis: 'x' | 'y', lines: number[], s: number, m: ReturnType<typeof measure>): Chain => ({
      axis, scale: s, across: axis === 'x' ? ys[0] : xs[0], lines,
      dims: m.bays.map((v, i) => ({ v: v ?? Math.round(((lines[i + 1] - lines[i]) / s) * 20) / 20, c: (lines[i] + lines[i + 1]) / 2, w: { text: v ? String(v) : '(drawn)', x0: 0, x1: 0, y0: 0, y1: 0, vertical: false, conf: 0 } })),
    });
    plans.push({
      xs, ys, region: [xs[0] - 0.04, ys[0] - 0.06, xs[xs.length - 1] + 0.06, ys[ys.length - 1] + 0.06],
      xChain: chain('x', xs, sx, mx), yChain: chain('y', ys, sy, my),
      drawn: {
        x: mx.bays.map((v, i) => v ?? Math.round(((xs[i + 1] - xs[i]) / sx) * 20) / 20),
        y: my.bays.map((v, i) => v ?? Math.round(((ys[i + 1] - ys[i]) / sy) * 20) / 20),
      },
      score: meanExt(fx) + meanExt(fy) + (mx.dimmed / Math.max(1, xs.length - 1) + my.dimmed / Math.max(1, ys.length - 1)),
    });
  }
  const out: Plan[] = [];
  for (const c of plans.sort((a, b) => b.score - a.score)) {
    if (out.some(o => overlaps(c.region, o.region))) continue;
    out.push(c);
  }
  return out;
}

/**
 * A grid that spans two drawings side by side (pile and spread-footing plans on one sheet): a gap far
 * wider than every other bay with no dimension written in it lies between drawings. Split there.
 */
function splitSideBySide(p: PageOcr, pl: Plan): Plan[] {
  const xs = pl.xs;
  if (xs.length < 4 || pl.drawn) return [pl];
  const dims = p.words.filter(w => !w.vertical && DIM.test(clean(w.text)));
  const gaps = xs.slice(1).map((v, i) => v - xs[i]);
  for (let i = 0; i < gaps.length; i++) {
    const others = gaps.filter((_, k) => k !== i);
    const lo = xs[i], hi = xs[i + 1];
    if (gaps[i] <= 2 * Math.max(...others)) continue;
    const rowY = pl.xChain.dims.map(d => cy(d.w)).filter(v => v > 0);
    if (dims.some(d => cx(d) > lo + 0.2 * (hi - lo) && cx(d) < hi - 0.2 * (hi - lo) && rowY.some(r => Math.abs(cy(d) - r) < 0.015))) continue;
    const part = (a: number, b: number): Plan => ({
      ...pl, xs: xs.slice(a, b),
      region: [xs[a] - 0.04, pl.region[1], xs[b - 1] + 0.06, pl.region[3]],
      xChain: { ...pl.xChain, lines: pl.xChain.lines.filter(l => l >= xs[a] - 0.001 && l <= xs[b - 1] + 0.001), dims: pl.xChain.dims.filter(d => d.c > xs[a] && d.c < xs[b - 1]) },
    });
    const left = part(0, i + 1), right = part(i + 1, xs.length);
    return [left, right].filter(q => q.xs.length >= 2).flatMap(q => splitSideBySide(p, q));
  }
  return [pl];
}

/** Two plans drawn above/below each other on the same sheet (e.g. shallow vs pile footing plan). */
function splitStacked(p: PageOcr, pl: Plan): Plan[] {
  const ys = pl.ys;
  if (ys.length < 4) return [pl];
  const dims = p.words.filter(w => w.vertical && DIM.test(clean(w.text)));
  const gaps = ys.slice(1).map((v, i) => v - ys[i]);
  for (let i = 0; i < gaps.length; i++) {
    const others = gaps.filter((_, k) => k !== i);
    const lo = ys[i], hi = ys[i + 1];
    if (hi - lo < 0.15 && gaps[i] <= 1.5 * Math.max(...others)) continue;
    const colX = pl.yChain.dims.map(d => cx(d.w)).filter(v => v > 0);
    if (dims.some(d => cy(d) > lo + 0.2 * (hi - lo) && cy(d) < hi - 0.2 * (hi - lo) && colX.some(r => Math.abs(cx(d) - r) < 0.015))) continue;
    const part = (a: number, b: number): Plan => ({
      ...pl, ys: ys.slice(a, b),
      region: [pl.region[0], ys[a] - 0.04, pl.region[2], ys[b - 1] + 0.06],
      yChain: { ...pl.yChain, lines: pl.yChain.lines.filter(l => l >= ys[a] - 0.001 && l <= ys[b - 1] + 0.001), dims: pl.yChain.dims.filter(d => d.c > ys[a] && d.c < ys[b - 1]) },
      drawn: pl.drawn ? { x: pl.drawn.x, y: pl.drawn.y.slice(a, b - 1) } : undefined,
    });
    const top = part(0, i + 1), bottom = part(i + 1, ys.length);
    return [top, bottom].filter(q => q.ys.length >= 2).flatMap(q => splitStacked(p, q));
  }
  return [pl];
}

/** how many member tags inside a plan sit on its grid lines (same test as plan detection) */
function tagFit(pl: Plan, tags: OcrWord[]) {
  const tolX = 0.6 * pl.xChain.scale, tolY = 0.6 * pl.yChain.scale;
  let inside = 0, onGrid = 0;
  for (const t of tags) {
    const x = cx(t), y = cy(t);
    if (x < pl.region[0] || x > pl.region[2] || y < pl.region[1] || y > pl.region[3]) continue;
    inside++;
    const dx = Math.min(...pl.xs.map(l => Math.abs(l - x))), dy = Math.min(...pl.ys.map(l => Math.abs(l - y)));
    if (dx < 2 * tolX || dy < 2 * tolY) onGrid++;
  }
  return { inside, onGrid };
}

function gridFromColumns(p: PageOcr, pl: Plan, den?: number): Plan {
  const kx = den ? unitsPerMetre(den, p.width) : pl.xChain.scale, ky = den ? unitsPerMetre(den, p.height) : pl.yChain.scale;
  if (!kx || !ky) return pl;
  const [rx0, ry0, rx1, ry1] = pl.region;
  const all = (p.rects || []).filter(r => {
    const w = (r[2] - r[0]) / kx, h = (r[3] - r[1]) / ky;
    return w >= 0.12 && w <= 0.6 && Math.abs(w - h) < 0.03;
  }).map(r => ({ x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2, r }));
  const near = (c: { x: number; y: number }, m: number) => c.x > rx0 - m && c.x < rx1 + m && c.y > ry0 - m && c.y < ry1 + m;
  const seed = all.filter(c => near(c, 0.08));
  const ext = all.filter(c => !seed.includes(c) && near(c, 0.25) && seed.some(s => Math.abs(s.x - c.x) < 0.004));
  const sq = [...seed, ...ext.filter(c => ext.some(o => o !== c && Math.abs(o.y - c.y) < 0.004) || seed.some(s => Math.abs(s.y - c.y) < 0.004))];
  const spots = sq.filter((s, i) => sq.findIndex(o => Math.abs(o.x - s.x) < 0.003 && Math.abs(o.y - s.y) < 0.003) === i);
  const size = (c: { r: number[] }) => Math.round(((c.r[2] - c.r[0]) / kx) * 100);
  const counts = new Map<number, number>();
  for (const c of spots) counts.set(size(c), (counts.get(size(c)) || 0) + 1);
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const cols = spots.filter(c => Math.abs(size(c) - mode!) <= 1);
  const cluster = (vs: number[]) => {
    const out: number[] = [];
    for (const v of [...vs].sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > 0.006) out.push(v);
    return out;
  };
  const xs = cluster(cols.map(c => c.x)), ys = cluster(cols.map(c => c.y));
  if (cols.length < 4 || xs.length < 2 || ys.length < 2) return pl;
  const bayOk = (ls: number[], k: number) => ls.every((l, i) => i === 0 || (l - ls[i - 1]) / k >= 1.0);
  if (!bayOk(xs, kx) || !bayOk(ys, ky)) return pl;
  const onCrossing = cols.filter(c => xs.some(x => Math.abs(x - c.x) < 0.006) && ys.some(y => Math.abs(y - c.y) < 0.006)).length;
  if (onCrossing < cols.length * 0.9) return pl;
  const misread = (lines: number[], cl: number[], k: number) =>
    lines.some(l => l > cl[0] + 0.15 * k && l < cl[cl.length - 1] - 0.15 * k && !cl.some(v => Math.abs(l - v) < 0.15 * k));
  const incomplete = (lines: number[], cl: number[], k: number) =>
    cl.some(v => v < lines[0] - 0.15 * k || v > lines[lines.length - 1] + 0.15 * k) && lines.every(l => l < cl[0] - 0.3 * k || l > cl[cl.length - 1] + 0.3 * k || cl.some(v => Math.abs(l - v) < 0.15 * k));
  const written = (c: Chain) => c.dims.map(d => d.v);
  const withCantilevers = (lines: number[], cl: number[], k: number, dims: number[]) =>
    [...lines.filter(l => {
      const gap = l < cl[0] ? (cl[0] - l) / k : (l - cl[cl.length - 1]) / k;
      return (l < cl[0] - 0.3 * k || l > cl[cl.length - 1] + 0.3 * k) && dims.some(d => Math.abs(d - gap) < 0.06);
    }), ...cl].sort((a, b) => a - b);
  const out: Plan = { ...pl, columns: cols };
  if (misread(pl.xs, xs, kx) || incomplete(pl.xs, xs, kx)) { const l = withCantilevers(pl.xs, xs, kx, written(pl.xChain)); out.xs = l; out.xChain = { ...pl.xChain, scale: kx, lines: l }; }
  if (misread(pl.ys, ys, ky) || incomplete(pl.ys, ys, ky)) { const l = withCantilevers(pl.ys, ys, ky, written(pl.yChain)); out.ys = l; out.yChain = { ...pl.yChain, scale: ky, lines: l }; }
  return out;
}

/** One-row (or one-column) plan from outlines of one size centred on a dimension chain's lines. */
export function outlinedRowPlans(p: PageOcr, den: number | undefined, boxes: number[][]): Plan[] {
  if (isDrawingIndexSheet(p)) return [];
  const out: Plan[] = [];
  for (const axis of ['x', 'y'] as const) {
    const X = axis === 'x';
    for (const ch of findChains(p.words, axis, X ? p.width : p.height, den)) {
      if (ch.lines.length < 3 || ch.dims.some(d => d.v < 1)) continue;
      const kx = X ? ch.scale : (ch.scale * p.height) / p.width, ky = X ? (ch.scale * p.width) / p.height : ch.scale;
      const along = (r: number[]) => (X ? r[0] + r[2] : r[1] + r[3]) / 2;
      const across = (r: number[]) => (X ? r[1] + r[3] : r[0] + r[2]) / 2;
      const sized = boxes.filter(r => Math.min((r[2] - r[0]) / kx, (r[3] - r[1]) / ky) >= 0.3 && Math.max((r[2] - r[0]) / kx, (r[3] - r[1]) / ky) <= 5);
      const on = ch.lines.map(l => sized.filter(r => Math.abs(along(r) - l) < 0.3 * ch.scale));
      let best: { r: number[]; i: number }[] = [];
      for (const r0 of on.flat()) {
        const like = (r: number[]) => Math.abs(across(r) - across(r0)) < 0.006 && [0, 1].every(k => Math.abs(r[k + 2] - r[k] - (r0[k + 2] - r0[k])) < 0.15 * (r0[k + 2] - r0[k]));
        const hit = on.map((rs, i) => ({ r: rs.filter(like).sort((a, b) => Math.abs(along(a) - ch.lines[i]) - Math.abs(along(b) - ch.lines[i]))[0], i })).filter(h => h.r);
        if (hit.length > best.length) best = hit;
      }
      if (best.length < 3 || best.length < 0.6 * ch.lines.length) continue;
      // Reject if boxes contain descriptive text / table cells (e.g. index/schedule cell contents)
      const hasTableText = best.some(h => p.words.some(w => /แปลน|แบบ|รายการ|สารบัญ|แผ่นที่|ระดับ|โครงสร้าง/i.test(w.text) && cx(w) >= h.r[0] && cx(w) <= h.r[2] && cy(w) >= h.r[1] && cy(w) <= h.r[3]));
      if (hasTableText) continue;
      const mean = (f: (h: { r: number[]; i: number }) => number) => best.reduce((a, h) => a + f(h), 0) / best.length;
      const shift = mean(h => along(h.r) - ch.lines[h.i]);
      const lines = ch.lines.map(l => l + shift);
      const row = mean(h => across(h.r));
      if (best.some(h => Math.abs(along(h.r) - lines[h.i]) > 0.1 * ch.scale) || Math.abs(row - ch.across) > 0.2) continue;
      const half = Math.max(...best.map(h => (X ? h.r[3] - h.r[1] : h.r[2] - h.r[0]) / 2));
      const lo = Math.min(ch.across, row - half) - 0.03, hi = row + half + 0.06, first = lines[0] - 0.04, last = lines[lines.length - 1] + 0.06;
      const main: Chain = { ...ch, lines };
      const cross: Chain = { axis: X ? 'y' : 'x', dims: [], scale: X ? ky : kx, across: lines[0], lines: [row] };
      out.push(X
        ? { xs: lines, ys: [row], region: [first, lo, last, hi], xChain: main, yChain: cross, score: best.length, outlined: true }
        : { xs: [row], ys: lines, region: [lo, first, hi, last], xChain: cross, yChain: main, score: best.length, outlined: true });
    }
  }
  const kept: Plan[] = [];
  const bubble = (at: number, vertical: boolean) => (p.circles || [])
    .filter(q => q[2] > 0.008 && q[2] < 0.045 && Math.abs((vertical ? q[0] : q[1]) - at) < 0.004)
    .map(q => p.words.find(w => /^[A-Z]$/.test(clean(w.text)) && Math.abs(cx(w) - q[0]) < q[2] / 2 && Math.abs(cy(w) - q[1]) < (q[2] / 2) * p.width / p.height))
    .find(Boolean);
  for (const c of out.sort((a, b) => b.score - a.score)) {
    if (kept.some(o => overlaps(c.region, o.region))) continue;
    const yb = c.ys.length === 1 && bubble(c.ys[0], false), xb = c.xs.length === 1 && bubble(c.xs[0], true);
    if (yb) c.yLabels = [clean(yb.text)];
    if (xb) c.xLabels = [clean(xb.text)];
    kept.push(c);
  }
  return kept;
}

function variantOf(words: OcrWord[]) {
  const t = words.map(w => w.text).join('');
  return /แผ่/.test(t) ? 'แผ่' : /เข็ม/.test(t) ? 'เสาเข็ม' : null;
}

/** Scale written under a plan ("SCALE 1:100"); a sheet can mix a 1:100 plan with 1:30 details. */
function planDen(p: PageOcr, region: number[], fallback?: number) {
  const below = p.words.filter(o => /^1:\d{2,3}$/.test(o.text) && cx(o) > region[0] && cx(o) < region[2] && cy(o) > region[3] - 0.02 && cy(o) < region[3] + 0.15);
  return below.length ? Number(below.sort((a, b) => cy(a) - cy(b))[0].text.slice(2)) : fallback;
}

const overlaps = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Grid systems on a sheet: the x/y dimension chains that put the most member tags on grid lines. */
function plansOn(p: PageOcr, den: number | undefined, tags: OcrWord[]): Plan[] {
  const xChains = findChains(p.words, 'x', p.width, den);
  const yChains = findChains(p.words, 'y', p.height, den);
  const cands: Plan[] = [];
  for (const xc of xChains) {
    const x0 = xc.lines[0], x1 = xc.lines[xc.lines.length - 1];
    for (const yc of yChains) {
      const y0 = yc.lines[0], y1 = yc.lines[yc.lines.length - 1];
      const yFit = (yc.across < x0 + 0.05 && yc.across > x0 - 0.25) || (yc.across > x1 - 0.05 && yc.across < x1 + 0.25) || (yc.across >= x0 && yc.across <= x1);
      const xFit = (xc.across < y0 + 0.05 && xc.across > y0 - 0.25) || (xc.across > y1 - 0.05 && xc.across < y1 + 0.25) || (xc.across >= y0 && xc.across <= y1);
      if (!yFit || !xFit) continue;
      if (Math.abs(xc.scale - yc.scale * (p.height / p.width)) / xc.scale > 0.15) continue;
      const region: [number, number, number, number] = [x0 - 0.04, yc.lines[0] - 0.06, x1 + 0.06, yc.lines[yc.lines.length - 1] + 0.06];
      const tolX = 0.6 * xc.scale, tolY = 0.6 * yc.scale;
      let score = 0, inside = 0;
      for (const t of tags) {
        const x = cx(t), y = cy(t);
        if (x < region[0] || x > region[2] || y < region[1] || y > region[3]) continue;
        inside++;
        const dx = Math.min(...xc.lines.map(l => Math.abs(l - x))), dy = Math.min(...yc.lines.map(l => Math.abs(l - y)));
        if (dx < 2 * tolX || dy < 2 * tolY) score += 1;
      }
      if (!inside || score / inside < 0.6) continue;
      cands.push({ xs: xc.lines, ys: yc.lines, xChain: xc, yChain: yc, region, score: score + 0.1 * (xc.dims.length + yc.dims.length) });
    }
  }
  const plans: Plan[] = [];
  for (const c of cands.sort((a, b) => b.score - a.score)) {
    if (c.score < 3) break;
    if (plans.some(pl => overlaps(c.region, pl.region))) continue;
    plans.push(c);
  }
  return plans.sort((a, b) => a.region[0] - b.region[0]);
}

const STANDARD_DEN = [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200];

/**
 * The drawing scale of a sheet, checked against its own dimensions: two neighbouring dimension
 * texts in a row are spaced by (d1 + d2) / 2 at the drawing scale. When that spacing fits a standard
 * scale and the written "1:xx" (as OCR read it) does not, the written one is a misread ("1:80" for "1:50").
 */
export function sheetDen(p: PageOcr): { den?: number; note?: string } {
  let written = scaleDen(p.words);
  let dropped = '';
  if (written) {
    const longest = Math.max(0, ...p.words.filter(w => DIM.test(clean(w.text)) && !w.vertical).map(w => Number(clean(w.text))).filter(v => v >= 0.5 && v <= 25));
    if (longest && longest * unitsPerMetre(written, p.width) > 0.95) { dropped = `มาตราส่วน 1:${written} ที่อ่านได้เป็นไปไม่ได้ (ระยะ ${longest} ม. ยาวเกินแผ่น)`; written = undefined; }
  }
  const votes = new Map<number, number>();
  for (const axis of ['x', 'y'] as const) {
    const pagePt = axis === 'x' ? p.width : p.height;
    const dims = p.words.filter(w => DIM.test(clean(w.text)) && (axis === 'y' ? w.vertical : !w.vertical))
      .map(w => ({ v: Number(clean(w.text)), c: axis === 'x' ? cx(w) : cy(w), a: axis === 'x' ? cy(w) : cx(w) }))
      .filter(d => d.v >= 0.5 && d.v <= 15);
    for (const d of dims) {
      const next = dims.filter(o => o !== d && Math.abs(o.a - d.a) < 0.01 && o.c > d.c).sort((m, n) => m.c - n.c)[0];
      if (!next) continue;
      const est = (next.c - d.c) / ((d.v + next.v) / 2);
      const den = (1000 * 72 / 25.4) / (est * pagePt);
      const std = STANDARD_DEN.find(sd => Math.abs(sd - den) / sd < 0.04);
      if (std) votes.set(std, (votes.get(std) || 0) + 1);
    }
  }
  const [best, n] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (best && n >= 2 && written !== best && !(written && votes.get(written))) {
    return { den: best, note: written ? `มาตราส่วนที่อ่านได้ 1:${written} ไม่ตรงกับระยะเส้นบอกระยะ — ใช้ 1:${best} ตามระยะที่วาด` : `ไม่พบมาตราส่วนที่เขียน — ใช้ 1:${best} ตามระยะเส้นบอกระยะ` };
  }
  return { den: written, note: dropped || undefined };
}

function scaleDen(words: OcrWord[]): number | undefined {
  const s = words.map(w => w.text.match(/^1:(\d{2,3})$/)).filter(Boolean).map(m => Number(m![1]));
  const counts = new Map<number, number>();
  for (const v of s) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function nearestIndex(lines: number[], v: number) {
  let best = 0;
  for (let i = 1; i < lines.length; i++) if (Math.abs(lines[i] - v) < Math.abs(lines[best] - v)) best = i;
  return best;
}
function spanIndex(lines: number[], v: number) {
  for (let i = 0; i < lines.length - 1; i++) if (v >= lines[i] && v <= lines[i + 1]) return i;
  return -1;
}

function parseSpacing(t: string): number | null {
  const m = clean(t).match(/(?:@|^2|^\))0?\.(\d{2,3})$/);
  if (!m) return null;
  const v = Number('0.' + m[1]);
  return v >= 0.08 && v <= 0.35 ? v : null;
}

/** Drawn size in metres of a normalized rect at 1:den (pdf points: 72/25.4 per mm). */
function measured(r: number[], p: PageOcr, den: number) {
  const k = (72 / 25.4) * (1000 / den);
  const snap = (v: number) => { const f = Math.round(v / 0.05) * 0.05; return Number((Math.abs(f - v) <= 0.012 ? f : Math.round(v * 200) / 200).toFixed(3)); };
  return { w: snap(((r[2] - r[0]) * p.width) / k), h: snap(((r[3] - r[1]) * p.height) / k) };
}

/**
 * Closed rectangles made of separate line segments (scans have no rectangle operators; some CAD
 * exports draw outlines as four lines): two horizontal edges with the same ends, joined at both ends
 * by vertical edges. Returns [x0, y0, x1, y1], normalized.
 */
export function segBoxes(p: PageOcr): number[][] {
  const hs = (p.hsegs || []).filter(s => s[2] - s[0] > 0.004 && s[2] - s[0] < 0.15);
  const vs = (p.vsegs || []).filter(s => s[2] - s[1] > 0.004);
  if (!hs.length || !vs.length || hs.length > 6000) return [];
  const tol = 0.002;
  const vAt = (x: number, ya: number, yb: number) => vs.some(v => Math.abs(v[0] - x) < tol && v[1] <= ya + tol && v[2] >= yb - tol);
  const out: number[][] = [];
  const byStart = [...hs].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < byStart.length; i++) {
    const a = byStart[i];
    for (let j = i + 1; j < byStart.length && byStart[j][0] - a[0] < tol; j++) {
      const b = byStart[j];
      if (Math.abs(b[2] - a[2]) >= tol || Math.abs(b[1] - a[1]) < 0.004) continue;
      const [top, bot] = a[1] < b[1] ? [a, b] : [b, a];
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[2], b[2]);
      if (vAt(x0, top[1], bot[1]) && vAt(x1, top[1], bot[1])) out.push([x0, top[1], x1, bot[1]]);
    }
  }
  return out;
}

/**
 * The outline drawn around a grid crossing, from the nearest edge on each side: scanned lines break
 * into fragments, so no closed rectangle survives, but each side keeps a piece. The four sides must sit
 * symmetrically about the crossing (a footing is centred on its column). kx/ky: normalized units per metre.
 */
function outlineAround(p: PageOcr, x: number, y: number, kx: number, ky: number, tol: number) {
  const minHalf = 0.18, maxHalf = 1.8;
  const hEdge = (dir: 1 | -1) => {
    let best: number | undefined;
    for (const s of p.hsegs || []) {
      const d = (s[1] - y) * dir / ky;
      if (d < minHalf || d > maxHalf) continue;
      const reach = d * kx;
      if (Math.min(s[2], x + reach) - Math.max(s[0], x - reach) < 0.3 * reach) continue;
      if (best === undefined || d < best) best = d;
    }
    return best;
  };
  const vEdge = (dir: 1 | -1) => {
    let best: number | undefined;
    for (const s of p.vsegs || []) {
      const d = (s[0] - x) * dir / kx;
      if (d < minHalf || d > maxHalf) continue;
      const reach = d * ky;
      if (Math.min(s[2], y + reach) - Math.max(s[1], y - reach) < 0.3 * reach) continue;
      if (best === undefined || d < best) best = d;
    }
    return best;
  };
  const t = hEdge(-1), b = hEdge(1), l = vEdge(-1), r = vEdge(1);
  if (t === undefined || b === undefined || l === undefined || r === undefined) return undefined;
  if (Math.abs(t - b) > Math.max(0.08, 0.2 * (t + b)) || Math.abs(l - r) > Math.max(0.08, 0.2 * (l + r))) return undefined;
  const snap = (v: number) => { const f = Math.round(v / 0.05) * 0.05; return Number((Math.abs(f - v) <= 0.03 ? f : v).toFixed(2)); };
  return { r: [x - l * kx, y - t * ky, x + r * kx, y + b * ky], g: { w: snap(l + r), h: snap(t + b), tol } };
}

/**
 * Section titles drawn as two circled marks, "(2) – (2)": the section is cut where the same mark is
 * drawn on a beam's long view, and that view carries the beam's name below it ("B2"). The title then
 * names that beam, like a written "B2" under the section would.
 */
function sectionMarkTitles(p: PageOcr, tagWords: { w: OcrWord; parts: { tag: string; repaired: boolean }[] }[]) {
  const circles = (p.circles || []).filter(c => c[2] > 0.008 && c[2] < 0.06);
  if (circles.length < 4) return [];
  const labelOf = (c: number[]) => {
    const r = c[2] / 2, ry = (r * p.width) / p.height;
    const inside = p.words.filter(w => !w.vertical && Math.abs(cx(w) - c[0]) < r && Math.abs(cy(w) - c[1]) < ry && /^[0-9A-Z]{1,2}$/.test(clean(w.text)));
    return inside.length === 1 ? clean(inside[0].text) : null;
  };
  const marks = circles.map(c => ({ c, label: labelOf(c) })).filter(m => m.label) as { c: number[]; label: string }[];
  const out: { w: OcrWord; parts: { tag: string; repaired: boolean }[] }[] = [];
  const used = new Set<number[]>();
  for (const a of marks) for (const b of marks) {
    if (a === b || used.has(a.c) || a.label !== b.label || b.c[0] <= a.c[0] || b.c[0] - a.c[0] > 0.12 || Math.abs(a.c[1] - b.c[1]) > 0.006) continue;
    const cuts = marks.filter(m => m !== a && m !== b && m.label === a.label && m.c[2] < Math.min(a.c[2], b.c[2]) * 0.95);
    if (!cuts.length) continue;
    const owners = cuts.map(m => tagWords.filter(t => !t.w.vertical && t.parts.length === 1 && /^[A-Z]{1,3}\d/.test(t.parts[0].tag) && !/^[FCS]/.test(t.parts[0].tag)
      && cy(t.w) > m.c[1] && cy(t.w) - m.c[1] < 0.25 && Math.abs(cx(t.w) - m.c[0]) < 0.3)
      .sort((x, y) => Math.hypot(cx(x.w) - m.c[0], cy(x.w) - m.c[1]) - Math.hypot(cx(y.w) - m.c[0], cy(y.w) - m.c[1]))[0]?.parts[0].tag).filter(Boolean) as string[];
    const tally = new Map<string, number>();
    for (const o of owners) tally.set(o, (tally.get(o) || 0) + 1);
    const best = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
    if (!best || best[1] < Math.ceil(owners.length / 2)) continue;
    used.add(a.c); used.add(b.c);
    const r = Math.max(a.c[2], b.c[2]) / 2, ry = (r * p.width) / p.height;
    out.push({
      w: { text: `${best[0]} (${a.label}–${a.label})`, x0: a.c[0] - r, x1: b.c[0] + r, y0: a.c[1] - ry, y1: a.c[1] + ry, conf: 90, vertical: false },
      parts: [{ tag: best[0], repaired: false }],
    });
  }
  return out;
}

/** The drawn section outline right above a detail title (section rectangles are drawn to scale). */
function outlineAbove(p: PageOcr, w: OcrWord, reach: number) {
  const x = cx(w);
  const cands = (p.rects || []).filter(r =>
    r[2] - r[0] < 0.2 && r[3] - r[1] < 0.3 &&
    (r[0] + r[2]) / 2 > x - 0.04 && (r[0] + r[2]) / 2 < x + 0.06 &&
    r[3] < w.y0 + 0.002 && r[3] > w.y0 - reach);
  return cands.sort((a, b) => b[3] - a[3])[0];
}

/** Scale written next to this detail ("1:20"), else the sheet's most common scale. */
function localDen(p: PageOcr, w: OcrWord, fallback?: number) {
  const s = p.words.map(o => ({ o, m: o.text.match(/^1:(\d{2,3})$/) }))
    .filter(q => q.m && Math.abs(cy(q.o) - cy(w)) < 0.06 && Math.abs(cx(q.o) - cx(w)) < 0.15)
    .sort((a, b) => Math.hypot(cx(a.o) - cx(w), cy(a.o) - cy(w)) - Math.hypot(cx(b.o) - cx(w), cy(b.o) - cy(w)));
  return s[0] ? Number(s[0].m![1]) : fallback;
}

/**
 * Footing cross-sections drawn to scale, from horizontal line segments (normalized x0, y, x1):
 * a top edge interrupted by the column (two pieces, gap 0.15–0.45 m) and, 0.12–0.60 m below,
 * a line covering the same width (footing bottom / top of the lean concrete).
 */
export function footingSections(hsegs: [number, number, number][], kx: number, ky: number) {
  const levels: { y: number; segs: [number, number][] }[] = [];
  for (const [x0, y, x1] of hsegs) {
    const lv = levels.find(l => Math.abs(l.y - y) < 0.0012);
    if (lv) lv.segs.push([x0, x1]); else levels.push({ y, segs: [[x0, x1]] });
  }
  levels.sort((a, b) => a.y - b.y);
  const snap = (v: number) => Math.round(v / 0.05) * 0.05;
  const out: { wM: number; tM: number; box: number[] }[] = [];
  for (const lv of levels) {
    const segs = [...lv.segs].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < segs.length; i++) {
      const a = segs[i], b = segs.find((s2, j) => j > i && s2[0] > a[1]);
      if (!b) continue;
      const gap = (b[0] - a[1]) / kx, pa = (a[1] - a[0]) / kx, pb = (b[1] - b[0]) / kx;
      if (gap < 0.15 || gap > 0.45 || Math.abs(pa - pb) > 0.05 || pa < 0.1) continue;
      const x0 = a[0], x1 = b[1], wM = Number(snap((x1 - x0) / kx).toFixed(2));
      if (wM < 0.5 || wM > 3.5) continue;
      const tol = 0.02 * kx;
      const covers = (segs: [number, number][]) => {
        let reach = -Infinity;
        for (const g of [...segs].sort((m, n) => m[0] - n[0])) {
          if (g[0] <= x0 + tol) reach = Math.max(reach, g[1]);
          else if (g[0] <= reach + tol) reach = Math.max(reach, g[1]);
        }
        return reach >= x1 - tol;
      };
      const bottom = levels.find(o => o.y > lv.y && (o.y - lv.y) / ky >= 0.12 && (o.y - lv.y) / ky <= 0.6 && covers(o.segs));
      if (!bottom) continue;
      const tM = Number(snap((bottom.y - lv.y) / ky).toFixed(2));
      if (!out.some(o => o.wM === wM && o.tM === tM && Math.abs(o.box[1] / 1000 - x0) < 0.01)) {
        out.push({ wM, tM, box: [lv.y, x0, bottom.y, x1].map(v => Math.round(v * 1000)) });
      }
    }
  }
  return out;
}

function footingSectionZone(box: number[], others: number[][]): (o: OcrWord) => boolean {
  const [y0, x0, y1, x1] = box.map(v => v / 1000);
  const w = x1 - x0;
  const mid = (b: number[]) => (b[1] + b[3]) / 2000;
  const rivals = others.filter(b => b[1] / 1000 > x1 || b[3] / 1000 < x0);
  const ownX = (o: OcrWord) => rivals.every(b => Math.abs(cx(o) - (x0 + x1) / 2) < Math.abs(cx(o) - mid(b)));
  return (o: OcrWord) => cx(o) > x0 && cx(o) < x1 + Math.max(0.1, w) && cy(o) > y0 - Math.max(0.08, w) && cy(o) < y1 + 0.005 && ownX(o);
}

/**
 * The bottom mesh written on a footing cross-section ("5+5ø12มม." on a leader, or the two layers
 * "7ø12" / "8ø12" one above the other): bar notes beside the section, from a little above its top
 * (leaders run up and out) to its bottom, nearer this section than any other on the sheet.
 * Only a mesh or a pair of layers of one size counts — a lone count is not a footing mesh.
 * box / others: [y0, x0, y1, x1] × 1000 as footingSections gives them.
 */
export function footingMeshAt(p: PageOcr, box: number[], others: number[][], grades: Map<number, 'RB' | 'DB'>) {
  const zone = footingSectionZone(box, others);
  const notes = barPhrases(p.words).filter(ph => ph.words.every(zone));
  const meshes = [...new Set(notes.filter(ph => ph.note.kind === 'mesh').map(ph => formatBar(ph.note, grades)))];
  if (meshes.length) return meshes.length === 1 ? meshes[0] : undefined;
  const counts = notes.filter(ph => ph.note.kind === 'count').sort((a, b) => cy(a.words[0]) - cy(b.words[0]));
  if (counts.length !== 2) return undefined;
  const [a, b] = counts.map(ph => ({ o: ph.words[0], n: ph.note as { n: number; dia: number; grade: 'RB' | 'DB' | null } }));
  const h = a.o.y1 - a.o.y0;
  if (a.n.dia !== b.n.dia || Math.abs(a.o.x0 - b.o.x0) > 1.5 * h || cy(b.o) - cy(a.o) > 4 * h || cy(b.o) - cy(a.o) < 0.8 * h) return undefined;
  return `${a.n.n}+${b.n.n}-${resolveGrade(a.n.grade ?? b.n.grade, a.n.dia, grades)}${a.n.dia}`;
}

export function footingBarNotes(p: PageOcr, box: number[], others: number[][], grades: Map<number, 'RB' | 'DB'>): string[] {
  const zone = footingSectionZone(box, others);
  const phrases = barPhrases(p.words).filter(ph => ph.words.every(zone));
  const phraseWords = new Set(phrases.flatMap(ph => ph.words));
  const items: { text: string; x: number; y: number }[] = [];

  for (const ph of phrases) {
    items.push({ text: formatBar(ph.note, grades), x: cx(ph.words[0]), y: cy(ph.words[0]) });
  }

  for (const w of p.words) {
    if (phraseWords.has(w) || w.vertical || !zone(w)) continue;
    const t = w.text.trim();
    // a note OCR could not parse keeps its "@" spacing, or a "+" next to a letter or ø ("3012+312@0.15L"); "+0.20" levels and "99+9" noise do not
    if (!/\d.*[@+].*\d/.test(t) || !(/@/.test(t) || /[a-zA-Z\u0E00-\u0E7FøØΦφ∅]/.test(t))) continue;
    items.push({ text: t, x: cx(w), y: cy(w) });
  }

  items.sort((a, b) => (Math.abs(a.y - b.y) < 0.008 ? a.x - b.x : a.y - b.y));
  return [...new Set(items.map(i => i.text))];
}

export interface ReaderResult { readings: SheetReading[]; notes: string[]; vocab: string[] }

export function readSheets(pages: PageOcr[]): ReaderResult {
  const notes: string[] = [];
  const counts = new Map<string, number>();
  const bare = new Map<string, number>();
  // index and notes sheets still name the set's real tags: they count for the vocabulary, never for members
  for (const p of pages) {
    for (const w of p.words) {
      const parts = splitTags(w.text, new Set());
      for (const part of parts) counts.set(part.tag, (counts.get(part.tag) || 0) + 1);
      if (parts.length === 2 && /^[A-Z0-9']+[,.][A-Z0-9']+$/.test(w.text.toUpperCase())) for (const part of parts) if (/^[A-Z]{1,2}'?$/.test(part.tag)) bare.set(part.tag, (bare.get(part.tag) || 0) + 1);
    }
  }
  const vocab = new Set([...counts.entries()].filter(([t, n]) => {
    // Standard low-index structural tags (B1..B19, C1..C19, F1..F19, RB1..RB19, S1..S9, GS) are kept even if seen once
    const isStandardTag = /^(GB|B|RB|TB|TG|WB|SB|BST|CB|C|F)([1-9]|1[0-9])[A-Z]?$/i.test(t) || /^(S[1-9]|GS|CS|PS)[A-Z]?$/i.test(t) || /^ST[1-9]$/i.test(t);
    if (isStandardTag && n >= 1) return true;
    // an OCR slip seen twice ("B83" for "B3": the letter read again as its look-alike digit) is not a tag of the set:
    // in the vocabulary it would block the repair back to the tag it came from
    const slipOf = t.match(/^([A-Z]*([A-Z]))(\d)(\d[A-Z]?)$/);
    if (slipOf && AS_LETTER[slipOf[3]] === slipOf[2] && (counts.get(slipOf[1] + slipOf[4]) ?? 0) >= n) return false;
    return n >= 2 && (/\d/.test(t) || /^(SP|GS)$/.test(t) || (bare.get(t) ?? 0) >= 2) && (t.length >= 2 || (bare.get(t) ?? 0) >= 2);
  }).map(([t]) => t));
  for (const p of pages) {
    if (isDrawingIndexSheet(p)) continue;
    const phrases = barPhrases(p.words);
    for (const w of p.words) {
      const t = clean(w.text);
      if (w.vertical || (counts.get(t) || 0) < 2) continue;
      if (/^[BC][A-Z]$/.test(t)) {
        const den = localDen(p, w, scaleDen(p.words));
        if (den && den <= 30 && outlineAbove(p, w, 0.12)) vocab.add(t);
      } else if (/^[BCF]$/.test(t)) {
        // Single letter member name (e.g. standard beam 'B', column 'C', footing 'F')
        const x = cx(w), y = cy(w);
        const hasRebarsAbove = phrases.some(ph => {
          const px = cx(ph.words[0]), py = cy(ph.words[0]);
          return Math.abs(px - x) < 0.08 && py < y && y - py < 0.15;
        });
        if (hasRebarsAbove) vocab.add(t);
      }
    }
  }

  const readings: SheetReading[] = [];
  let framingIdx = 0;
  const levelMarks: LevelMark[] = [];
  const planColumnSizes: { w: number; h: number; page: number }[] = [];

  const inCircle = (p: PageOcr, w: OcrWord) => (p.circles || []).some(c => Math.abs(c[0] - cx(w)) < c[2] / 2 && Math.abs(c[1] - cy(w)) < (c[2] / 2) * p.width / p.height);
  const tagWordsOf = (p: PageOcr) => {
    if (isDrawingIndexSheet(p)) return [];
    const excl = getDrawingIndexTableExclusion(p);
    const words = excl
      ? p.words.filter(w => !(cx(w) >= excl[0] && cx(w) <= excl[2] && cy(w) >= excl[1] && cy(w) <= excl[3]))
      : p.words;
    return words.map(w => {
      const parts = splitTags(w.text, vocab).filter(t => vocab.has(t.tag) || FOOTING_SIZE.test(t.tag));
      return { w, parts: parts.length === 1 && /^[A-Z]'?$/.test(parts[0].tag) && inCircle(p, w) ? [] : parts };
    }).filter(x => x.parts.length);
  };
  const planTagsOf = (tw: ReturnType<typeof tagWordsOf>) => tw.filter(t => t.parts.some(q => /^(GB|B|RB|TB|F|S\d|SP|GS)/.test(q.tag)));
  const inRegion = (pl: Plan, w: OcrWord) => cx(w) >= pl.region[0] && cx(w) <= pl.region[2] && cy(w) >= pl.region[1] && cy(w) <= pl.region[3];

  const planCache = new Map<number, Plan[]>();
  const namedFootingSizes = [
    ...pages.flatMap(p => p.words.map(w => clean(w.text).match(LABEL_SIZE)).filter(m => m && /^F/.test(m[1])).map(m => ({ w: Number(m![3]) / 1000, l: Number(m![4]) / 1000 }))),
    ...[...vocab].map(t => t.match(FOOTING_SIZE)).filter(Boolean).map(m => ({ w: Number(m![1]), l: Number(m![2]) })),
  ];
  const dens = new Map(pages.map(p => [p.page, sheetDen(p)]));
  const setGrades = gradeBySize(pages.flatMap(p => barPhrases(p.words).map(ph => ph.words.map(w => w.text).join(''))));
  const footingDrawn = new Map<string, { w: number; l: number; n: number; page: number }>();
  const pendingOutlines: { instances: PlanInstance[]; at: string; outline: { r: number[]; g: { w: number; h: number; tol?: number } }; title: string; level: string; learned: { tag: string; w: number; l: number }[] }[] = [];
  for (const [pg, d] of dens) if (d.note) notes.push(`หน้า ${pg}: ${d.note}`);
  for (const p of pages) {
    if (isDrawingIndexSheet(p)) {
      planCache.set(p.page, []);
      continue;
    }
    const tags = planTagsOf(tagWordsOf(p)).map(t => t.w);
    const pden = dens.get(p.page)!.den;
    let plans = plansOn(p, pden, tags).flatMap(pl => splitSideBySide(p, pl)).flatMap(pl => splitStacked(p, pl)).map(pl => gridFromColumns(p, pl, pden));
    for (const lp0 of gridFromLines(p).flatMap(pl => splitSideBySide(p, pl)).flatMap(pl => splitStacked(p, pl))) {
      const lp = gridFromColumns(p, lp0);
      if (lp.xs.length < 3 || lp.ys.length < 3) continue;
      const fit = tagFit(lp, tags);
      if (fit.onGrid < 3 || fit.onGrid / Math.max(1, fit.inside) < 0.6) continue;
      const rival = plans.filter(c => overlaps(c.region, lp.region));
      if (rival.some(c => tagFit(c, tags).onGrid > fit.onGrid)) continue;
      if (rival.some(c => c.xs.length > lp.xs.length || c.ys.length > lp.ys.length)) continue;
      plans = [...plans.filter(c => !rival.includes(c)), lp];
    }
    const drawnBoxes = [...(p.rects || []), ...segBoxes(p)];
    for (const rp of outlinedRowPlans(p, pden, drawnBoxes)) {
      if (plans.some(c => overlaps(rp.region, c.region))) continue;
      const rden = planDen(p, rp.region, pden);
      if (!rden) continue;
      const atCrossing = drawnBoxes.filter(r => rp.xs.some(x => Math.abs((r[0] + r[2]) / 2 - x) < 0.01) && rp.ys.some(y => Math.abs((r[1] + r[3]) / 2 - y) < 0.01));
      const footingSized = atCrossing.filter(r => { const g = measured(r, p, rden); return namedFootingSizes.some(f => (Math.abs(f.w - g.w) < 0.03 && Math.abs(f.l - g.h) < 0.03) || (Math.abs(f.w - g.h) < 0.03 && Math.abs(f.l - g.w) < 0.03)); });
      if (footingSized.length >= 3) plans.push(rp);
    }
    const written = p.words.map(w => w.text.match(/^1:(\d{2,3})$/)).filter(Boolean).map(m => Number(m![1]));
    if (written.length && Math.max(...written) <= 30 && pden !== undefined && pden <= 30) plans = [];
    planCache.set(p.page, plans);
  }
  // tags written inside a plan on any sheet: a title of a tag on no plan, read under 40%, may be OCR noise
  const tagsOnPlans = new Set(pages.flatMap(p => tagWordsOf(p).filter(t => planCache.get(p.page)!.some(pl => inRegion(pl, t.w))).flatMap(t => t.parts.map(q => q.tag))));
  const weakTitle = (t: { w: OcrWord; parts: { tag: string }[] }) => (t.w.conf ?? 99) < 40 && !t.parts.some(q => tagsOnPlans.has(q.tag));
  const reference = pages.flatMap(p => {
    const pl = planCache.get(p.page)!;
    const tags = planTagsOf(tagWordsOf(p));
    const onGrid = tags.filter(t => pl.some(x => inRegion(x, t.w))).length;
    return pl.length && onGrid >= 4 ? [{ plans: pl, den: dens.get(p.page)!.den }] : [];
  });

  for (const p of pages) {
    if (isDrawingIndexSheet(p)) {
      const isGeneralNotes = p.words.some(w => /ksc|fc'|f'c|WELDING|COVER|คอนกรีต|เหล็ก|ระยะหุ้ม|ระยะทาบ/i.test(w.text));
      readings.push({
        page: p.page,
        sheet_type: isGeneralNotes ? 'general_notes' : 'drawing_index',
        instances: [],
        sections: [],
        notes: [
          isGeneralNotes
            ? `หน้า ${p.page} เป็นรายการประกอบแบบวิศวกรรมโครงสร้าง/สารบัญแบบ — ข้ามการถอดปริมาณชิ้นส่วน (นำสเปกไปใช้ในการคำนวณ)`
            : `หน้า ${p.page} เป็นสารบัญแบบ — ข้ามการถอดปริมาณชิ้นส่วน`,
        ],
      });
      continue;
    }

    const den = dens.get(p.page)!.den;
    let plans = planCache.get(p.page)!;
    let tagWords = tagWordsOf(p);
    const planTags = planTagsOf(tagWords);

    const marks0 = p.words.filter(w => /^[+±]\d{1,2}\.\d{2}$/.test(clean(w.text)));
    if (marks0.length >= 2 && tagWords.length <= 2 && !levelMarks.length) {
      const storeys = p.words.filter(w => w.vertical && DIM.test(clean(w.text)) && cx(w) < 0.3).sort((a, b) => cy(b) - cy(a)).map(w => Number(clean(w.text)));
      let e = 0;
      storeys.forEach((h, i) => { e += h; levelMarks.push({ label: i === storeys.length - 1 && storeys.length >= 3 ? 'ระดับอะเส' : `ระดับพื้นชั้น ${i + 1}`, elevation_m: Number(e.toFixed(2)) }); });
      if (levelMarks.length) readings.push({ page: p.page, sheet_type: 'building_section', instances: [], sections: [], levels: levelMarks, notes: [`ความสูงชั้นจากเส้นบอกระยะ: ${storeys.join(' + ')} ม.`] });
      continue;
    }

    let gridFromReference = false;
    if (!plans.length && planTags.length >= 4 && reference.length) {
      const inside = (pl: Plan) => planTags.filter(t => inRegion(pl, t.w)).length;
      const best = reference
        .filter(r => !den || !r.den || r.den === den)
        .map(r => ({ r: r.plans, n: r.plans.reduce((a, pl) => a + inside(pl), 0) }))
        .sort((a, b) => b.n - a.n)[0];
      if (best && best.n >= planTags.length * 0.6) { plans = best.r; gridFromReference = true; }
    }
    if (plans.length && !gridFromReference && planTags.filter(t => plans.some(pl => inRegion(pl, t.w))).length < 3) plans = plans.filter(pl => pl.outlined);

    if (plans.length) {
      const instances: PlanInstance[] = [];
      const planLevels: string[] = [];
      const grids: { x: GridAxisMark[]; y: GridAxisMark[] }[] = [];
      let footingPlan = false;
      if (den) for (const pl of plans) for (const c of pl.columns || []) planColumnSizes.push({ ...measured(c.r, p, den), page: p.page });
      plans.forEach(pl => {
        const inside = tagWords.filter(t => cx(t.w) >= pl.region[0] && cx(t.w) <= pl.region[2] && cy(t.w) >= pl.region[1] && cy(t.w) <= pl.region[3]);
        const allTags = inside.flatMap(t => t.parts.map(x => x.tag));
        const hasSlab = inside.some(t => t.parts.some(q => /^(S\d|GS|SP)/.test(q.tag)));
        const withFooting = inside.filter(t => t.parts.some(q => /^F/.test(q.tag))).length;
        const isFooting = (withFooting >= 1 && !hasSlab) || withFooting >= Math.max(2, inside.length * 0.3) || (!!pl.outlined && inside.every(t => t.parts.every(q => /^[FC]/.test(q.tag))));
        const named = allTags.filter(t => t.length >= 2);
        const isSteel = named.length > 0 && named.filter(t => STEEL.test(t)).length >= named.length * 0.7;
        footingPlan = footingPlan || isFooting;
        const variant = variantOf(p.words.filter(o => cx(o) > pl.region[0] && cx(o) < pl.region[2] && cy(o) > pl.region[3] - 0.03 && cy(o) < pl.region[3] + 0.2));
        const title = isFooting
          ? (variant ? `แปลนฐานราก${variant}` : allTags.some(t => FOOTING_SIZE.test(t)) ? 'แปลนฐานรากแผ่' : withFooting ? 'แปลนฐานรากเสาเข็ม' : 'แปลนฐานราก')
          : isSteel ? 'แปลนโครงหลังคา' : `แปลนคาน ชั้น ${++framingIdx}`;
        const level = isFooting ? 'ฐานราก' : isSteel ? 'หลังคา' : `ชั้น ${framingIdx}`;
        planLevels.push(level);
        const xLab = pl.xLabels || pl.xs.map((_, i) => String(i + 1));
        const yLab = pl.yLabels || pl.ys.map((_, i) => LETTERS[i]);
        grids.push({
          x: pl.xs.map((v, i) => ({ label: xLab[i], offset_m: pl.drawn ? Number(pl.drawn.x.slice(0, i).reduce((m, n) => m + n, 0).toFixed(2)) : Number(((v - pl.xs[0]) / pl.xChain.scale).toFixed(2)) })),
          y: pl.ys.map((v, i) => ({ label: yLab[i], offset_m: pl.drawn ? Number(pl.drawn.y.slice(0, i).reduce((m, n) => m + n, 0).toFixed(2)) : Number(((v - pl.ys[0]) / pl.yChain.scale).toFixed(2)) })),
        });
        const tolX = 0.6 * pl.xChain.scale, tolY = 0.6 * pl.yChain.scale;
        if (isSteel) return;
        for (const { w, parts } of inside) {
          const conf = Math.min(0.9, (w.conf || 80) / 100) * (parts.some(p => p.repaired) ? 0.85 : 1) * (gridFromReference ? 0.9 : 1);
          const base = { box_2d: box(w), plan_title: title, level, confidence: Number(conf.toFixed(2)) };
          const x = cx(w), y = cy(w);
          if (parts.some(q => /^[FC]/.test(q.tag))) {
            const hasFooting = parts.some(q => /^F/.test(q.tag));
            let ax = x, ay = y;
            if (!hasFooting) {
              const lead = inside.find(o => o.w !== w && o.parts.some(q => /^F/.test(q.tag)) && Math.abs(cy(o.w) - y) < 0.015 && Math.abs(cx(o.w) - x) < 0.05);
              if (lead) { ax = cx(lead.w); ay = cy(lead.w); }
            }
            const i = nearestIndex(pl.xs, ax), j = nearestIndex(pl.ys, ay);
            if (Math.abs(pl.xs[i] - ax) > 3.0 * tolX || Math.abs(pl.ys[j] - ay) > 3.0 * tolY) continue;
            const at = `${yLab[j]}/${xLab[i]}`;
            const colParts = parts.filter(p => /^(C|CS)/.test(p.tag));
            const footParts = parts.filter(p => /^F/.test(p.tag));
            if (colParts.length && !instances.some(o => o.member_type === 'COLUMN' && o.from_grid === at && o.plan_title === title)) {
              instances.push({ ...base, tag: colParts.map(p => p.tag).join(','), member_type: 'COLUMN', from_grid: at });
            }
            if (footParts.length) {
              instances.push({ ...base, tag: footParts.map(p => p.tag).join(','), member_type: 'FOOTING', from_grid: at });
            } else if (!colParts.length) {
              instances.push({ ...base, tag: parts.map(p => p.tag).join(','), member_type: hasFooting ? 'FOOTING' : 'COLUMN', from_grid: at });
            }
            continue;
          }
          for (const { tag } of parts) {
            if (/^(S\d|SP|GS|CS|PS)/.test(tag)) {
              // Ignore any tag lying on or outside the outer grid / dimension lines
              const inInterior = x > pl.xs[0] + 0.008 && x < pl.xs[pl.xs.length - 1] - 0.008 &&
                                 y > pl.ys[0] + 0.008 && y < pl.ys[pl.ys.length - 1] - 0.008;
              if (!inInterior) continue;
              const i = spanIndex(pl.xs, x), j = spanIndex(pl.ys, y);
              if (i >= 0 && j >= 0 && i < pl.xs.length - 1 && j < pl.ys.length - 1) {
                instances.push({ ...base, tag, member_type: 'SLAB', from_grid: `${yLab[j]}/${xLab[i]}`, to_grid: `${yLab[j + 1]}/${xLab[i + 1]}` });
              }
            } else if (/^ST\d/.test(tag)) {
              continue;
            } else if (/^(C|CS)/.test(tag)) {
              const i = nearestIndex(pl.xs, x), j = nearestIndex(pl.ys, y);
              instances.push({ ...base, tag, member_type: 'COLUMN', from_grid: `${yLab[j]}/${xLab[i]}` });
            } else if (/^F/.test(tag)) {
              const i = nearestIndex(pl.xs, x), j = nearestIndex(pl.ys, y);
              instances.push({ ...base, tag, member_type: 'FOOTING', from_grid: `${yLab[j]}/${xLab[i]}` });
            } else if (/^(GB|B|RB|TB|TG|WB|SB|BST)\d*[A-Z]?'?$/i.test(tag)) {
              if (!w.vertical) {
                const j = nearestIndex(pl.ys, y), i = spanIndex(pl.xs, x);
                const beyond = y < pl.ys[0] || y > pl.ys[pl.ys.length - 1];
                const onRow = Math.abs(pl.ys[j] - y) < (beyond ? 0.35 * pl.yChain.scale : tolY);
                const ci = nearestIndex(pl.xs, x), rj = spanIndex(pl.ys, y);
                const besideCol = Math.abs(pl.xs[ci] - x) < 1.6 * tolX;
                const offRow = pl.ys.every(v => Math.abs(v - y) > 0.6 * tolY);
                if (!onRow && offRow && besideCol && rj >= 0) {
                  instances.push({
                    ...base, tag, member_type: 'BEAM',
                    from_grid: `${yLab[rj]}/${xLab[ci]}`, to_grid: `${yLab[rj + 1]}/${xLab[ci]}`,
                    length_m: Number(((pl.ys[rj + 1] - pl.ys[rj]) / pl.yChain.scale).toFixed(2)),
                    confidence: Number((base.confidence * 0.9).toFixed(2)),
                  });
                  continue;
                }
                // Diagonal beam inside bay between non-collinear grid nodes
                if (!onRow && i >= 0 && rj >= 0 && i < pl.xs.length - 1 && rj < pl.ys.length - 1) {
                  const dx = (pl.xs[i + 1] - pl.xs[i]) / pl.xChain.scale;
                  const dy = (pl.ys[rj + 1] - pl.ys[rj]) / pl.yChain.scale;
                  const diagLen = Number(Math.hypot(dx, dy).toFixed(2));
                  if (diagLen >= 0.5 && diagLen <= 15) {
                    instances.push({
                      ...base, tag, member_type: 'BEAM',
                      from_grid: `${yLab[rj]}/${xLab[i]}`, to_grid: `${yLab[rj + 1]}/${xLab[i + 1]}`,
                      length_m: diagLen,
                      confidence: Number((base.confidence * 0.85).toFixed(2)),
                    });
                    continue;
                  }
                }
                instances.push({
                  ...base, tag, member_type: 'BEAM',
                  from_grid: onRow && i >= 0 ? `${yLab[j]}/${xLab[i]}` : null, to_grid: onRow && i >= 0 ? `${yLab[j]}/${xLab[i + 1]}` : null,
                  length_m: onRow && i >= 0 ? Number(((pl.xs[i + 1] - pl.xs[i]) / pl.xChain.scale).toFixed(2)) : null,
                  confidence: Number((base.confidence * (onRow && i >= 0 ? 1 : 0.6)).toFixed(2)),
                });
              } else {
                const i = nearestIndex(pl.xs, x), j = spanIndex(pl.ys, y);
                const onCol = Math.abs(pl.xs[i] - x) < tolX;
                instances.push({
                  ...base, tag, member_type: 'BEAM',
                  from_grid: j >= 0 ? `${yLab[j]}/${onCol ? xLab[i] : 'x' + Math.round(x * 1000)}` : null,
                  to_grid: j >= 0 ? `${yLab[j + 1]}/${onCol ? xLab[i] : 'x' + Math.round(x * 1000)}` : null,
                  length_m: j >= 0 ? Number(((pl.ys[j + 1] - pl.ys[j]) / pl.yChain.scale).toFixed(2)) : null,
                  confidence: Number((base.confidence * (j >= 0 ? (onCol ? 1 : 0.85) : 0.6)).toFixed(2)),
                });
              }
            }
          }
        }
        if (!isFooting && pl.columns?.length) {
          for (const c of pl.columns) {
            const i = nearestIndex(pl.xs, c.x), j = nearestIndex(pl.ys, c.y);
            const at = `${yLab[j]}/${xLab[i]}`;
            if (instances.some(o => o.member_type === 'COLUMN' && o.from_grid === at && o.level === level)) continue;
            instances.push({
              tag: 'C?', member_type: 'COLUMN', from_grid: at, plan_title: title, level, confidence: 0.8,
              box_2d: [c.r[1], c.r[0], c.r[3], c.r[2]].map(v => Math.round(v * 1000)), box_src: 'shape',
            });
          }
        }
        if (isFooting) {
          const kx = pl.xChain.scale, ky = pl.yChain.scale;
          const lineBoxes = segBoxes(p);
          const squares = [...(p.rects || []), ...lineBoxes].filter(r => {
            const w = (r[2] - r[0]) / kx, h = (r[3] - r[1]) / ky;
            return w >= 0.12 && w <= 0.6 && Math.abs(w - h) < 0.03;
          }).map(r => ({ x: (r[0] + r[2]) / 2, y: (r[1] + r[3]) / 2 }));
          const colAt = (x: number, y: number) => squares.some(c => Math.abs(c.x - x) < 0.15 * kx && Math.abs(c.y - y) < 0.15 * ky);
          const withCol = pl.xs.flatMap(x => pl.ys.filter(y => colAt(x, y))).length;
          if (withCol >= 3) {
            for (let k = instances.length - 1; k >= 0; k--) {
              const o = instances[k];
              if (!o.from_grid || o.tag.split(',').some(t => /^F/.test(t)) || !/^C/.test(o.tag)) continue;
              const [row, col] = o.from_grid.split('/');
              const x = pl.xs[xLab.indexOf(col)], y = pl.ys[yLab.indexOf(row)];
              if (x === undefined || y === undefined) continue;
              if (!colAt(x, y)) instances.splice(k, 1);
            }
          }
          if (withCol >= 3) for (let i = 0; i < pl.xs.length; i++) for (let j = 0; j < pl.ys.length; j++) {
            const at = `${yLab[j]}/${xLab[i]}`;
            if (!colAt(pl.xs[i], pl.ys[j]) || instances.some(o => o.from_grid === at && (o.plan_title === title || !title) && o.tag.split(',').some(t => /^C/.test(t)))) continue;
            const sq = [...(p.rects || []), ...lineBoxes].find(r => Math.abs((r[0] + r[2]) / 2 - pl.xs[i]) < 0.15 * kx && Math.abs((r[1] + r[3]) / 2 - pl.ys[j]) < 0.15 * ky)!;
            instances.push({ tag: 'C?', member_type: 'COLUMN', from_grid: at, plan_title: title, level, confidence: 0.6, box_2d: [sq[1], sq[0], sq[3], sq[2]].map(v => Math.round(v * 1000)), box_src: 'shape' });
          }
          const fden = planDen(p, pl.region, den);
          const boxes = (fden ? [...(p.rects || []), ...lineBoxes] : []).map(r => ({ r, g: measured(r, p, fden!) }))
            .filter(({ g }) => Math.max(g.w, g.h) >= 0.4 && Math.max(g.w, g.h) <= 3.5);
          const outlineAt = (x: number, y: number) => boxes
            .filter(({ r }) => Math.abs((r[0] + r[2]) / 2 - x) < 0.01 && Math.abs((r[1] + r[3]) / 2 - y) < 0.01)
            .sort((a, b) => b.g.w * b.g.h - a.g.w * a.g.h)[0]
            ?? outlineAround(p, x, y, pl.xChain.scale, pl.yChain.scale, p.rects?.length ? 0.03 : 0.08);
          const sized = (g: { w: number; h: number; tol?: number }, w: number, l: number, e = g.tol ?? 0.03) =>
            (Math.abs(w - g.w) < e && Math.abs(l - g.h) < e) || (Math.abs(w - g.h) < e && Math.abs(l - g.w) < e);
          const crossings = pl.xs.flatMap((x, i) => pl.ys.map((y, j) => ({ x, y, at: `${yLab[j]}/${xLab[i]}` })));
          const known = new Map<string, { w: number; h: number }[]>();
          for (const c of crossings) {
            const tagged = instances.filter(o => o.member_type === 'FOOTING' && o.from_grid === c.at).flatMap(o => o.tag.split(',').filter(t => /^F/.test(t)));
            const o = tagged.length === 1 ? outlineAt(c.x, c.y) : undefined;
            if (o) known.set(tagged[0], [...(known.get(tagged[0]) || []), o.g]);
          }
          const learned = [...known.entries()].map(([tag, gs]) => {
            const g = gs.find(a => gs.filter(b => sized(b, a.w, a.h)).length > gs.length / 2);
            return g && { tag, w: Math.min(g.w, g.h), l: Math.max(g.w, g.h), n: gs.length };
          }).filter(Boolean) as { tag: string; w: number; l: number; n: number }[];
          const tolL = boxes.length ? 0.03 : 0.08;
          for (const lt of learned) {
            const twin = learned.some(o => o !== lt && Math.abs(o.w - lt.w) < tolL && Math.abs(o.l - lt.l) < tolL);
            if (lt.n >= 2 && !twin) footingDrawn.set(lt.tag, { ...lt, page: p.page });
          }
          for (const c of crossings) {
            if (instances.some(o => o.member_type === 'FOOTING' && o.from_grid === c.at)) continue;
            const outline = outlineAt(c.x, c.y);
            if (outline) pendingOutlines.push({ instances, at: c.at, outline, title, level, learned: learned.filter(lt => lt.n >= 2) });
          }
          if (fden) for (const c of crossings) {
            if (instances.some(o => o.from_grid === c.at && (o.plan_title === title || !title) && o.tag.split(',').some(t => /^C/.test(t)))) continue;
            const outer = boxes.filter(({ r }) => Math.abs((r[0] + r[2]) / 2 - c.x) < 0.01 && Math.abs((r[1] + r[3]) / 2 - c.y) < 0.01).sort((a, b) => b.g.w * b.g.h - a.g.w * a.g.h)[0];
            if (!outer) continue;
            const [ox0, oy0, ox1, oy1] = outer.r;
            const stub = boxes.find(({ r, g }) => r[0] > ox0 && r[1] > oy0 && r[2] < ox1 && r[3] < oy1
              && Math.abs((r[0] + r[2]) / 2 - c.x) < 0.15 * kx && Math.abs((r[1] + r[3]) / 2 - c.y) < 0.15 * ky
              && Math.min(g.w, g.h) >= 0.15 && Math.max(g.w, g.h) <= 1.2);
            if (stub) instances.push({ tag: 'C?', member_type: 'COLUMN', from_grid: c.at, plan_title: title, level, confidence: 0.6, box_2d: [stub.r[1], stub.r[0], stub.r[3], stub.r[2]].map(v => Math.round(v * 1000)), box_src: 'shape' });
          }
        }
      });
      readings.push({
        page: p.page,
        sheet_type: footingPlan ? 'footing_plan' : 'framing_plan',
        sheet_title: plans.length === 1 ? (instances[0]?.plan_title || '') : undefined,
        level: planLevels.length === 1 ? planLevels[0] : undefined,
        grid: grids[0],
        instances,
        sections: [],
        notes: [...(den ? [`มาตราส่วน 1:${den}`] : []), ...(gridFromReference ? ['กริดจากแผ่นแบบแม่แบบเดียวกัน (อ่านเส้นบอกระยะไม่ได้)'] : [])],
      });
      tagWords = tagWords.filter(t => !plans.some(pl => inRegion(pl, t.w)));
      if (!tagWords.length) continue;
    }

    const sheetRefs = p.words.filter(w => /^S[—–-]?\d{2}\.?$/.test(clean(w.text))).length;
    if (sheetRefs >= 5) {
      notes.push(`หน้า ${p.page} เป็นสารบัญแบบ (อ้างถึง ${sheetRefs} แผ่น) — ไม่อ่านเป็นแบบขยาย`);
      continue;
    }

    const sections: SectionDef[] = [];
    const phrases = barPhrases(p.words);
    const mergedDecimals: OcrWord[] = [];
    const usedDec = new Set<OcrWord>();
    for (const w of p.words) {
      if (w.vertical || usedDec.has(w)) continue;
      const t = clean(w.text);
      if (/^\d{1,2}\.$/.test(t)) {
        const next = p.words.find(o => o !== w && !o.vertical && !usedDec.has(o) && Math.abs(cy(o) - cy(w)) < 0.008 && o.x0 >= w.x1 - 0.005 && o.x0 - w.x1 < 0.02 && /^\d{2}$/.test(clean(o.text)));
        if (next) {
          usedDec.add(w); usedDec.add(next);
          mergedDecimals.push({ text: t + clean(next.text), x0: w.x0, x1: next.x1, y0: Math.min(w.y0, next.y0), y1: Math.max(w.y1, next.y1), conf: Math.min(w.conf ?? 90, next.conf ?? 90), vertical: false });
        }
      } else if (/^\.\d{2}$/.test(t)) {
        mergedDecimals.push({ ...w, text: '0' + t });
      }
    }
    const allWords = [...p.words.filter(w => !usedDec.has(w)), ...mergedDecimals];
    const nums = allWords.filter(w => DIM.test(clean(w.text))).map(w => ({ w, v: Number(clean(w.text)) }));
    const allTitles = [...tagWords, ...sectionMarkTitles(p, tagWords)].filter(t => !t.w.vertical);
    for (const { w, parts } of allTitles) {
      if (w.vertical) continue;
      // a section-mark bubble (number between its own lines) is a real title: only tag labels are checked
      if (tagWords.some(t => t.w === w) && tagInsideDrawing(p, w)) continue;
      if (parts.length === 1 && parts[0].repaired && allTitles.some(t => t.w !== w && t.parts.some(q => q.tag === parts[0].tag && !q.repaired))) continue;
      const sizes = parts.map(q => q.tag.match(FOOTING_SIZE)?.slice(1, 3).join('x')).filter(Boolean);
      if (parts.length > 1 && sizes.length === parts.length && new Set(sizes).size > 1) continue;
      const x = cx(w), y = cy(w);
      const isSlabTitle = parts.every(q => /^(S\d|SP|GS)/.test(q.tag)) && !/^\d+$/.test(clean(w.text));
      const isFootingTitle = parts.some(q => /^F/.test(q.tag));
      const planAbove = plans.filter(pl => pl.region && pl.region[3] < y && Math.max(pl.region[0], x - 0.11) < Math.min(pl.region[2], x + 0.13));
      const planBottom = planAbove.length ? Math.max(...planAbove.map(pl => pl.region[3])) : undefined;
      const maxReach = planBottom !== undefined ? Math.max(0.10, y - planBottom - 0.01) : (isFootingTitle ? 0.75 : 0.2);
      const above = tagWords.filter(t => t.w !== w && !t.w.vertical && cx(t.w) > x - 0.11 && cx(t.w) < x + 0.13 && cy(t.w) < y - 0.03 && /^F/.test(t.parts[0].tag) === isFootingTitle)
        .map(t => cy(t.w)).sort((a, b) => b - a)[0];
      const reach = Math.min(maxReach, above !== undefined ? y - above - 0.01 : 1);
      // a weak title does not compete with a more confident one for the words between them
      const ownTitles = allTitles.filter(t => t.w !== w && !(weakTitle(t) && (w.conf ?? 99) > (t.w.conf ?? 99)));
      const inAnyPlan = (o: OcrWord) => plans.some(pl => pl.region && cx(o) >= pl.region[0] && cx(o) <= pl.region[2] && cy(o) >= pl.region[1] && cy(o) <= pl.region[3]);
      const mine = (o: OcrWord) => {
        const d = Math.hypot(cx(o) - x, (cy(o) - y) * 0.6);
        return !ownTitles.some(t => {
          if (cy(t.w) <= cy(o)) return false;
          if (Math.abs(cy(t.w) - y) <= 0.015) {
            return cx(t.w) < x ? cx(o) < (cx(t.w) + x) / 2 : cx(o) > (cx(t.w) + x) / 2;
          }
          return Math.hypot(cx(o) - cx(t.w), (cy(o) - cy(t.w)) * 0.6) < d * 0.8;
        });
      };
      const inRegion = (o: OcrWord) => cx(o) > x - (isSlabTitle ? 0.2 : 0.11) && cx(o) < x + (isSlabTitle ? 0.2 : 0.13) && cy(o) < y - 0.004 && cy(o) > y - reach && !inAnyPlan(o) && mine(o);
      const hNums = nums.filter(n => !n.w.vertical && inRegion(n.w));
      const vNums = nums.filter(n => n.w.vertical && inRegion(n.w));
      const notesHere = phrases.filter(ph => ph.words.every(inRegion));
      const counts = notesHere.filter(ph => ph.note.kind === 'count').sort((a, b) => cy(a.words[0]) - cy(b.words[0]));
      const spaced = notesHere.filter(ph => ph.note.kind === 'spacing');
      const meshes = notesHere.filter(ph => ph.note.kind === 'mesh');
      const bars = counts.map(ph => ({ o: ph.words[0], b: ph.note as { n: number; dia: number }, text: formatBar(ph.note, setGrades) }));
      const rowsOf: { y: number; x0: number; x1: number; texts: string[] }[] = [];
      for (const b of bars) {
        const row = rowsOf.find(r => Math.abs(r.y - cy(b.o)) < 0.006 && Math.max(b.o.x0 - r.x1, r.x0 - b.o.x1) < 0.03);
        if (row) { if (!row.texts.includes(b.text)) row.texts.push(b.text); row.x0 = Math.min(row.x0, b.o.x0); row.x1 = Math.max(row.x1, b.o.x1); }
        else rowsOf.push({ y: cy(b.o), x0: b.o.x0, x1: b.o.x1, texts: [b.text] });
      }
      const barRows = rowsOf.map(r => r.texts);
      const stirrupNote = spaced.filter(ph => (ph.note as { dia: number }).dia <= 12).sort((a, b) => Math.hypot(cx(a.words[0]) - x, cy(a.words[0]) - y) - Math.hypot(cx(b.words[0]) - x, cy(b.words[0]) - y))[0];
      const spacingLegacy = p.words.filter(o => inRegion(o)).map(o => parseSpacing(o.text)).find(v => v !== null) ?? null;
      const stirrup = stirrupNote ? formatBar(stirrupNote.note, setGrades) : null;
      const stirrupSets = stirrupNote ? tieSets(stirrupNote.note) : undefined;
      const first = parts[0].tag;
      const type = /^F/.test(first) ? 'FOOTING' : /^(S\d|SP|GS)/.test(first) ? 'SLAB' : /^ST/.test(first) ? 'STAIR' : /^C/.test(first) ? 'COLUMN' : 'BEAM';
      const widths = hNums.filter(n => n.v >= 0.08 && n.v <= 0.6).map(n => n.v);
      const minW = widths.length ? Math.min(...widths) : 0;
      const depths = [
        ...vNums.filter(n => n.v >= 0.15 && n.v <= 1.5).sort((a, b) => Math.abs(cx(a.w) - x) - Math.abs(cx(b.w) - x)),
        ...hNums.filter(n => n.v > minW && n.v >= 0.2 && n.v <= 1.2).sort((a, b) => a.v - b.v),
      ].map(n => n.v);
      const writtenSize = p.words.filter(inRegion).map(o => clean(o.text).match(/^(\d\.\d{2})X(\d\.\d{2})$/)).find(Boolean)?.slice(1, 3).map(Number) as [number, number] | undefined;
      const evidence = [w.text, ...hNums.map(n => n.w.text), ...vNums.map(n => '|' + n.w.text), ...notesHere.map(b => b.text)].join(' ');
      const sec: SectionDef = { tag: parts.map(q => q.tag).join(','), member_type: type, box_2d: box(w), evidence, confidence: 0.7 };
      const onSpanRow = (n: { w: OcrWord; v: number }) => nums.some(o => !o.w.vertical && o.v >= 1.2 && o.v <= 12 && Math.abs(cy(o.w) - cy(n.w)) < 0.02 && Math.abs(cx(o.w) - cx(n.w)) < 0.35);
      const elevation = type === 'BEAM' && hNums.some(n => (n.v >= 1.2 && n.v <= 12) || onSpanRow(n));
      if (elevation && allTitles.some(t => t.w !== w && t.w.text.includes('–') && t.parts.some(q => parts.some(pp => pp.tag === q.tag)))) continue;
      if (type === 'BEAM') {
        const depthBeside = (n: { w: OcrWord }) => nums.find(v => v.w.vertical && v.v >= 0.15 && v.v <= 1.2 && cx(v.w) < cx(n.w) && cx(n.w) - cx(v.w) < 0.06 && cy(v.w) > cy(n.w) && cy(v.w) - cy(n.w) < 0.12);
        const narrow = (n: { w: OcrWord; v: number }) => !n.w.vertical && n.v >= 0.08 && n.v <= 0.6;
        const sectionWidths = hNums.filter(n => narrow(n) && depthBeside(n)).map(n => n.v);
        sec.width_m = (elevation ? sectionWidths : widths).length ? Math.min(...(elevation ? sectionWidths : widths)) : null;
        if (elevation && (!sec.width_m || !sec.depth_m)) {
          const band = (o: OcrWord) => cy(o) < y && cy(o) > y - Math.max(reach, 0.3) && cx(o) > x && cx(o) < x + 0.6;
          const sizes = new Set(nums.filter(n => narrow(n) && band(n.w) && depthBeside(n)).map(n => `${n.v}x${depthBeside(n)!.v}`));
          const [bw, bd] = sizes.size === 1 ? [...sizes][0].split('x').map(Number) : [];
          if (bw && (!sec.width_m || sec.width_m === bw)) {
            sec.width_m = bw; sec.depth_m ??= bd;
            sec.evidence = `${sec.evidence} (หน้าตัดข้างรูปด้านยาว ${bw}x${bd} ม.)`;
          }
        }
        sec.depth_m ??= elevation ? (vNums.find(n => n.v >= 0.2 && n.v <= 1.2)?.v ?? null) : depths[0] ?? null;
        if (writtenSize && !elevation) { sec.width_m ||= writtenSize[0]; sec.depth_m ||= writtenSize[1]; }
        const fits = (row: string[]) => {
          const [, n, db] = (row.length === 1 && row[0].match(/^(\d+)-[A-Z]+(\d+)$/)) || [];
          return !n || !sec.width_m || +n <= Math.floor((sec.width_m * 1000 - 72 - +db) / (+db + 20)) + 1;
        };
        const layer = (r: typeof rowsOf[number], top: boolean) => {
          if (!elevation) return r.texts;
          const line = rowsOf.filter(o => Math.abs(o.y - r.y) < 0.006).map(o => o.texts).filter(t => t.length === 1);
          const n = (t: string[]) => Number(t[0].split('-')[0]);
          return line.length > 1 ? line.sort((a, b) => (top ? n(a) - n(b) : n(b) - n(a)))[0] : r.texts;
        };
        if (barRows.length >= (elevation ? 2 : 1)) {
          const [top, bottom] = [layer(rowsOf[0], true), layer(rowsOf[rowsOf.length - 1], false)];
          if (fits(top)) sec.top_rebar = top.join('+');
          if (fits(bottom)) sec.bottom_rebar = bottom.join('+');
          if (rowsOf.length === 1 && sec.top_rebar && sec.bottom_rebar) {
            sec.inferred_fields ||= [];
            if (!sec.inferred_fields.includes('top_rebar')) sec.inferred_fields.push('top_rebar');
            sec.evidence = `${sec.evidence} (อ่านเหล็กได้แถวเดียว — เหล็กบนใช้ค่าเดียวกับเหล็กล่าง)`;
          }
        }
        if (stirrup) { sec.stirrup = stirrup; if (stirrupSets) sec.stirrup_sets = stirrupSets; }
        else if (spacingLegacy) sec.evidence = `${sec.evidence} (ปลอก @${spacingLegacy} — อ่านขนาดเหล็กไม่ได้)`;
        sec.confidence = sec.width_m && sec.depth_m ? (bars.length ? 0.88 : 0.8) : 0.5;
      } else if (type === 'COLUMN') {
        const all = [...hNums, ...vNums].filter(n => n.v >= 0.15 && n.v <= 0.8).map(n => n.v);
        sec.width_m = writtenSize?.[0] ?? all[0] ?? null;
        sec.depth_m = writtenSize?.[1] ?? all[1] ?? all[0] ?? null;
        if (barRows.length) sec.main_rebar = barRows[0].join('+');
        if (stirrup) { sec.stirrup = stirrup; if (stirrupSets) sec.stirrup_sets = stirrupSets; }
        else if (spacingLegacy) sec.evidence = `${sec.evidence} (ปลอก @${spacingLegacy} — อ่านขนาดเหล็กไม่ได้)`;
        if (!sec.width_m && !sec.main_rebar) {
          const below = (o: OcrWord) => Math.abs(cx(o) - x) < 0.07 && cy(o) > y + 0.01 && cy(o) < y + 0.5 && mine(o);
          const bNums = nums.filter(n => below(n.w) && n.v >= 0.15 && n.v <= 0.8).sort((a, b) => cy(b.w) - cy(a.w));
          const bNotes = phrases.filter(ph => ph.words.every(below)).sort((a, b) => cy(b.words[0]) - cy(a.words[0]));
          const main = bNotes.find(ph => ph.note.kind === 'count');
          const tie = bNotes.find(ph => ph.note.kind === 'spacing' && ph.note.dia <= 12);
          if (bNums.length || main) {
            sec.width_m = bNums[0]?.v ?? null;
            sec.depth_m = bNums.find(n => n !== bNums[0] && Math.abs(cy(n.w) - cy(bNums[0].w)) < 0.06)?.v ?? bNums[0]?.v ?? null;
            if (main) sec.main_rebar = formatBar(main.note, setGrades);
            if (tie) { sec.stirrup = formatBar(tie.note, setGrades); const sets = tieSets(tie.note); if (sets) sec.stirrup_sets = sets; }
            sec.evidence = `${sec.evidence} (ตารางเสา: ${[...bNums.slice(0, 2).map(n => n.w.text), ...[main, tie].filter(Boolean).map(ph => ph!.text)].join(' ')})`;
          }
        }
      } else if (type === 'SLAB') {
        const t = [...hNums, ...vNums].map(n => n.v).find(v => v >= 0.05 && v <= 0.25);
        sec.thickness_m = t ?? null;
        const layers = spaced.sort((a, b) => cy(a.words[0]) - cy(b.words[0])).map(ph => formatBar(ph.note, setGrades));
        if (layers.length >= 2) { sec.top_rebar = layers[0]; sec.bottom_rebar = layers[layers.length - 1]; }
        else if (layers.length === 1) { if (/^GS/.test(first)) sec.top_rebar = layers[0]; else sec.bottom_rebar = layers[0]; }
      } else if (type === 'FOOTING') {
        sec.variant = variantOf(p.words.filter(o => Math.abs(cy(o) - y) < 0.012 && cx(o) > w.x0 - 0.02 && cx(o) < x + 0.3)) ?? undefined;
        const m = first.match(FOOTING_SIZE);
        if (m) { sec.plan_w_m = Number(m[1]); sec.plan_l_m = Number(m[2]); }
        else {
          const side = (ns: typeof hNums) => Math.max(0, ...ns.filter(n => n.v >= 0.5 && n.v <= 5).map(n => n.v));
          const [pw, pl] = writtenSize ?? [side(hNums), side(vNums)];
          if (pw && pl) { sec.plan_w_m = Math.min(pw, pl); sec.plan_l_m = Math.max(pw, pl); }
        }
        const maxT = Math.min(0.45, m ? Math.min(Number(m[1]), Number(m[2])) / 2 + 0.05 : 0.45);
        const t = vNums.filter(n => n.v >= 0.15 && n.v <= maxT).sort((a, b) => cy(a.w) - cy(b.w))[0]?.v;
        sec.thickness_m = t ?? null;
        const g = (dia: number, gr: 'RB' | 'DB' | null) => resolveGrade(gr, dia, setGrades);
        const footBars = counts.map(c => c.note as { n: number; dia: number; grade: 'RB' | 'DB' | null });
        if (meshes.length) sec.bottom_rebar = formatBar(meshes[0].note, setGrades);
        else if (footBars.length >= 2 && footBars[0].dia === footBars[1].dia) sec.bottom_rebar = `${footBars[0].n}+${footBars[1].n}-${g(footBars[0].dia, footBars[0].grade)}${footBars[0].dia}`;
        else if (spaced.length) sec.bottom_rebar = formatBar([...spaced].sort((a, b) => (b.note as { dia: number }).dia - (a.note as { dia: number }).dia)[0].note, setGrades);
        else if (footBars.length && footBars[0].n >= 3) sec.bottom_rebar = `${footBars[0].n}-${g(footBars[0].dia, footBars[0].grade)}${footBars[0].dia}`;
        const spec = p.words.filter(o => PILE_SPEC.test(clean(o.text)) && cy(o) < y && cy(o) > y - reach && cx(o) > x - 0.11 && cx(o) < x + 0.3 && mine(o))
          .sort((a, b) => Math.hypot(cx(a) - x, cy(a) - y) - Math.hypot(cx(b) - x, cy(b) - y))[0];
        const [, pa, pb, plen] = spec ? clean(spec.text).match(PILE_SPEC)! : [];
        if (spec && Number(plen) >= 1.5) {
          const n = p.words.filter(o => !o.vertical && /^\d{1,2}$/.test(clean(o.text)) && Number(clean(o.text)) >= 1 && cy(spec) - cy(o) > 0.008 && cy(spec) - cy(o) < 0.03 && o.x0 > spec.x0 && o.x0 < spec.x1 + 0.03)
            .sort((a, b) => Math.abs(a.x0 - spec.x1) - Math.abs(b.x0 - spec.x1))[0];
          sec.pile_size = `${pa}x${pb}x${plen}`;
          if (n) sec.pile_count = Number(clean(n.text));
          sec.evidence = `${sec.evidence} (เสาเข็ม ${n ? `${clean(n.text)} ต้น ` : ''}${sec.pile_size} ม.)`;
        }
      } else if (type === 'STAIR') {
        sec.thickness_m = [...hNums, ...vNums].map(n => n.v).find(v => v >= 0.1 && v <= 0.2) ?? null;
      }
      const sDen = localDen(p, w, den);
      const rect = (type === 'BEAM' || type === 'COLUMN') && sDen && sDen <= 30 ? outlineAbove(p, w, 0.12) : undefined;
      if (rect && sDen) {
        const g = measured(rect, p, sDen);
        if (g.w >= 0.1 && g.w <= 0.8 && g.h >= (type === 'COLUMN' ? 0.15 : 0.1) && g.h <= 1.5) {
          const fields: string[] = [];
          const check = (key: 'width_m' | 'depth_m', v: number, name: string) => {
            const field = key === 'width_m' ? 'width' : 'depth';
            const cur = sec[key];
            if (cur == null || sec.inferred_fields?.includes(field)) { sec[key] = v; fields.push(field); }
            else if (Math.abs(cur - v) / v > 0.1) {
              if ([...hNums, ...vNums].some(n => Math.abs(n.v - v) < 0.006)) { sec[key] = v; fields.push(field); }
              else (sec.section_conflicts ||= []).push(`${name}ที่เขียน ${cur} ม. ไม่ตรงกับรูปหน้าตัดที่วาดตามมาตราส่วน 1:${sDen} ≈ ${v} ม.`);
            }
          };
          check('width_m', g.w, 'ความกว้าง');
          check('depth_m', g.h, type === 'COLUMN' ? 'ความยาวด้าน' : 'ความลึก');
          if (fields.length) {
            sec.measured_fields = fields;
            sec.inferred_fields = sec.inferred_fields?.filter(f => !fields.includes(f));
          }
          sec.evidence = `${sec.evidence} (วัดจากรูปหน้าตัด ${g.w}×${g.h} ม. @1:${sDen})`;
          if (sec.width_m && sec.depth_m && !sec.section_conflicts) sec.confidence = Math.max(sec.confidence ?? 0, bars.length ? 0.9 : 0.82);
        }
      }
      const prev = sections.find(s => s.tag === sec.tag && s.variant === sec.variant);
      const score = (s: SectionDef) => [s.width_m, s.depth_m, s.thickness_m, s.top_rebar, s.plan_w_m].filter(v => v != null).length;
      if (!prev) sections.push(sec);
      else if (score(sec) > score(prev)) sections[sections.indexOf(prev)] = sec;
    }
    const commonW = (() => {
      const ws = sections.filter(s => s.member_type === 'BEAM' && s.width_m).map(s => s.width_m!);
      if (!ws.length) return null;
      const c = new Map<number, number>();
      for (const v of ws) c.set(v, (c.get(v) || 0) + 1);
      return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
    })();
    for (const sct of sections) {
      if (sct.member_type === 'BEAM' && !sct.width_m && sct.depth_m && commonW) {
        sct.width_m = commonW;
        sct.inferred_fields = [...(sct.inferred_fields || []), 'width'];
        sct.evidence = `${sct.evidence} (กว้าง ${commonW} ตามหน้าตัดอื่นในแผ่นเดียวกัน)`;
      }
    }
    const beamSecs = sections.filter(s => s.member_type === 'BEAM' && s.box_2d);
    if (beamSecs.length >= 2) {
      const sorted = [...beamSecs].sort((a, b) => a.box_2d![1] - b.box_2d![1]);
      const dxs = sorted.slice(1).map((s, i) => s.box_2d![1] - sorted[i].box_2d![1]);
      const avgDx = dxs.reduce((a, b) => a + b, 0) / dxs.length;
      const b2 = sorted.find(s => s.tag === 'B2' || s.tag === 'GB2');
      if (b2) {
        const expectedPrefix = b2.tag.replace(/2.*$/, '1');
        if (vocab.has(expectedPrefix) && !sections.some(s => s.tag === expectedPrefix)) {
          const expectedX = (b2.box_2d![1] - avgDx) / 1000;
          const candNums = nums.filter(n => !n.w.vertical && Math.abs(cx(n.w) - expectedX) < (avgDx / 1000) * 0.45 && n.v >= 0.15 && n.v <= 0.6);
          const candDepths = nums.filter(n => Math.abs(cx(n.w) - expectedX) < (avgDx / 1000) * 0.45 && n.v >= 0.25 && n.v <= 1.2);
          if (candNums.length && candDepths.length) {
            const w_m = Math.min(...candNums.map(n => n.v));
            const d_m = Math.max(...candDepths.map(n => n.v));
            sections.unshift({
              tag: expectedPrefix,
              member_type: 'BEAM',
              width_m: w_m,
              depth_m: d_m,
              box_2d: [b2.box_2d![0], Math.round(expectedX * 1000), b2.box_2d![2], Math.round((expectedX + (b2.box_2d![3] - b2.box_2d![1]) / 1000) * 1000)], box_src: 'guess',
              evidence: `แถวรูปตัดคาน: ตำแหน่งถัดจาก ${b2.tag} ตรงกับ ${expectedPrefix} (${w_m}×${d_m} ม.)`,
              confidence: 0.85,
            });
          }
        }
      }
    }
    for (const sct of sections) if (sct.member_type === 'FOOTING' && sct.thickness_m) sct.confidence = 0.85;
    if (sections.length) readings.push({ page: p.page, sheet_type: 'section_detail', instances: [], sections });
  }

  const sizes = new Set(planColumnSizes.map(c => `${Math.min(c.w, c.h)}x${Math.max(c.w, c.h)}`));
  if (planColumnSizes.length >= 4 && sizes.size === 1) {
    const { w, h, page } = planColumnSizes[0];
    for (const sct of readings.flatMap(r => r.sections).filter(x => x.member_type === 'COLUMN')) {
      if (!sct.width_m || !sct.depth_m) {
        sct.width_m = w; sct.depth_m = h;
        sct.measured_fields = [...new Set([...(sct.measured_fields || []), 'width', 'depth'])];
        sct.evidence = `${sct.evidence} (ขนาดเสาวัดจากผัง p${page}: ${w}×${h} ม.)`;
      } else if (Math.abs(sct.width_m - Math.min(w, h)) > 0.02 || Math.abs(sct.depth_m - Math.max(w, h)) > 0.02) {
        (sct.section_conflicts ||= []).push(`หน้าตัดเสาที่อ่านได้ ${sct.width_m}×${sct.depth_m} ม. ไม่ตรงกับเสาที่วาดในผัง (p${page}) ${w}×${h} ม.`);
      }
    }
  }
  for (const p of pages) {
    if (isDrawingIndexSheet(p)) continue;
    const excl = getDrawingIndexTableExclusion(p);
    for (const w of p.words) {
      if (excl && cx(w) >= excl[0] && cx(w) <= excl[2] && cy(w) >= excl[1] && cy(w) <= excl[3]) continue;
      const m = clean(w.text).match(LABEL_SIZE);
      if (!m) continue;
      const [, tag, , a1, a2, a3] = m;
      const mm = (v?: string) => (v ? Number(v) / 1000 : undefined);
      const type = /^F/.test(tag) ? 'FOOTING' : /^C/.test(tag) ? 'COLUMN' : /^(S|GS|SP)/.test(tag) ? 'SLAB' : 'BEAM';
      if (readings.flatMap(r => r.sections).some(x => x.tag === tag)) continue;
      const def: SectionDef = type === 'FOOTING'
        ? { tag, member_type: type, plan_w_m: mm(a1), plan_l_m: mm(a2), thickness_m: mm(a3) ?? null, box_2d: box(w), evidence: w.text, confidence: 0.85 }
        : { tag, member_type: type, width_m: mm(a1), depth_m: mm(a2), box_2d: box(w), evidence: w.text, confidence: 0.85 };
      let r = readings.find(x => x.page === p.page && x.sheet_type === 'section_detail');
      if (!r) { r = { page: p.page, sheet_type: 'section_detail', instances: [], sections: [] }; readings.push(r); }
      r.sections.push(def);
    }
  }

  for (const p of pages) {
    if (isDrawingIndexSheet(p)) continue;
    const labels = p.words.map(w => ({ w, tag: clean(w.text).match(LABEL_SIZE)?.[1] ?? '' })).filter(x => /^[FC]/.test(x.tag));
    if (labels.length < 2) continue;
    const titles = p.words.filter(w => /^1:\d{2,3}$/.test(w.text)).map(cy);
    const bandOf = (y: number) => `${Math.max(0, ...titles.filter(t => t < y))}/${Math.min(1, ...titles.filter(t => t > y))}`;
    const phrases = barPhrases(p.words);
    for (const band of new Set(labels.map(l => bandOf(cy(l.w))))) {
      const [top, bottom] = band.split('/').map(Number);
      const tagsIn = (re: RegExp) => [...new Set(labels.filter(l => bandOf(cy(l.w)) === band && re.test(l.tag)).map(l => l.tag))];
      const [fTags, cTags] = [tagsIn(/^F/), tagsIn(/^C/)];
      if (fTags.length !== 1 || cTags.length !== 1) continue;
      const notes = phrases.filter(ph => ph.words.every(o => cy(o) > top && cy(o) < bottom));
      const counts = new Map<string, { n: number; dia: number; ys: number[] }>();
      for (const ph of notes) if (ph.note.kind === 'count') {
        const k = formatBar(ph.note, setGrades);
        if (!counts.has(k)) counts.set(k, { n: ph.note.n, dia: ph.note.dia, ys: [] });
        counts.get(k)!.ys.push(cy(ph.words[0]));
      }
      const byHeight = [...counts].map(([text, e]) => ({ text, ...e, y: e.ys.reduce((a, v) => a + v, 0) / e.ys.length })).sort((a, b) => b.y - a.y);
      const low = byHeight[0], pair = low && byHeight.slice(1).find(e => e.dia === low.dia && e.n !== low.n);
      const sec = (tag: string, type: string) => readings.flatMap(r => r.sections).find(x => x.tag === tag && x.member_type === type);
      const fSec = sec(fTags[0], 'FOOTING'), cSec = sec(cTags[0], 'COLUMN');
      if (pair && fSec && !fSec.bottom_rebar) {
        const [a, b] = low.y < pair.y ? [low, pair] : [pair, low];
        fSec.bottom_rebar = `${a.n}+${b.text}`;
        fSec.evidence = `${fSec.evidence} (เหล็กตะแกรงจากรูปแบบขยาย)`;
      }
      if (!cSec) continue;
      const main = pair && byHeight.filter(e => e !== low && e !== pair && e.y < Math.min(low.y, pair.y) && e.n >= 4 && e.n % 2 === 0).sort((m, n) => n.ys.length - m.ys.length || n.y - m.y)[0];
      if (main && !cSec.main_rebar) { cSec.main_rebar = main.text; cSec.evidence = `${cSec.evidence} (เหล็กยืนจากรูปแบบขยาย)`; }
      const ties = notes.filter(ph => ph.note.kind === 'spacing' && ph.note.dia <= 12).map(ph => ph.note);
      if (new Set(ties.map(t => formatBar(t, setGrades))).size === 1 && !cSec.stirrup) {
        cSec.stirrup = formatBar(ties[0], setGrades);
        cSec.stirrup_sets = tieSets(ties[0]) ?? cSec.stirrup_sets;
        cSec.evidence = `${cSec.evidence} (ปลอกจากรูปแบบขยาย${cSec.stirrup_sets ? ` — ${cSec.stirrup_sets} ชุดต่อระยะ` : ''})`;
      }
    }
  }

  for (const [tag, d] of footingDrawn) {
    const sec = readings.flatMap(r => r.sections).find(x => x.tag === tag && x.member_type === 'FOOTING');
    if (!sec || (sec.plan_w_m && sec.plan_l_m)) continue;
    sec.plan_w_m = d.w; sec.plan_l_m = d.l;
    sec.measured_fields = [...new Set([...(sec.measured_fields || []), 'width', 'depth'])];
    sec.evidence = `${sec.evidence || tag} (ขนาด ${d.w}×${d.l} ม. วัดจากรูปฐานราก ${d.n} ตัวในผัง น.${d.page})`;
  }

  const sized = (g: { w: number; h: number; tol?: number }, w: number, l: number, e = g.tol ?? 0.03) =>
    (Math.abs(w - g.w) < e && Math.abs(l - g.h) < e) || (Math.abs(w - g.h) < e && Math.abs(l - g.w) < e);
  const explicitTypes = [
    ...readings.flatMap(r => r.sections).filter(x => x.member_type === 'FOOTING' && x.plan_w_m && x.plan_l_m && !x.measured_fields?.includes('width'))
      .map(x => ({ tag: x.tag, w: x.plan_w_m!, l: x.plan_l_m! })),
    ...[...vocab].map(t => ({ t, m: t.match(FOOTING_SIZE) })).filter(x => x.m).map(x => ({ tag: x.t, w: Number(x.m![1]), l: Number(x.m![2]) })),
  ];
  for (const po of pendingOutlines) {
    const named = explicitTypes.filter(s => sized(po.outline.g, s.w, s.l));
    const kinds = new Set((named.length ? named : po.learned.filter(s => sized(po.outline.g, s.w, s.l))).map(h => h.tag));
    if (!kinds.size) continue;
    po.instances.push({
      tag: kinds.size === 1 ? [...kinds][0] : 'F?', member_type: 'FOOTING', from_grid: po.at, plan_title: po.title, level: po.level,
      confidence: kinds.size === 1 ? 0.7 : 0.3,
      box_2d: [po.outline.r[1], po.outline.r[0], po.outline.r[3], po.outline.r[2]].map(v => Math.round(v * 1000)), box_src: 'shape',
    });
  }

  const sizeTags = new Set([...vocab, ...readings.flatMap(r => [...r.sections.map(x => x.tag), ...r.instances.flatMap(i => i.tag.split(','))])].filter(t => FOOTING_SIZE.test(t)));
  const footingTypes = [...sizeTags].map(t => ({ t, m: t.match(FOOTING_SIZE) })).filter(x => x.m).map(x => ({ tag: x.t, w: Number(x.m![1]), l: Number(x.m![2]) }));
  if (footingTypes.length) {
    const found: { page: number; wM: number; tM: number; box: number[]; preferred: Set<string> }[] = [];
    for (const p of pages) {
      const den = dens.get(p.page)?.den;
      if (!den || den > 30 || !p.hsegs?.length) continue;
      const kx = unitsPerMetre(den, p.width), ky = unitsPerMetre(den, p.height);
      for (const sec of footingSections(p.hsegs, kx, ky)) {
        const near = p.words.map(w => clean(w.text).replace(/^F\(?|[),]+$/g, '')).filter(t => /\d\.\d{2}X\d/.test(t) || /^\.\d{2}X/.test(t));
        found.push({ page: p.page, ...sec, preferred: new Set(near) });
      }
    }
    for (const ft of footingTypes) {
      const size = `${ft.w.toFixed(2)}X${ft.l.toFixed(2)}`;
      const byW = found.filter(f => Math.abs(f.wM - ft.w) < 0.03);
      const cands = byW.length ? byW : found.filter(f => Math.abs(f.wM - ft.l) < 0.03);
      if (!cands.length) continue;
      const named = cands.filter(c => [...c.preferred].some(t => size.endsWith(t) || t.startsWith(size)));
      const pool = named.length ? named : cands;
      const ts = [...new Set(pool.map(c => c.tM))];
      if (ts.length !== 1) continue;
      const c = pool[0];
      let r = readings.find(x => x.page === c.page && x.sheet_type === 'section_detail');
      if (!r) { r = { page: c.page, sheet_type: 'section_detail', instances: [], sections: [] }; readings.push(r); }
      let sec = readings.flatMap(x => x.sections).find(x => x.tag === ft.tag && x.member_type === 'FOOTING');
      if (!sec) { sec = { tag: ft.tag, member_type: 'FOOTING', plan_w_m: ft.w, plan_l_m: ft.l, box_2d: c.box, box_src: 'shape', evidence: ft.tag, confidence: 0.85 }; r.sections.push(sec); }
      if (sec.thickness_m == null) {
        sec.thickness_m = ts[0];
        sec.measured_fields = [...new Set([...(sec.measured_fields || []), 'thickness'])];
        sec.box_2d = c.box;
        sec.box_src = 'shape';
        sec.evidence = `${sec.evidence} (วัดความหนาจากรูปตัดฐานราก น.${c.page}: กว้าง ${c.wM} หนา ${ts[0]} ม.)`;
        sec.confidence = Math.max(sec.confidence ?? 0, 0.85);
      } else if (Math.abs(sec.thickness_m - ts[0]) > 0.02) {
        (sec.section_conflicts ||= []).push(`ความหนาที่อ่านได้ ${sec.thickness_m} ม. ไม่ตรงกับรูปตัดที่วาด (น.${c.page}) ${ts[0]} ม.`);
      }
      if (!sec.rebar_notes) {
        const notes = [...new Set(pool.flatMap(f => footingBarNotes(pages.find(q => q.page === f.page)!, f.box, found.filter(o => o.page === f.page && o !== f).map(o => o.box), setGrades)))];
        if (notes.length) sec.rebar_notes = notes;
      }
      if (!sec.bottom_rebar) {
        const meshes = new Set(pool.map(f => footingMeshAt(pages.find(q => q.page === f.page)!, f.box, found.filter(o => o.page === f.page && o !== f).map(o => o.box), setGrades)).filter(Boolean) as string[]);
        if (meshes.size === 1) {
          sec.bottom_rebar = [...meshes][0];
          sec.evidence = `${sec.evidence} (เหล็กตะแกรงจากหมายเหตุที่รูปตัดฐานราก กว้าง ${c.wM} ม.)`;
        }
      }
    }
  }

  // Resolve unidentified columns (C?) from grid correspondence or project-wide column tags
  const explicitColTags = [
    ...new Set(
      readings
        .flatMap(r => r.instances)
        .filter(i => i.member_type === 'COLUMN' && i.tag !== 'C?' && !i.tag.endsWith('?'))
        .map(i => i.tag)
    )
  ];
  const vocabColTags = [...vocab].filter(t => /^C[1-9][A-Z]?$/i.test(t));
  const secColTags = readings.flatMap(r => r.sections).filter(s => s.member_type === 'COLUMN' && s.tag !== 'C?' && !s.tag.endsWith('?')).map(s => s.tag);
  const allColTags = [...new Set([...explicitColTags, ...vocabColTags, ...secColTags])];

  const colTagByGrid = new Map<string, string>();
  for (const inst of readings.flatMap(r => r.instances)) {
    if (inst.member_type === 'COLUMN' && inst.from_grid && inst.tag !== 'C?' && !inst.tag.endsWith('?')) {
      colTagByGrid.set(inst.from_grid, inst.tag);
    }
  }

  for (const inst of readings.flatMap(r => r.instances)) {
    if (inst.member_type === 'COLUMN' && (inst.tag === 'C?' || inst.tag === 'C')) {
      if (inst.from_grid && colTagByGrid.has(inst.from_grid)) {
        inst.tag = colTagByGrid.get(inst.from_grid)!;
        inst.confidence = Math.max(inst.confidence ?? 0.7, 0.85);
      } else if (allColTags.length === 1) {
        inst.tag = allColTags[0];
        inst.confidence = Math.max(inst.confidence ?? 0.7, 0.85);
      }
    }
  }

  if (levelMarks.length) notes.push(`ระดับชั้นจากรูปตัด: ${levelMarks.map(l => `${l.label} +${l.elevation_m.toFixed(2)}`).join(', ')}`);
  return { readings, notes, vocab: [...vocab].sort() };
}
