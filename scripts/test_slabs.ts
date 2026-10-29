import fs from 'fs';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_slabs.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const { readings } = readSheets(hr3.pages);
for (const p of [27, 28]) {
  const r = readings.find(x => x.page === p);
  console.log(`\nPage ${p} (${r?.sheet_type}):`);
  for (const i of r?.instances || []) {
    if (i.member_type === 'SLAB') {
      console.log('   Slab:', i.tag, i.from_grid, i.to_grid, 'level:', i.level);
    }
  }
}
