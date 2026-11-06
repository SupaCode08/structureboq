/**
 * StructBOQ Benchmark Metrics Engine
 *
 * Implements rigorous statistical and engineering validation metrics for
 * comparing structural takeoff system outputs against verified reference quantities.
 *
 * Core Principles:
 * 1. Non-canceling error aggregation at member level.
 * 2. Explicit division-by-zero protection.
 * 3. Segregation by member type and quantity component.
 * 4. Identification of False Releases (unflagged defective takeoffs).
 */

export interface ComponentComparison {
  key: 'concreteVolumeM3' | 'formworkAreaM2' | 'rebarWeightKg';
  systemVal: number;
  refVal: number;
  absError: number;
  signedError: number;
  relErrorPct: number | null; // null if refVal == 0
  isZeroDiv: boolean;
}

export interface MemberEvaluationResult {
  memberId: string;
  tag: string;
  memberType: 'FOOTING' | 'COLUMN' | 'BEAM' | 'SLAB';
  groundTruthStatus: 'VERIFIED' | 'BOQ_REFERENCE' | 'ESTIMATED' | 'INVALID';
  systemStatus: 'AUTO_RELEASE' | 'NEEDS_REVIEW' | 'REJECTED';
  reviewWarnings: string[];
  flags: { code: string; severity: string; message: string }[];
  components: {
    concrete: ComponentComparison;
    formwork: ComponentComparison;
    rebar: ComponentComparison;
  };
  isFalseRelease: boolean; // AUTO_RELEASE with any relError > tolerance or block flag
  errorLabels: string[];
}

export interface MetricSummary {
  count: number;
  validPercentageCount: number;
  zeroDivCount: number;
  meanSignedError: number;
  medianSignedError: number;
  meanAbsError: number;
  medianAbsPercentageError: number; // MdAPE (%)
  p90AbsPercentageError: number;    // P90 APE (%)
  maxAbsPercentageError: number;    // Max APE (%)
}

export interface AggregatedMetrics {
  totalMembers: number;
  evaluatedMembers: number;
  verifiedMembers: number;
  invalidMembers: number;
  needsReviewCount: number;
  needsReviewRatePct: number;
  autoReleaseCount: number;
  falseReleaseCount: number;
  falseReleaseRatePct: number;
  processingTimeMs: number;
  avgProcessingTimePerMemberMs: number;

  byComponent: {
    concrete: MetricSummary;
    formwork: MetricSummary;
    rebar: MetricSummary;
  };

  verifiedOnlyByComponent: {
    concrete: MetricSummary;
    formwork: MetricSummary;
    rebar: MetricSummary;
  };

  byMemberType: Record<'FOOTING' | 'COLUMN' | 'BEAM' | 'SLAB', {
    memberCount: number;
    concrete: MetricSummary;
    formwork: MetricSummary;
    rebar: MetricSummary;
    falseReleaseCount: number;
    needsReviewCount: number;
  }>;
}

export const FALSE_RELEASE_TOLERANCE_PCT = 5.0; // Any AUTO_RELEASE with > 5% error is a false release

/** Computes single component comparison with strict zero division handling */
export function compareComponent(
  key: 'concreteVolumeM3' | 'formworkAreaM2' | 'rebarWeightKg',
  systemVal: number,
  refVal: number
): ComponentComparison {
  const signedError = Number((systemVal - refVal).toFixed(4));
  const absError = Number(Math.abs(signedError).toFixed(4));

  if (refVal === 0) {
    if (systemVal === 0) {
      return { key, systemVal, refVal, absError: 0, signedError: 0, relErrorPct: 0, isZeroDiv: false };
    }
    // Non-zero system value with zero reference
    return { key, systemVal, refVal, absError, signedError, relErrorPct: null, isZeroDiv: true };
  }

  const relErrorPct = Number(((absError / refVal) * 100).toFixed(2));
  return { key, systemVal, refVal, absError, signedError, relErrorPct, isZeroDiv: false };
}

/** Computes quantile (e.g. 0.5 for median, 0.9 for P90) on numerical array */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return Number((sorted[base] + rest * (sorted[base + 1] - sorted[base])).toFixed(2));
  }
  return Number(sorted[base].toFixed(2));
}

/** Summarizes an array of component comparisons without cross-member cancellation */
export function summarizeComponentComparisons(comparisons: ComponentComparison[]): MetricSummary {
  const count = comparisons.length;
  if (count === 0) {
    return {
      count: 0,
      validPercentageCount: 0,
      zeroDivCount: 0,
      meanSignedError: 0,
      medianSignedError: 0,
      meanAbsError: 0,
      medianAbsPercentageError: 0,
      p90AbsPercentageError: 0,
      maxAbsPercentageError: 0,
    };
  }

  const signedErrors = comparisons.map(c => c.signedError);
  const absErrors = comparisons.map(c => c.absError);
  const zeroDivCount = comparisons.filter(c => c.isZeroDiv).length;
  const validPcts = comparisons
    .filter(c => c.relErrorPct !== null)
    .map(c => c.relErrorPct as number);

  const meanSignedError = Number((signedErrors.reduce((a, b) => a + b, 0) / count).toFixed(4));
  const medianSignedError = quantile(signedErrors, 0.5);
  const meanAbsError = Number((absErrors.reduce((a, b) => a + b, 0) / count).toFixed(4));

  const medianAbsPercentageError = validPcts.length ? quantile(validPcts, 0.5) : 0;
  const p90AbsPercentageError = validPcts.length ? quantile(validPcts, 0.9) : 0;
  const maxAbsPercentageError = validPcts.length ? Number(Math.max(...validPcts).toFixed(2)) : 0;

  return {
    count,
    validPercentageCount: validPcts.length,
    zeroDivCount,
    meanSignedError,
    medianSignedError,
    meanAbsError,
    medianAbsPercentageError,
    p90AbsPercentageError,
    maxAbsPercentageError,
  };
}

/** Aggregates a full benchmark evaluation set into comprehensive metrics */
export function aggregateEvaluationResults(
  evaluations: MemberEvaluationResult[],
  processingTimeMs: number
): AggregatedMetrics {
  const totalMembers = evaluations.length;
  const validEvaluations = evaluations.filter(e => e.groundTruthStatus !== 'INVALID');
  const verifiedEvaluations = evaluations.filter(e => e.groundTruthStatus === 'VERIFIED');
  const evaluatedMembers = validEvaluations.length;
  const verifiedMembers = verifiedEvaluations.length;
  const invalidMembers = totalMembers - evaluatedMembers;
  const needsReviewCount = evaluations.filter(e => e.systemStatus === 'NEEDS_REVIEW' || e.systemStatus === 'REJECTED').length;
  const needsReviewRatePct = totalMembers ? Number(((needsReviewCount / totalMembers) * 100).toFixed(2)) : 0;

  const autoReleaseCount = evaluations.filter(e => e.systemStatus === 'AUTO_RELEASE').length;
  const falseReleaseCount = evaluations.filter(e => e.isFalseRelease).length;
  const falseReleaseRatePct = autoReleaseCount ? Number(((falseReleaseCount / autoReleaseCount) * 100).toFixed(2)) : 0;

  const concreteComps = validEvaluations.map(e => e.components.concrete);
  const formworkComps = validEvaluations.map(e => e.components.formwork);
  const rebarComps = validEvaluations.map(e => e.components.rebar);

  const verifiedConcreteComps = verifiedEvaluations.map(e => e.components.concrete);
  const verifiedFormworkComps = verifiedEvaluations.map(e => e.components.formwork);
  const verifiedRebarComps = verifiedEvaluations.map(e => e.components.rebar);

  const memberTypes: ('FOOTING' | 'COLUMN' | 'BEAM' | 'SLAB')[] = ['FOOTING', 'COLUMN', 'BEAM', 'SLAB'];
  const byMemberType: any = {};

  for (const mType of memberTypes) {
    const subset = evaluations.filter(e => e.memberType === mType);
    const validSubset = subset.filter(e => e.groundTruthStatus !== 'INVALID');
    byMemberType[mType] = {
      memberCount: subset.length,
      concrete: summarizeComponentComparisons(validSubset.map(e => e.components.concrete)),
      formwork: summarizeComponentComparisons(validSubset.map(e => e.components.formwork)),
      rebar: summarizeComponentComparisons(validSubset.map(e => e.components.rebar)),
      falseReleaseCount: subset.filter(e => e.isFalseRelease).length,
      needsReviewCount: subset.filter(e => e.systemStatus === 'NEEDS_REVIEW' || e.systemStatus === 'REJECTED').length,
    };
  }

  return {
    totalMembers,
    evaluatedMembers,
    verifiedMembers,
    invalidMembers,
    needsReviewCount,
    needsReviewRatePct,
    autoReleaseCount,
    falseReleaseCount,
    falseReleaseRatePct,
    processingTimeMs,
    avgProcessingTimePerMemberMs: totalMembers ? Number((processingTimeMs / totalMembers).toFixed(2)) : 0,
    byComponent: {
      concrete: summarizeComponentComparisons(concreteComps),
      formwork: summarizeComponentComparisons(formworkComps),
      rebar: summarizeComponentComparisons(rebarComps),
    },
    verifiedOnlyByComponent: {
      concrete: summarizeComponentComparisons(verifiedConcreteComps),
      formwork: summarizeComponentComparisons(verifiedFormworkComps),
      rebar: summarizeComponentComparisons(verifiedRebarComps),
    },
    byMemberType,
  };
}
