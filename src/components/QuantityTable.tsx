import React, { useState } from 'react';
import { CalculatedQuantity, MemberType } from '../engine/qsEngine';
import { Search, Eye, CheckCircle2, AlertTriangle, XCircle, Filter, ArrowUpDown } from 'lucide-react';
import { Language, translations } from '../utils/translations';

interface QuantityTableProps {
  items: CalculatedQuantity[];
  filterStatus: string;
  setFilterStatus: (status: string) => void;
  onSelectItem: (item: CalculatedQuantity) => void;
  lang: Language;
  theme?: 'light' | 'dark';
}

export const QuantityTable: React.FC<QuantityTableProps> = ({
  items,
  filterStatus,
  setFilterStatus,
  onSelectItem,
  lang,
  theme = 'light',
}) => {
  const t = translations[lang];
  const isLight = theme === 'light';
  const [searchQuery, setSearchQuery] = useState('');
  const [memberTypeFilter, setMemberTypeFilter] = useState<'ALL' | MemberType>('ALL');

  const filteredItems = items.filter((item) => {
    if (filterStatus !== 'ALL' && item.status !== filterStatus) {
      return false;
    }
    if (memberTypeFilter !== 'ALL' && item.memberType !== memberTypeFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTag = item.tag.toLowerCase().includes(q);
      const matchGrid = item.gridLocation.toLowerCase().includes(q);
      const matchSource = item.sourceInfo.toLowerCase().includes(q);
      const matchFormula = item.formulaStr.toLowerCase().includes(q);
      const matchType = item.memberType.toLowerCase().includes(q);
      if (!matchTag && !matchGrid && !matchSource && !matchFormula && !matchType) {
        return false;
      }
    }
    return true;
  });

  const typeConfig: Record<MemberType, { th: string; en: string; badgeLight: string; badgeDark: string }> = {
    FOOTING: {
      th: 'ฐานราก',
      en: 'FOOTING',
      badgeLight: 'bg-purple-50 text-purple-700 border-purple-200',
      badgeDark: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    },
    COLUMN: {
      th: 'เสา',
      en: 'COLUMN',
      badgeLight: 'bg-blue-50 text-blue-700 border-blue-200',
      badgeDark: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    },
    BEAM: {
      th: 'คาน',
      en: 'BEAM',
      badgeLight: 'bg-amber-50 text-amber-800 border-amber-200',
      badgeDark: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    },
    SLAB: {
      th: 'พื้น',
      en: 'SLAB',
      badgeLight: 'bg-teal-50 text-teal-800 border-teal-200',
      badgeDark: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    },
    STAIR: {
      th: 'บันได',
      en: 'STAIR',
      badgeLight: 'bg-orange-50 text-orange-800 border-orange-200',
      badgeDark: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    },
    WALL: {
      th: 'ผนัง',
      en: 'WALL',
      badgeLight: 'bg-rose-50 text-rose-800 border-rose-200',
      badgeDark: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    },
    DOOR: {
      th: 'ประตู',
      en: 'DOOR',
      badgeLight: 'bg-indigo-50 text-indigo-800 border-indigo-200',
      badgeDark: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
    },
    WINDOW: {
      th: 'หน้าต่าง',
      en: 'WINDOW',
      badgeLight: 'bg-sky-50 text-sky-800 border-sky-200',
      badgeDark: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    },
    FINISH: {
      th: 'ผิวตกแต่ง',
      en: 'FINISH',
      badgeLight: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      badgeDark: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    },
  };

  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden transition-all ${
      isLight ? 'bg-white border-slate-200/90' : 'bg-slate-900 border-slate-800 shadow-xl'
    }`}>
      {/* Table Toolbar */}
      <div className={`p-4 border-b flex flex-col md:flex-row gap-3 items-center justify-between ${
        isLight ? 'bg-slate-50/70 border-slate-200/90' : 'bg-slate-900/60 border-slate-800'
      }`}>
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className={`w-4 h-4 absolute left-3 top-2.5 ${isLight ? 'text-slate-400' : 'text-slate-500'}`} />
          <input
            type="text"
            placeholder="ค้นหาเบอร์ (F1, C1, B1, S1), กริด, หรือสูตร..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full rounded-xl pl-9 pr-3 py-1.5 text-xs focus:outline-none transition-all border ${
              isLight
                ? 'bg-white border-slate-200 text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
                : 'bg-slate-950 border-slate-800 text-slate-200 placeholder-slate-500 focus:border-amber-500/80'
            }`}
          />
        </div>

        {/* Category Tabs & Status Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          {/* Multi-category element tabs */}
          <div className={`flex flex-wrap p-1 rounded-xl border text-xs gap-0.5 ${
            isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-950 border-slate-800'
          }`}>
            <button
              onClick={() => setMemberTypeFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg transition-all font-semibold ${
                memberTypeFilter === 'ALL'
                  ? isLight
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'bg-slate-800 text-white'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ทั้งหมด ({items.length})
            </button>
            {((['FOOTING', 'COLUMN', 'BEAM', 'SLAB', 'STAIR', 'WALL', 'DOOR', 'WINDOW', 'FINISH'] as MemberType[])
              .filter(t => items.some(it => it.memberType === t) || ['FOOTING', 'COLUMN', 'BEAM', 'SLAB', 'STAIR'].includes(t))
            ).map((type) => {
              const cfg = typeConfig[type];
              const count = items.filter(it => it.memberType === type).length;
              return (
                <button
                  key={type}
                  onClick={() => setMemberTypeFilter(type)}
                  className={`px-2 py-1 rounded-lg transition-all text-xs flex items-center gap-1 font-semibold ${
                    memberTypeFilter === type
                      ? isLight
                        ? 'bg-blue-600 text-white shadow-xs font-bold'
                        : 'bg-blue-600 text-white shadow-sm font-bold'
                      : isLight
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>{lang === 'th' ? cfg.th : cfg.en}</span>
                  {count > 0 && (
                    <span className="text-[10px] opacity-80 font-mono">({count})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Status Dropdown */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none border transition-all ${
              isLight
                ? 'bg-white border-slate-200 text-slate-700 focus:border-blue-500'
                : 'bg-slate-950 border-slate-800 text-slate-300 focus:border-amber-500'
            }`}
          >
            <option value="ALL">ทุกสถานะ ({items.length})</option>
            <option value="AUTO_RELEASE">ผ่านอัตโนมัติ</option>
            <option value="NEEDS_REVIEW">รอตรวจ</option>
            <option value="REJECTED">ใช้ไม่ได้</option>
          </select>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className={`border-b text-xs font-semibold ${
              isLight
                ? 'bg-slate-50 text-slate-600 border-slate-200'
                : 'bg-slate-950/70 text-slate-400 border-slate-800'
            }`}>
              <th className="py-3 px-3.5">รหัส</th>
              <th className="py-3 px-3.5">เบอร์</th>
              <th className="py-3 px-3.5">ตำแหน่งกริด / ชั้น</th>
              <th className="py-3 px-3.5 text-center">จำนวน</th>
              <th className="py-3 px-3.5">กว้าง × ลึก/ยาว</th>
              <th className="py-3 px-3.5">ยาวรวม</th>
              <th className="py-3 px-3.5">หักจุดตัด</th>
              <th className="py-3 px-3.5">ยาวสุทธิ</th>
              <th className="py-3 px-3.5 text-right">คอนกรีต</th>
              <th className="py-3 px-3.5 text-right">ไม้แบบ</th>
              <th className="py-3 px-3.5 text-right">เหล็กเสริม</th>
              <th className="py-3 px-3.5 text-right">ราคา ปร.4</th>
              <th className="py-3 px-3.5 text-center">สถานะ</th>
              <th className="py-3 px-3.5 text-center">ดูที่มา</th>
            </tr>
          </thead>
          <tbody className={`divide-y font-mono ${
            isLight ? 'divide-slate-100 text-slate-800' : 'divide-slate-800/60 text-slate-200'
          }`}>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-12 text-center text-slate-400 font-sans">
                  {t.noItems}
                </td>
              </tr>
            ) : (
              filteredItems.map((item, idx) => {
                const isRejected = item.status === 'REJECTED';
                const isReview = item.status === 'NEEDS_REVIEW';
                const cfg = typeConfig[item.memberType] || {
                  th: item.memberType,
                  en: item.memberType,
                  badgeLight: 'bg-slate-100 text-slate-700 border-slate-200',
                  badgeDark: 'bg-slate-800 text-slate-300 border-slate-700',
                };

                return (
                  <tr
                    key={item.itemId}
                    onClick={() => onSelectItem(item)}
                    className={`cursor-pointer transition-colors ${
                      isLight
                        ? isRejected
                          ? 'bg-rose-50/60 hover:bg-rose-100/60'
                          : isReview
                          ? 'bg-amber-50/60 hover:bg-amber-100/60'
                          : idx % 2 === 0
                          ? 'bg-white hover:bg-slate-50'
                          : 'bg-slate-50/40 hover:bg-slate-50'
                        : isRejected
                        ? 'bg-rose-950/10 hover:bg-slate-800/40'
                        : isReview
                        ? 'bg-amber-950/10 hover:bg-slate-800/40'
                        : 'hover:bg-slate-800/40'
                    }`}
                  >
                    {/* Item ID */}
                    <td className={`py-3 px-3.5 font-medium whitespace-nowrap text-[11px] ${
                      isLight ? 'text-slate-500' : 'text-slate-400'
                    }`}>
                      {item.itemId}
                    </td>

                    {/* Tag & Type */}
                    <td className="py-3 px-3.5 font-sans whitespace-nowrap">
                      <div className="flex items-center space-x-1.5">
                        <span className={`font-black ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                          {item.tag}
                        </span>
                        <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-bold border ${
                          isLight ? cfg.badgeLight : cfg.badgeDark
                        }`}>
                          {lang === 'th' ? cfg.th : cfg.en}
                        </span>
                      </div>
                    </td>

                    {/* Location */}
                    <td className={`py-3 px-3.5 font-sans whitespace-nowrap ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                      <div>
                        <span className="font-medium">{item.gridLocation}</span>
                        <span className={`text-[10px] block ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
                          {item.level}
                        </span>
                      </div>
                    </td>

                    {/* Qty */}
                    <td className={`py-3 px-3.5 text-center font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                      {item.count}
                    </td>

                    {/* Width x Depth */}
                    <td className={`py-3 px-3.5 whitespace-nowrap ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                      {isRejected && item.widthM <= 0 ? (
                        <span className="text-rose-600 font-bold">ขาดค่า</span>
                      ) : (
                        `${item.widthM.toFixed(2)} × ${item.depthM.toFixed(2)}`
                      )}
                    </td>

                    {/* Gross L */}
                    <td className={`py-3 px-3.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      {item.lengthGrossM.toFixed(2)}
                    </td>

                    {/* Deduction */}
                    <td className={`py-3 px-3.5 font-bold ${isLight ? 'text-amber-700' : 'text-amber-400/90'}`}>
                      {item.deductionM > 0 ? `-${item.deductionM.toFixed(3)}` : '-'}
                    </td>

                    {/* Net L */}
                    <td className={`py-3 px-3.5 font-semibold ${isLight ? 'text-slate-900' : 'text-slate-200'}`}>
                      {item.lengthNetM.toFixed(2)}
                    </td>

                    {/* Net Vol */}
                    <td className="py-3 px-3.5 text-right whitespace-nowrap">
                      {isRejected ? (
                        <span className="text-rose-600 font-semibold">0.0000</span>
                      ) : (
                        <span className={`font-black ${isLight ? 'text-blue-700' : 'text-emerald-400'}`}>
                          {item.volumeNetM3.toFixed(4)}
                        </span>
                      )}
                      <span className={`text-[10px] ml-1 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>m³</span>
                    </td>

                    {/* Formwork */}
                    <td className={`py-3 px-3.5 text-right whitespace-nowrap ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                      {isRejected ? '0.00' : item.formworkNetM2.toFixed(2)}
                      <span className={`text-[10px] ml-1 ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>m²</span>
                    </td>

                    {/* Rebar Weight */}
                    <td className={`py-3 px-3.5 text-right whitespace-nowrap font-semibold ${
                      isLight ? 'text-sky-700' : 'text-sky-400'
                    }`}>
                      {isRejected ? '-' : item.rebarWeightKg ? `${item.rebarWeightKg.toFixed(1)} kg` : '-'}
                    </td>

                    {/* Estimated Cost */}
                    <td className={`py-3 px-3.5 text-right font-black whitespace-nowrap ${
                      isLight ? 'text-emerald-700' : 'text-emerald-400'
                    }`}>
                      {isRejected ? '-' : item.totalCostThb ? `฿${item.totalCostThb.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-3.5 text-center whitespace-nowrap">
                      {item.review && (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${item.review.status === 'approved' ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-rose-50 text-rose-800 border-rose-200'}`}>
                          {item.review.status === 'approved' ? 'ผู้ตรวจยืนยัน' : 'ผู้ตรวจไม่นับ'}
                        </span>
                      )}
                      {!item.review && item.status === 'AUTO_RELEASE' && (
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isLight
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}>
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>ผ่านอัตโนมัติ</span>
                        </span>
                      )}
                      {!item.review && item.status === 'NEEDS_REVIEW' && (
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isLight
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                          <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                          <span>รอตรวจ</span>
                        </span>
                      )}
                      {!item.review && item.status === 'REJECTED' && (
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          isLight
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}>
                          <XCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                          <span>ใช้ไม่ได้</span>
                        </span>
                      )}
                    </td>

                    {/* Inspect Audit Button */}
                    <td className="py-3 px-3.5 text-center whitespace-nowrap">
                      <button
                        onClick={() => onSelectItem(item)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-sans font-bold flex items-center space-x-1 mx-auto transition-all border shadow-2xs active:scale-95 ${
                          isLight
                            ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700'
                        }`}
                        title={t.tableFooterHint}
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-600" />
                        <span>ที่มา</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Table Footer info */}
      <div className={`p-3.5 border-t text-xs flex flex-wrap items-center justify-between gap-2 ${
        isLight ? 'bg-slate-50/80 border-slate-200 text-slate-600' : 'bg-slate-950/80 border-slate-800 text-slate-400'
      }`}>
        <span>
          แสดงผล <strong>{filteredItems.length}</strong> จากทั้งหมด <strong>{items.length}</strong> รายการ
        </span>
        <span className={isLight ? 'text-slate-400' : 'text-slate-500'}>
          คลิกแถวเพื่อดูสูตร ค่าที่ใช้ ที่มาในแบบ และประวัติการแก้
        </span>
      </div>
    </div>
  );
};
