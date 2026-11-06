/**
 * Identity of the calculation engine this process runs. In Node (tests, scripts, benchmark) it is computed from
 * the current source when the engine loads, so a stale value cannot exist; in the browser the engine-identity
 * Vite plugin replaces this module with the value computed at serve / build time. Anything that fails leaves
 * 'UNVERIFIED', which holds every approval (fail closed).
 */
let id = 'UNVERIFIED';
try {
  id = (await import('../../scripts/gen_engine_identity.ts')).currentEngineIdentity().id;
} catch (e) {
  console.error('engine identity unverified:', (e as Error).message);
}
export const ENGINE_ID = id;
