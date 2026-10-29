import fs from 'fs';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_p34_sections_trace.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const { readings } = readSheets(hr3.pages);
const p34 = readings.find(r => r.page === 34);
console.log('p34 sections:', p34?.sections);
