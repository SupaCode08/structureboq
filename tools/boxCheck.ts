/**
 * Checks the boxes the reader draws on a page against the page's own OCR words — no answer key, so it runs on any set.
 * It sees only what OCR saw: a glyph OCR missed or misread is invisible to it.
 *   badTag      the tag is not a member name (a whole OCR line, stray text)
 *   unanchored  a label box (no box_src) with no word of its tag at it: the box is away from its label
 *   guess       a box placed by spacing, not seen on the page (box_src 'guess')
 *   titleBlock  the box sits by title-block words (date, sheet no., scale): not a member
 */
import type { SheetReading } from '../src/engine/sheetMerge.ts';

export interface Word { text: string; x0: number; y0: number; x1: number; y1: number }
export type BoxProblem = 'badTag' | 'unanchored' | 'titleBlock' | 'guess';
export interface BoxFinding { page: number; tag: string; kind: 'instance' | 'section'; problem: BoxProblem; box: number[] }

const PART = /^(?:[A-Z]{1,4}\d{0,3}[A-Z]?'?|[A-Z]{1,3}\d*\.?\d+(?:X\d*\.?\d+){1,2}|[CF]\?)$/;
export const isMemberTag = (tag: string) => tag.toUpperCase().split(',').every(p => PART.test(p.trim()) && p.trim() === p);
const TITLE = /^(?:วัน|เดือน|ปี|แผ่นที่|มาตราส่วน|ผู้ออกแบบ|ผู้ตรวจ|ผู้เขียน|เขียนแบบ|ออกแบบ|ตรวจ|อนุมัติ|รวม|SHEET|SCALE|DATE|DRAWN|CHECKED|APPROVED|DWG)/i;
// look-alikes folded together: a tag the reader repaired ("Cl" → C1) still finds its word
const FOLD: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', T: '1', J: '1', '!': '1', '|': '1', Z: '2', S: '5', $: '5', G: '6', B: '8', 3: '8' };
export const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.?!|$]/g, '').replace(/[ODQILTJ!|ZS$GB3]/g, c => FOLD[c]);

export function checkBoxes(readings: SheetReading[], wordsOf: (page: number) => Word[]): BoxFinding[] {
  const out: BoxFinding[] = [];
  for (const r of readings) {
    const words = wordsOf(r.page);
    const items = [...r.instances.map(i => ({ ...i, kind: 'instance' as const })), ...r.sections.map(s => ({ ...s, kind: 'section' as const }))];
    for (const it of items) {
      if (!it.box_2d) continue;
      const [y0, x0, y1, x1] = it.box_2d.map(v => v / 1000);
      const add = (problem: BoxProblem) => out.push({ page: r.page, tag: it.tag, kind: it.kind, problem, box: it.box_2d! });
      if (!isMemberTag(it.tag)) add('badTag');
      if (it.box_src === 'guess') add('guess');
      const h = y1 - y0;
      const first = clean(it.tag.split(',')[0]);
      if (!it.box_src && !words.some(o => {
        const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
        return cx >= x0 - h && cx <= x1 + h && cy >= y0 - h && cy <= y1 + h && clean(o.text).includes(first);
      })) add('unanchored');
      const near = 0.03;
      if (words.some(o => TITLE.test(o.text.trim()) && o.x1 > x0 - near && o.x0 < x1 + near && o.y1 > y0 - near && o.y0 < y1 + near)) add('titleBlock');
    }
  }
  return out;
}
