/**
 * A small, fully known PDF for page-selection tests: page k carries the schedule row
 * "F<k> | 1.<k>0 x 1.<k>0 m | 0.30 m | 1 | 6-DB12" in its text layer, so every member names the page it came from.
 * With strokes, each page also gets 260 tiny strokes, which makes the reader treat it as stroke-lettered and OCR it.
 * Built by hand (no PDF library): catalog, pages, one Helvetica font, one content stream per page.
 */
export function makeTestPdf(pageCount: number, opts: { strokes?: boolean; rows?: Record<number, string> } = {}): Uint8Array<ArrayBuffer> {
  const objs: string[] = [];
  const pageIds: number[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let next = 4;
  for (let k = 1; k <= pageCount; k++) {
    const row = opts.rows?.[k] ?? `F${k} | 1.${k}0 x 1.${k}0 m | 0.30 m | 1 | 6-DB12`;
    let content = `BT /F1 28 Tf 60 520 Td (PAGE ${k}) Tj ET\nBT /F1 14 Tf 60 470 Td (${row}) Tj ET\n`;
    if (opts.strokes) {
      content += '0.4 w\n';
      for (let i = 0; i < 260; i++) {
        const x = 60 + (i % 40) * 18, y = 120 + Math.floor(i / 40) * 30;
        content += `${x} ${y} m ${x + 4} ${y + 6} l S\n`;
      }
    }
    const contentId = next++, pageId = next++;
    objs[contentId] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(new TextEncoder().encode(out)); // ASCII only, so string length = byte offset
}
