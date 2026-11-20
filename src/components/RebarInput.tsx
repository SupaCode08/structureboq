import React, { useMemo, useState } from 'react';
import { Check, AlertCircle, ChevronDown } from 'lucide-react';
import { parseBarGroups, validateSpacedBar, REBAR_KG_PER_M } from '../engine/qsEngine';
import type { RebarKind } from './reviewFields';

interface RebarInputProps {
  value: string;
  onChange: (next: string) => void;
  rebarKind?: RebarKind;
  placeholder?: string;
  className?: string;
}

const PRESETS: Record<RebarKind, string[]> = {
  count: ['2-DB12', '2-DB16', '3-DB16', '2-DB20', '4-DB12', '4-DB16', '2-DB16+2-DB12'],
  stirrup: ['RB6@0.15', 'RB6@0.20', 'RB6@0.10/0.20', 'RB9@0.15', 'RB9@0.10/0.20', '2-RB6@0.10/0.20'],
  mesh: ['5+5-DB12', '6+6-DB12', '7+7-DB12', 'DB12@0.15', 'DB12@0.20', 'DB16@0.15'],
  spaced: ['RB6@0.20', 'RB9@0.15', 'RB9@0.20', 'DB12@0.15', 'DB12@0.20'],
};

export interface RebarLiveCheck {
  state: 'empty' | 'ok' | 'error';
  summary?: string;
}

export function checkRebarNotation(raw: string, kind: RebarKind = 'count'): RebarLiveCheck {
  const s = raw.trim();
  if (!s) return { state: 'empty' };

  if (kind === 'stirrup' || kind === 'spaced' || s.includes('@')) {
    const v = validateSpacedBar(s);
    if (!v) return { state: 'error', summary: 'ระบุเช่น RB6@0.15 หรือ RB6@0.10/0.20' };
    if (!v.isValid) return { state: 'error', summary: v.error || 'ระยะห่างไม่ถูกต้อง' };
    const wt = REBAR_KG_PER_M[v.bar] ?? 0.222;
    const zoneTxt = v.midSpacing ? `@${v.spacing}/${v.midSpacing}ม. (2 โซน)` : `@${v.spacing}ม.`;
    const legTxt = v.legs && v.legs > 1 ? `${v.legs} ปลอก ` : '';
    return { state: 'ok', summary: `${legTxt}${v.bar}${zoneTxt} · ${wt} กก./ม.` };
  }

  const groups = parseBarGroups(s);
  if (groups.length > 0) {
    const totalKgM = groups.reduce((acc, g) => acc + g.n * (REBAR_KG_PER_M[g.bar] ?? 0.888), 0);
    const label = groups.map(g => `${g.n}-${g.bar}`).join(' + ');
    return { state: 'ok', summary: `${label} · ${totalKgM.toFixed(2)} กก./ม.` };
  }

  return { state: 'error', summary: kind === 'mesh' ? 'เช่น 5+5-DB12 หรือ DB12@0.15' : 'เช่น 2-DB16 หรือ 2-DB16+1-DB12' };
}

export const RebarInput: React.FC<RebarInputProps> = ({
  value,
  onChange,
  rebarKind = 'count',
  placeholder,
  className = '',
}) => {
  const [openPresets, setOpenPresets] = useState(false);
  const check = useMemo(() => checkRebarNotation(value, rebarKind), [value, rebarKind]);
  const presets = PRESETS[rebarKind] || PRESETS.count;

  const borderCls =
    check.state === 'error'
      ? 'border-rose-400 bg-rose-50/40 focus:border-rose-500'
      : 'border-slate-200 bg-white hover:border-slate-300 focus:border-slate-900';

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={`w-full h-10 rounded-lg border px-3 text-sm font-mono text-slate-900 outline-none transition-colors ${borderCls}`}
        />
        <button
          type="button"
          title="เลือกค่าสำเร็จรูป"
          aria-label="เลือกค่าสำเร็จรูป"
          onClick={() => setOpenPresets(v => !v)}
          className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-500 shrink-0 transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {check.state === 'ok' && check.summary && (
        <div className="mt-1 flex items-center gap-1 text-xs text-emerald-700 leading-tight">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{check.summary}</span>
        </div>
      )}
      {check.state === 'error' && check.summary && (
        <div className="mt-1 flex items-center gap-1 text-xs text-rose-600 leading-tight">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{check.summary}</span>
        </div>
      )}

      {openPresets && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-60 rounded-xl border border-slate-200 bg-white shadow-lg p-2 flex flex-wrap gap-1.5">
          {presets.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => {
                onChange(p);
                setOpenPresets(false);
              }}
              className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-900 hover:text-white text-xs font-mono text-slate-700 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
