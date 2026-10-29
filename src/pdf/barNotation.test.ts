import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBarNote, barPhrases, gradeBySize, formatBar } from './barNotation.ts';

test('bar counts as written on Thai drawings', () => {
  assert.deepEqual(parseBarNote('2-DB16'), { kind: 'count', n: 2, grade: 'DB', dia: 16 });
  assert.deepEqual(parseBarNote('3RB12'), { kind: 'count', n: 3, grade: 'RB', dia: 12 });
  assert.deepEqual(parseBarNote('2-RB2'), { kind: 'count', n: 2, grade: 'RB', dia: 12 });
  assert.deepEqual(parseBarNote('2-015aa.'), { kind: 'count', n: 2, grade: null, dia: 15 });
  assert.deepEqual(parseBarNote('06HH.@0.175'), { kind: 'spacing', grade: null, dia: 6, s: 0.175 });
  assert.deepEqual(parseBarNote('3-RB9'), { kind: 'count', n: 3, grade: 'RB', dia: 9 });
  assert.deepEqual(parseBarNote('4ø12มม.'), { kind: 'count', n: 4, grade: null, dia: 12 });
  assert.deepEqual(parseBarNote('2 - Ø16 mm.'), { kind: 'count', n: 2, grade: null, dia: 16 });
  assert.deepEqual(parseBarNote('4012'), { kind: 'count', n: 4, grade: null, dia: 12 });
  assert.equal(parseBarNote('0.20'), null);
  assert.equal(parseBarNote('2562'), null);
  assert.equal(parseBarNote('62088'), null);
  assert.equal(parseBarNote('1:20'), null);
  assert.equal(parseBarNote('2-DB13'), null);
});

test('footing meshes, including OCR look-alikes of ø', () => {
  for (const t of ['5+5ø12มม.', '5+5¢12', '5+5612', '5+5-DB12', '5 + 5 Ø12'])
    assert.equal(parseBarNote(t)?.kind, 'mesh', t);
  assert.deepEqual(parseBarNote('7+8-DB12'), { kind: 'mesh', a: 7, b: 8, grade: 'DB', dia: 12 });
  assert.deepEqual(parseBarNote('6+11-DB12'), { kind: 'mesh', a: 6, b: 11, grade: 'DB', dia: 12 });
  assert.equal(parseBarNote('1+3:5'), null);
});

test('spaced bars: stirrups, slab and footing meshes', () => {
  assert.deepEqual(parseBarNote('RB6@0.20'), { kind: 'spacing', grade: 'RB', dia: 6, s: 0.2 });
  assert.deepEqual(parseBarNote('ป-RB6 mm.@ 0.20 m.'), { kind: 'spacing', grade: 'RB', dia: 6, s: 0.2 });
  assert.deepEqual(parseBarNote('Ø12mm.@0.15m.'), { kind: 'spacing', grade: null, dia: 12, s: 0.15 });
  assert.deepEqual(parseBarNote('DB12@0.20'), { kind: 'spacing', grade: 'DB', dia: 12, s: 0.2 });
  assert.deepEqual(parseBarNote('ø9@20ซม.'), { kind: 'spacing', grade: null, dia: 9, s: 0.2 });
  assert.equal(parseBarNote('RB6@1.50'), null);
});

test('bar text split by OCR is joined along the line', () => {
  const w = (text: string, x0: number, x1: number, y0 = 0.5) => ({ text, x0, x1, y0, y1: y0 + 0.01 });
  const got = barPhrases([w('5+5', 0.5, 0.52), w('ø12มม.', 0.523, 0.55), w('0.95', 0.7, 0.72), w('RB6', 0.3, 0.315), w('@0.20', 0.317, 0.34)]);
  assert.deepEqual(got.map(g => formatBar(g.note)).sort(), ['5+5-DB12', 'RB6@0.20']);
  assert.equal(barPhrases([w('5+5', 0.5, 0.52), w('12', 0.6, 0.61)]).length, 0);
  assert.equal(barPhrases([w('7', 0.5, 0.51), w('4ø12', 0.515, 0.54)])[0].text, '4ø12');
  assert.equal(barPhrases([w('RB6', 0.3, 0.315), w('@0.20', 0.317, 0.34, 0.53)]).length, 0);
});

test('an unmarked ø takes the grade the set writes for that size', () => {
  const set = gradeBySize(['2-RB12', '3-RB12', '2-DB16', 'RB6@0.20']);
  assert.equal(formatBar(parseBarNote('Ø12mm.@0.15m.')!, set), 'RB12@0.15');
  assert.equal(formatBar(parseBarNote('5+5ø12')!, gradeBySize(['4-DB12'])), '5+5-DB12');
  assert.equal(formatBar(parseBarNote('5+5ø12')!), '5+5-DB12');
  assert.equal(formatBar(parseBarNote('ø9@0.25')!), 'RB9@0.25');
});

test('OCR forms of ø and ป seen on scanned and outline-font sheets', () => {
  assert.deepEqual(parseBarNote('2816'), { kind: 'count', n: 2, grade: null, dia: 16 });
  assert.deepEqual(parseBarNote('3@16'), { kind: 'count', n: 3, grade: null, dia: 16 });
  assert.deepEqual(parseBarNote('Uz6มม.@0.15'), { kind: 'spacing', grade: null, dia: 6, s: 0.15 });
  assert.deepEqual(parseBarNote('U06MM.@0.15'), { kind: 'spacing', grade: null, dia: 6, s: 0.15 });
  assert.equal(parseBarNote('@0.15'), null);
});

test('a ø dropped by OCR between count and size is restored only across a letter-wide gap', () => {
  const w = (text: string, x0: number, x1: number) => ({ text, x0, x1, y0: 0.255, y1: 0.262 });
  assert.deepEqual(barPhrases([w('5+5', 0.711, 0.722), w('12', 0.734, 0.743)]).map(g => formatBar(g.note)), ['5+5-DB12']);
  assert.equal(barPhrases([w('5+5', 0.711, 0.722), w('12', 0.76, 0.77)]).length, 0);
  assert.equal(barPhrases([w('0.95', 0.5, 0.52), w('12', 0.53, 0.54)]).length, 0);
});

test('label-OCR forms: damaged ป/ø before a spaced bar, Thai look-alikes of ø, Latin "มม."', () => {
  assert.deepEqual(parseBarNote('ๆ179มม.@0.20'), { kind: 'spacing', grade: null, dia: 9, s: 0.2 });
  assert.deepEqual(parseBarNote('ป676มม.@0.15'), { kind: 'spacing', grade: null, dia: 6, s: 0.15 });
  assert.deepEqual(parseBarNote('=--ป69 มม.@0.20'), { kind: 'spacing', grade: null, dia: 9, s: 0.2 });
  assert.deepEqual(parseBarNote('3ผู16มม.'), { kind: 'count', n: 3, grade: null, dia: 16 });
  assert.deepEqual(parseBarNote('2016 WU.'), { kind: 'count', n: 2, grade: null, dia: 16 });
  assert.equal(parseBarNote('1:20'), null);
  assert.equal(parseBarNote('S62088'), null);
  assert.equal(parseBarNote('F(0.95X0.95)'), null);
});

test('a stirrup whose "มม." OCR dropped still joins its spacing', () => {
  const w = (text: string, x0: number, x1: number) => ({ text, x0, x1, y0: 0.5, y1: 0.508 });
  const got = barPhrases([w('1.', 0.447, 0.453), w('26', 0.455, 0.463), w('.@0.15', 0.475, 0.495)]);
  assert.deepEqual(got.map(g => formatBar(g.note)), ['RB6@0.15']);
  assert.deepEqual(parseBarNote('ป.ø6มม.@0.175ม.'), { kind: 'spacing', grade: null, dia: 6, s: 0.175 });
});

test('spacing keeps a third decimal when it has one', () => {
  assert.equal(formatBar(parseBarNote('RB6@0.175')!), 'RB6@0.175');
  assert.equal(formatBar(parseBarNote('RB6@0.2')!), 'RB6@0.20');
});

test('a spacing cut short by OCR is restored to the written series', () => {
  assert.equal(formatBar(parseBarNote('RB6@0.17')!), 'RB6@0.175');
  assert.equal(formatBar(parseBarNote('RB6@0.12')!), 'RB6@0.125');
  assert.equal(formatBar(parseBarNote('RB6@0.15')!), 'RB6@0.15');
});

test('ties set in pairs: "2-RB6@0.10", also split by OCR into "2-RB6" "@" "0.10"', () => {
  assert.deepEqual(parseBarNote('2-RB6@0.10'), { kind: 'spacing', grade: 'RB', dia: 6, s: 0.1, legs: 2 });
  assert.equal(parseBarNote('2-6@0.10'), null);
  const w = (text: string, x0: number, x1: number) => ({ text, x0, x1, y0: 0.5, y1: 0.51 });
  const ph = barPhrases([w('2-RB6', 0.1, 0.13), w('@', 0.132, 0.137), w('0.10', 0.139, 0.15)]);
  assert.equal(ph.length, 1);
  assert.equal(formatBar(ph[0].note), 'RB6@0.10');
});

test('a note OCR returned as two overlapping boxes ("4" over "912" for "4ø12") still joins', () => {
  const w = (text: string, x0: number, x1: number, y0: number, y1: number) => ({ text, x0, x1, y0, y1 });
  const got = barPhrases([w('4', 0.158, 0.168, 0.199, 0.207), w('912', 0.164, 0.174, 0.198, 0.21)]);
  assert.deepEqual(got.map(g => formatBar(g.note)), ['4-DB12']);
});

test('English stirrup notes and round-bar sizes: "Strr-1RB6mm.@0.15m", ø15 / ø19, a set of unmarked ø15 means round bar', () => {
  assert.equal(formatBar(parseBarNote('Strr-1RB6mm.@0.15m')!), 'RB6@0.15');
  assert.deepEqual(parseBarNote('2-@15'), { kind: 'count', n: 2, grade: null, dia: 15 });
  const set = gradeBySize(['2-ø15', '3-ø15', '2-ø15', '2-ø12']);
  assert.equal(formatBar(parseBarNote('2-ø12')!, set), '2-RB12');
  assert.equal(formatBar(parseBarNote('2-ø12')!, gradeBySize(['2-ø12', '2-ø16'])), '2-DB12');
});

test('Thai standard construction drawing symbols (วสท. / มอก. / กรมโยธาธิการฯ)', () => {
  // 1. Thai stirrups (ป., ปล., ปลอก, 2-ปล.)
  assert.deepEqual(parseBarNote('ปล.RB6@0.15'), { kind: 'spacing', grade: 'RB', dia: 6, s: 0.15 });
  assert.deepEqual(parseBarNote('ปลอก-RB6@0.15'), { kind: 'spacing', grade: 'RB', dia: 6, s: 0.15 });
  assert.deepEqual(parseBarNote('ปลอก RB6 @ 0.15 ม.'), { kind: 'spacing', grade: 'RB', dia: 6, s: 0.15 });
  assert.deepEqual(parseBarNote('2-ปล.RB6@0.10'), { kind: 'spacing', grade: 'RB', dia: 6, s: 0.1, legs: 2 });

  // 2. Thai two-way mesh notations (#, ตะแกรง 2 ทาง, สองทาง)
  assert.deepEqual(parseBarNote('DB12@0.15#'), { kind: 'spacing', grade: 'DB', dia: 12, s: 0.15 });
  assert.deepEqual(parseBarNote('DB12@0.15 ม. ตะแกรง 2 ทาง'), { kind: 'spacing', grade: 'DB', dia: 12, s: 0.15 });
  assert.deepEqual(parseBarNote('DB12@0.15 ม. (สองทาง)'), { kind: 'spacing', grade: 'DB', dia: 12, s: 0.15 });

  // 3. Beam top / bottom / extra rebar placement annotations
  assert.deepEqual(parseBarNote('2-DB16 (บน)'), { kind: 'count', n: 2, grade: 'DB', dia: 16 });
  assert.deepEqual(parseBarNote('3-DB16 (ล่าง)'), { kind: 'count', n: 3, grade: 'DB', dia: 16 });
  assert.deepEqual(parseBarNote('2-DB12 (พิเศษ)'), { kind: 'count', n: 2, grade: 'DB', dia: 12 });

  // 4. Thai numerals in government drawings (๑ ๒ ๓ ๔ ๕ ๖ ๗ ๘ ๙ ๐)
  assert.deepEqual(parseBarNote('๔-DB๑๒'), { kind: 'count', n: 4, grade: 'DB', dia: 12 });
  assert.deepEqual(parseBarNote('๒-DB๑๖'), { kind: 'count', n: 2, grade: 'DB', dia: 16 });
  assert.deepEqual(parseBarNote('ป-RB๖@๐.๑๕'), { kind: 'spacing', grade: 'RB', dia: 6, s: 0.15 });

  // 5. Thai standard TIS grades (มอก. 24: SD30, SD40, SD50 / มอก. 20: SR24)
  assert.deepEqual(parseBarNote('2-SD40-DB16'), { kind: 'count', n: 2, grade: 'DB', dia: 16 });
  assert.deepEqual(parseBarNote('2-SD40 16'), { kind: 'count', n: 2, grade: 'DB', dia: 16 });
  assert.deepEqual(parseBarNote('2-SD30 12'), { kind: 'count', n: 2, grade: 'DB', dia: 12 });
  assert.deepEqual(parseBarNote('2-SR24-RB9'), { kind: 'count', n: 2, grade: 'RB', dia: 9 });
});
