/**
 * Pages read at the same time. Each lane is one full set of OCR workers; lanes take the next unread page,
 * and results come back in page order whatever finished first, so the reading is the same as one page at a time.
 */
export async function mapLanes<T, R>(items: T[], lanes: number, fn: (item: T, index: number, lane: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, items.length)) }, async (_, lane) => {
    for (let k = next++; k < items.length; k = next++) out[k] = await fn(items[k], k, lane);
  }));
  return out;
}

/**
 * Lanes the machine can feed: four OCR workers per lane (~0.5–1 GB), so one lane per four logical cores, at most 2.
 * One lane when memory is under 8 GB or unknown (Firefox and Safari do not report it; Chrome reports at most 8).
 */
export function laneCount(cores: number | undefined, deviceMemoryGB: number | undefined): number {
  if (deviceMemoryGB === undefined || deviceMemoryGB < 8) return 1;
  return Math.max(1, Math.min(2, Math.floor((cores || 4) / 4)));
}

/** Runs the given jobs one at a time even when started together (a scan page's GPU read must not overlap another's). */
export function serialize() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Settles with the read, or rejects with an AbortError the moment the signal fires: a terminated OCR worker never
 * answers the page it was reading, so waiting for the read itself would hang.
 */
export function raceAbort<T>(read: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return read;
  read.catch(() => {}); // the read left behind must not surface later as an unhandled rejection
  return new Promise<T>((resolve, reject) => {
    const stop = () => { const e = new Error('Extraction aborted by user'); e.name = 'AbortError'; reject(e); };
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    read.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}
