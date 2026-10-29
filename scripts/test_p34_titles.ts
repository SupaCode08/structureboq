import fs from 'fs';
import { tagWordsOf, sectionMarkTitles } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p34_titles.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = hr3.pages.find((p: any) => p.page === 34);

const tagWords = tagWordsOf(p34);
console.log('tagWords count:', tagWords.length);
for (const t of tagWords) {
  console.log('  tagWord:', t.w.text, 'parts:', t.parts.map(p => p.tag).join(','));
}

const smt = sectionMarkTitles(p34, tagWords);
console.log('sectionMarkTitles count:', smt.length);
for (const t of smt) {
  console.log('  smt:', t.w.text, 'parts:', t.parts.map(p => p.tag).join(','));
}
