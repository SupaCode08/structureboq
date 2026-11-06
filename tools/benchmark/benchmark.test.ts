/**
 * StructBOQ Benchmark Test Suite
 *
 * Verifies validation rules, metrics calculation, error taxonomy, zero handling,
 * False Release detection, and reproducibility.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBenchmarkDataset,
  executeBenchmark,
  BenchmarkDataset
} from './run_benchmark';
import { compareComponent, quantile, summarizeComponentComparisons } from './metrics';
import { diagnoseDiscrepancy, summarizeErrorTypes } from './error_analysis';

test('Benchmark Dataset Validation: valid dataset passes without errors', () => {
  const validData: BenchmarkDataset = {
    datasetId: 'test-dataset-01',
    datasetVersion: '1.0.0',
    split: 'synthetic',
    projectId: 'PROJ-01',
    projectName: 'Test Project',
    drawingFile: 'test.pdf',
    benchmarkEntries: [
      {
        memberId: 'M01',
        tag: 'F1',
        memberType: 'FOOTING',
        drawingPage: 1,
        dimensions: { width: 1.0, depth: 1.0, length: 0.3, count: 1, unit: 'm' },
        referenceQuantity: { concreteVolumeM3: 0.3, formworkAreaM2: 1.2, rebarWeightKg: 10.5 },
        referenceSource: 'Test',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
    ],
  };

  const errors = validateBenchmarkDataset(validData);
  assert.equal(errors.length, 0, 'Valid dataset must have zero validation errors');
});

test('Benchmark Dataset Validation: detects missing fields, duplicate IDs, invalid units, and missing ref quantities', () => {
  const invalidData: any = {
    datasetId: 'invalid-ds',
    // Missing datasetVersion, split, projectId, projectName, drawingFile
    benchmarkEntries: [
      {
        memberId: 'DUP-01',
        tag: 'F1',
        memberType: 'FOOTING',
        drawingPage: 1,
        dimensions: { width: 1.0, depth: 1.0, length: 0.3, count: 1, unit: 'inches' }, // Invalid unit
        referenceQuantity: { concreteVolumeM3: 0.3 }, // Missing formworkAreaM2 and rebarWeightKg
        referenceSource: 'Test',
        groundTruthStatus: 'NOT_VALID_STATUS',
        verificationDate: '2026-11-03',
      },
      {
        memberId: 'DUP-01', // Duplicate memberId
        tag: 'F2',
        memberType: 'UNKNOWN_TYPE', // Invalid memberType
        drawingPage: 1,
        dimensions: { width: -1.0, depth: 0, length: 0.3 }, // Invalid dimensions
        referenceQuantity: { concreteVolumeM3: 0.3, formworkAreaM2: 1.2, rebarWeightKg: 10.5 },
        referenceSource: 'Test',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
    ],
  };

  const errors = validateBenchmarkDataset(invalidData);
  assert.ok(errors.length >= 6, `Expected multiple validation errors, got ${errors.length}`);

  assert.ok(errors.some(e => e.field === 'datasetVersion'), 'Missing datasetVersion detected');
  assert.ok(errors.some(e => e.error.includes('Duplicate memberId')), 'Duplicate memberId detected');
  assert.ok(errors.some(e => e.error.includes('Invalid unit')), 'Invalid unit detected');
  assert.ok(errors.some(e => e.error.includes('Missing required root field')), 'Root field detected');
  assert.ok(errors.some(e => e.error.includes('Invalid memberType')), 'Invalid memberType detected');
  assert.ok(errors.some(e => e.field.includes('formworkAreaM2')), 'Missing formwork quantity detected');
});

test('Metrics Component: zero reference handling prevents division by zero', () => {
  // Case A: System=0, Ref=0 -> 0% error
  const compA = compareComponent('rebarWeightKg', 0, 0);
  assert.equal(compA.absError, 0);
  assert.equal(compA.relErrorPct, 0);
  assert.equal(compA.isZeroDiv, false);

  // Case B: System=15, Ref=0 -> relErrorPct is null, isZeroDiv is true
  const compB = compareComponent('rebarWeightKg', 15.0, 0);
  assert.equal(compB.absError, 15.0);
  assert.equal(compB.relErrorPct, null);
  assert.equal(compB.isZeroDiv, true);

  // Case C: System=11, Ref=10 -> 10% error
  const compC = compareComponent('rebarWeightKg', 11.0, 10.0);
  assert.equal(compC.absError, 1.0);
  assert.equal(compC.relErrorPct, 10.0);
  assert.equal(compC.isZeroDiv, false);
});

test('Statistical Quantile: correctly computes median and P90', () => {
  const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const med = quantile(vals, 0.5);
  const p90 = quantile(vals, 0.9);
  assert.equal(med, 55);
  assert.equal(p90, 91);

  assert.equal(quantile([], 0.5), 0);
  assert.equal(quantile([42], 0.5), 42);
});

test('Benchmark Execution: evaluates multiple member types (Footing, Column, Beam, Slab) and warns correctly', () => {
  const multiTypeDataset: BenchmarkDataset = {
    datasetId: 'multitype-test',
    datasetVersion: '1.0.0',
    split: 'synthetic',
    projectId: 'MULTI-01',
    projectName: 'Multi-Type Structural Test',
    drawingFile: 'drawings.pdf',
    benchmarkEntries: [
      {
        memberId: 'F-01',
        tag: 'F1',
        memberType: 'FOOTING',
        drawingPage: 1,
        dimensions: { width: 1.0, depth: 1.0, length: 0.35, count: 1 },
        reinforcement: { bottomRebar: 'DB12@0.15m' },
        engineeringAssumptions: { coverCm: 5.0, footingHookShape: 'STANDARD_HOOK' },
        referenceQuantity: { concreteVolumeM3: 0.35, formworkAreaM2: 1.4, rebarWeightKg: 16.4 },
        referenceSource: 'Calculated',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
      {
        memberId: 'C-01',
        tag: 'C1',
        memberType: 'COLUMN',
        drawingPage: 1,
        dimensions: { width: 0.20, depth: 0.20, length: 3.0, count: 1 },
        reinforcement: { topRebar: '4-DB16', stirrupRebar: 'RB6@0.15m' },
        engineeringAssumptions: { coverCm: 3.0 },
        referenceQuantity: { concreteVolumeM3: 0.12, formworkAreaM2: 2.4, rebarWeightKg: 25.5 },
        referenceSource: 'Calculated',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
      {
        memberId: 'B-01',
        tag: 'B1',
        memberType: 'BEAM',
        drawingPage: 2,
        dimensions: { width: 0.20, depth: 0.40, length: 4.0, count: 1 },
        reinforcement: { topRebar: '2-DB16', bottomRebar: '2-DB16', stirrupRebar: 'RB6@0.15m' },
        engineeringAssumptions: { coverCm: 3.0 },
        referenceQuantity: { concreteVolumeM3: 0.32, formworkAreaM2: 4.0, rebarWeightKg: 34.03 },
        referenceSource: 'Calculated',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
      {
        memberId: 'S-01',
        tag: 'S1',
        memberType: 'SLAB',
        drawingPage: 2,
        dimensions: { width: 4.0, depth: 3.0, length: 0.10, count: 1 },
        reinforcement: { bottomRebar: 'DB10@0.20m' },
        engineeringAssumptions: { coverCm: 2.0 },
        referenceQuantity: { concreteVolumeM3: 1.2, formworkAreaM2: 13.4, rebarWeightKg: 78.36 },
        referenceSource: 'Calculated',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
    ],
  };

  const res = executeBenchmark(multiTypeDataset);

  assert.equal(res.metrics.totalMembers, 4);
  assert.equal(res.metrics.evaluatedMembers, 4);
  assert.equal(res.metrics.verifiedMembers, 4);

  // Check that all 4 member types are reported separately
  assert.equal(res.metrics.byMemberType.FOOTING.memberCount, 1);
  assert.equal(res.metrics.byMemberType.COLUMN.memberCount, 1);
  assert.equal(res.metrics.byMemberType.BEAM.memberCount, 1);
  assert.equal(res.metrics.byMemberType.SLAB.memberCount, 1);

  // Beam without column support widths triggers NEEDS_REVIEW
  assert.equal(res.metrics.byMemberType.BEAM.needsReviewCount, 1);
  assert.ok(res.metrics.needsReviewRatePct > 0);
});

test('False Release Detection: catches unflagged Auto-Released members with large discrepancies', () => {
  const falseReleaseDataset: BenchmarkDataset = {
    datasetId: 'fr-test',
    datasetVersion: '1.0.0',
    split: 'synthetic',
    projectId: 'FR-01',
    projectName: 'False Release Detection Test',
    drawingFile: 'test.pdf',
    benchmarkEntries: [
      {
        memberId: 'FR-M01',
        tag: 'C_PERFECT',
        memberType: 'COLUMN',
        drawingPage: 1,
        dimensions: { width: 0.20, depth: 0.20, length: 3.5, count: 1 },
        reinforcement: { topRebar: '4-DB16', stirrupRebar: 'RB6@0.15m' },
        engineeringAssumptions: { coverCm: 3.0 },
        provenance: { evidence: [{ page: 1, label: 'schedule', method: 'pdf_text' }], fieldSources: {}, confidence: 0.95 },
        referenceQuantity: { concreteVolumeM3: 0.14, formworkAreaM2: 2.8, rebarWeightKg: 29.65 },
        referenceSource: 'Exact match',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
      {
        memberId: 'FR-M02',
        tag: 'C_MISMATCH',
        memberType: 'COLUMN',
        drawingPage: 1,
        dimensions: { width: 0.20, depth: 0.20, length: 3.5, count: 1 },
        reinforcement: { topRebar: '4-DB16', stirrupRebar: 'RB6@0.15m' },
        engineeringAssumptions: { coverCm: 3.0 },
        provenance: { evidence: [{ page: 1, label: 'schedule', method: 'pdf_text' }], fieldSources: {}, confidence: 0.95 },
        // Reference rebar is 100 kg (system calculates 29.65 kg -> ~70% error)
        referenceQuantity: { concreteVolumeM3: 0.14, formworkAreaM2: 2.8, rebarWeightKg: 100.0 },
        referenceSource: 'Deliberate mismatch',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
    ],
  };

  const res = executeBenchmark(falseReleaseDataset);

  // Both columns carry a read provenance and satisfy strict bounds, so they auto-release
  assert.equal(res.metrics.autoReleaseCount, 2);
  // But FR-M02 has a ~70% discrepancy, so it MUST be flagged as a False Release!
  assert.equal(res.metrics.falseReleaseCount, 1, 'Should detect exactly 1 False Release');
  const evalFr = res.memberEvaluations.find(e => e.memberId === 'FR-M02')!;
  assert.equal(evalFr.isFalseRelease, true);
});

test('Error Analysis: categorizes hook assumption, cover, measurement convention mismatch, and invalid reference errors', () => {
  const diag1 = diagnoseDiscrepancy({
    memberType: 'FOOTING',
    dimensions: { width: 1.0, depth: 1.0, length: 0.35, count: 1 },
    systemConcreteM3: 0.35,
    refConcreteM3: 0.35,
    systemFormworkM2: 1.4,
    refFormworkM2: 1.4,
    systemRebarKg: 22.0,
    refRebarKg: 15.0, // Difference of 7 kg matches hook addition
    systemFlags: [],
    rebarDetails: { netWeightKg: 15.0, hookWeightKg: 7.0, lapWeightKg: 0, wastageWeightKg: 1.5 },
    groundTruthStatus: 'VERIFIED',
  });

  assert.ok(diag1.some(d => d.errorType === 'HOOK_ASSUMPTION_ERROR'), 'Should identify HOOK_ASSUMPTION_ERROR');

  // House 1 B2 case: Concrete matches (1.152 m3), Formwork differs by 25% (14.40 vs 11.52 m2)
  const diagConvention = diagnoseDiscrepancy({
    memberType: 'BEAM',
    dimensions: { width: 0.20, depth: 0.40, length: 3.60, count: 4 },
    systemConcreteM3: 1.152,
    refConcreteM3: 1.152,
    systemFormworkM2: 14.40,
    refFormworkM2: 11.52,
    systemRebarKg: 182.22,
    refRebarKg: 182.24,
    systemFlags: [],
    groundTruthStatus: 'VERIFIED',
  });

  assert.ok(
    diagConvention.some(d => d.errorType === 'MEASUREMENT_CONVENTION_MISMATCH'),
    'Should identify MEASUREMENT_CONVENTION_MISMATCH when concrete volume matches but formwork convention differs'
  );

  // Invalid ground truth record
  const diagInvalid = diagnoseDiscrepancy({
    memberType: 'BEAM',
    dimensions: { width: 0.15, depth: 0.40, length: 8.00, count: 4 },
    systemConcreteM3: 1.92,
    refConcreteM3: 1.92,
    systemFormworkM2: 30.40,
    refFormworkM2: 30.40,
    systemRebarKg: 222.66,
    refRebarKg: 222.66,
    systemFlags: [],
    groundTruthStatus: 'INVALID',
  });

  assert.equal(diagInvalid.length, 1);
  assert.equal(diagInvalid[0].errorType, 'REFERENCE_DATA_ERROR');

  const diagSummary = summarizeErrorTypes([...diag1, ...diagConvention, ...diagInvalid]);
  assert.equal(diagSummary.HOOK_ASSUMPTION_ERROR, 1);
  assert.equal(diagSummary.MEASUREMENT_CONVENTION_MISMATCH, 1);
  assert.equal(diagSummary.REFERENCE_DATA_ERROR, 1);
});

test('Edge Cases: negative/NaN/Infinity references, small reference quantities, zero-division tracking, and VERIFIED vs INVALID separation', () => {
  // 1. Validate negative, NaN, Infinity references and non-integer count
  const badRefs: any = {
    datasetId: 'bad-refs',
    datasetVersion: '1.0.0',
    split: 'synthetic',
    projectId: 'BAD-01',
    projectName: 'Bad References Test',
    drawingFile: 'test.pdf',
    benchmarkEntries: [
      {
        memberId: 'NEG-01',
        tag: 'F1',
        memberType: 'FOOTING',
        drawingPage: 1,
        dimensions: { width: 1.0, depth: 1.0, length: 0.25, count: 1.5, unit: 'm' },
        referenceQuantity: { concreteVolumeM3: -0.25, formworkAreaM2: NaN, rebarWeightKg: Infinity },
        referenceSource: 'Test',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
    ],
  };
  const valErrors = validateBenchmarkDataset(badRefs);
  assert.ok(valErrors.some(e => e.field.includes('dimensions.count')), 'Non-integer count rejected');
  assert.ok(valErrors.some(e => e.field.includes('concreteVolumeM3')), 'Negative concreteVolumeM3 rejected');
  assert.ok(valErrors.some(e => e.field.includes('formworkAreaM2')), 'NaN formworkAreaM2 rejected');
  assert.ok(valErrors.some(e => e.field.includes('rebarWeightKg')), 'Infinity rebarWeightKg rejected');

  // 2. Very small reference quantity and zero-division count in MetricSummary
  const smallRefComp = compareComponent('concreteVolumeM3', 0.0002, 0.0001);
  assert.equal(smallRefComp.absError, 0.0001);
  assert.equal(smallRefComp.relErrorPct, 100.0);
  assert.equal(smallRefComp.isZeroDiv, false);

  const zeroDivComp = compareComponent('rebarWeightKg', 12.5, 0);
  const zeroBothComp = compareComponent('rebarWeightKg', 0, 0);
  const summary = summarizeComponentComparisons([smallRefComp, zeroDivComp, zeroBothComp]);
  assert.equal(summary.count, 3);
  assert.equal(summary.validPercentageCount, 2);
  assert.equal(summary.zeroDivCount, 1);

  // 3. VERIFIED vs ESTIMATED vs INVALID separation & multiple physical instances (count > 1)
  const mixedStatusDataset: BenchmarkDataset = {
    datasetId: 'mixed-status',
    datasetVersion: '1.0.0',
    split: 'synthetic',
    projectId: 'MIX-01',
    projectName: 'Mixed Ground Truth Status Test',
    drawingFile: 'test.pdf',
    benchmarkEntries: [
      {
        memberId: 'V-01',
        tag: 'F1',
        memberType: 'FOOTING',
        drawingPage: 1,
        dimensions: { width: 1.0, depth: 1.0, length: 0.25, count: 4 },
        reinforcement: { bottomRebar: '5+5-DB12' },
        engineeringAssumptions: { coverCm: 5.0, footingHookShape: 'FULL_UPTURN' },
        referenceQuantity: { concreteVolumeM3: 1.0, formworkAreaM2: 4.0, rebarWeightKg: 42.62 },
        referenceSource: 'Verified',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
      {
        memberId: 'E-01',
        tag: 'F2',
        memberType: 'FOOTING',
        drawingPage: 1,
        dimensions: { width: 1.0, depth: 1.0, length: 0.25, count: 2 },
        reinforcement: { bottomRebar: '5+5-DB12' },
        engineeringAssumptions: { coverCm: 5.0, footingHookShape: 'FULL_UPTURN' },
        referenceQuantity: { concreteVolumeM3: 0.5, formworkAreaM2: 2.0, rebarWeightKg: 25.0 }, // ~22% rebar diff
        referenceSource: 'Estimated',
        groundTruthStatus: 'ESTIMATED',
        verificationDate: '2026-11-03',
      },
      {
        memberId: 'INV-01',
        tag: 'F3',
        memberType: 'FOOTING',
        drawingPage: 1,
        dimensions: { width: 1.0, depth: 1.0, length: 0.25, count: 1 },
        reinforcement: { bottomRebar: '5+5-DB12' },
        engineeringAssumptions: { coverCm: 5.0, footingHookShape: 'FULL_UPTURN' },
        referenceQuantity: { concreteVolumeM3: 999.0, formworkAreaM2: 999.0, rebarWeightKg: 999.0 },
        referenceSource: 'Corrupted',
        groundTruthStatus: 'INVALID',
        verificationDate: '2026-11-03',
      },
    ],
  };

  const mixRes = executeBenchmark(mixedStatusDataset);
  assert.equal(mixRes.metrics.totalMembers, 3);
  assert.equal(mixRes.metrics.evaluatedMembers, 2);
  assert.equal(mixRes.metrics.verifiedMembers, 1);
  assert.equal(mixRes.metrics.invalidMembers, 1);
  // INVALID record is retained in memberEvaluations (never silently discarded)
  assert.equal(mixRes.memberEvaluations.length, 3);
  // Primary VERIFIED-only metrics reflect only V-01 (0% error), uncontaminated by E-01 or INV-01
  assert.equal(mixRes.metrics.verifiedOnlyByComponent.concrete.count, 1);
  assert.equal(mixRes.metrics.verifiedOnlyByComponent.rebar.medianAbsPercentageError, 0);
  // All valid metrics reflect V-01 and E-01 (count=2), excluding INV-01
  assert.equal(mixRes.metrics.byComponent.rebar.count, 2);
});

test('Benchmark Reproducibility: running benchmark 3 times yields identical quantities, metrics, and member ordering', () => {
  const dataset: BenchmarkDataset = {
    datasetId: 'repro-test',
    datasetVersion: '1.0.0',
    split: 'synthetic',
    projectId: 'REPRO-01',
    projectName: 'Reproducibility Test',
    drawingFile: 'drawings.pdf',
    benchmarkEntries: [
      {
        memberId: 'R-01',
        tag: 'F1',
        memberType: 'FOOTING',
        drawingPage: 1,
        dimensions: { width: 1.20, depth: 1.20, length: 0.35, count: 2 },
        reinforcement: { bottomRebar: 'DB12@0.15m' },
        engineeringAssumptions: { coverCm: 5.0, footingHookShape: 'STANDARD_HOOK' },
        referenceQuantity: { concreteVolumeM3: 1.008, formworkAreaM2: 3.36, rebarWeightKg: 39.44 },
        referenceSource: 'Ground truth',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
      {
        memberId: 'R-02',
        tag: 'B1',
        memberType: 'BEAM',
        drawingPage: 2,
        dimensions: { width: 0.20, depth: 0.40, length: 4.00, count: 3 },
        reinforcement: { topRebar: '2-DB16', bottomRebar: '2-DB16', stirrupRebar: 'RB6@0.15m' },
        engineeringAssumptions: { coverCm: 3.0 },
        referenceQuantity: { concreteVolumeM3: 0.96, formworkAreaM2: 12.0, rebarWeightKg: 102.09 },
        referenceSource: 'Ground truth',
        groundTruthStatus: 'VERIFIED',
        verificationDate: '2026-11-03',
      },
    ],
  };

  const run1 = executeBenchmark(dataset);
  const run2 = executeBenchmark(dataset);
  const run3 = executeBenchmark(dataset);

  assert.deepEqual(
    run1.memberEvaluations.map(m => m.memberId),
    run2.memberEvaluations.map(m => m.memberId)
  );
  assert.deepEqual(
    run2.memberEvaluations.map(m => m.memberId),
    run3.memberEvaluations.map(m => m.memberId)
  );
  assert.deepEqual(run1.memberEvaluations, run2.memberEvaluations);
  assert.deepEqual(run2.memberEvaluations, run3.memberEvaluations);
  assert.equal(run1.metrics.byComponent.concrete.meanAbsError, run3.metrics.byComponent.concrete.meanAbsError);
  assert.equal(run1.metrics.byComponent.rebar.medianAbsPercentageError, run3.metrics.byComponent.rebar.medianAbsPercentageError);
  assert.equal(run1.metrics.autoReleaseCount, run3.metrics.autoReleaseCount);
  assert.equal(run1.metrics.falseReleaseCount, run3.metrics.falseReleaseCount);
});
