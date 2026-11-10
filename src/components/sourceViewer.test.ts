import test from 'node:test';
import assert from 'node:assert/strict';
import { boxLabel } from './SourceViewer.tsx';

test('boxLabel extracts member name or keeps whole text as appropriate', () => {
  assert.equal(boxLabel(undefined), undefined);
  assert.equal(boxLabel('F0.50X0.50 0.50 0.10 B12-DB16'), 'F0.50X0.50');
  assert.equal(boxLabel('C1'), 'C1');
  assert.equal(boxLabel('B12-DB16 @ 0.20'), 'B12-DB16 @ 0.20');
});
