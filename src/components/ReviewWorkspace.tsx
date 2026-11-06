import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, XCircle, ChevronLeft, ChevronRight, AlertTriangle, ShieldCheck, Info, Undo2, Eye } from 'lucide-react';
import type { CalculatedQuantity, ExtractedMember, FieldSource, ReviewDecision } from '../engine/qsEngine';
import { approvalFor, fieldsApprovalCannotCover } from '../engine/qsEngine';
import { FootingRebarSets } from './FootingRebarSets';
import { ConflictPanel } from './ConflictPanel';
import { DuplicatePanel } from './DuplicatePanel';
import type { CompletenessFinding } from '../engine/sheetMerge';
import { SourceViewer } from './SourceViewer';
import { SectionTable, TYPE_TH, SOURCE_BADGE } from './SectionTable';
import { ReviewHistory } from './ReviewHistory';
import type { ReviewLogEntry } from '../engine/reviewLog';

type QueueFilter = 'todo' | 'spot' | 'auto' | 'done' | 'all';

interface ReviewWorkspaceProps {
  items: CalculatedQuantity[];
  members: ExtractedMember[];
  docId?: string;
  theme?: 'light' | 'dark';
  /** Possible omissions found by cross-checking sheets (not tied to any extracted item) */
  completeness?: CompletenessFinding[];
  onAddSuggested?: (index: number) => void;
  onUpdateMembers: (updates: { index: number; patch: Partial<ExtractedMember> }[]) => void;
  reviewLog?: ReviewLogEntry[];
  onUndo?: (id: string) => void;
  onOpenItem?: (item: CalculatedQuantity) => void;
  /** name recorded on every decision; approving or excluding needs one */
  reviewer?: string;
  onReviewerChange?: (name: string) => void;
  /** opened drawing file (name · SHA-256 prefix), stamped on RebarSets the reviewer touches */
  revision?: string;
}

interface FieldDef { key: keyof ExtractedMember; label: string; unit?: string; source?: string; kind?: 'num' | 'text' | 'select'; options?: string[]; placeholder?: string }

const FIELDS: Record<string, FieldDef[]> = {
  BEAM: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'ลึก', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'ช่วง c/c', unit: 'ม.', source: 'length' },
    { key: 'supportColW1', label: 'เสารองรับ 1', unit: 'ม.', source: 'support' },
    { key: 'supportColW2', label: 'เสารองรับ 2', unit: 'ม.', source: 'support' },
    { key: 'topRebar', label: 'เหล็กบน', kind: 'text', source: 'rebar' },
    { key: 'bottomRebar', label: 'เหล็กล่าง', kind: 'text', source: 'rebar' },
    { key: 'stirrupRebar', label: 'เหล็กปลอก', kind: 'text', source: 'stirrup' },
  ],
  COLUMN: [
    { key: 'width', label: 'ขนาด X', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'ขนาด Y', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'ความสูง', unit: 'ม.', source: 'length' },
    { key: 'topRebar', label: 'เหล็กยืน', kind: 'text', source: 'rebar' },
    { key: 'stirrupRebar', label: 'เหล็กปลอก', kind: 'text', source: 'stirrup' },
  ],
  FOOTING: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'ยาว', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'หนา', unit: 'ม.', source: 'length' },
    { key: 'excavationDepthM', label: 'ลึกขุดดิน', unit: 'ม.', source: 'excavation' },
    { key: 'count', label: 'จำนวน', unit: 'ชิ้น' },
    { key: 'bottomRebar', label: 'ตะแกรงล่าง', kind: 'text', source: 'rebar' },
  ],
  SLAB: [
    { key: 'width', label: 'ด้าน X', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'ด้าน Y', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'หนา', unit: 'ม.', source: 'length' },
    { key: 'slabType', label: 'ชนิดพื้น', kind: 'select', options: ['CAST_IN_PLACE', 'SLAB_ON_GROUND', 'PRECAST_PLANK'] },
    { key: 'topRebar', label: 'เหล็กบน', kind: 'text', source: 'rebar' },
    { key: 'bottomRebar', label: 'เหล็กล่าง', kind: 'text', source: 'rebar' },
  ],
  STAIR: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'หนาท้อง', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'ยาวลาด', unit: 'ม.', source: 'length' },
    { key: 'bottomRebar', label: 'เหล็กหลัก', kind: 'text', source: 'rebar' },
    { key: 'topRebar', label: 'เหล็กกระจาย', kind: 'text', source: 'rebar' },
  ],
  WALL: [
    { key: 'width', label: 'ความหนาผนัง', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'ความสูงผนัง', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'ความยาวผนัง', unit: 'ม.', source: 'length' },
  ],
  DOOR: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'สูง', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'จำนวนชุด', unit: 'ชุด', source: 'length' },
  ],
  WINDOW: [
    { key: 'width', label: 'กว้าง', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'สูง', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'จำนวนชุด', unit: 'ชุด', source: 'length' },
  ],
  FINISH: [
    { key: 'width', label: 'กว้างห้อง', unit: 'ม.', source: 'width' },
    { key: 'depth', label: 'ยาวห้อง', unit: 'ม.', source: 'depth' },
    { key: 'length', label: 'หนา/พื้นที่', unit: 'ม.', source: 'length' },
  ],
};

const COVER_SOURCE_TH: Record<string, string> = {
  drawing: 'จากแบบของชิ้นนี้', manual: 'ผู้ตรวจกรอก', drawing_notes: 'หมายเหตุทั่วไปในแบบ',
  project_spec: 'สเปกโครงการ', legacy_spec: 'สเปกระยะหุ้มรวม', default: 'ค่ามาตรฐาน — แบบ/สเปกไม่ได้ให้',
};
const SLAB_LABEL: Record<string, string> = { CAST_IN_PLACE: 'หล่อในที่', SLAB_ON_GROUND: 'วางบนดิน', PRECAST_PLANK: 'สำเร็จรูป' };

const SOURCE_STYLE: Record<FieldSource, { label: string; cls: string }> = {
  drawing: { label: 'จากแบบ', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  grid: { label: 'จากกริด', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  inferred: { label: 'อนุมาน', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  assumed: { label: 'ค่าสมมติ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  missing: { label: 'ไม่พบ', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  reviewer: { label: 'ผู้ตรวจแก้', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
};

/** Auto-released items worth a quick human glance: lowest confidence first, then the biggest quantities. */
function pickSpotChecks(items: CalculatedQuantity[]): Set<string> {
  const auto = items.filter(i => i.status === 'AUTO_RELEASE' && !i.review && i.provenance);
  const n = Math.min(auto.length, Math.max(auto.length ? 1 : 0, Math.ceil(auto.length * 0.1)));
  const byRisk = [...auto].sort((a, b) => (a.confidencePct ?? 100) - (b.confidencePct ?? 100) || b.volumeNetM3 - a.volumeNetM3);
  return new Set(byRisk.slice(0, n).map(i => i.itemId));
}

export const ReviewWorkspace: React.FC<ReviewWorkspaceProps> = ({ items, members, docId, theme = 'light', completeness = [], onAddSuggested, onUpdateMembers, reviewLog = [], onUndo, onOpenItem, reviewer = '', onReviewerChange, revision }) => {
  const isLight = theme === 'light';
  const [filter, setFilter] = useState<QueueFilter>('todo');
  const [mode, setMode] = useState<'table' | 'items' | 'history'>('table');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ExtractedMember>>({});
  const [applyToSameTag, setApplyToSameTag] = useState(true);
  const [note, setNote] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const reviewerRef = useRef<HTMLInputElement>(null);

  const spot = useMemo(() => pickSpotChecks(items), [items]);
  const counts = useMemo(() => ({
    todo: items.filter(i => i.status === 'NEEDS_REVIEW' && !i.review).length,
    spot: items.filter(i => spot.has(i.itemId)).length,
    auto: items.filter(i => i.status === 'AUTO_RELEASE' && !i.review).length,
    done: items.filter(i => i.review).length,
    all: items.length,
  }), [items, spot]);

  const queue = useMemo(() => {
    const f = items.filter(i =>
      filter === 'all' ? true :
      filter === 'todo' ? i.status === 'NEEDS_REVIEW' && !i.review :
      filter === 'spot' ? spot.has(i.itemId) :
      filter === 'auto' ? i.status === 'AUTO_RELEASE' && !i.review :
      !!i.review);
    return filter === 'todo' || filter === 'spot'
      ? [...f].sort((a, b) => (a.confidencePct ?? 100) - (b.confidencePct ?? 100))
      : f;
  }, [items, filter, spot]);

  const selected = items.find(i => i.itemId === selectedId) || queue[0] || null;
  const member = selected?.memberIndex !== undefined ? members[selected.memberIndex] : undefined;
  const sameTag = useMemo(
    () => (member ? members.map((m, i) => ({ m, i })).filter(({ m }) => m.tag === member.tag && m.memberType === member.memberType) : []),
    [members, member],
  );

  useEffect(() => { setDraft({}); setNote(''); }, [selected?.itemId]);

  // fields a whole-member approval would not cover, as of the last saved values (one rebar flag covers both bars and stirrups, so a draft cannot be judged field by field)
  const openFields = member && selected ? [...new Set(fieldsApprovalCannotCover(member, selected.flags || []).map(f => f.label))] : [];

  const move = (delta: number) => {
    if (!queue.length || !selected) return;
    const idx = queue.findIndex(q => q.itemId === selected.itemId);
    const next = queue[Math.max(0, Math.min(queue.length - 1, (idx === -1 ? 0 : idx) + delta))];
    setSelectedId(next.itemId);
  };

  const decide = (status: ReviewDecision['status'] | null) => {
    if (!selected || selected.memberIndex === undefined || !member) return;
    if (status && !reviewer.trim()) { reviewerRef.current?.focus(); return; }
    const fs = { ...(member.provenance?.fieldSources || {}) };
    for (const k of Object.keys(draft)) {
      // a cover typed here is the reviewer's, recorded where the cover resolver reads it
      const src = FIELDS[member.memberType]?.find(f => f.key === k)?.source || (k === 'coveringCm' ? 'cover' : k);
      fs[src] = 'reviewer';
    }
    // Values typed by the reviewer are trusted: drop "detail not found" conflicts and low-confidence penalties
    const edited = Object.keys(draft).length > 0;
    const trust = (prov: ExtractedMember['provenance'], sources: Record<string, FieldSource>) => prov && ({
      ...prov,
      fieldSources: sources,
      conflicts: edited ? (prov.conflicts || []).filter(c => !c.startsWith('ไม่พบแบบขยาย')) : prov.conflicts,
      confidence: edited ? Math.max(prov.confidence, 0.9) : prov.confidence,
    });
    const patch: Partial<ExtractedMember> = {
      ...draft,
      provenance: trust(member.provenance, fs),
      review: status === 'approved' ? approvalFor({ ...member, ...draft }, note || undefined)
        : status ? { status, note: note || undefined, at: new Date().toISOString() } : undefined,
    };
    const targets = Object.keys(draft).length && applyToSameTag ? sameTag.map(s => s.i) : [selected.memberIndex];
    onUpdateMembers(targets.map(index => ({
      index,
      patch: index === selected.memberIndex ? patch : {
        ...draft,
        provenance: trust(members[index].provenance, {
          ...(members[index].provenance?.fieldSources || {}),
          ...Object.fromEntries(Object.keys(fs).filter(k => fs[k] === 'reviewer').map(k => [k, 'reviewer' as FieldSource])),
        }),
        // its values just changed, so an earlier decision no longer covers them
        review: undefined,
      },
    })));
    // stay in the queue: jump to the next item that still needs a decision
    if (status) {
      const idx = queue.findIndex(q => q.itemId === selected.itemId);
      const next = queue[idx + 1] || queue[idx - 1];
      if (next && filter !== 'all' && filter !== 'done') setSelectedId(next.itemId);
    }
  };

  // Keyboard: A approve, X reject, J/K next/prev, U undo decision
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'a') decide('approved');
      else if (e.key === 'x') decide('rejected');
      else if (e.key === 'u') decide(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected?.itemId]);

  const card = isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800';
  const muted = isLight ? 'text-slate-500' : 'text-slate-400';
  const reduction = items.length ? Math.round((1 - counts.todo / items.length) * 100) : 0;
  const tracked = items.filter(i => i.provenance).length;

  if (!items.length) {
    return <div className={`rounded-2xl border p-8 text-center text-sm ${card} ${muted}`}>ยังไม่มีรายการ — อัปโหลดแบบหรือเลือกชุดข้อมูลก่อน</div>;
  }

  return (
    <div className="space-y-4">
      {/* Workload summary */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex-1 min-w-[16rem]">
          <div className="text-sm text-slate-700">
            รอตรวจ <b className="text-amber-700 tabular-nums">{counts.todo}</b> จาก <span className="tabular-nums">{items.length}</span> รายการ
            {tracked < items.length && <span className="text-slate-500"> · {items.length - tracked} รายการไม่มีตำแหน่งในแบบ</span>}
          </div>
          <div className="mt-1.5 h-1.5 rounded-full overflow-hidden bg-slate-200 max-w-md">
            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${reduction}%` }} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          ผู้ตรวจ
          <input ref={reviewerRef} value={reviewer} onChange={e => onReviewerChange?.(e.target.value)} placeholder="ชื่อ (ต้องกรอกก่อนอนุมัติ)"
            className={`h-9 w-48 rounded-md border px-2 ${reviewer.trim() ? 'border-slate-300' : 'border-amber-400 ring-1 ring-amber-200'}`} />
        </label>
        <div className="inline-flex rounded-md border border-slate-300 overflow-hidden text-sm">
          {([['table', 'ตามเบอร์'], ['items', 'รายชิ้น'], ['history', `ประวัติ (${reviewLog.filter(e => !e.undoneAt).length})`]] as const).map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} className={`h-9 px-4 border-l first:border-l-0 border-slate-300 ${mode === m ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
      </div>

      {completeness.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 space-y-1.5">
          <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> อาจขาดชิ้นส่วน ({completeness.length})</div>
          {completeness.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[16rem]">{c.message}</span>
              {c.suggested.length > 0 && onAddSuggested && (
                <button onClick={() => onAddSuggested(i)} className="shrink-0 h-8 px-3 rounded-md bg-rose-700 hover:bg-rose-800 text-white">
                  เพิ่ม {c.suggested.length} ชิ้นเข้าคิว
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {mode === 'history' && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2">
          <ReviewHistory
            log={reviewLog}
            memberCount={members.length}
            onUndo={onUndo}
            onOpen={i => { const it = items.find(x => x.memberIndex === i); if (it && onOpenItem) onOpenItem(it); }}
          />
        </div>
      )}

      {mode === 'table' && (
        <SectionTable items={items} members={members} docId={docId} theme={theme} onUpdateMembers={onUpdateMembers} canApprove={!!reviewer.trim()} />
      )}

      <div className={`grid grid-cols-1 xl:grid-cols-12 gap-4 ${mode !== 'items' ? 'hidden' : ''}`}>
        {/* Queue */}
        <div className={`xl:col-span-3 rounded-2xl border flex flex-col ${card}`} style={{ maxHeight: 760 }}>
          <div className="p-2 grid grid-cols-3 gap-1 text-xs">
            {([
              ['todo', 'ต้องตรวจ'], ['spot', 'สุ่มตรวจ'], ['done', 'ตรวจแล้ว'], ['auto', 'ผ่านอัตโนมัติ'], ['all', 'ทั้งหมด'],
            ] as [QueueFilter, string][]).map(([k, label]) => (
              <button key={k} onClick={() => { setFilter(k); setSelectedId(null); }}
                className={`px-2 py-1.5 rounded-lg border ${filter === k ? 'bg-blue-600 border-blue-600 text-white' : isLight ? 'border-slate-200 text-slate-600 hover:bg-slate-50' : 'border-slate-700 text-slate-300'}`}>
                {label} <span className="opacity-70">{counts[k]}</span>
              </button>
            ))}
          </div>
          <div ref={listRef} className="overflow-y-auto px-2 pb-2 space-y-1">
            {queue.length === 0 && <div className={`text-xs text-center py-8 ${muted}`}>{filter === 'todo' ? 'ไม่มีรายการค้างตรวจ' : 'ไม่มีรายการ'}</div>}
            {queue.map(it => {
              const isSel = selected?.itemId === it.itemId;
              const topFlag = (it.flags || []).find(f => f.severity === 'block') || (it.flags || []).find(f => f.severity === 'warn');
              return (
                <button key={it.itemId} data-selected={isSel} onClick={() => setSelectedId(it.itemId)}
                  className={`w-full text-left p-2 rounded-xl border text-xs transition-colors ${
                    isSel ? (isLight ? 'bg-blue-50 border-blue-300' : 'bg-blue-950/40 border-blue-600') : (isLight ? 'border-transparent hover:bg-slate-50' : 'border-transparent hover:bg-slate-800')
                  }`}>
                  <div className="flex items-center gap-1.5">
                    {it.review?.status === 'approved' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      : it.review?.status === 'rejected' || it.status === 'REJECTED' ? <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      : it.status === 'NEEDS_REVIEW' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      : <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                    <span className="font-bold">{it.tag}</span>
                    <span className={muted}>{it.gridLocation}</span>
                    <span className={`ml-auto font-mono text-[10px] px-1.5 rounded ${
                      (it.confidencePct ?? 100) >= 80 ? 'bg-emerald-100 text-emerald-700' : (it.confidencePct ?? 100) >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                    }`}>{it.confidencePct ?? '-'}%</span>
                  </div>
                  <div className={`truncate mt-0.5 ${muted}`}>{it.level}</div>
                  {topFlag && !it.review && <div className={`truncate mt-0.5 ${topFlag.severity === 'block' ? 'text-rose-600' : 'text-amber-600'}`}>{topFlag.message}</div>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Source page */}
        <div className={`xl:col-span-5 rounded-2xl border p-3 ${card}`}>
          {selected ? (
            <SourceViewer
              docId={docId}
              evidence={(selected.provenance?.evidence || []).map(e => ({
                ...e,
                memberType: selected.memberType,
              }))}
              theme={theme}
              height={560}
              context={items
                .filter(i => i.itemId !== selected.itemId)
                .map(i => {
                  const ev = i.provenance?.evidence?.[0];
                  return ev ? { ...ev, memberType: i.memberType } : undefined;
                })
                .filter(Boolean) as any}
            />
          ) : null}
        </div>

        {/* Decision panel */}
        <div className={`xl:col-span-4 rounded-2xl border p-4 space-y-3 ${card}`}>
          {selected && member ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className={`text-lg font-black ${isLight ? 'text-slate-900' : 'text-white'}`}>{selected.tag} <span className={`text-xs font-semibold ${muted}`}>{TYPE_TH[selected.memberType] || selected.memberType} · {selected.itemId}</span></div>
                  <div className={`text-xs ${muted}`}>{selected.gridLocation} · {selected.level}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => move(-1)} className={`p-1.5 rounded-lg border ${isLight ? 'border-slate-200' : 'border-slate-700'}`}><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={() => move(1)} className={`p-1.5 rounded-lg border ${isLight ? 'border-slate-200' : 'border-slate-700'}`}><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>

              {selected.review && (
                <div className={`text-xs p-2 rounded-lg border flex items-center gap-2 ${selected.review.status === 'approved' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                  {selected.review.status === 'approved' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {selected.review.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่นับรายการนี้'}{selected.review.note ? ` — ${selected.review.note}` : ''}
                  {selected.review.fingerprint && <span className="font-mono text-[10px] opacity-70" title={selected.review.fingerprint}>#{selected.review.fingerprint.slice(0, 12)}</span>}
                  <button onClick={() => decide(null)} className="ml-auto inline-flex items-center gap-1 underline"><Undo2 className="w-3 h-3" />ยกเลิก</button>
                </div>
              )}
              {selected.duplicate && selected.duplicate.group.classification !== 'SAME_SPECIFICATION' && (
                // keyed by item, group and stored ruling: a half-made ruling never follows another item or outlives an undo
                <DuplicatePanel key={`${selected.itemId}:${selected.duplicate.group.key}:${selected.duplicate.group.decision?.at ?? "none"}`} group={selected.duplicate.group} items={items} members={members} reviewer={reviewer} revision={revision}
                  onAskReviewer={() => reviewerRef.current?.focus()} onDecide={onUpdateMembers} onOpenItem={id => setSelectedId(id)} />
              )}
              {member && selected.memberIndex !== undefined && !!selected.conflicts?.length && (
                // keyed by item: a half-made ruling on one member must never show up on another with the same conflict
                <ConflictPanel key={selected.itemId} member={member} conflicts={selected.conflicts} approvalState={selected.approvalState} reviewer={reviewer} revision={revision}
                  onAskReviewer={() => reviewerRef.current?.focus()}
                  onResolve={patch => onUpdateMembers([{ index: selected.memberIndex!, patch }])} />
              )}
              {selected.approvalState === 'STALE' && (
                <div data-stale className="text-xs p-2 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 space-y-1">
                  <div className="font-semibold">อนุมัติหมดอายุ{selected.staleApproval?.by ? ` (เดิมโดย ${selected.staleApproval.by})` : ''} — ค่าที่ใช้คำนวณเปลี่ยน ต้องอนุมัติใหม่</div>
                  <ul className="list-disc pl-4 font-mono break-all">{(selected.staleChanges || []).map((c, i) => <li key={i}>{c}</li>)}</ul>
                </div>
              )}

              {/* Why it is here */}
              <div className="space-y-1">
                {(selected.flags || []).length === 0 && selected.rejectionReasons.length === 0 && (
                  <div className="text-sm flex items-center gap-1.5 text-emerald-700"><ShieldCheck className="w-4 h-4" /> ไม่มีข้อสงสัย</div>
                )}
                {selected.rejectionReasons.map((r, i) => (
                  <div key={'r' + i} className="text-xs flex gap-1.5 text-rose-600"><XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{r}</div>
                ))}
                {(selected.flags || []).map((f, i) => (
                  <div key={i} className={`text-xs flex gap-1.5 ${f.severity === 'block' ? 'text-rose-600' : f.severity === 'warn' ? 'text-amber-700' : muted}`}>
                    {f.severity === 'info' ? <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                    {f.message}
                  </div>
                ))}
              </div>

              {/* Fields with where each value came from */}
              <div className={`rounded-xl border divide-y ${isLight ? 'border-slate-200 divide-slate-100' : 'border-slate-800 divide-slate-800'}`}>
                {(FIELDS[member.memberType] || []).map(f => {
                  const src = (f.source && member.provenance?.fieldSources[f.source]) as FieldSource | undefined;
                  const raw = (draft[f.key] ?? member[f.key] ?? '') as any;
                  const value = raw === 0 && src === 'missing' && draft[f.key] === undefined ? '' : raw;
                  const changed = draft[f.key] !== undefined;
                  return (
                    <label key={String(f.key)} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className={`w-20 shrink-0 ${muted}`}>{f.label}</span>
                      {f.kind === 'select' ? (
                        <select value={value} onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
                          className={`flex-1 rounded-md border px-2 py-1 ${isLight ? 'border-slate-200 bg-white' : 'border-slate-700 bg-slate-950'}`}>
                          {f.options!.map(o => <option key={o} value={o}>{SLAB_LABEL[o] || o}</option>)}
                        </select>
                      ) : (
                        <input
                          value={value}
                          type={f.kind === 'text' ? 'text' : 'number'}
                          step="0.01"
                          onChange={e => setDraft(d => ({ ...d, [f.key]: f.kind === 'text' ? e.target.value : Number(e.target.value) }))}
                          placeholder={src === 'missing' ? 'กรอกจากแบบ' : f.placeholder}
                          className={`flex-1 min-w-0 rounded-md border px-2 py-1 font-mono ${changed ? 'border-violet-400 ring-1 ring-violet-200' : isLight ? 'border-slate-200 bg-white' : 'border-slate-700 bg-slate-950'}`}
                        />
                      )}
                      {f.unit && <span className={`w-6 ${muted}`}>{f.unit}</span>}
                      {src && src !== 'drawing' && src !== 'grid' && src !== 'reviewer' && !changed && value !== '' && (
                        <button type="button" onClick={() => setDraft(d => ({ ...d, [f.key]: member[f.key] }))}
                          className="shrink-0 px-1.5 py-0.5 rounded border border-violet-300 text-violet-700 text-[10px] font-semibold">ยืนยันค่า</button>
                      )}
                      {src && <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${SOURCE_BADGE[changed ? 'reviewer' : src].cls}`}>{SOURCE_BADGE[changed ? 'reviewer' : src].th}</span>}
                    </label>
                  );
                })}
              </div>

              {member.memberType === 'FOOTING' && (() => {
                const mode = ('coverMode' in draft ? draft.coverMode : member.coverMode) || '';
                const cm = (draft.coveringCm ?? member.coveringCm ?? '') as number | '';
                return (
                  <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs space-y-1.5" data-cover-block>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`w-20 shrink-0 ${muted}`}>ระยะหุ้ม</span>
                      <select value={mode} onChange={e => setDraft(d => ({ ...d, coverMode: (e.target.value || undefined) as ExtractedMember['coverMode'] }))}
                        className="rounded-md border border-slate-200 px-2 py-1">
                        <option value="">อัตโนมัติ (ชิ้นนี้ → สเปก → ค่ามาตรฐาน)</option>
                        <option value="FROM_DRAWING">จากแบบ</option>
                        <option value="FROM_PROJECT_SPEC">ตามสเปกโครงการ</option>
                        <option value="MANUAL">กรอกเอง</option>
                      </select>
                      {mode === 'MANUAL' && (
                        <>
                          <input type="number" step="0.5" value={cm} placeholder="กรอก"
                            onChange={e => setDraft(d => ({ ...d, coveringCm: e.target.value === '' ? undefined : Number(e.target.value) }))}
                            className="w-20 rounded-md border border-slate-200 px-2 py-1 font-mono" />
                          <span className={muted}>ซม.</span>
                        </>
                      )}
                    </div>
                    {selected.coverM !== undefined && (
                      <div className={muted}>
                        ใช้จริง: <b className="font-mono text-slate-800">{(selected.coverM * 100).toFixed(1)} ซม.</b> · ที่มา: {COVER_SOURCE_TH[selected.coverSource || ''] || selected.coverSource}
                        {(('coverMode' in draft && draft.coverMode !== member.coverMode) || ('coveringCm' in draft && draft.coveringCm !== member.coveringCm)) && ' (ค่าที่บันทึกล่าสุด)'}
                      </div>
                    )}
                  </div>
                );
              })()}

              {member.memberType === 'FOOTING' && (
                <FootingRebarSets
                  member={member}
                  sets={'rebarSets' in draft ? draft.rebarSets : member.rebarSets}
                  results={selected.rebarDetails?.sets}
                  flags={selected.flags || []}
                  dirty={'rebarSets' in draft && JSON.stringify(draft.rebarSets) !== JSON.stringify(member.rebarSets)}
                  reviewer={reviewer}
                  revision={revision}
                  onChange={sets => setDraft(d => ({ ...d, rebarSets: sets }))}
                />
              )}

              {Object.keys(draft).length > 0 && sameTag.length > 1 && (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={applyToSameTag} onChange={e => setApplyToSameTag(e.target.checked)} />
                  ใช้ค่าที่แก้กับ {member.tag} ทุกตำแหน่ง ({sameTag.length} ชิ้น)
                </label>
              )}

              {/* Resulting quantities */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['คอนกรีต', selected.volumeNetM3.toFixed(3), 'ลบ.ม.'],
                  ['ไม้แบบ', selected.formworkNetM2.toFixed(2), 'ตร.ม.'],
                  ['เหล็ก', (selected.rebarWeightKg || 0).toFixed(1), 'กก.'],
                ].map(([l, v, u]) => (
                  <div key={l} className={`rounded-xl border p-2 ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950 border-slate-800'}`}>
                    <div className={`text-[10px] ${muted}`}>{l}</div>
                    <div className="font-mono font-bold text-sm">{v}</div>
                    <div className={`text-[10px] ${muted}`}>{u}</div>
                  </div>
                ))}
              </div>
              <div className={`text-[11px] font-mono break-words ${muted}`}>{selected.formulaStr}</div>
              {selected.rebarFormulaStr && <div className={`text-[11px] font-mono break-words ${muted}`}>{selected.rebarFormulaStr}</div>}

              <input value={note} onChange={e => setNote(e.target.value)} placeholder="หมายเหตุผู้ตรวจ (ไม่บังคับ)"
                className={`w-full rounded-lg border px-3 py-2 text-xs ${isLight ? 'border-slate-200' : 'border-slate-700 bg-slate-950'}`} />

              {openFields.length > 0 && (
                <div className="text-[11px] text-amber-700">การอนุมัติทั้งชิ้นไม่ครอบช่อง {openFields.join(', ')} (ตามค่าที่บันทึกล่าสุด) — แก้หรือกด "ยืนยันค่า" ในช่องนั้น แล้วบันทึก</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => decide('approved')} className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold">
                  <CheckCircle2 className="w-4 h-4" /> {Object.keys(draft).length ? 'บันทึก + อนุมัติ' : 'อนุมัติ'} (A)
                </button>
                <button onClick={() => decide('rejected')} className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-bold ${isLight ? 'border-rose-200 text-rose-700 hover:bg-rose-50' : 'border-rose-800 text-rose-300'}`}>
                  <XCircle className="w-4 h-4" /> ไม่นับ (X)
                </button>
              </div>
              {Object.keys(draft).length > 0 && (
                <button onClick={() => decide(selected.review?.status === 'rejected' ? 'rejected' : null)} className={`w-full text-xs inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg border ${isLight ? 'border-slate-200' : 'border-slate-700'}`}>
                  <Eye className="w-3.5 h-3.5" /> บันทึกค่าแล้วดูผลก่อน (ยังไม่อนุมัติ)
                </button>
              )}
            </>
          ) : (
            <div className={`text-sm ${muted}`}>เลือกรายการ</div>
          )}
        </div>
      </div>
    </div>
  );
};
