/**
 * Pages of one PDF chosen for reading. Page numbers are the PDF's own, 1-based, everywhere (shown to people,
 * passed to the pipeline, kept in provenance); the selection belongs to one file by its SHA-256.
 */
export interface PageSelection {
  fileHash: string;
  totalPages: number;
  /** original 1-based page numbers, ascending, no repeats */
  selectedPages: number[];
}

const all = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** The selection for this file: the previous one only if it is for the same bytes, else the remembered one, else nothing selected. */
export const selectionFor = (prev: PageSelection | null, fileHash: string, totalPages: number, remembered?: PageSelection | null): PageSelection =>
  prev && prev.fileHash === fileHash && prev.totalPages === totalPages ? prev : remembered && remembered.fileHash === fileHash && remembered.totalPages === totalPages ? remembered : { fileHash, totalPages, selectedPages: [] };

export const selectAll = (s: PageSelection): PageSelection => ({ ...s, selectedPages: all(s.totalPages) });
export const deselectAll = (s: PageSelection): PageSelection => ({ ...s, selectedPages: [] });
export const invert = (s: PageSelection): PageSelection => ({ ...s, selectedPages: all(s.totalPages).filter(p => !s.selectedPages.includes(p)) });
export function toggle(s: PageSelection, page: number): PageSelection {
  if (!Number.isInteger(page) || page < 1 || page > s.totalPages) return s;
  const on = s.selectedPages.includes(page);
  return { ...s, selectedPages: on ? s.selectedPages.filter(p => p !== page) : [...s.selectedPages, page].sort((a, b) => a - b) };
}
export const canProcess = (s: PageSelection) => s.selectedPages.length > 0;
/** the pipeline's page spec ("2,5"): original page numbers, never positions in the selection */
export const toPageSpec = (s: PageSelection) => s.selectedPages.join(',');

/** the part of window.localStorage used here, so tests can pass a plain object */
export interface SelectionStore { getItem(k: string): string | null; setItem(k: string, v: string): void }
const storeKey = (fileHash: string) => `structboq.pageSelection.v1:${fileHash}`;
// only a real content hash names a file: a name+size fallback key could match a different drawing
const isHash = (h: string) => /^[0-9a-f]{64}$/.test(h);

/** Remember the pages chosen for processing, by the file's bytes. A full or blocked store is not an error. */
export function rememberSelection(store: SelectionStore | undefined, s: PageSelection): void {
  if (!store || !isHash(s.fileHash) || !s.selectedPages.length) return;
  try { store.setItem(storeKey(s.fileHash), JSON.stringify({ totalPages: s.totalPages, pages: s.selectedPages })); } catch { /* private window or quota: next open starts empty */ }
}

/** The pages chosen the last time this exact file was processed, or null (nothing saved, other page count, damaged data). */
export function recallSelection(store: SelectionStore | undefined, fileHash: string, totalPages: number): PageSelection | null {
  if (!store || !isHash(fileHash)) return null;
  try {
    const raw = store.getItem(storeKey(fileHash));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v?.totalPages !== totalPages || !Array.isArray(v.pages)) return null;
    const pages = [...new Set<number>(v.pages.filter((p: unknown): p is number => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= totalPages))].sort((a, b) => a - b);
    return pages.length ? { fileHash, totalPages, selectedPages: pages } : null;
  } catch { return null; }
}
