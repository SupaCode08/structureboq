import test from 'node:test';
import assert from 'node:assert/strict';
import { tagInsideDrawing } from './sheetReader.ts';

test('tagInsideDrawing detects references boxed inside drawings vs detail titles', () => {
  const word = { text: 'GS', conf: 97, x0: 0.2816, y0: 0.8304, x1: 0.2897, y1: 0.8375, vertical: false };
  const ring = [[0.286, 0.834, 0.011]];

  // real case: boxed between lines above and below
  assert.equal(tagInsideDrawing({ circles: ring, hsegs: [[0.245, 0.826, 0.304], [0.269, 0.843, 0.304]] } as any, word), true);

  // same lines but no circle (a schedule cell) -> false
  assert.equal(tagInsideDrawing({ hsegs: [[0.245, 0.826, 0.304], [0.269, 0.843, 0.304]] } as any, word), false);

  // only the lower one (an underline) -> false
  assert.equal(tagInsideDrawing({ circles: ring, hsegs: [[0.269, 0.843, 0.304]] } as any, word), false);

  // one hseg through the middle -> false
  assert.equal(tagInsideDrawing({ circles: ring, hsegs: [[0.25, 0.834, 0.31]] } as any, word), false);

  // no segments, hsegs/vsegs undefined -> false
  assert.equal(tagInsideDrawing({} as any, word), false);

  // lines above and below but far away (y 0.80 and 0.87) -> false
  assert.equal(tagInsideDrawing({ hsegs: [[0.245, 0.80, 0.304], [0.269, 0.87, 0.304]] } as any, word), false);

  // vsegs left and right -> true
  assert.equal(tagInsideDrawing({ circles: ring, vsegs: [[0.278, 0.82, 0.85], [0.293, 0.82, 0.85]] } as any, word), true);
});
