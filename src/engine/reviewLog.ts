/**
 * Review history: every reviewer action (value edits, approve / exclude, adding suggested members)
 * is recorded with the values before and after, so any number in the takeoff can be traced back
 * to who changed it and from what — and any edit or decision can be undone.
 */
import type { ConflictResolution, DuplicateDecision, ExtractedMember, RebarSet } from './qsEngine';

export const TRACKED_FIELDS: { key: keyof ExtractedMember; label: string }[] = [
  { key: 'width', label: 'กว้าง' },
  { key: 'depth', label: 'ลึก/ยาว' },
  { key: 'length', label: 'ยาว/สูง/หนา' },
  { key: 'supportColW1', label: 'เสารองรับ 1' },
  { key: 'supportColW2', label: 'เสารองรับ 2' },
  { key: 'excavationDepthM', label: 'ลึกขุดดิน' },
  { key: 'topRebar', label: 'เหล็กบน/ยืน' },
  { key: 'bottomRebar', label: 'เหล็กล่าง' },
  { key: 'stirrupRebar', label: 'เหล็กปลอก' },
  { key: 'slabType', label: 'ชนิดพื้น' },
  { key: 'rebarSets', label: 'ชุดเหล็ก' },
  { key: 'count', label: 'จำนวนชิ้น' },
  { key: 'coveringCm', label: 'ระยะหุ้ม (ซม.)' },
  { key: 'coverMode', label: 'ที่มาระยะหุ้ม' },
  { key: 'conflictResolutions', label: 'การตัดสินค่าขัดแย้ง' },
  { key: 'duplicateReviews', label: 'การตัดสินรายการซ้ำ' },
];

/** field names as a checker reads them for each member type */
const TYPE_LABEL: Record<string, Partial<Record<string, string>>> = {
  BEAM: { depth: 'ลึก', length: 'ช่วง c/c' },
  COLUMN: { width: 'ด้าน X', depth: 'ด้าน Y', length: 'ความสูง', topRebar: 'เหล็กยืน' },
  FOOTING: { depth: 'ยาว', length: 'หนา', bottomRebar: 'ตะแกรงล่าง' },
  SLAB: { width: 'ด้าน X', depth: 'ด้าน Y', length: 'หนา' },
  STAIR: { depth: 'หนาท้อง', length: 'ยาวลาด', bottomRebar: 'เหล็กล่างตามลาด', topRebar: 'เหล็กบนตามลาด', distRebar: 'เหล็กกระจาย', stairRiseM: 'สูงรวม', stairRunM: 'ราบรวม', stairRisers: 'จำนวนลูกตั้ง' },
  WALL: { width: 'หนาผนัง', depth: 'สูงผนัง', length: 'ยาวผนัง' },
  DOOR: { width: 'กว้าง', depth: 'สูง', length: 'จำนวนชุด' },
  WINDOW: { width: 'กว้าง', depth: 'สูง', length: 'จำนวนชุด' },
  FINISH: { width: 'กว้างห้อง', depth: 'ยาวห้อง', length: 'หนา/พื้นที่' },
};
/** inputs that matter for each member type */
export const TYPE_FIELDS: Record<string, string[]> = {
  BEAM: ['width', 'depth', 'length', 'supportColW1', 'supportColW2', 'topRebar', 'bottomRebar', 'stirrupRebar'],
  COLUMN: ['width', 'depth', 'length', 'topRebar', 'stirrupRebar'],
  FOOTING: ['width', 'depth', 'length', 'excavationDepthM', 'count', 'coverMode', 'coveringCm', 'bottomRebar'],
  SLAB: ['width', 'depth', 'length', 'topRebar', 'bottomRebar'],
  STAIR: ['width', 'depth', 'length', 'topRebar', 'bottomRebar'],
  WALL: ['width', 'depth', 'length'],
  DOOR: ['width', 'depth', 'length'],
  WINDOW: ['width', 'depth', 'length'],
  FINISH: ['width', 'depth', 'length'],
};
/** Identifies one reading of a drawing: a saved review is restored only onto the identical reading,
 *  so a new revision under the same file name never gets the old values or decisions. */
export const readingSignature = (members: ExtractedMember[]) => JSON.stringify(members);

export const fieldLabel = (memberType: string, key: string) =>
  TYPE_LABEL[memberType]?.[key] || TRACKED_FIELDS.find(f => f.key === key)?.label || key;

export interface ReviewChange { field: string; label: string; from: unknown; to: unknown }

export interface ReviewLogEntry {
  id: string;
  at: string;
  kind: 'edit' | 'decision' | 'add';
  tags: string[];
  /** member positions touched (stable: members are only ever patched in place or appended, and only a trailing add is undone) */
  indices: number[];
  changes: ReviewChange[];
  decision?: 'approved' | 'rejected' | 'cleared';
  note?: string;
  /** members as they were before this action, same order as indices (for undo) */
  before: ExtractedMember[];
  undoneAt?: string;
  /** reviewer name as typed (not an authenticated identity) and drawing file name · SHA-256 prefix */
  by?: string;
  revision?: string;
  /** calculation fingerprints of the touched members before / after, and how to find each member (index alone shifts between readings) */
  fingerprintBefore?: string[];
  fingerprintAfter?: string[];
  refs?: { itemId?: string; tag: string; grid?: string; level?: string }[];
}

const same = (a: unknown, b: unknown) => (a ?? '') === (b ?? '') || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9)
  || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
const DUP_TH: Record<string, string> = { SAME_INSTANCE: 'ชิ้นเดียวกัน', DISTINCT: 'คนละชิ้น', DEFERRED: 'ส่งกลับตรวจสอบ', UNDECIDED: 'ยังตัดสินไม่ได้' };
/** a value as the log shows it (RebarSets as their labels, with each set's source) */
const logged = (key: string, v: unknown) =>
  key === 'duplicateReviews' && Array.isArray(v)
    ? v.map((d: DuplicateDecision) => `${DUP_TH[d.decision] || d.decision} [${d.key}] โดย ${d.by}${d.reason ? ': ' + d.reason : ''}`).join('; ') || '(ไม่มี)'
    :
  key === 'conflictResolutions' && Array.isArray(v)
    ? v.map((r: ConflictResolution) => `${r.field}: ${r.before ?? '—'} → ${r.choice === 'deferred' ? 'ส่งกลับตรวจเพิ่ม' : r.value}${r.sourcePage ? ' (หน้า ' + r.sourcePage + ')' : r.choice === 'manual' ? ' (กรอกเอง)' : ''} โดย ${r.by}${r.reason ? ': ' + r.reason : ''}`).join('; ') || '(ไม่มี)'
    : key === 'rebarSets' && Array.isArray(v)
    ? v.map((s: RebarSet) => `${s.id} ${s.quantity ? s.quantity + '-' : ''}${s.barType || 'DB'}${s.diameterMm ?? '?'}${s.spacingMm ? '@' + s.spacingMm / 1000 : ''} ${s.direction} ${s.layer} [${s.source}]`).join('; ') || '(ไม่มีชุด)'
    : v;

/** Builds the log entry for one reviewer action, or null if nothing changed. */
export function logEntryFor(prev: ExtractedMember[], next: ExtractedMember[], indices: number[], at = new Date()): ReviewLogEntry | null {
  const idx = [...new Set(indices)].filter(i => prev[i] && next[i]).sort((a, b) => a - b);
  if (!idx.length) return null;
  // value changes are reported once per field (a tag edit applies the same value everywhere)
  const changes: ReviewChange[] = [];
  for (const f of TRACKED_FIELDS) {
    const i = idx.find(k => !same(prev[k][f.key], next[k][f.key]));
    if (i !== undefined) changes.push({ field: String(f.key), label: fieldLabel(next[i].memberType, String(f.key)), from: logged(String(f.key), prev[i][f.key]), to: logged(String(f.key), next[i][f.key]) });
  }
  const r0 = prev[idx[0]].review, r1 = next[idx[0]].review;
  // re-approving a lapsed approval keeps the status but binds new inputs: still a decision
  const decisionChanged = (r0?.status ?? null) !== (r1?.status ?? null) || (r1?.status === 'approved' && r0?.fingerprint !== r1.fingerprint);
  const decision = decisionChanged ? (r1?.status ?? 'cleared') : undefined;
  if (!changes.length && !decision) return null;
  return {
    id: `${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: at.toISOString(),
    kind: changes.length ? 'edit' : 'decision',
    tags: [...new Set(idx.map(i => next[i].tag))],
    indices: idx,
    changes,
    decision: decision as ReviewLogEntry['decision'],
    note: r1?.note,
    before: idx.map(i => prev[i]),
  };
}

export function addEntry(added: ExtractedMember[], firstIndex: number, reason: string, at = new Date()): ReviewLogEntry {
  return {
    id: `${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: at.toISOString(), kind: 'add',
    tags: [...new Set(added.map(m => m.tag))],
    indices: added.map((_, k) => firstIndex + k),
    changes: [], note: reason, before: [],
  };
}

/** Members with one entry reverted (the members it touched go back to their earlier state). */
export function undoEntry(members: ExtractedMember[], e: ReviewLogEntry): ExtractedMember[] {
  if (e.kind === 'add') return members.filter((_, i) => !e.indices.includes(i));
  const next = [...members];
  e.indices.forEach((i, k) => { if (next[i] && e.before[k]) next[i] = e.before[k]; });
  return next;
}

/**
 * Undo is allowed for the latest action on its members (undoing an older one would also wipe the
 * later edits), and an add only while its members are still the last ones (positions stay stable).
 */
export const canUndo = (e: ReviewLogEntry, memberCount: number, log: ReviewLogEntry[]) => {
  if (e.undoneAt) return false;
  const later = log.filter(o => !o.undoneAt && o.at > e.at);
  if (later.some(o => o.indices.some(i => e.indices.includes(i)))) return false;
  if (e.kind === 'add') return e.indices[e.indices.length - 1] === memberCount - 1 && !later.some(o => o.kind === 'add');
  return true;
};

export const fmtValue = (v: unknown) => (v === undefined || v === null || v === '' || v === 0 ? '—' : String(v));

/** Entries that touched one member, newest first. */
export const entriesFor = (log: ReviewLogEntry[], memberIndex: number) =>
  log.filter(e => e.indices.includes(memberIndex)).sort((a, b) => b.at.localeCompare(a.at));
