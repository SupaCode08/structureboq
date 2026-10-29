import fs from 'fs';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p34_sections.ts');

const ocr = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = ocr.pages.find((p: any) => p.page === 34);

// Temporarily test reading page 34 as non-index
const { readings } = readSheets([p34]);
console.log('Readings on p34 count:', readings.length);
if (readings[0]) {
  console.log('sheet_type:', readings[0].sheet_type);
  console.log('sections found:', readings[0].sections.length);
  for (const s of readings[0].sections) {
    console.log('  Section:', s.tag, s.member_type, s.width_m, 'x', s.depth_m, 'top:', s.top_rebar, 'bot:', s.bottom_rebar, 'stirrup:', s.stirrup, 'ev:', s.evidence);
  }
}
