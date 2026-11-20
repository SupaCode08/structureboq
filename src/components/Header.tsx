import React from 'react';
import { FileSpreadsheet, Printer, Sliders, Percent, Calculator } from 'lucide-react';

export type AppTab = 'import' | 'review' | 'quantities' | 'boq' | 'manual';

interface HeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  reviewPendingCount?: number;
  onExportExcel: () => void;
  isExporting: boolean;
  hasItems: boolean;
  projectName?: string;
  onOpenMaterialSpecs?: () => void;
  onOpenFactorF?: () => void;
  onPrintReport?: () => void;
}

const STEPS: { id: AppTab; label: string }[] = [
  { id: 'import', label: 'นำเข้าแบบ' },
  { id: 'review', label: 'ตรวจทาน' },
  { id: 'quantities', label: 'ปริมาณงาน' },
  { id: 'boq', label: 'เทียบ BOQ' },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab, setActiveTab, reviewPendingCount, onExportExcel, isExporting, hasItems, projectName,
  onOpenMaterialSpecs, onOpenFactorF, onPrintReport,
}) => {
  const tool = 'h-9 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-40';
  const toolOn = 'bg-slate-900 text-white hover:bg-slate-800 hover:text-white';

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5">
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2.5 h-6 rounded-sm bg-[#EA580C] shrink-0" aria-hidden="true" />
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="font-bold text-base text-slate-900 tracking-tight">StructBOQ</span>
            {projectName && (
              <span className="text-xs text-slate-500 truncate max-w-[20ch] sm:max-w-[32ch] border-l border-slate-200 pl-2.5" title={projectName}>
                {projectName}
              </span>
            )}
          </div>
        </div>

        {/* Clean Swiss Stepper */}
        <nav aria-label="ขั้นตอนการทำงาน" className="order-3 lg:order-none w-full lg:w-auto flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
          {STEPS.map((s, i) => {
            const on = activeTab === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveTab(s.id)}
                className={`h-8 px-3 inline-flex items-center gap-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  on ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <span className={`text-[11px] font-mono ${on ? 'text-[#FB923C]' : 'text-slate-400'}`}>0{i + 1}</span>
                <span>{s.label}</span>
                {s.id === 'review' && !!reviewPendingCount && (
                  <span className={`min-w-5 h-5 px-1.5 rounded-full text-[11px] font-mono font-bold inline-flex items-center justify-center ${
                    on ? 'bg-[#EA580C] text-white' : 'bg-amber-100 text-amber-800'
                  }`}>
                    {reviewPendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Quiet Tools + Single Primary Export CTA */}
        <div className="ml-auto flex items-center gap-1">
          <button className={`${tool} ${activeTab === 'manual' ? toolOn : ''}`} onClick={() => setActiveTab('manual')} title="คำนวณเอง">
            <Calculator className="w-4 h-4" /><span className="hidden xl:inline">คำนวณเอง</span>
          </button>
          <button className={tool} onClick={onOpenMaterialSpecs} title="สเปกวัสดุและราคา">
            <Sliders className="w-4 h-4" /><span className="hidden xl:inline">สเปก/ราคา</span>
          </button>
          <button className={tool} onClick={onOpenFactorF} title="Factor F (ปร.5)">
            <Percent className="w-4 h-4" /><span className="hidden xl:inline">Factor F</span>
          </button>
          <button className={tool} onClick={onPrintReport} disabled={!hasItems} title="พิมพ์ ปร.4 / ปร.5">
            <Printer className="w-4 h-4" /><span className="hidden xl:inline">พิมพ์</span>
          </button>
          <button
            onClick={onExportExcel}
            disabled={!hasItems || isExporting}
            className="ml-1.5 h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold bg-[#EA580C] hover:bg-[#C2410C] text-white transition-colors disabled:opacity-40"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isExporting ? 'กำลังส่งออก…' : 'ส่งออก Excel'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
