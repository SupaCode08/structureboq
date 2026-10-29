import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLegacyThai, normalizeThai, looksLegacyThai } from './thaiText.ts';
import { toPageText } from './pdfText.ts';
import { parseBoqPages, boqTotalsByVariant, classifyBoqLine } from './boqParser.ts';
import { parseScheduleLine } from './scheduleParser.ts';
import { readSheets, isDrawingIndexSheet } from './sheetReader.ts';
import { extractSmallStrokes, rasterize } from './vectorText.ts';
import { parseDxf } from './dxfParser.ts';
import { ocrPdfPage } from './pdfOcrPipeline.ts';
import type { OcrWord, PageOcr } from './types.ts';

const VP = { width: 842, height: 595, transform: [1, 0, 0, -1, 0, 595] };
const item = (str: string, x: number, yTop: number, w = str.length * 5) => ({ str, transform: [10, 0, 0, 10, x, 595 - yTop - 8], width: w, height: 10 });

test('Thai tone marks some fonts put in the Private Use Area are standard Thai again', () => {
  assert.equal(normalizeThai('หนวย ไมแบบ'), 'หน่วย ไม้แบบ');
});

test('Legacy Thai font text is repaired; normal Thai untouched', () => {
  assert.equal(decodeLegacyThai('Ēïï ðø.4'), 'แบบ ปร.4');
  assert.equal(normalizeThai('×čééĉî', true), 'ขุดดิน');
  assert.equal(looksLegacyThai('คอนกรีตโครงสร้าง'.repeat(5)), false);
});

test('BOQ (ปร.4) rows are parsed from positioned text with header columns', () => {
  const page = toPageText(1, VP, {
    items: [
      item('ประมาณราคาค่าก่อสร้าง บ้านทดสอบ ฐานรากแผ่', 50, 40),
      item('ลำดับที่', 50, 80), item('รายการ', 200, 80), item('จำนวน', 370, 80), item('หน่วย', 420, 80),
      item('1', 55, 100), item('หมวดงานวิศวกรรมโครงสร้าง', 100, 100),
      item('1.1', 55, 120), item('ขุดดิน', 100, 120), item('12', 380, 120), item('ลบ.ม.', 420, 120),
      item('1.4', 55, 140), item("คอนกรีตโครงสร้าง fc' 210 ksc.", 100, 140), item('10', 380, 140), item('ลบ.ม.', 420, 140),
      item('1.7', 55, 160), item('เหล็ก SD 40 dia. 12 มม.', 100, 160), item('532', 380, 160), item('กก.', 420, 160),
      item('dia. 16 มม.', 130, 180), item('101', 380, 180), item('กก.', 420, 180),
    ],
  });
  const doc = parseBoqPages([page], 'boq.pdf');
  const t = boqTotalsByVariant(doc)['บ้านทดสอบ ฐานรากแผ่'];
  assert.equal(t.excavation_m3.quantity, 12);
  assert.equal(t.structural_concrete_m3.quantity, 10);
  assert.equal(t.rebar_DB12_kg.quantity, 532);
  assert.equal(t.rebar_DB16_kg.quantity, 101); // continuation row inherits "เหล็ก SD 40"
  assert.equal(classifyBoqLine('ค่าแรงแบบหล่อคอนกรีต', 'ตร.ม.'), 'formwork_labour_m2');
  assert.equal(classifyBoqLine('- ค่าแรงไม้แบบ', 'ตร.ม.'), 'formwork_labour_m2');
  assert.equal(classifyBoqLine('เข็มสี่เหลี่ยม 0.18x0.18x21.00 ม.', 'ต้น'), 'piles_nos');
  assert.equal(classifyBoqLine('- สกัดหัวเสาเข็ม', 'ต้น'), '');
});

test('Rotated page: evidence boxes are in displayed coordinates', () => {
  const rot = { width: 595, height: 842, transform: [0, 1, 1, 0, 0, 0] }; // 90°
  const p = toPageText(1, rot, { items: [{ str: 'X', transform: [10, 0, 0, 10, 100, 200], width: 10, height: 10 }] });
  const nb = p.items[0].nb!;
  assert.ok(nb[0] >= 0 && nb[2] <= 1 && nb[1] >= 0 && nb[3] <= 1);
  assert.ok(Math.abs(nb[1] - 100 / 842) < 0.02); // x in PDF space became y on screen
});

test('Schedule rows: bar counts are not mistaken for spans', () => {
  const p = parseScheduleLine('GB2 0.15x0.35 2-DB12')!;
  assert.equal(p.length, null);
  const q = parseScheduleLine('B1 | 0.20 x 0.40 m | 4.00 m | 4 | 2-DB16 | 2-DB16')!;
  assert.deepEqual([q.width, q.depth, q.length, q.count, q.topRebar], [0.2, 0.4, 4, 4, '2-DB16']);
});

// A 1:50 plan on an A3-ish sheet: 1 m = 20 mm = 56.69 pt
const W = 1208, H = 845;
const nx = (pt: number) => pt / W, ny = (pt: number) => pt / H;
const word = (text: string, xPt: number, yPt: number, vertical = false): OcrWord => ({ text, x0: nx(xPt - 10), x1: nx(xPt + 10), y0: ny(yPt - 4), y1: ny(yPt + 4), vertical, conf: 92 });
const m = 56.69;
const gx = (v: number) => 300 + v * m, gy = (v: number) => 250 + v * m;

test('Rule reader: grid from the dimension chain, tags tied to grid spans and bays', () => {
  const plan: PageOcr = {
    page: 27, width: W, height: H,
    words: [
      word('1:50', 700, 760),
      word('2.70', gx(1.35), 200), word('1.50', gx(3.45), 200), word('2.40', gx(5.4), 200),
      word('3.60', 240, gy(1.8), true), word('1.80', 240, gy(4.5), true),
      word('GB2', gx(1.35), gy(0) - 8), word('GB2', gx(1.35), gy(0) - 8 + 0.0), // duplicate reading
      word('GBI', gx(4.2) - 8, gy(1.8), true),                                 // OCR "I" for "1"
      word('S0', gx(1.35), gy(1.8)),
      word('GB1', gx(6.6) - 8, gy(1.8), true),
    ],
  };
  const detail: PageOcr = { page: 34, width: W, height: H, words: [word('S0', 700, 300), word('GB1', 400, 300), word('0.15', 400, 230), word('0.35', 360, 260, true), word('2-016', 420, 250), word('2-016', 420, 280)] };
  const { readings } = readSheets([plan, detail]);
  const p = readings.find(r => r.page === 27)!;
  assert.equal(p.sheet_type, 'framing_plan');
  assert.deepEqual(p.grid!.x!.map(g => g.offset_m), [0, 2.7, 4.2, 6.6]);
  assert.deepEqual(p.grid!.y!.map(g => g.offset_m), [0, 3.6, 5.4]);
  const gb2 = p.instances.find(i => i.tag === 'GB2')!;
  assert.equal(gb2.from_grid, 'A/1'); assert.equal(gb2.to_grid, 'A/2'); assert.equal(gb2.length_m, 2.7);
  const gb1 = p.instances.filter(i => i.tag === 'GB1');
  assert.equal(gb1.length, 2);                                   // GBI repaired to GB1
  assert.ok(gb1.every(i => i.length_m === 3.6));
  const s0 = p.instances.find(i => i.tag === 'S0')!;
  assert.equal(s0.from_grid, 'A/1'); assert.equal(s0.to_grid, 'B/2');
  const sec = readings.find(r => r.page === 34)!.sections.find(s => s.tag === 'GB1')!;
  assert.equal(sec.width_m, 0.15); assert.equal(sec.depth_m, 0.35); assert.equal(sec.top_rebar, '2-DB16');
});

test('Geometry: column squares fix a misread grid, outlines give section sizes', () => {
  // 0.20 m columns at 1:50 on grid 0 / 2.70 / 5.40 x 0 / 3.60 / 5.40; OCR read the y chain as 2.10 + 0.30 + 1.50
  const col = (x: number, y: number): [number, number, number, number] => [nx(gx(x) - 5.67), ny(gy(y) - 5.67), nx(gx(x) + 5.67), ny(gy(y) + 5.67)];
  const rects = [0, 2.7, 5.4].flatMap(x => [0, 3.6, 5.4].map(y => col(x, y)));
  const plan: PageOcr = {
    page: 28, width: W, height: H, rects,
    words: [
      word('1:50', 700, 760),
      word('2.70', gx(1.35), 200), word('2.70', gx(4.05), 200),
      word('2.10', 240, gy(1.05), true), word('0.30', 240, gy(2.25), true), word('1.50', 240, gy(3.15), true),
      word('B2', gx(1.35), gy(0) - 8), word('B2', gx(4.05), gy(0) - 8), word('B2', gx(1.35), gy(5.4) - 8),
      word('B3', gx(0) - 8, gy(1.8), true), word('B3', gx(5.4) - 8, gy(1.8), true),
    ],
  };
  // detail at 1:20: B3 drawn 0.20 x 0.40 (no width written), 1 m = 56.69 * 2.5 pt
  const k = m * 2.5;
  const detail: PageOcr = {
    page: 38, width: W, height: H,
    rects: [[nx(400 - 0.1 * k), ny(280 - 0.4 * k), nx(400 + 0.1 * k), ny(280)]],
    words: [word('B3', 400, 300), word('1:20', 450, 305), word('0.40', 370, 250, true)],
  };
  const { readings } = readSheets([plan, detail]);
  const p = readings.find(r => r.page === 28)!;
  assert.deepEqual(p.grid!.y!.map(g => g.offset_m), [0, 3.6, 5.4]);
  assert.equal(p.instances.filter(i => i.member_type === 'COLUMN').length, 9);
  const b3 = readings.find(r => r.page === 38)!.sections.find(s => s.tag === 'B3')!;
  assert.equal(b3.width_m, 0.2); assert.equal(b3.depth_m, 0.4);
  assert.deepEqual(b3.measured_fields, ['width']);
});

test('Vector lettering: small strokes kept, long lines and circles dropped', () => {
  const OPS = { save: 1, restore: 2, transform: 3, constructPath: 4, moveTo: 5, lineTo: 6, curveTo: 7, curveTo2: 8, curveTo3: 9, closePath: 10, rectangle: 11 };
  const circle: number[] = [];
  for (let i = 0; i <= 24; i++) circle.push(100 + 6 * Math.cos((i / 24) * 2 * Math.PI), 100 + 6 * Math.sin((i / 24) * 2 * Math.PI));
  const fn = [OPS.constructPath, OPS.constructPath, OPS.constructPath];
  const args = [
    [[OPS.moveTo, OPS.lineTo, OPS.lineTo], [10, 10, 12, 14, 14, 10]],                    // a letter stroke
    [[OPS.moveTo, OPS.lineTo], [0, 50, 800, 50]],                                          // grid line
    [[OPS.moveTo, ...Array(24).fill(OPS.lineTo)], circle],                                 // bubble as polyline
  ];
  const r = extractSmallStrokes(fn, args, OPS, [1, 0, 0, 1, 0, 0]);
  assert.equal(r.small.length, 1);
  const img = rasterize(r.small, 100, 100, 2);
  assert.ok(img.data.some(v => v === 0));
});

test('Vector passes: a second worker set for the turned raster gives the same words in the same order', async () => {
  const OPS = { save: 1, restore: 2, transform: 3, constructPath: 4, moveTo: 5, lineTo: 6, curveTo: 7, curveTo2: 8, curveTo3: 9, closePath: 10, rectangle: 11 };
  const fn: number[] = [], args: any[] = [];
  for (let i = 0; i < 220; i++) { fn.push(OPS.constructPath); args.push([[OPS.moveTo, OPS.lineTo], [10 + (i % 20) * 9, 10 + Math.floor(i / 20) * 9, 14 + (i % 20) * 9, 16 + Math.floor(i / 20) * 9]]); }
  const page = { getViewport: () => ({ width: 200, height: 120, transform: [1, 0, 0, 1, 0, 0] }), getOperatorList: async () => ({ fnArray: fn, argsArray: args }) };
  // engine k answers with its own word; delays make later passes finish first
  const fake = (k: number, ms: number) => ({ recognize: async () => {
    await new Promise(r => setTimeout(r, ms));
    return { data: { words: [{ text: `W${k}`, confidence: 90, bbox: { x0: 20 + 150 * k, y0: 20, x1: 120 + 150 * k, y1: 60 } }] } };
  } });
  const base = { OPS, toImage: (d: Uint8Array) => d };
  const seq = await ocrPdfPage(page, 1, { ...base, worker: fake(0, 30), extraWorkers: [fake(1, 20)] });
  const par = await ocrPdfPage(page, 1, { ...base, worker: fake(0, 30), extraWorkers: [fake(1, 20)], turnedWorkers: [fake(0, 5), fake(1, 1)] });
  assert.equal(seq.kind, 'vector_text');
  assert.ok(seq.words.length >= 4);
  assert.deepEqual(par.words, seq.words);
});

test('DXF labels: spans that are not written stay missing', () => {
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'TEXT', '8', 'S-BEAM', '10', '1', '20', '2', '1', '4-B1(0.20x0.40) L=4.00m',
    '0', 'TEXT', '8', 'S-BEAM', '10', '3', '20', '4', '1', 'B2 0.25x0.50',
    '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const r = parseDxf(dxf, 'x.dxf');
  assert.equal(r.unit, 'm');
  assert.equal(r.members.length, 2);
  assert.equal(r.members[0].length, 4);
  assert.equal(r.members[1].length, 0);
  assert.equal(r.members[1].provenance!.fieldSources.length, 'missing');
});

test('Thai OCR of a ปร.4: glyphs merged into words, OCR units and item numbers repaired', async () => {
  const { mergeThaiGlyphs, normalizeThaiOcr } = await import('./boqOcr.ts');
  const { normalizeUnitOcr, normalizeDescOcr } = await import('./boqParser.ts');
  const g = (text: string, x0: number, x1: number, y0 = 100, y1 = 120) => ({ text, confidence: 90, bbox: { x0, y0, x1, y1 } });
  const words = mergeThaiGlyphs([g('ข', 10, 20), g('ุ', 14, 18, 118, 126), g('ด', 21, 31), g('ด', 32, 42), g('ิ', 34, 40, 92, 100), g('น', 43, 53), g('11', 300, 320)]);
  assert.deepEqual(words.map(w => w.text), ['ขุดดิน', '11']);
  assert.equal(normalizeThaiOcr('จํานวน'), 'จำนวน');
  assert.equal(normalizeUnitOcr('nn.'), 'กก.');
  assert.equal(normalizeUnitOcr('sua'), 'ลบ.ม.');
  assert.equal(normalizeUnitOcr('asa'), 'ตร.ม.');
  assert.equal(normalizeDescOcr('ขุตดิน'), 'ขุดดิน');
  assert.equal(normalizeDescOcr('เหล็ก50 40 dia. 12 มม.'), 'เหล็ก SD 40 dia. 12 มม.');
});

test('Drawing Index Sheet (สารบัญแบบ): excluded from structural takeoff without false-positive footings', () => {
  const indexWords: OcrWord[] = [
    { text: 'สารบัญแบบวิศวกรรมโครงสร้าง', x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.15, vertical: false, conf: 99 },
    { text: 'แผ่นที่ 1 รายการประกอบแบบ', x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.25, vertical: false, conf: 99 },
    { text: 'แผ่นที่ 2 แปลนฐานรากเสาเข็ม เสาตอม่อ', x0: 0.1, y0: 0.3, x1: 0.4, y1: 0.35, vertical: false, conf: 99 },
    { text: 'แผ่นที่ 3 แปลนเสา คานระดับอะเส', x0: 0.1, y0: 0.4, x1: 0.4, y1: 0.45, vertical: false, conf: 99 },
    { text: 'แผ่นที่ 4 แปลนโครงหลังคา', x0: 0.1, y0: 0.5, x1: 0.4, y1: 0.55, vertical: false, conf: 99 },
  ];
  const p: PageOcr = { page: 1, width: 842, height: 595, words: indexWords };
  assert.equal(isDrawingIndexSheet(p), true);

  const res = readSheets([p]);
  assert.equal(res.readings.length, 1);
  assert.equal(res.readings[0].sheet_type, 'drawing_index');
  assert.equal(res.readings[0].instances.length, 0);
  assert.equal(res.readings[0].sections.length, 0);
});

test('DPT House 1 Page 24 (General Notes & Drawing List): excluded from takeoff without false-positive sections', async () => {
  const fs = await import('fs');
  const d = JSON.parse(fs.readFileSync('src/pdf/fixtures/house1_sheets.json', 'utf8'));
  const p24 = d.pages.find((p: any) => p.page === 24);
  assert.ok(p24, 'Page 24 must exist in dataset');
  assert.equal(isDrawingIndexSheet(p24), true, 'Page 24 must be detected as general notes/index sheet');

  const res = readSheets([p24]);
  assert.equal(res.readings.length, 1);
  assert.equal(res.readings[0].sheet_type, 'general_notes');
  assert.equal(res.readings[0].instances.length, 0);
  assert.equal(res.readings[0].sections.length, 0, 'Must have 0 sections (no phantom F3, F4, B3, SP)');
  assert.ok(!res.vocab.includes('F3,F4'), 'vocab must not contain drawing list tags');
});

test('DPT House 1 Page 25: all spread footings detected including B/1 (95x0.95 repaired)', async () => {
  const fs = await import('fs');
  const d = JSON.parse(fs.readFileSync('src/pdf/fixtures/house1_sheets.json', 'utf8'));
  const { readings } = readSheets(d.pages);
  const p25 = readings.find(r => r.page === 25);
  assert.ok(p25, 'Page 25 must exist in readings');
  
  const spreadFootings = p25.instances.filter(i => i.member_type === 'FOOTING' && i.tag.includes('0.'));
  assert.equal(spreadFootings.length, 6, 'Must find all 6 spread footings on the plan');
  const b1 = spreadFootings.find(i => i.from_grid === 'B/1');
  assert.ok(b1, 'Must detect footing at grid B/1');
  assert.ok(b1.tag.startsWith('F(0.95X0.95'));
});

test('DPT House 1 Page 26: column stubs resolved to C1 instead of C?', async () => {
  const fs = await import('fs');
  const d = JSON.parse(fs.readFileSync('src/pdf/fixtures/house1_sheets.json', 'utf8'));
  const { readings } = readSheets(d.pages);
  const p26 = readings.find(r => r.page === 26);
  assert.ok(p26, 'Page 26 must exist in readings');

  const cols = p26.instances.filter(i => i.member_type === 'COLUMN');
  assert.ok(cols.length >= 6, 'Must detect columns on framing plan');
  assert.ok(cols.every(c => c.tag === 'C1'), 'All columns must be resolved to C1 (no C?)');
  assert.ok(cols.some(c => c.from_grid === 'C/1'), 'Must have column at C/1');
});
