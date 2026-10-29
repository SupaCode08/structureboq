import fs from 'fs';
import T from 'tesseract.js';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('test_ocr_speed.ts');

async function testOcr() {
  const img = fs.readFileSync('scripts/p2_crop.png');
  
  console.log('Testing eng PSM 6...');
  const t0 = performance.now();
  const wEng = await T.createWorker('eng');
  await wEng.setParameters({ tessedit_pageseg_mode: '6' as any });
  const resEng = await wEng.recognize(img);
  const t1 = performance.now();
  console.log(`Eng PSM 6 took ${Math.round(t1 - t0)}ms:`);
  console.log(resEng.data.text.trim());
  await wEng.terminate();

  console.log('\nTesting tha+eng PSM 11...');
  const t2 = performance.now();
  const wThai = await T.createWorker('tha+eng');
  await wThai.setParameters({ tessedit_pageseg_mode: '11' as any });
  const resThai = await wThai.recognize(img);
  const t3 = performance.now();
  console.log(`Tha+eng PSM 11 took ${Math.round(t3 - t2)}ms:`);
  console.log(resThai.data.text.trim());
  await wThai.terminate();
}
testOcr();
