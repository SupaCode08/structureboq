/**
 * StructBOQ - Structural General Notes Parser (Deterministic / Rule-Based)
 * 
 * Extracts design parameters from "รายการประกอบแบบวิศวกรรมโครงสร้าง" (General Structural Notes)
 * including:
 *   - Concrete Strength: f'c (cylinder/cube, e.g. 150, 180, 210, 240, 280, 300, 320, 350, 400 ksc)
 *   - Concrete Covering: covering distances (e.g. ฐานราก 5-7.5 cm, เสา/คาน 3-4 cm, พื้น 2-2.5 cm)
 *   - Rebar Grades: Round bars (SR24, fy=2400 ksc) & Deformed bars (SD30, SD40, SD50, fy=3000/4000/5000 ksc)
 *   - Lap Splices: standard lap length multiplier (e.g. 40d, 48d)
 *   - Pile specifications: e.g. 0.15x0.15x6.00 m, safe load (ตัน/ต้น)
 *   - Soil Bearing Capacity: น้ำหนักบรรทุกปลอดภัยของดิน (e.g. 8, 10, 12, 15 ตัน/ตร.ม.)
 */

import type { OcrWord } from './types';
import type { MaterialSpecs } from '../engine/qsEngine';
import { DEFAULT_MATERIAL_SPECS } from '../engine/qsEngine';

export interface ExtractedGeneralNotes {
  concreteGrade?: string;
  concreteStrengthKsc?: number;
  concreteStrengthType?: 'cube' | 'cylinder';
  mainRebarGrade?: string;
  stirrupGrade?: string;
  concreteCoveringCm?: number;
  coveringByMember?: {
    footingCm?: number;
    columnCm?: number;
    beamCm?: number;
    slabCm?: number;
  };
  lapSpliceDb?: number;
  soilBearingCapacityTonsM2?: number;
  pileSpec?: {
    sizeStr: string;
    safeLoadTons?: number;
    lengthM?: number;
  };
  sourcePage?: number;
  evidenceSnippets: string[];
}

/**
 * Deterministically scans OCR words across sheets for Structural General Notes.
 */
export function extractStructuralNotesFromWords(
  pagesWords: { page: number; words: OcrWord[] }[]
): ExtractedGeneralNotes {
  const result: ExtractedGeneralNotes = {
    evidenceSnippets: [],
  };

  for (const { page, words } of pagesWords) {
    if (!words || !words.length) continue;

    // Combine text into lines using vertical midpoint tolerance
    const sorted = [...words]
      .filter(w => w.text && w.text.trim().length > 0)
      .sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);

    const lineGroups: OcrWord[][] = [];
    for (const w of sorted) {
      const mid = (w.y0 + w.y1) / 2;
      const last = lineGroups[lineGroups.length - 1];
      if (last && Math.abs((last[0].y0 + last[0].y1) / 2 - mid) < 0.012) {
        last.push(w);
      } else {
        lineGroups.push([w]);
      }
    }

    const lines = lineGroups.map(group => {
      group.sort((a, b) => a.x0 - b.x0);
      return group.map(w => w.text).join(' ');
    });

    const fullText = lines.join('\n');

    // Check if this sheet contains structural notes
    const hasNoteKeywords =
      /รายการประกอบแบบ|วิศวกรรมโครงสร้าง|GENERAL\s*NOTES|STRUCTURAL\s*NOTES/i.test(fullText) ||
      (/คอนกรีต/i.test(fullText) && /(ksc|fy|fc|SR|SD)/i.test(fullText)) ||
      (/(?:f'?c|ksc)/i.test(fullText) && /(?:SR|SD|fy)/i.test(fullText));

    if (!hasNoteKeywords) {
      // Check individual high-confidence phrases
      const hasDirectSpecs = words.some(w => /f'?c\s*=\s*\d{2,3}/i.test(w.text) || /SR[-—–]?24/i.test(w.text));
      if (!hasDirectSpecs) continue;
    }

    result.sourcePage = page;

    // 1. Concrete Strength (f'c)
    // Matches e.g. "f'c = 150 ksc", "fc' = 210 ksc", "240 ksc", "คอนกรีต 210", "150 กก./ซม.2"
    const fcMatch = fullText.match(/(?:f'?c|fcu|คอนกรีต|กำลังอัด|STRENGTH)[^\d\n]{0,20}(\d{2,3})\s*(?:ksc|กก\.?\/|kg\/|คิวบ์|cube|cyl)/i)
      || fullText.match(/(\d{2,3})\s*ksc/i);

    if (fcMatch && !result.concreteStrengthKsc) {
      const val = Number(fcMatch[1]);
      if (val >= 140 && val <= 500) {
        result.concreteStrengthKsc = val;
        const isCyl = /cyl/i.test(fcMatch[0]);
        result.concreteStrengthType = isCyl ? 'cylinder' : 'cube';
        result.concreteGrade = `C${Math.round(val * 0.8)}/${Math.round(val)} (${val} ksc ${result.concreteStrengthType})`;
        result.evidenceSnippets.push(`คอนกรีต: f'c = ${val} ksc (${result.concreteStrengthType}) [น.${page}]`);
      }
    }

    // 2. Rebar Grade: Round bar (SR24)
    if (!result.stirrupGrade) {
      const srMatch = fullText.match(/SR[-—–\s]?24|fy\s*=\s*2,?400/i);
      if (srMatch) {
        result.stirrupGrade = 'SR24 (fy=2,400 ksc)';
        result.evidenceSnippets.push(`เหล็กกลม/ปลอก: SR24 (fy=2,400 ksc) [น.${page}]`);
      }
    }

    // 3. Rebar Grade: Deformed bar (SD30 / SD40 / SD50)
    if (!result.mainRebarGrade) {
      const sdMatch = fullText.match(/SD[-—–\s]?(30|40|50)|fy\s*=\s*(3,?000|4,?000|5,?000)/i);
      if (sdMatch) {
        const gradeNum = sdMatch[1] || (sdMatch[2]?.startsWith('3') ? '30' : sdMatch[2]?.startsWith('5') ? '50' : '40');
        const fy = gradeNum === '30' ? '3,000' : gradeNum === '50' ? '5,000' : '4,000';
        result.mainRebarGrade = `SD${gradeNum} (fy=${fy} ksc)`;
        result.evidenceSnippets.push(`เหล็กข้ออ้อย: SD${gradeNum} (fy=${fy} ksc) [น.${page}]`);
      }
    }

    // 4. Concrete Covering (ระยะหุ้มคอนกรีต)
    if (!result.coveringByMember) {
      result.coveringByMember = {};
    }
    const ftCoverMatch = fullText.match(/(?:ฐานราก|footing)[^\d\n]{0,25}(\d(?:\.\d)?)\s*(?:cm|ซม|มม|mm)/i);
    if (ftCoverMatch && !result.coveringByMember.footingCm) {
      let val = Number(ftCoverMatch[1]);
      if (/mm|มม/i.test(ftCoverMatch[0]) && val >= 15) val /= 10;
      if (val >= 2.5 && val <= 10) {
        result.coveringByMember.footingCm = val;
        result.evidenceSnippets.push(`ระยะหุ้มฐานราก: ${val} ซม. [น.${page}]`);
      }
    }
    const colCoverMatch = fullText.match(/(?:เสา|column)[^\d\n]{0,25}(\d(?:\.\d)?)\s*(?:cm|ซม|มม|mm)/i);
    if (colCoverMatch && !result.coveringByMember.columnCm) {
      let val = Number(colCoverMatch[1]);
      if (/mm|มม/i.test(colCoverMatch[0]) && val >= 15) val /= 10;
      if (val >= 2.0 && val <= 6) {
        result.coveringByMember.columnCm = val;
        result.evidenceSnippets.push(`ระยะหุ้มเสา: ${val} ซม. [น.${page}]`);
      }
    }
    const beamCoverMatch = fullText.match(/(?:คาน|beam)[^\d\n]{0,25}(\d(?:\.\d)?)\s*(?:cm|ซม|มม|mm)/i);
    if (beamCoverMatch && !result.coveringByMember.beamCm) {
      let val = Number(beamCoverMatch[1]);
      if (/mm|มม/i.test(beamCoverMatch[0]) && val >= 15) val /= 10;
      if (val >= 2.0 && val <= 6) {
        result.coveringByMember.beamCm = val;
        result.evidenceSnippets.push(`ระยะหุ้มคาน: ${val} ซม. [น.${page}]`);
      }
    }
    const slabCoverMatch = fullText.match(/(?:พื้น|slab)[^\d\n]{0,25}(\d(?:\.\d)?)\s*(?:cm|ซม|มม|mm)/i);
    if (slabCoverMatch && !result.coveringByMember.slabCm) {
      let val = Number(slabCoverMatch[1]);
      if (/mm|มม/i.test(slabCoverMatch[0]) && val >= 15) val /= 10;
      if (val >= 1.5 && val <= 5) {
        result.coveringByMember.slabCm = val;
        result.evidenceSnippets.push(`ระยะหุ้มพื้น: ${val} ซม. [น.${page}]`);
      }
    }

    if (result.coveringByMember.beamCm) {
      result.concreteCoveringCm = result.coveringByMember.beamCm;
    } else if (result.coveringByMember.columnCm) {
      result.concreteCoveringCm = result.coveringByMember.columnCm;
    } else if (!result.concreteCoveringCm) {
      const covMatch = fullText.match(/(?:ระยะหุ้ม|covering|ระยะคอนกรีตหุ้ม)[^\d\n]{0,25}(\d(?:\.\d)?)\s*(?:cm|ซม|มม|mm)/i);
      if (covMatch) {
        let val = Number(covMatch[1]);
        if (/mm|มม/i.test(covMatch[0]) && val >= 15) val /= 10;
        if (val >= 1.5 && val <= 10) {
          result.concreteCoveringCm = val;
          result.evidenceSnippets.push(`ระยะหุ้มคอนกรีตทั่วไป: ${val} ซม. [น.${page}]`);
        }
      }
    }

    // 5. Lap Splice (ระยะทาบเหล็ก)
    if (!result.lapSpliceDb) {
      const lapMatch = fullText.match(/(?:ระยะทาบ|ต่อทาบ|ทาบเหล็ก|lap\s*splice)[^\d\n]{0,20}(\d{2})\s*(?:d|เท่า)/i);
      if (lapMatch) {
        const d = Number(lapMatch[1]);
        if (d >= 30 && d <= 60) {
          result.lapSpliceDb = d;
          result.evidenceSnippets.push(`ระยะทาบเหล็ก: ${d}d [น.${page}]`);
        }
      }
    }

    // 6. Soil Bearing Capacity (กำลังรับน้ำหนักบรรทุกของดิน)
    if (!result.soilBearingCapacityTonsM2) {
      const soilMatch = fullText.match(/(?:รับน้ำหนัก|ดินรับน้ำหนัก|bearing\s*capacity)[^\d\n]{0,25}(\d{1,2}(?:\.\d{1,2})?)\s*(?:ตัน|ton|t)/i);
      if (soilMatch) {
        const val = Number(soilMatch[1]);
        if (val >= 4 && val <= 50) {
          result.soilBearingCapacityTonsM2 = val;
          result.evidenceSnippets.push(`กำลังรับน้ำหนักปลอดภัยของดิน: ${val} ตัน/ตร.ม. [น.${page}]`);
        }
      }
    }

    // 7. Pile Specifications from Notes
    if (!result.pileSpec) {
      const pileMatch = fullText.match(/(?:เสาเข็ม|pile)[^\n]{0,40}(\d\.\d{2}\s*x\s*\d\.\d{2}\s*x\s*\d{1,2}(?:\.\d{1,2})?)\s*ม\.?/i);
      if (pileMatch) {
        const sizeStr = pileMatch[1].replace(/\s+/g, '');
        const safeMatch = fullText.match(/(?:ปลอดภัย|safe\s*load)[^\d\n]{0,20}(\d{1,2}(?:\.\d{1,2})?)\s*(?:ตัน|ton)/i);
        result.pileSpec = {
          sizeStr,
          safeLoadTons: safeMatch ? Number(safeMatch[1]) : undefined,
        };
        result.evidenceSnippets.push(`เสาเข็มตามรายการประกอบแบบ: ${sizeStr} ม.${safeMatch ? ` (ปลอดภัย ${safeMatch[1]} ตัน/ต้น)` : ''} [น.${page}]`);
      }
    }
  }

  return result;
}

/**
 * Merges extracted general structural notes into project MaterialSpecs.
 */
export function applyGeneralNotesToSpecs(
  baseSpecs: MaterialSpecs,
  notes: ExtractedGeneralNotes
): MaterialSpecs {
  const updated = { ...baseSpecs };

  if (notes.concreteGrade) {
    updated.concreteGrade = notes.concreteGrade;
  }
  if (notes.concreteStrengthKsc) {
    if (notes.concreteStrengthKsc >= 350) updated.concreteMatRate = 2850;
    else if (notes.concreteStrengthKsc >= 300) updated.concreteMatRate = 2600;
    else if (notes.concreteStrengthKsc >= 280) updated.concreteMatRate = 2450;
    else if (notes.concreteStrengthKsc >= 240) updated.concreteMatRate = 2350;
    else if (notes.concreteStrengthKsc >= 210) updated.concreteMatRate = 2250;
    else if (notes.concreteStrengthKsc >= 180) updated.concreteMatRate = 2150;
    else if (notes.concreteStrengthKsc >= 140) updated.concreteMatRate = 2050;
  }
  if (notes.mainRebarGrade) {
    updated.mainRebarGrade = notes.mainRebarGrade;
    // Adjust material rate based on grade
    if (/SD50/i.test(notes.mainRebarGrade)) {
      updated.mainRebarMatRate = 30.50;
    } else if (/SD30/i.test(notes.mainRebarGrade)) {
      updated.mainRebarMatRate = 27.50;
    } else {
      updated.mainRebarMatRate = 28.50;
    }
  }
  if (notes.stirrupGrade) {
    updated.stirrupGrade = notes.stirrupGrade;
  }
  if (notes.concreteCoveringCm) {
    updated.concreteCoveringCm = notes.concreteCoveringCm;
  }
  if (notes.lapSpliceDb && notes.lapSpliceDb >= 45) {
    updated.rebarWastagePct = Math.max(updated.rebarWastagePct, 9.0);
  }

  if (notes.evidenceSnippets.length) {
    updated.sourceText = `รายการประกอบแบบโครงสร้าง (น.${notes.sourcePage || '-'}): ${notes.evidenceSnippets.join('; ')}`;
  }

  return updated;
}
