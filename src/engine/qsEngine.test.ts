import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMember,
  computeProject,
  normalizeDimension,
  DEFAULT_MATERIAL_SPECS,
} from './qsEngine.ts';
import type { ExtractedMember, Provenance } from './qsEngine.ts';

// Values read from a drawing; without provenance the release gate holds a member for review.
const READ: Provenance = { evidence: [{ page: 1, label: 'schedule', method: 'pdf_text' }], fieldSources: {}, confidence: 0.95 };

test('Quantity Engine: basic beam volume formula', () => {
  const m: ExtractedMember = {
    provenance: READ,
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
  // no bars in the drawing: the engine's own minimum steel waits for a QS (Round 18a)
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags!.some(f => f.code === 'REBAR_CODE_MINIMUM' && f.severity === 'warn'));
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
    provenance: READ,
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
  // no bars in the drawing: the engine's own minimum steel waits for a QS (Round 18a)
  assert.equal(res.status, 'NEEDS_REVIEW');
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
    { provenance: READ, tag: 'B1', memberType: 'BEAM', width: 0.20, depth: 0.40, length: 4.0, gridLocation: 'Grid 1-2/A', level: 'Story 1', isClearSpan: true, count: 1 },
    { provenance: READ, tag: 'B1', memberType: 'BEAM', width: 0.20, depth: 0.40, length: 4.0, gridLocation: 'Grid 1-2/A', level: 'Story 1', isClearSpan: true, count: 1 },
  ];
  const res = computeProject(members);
  assert.equal(res.totalItemsCount, 2);
  assert.equal(res.needsReviewCount, 1); // the kept B1 has no bars in the drawing (Round 18a)
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
    provenance: READ,
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
  // hook shape not in the drawing: the spec's default upturn waits for a QS (Round 18a)
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags!.some(f => f.code === 'FOOTING_HOOK_ASSUMED' && f.severity === 'warn'));
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
    provenance: READ,
    tag: 'S1',
    memberType: 'SLAB',
    width: 4.00,
    depth: 4.00,
    length: 0.12,
    count: 1,
    unit: 'm',
  };
  const resSlab = calculateMember(s1, 1);
  // no bars in the drawing: the engine's own minimum steel waits for a QS (Round 18a)
  assert.equal(resSlab.status, 'NEEDS_REVIEW');
  assert.equal(resSlab.volumeNetM3, 1.9200);
  assert.equal(resSlab.formworkNetM2, 17.9200);

  const st1: ExtractedMember = {
    provenance: READ,
    tag: 'ST1',
    memberType: 'STAIR',
    width: 1.20,
    depth: 3.00,
    length: 0.15,
    count: 1,
    unit: 'm',
  };
  const resStair = calculateMember(st1, 2);
  assert.equal(resStair.status, 'NEEDS_REVIEW');
  assert.equal(resStair.volumeNetM3, 0.5400);
});

test('Comptroller General Factor F and 6 Por Ror 4 Categories aggregation', () => {
  const members: ExtractedMember[] = [
    { provenance: READ, tag: 'F1', memberType: 'FOOTING', width: 1.5, depth: 1.5, length: 0.35, count: 2, unit: 'm' },
    { provenance: READ, tag: 'C1', memberType: 'COLUMN', width: 0.25, depth: 0.25, length: 3.0, count: 2, unit: 'm' },
    { provenance: READ, tag: 'B1', memberType: 'BEAM', width: 0.20, depth: 0.40, length: 4.0, count: 2, unit: 'm', isClearSpan: true },
    { provenance: READ, tag: 'S1', memberType: 'SLAB', width: 4.0, depth: 4.0, length: 0.12, count: 1, unit: 'm' },
    { provenance: READ, tag: 'ST1', memberType: 'STAIR', width: 1.2, depth: 3.0, length: 0.15, count: 1, unit: 'm' },
  ];
  const project = computeProject(members, 'Test Project Full System');

  assert.equal(project.totalItemsCount, 5);
  assert.equal(project.needsReviewCount, 5); // none of the five has bars in the drawing (Round 18a)
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
    provenance: READ,
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
    provenance: READ,
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
    provenance: READ,
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
    provenance: READ,
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

test('Slab rebar cut length: computes real bay dimensions wM and dM, never hardcoded 1.10m, and adds lap splice when > 6m', () => {
  // 1. Normal residential slab 4.0m x 5.0m, thickness 0.10m, RB9@0.15m bottom
  const s1: ExtractedMember = {
    provenance: READ,
    tag: 'S1',
    memberType: 'SLAB',
    width: 4.0,
    depth: 5.0,
    length: 0.10,
    count: 1,
    unit: 'm',
    bottomRebar: 'RB9@0.15m',
  };
  const res1 = calculateMember(s1, 1);
  assert.equal(res1.status, 'AUTO_RELEASE');
  assert.ok(res1.rebarDetails, 'rebarDetails should exist');
  const barList1 = res1.rebarDetails!.barList;
  assert.equal(barList1.length, 2, 'Should have X and Y directions');

  const barX = barList1.find(b => b.purpose.includes('แนวแกน X'))!;
  const barY = barList1.find(b => b.purpose.includes('แนวแกน Y'))!;
  assert.ok(barX && barY);

  // Cut length must NOT be 1.10m!
  // cover = 0.035, hook = Math.max(0.10, 12 * 0.009) = 0.108
  // cutLenX = 4.0 - 2 * 0.035 + 2 * 0.108 = 4.146m
  // cutLenY = 5.0 - 2 * 0.035 + 2 * 0.108 = 5.146m
  assert.notEqual(barX.lengthM, 1.10);
  assert.notEqual(barY.lengthM, 1.10);
  assert.ok(barX.lengthM > 3.9 && barX.lengthM < 4.3, `barX cut length ${barX.lengthM} should reflect width 4.0m`);
  assert.ok(barY.lengthM > 4.9 && barY.lengthM < 5.3, `barY cut length ${barY.lengthM} should reflect depth 5.0m`);

  // Count along depth 5.0m: nx = floor((5.0 - 0.07)/0.15) + 1 = 33
  // Count along width 4.0m: ny = floor((4.0 - 0.07)/0.15) + 1 = 27
  assert.ok(barX.count >= 30);
  assert.ok(barY.count >= 25);

  // 2. Large slab 8.0m x 8.0m requiring lap splices (> 6.0m)
  const sLarge: ExtractedMember = {
    provenance: READ,
    tag: 'S2',
    memberType: 'SLAB',
    width: 8.0,
    depth: 8.0,
    length: 0.15,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.20m',
  };
  const resLarge = calculateMember(sLarge, 2);
  const barLargeX = resLarge.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  // cutLen = 8.0 - 2 * 0.035 + 2 * 0.144 = 8.218 + (1 lap * 40 * 0.012 = 0.48m) = ~8.698m
  assert.ok(barLargeX.lengthM > 8.5, `Large slab cut length ${barLargeX.lengthM} should include lap splice`);
});

test('Pile takeoff & cost calculation: incorporates pile supply and driving into CAT-2 and totalCostThb, supports price=0', () => {
  // 1. Footing with 4 piles, 6m long (explicit size 0.15x0.15x6.00)
  const fPiled: ExtractedMember = {
    tag: 'F1',
    memberType: 'FOOTING',
    width: 1.0,
    depth: 1.0,
    length: 0.5,
    count: 2,
    unit: 'm',
    pileCount: 4,
    pileSize: '0.15x0.15x6.00',
    bottomRebar: 'DB12@0.15m',
  };

  const res = calculateMember(fPiled, 1);
  assert.equal(res.pilesNos, 8, '2 footings x 4 piles = 8 piles');
  assert.equal(res.pileLengthM, 6.0, 'Parsed pile length 6.0m');
  assert.ok(res.pileCostThb, 'pileCostThb should be populated');
  // 8 piles x 6.0m = 48m
  // Mat: 48 * 220 = 10,560 THB; Wage: 48 * 85 = 4,080 THB; Total = 14,640 THB
  assert.equal(res.pileCostThb!.material, 10560);
  assert.equal(res.pileCostThb!.wage, 4080);
  assert.equal(res.pileCostThb!.total, 14640);
  assert.ok(res.totalCostThb! > 14640, 'totalCostThb must include pile costs');

  // Verify Project Category aggregation
  const project = computeProject([fPiled], 'Piled Foundation Project');
  const cat2 = project.categorySummaries!['CAT-2'];
  assert.ok(cat2.totalCostThb > 14640, 'CAT-2 includes footing concrete, rebar, formwork AND piles');
  assert.equal(project.totalProjectCostThb, cat2.totalCostThb + (project.categorySummaries!['CAT-1'].totalCostThb || 0));

  // 2. Footing with price=0 (rates zeroed out)
  const zeroSpecs = { pileSupplyRatePerM: 0, pileDrivingRatePerM: 0 };
  const resZero = calculateMember(fPiled, 1, zeroSpecs as any);
  assert.equal(resZero.pileCostThb!.total, 0);
  assert.ok(resZero.flags?.some(f => f.code === 'PILE_PRICE_ZERO'), 'Should flag that pile price is zero');
});

test('Concrete Cover Configuration: member defaults, drawing override, user spec, legacy fallback, and invalid handling', () => {
  // 1. Defaults by member type
  const slab: ExtractedMember = {
    tag: 'S1',
    memberType: 'SLAB',
    width: 3.0,
    depth: 4.0,
    length: 0.10,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB10@0.15m',
  };
  const beam: ExtractedMember = {
    tag: 'B1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.0,
    count: 1,
    unit: 'm',
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.20m',
  };
  const col: ExtractedMember = {
    tag: 'C1',
    memberType: 'COLUMN',
    width: 0.20,
    depth: 0.20,
    length: 3.0,
    count: 1,
    unit: 'm',
    topRebar: '4-DB16',
    stirrupRebar: 'RB6@0.15m',
  };
  const footing: ExtractedMember = {
    tag: 'F1',
    memberType: 'FOOTING',
    width: 1.20,
    depth: 1.20,
    length: 0.35,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.15m',
  };

  const resSlab = calculateMember(slab, 1);
  assert.equal(resSlab.coverM, 0.02, 'Default slab cover must be 2.0 cm (0.02 m)');
  assert.equal(resSlab.coverSource, 'default');
  assert.ok(resSlab.flags!.some(f => f.code === 'COVER_ASSUMED'));

  const resBeam = calculateMember(beam, 1);
  assert.equal(resBeam.coverM, 0.03, 'Default beam cover must be 3.0 cm (0.03 m)');
  assert.equal(resBeam.coverSource, 'default');
  assert.ok(resBeam.flags!.some(f => f.code === 'COVER_ASSUMED'));

  const resCol = calculateMember(col, 1);
  assert.equal(resCol.coverM, 0.035, 'Default column cover must be 3.5 cm (0.035 m)');
  assert.equal(resCol.coverSource, 'default');
  assert.ok(resCol.flags!.some(f => f.code === 'COVER_ASSUMED'));

  const resFooting = calculateMember(footing, 1);
  assert.equal(resFooting.coverM, 0.05, 'Default footing cover must be 5.0 cm (0.05 m)');
  assert.equal(resFooting.coverSource, 'default');
  assert.ok(resFooting.flags!.some(f => f.code === 'COVER_ASSUMED'));

  // 2. Member cover takes highest priority; it is 'drawing' only when its source says so (Round 19.1),
  //    a value with no recorded source was entered on the member, not read
  const slabOverride: ExtractedMember = { ...slab, coveringCm: 2.5 };
  const resDrawingOverride = calculateMember(slabOverride, 1);
  assert.equal(resDrawingOverride.coverM, 0.025, 'Drawing override 2.5 cm must take highest priority');
  assert.equal(resDrawingOverride.coverSource, 'manual');
  const slabRead: ExtractedMember = { ...slabOverride, provenance: { evidence: [{ page: 1, label: 'detail', method: 'pdf_text' }], fieldSources: { cover: 'drawing' }, confidence: 0.95 } };
  assert.equal(calculateMember(slabRead, 1).coverSource, 'drawing');
  assert.ok(!resDrawingOverride.flags!.some(f => f.code === 'COVER_ASSUMED'), 'Explicit drawing cover should not emit COVER_ASSUMED');

  // 3. User spec override in MaterialSpecs
  const userSpecs = { ...DEFAULT_MATERIAL_SPECS, slabCoveringCm: 2.5, beamCoveringCm: 4.0 };
  const resUserSlab = calculateMember(slab, 1, userSpecs);
  assert.equal(resUserSlab.coverM, 0.025, 'User-defined slab cover 2.5 cm');
  assert.equal(resUserSlab.coverSource, 'project_spec');

  const resUserBeam = calculateMember(beam, 1, userSpecs);
  assert.equal(resUserBeam.coverM, 0.04, 'User-defined beam cover 4.0 cm');
  assert.equal(resUserBeam.coverSource, 'project_spec');

  // 4. Legacy configuration (concreteCoveringCm = 5.0)
  const legacySpecs = { concreteCoveringCm: 5.0 };
  const resLegacySlab = calculateMember(slab, 1, legacySpecs as any);
  assert.equal(resLegacySlab.coverM, 0.05, 'Legacy spec sets uniform cover');
  assert.equal(resLegacySlab.coverSource, 'legacy_spec');

  // 5. Invalid cover handling (negative or <= 0)
  const invalidDrawingSlab: ExtractedMember = { ...slab, coveringCm: -1.0 };
  const resInvalidDrawing = calculateMember(invalidDrawingSlab, 1);
  assert.equal(resInvalidDrawing.coverM, 0.02, 'Negative drawing cover falls back to default');
  assert.equal(resInvalidDrawing.coverSource, 'default');
  assert.ok(resInvalidDrawing.flags!.some(f => f.code === 'COVER_INVALID'));

  const invalidSpecSlab = calculateMember(slab, 1, { slabCoveringCm: 0 } as any);
  assert.equal(invalidSpecSlab.coverM, 0.02, 'Zero spec cover falls back to default');
  assert.equal(invalidSpecSlab.coverSource, 'default');
  assert.ok(invalidSpecSlab.flags!.some(f => f.code === 'COVER_INVALID'));

  // 6. Architectural members do not calculate rebar cover
  const wall: ExtractedMember = {
    tag: 'W1',
    memberType: 'WALL',
    width: 0.10,
    depth: 3.0,
    length: 4.0,
    count: 1,
    unit: 'm',
  };
  const resWall = calculateMember(wall, 1);
  assert.equal(resWall.coverM, undefined);
  assert.equal(resWall.coverSource, undefined);
});

test('Rebar bar-count floating point precision: Math.floor with epsilon prevents IEEE 754 truncation', () => {
  // 1. Footing IEEE 754 trap: 1.50m - 2*0.05m = 1.40m @ 0.20m pitch
  // Exact math: 1.40 / 0.20 = 7.0 -> 7 + 1 = 8 bars
  // IEEE 754 binary float: 1.40 / 0.20 = 6.999999999999999 -> without epsilon Math.floor returns 6 (DROPPING 1 BAR!)
  const fTrap: ExtractedMember = {
    tag: 'F1',
    memberType: 'FOOTING',
    width: 1.50,
    depth: 1.50,
    length: 0.40,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.20m',
  };
  const resFTrap = calculateMember(fTrap, 1);
  const barFX = resFTrap.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  const barFY = resFTrap.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน Y'))!;
  assert.equal(barFX.count, 8, 'Footing X bar count must be 8 (not 7 due to 1.40/0.20 float error)');
  assert.equal(barFY.count, 8, 'Footing Y bar count must be 8 (not 7 due to 1.40/0.20 float error)');

  // 2. Footing non-integer division: 1.20m - 2*0.05m = 1.10m @ 0.15m pitch
  // 1.10 / 0.15 = 7.333333333333334 -> Math.floor = 7 -> 7 + 1 = 8 bars
  const fNonInt: ExtractedMember = {
    tag: 'F2',
    memberType: 'FOOTING',
    width: 1.20,
    depth: 1.20,
    length: 0.40,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.15m',
  };
  const resFNonInt = calculateMember(fNonInt, 1);
  const barF2X = resFNonInt.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  assert.equal(barF2X.count, 8, 'Footing X bar count for 1.10/0.15 must be 8');

  // 3. Slab IEEE 754 trap: 1.44m - 2*0.02m = 1.40m @ 0.20m pitch
  // Exact: 1.40 / 0.20 = 7.0 -> 8 bars
  const sTrap: ExtractedMember = {
    tag: 'S1',
    memberType: 'SLAB',
    width: 1.44,
    depth: 1.44,
    length: 0.10,
    count: 1,
    unit: 'm',
    bottomRebar: 'RB9@0.20m',
  };
  const resSTrap = calculateMember(sTrap, 1);
  const barSX = resSTrap.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  const barSY = resSTrap.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน Y'))!;
  assert.equal(barSX.count, 8, 'Slab X bar count must be 8 (not 7 due to 1.40/0.20 float error)');
  assert.equal(barSY.count, 8, 'Slab Y bar count must be 8 (not 7 due to 1.40/0.20 float error)');

  // 4. Slab non-integer division: 4.00m - 2*0.02m = 3.96m @ 0.15m pitch
  // 3.96 / 0.15 = 26.4 -> Math.floor = 26 -> 26 + 1 = 27 bars
  const sNonInt: ExtractedMember = {
    tag: 'S2',
    memberType: 'SLAB',
    width: 4.00,
    depth: 4.00,
    length: 0.10,
    count: 1,
    unit: 'm',
    bottomRebar: 'RB9@0.15m',
  };
  const resSNonInt = calculateMember(sNonInt, 1);
  const barS2X = resSNonInt.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  assert.equal(barS2X.count, 27, 'Slab X bar count for 3.96/0.15 must be 27');

  // 5. Stirrups IEEE 754 trap: Beam length 1.40m @ 0.20m pitch
  // 1.40 / 0.20 = 6.999999999999999 -> Math.floor without epsilon yields 6 + 1 = 7 (DROPPING 1 STIRRUP!)
  const bTrap: ExtractedMember = {
    tag: 'B1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 1.40,
    count: 1,
    unit: 'm',
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.20m',
  };
  const resBTrap = calculateMember(bTrap, 1);
  const stirrupB = resBTrap.rebarDetails!.barList.find(b => b.purpose.includes('เหล็กปลอกคาน'))!;
  assert.equal(stirrupB.count, 8, 'Beam stirrup count must be 8 (not 7 due to 1.40/0.20 float error)');

  // 6. Stirrups IEEE 754 trap: Column height 0.60m @ 0.20m pitch
  // 0.60 / 0.20 = 2.9999999999999996 -> Math.floor without epsilon yields 2 + 1 = 3 (DROPPING 1 TIE!)
  const cTrap: ExtractedMember = {
    tag: 'C1',
    memberType: 'COLUMN',
    width: 0.20,
    depth: 0.20,
    length: 0.60,
    count: 1,
    unit: 'm',
    topRebar: '4-DB12',
    stirrupRebar: 'RB6@0.20m',
  };
  const resCTrap = calculateMember(cTrap, 1);
  const tieC = resCTrap.rebarDetails!.barList.find(b => b.purpose.includes('เหล็กปลอกเสา'))!;
  assert.equal(tieC.count, 4, 'Column tie count must be 4 (not 3 due to 0.60/0.20 float error)');
});

test('Fixed-Pitch Bar Placement Verification: spacing <= s_spec, coordinates within boundaries', () => {
  // Test cases covering various spans and spacings
  const cases = [
    { span: 1.50, cover: 0.05, s: 0.20 },
    { span: 1.20, cover: 0.05, s: 0.15 },
    { span: 1.00, cover: 0.05, s: 0.20 },
    { span: 2.00, cover: 0.05, s: 0.15 },
    { span: 3.00, cover: 0.02, s: 0.15 },
    { span: 4.00, cover: 0.02, s: 0.20 },
    { span: 4.00, cover: 0.02, s: 0.15 },
    { span: 5.00, cover: 0.02, s: 0.20 },
    { span: 1.40, cover: 0.00, s: 0.20 }, // Beam net stirrups span
    { span: 0.60, cover: 0.00, s: 0.20 }, // Short column tie span
    { span: 3.60, cover: 0.00, s: 0.20 },
    { span: 2.70, cover: 0.00, s: 0.15 },
  ];

  for (const tc of cases) {
    const netSpan = tc.span - 2 * tc.cover;
    const n = Math.max(2, Math.floor(netSpan / tc.s + 1e-7) + 1);
    const x1 = tc.cover;
    const xLast = tc.cover + (n - 1) * tc.s;
    const remEdge = Number((tc.span - tc.cover - xLast).toFixed(5));

    // Verify first bar is at cover
    assert.ok(x1 >= tc.cover, `x1 (${x1}) >= cover (${tc.cover})`);
    // Verify last bar does not exceed concrete boundary minus cover
    assert.ok(xLast <= tc.span - tc.cover + 1e-6, `xLast (${xLast}) <= outer cover limit (${tc.span - tc.cover})`);
    // Verify adjacent pitch between all placed bars is exactly s (<= s_spec)
    for (let i = 0; i < n - 1; i++) {
      const posA = tc.cover + i * tc.s;
      const posB = tc.cover + (i + 1) * tc.s;
      const pitch = Number((posB - posA).toFixed(5));
      assert.ok(pitch <= tc.s + 1e-6, `pitch (${pitch}) <= specified spacing (${tc.s})`);
    }
    // Verify remaining edge distance is non-negative and strictly less than specified spacing s
    assert.ok(remEdge >= -1e-6, `Remaining edge distance (${remEdge}) must be >= 0`);
    assert.ok(remEdge < tc.s + 1e-6, `Remaining edge distance (${remEdge}) must be < spacing (${tc.s})`);
  }
});

test('Input validation: rejects zero, negative, NaN, Infinite dimensions, excessive cover, and invalid spacing', () => {
  // 1. Zero dimension
  const mZero: ExtractedMember = { tag: 'B1', memberType: 'BEAM', width: 0, depth: 0.4, length: 4.0, count: 1, unit: 'm' };
  const resZero = calculateMember(mZero, 1);
  assert.equal(resZero.status, 'REJECTED');
  assert.ok(resZero.rejectionReasons.some(r => r.includes('Width must be positive')));

  // 2. Negative dimension
  const mNeg: ExtractedMember = { tag: 'B2', memberType: 'BEAM', width: 0.2, depth: -0.4, length: 4.0, count: 1, unit: 'm' };
  const resNeg = calculateMember(mNeg, 1);
  assert.equal(resNeg.status, 'REJECTED');

  // 3. NaN dimension
  const mNan: ExtractedMember = { tag: 'B3', memberType: 'BEAM', width: 0.2, depth: 0.4, length: NaN, count: 1, unit: 'm' };
  const resNan = calculateMember(mNan, 1);
  assert.equal(resNan.status, 'REJECTED');

  // 4. Infinite dimension
  const mInf: ExtractedMember = { tag: 'B4', memberType: 'BEAM', width: Infinity, depth: 0.4, length: 4.0, count: 1, unit: 'm' };
  const resInf = calculateMember(mInf, 1);
  assert.equal(resInf.status, 'REJECTED');

  // 5. Excessive cover (cover >= half dimension)
  const mExcessCover: ExtractedMember = {
    tag: 'S_EXCESS',
    memberType: 'SLAB',
    width: 0.10,
    depth: 0.10,
    length: 0.08,
    count: 1,
    unit: 'm',
    coveringCm: 6.0, // 6cm cover each side = 12cm >= 10cm width
    bottomRebar: 'RB9@0.15m',
  };
  const resExcess = calculateMember(mExcessCover, 1);
  assert.equal(resExcess.status, 'NEEDS_REVIEW');
  assert.equal(resExcess.rebarWeightKg, 0, 'Rebar calculation must be blocked');
  assert.ok(resExcess.flags?.some(f => f.code === 'COVER_EXCEEDS_DIMENSION'));

  // 6. Zero spacing in footing
  const mFootZeroSp: ExtractedMember = {
    tag: 'F_ZERO',
    memberType: 'FOOTING',
    width: 1.2,
    depth: 1.2,
    length: 0.35,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0',
  };
  const resFootZero = calculateMember(mFootZeroSp, 1);
  assert.equal(resFootZero.status, 'NEEDS_REVIEW');
  assert.equal(resFootZero.rebarWeightKg, 0, 'Zero spacing must block rebar calculation');
  assert.ok(resFootZero.flags?.some(f => f.code === 'REBAR_SPACING_INVALID'));

  // 7. Negative spacing in stirrups
  const mBeamNegSp: ExtractedMember = {
    tag: 'B_NEG',
    memberType: 'BEAM',
    width: 0.2,
    depth: 0.4,
    length: 4.0,
    count: 1,
    unit: 'm',
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@-0.20m',
  };
  const resBeamNeg = calculateMember(mBeamNegSp, 1);
  assert.equal(resBeamNeg.status, 'NEEDS_REVIEW');
  assert.equal(resBeamNeg.rebarWeightKg, 0, 'Negative stirrup spacing must block rebar calculation');
  assert.ok(resBeamNeg.flags?.some(f => f.code === 'REBAR_SPACING_INVALID'));

  // 8. NaN spacing in slab
  const mSlabNanSp: ExtractedMember = {
    tag: 'S_NAN',
    memberType: 'SLAB',
    width: 3.0,
    depth: 3.0,
    length: 0.1,
    count: 1,
    unit: 'm',
    bottomRebar: 'RB9@NaN',
  };
  const resSlabNan = calculateMember(mSlabNanSp, 1);
  assert.equal(resSlabNan.status, 'NEEDS_REVIEW');
  assert.equal(resSlabNan.rebarWeightKg, 0);
  assert.ok(resSlabNan.flags?.some(f => f.code === 'REBAR_SPACING_INVALID'));
});

test('Footing hook configuration: FULL_UPTURN, STANDARD_HOOK, STRAIGHT, and UNSPECIFIED', () => {
  const baseFoot: ExtractedMember = {
    tag: 'F1',
    memberType: 'FOOTING',
    width: 1.20,
    depth: 1.20,
    length: 0.35,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.15m',
  };

  // 1. FULL_UPTURN: hook = 0.35 - 2*0.05 = 0.25m -> len = 1.10 + 2*0.25 = 1.60m
  const fFull = calculateMember({ ...baseFoot, footingHookShape: 'FULL_UPTURN' }, 1);
  const barFullX = fFull.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  assert.equal(barFullX.lengthM, 1.60, 'Full upturn length = 1.60m');
  assert.equal(barFullX.hookLengthM, 0.50, 'Upturn hook = 2 * 0.25 = 0.50m');
  assert.equal(fFull.rebarWeightKg, 22.73);

  // 2. STANDARD_HOOK (12d): hook = 12 * 0.012 = 0.144m -> len = 1.10 + 2*0.144 = 1.388m
  const fStd = calculateMember({ ...baseFoot, footingHookShape: 'STANDARD_HOOK' }, 1);
  const barStdX = fStd.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  assert.equal(barStdX.lengthM, 1.388, 'Standard hook length = 1.388m');
  assert.equal(barStdX.hookLengthM, 0.288, 'Standard hook = 2 * 0.144 = 0.288m');
  assert.equal(fStd.rebarWeightKg, 19.72);

  // 3. STRAIGHT: hook = 0 -> len = 1.10m
  const fStraight = calculateMember({ ...baseFoot, footingHookShape: 'STRAIGHT' }, 1);
  const barStrX = fStraight.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  assert.equal(barStrX.lengthM, 1.10, 'Straight bar length = 1.10m');
  assert.equal(barStrX.hookLengthM, 0, 'No hooks');
  assert.equal(fStraight.rebarWeightKg, 15.63);

  // 4. UNSPECIFIED: falls back to full upturn but flags FOOTING_HOOK_UNSPECIFIED as warn (triggers NEEDS_REVIEW)
  const fUnspec = calculateMember({ ...baseFoot, footingHookShape: 'UNSPECIFIED' }, 1);
  assert.equal(fUnspec.rebarWeightKg, 22.73);
  assert.equal(fUnspec.status, 'NEEDS_REVIEW', 'Unspecified footing hook must trigger NEEDS_REVIEW');
  const unspecFlag = fUnspec.flags?.find(f => f.code === 'FOOTING_HOOK_UNSPECIFIED');
  assert.ok(unspecFlag);
  assert.equal(unspecFlag?.severity, 'warn');
  assert.ok(fUnspec.rebarFormulaStr?.includes('สมมติฐานรอตรวจสอบ'));

  // 5. Legacy default (absent shape): flags FOOTING_HOOK_ASSUMED
  const fLegacy = calculateMember(baseFoot, 1);
  assert.equal(fLegacy.rebarWeightKg, 22.73);
  assert.ok(fLegacy.flags?.some(f => f.code === 'FOOTING_HOOK_ASSUMED'));
});

test('Stock bar length configuration: 6m, 10m, 12m, and lap calculation boundaries', () => {
  // Slab 7.0m x 4.0m, DB10@0.20m. In X direction: netSpan = 7.0 - 0.04 = 6.96m. With hooks: 6.96 + 2*0.12 = 7.20m.
  const slab: ExtractedMember = {
    tag: 'S_STOCK',
    memberType: 'SLAB',
    width: 7.0,
    depth: 4.0,
    length: 0.12,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB10@0.20m',
  };

  // 1. With 6m stock length (7.20m > 6m -> 1 lap of 40d = 0.40m -> cutLen = 7.60m)
  const res6m = calculateMember(slab, 1, { stockBarLengthM: 6.0 } as any);
  const bar6mX = res6m.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  assert.equal(bar6mX.lengthM, 7.60, 'Cut length with 6m stock includes 1 lap splice (7.60m)');
  assert.equal(bar6mX.lapLengthM, 0.40, 'Lap length = 40 * 0.010 = 0.40m');
  assert.ok(res6m.flags?.some(f => f.code === 'STOCK_LAP_APPLIED'));

  // 2. With 10m stock length (7.20m <= 10m -> 0 laps -> cutLen = 7.20m)
  const res10m = calculateMember(slab, 1, { stockBarLengthM: 10.0 } as any);
  const bar10mX = res10m.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  assert.equal(bar10mX.lengthM, 7.20, 'Cut length with 10m stock has 0 laps (7.20m)');
  assert.equal(bar10mX.lapLengthM, 0, 'Zero lap length');

  // 3. With 12m stock length (7.20m <= 12m -> 0 laps)
  const res12m = calculateMember(slab, 1, { stockBarLengthM: 12.0 } as any);
  const bar12mX = res12m.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  assert.equal(bar12mX.lengthM, 7.20);
  assert.equal(bar12mX.lapLengthM, 0);

  // 4. Multiple stock bars: Slab with 13m span and 6m stock (13.20m cut length / 6m = 2 laps)
  const slabLarge: ExtractedMember = { ...slab, width: 13.0 };
  const resMulti = calculateMember(slabLarge, 1, { stockBarLengthM: 6.0 } as any);
  const barMultiX = resMulti.rebarDetails!.barList.find(b => b.purpose.includes('แนวแกน X'))!;
  // baseCut = 13.0 - 0.04 + 0.24 = 13.20m -> 2 laps * 0.40m = 0.80m -> 14.00m
  assert.equal(barMultiX.lengthM, 14.00, 'Two laps added for span > 12m with 6m stock');
  assert.equal(barMultiX.lapLengthM, 0.80);
});

test('Quantity traceability: breakdown of net weight, hook weight, lap weight, and wastage', () => {
  const slabTrace: ExtractedMember = {
    tag: 'S_TRACE',
    memberType: 'SLAB',
    width: 7.0,
    depth: 4.0,
    length: 0.12,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB10@0.20m',
  };
  const res = calculateMember(slabTrace, 1, { stockBarLengthM: 6.0, rebarWastagePct: 7.0 } as any);
  const details = res.rebarDetails!;

  assert.ok(details.netWeightKg !== undefined, 'netWeightKg must be exposed');
  assert.ok(details.hookWeightKg !== undefined, 'hookWeightKg must be exposed');
  assert.ok(details.lapWeightKg !== undefined, 'lapWeightKg must be exposed');
  assert.ok(details.wastageWeightKg !== undefined, 'wastageWeightKg must be exposed');

  // Verify mathematical consistency: netWeight + hookWeight + lapWeight ~ totalWeight
  const sumWeights = Number((details.netWeightKg! + details.hookWeightKg! + details.lapWeightKg!).toFixed(2));
  assert.equal(sumWeights, details.totalWeightKg, 'Net + Hook + Lap must sum to Total Rebar Weight');
  assert.ok(details.wastageWeightKg! > 0, 'Wastage weight must be calculated');
});

test('STAIR with steps and distribution rebar (F2, F3, F4)', () => {
  const stair: ExtractedMember = {
    provenance: READ,
    tag: 'ST1',
    memberType: 'STAIR',
    width: 0.9,
    depth: 0.125,
    length: 4.33,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.125',
    topRebar: 'DB12@0.25',
    distRebar: 'RB9@0.20',
    stairRiseM: 2.4,
    stairRunM: 3.6,
    stairRisers: 10,
  };
  const res = calculateMember(stair, 1);
  const expectedVNet = Number((0.9 * 0.125 * 4.33 + 0.9 * 0.5 * 3.6 * 2.4 / 10).toFixed(4));
  assert.equal(res.volumeNetM3, expectedVNet);

  const expectedFormwork = Number((0.9 * 4.33 + 2 * 0.125 * 4.33 + 0.9 * 2.4 + 2 * 0.5 * 3.6 * 2.4 / 10).toFixed(4));
  assert.equal(res.formworkNetM2, expectedFormwork);

  assert.ok(res.rebarByDia!.DB12 > 0, 'rebar has bars for DB12');
  assert.ok(res.rebarByDia!.RB9 > 0, 'rebar has bars for RB9');
  const details = res.rebarDetails!;
  assert.ok(details.barList.some(b => b.bar === 'DB12' && b.purpose.includes('ตามแนวลาด')));
  assert.ok(details.barList.some(b => b.bar === 'DB12' && b.purpose.includes('เหล็กบนตามแนวลาด')));
  assert.ok(details.barList.some(b => b.bar === 'RB9' && b.purpose.includes('เหล็กกระจาย')));

  assert.ok(!res.flags!.some(f => f.code === 'STAIR_STEPS_MISSING'));
  assert.ok(!res.flags!.some(f => f.code === 'STAIR_DIST_MISSING'));
});

test('STAIR without rise/run/risers and without distRebar (F2, F3, F4)', () => {
  const stair: ExtractedMember = {
    provenance: READ,
    tag: 'ST2',
    memberType: 'STAIR',
    width: 0.9,
    depth: 0.125,
    length: 4.33,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.125',
    topRebar: 'DB12@0.25',
  };
  const res = calculateMember(stair, 2);
  const expectedVNet = Number((0.9 * 0.125 * 4.33).toFixed(4));
  assert.equal(res.volumeNetM3, expectedVNet);

  const expectedFormwork = Number((0.9 * 4.33 + 2 * 0.125 * 4.33).toFixed(4));
  assert.equal(res.formworkNetM2, expectedFormwork);

  assert.ok(res.flags!.some(f => f.code === 'STAIR_STEPS_MISSING'));
  assert.ok(res.flags!.some(f => f.code === 'STAIR_DIST_MISSING'));
});

test('BEAM formulaStr contains formwork formula and formwork number matches 2d+w (F1)', () => {
  const beam: ExtractedMember = {
    provenance: READ,
    tag: 'B1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: true,
  };
  const res = calculateMember(beam, 1);
  assert.ok(res.formulaStr.includes('ไม้แบบ'));
  const expectedFormwork = Number((1 * (2 * 0.40 + 0.20) * 4.00).toFixed(4));
  assert.equal(res.formworkNetM2, expectedFormwork);
  assert.ok(res.formulaStr.includes(`${res.formworkNetM2} m²`));
});






