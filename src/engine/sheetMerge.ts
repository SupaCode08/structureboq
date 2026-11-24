/**
 * StructBOQ - merges per-sheet drawing readings into takeoff members.
 *
 * A real drawing set never has one complete schedule: plans say WHERE each member is
 * (tag + grid + span), details/schedules say WHAT it is (section, bars). This module joins
 * the two, records the evidence on both sheets, and raises conflicts for the reviewer
 * instead of silently picking a value.
 */
import type { ConflictField, ExtractedMember, MemberType, EvidenceRef, FieldSource } from './qsEngine';
import { reconcile, recordReconciled, type Reconciled } from './sourceConflicts.ts';

export interface GridAxisMark { label: string; offset_m: number }

export interface PlanInstance {
  tag: string;
  member_type: string;
  from_grid?: string | null;
  to_grid?: string | null;
  length_m?: number | null;
  box_2d?: number[];
  /** where box_2d comes from: absent = the label word; 'shape' = a drawn outline/square; 'guess' = placed by spacing, not seen */
  box_src?: 'shape' | 'guess';
  plan_title?: string | null;
  level?: string | null;
  confidence?: number;
}

export interface SectionDef {
  tag: string;
  member_type: string;
  width_m?: number | null;
  depth_m?: number | null;
  thickness_m?: number | null;
  length_m?: number | null;
  plan_w_m?: number | null;
  plan_l_m?: number | null;
  top_rebar?: string | null;
  bottom_rebar?: string | null;
  dist_rebar?: string | null;
  /** every bar note read at the footing's section, as read (display only) */
  rebar_notes?: string[];
  side_rebar?: string | null;
  stirrup?: string | null;
  /** ties set at each spacing step ("2-RB6@0.10" -> 2); absent means one */
  stirrup_sets?: number | null;
  /** footing variant its title names ("แผ่" / "เสาเข็ม") */
  variant?: string;
  /** piles under one footing and their size "0.15x0.15x6.00", from the detail's pile note */
  pile_count?: number | null;
  pile_size?: string;
  main_rebar?: string | null;
  height_m?: number | null;
  stair_risers?: number | null;
  stair_rise_m?: number | null;
  stair_run_m?: number | null;
  from_level?: string | null;
  to_level?: string | null;
  /** fields filled by a reading rule rather than read directly (e.g. width shared on the sheet) */
  inferred_fields?: string[];
  /** fields measured from the drawn outline at the drawing scale */
  measured_fields?: string[];
  /** disagreements between written dimensions and the drawn outline */
  section_conflicts?: string[];
  box_2d?: number[];
  /** where box_2d comes from: absent = the label word; 'shape' = a drawn outline/square; 'guess' = placed by spacing, not seen */
  box_src?: 'shape' | 'guess';
  evidence?: string;
  confidence?: number;
}

export interface LevelMark { label: string; elevation_m: number }

export interface SheetReading {
  page: number;
  sheet_id?: string;
  sheet_title?: string;
  sheet_type: string;
  level?: string;
  grid?: { x?: GridAxisMark[]; y?: GridAxisMark[] };
  instances: PlanInstance[];
  sections: SectionDef[];
  levels?: LevelMark[];
  notes?: string[];
}

export interface MergeAssumptions {
  /** Which footing plan to use when the set has alternatives (e.g. 'แผ่' spread vs 'เข็ม' piles). */
  footingVariant?: string;
  /** Column stub height (footing top to ground beam) when not dimensioned on the sheets. */
  columnStubHeightM: number;
  /** Storey height used for columns continuing to an upper floor when not dimensioned. */
  storeyHeightM: number;
  /** Stair flight width when not dimensioned. */
  stairWidthM: number;
}

export const DEFAULT_MERGE_ASSUMPTIONS: MergeAssumptions = {
  columnStubHeightM: 1.0,
  storeyHeightM: 3.0,
  stairWidthM: 0.9,
};

export interface MergeResult {
  members: ExtractedMember[];
  notes: string[];
  skipped: { tag: string; page: number; reason: string }[];
  sheets: { page: number; sheetId?: string; title?: string; type: string; used: boolean }[];
  /** Completeness checks a QS would do: things that may be missing from the takeoff entirely */
  completeness: CompletenessFinding[];
}

export interface CompletenessFinding {
  message: string;
  /** Members to add to the review queue if the reviewer agrees (unknown fields marked missing) */
  suggested: ExtractedMember[];
}

const MEMBER_TYPES: MemberType[] = ['BEAM', 'COLUMN', 'SLAB', 'FOOTING', 'STAIR', 'WALL', 'DOOR', 'WINDOW', 'FINISH'];

export function boxToNorm(box?: number[]): [number, number, number, number] | undefined {
  if (!box || box.length !== 4 || box.some(v => typeof v !== 'number')) return undefined;
  const [ymin, xmin, ymax, xmax] = box;
  const c = (v: number) => Math.min(1, Math.max(0, v / 1000));
  return [c(xmin), c(ymin), c(xmax), c(ymax)];
}

const normTag = (t: string) => t.toUpperCase().replace(/\s+/g, '').replace(/×/g, 'X').replace(/[()]/g, '');

function isSteelSection(s: SectionDef): boolean {
  const ev = s.evidence || '';
  return (s.thickness_m != null && s.thickness_m > 0 && s.thickness_m < 0.01) || /\[|口|□|(?<![A-Z])C\s*-\s*\d|x3\.2/i.test(ev);
}

function gridOffset(axis: GridAxisMark[] | undefined, label: string): number | undefined {
  const m = label.match(/^([^+\-]+)([+-]\d+(?:\.\d+)?)m?$/);
  const base = (m ? m[1] : label).trim();
  const hit = axis?.find(a => a.label.toUpperCase() === base.toUpperCase());
  if (!hit) {
    const f = Number(base);
    if (!axis || !Number.isFinite(f) || Number.isInteger(f)) return undefined;
    const lo = axis.find(a => a.label === String(Math.floor(f)));
    const hi = axis.find(a => a.label === String(Math.ceil(f)));
    return lo && hi ? lo.offset_m + (hi.offset_m - lo.offset_m) * (f - Math.floor(f)) + (m ? Number(m[2]) : 0) : undefined;
  }
  return hit.offset_m + (m ? Number(m[2]) : 0);
}

/** "A/1" -> {x, y} in metres using the sheet grid. */
function gridPoint(sheet: SheetReading, ref?: string | null): { x: number; y: number } | undefined {
  if (!ref || !ref.includes('/')) return undefined;
  const [yl, xl] = ref.split('/');
  const x = gridOffset(sheet.grid?.x, xl);
  const y = gridOffset(sheet.grid?.y, yl);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function bestSection(defs: SectionDef[]): SectionDef {
  const filled = (s: SectionDef) => [s.width_m, s.depth_m, s.thickness_m, s.plan_w_m, s.top_rebar, s.bottom_rebar, s.main_rebar, s.stirrup].filter(v => v != null && v !== '').length;
  return [...defs].sort((a, b) => filled(b) - filled(a) || (b.confidence ?? 0.5) - (a.confidence ?? 0.5))[0];
}

/**
 * Bar text from a section -> the engine's form, keeping what the drawing says:
 * "3-RB12+2-DB16" stays two groups, "5+5-DB12" stays a mesh (5 bars one way, 5 the other),
 * "RB12@0.15" stays spaced; a written grade (RB/DB) is kept, a bare ø takes RB below 12 mm.
 */
function barSpec(spec?: string | null): string {
  if (!spec) return '';
  const g = (grade: string | undefined, dia: number) => (/^RB$/i.test(grade || '') ? 'RB' : /^DB$/i.test(grade || '') ? 'DB' : dia < 12 ? 'RB' : 'DB');
  const sp = spec.match(/^\s*(DB|RB|Ø|ø)?\s*(\d{1,2})\s*@\s*(\d*\.?\d+)/i);
  if (sp) return `${g(sp[1], Number(sp[2]))}${sp[2]}@${sp[3]}`;
  const mesh = spec.match(/^\s*(\d+)\s*\+\s*(\d+)\s*-?\s*(DB|RB|Ø|ø)?\s*(\d{1,2})\s*$/i);
  if (mesh) return `${mesh[1]}+${mesh[2]}-${g(mesh[3], Number(mesh[4]))}${mesh[4]}`;
  const groups = [...spec.matchAll(/(\d+)\s*-\s*(DB|RB|Ø|ø)?\s*(\d{1,2})/gi)].map(m => `${m[1]}-${g(m[2], Number(m[3]))}${m[3]}`);
  return groups.length ? groups.join('+') : spec;
}
const rebarCount = barSpec;
const sumBars = barSpec;

export function mergeSheetReadings(
  sheetsIn: SheetReading[],
  sourceFile: string,
  assumptions: MergeAssumptions = DEFAULT_MERGE_ASSUMPTIONS,
): MergeResult {
  const notes: string[] = [];
  const skipped: MergeResult['skipped'] = [];
  let sheets = sheetsIn;

  const sectionsByTag = new Map<string, { def: SectionDef; page: number }[]>();
  for (const sh of sheets) {
    for (const s of sh.sections || []) {
      for (const t of s.tag.split(/[,/]/).map(normTag).filter(Boolean)) {
        const list = sectionsByTag.get(t) || [];
        list.push({ def: { ...s, tag: t }, page: sh.page });
        sectionsByTag.set(t, list);
      }
    }
  }
  const lookupSection = (tag: string) => {
    let list = sectionsByTag.get(normTag(tag));
    const fm = normTag(tag).match(/^F(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/);
    if (!list?.length && fm) {
      const key = [...sectionsByTag.keys()].find(k => k.startsWith(`F${fm[1]}X${fm[2]}`));
      if (key) list = sectionsByTag.get(key);
    }
    if (!list?.length) return undefined;
    const want = assumptions.footingVariant;
    if (want && list.some(l => l.def.variant)) list = list.filter(l => !l.def.variant || l.def.variant.includes(want) || want.includes(l.def.variant));
    if (!list.length) return undefined;
    const best = bestSection(list.map(l => l.def));
    const page = list.find(l => l.def === best)!.page;
    const dims = new Set(list.map(l => `${l.def.width_m ?? ''}x${l.def.depth_m ?? ''}x${l.def.thickness_m ?? ''}`));
    return { def: best, page, conflicting: dims.size > 1 ? list : undefined, all: list };
  };

  const splitPlans = (sh: SheetReading): SheetReading[] => {
    const titles = [...new Set((sh.instances || []).map(i => i.plan_title || ''))];
    if (titles.length <= 1) return [sh];
    // each plan keeps its own type: a beam plan drawn beside the footing plan is not another footing alternative
    return titles.map(t => {
      const instances = sh.instances.filter(i => (i.plan_title || '') === t);
      const sheet_type = sh.sheet_type === 'footing_plan' && !instances.some(i => i.member_type === 'FOOTING') ? 'framing_plan' as const : sh.sheet_type;
      return { ...sh, sheet_type, sheet_title: t || sh.sheet_title, instances };
    });
  };
  sheets = sheets.flatMap(sh => (sh.sheet_type === 'footing_plan' || sh.sheet_type === 'framing_plan' ? splitPlans(sh) : [sh]));
  const footingPlans = sheets.filter(s => s.sheet_type === 'footing_plan');
  let footingPlanPage: number | undefined = footingPlans[0]?.page;
  let footingPlanTitle: string | undefined = footingPlans[0]?.sheet_title;
  if (footingPlans.length > 1) {
    const want = assumptions.footingVariant;
    const chosen = want
      ? footingPlans.filter(s => (s.sheet_title || '').includes(want)).sort((a, b) => (b.instances?.length || 0) - (a.instances?.length || 0))[0]
      : undefined;
    footingPlanPage = (chosen || footingPlans[0]).page;
    footingPlanTitle = (chosen || footingPlans[0]).sheet_title;
    notes.push(
      `แบบมีผังฐานราก ${footingPlans.length} ทางเลือก (${footingPlans.map(s => s.sheet_title || s.sheet_id).join(' / ')}); ใช้: ${(chosen || footingPlans[0]).sheet_title || 'แผ่นแรก'}`,
    );
  }

  const colSections = [...sectionsByTag.values()].flat().filter(s => s.def.member_type === 'COLUMN' && !isSteelSection(s.def));
  const typicalColW = colSections.length ? Math.min(...colSections.map(c => c.def.width_m || 0.2)) : 0;
  const planCols = new Map<string, string>();
  for (const sh of sheets) {
    if (sh.sheet_type !== 'footing_plan' && sh.sheet_type !== 'framing_plan') continue;
    for (const inst of sh.instances || []) {
      if (inst.from_grid) {
        const parts = inst.tag.split(',').map(normTag).filter(Boolean);
        for (const t of parts) {
          const isCol = (parts.length > 1 && /^C/.test(t)) || (inst.member_type || '').toUpperCase() === 'COLUMN';
          if (isCol && !/^(เสา|COL|C\??)$/i.test(t)) {
            planCols.set(`${sh.page}|${inst.from_grid}`, t);
          }
        }
      }
    }
  }
  const beamSizes = new Map<string, number>();
  for (const s of [...sectionsByTag.values()].flat()) {
    if (s.def.member_type === 'BEAM' && s.def.width_m && s.def.depth_m && !isSteelSection(s.def)) beamSizes.set(`${s.def.width_m}x${s.def.depth_m}`, (beamSizes.get(`${s.def.width_m}x${s.def.depth_m}`) || 0) + 1);
  }
  const [typicalBeam, typicalN] = [...beamSizes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const typicalBeamWD = typicalBeam && typicalN! >= 2 ? typicalBeam.split('x').map(Number) : null;

  const members: ExtractedMember[] = [];
  const usedPages = new Set<number>();

  const levelSheet = sheets.find(s => (s.levels || []).length >= 2);
  const levels = levelSheet?.levels || [];
  const elevationOf = (label?: string | null): number | undefined => {
    if (!label) return undefined;
    const l = label.replace(/\s+/g, '');
    const keys: [RegExp, RegExp][] = [
      [/อะเส|ring|tie/i, /อะเส/],
      [/ชั้น(ที่)?2|ชั้นบน|2F/i, /ชั้นบน|ชั้น(ที่)?2/],
      [/ชั้น(ที่)?1|ชั้นล่าง|1F/i, /ชั้นล่าง|ชั้น(ที่)?1/],
      [/หลังคา|roof/i, /หลังคา/],
    ];
    for (const [want, mark] of keys) {
      if (want.test(l)) return levels.find(m => mark.test(m.label.replace(/\s+/g, '')))?.elevation_m;
    }
    return levels.find(m => m.label.replace(/\s+/g, '').includes(l))?.elevation_m;
  };

  if (!sectionsByTag.has('SP')) {
    for (const sh of sheets) {
      const note = (sh.notes || []).find(n => /SP/.test(n) && /(สำเร็จรูป|PLANK)/i.test(n));
      if (note) {
        const t = note.match(/ทับหน้า\s*หนา\s*(\d+(?:\.\d+)?)\s*ซม/);
        sectionsByTag.set('SP', [{ page: sh.page, def: { tag: 'SP', member_type: 'SLAB', thickness_m: t ? Number(t[1]) / 100 : 0.05, evidence: note, confidence: 0.85 } }]);
        break;
      }
    }
  }

  const planRef = (sh: SheetReading, inst: PlanInstance, label: string, memberType?: MemberType): EvidenceRef => ({
    page: sh.page,
    bboxNorm: boxToNorm(inst.box_2d),
    label,
    text: `${inst.tag} @ ${inst.from_grid ?? '?'}${inst.to_grid ? '–' + inst.to_grid : ''}`,
    method: 'vision',
    memberType,
  });
  const sectionRef = (sec: { def: SectionDef; page: number }, memberType?: MemberType): EvidenceRef => ({
    page: sec.page,
    bboxNorm: boxToNorm(sec.def.box_2d),
    label: 'แบบขยาย / ตาราง',
    text: sec.def.evidence || sec.def.tag,
    method: 'vision',
    memberType,
  });

  // what reconciling the current member's sources found; recorded on the member it pushes
  let recon: Reconciled[] = [];
  const pushMember = (m: ExtractedMember) => members.push(recon.length && m.provenance ? { ...m, provenance: recordReconciled(m.provenance, recon) } : m);
  /** every detail/schedule source of a member, field by field: the value in use stays provisional where they disagree */
  const reconcileSections = (all: { def: SectionDef; page: number }[], mType: MemberType): Reconciled[] => {
    const pick: [ConflictField, (d: SectionDef) => string | number | null | undefined][] =
      mType === 'FOOTING' ? [['width', d => d.plan_w_m], ['depth', d => d.plan_l_m], ['length', d => d.thickness_m || d.depth_m], ['bottomRebar', d => d.bottom_rebar && barSpec(d.bottom_rebar)]]
      : mType === 'BEAM' ? [['width', d => d.width_m], ['depth', d => d.depth_m], ['topRebar', d => d.top_rebar && barSpec(d.top_rebar)], ['bottomRebar', d => d.bottom_rebar && barSpec(d.bottom_rebar)], ['stirrupRebar', d => d.stirrup]]
      : mType === 'COLUMN' ? [['width', d => d.width_m], ['depth', d => d.depth_m], ['topRebar', d => d.main_rebar && barSpec(d.main_rebar)], ['stirrupRebar', d => d.stirrup]]
      : mType === 'SLAB' ? [['length', d => d.thickness_m], ['topRebar', d => d.top_rebar && barSpec(d.top_rebar)], ['bottomRebar', d => d.bottom_rebar && barSpec(d.bottom_rebar)]]
      : [['width', d => d.width_m], ['depth', d => d.depth_m]];
    return pick.map(([f, get]) => reconcile(f, all.map(a => ({ value: get(a.def), page: a.page, ref: 'แบบขยาย / ตาราง', method: 'vision' as const }))));
  };

  const framingLevels = [...new Set(sheets.filter(s => s.sheet_type === 'framing_plan')
    .flatMap(s => (s.instances || []).map(i => i.level || s.level || '')))]
    .map(l => ({ label: l, elev: elevationOf(l) }))
    .filter((l): l is { label: string; elev: number } => l.elev !== undefined)
    .sort((a, b) => a.elev - b.elev);
  const hasFootingPlan = footingPlans.length > 0;
  const footingColumnTag = new Map<string, string>();

  for (const sh of sheets) {
    const isPlan = ['footing_plan', 'framing_plan', 'slab_plan'].includes(sh.sheet_type);
    if (!isPlan) continue;
    if (sh.sheet_type === 'footing_plan' && (sh.page !== footingPlanPage || sh.sheet_title !== footingPlanTitle)) continue;
    const sheetLevel = sh.level || sh.sheet_title || `Page ${sh.page}`;

    for (const inst of sh.instances || []) {
      const level = inst.level || (inst.plan_title && inst.plan_title !== sh.sheet_title ? inst.plan_title : sheetLevel);
      const parts = inst.tag.split(',').map(normTag).filter(Boolean);
      const pieces = parts.map(t => ({ tag: t, type: (parts.length > 1 && /^F/.test(t) ? 'FOOTING' : parts.length > 1 && /^C/.test(t) ? 'COLUMN' : inst.member_type).toUpperCase() }));

      for (const piece of pieces) {
        const mType = (MEMBER_TYPES.includes(piece.type as MemberType) ? piece.type : 'BEAM') as MemberType;
        let tagInferred = false;
        if (mType === 'COLUMN' && /^(เสา|COL|C\??)$/i.test(piece.tag) && inst.from_grid && footingColumnTag.has(inst.from_grid)) {
          piece.tag = footingColumnTag.get(inst.from_grid)!;
          inst.tag = piece.tag;
        } else if (mType === 'COLUMN' && /^(เสา|COL|C\??)$/i.test(piece.tag)) {
          const onPlan = [...new Set([...footingColumnTag.values()].filter(t => !/\?$/.test(t)))];
          const colTags = [...new Set([...onPlan, ...[...sectionsByTag.entries()].filter(([, v]) => v.some(x => x.def.member_type === 'COLUMN')).map(([k]) => k)])];
          if (colTags.length === 1) { piece.tag = colTags[0]; tagInferred = true; inst.tag = piece.tag; }
          else if (sh.sheet_type === 'footing_plan' && onPlan.length === 1) { piece.tag = onPlan[0]; tagInferred = true; inst.tag = piece.tag; }
        }
        if (mType === 'COLUMN' && sh.sheet_type === 'footing_plan' && inst.from_grid) footingColumnTag.set(inst.from_grid, piece.tag);
        const sec = lookupSection(piece.tag);
        const evidence: EvidenceRef[] = [planRef(sh, inst, `ตำแหน่งในผัง (${sh.sheet_id || 'p' + sh.page})`, mType)];
        if (sec) evidence.push(sectionRef(sec, mType));
        const fs: Record<string, FieldSource> = {};
        const conflicts: string[] = tagInferred ? [`เสาไม่มีเบอร์ในผัง — ใช้ ${piece.tag} (เบอร์เสาเดียวในชุดแบบ) ตรวจยืนยัน`] : [];
        let conf = Math.min(inst.confidence ?? 0.7, sec?.def.confidence ?? 0.5);

        if (sec && isSteelSection(sec.def)) {
          skipped.push({ tag: piece.tag, page: sh.page, reason: 'โครงเหล็กรูปพรรณ (ไม่ใช่ ค.ส.ล.) — แยกถอดเป็นน้ำหนักเหล็ก' });
          continue;
        }
        // several detail sheets for one tag: each field compared, disagreements kept with their pages (no value chosen)
        recon = sec && sec.all.length > 1 ? reconcileSections(sec.all, mType) : [];

        const gridLoc = inst.to_grid ? `${inst.from_grid}–${inst.to_grid}` : (inst.from_grid || '-');
        const base: Partial<ExtractedMember> = {
          tag: piece.tag, memberType: mType, count: 1, unit: 'm', level, gridLocation: gridLoc,
          sourceFile, sourceSheetOrLayer: `${sh.sheet_id || ''} p${sh.page}`.trim(),
          rawDimensionStr: sec?.def.evidence || inst.tag,
        };

        if (mType === 'BEAM') {
          let len = inst.length_m ?? null;
          fs.length = len ? 'drawing' : 'missing';
          const a = gridPoint(sh, inst.from_grid), b = gridPoint(sh, inst.to_grid);
          if (a && b) {
            const g = Number(Math.hypot(a.x - b.x, a.y - b.y).toFixed(3));
            if (!len) { len = g; fs.length = 'grid'; }
            else if (Math.abs(g - len) > 0.05) conflicts.push(`ความยาว ${len} ม. ไม่ตรงกับระยะกริด ${inst.from_grid}–${inst.to_grid} = ${g} ม.`);
          }
          fs.width = sec?.def.width_m ? (sec.def.inferred_fields?.includes('width') ? 'inferred' : 'drawing') : 'missing';
          fs.depth = sec?.def.depth_m ? 'drawing' : 'missing';
          let [bw, bd] = [sec?.def.width_m || 0, sec?.def.depth_m || 0];
          if ((!bw || !bd) && typicalBeamWD) {
            if (!bw) { bw = typicalBeamWD[0]; fs.width = 'assumed'; }
            if (!bd) { bd = typicalBeamWD[1]; fs.depth = 'assumed'; }
            conflicts.push(`ไม่พบหน้าตัด ${piece.tag} ครบ — ใช้หน้าตัดคานที่พบบ่อยในชุดแบบ ${typicalBeamWD.join('×')} ม. ตรวจยืนยัน`);
          }
          fs.rebar = sec?.def.top_rebar || sec?.def.bottom_rebar ? (sec.def.inferred_fields?.includes('top_rebar') ? 'inferred' : 'drawing') : 'missing';
          if (sec?.def.section_conflicts?.length) { conflicts.push(...sec.def.section_conflicts); conf = Math.min(conf, 0.6); }
          // shortcut: square columns only (w === d), orientation along beam unneeded
          const colEnd = (grid?: string | null) => {
            if (!grid) return undefined;
            const tag = planCols.get(`${sh.page}|${grid}`);
            if (!tag) return undefined;
            const s = lookupSection(tag);
            if (!s || s.def.member_type !== 'COLUMN' || isSteelSection(s.def)) return undefined;
            const { width_m: w, depth_m: d } = s.def;
            if (!w || !d || w !== d) return undefined;
            if (s.def.inferred_fields?.includes('width') || s.def.inferred_fields?.includes('depth')) return undefined;
            return { tag, s, w, d };
          };
          const c1 = colEnd(inst.from_grid);
          const c2 = colEnd(inst.to_grid);
          let colW1 = typicalColW, colW2 = typicalColW;
          if (c1 && c2) {
            colW1 = c1.w;
            colW2 = c2.w;
            fs.support = 'drawing';
            evidence.push(
              { page: c1.s.page || sh.page, label: `เสารองรับ ${c1.tag} @ ${inst.from_grid}`, text: `${c1.w}×${c1.d} ม.`, method: 'vision' },
              { page: c2.s.page || sh.page, label: `เสารองรับ ${c2.tag} @ ${inst.to_grid}`, text: `${c2.w}×${c2.d} ม.`, method: 'vision' },
            );
          } else {
            fs.support = typicalColW ? 'inferred' : 'missing';
          }
          pushMember({
            ...base,
            width: bw, depth: bd, length: len || 0,
            supportColW1: colW1, supportColW2: colW2, isClearSpan: false,
            topRebar: rebarCount(sec?.def.top_rebar), bottomRebar: sumBars(sec?.def.bottom_rebar),
            stirrupRebar: sec?.def.stirrup || '', stirrupSets: sec?.def.stirrup_sets || undefined,
            provenance: { evidence, fieldSources: fs, confidence: conf, conflicts },
          } as ExtractedMember);
        } else if (mType === 'FOOTING') {
          const d = sec?.def;
          let thick = d?.thickness_m || d?.depth_m || 0;
          const nm = piece.tag.match(/^F(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)(?:X(\d+(?:\.\d+)?))?/);
          let w = d?.plan_w_m || (nm ? Number(nm[1]) : 0);
          let l = d?.plan_l_m || (nm ? Number(nm[2]) : 0);
          fs.width = d?.plan_w_m ? 'drawing' : nm ? 'inferred' : 'missing';
          fs.depth = d?.plan_l_m ? 'drawing' : nm ? 'inferred' : 'missing';
          fs.length = thick ? (d?.inferred_fields?.includes('thickness') ? 'inferred' : 'drawing') : 'missing';
          if (nm?.[3] && thick) {
            // the footing's name on the plan against the thickness its detail gives
            const named = reconcile('length', [{ value: Number(nm[3]), page: sh.page, ref: `ชื่อฐานรากในผัง (${piece.tag})`, method: 'vision' }, { value: thick, page: sec?.page ?? null, ref: 'แบบขยาย / ตาราง', method: 'vision' }]);
            if (named.kind === 'CONFLICT') { recon = [...recon, named]; conf = Math.min(conf, 0.5); }
          }
          fs.rebar = d?.bottom_rebar ? (d.inferred_fields?.includes('bottom_rebar') ? 'inferred' : 'drawing') : 'missing';
          const exc = d?.height_m && d.height_m > thick ? d.height_m : 1.0;
          fs.excavation = d?.height_m ? 'drawing' : 'assumed';
          const piled = !!d?.pile_count || /เข็ม/.test(footingPlanTitle || '');
          if (piled) fs.piles = d?.pile_count ? 'drawing' : 'missing';
          pushMember({
            ...base, width: w, depth: l, length: thick,
            bottomRebar: d?.bottom_rebar ? rebarCount(d.bottom_rebar) : '',
            rebarNotesRead: d?.rebar_notes?.length ? d.rebar_notes : undefined,
            excavationDepthM: exc, footingType: piled || /เข็ม/.test(d?.evidence || '') ? 'PILE_CAP' : 'ISOLATED',
            pileCount: d?.pile_count || undefined,
            provenance: { evidence, fieldSources: fs, confidence: conf, conflicts },
          } as ExtractedMember);
        } else if (mType === 'COLUMN') {
          const d = sec?.def;
          let h = d?.height_m || 0;
          fs.length = h ? 'drawing' : 'assumed';
          const footingHere = members.find(m => m.memberType === 'FOOTING' && m.gridLocation === gridLoc && m.level === level);
          const top = elevationOf(d?.to_level);
          if (!h && footingHere && top !== undefined) {
            const footTop = -(footingHere.excavationDepthM || 1.0) + (footingHere.length || 0);
            h = Number((top - footTop).toFixed(3));
            fs.length = 'inferred';
            evidence.push({ page: levelSheet!.page, label: `ระดับ ${d?.to_level} (${top >= 0 ? '+' : ''}${top.toFixed(2)})`, text: `${d?.from_level} → ${d?.to_level}: ${footTop.toFixed(2)} → ${top.toFixed(2)} ม.`, method: 'vision' });
          }
          if (!h && levels.length) {
            if (sh.sheet_type === 'footing_plan' && footingHere && framingLevels.length) {
              const footTop = -(footingHere.excavationDepthM || 1.0) + (footingHere.length || 0);
              h = Number((framingLevels[0].elev - footTop).toFixed(3));
              fs.length = 'inferred';
              evidence.push({ page: levelSheet!.page, label: `ระดับ ${framingLevels[0].label}`, text: `ฐานราก ${footTop.toFixed(2)} → ${framingLevels[0].label} ${framingLevels[0].elev.toFixed(2)} ม.`, method: 'vision' });
            } else if (sh.sheet_type === 'framing_plan') {
              const idx = framingLevels.findIndex(l => l.label === level);
              if (idx === 0 && hasFootingPlan) {
                skipped.push({ tag: piece.tag, page: sh.page, reason: `เสาช่วงฐานราก–${level} นับรวมในตอม่อแล้ว` });
                continue;
              }
              if (idx > 0) {
                h = Number((framingLevels[idx].elev - framingLevels[idx - 1].elev).toFixed(3));
                fs.length = 'inferred';
                evidence.push({ page: levelSheet!.page, label: `ระดับ ${framingLevels[idx - 1].label}–${level}`, text: `${framingLevels[idx - 1].elev.toFixed(2)} → ${framingLevels[idx].elev.toFixed(2)} ม.`, method: 'vision' });
              }
            }
          }
          if (!h) h = sh.sheet_type === 'footing_plan' ? assumptions.columnStubHeightM : assumptions.storeyHeightM;
          fs.width = d?.width_m ? 'drawing' : 'missing';
          fs.depth = d?.depth_m ? 'drawing' : 'missing';
          fs.rebar = d?.main_rebar ? 'drawing' : 'missing';
          const main = rebarCount(d?.main_rebar);
          if (d?.section_conflicts?.length) { conflicts.push(...d.section_conflicts); conf = Math.min(conf, 0.6); }
          pushMember({
            ...base, width: d?.width_m || 0, depth: d?.depth_m || 0, length: h,
            topRebar: main, bottomRebar: '', stirrupRebar: d?.stirrup || '', stirrupSets: d?.stirrup_sets || undefined,
            level: sh.sheet_type === 'footing_plan' ? (d?.to_level && fs.length === 'inferred' ? `เสา ${d?.from_level}–${d?.to_level}` : 'ตอม่อ (ฐานราก–คานคอดิน)') : level,
            provenance: { evidence, fieldSources: fs, confidence: conf, conflicts },
          } as ExtractedMember);
        } else if (mType === 'SLAB') {
          const a = gridPoint(sh, inst.from_grid), b = gridPoint(sh, inst.to_grid);
          const sx = a && b ? Number(Math.abs(a.x - b.x).toFixed(3)) : 0;
          const sy = a && b ? Number(Math.abs(a.y - b.y).toFixed(3)) : 0;
          const isPrecast = /^SP/.test(piece.tag);
          const t = sec?.def.thickness_m || (isPrecast ? 0.05 : 0);
          fs.width = sx ? 'grid' : 'missing';
          fs.depth = sy ? 'grid' : 'missing';
          fs.length = sec?.def.thickness_m ? 'drawing' : isPrecast ? 'inferred' : 'missing';
          const onGround = /ทราย|ดินเดิม|on ground/i.test(sec?.def.evidence || '') || (sh.sheet_type === 'framing_plan' && /ชั้น\s*1|1F|ground/i.test(level) && /^S0/.test(piece.tag));
          pushMember({
            ...base, width: sx, depth: sy, length: t,
            slabType: isPrecast ? 'PRECAST_PLANK' : onGround ? 'SLAB_ON_GROUND' : 'CAST_IN_PLACE',
            topRebar: sec?.def.top_rebar || sec?.def.main_rebar || '', bottomRebar: sec?.def.bottom_rebar || '',
            provenance: { evidence, fieldSources: fs, confidence: Math.min(conf, sx && sy ? 1 : 0.4), conflicts },
          } as ExtractedMember);
        } else if (mType === 'WALL') {
          let len = inst.length_m ?? null;
          fs.length = len ? 'drawing' : 'missing';
          const a = gridPoint(sh, inst.from_grid), b = gridPoint(sh, inst.to_grid);
          if (a && b) {
            const g = Number(Math.hypot(a.x - b.x, a.y - b.y).toFixed(3));
            if (!len) { len = g; fs.length = 'grid'; }
          }
          const thickness = sec?.def.width_m || 0.10;
          const height = sec?.def.depth_m || 2.80;
          fs.width = sec?.def.width_m ? 'drawing' : 'assumed';
          fs.depth = sec?.def.depth_m ? 'drawing' : 'assumed';
          pushMember({
            ...base,
            width: thickness, depth: height, length: len || 0,
            provenance: { evidence, fieldSources: fs, confidence: conf, conflicts },
          } as ExtractedMember);
        } else if (mType === 'DOOR' || mType === 'WINDOW') {
          const w = sec?.def.width_m || (mType === 'DOOR' ? 0.90 : 1.20);
          const h = sec?.def.depth_m || (mType === 'DOOR' ? 2.00 : 1.10);
          fs.width = sec?.def.width_m ? 'drawing' : 'assumed';
          fs.depth = sec?.def.depth_m ? 'drawing' : 'assumed';
          fs.length = 'drawing';
          pushMember({
            ...base,
            width: w, depth: h, length: 1, count: (inst as any).count || 1,
            provenance: { evidence, fieldSources: fs, confidence: conf, conflicts },
          } as ExtractedMember);
        } else if (mType === 'FINISH') {
          const w = (inst as any).plan_w_m || sec?.def.width_m || 3.0;
          const d = (inst as any).plan_l_m || sec?.def.depth_m || 3.0;
          fs.width = (inst as any).plan_w_m ? 'drawing' : 'assumed';
          fs.depth = (inst as any).plan_l_m ? 'drawing' : 'assumed';
          fs.length = 'drawing';
          pushMember({
            ...base,
            width: w, depth: d, length: 0.05, count: 1,
            provenance: { evidence, fieldSources: fs, confidence: conf, conflicts },
          } as ExtractedMember);
        } else {
          skipped.push({ tag: piece.tag, page: sh.page, reason: `ยังไม่รองรับ ${mType} จากผัง` });
        }
        usedPages.add(sh.page);
        if (sec) usedPages.add(sec.page);
      }
    }
  }

  for (const sh of sheets) {
    for (const s of sh.sections || []) {
      if (s.member_type !== 'STAIR') continue;
      if (members.some(m => m.memberType === 'STAIR' && m.tag === normTag(s.tag))) continue;
      const rise = s.stair_rise_m || s.height_m || 0;
      const run = s.stair_run_m || (() => { const m = (s.evidence || '').match(/แนวราบ\s*(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; })();
      const slope = rise && run ? Number(Math.hypot(rise, run).toFixed(3)) : (s.length_m || 0);
      members.push({
        tag: normTag(s.tag), memberType: 'STAIR', count: 1, unit: 'm',
        width: assumptions.stairWidthM, depth: s.thickness_m || 0, length: slope,
        topRebar: s.top_rebar || '', bottomRebar: s.bottom_rebar || '',
        distRebar: s.dist_rebar || undefined,
        stairRisers: s.stair_risers || undefined,
        stairRunM: run || undefined,
        stairRiseM: rise || undefined,
        level: 'บันได', gridLocation: '-', sourceFile, sourceSheetOrLayer: `${sh.sheet_id || ''} p${sh.page}`.trim(),
        rawDimensionStr: s.evidence || s.tag,
        provenance: {
          evidence: [{ page: sh.page, bboxNorm: boxToNorm(s.box_2d), label: 'แบบขยายบันได', text: s.evidence, method: 'vision' }],
          fieldSources: {
            width: 'assumed', depth: s.thickness_m ? 'drawing' : 'missing', length: slope ? 'drawing' : 'missing',
            rebar: s.bottom_rebar || s.top_rebar ? 'drawing' : 'missing',
            dist: s.dist_rebar ? 'drawing' : 'missing',
            steps: run && rise ? 'drawing' : 'missing',
          },
          confidence: Math.min(s.confidence ?? 0.6, 0.6),
          conflicts: [],
        },
      });
      usedPages.add(sh.page);
    }
  }

  const allNotes = sheets.flatMap(s => s.notes || []);
  const sandNote = allNotes.map(n => n.match(/ทราย[^0-9]*หนา\s*(\d+(?:\.\d+)?)\s*ม/)).find(Boolean);
  if (sandNote) {
    const t = Number(sandNote[1]);
    for (const m of members) {
      if (m.memberType === 'FOOTING' || m.slabType === 'SLAB_ON_GROUND') {
        m.sandThicknessM = t;
        m.provenance!.fieldSources.sand = m.memberType === 'FOOTING' ? 'drawing' : 'inferred';
      }
    }
    notes.push(`ทรายรองพื้นหนา ${t} ม. (จากหมายเหตุในแบบ)`);
  }

  for (const m of members) {
    if ((m.width || 0) <= 0 || (m.depth || 0) <= 0) {
      m.provenance!.conflicts = [...(m.provenance!.conflicts || []), `ไม่พบแบบขยาย/ตารางของ ${m.tag} ในชุดแบบ`];
    }
  }

  const slabRects = members.filter(m => m.memberType === 'SLAB').map(m => {
    const [from, to] = (m.gridLocation || '').split('–');
    const sh = sheets.find(x => x.page === m.provenance?.evidence[0]?.page && x.grid);
    const a = sh && gridPoint(sh, from), b = sh && gridPoint(sh, to);
    return a && b ? { m, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) } : null;
  }).filter(Boolean) as { m: ExtractedMember; x0: number; x1: number; y0: number; y1: number }[];
  for (let i = 0; i < slabRects.length; i++) for (let j = i + 1; j < slabRects.length; j++) {
    const p = slabRects[i], q = slabRects[j];
    if (p.m.level !== q.m.level || p.m.gridLocation === q.m.gridLocation) continue;
    const ox = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0), oy = Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0);
    if (ox > 0.05 && oy > 0.05) {
      const msg = (o: ExtractedMember) => `พื้นซ้อนทับกับ ${o.tag} ${o.gridLocation} (${(ox * oy).toFixed(2)} ตร.ม.) — นับซ้ำได้ เลือกอันที่ถูก`;
      p.m.provenance!.conflicts = [...(p.m.provenance!.conflicts || []), msg(q.m)];
      q.m.provenance!.conflicts = [...(q.m.provenance!.conflicts || []), msg(p.m)];
    }
  }

  const completeness: CompletenessFinding[] = [];
  const usedTags = new Set(members.map(m => normTag(m.tag)).concat(skipped.map(s => normTag(s.tag))));
  const otherFootingVariant = footingPlans.length > 1;
  for (const [tag, list] of sectionsByTag) {
    const d = list[0].def;
    if (isSteelSection(d) || d.member_type === 'STAIR' || usedTags.has(tag)) continue;
    if (d.member_type === 'FOOTING' && (otherFootingVariant || [...usedTags].some(u => u.startsWith(tag)))) continue;
    if (!/^[A-Z]{1,4}\d*[A-Z]?$/.test(tag) && !/^F\d/.test(tag)) continue;
    if (tag.length === 1) continue;
    const type = (MEMBER_TYPES.includes(d.member_type as MemberType) ? d.member_type : 'BEAM') as MemberType;
    const isSlab = type === 'SLAB';
    completeness.push({
      message: `แบบขยายกำหนด ${tag} ไว้ (หน้า ${list[0].page}) แต่ไม่พบในผัง — อาจถอดตกหล่น`,
      suggested: [{
        tag, memberType: type, count: 1, unit: 'm', level: '-', gridLocation: '-', sourceFile,
        width: isSlab ? 0 : d.width_m || 0, depth: isSlab ? 0 : d.depth_m || 0, length: isSlab ? d.thickness_m || 0 : 0,
        supportColW1: type === 'BEAM' ? typicalColW : 0, supportColW2: type === 'BEAM' ? typicalColW : 0,
        topRebar: rebarCount(d.top_rebar) || d.main_rebar || '', bottomRebar: sumBars(d.bottom_rebar), stirrupRebar: d.stirrup || '', stirrupSets: d.stirrup_sets || undefined,
        rawDimensionStr: d.evidence || tag,
        provenance: {
          evidence: [{ page: list[0].page, bboxNorm: boxToNorm(d.box_2d), label: 'แบบขยาย / ตาราง', text: d.evidence || tag, method: 'vision' }],
          fieldSources: isSlab ? { width: 'missing', depth: 'missing', length: 'drawing' } : { width: 'drawing', depth: 'drawing', length: 'missing' },
          confidence: 0.6,
          conflicts: ['เพิ่มจากการตรวจความครบถ้วน — ระบุตำแหน่ง/ความยาวจากผัง'],
        },
      }],
    });
  }
  if (framingLevels.length > 1) {
    const colLevels = new Set(members.filter(m => m.memberType === 'COLUMN').map(m => m.level));
    const fullHeight = members.some(m => m.memberType === 'COLUMN' && /อะเส|ชั้นบน|ชั้น\s*2/.test(m.level || ''));
    const rcLevels = new Set(members.filter(m => m.memberType !== 'COLUMN').map(m => m.level));
    const stubs = members.filter(m => m.memberType === 'COLUMN' && /ตอม่อ|ฐานราก/.test(m.level || ''));
    framingLevels.slice(1).forEach((l, k) => {
      if (colLevels.has(l.label) || fullHeight || !rcLevels.has(l.label)) return;
      const below = framingLevels[k];
      const h = Number((l.elev - below.elev).toFixed(3));
      completeness.push({
        message: `ไม่พบเสา ค.ส.ล. ที่${l.label} — ถ้าเสาต่อขึ้นจากชั้นล่าง เพิ่ม ${stubs.length} ต้น สูง ${h} ม. (${below.label} → ${l.label})`,
        suggested: stubs.map(st => ({
          ...st, level: l.label, length: h,
          provenance: {
            ...st.provenance!,
            evidence: [...st.provenance!.evidence, ...(levelSheet ? [{ page: levelSheet.page, label: `ระดับ ${below.label}–${l.label}`, text: `${below.elev.toFixed(2)} → ${l.elev.toFixed(2)} ม.`, method: 'vision' as const }] : [])],
            fieldSources: { ...st.provenance!.fieldSources, length: 'inferred' },
            confidence: 0.6,
            conflicts: [`เพิ่มจากการตรวจความครบถ้วน — ยืนยันว่าเสาต่อถึง${l.label}`],
          },
        })),
      });
    });
  }
  const footings = members.filter(m => m.memberType === 'FOOTING');
  const stubs = members.filter(m => m.memberType === 'COLUMN' && /ตอม่อ|ฐานราก/.test(m.level || ''));
  if (footings.length && stubs.length < footings.length) completeness.push({ message: `ฐานราก ${footings.length} ตำแหน่ง แต่มีตอม่อ ${stubs.length} ต้น — ตรวจเสาตอม่อที่ขาด`, suggested: [] });
  const lonely = stubs.filter(st => !footings.some(f => f.gridLocation === st.gridLocation));
  if (footings.length && lonely.length) {
    const counts = new Map<string, ExtractedMember>();
    for (const f of footings) counts.set(f.tag, f);
    const typical = [...counts.values()].sort((a, b) => footings.filter(f => f.tag === b.tag).length - footings.filter(f => f.tag === a.tag).length)[0];
    completeness.push({
      message: `ตอม่อ ${lonely.length} ต้น (${lonely.map(l => l.gridLocation).join(', ')}) ไม่มีฐานรากกำกับ — เพิ่มฐานรากเบอร์ ${typical.tag} แล้วแก้เบอร์ให้ตรงแบบ`,
      suggested: lonely.map(l => ({
        ...typical, gridLocation: l.gridLocation,
        provenance: { ...typical.provenance!, evidence: l.provenance!.evidence, fieldSources: { ...typical.provenance!.fieldSources, tag: 'assumed' }, confidence: 0.5,
          conflicts: [`เพิ่มจากการตรวจความครบถ้วน — เบอร์ฐานรากที่ ${l.gridLocation} อ่านไม่ได้ ใช้ ${typical.tag} ชั่วคราว`] },
      })),
    });
  }
  notes.push(...completeness.map(c => c.message));

  return {
    members,
    notes,
    skipped,
    completeness,
    sheets: sheets.map(s => ({ page: s.page, sheetId: s.sheet_id, title: s.sheet_title, type: s.sheet_type, used: usedPages.has(s.page) })),
  };
}

/**
 * Combines several Vision readings of the SAME sheet (self-consistency). A member every pass
 * agrees on keeps its confidence; one seen by only some passes is kept but marked less
 * certain, so disagreement between reads lands in the review queue instead of being lost.
 */
export function combineReadings(passes: SheetReading[]): SheetReading {
  if (passes.length <= 1) return passes[0];
  const base = passes.reduce((a, b) => ((b.instances?.length || 0) + (b.sections?.length || 0) > (a.instances?.length || 0) + (a.sections?.length || 0) ? b : a));
  const key = (i: PlanInstance) => [normTag(i.tag), i.from_grid || '', i.to_grid || '', i.level || i.plan_title || ''].join('|');
  const loose = (i: PlanInstance) => [normTag(i.tag), i.level || i.plan_title || ''].join('|');

  const seen = new Map<string, { inst: PlanInstance; votes: number }>();
  for (const p of passes) {
    const local = new Map<string, number>();
    for (const inst of p.instances || []) {
      const k0 = key(inst);
      const n = (local.get(k0) || 0) + 1;
      local.set(k0, n);
      const k = `${k0}#${n}`;
      const e = seen.get(k);
      if (e) {
        e.votes += 1;
        if ((inst.length_m ?? null) !== null && e.inst.length_m == null) e.inst = { ...e.inst, length_m: inst.length_m };
      } else seen.set(k, { inst: { ...inst }, votes: 1 });
    }
  }
  const located = new Set([...seen.values()].filter(v => v.inst.from_grid).map(v => loose(v.inst)));
  const instances = [...seen.values()]
    .filter(v => v.inst.from_grid || !located.has(loose(v.inst)))
    .map(v => ({ ...v.inst, confidence: Number(((v.inst.confidence ?? 0.8) * (v.votes === passes.length ? 1 : 0.75)).toFixed(2)) }));

  const sections = new Map<string, SectionDef>();
  for (const p of passes) for (const s of p.sections || []) {
    const k = normTag(s.tag);
    const prev = sections.get(k);
    if (!prev || (s.confidence ?? 0) > (prev.confidence ?? 0)) sections.set(k, s);
  }
  const notes = [...new Set(passes.flatMap(p => p.notes || []))];
  const levels = passes.map(p => p.levels || []).sort((a, b) => b.length - a.length)[0];
  return { ...base, instances, sections: [...sections.values()], notes, levels };
}
