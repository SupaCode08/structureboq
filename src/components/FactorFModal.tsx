import React, { useState } from 'react';
import { FactorFParams, computeFactorFMultiplier } from '../engine/qsEngine';
import { Percent, ShieldCheck, DollarSign, Calculator, X, RefreshCw, Info } from 'lucide-react';

interface FactorFModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentParams: FactorFParams;
  onSave: (params: FactorFParams) => void;
  directCost: number;
}

export const FactorFModal: React.FC<FactorFModalProps> = ({
  isOpen,
  onClose,
  currentParams,
  onSave,
  directCost,
}) => {
  const [params, setParams] = useState<FactorFParams>({ ...currentParams });

  if (!isOpen) return null;

  const liveFactorF = computeFactorFMultiplier(params);
  const totalWithFactorF = Number((directCost * liveFactorF).toFixed(2));
  const markupAmount = Number((totalWithFactorF - directCost).toFixed(2));

  const handleReset = () => {
    setParams({
      advancePaymentPct: 0,
      interestRatePct: 6,
      retentionPct: 0,
      vatPct: 7,
      overheadPct: 11.5,
      profitPct: 5.5,
    });
  };

  const handleSave = () => {
    onSave(params);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                ตั้งค่าตัวคูณ Factor F (กรมบัญชีกลาง)
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-200 border border-blue-400/30">
                  แบบ ปร.5
                </span>
              </h3>
              <p className="text-xs text-slate-300">
                ตาราง Factor F งานอาคาร มาตรฐานการคำนวณราคากลางงานก่อสร้างภาครัฐ
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Summary Bar */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 grid grid-cols-3 gap-4 text-center">
          <div className="p-2.5 rounded-xl bg-white border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 font-medium">ราคางานต้นทุน (ปร.4)</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              ฿{directCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 shadow-sm">
            <div className="text-xs text-blue-700 font-bold flex items-center justify-center gap-1">
              <Percent className="w-3.5 h-3.5" />
              Factor F รวม
            </div>
            <div className="text-xl font-black text-blue-800 mt-0.5">
              {liveFactorF.toFixed(4)}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm">
            <div className="text-xs text-emerald-700 font-bold flex items-center justify-center gap-1">
              <DollarSign className="w-3.5 h-3.5" />
              ราคารวม Factor F
            </div>
            <div className="text-base font-black text-emerald-800 mt-0.5">
              ฿{totalWithFactorF.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Body Settings */}
        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Info Banner */}
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs leading-relaxed">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              สูตรคำนวณมาตรฐาน: <span className="font-mono font-bold">Factor F = [1 + (ค่าอำนวยการ + กำไร + ดอกเบี้ย × 0.5) / 100] × [1 + VAT / 100]</span>
              <br />
              ส่วนเพิ่มค่าดำเนินการ ค่าความเสี่ยง และภาษี = <span className="font-bold text-amber-800">฿{markupAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Advance Payment */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>เงินล่วงหน้าจ่าย (Advance Payment)</span>
                <span className="font-bold text-blue-600">{params.advancePaymentPct}%</span>
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[0, 5, 10, 15].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setParams({ ...params, advancePaymentPct: val })}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      params.advancePaymentPct === val
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>
            </div>

            {/* Interest Rate */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>อัตราดอกเบี้ยเงินกู้ (Interest Rate)</span>
                <span className="font-bold text-blue-600">{params.interestRatePct}%</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[5, 6, 7].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setParams({ ...params, interestRatePct: val })}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      params.interestRatePct === val
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>
            </div>

            {/* Retention */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>เงินประกันผลงานหัก (Retention)</span>
                <span className="font-bold text-blue-600">{params.retentionPct}%</span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[0, 5, 10].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setParams({ ...params, retentionPct: val })}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      params.retentionPct === val
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>
            </div>

            {/* VAT */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>ภาษีมูลค่าเพิ่ม (VAT)</span>
                <span className="font-bold text-blue-600">{params.vatPct}%</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {[7, 0].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setParams({ ...params, vatPct: val })}
                    className={`py-1.5 text-xs font-bold rounded-lg border transition-all ${
                      params.vatPct === val
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {val === 7 ? '7% (ปกติ)' : '0% (ยกเว้นภาษี)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Overhead */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>ค่าอำนวยการ (Overhead %)</span>
                <span className="font-mono text-slate-500">{params.overheadPct}%</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="30"
                value={params.overheadPct}
                onChange={(e) => setParams({ ...params, overheadPct: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>

            {/* Profit */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>กำไร (Profit %)</span>
                <span className="font-mono text-slate-500">{params.profitPct}%</span>
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="30"
                value={params.profitPct}
                onChange={(e) => setParams({ ...params, profitPct: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium py-1.5 px-3 rounded-lg hover:bg-slate-200/60 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            รีเซ็ตค่ามาตรฐาน (Standard 1.3054)
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-200/50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <ShieldCheck className="w-4 h-4" />
              บันทึกและคำนวณใหม่
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
