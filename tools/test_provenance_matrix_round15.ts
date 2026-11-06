import { calculateMember, classifyProvenanceLevel, ExtractedMember, MemberType } from '../src/engine/qsEngine';

const memberTypes: MemberType[] = ['FOOTING', 'COLUMN', 'BEAM', 'SLAB', 'STAIR', 'WALL'];

interface MatrixResult {
  memberType: MemberType;
  levelTested: string;
  assignedLevel: string;
  status: string;
  confidencePct: number;
  flags: string[];
}

const matrix: MatrixResult[] = [];

for (const mType of memberTypes) {
  const baseMember: ExtractedMember = {
    tag: `${mType}_01`,
    memberType: mType,
    width: mType === 'WALL' ? 0.10 : 0.20,
    depth: mType === 'FOOTING' ? 1.00 : mType === 'SLAB' ? 3.00 : 0.40,
    length: mType === 'FOOTING' ? 0.35 : mType === 'SLAB' ? 0.10 : 4.00,
    count: 1,
    unit: 'm',
    isClearSpan: mType === 'BEAM' ? true : undefined,
    topRebar: mType === 'BEAM' ? '2-DB16' : mType === 'COLUMN' ? '4-DB16' : undefined,
    bottomRebar: mType === 'BEAM' ? '2-DB16' : mType === 'FOOTING' ? 'DB12@0.15m' : mType === 'SLAB' ? 'RB9@0.20m' : undefined,
    stirrupRebar: mType === 'BEAM' || mType === 'COLUMN' ? 'RB6@0.15m' : undefined,
    footingHookShape: mType === 'FOOTING' ? 'FULL_UPTURN' : undefined,
  };

  // 1. UNKNOWN provenance (no provenance record)
  const mUnknown = { ...baseMember };
  const resUnknown = calculateMember(mUnknown, 1);
  matrix.push({
    memberType: mType,
    levelTested: 'UNKNOWN',
    assignedLevel: resUnknown.provenanceLevel || 'UNKNOWN',
    status: resUnknown.status,
    confidencePct: resUnknown.confidencePct || 0,
    flags: resUnknown.flags?.map(f => `${f.code}(${f.severity})`) || [],
  });

  // 2. OCR_EXTRACTED
  const mOcr = {
    ...baseMember,
    provenance: {
      evidence: [{ page: 1, method: 'vision' as const, label: 'OCR schedule' }],
      fieldSources: { width: 'drawing' as const, depth: 'drawing' as const, length: 'drawing' as const },
      confidence: 0.90,
    },
  };
  const resOcr = calculateMember(mOcr, 1);
  matrix.push({
    memberType: mType,
    levelTested: 'OCR_EXTRACTED',
    assignedLevel: resOcr.provenanceLevel || 'UNKNOWN',
    status: resOcr.status,
    confidencePct: resOcr.confidencePct || 0,
    flags: resOcr.flags?.map(f => `${f.code}(${f.severity})`) || [],
  });

  // 3. USER_CONFIRMED
  const mUser = {
    ...baseMember,
    provenance: {
      evidence: [{ page: 1, method: 'vision' as const, label: 'OCR schedule' }],
      fieldSources: { width: 'reviewer' as const, depth: 'reviewer' as const, length: 'reviewer' as const },
      confidence: 0.95,
    },
    review: { status: 'approved' as const, note: 'QS Verified', at: '2026-11-03' },
  };
  const resUser = calculateMember(mUser, 1);
  matrix.push({
    memberType: mType,
    levelTested: 'USER_CONFIRMED',
    assignedLevel: resUser.provenanceLevel || 'UNKNOWN',
    status: resUser.status,
    confidencePct: resUser.confidencePct || 0,
    flags: resUser.flags?.map(f => `${f.code}(${f.severity})`) || [],
  });

  // 4. ENGINEERING_ASSUMPTION (e.g. assumed length/span)
  const mAssumption = {
    ...baseMember,
    provenance: {
      evidence: [{ page: 1, method: 'vision' as const, label: 'Drawing' }],
      fieldSources: { width: 'drawing' as const, depth: 'drawing' as const, length: 'assumed' as const },
      confidence: 0.85,
    },
  };
  const resAssumption = calculateMember(mAssumption, 1);
  matrix.push({
    memberType: mType,
    levelTested: 'ENGINEERING_ASSUMPTION',
    assignedLevel: resAssumption.provenanceLevel || 'UNKNOWN',
    status: resAssumption.status,
    confidencePct: resAssumption.confidencePct || 0,
    flags: resAssumption.flags?.map(f => `${f.code}(${f.severity})`) || [],
  });

  // 5. DEFAULT_VALUE (e.g. missing rebar or missing dimensions)
  const mDefault = {
    ...baseMember,
    provenance: {
      evidence: [{ page: 1, method: 'vision' as const, label: 'Drawing' }],
      fieldSources: { width: 'drawing' as const, depth: 'drawing' as const, length: 'drawing' as const, rebar: 'missing' as const },
      confidence: 0.70,
    },
  };
  const resDefault = calculateMember(mDefault, 1);
  matrix.push({
    memberType: mType,
    levelTested: 'DEFAULT_VALUE',
    assignedLevel: resDefault.provenanceLevel || 'UNKNOWN',
    status: resDefault.status,
    confidencePct: resDefault.confidencePct || 0,
    flags: resDefault.flags?.map(f => `${f.code}(${f.severity})`) || [],
  });
}

console.log('=== TASK 1: PROVENANCE MATRIX AUDIT ACROSS ALL MEMBER TYPES ===\n');
console.table(matrix);
