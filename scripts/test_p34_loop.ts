import fs from 'fs';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p34_loop.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = hr3.pages.find((p: any) => p.page === 34);

// Let's run readSheets on [p34]
const res = readSheets([p34]);
console.log('Sections extracted from p34 alone:');
for (const s of res.readings[0].sections) {
  console.log(' -', s.tag, s.member_type, s.thickness_m, s.width_m, s.depth_m);
}
