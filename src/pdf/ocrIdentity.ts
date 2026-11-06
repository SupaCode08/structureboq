/**
 * Identity of the page-reading code a cached OCR result came from. In the browser the engine-identity Vite plugin
 * replaces this module with the value computed at serve / build time; in Node it is computed from source. Anything
 * that fails leaves 'UNVERIFIED', and the cache is not used then.
 */
let id = 'UNVERIFIED';
try {
  id = (await import('../../scripts/gen_engine_identity.ts')).currentOcrIdentity();
} catch (e) {
  console.error('ocr identity unverified:', (e as Error).message);
}
export const OCR_ID = id;
