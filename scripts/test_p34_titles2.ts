import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p34_titles2.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = hr3.pages.find((p: any) => p.page === 34);

// Let's inspect words on p34 that have S1
const s1w = p34.words.filter((w: any) => w.text === 'S1');
console.log('s1 words:', s1w);
