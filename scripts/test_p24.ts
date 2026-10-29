import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p24.ts');

const d = JSON.parse(fs.readFileSync('public/datasets/dpt-house-ready-1/offline_ocr.json', 'utf8'));
const p24 = d.pages.find((p: any) => p.page === 24);
console.log(p24.words.map((w: any) => w.text).join(' '));
