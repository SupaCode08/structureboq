import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { EvidenceRef } from '../engine/qsEngine';
import { useDocSource } from '../pdf/docContext';
import { PdfViewer, type Overlay } from './PdfViewer';

interface SourceViewerProps {
  docId?: string;
  /** browser-side page renderer (overrides the context) */
  pageUrl?: (page: number, dpi: number) => Promise<string>;
  evidence: EvidenceRef[];
  theme?: 'light' | 'dark';
  height?: number;
  /** Extra boxes to draw on the same page (e.g. all members of a sheet), muted */
  context?: EvidenceRef[];
}

export const METHOD_LABEL: Record<EvidenceRef['method'], string> = {
  vision: 'อ่านจากรูปแบบ (OCR)',
  pdf_text: 'ข้อความใน PDF',
  dxf: 'ข้อความ DXF',
  manual: 'ป้อนเอง',
};

/**
 * The drawing page an extracted value came from, opened at the read region,
 * so the reviewer compares against the source instead of re-measuring.
 */
export const SourceViewer: React.FC<SourceViewerProps> = ({ pageUrl: pageUrlProp, evidence, height = 480, context = [] }) => {
  const ctx = useDocSource();
  const pageUrl = pageUrlProp || ctx.pageUrl;
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [evidence]);
  const ev = evidence[Math.min(active, evidence.length - 1)];

  if (!evidence.length || !pageUrl) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-100 flex flex-col items-center justify-center text-sm gap-2 text-slate-500" style={{ height: 160 }}>
        <ImageOff className="w-6 h-6" />
        {!evidence.length ? 'รายการนี้ไม่มีตำแหน่งในแบบ (ป้อนเองหรือข้อมูลตัวอย่าง)' : 'ไม่มีไฟล์แบบต้นฉบับ — โหลดไฟล์ PDF เพื่อดูเทียบ'}
      </div>
    );
  }

  const overlays: Overlay[] = [
    ...context.filter(c => c.page === ev.page && c.bboxNorm).map(c => ({
      box: c.bboxNorm!,
      kind: 'context' as const,
      label: c.text,
      memberType: c.memberType
    })),
    ...(ev.bboxNorm ? [{
      box: ev.bboxNorm,
      kind: 'focus' as const,
      label: ev.text,
      memberType: ev.memberType
    }] : []),
  ];

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
      <PdfViewer
        page={ev.page}
        pageUrl={pageUrl}
        overlays={overlays}
        height={height}
        toolbarLeft={evidence.length > 1 && evidence.map((e, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={`h-8 px-2.5 rounded-md text-xs font-medium border ${i === active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            {e.label} · น.{e.page}
          </button>
        ))}
      />
      {ev.text && (
        <div className="text-sm px-3 py-2 border-t border-slate-200 bg-amber-50 text-amber-900 flex flex-wrap gap-x-2">
          <span className="font-medium">{ev.label}:</span>
          <span className="font-mono">“{ev.text}”</span>
          <span className="text-amber-700/70">{METHOD_LABEL[ev.method]}</span>
        </div>
      )}
    </div>
  );
};
