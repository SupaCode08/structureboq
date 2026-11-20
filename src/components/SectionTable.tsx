import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers, ArrowRight } from 'lucide-react';
import type { CalculatedQuantity, ExtractedMember, FieldSource, MemberType, EvidenceRef } from '../engine/qsEngine';
import { approvalFor, conflictStatuses, rebarSetsFromNote, unconfirmedRequiredFields } from '../engine/qsEngine';
import { FootingRebarSets } from './FootingRebarSets';
import { SourceViewer } from './SourceViewer';
import { MemberDiagram } from './MemberDiagram';
import { RebarInput } from './RebarInput';
import { fieldsForSection, type ReviewFieldDef } from './reviewFields';

interface SectionTableProps {
  items: CalculatedQuantity[];
  members: ExtractedMember[];
  docId?: string;
  pageUrl?: (page: number, dpi: number) => Promise<string>;
  theme?: 'light' | 'dark';
  onUpdateMembers: (updates: { index: number; patch: Partial<ExtractedMember> }[]) => void;
  canApprove?: boolean;
  onRequestReviewer?: () => void;
  hideSourceViewer?: boolean;
  onEvidenceChange?: (evidence: EvidenceRef[]) => void;
  onJumpToItem?: (itemId: string) => void;
}

export const TYPE_TH: Record<string, string> = {
  FOOTING: 'ฐานราก',
  COLUMN: 'เสา',
  BEAM: 'คาน',
  SLAB: 'พื้น',
  STAIR: 'บันได',
  WALL: 'ผนัง',
  DOOR: 'ประตู',
  WINDOW: 'หน้าต่าง',
  FINISH: 'ผิวตกแต่ง',
};

export const SOURCE_BADGE: Record<FieldSource, { th: string; cls: string }> = {
  drawing: { th: 'จากแบบ', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  grid: { th: 'จากกริด', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  inferred: { th: 'อนุมาน', cls: 'text-slate-600 bg-slate-100 border-slate-200' },
  assumed: { th: 'ค่าสมมติ', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  missing: { th: 'ไม่พบ', cls: 'text-rose-700 bg-rose-50 border-rose-200' },
  reviewer: { th: 'ผู้ตรวจ', cls: 'text-slate-900 bg-slate-100 border-slate-300' },
};

const blankZero = (v: any) => (v === 0 || v === undefined || v === null ? '' : v);

export const SectionTable: React.FC<SectionTableProps> = ({
  items,
  members,
  pageUrl,
  theme = 'light',
  onUpdateMembers,
  canApprove = true,
  onRequestReviewer,
  hideSourceViewer = false,
  onEvidenceChange,
  onJumpToItem,
}) => {
  const [drafts, setDrafts] = useState<Record<string, Partial<ExtractedMember>>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  const [showDiagram, setShowDiagram] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const groups = useMemo(() => {
    const g = new Map<string, { key: string; tag: string; type: MemberType; idx: number[]; items: CalculatedQuantity[] }>();
    members.forEach((m, i) => {
      const k = `${m.memberType}:${m.tag}`;
      const e = g.get(k) || { key: k, tag: m.tag, type: m.memberType, idx: [], items: [] };
      e.idx.push(i);
      const it = items.find(x => x.memberIndex === i);
      if (it) e.items.push(it);
      g.set(k, e);
    });
    const order: MemberType[] = ['FOOTING', 'COLUMN', 'BEAM', 'SLAB', 'STAIR', 'WALL', 'DOOR', 'WINDOW', 'FINISH'];
    return [...g.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.tag.localeCompare(b.tag));
  }, [members, items]);

  const needsOf = (g: typeof groups[number]) => g.items.filter(it => it.status === 'NEEDS_REVIEW' && !it.review).length;
  const pending = groups.filter(g => needsOf(g) > 0).length;
  const open = groups.find(g => g.key === openKey) || groups.find(g => needsOf(g) > 0) || groups[0];

  useEffect(() => {
    if (open && open.key !== openKey) setOpenKey(open.key);
    setFeedback(null);
  }, [open?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = (g: typeof groups[number], f: ReviewFieldDef) => blankZero(drafts[g.key]?.[f.key] ?? members[g.idx[0]][f.key]);
  const source = (g: typeof groups[number], f: ReviewFieldDef): FieldSource | undefined => {
    if (drafts[g.key]?.[f.key] !== undefined) return 'reviewer';
    if (!f.source) return undefined;
    const srcs = g.idx.map(i => members[i].provenance?.fieldSources[f.source!]).filter(Boolean) as FieldSource[];
    if (!srcs.length) return undefined;
    return srcs.includes('missing') ? 'missing' : srcs.includes('assumed') ? 'assumed' : srcs.includes('inferred') ? 'inferred' : srcs[0];
  };

  const setDraftField = (key: string, field: keyof ExtractedMember, val: any) => {
    setDrafts(d => ({ ...d, [key]: { ...d[key], [field]: val } }));
  };

  const confirm = (g: typeof groups[number]) => {
    setFeedback(null);
    if (!canApprove) {
      onRequestReviewer?.();
      setFeedback('กรุณากรอกชื่อ "ผู้ตรวจ" ด้านบนก่อนกดยืนยัน');
      return;
    }
    const draft = drafts[g.key] || {};
    const fields = fieldsForSection(g.type);
    let approvedCount = 0;
    const reasons = new Set<string>();
    onUpdateMembers(g.idx.map(i => {
      const m = members[i];
      const fs = { ...(m.provenance?.fieldSources || {}) };
      for (const f of fields) {
        if (!f.source) continue;
        if (draft[f.key] !== undefined) fs[f.source] = 'reviewer';
        else if (fs[f.source] === 'inferred' || fs[f.source] === 'assumed') fs[f.source] = 'reviewer';
      }
      const provenance = m.provenance && {
        ...m.provenance, fieldSources: fs, confidence: Math.max(m.provenance.confidence, 0.9),
        conflicts: (m.provenance.conflicts || []).filter(c => !c.startsWith('ไม่พบแบบขยาย')),
      };
      const merged = { ...m, ...draft, provenance };
      const stillMissing = !(Number(merged.width) > 0 && Number(merged.depth) > 0 && Number(merged.length) > 0);
      const unconfirmed = unconfirmedRequiredFields(merged);
      const openConflicts = conflictStatuses(merged).filter(c => c.state !== 'resolved');
      if (stillMissing) reasons.add('ยังมีมิติหลัก (กว้าง/ยาว/หนา) เป็น 0 หรือว่าง');
      if (unconfirmed.length > 0) reasons.add(`ยังมีช่องที่ต้องยืนยันในขั้นที่ 3: ${unconfirmed.join(', ')}`);
      if (openConflicts.length > 0) reasons.add(`มีข้อขัดแย้งระหว่างแบบ ${openConflicts.length} จุด`);
      const approvable = !stillMissing && unconfirmed.length === 0 && openConflicts.length === 0;
      if (approvable) approvedCount++;
      return {
        index: i,
        patch: {
          ...draft,
          provenance,
          review: approvable ? approvalFor(merged, `ยืนยันหน้าตัด ${merged.tag}`) : m.review,
        },
      };
    }));
    setDrafts(d => { const n = { ...d }; delete n[g.key]; return n; });
    if (approvedCount === g.idx.length) {
      const next = groups.find(x => x.key !== g.key && needsOf(x) > 0);
      if (next) setOpenKey(next.key);
    } else if (reasons.size > 0) {
      setFeedback(`บันทึกค่าแล้ว แต่ยังอนุมัติ ${g.tag} ไม่ครบ: ${[...reasons].join(' · ')}`);
    }
  };

  const evidence = useMemo(() => {
    if (!open) return [] as EvidenceRef[];
    const all = open.idx.flatMap(i => members[i].provenance?.evidence || []);
    const detail = all.find(e => e.label.startsWith('แบบขยาย'));
    const plans = all.filter(e => !e.label.startsWith('แบบขยาย'));
    const seen = new Set<string>();
    return [...(detail ? [{ ...detail, label: 'แบบขยาย' }] : []), ...plans.map((e, k) => ({ ...e, label: `ตำแหน่ง ${k + 1}` }))]
      .filter(e => { const s = `${e.page}:${e.bboxNorm?.join(',')}`; if (seen.has(s)) return false; seen.add(s); return true; })
      .slice(0, 12);
  }, [open, members]);

  useEffect(() => {
    onEvidenceChange?.(evidence);
  }, [evidence, onEvidenceChange]);

  if (!open) return null;

  const allFields = fieldsForSection(open.type);
  const dimFields = allFields.filter(f => f.group === 'dim');
  const rebarFields = allFields.filter(f => f.group === 'rebar');
  const extraFields = allFields.filter(f => f.group === 'extra');
  const hasAnyExtraValue = extraFields.some(f => Boolean(value(open, f)));

  const conflicts = [...new Set(open.idx.flatMap(i => members[i].provenance?.conflicts || []))];
  const vol = open.items.reduce((a, it) => a + it.volumeNetM3, 0);
  const fw = open.items.reduce((a, it) => a + it.formworkNetM2, 0);
  const rb = open.items.reduce((a, it) => a + (it.rebarWeightKg || 0), 0);

  const isGroupReady = (g: typeof groups[number]) => needsOf(g) > 0 && g.idx.every(i => {
    const m = members[i];
    if (!(Number(m.width) > 0 && Number(m.depth) > 0 && Number(m.length) > 0)) return false;
    return conflictStatuses(m).every(c => c.state === 'resolved');
  });
  const readyGroups = groups.filter(isGroupReady);

  const confirmAllReady = () => {
    if (!readyGroups.length) return;
    if (!canApprove) { onRequestReviewer?.(); return; }
    const updates: { index: number; patch: Partial<ExtractedMember> }[] = [];
    for (const g of readyGroups) {
      const fields = fieldsForSection(g.type);
      for (const i of g.idx) {
        const m = members[i];
        const fs = { ...(m.provenance?.fieldSources || {}) };
        for (const f of fields) {
          if (f.source && (fs[f.source] === 'inferred' || fs[f.source] === 'assumed')) fs[f.source] = 'reviewer';
        }
        const provenance = m.provenance && {
          ...m.provenance, fieldSources: fs, confidence: Math.max(m.provenance.confidence, 0.9),
          conflicts: (m.provenance.conflicts || []).filter(c => !c.startsWith('ไม่พบแบบขยาย')),
        };
        const merged = { ...m, provenance };
        if (unconfirmedRequiredFields(merged).length === 0) {
          updates.push({ index: i, patch: { provenance, review: approvalFor(merged, `ยืนยันหน้าตัด ${m.tag}`) } });
        }
      }
    }
    if (updates.length) onUpdateMembers(updates);
  };

  const renderField = (f: ReviewFieldDef) => {
    const src = source(open, f);
    const val = value(open, f);
    return (
      <div key={String(f.key)} className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-slate-700">{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
          {src && <span className={`px-1.5 py-0.5 rounded border text-[11px] font-medium ${SOURCE_BADGE[src].cls}`}>{SOURCE_BADGE[src].th}</span>}
        </div>
        {f.kind === 'rebar' ? (
          <RebarInput
            value={String(val || '')}
            rebarKind={f.rebarKind}
            placeholder={src === 'missing' ? 'กรอกจากแบบ' : f.placeholder}
            onChange={next => setDraftField(open.key, f.key, next)}
          />
        ) : f.kind === 'select' && f.options ? (
          <select
            value={String(val || f.options[0].value)}
            onChange={e => setDraftField(open.key, f.key, e.target.value)}
            className="w-full h-10 rounded-lg border border-slate-200 hover:border-slate-300 focus:border-slate-900 px-3 text-sm bg-white text-slate-900 outline-none transition-colors"
          >
            {f.options.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : (
          <input
            value={val}
            placeholder={src === 'missing' ? 'กรอกจากแบบ' : f.placeholder}
            type={f.kind === 'text' ? 'text' : 'number'}
            step="0.01"
            inputMode={f.kind === 'text' ? 'text' : 'decimal'}
            onChange={e => setDraftField(open.key, f.key, f.kind === 'text' ? e.target.value : Number(e.target.value))}
            className={`w-full h-10 rounded-lg border px-3 text-sm font-mono bg-white outline-none transition-colors ${
              src === 'missing' ? 'border-rose-300 bg-rose-50/30 focus:border-rose-500' : 'border-slate-200 hover:border-slate-300 focus:border-slate-900'
            }`}
          />
        )}
      </div>
    );
  };

  const firstBlockedItem = open.items.find(it => {
    const m = it.memberIndex !== undefined ? members[it.memberIndex] : undefined;
    return m && (conflictStatuses(m).some(c => c.state !== 'resolved') || unconfirmedRequiredFields(m).length > 0);
  });
  const hasConflict = open.idx.some(i => conflictStatuses(members[i]).some(c => c.state !== 'resolved'));

  return (
    <div className="space-y-4">
      {/* Quiet Swiss Tag Rail */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-500">
            เลือกเบอร์ชิ้นส่วน ({groups.length} เบอร์ · รอยืนยัน <b className="text-slate-900">{pending}</b>)
          </span>
          {readyGroups.length > 0 && (
            <button onClick={confirmAllReady} className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors">
              ยืนยันที่พร้อมทั้งหมด ({readyGroups.length})
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 p-3 max-h-36 overflow-y-auto">
          {groups.map(g => {
            const needs = needsOf(g);
            const active = g.key === open.key;
            return (
              <button
                key={g.key}
                onClick={() => setOpenKey(g.key)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${needs ? 'bg-[#EA580C]' : 'bg-emerald-500'}`} />
                <span className="font-mono">{g.tag}</span>
                <span className={`text-[11px] ${active ? 'text-slate-300' : 'text-slate-400'}`}>{g.idx.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      {!hideSourceViewer && <SourceViewer pageUrl={pageUrl} evidence={evidence} height={460} />}

      {/* Spacious Swiss Section Editor */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              aria-label="แก้ไขรหัส Tag"
              value={String(drafts[open.key]?.tag ?? open.tag)}
              onChange={e => setDraftField(open.key, 'tag', e.target.value.toUpperCase())}
              className="w-44 h-9 px-2.5 rounded-lg border border-slate-200 focus:border-slate-900 font-mono font-bold text-sm text-slate-900 outline-none"
            />
            <span className="px-2.5 py-1 rounded-md bg-slate-100 text-xs font-semibold text-slate-700">{TYPE_TH[open.type]}</span>
            <span className="text-xs text-slate-500">
              {open.idx.length} ชิ้น · คอนกรีต <b className="font-mono text-slate-900">{vol.toFixed(3)}</b> ลบ.ม. · ไม้แบบ <b className="font-mono text-slate-900">{fw.toFixed(2)}</b> ตร.ม. · เหล็ก <b className="font-mono text-slate-900">{rb.toFixed(1)}</b> กก.
            </span>
          </div>
          {open.items[0] && (
            <button
              type="button"
              onClick={() => setShowDiagram(v => !v)}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{showDiagram ? 'ซ่อนรูปหน้าตัด' : 'ดูรูปหน้าตัด'}</span>
            </button>
          )}
        </div>

        {conflicts.length > 0 && (
          <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 space-y-1">
            {conflicts.map((c, i) => <div key={i}>• {c}</div>)}
          </div>
        )}

        {showDiagram && open.items[0] && (
          <MemberDiagram item={open.items[0]} lang="th" theme={theme} />
        )}

        {/* Group 1: Dimensions */}
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">มิติหน้าตัดและสเปก</div>
          <div className="grid sm:grid-cols-2 gap-4">
            {dimFields.map(renderField)}
          </div>
        </div>

        {/* Group 2: Primary Rebar */}
        {rebarFields.length > 0 && (
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">เหล็กหลักและเหล็กปลอก</div>
            <div className="grid sm:grid-cols-2 gap-4">
              {rebarFields.map(renderField)}
            </div>
          </div>
        )}

        {/* Group 3: Extra Rebar / Substructure Details */}
        {extraFields.length > 0 && (
          <div className="pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowExtra(v => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900"
            >
              {showExtra || hasAnyExtraValue ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <span>เหล็กเสริมพิเศษ / รายละเอียดเพิ่มเติม ({extraFields.length} ช่อง)</span>
            </button>
            {(showExtra || hasAnyExtraValue) && (
              <div className="grid sm:grid-cols-2 gap-4 pt-3">
                {extraFields.map(renderField)}
              </div>
            )}
          </div>
        )}

        {/* Footing RebarSets */}
        {open.type === 'FOOTING' && (() => {
          const m0 = members[open.idx[0]];
          const it0 = open.items[0];
          const draft = drafts[open.key] || {};
          const sets = 'rebarSets' in draft ? draft.rebarSets : m0.rebarSets;
          const notes = [...new Set(open.idx.flatMap(i => members[i].rebarNotesRead || []))];
          return (
            <div className="space-y-3 pt-4 border-t border-slate-100">
              {notes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span>อ่านได้จากแบบ:</span>
                  {notes.map(note => (
                    <button
                      key={note}
                      type="button"
                      onClick={() => setDraftField(open.key, 'bottomRebar', note)}
                      className="px-2 py-0.5 rounded-md border border-slate-200 font-mono text-xs hover:bg-slate-50 text-slate-800"
                    >
                      {note}
                    </button>
                  ))}
                </div>
              )}
              {(sets || !notes.length) && (
                <FootingRebarSets
                  member={m0}
                  sets={sets}
                  results={it0?.rebarDetails?.sets}
                  flags={it0?.flags || []}
                  dirty={'rebarSets' in draft}
                  reviewer=""
                  onChange={newSets => setDraftField(open.key, 'rebarSets', newSets)}
                />
              )}
              {notes.length > 0 && !sets && (
                <button
                  type="button"
                  onClick={() => {
                    const generated = notes.flatMap(n => rebarSetsFromNote({ ...m0, bottomRebar: n }).map(s => ({ ...s, source: 'drawing' as const })));
                    setDraftField(open.key, 'rebarSets', generated);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-medium text-xs hover:bg-slate-50"
                >
                  แยกเป็นชุดเหล็กจากค่าที่อ่านได้ ({notes.length} ค่า)
                </button>
              )}
            </div>
          );
        })()}

        {/* Formula summary */}
        {open.items[0]?.formulaStr && (
          <details className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">ดูสูตรคำนวณ (1 ชิ้น)</summary>
            <div className="mt-2 font-mono space-y-1 text-slate-700">
              <div>{open.items[0].formulaStr}</div>
              {open.items[0].rebarFormulaStr && <div>{open.items[0].rebarFormulaStr}</div>}
            </div>
          </details>
        )}

        {/* Clear action feedback / conflict jump */}
        {(feedback || hasConflict) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
            <span>
              {feedback || `เบอร์ ${open.tag} มีข้อขัดแย้งระหว่างแบบ (ผังไม่ตรงแบบขยาย) — ต้องตัดสินในขั้นที่ 3 ก่อนจึงจะอนุมัติได้`}
            </span>
            {firstBlockedItem && onJumpToItem && (
              <button
                type="button"
                onClick={() => onJumpToItem(firstBlockedItem.itemId)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#EA580C] hover:bg-[#C2410C] text-white font-semibold shrink-0 transition-colors"
              >
                <span>ไปตัดสินในขั้นที่ 3</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Primary Action Bar */}
        <div className="pt-2 flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => confirm(open)}
            className="h-10 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors"
          >
            {drafts[open.key] ? 'บันทึกและยืนยันเบอร์นี้' : 'ยืนยันตามที่อ่านได้'}
          </button>
          {drafts[open.key] && (
            <button
              onClick={() => setDrafts(d => { const n = { ...d }; delete n[open.key]; return n; })}
              className="h-10 px-4 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              ยกเลิกการแก้
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
