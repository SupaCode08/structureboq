import test from 'node:test';
import assert from 'node:assert/strict';
import { laneCount, mapLanes, raceAbort, serialize } from './lanes.ts';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('lanes: results in item order, never more than n at once, every lane id within range', async () => {
  let running = 0, peak = 0;
  const lanesUsed = new Set<number>();
  const got = await mapLanes([30, 5, 20, 1, 10, 2], 3, async (ms, k, lane) => {
    running++; peak = Math.max(peak, running); lanesUsed.add(lane);
    await sleep(ms);
    running--;
    return `${k}:${ms}`;
  });
  assert.deepEqual(got, ['0:30', '1:5', '2:20', '3:1', '4:10', '5:2']);
  assert.ok(peak <= 3 && peak >= 2, `peak ${peak}`);
  assert.ok([...lanesUsed].every(l => l >= 0 && l < 3));
});

test('lanes: one lane equals reading one page at a time; fewer items than lanes is fine; no items is empty', async () => {
  const order: number[] = [];
  await mapLanes([1, 2, 3], 1, async (_, k) => { order.push(k); await sleep(3 - k); });
  assert.deepEqual(order, [0, 1, 2]);
  assert.deepEqual(await mapLanes(['a'], 5, async x => x), ['a']);
  assert.deepEqual(await mapLanes([], 3, async x => x), []);
});

test('lanes: a failing page rejects the whole read', async () => {
  await assert.rejects(mapLanes([1, 2, 3], 2, async x => { if (x === 2) throw new Error('boom'); await sleep(2); return x; }), /boom/);
});

test('lane count: a lane per four cores, 1 to 2, one on small or unknown memory', () => {
  assert.equal(laneCount(12, 8), 2);
  assert.equal(laneCount(8, 8), 2);
  assert.equal(laneCount(8, undefined), 1);
  assert.equal(laneCount(4, 8), 1);
  assert.equal(laneCount(2, 8), 1);
  assert.equal(laneCount(32, 8), 2);
  assert.equal(laneCount(12, 4), 1);
  assert.equal(laneCount(undefined, undefined), 1);
});

test('serialize: jobs started together run one after another, and a failure does not block the next', async () => {
  const alone = serialize();
  let running = 0, peak = 0;
  const job = (ms: number, fail = false) => alone(async () => { running++; peak = Math.max(peak, running); await sleep(ms); running--; if (fail) throw new Error('x'); return ms; });
  const r = await Promise.allSettled([job(10), job(1, true), job(5)]);
  assert.equal(peak, 1);
  assert.deepEqual(r.map(x => x.status), ['fulfilled', 'rejected', 'fulfilled']);
});

test('abort: rejects with AbortError the moment the signal fires even when the read never settles; a finished read is unaffected', async () => {
  const never = new Promise<number>(() => {});
  const ac = new AbortController();
  const raced = raceAbort(never, ac.signal);
  setTimeout(() => ac.abort(), 5);
  await assert.rejects(raced, (e: Error) => e.name === 'AbortError');
  assert.equal(await raceAbort(Promise.resolve(7), new AbortController().signal), 7);
  assert.equal(await raceAbort(Promise.resolve(8)), 8);
  const already = new AbortController(); already.abort();
  await assert.rejects(raceAbort(never, already.signal), (e: Error) => e.name === 'AbortError');
});

test('abort: a read that fails after the abort does not become an unhandled rejection', async () => {
  const ac = new AbortController();
  let rejectRead!: (e: Error) => void;
  const read = new Promise<number>((_, rej) => { rejectRead = rej; });
  const raced = raceAbort(read, ac.signal);
  ac.abort();
  await assert.rejects(raced, (e: Error) => e.name === 'AbortError');
  rejectRead(new Error('late')); // would crash the test run if unhandled
  await sleep(5);
});
