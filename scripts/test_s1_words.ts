import fs from 'fs';
import { readSheets, splitTags } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_s1_words.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const { vocab } = readSheets(hr3.pages);
const vocabSet = new Set(vocab);

console.log('splitTags S1:', splitTags('S1', vocabSet));
