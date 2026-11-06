/**
 * Round 20: an approval is bound to every input its quantities were calculated from (member, cover, hook,
 * project specs, drawing file, engine version) through a snapshot and its SHA-256 fingerprint.
 * Synthetic members only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import {
  approvalFor, calcSnapshot, calculateMember, CALC_ENGINE_VERSION, computeProject, DEFAULT_MATERIAL_SPECS, fingerprintOf,
  REQUIRED_SPECS, sha256Hex, stableStringify,
  type ExtractedMember, type MaterialSpecs,
} from './qsEngine.ts';
import { buildBoqWorkbook } from '../export/excelWorkbook.ts';

// the drawing's general notes give the footing cover, so an approved footing releases
const SPECS: MaterialSpecs = { ...DEFAULT_MATERIAL_SPECS, coverSources: { footing: 'drawing_notes' }, valueSources: Object.fromEntries(REQUIRED_SPECS.map(r => [r.key, { source: 'user' as const }])) };
const DRAWING = { file: 'S-01.pdf', sha256: 'a'.repeat(64) };
const F: ExtractedMember = {
  tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 1.2, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5, bottomRebar: '6-DB12+6-DB12', footingHookShape: 'STRAIGHT',
  provenance: { evidence: [{ page: 1, label: 'd', method: 'pdf_text' }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', rebar: 'drawing' }, confidence: 0.95 },
};
// F uses its own hook; G takes the project's default hook
const { footingHookShape: _, ...G0 } = F;
const G = G0 as ExtractedMember;
const approved = (m: ExtractedMember, specs = SPECS, drawing: typeof DRAWING | null = DRAWING) => ({ ...m, review: approvalFor(m, undefined, specs, drawing) });
const run = (m: ExtractedMember, specs = SPECS, drawing: typeof DRAWING | null = DRAWING) => calculateMember(m, 1, specs, drawing);
const stale = (r: ReturnType<typeof run>, field: RegExp) => {
  assert.equal(r.approvalState, 'STALE');
  assert.equal(r.status, 'NEEDS_REVIEW');
  assert.equal(r.review, undefined);
  assert.ok(r.staleChanges!.some(c => field.test(c)), r.staleChanges!.join(' | '));
  assert.match(r.flags!.find(f => f.code === 'APPROVAL_STALE')!.message, field);
};

test('1. SHA-256 matches the standard vectors and node:crypto', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  for (const s of ['ฐานราก F1 · DB12@0.15', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000)]) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), `length ${s.length}`);
  }
});

test('2. serialization: key order never matters, undefined dropped, null kept', () => {
  assert.equal(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), stableStringify({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  assert.equal(stableStringify({ a: 1, b: undefined }), '{"a":1}');
  assert.notEqual(stableStringify({ a: null }), stableStringify({}));
});

test('3. the same inputs give the same fingerprint (time and member key order do not count)', () => {
  const reordered = Object.fromEntries(Object.entries(F).reverse()) as ExtractedMember;
  assert.equal(fingerprintOf(calcSnapshot(F, SPECS, DRAWING)), fingerprintOf(calcSnapshot(reordered, SPECS, DRAWING)));
  const a = approvalFor(F, undefined, SPECS, DRAWING), b = approvalFor(F, 'later', SPECS, DRAWING);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.snapshot!.engineVersion, CALC_ENGINE_VERSION);
});

test('4. an approval on unchanged inputs stands, with the quantities it was given on', () => {
  const r = run(approved(F));
  assert.equal(r.approvalState, 'APPROVED');
  assert.equal(r.status, 'AUTO_RELEASE');
  const q = r.review!.quantities!;
  assert.deepEqual([q.concreteM3, q.rebarKg, q.leanM3, q.excavationM3, q.costThb], [r.volumeNetM3, r.rebarWeightKg, r.leanConcreteM3, r.excavationM3, r.totalCostThb]);
});

test('5. a member value change voids the approval and names the field', () => {
  stale(run({ ...approved(F), width: 1.5 }), /member\.width: 1\.2 → 1\.5/);
  stale(run({ ...approved(F), count: 4 }), /member\.count/);
});

test('6. the project default hook voids an approval that used it, not one with its own hook', () => {
  stale(run(approved(G), { ...SPECS, footingHookShape: 'STANDARD_HOOK' }), /specs\.footingHookShape: "FULL_UPTURN" → "STANDARD_HOOK"/);
  stale(run(approved(G), { ...SPECS, footingHookShape: 'STANDARD_HOOK' }), /hook\.shape: "FULL_UPTURN" → "STANDARD_HOOK"/);
  // whole specs are in the snapshot (decision 1): F still lapses, on the spec only
  const r = run(approved(F), { ...SPECS, footingHookShape: 'STANDARD_HOOK' });
  stale(r, /specs\.footingHookShape/);
  assert.ok(!r.staleChanges!.some(c => c.startsWith('hook')));
});

test('7. lean concrete thickness', () => stale(run(approved(F), { ...SPECS, leanThicknessM: 0.10 }), /specs\.leanThicknessM: 0\.05 → 0\.1/));
test('8. excavation margin', () => stale(run(approved(F), { ...SPECS, excavationMarginM: 0.30 }), /specs\.excavationMarginM/));
test('9. wastage and rates', () => {
  stale(run(approved(F), { ...SPECS, rebarWastagePct: 10 }), /specs\.rebarWastagePct/);
  stale(run(approved(F), { ...SPECS, concreteMatRate: 4200 }), /specs\.concreteMatRate/);
});
test('10. project cover', () => stale(run(approved(F), { ...SPECS, footingCoveringCm: 7.5 }), /cover\.cm: 5 → 7\.5/));

test('11. the drawing file: another hash voids, the same file keeps, samples bind to no file', () => {
  stale(run(approved(F), SPECS, { ...DRAWING, sha256: 'b'.repeat(64) }), /drawing\.sha256: "aaaa/);
  stale(run(approved(F), SPECS, null), /drawing:/);
  assert.equal(run(approved(F), SPECS, { ...DRAWING }).approvalState, 'APPROVED');
  assert.equal(run(approved(F, SPECS, null), SPECS, null).approvalState, 'APPROVED');
});

test('12. an approval from another engine version lapses', () => {
  const snapshot = { ...calcSnapshot(F, SPECS, DRAWING), engineVersion: '19.1' };
  stale(run({ ...F, review: { status: 'approved', at: '2026-11-01T00:00:00Z', snapshot, fingerprint: fingerprintOf(snapshot) } }), /engineVersion: "19\.1" → "20\.1"/);
});

test('13. an approval saved before Round 20 (no snapshot) lapses', () => {
  stale(run({ ...F, review: { status: 'approved', at: '2026-11-01T00:00:00Z', valuesKey: 'x', coverM: 0.05 } as any }), /ก่อนมีการบันทึก snapshot/);
});

test('14. a snapshot edited after approval does not match its fingerprint and lapses', () => {
  const a = approved(F);
  const forged = { ...a, width: 2, review: { ...a.review, snapshot: { ...a.review.snapshot!, member: { ...a.review.snapshot!.member, width: 2 } } } };
  stale(run(forged), /ไม่ตรงกับ fingerprint/);
});

test('15. provenance and the decision note are not inputs; a rejection stays REJECTED', () => {
  const a = approved(F);
  assert.equal(run({ ...a, provenance: { ...F.provenance!, evidence: [{ page: 2, label: 'other', method: 'pdf_text' }] } }).approvalState, 'APPROVED');
  assert.equal(run({ ...a, review: { ...a.review, note: 'checked again' } }).approvalState, 'APPROVED');
  assert.equal(run({ ...F, review: { status: 'rejected', at: '2026-11-01T00:00:00Z' } }).approvalState, 'REJECTED');
  assert.equal(run(F).approvalState, undefined); // released on the drawing alone: no decision needed
  assert.equal(run({ ...F, provenance: undefined }).approvalState, 'NEEDS_REVIEW');
});

test('16. a missing spec value is flagged and recorded as null; export shows state, fingerprint and what changed', () => {
  const holey = { ...SPECS, leanThicknessM: undefined } as unknown as MaterialSpecs;
  const r = run(F, holey);
  assert.ok(r.flags!.some(f => f.code === 'SPEC_VALUE_MISSING' && f.severity === 'warn' && /leanThicknessM/.test(f.message)));
  assert.equal(r.leanConcreteM3, run(F).leanConcreteM3); // same number as before: flagged, not changed
  assert.equal(calcSnapshot(F, holey).specs.leanThicknessM, null);
  assert.ok(!run(F).flags!.some(f => f.code === 'SPEC_VALUE_MISSING'));

  const members = [approved(F), approved({ ...F, tag: 'F2' })];
  const project = computeProject(members, 'T', { ...SPECS, leanThicknessM: 0.1 }, undefined, DRAWING);
  assert.deepEqual(project.items.map(i => i.approvalState), ['STALE', 'STALE']);
  const fresh = computeProject(members, 'T', SPECS, undefined, DRAWING);
  assert.deepEqual(fresh.items.map(i => i.approvalState), ['APPROVED', 'APPROVED']);

  const wb = buildBoqWorkbook({ ...project, reviewLog: [] });
  const s7 = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['7. บันทึกการตรวจทาน'], { header: 1 });
  assert.match(String(s7[0][0]), new RegExp(`engine ${CALC_ENGINE_VERSION.replace('.', '\\.')}`));
  const h = s7[1], row = s7.find(x => x[1] === 'F1')!;
  assert.match(row[h.indexOf('สถานะการอนุมัติ')], /หมดอายุ/);
  assert.equal(row[h.indexOf('Fingerprint (SHA-256)')], members[0].review.fingerprint);
  assert.match(row[h.indexOf('ค่าที่เปลี่ยนหลังอนุมัติ')], /specs\.leanThicknessM: 0\.05 → 0\.1/);
  assert.match(row[h.indexOf('ยอดตอนอนุมัติ')], /คอนกรีต 0\.432/);
});
