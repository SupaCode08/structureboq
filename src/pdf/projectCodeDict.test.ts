import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTagPrefix,
  extractProjectCodeDictionary,
  applyProjectCodeOverride,
} from './projectCodeDict.ts';
import type { PageOcr } from './types.ts';
import type { ExtractedMember } from '../engine/qsEngine.ts';

test('extractTagPrefix handles English, Thai, and dimensioned footing tags', () => {
  assert.equal(extractTagPrefix('GB2A'), 'GB');
  assert.equal(extractTagPrefix('F(0.90x0.90)'), 'F');
  assert.equal(extractTagPrefix('ค.1'), 'ค');
  assert.equal(extractTagPrefix('ส.2'), 'ส');
  assert.equal(extractTagPrefix('ST1'), 'ST');
});

test('extractProjectCodeDictionary reads symbol legends, sheet index, and active members', () => {
  const pages: PageOcr[] = [
    {
      page: 1,
      width: 1000,
      height: 700,
      words: [
        { text: 'S-01', x0: 0.1, y0: 0.1, x1: 0.15, y1: 0.12, vertical: false, conf: 95 },
        { text: 'ผังฐานรากและตอม่อ', x0: 0.2, y0: 0.1, x1: 0.45, y1: 0.12, vertical: false, conf: 95 },
        { text: 'PB', x0: 0.1, y0: 0.2, x1: 0.14, y1: 0.22, vertical: false, conf: 95 },
        { text: '=', x0: 0.15, y0: 0.2, x1: 0.16, y1: 0.22, vertical: false, conf: 95 },
        { text: 'คานรับพื้นชั้นลอย', x0: 0.18, y0: 0.2, x1: 0.4, y1: 0.22, vertical: false, conf: 95 },
        { text: 'ค.1', x0: 0.1, y0: 0.3, x1: 0.14, y1: 0.32, vertical: false, conf: 95 },
        { text: ':', x0: 0.15, y0: 0.3, x1: 0.16, y1: 0.32, vertical: false, conf: 95 },
        { text: 'คาน ค.ส.ล. ชั้น 1', x0: 0.18, y0: 0.3, x1: 0.4, y1: 0.32, vertical: false, conf: 95 },
      ],
    },
  ];
  const members: ExtractedMember[] = [
    { tag: 'PB1', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 4.0, count: 2 },
    { tag: 'XZ1', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 3.0, count: 1 },
  ];

  const dict = extractProjectCodeDictionary(pages, members);
  assert.equal(dict.sheetCodes.length, 1);
  assert.equal(dict.sheetCodes[0].code, 'S-01');
  assert.equal(dict.sheetCodes[0].discipline, 'STRUCTURAL');

  const pb = dict.memberCodes.find(c => c.prefix === 'PB');
  assert.ok(pb);
  assert.equal(pb.source, 'legend');
  assert.equal(pb.memberType, 'BEAM');
  assert.equal(pb.count, 2);

  const xz = dict.memberCodes.find(c => c.prefix === 'XZ');
  assert.ok(xz);
  assert.equal(xz.confidence, 'low');
});

test('applyProjectCodeOverride remaps matching prefix and skips steel codes', () => {
  const members: ExtractedMember[] = [
    { tag: 'PS1', memberType: 'BEAM', width: 2, depth: 3, length: 0.1 },
    { tag: 'BS1', memberType: 'BEAM', width: 0.15, depth: 0.3, length: 4 },
    { tag: 'GB1', memberType: 'BEAM', width: 0.2, depth: 0.4, length: 4 },
  ];
  const slabPatch = applyProjectCodeOverride(members, 'PS', 'SLAB', 'Aoo');
  assert.equal(slabPatch.length, 1);
  assert.equal(slabPatch[0].index, 0);
  assert.equal(slabPatch[0].patch.memberType, 'SLAB');
  assert.equal(slabPatch[0].patch.slabType, 'PRECAST_PLANK');

  const skipPatch = applyProjectCodeOverride(members, 'BS', 'STEEL_SKIP', 'Aoo');
  assert.equal(skipPatch.length, 1);
  assert.equal(skipPatch[0].index, 1);
  assert.equal(skipPatch[0].patch.review?.status, 'rejected');
});
