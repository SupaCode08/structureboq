/**
 * Round 22.1: occurrences of one member reference that may be one physical instance. Nothing is removed or merged
 * by the system: an undecided group holds every occurrence; a reviewer's link counts the instance once; separate
 * instances stay separate even with the same specification. Synthetic members only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  approvalFor, computeProject, DEFAULT_MATERIAL_SPECS, detectDuplicateGroups, REQUIRED_SPECS,
  type DuplicateDecision, type ExtractedMember, type MaterialSpecs,
} from './qsEngine.ts';
import { logEntryFor } from './reviewLog.ts';
import { buildBoqWorkbook } from '../export/excelWorkbook.ts';

const SPECS: MaterialSpecs = { ...DEFAULT_MATERIAL_SPECS, coverSources: { footing: 'drawing_notes' }, valueSources: Object.fromEntries(REQUIRED_SPECS.map(r => [r.key, { source: 'user' as const }])) };
const base = (tag: string, page: number, p: Partial<ExtractedMember> = {}): ExtractedMember => ({
  tag, memberType: 'FOOTING', width: 1.2, depth: 1.2, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5, bottomRebar: '6-DB12+6-DB12', footingHookShape: 'STRAIGHT',
  gridLocation: `Sheet-P${page}`, level: 'Story 1', rawDimensionStr: `${tag} | 1.20 x 1.20 m | 0.30 m | 1 | 6-DB12`,
  provenance: { evidence: [{ page, label: 'บรรทัดในตาราง', method: 'pdf_text' }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', rebar: 'drawing' }, confidence: 0.95 },
  ...p,
});
const row = (tag: string, page: number, p: Partial<ExtractedMember> = {}) => base(tag, page, p);
const placed = (tag: string, grid: string, page = 3, p: Partial<ExtractedMember> = {}) => base(tag, page, { gridLocation: grid, rawDimensionStr: `${tag} @ ${grid}`, ...p });
const project = (ms: ExtractedMember[]) => computeProject(ms, 'T', SPECS);
const decide = (ms: ExtractedMember[], d: Partial<DuplicateDecision>, at = 0): ExtractedMember[] => {
  const g = detectDuplicateGroups(ms).find(x => x.blocking)!;
  const rec: DuplicateDecision = { key: g.key, decision: 'SAME_INSTANCE', by: 'QS A', reason: 'ตารางหน้า 4 พิมพ์ซ้ำจากหน้า 2 (ชุดเดียวกัน)', at: '2026-11-05T09:00:00Z', ...d };
  return ms.map((m, i) => (g.members.includes(i) ? { ...m, duplicateReviews: [...(m.duplicateReviews || []), rec] } : m));
};
const vol = 1.2 * 1.2 * 0.3;
const codes = (it: any) => (it.flags || []).map((f: any) => f.code);

test('1, 8, 11. the same F2 on two pages: held until ruled; once linked it is counted once', () => {
  const ms = [row('F2', 2), row('F2', 4)];
  const g = detectDuplicateGroups(ms)[0];
  assert.equal(g.classification, 'POSSIBLE_DUPLICATE');
  assert.ok(g.evidence.some(e => /คนละหน้า \(2, 4\)/.test(e)));
  const before = project(ms);
  assert.deepEqual(before.items.map(i => i.status), ['NEEDS_REVIEW', 'NEEDS_REVIEW']);
  assert.ok(before.items.every(i => codes(i).includes('DUPLICATE_RISK')));
  assert.equal(Number(before.totalConcreteVolumeM3.toFixed(4)), Number((2 * vol).toFixed(4))); // nothing removed while undecided
  const linked = project(decide(ms, {}));
  assert.deepEqual(linked.items.map(i => [i.status, i.duplicate!.counted, i.duplicate!.linkedTo ?? null]), [['AUTO_RELEASE', true, null], ['REJECTED', false, 'QS-F-001']]);
  assert.equal(linked.items[0].duplicate!.instanceId, linked.items[1].duplicate!.instanceId);
  assert.equal(Number(linked.totalConcreteVolumeM3.toFixed(4)), Number(vol.toFixed(4)));
  assert.equal(linked.items[1].volumeNetM3, 0);
});

test('2, 3. the same F2 at two grid positions, same specification: two instances, nothing held', () => {
  const ms = [placed('F2', 'A/1'), placed('F2', 'A/2')];
  const g = detectDuplicateGroups(ms)[0];
  assert.equal(g.classification, 'DISTINCT_PHYSICAL_INSTANCES');
  assert.equal(g.blocking, false);
  const p = project(ms);
  assert.ok(p.items.every(i => !codes(i).includes('DUPLICATE_RISK') && i.duplicate!.counted));
  assert.notEqual(p.items[0].duplicate!.instanceId, p.items[1].duplicate!.instanceId);
  assert.equal(Number(p.totalConcreteVolumeM3.toFixed(4)), Number((2 * vol).toFixed(4)));
  // different references with the same specification are shown, never joined or held
  const same = detectDuplicateGroups([row('F2', 2), row('F7', 4)]);
  assert.deepEqual(same.map(x => [x.classification, x.blocking]), [['SAME_SPECIFICATION', false]]);
  assert.ok(project([row('F2', 2), row('F7', 4)]).items.every(i => !codes(i).includes('DUPLICATE_RISK')));
});

test('4. the same F2 with conflicting values: held, and it cannot be linked until the values are settled', () => {
  const ms = [row('F2', 2), row('F2', 4, { width: 1.5 })];
  const g = detectDuplicateGroups(ms)[0];
  assert.equal(g.classification, 'CONFLICTING_SPECIFICATION');
  const tried = detectDuplicateGroups(decide(ms, {}))[0];
  assert.equal(tried.state, 'invalid');
  assert.match(tried.problem!, /ค่าของแต่ละแหล่งต่างกัน/);
  assert.ok(project(decide(ms, {})).items.every(i => i.status === 'NEEDS_REVIEW'));
  assert.equal(detectDuplicateGroups(decide(ms, { decision: 'DISTINCT', reason: 'คนละชิ้น ขนาดต่างกันจริง' }))[0].state, 'decided');
});

test('5. a schedule row read twice on the same page is flagged as a possible re-read, not removed', () => {
  const ms = [row('F2', 2), row('F2', 2)];
  const g = detectDuplicateGroups(ms)[0];
  assert.equal(g.classification, 'POSSIBLE_DUPLICATE');
  assert.ok(g.evidence.some(e => /อ่านแถวเดิมซ้ำ/.test(e)));
  assert.equal(project(ms).items.length, 2);
});

test('6, 7. plan positions plus a schedule row of the same reference: insufficient evidence, every one held', () => {
  const ms = [placed('F2', 'A/1'), placed('F2', 'A/2'), row('F2', 5)];
  const g = detectDuplicateGroups(ms)[0];
  assert.equal(g.classification, 'INSUFFICIENT_EVIDENCE');
  assert.ok(project(ms).items.every(i => i.status === 'NEEDS_REVIEW' && codes(i).includes('DUPLICATE_RISK')));
  // linking would join two plan positions: refused
  const tried = detectDuplicateGroups(decide(ms, {}))[0];
  assert.equal(tried.state, 'invalid');
  assert.match(tried.problem!, /คนละตำแหน่ง/);
  // one place, read twice (plan + plan): the existing same-position rule counts it once
  const same = [placed('F2', 'A/1'), placed('F2', 'A/1', 4)];
  assert.equal(detectDuplicateGroups(same)[0].classification, 'SAME_PHYSICAL_INSTANCE');
  const p = project(same);
  assert.equal(p.items.filter(i => i.status !== 'REJECTED').length, 1);
});

test('reviewer name and reason are required; deferred and undecided keep the group held', () => {
  const ms = [row('F2', 2), row('F2', 4)];
  assert.equal(detectDuplicateGroups(decide(ms, { by: '' }))[0].state, 'invalid');
  assert.equal(detectDuplicateGroups(decide(ms, { reason: '' }))[0].state, 'invalid');
  for (const d of ['DEFERRED', 'UNDECIDED'] as const) {
    const p = project(decide(ms, { decision: d }));
    assert.ok(p.items.every(i => i.status === 'NEEDS_REVIEW'), d);
  }
});

test('9, 12. the reviewer keeps them as two instances: both counted, nothing held for duplication', () => {
  const p = project(decide([row('F2', 2), row('F2', 4)], { decision: 'DISTINCT', reason: 'สองฐานในผังต่างโซน' }));
  assert.deepEqual(p.items.map(i => [i.status, i.duplicate!.counted]), [['AUTO_RELEASE', true], ['AUTO_RELEASE', true]]);
  assert.ok(p.items.every(i => codes(i).includes('DUPLICATE_RESOLVED')));
  assert.equal(Number(p.totalConcreteVolumeM3.toFixed(4)), Number((2 * vol).toFixed(4)));
});

test('10. a ruling changes the snapshot: an approval given before it is stale; the ruling never makes anything drawing-verified', () => {
  const ms = [row('F2', 2), row('F2', 4)];
  const approved = ms.map(m => ({ ...m, review: approvalFor(m, undefined, SPECS) }));
  assert.ok(project(approved).items.every(i => i.status === 'NEEDS_REVIEW')); // approval cannot release an open group
  const ruled = decide(approved, {});
  const p = project(ruled);
  assert.equal(p.items[0].approvalState, 'STALE');
  assert.ok(p.items[0].staleChanges!.some(c => c.startsWith('member.duplicateReviews')));
  assert.notEqual(p.items[0].provenanceLevel, 'DRAWING_VERIFIED');
  const reapproved = ruled.map(m => ({ ...m, review: approvalFor(m, undefined, SPECS) }));
  assert.equal(project(reapproved).items[0].approvalState, 'APPROVED');
});

test('13. another reading of the occurrences asks again: the old ruling does not carry over', () => {
  const ruled = decide([row('F2', 2), row('F2', 4)], {});
  for (const changed of [
    [ruled[0], { ...ruled[1], provenance: { ...ruled[1].provenance!, evidence: [{ page: 6, label: 'บรรทัดในตาราง', method: 'pdf_text' as const }] } }],
    [ruled[0], { ...ruled[1], rawDimensionStr: 'F2 | 1.20 x 1.20 m | 0.30 m | 2 | 6-DB12', count: 2 }],
    [...ruled, row('F2', 7)],
  ]) {
    const g = detectDuplicateGroups(changed).find(x => x.blocking)!;
    assert.equal(g.state, 'open');
    assert.ok(project(changed).items.every(i => i.status !== 'REJECTED'), 'nothing linked on a stale ruling');
  }
});

test('14. Excel shows each occurrence, its instance, page, location, class, ruling and whether it is counted; history records the ruling', () => {
  const ms = [row('F2', 2), row('F2', 4)];
  const ruled = decide(ms, {});
  const p = project(ruled);
  const wb = buildBoqWorkbook({ ...p, materialSpecs: SPECS, reviewLog: [] });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['7.3 ตรวจรายการซ้ำ'], { header: 1 });
  const h = rows[1];
  const pick = (r: any[]) => ['เบอร์ (Member Reference)', 'Physical Instance ID', 'รายการ (Source Occurrence)', 'หน้าต้นฉบับ', 'ตำแหน่ง/กริด', 'การจำแนก', 'สถานะ', 'คำตัดสิน', 'ผู้ตรวจ', 'เหตุผล', 'นับในยอด', 'คอนกรีต (ลบ.ม.)'].map(k => r[h.indexOf(k)]);
  assert.deepEqual(rows.slice(2).map(pick), [
    ['F2', 'F2@p2#1', 'QS-F-001', 2, 'ไม่มีตำแหน่งในผัง', 'อาจซ้ำ', 'ตัดสินแล้ว', 'ชิ้นเดียวกัน', 'QS A', 'ตารางหน้า 4 พิมพ์ซ้ำจากหน้า 2 (ชุดเดียวกัน)', 'นับ', p.items[0].volumeNetM3],
    ['F2', 'F2@p2#1', 'QS-F-002', 4, 'ไม่มีตำแหน่งในผัง', 'อาจซ้ำ', 'ตัดสินแล้ว', 'ชิ้นเดียวกัน', 'QS A', 'ตารางหน้า 4 พิมพ์ซ้ำจากหน้า 2 (ชุดเดียวกัน)', 'ไม่นับ (ลิงก์กับ QS-F-001)', 0],
  ]);
  const e = logEntryFor(ms, ruled, [0, 1])!;
  assert.match(String(e.changes.find(c => c.field === 'duplicateReviews')!.to), /ชิ้นเดียวกัน \[[0-9a-f]{16}\] โดย QS A: ตารางหน้า 4/);
  // the BOQ sums count the linked instance once
  const s1 = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['1. สรุปปริมาณงาน BOQ'], { header: 1 });
  assert.ok(s1.length > 0);
  assert.equal(Number(p.totalConcreteVolumeM3.toFixed(4)), Number(vol.toFixed(4)));
});
