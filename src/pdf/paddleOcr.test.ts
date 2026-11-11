import test from 'node:test';
import assert from 'node:assert/strict';
import { paddleWords, newPaddleStats } from './paddleOcr.ts';
import type { Raster } from './ocr.ts';

let calls = 0;
const fake: any = {
  ort: {
    Tensor: class {
      constructor(public type: string, public data: Float32Array, public dims: number[]) {}
    },
  },
  det: {
    inputNames: ['x'],
    outputNames: ['y'],
    run: async (feeds: any) => {
      calls++;
      const t = feeds.x;
      return { y: { data: new Float32Array(t.dims[2] * t.dims[3]) } };
    },
  },
  rec: {
    inputNames: ['x'],
    outputNames: ['y'],
    run: async () => {
      throw new Error('rec should not run');
    },
  },
  dict: [''],
};

test('all 255 raster skips det and returns empty', async () => {
  calls = 0;
  const raster: Raster = { data: new Uint8Array(2000 * 1000).fill(255), width: 2000, height: 1000 };
  const stats = newPaddleStats();
  const words = await paddleWords(fake, raster, stats, 'flat');
  assert.deepEqual(words, []);
  assert.equal(calls, 0);
  assert.equal(stats.detTiles, 0);
});

test('same raster with one 0 pixel at x=100,y=100 runs det on 1 tile', async () => {
  calls = 0;
  const data = new Uint8Array(2000 * 1000).fill(255);
  data[100 * 2000 + 100] = 0;
  const raster: Raster = { data, width: 2000, height: 1000 };
  const stats = newPaddleStats();
  await paddleWords(fake, raster, stats, 'flat');
  assert.equal(calls, 1);
  assert.equal(stats.detTiles, 1);
});
