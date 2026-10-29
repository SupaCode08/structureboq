/**
 * Offline benchmark (no API): cached OCR words -> rule-based sheet reader -> merge -> QS -> vs real BOQ.
 *
 *   npx tsx scripts/benchmark_offline.ts real_drawings/house_ready_3 [--items] [--readings]
 *
 * Needs <dir>/offline_ocr.json from scripts/offline_ocr.ts and <dir>/boq.json.
 */
import fs from 'fs';
import path from 'path';
import { computeProject, DEFAULT_MATERIAL_SPECS, type ExtractedMember } from '../src/engine/qsEngine.ts';
import { mergeSheetReadings, DEFAULT_MERGE_ASSUMPTIONS } from '../src/engine/sheetMerge.ts';
import { compareTakeoffWithBoq } from '../src/engine/boqCompare.ts';
import { readSheets } from '../src/pdf/sheetReader.ts';
import { requireFullBoq } from './fullGuard.ts';
requireFullBoq('benchmark_offline.ts');

const dir = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
const ocr = JSON.parse(fs.readFileSync(path.join(dir, 'offline_ocr.json'), 'utf-8'));
const boq = JSON.parse(fs.readFileSync(path.join(dir, manifest.boqJson), 'utf-8'));
const footing = process.argv.find(a => a.startsWith('--footing='))?.slice(10);
if (footing) Object.assign(manifest, { footingVariant: footing, boqVariant: footing });
const variant = Object.keys(boq.structural_by_variant).find(v => v.includes(manifest.boqVariant)) || Object.keys(boq.structural_by_variant)[0];

const { readings, notes, vocab } = readSheets(ocr.pages);
if (process.argv.includes('--readings')) {
  for (const r of readings) {
    console.log(`p${r.page} ${r.sheet_type} grid x=${JSON.stringify(r.grid?.x?.map(g => g.offset_m))} y=${JSON.stringify(r.grid?.y?.map(g => g.offset_m))}`);
    for (const i of r.instances) console.log('   I', i.tag, i.member_type, i.from_grid, i.to_grid, i.length_m, i.level, i.confidence);
    for (const s of r.sections) console.log('   S', s.tag, s.member_type, s.width_m, s.depth_m, s.thickness_m, s.plan_w_m, s.top_rebar, s.bottom_rebar, s.stirrup, '|', s.evidence);
    if (r.levels) console.log('   L', JSON.stringify(r.levels));
  }
}
const merged = mergeSheetReadings(readings, manifest.pdf, { ...DEFAULT_MERGE_ASSUMPTIONS, footingVariant: manifest.footingVariant });

// Simulated reviewer: section-table entries (one per tag) + accepting completeness suggestions
const simPath = path.join(dir, 'review_sim.json');
function reviewed(): { members: ExtractedMember[]; entries: number; touched: number } {
  if (!fs.existsSync(simPath)) return { members: merged.members, entries: 0, touched: 0 };
  const sim = JSON.parse(fs.readFileSync(simPath, 'utf-8'));
  let members = sim.acceptCompleteness ? [...merged.members, ...merged.completeness.flatMap(c => c.suggested)] : [...merged.members];
  let touched = 0;
  let changedEntries = 0;
  for (const e of sim.entries) {
    let changed = false;
    members = members.map(m => {
      if (m.tag.split(',')[0] !== e.tag && m.tag !== e.tag) return m;
      touched++;
      if (Object.entries(e.patch).some(([k, v]) => (m as any)[k] !== v)) changed = true;
      const fs2 = { ...(m.provenance?.fieldSources || {}) };
      for (const k of Object.keys(e.patch)) fs2[k === 'length' ? 'length' : k === 'width' ? 'width' : k === 'depth' ? 'depth' : 'rebar'] = 'reviewer';
      return { ...m, ...e.patch, provenance: m.provenance && { ...m.provenance, fieldSources: fs2 } };
    });
    if (changed) changedEntries++;
  }
  // only entries that changed something count as reviewer work (a confirmed correct reading is one click, not an edit)
  return { members, entries: changedEntries + (sim.acceptCompleteness ? merged.completeness.filter(c => c.suggested.length).length : 0), touched };
}
const rv = reviewed();
const result = computeProject(merged.members, manifest.name, DEFAULT_MATERIAL_SPECS);
const report = compareTakeoffWithBoq(result, boq.structural_by_variant[variant]);
const suggested = merged.completeness.flatMap(c => c.suggested);
const report2 = suggested.length ? compareTakeoffWithBoq(computeProject([...merged.members, ...suggested], manifest.name), boq.structural_by_variant[variant]) : null;

console.log(`\n=== OFFLINE ${manifest.name} ===`);
console.log('vocab:', vocab.join(' '));
[...notes, ...merged.notes].forEach(n => console.log('note:', n));
console.log(`members ${merged.members.length}: auto ${result.autoReleaseCount} / review ${result.needsReviewCount} / rejected ${result.rejectedCount}`);
for (const r of report.rows) console.log(r.label.padEnd(26), String(r.system).padStart(10), String(r.boq ?? '-').padStart(8), String(r.pct ?? '-').padStart(8), r.verdict);
console.log(`mean |diff| headline: ${report.meanAbsPct}%` + (report2 ? ` | after completeness suggestions: ${report2.meanAbsPct}% (${report2.headline.map(h => `${h.label} ${h.pct}%`).join(', ')})` : ''));
let report3 = null as ReturnType<typeof compareTakeoffWithBoq> | null;
if (rv.entries) {
  report3 = compareTakeoffWithBoq(computeProject(rv.members, manifest.name), boq.structural_by_variant[variant]);
  console.log(`
after reviewer: ${rv.entries} edits (section table + accepted suggestions), applied to ${rv.touched} members`);
  for (const r of report3.rows) console.log('  ', r.label.padEnd(26), String(r.system).padStart(10), String(r.boq ?? '-').padStart(8), String(r.pct ?? '-').padStart(8), r.verdict);
  console.log(`   mean |diff| headline: ${report3.meanAbsPct}%`);
}
if (process.argv.includes('--items')) {
  for (const it of result.items) console.log(it.itemId, it.tag.padEnd(14), it.gridLocation.padEnd(12), it.level.slice(0, 12).padEnd(12), `${it.widthM}x${it.depthM}x${it.lengthNetM}`.padEnd(16), it.volumeNetM3, it.status, it.confidencePct, (it.flags || []).map(f => f.code).join(','));
}
fs.writeFileSync(path.join(dir, 'benchmark_offline.json'), JSON.stringify({ name: manifest.name, variant, engine: ocr.engine, generatedAt: new Date().toISOString(), report, reportWithSuggestions: report2, reportAfterReview: report3, reviewEdits: rv.entries, notes: [...notes, ...merged.notes] }, null, 2));
