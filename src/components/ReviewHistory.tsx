import React from 'react';
import { Undo2 } from 'lucide-react';
import { canUndo, fmtValue, type ReviewLogEntry } from '../engine/reviewLog';

const DECISION_TH = { approved: 'อนุมัติ', rejected: 'ไม่นับ', cleared: 'ยกเลิกการตัดสิน' } as const;

const time = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
};

interface Props {
  log: ReviewLogEntry[];
  memberCount: number;
  onUndo?: (id: string) => void;
  /** opens the trace of the first member an entry touched */
  onOpen?: (memberIndex: number) => void;
  emptyText?: string;
}

/** Every reviewer action, newest first: what changed from what to what, when — with undo. */
export const ReviewHistory: React.FC<Props> = ({ log, memberCount, onUndo, onOpen, emptyText = 'ยังไม่มีการแก้หรือตัดสินโดยผู้ตรวจ' }) => {
  if (!log.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  const rows = [...log].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <ol className="divide-y divide-slate-100">
      {rows.map(e => (
        <li key={e.id} className={`py-2.5 flex flex-wrap items-start gap-x-3 gap-y-1 ${e.undoneAt ? 'opacity-50' : ''}`}>
          <span className="w-28 shrink-0 text-xs text-slate-500 tabular-nums pt-0.5">{time(e.at)}</span>
          <div className="flex-1 min-w-[14rem] text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono font-semibold text-slate-900">{e.tags.join(', ')}</span>
              <span className="text-slate-500 text-xs">{e.indices.length} ชิ้น</span>
              {e.kind === 'add' && <span className="text-blue-700">เพิ่มชิ้นส่วน</span>}
              {e.decision && <span className={e.decision === 'approved' ? 'text-emerald-700' : e.decision === 'rejected' ? 'text-rose-700' : 'text-slate-600'}>{DECISION_TH[e.decision]}</span>}
              {e.undoneAt && <span className="text-slate-600">(ย้อนแล้ว {time(e.undoneAt)})</span>}
            </div>
            {e.changes.length > 0 && (
              <ul className="mt-0.5 font-mono text-[13px] text-slate-700">
                {e.changes.map(c => (
                  <li key={c.field}>{c.label}: <span className="line-through text-slate-500">{fmtValue(c.from)}</span> → <b>{fmtValue(c.to)}</b></li>
                ))}
              </ul>
            )}
            {e.note && <div className="text-slate-600">{e.note}</div>}
          </div>
          <div className="flex gap-1.5 shrink-0">
            {onOpen && e.indices[0] !== undefined && e.indices[0] < memberCount && (
              <button onClick={() => onOpen(e.indices[0])} className="h-8 px-2.5 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">ดูที่มา</button>
            )}
            {onUndo && canUndo(e, memberCount, log) && (
              <button onClick={() => onUndo(e.id)} className="h-8 px-2.5 rounded-md border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1" title="คืนค่าก่อนการแก้นี้">
                <Undo2 className="w-3.5 h-3.5" />ย้อน
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
};
