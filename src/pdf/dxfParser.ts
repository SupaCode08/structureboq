/**
 * StructBOQ - DXF reader for the browser with Vector Geometry Support.
 * Parses TEXT, MTEXT, LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, INSERT, DIMENSION, and HATCH.
 * Resolves beam lengths from vector geometry (LINE / LWPOLYLINE / DIMENSION)
 * and column counts from block INSERT instances when not explicitly typed in text.
 * Spans that have neither written dimensions nor nearby geometric entities are left missing for reviewer.
 */
import type { ExtractedMember, FieldSource } from '../engine/qsEngine';

const TAG_DIM = /(?<count>\d+)?[-_ ]*(?<tag>(?:RB|GB|TB|TG|WB|SB|B|FC|RC|SC|C|col|beam|คาน|เสา)[\s-]*\d+[A-Za-z]?)[\s:(\[]*(?<w>\d+(?:\.\d+)?)\s*[xX*×]\s*(?<d>\d+(?:\.\d+)?)(?:\s*(?<unit>mm|cm|m))?(?:[^\d]*(?:[lLhH]=?|[lLhH]:\s*)(?<len>\d+(?:\.\d+)?))?/i;
const UNITS: Record<number, string> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

interface DxfText {
  text: string;
  layer: string;
  x: number;
  y: number;
  height: number;
}

interface DxfLine {
  layer: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
  midX: number;
  midY: number;
}

interface DxfPolyline {
  layer: string;
  vertices: { x: number; y: number }[];
  isClosed: boolean;
  length: number;
}

interface DxfDimension {
  layer: string;
  text: string;
  measurement: number;
  x: number;
  y: number;
}

interface DxfInsert {
  layer: string;
  name: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

interface DxfCircle {
  layer: string;
  cx: number;
  cy: number;
  radius: number;
}

interface DxfHatch {
  layer: string;
  pattern: string;
  points: { x: number; y: number }[];
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): { dist: number; t: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) {
    return { dist: Math.hypot(px - x1, py - y1), t: 0 };
  }
  const t = ((px - x1) * dx + (py - y1) * dy) / l2;
  const tClamped = Math.max(0, Math.min(1, t));
  const projX = x1 + tClamped * dx;
  const projY = y1 + tClamped * dy;
  return { dist: Math.hypot(px - projX, py - projY), t };
}

export function parseDxf(content: string, fileName: string) {
  const lines = content.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([Number(lines[i].trim()), lines[i + 1].trimEnd()]);
  }

  let insunits = 0;
  const texts: DxfText[] = [];
  const dxfLines: DxfLine[] = [];
  const polylines: DxfPolyline[] = [];
  const dimensions: DxfDimension[] = [];
  const inserts: DxfInsert[] = [];
  const circles: DxfCircle[] = [];
  const hatches: DxfHatch[] = [];
  const layers = new Set<string>();

  let section = '';
  let curType = '';
  let curLayer = '0';
  let curText = '';
  let curX = 0;
  let curY = 0;
  let curX2 = 0;
  let curY2 = 0;
  let curHeight = 0;
  let curRadius = 0;
  let curBlockName = '';
  let curScaleX = 1;
  let curScaleY = 1;
  let curRotation = 0;
  let curMeasurement = 0;
  let curFlags = 0;
  let curVertices: { x: number; y: number }[] = [];
  let curPendingVertex: { x?: number; y?: number } = {};

  const flush = () => {
    if (!curType) return;
    if (curLayer) layers.add(curLayer);

    if (curType === 'TEXT' || curType === 'MTEXT') {
      if (curText) {
        const text = curType === 'MTEXT'
          ? curText.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '')
          : curText;
        texts.push({ text: text.trim(), layer: curLayer, x: curX, y: curY, height: curHeight });
      }
    } else if (curType === 'LINE') {
      const length = Math.hypot(curX2 - curX, curY2 - curY);
      if (length > 0) {
        dxfLines.push({
          layer: curLayer,
          x1: curX, y1: curY,
          x2: curX2, y2: curY2,
          length,
          midX: (curX + curX2) / 2,
          midY: (curY + curY2) / 2,
        });
      }
    } else if (curType === 'LWPOLYLINE' || curType === 'POLYLINE') {
      if (curPendingVertex.x !== undefined && curPendingVertex.y !== undefined) {
        curVertices.push({ x: curPendingVertex.x, y: curPendingVertex.y });
        curPendingVertex = {};
      }
      if (curVertices.length >= 2) {
        let totalLen = 0;
        for (let i = 0; i + 1 < curVertices.length; i++) {
          totalLen += Math.hypot(curVertices[i + 1].x - curVertices[i].x, curVertices[i + 1].y - curVertices[i].y);
        }
        if ((curFlags & 1) === 1 && curVertices.length > 2) {
          totalLen += Math.hypot(curVertices[0].x - curVertices[curVertices.length - 1].x, curVertices[0].y - curVertices[curVertices.length - 1].y);
        }
        polylines.push({
          layer: curLayer,
          vertices: [...curVertices],
          isClosed: (curFlags & 1) === 1,
          length: totalLen,
        });
      }
    } else if (curType === 'DIMENSION') {
      dimensions.push({
        layer: curLayer,
        text: curText.trim(),
        measurement: curMeasurement,
        x: curX,
        y: curY,
      });
    } else if (curType === 'INSERT') {
      inserts.push({
        layer: curLayer,
        name: curBlockName,
        x: curX,
        y: curY,
        scaleX: curScaleX,
        scaleY: curScaleY,
        rotation: curRotation,
      });
    } else if (curType === 'CIRCLE' || curType === 'ARC') {
      if (curRadius > 0) {
        circles.push({ layer: curLayer, cx: curX, cy: curY, radius: curRadius });
      }
    } else if (curType === 'HATCH') {
      hatches.push({ layer: curLayer, pattern: curBlockName, points: [...curVertices] });
    }

    curType = '';
    curLayer = '0';
    curText = '';
    curX = 0;
    curY = 0;
    curX2 = 0;
    curY2 = 0;
    curHeight = 0;
    curRadius = 0;
    curBlockName = '';
    curScaleX = 1;
    curScaleY = 1;
    curRotation = 0;
    curMeasurement = 0;
    curFlags = 0;
    curVertices = [];
    curPendingVertex = {};
  };

  for (let i = 0; i < pairs.length; i++) {
    const [code, val] = pairs[i];
    if (code === 2 && pairs[i - 1]?.[1] === 'SECTION') section = val;
    if (section === 'HEADER' && code === 9 && val === '$INSUNITS') {
      const nx = pairs[i + 1];
      if (nx && nx[0] === 70) insunits = Number(nx[1]);
    }
    if (section !== 'ENTITIES') continue;

    if (code === 0) {
      flush();
      curType = val;
      continue;
    }
    if (!curType) continue;

    if (code === 8) {
      curLayer = val;
    } else if (code === 10) {
      if (curType === 'LWPOLYLINE') {
        if (curPendingVertex.x !== undefined && curPendingVertex.y !== undefined) {
          curVertices.push({ x: curPendingVertex.x, y: curPendingVertex.y });
          curPendingVertex = {};
        }
        curPendingVertex.x = Number(val);
      } else {
        curX = Number(val);
      }
    } else if (code === 20) {
      if (curType === 'LWPOLYLINE') {
        curPendingVertex.y = Number(val);
      } else {
        curY = Number(val);
      }
    } else if (code === 11) {
      curX2 = Number(val);
    } else if (code === 21) {
      curY2 = Number(val);
    } else if (code === 1 || code === 3) {
      curText += val;
    } else if (code === 2) {
      curBlockName = val;
    } else if (code === 40) {
      curHeight = Number(val);
      curRadius = Number(val);
    } else if (code === 41) {
      curScaleX = Number(val);
    } else if (code === 42) {
      curScaleY = Number(val);
      curMeasurement = Number(val);
    } else if (code === 50) {
      curRotation = Number(val);
    } else if (code === 70) {
      curFlags = Number(val);
    }
  }
  flush();

  const unit = UNITS[insunits] || 'm';
  const warnings: string[] = [];
  if (!insunits) warnings.push('ไฟล์ DXF ไม่ระบุหน่วย ($INSUNITS = 0) — ใช้หน่วยเมตร/มิลลิเมตรตามขนาดตัวเลข');

  const members: ExtractedMember[] = [];
  const usedLines = new Set<DxfLine>();

  for (const t of texts) {
    const m = TAG_DIM.exec(t.text);
    if (!m?.groups) continue;
    const g = m.groups;
    const tag = g.tag.toUpperCase().replace(/\s/g, '');
    const isCol = /^(C|FC|RC|SC)/.test(tag) || tag.includes('COL') || tag.includes('เสา') || /COL/i.test(t.layer);
    const supW = unit === 'mm' ? 0.4 : 0.25;

    let resolvedLen = g.len ? Number(g.len) : 0;
    let lenSource: FieldSource = g.len ? 'drawing' : 'missing';
    let geomEvidence = '';

    // If beam length is not in text, search nearby vector geometry (LINE, LWPOLYLINE, DIMENSION)
    if (!isCol && resolvedLen === 0) {
      // 1. Search matching LINE entities
      let bestLine: DxfLine | null = null;
      let minLineDist = Infinity;

      for (const line of dxfLines) {
        // Priority for lines on same layer or beam layer
        const layerMatch = line.layer.toLowerCase() === t.layer.toLowerCase() ||
                           /BEAM|คาน|STRUCTURE|FRAME|S-/i.test(line.layer);
        const { dist, t: projT } = distToSegment(t.x, t.y, line.x1, line.y1, line.x2, line.y2);

        // Text should be positioned along or near the line segment
        const maxDist = layerMatch ? 3.0 : 1.5;
        if (projT >= -0.2 && projT <= 1.2 && dist < maxDist) {
          const score = dist - (layerMatch ? 1.0 : 0);
          if (score < minLineDist) {
            minLineDist = score;
            bestLine = line;
          }
        }
      }

      if (bestLine) {
        resolvedLen = Math.round(bestLine.length * 1000) / 1000;
        lenSource = 'drawing';
        usedLines.add(bestLine);
        geomEvidence = `เส้น LINE ใน CAD (${bestLine.layer}) ยาว ${resolvedLen.toFixed(2)}${unit} จาก (${bestLine.x1.toFixed(2)},${bestLine.y1.toFixed(2)}) ถึง (${bestLine.x2.toFixed(2)},${bestLine.y2.toFixed(2)})`;
      }

      // 2. Search LWPOLYLINE if no LINE matched
      if (resolvedLen === 0) {
        let bestPoly: DxfPolyline | null = null;
        let minPolyDist = Infinity;

        for (const poly of polylines) {
          const layerMatch = poly.layer.toLowerCase() === t.layer.toLowerCase() || /BEAM|คาน/i.test(poly.layer);
          for (let vi = 0; vi + 1 < poly.vertices.length; vi++) {
            const v1 = poly.vertices[vi];
            const v2 = poly.vertices[vi + 1];
            const { dist, t: projT } = distToSegment(t.x, t.y, v1.x, v1.y, v2.x, v2.y);
            const maxDist = layerMatch ? 3.0 : 1.5;
            if (projT >= -0.2 && projT <= 1.2 && dist < maxDist) {
              if (dist < minPolyDist) {
                minPolyDist = dist;
                bestPoly = poly;
              }
            }
          }
        }

        if (bestPoly) {
          resolvedLen = Math.round(bestPoly.length * 1000) / 1000;
          lenSource = 'drawing';
          geomEvidence = `โพลีไลน์ LWPOLYLINE ใน CAD (${bestPoly.layer}) ยาว ${resolvedLen.toFixed(2)}${unit}`;
        }
      }

      // 3. Search DIMENSION code 42 if still not resolved
      if (resolvedLen === 0) {
        for (const dim of dimensions) {
          if (dim.measurement > 0) {
            const d = Math.hypot(t.x - dim.x, t.y - dim.y);
            if (d < 3.5) {
              resolvedLen = Math.round(dim.measurement * 1000) / 1000;
              lenSource = 'drawing';
              geomEvidence = `มิติ DIMENSION ใน CAD (${dim.layer}) วัดได้ ${resolvedLen.toFixed(2)}${unit}`;
              break;
            }
          }
        }
      }
    }

    // Determine count: if not in text, count matching INSERT blocks (especially for columns)
    let resolvedCount = g.count ? Number(g.count) : 1;
    let countSource: FieldSource = g.count ? 'drawing' : 'missing';
    let countEvidence = '';

    if (!g.count && isCol) {
      // Look for INSERT blocks matching the column tag or layer
      const matchingInserts = inserts.filter(ins => {
        const nameMatch = ins.name.toUpperCase() === tag || ins.name.toUpperCase().includes(tag);
        const layerMatch = ins.layer.toLowerCase() === t.layer.toLowerCase() || /COL|เสา/i.test(ins.layer);
        return nameMatch || (layerMatch && !ins.name.toUpperCase().startsWith('B'));
      });

      if (matchingInserts.length > 0) {
        resolvedCount = matchingInserts.length;
        countSource = 'drawing';
        countEvidence = `พบ ${resolvedCount} ตำแหน่งบล็อก INSERT (${tag}) บนเลเยอร์ ${t.layer}`;
      }
    }

    const fs: Record<string, FieldSource> = {
      tag: 'drawing',
      width: 'drawing',
      depth: 'drawing',
      length: lenSource,
      count: countSource,
    };
    if (!isCol) fs.support = 'assumed';

    const evidenceList = [
      {
        page: 0,
        label: `ข้อความใน DXF (layer ${t.layer})`,
        text: `${t.text} @ (${t.x.toFixed(2)}, ${t.y.toFixed(2)})`,
        method: 'dxf' as const,
      },
    ];
    if (geomEvidence) {
      evidenceList.push({
        page: 0,
        label: `ข้อมูลเรขาคณิต CAD`,
        text: geomEvidence,
        method: 'dxf' as const,
      });
    }
    if (countEvidence) {
      evidenceList.push({
        page: 0,
        label: `จำนวนตำแหน่งบล็อก`,
        text: countEvidence,
        method: 'dxf' as const,
      });
    }

    members.push({
      tag,
      memberType: isCol ? 'COLUMN' : 'BEAM',
      width: Number(g.w),
      depth: Number(g.d),
      length: resolvedLen,
      count: resolvedCount,
      unit: g.unit || unit,
      gridLocation: `CAD-${t.layer}`,
      level: 'Story 1',
      sourceFile: fileName,
      sourceSheetOrLayer: t.layer,
      rawDimensionStr: t.text,
      supportColW1: isCol ? 0 : supW,
      supportColW2: isCol ? 0 : supW,
      provenance: {
        evidence: evidenceList,
        fieldSources: fs,
        confidence: resolvedLen > 0 ? 0.9 : 0.7,
        conflicts: [],
      },
    });
  }

  const totalEntities = texts.length + dxfLines.length + polylines.length +
                        dimensions.length + inserts.length + circles.length + hatches.length;

  return {
    members,
    warnings,
    unit,
    layerCount: layers.size,
    entityCount: totalEntities,
  };
}
