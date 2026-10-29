import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDxf } from './dxfParser.ts';

test('DXF Parser: resolves beam length from LINE vector geometry on beam layer', () => {
  // DXF with a LINE from (0,0) to (4,0) on S-BEAM, and TEXT "B1 0.20x0.40" placed near it (2, 0.2)
  const dxf = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '6', // 6 = Meters
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    // Beam line: span 4.0 meters
    '0', 'LINE',
    '8', 'S-BEAM',
    '10', '0.0',
    '20', '0.0',
    '30', '0.0',
    '11', '4.0',
    '21', '0.0',
    '31', '0.0',
    // Text label without L= in string
    '0', 'TEXT',
    '8', 'S-BEAM',
    '10', '2.0',
    '20', '0.2',
    '1', 'B1 0.20x0.40',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');

  const result = parseDxf(dxf, 'beam_line.dxf');
  assert.equal(result.unit, 'm');
  assert.equal(result.members.length, 1);
  const m = result.members[0];
  assert.equal(m.tag, 'B1');
  assert.equal(m.width, 0.20);
  assert.equal(m.depth, 0.40);
  assert.equal(m.length, 4.00, 'Length should be calculated from LINE vector geometry');
  assert.notEqual(m.provenance?.fieldSources.length, 'missing');
});

test('DXF Parser: resolves beam length from LWPOLYLINE geometry', () => {
  // DXF with LWPOLYLINE from (0,0) to (5,0)
  const dxf = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '6',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'LWPOLYLINE',
    '8', 'S-BEAM',
    '90', '2', // 2 vertices
    '70', '0',
    '10', '0.0',
    '20', '0.0',
    '10', '5.0',
    '20', '0.0',
    '0', 'TEXT',
    '8', 'S-BEAM',
    '10', '2.5',
    '20', '0.3',
    '1', 'B2 0.25x0.50',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');

  const result = parseDxf(dxf, 'beam_polyline.dxf');
  assert.equal(result.members.length, 1);
  const m = result.members[0];
  assert.equal(m.tag, 'B2');
  assert.equal(m.length, 5.00, 'Length should be calculated from LWPOLYLINE geometry');
});

test('DXF Parser: associates DIMENSION measurement with adjacent beam', () => {
  const dxf = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '6',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'DIMENSION',
    '8', 'S-DIM',
    '10', '3.0',
    '20', '-0.5',
    '42', '6.00', // Measurement value = 6.00m
    '0', 'TEXT',
    '8', 'S-BEAM',
    '10', '3.0',
    '20', '0.0',
    '1', 'B3 0.20x0.45',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');

  const result = parseDxf(dxf, 'beam_dim.dxf');
  assert.equal(result.members.length, 1);
  const m = result.members[0];
  assert.equal(m.tag, 'B3');
  assert.equal(m.length, 6.00, 'Length should be derived from DIMENSION code 42');
});

test('DXF Parser: counts column INSERT blocks placed across drawing', () => {
  const dxf = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '6',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    // 4 Column block inserts
    '0', 'INSERT', '2', 'C1', '8', 'S-COLS', '10', '0.0', '20', '0.0',
    '0', 'INSERT', '2', 'C1', '8', 'S-COLS', '10', '4.0', '20', '0.0',
    '0', 'INSERT', '2', 'C1', '8', 'S-COLS', '10', '0.0', '20', '4.0',
    '0', 'INSERT', '2', 'C1', '8', 'S-COLS', '10', '4.0', '20', '4.0',
    // Column spec text
    '0', 'TEXT', '8', 'S-COLS', '10', '10.0', '20', '10.0', '1', 'C1 0.20x0.20 H=3.00m',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');

  const result = parseDxf(dxf, 'columns.dxf');
  assert.equal(result.members.length, 1);
  const m = result.members[0];
  assert.equal(m.tag, 'C1');
  assert.equal(m.memberType, 'COLUMN');
  assert.equal(m.count, 4, 'Should count 4 INSERT instances for C1');
});

test('DXF Parser: leaves span missing when no geometry matches text label', () => {
  const dxf = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$INSUNITS',
    '70', '6',
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'TEXT',
    '8', 'S-BEAM',
    '10', '100.0',
    '20', '100.0',
    '1', 'B99 0.20x0.40',
    '0', 'ENDSEC',
    '0', 'EOF'
  ].join('\n');

  const result = parseDxf(dxf, 'no_geom.dxf');
  assert.equal(result.members.length, 1);
  const m = result.members[0];
  assert.equal(m.length, 0);
  assert.equal(m.provenance?.fieldSources.length, 'missing');
});
