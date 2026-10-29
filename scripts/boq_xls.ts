/**
 * ปร.4 BOQ as an Excel workbook (one sheet per footing variant) -> boq.json for the benchmark.
 * Rows: [item no, description, quantity, unit, ...]; only the structural section is read.
 *
 *   npx tsx scripts/boq_xls.ts <boq.xls> <dir>
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { classifyBoqLine, boqTotalsByVariant, type BoqLine } from '../src/pdf/boqParser.ts';

const [xls, dir] = process.argv.slice(2);
if (!xls || !dir) { console.error('usage: tsx scripts/boq_xls.ts <boq.xls> <dir>'); process.exit(1); }
const wb = XLSX.readFile(xls);
const variants = wb.SheetNames.filter(s => !s.includes('สรุป'));
const lines: BoqLine[] = [];
variants.forEach((sheet, k) => {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1 }) as unknown[][];
  let on = false;
  rows.forEach((r, i) => {
    const desc = String(r?.[1] ?? '').replace(/\s+/g, ' ').trim();
    if (/หมวดงานวิศวกรรมโครงสร้าง/.test(desc)) { on = !desc.startsWith('รวม'); return; }
    const quantity = typeof r?.[2] === 'number' ? r[2] : null;
    if (!on || !desc || quantity === null) return;
    const unit = String(r[3] ?? '').trim();
    lines.push({ page: k + 1, bbox: [0, i, 1, i + 1], itemNo: '', description: desc, quantity, unit, section: 'หมวดงานวิศวกรรมโครงสร้าง', sheetTitle: sheet, key: classifyBoqLine(desc, unit), pageWidth: 1, pageHeight: rows.length });
  });
});
const totals = boqTotalsByVariant({ fileName: path.basename(xls), variants, lines, legacyFontPages: [], warnings: [] });
for (const [v, t] of Object.entries(totals)) console.log(v, Object.fromEntries(Object.entries(t).map(([key, x]) => [key, x.quantity])));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'boq.json'), JSON.stringify({
  file_name: path.basename(xls), page_count: variants.length, legacy_font_pages: [], variants, lines, warnings: [], structural_by_variant: totals,
}, null, 1));
