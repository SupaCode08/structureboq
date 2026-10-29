import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('check_pdf_pages.ts');

async function check(filePath: string) {
  const buf = fs.readFileSync(filePath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  console.log(filePath, 'numPages:', doc.numPages);
}
check('C:/Users/supak/Downloads/9PlanHouse+BOQ/ไฟล์แบบบ้าน + BOQ ทั้ง 9 แบบ-ZIP/1 บ้านประหยัด 1/แปลนบ้าน บ้านประหยัดแบบ 1.pdf');
