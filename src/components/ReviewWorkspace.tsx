import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, XCircle, ChevronLeft, ChevronRight, AlertTriangle,
  Info, Undo2, Eye, Plus, Trash2, BookOpen, Table2, ListChecks, History,
} from 'lucide-react';
import type { CalculatedQuantity, EvidenceRef, ExtractedMember, FieldSource, MemberType, ReviewDecision } from '../engine/qsEngine';
import { approvalFor, conflictStatuses, fieldsApprovalCannotCover } from '../engine/qsEngine';
import type { CompletenessFinding } from '../engine/sheetMerge';
import type { PageOcr } from '../pdf/types';
import type { ReviewLogEntry } from '../engine/reviewLog';
import { FootingRebarSets } from './FootingRebarSets';
import { ConflictPanel } from './ConflictPanel';
import { DuplicatePanel } from './DuplicatePanel';
import { SourceViewer } from './SourceViewer';
import { SectionTable, TYPE_TH, SOURCE_BADGE } from './SectionTable';
import { ReviewHistory } from './ReviewHistory';
import { ProjectCodePanel } from './ProjectCodePanel';
import { RebarInput } from './RebarInput';
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
  ocrPages = [],
  reviewLog = [],
  onUndo,
  onOpenItem,
  reviewer = '',
  onReviewerChange,
  revision,
}) => {
  const [filter, setFilter] = useState<QueueFilter>('todo');
  const [step, setStep] = useState<ReviewStep>('table');
  const [sectionEvidence, setSectionEvidence] = useState<EvidenceRef[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ExtractedMember>>({});
  const [applyToSameTag, setApplyToSameTag] = useState(true);
  const [note, setNote] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState<MemberType>('BEAM');
  const [newTag, setNewTag] = useState('B1');
  const [newLevel, setNewLevel] = useState('ชั้น 1');

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

  const activeEvidence: EvidenceRef[] = useMemo(() => {
    if (step === 'table' && sectionEvidence.length > 0) return sectionEvidence;
    if (selected?.provenance?.evidence?.length) {
      return selected.provenance.evidence.map(e => ({ ...e, memberType: selected.memberType }));
    }
    const first = items.find(i => i.provenance?.evidence?.length);
    return first?.provenance?.evidence || [];
  }, [step, sectionEvidence, selected, items]);

  if (!items.length && !onAddMember) {
    return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">ยังไม่มีรายการ — อัปโหลดแบบหรือเลือกชุดข้อมูลก่อน</div>;
  }

  const renderInstanceField = (f: ReviewFieldDef) => {
    if (!member) return null;
    const src = (f.source && member.provenance?.fieldSources[f.source]) as FieldSource | undefined;
    const raw = (draft[f.key] ?? member[f.key] ?? '') as any;
    const value = raw === 0 && src === 'missing' && draft[f.key] === undefined ? '' : raw;
    const changed = draft[f.key] !== undefined;
    return (
      <div key={String(f.key)} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-slate-700">{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
          <div className="flex items-center gap-1">
            {src && src !== 'drawing' && src !== 'grid' && src !== 'reviewer' && !changed && value !== '' && (
              <button
                type="button"
                onClick={() => setDraft(d => ({ ...d, [f.key]: member[f.key] }))}
                className="px-1.5 py-0.5 rounded border border-slate-300 text-slate-700 text-[11px] font-medium hover:bg-slate-100"
              >
                ยืนยันค่า
              </button>
            )}
            {src && (
              <span className={`px-1.5 py-0.5 rounded border text-[11px] font-medium ${SOURCE_BADGE[changed ? 'reviewer' : src].cls}`}>
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
            className="w-full h-10 rounded-lg border border-slate-200 hover:border-slate-300 focus:border-slate-900 px-3 text-sm bg-white outline-none transition-colors"
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
            className={`w-full h-10 rounded-lg border px-3 font-mono text-sm outline-none transition-colors ${
              changed ? 'border-slate-900 ring-1 ring-slate-200 bg-white' : 'border-slate-200 hover:border-slate-300 focus:border-slate-900 bg-white'
            }`}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Calm Swiss Control Strip */}
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Segmented Stepper */}
          <div className="inline-flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {([
              ['codes', '1. รหัสโครงการ', BookOpen],
              ['table', '2. หน้าตัดตามเบอร์', Table2],
              ['items', `3. ตรวจรายชิ้น (${counts.todo})`, ListChecks],
              ['history', `ประวัติ (${reviewLog.filter(e => !e.undoneAt).length})`, History],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStep(id)}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-all ${
                  step === id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Right Controls: Reviewer + Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={reviewerRef}
              aria-label="ชื่อผู้ตรวจ"
              value={reviewer}
              onChange={e => onReviewerChange?.(e.target.value)}
              placeholder="ชื่อผู้ตรวจ (กรอกก่อนอนุมัติ)"
              className={`h-9 w-48 rounded-lg border px-3 text-xs outline-none transition-colors ${
                reviewer.trim() ? 'border-slate-200 focus:border-slate-900' : 'border-amber-400 bg-amber-50/40 focus:border-[#EA580C]'
              }`}
            />
            {readyToApprove.length > 0 && (
              <button onClick={approveAllReady} className="h-9 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors">
                อนุมัติที่พร้อม ({readyToApprove.length})
              </button>
            )}
            {onAddMember && (
              <button
                type="button"
                onClick={() => setShowAddForm(v => !v)}
                className="inline-flex items-center gap-1 h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>เพิ่มชิ้นส่วน</span>
              </button>
            )}
          </div>
        </div>

        {/* Quiet KPI & Progress Line */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-2.5 border-t border-slate-100 text-xs text-slate-600">
          <div className="flex items-center gap-2.5 min-w-[12rem]">
            <span>คืบหน้า <b className="font-mono text-slate-900">{reduction}%</b></span>
            <div className="w-28 h-1.5 rounded-full overflow-hidden bg-slate-200">
              <div className="h-full bg-[#EA580C] transition-all" style={{ width: `${reduction}%` }} />
            </div>
            <span className="text-slate-400">รอตรวจ {counts.todo}/{items.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 font-mono">
            <span>คอนกรีต <b className="text-slate-900">{totals.vol.toFixed(2)}</b> ลบ.ม.</span>
            <span>ไม้แบบ <b className="text-slate-900">{totals.fw.toFixed(1)}</b> ตร.ม.</span>
            <span>เหล็ก <b className="text-slate-900">{totals.rb.toFixed(0)}</b> กก.</span>
          </div>
        </div>

        {/* Inline Add Member Drawer */}
        {showAddForm && onAddMember && (
          <form onSubmit={handleCreateMember} className="flex flex-wrap items-end gap-3 pt-3 border-t border-slate-100">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">ประเภท</label>
              <select
                value={newType}
                onChange={e => {
                  const t = e.target.value as MemberType;
                  setNewType(t);
                  const defTag: Record<string, string> = { FOOTING: 'F1', COLUMN: 'C1', BEAM: 'B1', SLAB: 'S1', STAIR: 'ST1', WALL: 'W1' };
                  setNewTag(defTag[t] || 'M1');
                }}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
              >
                {ADD_TYPES.map(t => <option key={t} value={t}>{TYPE_TH[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">รหัส (Tag)</label>
              <input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                required
                placeholder="เช่น GB1, C2"
                className="h-9 w-28 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">ชั้น</label>
              <input
                value={newLevel}
                onChange={e => setNewLevel(e.target.value)}
                placeholder="ชั้น 1"
                className="h-9 w-28 rounded-lg border border-slate-200 bg-white px-2.5 text-xs"
              />
            </div>
            <button type="submit" className="h-9 px-4 rounded-lg bg-[#EA580C] hover:bg-[#C2410C] text-white text-xs font-semibold">
              บันทึกเพิ่ม
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
              ยกเลิก
            </button>
          </form>
        )}
      </div>

      {/* Collapsible Completeness Notice (1 clean line instead of 4 loud crimson bars) */}
      {completeness.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900">
          <summary className="cursor-pointer font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#EA580C] shrink-0" />
            <span>อาจมีชิ้นส่วนตกหล่น {completeness.length} รายการ (กดเพื่อดูและเพิ่มเข้าคิว)</span>
          </summary>
          <div className="mt-2.5 pt-2.5 border-t border-amber-200/70 space-y-2">
            {completeness.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span>{c.message}</span>
                {c.suggested.length > 0 && onAddSuggested && (
                  <button onClick={() => onAddSuggested(i)} className="h-7 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shrink-0">
                    + เพิ่ม {c.suggested.length} ชิ้นเข้าคิว
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* History Step */}
      {step === 'history' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <ReviewHistory
            log={reviewLog}
            memberCount={members.length}
            onUndo={onUndo}
            onOpen={i => { const it = items.find(x => x.memberIndex === i); if (it && onOpenItem) onOpenItem(it); }}
          />
        </div>
      )}

      {/* Spacious 50/50 Split-Screen Workspace */}
      {step !== 'history' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT PANE (Sticky 50%): Pure SourceViewer */}
          <div className="lg:col-span-6 lg:sticky lg:top-[76px] rounded-xl border border-slate-200 bg-white p-3">
            <SourceViewer
              docId={docId}
              evidence={activeEvidence}
              theme={theme}
              height={640}
              context={items
                .filter(i => i.itemId !== selected?.itemId)
                .map(i => {
                  const ev = i.provenance?.evidence?.[0];
                  return ev ? { ...ev, memberType: i.memberType } : undefined;
                })
                .filter(Boolean) as any}
            />
          </div>

          {/* RIGHT PANE (50%): Clean Guided Review Form */}
          <div className="lg:col-span-6 min-w-0 space-y-4">
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
                onJumpToItem={(id) => {
                  setFilter('todo');
                  setSelectedId(id);
                  setStep('items');
                }}
              />
            )}

            {step === 'items' && (
              <div className="space-y-4">
                {/* Clean Queue Selector */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {([
                      ['todo', 'ต้องตรวจ'], ['spot', 'สุ่มตรวจ'], ['done', 'ตรวจแล้ว'], ['auto', 'อัตโนมัติ'], ['all', 'ทั้งหมด'],
                    ] as [QueueFilter, string][]).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => { setFilter(k); setSelectedId(null); }}
                        className={`px-2.5 py-1 rounded-lg border transition-colors ${
                          filter === k ? 'bg-slate-900 border-slate-900 text-white font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {label} <span className="opacity-75">{counts[k]}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => move(-1)} className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700" title="ก่อนหน้า (K)">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <select
                      aria-label="เลือกรายการตรวจ"
                      value={selected?.itemId || ''}
                      onChange={e => setSelectedId(e.target.value)}
                      className="flex-1 h-10 rounded-lg border border-slate-200 focus:border-slate-900 bg-white px-3 text-xs font-mono text-slate-900 outline-none"
                    >
                      {queue.length === 0 && <option value="">ไม่มีรายการในหมวดนี้</option>}
                      {queue.map((it, idx) => (
                        <option key={it.itemId} value={it.itemId}>
                          {idx + 1}/{queue.length} · {it.tag} ({TYPE_TH[it.memberType] || it.memberType}) · {it.gridLocation} [{it.confidencePct ?? '-'}%]
                        </option>
                      ))}
                    </select>
                    <button onClick={() => move(1)} className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700" title="ถัดไป (J)">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Clean Member Inspector */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                  {selected && member ? (
                    <>
                      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <input
                            aria-label="แก้ไข Tag รายชิ้น"
                            value={String(draft.tag ?? member.tag)}
                            onChange={e => setDraft(d => ({ ...d, tag: e.target.value.toUpperCase() }))}
                            className="w-44 h-9 px-2.5 rounded-lg border border-slate-200 focus:border-slate-900 font-mono font-bold text-sm text-slate-900 outline-none"
                          />
                          <span className="px-2.5 py-1 rounded-md bg-slate-100 text-xs font-semibold text-slate-700">{TYPE_TH[selected.memberType] || selected.memberType}</span>
                          <span className="text-xs text-slate-500">{selected.gridLocation} · {selected.level}</span>
                        </div>
                        {onDeleteMember && selected.memberIndex !== undefined && (
                          <button
                            type="button"
                            onClick={() => onDeleteMember(selected.memberIndex!)}
                            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50 text-xs transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>ลบ</span>
                          </button>
                        )}
                      </div>

                      {selected.review && (
                        <div className={`text-xs px-3.5 py-2.5 rounded-lg border flex items-center gap-2 ${selected.review.status === 'approved' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                          {selected.review.status === 'approved' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                          <span>{selected.review.status === 'approved' ? 'อนุมัติแล้ว' : 'ไม่นับรายการนี้'}{selected.review.note ? ` — ${selected.review.note}` : ''}</span>
                          <button onClick={() => decide(null)} className="ml-auto inline-flex items-center gap-1 underline"><Undo2 className="w-3 h-3" />ยกเลิก</button>
                        </div>
                      )}

                      {selected.duplicate && selected.duplicate.group.classification !== 'SAME_SPECIFICATION' && (
                        selected.duplicate.group.blocking ? (
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
                        ) : (
                          <details className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-600">
                            <summary className="cursor-pointer font-medium">
                              เบอร์เดียวกัน {selected.duplicate.group.occurrences.length} ตำแหน่ง (คนละชิ้น · ไม่ต้องตัดสิน)
                            </summary>
                            <div className="mt-2">
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
                            </div>
                          </details>
                        )
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
                        <div data-stale className="text-xs p-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-900 space-y-1">
                          <div className="font-semibold">อนุมัติหมดอายุ — ค่าที่ใช้คำนวณเปลี่ยน ต้องอนุมัติใหม่</div>
                          <ul className="list-disc pl-4 font-mono break-all">{(selected.staleChanges || []).map((c, i) => <li key={i}>{c}</li>)}</ul>
                        </div>
                      )}

                      {((selected.flags || []).length > 0 || selected.rejectionReasons.length > 0) && (
                        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-2.5 space-y-1">
                          {selected.rejectionReasons.map((r, i) => (
                            <div key={'r' + i} className="text-xs flex gap-1.5 text-rose-700"><XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{r}</div>
                          ))}
                          {(selected.flags || []).map((f, i) => (
                            <div key={i} className={`text-xs flex gap-1.5 ${f.severity === 'block' ? 'text-rose-700' : f.severity === 'warn' ? 'text-amber-800' : 'text-slate-500'}`}>
                              {f.severity === 'info' ? <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                              {f.message}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Spacious 2-column form */}
                      <div className="grid sm:grid-cols-2 gap-4">
                        {fieldsForInstance(member.memberType).map(renderInstanceField)}
                      </div>

                      {member.memberType === 'FOOTING' && (() => {
                        const cmode = ('coverMode' in draft ? draft.coverMode : member.coverMode) || '';
                        const cm = (draft.coveringCm ?? member.coveringCm ?? '') as number | '';
                        return (
                          <div className="rounded-lg border border-slate-200 px-3.5 py-2.5 text-xs space-y-2" data-cover-block>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-600">ระยะหุ้ม</span>
                              <select value={cmode} onChange={e => setDraft(d => ({ ...d, coverMode: (e.target.value || undefined) as ExtractedMember['coverMode'] }))}
                                className="h-9 rounded-lg border border-slate-200 px-2.5 bg-white">
                                <option value="">อัตโนมัติ (ชิ้นนี้ → สเปก → มาตรฐาน)</option>
                                <option value="FROM_DRAWING">จากแบบ</option>
                                <option value="FROM_PROJECT_SPEC">ตามสเปกโครงการ</option>
                                <option value="MANUAL">กรอกเอง</option>
                              </select>
                              {cmode === 'MANUAL' && (
                                <input type="number" step="0.5" value={cm} placeholder="ซม."
                                  onChange={e => setDraft(d => ({ ...d, coveringCm: e.target.value === '' ? undefined : Number(e.target.value) }))}
                                  className="h-9 w-20 rounded-lg border border-slate-200 px-2.5 font-mono" />
                              )}
                            </div>
                            {selected.coverM !== undefined && (
                              <div className="text-slate-500">
                                ใช้จริง <b className="font-mono text-slate-800">{(selected.coverM * 100).toFixed(1)} ซม.</b> · {COVER_SOURCE_TH[selected.coverSource || ''] || selected.coverSource}
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
                        <label className="flex items-center gap-2 text-xs text-slate-700">
                          <input type="checkbox" checked={applyToSameTag} onChange={e => setApplyToSameTag(e.target.checked)} />
                          ใช้ค่าที่แก้กับ {member.tag} ทุกตำแหน่ง ({sameTag.length} ชิ้น)
                        </label>
                      )}

                      {/* Resulting Quantities Strip */}
                      <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                        {[
                          ['คอนกรีต', selected.volumeNetM3.toFixed(3), 'ลบ.ม.'],
                          ['ไม้แบบ', selected.formworkNetM2.toFixed(2), 'ตร.ม.'],
                          ['เหล็กเสริม', (selected.rebarWeightKg || 0).toFixed(1), 'กก.'],
                        ].map(([l, v, u]) => (
                          <div key={l} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                            <div className="text-[11px] text-slate-500">{l}</div>
                            <div className="font-mono font-bold text-base text-slate-900">{v} <span className="text-[11px] font-normal text-slate-500">{u}</span></div>
                          </div>
                        ))}
                      </div>

                      <input
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="หมายเหตุผู้ตรวจ (ไม่บังคับ)"
                        className="w-full h-9 rounded-lg border border-slate-200 focus:border-slate-900 px-3 text-xs outline-none"
                      />

                      {openFields.length > 0 && (
                        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          ต้องแก้หรือกด "ยืนยันค่า" ในช่อง: {openFields.join(', ')} ก่อนอนุมัติ
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2.5">
                        <button onClick={() => decide('approved')} className="h-10 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{Object.keys(draft).length ? 'บันทึก + อนุมัติ' : 'อนุมัติ'} (A)</span>
                        </button>
                        <button onClick={() => decide('rejected')} className="h-10 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-slate-700 hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50 text-sm font-semibold transition-colors">
                          <XCircle className="w-4 h-4" />
                          <span>ไม่นับ (X)</span>
                        </button>
                      </div>
                      {Object.keys(draft).length > 0 && (
                        <button onClick={() => decide(selected.review?.status === 'rejected' ? 'rejected' : null)} className="w-full h-9 text-xs inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                          <Eye className="w-3.5 h-3.5" /> บันทึกค่าแล้วดูผลก่อน (ยังไม่อนุมัติ)
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="text-sm py-10 text-center text-slate-400">ไม่มีรายการในหมวดนี้</div>
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
