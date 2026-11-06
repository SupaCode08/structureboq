/**
 * StructBOQ Benchmark Runner
 *
 * Executes reproducible benchmarks comparing StructBOQ quantity engine against
 * independently verified project references and BOQ ground truths.
 *
 * Anti-Leakage Guarantee:
 * - Reference quantities are NEVER passed to the calculation engine.
 * - Evaluations are strictly read-only against production code paths.
 */

import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import { calculateMember, DEFAULT_MATERIAL_SPECS, ExtractedMember, MaterialSpecs, Provenance } from '../../src/engine/qsEngine';
import {
  compareComponent,
  aggregateEvaluationResults,
  MemberEvaluationResult,
  AggregatedMetrics,
  FALSE_RELEASE_TOLERANCE_PCT
} from './metrics';
import { diagnoseDiscrepancy, summarizeErrorTypes, ErrorDiagnostic } from './error_analysis';

export interface DatasetValidationError {
  entryIndex?: number;
  memberId?: string;
  field: string;
  error: string;
}

export interface BenchmarkDataset {
  datasetId: string;
  datasetVersion: string;
  split: 'dev' | 'heldout' | 'synthetic';
  projectId: string;
  projectName: string;
  drawingFile: string;
  drawingRevision?: string;
  engineVersionTarget?: string;
  createdAt?: string;
  description?: string;
  benchmarkEntries: BenchmarkEntryRaw[];
}

export interface BenchmarkEntryRaw {
  memberId: string;
  tag: string;
  memberType: 'FOOTING' | 'COLUMN' | 'BEAM' | 'SLAB';
  drawingPage: number;
  dimensions: {
    width: number;
    depth: number;
    length: number;
    count?: number;
    unit?: string;
  };
  reinforcement?: {
    topRebar?: string;
    bottomRebar?: string;
    stirrupRebar?: string;
    stirrupSets?: number;
  };
  materials?: {
    concreteGrade?: string;
    steelGrade?: 'SR24' | 'SD30' | 'SD40' | 'SD50';
  };
  engineeringAssumptions?: {
    coverCm?: number;
    footingHookShape?: 'FULL_UPTURN' | 'STANDARD_HOOK' | 'STRAIGHT' | 'UNSPECIFIED';
    stockBarLengthM?: 6.0 | 10.0 | 12.0;
    lapSpliceRule?: string;
  };
  provenance?: Provenance;
  referenceQuantity: {
    concreteVolumeM3: number;
    formworkAreaM2: number;
    rebarWeightKg: number;
    breakdown?: {
      mainBarsKg?: number;
      stirrupsKg?: number;
      wiremeshM2?: number;
      bindingWireKg?: number;
    };
  };
  referenceSource: string;
  groundTruthStatus: 'VERIFIED' | 'BOQ_REFERENCE' | 'ESTIMATED' | 'INVALID';
  reviewer?: string;
  verificationDate: string;
  notes?: string;
}

export interface BenchmarkRunOutput {
  metadata: {
    datasetId: string;
    datasetVersion: string;
    split: string;
    projectId: string;
    projectName: string;
    drawingFile: string;
    runTimestamp: string;
    engineVersion: string;
    engineCommit: string;
  };
  metrics: AggregatedMetrics;
  errorSummary: Record<string, number>;
  diagnostics: { memberId: string; tag: string; diagnostics: ErrorDiagnostic[] }[];
  memberEvaluations: MemberEvaluationResult[];
}

/** Validates dataset schema and logical constraints before benchmark execution */
export function validateBenchmarkDataset(data: any): DatasetValidationError[] {
  const errors: DatasetValidationError[] = [];

  if (!data || typeof data !== 'object') {
    return [{ field: 'root', error: 'Dataset must be an object' }];
  }

  const requiredRoot = ['datasetId', 'datasetVersion', 'split', 'projectId', 'projectName', 'drawingFile', 'benchmarkEntries'];
  for (const f of requiredRoot) {
    if (!data[f]) {
      errors.push({ field: f, error: `Missing required root field '${f}'` });
    }
  }

  if (!Array.isArray(data.benchmarkEntries)) {
    errors.push({ field: 'benchmarkEntries', error: 'benchmarkEntries must be an array' });
    return errors;
  }

  const seenIds = new Set<string>();

  data.benchmarkEntries.forEach((entry: any, idx: number) => {
    const pfx = `benchmarkEntries[${idx}]`;

    if (!entry.memberId) {
      errors.push({ entryIndex: idx, field: `${pfx}.memberId`, error: 'Missing memberId' });
    } else {
      if (seenIds.has(entry.memberId)) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.memberId`, error: `Duplicate memberId '${entry.memberId}' detected` });
      }
      seenIds.add(entry.memberId);
    }

    if (!['FOOTING', 'COLUMN', 'BEAM', 'SLAB'].includes(entry.memberType)) {
      errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.memberType`, error: `Invalid memberType '${entry.memberType}'` });
    }

    if (!entry.dimensions || typeof entry.dimensions !== 'object') {
      errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.dimensions`, error: 'Missing dimensions object' });
    } else {
      const { width, depth, length, count, unit } = entry.dimensions;
      if (!Number.isFinite(width) || width <= 0) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.dimensions.width`, error: `Invalid width '${width}'` });
      }
      if (!Number.isFinite(depth) || depth <= 0) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.dimensions.depth`, error: `Invalid depth '${depth}'` });
      }
      if (!Number.isFinite(length) || length <= 0) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.dimensions.length`, error: `Invalid length '${length}'` });
      }
      if (count !== undefined && (!Number.isFinite(count) || count <= 0 || !Number.isInteger(count))) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.dimensions.count`, error: `Invalid count '${count}', must be a positive integer` });
      }
      if (unit && !['m', 'cm', 'mm'].includes(unit)) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.dimensions.unit`, error: `Invalid unit '${unit}', expected m, cm, or mm` });
      }
    }

    if (!entry.referenceQuantity || typeof entry.referenceQuantity !== 'object') {
      errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.referenceQuantity`, error: 'Missing referenceQuantity' });
    } else {
      const { concreteVolumeM3, formworkAreaM2, rebarWeightKg } = entry.referenceQuantity;
      if (typeof concreteVolumeM3 !== 'number' || !Number.isFinite(concreteVolumeM3) || concreteVolumeM3 < 0) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.referenceQuantity.concreteVolumeM3`, error: 'concreteVolumeM3 must be a finite number >= 0' });
      }
      if (typeof formworkAreaM2 !== 'number' || !Number.isFinite(formworkAreaM2) || formworkAreaM2 < 0) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.referenceQuantity.formworkAreaM2`, error: 'formworkAreaM2 must be a finite number >= 0' });
      }
      if (typeof rebarWeightKg !== 'number' || !Number.isFinite(rebarWeightKg) || rebarWeightKg < 0) {
        errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.referenceQuantity.rebarWeightKg`, error: 'rebarWeightKg must be a finite number >= 0' });
      }
    }

    if (!['VERIFIED', 'BOQ_REFERENCE', 'ESTIMATED', 'INVALID'].includes(entry.groundTruthStatus)) {
      errors.push({ entryIndex: idx, memberId: entry.memberId, field: `${pfx}.groundTruthStatus`, error: `Invalid groundTruthStatus '${entry.groundTruthStatus}'` });
    }
  });

  return errors;
}

/** Executes the benchmark on a loaded and validated dataset */
export function executeBenchmark(dataset: BenchmarkDataset, commitHash = 'master'): BenchmarkRunOutput {
  const evaluations: MemberEvaluationResult[] = [];
  const allDiagnostics: { memberId: string; tag: string; diagnostics: ErrorDiagnostic[] }[] = [];
  const flatDiagnostics: ErrorDiagnostic[] = [];

  const tStart = performance.now();

  for (const entry of dataset.benchmarkEntries) {
    // 1. Build ExtractedMember object (anti-leakage: referenceQuantity is NOT included)
    const count = entry.dimensions.count || 1;
    const member: ExtractedMember = {
      tag: entry.tag,
      memberType: entry.memberType,
      width: entry.dimensions.width,
      depth: entry.dimensions.depth,
      length: entry.dimensions.length,
      count: count,
      unit: entry.dimensions.unit || 'm',
      topRebar: entry.reinforcement?.topRebar,
      bottomRebar: entry.reinforcement?.bottomRebar,
      stirrupRebar: entry.reinforcement?.stirrupRebar,
      stirrupSets: entry.reinforcement?.stirrupSets,
      coveringCm: entry.engineeringAssumptions?.coverCm,
      footingHookShape: entry.engineeringAssumptions?.footingHookShape,
      sourceFile: dataset.drawingFile,
      sourceSheetOrLayer: `Page ${entry.drawingPage}`,
      provenance: entry.provenance,
    };

    const rules: MaterialSpecs = {
      ...DEFAULT_MATERIAL_SPECS,
      stockBarLengthM: entry.engineeringAssumptions?.stockBarLengthM || DEFAULT_MATERIAL_SPECS.stockBarLengthM,
    };

    // 2. Execute calculation through production engine
    const calc = calculateMember(member, 1, rules);

    // 3. Compare with reference quantities
    const compConcrete = compareComponent('concreteVolumeM3', calc.volumeNetM3, entry.referenceQuantity.concreteVolumeM3);
    const compFormwork = compareComponent('formworkAreaM2', calc.formworkNetM2, entry.referenceQuantity.formworkAreaM2);
    const compRebar = compareComponent('rebarWeightKg', calc.rebarWeightKg || 0, entry.referenceQuantity.rebarWeightKg);

    // 4. False release detection:
    // If system auto-released, but any component had relative error > FALSE_RELEASE_TOLERANCE_PCT or division by zero
    const maxRelError = Math.max(
      compConcrete.relErrorPct || 0,
      compFormwork.relErrorPct || 0,
      compRebar.relErrorPct || 0
    );
    const hasSevereZeroDiv = compConcrete.isZeroDiv || compFormwork.isZeroDiv || compRebar.isZeroDiv;
    const isFalseRelease =
      entry.groundTruthStatus !== 'INVALID' &&
      calc.status === 'AUTO_RELEASE' &&
      (maxRelError > FALSE_RELEASE_TOLERANCE_PCT || hasSevereZeroDiv);

    // 5. Diagnose discrepancies
    const diagCtx = {
      memberType: entry.memberType,
      dimensions: entry.dimensions,
      reinforcement: entry.reinforcement,
      systemConcreteM3: calc.volumeNetM3,
      refConcreteM3: entry.referenceQuantity.concreteVolumeM3,
      systemFormworkM2: calc.formworkNetM2,
      refFormworkM2: entry.referenceQuantity.formworkAreaM2,
      systemRebarKg: calc.rebarWeightKg || 0,
      refRebarKg: entry.referenceQuantity.rebarWeightKg,
      systemFlags: calc.flags || [],
      rebarDetails: calc.rebarDetails ? {
        netWeightKg: calc.rebarDetails.netWeightKg,
        hookWeightKg: calc.rebarDetails.hookWeightKg,
        lapWeightKg: calc.rebarDetails.lapWeightKg,
        wastageWeightKg: calc.rebarDetails.wastageWeightKg,
      } : undefined,
      groundTruthStatus: entry.groundTruthStatus,
      notes: entry.notes,
    };

    const diagnostics = diagnoseDiscrepancy(diagCtx);
    if (diagnostics.length) {
      allDiagnostics.push({ memberId: entry.memberId, tag: entry.tag, diagnostics });
      for (const d of diagnostics) flatDiagnostics.push(d);
    }

    evaluations.push({
      memberId: entry.memberId,
      tag: entry.tag,
      memberType: entry.memberType,
      groundTruthStatus: entry.groundTruthStatus,
      systemStatus: calc.status,
      reviewWarnings: calc.reviewWarnings || [],
      flags: (calc.flags || []).map(f => ({ code: f.code, severity: f.severity, message: f.message })),
      components: {
        concrete: compConcrete,
        formwork: compFormwork,
        rebar: compRebar,
      },
      isFalseRelease,
      errorLabels: diagnostics.map(d => d.errorType),
    });
  }

  const tTotalMs = Number((performance.now() - tStart).toFixed(2));
  const metrics = aggregateEvaluationResults(evaluations, tTotalMs);
  const errorSummary = summarizeErrorTypes(flatDiagnostics);

  return {
    metadata: {
      datasetId: dataset.datasetId,
      datasetVersion: dataset.datasetVersion,
      split: dataset.split,
      projectId: dataset.projectId,
      projectName: dataset.projectName,
      drawingFile: dataset.drawingFile,
      runTimestamp: new Date().toISOString(),
      engineVersion: '8.0.0-round8',
      engineCommit: commitHash,
    },
    metrics,
    errorSummary,
    diagnostics: allDiagnostics,
    memberEvaluations: evaluations,
  };
}

/** CLI entry point */
if (process.argv[1] && process.argv[1].endsWith('run_benchmark.ts')) {
  const benchmarkDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const filePath = process.argv[2] || path.join(benchmarkDir, 'datasets', 'synthetic_smoke_test.json');
  console.log(`Loading benchmark dataset: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const valErrors = validateBenchmarkDataset(raw);
  if (valErrors.length > 0) {
    console.error(`Dataset validation failed with ${valErrors.length} errors:`);
    for (const e of valErrors) {
      console.error(`  - [${e.field}] ${e.error} ${e.memberId ? `(memberId: ${e.memberId})` : ''}`);
    }
    process.exit(1);
  }

  console.log(`Dataset validated successfully. Running benchmark on ${raw.benchmarkEntries.length} entries...`);
  const result = executeBenchmark(raw);

  // Write output to results directory
  const resultsDir = path.join(benchmarkDir, 'results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const outName = `benchmark_result_${raw.datasetId}_${Date.now()}.json`;
  const outPath = path.join(resultsDir, outName);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`\n======================================================`);
  console.log(`BENCHMARK RESULT: ${raw.projectName} (${raw.split.toUpperCase()})`);
  console.log(`Total Members: ${result.metrics.totalMembers} | Evaluated: ${result.metrics.evaluatedMembers} | Verified: ${result.metrics.verifiedMembers}`);
  console.log(`Processing Time: ${result.metrics.processingTimeMs} ms (${result.metrics.avgProcessingTimePerMemberMs} ms/member)`);
  console.log(`NEEDS_REVIEW Rate: ${result.metrics.needsReviewRatePct}% (${result.metrics.needsReviewCount}/${result.metrics.totalMembers})`);
  console.log(`False Release Count: ${result.metrics.falseReleaseCount} (${result.metrics.falseReleaseRatePct}% of Auto Releases)`);
  console.log(`------------------------------------------------------`);
  console.log(`ACCURACY BY COMPONENT:`);
  console.log(`  Concrete:   MdAPE=${result.metrics.byComponent.concrete.medianAbsPercentageError}% | P90=${result.metrics.byComponent.concrete.p90AbsPercentageError}% | Max=${result.metrics.byComponent.concrete.maxAbsPercentageError}%`);
  console.log(`  Formwork:   MdAPE=${result.metrics.byComponent.formwork.medianAbsPercentageError}% | P90=${result.metrics.byComponent.formwork.p90AbsPercentageError}% | Max=${result.metrics.byComponent.formwork.maxAbsPercentageError}%`);
  console.log(`  Rebar:      MdAPE=${result.metrics.byComponent.rebar.medianAbsPercentageError}% | P90=${result.metrics.byComponent.rebar.p90AbsPercentageError}% | Max=${result.metrics.byComponent.rebar.maxAbsPercentageError}%`);
  console.log(`------------------------------------------------------`);
  console.log(`Results saved to: ${outPath}`);
  console.log(`======================================================\n`);
}
