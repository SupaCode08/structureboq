/**
 * ปร.4 BOQ with a text layer -> boq.json for the benchmark (scanned / outlined BOQs: boq_ocr.ts).
 *
 *   npx tsx scripts/boq_text.ts <boq.pdf> <dir>
 */
import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { toPageText } from '../src/pdf/pdfText.ts';
import { parseBoqPages, boqTotalsByVariant } from '../src/pdf/boqParser.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('boq_text.ts');

const [pdf, dir] = process.argv.slice(2);
if (!pdf || !dir) { console.error('usage: tsx scripts/boq_text.ts <boq.pdf> <dir>'); process.exit(1); }
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), disableFontFace: true }).promise;
const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  pages.push(toPageText(i, page.getViewport({ scale: 1 }), (await page.getTextContent()) as any));
}
const parsed = parseBoqPages(pages, path.basename(pdf));
const totals = boqTotalsByVariant(parsed);
console.log('variants', parsed.variants, 'lines', parsed.lines.length, parsed.warnings);
for (const [v, t] of Object.entries(totals)) console.log(v, Object.fromEntries(Object.entries(t).map(([k, x]: any) => [k, x.quantity])));
fs.writeFileSync(path.join(dir, 'boq.json'), JSON.stringify({
  file_name: path.basename(pdf), page_count: doc.numPages, legacy_font_pages: pages.filter(p => p.legacyFont).map(p => p.page),
  variants: parsed.variants, lines: parsed.lines, warnings: parsed.warnings, structural_by_variant: totals,
}, null, 1));
