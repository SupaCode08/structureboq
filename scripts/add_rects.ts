/**
 * Add drawn geometry to an existing offline_ocr.json cache (no re-OCR): rectangles, horizontal and
 * vertical line segments, circles (vector sheets) or line segments from the cleaned raster (scans).
 *   npx tsx scripts/add_rects.ts <pdf> <offline_ocr.json>
 */
import fs from 'fs';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractSmallStrokes, pageGeometry } from '../src/pdf/vectorText.ts';
import { embeddedImage } from './scanImage.ts';
import { imageBoxesOnPage } from '../src/pdf/imageBoxes.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('add_rects.ts');

const [pdf, cache] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(cache, 'utf8'));
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), disableFontFace: true }).promise;
for (const pg of data.pages) {
  const page = await doc.getPage(pg.page);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const s = extractSmallStrokes(ops.fnArray, ops.argsArray, OPS as any, vp.transform);
  const g = pageGeometry(s, vp.width, vp.height);
  pg.rects = g.rects;
  pg.circles = g.circles;
  const scanned = s.small.length < 200 && s.imageCount > 0;
  const imgBoxes = scanned ? [] : await imageBoxesOnPage(page as any, OPS as any);
  pg.rects.push(...imgBoxes);
  if (scanned) {
    const img = await embeddedImage(page, false, true);
    pg.hsegs = img?.lines?.h || [];
    pg.vsegs = img?.lines?.v || [];
    pg.circles = img?.circles || [];
  } else {
    pg.hsegs = g.hsegs;
    pg.vsegs = g.vsegs;
  }
  console.log(`p${pg.page}${scanned ? ' scan' : ''} rects=${pg.rects.length} (image ${imgBoxes.length}) h=${pg.hsegs.length} v=${pg.vsegs.length} circles=${pg.circles.length}`);
}
fs.writeFileSync(cache, JSON.stringify(data, null, 1));
