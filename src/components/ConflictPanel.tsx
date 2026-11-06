/**
 * Source conflicts on one member: every source's value with its original page, reference and method, and the
 * reviewer's ruling — one conflict at a time (no bulk), always with a name, and with a reason where the risk asks.
 * A ruling writes the value into the member as the reviewer's (never as drawing-confirmed) and is recorded with
 * the value before it, so the approval snapshot changes and an earlier approval lapses.
 */
import React, { useState } from 'react';
import {
  CONFLICT_FIELD, resolutionNeedsReason,
  type ConflictResolution, type ConflictStatus, type ExtractedMember, type ApprovalState,
} from '../engine/qsEngine';

interface Props {
  member: ExtractedMember;
  conflicts: ConflictStatus[];
  approvalState?: ApprovalState;
  reviewer: string;
  revision?: string;
  onAskReviewer: () => void;
  onResolve: (patch: Partial<ExtractedMember>) => void;
}

const STATE: Record<ConflictStatus['state'], [string, string]> = {
  open: ['ยังไม่ตัดสิน', 'bg-rose-50 text-rose-800 border-rose-200'],
  deferred: ['ส่งกลับตรวจเพิ่ม', 'bg-amber-50 text-amber-800 border-amber-200'],
  invalid: ['การตัดสินไม่ครบ', 'bg-rose-50 text-rose-800 border-rose-200'],
  mismatch: ['ค่าเปลี่ยนหลังตัดสิน', 'bg-rose-50 text-rose-800 border-rose-200'],
  resolved: ['ตัดสินแล้ว', 'bg-emerald-50 text-emerald-800 border-emerald-200'],
};
const APPROVAL_TH: Record<string, string> = { APPROVED: 'อนุมัติแล้ว', STALE: 'อนุมัติหมดอายุ', NEEDS_REVIEW: 'รอตรวจ', REJECTED: 'ไม่นับ' };

const One: React.FC<{ c: ConflictStatus; member: ExtractedMember } & Omit<Props, 'conflicts' | 'member' | 'approvalState'>> = ({ c, member, reviewer, revision, onAskReviewer, onResolve }) => {
  const def = CONFLICT_FIELD[c.conflict.field];
  const numeric = typeof c.conflict.sources.find(s => s.value != null)?.value === 'number';
  const [choice, setChoice] = useState<string>(c.resolution ? (c.resolution.choice === 'source' ? `s${c.resolution.sourceIndex}` : c.resolution.choice) : '');
  const [manual, setManual] = useState(c.resolution?.choice === 'manual' ? String(c.resolution.value ?? '') : '');
  const [reason, setReason] = useState(c.resolution?.reason || '');
  const [error, setError] = useState('');
  const kind: ConflictResolution['choice'] | '' = choice.startsWith('s') ? 'source' : (choice as ConflictResolution['choice'] | '');

  const save = () => {
    if (!reviewer.trim()) { setError('กรอกชื่อผู้ตรวจก่อน'); onAskReviewer(); return; }
    if (!kind) { setError('เลือกค่าที่จะใช้ หรือส่งกลับตรวจเพิ่ม'); return; }
    if (resolutionNeedsReason(c.conflict.field, kind) && !reason.trim()) { setError('ต้องระบุเหตุผล'); return; }
    const idx = kind === 'source' ? Number(choice.slice(1)) : undefined;
    const value = kind === 'source' ? c.conflict.sources[idx!].value
      : kind === 'manual' ? (numeric ? Number(manual) : manual.trim()) : null;
    if (kind === 'manual' && (numeric ? !(Number(value) > 0) : !String(value))) { setError('กรอกค่าที่ถูกต้อง'); return; }
    const before = (member as any)[def.key] ?? null;
    const res: ConflictResolution = {
      key: c.key, field: c.conflict.field, choice: kind, sourceIndex: idx, value, before,
      sourcePage: kind === 'source' ? c.conflict.sources[idx!].page : undefined,
      by: reviewer.trim(), reason: reason.trim() || undefined, at: new Date().toISOString(), revision,
    };
    const patch: Partial<ExtractedMember> = { conflictResolutions: [...(member.conflictResolutions || []).filter(r => r.key !== c.key), res] };
    if (kind !== 'deferred') {
      (patch as any)[def.key] = value;
      // the ruled value is the reviewer's: it never becomes drawing-confirmed
      if (member.provenance) patch.provenance = { ...member.provenance, fieldSources: { ...member.provenance.fieldSources, [def.fs]: 'reviewer' } };
    }
    setError('');
    onResolve(patch);
  };

  const [label, cls] = STATE[c.state];
  return (
    <div data-conflict={c.key} className="rounded-lg border border-rose-200 p-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <b>{def.label}</b>
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cls}`}>{label}</span>
        {c.conflict.kind === 'UNDECIDABLE' && <span className="text-[10px] text-amber-700">รูปแบบค่าที่เขียนเทียบกันไม่ได้</span>}
        <span className="text-[10px] text-slate-500">ค่าในช่องตอนนี้: <span className="font-mono">{String((member as any)[def.key] ?? '—')}</span>{c.state !== 'resolved' && ' (ชั่วคราว ยังไม่ตัดสิน)'}</span>
      </div>
      <table className="w-full text-[11px]">
        <thead><tr className="text-slate-500 text-left"><th></th><th>ค่า</th><th>หน้า</th><th>อ้างอิง</th><th>วิธีอ่าน</th></tr></thead>
        <tbody>
          {c.conflict.sources.map((s, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td><input type="radio" name={`c-${c.key}`} checked={choice === `s${i}`} onChange={() => setChoice(`s${i}`)} aria-label={`ใช้ค่าแหล่งที่ ${i + 1}`} disabled={s.value == null} /></td>
              <td className="font-mono">{String(s.value ?? '—')}</td>
              <td>{s.page ?? 'ไม่มีเลขหน้า'}</td>
              <td>{s.ref}</td>
              <td className="text-slate-500">{s.method === 'pdf_text' ? 'ข้อความในไฟล์' : s.method === 'vision' ? 'อ่านจากภาพ/OCR' : s.method === 'dxf' ? 'DXF' : s.method || '—'}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-100">
            <td><input type="radio" name={`c-${c.key}`} checked={choice === 'manual'} onChange={() => setChoice('manual')} aria-label="กรอกค่าที่ถูกต้อง" /></td>
            <td colSpan={4}><input value={manual} onChange={e => { setManual(e.target.value); setChoice('manual'); }} placeholder="กรอกค่าที่ถูกต้อง" aria-label={`ค่าที่ถูกต้อง ${def.label}`} className="w-40 rounded border border-slate-200 px-1 font-mono" /></td>
          </tr>
          <tr className="border-t border-slate-100">
            <td><input type="radio" name={`c-${c.key}`} checked={choice === 'deferred'} onChange={() => setChoice('deferred')} aria-label="ส่งกลับตรวจสอบเพิ่มเติม" /></td>
            <td colSpan={4}>ส่งกลับตรวจสอบเพิ่มเติม (ยังไม่ปล่อยยอด)</td>
          </tr>
        </tbody>
      </table>
      <input value={reason} onChange={e => setReason(e.target.value)} aria-label={`เหตุผล ${def.label}`}
        placeholder={kind && !resolutionNeedsReason(c.conflict.field, kind) ? 'เหตุผล (ไม่บังคับ)' : 'เหตุผล (บังคับ)'} className="w-full rounded border border-slate-200 px-1.5 py-1" />
      {c.resolution && (
        <div className="text-[10px] text-slate-500">
          ตัดสินล่าสุด: {c.resolution.before ?? '—'} → {c.resolution.choice === 'deferred' ? 'ส่งกลับตรวจเพิ่ม' : String(c.resolution.value)}
          {c.resolution.sourcePage ? ` (หน้า ${c.resolution.sourcePage})` : c.resolution.choice === 'manual' ? ' (กรอกเอง)' : ''} โดย {c.resolution.by} {new Date(c.resolution.at).toLocaleString('th-TH')}
        </div>
      )}
      {error && <div className="text-rose-700">{error}</div>}
      <button type="button" onClick={save} className="px-2 py-1 rounded-md border border-blue-300 text-blue-700 font-semibold">บันทึกการตัดสิน {def.label}</button>
    </div>
  );
};

export const ConflictPanel: React.FC<Props> = props => {
  if (!props.conflicts.length) return null;
  const open = props.conflicts.filter(c => c.state !== 'resolved').length;
  return (
    <div data-conflict-panel className="space-y-2 text-xs">
      <div className="font-semibold text-rose-800">
        ค่าขัดแย้งระหว่างแหล่งข้อมูล ({open} ยังไม่ตัดสิน / {props.conflicts.length}) · สถานะอนุมัติ: {props.approvalState ? APPROVAL_TH[props.approvalState] : 'ไม่ต้องตัดสิน'}
      </div>
      <div className="text-slate-500">ระบบไม่เลือกค่าให้ — ตัดสินทีละรายการ อนุมัติทั้งชิ้นไม่ปล่อยยอดจนกว่าจะตัดสินครบ</div>
      {props.conflicts.map(c => <One key={c.key} c={c} {...props} />)}
    </div>
  );
};
