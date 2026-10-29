import fs from 'fs';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('check_p34.ts');

const ocr = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = ocr.pages.find((p: any) => p.page === 34);
const { readings } = readSheets([p34]);
console.log('p34 reading:', JSON.stringify(readings[0], null, 2));
