import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('check_p12_words.ts');

const ocr = JSON.parse(fs.readFileSync('real_drawings/plan_house_1/offline_ocr.json', 'utf-8'));
const p12 = ocr.pages.find((p: any) => p.page === 12);
console.log('Words on page 12 of plan_house_1:');
console.log(p12.words.map((w: any) => w.text).join(' '));
