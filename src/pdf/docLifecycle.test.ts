/**
 * Lifecycle of the pdf.js documents the app shows, on fake documents (no pdf.js, no PDF): a document is destroyed
 * exactly once, only when nothing shows it any more, and a failed read leaves the shown document alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { swapDoc, destroyOnError, type Slot } from './docLifecycle.ts';

const fakeDoc = (name: string) => ({ name, destroyed: 0, destroy() { this.destroyed++; return Promise.resolve(); } });
type Fake = ReturnType<typeof fakeDoc>;
const slots = () => { const drawing: Slot<Fake> = { current: null }, boq: Slot<Fake> = { current: null }; return { drawing, boq, all: [drawing, boq] }; };

test('BOQ parsing throws: the loaded document is destroyed and the same error reaches the caller', async () => {
  const doc = fakeDoc('boq'), err = new Error('ไม่พบตาราง ปร.4');
  await assert.rejects(destroyOnError(doc, async () => { throw err; }), e => e === err);
  assert.equal(doc.destroyed, 1);
});

test('reading succeeds: the document is kept and the result returned', async () => {
  const doc = fakeDoc('boq');
  assert.equal(await destroyOnError(doc, async () => 42), 42);
  assert.equal(doc.destroyed, 0);
});

test('a new file replaces the old one: the old document is destroyed once, the new one kept', () => {
  const { drawing, all } = slots(), a = fakeDoc('a'), b = fakeDoc('b');
  swapDoc(drawing, { doc: a, key: 'a' }, all);
  swapDoc(drawing, { doc: b, key: 'b' }, all);
  assert.equal(drawing.current?.doc, b);
  assert.deepEqual([a.destroyed, b.destroyed], [1, 0]);
});

test('a document still shown by the other slot is not destroyed until neither shows it', () => {
  const { drawing, boq, all } = slots(), a = fakeDoc('a'), b = fakeDoc('b');
  swapDoc(drawing, { doc: a, key: 'a' }, all);
  swapDoc(boq, { doc: a, key: 'a' }, all); // drawing set with its own ปร.4
  swapDoc(drawing, { doc: b, key: 'b' }, all); // next drawing has no BOQ: the BOQ tab still shows a
  assert.equal(a.destroyed, 0);
  swapDoc(boq, null, all); // sample switch clears it
  assert.equal(a.destroyed, 1);
  swapDoc(drawing, null, all);
  assert.deepEqual([a.destroyed, b.destroyed], [1, 1]);
});

test('pointing a slot at the document it already shows does not destroy it', () => {
  const { drawing, all } = slots(), a = fakeDoc('a');
  swapDoc(drawing, { doc: a, key: 'a1' }, all);
  swapDoc(drawing, { doc: a, key: 'a2' }, all);
  assert.equal(a.destroyed, 0);
});

test('a failed upload keeps the document on screen: only the failed file is destroyed', async () => {
  const { drawing, all } = slots(), shown = fakeDoc('shown'), failed = fakeDoc('failed');
  swapDoc(drawing, { doc: shown, key: 'shown' }, all);
  // as processPdf: the slot changes only after reading succeeded
  await assert.rejects(destroyOnError(failed, async () => { throw new Error('OCR failed'); }).then(() => swapDoc(drawing, { doc: failed, key: 'failed' }, all)));
  assert.equal(drawing.current?.doc, shown);
  assert.deepEqual([shown.destroyed, failed.destroyed], [0, 1]);
});
