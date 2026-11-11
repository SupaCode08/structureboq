import test from 'node:test';
import assert from 'node:assert/strict';
import { titleBlockStrokes, titleBlockVerdict, sheetCodeVerdict, rightColumnRules, photoVerdict } from './titleBlock.ts';
import type { Polyline } from './vectorText.ts';

test('titleBlockVerdict: classification cases', () => {
  assert.deepEqual(titleBlockVerdict(['A—09']), { id: 'A-09', skip: true, structural: false });
  assert.deepEqual(titleBlockVerdict(['S-02']), { id: 'S-02', skip: false, structural: true });
  assert.deepEqual(titleBlockVerdict(['SN-01']), { id: 'SN-01', skip: true, structural: false });
  assert.deepEqual(titleBlockVerdict(['A-01', 'S-03']), { id: 'S-03', skip: false, structural: true });
  assert.deepEqual(titleBlockVerdict(['FE-03']), { id: undefined, skip: false, structural: false });
  assert.deepEqual(titleBlockVerdict(['A09']), { id: 'A-09', skip: true, structural: false });
  assert.deepEqual(titleBlockVerdict(['S—=17']), { id: 'S-17', structural: true, skip: false });
  assert.deepEqual(titleBlockVerdict([]), { id: undefined, skip: false, structural: false });
});

test('titleBlockStrokes: a polyline fully in the corner is kept and shifted; one with a point outside is dropped; returned size is 0.24/0.15 of the page', () => {
  const widthPt = 1000;
  const heightPt = 1000;
  const cornerPoly: Polyline = [[760, 850], [800, 900], [1000, 1000]];
  const outsidePolyX: Polyline = [[759, 850], [800, 900]];
  const outsidePolyY: Polyline = [[800, 849], [800, 900]];

  const res = titleBlockStrokes([cornerPoly, outsidePolyX, outsidePolyY], widthPt, heightPt);

  assert.equal(res.polys.length, 1);
  assert.deepEqual(res.polys[0], [[0, 0], [40, 50], [240, 150]]);
  assert.equal(res.widthPt, 240);
  assert.equal(res.heightPt, 150);
});

test('sheetCodeVerdict: classify sheet codes with dashed disambiguation', () => {
  assert.deepEqual(sheetCodeVerdict('[ETT EY FY EE 5-04 Y PROSE'), { kind: 'struct', id: 'S-04' });
  assert.deepEqual(sheetCodeVerdict('A-01 S-01'), { kind: 'index' });
  assert.deepEqual(sheetCodeVerdict('SHEET A-09'), { kind: 'nonstruct', id: 'A-09' });
  assert.deepEqual(sheetCodeVerdict('S-02'), { kind: 'struct', id: 'S-02' });
  assert.deepEqual(sheetCodeVerdict('EE-01'), { kind: 'nonstruct', id: 'EE-01' });
  assert.deepEqual(sheetCodeVerdict('ORG 12'), { kind: 'none' });
  assert.deepEqual(sheetCodeVerdict('A 3 S-04'), { kind: 'struct', id: 'S-04' });
  assert.deepEqual(sheetCodeVerdict('A-3 S 04'), { kind: 'nonstruct', id: 'A-03' });
  assert.deepEqual(sheetCodeVerdict('A 3 S 04'), { kind: 'struct', id: 'S-04' });
  assert.deepEqual(sheetCodeVerdict('5 2 OO E OM ON C RE'), { kind: 'none' });
  assert.deepEqual(sheetCodeVerdict('FRINGED @ : QUI 888 S1IN'), { kind: 'none' });
  assert.deepEqual(sheetCodeVerdict('S-1'), { kind: 'struct', id: 'S-01' });
  assert.deepEqual(sheetCodeVerdict('S01'), { kind: 'struct', id: 'S-01' });
  assert.deepEqual(sheetCodeVerdict('A-1'), { kind: 'nonstruct', id: 'A-01' });
  assert.deepEqual(sheetCodeVerdict('FU 1 DDEU 1 Y 21 $8 550 [OD'), { kind: 'none' });
  assert.deepEqual(sheetCodeVerdict('5 04'), { kind: 'none' });
  assert.deepEqual(sheetCodeVerdict('5-04'), { kind: 'struct', id: 'S-04' });
  assert.deepEqual(sheetCodeVerdict('S 04'), { kind: 'struct', id: 'S-04' });
});

test('rightColumnRules: count distinct long vertical rules in right 30%', () => {
  // a page 1000x700 with verticals at x 840 and 950 full height plus one short (100 pt) at 900 -> 2
  assert.equal(rightColumnRules([[840, 0, 700], [950, 0, 700], [900, 0, 100]], 1000, 700), 2);
  // verticals at 840, 870, 880, 900, 930, 1000 full height -> 6
  assert.equal(rightColumnRules([[840, 0, 700], [870, 0, 700], [880, 0, 700], [900, 0, 700], [930, 0, 700], [1000, 0, 700]], 1000, 700), 6);
  // two verticals at 840.2 and 840.4 count once
  assert.equal(rightColumnRules([[840.2, 0, 700], [840.4, 0, 700]], 1000, 700), 1);
  // a long vertical at x 500 is not counted
  assert.equal(rightColumnRules([[500, 0, 700]], 1000, 700), 0);
});

test('photoVerdict: classify photos/renders by colour and white share', () => {
  // small RGB image of random saturated colours (10x10)
  const saturatedData = new Uint8Array(10 * 10 * 3);
  for (let i = 0; i < 100; i++) {
    saturatedData[i * 3] = (i * 97) % 256;
    saturatedData[i * 3 + 1] = 0;
    saturatedData[i * 3 + 2] = 255;
  }
  const saturated = { data: saturatedData, width: 10, height: 10 };
  assert.equal(photoVerdict(saturated, 0.2), true);
  assert.equal(photoVerdict(saturated, 0.05), false);

  // mostly white image with black lines (grey only) cover 1 -> false
  const greyData = new Uint8Array(10 * 10 * 3);
  for (let i = 0; i < 100; i++) {
    const v = i < 80 ? 255 : 0;
    greyData[i * 3] = v;
    greyData[i * 3 + 1] = v;
    greyData[i * 3 + 2] = v;
  }
  assert.equal(photoVerdict({ data: greyData, width: 10, height: 10 }, 1), false);

  // kind 1 image -> false
  assert.equal(photoVerdict({ data: new Uint8Array(100), width: 10, height: 10, kind: 1 }, 1), false);

  // mostly white image with 20% blue lines (white share > 0.6) -> false
  const blueLinesData = new Uint8Array(10 * 10 * 3);
  for (let i = 0; i < 100; i++) {
    const isBlue = i % 5 === 0;
    blueLinesData[i * 3] = isBlue ? 0 : 255;
    blueLinesData[i * 3 + 1] = isBlue ? 0 : 255;
    blueLinesData[i * 3 + 2] = 255;
  }
  assert.equal(photoVerdict({ data: blueLinesData, width: 10, height: 10 }, 0.5), false);
});


