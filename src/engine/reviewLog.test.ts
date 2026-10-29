import test from 'node:test';
import assert from 'node:assert/strict';
import { logEntryFor, undoEntry, canUndo, addEntry } from './reviewLog.ts';

const m = (tag: string, extra: any = {}) => ({ tag, memberType: 'FOOTING', gridLocation: 'A/1', count: 1, width: 0.9, depth: 0.9, length: 0, ...extra }) as any;

test('Review log: records before/after, undoes only the latest change on a member', () => {
  const v0 = [m('F1'), m('F1', { gridLocation: 'B/1' }), m('C1')];
  const v1 = v0.map((x, i) => (i < 2 ? { ...x, length: 0.2, review: { status: 'approved', at: 't' } } : x));
  const e1 = logEntryFor(v0, v1, [0, 1], new Date('2026-10-19T10:00:00Z'))!;
  assert.equal(e1.kind, 'edit');
  assert.deepEqual(e1.indices, [0, 1]);
  assert.deepEqual(e1.changes.map(c => [c.label, c.from, c.to]), [['หนา', 0, 0.2]]);
  assert.equal(e1.decision, 'approved');
  assert.equal(logEntryFor(v1, v1, [0]), null);              // nothing changed: no entry

  const v2 = v1.map((x, i) => (i === 0 ? { ...x, length: 0.25 } : x));
  const e2 = logEntryFor(v1, v2, [0], new Date('2026-10-19T10:05:00Z'))!;
  const log = [e1, e2];
  assert.equal(canUndo(e1, 3, log), false);                   // a later edit touched member 0
  assert.equal(canUndo(e2, 3, log), true);
  const back = undoEntry(v2, e2);
  assert.equal(back[0].length, 0.2);
  assert.equal(undoEntry(back, e1)[1].length, 0);

  const add = addEntry([m('F9')], 3, 'เพิ่มจากข้อเสนอ', new Date('2026-10-19T10:10:00Z'));
  assert.equal(canUndo(add, 4, [...log, add]), true);
  assert.equal(undoEntry([...v2, m('F9')], add).length, 3);
});
