import fs from 'fs';
import path from 'path';
import { executeBenchmark, BenchmarkDataset } from './run_benchmark';
import { aggregateEvaluationResults, MemberEvaluationResult } from './metrics';

const benchmarkDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const datasetFiles = [
  path.join(benchmarkDir, 'datasets', 'real_house1_benchmark.json'),
  path.join(benchmarkDir, 'datasets', 'real_house2_benchmark.json'),
  path.join(benchmarkDir, 'datasets', 'real_dot32_benchmark.json'),
  path.join(benchmarkDir, 'datasets', 'real_cdc1_benchmark.json')
];

const allEvaluations: MemberEvaluationResult[] = [];
const entryMeta: Record<string, { projectId: string; count: number; referenceSource: string }> = {};
let totalTimeMs = 0;

for (const f of datasetFiles) {
  const ds: BenchmarkDataset = JSON.parse(fs.readFileSync(f, 'utf-8'));
  for (const e of ds.benchmarkEntries) {
    entryMeta[e.memberId] = {
      projectId: ds.projectId,
      count: e.dimensions.count || 1,
      referenceSource: e.referenceSource,
    };
  }
  const res = executeBenchmark(ds);
  totalTimeMs += res.metrics.processingTimeMs;
  for (const ev of res.memberEvaluations) {
    allEvaluations.push(ev);
  }
}

const agg = aggregateEvaluationResults(allEvaluations, totalTimeMs);
console.log('=== CONSOLIDATED 4-PROJECT BENCHMARK METRICS ===');
console.log('Total Members:', agg.totalMembers, '| Evaluated (Valid):', agg.evaluatedMembers, '| Verified:', agg.verifiedMembers, '| Invalid:', agg.invalidMembers);
console.log('Needs Review Rate:', agg.needsReviewRatePct + '% (' + agg.needsReviewCount + '/' + agg.totalMembers + ')');
console.log('False Release Count:', agg.falseReleaseCount, '(' + agg.falseReleaseRatePct + '% of Auto Releases)');
console.log('Processing Time:', agg.processingTimeMs.toFixed(2), 'ms (' + agg.avgProcessingTimePerMemberMs + ' ms/member)');
console.log('\n--- BY COMPONENT (ALL VALID RECORDS, n=' + agg.evaluatedMembers + ') ---');
console.log('Concrete:   MSE=' + agg.byComponent.concrete.meanSignedError + ' m3 | MdAPE=' + agg.byComponent.concrete.medianAbsPercentageError + '% | P90=' + agg.byComponent.concrete.p90AbsPercentageError + '% | Max=' + agg.byComponent.concrete.maxAbsPercentageError + '%');
console.log('Formwork:   MSE=' + agg.byComponent.formwork.meanSignedError + ' m2 | MdAPE=' + agg.byComponent.formwork.medianAbsPercentageError + '% | P90=' + agg.byComponent.formwork.p90AbsPercentageError + '% | Max=' + agg.byComponent.formwork.maxAbsPercentageError + '%');
console.log('Rebar:      MSE=' + agg.byComponent.rebar.meanSignedError + ' kg | MdAPE=' + agg.byComponent.rebar.medianAbsPercentageError + '% | P90=' + agg.byComponent.rebar.p90AbsPercentageError + '% | Max=' + agg.byComponent.rebar.maxAbsPercentageError + '%');

console.log('\n--- BY COMPONENT (VERIFIED ONLY, n=' + agg.verifiedMembers + ') ---');
console.log('Concrete:   MSE=' + agg.verifiedOnlyByComponent.concrete.meanSignedError + ' m3 | MdAPE=' + agg.verifiedOnlyByComponent.concrete.medianAbsPercentageError + '% | P90=' + agg.verifiedOnlyByComponent.concrete.p90AbsPercentageError + '% | Max=' + agg.verifiedOnlyByComponent.concrete.maxAbsPercentageError + '%');
console.log('Formwork:   MSE=' + agg.verifiedOnlyByComponent.formwork.meanSignedError + ' m2 | MdAPE=' + agg.verifiedOnlyByComponent.formwork.medianAbsPercentageError + '% | P90=' + agg.verifiedOnlyByComponent.formwork.p90AbsPercentageError + '% | Max=' + agg.verifiedOnlyByComponent.formwork.maxAbsPercentageError + '%');
console.log('Rebar:      MSE=' + agg.verifiedOnlyByComponent.rebar.meanSignedError + ' kg | MdAPE=' + agg.verifiedOnlyByComponent.rebar.medianAbsPercentageError + '% | P90=' + agg.verifiedOnlyByComponent.rebar.p90AbsPercentageError + '% | Max=' + agg.verifiedOnlyByComponent.rebar.maxAbsPercentageError + '%');

console.log('\n--- BY MEMBER TYPE ---');
for (const [mType, data] of Object.entries(agg.byMemberType)) {
  const d: any = data;
  console.log(mType + ' (n=' + d.memberCount + '):');
  console.log('  Concrete MdAPE=' + d.concrete.medianAbsPercentageError + '% | Formwork MdAPE=' + d.formwork.medianAbsPercentageError + '% | Rebar MdAPE=' + d.rebar.medianAbsPercentageError + '% | FalseReleases=' + d.falseReleaseCount + ' | ReviewRate=' + ((d.needsReviewCount / d.memberCount)*100).toFixed(1) + '%');
}

console.log('\n--- PER-MEMBER SUMMARY (ALL 22 MEMBERS) ---');
for (const ev of allEvaluations) {
  const m = entryMeta[ev.memberId];
  const conc = ev.components.concrete;
  const form = ev.components.formwork;
  const rebar = ev.components.rebar;
  const flagsStr = ev.flags.map(f => `${f.code}(${f.severity})`).join(', ') || 'NONE';
  console.log(`[${m.projectId} | ${ev.memberId}] ${ev.tag.padEnd(10)} (${ev.memberType.padEnd(7)}, n=${m.count}, GT=${ev.groundTruthStatus}): Conc=${conc.systemVal}/${conc.refVal}m3 (abs=${conc.absError}, rel=${conc.relErrorPct}%), Form=${form.systemVal}/${form.refVal}m2 (abs=${form.absError}, rel=${form.relErrorPct}%), Rebar=${rebar.systemVal}/${rebar.refVal}kg (abs=${rebar.absError}, rel=${rebar.relErrorPct}%), Status=${ev.systemStatus}, Flags=[${flagsStr}], Errors=[${ev.errorLabels.join(',')}], FR=${ev.isFalseRelease}`);
}
