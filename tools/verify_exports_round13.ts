import { buildBoqWorkbook } from '../src/export/excelWorkbook.ts';
import * as XLSX from 'xlsx';

function inspectExport(caseName: string, result: any) {
  const wb = buildBoqWorkbook(result);
  const s1Json = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['1. สรุปปริมาณงาน BOQ'], { header: 1 });
  const hasWarning = s1Json.some(row => row.some(cell => typeof cell === 'string' && cell.includes('ข้อควรระวัง')));
  
  const s2Json = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['2. รายการถอดแบบละเอียด'], { header: 1 });
  const s2Headers = s2Json[0] || [];
  const s2Rows = s2Json.slice(1);
  
  const s3Exists = !!wb.Sheets['3. ตรวจสอบข้อยกเว้น Audit'];
  const s21Exists = !!wb.Sheets['ตารางดัด-ตัดเหล็กเสริม'];
  
  console.log(`\n=== Inspection Result: ${caseName} ===`);
  console.log(`- Sheet 1 Provisional Warning Banner: ${hasWarning ? 'PRESENT' : 'ABSENT (Clean Auto Release)'}`);
  console.log(`- Sheet 2 Headers Count: ${s2Headers.length} (Includes Provenance: ${s2Headers.includes('ระดับที่มา (Provenance)')}, Confidence: ${s2Headers.includes('ความมั่นใจ (%)')})`);
  console.log(`- Sheet 2 Rows Count: ${s2Rows.length}`);
  console.log(`- Sheet 2.1 Rebar Bend Schedule: ${s21Exists ? 'Generated' : 'Skipped (No valid rebar)'}`);
  console.log(`- Sheet 3 Audit Exceptions Sheet: ${s3Exists ? 'Generated' : 'Skipped'}`);
  
  if (result.items?.length > 0) {
    const firstItem = s2Rows[0];
    if (firstItem) {
      console.log(`- Sample Row 1: Tag=${firstItem[1]}, Type=${firstItem[2]}, NetVol=${firstItem[11]}, Status=${firstItem[17]}, Provenance=${firstItem[16]}, Warnings=${firstItem[18]}`);
    }
  }
}

// Case 1: All AUTO_RELEASE
inspectExport('Case 1: All AUTO_RELEASE', {
  projectName: 'Test All Auto',
  totalConcreteVolumeM3: 10.0,
  totalFormworkM2: 50.0,
  totalItemsCount: 1,
  autoReleaseCount: 1,
  needsReviewCount: 0,
  rejectedCount: 0,
  passRatePct: 100,
  items: [
    { itemId: '1', tag: 'C1', memberType: 'COLUMN', count: 1, widthM: 0.2, depthM: 0.2, lengthGrossM: 3.0, deductionM: 0, lengthNetM: 3.0, volumeNetM3: 0.12, formworkNetM2: 2.4, rebarWeightKg: 15.0, totalCostThb: 1500, confidencePct: 95, provenanceLevel: 'USER_CONFIRMED', status: 'AUTO_RELEASE', reviewWarnings: [], formulaStr: '1 x 0.2 x 0.2 x 3.0 = 0.12 m3', sourceInfo: 'CAD' }
  ]
});

// Case 2: All NEEDS_REVIEW
inspectExport('Case 2: All NEEDS_REVIEW', {
  projectName: 'Test All Needs Review',
  totalConcreteVolumeM3: 10.0,
  totalFormworkM2: 50.0,
  totalItemsCount: 1,
  autoReleaseCount: 0,
  needsReviewCount: 1,
  rejectedCount: 0,
  passRatePct: 0,
  items: [
    { itemId: '1', tag: 'B1', memberType: 'BEAM', count: 1, widthM: 0.2, depthM: 0.4, lengthGrossM: 4.0, deductionM: 0, lengthNetM: 4.0, volumeNetM3: 0.32, formworkNetM2: 4.0, rebarWeightKg: 30.0, totalCostThb: 3000, confidencePct: 75, provenanceLevel: 'ENGINEERING_ASSUMPTION', status: 'NEEDS_REVIEW', reviewWarnings: ['Beam support assumed'], formulaStr: '...', sourceInfo: 'PDF' }
  ]
});

// Case 3: Mixed
inspectExport('Case 3: Mixed Auto & Review', {
  projectName: 'Test Mixed',
  totalConcreteVolumeM3: 20.0,
  totalFormworkM2: 100.0,
  totalItemsCount: 2,
  autoReleaseCount: 1,
  needsReviewCount: 1,
  rejectedCount: 0,
  passRatePct: 50,
  items: [
    { itemId: '1', tag: 'C1', memberType: 'COLUMN', count: 1, widthM: 0.2, depthM: 0.2, lengthGrossM: 3.0, deductionM: 0, lengthNetM: 3.0, volumeNetM3: 0.12, formworkNetM2: 2.4, rebarWeightKg: 15.0, totalCostThb: 1500, confidencePct: 95, provenanceLevel: 'USER_CONFIRMED', status: 'AUTO_RELEASE', reviewWarnings: [], formulaStr: '...', sourceInfo: 'CAD' },
    { itemId: '2', tag: 'B1', memberType: 'BEAM', count: 1, widthM: 0.2, depthM: 0.4, lengthGrossM: 4.0, deductionM: 0, lengthNetM: 4.0, volumeNetM3: 0.32, formworkNetM2: 4.0, rebarWeightKg: 30.0, totalCostThb: 3000, confidencePct: 75, provenanceLevel: 'ENGINEERING_ASSUMPTION', status: 'NEEDS_REVIEW', reviewWarnings: ['Beam support assumed'], formulaStr: '...', sourceInfo: 'PDF' }
  ]
});

// Case 4: Invalid/Rejected
inspectExport('Case 4: Invalid / Rejected Records', {
  projectName: 'Test Rejected',
  totalConcreteVolumeM3: 0,
  totalFormworkM2: 0,
  totalItemsCount: 1,
  autoReleaseCount: 0,
  needsReviewCount: 0,
  rejectedCount: 1,
  passRatePct: 0,
  items: [
    { itemId: '1', tag: 'B_REJ', memberType: 'BEAM', count: 1, widthM: 0, depthM: 0, lengthGrossM: 0, deductionM: 0, lengthNetM: 0, volumeNetM3: 0, formworkNetM2: 0, rebarWeightKg: 0, totalCostThb: 0, confidencePct: 0, provenanceLevel: 'UNKNOWN', status: 'REJECTED', reviewWarnings: [], rejectionReasons: ['Non-finite dimension'], formulaStr: '', sourceInfo: '-' }
  ]
});
