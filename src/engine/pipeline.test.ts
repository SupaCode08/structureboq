import test from 'node:test';
import assert from 'node:assert/strict';
import { computeProject, calculateMember, parseBarGroups, parseSpacedBar, approvalFor } from './qsEngine.ts';
import type { ExtractedMember } from './qsEngine.ts';
import { mergeSheetReadings, combineReadings, type SheetReading } from './sheetMerge.ts';
import { compareTakeoffWithBoq } from './boqCompare.ts';

const grid = {
  x: [{ label: '1', offset_m: 0 }, { label: '2', offset_m: 2.7 }, { label: '3', offset_m: 4.2 }],
  y: [{ label: 'A', offset_m: 0 }, { label: 'B', offset_m: 3.6 }],
};

const sheets: SheetReading[] = [
  {
    page: 5, sheet_id: 'S-02', sheet_type: 'footing_plan', sheet_title: 'แปลนฐานรากแผ่', grid,
    instances: [
      { tag: 'F0.90X0.90X0.30,C1', member_type: 'FOOTING', from_grid: 'A/1', box_2d: [100, 100, 150, 150], confidence: 0.95 },
      { tag: 'F1,C1', member_type: 'FOOTING', from_grid: 'A/2', confidence: 0.95 },
    ],
    sections: [],
  },
  {
    page: 6, sheet_id: 'S-03', sheet_type: 'footing_plan', sheet_title: 'แปลนฐานรากเสาเข็ม', grid,
    instances: [{ tag: 'F3,C1', member_type: 'FOOTING', from_grid: 'A/1', confidence: 0.9 }],
    sections: [],
  },
  {
    page: 7, sheet_id: 'S-04', sheet_type: 'framing_plan', level: 'ชั้น 1', grid,
    instances: [
      { tag: 'GB2', member_type: 'BEAM', from_grid: 'A/1', to_grid: 'A/2', length_m: 2.7, confidence: 0.95 },
      { tag: 'GB2', member_type: 'BEAM', from_grid: 'A/2', to_grid: 'A/3', length_m: 1.9, confidence: 0.95 }, // grid says 1.5
      { tag: 'S0', member_type: 'SLAB', from_grid: 'A/1', to_grid: 'B/2', confidence: 0.95 },
      { tag: 'SP', member_type: 'SLAB', from_grid: 'A/1', to_grid: 'B/2', confidence: 0.95 },
    ],
    sections: [],
  },
  {
    page: 8, sheet_type: 'section_detail', instances: [],
    sections: [
      { tag: 'F0.90X0.90X0.30', member_type: 'FOOTING', plan_w_m: 0.9, plan_l_m: 0.9, thickness_m: 0.2, bottom_rebar: '3+3-Ø12', height_m: 1.0, confidence: 0.9 },
      { tag: 'F1', member_type: 'FOOTING', plan_w_m: 0.5, plan_l_m: 0.5, thickness_m: 0.3, height_m: 1.0, confidence: 0.95 },
      { tag: 'GB2', member_type: 'BEAM', width_m: 0.15, depth_m: 0.35, top_rebar: '2-DB12', bottom_rebar: '2-DB12', stirrup: 'RB6@0.15', confidence: 0.95 },
      { tag: 'C1', member_type: 'COLUMN', width_m: 0.2, depth_m: 0.2, main_rebar: '4-DB12', stirrup: 'RB6@0.20', from_level: 'ฐานราก', to_level: 'พื้นชั้นที่ 1', confidence: 0.95 },
      { tag: 'S0', member_type: 'SLAB', thickness_m: 0.1, top_rebar: 'RB6@0.20', evidence: 'S0 หนา 0.10 ถมทรายอัดแน่น', confidence: 0.95 },
      { tag: 'BS1', member_type: 'BEAM', width_m: 0.05, depth_m: 0.15, thickness_m: 0.0032, evidence: 'BS1 = [ -150x50x20x3.2 มม.', confidence: 0.95 },
    ],
  },
  { page: 2, sheet_type: 'building_section', instances: [], sections: [], levels: [{ label: 'ระดับพื้นชั้นล่าง', elevation_m: 0.2 }, { label: 'ระดับดินเดิม', elevation_m: 0 }] },
];

test('Merge: plan instances joined with section details across sheets, with evidence on both', () => {
  const r = mergeSheetReadings(sheets, 'set.pdf', { columnStubHeightM: 1, storeyHeightM: 3, stairWidthM: 0.9, footingVariant: 'แผ่' });
  const gb = r.members.filter(m => m.tag === 'GB2');
  assert.equal(gb.length, 2);
  assert.equal(gb[0].width, 0.15);
  assert.equal(gb[0].length, 2.7);
  assert.equal(gb[0].supportColW1, 0.2); // typical column width from C1
  assert.equal(gb[0].provenance!.evidence.length, 2);
  // span disagreeing with the grid dimension is raised as a conflict, not silently used
  assert.ok(gb[1].provenance!.conflicts!.some(c => c.includes('กริด')));
});

test('Merge: footing variant is chosen and combined "F,C" tags create the column stub', () => {
  const r = mergeSheetReadings(sheets, 'set.pdf', { columnStubHeightM: 1, storeyHeightM: 3, stairWidthM: 0.9, footingVariant: 'แผ่' });
  const footings = r.members.filter(m => m.memberType === 'FOOTING');
  assert.equal(footings.length, 2);         // pile-cap plan (S-03) ignored
  assert.ok(!footings.some(f => f.tag === 'F3'));
  const cols = r.members.filter(m => m.memberType === 'COLUMN');
  assert.equal(cols.length, 2);
  // C1 from footing top (-1.00 + 0.20) up to floor 1 (+0.20) = 1.00 m, from the level marks
  assert.equal(cols[0].length, 1.0);
  assert.equal(cols[0].provenance!.fieldSources.length, 'inferred');
});

test('Merge: footing named F0.90X0.90X0.30 but detail reads 0.20 thick is flagged', () => {
  const r = mergeSheetReadings(sheets, 'set.pdf', { columnStubHeightM: 1, storeyHeightM: 3, stairWidthM: 0.9, footingVariant: 'แผ่' });
  const f = r.members.find(m => m.tag === 'F0.90X0.90X0.30')!;
  // Round 22: a structured conflict with both sources and their pages (plan p6 name vs detail p8), no value chosen
  const c = f.provenance!.fieldConflicts!.find(x => x.field === 'length')!;
  assert.deepEqual(c.sources.map(s => [s.value, s.page]), [[0.3, 5], [0.2, 8]]);
  const res = calculateMember(f, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
});

test('Merge: steel sections are skipped from the concrete takeoff', () => {
  const r = mergeSheetReadings([...sheets, {
    page: 9, sheet_type: 'framing_plan', grid, instances: [{ tag: 'BS1', member_type: 'BEAM', from_grid: 'A/1', to_grid: 'A/2', length_m: 2.7 }], sections: [],
  }], 'set.pdf');
  assert.ok(!r.members.some(m => m.tag === 'BS1'));
  assert.ok(r.skipped.some(s => s.tag === 'BS1'));
});

test('Project: two slab types in the same bay go to review', () => {
  const r = mergeSheetReadings(sheets, 'set.pdf', { columnStubHeightM: 1, storeyHeightM: 3, stairWidthM: 0.9, footingVariant: 'แผ่' });
  const project = computeProject(r.members, 'p');
  const slabs = project.items.filter(i => i.memberType === 'SLAB');
  assert.equal(slabs.length, 2);
  assert.ok(slabs.every(s => s.status === 'NEEDS_REVIEW' && s.flags!.some(f => f.code === 'SLAB_OVERLAP')));
});

test('Engine: member with a dimension missing from the drawing stays in review with zero quantity', () => {
  const m: ExtractedMember = {
    tag: 'C2', memberType: 'COLUMN', width: 0, depth: 0, length: 1,
    provenance: { evidence: [{ page: 1, label: 'plan', method: 'vision' }], fieldSources: { width: 'missing', depth: 'missing', length: 'assumed' }, confidence: 0.9 },
  };
  const r = calculateMember(m, 1);
  assert.equal(r.status, 'NEEDS_REVIEW');
  assert.equal(r.volumeNetM3, 0);
  assert.ok(r.flags!.some(f => f.code === 'FIELD_MISSING'));
  // filled in but the fields not settled one by one -> approval alone does not release (Round 18c)
  const typedOnly = { ...m, width: 0.2, depth: 0.2 };
  assert.equal(calculateMember({ ...typedOnly, review: approvalFor(typedOnly) }, 1).status, 'NEEDS_REVIEW');
  // reviewer types width/depth and the bars, confirms the assumed height (as the review screen records it), then approves -> counted
  const filled = { ...typedOnly, topRebar: '4-DB12', stirrupRebar: 'RB6@0.15', provenance: { ...m.provenance!, fieldSources: { width: 'reviewer', depth: 'reviewer', length: 'reviewer', rebar: 'reviewer', stirrup: 'reviewer' } as const } };
  const fixed = calculateMember({ ...filled, review: approvalFor(filled) }, 1);
  assert.equal(fixed.status, 'AUTO_RELEASE');
  assert.equal(fixed.volumeNetM3, 0.04);
});

test('Engine: reviewer rejection removes the item from totals', () => {
  const m: ExtractedMember = { tag: 'B1', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 4, isClearSpan: true };
  const p = computeProject([m, { ...m, gridLocation: 'x', review: { status: 'rejected', at: 'now' } }]);
  assert.equal(p.totalConcreteVolumeM3, 0.32);
  assert.equal(p.rejectedCount, 1);
});

test('ปร.4: footing cost is split between หมวด 1 (earthwork) and หมวด 2 without double counting', () => {
  const members: ExtractedMember[] = [
    { tag: 'F1', memberType: 'FOOTING', width: 1.5, depth: 1.5, length: 0.35, count: 2 },
    { tag: 'B1', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 4, isClearSpan: true },
  ];
  const p = computeProject(members);
  const cats = Object.values(p.categorySummaries!);
  const sum = cats.reduce((a, c) => a + c.totalCostThb, 0);
  assert.ok(Math.abs(sum - p.totalProjectCostThb!) < 0.05, `categories ${sum} vs total ${p.totalProjectCostThb}`);
  assert.ok(p.categorySummaries!['CAT-1'].totalCostThb > 0);
  assert.ok(p.categorySummaries!['CAT-2'].totalCostThb > 0);
});

test('Rebar spec parsing: groups, footing a+b and spaced bars', () => {
  assert.deepEqual(parseBarGroups('2-DB16+2-DB12'), [{ n: 2, bar: 'DB16' }, { n: 2, bar: 'DB12' }]);
  assert.deepEqual(parseBarGroups('3+3-Ø12'), [{ n: 3, bar: 'DB12' }, { n: 3, bar: 'DB12' }]);
  assert.deepEqual(parseSpacedBar('RB6@0.15m'), { bar: 'RB6', spacing: 0.15 });
  assert.deepEqual(parseSpacedBar('Ø9 มม.@25cm'), { bar: 'RB9', spacing: 0.25 });
});

test('BOQ compare: per-key verdicts with integer-rounded BOQ tolerance', () => {
  const p = computeProject([
    { tag: 'B1', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 4, count: 10, isClearSpan: true, topRebar: '2-DB12', bottomRebar: '2-DB12', stirrupRebar: 'RB6@0.15' },
  ]);
  const src = (q: number) => [{ page: 1, bbox: [0, 0, 1, 1], text: 'x', quantity: q, unit: 'u' }];
  const rep = compareTakeoffWithBoq(p, {
    structural_concrete_m3: { quantity: 2.9, unit: 'ลบ.ม.', sources: src(2.9) }, // system 3.2 -> +10.3%
    formwork_m2: { quantity: 40, unit: 'ตร.ม.', sources: src(40) },              // system 40
    excavation_m3: { quantity: 5, unit: 'ลบ.ม.', sources: src(5) },               // system has none
  });
  const by = Object.fromEntries(rep.rows.map(r => [r.key, r]));
  assert.equal(by.formwork_m2.verdict, 'match');
  assert.equal(by.structural_concrete_m3.verdict, 'close');
  assert.equal(by.excavation_m3.verdict, 'missing_in_takeoff');
  assert.equal(rep.boqRoundedToInteger, false);
  // Integer-rounded BOQ: 2.3 vs 3 is inside ceil band (2 < 2.3 <= 3); 3.2 vs 3 cannot round up to 3
  const p23 = computeProject([
    { tag: 'B1', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 2.875, count: 10, isClearSpan: true, topRebar: '2-DB12', bottomRebar: '2-DB12', stirrupRebar: 'RB6@0.15' },
  ]);
  const rounded = compareTakeoffWithBoq(p23, { structural_concrete_m3: { quantity: 3, unit: 'ลบ.ม.', sources: src(3) } });
  assert.equal(rounded.rows.find(r => r.key === 'structural_concrete_m3')!.verdict, 'rounding');
  const notRounded = compareTakeoffWithBoq(p, { structural_concrete_m3: { quantity: 3, unit: 'ลบ.ม.', sources: src(3) } });
  assert.notEqual(notRounded.rows.find(r => r.key === 'structural_concrete_m3')!.verdict, 'rounding');
});

test('Vision self-consistency: members seen by only one pass are kept with lower confidence', () => {
  const a: SheetReading = { page: 3, sheet_type: 'framing_plan', grid, sections: [], instances: [
    { tag: 'B2', member_type: 'BEAM', from_grid: 'A/1', to_grid: 'A/2', length_m: 2.7, confidence: 0.9, level: 'ชั้นล่าง' },
    { tag: 'S1', member_type: 'SLAB', confidence: 0.9, level: 'ชั้นล่าง' },
  ] };
  const b: SheetReading = { page: 3, sheet_type: 'framing_plan', grid, sections: [], instances: [
    { tag: 'B2', member_type: 'BEAM', from_grid: 'A/1', to_grid: 'A/2', length_m: 2.7, confidence: 0.9, level: 'ชั้นล่าง' },
    { tag: 'S1', member_type: 'SLAB', from_grid: 'A/1', to_grid: 'B/2', confidence: 0.9, level: 'ชั้นล่าง' },
    { tag: 'BX', member_type: 'BEAM', length_m: 1.2, confidence: 0.9, level: 'ชั้นล่าง' },
  ] };
  const c = combineReadings([a, b]);
  const b2 = c.instances.filter(i => i.tag === 'B2');
  assert.equal(b2.length, 1);
  assert.equal(b2[0].confidence, 0.9);                       // both passes agree
  const s1 = c.instances.filter(i => i.tag === 'S1');
  assert.equal(s1.length, 1);                                // un-located duplicate dropped
  assert.equal(s1[0].to_grid, 'B/2');
  assert.ok(c.instances.find(i => i.tag === 'BX')!.confidence! < 0.9); // seen once
});

test('Completeness: section details never placed on a plan are reported as possible omissions', () => {
  const r = mergeSheetReadings([...sheets, {
    page: 10, sheet_type: 'section_detail', instances: [],
    sections: [{ tag: 'B3X', member_type: 'BEAM', width_m: 0.2, depth_m: 0.4, confidence: 0.9 }],
  }], 'set.pdf', { columnStubHeightM: 1, storeyHeightM: 3, stairWidthM: 0.9, footingVariant: 'แผ่' });
  assert.ok(r.completeness.some(c => c.message.includes('B3X')));
  const s = r.completeness.find(c => c.message.includes('B3X'))!.suggested[0];
  assert.equal(s.width, 0.2);
  assert.equal(s.provenance!.fieldSources.length, 'missing');
  assert.ok(!r.completeness.some(c => c.message.includes('GB2')));
});
