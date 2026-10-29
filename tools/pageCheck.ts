/**
 * Page-classification-only check (dev tool, not part of the app build): runs fastClassifySheet — the
 * same code the upload path uses before a full-page OCR — on every page of a set's PDF and compares
 * the pages it keeps with `structuralPages` in the set's manifest. No full OCR, reader or BOQ step.
 *
 *   npm run dev, then open http://localhost:5173/tools/page-check.html?sets=house_ready_1,house_ready_3
 */
import { loadPdf, fastClassifySheet, ocrWorker, parsePageSpec } from '../src/pdf/browserPipeline';
import { toPageText } from '../src/pdf/pdfText';

interface PageRow { page: number; expected: boolean | null; skip: boolean; ms: number; reason: string }
interface SetResult { set: string; limitation?: string; rows: PageRow[]; kept?: number; wronglySkipped?: number[]; nonStructSkipped?: number; nonStructTotal?: number; msPerPage?: number }

async function checkSet(set: string, worker: any): Promise<SetResult> {
  const base = `/real_drawings/${set}/`;
  const mres = await fetch(base + 'manifest.json');
  const manifest = mres.ok ? await mres.json().catch(() => null) : null;
  const pdfName = manifest?.pdf ?? manifest?.drawingPdf ?? 'drawings.pdf';
  const pres = await fetch(base + pdfName);
  if (!pres.ok) return { set, limitation: `PDF not found: ${pdfName}`, rows: [] };
  const doc = await loadPdf(await pres.arrayBuffer());
  const spec: string | undefined = manifest?.structuralPages;
  const expected = spec ? new Set(parsePageSpec(spec, doc.numPages)) : null;
  const rows: PageRow[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const text = toPageText(p, page.getViewport({ scale: 1 }), (await page.getTextContent()) as any);
    const t0 = performance.now();
    const c = await fastClassifySheet(page, worker, p, doc.numPages, text);
    rows.push({ page: p, expected: expected ? expected.has(p) : null, skip: c.skip, ms: Math.round(performance.now() - t0), reason: c.reason || c.sheetId || '' });
  }
  if (!expected) return { set, limitation: manifest ? 'manifest has no structuralPages' : 'no manifest.json — result not counted as a pass', rows };
  const struct = rows.filter(r => r.expected), non = rows.filter(r => !r.expected);
  return {
    set, rows,
    kept: struct.filter(r => !r.skip).length,
    wronglySkipped: struct.filter(r => r.skip).map(r => r.page),
    nonStructSkipped: non.filter(r => r.skip).length, nonStructTotal: non.length,
    msPerPage: Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length),
  };
}

const out = document.getElementById('out')!;
const sets = (new URLSearchParams(location.search).get('sets') || 'house_ready_1,house_ready_3,thaisuk_1').split(',');
(async () => {
  const worker = await ocrWorker();
  const results: SetResult[] = [];
  for (const s of sets) {
    out.textContent += `checking ${s}…\n`;
    const r = await checkSet(s.trim(), worker);
    results.push(r);
    const head = r.limitation
      ? `${r.set}: LIMITATION — ${r.limitation}`
      : `${r.set}: structural kept ${r.kept}/${r.kept! + r.wronglySkipped!.length}, wrongly skipped [${r.wronglySkipped!.join(', ')}], non-structural skipped ${r.nonStructSkipped}/${r.nonStructTotal}, ${r.msPerPage} ms/page`;
    out.textContent += head + '\n' + r.rows.map(x => `  p${x.page} expected=${x.expected === null ? '?' : x.expected ? 'S' : '-'} ${x.skip ? 'SKIP' : 'keep'} ${x.ms}ms ${x.reason}`).join('\n') + '\n';
  }
  (window as any).__pageCheck = results;
  out.textContent += 'done\n';
})().catch(e => { out.textContent += 'ERROR ' + e + '\n'; });
