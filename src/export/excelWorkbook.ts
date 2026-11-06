/**
 * StructBOQ - Excel workbook (ปร.4 / ปร.5 / BOQ comparison / review log).
 * Shared by the browser (direct download) and the optional Node server.
 */
import * as XLSX from 'xlsx';
import { CALC_ENGINE_VERSION, CONFLICT_FIELD, conflictText, engineIdentity, REQUIRED_SPECS, specValueText, DEFAULT_MATERIAL_SPECS } from '../engine/qsEngine';

export function buildBoqWorkbook(result: any): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1: BOQ Summary (ภาษาไทย)
  const hasProvisionalReview = (result.needsReviewCount || 0) > 0 || (result.rejectedCount || 0) > 0;
  const summaryData = [
    ['เอกสารสรุปปริมาณงาน (BILL OF QUANTITIES - BOQ) - งานคอนกรีตโครงสร้าง'],
    [`โครงการ: ${result.projectName || 'โครงการก่อสร้าง'} | มาตรฐานการวัด: วสท. / กรมบัญชีกลาง (SMM)`],
    [`วันที่ถอดแบบ: ${new Date().toLocaleDateString('th-TH')} | เครื่องมือ: StructBOQ AI Engine`],
    ...(hasProvisionalReview ? [
      [`⚠️ ข้อควรระวัง: มีรายการรอตรวจสอบ (NEEDS_REVIEW) จำนวน ${result.needsReviewCount} รายการ และปฏิเสธ ${result.rejectedCount} รายการ — ยอดรวมในรายงานนี้เป็นยอดประมาณการเบื้องต้น (Provisional Quantity) ต้องผ่านการตรวจสอบโดยวิศวกร/QS ก่อนใช้เป็นราคากลางอนุมัติ`]
    ] : []),
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
    'คอนกรีตสุทธิ (Net Vol ลบ.ม.)', 'ไม้แบบ (Formwork ตร.ม.)', 'เหล็กเสริม (Rebar กก.)', 'รวมเงิน (Total THB)',
    'ความมั่นใจ (%)', 'ระดับที่มา (Provenance)', 'สถานะการตรวจ (Status)', 'ข้อสังเกต/คำเตือน (Review Warnings)', 'สมการและสูตรคำนวณ (Traceable Formula)', 'หลักฐานจากแบบแปลน (Source)',
    'ระยะหุ้มที่ใช้ (ซม.)', 'ที่มาระยะหุ้ม'
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
    it.confidencePct ?? 95,
    it.provenanceLevel || 'UNKNOWN',
    it.status,
    (it.reviewWarnings && it.reviewWarnings.length > 0) ? it.reviewWarnings.join('; ') : '-',
    it.formulaStr,
    it.sourceInfo || '-',
    it.coverM !== undefined ? Number((it.coverM * 100).toFixed(1)) : '',
    it.coverSource || '',
  ]);
  const wsDetails = XLSX.utils.aoa_to_sheet([detailedHeaders, ...detailedRows]);
  XLSX.utils.book_append_sheet(wb, wsDetails, '2. รายการถอดแบบละเอียด');

  // Sheet 2.1: ตารางดัดและตัดเหล็กเสริมละเอียด (Bar Cut & Bend Schedule)
  const rebarHeaders = [
    'รหัสรายการ (Item ID)', 'เบอร์โครงสร้าง (Tag)', 'ประเภท (Type)', 'ตำแหน่งกริด (Grid)', 'ระดับชั้น (Level)',
    'สถานะการตรวจ (Status)', 'เบอร์เหล็ก (Bar)', 'ชั้นคุณภาพ (Grade)', 'ขนาด (เส้นผ่านศูนย์กลาง มม.)', 'หน้าที่การเสริม (Purpose)',
    'จำนวนเส้นรวมทุกชิ้น (Pieces)', 'ความยาวตัดต่อเส้น (Cut Length ม.)', 'ความยาวรวม (Total Length ม.)',
    'น้ำหนักต่อเมตร (kg/m)', 'น้ำหนักรวม (Total Weight กก.)', 'ลวดผูกเหล็ก 2.5% (กก.)',
    'สมมติฐาน/ข้อสงสัยเหล็ก (ไม่ใช่ค่าจากแบบ)',
    'RebarSet ID', 'ทิศ', 'การจัด', 'ระยะเรียง (มม.)', 'ชั้น', 'ที่มาของชุด', 'สถานะชุด', 'ข้อความในแบบ', 'ยอด'
  ];
  const DIR: Record<string, string> = { X: 'X', Y: 'Y', BOTH: 'ทั้ง 2 ทิศ', UNSPECIFIED: 'ไม่ระบุ' };
  // a released or approved figure is final; anything still in review is provisional
  const figure = (it: any) => (it.status === 'AUTO_RELEASE' ? (it.review ? 'อนุมัติ' : 'ผ่านอัตโนมัติ') : 'ยอดชั่วคราว (รอตรวจ)');
  const rebarRows: any[] = [];
  for (const it of result.items) {
    if (it.status === 'REJECTED' || (!it.rebarDetails?.barList?.length && !it.rebarDetails?.sets?.length)) continue;
    // what in this member's steel the drawing did not give (assumed bars, hooks, direction, raised counts)
    const rebarDoubts = (it.flags || []).filter((f: any) => f.severity !== 'info' && ['rebar', 'bottomRebar', 'topRebar', 'stirrupRebar'].includes(f.field)).map((f: any) => f.message).join('; ');
    const sets: any[] = it.rebarDetails.sets || [];
    const setCols = (r: any) => r
      ? [r.id, '', r.set.arrangement, r.set.spacingMm ?? '', r.set.layer === 'TOP' ? 'บน' : 'ล่าง', r.provenanceLevel, r.status, r.set.sourceText || '']
      : ['', '', '', '', '', '', '', ''];
    for (const b of it.rebarDetails.barList) {
      const r = sets.find(x => x.id === b.setId);
      const cols = setCols(r);
      if (r) cols[1] = DIR[b.direction] || b.direction;
      const wire = Number((b.totalWeightKg * 0.025).toFixed(2));
      rebarRows.push([
        it.itemId,
        it.tag,
        typeTranslations[it.memberType] || it.memberType,
        it.gridLocation || '-',
        it.level || 'Story 1',
        it.status,
        b.bar,
        b.grade,
        b.diaMm,
        b.purpose,
        b.count,
        b.lengthM,
        b.totalLengthM,
        b.unitWeightKgM,
        b.totalWeightKg,
        wire,
        r ? r.reasons.join('; ') : rebarDoubts,
        ...cols,
        figure(it),
      ]);
    }
    // a set that could not be calculated still gets its row (weight 0 and why), never dropped
    for (const r of sets.filter(x => x.status === 'BLOCKED')) {
      const cols = setCols(r);
      cols[1] = DIR[r.set.direction] || r.set.direction;
      rebarRows.push([it.itemId, it.tag, typeTranslations[it.memberType] || it.memberType, it.gridLocation || '-', it.level || 'Story 1', it.status,
        r.set.diameterMm ? `${r.set.barType || 'DB'}${r.set.diameterMm}` : '', '', r.set.diameterMm ?? '', 'คิดไม่ได้', r.set.quantity ?? '', '', 0, '', 0, 0,
        r.reasons.join('; '), ...cols, 'คิดไม่ได้ — ไม่รวมในยอด']);
    }
  }
  if (rebarRows.length) {
    const wsRebar = XLSX.utils.aoa_to_sheet([
      ['ใช้ถอดปริมาณเท่านั้น — ไม่ใช่ BBS สำหรับสั่งตัด/ดัดเหล็ก: ต้องมี Shop Drawing ที่วิศวกรตรวจอนุมัติ · แถว "ยอดชั่วคราว" ยังไม่ผ่านการตรวจ'],
      rebarHeaders, ...rebarRows,
    ]);
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
  const stateTh: Record<string, string> = {
    APPROVED: 'อนุมัติ (fingerprint ตรง)', STALE: 'อนุมัติหมดอายุ — ค่าที่ใช้คำนวณเปลี่ยน', NEEDS_REVIEW: 'รอตรวจ', REJECTED: 'ไม่นับ',
  };
  const qty = (q: any) => (q ? `คอนกรีต ${q.concreteM3} ลบ.ม. · เหล็ก ${Number(q.rebarKg).toFixed(2)} กก. · ${Number(q.costThb).toFixed(2)} บาท` : '');
  const reviewRows = result.items.map((it: any) => {
    const rv = it.review || it.staleApproval;
    return [
      it.itemId, it.tag, it.memberType, it.gridLocation, it.level, it.status,
      it.confidencePct ?? '-',
      it.approvalState ? stateTh[it.approvalState] : (it.status === 'AUTO_RELEASE' ? 'ผ่านอัตโนมัติ' : 'ยังไม่ตรวจ'),
      rv?.note || '',
      rv?.by || '',
      rv?.revision || '',
      rv?.fingerprint || '',
      rv?.snapshot?.engineVersion || '',
      rv?.snapshot?.engineId || '',
      qty(rv?.quantities),
      rv?.status === 'approved' ? qty({ concreteM3: it.volumeNetM3, rebarKg: it.rebarWeightKg || 0, costThb: it.totalCostThb || 0 }) : '',
      (it.staleChanges || []).join('; '),
      (it.flags || []).map((f: any) => f.message).join('; '),
      (it.provenance?.evidence || []).map((e: any) => `${e.label} น.${e.page}`).join('; '),
    ];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    [`ไฟล์แบบ: ${result.revision || 'ไม่มีไฟล์ต้นฉบับ (ตัวอย่าง/ชุดข้อมูล)'} · engine ${CALC_ENGINE_VERSION} (${engineIdentity.id}) · ชื่อผู้ตรวจเป็นชื่อที่พิมพ์ ไม่ได้ยืนยันตัวตน`],
    ['รหัส', 'เบอร์', 'ประเภท', 'กริด', 'ชั้น', 'สถานะ', 'ความมั่นใจ %', 'สถานะการอนุมัติ', 'หมายเหตุผู้ตรวจ', 'ผู้ตรวจ', 'ไฟล์แบบที่ตรวจ',
      'Fingerprint (SHA-256)', 'Engine ตอนอนุมัติ', 'Engine ID ตอนอนุมัติ', 'ยอดตอนอนุมัติ', 'ยอดปัจจุบัน', 'ค่าที่เปลี่ยนหลังอนุมัติ', 'ข้อสงสัยที่ระบบพบ', 'หลักฐานในแบบ'],
    ...reviewRows,
  ]), '7. บันทึกการตรวจทาน');

  // Sheet 7.1: every quantity-relevant spec value, where it came from, and how many items used it
  const specs = { ...DEFAULT_MATERIAL_SPECS, ...(result.materialSpecs || {}) };
  const srcTh: Record<string, string> = { user: 'ผู้ใช้กรอก', drawing_notes: 'หมายเหตุในแบบ', assumption: 'สมมติฐานที่บันทึก' };
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ค่าสเปกที่กระทบปริมาณ — "ไม่มีที่มา" = ค่าเริ่มต้นในโปรแกรมที่ไม่มีใครให้ รายการที่ใช้ค่านั้นอนุมัติปล่อยยอดไม่ได้'],
    ['ค่า', 'ค่าที่ใช้', 'ที่มา', 'เหตุผล/หมายเหตุ', 'ผู้ยืนยัน', 'เวลา', 'กระทบ', 'จำนวนรายการที่ใช้'],
    ...REQUIRED_SPECS.map(r => {
      const vs = specs.valueSources?.[r.key];
      return [r.label, specValueText(r.key, (specs as any)[r.key]), vs ? srcTh[vs.source] || vs.source : 'ไม่มีที่มา (ค่าเริ่มต้น)', vs?.note || '', vs?.by || '', vs?.at || '', r.affects,
        result.items.filter((it: any) => it.specKeysUsed?.includes(r.key)).length];
    }),
  ]), '7.1 สมมติฐานสเปก');

  // Sheet 7.2: values the drawing's sources disagree on, and who ruled what, from which page, why and when
  const cState: Record<string, string> = { open: 'ยังไม่ตัดสิน', deferred: 'ส่งกลับตรวจเพิ่ม', invalid: 'การตัดสินไม่ครบ (ไม่มีชื่อ/เหตุผล)', mismatch: 'ค่าเปลี่ยนหลังตัดสิน', resolved: 'ตัดสินแล้ว' };
  const conflictRows = result.items.flatMap((it: any) => (it.conflicts || []).map((c: any) => {
    const r = c.resolution;
    return [it.itemId, it.tag, it.gridLocation, CONFLICT_FIELD[c.conflict.field as keyof typeof CONFLICT_FIELD].label, c.conflict.kind === 'UNDECIDABLE' ? 'เทียบไม่ได้' : 'ขัดแย้ง', conflictText(c.conflict),
      cState[c.state], r?.before ?? '', r && r.choice !== 'deferred' ? r.value : '', r?.choice === 'source' ? (r.sourcePage ?? 'ไม่มีเลขหน้า') : r?.choice === 'manual' ? 'กรอกเอง' : '', r?.by || '', r?.reason || '', r?.at || '',
      it.approvalState ? stateTh[it.approvalState] : (it.status === 'AUTO_RELEASE' ? 'ผ่านอัตโนมัติ' : 'ยังไม่ตรวจ')];
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ค่าที่แหล่งข้อมูลในแบบขัดแย้งกัน — ระบบไม่เลือกค่าให้ รายการที่ยังไม่ตัดสินอนุมัติปล่อยยอดไม่ได้; ค่าที่ผู้ตรวจตัดสินเป็นค่าของผู้ตรวจ ไม่ใช่ค่าที่ยืนยันจากแบบ'],
    ['รหัส', 'เบอร์', 'กริด', 'ค่า', 'ชนิด', 'แหล่งข้อมูล (ค่า · หน้าต้นฉบับ · อ้างอิง)', 'สถานะ', 'ค่าเดิม', 'ค่าที่ตัดสิน', 'หน้าที่ใช้ตัดสิน', 'ผู้ตรวจ', 'เหตุผล', 'เวลาตัดสิน', 'สถานะการอนุมัติ'],
    ...conflictRows,
  ]), '7.2 ค่าขัดแย้งระหว่างแหล่ง');

  // Sheet 7.3: occurrences of one reference that may be one physical instance, how they were ruled, and what is counted
  const dClass: Record<string, string> = { SAME_PHYSICAL_INSTANCE: 'ชิ้นเดียวกัน (ตำแหน่งเดียวกัน)', POSSIBLE_DUPLICATE: 'อาจซ้ำ', DISTINCT_PHYSICAL_INSTANCES: 'คนละชิ้น (คนละตำแหน่ง)', CONFLICTING_SPECIFICATION: 'ค่าขัดแย้ง', INSUFFICIENT_EVIDENCE: 'หลักฐานไม่พอ' };
  const dDec: Record<string, string> = { SAME_INSTANCE: 'ชิ้นเดียวกัน', DISTINCT: 'คนละชิ้น', DEFERRED: 'ส่งกลับตรวจสอบ', UNDECIDED: 'ยังตัดสินไม่ได้' };
  const dState: Record<string, string> = { info: 'ไม่ต้องตัดสิน', open: 'ยังไม่ตัดสิน', invalid: 'การตัดสินใช้ไม่ได้', decided: 'ตัดสินแล้ว' };
  const dupRows = result.items.filter((it: any) => it.duplicate).map((it: any) => {
    const g = it.duplicate.group, k = g.members.indexOf(it.memberIndex), o = g.occurrences[k] || {};
    return [it.tag, it.duplicate.instanceId, it.itemId, o.page ?? '', o.location ?? 'ไม่มีตำแหน่งในผัง', o.spec ?? '', dClass[g.classification] || g.classification, g.evidence.join(' · '),
      dState[g.state] + (g.problem ? ': ' + g.problem : ''), g.decision ? dDec[g.decision.decision] : '', g.decision?.by || '', g.decision?.reason || '', g.decision?.at || '',
      it.duplicate.counted ? 'นับ' : `ไม่นับ (ลิงก์กับ ${it.duplicate.linkedTo})`, it.volumeNetM3,
      it.approvalState ? stateTh[it.approvalState] : (it.status === 'AUTO_RELEASE' ? 'ผ่านอัตโนมัติ' : it.status === 'REJECTED' ? 'ไม่นับ' : 'ยังไม่ตรวจ')];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['เบอร์เดียวกันที่อาจเป็นชิ้นเดียวกัน — ระบบไม่ลบหรือรวมเอง; รวมเป็นชิ้นเดียวเมื่อผู้ตรวจยืนยันเท่านั้น และนับที่รายการแรกครั้งเดียว'],
    ['เบอร์ (Member Reference)', 'Physical Instance ID', 'รายการ (Source Occurrence)', 'หน้าต้นฉบับ', 'ตำแหน่ง/กริด', 'ค่า', 'การจำแนก', 'หลักฐาน', 'สถานะ', 'คำตัดสิน', 'ผู้ตรวจ', 'เหตุผล', 'เวลาตัดสิน', 'นับในยอด', 'คอนกรีต (ลบ.ม.)', 'สถานะการอนุมัติ'],
    ...dupRows,
  ]), '7.3 ตรวจรายการซ้ำ');

  // Sheet 8: every reviewer action with values before → after, so each number traces back to who changed it
  const log: any[] = result.reviewLog || [];
  if (log.length) {
    const kind: Record<string, string> = { edit: 'แก้ค่า', decision: 'ตัดสิน', add: 'เพิ่มชิ้นส่วน' };
    const dec: Record<string, string> = { approved: 'อนุมัติ', rejected: 'ไม่นับ', cleared: 'ยกเลิกการตัดสิน' };
    const v = (x: any) => (x === undefined || x === null || x === '' ? '' : x);
    const itemIds = (idx: number[]) => idx.map(i => result.items.find((it: any) => it.memberIndex === i)?.itemId || `#${i + 1}`).join(', ');
    const rows = [...log].sort((a, b) => a.at.localeCompare(b.at)).flatMap(e => {
      const where = e.refs ? e.refs.map((r: any) => `${r.itemId || ''} ${r.tag} @${r.grid || '-'} ${r.level || ''}`.trim()).join(', ') : itemIds(e.indices);
      const fps = (a?: string[]) => (a || []).map(f => f.slice(0, 16)).join(', ');
      const base = [new Date(e.at).toLocaleString('th-TH'), kind[e.kind] || e.kind, e.tags.join(', '), where, e.decision ? dec[e.decision] : '', e.note || '', e.by || '', e.revision || '', fps(e.fingerprintBefore), fps(e.fingerprintAfter), e.undoneAt ? `ย้อนแล้ว ${new Date(e.undoneAt).toLocaleString('th-TH')}` : ''];
      return e.changes.length ? e.changes.map((c: any) => [...base, c.label, v(c.from), v(c.to)]) : [[...base, '', '', '']];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['เวลา', 'การกระทำ', 'เบอร์', 'ชิ้น (รหัส เบอร์ @กริด ชั้น)', 'การตัดสิน', 'หมายเหตุ', 'ผู้ตรวจ', 'ไฟล์แบบ', 'Fingerprint ก่อน', 'Fingerprint หลัง', 'สถานะ', 'ค่า', 'เดิม', 'ใหม่'],
      ...rows,
    ]), '8. ประวัติการแก้');
  }

  return wb;
}

export function workbookFileName(projectName: string) {
  return `BOQ_${(projectName || 'Project').replace(/\.[^/.]+$/, '').replace(/\s+/g, '_')}_Takeoff.xlsx`;
}
