import fs from 'fs';
import { getDrawingIndexTableExclusion } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_excl.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = hr3.pages.find((p: any) => p.page === 34);

const excl = getDrawingIndexTableExclusion(p34);
console.log('p34 excl:', excl);
