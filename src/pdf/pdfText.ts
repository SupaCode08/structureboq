/**
 * Converts pdf.js text content into positioned, Thai-repaired text items.
 *
 * Parsing uses the page's own (unrotated) coordinates so table rows stay rows even on
 * pages with /Rotate; every item also carries its box on the page as displayed
 * (normalized 0..1), which is what the evidence viewer highlights.
 */
import type { PageText, PdfJsTextContent, TextItem, PageOcr, OcrWord } from './types';
import { looksLegacyThai, normalizeThai } from './thaiText';

export interface ViewportLike { width: number; height: number; transform: number[] }

const apply = (m: number[], x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function toPageText(page: number, vp: ViewportLike, tc: PdfJsTextContent): PageText {
  const rotated = Math.abs(vp.transform[0]) < 1e-6; // 90° / 270°
  const rawW = rotated ? vp.height : vp.width;
  const rawH = rotated ? vp.width : vp.height;
  const raw = tc.items.filter(i => typeof i.str === 'string' && i.transform);
  const legacy = looksLegacyThai(raw.map(i => i.str).join(''));
  const items: TextItem[] = [];
  for (const i of raw) {
    const s = normalizeThai(i.str!, legacy);
    if (!s.trim()) continue;
    const [a, b, , d, e, f] = i.transform!;
    const size = Math.hypot(b, d) || Math.abs(a) || 10;
    const w = i.width || size * s.length * 0.5;
    const h = i.height || size;
    const p1 = apply(vp.transform, e, f - h * 0.2), p2 = apply(vp.transform, e + w, f + h * 0.8);
    items.push({
      str: s, x0: e, x1: e + w, y0: rawH - f - h * 0.8, y1: rawH - f + h * 0.2,
      nb: [Math.min(p1[0], p2[0]) / vp.width, Math.min(p1[1], p2[1]) / vp.height, Math.max(p1[0], p2[0]) / vp.width, Math.max(p1[1], p2[1]) / vp.height],
    });
  }
  return { page, width: rawW, height: rawH, items, legacyFont: legacy };
}

/** Union of the displayed boxes of some items (normalized). */
export function unionNb(items: TextItem[]): [number, number, number, number] | undefined {
  const b = items.map(i => i.nb).filter(Boolean) as [number, number, number, number][];
  if (!b.length) return undefined;
  return [Math.min(...b.map(x => x[0])), Math.min(...b.map(x => x[1])), Math.max(...b.map(x => x[2])), Math.max(...b.map(x => x[3]))];
}

/** Text lines (items on the same baseline merged left to right), with their boxes. */
export function textLines(pt: PageText): { text: string; bbox: [number, number, number, number]; nb?: [number, number, number, number] }[] {
  const sorted = [...pt.items].sort((p, q) => (p.y0 + p.y1) / 2 - (q.y0 + q.y1) / 2 || p.x0 - q.x0);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs((last[0].y0 + last[0].y1) / 2 - (it.y0 + it.y1) / 2) < 2.5) last.push(it);
    else lines.push([it]);
  }
  return lines.map(l => {
    l.sort((p, q) => p.x0 - q.x0);
    let text = '';
    let prev: number | null = null;
    for (const it of l) {
      if (prev !== null) text += it.x0 - prev > 6 ? ' | ' : it.x0 - prev > 1.5 ? ' ' : '';
      text += it.str;
      prev = it.x1;
    }
    return {
      text,
      bbox: [Math.min(...l.map(i => i.x0)), Math.min(...l.map(i => i.y0)), Math.max(...l.map(i => i.x1)), Math.max(...l.map(i => i.y1))] as [number, number, number, number],
      nb: unionNb(l),
    };
  });
}

/**
 * Text-layer words in the same form OCR produces (normalized display boxes, vertical flag), so a
 * digital PDF goes through the same plan / section reader as a scanned or vector-lettered one.
 */
export function pageTextToOcr(pt: PageText, width: number, height: number): PageOcr {
  const words: OcrWord[] = [];
  for (const it of pt.items) {
    if (!it.nb) continue;
    const [x0, y0, x1, y1] = it.nb;
    const parts = it.str.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const vertical = (y1 - y0) * height > (x1 - x0) * width * 1.3 && it.str.trim().length > 1;
    const total = it.str.length || 1;
    let pos = 0;
    for (const p of parts) {
      const start = it.str.indexOf(p, pos);
      const a = start / total, b = (start + p.length) / total;
      pos = start + p.length;
      words.push(vertical
        // vertical text reads bottom-to-top on drawings
        ? { text: p, x0, x1, y0: y1 - (y1 - y0) * b, y1: y1 - (y1 - y0) * a, vertical: true, conf: 99 }
        : { text: p, x0: x0 + (x1 - x0) * a, x1: x0 + (x1 - x0) * b, y0, y1, vertical: false, conf: 99 });
    }
  }
  return { page: pt.page, width, height, words };
}

/** Which page each reading step actually opened (original 1-based page numbers): the record that a selection was honoured. */
export type ProcessLog = { page: number; step: 'text' | 'stroke-scan' | 'classify' | 'ocr' | 'ocr-cache' | 'text-sheet' }[];
interface TextDoc { numPages: number; getPage(n: number): Promise<{ getViewport(o: { scale: number }): ViewportLike; getTextContent(): Promise<unknown> }> }

/** Text layers by original page number; with a selection, pages outside it are never opened and stay empty. */
export async function readTextLayers(doc: TextDoc, requested: number[] | undefined, log: ProcessLog, onPage?: (page: number, of: number) => void): Promise<PageText[]> {
  const want = requested && new Set(requested);
  const texts: PageText[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (want && !want.has(i)) { texts.push({ page: i, width: 0, height: 0, items: [], legacyFont: false }); continue; }
    onPage?.(i, doc.numPages);
    const page = await doc.getPage(i);
    texts.push(toPageText(i, page.getViewport({ scale: 1 }), (await page.getTextContent()) as PdfJsTextContent));
    log.push({ page: i, step: 'text' });
  }
  return texts;
}

/** Where reading a file spent its time; heap only where the browser reports it (Chrome), never estimated. */
export interface PageTiming {
  totalMs: number;
  phases: Record<string, number>;
  perPage: { page: number; how: string; ms: number }[];
  ocrPages: number;
  cachedPages: number;
  medianOcrMs: number | null;
  p90OcrMs: number | null;
  peakHeapMB: number | null;
}
export function timingSummary(phases: Record<string, number>, perPage: { page: number; how: string; ms: number }[], peakHeapBytes: number | null): PageTiming {
  const ocr = perPage.filter(x => x.how.startsWith('OCR')).map(x => x.ms).sort((a, b) => a - b);
  const q = (f: number) => (ocr.length ? ocr[Math.min(ocr.length - 1, Math.ceil(f * ocr.length) - 1)] : null);
  return {
    totalMs: Math.round(phases.total ?? 0),
    phases: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, Math.round(v)])),
    perPage: perPage.map(({ page, how, ms }) => ({ page, how, ms })),
    ocrPages: ocr.length,
    cachedPages: perPage.filter(x => x.how.startsWith('cache')).length,
    medianOcrMs: q(0.5),
    p90OcrMs: q(0.9),
    peakHeapMB: peakHeapBytes ? Math.round(peakHeapBytes / 1048576) : null,
  };
}
