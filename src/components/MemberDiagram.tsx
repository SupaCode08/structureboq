import React from 'react';
import { CalculatedQuantity, MemberType } from '../engine/qsEngine';
import { Language } from '../utils/translations';

interface MemberDiagramProps {
  item: CalculatedQuantity;
  lang?: Language;
  theme?: 'light' | 'dark';
}

export const MemberDiagram: React.FC<MemberDiagramProps> = ({ item, lang = 'th', theme = 'light' }) => {
  const isLight = theme === 'light';
  const isBeam = item.memberType === 'BEAM';
  const widthM = Math.max(0.05, item.widthM);
  const depthM = Math.max(0.05, item.depthM);
  const lengthGrossM = Math.max(0.1, item.lengthGrossM);
  const lengthNetM = Math.max(0.1, item.lengthNetM);
  const deductionM = item.deductionM;

  // Aspect ratio for cross section box
  const sectionAspect = depthM / widthM;
  let boxW = 90;
  let boxH = 90 * sectionAspect;
  if (boxH > 140) {
    boxH = 140;
    boxW = boxH / sectionAspect;
  }
  if (boxW > 140) {
    boxW = 140;
    boxH = boxW * sectionAspect;
  }
  boxW = Math.max(40, boxW);
  boxH = Math.max(40, boxH);

  const secX = (180 - boxW) / 2;
  const secY = (180 - boxH) / 2;
  const cover = 8;

  return (
    <div className={`rounded-xl p-4 border transition-colors ${
      isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'
    }`}>
      <div className={`flex items-center justify-between mb-3 border-b pb-2 ${
        isLight ? 'border-slate-200' : 'border-slate-800/80'
      }`}>
        <span className={`text-xs font-bold uppercase tracking-wider ${
          isLight ? 'text-slate-800' : 'text-slate-300'
        }`}>
          {lang === 'th' ? 'แบบจำลองภาพตัดขวางและรูปด้านโครงสร้าง' : 'Structural Section & Elevation Schematic'}
        </span>
        <span className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
          {isBeam ? (lang === 'th' ? 'หน้าตัดคาน ค.ส.ล.' : 'RC Beam Cross-Section') : (lang === 'th' ? 'หน้าตัดเสา ค.ส.ล.' : 'RC Column Cross-Section')}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 1. Cross Section Diagram */}
        <div className={`flex flex-col items-center p-3 rounded-xl border ${
          isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-slate-900/60 border-slate-800/80'
        }`}>
          <span className={`text-[11px] font-bold mb-1 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
            {lang === 'th' ? '1. รูปตัดขวาง (Cross-Section b × d)' : '1. Cross-Section (b × d)'}
          </span>
          <svg viewBox="0 0 180 180" className="w-40 h-40">
            <defs>
              <pattern id="diagGrid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke={isLight ? '#e2e8f0' : '#1e293b'} strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="180" height="180" fill="url(#diagGrid)" rx="6" />

            {/* Concrete Hatch / Body */}
            <rect
              x={secX}
              y={secY}
              width={boxW}
              height={boxH}
              fill={isLight ? '#E2E8F0' : '#334155'}
              stroke={isLight ? '#64748B' : '#94a3b8'}
              strokeWidth="1.5"
              rx="2"
            />

            {/* Stirrup Rebar */}
            <rect
              x={secX + cover}
              y={secY + cover}
              width={Math.max(10, boxW - cover * 2)}
              height={Math.max(10, boxH - cover * 2)}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="2,1"
              rx="3"
            />

            {/* Top Main Rebars */}
            <circle cx={secX + cover + 4} cy={secY + cover + 4} r="3.5" fill="#38bdf8" stroke="#0284c7" strokeWidth="0.8" />
            <circle cx={secX + boxW - cover - 4} cy={secY + cover + 4} r="3.5" fill="#38bdf8" stroke="#0284c7" strokeWidth="0.8" />

            {/* Bottom Main Rebars */}
            <circle cx={secX + cover + 4} cy={secY + boxH - cover - 4} r="3.5" fill="#10b981" stroke="#059669" strokeWidth="0.8" />
            <circle cx={secX + boxW - cover - 4} cy={secY + boxH - cover - 4} r="3.5" fill="#10b981" stroke="#059669" strokeWidth="0.8" />

            {/* Width dimension line */}
            <line x1={secX} y1={secY + boxH + 12} x2={secX + boxW} y2={secY + boxH + 12} stroke={isLight ? '#475569' : '#cbd5e1'} strokeWidth="1" />
            <line x1={secX} y1={secY + boxH + 8} x2={secX} y2={secY + boxH + 16} stroke={isLight ? '#475569' : '#cbd5e1'} strokeWidth="1" />
            <line x1={secX + boxW} y1={secY + boxH + 8} x2={secX + boxW} y2={secY + boxH + 16} stroke={isLight ? '#475569' : '#cbd5e1'} strokeWidth="1" />
            <text x="90" y={secY + boxH + 24} textAnchor="middle" fill={isLight ? '#334155' : '#cbd5e1'} fontSize="9" fontFamily="monospace" fontWeight="bold">
              b = {item.widthM.toFixed(3)} m
            </text>

            {/* Depth dimension line */}
            <line x1={secX - 10} y1={secY} x2={secX - 10} y2={secY + boxH} stroke={isLight ? '#475569' : '#cbd5e1'} strokeWidth="1" />
            <line x1={secX - 14} y1={secY} x2={secX - 6} y2={secY} stroke={isLight ? '#475569' : '#cbd5e1'} strokeWidth="1" />
            <line x1={secX - 14} y1={secY + boxH} x2={secX - 6} y2={secY + boxH} stroke={isLight ? '#475569' : '#cbd5e1'} strokeWidth="1" />
            <text x={secX - 18} y={secY + boxH / 2 + 3} textAnchor="end" fill={isLight ? '#334155' : '#cbd5e1'} fontSize="9" fontFamily="monospace" fontWeight="bold">
              d = {item.depthM.toFixed(3)} m
            </text>
          </svg>

          <div className="mt-2 text-[10px] space-y-0.5 text-center">
            <span className="text-amber-600 dark:text-amber-400 font-bold block">
              {lang === 'th' ? 'ระยะหุ้มคอนกรีต (Covering) 3.5 ซม.' : 'Concrete Cover: 35 mm'}
            </span>
            <div className="flex justify-center space-x-2 text-[9px] font-semibold">
              <span className="text-sky-600 dark:text-sky-300">● {lang === 'th' ? 'เหล็กบน' : 'Top Bar'}</span>
              <span className="text-emerald-600 dark:text-emerald-300">● {lang === 'th' ? 'เหล็กล่าง' : 'Btm Bar'}</span>
              <span className="text-amber-600 dark:text-amber-300">■ {lang === 'th' ? 'ปลอก' : 'Stirrup'}</span>
            </div>
          </div>
        </div>

        {/* 2. Longitudinal Elevation with Support Deductions */}
        <div className={`flex flex-col items-center p-3 rounded-xl border ${
          isLight ? 'bg-white border-slate-200 shadow-2xs' : 'bg-slate-900/60 border-slate-800/80'
        }`}>
          <span className={`text-[11px] font-bold mb-1 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
            {lang === 'th' ? '2. รูปด้านตามยาวและการหักเสารองรับ (Elevation & Deductions)' : '2. Longitudinal Span & Deductions'}
          </span>
          <svg viewBox="0 0 240 160" className="w-52 h-40">
            {/* Left Column Pier */}
            <rect x="20" y="30" width="28" height="90" fill={isLight ? '#F1F5F9' : '#1e293b'} stroke={isLight ? '#94A3B8' : '#64748b'} strokeWidth="1" rx="2" />
            <text x="34" y="130" textAnchor="middle" fill={isLight ? '#475569' : '#94a3b8'} fontSize="8" fontFamily="sans-serif" fontWeight="bold">
              {lang === 'th' ? 'เสาซ้าย' : 'Col 1'}
            </text>

            {/* Right Column Pier */}
            <rect x="192" y="30" width="28" height="90" fill={isLight ? '#F1F5F9' : '#1e293b'} stroke={isLight ? '#94A3B8' : '#64748b'} strokeWidth="1" rx="2" />
            <text x="206" y="130" textAnchor="middle" fill={isLight ? '#475569' : '#94a3b8'} fontSize="8" fontFamily="sans-serif" fontWeight="bold">
              {lang === 'th' ? 'เสาขวา' : 'Col 2'}
            </text>

            {/* Beam Body */}
            <rect x="48" y="45" width="144" height="35" fill={isLight ? '#E0F2FE' : '#334155'} stroke={isLight ? '#0284C7' : '#38bdf8'} strokeWidth="1.5" rx="2" />

            {/* Deduction Zones */}
            {deductionM > 0 ? (
              <>
                <rect x="34" y="45" width="14" height="35" fill="#f59e0b" fillOpacity={isLight ? "0.3" : "0.4"} stroke="#f59e0b" strokeWidth="1" strokeDasharray="2,2" />
                <rect x="192" y="45" width="14" height="35" fill="#f59e0b" fillOpacity={isLight ? "0.3" : "0.4"} stroke="#f59e0b" strokeWidth="1" strokeDasharray="2,2" />
                <text x="120" y="40" textAnchor="middle" fill="#d97706" fontSize="8" fontFamily="monospace" fontWeight="bold">
                  {lang === 'th' ? `หักรอยต่อเสา -${deductionM.toFixed(3)} ม.` : `Deduction: -${deductionM.toFixed(3)} m`}
                </text>
              </>
            ) : (
              <text x="120" y="40" textAnchor="middle" fill="#059669" fontSize="8" fontFamily="monospace" fontWeight="bold">
                {lang === 'th' ? 'ระยะเคลียร์สุทธิ (Clear Span)' : 'Clear Span Measurement'}
              </text>
            )}

            {/* Gross span dimension line */}
            <line x1="34" y1="95" x2="206" y2="95" stroke={isLight ? '#64748B' : '#94a3b8'} strokeWidth="1" />
            <line x1="34" y1="90" x2="34" y2="100" stroke={isLight ? '#64748B' : '#94a3b8'} strokeWidth="1" />
            <line x1="206" y1="90" x2="206" y2="100" stroke={isLight ? '#64748B' : '#94a3b8'} strokeWidth="1" />
            <text x="120" y="105" textAnchor="middle" fill={isLight ? '#475569' : '#94a3b8'} fontSize="8" fontFamily="monospace" fontWeight="bold">
              {lang === 'th' ? `ระยะรวม c-c = ${lengthGrossM.toFixed(3)} ม.` : `Gross c-c = ${lengthGrossM.toFixed(3)} m`}
            </text>

            {/* Net span dimension line */}
            <line x1="48" y1="115" x2="192" y2="115" stroke="#10b981" strokeWidth="1.2" />
            <line x1="48" y1="110" x2="48" y2="120" stroke="#10b981" strokeWidth="1.2" />
            <line x1="192" y1="110" x2="192" y2="120" stroke="#10b981" strokeWidth="1.2" />
            <text x="120" y="125" textAnchor="middle" fill="#059669" fontSize="8" fontFamily="monospace" fontWeight="black">
              {lang === 'th' ? `ระยะสุทธิ L_net = ${lengthNetM.toFixed(3)} ม.` : `Net Span = ${lengthNetM.toFixed(3)} m`}
            </text>
          </svg>

          <div className="mt-2 text-[10px] space-y-0.5 text-center">
            <span className="text-emerald-700 dark:text-emerald-400 font-bold block">
              {lang === 'th'
                ? `ปริมาตรคอนกรีตสุทธิ = ${item.volumeNetM3.toFixed(4)} ลบ.ม.`
                : `Net Concrete Volume = ${item.volumeNetM3.toFixed(4)} m³`}
            </span>
            <span className={`block text-[9px] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              {lang === 'th'
                ? `ไม้แบบ 2 ข้าง + ท้องคาน = ${item.formworkNetM2.toFixed(2)} ตร.ม.`
                : `Formwork Area = ${item.formworkNetM2.toFixed(2)} m²`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
