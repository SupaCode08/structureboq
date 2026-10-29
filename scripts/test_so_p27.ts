import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_so_p27.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p27 = hr3.pages.find((p: any) => p.page === 27);
const soWords = p27.words.filter((w: any) => /SO/i.test(w.text));
console.log('soWords on p27:', soWords);
