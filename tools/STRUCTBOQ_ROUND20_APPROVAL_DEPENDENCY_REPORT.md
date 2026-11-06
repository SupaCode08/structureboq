# StructBOQ Round 20 — Approval Dependency & Calculation Snapshot

**วันที่:** 2026-11-03 · **สถานะ:** IMPLEMENTED — audit + design (หัวข้อ 1–6) และผลการแก้ (หัวข้อ 7–12)

**วิธี:**
- ค้นตาม symbol (`approvalKey`, `ReviewDecision`, `calculateMember`, `rules.*`, `memberCover`, `readingSignature`, `logEntryFor`, Excel แผ่น 7–8)
- probe นอก repo (`depprobe.ts`) กับฐานราก 1.20×1.20×0.30 ม. `6-DB12+6-DB12` ที่อนุมัติแล้ว (มี `coverM` และ revision) จากนั้นเปลี่ยนทีละอย่าง
- ไม่ได้อ่านทั้ง source tree และไม่ได้เปิดแบบ

## 1. กลไกปัจจุบัน
- **approval:** `ReviewDecision { status, valuesKey = approvalKey(member), coverM (19.1), by, revision (18d) }`
- **การตรวจตอนคำนวณทุกครั้ง** (`calculateMember`): approval เป็นโมฆะเมื่อ `valuesKey` ≠ ค่าปัจจุบัน หรือ `coverM` ≠ ระยะหุ้มที่ resolve ได้ → `APPROVAL_STALE` + NEEDS_REVIEW
- **`approvalKey`:** ครอบทุก field ของ member ยกเว้น `review` และ `provenance` → ครอบ geometry, count, rebarSets, coverMode/coveringCm, footingHookShape ของชิ้น
- **ไม่ครอบ:**
  - สเปกโครงการ (ยกเว้นระยะหุ้ม)
  - revision ของแบบ — มีการบันทึก แต่ไม่เคยถูกเทียบ
  - เวอร์ชันของ engine — ไม่มีอยู่เลย
- **การกู้รีวิว:** กู้ด้วย `ชื่อไฟล์ + readingSignature(members)` ไม่ใช้ SHA-256 ของไฟล์
- **Export:** Excel คำนวณจาก `currentProject` ปัจจุบัน approval ที่เป็นโมฆะจึงแสดงเป็น NEEDS_REVIEW อยู่แล้ว แต่ไม่มีสถานะ "STALE" แยก ไม่มี fingerprint และไม่มียอดตอนอนุมัติให้เทียบ
- **ประวัติ:** บันทึก field ที่เปลี่ยน ค่าก่อน/หลัง เวลา ผู้ตรวจ และ revision โดยอ้างชิ้นด้วย index + tag ไม่มี fingerprint

## 2. Dependency matrix (ฐานราก)

ผลก่อน/หลังมาจาก probe ฐานราก 1.20×1.20×0.30 (base: คอนกรีต 0.432 ลบ.ม., ไม้แบบ 1.44 ตร.ม., เหล็ก 15.98 กก., lean 0.098 ลบ.ม., ขุดดิน 2.94 ลบ.ม., ค่าใช้จ่าย 3,282 บาท)

| Field | แหล่งที่มา | กระทบการคำนวณ | approval หลุดตอนนี้? | ความเสี่ยงถ้าไม่หลุด |
|---|---|---|---|---|
| width / depth / length (หนา) | แบบ / ผู้ตรวจ | ทุกปริมาณ | ✅ (valuesKey) — probe: กว้าง 1.5 → stale | — |
| count | แบบ / ผู้ตรวจ | ทุกปริมาณ ×count | ✅ | — |
| bottomRebar (ข้อความ) | แบบ / ผู้ตรวจ | เหล็ก | ✅ — probe: 15.98 → 18.65 stale | — |
| rebarSets[] (ขนาด, จำนวน, ระยะ, ทิศ, ชั้น, ปลาย, ความยาวงอ/ตัด) | แบบ / ผู้ตรวจ | เหล็ก | ✅ (R19 tests) | — |
| footingHookShape ของชิ้น | แบบ / ผู้ตรวจ | เหล็ก | ✅ — probe: 15.98 → 11.72 stale | — |
| coveringCm / coverMode ของชิ้น | แบบ / ผู้ตรวจ | เหล็ก (ความยาว, จำนวน) | ✅ | — |
| ระยะหุ้มจากสเปก (footing/legacy) | หมายเหตุในแบบ / หน้าสเปก / ค่ามาตรฐาน | เหล็ก | ✅ เฉพาะ approval ที่มี `coverM` (19.1) | approval ก่อน 19.1 ไม่ได้รับการป้องกัน |
| **`specs.footingHookShape`** (รูปงอค่าเริ่มต้นของโครงการ) | หน้าสเปก / ค่าเริ่มต้น | เหล็ก | ❌ — probe: **15.98 → 11.72 กก. (−27%) ยัง AUTO_RELEASE** | **สูง** — ยอดเหล็กที่อนุมัติเปลี่ยนเงียบ |
| **`specs.leanThicknessM`** | หน้าสเปก / ค่าเริ่มต้น | คอนกรีตหยาบ | ❌ — probe: lean 0.098 → 0.196 (×2) ยัง AUTO_RELEASE | สูง (ปริมาณ BOQ) |
| **`specs.excavationMarginM`**, `excavationBulkingFactor` | หน้าสเปก / ค่าเริ่มต้น | ขุดดิน | ❌ — probe: ขุด 2.94 → 4.86 (+65%) | สูง (ปริมาณ BOQ) |
| `specs.sandThicknessM` (ฐาน), `slabSandThicknessM` | หน้าสเปก / ค่าเริ่มต้น | ทราย | ❌ (กลไกเดียวกับ lean) | สูง |
| `specs.concreteWastagePct` / `formworkWastagePct` / `rebarWastagePct` | หน้าสเปก | ค่าใช้จ่าย (ปริมาณสุทธิไม่เปลี่ยน; `wastageWeightKg`) | ❌ — probe: 3,282 → 3,327 / 3,296 บาท | กลาง (มูลค่า BOQ) |
| อัตราค่าวัสดุ/ค่าแรงทุกตัว (`*MatRate`, `*LaborRate`) | หน้าสเปก / หมายเหตุในแบบ (เกรดคอนกรีต → ราคา) | ค่าใช้จ่าย | ❌ — probe: ราคาคอนกรีต ×2 → 3,282 → 4,234 บาท | กลาง (มูลค่า BOQ) |
| `specs.mainRebarGrade` | หมายเหตุในแบบ / หน้าสเปก | เหล็กขั้นต่ำตามมาตรฐาน (fy) เมื่อแบบไม่ให้เหล็ก, เกรดในตารางเหล็ก, ราคา | ❌ (probe ฐานที่มีเหล็ก: ไม่เปลี่ยน) | กลาง (ชิ้นที่ไม่มีเหล็กในแบบ) |
| `specs.stockBarLengthM` | หน้าสเปก | การต่อทาบเหล็กพื้น | ❌ | กลาง (พื้น) |
| `specs.groundBeamSoffitFormwork` | หน้าสเปก | ไม้แบบคานคอดิน | ❌ | กลาง (คาน) |
| ระยะทาบ 40d, ขอ 12d, ตาราง kg/m, สูตรทั้งหมด | ค่าคงที่ในโค้ด | ทุกอย่าง | ❌ — **ไม่มีเวอร์ชัน engine** | สูง — อัปเดตโปรแกรมแล้ว approval ที่บันทึกไว้ (localStorage) ยังใช้กับสูตรใหม่ |
| SHA-256 ไฟล์แบบ (revision) | ไฟล์ที่เปิด | ทุกอย่าง (ทางอ้อม) | ❌ — บันทึกไว้แต่ไม่เทียบ; การกู้รีวิวเทียบเฉพาะผลอ่าน | กลาง — ไฟล์ revision ใหม่ที่อ่านได้เหมือนเดิมจะได้ approval เดิมกลับมา |
| สเปกที่เป็น `undefined` | สเปกที่บันทึก/นำเข้าไม่ครบ | lean, ทราย, ขุด, รูปงอ ฯลฯ | ❌ — probe: `leanThicknessM: undefined` → **ใช้ 0.05 เงียบ ไม่มี flag** (`?? 0.05`, `?? 0.10`, `|| 6.0`, `|| 'FULL_UPTURN'`) | กลาง — ค่ามาตรฐานถูกใช้โดยไม่มีป้าย |
| `provenance` (เช่น ที่มาระยะหุ้ม drawing → reviewer) | reader / ผู้ตรวจ | ป้ายและ flag เท่านั้น ปริมาณไม่เปลี่ยน | ❌ (ตั้งใจ) — probe: ไม่เปลี่ยนปริมาณ | ต่ำ |
| `review`, `itemId`, ตัวกรอง/แท็บ/draft ใน UI | UI | ไม่มี | ❌ (ถูกต้อง) | — |

**สรุป:** ทุก field ของ member ครอบแล้ว ช่องโหว่อยู่ที่ (1) สเปกโครงการทั้งหมดยกเว้นระยะหุ้ม (2) เวอร์ชัน engine (3) SHA-256 ของแบบ (4) ค่าสเปกที่หายแล้วถูกแทนเงียบ (5) approval เก่าที่ไม่มี `coverM`

## 3. การตัดสินใจออกแบบที่ต้องให้ผู้ใช้เลือก
1. **สเปกส่วนไหนเข้า snapshot:**
   - **ข้อเสนอ:** ทั้งก้อน ยกเว้น `sourceText` (ข้อความแสดงผล) ข้อดีคือไม่มีรายการ field ให้ต้องดูแล จึงไม่เกิดกรณี engine อ่าน field ใหม่แล้วลืมเพิ่ม ข้อเสียคือแก้ราคาหน้าต่างแล้ว approval ของฐานรากหลุดด้วย (หลุดเกิน แต่ปลอดภัย และสเปกไม่ได้แก้บ่อย)
   - ทางเลือก: รายการ field ต่อประเภทชิ้น พร้อมเทสต์ที่สแกนทุก `rules.x` ใน engine ว่าอยู่ในรายการ
2. **Approval ก่อน Round 20** (มีแค่ `valuesKey`/`coverM` ไม่มี snapshot): **ข้อเสนอ** เป็น STALE ทั้งหมด ต้องอนุมัติใหม่ ("ห้ามใช้ approval เก่าแบบเงียบ") ทำให้รีวิวที่บันทึกไว้ในเบราว์เซอร์ต้องอนุมัติใหม่ทุกชิ้น
3. **Engine version:** ค่าคงที่ `CALC_ENGINE_VERSION` ที่ต้องเพิ่มเลขเองเมื่อแก้สูตร (เป็นข้อตกลงในทีม — เทสต์บังคับไม่ได้) เปลี่ยนแล้ว approval ทุกชิ้นเป็น STALE
4. **SHA-256 ของไฟล์แบบ:** อยู่ใน snapshot ถ้าเปิดไฟล์ใหม่ (hash ต่าง) approval เดิมเป็น STALE แม้ผลอ่านเหมือนเดิม ส่วนตัวอย่าง/ชุดข้อมูลที่ไม่มีไฟล์ บันทึกเป็น `null`

## 4. Snapshot (เสนอ)
```ts
interface CalcSnapshot {                       // ไม่มีป้ายแสดงผลหรือ state ของ UI
  schema: 1;
  engineVersion: string;                       // CALC_ENGINE_VERSION
  drawing: { file: string; sha256: string } | null;
  member: Record<string, unknown>;             // ทุก field ที่ approvalKey ครอบอยู่แล้ว (geometry, count, rebarSets, …)
  cover: { cm: number; source: CoverSource };  // ค่าที่ resolve แล้ว + ที่มา
  hook: { shape: string; source: 'member' | 'spec' | 'missing' };
  specs: Record<string, unknown | null>;       // ทั้งก้อนยกเว้น sourceText; ค่าที่หายเป็น null (ไม่ใช่ค่ามาตรฐาน)
}
```
- **Serialization:** stable JSON (เรียง key แบบ recursive, ตัด `undefined` ออก ส่วน `null` เก็บไว้) → ลำดับ key ไม่มีผลต่อผลลัพธ์
- **Fingerprint:** SHA-256 ของข้อความนั้น ใช้ฟังก์ชัน SHA-256 แบบ synchronous ประมาณ 40 บรรทัดใน engine เพราะ `calculateMember` เป็น sync และ Web Crypto เป็น async (ไม่เพิ่ม dependency) ตรวจกับ test vector มาตรฐาน `"abc"`
- **ตอนอนุมัติ** (ประทับใน App จุดเดียวกับ 18d) `review` เก็บ:
  - `snapshot` (ตัวเต็ม — ใช้บอกว่า field ไหนเปลี่ยน)
  - `fingerprint`
  - `quantities { concrete, formwork, rebarKg, lean, sand, excavation, cost }`
  - `by` และ `revision` (เดิม)
- **ตอนคำนวณ/export:**
  - สร้าง snapshot ปัจจุบันแล้วเทียบ fingerprint ถ้าต่าง → `approvalState: 'STALE'` (status NEEDS_REVIEW) พร้อมข้อความระบุ field ที่ต่าง เช่น "specs.footingHookShape: FULL_UPTURN → STRAIGHT"
  - `approvalState` ∈ APPROVED / STALE / NEEDS_REVIEW / REJECTED อยู่ในผลคำนวณและ Excel
- **ค่าสเปกที่หาย** (`undefined`/`null`) ในฟิลด์ที่ engine ใช้แทนด้วยค่ามาตรฐาน → flag `SPEC_VALUE_MISSING` (warn) ระบุชื่อ field และใน snapshot เป็น `null` ไม่ใช่ค่ามาตรฐาน
- **ประวัติ:** แต่ละรายการเพิ่ม `fingerprintBefore`/`fingerprintAfter`, การอ้างชิ้นด้วย `itemId + tag + grid + level` (นอกจาก index) และไฟล์แบบ; ชื่อผู้ตรวจยังระบุว่า "ไม่ได้ยืนยันตัวตน"
- **Excel แผ่น 7:** คอลัมน์ สถานะการอนุมัติ, fingerprint (16 ตัวแรก + ตัวเต็ม), engine version, ไฟล์แบบ, ยอดตอนอนุมัติเทียบกับยอดปัจจุบัน และ field ที่ทำให้ STALE
- **`valuesKey`/`coverM` เดิม:** ถูกแทนด้วย snapshot (ลบโค้ดเดิม ไม่ซ้อนสองกลไก)

## 5. ไฟล์ที่จะแก้
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/engine/qsEngine.ts` | snapshot, stable stringify, sha256, `CALC_ENGINE_VERSION`, approvalState, `SPEC_VALUE_MISSING`, `computeProject`/`calculateMember` รับ `{ drawing }` |
| `src/App.tsx` | ส่ง drawing ให้ compute, ประทับ snapshot/quantities ตอนอนุมัติ, fingerprint ในประวัติ |
| `src/engine/reviewLog.ts` | field ใหม่ในรายการประวัติ |
| `src/export/excelWorkbook.ts` | แผ่น 7–8 |
| `src/components/ReviewWorkspace.tsx` | แสดงสถานะ STALE + field ที่เปลี่ยน (ใช้รายการ flag เดิม) |
| `releaseGate.test.ts`, `rebarSet.test.ts`, `pipeline.test.ts` | เทสต์ที่สร้าง approval ด้วย `approvalFor(m)` ต้องส่ง specs/drawing ให้ตรงกับที่ใช้คำนวณ (ตรวจอนุมัติแบบเดิมทุกจุด ไม่ลดความเข้ม) |
| เทสต์ใหม่ | ข้อ 1–16 ของโจทย์ |

**ไม่แก้สูตร** — ยกเว้นการเพิ่ม flag เมื่อสเปกหาย ซึ่งไม่เปลี่ยนตัวเลข

## 6. ความเสี่ยง
- approval ที่บันทึกไว้ทั้งหมดต้องอนุมัติใหม่ครั้งเดียวหลังอัปเดต (ข้อ 3.2)
- แก้สเปกใดก็ตามทำให้ approval ทั้งโครงการหลุด (ข้อ 3.1 แบบทั้งก้อน)
- การเพิ่มเลขเวอร์ชัน engine เป็นงานด้วยมือ ถ้าลืมเพิ่ม approval จะไม่หลุดเมื่อสูตรเปลี่ยน
- ขนาดข้อมูลใน localStorage เพิ่มขึ้นประมาณ 1–2 KB ต่อชิ้นที่อนุมัติ

## สถานะตอน audit (ก่อนแก้ — ดูสถานะสุดท้ายท้ายรายงาน)
**PARTIALLY IMPLEMENTED (audit + design เท่านั้น)**

ระดับความปลอดภัยตอนนี้ (ก่อนแก้):

| การใช้งาน | ผล |
|---|---|
| Internal testing | ได้ |
| Supervised pilot | ได้ **แต่ห้ามแก้สเปกโครงการหลังเริ่มอนุมัติ** และต้องอนุมัติใหม่เมื่ออัปเดตโปรแกรมหรือเปลี่ยนไฟล์แบบ |
| Unsupervised BOQ production | **ไม่ได้** |

---

# ผลการแก้ไข (Phase 2–7) — 2026-11-03

ผู้ใช้อนุมัติแบบตามหัวข้อ 4 พร้อมการตัดสินใจทั้ง 4 ข้อในหัวข้อ 3 ("Yes, build it"):
1. สเปกเข้า snapshot ทั้งก้อน ยกเว้น `sourceText`
2. approval ก่อน Round 20 เป็น STALE ทั้งหมด
3. `CALC_ENGINE_VERSION` เพิ่มเลขเองเมื่อแก้สูตร
4. SHA-256 ของไฟล์แบบอยู่ใน snapshot

## 7. สิ่งที่แก้
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `src/engine/qsEngine.ts` | `CALC_ENGINE_VERSION = '20.0'`, `CalcSnapshot`, `stableStringify`, `sha256Hex` (sync), `calcSnapshot`, `fingerprintOf`, `snapshotDiff`; `approvalFor(m, note, specs, drawing)` เก็บ snapshot + fingerprint + ยอดตอนอนุมัติ; `calculateMember`/`computeProject` รับ `drawing`; ผลคำนวณมี `approvalState`, `staleApproval`, `staleChanges`; flag `SPEC_VALUE_MISSING` (warn); ลบ `approvalKey`, `valuesKey`, `coverM` เดิม |
| `src/App.tsx` | SHA-256 เต็มของไฟล์ (`DrawingRef`) ส่งให้ทุกการคำนวณ; ประทับ approval ด้วยสเปกและไฟล์ที่ใช้จริง; ประวัติเก็บ fingerprint ก่อน/หลัง และอ้างชิ้นด้วยรหัส + เบอร์ + กริด + ชั้น |
| `src/engine/reviewLog.ts` | field ใหม่ในรายการประวัติ; อนุมัติซ้ำหลัง STALE นับเป็นการตัดสินใหม่ (เดิมไม่ถูกบันทึก — พบระหว่างทดสอบในเบราว์เซอร์) |
| `src/export/excelWorkbook.ts` | แผ่น 7: สถานะการอนุมัติ, fingerprint เต็ม, engine ตอนอนุมัติ, ยอดตอนอนุมัติเทียบยอดปัจจุบัน, ค่าที่เปลี่ยนหลังอนุมัติ, engine ในหัวแผ่น; แผ่น 8: ชิ้น (รหัส เบอร์ @กริด ชั้น), fingerprint ก่อน/หลัง |
| `src/components/ReviewWorkspace.tsx` | แสดง fingerprint 12 ตัวแรกบนป้ายอนุมัติ; กล่อง "อนุมัติหมดอายุ" พร้อมรายการค่าที่เปลี่ยน |
| เทสต์ | `approvalSnapshot.test.ts` ใหม่ (ข้อ 1–16), เทสต์ใน `reviewLog.test.ts` 1 ข้อ; แก้ `rebarSet.test.ts` / `releaseGate.test.ts` ให้อนุมัติด้วยสเปกเดียวกับที่ใช้คำนวณ (ไม่ลดความเข้มของ assertion ใด) |

**ไม่แก้สูตร** — ปริมาณทุกตัวเท่าเดิม (parity identical) ค่าสเปกที่หายยังใช้ค่ามาตรฐานเท่าเดิม แต่มี flag และใน snapshot เป็น `null`

## 8. กลไกหลังแก้
- **ตอนอนุมัติ:** App เรียก `approvalFor(member, note, สเปกปัจจุบัน, ไฟล์แบบ)` → snapshot (ค่าบนชิ้น, ระยะหุ้มที่ resolve + ที่มา, รูปงอ + ที่มา, สเปกทั้งก้อน, ไฟล์ + SHA-256, เวอร์ชัน engine) → SHA-256 ของ stable JSON → เก็บพร้อมยอดตอนอนุมัติ ผู้ตรวจ และ revision
- **ทุกครั้งที่คำนวณ:** สร้าง snapshot ปัจจุบันแล้วเทียบ
  - ไม่มี snapshot (ก่อน Round 20) → STALE
  - snapshot ที่เก็บไม่ตรงกับ fingerprint ของมันเอง (ถูกแก้ใน localStorage) → STALE
  - fingerprint ไม่ตรง → STALE + รายการ field เช่น `specs.concreteWastagePct: 5 → 7`
  - STALE = approval ถูกถอด สถานะ NEEDS_REVIEW, flag `APPROVAL_STALE` (warn)
- **`approvalState`:** APPROVED (fingerprint ตรงและปล่อยยอด) / STALE / NEEDS_REVIEW / REJECTED / ว่าง (ปล่อยได้เองโดยไม่ต้องตัดสิน)
- **ไม่อยู่ใน snapshot (ตั้งใจ):** `review` (โน้ต เวลา ผู้ตรวจ) และ `provenance` ยกเว้นผลของ provenance ต่อที่มาระยะหุ้ม

## 9. ผลเทสต์ (วัดจริง)
- `npm test`: **39/39 + 138/138 ผ่าน** (เดิม 38 + 122; เพิ่ม 16 + 1)
- `tsc --noEmit` ผ่าน, `npm run build` ผ่าน
- เทสต์ข้อ 1–16 (`src/engine/approvalSnapshot.test.ts`):

| # | ตรวจอะไร | ผล |
|---|---|---|
| 1 | SHA-256: vector `"abc"`, `""` และเทียบ `node:crypto` (ไทย, ความยาวขอบ block 55/56/64, 1000) | ผ่าน |
| 2 | stable JSON: ลำดับ key ไม่มีผล, ตัด undefined, เก็บ null | ผ่าน |
| 3 | input เดียวกัน → fingerprint เดียวกัน (เวลา/โน้ต/ลำดับ key ไม่มีผล) | ผ่าน |
| 4 | ไม่เปลี่ยนอะไร → APPROVED และยอดตอนอนุมัติ = ยอดปัจจุบัน | ผ่าน |
| 5 | แก้ค่าบนชิ้น (กว้าง, จำนวน) → STALE ระบุ field | ผ่าน |
| 6 | รูปงอค่าเริ่มต้นของโครงการ → STALE (ทั้งชิ้นที่ใช้ค่าสเปกและชิ้นที่มีรูปงอของตัวเอง ตามข้อ 3.1) | ผ่าน |
| 7 | ความหนาคอนกรีตหยาบ → STALE | ผ่าน |
| 8 | ระยะเผื่อขุด → STALE | ผ่าน |
| 9 | % เผื่อเสีย, ราคา → STALE | ผ่าน |
| 10 | ระยะหุ้มในสเปก → STALE (5 → 7.5 ซม.) | ผ่าน |
| 11 | ไฟล์แบบ hash อื่น / ไม่มีไฟล์ → STALE; ไฟล์เดิม → APPROVED; ตัวอย่างที่ไม่มีไฟล์อนุมัติได้ | ผ่าน |
| 12 | engine version ต่าง (19.1 → 20.0) → STALE | ผ่าน |
| 13 | approval ก่อน Round 20 (`valuesKey`/`coverM`) → STALE | ผ่าน |
| 14 | snapshot ถูกแก้หลังอนุมัติ (ไม่ตรง fingerprint) → STALE | ผ่าน |
| 15 | provenance / โน้ตเปลี่ยน → ยัง APPROVED; ไม่นับ → REJECTED | ผ่าน |
| 16 | สเปกหาย → `SPEC_VALUE_MISSING` + null ใน snapshot (ยอดไม่เปลี่ยน); `computeProject` ส่งสถานะ; Excel แผ่น 7 แสดงสถานะ, fingerprint, ค่าที่เปลี่ยน, ยอดตอนอนุมัติ | ผ่าน |

## 10. ตรวจในเบราว์เซอร์ (dev server, ตัวอย่าง Bangkok Innovation Hub, ฐานราก F1)
1. กรอกชื่อผู้ตรวจ → อนุมัติ F1 → ป้าย "อนุมัติแล้ว #bb8d39758e65" — `tools/artifacts/round20/01_approved_fingerprint.jpg`
2. แก้สเปก % เผื่อเสียคอนกรีต 5 → 7 → F1 กลับเป็นรอตรวจ กล่อง "อนุมัติหมดอายุ (เดิมโดย QS ทดสอบ R20)" แสดง `specs.concreteWastagePct: 5 → 7` — `tools/artifacts/round20/02_stale_after_spec_change.jpg`
3. อนุมัติใหม่ → Excel (ดึง blob ในหน้า ไม่ได้ดาวน์โหลด):
   - แผ่น 7: "อนุมัติ (fingerprint ตรง)", fingerprint `2dabd252…`, engine 20.0, ยอดตอนอนุมัติ = ยอดปัจจุบัน (คอนกรีต 3.15 ลบ.ม. · เหล็ก 239.86 กก. · 26,084.91 บาท), หัวแผ่นมี engine 20.0
   - แผ่น 8: 2 แถวตัดสิน อ้าง `QS-F-001 F1 @Grid 1-2 / A-B Foundation Level` fingerprint `bb8d…` และ `2dab…`
4. reload แล้วทำซ้ำ → fingerprint เดิมทุกตัว (deterministic)
5. console ไม่มี error
- **พบและแก้ระหว่างทดสอบ:** ครั้งแรกการอนุมัติใหม่หลัง STALE ไม่ถูกบันทึกในประวัติ (สถานะเดิมยังเป็น approved) — แก้ใน `logEntryFor` + เทสต์

## 11. Regression (วัดจริง)
- Benchmark probe (`bench.ts`, 3 ชุดจริง 28 รายการ): **auto 0/28, false release 0** — เท่าเดิม
- Parity (`tools/test_parity_round14.ts`): **identical** กับผลก่อนแก้ (`parity191.txt`)
- ไม่ได้รัน `check:full` (ตามกฎ ไม่ตั้ง `FULL_BOQ`)

## 12. ข้อจำกัดที่ยังอยู่
- **Fingerprint ไม่ใช่ลายเซ็น:** SHA-256 ไม่มีกุญแจ คนที่แก้ localStorage แล้วคำนวณ fingerprint ใหม่ให้ตรงได้จะผ่าน ป้องกันได้เฉพาะการเปลี่ยนโดยไม่ตั้งใจและการแก้ครึ่งเดียว
- **ชื่อผู้ตรวจ:** ยังเป็นชื่อที่พิมพ์ ไม่ได้ยืนยันตัวตน
- **เวอร์ชัน engine:** ต้องเพิ่มเลขเองเมื่อแก้สูตร เทสต์บังคับไม่ได้
- **การแก้สเปกไม่ถูกบันทึกเป็นรายการในประวัติ:** ผลของมันเห็นได้ (ทุก approval ที่กระทบเป็น STALE พร้อมชื่อ field) แต่ไม่มีแถว "แก้สเปก" ในแผ่น 8
- **ไม่มี hash ของไฟล์:** ตัวอย่าง/ชุดข้อมูล (`drawing: null`) และเบราว์เซอร์ที่ไม่อนุญาต `crypto.subtle` (http ที่ไม่ใช่ localhost → `sha256: null`) — approval ผูกกับชื่อไฟล์เท่านั้น
- **แก้สเปกใดก็ทำให้ approval ทั้งโครงการหลุด** (ข้อ 3.1 — ตั้งใจ)
- **approval ที่บันทึกในเบราว์เซอร์ก่อน Round 20** ต้องอนุมัติใหม่หนึ่งครั้ง (ข้อ 3.2 — ตั้งใจ)
- ไม่ได้ทำ conflict resolution (ตามโจทย์)

## สถานะสุดท้าย
**IMPLEMENTED** — approval ผูกกับทุก input ของการคำนวณ ทดสอบแล้วทั้ง unit, เบราว์เซอร์ และ Excel ไม่มี regression

| การใช้งาน | ผล |
|---|---|
| Internal testing | ได้ |
| Supervised pilot | ได้ — แก้สเปก อัปเดตโปรแกรม หรือเปลี่ยนไฟล์แบบหลังอนุมัติแล้ว ระบบถอด approval ที่กระทบเองพร้อมบอกค่าที่เปลี่ยน (ยังต้องมี QS ตรวจทุกรายการที่รอตรวจ) |
| Unsupervised BOQ production | **ไม่ได้** — เทสต์ผ่านไม่ได้แปลว่าพร้อมใช้งานจริง: benchmark จริงยังไม่มีรายการปล่อยเองได้ (0/28 auto), ผู้ตรวจไม่ยืนยันตัวตน, fingerprint ไม่ใช่ลายเซ็น |
