/**
 * StructBOQ - ปร.4 BOQ reader working on positioned PDF text (browser or Node).
 */
import type { PageText, TextItem } from './types';
import { unionNb } from './pdfText';
import type { BoqTotals } from '../engine/boqCompare';

export interface BoqLine {
  page: number;
  bbox: [number, number, number, number];
  itemNo: string;
  description: string;
  quantity: number | null;
  unit: string;
  section: string;
  sheetTitle: string;
  key: string;
  pageWidth: number;
  pageHeight: number;
  /** box as displayed (normalized), when known */
  bboxNorm?: [number, number, number, number];
}

export interface BoqDocument {
  fileName: string;
  variants: string[];
  lines: BoqLine[];
  legacyFontPages: number[];
  warnings: string[];
}

const NUM = /^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;
const ITEM_NO = /^\d+(?:\.\d+)*\.?$/;

const num = (s: string): number | null => {
  const t = s.replace(/\s/g, '');
  return NUM.test(t) ? Number(t.replace(/,/g, '')) : null;
};

/** OCR'd units: Thai glyphs misread as Latin ("nn." for กก.) or doubled marks ("ลบ.มม."). */
export function normalizeUnitOcr(u: string): string {
  const t = u.replace(/\s/g, '').replace(/[,]/g, '.');
  if (/^(กก|ก[ุู]ก|nn|an|กท|ny|nm|fn)\.?$/i.test(t)) return 'กก.';
  if (/^(ลบ\.?ม+\.?|ลบมม\.?|sua|sum|au)\.?$/i.test(t)) return 'ลบ.ม.';
  if (/^(ตร\.?ม+\.?|ตรมม\.?|asa|ar\.?a\.?|ต\.?ร\.?ม\.?)$/i.test(t)) return 'ตร.ม.';
  if (/^(ม|u)\.$/i.test(t)) return 'ม.';
  return u;
}

/** OCR'd description words commonly broken in ปร.4 sheets. */
export function normalizeDescOcr(d: string): string {
  return d
    .replace(/ขุ[ตด]ดิน/g, 'ขุดดิน')
    .replace(/ทรายราดน[้]+[าำ]/g, 'ทรายราดน้ำ')
    .replace(/ค\s*อนกรีต/g, 'คอนกรีต')
    .replace(/ค[้]+[าำ]ยัน/g, 'ค้ำยัน')
    .replace(/เหล็ก\s*[5S][0O]\s*(\d{2})/g, 'เหล็ก SD $1')
    .replace(/เหล็ก\s*[5S][0O](?=\s*dia)/g, 'เหล็ก SD')
    .replace(/เหล็ก\s*[5S]R\s*(\d{2})/g, 'เหล็ก SR $1');
}

/** Same sheet title read slightly differently on each page: reuse a known one when nearly equal. */
function sameTitle(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.max(a.length, b.length);
  if (!n) return true;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length] / n <= 0.12;
}

export function classifyBoqLine(desc: string, unit: string): string {
  const d = desc.replace(/\s+/g, ' ').toLowerCase();
  const u = unit.trim();
  const dia = d.match(/(?:dia\.?|ø|⌀|db|rb)\s*(\d{1,2})\s*(?:มม|mm)?/);
  if (desc.includes('ค่าแรง') && /แบบหล่อ|ไม้แบบ/.test(desc)) return 'formwork_labour_m2';
  if (/ค้ำยัน|ไม้ค้ำ|ตะปู|ลวดผูก/.test(desc)) return '';
  if (u.startsWith('ลบ.ม')) {
    if (d.includes('ขุดดิน')) return 'excavation_m3';
    if (d.includes('ถมดิน') || d.includes('ดินถม')) return 'backfill_m3';
    if (d.includes('ทราย')) return 'sand_m3';
    if (d.includes('หยาบ') || d.includes('lean')) return 'lean_concrete_m3';
    if (d.includes('คอนกรีต') && !d.includes('topping')) return 'structural_concrete_m3';
  }
  if (u.startsWith('ตร.ม')) {
    if (/แบบหล่อ|ไม้แบบ|formwork/.test(d)) return 'formwork_m2';
    if (d.includes('plank') || (d.includes('สำเร็จรูป') && d.includes('พื้น'))) return 'precast_plank_m2';
    if (/topping|wire mesh|ไวร์เมช/.test(d)) return 'topping_m2';
  }
  if (u.startsWith('กก') && !d.includes('เหล็กรูปพรรณ') && !desc.includes('[') && !d.includes('pl.')) {
    if (dia && (d.includes('เหล็ก') || d.includes('sr') || d.includes('sd'))) {
      const n = Number(dia[1]);
      const prefix = (n === 6 || n === 9 || d.includes('sr')) && n < 12 ? 'RB' : 'DB';
      return `rebar_${prefix}${n}_kg`;
    }
  }
  if (u === 'ต้น' && d.includes('เข็ม') && !d.includes('สกัด')) return 'piles_nos';
  return '';
}

function join(parts: TextItem[]): string {
  let out = '';
  let prev: number | null = null;
  for (const p of parts) {
    if (prev !== null && p.x0 - prev > 1.5) out += ' ';
    out += p.str;
    prev = p.x1;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function clusterRows(items: TextItem[], tol = 3.5): TextItem[][] {
  const sorted = [...items].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const rows: TextItem[][] = [];
  for (const it of sorted) {
    const cy = (it.y0 + it.y1) / 2;
    const last = rows[rows.length - 1];
    if (last) {
      const lcy = last.reduce((a, t) => a + (t.y0 + t.y1) / 2, 0) / last.length;
      if (Math.abs(cy - lcy) <= tol) { last.push(it); continue; }
    }
    rows.push([it]);
  }
  for (const r of rows) r.sort((a, b) => a.x0 - b.x0);
  return rows;
}

export function parseBoqPages(pages: PageText[], fileName: string): BoqDocument {
  const out: BoqDocument = { fileName, variants: [], lines: [], legacyFontPages: [], warnings: [] };
  for (const pg of pages) {
    if (pg.legacyFont) out.legacyFontPages.push(pg.page);
    const items = pg.items.filter(i => i.str.trim()).map(i => ({ ...i, str: i.str.trim() }));
    if (!items.length) continue;
    let cols: [number, number, number] | null = null;
    let unitX1 = 0;
    let section = '';
    let sheetTitle = '';
    let materialCtx = '';
    for (const row of clusterRows(items, pg.rowTolerance ?? 3.5)) {
      const joined = join(row);
      if (joined.includes('ประมาณราคาค่าก่อสร้าง')) {
        sheetTitle = joined.replace('ประมาณราคาค่าก่อสร้าง', '').split(/สถานที่ก่อสร้าง|แบบเลขที่/)[0].trim();
        if (pg.ocr) sheetTitle = out.variants.find(v => sameTitle(v, sheetTitle)) ?? sheetTitle;
        if (sheetTitle && !out.variants.includes(sheetTitle)) out.variants.push(sheetTitle);
        continue;
      }
      const qtyHdr = row.find(s => s.str === 'จำนวน');
      const unitHdr = row.find(s => s.str === 'หน่วย');
      const descHdr = row.find(s => s.str === 'รายการ');
      if (qtyHdr && unitHdr && descHdr) {
        const noHdr = row.find(s => s.str.includes('ลำดับ'));
        cols = [noHdr ? noHdr.x1 + 4 : descHdr.x0 - 120, qtyHdr.x0 - 30, unitHdr.x0 - 6];
        unitX1 = unitHdr.x1 + 25;
        continue;
      }
      if (!cols || joined.includes('แผ่นที่') || joined.startsWith('แบบ ปร')) continue;
      const [descX0, qtyX0, unitX0] = cols;
      const noParts = pg.ocr
        ? row.filter(s => s.x0 < descX0 && ITEM_NO.test(s.str))
        : row.filter(s => s.x1 <= descX0 + 2);
      const descParts = pg.ocr
        ? row.filter(s => !noParts.includes(s) && s.x1 <= qtyX0 + 10 && s.x1 > descX0 - 6)
        : row.filter(s => s.x0 >= descX0 - 2 && s.x1 <= qtyX0 + 10 && !noParts.includes(s));
      const qtyParts = row.filter(s => s.x0 >= qtyX0 - 10 && s.x0 < unitX0 && !descParts.includes(s));
      const unitParts = row.filter(s => s.x0 >= unitX0 && s.x0 < unitX1);
      let itemNo = join(noParts);
      let desc = join(descParts);
      if (pg.ocr) {
        desc = normalizeDescOcr(desc.replace(/(?<=[\u0E00-\u0E7F]) (?=[\u0E00-\u0E7F])/g, ''));
        const sec = section.match(/^(\d+)/)?.[1];
        if (sec && new RegExp(`^${sec}(\\d{1,2})$`).test(itemNo) && itemNo.length <= sec.length + 2) itemNo = `${sec}.${itemNo.slice(sec.length)}`;
      }
      let qty: number | null = null;
      for (const q of qtyParts) { qty = num(q.str); if (qty !== null) break; }
      const unit0 = join(unitParts).replace(/\s/g, '');
      let unit = pg.ocr ? normalizeUnitOcr(unit0) : unit0;
      if (pg.ocr) {
        if (!unit && /คอนกรีตโครงสร้าง/.test(desc)) unit = 'ลบ.ม.';
        if (unit === 'กก.' && /^\d*\s*dia\.?\s*\d{1,2}\s*มม/.test(desc) && !materialCtx) desc = `เหล็ก ${desc.replace(/^\d+\s*/, '')}`;
      }
      if (!desc && qty === null) continue;
      if (itemNo && ITEM_NO.test(itemNo) && qty === null && (desc.includes('หมวด') || !unit)) {
        if (desc.includes('หมวด')) section = `${itemNo} ${desc}`;
        materialCtx = '';
        continue;
      }
      if (desc.startsWith('เหล็ก')) materialCtx = desc.split('dia')[0].trim();
      const ctx = desc.startsWith('dia') || /^\d/.test(desc) ? materialCtx : '';
      if (qty === null) continue;
      const used = [...descParts, ...qtyParts, ...unitParts];
      const description = ctx ? `${ctx} ${desc}`.trim() : desc;
      out.lines.push({
        page: pg.page,
        bbox: [Math.min(...row.map(s => s.x0)), Math.min(...row.map(s => s.y0)), Math.max(...(used.length ? used : row).map(s => s.x1)), Math.max(...row.map(s => s.y1))],
        itemNo, description, quantity: qty, unit, section, sheetTitle,
        key: classifyBoqLine(description, unit),
        pageWidth: pg.width, pageHeight: pg.height,
        bboxNorm: unionNb(used.length ? used : row),
      });
    }
  }
  if (!out.lines.length) out.warnings.push("ไม่พบตาราง ปร.4 ที่อ่านได้ (ต้องมีหัวตาราง 'รายการ / จำนวน / หน่วย')");
  if (out.legacyFontPages.length) out.warnings.push(`ถอดรหัสฟอนต์ไทยแบบเก่า (legacy Thai font) แล้ว ${out.legacyFontPages.length} หน้า`);
  return out;
}

export function boqTotalsByVariant(doc: BoqDocument): Record<string, BoqTotals> {
  const out: Record<string, BoqTotals> = {};
  const titled = doc.variants.filter(v => doc.lines.some(l => l.sheetTitle === v));
  const variants = titled.length ? titled : [''];
  for (const v of variants) {
    const totals: BoqTotals = {};
    for (const ln of doc.lines) {
      if (!ln.key || ln.quantity === null || (v && ln.sheetTitle !== v)) continue;
      const t = (totals[ln.key] ||= { quantity: 0, unit: ln.unit, sources: [] });
      t.quantity = Number((t.quantity + ln.quantity).toFixed(3));
      t.sources.push({
        page: ln.page, bbox: ln.bboxNorm ?? ln.bbox, text: `${ln.itemNo} ${ln.description}`.trim(), quantity: ln.quantity, unit: ln.unit,
        page_width: ln.bboxNorm ? 1 : ln.pageWidth, page_height: ln.bboxNorm ? 1 : ln.pageHeight,
      });
    }
    if (Object.keys(totals).length) out[v || doc.fileName] = totals;
  }
  return out;
}
