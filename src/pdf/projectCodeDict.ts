/**
 * StructBOQ - Project Code Dictionary (Deterministic, Browser-Only)
 *
 * Builds a per-project dictionary of drawing sheet codes and structural member tag prefixes
 * from:
 *   1. Drawing Index / General Notes / Symbol Legends (e.g. "GB = คานคอดิน", "ค.1 = คาน", "PS = พื้นสำเร็จรูป")
 *   2. Extracted member tags across schedules and framing plans
 *
 * Unknown or ambiguous prefixes are flagged as confidence 'low' so the reviewer can confirm
 * or remap them once in Step 1 of the Review Workspace, applying to all matching members.
 */
import type { PageOcr } from './types';
import type { ExtractedMember, MemberType } from '../engine/qsEngine';

export type ProjectCodeTarget = MemberType | 'STEEL_SKIP' | 'UNKNOWN';

export interface ProjectCodeEntry {
  prefix: string;
  memberType: ProjectCodeTarget;
  labelTh: string;
  sampleTags: string[];
  count: number;
  source: 'legend' | 'schedule' | 'plan' | 'user';
  confidence: 'high' | 'medium' | 'low';
  sourcePage?: number;
  evidenceText?: string;
}

export interface SheetCodeEntry {
  code: string;
  title?: string;
  discipline: 'STRUCTURAL' | 'ARCHITECTURAL' | 'MEP' | 'INDEX' | 'OTHER';
  page?: number;
}

export interface ProjectCodeDictionary {
  memberCodes: ProjectCodeEntry[];
  sheetCodes: SheetCodeEntry[];
}

const STANDARD_PREFIX_MAP: Record<string, { type: ProjectCodeTarget; labelTh: string }> = {
  GB: { type: 'BEAM', labelTh: 'คานคอดิน (Ground Beam)' },
  FB: { type: 'BEAM', labelTh: 'คานฐานราก/คานคอดิน (Footing Beam)' },
  TB: { type: 'BEAM', labelTh: 'คานยึด/คานรัดรอบ (Tie Beam)' },
  RB: { type: 'BEAM', labelTh: 'คานหลังคา (Roof Beam)' },
  CB: { type: 'BEAM', labelTh: 'คานยื่น/คานเชื่อม (Cantilever/Connect Beam)' },
  SB: { type: 'BEAM', labelTh: 'คานบันได/คานรอง (Stair/Secondary Beam)' },
  WB: { type: 'BEAM', labelTh: 'คานรับผนัง (Wall Beam)' },
  PB: { type: 'BEAM', labelTh: 'คานรับพื้น/คานชั้น (Plinth/Floor Beam)' },
  BST: { type: 'BEAM', labelTh: 'คานบันได (Stair Beam)' },
  B: { type: 'BEAM', labelTh: 'คาน ค.ส.ล. (Beam)' },
  'ค': { type: 'BEAM', labelTh: 'คาน ค.ส.ล. (ค.)' },
  'คด': { type: 'BEAM', labelTh: 'คานคอดิน (คด.)' },
  C: { type: 'COLUMN', labelTh: 'เสา ค.ส.ล. (Column)' },
  PC: { type: 'COLUMN', labelTh: 'เสาตอม่อ/เสาสั้น (Pedestal Column)' },
  'ส': { type: 'COLUMN', labelTh: 'เสา ค.ส.ล. (ส.)' },
  'ต': { type: 'COLUMN', labelTh: 'ตอม่อ (ต.)' },
  F: { type: 'FOOTING', labelTh: 'ฐานราก (Footing)' },
  FC: { type: 'FOOTING', labelTh: 'ฐานรากเสาเข็ม (Pile Cap)' },
  'ฐ': { type: 'FOOTING', labelTh: 'ฐานราก (ฐ.)' },
  S: { type: 'SLAB', labelTh: 'พื้นหล่อในที่ (Slab)' },
  GS: { type: 'SLAB', labelTh: 'พื้นวางบนดิน (Slab on Ground)' },
  PS: { type: 'SLAB', labelTh: 'พื้นสำเร็จรูป (Precast Slab)' },
  SP: { type: 'SLAB', labelTh: 'พื้นสำเร็จรูป (Slab Plank)' },
  TS: { type: 'SLAB', labelTh: 'พื้นห้องน้ำ/พื้นลดระดับ (Toilet/Drop Slab)' },
  'พ': { type: 'SLAB', labelTh: 'พื้น ค.ส.ล. (พ.)' },
  ST: { type: 'STAIR', labelTh: 'บันได ค.ส.ล. (Stair)' },
  'บ': { type: 'STAIR', labelTh: 'บันได ค.ส.ล. (บ.)' },
  BS: { type: 'STEEL_SKIP', labelTh: 'คานเหล็ก/จันทันเหล็ก (Steel Beam - ไม่คิด ค.ส.ล.)' },
  CS: { type: 'STEEL_SKIP', labelTh: 'เสาเหล็ก/อะเสเหล็ก (Steel Column - ไม่คิด ค.ส.ล.)' },
  WALL: { type: 'WALL', labelTh: 'ผนัง (Wall)' },
  W: { type: 'WINDOW', labelTh: 'หน้าต่าง/ผนัง (Window/Wall)' },
  WN: { type: 'WINDOW', labelTh: 'หน้าต่าง (Window)' },
  D: { type: 'DOOR', labelTh: 'ประตู (Door)' },
  FL: { type: 'FINISH', labelTh: 'ผิวพื้นตกแต่ง (Floor Finish)' },
};

/** Extract the alphabetic/Thai prefix of a member tag: "GB2A" -> "GB", "ค.1" -> "ค", "F(0.90x0.90)" -> "F" */
export function extractTagPrefix(tag: string): string {
  const clean = tag.trim().toUpperCase().replace(/\s+/g, '');
  const thai = clean.match(/^([ก-ฮ]{1,3})\.?\d*/);
  if (thai) return thai[1];
  const footingDim = clean.match(/^(F)\(?\d/);
  if (footingDim) return footingDim[1];
  const eng = clean.match(/^([A-Z]{1,4})/);
  return eng ? eng[1] : clean.slice(0, 3);
}

function inferTypeFromThaiDescription(desc: string): ProjectCodeTarget | null {
  if (/เหล็ก|โครงหลังคา|จันทัน|แป|อะเส|STEEL|TRUSS/i.test(desc)) return 'STEEL_SKIP';
  if (/ฐานราก|ฟุตติ้ง|FOOTING|PILE\s*CAP/i.test(desc)) return 'FOOTING';
  if (/เสา|ตอม่อ|COLUMN|PEDESTAL/i.test(desc)) return 'COLUMN';
  if (/คาน|BEAM|LINTEL|ทับหลัง/i.test(desc)) return 'BEAM';
  if (/บันได|STAIR/i.test(desc)) return 'STAIR';
  if (/พื้น|SLAB|PLANK/i.test(desc)) return 'SLAB';
  if (/ผนัง|กำแพง|WALL/i.test(desc)) return 'WALL';
  return null;
}

/**
 * Scan OCR pages for explicit legend / symbol definitions like:
 *   "GB = คานคอดิน", "F1-F3 : ฐานรากแผ่", "ค. = คาน ค.ส.ล.", "PS - พื้นสำเร็จรูป"
 * and sheet index rows like "S-01 แปลนฐานรากและตอม่อ".
 */
export function extractProjectCodeDictionary(
  pages: PageOcr[] = [],
  members: ExtractedMember[] = []
): ProjectCodeDictionary {
  const map = new Map<string, ProjectCodeEntry>();
  const sheetMap = new Map<string, SheetCodeEntry>();

  // 1. Scan OCR pages for symbol legends & sheet index rows
  for (const p of pages) {
    if (!p.words?.length) continue;
    const sorted = [...p.words]
      .filter(w => w.text && w.text.trim())
      .sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);

    const lines: string[] = [];
    let cur: typeof sorted = [];
    for (const w of sorted) {
      const mid = (w.y0 + w.y1) / 2;
      if (cur.length && Math.abs((cur[0].y0 + cur[0].y1) / 2 - mid) < 0.014) {
        cur.push(w);
      } else {
        if (cur.length) {
          cur.sort((a, b) => a.x0 - b.x0);
          lines.push(cur.map(x => x.text).join(' '));
        }
        cur = [w];
      }
    }
    if (cur.length) {
      cur.sort((a, b) => a.x0 - b.x0);
      lines.push(cur.map(x => x.text).join(' '));
    }

    for (const line of lines) {
      // Sheet index line: "S-01 ผังฐานราก..." or "A-02 แปลนพื้นชั้น 1"
      const sm = line.match(/\b(S|ST|STR|A|AR|EE|E|SN|SAN|M|ME)-?(\d{2})\b\s+(.{4,60})/);
      if (sm) {
        const rawPrefix = sm[1].toUpperCase();
        const code = `${rawPrefix}-${sm[2]}`;
        if (!sheetMap.has(code)) {
          const discipline: SheetCodeEntry['discipline'] =
            /^(S|ST|STR)$/.test(rawPrefix) ? 'STRUCTURAL'
              : /^(A|AR)$/.test(rawPrefix) ? 'ARCHITECTURAL'
              : /^(E|EE|SN|SAN|M|ME)$/.test(rawPrefix) ? 'MEP'
              : 'OTHER';
          sheetMap.set(code, {
            code,
            title: sm[3].trim().slice(0, 60),
            discipline,
            page: p.page,
          });
        }
      }

      // Legend definition: "GB = คานคอดิน" or "ค.1 : คานชั้น 1" or "PB - คานรับพื้น"
      const lm = line.match(/(?:^|\s)([A-Z]{1,4}|[ก-ฮ]{1,2}\.?)(?:\d{0,2}(?:\s*[-–,]\s*[A-Zก-ฮ.]*\d{1,2})?)?\s*(?:=|:|แทน|หมายถึง|-)\s*([ก-๙A-Za-z0-9\s./()]{3,45})/);
      if (lm) {
        const prefix = extractTagPrefix(lm[1]);
        const desc = lm[2].trim();
        const inferred = inferTypeFromThaiDescription(desc);
        if (prefix && inferred && prefix.length <= 4 && !/^(MM|CM|KG|M2|M3|NO|SC|FC|FY)$/i.test(prefix)) {
          const existing = map.get(prefix);
          if (!existing || existing.source !== 'legend') {
            map.set(prefix, {
              prefix,
              memberType: inferred,
              labelTh: desc.slice(0, 42),
              sampleTags: existing?.sampleTags || [],
              count: existing?.count || 0,
              source: 'legend',
              confidence: 'high',
              sourcePage: p.page,
              evidenceText: line.trim().slice(0, 80),
            });
          }
        }
      }
    }
  }

  // 2. Fold in all extracted members so every active tag prefix in the project is represented
  for (const m of members) {
    const prefix = extractTagPrefix(m.tag);
    if (!prefix) continue;
    const existing = map.get(prefix);
    if (existing) {
      existing.count += m.count || 1;
      if (existing.sampleTags.length < 5 && !existing.sampleTags.includes(m.tag)) {
        existing.sampleTags.push(m.tag);
      }
    } else {
      const std = STANDARD_PREFIX_MAP[prefix];
      const hasScheduleEv = m.provenance?.evidence?.some(e => /ขยาย|ตาราง|schedule|detail/i.test(e.label));
      map.set(prefix, {
        prefix,
        memberType: m.memberType || std?.type || 'UNKNOWN',
        labelTh: std?.labelTh || `รหัสเฉพาะโครงการ (${prefix})`,
        sampleTags: [m.tag],
        count: m.count || 1,
        source: hasScheduleEv ? 'schedule' : 'plan',
        confidence: std ? 'high' : 'low',
        sourcePage: m.provenance?.evidence?.[0]?.page,
      });
    }
  }

  const order: ProjectCodeTarget[] = ['FOOTING', 'COLUMN', 'BEAM', 'SLAB', 'STAIR', 'WALL', 'DOOR', 'WINDOW', 'FINISH', 'STEEL_SKIP', 'UNKNOWN'];
  const memberCodes = [...map.values()].sort(
    (a, b) => order.indexOf(a.memberType) - order.indexOf(b.memberType) || a.prefix.localeCompare(b.prefix)
  );
  const sheetCodes = [...sheetMap.values()].sort((a, b) => a.code.localeCompare(b.code));

  return { memberCodes, sheetCodes };
}

/**
 * Apply reviewer overrides from the Project Code Dictionary to the member list.
 * Remapping a prefix to a MemberType updates matching members; remapping to 'STEEL_SKIP'
 * marks them rejected so they are excluded from concrete BOQ totals with an audit note.
 */
export function applyProjectCodeOverride(
  members: ExtractedMember[],
  prefix: string,
  newType: ProjectCodeTarget,
  reviewer?: string
): { index: number; patch: Partial<ExtractedMember> }[] {
  const updates: { index: number; patch: Partial<ExtractedMember> }[] = [];
  const normPrefix = prefix.trim().toUpperCase();
  const now = new Date().toISOString();

  members.forEach((m, index) => {
    if (extractTagPrefix(m.tag) !== normPrefix) return;
    if (newType === 'STEEL_SKIP') {
      updates.push({
        index,
        patch: {
          review: {
            status: 'rejected',
            note: `ไม่รวมในงาน ค.ส.ล. (พจนานุกรมรหัสโครงการ: ${normPrefix} = โครงสร้างเหล็ก/ไม่คิด)`,
            at: now,
            by: reviewer,
          },
        },
      });
    } else if (newType !== 'UNKNOWN') {
      const patch: Partial<ExtractedMember> = { memberType: newType };
      if (newType === 'SLAB' && /^(PS|SP)$/.test(normPrefix)) {
        patch.slabType = 'PRECAST_PLANK';
      } else if (newType === 'SLAB' && normPrefix === 'GS') {
        patch.slabType = 'SLAB_ON_GROUND';
      }
      updates.push({ index, patch });
    }
  });
  return updates;
}
