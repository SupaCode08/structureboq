import { calculateMember, ExtractedMember, DEFAULT_MATERIAL_SPECS } from '../src/engine/qsEngine';

const testCases: { name: string; member: ExtractedMember; rules?: any }[] = [
  {
    name: 'Case 1: Slab Reinforcement (Two-way)',
    member: {
      tag: 'S1',
      memberType: 'SLAB',
      width: 4.0,
      depth: 3.0,
      length: 0.10,
      count: 1,
      bottomRebar: 'DB10@0.20m',
      coveringCm: 2.0
    }
  },
  {
    name: 'Case 2: Beam Reinforcement (Main + Stirrup)',
    member: {
      tag: 'B1',
      memberType: 'BEAM',
      width: 0.20,
      depth: 0.40,
      length: 4.0,
      count: 1,
      topRebar: '2-DB16',
      bottomRebar: '2-DB16',
      stirrupRebar: 'RB6@0.15m',
      coveringCm: 3.0
    }
  },
  {
    name: 'Case 3: Column Reinforcement (Main + Ties + Splice)',
    member: {
      tag: 'C1',
      memberType: 'COLUMN',
      width: 0.20,
      depth: 0.20,
      length: 3.5,
      count: 1,
      topRebar: '4-DB16',
      stirrupRebar: 'RB6@0.15m',
      coveringCm: 3.0
    }
  },
  {
    name: 'Case 4: Footing Reinforcement (Standard Hook)',
    member: {
      tag: 'F1_STD',
      memberType: 'FOOTING',
      width: 1.20,
      depth: 1.20,
      length: 0.35,
      count: 1,
      bottomRebar: 'DB12@0.15m',
      coveringCm: 5.0,
      footingHookShape: 'STANDARD_HOOK'
    }
  },
  {
    name: 'Case 5: Invalid Spacing (Zero Spacing)',
    member: {
      tag: 'B_INVALID',
      memberType: 'BEAM',
      width: 0.20,
      depth: 0.40,
      length: 4.0,
      count: 1,
      stirrupRebar: 'RB6@0',
      coveringCm: 3.0
    }
  },
  {
    name: 'Case 6: Unspecified Footing Hook',
    member: {
      tag: 'F1_UNSPEC',
      memberType: 'FOOTING',
      width: 1.20,
      depth: 1.20,
      length: 0.35,
      count: 1,
      bottomRebar: 'DB12@0.15m',
      coveringCm: 5.0,
      footingHookShape: 'UNSPECIFIED'
    }
  },
  {
    name: 'Case 7: Cover Conflict (Cover exceeds section)',
    member: {
      tag: 'B_COVER_CONFLICT',
      memberType: 'BEAM',
      width: 0.15,
      depth: 0.30,
      length: 3.0,
      count: 1,
      topRebar: '2-DB12',
      coveringCm: 8.0 // 2 * 8 = 16cm > 15cm width
    }
  },
  {
    name: 'Case 8a: Stock Length & Lap Comparison (Span 7.2m, 6m Stock)',
    member: {
      tag: 'S_STOCK_6M',
      memberType: 'SLAB',
      width: 7.0,
      depth: 4.0,
      length: 0.12,
      count: 1,
      bottomRebar: 'DB10@0.20m',
      coveringCm: 2.0
    },
    rules: { ...DEFAULT_MATERIAL_SPECS, stockBarLengthM: 6.0 }
  },
  {
    name: 'Case 8b: Stock Length & Lap Comparison (Span 7.2m, 10m Stock)',
    member: {
      tag: 'S_STOCK_10M',
      memberType: 'SLAB',
      width: 7.0,
      depth: 4.0,
      length: 0.12,
      count: 1,
      bottomRebar: 'DB10@0.20m',
      coveringCm: 2.0
    },
    rules: { ...DEFAULT_MATERIAL_SPECS, stockBarLengthM: 10.0 }
  }
];

for (const tc of testCases) {
  const res = calculateMember(tc.member, 1, tc.rules);
  console.log('=== ' + tc.name + ' ===');
  console.log('Status: ' + res.status);
  console.log('Confidence Basis: ' + res.confidenceBasis);
  console.log('Rebar Weight: ' + res.rebarWeightKg + ' kg');
  console.log('Formula: ' + res.rebarFormulaStr);
  console.log('Flags: ' + JSON.stringify(res.flags?.map(f => ({ code: f.code, severity: f.severity, msg: f.message }))));
  if (res.rebarDetails) {
    console.log('Traceability: Net=' + res.rebarDetails.netWeightKg + 'kg, Hook=' + res.rebarDetails.hookWeightKg + 'kg, Lap=' + res.rebarDetails.lapWeightKg + 'kg, Wastage=' + res.rebarDetails.wastageWeightKg + 'kg');
    for (const b of res.rebarDetails.barList) {
      console.log('  Bar: ' + b.bar + ' count=' + b.count + ' len=' + b.lengthM + 'm (net=' + b.netLengthM + ', hook=' + b.hookLengthM + ', lap=' + b.lapLengthM + ') purp=' + b.purpose);
    }
  }
  console.log('');
}
