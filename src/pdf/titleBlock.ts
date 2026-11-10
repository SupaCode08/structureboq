import type { Polyline } from './vectorText';

// The corner is the same 24% x 15% the old crop used.
export function titleBlockStrokes(small: Polyline[], widthPt: number, heightPt: number): { polys: Polyline[]; widthPt: number; heightPt: number } {
  const x0 = 0.76 * widthPt;
  const y0 = 0.85 * heightPt;
  const polys = small
    .filter(pts => pts.length > 0 && pts.every(([x, y]) => x >= x0 && y >= y0))
    .map(pts => pts.map(([x, y]) => [x - x0, y - y0] as [number, number]));
  return { polys, widthPt: 0.24 * widthPt, heightPt: 0.15 * heightPt };
}

export function titleBlockVerdict(texts: string[]): { id?: string; skip: boolean; structural: boolean } {
  const ids: string[] = [];
  for (const text of texts) {
    const t = text.replace(/[—–]/g, '-').toUpperCase().trim();
    const m = t.match(/^([A-Z]{1,2})-?(\d{2})$/);
    if (m) ids.push(`${m[1]}-${m[2]}`);
  }
  const structural = ids.some(id => /^S-\d{2}$/.test(id));
  const skipPrefix = /^(A|EE|E|SN|ID|L)-/;
  const skip = !structural && ids.some(id => skipPrefix.test(id));
  const id = skip
    ? ids.find(i => skipPrefix.test(i))
    : structural
      ? ids.find(i => /^S-\d{2}$/.test(i))
      : undefined;
  return { id, skip, structural };
}

export function sheetCodeVerdict(norm: string): { kind: 'index' | 'nonstruct' | 'struct' | 'none'; id?: string } {
  const reNon = /(?:^|[^A-Z0-9])(A|AR|ARCH|EE|E|SN|SAN|M|ME|AC|ID|L)([-_ =]*)(\d{1,2})(?:[^0-9]|$)/g;
  const reStr = /(?:^|[^A-Z0-9])(S|ST|STR|5)([-_ =]*)(\d{1,2})(?:[^0-9]|$)/g;
  const parse = (re: RegExp, isStr: boolean) =>
    Array.from(norm.matchAll(re))
      .filter(m => /[-_=]/.test(m[2]) || (m[1] !== '5' && m[3].length >= 2))
      .map(m => ({
        id: `${isStr && m[1] === '5' ? 'S' : m[1]}-${String(Number(m[3])).padStart(2, '0')}`,
        dashed: /[-_=]/.test(m[2]),
      }));
  const non = parse(reNon, false);
  const str = parse(reStr, true);
  if (non.length > 0 && str.length === 0) return { kind: 'nonstruct', id: non[0].id };
  if (str.length > 0 && non.length === 0) return { kind: 'struct', id: str[0].id };
  if (non.length === 0 && str.length === 0) return { kind: 'none' };
  const dNon = non.find(m => m.dashed);
  const dStr = str.find(m => m.dashed);
  if (dNon && !dStr) return { kind: 'nonstruct', id: dNon.id };
  if (dStr && !dNon) return { kind: 'struct', id: dStr.id };
  return { kind: 'index' };
}

/** distinct long vertical rules (at least half the page height) in the right 30% of the page: a title-block frame has 2-4, a table page like a BOQ has 6 or more */
export function rightColumnRules(vsegs: [number, number, number][], widthPt: number, heightPt: number): number {
  const cols = new Set<number>();
  for (const [x, y0, y1] of vsegs) {
    if (y1 - y0 >= 0.5 * heightPt && x > 0.7 * widthPt) cols.add(Math.round((x / widthPt) * 100));
  }
  return cols.size;
}

