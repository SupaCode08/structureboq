export type Language = 'th' | 'en';

export const translations = {
  th: {
    appName: 'StructBOQ',
    appSubtitle: 'ระบบ AI ถอดปริมาณงานโครงสร้างคอนกรีต (คานและเสา) อัตโนมัติ',
    engineBadge: 'QS Engine v1.0 • มยผ./วสท.',
    tabTakeoff: 'ถอดปริมาณ BOQ',
    tabManual: 'คำนวณเอง',
    tabBenchmark: 'ทดสอบความแม่นยำ Ground Truth',
    exportExcel: 'ส่งออก Excel',
    exporting: 'กำลังสร้างไฟล์ Excel...',
    standardNotice: 'มาตรฐานการวัด: วสท. / แนวทางคำนวณราคากลางงานก่อสร้าง กรมบัญชีกลาง',
    deductionNotice: 'กฎการหักปริมาตร: หักจุดตัดรอยต่อคาน-เสา',
    statusNotice: 'ระบบตรวจสอบ 3 สถานะ: ผ่านเกณฑ์อัตโนมัติ | ต้องตรวจสอบ | ปฏิเสธ',
    
    // Upload Section
    uploadTitle: 'อัปโหลดแบบก่อสร้าง',
    uploadSub: 'รองรับไฟล์ไม่เกิน 25MB • แปลง DWG เป็น DXF ก่อนอัปโหลด',
    dropzoneIdle: 'ลากและวางไฟล์ .PDF หรือ .DXF ที่นี่ หรือคลิกเพื่อเลือกไฟล์',
    dropzoneDesc: 'ระบบจะสกัดตารางรายการคาน, แปลนโครงสร้าง, เลเยอร์ CAD, เบอร์คาน, มิติหน้าตัด และคำนวณการหักจุดตัดเสาให้อัตโนมัติ',
    processingTitle: 'กำลังสกัดข้อมูลเลเยอร์โครงสร้าง ข้อความ และมิติหน้าตัด...',
    processingSub: 'ประมวลผลผ่าน Python Quantity Engine พร้อมตรวจสอบสูตรวิศวกรรม',
    preloadedTitle: 'ชุดข้อมูลทดสอบ Ground Truth ที่ผ่านการรับรอง',
    preloadedDesc: 'ทดสอบกับข้อมูลจำลองโครงสร้างที่คำนวณและตรวจสอบโดยวิศวกรผู้เชี่ยวชาญ:',
    downloadTitle: 'ดาวน์โหลดแบบแปลนตัวอย่าง:',
    villaSample: 'คานบ้านพักอาศัย',
    warehouseSample: 'คานโรงงาน/เสา',
    scheduleSample: 'ตารางคาน',
    aiVisionToggle: 'เปิดใช้งาน Gemini 2.5 Flash Vision AI สำหรับแบบสแกน / Scanned Blueprints',
    aiVisionActiveBadge: 'ใช้งาน Gemini 2.5 Flash AI Vision',
    fileInfoUnits: 'หน่วยที่ตรวจพบ:',
    fileInfoEntities: 'องค์ประกอบที่ตรวจพบ:',
    fileInfoLayers: 'เลเยอร์ / หน้า',

    // Summary Cards
    netConcrete: 'คอนกรีตโครงสร้างสุทธิ',
    netConcreteSub: 'หักจุดตัดรอยต่อเสาแล้ว',
    formworkArea: 'พื้นที่ไม้แบบสัมผัส',
    formworkSub: '2 ข้างคาน + ท้องคาน',
    autoRelease: 'ผ่านเกณฑ์อัตโนมัติ',
    autoReleaseSub: 'ผ่านเกณฑ์มาตรฐานวิศวกรรมครบถ้วน',
    needsReview: 'ต้องตรวจสอบเพิ่มเติม',
    needsReviewSub: 'มีข้อสังเกต / สแปนกำกวม',
    rejected: 'ปฏิเสธการคำนวณ',
    rejectedSub: 'มิติผิดปกติ (ศูนย์, ติดลบ, ข้อมูลซ้ำ)',
    unitM3: 'ลบ.ม.',
    unitM2: 'ตร.ม.',
    unitKg: 'กก.',
    unitBaht: 'บาท',
    itemsCount: 'รายการ',

    // Table
    searchPlaceholder: 'ค้นหาเบอร์คาน, ตำแหน่งกริด, สูตรคำนวณ...',
    allTypes: 'ทุกประเภท',
    beamsOnly: 'เฉพาะคาน',
    columnsOnly: 'เฉพาะเสา',
    allStatuses: 'ทุกสถานะ',
    autoReleaseOnly: 'ผ่านเกณฑ์อัตโนมัติเท่านั้น',
    needsReviewOnly: 'ต้องตรวจสอบเท่านั้น',
    rejectedOnly: 'ปฏิเสธเท่านั้น',
    colItemId: 'รหัสรายการ',
    colTag: 'เบอร์คาน/เสา',
    colLocation: 'ตำแหน่งกริด / ชั้น',
    colQty: 'จำนวน',
    colDim: 'กว้าง × ลึก (ม.)',
    colGrossL: 'ยาวรวม (ม.)',
    colDeduction: 'หักจุดตัด (ม.)',
    colNetL: 'ยาวสุทธิ (ม.)',
    colNetVol: 'คอนกรีตสุทธิ (ลบ.ม.)',
    colFormwork: 'ไม้แบบ (ตร.ม.)',
    colRebar: 'เหล็กเสริม (กก.)',
    colEstCost: 'ประมาณการ (บาท)',
    colStatus: 'สถานะ',
    colAudit: 'ตรวจที่มา',
    btnTrace: 'ตรวจสอบ',
    noItems: 'ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา',
    tableFooterShowing: 'แสดง',
    tableFooterOf: 'จากทั้งหมด',
    tableFooterHint: 'กด "ตรวจสอบ" เพื่อดูที่มาของขนาด สูตรคำนวณ และการหักจุดตัดทีละขั้นตอน',

    // Modal
    modalTitle: 'การตรวจสอบย้อนกลับและสูตรคำนวณเชิงวิศวกรรม',
    modalMember: 'องค์ประกอบโครงสร้าง:',
    modalFormulaSection: 'สมการคำนวณปริมาณงานทีละขั้นตอน',
    modalWidth: 'ความกว้าง',
    modalDepth: 'ความลึก',
    modalGrossSpan: 'ระยะความยาวรวม',
    modalNetSpan: 'ระยะความยาวสุทธิ',
    modalDeductionSection: 'การวิเคราะห์การหักจุดตัดเสา-คาน (ไม่คิดปริมาตรซ้ำซ้อน)',
    modalNoDeduction: 'ไม่มีการหักจุดตัดเสา (เป็นระยะ Clear Span หรือเป็นองค์ประกอบเสา)',
    modalSourceSection: 'หลักฐานจากแบบแปลนและเลเยอร์ CAD/PDF',
    modalProvenance: 'เส้นทางการตรวจพบ:',
    modalClose: 'ปิดหน้าต่างตรวจสอบ',
    modalCostEstimate: 'ประมาณการราคาก่อสร้างเบื้องต้น (ตามบัญชีราคา ปร.4)',

    // Benchmark Tab
    benchTitle: 'การทดสอบความแม่นยำเทียบกับ Ground Truth',
    benchSub: 'ประเมินผลการถอดแบบของ AI เทียบกับผลการคำนวณจริงของ Senior Quantity Surveyor วัดความคลาดเคลื่อนทั้งระดับโครงการและระดับรายการ',
    benchSelectProject: 'เลือกชุดข้อมูลทดสอบ:',
    benchSpecs: 'ข้อกำหนดวิศวกรรมและบันทึกแบบแปลน:',
    benchCardComputed: 'ผลการคำนวณ',
    benchCardGT: 'ค่า Ground Truth',
    benchProjectVariance: 'ความคลาดเคลื่อนโครงการ:',
    benchExact: '0.00% (ตรงกันสมบูรณ์)',
    benchElementMatch: 'อัตราความถูกต้องระดับรายการ',
    benchStatusDist: 'การกระจายสถานะผลลัพธ์',
    benchAuditResult: 'ผลการตรวจสอบ',
    benchPassed: 'ผ่านเกณฑ์',
    benchReview: 'ต้องทบทวน',
    benchTableTitle: 'ตารางเปรียบเทียบผลลัพธ์ระดับองค์ประกอบทีละรายการ',

    // Manual Sandbox Tab
    sandboxTitle: 'คำนวณชิ้นส่วนเอง',
    sandboxSub: 'ป้อนขนาดและเหล็กเสริม ดูปริมาณและราคา แล้วเพิ่มเข้าโครงการได้',
    memberTypeLabel: 'ประเภทองค์ประกอบโครงสร้าง',
    tagLabel: 'เบอร์หรือชื่อกำกับ',
    gridLabel: 'ตำแหน่งกริดเสา',
    levelLabel: 'ระดับชั้น',
    unitSelectLabel: 'หน่วยวัดที่ป้อน',
    widthLabel: 'ความกว้างหน้าตัด (b หรือ c_x)',
    depthLabel: 'ความลึกหน้าตัด (d หรือ c_y)',
    spanLabel: 'ความยาวช่วงคานหรือความสูงเสา (Gross L หรือ H)',
    countLabel: 'จำนวนชิ้น',
    isClearSpanLabel: 'เป็นระยะช่วงเคลียร์ในถึงในแล้ว (Clear Span - ไม่ต้องหักเสา)',
    colW1Label: 'ความกว้างเสารองรับด้านซ้าย/ต้นแรก',
    colW2Label: 'ความกว้างเสารองรับด้านขวา/ต้นที่สอง',
    rebarTopLabel: 'เหล็กแกนบน',
    rebarBtmLabel: 'เหล็กแกนล่าง',
    rebarStirrupLabel: 'เหล็กปลอก',
    btnCalculate: 'คำนวณปริมาณงานทันที',
    btnAddToProject: 'เพิ่มรายการนี้เข้าสู่ตาราง BOQ ของโครงการ',
    sandboxResultTitle: 'ผลการคำนวณและตรวจสอบมิติ',
    calculatedNotice: 'คำนวณตามสูตรวิศวกรรมสำเร็จ สามารถกดเพิ่มเข้าสู่โครงการได้ทันที',

    // Footer
    footerNote: 'StructBOQ • ระบบถอดปริมาณงานโครงสร้างระดับปฏิบัติการ',
    footerStandard: 'ตามมาตรฐาน วสท. และแนวทางคำนวณราคากลางงานก่อสร้าง กรมบัญชีกลาง',
  },
  en: {
    appName: 'StructBOQ',
    appSubtitle: 'Automated Quantity Takeoff for Structural Concrete (Beams & Columns)',
    engineBadge: 'QS Engine v1.0 • Standard',
    tabTakeoff: 'BOQ Takeoff',
    tabManual: 'Live Sandbox',
    tabBenchmark: 'Ground Truth Validation',
    exportExcel: 'Export Excel (.xlsx)',
    exporting: 'Generating Excel...',
    standardNotice: 'Standard: SMM / Thailand Comptroller General Structural Concrete Standard',
    deductionNotice: 'Deduction: Column support intersection (Lc - w_col) applied',
    statusNotice: '3-Tier Status: AUTO_RELEASE | NEEDS_REVIEW | REJECTED',
    
    // Upload Section
    uploadTitle: 'Upload Construction Drawing (PDF / DXF)',
    uploadSub: 'Max 25MB • DWG to DXF supported',
    dropzoneIdle: 'Drag and drop your .PDF or .DXF here, or click to browse',
    dropzoneDesc: 'Parses Beam Schedules, Framing Plans, CAD Layers, Tags (B1, B2, C1), Section Dimensions, and Support Joint Deductions',
    processingTitle: 'Extracting structural layers, text streams, and dimensions...',
    processingSub: 'Running Python Quantity Engine with engineering formula verification',
    preloadedTitle: 'Preloaded Verified Ground Truth Cases',
    preloadedDesc: 'Load realistic ground-truth structural projects tested against senior Quantity Surveyor calculations:',
    downloadTitle: 'Download test blueprints:',
    villaSample: 'Villa (.dxf)',
    warehouseSample: 'Warehouse (.dxf)',
    scheduleSample: 'Schedule (.pdf)',
    aiVisionToggle: 'Enable Gemini 2.5 Flash Vision AI for Scanned Blueprints',
    aiVisionActiveBadge: 'Powered by Gemini 2.5 Flash AI Vision',
    fileInfoUnits: 'Detected Unit:',
    fileInfoEntities: 'Entities parsed:',
    fileInfoLayers: 'layers / pages',

    // Summary Cards
    netConcrete: 'Net Concrete',
    netConcreteSub: 'Deductions subtracted',
    formworkArea: 'Formwork Area',
    formworkSub: '2 sides + soffit contact',
    autoRelease: 'Auto-Release',
    autoReleaseSub: 'Passed all engineering rules',
    needsReview: 'Needs Review',
    needsReviewSub: 'Advisory checks / Ambiguity',
    rejected: 'Rejected',
    rejectedSub: 'Blocked (zeros, neg, dups)',
    unitM3: 'm³',
    unitM2: 'm²',
    unitKg: 'kg',
    unitBaht: 'THB',
    itemsCount: 'items',

    // Table
    searchPlaceholder: 'Search Tag (B1, C1), Grid, Formula...',
    allTypes: 'All Types',
    beamsOnly: 'Beams',
    columnsOnly: 'Columns',
    allStatuses: 'All Statuses',
    autoReleaseOnly: 'Auto-Release Only',
    needsReviewOnly: 'Needs Review Only',
    rejectedOnly: 'Rejected Only',
    colItemId: 'Item ID',
    colTag: 'Tag',
    colLocation: 'Location / Grid',
    colQty: 'Qty',
    colDim: 'Width × Depth (m)',
    colGrossL: 'Gross L (m)',
    colDeduction: 'Deduction (m)',
    colNetL: 'Net L (m)',
    colNetVol: 'Net Vol (m³)',
    colFormwork: 'Formwork (m²)',
    colRebar: 'Rebar (kg)',
    colEstCost: 'Cost (THB)',
    colStatus: 'Status',
    colAudit: 'Audit',
    btnTrace: 'Trace',
    noItems: 'No elements matching the selected filters.',
    tableFooterShowing: 'Showing',
    tableFooterOf: 'of',
    tableFooterHint: 'Click "Trace" on any row to inspect deduction breakdown and drawing source annotation',

    // Modal
    modalTitle: 'Element Traceability & Formula Audit',
    modalMember: 'Structural Member:',
    modalFormulaSection: 'Step-by-Step Quantity Equation',
    modalWidth: 'Width (b)',
    modalDepth: 'Depth (d)',
    modalGrossSpan: 'Gross Span',
    modalNetSpan: 'Net Clear Span',
    modalDeductionSection: 'Support Deduction Analysis (No Double-Counting)',
    modalNoDeduction: 'No support deductions subtracted (Clear span or Column element).',
    modalSourceSection: 'Source Drawing Evidence & CAD/PDF Trace',
    modalProvenance: 'Provenance Trace:',
    modalClose: 'Close Inspector',
    modalCostEstimate: 'Preliminary Cost Estimate (Por Ror 4 Rates)',

    // Benchmark Tab
    benchTitle: 'Ground Truth Accuracy & Variance Benchmark',
    benchSub: 'Evaluates AI extraction against Ground Truth verified by certified Senior Quantity Surveyors. Measures project-level volume variance, formwork variance, and element-level classification compliance.',
    benchSelectProject: 'Select Test Dataset:',
    benchSpecs: 'Dataset Engineering Specifications & Blueprint Notes:',
    benchCardComputed: 'Computed (AI)',
    benchCardGT: 'Ground Truth',
    benchProjectVariance: 'Project Variance:',
    benchExact: '0.00% (Exact Match)',
    benchElementMatch: 'Element Match Rate',
    benchStatusDist: 'Engine Status Distribution',
    benchAuditResult: 'Audit Result',
    benchPassed: 'PASSED',
    benchReview: 'REVIEW',
    benchTableTitle: 'Element-by-Element Ground Truth Comparison',

    // Manual Sandbox Tab
    sandboxTitle: 'Manual Element Calculator & Live Sandbox',
    sandboxSub: 'Directly test engineering formulas, input section dimensions, set reinforcement, and inspect support deductions with 3-tier validation.',
    memberTypeLabel: 'Structural Member Type',
    tagLabel: 'Tag / Identifier',
    gridLabel: 'Grid Location',
    levelLabel: 'Level / Story',
    unitSelectLabel: 'Input Dimension Unit',
    widthLabel: 'Width (b or c_x)',
    depthLabel: 'Depth (d or c_y)',
    spanLabel: 'Gross Span or Height (L or H)',
    countLabel: 'Count / Quantity',
    isClearSpanLabel: 'Clear Span already measured (No column deduction needed)',
    colW1Label: 'Left Support Column Width (Col W1)',
    colW2Label: 'Right Support Column Width (Col W2)',
    rebarTopLabel: 'Top Main Rebars',
    rebarBtmLabel: 'Bottom Main Rebars',
    rebarStirrupLabel: 'Stirrup Rebars',
    btnCalculate: 'Calculate Quantities',
    btnAddToProject: 'Add to Project BOQ Table',
    sandboxResultTitle: 'Calculation Breakdown & Validation Result',
    calculatedNotice: 'Calculated according to structural standards. You can add it to the active takeoff.',

    // Footer
    footerNote: 'StructBOQ • Production-Grade Structural Quantity Takeoff Engine',
    footerStandard: 'Compliant with SMM & Thai Comptroller General Concrete Standards',
  },
};

/**
 * Translates technical error messages / rejection reasons into friendly Thai
 */
export function translateMessage(msg: string, lang: Language): string {
  if (lang === 'en') return msg;

  const dictionary: Record<string, string> = {
    'Missing critical dimension (width, depth, or span is null)':
      'ข้อมูลมิติสำคัญไม่ครบถ้วน (ความกว้าง ความลึก หรือความยาวเป็นค่าว่าง)',
    'Width must be positive (> 0)': 'ความกว้างต้องมีค่ามากกว่า 0 ม.',
    'Depth/Y-dimension must be positive (> 0)': 'ความลึก/ความสูงหน้าตัดต้องมีค่ามากกว่า 0 ม.',
    'Length/Span must be positive (> 0)': 'ความยาวช่วงคานหรือความสูงต้องมีค่ามากกว่า 0 ม.',
    'Beam width is below structural minimum (0.10m)':
      'ความกว้างคานต่ำกว่าเกณฑ์ขั้นต่ำเชิงวิศวกรรมโครงสร้าง (0.10 ม.)',
    'Unusually wide beam; verify transfer girder or band beam':
      'คานมีความกว้างมากกว่าปกติ (ควรตรวจสอบว่าเป็นคานแบน Band Beam หรือ Transfer Girder)',
    'Beam depth is below structural minimum (0.15m)':
      'ความลึกคานต่ำกว่าเกณฑ์ขั้นต่ำวิศวกรรมโครงสร้าง (0.15 ม.)',
    'Unusually deep beam; verify transfer beam schedule':
      'คานมีความลึกมากเป็นพิเศษ (ตรวจสอบตารางคานถ่ายน้ำหนัก Transfer Beam)',
    'High aspect ratio d/b': 'อัตราส่วนความลึกต่อความกว้าง d/b เกิน 6.0 (เข้าข่ายคานลึก Deep Beam)',
    'Inverted aspect ratio d/b': 'อัตราส่วนหน้าตัดกลับด้าน (คานแบนหรือพื้นหนา)',
    'Beam span is shorter than support joint width':
      'ความยาวช่วงคานสั้นกว่าความกว้างของเสารองรับ',
    'Unusually long span; check drawing scale':
      'ความยาวช่วงคานยาวเป็นพิเศษ (ตรวจสอบสเกลแบบแปลน CAD)',
    'Column section below minimum 0.15x0.15m':
      'หน้าตัดเสาต่ำกว่าเกณฑ์ขั้นต่ำ 0.15 × 0.15 ม.',
    'Large column dimension; check shear wall':
      'หน้าตัดเสามีขนาดใหญ่เป็นพิเศษ (ควรตรวจสอบว่าเป็นผนังรับแรงเฉือน Shear Wall หรือไม่)',
    'Column height is too short (< 1.00m)':
      'ความสูงเสาสั้นเกินไป (< 1.00 ม.)',
    'Column height unusually high for single story':
      'ความสูงเสาสูงเกินเกณฑ์ปกติสำหรับชั้นเดียว (> 15 ม.)',
    'Center-to-center span detected without exact column support widths; verify net clear span':
      'ตรวจพบระยะวัดกึ่งกลางถึงกึ่งกลางเสา (Center-to-Center) โดยไม่มีความกว้างเสา หักจุดตัดไม่ได้ ต้องตรวจเช็ค Net Clear Span',
    'Net beam length after deduction <= 0':
      'ความยาวสุทธิของคานหลังหักจุดตัดเสาเหลือน้อยกว่าหรือเท่ากับ 0',
    'Duplicate entity detected':
      'ตรวจพบองค์ประกอบซ้ำซ้อน: คานเบอร์เดียวกันที่ตำแหน่งกริดเดียวกันถูกคำนวณไปแล้ว',
    'Calculated with advisory warnings; requires QS verification':
      'คำนวณได้แล้วแต่มีข้อสังเกตเชิงวิศวกรรม ควรให้ผู้เชี่ยวชาญตรวจสอบเพิ่มเติม',
    'Strict engineering rules and dimension bounds fully satisfied':
      'ผ่านเกณฑ์มาตรฐานวิศวกรรมโครงสร้างและการตรวจสอบมิติครบถ้วน',
    'Rejected by validation engine rules':
      'ระงับการคำนวณเนื่องจากไม่ผ่านเกณฑ์ความปลอดภัยของเครื่องมือตรวจสอบ',
    'CALCULATION_BLOCKED: Non-compliant input parameters':
      'ระงับการคำนวณ: ค่ามิติและพารามิเตอร์ผิดปกติหรือไม่สอดคล้องกับมาตรฐาน',
  };

  for (const [key, val] of Object.entries(dictionary)) {
    if (msg.includes(key)) {
      return val;
    }
  }

  // Handle support col deduction string
  if (msg.includes('Deducted half-column widths at supports')) {
    return msg.replace('Deducted half-column widths at supports', 'หักความกว้างเสาครึ่งต้นที่จุดรองรับ');
  }

  return msg;
}
