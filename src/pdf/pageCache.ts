/**
 * Cache of one page's OCR result, so opening the same file again does not OCR it again. The key is the file's
 * SHA-256, the original page number and the identity of the reading code (src/pdf + OCR/PDF package versions):
 * other bytes, another page or changed code never hit. Any storage problem is a miss — the page is read again.
 */
import type { PageOcr } from './types';

export type CachedOcr = PageOcr & { kind: string; smallStrokes: number };
export interface PageCacheStore {
  get(key: string): Promise<CachedOcr | undefined>;
  put(key: string, value: CachedOcr): Promise<void>;
}

const HEX64 = /^[0-9a-f]{64}$/;
/** null when the file or the code identity is unknown: then nothing is read from or written to the cache */
export const pageCacheKey = (fileSha: string | null | undefined, page: number, ocrId: string) =>
  fileSha && HEX64.test(fileSha) && HEX64.test(ocrId) && Number.isInteger(page) && page >= 1 ? `${fileSha}:${page}:${ocrId}` : null;

export async function cachedRead(store: PageCacheStore | null, key: string | null): Promise<CachedOcr | undefined> {
  if (!store || !key) return undefined;
  try { return await store.get(key); } catch { return undefined; }
}
export async function cacheWrite(store: PageCacheStore | null, key: string | null, value: CachedOcr): Promise<void> {
  if (!store || !key) return;
  try { await store.put(key, value); } catch { /* storage full or blocked: the next open reads the page again */ }
}

export const memoryStore = (): PageCacheStore & { map: Map<string, CachedOcr> } => {
  const map = new Map<string, CachedOcr>();
  return { map, get: async k => (map.has(k) ? structuredClone(map.get(k)) : undefined), put: async (k, v) => { map.set(k, structuredClone(v)); } };
};

/** IndexedDB store of this browser (null where IndexedDB is unavailable) */
export function indexedDbStore(dbName = 'structboq-page-ocr', storeName = 'pages'): PageCacheStore | null {
  if (typeof indexedDB === 'undefined') return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => (db ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(storeName);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = <T,>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest) => open().then(d => new Promise<T>((res, rej) => {
    const req = op(d.transaction(storeName, mode).objectStore(storeName));
    req.onsuccess = () => res(req.result as T);
    req.onerror = () => rej(req.error);
  }));
  return {
    get: key => run<CachedOcr | undefined>('readonly', s => s.get(key)),
    put: (key, value) => run<void>('readwrite', s => s.put(value, key)).then(() => undefined),
  };
}
