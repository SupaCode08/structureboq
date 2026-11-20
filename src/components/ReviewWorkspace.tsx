import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, XCircle, ChevronLeft, ChevronRight, AlertTriangle, ShieldCheck,
  Info, Undo2, Eye, Plus, Trash2, Map as MapIcon, FileImage, BookOpen, Table2, ListChecks, History,
} from 'lucide-react';
import type { CalculatedQuantity, EvidenceRef, ExtractedMember, FieldSource, MemberType, ReviewDecision } from '../engine/qsEngine';
import { approvalFor, conflictStatuses, fieldsApprovalCannotCover } from '../engine/qsEngine';
import type { CompletenessFinding, SheetReading } from '../engine/sheetMerge';
import type { PageOcr } from '../pdf/types';
import type { ReviewLogEntry } from '../engine/reviewLog';
import { FootingRebarSets } from './FootingRebarSets';
import { ConflictPanel } from './ConflictPanel';
import { DuplicatePanel } from './DuplicatePanel';
import { SourceViewer } from './SourceViewer';
import { PlanView } from './PlanView';
import { SectionTable, TYPE_TH, SOURCE_BADGE } from './SectionTable';
import { ReviewHistory } from './ReviewHistory';
import { ProjectCodePanel } from './ProjectCodePanel';
import { RebarInput } from './RebarInput';
import { MemberDiagram } from './MemberDiagram';
import { createBlankMember, fieldsForInstance, type ReviewFieldDef } from './reviewFields';

type QueueFilter = 'todo' | 'spot' | 'auto' | 'done' | 'all';
type ReviewStep = 'codes' | 'table' | 'items' | 'history';

interface ReviewWorkspaceProps {
  items: CalculatedQuantity[];
  members: ExtractedMember[];
  docId?: string;
  theme?: 'light' | 'dark';
  completeness?: CompletenessFinding[];
  onAddSuggested?: (index: number) => void;
  onUpdateMembers: (updates: { index: number; patch: Partial<ExtractedMember> }[]) => void;
  onAddMember?: (member: ExtractedMember) => void;
  onDeleteMember?: (index: number) => void;
  readings?: SheetReading[];
  ocrPages?: PageOcr[];
  reviewLog?: ReviewLogEntry[];
  onUndo?: (id: string) => void;
  onOpenItem?: (item: CalculatedQuantity) => void;
  reviewer?: string;
  onReviewerChange?: (name: string) => void;
  revision?: string;
}

const COVER_SOURCE_TH: Record<string, string> = {
  drawing: 'จากแบบของชิ้นนี้', manual: 'ผู้ตรวจกรอก', drawing_notes: 'หมายเหตุทั่วไปในแบบ',
  project_spec: 'สเปกโครงการ', legacy_spec: 'สเปกระยะหุ้มรวม', default: 'ค่ามาตรฐาน — แบบ/สเปกไม่ได้ให้',
};

const ADD_TYPES: MemberType[] = ['FOOTING', 'COLUMN', 'BEAM', 'SLAB', 'STAIR', 'WALL'];

function pickSpotChecks(items: CalculatedQuantity[]): Set<string> {
  const auto = items.filter(i => i.status === 'AUTO_RELEASE' && !i.review && i.provenance);
  const n = Math.min(auto.length, Math.max(auto.length ? 1 : 0, Math.ceil(auto.length * 0.1)));
  const byRisk = [...auto].sort((a, b) => (a.confidencePct ?? 100) - (b.confidencePct ?? 100) || b.volumeNetM3 - a.volumeNetM3);
  return new Set(byRisk.slice(0, n).map(i => i.itemId));
}

export const ReviewWorkspace: React.FC<ReviewWorkspaceProps> = ({
  items,
  members,
  docId,
  theme = 'light',
  completeness = [],
  onAddSuggested,
  onUpdateMembers,
  onAddMember,
  onDeleteMember,
  readings = [],
  ocrPages = [],
  reviewLog = [],
  onUndo,
  onOpenItem,
  reviewer = '',
  onReviewerChange,
  revision,
}) => {
  const isLight = theme === 'light';
  const [filter, setFilter] = useState<QueueFilter>('todo');
  const [step, setStep] = useState<ReviewStep>('table');
  const [leftTab, setLeftTab] = useState<'source' | 'plan'>('source');
  const [sectionEvidence, setSectionEvidence] = useState<EvidenceRef[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ExtractedMember>>({});
  const [applyToSameTag, setApplyToSameTag] = useState(true);
  const [note, setNote] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState<MemberType>('BEAM');
  const [newTag, setNewTag] = useState('B1');
  const [newLevel, setNewLevel] = useState('ชั้น 1');

  const listRef = useRef<HTMLDivElement>(null);
  const reviewerRef = useRef<HTMLInputElement>(null);

  const handleSectionEvidence = useCallback((ev: EvidenceRef[]) => {
    setSectionEvidence(ev);
  }, []);

  const spot = useMemo(() => pickSpotChecks(items), [items]);
  const counts = useMemo(() => ({
    todo: items.filter(i => i.status === 'NEEDS_REVIEW' && !i.review).length,
    spot: items.filter(i => spot.has(i.itemId)).length,
    auto: items.filter(i => i.status === 'AUTO_RELEASE' && !i.review).length,
    done: items.filter(i => i.review).length,
    all: items.length,
  }), [items, spot]);

  // Real-time project totals (excluding rejected)
  const totals = useMemo(() => {
    let vol = 0, fw = 0, rb = 0;
    for (const it of items) {
      if (it.review?.status === 'rejected' || it.status === 'REJECTED') continue;
      vol += it.volumeNetM3 || 0;
      fw += it.formworkNetM2 || 0;
      rb += it.rebarWeightKg || 0;
    }
    return { vol, fw, rb };
  }, [items]);

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
    const instFields = fieldsForInstance(member.memberType);
    const fs = { ...(member.provenance?.fieldSources || {}) };
    for (const k of Object.keys(draft)) {
      const src = instFields.find(f => f.key === k)?.source || (k === 'coveringCm' ? 'cover' : k);
      fs[src] = 'reviewer';
    }
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
        review: undefined,
      },
    })));
    if (status) {
      const idx = queue.findIndex(q => q.itemId === selected.itemId);
      const next = queue[idx + 1] || queue[idx - 1];
      if (next && filter !== 'all' && filter !== 'done') setSelectedId(next.itemId);
    }
  };

  useEffect(() => {
    if (step !== 'items') return;
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

  const readyToApprove = useMemo(
    () => items.filter(i => {
      if (i.status !== 'NEEDS_REVIEW' || i.review || i.memberIndex === undefined) return false;
      const m = members[i.memberIndex];
      if (!m || !(m.width > 0 && m.depth > 0 && m.length > 0)) return false;
      if (i.duplicate && i.duplicate.group.classification !== 'SAME_SPECIFICATION' && !i.duplicate.group.decision) return false;
      if (conflictStatuses(m).some(c => c.state !== 'resolved')) return false;
      if (fieldsApprovalCannotCover(m, i.flags || []).length > 0) return false;
      return true;
    }),
    [items, members],
  );

  const approveAllReady = () => {
    if (!readyToApprove.length) return;
    if (!reviewer.trim()) { reviewerRef.current?.focus(); return; }
    onUpdateMembers(readyToApprove.map(it => {
      const m = members[it.memberIndex!];
      return {
        index: it.memberIndex!,
        patch: { review: approvalFor(m, 'อนุมัติรายการค่าครบทั้งหมด') },
      };
    }));
  };

  const handleCreateMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddMember || !newTag.trim()) return;
    onAddMember(createBlankMember(newType, newTag, newLevel));
    setShowAddForm(false);
    setStep('items');
    setFilter('all');
  };

  // Active evidence for the sticky Left Pane SourceViewer
  const activeEvidence: EvidenceRef[] = useMemo(() => {
    if (step === 'table' && sectionEvidence.length > 0) return sectionEvidence;
    if (selected?.provenance?.evidence?.length) {
      return selected.provenance.evidence.map(e => ({ ...e, memberType: selected.memberType }));
    }
    const first = items.find(i => i.provenance?.evidence?.length);
    return first?.provenance?.evidence || [];
  }, [step, sectionEvidence, selected, items]);

  if (!items.length && !onAddMember) {
    return <div className={`rounded-2xl border p-8 text-center text-sm ${card} ${muted}`}>ยังไม่มีรายการ — อัปโหลดแบบหรือเลือกชุดข้อมูลก่อน</div>;
  }

  const renderInstanceField = (f: ReviewFieldDef) => {
    if (!member) return null;
    const src = (f.source && member.provenance?.fieldSources[f.source]) as FieldSource | undefined;
    const raw = (draft[f.key] ?? member[f.key] ?? '') as any;
    const value = raw === 0 && src === 'missing' && draft[f.key] === undefined ? '' : raw;
    const changed = draft[f.key] !== undefined;
    return (
      <div key={String(f.key)} className="px-3 py-2 text-xs space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-medium ${muted}`}>{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
          <div className="flex items-center gap-1">
            {src && src !== 'drawing' && src !== 'grid' && src !== 'reviewer' && !changed && value !== '' && (
              <button
                type="button"
                onClick={() => setDraft(d => ({ ...d, [f.key]: member[f.key] }))}
                className="px-1.5 py-0.5 rounded border border-violet-300 text-violet-700 text-[10px] font-semibold hover:bg-violet-50"
              >
                ยืนยันค่า
              </button>
            )}
            {src && (
              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${SOURCE_BADGE[changed ? 'reviewer' : src].cls}`}>
                {SOURCE_BADGE[changed ? 'reviewer' : src].th}
              </span>
            )}
          </div>
        </div>
        {f.kind === 'rebar' ? (
          <RebarInput
            value={String(value || '')}
            rebarKind={f.rebarKind}
            placeholder={src === 'missing' ? 'กรอกจากแบบ' : f.placeholder}
            onChange={next => setDraft(d => ({ ...d, [f.key]: next }))}
          />
        ) : f.kind === 'select' && f.options ? (
          <select
            value={String(value || f.options[0].value)}
            onChange={e => setDraft(d => ({ ...d, [f.key]: e.target.value }))}
            className={`w-full rounded-md border px-2 py-1 text-xs ${isLight ? 'border-slate-200 bg-white' : 'border-slate-700 bg-slate-950'}`}
          >
            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            value={value}
            type={f.kind === 'text' ? 'text' : 'number'}
            step="0.01"
            onChange={e => setDraft(d => ({ ...d, [f.key]: f.kind === 'text' ? e.target.value : Number(e.target.value) }))}
            placeholder={src === 'missing' ? 'กรอกจากแบบ' : f.placeholder}
            className={`w-full rounded-md border px-2 py-1 font-mono text-xs ${changed ? 'border-violet-400 ring-1 ring-violet-200' : isLight ? 'border-slate-200 bg-white' : 'border-slate-700 bg-slate-950'}`}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Top Bar: Progress + Real-time BOQ Totals + Reviewer + Add Member */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex-1 min-w-[14rem]">
            <div className="flex items-center gap-2 text-xs text-slate-700">
              <span>รอตรวจ <b className="text-amber-700 tabular-nums">{counts.todo}</b> / <span className="tabular-nums">{items.length}</span> รายการ</span>
              <span className="text-slate-300">|</span>
              <span className="font-mono text-slate-600">
                คอนกรีต <b className="text-slate-900">{totals.vol.toFixed(2)}</b> ลบ.ม. · ไม้แบบ <b className="text-slate-900">{totals.fw.toFixed(1)}</b> ตร.ม. · เหล็ก <b className="text-slate-900">{totals.rb.toFixed(0)}</b> กก.
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full overflow-hidden bg-slate-200 max-w-md">
              <div className="h-full bg-emerald-600 transition-all" style={{ width: `${reduction}%` }} />
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <span>ผู้ตรวจ</span>
            <input
              ref={reviewerRef}
              value={reviewer}
              onChange={e => onReviewerChange?.(e.target.value)}
              placeholder="ชื่อ (ต้องกรอกก่อนอนุมัติ)"
              className={`h-8 w-44 rounded-md border px-2 text-xs ${reviewer.trim() ? 'border-slate-300' : 'border-amber-400 ring-1 ring-amber-200'}`}
            />
          </label>

          {readyToApprove.length > 0 && (
            <button onClick={approveAllReady} className="h-8 px-3 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold">
              อนุมัติค่าครบ ({readyToApprove.length})
            </button>
          )}

          {onAddMember && (
            <button
              type="button"
              onClick={() => setShowAddForm(v => !v)}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>เพิ่มชิ้นส่วน</span>
            </button>
          )}
        </div>

        {/* Inline Add Member Drawer */}
        {showAddForm && onAddMember && (
          <form onSubmit={handleCreateMember} className="flex flex-wrap items-end gap-2 pt-2.5 border-t border-slate-100 bg-indigo-50/40 -mx-4 px-4 pb-1">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">ประเภทชิ้นส่วน</label>
              <select
                value={newType}
                onChange={e => {
                  const t = e.target.value as MemberType;
                  setNewType(t);
                  const defTag: Record<string, string> = { FOOTING: 'F1', COLUMN: 'C1', BEAM: 'B1', SLAB: 'S1', STAIR: 'ST1', WALL: 'W1' };
                  setNewTag(defTag[t] || 'M1');
                }}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
              >
                {ADD_TYPES.map(t => <option key={t} value={t}>{TYPE_TH[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">รหัส (Tag)</label>
              <input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                required
                placeholder="เช่น GB1, C2, F1"
                className="h-8 w-28 rounded-md border border-slate-300 bg-white px-2 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">ชั้น / ตำแหน่ง</label>
              <input
                value={newLevel}
                onChange={e => setNewLevel(e.target.value)}
                placeholder="ชั้น 1"
                className="h-8 w-32 rounded-md border border-slate-300 bg-white px-2 text-xs"
              />
            </div>
            <button type="submit" className="h-8 px-3.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold">
              บันทึกเพิ่มชิ้นส่วน
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="h-8 px-2.5 rounded-md border border-slate-300 bg-white text-xs text-slate-600">
              ยกเลิก
            </button>
          </form>
        )}

        {/* 3-Step Guided Stepper */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          {([
            ['codes', '1. พจนานุกรมรหัสโครงการ', BookOpen],
            ['table', '2. ตารางหน้าตัดตามเบอร์', Table2],
            ['items', `3. ตรวจรายชิ้น / ขัดแย้ง (${counts.todo})`, ListChecks],
            ['history', `ประวัติ (${reviewLog.filter(e => !e.undoneAt).length})`, History],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStep(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                step === id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Completeness Alert */}
      {completeness.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-900 space-y-1.5">
          <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> อาจขาดชิ้นส่วน ({completeness.length})</div>
          {completeness.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[16rem]">{c.message}</span>
              {c.suggested.length > 0 && onAddSuggested && (
                <button onClick={() => onAddSuggested(i)} className="shrink-0 h-7 px-2.5 rounded-md bg-rose-700 hover:bg-rose-800 text-white text-xs font-medium">
                  เพิ่ม {c.suggested.length} ชิ้นเข้าคิว
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* History Step (Full Width) */}
      {step === 'history' && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <ReviewHistory
            log={reviewLog}
            memberCount={members.length}
            onUndo={onUndo}
            onOpen={i => { const it = items.find(x => x.memberIndex === i); if (it && onOpenItem) onOpenItem(it); }}
          />
        </div>
      )}

      {/* Split-Screen Workspace for Steps 1, 2, 3 */}
      {step !== 'history' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* LEFT PANE (Sticky): SourceViewer + Key Plan Toggle */}
          <div className="xl:col-span-5 xl:sticky xl:top-[72px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setLeftTab('source')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    leftTab === 'source' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileImage className="w-3.5 h-3.5" />
                  <span>แบบต้นฉบับ (ซูมจุดอ่าน)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab('plan')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition-colors ${
                    leftTab === 'plan' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  <span>Key Plan</span>
                </button>
              </div>
              <span className="text-[11px] text-slate-400">
                {activeEvidence.length > 0 ? `พบ ${activeEvidence.length} ตำแหน่งอ้างอิง` : 'ไม่มีกรอบอ้างอิง'}
              </span>
            </div>

            {leftTab === 'source' ? (
              <SourceViewer
                docId={docId}
                evidence={activeEvidence}
                theme={theme}
                height={580}
                context={items
                  .filter(i => i.itemId !== selected?.itemId)
                  .map(i => {
                    const ev = i.provenance?.evidence?.[0];
                    return ev ? { ...ev, memberType: i.memberType } : undefined;
                  })
                  .filter(Boolean) as any}
              />
            ) : (
              <div className="max-h-[600px] overflow-auto">
                <PlanView
                  readings={readings}
                  items={items}
                  onSelectItem={it => {
                    setSelectedId(it.itemId);
                    setStep('items');
                  }}
                />
              </div>
            )}
          </div>

          {/* RIGHT PANE: Guided 3-Step Review Form */}
          <div className="xl:col-span-7 min-w-0 space-y-3">
            {step === 'codes' && (
              <ProjectCodePanel
                members={members}
                pages={ocrPages}
                reviewer={reviewer}
                onUpdateMembers={onUpdateMembers}
                onContinue={() => setStep('table')}
              />
            )}

            {step === 'table' && (
              <SectionTable
                items={items}
                members={members}
                docId={docId}
                theme={theme}
                onUpdateMembers={onUpdateMembers}
                canApprove={!!reviewer.trim()}
                onRequestReviewer={() => reviewerRef.current?.focus()}
                hideSourceViewer
                onEvidenceChange={handleSectionEvidence}
              />
            )}

            {step === 'items' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                {/* Item Queue */}
                <div className={`lg:col-span-4 rounded-xl border flex flex-col ${card}`} style={{ maxHeight: 680 }}>
                  <div className="p-2 grid grid-cols-3 gap-1 text-[11px] border-b border-slate-100">
                    {([
                      ['todo', 'ต้องตรวจ'], ['spot', 'สุ่มตรวจ'], ['done', 'ตรวจแล้ว'], ['auto', 'อัตโนมัติ'], ['all', 'ทั้งหมด'],
                    ] as [QueueFilter, string][]).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => { setFilter(k); setSelectedId(null); }}
                        className={`px-1.5 py-1 rounded-md border ${
                          filter === k ? 'bg-indigo-600 border-indigo-600 text-white font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {label} <span className="opacity-75">{counts[k]}</span>
                      </button>
                    ))}
                  </div>
                  <div ref={listRef} className="overflow-y-auto p-1.5 space-y-1">
                    {queue.length === 0 && <div className={`text-xs text-center py-8 ${muted}`}>{filter === 'todo' ? 'ไม่มีรายการค้างตรวจ' : 'ไม่มีรายการ'}</div>}
                    {queue.map(it => {
                      const isSel = selected?.itemId === it.itemId;
                      const topFlag = (it.flags || []).find(f => f.severity === 'block') || (it.flags || []).find(f => f.severity === 'warn');
                      return (
                        <button
                          key={it.itemId}
                          data-selected={isSel}
                          onClick={() => setSelectedId(it.itemId)}
                          className={`w-full text-left p-2 rounded-lg border text-xs transition-colors ${
                            isSel ? 'bg-indigo-50 border-indigo-300' : 'border-transparent hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            {it.review?.status === 'approved' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              : it.review?.status === 'rejected' || it.status === 'REJECTED' ? <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              : it.status === 'NEEDS_REVIEW' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              : <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                            <span className="font-bold font-mono">{it.tag}</span>
                            <span className={`truncate ${muted}`}>{it.gridLocation}</span>
                            <span className={`ml-auto font-mono text-[10px] px-1 rounded ${
                              (it.confidencePct ?? 100) >= 80 ? 'bg-emerald-100 text-emerald-700' : (it.confidencePct ?? 100) >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                            }`}>{it.confidencePct ?? '-'}%</span>
                          </div>
                          {topFlag && !it.review && <div className={`truncate mt-0.5 text-[11px] ${topFlag.severity === 'block' ? 'text-rose-600' : 'text-amber-600'}`}>{topFlag.message}</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Member Inspector & Decision Form */}
                <div className={`lg:col-span-8 rounded-xl border p-4 space-y-3 shadow-sm ${card}`}>
                  {selected && member ? (
                    <>
                      <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <input
                              aria-label="แก้ไข Tag รายชิ้น"
                              value={String(draft.tag ?? member.tag)}
                              onChange={e => setDraft(d => ({ ...d, tag: e.target.value.toUpperCase() }))}
                              className="w-24 px-2 py-0.5 rounded border border-slate-300 font-mono font-bold text-sm text-slate-900"
                            />
                            <span className="text-xs font-semibold text-slate-500">{TYPE_TH[selected.memberType] || selected.memberType} · {selected.itemId}</span>
                          </div>
                          <div className={`text-xs ${muted}`}>{selected.gridLocation} · {selected.level}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => move(-1)} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
                          <button onClick={() => move(1)} className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
                          {onDeleteMember && selected.memberIndex !== undefined && (
                            <button
                              type="button"
                              title="ลบชิ้นส่วนนี้ออกจากโครงการ"
                              onClick={() => onDeleteMember(selected.memberIndex!)}
                              className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 ml-1"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {selected.review && (
                        <div className={`text-xs p-2 rounded-lg border flex items-center gap-2 ${selected.review.status === 'approved' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                          {selected.review.status === 'approved' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                          {selected.review.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่นับรายการนี้'}{selected.review.note ? ` — ${selected.review.note}` : ''}
                          <button onClick={() => decide(null)} className="ml-auto inline-flex items-center gap-1 underline"><Undo2 className="w-3 h-3" />ยกเลิก</button>
                        </div>
                      )}

                      {selected.duplicate && selected.duplicate.group.classification !== 'SAME_SPECIFICATION' && (
                        <DuplicatePanel
                          key={`${selected.itemId}:${selected.duplicate.group.key}:${selected.duplicate.group.decision?.at ?? 'none'}`}
                          group={selected.duplicate.group}
                          items={items}
                          members={members}
                          reviewer={reviewer}
                          revision={revision}
                          onAskReviewer={() => reviewerRef.current?.focus()}
                          onDecide={onUpdateMembers}
                          onOpenItem={id => setSelectedId(id)}
                        />
                      )}

                      {member && selected.memberIndex !== undefined && !!selected.conflicts?.length && (
                        <ConflictPanel
                          key={selected.itemId}
                          member={member}
                          conflicts={selected.conflicts}
                          approvalState={selected.approvalState}
                          reviewer={reviewer}
                          revision={revision}
                          onAskReviewer={() => reviewerRef.current?.focus()}
                          onResolve={patch => onUpdateMembers([{ index: selected.memberIndex!, patch }])}
                        />
                      )}

                      {selected.approvalState === 'STALE' && (
                        <div data-stale className="text-xs p-2 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 space-y-1">
                          <div className="font-semibold">อนุมัติหมดอายุ — ค่าที่ใช้คำนวณเปลี่ยน ต้องอนุมัติใหม่</div>
                          <ul className="list-disc pl-4 font-mono break-all">{(selected.staleChanges || []).map((c, i) => <li key={i}>{c}</li>)}</ul>
                        </div>
                      )}

                      {/* Flags */}
                      <div className="space-y-1">
                        {(selected.flags || []).length === 0 && selected.rejectionReasons.length === 0 && (
                          <div className="text-xs flex items-center gap-1.5 text-emerald-700"><ShieldCheck className="w-4 h-4" /> ไม่มีข้อสงสัย</div>
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

                      {/* Live Cross-Section Diagram */}
                      <MemberDiagram item={selected} lang="th" theme={theme} />

                      {/* Unified Complete Fields */}
                      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                        {fieldsForInstance(member.memberType).map(renderInstanceField)}
                      </div>

                      {member.memberType === 'FOOTING' && (() => {
                        const cmode = ('coverMode' in draft ? draft.coverMode : member.coverMode) || '';
                        const cm = (draft.coveringCm ?? member.coveringCm ?? '') as number | '';
                        return (
                          <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs space-y-1.5" data-cover-block>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`w-20 shrink-0 ${muted}`}>ระยะหุ้ม</span>
                              <select value={cmode} onChange={e => setDraft(d => ({ ...d, coverMode: (e.target.value || undefined) as ExtractedMember['coverMode'] }))}
                                className="rounded-md border border-slate-200 px-2 py-1">
                                <option value="">อัตโนมัติ (ชิ้นนี้ → สเปก → ค่ามาตรฐาน)</option>
                                <option value="FROM_DRAWING">จากแบบ</option>
                                <option value="FROM_PROJECT_SPEC">ตามสเปกโครงการ</option>
                                <option value="MANUAL">กรอกเอง</option>
                              </select>
                              {cmode === 'MANUAL' && (
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

                      {/* Resulting Quantities */}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                          ['คอนกรีต', selected.volumeNetM3.toFixed(3), 'ลบ.ม.'],
                          ['ไม้แบบ', selected.formworkNetM2.toFixed(2), 'ตร.ม.'],
                          ['เหล็ก', (selected.rebarWeightKg || 0).toFixed(1), 'กก.'],
                        ].map(([l, v, u]) => (
                          <div key={l} className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                            <div className={`text-[10px] ${muted}`}>{l}</div>
                            <div className="font-mono font-bold text-sm">{v}</div>
                            <div className={`text-[10px] ${muted}`}>{u}</div>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-mono break-words space-y-1 text-slate-700">
                        <div><span className={`font-sans font-semibold ${muted}`}>สูตรคอนกรีต/ไม้แบบ: </span>{selected.formulaStr}</div>
                        {selected.rebarFormulaStr && <div><span className={`font-sans font-semibold ${muted}`}>สูตรเหล็กเสริม: </span>{selected.rebarFormulaStr}</div>}
                      </div>

                      <input
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="หมายเหตุผู้ตรวจ (ไม่บังคับ)"
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                      />

                      {openFields.length > 0 && (
                        <div className="text-[11px] text-amber-700">การอนุมัติทั้งชิ้นไม่ครอบช่อง {openFields.join(', ')} — แก้หรือกด "ยืนยันค่า" ในช่องนั้น แล้วบันทึก</div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => decide('approved')} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">
                          <CheckCircle2 className="w-4 h-4" /> {Object.keys(draft).length ? 'บันทึก + อนุมัติ' : 'อนุมัติ'} (A)
                        </button>
                        <button onClick={() => decide('rejected')} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-bold">
                          <XCircle className="w-4 h-4" /> ไม่นับ (X)
                        </button>
                      </div>
                      {Object.keys(draft).length > 0 && (
                        <button onClick={() => decide(selected.review?.status === 'rejected' ? 'rejected' : null)} className="w-full text-xs inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50">
                          <Eye className="w-3.5 h-3.5" /> บันทึกค่าแล้วดูผลก่อน (ยังไม่อนุมัติ)
                        </button>
                      )}
                    </>
                  ) : (
                    <div className={`text-sm py-8 text-center ${muted}`}>เลือกรายการจากคิวทางซ้ายเพื่อตรวจสอบ</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
