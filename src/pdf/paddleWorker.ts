/** PaddleOCR off the page's main thread: { id, raster, urls, pass, preferGpu } in, { id, words | error, stats, provider } out. */
import * as ort from 'onnxruntime-web';
import { loadPaddle, paddleWords, newPaddleStats, disposePaddle, type Paddle } from './paddleOcr';

ort.env.wasm.numThreads = 1;

interface EngineInstance {
  paddle: Paddle;
  provider: 'webgpu' | 'wasm';
}

let engine: Promise<EngineInstance> | null = null;
let currentPaddle: Paddle | null = null;
let loads = 0; // timing only: how many times this worker loaded the models (more than 1 = reload after an error)
const bytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());

async function createEngine(urls: { det: string; rec: string; dict: string }, preferGpu = true): Promise<EngineInstance> {
  loads++;
  const dictText = await (await fetch(urls.dict)).text();
  const [detBytes, recBytes] = await Promise.all([bytes(urls.det), bytes(urls.rec)]);

  // Attempt WebGPU first if supported and requested
  if (preferGpu) {
    const nav = self.navigator as any;
    if (nav?.gpu) {
      try {
        const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          const paddle = await loadPaddle(ort, detBytes, recBytes, dictText, { executionProviders: ['webgpu'] });
          currentPaddle = paddle;
          return { paddle, provider: 'webgpu' };
        }
      } catch (gpuErr) {
        console.warn('[PaddleWorker] WebGPU unavailable or failed to initialize, falling back to WASM:', gpuErr);
      }
    }
  }

  // Fallback: WASM execution provider
  const paddle = await loadPaddle(ort, detBytes, recBytes, dictText, { executionProviders: ['wasm'] });
  currentPaddle = paddle;
  return { paddle, provider: 'wasm' };
}

self.onmessage = async (e: MessageEvent) => {
  const { id, raster, urls, pass = 'both', preferGpu = true, command } = e.data || {};

  if (!id) return;

  if (command === 'dispose') {
    if (currentPaddle) {
      try { await disposePaddle(currentPaddle); } catch {}
      currentPaddle = null;
    }
    engine = null;
    self.postMessage({ id, status: 'cancelled', disposed: true });
    return;
  }

  try {
    const t0 = performance.now();
    engine ??= createEngine(urls, preferGpu);
    const { paddle: p, provider } = await engine;
    const initMs = performance.now() - t0;
    const t1 = performance.now();
    const stats = newPaddleStats();
    const words = await paddleWords(p, raster, stats, pass);
    self.postMessage({
      id,
      status: 'success',
      words: words || [],
      provider,
      stats: { ...stats, initMs, loads, totalMs: performance.now() - t1 }
    });
  } catch (err) {
    if (currentPaddle) {
      try { await disposePaddle(currentPaddle); } catch {}
      currentPaddle = null;
    }
    engine = null;
    self.postMessage({
      id,
      status: 'failed',
      error: String(err),
      provider: 'wasm'
    });
  }
};
