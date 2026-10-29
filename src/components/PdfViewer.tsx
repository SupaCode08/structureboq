import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, ZoomIn, ZoomOut, Scan, Crosshair } from 'lucide-react';

export type Box = [number, number, number, number]; // x0, y0, x1, y1 as page fractions

export interface Overlay {
  box: Box;
  /** 'focus' = the value being checked, 'context' = other readings on the page */
  kind: 'focus' | 'context' | 'geometry';
  label?: string;
  memberType?: string;
  onClick?: () => void;
}

interface PdfViewerProps {
  page: number;
  /** renders a page at a dpi, returns an image URL */
  pageUrl: (page: number, dpi: number) => Promise<string>;
  overlays?: Overlay[];
  /** box to zoom to when opened (defaults to the first focus overlay) */
  focusBox?: Box;
  height?: number | string;
  /** extra controls shown at the left of the toolbar */
  toolbarLeft?: React.ReactNode;
}

interface View { s: number; tx: number; ty: number }

/**
 * A drawing page you can read like paper: drag to pan, wheel or buttons to zoom,
 * "จุดที่อ่าน" jumps to the read region, "ทั้งแผ่น" fits the sheet, and the full-screen button
 * opens the same page over the whole window. The page is re-rendered sharper as you zoom in.
 */
export const PdfViewer: React.FC<PdfViewerProps> = props => {
  const [full, setFull] = useState(false);
  const body = <ViewerBody {...props} full={full} onToggleFull={() => setFull(f => !f)} />;
  if (!full) return body;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-slate-900/70 p-3 sm:p-6 flex" onClick={() => setFull(false)}>
      <div className="flex-1 bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <ViewerBody {...props} height="100%" full onToggleFull={() => setFull(false)} />
      </div>
    </div>,
    document.body,
  );
};

const ViewerBody: React.FC<PdfViewerProps & { full: boolean; onToggleFull: () => void }> = ({
  page, pageUrl, overlays = [], focusBox, height = 520, toolbarLeft, full, onToggleFull,
}) => {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [img, setImg] = useState<{ url: string; ar: number; dpi: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const target = focusBox || overlays.find(o => o.kind === 'focus')?.box;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [full]);

  // Base render, then a sharper one when zoomed in (capped so a large A1 sheet stays within memory)
  const wantDpi = view.s > 3.5 ? 300 : view.s > 1.6 ? 200 : 110;
  useEffect(() => { setImg(null); setFailed(false); }, [page, pageUrl]);
  useEffect(() => {
    let alive = true;
    if (img && img.dpi >= wantDpi) return;
    const dpi = img ? wantDpi : 110;
    pageUrl(page, dpi).then(url => {
      const im = new Image();
      im.onload = () => {
        if (!alive) return;
        // keep sharp renders within ~45 MP
        if (im.width * im.height > 45e6 && dpi > 110) return;
        setImg({ url, ar: im.height / im.width, dpi });
      };
      im.src = url;
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [page, pageUrl, wantDpi, img?.dpi]);

  const fit = useCallback((): View => {
    if (!img || !size.w) return { s: 1, tx: 0, ty: 0 };
    const s = Math.min(1, size.h / (img.ar * size.w));
    return { s, tx: (size.w - size.w * s) / 2, ty: (size.h - size.w * img.ar * s) / 2 };
  }, [img?.ar, size.w, size.h]);

  const focusOn = useCallback((b?: Box): View => {
    if (!img || !size.w || !b) return fit();
    const bw = Math.max(0.01, b[2] - b[0]), bh = Math.max(0.01, b[3] - b[1]);
    // the read spot takes ~1/6 of the view so the grid and neighbours around it stay visible
    const s = Math.min(6, Math.max(1, 0.16 * Math.min(1 / bw, size.h / (bh * img.ar * size.w))));
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return { s, tx: size.w / 2 - cx * size.w * s, ty: size.h / 2 - cy * size.w * img.ar * s };
  }, [img?.ar, size.w, size.h, fit]);

  // Open at the read region whenever the page or the target changes
  // Until the user pans or zooms, keep the view on the read spot as the page image and box size settle
  const userMoved = useRef(false);
  const spot = `${page}:${target?.join(',')}`;
  useEffect(() => { userMoved.current = false; }, [spot]);
  useEffect(() => {
    if (img && size.w && !userMoved.current) setView(target ? focusOn(target) : fit());
  }, [spot, img?.ar, img?.dpi, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (factor: number, px = size.w / 2, py = size.h / 2) => {
    userMoved.current = true;
    setView(v => {
      const s = Math.min(20, Math.max(0.3, v.s * factor));
      const k = s / v.s;
      return { s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
    });
  };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [size.w, size.h]);

  const pw = size.w * view.s, ph = img ? size.w * img.ar * view.s : 0;
  const btn = 'h-8 min-w-8 px-2 inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-medium';

  return (
    <div className="flex flex-col min-h-0" style={{ height: full ? '100%' : undefined }}>
      <div className="flex items-center gap-1.5 flex-wrap px-2 py-1.5 border-b border-slate-200 bg-slate-50">
        {toolbarLeft}
        <span className="ml-auto text-xs text-slate-500 tabular-nums">หน้า {page} · {Math.round(view.s * 100)}%</span>
        <button className={btn} onClick={() => zoomAt(1 / 1.4)} title="ย่อ"><ZoomOut className="w-4 h-4" /></button>
        <button className={btn} onClick={() => zoomAt(1.4)} title="ขยาย"><ZoomIn className="w-4 h-4" /></button>
        {target && <button className={btn} onClick={() => { userMoved.current = false; setView(focusOn(target)); }}><Crosshair className="w-4 h-4" />จุดที่อ่าน</button>}
        <button className={btn} onClick={() => { userMoved.current = true; setView(fit()); }}><Scan className="w-4 h-4" />ทั้งแผ่น</button>
        <button className={btn} onClick={onToggleFull} title={full ? 'ย่อกลับ' : 'เต็มจอ'}>
          {full ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>
      <div
        ref={wrap}
        className={`relative overflow-hidden bg-slate-200 select-none touch-none cursor-grab active:cursor-grabbing ${full ? "flex-1" : ""}`}
        style={{ height: full ? undefined : height }}
        onPointerDown={e => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
        }}
        onPointerMove={e => {
          const d = drag.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) { d.moved = true; userMoved.current = true; }
          setView(v => ({ ...v, tx: d.tx + e.clientX - d.x, ty: d.ty + e.clientY - d.y }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={e => {
          const r = wrap.current!.getBoundingClientRect();
          zoomAt(2, e.clientX - r.left, e.clientY - r.top);
        }}
      >
        {img && (
          <div className="absolute top-0 left-0 shadow-md bg-white" style={{ width: pw, height: ph, transform: `translate(${view.tx}px, ${view.ty}px)` }}>
            <img src={img.url} alt={`หน้า ${page}`} draggable={false} className="w-full h-full block" />
            {overlays.map((o, i) => {
              const [x0, y0, x1, y1] = o.box;
              // Distinct high-contrast colors per member type
              const typeCls = o.memberType === 'COLUMN'
                ? {
                    border: o.kind === 'focus' ? 'border-2 border-amber-500 bg-amber-400/25 ring-2 ring-amber-300' : 'border border-amber-600/80 bg-amber-400/15',
                    badge: 'bg-amber-600 text-white',
                    label: 'เสา C'
                  }
                : o.memberType === 'FOOTING'
                ? {
                    border: o.kind === 'focus' ? 'border-2 border-emerald-600 bg-emerald-500/25 ring-2 ring-emerald-300' : 'border border-emerald-600/80 bg-emerald-400/15',
                    badge: 'bg-emerald-700 text-white',
                    label: 'ฐานราก F'
                  }
                : o.memberType === 'BEAM'
                ? {
                    border: o.kind === 'focus' ? 'border-2 border-blue-600 bg-blue-500/25 ring-2 ring-blue-300' : 'border border-blue-600/80 bg-blue-400/15',
                    badge: 'bg-blue-600 text-white',
                    label: 'คาน B'
                  }
                : o.memberType === 'SLAB'
                ? {
                    border: o.kind === 'focus' ? 'border-2 border-purple-600 bg-purple-500/25 ring-2 ring-purple-300' : 'border border-purple-600/80 bg-purple-400/15',
                    badge: 'bg-purple-700 text-white',
                    label: 'พื้น S'
                  }
                : o.memberType === 'WALL'
                ? {
                    border: o.kind === 'focus' ? 'border-2 border-orange-600 bg-orange-500/25 ring-2 ring-orange-300' : 'border border-orange-600/80 bg-orange-400/15',
                    badge: 'bg-orange-700 text-white',
                    label: 'ผนัง WALL'
                  }
                : {
                    border: o.kind === 'focus' ? 'border-2 border-rose-600 bg-rose-500/25 ring-2 ring-rose-300' : 'border border-slate-600/80 bg-slate-400/15',
                    badge: 'bg-rose-600 text-white',
                    label: ''
                  };

              const cls = `${typeCls.border} ${o.kind === 'focus' ? 'z-30 shadow-lg' : 'z-10 hover:z-20'}`;
              return (
                <div
                  key={i}
                  className={`absolute rounded-[2px] transition-all ${cls} ${o.onClick ? 'cursor-pointer' : 'pointer-events-none'}`}
                  style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }}
                  onClick={o.onClick && (e => { if (!drag.current?.moved) { e.stopPropagation(); o.onClick!(); } })}
                  title={o.label}
                >
                  {o.label && view.s >= 1.1 && (
                    <span className={`absolute left-0 -top-5 whitespace-nowrap px-1.5 py-0.5 rounded shadow-sm text-[10px] leading-3 font-bold tracking-tight ${typeCls.badge}`}>
                      {o.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!img && !failed && <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">กำลังเปิดหน้า {page}…</div>}
        {failed && <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">เปิดหน้านี้ไม่ได้ — โหลดไฟล์แบบอีกครั้ง</div>}
      </div>
    </div>
  );
};
