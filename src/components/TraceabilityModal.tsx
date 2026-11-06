import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { CalculatedQuantity, ExtractedMember, FieldSource } from '../engine/qsEngine';
import type { Language } from '../utils/translations';
import { translateMessage } from '../utils/translations';
import { MemberDiagram } from './MemberDiagram';
import { SourceViewer } from './SourceViewer';
import { ReviewHistory } from './ReviewHistory';
import { TYPE_TH, SOURCE_BADGE } from './SectionTable';
import { TRACKED_FIELDS, TYPE_FIELDS, entriesFor, fmtValue, fieldLabel, type ReviewLogEntry } from '../engine/reviewLog';

interface TraceabilityModalProps {
  item: CalculatedQuantity | null;
  member?: ExtractedMember;
  reviewLog?: ReviewLogEntry[];
  onUndo?: (id: string) => void;
  onGoReview?: () => void;
  docId?: string;
  onClose: () => void;
  lang: Language;
  theme?: 'light' | 'dark';
}

/** which provenance key records where a member field came from */
const SOURCE_KEY: Record<string, string> = {
  width: 'width', depth: 'depth', length: 'length', supportColW1: 'support', supportColW2: 'support',
  excavationDepthM: 'excavation', topRebar: 'rebar', bottomRebar: 'rebar', stirrupRebar: 'stirrup',
};

const STATUS = {
  AUTO_RELEASE: { th: 'ผ่านอัตโนมัติ', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  NEEDS_REVIEW: { th: 'รอตรวจ', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  REJECTED: { th: 'ใช้ไม่ได้', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
} as const;

const H = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <h4 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
    <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-xs inline-flex items-center justify-center">{n}</span>{children}
  </h4>
);

/**
 * Traces one takeoff line back to its origin, in the order a checker would go:
 * the quantity → the formula and deductions → each input value and where it came from
 * (drawing, grid, inferred, reviewer — with the edit history) → the drawing itself.
 */
export const TraceabilityModal: React.FC<TraceabilityModalProps> = ({ item, member, reviewLog = [], onUndo, onGoReview, onClose, lang }) => {
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);
  if (!item) return null;

  const st = STATUS[item.status];
  const history = item.memberIndex !== undefined ? entriesFor(reviewLog, item.memberIndex) : [];
  const fields = member ? TRACKED_FIELDS.filter(f => (TYPE_FIELDS[member.memberType] || []).includes(String(f.key))) : [];
  const lastChange = (field: string) => history.find(e => !e.undoneAt && e.changes.some(c => c.field === field));
  const flags = [
    ...item.rejectionReasons,
    ...(item.reviewWarnings || []),
    ...(item.flags?.filter(f => f.severity === 'info').map(f => f.message) || []),
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 bg-slate-900/60" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[96vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-lg font-semibold font-mono text-slate-900">{item.tag}</span>
              <span className="text-slate-600">{TYPE_TH[item.memberType] || item.memberType} · {item.gridLocation} · {item.level}</span>
              <span className={`text-xs px-2 py-0.5 rounded border ${st.cls}`}>{item.review ? (item.review.status === 'approved' ? 'ผู้ตรวจอนุมัติ' : 'ผู้ตรวจไม่นับ') : st.th}</span>
            </div>
            <div className="text-xs text-slate-500 font-mono">{item.itemId} · ความมั่นใจ {item.confidencePct ?? '—'}%</div>
          </div>
          <button onClick={onClose} className="ml-auto p-2 rounded-md hover:bg-slate-100" title="ปิด (Esc)"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-6">
          {flags.length > 0 && (
            <ul className="text-sm rounded-md border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 list-disc pl-6">
              {flags.map((f, i) => <li key={i}>{translateMessage(f, lang)}</li>)}
            </ul>
          )}

          <section>
            <H n={1}>ปริมาณที่ได้</H>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['คอนกรีต', item.volumeNetM3.toFixed(3), 'ลบ.ม.'],
                ['ไม้แบบ', item.formworkNetM2.toFixed(2), 'ตร.ม.'],
                ['เหล็กเสริม', (item.rebarWeightKg || 0).toFixed(1), 'กก.'],
                ['ราคา ปร.4', Math.round(item.totalCostThb || 0).toLocaleString(), 'บาท'],
              ].map(([l, v, u]) => (
                <div key={l} className="rounded-md border border-slate-200 px-3 py-2">
                  <div className="text-xs text-slate-500">{l}</div>
                  <div className="font-mono font-semibold text-slate-900">{v} <span className="text-xs font-normal text-slate-500">{u}</span></div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <H n={2}>คำนวณจาก</H>
            <div className="font-mono text-sm rounded-md bg-slate-50 border border-slate-200 px-3 py-2 whitespace-pre-wrap text-slate-800">{item.formulaStr}</div>
            {item.deductions?.length > 0 && (
              <ul className="mt-2 text-sm space-y-1">
                {item.deductions.map((d, i) => (
                  <li key={i} className="flex justify-between gap-3 border-b border-slate-100 pb-1">
                    <span className="text-slate-700">{translateMessage(d.description, lang)}</span>
                    <span className="font-mono text-amber-800 whitespace-nowrap">−{d.deductionM.toFixed(3)} ม.</span>
                  </li>
                ))}
              </ul>
            )}
            {item.rebarFormulaStr && <div className="mt-2 font-mono text-sm text-slate-600 whitespace-pre-wrap">{item.rebarFormulaStr}</div>}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-slate-600">รูปตัดชิ้นส่วน</summary>
              <div className="mt-2"><MemberDiagram item={item} lang={lang} /></div>
            </details>
          </section>

          {member && (
            <section>
              <H n={3}>ค่าที่ใช้ และที่มาของแต่ละค่า</H>
              <div className="rounded-md border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600 text-left">
                    <tr><th className="px-3 py-1.5">ค่า</th><th className="px-3 py-1.5">ใช้</th><th className="px-3 py-1.5">ที่มา</th><th className="px-3 py-1.5">การแก้ล่าสุด</th></tr>
                  </thead>
                  <tbody>
                    {fields.map(f => {
                      const src = member.provenance?.fieldSources[SOURCE_KEY[String(f.key)]] as FieldSource | undefined;
                      const ch = lastChange(String(f.key));
                      const c = ch?.changes.find(x => x.field === f.key);
                      return (
                        <tr key={String(f.key)} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 text-slate-700">{fieldLabel(item.memberType, String(f.key))}</td>
                          <td className="px-3 py-1.5 font-mono">{fmtValue(member[f.key])}</td>
                          <td className="px-3 py-1.5">{src ? <span className={`text-xs px-1.5 rounded border ${SOURCE_BADGE[src].cls}`}>{SOURCE_BADGE[src].th}</span> : <span className="text-xs px-1.5 rounded border border-slate-200 bg-slate-100 text-slate-500">ไม่ระบุที่มา (UNKNOWN)</span>}</td>
                          <td className="px-3 py-1.5 text-slate-600 font-mono text-xs">{c ? `${fmtValue(c.from)} → ${fmtValue(c.to)}` : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {item.sourceInfo && <p className="mt-1.5 text-xs text-slate-500">{item.sourceInfo}</p>}
            </section>
          )}

          <section>
            <H n={4}>ในแบบต้นฉบับ</H>
            <SourceViewer evidence={item.provenance?.evidence || []} height={460} />
          </section>

          <section>
            <H n={5}>ประวัติการตรวจของชิ้นนี้</H>
            <ReviewHistory log={history} memberCount={Number.MAX_SAFE_INTEGER} onUndo={onUndo} emptyText="ยังไม่มีผู้ตรวจแก้หรือตัดสินชิ้นนี้" />
          </section>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          {onGoReview && item.status !== 'AUTO_RELEASE' && (
            <button onClick={onGoReview} className="h-9 px-4 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm">ไปแก้ในหน้าตรวจทาน</button>
          )}
          <button onClick={onClose} className="h-9 px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm">ปิด</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
