import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { CalculatedQuantity, ExtractedMember, FieldSource, MemberType, EvidenceRef } from '../engine/qsEngine';
import { approvalFor, conflictStatuses, rebarSetsFromNote, unconfirmedRequiredFields } from '../engine/qsEngine';
import { FootingRebarSets } from './FootingRebarSets';
import { SourceViewer } from './SourceViewer';

/**
 * Review by member TYPE instead of by member: one entry per tag (GB2, C1, S0 ...).
 * A drawing set has ~10–20 tags but 50–100 members, so confirming each tag's section once
 * is the fastest human step after automatic reading.
 */
interface SectionTableProps {
  items: CalculatedQuantity[];
  members: ExtractedMember[];
  docId?: string;
  pageUrl?: (page: number, dpi: number) => Promise<string>;
  theme?: 'light' | 'dark';
  onUpdateMembers: (updates: { index: number; patch: Partial<ExtractedMember> }[]) => void;
  /** false until a reviewer name is given: values are still confirmed, but nothing is approved */
  canApprove?: boolean;
}

type Field = { key: keyof ExtractedMember; label: string; source: string; text?: boolean; unit?: string; hint?: string };

const FIELDS: Record<MemberType, Field[]> = {
  BEAM: [
    { key: 'width', label: 'กว้าง', source: 'width', unit: 'ม.' }, { key: 'depth', label: 'ลึก', source: 'depth', unit: 'ม.' },
    { key: 'topRebar', label: 'เหล็กบน', source: 'rebar', text: true, hint: '2-DB12' }, { key: 'bottomRebar', label: 'เหล็กล่าง', source: 'rebar', text: true, hint: '2-DB12' },
    { key: 'stirrupRebar', label: 'เหล็กปลอก', source: 'stirrup', text: true, hint: 'RB6@0.15' },
  ],
  COLUMN: [
    { key: 'width', label: 'ด้าน X', source: 'width', unit: 'ม.' }, { key: 'depth', label: 'ด้าน Y', source: 'depth', unit: 'ม.' },
    { key: 'topRebar', label: 'เหล็กยืน', source: 'rebar', text: true, hint: '4-DB12' }, { key: 'stirrupRebar', label: 'เหล็กปลอก', source: 'stirrup', text: true, hint: 'RB6@0.20' },
  ],
  FOOTING: [
    { key: 'width', label: 'กว้าง', source: 'width', unit: 'ม.' }, { key: 'depth', label: 'ยาว', source: 'depth', unit: 'ม.' },
    { key: 'length', label: 'หนา', source: 'length', unit: 'ม.' }, { key: 'bottomRebar', label: 'ตะแกรงล่าง', source: 'rebar', text: true, hint: '5+5-DB12' },
  ],
  SLAB: [
    { key: 'length', label: 'หนา', source: 'length', unit: 'ม.' },
    { key: 'topRebar', label: 'เหล็กบน', source: 'rebar', text: true, hint: 'RB9@0.20' }, { key: 'bottomRebar', label: 'เหล็กล่าง', source: 'rebar', text: true, hint: 'RB9@0.20' },
  ],
  STAIR: [
    { key: 'width', label: 'กว้าง', source: 'width', unit: 'ม.' }, { key: 'depth', label: 'หนาท้อง', source: 'depth', unit: 'ม.' }, { key: 'length', label: 'ยาวลาด', source: 'length', unit: 'ม.' },
  ],
  WALL: [
    { key: 'width', label: 'หนาผนัง', source: 'width', unit: 'ม.' }, { key: 'depth', label: 'สูงผนัง', source: 'depth', unit: 'ม.' }, { key: 'length', label: 'ยาวผนัง', source: 'length', unit: 'ม.' },
  ],
  DOOR: [
    { key: 'width', label: 'กว้าง', source: 'width', unit: 'ม.' }, { key: 'depth', label: 'สูง', source: 'depth', unit: 'ม.' }, { key: 'length', label: 'จำนวนชุด', source: 'length', unit: 'ชุด' },
  ],
  WINDOW: [
    { key: 'width', label: 'กว้าง', source: 'width', unit: 'ม.' }, { key: 'depth', label: 'สูง', source: 'depth', unit: 'ม.' }, { key: 'length', label: 'จำนวนชุด', source: 'length', unit: 'ชุด' },
  ],
  FINISH: [
    { key: 'width', label: 'กว้างห้อง', source: 'width', unit: 'ม.' }, { key: 'depth', label: 'ยาวห้อง', source: 'depth', unit: 'ม.' }, { key: 'length', label: 'หนา/พื้นที่', source: 'length', unit: 'ม.' },
  ],
};

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

export const SectionTable: React.FC<SectionTableProps> = ({ items, members, pageUrl, onUpdateMembers, canApprove = true }) => {
  const [drafts, setDrafts] = useState<Record<string, Partial<ExtractedMember>>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);

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
    const order: MemberType[] = ['FOOTING', 'COLUMN', 'BEAM', 'SLAB', 'STAIR'];
    return [...g.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.tag.localeCompare(b.tag));
  }, [members, items]);

  const needsOf = (g: typeof groups[number]) => g.items.filter(it => it.status === 'NEEDS_REVIEW' && !it.review).length;
  const pending = groups.filter(g => needsOf(g) > 0).length;
  const open = groups.find(g => g.key === openKey) || groups.find(g => needsOf(g) > 0) || groups[0];
  useEffect(() => { if (open && open.key !== openKey) setOpenKey(open.key); }, [open?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = (g: typeof groups[number], f: Field) => blankZero(drafts[g.key]?.[f.key] ?? members[g.idx[0]][f.key]);
  const source = (g: typeof groups[number], f: Field): FieldSource | undefined => {
    if (drafts[g.key]?.[f.key] !== undefined) return 'reviewer';
    const srcs = g.idx.map(i => members[i].provenance?.fieldSources[f.source]).filter(Boolean) as FieldSource[];
    if (!srcs.length) return undefined;
    return srcs.includes('missing') ? 'missing' : srcs.includes('assumed') ? 'assumed' : srcs.includes('inferred') ? 'inferred' : srcs[0];
  };

  const confirm = (g: typeof groups[number]) => {
    const draft = drafts[g.key] || {};
    const fields = FIELDS[g.type];
    onUpdateMembers(g.idx.map(i => {
      const m = members[i];
      const fs = { ...(m.provenance?.fieldSources || {}) };
      for (const f of fields) {
        if (draft[f.key] !== undefined) fs[f.source] = 'reviewer';
        else if (fs[f.source] === 'inferred' || fs[f.source] === 'assumed') fs[f.source] = 'reviewer'; // confirmed as shown
      }
      const provenance = m.provenance && {
        ...m.provenance, fieldSources: fs, confidence: Math.max(m.provenance.confidence, 0.9),
        conflicts: (m.provenance.conflicts || []).filter(c => !c.startsWith('ไม่พบแบบขยาย')),
      };
      const merged = { ...m, ...draft, provenance };
      const stillMissing = !(Number(merged.width) > 0 && Number(merged.depth) > 0 && Number(merged.length) > 0);
      // the table shows the section only: a member whose span, height or supports nobody confirmed stays in the item queue
      // no bulk ruling on source conflicts: a member with one still open is approved only one conflict at a time in the item queue
      const approvable = canApprove && !stillMissing && unconfirmedRequiredFields(merged).length === 0 && conflictStatuses(merged).every(c => c.state === 'resolved');
      return {
        index: i,
        patch: {
          ...draft,
          provenance,
          review: approvable ? approvalFor(merged, `ยืนยันหน้าตัด ${m.tag}`) : m.review,
        },
      };
    }));
    setDrafts(d => { const n = { ...d }; delete n[g.key]; return n; });
    const next = groups.find(x => x.key !== g.key && needsOf(x) > 0);
    if (next) setOpenKey(next.key);
  };

  // Evidence for the open tag: the section detail first, then every position on the plans
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

  if (!open) return null;
  const conflicts = [...new Set(open.idx.flatMap(i => members[i].provenance?.conflicts || []))];
  const vol = open.items.reduce((a, it) => a + it.volumeNetM3, 0);

  return (
    <div className="grid lg:grid-cols-[300px_1fr] gap-4 items-start">
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden lg:sticky lg:top-[72px]">
        <div className="px-3 py-2 border-b border-slate-200 text-sm text-slate-600">
          {groups.length} เบอร์ · รอยืนยัน <b className="text-amber-700">{pending}</b>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {groups.map(g => {
            const needs = needsOf(g);
            const m = members[g.idx[0]];
            const sum = g.type === 'SLAB' ? `หนา ${blankZero(m.length) || '?'}` : g.type === 'FOOTING' ? `${blankZero(m.width) || '?'}×${blankZero(m.depth) || '?'} หนา ${blankZero(m.length) || '?'}` : `${blankZero(m.width) || '?'}×${blankZero(m.depth) || '?'}`;
            return (
              <button
                key={g.key}
                onClick={() => setOpenKey(g.key)}
                className={`w-full text-left px-3 py-2 border-b border-slate-100 flex items-center gap-2 ${g.key === open.key ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              >
                {needs ? <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-semibold font-mono text-slate-900 truncate">{g.tag}</span>
                    <span className="text-sm text-slate-500 shrink-0">{TYPE_TH[g.type]}</span>
                    <span className="ml-auto text-xs text-slate-500 shrink-0">{g.idx.length} ชิ้น{needs ? ` · รอ ${needs}` : ''}</span>
                  </span>
                  <span className="block text-sm font-mono text-slate-600">{sum}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 min-w-0">
        <SourceViewer pageUrl={pageUrl} evidence={evidence} height={520} />

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
            <h3 className="text-lg font-semibold font-mono text-slate-900">{open.tag}</h3>
            <span className="text-slate-600">{TYPE_TH[open.type]} · {open.idx.length} ชิ้น · คอนกรีต {vol.toFixed(3)} ลบ.ม.</span>
            <span className="text-sm text-slate-500">แก้ครั้งเดียว ใช้กับทุกตำแหน่งของเบอร์นี้</span>
          </div>
          {conflicts.length > 0 && (
            <ul className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-0.5">
              {conflicts.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {FIELDS[open.type].map(f => {
              const src = source(open, f);
              return (
                <label key={String(f.key)} className="block">
                  <span className="flex items-center justify-between text-sm text-slate-600 mb-1">
                    {f.label}{f.unit ? ` (${f.unit})` : ''}
                    {src && <span className={`px-1.5 rounded border text-xs ${SOURCE_BADGE[src].cls}`}>{SOURCE_BADGE[src].th}</span>}
                  </span>
                  <input
                    value={value(open, f)}
                    placeholder={src === 'missing' ? 'กรอกจากแบบ' : f.hint}
                    type={f.text ? 'text' : 'number'} step="0.01" inputMode={f.text ? 'text' : 'decimal'}
                    onChange={e => setDrafts(d => ({ ...d, [open.key]: { ...d[open.key], [f.key]: f.text ? e.target.value : Number(e.target.value) } }))}
                    className={`w-full h-10 rounded-md border px-3 font-mono bg-white ${src === 'missing' ? 'border-rose-300' : src === 'reviewer' ? 'border-violet-400' : 'border-slate-300'}`}
                  />
                </label>
              );
            })}
          </div>
          {open.type === 'FOOTING' && (() => {
            const m0 = members[open.idx[0]];
            const it0 = open.items[0];
            const draft = drafts[open.key] || {};
            const sets = 'rebarSets' in draft ? draft.rebarSets : m0.rebarSets;
            const notes = [...new Set(open.idx.flatMap(i => members[i].rebarNotesRead || []))];
            return (
              <div className="mt-4 space-y-3 pt-3 border-t border-slate-100">
                {notes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                    <span>อ่านได้จากแบบ:</span>
                    {notes.map(note => (
                      <button
                        key={note}
                        type="button"
                        onClick={() => setDrafts(d => ({ ...d, [open.key]: { ...d[open.key], bottomRebar: note } }))}
                        className="px-2 py-0.5 rounded border border-slate-300 font-mono text-xs hover:bg-slate-50 text-slate-700"
                      >
                        {note}
                      </button>
                    ))}
                  </div>
                )}
                {(sets || !notes.length) && <FootingRebarSets
                  member={m0}
                  sets={sets}
                  results={it0?.rebarDetails?.sets}
                  flags={it0?.flags || []}
                  dirty={'rebarSets' in draft}
                  reviewer=""
                  onChange={newSets => setDrafts(d => ({ ...d, [open.key]: { ...d[open.key], rebarSets: newSets } }))}
                />}
                {notes.length > 0 && !sets && (
                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        const generated = notes.flatMap(n => rebarSetsFromNote({ ...m0, bottomRebar: n }).map(s => ({ ...s, source: 'drawing' as const })));
                        setDrafts(d => ({ ...d, [open.key]: { ...d[open.key], rebarSets: generated } }));
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => confirm(open)} className="h-10 px-5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-medium">
              {drafts[open.key] ? 'บันทึกและยืนยัน' : 'ยืนยันตามที่อ่านได้'}
            </button>
            {drafts[open.key] && (
              <button onClick={() => setDrafts(d => { const n = { ...d }; delete n[open.key]; return n; })} className="h-10 px-4 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50">
                ยกเลิกการแก้
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
