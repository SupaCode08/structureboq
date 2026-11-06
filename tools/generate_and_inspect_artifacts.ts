import { buildBoqWorkbook } from '../src/export/excelWorkbook';
import { computeProject, DEFAULT_MATERIAL_SPECS, ExtractedMember } from '../src/engine/qsEngine';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('tools/artifacts');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Case 1: All AUTO_RELEASE (User confirmed or clean schedule without warnings)
const membersCase1: ExtractedMember[] = [
  {
    tag: 'C1',
    memberType: 'COLUMN',
    width: 0.20,
    depth: 0.20,
    length: 3.00,
    count: 2,
    unit: 'm',
    topRebar: '4-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 2, method: 'vision', label: 'Column Schedule' }],
      fieldSources: { width: 'reviewer', depth: 'reviewer', length: 'reviewer' },
      confidence: 0.95,
    },
    review: { status: 'approved', note: 'QS Verified', at: '2026-11-03' },
  },
  {
    tag: 'F1',
    memberType: 'FOOTING',
    width: 1.00,
    depth: 1.00,
    length: 0.35,
    count: 2,
    unit: 'm',
    bottomRebar: 'DB12@0.15m',
    footingHookShape: 'FULL_UPTURN',
    provenance: {
      evidence: [{ page: 1, method: 'vision', label: 'Footing Schedule' }],
      fieldSources: { width: 'reviewer', depth: 'reviewer', length: 'reviewer' },
      confidence: 0.95,
    },
    review: { status: 'approved', note: 'QS Verified', at: '2026-11-03' },
  }
];

// Case 2: All NEEDS_REVIEW (Unverified beam supports & assumed fields)
const membersCase2: ExtractedMember[] = [
  {
    tag: 'B1',
    memberType: 'BEAM',
    width: 0.20,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 3, method: 'dxf', label: 'CAD Beam' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', support: 'assumed' },
      confidence: 0.85,
    },
  },
  {
    tag: 'B2',
    memberType: 'BEAM',
    width: 0.25,
    depth: 0.50,
    length: 5.00,
    count: 1,
    unit: 'm',
    topRebar: '2-DB20',
    bottomRebar: '3-DB20',
    stirrupRebar: 'RB6@0.15m',
    provenance: {
      evidence: [{ page: 3, method: 'vision', label: 'Plan Beam' }],
      fieldSources: { width: 'drawing', depth: 'drawing', length: 'assumed' },
      confidence: 0.75,
    },
  }
];

// Case 3: Mixed (One approved, one unverified needs review)
const membersCase3: ExtractedMember[] = [
  membersCase1[0], // C1 approved
  membersCase2[0], // B1 needs review
];

// Case 4: Rejected Records (Invalid / NaN / Zero geometry)
const membersCase4: ExtractedMember[] = [
  {
    tag: 'B_INVALID',
    memberType: 'BEAM',
    width: NaN,
    depth: 0.40,
    length: 4.00,
    count: 1,
    unit: 'm',
    topRebar: '2-DB16',
    bottomRebar: '2-DB16',
    stirrupRebar: 'RB6@0.15m',
  },
  {
    tag: 'C_ZERO',
    memberType: 'COLUMN',
    width: -0.20,
    depth: 0.20,
    length: 3.00,
    count: 1,
    unit: 'm',
    topRebar: '4-DB16',
    stirrupRebar: 'RB6@0.15m',
  }
];

const testCases = [
  { name: 'Case 1: All AUTO_RELEASE', members: membersCase1, file: 'case1_all_auto.xlsx' },
  { name: 'Case 2: All NEEDS_REVIEW', members: membersCase2, file: 'case2_all_review.xlsx' },
  { name: 'Case 3: Mixed (Auto + Review)', members: membersCase3, file: 'case3_mixed.xlsx' },
  { name: 'Case 4: REJECTED Records', members: membersCase4, file: 'case4_rejected.xlsx' },
];

console.log('=== TASK 4: ACTUAL WORKBOOK GENERATION & CELL EVIDENCE ===\n');

for (const tc of testCases) {
  const proj = computeProject(tc.members, tc.name, DEFAULT_MATERIAL_SPECS);
  const wb = buildBoqWorkbook(proj);
  const filePath = path.join(outDir, tc.file);
  XLSX.writeFile(wb, filePath);

  console.log(`\nGenerated Artifact: ${tc.file} (${fs.statSync(filePath).size} bytes)`);
  console.log(`Project Summary: Total=${proj.totalItemsCount}, Auto=${proj.autoReleaseCount}, NeedsReview=${proj.needsReviewCount}, Rejected=${proj.rejectedCount}`);
  console.log(`Financial Direct Cost: ฿${(proj.totalProjectCostThb || 0).toLocaleString('th-TH')}, Net Conc: ${proj.totalConcreteVolumeM3} m³, Rebar: ${proj.totalRebarWeightKg || 0} kg`);

  // Inspect Sheet 1: BOQ Summary
  const ws1 = wb.Sheets['1. สรุปปริมาณงาน BOQ'];
  const s1Data: any[][] = XLSX.utils.sheet_to_json(ws1, { header: 1 });
  const warningRow = s1Data.find(row => row.some(cell => typeof cell === 'string' && cell.includes('ข้อควรระวัง')));
  console.log(`  [Sheet 1 Evidence] Warning banner present: ${!!warningRow}`);
  if (warningRow) {
    console.log(`    Banner Text: "${warningRow[0].slice(0, 110)}..."`);
  }

  // Inspect Sheet 2: Element Takeoff
  const ws2 = wb.Sheets['2. รายการถอดแบบละเอียด'];
  const s2Data: any[][] = XLSX.utils.sheet_to_json(ws2, { header: 1 });
  const headers = s2Data[0] || [];
  const provColIdx = headers.indexOf('ระดับที่มา (Provenance)');
  const confColIdx = headers.indexOf('ความมั่นใจ (%)');
  const statusColIdx = headers.indexOf('สถานะการตรวจ (Status)');
  const costColIdx = headers.indexOf('รวมเงิน (Total THB)');
  const warnColIdx = headers.indexOf('ข้อสังเกต/คำเตือน (Review Warnings)');

  console.log(`  [Sheet 2 Evidence] Rows: ${s2Data.length - 1}, Headers found: ProvIdx=${provColIdx}, ConfIdx=${confColIdx}, StatusIdx=${statusColIdx}, CostIdx=${costColIdx}`);
  for (let r = 1; r < s2Data.length; r++) {
    const row = s2Data[r];
    console.log(`    Row ${r}: Tag=${row[1]} | Status=${row[statusColIdx]} | Prov=${row[provColIdx]} | Conf=${row[confColIdx]}% | Cost=฿${row[costColIdx]} | Warnings=${row[warnColIdx]}`);
  }

  // Inspect Sheet 2.1: BBS
  const ws21 = wb.Sheets['ตารางดัด-ตัดเหล็กเสริม'];
  if (ws21) {
    const s21Data: any[][] = XLSX.utils.sheet_to_json(ws21, { header: 1 });
    console.log(`  [Sheet 2.1 BBS Evidence] BBS Rows: ${s21Data.length - 2}`);
  } else {
    console.log(`  [Sheet 2.1 BBS Evidence] Sheet absent (properly skipped for rejected/non-rebar items)`);
  }

  // Inspect Sheet 3: Audit Exceptions
  const ws3 = wb.Sheets['3. ตรวจสอบข้อยกเว้น Audit'];
  const s3Data: any[][] = XLSX.utils.sheet_to_json(ws3, { header: 1 });
  console.log(`  [Sheet 3 Audit Evidence] Exceptions Logged: ${s3Data.length - 1} rows`);
  for (let r = 1; r < s3Data.length; r++) {
    const row = s3Data[r];
    console.log(`    Exception ${r}: Tag=${row[1]} | Status=${row[2]} | Class=${row[3]} | Diagnostics=${row[4]}`);
  }
}
