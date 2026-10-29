import fs from 'fs';
import * as XLSX from 'xlsx';

const f = 'C:/Users/supak/Downloads/9PlanHouse+BOQ/ไฟล์แบบบ้าน + BOQ ทั้ง 9 แบบ-ZIP/1 บ้านประหยัด 1/บัญชีแสดงปริมาณงาน บ้านแบบประหยัด 1.xls';
const wb = XLSX.readFile(f);
console.log('Sheets in BOQ 1:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
  console.log('Sheet: ' + name + ', rows: ' + data.length);
  for (let r = 0; r < Math.min(data.length, 12); r++) {
    const row = data[r]?.filter(x => x !== undefined && x !== '');
    if (row && row.length) console.log('  Row ' + r + ':', JSON.stringify(row.slice(0, 6)));
  }
}
