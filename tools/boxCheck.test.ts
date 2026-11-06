import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBoxes, isMemberTag, type Word } from './boxCheck.ts';

test('member tags: names pass, whole OCR lines do not', () => {
  for (const t of ['B1', 'GB2', "B1'", 'F0.50X0.50', 'F1.45X0.95X0.30', 'C?', 'B1,B2', 'SP']) assert.ok(isMemberTag(t), t);
  for (const t of ['F0.50X0.50 0.50 0.10', 'fl.', '0.20', 'B1, B2']) assert.ok(!isMemberTag(t), t);
});

test('box findings: a bad tag, a box away from its label, a box in the title block', () => {
  const w = (text: string, x: number, y: number): Word => ({ text, x0: x, x1: x + 0.02, y0: y, y1: y + 0.01 });
  const words = [w('F2', 0.5, 0.5), w('B1', 0.2, 0.2), w('แผ่นที่', 0.9, 0.9)];
  const box = (x: number, y: number) => [y * 1000, x * 1000, (y + 0.01) * 1000, (x + 0.02) * 1000];
  const readings = [{ page: 1, sheet_type: 'plan', sections: [], instances: [
    { tag: 'B1', member_type: 'BEAM', box_2d: box(0.2, 0.2) },        // on its label
    { tag: 'F2', member_type: 'FOOTING', box_2d: box(0.45, 0.56) },   // drawn away from "F2"
    { tag: 'F0.5 0.1', member_type: 'FOOTING', box_2d: box(0.2, 0.2) },
    { tag: 'F1', member_type: 'FOOTING', box_2d: box(0.9, 0.91) },
    { tag: 'C1', member_type: 'COLUMN', box_2d: box(0.6, 0.6), box_src: 'shape' },  // a drawn square: no label needed
    { tag: 'B2', member_type: 'BEAM', box_2d: box(0.7, 0.7), box_src: 'guess' },
  ] }];
  const got = checkBoxes(readings as any, () => words).map(f => `${f.tag}:${f.problem}`);
  assert.deepEqual(got.sort(), ['F0.5 0.1:badTag', 'F0.5 0.1:unanchored', 'F1:titleBlock', 'F1:unanchored', 'F2:unanchored', 'B2:guess'].sort());
});
