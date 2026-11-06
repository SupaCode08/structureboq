/**
 * StructBOQ - Release Gate & Provenance Integrity Verification Test Suite (Round 12)
 *
 * Simulates 12 required production release decision scenarios:
 * 1. Missing provenance record (UNKNOWN)
 * 2. OCR-only dimensions
 * 3. User-confirmed dimensions
 * 4. Assumed beam span
 * 5. Assumed column height
 * 6. Unverified 40d column lap splice
 * 7. Unverified slab bent-up bars / cast-in-place without top negative bars
 * 8. Unspecified footing hook
 * 9. Missing concrete cover
 * 10. Invalid rebar spacing (@0, @-0.15, @NaN)
 * 11. Multiple simultaneous engineering warnings
 * 12. High confidence (99%) but critical engineering flag active
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMember,
  classifyProvenanceLevel,
  DEFAULT_MATERIAL_SPECS,
  REQUIRED_SPECS,
  approvalFor,
  fieldsApprovalCannotCover,
  unconfirmedRequiredFields,
  type ExtractedMember,
} from './qsEngine.ts';

test('Round 12 Scenario 1: Missing provenance record defaults to UNKNOWN provenance level and flags audit trace', () => {
  const member: ExtractedMember = {
    tag: 'B1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: true,
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
    // provenance omitted
  };
  const res = calculateMember(member, 1);
  assert.equal(res.provenanceLevel, 'UNKNOWN');
  assert.ok(res.flags?.some(f => f.code === 'PROVENANCE_UNSPECIFIED' && f.severity === 'warn'));
  // Round 17: a member with no record of where its values came from must never auto-release
  assert.equal(res.status, 'NEEDS_REVIEW');
  // ...until a QS approves it
  assert.equal(calculateMember({ ...member, review: approvalFor(member) }, 1).status, 'AUTO_RELEASE');
});

test('Round 12 Scenario 2: OCR-only dimensions are classified as OCR_EXTRACTED', () => {
  const member: ExtractedMember = {
    tag: 'B1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: true,
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 1, method: 'vision', label: 'OCR schedule' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing' },
      confidence: 0.92,
    },
  };
  const res = calculateMember(member, 1);
  assert.equal(res.provenanceLevel, 'OCR_EXTRACTED');
  assert.equal(res.status, 'AUTO_RELEASE');
});

test('Round 12 Scenario 3: User-confirmed dimensions allow release and report USER_CONFIRMED', () => {
  const member: ExtractedMember = {
    tag: 'C1',
    memberType: 'COLUMN',
    width: 0.20,
    depth: 0.20,
    length: 3.00,
    count: 1,
    unit: 'm',
    topRebar: '4-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 2, method: 'pdf_text', label: 'Column schedule' }],
      fieldSources: { width: 'reviewer', depth: 'reviewer', length: 'reviewer' },
      confidence: 0.95,
    },
  };
  const res = calculateMember({ ...member, review: approvalFor(member, 'QS Verified on site drawing') }, 1);
  assert.equal(res.provenanceLevel, 'USER_CONFIRMED');
  assert.equal(res.status, 'AUTO_RELEASE');
  assert.ok(res.confidenceBasis.includes('ผู้ตรวจยืนยันแล้ว'));
});

test('Round 12 Scenario 4: Assumed beam span triggers FIELD_ASSUMED and forces NEEDS_REVIEW', () => {
  const member: ExtractedMember = {
    tag: 'B2',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: true,
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 3, method: 'vision', label: 'Plan' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'assumed' },
      confidence: 0.85,
    },
  };
  const res = calculateMember(member, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags?.some(f => f.code === 'FIELD_ASSUMED' && f.field === 'length'));
  assert.ok(res.reviewWarnings.some(w => w.includes('ใช้ค่าสมมติ')));
});

test('Round 12 Scenario 5: Assumed column height triggers FIELD_ASSUMED and forces NEEDS_REVIEW', () => {
  const member: ExtractedMember = {
    tag: 'C2',
    memberType: 'COLUMN',
    width: 0.25,
    depth: 0.25,
    length: 3.50,
    count: 1,
    unit: 'm',
    topRebar: '4-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 4, method: 'vision', label: 'Stub' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'assumed' },
      confidence: 0.88,
    },
  };
  const res = calculateMember(member, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags?.some(f => f.code === 'FIELD_ASSUMED' && f.field === 'length'));
});

test('Round 12 Scenario 6: Column with assumed beam support or inferred height cannot silently release without review', () => {
  const beamWithAssumedSupport: ExtractedMember = {
    tag: 'B3',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    supportColW1: 0.25,
    supportColW2: 0.25,
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 5, method: 'dxf', label: 'CAD Beam' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', support: 'assumed' },
      confidence: 0.90,
    },
  };
  const res = calculateMember(beamWithAssumedSupport, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags?.some(f => f.code === 'BEAM_SUPPORT_ASSUMED'));
});

test('Round 12 Scenario 7: Unverified slab rebar ratio defaulted triggers REBAR_DEFAULTED and forces NEEDS_REVIEW', () => {
  const member: ExtractedMember = {
    tag: 'S1',
    memberType: 'SLAB',
    width: 4.00,
    depth: 3.00,
    length: 0.10,
    count: 1,
    unit: 'm',
    // Missing rebar detail in drawing
    provenance: {
      evidence: [{ page: 6, method: 'pdf_text', label: 'Slab schedule' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', rebar: 'missing' },
      confidence: 0.85,
    },
  };
  const res = calculateMember(member, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags?.some(f => f.code === 'REBAR_DEFAULTED'));
  assert.ok(res.flags?.some(f => f.code === 'REBAR_RATIO_ASSUMED'));
});

test('Round 12 Scenario 8: Unspecified footing hook forces NEEDS_REVIEW (FOOTING_HOOK_UNSPECIFIED)', () => {
  const member: ExtractedMember = {
    tag: 'F1',
    memberType: 'FOOTING',
    width: 1.20,
    depth: 1.20,
    length: 0.35,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.15m',
    footingHookShape: 'UNSPECIFIED',
    provenance: {
      evidence: [{ page: 7, method: 'vision', label: 'Footing schedule' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing' },
      confidence: 0.95,
    },
  };
  const res = calculateMember(member, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags?.some(f => f.code === 'FOOTING_HOOK_UNSPECIFIED'));
});

test('Round 12 Scenario 9: Missing or zero concrete cover falls back with audit flag and invalid cover warns', () => {
  const memberZeroCover: ExtractedMember = {
    tag: 'B4',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: true,
    coveringCm: -2.0, // Invalid negative cover
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 8, method: 'vision', label: 'Beam schedule' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing' },
      confidence: 0.90,
    },
  };
  const res = calculateMember(memberZeroCover, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags?.some(f => f.code === 'COVER_INVALID'));
});

test('Round 12 Scenario 10: Invalid rebar spacing (@0, @-0.15, @NaN) blocks calculation and forces NEEDS_REVIEW', () => {
  const zeroSpacingMember: ExtractedMember = {
    tag: 'B5',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: true,
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0', // Zero spacing
  };
  const res = calculateMember(zeroSpacingMember, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.equal(res.rebarWeightKg, 0);
  assert.ok(res.flags?.some(f => f.code === 'REBAR_SPACING_INVALID'));
  assert.ok(res.formulaStr.length > 0 || res.rebarFormulaStr?.includes('CALCULATION_BLOCKED'));
});

test('Round 12 Scenario 11: Multiple simultaneous engineering warnings compound penalties and stay in NEEDS_REVIEW', () => {
  const multiWarningMember: ExtractedMember = {
    tag: 'TB_DEEP',
    memberType: 'BEAM',
    width: 0.20,
    depth: 1.40, // High aspect ratio (1.40 / 0.20 = 7.0 > 6.0)
    length: 12.00, // Heavy transfer girder span >= 10m
    count: 1,
    unit: 'm',
    coveringCm: -1.0, // Invalid cover
    topRebar: '2-DB25',
    bottomRebar: '4-DB25',
    stirrupRebar: 'RB9@0.15m',
    provenance: {
      evidence: [{ page: 9, method: 'vision', label: 'Transfer Beam' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'assumed' },
      confidence: 0.75,
      conflicts: ['ขัดแย้งกับขนาดเสาในตารางเสา C3'],
    },
  };
  const res = calculateMember(multiWarningMember, 1);
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags!.length >= 4);
  assert.ok(res.confidencePct! < 50);
});

test('Round 12 Scenario 12: High confidence (99%) but critical engineering flag (BEAM_SUPPORT_ASSUMED) cannot AUTO_RELEASE', () => {
  const memberHighConf: ExtractedMember = {
    tag: 'B_HIGH_CONF',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 10, method: 'dxf', label: 'High confidence DXF' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', support: 'assumed' },
      confidence: 0.99, // 99% extraction confidence!
    },
  };
  const res = calculateMember(memberHighConf, 1);
  // Confidence alone (99%) MUST NOT override critical engineering warnings!
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags?.some(f => f.code === 'BEAM_SUPPORT_ASSUMED' && f.severity === 'warn'));
});

test('Round 13 Adversarial 1: User approved member with invalid geometry (NaN / <=0) is REJECTED with zero quantities', () => {
  const invalidGeoMember: ExtractedMember = {
    tag: 'B_INVALID_GEO',
    memberType: 'BEAM',
    width: NaN,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
    review: { status: 'approved', note: 'Malicious or mistaken user approval of NaN dimension', at: '2026-11-03' },
  };
  const res = calculateMember(invalidGeoMember, 1);
  assert.equal(res.status, 'REJECTED');
  assert.equal(res.volumeNetM3, 0);
  assert.equal(res.formworkNetM2, 0);
  assert.equal(res.rebarWeightKg, 0);
  assert.ok(res.rejectionReasons?.some(r => r.includes('Missing or non-finite critical dimension')));
});

test('Round 13 Adversarial 2: User approval cannot override COVER_EXCEEDS_DIMENSION block', () => {
  const thinBeamCoverMember: ExtractedMember = {
    tag: 'B_THIN_COVER_EXCEEDS',
    memberType: 'BEAM',
    width: 0.15,
    depth: 0.20,
    length: 3.00,
    count: 1,
    unit: 'm',
    coveringCm: 8.0, // 8cm each side -> 2 * 8 = 16cm > 15cm width!
    topRebar: '2-DB12',
    bottomRebar: '2-DB12',
    stirrupRebar: 'RB6@0.15m',
    review: { status: 'approved', note: 'Attempting to approve physically impossible cover', at: '2026-11-03' },
  };
  const res = calculateMember(thinBeamCoverMember, 1);
  // User approval MUST NOT override physical impossibility block!
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.equal(res.rebarWeightKg, 0);
  assert.ok(res.flags?.some(f => f.code === 'COVER_EXCEEDS_DIMENSION' && f.severity === 'block'));
  assert.ok(res.confidenceBasis.includes('blocked'));
});

test('Round 13 Adversarial 3: DEFAULT_VALUE provenance with multiple warnings remains strictly quarantined in NEEDS_REVIEW', () => {
  const defaultMember: ExtractedMember = {
    tag: 'F_DEFAULT',
    memberType: 'FOOTING',
    width: 1.00,
    depth: 1.00,
    length: 0.30,
    count: 1,
    unit: 'm',
    bottomRebar: 'DB12@0.20m',
    footingHookShape: 'UNSPECIFIED',
    provenance: {
      evidence: [{ page: 1, method: 'vision', label: 'Default fallback' }],
      fieldSources: { width: 'missing', depth: 'missing', length: 'missing' },
      confidence: 0.60,
    },
  };
  const res = calculateMember(defaultMember, 1);
  assert.equal(res.provenanceLevel, 'DEFAULT_VALUE');
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.flags?.some(f => f.code === 'FOOTING_HOOK_UNSPECIFIED'));
});

test('Round 13 Adversarial 4: Heavy transfer girder with excessive span/depth ratio cannot AUTO_RELEASE without verification', () => {
  const transferGirder: ExtractedMember = {
    tag: 'TG_LONG',
    memberType: 'BEAM',
    width: 0.25,
    depth: 1.60, // aspect ratio = 6.4 > 6.0
    length: 11.50, // span >= 10m
    count: 1,
    unit: 'm',
    isClearSpan: true,
    topRebar: '3-DB25',
    bottomRebar: '6-DB25',
    stirrupRebar: 'RB9@0.15m',
    provenance: {
      evidence: [{ page: 2, method: 'vision', label: 'Transfer girder schedule' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing' },
      confidence: 0.95,
    },
  };
  const res = calculateMember(transferGirder, 1);
  // Must NOT auto-release because aspect ratio exceeds normal safety envelope
  assert.equal(res.status, 'NEEDS_REVIEW');
  assert.ok(res.reviewWarnings.some(w => w.includes('High aspect ratio')));
});


/** project spec whose footing cover (the code's 5.0 cm) was read from the drawing's general notes */
// the drawing's notes give the footing cover and the QS has given every quantity-relevant spec value (Round 20.1)
const SOURCED = Object.fromEntries(REQUIRED_SPECS.map(r => [r.key, { source: 'user' as const }]));
const NOTES_COVER = { ...DEFAULT_MATERIAL_SPECS, coverSources: { footing: 'drawing_notes' as const }, valueSources: SOURCED };

test('Round 17.1: the release gate holds every source the drawing does not back', () => {
  const base: ExtractedMember = { tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 1.2, length: 0.25, count: 1, unit: 'm', excavationDepthM: 1.5, bottomRebar: 'DB12@0.15m', footingHookShape: 'STANDARD_HOOK' };
  const read = (fieldSources: any = {}, method: any = 'pdf_text', confidence = 0.9) =>
    ({ evidence: method ? [{ page: 1, label: 'schedule', method }] : [], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', ...fieldSources }, confidence });
  // the drawing's general notes give the footing cover (Round 19.1: a footing without any cover is held)
  const status = (patch: Partial<ExtractedMember>) => calculateMember({ ...base, ...patch }, 1, NOTES_COVER);
  // QS approves the member exactly as it stands
  const approve = (patch: Partial<ExtractedMember>) => status({ ...patch, review: approvalFor({ ...base, ...patch }, undefined, NOTES_COVER) });

  // read from the drawing: released
  assert.equal(status({ provenance: read() }).status, 'AUTO_RELEASE');
  assert.equal(status({ provenance: read({}, 'dxf', 0.95) }).provenanceLevel, 'DRAWING_VERIFIED');
  // B1: an empty source record or a 'manual' entry is not drawing evidence
  for (const method of [null, 'manual']) {
    const r = status({ provenance: read({}, method, 0.95) });
    assert.equal(r.status, 'NEEDS_REVIEW');
    assert.equal(r.provenanceLevel, 'UNKNOWN');
  }
  // B2: a critical value under 'missing', or inferred, needs a QS
  assert.equal(status({ provenance: read({ width: 'missing' }) }).status, 'NEEDS_REVIEW');
  assert.equal(status({ provenance: read({ length: 'inferred' }) }).status, 'NEEDS_REVIEW');
  // B5: a reviewer edit is held until approved, and does not relabel the whole member
  const edited = status({ provenance: read({ width: 'reviewer' }) });
  assert.equal(edited.status, 'NEEDS_REVIEW');
  assert.equal(edited.provenanceLevel, 'OCR_EXTRACTED');
  assert.equal(approve({ provenance: read({ width: 'reviewer' }) }).status, 'AUTO_RELEASE');
  // QS approval releases unless a block remains
  assert.equal(approve({ provenance: read({}, null) }).status, 'AUTO_RELEASE');
  assert.notEqual(approve({ width: 0 }).status, 'AUTO_RELEASE');
});

test('Round 17.2: an approval covers only the values it was given on', () => {
  const m: ExtractedMember = {
    tag: 'B1', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 4, count: 1, unit: 'm', isClearSpan: true,
    topRebar: '2-DB12', bottomRebar: '2-DB12', stirrupRebar: 'RB6@0.15',
    provenance: { evidence: [{ page: 1, label: 'schedule', method: 'pdf_text' }], fieldSources: { width: 'assumed' }, confidence: 0.9 },
  };
  const approved = { ...m, review: approvalFor(m) };
  // the assumed width is not covered by a whole-member approval (Round 18c)
  assert.equal(calculateMember(approved, 1).status, 'NEEDS_REVIEW');
  // the QS confirming that field afterwards changes only provenance: the approval still holds and now releases
  assert.equal(calculateMember({ ...approved, provenance: { ...m.provenance!, fieldSources: { width: 'reviewer' } } }, 1).status, 'AUTO_RELEASE');
  // any input changed after approval voids it, through any path
  for (const change of [{ width: 0.25 }, { footingHookShape: 'STRAIGHT' as const }, { stirrupSets: 2 }, { isClearSpan: false, supportColW1: 0.3 }]) {
    const r = calculateMember({ ...approved, ...change }, 1);
    assert.equal(r.status, 'NEEDS_REVIEW', JSON.stringify(change));
    assert.ok(r.flags?.some(f => f.code === 'APPROVAL_STALE'));
    assert.equal(r.review, undefined);
  }
  // an approval with no record of its values (made before Round 17.2, or by hand) does not count
  assert.equal(calculateMember({ ...m, review: { status: 'approved', at: '2026-11-03' } }, 1).status, 'NEEDS_REVIEW');
  // an exclusion stays an exclusion
  assert.equal(calculateMember({ ...m, width: 0.3, review: { status: 'rejected', at: '2026-11-03' } }, 1).status, 'REJECTED');
});

test('Round 17.2: member approval needs every required field confirmed (section confirm alone is not enough)', () => {
  const beam: ExtractedMember = {
    tag: 'B2', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 4, count: 1, unit: 'm',
    provenance: { evidence: [{ page: 1, label: 'plan', method: 'vision' }], fieldSources: { width: 'inferred', depth: 'drawing', length: 'inferred', support: 'inferred' }, confidence: 0.9 },
  };
  assert.deepEqual(unconfirmedRequiredFields(beam), ['width', 'length', 'support']);
  // the section table confirms width and depth only
  const sectionConfirmed = { ...beam, provenance: { ...beam.provenance!, fieldSources: { ...beam.provenance!.fieldSources, width: 'reviewer' as const } } };
  assert.deepEqual(unconfirmedRequiredFields(sectionConfirmed), ['length', 'support']);
  // span and supports confirmed from the drawing or by the QS: nothing left
  assert.deepEqual(unconfirmedRequiredFields({ ...beam, provenance: { ...beam.provenance!, fieldSources: { width: 'drawing', depth: 'grid', length: 'reviewer', support: 'drawing' } } }), []);
  // no source record: nothing is confirmed
  assert.deepEqual(unconfirmedRequiredFields({ ...beam, provenance: undefined }), ['width', 'depth', 'length']);
});

test('Round 18a: footing rebar the drawing did not give is never released unreviewed, and every bar group is counted', () => {
  const f: ExtractedMember = {
    tag: 'F1', memberType: 'FOOTING', width: 0.9, depth: 0.9, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5,
    provenance: { evidence: [{ page: 1, label: 'schedule', method: 'pdf_text' }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing' }, confidence: 0.95 },
  };
  const calc = (p: Partial<ExtractedMember>) => calculateMember({ ...f, ...p }, 1, NOTES_COVER);
  const severity = (r: any, code: string) => r.flags?.find((x: any) => x.code === code)?.severity;

  // G1: no rebar in the drawing -> the engine's own DB12@0.15 needs a QS
  const noBars = calc({});
  assert.equal(noBars.status, 'NEEDS_REVIEW');
  assert.equal(severity(noBars, 'REBAR_RATIO_ASSUMED'), 'warn');
  const col = calculateMember({ ...f, tag: 'C1', memberType: 'COLUMN', width: 0.25, depth: 0.25, length: 3 }, 1);
  assert.equal(severity(col, 'REBAR_CODE_MINIMUM'), 'warn');
  assert.equal(col.status, 'NEEDS_REVIEW');

  // G2: hook shape not given -> the spec's default upturn needs a QS; a hook read from the drawing does not
  const noHook = calc({ bottomRebar: '5-DB12+5-DB12' });
  assert.equal(severity(noHook, 'FOOTING_HOOK_ASSUMED'), 'warn');
  assert.equal(noHook.status, 'NEEDS_REVIEW');
  assert.equal(calc({ bottomRebar: '5-DB12+5-DB12', footingHookShape: 'STRAIGHT' }).status, 'AUTO_RELEASE');

  // G3: a cover that cannot be right blocks, and approval cannot release it
  const badCover = { ...f, bottomRebar: '5-DB12+5-DB12', footingHookShape: 'STRAIGHT' as const, coveringCm: 60 };
  assert.equal(severity(calculateMember(badCover, 1), 'COVER_INVALID'), 'block');
  assert.notEqual(calculateMember({ ...badCover, review: approvalFor(badCover) }, 1).status, 'AUTO_RELEASE');

  // D1: each direction keeps its own bar size (5-DB12 one way, 5-DB16 the other)
  const mixed = calc({ bottomRebar: '5-DB12 + 5-DB16', footingHookShape: 'STRAIGHT' });
  assert.deepEqual(mixed.rebarDetails!.barList.map(b => `${b.count}x${b.bar}`), ['5xDB12', '5xDB16']);
  assert.ok(mixed.rebarWeightKg! > calc({ bottomRebar: '5-DB12 + 5-DB12', footingHookShape: 'STRAIGHT' }).rebarWeightKg!);

  // D2: a third bar group is not dropped: the footing is blocked until the bars are entered as two directions
  const three = calc({ bottomRebar: '3-DB12+3-DB12+2-DB16', footingHookShape: 'STRAIGHT' });
  assert.equal(severity(three, 'REBAR_GROUPS_UNREAD'), 'block');
  assert.notEqual(calculateMember({ ...f, bottomRebar: '3-DB12+3-DB12+2-DB16', footingHookShape: 'STRAIGHT', review: approvalFor({ ...f, bottomRebar: '3-DB12+3-DB12+2-DB16', footingHookShape: 'STRAIGHT' }) }, 1).status, 'AUTO_RELEASE');
});

test('Round 18c: a whole-member approval does not cover a field the drawing left unsettled', () => {
  const ok = { width: 'drawing', depth: 'drawing', length: 'drawing' } as const;
  const f: ExtractedMember = {
    tag: 'F1', memberType: 'FOOTING', width: 0.9, depth: 0.9, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5, bottomRebar: '5-DB12+5-DB12', footingHookShape: 'STRAIGHT',
    provenance: { evidence: [{ page: 1, label: 'schedule', method: 'pdf_text' }], fieldSources: { ...ok }, confidence: 0.95 },
  };
  const approved = (fs: Record<string, any>, conflicts?: string[]) => {
    const m = { ...f, provenance: { ...f.provenance!, fieldSources: fs, conflicts } };
    return calculateMember({ ...m, review: approvalFor(m, undefined, NOTES_COVER) }, 1, NOTES_COVER);
  };
  const open = (r: any) => r.flags?.find((x: any) => x.code === 'APPROVAL_FIELDS_OPEN');

  // class B: each stays in review after approval, naming the field to settle
  for (const [fs, conflicts] of [
    [{ ...ok, length: 'missing' }],
    [{ ...ok, length: 'assumed' }],
    [{ ...ok, length: 'inferred' }],
    [{ ...ok, rebar: 'missing' }],
    [{ ...ok }, ['ชื่อฐานราก F1-0.30 ไม่ตรงกับความหนาที่อ่านได้ 0.20 ม.']],
  ] as [Record<string, any>, string[]?][]) {
    const r = approved(fs, conflicts);
    assert.equal(r.status, 'NEEDS_REVIEW', JSON.stringify(fs) + conflicts);
    assert.equal(open(r)?.severity, 'warn');
  }
  assert.match(open(approved({ ...ok, length: 'assumed' })).message, /ความหนาฐาน/);

  // settled at field level (typed or confirmed by the reviewer) -> the approval releases
  assert.equal(approved({ ...ok, length: 'reviewer' }).status, 'AUTO_RELEASE');
  assert.equal(approved({ ...ok, rebar: 'reviewer' }).status, 'AUTO_RELEASE');
  assert.equal(approved({ width: 'reviewer', depth: 'reviewer', length: 'reviewer' }, ['ชื่อฐานราก F1-0.30 ไม่ตรงกับความหนาที่อ่านได้ 0.20 ม.']).status, 'AUTO_RELEASE');
  const assumedLen = { ...f, provenance: { ...f.provenance!, fieldSources: { ...ok, length: 'assumed' as const } } };
  assert.deepEqual(fieldsApprovalCannotCover(assumedLen, calculateMember(assumedLen, 1, NOTES_COVER).flags!).map(x => x.field), ['length']);

  // rebar the engine made up (none in the drawing) is a field too: approval holds until the reviewer types the bars
  const noBars = { ...f, bottomRebar: undefined };
  const r = calculateMember({ ...noBars, review: approvalFor(noBars, undefined, NOTES_COVER) }, 1, NOTES_COVER);
  assert.equal(r.status, 'NEEDS_REVIEW');
  assert.match(open(r).message, /เหล็กเสริม/);

  // class A stays approvable: low confidence and no source record
  assert.equal(approved({ ...ok }, undefined).status, 'AUTO_RELEASE');
  const low = { ...f, provenance: { ...f.provenance!, confidence: 0.6 } };
  assert.equal(calculateMember({ ...low, review: approvalFor(low, undefined, NOTES_COVER) }, 1, NOTES_COVER).status, 'AUTO_RELEASE');
  const bare = { ...f, provenance: undefined };
  assert.equal(calculateMember({ ...bare, review: approvalFor(bare, undefined, NOTES_COVER) }, 1, NOTES_COVER).status, 'AUTO_RELEASE');
});

test('Round 18d: the exported review record names the reviewer, the drawing file and each item a log entry touched', async () => {
  const XLSX = await import('xlsx');
  const { buildBoqWorkbook } = await import('../export/excelWorkbook.ts');
  const { computeProject } = await import('./qsEngine.ts');
  const { logEntryFor } = await import('./reviewLog.ts');
  const READ = { evidence: [{ page: 1, label: 'schedule', method: 'pdf_text' as const }], fieldSources: {}, confidence: 0.95 };
  const before: ExtractedMember[] = [
    { tag: 'C1', memberType: 'COLUMN', width: 0.25, depth: 0.25, length: 3, count: 1, unit: 'm', topRebar: '4-DB12', stirrupRebar: 'RB6@0.15', provenance: READ },
    { tag: 'C2', memberType: 'COLUMN', width: 0.3, depth: 0.3, length: 3, count: 1, unit: 'm', topRebar: '4-DB12', stirrupRebar: 'RB6@0.15', provenance: READ },
  ];
  const rev = 'S-01.pdf · 0123456789abcdef';
  const after = [before[0], { ...before[1], review: { ...approvalFor(before[1]), by: 'QS Somchai', revision: rev } }];
  const entry = { ...logEntryFor(before, after, [1])!, by: 'QS Somchai', revision: rev };
  const wb = buildBoqWorkbook({ ...computeProject(after, 'T', DEFAULT_MATERIAL_SPECS), reviewLog: [entry], revision: rev });
  const rows = (name: string) => XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 });

  const s7 = rows('7. บันทึกการตรวจทาน');
  assert.match(String(s7[0][0]), /S-01\.pdf · 0123456789abcdef/);
  const h7 = s7[1];
  const c2 = s7.find(r => r[1] === 'C2')!;
  assert.equal(c2[h7.indexOf('ผู้ตรวจ')], 'QS Somchai');
  assert.equal(c2[h7.indexOf('ไฟล์แบบที่ตรวจ')], rev);

  const s8 = rows('8. ประวัติการแก้');
  const r8 = s8[1];
  assert.equal(r8[s8[0].indexOf('ชิ้น (รหัส เบอร์ @กริด ชั้น)')], 'QS-C-002'); // the item, not just a count
  assert.equal(r8[s8[0].indexOf('ผู้ตรวจ')], 'QS Somchai');
  assert.equal(r8[s8[0].indexOf('ไฟล์แบบ')], rev);
});

test('Round 18b: footing steel the drawing did not settle is flagged, and a cover the thickness cannot hold blocks', async () => {
  const f: ExtractedMember = {
    tag: 'F1', memberType: 'FOOTING', width: 0.9, depth: 0.9, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5, footingHookShape: 'STRAIGHT',
    provenance: { evidence: [{ page: 1, label: 'schedule', method: 'pdf_text' }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing' }, confidence: 0.95 },
  };
  const calc = (p: Partial<ExtractedMember>) => calculateMember({ ...f, ...p }, 1, NOTES_COVER);
  const flag = (r: any, code: string) => r.flags?.find((x: any) => x.code === code);

  // cover vs thickness: 20 cm each face of a 0.30 m footing leaves no room for the mat
  const thick = calc({ bottomRebar: '3-DB12+3-DB12', coveringCm: 20 });
  assert.equal(flag(thick, 'COVER_EXCEEDS_DIMENSION')?.severity, 'block');
  assert.notEqual(calculateMember({ ...f, bottomRebar: '3-DB12+3-DB12', coveringCm: 20, review: approvalFor({ ...f, bottomRebar: '3-DB12+3-DB12', coveringCm: 20 }) }, 1).status, 'AUTO_RELEASE');

  // D3: no silent clamps (quantities as before, but the raise is stated)
  const sparse = calc({ bottomRebar: 'DB12@0.50' });
  assert.equal(flag(sparse, 'REBAR_COUNT_RAISED')?.severity, 'warn');
  assert.deepEqual(sparse.rebarDetails!.barList.map(b => b.count), [3, 3]);
  assert.equal(calc({ bottomRebar: 'DB12@0.15' }).flags!.some(x => x.code === 'REBAR_COUNT_RAISED'), false);
  const thin = calc({ length: 0.15, coveringCm: 3, bottomRebar: '3-DB12+3-DB12', footingHookShape: 'FULL_UPTURN' });
  assert.equal(flag(thin, 'FOOTING_HOOK_RAISED')?.severity, 'warn');

  // D4: a direction the drawing did not state is flagged; a square mesh of two equal groups is not
  assert.equal(flag(calc({ bottomRebar: '4-DB12' }), 'REBAR_DIRECTION_ASSUMED')?.severity, 'warn');
  assert.equal(flag(calc({ width: 1.2, bottomRebar: '5-DB12 + 5-DB16' }), 'REBAR_DIRECTION_ASSUMED')?.severity, 'warn');
  assert.equal(calc({ bottomRebar: '5-DB12 + 5-DB16' }).flags!.some(x => x.code === 'REBAR_DIRECTION_ASSUMED'), false);
  const plain = calc({ bottomRebar: '5-DB12+5-DB12' });
  assert.equal(plain.status, 'AUTO_RELEASE');

  // the bar sheet carries each member's steel doubts next to its bars
  const XLSX = await import('xlsx');
  const { buildBoqWorkbook } = await import('../export/excelWorkbook.ts');
  const { computeProject } = await import('./qsEngine.ts');
  const wb = buildBoqWorkbook(computeProject([{ ...f, bottomRebar: '4-DB12' }, { ...f, tag: 'F2', bottomRebar: '5-DB12+5-DB12' }], 'T', DEFAULT_MATERIAL_SPECS));
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['ตารางดัด-ตัดเหล็กเสริม'], { header: 1 });
  assert.match(String(rows[0][0]), /ไม่ใช่ BBS สำหรับสั่งตัด/);
  const col = rows[1].indexOf('สมมติฐาน/ข้อสงสัยเหล็ก (ไม่ใช่ค่าจากแบบ)');
  assert.match(String(rows.find(r => r[1] === 'F1')![col]), /กลุ่มเดียว/);
  assert.equal(rows.find(r => r[1] === 'F2')![col] ?? '', '');
});
