/**
 * StructBOQ - Excel workbook (ปร.4 / ปร.5 / BOQ comparison / review log).
 * Shared by the browser (direct download) and the optional Node server.
 */
import * as XLSX from 'xlsx';

export function buildBoqWorkbook(result: any): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1: BOQ Summary (ภาษาไทย)
  const summaryData = [
    ['เอกสารสรุปปริมาณงาน (BILL OF QUANTITIES - BOQ) - งานคอนกรีตโครงสร้าง'],
    [`โครงการ: ${result.projectName || 'โครงการก่อสร้าง'} | มาตรฐานการวัด: วสท. / กรมบัญชีกลาง (SMM)`],
    [`วันที่ถอดแบบ: ${new Date().toLocaleDateString('th-TH')} | เครื่องมือ: StructBOQ AI Engine`],
    [],
    ['รายการตรวจวัด (Metric)', 'ปริมาณ (Value)', 'หน่วย (Unit)', 'คำอธิบายเชิงวิศวกรรม (Engineering Notes)'],
    ['ปริมาณคอนกรีตสุทธิ (Net Concrete Volume)', result.totalConcreteVolumeM3 || 0, 'ลบ.ม. (m³)', 'คอนกรีตโครงสร้าง คาน-เสา (หักจุดตัดรอยต่อเสาแล้ว)'],
    ['พื้นที่ไม้แบบสัมผัสสุทธิ (Net Formwork Area)', result.totalFormworkM2 || 0, 'ตร.ม. (m²)', 'ไม้แบบสัมผัสคอนกรีต (2 ข้างคาน + ท้องคาน หรือ 4 ด้านเสา)'],
    ['จำนวนองค์ประกอบทั้งหมด (Total Structural Elements)', result.totalItemsCount || 0, 'รายการ', 'จำนวนคานและเสาที่ตรวจพบในแบบแปลน'],
    ['รายการผ่านเกณฑ์อัตโนมัติ (Auto-Released)', `${result.autoReleaseCount || 0} (${result.passRatePct || 0}%)`, 'รายการ', 'ผ่านเกณฑ์มิติและมาตรฐานวิศวกรรมครบถ้วน'],
    ['รายการที่ต้องตรวจสอบเพิ่มเติม (Needs Review)', result.needsReviewCount || 0, 'รายการ', 'มีข้อสังเกตเชิงวิศวกรรม / สแปนกำกวม'],
    ['รายการที่ปฏิเสธการคำนวณ (Rejected)', result.rejectedCount || 0, 'รายการ', 'ระงับการคำนวณเนื่องจากมิติผิดปกติ (ศูนย์, ติดลบ, ข้อมูลซ้ำ)'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, '1. สรุปปริมาณงาน BOQ');

  // Sheet 2: Detailed Element Takeoff (All Structural Types)
  const detailedHeaders = [
    'รหัสรายการ (Item ID)', 'เบอร์โครงสร้าง (Tag)', 'ประเภท (Type)', 'ตำแหน่งกริด (Grid)', 'ระดับชั้น (Level)',
    'จำนวน (Qty)', 'ความกว้าง (Width ม.)', 'ความลึก/ยาว (Depth ม.)', 'ความยาวรวม (Gross L ม.)', 'หักจุดตัดเสา (Deduction ม.)', 'ความยาวสุทธิ (Net L ม.)',
    'คอนกรีตสุทธิ (Net Vol ลบ.ม.)', 'ไม้แบบ (Formwork ตร.ม.)', 'เหล็กเสริม (Rebar กก.)', 'รวมเงิน (Total THB)', 'สถานะการตรวจ (Status)', 'สมการและสูตรคำนวณ (Traceable Formula)', 'หลักฐานจากแบบแปลน (Source)'
  ];

  const typeTranslations: Record<string, string> = {
    FOOTING: 'ฐานราก (Footing)',
    COLUMN: 'เสา (Column)',
    BEAM: 'คาน (Beam)',
    SLAB: 'พื้น (Slab)',
    STAIR: 'บันได (Stair)',
    WALL: 'ผนัง (Wall)',
    DOOR: 'ประตู (Door)',
    WINDOW: 'หน้าต่าง (Window)',
    FINISH: 'วัสดุตกแต่งผิว (Finishing)',
  };

  const detailedRows = result.items.map((it: any) => [
    it.itemId,
    it.tag,
    typeTranslations[it.memberType] || it.memberType,
    it.gridLocation || '-',
    it.level || 'Story 1',
    it.count,
    it.widthM,
    it.depthM,
    it.lengthGrossM,
    it.deductionM,
    it.lengthNetM,
    it.volumeNetM3,
    it.formworkNetM2,
    it.rebarWeightKg || 0,
    it.totalCostThb || 0,
    it.status,
    it.formulaStr,
    it.sourceInfo || '-',
  ]);
  const wsDetails = XLSX.utils.aoa_to_sheet([detailedHeaders, ...detailedRows]);
  XLSX.utils.book_append_sheet(wb, wsDetails, '2. รายการถอดแบบละเอียด');

  // Sheet 2.1: ตารางดัดและตัดเหล็กเสริมละเอียด (Bar Cut & Bend Schedule)
  const rebarHeaders = [
    'รหัสรายการ (Item ID)', 'เบอร์โครงสร้าง (Tag)', 'ประเภท (Type)', 'ตำแหน่งกริด (Grid)', 'ระดับชั้น (Level)',
    'เบอร์เหล็ก (Bar)', 'ชั้นคุณภาพ (Grade)', 'ขนาด (เส้นผ่านศูนย์กลาง มม.)', 'หน้าที่การเสริม (Purpose)',
    'จำนวนเส้น (Pieces)', 'ความยาวตัดต่อเส้น (Cut Length ม.)', 'ความยาวรวม (Total Length ม.)',
    'น้ำหนักต่อเมตร (kg/m)', 'น้ำหนักรวม (Total Weight กก.)', 'ลวดผูกเหล็ก 2.5% (กก.)'
  ];
  const rebarRows: any[] = [];
  for (const it of result.items) {
    if (it.status === 'REJECTED' || !it.rebarDetails?.barList?.length) continue;
    for (const b of it.rebarDetails.barList) {
      const wire = Number((b.totalWeightKg * 0.025).toFixed(2));
      rebarRows.push([
        it.itemId,
        it.tag,
        typeTranslations[it.memberType] || it.memberType,
        it.gridLocation || '-',
        it.level || 'Story 1',
        b.bar,
        b.grade,
        b.diaMm,
        b.purpose,
        b.count,
        b.lengthM,
        b.totalLengthM,
        b.unitWeightKgM,
        b.totalWeightKg,
        wire
      ]);
    }
  }
  if (rebarRows.length) {
    const wsRebar = XLSX.utils.aoa_to_sheet([rebarHeaders, ...rebarRows]);
    XLSX.utils.book_append_sheet(wb, wsRebar, 'ตารางดัด-ตัดเหล็กเสริม');
  }

  // Sheet 3: Audit & Exceptions
  const auditHeaders = ['รหัสรายการ (Item ID)', 'เบอร์โครงสร้าง (Tag)', 'สถานะ (Status)', 'ประเภทปัญหา (Classification)', 'ข้อวินิจฉัยเชิงวิศวกรรม (Diagnostic Findings)', 'คำแนะนำการแก้ไข (Action Required)'];
  const auditRows = result.items
    .filter((it: any) => it.status !== 'AUTO_RELEASE')
    .map((it: any) => [
      it.itemId,
      it.tag,
      it.status,
      it.status === 'REJECTED' ? 'CRITICAL_FATAL' : 'ENGINEERING_REVIEW',
      [...(it.rejectionReasons || []), ...(it.reviewWarnings || [])].join('; '),
      'ตรวจสอบตารางขนาดในแบบ CAD/PDF ต้นฉบับ และตรวจสอบความกว้างเสารองรับ'
    ]);
  const wsAudit = XLSX.utils.aoa_to_sheet([auditHeaders, ...auditRows]);
  XLSX.utils.book_append_sheet(wb, wsAudit, '3. ตรวจสอบข้อยกเว้น Audit');

  // Sheet 4: แบบ ปร.4 แยกหมวดมาตรฐานราชการไทย
  const porRor4Headers = [
    'หมวดงาน / ลำดับ (Code)', 'รายการงาน (Work Description)', 'จำนวนรายการ (Items)', 'หน่วย (Unit)',
    'รวมค่าวัสดุ (Total Mat. THB)', 'รวมค่าแรง (Total Labor THB)', 'รวมเงินค่าก่อสร้าง (Grand Total THB)'
  ];

  const categorySummaries = result.categorySummaries || {};
  const catKeys = ['CAT-1', 'CAT-2', 'CAT-3', 'CAT-4', 'CAT-5', 'CAT-6', 'CAT-7'];
  const defaultCatNames: Record<string, string> = {
    'CAT-1': 'งานเตรียมการและงานดินฐานราก',
    'CAT-2': 'งานฐานรากและเสาเข็ม ค.ส.ล.',
    'CAT-3': 'งานเสา ค.ส.ล.',
    'CAT-4': 'งานคาน ค.ส.ล.',
    'CAT-5': 'งานพื้น ค.ส.ล. และพื้นสำเร็จรูป',
    'CAT-6': 'งานบันได ค.ส.ล.',
    'CAT-7': 'งานสถาปัตยกรรม (ผนัง ประตู หน้าต่าง พื้นผิว และฝ้าเพดาน)',
  };

  let totalMatAll = 0;
  let totalLaborAll = 0;
  let totalDirectCostAll = 0;

  const porRor4Rows = catKeys.map(code => {
    const cat = categorySummaries[code] || {};
    const mat = cat.materialCostThb || 0;
    const wage = cat.wageCostThb || 0;
    const tot = cat.totalCostThb || (mat + wage);
    totalMatAll += mat;
    totalLaborAll += wage;
    totalDirectCostAll += tot;

    return [
      code,
      cat.categoryName || defaultCatNames[code] || code,
      cat.itemCount || 0,
      'รายการ',
      mat,
      wage,
      tot,
    ];
  });

  porRor4Rows.push(
    [],
    ['', 'รวมค่างานต้นทุนทางตรงทั้งสิ้น (Direct Cost - ปร.4)', '', '', totalMatAll, totalLaborAll, totalDirectCostAll]
  );

  const wsPorRor4 = XLSX.utils.aoa_to_sheet([porRor4Headers, ...porRor4Rows]);
  XLSX.utils.book_append_sheet(wb, wsPorRor4, '4. แบบ ปร.4 แยก 6 หมวด');

  // Sheet 5: แบบ ปร.5 สรุป Factor F กรมบัญชีกลาง
  const factorF = result.factorF || 1.3054;
  const factorParams = result.factorFParams || {
    advancePaymentPct: 0,
    interestRatePct: 6,
    retentionPct: 0,
    vatPct: 7,
    overheadPct: 11.5,
    profitPct: 5.5,
  };
  const totalWithFactorF = result.totalCostWithFactorF || Number((totalDirectCostAll * factorF).toFixed(2));

  const porRor5Data = [
    ['แบบ ปร.5 : แบบสรุปค่าก่อสร้าง (Comptroller General Factor F Summary)'],
    [`โครงการ: ${result.projectName || 'โครงการก่อสร้าง'} | อ้างอิงตาราง Factor F งานอาคาร กรมบัญชีกลาง`],
    [],
    ['ลำดับ', 'กลุ่มงาน / รายการ', 'ค่างานต้นทุน (บาท)', 'ค่า Factor F', 'รวมค่าก่อสร้าง (บาท)', 'หมายเหตุ'],
    ['1', 'กลุ่มงานวิศวกรรมโครงสร้าง ค.ส.ล. (Direct Cost)', totalDirectCostAll, factorF, totalWithFactorF, 'คำนวณจากแบบ ปร.4 ทั้ง 6 หมวด'],
    [],
    ['เงื่อนไขการคำนวณ Factor F (งานอาคาร):'],
    [`• เงินล่วงหน้าจ่าย (Advance Payment): ${factorParams.advancePaymentPct}%`],
    [`• เงินประกันผลงานหัก (Retention): ${factorParams.retentionPct}%`],
    [`• ดอกเบี้ยเงินกู้ (Interest Rate): ${factorParams.interestRatePct}%`],
    [`• ภาษีมูลค่าเพิ่ม (VAT): ${factorParams.vatPct}%`],
    [`• ค่าอำนวยการและกำไร (Overhead + Profit): ${(factorParams.overheadPct || 11.5) + (factorParams.profitPct || 5.5)}%`],
    [],
    ['รวมเป็นเงินค่าก่อสร้างทั้งสิ้น (Grand Total with Factor F)', '', '', '', totalWithFactorF, 'บาท (THB)'],
    [],
    ['(ลงชื่อ)........................................................ ผู้ประมาณราคา'],
    ['(                                                     )'],
    ['ตำแหน่ง: วิศวกรผู้เชี่ยวชาญด้านถอดแบบและประมาณราคา (QS)'],
  ];

  const wsPorRor5 = XLSX.utils.aoa_to_sheet(porRor5Data);
  XLSX.utils.book_append_sheet(wb, wsPorRor5, '5. แบบ ปร.5 สรุป Factor F');

  // Sheet 6: system takeoff vs the real BOQ (when one was loaded)
  const cmp = result.boqComparison;
  if (cmp && Array.isArray(cmp.rows)) {
    const verdictTh: Record<string, string> = { match: 'ตรงกัน (≤5%)', rounding: 'ตรงในระดับปัดเศษ BOQ', close: 'ใกล้เคียง (≤15%)', off: 'ต่างมาก', not_in_boq: 'ไม่มีใน BOQ', missing_in_takeoff: 'ระบบยังไม่ถอด' };
    const rows = [
      [`เทียบปริมาณงานระบบกับ BOQ จริง: ${result.boqFileName || ''} ${result.boqVariant ? '(' + result.boqVariant + ')' : ''}`],
      [],
      ['รายการ', 'หน่วย', 'ระบบ', 'BOQ จริง', 'ต่าง', 'ต่าง %', 'ผล', 'บรรทัดใน BOQ (หน้า)'],
      ...cmp.rows.map((r: any) => [
        r.label, r.unit, r.system, r.boq ?? '-', r.diff ?? '-', r.pct ?? '-', verdictTh[r.verdict] || r.verdict,
        (r.boqSources || []).map((s: any) => `${s.text} (น.${s.page})`).join('; '),
      ]),
      [],
      ['คลาดเคลื่อนเฉลี่ยค่าหลัก (%)', '', cmp.meanAbsPct ?? '-'],
      ...(cmp.notes || []).map((n: string) => [n]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '6. เทียบ BOQ จริง');
  }

  // Sheet 7: review log — what was auto-released, what a person checked, and the evidence used
  const reviewRows = result.items.map((it: any) => [
    it.itemId, it.tag, it.memberType, it.gridLocation, it.level, it.status,
    it.confidencePct ?? '-',
    it.review ? (it.review.status === 'approved' ? 'อนุมัติ' : 'ไม่นับ') : (it.status === 'AUTO_RELEASE' ? 'ผ่านอัตโนมัติ' : 'ยังไม่ตรวจ'),
    it.review?.note || '',
    (it.flags || []).map((f: any) => f.message).join('; '),
    (it.provenance?.evidence || []).map((e: any) => `${e.label} น.${e.page}`).join('; '),
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['รหัส', 'เบอร์', 'ประเภท', 'กริด', 'ชั้น', 'สถานะ', 'ความมั่นใจ %', 'การตรวจ', 'หมายเหตุผู้ตรวจ', 'ข้อสงสัยที่ระบบพบ', 'หลักฐานในแบบ'],
    ...reviewRows,
  ]), '7. บันทึกการตรวจทาน');

  // Sheet 8: every reviewer action with values before → after, so each number traces back to who changed it
  const log: any[] = result.reviewLog || [];
  if (log.length) {
    const kind: Record<string, string> = { edit: 'แก้ค่า', decision: 'ตัดสิน', add: 'เพิ่มชิ้นส่วน' };
    const dec: Record<string, string> = { approved: 'อนุมัติ', rejected: 'ไม่นับ', cleared: 'ยกเลิกการตัดสิน' };
    const v = (x: any) => (x === undefined || x === null || x === '' ? '' : x);
    const rows = [...log].sort((a, b) => a.at.localeCompare(b.at)).flatMap(e => {
      const base = [new Date(e.at).toLocaleString('th-TH'), kind[e.kind] || e.kind, e.tags.join(', '), e.indices.length, e.decision ? dec[e.decision] : '', e.note || '', e.undoneAt ? `ย้อนแล้ว ${new Date(e.undoneAt).toLocaleString('th-TH')}` : ''];
      return e.changes.length ? e.changes.map((c: any) => [...base, c.label, v(c.from), v(c.to)]) : [[...base, '', '', '']];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['เวลา', 'การกระทำ', 'เบอร์', 'จำนวนชิ้น', 'การตัดสิน', 'หมายเหตุ', 'สถานะ', 'ค่า', 'เดิม', 'ใหม่'],
      ...rows,
    ]), '8. ประวัติการแก้');
  }

  return wb;
}

export function workbookFileName(projectName: string) {
  return `BOQ_${(projectName || 'Project').replace(/\.[^/.]+$/, '').replace(/\s+/g, '_')}_Takeoff.xlsx`;
}
