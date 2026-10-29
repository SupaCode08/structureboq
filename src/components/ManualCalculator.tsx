import React, { useState } from 'react';
import { ExtractedMember, calculateMember, CalculatedQuantity, MemberType } from '../engine/qsEngine';
import { MemberDiagram } from './MemberDiagram';
import { Language, translations, translateMessage } from '../utils/translations';
import { Calculator, PlusCircle, CheckCircle2, AlertTriangle, XCircle, Sliders, HardHat, FileSpreadsheet } from 'lucide-react';

interface ManualCalculatorProps {
  onAddMemberToProject: (member: ExtractedMember) => void;
  lang: Language;
}

export const ManualCalculator: React.FC<ManualCalculatorProps> = ({ onAddMemberToProject, lang }) => {
  const t = translations[lang];

  // Form State
  const [memberType, setMemberType] = useState<MemberType>('BEAM');
  const [tag, setTag] = useState('B-TEST');
  const [gridLocation, setGridLocation] = useState('Grid 1-2 / A');
  const [level, setLevel] = useState('Story 1');
  const [unit, setUnit] = useState<'m' | 'cm' | 'mm'>('m');
  const [width, setWidth] = useState<number>(0.20);
  const [depth, setDepth] = useState<number>(0.40);
  const [length, setLength] = useState<number>(4.00);
  const [count, setCount] = useState<number>(1);
  const [isClearSpan, setIsClearSpan] = useState<boolean>(false);
  const [supportColW1, setSupportColW1] = useState<number>(0.25);
  const [supportColW2, setSupportColW2] = useState<number>(0.25);
  const [topRebar, setTopRebar] = useState('2-DB16');
  const [bottomRebar, setBottomRebar] = useState('2-DB16');
  const [stirrupRebar, setStirrupRebar] = useState('RB6@0.15m');

  // Compute on the fly
  const currentMember: ExtractedMember = {
    tag: tag.trim() || 'B1',
    memberType,
    width,
    depth,
    length,
    count,
    unit,
    gridLocation: gridLocation.trim() || 'Grid 1-2 / A',
    level: level.trim() || 'Story 1',
    sourceFile: lang === 'th' ? 'การป้อนข้อมูลด้วยตนเอง' : 'Manual QS Input',
    sourceSheetOrLayer: 'Sandbox',
    rawDimensionStr: `${count}-${tag} (${width}x${depth}) L=${length}${unit}`,
    supportColW1: isClearSpan ? 0 : supportColW1,
    supportColW2: isClearSpan ? 0 : supportColW2,
    isClearSpan,
    topRebar,
    bottomRebar,
    stirrupRebar,
  };

  const calculated: CalculatedQuantity = calculateMember(currentMember, 999);

  // Quick Presets
  const applyPreset = (presetType: 'B1' | 'B2' | 'TG1' | 'C1' | 'ERR_ZERO') => {
    if (presetType === 'B1') {
      setMemberType('BEAM');
      setTag('B1');
      setGridLocation('Grid 1-2 / A');
      setUnit('m');
      setWidth(0.20);
      setDepth(0.40);
      setLength(4.00);
      setCount(1);
      setIsClearSpan(false);
      setSupportColW1(0.25);
      setSupportColW2(0.25);
      setTopRebar('2-DB16');
      setBottomRebar('2-DB16');
      setStirrupRebar('RB6@0.15m');
    } else if (presetType === 'B2') {
      setMemberType('BEAM');
      setTag('B2');
      setGridLocation('Grid 2-3 / B');
      setUnit('m');
      setWidth(0.25);
      setDepth(0.50);
      setLength(5.00);
      setCount(2);
      setIsClearSpan(false);
      setSupportColW1(0.30);
      setSupportColW2(0.30);
      setTopRebar('2-DB20');
      setBottomRebar('3-DB20');
      setStirrupRebar('RB9@0.15m');
    } else if (presetType === 'TG1') {
      setMemberType('BEAM');
      setTag('TG1');
      setGridLocation('Grid B / 1-3');
      setUnit('m');
      setWidth(0.40);
      setDepth(1.20);
      setLength(10.00);
      setCount(1);
      setIsClearSpan(false);
      setSupportColW1(0.50);
      setSupportColW2(0.50);
      setTopRebar('4-DB25');
      setBottomRebar('6-DB25');
      setStirrupRebar('DB12@0.10m');
    } else if (presetType === 'C1') {
      setMemberType('COLUMN');
      setTag('C1');
      setGridLocation('Grid 1 / A');
      setUnit('m');
      setWidth(0.30);
      setDepth(0.30);
      setLength(3.50);
      setCount(4);
      setIsClearSpan(true);
      setTopRebar('4-DB16');
      setBottomRebar('4-DB16');
      setStirrupRebar('RB6@0.15m');
    } else if (presetType === 'ERR_ZERO') {
      setMemberType('BEAM');
      setTag('B-ZERO');
      setGridLocation('Grid X');
      setWidth(0);
      setDepth(0.40);
      setLength(4.00);
    }
  };

  const handleAdd = () => {
    onAddMemberToProject(currentMember);
  };

  return (
    <div className="flip-light space-y-6 animate-in fade-in duration-200">
      {/* Sandbox Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Calculator className="w-5 h-5 text-amber-400" />
              <h2 className="font-bold text-base text-white">{t.sandboxTitle}</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              {t.sandboxSub}
            </p>
          </div>

          {/* Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 mr-1">{lang === 'th' ? 'พรีเซ็ต:' : 'Presets:'}</span>
            <button
              onClick={() => applyPreset('B1')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700"
            >
              B1 (0.20×0.40)
            </button>
            <button
              onClick={() => applyPreset('B2')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700"
            >
              B2 (0.25×0.50)
            </button>
            <button
              onClick={() => applyPreset('TG1')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 border border-amber-500/30"
            >
              TG1
            </button>
            <button
              onClick={() => applyPreset('C1')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 border border-cyan-500/30"
            >
              C1 (เสา 0.30×0.30)
            </button>
            <button
              onClick={() => applyPreset('ERR_ZERO')}
              className="px-2.5 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 text-xs font-semibold text-rose-300 border border-rose-500/40"
            >
              ค่าผิด (ขนาด 0)
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Form Left, Real-time Result Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form: 7 cols */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="font-semibold text-sm text-slate-200 flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-amber-400" />
              <span>{lang === 'th' ? 'กำหนดพารามิเตอร์องค์ประกอบโครงสร้าง' : 'Member Parameters Input'}</span>
            </h3>
            {/* Member Type Toggle */}
            <div className="flex flex-wrap bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs gap-1">
              {(['BEAM', 'COLUMN', 'FOOTING', 'SLAB', 'STAIR', 'WALL', 'DOOR', 'WINDOW', 'FINISH'] as MemberType[]).map(t => {
                const labels: Record<MemberType, string> = {
                  BEAM: 'คาน', COLUMN: 'เสา', FOOTING: 'ฐานราก', SLAB: 'พื้น', STAIR: 'บันได',
                  WALL: 'ผนัง', DOOR: 'ประตู', WINDOW: 'หน้าต่าง', FINISH: 'ผิวตกแต่ง'
                };
                return (
                  <button
                    key={t}
                    onClick={() => setMemberType(t)}
                    className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                      memberType === t
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {labels[t]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Tag */}
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">{t.tagLabel}</label>
              <input
                type="text"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-amber-500"
                placeholder="B1, C1..."
              />
            </div>

            {/* Grid Location */}
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">{t.gridLabel}</label>
              <input
                type="text"
                value={gridLocation}
                onChange={(e) => setGridLocation(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                placeholder="Grid 1-2 / A"
              />
            </div>

            {/* Level */}
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">{t.levelLabel}</label>
              <input
                type="text"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                placeholder="Story 1"
              />
            </div>
          </div>

          {/* Dimensions & Unit */}
          <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                {lang === 'th' ? 'มิติหน้าตัดและความยาว' : 'Section Dimensions & Length'}
              </span>
              {/* Unit selector */}
              <div className="flex items-center space-x-1 text-xs">
                <span className="text-slate-400 mr-1">{t.unitSelectLabel}:</span>
                {(['m', 'cm', 'mm'] as const).map((u) => (
                  <button
                    key={u}
                    onClick={() => setUnit(u)}
                    className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                      unit === u
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Width */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {t.widthLabel} ({unit})
                </label>
                <input
                  type="number"
                  step="any"
                  value={width}
                  onChange={(e) => setWidth(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Depth */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {t.depthLabel} ({unit})
                </label>
                <input
                  type="number"
                  step="any"
                  value={depth}
                  onChange={(e) => setDepth(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Gross Span */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">
                  {t.spanLabel} ({unit})
                </label>
                <input
                  type="number"
                  step="any"
                  value={length}
                  onChange={(e) => setLength(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Count */}
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{t.countLabel}</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Support Columns & Deductions */}
          {memberType === 'BEAM' && (
            <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  {lang === 'th' ? 'การคำนวณการหักจุดตัดเสารองรับ' : 'Support Column Deductions'}
                </span>
                <label className="flex items-center space-x-1.5 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={isClearSpan}
                    onChange={(e) => setIsClearSpan(e.target.checked)}
                    className="rounded border-slate-700 text-amber-500 focus:ring-0"
                  />
                  <span>{t.isClearSpanLabel}</span>
                </label>
              </div>

              {!isClearSpan && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      {t.colW1Label} (ม.)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      value={supportColW1}
                      onChange={(e) => setSupportColW1(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      {t.colW2Label} (ม.)
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      value={supportColW2}
                      onChange={(e) => setSupportColW2(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reinforcement Details */}
          <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800/80 space-y-3">
            <span className="text-xs font-semibold text-slate-300 block">
              {lang === 'th' ? 'ข้อกำหนดเหล็กเสริมโครงสร้าง' : 'Reinforcement Specifications'}
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{t.rebarTopLabel}</label>
                <input
                  type="text"
                  value={topRebar}
                  onChange={(e) => setTopRebar(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-sky-300 focus:outline-none focus:border-amber-500"
                  placeholder="2-DB16"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{t.rebarBtmLabel}</label>
                <input
                  type="text"
                  value={bottomRebar}
                  onChange={(e) => setBottomRebar(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-emerald-300 focus:outline-none focus:border-amber-500"
                  placeholder="2-DB16"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">{t.rebarStirrupLabel}</label>
                <input
                  type="text"
                  value={stirrupRebar}
                  onChange={(e) => setStirrupRebar(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-500"
                  placeholder="RB6@0.15m"
                />
              </div>
            </div>
          </div>

          {/* Action button */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <span className="text-[11px] text-slate-400">
              {t.calculatedNotice}
            </span>
            <button
              onClick={handleAdd}
              disabled={calculated.status === 'REJECTED'}
              className={`w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-2 transition-all shadow-md ${
                calculated.status !== 'REJECTED'
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 active:scale-95'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              <span>{t.btnAddToProject}</span>
            </button>
          </div>
        </div>

        {/* Right Output: 5 cols */}
        <div className="lg:col-span-5 space-y-4">
          {/* Status & KPI Cards */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-slate-200">
                {t.sandboxResultTitle}
              </h3>
              {/* Badge */}
              {calculated.status === 'AUTO_RELEASE' && (
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t.autoRelease}</span>
                </span>
              )}
              {calculated.status === 'NEEDS_REVIEW' && (
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t.needsReview}</span>
                </span>
              )}
              {calculated.status === 'REJECTED' && (
                <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>{t.rejected}</span>
                </span>
              )}
            </div>

            {/* Diagnostic Warnings */}
            {calculated.rejectionReasons.length > 0 && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-300 space-y-1">
                <div className="font-bold flex items-center space-x-1">
                  <XCircle className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'สาเหตุการปฏิเสธการคำนวณ:' : 'Rejection Reasons:'}</span>
                </div>
                {calculated.rejectionReasons.map((r, i) => (
                  <p key={i} className="pl-4">• {translateMessage(r, lang)}</p>
                ))}
              </div>
            )}

            {calculated.reviewWarnings.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-300 space-y-1">
                <div className="font-bold flex items-center space-x-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>{lang === 'th' ? 'ข้อสังเกตเชิงวิศวกรรม:' : 'Advisory Notes:'}</span>
                </div>
                {calculated.reviewWarnings.map((w, i) => (
                  <p key={i} className="pl-4">• {translateMessage(w, lang)}</p>
                ))}
              </div>
            )}

            {/* Output Metric Cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Concrete Volume */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">{t.netConcrete}</span>
                <div className="mt-1 flex items-baseline space-x-1">
                  <span className="text-xl font-black text-emerald-400 font-mono">
                    {calculated.volumeNetM3.toFixed(4)}
                  </span>
                  <span className="text-xs text-slate-400">{t.unitM3}</span>
                </div>
              </div>

              {/* Formwork */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">{t.formworkArea}</span>
                <div className="mt-1 flex items-baseline space-x-1">
                  <span className="text-xl font-black text-amber-400 font-mono">
                    {calculated.formworkNetM2.toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400">{t.unitM2}</span>
                </div>
              </div>

              {/* Rebar Weight */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">
                  {lang === 'th' ? 'เหล็กเสริมรวม' : 'Total Rebar'}
                </span>
                <div className="mt-1 flex items-baseline space-x-1">
                  <span className="text-xl font-black text-sky-400 font-mono">
                    {(calculated.rebarWeightKg || 0).toFixed(2)}
                  </span>
                  <span className="text-xs text-slate-400">{t.unitKg}</span>
                </div>
              </div>

              {/* Estimated Por Ror 4 Cost */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase block">
                  {lang === 'th' ? 'ประมาณการ ปร.4' : 'Est. Por Ror 4'}
                </span>
                <div className="mt-1 flex items-baseline space-x-1">
                  <span className="text-xl font-black text-white font-mono">
                    {(calculated.totalCostThb || 0).toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-400">{t.unitBaht}</span>
                </div>
              </div>
            </div>

            {/* Formula display */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono text-amber-300">
              <span className="text-[10px] text-slate-500 font-sans block mb-1">
                {lang === 'th' ? 'สมการคำนวณปริมาตร:' : 'Volume Equation:'}
              </span>
              {calculated.formulaStr}
            </div>
          </div>

          {/* Interactive Structural Schematic Diagram */}
          <div className="no-flip"><MemberDiagram item={calculated} lang={lang} /></div>
        </div>
      </div>
    </div>
  );
};
