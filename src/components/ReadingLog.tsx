import React, { useMemo, useState } from 'react';
import type { SheetReading } from '../engine/sheetMerge';
import { boxToNorm } from '../engine/sheetMerge';
import { PdfViewer, type Overlay } from './PdfViewer';

export interface ReadingLogData {
  readings: SheetReading[];
  skipped: { tag: string; page: number; reason: string }[];
  /** pages that were read but gave nothing structural */
  emptyPages: number[];
  notes: string[];
}

const SHEET_LABEL: Record<string, string> = {
  building_section: 'รูปตัดอาคาร (ระดับชั้น)',
  footing_plan: 'ผังฐานราก',
  framing_plan: 'ผังคาน / พื้น',
  slab_plan: 'ผังพื้น',
  section_detail: 'แบบขยายหน้าตัด',
  general_notes: 'รายการประกอบแบบโครงสร้าง',
  drawing_index: 'สารบัญแบบ / รายการแบบ',
};

const TYPE_LABEL: Record<string, string> = { FOOTING: 'ฐานราก', COLUMN: 'เสา', BEAM: 'คาน', SLAB: 'พื้น', STAIR: 'บันได' };

const num = (v?: number | null) => (v == null ? '—' : String(v));

interface Row { key: string; box?: [number, number, number, number]; tag: string; type: string; where: string; value: string; conf?: number; flag?: string }

function rowsOf(r: SheetReading): Row[] {
  const inst = r.instances.map((i, k) => ({
    key: `i${k}`, box: boxToNorm(i.box_2d), tag: i.tag, type: TYPE_LABEL[i.member_type] || i.member_type,
    where: [i.from_grid, i.to_grid].filter(Boolean).join(' – ') || 'ไม่อยู่บนกริด',
    value: i.length_m ? `ยาว ${i.length_m} ม.` : '—',
    conf: i.confidence,
  }));
  const secs = r.sections.map((s, k) => {
    const size = s.member_type === 'FOOTING'
      ? `${num(s.plan_w_m)}×${num(s.plan_l_m)} หนา ${num(s.thickness_m)}`
      : s.member_type === 'SLAB' ? `หนา ${num(s.thickness_m)}`
      : `${num(s.width_m)}×${num(s.depth_m)}`;
    const bars = [s.top_rebar, s.bottom_rebar, s.main_rebar, s.stirrup].filter(Boolean).join(' / ');
    return {
      key: `s${k}`, box: boxToNorm(s.box_2d), tag: s.tag, type: TYPE_LABEL[s.member_type] || s.member_type,
      where: s.measured_fields?.length ? 'วัดจากรูปตามมาตราส่วน' : 'ตัวเลขในแบบ',
      value: `${size} ม.${bars ? ` · ${bars}` : ''}`,
      conf: s.confidence,
      flag: s.section_conflicts?.join('; '),
    };
  });
  return [...inst, ...secs];
}

/**
 * Step 1 check: what the reader understood on every sheet — sheet type, grid, each tag it tied
 * to the grid and each section it read — drawn on the page, so a wrong reading is caught here
 * rather than as a wrong total later.
 */
export const ReadingLog: React.FC<{ data: ReadingLogData; pageUrl?: (page: number, dpi: number) => Promise<string> }> = ({ data, pageUrl }) => {
  const sheets = data.readings;
  const [page, setPage] = useState<number | undefined>(sheets[0]?.page);
  const [sel, setSel] = useState<string | null>(null);
  const r = sheets.find(s => s.page === page);
  const rows = useMemo(() => (r ? rowsOf(r) : []), [r]);
  const selRow = rows.find(x => x.key === sel);

  const overlays: Overlay[] = rows.filter(x => x.box).map(x => ({
    box: x.box!, kind: x.key === sel ? 'focus' : 'context', label: `${x.tag}${x.key.startsWith('i') && x.where !== 'ไม่อยู่บนกริด' ? ' ' + x.where : ''}`,
    onClick: () => setSel(x.key),
  }));

  if (!sheets.length) {
    return <p className="text-sm text-slate-500">ยังไม่มีผลการอ่านแบบ — ไฟล์นี้อ่านจากตาราง/ข้อความโดยตรง หรือยังไม่ได้โหลดแบบ</p>;
  }

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1.5 content-start lg:max-h-[720px] lg:overflow-y-auto lg:pr-1">
        {sheets.map(s => {
          const g = s.grid;
          return (
            <button
              key={`${s.page}:${s.sheet_type}`} // one page can hold a plan and its details
              onClick={() => { setPage(s.page); setSel(null); }}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${s.page === page ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-slate-900">น.{s.page}{s.sheet_id ? ` · ${s.sheet_id}` : ''}</span>
                <span className="text-slate-500 text-xs">{s.instances.length + s.sections.length} รายการ</span>
              </div>
              <div className="text-slate-600">{SHEET_LABEL[s.sheet_type] || s.sheet_type}{s.level ? ` · ${s.level}` : ''}</div>
              {g?.x && g?.y && (
                <div className="text-xs text-slate-500 font-mono">กริด {g.x.map(a => a.offset_m).join('/')} × {g.y.map(a => a.offset_m).join('/')}</div>
              )}
              {s.levels?.length ? <div className="text-xs text-slate-500">{s.levels.map(l => `${l.label} +${l.elevation_m.toFixed(2)}`).join(', ')}</div> : null}
            </button>
          );
        })}
        {data.emptyPages.length > 0 && (
          <p className="col-span-full text-xs text-slate-500 px-1">อ่านแล้วไม่พบข้อมูลโครงสร้าง: น.{data.emptyPages.join(', ')}</p>
        )}
      </div>

      <div className="space-y-3 min-w-0">
        {r && pageUrl && (
          <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
            <PdfViewer page={r.page} pageUrl={pageUrl} overlays={overlays} focusBox={selRow?.box} height={560} />
          </div>
        )}
        {r?.notes?.length ? <p className="text-sm text-slate-600">{r.notes.join(' · ')}</p> : null}
        {rows.length === 0 ? (
          <div className="p-6 text-center text-slate-500 bg-slate-50 rounded-lg border border-slate-200 text-sm">
            {r?.sheet_type === 'general_notes' || r?.sheet_type === 'drawing_index'
              ? 'หน้านี้เป็นรายการประกอบแบบวิศวกรรมโครงสร้าง / สารบัญแบบ (ไม่มีรูปตัดหรือผังโครงสร้างที่ต้องถอดปริมาณ — ดึงสเปกไปใช้ในการคำนวณอัตโนมัติแล้ว)'
              : 'หน้านี้ไม่มีชิ้นส่วนโครงสร้างที่ต้องถอดปริมาณ'}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr><th className="px-3 py-2">เบอร์</th><th className="px-3 py-2">ชนิด</th><th className="px-3 py-2">ตำแหน่ง / ที่มา</th><th className="px-3 py-2">ค่าที่อ่านได้</th><th className="px-3 py-2 text-right">ความมั่นใจ</th></tr>
              </thead>
              <tbody>
                {rows.map(x => (
                  <tr key={x.key} onClick={() => setSel(x.key)} className={`border-t border-slate-100 cursor-pointer ${x.key === sel ? 'bg-rose-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-1.5 font-semibold font-mono">{x.tag}</td>
                    <td className="px-3 py-1.5">{x.type}</td>
                    <td className="px-3 py-1.5 font-mono text-slate-600">{x.where}</td>
                    <td className="px-3 py-1.5">
                      {x.value}
                      {x.flag && <div className="text-amber-700 text-xs">{x.flag}</div>}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${x.conf != null && x.conf < 0.6 ? 'text-amber-700' : 'text-slate-600'}`}>{x.conf != null ? `${Math.round(x.conf * 100)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.skipped.filter(s => s.page === page).map((s, i) => (
          <p key={i} className="text-sm text-slate-600">ไม่นับ {s.tag}: {s.reason}</p>
        ))}
      </div>
    </div>
  );
};
