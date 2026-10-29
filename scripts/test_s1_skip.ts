import fs from 'fs';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_s1_skip.ts');

// Add a console.log or check why S1 wasn't in sections
const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = hr3.pages.find((p: any) => p.page === 34);

const { vocab } = readSheets(hr3.pages);
console.log('vocab has S1:', vocab.includes('S1'));
