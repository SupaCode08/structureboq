/**
 * StructBOQ - Quantity Surveying Calculation Engine (TypeScript / Full-Stack)
 * Implements SMM / Comptroller General's Structural Standard for Concrete Beams, Columns, Footings, Slabs, and Stairs.
 *
 * Every item carries its drawing provenance and a list of review flags. Items with no flags
 * and high extraction confidence are auto-released, so a reviewer only has to look at the
 * items that actually need a human decision.
 */

export type ValidationStatus = 'AUTO_RELEASE' | 'NEEDS_REVIEW' | 'REJECTED';
export type MemberType = 'BEAM' | 'COLUMN' | 'SLAB' | 'FOOTING' | 'STAIR' | 'WALL' | 'DOOR' | 'WINDOW' | 'FINISH';

export interface RebarBarDetail {
  bar: string;
  grade: 'SR24' | 'SD30' | 'SD40' | 'SD50';
  diaMm: number;
  count: number;
  lengthM: number;
  totalLengthM: number;
  unitWeightKgM: number;
  totalWeightKg: number;
  purpose: string;
}

export interface RebarSummaryDetails {
  totalWeightKg: number;
  bindingWireKg: number;
  mainBarsKg: number;
  stirrupsKg: number;
  footingMeshKg: number;
  slabRebarKg: number;
  byGrade: {
    sr24Kg: number;
    sd30Kg: number;
    sd40Kg: number;
    sd50Kg: number;
  };
  barList: RebarBarDetail[];
}

/** Where a field value came from. */
export type FieldSource = 'drawing' | 'grid' | 'inferred' | 'assumed' | 'missing' | 'reviewer';

export interface EvidenceRef {
  page: number;
  bboxNorm?: [number, number, number, number];
  label: string;
  text?: string;
  method: 'pdf_text' | 'vision' | 'dxf' | 'manual';
  memberType?: MemberType;
}

export interface Provenance {
  evidence: EvidenceRef[];
  fieldSources: Record<string, FieldSource>;
  confidence: number;
  conflicts?: string[];
}

export interface ReviewDecision {
  status: 'approved' | 'rejected';
  note?: string;
  at: string;
}

export interface ReviewFlag {
  code: string;
  severity: 'info' | 'warn' | 'block';
  field?: string;
  message: string;
}

export interface DeductionDetail {
  ruleName: string;
  deductionM: number;
  description: string;
}

export interface ExtractedMember {
  tag: string;
  memberType: MemberType;
  width: number;
  depth: number;
  length: number;
  count?: number;
  unit?: string;
  gridLocation?: string;
  level?: string;
  sourceFile?: string;
  sourceSheetOrLayer?: string;
  rawDimensionStr?: string;
  supportColW1?: number;
  supportColW2?: number;
  isClearSpan?: boolean;
  notes?: string;
  topRebar?: string;
  bottomRebar?: string;
  stirrupRebar?: string;
  stirrupSets?: number;
  thickness?: number;
  slabType?: 'CAST_IN_PLACE' | 'PRECAST_PLANK' | 'SLAB_ON_GROUND';
  footingType?: 'ISOLATED' | 'PILE_CAP';
  pileCount?: number;
  excavationDepthM?: number;
  sandThicknessM?: number;
  coords?: { x1: number; y1: number; x2: number; y2: number };
  provenance?: Provenance;
  review?: ReviewDecision;
}

export interface CalculatedQuantity {
  itemId: string;
  tag: string;
  memberType: MemberType;
  count: number;
  widthM: number;
  depthM: number;
  lengthGrossM: number;
  deductionM: number;
  lengthNetM: number;
  volumeGrossM3: number;
  volumeNetM3: number;
  formworkNetM2: number;
  status: ValidationStatus;
  formulaStr: string;
  deductions: DeductionDetail[];
  rejectionReasons: string[];
  reviewWarnings: string[];
  sourceInfo: string;
  gridLocation: string;
  level: string;
  confidenceBasis: string;
  rebarWeightKg?: number;
  rebarFormulaStr?: string;
  rebarByDia?: Record<string, number>;
  rebarDetails?: RebarSummaryDetails;
  wallAreaM2?: number;
  plasterAreaM2?: number;
  openingsCount?: number;
  materialCostThb?: number;
  wageCostThb?: number;
  totalCostThb?: number;
  earthworkCostThb?: { material: number; wage: number };
  leanConcreteM3?: number;
  sandBeddingM3?: number;
  excavationM3?: number;
  backfillM3?: number;
  pilesNos?: number;
  precastSlabM2?: number;
  wiremeshM2?: number;
  coords?: { x1: number; y1: number; x2: number; y2: number };
  provenance?: Provenance;
  flags?: ReviewFlag[];
  confidencePct?: number;
  review?: ReviewDecision;
  memberIndex?: number;
}

export interface MaterialSpecs {
  concreteGrade: string;
  concreteMatRate: number;
  concreteLaborRate: number;
  concreteWastagePct: number;
  formworkType: string;
  formworkMatRate: number;
  formworkLaborRate: number;
  formworkWastagePct: number;
  mainRebarGrade: string;
  mainRebarMatRate: number;
  mainRebarLaborRate: number;
  stirrupGrade: string;
  stirrupMatRate: number;
  stirrupLaborRate: number;
  rebarWastagePct: number;
  concreteCoveringCm: number;
  leanConcreteMatRate: number;
  leanConcreteLaborRate: number;
  sandBedMatRate: number;
  sandBedLaborRate: number;
  excavationRate: number;
  backfillRate: number;
  precastSlabMatRate: number;
  precastSlabLaborRate: number;
  wiremeshMatRate: number;
  wiremeshLaborRate: number;
  sourceText?: string;
  excavationMarginM?: number;
  excavationBulkingFactor?: number;
  leanThicknessM?: number;
  sandThicknessM?: number;
  slabSandThicknessM?: number;
  groundBeamSoffitFormwork?: boolean;
  wallMasonryMatRate?: number;
  wallMasonryLaborRate?: number;
  wallPlasterMatRate?: number;
  wallPlasterLaborRate?: number;
  doorMatRate?: number;
  doorLaborRate?: number;
  windowMatRate?: number;
  windowLaborRate?: number;
  floorFinishMatRate?: number;
  floorFinishLaborRate?: number;
}

export const DEFAULT_MATERIAL_SPECS: MaterialSpecs = {
  concreteGrade: 'C25/30 (240 ksc คิวบ์)',
  concreteMatRate: 2100,
  concreteLaborRate: 450,
  concreteWastagePct: 5,
  formworkType: 'ไม้แบบหล่อทั่วไปรวมค้ำยัน',
  formworkMatRate: 350,
  formworkLaborRate: 150,
  formworkWastagePct: 10,
  mainRebarGrade: 'SD40 (ข้ออ้อย DB12-DB25)',
  mainRebarMatRate: 28.50,
  mainRebarLaborRate: 4.50,
  stirrupGrade: 'SR24 (เหล็กกลม RB6-RB9)',
  stirrupMatRate: 28.00,
  stirrupLaborRate: 4.50,
  rebarWastagePct: 7,
  concreteCoveringCm: 3.5,
  leanConcreteMatRate: 1750,
  leanConcreteLaborRate: 380,
  sandBedMatRate: 480,
  sandBedLaborRate: 120,
  excavationRate: 120,
  backfillRate: 80,
  precastSlabMatRate: 260,
  precastSlabLaborRate: 50,
  wiremeshMatRate: 45,
  wiremeshLaborRate: 10,
  sourceText: 'มาตรฐานราคากลางงานก่อสร้าง กรมบัญชีกลาง (ปร.4)',
  excavationMarginM: 0.10,
  excavationBulkingFactor: 1.0,
  leanThicknessM: 0.05,
  sandThicknessM: 0.05,
  slabSandThicknessM: 0.05,
  groundBeamSoffitFormwork: true,
  wallMasonryMatRate: 240,
  wallMasonryLaborRate: 95,
  wallPlasterMatRate: 140,
  wallPlasterLaborRate: 110,
  doorMatRate: 3500,
  doorLaborRate: 500,
  windowMatRate: 2800,
  windowLaborRate: 400,
  floorFinishMatRate: 450,
  floorFinishLaborRate: 160,
};

export function normalizeMaterialSpecs(raw?: any): MaterialSpecs {
  if (!raw) return { ...DEFAULT_MATERIAL_SPECS };
  const num = (camel: string, snake: string) => Number(raw[camel] ?? raw[snake] ?? (DEFAULT_MATERIAL_SPECS as any)[camel]);
  return {
    concreteGrade: raw.concreteGrade || raw.concrete_grade || DEFAULT_MATERIAL_SPECS.concreteGrade,
    concreteMatRate: num('concreteMatRate', 'concrete_mat_rate'),
    concreteLaborRate: num('concreteLaborRate', 'concrete_labor_rate'),
    concreteWastagePct: num('concreteWastagePct', 'concrete_wastage_pct'),
    formworkType: raw.formworkType || raw.formwork_type || DEFAULT_MATERIAL_SPECS.formworkType,
    formworkMatRate: num('formworkMatRate', 'formwork_mat_rate'),
    formworkLaborRate: num('formworkLaborRate', 'formwork_labor_rate'),
    formworkWastagePct: num('formworkWastagePct', 'formwork_wastage_pct'),
    mainRebarGrade: raw.mainRebarGrade || raw.main_rebar_grade || DEFAULT_MATERIAL_SPECS.mainRebarGrade,
    mainRebarMatRate: num('mainRebarMatRate', 'main_rebar_mat_rate'),
    mainRebarLaborRate: num('mainRebarLaborRate', 'main_rebar_labor_rate'),
    stirrupGrade: raw.stirrupGrade || raw.stirrup_grade || DEFAULT_MATERIAL_SPECS.stirrupGrade,
    stirrupMatRate: num('stirrupMatRate', 'stirrup_mat_rate'),
    stirrupLaborRate: num('stirrupLaborRate', 'stirrup_labor_rate'),
    rebarWastagePct: num('rebarWastagePct', 'rebar_wastage_pct'),
    concreteCoveringCm: num('concreteCoveringCm', 'concrete_covering_cm'),
    leanConcreteMatRate: num('leanConcreteMatRate', 'lean_concrete_mat_rate'),
    leanConcreteLaborRate: num('leanConcreteLaborRate', 'lean_concrete_labor_rate'),
    sandBedMatRate: num('sandBedMatRate', 'sand_bed_mat_rate'),
    sandBedLaborRate: num('sandBedLaborRate', 'sand_bed_labor_rate'),
    excavationRate: num('excavationRate', 'excavation_rate'),
    backfillRate: num('backfillRate', 'backfill_rate'),
    precastSlabMatRate: num('precastSlabMatRate', 'precast_slab_mat_rate'),
    precastSlabLaborRate: num('precastSlabLaborRate', 'precast_slab_labor_rate'),
    wiremeshMatRate: num('wiremeshMatRate', 'wiremesh_mat_rate'),
    wiremeshLaborRate: num('wiremeshLaborRate', 'wiremesh_labor_rate'),
    sourceText: raw.sourceText || raw.source_text || DEFAULT_MATERIAL_SPECS.sourceText,
    excavationMarginM: num('excavationMarginM', 'excavation_margin_m'),
    excavationBulkingFactor: num('excavationBulkingFactor', 'excavation_bulking_factor'),
    leanThicknessM: num('leanThicknessM', 'lean_thickness_m'),
    sandThicknessM: num('sandThicknessM', 'sand_thickness_m'),
    slabSandThicknessM: num('slabSandThicknessM', 'slab_sand_thickness_m'),
    groundBeamSoffitFormwork: (raw.groundBeamSoffitFormwork ?? raw.ground_beam_soffit_formwork ?? DEFAULT_MATERIAL_SPECS.groundBeamSoffitFormwork) !== false,
  };
}

export interface FactorFParams {
  advancePaymentPct: number;
  interestRatePct: number;
  retentionPct: number;
  vatPct: number;
  overheadPct: number;
  profitPct: number;
}

export const DEFAULT_FACTOR_F_PARAMS: FactorFParams = {
  advancePaymentPct: 0,
  interestRatePct: 6,
  retentionPct: 0,
  vatPct: 7,
  overheadPct: 11.5,
  profitPct: 5.5,
};

export function computeFactorFMultiplier(params: FactorFParams = DEFAULT_FACTOR_F_PARAMS): number {
  const directFactor = 1.0 + (params.overheadPct + params.profitPct + (params.interestRatePct * 0.5)) / 100.0;
  const vatFactor = 1.0 + (params.vatPct / 100.0);
  return Number((directFactor * vatFactor).toFixed(4));
}

export interface CategorySummary {
  categoryName: string;
  categoryCode: string;
  itemCount: number;
  concreteVolumeM3: number;
  formworkAreaM2: number;
  rebarWeightKg: number;
  materialCostThb: number;
  wageCostThb: number;
  totalCostThb: number;
}

export interface ExtractionAudit {
  fileName: string;
  fileType: 'PDF' | 'DXF' | string;
  isScanned: boolean;
  pageOrLayerCount: number;
  detectedUnit: string;
  entitiesParsed: number;
  warnings: string[];
  textDensity?: number;
  materialSpecs?: MaterialSpecs;
  docId?: string;
  pages?: { page: number; width: number; height: number; kind: string }[];
}

export interface BOQProjectResult {
  projectName: string;
  totalConcreteVolumeM3: number;
  totalFormworkM2: number;
  totalItemsCount: number;
  autoReleaseCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  passRatePct: number;
  totalRebarWeightKg?: number;
  totalProjectCostThb?: number;
  factorF?: number;
  totalCostWithFactorF?: number;
  categorySummaries?: Record<string, CategorySummary>;
  items: CalculatedQuantity[];
  audit?: ExtractionAudit;
  materialSpecs?: MaterialSpecs;
  factorFParams?: FactorFParams;
  reviewedCount?: number;
}

/** Auto-release only above this extraction confidence (percent). */
export const AUTO_RELEASE_CONFIDENCE_PCT = 80;

/** Nominal mass per metre (มอก. 20 / มอก. 24). */
export const REBAR_KG_PER_M: Record<string, number> = {
  RB6: 0.222, RB9: 0.499, RB12: 0.888, RB15: 1.387, RB19: 2.226,
  DB10: 0.617, DB12: 0.888, DB16: 1.578, DB20: 2.466, DB25: 3.853, DB28: 4.834, DB32: 6.313, DB40: 9.865,
};

/**
 * Normalizes input engineering dimensions to meters (m).
 */
export function normalizeDimension(val: number, declaredUnit?: string): number {
  if (val <= 0) return val;

  if (declaredUnit) {
    const u = declaredUnit.trim().toLowerCase();
    if (u === 'mm' || u === 'millimeter' || u === 'millimeters') {
      return Number((val / 1000).toFixed(4));
    }
    if (u === 'cm' || u === 'centimeter' || u === 'centimeters') {
      return Number((val / 100).toFixed(4));
    }
    if (u === 'm' || u === 'meter' || u === 'meters') {
      if (val >= 50.0) {
        return Number((val / 1000).toFixed(4));
      }
      return Number(val.toFixed(4));
    }
  }

  if (val >= 100.0) {
    return Number((val / 1000).toFixed(4));
  }
  if (val >= 10.0 && val < 100.0) {
    return Number((val / 100).toFixed(4));
  }
  return Number(val.toFixed(4));
}

export interface BarGroup { n: number; bar: string }

const barName = (kind: string | undefined, dia: number) => {
  const k = (kind || '').toUpperCase();
  if (k === 'RB' || k === 'DB') return `${k}${dia}`;
  return `${dia < 12 ? 'RB' : 'DB'}${dia}`;
};

/** "2-DB16+2-DB12" -> [{2,DB16},{2,DB12}]; "3+3-DB12" -> [{3,DB12},{3,DB12}] */
export function parseBarGroups(spec?: string): BarGroup[] {
  if (!spec) return [];
  const out: BarGroup[] = [];
  const re = /(\d+)\s*(?:\+\s*(\d+))?\s*[- ]\s*(DB|RB|Ø|ø)?\s*(\d{1,2})(?!\s*@)/gi;
  for (const m of spec.matchAll(re)) {
    const bar = barName(m[3] === 'Ø' || m[3] === 'ø' ? undefined : m[3], Number(m[4]));
    out.push({ n: Number(m[1]), bar });
    if (m[2]) out.push({ n: Number(m[2]), bar });
  }
  return out;
}

/** "RB6@0.15m" -> {bar:'RB6', spacing:0.15} */
export function parseSpacedBar(spec?: string): { bar: string; spacing: number } | null {
  if (!spec) return null;
  const m = spec.match(/(DB|RB|Ø|ø)?\s*(\d{1,2})\s*(?:มม\.?|mm)?\s*@\s*(\d+(?:\.\d+)?)\s*(cm|mm|m|ม\.)?/i);
  if (!m) return null;
  let spacing = parseFloat(m[3]);
  const u = (m[4] || '').toLowerCase();
  if (u === 'cm' || (spacing > 1.0 && spacing < 100)) spacing /= 100.0;
  else if (u === 'mm' || spacing >= 100) spacing /= 1000.0;
  return { bar: barName(m[1] === 'Ø' || m[1] === 'ø' ? undefined : m[1], Number(m[2])), spacing };
}

const barDiaM = (bar: string) => Number(bar.replace(/\D/g, '')) / 1000;

function addBar(acc: Record<string, number>, bar: string, lengthM: number) {
  const kg = lengthM * (REBAR_KG_PER_M[bar] ?? REBAR_KG_PER_M.DB12);
  acc[bar] = Number(((acc[bar] || 0) + kg).toFixed(3));
}

export const gradeFy = (grade?: string) => Number((grade || '').match(/S[DR]\s*(\d{2})/i)?.[1] ?? 40) * 100;

export function computeDetailedRebar(
  member: ExtractedMember,
  count: number,
  wM: number,
  dM: number,
  lNetM: number,
  lGrossM: number,
  cover: number,
  rules: MaterialSpecs,
  wiremeshM2: number,
  vNet: number
): {
  bars: Record<string, number>;
  rebarFormulaStr: string;
  assumedRatio: boolean;
  minBasis: string[];
  rebarDetails?: RebarSummaryDetails;
} {
  const bars: Record<string, number> = {};
  const barList: RebarBarDetail[] = [];
  let rebarFormulaStr = '';
  let assumedRatio = false;
  const minBasis: string[] = [];

  const mainGrade: 'SD30' | 'SD40' | 'SD50' = /SD50/i.test(rules.mainRebarGrade)
    ? 'SD50'
    : /SD30/i.test(rules.mainRebarGrade)
    ? 'SD30'
    : 'SD40';
  const stirrupGrade: 'SR24' = 'SR24';

  const pushBarItem = (
    bar: string,
    dia: number,
    numPieces: number,
    cutLenM: number,
    purpose: string,
    forceGrade?: 'SR24' | 'SD30' | 'SD40' | 'SD50'
  ) => {
    const isRound = bar.startsWith('RB') || dia < 12;
    const grade = forceGrade || (isRound ? stirrupGrade : mainGrade);
    const unitWt = REBAR_KG_PER_M[bar] ?? (isRound ? 0.222 : 0.888);
    const totLen = Number((numPieces * cutLenM).toFixed(3));
    const totWt = Number((totLen * unitWt).toFixed(2));
    addBar(bars, bar, totLen);
    barList.push({
      bar,
      grade,
      diaMm: dia,
      count: numPieces,
      lengthM: Number(cutLenM.toFixed(3)),
      totalLengthM: totLen,
      unitWeightKgM: unitWt,
      totalWeightKg: totWt,
      purpose,
    });
  };

  if (member.memberType === 'FOOTING') {
    const spaced = parseSpacedBar(member.bottomRebar);
    const groups = parseBarGroups(member.bottomRebar);
    const hook = Math.max(0.10, lNetM - 2 * cover);
    let nx: number, ny: number, bar: string;
    if (groups.length >= 2) {
      nx = groups[0].n;
      ny = groups[1].n;
      bar = groups[0].bar;
    } else if (groups.length === 1) {
      nx = groups[0].n;
      ny = groups[0].n;
      bar = groups[0].bar;
    } else {
      const s = spaced?.spacing || 0.15;
      bar = spaced?.bar || 'DB12';
      nx = Math.max(3, Math.floor((dM - 2 * cover) / s) + 1);
      ny = Math.max(3, Math.floor((wM - 2 * cover) / s) + 1);
    }
    const dia = Number(bar.replace(/\D/g, '')) || 12;
    const lenX = wM - 2 * cover + 2 * hook;
    const lenY = dM - 2 * cover + 2 * hook;
    pushBarItem(bar, dia, count * nx, lenX, 'ตะแกรงก้นฐานรากแนวแกน X (งอขอฉาก)');
    pushBarItem(bar, dia, count * ny, lenY, 'ตะแกรงก้นฐานรากแนวแกน Y (งอขอฉาก)');
    rebarFormulaStr = `ตะแกรงก้นฐานราก ${nx}+${ny}-${bar} (ปลายงอขึ้น ${hook.toFixed(2)}m)`;
  } else if (member.memberType === 'SLAB') {
    if (wiremeshM2 > 0) {
      rebarFormulaStr = `ตะแกรงเหล็กไวร์เมช Ø4mm@0.15m = ${wiremeshM2} m²`;
    } else {
      const layers = [parseSpacedBar(member.topRebar), parseSpacedBar(member.bottomRebar)].filter(Boolean) as { bar: string; spacing: number }[];
      if (layers.length) {
        for (const l of layers) {
          const dia = Number(l.bar.replace(/\D/g, '')) || 9;
          const pieces = count * (wM * dM) * (2 / l.spacing);
          const cutLen = 1.10;
          pushBarItem(l.bar, dia, Math.ceil(pieces), cutLen, 'เหล็กพื้น ค.ส.ล. สองทาง');
        }
        rebarFormulaStr = layers.map(l => `${l.bar}@${l.spacing}m สองทาง`).join(' + ') + ` × ${(wM * dM).toFixed(2)} m²`;
      } else {
        const kgNeeded = (vNet * 95.0);
        const dia = 12;
        const unitWt = REBAR_KG_PER_M.DB12;
        const totLen = kgNeeded / unitWt;
        addBar(bars, 'DB12', totLen);
        barList.push({
          bar: 'DB12',
          grade: mainGrade,
          diaMm: dia,
          count: Math.ceil(totLen / 3.0),
          lengthM: 3.0,
          totalLengthM: Number(totLen.toFixed(3)),
          unitWeightKgM: unitWt,
          totalWeightKg: Number(kgNeeded.toFixed(2)),
          purpose: 'เหล็กเสริมพื้น ค.ส.ล. (อัตราเฉลี่ย 95 kg/m³)',
        });
        assumedRatio = true;
        rebarFormulaStr = `เหล็กเสริมพื้น ค.ส.ล. (ค่าเฉลี่ย 95 kg/m³)`;
      }
    }
  } else if (member.memberType === 'STAIR') {
    const main = parseSpacedBar(member.bottomRebar);
    const dist = parseSpacedBar(member.topRebar);
    if (main) {
      const diaM = Number(main.bar.replace(/\D/g, '')) || 12;
      const nPieces = count * Math.ceil(wM / main.spacing + 1);
      const cutLen = lNetM + 0.6;
      pushBarItem(main.bar, diaM, nPieces, cutLen, 'เหล็กบันได ค.ส.ล. ตามแนวลาด');
      if (dist) {
        const diaD = Number(dist.bar.replace(/\D/g, '')) || 9;
        const nDist = count * Math.ceil(lNetM / dist.spacing + 1);
        pushBarItem(dist.bar, diaD, nDist, wM, 'เหล็กบันได ค.ส.ล. เหล็กกระจาย');
      }
      rebarFormulaStr = `บันได: ${main.bar}@${main.spacing}m ตามลาด${dist ? ` + ${dist.bar}@${dist.spacing}m` : ''}`;
    } else {
      const kgNeeded = (vNet * 110.0);
      const totLen = kgNeeded / REBAR_KG_PER_M.DB12;
      addBar(bars, 'DB12', totLen);
      barList.push({
        bar: 'DB12',
        grade: mainGrade,
        diaMm: 12,
        count: Math.ceil(totLen / 3.0),
        lengthM: 3.0,
        totalLengthM: Number(totLen.toFixed(3)),
        unitWeightKgM: REBAR_KG_PER_M.DB12,
        totalWeightKg: Number(kgNeeded.toFixed(2)),
        purpose: 'เหล็กเสริมบันได ค.ส.ล. (ค่าเฉลี่ย 110 kg/m³)',
      });
      assumedRatio = true;
      rebarFormulaStr = `เหล็กเสริมบันได ค.ส.ล. (ค่าเฉลี่ย 110 kg/m³)`;
    }
  } else if (member.memberType === 'COLUMN' || member.memberType === 'BEAM') {
    const isCol = member.memberType === 'COLUMN';
    let main = [...parseBarGroups(member.topRebar), ...(isCol ? [] : parseBarGroups(member.bottomRebar))];
    const fy = gradeFy(rules.mainRebarGrade);
    if (!main.length) {
      const m = minimumMainBars(isCol, wM, dM, cover, fy);
      main = m.groups;
      minBasis.push(m.basis);
      assumedRatio = true;
    }
    for (let gi = 0; gi < main.length; gi++) {
      const g = main[gi];
      const db = barDiaM(g.bar);
      const diaMm = Number(g.bar.replace(/\D/g, '')) || 12;
      const len = isCol ? lGrossM + 40 * db : lGrossM + 2 * 12 * db;
      const purpose = isCol
        ? 'เหล็กแกนเสา (รวมระยะทาบ 40d)'
        : gi === 0
        ? 'เหล็กบนคาน (รวมงอขอฉาก 12d)'
        : 'เหล็กล่างคาน (รวมระยะฝังผ่านเสา 12d)';
      pushBarItem(g.bar, diaMm, count * g.n, len, purpose, mainGrade);
    }
    let st = parseSpacedBar(member.stirrupRebar);
    if (!st) {
      const t = maximumTieSpacing(isCol, wM, dM, cover, Math.max(...main.map(g => barDiaM(g.bar))));
      st = { bar: 'RB6', spacing: t.spacing };
      minBasis.push(t.basis);
    }
    const perim = Number((2 * (Math.max(0.05, wM - 2 * cover) + Math.max(0.05, dM - 2 * cover)) + 0.10).toFixed(3));
    const sets = Math.max(1, Math.round(member.stirrupSets || 1));
    const nSt = Math.max(2, Math.floor(lNetM / Math.max(0.05, st.spacing)) + 1);
    const diaSt = Number(st.bar.replace(/\D/g, '')) || 6;
    pushBarItem(st.bar, diaSt, count * sets * nSt, perim, isCol ? 'เหล็กปลอกเสา (Ties)' : 'เหล็กปลอกคาน (Stirrups)', stirrupGrade);
    rebarFormulaStr = `Main: ${main.map(g => `${g.n}-${g.bar}`).join(' + ')} | ${isCol ? 'Ties' : 'Stirrup'}: ${nSt}×${sets > 1 ? `${sets}-` : ''}${st.bar}@${st.spacing}m (รอบละ ${perim}m)`;
    if (minBasis.length) {
      rebarFormulaStr += ` [ค่าต่ำสุดตามมาตรฐาน: ${minBasis.join('; ')}]`;
    }
  }

  const totWt = Number(Object.values(bars).reduce((a, b) => a + b, 0).toFixed(2));
  const stirrupWt = barList.filter(b => b.grade === 'SR24').reduce((a, b) => a + b.totalWeightKg, 0);
  const mainWt = totWt - stirrupWt;
  const bindingWire = Number((totWt * 0.025).toFixed(2));

  const byGrade = {
    sr24Kg: Number(stirrupWt.toFixed(2)),
    sd30Kg: Number((mainGrade === 'SD30' ? mainWt : 0).toFixed(2)),
    sd40Kg: Number((mainGrade === 'SD40' ? mainWt : 0).toFixed(2)),
    sd50Kg: Number((mainGrade === 'SD50' ? mainWt : 0).toFixed(2)),
  };

  const rebarDetails: RebarSummaryDetails = {
    totalWeightKg: totWt,
    bindingWireKg: bindingWire,
    mainBarsKg: Number(mainWt.toFixed(2)),
    stirrupsKg: Number(stirrupWt.toFixed(2)),
    footingMeshKg: Number((member.memberType === 'FOOTING' ? totWt : 0).toFixed(2)),
    slabRebarKg: Number((member.memberType === 'SLAB' ? totWt : 0).toFixed(2)),
    byGrade,
    barList,
  };

  return { bars, rebarFormulaStr, assumedRatio, minBasis, rebarDetails };
}

const barAreaMm2 = (bar: string) => (Math.PI / 4) * Number(bar.replace(/\D/g, '')) ** 2;
const DEFORMED = ['DB12', 'DB16', 'DB20', 'DB25'];

/** Code minimum main bars for a section: column As ≥ 1% Ag; beam bottom As ≥ 14/fy·b·d with 2 top bars. */
export function minimumMainBars(isCol: boolean, wM: number, dM: number, cover: number, fyKsc: number): { groups: BarGroup[]; basis: string } {
  const As = isCol ? 0.01 * wM * dM * 1e6 : (14 / fyKsc) * wM * Math.max(0.05, dM - cover - 0.012) * 1e6;
  const fit = isCol
    ? Math.max(4, Math.floor((2 * (Math.max(0.05, wM - 2 * cover) + Math.max(0.05, dM - 2 * cover))) / 0.15))
    : Math.max(2, Math.floor((wM - 2 * cover - 0.012) / 0.04) + 1);
  const count = (bar: string) => { const n = Math.max(isCol ? 4 : 2, Math.ceil(As / barAreaMm2(bar))); return isCol && n % 2 ? n + 1 : n; };
  const bar = DEFORMED.find(b => count(b) <= fit) ?? DEFORMED[DEFORMED.length - 1];
  const n = count(bar);
  return isCol
    ? { groups: [{ n, bar }], basis: `เสา As ≥ 1% = ${Math.round(As)} มม.² → ${n}-${bar}` }
    : { groups: [{ n: 2, bar }, { n, bar }], basis: `คาน As,min = 14/fy·b·d = ${Math.round(As)} มม.² → ล่าง ${n}-${bar}, บน 2-${bar}` };
}

/** Code maximum tie spacing (25 mm steps): beam d/2 ≤ 0.30; column min(16 db, 48 dt, least side). */
export function maximumTieSpacing(isCol: boolean, wM: number, dM: number, cover: number, mainDiaM: number): { spacing: number; basis: string } {
  const raw = isCol ? Math.min(16 * mainDiaM, 48 * 0.006, Math.min(wM, dM)) : Math.min((dM - cover - 0.012) / 2, 0.30);
  const spacing = Math.max(0.075, Math.floor(raw / 0.025 + 1e-9) * 0.025);
  return { spacing: Number(spacing.toFixed(3)), basis: `${isCol ? 'ปลอกเสา ≤ 16db, 48dt, ด้านแคบ' : 'ปลอกคาน ≤ d/2'} → RB6@${spacing.toFixed(3).replace(/0$/, '')}` };
}

const CRITICAL_FIELDS: Record<MemberType, { field: string; label: string }[]> = {
  BEAM: [{ field: 'width', label: 'ความกว้าง' }, { field: 'depth', label: 'ความลึก' }, { field: 'length', label: 'ความยาวช่วง' }],
  COLUMN: [{ field: 'width', label: 'ขนาดเสา' }, { field: 'depth', label: 'ขนาดเสา' }, { field: 'length', label: 'ความสูงเสา' }],
  FOOTING: [{ field: 'width', label: 'ความกว้างฐาน' }, { field: 'depth', label: 'ความยาวฐาน' }, { field: 'length', label: 'ความหนาฐาน' }],
  SLAB: [{ field: 'width', label: 'ขนาดแผ่นพื้น' }, { field: 'depth', label: 'ขนาดแผ่นพื้น' }, { field: 'length', label: 'ความหนาพื้น' }],
  STAIR: [{ field: 'width', label: 'ความกว้างบันได' }, { field: 'depth', label: 'ความหนาท้องบันได' }, { field: 'length', label: 'ความยาวลาด' }],
  WALL: [{ field: 'width', label: 'ความหนาผนัง' }, { field: 'depth', label: 'ความสูงผนัง' }, { field: 'length', label: 'ความยาวผนัง' }],
  DOOR: [{ field: 'width', label: 'ความกว้าง' }, { field: 'depth', label: 'ความสูง' }, { field: 'length', label: 'จำนวน' }],
  WINDOW: [{ field: 'width', label: 'ความกว้าง' }, { field: 'depth', label: 'ความสูง' }, { field: 'length', label: 'จำนวน' }],
  FINISH: [{ field: 'width', label: 'ความกว้างห้อง' }, { field: 'depth', label: 'ความยาวห้อง' }, { field: 'length', label: 'ความหนา' }],
};

/** Flags coming from provenance: missing/assumed fields, conflicts, low confidence. */
function provenanceFlags(member: ExtractedMember): ReviewFlag[] {
  const p = member.provenance;
  if (!p) return [];
  const flags: ReviewFlag[] = [];
  for (const { field, label } of CRITICAL_FIELDS[member.memberType]) {
    const src = p.fieldSources[field];
    if (src === 'missing') flags.push({ code: 'FIELD_MISSING', severity: 'block', field, message: `${label}: ไม่พบในแบบ — ต้องกรอก` });
    else if (src === 'assumed') flags.push({ code: 'FIELD_ASSUMED', severity: 'warn', field, message: `${label}: ใช้ค่าสมมติ — ยืนยันกับแบบ` });
  }
  for (const [field, src] of Object.entries(p.fieldSources)) {
    if (['width', 'depth', 'length'].includes(field)) continue;
    if (field === 'rebar' && src === 'missing') flags.push({ code: 'REBAR_DEFAULTED', severity: 'warn', field, message: 'ไม่พบรายละเอียดเหล็กเสริม — ใช้ค่ามาตรฐาน' });
    if (field === 'excavation' && src === 'assumed') flags.push({ code: 'EXCAVATION_ASSUMED', severity: 'info', field, message: 'ความลึกขุดดินใช้ค่ามาตรฐาน 1.00 ม.' });
  }
  for (const c of p.conflicts || []) flags.push({ code: 'CONFLICT', severity: 'warn', message: c });
  if (p.confidence < 0.7) flags.push({ code: 'LOW_CONFIDENCE', severity: 'warn', message: `ความมั่นใจในการอ่านแบบต่ำ (${Math.round(p.confidence * 100)}%)` });
  return flags;
}

function confidenceFrom(member: ExtractedMember, flags: ReviewFlag[]): number {
  let c = (member.provenance?.confidence ?? 0.95) * 100;
  for (const f of flags) c -= f.severity === 'block' ? 40 : f.severity === 'warn' ? 12 : 3;
  return Math.max(0, Math.min(100, Math.round(c)));
}

/**
 * Quantity Surveying Calculator with deduction and validation rules.
 */
export function calculateMember(
  member: ExtractedMember,
  idx: number = 1,
  specs: MaterialSpecs = DEFAULT_MATERIAL_SPECS
): CalculatedQuantity {
  const itemId = `QS-${member.memberType.charAt(0)}-${String(idx).padStart(3, '0')}`;
  const rejections: string[] = [];
  const reviews: string[] = [];
  const deductions: DeductionDetail[] = [];
  const flags: ReviewFlag[] = provenanceFlags(member);
  const rules = { ...DEFAULT_MATERIAL_SPECS, ...specs };

  if (member.review?.status === 'rejected') {
    return createRejectedRecord(itemId, member, [`ผู้ตรวจไม่อนุมัติ${member.review.note ? ': ' + member.review.note : ''}`]);
  }

  if (member.width === null || member.width === undefined ||
      member.depth === null || member.depth === undefined ||
      member.length === null || member.length === undefined) {
    rejections.push('Missing critical dimension (width, depth, or span is null)');
    return createRejectedRecord(itemId, member, rejections);
  }

  if (member.provenance && flags.some(f => f.code === 'FIELD_MISSING') &&
      (member.width <= 0 || member.depth <= 0 || member.length <= 0)) {
    return createIncompleteRecord(itemId, member, flags);
  }

  if (member.width <= 0) rejections.push(`Width must be positive (> 0), got: ${member.width}`);
  if (member.depth <= 0) rejections.push(`Depth/Y-dimension must be positive (> 0), got: ${member.depth}`);
  if (member.length <= 0) rejections.push(`Length/Span must be positive (> 0), got: ${member.length}`);
  const memberCount = member.count ?? 1;
  if (memberCount <= 0) rejections.push(`Count must be positive integer (> 0), got: ${member.count}`);

  if (rejections.length > 0) {
    return createRejectedRecord(itemId, member, rejections);
  }

  const wM = normalizeDimension(member.width, member.unit);
  const dM = normalizeDimension(member.depth, member.unit);
  const lGrossM = normalizeDimension(member.length, member.length < 50 ? 'm' : member.unit);

  if (member.memberType === 'BEAM') {
    if (wM < 0.10) {
      rejections.push(`Beam width (${wM.toFixed(3)}m) is below structural minimum (0.10m)`);
    } else if (wM > 1.50) {
      reviews.push(`Unusually wide beam (${wM.toFixed(3)}m); verify transfer girder or band beam`);
    }

    if (dM < 0.15) {
      rejections.push(`Beam depth (${dM.toFixed(3)}m) is below structural minimum (0.15m)`);
    } else if (dM > 3.00) {
      reviews.push(`Unusually deep beam (${dM.toFixed(3)}m); verify transfer beam schedule`);
    }

    const aspectRatio = dM / wM;
    if (aspectRatio > 6.0) {
      reviews.push(`High aspect ratio d/b = ${aspectRatio.toFixed(1)} > 6.0 (deep beam)`);
    } else if (aspectRatio < 0.8) {
      reviews.push(`Inverted aspect ratio d/b = ${aspectRatio.toFixed(2)} < 0.8 (wide flat beam)`);
    }

    if (lGrossM < 0.30) {
      rejections.push(`Beam span (${lGrossM.toFixed(3)}m) is shorter than support joint width`);
    } else if (lGrossM > 30.0) {
      reviews.push(`Unusually long span (${lGrossM.toFixed(2)}m); check drawing scale`);
    } else if (dM >= 1.00 || lGrossM >= 10.0) {
      reviews.push(`Heavy transfer girder / long span (depth ${dM.toFixed(2)}m >= 1.0m or span ${lGrossM.toFixed(1)}m >= 10m); verify deflection, camber, and shear stirrups`);
    }
  } else if (member.memberType === 'COLUMN') {
    if (wM < 0.15 || dM < 0.15) {
      rejections.push(`Column section (${wM.toFixed(2)}x${dM.toFixed(2)}m) below minimum 0.15x0.15m`);
    } else if (wM > 2.50 || dM > 2.50) {
      reviews.push(`Large column dimension (${wM.toFixed(2)}x${dM.toFixed(2)}m); check shear wall`);
    }

    if (lGrossM < 0.30) {
      rejections.push(`Column height (${lGrossM.toFixed(2)}m) is too short (< 0.30m)`);
    } else if (lGrossM > 15.0) {
      reviews.push(`Column height (${lGrossM.toFixed(2)}m) unusually high for single story`);
    }
  } else if (member.memberType === 'FOOTING') {
    if (lGrossM > 2.0) reviews.push(`Footing thickness ${lGrossM.toFixed(2)}m > 2.0m; check that length field is thickness`);
  } else if (member.memberType === 'SLAB') {
    if (lGrossM > 0.5) reviews.push(`Slab thickness ${lGrossM.toFixed(2)}m > 0.50m; check that length field is thickness`);
  }

  if (rejections.length > 0) {
    return createRejectedRecord(itemId, member, rejections, wM, dM, lGrossM);
  }

  let totalDeductionM = 0;
  let lNetM = lGrossM;

  if (member.memberType === 'BEAM') {
    if (member.isClearSpan) {
      lNetM = lGrossM;
    } else {
      const colW1 = member.supportColW1 && member.supportColW1 > 0 ? normalizeDimension(member.supportColW1, 'm') : 0;
      const colW2 = member.supportColW2 && member.supportColW2 > 0 ? normalizeDimension(member.supportColW2, 'm') : 0;

      if (colW1 > 0 || colW2 > 0) {
        const ded = Number(((colW1 / 2) + (colW2 / 2)).toFixed(4));
        deductions.push({
          ruleName: 'COLUMN_JOINT_INTERSECTION',
          deductionM: ded,
          description: `Deducted half-column widths at supports (${(colW1 / 2).toFixed(3)}m + ${(colW2 / 2).toFixed(3)}m)`,
        });
        totalDeductionM += ded;
      } else {
        reviews.push('Center-to-center span detected without exact column support widths; verify net clear span');
      }

      lNetM = Number(Math.max(0, lGrossM - totalDeductionM).toFixed(4));
    }

    if (lNetM <= 0) {
      rejections.push(`Net beam length after deduction (${lNetM.toFixed(3)}m) <= 0`);
      return createRejectedRecord(itemId, member, rejections, wM, dM, lGrossM);
    }
  }

  const count = member.count || 1;
  const vGross = Number((count * wM * dM * lGrossM).toFixed(4));
  let vNet = Number((count * wM * dM * lNetM).toFixed(4));
  let formworkNetM2 = 0;
  let formulaStr = '';

  let leanConcreteM3 = 0;
  let sandBeddingM3 = 0;
  let excavationM3 = 0;
  let backfillM3 = 0;
  let pilesNos = 0;
  let precastSlabM2 = 0;
  let wiremeshM2 = 0;

  if (member.memberType === 'BEAM') {
    const isGroundBeam = /^GB/i.test(member.tag);
    const soffit = isGroundBeam && !rules.groundBeamSoffitFormwork ? 0 : wM;
    formworkNetM2 = Number((count * (2 * dM + soffit) * lNetM).toFixed(4));
    formulaStr = `${count} × ${wM.toFixed(3)}m(w) × ${dM.toFixed(3)}m(d) × ${lNetM.toFixed(3)}m(L_net) = ${vNet.toFixed(4)} m³ [Gross: ${lGrossM.toFixed(3)}m - Ded: ${totalDeductionM.toFixed(3)}m]`;
  } else if (member.memberType === 'COLUMN') {
    formworkNetM2 = Number((count * 2 * (wM + dM) * lNetM).toFixed(4));
    formulaStr = `${count} × ${wM.toFixed(3)}m(c_x) × ${dM.toFixed(3)}m(c_y) × ${lNetM.toFixed(3)}m(H) = ${vNet.toFixed(4)} m³`;
  } else if (member.memberType === 'FOOTING') {
    const margin = rules.excavationMarginM ?? 0.10;
    const leanT = rules.leanThicknessM ?? 0.05;
    const sandT = member.sandThicknessM ?? rules.sandThicknessM ?? 0.05;
    formworkNetM2 = Number((count * 2 * (wM + dM) * lNetM).toFixed(4));
    leanConcreteM3 = Number((count * (wM + 0.20) * (dM + 0.20) * leanT).toFixed(4));
    sandBeddingM3 = Number((count * (wM + 0.20) * (dM + 0.20) * sandT).toFixed(4));
    const excDepth = member.excavationDepthM || 1.50;
    excavationM3 = Number((count * (wM + 2 * margin) * (dM + 2 * margin) * excDepth * (rules.excavationBulkingFactor ?? 1.0)).toFixed(4));
    backfillM3 = Number(Math.max(0, excavationM3 - vNet - leanConcreteM3 - sandBeddingM3).toFixed(4));
    pilesNos = count * (member.pileCount || 0);
    formulaStr = `${count} × ${wM.toFixed(2)}m(w) × ${dM.toFixed(2)}m(L) × ${lNetM.toFixed(2)}m(D) = ${vNet.toFixed(4)} m³ [Lean: ${leanConcreteM3.toFixed(3)}m³, Sand: ${sandBeddingM3.toFixed(3)}m³, ดินขุด: ${excavationM3.toFixed(3)}m³]`;
  } else if (member.memberType === 'SLAB') {
    const isGroundSlab = (member.tag && member.tag.toUpperCase().includes('GS')) || member.slabType === 'SLAB_ON_GROUND';
    const isPrecast = member.slabType === 'PRECAST_PLANK' || (member.notes && member.notes.includes('สำเร็จรูป'));

    if (isPrecast) {
      precastSlabM2 = Number((count * wM * dM).toFixed(2));
      wiremeshM2 = precastSlabM2;
      formworkNetM2 = 0;
      formulaStr = `แผ่นพื้นสำเร็จรูป ${precastSlabM2.toFixed(2)} ตร.ม. + คอนกรีตทับหน้า Topping ${lNetM.toFixed(2)}m = ${vNet.toFixed(4)} m³`;
    } else if (isGroundSlab) {
      formworkNetM2 = Number((count * 2 * (wM + dM) * lNetM).toFixed(4));
      sandBeddingM3 = Number((count * wM * dM * (member.sandThicknessM ?? rules.slabSandThicknessM ?? 0.05)).toFixed(4));
      formulaStr = `${count} × ${wM.toFixed(2)}m × ${dM.toFixed(2)}m × ${lNetM.toFixed(2)}m(หนา) = ${vNet.toFixed(4)} m³ [Slab-on-Ground, ไม้แบบขอบ: ${formworkNetM2.toFixed(2)}m², ทรายรองพื้น ${sandBeddingM3.toFixed(3)}m³]`;
    } else {
      formworkNetM2 = Number((count * (wM * dM + 2 * (wM + dM) * lNetM)).toFixed(4));
      formulaStr = `${count} × ${wM.toFixed(2)}m(w) × ${dM.toFixed(2)}m(L) × ${lNetM.toFixed(2)}m(หนา) = ${vNet.toFixed(4)} m³ [ไม้แบบท้องพื้น+ขอบ: ${formworkNetM2.toFixed(2)}m²]`;
    }
  } else if (member.memberType === 'STAIR') {
    formworkNetM2 = Number((count * (wM * dM + 2 * dM * lNetM)).toFixed(4));
    formulaStr = `${count} บันได ค.ส.ล. กว้าง ${wM.toFixed(2)}m × ท้องบันได ${dM.toFixed(2)}m = ${vNet.toFixed(4)} m³`;
  } else if (member.memberType === 'WALL') {
    const wallArea = Number((count * lNetM * dM).toFixed(4));
    const plasterArea = Number((2 * wallArea).toFixed(4));
    vNet = Number((wallArea * wM).toFixed(4));
    formworkNetM2 = 0;
    formulaStr = `${count} × ${lNetM.toFixed(2)}m(L) × ${dM.toFixed(2)}m(H) = ${wallArea.toFixed(2)} m² [ก่ออิฐหนา ${wM.toFixed(2)}m, ฉาบปูน 2 ด้าน ${plasterArea.toFixed(2)} m²]`;
  } else if (member.memberType === 'DOOR') {
    vNet = 0;
    formworkNetM2 = 0;
    formulaStr = `${count} ชุด × บานประตู ${wM.toFixed(2)} × ${dM.toFixed(2)} ม. พร้อมวงกบและอุปกรณ์`;
  } else if (member.memberType === 'WINDOW') {
    vNet = 0;
    formworkNetM2 = 0;
    formulaStr = `${count} ชุด × บานหน้าต่าง ${wM.toFixed(2)} × ${dM.toFixed(2)} ม. พร้อมกระจกและอุปกรณ์`;
  } else if (member.memberType === 'FINISH') {
    const finishArea = Number((count * wM * dM).toFixed(4));
    vNet = Number((finishArea * (lNetM || 0.05)).toFixed(4));
    formworkNetM2 = 0;
    formulaStr = `${count} × ${wM.toFixed(2)}m(w) × ${dM.toFixed(2)}m(L) = ${finishArea.toFixed(2)} m² [งานวัสดุตกแต่งผิว]`;
  }

  const cover = (rules.concreteCoveringCm || 3.5) / 100.0;
  const isArch = ['WALL', 'DOOR', 'WINDOW', 'FINISH'].includes(member.memberType);
  const rebarCalc = isArch
    ? { bars: {}, rebarFormulaStr: '', assumedRatio: false, minBasis: [], rebarDetails: undefined }
    : computeDetailedRebar(member, count, wM, dM, lNetM, lGrossM, cover, rules, wiremeshM2, vNet);

  const bars = rebarCalc.bars;
  let rebarFormulaStr = rebarCalc.rebarFormulaStr;
  const assumedRatio = rebarCalc.assumedRatio;
  const rebarDetails = rebarCalc.rebarDetails;
  if (rebarCalc.minBasis.length) {
    flags.push({ code: 'REBAR_CODE_MINIMUM', severity: 'info', field: 'rebar', message: `ไม่พบเหล็กในแบบ — คิดเหล็กต่ำสุดตามมาตรฐานจากหน้าตัด (${rebarCalc.minBasis.join('; ')}) ของจริงอาจมากกว่า` });
  }

  const rebarWeightKg = Number(Object.values(bars).reduce((a, b) => a + b, 0).toFixed(2));
  const stirrupWt = Object.entries(bars).filter(([b]) => b.startsWith('RB')).reduce((a, [, v]) => a + v, 0);
  const mainWt = rebarWeightKg - stirrupWt;
  if (rebarFormulaStr) rebarFormulaStr += ` = ${rebarWeightKg} kg`;

  if (vNet > 0 && rebarWeightKg > 0 && !assumedRatio) {
    const ratio = rebarWeightKg / vNet;
    const band: Record<MemberType, [number, number]> = {
      BEAM: [60, 320],
      COLUMN: [70, 380],
      FOOTING: [25, 160],
      SLAB: [25, 160],
      STAIR: [40, 200],
      WALL: [0, 50],
      DOOR: [0, 10],
      WINDOW: [0, 10],
      FINISH: [0, 10],
    };
    const [lo, hi] = band[member.memberType];
    if (ratio < lo || ratio > hi) {
      flags.push({ code: 'STEEL_RATIO', severity: 'warn', field: 'rebar', message: `อัตราส่วนเหล็ก ${ratio.toFixed(0)} กก./ลบ.ม. อยู่นอกช่วงปกติ ${lo}–${hi} — ตรวจเหล็กเสริม` });
    }
  }
  if (assumedRatio && member.provenance && member.memberType !== 'BEAM' && member.memberType !== 'COLUMN') {
    flags.push({ code: 'REBAR_RATIO_ASSUMED', severity: 'info', field: 'rebar', message: 'คำนวณเหล็กจากอัตราเฉลี่ย (แบบไม่ระบุระยะเรียง)' });
  }

  const concWasteMult = 1 + (rules.concreteWastagePct || 0) / 100.0;
  const formWasteMult = 1 + (rules.formworkWastagePct || 0) / 100.0;
  const rebarWasteMult = 1 + (rules.rebarWastagePct || 0) / 100.0;

  const concreteMatCost = vNet * (rules.concreteMatRate ?? 2100.0) * concWasteMult;
  const formworkMatCost = formworkNetM2 * (rules.formworkMatRate ?? 350.0) * formWasteMult;
  const rebarMatCost = (mainWt * (rules.mainRebarMatRate ?? 28.50) + stirrupWt * (rules.stirrupMatRate ?? 28.00)) * rebarWasteMult;

  const concreteLaborCost = vNet * (rules.concreteLaborRate ?? 450.0);
  const formworkLaborCost = formworkNetM2 * (rules.formworkLaborRate ?? 150.0);
  const rebarLaborCost = mainWt * (rules.mainRebarLaborRate ?? 4.50) + stirrupWt * (rules.stirrupLaborRate ?? 4.50);

  const leanMatCost = leanConcreteM3 * (rules.leanConcreteMatRate ?? 1750.0);
  const leanLaborCost = leanConcreteM3 * (rules.leanConcreteLaborRate ?? 380.0);
  const sandMatCost = sandBeddingM3 * (rules.sandBedMatRate ?? 480.0);
  const sandLaborCost = sandBeddingM3 * (rules.sandBedLaborRate ?? 120.0);
  const earthworkLaborCost = (excavationM3 * (rules.excavationRate ?? 120.0)) + (backfillM3 * (rules.backfillRate ?? 80.0));
  const precastMatCost = precastSlabM2 * (rules.precastSlabMatRate ?? 260.0);
  const precastLaborCost = precastSlabM2 * (rules.precastSlabLaborRate ?? 50.0);
  const wiremeshMatCost = wiremeshM2 * (rules.wiremeshMatRate ?? 45.0);
  const wiremeshLaborCost = wiremeshM2 * (rules.wiremeshLaborRate ?? 10.0);

  const wallAreaM2 = member.memberType === 'WALL' ? Number((count * lNetM * dM).toFixed(4)) : 0;
  const plasterAreaM2 = member.memberType === 'WALL' ? Number((2 * wallAreaM2).toFixed(4)) : 0;
  const openingsCount = (member.memberType === 'DOOR' || member.memberType === 'WINDOW') ? count : 0;

  const wallMatCost = member.memberType === 'WALL' ? wallAreaM2 * (rules.wallMasonryMatRate ?? 240) + plasterAreaM2 * (rules.wallPlasterMatRate ?? 140) : 0;
  const wallLaborCost = member.memberType === 'WALL' ? wallAreaM2 * (rules.wallMasonryLaborRate ?? 95) + plasterAreaM2 * (rules.wallPlasterLaborRate ?? 110) : 0;
  const doorMatCost = member.memberType === 'DOOR' ? openingsCount * (rules.doorMatRate ?? 3500) : 0;
  const doorLaborCost = member.memberType === 'DOOR' ? openingsCount * (rules.doorLaborRate ?? 500) : 0;
  const winMatCost = member.memberType === 'WINDOW' ? openingsCount * (rules.windowMatRate ?? 2800) : 0;
  const winLaborCost = member.memberType === 'WINDOW' ? openingsCount * (rules.windowLaborRate ?? 400) : 0;
  const finMatCost = member.memberType === 'FINISH' ? (count * wM * dM) * (rules.floorFinishMatRate ?? 450) : 0;
  const finLaborCost = member.memberType === 'FINISH' ? (count * wM * dM) * (rules.floorFinishLaborRate ?? 160) : 0;

  const materialCostThb = Number((concreteMatCost + formworkMatCost + rebarMatCost + leanMatCost + sandMatCost + precastMatCost + wiremeshMatCost + wallMatCost + doorMatCost + winMatCost + finMatCost).toFixed(2));
  const wageCostThb = Number((concreteLaborCost + formworkLaborCost + rebarLaborCost + leanLaborCost + sandLaborCost + earthworkLaborCost + precastLaborCost + wiremeshLaborCost + wallLaborCost + doorLaborCost + winLaborCost + finLaborCost).toFixed(2));
  const totalCostThb = Number((materialCostThb + wageCostThb).toFixed(2));
  const earthworkCostThb = member.memberType === 'FOOTING'
    ? { material: Number((leanMatCost + sandMatCost).toFixed(2)), wage: Number((leanLaborCost + sandLaborCost + earthworkLaborCost).toFixed(2)) }
    : { material: 0, wage: 0 };

  for (const r of reviews) flags.push({ code: 'ENGINEERING', severity: 'warn', message: r });
  const confidencePct = confidenceFrom(member, flags);
  const needsHuman = flags.some(f => f.severity !== 'info') || confidencePct < AUTO_RELEASE_CONFIDENCE_PCT;
  const approved = member.review?.status === 'approved';
  const status: ValidationStatus = approved ? 'AUTO_RELEASE' : needsHuman ? 'NEEDS_REVIEW' : 'AUTO_RELEASE';
  const confidenceBasis = approved
    ? `ผู้ตรวจยืนยันแล้ว${member.review?.note ? ': ' + member.review.note : ''}`
    : needsHuman
    ? 'Calculated with advisory warnings; requires QS verification'
    : 'Strict engineering rules and dimension bounds fully satisfied';

  const sourceInfo = `File: ${member.sourceFile || 'drawing'} | Sheet/Layer: ${member.sourceSheetOrLayer || '-'} | Dim: '${member.rawDimensionStr || `${wM}x${dM}`}'`;

  return {
    itemId,
    tag: member.tag,
    memberType: member.memberType,
    count,
    widthM: wM,
    depthM: dM,
    lengthGrossM: lGrossM,
    deductionM: Number(totalDeductionM.toFixed(4)),
    lengthNetM: lNetM,
    volumeGrossM3: vGross,
    volumeNetM3: vNet,
    formworkNetM2,
    status,
    formulaStr,
    deductions,
    rejectionReasons: [],
    reviewWarnings: flags.filter(f => f.severity !== 'info').map(f => f.message),
    sourceInfo,
    gridLocation: member.gridLocation || '-',
    level: member.level || 'Story 1',
    confidenceBasis,
    rebarWeightKg,
    rebarFormulaStr,
    rebarByDia: bars,
    rebarDetails,
    wallAreaM2: wallAreaM2 || undefined,
    plasterAreaM2: plasterAreaM2 || undefined,
    openingsCount: openingsCount || undefined,
    materialCostThb,
    wageCostThb,
    totalCostThb,
    earthworkCostThb,
    leanConcreteM3,
    sandBeddingM3,
    excavationM3,
    backfillM3,
    pilesNos,
    precastSlabM2,
    wiremeshM2,
    coords: member.coords,
    provenance: member.provenance,
    flags,
    confidencePct,
    review: member.review,
  };
}

function createIncompleteRecord(itemId: string, member: ExtractedMember, flags: ReviewFlag[]): CalculatedQuantity {
  return {
    ...createRejectedRecord(itemId, member, []),
    widthM: Math.max(0, member.width || 0),
    depthM: Math.max(0, member.depth || 0),
    lengthGrossM: Math.max(0, member.length || 0),
    status: 'NEEDS_REVIEW',
    formulaStr: 'รอข้อมูลจากผู้ตรวจ: ' + flags.filter(f => f.code === 'FIELD_MISSING').map(f => f.message.split(':')[0]).join(', '),
    reviewWarnings: flags.filter(f => f.severity !== 'info').map(f => f.message),
    confidenceBasis: 'ข้อมูลในแบบไม่ครบ — ปริมาณเป็น 0 จนกว่าผู้ตรวจจะกรอก',
    flags,
    confidencePct: confidenceFrom(member, flags),
  };
}

function createRejectedRecord(
  itemId: string,
  member: ExtractedMember,
  rejections: string[],
  wM: number = 0,
  dM: number = 0,
  lM: number = 0
): CalculatedQuantity {
  return {
    itemId,
    tag: member.tag,
    memberType: member.memberType,
    count: member.count || 1,
    widthM: wM,
    depthM: dM,
    lengthGrossM: lM,
    deductionM: 0,
    lengthNetM: 0,
    volumeGrossM3: 0,
    volumeNetM3: 0,
    formworkNetM2: 0,
    status: 'REJECTED',
    formulaStr: 'CALCULATION_BLOCKED: Non-compliant input parameters',
    pilesNos: (member.count || 1) * (member.pileCount || 0),
    deductions: [],
    rejectionReasons: rejections,
    reviewWarnings: [],
    sourceInfo: `File: ${member.sourceFile || 'drawing'} | Sheet/Layer: ${member.sourceSheetOrLayer || '-'} | Dim: '${member.rawDimensionStr || ''}'`,
    gridLocation: member.gridLocation || '-',
    level: member.level || 'Story 1',
    confidenceBasis: 'Rejected by validation engine rules',
    rebarWeightKg: 0,
    rebarByDia: {},
    materialCostThb: 0,
    wageCostThb: 0,
    totalCostThb: 0,
    earthworkCostThb: { material: 0, wage: 0 },
    provenance: member.provenance,
    flags: [],
    confidencePct: 0,
    review: member.review,
  };
}

function zeroOut(calc: CalculatedQuantity) {
  calc.volumeNetM3 = 0;
  calc.volumeGrossM3 = 0;
  calc.formworkNetM2 = 0;
  calc.rebarWeightKg = 0;
  calc.rebarByDia = {};
  calc.materialCostThb = 0;
  calc.wageCostThb = 0;
  calc.totalCostThb = 0;
  calc.earthworkCostThb = { material: 0, wage: 0 };
  calc.leanConcreteM3 = 0;
  calc.sandBeddingM3 = 0;
  calc.excavationM3 = 0;
  calc.backfillM3 = 0;
  calc.pilesNos = 0;
  calc.precastSlabM2 = 0;
  calc.wiremeshM2 = 0;
}

/**
 * Computes all members, checks duplicates, aggregates project summary by categories & Factor F.
 */
export function computeProject(
  members: ExtractedMember[],
  projectName: string = 'Project-01',
  specs: MaterialSpecs = DEFAULT_MATERIAL_SPECS,
  factorFParams: FactorFParams = DEFAULT_FACTOR_F_PARAMS
): BOQProjectResult {
  const calculatedItems: CalculatedQuantity[] = [];
  const seenKeys = new Map<string, number>();
  const slabCells = new Map<string, number[]>();

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const calc = calculateMember(member, i + 1, specs);
    calc.memberIndex = i;

    if (member.gridLocation && member.gridLocation !== '-' && !/^Sheet-P\d+$/.test(member.gridLocation)) {
      const dupKey = `${(member.level || 'Story 1').trim().toLowerCase()}::${member.gridLocation.trim().toLowerCase()}::${member.tag.trim().toUpperCase()}`;
      if (seenKeys.has(dupKey) && member.review?.status !== 'approved') {
        const prevIdx = seenKeys.get(dupKey);
        calc.status = 'REJECTED';
        calc.rejectionReasons.push(`Duplicate entity detected: same tag '${member.tag}' at grid '${member.gridLocation}' already calculated at item ${prevIdx}`);
        zeroOut(calc);
      } else {
        seenKeys.set(dupKey, i + 1);
      }
      if (member.memberType === 'SLAB') {
        const cellKey = `${(member.level || '').trim().toLowerCase()}::${member.gridLocation.trim().toLowerCase()}`;
        slabCells.set(cellKey, [...(slabCells.get(cellKey) || []), i]);
      }
    }

    calculatedItems.push(calc);
  }

  for (const idxs of slabCells.values()) {
    if (idxs.length < 2) continue;
    const tags = idxs.map(i => members[i].tag).join(' / ');
    for (const i of idxs) {
      const it = calculatedItems[i];
      if (it.status === 'REJECTED' || members[i].review?.status === 'approved') continue;
      const msg = `พื้นซ้อนกันในช่องเดียวกัน (${tags}) — เลือกชนิดพื้นที่ถูกต้อง`;
      it.flags = [...(it.flags || []), { code: 'SLAB_OVERLAP', severity: 'warn', message: msg }];
      it.reviewWarnings = [...it.reviewWarnings, msg];
      it.status = 'NEEDS_REVIEW';
    }
  }

  const validItems = calculatedItems.filter(it => it.status !== 'REJECTED');
  const totVol = validItems.reduce((acc, it) => acc + it.volumeNetM3, 0);
  const totFormwork = validItems.reduce((acc, it) => acc + it.formworkNetM2, 0);
  const totRebar = validItems.reduce((acc, it) => acc + (it.rebarWeightKg || 0), 0);
  const totCost = validItems.reduce((acc, it) => acc + (it.totalCostThb || 0), 0);

  const autoRel = calculatedItems.filter(it => it.status === 'AUTO_RELEASE').length;
  const needsRev = calculatedItems.filter(it => it.status === 'NEEDS_REVIEW').length;
  const rejected = calculatedItems.filter(it => it.status === 'REJECTED').length;
  const totalCnt = calculatedItems.length;
  const passRate = totalCnt > 0 ? Number(((autoRel / totalCnt) * 100).toFixed(1)) : 0;

  const factorF = computeFactorFMultiplier(factorFParams);
  const totalCostWithFactorF = Number((totCost * factorF).toFixed(2));

  const categoryDefs = [
    { code: 'CAT-1', name: 'งานเตรียมการและงานดินฐานราก' },
    { code: 'CAT-2', name: 'งานฐานรากและเสาเข็ม ค.ส.ล.' },
    { code: 'CAT-3', name: 'งานเสา ค.ส.ล.' },
    { code: 'CAT-4', name: 'งานคาน ค.ส.ล.' },
    { code: 'CAT-5', name: 'งานพื้น ค.ส.ล. และพื้นสำเร็จรูป' },
    { code: 'CAT-6', name: 'งานบันได ค.ส.ล.' },
    { code: 'CAT-7', name: 'งานสถาปัตยกรรม (ผนัง ประตู หน้าต่าง พื้นผิว และฝ้าเพดาน)' },
  ];
  const catOf: Record<MemberType, string> = {
    FOOTING: 'CAT-2',
    COLUMN: 'CAT-3',
    BEAM: 'CAT-4',
    SLAB: 'CAT-5',
    STAIR: 'CAT-6',
    WALL: 'CAT-7',
    DOOR: 'CAT-7',
    WINDOW: 'CAT-7',
    FINISH: 'CAT-7',
  };

  const categorySummaries: Record<string, CategorySummary> = {};
  for (const cat of categoryDefs) {
    categorySummaries[cat.code] = {
      categoryCode: cat.code, categoryName: cat.name, itemCount: 0,
      concreteVolumeM3: 0, formworkAreaM2: 0, rebarWeightKg: 0, materialCostThb: 0, wageCostThb: 0, totalCostThb: 0,
    };
  }
  for (const it of validItems) {
    const c = categorySummaries[catOf[it.memberType]];
    const ew = it.earthworkCostThb || { material: 0, wage: 0 };
    c.itemCount += 1;
    c.concreteVolumeM3 += it.volumeNetM3;
    c.formworkAreaM2 += it.formworkNetM2;
    c.rebarWeightKg += it.rebarWeightKg || 0;
    c.materialCostThb += (it.materialCostThb || 0) - ew.material;
    c.wageCostThb += (it.wageCostThb || 0) - ew.wage;
    if (ew.material || ew.wage) {
      const e = categorySummaries['CAT-1'];
      e.itemCount += 1;
      e.materialCostThb += ew.material;
      e.wageCostThb += ew.wage;
    }
  }
  for (const c of Object.values(categorySummaries)) {
    c.concreteVolumeM3 = Number(c.concreteVolumeM3.toFixed(4));
    c.formworkAreaM2 = Number(c.formworkAreaM2.toFixed(4));
    c.rebarWeightKg = Number(c.rebarWeightKg.toFixed(2));
    c.materialCostThb = Number(c.materialCostThb.toFixed(2));
    c.wageCostThb = Number(c.wageCostThb.toFixed(2));
    c.totalCostThb = Number((c.materialCostThb + c.wageCostThb).toFixed(2));
  }

  return {
    projectName,
    totalConcreteVolumeM3: Number(totVol.toFixed(4)),
    totalFormworkM2: Number(totFormwork.toFixed(4)),
    totalRebarWeightKg: Number(totRebar.toFixed(2)),
    totalProjectCostThb: Number(totCost.toFixed(2)),
    factorF,
    totalCostWithFactorF,
    categorySummaries,
    totalItemsCount: totalCnt,
    autoReleaseCount: autoRel,
    needsReviewCount: needsRev,
    rejectedCount: rejected,
    passRatePct: passRate,
    items: calculatedItems,
    materialSpecs: specs,
    factorFParams,
    reviewedCount: members.filter(m => m.review).length,
  };
}
