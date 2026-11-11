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
      return { y: { data: new Float32Array(t.dims[0] * t.dims[2] * t.dims[3]) } };
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

test('batched rec runs once for identical boxes on distant tiles', async () => {
  let recRuns = 0;
  const fakeModel: any = {
    ort: fake.ort,
    det: {
      inputNames: ['x'],
      outputNames: ['y'],
      run: async (feeds: any) => {
        const t = feeds.x, [n, , H, W] = t.dims;
        const data = new Float32Array(n * H * W);
        for (let j = 0; j < n; j++) {
          const inBase = j * 3 * H * W, outBase = j * H * W;
          for (let k = 0; k < H * W; k++) if (t.data[inBase + k] < 0) data[outBase + k] = 1.0;
        }
        return { y: { data } };
      },
    },
    rec: {
      inputNames: ['x'],
      outputNames: ['y'],
      run: async (feeds: any) => {
        recRuns++;
        const n = feeds.x.dims[0];
        const data = new Float32Array(n * 2 * 3);
        for (let r = 0; r < n * 2; r++) data[r * 3 + 1] = 1.0;
        return { y: { dims: [n, 2, 3], data } };
      },
    },
    dict: ['', 'A', ' '],
  };
  const raster: Raster = { data: new Uint8Array(2000 * 1000).fill(255), width: 2000, height: 1000 };
  for (let y = 100; y < 112; y++) for (let x = 100; x < 120; x++) raster.data[y * 2000 + x] = 0;
  for (let y = 100; y < 112; y++) for (let x = 1500; x < 1520; x++) raster.data[y * 2000 + x] = 0;
  const stats = newPaddleStats();
  await paddleWords(fakeModel, raster, stats, 'flat');
  assert.equal(recRuns, 1);
  assert.equal(stats.recCalls, 2);
});
