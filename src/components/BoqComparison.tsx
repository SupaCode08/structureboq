import React, { useMemo, useRef, useState } from 'react';
import { Upload, FileCheck2, Database, Loader2, CheckCircle2, AlertTriangle, XCircle, MinusCircle } from 'lucide-react';
import type { BOQProjectResult, EvidenceRef, MemberType } from '../engine/qsEngine';
import { compareTakeoffWithBoq, type BoqTotals, type ComparisonRow, type Verdict } from '../engine/boqCompare';
import { SourceViewer } from './SourceViewer';

export interface BoqState {
  docId?: string;
  fileName: string;
  variants: string[];
  structuralByVariant: Record<string, BoqTotals>;
  warnings: string[];
}

export interface DatasetInfo { id: string; name: string; source?: string; structuralPages?: string; pdf?: string; ocr?: string; boqVariant?: string; footingVariant?: string; boqOcr?: string }

interface BoqComparisonProps {
  result: BOQProjectResult;
  boq: BoqState | null;
  variant: string;
  setVariant: (v: string) => void;
  onUploadBoq: (file: File) => void;
  isUploading: boolean;
  datasets: DatasetInfo[];
  onLoadDataset: (id: string) => void;
  loadingDatasetId?: string | null;
  theme?: 'light' | 'dark';
  onOpenItem?: (itemId: string) => void;
  /** renders a page of the BOQ PDF loaded in the browser */
  pageUrl?: (page: number, dpi: number) => Promise<string>;
  progress?: { message: string; frac: number } | null;
}

const VERDICT: Record<Verdict, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  match: { label: 'ตรงกัน (≤5%)', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  rounding: { label: 'ตรงในระดับปัดเศษ BOQ', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 },
  close: { label: 'ใกล้เคียง (≤15%)', cls: 'text-amber-700 bg-amber-50 border-amber-200', icon: AlertTriangle },
  off: { label: 'ต่างมาก', cls: 'text-rose-700 bg-rose-50 border-rose-200', icon: XCircle },
  not_in_boq: { label: 'ไม่มีใน BOQ', cls: 'text-slate-600 bg-slate-50 border-slate-200', icon: MinusCircle },
  missing_in_takeoff: { label: 'ยังไม่มียอด', cls: 'text-rose-700 bg-rose-50 border-rose-200', icon: XCircle },
};

const TYPE_LABEL: Record<MemberType, string> = {
  FOOTING: 'ฐานราก',
  COLUMN: 'เสา',
  BEAM: 'คาน',
  SLAB: 'พื้น',
  STAIR: 'บันได',
  WALL: 'ผนัง',
  DOOR: 'ประตู',
  WINDOW: 'หน้าต่าง',
  FINISH: 'ผิวตกแต่ง',
};

export const BoqComparison: React.FC<BoqComparisonProps> = ({
  result, boq, variant, setVariant, onUploadBoq, isUploading, datasets, onLoadDataset, loadingDatasetId, theme = 'light', onOpenItem, pageUrl, progress,
}) => {
  const isLight = theme === 'light';
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const totals = boq?.structuralByVariant[variant] || null;
  const report = useMemo(() => (totals ? compareTakeoffWithBoq(result, totals) : null), [result, totals]);
  const row: ComparisonRow | undefined = report?.rows.find(r => r.key === selectedKey) || report?.rows[0];

  // Where the system quantity comes from: each item's share of this line (to explain a difference)
  const qtyOf = (key: string, it: BOQProjectResult['items'][number]) =>
    key === 'structural_concrete_m3' ? it.volumeNetM3 :
    key === 'formwork_m2' ? it.formworkNetM2 :
    key === 'excavation_m3' ? it.excavationM3 || 0 :
    key === 'sand_m3' ? it.sandBeddingM3 || 0 :
    key === 'lean_concrete_m3' ? it.leanConcreteM3 || 0 :
    key === 'precast_plank_m2' || key === 'topping_m2' ? it.precastSlabM2 || 0 :
    key === 'rebar_total_kg' ? it.rebarWeightKg || 0 :
    key.startsWith('rebar_') ? (it.rebarByDia || {})[key.slice(6, -3)] || 0 : 0;
  const contributors = useMemo(() => {
    if (!row) return [];
    return result.items.filter(it => row.itemIds.includes(it.itemId)).map(it => ({ it, q: qtyOf(row.key, it) })).filter(x => x.q > 0).sort((a, b) => b.q - a.q);
  }, [row, result]); // eslint-disable-line react-hooks/exhaustive-deps
  const breakdown = useMemo(() => {
    const byType = new Map<MemberType, { qty: number; n: number }>();
    for (const { it, q } of contributors) {
      const e = byType.get(it.memberType) || { qty: 0, n: 0 };
      byType.set(it.memberType, { qty: e.qty + q, n: e.n + 1 });
    }
    return [...byType.entries()].map(([t, v]) => ({ type: t, ...v })).sort((a, b) => b.qty - a.qty);
  }, [contributors]);

  const boqEvidence: EvidenceRef[] = (row?.boqSources || []).map(s => ({
    page: s.page, label: `BOQ ${s.text.slice(0, 18)}`, text: `${s.text} = ${s.quantity} ${s.unit}`, method: 'pdf_text',
    bboxNorm: undefined,
  }));
  // BOQ boxes are in PDF points; the page size comes with each source when available
  (row?.boqSources || []).forEach((s, i) => {
    if (s.bbox && s.page_width && s.page_height) boqEvidence[i].bboxNorm = [s.bbox[0] / s.page_width, s.bbox[1] / s.page_height, s.bbox[2] / s.page_width, s.bbox[3] / s.page_height];
  });

  const card = isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800';
  const muted = isLight ? 'text-slate-500' : 'text-slate-400';

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border p-4 flex flex-col lg:flex-row gap-4 ${card}`}>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900">เทียบกับ BOQ (ปร.4)</h2>
          <p className="text-sm text-slate-500">เปิด BOQ ของโครงการเดียวกัน แล้วคลิกแต่ละบรรทัดเพื่อดูว่ายอดของระบบมาจากชิ้นไหน และบรรทัดใน BOQ อยู่ตรงไหน</p>
          {isUploading && progress && (
            <div className="mt-2 text-sm max-w-md">
              <div className="flex justify-between text-slate-600 mb-1"><span>{progress.message}</span><span className="tabular-nums">{Math.round(progress.frac * 100)}%</span></div>
              <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round(progress.frac * 100)}%` }} /></div>
            </div>
          )}
          {boq && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <FileCheck2 className="w-4 h-4 text-emerald-600" />
              <span className="font-semibold">{boq.fileName}</span>
              {boq.variants.length > 1 && (
                <select value={variant} onChange={e => setVariant(e.target.value)} className={`rounded-lg border px-2 py-1 ${isLight ? 'border-slate-200' : 'border-slate-700 bg-slate-950'}`}>
                  {boq.variants.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              )}
              {boq.warnings.map((w, i) => <span key={i} className={muted}>· {w}</span>)}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 text-xs min-w-[260px]">
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUploadBoq(f); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} disabled={isUploading}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60">
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} เปิดไฟล์ BOQ (PDF)
          </button>
          {datasets.map(d => (
            <button key={d.id} onClick={() => onLoadDataset(d.id)} disabled={!!loadingDatasetId}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-left ${isLight ? 'border-slate-200 hover:bg-slate-50' : 'border-slate-700 hover:bg-slate-800'}`}>
              {loadingDatasetId === d.id ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Database className="w-4 h-4 text-amber-500 shrink-0" />}
              <span>{d.name.split(' — ')[0].replace(/\s*\(.*\)\s*$/, '')}</span>
            </button>
          ))}
        </div>
      </div>

      {!report ? (
        <div className={`rounded-xl border p-8 text-center text-sm ${card} ${muted}`}>ยังไม่มี BOQ — เปิดไฟล์ ปร.4 หรือเลือกแบบจริงด้านบน</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {report.headline.map(h => {
              const V = VERDICT[h.verdict];
              return (
                <div key={h.key} className={`rounded-2xl border p-3 ${card}`}>
                  <div className={`text-xs ${muted}`}>{h.label}</div>
                  <div className={`text-2xl font-black font-mono ${h.verdict === 'match' || h.verdict === 'rounding' ? 'text-emerald-600' : h.verdict === 'close' ? 'text-amber-600' : 'text-rose-600'}`}>
                    {h.pct === null ? '—' : `${h.pct > 0 ? '+' : ''}${h.pct}%`}
                  </div>
                  <div className={`inline-flex mt-1 text-[10px] px-1.5 py-0.5 rounded border ${V.cls}`}>{V.label}</div>
                </div>
              );
            })}
            <div className={`rounded-2xl border p-3 ${card}`}>
              <div className={`text-xs ${muted}`}>คลาดเคลื่อนเฉลี่ย (ค่าหลัก)</div>
              <div className="text-2xl font-black font-mono">{report.meanAbsPct ?? '—'}%</div>
              <div className={`text-[10px] mt-1 ${muted}`}>ผู้ตรวจยืนยันแล้ว {result.reviewedCount || 0} รายการ</div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <div className={`xl:col-span-7 rounded-2xl border overflow-hidden ${card}`}>
              <table className="w-full text-xs">
                <thead className={isLight ? 'bg-slate-50 text-slate-600' : 'bg-slate-950 text-slate-400'}>
                  <tr>
                    <th className="text-left px-3 py-2">รายการ</th>
                    <th className="text-right px-3 py-2">ระบบ</th>
                    <th className="text-right px-3 py-2">BOQ จริง</th>
                    <th className="text-right px-3 py-2">ต่าง</th>
                    <th className="text-left px-3 py-2">ผล</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map(r => {
                    const V = VERDICT[r.verdict];
                    const sel = row?.key === r.key;
                    return (
                      <tr key={r.key} onClick={() => setSelectedKey(r.key)}
                        className={`cursor-pointer border-t ${isLight ? 'border-slate-100' : 'border-slate-800'} ${sel ? (isLight ? 'bg-blue-50' : 'bg-blue-950/30') : isLight ? 'hover:bg-slate-50' : 'hover:bg-slate-800/50'}`}>
                        <td className="px-3 py-2 font-semibold">{r.label} <span className={`font-normal ${muted}`}>({r.unit})</span></td>
                        <td className="px-3 py-2 text-right font-mono">{r.system.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.boq === null ? '—' : r.boq.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.pct === null ? '—' : `${r.pct > 0 ? '+' : ''}${r.pct}%`}</td>
                        <td className="px-3 py-2"><span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] ${V.cls}`}><V.icon className="w-3 h-3" />{V.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {report.notes.map((n, i) => (
                <div key={i} className={`px-3 py-2 text-[11px] border-t ${isLight ? 'border-slate-100' : 'border-slate-800'} ${muted}`}>{n}</div>
              ))}
              {report.boqRoundedToInteger && (
                <div className={`px-3 py-2 text-[11px] border-t ${isLight ? 'border-slate-100' : 'border-slate-800'} ${muted}`}>
                  BOQ นี้ปัดเป็นจำนวนเต็ม — ต่างไม่เกิน 0.5 หน่วยต่อบรรทัดถือว่าตรงกัน
                </div>
              )}
            </div>

            <div className={`xl:col-span-5 rounded-2xl border p-3 space-y-3 ${card}`}>
              {row && (
                <>
                  <div className="text-sm font-bold">{row.label}: ระบบ {row.system.toLocaleString()} vs BOQ {row.boq ?? '—'} {row.unit}</div>
                  {breakdown.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-sm text-slate-600">ยอดของระบบมาจาก</div>
                      {breakdown.map(b => (
                        <div key={b.type} className="flex items-center gap-2 text-xs">
                          <span className="w-14">{TYPE_LABEL[b.type]}</span>
                          <div className={`flex-1 h-2 rounded-full ${isLight ? 'bg-slate-100' : 'bg-slate-800'}`}>
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${(b.qty / Math.max(...breakdown.map(x => x.qty), 1e-9)) * 100}%` }} />
                          </div>
                          <span className="font-mono w-20 text-right">{b.qty.toFixed(2)}</span>
                          <span className={`w-12 text-right ${muted}`}>{b.n} ชิ้น</span>
                        </div>
                      ))}
                      {onOpenItem && contributors.length > 0 && (
                        <ul className="mt-2 max-h-56 overflow-y-auto rounded-md border border-slate-200 text-sm">
                          {contributors.map(({ it, q }) => {
                            const st = it.review?.status === 'approved' ? 'bg-blue-600' : it.status === 'AUTO_RELEASE' ? 'bg-emerald-600' : 'bg-amber-400';
                            return (
                              <li key={it.itemId}>
                                <button onClick={() => onOpenItem(it.itemId)} className="w-full px-3 py-1 flex items-center gap-2 hover:bg-blue-50 text-left border-b border-slate-100">
                                  <i className={`w-2 h-2 rounded-full shrink-0 ${st}`} />
                                  <span className="font-mono font-medium">{it.tag}</span>
                                  <span className="text-slate-500 truncate">{it.gridLocation} · {TYPE_LABEL[it.memberType]}</span>
                                  <span className="ml-auto font-mono tabular-nums">{q.toFixed(row.unit === 'กก.' ? 1 : 3)}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                  {boqEvidence.length > 0 ? (
                    <SourceViewer docId={pageUrl ? undefined : boq?.docId} pageUrl={pageUrl} evidence={boqEvidence} theme={theme} height={440} />
                  ) : (
                    <div className={`text-xs ${muted}`}>BOQ ไม่มีรายการนี้</div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
