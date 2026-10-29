import React from 'react';
import { FileSpreadsheet, Printer, Sliders, Percent, MapPin, Calculator } from 'lucide-react';

export type AppTab = 'import' | 'review' | 'quantities' | 'boq' | 'plan' | 'manual';

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
  const tool = 'h-9 px-2.5 inline-flex items-center gap-1.5 rounded-md text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40';
  const toolOn = 'bg-slate-100 text-slate-900 font-medium';
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 flex flex-wrap items-center gap-x-6 gap-y-2 py-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-bold text-lg text-slate-900 tracking-tight">StructBOQ</span>
          {projectName && <span className="text-sm text-slate-500 truncate max-w-[22ch] sm:max-w-[36ch]" title={projectName}>{projectName}</span>}
        </div>

        <nav className="order-3 lg:order-none w-full lg:w-auto flex items-center gap-1 overflow-x-auto">
          {STEPS.map((s, i) => {
            const on = activeTab === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveTab(s.id)}
                className={`h-9 pl-1.5 pr-3 inline-flex items-center gap-2 rounded-md text-sm whitespace-nowrap ${on ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                <span className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-semibold ${on ? 'bg-white text-blue-700' : 'bg-slate-200 text-slate-700'}`}>{i + 1}</span>
                {s.label}
                {s.id === 'review' && !!reviewPendingCount && (
                  <span className={`min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold inline-flex items-center justify-center ${on ? 'bg-amber-300 text-amber-950' : 'bg-amber-500 text-white'}`}>
                    {reviewPendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-0.5">
          <button className={`${tool} ${activeTab === 'plan' ? toolOn : ''}`} onClick={() => setActiveTab('plan')} title="แปลน 2D"><MapPin className="w-4 h-4" /><span className="hidden xl:inline">แปลน</span></button>
          <button className={`${tool} ${activeTab === 'manual' ? toolOn : ''}`} onClick={() => setActiveTab('manual')} title="คำนวณเอง"><Calculator className="w-4 h-4" /><span className="hidden xl:inline">คำนวณเอง</span></button>
          <button className={tool} onClick={onOpenMaterialSpecs} title="สเปกวัสดุและราคา"><Sliders className="w-4 h-4" /><span className="hidden xl:inline">สเปก/ราคา</span></button>
          <button className={tool} onClick={onOpenFactorF} title="Factor F (ปร.5)"><Percent className="w-4 h-4" /><span className="hidden xl:inline">Factor F</span></button>
          <button className={tool} onClick={onPrintReport} disabled={!hasItems} title="พิมพ์ ปร.4 / ปร.5"><Printer className="w-4 h-4" /><span className="hidden xl:inline">พิมพ์</span></button>
          <button
            onClick={onExportExcel}
            disabled={!hasItems || isExporting}
            className="ml-1 h-9 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {isExporting ? 'กำลังส่งออก…' : 'Excel'}
          </button>
        </div>
      </div>
    </header>
  );
};
