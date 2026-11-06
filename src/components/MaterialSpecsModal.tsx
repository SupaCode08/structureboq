import React, { useState, useEffect } from 'react';
import { X, Sliders, CheckCircle2, FileText, Sparkles, RotateCcw, AlertCircle, DollarSign, Shield } from 'lucide-react';
import { MaterialSpecs, DEFAULT_MATERIAL_SPECS, REQUIRED_SPECS, type SpecValueSource } from '../engine/qsEngine';
import { Language } from '../utils/translations';

interface MaterialSpecsModalProps {
  isOpen: boolean;
  onClose: () => void;
  specs: MaterialSpecs;
  pdfExtractedSpecs?: MaterialSpecs;
  onSave: (updated: MaterialSpecs) => void;
  lang: Language;
  /** typed reviewer name: a documented assumption is stamped with it */
  reviewer?: string;
}

const SRC_TH: [SpecValueSource['source'] | '', string][] = [['', 'ไม่มีที่มา (ค่าเริ่มต้น)'], ['user', 'ผู้ใช้กรอก'], ['drawing_notes', 'จากหมายเหตุในแบบ'], ['assumption', 'สมมติฐาน (ต้องมีเหตุผล)']];
const HOOK_TH: [string, string][] = [['FULL_UPTURN', 'งอตั้งขึ้นเต็ม'], ['STANDARD_HOOK', 'งอขอฉาก'], ['STRAIGHT', 'ตรง'], ['UNSPECIFIED', 'ไม่ระบุ']];

const PRESETS: Record<string, Partial<MaterialSpecs>> = {
  porRor4Standard: {
    concreteGrade: 'C25/30 (240 ksc คิวบ์)',
    concreteMatRate: 2100,
    concreteLaborRate: 450,
    concreteWastagePct: 5,
    formworkType: 'ไม้แบบหล่อทั่วไปรวมค้ำยัน',
    formworkMatRate: 350,
    formworkLaborRate: 150,
    formworkWastagePct: 10,
    mainRebarGrade: 'SD40 (ข้ออ้อย DB12-DB25)',
    mainRebarMatRate: 28.50,
    mainRebarLaborRate: 4.50,
    stirrupGrade: 'SR24 (เหล็กกลม RB6-RB9)',
    stirrupMatRate: 28.00,
    stirrupLaborRate: 4.50,
    rebarWastagePct: 7,
    concreteCoveringCm: 3.5,
  },
  residential: {
    concreteGrade: 'C20/25 (210 ksc คิวบ์ - พักอาศัย)',
    concreteMatRate: 1950,
    concreteLaborRate: 400,
    concreteWastagePct: 5,
    formworkType: 'ไม้แบบกระบะ/ไม้อัดทั่วไป',
    formworkMatRate: 320,
    formworkLaborRate: 140,
    formworkWastagePct: 10,
    mainRebarGrade: 'SD30 / SD40 (DB12-DB16)',
    mainRebarMatRate: 27.50,
    mainRebarLaborRate: 4.00,
    stirrupGrade: 'SR24 (RB6)',
    stirrupMatRate: 27.50,
    stirrupLaborRate: 4.00,
    rebarWastagePct: 6,
    concreteCoveringCm: 2.5,
  },
  commercialHighRise: {
    concreteGrade: 'C30/35 (320-350 ksc คิวบ์ - อาคารสูง)',
    concreteMatRate: 2450,
    concreteLaborRate: 500,
    concreteWastagePct: 6,
    formworkType: 'ไม้แบบเคลือบฟิล์มดำ/แบบเหล็ก',
    formworkMatRate: 420,
    formworkLaborRate: 180,
    formworkWastagePct: 8,
    mainRebarGrade: 'SD50 (DB20-DB28 ข้ออ้อยแรงดึงสูง)',
    mainRebarMatRate: 30.50,
    mainRebarLaborRate: 5.00,
    stirrupGrade: 'SD40 / SR24 (RB9/DB10)',
    stirrupMatRate: 29.50,
    stirrupLaborRate: 4.80,
    rebarWastagePct: 8,
    concreteCoveringCm: 4.0,
  },
};

export const MaterialSpecsModal: React.FC<MaterialSpecsModalProps> = ({
  isOpen,
  onClose,
  specs,
  pdfExtractedSpecs,
  onSave,
  lang,
  reviewer,
}) => {
  const [form, setForm] = useState<MaterialSpecs>(specs);
  const [specError, setSpecError] = useState<string | null>(null);

  useEffect(() => {
    setForm(specs);
  }, [specs, isOpen]);

  if (!isOpen) return null;

  const handleApplyPreset = (presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (preset) {
      setForm((prev) => ({
        ...prev,
        ...preset,
      }));
    }
  };

  const handleResetPdf = () => {
    if (pdfExtractedSpecs) {
      setForm({
        ...pdfExtractedSpecs,
      });
    } else {
      setForm({ ...DEFAULT_MATERIAL_SPECS });
    }
  };

  // a value typed here is the user's; an assumption names its reason and who documented it
  const setSource = (key: keyof MaterialSpecs, patch: Partial<SpecValueSource> | null, value?: unknown) => setForm(f => {
    const vs = { ...(f.valueSources || {}) };
    const cur = vs[key];
    if (patch === null) delete vs[key];
    else vs[key] = { source: 'user', ...cur, ...patch, by: reviewer?.trim() || undefined, at: new Date().toISOString() };
    return { ...f, ...(value !== undefined ? { [key]: value } : {}), valueSources: vs };
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = REQUIRED_SPECS.filter(r => form.valueSources?.[r.key]?.source === 'assumption' && (!form.valueSources[r.key]!.note?.trim() || !form.valueSources[r.key]!.by));
    if (bad.length) {
      setSpecError(`สมมติฐานต้องมีเหตุผลและชื่อผู้ตรวจ (กรอกชื่อในหน้าตรวจทาน): ${bad.map(r => r.label).join(', ')}`);
      return;
    }
    setSpecError(null);
    onSave(form);
    onClose();
  };

  const isTh = lang === 'th';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
      <div className="flip-light bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden my-6 max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>สเปกวัสดุและราคาต่อหน่วย (ปร.4)</span>
              </h2>
              <p className="text-xs text-slate-400">
                ราคาวัสดุ ค่าแรง และเผื่อสูญเสีย — บันทึกแล้วคำนวณราคาใหม่ทั้งโครงการ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs sm:text-sm">
          {/* Quick Presets Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-300 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-sky-400" />
                <span>ชุดค่าเริ่มต้น</span>
              </span>
              <button
                type="button"
                onClick={handleResetPdf}
                className="text-xs text-amber-400 hover:text-amber-300 flex items-center space-x-1 underline"
              >
                <RotateCcw className="w-3 h-3" />
                <span>คืนค่าเริ่มต้น</span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleApplyPreset('porRor4Standard')}
                className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800/60 hover:border-sky-500/40 text-left transition-all"
              >
                <div className="font-semibold text-sky-300">กรมบัญชีกลาง ปร.4</div>
                <div className="text-[11px] text-slate-400 mt-0.5">240 ksc | SD40 | Cover 3.5cm</div>
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('residential')}
                className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800/60 hover:border-emerald-500/40 text-left transition-all"
              >
                <div className="font-semibold text-emerald-300">บ้านพักอาศัย 1–2 ชั้น</div>
                <div className="text-[11px] text-slate-400 mt-0.5">210 ksc | SD30/40 | Cover 2.5cm</div>
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('commercialHighRise')}
                className="p-2.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800/60 hover:border-purple-500/40 text-left transition-all"
              >
                <div className="font-semibold text-purple-300">อาคารสูง</div>
                <div className="text-[11px] text-slate-400 mt-0.5">320 ksc | SD50 | Cover 4.0cm</div>
              </button>
            </div>
          </div>

          {(form.sourceText || pdfExtractedSpecs?.sourceText) && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-3">
              <FileText className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-amber-200 flex items-center gap-2">
                  <span>ตรวจพบสเปกจากรายการประกอบแบบวิศวกรรมโครงสร้าง</span>
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] uppercase font-bold">Auto-Detected</span>
                </div>
                <div className="text-[11px] text-amber-300/90 mt-1 leading-relaxed">
                  {form.sourceText || pdfExtractedSpecs?.sourceText}
                </div>
              </div>
            </div>
          )}

          <form id="material-specs-form" onSubmit={handleSubmit} className="space-y-6">
            {/* 1. Concrete Specifications */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-cyan-400 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                  <span>{isTh ? '1. งานคอนกรีตโครงสร้าง' : '1. Structural Concrete Specs & Rates'}</span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono">฿ / ลบ.ม.</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'เกรด/กำลังอัดคอนกรีต' : 'Concrete Grade / Spec'}
                  </label>
                  <input
                    type="text"
                    value={form.concreteGrade}
                    onChange={(e) => setForm({ ...form, concreteGrade: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-cyan-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ราคาวัสดุ (฿/ลบ.ม.)' : 'Material Rate (THB/m³)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.concreteMatRate}
                    onChange={(e) => setForm({ ...form, concreteMatRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-cyan-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ค่าแรงเท/จี้ (฿/ลบ.ม.)' : 'Labor Rate (THB/m³)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.concreteLaborRate}
                    onChange={(e) => setForm({ ...form, concreteLaborRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-cyan-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'เผื่อสูญเสีย คอนกรีต (%)' : 'Concrete Wastage (%)'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.concreteWastagePct}
                    onChange={(e) => setForm({ ...form, concreteWastagePct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-cyan-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ระยะคอนกรีตหุ้ม Covering (ซม.)' : 'Concrete Covering (cm)'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.concreteCoveringCm}
                    onChange={(e) => setForm({ ...form, concreteCoveringCm: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-amber-300 font-bold focus:outline-none focus:border-amber-400 font-mono text-xs"
                    required
                  />
                </div>
              </div>
            </div>

            {/* 2. Formwork Specifications */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-amber-400 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span>{isTh ? '2. งานไม้แบบหล่อและค้ำยัน' : '2. Formwork Specs & Rates'}</span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono">฿ / ตร.ม.</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ประเภทไม้แบบหล่อ' : 'Formwork Type / Material'}
                  </label>
                  <input
                    type="text"
                    value={form.formworkType}
                    onChange={(e) => setForm({ ...form, formworkType: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ราคาวัสดุไม้แบบ (฿/ตร.ม.)' : 'Material Rate (THB/m²)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.formworkMatRate}
                    onChange={(e) => setForm({ ...form, formworkMatRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ค่าแรงติดตั้ง/รื้อถอน (฿/ตร.ม.)' : 'Labor Rate (THB/m²)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.formworkLaborRate}
                    onChange={(e) => setForm({ ...form, formworkLaborRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'เผื่อสูญเสีย ไม้แบบ (%)' : 'Formwork Wastage (%)'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.formworkWastagePct}
                    onChange={(e) => setForm({ ...form, formworkWastagePct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-400 font-mono text-xs"
                    required
                  />
                </div>
              </div>
            </div>

            {/* 3. Rebar Reinforcement Specifications */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-sky-400 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                  <span>{isTh ? '3. งานเหล็กเสริมโครงสร้าง' : '3. Steel Rebar Specs & Rates'}</span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono">฿ / กิโลกรัม (kg)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'เหล็กแกนข้ออ้อย Main Rebar' : 'Main Rebar Grade'}
                  </label>
                  <input
                    type="text"
                    value={form.mainRebarGrade}
                    onChange={(e) => setForm({ ...form, mainRebarGrade: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ราคาเหล็กข้ออ้อย (฿/กก.)' : 'Main Steel Mat'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.mainRebarMatRate}
                    onChange={(e) => setForm({ ...form, mainRebarMatRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ค่าแรงดัด/ผูกเหล็กข้ออ้อย (฿/กก.)' : 'Main Steel Labor'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.mainRebarLaborRate}
                    onChange={(e) => setForm({ ...form, mainRebarLaborRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-400 font-mono text-xs"
                    required
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'เหล็กปลอก Stirrup Rebar' : 'Stirrup Rebar Grade'}
                  </label>
                  <input
                    type="text"
                    value={form.stirrupGrade}
                    onChange={(e) => setForm({ ...form, stirrupGrade: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'ราคาเหล็กปลอก (฿/กก.)' : 'Stirrup Mat'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.stirrupMatRate}
                    onChange={(e) => setForm({ ...form, stirrupMatRate: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-400 font-mono text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    {isTh ? 'เผื่อสูญเสีย & ทาบเหล็ก (%)' : 'Rebar Wastage/Laps (%)'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.rebarWastagePct}
                    onChange={(e) => setForm({ ...form, rebarWastagePct: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-400 font-mono text-xs"
                    required
                  />
                </div>
              </div>
            </div>
            {/* 4. Quantity-relevant site/footing values: each needs a source or a documented assumption */}
            <div data-required-specs className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
              <div className="pb-2 border-b border-slate-800">
                <span className="font-bold text-rose-300">งานดิน / ฐานราก / ค่าที่กระทบปริมาณ</span>
                <p className="text-[11px] text-slate-400">ค่าที่ "ไม่มีที่มา" ยังคิดยอดชั่วคราวด้วยค่าเริ่มต้น แต่รายการที่ใช้ค่านั้นอนุมัติปล่อยยอดไม่ได้ จนกว่าจะกรอกค่าหรือบันทึกเป็นสมมติฐานพร้อมเหตุผล</p>
              </div>
              {REQUIRED_SPECS.map(r => {
                const vs = form.valueSources?.[r.key];
                const v = (form as any)[r.key];
                const cls = 'w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs';
                return (
                  <div key={r.key} data-spec-key={r.key} className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_1.2fr] gap-2 items-start">
                    <label className="text-[11px] text-slate-300 pt-1.5">{r.label}{r.unit && ` (${r.unit})`}<span className="block text-slate-500">กระทบ {r.affects}</span></label>
                    {r.key === 'footingHookShape' ? (
                      <select value={v ?? ''} onChange={e => setSource(r.key, vs ? {} : { source: 'user' }, e.target.value)} className={cls}>
                        {HOOK_TH.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    ) : r.key === 'groundBeamSoffitFormwork' ? (
                      <select value={v ? 'yes' : 'no'} onChange={e => setSource(r.key, vs ? {} : { source: 'user' }, e.target.value === 'yes')} className={cls}>
                        <option value="no">ไม่คิดไม้แบบท้องคาน GB</option><option value="yes">คิดไม้แบบท้องคาน GB</option>
                      </select>
                    ) : (
                      <input type="number" step="0.01" value={v ?? ''} aria-label={r.label}
                        onChange={e => setSource(r.key, vs ? {} : { source: 'user' }, e.target.value === '' ? undefined : parseFloat(e.target.value))} className={cls} />
                    )}
                    <div className="space-y-1">
                      <select value={vs?.source ?? ''} aria-label={`ที่มา ${r.label}`} onChange={e => setSource(r.key, e.target.value ? { source: e.target.value as SpecValueSource['source'] } : null)} className={cls}>
                        {SRC_TH.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      {vs?.source === 'assumption' && (
                        <input type="text" placeholder="เหตุผลของสมมติฐาน" aria-label={`เหตุผล ${r.label}`} value={vs.note ?? ''} onChange={e => setSource(r.key, { note: e.target.value })} className={cls} />
                      )}
                      {vs?.by && <span className="block text-[10px] text-slate-500">โดย {vs.by}</span>}
                    </div>
                  </div>
                );
              })}
              {specError && <div className="text-xs text-rose-400">{specError}</div>}
            </div>
          </form>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between flex-shrink-0">
          <div className="text-[11px] text-slate-400 hidden sm:block">
            {isTh
              ? 'การเปลี่ยนแปลงจะมีผลต่อการประมาณการต้นทุน ปร.4 และน้ำหนักเหล็กปลอกทันที'
              : '💡 Changes immediately update Por Ror 4 financial valuation and stirrup geometry'}
          </div>
          <div className="flex items-center space-x-3 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              {isTh ? 'ยกเลิก' : 'Cancel'}
            </button>
            <button
              type="submit"
              form="material-specs-form"
              className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center space-x-1.5"
            >
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
              <span>{isTh ? 'บันทึกและคำนวณโครงการใหม่' : 'Apply & Recalculate'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
