/**
 * Who destroys a pdf.js document (ending its pdf.js worker): the app shows documents through slots (drawing, BOQ);
 * a document is destroyed once no slot shows it. One that has not reached a slot yet belongs to the code that
 * loaded it, which destroys it when reading it fails.
 */
export interface Doc { destroy(): Promise<void> }
export type Slot<D> = { current: { doc: D; key: string } | null };

/** Points slot at next; the document it held before is destroyed unless one of slots still shows it. */
export function swapDoc<D extends Doc>(slot: Slot<D>, next: { doc: D; key: string } | null, slots: Slot<D>[]) {
  const old = slot.current?.doc;
  slot.current = next;
  if (old && !slots.some(s => s.current?.doc === old)) void old.destroy();
}

/** Runs use() on a document no slot shows yet; if it throws, the document is destroyed and the error goes on to the caller. */
export async function destroyOnError<T>(doc: Doc, use: () => Promise<T>): Promise<T> {
  try {
    return await use();
  } catch (err) {
    void doc.destroy();
    throw err;
  }
}
