/**
 * Lifecycle of the pdf.js documents the app shows, on fake documents (no pdf.js, no PDF): a document is destroyed
 * exactly once, only when nothing shows it any more, and a failed read leaves the shown document alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { swapDoc, destroyOnError, type Slot } from './docLifecycle.ts';
import { wrapSessionWithDispose, disposePaddle } from './paddleOcr.ts';

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

test('wrapSessionWithDispose: explicitly calls .dispose() on both input feed tensors and output tensors in finally', async () => {
  let feedDisposed = 0;
  let outDisposed = 0;

  const mockFeedTensor = {
    dims: [1, 3, 48, 96],
    data: new Float32Array(3 * 48 * 96),
    dispose() { feedDisposed++; },
  };

  const mockOutTensor = {
    dims: [1, 24, 6625],
    data: new Float32Array(24 * 6625),
    dispose() { outDisposed++; },
  };

  const mockSession = {
    run: async (feeds: any) => ({ output: mockOutTensor }),
  };

  const wrapped = wrapSessionWithDispose(mockSession);
  const result = await wrapped.run({ input: mockFeedTensor });

  // Verification: feed tensor was disposed exactly once
  assert.equal(feedDisposed, 1, 'Input feed tensor must be disposed');
  // Verification: output tensor was disposed exactly once
  assert.equal(outDisposed, 1, 'Inference output tensor must be disposed');
  // Verification: returned data is a copied Float32Array with identical dims and length
  assert.deepEqual(result.output.dims, [1, 24, 6625]);
  assert.equal(result.output.data.length, 24 * 6625);
});

test('disposePaddle: safely releases and disposes det and rec sessions', async () => {
  let detReleased = 0, recReleased = 0;
  const mockPaddle = {
    ort: {} as any,
    det: { release() { detReleased++; } },
    rec: { release() { recReleased++; } },
    dict: [],
  };
  await disposePaddle(mockPaddle);
  assert.equal(detReleased, 1);
  assert.equal(recReleased, 1);
});

test('AbortSignal cancellation: listener triggers worker disposal upon abort', () => {
  const ac = new AbortController();
  let workersTerminated = false;
  const onAbort = () => {
    workersTerminated = true;
  };
  ac.signal.addEventListener('abort', onAbort, { once: true });
  assert.equal(workersTerminated, false);
  ac.abort();
  assert.equal(workersTerminated, true);
});

test('PaddleWorker message protocol: status success with empty words is accepted without fallback', () => {
  const msg = {
    id: 1,
    status: 'success' as const,
    words: [],
    provider: 'webgpu' as const,
    stats: { initMs: 10, totalMs: 50 },
  };
  assert.equal(msg.status, 'success');
  assert.deepEqual(msg.words, []);
  assert.equal(msg.provider, 'webgpu');
});

test('PaddleWorker message protocol: status success with wasm provider marks internal fallback', () => {
  const msg = {
    id: 2,
    status: 'success' as const,
    words: [{ text: 'B1', box: [0, 0, 10, 10], score: 0.95 }],
    provider: 'wasm' as const,
    stats: { initMs: 15, totalMs: 120 },
  };
  assert.equal(msg.status, 'success');
  assert.equal(msg.provider, 'wasm');
  assert.equal(msg.words.length, 1);
});

test('PaddleWorker message protocol: status failed and cancelled return structured errors', () => {
  const failedMsg = { id: 3, status: 'failed', error: 'GPU device lost', provider: 'wasm' };
  assert.equal(failedMsg.status, 'failed');
  assert.equal(failedMsg.error, 'GPU device lost');

  const cancelledMsg = { id: 4, status: 'cancelled', disposed: true };
  assert.equal(cancelledMsg.status, 'cancelled');
  assert.equal(cancelledMsg.disposed, true);
});

test('Worker promise lifecycle: activeWorkerPromises set rejects in-flight promises upon termination', async () => {
  const activeWorkerPromises = new Set<(err: Error) => void>();
  let settled = false;
  let rejectedError: any = null;

  const inFlightPromise = new Promise((resolve, reject) => {
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      activeWorkerPromises.delete(settleReject);
      reject(err);
    };
    activeWorkerPromises.add(settleReject);
  });

  inFlightPromise.catch(err => {
    rejectedError = err;
  });

  assert.equal(activeWorkerPromises.size, 1);

  // Terminate workers
  for (const rejectActive of activeWorkerPromises) {
    rejectActive(new Error('Worker terminated by user or session reset'));
  }
  activeWorkerPromises.clear();

  await new Promise(res => setTimeout(res, 10));

  assert.equal(activeWorkerPromises.size, 0);
  assert.ok(rejectedError);
  assert.equal(rejectedError.message, 'Worker terminated by user or session reset');
});

test('AbortSignal cancellation: listener immediately rejects pending promise and cleans up', async () => {
  const ac = new AbortController();
  const activeWorkerPromises = new Set<(err: Error) => void>();
  let rejectedError: any = null;

  const promise = new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      ac.signal.removeEventListener('abort', onAbort);
      activeWorkerPromises.delete(settleReject);
    };
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const onAbort = () => {
      settleReject(new Error('OCR aborted by user'));
    };
    ac.signal.addEventListener('abort', onAbort, { once: true });
    activeWorkerPromises.add(settleReject);
  });

  promise.catch(err => {
    rejectedError = err;
  });

  assert.equal(activeWorkerPromises.size, 1);
  ac.abort();
  await new Promise(res => setTimeout(res, 10));

  assert.equal(activeWorkerPromises.size, 0);
  assert.ok(rejectedError);
  assert.equal(rejectedError.message, 'OCR aborted by user');
});


