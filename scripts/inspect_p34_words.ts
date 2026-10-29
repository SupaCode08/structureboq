import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('inspect_p34_words.ts');

const ocr = JSON.parse(fs.readFileSync('real_drawings/house_ready_3/offline_ocr.json', 'utf-8'));
const p = ocr.pages.find((x: any) => x.page === 34);
for (const w of p.words) {
  if (/GB|B1|B2|B3|B4|BST|ST|012|016|06|1:25/i.test(w.text)) {
    console.log(w.text, 'at', w.x0.toFixed(3), w.y0.toFixed(3));
  }
}
