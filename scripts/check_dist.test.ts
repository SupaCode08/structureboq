import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDist } from './check_dist.ts';

const tmpDirs: string[] = [];
after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const stubVerify = () => ({ ok: true, reason: '', current: '' });

function createFakeDist(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'structboq-dist-'));
  tmpDirs.push(dir);
  const put = (rel: string, content: string | Buffer = 'data') => {
    const fp = path.join(dir, rel);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  };

  put('index.html', '<!doctype html>');
  put('tesseract/worker.min.js', 'worker');
  put('tesseract/core/tesseract-core-simd-lstm.wasm.js', 'simd');
  put('tesseract/core/tesseract-core-lstm.wasm.js', 'lstm');
  put('tesseract/lang/eng.traineddata.gz', 'eng');
  put('tesseract/lang/tha.traineddata.gz', 'tha');

  put('assets/ch_PP-OCRv4_det_infer-abc12345.onnx', 'det');
  put('assets/ch_PP-OCRv4_rec_infer-abc12345.onnx', 'rec');
  put('assets/ppocr_keys_v1-abc12345.txt', 'keys');
  put('assets/ort-wasm-simd-threaded.wasm', 'wasm');

  return dir;
}

test('complete fake dist is ok with no problems', () => {
  const dir = createFakeDist();
  const res = checkDist(dir, stubVerify);
  assert.equal(res.ok, true);
  assert.deepEqual(res.problems, []);
});

test('missing tha.traineddata.gz is reported by name', () => {
  const dir = createFakeDist();
  fs.unlinkSync(path.join(dir, 'tesseract/lang/tha.traineddata.gz'));
  const res = checkDist(dir, stubVerify);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some(p => p.includes('tha.traineddata.gz')));
});

test('an empty worker.min.js is reported', () => {
  const dir = createFakeDist();
  fs.writeFileSync(path.join(dir, 'tesseract/worker.min.js'), '');
  const res = checkDist(dir, stubVerify);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some(p => p.includes('worker.min.js')));
});

test('a missing assets onnx is reported', () => {
  const dir = createFakeDist();
  fs.unlinkSync(path.join(dir, 'assets/ch_PP-OCRv4_det_infer-abc12345.onnx'));
  const res = checkDist(dir, stubVerify);
  assert.equal(res.ok, false);
  assert.ok(res.problems.some(p => p.includes('ch_PP-OCRv4_det_infer')));
});

test('a failing stub identity is reported', () => {
  const dir = createFakeDist();
  const failingVerify = () => ({ ok: false, reason: 'stale build identity', current: 'new-id' });
  const res = checkDist(dir, failingVerify);
  assert.equal(res.ok, false);
  assert.ok(res.problems.includes('stale build identity'));
});

test('sizesMB.datasets counts only dist/datasets', () => {
  const dir = createFakeDist();
  fs.writeFileSync(path.join(dir, 'extra.bin'), Buffer.alloc(1024 * 1024));
  const datasetFile = path.join(dir, 'datasets', 'sample.bin');
  fs.mkdirSync(path.dirname(datasetFile), { recursive: true });
  fs.writeFileSync(datasetFile, Buffer.alloc(2 * 1024 * 1024));

  const res = checkDist(dir, stubVerify);
  assert.equal(res.sizesMB.datasets, 2.0);
  assert.ok(res.sizesMB.total >= 3.0);
});

test('unreadable path from dangling symlink is reported as a problem', (t) => {
  const dir = createFakeDist();
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub, { recursive: true });
  const linkPath = path.join(sub, 'dangling.link');
  try {
    fs.symlinkSync(path.join(dir, 'missing'), linkPath);
  } catch {
    t.skip('symlink creation not permitted');
    return;
  }
  const res = checkDist(dir, stubVerify);
  assert.equal(res.ok, false);
  assert.ok(res.problems.includes('cannot read: sub/dangling.link'));
});
