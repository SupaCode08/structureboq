import React, { useMemo, useState } from 'react';
import type { CalculatedQuantity } from '../engine/qsEngine';
import type { SheetReading } from '../engine/sheetMerge';

/**
 * The plans as the system understood them: each footing / framing sheet's grid drawn to scale
 * from the dimensions it read, with this project's items placed on it. Colour = check state,
 * click = the item's trace. Nothing here is drawn that was not read from the drawing.
 */
interface Props {
  readings: SheetReading[];
  items: CalculatedQuantity[];
  onSelectItem: (item: CalculatedQuantity) => void;
}

const SHEET_LABEL: Record<string, string> = { footing_plan: 'ผังฐานราก', framing_plan: 'ผังคาน/พื้น', slab_plan: 'ผังพื้น' };
const stateColor = (i: CalculatedQuantity) =>
  i.review?.status === 'approved' ? '#2453a8' : i.review?.status === 'rejected' || i.status === 'REJECTED' ? '#b4233a' : i.status === 'AUTO_RELEASE' ? '#047857' : '#d97706';

type Pt = { x: number; y: number };

export const PlanView: React.FC<Props> = ({ readings, items, onSelectItem }) => {
  const plans = readings.filter(r => SHEET_LABEL[r.sheet_type] && r.grid?.x?.length && r.grid?.y?.length);
  const [page, setPage] = useState<number | undefined>(plans[0]?.page);
  const [hover, setHover] = useState<string | null>(null);
  const plan = plans.find(p => p.page === page) || plans[0];

  const layout = useMemo(() => {
    if (!plan) return null;
    const xs = plan.grid!.x!, ys = plan.grid!.y!;
    const W = Math.max(...xs.map(g => g.offset_m)), H = Math.max(...ys.map(g => g.offset_m));
    const at = (label: string): Pt | null => {
      const [yl, xl] = label.split('/');
      const gx = xs.find(g => g.label === xl), gy = ys.find(g => g.label === yl);
      return gx && gy ? { x: gx.offset_m, y: gy.offset_m } : null;
    };
    // items read from this sheet (their first evidence is the plan position)
    const mine = items.filter(i => i.provenance?.evidence?.[0]?.page === plan.page);
    const shapes = mine.map(i => {
      const [a, b] = i.gridLocation.split('–').map(s => s.trim());
      const p = at(a), q = b ? at(b) : null;
      return { i, p, q };
    }).filter(s => s.p);
    const off = mine.length - shapes.length;
    return { xs, ys, W, H, shapes, off };
  }, [plan, items]);

  if (!plans.length || !layout || !plan) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        ไม่มีผังที่อ่านกริดได้ — ผังจะแสดงเมื่อเปิดแบบ PDF ที่อ่านเส้นบอกระยะกริดได้
      </div>
    );
  }

  const pad = 1.2, k = 90; // px per metre
  const vw = (layout.W + pad * 2) * k, vh = (layout.H + pad * 2) * k;
  const X = (m: number) => (m + pad) * k, Y = (m: number) => (m + pad) * k;
  const hovered = layout.shapes.find(s => s.i.itemId === hover)?.i;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {plans.map(p => (
          <button key={p.page} onClick={() => setPage(p.page)}
            className={`h-9 px-3 rounded-md border text-sm ${p.page === plan.page ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
            {SHEET_LABEL[p.sheet_type]}{p.level ? ` · ${p.level}` : ''} · น.{p.page}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 mb-2">
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#047857' }} />ผ่านอัตโนมัติ</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#2453a8' }} />ผู้ตรวจยืนยัน</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#d97706' }} />รอตรวจ</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#b4233a' }} />ใช้ไม่ได้/ไม่นับ</span>
          <span className="ml-auto">กริดจากเส้นบอกระยะในแบบ (ม.) · {layout.shapes.length} ชิ้น{layout.off ? ` · ${layout.off} ชิ้นวางบนกริดไม่ได้` : ''}</span>
        </div>
        <div className="overflow-auto">
          <svg viewBox={`0 0 ${vw} ${vh}`} className="w-full max-h-[70vh] min-w-[520px]" role="img" aria-label="ผังที่ระบบอ่านได้">
            {layout.xs.map(g => (
              <g key={'x' + g.label}>
                <line x1={X(g.offset_m)} y1={Y(-0.6)} x2={X(g.offset_m)} y2={Y(layout.H + 0.6)} stroke="#9a9a92" strokeDasharray="10 6" />
                <circle cx={X(g.offset_m)} cy={Y(-0.85)} r={16} fill="#fff" stroke="#6f6f68" />
                <text x={X(g.offset_m)} y={Y(-0.85) + 5} textAnchor="middle" fontSize={15} fill="#2a2a26">{g.label}</text>
              </g>
            ))}
            {layout.ys.map(g => (
              <g key={'y' + g.label}>
                <line x1={X(-0.6)} y1={Y(g.offset_m)} x2={X(layout.W + 0.6)} y2={Y(g.offset_m)} stroke="#9a9a92" strokeDasharray="10 6" />
                <circle cx={X(-0.85)} cy={Y(g.offset_m)} r={16} fill="#fff" stroke="#6f6f68" />
                <text x={X(-0.85)} y={Y(g.offset_m) + 5} textAnchor="middle" fontSize={15} fill="#2a2a26">{g.label}</text>
              </g>
            ))}
            {layout.xs.slice(1).map((g, j) => (
              <text key={'dx' + j} x={(X(layout.xs[j].offset_m) + X(g.offset_m)) / 2} y={Y(-0.3)} textAnchor="middle" fontSize={13} fill="#6f6f68">{(g.offset_m - layout.xs[j].offset_m).toFixed(2)}</text>
            ))}
            {layout.ys.slice(1).map((g, j) => (
              <text key={'dy' + j} x={X(-0.3)} y={(Y(layout.ys[j].offset_m) + Y(g.offset_m)) / 2} textAnchor="middle" fontSize={13} fill="#6f6f68" transform={`rotate(-90 ${X(-0.3)} ${(Y(layout.ys[j].offset_m) + Y(g.offset_m)) / 2})`}>{(g.offset_m - layout.ys[j].offset_m).toFixed(2)}</text>
            ))}

            {/* slabs first, then beams, then columns/footings on top */}
            {layout.shapes.filter(s => s.i.memberType === 'SLAB' && s.q).map(({ i, p, q }) => (
              <rect key={i.itemId} x={X(Math.min(p!.x, q!.x)) + 6} y={Y(Math.min(p!.y, q!.y)) + 6} width={Math.abs(q!.x - p!.x) * k - 12} height={Math.abs(q!.y - p!.y) * k - 12}
                fill={stateColor(i)} fillOpacity={hover === i.itemId ? 0.3 : 0.12} stroke={stateColor(i)} strokeDasharray="4 4"
                className="cursor-pointer" onClick={() => onSelectItem(i)} onMouseEnter={() => setHover(i.itemId)} onMouseLeave={() => setHover(null)}>
                <title>{`${i.tag} ${i.gridLocation}`}</title>
              </rect>
            ))}
            {layout.shapes.filter(s => s.i.memberType === 'SLAB' && s.q).map(({ i, p, q }) => (
              <text key={'t' + i.itemId} x={X((p!.x + q!.x) / 2)} y={Y((p!.y + q!.y) / 2)} textAnchor="middle" fontSize={15} fill={stateColor(i)} pointerEvents="none">{i.tag}</text>
            ))}
            {layout.shapes.filter(s => s.i.memberType === 'BEAM' && s.q).map(({ i, p, q }) => (
              <g key={i.itemId} className="cursor-pointer" onClick={() => onSelectItem(i)} onMouseEnter={() => setHover(i.itemId)} onMouseLeave={() => setHover(null)}>
                <line x1={X(p!.x)} y1={Y(p!.y)} x2={X(q!.x)} y2={Y(q!.y)} stroke={stateColor(i)} strokeWidth={hover === i.itemId ? 12 : 8} strokeLinecap="round" />
                <line x1={X(p!.x)} y1={Y(p!.y)} x2={X(q!.x)} y2={Y(q!.y)} stroke="transparent" strokeWidth={22} />
                <text x={X((p!.x + q!.x) / 2) + (p!.x === q!.x ? 10 : 0)} y={Y((p!.y + q!.y) / 2) - (p!.y === q!.y ? 10 : 0)} fontSize={14} fill="#1c1c19" textAnchor={p!.x === q!.x ? 'start' : 'middle'} pointerEvents="none">{i.tag}</text>
                <title>{`${i.tag} ${i.gridLocation} ยาว ${i.lengthNetM.toFixed(2)} ม.`}</title>
              </g>
            ))}
            {layout.shapes.filter(s => (s.i.memberType === 'COLUMN' || s.i.memberType === 'FOOTING') && !s.q).map(({ i, p }) => {
              const sz = i.memberType === 'FOOTING' ? Math.max(0.4, i.widthM || 0.8) * k : 22;
              return (
                <g key={i.itemId} className="cursor-pointer" onClick={() => onSelectItem(i)} onMouseEnter={() => setHover(i.itemId)} onMouseLeave={() => setHover(null)}>
                  <rect x={X(p!.x) - sz / 2} y={Y(p!.y) - sz / 2} width={sz} height={sz}
                    fill={i.memberType === 'COLUMN' ? stateColor(i) : '#fff'} fillOpacity={i.memberType === 'COLUMN' ? 1 : 0.6}
                    stroke={stateColor(i)} strokeWidth={hover === i.itemId ? 4 : 2} />
                  <title>{`${i.tag} ${i.gridLocation}`}</title>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="min-h-6 text-sm text-slate-700">
          {hovered ? <><b className="font-mono">{hovered.tag}</b> {hovered.gridLocation} · {hovered.widthM.toFixed(2)}×{hovered.depthM.toFixed(2)} ม. · คอนกรีต {hovered.volumeNetM3.toFixed(3)} ลบ.ม. — คลิกเพื่อดูที่มา</> : <span className="text-slate-500">ชี้หรือคลิกชิ้นส่วนเพื่อดูค่าและที่มา</span>}
        </div>
      </div>
    </div>
  );
};
