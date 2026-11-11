/**
 * Choose which pages of a PDF to read, from thumbnails. Thumbnails are drawn by pdf.js only (no OCR, no reader,
 * no calculation), small, one at a time and only once a page scrolls near the view, so a long set stays light.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { PdfDoc } from '../pdf/browserPipeline';
import { canProcess, deselectAll, invert, recallSelection, rememberSelection, selectAll, selectOnly, selectionFor, toggle, type PageSelection } from '../pdf/pageSelection';

const THUMB_W = 150;
// localStorage can be missing or throw (private window, blocked site data): then nothing is remembered
const browserStore = () => { try { return window.localStorage; } catch { return undefined; } };

interface Props {
  file: File;
  fileHash: string;
  onProcess: (selection: PageSelection) => void;
  /** read the whole file and let the reader find the structural sheets (the behaviour without a selection) */
  onReadAll: () => void;
  onCancel: () => void;
  busy: boolean;
}

/** draws one page into its canvas when asked; renders run one after another so the page never freezes */
function useRenderQueue() {
  const chain = useRef(Promise.resolve());
  return (job: () => Promise<void>) => { chain.current = chain.current.then(job, job); };
}

const Thumb: React.FC<{
  doc: PdfDoc;
  page: number;
  checked: boolean;
  onToggle: () => void;
  enqueue: (job: () => Promise<void>) => void;
  alive: () => boolean;
  tag?: { sheetId?: string; skip: boolean; reason?: string };
}> = ({ doc, page, checked, onToggle, enqueue, alive, tag }) => {
  const box = useRef<HTMLLabelElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'wait' | 'done' | 'error'>('wait');
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      enqueue(async () => {
        if (!alive() || !canvas.current) return;
        try {
          const pg = await doc.getPage(page);
          const vp1 = pg.getViewport({ scale: 1 });
          const scale = (THUMB_W * Math.min(window.devicePixelRatio || 1, 1.5)) / vp1.width;
          const vp = pg.getViewport({ scale });
          const c = canvas.current!;
          c.width = Math.ceil(vp.width);
          c.height = Math.ceil(vp.height);
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: ctx, viewport: vp } as any).promise;
          pg.cleanup();
          if (alive()) setState('done');
        } catch {
          if (alive()) setState('error');
        }
      });
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [doc, page]);
  return (
    <label ref={box} data-page={page} className={`relative flex flex-col items-center gap-1 rounded-lg border p-1.5 cursor-pointer select-none ${checked ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-400'}`}>
      <div className="w-full aspect-[1.41] flex items-center justify-center bg-slate-50 overflow-hidden rounded">
        <canvas ref={canvas} className={`max-w-full max-h-full ${state === 'done' ? '' : 'hidden'}`} />
        {state === 'wait' && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
        {state === 'error' && <span className="text-xs text-rose-600">แสดงภาพไม่ได้</span>}
      </div>
      <span className="flex items-center gap-1.5 text-xs text-slate-700">
        <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`หน้า ${page}`} />
        หน้า {page}
      </span>
      {tag && (
        <span
          className={`text-xs truncate max-w-full ${tag.skip ? 'text-slate-400' : tag.sheetId ? 'text-emerald-600' : 'text-amber-600'}`}
          title={tag.skip ? tag.reason : tag.sheetId ? undefined : 'อ่านมุมกระดาษไม่ออก — โหมดอัตโนมัติจะอ่านหน้านี้เต็มหน้า'}
        >
          {/* no sheet code read: the sort could not decide, so it is not called structural */}
          {tag.skip ? (tag.sheetId ?? 'ข้าม') : tag.sheetId ? `โครงสร้าง ${tag.sheetId}` : 'ไม่แน่ใจ'}
        </span>
      )}
    </label>
  );
};

export const PageSelector: React.FC<Props> = ({ file, fileHash, onProcess, onReadAll, onCancel, busy }) => {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<PageSelection | null>(null);
  const [restored, setRestored] = useState(false);
  const [sorted, setSorted] = useState<Record<number, { sheetId?: string; skip: boolean; reason?: string }>>({});
  const [sortDone, setSortDone] = useState(false);
  const live = useRef(true);
  const enqueue = useRenderQueue();

  // a new file (by its bytes) opens its own document and starts with nothing selected
  useEffect(() => {
    live.current = true;
    const ac = new AbortController();
    let opened: PdfDoc | null = null;
    setDoc(null); setError(''); setSel(null); setRestored(false);
    setSorted({}); setSortDone(false);
    (async () => {
      try {
        const { loadPdf } = await import('../pdf/browserPipeline');
        opened = await loadPdf(await file.arrayBuffer());
        if (!live.current || ac.signal.aborted) { void opened.destroy(); return; }
        setDoc(opened);
        // the pages processed the last time these exact bytes were opened come back selected
        const before = recallSelection(browserStore(), fileHash, opened.numPages);
        setRestored(!!before);
        setSel(prev => selectionFor(prev, fileHash, opened!.numPages, before));

        (async () => {
          try {
            const { classifyPages, warmOcrEngines } = await import('../pdf/browserPipeline');
            const { toPageText } = await import('../pdf/pdfText');
            const { parseBoqPages } = await import('../pdf/boqParser');
            const all = Array.from({ length: opened!.numPages }, (_, i) => i + 1);
            const texts: ReturnType<typeof toPageText>[] = [];
            for (const p of all) {
              if (!live.current || ac.signal.aborted) return;
              const pg = await opened!.getPage(p);
              texts.push(toPageText(p, pg.getViewport({ scale: 1 }), await pg.getTextContent() as any));
            }
            // ปร.4 pages are BOQ, not drawings: the automatic mode never reads them as sheets, so they are not sorted here either
            const boq = new Set(parseBoqPages(texts, file.name).lines.map(l => l.page));
            if (live.current && !ac.signal.aborted && boq.size) setSorted(prev => ({ ...prev, ...Object.fromEntries([...boq].map(p => [p, { sheetId: 'BOQ', skip: true, reason: 'หน้า BOQ ปร.4 (อ่านจากข้อความ ไม่ใช่แบบ)' }])) }));
            const results = await classifyPages(
              opened!,
              all.filter(p => !boq.has(p)),
              opened!.numPages,
              p => texts[p - 1],
              (_done, _total, page, cls) => {
                if (live.current && !ac.signal.aborted) {
                  setSorted(prev => ({ ...prev, [page]: { sheetId: cls.sheetId, skip: cls.skip, reason: cls.reason } }));
                }
              },
              ac.signal,
            );
            if (live.current && !ac.signal.aborted) {
              setSortDone(true);
              void warmOcrEngines(opened!, results.filter(r => !r.cls.skip && r.cls.sheetId).map(r => r.page), ac.signal);
            }
          } catch {
            if (live.current && !ac.signal.aborted) setSortDone(true);
          }
        })();
      } catch (e) {
        if (live.current && !ac.signal.aborted) setError('เปิด PDF ไม่ได้: ' + (e as Error).message);
      }
    })();
    return () => { live.current = false; ac.abort(); if (opened) void opened.destroy(); };
  }, [file, fileHash]);

  if (error) return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error} <button className="underline ml-2" onClick={onCancel}>เลือกไฟล์อื่น</button></div>;
  if (!doc || !sel) return <div className="rounded-lg border border-slate-200 p-6 text-center text-sm text-slate-600"><Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin text-blue-600" />กำลังเปิด {file.name}…</div>;

  const btn = 'px-2.5 py-1 rounded-md border border-slate-300 text-sm hover:bg-slate-50';
  const structuralPages = Object.entries(sorted).filter(([, v]) => !v.skip && v.sheetId).map(([p]) => Number(p));
  return (
    <div data-page-selector={fileHash} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-900">{file.name}</span>
        <span className="text-slate-500">พบ {sel.totalPages} หน้า</span>
        <span className="ml-auto flex gap-1.5">
          <button type="button" className={btn} onClick={() => { setRestored(false); setSel(selectAll(sel)); }}>เลือกทั้งหมด</button>
          <button type="button" className={btn} onClick={() => { setRestored(false); setSel(deselectAll(sel)); }}>ไม่เลือก</button>
          <button type="button" className={btn} onClick={() => { setRestored(false); setSel(invert(sel)); }}>สลับ</button>
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto pr-1">
        {Array.from({ length: sel.totalPages }, (_, i) => i + 1).map(p => (
          <Thumb key={`${fileHash}:${p}`} doc={doc} page={p} checked={sel.selectedPages.includes(p)} onToggle={() => { setRestored(false); setSel(s => toggle(s!, p)); }} enqueue={enqueue} alive={() => live.current} tag={sorted[p]} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span data-selected-count className="text-slate-700">เลือกแล้ว {sel.selectedPages.length} / {sel.totalPages} หน้า</span>
        {!sortDone ? (
          <span className="text-xs text-slate-500">ระบบกำลังคัดหน้า… ({Object.keys(sorted).length}/{sel.totalPages})</span>
        ) : (
          <button
            type="button"
            className={`${btn} disabled:opacity-40`}
            disabled={busy || structuralPages.length === 0}
            onClick={() => { setRestored(false); setSel(selectOnly(sel, structuralPages)); }}
          >
            เลือกตามที่ระบบคัด ({structuralPages.length} หน้า)
          </button>
        )}
        {restored && <span data-selection-restored className="text-xs text-slate-500">(หน้าที่เลือกไว้ครั้งก่อนของไฟล์นี้ — แก้ได้)</span>}
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={onCancel} disabled={busy}>ยกเลิก</button>
          <button type="button" className={btn} onClick={onReadAll} disabled={busy} title="ระบบหาแผ่นโครงสร้างเองจากทุกหน้า">อ่านทุกหน้า (หาแผ่นโครงสร้างเอง)</button>
          <button type="button" disabled={busy || !canProcess(sel)} onClick={() => { rememberSelection(browserStore(), sel); onProcess(sel); }}
            className="px-3 py-1 rounded-md bg-blue-600 text-white font-semibold disabled:opacity-40">ประมวลผลหน้าที่เลือก</button>
        </span>
      </div>
    </div>
  );
};
