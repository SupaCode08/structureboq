/**
 * Member schedule rows from digital PDF text ("B1 | 0.20 x 0.40 m | 4.00 m | 4 | 2-DB16 ...").
 * Each value carries its provenance.
 */
import type { ExtractedMember, FieldSource, MemberType } from '../engine/qsEngine';
import type { PageText } from './types';
import { textLines } from './pdfText';

const TAG_RE = '(?:GB|RB|TB|TG|WB|SB|BST|B|FC|RC|SC|C|F|ST|D|W|WN|FL|WALL|col|beam|door|window|คาน|เสา|ฐานราก|ประตู|หน้าต่าง|ผนัง|ผิวพื้น)[\\s-]*\\d+[A-Za-z]?';
const ROW = new RegExp(
  '(?:^|(?<=\\s))(?:(?<count>\\d+)\\s*[-_]\\s*)?(?<tag>' + TAG_RE + ')' +
  '[\\s|,\\t:()]+' +
  '(?<w>\\d+(?:\\.\\d+)?)\\s*[xX*×]\\s*(?<d>\\d+(?:\\.\\d+)?)' +
  '(?:\\s*[xX*×]\\s*(?<t>\\d+(?:\\.\\d+)?))?' +
  '(?:\\s*(?<unit>mm|cm|m|มม\\.?|ซม\\.?|ม\\.)(?![a-zA-Z]))?' +
  '\\)?' +
  '(?:[\\s|,\\t]+(?:[lLhH]\\s*[=:]?\\s*)?(?<len>\\d+(?:\\.\\d+)?)(?!\\s*[-–+]\\s*(?:DB|RB|Ø|ø)|\\d)(?:\\s*(?:m|cm|mm|ม\\.))?)?' +
  '(?:[\\s|,\\t]+(?:qty|จำนวน|count)?[:\\s]*(?<count2>\\d+)(?!\\.\\d|\\s*[xX×-]))?',
  'i',
);
const REBAR = /\b(\d+)\s*[- ]?\s*(DB|RB|Ø|ø)\s*(\d{1,2})\b/gi;
const STIRRUP = /\b((?:RB|DB|Ø|ø)\s*\d{1,2}\s*(?:มม\.?)?\s*@\s*\d+(?:\.\d+)?\s*(?:m|cm|mm|ม\.)?)/i;
const UNIT: Record<string, string> = { 'มม': 'mm', 'มม.': 'mm', 'ซม': 'cm', 'ซม.': 'cm', 'ม.': 'm' };

export function memberTypeForTag(tag: string): MemberType {
  const t = tag.toUpperCase();
  if (t.startsWith('ฐานราก') || /^F\d/.test(t)) return 'FOOTING';
  if (t.startsWith('ST')) return 'STAIR';
  if (/^(C|FC|RC|SC|COL)/.test(t) || t.startsWith('เสา')) return 'COLUMN';
  if (/^(D|ด)/.test(t) || t.startsWith('ประตู')) return 'DOOR';
  if (/^(W\d|WN|น)/.test(t) || t.startsWith('หน้าต่าง')) return 'WINDOW';
  if (/^(WALL|ผ)/.test(t) || t.startsWith('ผนัง')) return 'WALL';
  if (/^(FL|FINISH)/.test(t) || t.startsWith('ผิวพื้น')) return 'FINISH';
  return 'BEAM';
}

export interface ParsedRow {
  tag: string; memberType: MemberType; width: number; depth: number; thickness: number | null; length: number | null;
  count: number; unit: string | null; topRebar: string; bottomRebar: string; stirrupRebar: string;
  found: Record<string, boolean>;
}

export function parseScheduleLine(line: string): ParsedRow | null {
  const m = ROW.exec(line);
  if (!m?.groups) return null;
  const g = m.groups;
  const tag = g.tag.toUpperCase().replace(/[\s-]/g, '');
  const unitRaw = g.unit;
  const unit = unitRaw ? (UNIT[unitRaw] || unitRaw.toLowerCase()) : null;
  const bars = [...line.matchAll(REBAR)].map(r => `${r[1]}-${r[2].toUpperCase() === 'RB' ? 'RB' : 'DB'}${r[3]}`);
  const st = line.match(STIRRUP);
  const count = g.count ? Number(g.count) : g.count2 ? Number(g.count2) : 1;
  return {
    tag, memberType: memberTypeForTag(tag), width: Number(g.w), depth: Number(g.d),
    thickness: g.t ? Number(g.t) : null, length: g.len ? Number(g.len) : null, count, unit,
    topRebar: bars[0] || '', bottomRebar: bars[1] || bars[0] || '', stirrupRebar: st ? st[1].replace(/\s/g, '').toUpperCase() : '',
    found: { tag: true, width: true, depth: true, length: !!g.len, count: !!(g.count || g.count2), rebar: bars.length > 0, stirrup: !!st, unit: !!unit },
  };
}

export function scheduleMembersFromPage(pt: PageText, fileName: string): ExtractedMember[] {
  const out: ExtractedMember[] = [];
  for (const { text, bbox, nb } of textLines(pt)) {
    const p = parseScheduleLine(text);
    if (!p) continue;
    const fs: Record<string, FieldSource> = {};
    for (const [k, v] of Object.entries(p.found)) fs[k] = v ? 'drawing' : 'missing';
    if (p.memberType === 'BEAM') fs.support = 'missing';
    out.push({
      tag: p.tag, memberType: p.memberType, width: p.width, depth: p.depth, length: p.length ?? 0, count: p.count,
      unit: p.unit || 'm', gridLocation: `Sheet-P${pt.page}`, level: 'Story 1', sourceFile: fileName,
      sourceSheetOrLayer: `Page ${pt.page}`, rawDimensionStr: text, topRebar: p.topRebar, bottomRebar: p.bottomRebar,
      stirrupRebar: p.stirrupRebar, thickness: p.thickness ?? 0, supportColW1: 0, supportColW2: 0,
      provenance: {
        evidence: [{ page: pt.page, bboxNorm: nb ?? [bbox[0] / pt.width, bbox[1] / pt.height, bbox[2] / pt.width, bbox[3] / pt.height], label: `บรรทัดในตาราง (หน้า ${pt.page})`, text, method: 'pdf_text' }],
        fieldSources: fs,
        confidence: Number((0.55 + 0.15 * +p.found.length + 0.1 * +p.found.count + 0.1 * +p.found.rebar + 0.1 * +p.found.unit).toFixed(2)),
        conflicts: [],
      },
    });
  }
  return out;
}
