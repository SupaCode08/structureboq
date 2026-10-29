import fs from 'fs';
import { isDrawingIndexSheet } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p34_index.ts');

const ocr = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
for (const p of ocr.pages) {
  if (isDrawingIndexSheet(p)) {
    console.log(`Page ${p.page} detected as Drawing Index Sheet! Words: ${p.words.length}`);
  }
}
