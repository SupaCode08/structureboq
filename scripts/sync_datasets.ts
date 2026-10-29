/**
 * Copies the real drawing sets into public/datasets/ so the static web build can load them
 * (PDF + cached offline OCR words). No server needed at runtime.
 *
 *   npx tsx scripts/sync_datasets.ts
 */
import fs from 'fs';
import path from 'path';

const src = 'real_drawings';
const dst = path.join('public', 'datasets');
fs.mkdirSync(dst, { recursive: true });
const index: any[] = [];
for (const d of fs.readdirSync(src)) {
  const mf = path.join(src, d, 'manifest.json');
  if (!fs.existsSync(mf)) continue;
  const m = JSON.parse(fs.readFileSync(mf, 'utf-8'));
  const ocr = path.join(src, d, 'offline_ocr.json');
  if (!fs.existsSync(ocr)) { console.warn(`skip ${d}: run scripts/offline_ocr.ts first`); continue; }
  const out = path.join(dst, m.id);
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(src, d, m.pdf), path.join(out, m.pdf));
  // keep only what the reader needs from the OCR cache
  const o = JSON.parse(fs.readFileSync(ocr, 'utf-8'));
  fs.writeFileSync(path.join(out, 'offline_ocr.json'), JSON.stringify({ engine: o.engine, extractedAt: o.extractedAt, pages: o.pages.map((p: any) => ({ page: p.page, width: p.width, height: p.height, words: p.words, rects: p.rects, hsegs: p.hsegs, vsegs: p.vsegs, circles: p.circles })) }));
  let boqOcr: string | undefined;
  if (m.boqOcr && fs.existsSync(path.join(src, d, m.boqOcr))) {
    fs.copyFileSync(path.join(src, d, m.boqOcr), path.join(out, 'boq_ocr.json'));
    boqOcr = `datasets/${m.id}/boq_ocr.json`;
  }
  index.push({ id: m.id, name: m.name, source: m.source, structuralPages: m.structuralPages, pdf: `datasets/${m.id}/${m.pdf}`, ocr: `datasets/${m.id}/offline_ocr.json`, boqOcr, boqVariant: m.boqVariant, footingVariant: m.footingVariant });
  console.log('synced', m.id);
}
fs.writeFileSync(path.join(dst, 'index.json'), JSON.stringify({ datasets: index }, null, 2));
