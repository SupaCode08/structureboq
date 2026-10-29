import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p4_ops.ts');

async function testPage4() {
  const buf = fs.readFileSync('public/test_house6.pdf');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  console.log('Doc loaded, numPages:', doc.numPages);
  for (let p = 1; p <= 5; p++) {
    const page = await doc.getPage(p);
    const ops = await page.getOperatorList();
    console.log(`Page ${p}: fnArray length:`, ops.fnArray.length);
  }
}
testPage4();
