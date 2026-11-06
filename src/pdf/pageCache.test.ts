/** Round 24 Phase 1: page OCR cache keys, storage, failure handling; Phase 0: timing summary. No drawings. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cachedRead, cacheWrite, memoryStore, pageCacheKey, type CachedOcr, type PageCacheStore } from './pageCache.ts';
import { timingSummary } from './pdfText.ts';
import { OCR_ID } from './ocrIdentity.ts';
import { currentOcrIdentity } from '../../scripts/gen_engine_identity.ts';

const A = 'a'.repeat(64), B = 'b'.repeat(64), ID = 'c'.repeat(64);
const page = (n: number): CachedOcr => ({ page: n, width: 842, height: 595, words: [{ text: 'F2', x0: 1, y0: 2, x1: 3, y1: 4, vertical: false, conf: 90 }], kind: 'vector_text', smallStrokes: 260 } as CachedOcr);

test('a cache key exists only for a known file hash and code identity, and differs by file, page and code', () => {
  assert.equal(pageCacheKey(A, 2, ID), `${A}:2:${ID}`);
  for (const k of [pageCacheKey(B, 2, ID), pageCacheKey(A, 3, ID), pageCacheKey(A, 2, 'd'.repeat(64))]) assert.notEqual(k, pageCacheKey(A, 2, ID));
  assert.equal(pageCacheKey(null, 2, ID), null);           // no hash (crypto refused): no cache
  assert.equal(pageCacheKey('nohash:x.pdf:1:2', 2, ID), null);
  assert.equal(pageCacheKey(A, 2, 'UNVERIFIED'), null);     // reading code unknown: no cache
  assert.equal(pageCacheKey(A, 0, ID), null);
});

test('a stored page comes back as stored, unaffected by later edits; a broken store is a miss, never an error', async () => {
  const s = memoryStore();
  const k = pageCacheKey(A, 2, ID);
  const r = page(2);
  await cacheWrite(s, k, r);
  r.words.push({ text: 'added later', x0: 0, y0: 0, x1: 1, y1: 1, vertical: false, conf: 99 }); // as the pipeline adds text-layer words after writing
  assert.deepEqual(await cachedRead(s, k), page(2));
  assert.equal(await cachedRead(s, pageCacheKey(B, 2, ID)), undefined);
  assert.equal(await cachedRead(null, k), undefined);
  const broken: PageCacheStore = { get: async () => { throw new Error('blocked'); }, put: async () => { throw new Error('quota'); } };
  assert.equal(await cachedRead(broken, k), undefined);
  await cacheWrite(broken, k, page(2)); // does not throw
  await cacheWrite(s, null, page(9));
  assert.equal(s.map.size, 1);
});

test('the OCR identity covers the reading sources and the OCR/PDF package versions', () => {
  assert.match(OCR_ID, /^[0-9a-f]{64}$/);
  assert.equal(OCR_ID, currentOcrIdentity());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'structboq-ocrid-'));
  after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (f: string, t: string) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  put('src/pdf/reader.ts', 'export const x = 1;');
  put('src/pdf/reader.test.ts', 'test');
  for (const p of ['tesseract.js', '@gutenye/ocr-models', 'onnxruntime-web', 'pdfjs-dist']) put(`node_modules/${p}/package.json`, '{"version":"1.0.0"}');
  const base = currentOcrIdentity(root);
  put('src/pdf/reader.test.ts', 'other test');
  assert.equal(currentOcrIdentity(root), base, 'tests do not change it');
  put('src/pdf/reader.ts', 'export const x = 2;');
  const code = currentOcrIdentity(root);
  assert.notEqual(code, base);
  put('node_modules/tesseract.js/package.json', '{"version":"1.0.1"}');
  assert.notEqual(currentOcrIdentity(root), code);
});

test('timing summary: OCR median and p90, cached pages, heap only when reported', () => {
  const t = timingSummary({ total: 30123.4, 'OCR pages': 25000.2 }, [
    { page: 1, how: 'OCR vector_text', ms: 9000 }, { page: 2, how: 'OCR raster', ms: 11000 }, { page: 3, how: 'OCR raster', ms: 20000 },
    { page: 4, how: 'cache vector_text', ms: 5 }, { page: 5, how: 'skipped (A-01)', ms: 80 },
  ], 256 * 1048576);
  assert.deepEqual([t.totalMs, t.ocrPages, t.cachedPages, t.medianOcrMs, t.p90OcrMs, t.peakHeapMB], [30123, 3, 1, 11000, 20000, 256]);
  assert.deepEqual(timingSummary({ total: 10 }, [], null), { totalMs: 10, phases: { total: 10 }, perPage: [], ocrPages: 0, cachedPages: 0, medianOcrMs: null, p90OcrMs: null, peakHeapMB: null });
});
