"""
StructBOQ - Deterministic Python CAD (DXF / DWG) Processor
Extracts structural entities (LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, TEXT, MTEXT, DIMENSION, INSERT, HATCH)
and resolves member dimensions, quantities, and coordinates according to Thai engineering standards.
100% Local Processing - Zero External AI / LLM APIs.
"""
import os as _os, sys as _sys
if _os.environ.get('FULL_BOQ') != '1': _sys.exit("cad_processor.py: processes real drawing sets. Run again with FULL_BOQ=1 to confirm.")

import sys
import os
import json
import math
import re
from typing import Dict, List, Any, Optional

try:
    import ezdxf
except ImportError:
    ezdxf = None

TAG_DIM_PATTERN = re.compile(
    r'(?:(?P<count>\d+)[-_ ]*)?'
    r'(?P<tag>(?:RB|GB|TB|TG|WB|SB|B|FC|RC|SC|C|col|beam|คาน|เสา)[\s-]*\d+[A-Za-z]?)'
    r'[\s:(\[]*(?P<w>\d+(?:\.\d+)?)\s*[xX*×]\s*(?P<d>\d+(?:\.\d+)?)'
    r'(?:\s*(?P<unit>mm|cm|m))?'
    r'(?:[^\d]*(?:[lLhH]=?|[lLhH]:\s*)(?P<len>\d+(?:\.\d+)?))?',
    re.IGNORECASE
)

UNITS_MAP = {1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm'}

def dist_point_to_segment(px: float, py: float, x1: float, y1: float, x2: float, y2: float):
    dx = x2 - x1
    dy = y2 - y1
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return math.hypot(px - x1, py - y1), 0.0
    t = ((px - x1) * dx + (py - y1) * dy) / l2
    t_clamped = max(0.0, min(1.0, t))
    proj_x = x1 + t_clamped * dx
    proj_y = y1 + t_clamped * dy
    return math.hypot(px - proj_x, py - proj_y), t

def process_dxf(file_path: str) -> Dict[str, Any]:
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    if ezdxf is None:
        raise RuntimeError("ezdxf library is required but not installed.")

    doc = ezdxf.readfile(file_path)
    msp = doc.modelspace()

    insunits = doc.header.get('$INSUNITS', 0)
    detected_unit = UNITS_MAP.get(insunits, 'm')
    warnings = []
    if not insunits:
        warnings.append('ไฟล์ DXF ไม่ระบุหน่วย ($INSUNITS = 0) — สันนิษฐานตามสเกลตัวเลข')

    texts = []
    lines = []
    polylines = []
    dimensions = []
    inserts = []
    circles = []
    hatches = []
    layers = set()

    for e in msp:
        layer = e.dxf.layer
        layers.add(layer)
        dxftype = e.dxftype()

        if dxftype in ('TEXT', 'MTEXT'):
            txt = e.dxf.text if dxftype == 'TEXT' else e.text
            pt = e.dxf.insert
            texts.append({
                'type': dxftype,
                'layer': layer,
                'text': txt.strip(),
                'x': pt.x,
                'y': pt.y,
                'height': getattr(e.dxf, 'height', 0.25)
            })
        elif dxftype == 'LINE':
            start = e.dxf.start
            end = e.dxf.end
            length = math.hypot(end.x - start.x, end.y - start.y)
            if length > 0:
                lines.append({
                    'layer': layer,
                    'x1': start.x, 'y1': start.y,
                    'x2': end.x, 'y2': end.y,
                    'length': length
                })
        elif dxftype == 'LWPOLYLINE':
            pts = [(p[0], p[1]) for p in e.get_points(format='xy')]
            if len(pts) >= 2:
                total_len = sum(math.hypot(pts[i+1][0] - pts[i][0], pts[i+1][1] - pts[i][1]) for i in range(len(pts) - 1))
                if e.is_closed and len(pts) > 2:
                    total_len += math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1])
                polylines.append({
                    'layer': layer,
                    'points': pts,
                    'is_closed': e.is_closed,
                    'length': total_len
                })
        elif dxftype == 'DIMENSION':
            measurement = getattr(e.dxf, 'actual_measurement', 0.0)
            defpoint = getattr(e.dxf, 'defpoint', (0, 0, 0))
            dimensions.append({
                'layer': layer,
                'text': getattr(e.dxf, 'text', ''),
                'measurement': measurement,
                'x': defpoint[0],
                'y': defpoint[1]
            })
        elif dxftype == 'INSERT':
            pt = e.dxf.insert
            inserts.append({
                'layer': layer,
                'name': e.dxf.name,
                'x': pt.x,
                'y': pt.y,
                'scale_x': getattr(e.dxf, 'xscale', 1.0),
                'scale_y': getattr(e.dxf, 'yscale', 1.0),
                'rotation': getattr(e.dxf, 'rotation', 0.0)
            })
        elif dxftype in ('CIRCLE', 'ARC'):
            center = e.dxf.center
            circles.append({
                'layer': layer,
                'cx': center.x,
                'cy': center.y,
                'radius': e.dxf.radius
            })
        elif dxftype == 'HATCH':
            hatches.append({
                'layer': layer,
                'pattern_name': getattr(e.dxf, 'pattern_name', '')
            })

    # Associate structural tags with geometric entities
    members = []
    for t in texts:
        m = TAG_DIM_PATTERN.search(t['text'])
        if not m:
            continue
        g = m.groupdict()
        tag = re.sub(r'\s+', '', g['tag'].upper())
        is_col = bool(re.match(r'^(C|FC|RC|SC)', tag) or 'COL' in tag or 'เสา' in tag or 'COL' in t['layer'].upper())

        # Length resolution
        resolved_len = float(g['len']) if g.get('len') else 0.0
        len_source = 'drawing' if g.get('len') else 'missing'
        geom_evidence = ""

        if not is_col and resolved_len == 0.0:
            best_line = None
            min_dist = float('inf')
            for line in lines:
                layer_match = (line['layer'].lower() == t['layer'].lower() or
                               any(kw in line['layer'].upper() for kw in ('BEAM', 'คาน', 'S-', 'STRUCTURE')))
                dist, proj_t = dist_point_to_segment(t['x'], t['y'], line['x1'], line['y1'], line['x2'], line['y2'])
                max_allowed = 3.0 if layer_match else 1.5
                if -0.2 <= proj_t <= 1.2 and dist < max_allowed:
                    score = dist - (1.0 if layer_match else 0.0)
                    if score < min_dist:
                        min_dist = score
                        best_line = line

            if best_line:
                resolved_len = round(best_line['length'], 3)
                len_source = 'drawing'
                geom_evidence = f"เส้น LINE ใน CAD ({best_line['layer']}) ยาว {resolved_len:.2f}{detected_unit}"

            if resolved_len == 0.0:
                # Check polylines
                for poly in polylines:
                    layer_match = (poly['layer'].lower() == t['layer'].lower() or 'BEAM' in poly['layer'].upper())
                    pts = poly['points']
                    for pi in range(len(pts) - 1):
                        dist, proj_t = dist_point_to_segment(t['x'], t['y'], pts[pi][0], pts[pi][1], pts[pi+1][0], pts[pi+1][1])
                        if -0.2 <= proj_t <= 1.2 and dist < (3.0 if layer_match else 1.5):
                            resolved_len = round(poly['length'], 3)
                            len_source = 'drawing'
                            geom_evidence = f"LWPOLYLINE ใน CAD ({poly['layer']}) ยาว {resolved_len:.2f}{detected_unit}"
                            break
                    if resolved_len > 0:
                        break

            if resolved_len == 0.0:
                # Check dimensions
                for dim in dimensions:
                    if dim['measurement'] > 0:
                        d = math.hypot(t['x'] - dim['x'], t['y'] - dim['y'])
                        if d < 3.5:
                            resolved_len = round(dim['measurement'], 3)
                            len_source = 'drawing'
                            geom_evidence = f"DIMENSION ใน CAD ({dim['layer']}) วัดได้ {resolved_len:.2f}{detected_unit}"
                            break

        # Count resolution
        resolved_count = int(g['count']) if g.get('count') else 1
        count_source = 'drawing' if g.get('count') else 'missing'
        count_evidence = ""

        if not g.get('count') and is_col:
            matching_inserts = [
                ins for ins in inserts
                if ins['name'].upper() == tag or tag in ins['name'].upper() or
                   (ins['layer'].lower() == t['layer'].lower() and not ins['name'].upper().startswith('B'))
            ]
            if matching_inserts:
                resolved_count = len(matching_inserts)
                count_source = 'drawing'
                count_evidence = f"พบบล็อก INSERT ({tag}) {resolved_count} จุด"

        member = {
            'tag': tag,
            'memberType': 'COLUMN' if is_col else 'BEAM',
            'width': float(g['w']),
            'depth': float(g['d']),
            'length': resolved_len,
            'count': resolved_count,
            'unit': g.get('unit') or detected_unit,
            'gridLocation': f"CAD-{t['layer']}",
            'sourceFile': os.path.basename(file_path),
            'sourceSheetOrLayer': t['layer'],
            'rawDimensionStr': t['text'],
            'fieldSources': {
                'tag': 'drawing',
                'width': 'drawing',
                'depth': 'drawing',
                'length': len_source,
                'count': count_source
            },
            'evidence': [
                f"ข้อความ {t['text']} @ ({t['x']:.2f}, {t['y']:.2f}) บน {t['layer']}"
            ]
        }
        if geom_evidence:
            member['evidence'].append(geom_evidence)
        if count_evidence:
            member['evidence'].append(count_evidence)

        members.append(member)

    return {
        'fileName': os.path.basename(file_path),
        'fileType': 'DXF',
        'unit': detected_unit,
        'layerCount': len(layers),
        'entityCount': len(texts) + len(lines) + len(polylines) + len(dimensions) + len(inserts) + len(circles) + len(hatches),
        'members': members,
        'warnings': warnings
    }

if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if len(sys.argv) < 2:
        print("Usage: python cad_processor.py <path_to_dxf_or_dwg>")
        sys.exit(1)
    target = sys.argv[1]
    res = process_dxf(target)
    print(json.dumps(res, indent=2, ensure_ascii=False))
