import fs from 'fs';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_s1_p34.ts');

const hr3 = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p34 = hr3.pages.find((p: any) => p.page === 34);

// Look at words mentioning S1
const s1Words = p34.words.filter((w: any) => /S1/i.test(w.text));
console.log('s1Words on p34:', s1Words);

// Look at words nearby S1
for (const s of s1Words) {
  const nearby = p34.words.filter((w: any) => Math.hypot(w.x0 - s.x0, w.y0 - s.y0) < 0.15);
  console.log(`Nearby S1 at (${s.x0.toFixed(3)}, ${s.y0.toFixed(3)}):`, nearby.map((w: any) => w.text).join(' '));
}
