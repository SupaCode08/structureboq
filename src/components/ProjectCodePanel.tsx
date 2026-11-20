import React, { useMemo, useState } from 'react';
import { BookOpen, AlertTriangle, CheckCircle2, FileText } from 'lucide-react';
import type { ExtractedMember } from '../engine/qsEngine';
import {
  extractProjectCodeDictionary,
  applyProjectCodeOverride,
  type ProjectCodeDictionary,
  type ProjectCodeTarget,
} from '../pdf/projectCodeDict';
import type { PageOcr } from '../pdf/types';

interface ProjectCodePanelProps {
  members: ExtractedMember[];
  pages?: PageOcr[];
  reviewer?: string;
  onUpdateMembers: (updates: { index: number; patch: Partial<ExtractedMember> }[]) => void;
  onContinue?: () => void;
}

const TARGET_OPTIONS: { value: ProjectCodeTarget; label: string }[] = [
  { value: 'FOOTING', label: 'ฐานราก (Footing)' },
  { value: 'COLUMN', label: 'เสา (Column)' },
  { value: 'BEAM', label: 'คาน (Beam)' },
  { value: 'SLAB', label: 'พื้น (Slab)' },
  { value: 'STAIR', label: 'บันได (Stair)' },
  { value: 'WALL', label: 'ผนัง (Wall)' },
  { value: 'STEEL_SKIP', label: 'โครงสร้างเหล็ก / ไม่คิด ค.ส.ล.' },
  { value: 'UNKNOWN', label: 'ยังไม่ระบุ' },
];

const SOURCE_TH: Record<string, { text: string; cls: string }> = {
  legend: { text: 'จากสัญลักษณ์ในแบบ', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  schedule: { text: 'จากตารางหน้าตัด', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  plan: { text: 'จากผังโครงสร้าง', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  user: { text: 'ผู้ตรวจกำหนด', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
};

export const ProjectCodePanel: React.FC<ProjectCodePanelProps> = ({
  members,
  pages = [],
  reviewer,
  onUpdateMembers,
  onContinue,
}) => {
  const dict: ProjectCodeDictionary = useMemo(
    () => extractProjectCodeDictionary(pages, members),
    [pages, members]
  );
  const [remapped, setRemapped] = useState<Record<string, ProjectCodeTarget>>({});

  const uncertainCount = dict.memberCodes.filter(c => c.confidence === 'low' || c.memberType === 'UNKNOWN').length;

  const handleChangeType = (prefix: string, nextType: ProjectCodeTarget) => {
    setRemapped(prev => ({ ...prev, [prefix]: nextType }));
    const updates = applyProjectCodeOverride(members, prefix, nextType, reviewer);
    if (updates.length > 0) {
      onUpdateMembers(updates);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">พจนานุกรมรหัสของโครงการ (Project Code Dictionary)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              ระบบรวบรวมรหัสแผ่นแบบและรหัสชิ้นส่วนที่พบในโครงการนี้ — หากโครงการใช้รหัสเฉพาะ (เช่น PB, ค., ฐ.) สามารถเปลี่ยนประเภทที่นี่ครั้งเดียวเพื่ออัปเดตทุกชิ้น
            </p>
          </div>
        </div>
        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
          >
            ยืนยันรหัส → ไปขั้นที่ 2 (ตารางหน้าตัด)
          </button>
        )}
      </div>

      {uncertainCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>พบรหัสเฉพาะโครงการที่ควรตรวจสอบ {uncertainCount} รหัส (ไฮไลต์สีเหลืองด้านล่าง)</span>
        </div>
      )}

      {dict.sheetCodes.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-2">
            <FileText className="w-3.5 h-3.5 text-indigo-500" />
            <span>รหัสแผ่นแบบที่พบในสารบัญ ({dict.sheetCodes.length} แผ่น)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dict.sheetCodes.map(s => (
              <span
                key={s.code}
                title={s.title || s.code}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-mono ${
                  s.discipline === 'STRUCTURAL'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                }`}
              >
                <span>{s.code}</span>
                {s.title && <span className="font-sans text-[10px] text-slate-500 truncate max-w-[150px]">{s.title}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-semibold">รหัสนำหน้า</th>
                <th className="px-3 py-2 font-semibold">ตัวอย่าง Tag (จำนวน)</th>
                <th className="px-3 py-2 font-semibold">คำอธิบาย / ที่มา</th>
                <th className="px-3 py-2 font-semibold">ประเภทชิ้นส่วนใน BOQ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dict.memberCodes.map(entry => {
                const currentType = remapped[entry.prefix] ?? entry.memberType;
                const isLow = entry.confidence === 'low' && !remapped[entry.prefix];
                const badge = remapped[entry.prefix] ? SOURCE_TH.user : SOURCE_TH[entry.source];
                return (
                  <tr key={entry.prefix} className={isLow ? 'bg-amber-50/50' : 'hover:bg-slate-50/70'}>
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-900">
                      <span className="inline-flex items-center gap-1">
                        {isLow ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        )}
                        {entry.prefix}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {entry.sampleTags.map(t => (
                          <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[11px] text-slate-700">
                            {t}
                          </span>
                        ))}
                        <span className="text-[11px] text-slate-400 ml-1">({entry.count} ชิ้น)</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-slate-800">{entry.labelTh}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className={`inline-block rounded border px-1.5 py-0 text-[10px] ${badge.cls}`}>
                          {badge.text}
                        </span>
                        {entry.sourcePage && (
                          <span className="text-[10px] text-slate-400">หน้า {entry.sourcePage}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={currentType}
                        onChange={e => handleChangeType(entry.prefix, e.target.value as ProjectCodeTarget)}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-indigo-500 outline-none"
                      >
                        {TARGET_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
              {dict.memberCodes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    ยังไม่มีรายการชิ้นส่วนในโครงการนี้
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
