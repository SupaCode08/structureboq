import * as XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';

const wb = XLSX.utils.book_new();

// 1. Instructions Sheet
const instructions = [
  ['แบบฟอร์มบันทึกผลการทดสอบการใช้งานจริง (STRUCTBOQ COMMERCIAL PILOT DATA COLLECTION TEMPLATE)'],
  ['เอกสารควบคุมสำหรับวิศวกรผู้เชี่ยวชาญ / Quantity Surveyor (QS) ในการทดสอบระบบถอดแบบโครงสร้าง'],
  ['เวอร์ชันระบบ: StructBOQ Engine 15.0 (Level 2 Assisted Production with Mandatory Human Review)'],
  [],
  ['ข้อกำหนดความปลอดภัยและการใช้งานในการทดลองนำร่อง (Pilot Protocol):'],
  ['1. องค์อาคารที่อนุญาตให้ใช้งานกึ่งอัตโนมัติ (Assisted Release): ฐานรากแผ่เดี่ยว (Footing) และเสา ค.ส.ล. (Column) ที่มีความสูงชั้นระบุชัดเจน'],
  ['2. องค์อาคารที่ต้องอยู่ภายใต้การตรวจสอบบังคับ (Mandatory Review): คาน ค.ส.ล. (Beam) และพื้น ค.ส.ล. (Slab) ทุกชิ้นส่วน'],
  ['3. ข้อห้ามเด็ดขาด (Strict Prohibition): ห้ามนำตารางดัดเหล็ก (Bar Cut & Bend Schedule) ไปสั่งตัดเหล็กจริงหน้างานโดยไม่มี Shop Drawing รับรอง'],
  ['4. เกณฑ์การยอมรับ (Acceptance Criteria): รายการที่มี Error เกิน 5.0% ต้องระบุสาเหตุทางวิศวกรรม (เช่น สมมติฐานเสารองรับ, รูปแบบงอขอ, หรือมาตรฐานการคิดไม้แบบ)'],
  [],
  ['โครงสร้างแผ่นงานในไฟล์นี้:'],
  ['- แผ่นที่ 2: งานคอนกรีต (Concrete Takeoff) — บันทึกปริมาตรสุทธิ ลบ.ม. เปรียบเทียบระหว่างถอดมือ vs StructBOQ'],
  ['- แผ่นที่ 3: งานไม้แบบ (Formwork Takeoff) — บันทึกพื้นที่สัมผัส ตร.ม. เปรียบเทียบระหว่างถอดมือ vs StructBOQ'],
  ['- แผ่นที่ 4: งานเหล็กเสริม (Rebar Takeoff) — บันทึกน้ำหนักรวม กก. แยกตามชั้นคุณภาพ SD30/SD40/SR24'],
  ['- แผ่นที่ 5: สรุปเวลาและผลิตภาพ (Time & Productivity) — บันทึกเวลาที่ใช้จริงในการทำงานมือเทียบกับการใช้ StructBOQ ช่วยตรวจสอบ'],
];
const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
XLSX.utils.book_append_sheet(wb, wsInstructions, 'คำแนะนำและข้อกำหนด (Guide)');

// Common headers for Component sheets
const componentHeaders = [
  'รหัสโครงการ (Project ID)',
  'เลขที่แบบ/Rev (Drawing Rev)',
  'แผ่นแบบ (Sheet No.)',
  'รหัสชิ้นส่วน (Member ID)',
  'เบอร์โครงสร้าง (Tag)',
  'ประเภทโครงสร้าง (Member Type)',
  'จำนวนชิ้น (Count)',
  'มิติหน้าตัด กxยxส (Dimensions ม.)',
  'ปริมาณอ้างอิงถอดมือ (Manual Ref Value)',
  'ปริมาณ StructBOQ (System Value)',
  'หน่วย (Unit)',
  'ผลต่างสัมบูรณ์ (Absolute Error)',
  'ผลต่างร้อยละ (% Relative Error)',
  'สถานะในระบบ (System Status)',
  'ระดับที่มา (Provenance Level)',
  'จำเป็นต้องแก้ไขหรือไม่ (Correction Needed?)',
  'รายละเอียดที่ต้องปรับแก้ (QS Observations & Root Cause)',
  'ผู้ตรวจทาน/วิศวกร (QS Reviewer)',
  'วันที่ตรวจสอบ (Audit Date)',
  'ผลการรับรอง (Sign-off Status)'
];

// Sample rows for Concrete
const sampleConcreteRows = [
  [
    'PILOT-PROJ-01', 'Rev.A', 'S-02', 'F1-01', 'F1', 'FOOTING', 4, '1.20x1.20x0.35',
    2.016, 2.016, 'm³', 0.000, '0.00%', 'AUTO_RELEASE', 'OCR_EXTRACTED', 'ไม่จำเป็น', 'มิติตรงกับตารางขยายฐานรากครบถ้วน', 'สิทธิชัย (QS)', '2026-11-03', 'APPROVED'
  ],
  [
    'PILOT-PROJ-01', 'Rev.A', 'S-03', 'B1-01', 'B1', 'BEAM', 2, '0.20x0.40x4.00',
    0.608, 0.608, 'm³', 0.000, '0.00%', 'NEEDS_REVIEW', 'OCR_EXTRACTED', 'ยืนยันแล้ว', 'ยืนยันเสารองรับกว้าง 0.20 ม. หักจุดตัดถูกต้อง', 'สิทธิชัย (QS)', '2026-11-03', 'APPROVED'
  ],
];

const wsConcrete = XLSX.utils.aoa_to_sheet([componentHeaders, ...sampleConcreteRows]);
XLSX.utils.book_append_sheet(wb, wsConcrete, '1. งานคอนกรีต (Concrete)');

// Sample rows for Formwork
const sampleFormworkRows = [
  [
    'PILOT-PROJ-01', 'Rev.A', 'S-02', 'F1-01', 'F1', 'FOOTING', 4, '1.20x1.20x0.35',
    6.72, 6.72, 'm²', 0.00, '0.00%', 'AUTO_RELEASE', 'OCR_EXTRACTED', 'ไม่จำเป็น', 'ไม้แบบ 4 ด้านข้างฐานรากตรงกัน 100%', 'สิทธิชัย (QS)', '2026-11-03', 'APPROVED'
  ],
  [
    'PILOT-PROJ-01', 'Rev.A', 'S-03', 'B1-01', 'B1', 'BEAM', 2, '0.20x0.40x4.00',
    7.60, 7.60, 'm²', 0.00, '0.00%', 'NEEDS_REVIEW', 'OCR_EXTRACTED', 'ยืนยันแล้ว', 'คิดไม้แบบ 2 ข้าง + ท้องคานสุทธิ', 'สิทธิชัย (QS)', '2026-11-03', 'APPROVED'
  ],
];
const wsFormwork = XLSX.utils.aoa_to_sheet([componentHeaders, ...sampleFormworkRows]);
XLSX.utils.book_append_sheet(wb, wsFormwork, '2. งานไม้แบบ (Formwork)');

// Sample rows for Rebar
const rebarHeaders = [
  'รหัสโครงการ (Project ID)',
  'เลขที่แบบ/Rev (Drawing Rev)',
  'แผ่นแบบ (Sheet No.)',
  'รหัสชิ้นส่วน (Member ID)',
  'เบอร์โครงสร้าง (Tag)',
  'ประเภทโครงสร้าง (Member Type)',
  'สเปกเหล็กเสริม (Rebar Spec)',
  'ชั้นคุณภาพเหล็ก (Steel Grade)',
  'น้ำหนักถอดมือ (Manual Ref กก.)',
  'น้ำหนัก StructBOQ (System กก.)',
  'ผลต่างสัมบูรณ์ (Absolute Error กก.)',
  'ผลต่างร้อยละ (% Relative Error)',
  'สถานะในระบบ (System Status)',
  'ระดับที่มา (Provenance Level)',
  'รูปแบบงอขอ/ทาบ (Hook/Lap Basis)',
  'รายละเอียดที่ต้องปรับแก้ (QS Observations)',
  'ผู้ตรวจทาน/วิศวกร (QS Reviewer)',
  'วันที่ตรวจสอบ (Audit Date)',
  'ผลการรับรอง (Sign-off Status)'
];

const sampleRebarRows = [
  [
    'PILOT-PROJ-01', 'Rev.A', 'S-02', 'F1-01', 'F1', 'FOOTING', 'DB12@0.15m (ตะแกรงล่าง)', 'SD40',
    98.40, 98.40, 0.00, '0.00%', 'AUTO_RELEASE', 'OCR_EXTRACTED', 'FULL_UPTURN (งอขึ้น 25 ซม.)', 'คำนวณระยะงอพับขึ้นตรงกับข้อกำหนดแบบ', 'สิทธิชัย (QS)', '2026-11-03', 'APPROVED'
  ],
  [
    'PILOT-PROJ-01', 'Rev.A', 'S-03', 'B1-01', 'B1', 'BEAM', 'บน 2-DB16 / ล่าง 2-DB16 / ปลอก RB6@0.15m', 'SD40/SR24',
    44.08, 44.08, 0.00, '0.00%', 'NEEDS_REVIEW', 'OCR_EXTRACTED', 'Hook 12d ในเสา', 'ตรวจสอบระยะฝังยึดในเสาแล้ว ปลอดภัย', 'สิทธิชัย (QS)', '2026-11-03', 'APPROVED'
  ],
];
const wsRebar = XLSX.utils.aoa_to_sheet([rebarHeaders, ...sampleRebarRows]);
XLSX.utils.book_append_sheet(wb, wsRebar, '3. งานเหล็กเสริม (Rebar)');

// 5. Time & Productivity Sheet
const timeHeaders = [
  'ลำดับ (No.)',
  'รหัสโครงการ (Project ID)',
  'หมวดงาน/แผ่นแบบ (Work Scope / Sheet)',
  'จำนวนชิ้นส่วนที่ถอด (Elements Count)',
  'เวลาถอดแบบด้วยมือ (Manual Takeoff เวลาเป็นนาที)',
  'เวลาใช้ StructBOQ ช่วยตรวจ (StructBOQ Assisted เวลาเป็นนาที)',
  'เวลาที่ประหยัดได้ (Time Saved นาที)',
  'ประสิทธิภาพที่เพิ่มขึ้น (% Time Reduction)',
  'จำนวนจุดที่ AI ช่วยเตือนความผิดพลาด (Warnings Flagged)',
  'จำนวนจุดที่ QS ต้องแก้จริง (True Corrections)',
  'ข้อคิดเห็นเชิงคุณภาพจาก QS (Qualitative Feedback)',
  'ผู้บันทึกข้อมูล (Recorded By)'
];

const sampleTimeRows = [
  [
    1, 'PILOT-PROJ-01', 'S-02 ฐานรากและเสาตอม่อ (12 ต้น)', 12, 35, 8, 27, '77.1%', 2, 0,
    'อ่านตารางได้แม่นยำมาก ลดเวลาลอกตัวเลขลงตาราง Excel ได้มาก', 'สิทธิชัย (QS)'
  ],
  [
    2, 'PILOT-PROJ-01', 'S-03 คานคอดินและคานชั้น 1 (18 เบอร์)', 18, 55, 15, 40, '72.7%', 5, 2,
    'ระบบเตือนเรื่องระยะเสารองรับดีมาก ช่วยให้ไม่ลืมตรวจสอบความกว้างเสา', 'สิทธิชัย (QS)'
  ],
];

const wsTime = XLSX.utils.aoa_to_sheet([timeHeaders, ...sampleTimeRows]);
XLSX.utils.book_append_sheet(wb, wsTime, '4. สรุปเวลา (Productivity)');

const outPath = path.resolve('tools/pilot/PILOT_DATA_COLLECTION_TEMPLATE.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`Successfully generated Pilot Data Collection Template at: ${outPath} (${fs.statSync(outPath).size} bytes)`);
