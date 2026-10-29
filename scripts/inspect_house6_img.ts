import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('inspect_house6_img.ts');

async function inspectImages() {
  const buf = fs.readFileSync('public/test_house6.pdf');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(2);
  const vp = page.getViewport({ scale: 1 });
  console.log('Page 2 size:', vp.width, vp.height);
}
inspectImages();
