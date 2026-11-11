/** Offload scanned page preparation off the main thread: { id, gray, W, H, pageLongPt, rotate90 } in, raster out. */
import { prepareEmbeddedScan } from './scanPrep';

self.onmessage = (e: MessageEvent) => {
  const { id, gray, W, H, pageLongPt, rotate90 } = e.data || {};
  if (!id) return;
  try {
    const res = prepareEmbeddedScan(gray, W, H, pageLongPt, rotate90);
    // transfer the raster's ArrayBuffer to avoid copying large prepared scans
    (self as unknown as Worker).postMessage(
      { id, raster: res.raster, width: res.width, height: res.height, lines: res.lines, circles: res.circles },
      [res.raster.data.buffer],
    );
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
