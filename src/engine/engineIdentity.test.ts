/**
 * Round 20.1: the calculation engine identity is generated from the engine's code, and quantity-relevant
 * spec values nobody gave hold approval until a value or a documented assumption is recorded.
 * Synthetic members only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import {
  approvalFor, calcSnapshot, calculateMember, computeProject, DEFAULT_MATERIAL_SPECS, engineIdentity, fingerprintOf, REQUIRED_SPECS,
  type ExtractedMember, type MaterialSpecs,
} from './qsEngine.ts';
import { ENGINE_ID } from './engineIdentity.ts';
import { buildBoqWorkbook } from '../export/excelWorkbook.ts';
import { currentEngineIdentity, engineIdentityOf } from '../../scripts/gen_engine_identity.ts';

const SRC = fs.readFileSync('src/engine/qsEngine.ts', 'utf8');
const idOf = (src: string) => engineIdentityOf({ 'src/engine/qsEngine.ts': src });
const SOURCED = Object.fromEntries(REQUIRED_SPECS.map(r => [r.key, { source: 'user' as const }]));
const SPECS: MaterialSpecs = { ...DEFAULT_MATERIAL_SPECS, coverSources: { footing: 'drawing_notes' }, valueSources: SOURCED };
const F: ExtractedMember = {
  tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 1.2, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5, bottomRebar: '6-DB12+6-DB12', footingHookShape: 'STRAIGHT',
  provenance: { evidence: [{ page: 1, label: 'd', method: 'pdf_text' }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', rebar: 'drawing' }, confidence: 0.95 },
};
const approved = (m: ExtractedMember, specs = SPECS) => ({ ...m, review: approvalFor(m, undefined, specs) });
const run = (m: ExtractedMember, specs = SPECS) => calculateMember(m, 1, specs);
const withEngineId = <T,>(id: string, fn: () => T): T => { const keep = engineIdentity.id; engineIdentity.id = id; try { return fn(); } finally { engineIdentity.id = keep; } };

test('1. a calculation rule change changes the engine identity', () => {
  assert.ok(SRC.includes('(wM + 0.20)'));
  assert.notEqual(idOf(SRC.replace('(wM + 0.20)', '(wM + 0.25)')), idOf(SRC));
  assert.notEqual(idOf(SRC.replace("member.excavationDepthM || 1.50;", "member.excavationDepthM || 1.20;")), idOf(SRC));
});

test('2. a relevant constant change changes the engine identity', () => {
  assert.ok(SRC.includes('AUTO_RELEASE_CONFIDENCE_PCT = 80'));
  assert.notEqual(idOf(SRC.replace('AUTO_RELEASE_CONFIDENCE_PCT = 80', 'AUTO_RELEASE_CONFIDENCE_PCT = 81')), idOf(SRC));
  assert.notEqual(idOf(SRC.replace('leanThicknessM: 0.05,', 'leanThicknessM: 0.07,')), idOf(SRC));
});

test('3. comments and formatting do not change it; the engine runs with the identity of its current source', () => {
  assert.equal(idOf('// note\n' + SRC.replace(/\n/g, '\n\n')), idOf(SRC));
  const now = currentEngineIdentity();
  assert.ok(now.sources.every(f => f.startsWith('src/engine/')), 'no UI file in the identity');
  assert.equal(ENGINE_ID, now.id);
  assert.equal(engineIdentity.id, now.id);
});

test('4. an engine identity mismatch voids the approval; an unverified identity cannot release', () => {
  const a = approved(F);
  assert.equal(run(a).approvalState, 'APPROVED');
  const r = withEngineId('f'.repeat(64), () => run(a));
  assert.equal(r.approvalState, 'STALE');
  assert.ok(r.staleChanges!.some(c => c.startsWith('engineId:')));
  const u = withEngineId('UNVERIFIED', () => run(approved(F)));
  assert.equal(u.status, 'NEEDS_REVIEW');
  assert.match(u.flags!.find(f => f.code === 'APPROVAL_FIELDS_OPEN')!.message, /ตัวตนของตัวคำนวณ/);
});

test('5. a missing critical spec source or excavation depth holds the approval', () => {
  const bare = { ...SPECS, valueSources: undefined };
  const r = run(approved(F, bare), bare);
  assert.equal(r.status, 'NEEDS_REVIEW');
  const flag = r.flags!.find(f => f.code === 'SPEC_DEFAULT_UNSOURCED')!;
  assert.match(flag.message, /ความหนาคอนกรีตหยาบใต้ฐานราก 0\.05 ม\./);
  assert.match(r.flags!.find(f => f.code === 'APPROVAL_FIELDS_OPEN')!.message, /สเปกโครงการที่ไม่มีที่มา/);
  assert.equal(r.leanConcreteM3, run(F).leanConcreteM3); // held, not recalculated
  const noDepth = { ...F, excavationDepthM: undefined };
  const d = run(approved(noDepth), SPECS);
  assert.equal(d.status, 'NEEDS_REVIEW');
  assert.ok(d.flags!.some(f => f.code === 'EXCAVATION_DEPTH_DEFAULT' && /1\.50/.test(f.message)));
});

test('6. a documented assumption releases the approval and enters the snapshot', () => {
  const specs: MaterialSpecs = { ...SPECS, valueSources: { ...SOURCED, leanThicknessM: { source: 'assumption', note: 'ตามแบบมาตรฐานกรม', by: 'QS A', at: '2026-11-03T00:00:00Z' } } };
  const a = approved(F, specs);
  const r = run(a, specs);
  assert.equal(r.approvalState, 'APPROVED');
  assert.match(r.flags!.find(f => f.code === 'SPEC_ASSUMPTION')!.message, /ตามแบบมาตรฐานกรม \(QS A\)/);
  assert.deepEqual((a.review.snapshot!.specs.valueSources as any).leanThicknessM, specs.valueSources!.leanThicknessM);
  // changing the documented reason is a change of input
  const edited = { ...specs, valueSources: { ...specs.valueSources, leanThicknessM: { ...specs.valueSources!.leanThicknessM!, note: 'อื่น' } } };
  assert.equal(run(a, edited).approvalState, 'STALE');
});

test('7. missing display-only or price information does not hold a member', () => {
  const plain = { ...SPECS, concreteGrade: '', formworkType: '', stirrupGrade: '', sourceText: undefined };
  assert.equal(run(approved(F, plain), plain).approvalState, 'APPROVED');
  // a column uses none of the class B spec values
  const c: ExtractedMember = { tag: 'C1', memberType: 'COLUMN', width: 0.25, depth: 0.25, length: 3, count: 1, unit: 'm', topRebar: '4-DB12', stirrupRebar: 'RB6@0.15', provenance: F.provenance };
  const bare = { ...DEFAULT_MATERIAL_SPECS };
  assert.ok(!run(c, bare).flags!.some(f => f.code === 'SPEC_DEFAULT_UNSOURCED'));
  assert.deepEqual(run(c, bare).specKeysUsed, []);
});

test('8. Excel shows each spec value, its source and reason, and the engine identity', () => {
  const specs: MaterialSpecs = { ...SPECS, valueSources: { leanThicknessM: { source: 'assumption', note: 'ตามแบบมาตรฐานกรม', by: 'QS A', at: '2026-11-03T00:00:00Z' } } };
  const project = computeProject([approved(F, specs), { ...F, tag: 'F2' }], 'T', specs);
  const wb = buildBoqWorkbook({ ...project, materialSpecs: specs, reviewLog: [] });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['7.1 สมมติฐานสเปก'], { header: 1 });
  const h = rows[1];
  const lean = rows.find(r => r[0] === 'ความหนาคอนกรีตหยาบใต้ฐานราก')!;
  assert.deepEqual([lean[h.indexOf('ค่าที่ใช้')], lean[h.indexOf('ที่มา')], lean[h.indexOf('เหตุผล/หมายเหตุ')], lean[h.indexOf('ผู้ยืนยัน')], lean[h.indexOf('จำนวนรายการที่ใช้')]],
    ['0.05 ม.', 'สมมติฐานที่บันทึก', 'ตามแบบมาตรฐานกรม', 'QS A', 2]);
  const margin = rows.find(r => r[0] === 'ระยะเผื่อขุดรอบฐานราก')!;
  assert.equal(margin[h.indexOf('ที่มา')], 'ไม่มีที่มา (ค่าเริ่มต้น)');
  const s7 = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['7. บันทึกการตรวจทาน'], { header: 1 });
  assert.ok(String(s7[0][0]).includes(engineIdentity.id));
  // the unsourced margin holds F1's approval; the export says so
  const f1 = s7.find(r => r[1] === 'F1')!;
  assert.equal(f1[s7[1].indexOf('สถานะการอนุมัติ')], 'รอตรวจ');
  // a standing approval carries the engine identity it was made on
  const ok = buildBoqWorkbook({ ...computeProject([approved(F)], 'T', SPECS), materialSpecs: SPECS, reviewLog: [] });
  const s7ok = XLSX.utils.sheet_to_json<any[]>(ok.Sheets['7. บันทึกการตรวจทาน'], { header: 1 });
  assert.equal(s7ok[2][s7ok[1].indexOf('Engine ID ตอนอนุมัติ')], engineIdentity.id);
});

test('9. an approval made before engine identities (Round 20) needs reapproval', () => {
  const { engineId: _, ...r20 } = calcSnapshot(F, SPECS);
  const old = { ...F, review: { status: 'approved' as const, at: '2026-11-03T00:00:00Z', snapshot: r20 as any, fingerprint: fingerprintOf(r20 as any) } };
  const r = run(old);
  assert.equal(r.approvalState, 'STALE');
  assert.ok(r.staleChanges!.some(c => c.startsWith('engineId: —')));
});

test('10. the snapshot is deterministic across a save and reload', () => {
  const a = approved(F);
  const reloaded = JSON.parse(JSON.stringify(a)); // as localStorage gives it back
  assert.equal(run(reloaded).approvalState, 'APPROVED');
  assert.equal(fingerprintOf(calcSnapshot(reloaded, JSON.parse(JSON.stringify(SPECS)))), a.review.fingerprint);
});
