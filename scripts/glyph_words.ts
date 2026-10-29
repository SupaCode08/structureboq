/**
 * Re-reads the stroke lettering of a cached OCR run by letter shape (src/pdf/glyphRead.ts), no new OCR.
 *   npx tsx scripts/glyph_words.ts <pdf> <offline_ocr.json> [out.json]
 */
import fs from 'fs';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractSmallStrokes } from '../src/pdf/vectorText.ts';
import { glyphWords, withGlyphWords } from '../src/pdf/glyphRead.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('glyph_words.ts');

const [pdf, cache, out = cache] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(cache, 'utf8'));
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), disableFontFace: true }).promise;
for (const pg of data.pages) {
  const page = await doc.getPage(pg.page);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const s = extractSmallStrokes(ops.fnArray, ops.argsArray, OPS as any, vp.transform, 15);
  if (s.small.length < 200) continue;
  const g = glyphWords(s.small, vp.width, vp.height, pg.words);
  const before = pg.words.length;
  pg.words = withGlyphWords(pg.words, g);
  console.log(`p${pg.page} glyph words ${g.length}, words ${before} -> ${pg.words.length}`);
}
fs.writeFileSync(out, JSON.stringify(data));
