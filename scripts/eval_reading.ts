/**
 * Reading accuracy against a hand-read answer key (real_drawings/<set>/answer_key.json), per field —
 * not only BOQ totals, which can hide errors that cancel out.
 *
 *   npx tsx scripts/eval_reading.ts real_drawings/cdc_1 [real_drawings/house_ready_4 ...] [--detail] [--json out.json]
 *
 * For every tag in the key: found?  count right?  width / depth / thickness / bars / stirrups:
 * right, WRONG (a value that looks trustworthy but is not — the worst case) or missing.
 * Scoring lives in tools/readingScore.ts; this script reads the sets and prints, also by category and member type.
 */
import fs from 'fs';
import path from 'path';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS } from '../src/engine/sheetMerge.ts';
import { addTally, lengthText, scoreLengths, scoreReading, tallyText, type Category, type LengthClass, type Tally } from '../tools/readingScore.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('eval_reading.ts');

function evaluate(dir: string, detail: boolean) {
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'answer_key.json'), 'utf-8'));
  const manifest = fs.existsSync(path.join(dir, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) : {};
  const ocr = JSON.parse(fs.readFileSync(path.join(dir, 'offline_ocr.json'), 'utf-8'));
  const { readings } = readSheets(ocr.pages);
  const merged = mergeSheetReadings(readings, manifest.pdf || 'x.pdf', { ...DEFAULT_MERGE_ASSUMPTIONS, footingVariant: manifest.footingVariant ?? 'แผ่' });
  const s = scoreReading(key, readings, merged.members);
  const lengths = scoreLengths(key, merged.members, readings);
  const pct = (n: number) => `${Math.round((n / s.total) * 100)}%`;
  console.log(`\n${key.split === 'heldout' ? '[ชุดทดสอบแยก]' : '[ชุดพัฒนา]'} ${dir}`);
  console.log(`  เบอร์ที่พบ ${s.tagsFound}/${key.members.length} · ค่าทั้งหมด ${s.total}: ถูก ${s.right} (${pct(s.right)}) · ผิด ${s.wrong} (${pct(s.wrong)}) · ไม่พบ ${s.missing} (${pct(s.missing)})`);
  if (detail) s.notes.forEach(n => console.log('   -', n));
  return { dir, split: key.split, ...s, lengths };
}

const detail = process.argv.includes('--detail');
const jsonAt = process.argv.indexOf('--json');
const jsonOut = jsonAt > 0 ? process.argv[jsonAt + 1] : undefined;
const dirs = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--json');
const rows = dirs.map(d => evaluate(d, detail));
if (rows.length > 1) {
  for (const split of ['dev', 'heldout']) {
    const r = rows.filter(x => x.split === split);
    if (!r.length) continue;
    const t = r.reduce((a, x) => ({ right: a.right + x.right, wrong: a.wrong + x.wrong, missing: a.missing + x.missing, total: a.total + x.total }), { right: 0, wrong: 0, missing: 0, total: 0 });
    console.log(`\nรวม${split === 'dev' ? 'ชุดพัฒนา' : 'ชุดทดสอบแยก'}: ถูก ${Math.round(t.right / t.total * 100)}% · ผิด ${Math.round(t.wrong / t.total * 100)}% · ไม่พบ ${Math.round(t.missing / t.total * 100)}%`);
  }
}
// where the reading is right or wrong: by category and by member type, per split
const breakdown: Record<string, { byCategory: Record<string, Tally>; byType: Record<string, Tally> }> = {};
for (const split of ['dev', 'heldout']) {
  const r = rows.filter(x => x.split === split);
  if (!r.length) continue;
  const sum = (pick: (x: typeof r[number]) => Record<string, Tally>) => r.reduce<Record<string, Tally>>((acc, x) => {
    for (const [k, t] of Object.entries(pick(x))) acc[k] = addTally(acc[k] || { right: 0, wrong: 0, missing: 0 }, t);
    return acc;
  }, {});
  breakdown[split] = { byCategory: sum(x => x.byCategory), byType: sum(x => x.byType) };
  console.log(`\n${split === 'dev' ? 'ชุดพัฒนา' : 'ชุดทดสอบแยก'} แยกตามชนิดค่า:`);
  for (const c of ['grid', 'tag', 'count', 'dimension', 'rebar'] as Category[]) if (breakdown[split].byCategory[c]) console.log(`  ${c.padEnd(10)} ${tallyText(breakdown[split].byCategory[c])}`);
  console.log(`${split === 'dev' ? 'ชุดพัฒนา' : 'ชุดทดสอบแยก'} แยกตามชนิดชิ้น:`);
  for (const [k, t] of Object.entries(breakdown[split].byType)) console.log(`  ${k.padEnd(10)} ${tallyText(t)}`);
}
// every beam instance length against the key grid — reported apart, so the totals above stay comparable with earlier runs
for (const split of ['dev', 'heldout']) {
  const r = rows.filter(x => x.split === split);
  if (!r.length) continue;
  console.log(`\n${split === 'dev' ? 'ชุดพัฒนา' : 'ชุดทดสอบแยก'} ความยาวช่วงคานทุกชิ้น (เทียบระยะกริดใน key):`);
  for (const x of r) console.log(`  ${path.basename(x.dir)}: ${lengthText(x.lengths.tally)}`);
  const sum = r.reduce((a, x) => { for (const [k, v] of Object.entries(x.lengths.tally)) a[k as LengthClass] = (a[k as LengthClass] || 0) + v; return a; }, {} as Record<LengthClass, number>);
  console.log(`  รวม: ${lengthText(sum)}`);
  if (detail) for (const x of r) for (const l of x.lengths.rows.filter(l => l.cls !== 'right')) console.log(`   - ${path.basename(x.dir)} ${l.tag} ${l.from ?? '-'}–${l.to ?? '-'} ${l.level ?? ''}: ${l.cls} (ระบบ ${l.length ?? '-'}${l.expected !== undefined ? ' กริด ' + l.expected : ''})`);
}
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ sets: rows.map(({ notes, ...x }) => x), breakdown }, null, 2));
  console.log(`\nเขียนผลแบบ JSON ที่ ${jsonOut}`);
}
