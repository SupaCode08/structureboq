import fs from 'fs';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('check_p1_readings.ts');

const ocr = JSON.parse(fs.readFileSync('real_drawings/plan_house_1/offline_ocr.json', 'utf-8'));
const { readings } = readSheets(ocr.pages);
for (const r of readings) {
  console.log(`Page ${r.page} (${r.sheet_type}) instances: ${r.instances.length}, sections: ${r.sections.length}`);
  for (const i of r.instances) console.log('  I:', i.tag, i.member_type, i.from_grid, i.to_grid);
  for (const s of r.sections) console.log('  S:', s.tag, s.member_type, s.width_m, 'x', s.depth_m);
}
