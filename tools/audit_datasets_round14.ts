import fs from 'fs';
import path from 'path';

const datasetFiles = [
  'tools/benchmark/datasets/real_house1_benchmark.json',
  'tools/benchmark/datasets/real_house2_benchmark.json',
  'tools/benchmark/datasets/real_dot32_benchmark.json',
  'tools/benchmark/datasets/real_cdc1_benchmark.json',
];

console.log('=== TASK 5: BENCHMARK DATASET INTEGRITY AUDIT ===\n');

const memberIds = new Set<string>();
const uniqueGeometries = new Set<string>();
const uniqueRebarSpecs = new Set<string>();
let totalPhysicalInstances = 0;
let totalMemberGroups = 0;

const statusCounts: Record<string, number> = {
  VERIFIED: 0,
  ESTIMATED: 0,
  BOQ_REFERENCE: 0,
  INVALID: 0,
};

const perProjectStats: any[] = [];

for (const df of datasetFiles) {
  const ds = JSON.parse(fs.readFileSync(path.resolve(df), 'utf8'));
  let projInstances = 0;
  const projStatuses: Record<string, number> = { VERIFIED: 0, ESTIMATED: 0, BOQ_REFERENCE: 0, INVALID: 0 };

  for (const entry of ds.benchmarkEntries) {
    totalMemberGroups++;
    const count = entry.dimensions?.count || 1;
    totalPhysicalInstances += count;
    projInstances += count;

    // Check duplicate ID
    if (memberIds.has(entry.memberId)) {
      console.error(`❌ DUPLICATE MEMBER ID FOUND: ${entry.memberId}`);
    }
    memberIds.add(entry.memberId);

    // Track status
    const status = entry.groundTruthStatus || 'UNKNOWN';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    projStatuses[status] = (projStatuses[status] || 0) + 1;

    // Geometry signature
    const geoSig = `${entry.memberType}_${entry.dimensions.width}x${entry.dimensions.depth}x${entry.dimensions.length}`;
    uniqueGeometries.add(geoSig);

    // Rebar signature
    const rebarSig = `${entry.reinforcement?.topRebar || '-'}|${entry.reinforcement?.bottomRebar || '-'}|${entry.reinforcement?.stirrupRebar || '-'}`;
    uniqueRebarSpecs.add(rebarSig);

    // Verify drawing page presence
    if (!entry.drawingPage || entry.drawingPage <= 0) {
      console.error(`❌ MISSING DRAWING PAGE for ${entry.memberId}`);
    }
  }

  perProjectStats.push({
    projectId: ds.projectId,
    projectName: ds.projectName,
    drawingFile: ds.drawingFile,
    entriesCount: ds.benchmarkEntries.length,
    instancesCount: projInstances,
    statuses: projStatuses,
  });
}

console.log('--- DATASET BREAKDOWN BY PROJECT ---');
for (const p of perProjectStats) {
  console.log(`• ${p.projectId} (${p.projectName}):`);
  console.log(`  File: ${p.drawingFile}`);
  console.log(`  Groups: ${p.entriesCount} | Instances: ${p.instancesCount}`);
  console.log(`  Statuses: VERIFIED=${p.statuses.VERIFIED}, ESTIMATED=${p.statuses.ESTIMATED}, BOQ_REF=${p.statuses.BOQ_REFERENCE}, INVALID=${p.statuses.INVALID}`);
}

console.log('\n--- GLOBAL DATASET SUMMARY ---');
console.log(`Unique Projects: ${datasetFiles.length}`);
console.log(`Total Member Groups (Entries): ${totalMemberGroups}`);
console.log(`Total Physical Instances: ${totalPhysicalInstances}`);
console.log(`Unique Geometries (w x d x L): ${uniqueGeometries.size}`);
console.log(`Unique Rebar Specifications: ${uniqueRebarSpecs.size}`);
console.log('Status Breakdown across all 22 members:');
for (const [st, cnt] of Object.entries(statusCounts)) {
  console.log(`  - ${st}: ${cnt} (${((cnt / totalMemberGroups) * 100).toFixed(1)}%)`);
}

// Verify exclusion of INVALID from accuracy metrics in run_benchmark
import { executeBenchmark } from './benchmark/run_benchmark';
const cdc1Dataset = JSON.parse(fs.readFileSync(path.resolve('tools/benchmark/datasets/real_cdc1_benchmark.json'), 'utf8'));
const res = executeBenchmark(cdc1Dataset);

console.log('\n--- ACCURACY EXCLUSION VERIFICATION (CDC.1 with INVALID GB3) ---');
console.log(`CDC1 Total Members: ${res.metrics.totalMembers}`);
console.log(`CDC1 Evaluated Members (Valid): ${res.metrics.evaluatedMembers}`);
console.log(`CDC1 Verified Members: ${res.metrics.verifiedMembers}`);
console.log(`CDC1 Invalid Members Count: ${res.metrics.invalidMembers}`);
const gb3Result = res.memberEvaluations.find(r => r.memberId === 'CDC1-GB03');
console.log(`CDC1-GB03 GroundTruthStatus: ${gb3Result?.groundTruthStatus}`);
const diag = res.diagnostics.find(d => d.memberId === 'CDC1-GB03');
console.log(`CDC1-GB03 Diagnostics: ${diag?.diagnostics.map(d => d.errorType).join(', ')}`);

