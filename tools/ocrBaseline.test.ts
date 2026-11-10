import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOcrBaseline, toSetScore, type OcrBaseline, type SetScore } from './ocrBaseline.ts';

const cat = (right: number, wrong: number, missing: number) => ({ right, wrong, missing });
const score = (right: number, wrong: number, missing: number): SetScore => ({
  right, wrong, missing,
  byCategory: { grid: cat(2, 0, 0), tag: cat(5, 0, 1), count: cat(3, 1, 0), dimension: cat(right - 10, 0, 0), rebar: cat(0, wrong - 1, missing) },
});
const base = (): OcrBaseline => ({ ocrId: 'a'.repeat(64), generatedAt: '2026-11-06', sets: { s1: score(40, 3, 10), s2: score(50, 2, 5) } });

test('ocr gate: same result passes, and says the OCR code is the same', () => {
  const r = compareOcrBaseline(base(), { s1: score(40, 3, 10), s2: score(50, 2, 5) }, 'a'.repeat(64));
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  assert.match(r.lines[0], /same as the baseline/);
});

test('ocr gate: a wrong value more, or a right value fewer, in any set fails — naming the set', () => {
  const moreWrong = compareOcrBaseline(base(), { s1: score(40, 4, 9), s2: score(50, 2, 5) }, 'a'.repeat(64));
  assert.equal(moreWrong.ok, false);
  assert.ok(moreWrong.failures.some(f => /^s1: wrong values rose 3 → 4/.test(f)));
  const fewerRight = compareOcrBaseline(base(), { s1: score(40, 3, 10), s2: score(49, 2, 6) }, 'a'.repeat(64));
  assert.equal(fewerRight.ok, false);
  assert.ok(fewerRight.failures.some(f => /^s2: right values fell 50 → 49/.test(f)));
});

test('ocr gate: improvements pass and are printed; a set missing from the run fails; a new set is only noted', () => {
  const better = compareOcrBaseline(base(), { s1: score(43, 2, 8), s2: score(50, 2, 5), s3: score(10, 0, 0) }, 'b'.repeat(64));
  assert.equal(better.ok, true);
  assert.ok(better.lines.some(l => /s1: right 40 → 43 \(\+3\) · wrong 3 → 2 \(-1\)/.test(l)));
  assert.ok(better.lines.some(l => /s3: new set/.test(l)));
  assert.match(better.lines[0], /OCR code changed/);
  const lost = compareOcrBaseline(base(), { s1: score(40, 3, 10) }, 'a'.repeat(64));
  assert.equal(lost.ok, false);
  assert.ok(lost.failures.some(f => /^s2: not scored/.test(f)));
});

test('ocr gate: a category that moved is listed under its set even when the totals did not', () => {
  const moved = score(40, 3, 10);
  moved.byCategory = { ...moved.byCategory, count: cat(2, 2, 0) };
  const r = compareOcrBaseline(base(), { s1: moved, s2: score(50, 2, 5) }, 'a'.repeat(64));
  assert.ok(r.lines.some(l => /^ {2}count: right 3 → 2 · wrong 1 → 2/.test(l)));
});

test('ocr gate: what is kept from a score is only the counts', () => {
  const full = { right: 1, wrong: 2, missing: 3, byCategory: score(40, 3, 10).byCategory, notes: ['x'], total: 6, tags: 1, tagsFound: 1, byType: {} };
  assert.deepEqual(Object.keys(toSetScore(full)).sort(), ['byCategory', 'missing', 'right', 'wrong']);
});

test('ocr gate: partial=true with a missing baseline set passes, notes not compared, and includes the banner', () => {
  const r = compareOcrBaseline(base(), { s1: score(40, 3, 10) }, 'a'.repeat(64), true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  assert.equal(r.lines[0], 'PARTIAL RUN: sets not scored here were not compared, this is not the full gate');
  assert.ok(r.lines.includes('s2: not compared (partial run)'));
});

test('ocr gate: partial=true still fails when a scored set has more wrong values or fewer right values', () => {
  const moreWrong = compareOcrBaseline(base(), { s1: score(40, 4, 9) }, 'a'.repeat(64), true);
  assert.equal(moreWrong.ok, false);
  assert.ok(moreWrong.failures.some(f => /^s1: wrong values rose 3 → 4/.test(f)));
  const fewerRight = compareOcrBaseline(base(), { s1: score(39, 3, 11) }, 'a'.repeat(64), true);
  assert.equal(fewerRight.ok, false);
  assert.ok(fewerRight.failures.some(f => /^s1: right values fell 40 → 39/.test(f)));
});

test('ocr gate: partial omitted or false with a missing set still fails exactly as before', () => {
  const omitted = compareOcrBaseline(base(), { s1: score(40, 3, 10) }, 'a'.repeat(64));
  assert.equal(omitted.ok, false);
  assert.ok(omitted.failures.some(f => /^s2: not scored in this run/.test(f)));
  const explicitFalse = compareOcrBaseline(base(), { s1: score(40, 3, 10) }, 'a'.repeat(64), false);
  assert.equal(explicitFalse.ok, false);
  assert.ok(explicitFalse.failures.some(f => /^s2: not scored in this run/.test(f)));
});
