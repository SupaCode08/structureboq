/**
 * Round 22: conflicts between a drawing's sources — detected with every source and its page, never settled by
 * the system, held at the gate until a reviewer rules (name, reason by risk), and part of the approval snapshot.
 * Synthetic readings only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  approvalFor, calculateMember, computeProject, CONFLICT_FIELD, conflictKey, conflictStatuses, DEFAULT_MATERIAL_SPECS, REQUIRED_SPECS,
  type ConflictResolution, type ExtractedMember, type FieldConflict, type MaterialSpecs,
} from './qsEngine.ts';
import { mergeSheetReadings, type SheetReading, type SectionDef } from './sheetMerge.ts';
import { reconcile, reconcileScheduleRows } from './sourceConflicts.ts';
import { logEntryFor } from './reviewLog.ts';
import { buildBoqWorkbook } from '../export/excelWorkbook.ts';

const grid = { x: [{ label: '1', offset_m: 0 }, { label: '2', offset_m: 2.7 }], y: [{ label: 'A', offset_m: 0 }, { label: 'B', offset_m: 3.6 }] };
const plan: SheetReading = { page: 3, sheet_id: 'S-03', sheet_type: 'framing_plan', level: 'ชั้น 1', grid, instances: [{ tag: 'GB2', member_type: 'BEAM', from_grid: 'A/1', to_grid: 'A/2', length_m: 2.7, confidence: 0.95 }], sections: [] };
const detail = (page: number, s: Partial<SectionDef>): SheetReading => ({ page, sheet_type: 'section_detail', instances: [], sections: [{ tag: 'GB2', member_type: 'BEAM', confidence: 0.95, ...s } as SectionDef] });
const gb = (...details: SheetReading[]) => mergeSheetReadings([plan, ...details], 'set.pdf', { columnStubHeightM: 1, storeyHeightM: 3, stairWidthM: 0.9, footingVariant: 'แผ่' }).members.find(m => m.tag === 'GB2')!;
const FULL = { width_m: 0.15, depth_m: 0.35, top_rebar: '2-DB12', bottom_rebar: '2-DB12', stirrup: 'RB6@0.15' };

const SPECS: MaterialSpecs = { ...DEFAULT_MATERIAL_SPECS, coverSources: { footing: 'drawing_notes' }, valueSources: Object.fromEntries(REQUIRED_SPECS.map(r => [r.key, { source: 'user' as const }])) };
const READ = { evidence: [{ page: 4, label: 'แบบขยาย / ตาราง', method: 'pdf_text' as const }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', rebar: 'drawing' } as Record<string, any>, confidence: 0.95 };
const WIDTH: FieldConflict = { field: 'width', kind: 'CONFLICT', sources: [{ value: 1.2, page: 4, ref: 'แบบขยาย / ตาราง' }, { value: 1.5, page: 7, ref: 'แบบขยาย / ตาราง' }] };
const F: ExtractedMember = { tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 1.2, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5, bottomRebar: '6-DB12+6-DB12', footingHookShape: 'STRAIGHT', provenance: { ...READ, fieldConflicts: [WIDTH] } };
const run = (m: ExtractedMember) => calculateMember(m, 1, SPECS);
const rule = (m: ExtractedMember, c: FieldConflict, p: Partial<ConflictResolution>): ExtractedMember => {
  const r: ConflictResolution = { key: conflictKey(c), field: c.field, choice: 'source', sourceIndex: 1, value: 1.5, before: (m as any)[c.field] ?? null, sourcePage: 7, by: 'QS A', reason: 'แบบขยายแผ่นล่าสุดตรงกับผัง', at: '2026-11-04T10:00:00Z', ...p };
  const def = CONFLICT_FIELD[c.field]; // the same member key and field source the review panel writes
  return { ...m, ...(r.choice !== 'deferred' ? { [def.key]: r.value } : {}), conflictResolutions: [...(m.conflictResolutions || []), r], provenance: { ...m.provenance!, fieldSources: { ...m.provenance!.fieldSources, [def.fs]: 'reviewer' } } };
};

test('two pages disagree: the field is a conflict with both sources and pages, and approval cannot release it', () => {
  const m = gb(detail(8, FULL), detail(9, { ...FULL, width_m: 0.2 }));
  const c = m.provenance!.fieldConflicts!.find(x => x.field === 'width')!;
  assert.deepEqual(c.sources.map(s => [s.value, s.page, s.ref]), [[0.15, 8, 'แบบขยาย / ตาราง'], [0.2, 9, 'แบบขยาย / ตาราง']]);
  assert.ok(m.provenance!.fieldAgreements!.some(a => a.field === 'depth' && a.kind === 'IDENTICAL' && a.pages.join() === '8,9'));
  const r = calculateMember({ ...m, review: approvalFor(m) }, 1);
  assert.equal(r.status, 'NEEDS_REVIEW');
  assert.ok(r.flags!.some(f => f.code === 'FIELD_CONFLICT' && f.field === 'width' && /0\.15 \(หน้า 8.*0\.2 \(หน้า 9/.test(f.message)));
  assert.match(r.flags!.find(f => f.code === 'APPROVAL_FIELDS_OPEN')!.message, /ความกว้าง/);
});

test('three pages: two agreeing do not outvote the third (no majority rule)', () => {
  const m = gb(detail(8, FULL), detail(9, FULL), detail(10, { ...FULL, bottom_rebar: '3-DB12' }));
  const c = m.provenance!.fieldConflicts!.find(x => x.field === 'bottomRebar')!;
  assert.deepEqual(c.sources.map(s => [s.value, s.page]), [['2-DB12', 8], ['2-DB12', 9], ['3-DB12', 10]]);
  assert.equal(c.kind, 'CONFLICT');
});

test('the same values on different pages, or one page filling what another left out, are not conflicts', () => {
  const same = gb(detail(8, FULL), detail(9, FULL));
  assert.equal(same.provenance!.fieldConflicts, undefined);
  assert.ok(same.provenance!.fieldAgreements!.every(a => a.kind === 'IDENTICAL'));
  const parts = gb(detail(8, { width_m: 0.15, depth_m: 0.35 }), detail(9, { top_rebar: '2-DB12', bottom_rebar: '2-DB12', stirrup: 'RB6@0.15' }));
  assert.equal(parts.provenance!.fieldConflicts, undefined);
  assert.deepEqual(parts.provenance!.fieldAgreements!.map(a => [a.field, a.kind]), [['width', 'COMPLEMENTARY'], ['depth', 'COMPLEMENTARY'], ['topRebar', 'COMPLEMENTARY'], ['bottomRebar', 'COMPLEMENTARY'], ['stirrupRebar', 'COMPLEMENTARY']]);
  // written forms that cannot be compared are not guessed equal or different
  assert.equal(reconcile('bottomRebar', [{ value: '2-DB12', page: 8, ref: 'a' }, { value: 'ดูแบบขยาย', page: 9, ref: 'b' }]).kind, 'UNDECIDABLE');
  assert.equal(reconcile('bottomRebar', [{ value: '2 - DB 12', page: 8, ref: 'a' }, { value: '2-DB12', page: 9, ref: 'b' }]).kind, 'IDENTICAL');
});

test('general notes against the member\'s own detail: a cover conflict, with the notes as a source without a page', () => {
  const m: ExtractedMember = { ...F, coveringCm: 7.5, provenance: { ...READ, fieldSources: { ...READ.fieldSources, cover: 'drawing' } } };
  const r = run(m);
  const c = r.conflicts!.find(x => x.conflict.field === 'cover')!;
  assert.deepEqual(c.conflict.sources.map(s => [s.value, s.page, s.ref]), [[7.5, 4, 'แบบขยายของชิ้นนี้'], [5, null, 'หมายเหตุทั่วไป (รายการประกอบแบบ)']]);
  assert.equal(c.state, 'open');
  assert.equal(run({ ...m, review: approvalFor(m, undefined, SPECS) }).status, 'NEEDS_REVIEW');
  // ruled for the notes: the cover used becomes 5 cm, as the reviewer's value
  const ruled = rule(m, c.conflict, { field: 'cover', sourceIndex: 1, value: 5, sourcePage: null, before: 7.5 });
  const ok = run(ruled);
  assert.equal(ok.conflicts!.find(x => x.conflict.field === 'cover')!.state, 'resolved');
  assert.equal(ok.coverM, 0.05);
});

test('a conflict without a reviewer, without a needed reason, or sent back stays open', () => {
  assert.equal(conflictStatuses(F, SPECS)[0].state, 'open');
  assert.equal(conflictStatuses(rule(F, WIDTH, { by: '' }), SPECS)[0].state, 'invalid');
  assert.equal(conflictStatuses(rule(F, WIDTH, { reason: '' }), SPECS)[0].state, 'invalid');           // width is high risk
  assert.equal(conflictStatuses(rule(F, WIDTH, { choice: 'deferred', value: null }), SPECS)[0].state, 'deferred');
  for (const p of [{ by: '' }, { reason: '' }, { choice: 'deferred' as const, value: null }]) {
    const m = rule(F, WIDTH, p);
    assert.equal(run({ ...m, review: approvalFor(m, undefined, SPECS) }).status, 'NEEDS_REVIEW', JSON.stringify(p));
  }
  // a typed value always needs a reason, a medium-risk source pick does not
  const stir: FieldConflict = { field: 'stirrupRebar', kind: 'CONFLICT', sources: [{ value: 'RB6@0.15', page: 4, ref: 'a' }, { value: 'RB6@0.20', page: 7, ref: 'b' }] };
  const s = { ...F, stirrupRebar: 'RB6@0.15', provenance: { ...READ, fieldConflicts: [stir] } };
  assert.equal(conflictStatuses(rule(s, stir, { sourceIndex: 0, value: 'RB6@0.15', reason: '' }), SPECS)[0].state, 'resolved');
  assert.equal(conflictStatuses(rule(s, stir, { choice: 'manual', value: 'RB6@0.125', reason: '' }), SPECS)[0].state, 'invalid');
});

test('ruling changes the snapshot: the approval before it lapses, one after it releases; the value is the reviewer\'s, not the drawing\'s', () => {
  const ruled = rule(F, WIDTH, {});
  // an approval given while the conflict was open, carried onto the ruled member
  const early = run({ ...ruled, review: approvalFor(F, undefined, SPECS) });
  assert.equal(early.approvalState, 'STALE');
  assert.ok(early.staleChanges!.some(c => c.startsWith('member.width')) && early.staleChanges!.some(c => c.startsWith('member.conflictResolutions')));
  const after = run({ ...ruled, review: approvalFor(ruled, undefined, SPECS) });
  assert.equal(after.approvalState, 'APPROVED');
  assert.equal(after.widthM, 1.5);
  assert.equal(ruled.provenance!.fieldSources.width, 'reviewer');
  assert.notEqual(after.provenanceLevel, 'DRAWING_VERIFIED');
  assert.ok(after.flags!.some(f => f.code === 'CONFLICT_RESOLVED' && /ตามหน้า 7/.test(f.message) && /QS A/.test(f.message)));
  // editing the field after the ruling reopens it
  assert.equal(conflictStatuses({ ...ruled, width: 1.3 }, SPECS)[0].state, 'mismatch');
});

test('a new reading with other sources asks again: the old ruling does not carry over', () => {
  const ruled = rule(F, WIDTH, {});
  const reread: FieldConflict = { ...WIDTH, sources: [WIDTH.sources[0], { ...WIDTH.sources[1], value: 1.6 }] };
  const m = { ...ruled, provenance: { ...ruled.provenance!, fieldConflicts: [reread] } };
  assert.equal(conflictStatuses(m, SPECS)[0].state, 'open');
  const moved = { ...ruled, provenance: { ...ruled.provenance!, fieldConflicts: [{ ...WIDTH, sources: [WIDTH.sources[0], { ...WIDTH.sources[1], page: 8 }] }] } };
  assert.equal(conflictStatuses(moved, SPECS)[0].state, 'open');
  assert.equal(run({ ...m, review: approvalFor(m, undefined, SPECS) }).status, 'NEEDS_REVIEW');
});

test('schedule rows of one tag on several pages: rows stay (quantities unchanged), disagreements recorded on each', () => {
  const row = (page: number, width: number): ExtractedMember => ({ tag: 'F2', memberType: 'FOOTING', width, depth: 1.2, length: 0.3, count: 1, unit: 'm', gridLocation: `Sheet-P${page}`,
    provenance: { evidence: [{ page, label: 'บรรทัดในตาราง', method: 'pdf_text' }], fieldSources: {}, confidence: 0.9, conflicts: [] } });
  const out = reconcileScheduleRows([row(2, 1.2), row(4, 1.5), { ...row(3, 1), tag: 'F3' }]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(m => m.width), [1.2, 1.5, 1]);
  for (const m of out.slice(0, 2)) assert.deepEqual(m.provenance!.fieldConflicts!.map(c => [c.field, c.sources.map(s => [s.value, s.page])]), [['width', [[1.2, 2], [1.5, 4]]]]);
  assert.equal(out[2].provenance!.fieldConflicts, undefined);
  assert.equal(reconcileScheduleRows([row(2, 1.2), row(4, 1.2)])[0].provenance!.fieldConflicts, undefined);
});

test('Excel and the review history show each conflict, the value before and after, the page, reviewer, reason, time and approval state', () => {
  const ruled = rule(F, WIDTH, {});
  const open = { ...F, tag: 'F2' };
  const project = computeProject([{ ...ruled, review: approvalFor(ruled, undefined, SPECS) }, open], 'T', SPECS);
  const wb = buildBoqWorkbook({ ...project, materialSpecs: SPECS, reviewLog: [] });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['7.2 ค่าขัดแย้งระหว่างแหล่ง'], { header: 1 });
  const h = rows[1];
  const get = (r: any[], k: string) => r[h.indexOf(k)];
  const [a, b] = [rows.find(r => r[1] === 'F1')!, rows.find(r => r[1] === 'F2')!];
  assert.match(get(a, 'แหล่งข้อมูล (ค่า · หน้าต้นฉบับ · อ้างอิง)'), /1\.2 \(หน้า 4 · แบบขยาย \/ ตาราง\) vs 1\.5 \(หน้า 7/);
  assert.deepEqual(['สถานะ', 'ค่าเดิม', 'ค่าที่ตัดสิน', 'หน้าที่ใช้ตัดสิน', 'ผู้ตรวจ', 'เหตุผล', 'เวลาตัดสิน', 'สถานะการอนุมัติ'].map(k => get(a, k)),
    ['ตัดสินแล้ว', 1.2, 1.5, 7, 'QS A', 'แบบขยายแผ่นล่าสุดตรงกับผัง', '2026-11-04T10:00:00Z', 'อนุมัติ (fingerprint ตรง)']);
  assert.deepEqual([get(b, 'สถานะ'), get(b, 'ค่าที่ตัดสิน'), get(b, 'สถานะการอนุมัติ')], ['ยังไม่ตัดสิน', '', 'รอตรวจ']);
  // the review history records the ruling with the value before and after
  const e = logEntryFor([F], [ruled], [0])!;
  assert.deepEqual(e.changes.map(c => [c.field, c.from, c.to]).find(c => c[0] === 'width'), ['width', 1.2, 1.5]);
  assert.match(String(e.changes.find(c => c.field === 'conflictResolutions')!.to), /width: 1\.2 → 1\.5 \(หน้า 7\) โดย QS A: แบบขยายแผ่นล่าสุดตรงกับผัง/);
});
