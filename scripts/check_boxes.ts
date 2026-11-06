/**
 * Box check on real sets (tools/boxCheck.ts): counts the reader's boxes that are not on a member label, per set.
 *   FULL_BOQ=1 npx tsx scripts/check_boxes.ts real_drawings/<set> [...] [--detail]
 * Reads the stored offline_ocr.json only; writes nothing.
 */
import fs from 'fs';
import path from 'path';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { checkBoxes, type BoxProblem } from '../tools/boxCheck.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('check_boxes.ts');

const detail = process.argv.includes('--detail');
const total: Record<BoxProblem, number> = { badTag: 0, unanchored: 0, titleBlock: 0, guess: 0 };
let boxes = 0;
for (const dir of process.argv.slice(2).filter(a => !a.startsWith('--'))) {
  // a set folder (its stored offline_ocr.json) or an OCR json file (e.g. from check_ocr_current.ts --out)
  const f = dir.endsWith('.json') ? dir : path.join(dir, 'offline_ocr.json');
  if (!fs.existsSync(f)) { console.log(`${dir}: no offline_ocr.json`); continue; }
  const j = JSON.parse(fs.readFileSync(f, 'utf-8'));
  const pages = Array.isArray(j) ? j : j.pages;
  const { readings } = readSheets(pages);
  const found = checkBoxes(readings, p => pages.find((x: any) => x.page === p)?.words ?? []);
  const n = readings.reduce((s, r) => s + [...r.instances, ...r.sections].filter(i => i.box_2d).length, 0);
  const by = (k: BoxProblem) => found.filter(x => x.problem === k).length;
  boxes += n;
  for (const k of Object.keys(total) as BoxProblem[]) total[k] += by(k);
  console.log(`${path.basename(dir)}: ${n} boxes · badTag ${by('badTag')} · unanchored ${by('unanchored')} · titleBlock ${by('titleBlock')} · guess ${by('guess')}`);
  if (detail) for (const x of found) console.log(`   - p${x.page} ${x.kind} ${x.problem} "${x.tag}" [${x.box.join(',')}]`);
}
console.log(`ALL: ${boxes} boxes · badTag ${total.badTag} · unanchored ${total.unanchored} · titleBlock ${total.titleBlock} · guess ${total.guess}`);
