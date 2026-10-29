import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_clean_refs.ts');

const d1 = JSON.parse(fs.readFileSync('public/datasets/dpt-house-ready-1/offline_ocr.json', 'utf8'));
const p24 = d1.pages.find((p: any) => p.page === 24);

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = hr3.pages.find((p: any) => p.page === 34);

const clean = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');

// A drawing sheet number format:
// Must have hyphen/delimiter (S-01, S-11, A-02, 5-09, -05) OR prefix + 2 digits (S01, S02)
const isDrawingSheetRef = (t: string) =>
  /^(?:S|A|AR|EE|SN|SAN|M|ME|ST|STR)[—–-\ufffd]\d{1,2}\.?$/i.test(t) ||
  /^(?:S|A|AR|EE|SN|SAN|M|ME|ST|STR)0\d\.?$/i.test(t) ||
  /^5[—–-\ufffd]0?\d{1,2}\.?$/.test(t) ||
  /^[-—–-\ufffd]0\d\.?$/.test(t);

console.log('P24 sheet refs:', p24.words.filter((w: any) => isDrawingSheetRef(w.text)).map((w: any) => w.text));
console.log('P34 sheet refs:', p34.words.filter((w: any) => isDrawingSheetRef(w.text)).map((w: any) => w.text));
