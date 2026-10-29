import React, { useMemo, useState } from 'react';
import type { CalculatedQuantity, CategorySummary } from '../engine/qsEngine';
import type { Language } from '../utils/translations';
import { TYPE_TH } from './SectionTable';

interface SummaryCardsProps {
  items: CalculatedQuantity[];
  onSelectItem: (item: CalculatedQuantity) => void;
  totalVolumeM3: number;
  totalFormworkM2: number;
  totalItemsCount: number;
  autoReleaseCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  passRatePct?: number;
  currentFilterStatus?: string;
  onFilterChange?: (status: string) => void;
  lang?: Language;
  theme?: 'light' | 'dark';
  totalCostThb?: number;
  totalRebarWeightKg?: number;
  factorF?: number;
  totalCostWithFactorF?: number;
  categorySummaries?: Record<string, CategorySummary>;
  onOpenMaterialSpecs?: () => void;
  onOpenFactorF?: () => void;
}

type Metric = 'concrete' | 'formwork' | 'rebar' | 'cost';
const METRIC: Record<Metric, { label: string; unit: string; of: (i: CalculatedQuantity) => number; digits: number }> = {
  concrete: { label: 'คอนกรีต', unit: 'ลบ.ม.', of: i => i.volumeNetM3, digits: 3 },
  formwork: { label: 'ไม้แบบ', unit: 'ตร.ม.', of: i => i.formworkNetM2, digits: 2 },
  rebar: { label: 'เหล็กเสริม', unit: 'กก.', of: i => i.rebarWeightKg || 0, digits: 1 },
  cost: { label: 'ราคา ปร.4', unit: 'บาท', of: i => i.totalCostThb || 0, digits: 0 },
};
const fmt = (v: number, d: number) => v.toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d });

/** how far a total can be trusted: share of it that passed automatically, was checked, or is still open */
const checkState = (i: CalculatedQuantity) =>
  i.review?.status === 'approved' ? 'checked' : i.review?.status === 'rejected' || i.status === 'REJECTED' ? 'out' : i.status === 'AUTO_RELEASE' ? 'auto' : 'open';

/**
 * Project totals that open into what they are made of: by member type, then each item
 * (and from an item, its formula, inputs and drawing in the trace view).
 */
export const SummaryCards: React.FC<SummaryCardsProps> = ({
  items, onSelectItem, totalVolumeM3, totalFormworkM2, totalRebarWeightKg = 0, totalCostThb = 0, factorF = 1,
  totalCostWithFactorF, categorySummaries, onOpenFactorF,
}) => {
  const [open, setOpen] = useState<Metric | null>(null);
  const counted = items.filter(i => checkState(i) !== 'out');
  const totals: Record<Metric, number> = { concrete: totalVolumeM3, formwork: totalFormworkM2, rebar: totalRebarWeightKg, cost: totalCostThb };

  const share = (m: Metric) => {
    const of = METRIC[m].of;
    const all = counted.reduce((a, i) => a + of(i), 0) || 1;
    const part = (s: string) => counted.filter(i => checkState(i) === s).reduce((a, i) => a + of(i), 0) / all;
    return { auto: part('auto'), checked: part('checked'), open: part('open') };
  };

  const breakdown = useMemo(() => {
    if (!open) return [];
    const of = METRIC[open].of;
    const byType = new Map<string, CalculatedQuantity[]>();
    for (const i of counted) byType.set(i.memberType, [...(byType.get(i.memberType) || []), i]);
    return ['FOOTING', 'COLUMN', 'BEAM', 'SLAB', 'STAIR'].filter(t => byType.has(t)).map(t => {
      const list = byType.get(t)!.sort((a, b) => of(b) - of(a));
      return { type: t, sum: list.reduce((a, i) => a + of(i), 0), list };
    });
  }, [open, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const grand = totalCostWithFactorF || totalCostThb * factorF;
  const cats = Object.values(categorySummaries || {});

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(METRIC) as Metric[]).map(m => {
          const s = share(m);
          return (
            <button
              key={m}
              onClick={() => setOpen(open === m ? null : m)}
              className={`text-left rounded-xl border bg-white px-4 py-3 hover:border-blue-400 ${open === m ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-200'}`}
            >
              <div className="text-sm text-slate-600">{METRIC[m].label}</div>
              <div className="text-2xl font-semibold text-slate-900 tabular-nums">{fmt(totals[m], METRIC[m].digits)} <span className="text-sm font-normal text-slate-500">{METRIC[m].unit}</span></div>
              {m === 'cost' && <div className="text-sm text-slate-600 tabular-nums">รวม Factor F {factorF.toFixed(4)} = <b>{fmt(grand, 0)}</b></div>}
              <div className="mt-2 flex h-1.5 rounded-full overflow-hidden bg-slate-200" title="สัดส่วนของยอดนี้ที่ผ่านอัตโนมัติ / ผู้ตรวจยืนยันแล้ว / ยังไม่ตรวจ">
                <div className="bg-emerald-600" style={{ width: `${s.auto * 100}%` }} />
                <div className="bg-blue-600" style={{ width: `${s.checked * 100}%` }} />
                <div className="bg-amber-400" style={{ width: `${s.open * 100}%` }} />
              </div>
              <div className="mt-1 text-xs text-slate-500">ยังไม่ตรวจ {Math.round(s.open * 100)}% ของยอด · คลิกดูที่มา</div>
            </button>
          );
        })}
      </div>

      {open && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 mb-3">
            <h3 className="font-semibold text-slate-900">{METRIC[open].label} {fmt(totals[open], METRIC[open].digits)} {METRIC[open].unit} มาจาก</h3>
            <span className="text-xs text-slate-500 flex items-center gap-3">
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-600 mr-1" />ผ่านอัตโนมัติ</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-600 mr-1" />ผู้ตรวจยืนยัน</span>
              <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 mr-1" />ยังไม่ตรวจ</span>
            </span>
            <button onClick={() => setOpen(null)} className="ml-auto text-sm text-slate-600 hover:underline">ปิด</button>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {breakdown.map(b => (
              <div key={b.type} className="rounded-md border border-slate-200">
                <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex justify-between text-sm">
                  <span className="font-medium">{TYPE_TH[b.type]} · {b.list.length} ชิ้น</span>
                  <span className="font-mono">{fmt(b.sum, METRIC[open].digits)}</span>
                </div>
                <ul className="max-h-56 overflow-y-auto text-sm">
                  {b.list.map(i => {
                    const st = checkState(i);
                    return (
                      <li key={i.itemId}>
                        <button onClick={() => onSelectItem(i)} className="w-full px-3 py-1 flex items-center gap-2 hover:bg-blue-50 text-left">
                          <i className={`w-2 h-2 rounded-full shrink-0 ${st === 'auto' ? 'bg-emerald-600' : st === 'checked' ? 'bg-blue-600' : 'bg-amber-400'}`} />
                          <span className="font-mono font-medium">{i.tag}</span>
                          <span className="text-slate-500 truncate">{i.gridLocation}</span>
                          {METRIC[open].of(i) > 0
                            ? <span className="ml-auto font-mono tabular-nums">{fmt(METRIC[open].of(i), METRIC[open].digits)}</span>
                            : <span className="ml-auto text-xs text-rose-700" title="ยังไม่ได้นับ เพราะขาดค่าจากแบบ">ขาดค่า</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {cats.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-2.5 text-sm text-slate-700 flex flex-wrap gap-x-3">
            <span className="font-medium">ปร.4 แยกหมวด</span>
            <span className="text-slate-500">Factor F {factorF.toFixed(4)}</span>
            {onOpenFactorF && <span role="button" onClick={e => { e.preventDefault(); onOpenFactorF(); }} className="text-blue-700 hover:underline">ตั้งค่า ปร.5</span>}
          </summary>
          <table className="w-full text-sm border-t border-slate-200">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr><th className="px-4 py-1.5">หมวด</th><th className="px-3 py-1.5 text-right">ชิ้น</th><th className="px-3 py-1.5 text-right">ค่าวัสดุ</th><th className="px-3 py-1.5 text-right">ค่าแรง</th><th className="px-4 py-1.5 text-right">รวม</th></tr>
            </thead>
            <tbody>
              {cats.map(c => (
                <tr key={c.categoryCode} className="border-t border-slate-100">
                  <td className="px-4 py-1.5">{c.categoryName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{c.itemCount}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.materialCostThb, 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmt(c.wageCostThb, 0)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums font-medium">{fmt(c.totalCostThb, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
};
