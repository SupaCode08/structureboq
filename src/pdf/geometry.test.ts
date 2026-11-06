import test from 'node:test';
import assert from 'node:assert/strict';
import { findRings, ringsAtLineEnds, extractLines } from './scanPrep.ts';
import { textLines } from './labelOcr.ts';
import { fillClosed, rasterize } from './vectorText.ts';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS, type SheetReading } from '../engine/sheetMerge.ts';
import { boxesInRaster, imageGray } from './imageBoxes.ts';
import { glyphWords } from './glyphRead.ts';
import { readSheets } from './sheetReader.ts';
import type { OcrWord, PageOcr } from './types.ts';

/** blank binary raster (255 = paper) with helpers to draw ink */
function canvas(W: number, H: number) {
  const data = new Uint8Array(W * H).fill(255);
  const dot = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); if (xi >= 0 && yi >= 0 && xi < W && yi < H) data[yi * W + xi] = 0; };
  const ring = (cx: number, cy: number, r: number, t = 3) => { for (let a = 0; a < 2 * Math.PI; a += 0.002) for (let d = -t / 2; d <= t / 2; d += 0.5) dot(cx + (r + d) * Math.cos(a), cy + (r + d) * Math.sin(a)); };
  const disc = (cx: number, cy: number, r: number) => { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) dot(cx + x, cy + y); };
  const vline = (x: number, y0: number, y1: number, t = 3) => { for (let y = y0; y <= y1; y++) for (let d = 0; d < t; d++) dot(x + d - 1, y); };
  return { img: { data, width: W, height: H }, ring, disc, vline };
}

test('a drawn ring is a bubble; a filled disc or a letter is not', () => {
  const c = canvas(600, 400);
  c.ring(150, 150, 40);
  c.vline(150, 140, 160, 3);
  c.disc(400, 150, 40);
  const got = findRings(c.img, 30, 120);
  assert.equal(got.length, 1);
  assert.ok(Math.abs(got[0][0] * 600 - 150) < 2 && Math.abs(got[0][1] * 400 - 150) < 2);
});

test('a bubble at the end of a grid line is found even when the ring is broken', () => {
  const pxPerMm = 10;
  const c = canvas(800, 1200);
  c.ring(400, 200, 50);
  for (let y = 140; y < 170; y++) for (let x = 330; x < 360; x++) c.img.data[y * 800 + x] = 255;
  c.vline(400, 250, 1100);
  const lines = extractLines(c.img, 30);
  const got = ringsAtLineEnds(c.img, lines, pxPerMm);
  assert.ok(got.some(g => Math.abs(g[0] * 800 - 400) < 6 && Math.abs(g[1] * 1200 - 200) < 6), JSON.stringify(got));
  const d = canvas(800, 1200);
  d.vline(400, 250, 1100);
  assert.equal(ringsAtLineEnds(d.img, extractLines(d.img, 30), pxPerMm).length, 0);
});

test('stroke lettering is grouped into text lines, across or up the sheet', () => {
  const glyph = (x: number, y: number, w = 2, h = 3) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][];
  const across = [glyph(10, 10), glyph(12.6, 10), glyph(15.2, 10)];
  const up = [glyph(50, 30, 3, 2), glyph(50, 32.6, 3, 2), glyph(50, 35.2, 3, 2)];
  const lines = textLines([...across, ...up]);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(l => l.vertical).sort(), [false, true]);
  assert.ok(lines.every(l => l.box.polys.length === 3));
});

test('outline lettering is filled solid, keeping the hole of an "O"', () => {
  const outer: [number, number][] = [[1, 1], [9, 1], [9, 9], [1, 9], [1, 1]];
  const hole: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  const r = rasterize([outer, hole], 10, 10, 10, 1);
  fillClosed(r, [outer, hole], 10, 10, 10);
  const at = (x: number, y: number) => r.data[y * r.width + x];
  assert.equal(at(20, 20), 0);
  assert.equal(at(50, 50), 255);
  assert.equal(at(95, 95), 255);
});

test('bar text keeps its form through the merge: mesh, groups, spacing, written grade', () => {
  const sheets: SheetReading[] = [
    { page: 1, sheet_type: 'footing_plan', instances: [
      { tag: 'F1', member_type: 'FOOTING', from_grid: 'A/1' },
      { tag: 'F2', member_type: 'FOOTING', from_grid: 'A/2' },
    ], sections: [] },
    { page: 2, sheet_type: 'framing_plan', instances: [{ tag: 'GB3', member_type: 'BEAM', from_grid: 'A/1', to_grid: 'A/2', length_m: 4 }], sections: [] },
    { page: 3, sheet_type: 'section_detail', instances: [], sections: [
      { tag: 'F1', member_type: 'FOOTING', plan_w_m: 1, plan_l_m: 1, thickness_m: 0.25, bottom_rebar: '5+5-DB12' },
      { tag: 'F2', member_type: 'FOOTING', plan_w_m: 1.2, plan_l_m: 1.2, thickness_m: 0.25, bottom_rebar: 'RB12@0.15' },
      { tag: 'GB3', member_type: 'BEAM', width_m: 0.15, depth_m: 0.4, top_rebar: '3-RB12+2-DB16', bottom_rebar: '2-DB16+3-RB12', stirrup: 'RB6@0.15' },
    ] },
  ];
  const m = mergeSheetReadings(sheets, 'x.pdf', DEFAULT_MERGE_ASSUMPTIONS);
  const by = (t: string) => m.members.find(x => x.tag === t)!;
  assert.equal(by('F1').bottomRebar, '5+5-DB12');
  assert.equal(by('F2').bottomRebar, 'RB12@0.15');
  assert.equal(by('GB3').topRebar, '3-RB12+2-DB16');
  assert.equal(by('GB3').bottomRebar, '2-DB16+3-RB12');
});

test('boxes in a pasted picture: a shaded footing and the stub outlined inside it (corners touching diagonally)', () => {
  const W = 120, H = 100;
  const rgba = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, v: number) => { const i = (y * W + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255; };
  for (let y = 10; y < 90; y++) for (let x = 20; x < 60; x++) put(x, y, 140);
  for (let x = 31; x < 49; x++) { put(x, 25, 0); put(x, 74, 0); }
  for (let y = 26; y < 74; y++) { put(30, y, 0); put(49, y, 0); }
  for (let y = 40; y < 60; y++) for (let x = 80; x < 85; x++) put(x, y, 0);
  const g = imageGray({ width: W, height: H, kind: 3, data: rgba })!;
  assert.equal(g[0], 255);
  const b = boxesInRaster(g, W, H);
  const has = (x0: number, y0: number, x1: number, y1: number) => b.some(r => Math.abs(r[0] - x0) <= 1 && Math.abs(r[1] - y0) <= 1 && Math.abs(r[2] - x1) <= 1 && Math.abs(r[3] - y1) <= 1);
  assert.ok(has(20, 10, 60, 90), 'shaded footing');
  assert.ok(has(30, 25, 50, 75), 'outlined stub');
});

test('one-row footing plan with no tags: footings and stubs counted from the outlines on the grid lines', () => {
  const PW = 1190, PH = 842;
  const kx = (10 * 72 / 25.4) / PW, ky = (10 * 72 / 25.4) / PH;
  const x0 = 0.15, row = 0.16;
  const word = (text: string, x: number, y: number, w = 0.02): OcrWord => ({ text, x0: x - w / 2, x1: x + w / 2, y0: y - 0.005, y1: y + 0.005, vertical: false, conf: 99 });
  const words: OcrWord[] = [];
  const rects: [number, number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const x = x0 + i * 3.5 * kx;
    if (i < 4) words.push(word('3.50', x + 1.75 * kx, 0.07));
    rects.push([x - 0.4 * kx, row - 0.75 * ky, x + 0.4 * kx, row + 0.75 * ky]);
    rects.push([x - 0.15 * kx, row - 0.45 * ky, x + 0.15 * kx, row + 0.45 * ky]);
  }
  words.push(word('SCALE', 0.3, 0.25), word('1:100', 0.4, 0.25), word('1:30', 0.3, 0.6), word('1:30', 0.7, 0.6));
  words.push(word('F1|RCF-800x1500x300', 0.15, 0.76, 0.06), word('C1|RC-300x900', 0.35, 0.76, 0.05));
  const page: PageOcr = { page: 1, width: PW, height: PH, words, rects, hsegs: [], vsegs: [], circles: [] };
  const { readings } = readSheets([page]);
  const plan = readings.find(r => r.sheet_type === 'footing_plan')!;
  assert.ok(plan, 'footing plan found');
  assert.deepEqual(plan.grid!.x!.map(a => a.offset_m), [0, 3.5, 7, 10.5, 14]);
  assert.equal(plan.grid!.y!.length, 1);
  const m = mergeSheetReadings(readings, 'x.pdf', DEFAULT_MERGE_ASSUMPTIONS);
  assert.equal(m.members.filter(x => x.tag === 'F1' && x.memberType === 'FOOTING').length, 5);
  assert.equal(m.members.filter(x => x.tag === 'C1' && x.memberType === 'COLUMN').length, 5);
});

test('boxes stacked beside a dimension chain without sitting on its lines are not a plan (title block cells)', () => {
  const PW = 1190, PH = 842, kx = (10 * 72 / 25.4) / PW, ky = (10 * 72 / 25.4) / PH;
  const word = (text: string, x: number, y: number): OcrWord => ({ text, x0: x - 0.01, x1: x + 0.01, y0: y - 0.005, y1: y + 0.005, vertical: false, conf: 99 });
  const words = [0, 1, 2, 3].map(i => word('3.50', 0.15 + (i + 0.5) * 3.5 * kx, 0.07));
  const rects: [number, number, number, number][] = [0, 2.9, 7.4, 10.1, 14.3].map(m => [0.15 + m * kx - 0.01, 0.15, 0.15 + m * kx + 0.01, 0.15 + ky]);
  const { readings } = readSheets([{ page: 1, width: PW, height: PH, words, rects, hsegs: [], vsegs: [], circles: [] }]);
  assert.ok(!readings.some(r => r.sheet_type === 'footing_plan'));
});

test('footing-and-stub picture detail: bars told apart by where the leader notes are written', () => {
  const word = (text: string, x: number, y: number, w = 0.03): OcrWord => ({ text, x0: x - w / 2, x1: x + w / 2, y0: y - 0.005, y1: y + 0.005, vertical: false, conf: 99 });
  const words: OcrWord[] = [
    word('1:30', 0.5, 0.2), word('1:30', 0.5, 0.95),
    word('F2|RCF-1000x1200x300', 0.1, 0.8, 0.08), word('C2|RC-250x600', 0.1, 0.5, 0.06),
    word('6-DB16', 0.4, 0.45), word('2-RB6', 0.4, 0.4), word('@0.15', 0.43, 0.4),
    word('5-DB12', 0.4, 0.8), word('7-DB12', 0.4, 0.84),
    word('6-DB16', 0.7, 0.47), word('7-DB12', 0.7, 0.83),
    word('4-DB12', 0.5, 0.1),
  ];
  const { readings } = readSheets([{ page: 1, width: 1190, height: 842, words, rects: [], hsegs: [], vsegs: [], circles: [] }]);
  const secs = readings.flatMap(r => r.sections);
  const f = secs.find(s => s.tag === 'F2')!, c = secs.find(s => s.tag === 'C2')!;
  assert.equal(f.bottom_rebar, '5+7-DB12');
  assert.equal(c.main_rebar, '6-DB16');
  assert.equal(c.stirrup, 'RB6@0.15');
});

test('letters read by shape: copies of a stroke letter read like the copies OCR got right; ø learned between digits', () => {
  const W = 1000, H = 1000;
  const glyph: Record<string, [number, number][][]> = {
    '2': [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 8], [4, 8]]],
    '1': [[[2, 0], [2, 8]]],
    'ø': [[[0, 4], [2, 2], [4, 4], [2, 6], [0, 4]], [[0, 8], [4, 0]]],
  };
  const small: [number, number][][] = [];
  const write = (text: string, x: number, y: number) => [...text].forEach((ch, k) => small.push(...glyph[ch].map(p => p.map(([u, v]) => [x + k * 6 + u, y + v] as [number, number]))));
  const words: OcrWord[] = [];
  for (let i = 0; i < 12; i++) { write('21', 100, 50 + i * 20); words.push({ text: '21', x0: 0.1, x1: 0.11, y0: (50 + i * 20) / H, y1: (58 + i * 20) / H, vertical: false, conf: 90 }); }
  for (let i = 0; i < 12; i++) { write('12', 300, 50 + i * 20); words.push({ text: '12', x0: 0.3, x1: 0.311, y0: (50 + i * 20) / H, y1: (58 + i * 20) / H, vertical: false, conf: 90 }); }
  write('2ø12', 500, 50); write('2ø12', 500, 70);
  const got = glyphWords(small, W, H, words).map(w => w.text);
  assert.equal(got.filter(t => t === '2ø12').length, 2);
});

test('tag vocabulary: an OCR slip seen twice (B83 for B3) is not a tag of the set, so it cannot block the repair; a tag with no clean original stays', () => {
  const w = (text: string, x: number, y: number): OcrWord => ({ text, x0: x, x1: x + 0.02, y0: y, y1: y + 0.012, vertical: false, conf: 80 });
  const page = (words: OcrWord[]): PageOcr => ({ page: 1, width: 1190, height: 842, words, rects: [], hsegs: [], vsegs: [], circles: [] });
  const withB3 = readSheets([page([w('B3', 0.1, 0.1), w('B3', 0.3, 0.1), w('B3', 0.5, 0.1), w('B83', 0.1, 0.5), w('B83', 0.5, 0.5)])]);
  assert.ok(withB3.vocab.includes('B3'));
  assert.ok(!withB3.vocab.includes('B83'), 'the slip is not in the vocabulary');
  // no clean B3 anywhere: B83 is all the drawing says, so it stays a tag
  const alone = readSheets([page([w('B83', 0.1, 0.5), w('B83', 0.5, 0.5), w('TB12', 0.1, 0.2), w('TB12', 0.5, 0.2)])]);
  assert.ok(alone.vocab.includes('B83'));
  assert.ok(alone.vocab.includes('TB12'), 'an ordinary tag seen twice is kept');
});
