/**
 * Source reconciliation: one member read from several places (detail sheets, schedule rows, the footing's name).
 * For each field the sources are IDENTICAL, COMPLEMENTARY (one fills what another left out), CONFLICT (different
 * values) or UNDECIDABLE (written in forms that cannot be compared). Nothing here picks a value: a conflict is
 * recorded with every source and its page, and the release gate holds the field until a reviewer rules.
 */
import type { ConflictField, ConflictSource, ExtractedMember, FieldConflict, Provenance } from './qsEngine';

export type SourceValue = { value: string | number | null | undefined; page: number | null; ref: string; method?: ConflictSource['method'] };
export type Reconciled =
  | { kind: 'NONE' }
  | { kind: 'IDENTICAL' | 'COMPLEMENTARY'; field: ConflictField; pages: number[] }
  | FieldConflict;

const present = (v: unknown) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && !(v > 0));
/** bar text in a comparable form: "2 - db 12" and "2-DB12" are the same; null if it is not bar notation */
const barKey = (v: string) => {
  const t = v.replace(/\s/g, '').toUpperCase().replace(/[Øø]/g, 'RB');
  return /^(\d+-(DB|RB)\d{1,2})(\+\d+-(DB|RB)\d{1,2})*$|^(DB|RB)\d{1,2}@\d*\.?\d+$|^\d+\+\d+-(DB|RB)\d{1,2}$/.test(t) ? t : null;
};
const comparable = (v: string | number) => (typeof v === 'number' ? Number(v.toFixed(4)) : barKey(v));

export function reconcile(field: ConflictField, sources: SourceValue[]): Reconciled {
  const given = sources.filter(s => present(s.value));
  if (sources.length < 2 || !given.length) return { kind: 'NONE' };
  const pages = [...new Set(sources.map(s => s.page).filter((p): p is number => p != null))].sort((a, b) => a - b);
  const keys = given.map(s => comparable(s.value as string | number));
  const clean = (s: SourceValue): ConflictSource => ({ value: s.value ?? null, page: s.page, ref: s.ref, ...(s.method ? { method: s.method } : {}) });
  if (keys.some(k => k === null)) {
    const raw = new Set(given.map(s => String(s.value).replace(/\s/g, '').toUpperCase()));
    return raw.size > 1 ? { field, kind: 'UNDECIDABLE', sources: sources.map(clean) } : { kind: given.length < sources.length ? 'COMPLEMENTARY' : 'IDENTICAL', field, pages };
  }
  if (new Set(keys).size > 1) return { field, kind: 'CONFLICT', sources: sources.map(clean) };
  return { kind: given.length < sources.length ? 'COMPLEMENTARY' : 'IDENTICAL', field, pages };
}

/** Adds what reconciling these fields found to a provenance (conflicts with their sources, agreements with their pages). */
export function recordReconciled(prov: Provenance, results: Reconciled[]): Provenance {
  const conflicts = results.filter((r): r is FieldConflict => r.kind === 'CONFLICT' || r.kind === 'UNDECIDABLE');
  const agreements = results.flatMap(r => (r.kind === 'IDENTICAL' || r.kind === 'COMPLEMENTARY' ? [{ field: r.field, kind: r.kind, pages: r.pages }] : []));
  return {
    ...prov,
    ...(conflicts.length ? { fieldConflicts: [...(prov.fieldConflicts || []), ...conflicts] } : {}),
    ...(agreements.length ? { fieldAgreements: [...(prov.fieldAgreements || []), ...agreements] } : {}),
  };
}

const SCHEDULE_FIELDS: ConflictField[] = ['width', 'depth', 'length', 'count', 'topRebar', 'bottomRebar', 'stirrupRebar'];
/**
 * Schedule rows of the same tag and type on different pages: every row keeps its member (quantities unchanged),
 * and each records the other pages' values — a disagreement holds every one of them until the reviewer rules.
 */
export function reconcileScheduleRows(members: ExtractedMember[]): ExtractedMember[] {
  const groups = new Map<string, number[]>();
  members.forEach((m, i) => { const k = `${m.memberType}::${m.tag.toUpperCase()}`; groups.set(k, [...(groups.get(k) || []), i]); });
  const out = [...members];
  for (const idx of groups.values()) {
    const pages = new Set(idx.map(i => members[i].provenance?.evidence[0]?.page));
    if (idx.length < 2 || pages.size < 2) continue;
    const results = SCHEDULE_FIELDS.map(f => reconcile(f, idx.map(i => ({
      value: (members[i] as any)[f], page: members[i].provenance?.evidence[0]?.page ?? null, ref: 'บรรทัดในตาราง', method: members[i].provenance?.evidence[0]?.method,
    }))));
    for (const i of idx) if (out[i].provenance) out[i] = { ...out[i], provenance: recordReconciled(out[i].provenance!, results) };
  }
  return out;
}
