/** Text-layer PDF -> offline_ocr.json (same word format as OCR) for the benchmark / evaluation. */
import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { toPageText, pageTextToOcr } from '../src/pdf/pdfText.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('text_to_ocr.ts');
const [pdf, out] = process.argv.slice(2);
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), disableFontFace: true }).promise;
const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i); const vp = page.getViewport({ scale: 1 });
  const t = toPageText(i, vp, (await page.getTextContent()) as any);
  if (t.items.length) pages.push(pageTextToOcr(t, vp.width, vp.height));
}
fs.writeFileSync(out, JSON.stringify({ source: pdf, engine: 'pdf text layer', pages }, null, 1));
console.log('pages', pages.length, 'words', pages.reduce((a, p) => a + p.words.length, 0));
