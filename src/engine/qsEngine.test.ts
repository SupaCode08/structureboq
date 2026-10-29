import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMember,
  computeProject,
  normalizeDimension,
  DEFAULT_MATERIAL_SPECS,
} from './qsEngine.ts';
import type { ExtractedMember } from './qsEngine.ts';

test('Quantity Engine: basic beam volume formula', () => {
  const m: ExtractedMember = {
    tag: 'B1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: true,
  };
  const res = calculateMember(m, 1);
  assert.equal(res.status, 'AUTO_RELEASE');
  assert.equal(res.volumeNetM3, 0.3200);
  assert.equal(res.formworkNetM2, 4.0000);
  assert.ok(res.formulaStr.includes('1 × 0.200m(w) × 0.400m(d) × 4.000m(L_net)'));
});

test('Quantity Engine: unit normalization for mm, cm, m', () => {
  assert.equal(normalizeDimension(200, 'mm'), 0.20);
  assert.equal(normalizeDimension(450, 'mm'), 0.45);
  assert.equal(normalizeDimension(25, 'cm'), 0.25);
  assert.equal(normalizeDimension(50, 'cm'), 0.50);
  assert.equal(normalizeDimension(200), 0.20);
  assert.equal(normalizeDimension(0.20), 0.20);
});

test('Quantity Engine: column joint intersection deduction', () => {
  const m: ExtractedMember = {
    tag: 'B2',
    memberType: 'BEAM',
    width: 0.25,
    depth: 0.50,
    length: 5.00,
    count: 2,
    supportColW1: 0.30,
    supportColW2: 0.30,
    isClearSpan: false,
  };
  const res = calculateMember(m, 2);
  assert.equal(res.status, 'AUTO_RELEASE');
  assert.equal(res.deductionM, 0.30);
  assert.equal(res.lengthNetM, 4.70);
  assert.equal(res.volumeNetM3, 1.1750);
  assert.equal(res.deductions.length, 1);
  assert.equal(res.deductions[0].ruleName, 'COLUMN_JOINT_INTERSECTION');
});

test('Quantity Engine: zero and negative dimensions rejected', () => {
  const zeroW: ExtractedMember = { tag: 'B_ERR1', memberType: 'BEAM', width: 0, depth: 0.4, length: 4 };
  const negD: ExtractedMember = { tag: 'B_ERR2', memberType: 'BEAM', width: 0.2, depth: -0.4, length: 4 };
  const negL: ExtractedMember = { tag: 'B_ERR3', memberType: 'BEAM', width: 0.2, depth: 0.4, length: -2 };

  const r1 = calculateMember(zeroW, 1);
  const r2 = calculateMember(negD, 2);
  const r3 = calculateMember(negL, 3);

  assert.equal(r1.status, 'REJECTED');
  assert.equal(r2.status, 'REJECTED');
  assert.equal(r3.status, 'REJECTED');
  assert.equal(r1.volumeNetM3, 0);
});

test('Quantity Engine: high aspect ratio triggers NEEDS_REVIEW', () => {
  const deepBeam: ExtractedMember = {
    tag: 'TB1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 1.60,
    length: 8.0,
    isClearSpan: true,
  };
  const res = calculateMember(deepBeam, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.reviewWarnings.some(w => w.includes('aspect ratio')));
});

test('Quantity Engine: duplicate entity detection rejects collision', () => {
  const members: ExtractedMember[] = [
    { tag: 'B1', memberType: 'BEAM', width: 0.20, depth: 0.40, length: 4.0, gridLocation: 'Grid 1-2/A', level: 'Story 1', isClearSpan: true, count: 1 },
    { tag: 'B1', memberType: 'BEAM', width: 0.20, depth: 0.40, length: 4.0, gridLocation: 'Grid 1-2/A', level: 'Story 1', isClearSpan: true, count: 1 },
  ];
  const res = computeProject(members);
  assert.equal(res.totalItemsCount, 2);
  assert.equal(res.autoReleaseCount, 1);
  assert.equal(res.rejectedCount, 1);
  assert.ok(res.items[1].rejectionReasons[0].includes('Duplicate entity detected'));
});

test('Material Specs: custom rates, wastage, and covering recalculation', () => {
  const m: ExtractedMember = {
    tag: 'B10',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.50,
    length: 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: true,
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.20m',
  };

  const baseRes = calculateMember(m, 1, {
    ...DEFAULT_MATERIAL_SPECS,
    concreteGrade: '240 ksc',
    concreteMatRate: 2000,
    concreteLaborRate: 400,
    concreteWastagePct: 0,
    formworkType: 'ไม้แบบ',
    formworkMatRate: 300,
    formworkLaborRate: 100,
    formworkWastagePct: 0,
    mainRebarGrade: 'SD40',
    mainRebarMatRate: 30,
    mainRebarLaborRate: 5,
    stirrupGrade: 'SR24',
    stirrupMatRate: 30,
    stirrupLaborRate: 5,
    rebarWastagePct: 0,
    concreteCoveringCm: 3.5,
  });

  const customSpecs = {
    ...DEFAULT_MATERIAL_SPECS,
    concreteGrade: '350 ksc',
    concreteMatRate: 3000,
    concreteLaborRate: 500,
    concreteWastagePct: 10,
    formworkType: 'ไม้แบบเหล็ก',
    formworkMatRate: 400,
    formworkLaborRate: 200,
    formworkWastagePct: 10,
    mainRebarGrade: 'SD50',
    mainRebarMatRate: 40,
    mainRebarLaborRate: 8,
    stirrupGrade: 'SD40',
    stirrupMatRate: 40,
    stirrupLaborRate: 8,
    rebarWastagePct: 10,
    concreteCoveringCm: 5.0,
  };

  const customRes = calculateMember(m, 1, customSpecs);

  assert.equal(baseRes.volumeNetM3, 0.4000);
  assert.equal(customRes.volumeNetM3, 0.4000);
  assert.ok(customRes.totalCostThb! > baseRes.totalCostThb!);
  assert.ok(customRes.rebarWeightKg! < baseRes.rebarWeightKg!);
});

test('Full Structural System: Footing with lean concrete, sand bedding & excavation', () => {
  const f1: ExtractedMember = {
    tag: 'F1',
    memberType: 'FOOTING',
    width: 1.50,
    depth: 1.50,
    length: 0.35,
    count: 2,
    unit: 'm',
    bottomRebar: 'DB16@0.15m',
    excavationDepthM: 1.50,
  };
  const res = calculateMember(f1, 1);
  assert.equal(res.status, 'AUTO_RELEASE');
  assert.equal(res.volumeNetM3, 1.5750);
  assert.equal(res.formworkNetM2, 4.2000);
  assert.equal(res.leanConcreteM3, 0.2890);
  assert.equal(res.sandBeddingM3, 0.2890);
  assert.equal(res.excavationM3, 8.6700);
  const bulked = calculateMember(f1, 1, { ...DEFAULT_MATERIAL_SPECS, excavationMarginM: 0.20, excavationBulkingFactor: 1.20 });
  assert.equal(bulked.excavationM3, 12.9960);
  assert.ok(res.rebarWeightKg! > 0);
  assert.ok(res.totalCostThb! > 0);
});

test('Full Structural System: Slabs and Stairs', () => {
  const s1: ExtractedMember = {
    tag: 'S1',
    memberType: 'SLAB',
    width: 4.00,
    depth: 4.00,
    length: 0.12,
    count: 1,
    unit: 'm',
  };
  const resSlab = calculateMember(s1, 1);
  assert.equal(resSlab.status, 'AUTO_RELEASE');
  assert.equal(resSlab.volumeNetM3, 1.9200);
  assert.equal(resSlab.formworkNetM2, 17.9200);

  const st1: ExtractedMember = {
    tag: 'ST1',
    memberType: 'STAIR',
    width: 1.20,
    depth: 3.00,
    length: 0.15,
    count: 1,
    unit: 'm',
  };
  const resStair = calculateMember(st1, 2);
  assert.equal(resStair.status, 'AUTO_RELEASE');
  assert.equal(resStair.volumeNetM3, 0.5400);
});

test('Comptroller General Factor F and 6 Por Ror 4 Categories aggregation', () => {
  const members: ExtractedMember[] = [
    { tag: 'F1', memberType: 'FOOTING', width: 1.5, depth: 1.5, length: 0.35, count: 2, unit: 'm' },
    { tag: 'C1', memberType: 'COLUMN', width: 0.25, depth: 0.25, length: 3.0, count: 2, unit: 'm' },
    { tag: 'B1', memberType: 'BEAM', width: 0.20, depth: 0.40, length: 4.0, count: 2, unit: 'm', isClearSpan: true },
    { tag: 'S1', memberType: 'SLAB', width: 4.0, depth: 4.0, length: 0.12, count: 1, unit: 'm' },
    { tag: 'ST1', memberType: 'STAIR', width: 1.2, depth: 3.0, length: 0.15, count: 1, unit: 'm' },
  ];
  const project = computeProject(members, 'Test Project Full System');

  assert.equal(project.totalItemsCount, 5);
  assert.equal(project.autoReleaseCount, 5);
  assert.ok(project.factorF! > 1.20);
  assert.ok(project.totalCostWithFactorF! > project.totalProjectCostThb!);

  const cats = project.categorySummaries!;
  assert.ok(cats['CAT-1']);
  assert.ok(cats['CAT-2']);
  assert.ok(cats['CAT-3']);
  assert.ok(cats['CAT-4']);
  assert.ok(cats['CAT-5']);
  assert.ok(cats['CAT-6']);
  assert.equal(cats['CAT-3'].itemCount, 1);
  assert.equal(cats['CAT-4'].itemCount, 1);
  assert.equal(cats['CAT-5'].itemCount, 1);
  assert.equal(cats['CAT-6'].itemCount, 1);
});

test('Ties set in pairs ("2-RB6@0.10") double the tie steel, main bars unchanged', () => {
  const stub: ExtractedMember = {
    tag: 'C1', memberType: 'COLUMN', width: 0.30, depth: 0.90, length: 1.5, count: 4, unit: 'm',
    topRebar: '12-DB20', stirrupRebar: 'RB6@0.10',
  };
  const single = calculateMember(stub, 1);
  const paired = calculateMember({ ...stub, stirrupSets: 2 }, 1);
  assert.ok(single.rebarByDia!.RB6 > 0);
  assert.equal(paired.rebarByDia!.RB6.toFixed(3), (2 * single.rebarByDia!.RB6).toFixed(3));
  assert.equal(paired.rebarByDia!.DB20, single.rebarByDia!.DB20);
  assert.ok(paired.rebarFormulaStr!.includes('2-RB6@0.1'));
});

test('No bars in the drawing: code minimum from the section, flagged; bars read from the drawing are used as they are', () => {
  const col: ExtractedMember = { tag: 'C1', memberType: 'COLUMN', width: 0.30, depth: 0.90, length: 3, count: 1, unit: 'm' };
  const c = calculateMember(col, 1);
  assert.ok(c.rebarFormulaStr!.includes('14-DB16'));
  assert.ok(c.flags!.some(f => f.code === 'REBAR_CODE_MINIMUM'));
  assert.ok(c.rebarFormulaStr!.includes('RB6@0.25'));

  const beam: ExtractedMember = { tag: 'B1', memberType: 'BEAM', width: 0.20, depth: 0.40, length: 4, count: 1, unit: 'm', isClearSpan: true };
  const b = calculateMember(beam, 1);
  assert.ok(b.rebarFormulaStr!.includes('2-DB12 + 3-DB12'));
  assert.ok(b.rebarFormulaStr!.includes('RB6@0.175'));

  const read = calculateMember({ ...beam, topRebar: '2-DB16', bottomRebar: '3-DB16', stirrupRebar: 'RB6@0.15' }, 1);
  assert.ok(!read.flags!.some(f => f.code === 'REBAR_CODE_MINIMUM'));
  assert.ok(read.rebarFormulaStr!.includes('3-DB16'));
});

test('piles: footing count x piles per footing, kept when the cap thickness is unread', () => {
  const capped: ExtractedMember = { tag: 'F1', memberType: 'FOOTING', width: 0.95, depth: 0.95, length: 0.2, count: 3, pileCount: 4, unit: 'm' };
  const unread: ExtractedMember = { tag: 'F2', memberType: 'FOOTING', width: 0.95, depth: 0.95, length: 0, count: 2, pileCount: 2, unit: 'm' };
  assert.equal(calculateMember(capped, 1).pilesNos, 12);
  assert.equal(calculateMember(unread, 2).pilesNos, 4);
});

test('Architectural Elements: Wall, Door, Window, Finish calculations', () => {
  // WALL: length 10m, height 3m, thickness 0.10m
  const wall: ExtractedMember = {
    tag: 'WALL-1',
    memberType: 'WALL',
    length: 10.0,
    depth: 3.0, // height
    width: 0.10, // thickness
    count: 1,
    unit: 'm',
  };
  const wallRes = calculateMember(wall, 1);
  assert.equal(wallRes.status, 'AUTO_RELEASE');
  assert.equal(wallRes.volumeNetM3, 3.0); // 10 * 3 * 0.1
  assert.equal(wallRes.wallAreaM2, 30.0); // 10 * 3 = 30 m2
  assert.equal(wallRes.plasterAreaM2, 60.0); // 2 sides plaster: 2 * 30 = 60 m2

  // DOOR: count 5, width 0.9m, height 2.0m
  const door: ExtractedMember = {
    tag: 'D1',
    memberType: 'DOOR',
    width: 0.9,
    depth: 2.0,
    length: 1.0,
    count: 5,
    unit: 'm',
  };
  const doorRes = calculateMember(door, 2);
  assert.equal(doorRes.status, 'AUTO_RELEASE');
  assert.equal(doorRes.openingsCount, 5);

  // WINDOW: count 4, width 1.2m, height 1.1m
  const win: ExtractedMember = {
    tag: 'W1',
    memberType: 'WINDOW',
    width: 1.2,
    depth: 1.1,
    length: 1.0,
    count: 4,
    unit: 'm',
  };
  const winRes = calculateMember(win, 3);
  assert.equal(winRes.status, 'AUTO_RELEASE');
  assert.equal(winRes.openingsCount, 4);

  // FINISH: floor tiling 10m x 5m
  const finish: ExtractedMember = {
    tag: 'F-TILE',
    memberType: 'FINISH',
    width: 10.0,
    depth: 5.0,
    length: 0.05,
    count: 1,
    unit: 'm',
  };
  const finishRes = calculateMember(finish, 4);
  assert.equal(finishRes.status, 'AUTO_RELEASE');
  assert.equal(finishRes.volumeNetM3, 2.5); // 10 * 5 * 0.05 = 2.5 m3
});

test('Detailed Rebar: Bar Cut List, Grade breakdown, and 2.5% Binding Wire (Thai Civil Standards)', () => {
  const beam: ExtractedMember = {
    tag: 'B1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 2,
    isClearSpan: true,
    topRebar: '2-DB16',
    bottomRebar: '3-DB16',
    stirrupRebar: 'RB6@0.15',
  };

  const res = calculateMember(beam, 1);
  assert.ok(res.rebarDetails, 'rebarDetails should be populated');
  const details = res.rebarDetails!;

  // Check barList
  assert.ok(details.barList.length >= 3, 'Should contain top, bottom, and stirrup bars');
  const topBars = details.barList.find(b => b.purpose.includes('เหล็กบนคาน'));
  assert.ok(topBars);
  assert.equal(topBars!.diaMm, 16);
  assert.equal(topBars!.count, 4); // 2 bars * 2 beams

  const stirrups = details.barList.find(b => b.purpose.includes('เหล็กปลอกคาน'));
  assert.ok(stirrups);
  assert.equal(stirrups!.diaMm, 6);
  assert.equal(stirrups!.grade, 'SR24'); // RB is always SR24 in Thai civil specs

  // Check binding wire: exactly 2.5% of total steel weight
  const expectedWire = Math.round((details.totalWeightKg * 0.025) * 100) / 100;
  assert.equal(details.bindingWireKg, expectedWire);

  // Check grade breakdown
  assert.ok(details.byGrade.sd40Kg > 0);
  assert.ok(details.byGrade.sr24Kg > 0);
  assert.equal(details.byGrade.sd30Kg, 0);
  assert.equal(
    Math.round((details.byGrade.sd40Kg + details.byGrade.sr24Kg) * 100) / 100,
    Math.round(details.totalWeightKg * 100) / 100
  );
});

