/** PaddleOCR off the page's main thread: { id, raster, urls, pass, preferGpu } in, { id, words | error, stats, provider } out. */
import * as ort from 'onnxruntime-web';
import { loadPaddle, paddleWords, paddleWordsFromBoxes, newPaddleStats, disposePaddle, type Paddle } from './paddleOcr';

ort.env.wasm.numThreads = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

interface EngineInstance {
  paddle: Paddle;
  provider: 'webgpu' | 'wasm';
}

let engine: Promise<EngineInstance> | null = null;
let thaiEngine: Promise<EngineInstance> | null = null;
let currentPaddle: Paddle | null = null;
let currentThai: Paddle | null = null;
let loads = 0; // timing only: how many times this worker loaded the models (more than 1 = reload after an error)
const bytes = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());

async function createEngine(urls: { det: string; rec: string; dict: string }, preferGpu = true, recOnly = false): Promise<EngineInstance> {
  loads++;
  const dictText = await (await fetch(urls.dict)).text();
  const [detBytes, recBytes] = await Promise.all([recOnly || !urls.det ? Promise.resolve('' as any) : bytes(urls.det), bytes(urls.rec)]);

  // Attempt WebGPU first if supported and requested (skip WebGPU shader compile for tiny rec-only models)
  if (preferGpu && !recOnly) {
    const nav = self.navigator as any;
    if (nav?.gpu) {
      try {
        const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          const paddle = await loadPaddle(ort, detBytes, recBytes, dictText, { executionProviders: ['webgpu'] });
          if (recOnly) currentThai = paddle; else currentPaddle = paddle;
          return { paddle, provider: 'webgpu' };
        }
      } catch (gpuErr) {
        console.warn('[PaddleWorker] WebGPU unavailable or failed to initialize, falling back to WASM:', gpuErr);
      }
    }
  }

  // Fallback: WASM execution provider
  const paddle = await loadPaddle(ort, detBytes, recBytes, dictText, { executionProviders: ['wasm'] });
  if (recOnly) currentThai = paddle; else currentPaddle = paddle;
  return { paddle, provider: 'wasm' };
}

self.onmessage = async (e: MessageEvent) => {
  const { id, raster, jobs, urls, pass = 'both', preferGpu = true, command, mode = 'paddle' } = e.data || {};

  if (!id) return;

  if (command === 'dispose') {
    if (currentPaddle) {
      try { await disposePaddle(currentPaddle); } catch {}
      currentPaddle = null;
    }
    if (currentThai) {
      try { await disposePaddle(currentThai); } catch {}
      currentThai = null;
    }
    engine = null;
    thaiEngine = null;
    self.postMessage({ id, status: 'cancelled', disposed: true });
    return;
  }

  try {
    const t0 = performance.now();
    const isThai = mode === 'thai';
    const engRef = isThai ? (thaiEngine ??= createEngine(urls, preferGpu, true)) : (engine ??= createEngine(urls, preferGpu, false));
    const { paddle: p, provider } = await engRef;
    const initMs = performance.now() - t0;
    const t1 = performance.now();
    const stats = newPaddleStats();
    if (Array.isArray(jobs)) {
      const { words, lines } = await paddleWordsFromBoxes(p, raster, jobs, stats, isThai ? Infinity : 14);
      self.postMessage({
        id,
        status: 'success',
        words: words || [],
        lines: lines || [],
        provider,
        stats: { ...stats, initMs, loads, totalMs: performance.now() - t1 }
      });
    } else {
      const words = await paddleWords(p, raster, stats, pass);
      self.postMessage({
        id,
        status: 'success',
        words: words || [],
        provider,
        stats: { ...stats, initMs, loads, totalMs: performance.now() - t1 }
      });
    }
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
