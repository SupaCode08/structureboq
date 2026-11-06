/**
 * Round 20.2: the engine identity holds on every path that can calculate quantities. Real processes, not mocks:
 * direct scripts are spawned against a temporary copy of the engine, Vite dev transforms the identity module,
 * and a production build is made and checked. Reads no drawings.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { approvalFor, calculateMember, DEFAULT_MATERIAL_SPECS, engineIdentity, REQUIRED_SPECS, type ExtractedMember } from './qsEngine.ts';
import { currentEngineIdentity, engineIdentityOf, engineIdentityPlugin, engineSources, verifyBuildIdentity, MANIFEST } from '../../scripts/gen_engine_identity.ts';

const REPO = process.cwd();
const ENGINE = fs.readFileSync('src/engine/qsEngine.ts', 'utf8');
const TSX = path.join(REPO, 'node_modules/tsx/dist/cli.mjs');

const made: string[] = [];
// the junction is removed as a link first, so deleting the project never reaches the real node_modules
after(() => {
  for (const root of made) {
    const link = path.join(root, 'node_modules');
    if (fs.existsSync(link)) try { fs.unlinkSync(link); } catch { try { fs.rmdirSync(link); } catch { continue; } }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** a throwaway project: the engine, its identity module and the generator, sharing this repo's node_modules */
function tempProject(opts: { generator?: boolean; engine?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'structboq-engine-'));
  made.push(root);
  const put = (f: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
  put('src/engine/qsEngine.ts', opts.engine ?? ENGINE);
  put('src/engine/engineIdentity.ts', fs.readFileSync('src/engine/engineIdentity.ts', 'utf8'));
  if (opts.generator !== false) put('scripts/gen_engine_identity.ts', fs.readFileSync('scripts/gen_engine_identity.ts', 'utf8'));
  put('package.json', '{"type":"module"}');
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  return { root, put, read: (f: string) => fs.readFileSync(path.join(root, f), 'utf8') };
}
/** a direct script, as someone would run it: tsx probe.ts — approves a footing and/or recalculates a saved approval */
const PROBE = `
import fs from 'node:fs';
import { approvalFor, calculateMember, DEFAULT_MATERIAL_SPECS, engineIdentity, REQUIRED_SPECS } from './src/engine/qsEngine.ts';
const specs = { ...DEFAULT_MATERIAL_SPECS, coverSources: { footing: 'drawing_notes' }, valueSources: Object.fromEntries(REQUIRED_SPECS.map(r => [r.key, { source: 'user' }])) };
const f = { tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 1.2, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5, bottomRebar: '6-DB12+6-DB12', footingHookShape: 'STRAIGHT',
  provenance: { evidence: [{ page: 1, label: 'd', method: 'pdf_text' }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', rebar: 'drawing' }, confidence: 0.95 } };
const saved = fs.existsSync('approved.json') ? JSON.parse(fs.readFileSync('approved.json', 'utf8')) : { ...f, review: approvalFor(f, undefined, specs) };
if (!fs.existsSync('approved.json')) fs.writeFileSync('approved.json', JSON.stringify(saved));
const r = calculateMember(saved, 1, specs);
console.log(JSON.stringify({ id: engineIdentity.id, status: r.status, state: r.approvalState ?? null, flags: r.flags.map(x => x.code), stale: r.staleChanges ?? [] }));
`;
function probe(root: string) {
  fs.writeFileSync(path.join(root, 'probe.ts'), PROBE);
  const p = spawnSync(process.execPath, [TSX, 'probe.ts'], { cwd: root, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout.trim().split('\n').pop()!);
}

test('1. a calculation logic change changes the identity', () => {
  const base = engineIdentityOf({ 'src/engine/qsEngine.ts': ENGINE });
  assert.notEqual(engineIdentityOf({ 'src/engine/qsEngine.ts': ENGINE.replace('(wM + 0.20)', '(wM + 0.25)') }), base);
  assert.notEqual(engineIdentityOf({ 'src/engine/qsEngine.ts': ENGINE.replace("rules.footingHookShape || 'FULL_UPTURN'", "rules.footingHookShape || 'STRAIGHT'") }), base);
});

test('2 and 10. a new dependency joins the identity, and changing it changes the identity', () => {
  const t = tempProject({ engine: ENGINE.replace("import { ENGINE_ID } from './engineIdentity.ts';", "import { ENGINE_ID } from './engineIdentity.ts';\nimport { LEAN_EXTRA } from './rates.ts';\nexport const leanExtra = LEAN_EXTRA;") });
  t.put('src/engine/rates.ts', 'export const LEAN_EXTRA = 0.20;\n');
  assert.deepEqual(engineSources(t.root), ['src/engine/qsEngine.ts', 'src/engine/rates.ts']);
  assert.deepEqual(engineSources(), ['src/engine/qsEngine.ts']); // the real engine today: nothing else, and no UI
  const before = currentEngineIdentity(t.root).id;
  t.put('src/engine/rates.ts', 'export const LEAN_EXTRA = 0.25;\n');
  assert.notEqual(currentEngineIdentity(t.root).id, before);
});

test('3. presentation-only changes (flag text, comments, UI files) keep the identity', () => {
  const base = engineIdentityOf({ 'src/engine/qsEngine.ts': ENGINE });
  assert.ok(ENGINE.includes("message: 'ไม่พบรายละเอียดเหล็กเสริม — ใช้ค่ามาตรฐาน'"));
  assert.equal(engineIdentityOf({ 'src/engine/qsEngine.ts': ENGINE.replace("message: 'ไม่พบรายละเอียดเหล็กเสริม — ใช้ค่ามาตรฐาน'", "message: 'ข้อความใหม่'") }), base);
  assert.equal(engineIdentityOf({ 'src/engine/qsEngine.ts': ENGINE.replace('ความลึกขุดดินเป็นค่าสมมติ', 'ความลึกขุดดินที่สมมติ') }), base);
  // a flag code is read by the gate: changing it is not presentation
  assert.notEqual(engineIdentityOf({ 'src/engine/qsEngine.ts': ENGINE.replace("code: 'REBAR_DEFAULTED'", "code: 'REBAR_DEFAULT'") }), base);
  assert.ok(!currentEngineIdentity().sources.some(f => f.includes('components') || f.includes('App')));
});

test('4. a stale identity cannot exist in source, and a stale build artifact is detected', () => {
  assert.ok(!fs.existsSync('src/engine/engineIdentity.gen.ts'), 'no generated identity file to go stale');
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'structboq-dist-'));
  made.push(dist);
  fs.mkdirSync(path.join(dist, 'assets'));
  const old = 'a'.repeat(64);
  fs.writeFileSync(path.join(dist, MANIFEST), JSON.stringify({ engineId: old }));
  fs.writeFileSync(path.join(dist, 'assets/index.js'), `const ENGINE_ID="${old}";`);
  const v = verifyBuildIdentity(dist);
  assert.equal(v.ok, false);
  assert.match(v.reason, /stale/);
});

test('5 and 6. a direct script runs with its current source identity; without the generator it fails closed', () => {
  const t = tempProject();
  const a = probe(t.root);
  assert.equal(a.id, currentEngineIdentity(t.root).id);
  assert.equal(a.state, 'APPROVED');
  // edit a constant the calculation uses: the next direct run sees a new identity, not an old one
  t.put('src/engine/qsEngine.ts', ENGINE.replace('(wM + 0.20)', '(wM + 0.30)'));
  const b = probe(t.root);
  assert.notEqual(b.id, a.id);
  assert.equal(b.id, currentEngineIdentity(t.root).id);
  // identity cannot be computed: approvals do not release
  fs.rmSync(path.join(t.root, 'scripts/gen_engine_identity.ts'));
  fs.rmSync(path.join(t.root, 'approved.json'));
  const c = probe(t.root);
  assert.equal(c.id, 'UNVERIFIED');
  assert.equal(c.status, 'NEEDS_REVIEW');
  assert.ok(c.flags.includes('ENGINE_IDENTITY_UNVERIFIED'));
});

test('9. an approval made on an older engine is stale; a flag-text-only edit keeps it', () => {
  const t = tempProject();
  assert.equal(probe(t.root).state, 'APPROVED'); // approves and saves approved.json
  t.put('src/engine/qsEngine.ts', ENGINE.replace("message: 'ไม่พบรายละเอียดเหล็กเสริม — ใช้ค่ามาตรฐาน'", "message: 'ข้อความใหม่'"));
  assert.equal(probe(t.root).state, 'APPROVED');
  t.put('src/engine/qsEngine.ts', ENGINE.replace('(wM + 0.20)', '(wM + 0.30)'));
  const r = probe(t.root);
  assert.equal(r.state, 'STALE');
  assert.ok(r.stale.some((c: string) => c.startsWith('engineId:')));
});

test('7. Vite dev serves the identity computed from the current source, and recomputes it when the engine changes', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: path.join(REPO, 'vite.config.ts'), root: REPO, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
  try {
    const out = await server.transformRequest('/src/engine/engineIdentity.ts');
    assert.ok(out!.code.includes(currentEngineIdentity().id));
    assert.ok(!out!.code.includes('gen_engine_identity'), 'the Node fallback is not served to the browser');
  } finally {
    await server.close();
  }
  // the plugin itself, on a temporary engine: a source change invalidates the module and reloads the page
  const t = tempProject();
  const plugin = engineIdentityPlugin(t.root);
  const file = path.join(t.root, 'src/engine/engineIdentity.ts');
  const first = plugin.load(file)!;
  t.put('src/engine/qsEngine.ts', ENGINE.replace('(wM + 0.20)', '(wM + 0.30)'));
  const calls: string[] = [];
  const fake = { moduleGraph: { getModuleById: (id: string) => ({ id }), invalidateModule: (m: { id: string }) => calls.push('invalidate ' + path.basename(m.id)) }, ws: { send: (m: { type: string }) => calls.push(m.type) } };
  plugin.handleHotUpdate({ file: path.join(t.root, 'src/engine/qsEngine.ts'), server: fake });
  assert.deepEqual(calls, ['invalidate engineIdentity.ts', 'full-reload']);
  const second = plugin.load(file)!;
  assert.notEqual(second, first);
  assert.ok(second.includes(currentEngineIdentity(t.root).id));
});

test('8. a production build carries the current identity and is verifiable', async () => {
  const { build } = await import('vite');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'structboq-build-'));
  made.push(outDir);
  await build({ configFile: path.join(REPO, 'vite.config.ts'), root: REPO, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  const v = verifyBuildIdentity(outDir);
  assert.ok(v.ok, v.reason);
  assert.equal(v.built, currentEngineIdentity().id);
  assert.ok(!fs.readdirSync(path.join(outDir, 'assets')).some(f => fs.readFileSync(path.join(outDir, 'assets', f), 'utf8').includes('gen_engine_identity')));
});

test('engine identity in this process gates approvals (same rule the probes exercise)', () => {
  const specs = { ...DEFAULT_MATERIAL_SPECS, coverSources: { footing: 'drawing_notes' as const }, valueSources: Object.fromEntries(REQUIRED_SPECS.map(r => [r.key, { source: 'user' as const }])) };
  const f: ExtractedMember = { tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 1.2, length: 0.3, count: 1, unit: 'm', excavationDepthM: 1.5, bottomRebar: '6-DB12+6-DB12', footingHookShape: 'STRAIGHT',
    provenance: { evidence: [{ page: 1, label: 'd', method: 'pdf_text' }], fieldSources: { width: 'drawing', depth: 'drawing', length: 'drawing', rebar: 'drawing' }, confidence: 0.95 } };
  assert.equal(engineIdentity.id, currentEngineIdentity().id);
  assert.equal(calculateMember({ ...f, review: approvalFor(f, undefined, specs) }, 1, specs).approvalState, 'APPROVED');
});
