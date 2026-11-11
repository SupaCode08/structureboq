/** Offload vector stroke rasterization off the main thread: { id, polys, widthPt, heightPt, scale, pen, rotate } in, raster out. */
import { rasterize } from './vectorText';

self.onmessage = (e: MessageEvent) => {
  const { id, polys, widthPt, heightPt, scale, pen, rotate } = e.data || {};
  if (!id) return;
  try {
    const r = rasterize(polys, widthPt, heightPt, scale, pen, rotate);
    (self as unknown as Worker).postMessage(
      { id, data: r.data, width: r.width, height: r.height },
      [r.data.buffer],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
