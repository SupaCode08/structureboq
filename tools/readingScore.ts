/**
 * Reading accuracy against a hand-read answer key, per field: right, WRONG (a value that looks trustworthy but
 * is not — the worst case) or missing. Pure: scripts/eval_reading.ts feeds it real sets (FULL_BOQ), tests feed it
 * synthetic ones. Every field is also counted under its category (grid, tag, count, dimension, rebar) and the
 * member type it belongs to, so a reader change shows where it helped or hurt.
 */
import type { ExtractedMember } from '../src/engine/qsEngine.ts';
import type { SheetReading } from '../src/engine/sheetMerge.ts';

export type Key = { tag: string; type: string; remark?: string; count?: number; width?: number; depth?: number; thickness?: number; topRebar?: string; bottomRebar?: string; mainRebar?: string; stirrup?: string };
export interface AnswerKey { split?: string; grid: { x: number[]; y: number[] }; members: Key[] }
export type Category = 'grid' | 'tag' | 'count' | 'dimension' | 'rebar';
export interface Tally { right: number; wrong: number; missing: number }
export interface Score extends Tally {
  notes: string[];
  total: number;
  tagsFound: number;
  tags: number;
  byCategory: Record<Category, Tally>;
  byType: Record<string, Tally>;
}

const normTag = (t: string) => t.toUpperCase().replace(/[()\s]/g, '');
/** bars as a set: "3-RB12+2-DB16" == "2-DB16+3-RB12"; "Ø12@0.15" == "RB12@0.15" */
export const normBars = (s?: string) => {
  if (!s) return '';
  const t = s.toUpperCase().replace(/\s/g, '').replace(/[ØΦ]/g, 'RB').replace(/MM\.?/g, '');
  if (t.includes('@')) return t.replace(/@0?\./, '@0.').replace(/(\.\d)0$/, '$1');
  const parts = t.split('+').map(p => p.replace(/^(\d+)-?/, '$1-'));
  const mesh = t.match(/^(\d+)\+(\d+)-?((?:DB|RB)\d+)$/);
  if (mesh) return `${mesh[1]}+${mesh[2]}-${mesh[3]}`;
  return parts.sort().join('+');
};
const near = (a?: number, b?: number) => a !== undefined && b !== undefined && Math.abs(a - b) <= 0.011;
const CATEGORY: Record<string, Category> = { x: 'grid', y: 'grid', 'จำนวน': 'count', 'กว้าง': 'dimension', 'ลึก/ยาว': 'dimension', 'หนา': 'dimension', 'เหล็กยืน': 'rebar', 'เหล็กบน': 'rebar', 'เหล็กล่าง': 'rebar', 'ปลอก': 'rebar' };

export function scoreReading(key: AnswerKey, readings: SheetReading[], members: ExtractedMember[]): Score {
  const byTag = new Map<string, ExtractedMember[]>();
  for (const m of members) for (const t of m.tag.split(',')) {
    const k = normTag(t) + ':' + m.memberType;
    byTag.set(k, [...(byTag.get(k) || []), m]);
  }
  const zero = (): Tally => ({ right: 0, wrong: 0, missing: 0 });
  const s: Score = { ...zero(), notes: [], total: 0, tagsFound: 0, tags: key.members.length, byCategory: { grid: zero(), tag: zero(), count: zero(), dimension: zero(), rebar: zero() }, byType: {} };
  const tally = (cat: Category, type: string, r: keyof Tally) => { s[r]++; s.byCategory[cat][r]++; (s.byType[type] ??= zero())[r]++; };
  const field = (type: string, tag: string, name: string, want: unknown, got: unknown, eq: (a: any, b: any) => boolean) => {
    if (want === undefined) return;
    const cat = CATEGORY[name];
    if (got === undefined || got === null || got === '' || got === 0) { tally(cat, type, 'missing'); s.notes.push(`${tag} ${name}: ไม่พบ (แบบ ${want})`); return; }
    if (eq(want, got)) tally(cat, type, 'right');
    else { tally(cat, type, 'wrong'); s.notes.push(`${tag} ${name}: ผิด — ระบบ ${got} แบบ ${want}`); }
  };

  const plans = readings.filter(r => r.grid?.x?.length || r.grid?.y?.length);
  const gridOk = (axis: 'x' | 'y') => plans.some(r => {
    const g = (r.grid![axis] || []).map(a => a.offset_m);
    if (!key.grid[axis].length) return g.length <= 1;
    return g.length === key.grid[axis].length && g.every((v, i) => Math.abs(v - key.grid[axis][i]) < 0.06);
  });
  const axisText = (v: number[]) => v.join('/') || '(เส้นเดียว)';
  for (const ax of ['x', 'y'] as const) field('GRID', 'grid', ax, axisText(key.grid[ax]), gridOk(ax) ? axisText(key.grid[ax]) : (plans[0]?.grid?.[ax]?.map(a => a.offset_m).join('/') || ''), (a, b) => a === b);

  const keyFootings = key.members.filter(k => k.type === 'FOOTING');
  if (keyFootings.length && keyFootings.every(k => k.count !== undefined)) {
    const n = members.filter(m => m.memberType === 'FOOTING').length;
    field('FOOTING', 'ฐานรากทั้งหมด', 'จำนวน', keyFootings.reduce((a, k) => a + k.count!, 0), n, (a, b) => a === b);
  }

  for (const k of key.members) {
    const ms = byTag.get(normTag(k.tag) + ':' + k.type) || [];
    if (!ms.length) { tally('tag', k.type, 'missing'); s.notes.push(`${k.tag}: ไม่พบเบอร์นี้เลย`); continue; }
    s.tagsFound++;
    tally('tag', k.type, 'right');
    if (k.count !== undefined) field(k.type, k.tag, 'จำนวน', k.count, ms.length, (a, b) => a === b);
    const assumed = (f: string) => ms[0].provenance?.fieldSources?.[f] === 'assumed';
    const m = { ...ms[0], width: assumed('width') ? undefined : ms[0].width, depth: assumed('depth') ? undefined : ms[0].depth };
    const isFS = k.type === 'FOOTING' || k.type === 'SLAB';
    if (k.type !== 'SLAB') {
      field(k.type, k.tag, 'กว้าง', k.width, m.width, near);
      field(k.type, k.tag, 'ลึก/ยาว', k.depth, m.depth, near);
    }
    if (isFS) field(k.type, k.tag, 'หนา', k.thickness, m.length, near);
    const bars = (a: string, b: string) => normBars(a) === normBars(b);
    if (k.type === 'COLUMN') field(k.type, k.tag, 'เหล็กยืน', k.mainRebar, m.topRebar, bars);
    else {
      field(k.type, k.tag, 'เหล็กบน', k.topRebar, m.topRebar, bars);
      field(k.type, k.tag, 'เหล็กล่าง', k.bottomRebar, m.bottomRebar, bars);
    }
    field(k.type, k.tag, 'ปลอก', k.stirrup, m.stirrupRebar, bars);
  }
  s.total = s.right + s.wrong + s.missing;
  return s;
}

const pct = (n: number, t: number) => (t ? `${Math.round((n / t) * 100)}%` : '—');
/** "ถูก a% · ผิด b% · ไม่พบ c% (n)" for one tally */
export const tallyText = (t: Tally) => { const n = t.right + t.wrong + t.missing; return `ถูก ${pct(t.right, n)} · ผิด ${pct(t.wrong, n)} · ไม่พบ ${pct(t.missing, n)} (${n})`; };
export const addTally = (a: Tally, b: Tally): Tally => ({ right: a.right + b.right, wrong: a.wrong + b.wrong, missing: a.missing + b.missing });

/**
 * Beam span lengths of EVERY instance (scoreReading looks at one member per tag). The answer keys hold no span
 * per instance, so the only truth available is the key's grid: a span between two grid nodes on one line must be
 * as long as the key's grid says. Grid labels are matched by OFFSET, not by name: a plan the reader gave extra
 * lines (a sub-line the key does not count) renames every later line, so the label "3" on one plan is not the
 * key's third line. Each endpoint is placed with the reader's grid of the member's own page and must sit on a key
 * grid line (within 10 cm: reader grids drift ~2%, key lines here are ≥ 1.1 m apart). Everything the key's grid cannot check is counted apart, never as right:
 *   diagonal — between nodes on different lines ('diagonalExpected' when the key's remark says that beam is
 *   diagonal), unplaced — no grid at all, unmapped — an endpoint on no key grid line or on a page without a grid.
 */
export type LengthClass = 'right' | 'wrong' | 'diagonal' | 'diagonalExpected' | 'unplaced' | 'unmapped';
export interface LengthRow { tag: string; level?: string; page?: number; from: string | null; to: string | null; length: number | null; expected?: number; cls: LengthClass }
export function scoreLengths(key: AnswerKey, members: ExtractedMember[], readings: SheetReading[], tol = 0.05, onLine = 0.1) {
  const rows: LengthRow[] = [];
  const gridOf = (m: ExtractedMember) => {
    const page = Number((m.sourceSheetOrLayer || '').match(/p(\d+)/)?.[1]);
    const on = readings.filter(r => r.page === page && r.grid?.x?.length && r.grid?.y?.length);
    return { page, grid: (on.find(r => (r.level || '') === (m.level || '')) || on[0])?.grid };
  };
  const keyLine = (axis: number[], v: number) => axis.findIndex(k => Math.abs(k - v) <= onLine);
  const diagonalTags = new Set(key.members.filter(k => /เฉียง|diagonal/i.test(k.remark || '')).map(k => normTag(k.tag)));
  for (const m of members) {
    if (m.memberType !== 'BEAM') continue;
    const [from, to] = (m.gridLocation || '').split('–');
    const { page, grid } = gridOf(m);
    const base = { tag: m.tag, level: m.level, page: page || undefined, from: from && from !== '-' ? from : null, to: to || null, length: m.length ?? null };
    if (!base.from || !base.to) { rows.push({ ...base, cls: 'unplaced' }); continue; }
    const node = (g: string) => {
      const [row, col] = g.split('/');
      const y = grid?.y?.find(a => a.label === row)?.offset_m, x = grid?.x?.find(a => a.label === col)?.offset_m;
      if (x === undefined || y === undefined) return null;
      const kx = keyLine(key.grid.x, x), ky = keyLine(key.grid.y, y);
      return kx < 0 || ky < 0 ? null : { kx, ky };
    };
    const a = node(base.from), b = node(base.to);
    if (!a || !b) { rows.push({ ...base, cls: 'unmapped' }); continue; }
    if (a.kx !== b.kx && a.ky !== b.ky) { rows.push({ ...base, cls: diagonalTags.has(normTag(m.tag)) ? 'diagonalExpected' : 'diagonal' }); continue; }
    const expected = Number((a.ky === b.ky ? Math.abs(key.grid.x[b.kx] - key.grid.x[a.kx]) : Math.abs(key.grid.y[b.ky] - key.grid.y[a.ky])).toFixed(3));
    rows.push({ ...base, expected, cls: m.length != null && Math.abs(m.length - expected) <= tol ? 'right' : 'wrong' });
  }
  const tally = { right: 0, wrong: 0, diagonal: 0, diagonalExpected: 0, unplaced: 0, unmapped: 0 } as Record<LengthClass, number>;
  for (const r of rows) tally[r.cls]++;
  return { rows, tally };
}
export const lengthText = (t: Record<LengthClass, number>) => {
  const checked = t.right + t.wrong;
  return `เทียบกริดได้ ${checked}: ถูก ${t.right} · ผิด ${t.wrong} | ตรวจไม่ได้: คานเฉียง ${t.diagonal} (key ระบุว่าเฉียง ${t.diagonalExpected}) · ไม่มีกริด ${t.unplaced} · ปลายไม่อยู่บนเส้นกริดของ key ${t.unmapped}`;
};
