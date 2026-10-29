import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2, FileText } from 'lucide-react';
import type { ExtractionAudit } from '../engine/qsEngine';
import { SAMPLE_PROJECTS, SampleProject } from '../data/sampleProjects';
import type { DatasetInfo } from './BoqComparison';

interface UploadSectionProps {
  onFileUpload: (file: File, pages?: string) => void;
  progress?: { message: string; frac: number } | null;
  onSelectSample: (sample: SampleProject) => void;
  selectedSampleId: string;
  isProcessing: boolean;
  audit?: ExtractionAudit;
  datasets: DatasetInfo[];
  onLoadDataset: (id: string) => void;
  loadingDatasetId: string | null;
}

/** "บ้านสำเร็จรูป 1 (ระบบประสานพิกัด) — กรมโยธาธิการและผังเมือง" -> title + source */
const splitName = (n: string) => {
  const [title, src] = n.split(' — ');
  return { title: title.replace(/\s*\(.*\)\s*$/, ''), src };
};

export const UploadSection: React.FC<UploadSectionProps> = ({
  onFileUpload, onSelectSample, selectedSampleId, isProcessing, audit, progress, datasets, onLoadDataset, loadingDatasetId,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pages, setPages] = useState('');
  const [error, setError] = useState('');
  const busy = isProcessing || !!loadingDatasetId;

  const take = (file?: File) => {
    if (!file || busy) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'dxf') { setError('รองรับเฉพาะไฟล์ .pdf และ .dxf'); return; }
    setError('');
    onFileUpload(file, pages.trim() || undefined);
  };

  const card = 'rounded-xl border border-slate-200 bg-white p-5';

  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
      <section className={card}>
        <h2 className="text-base font-semibold text-slate-900 mb-3">เปิดไฟล์แบบ</h2>
        <div
          onDragEnter={e => { e.preventDefault(); setDragActive(true); }}
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
          onDrop={e => { e.preventDefault(); setDragActive(false); take(e.dataTransfer.files?.[0]); }}
          onClick={() => !busy && fileInputRef.current?.click()}
          className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 bg-slate-50'}`}
        >
          <input ref={fileInputRef} type="file" accept=".pdf,.dxf" className="hidden" onChange={e => take(e.target.files?.[0])} />
          {busy ? <Loader2 className="w-7 h-7 mx-auto text-blue-600 animate-spin" /> : <UploadCloud className="w-7 h-7 mx-auto text-blue-600" />}
          <p className="mt-2 font-medium text-slate-800">{busy ? 'กำลังอ่านแบบ…' : 'ลากไฟล์ PDF หรือ DXF มาวาง หรือคลิกเพื่อเลือก'}</p>
          <p className="text-sm text-slate-500">อ่านในเบราว์เซอร์นี้ ไฟล์ไม่ถูกส่งออกไปที่ใด</p>
        </div>

        <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          หน้าแบบโครงสร้าง
          <input
            value={pages}
            onChange={e => setPages(e.target.value)}
            placeholder="เว้นว่าง = หาให้เอง · เช่น 16,24-36"
            className="flex-1 min-w-[14rem] h-9 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-sm"
          />
        </label>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}

        {progress && (
          <div className="mt-3 text-sm">
            <div className="flex justify-between text-slate-600 mb-1"><span>{progress.message}</span><span className="tabular-nums">{Math.round(progress.frac * 100)}%</span></div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round(progress.frac * 100)}%` }} /></div>
          </div>
        )}

        {audit?.fileName && !progress && (
          <div className="mt-4 pt-3 border-t border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-900"><FileText className="w-4 h-4" />{audit.fileName}</span>
            <span>{audit.fileType}</span>
            {!!audit.pageOrLayerCount && <span>{audit.pageOrLayerCount} หน้า/เลเยอร์</span>}
            <span>{audit.entitiesParsed} ชิ้นส่วน</span>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold text-slate-900">แบบจริงพร้อม BOQ</h2>
        <p className="text-sm text-slate-500 mb-3">ใช้ลองระบบและดูความคลาดเคลื่อนเทียบ BOQ ทางการ</p>
        {datasets.length ? (
          <div className="space-y-2">
            {datasets.map(d => {
              const { title, src } = splitName(d.name);
              return (
                <button
                  key={d.id}
                  onClick={() => onLoadDataset(d.id)}
                  disabled={busy}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 disabled:opacity-50"
                >
                  <div className="font-medium text-slate-900">{loadingDatasetId === d.id ? 'กำลังโหลด…' : title}</div>
                  {src && <div className="text-sm text-slate-500">{src}</div>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">ไม่มีชุดแบบในเว็บนี้</p>
        )}

        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-slate-600">ตัวอย่างสาธิต (ข้อมูลสมมติ ไม่มีไฟล์แบบ)</summary>
          <div className="mt-2 space-y-1">
            {SAMPLE_PROJECTS.map(s => (
              <button
                key={s.id}
                onClick={() => onSelectSample(s)}
                className={`w-full text-left px-3 py-1.5 rounded-md ${selectedSampleId === s.id ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'} text-slate-700`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </details>
      </section>
    </div>
  );
};
