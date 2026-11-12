/**
 * StructBOQ - compares the system takeoff against a real BOQ (แบบ ปร.4) line by line.
 */
import type { BOQProjectResult } from './qsEngine';

export interface BoqSource { page: number; bbox: number[]; text: string; quantity: number; unit: string; page_width?: number; page_height?: number }
export interface BoqTotal { quantity: number; unit: string; sources: BoqSource[] }
export type BoqTotals = Record<string, BoqTotal>;

export interface TakeoffTotal { quantity: number; itemIds: string[] }

export type Verdict = 'match' | 'rounding' | 'close' | 'off' | 'not_in_boq' | 'missing_in_takeoff';

export interface ComparisonRow {
  key: string;
  label: string;
  unit: string;
  system: number;
  boq: number | null;
  diff: number | null;
  pct: number | null;
  verdict: Verdict;
  itemIds: string[];
  boqSources: BoqSource[];
}

export interface ComparisonReport {
  rows: ComparisonRow[];
  headline: { key: string; label: string; pct: number | null; verdict: Verdict }[];
  meanAbsPct: number | null;
  boqRoundedToInteger: boolean;
  /** How the BOQ's own structure was mapped (e.g. formwork material vs contact area) */
  notes: string[];
}

export const QUANTITY_LABELS: Record<string, { label: string; unit: string; order: number }> = {
  excavation_m3: { label: 'ขุดดิน', unit: 'ลบ.ม.', order: 1 },
  sand_m3: { label: 'ทรายรองพื้น/ทรายอัดแน่น', unit: 'ลบ.ม.', order: 2 },
  lean_concrete_m3: { label: 'คอนกรีตหยาบ', unit: 'ลบ.ม.', order: 3 },
  structural_concrete_m3: { label: 'คอนกรีตโครงสร้าง', unit: 'ลบ.ม.', order: 4 },
  formwork_m2: { label: 'ไม้แบบ (พื้นที่ผิวสัมผัส)', unit: 'ตร.ม.', order: 5 },
  rebar_total_kg: { label: 'เหล็กเสริมรวม', unit: 'กก.', order: 6 },
  rebar_RB6_kg: { label: 'เหล็ก RB6 (SR24)', unit: 'กก.', order: 7 },
  rebar_RB9_kg: { label: 'เหล็ก RB9 (SR24)', unit: 'กก.', order: 8 },
  rebar_DB10_kg: { label: 'เหล็ก DB10', unit: 'กก.', order: 9 },
  rebar_DB12_kg: { label: 'เหล็ก DB12 (SD40)', unit: 'กก.', order: 10 },
  rebar_DB16_kg: { label: 'เหล็ก DB16 (SD40)', unit: 'กก.', order: 11 },
  rebar_DB20_kg: { label: 'เหล็ก DB20', unit: 'กก.', order: 12 },
  rebar_DB25_kg: { label: 'เหล็ก DB25', unit: 'กก.', order: 13 },
  precast_plank_m2: { label: 'แผ่นพื้นสำเร็จรูป', unit: 'ตร.ม.', order: 14 },
  topping_m2: { label: 'คอนกรีตทับหน้า + Wire mesh', unit: 'ตร.ม.', order: 15 },
  backfill_m3: { label: 'ถมดินกลับ', unit: 'ลบ.ม.', order: 16 },
  piles_nos: { label: 'เสาเข็ม', unit: 'ต้น', order: 17 },
};

const HEADLINE_KEYS = ['structural_concrete_m3', 'formwork_m2', 'rebar_total_kg', 'excavation_m3'];

export function takeoffTotals(result: BOQProjectResult, opts: { toppingSeparate?: boolean } = {}): Record<string, TakeoffTotal> {
  const out: Record<string, TakeoffTotal> = {};
  const add = (key: string, q: number, id: string) => {
    if (!q) return;
    const t = (out[key] ||= { quantity: 0, itemIds: [] });
    t.quantity += q;
    if (!t.itemIds.includes(id)) t.itemIds.push(id);
  };
  for (const it of result.items) {
    if (it.status === 'REJECTED') continue;
    // Topping on precast planks is usually its own m² line in a ปร.4 (concrete + mesh included)
    if (!(opts.toppingSeparate && it.precastSlabM2)) add('structural_concrete_m3', it.volumeNetM3, it.itemId);
    add('formwork_m2', it.formworkNetM2, it.itemId);
    add('excavation_m3', it.excavationM3 || 0, it.itemId);
    add('sand_m3', it.sandBeddingM3 || 0, it.itemId);
    add('lean_concrete_m3', it.leanConcreteM3 || 0, it.itemId);
    add('backfill_m3', it.backfillM3 || 0, it.itemId);
    add('piles_nos', it.pilesNos || 0, it.itemId);
    add('precast_plank_m2', it.precastSlabM2 || 0, it.itemId);
    add('topping_m2', it.precastSlabM2 ? it.wiremeshM2 || 0 : 0, it.itemId);
    for (const [bar, kg] of Object.entries(it.rebarByDia || {})) {
      add(`rebar_${bar}_kg`, kg, it.itemId);
      add('rebar_total_kg', kg, it.itemId);
    }
  }
  for (const t of Object.values(out)) t.quantity = Number(t.quantity.toFixed(3));
  return out;
}

export function withRebarTotal(boq: BoqTotals): BoqTotals {
  const rebar = Object.entries(boq).filter(([k]) => /^rebar_(RB|DB)\d+_kg$/.test(k));
  if (!rebar.length || boq.rebar_total_kg) return boq;
  return {
    ...boq,
    rebar_total_kg: {
      quantity: rebar.reduce((a, [, v]) => a + v.quantity, 0),
      unit: 'กก.',
      sources: rebar.flatMap(([, v]) => v.sources),
    },
  };
}

export function compareTakeoffWithBoq(result: BOQProjectResult, boqIn: BoqTotals): ComparisonReport {
  let boq = withRebarTotal(boqIn);
  const notes: string[] = [];
  const toppingSeparate = !!boq.topping_m2;
  const sys = takeoffTotals(result, { toppingSeparate });
  if (toppingSeparate) notes.push('BOQ แยกคอนกรีตทับหน้าพื้นสำเร็จรูปเป็นรายการ ตร.ม. — ไม่นับรวมในคอนกรีตโครงสร้าง');
  // Thai ปร.4: "แบบหล่อคอนกรีต" (material) allows for reuse; "ค่าแรงแบบหล่อ" is the full contact area.
  // The takeoff computes contact area, so it is compared with the labour line.
  if (boq.formwork_labour_m2) {
    const mat = boq.formwork_m2?.quantity;
    const lab = boq.formwork_labour_m2.quantity;
    boq = { ...boq, formwork_m2: boq.formwork_labour_m2 };
    if (mat) notes.push(`ไม้แบบ: เทียบกับบรรทัด "ค่าแรงแบบหล่อ" ${lab} ตร.ม. (พื้นที่ผิวสัมผัส); ค่าวัสดุ ${mat} ตร.ม. = ใช้ซ้ำ ~${(mat / lab).toFixed(2)} เท่าของพื้นที่`);
  }
  const keys = [...new Set([...Object.keys(sys), ...Object.keys(boq)])]
    .filter(k => QUANTITY_LABELS[k] && k !== 'formwork_labour_m2')
    .sort((a, b) => (QUANTITY_LABELS[a]?.order ?? 99) - (QUANTITY_LABELS[b]?.order ?? 99));

  const allBoq = Object.values(boq).flatMap(b => b.sources.map(s => s.quantity));
  const rounded = allBoq.length > 0 && allBoq.every(q => Number.isInteger(q));

  const rows: ComparisonRow[] = keys.map(key => {
    const s = sys[key]?.quantity ?? 0;
    const b = boq[key]?.quantity ?? null;
    const meta = QUANTITY_LABELS[key];
    let verdict: Verdict;
    let diff: number | null = null;
    let pct: number | null = null;
    if (b === null) verdict = 'not_in_boq';
    else if (s === 0) { verdict = 'missing_in_takeoff'; diff = -b; pct = -100; }
    else {
      diff = Number((s - b).toFixed(3));
      pct = b !== 0 ? Number(((diff / b) * 100).toFixed(1)) : null;
      // A BOQ rounded to whole units rounds each line up (ceil), so true total lies in (b - k, b]
      const k = boq[key]?.sources.length || 1;
      const isRounding = rounded && s > b - k && s <= b + 1e-9;
      const a = Math.abs(pct ?? 100);
      verdict = a <= 5 ? 'match' : isRounding ? 'rounding' : a <= 15 ? 'close' : 'off';
    }
    return {
      key, label: meta.label, unit: meta.unit, system: Number(s.toFixed(2)), boq: b, diff, pct, verdict,
      itemIds: sys[key]?.itemIds || [], boqSources: boq[key]?.sources || [],
    };
  });

  const headline = HEADLINE_KEYS.map(k => rows.find(r => r.key === k)).filter(Boolean)
    .map(r => ({ key: r!.key, label: r!.label, pct: r!.pct, verdict: r!.verdict }));
  const pcts = headline.map(h => h.pct).filter((p): p is number => p !== null);
  return {
    rows,
    headline,
    meanAbsPct: pcts.length ? Number((pcts.reduce((a, p) => a + Math.abs(p), 0) / pcts.length).toFixed(1)) : null,
    boqRoundedToInteger: rounded,
    notes,
  };
}
