import { calculateMember, computeProject, DEFAULT_MATERIAL_SPECS, ExtractedMember } from '../src/engine/qsEngine';
import fs from 'fs';
import path from 'path';

const datasetFiles = [
  'tools/benchmark/datasets/real_house1_benchmark.json',
  'tools/benchmark/datasets/real_house2_benchmark.json',
  'tools/benchmark/datasets/real_dot32_benchmark.json',
  'tools/benchmark/datasets/real_cdc1_benchmark.json',
];

console.log('=== TASK 2: PRODUCTION VS BENCHMARK PARITY AUDIT (ALL 22 MEMBERS) ===\n');

let totalMembers = 0;
let differencesFound = 0;

for (const df of datasetFiles) {
  const ds = JSON.parse(fs.readFileSync(path.resolve(df), 'utf8'));
  console.log(`Auditing Dataset: ${ds.datasetId} (${ds.projectName})`);

  for (const entry of ds.benchmarkEntries) {
    totalMembers++;
    const memberBench: ExtractedMember = {
      tag: entry.tag,
      memberType: entry.memberType,
      width: entry.dimensions.width,
      depth: entry.dimensions.depth,
      length: entry.dimensions.length,
      count: entry.dimensions.count || 1,
      unit: entry.dimensions.unit || 'm',
      topRebar: entry.reinforcement?.topRebar,
      bottomRebar: entry.reinforcement?.bottomRebar,
      stirrupRebar: entry.reinforcement?.stirrupRebar,
      stirrupSets: entry.reinforcement?.stirrupSets,
      coveringCm: entry.engineeringAssumptions?.coverCm,
      footingHookShape: entry.engineeringAssumptions?.footingHookShape,
      sourceFile: ds.drawingFile,
      sourceSheetOrLayer: `Page ${entry.drawingPage}`,
    };

    // Path A: Production computeProject
    const projRes = computeProject([memberBench], 'ParityTest', DEFAULT_MATERIAL_SPECS);
    const calcA = projRes.items[0];

    // Path B: Direct calculateMember (Benchmark runner)
    const calcB = calculateMember(memberBench, 1, DEFAULT_MATERIAL_SPECS);

    // Compare all fields
    const diffs: string[] = [];
    if (calcA.status !== calcB.status) diffs.push(`status: A=${calcA.status} vs B=${calcB.status}`);
    if (calcA.volumeNetM3 !== calcB.volumeNetM3) diffs.push(`volumeNetM3: A=${calcA.volumeNetM3} vs B=${calcB.volumeNetM3}`);
    if (calcA.formworkNetM2 !== calcB.formworkNetM2) diffs.push(`formworkNetM2: A=${calcA.formworkNetM2} vs B=${calcB.formworkNetM2}`);
    if (calcA.rebarWeightKg !== calcB.rebarWeightKg) diffs.push(`rebarWeightKg: A=${calcA.rebarWeightKg} vs B=${calcB.rebarWeightKg}`);
    if (calcA.confidencePct !== calcB.confidencePct) diffs.push(`confidencePct: A=${calcA.confidencePct} vs B=${calcB.confidencePct}`);
    if (calcA.provenanceLevel !== calcB.provenanceLevel) diffs.push(`provenanceLevel: A=${calcA.provenanceLevel} vs B=${calcB.provenanceLevel}`);
    if ((calcA.flags?.length || 0) !== (calcB.flags?.length || 0)) diffs.push(`flags count: A=${calcA.flags?.length} vs B=${calcB.flags?.length}`);

    if (diffs.length > 0) {
      differencesFound++;
      console.log(`  ❌ Parity mismatch for ${entry.memberId} (${entry.tag}):`, diffs.join(', '));
    } else {
      console.log(`  ✅ Parity match for ${entry.memberId} (${entry.tag}): Status=${calcA.status}, Vol=${calcA.volumeNetM3}, Form=${calcA.formworkNetM2}, Rebar=${calcA.rebarWeightKg}, Conf=${calcA.confidencePct}%`);
    }
  }
}

console.log(`\nAudited ${totalMembers} members across 4 datasets.`);
console.log(`Total parity discrepancies found: ${differencesFound}`);
