import type { ExtractedMember, MemberType } from '../engine/qsEngine';

export type FieldGroup = 'dim' | 'rebar' | 'extra';
export type FieldScope = 'section' | 'instance' | 'both';
export type RebarKind = 'count' | 'stirrup' | 'mesh' | 'spaced';

export interface ReviewFieldDef {
  key: keyof ExtractedMember;
  label: string;
  unit?: string;
  source?: string;
  kind?: 'num' | 'text' | 'select' | 'rebar';
  rebarKind?: RebarKind;
  options?: { value: string; label: string }[];
  placeholder?: string;
  group: FieldGroup;
  scope: FieldScope;
}

export const SLAB_TYPE_OPTIONS = [
  { value: 'CAST_IN_PLACE', label: 'หล่อในที่ (Cast-in-Place)' },
  { value: 'SLAB_ON_GROUND', label: 'วางบนดิน (Slab on Ground)' },
  { value: 'PRECAST_PLANK', label: 'พื้นสำเร็จรูป (Precast Plank)' },
];

/**
 * Single source of truth for editable member fields across SectionTable (by tag)
 * and ReviewWorkspace (per member instance).
 */
export const REVIEW_FIELDS: Record<MemberType, ReviewFieldDef[]> = {
  BEAM: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'depth', label: 'ลึก', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'length', label: 'ช่วง c/c', unit: 'ม.', source: 'length', kind: 'num', group: 'dim', scope: 'instance' },
    { key: 'supportColW1', label: 'เสารองรับ 1', unit: 'ม.', source: 'support', kind: 'num', group: 'dim', scope: 'instance' },
    { key: 'supportColW2', label: 'เสารองรับ 2', unit: 'ม.', source: 'support', kind: 'num', group: 'dim', scope: 'instance' },
    { key: 'topRebar', label: 'เหล็กบน', source: 'rebar', kind: 'rebar', rebarKind: 'count', placeholder: '2-DB12', group: 'rebar', scope: 'both' },
    { key: 'bottomRebar', label: 'เหล็กล่าง', source: 'rebar', kind: 'rebar', rebarKind: 'count', placeholder: '2-DB12', group: 'rebar', scope: 'both' },
    { key: 'stirrupRebar', label: 'เหล็กปลอก (1 หรือ 2 โซน)', source: 'stirrup', kind: 'rebar', rebarKind: 'stirrup', placeholder: 'RB6@0.15 หรือ RB6@0.10/0.20', group: 'rebar', scope: 'both' },
    { key: 'extraTopRebar', label: 'เสริมพิเศษบน (หัวเสา)', source: 'extraRebar', kind: 'rebar', rebarKind: 'count', placeholder: '2-DB16', group: 'extra', scope: 'both' },
    { key: 'extraBottomRebar', label: 'เสริมพิเศษล่าง (กลางช่วง)', source: 'extraRebar', kind: 'rebar', rebarKind: 'count', placeholder: '2-DB16', group: 'extra', scope: 'both' },
    { key: 'sideRebar', label: 'เหล็กข้างคาน / กันร้าว', source: 'extraRebar', kind: 'rebar', rebarKind: 'count', placeholder: '2-DB12', group: 'extra', scope: 'both' },
  ],
  COLUMN: [
    { key: 'width', label: 'ด้าน X', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'depth', label: 'ด้าน Y', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'length', label: 'ความสูงเสา', unit: 'ม.', source: 'length', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'topRebar', label: 'เหล็กยืน', source: 'rebar', kind: 'rebar', rebarKind: 'count', placeholder: '4-DB12', group: 'rebar', scope: 'both' },
    { key: 'stirrupRebar', label: 'เหล็กปลอก', source: 'stirrup', kind: 'rebar', rebarKind: 'stirrup', placeholder: 'RB6@0.15 หรือ RB6@0.10/0.20', group: 'rebar', scope: 'both' },
  ],
  FOOTING: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'depth', label: 'ยาว', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'length', label: 'หนา', unit: 'ม.', source: 'length', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'excavationDepthM', label: 'ลึกขุดดิน', unit: 'ม.', source: 'excavation', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'count', label: 'จำนวน', unit: 'ฐาน', kind: 'num', group: 'dim', scope: 'instance' },
    { key: 'bottomRebar', label: 'ตะแกรงล่าง', source: 'rebar', kind: 'rebar', rebarKind: 'mesh', placeholder: '5+5-DB12 หรือ DB12@0.15', group: 'rebar', scope: 'both' },
    { key: 'topMatRebar', label: 'ตะแกรงบน (ถ้ามี)', source: 'extraRebar', kind: 'rebar', rebarKind: 'mesh', placeholder: '5+5-DB12', group: 'extra', scope: 'both' },
    { key: 'pileCount', label: 'จำนวนเสาเข็ม/ฐาน', unit: 'ต้น', source: 'pile', kind: 'num', group: 'extra', scope: 'both' },
    { key: 'pileSize', label: 'ขนาดเสาเข็ม', kind: 'text', source: 'pile', placeholder: '0.18x0.18x6.00', group: 'extra', scope: 'both' },
    { key: 'pedestalHeightM', label: 'ความสูงตอม่อ', unit: 'ม.', source: 'pedestal', kind: 'num', group: 'extra', scope: 'both' },
  ],
  SLAB: [
    { key: 'width', label: 'ด้าน X', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'instance' },
    { key: 'depth', label: 'ด้าน Y', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'instance' },
    { key: 'length', label: 'หนา', unit: 'ม.', source: 'length', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'slabType', label: 'ชนิดพื้น', kind: 'select', options: SLAB_TYPE_OPTIONS, group: 'dim', scope: 'both' },
    { key: 'bottomRebar', label: 'เหล็กล่าง', source: 'rebar', kind: 'rebar', rebarKind: 'spaced', placeholder: 'RB9@0.20', group: 'rebar', scope: 'both' },
    { key: 'topRebar', label: 'เหล็กบน', source: 'rebar', kind: 'rebar', rebarKind: 'spaced', placeholder: 'RB9@0.20', group: 'rebar', scope: 'both' },
    { key: 'tempRebar', label: 'เหล็กกันร้าว / กระจาย', source: 'extraRebar', kind: 'rebar', rebarKind: 'spaced', placeholder: 'RB6@0.25', group: 'extra', scope: 'both' },
  ],
  STAIR: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'depth', label: 'หนาท้อง', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'length', label: 'ยาวลาด', unit: 'ม.', source: 'length', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'bottomRebar', label: 'เหล็กล่างตามลาด', source: 'rebar', kind: 'rebar', rebarKind: 'spaced', placeholder: 'DB12@0.125', group: 'rebar', scope: 'both' },
    { key: 'topRebar', label: 'เหล็กบนตามลาด', source: 'rebar', kind: 'rebar', rebarKind: 'spaced', placeholder: 'DB12@0.25', group: 'rebar', scope: 'both' },
    { key: 'distRebar', label: 'เหล็กกระจาย', source: 'dist', kind: 'rebar', rebarKind: 'spaced', placeholder: 'RB9@0.20', group: 'rebar', scope: 'both' },
    { key: 'stairRiseM', label: 'สูงรวม', unit: 'ม.', source: 'steps', kind: 'num', group: 'extra', scope: 'both' },
    { key: 'stairRunM', label: 'ราบรวม', unit: 'ม.', source: 'steps', kind: 'num', group: 'extra', scope: 'both' },
    { key: 'stairRisers', label: 'จำนวนลูกตั้ง', unit: 'ขั้น', source: 'steps', kind: 'num', group: 'extra', scope: 'both' },
  ],
  WALL: [
    { key: 'width', label: 'ความหนาผนัง', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'depth', label: 'ความสูงผนัง', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'length', label: 'ความยาวผนัง', unit: 'ม.', source: 'length', kind: 'num', group: 'dim', scope: 'both' },
  ],
  DOOR: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'depth', label: 'สูง', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'length', label: 'จำนวนชุด', unit: 'ชุด', source: 'length', kind: 'num', group: 'dim', scope: 'both' },
  ],
  WINDOW: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'depth', label: 'สูง', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'length', label: 'จำนวนชุด', unit: 'ชุด', source: 'length', kind: 'num', group: 'dim', scope: 'both' },
  ],
  FINISH: [
    { key: 'width', label: 'กว้างห้อง', unit: 'ม.', source: 'width', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'depth', label: 'ยาวห้อง', unit: 'ม.', source: 'depth', kind: 'num', group: 'dim', scope: 'both' },
    { key: 'length', label: 'หนา/พื้นที่', unit: 'ม.', source: 'length', kind: 'num', group: 'dim', scope: 'both' },
  ],
};

export function fieldsForSection(type: MemberType): ReviewFieldDef[] {
  return (REVIEW_FIELDS[type] || []).filter(f => f.scope === 'section' || f.scope === 'both');
}

export function fieldsForInstance(type: MemberType): ReviewFieldDef[] {
  return (REVIEW_FIELDS[type] || []).filter(f => f.scope === 'instance' || f.scope === 'both');
}

export function createBlankMember(type: MemberType, tag: string, level = 'ชั้น 1'): ExtractedMember {
  const base: ExtractedMember = {
    tag: tag.trim().toUpperCase(),
    memberType: type,
    width: type === 'SLAB' ? 3.0 : type === 'FOOTING' ? 1.0 : type === 'STAIR' ? 1.0 : 0.2,
    depth: type === 'SLAB' ? 4.0 : type === 'FOOTING' ? 1.0 : type === 'STAIR' ? 0.15 : type === 'COLUMN' ? 0.2 : 0.4,
    length: type === 'SLAB' ? 0.1 : type === 'FOOTING' ? 0.3 : type === 'COLUMN' ? 3.0 : 4.0,
    count: 1,
    level,
    gridLocation: 'เพิ่มโดยผู้ตรวจ',
    provenance: {
      evidence: [{ page: 1, label: 'เพิ่มโดยผู้ตรวจ', method: 'manual', memberType: type }],
      fieldSources: { width: 'reviewer', depth: 'reviewer', length: 'reviewer' },
      confidence: 100,
    },
  };
  if (type === 'SLAB') base.slabType = 'CAST_IN_PLACE';
  return base;
}
