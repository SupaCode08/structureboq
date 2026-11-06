/**
 * Gate for the OCR that runs today: scripts/check_ocr_current.ts reads the structural pages of the dev sets again with
 * the current code and scores them against the answer keys. This file holds the pure part, so it is tested without PDFs:
 * what is kept as the baseline and how a new run is compared with it. A value that was right and is no longer, or a
 * wrong value that was not there before, fails the gate.
 */
import type { Category, Tally } from './readingScore.ts';

export interface SetScore { right: number; wrong: number; missing: number; byCategory: Record<Category, Tally> }
export interface OcrBaseline {
  /** SHA-256 of the OCR code and engines when this baseline was written (see currentOcrIdentity) */
  ocrId: string;
  generatedAt: string;
  sets: Record<string, SetScore>;
}

const CATEGORIES: Category[] = ['grid', 'tag', 'count', 'dimension', 'rebar'];

/** `failures` make the gate fail; `lines` are everything worth printing, changes included. */
export function compareOcrBaseline(prev: OcrBaseline, now: Record<string, SetScore>, nowOcrId: string): { ok: boolean; failures: string[]; lines: string[] } {
  const failures: string[] = [], lines: string[] = [];
  lines.push(nowOcrId === prev.ocrId ? 'OCR code: same as the baseline' : `OCR code changed since the baseline (${prev.ocrId.slice(0, 8)} → ${nowOcrId.slice(0, 8)})`);
  for (const [name, was] of Object.entries(prev.sets)) {
    const is = now[name];
    if (!is) { failures.push(`${name}: not scored in this run (it is in the baseline)`); continue; }
    const d = (a: number, b: number) => (b - a === 0 ? '±0' : b - a > 0 ? `+${b - a}` : `${b - a}`);
    lines.push(`${name}: right ${was.right} → ${is.right} (${d(was.right, is.right)}) · wrong ${was.wrong} → ${is.wrong} (${d(was.wrong, is.wrong)}) · missing ${was.missing} → ${is.missing} (${d(was.missing, is.missing)})`);
    if (is.wrong > was.wrong) failures.push(`${name}: wrong values rose ${was.wrong} → ${is.wrong}`);
    if (is.right < was.right) failures.push(`${name}: right values fell ${was.right} → ${is.right}`);
    for (const c of CATEGORIES) {
      const a = was.byCategory?.[c], b = is.byCategory?.[c];
      if (a && b && (a.right !== b.right || a.wrong !== b.wrong || a.missing !== b.missing)) lines.push(`  ${c}: right ${a.right} → ${b.right} · wrong ${a.wrong} → ${b.wrong} · missing ${a.missing} → ${b.missing}`);
    }
  }
  for (const name of Object.keys(now)) if (!prev.sets[name]) lines.push(`${name}: new set, no baseline to compare with`);
  return { ok: failures.length === 0, failures, lines };
}

/** the part of a score kept in the baseline file */
export const toSetScore = (s: { right: number; wrong: number; missing: number; byCategory: Record<Category, Tally> }): SetScore =>
  ({ right: s.right, wrong: s.wrong, missing: s.missing, byCategory: s.byCategory });
