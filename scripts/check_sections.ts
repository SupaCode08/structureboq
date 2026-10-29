import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('check_sections.ts');

const ocr = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
for (const pageNum of [27, 28, 29, 34, 35, 36]) {
  const p = ocr.pages.find((x: any) => x.page === pageNum);
  if (!p) continue;
  console.log(`\n=== PAGE ${pageNum} ===`);
  const words = p.words.map((w: any) => w.text).join(' ');
  console.log(words.slice(0, 500));
}
