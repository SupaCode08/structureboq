/**
 * Round 19: footing RebarSets — model, per-set calculation, validation, provenance/approval, BOQ, Excel, history.
 * Synthetic members only: these check the rules, not reading accuracy on real drawings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  approvalFor, calcSnapshot, calculateMember, fingerprintOf, computeProject, DEFAULT_MATERIAL_SPECS, newRebarSetId, REQUIRED_SPECS,
  rebarSetBars, rebarSetProvenanceLevel, rebarSetsFromNote,
  type ExtractedMember, type RebarSet,
} from './qsEngine.ts';
import { buildBoqWorkbook } from '../export/excelWorkbook.ts';
import { logEntryFor, undoEntry } from './reviewLog.ts';

// every quantity-relevant spec value given by the QS (Round 20.1), so footings here are held only by what each test sets up
const SPECS = { ...DEFAULT_MATERIAL_SPECS, valueSources: Object.fromEntries(REQUIRED_SPECS.map(r => [r.key, { source: 'user' as const }])) };
const READ = { evidence: [{ page: 1, label: 'detail', method: 'pdf_text' as const }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', rebar: 'drawing' } as Record<string, any>, confidence: 0.95 };
const set = (p: Partial<RebarSet> = {}): RebarSet => ({
  id: 'RS-A', barType: 'DB', diameterMm: 12, arrangement: 'FIXED_COUNT', quantity: 5, direction: 'X', layer: 'BOTTOM',
  startHook: 'NONE', endHook: 'NONE', source: 'drawing', ...p,
});
// 1.20 (width, X) × 0.90 (length, Y) × 0.30 m, cover 5 cm → X run 1.10, Y run 0.80
const footing = (sets: RebarSet[] | undefined, p: Partial<ExtractedMember> = {}): ExtractedMember => ({
  tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 0.9, length: 0.3, count: 1, unit: 'm', coveringCm: 5, excavationDepthM: 1.5,
  bottomRebar: '5-DB12+4-DB16', rebarSets: sets, provenance: READ, ...p,
});
const calc = (sets: RebarSet[] | undefined, p: Partial<ExtractedMember> = {}) => calculateMember(footing(sets, p), 1, SPECS);
const codes = (r: any, id?: string) => (r.flags || []).filter((f: any) => !id || f.field === `rebarSet:${id}`).map((f: any) => `${f.code}:${f.severity}`);
const G = { widthM: 1.2, lengthM: 0.9, thickM: 0.3, coverM: 0.05 };

test('RebarSet model: single, multiple, stable ids, edit / duplicate / delete', () => {
  assert.equal(calc([set()]).rebarWeightKg, 4.88); // 5 × 1.10 m × 0.888 kg/m (one direction only: held by the steel-ratio check)
  const one = calc([set({ direction: 'BOTH' })]);
  assert.equal(one.status, 'AUTO_RELEASE');
  assert.deepEqual(one.rebarDetails!.barList.map(b => [b.setId, b.direction, b.count, b.lengthM]), [['RS-A', 'X', 5, 1.1], ['RS-A', 'Y', 5, 0.8]]);
  assert.ok(Math.abs(one.rebarWeightKg! - 9.5 * 0.888) < 0.011);

  const two = calc([set(), set({ id: 'RS-B', diameterMm: 16, quantity: 4, direction: 'Y' })]);
  assert.deepEqual(two.rebarDetails!.sets!.map(s => [s.id, s.status, s.bars]), [['RS-A', 'CALCULATED', 5], ['RS-B', 'CALCULATED', 4]]);
  assert.deepEqual(Object.keys(two.rebarByDia!).sort(), ['DB12', 'DB16']); // diameters never merged

  // ids: unique, and carried through calculation unchanged
  const ids = new Set(Array.from({ length: 200 }, newRebarSetId));
  assert.equal(ids.size, 200);
  assert.ok([...ids].every(i => /^RS-[A-Z0-9]{6}$/.test(i)));
  // edit changes only that set's result; duplicate (new id) doubles; delete of every set blocks, never weighs 0 silently
  assert.equal(calc([set({ quantity: 6 })]).rebarWeightKg, 5.86);
  assert.equal(calc([set(), set({ id: 'RS-COPY' })]).rebarWeightKg, 9.77);
  const none = calc([]);
  assert.ok(codes(none).includes('REBAR_SETS_EMPTY:block'));
  assert.equal(none.status, 'NEEDS_REVIEW');
});

test('RebarSet calculation: count, spacing, two directions, diameters, layers, independent hooks', () => {
  // spaced: Y bars spread over the width 1.10 m @150 → 8 bars, 0.80 m each
  const sp = rebarSetBars(set({ arrangement: 'SPACED', quantity: undefined, spacingMm: 150, direction: 'Y' }), G);
  assert.equal(sp.status, 'CALCULATED');
  assert.deepEqual(sp.bars.map(b => [b.direction, b.n, Number(b.cutLenM.toFixed(3))]), [['Y', 8, 0.8]]);
  // one note for both directions: X spread 0.80 → 6 bars × 1.10, Y spread 1.10 → 8 bars × 0.80
  const two = rebarSetBars(set({ arrangement: 'TWO_DIRECTION', quantity: undefined, spacingMm: 150, direction: 'BOTH' }), G);
  assert.deepEqual(two.bars.map(b => [b.direction, b.n, Number(b.cutLenM.toFixed(3))]), [['X', 6, 1.1], ['Y', 8, 0.8]]);
  // no minimum-3 clamp in sets: @500 over 0.80 m is 2 bars
  assert.equal(rebarSetBars(set({ arrangement: 'SPACED', quantity: undefined, spacingMm: 500 }), G).bars[0].n, 2);

  // layers and hooks per set: top mat straight, bottom mat upturned to the top cover (0.30 − 2×0.05 = 0.20 each end)
  const r = calc([
    set({ startHook: 'UPTURN', endHook: 'UPTURN' }),
    set({ id: 'RS-T', layer: 'TOP', diameterMm: 16, quantity: 4 }),
    set({ id: 'RS-H', direction: 'Y', quantity: 4, startHook: 'HOOK_90', endHook: 'NONE', hookLengthM: 0.15 }),
  ]);
  const rows = Object.fromEntries(r.rebarDetails!.barList.map(b => [b.setId, b]));
  assert.equal(rows['RS-A'].lengthM, 1.5);
  assert.equal(rows['RS-T'].lengthM, 1.1);
  assert.match(rows['RS-T'].purpose, /ชั้นบน/);
  assert.equal(rows['RS-H'].lengthM, 0.95);
  assert.ok(codes(r, 'RS-A').includes('REBAR_SET_UPTURN_FROM_THICKNESS:info'));
  // a cut length written on the drawing is used as given
  assert.equal(rebarSetBars(set({ cuttingLengthM: 1.25 }), G).bars[0].cutLenM, 1.25);
});

test('RebarSet validation: nothing guessed, nothing clamped, every bad set blocked and kept', () => {
  const blocked = (p: Partial<RebarSet>, code: string, g = G) => {
    const r = rebarSetBars(set(p), g);
    assert.equal(r.status, 'BLOCKED', JSON.stringify(p));
    assert.equal(r.bars.length, 0);
    assert.ok(r.flags.some(f => f.code === code && f.severity === 'block'), `${JSON.stringify(p)} → ${r.flags.map(f => f.code)}`);
  };
  blocked({ diameterMm: 0 }, 'REBAR_SET_INVALID');
  blocked({ diameterMm: 14 }, 'REBAR_SET_INVALID'); // no kg/m in the table: never weighed as DB12
  blocked({ quantity: 2.5 }, 'REBAR_SET_INVALID');
  blocked({ quantity: -1 }, 'REBAR_SET_INVALID');
  blocked({ arrangement: 'SPACED', quantity: undefined, spacingMm: 0 }, 'REBAR_SET_INVALID');
  blocked({ arrangement: 'SPACED', quantity: undefined, spacingMm: 10 }, 'REBAR_SET_INVALID'); // spacing below bar size
  blocked({}, 'REBAR_SET_INVALID', { ...G, coverM: 0.7 }); // impossible cover
  blocked({ startHook: 'UPTURN' }, 'REBAR_SET_INVALID', { ...G, thickM: 0.1 }); // upturn with no room
  blocked({ direction: 'UNSPECIFIED' }, 'REBAR_SET_DIRECTION_UNSPECIFIED');
  blocked({ direction: 'Z' as any }, 'REBAR_SET_INVALID');
  blocked({ arrangement: 'RANDOM' as any }, 'REBAR_SET_INVALID'); // unsupported arrangement
  blocked({ arrangement: 'FIXED_COUNT', quantity: undefined }, 'REBAR_SET_CONFLICT');
  blocked({ arrangement: 'TWO_DIRECTION', direction: 'X' }, 'REBAR_SET_CONFLICT');
  blocked({ quantity: 5, spacingMm: 150 }, 'REBAR_SET_CONFLICT'); // 5 bars vs @150 over 0.80 m = 6
  blocked({ quantity: undefined, arrangement: 'UNSPECIFIED' }, 'REBAR_SET_INCOMPLETE');
  blocked({ startHook: 'HOOK_90' }, 'REBAR_SET_INCOMPLETE'); // no universal 12d
  blocked({ hookLengthM: -0.1, startHook: 'HOOK_90' }, 'REBAR_SET_INVALID');
  blocked({ cuttingLengthM: 0 }, 'REBAR_SET_INVALID');
  blocked({ quantity: 40, diameterMm: 25 }, 'REBAR_SET_INVALID'); // 40 × 25 mm does not fit 0.80 m
  // consistent count + spacing is accepted
  assert.equal(rebarSetBars(set({ quantity: 6, spacingMm: 150 }), G).status, 'CALCULATED');
  // unspecified ends and arrangement: calculated, but held for review
  const loose = rebarSetBars(set({ arrangement: 'UNSPECIFIED', startHook: 'UNSPECIFIED' }), G);
  assert.equal(loose.status, 'NEEDS_REVIEW');
  assert.deepEqual(loose.flags.map(f => f.code).sort(), ['REBAR_SET_ARRANGEMENT_UNSPECIFIED', 'REBAR_SET_HOOK_UNSPECIFIED']);
  // a member with a blocked set is never released and its other sets still count
  const mixed = calc([set(), set({ id: 'RS-BAD', direction: 'UNSPECIFIED' })]);
  assert.equal(mixed.status, 'NEEDS_REVIEW');
  assert.equal(mixed.rebarWeightKg, 4.88);
  assert.deepEqual(mixed.rebarDetails!.sets!.map(s => s.status), ['CALCULATED', 'BLOCKED']);
});

test('RebarSet provenance and approval: per-set sources, set-level confirmation, invalidation', () => {
  const m = footing([set()]);
  const level = (s: Partial<RebarSet>, mm: ExtractedMember = m) => rebarSetProvenanceLevel(set(s), mm);
  assert.equal(level({}, { ...m, provenance: undefined }), 'UNKNOWN');
  assert.equal(level({}), 'OCR_EXTRACTED');
  assert.equal(level({}, { ...m, provenance: { ...READ, evidence: [{ page: 1, label: 'dxf', method: 'dxf' }] } }), 'DRAWING_VERIFIED');
  assert.equal(level({ source: 'reviewer' }, { ...m, provenance: { ...READ, evidence: [{ page: 1, label: 'dxf', method: 'dxf' }] } }), 'USER_CONFIRMED'); // never promoted
  assert.equal(level({ source: 'assumed' }), 'ENGINEERING_ASSUMPTION');
  assert.equal(level({ source: 'missing' }), 'DEFAULT_VALUE');

  // UNKNOWN never auto-releases
  const unknown = calc([set()], { provenance: undefined });
  assert.equal(unknown.status, 'NEEDS_REVIEW');
  assert.ok(codes(unknown, 'RS-A').includes('REBAR_SET_SOURCE:warn'));

  // a whole-member approval does not cover an assumed set; confirming one set leaves the other open
  const sets = [set({ source: 'assumed' }), set({ id: 'RS-B', direction: 'Y', quantity: 4, source: 'missing' })];
  const approve = (s: RebarSet[]) => { const mm = footing(s); return calculateMember({ ...mm, review: approvalFor(mm, undefined, SPECS) }, 1, SPECS); };
  const open = (r: any) => r.flags.find((f: any) => f.code === 'APPROVAL_FIELDS_OPEN')?.message || '';
  const r0 = approve(sets);
  assert.equal(r0.status, 'NEEDS_REVIEW');
  assert.match(open(r0), /RS-A/);
  assert.match(open(r0), /RS-B/);
  const r1 = approve([{ ...sets[0], source: 'reviewer' }, sets[1]]);
  assert.equal(r1.status, 'NEEDS_REVIEW');
  assert.doesNotMatch(open(r1), /RS-A/);
  assert.match(open(r1), /RS-B/);
  assert.equal(approve([{ ...sets[0], source: 'reviewer' }, { ...sets[1], source: 'reviewer' }]).status, 'AUTO_RELEASE');

  // editing a set or the geometry it depends on voids the approval
  const ok = footing([set()]);
  const approved = { ...ok, review: approvalFor(ok, undefined, SPECS) };
  assert.equal(calculateMember(approved, 1, SPECS).status, 'AUTO_RELEASE');
  for (const change of [{ rebarSets: [set({ quantity: 6 })] }, { rebarSets: [set(), set({ id: 'RS-N' })] }, { width: 1.5 }, { length: 0.4 }]) {
    const r = calculateMember({ ...approved, ...change }, 1, SPECS);
    assert.equal(r.status, 'NEEDS_REVIEW', JSON.stringify(change));
    assert.ok(codes(r).includes('APPROVAL_STALE:warn'));
  }
  // an incomplete set cannot be approved into release
  const bad = footing([set({ direction: 'UNSPECIFIED' })]);
  assert.equal(calculateMember({ ...bad, review: approvalFor(bad, undefined, SPECS) }, 1, SPECS).status, 'NEEDS_REVIEW');
  // a footing without sets has the same fingerprint as one where the field is absent
  const legacy = footing(undefined);
  const { rebarSets: _, ...noField } = legacy;
  assert.equal(fingerprintOf(calcSnapshot(legacy)), fingerprintOf(calcSnapshot(noField as ExtractedMember)));
});

test('RebarSet from the drawing note: split without interpreting direction, ambiguous notes kept as text', () => {
  const from = (note: string, p: Partial<ExtractedMember> = {}) => rebarSetsFromNote(footing(undefined, { bottomRebar: note, ...p }));
  const pair = from('5+4-DB12');
  assert.deepEqual(pair.map(s => [s.arrangement, s.quantity, s.diameterMm, s.direction, s.source, s.sourceText]),
    [['FIXED_COUNT', 5, 12, 'UNSPECIFIED', 'drawing', '5+4-DB12'], ['FIXED_COUNT', 4, 12, 'UNSPECIFIED', 'drawing', '5+4-DB12']]);
  assert.notEqual(pair[0].id, pair[1].id);
  assert.deepEqual(pair.map(s => s.startHook), ['UNSPECIFIED', 'UNSPECIFIED']); // no project default
  assert.deepEqual(from('5-DB12', { footingHookShape: 'FULL_UPTURN' }).map(s => s.endHook), ['UPTURN']);
  assert.deepEqual(from('DB12@0.15').map(s => [s.arrangement, s.spacingMm]), [['SPACED', 150]]);
  const mixed = from('3-DB12 + 3-DB12 @150');
  assert.deepEqual(mixed.map(s => [s.arrangement, s.quantity, s.spacingMm, s.sourceText]), [['UNSPECIFIED', undefined, undefined, '3-DB12 + 3-DB12 @150']]);
  assert.equal(from('').length, 1);
  assert.equal(from('5-DB12', { provenance: undefined })[0].source, 'missing');
  // split sets are blocked until the reviewer gives each a direction
  assert.equal(calc(pair).rebarDetails!.sets!.every(s => s.status === 'BLOCKED'), true);
});

test('RebarSet integration: BOQ totals, Excel rows, engine/export parity, history', () => {
  const sets = [set(), set({ id: 'RS-B', diameterMm: 16, quantity: 4, direction: 'Y' }), set({ id: 'RS-BAD', direction: 'UNSPECIFIED' })];
  const members = [footing(sets), footing([set({ id: 'RS-R' })], { tag: 'F2', review: { status: 'rejected', at: '2026-11-03' } })];
  const project = computeProject(members, 'T', SPECS);
  const f1 = project.items.find(i => i.tag === 'F1')!;
  // BOQ: rejected footing out of the totals; the blocked set adds nothing; diameters stay apart
  assert.equal(f1.rebarWeightKg, Number((4.88 + 4 * 0.8 * 1.578).toFixed(2)));
  assert.equal(project.items.find(i => i.tag === 'F2')!.status, 'REJECTED');

  const wb = buildBoqWorkbook({ ...project, reviewLog: [] });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['ตารางดัด-ตัดเหล็กเสริม'], { header: 1 });
  assert.match(String(rows[0][0]), /ไม่ใช่ BBS สำหรับสั่งตัด/);
  const h = rows[1];
  const col = (r: any[], name: string) => r[h.indexOf(name)];
  const body = rows.slice(2);
  assert.ok(!body.some(r => r[1] === 'F2'));
  const f1rows = body.filter(r => r[1] === 'F1');
  assert.deepEqual(f1rows.map(r => [col(r, 'RebarSet ID'), col(r, 'ทิศ'), col(r, 'สถานะชุด')]),
    [['RS-A', 'X', 'CALCULATED'], ['RS-B', 'Y', 'CALCULATED'], ['RS-BAD', 'ไม่ระบุ', 'BLOCKED']]);
  assert.ok(f1rows.every(r => /ชั่วคราว|คิดไม่ได้/.test(String(col(r, 'ยอด'))))); // F1 is in review: provisional
  assert.equal(col(f1rows[2], 'น้ำหนักรวม (Total Weight กก.)'), 0);
  assert.match(String(col(f1rows[2], 'สมมติฐาน/ข้อสงสัยเหล็ก (ไม่ใช่ค่าจากแบบ)')), /ทิศไม่ระบุ/);
  assert.equal(col(f1rows[0], 'ที่มาของชุด'), 'OCR_EXTRACTED');
  // what the export lists adds up to what the engine (and so the screen) shows
  const exported = f1rows.reduce((a, r) => a + Number(col(r, 'น้ำหนักรวม (Total Weight กก.)')), 0);
  assert.ok(Math.abs(exported - f1.rebarWeightKg!) < 0.011);

  // history: a set edit is logged with readable values and undone exactly
  const before = [footing([set()])];
  const after = [footing([set({ quantity: 6, source: 'reviewer' })])];
  const e = logEntryFor(before, after, [0])!;
  assert.equal(e.changes[0].field, 'rebarSets');
  assert.match(String(e.changes[0].from), /RS-A 5-DB12 X BOTTOM \[drawing\]/);
  assert.match(String(e.changes[0].to), /RS-A 6-DB12 X BOTTOM \[reviewer\]/);
  assert.deepEqual(undoEntry(after, e), before);
  assert.equal(logEntryFor(before, [footing([set()])], [0]), null); // same sets, new array: no entry
});

test('Footing geometry fields: piece count must be a whole number, cover edits recalculate and are logged', () => {
  assert.equal(calc([set()], { count: 2.5 }).status, 'REJECTED');
  assert.equal(calc([set()], { count: 0 }).status, 'REJECTED');
  assert.equal(calc([set()], { count: 3 }).rebarDetails!.sets![0].bars, 15);
  // cover 7.5 cm: X run 1.20 − 0.15 = 1.05 m
  assert.equal(calc([set()], { coveringCm: 7.5 }).rebarDetails!.barList[0].lengthM, 1.05);
  // a cleared field arrives as 0: blocked, never a silent default
  assert.ok(codes(calc([set()], { coveringCm: 0 })).includes('COVER_INVALID:block'));
  const e = logEntryFor([footing([set()])], [footing([set()], { coveringCm: 7.5, count: 2 })], [0])!;
  assert.deepEqual(e.changes.map(c => [c.field, c.from, c.to]), [['count', 1, 2], ['coveringCm', 5, 7.5]]);
});

test('Round 19.1 count: pieces scale every quantity once; bar and set counts touch steel only', () => {
  const one = calc([set({ direction: 'BOTH' })], { count: 1 });
  const two = calc([set({ direction: 'BOTH' })], { count: 2 });
  for (const k of ['volumeNetM3', 'formworkNetM2', 'rebarWeightKg', 'leanConcreteM3', 'sandBeddingM3', 'excavationM3'] as const) {
    assert.ok(Math.abs((two as any)[k] - 2 * (one as any)[k]) < 0.011, k);
  }
  // more bars, or another set: concrete and formwork unchanged, steel up
  const moreBars = calc([set({ direction: 'BOTH', quantity: 7 })], { count: 1 });
  const moreSets = calc([set({ direction: 'BOTH' }), set({ id: 'RS-T', layer: 'TOP', direction: 'BOTH' })], { count: 1 });
  for (const r of [moreBars, moreSets]) {
    assert.equal(r.volumeNetM3, one.volumeNetM3);
    assert.equal(r.formworkNetM2, one.formworkNetM2);
    assert.ok(r.rebarWeightKg! > one.rebarWeightKg!);
  }
  // project totals add item quantities as they are (no second multiplication by count)
  const p = computeProject([footing([set({ direction: 'BOTH' })], { count: 2 })], 'T', SPECS);
  assert.equal(p.items[0].volumeNetM3, Number((2 * 1.2 * 0.9 * 0.3).toFixed(4)));
  assert.equal(p.totalConcreteVolumeM3, p.items[0].volumeNetM3);
});

test('Round 19.1 cover: each source labelled for what it is, no silent default, approvals follow the cover used', () => {
  const base = footing([set({ direction: 'BOTH' })], { coveringCm: undefined });
  const withSrc = (m: ExtractedMember, src: any) => ({ ...m, provenance: { ...m.provenance!, fieldSources: { ...m.provenance!.fieldSources, cover: src } } });
  const run = (r: any) => r.rebarDetails!.barList[0].lengthM; // X run = 1.20 − 2c
  const flag = (r: any, code: string) => r.flags!.find((f: any) => f.code === code)?.severity;

  // from the member's drawing
  const drawn = calculateMember(withSrc({ ...base, coveringCm: 7.5 }, 'drawing'), 1, SPECS);
  assert.deepEqual([drawn.coverM, drawn.coverSource, run(drawn)], [0.075, 'drawing', 1.05]);
  // from the drawing's general notes (even when equal to the code default) and from the project spec
  const notes5 = calculateMember(base, 1, { ...SPECS, coverSources: { footing: 'drawing_notes' } });
  assert.deepEqual([notes5.coverM, notes5.coverSource, flag(notes5, 'COVER_ASSUMED')], [0.05, 'drawing_notes', undefined]);
  const spec = calculateMember(base, 1, { ...SPECS, footingCoveringCm: 6, coverSources: { footing: 'user' } });
  assert.deepEqual([spec.coverM, spec.coverSource, run(spec)], [0.06, 'project_spec', 1.08]);
  // typed by the reviewer: manual, never "drawing", whatever the file type
  const typed = withSrc({ ...base, coverMode: 'MANUAL', coveringCm: 6, provenance: { ...base.provenance!, evidence: [{ page: 1, label: 'dxf', method: 'dxf' }] } }, 'reviewer');
  assert.deepEqual([calculateMember(typed, 1, SPECS).coverM, calculateMember(typed, 1, SPECS).coverSource], [0.06, 'manual']);
  assert.equal(calculateMember({ ...base, coveringCm: 6 }, 1, SPECS).coverSource, 'manual'); // no recorded source: not "drawing"

  // empty: the code default is used but the footing is held, and the label says so
  const none = calculateMember(base, 1, SPECS);
  assert.deepEqual([none.coverM, none.coverSource, flag(none, 'COVER_ASSUMED'), none.status], [0.05, 'default', 'warn', 'NEEDS_REVIEW']);
  // a mode with nothing behind it blocks rather than falling back
  assert.equal(flag(calculateMember({ ...base, coverMode: 'MANUAL' }, 1, SPECS), 'COVER_INVALID'), 'block');
  assert.equal(flag(calculateMember({ ...base, coverMode: 'FROM_DRAWING' }, 1, SPECS), 'COVER_INVALID'), 'block');
  assert.equal(calculateMember({ ...base, coverMode: 'FROM_DRAWING' }, 1, { ...SPECS, footingCoveringCm: 7.5, coverSources: { footing: 'drawing_notes' } }).coverSource, 'drawing_notes');
  // 0, negative, NaN, Infinity: blocked
  for (const v of [0, -2, NaN, Infinity]) {
    const r = calculateMember({ ...base, coverMode: 'MANUAL', coveringCm: v }, 1, SPECS);
    assert.equal(flag(r, 'COVER_INVALID'), 'block', String(v));
    assert.notEqual(r.status, 'AUTO_RELEASE');
  }
  // too large for the section: blocked, no steel counted
  const huge = calculateMember({ ...base, coverMode: 'MANUAL', coveringCm: 16 }, 1, SPECS);
  assert.equal(flag(huge, 'COVER_EXCEEDS_DIMENSION'), 'block');
  assert.equal(huge.rebarWeightKg, 0);

  // changing the cover: the calculation and the history say the same thing
  const a = { ...base, coverMode: 'MANUAL' as const, coveringCm: 5 };
  const b = { ...base, coverMode: 'MANUAL' as const, coveringCm: 7.5 };
  const e = logEntryFor([a], [b], [0])!;
  assert.deepEqual(e.changes.map(c => [c.field, c.from, c.to]), [['coveringCm', 5, 7.5]]);
  assert.deepEqual([run(calculateMember(a, 1, SPECS)), run(calculateMember(b, 1, SPECS))], [1.1, 1.05]);
  assert.deepEqual(logEntryFor([base], [{ ...base, coverMode: 'FROM_PROJECT_SPEC' }], [0])!.changes.map(c => c.field), ['coverMode']);

  // approval: a member cover or mode change voids it; so does a project-spec cover change
  const ok = { ...base, coverMode: 'FROM_PROJECT_SPEC' as const };
  const NOTES = { ...SPECS, coverSources: { footing: 'drawing_notes' as const } };
  const approved = { ...ok, review: approvalFor(ok, undefined, NOTES) };
  assert.equal(calculateMember(approved, 1, NOTES).status, 'AUTO_RELEASE');
  for (const [m, specs] of [[{ ...approved, coverMode: 'MANUAL' as const, coveringCm: 5 }, NOTES], [{ ...approved, coveringCm: 7.5 }, NOTES], [approved, { ...NOTES, footingCoveringCm: 10 }]] as const) {
    const r = calculateMember(m as ExtractedMember, 1, specs as any);
    assert.equal(r.status, 'NEEDS_REVIEW');
    assert.ok(codes(r).includes('APPROVAL_STALE:warn'));
  }
  assert.match(calculateMember(approved, 1, { ...NOTES, footingCoveringCm: 10 }).flags!.find(f => f.code === 'APPROVAL_STALE')!.message, /cover\.cm: 5 → 10/);
});
