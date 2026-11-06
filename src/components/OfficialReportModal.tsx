import React from 'react';
import { BOQProjectResult, MaterialSpecs, FactorFParams } from '../engine/qsEngine';
import { Printer, X, Download, ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';

interface OfficialReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  result: BOQProjectResult;
}

export const OfficialReportModal: React.FC<OfficialReportModalProps> = ({
  isOpen,
  onClose,
  result,
}) => {
  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const specs = result.materialSpecs;
  const factorParams = result.factorFParams;
  const categories = result.categorySummaries || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Top toolbar */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-base">
              รายงานประมาณราคาและปริมาณงานทางการ (แบบ ปร.4 & ปร.5)
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-md transition-all active:scale-95"
            >
              <Printer className="w-4 h-4" />
              พิมพ์รายงาน / บันทึกเป็น PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Paper Document */}
        <div className="p-8 overflow-y-auto flex-1 bg-slate-100 text-slate-900 print:p-0 print:bg-white print:overflow-visible">
          <div className="bg-white p-8 max-w-3xl mx-auto rounded-xl shadow-sm border border-slate-200 print:border-none print:shadow-none print:p-0 space-y-6 text-sm">
            {/* Header Document */}
            <div className="text-center border-b pb-4 space-y-1">
              <h1 className="text-lg font-black text-slate-900 tracking-tight">
                แบบสรุปราคากลางค่าก่อสร้าง (แบบ ปร.5)
              </h1>
              <p className="text-xs text-slate-600">
                กลุ่มงานวิศวกรรมโครงสร้าง ค.ส.ล. ตามมาตรฐานกรมบัญชีกลางและ วสท.
              </p>
              <div className="text-xs text-slate-500 pt-1 flex justify-between px-2 font-mono">
                <span>โครงการ: {result.projectName}</span>
                <span>วันที่: {new Date().toLocaleDateString('th-TH')}</span>
              </div>
            </div>

            {/* Part 1: Por Ror 5 Summary with Factor F */}
            <div>
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1">
                <span>ส่วนที่ 1: สรุปค่าก่อสร้างและตารางคำนวณ Factor F</span>
              </h2>
              <table className="w-full text-xs border border-slate-300 border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold">
                    <th className="p-2 border-r border-slate-300 text-center w-12">ลำดับ</th>
                    <th className="p-2 border-r border-slate-300 text-left">กลุ่มงาน / รายการ</th>
                    <th className="p-2 border-r border-slate-300 text-right">ค่างานต้นทุน (บาท)</th>
                    <th className="p-2 border-r border-slate-300 text-center">Factor F</th>
                    <th className="p-2 text-right">รวมค่าก่อสร้าง (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="p-2 border-r border-slate-300 text-center">1</td>
                    <td className="p-2 border-r border-slate-300 font-semibold">
                      งานโครงสร้าง ค.ส.ล. (Direct Cost ตาม ปร.4)
                    </td>
                    <td className="p-2 border-r border-slate-300 text-right font-mono">
                      ฿{(result.totalProjectCostThb || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 border-r border-slate-300 text-center font-mono font-bold text-blue-700">
                      {(result.factorF || 1.3054).toFixed(4)}
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-emerald-800">
                      ฿{(result.totalCostWithFactorF || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={4} className="p-2 border-r border-slate-300 text-right">
                      รวมเป็นเงินค่าก่อสร้างทั้งสิ้น (Grand Total with Factor F):
                    </td>
                    <td className="p-2 text-right font-mono text-emerald-800 text-sm">
                      ฿{(result.totalCostWithFactorF || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>

              {factorParams && (
                <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 space-y-0.5">
                  <div className="font-semibold text-slate-700">เกณฑ์คำนวณ Factor F:</div>
                  <div className="grid grid-cols-2 gap-x-4">
                    <span>• เงินล่วงหน้าจ่าย: {factorParams.advancePaymentPct}%</span>
                    <span>• อัตราดอกเบี้ยเงินกู้: {factorParams.interestRatePct}%</span>
                    <span>• เงินประกันผลงานหัก: {factorParams.retentionPct}%</span>
                    <span>• ภาษีมูลค่าเพิ่ม (VAT): {factorParams.vatPct}%</span>
                    <span>• ค่าอำนวยการและกำไร: {factorParams.overheadPct + factorParams.profitPct}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Part 2: Por Ror 4 - 6 Official Structural Categories */}
            <div>
              <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                ส่วนที่ 2: แบบ ปร.4 สรุปแยก 6 หมวดงานโครงสร้าง
              </h2>
              <table className="w-full text-xs border border-slate-300 border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold">
                    <th className="p-2 border-r border-slate-300 text-center w-16">รหัส</th>
                    <th className="p-2 border-r border-slate-300 text-left">หมวดงาน</th>
                    <th className="p-2 border-r border-slate-300 text-center">จำนวน</th>
                    <th className="p-2 border-r border-slate-300 text-right">ค่าวัสดุ (บาท)</th>
                    <th className="p-2 border-r border-slate-300 text-right">ค่าแรง (บาท)</th>
                    <th className="p-2 text-right">รวมเงิน (บาท)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono">
                  {Object.values(categories).map((cat) => (
                    <tr key={cat.categoryCode}>
                      <td className="p-2 border-r border-slate-300 text-center text-blue-700 font-bold font-sans">
                        {cat.categoryCode}
                      </td>
                      <td className="p-2 border-r border-slate-300 font-sans font-medium text-slate-800">
                        {cat.categoryName}
                      </td>
                      <td className="p-2 border-r border-slate-300 text-center">
                        {cat.itemCount}
                      </td>
                      <td className="p-2 border-r border-slate-300 text-right">
                        ฿{cat.materialCostThb.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-2 border-r border-slate-300 text-right">
                        ฿{cat.wageCostThb.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-2 text-right font-bold text-slate-900">
                        ฿{cat.totalCostThb.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold font-sans">
                    <td colSpan={3} className="p-2 border-r border-slate-300 text-right">
                      รวมค่างานต้นทุนทางตรงทั้งสิ้น:
                    </td>
                    <td className="p-2 border-r border-slate-300 text-right font-mono">
                      ฿{Object.values(categories).reduce((acc, c) => acc + c.materialCostThb, 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 border-r border-slate-300 text-right font-mono">
                      ฿{Object.values(categories).reduce((acc, c) => acc + c.wageCostThb, 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-2 text-right font-mono text-blue-800">
                      ฿{(result.totalProjectCostThb || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Quality Gates Summary / Release Gate Verification Banner */}
            {result.needsReviewCount > 0 ? (
              <div className="border border-amber-300 bg-amber-50/80 rounded-lg p-3 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-amber-900 font-medium">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                  <span>
                    ⚠️ มีรายการรอการตรวจสอบโดยวิศวกร/QS (NEEDS_REVIEW): {result.needsReviewCount} จาก {result.totalItemsCount} รายการ — ยอดรวม ปร.4/ปร.5 เป็นยอดประมาณการเบื้องต้น (Provisional Quantity) ต้องผ่านการรับรองก่อนลงนามเป็นราคากลาง
                  </span>
                </div>
                <div className="text-amber-800 font-mono text-[11px] whitespace-nowrap">
                  อนุมัติแล้ว: {result.autoReleaseCount} | คอนกรีต: {result.totalConcreteVolumeM3.toFixed(3)} m³
                </div>
              </div>
            ) : (
              <div className="border border-emerald-200 bg-emerald-50/50 rounded-lg p-3 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-900 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>ผลการตรวจสอบมิติวิศวกรรม (Quality Gates): ผ่านเกณฑ์ครบถ้วน 100% ({result.autoReleaseCount}/{result.totalItemsCount} รายการ) ปลอดภัยต่อการออกราคากลาง</span>
                </div>
                <div className="text-slate-500 font-mono text-[11px]">
                  คอนกรีตสุทธิ: {result.totalConcreteVolumeM3.toFixed(3)} m³ | ไม้แบบ: {result.totalFormworkM2.toFixed(2)} m²
                </div>
              </div>
            )}

            {/* Signature Block */}
            <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs text-slate-600">
              <div className="space-y-6">
                <div>(ลงชื่อ)....................................................................</div>
                <div>(                                                                   )</div>
                <div>วิศวกรผู้ถอดแบบและคำนวณปริมาณงาน (QS)</div>
              </div>
              <div className="space-y-6">
                <div>(ลงชื่อ)....................................................................</div>
                <div>(                                                                   )</div>
                <div>กรรมการผู้ตรวจและเห็นชอบราคากลาง</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
