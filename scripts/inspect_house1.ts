import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('inspect_house1.ts');

async function testPdf() {
  const filePath = 'C:/Users/supak/Downloads/9PlanHouse+BOQ/ไฟล์แบบบ้าน + BOQ ทั้ง 9 แบบ-ZIP/1 บ้านประหยัด 1/แปลนบ้าน บ้านประหยัดแบบ 1.pdf';
  const buf = fs.readFileSync(filePath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  console.log('Num pages:', doc.numPages);
  for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const str = content.items.map((it: any) => it.str).join(' ');
    console.log('Page ' + i + ': text length = ' + str.trim().length + ', sample: ' + str.slice(0, 80).replace(/\s+/g, ' '));
  }
}
testPdf().catch(console.error);
