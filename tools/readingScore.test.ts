/** Round 24 Phase 0: per-field reading score with category and member-type breakdown (synthetic key and members). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreReading, tallyText, normBars, type AnswerKey } from './readingScore.ts';
import type { ExtractedMember } from '../src/engine/qsEngine.ts';
import type { SheetReading } from '../src/engine/sheetMerge.ts';

const key: AnswerKey = {
  split: 'dev', grid: { x: [0, 3.6], y: [0, 2.7] },
  members: [
    { tag: 'F1', type: 'FOOTING', count: 2, width: 1.2, depth: 1.2, thickness: 0.3, bottomRebar: '6-DB12' },
    { tag: 'C1', type: 'COLUMN', width: 0.2, depth: 0.2, mainRebar: '4-DB12', stirrup: 'RB6@0.20' },
    { tag: 'GB9', type: 'BEAM', width: 0.2, depth: 0.4 },
  ],
};
const readings = [{ page: 3, sheet_type: 'footing_plan', grid: { x: [{ label: '1', offset_m: 0 }, { label: '2', offset_m: 3.6 }], y: [{ label: 'A', offset_m: 0 }] }, instances: [], sections: [] }] as unknown as SheetReading[];
const m = (p: Partial<ExtractedMember>) => ({ unit: 'm', count: 1, ...p }) as ExtractedMember;
const members = [
  m({ tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 1.5, length: 0.3, bottomRebar: '6-DB12' }),
  m({ tag: 'F1', memberType: 'FOOTING', width: 1.2, depth: 1.5, length: 0.3, bottomRebar: '6-DB12' }),
  m({ tag: 'C1', memberType: 'COLUMN', width: 0.2, depth: 0.2, length: 3, topRebar: '4-DB12', stirrupRebar: '' }),
];

test('each field is right, wrong or missing, and counted under its category and member type', () => {
  const s = scoreReading(key, readings, members);
  // grid x right, grid y wrong; footing total count 2 right; F1: tag, count, width right, depth WRONG, thickness, bars right;
  // C1: tag, width, depth, bars right, stirrup missing; GB9 not found (missing)
  assert.deepEqual([s.right, s.wrong, s.missing, s.total], [11, 2, 2, 15]);
  assert.deepEqual(s.byCategory, {
    grid: { right: 1, wrong: 1, missing: 0 }, tag: { right: 2, wrong: 0, missing: 1 }, count: { right: 2, wrong: 0, missing: 0 },
    dimension: { right: 4, wrong: 1, missing: 0 }, rebar: { right: 2, wrong: 0, missing: 1 },
  });
  assert.deepEqual(s.byType.FOOTING, { right: 6, wrong: 1, missing: 0 });
  assert.deepEqual(s.byType.COLUMN, { right: 4, wrong: 0, missing: 1 });
  assert.deepEqual(s.byType.BEAM, { right: 0, wrong: 0, missing: 1 });
  assert.equal([s.byCategory, s.byType].map(b => Object.values(b).reduce((a, t) => a + t.right + t.wrong + t.missing, 0)).join(), '15,15');
  assert.ok(s.notes.includes('F1 ลึก/ยาว: ผิด — ระบบ 1.5 แบบ 1.2'));
  assert.ok(s.notes.includes('GB9: ไม่พบเบอร์นี้เลย'));
  assert.equal(s.tagsFound, 2);
  assert.equal(tallyText(s.byCategory.dimension), 'ถูก 80% · ผิด 20% · ไม่พบ 0% (5)');
});

test('bar notation compares as written sets', () => {
  assert.equal(normBars('3-RB12+2-DB16'), normBars('2-DB16+3-RB12'));
  assert.equal(normBars('Ø12@0.15'), normBars('RB12@0.15'));
  assert.notEqual(normBars('4-DB12'), normBars('4-DB16'));
});

test('every beam instance length is checked against the key grid by offset; what the grid cannot check is counted apart', async () => {
  const { scoreLengths } = await import('./readingScore.ts');
  const k: AnswerKey = { grid: { x: [0, 2.7, 4.2], y: [0, 3.6] }, members: [{ tag: 'B2', type: 'BEAM' }, { tag: 'BX', type: 'BEAM', remark: 'คานเฉียงรับบันได' }] };
  const g = (xs: number[], ys: number[]) => ({ x: xs.map((o, i) => ({ label: String(i + 1), offset_m: o })), y: ys.map((o, i) => ({ label: 'ABCD'[i], offset_m: o })) });
  const sheets = [
    { page: 27, sheet_type: 'framing_plan', level: 'ชั้น 1', grid: g([0, 2.7, 4.2], [0, 3.6]), instances: [], sections: [] },
    // floor 2: the reader added a sub-line at 1.13 m, so its label 3 is the key's line 2 (2.7 m)
    { page: 28, sheet_type: 'framing_plan', level: 'ชั้น 2', grid: g([0, 1.13, 2.73, 4.27], [0, 3.62]), instances: [], sections: [] },
  ] as unknown as SheetReading[];
  const b = (tag: string, grid: string, length: number, page = 27) => ({ tag, memberType: 'BEAM', gridLocation: grid, length, sourceSheetOrLayer: 'p' + page, level: page === 27 ? 'ชั้น 1' : 'ชั้น 2', width: 0.2, depth: 0.4, unit: 'm', count: 1 }) as ExtractedMember;
  const r = scoreLengths(k, [
    b('B2', 'A/1–A/2', 2.7),        // row A: 0 → 2.7 → right
    b('B2', 'A/1–B/1', 3.6),        // column 1: 0 → 3.6 → right
    b('B2', 'A/2–A/3', 1.6),        // grid says 1.5 → wrong
    b('B2', 'A/3–A/4', 1.54, 28),   // floor 2: labels 3–4 lie at 2.73 / 4.27, on the key's 2.7 / 4.2 lines → 1.5 → right (by label index it would be 4.2 → beyond)
    b('B2', 'A/2–A/3', 1.6, 28),    // 1.13 is on no key line → unmapped, not wrong
    b('B2', 'A/1–B/2', 4.5),        // diagonal reading of a B2 — never counted right
    b('BX', 'A/2–B/3', 3.0),        // diagonal, and the key says BX is diagonal
    b('B2', '-', 2.7),              // no grid
    b('B2', 'A/1–A/2', 2.7, 99),    // page without a grid → unmapped
    { ...b('S1', 'A/1–B/2', 0.1), memberType: 'SLAB' } as ExtractedMember, // slabs are not beam spans
  ], sheets);
  assert.deepEqual(r.tally, { right: 3, wrong: 1, diagonal: 1, diagonalExpected: 1, unplaced: 1, unmapped: 2 });
  assert.deepEqual(r.rows.find(x => x.cls === 'wrong'), { tag: 'B2', level: 'ชั้น 1', page: 27, from: 'A/2', to: 'A/3', length: 1.6, expected: 1.5, cls: 'wrong' });
});
