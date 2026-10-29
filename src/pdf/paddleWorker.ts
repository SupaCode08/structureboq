/** PaddleOCR off the page's main thread: { id, raster, urls } in, { id, words | error } out. */
import * as ort from 'onnxruntime-web';
import { loadPaddle, paddleWords, newPaddleStats, type Paddle } from './paddleOcr';

ort.env.wasm.numThreads = 1;
let engine: Promise<Paddle> | null = null;
let loads = 0; // timing only: how many times this worker loaded the models (more than 1 = reload after an error)
const bytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());

self.onmessage = async (e: MessageEvent) => {
  const { id, raster, urls } = e.data;
  try {
    const t0 = performance.now();
    if (!engine) loads++;
    engine ??= (async () => loadPaddle(ort, await bytes(urls.det), await bytes(urls.rec), await (await fetch(urls.dict)).text()))();
    const p = await engine;
    const initMs = performance.now() - t0, t1 = performance.now(), stats = newPaddleStats();
    const words = await paddleWords(p, raster, stats);
    self.postMessage({ id, words, stats: { ...stats, initMs, loads, totalMs: performance.now() - t1 } });
  } catch (err) {
    engine = null;
    self.postMessage({ id, error: String(err) });
  }
};
