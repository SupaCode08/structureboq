/**
 * StructBOQ Benchmark Error Analysis Engine
 *
 * Implements granular taxonomy and diagnostic heuristics for structural quantity discrepancies.
 */

export type BenchmarkErrorType =
  | 'OCR_ERROR'
  | 'DRAWING_INTERPRETATION_ERROR'
  | 'DIMENSION_ERROR'
  | 'REINFORCEMENT_COUNT_ERROR'
  | 'COVER_ERROR'
  | 'HOOK_ASSUMPTION_ERROR'
  | 'LAP_ASSUMPTION_ERROR'
  | 'UNIT_CONVERSION_ERROR'
  | 'FORMULA_ERROR'
  | 'MEASUREMENT_CONVENTION_MISMATCH'
  | 'REFERENCE_DATA_ERROR'
  | 'UNKNOWN';

export interface ErrorDiagnostic {
  errorType: BenchmarkErrorType;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  component: 'concrete' | 'formwork' | 'rebar' | 'general';
  description: string;
  evidence: string;
}

export interface DiscrepancyContext {
  memberType: 'FOOTING' | 'COLUMN' | 'BEAM' | 'SLAB';
  dimensions: { width: number; depth: number; length: number; count?: number; unit?: string };
  reinforcement?: { topRebar?: string; bottomRebar?: string; stirrupRebar?: string };
  systemConcreteM3: number;
  refConcreteM3: number;
  systemFormworkM2: number;
  refFormworkM2: number;
  systemRebarKg: number;
  refRebarKg: number;
  systemFlags: { code: string; severity: string; message: string }[];
  rebarDetails?: {
    netWeightKg?: number;
    hookWeightKg?: number;
    lapWeightKg?: number;
    wastageWeightKg?: number;
  };
  groundTruthStatus: string;
  notes?: string;
}

/** Diagnoses error causes using structural heuristics */
export function diagnoseDiscrepancy(ctx: DiscrepancyContext, tolerancePct = 3.0): ErrorDiagnostic[] {
  const diagnostics: ErrorDiagnostic[] = [];

  if (ctx.groundTruthStatus === 'INVALID') {
    diagnostics.push({
      errorType: 'REFERENCE_DATA_ERROR',
      severity: 'CRITICAL',
      component: 'general',
      description: 'Reference quantity marked INVALID by reviewer and cannot be used as ground truth',
      evidence: `Ground truth status: ${ctx.groundTruthStatus}`,
    });
    return diagnostics;
  }

  // 1. Concrete volume analysis
  if (ctx.refConcreteM3 > 0) {
    const diffPct = Math.abs((ctx.systemConcreteM3 - ctx.refConcreteM3) / ctx.refConcreteM3) * 100;
    if (diffPct > tolerancePct) {
      const ratio = ctx.systemConcreteM3 / ctx.refConcreteM3;
      if (Math.abs(ratio - 10) < 0.1 || Math.abs(ratio - 100) < 1 || Math.abs(ratio - 0.1) < 0.01 || Math.abs(ratio - 0.001) < 0.0001) {
        diagnostics.push({
          errorType: 'UNIT_CONVERSION_ERROR',
          severity: 'CRITICAL',
          component: 'concrete',
          description: 'Concrete volume difference matches unit conversion scalar (10x, 100x, 1000x)',
          evidence: `System: ${ctx.systemConcreteM3} m³, Ref: ${ctx.refConcreteM3} m³ (ratio: ${ratio.toFixed(3)})`,
        });
      } else {
        diagnostics.push({
          errorType: 'DIMENSION_ERROR',
          severity: 'MAJOR',
          component: 'concrete',
          description: `Concrete volume differs by ${diffPct.toFixed(1)}%`,
          evidence: `System: ${ctx.systemConcreteM3} m³, Ref: ${ctx.refConcreteM3} m³`,
        });
      }
    }
  }

  // 2. Formwork area analysis
  if (ctx.refFormworkM2 > 0) {
    const diffPct = Math.abs((ctx.systemFormworkM2 - ctx.refFormworkM2) / ctx.refFormworkM2) * 100;
    if (diffPct > tolerancePct) {
      const concreteMatches =
        ctx.refConcreteM3 > 0 &&
        Math.abs((ctx.systemConcreteM3 - ctx.refConcreteM3) / ctx.refConcreteM3) * 100 <= tolerancePct;

      if (concreteMatches) {
        diagnostics.push({
          errorType: 'MEASUREMENT_CONVENTION_MISMATCH',
          severity: 'MINOR',
          component: 'formwork',
          description: `Formwork contact area differs by ${diffPct.toFixed(1)}% while concrete volume matches — measurement convention mismatch (e.g., slab-beam intersection face deduction or ground-beam soffit convention)`,
          evidence: `System: ${ctx.systemFormworkM2} m², Ref: ${ctx.refFormworkM2} m² (Concrete: ${ctx.systemConcreteM3} m³ vs ${ctx.refConcreteM3} m³)`,
        });
      } else {
        diagnostics.push({
          errorType: 'FORMULA_ERROR',
          severity: 'MINOR',
          component: 'formwork',
          description: `Formwork contact area differs by ${diffPct.toFixed(1)}% (check face deductions or geometry)`,
          evidence: `System: ${ctx.systemFormworkM2} m², Ref: ${ctx.refFormworkM2} m²`,
        });
      }
    }
  }

  // 3. Reinforcement weight analysis
  if (ctx.refRebarKg > 0) {
    const diffPct = Math.abs((ctx.systemRebarKg - ctx.refRebarKg) / ctx.refRebarKg) * 100;
    if (diffPct > tolerancePct) {
      const diffKg = ctx.systemRebarKg - ctx.refRebarKg;

      // Check if hook weight accounts for difference (e.g. footing upturn vs standard hook)
      if (ctx.rebarDetails?.hookWeightKg != null && Math.abs(Math.abs(diffKg) - ctx.rebarDetails.hookWeightKg) < 2.0) {
        diagnostics.push({
          errorType: 'HOOK_ASSUMPTION_ERROR',
          severity: 'MAJOR',
          component: 'rebar',
          description: 'Rebar discrepancy matches hook extension calculation',
          evidence: `Discrepancy: ${diffKg.toFixed(2)} kg vs Hook Weight: ${ctx.rebarDetails.hookWeightKg.toFixed(2)} kg`,
        });
      } else if (ctx.rebarDetails?.lapWeightKg != null && Math.abs(Math.abs(diffKg) - ctx.rebarDetails.lapWeightKg) < 2.0) {
        diagnostics.push({
          errorType: 'LAP_ASSUMPTION_ERROR',
          severity: 'MAJOR',
          component: 'rebar',
          description: 'Rebar discrepancy matches lap splice addition',
          evidence: `Discrepancy: ${diffKg.toFixed(2)} kg vs Lap Weight: ${ctx.rebarDetails.lapWeightKg.toFixed(2)} kg`,
        });
      } else if (ctx.systemFlags.some(f => f.code === 'COVER_EXCEEDS_DIMENSION' || f.code === 'COVER_INVALID')) {
        diagnostics.push({
          errorType: 'COVER_ERROR',
          severity: 'CRITICAL',
          component: 'rebar',
          description: 'Concrete cover conflict blocked or distorted reinforcement placement',
          evidence: ctx.systemFlags.find(f => f.code.includes('COVER'))?.message || 'Cover error',
        });
      } else if (ctx.systemFlags.some(f => f.code === 'REBAR_SPACING_INVALID')) {
        diagnostics.push({
          errorType: 'DRAWING_INTERPRETATION_ERROR',
          severity: 'CRITICAL',
          component: 'rebar',
          description: 'Invalid reinforcement spacing token rejected calculation',
          evidence: ctx.systemFlags.find(f => f.code === 'REBAR_SPACING_INVALID')?.message || 'Invalid spacing',
        });
      } else {
        diagnostics.push({
          errorType: 'REINFORCEMENT_COUNT_ERROR',
          severity: 'MAJOR',
          component: 'rebar',
          description: `Reinforcement steel weight differs by ${diffPct.toFixed(1)}%`,
          evidence: `System: ${ctx.systemRebarKg} kg, Ref: ${ctx.refRebarKg} kg (diff: ${diffKg.toFixed(2)} kg)`,
        });
      }
    }
  }

  if (diagnostics.length === 0) {
    // If no error exceeded tolerance, no diagnostics needed
    return [];
  }

  return diagnostics;
}

/** Summarizes frequency of error types across all benchmark discrepancies */
export function summarizeErrorTypes(allDiagnostics: ErrorDiagnostic[]): Record<BenchmarkErrorType, number> {
  const summary: Record<BenchmarkErrorType, number> = {
    OCR_ERROR: 0,
    DRAWING_INTERPRETATION_ERROR: 0,
    DIMENSION_ERROR: 0,
    REINFORCEMENT_COUNT_ERROR: 0,
    COVER_ERROR: 0,
    HOOK_ASSUMPTION_ERROR: 0,
    LAP_ASSUMPTION_ERROR: 0,
    UNIT_CONVERSION_ERROR: 0,
    FORMULA_ERROR: 0,
    MEASUREMENT_CONVENTION_MISMATCH: 0,
    REFERENCE_DATA_ERROR: 0,
    UNKNOWN: 0,
  };

  for (const d of allDiagnostics) {
    summary[d.errorType] = (summary[d.errorType] || 0) + 1;
  }

  return summary;
}
