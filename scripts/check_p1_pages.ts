import fs from 'fs';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('check_p1_pages.ts');

const ocr = JSON.parse(fs.readFileSync('real_drawings/plan_house_1/offline_ocr.json', 'utf-8'));
console.log('Pages in plan_house_1:', ocr.pages.map((p: any) => p.page));
