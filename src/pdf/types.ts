/** Positioned text on a PDF page, in PDF points with a top-left origin. */
export interface TextItem {
  str: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** box on the page as displayed (rotation applied), normalized 0..1 */
  nb?: [number, number, number, number];
}

export interface PageText {
  page: number;          // 1-based
  width: number;         // points
  height: number;
  items: TextItem[];
  legacyFont: boolean;   // items already decoded when true
  /** text came from OCR (Thai outline fonts): parser tolerates OCR noise */
  ocr?: boolean;
  /** row grouping tolerance in pt (OCR'd Thai lines need more) */
  rowTolerance?: number;
}

/** OCR word in normalized page coordinates (0..1). */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  vertical: boolean;     // read from the 90°-rotated image
  conf: number;          // 0..100
}

export interface PageOcr {
  page: number;
  width: number;         // points (for scale)
  height: number;
  words: OcrWord[];
  /** rectangles drawn on the sheet, normalized 0..1 (vector sheets only) */
  rects?: [number, number, number, number][];
  /** horizontal line segments, normalized x0, y, x1 (vector sheets only) */
  hsegs?: [number, number, number][];
  /** vertical line segments, normalized x, y0, y1 */
  vsegs?: [number, number, number][];
  /** circles (grid bubbles), normalized centre x, y and diameter (as fraction of page width) */
  circles?: [number, number, number][];
}

/** Minimal surface of a pdf.js page we use, so the same code runs in Node and the browser. */
export interface PdfJsTextContent {
  items: { str?: string; transform?: number[]; width?: number; height?: number }[];
}
