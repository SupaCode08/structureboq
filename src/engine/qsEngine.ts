/**
 * StructBOQ - Quantity Surveying Calculation Engine (TypeScript / Full-Stack)
 * Implements SMM / Comptroller General's Structural Standard for Concrete Beams, Columns, Footings, Slabs, and Stairs.
 *
 * Every item carries its drawing provenance and a list of review flags. Items with no flags
 * and high extraction confidence are auto-released, so a reviewer only has to look at the
 * items that actually need a human decision.
 */
import { ENGINE_ID } from './engineIdentity.ts';

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
  netLengthM?: number;
  hookLengthM?: number;
  lapLengthM?: number;
  /** RebarSet this row came from, and the direction its bars run */
  setId?: string;
  direction?: 'X' | 'Y';
}

export type HookEnd = 'NONE' | 'UPTURN' | 'HOOK_90' | 'UNSPECIFIED';

/** One group of footing bars as the drawing (or the reviewer) gives it. Optional fields left undefined mean "not given", never 0. */
export interface RebarSet {
  /** stable for the life of the set ('RS-' + random); a duplicate gets a new one */
  id: string;
  barType?: 'DB' | 'RB';
  diameterMm?: number;
  /** how the number of bars is defined; TWO_DIRECTION = one note meant for both directions (goes with direction BOTH) */
  arrangement: 'FIXED_COUNT' | 'SPACED' | 'TWO_DIRECTION' | 'UNSPECIFIED';
  quantity?: number;
  spacingMm?: number;
  /** X = bars run along the footing width, Y = along its length */
  direction: 'X' | 'Y' | 'BOTH' | 'UNSPECIFIED';
  layer: 'BOTTOM' | 'TOP';
  startHook: HookEnd;
  endHook: HookEnd;
  /** leg length of each hooked end; for UPTURN, undefined = up to the top cover */
  hookLengthM?: number;
  /** cut length written on the drawing, used instead of the computed one */
  cuttingLengthM?: number;
  /** the drawing's own notation, kept as read */
  sourceText?: string;
  source: FieldSource;
  confirmedBy?: string;
  confirmedAt?: string;
  revision?: string;
}

export interface RebarSetResult {
  id: string;
  /** the set as it was calculated, so a report can show it without the member */
  set: RebarSet;
  status: 'CALCULATED' | 'NEEDS_REVIEW' | 'BLOCKED';
  provenanceLevel: ProvenanceLevel;
  bars: number;
  weightKg: number;
  reasons: string[];
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
  /** footing RebarSets, one result per set (absent when the footing is given as a bottomRebar note) */
  sets?: RebarSetResult[];
  netWeightKg?: number;
  hookWeightKg?: number;
  lapWeightKg?: number;
  wastageWeightKg?: number;
}

/** Where a field value came from. */
export type FieldSource = 'drawing' | 'grid' | 'inferred' | 'assumed' | 'missing' | 'reviewer';

/** Formally classified provenance source levels for release gating. */
export type ProvenanceLevel =
  | 'DRAWING_VERIFIED'
  | 'OCR_EXTRACTED'
  | 'USER_CONFIRMED'
  | 'ENGINEERING_ASSUMPTION'
  | 'DEFAULT_VALUE'
  | 'UNKNOWN';

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
  /** values the sources disagree on, each source with its page: the reader never picks one for the reviewer */
  fieldConflicts?: FieldConflict[];
  /** fields several sources gave: the same value (IDENTICAL) or one filling what another left out (COMPLEMENTARY) */
  fieldAgreements?: { field: ConflictField; kind: 'IDENTICAL' | 'COMPLEMENTARY'; pages: number[] }[];
}

export type ConflictField = 'width' | 'depth' | 'length' | 'count' | 'topRebar' | 'bottomRebar' | 'stirrupRebar' | 'cover';
export interface ConflictSource {
  value: string | number | null;
  /** original PDF page (null: the source has no page, e.g. the project spec) */
  page: number | null;
  /** what on that page: "แบบขยาย / ตาราง", "ชื่อฐานรากในผัง", "หมายเหตุทั่วไป" */
  ref: string;
  method?: EvidenceRef['method'];
  revision?: string;
}
export interface FieldConflict {
  field: ConflictField;
  /** CONFLICT: the values differ; UNDECIDABLE: they are written in forms that cannot be compared */
  kind: 'CONFLICT' | 'UNDECIDABLE';
  sources: ConflictSource[];
}
/**
 * Duplicate review. One ExtractedMember is one SOURCE OCCURRENCE (a plan mark, a schedule row) of a MEMBER REFERENCE
 * (its tag, e.g. F2) and stands for `count` PHYSICAL INSTANCES. Occurrences of one reference are the same instance
 * only on evidence (same level + grid) or a reviewer's ruling; the same specification never makes them one.
 */
export type DuplicateClass = 'SAME_PHYSICAL_INSTANCE' | 'POSSIBLE_DUPLICATE' | 'DISTINCT_PHYSICAL_INSTANCES' | 'SAME_SPECIFICATION' | 'CONFLICTING_SPECIFICATION' | 'INSUFFICIENT_EVIDENCE';
export interface DuplicateDecision {
  /** duplicateGroupKey() of the occurrences ruled on: other occurrences (new reading) ask again */
  key: string;
  decision: 'SAME_INSTANCE' | 'DISTINCT' | 'DEFERRED' | 'UNDECIDED';
  by: string;
  reason?: string;
  at: string;
  revision?: string;
}
export interface Occurrence {
  index: number;
  tag: string;
  memberType: MemberType;
  page: number | null;
  /** level + grid when the drawing places it; null for a schedule row or anything without a position */
  location: string | null;
  text: string;
  spec: string;
}
export interface DuplicateGroup {
  key: string;
  classification: DuplicateClass;
  /** member indices, ascending; the first is the one counted when the reviewer links them */
  members: number[];
  occurrences: Occurrence[];
  evidence: string[];
  /** blocks release until decided */
  blocking: boolean;
  decision?: DuplicateDecision;
  state: 'info' | 'open' | 'invalid' | 'decided';
  problem?: string;
}

export interface ConflictResolution {
  /** conflictKey() of the conflict it settles: a new reading with other sources has another key, so it is asked again */
  key: string;
  field: ConflictField;
  choice: 'source' | 'manual' | 'deferred';
  sourceIndex?: number;
  value: string | number | null;
  /** the member's value before the decision */
  before: string | number | null;
  sourcePage?: number | null;
  by: string;
  reason?: string;
  at: string;
  revision?: string;
}

export interface ReviewDecision {
  status: 'approved' | 'rejected';
  note?: string;
  at: string;
  /** everything the approved quantities were calculated from, and its SHA-256 */
  snapshot?: CalcSnapshot;
  fingerprint?: string;
  /** quantities as they stood when approved (to compare against the current ones) */
  quantities?: ApprovedQuantities;
  /** reviewer name as typed (not an authenticated identity) */
  by?: string;
  /** drawing file the decision was made on: name · SHA-256 prefix */
  revision?: string;
}

/** Human label of the engine; the binding identity is engineIdentity.id, generated from this file's code. */
export const CALC_ENGINE_VERSION = '20.1';
/** SHA-256 of the engine's calculation code (scripts/gen_engine_identity.ts); a mutable holder only so tests can check the unverified gate */
export const engineIdentity = { id: ENGINE_ID };
export const engineIdVerified = (id: string) => /^[0-9a-f]{64}$/.test(id);

export interface DrawingRef { file: string; sha256: string | null }
export type ApprovalState = 'APPROVED' | 'STALE' | 'NEEDS_REVIEW' | 'REJECTED';
export interface ApprovedQuantities { concreteM3: number; formworkM2: number; rebarKg: number; leanM3: number; sandM3: number; excavationM3: number; costThb: number }

/** Every input of one member's calculation (no display labels, no UI state); missing spec values are null, never the default. */
export interface CalcSnapshot {
  schema: 1;
  engineVersion: string;
  engineId: string;
  drawing: DrawingRef | null;
  member: Record<string, unknown>;
  cover: { cm: number; source: CoverSource };
  hook: { shape: string | null; source: 'member' | 'spec' | 'missing' } | null;
  specs: Record<string, unknown>;
}

/** JSON with keys sorted at every level and undefined dropped, so key order never changes a fingerprint. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

// SHA-256 (FIPS 180-4), synchronous because calculateMember is; Web Crypto is async only
const primes = (n: number) => { const p: number[] = []; for (let i = 2; p.length < n; i++) if (p.every(q => i % q)) p.push(i); return p; };
const frac32 = (x: number) => ((x - Math.floor(x)) * 2 ** 32) >>> 0;
const SHA_K = primes(64).map(p => frac32(Math.cbrt(p)));
const SHA_H0 = primes(8).map(p => frac32(Math.sqrt(p)));
const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bytes.length / 2 ** 29));
  dv.setUint32(total - 4, (bytes.length * 8) >>> 0);
  const H = [...SHA_H0];
  const W = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ror(W[i - 15], 7) ^ ror(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = ror(W[i - 2], 17) ^ ror(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + W[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((x, i) => { H[i] = (H[i] + x) | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export function calcSnapshot(m: ExtractedMember, specs: MaterialSpecs = DEFAULT_MATERIAL_SPECS, drawing: DrawingRef | null = null): CalcSnapshot {
  const rules: Record<string, unknown> = { ...DEFAULT_MATERIAL_SPECS, ...specs };
  const c = memberCover(m, rules as unknown as MaterialSpecs);
  const specHook = rules.footingHookShape as string | undefined;
  return {
    schema: 1,
    engineVersion: CALC_ENGINE_VERSION,
    engineId: engineIdentity.id,
    drawing: drawing ?? null,
    member: Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'review' && k !== 'provenance')),
    cover: { cm: Number((c.coverM * 100).toFixed(6)), source: c.source },
    hook: m.memberType !== 'FOOTING' ? null
      : { shape: m.footingHookShape || specHook || null, source: m.footingHookShape ? 'member' : specHook ? 'spec' : 'missing' },
    specs: Object.fromEntries(Object.keys(rules).filter(k => k !== 'sourceText').map(k => [k, rules[k] ?? null])),
  };
}

export const fingerprintOf = (s: CalcSnapshot) => sha256Hex(stableStringify(s));

/** What differs between two snapshots, one line per field ("specs.leanThicknessM: 0.05 → 0.1"). */
export function snapshotDiff(a: CalcSnapshot, b: CalcSnapshot): string[] {
  const show = (v: unknown) => { const s = v === undefined ? '—' : stableStringify(v); return s.length > 48 ? s.slice(0, 45) + '…' : s; };
  const out: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  // descends into objects so the line names the value that changed (specs.valueSources.leanThicknessM.note)
  const cmp = (path: string, x: unknown, y: unknown): void => {
    if (stableStringify(x ?? null) === stableStringify(y ?? null)) return;
    if (isObj(x) && isObj(y)) { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) cmp(`${path}.${k}`, x[k], y[k]); return; }
    out.push(`${path}: ${show(x)} → ${show(y)}`);
  };
  for (const k of ['schema', 'engineVersion', 'engineId', 'drawing', 'cover', 'hook'] as const) cmp(k, a[k], b[k]);
  for (const part of ['member', 'specs'] as const) {
    for (const k of new Set([...Object.keys(a[part] || {}), ...Object.keys(b[part] || {})])) cmp(`${part}.${k}`, a[part]?.[k], b[part]?.[k]);
  }
  return out;
}

/** Approves a member as it stands under these specs and drawing: any later change to an input voids it. */
export function approvalFor(m: ExtractedMember, note?: string, specs: MaterialSpecs = DEFAULT_MATERIAL_SPECS, drawing: DrawingRef | null = null): ReviewDecision {
  const snapshot = calcSnapshot(m, specs, drawing);
  const q = calculateMember({ ...m, review: undefined }, 1, specs, drawing);
  return {
    status: 'approved', note, at: new Date().toISOString(), snapshot, fingerprint: fingerprintOf(snapshot),
    quantities: {
      concreteM3: q.volumeNetM3, formworkM2: q.formworkNetM2, rebarKg: q.rebarWeightKg || 0, leanM3: q.leanConcreteM3 || 0,
      sandM3: q.sandBeddingM3 || 0, excavationM3: q.excavationM3 || 0, costThb: q.totalCostThb || 0,
    },
  };
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
  extraTopRebar?: string;
  extraBottomRebar?: string;
  sideRebar?: string;
  stirrupRebar?: string;
  distRebar?: string;
  topMatRebar?: string;
  tempRebar?: string;
  pedestalHeightM?: number;
  stirrupSets?: number;
  stairRiseM?: number;
  stairRunM?: number;
  stairRisers?: number;
  thickness?: number;
  slabType?: 'CAST_IN_PLACE' | 'PRECAST_PLANK' | 'SLAB_ON_GROUND';
  footingType?: 'ISOLATED' | 'PILE_CAP';
  footingHookShape?: 'FULL_UPTURN' | 'STANDARD_HOOK' | 'STRAIGHT' | 'UNSPECIFIED';
  /** which cover this member uses; unset = coveringCm if given, else the project spec, else the code default */
  coverMode?: CoverMode;
  /** footing bars as separate sets; when present they replace bottomRebar in the calculation (bottomRebar stays as the drawing's note) */
  rebarSets?: RebarSet[];
  /** footing: every bar note the reader found at its section, kept for the reviewer; never used in the calculation */
  rebarNotesRead?: string[];
  /** the reviewer's ruling on each source conflict (part of the approval snapshot) */
  conflictResolutions?: ConflictResolution[];
  /** the reviewer's ruling on whether occurrences of this reference are one physical instance (part of the approval snapshot) */
  duplicateReviews?: DuplicateDecision[];
  pileCount?: number;
  pileSize?: string;
  pileLengthM?: number;
  coveringCm?: number;
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
  pileCostThb?: { material: number; wage: number; total: number };
  pileLengthM?: number;
  coverM?: number;
  coverSource?: CoverSource;
  leanConcreteM3?: number;
  sandBeddingM3?: number;
  excavationM3?: number;
  backfillM3?: number;
  pilesNos?: number;
  precastSlabM2?: number;
  wiremeshM2?: number;
  coords?: { x1: number; y1: number; x2: number; y2: number };
  provenance?: Provenance;
  provenanceLevel?: ProvenanceLevel;
  flags?: ReviewFlag[];
  confidencePct?: number;
  review?: ReviewDecision;
  /** APPROVED only while the stored fingerprint matches the current inputs; undefined = released with no decision needed */
  approvalState?: ApprovalState;
  /** the approval that lapsed and the inputs that changed since */
  staleApproval?: ReviewDecision;
  staleChanges?: string[];
  /** every source conflict on this item and where it stands */
  conflicts?: ConflictStatus[];
  /** the duplicate group this occurrence belongs to, its physical instance id, and whether it is counted */
  duplicate?: { group: DuplicateGroup; instanceId: string; counted: boolean; linkedTo?: string };
  /** class B spec values this item's quantities used (REQUIRED_SPECS) */
  specKeysUsed?: (keyof MaterialSpecs)[];
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
  slabCoveringCm?: number;
  beamCoveringCm?: number;
  columnCoveringCm?: number;
  footingCoveringCm?: number;
  /** where each member-type cover in this spec came from (absent = not recorded: a value equal to the code default counts as default) */
  coverSources?: Partial<Record<'footing' | 'column' | 'beam' | 'slab', 'drawing_notes' | 'user'>>;
  /** where a quantity-relevant spec value came from; absent = the code default nobody gave (see REQUIRED_SPECS) */
  valueSources?: Partial<Record<keyof MaterialSpecs, SpecValueSource>>;
  stockBarLengthM?: number;
  footingHookShape?: 'FULL_UPTURN' | 'STANDARD_HOOK' | 'STRAIGHT' | 'UNSPECIFIED';
  /** DPT/วสท. standard cut ratios for extra bars & 2-zone stirrups (used when drawing omits explicit cutoff lengths) */
  extraTopCutRatio?: number;
  extraBottomCutRatio?: number;
  stirrupEndZoneRatio?: number;
  leanConcreteMatRate: number;
  leanConcreteLaborRate: number;
  sandBedMatRate: number;
  sandBedLaborRate: number;
  pileSupplyRatePerM?: number;
  pileDrivingRatePerM?: number;
  pileSupplyRatePerNos?: number;
  pileDrivingRatePerNos?: number;
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
  slabCoveringCm: 2.0,
  beamCoveringCm: 3.0,
  columnCoveringCm: 3.5,
  footingCoveringCm: 5.0,
  stockBarLengthM: 6.0,
  footingHookShape: 'FULL_UPTURN',
  extraTopCutRatio: 0.30,
  extraBottomCutRatio: 0.70,
  stirrupEndZoneRatio: 0.25,
  leanConcreteMatRate: 1750,
  leanConcreteLaborRate: 380,
  sandBedMatRate: 480,
  sandBedLaborRate: 120,
  // UNVERIFIED DEFAULT PRICE — NOT AN OFFICIAL REFERENCE PRICE (Estimator Default Placeholder)
  pileSupplyRatePerM: 220,
  pileDrivingRatePerM: 85,
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
  const rawHasMemberCover = raw.slabCoveringCm != null || raw.slab_covering_cm != null ||
                            raw.beamCoveringCm != null || raw.beam_covering_cm != null ||
                            raw.columnCoveringCm != null || raw.column_covering_cm != null ||
                            raw.footingCoveringCm != null || raw.footing_covering_cm != null;
  const rawHasLegacyCoverOnly = !rawHasMemberCover && (raw.concreteCoveringCm != null || raw.concrete_covering_cm != null);

  const numOpt = (camel: string, snake: string) => {
    const v = raw[camel] ?? raw[snake];
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v);
      return isNaN(n) ? (DEFAULT_MATERIAL_SPECS as any)[camel] : n;
    }
    if (rawHasLegacyCoverOnly) return undefined;
    return (DEFAULT_MATERIAL_SPECS as any)[camel];
  };

  const numOptRate = (camel: string, snake: string) => {
    const v = raw[camel] ?? raw[snake];
    if (v === undefined || v === null || v === '') return (DEFAULT_MATERIAL_SPECS as any)[camel];
    const n = Number(v);
    return isNaN(n) ? (DEFAULT_MATERIAL_SPECS as any)[camel] : n;
  };

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
    slabCoveringCm: numOpt('slabCoveringCm', 'slab_covering_cm'),
    beamCoveringCm: numOpt('beamCoveringCm', 'beam_covering_cm'),
    columnCoveringCm: numOpt('columnCoveringCm', 'column_covering_cm'),
    footingCoveringCm: numOpt('footingCoveringCm', 'footing_covering_cm'),
    coverSources: raw.coverSources,
    valueSources: raw.valueSources,
    stockBarLengthM: numOptRate('stockBarLengthM', 'stock_bar_length_m') ?? DEFAULT_MATERIAL_SPECS.stockBarLengthM,
    footingHookShape: (raw?.footingHookShape || raw?.footing_hook_shape || DEFAULT_MATERIAL_SPECS.footingHookShape) as any,
    extraTopCutRatio: numOptRate('extraTopCutRatio', 'extra_top_cut_ratio') ?? DEFAULT_MATERIAL_SPECS.extraTopCutRatio,
    extraBottomCutRatio: numOptRate('extraBottomCutRatio', 'extra_bottom_cut_ratio') ?? DEFAULT_MATERIAL_SPECS.extraBottomCutRatio,
    stirrupEndZoneRatio: numOptRate('stirrupEndZoneRatio', 'stirrup_end_zone_ratio') ?? DEFAULT_MATERIAL_SPECS.stirrupEndZoneRatio,
    leanConcreteMatRate: num('leanConcreteMatRate', 'lean_concrete_mat_rate'),
    leanConcreteLaborRate: num('leanConcreteLaborRate', 'lean_concrete_labor_rate'),
    sandBedMatRate: num('sandBedMatRate', 'sand_bed_mat_rate'),
    sandBedLaborRate: num('sandBedLaborRate', 'sand_bed_labor_rate'),
    pileSupplyRatePerM: numOptRate('pileSupplyRatePerM', 'pile_supply_rate_per_m'),
    pileDrivingRatePerM: numOptRate('pileDrivingRatePerM', 'pile_driving_rate_per_m'),
    pileSupplyRatePerNos: numOptRate('pileSupplyRatePerNos', 'pile_supply_rate_per_nos'),
    pileDrivingRatePerNos: numOptRate('pileDrivingRatePerNos', 'pile_driving_rate_per_nos'),
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

/** where the cover used came from: this member's drawing, the reviewer, the drawing's general notes, the project spec, or nothing (code default) */
export type CoverSource = 'drawing' | 'manual' | 'drawing_notes' | 'project_spec' | 'legacy_spec' | 'default';
export type CoverMode = 'FROM_DRAWING' | 'FROM_PROJECT_SPEC' | 'MANUAL';

export interface CoverResolution {
  coverM: number;
  source: CoverSource;
  warning?: string;
  assumed?: boolean;
}

export function defaultCoverCmForMember(memberType: string): number {
  switch (memberType) {
    case 'SLAB':
    case 'STAIR':
      return 2.0;
    case 'BEAM':
      return 3.0;
    case 'COLUMN':
      return 3.5;
    case 'FOOTING':
      return 5.0;
    default:
      return 3.5;
  }
}

export function resolveMemberCoverM(
  memberType: string,
  specs?: Partial<MaterialSpecs>,
  memberCoverCm?: number,
  /** memberSource: fieldSources.cover of the member ('drawing' only when read from its drawing) */
  opts: { memberSource?: FieldSource; mode?: CoverMode } = {}
): CoverResolution {
  const defCm = defaultCoverCmForMember(memberType);
  const m = (cm: number) => Number((cm / 100.0).toFixed(4));
  // an unusable value never silently becomes the default: the warning blocks the member
  const bad = (msg: string): CoverResolution => ({ coverM: m(defCm), source: 'default', warning: `${msg} — คิดชั่วคราวด้วยค่ามาตรฐาน ${defCm} ซม. แต่ห้ามปล่อยยอด`, assumed: true });
  const valid = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 20;
  const range = '(ต้องมากกว่า 0 และไม่เกิน 20 ซม.)';
  const key = memberType === 'SLAB' || memberType === 'STAIR' ? 'slab' : memberType === 'BEAM' ? 'beam' : memberType === 'COLUMN' ? 'column' : memberType === 'FOOTING' ? 'footing' : undefined;
  const specCm = key ? specs?.[`${key}CoveringCm` as 'footingCoveringCm'] : undefined;
  const specFrom = key ? specs?.coverSources?.[key] : undefined;
  const hasMember = memberCoverCm !== undefined && memberCoverCm !== null;
  const memberSrc: CoverSource = opts.memberSource === 'drawing' ? 'drawing' : 'manual';

  const fromMember = (): CoverResolution =>
    valid(memberCoverCm) ? { coverM: m(Number(memberCoverCm)), source: memberSrc } : bad(`ระยะหุ้มคอนกรีต${memberSrc === 'drawing' ? 'จากแบบ' : 'ที่กรอก'} (${memberCoverCm} ซม.) ไม่ถูกต้อง ${range}`);
  // the spec counts only when someone set it (notes page or user) or it differs from the code default
  const specGiven = specCm !== undefined && specCm !== null && (specFrom !== undefined || Number(specCm) !== defCm);
  const fromSpec = (): CoverResolution | undefined => {
    if (specCm === undefined || specCm === null) return undefined;
    if (!valid(specCm)) return bad(`ระยะหุ้มคอนกรีตในสเปก (${specCm} ซม.) ไม่ถูกต้อง ${range}`);
    return specGiven ? { coverM: m(Number(specCm)), source: specFrom === 'drawing_notes' ? 'drawing_notes' : 'project_spec' } : undefined;
  };

  if (opts.mode === 'MANUAL') return hasMember ? fromMember() : bad('เลือกกรอกระยะหุ้มเอง แต่ยังไม่มีค่า');
  if (opts.mode === 'FROM_DRAWING') {
    if (hasMember && memberSrc === 'drawing') return fromMember();
    if (specFrom === 'drawing_notes') return fromSpec()!;
    return bad('เลือกระยะหุ้มจากแบบ แต่แบบไม่ได้ให้ระยะหุ้ม');
  }
  if (opts.mode !== 'FROM_PROJECT_SPEC' && hasMember) return fromMember();

  const spec = fromSpec();
  if (spec) return spec;

  // legacy single cover for every member type
  if (specs && specs.concreteCoveringCm !== undefined && specs.concreteCoveringCm !== null) {
    const val = Number(specs.concreteCoveringCm);
    if (!valid(val)) return bad(`ระยะหุ้มคอนกรีตรวม (${specs.concreteCoveringCm} ซม.) ไม่ถูกต้อง ${range}`);
    const isLegacyCustom = val !== DEFAULT_MATERIAL_SPECS.concreteCoveringCm;
    const hasExplicitMemberKey = specs.slabCoveringCm !== undefined || specs.beamCoveringCm !== undefined ||
                                 specs.columnCoveringCm !== undefined || specs.footingCoveringCm !== undefined;
    if (isLegacyCustom || !hasExplicitMemberKey) return { coverM: m(val), source: 'legacy_spec' };
  }

  // nothing gave a cover: the code default, flagged by the caller
  return { coverM: m(defCm), source: 'default', assumed: true };
}

/** The cover a member is calculated with (same call the engine makes), for stamping it on an approval. */
export const memberCover = (member: ExtractedMember, specs?: Partial<MaterialSpecs>) =>
  resolveMemberCoverM(member.memberType, { ...DEFAULT_MATERIAL_SPECS, ...specs }, member.coveringCm,
    { memberSource: member.provenance?.fieldSources.cover, mode: member.coverMode });

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

export interface SpacedBarValidation {
  bar: string;
  spacing: number;
  midSpacing?: number;
  legs?: number;
  isValid: boolean;
  error?: string;
}

/**
 * Validates spaced bar specifications (e.g., "RB6@0.15m", "RB6@0.10/0.20", "2-RB6@0.10/0.20").
 * Explicitly rejects spacing <= 0, NaN, Infinity, or missing numeric values.
 */
export function validateSpacedBar(spec?: string): SpacedBarValidation | null {
  if (!spec) return null;
  if (!/@/.test(spec)) return null;
  const legsMatch = spec.trim().match(/^([1-4])\s*[-]\s*(?=(?:DB|RB|Ø|ø|ปล|ป))/i);
  const legs = legsMatch ? Number(legsMatch[1]) : undefined;
  const m = spec.match(/(DB|RB|Ø|ø)?\s*(\d{1,2})\s*(?:มม\.?|mm)?\s*@\s*(-?\d+(?:\.\d+)?|NaN|Infinity)?\s*(cm|mm|m|ม\.)?(?:\s*\/\s*@?\s*(-?\d+(?:\.\d+)?|NaN|Infinity)\s*(cm|mm|m|ม\.)?)?/i);
  if (!m) return null;
  const diaNum = Number(m[2]);
  const bar = barName(m[1] === 'Ø' || m[1] === 'ø' ? undefined : m[1], isNaN(diaNum) ? 6 : diaNum);
  const rawNumStr = m[3];
  if (rawNumStr === undefined || rawNumStr === '') {
    return { bar, spacing: NaN, isValid: false, error: 'ไม่พบตัวเลขระยะห่างหลังเครื่องหมาย @' };
  }
  const rawNum = parseFloat(rawNumStr);
  if (!Number.isFinite(rawNum) || rawNum <= 0) {
    return { bar, spacing: rawNum, isValid: false, error: `ระยะห่างเหล็กไม่ถูกต้อง (${rawNumStr}) ต้องเป็นตัวเลขบวกที่แน่นอน (> 0)` };
  }
  let spacing = rawNum;
  const u = (m[4] || '').toLowerCase();
  if (u === 'cm' || (spacing > 1.0 && spacing < 100)) spacing /= 100.0;
  else if (u === 'mm' || spacing >= 100) spacing /= 1000.0;

  let midSpacing: number | undefined;
  if (m[5] !== undefined && m[5] !== '') {
    const rawMid = parseFloat(m[5]);
    if (!Number.isFinite(rawMid) || rawMid <= 0) {
      return { bar, spacing, isValid: false, error: `ระยะห่างเหล็กช่วงกลางไม่ถูกต้อง (${m[5]}) ต้องเป็นตัวเลขบวก (> 0)` };
    }
    midSpacing = rawMid;
    const u2 = (m[6] || m[4] || '').toLowerCase();
    if (u2 === 'cm' || (midSpacing > 1.0 && midSpacing < 100)) midSpacing /= 100.0;
    else if (u2 === 'mm' || midSpacing >= 100) midSpacing /= 1000.0;
  }
  return { bar, spacing, ...(midSpacing ? { midSpacing } : {}), ...(legs ? { legs } : {}), isValid: true };
}

/** "RB6@0.15m" -> {bar:'RB6', spacing:0.15} */
export function parseSpacedBar(spec?: string): { bar: string; spacing: number } | null {
  const v = validateSpacedBar(spec);
  if (!v || !v.isValid) return null;
  return { bar: v.bar, spacing: v.spacing };
}

const barDiaM = (bar: string) => Number(bar.replace(/\D/g, '')) / 1000;

function addBar(acc: Record<string, number>, bar: string, lengthM: number) {
  const kg = lengthM * (REBAR_KG_PER_M[bar] ?? REBAR_KG_PER_M.DB12);
  acc[bar] = Number(((acc[bar] || 0) + kg).toFixed(3));
}

export const gradeFy = (grade?: string) => Number((grade || '').match(/S[DR]\s*(\d{2})/i)?.[1] ?? 40) * 100;

export const rebarSetBarName = (s: RebarSet) => `${s.barType || ((s.diameterMm || 0) < 12 ? 'RB' : 'DB')}${s.diameterMm ?? '?'}`;
const DIR_TH: Record<RebarSet['direction'], string> = { X: 'แนว X', Y: 'แนว Y', BOTH: 'ทั้ง 2 ทิศ', UNSPECIFIED: 'ทิศไม่ระบุ' };
export const rebarSetLabel = (s: RebarSet) =>
  `${s.id} ${s.quantity ? s.quantity + '-' : ''}${rebarSetBarName(s)}${s.spacingMm ? '@' + s.spacingMm / 1000 : ''} ${DIR_TH[s.direction] || s.direction}${s.layer === 'TOP' ? ' ชั้นบน' : ''}`;

/** Provenance level of one set: what backs its values, never promoted past what the source says. */
export function rebarSetProvenanceLevel(s: RebarSet, member: ExtractedMember): ProvenanceLevel {
  if (s.source === 'reviewer') return 'USER_CONFIRMED';
  if (!member.provenance) return 'UNKNOWN';
  if (s.source === 'assumed' || s.source === 'inferred') return 'ENGINEERING_ASSUMPTION';
  if (s.source === 'missing') return 'DEFAULT_VALUE';
  if (s.source === 'drawing' || s.source === 'grid') {
    const ev = member.provenance?.evidence || [];
    if (ev.some(e => e.method === 'dxf')) return 'DRAWING_VERIFIED';
    if (ev.some(e => e.method === 'vision' || e.method === 'pdf_text')) return 'OCR_EXTRACTED';
  }
  return 'UNKNOWN';
}

export const newRebarSetId = () => `RS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const HOOK_FROM_SHAPE: Record<string, HookEnd> = { FULL_UPTURN: 'UPTURN', STRAIGHT: 'NONE', STANDARD_HOOK: 'HOOK_90', UNSPECIFIED: 'UNSPECIFIED' };

/**
 * Splits a footing's bar note into RebarSets without interpreting more than it says: every group becomes
 * its own set with direction UNSPECIFIED (the note does not say which way), ends from the member's own
 * hook shape only (never the project default), and the note kept as sourceText. An unreadable note
 * still gives one set holding the text, so nothing is dropped.
 */
export function rebarSetsFromNote(member: ExtractedMember): RebarSet[] {
  const note = member.bottomRebar || '';
  const source: FieldSource = member.provenance?.fieldSources.rebar ?? 'missing';
  const end = (member.footingHookShape && HOOK_FROM_SHAPE[member.footingHookShape]) || 'UNSPECIFIED';
  const base = { direction: 'UNSPECIFIED' as const, layer: 'BOTTOM' as const, startHook: end, endHook: end, sourceText: note || undefined, source };
  const dia = (bar: string) => Number(bar.replace(/\D/g, ''));
  const kind = (bar: string) => (bar.startsWith('RB') ? 'RB' as const : 'DB' as const);
  const spaced = validateSpacedBar(note);
  const unread: RebarSet[] = [{ ...base, id: newRebarSetId(), arrangement: 'UNSPECIFIED' }];
  // a count next to a spacing ("3-DB12 + 3-DB12 @150") can be read more than one way: keep it as text for the reviewer
  if (spaced && /\d+\s*(?:\+\s*\d+\s*)?[- ]\s*(DB|RB|Ø|ø)/i.test(note)) return unread;
  const groups = spaced ? [] : parseBarGroups(note);
  const sets: RebarSet[] = groups.map(g => ({ ...base, id: newRebarSetId(), barType: kind(g.bar), diameterMm: dia(g.bar), arrangement: 'FIXED_COUNT' as const, quantity: g.n }));
  if (spaced?.isValid) sets.push({ ...base, id: newRebarSetId(), barType: kind(spaced.bar), diameterMm: dia(spaced.bar), arrangement: 'SPACED', spacingMm: Math.round(spaced.spacing * 1000) });
  return sets.length ? sets : unread;
}

export interface RebarSetBar { direction: 'X' | 'Y'; bar: string; dia: number; n: number; cutLenM: number; netLenM: number; hookLenM: number }

/**
 * Bars of one footing RebarSet, each direction on its own. Nothing is guessed: a value the set needs and
 * does not give blocks the set (its input is kept, its weight is not counted).
 * X bars run along the width and are spread over the length; Y the other way round.
 */
export function rebarSetBars(s: RebarSet, g: { widthM: number; lengthM: number; thickM: number; coverM: number }, member?: ExtractedMember): { bars: RebarSetBar[]; flags: ReviewFlag[]; status: RebarSetResult['status'] } {
  const field = `rebarSet:${s.id}`;
  const label = rebarSetLabel(s);
  const flags: ReviewFlag[] = [];
  const block = (code: string, msg: string) => flags.push({ code, severity: 'block', field, message: `${label}: ${msg}` });
  const warn = (code: string, msg: string) => flags.push({ code, severity: 'warn', field, message: `${label}: ${msg}` });
  const c = g.coverM;
  const bar = rebarSetBarName(s);
  const dia = s.diameterMm ?? 0;

  if (!(dia > 0)) block('REBAR_SET_INVALID', 'ขนาดเหล็กต้องมากกว่า 0');
  else if (REBAR_KG_PER_M[bar] === undefined) block('REBAR_SET_INVALID', `ไม่มีน้ำหนักต่อเมตรของ ${bar} ในตาราง — ตรวจขนาดเหล็ก`);
  if (s.quantity !== undefined && !(Number.isInteger(s.quantity) && s.quantity > 0)) block('REBAR_SET_INVALID', `จำนวน ${s.quantity} ต้องเป็นจำนวนเต็มบวก`);
  if (s.spacingMm !== undefined && !(s.spacingMm > 0)) block('REBAR_SET_INVALID', `ระยะเรียง ${s.spacingMm} มม. ต้องมากกว่า 0`);
  else if (s.spacingMm !== undefined && dia > 0 && s.spacingMm <= dia) block('REBAR_SET_INVALID', `ระยะเรียง ${s.spacingMm} มม. ไม่มากกว่าขนาดเหล็ก ${dia} มม.`);
  if (s.hookLengthM !== undefined && !(s.hookLengthM >= 0)) block('REBAR_SET_INVALID', 'ความยาวงอต้องไม่ติดลบ');
  if (s.cuttingLengthM !== undefined && !(s.cuttingLengthM > 0)) block('REBAR_SET_INVALID', 'ความยาวตัดต้องมากกว่า 0');

  // how the count is defined
  if (!['FIXED_COUNT', 'SPACED', 'TWO_DIRECTION', 'UNSPECIFIED'].includes(s.arrangement)) block('REBAR_SET_INVALID', `การจัดเหล็ก '${s.arrangement}' ไม่รู้จัก`);
  if (s.arrangement === 'FIXED_COUNT' && s.quantity === undefined) block('REBAR_SET_CONFLICT', 'จัดแบบจำนวนคงที่แต่ไม่มีจำนวนเส้น');
  if (s.arrangement === 'SPACED' && s.spacingMm === undefined) block('REBAR_SET_CONFLICT', 'จัดแบบระยะเรียงแต่ไม่มีระยะเรียง');
  if (s.arrangement === 'TWO_DIRECTION' && s.direction !== 'BOTH') block('REBAR_SET_CONFLICT', 'จัดแบบ 2 ทิศ แต่ทิศไม่ใช่ "ทั้ง 2 ทิศ"');
  if (s.quantity === undefined && s.spacingMm === undefined) block('REBAR_SET_INCOMPLETE', 'ไม่มีทั้งจำนวนเส้นและระยะเรียง');
  if (s.arrangement === 'UNSPECIFIED') warn('REBAR_SET_ARRANGEMENT_UNSPECIFIED', 'ไม่ระบุการจัดเหล็ก (จำนวนคงที่/ระยะเรียง) — ยืนยันกับแบบ');

  // direction: the count (n or 2n) and the bar length both depend on it, so it is never guessed
  if (!['X', 'Y', 'BOTH', 'UNSPECIFIED'].includes(s.direction)) block('REBAR_SET_INVALID', `ทิศ '${s.direction}' ไม่รู้จัก`);
  if (s.direction === 'UNSPECIFIED') block('REBAR_SET_DIRECTION_UNSPECIFIED', 'ทิศไม่ระบุ — เลือก X, Y หรือทั้ง 2 ทิศ');
  if (s.layer !== 'BOTTOM' && s.layer !== 'TOP') block('REBAR_SET_INVALID', `ชั้น '${s.layer}' ไม่รู้จัก`);

  // ends
  const end = (h: HookEnd, which: string) => {
    if (h === 'NONE') return 0;
    if (h === 'UPTURN') {
      if (s.hookLengthM !== undefined) return s.hookLengthM;
      const up = g.thickM - 2 * c;
      if (!(up > 0)) { block('REBAR_SET_INVALID', `${which}งอตั้ง: ความหนาหักระยะหุ้มเหลือ ${up.toFixed(2)} ม.`); return 0; }
      flags.push({ code: 'REBAR_SET_UPTURN_FROM_THICKNESS', severity: 'info', field, message: `${label}: ${which}งอตั้งสูง ${up.toFixed(2)} ม. คิดจากความหนา − 2×ระยะหุ้ม (แบบไม่ให้ความยาวงอ)` });
      return up;
    }
    if (h === 'HOOK_90') {
      if (s.hookLengthM === undefined) { block('REBAR_SET_INCOMPLETE', `${which}งอฉาก แต่ไม่มีความยาวงอ — ไม่ใช้ค่าสากล ต้องกรอกจากแบบ`); return 0; }
      return s.hookLengthM;
    }
    if (h === 'UNSPECIFIED') { warn('REBAR_SET_HOOK_UNSPECIFIED', `${which}ไม่ระบุรูปปลาย — คิดเป็นปลายตรง ยืนยันกับแบบ`); return 0; }
    block('REBAR_SET_INVALID', `${which} '${h}' ไม่รู้จัก`);
    return 0;
  };
  const hooks = end(s.startHook, 'ปลายต้น ') + end(s.endHook, 'ปลายท้าย ');

  if (s.source !== 'drawing' && s.source !== 'reviewer' && s.source !== 'grid') {
    warn('REBAR_SET_SOURCE', `ที่มาเป็น "${s.source}" ไม่ใช่ค่าจากแบบ — ยืนยันหรือแก้ชุดนี้`);
  } else if (member && s.source !== 'reviewer' && !member.provenance) {
    warn('REBAR_SET_SOURCE', 'ชิ้นนี้ไม่มีหลักฐานจากแบบ — ยืนยันหรือแก้ชุดนี้');
  }

  const dirs: ('X' | 'Y')[] = s.direction === 'BOTH' ? ['X', 'Y'] : s.direction === 'X' || s.direction === 'Y' ? [s.direction] : [];
  const out: RebarSetBar[] = [];
  for (const d of dirs) {
    const run = (d === 'X' ? g.widthM : g.lengthM) - 2 * c;
    const spread = (d === 'X' ? g.lengthM : g.widthM) - 2 * c;
    if (!(run > 0) || !(spread > 0)) { block('REBAR_SET_INVALID', `แนว ${d}: ระยะหุ้มไม่เหลือช่วงวางเหล็ก`); continue; }
    const fromSpacing = s.spacingMm ? Math.floor(spread / (s.spacingMm / 1000) + 1e-7) + 1 : undefined;
    if (s.quantity !== undefined && fromSpacing !== undefined && s.quantity !== fromSpacing) {
      block('REBAR_SET_CONFLICT', `แนว ${d}: จำนวน ${s.quantity} เส้นไม่ตรงกับระยะเรียง @${s.spacingMm} มม. (ได้ ${fromSpacing} เส้น) — เลือกค่าที่ถูก`);
      continue;
    }
    const n = s.quantity ?? fromSpacing ?? 0;
    if (n * dia / 1000 > spread) { block('REBAR_SET_INVALID', `แนว ${d}: ${n} เส้น × ${dia} มม. ไม่พอดีช่วง ${spread.toFixed(2)} ม.`); continue; }
    const cut = s.cuttingLengthM ?? run + hooks;
    out.push({ direction: d, bar, dia, n, cutLenM: cut, netLenM: s.cuttingLengthM !== undefined ? cut - hooks : run, hookLenM: hooks });
  }
  const blocked = flags.some(f => f.severity === 'block');
  return { bars: blocked ? [] : out, flags, status: blocked ? 'BLOCKED' : flags.some(f => f.severity === 'warn') ? 'NEEDS_REVIEW' : 'CALCULATED' };
}

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
  flags?: ReviewFlag[];
} {
  const bars: Record<string, number> = {};
  const barList: RebarBarDetail[] = [];
  const flags: ReviewFlag[] = [];
  let rebarFormulaStr = '';
  let assumedRatio = false;
  const minBasis: string[] = [];
  let setResults: RebarSetResult[] | undefined;

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
    forceGrade?: 'SR24' | 'SD30' | 'SD40' | 'SD50',
    netLenM?: number,
    hookLenM?: number,
    lapLenM?: number
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
      netLengthM: netLenM !== undefined ? Number(netLenM.toFixed(3)) : Number(cutLenM.toFixed(3)),
      hookLengthM: hookLenM !== undefined ? Number(hookLenM.toFixed(3)) : 0,
      lapLengthM: lapLenM !== undefined ? Number(lapLenM.toFixed(3)) : 0,
    });
  };

  if (member.memberType === 'FOOTING' && member.rebarSets) {
    // RebarSets replace the bottomRebar note: each set on its own, then summed by bar size
    if (!member.rebarSets.length) {
      flags.push({ code: 'REBAR_SETS_EMPTY', severity: 'block', field: 'rebarSets', message: 'แยกเป็นชุดเหล็กแล้วแต่ไม่มีชุดใด — เพิ่มชุดเหล็ก (เหล็กจะไม่ถูกคิดเป็น 0)' });
    }
    setResults = [];
    for (const set of member.rebarSets) {
      const r = rebarSetBars(set, { widthM: wM, lengthM: dM, thickM: lNetM, coverM: cover }, member);
      flags.push(...r.flags);
      let wt = 0, n = 0;
      for (const b of r.bars) {
        pushBarItem(b.bar, b.dia, count * b.n, b.cutLenM, `ชุด ${set.id} ${set.layer === 'TOP' ? 'ชั้นบน' : 'ชั้นล่าง'} แนว ${b.direction}`, undefined, b.netLenM, b.hookLenM, 0);
        Object.assign(barList[barList.length - 1], { setId: set.id, direction: b.direction });
        wt += barList[barList.length - 1].totalWeightKg;
        n += count * b.n;
      }
      setResults.push({ id: set.id, set, status: r.status, provenanceLevel: rebarSetProvenanceLevel(set, member), bars: n, weightKg: Number(wt.toFixed(2)), reasons: r.flags.filter(f => f.severity !== 'info').map(f => f.message) });
    }
    rebarFormulaStr = `ชุดเหล็กฐานราก ${member.rebarSets.length} ชุด: ` + member.rebarSets.map(rebarSetLabel).join(' + ');
  } else if (member.memberType === 'FOOTING') {
    const valSpaced = validateSpacedBar(member.bottomRebar);
    if (valSpaced && !valSpaced.isValid) {
      flags.push({ code: 'REBAR_SPACING_INVALID', severity: 'block', field: 'bottomRebar', message: valSpaced.error! });
      return { bars: {}, rebarFormulaStr: 'CALCULATION_BLOCKED: ' + valSpaced.error, assumedRatio: false, minBasis: [], flags };
    }

    const groups = parseBarGroups(member.bottomRebar);
    if (groups.length > 2) {
      flags.push({ code: 'REBAR_GROUPS_UNREAD', severity: 'block', field: 'bottomRebar', message: `เหล็กฐานราก '${member.bottomRebar}' มี ${groups.length} กลุ่ม — คิดได้เฉพาะตะแกรง 2 ทิศ ต้องแยกเหล็กแต่ละทิศให้ชัดก่อน` });
      return { bars: {}, rebarFormulaStr: 'CALCULATION_BLOCKED: more than two bar groups', assumedRatio: false, minBasis: [], flags };
    }
    let nx: number, ny: number, bar: string;
    let barY: string | undefined;
    if (groups.length === 2) {
      nx = groups[0].n;
      ny = groups[1].n;
      bar = groups[0].bar;
      barY = groups[1].bar;
      // order only matters when the two groups differ on a footing that is not square
      if ((nx !== ny || bar !== barY) && Math.abs(wM - dM) > 1e-6) {
        flags.push({ code: 'REBAR_DIRECTION_ASSUMED', severity: 'warn', field: 'bottomRebar', message: `แบบไม่ระบุทิศของ '${member.bottomRebar}' — คิดกลุ่มแรก (${nx}-${bar}) เป็นเหล็กแนวยาว ${wM} ม. และกลุ่มหลัง (${ny}-${barY}) แนวยาว ${dM} ม. ตรวจแบบขยาย` });
      }
    } else if (groups.length === 1) {
      nx = groups[0].n;
      ny = groups[0].n;
      bar = groups[0].bar;
      flags.push({ code: 'REBAR_DIRECTION_ASSUMED', severity: 'warn', field: 'bottomRebar', message: `'${member.bottomRebar}' ระบุกลุ่มเดียว — คิด ${nx} เส้นในแต่ละทิศ (รวม ${2 * nx} เส้น) ตรวจว่าแบบหมายถึงต่อทิศหรือรวม` });
    } else {
      if (valSpaced && valSpaced.isValid) {
        bar = valSpaced.bar;
        const rawX = Math.floor((dM - 2 * cover) / valSpaced.spacing + 1e-7) + 1;
        const rawY = Math.floor((wM - 2 * cover) / valSpaced.spacing + 1e-7) + 1;
        nx = Math.max(3, rawX);
        ny = Math.max(3, rawY);
        if (rawX < 3 || rawY < 3) {
          flags.push({ code: 'REBAR_COUNT_RAISED', severity: 'warn', field: 'bottomRebar', message: `ระยะเรียง @${valSpaced.spacing} ได้ ${rawX}×${rawY} เส้น — ระบบเพิ่มเป็นขั้นต่ำ 3 เส้นต่อทิศ (${nx}×${ny}) ไม่ใช่ค่าจากแบบ` });
        }
      } else if (!member.bottomRebar) {
        bar = 'DB12';
        const s = 0.15;
        nx = Math.max(3, Math.floor((dM - 2 * cover) / s + 1e-7) + 1);
        ny = Math.max(3, Math.floor((wM - 2 * cover) / s + 1e-7) + 1);
        assumedRatio = true;
      } else {
        flags.push({ code: 'REBAR_SPEC_UNPARSED', severity: 'block', field: 'bottomRebar', message: `ไม่สามารถอ่านสเปคเหล็กฐานราก '${member.bottomRebar}' ได้` });
        return { bars: {}, rebarFormulaStr: 'CALCULATION_BLOCKED: Unparsed rebar spec', assumedRatio: false, minBasis: [], flags };
      }
    }

    barY ??= bar;
    const dia = Number(bar.replace(/\D/g, '')) || 12;
    const diaY = Number(barY.replace(/\D/g, '')) || 12;
    const hookShape = member.footingHookShape || rules.footingHookShape || 'FULL_UPTURN';
    let hook = 0;
    let hookY = 0;
    let hookDesc = '';

    if (hookShape === 'STRAIGHT') {
      hook = 0;
      hookDesc = 'เหล็กตรง (Straight)';
    } else if (hookShape === 'STANDARD_HOOK') {
      hook = Math.max(0.10, Math.min(lNetM - 2 * cover, 12 * (dia / 1000)));
      hookY = Math.max(0.10, Math.min(lNetM - 2 * cover, 12 * (diaY / 1000)));
      hookDesc = `ขอดัดมาตรฐาน 12d (${hook.toFixed(2)}m)`;
    } else if (hookShape === 'UNSPECIFIED') {
      hook = Math.max(0.10, lNetM - 2 * cover);
      hookDesc = `งอขอฉากตั้งขึ้น (${hook.toFixed(2)}m) [สมมติฐานรอตรวจสอบ]`;
      flags.push({
        code: 'FOOTING_HOOK_UNSPECIFIED',
        severity: 'warn',
        field: 'rebar',
        message: 'รูปแบบการงอดัดเหล็กฐานรากไม่ได้ระบุในแบบ — ใช้สมมติฐานชั่วคราวงอปลายตั้งขึ้นเต็มความหนาฐานราก (Provisional Quantity: ต้องมีวิศวกร/QS ตรวจสอบแบบขยายฐานราก)',
      });
    } else {
      // FULL_UPTURN
      hook = Math.max(0.10, lNetM - 2 * cover);
      hookDesc = `งอขอฉากตั้งขึ้น (${hook.toFixed(2)}m)`;
    }
    if (hookShape !== 'STANDARD_HOOK') hookY = hook; // only the 12d hook depends on bar size
    if (hookShape !== 'STRAIGHT' && lNetM - 2 * cover < 0.10) {
      flags.push({ code: 'FOOTING_HOOK_RAISED', severity: 'warn', field: 'rebar', message: `ความหนาหักระยะหุ้มเหลือ ${(lNetM - 2 * cover).toFixed(2)} ม. — ระบบใช้ขางอขั้นต่ำ 0.10 ม. ไม่ใช่ค่าจากแบบ` });
    }
    if (!member.footingHookShape && hookShape !== 'UNSPECIFIED') {
      flags.push({ code: 'FOOTING_HOOK_ASSUMED', severity: 'warn', field: 'rebar', message: `แบบไม่ระบุรูปงอเหล็กก้นฐานราก — ใช้ค่าในสเปก: ${hookDesc} — ตรวจสอบแบบขยายฐานราก` });
    }

    const netLenX = Number((wM - 2 * cover).toFixed(3));
    const netLenY = Number((dM - 2 * cover).toFixed(3));
    const lenX = Number((netLenX + 2 * hook).toFixed(3));
    const lenY = Number((netLenY + 2 * hookY).toFixed(3));
    pushBarItem(bar, dia, count * nx, lenX, `ตะแกรงก้นฐานรากแนวแกน X (${hookDesc})`, undefined, netLenX, 2 * hook, 0);
    pushBarItem(barY, diaY, count * ny, lenY, `ตะแกรงก้นฐานรากแนวแกน Y (${hookDesc})`, undefined, netLenY, 2 * hookY, 0);
    rebarFormulaStr = barY === bar ? `ตะแกรงก้นฐานราก ${nx}+${ny}-${bar} (ปลาย${hookDesc})` : `ตะแกรงก้นฐานราก ${nx}-${bar} + ${ny}-${barY} (ปลาย${hookDesc})`;

    // Optional footing top mat rebar (ตะแกรงบนฐานราก)
    if (member.topMatRebar) {
      const topGroups = parseBarGroups(member.topMatRebar);
      const topSpaced = validateSpacedBar(member.topMatRebar);
      let tnx = 0, tny = 0, tbar = bar;
      if (topGroups.length >= 2) {
        tnx = topGroups[0].n;
        tny = topGroups[1].n;
        tbar = topGroups[0].bar;
      } else if (topGroups.length === 1) {
        tnx = topGroups[0].n;
        tny = topGroups[0].n;
        tbar = topGroups[0].bar;
      } else if (topSpaced && topSpaced.isValid) {
        tbar = topSpaced.bar;
        tnx = Math.max(2, Math.floor((dM - 2 * cover) / topSpaced.spacing + 1e-7) + 1);
        tny = Math.max(2, Math.floor((wM - 2 * cover) / topSpaced.spacing + 1e-7) + 1);
      }
      if (tnx > 0 && tny > 0) {
        const tdia = Number(tbar.replace(/\D/g, '')) || 12;
        pushBarItem(tbar, tdia, count * tnx, lenX, 'ตะแกรงบนฐานรากแนวแกน X', undefined, netLenX, 2 * hook, 0);
        pushBarItem(tbar, tdia, count * tny, lenY, 'ตะแกรงบนฐานรากแนวแกน Y', undefined, netLenY, 2 * hook, 0);
        rebarFormulaStr += ` + ตะแกรงบน ${tnx}+${tny}-${tbar}`;
      }
    }
  } else if (member.memberType === 'SLAB') {
    if (wiremeshM2 > 0) {
      rebarFormulaStr = `ตะแกรงเหล็กไวร์เมช Ø4mm@0.15m = ${wiremeshM2} m²`;
    } else {
      const topVal = validateSpacedBar(member.topRebar);
      const botVal = validateSpacedBar(member.bottomRebar);

      if ((member.topRebar && topVal && !topVal.isValid) || (member.bottomRebar && botVal && !botVal.isValid)) {
        const err = (botVal && !botVal.isValid ? botVal.error : topVal?.error) || 'Invalid slab rebar spacing';
        flags.push({ code: 'REBAR_SPACING_INVALID', severity: 'block', field: 'slabRebar', message: err });
        return { bars: {}, rebarFormulaStr: 'CALCULATION_BLOCKED: ' + err, assumedRatio: false, minBasis: [], flags };
      }

      const layerSpecs: { layerName: string; spec: { bar: string; spacing: number } }[] = [];
      if (botVal && botVal.isValid) layerSpecs.push({ layerName: 'ล่าง', spec: { bar: botVal.bar, spacing: botVal.spacing } });
      if (topVal && topVal.isValid) layerSpecs.push({ layerName: 'บน', spec: { bar: topVal.bar, spacing: topVal.spacing } });
      const tempVal = validateSpacedBar(member.tempRebar);
      if (tempVal && tempVal.isValid) layerSpecs.push({ layerName: 'กันร้าว/กระจาย', spec: { bar: tempVal.bar, spacing: tempVal.spacing } });

      if (layerSpecs.length > 0 && wM > 0 && dM > 0) {
        const formulaParts: string[] = [];
        const stockLen = Number(rules.stockBarLengthM) || 6.0;

        for (const { layerName, spec } of layerSpecs) {
          const dia = Number(spec.bar.replace(/\D/g, '')) || 9;
          const diaM = dia / 1000;
          // Standard anchorage / hook into support beam (12 * dia or minimum 0.10m)
          const hook = Math.max(0.10, Math.min(0.25, 12 * diaM));

          // Direction X: bars span across width wM, distributed across depth dM
          const nx = Math.max(2, Math.floor((dM - 2 * cover) / spec.spacing + 1e-7) + 1);
          const netLenX = Number((wM - 2 * cover).toFixed(3));
          const baseCutX = Number(Math.max(0.3, netLenX + 2 * hook).toFixed(3));
          let cutLenX = baseCutX;
          let lapsX = 0;
          let lapLenX = 0;
          if (cutLenX > stockLen) {
            lapsX = Math.floor(cutLenX / stockLen);
            lapLenX = Number((lapsX * 40 * diaM).toFixed(3));
            cutLenX = Number((cutLenX + lapLenX).toFixed(3));
            flags.push({ code: 'STOCK_LAP_APPLIED', severity: 'info', field: 'slabRebar', message: `เหล็กพื้นยาว ${baseCutX}m เกินความยาวเหล็กตลาด (${stockLen}m) — คิดระยะทาบเพิ่ม ${lapsX} จุด (${lapLenX.toFixed(3)}m)` });
          }
          pushBarItem(spec.bar, dia, count * nx, cutLenX, `เหล็กพื้น ค.ส.ล. (${layerName}) แนวแกน X`, undefined, netLenX, 2 * hook, lapLenX);

          // Direction Y: bars span across depth dM, distributed across width wM
          const ny = Math.max(2, Math.floor((wM - 2 * cover) / spec.spacing + 1e-7) + 1);
          const netLenY = Number((dM - 2 * cover).toFixed(3));
          const baseCutY = Number(Math.max(0.3, netLenY + 2 * hook).toFixed(3));
          let cutLenY = baseCutY;
          let lapsY = 0;
          let lapLenY = 0;
          if (cutLenY > stockLen) {
            lapsY = Math.floor(cutLenY / stockLen);
            lapLenY = Number((lapsY * 40 * diaM).toFixed(3));
            cutLenY = Number((cutLenY + lapLenY).toFixed(3));
            flags.push({ code: 'STOCK_LAP_APPLIED', severity: 'info', field: 'slabRebar', message: `เหล็กพื้นยาว ${baseCutY}m เกินความยาวเหล็กตลาด (${stockLen}m) — คิดระยะทาบเพิ่ม ${lapsY} จุด (${lapLenY.toFixed(3)}m)` });
          }
          pushBarItem(spec.bar, dia, count * ny, cutLenY, `เหล็กพื้น ค.ส.ล. (${layerName}) แนวแกน Y`, undefined, netLenY, 2 * hook, lapLenY);

          formulaParts.push(`${layerName} ${spec.bar}@${spec.spacing}m (X: ${nx}เส้น×${cutLenX}m, Y: ${ny}เส้น×${cutLenY}m)`);
        }
        rebarFormulaStr = formulaParts.join(' + ');
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
          netLengthM: 3.0,
          hookLengthM: 0,
          lapLengthM: 0,
        });
        assumedRatio = true;
        rebarFormulaStr = `เหล็กเสริมพื้น ค.ส.ล. (ค่าเฉลี่ย 95 kg/m³)`;
      }
    }
  } else if (member.memberType === 'STAIR') {
    const main = parseSpacedBar(member.bottomRebar);
    const top = parseSpacedBar(member.topRebar);
    const dist = parseSpacedBar(member.distRebar);
    if (main) {
      const diaM = Number(main.bar.replace(/\D/g, '')) || 12;
      const nPieces = count * Math.ceil(wM / main.spacing + 1);
      const cutLen = lNetM + 0.6;
      pushBarItem(main.bar, diaM, nPieces, cutLen, 'เหล็กบันได ค.ส.ล. ตามแนวลาด', undefined, lNetM, 0.6, 0);

      if (top) {
        const diaTop = Number(top.bar.replace(/\D/g, '')) || 12;
        const nTop = count * Math.ceil(wM / top.spacing + 1);
        pushBarItem(top.bar, diaTop, nTop, cutLen, 'เหล็กบันได ค.ส.ล. เหล็กบนตามแนวลาด', undefined, lNetM, 0.6, 0);
        flags.push({
          code: 'STAIR_TOP_FULL_LENGTH',
          severity: 'warn',
          field: 'topRebar',
          message: 'เหล็กบนบันไดคิดเต็มความยาวลาด — แบบอาจให้เฉพาะช่วงปลาย ตรวจกับแบบ',
        });
      }

      if (dist) {
        const diaD = Number(dist.bar.replace(/\D/g, '')) || 9;
        const layers = top ? 2 : 1;
        const nDist = count * layers * Math.ceil(lNetM / dist.spacing + 1);
        pushBarItem(dist.bar, diaD, nDist, wM, 'เหล็กบันได ค.ส.ล. เหล็กกระจาย', undefined, wM, 0, 0);
      } else {
        flags.push({
          code: 'STAIR_DIST_MISSING',
          severity: 'warn',
          field: 'distRebar',
          message: 'ไม่พบเหล็กกระจายบันได — ยังไม่คิด กรอกในช่องเหล็กกระจาย',
        });
      }

      const groups: string[] = [`ล่าง ${main.bar}@${main.spacing} ตามลาด`];
      if (top) groups.push(`บน ${top.bar}@${top.spacing} ตามลาด`);
      if (dist) groups.push(`กระจาย ${dist.bar}@${dist.spacing}`);
      rebarFormulaStr = `บันได: ${groups.join(' + ')}`;
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
        netLengthM: 3.0,
        hookLengthM: 0,
        lapLengthM: 0,
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
      pushBarItem(g.bar, diaMm, count * g.n, len, purpose, mainGrade, isCol ? lGrossM : lNetM, isCol ? 0 : 2 * 12 * db, isCol ? 40 * db : 0);
    }

    // Extra reinforcement & side/skin bars (Beams) — using transparent DPT/วสท. cut ratios
    const extraNotes: string[] = [];
    if (!isCol && member.extraTopRebar) {
      const exTop = parseBarGroups(member.extraTopRebar);
      const ratio = rules.extraTopCutRatio ?? 0.30;
      for (const g of exTop) {
        const db = barDiaM(g.bar);
        const diaMm = Number(g.bar.replace(/\D/g, '')) || 12;
        const netEndLen = lNetM * ratio;
        const hookLen = 12 * db;
        const cutLen = netEndLen + hookLen;
        pushBarItem(g.bar, diaMm, count * g.n * 2, cutLen, `เหล็กเสริมพิเศษบนหัวเสา (มาตรฐาน ${ratio}L×2 ข้าง + งอฉาก 12d)`, mainGrade, netEndLen, hookLen, 0);
        extraNotes.push(`เสริมพิเศษบน ${g.n}-${g.bar} (${ratio}L×2)`);
      }
      if (exTop.length) {
        flags.push({ code: 'STANDARD_CUT_RATIO_USED', severity: 'info', field: 'extraTopRebar', message: `เหล็กเสริมพิเศษบนหัวเสาใช้ระยะตัดมาตรฐาน วสท. (${ratio}L ต่อข้าง — ปรับได้ในสเปกวัสดุ)` });
      }
    }
    if (!isCol && member.extraBottomRebar) {
      const exBot = parseBarGroups(member.extraBottomRebar);
      const ratio = rules.extraBottomCutRatio ?? 0.70;
      for (const g of exBot) {
        const diaMm = Number(g.bar.replace(/\D/g, '')) || 12;
        const cutLen = lNetM * ratio;
        pushBarItem(g.bar, diaMm, count * g.n, cutLen, `เหล็กเสริมพิเศษล่างกลางช่วง (มาตรฐาน ${ratio}L)`, mainGrade, cutLen, 0, 0);
        extraNotes.push(`เสริมพิเศษล่าง ${g.n}-${g.bar} (${ratio}L)`);
      }
      if (exBot.length) {
        flags.push({ code: 'STANDARD_CUT_RATIO_USED', severity: 'info', field: 'extraBottomRebar', message: `เหล็กเสริมพิเศษล่างกลางช่วงใช้ระยะตัดมาตรฐาน วสท. (${ratio}L — ปรับได้ในสเปกวัสดุ)` });
      }
    }
    if (!isCol && member.sideRebar) {
      const side = parseBarGroups(member.sideRebar);
      for (const g of side) {
        const db = barDiaM(g.bar);
        const diaMm = Number(g.bar.replace(/\D/g, '')) || 12;
        const len = lGrossM + 2 * 12 * db;
        pushBarItem(g.bar, diaMm, count * g.n, len, 'เหล็กข้างคาน / เหล็กกันร้าว (รวมงอฉาก 12d)', mainGrade, lNetM, 2 * 12 * db, 0);
        extraNotes.push(`เหล็กข้าง ${g.n}-${g.bar}`);
      }
    }

    let st: { bar: string; spacing: number; midSpacing?: number; legs?: number } | null = null;
    if (member.stirrupRebar) {
      const valSt = validateSpacedBar(member.stirrupRebar);
      if (valSt && !valSt.isValid) {
        flags.push({ code: 'REBAR_SPACING_INVALID', severity: 'block', field: 'stirrupRebar', message: valSt.error! });
        return { bars: {}, rebarFormulaStr: 'CALCULATION_BLOCKED: ' + valSt.error, assumedRatio: false, minBasis: [], flags };
      }
      if (valSt && valSt.isValid) {
        st = { bar: valSt.bar, spacing: valSt.spacing, midSpacing: valSt.midSpacing, legs: valSt.legs };
      } else {
        flags.push({ code: 'REBAR_SPEC_UNPARSED', severity: 'block', field: 'stirrupRebar', message: `ไม่สามารถอ่านสเปคเหล็กปลอก '${member.stirrupRebar}' ได้` });
        return { bars: {}, rebarFormulaStr: 'CALCULATION_BLOCKED: Unparsed stirrup spec', assumedRatio: false, minBasis: [], flags };
      }
    } else {
      const t = maximumTieSpacing(isCol, wM, dM, cover, Math.max(...main.map(g => barDiaM(g.bar))));
      st = { bar: 'RB6', spacing: t.spacing };
      minBasis.push(t.basis);
    }
    const perim = Number((2 * (Math.max(0.05, wM - 2 * cover) + Math.max(0.05, dM - 2 * cover)) + 0.10).toFixed(3));
    const sets = Math.max(1, Math.round(member.stirrupSets || st.legs || 1));
    let nSt: number;
    let stirrupDesc: string;
    if (st.midSpacing) {
      const endRatio = rules.stirrupEndZoneRatio ?? 0.25;
      const endLen = lNetM * endRatio;
      const midLen = Math.max(0, lNetM - 2 * endLen);
      const nEnd = 2 * Math.max(1, Math.floor(endLen / st.spacing + 1e-7) + 1);
      const nMid = midLen > 1e-6 ? Math.max(1, Math.floor(midLen / st.midSpacing + 1e-7)) : 0;
      nSt = nEnd + nMid;
      stirrupDesc = `${nSt}×${sets > 1 ? `${sets}-` : ''}${st.bar}@${st.spacing}/${st.midSpacing}m (ปลาย ${endRatio}L×2: ${nEnd} ปลอก, กลาง: ${nMid} ปลอก, รอบละ ${perim}m)`;
      flags.push({ code: 'STANDARD_CUT_RATIO_USED', severity: 'info', field: 'stirrupRebar', message: `เหล็กปลอก 2 โซนใช้ระยะช่วงปลายมาตรฐาน วสท. (${endRatio}L ต่อข้าง — ปรับได้ในสเปกวัสดุ)` });
    } else {
      nSt = Math.max(2, Math.floor(lNetM / st.spacing + 1e-7) + 1);
      stirrupDesc = `${nSt}×${sets > 1 ? `${sets}-` : ''}${st.bar}@${st.spacing}m (รอบละ ${perim}m)`;
    }
    const diaSt = Number(st.bar.replace(/\D/g, '')) || 6;
    pushBarItem(st.bar, diaSt, count * sets * nSt, perim, isCol ? 'เหล็กปลอกเสา (Ties)' : 'เหล็กปลอกคาน (Stirrups)', stirrupGrade, Math.max(0.1, perim - 0.10), 0.10, 0);
    rebarFormulaStr = `Main: ${main.map(g => `${g.n}-${g.bar}`).join(' + ')}${extraNotes.length ? ` | ${extraNotes.join(', ')}` : ''} | ${isCol ? 'Ties' : 'Stirrup'}: ${stirrupDesc}`;
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

  const netWt = barList.reduce((acc, b) => acc + (b.count * (b.netLengthM ?? b.lengthM) * b.unitWeightKgM), 0);
  const hookWt = barList.reduce((acc, b) => acc + (b.count * (b.hookLengthM ?? 0) * b.unitWeightKgM), 0);
  const lapWt = barList.reduce((acc, b) => acc + (b.count * (b.lapLengthM ?? 0) * b.unitWeightKgM), 0);
  const wastagePct = rules.rebarWastagePct || 0;
  const wastageWt = totWt * (wastagePct / 100.0);

  const rebarDetails: RebarSummaryDetails = {
    totalWeightKg: totWt,
    bindingWireKg: bindingWire,
    mainBarsKg: Number(mainWt.toFixed(2)),
    stirrupsKg: Number(stirrupWt.toFixed(2)),
    footingMeshKg: Number((member.memberType === 'FOOTING' ? totWt : 0).toFixed(2)),
    slabRebarKg: Number((member.memberType === 'SLAB' ? totWt : 0).toFixed(2)),
    byGrade,
    barList,
    sets: setResults,
    netWeightKg: Number(netWt.toFixed(2)),
    hookWeightKg: Number(hookWt.toFixed(2)),
    lapWeightKg: Number(lapWt.toFixed(2)),
    wastageWeightKg: Number(wastageWt.toFixed(2)),
  };

  return { bars, rebarFormulaStr, assumedRatio, minBasis, rebarDetails, flags };
}

const barAreaMm2 = (bar: string) => (Math.PI / 4) * Number(bar.replace(/\D/g, '')) ** 2;
const DEFORMED = ['DB12', 'DB16', 'DB20', 'DB25'];

/** Code minimum main bars for a section: column As ≥ 1% Ag; beam bottom As ≥ 14/fy·b·d with 2 top bars. */
export function minimumMainBars(isCol: boolean, wM: number, dM: number, cover: number, fyKsc: number): { groups: BarGroup[]; basis: string } {
  const As = isCol ? 0.01 * wM * dM * 1e6 : (14 / fyKsc) * wM * Math.max(0.05, dM - cover - 0.012) * 1e6;
  const fit = isCol
    ? Math.max(4, Math.floor((2 * (Math.max(0.05, wM - 2 * cover) + Math.max(0.05, dM - 2 * cover))) / 0.15 + 1e-7))
    : Math.max(2, Math.floor((wM - 2 * cover - 0.012) / 0.04 + 1e-7) + 1);
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

/** Required inputs with no drawing, grid or reviewer source behind them (a beam's support counts once it has a source). */
export function unconfirmedRequiredFields(m: ExtractedMember): string[] {
  const fs = m.provenance?.fieldSources || {};
  const required = CRITICAL_FIELDS[m.memberType].map(f => f.field);
  if (fs.support) required.push('support');
  return required.filter(f => fs[f] !== 'drawing' && fs[f] !== 'grid' && fs[f] !== 'reviewer');
}

/** Flags tied to one field: approving the whole member cannot settle them, only typing or confirming that field can. */
const FIELD_LEVEL_FLAGS = ['FIELD_VALUE_UNSOURCED', 'FIELD_ASSUMED', 'FIELD_INFERRED', 'REBAR_DEFAULTED', 'REBAR_CODE_MINIMUM', 'REBAR_RATIO_ASSUMED',
  'REBAR_SET_SOURCE', 'REBAR_SET_ARRANGEMENT_UNSPECIFIED', 'REBAR_SET_HOOK_UNSPECIFIED',
  'SPEC_DEFAULT_UNSOURCED', 'EXCAVATION_DEPTH_DEFAULT', 'ENGINE_IDENTITY_UNVERIFIED', 'FIELD_CONFLICT'];
const OPEN_FIELD_LABEL: Record<string, string> = {
  spec: 'สเปกโครงการที่ไม่มีที่มา', engine: 'ตัวตนของตัวคำนวณ', excavationDepthM: 'ลึกขุดดิน', rebar: 'เหล็กเสริม',
  topRebar: 'เหล็กบน/ยืน', bottomRebar: 'เหล็กล่าง', stirrupRebar: 'เหล็กปลอก', cover: 'ระยะหุ้ม', count: 'จำนวน',
};

/** member key and field-source key of each conflict field */
export const CONFLICT_FIELD: Record<ConflictField, { key: keyof ExtractedMember; fs: string; label: string; risk: 'high' | 'medium' }> = {
  width: { key: 'width', fs: 'width', label: 'กว้าง', risk: 'high' },
  depth: { key: 'depth', fs: 'depth', label: 'ลึก/ยาว', risk: 'high' },
  length: { key: 'length', fs: 'length', label: 'ยาว/สูง/หนา', risk: 'high' },
  count: { key: 'count', fs: 'count', label: 'จำนวน', risk: 'high' },
  topRebar: { key: 'topRebar', fs: 'rebar', label: 'เหล็กบน/ยืน', risk: 'high' },
  bottomRebar: { key: 'bottomRebar', fs: 'rebar', label: 'เหล็กล่าง', risk: 'high' },
  stirrupRebar: { key: 'stirrupRebar', fs: 'rebar', label: 'เหล็กปลอก', risk: 'medium' },
  cover: { key: 'coveringCm', fs: 'cover', label: 'ระยะหุ้ม (ซม.)', risk: 'high' },
};
/** a reason is required for every typed value and deferral, and for picking a source on a high-risk field */
export const resolutionNeedsReason = (field: ConflictField, choice: ConflictResolution['choice']) => choice !== 'source' || CONFLICT_FIELD[field].risk === 'high';
export const conflictKey = (c: FieldConflict) =>
  sha256Hex(stableStringify({ f: c.field, s: c.sources.map(x => [x.value, x.page, x.ref]) })).slice(0, 16);
const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a) - Number(b)) < 1e-9 : String(a ?? '').replace(/\s/g, '').toUpperCase() === String(b ?? '').replace(/\s/g, '').toUpperCase();

export interface ConflictStatus {
  conflict: FieldConflict;
  key: string;
  /** open: nobody ruled; deferred: sent back; invalid: ruling lacks reviewer/reason; mismatch: value changed after the ruling */
  state: 'open' | 'deferred' | 'invalid' | 'mismatch' | 'resolved';
  resolution?: ConflictResolution;
}

/** Conflicts on this member: those the reader recorded, plus the project notes' cover against a cover read from this member's own detail. */
export function memberConflicts(m: ExtractedMember, specs: MaterialSpecs = DEFAULT_MATERIAL_SPECS): FieldConflict[] {
  const out = [...(m.provenance?.fieldConflicts || [])];
  const key = m.memberType === 'SLAB' || m.memberType === 'STAIR' ? 'slab' : m.memberType === 'BEAM' ? 'beam' : m.memberType === 'COLUMN' ? 'column' : m.memberType === 'FOOTING' ? 'footing' : undefined;
  const notesCm = key && specs.coverSources?.[key] === 'drawing_notes' ? specs[`${key}CoveringCm` as 'footingCoveringCm'] : undefined;
  const detailCm = m.coveringCm;
  const resolvedCover = m.conflictResolutions?.some(r => r.field === 'cover');
  if (notesCm != null && detailCm != null && (m.provenance?.fieldSources.cover === 'drawing' || resolvedCover) && !out.some(c => c.field === 'cover')) {
    // the detail's own value stays the source even after the reviewer edits it, so the ruling keeps its key
    const detail = m.conflictResolutions?.find(r => r.field === 'cover')?.before ?? detailCm;
    if (!sameValue(detail, notesCm)) {
      const page = m.provenance?.evidence.find(e => e.memberType === m.memberType || /แบบขยาย/.test(e.label))?.page ?? m.provenance?.evidence[0]?.page ?? null;
      out.push({ field: 'cover', kind: 'CONFLICT', sources: [
        { value: Number(detail), page, ref: 'แบบขยายของชิ้นนี้' },
        { value: Number(notesCm), page: null, ref: 'หมายเหตุทั่วไป (รายการประกอบแบบ)' },
      ] });
    }
  }
  return out;
}

export function conflictStatuses(m: ExtractedMember, specs: MaterialSpecs = DEFAULT_MATERIAL_SPECS): ConflictStatus[] {
  return memberConflicts(m, specs).map(conflict => {
    const key = conflictKey(conflict);
    const resolution = [...(m.conflictResolutions || [])].reverse().find(r => r.key === key);
    const state: ConflictStatus['state'] = !resolution ? 'open'
      : resolution.choice === 'deferred' ? 'deferred'
      : !resolution.by?.trim() || (resolutionNeedsReason(conflict.field, resolution.choice) && !resolution.reason?.trim()) ? 'invalid'
      : !sameValue((m as any)[CONFLICT_FIELD[conflict.field].key], resolution.value) ? 'mismatch'
      : 'resolved';
    return { conflict, key, state, resolution };
  });
}
export const conflictText = (c: FieldConflict) =>
  c.sources.map(x => `${x.value ?? '—'} (${x.page ? 'หน้า ' + x.page : 'ไม่มีเลขหน้า'} · ${x.ref})`).join(' vs ');

export interface SpecValueSource { source: 'drawing_notes' | 'user' | 'assumption'; note?: string; by?: string; at?: string }
/** Class B spec values: they change quantities, so the code default may not stand in for them unless someone gave or documented it. */
export const REQUIRED_SPECS: { key: keyof MaterialSpecs; label: string; unit: string; affects: string }[] = [
  { key: 'leanThicknessM', label: 'ความหนาคอนกรีตหยาบใต้ฐานราก', unit: 'ม.', affects: 'คอนกรีตหยาบ, ถมกลับ' },
  { key: 'sandThicknessM', label: 'ความหนาทรายรองใต้ฐานราก', unit: 'ม.', affects: 'ทรายรองพื้น, ถมกลับ' },
  { key: 'excavationMarginM', label: 'ระยะเผื่อขุดรอบฐานราก', unit: 'ม.', affects: 'ดินขุด, ถมกลับ' },
  { key: 'excavationBulkingFactor', label: 'ตัวคูณดินพอง', unit: '×', affects: 'ดินขุด, ถมกลับ' },
  { key: 'footingHookShape', label: 'รูปงอเหล็กฐานรากค่าเริ่มต้น', unit: '', affects: 'เหล็กฐานราก' },
  { key: 'stockBarLengthM', label: 'ความยาวเหล็กตลาด', unit: 'ม.', affects: 'เหล็กพื้น (ระยะทาบ)' },
  { key: 'slabSandThicknessM', label: 'ความหนาทรายใต้พื้นบนดิน', unit: 'ม.', affects: 'ทรายใต้พื้น' },
  { key: 'groundBeamSoffitFormwork', label: 'ไม้แบบท้องคานคอดิน', unit: '', affects: 'ไม้แบบคานคอดิน' },
];
export const specValueText = (key: keyof MaterialSpecs, v: unknown) => {
  const def = REQUIRED_SPECS.find(r => r.key === key);
  return v === undefined || v === null ? 'ไม่มีค่า' : typeof v === 'boolean' ? (v ? 'คิด' : 'ไม่คิด') : `${v}${def?.unit ? ' ' + def.unit : ''}`;
};
/** the class B spec values this member's calculation actually used */
function specsUsed(m: ExtractedMember, flags: ReviewFlag[], sandM3: number): (keyof MaterialSpecs)[] {
  if (m.memberType === 'FOOTING') {
    return ['leanThicknessM', 'excavationMarginM', 'excavationBulkingFactor',
      ...(m.sandThicknessM == null ? ['sandThicknessM' as const] : []),
      ...(flags.some(f => f.code === 'FOOTING_HOOK_ASSUMED') ? ['footingHookShape' as const] : [])];
  }
  if (m.memberType === 'SLAB') {
    return [...(flags.some(f => f.code === 'STOCK_LAP_APPLIED') ? ['stockBarLengthM' as const] : []),
      ...(sandM3 > 0 && m.sandThicknessM == null ? ['slabSandThicknessM' as const] : [])];
  }
  return m.memberType === 'BEAM' && /^GB/i.test(m.tag) ? ['groundBeamSoffitFormwork'] : [];
}

/** Class B: fields a whole-member approval does not cover (given the member's flags) until the reviewer types or confirms each one. */
export function fieldsApprovalCannotCover(m: ExtractedMember, flags: ReviewFlag[]): { field: string; label: string }[] {
  const open = flags.filter(f => FIELD_LEVEL_FLAGS.includes(f.code)).map(f => f.field!);
  // a conflict names no single field, so it is settled once the reviewer has stated every required value
  if (flags.some(f => f.code === 'CONFLICT')) open.push(...CRITICAL_FIELDS[m.memberType].map(f => f.field).filter(f => m.provenance?.fieldSources[f] !== 'reviewer'));
  return [...new Set(open)].map(field => ({ field, label: CRITICAL_FIELDS[m.memberType].find(f => f.field === field)?.label ?? OPEN_FIELD_LABEL[field] ?? (field.startsWith('rebarSet:') ? 'ชุดเหล็ก ' + field.slice(9) : field) }));
}

/** Classifies the predominant provenance level of a member */
export function classifyProvenanceLevel(member: ExtractedMember, flags: ReviewFlag[] = []): ProvenanceLevel {
  if (member.review?.status === 'approved') return 'USER_CONFIRMED';
  if (!member.provenance) return 'UNKNOWN';

  const sources = Object.values(member.provenance.fieldSources || {});
  if (flags.some(f => f.code === 'REBAR_CODE_MINIMUM' || f.code === 'REBAR_RATIO_ASSUMED' || f.code === 'FOOTING_HOOK_ASSUMED' || f.code === 'BEAM_SUPPORT_ASSUMED')) {
    return 'ENGINEERING_ASSUMPTION';
  }
  if (sources.includes('assumed') || sources.includes('inferred')) return 'ENGINEERING_ASSUMPTION';
  if (sources.includes('missing')) return 'DEFAULT_VALUE';

  const methods = member.provenance.evidence?.map(e => e.method) || [];
  if (methods.includes('vision') || methods.includes('pdf_text')) return 'OCR_EXTRACTED';
  if (methods.includes('dxf')) return 'DRAWING_VERIFIED';
  // a reviewer edit only labels a member that has no drawing evidence; it never outranks what the drawing says
  if (sources.includes('reviewer')) return 'USER_CONFIRMED';
  return 'UNKNOWN';
}

/** Evidence that points at the drawing itself (an empty record or a 'manual' entry does not). */
const hasDrawingEvidence = (p: Provenance) => (p.evidence || []).some(e => e.method === 'vision' || e.method === 'pdf_text' || e.method === 'dxf');

/** Flags coming from provenance: missing/assumed fields, conflicts, low confidence. */
function provenanceFlags(member: ExtractedMember): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const p = member.provenance;

  if (!p) {
    // Missing provenance record: nothing shows where the values came from, so a QS must confirm before release.
    if (member.review?.status !== 'approved') {
      flags.push({
        code: 'PROVENANCE_UNSPECIFIED',
        severity: 'warn',
        message: 'ไม่พบหลักฐานที่มา (Direct / Synthetic input without provenance)',
      });
    }
    return flags;
  }

  const approved = member.review?.status === 'approved';
  if (!approved && !hasDrawingEvidence(p)) {
    flags.push({ code: 'PROVENANCE_UNSPECIFIED', severity: 'warn', message: 'ไม่มีหลักฐานจากแบบ (source record ว่างหรือกรอกเอง) — ต้องให้ QS อนุมัติ' });
  }
  if (!approved && Object.values(p.fieldSources || {}).includes('reviewer')) {
    flags.push({ code: 'REVIEWER_EDIT_UNAPPROVED', severity: 'warn', message: 'มีค่าที่ผู้ตรวจแก้ไขแต่ยังไม่ได้อนุมัติ' });
  }

  for (const { field, label } of CRITICAL_FIELDS[member.memberType]) {
    const src = p.fieldSources[field];
    if (src === 'missing') {
      const val = (member as any)[field];
      if (val === undefined || val === null || val <= 0) {
        flags.push({ code: 'FIELD_MISSING', severity: 'block', field, message: `${label}: ไม่พบในแบบ — ต้องกรอก` });
      } else {
        // a reviewer's value is marked 'reviewer', so a value under 'missing' came from no one we know of
        flags.push({ code: 'FIELD_VALUE_UNSOURCED', severity: 'warn', field, message: `${label}: ไม่พบในแบบแต่มีค่า (${val}) — ยืนยันที่มา` });
      }
    } else if (src === 'assumed') {
      flags.push({ code: 'FIELD_ASSUMED', severity: 'warn', field, message: `${label}: ใช้ค่าสมมติ — ยืนยันกับแบบ` });
    } else if (src === 'inferred') {
      flags.push({ code: 'FIELD_INFERRED', severity: 'warn', field, message: `${label}: อนุมานจากข้อมูลอื่น — ยืนยันกับแบบ` });
    }
  }
  for (const [field, src] of Object.entries(p.fieldSources)) {
    if (['width', 'depth', 'length'].includes(field)) continue;
    if (field === 'support' && (src === 'assumed' || src === 'inferred' || src === 'missing')) {
      flags.push({ code: 'BEAM_SUPPORT_ASSUMED', severity: 'warn', field: 'support', message: 'ขนาดเสารองรับใช้ค่าสมมติ/อนุมาน — ต้องตรวจสอบความกว้างเสาจริง' });
    }
    if (field === 'rebar' && src === 'missing' && !member.rebarSets) flags.push({ code: 'REBAR_DEFAULTED', severity: 'warn', field, message: 'ไม่พบรายละเอียดเหล็กเสริม — ใช้ค่ามาตรฐาน' });
    if (field === 'excavation' && src === 'assumed') flags.push({ code: 'EXCAVATION_ASSUMED', severity: 'info', field, message: `ความลึกขุดดินเป็นค่าสมมติ (${member.excavationDepthM || 1.50} ม.)` });
  }
  for (const c of p.conflicts || []) flags.push({ code: 'CONFLICT', severity: 'warn', message: c });
  if (p.confidence < 0.7) flags.push({ code: 'LOW_CONFIDENCE', severity: 'warn', message: `ความมั่นใจในการอ่านแบบต่ำ (${Math.round(p.confidence * 100)}%)` });
  return flags;
}

function confidenceFrom(member: ExtractedMember, flags: ReviewFlag[]): number {
  let c = (member.provenance ? member.provenance.confidence : 0.95) * 100;
  for (const f of flags) c -= f.severity === 'block' ? 40 : f.severity === 'warn' ? 12 : 3;
  return Math.max(0, Math.min(100, Math.round(c)));
}

/**
 * Quantity Surveying Calculator with deduction and validation rules.
 */
/** spec values the calculation of each member type falls back from when absent */
const SPEC_FALLBACKS: Record<string, (keyof MaterialSpecs)[]> = {
  FOOTING: ['excavationMarginM', 'excavationBulkingFactor', 'leanThicknessM', 'sandThicknessM', 'footingHookShape', 'excavationRate', 'backfillRate'],
  SLAB: ['stockBarLengthM', 'slabSandThicknessM'],
};

export function calculateMember(
  member: ExtractedMember,
  idx: number = 1,
  specs: MaterialSpecs = DEFAULT_MATERIAL_SPECS,
  drawing: DrawingRef | null = null
): CalculatedQuantity {
  const review = member.review;
  // an approval stands only while every input it was calculated from is unchanged (approvals with no snapshot predate Round 20)
  let staleChanges: string[] = [];
  if (review?.status === 'approved') {
    const now = calcSnapshot(member, specs, drawing);
    if (!review.snapshot || !review.fingerprint) staleChanges = ['อนุมัติก่อนมีการบันทึก snapshot การคำนวณ'];
    else if (fingerprintOf(review.snapshot) !== review.fingerprint) staleChanges = ['snapshot ที่บันทึกไม่ตรงกับ fingerprint'];
    else if (fingerprintOf(now) !== review.fingerprint) {
      const diff = snapshotDiff(review.snapshot, now);
      staleChanges = diff.length ? diff : ['fingerprint เปลี่ยน'];
    }
  }
  const calc = calculateMemberFrom(staleChanges.length ? { ...member, review: undefined } : member, idx, specs, staleChanges);
  calc.approvalState = staleChanges.length ? 'STALE'
    : review?.status === 'rejected' ? 'REJECTED'
    : calc.review?.status === 'approved' && calc.status === 'AUTO_RELEASE' ? 'APPROVED'
    : calc.status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : undefined;
  if (staleChanges.length) { calc.staleApproval = review; calc.staleChanges = staleChanges; }
  return calc;
}

function calculateMemberFrom(member: ExtractedMember, idx: number, specs: MaterialSpecs, staleChanges: string[]): CalculatedQuantity {
  const rules = { ...DEFAULT_MATERIAL_SPECS, ...specs };
  const coverRes = memberCover(member, rules);
  const itemId = `QS-${member.memberType.charAt(0)}-${String(idx).padStart(3, '0')}`;
  const rejections: string[] = [];
  const reviews: string[] = [];
  const deductions: DeductionDetail[] = [];
  const flags: ReviewFlag[] = provenanceFlags(member);
  if (staleChanges.length) {
    flags.push({ code: 'APPROVAL_STALE', severity: 'warn', message: `ค่าที่ใช้คำนวณเปลี่ยนหลังอนุมัติ — ต้องอนุมัติใหม่: ${staleChanges.slice(0, 4).join('; ')}${staleChanges.length > 4 ? ` (+${staleChanges.length - 4})` : ''}` });
  }
  const missingSpecs = (SPEC_FALLBACKS[member.memberType] || []).filter(k => (rules as any)[k] === undefined || (rules as any)[k] === null)
    .filter(k => !(k === 'sandThicknessM' && member.sandThicknessM != null) && !(k === 'footingHookShape' && (member.footingHookShape || member.rebarSets)));
  if (missingSpecs.length) {
    flags.push({ code: 'SPEC_VALUE_MISSING', severity: 'warn', message: `สเปกโครงการไม่มีค่า ${missingSpecs.join(', ')} — คิดชั่วคราวด้วยค่ามาตรฐาน ต้องตรวจ` });
  }
  if (!engineIdVerified(engineIdentity.id)) {
    flags.push({ code: 'ENGINE_IDENTITY_UNVERIFIED', severity: 'warn', field: 'engine', message: 'ตรวจตัวตนของตัวคำนวณไม่ได้ (engineIdentity.gen.ts ไม่ได้สร้างจาก source) — อนุมัติจะไม่ปล่อยยอด' });
  }

  // sources that disagree hold the field until a reviewer rules on it, with a reason where the risk asks for one
  const conflicts = conflictStatuses(member, rules);
  const why: Record<ConflictStatus['state'], string> = {
    open: 'ยังไม่ตัดสิน', deferred: 'ส่งกลับตรวจเพิ่ม', invalid: 'การตัดสินไม่มีชื่อผู้ตรวจหรือเหตุผล', mismatch: 'ค่าในช่องเปลี่ยนหลังตัดสิน', resolved: '',
  };
  for (const c of conflicts) {
    const label = CONFLICT_FIELD[c.conflict.field].label;
    if (c.state !== 'resolved') {
      flags.push({ code: 'FIELD_CONFLICT', severity: 'warn', field: c.conflict.field, message: `${c.conflict.kind === 'UNDECIDABLE' ? 'เทียบค่าไม่ได้' : 'ค่าขัดแย้ง'} ${label}: ${conflictText(c.conflict)} — ${why[c.state]}` });
    } else {
      const r = c.resolution!;
      flags.push({ code: 'CONFLICT_RESOLVED', severity: 'info', field: c.conflict.field, message: `${label} ตัดสินเป็น ${r.value} (${r.choice === 'source' ? `ตามหน้า ${r.sourcePage ?? '—'}` : 'กรอกเอง'}) โดย ${r.by}${r.reason ? ' — ' + r.reason : ''}` });
    }
  }

  if (member.review?.status === 'rejected') {
    return createRejectedRecord(itemId, member, [`ผู้ตรวจไม่อนุมัติ${member.review.note ? ': ' + member.review.note : ''}`]);
  }

  if (member.width === null || member.width === undefined || !Number.isFinite(Number(member.width)) ||
      member.depth === null || member.depth === undefined || !Number.isFinite(Number(member.depth)) ||
      member.length === null || member.length === undefined || !Number.isFinite(Number(member.length))) {
    rejections.push('Missing or non-finite critical dimension (width, depth, or span is null/NaN/Infinity)');
    return createRejectedRecord(itemId, member, rejections);
  }

  if (member.provenance && flags.some(f => f.code === 'FIELD_MISSING') &&
      (member.width <= 0 || member.depth <= 0 || member.length <= 0)) {
    return createIncompleteRecord(itemId, member, flags);
  }

  if (Number(member.width) <= 0) rejections.push(`Width must be positive finite number (> 0), got: ${member.width}`);
  if (Number(member.depth) <= 0) rejections.push(`Depth/Y-dimension must be positive finite number (> 0), got: ${member.depth}`);
  if (Number(member.length) <= 0) rejections.push(`Length/Span must be positive finite number (> 0), got: ${member.length}`);
  const memberCount = member.count ?? 1;
  if (!Number.isInteger(Number(memberCount)) || Number(memberCount) <= 0) rejections.push(`Count must be positive finite integer (> 0), got: ${member.count}`);

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
  let vGross = Number((count * wM * dM * lGrossM).toFixed(4));
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
    formulaStr = `${count} × ${wM.toFixed(3)}m(w) × ${dM.toFixed(3)}m(d) × ${lNetM.toFixed(3)}m(L_net) = ${vNet.toFixed(4)} m³ [Gross: ${lGrossM.toFixed(3)}m - Ded: ${totalDeductionM.toFixed(3)}m] [ไม้แบบ: ${count} × (2×${dM.toFixed(3)} + ${soffit.toFixed(3)}) × ${lNetM.toFixed(3)} = ${formworkNetM2} m²]`;
  } else if (member.memberType === 'COLUMN') {
    formworkNetM2 = Number((count * 2 * (wM + dM) * lNetM).toFixed(4));
    formulaStr = `${count} × ${wM.toFixed(3)}m(c_x) × ${dM.toFixed(3)}m(c_y) × ${lNetM.toFixed(3)}m(H) = ${vNet.toFixed(4)} m³ [ไม้แบบ: ${count} × 2×(${wM.toFixed(3)}+${dM.toFixed(3)}) × ${lNetM.toFixed(3)} = ${formworkNetM2} m²]`;
  } else if (member.memberType === 'FOOTING') {
    const margin = rules.excavationMarginM ?? 0.10;
    const leanT = rules.leanThicknessM ?? 0.05;
    const sandT = member.sandThicknessM ?? rules.sandThicknessM ?? 0.05;
    formworkNetM2 = Number((count * 2 * (wM + dM) * lNetM).toFixed(4));
    leanConcreteM3 = Number((count * (wM + 0.20) * (dM + 0.20) * leanT).toFixed(4));
    sandBeddingM3 = Number((count * (wM + 0.20) * (dM + 0.20) * sandT).toFixed(4));
    const excDepth = member.excavationDepthM || 1.50;
    if (!(Number(member.excavationDepthM) > 0)) {
      flags.push({ code: 'EXCAVATION_DEPTH_DEFAULT', severity: 'warn', field: 'excavationDepthM', message: 'แบบไม่ให้ความลึกขุดดิน — คิดชั่วคราว 1.50 ม. กรอกความลึกจริงในช่อง "ลึกขุดดิน"' });
    }
    excavationM3 = Number((count * (wM + 2 * margin) * (dM + 2 * margin) * excDepth * (rules.excavationBulkingFactor ?? 1.0)).toFixed(4));
    backfillM3 = Number(Math.max(0, excavationM3 - vNet - leanConcreteM3 - sandBeddingM3).toFixed(4));
    pilesNos = count * (member.pileCount || 0);
    formulaStr = `${count} × ${wM.toFixed(2)}m(w) × ${dM.toFixed(2)}m(L) × ${lNetM.toFixed(2)}m(D) = ${vNet.toFixed(4)} m³ [Lean: ${leanConcreteM3.toFixed(3)}m³, Sand: ${sandBeddingM3.toFixed(3)}m³, ดินขุด: ${excavationM3.toFixed(3)}m³, ไม้แบบ: ${count} × 2×(${wM.toFixed(2)}+${dM.toFixed(2)}) × ${lNetM.toFixed(2)} = ${formworkNetM2} m²]`;
  } else if (member.memberType === 'SLAB') {
    const isGroundSlab = (member.tag && member.tag.toUpperCase().includes('GS')) || member.slabType === 'SLAB_ON_GROUND';
    const isPrecast = member.slabType === 'PRECAST_PLANK' || (member.notes && member.notes.includes('สำเร็จรูป'));

    if (isPrecast) {
      precastSlabM2 = Number((count * wM * dM).toFixed(2));
      wiremeshM2 = precastSlabM2;
      formworkNetM2 = 0;
      formulaStr = `แผ่นพื้นสำเร็จรูป ${precastSlabM2.toFixed(2)} ตร.ม. + คอนกรีตทับหน้า Topping ${lNetM.toFixed(2)}m = ${vNet.toFixed(4)} m³ [ไม้แบบ: 0 m²]`;
    } else if (isGroundSlab) {
      formworkNetM2 = Number((count * 2 * (wM + dM) * lNetM).toFixed(4));
      sandBeddingM3 = Number((count * wM * dM * (member.sandThicknessM ?? rules.slabSandThicknessM ?? 0.05)).toFixed(4));
      formulaStr = `${count} × ${wM.toFixed(2)}m × ${dM.toFixed(2)}m × ${lNetM.toFixed(2)}m(หนา) = ${vNet.toFixed(4)} m³ [Slab-on-Ground, ไม้แบบขอบ: ${count} × 2×(${wM.toFixed(2)}+${dM.toFixed(2)}) × ${lNetM.toFixed(2)} = ${formworkNetM2} m², ทรายรองพื้น ${sandBeddingM3.toFixed(3)}m³]`;
    } else {
      formworkNetM2 = Number((count * (wM * dM + 2 * (wM + dM) * lNetM)).toFixed(4));
      formulaStr = `${count} × ${wM.toFixed(2)}m(w) × ${dM.toFixed(2)}m(L) × ${lNetM.toFixed(2)}m(หนา) = ${vNet.toFixed(4)} m³ [ไม้แบบท้องพื้น+ขอบ: ${count} × (${wM.toFixed(2)}×${dM.toFixed(2)} + 2×(${wM.toFixed(2)}+${dM.toFixed(2)})×${lNetM.toFixed(2)}) = ${formworkNetM2} m²]`;
    }
  } else if (member.memberType === 'STAIR') {
    const hasSteps = (member.stairRiseM ?? 0) > 0 && (member.stairRunM ?? 0) > 0 && (member.stairRisers ?? 0) > 0;
    const soffit = wM * lNetM;
    const sides = 2 * dM * lNetM;
    if (hasSteps) {
      const vSteps = count * wM * 0.5 * member.stairRunM! * member.stairRiseM! / member.stairRisers!;
      vNet = Number((count * wM * dM * lNetM + vSteps).toFixed(4));
      vGross = Number((count * wM * dM * lGrossM + vSteps).toFixed(4));
      const risers = wM * member.stairRiseM!;
      const stepSides = 2 * 0.5 * member.stairRunM! * member.stairRiseM! / member.stairRisers!;
      formworkNetM2 = Number((count * (soffit + sides + risers + stepSides)).toFixed(4));
      formulaStr = `${count} × ${wM.toFixed(2)}m(w) × ${dM.toFixed(3)}m(หนา) × ${lNetM.toFixed(2)}m(ลาด) + ขั้น ${count} × ${wM.toFixed(2)}m × ½×${member.stairRunM!.toFixed(2)}m×${member.stairRiseM!.toFixed(2)}m/${member.stairRisers} = ${vNet.toFixed(4)} m³ [ไม้แบบ: ท้อง ${count} × ${wM.toFixed(2)}×${lNetM.toFixed(2)} + ข้าง ${count} × 2×${dM.toFixed(3)}×${lNetM.toFixed(2)} + ตั้ง ${count} × ${wM.toFixed(2)}×${member.stairRiseM!.toFixed(2)} + ข้างขั้น ${count} × 2×½×${member.stairRunM!.toFixed(2)}×${member.stairRiseM!.toFixed(2)}/${member.stairRisers} = ${formworkNetM2} m²]`;
    } else {
      flags.push({ code: 'STAIR_STEPS_MISSING', severity: 'warn', message: 'ขั้นบันไดยังไม่คิด (ต้องมีความสูง ระยะราบ และจำนวนขั้น)' });
      formworkNetM2 = Number((count * (soffit + sides)).toFixed(4));
      formulaStr = `${count} × ${wM.toFixed(2)}m(w) × ${dM.toFixed(3)}m(หนา) × ${lNetM.toFixed(2)}m(ลาด) = ${vNet.toFixed(4)} m³ [ไม้แบบ: ${count} × (${wM.toFixed(2)}×${lNetM.toFixed(2)} + 2×${dM.toFixed(3)}×${lNetM.toFixed(2)}) = ${formworkNetM2} m²]`;
    }
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

  const cover = coverRes.coverM;
  if (coverRes.warning) {
    // the quantities use a substitute cover, so nothing may release (or be approved) on them
    flags.push({ code: 'COVER_INVALID', severity: 'block', field: 'cover', message: coverRes.warning });
  } else if (coverRes.assumed) {
    // a footing's whole mat hangs on its cover, so a default nobody gave is held for review
    flags.push({ code: 'COVER_ASSUMED', severity: member.memberType === 'FOOTING' ? 'warn' : 'info', field: 'cover', message: `ไม่มีระยะหุ้มจากแบบหรือสเปก — ใช้ค่ามาตรฐานวิศวกรรม ${(cover * 100).toFixed(1)} ซม.` });
  }
  const isArch = ['WALL', 'DOOR', 'WINDOW', 'FINISH'].includes(member.memberType);
  // a footing's mat sits inside its thickness too (bottom cover + top of the upturn)
  const thickM = member.memberType === 'FOOTING' ? lNetM : Infinity;
  const coverExceedsDim = !isArch && (cover * 2 >= wM || cover * 2 >= dM || cover * 2 >= thickM);
  if (coverExceedsDim) {
    const minDim = Math.min(wM, dM, thickM);
    flags.push({
      code: 'COVER_EXCEEDS_DIMENSION',
      severity: 'block',
      field: 'cover',
      message: `ระยะหุ้มคอนกรีต 2 ด้าน (${(cover * 2 * 100).toFixed(1)} ซม.) มากกว่าหรือเท่ากับขนาดหน้าตัดองค์อาคาร (${(minDim * 100).toFixed(1)} ซม.) — ไม่สามารถใส่เหล็กเสริมได้`,
    });
  }

  const rebarCalc = (isArch || coverExceedsDim)
    ? { bars: {}, rebarFormulaStr: coverExceedsDim ? 'CALCULATION_BLOCKED: Cover exceeds section dimensions' : '', assumedRatio: false, minBasis: [], rebarDetails: undefined, flags: [] }
    : computeDetailedRebar(member, count, wM, dM, lNetM, lGrossM, cover, rules, wiremeshM2, vNet);

  if (rebarCalc.flags) {
    for (const f of rebarCalc.flags) flags.push(f);
  }

  const bars = rebarCalc.bars;
  let rebarFormulaStr = rebarCalc.rebarFormulaStr;
  const assumedRatio = rebarCalc.assumedRatio;
  const rebarDetails = rebarCalc.rebarDetails;
  if (rebarCalc.minBasis.length) {
    flags.push({ code: 'REBAR_CODE_MINIMUM', severity: 'warn', field: 'rebar', message: `ไม่พบเหล็กในแบบ — คิดเหล็กต่ำสุดตามมาตรฐานจากหน้าตัด (${rebarCalc.minBasis.join('; ')}) ของจริงอาจมากกว่า` });
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
    flags.push({ code: 'REBAR_RATIO_ASSUMED', severity: 'warn', field: 'rebar', message: 'คำนวณเหล็กจากอัตราเฉลี่ย (แบบไม่ระบุระยะเรียง)' });
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

  let pileLenM = member.pileLengthM || 0;
  if (!pileLenM && member.pileSize) {
    const mLen = member.pileSize.match(/(?:x|×)\s*(\d+(?:\.\d+)?)\s*(?:m|ม|เมตร)?$/i);
    if (mLen) pileLenM = parseFloat(mLen[1]);
  }
  if (!pileLenM && member.notes) {
    const mLen = member.notes.match(/(?:ยาว|length|L)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:m|ม|เมตร)?/i);
    if (mLen) pileLenM = parseFloat(mLen[1]);
  }
  if (!pileLenM && pilesNos > 0) {
    pileLenM = 6.0;
  }

  let pileMatCost = 0;
  let pileLaborCost = 0;
  if (pilesNos > 0) {
    const hasPerNos = (rules.pileSupplyRatePerNos != null && rules.pileSupplyRatePerNos > 0) ||
                      (rules.pileDrivingRatePerNos != null && rules.pileDrivingRatePerNos > 0);
    if (hasPerNos) {
      pileMatCost = pilesNos * (rules.pileSupplyRatePerNos || 0);
      pileLaborCost = pilesNos * (rules.pileDrivingRatePerNos || 0);
    } else {
      const totLen = pilesNos * pileLenM;
      pileMatCost = totLen * (rules.pileSupplyRatePerM ?? 220.0);
      pileLaborCost = totLen * (rules.pileDrivingRatePerM ?? 85.0);
    }
    if (pileMatCost === 0 && pileLaborCost === 0) {
      flags.push({
        code: 'PILE_PRICE_ZERO',
        severity: 'info',
        field: 'pile',
        message: `พบเสาเข็ม ${pilesNos} ต้น แต่ไม่ได้กำหนดราคาต่อหน่วย — ไม่ได้รวมในมูลค่างาน`,
      });
    } else {
      formulaStr += ` [เสาเข็ม: ${pilesNos} ต้น × ${pileLenM.toFixed(2)}m = ฿${Math.round(pileMatCost + pileLaborCost).toLocaleString('th-TH')}]`;
    }
  }

  const pileCostThb = {
    material: Number(pileMatCost.toFixed(2)),
    wage: Number(pileLaborCost.toFixed(2)),
    total: Number((pileMatCost + pileLaborCost).toFixed(2)),
  };

  const materialCostThb = Number((concreteMatCost + formworkMatCost + rebarMatCost + leanMatCost + sandMatCost + precastMatCost + wiremeshMatCost + wallMatCost + doorMatCost + winMatCost + finMatCost + pileMatCost).toFixed(2));
  const wageCostThb = Number((concreteLaborCost + formworkLaborCost + rebarLaborCost + leanLaborCost + sandLaborCost + earthworkLaborCost + precastLaborCost + wiremeshLaborCost + wallLaborCost + doorLaborCost + winLaborCost + finLaborCost + pileLaborCost).toFixed(2));
  const totalCostThb = Number((materialCostThb + wageCostThb).toFixed(2));
  const earthworkCostThb = member.memberType === 'FOOTING'
    ? { material: Number((leanMatCost + sandMatCost).toFixed(2)), wage: Number((leanLaborCost + sandLaborCost + earthworkLaborCost).toFixed(2)) }
    : { material: 0, wage: 0 };

  for (const r of reviews) flags.push({ code: 'ENGINEERING', severity: 'warn', message: r });
  // a quantity-relevant spec value nobody gave holds the member; a documented assumption is shown, not hidden
  const used = specsUsed(member, flags, sandBeddingM3);
  const vs = rules.valueSources || {};
  const unsourced = used.filter(k => !vs[k]);
  const label = (k: keyof MaterialSpecs) => REQUIRED_SPECS.find(r => r.key === k)!;
  if (unsourced.length) {
    flags.push({ code: 'SPEC_DEFAULT_UNSOURCED', severity: 'warn', field: 'spec', message: `สเปกไม่มีที่มา — คิดชั่วคราวด้วยค่าเริ่มต้น: ${unsourced.map(k => `${label(k).label} ${specValueText(k, rules[k])} (กระทบ ${label(k).affects})`).join('; ')} — กรอกในสเปกหรือบันทึกเป็นสมมติฐาน` });
  }
  const assumed = used.filter(k => vs[k]?.source === 'assumption');
  if (assumed.length) {
    flags.push({ code: 'SPEC_ASSUMPTION', severity: 'info', field: 'spec', message: `ใช้สมมติฐานสเปก: ${assumed.map(k => `${label(k).label} ${specValueText(k, rules[k])} — ${vs[k]!.note || 'ไม่มีเหตุผล'}${vs[k]!.by ? ` (${vs[k]!.by})` : ''}`).join('; ')}` });
  }
  const openFields = member.review?.status === 'approved' ? fieldsApprovalCannotCover(member, flags) : [];
  if (openFields.length) {
    member = { ...member, review: undefined };
    flags.push({ code: 'APPROVAL_FIELDS_OPEN', severity: 'warn', message: `อนุมัติทั้งชิ้นไม่ครอบ ${[...new Set(openFields.map(f => f.label))].join(', ')} — ยืนยันหรือแก้ค่าในช่องนั้นก่อน` });
  }
  const confidencePct = confidenceFrom(member, flags);
  const provenanceLevel = classifyProvenanceLevel(member, flags);

  // Release Gate Safety Rules:
  // 1. Any BLOCK flag forces REJECTED or calculation blocked
  // 2. Any WARN flag (unverified engineering assumption, low confidence, conflict, assumed span/rebar) forces NEEDS_REVIEW
  // 3. Confidence < 80% forces NEEDS_REVIEW
  // 4. Critical inputs must not silently AUTO_RELEASE on reviewer approval if a BLOCK flag is active
  const hasBlock = flags.some(f => f.severity === 'block');
  const hasWarn = flags.some(f => f.severity === 'warn');
  const needsHuman = hasWarn || confidencePct < AUTO_RELEASE_CONFIDENCE_PCT;
  const approved = member.review?.status === 'approved';

  let status: ValidationStatus = 'AUTO_RELEASE';
  if (hasBlock) {
    status = 'NEEDS_REVIEW'; // Blocked items cannot auto-release
  } else if (approved) {
    status = 'AUTO_RELEASE';
  } else if (needsHuman) {
    status = 'NEEDS_REVIEW';
  } else {
    status = 'AUTO_RELEASE';
  }

  const confidenceBasis = hasBlock
    ? 'Calculation blocked by invalid input or geometry rules; requires QS correction'
    : approved
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
    pileCostThb,
    pileLengthM: pilesNos > 0 ? pileLenM : undefined,
    coverM: isArch ? undefined : cover,
    coverSource: isArch ? undefined : coverRes.source,
    leanConcreteM3,
    sandBeddingM3,
    excavationM3,
    backfillM3,
    pilesNos,
    precastSlabM2,
    wiremeshM2,
    coords: member.coords,
    provenance: member.provenance,
    provenanceLevel,
    flags,
    confidencePct,
    review: member.review,
    specKeysUsed: used,
    conflicts,
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
    pileCostThb: { material: 0, wage: 0, total: 0 },
    pileLengthM: undefined,
    coverM: undefined,
    coverSource: undefined,
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
  calc.pileCostThb = { material: 0, wage: 0, total: 0 };
  calc.pileLengthM = undefined;
  calc.coverM = undefined;
  calc.coverSource = undefined;
  calc.leanConcreteM3 = 0;
  calc.sandBeddingM3 = 0;
  calc.excavationM3 = 0;
  calc.backfillM3 = 0;
  calc.pilesNos = 0;
  calc.precastSlabM2 = 0;
  calc.wiremeshM2 = 0;
}

const occLocation = (m: ExtractedMember) =>
  m.gridLocation && m.gridLocation !== '-' && !/^Sheet-P\d+$/.test(m.gridLocation) ? `${(m.level || 'Story 1').trim()} / ${m.gridLocation.trim()}` : null;
const occSpec = (m: ExtractedMember) => stableStringify([m.width, m.depth, m.length, m.count ?? 1,
  ...[m.topRebar, m.bottomRebar, m.stirrupRebar].map(v => String(v || '').replace(/\s/g, '').toUpperCase()), m.rebarSets ?? null]);
const specText = (m: ExtractedMember) => `${m.width}×${m.depth}×${m.length} ม. ×${m.count ?? 1}${m.bottomRebar ? ' ' + m.bottomRebar : ''}${m.topRebar ? ' / ' + m.topRebar : ''}`;
export const occurrenceOf = (m: ExtractedMember, index: number): Occurrence => ({
  index, tag: m.tag.trim().toUpperCase(), memberType: m.memberType, page: m.provenance?.evidence?.[0]?.page ?? null,
  location: occLocation(m), text: String(m.rawDimensionStr || ''), spec: specText(m),
});
export const duplicateGroupKey = (members: ExtractedMember[], idx: number[]) =>
  sha256Hex(stableStringify(idx.map(i => { const o = occurrenceOf(members[i], i); return [o.memberType, o.tag, o.page, o.location, o.text, occSpec(members[i])]; }).sort())).slice(0, 16);
/** a ruling needs a name and a reason; linking needs one specification and no two distinct positions */
export function duplicateDecisionProblem(members: ExtractedMember[], g: Pick<DuplicateGroup, 'members'>, d: DuplicateDecision): string | undefined {
  if (!d.by?.trim()) return 'ไม่มีชื่อผู้ตรวจ';
  if (!d.reason?.trim()) return 'ไม่มีเหตุผล';
  if (d.decision === 'SAME_INSTANCE') {
    if (new Set(g.members.map(i => occSpec(members[i]))).size > 1) return 'ค่าของแต่ละแหล่งต่างกัน — ตัดสินค่าขัดแย้งก่อนจึงรวมเป็นชิ้นเดียวได้';
    const locs = g.members.map(i => occLocation(members[i])).filter(Boolean);
    if (new Set(locs).size > 1) return 'อยู่คนละตำแหน่งในผัง — รวมเป็นชิ้นเดียวไม่ได้';
  }
  return undefined;
}

/**
 * Occurrences of one member reference (type + tag) that could be the same physical instance, classified with the
 * evidence for it. Different tags with the same specification are reported (SAME_SPECIFICATION) but never grouped.
 */
export function detectDuplicateGroups(members: ExtractedMember[]): DuplicateGroup[] {
  const byRef = new Map<string, number[]>();
  members.forEach((m, i) => { const k = `${m.memberType}::${m.tag.trim().toUpperCase()}`; byRef.set(k, [...(byRef.get(k) || []), i]); });
  const groups: DuplicateGroup[] = [];
  for (const idx of byRef.values()) {
    if (idx.length < 2) continue;
    const occ = idx.map(i => occurrenceOf(members[i], i));
    const locs = occ.map(o => o.location);
    const known = locs.filter((l): l is string => !!l);
    const specs = new Set(idx.map(i => occSpec(members[i])));
    const pages = [...new Set(occ.map(o => o.page).filter(p => p != null))];
    const ev = [`เบอร์เดียวกัน ${occ[0].tag} (${occ[0].memberType}) ${idx.length} แหล่ง: ${occ.map(o => `หน้า ${o.page ?? '?'}${o.location ? ' @' + o.location : ''}`).join(', ')}`];
    let cls: DuplicateClass;
    if (known.length === idx.length) {
      // every occurrence placed: the existing same-position rule handles one place; different places are different pieces
      cls = new Set(known).size === known.length ? 'DISTINCT_PHYSICAL_INSTANCES' : 'SAME_PHYSICAL_INSTANCE';
      ev.push(cls === 'DISTINCT_PHYSICAL_INSTANCES' ? `ตำแหน่งในผังต่างกันทุกแหล่ง (${known.join(' · ')})` : 'ชั้นและกริดเดียวกัน — นับครั้งเดียวตามกฎตำแหน่งซ้ำเดิม');
    } else if (specs.size > 1) {
      cls = 'CONFLICTING_SPECIFICATION';
      ev.push(`ค่าไม่ตรงกัน: ${[...new Set(occ.map(o => o.spec))].join(' vs ')}`);
    } else if (known.length === 0) {
      cls = 'POSSIBLE_DUPLICATE';
      const sameRow = occ.some((o, a) => occ.some((q, b) => b > a && o.page === q.page && o.text && o.text === q.text));
      ev.push(sameRow ? 'หน้าเดียวกัน ข้อความเดียวกัน — อาจอ่านแถวเดิมซ้ำ (OCR/ข้อความซ้อน)' : `ค่าเหมือนกันทุก field คนละหน้า (${pages.join(', ')}) และไม่มีตำแหน่งในผัง — อาจเป็นตารางพิมพ์ซ้ำ หรือเป็นคนละชิ้นจริง`);
    } else {
      cls = 'INSUFFICIENT_EVIDENCE';
      ev.push(`มีทั้งแหล่งที่มีตำแหน่งในผัง (${known.length}) และแหล่งที่ไม่มีตำแหน่ง (${idx.length - known.length}) — บอกไม่ได้ว่าแถวตาราง/แบบขยายนับซ้ำกับชิ้นในผังหรือไม่`);
    }
    const blocking = cls !== 'DISTINCT_PHYSICAL_INSTANCES' && cls !== 'SAME_PHYSICAL_INSTANCE';
    const key = duplicateGroupKey(members, idx);
    const decision = blocking ? idx.map(i => [...(members[i].duplicateReviews || [])].reverse().find(d => d.key === key)).find(Boolean) : undefined;
    const problem = decision && duplicateDecisionProblem(members, { members: idx }, decision);
    const state: DuplicateGroup['state'] = !blocking ? 'info' : !decision || decision.decision === 'DEFERRED' || decision.decision === 'UNDECIDED' ? 'open' : problem ? 'invalid' : 'decided';
    groups.push({ key, classification: cls, members: idx, occurrences: occ, evidence: ev, blocking, decision, state, problem });
  }
  // different references, same specification, no positions: shown, never joined
  const bySpec = new Map<string, number[]>();
  members.forEach((m, i) => { if (!occLocation(m)) { const k = `${m.memberType}::${occSpec(m)}`; bySpec.set(k, [...(bySpec.get(k) || []), i]); } });
  for (const idx of bySpec.values()) {
    const tags = new Set(idx.map(i => members[i].tag.trim().toUpperCase()));
    if (tags.size < 2) continue;
    groups.push({ key: duplicateGroupKey(members, idx), classification: 'SAME_SPECIFICATION', members: idx, occurrences: idx.map(i => occurrenceOf(members[i], i)),
      evidence: [`ต่างเบอร์ (${[...tags].join(', ')}) แต่ค่าเหมือนกัน — ไม่ใช่หลักฐานว่าเป็นชิ้นเดียวกัน`], blocking: false, state: 'info' });
  }
  return groups;
}

const instanceIdOf = (m: ExtractedMember, i: number) => { const o = occurrenceOf(m, i); return o.location ? `${o.tag}@${o.location}` : `${o.tag}@p${o.page ?? '?'}#${i + 1}`; };

/**
 * Computes all members, checks duplicates, aggregates project summary by categories & Factor F.
 */
export function computeProject(
  members: ExtractedMember[],
  projectName: string = 'Project-01',
  specs: MaterialSpecs = DEFAULT_MATERIAL_SPECS,
  factorFParams: FactorFParams = DEFAULT_FACTOR_F_PARAMS,
  drawing: DrawingRef | null = null
): BOQProjectResult {
  const calculatedItems: CalculatedQuantity[] = [];
  const seenKeys = new Map<string, number>();
  const slabCells = new Map<string, number[]>();

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const calc = calculateMember(member, i + 1, specs, drawing);
    calc.memberIndex = i;

    if (member.gridLocation && member.gridLocation !== '-' && !/^Sheet-P\d+$/.test(member.gridLocation)) {
      const dupKey = `${(member.level || 'Story 1').trim().toLowerCase()}::${member.gridLocation.trim().toLowerCase()}::${member.tag.trim().toUpperCase()}`;
      if (seenKeys.has(dupKey) && calc.review?.status !== 'approved') {
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
      if (it.status === 'REJECTED' || it.review?.status === 'approved') continue;
      const msg = `พื้นซ้อนกันในช่องเดียวกัน (${tags}) — เลือกชนิดพื้นที่ถูกต้อง`;
      it.flags = [...(it.flags || []), { code: 'SLAB_OVERLAP', severity: 'warn', message: msg }];
      it.reviewWarnings = [...it.reviewWarnings, msg];
      it.status = 'NEEDS_REVIEW';
      it.approvalState = 'NEEDS_REVIEW';
    }
  }

  // duplicate review: an undecided group holds every occurrence in it; a linked occurrence is counted once (in the first)
  for (const g of detectDuplicateGroups(members)) {
    const linked = g.state === 'decided' && g.decision!.decision === 'SAME_INSTANCE';
    const primary = calculatedItems[g.members[0]];
    for (const i of g.members) {
      const it = calculatedItems[i];
      if (g.classification === 'SAME_SPECIFICATION') continue;
      const counted = !(linked && i !== g.members[0]);
      it.duplicate = { group: g, instanceId: linked ? instanceIdOf(members[g.members[0]], g.members[0]) : instanceIdOf(members[i], i), counted, linkedTo: counted ? undefined : primary.itemId };
      if (!g.blocking || it.status === 'REJECTED') continue;
      if (g.state === 'decided') {
        const d = g.decision!;
        const msg = d.decision === 'SAME_INSTANCE'
          ? (counted ? `ผู้ตรวจยืนยันว่าเป็นชิ้นเดียวกับ ${g.members.slice(1).map(j => calculatedItems[j].itemId).join(', ')} — นับที่รายการนี้ครั้งเดียว` : `แหล่งซ้ำของชิ้นเดียวกับ ${primary.itemId} (ผู้ตรวจยืนยัน) — ไม่นับซ้ำ`)
          : 'ผู้ตรวจยืนยันว่าเป็นคนละชิ้น — นับทุกรายการ';
        it.flags = [...(it.flags || []), { code: 'DUPLICATE_RESOLVED', severity: 'info', field: 'instance', message: `${msg} (${d.by}: ${d.reason})` }];
        if (!counted) {
          it.status = 'REJECTED';
          it.rejectionReasons.push(msg);
          zeroOut(it);
        }
        continue;
      }
      const why = g.state === 'invalid' ? `การตัดสินใช้ไม่ได้: ${g.problem}` : g.decision ? (g.decision.decision === 'DEFERRED' ? 'ส่งกลับตรวจสอบ' : 'ผู้ตรวจยังตัดสินไม่ได้') : 'ยังไม่ตัดสิน';
      const msg = `อาจนับซ้ำ (${g.classification}): ${g.evidence.join(' · ')} — ${why}`;
      it.flags = [...(it.flags || []), { code: 'DUPLICATE_RISK', severity: 'warn', field: 'instance', message: msg }];
      it.reviewWarnings = [...it.reviewWarnings, msg];
      it.status = 'NEEDS_REVIEW';
      it.approvalState = it.review?.status === 'rejected' ? 'REJECTED' : 'NEEDS_REVIEW';
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
