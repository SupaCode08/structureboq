/**
 * Word-level comparison of an OCR run against a saved baseline (tools/, test use only).
 * A word is [band, text, conf, x0, y0, x1, y1, vertical(1/0)] with boxes normalized to the band raster.
 *
 * Tolerances (stated, not tuned):
 *  - MATCH_DIST 0.01: a run word is the same word as a baseline word in the same band when their box
 *    centres are within 0.01 (≈ 30 px on a 3000 px raster); nearest first, each word used once.
 *  - POS_TOL 2e-6: box corners may differ by rounding only (baselines are stored to 1e-6).
 *  - CONF_TOL 0: confidence is an integer 0–100 and must be equal.
 *  - text and orientation must be equal.
 */
export type Word = [number, string, number, number, number, number, number, number];
export const MATCH_DIST = 0.01, POS_TOL = 2e-6, CONF_TOL = 0;

export interface WordDiff {
  added: Word[]; removed: Word[];
  textChanged: [Word, Word][]; confChanged: [Word, Word][]; posChanged: [Word, Word][]; orientationChanged: [Word, Word][];
  identical: boolean;
}

const centre = (w: Word) => [(w[3] + w[5]) / 2, (w[4] + w[6]) / 2];

export function compareWords(baseline: Word[], run: Word[]): WordDiff {
  const pairs: { b: number; r: number; d: number }[] = [];
  baseline.forEach((b, i) => run.forEach((r, j) => {
    if (b[0] !== r[0]) return;
    const [bx, by] = centre(b), [rx, ry] = centre(r), d = Math.hypot(bx - rx, by - ry);
    if (d <= MATCH_DIST) pairs.push({ b: i, r: j, d });
  }));
  // nearest first; prefer the same text at the same distance so duplicates ("3.50" twice) pair cleanly
  pairs.sort((p, q) => p.d - q.d || Number(baseline[q.b][1] === run[q.r][1]) - Number(baseline[p.b][1] === run[p.r][1]));
  const usedB = new Set<number>(), usedR = new Set<number>(), matched: [Word, Word][] = [];
  for (const p of pairs) {
    if (usedB.has(p.b) || usedR.has(p.r)) continue;
    usedB.add(p.b); usedR.add(p.r); matched.push([baseline[p.b], run[p.r]]);
  }
  const diff: WordDiff = {
    added: run.filter((_, j) => !usedR.has(j)),
    removed: baseline.filter((_, i) => !usedB.has(i)),
    textChanged: matched.filter(([b, r]) => b[1] !== r[1]),
    confChanged: matched.filter(([b, r]) => Math.abs(b[2] - r[2]) > CONF_TOL),
    posChanged: matched.filter(([b, r]) => [3, 4, 5, 6].some(k => Math.abs((b[k] as number) - (r[k] as number)) > POS_TOL)),
    orientationChanged: matched.filter(([b, r]) => b[7] !== r[7]),
    identical: false,
  };
  diff.identical = !diff.added.length && !diff.removed.length && !diff.textChanged.length && !diff.confChanged.length && !diff.posChanged.length && !diff.orientationChanged.length;
  return diff;
}

export function summarize(d: WordDiff) {
  return `added ${d.added.length}, removed ${d.removed.length}, text changed ${d.textChanged.length}, conf changed ${d.confChanged.length}, position changed ${d.posChanged.length}, orientation changed ${d.orientationChanged.length} → ${d.identical ? 'IDENTICAL' : 'DIFFERENT'}`;
}
