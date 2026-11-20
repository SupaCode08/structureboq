import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Layers } from 'lucide-react';
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
  /** When embedded inside Split-Screen ReviewWorkspace, delegate drawing display to left pane */
  hideSourceViewer?: boolean;
  onEvidenceChange?: (evidence: EvidenceRef[]) => void;
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
  drawing: { th: 'จากแบบ', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  grid: { th: 'จากกริด', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  inferred: { th: 'อนุมาน', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  assumed: { th: 'ค่าสมมติ', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  missing: { th: 'ไม่พบ', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  reviewer: { th: 'ผู้ตรวจ', cls: 'bg-violet-50 text-violet-800 border-violet-200' },
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
}) => {
  const [drafts, setDrafts] = useState<Record<string, Partial<ExtractedMember>>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  const [showDiagram, setShowDiagram] = useState(true);

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
    if (!canApprove) { onRequestReviewer?.(); }
    const draft = drafts[g.key] || {};
    const fields = fieldsForSection(g.type);
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
      const approvable = canApprove && !stillMissing && unconfirmedRequiredFields(merged).length === 0 && conflictStatuses(merged).every(c => c.state === 'resolved');
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
    const next = groups.find(x => x.key !== g.key && needsOf(x) > 0);
    if (next) setOpenKey(next.key);
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
      <div key={String(f.key)} className="block">
        <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
          <span className="font-medium">{f.label}{f.unit ? ` (${f.unit})` : ''}</span>
          {src && <span className={`px-1.5 rounded border text-[10px] ${SOURCE_BADGE[src].cls}`}>{SOURCE_BADGE[src].th}</span>}
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
            className="w-full h-8 rounded-md border border-slate-300 px-2 text-xs bg-white text-slate-900"
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
            className={`w-full h-8 rounded-md border px-2.5 text-xs font-mono bg-white ${
              src === 'missing' ? 'border-rose-300 bg-rose-50/30' : src === 'reviewer' ? 'border-violet-400' : 'border-slate-300'
            }`}
          />
        )}
      </div>
    );
  };

  return (
    <div className={hideSourceViewer ? 'space-y-3' : 'grid lg:grid-cols-[260px_1fr] gap-4 items-start'}>
      {/* Tag selector bar / sidebar */}
      <div className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${hideSourceViewer ? '' : 'lg:sticky lg:top-[72px]'}`}>
        <div className="px-3 py-2 border-b border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-2 bg-slate-50">
          <span>{groups.length} เบอร์ · รอยืนยัน <b className="text-amber-700">{pending}</b></span>
          {readyGroups.length > 0 && (
            <button onClick={confirmAllReady} className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-medium shrink-0">
              ยืนยันทั้งหมด ({readyGroups.length})
            </button>
          )}
        </div>
        <div className={hideSourceViewer ? 'flex flex-wrap gap-1.5 p-2.5 max-h-40 overflow-y-auto' : 'max-h-[70vh] overflow-y-auto'}>
          {groups.map(g => {
            const needs = needsOf(g);
            const active = g.key === open.key;
            if (hideSourceViewer) {
              return (
                <button
                  key={g.key}
                  onClick={() => setOpenKey(g.key)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600 font-semibold shadow-sm'
                      : needs
                        ? 'bg-amber-50/70 text-slate-800 border-amber-200 hover:bg-amber-100/70'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {needs ? (
                    <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-amber-200' : 'text-amber-600'}`} />
                  ) : (
                    <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-emerald-200' : 'text-emerald-600'}`} />
                  )}
                  <span className="font-mono">{g.tag}</span>
                  <span className={`text-[10px] ${active ? 'text-indigo-100' : 'text-slate-400'}`}>({g.idx.length})</span>
                </button>
              );
            }
            const m = members[g.idx[0]];
            const sum = g.type === 'SLAB' ? `หนา ${blankZero(m.length) || '?'}` : g.type === 'FOOTING' ? `${blankZero(m.width) || '?'}×${blankZero(m.depth) || '?'} หนา ${blankZero(m.length) || '?'}` : `${blankZero(m.width) || '?'}×${blankZero(m.depth) || '?'}`;
            return (
              <button
                key={g.key}
                onClick={() => setOpenKey(g.key)}
                className={`w-full text-left px-3 py-2 border-b border-slate-100 flex items-center gap-2 ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              >
                {needs ? <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-semibold font-mono text-slate-900 truncate">{g.tag}</span>
                    <span className="text-xs text-slate-500 shrink-0">{TYPE_TH[g.type]}</span>
                    <span className="ml-auto text-[11px] text-slate-500 shrink-0">{g.idx.length} ชิ้น{needs ? ` · รอ ${needs}` : ''}</span>
                  </span>
                  <span className="block text-xs font-mono text-slate-600">{sum}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main section editor */}
      <div className="space-y-3 min-w-0">
        {!hideSourceViewer && <SourceViewer pageUrl={pageUrl} evidence={evidence} height={460} />}

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          {/* Header + Re-tag + Realtime Summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label="แก้ไขรหัส Tag"
                value={String(drafts[open.key]?.tag ?? open.tag)}
                onChange={e => setDraftField(open.key, 'tag', e.target.value.toUpperCase())}
                className="w-24 px-2 py-1 rounded-md border border-slate-300 font-mono font-bold text-sm text-slate-900 focus:border-indigo-500 outline-none"
                title="แก้ชื่อเบอร์ (Tag) ของกลุ่มนี้"
              />
              <span className="px-2 py-0.5 rounded bg-slate-100 text-xs font-semibold text-slate-700">{TYPE_TH[open.type]}</span>
              <span className="text-xs text-slate-600">
                {open.idx.length} ชิ้น · คอนกรีต <b className="font-mono text-slate-900">{vol.toFixed(3)}</b> ลบ.ม. · ไม้แบบ <b className="font-mono text-slate-900">{fw.toFixed(2)}</b> ตร.ม. · เหล็ก <b className="font-mono text-slate-900">{rb.toFixed(1)}</b> กก.
              </span>
            </div>
            {open.items[0] && (
              <button
                type="button"
                onClick={() => setShowDiagram(v => !v)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{showDiagram ? 'ซ่อนรูปหน้าตัด' : 'แสดงรูปหน้าตัด'}</span>
              </button>
            )}
          </div>

          {conflicts.length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
              {conflicts.map((c, i) => <li key={i}>• {c}</li>)}
            </ul>
          )}

          {/* Live MemberDiagram Preview */}
          {showDiagram && open.items[0] && (
            <MemberDiagram item={open.items[0]} lang="th" theme={theme} />
          )}

          {/* Group 1: Dimensions */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">มิติหน้าตัดและสเปก</div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {dimFields.map(renderField)}
            </div>
          </div>

          {/* Group 2: Primary Rebar */}
          {rebarFields.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">เหล็กหลักและเหล็กปลอก</div>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {rebarFields.map(renderField)}
              </div>
            </div>
          )}

          {/* Group 3: Extra Rebar / Substructure Details (Collapsible) */}
          {extraFields.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowExtra(v => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-800 mb-2"
              >
                {showExtra || hasAnyExtraValue ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span>เหล็กเสริมพิเศษ / รายละเอียดเพิ่มเติม ({extraFields.length} ช่อง)</span>
              </button>
              {(showExtra || hasAnyExtraValue) && (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 pt-1">
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
              <div className="space-y-3 pt-3 border-t border-slate-100">
                {notes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                    <span>อ่านได้จากแบบ:</span>
                    {notes.map(note => (
                      <button
                        key={note}
                        type="button"
                        onClick={() => setDraftField(open.key, 'bottomRebar', note)}
                        className="px-2 py-0.5 rounded border border-slate-300 font-mono text-xs hover:bg-slate-50 text-slate-700"
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
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        const generated = notes.flatMap(n => rebarSetsFromNote({ ...m0, bottomRebar: n }).map(s => ({ ...s, source: 'drawing' as const })));
                        setDraftField(open.key, 'rebarSets', generated);
                      }}
                      className="px-2.5 py-1 rounded-md border border-blue-300 text-blue-700 font-semibold text-xs hover:bg-blue-50"
                    >
                      แยกเป็นชุดเหล็กจากค่าที่อ่านได้ ({notes.length} ค่า)
                    </button>
                    <p className="text-[11px] text-slate-500">แต่ละค่าเป็นชุดของตัวเอง — ตรวจทิศ/ชั้นก่อนยืนยัน</p>
                  </div>
                )}
              </div>
            );
          })()}

          {open.items[0]?.formulaStr && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 space-y-1">
              <div><span className="font-sans font-semibold text-slate-500">สูตรคอนกรีต/ไม้แบบ (1 ชิ้น):</span> {open.items[0].formulaStr}</div>
              {open.items[0].rebarFormulaStr && (
                <div><span className="font-sans font-semibold text-slate-500">สูตรเหล็กเสริม:</span> {open.items[0].rebarFormulaStr}</div>
              )}
            </div>
          )}

          <div className="pt-1 flex flex-wrap items-center gap-2">
            <button onClick={() => confirm(open)} className="h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold">
              {drafts[open.key] ? 'บันทึกและยืนยันเบอร์นี้' : 'ยืนยันตามที่อ่านได้'}
            </button>
            {drafts[open.key] && (
              <button onClick={() => setDrafts(d => { const n = { ...d }; delete n[open.key]; return n; })} className="h-9 px-3.5 rounded-lg border border-slate-300 text-xs text-slate-700 hover:bg-slate-50">
                ยกเลิกการแก้
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
