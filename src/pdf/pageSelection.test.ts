/**
 * Round 21: page selection — the selection state, and the reading steps it limits, on a real 5-page PDF read by
 * pdf.js. The browser-only OCR step is checked in the browser run (processLog); here every page pdf.js opens is
 * recorded by wrapping getPage, so "not read" means not opened at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { canProcess, deselectAll, invert, selectAll, recallSelection, rememberSelection, selectionFor, toggle, toPageSpec, type PageSelection, type SelectionStore } from './pageSelection.ts';
import { readTextLayers, type ProcessLog } from './pdfText.ts';
import { parsePageSpec, partitionDrawingPages } from './pdfOcrPipeline.ts';
import { scheduleMembersFromPage } from './scheduleParser.ts';
import { makeTestPdf } from './fixtures/makeTestPdf.ts';
import { computeProject, DEFAULT_MATERIAL_SPECS } from '../engine/qsEngine.ts';
import { buildBoqWorkbook } from '../export/excelWorkbook.ts';

const S = (n = 5, hash = 'h1'): PageSelection => selectionFor(null, hash, n);

test('selection: select all, deselect all, invert, single and several pages, nothing selected', () => {
  assert.deepEqual(selectAll(S()).selectedPages, [1, 2, 3, 4, 5]);                    // 1
  assert.deepEqual(deselectAll(selectAll(S())).selectedPages, []);                   // 2
  assert.deepEqual(invert(toggle(toggle(S(), 2), 5)).selectedPages, [1, 3, 4]);     // 3
  assert.deepEqual(toggle(S(), 3).selectedPages, [3]);                               // 4
  assert.deepEqual(toggle(toggle(toggle(S(), 5), 2), 4).selectedPages, [2, 4, 5]);   // 5 (kept in page order)
  assert.deepEqual(toggle(toggle(S(), 2), 2).selectedPages, []);                     // toggling twice clears
  assert.equal(canProcess(S()), false);                                             // 6
  assert.equal(canProcess(toggle(S(), 1)), true);
  assert.deepEqual(toggle(S(), 0).selectedPages, []);                                // outside the file: ignored
  assert.deepEqual(toggle(S(), 6).selectedPages, []);
});

test('selection: another file (other bytes or page count) starts empty; the same bytes keep it', () => {
  const picked = toggle(toggle(S(5, 'h1'), 2), 5);
  assert.deepEqual(selectionFor(picked, 'h2', 5).selectedPages, []);                 // 7 / 8: other bytes
  assert.equal(selectionFor(picked, 'h2', 5).fileHash, 'h2');
  assert.deepEqual(selectionFor(picked, 'h1', 7).selectedPages, []);
  assert.equal(selectionFor(picked, 'h1', 5), picked);
});

test('selection: a large file, and page numbers stay the original 1-based numbers', () => {
  const big = selectAll(S(2000));                                                    // 9
  assert.equal(big.selectedPages.length, 2000);
  assert.deepEqual(invert(toggle(big, 1500)).selectedPages, [1500]);
  const spec = toPageSpec(toggle(toggle(S(24), 9), 2));                              // 10
  assert.equal(spec, '2,9');
  assert.deepEqual(parsePageSpec(spec, 24), [2, 9]);
});

test('pipeline: selecting pages 2 and 5 of a 5-page PDF opens only those pages and keeps their numbers to Excel', async () => {
  const doc = await getDocument({ data: makeTestPdf(5), useSystemFonts: true }).promise;
  const opened: number[] = [];
  const spy = { numPages: doc.numPages, getPage: (n: number) => { opened.push(n); return doc.getPage(n); } };
  const requested = parsePageSpec(toPageSpec(toggle(toggle(S(5), 2), 5)), doc.numPages);
  const log: ProcessLog = [];
  const texts = await readTextLayers(spy as any, requested, log);
  assert.deepEqual(opened, [2, 5], 'pdf.js opened no other page');
  assert.deepEqual(log, [{ page: 2, step: 'text' }, { page: 5, step: 'text' }]);
  assert.deepEqual(texts.map(t => t.items.length > 0), [false, true, false, false, true]);

  // the next steps get only these pages, under their own numbers
  const textPages = new Set(texts.filter(t => t.items.length).map(t => t.page));
  assert.deepEqual(partitionDrawingPages(5, textPages, new Set([2, 5]), new Set(), requested).ocrCandidates, [2, 5]);
  assert.deepEqual(partitionDrawingPages(5, textPages, new Set(), new Set(), requested).textSheetPages, [2, 5]);
  const members = texts.filter(t => requested!.includes(t.page)).flatMap(t => scheduleMembersFromPage(t, 'five.pdf'));
  assert.deepEqual(members.map(m => [m.tag, m.provenance!.evidence[0].page, m.gridLocation, m.sourceSheetOrLayer]),
    [['F2', 2, 'Sheet-P2', 'Page 2'], ['F5', 5, 'Sheet-P5', 'Page 5']]);
  assert.deepEqual(members.map(m => m.width), [1.2, 1.5]); // page 2's row says 1.20, page 5's says 1.50

  // whole-file reading (no selection) still reads every page
  const all: number[] = [];
  await readTextLayers({ numPages: 5, getPage: (n: number) => { all.push(n); return doc.getPage(n); } } as any, undefined, []);
  assert.deepEqual(all, [1, 2, 3, 4, 5]);

  const project = computeProject(members, 'five', DEFAULT_MATERIAL_SPECS);
  const wb = buildBoqWorkbook({ ...project, reviewLog: [] });
  const s7 = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['7. บันทึกการตรวจทาน'], { header: 1 });
  const ev = s7[1].indexOf('หลักฐานในแบบ');
  assert.deepEqual(s7.slice(2).map(r => [r[1], r[3], r[ev]]), [['F2', 'Sheet-P2', 'บรรทัดในตาราง (หน้า 2) น.2'], ['F5', 'Sheet-P5', 'บรรทัดในตาราง (หน้า 5) น.5']]);
  const s2 = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['2. รายการถอดแบบละเอียด'], { header: 1 });
  assert.ok(s2.some(r => r.some(c => /Page 5/.test(String(c)))));
  await doc.destroy();
});

test('file identity: a selection is bound to the bytes, never to the file name alone', async () => {
  const { fileIdentity, fileKey } = await import('./fileIdentity.ts');
  const a = new File([makeTestPdf(5)], 'set.pdf'), b = new File([makeTestPdf(4)], 'set.pdf'), a2 = new File([makeTestPdf(5)], 'renamed.pdf');
  const [ka, kb, ka2] = await Promise.all([a, b, a2].map(async f => fileKey(f, await fileIdentity(f))));
  assert.match(ka, /^[0-9a-f]{64}$/);
  assert.notEqual(ka, kb);   // same name, other bytes: other key, so its selection starts empty
  assert.equal(ka, ka2);     // same bytes under another name: same file
  assert.match(fileKey(a, { file: 'set.pdf', sha256: null }), /^nohash:set\.pdf:\d+:\d+$/);
});

const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);
const memoryStore = (): SelectionStore & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }; };

test('remembered selection: the pages processed last time come back for the same bytes, not for another file or page count', () => {
  const st = memoryStore();
  rememberSelection(st, { fileHash: H1, totalPages: 71, selectedPages: [24, 25, 37] });
  const back = recallSelection(st, H1, 71)!;
  assert.deepEqual(back.selectedPages, [24, 25, 37]);
  assert.equal(recallSelection(st, H2, 71), null, 'another file');
  assert.equal(recallSelection(st, H1, 70), null, 'same hash but another page count');
  assert.deepEqual(selectionFor(null, H1, 71, back).selectedPages, [24, 25, 37]);
  assert.deepEqual(selectionFor(null, H2, 71, back).selectedPages, [], 'a remembered selection of another file is never used');
  const prev: PageSelection = { fileHash: H1, totalPages: 71, selectedPages: [3] };
  assert.deepEqual(selectionFor(prev, H1, 71, back).selectedPages, [3], 'what the person has now wins');
});

test('remembered selection: nothing is saved for a name+size fallback key or an empty selection; damaged or out-of-range data is ignored; a broken store does not throw', () => {
  const st = memoryStore();
  rememberSelection(st, { fileHash: 'nohash:plan.pdf:100:5', totalPages: 5, selectedPages: [1] });
  rememberSelection(st, { fileHash: H1, totalPages: 5, selectedPages: [] });
  assert.equal(st.data.size, 0);
  st.setItem('structboq.pageSelection.v1:' + H1, '{not json');
  assert.equal(recallSelection(st, H1, 5), null);
  st.setItem('structboq.pageSelection.v1:' + H1, JSON.stringify({ totalPages: 5, pages: [9, 3, 3, 0, 'x', 2.5, 1] }));
  assert.deepEqual(recallSelection(st, H1, 5)!.selectedPages, [1, 3]);
  const broken: SelectionStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => rememberSelection(broken, { fileHash: H1, totalPages: 5, selectedPages: [1] }));
  assert.equal(recallSelection(broken, H1, 5), null);
  assert.equal(recallSelection(undefined, H1, 5), null);
});
