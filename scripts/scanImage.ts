/** Scanned page -> prepared raster for OCR (Node), shared by offline_ocr.ts and add_rects.ts. */
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { grayPng } from './png.ts';
import { imageGray } from '../src/pdf/imageBoxes.ts';
import { orientScan, prepareEmbeddedScan } from '../src/pdf/scanPrep.ts';

/** Largest embedded image of a scanned page as a grayscale raster (rotated with the page). */
export async function embeddedImage(page: any, rotate90: boolean, prepared = true) {
  const ops = await page.getOperatorList();
  const vt = page.getViewport({ scale: 1 }).transform;
  type M = number[];
  const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  let ctm: M = vt; const stack: M[] = [];
  let best: any = null; let bestM: M = vt;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
    if (fn !== OPS.paintImageXObject) continue;
    const name = ops.argsArray[i][0];
    const img: any = await new Promise(res => page.objs.get(name, res));
    if (img && (!best || img.width * img.height > best.width * best.height)) { best = img; bestM = ctm; }
  }
  if (!best?.data) return null;
  const { width: w, height: h } = best;
  let gray = imageGray(best)!;
  const dg = Number(process.env.DEGRADE || 1);
  let w0 = w, h0 = h;
  if (dg > 1) {
    const W2 = Math.floor(w / dg), H2 = Math.floor(h / dg), g2 = new Uint8Array(W2 * H2);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      let sum = 0;
      for (let j = 0; j < dg; j++) for (let i = 0; i < dg; i++) sum += gray[(y * dg + j) * w + x * dg + i];
      g2[y * W2 + x] = sum / (dg * dg);
    }
    gray = g2; w0 = W2; h0 = H2;
  }
  const [dx, dy] = [bestM[0], bestM[1]];
  const base = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 180) : (dy > 0 ? 90 : 270);
  const oriented = orientScan(gray, w0, h0, base, rotate90);
  gray = oriented.gray;
  const { width: W, height: H } = oriented;
  if (!prepared) return { image: grayPng(gray, W, H), width: W, height: H };
  const vp1 = page.getViewport({ scale: 1 });
  const r = prepareEmbeddedScan(gray, W, H, Math.max(vp1.width, vp1.height), rotate90, {
    dpi: Number(process.env.SCAN_DPI || 400),
    raw: !!process.env.SCAN_RAW,
    noDeskew: !!process.env.NO_DESKEW,
    keepLines: !!process.env.KEEP_LINES,
    lineMm: Number(process.env.LINE_MM || 5),
  });
  const { raster, width, height, lines, circles } = r;
  // The raster is already turned, so the caller must not turn the words again (same as embeddedScanForOcr in the browser)
  return { image: grayPng(r.raster.data, r.width, r.height), width, height, skew: 0, lines, circles, raster };
}

