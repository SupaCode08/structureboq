/**
 * Thai OCR of ปร.4 pages that have no text layer, same code as the browser.
 * Writes the OCR'd pages (cache for the web app) and boq.json (for the benchmark).
 *
 *   npx tsx scripts/boq_ocr.ts <pdf> <pages e.g. 46-67> <dir>
 */
import fs from 'fs';
import path from 'path';
import Tesseract from 'tesseract.js';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ocrBoqPage, mergeThaiGlyphs, normalizeThaiOcr } from '../src/pdf/boqOcr.ts';
import { parseBoqPages, boqTotalsByVariant } from '../src/pdf/boqParser.ts';
import { grayPng } from './png.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('boq_ocr.ts');

const [pdf, spec, dir] = process.argv.slice(2);
if (!pdf || !spec || !dir) { console.error('usage: tsx scripts/boq_ocr.ts <pdf> <pages> <dir>'); process.exit(1); }
const pages = spec.split(',').flatMap(p => { const [a, b] = p.split('-').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });

const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), disableFontFace: true }).promise;
const out: any[] = [];
const cache = path.join(dir, 'boq_ocr.json');
if (process.argv.includes('--reparse') && fs.existsSync(cache)) {
  // re-run word merging + parsing on the cached OCR (no OCR)
  for (const pg of JSON.parse(fs.readFileSync(cache, 'utf-8')).pages) {
    const boxes = pg.items.map((i: any) => ({ text: i.str, confidence: 100, bbox: { x0: i.x0, y0: i.y0, x1: i.x1, y1: i.y1 }, nb: i.nb }));
    const merged = mergeThaiGlyphs(boxes as any) as any[];
    // carry the display boxes along: union of the glyph boxes inside each merged word
    pg.items = merged.map(m => {
      const parts = boxes.filter((b: any) => b.bbox.x0 >= m.bbox.x0 - 0.01 && b.bbox.x1 <= m.bbox.x1 + 0.01 && b.bbox.y0 >= m.bbox.y0 - 0.01 && b.bbox.y1 <= m.bbox.y1 + 0.01 && b.nb);
      const nb = parts.length ? [Math.min(...parts.map((b: any) => b.nb[0])), Math.min(...parts.map((b: any) => b.nb[1])), Math.max(...parts.map((b: any) => b.nb[2])), Math.max(...parts.map((b: any) => b.nb[3]))] : undefined;
      return { str: normalizeThaiOcr(m.text), x0: m.bbox.x0, y0: m.bbox.y0, x1: m.bbox.x1, y1: m.bbox.y1, nb };
    });
    pg.ocr = true; pg.rowTolerance = 7;
    out.push(pg);
  }
} else {
const worker = await Tesseract.createWorker('tha+eng');
await worker.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' as any });
for (const p of pages) {
  const t0 = Date.now();
  const r = await ocrBoqPage(await doc.getPage(p) as any, p, { worker: worker as any, OPS: OPS as any, toImage: (d, w, h) => grayPng(d, w, h) });
  console.log(`p${p} ${r ? `turn ${r.turn} conf ${r.confidence} words ${r.items.length}` : 'no lettering'} ${Date.now() - t0}ms`);
  if (r) out.push(r);
}
await worker.terminate();
}
fs.writeFileSync(cache, JSON.stringify({ source: path.basename(pdf), engine: 'tesseract.js tha+eng', pages: out }));

const parsed = parseBoqPages(out, path.basename(pdf));
const totals = boqTotalsByVariant(parsed);
console.log('variants', parsed.variants, 'lines', parsed.lines.length, parsed.warnings);
for (const [v, t] of Object.entries(totals)) console.log(v, Object.fromEntries(Object.entries(t).map(([k, x]: any) => [k, x.quantity])));
fs.writeFileSync(path.join(dir, 'boq.json'), JSON.stringify({
  file_name: path.basename(pdf), page_count: doc.numPages, legacy_font_pages: [], ocr_pages: pages,
  variants: parsed.variants, lines: parsed.lines, warnings: parsed.warnings, structural_by_variant: totals,
}, null, 1));
