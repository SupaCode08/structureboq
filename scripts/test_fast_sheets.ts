import fs from 'fs';
import T from 'tesseract.js';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_fast_sheets.ts');

async function testAll() {
  const wEng = await T.createWorker('eng');
  await wEng.setParameters({ tessedit_pageseg_mode: '6' as any });
  
  const t0 = performance.now();
  for (let p = 1; p <= 28; p++) {
    const file = `scripts/sheet_${p}.png`;
    if (!fs.existsSync(file)) continue;
    const tStart = performance.now();
    const res = await wEng.recognize(fs.readFileSync(file));
    const txt = res.data.text.replace(/\s+/g, ' ').trim();
    const tEnd = performance.now();
    console.log(`Page ${p} (${Math.round(tEnd - tStart)}ms): "${txt}"`);
  }
  const total = performance.now() - t0;
  console.log(`Total time for 28 pages: ${Math.round(total)}ms`);
  await wEng.terminate();
}
testAll();
