/**
 * Detail-sheet reading on synthetic pages: footing sections matched by their drawn width, a tag whose
 * "1" OCR read as "T", and slab sections dimensioned at one end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSheets, footingMeshAt, footingSections, footingBarNotes, completeTag } from './sheetReader.ts';
import type { OcrWord, PageOcr } from './types.ts';

const W = 1207, H = 844;
const word = (text: string, x: number, y: number, w = 0.02, vertical = false): OcrWord =>
  ({ text, x0: x - w / 2, x1: x + w / 2, y0: y - 0.005, y1: y + 0.005, vertical, conf: 95 });
const page = (n: number, words: OcrWord[], hsegs: [number, number, number][] = []): PageOcr =>
  ({ page: n, width: W, height: H, words, rects: [], hsegs, vsegs: [], circles: [] });

const kx = (50 * 72 / 25.4) / W, ky = (50 * 72 / 25.4) / H;

/** a footing cross-section: top edge broken by the column (0.20 m), bottom edge `t` below */
function section(x0: number, wM: number, t: number, y = 0.3, bottomInPieces = false): [number, number, number][] {
  const x1 = x0 + wM * kx, c = (x0 + x1) / 2, g = 0.1 * kx, yb = y + t * ky;
  return [[x0, y, c - g], [c + g, y, x1], ...(bottomInPieces ? [[x0, yb, c], [c, yb, x1]] as [number, number, number][] : [[x0, yb, x1] as [number, number, number]])];
}

test('a footing bottom line drawn in two pieces still closes the section', () => {
  const got = footingSections(section(0.1, 0.95, 0.2, 0.3, true), kx, ky);
  assert.deepEqual(got.map(s => [s.wM, s.tM]), [[0.95, 0.2]]);
});

test('footing details titled only in the title block: each section takes the mesh written on it', () => {
  const words = [
    word('F(0.95x0.95),', 0.87, 0.817, 0.05), word('F(1.05x1.05)', 0.92, 0.817, 0.045),
    word('1:20', 0.29, 0.84), word('1:20', 0.67, 0.84),
    word('7ø12มม', 0.27, 0.262, 0.03), word('8ø12มม', 0.27, 0.276, 0.03),
    word('5+5', 0.71, 0.26, 0.012), word('ø12มม', 0.727, 0.26, 0.018),
  ];
  const other = page(1, [word('F(0.95x0.95)', 0.3, 0.5, 0.05), word('F(1.05x1.05)', 0.6, 0.5, 0.05)]);
  const { readings } = readSheets([other, page(2, words, [...section(0.1, 0.95, 0.2, 0.3, true), ...section(0.55, 1.05, 0.25)])]);
  const secs = readings.flatMap(r => r.sections).filter(s => s.member_type === 'FOOTING');
  const f95 = secs.find(s => s.tag.startsWith('F0.95'))!, f105 = secs.find(s => s.tag.startsWith('F1.05'))!;
  assert.equal(f95.thickness_m, 0.2);
  assert.equal(f95.bottom_rebar, '7+8-DB12');
  assert.equal(f105.thickness_m, 0.25);
  assert.equal(f105.bottom_rebar, '5+5-DB12');
});

test('a lone bar count beside a footing section is not taken for its mesh', () => {
  const box = [300, 100, 334, 212];
  const p = page(1, [word('5ø12มม', 0.25, 0.26, 0.03)]);
  assert.equal(footingMeshAt(p, box, [], new Map()), undefined);
  const wide = [300, 100, 334, 300], next = [300, 420, 342, 540];
  const q = page(1, [word('5+5ø12มม', 0.45, 0.26, 0.04)]);
  assert.equal(footingMeshAt(q, wide, [next], new Map()), undefined);
  assert.equal(footingMeshAt(q, next, [wide], new Map()), '5+5-DB12');
});

test('a section title whose "1" was read as "T" is the set\'s tag; a mixed-case fragment is not', () => {
  const plan = page(1, [word('C1', 0.3, 0.3), word('C1', 0.5, 0.3), word('F1', 0.3, 0.5), word('F1', 0.5, 0.5)]);
  const detail = page(2, [
    word('1:20', 0.9, 0.9),
    word('CT', 0.2, 0.5, 0.013), word('0.20', 0.2, 0.40, 0.015), word('0.20', 0.15, 0.45, 0.005, true),
    word('4-DB12', 0.25, 0.46, 0.025), word('RB6@0.20', 0.25, 0.475, 0.035),
    word('Ft', 0.6, 0.5, 0.01), word('0.30', 0.6, 0.42, 0.015),
  ]);
  const secs = readSheets([plan, detail]).readings.filter(r => r.page === 2).flatMap(r => r.sections);
  const c1 = secs.find(s => s.tag === 'C1');
  assert.ok(c1, JSON.stringify(secs.map(s => s.tag)));
  assert.equal(c1!.width_m, 0.2);
  assert.equal(c1!.main_rebar, '4-DB12');
  assert.equal(c1!.stirrup, 'RB6@0.20');
  assert.ok(!secs.some(s => s.tag === 'F1'));
});

test('a slab section dimensioned at its far end still gives its thickness', () => {
  const plan = page(1, [word('S1', 0.3, 0.3), word('S1', 0.5, 0.3)]);
  const detail = page(2, [word('1:20', 0.9, 0.9), word('S1', 0.5, 0.8), word('0.10', 0.33, 0.72, 0.005, true)]);
  const s1 = readSheets([plan, detail]).readings.filter(r => r.page === 2).flatMap(r => r.sections).find(s => s.tag === 'S1');
  assert.equal(s1?.thickness_m, 0.1);
});

test('beam long view: support lengths are not the width; the section drawn beside it gives the size', () => {
  const words = [
    word('1:20', 0.89, 0.84),
    word('0.45', 0.10, 0.567), word('0.45', 0.33, 0.567),
    word('3.60', 0.22, 0.583), word('1.80', 0.55, 0.583),
    word('B4', 0.33, 0.626),
    word('0.20', 0.62, 0.413), word('0.35', 0.59, 0.479, 0.02, true),
    word('0.20', 0.75, 0.413), word('0.35', 0.72, 0.479, 0.02, true),
    word('2-DB16', 0.30, 0.45), word('2-DB16', 0.30, 0.52),
  ];
  const { readings } = readSheets([page(1, words), page(2, [word('B4', 0.5, 0.5)])]);
  assert.ok(!readings.some(r => r.page === 1 && r.sheet_type !== 'section_detail'));
  const b4 = readings.flatMap(r => r.sections).find(s => s.tag === 'B4')!;
  assert.equal(b4.width_m, 0.2);
  assert.equal(b4.depth_m, 0.35);
});

test('a bar count that cannot fit in one layer of the beam is left unread; a bold "B83" is B3', () => {
  const words = [
    word('0.20', 0.30, 0.40), word('0.35', 0.27, 0.45, 0.02, true),
    word('2-DB12', 0.36, 0.40), word('5-DB12', 0.36, 0.49),
    word('B83', 0.30, 0.55),
  ];
  const { readings } = readSheets([page(1, words), page(2, [word('B3', 0.5, 0.5), word('B3', 0.6, 0.6)])]);
  const b3 = readings.flatMap(r => r.sections).find(s => s.tag === 'B3')!;
  assert.ok(b3, 'B83 read as B3');
  assert.equal(b3.top_rebar, '2-DB12');
  assert.equal(b3.bottom_rebar, undefined);
  assert.ok(!b3.inferred_fields?.includes('top_rebar'));
});

test('a beam cross-section with one bar row fills both layers and flags top_rebar as inferred', () => {
  const words = [
    word('0.20', 0.30, 0.40), word('0.35', 0.27, 0.45, 0.02, true),
    word('2-DB12', 0.36, 0.40),
    word('B3', 0.30, 0.55),
  ];
  const { readings } = readSheets([page(1, words), page(2, [word('B3', 0.5, 0.5), word('B3', 0.6, 0.6)])]);
  const b3 = readings.flatMap(r => r.sections).find(s => s.tag === 'B3')!;
  assert.equal(b3.top_rebar, '2-DB12');
  assert.equal(b3.bottom_rebar, '2-DB12');
  assert.ok(b3.inferred_fields?.includes('top_rebar'));
});

test('bare and primed tags: "F,C" labels make F and C tags, GB1\' stays apart from GB1, a circled letter is a grid bubble', () => {
  const words = [
    word("GB1'", 0.3, 0.5), word('0.20', 0.3, 0.4), word('0.35', 0.27, 0.45, 0.02, true), word('3-DB12', 0.36, 0.41), word('2-DB12', 0.36, 0.48),
    word('GB1', 0.6, 0.5), word('0.20', 0.6, 0.4), word('0.35', 0.57, 0.45, 0.02, true), word('2-DB12', 0.66, 0.41), word('2-DB12', 0.66, 0.48),
    word('C', 0.8, 0.5), word('0.25x0.25', 0.8, 0.45, 0.04),
  ];
  const plan = [word('F,C', 0.2, 0.2), word('F,C', 0.4, 0.2), word('C', 0.1, 0.1), word("GB1'", 0.5, 0.5), word('GB1', 0.5, 0.6)];
  const circled = { ...page(2, plan), circles: [[0.1, 0.1, 0.02]] as [number, number, number][] };
  const { readings, vocab } = readSheets([page(1, words), circled]);
  assert.ok(vocab.includes('F') && vocab.includes('C') && vocab.includes("GB1'"));
  const secs = readings.flatMap(r => r.sections);
  assert.equal(secs.find(s => s.tag === "GB1'")!.top_rebar, '3-DB12');
  assert.equal(secs.find(s => s.tag === 'GB1')!.top_rebar, '2-DB12');
  assert.ok(!secs.find(s => s.tag === 'GB1')!.inferred_fields?.includes('top_rebar'));
  assert.deepEqual([secs.find(s => s.tag === 'C')!.width_m, secs.find(s => s.tag === 'C')!.depth_m], [0.25, 0.25]);
});

test('footing details of two variants on one sheet are kept apart by their titles', () => {
  const words = [
    word('F', 0.2, 0.6), word('(เสาเข็ม)', 0.26, 0.6, 0.06), word('4+4-DB12', 0.2, 0.5, 0.05),
    word('F', 0.6, 0.6), word('(ฐานแผ่)', 0.66, 0.6, 0.06), word('7+7-DB12', 0.6, 0.5, 0.05), word('1.20x1.20', 0.6, 0.55, 0.05),
  ];
  const plan = [word('F,C', 0.2, 0.2), word('F,C', 0.4, 0.2)];
  const secs = readSheets([page(1, words), page(2, plan)]).readings.flatMap(r => r.sections).filter(s => s.tag === 'F');
  const spread = secs.find(s => s.variant === 'แผ่')!;
  assert.equal(spread.bottom_rebar, '7+7-DB12');
  assert.deepEqual([spread.plan_w_m, spread.plan_l_m], [1.2, 1.2]);
  assert.equal(secs.find(s => s.variant === 'เสาเข็ม')!.bottom_rebar, '4+4-DB12');
});

test('beam long view with extra bars: top layer is the smaller count on its line, bottom the larger', () => {
  const words = [
    word('1:20', 0.89, 0.84),
    word('2-DB16', 0.26, 0.40), word('3-DB16', 0.4, 0.40),
    word('2-DB12', 0.26, 0.52), word('3-DB12', 0.4, 0.52),
    word('0.45', 0.1, 0.567), word('3.60', 0.3, 0.583),
    word('B7', 0.33, 0.6),
  ];
  const b7 = readSheets([page(1, words), page(2, [word('B7', 0.5, 0.5)])]).readings.flatMap(r => r.sections).find(s => s.tag === 'B7')!;
  assert.equal(b7.top_rebar, '2-DB16');
  assert.equal(b7.bottom_rebar, '3-DB12');
});

test('a low-confidence title of a tag on no plan does not take the values of a confident title next to it', () => {
  // dot32 p21: OCR noise "Gs" (35%) inside a note, next to footing F1's thickness and mesh
  const detail = (gsConf: number) => page(2, [
    word('F1', 0.5, 0.6), word('0.25', 0.56, 0.52, 0.02, true), word('7+7-DB12', 0.57, 0.50, 0.05),
    { ...word('Gs', 0.585, 0.545, 0.01), conf: gsConf },
  ]);
  const plan = page(1, [word('F1', 0.3, 0.3), word('F1', 0.5, 0.3)]);
  const read = (gsConf: number) => readSheets([plan, detail(gsConf)]).readings.filter(r => r.page === 2).flatMap(r => r.sections);
  const f1 = read(35).find(s => s.tag === 'F1')!;
  assert.equal(f1.thickness_m, 0.25);
  assert.equal(f1.bottom_rebar, '7+7-DB12');
  // a title read with normal confidence keeps the values nearest to it, as before
  const gs = read(80).find(s => s.tag === 'GS');
  assert.equal(gs?.thickness_m, 0.25);
});

test('pile note on a footing detail: count from the line above the size, not the unit misread after it', () => {
  const words = [
    word('F1', 0.2, 0.6), word('2', 0.362, 0.40, 0.01), word('0.15x0.15x6.00', 0.33, 0.415, 0.05),
    word('F2', 0.6, 0.6), word('4', 0.762, 0.40, 0.01), word('0.18x0.18x8.00', 0.73, 0.415, 0.05), word('3', 0.765, 0.415, 0.01),
  ];
  const secs = readSheets([page(1, words), page(2, [word('F1', 0.2, 0.2), word('F2', 0.4, 0.2)])]).readings.flatMap(r => r.sections);
  const f1 = secs.find(s => s.tag === 'F1')!, f2 = secs.find(s => s.tag === 'F2')!;
  assert.deepEqual([f1.pile_count, f1.pile_size], [2, '0.15x0.15x6.00']);
  assert.deepEqual([f2.pile_count, f2.pile_size], [4, '0.18x0.18x8.00']);
});

test('footingBarNotes keeps every bar note at the section and ignores level dimensions', () => {
  const box = [300, 100, 334, 212];
  const p = page(1, [
    word('2ø12มม', 0.13, 0.22, 0.03),
    word('3ø12มม', 0.25, 0.25, 0.03),
    word('3012+312@0.15L', 0.25, 0.28, 0.05),
    word('+0.20', 0.18, 0.26, 0.02),
  ]);
  const grades = new Map<number, 'RB' | 'DB'>();
  const notes = footingBarNotes(p, box, [], grades);
  assert.deepEqual(notes, ['2-DB12', '3-DB12', '3012+312@0.15L']);
  assert.equal(footingMeshAt(p, box, [], grades), undefined);
});

test('completeTag repairs a footing size where one digit was misread as a letter (0 read as p)', () => {
  const vocab = new Set(['F(0.90X0.90X0.30)', 'F(0.95X0.95)']);
  assert.deepEqual(completeTag('F(P.90X0.90X0.30)', vocab), { tag: 'F(0.90X0.90X0.30)', repaired: true });
  assert.deepEqual(completeTag('F(P.95X0.95)', vocab), { tag: 'F(0.95X0.95)', repaired: true });
  assert.equal(completeTag('F(P.9PX0.90X0.30)', vocab), null);
});

test('FIX 3: a stirrup note cut by midpoint split between two side-by-side titles still belongs to the left title', () => {
  const plan = page(1, [word('B1', 0.3, 0.3), word('B2', 0.6, 0.3)]);
  // B1 at x=0.3, B2 at x=0.6, midpoint x=0.45.
  // Stirrup words: as OCR reads it: 'Lb6' at cx=0.415 (in region), '.@0.15%' at cx=0.455 (past midpoint 0.45)
  const detail = page(2, [
    word('1:20', 0.9, 0.9),
    word('B1', 0.3, 0.6), word('0.20', 0.3, 0.45), word('0.40', 0.25, 0.50, 0.02, true),
    word('2-DB16', 0.3, 0.48),
    word('Lb6', 0.415, 0.52, 0.02), word('.@0.15%', 0.455, 0.52, 0.05),
    word('B2', 0.6, 0.6), word('0.20', 0.6, 0.45), word('0.40', 0.55, 0.50, 0.02, true),
  ]);
  const secs = readSheets([plan, detail]).readings.filter(r => r.page === 2).flatMap(r => r.sections);
  const b1 = secs.find(s => s.tag === 'B1')!;
  assert.ok(b1);
  assert.equal(b1.stirrup, 'RB6@0.15');
});

test('FIX 4: a duplicate tag inside a slab detail is ignored as a section boundary, keeping bottom rebar within reach', () => {
  const plan = page(1, [word('S1', 0.3, 0.3), word('S1', 0.5, 0.3)]);
  // Title S1 under detail at y=0.892, mark S1 inside detail at y=0.859, bottom bar 09@0.25# at y=0.83
  const detail = page(2, [
    word('1:20', 0.9, 0.9),
    word('S1', 0.4, 0.892),
    word('0.10', 0.35, 0.84, 0.015),
    word('S1', 0.4, 0.859),
    word('09@0.25#', 0.4, 0.83, 0.03),
  ]);
  const s1 = readSheets([plan, detail]).readings.filter(r => r.page === 2).flatMap(r => r.sections).find(s => s.tag === 'S1');
  assert.ok(s1);
  assert.equal(s1.thickness_m, 0.1);
  assert.equal(s1.bottom_rebar, 'RB9@0.25');
});

test('FIX 5: a square spread footing with a single count note infers two-way bottom rebar and flags inferred_fields', () => {
  const plan = page(1, [word('F(0.95x0.95)', 0.3, 0.5, 0.05)]);
  const detailWords = [
    word('F(0.95x0.95)', 0.87, 0.817, 0.05),
    word('1:20', 0.29, 0.84),
    word('5012', 0.27, 0.262, 0.03),
  ];
  const { readings } = readSheets([plan, page(2, detailWords, section(0.1, 0.95, 0.2, 0.3, true))]);
  const f95 = readings.flatMap(r => r.sections).find(s => s.member_type === 'FOOTING')!;
  assert.ok(f95);
  assert.equal(f95.thickness_m, 0.2);
  assert.equal(f95.bottom_rebar, '5+5-DB12');
  assert.ok(f95.inferred_fields?.includes('bottom_rebar'));
  assert.ok(f95.evidence?.includes('อ่านเหล็กได้ทางเดียว — ฐานรากสี่เหลี่ยมจัตุรัสใช้สองทางเท่ากัน'));
});
