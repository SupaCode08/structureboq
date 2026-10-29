import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('create_plan1_dataset.ts');

const baseDir = 'C:/Users/supak/Downloads/9PlanHouse+BOQ/ไฟล์แบบบ้าน + BOQ ทั้ง 9 แบบ-ZIP/1 บ้านประหยัด 1';
const xlsPath = path.join(baseDir, 'บัญชีแสดงปริมาณงาน บ้านแบบประหยัด 1.xls');
const targetDir = 'real_drawings/plan_house_1';

fs.mkdirSync(targetDir, { recursive: true });

const wb = XLSX.readFile(xlsPath);
const out: any = {
  file_name: 'แปลนบ้าน บ้านประหยัดแบบ 1.pdf',
  page_count: 15,
  legacy_font_pages: [],
  variants: ['ฐานรากเสาเข็ม', 'ฐานรากแผ่'],
  lines: [],
  warnings: [],
  structural_by_variant: {},
};

for (const sheet of wb.SheetNames) {
  if (sheet.includes('สรุป')) continue;
  const isNoPile = sheet.includes('ไม่ตอก') || sheet.includes('ม่ตอก');
  const variantName = isNoPile ? 'ฐานรากแผ่' : 'ฐานรากเสาเข็ม';
  const struct: Record<string, any> = {};
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 }) as any[][];
  let inStruct = false;

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx];
    if (!r || !r.length) continue;
    const line = r.filter(x => x !== undefined && x !== null && x !== '').join(' ');
    if (line.includes('หมวดงานวิศวกรรมโครงสร้าง') || line.includes('งานวิศวกรรมโครงสร้าง')) { inStruct = true; continue; }
    if (inStruct && (line.includes('สถาปัตยกรรม') || line.includes('สุขาภิบาล') || line.includes('ไฟฟ้า') || line.includes('รวมหมวด'))) {
      inStruct = false;
      break;
    }
    if (inStruct) {
      const desc = String(r[1] || '').trim();
      const qty = typeof r[2] === 'number' ? r[2] : parseFloat(String(r[2] || ''));
      const unit = String(r[3] || '').trim();

      if (desc && !isNaN(qty) && qty > 0) {
        let key: string | null = null;
        if (/ขุดดิน/i.test(desc)) key = 'excavation_m3';
        else if (/ทราย/i.test(desc)) key = 'sand_m3';
        else if (/คอนกรีตหยาบ/i.test(desc)) key = 'lean_concrete_m3';
        else if (/คอนกรีตโครงสร้าง/i.test(desc)) key = 'structural_concrete_m3';
        else if (/ค่าแรงไม้แบบ/i.test(desc)) key = 'formwork_m2';
        else if (/Dia\s*6|Ø\s*6|6\s*มม/i.test(desc)) key = 'rebar_RB6_kg';
        else if (/Dia\s*9|Ø\s*9|9\s*มม/i.test(desc)) key = 'rebar_RB9_kg';
        else if (/Dia\s*12|Ø\s*12|12\s*มม/i.test(desc)) key = 'rebar_DB12_kg';
        else if (/Dia\s*16|Ø\s*16|16\s*มม/i.test(desc)) key = 'rebar_DB16_kg';
        else if (/เสาเข็ม/i.test(desc)) key = 'piles_count';

        if (key && !struct[key]) {
          struct[key] = {
            quantity: qty,
            unit: unit || (key.endsWith('_m3') ? 'ลบ.ม.' : key.endsWith('_m2') ? 'ตร.ม.' : 'กก.'),
            sources: [{ text: desc, quantity: qty, unit }],
          };
        }
      }
    }
  }
  out.structural_by_variant[variantName] = struct;
}

fs.writeFileSync(path.join(targetDir, 'boq.json'), JSON.stringify(out, null, 2));

const manifest = {
  datasetName: 'บ้านประหยัดแบบ 1 (แบบบ้านเพื่อประชาชน — กรมโยธาธิการและผังเมือง)',
  drawingPdf: 'แปลนบ้าน บ้านประหยัดแบบ 1.pdf',
  drawingPages: '9-11',
  boqVariant: 'ฐานรากเสาเข็ม',
  footingVariant: 'ฐานรากเสาเข็ม',
  boqJson: 'boq.json',
};
fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Created plan_house_1 boq.json and manifest.json');
