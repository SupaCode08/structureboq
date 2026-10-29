import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { compareWords, type Word } from './compareWords.ts';

const base: Word[] = [
  [0, '3.50', 99, 0.10, 0.10, 0.12, 0.13, 1],
  [0, '3.50', 99, 0.30, 0.10, 0.32, 0.13, 1],
  [1, 'B2', 86, 0.25, 0.50, 0.26, 0.53, 0],
];

test('identical runs compare identical, also with rounding-level noise', () => {
  assert.equal(compareWords(base, base).identical, true);
  const noisy = base.map(w => [w[0], w[1], w[2], w[3] + 1e-6, w[4], w[5], w[6], w[7]] as Word);
  assert.equal(compareWords(base, noisy).identical, true);
});

test('each kind of change is reported', () => {
  const run: Word[] = [
    [0, '3.60', 99, 0.10, 0.10, 0.12, 0.13, 1],     // text changed
    [0, '3.50', 97, 0.30, 0.10, 0.32, 0.13, 0],     // conf + orientation changed
    [1, 'B2', 86, 0.2505, 0.50, 0.26, 0.53, 0],     // position changed (still the same word)
    [1, 'C1', 80, 0.70, 0.70, 0.72, 0.72, 0],       // added
  ];
  const d = compareWords(base, run);
  assert.equal(d.textChanged.length, 1);
  assert.equal(d.confChanged.length, 1);
  assert.equal(d.orientationChanged.length, 1);
  assert.equal(d.posChanged.length, 1);
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 0);
  assert.equal(d.identical, false);
  assert.equal(compareWords(base, run.slice(0, 2)).removed.length, 1); // B2 gone
});

test('the saved page 9 baseline is complete and compares identical with itself', () => {
  const b = JSON.parse(fs.readFileSync('src/pdf/fixtures/turned/thaisuk_1_p9.json', 'utf8'));
  assert.equal(b.words.length, 129);
  assert.equal(compareWords(b.words, b.words).identical, true);
});
