/**
 * Reinforcement notation as Thai structural drawings write it, read from OCR text.
 *
 *   count    "2-DB16", "3RB12", "4ø12มม.", "2-Ø16 mm."           -> { n, grade, dia }
 *   mesh     "5+5ø12มม.", "7+8-DB12", "6+11-DB12"                 -> { a, b, grade, dia }
 *   spacing  "RB6@0.20", "ป-RB6 mm.@ 0.20 m.", "Ø12mm.@0.15m.", "DB12@0.20", "ø9@20ซม."
 *                                                                  -> { grade, dia, s }
 *            "2-RB6@0.10" (ties set in pairs)                      -> { grade, dia, s, legs: 2 }
 *
 * The diameter sign (ø Ø ∅ φ) is often misread by OCR as 0 O o 9 2 6 @ % ¢: those are accepted only
 * between a bar count and a standard bar size, where nothing else can stand. A sign with no grade
 * leaves the grade open (null) — the caller decides from how the drawing set writes that size.
 * A size 0, 2 or 5 after a grade (no such bar) is a 10/12/15 whose thin "1" OCR dropped ("2-RB2").
 * A Latin-only reader writes the unit "มม." as look-alikes ("aa.", "HH.", "HN.") after the size.
 */
export type Grade = 'RB' | 'DB' | null;
export type BarNote =
  | { kind: 'count'; n: number; grade: Grade; dia: number }
  | { kind: 'mesh'; a: number; b: number; grade: Grade; dia: number }
  | { kind: 'spacing'; grade: Grade; dia: number; s: number; legs?: number };

const SIZES = new Set([6, 9, 10, 12, 15, 16, 19, 20, 25, 28, 32]);
const SIGN = '[ØøΦφ∅]';
const SIGN_OCR = '[ØøΦφ∅0Oo92@%¢68]';
const GRADE = '(RB|DB|SR|SD|R|D)';

function grade(g?: string): Grade {
  if (!g) return null;
  return /^(RB|SR|R)$/i.test(g) ? 'RB' : 'DB';
}

const THAI_TO_ARABIC: Record<string, string> = {
  '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4',
  '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9',
};

/** Normalize OCR noise and Thai construction drawing notations around bar text. */
function norm(t: string) {
  return t.toUpperCase()
    .replace(/[๐-๙]/g, ch => THAI_TO_ARABIC[ch] || ch)
    .replace(/[“”"'’‘`]/g, '')
    .replace(/[—–~_]/g, '-')
    .replace(/\s+/g, '')
    // Thai beam rebar positions & modifiers: (บน), (ล่าง), (พิเศษ), (ริม), (กลาง), (คอม้า), (รัดรอบ)
    .replace(/\(?(เสริมพิเศษ|พิเศษ|บนสุด|บน|ล่าง|คอม้า|รัดรอบ|เหล็กข้าง|ริม|กลาง|TOP|BOT|BOTTOM|EXTRA)\)?/gi, '')
    // Thai two-way mesh indicators: (ตะแกรง 2 ทาง), (สองทาง), #
    .replace(/\(?(ตะแกรง\s*(?:2|สอง)?\s*ทาง?|2\s*ทาง|สอง\s*ทาง|สอง\s*ทิศทาง|TWOWAY|2-WAY)\)?/gi, '')
    .replace(/#+$/g, '')
    // Thai standards มอก. 20 / 24 steel grades: SD30, SD40, SD50, SR24
    .replace(/SD(30|40|50)[-_]*(DB)?/gi, 'DB')
    .replace(/SR(24)[-_]*(RB)?/gi, 'RB')
    // Thai unit words
    .replace(/(มม|ม\.ม|MM)\.?/gi, '')
    .replace(/(ซม|CM)\.?/gi, '§')
    .replace(/(ม\.|M\.|M\b)/gi, '')
    .replace(/§/g, 'CM')
    .replace(/(?<=\d)(AA?[1-9L]?|HH|HN|3A|A2|A8|2%)\.?(?=@|$)/, '')
    // Thai stirrup prefixes: ป., ปล., ปลอก, 2-ปล., etc.
    .replace(/^([1-4])-?(?:ปลอก|ปล|ป)\.?-?/i, '$1-')
    .replace(/^(ปลอก|ปล|ป)\.?-?/i, '')
    .replace(/^(STIRRUPS?|STRR?|TIES?)\.?-?/i, '')
    .replace(/^(U|V|IJ|1J|J|LJ)(?=[ØøΦφ∅0OoZRD]?\d{1,2}@)/, '')
    .replace(/\.+(?=@)/g, '')
    .replace(/[,;:]+$/, '')
    .replace(/(?<=\d)(WU|UU|JU|VU|WL|UL|JL|LJ|NL|WN|1J|UJ)\.?$/, '');
}

const sizeOk = (d: number) => SIZES.has(d);

/** spacings are written 0.10, 0.125, 0.15, 0.175, 0.20…: a "0.12"/"0.17" is a 0.125/0.175 cut short by OCR */
function untruncate(raw: string, s: number) {
  if (/^0?\.(12|17)$/.test(raw)) return Number((s + 0.005).toFixed(3));
  return Number(s.toFixed(3));
}

function parseStrict(text: string): BarNote | null {
  const t = norm(text).replace(/\.+$/, '');
  if (!t || t.length > 24) return null;
  let m: RegExpMatchArray | null;

  const legs = t.match(new RegExp(`^([1-4])-?(?=${GRADE}|${SIGN})`));
  m = (legs ? t.slice(legs[0].length) : t).match(new RegExp(`^(?:${GRADE}|${SIGN})?-?(\\d{1,2})@(\\d*\\.?\\d+)(CM)?$`));
  if (!legs) m ??= t.match(/^()[0OoZ2]?(6|9)@(\d*\.?\d+)(CM)?$/);
  if (m) {
    const dia = Number(m[2]);
    let s = Number(m[3]);
    if (m[4] || s >= 5) s /= 100;
    if (sizeOk(dia) && s >= 0.05 && s <= 0.4) return { kind: 'spacing', grade: grade(m[1] || undefined), dia, s: untruncate(m[3], s), ...(legs ? { legs: Number(legs[1]) } : {}) };
  }
  m = t.match(new RegExp(`^(\\d{1,2})\\+(\\d{1,2})-?(?:${GRADE}|(${SIGN_OCR}))?(\\d{1,2})$`));
  if (m && !sizeOk(Number(m[5]))) m = t.match(new RegExp(`^(\\d{1,2})\\+(\\d)-?(?:${GRADE}|(${SIGN_OCR}))?(\\d{2})$`));
  else if (m && !m[3] && !m[4] && m[2].length === 2 && /[06892]$/.test(m[2])) {
    // b's second digit is a diameter sign look-alike (0/6/8/9/2) misread as part of b
    const m2 = t.match(new RegExp(`^(\\d{1,2})\\+(\\d)-?(?:${GRADE}|(${SIGN_OCR}))?(\\d{2})$`));
    if (m2 && sizeOk(Number(m2[5]))) m = m2;
  }
  if (m) {
    const dia = Number(m[5]);
    if (sizeOk(dia) && Number(m[1]) >= 2 && Number(m[2]) >= 2) return { kind: 'mesh', a: Number(m[1]), b: Number(m[2]), grade: grade(m[3]), dia };
  }
  m = t.match(new RegExp(`^(\\d{1,2})-?${GRADE}(\\d{1,2})$`));
  if (m && sizeOk(Number(m[3])) && Number(m[1]) >= 1) return { kind: 'count', n: Number(m[1]), grade: grade(m[2]), dia: Number(m[3]) };
  if (m && Number(m[1]) >= 1 && /^[025]$/.test(m[3])) return { kind: 'count', n: Number(m[1]), grade: grade(m[2]), dia: Number(`1${m[3]}`) };
  m = t.match(new RegExp(`^(\\d{1,2})-?${SIGN}(\\d{1,2})$`));
  if (m && sizeOk(Number(m[2])) && Number(m[1]) >= 1) return { kind: 'count', n: Number(m[1]), grade: null, dia: Number(m[2]) };
  m = t.match(new RegExp(`^(\\d)-?${SIGN_OCR}(1[0256]|19|20|25|28|32)$`));
  if (m && Number(m[1]) >= 2) return { kind: 'count', n: Number(m[1]), grade: null, dia: Number(m[2]) };
  m = t.match(/^(\D{0,4}?)(\d{1,3})[@©€®](\d*\.?\d+)(CM)?$/);
  if (m && (m[1] || m[2].length > 1)) {
    const d2 = Number(m[2].slice(-2)), d1 = Number(m[2].slice(-1));
    const dia = m[2].length >= 2 && sizeOk(d2) && d2 >= 10 ? d2 : sizeOk(d1) ? d1 : 0;
    let s = Number(m[3]);
    if (m[4] || s >= 5) s /= 100;
    if (dia && s >= 0.05 && s <= 0.4) return { kind: 'spacing', grade: null, dia, s: untruncate(m[3], s) };
  }
  m = t.match(/^(\d)([^\d\s]{1,2})(1[0256]|19|20|25|28|32)$/);
  if (m && Number(m[1]) >= 2 && !/^[XB]$/.test(m[2])) return { kind: 'count', n: Number(m[1]), grade: null, dia: Number(m[3]) };
  return null;
}

function parseWithTail(text: string): BarNote | null {
  const t = norm(text);
  if (!t || t.length > 24) return null;
  for (let k = t.length - 1; k >= 3; k--) {
    const head = t.slice(0, k), tail = t.slice(k);
    if (tail.length > 5) break;
    if (!(/[A-Z]|\.$/.test(tail)) || tail.includes('@') || !/\d$/.test(head)) continue;
    const r = parseStrict(head);
    if (!r || !sizeOk(r.dia)) continue;
    if (r.kind === 'count' && r.n >= 1 && r.n <= 12) return r;
    if (r.kind === 'mesh' && r.a >= 1 && r.a <= 12 && r.b >= 1 && r.b <= 12) return r;
  }
  return null;
}

/** Read one piece of text as bar notation, or null. */
export function parseBarNote(text: string): BarNote | null {
  const note = parseStrict(text) ?? parseWithTail(text);
  if (note) return note;
  const trimmed = text.trim();
  // Strip trailing % / %. unit look-alike that would otherwise swallow bar size digits in norm
  if (trimmed.endsWith('%.') || trimmed.endsWith('%')) {
    const stripped = trimmed.endsWith('%.') ? trimmed.slice(0, -2) : trimmed.slice(0, -1);
    return parseStrict(stripped) ?? parseWithTail(stripped);
  }
  return null;
}

export interface WordBox { text: string; x0: number; y0: number; x1: number; y1: number; vertical?: boolean }

/**
 * Bar text that OCR split into neighbouring words ("5+5" "ø12มม." / "RB6" "@0.20"): join words on one
 * line whose gap is under a letter height, and keep the joins that read as bar notation.
 */
/** a ø put back between words must give a believable bar group: at least two bars (not "1 : 20") */
const restored = (n: BarNote | null) => (n && (n.kind !== 'count' || n.n >= 2) && n.kind !== 'spacing' ? n : null);

export function barPhrases<W extends WordBox>(words: W[]): { note: BarNote; words: W[]; text: string }[] {
  const out: { note: BarNote; words: W[]; text: string }[] = [];
  const used = new Set<W>();
  const rows = [...words].filter(w => !w.vertical).sort((a, b) => a.x0 - b.x0);
  for (const w of rows) {
    if (used.has(w)) continue;
    const single = parseBarNote(w.text);
    const chain = [w];
    let best: { note: BarNote; n: number } | null = single ? { note: single, n: 1 } : null;
    for (let k = 0; k < 4; k++) {
      const last = chain[chain.length - 1], h = last.y1 - last.y0;
      const next = rows.find(o => !chain.includes(o) && !used.has(o) && (o.x0 >= last.x1 - 0.2 * h || (o.x0 > last.x0 && o.x1 > last.x1 + 0.5 * h)) && o.x0 - last.x1 < 2 * h
        && Math.abs((o.y0 + o.y1) / 2 - (last.y0 + last.y1) / 2) < 0.4 * h);
      if (!next || (!best && parseBarNote(next.text))) break;
      const wide = next.x0 - last.x1 > 1.25 * h;
      chain.push(next);
      const texts = chain.map(c => c.text);
      const note = parseBarNote(texts.join('')) || (/\d$/.test(last.text) && /^\d/.test(next.text) && restored(parseBarNote(texts.slice(0, -1).join('') + 'ø' + next.text))) || null;
      if (note) best = { note, n: chain.length };
      else if (wide) break;
    }
    if (!best) continue;
    const ws = chain.slice(0, best.n);
    ws.forEach(x => used.add(x));
    out.push({ note: best.note, words: ws, text: ws.map(x => x.text).join(' ') });
  }
  return out;
}

/** The grade a drawing set uses for each bar size where it writes one ("2-RB12" -> 12: RB); key 0: a set
 * writing unmarked ø15/ø19 (sizes made only as round bar) means round bar by an unmarked ø. */
export function gradeBySize(texts: string[]): Map<number, 'RB' | 'DB'> {
  const tally = new Map<number, { RB: number; DB: number }>();
  let roundOnly = 0, unmarked = 0;
  for (const t of texts) {
    const n = parseBarNote(t);
    if (n && !n.grade && n.dia >= 12) { unmarked++; if (n.dia === 15 || n.dia === 19) roundOnly++; }
    if (!n || !n.grade) continue;
    const e = tally.get(n.dia) || { RB: 0, DB: 0 };
    e[n.grade]++;
    tally.set(n.dia, e);
  }
  const out = new Map<number, 'RB' | 'DB'>();
  for (const [d, e] of tally) out.set(d, e.RB > e.DB ? 'RB' : 'DB');
  if (roundOnly >= 3 && roundOnly >= unmarked / 4) out.set(0, 'RB');
  return out;
}

/** Grade for a bar: as written, else as the set writes that size, else the usual rule (RB below 12 mm). */
export function resolveGrade(g: Grade, dia: number, set?: Map<number, 'RB' | 'DB'>): 'RB' | 'DB' {
  return g ?? set?.get(dia) ?? set?.get(0) ?? (dia < 12 ? 'RB' : 'DB');
}

export function formatBar(n: BarNote, set?: Map<number, 'RB' | 'DB'>): string {
  const g = resolveGrade(n.grade, n.dia, set);
  if (n.kind === 'count') return `${n.n}-${g}${n.dia}`;
  if (n.kind === 'mesh') return `${n.a}+${n.b}-${g}${n.dia}`;
  return `${g}${n.dia}@${n.s.toFixed(Math.abs(n.s * 100 - Math.round(n.s * 100)) > 1e-6 ? 3 : 2)}`;
}
