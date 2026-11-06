/**
 * Footing bars as separate RebarSets: one card per set, each with its own source badge, calculation
 * status and the flags that keep it (and the footing) in review. Edits go into the review draft like any
 * other field, so saving, approval binding and the history work as for the rest of the member.
 */
import React from 'react';
import { Copy, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  newRebarSetId, rebarSetsFromNote,
  type ExtractedMember, type HookEnd, type RebarSet, type RebarSetResult, type ReviewFlag,
} from '../engine/qsEngine';
import { SOURCE_BADGE } from './SectionTable';

interface Props {
  member: ExtractedMember;
  /** the sets as drafted (undefined = footing still given as a bottomRebar note) */
  sets?: RebarSet[];
  /** per-set results and flags of the last saved values */
  results?: RebarSetResult[];
  flags: ReviewFlag[];
  dirty: boolean;
  reviewer: string;
  revision?: string;
  onChange: (sets: RebarSet[] | undefined) => void;
}

const ARR: [RebarSet['arrangement'], string][] = [['UNSPECIFIED', 'ไม่ระบุ'], ['FIXED_COUNT', 'จำนวนคงที่'], ['SPACED', 'ระยะเรียง'], ['TWO_DIRECTION', '2 ทิศจากข้อความเดียว']];
const DIR: [RebarSet['direction'], string][] = [['UNSPECIFIED', 'ไม่ระบุ'], ['X', 'X (ยาวตามกว้าง)'], ['Y', 'Y (ยาวตามยาว)'], ['BOTH', 'ทั้ง 2 ทิศ']];
const HOOK: [HookEnd, string][] = [['UNSPECIFIED', 'ไม่ระบุ'], ['NONE', 'ตรง'], ['UPTURN', 'งอตั้ง'], ['HOOK_90', 'งอฉาก']];
const STATUS: Record<RebarSetResult['status'], [string, string]> = {
  CALCULATED: ['คิดได้', 'bg-emerald-50 text-emerald-800 border-emerald-200'],
  NEEDS_REVIEW: ['รอตรวจ', 'bg-amber-50 text-amber-800 border-amber-200'],
  BLOCKED: ['คิดไม่ได้', 'bg-rose-50 text-rose-800 border-rose-200'],
};
const LEVEL_TH: Record<string, string> = {
  DRAWING_VERIFIED: 'จากแบบ (DXF)', OCR_EXTRACTED: 'อ่านจากแบบ (OCR/ข้อความ)', USER_CONFIRMED: 'ผู้ตรวจยืนยัน/กรอก',
  ENGINEERING_ASSUMPTION: 'สมมติฐาน', DEFAULT_VALUE: 'ไม่พบในแบบ', UNKNOWN: 'ไม่ทราบที่มา',
};

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

export const FootingRebarSets: React.FC<Props> = ({ member, sets, results, flags, dirty, reviewer, revision, onChange }) => {
  // whatever the reviewer touches becomes their value, stamped with who and on which drawing
  const mine = (s: RebarSet, patch: Partial<RebarSet> = {}): RebarSet =>
    ({ ...s, ...patch, source: 'reviewer', confirmedBy: reviewer.trim() || undefined, confirmedAt: new Date().toISOString(), revision });
  const edit = (id: string, patch: Partial<RebarSet>) => onChange(sets!.map(s => (s.id === id ? mine(s, patch) : s)));

  if (!sets) {
    return (
      <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs flex flex-wrap items-center gap-2">
        <span className="text-slate-600">เหล็กฐานรากเป็นข้อความเดียว: <b className="font-mono">{member.bottomRebar || '—'}</b></span>
        <button type="button" onClick={() => onChange(rebarSetsFromNote(member))}
          className="ml-auto px-2 py-1 rounded-md border border-blue-300 text-blue-700 font-semibold">แยกเป็นชุดเหล็ก</button>
      </div>
    );
  }

  const input = 'w-full min-w-0 rounded-md border border-slate-200 px-1.5 py-1 font-mono';
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-2">
        <b>ชุดเหล็กฐานราก ({sets.length})</b>
        {member.bottomRebar && <span className="text-slate-500">ข้อความเดิม "{member.bottomRebar}" ไม่ใช้คำนวณแล้ว</span>}
        <button type="button" onClick={() => onChange(undefined)} className="ml-auto underline text-slate-500">ใช้ข้อความเดิม</button>
      </div>
      {dirty && <div className="text-amber-700">ยังไม่บันทึก — สถานะและน้ำหนักด้านล่างเป็นของค่าที่บันทึกล่าสุด</div>}
      {!sets.length && <div className="text-rose-700">ไม่มีชุดเหล็ก — ฐานรากนี้คิดเหล็กไม่ได้จนกว่าจะเพิ่มชุด</div>}
      {sets.map(s => {
        const r = results?.find(x => x.id === s.id);
        const own = flags.filter(f => f.field === `rebarSet:${s.id}` && f.severity !== 'info');
        const badge = SOURCE_BADGE[s.source];
        const sel = <K extends keyof RebarSet>(key: K, opts: [string, string][]) => (
          <select value={String(s[key] ?? '')} onChange={e => edit(s.id, { [key]: e.target.value } as Partial<RebarSet>)} className={input}>
            {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        );
        const field = (label: string, unit: string, el: React.ReactNode) => (
          <label className="flex flex-col gap-0.5"><span className="text-slate-500">{label} ({unit})</span>{el}</label>
        );
        const numIn = (key: 'diameterMm' | 'quantity' | 'spacingMm' | 'hookLengthM' | 'cuttingLengthM', step: string) => (
          <input type="number" step={step} value={s[key] ?? ''} onChange={e => edit(s.id, { [key]: num(e.target.value) })} className={input} />
        );
        return (
          <div key={s.id} data-set-id={s.id} className="rounded-xl border border-slate-200 p-2 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-bold">{s.id}</span>
              {badge && <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${badge.cls}`}>{badge.th}</span>}
              {r && <span className="text-[10px] text-slate-500">{LEVEL_TH[r.provenanceLevel] || r.provenanceLevel}</span>}
              {r && <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>}
              {r && r.status !== 'BLOCKED' && <span className="text-[10px] text-slate-600">{r.bars / (member.count || 1)} เส้น/ฐาน · รวม {r.bars} เส้น ({member.count || 1} ฐาน) · {r.weightKg.toFixed(2)} กก.</span>}
              {s.confirmedBy && <span className="text-[10px] text-violet-700">โดย {s.confirmedBy}</span>}
              <span className="ml-auto flex gap-1">
                {s.source !== 'reviewer' && (
                  <button type="button" onClick={() => edit(s.id, {})} title="ยืนยันว่าตรงกับแบบ (ชุดนี้เท่านั้น)"
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-violet-300 text-violet-700"><ShieldCheck className="w-3 h-3" />ยืนยันชุด</button>
                )}
                <button type="button" onClick={() => onChange([...sets, mine({ ...s, id: newRebarSetId() })])} title="ทำซ้ำ"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-300"><Copy className="w-3 h-3" />ทำซ้ำ</button>
                <button type="button" onClick={() => onChange(sets.filter(x => x.id !== s.id))} title="ลบ"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-rose-300 text-rose-700"><Trash2 className="w-3 h-3" />ลบ</button>
              </span>
            </div>
            {s.sourceText && <div className="text-slate-500">ข้อความในแบบ: <span className="font-mono">{s.sourceText}</span></div>}
            <div className="grid grid-cols-3 gap-1.5">
              {field('ชนิด', '—', sel('barType', [['DB', 'DB'], ['RB', 'RB']]))}
              {field('ขนาด', 'มม.', numIn('diameterMm', '1'))}
              {field('การจัด', '—', sel('arrangement', ARR))}
              {field('จำนวน', 'เส้น/ทิศ', numIn('quantity', '1'))}
              {field('ระยะเรียง', 'มม.', numIn('spacingMm', '10'))}
              {field('ทิศ', '—', sel('direction', DIR))}
              {field('ชั้น', '—', sel('layer', [['BOTTOM', 'ล่าง'], ['TOP', 'บน']]))}
              {field('ปลายต้น', '—', sel('startHook', HOOK))}
              {field('ปลายท้าย', '—', sel('endHook', HOOK))}
              {field('ความยาวงอ', 'ม./ปลาย', numIn('hookLengthM', '0.01'))}
              {field('ความยาวตัด', 'ม.', numIn('cuttingLengthM', '0.01'))}
            </div>
            {own.length > 0 && (
              <ul className="space-y-0.5">
                {own.map((f, i) => <li key={i} className={f.severity === 'block' ? 'text-rose-700' : 'text-amber-700'}>{f.message}</li>)}
              </ul>
            )}
          </div>
        );
      })}
      <button type="button"
        onClick={() => onChange([...sets, mine({ id: newRebarSetId(), arrangement: 'UNSPECIFIED', direction: 'UNSPECIFIED', layer: 'BOTTOM', startHook: 'UNSPECIFIED', endHook: 'UNSPECIFIED', source: 'reviewer' })])}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-blue-300 text-blue-700 font-semibold"><Plus className="w-3 h-3" />เพิ่มชุดเหล็ก</button>
    </div>
  );
};
