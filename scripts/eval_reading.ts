/**
 * Reading accuracy against a hand-read answer key (real_drawings/<set>/answer_key.json), per field —
 * not only BOQ totals, which can hide errors that cancel out.
 *
 *   npx tsx scripts/eval_reading.ts real_drawings/cdc_1 [real_drawings/house_ready_4 ...] [--detail]
 *
 * For every tag in the key: found?  count right?  width / depth / thickness / bars / stirrups:
 * right, WRONG (a value that looks trustworthy but is not — the worst case) or missing.
 */
import fs from 'fs';
import path from 'path';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS } from '../src/engine/sheetMerge.ts';
import type { ExtractedMember } from '../src/engine/qsEngine.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('eval_reading.ts');

type Key = { tag: string; type: string; count?: number; width?: number; depth?: number; thickness?: number; topRebar?: string; bottomRebar?: string; mainRebar?: string; stirrup?: string };

const normTag = (t: string) => t.toUpperCase().replace(/[()\s]/g, '');
/** bars as a set: "3-RB12+2-DB16" == "2-DB16+3-RB12"; "Ø12@0.15" == "RB12@0.15" */
const normBars = (s?: string) => {
  if (!s) return '';
  const t = s.toUpperCase().replace(/\s/g, '').replace(/[ØΦ]/g, 'RB').replace(/MM\.?/g, '');
  if (t.includes('@')) return t.replace(/@0?\./, '@0.').replace(/(\.\d)0$/, '$1');
  const parts = t.split('+').map(p => p.replace(/^(\d+)-?/, '$1-'));
  const mesh = t.match(/^(\d+)\+(\d+)-?((?:DB|RB)\d+)$/);
  if (mesh) return `${mesh[1]}+${mesh[2]}-${mesh[3]}`;
  return parts.sort().join('+');
};
const near = (a?: number, b?: number) => a !== undefined && b !== undefined && Math.abs(a - b) <= 0.011;

interface Score { right: number; wrong: number; missing: number; notes: string[] }

function evaluate(dir: string, detail: boolean) {
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'answer_key.json'), 'utf-8'));
  const manifest = fs.existsSync(path.join(dir, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) : {};
  const ocr = JSON.parse(fs.readFileSync(path.join(dir, 'offline_ocr.json'), 'utf-8'));
  const { readings } = readSheets(ocr.pages);
  const merged = mergeSheetReadings(readings, manifest.pdf || 'x.pdf', { ...DEFAULT_MERGE_ASSUMPTIONS, footingVariant: manifest.footingVariant ?? 'แผ่' });
  const byTag = new Map<string, ExtractedMember[]>();
  for (const m of merged.members) for (const t of m.tag.split(',')) {
    const k = normTag(t) + ':' + m.memberType;
    byTag.set(k, [...(byTag.get(k) || []), m]);
  }

  const s: Score = { right: 0, wrong: 0, missing: 0, notes: [] };
  const field = (tag: string, name: string, want: unknown, got: unknown, eq: (a: any, b: any) => boolean) => {
    if (want === undefined) return;
    if (got === undefined || got === null || got === '' || got === 0) { s.missing++; s.notes.push(`${tag} ${name}: ไม่พบ (แบบ ${want})`); return; }
    if (eq(want, got)) s.right++;
    else { s.wrong++; s.notes.push(`${tag} ${name}: ผิด — ระบบ ${got} แบบ ${want}`); }
  };

  const plans = readings.filter(r => r.grid?.x?.length || r.grid?.y?.length);
  const gridOk = (axis: 'x' | 'y') => plans.some(r => {
    const g = (r.grid![axis] || []).map(a => a.offset_m);
    if (!key.grid[axis].length) return g.length <= 1;
    return g.length === key.grid[axis].length && g.every((v, i) => Math.abs(v - key.grid[axis][i]) < 0.06);
  });
  const axisText = (v: number[]) => v.join('/') || '(เส้นเดียว)';
  for (const ax of ['x', 'y'] as const) field('grid', ax, axisText(key.grid[ax]), gridOk(ax) ? axisText(key.grid[ax]) : (plans[0]?.grid?.[ax]?.map(a => a.offset_m).join('/') || ''), (a, b) => a === b);

  const keyFootings = (key.members as Key[]).filter(k => k.type === 'FOOTING');
  if (keyFootings.length && keyFootings.every(k => k.count !== undefined)) {
    const n = merged.members.filter(m => m.memberType === 'FOOTING').length;
    field('ฐานรากทั้งหมด', 'จำนวน', keyFootings.reduce((a, k) => a + k.count!, 0), n, (a, b) => a === b);
  }

  let tagsFound = 0;
  for (const k of key.members as Key[]) {
    const ms = byTag.get(normTag(k.tag) + ':' + k.type) || [];
    if (!ms.length) { s.missing++; s.notes.push(`${k.tag}: ไม่พบเบอร์นี้เลย`); continue; }
    tagsFound++;
    s.right++;
    if (k.count !== undefined) field(k.tag, 'จำนวน', k.count, ms.length, (a, b) => a === b);
    const assumed = (f: string) => ms[0].provenance?.fieldSources?.[f] === 'assumed';
    const m = { ...ms[0], width: assumed('width') ? undefined : ms[0].width, depth: assumed('depth') ? undefined : ms[0].depth };
    const isFS = k.type === 'FOOTING' || k.type === 'SLAB';
    if (k.type !== 'SLAB') {
      field(k.tag, 'กว้าง', k.width, m.width, near);
      field(k.tag, 'ลึก/ยาว', k.depth, m.depth, near);
    }
    if (isFS) field(k.tag, 'หนา', k.thickness, m.length, near);
    const bars = (a: string, b: string) => normBars(a) === normBars(b);
    if (k.type === 'COLUMN') field(k.tag, 'เหล็กยืน', k.mainRebar, m.topRebar, bars);
    else {
      field(k.tag, 'เหล็กบน', k.topRebar, m.topRebar, bars);
      field(k.tag, 'เหล็กล่าง', k.bottomRebar, m.bottomRebar, bars);
    }
    field(k.tag, 'ปลอก', k.stirrup, m.stirrupRebar, bars);
  }
  const total = s.right + s.wrong + s.missing;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  console.log(`\n${key.split === 'heldout' ? '[ชุดทดสอบแยก]' : '[ชุดพัฒนา]'} ${dir}`);
  console.log(`  เบอร์ที่พบ ${tagsFound}/${key.members.length} · ค่าทั้งหมด ${total}: ถูก ${s.right} (${pct(s.right)}) · ผิด ${s.wrong} (${pct(s.wrong)}) · ไม่พบ ${s.missing} (${pct(s.missing)})`);
  if (detail) s.notes.forEach(n => console.log('   -', n));
  return { dir, split: key.split, ...s, total, tagsFound, tags: key.members.length };
}

const detail = process.argv.includes('--detail');
const dirs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const rows = dirs.map(d => evaluate(d, detail));
if (rows.length > 1) {
  for (const split of ['dev', 'heldout']) {
    const r = rows.filter(x => x.split === split);
    if (!r.length) continue;
    const t = r.reduce((a, x) => ({ right: a.right + x.right, wrong: a.wrong + x.wrong, missing: a.missing + x.missing, total: a.total + x.total }), { right: 0, wrong: 0, missing: 0, total: 0 });
    console.log(`\nรวม${split === 'dev' ? 'ชุดพัฒนา' : 'ชุดทดสอบแยก'}: ถูก ${Math.round(t.right / t.total * 100)}% · ผิด ${Math.round(t.wrong / t.total * 100)}% · ไม่พบ ${Math.round(t.missing / t.total * 100)}%`);
  }
}
