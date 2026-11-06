/**
 * Gate for the OCR the app runs today. real_drawings/*\/offline_ocr.json was made by older OCR code, so check:full
 * measures that old OCR. This reads the structural pages of the dev sets again with the CURRENT code
 * (scripts/offline_ocr.ts, the same code path as the browser), scores them against the answer keys, and compares the
 * result with tools/benchmark/ocr_current_baseline.json: a wrong value more, or a right value fewer, fails (exit 1).
 *
 *   FULL_BOQ=1 npx tsx scripts/check_ocr_current.ts [--sets house_ready_1,house_ready_2,house_ready_4]
 *                                                  [--out <dir>] [--write-baseline] [--from <dir>]
 *
 * --from <dir> scores an OCR run already made by this script (<dir>/<set>.json) instead of reading again; it is accepted
 * only while the OCR code id is the one recorded in <dir>/ocr_id.txt, so a baseline never describes other code.
 *
 * Takes about 10 minutes (49 pages; the three sets are read in parallel). Nothing is written under real_drawings/: the new OCR goes to
 * --out (default: a temp folder) and is only merged with the old cache in memory. --write-baseline replaces the
 * baseline file; run it only when the person who owns the baseline says so.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS } from '../src/engine/sheetMerge.ts';
import { scoreReading, tallyText, type Category } from '../tools/readingScore.ts';
import { compareOcrBaseline, toSetScore, type OcrBaseline, type SetScore } from '../tools/ocrBaseline.ts';
import { currentOcrIdentity } from './gen_engine_identity.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('check_ocr_current.ts');

const BASELINE = 'tools/benchmark/ocr_current_baseline.json';
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const from = arg('--from');
const sets = (arg('--sets') ?? 'house_ready_1,house_ready_2,house_ready_4').split(',').filter(Boolean);
const out = path.resolve(from ?? arg('--out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'structboq-ocr-current-')));
if (path.relative(path.resolve('real_drawings'), out) && !path.relative(path.resolve('real_drawings'), out).startsWith('..')) {
  console.error(`--out ${out} is inside real_drawings/: refusing, the stored drawings and caches are never written.`);
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

/** one child process per set: the same OCR as the browser, offline, one engine pair per process */
function ocrSet(set: string): Promise<{ file: string; pages: number; ms: number }> {
  const dir = path.join('real_drawings', set);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  const pdf = path.join(dir, manifest.pdf);
  const file = path.join(out, `${set}.json`);
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'scripts/offline_ocr.ts', pdf, manifest.structuralPages, file], {
      env: { ...process.env, FULL_BOQ: '1', PADDLE: '0' }, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let pages = 0, err = '';
    child.stdout.on('data', d => { pages += (String(d).match(/^p\d+ /gm) || []).length; });
    child.stderr.on('data', d => { err += String(d); });
    child.on('error', reject);
    child.on('close', code => (code === 0 && fs.existsSync(file) ? resolve({ file, pages, ms: Date.now() - t0 }) : reject(new Error(`${set}: OCR exited ${code}\n${err.slice(-400)}`))));
  });
}

function scoreSet(set: string, newOcrFile: string): SetScore & { notes: string[] } {
  const dir = path.join('real_drawings', set);
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'answer_key.json'), 'utf-8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  const old = JSON.parse(fs.readFileSync(path.join(dir, 'offline_ocr.json'), 'utf-8')); // read only
  const fresh = new Map<number, any>((JSON.parse(fs.readFileSync(newOcrFile, 'utf-8')).pages as any[]).map(p => [p.page, p]));
  const pages = old.pages.map((p: any) => fresh.get(p.page) ?? p); // pages not read again keep the stored reading
  const { readings } = readSheets(pages);
  const merged = mergeSheetReadings(readings, manifest.pdf || 'x.pdf', { ...DEFAULT_MERGE_ASSUMPTIONS, footingVariant: manifest.footingVariant ?? 'แผ่' });
  const s = scoreReading(key, readings, merged.members);
  return { ...toSetScore(s), notes: s.notes };
}

const ocrId = currentOcrIdentity();
console.log(from ? `scoring the OCR already made in ${out}` : `OCR with the current code → ${out}`);
const t0 = Date.now();
if (from) {
  const recorded = fs.existsSync(path.join(out, 'ocr_id.txt')) ? fs.readFileSync(path.join(out, 'ocr_id.txt'), 'utf-8').trim() : '';
  if (recorded !== ocrId) { console.error(`--from ${out}: made by other OCR code (${recorded ? recorded.slice(0, 8) : 'no ocr_id.txt'}, now ${ocrId.slice(0, 8)}): read the sets again without --from.`); process.exit(2); }
}
const runs = await Promise.all(sets.map(async set => [set, from ? { file: path.join(out, `${set}.json`), pages: 0, ms: 0 } : await ocrSet(set)] as const));
if (!from) fs.writeFileSync(path.join(out, 'ocr_id.txt'), ocrId);
console.log(`OCR done in ${Math.round((Date.now() - t0) / 1000)} s: ${runs.map(([s, r]) => `${s} ${r.pages} pages`).join(' · ')}`);

const now: Record<string, SetScore> = {};
for (const [set, r] of runs) {
  const s = scoreSet(set, r.file);
  now[set] = { right: s.right, wrong: s.wrong, missing: s.missing, byCategory: s.byCategory };
  const n = s.right + s.wrong + s.missing;
  console.log(`\n${set}: ${n} values — ${tallyText(s)}`);
  for (const c of ['grid', 'tag', 'count', 'dimension', 'rebar'] as Category[]) console.log(`  ${c.padEnd(10)} ${tallyText(s.byCategory[c])}`);
  if (process.argv.includes('--detail')) s.notes.forEach(x => console.log('   -', x));
}
console.log(`\nOCR code id: ${ocrId}`);

if (process.argv.includes('--write-baseline')) {
  const b: OcrBaseline = { ocrId, generatedAt: new Date().toISOString(), sets: now };
  fs.writeFileSync(BASELINE, JSON.stringify(b, null, 2) + '\n');
  console.log(`baseline written: ${BASELINE}`);
  process.exit(0);
}
if (!fs.existsSync(BASELINE)) {
  console.log(`no baseline yet (${BASELINE}): nothing to compare with. Run with --write-baseline once the numbers above are accepted.`);
  process.exit(0);
}
const r = compareOcrBaseline(JSON.parse(fs.readFileSync(BASELINE, 'utf-8')), now, ocrId);
console.log('\nagainst the baseline:');
r.lines.forEach(l => console.log(' ', l));
if (!r.ok) { console.error('\nFAILED:\n' + r.failures.map(f => '  - ' + f).join('\n')); process.exit(1); }
console.log('\nOK: no wrong value more, no right value fewer.');
