/** Offload vector stroke rasterization (+ optional text-line grouping) off the main thread. */
import { rasterize } from './vectorText';
import { filterTitleBlockBoilerplate, vectorTextLines } from './labelOcr';

self.onmessage = (e: MessageEvent) => {
  const { id, polys, widthPt, heightPt, scale, pen, rotate, withLines } = e.data || {};
  if (!id) return;
  try {
    const lines = withLines ? filterTitleBlockBoilerplate(vectorTextLines(polys), widthPt, heightPt) : undefined;
    const r = rasterize(polys, widthPt, heightPt, scale, pen, rotate);
    (self as unknown as Worker).postMessage(
      { id, data: r.data, width: r.width, height: r.height, lines },
      [r.data.buffer],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
