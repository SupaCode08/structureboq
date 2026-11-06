/**
 * Calculation engine identity, computed from source wherever the engine runs (no generated file to go stale):
 * - Node (tests, npm and direct scripts, benchmark): src/engine/engineIdentity.ts calls currentEngineIdentity() on load.
 * - Vite dev and build: the engine-identity plugin (vite.config.ts) serves that module as a constant computed at
 *   serve / build time, recomputed when an engine source changes; a build also writes engine-identity.json.
 *
 * What is hashed: every file esbuild bundles from src/engine/qsEngine.ts (so a new import, package or local file,
 * joins automatically), each with comments, whitespace and types stripped and every `message:` property value
 * (flag text shown to people, never read by the calculation) blanked, plus this file's own code.
 * Reads no drawings.
 *   tsx scripts/gen_engine_identity.ts                print the identity and the files it covers
 *   tsx scripts/gen_engine_identity.ts --verify dist  check a build artifact against the current source
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync, transformSync } from 'esbuild';
import { parseAst } from 'rolldown/parseAst';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
export const ENGINE_ENTRY = 'src/engine/qsEngine.ts';
/** the module that carries the identity: excluded from what it identifies */
export const IDENTITY_MODULE = 'src/engine/engineIdentity.ts';
export const MANIFEST = 'engine-identity.json';

/** Files the calculation actually runs (relative to root, sorted): the engine entry and everything it imports. */
export function engineSources(root = ROOT, entry = ENGINE_ENTRY): string[] {
  const r = buildSync({
    entryPoints: [entry], absWorkingDir: root, bundle: true, write: false, metafile: true, platform: 'neutral', format: 'esm', logLevel: 'silent',
    external: ['*engineIdentity.ts'],
  });
  return Object.keys(r.metafile!.inputs).map(f => path.relative(root, path.resolve(root, f)).replace(/\\/g, '/')).sort();
}

/** Code as the calculation sees it: no comments, whitespace, types or flag message text. */
export function calculationCode(source: string, file = 'x.ts'): string {
  const js = transformSync(source, { loader: /\.[cm]?js$/.test(file) ? 'js' : 'ts', minifyWhitespace: true, legalComments: 'none' }).code;
  const cut: [number, number][] = [];
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === 'Property' && !n.computed && (n.key?.name === 'message' || n.key?.value === 'message') && (n.value?.type === 'Literal' && typeof n.value.value === 'string' || n.value?.type === 'TemplateLiteral')) {
      cut.push([n.value.start, n.value.end]);
      return;
    }
    for (const k in n) if (k !== 'parent' && typeof n[k] === 'object') walk(n[k]);
  };
  walk(parseAst(js));
  let out = js;
  for (const [a, b] of cut.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + '""' + out.slice(b);
  return out;
}

/** SHA-256 over each source's calculation code (by path) and the generator's own code. */
export function engineIdentityOf(sources: Record<string, string>, generator = fs.readFileSync(SELF, 'utf8')): string {
  const h = createHash('sha256');
  for (const name of Object.keys(sources).sort()) h.update(name + '\0' + calculationCode(sources[name], name) + '\0');
  h.update('generator\0' + calculationCode(generator));
  return h.digest('hex');
}

export function currentEngineIdentity(root = ROOT): { id: string; sources: string[] } {
  const sources = engineSources(root);
  return { id: engineIdentityOf(Object.fromEntries(sources.map(f => [f, fs.readFileSync(path.join(root, f), 'utf8')]))), sources };
}

/** Does a build in `dir` carry the identity of the current source (manifest and the constant inside the bundle)? */
export function verifyBuildIdentity(dir: string, root = ROOT): { ok: boolean; reason: string; built?: string; current: string } {
  const current = currentEngineIdentity(root).id;
  const mf = path.join(dir, MANIFEST);
  if (!fs.existsSync(mf)) return { ok: false, reason: `ไม่มี ${MANIFEST} ใน build`, current };
  const built = JSON.parse(fs.readFileSync(mf, 'utf8')).engineId as string;
  const js = fs.readdirSync(path.join(dir, 'assets')).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(path.join(dir, 'assets', f), 'utf8')).join('\n');
  if (!js.includes(built)) return { ok: false, reason: 'identity ใน manifest ไม่อยู่ใน bundle', built, current };
  if (built !== current) return { ok: false, reason: 'build สร้างจาก engine source ชุดอื่น (stale)', built, current };
  return { ok: true, reason: 'ตรงกับ source ปัจจุบัน', built, current };
}

export const OCR_IDENTITY_MODULE = 'src/pdf/ocrIdentity.ts';
const OCR_PACKAGES = ['tesseract.js', '@gutenye/ocr-models', 'onnxruntime-web', 'pdfjs-dist'];
/** What a cached page OCR depends on: every reading source in src/pdf (raw text: any edit invalidates, the safe side) and the PDF/OCR package versions. */
export function currentOcrIdentity(root = ROOT): string {
  const dir = path.join(root, 'src/pdf');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== path.basename(OCR_IDENTITY_MODULE)).sort();
  const h = createHash('sha256');
  for (const f of files) h.update(f + '\0' + fs.readFileSync(path.join(dir, f), 'utf8') + '\0');
  for (const p of OCR_PACKAGES) h.update(p + '@' + JSON.parse(fs.readFileSync(path.join(root, 'node_modules', p, 'package.json'), 'utf8')).version + '\0');
  return h.digest('hex');
}

/** Vite: serves the identity modules as constants computed now (dev: again whenever their sources change); a build also writes the manifest. */
export function engineIdentityPlugin(root = ROOT) {
  const posix = (f: string) => f.split(path.sep).join('/').split('\\').join('/');
  const target = posix(path.join(root, IDENTITY_MODULE));
  const ocrTarget = posix(path.join(root, OCR_IDENTITY_MODULE));
  let last = { id: 'UNVERIFIED', sources: [] as string[] };
  return {
    name: 'engine-identity',
    load(id: string) {
      const file = posix(id.split('?')[0]);
      if (file === ocrTarget) {
        let ocr = 'UNVERIFIED';
        try { ocr = currentOcrIdentity(root); } catch (e) { console.error('ocr identity unverified:', (e as Error).message); }
        return `export const OCR_ID = ${JSON.stringify(ocr)};`;
      }
      if (file !== target) return null;
      try { last = currentEngineIdentity(root); } catch (e) { last = { id: 'UNVERIFIED', sources: [] }; console.error('engine identity unverified:', (e as Error).message); }
      return `export const ENGINE_ID = ${JSON.stringify(last.id)};`;
    },
    handleHotUpdate(ctx: { file: string; server: any }) {
      const rel = posix(path.relative(root, ctx.file));
      const stale = [last.sources.includes(rel) && target, rel.startsWith('src/pdf/') && ocrTarget].filter(Boolean) as string[];
      if (!stale.length) return;
      for (const t of stale) { const mod = ctx.server.moduleGraph.getModuleById(t); if (mod) ctx.server.moduleGraph.invalidateModule(mod); }
      ctx.server.ws.send({ type: 'full-reload' });
      return [];
    },
    generateBundle(this: { emitFile(f: object): void }) {
      this.emitFile({ type: 'asset', fileName: MANIFEST, source: JSON.stringify({ engineId: last.id, sources: last.sources }, null, 2) });
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const i = process.argv.indexOf('--verify');
  if (i > 0) {
    const v = verifyBuildIdentity(path.resolve(process.argv[i + 1] || 'dist'));
    console.log(v.ok ? 'OK' : 'FAIL', v.reason, v.built ?? '', '→ current', v.current);
    process.exit(v.ok ? 0 : 1);
  }
  const c = currentEngineIdentity();
  console.log('ENGINE_ID', c.id, '\nsources', c.sources.join(', '));
}
