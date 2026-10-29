import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStructuralNotesFromWords,
  applyGeneralNotesToSpecs,
} from './structuralNotesParser';
import { DEFAULT_MATERIAL_SPECS } from '../engine/qsEngine';
import type { OcrWord } from './types';

function makeWord(text: string, x0: number, y0: number, x1 = x0 + 0.05, y1 = y0 + 0.02): OcrWord {
  return { text, x0, y0, x1, y1, vertical: false, conf: 99 };
}

test('Structural Notes Parser: extracts concrete f\'c, rebar grades, covering, and lap splice', () => {
  const words: OcrWord[] = [
    // Title
    makeWord('รายการประกอบแบบวิศวกรรมโครงสร้าง', 0.1, 0.05),
    // Concrete
    makeWord('1.', 0.1, 0.10),
    makeWord('คอนกรีต:', 0.15, 0.10),
    makeWord('กำลังอัดประลัย', 0.25, 0.10),
    makeWord('f\'c', 0.35, 0.10),
    makeWord('=', 0.40, 0.10),
    makeWord('240', 0.43, 0.10),
    makeWord('ksc', 0.48, 0.10),
    makeWord('(ทรงลูกบาศก์)', 0.53, 0.10),
    // Rebar
    makeWord('2.', 0.1, 0.15),
    makeWord('เหล็กเสริม:', 0.15, 0.15),
    makeWord('เหล็กเส้นกลม', 0.25, 0.15),
    makeWord('SR-24', 0.35, 0.15),
    makeWord('fy', 0.42, 0.15),
    makeWord('=', 0.45, 0.15),
    makeWord('2400', 0.48, 0.15),
    makeWord('ksc', 0.54, 0.15),
    makeWord('เหล็กข้ออ้อย', 0.25, 0.20),
    makeWord('SD-40', 0.35, 0.20),
    makeWord('fy', 0.42, 0.20),
    makeWord('=', 0.45, 0.20),
    makeWord('4000', 0.48, 0.20),
    makeWord('ksc', 0.54, 0.20),
    // Covering
    makeWord('3.', 0.1, 0.25),
    makeWord('ระยะคอนกรีตหุ้มเหล็ก:', 0.15, 0.25),
    makeWord('ฐานราก', 0.25, 0.25),
    makeWord('5.0', 0.33, 0.25),
    makeWord('ซม.', 0.38, 0.25),
    makeWord('คาน', 0.45, 0.25),
    makeWord('3.0', 0.50, 0.25),
    makeWord('ซม.', 0.55, 0.25),
    makeWord('เสา', 0.60, 0.25),
    makeWord('3.0', 0.65, 0.25),
    makeWord('ซม.', 0.70, 0.25),
    makeWord('พื้น', 0.75, 0.25),
    makeWord('2.0', 0.80, 0.25),
    makeWord('ซม.', 0.85, 0.25),
    // Lap splice
    makeWord('4.', 0.1, 0.30),
    makeWord('ระยะทาบเหล็ก:', 0.15, 0.30),
    makeWord('ไม่น้อยกว่า', 0.25, 0.30),
    makeWord('40', 0.35, 0.30),
    makeWord('d', 0.38, 0.30),
    // Soil bearing capacity
    makeWord('5.', 0.1, 0.35),
    makeWord('ดินรับน้ำหนักบรรทุกปลอดภัย', 0.15, 0.35),
    makeWord('8.00', 0.35, 0.35),
    makeWord('ตัน/ตร.ม.', 0.40, 0.35),
  ];

  const notes = extractStructuralNotesFromWords([{ page: 1, words }]);

  assert.equal(notes.sourcePage, 1);
  assert.equal(notes.concreteStrengthKsc, 240);
  assert.equal(notes.concreteStrengthType, 'cube');
  assert.ok(notes.stirrupGrade?.includes('SR24'));
  assert.ok(notes.mainRebarGrade?.includes('SD40'));
  assert.equal(notes.coveringByMember?.footingCm, 5.0);
  assert.equal(notes.coveringByMember?.beamCm, 3.0);
  assert.equal(notes.coveringByMember?.slabCm, 2.0);
  assert.equal(notes.lapSpliceDb, 40);
  assert.equal(notes.soilBearingCapacityTonsM2, 8.0);
  assert.ok(notes.evidenceSnippets.length >= 4);

  // Apply to specs
  const updated = applyGeneralNotesToSpecs(DEFAULT_MATERIAL_SPECS, notes);
  assert.equal(updated.concreteGrade, notes.concreteGrade);
  assert.equal(updated.mainRebarGrade, notes.mainRebarGrade);
  assert.equal(updated.stirrupGrade, notes.stirrupGrade);
  assert.equal(updated.concreteCoveringCm, 3.0);
  assert.equal(updated.concreteMatRate, 2350); // 240 ksc -> 2350
  assert.ok(updated.sourceText?.includes('รายการประกอบแบบโครงสร้าง'));
});

test('Structural Notes Parser: parses House 1 (บ้านประหยัด 1) 150 ksc cube & SD30', () => {
  const words: OcrWord[] = [
    makeWord('GENERAL NOTES', 0.1, 0.05),
    makeWord('คอนกรีตผสมเสร็จ f\'c = 150 ksc (ทรงลูกบาศก์)', 0.1, 0.10),
    makeWord('เหล็กเสริม SR-24 สำหรับเหล็กกลม และ SD-30 สำหรับเหล็กข้ออ้อย', 0.1, 0.15),
    makeWord('เสาเข็ม 0.15x0.15x6.00 ม. ปลอดภัย 1.7 ตัน', 0.1, 0.20),
  ];

  const notes = extractStructuralNotesFromWords([{ page: 9, words }]);
  assert.equal(notes.sourcePage, 9);
  assert.equal(notes.concreteStrengthKsc, 150);
  assert.ok(notes.stirrupGrade?.includes('SR24'));
  assert.ok(notes.mainRebarGrade?.includes('SD30'));
  assert.equal(notes.pileSpec?.sizeStr, '0.15x0.15x6.00');
  assert.equal(notes.pileSpec?.safeLoadTons, 1.7);

  const updated = applyGeneralNotesToSpecs(DEFAULT_MATERIAL_SPECS, notes);
  assert.equal(updated.mainRebarMatRate, 27.50); // SD30 rate
  assert.equal(updated.concreteMatRate, 2050); // 150 ksc rate
});

test('Structural Notes Parser: ignores unrelated non-structural sheets', () => {
  const words: OcrWord[] = [
    makeWord('แบบแปลนสุขาภิบาลชั้น 1', 0.1, 0.05),
    makeWord('ท่อ PVC ขนาด 4 นิ้ว ชั้น 8.5', 0.1, 0.10),
    makeWord('บ่อดักไขมันขนาด 30 ลิตร', 0.1, 0.15),
  ];

  const notes = extractStructuralNotesFromWords([{ page: 4, words }]);
  assert.equal(notes.sourcePage, undefined);
  assert.equal(notes.evidenceSnippets.length, 0);
  assert.equal(notes.concreteStrengthKsc, undefined);
});
