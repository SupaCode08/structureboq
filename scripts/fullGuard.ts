/**
 * Scripts that open real drawing PDFs, run OCR, or run the whole reader on real drawing sets are slow
 * and verbose. They run only when asked for explicitly: FULL_BOQ=1. Unit tests (`npm test`) never need them.
 */
export function requireFullBoq(what: string) {
  if (process.env.FULL_BOQ === '1') return;
  console.error(`${what}: processes real drawing sets. Run again with FULL_BOQ=1 to confirm (e.g. FULL_BOQ=1 npm run check:full).`);
  process.exit(2);
}
