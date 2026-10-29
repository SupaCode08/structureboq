import fs from 'fs';
import path from 'path';
import { computeProject, DEFAULT_MATERIAL_SPECS } from '../src/engine/qsEngine.ts';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS } from '../src/engine/sheetMerge.ts';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('inspect_zero_items.ts');

const dir = 'real_drawings/house_ready_3';
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
const ocr = JSON.parse(fs.readFileSync(path.join(dir, 'offline_ocr.json'), 'utf-8'));
const { readings } = readSheets(ocr.pages);
const merged = mergeSheetReadings(readings, manifest.pdf, { ...DEFAULT_MERGE_ASSUMPTIONS, footingVariant: manifest.footingVariant });
const result = computeProject(merged.members, manifest.name, DEFAULT_MATERIAL_SPECS);

console.log('Total members:', merged.members.length);
for (const it of result.items) {
  if (it.volumeNetM3 === 0 || it.status === 'NEEDS_REVIEW') {
    console.log(it.itemId, it.tag.padEnd(12), it.gridLocation.padEnd(12), it.level.slice(0, 10).padEnd(10), `${it.widthM}x${it.depthM}x${it.lengthNetM}`.padEnd(16), 'vol:', it.volumeNetM3, 'flags:', (it.flags || []).map(f => f.code).join(','));
  }
}
