import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p27_words.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p27 = hr3.pages.find((p: any) => p.page === 27);
console.log('Words on page 27:');
console.log(p27.words.map((w: any) => w.text).join(' '));
