import fs from 'fs';
import { parseDxf } from '../src/pdf/dxfParser.ts';

const content = fs.readFileSync('public/samples/villa_framing.dxf', 'utf8');
const res = parseDxf(content, 'villa_framing.dxf');
console.log('DXF members count:', res.members.length);
for (const m of res.members) {
  console.log(`  Tag: ${m.tag} Type: ${m.memberType} Size: ${m.width}x${m.depth} Length: ${m.length} (fieldSources: ${JSON.stringify(m.provenance?.fieldSources)})`);
}
