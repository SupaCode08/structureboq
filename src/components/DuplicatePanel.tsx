/**
 * Occurrences of one member reference that may be one physical instance counted twice: each with its instance id,
 * original page, grid, specification and quantity, the classification and its evidence, and the reviewer's ruling
 * for this one group (never several groups at once), always with a name, a reason and a time.
 */
import React, { useState } from 'react';
import { duplicateDecisionProblem, type CalculatedQuantity, type DuplicateDecision, type DuplicateGroup, type ExtractedMember } from '../engine/qsEngine';

interface Props {
  group: DuplicateGroup;
  items: CalculatedQuantity[];
  members: ExtractedMember[];
  reviewer: string;
  revision?: string;
  onAskReviewer: () => void;
  onDecide: (updates: { index: number; patch: Partial<ExtractedMember> }[]) => void;
  onOpenItem?: (itemId: string) => void;
}

const CLASS_TH: Record<string, string> = {
  SAME_PHYSICAL_INSTANCE: 'ชิ้นเดียวกัน (ตำแหน่งเดียวกัน)', POSSIBLE_DUPLICATE: 'อาจซ้ำ', DISTINCT_PHYSICAL_INSTANCES: 'คนละชิ้น (คนละตำแหน่ง)',
  SAME_SPECIFICATION: 'ค่าเหมือนกันแต่ต่างเบอร์', CONFLICTING_SPECIFICATION: 'ค่าขัดแย้ง', INSUFFICIENT_EVIDENCE: 'หลักฐานไม่พอ',
};
const DECISIONS: [DuplicateDecision['decision'], string][] = [
  ['SAME_INSTANCE', 'ยืนยันว่าเป็นชิ้นงานเดียวกัน (นับครั้งเดียว ที่รายการแรก)'], ['DISTINCT', 'ยืนยันว่าเป็นคนละชิ้น (นับทุกรายการ)'],
  ['DEFERRED', 'ส่งกลับตรวจสอบ'], ['UNDECIDED', 'ยังตัดสินไม่ได้'],
];
const STATE_TH: Record<DuplicateGroup['state'], string> = { info: 'ไม่ต้องตัดสิน', open: 'ยังไม่ตัดสิน', invalid: 'การตัดสินใช้ไม่ได้', decided: 'ตัดสินแล้ว' };

export const DuplicatePanel: React.FC<Props> = ({ group, items, members, reviewer, revision, onAskReviewer, onDecide, onOpenItem }) => {
  const [choice, setChoice] = useState<DuplicateDecision['decision'] | ''>(group.decision?.decision || '');
  const [reason, setReason] = useState(group.decision?.reason || '');
  const [error, setError] = useState('');
  const itemOf = (i: number) => items.find(it => it.memberIndex === i);

  const save = () => {
    if (!reviewer.trim()) { setError('กรอกชื่อผู้ตรวจก่อน'); onAskReviewer(); return; }
    if (!choice) { setError('เลือกคำตัดสิน'); return; }
    const d: DuplicateDecision = { key: group.key, decision: choice, by: reviewer.trim(), reason: reason.trim(), at: new Date().toISOString(), revision };
    const problem = duplicateDecisionProblem(members, group, d);
    if (problem) { setError(problem); return; }
    setError('');
    // one ruling about this group, recorded on each of its occurrences so every one's snapshot carries it
    onDecide(group.members.map(index => ({ index, patch: { duplicateReviews: [...(members[index].duplicateReviews || []).filter(x => x.key !== group.key), d] } })));
  };

  return (
    <div data-duplicate-panel={group.key} className="rounded-lg border border-orange-200 p-2 space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-orange-800">ตรวจรายการซ้ำ: {group.occurrences[0].tag}</b>
        <span className="px-1.5 py-0.5 rounded border border-orange-200 bg-orange-50 text-orange-800 text-[10px] font-semibold">{CLASS_TH[group.classification]}</span>
        <span className="text-[10px] text-slate-600">{STATE_TH[group.state]}{group.problem ? ` — ${group.problem}` : ''}</span>
      </div>
      <ul className="list-disc pl-4 text-slate-700">{group.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
      <table className="w-full text-[11px]">
        <thead><tr className="text-slate-500 text-left"><th>รายการ</th><th>Physical instance</th><th>หน้า</th><th>ตำแหน่ง</th><th>ค่า</th><th>คอนกรีต</th><th>นับ</th></tr></thead>
        <tbody>
          {group.members.map((i, k) => {
            const it = itemOf(i);
            const o = group.occurrences[k];
            return (
              <tr key={i} className="border-t border-slate-100">
                <td>{it && onOpenItem ? <button type="button" className="underline" onClick={() => onOpenItem(it.itemId)}>{it.itemId}</button> : it?.itemId}</td>
                <td className="font-mono">{it?.duplicate?.instanceId ?? '—'}</td>
                <td>{o.page ?? '—'}</td>
                <td>{o.location ?? 'ไม่มีตำแหน่งในผัง'}</td>
                <td className="font-mono">{o.spec}</td>
                <td>{it ? `${it.volumeNetM3.toFixed(3)} ลบ.ม.` : '—'}</td>
                <td>{it?.duplicate?.counted === false ? `ไม่นับ (ลิงก์กับ ${it.duplicate.linkedTo})` : 'นับ'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {group.blocking && (
        <>
          <div className="space-y-0.5">
            {DECISIONS.map(([v, l]) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="radio" name={`d-${group.key}`} checked={choice === v} onChange={() => setChoice(v)} aria-label={l} />{l}
              </label>
            ))}
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผล (บังคับ)" aria-label="เหตุผลการตัดสินรายการซ้ำ" className="w-full rounded border border-slate-200 px-1.5 py-1" />
          {group.decision && <div className="text-[10px] text-slate-500">ตัดสินล่าสุด: {DECISIONS.find(d => d[0] === group.decision!.decision)?.[1]} โดย {group.decision.by} {new Date(group.decision.at).toLocaleString('th-TH')}</div>}
          {error && <div className="text-rose-700">{error}</div>}
          <button type="button" onClick={save} className="px-2 py-1 rounded-md border border-orange-300 text-orange-800 font-semibold">บันทึกการตัดสินรายการซ้ำ</button>
        </>
      )}
    </div>
  );
};
