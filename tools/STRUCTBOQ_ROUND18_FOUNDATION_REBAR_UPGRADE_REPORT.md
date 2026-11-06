# StructBOQ Round 18 — Foundation Rebar Upgrade (Phase 0 Audit + ข้อเสนอสถาปัตยกรรม)

**วันที่:** 2026-11-03 · **สถานะ:** Phase 0 เสร็จ — **หยุดก่อน implement** เพราะ Multiple Rebar Sets, field-level approval และ stable member ID เป็นการเปลี่ยนโครงสร้างข้อมูล (ตามเงื่อนไข "If a major architectural change is required, stop and report")
**ไม่มีการแก้ซอร์สโค้ดในรอบนี้** · ไม่ commit · คู่กับ `tools/STRUCTBOQ_ROUND18_APPROVAL_SAFETY_AUDIT.md`

Baseline ก่อนเริ่ม: `npm test` **147/147** (38 + 109), `npx tsc --noEmit` ผ่าน, `npm run build` ผ่าน (1.26 s)

---

## 1. สถาปัตยกรรมปัจจุบัน (จากการค้น symbol เฉพาะจุด)

| # | ส่วน | ที่อยู่ | สภาพ |
|---|---|---|---|
| 1 | ฟอร์มฐานราก | ไม่มีฟอร์มเฉพาะ — ใช้ฟอร์มทั่วไป: `ManualCalculator.tsx` (กว้าง/ลึก/ยาว + เหล็กบน/ล่าง/ปลอก เป็นข้อความ), `ReviewWorkspace.tsx` FIELDS.FOOTING, `SectionTable.tsx` FIELDS.FOOTING (กว้าง, ยาว, หนา, ตะแกรงล่าง) | ไม่มีช่อง cover, lean, ชนิดฐาน, รูปงอ ในฟอร์ม |
| 2 | Data model | `ExtractedMember` (`qsEngine.ts:105-139`): `width`, `depth`, `length` (= หนา สำหรับฐานราก), `count`, `bottomRebar?: string`, `topRebar?`, `footingType`, `footingHookShape`, `coveringCm`, `excavationDepthM`, `sandThicknessM`, pile fields, `provenance`, `review` | เหล็กเป็น **ข้อความเดียว**; ไม่มีค่า OCR เดิมแยกจากค่าแก้ (มีเพียง `rawDimensionStr` + log `before`) |
| 3 | RebarSet model | **ไม่มี** — มี `BarGroup {n, bar}` (`qsEngine.ts:586`) จาก `parseBarGroups` และ `parseSpacedBar` | — |
| 4 | Footing engine | `calculateMember` สาขา FOOTING (`qsEngine.ts:~1270-1290`): ปริมาตร, ไม้แบบ, lean `(w+0.20)(d+0.20)·leanT`, ทราย, ขุดดิน | lean margin 0.10 ม./ด้าน และ leanT จากสเปก (ค่าเริ่มต้น 0.05) |
| 5 | Rebar engine | `computeDetailedRebar` สาขา FOOTING (`qsEngine.ts:722-791`) → `barList` 2 แถว (X, Y) | ดูข้อบกพร่องหัวข้อ 2 |
| 6 | Provenance | `fieldSources` ต่อฟิลด์ (`width/depth/length/rebar/support/...`), `evidence[]`, `confidence`, `conflicts[]` (ข้อความ) | ไม่มี source ต่อชุดเหล็ก; conflict เป็นข้อความ ไม่มีค่าทางเลือก |
| 7 | Required fields | `CRITICAL_FIELDS.FOOTING` = กว้าง, ยาว, หนา; `unconfirmedRequiredFields()` (R17.2) | เหล็ก/cover ไม่ใช่ required |
| 8 | Approval | `review {status, note, at, valuesKey}` ระดับ member; `approvalFor`, `APPROVAL_STALE` (R17.2) | ไม่มีระดับฟิลด์ |
| 9 | Release gate | `calculateMember` `qsEngine.ts:~1470-1490` | approval ข้าม warn ทุกชนิด |
| 10 | Audit trail | `reviewLog.ts` (`changes`, `before`, `indices`) ใน `localStorage` | อ้าง index; ไม่มีผู้อนุมัติ/revision |
| 11 | Export | `excelWorkbook.ts`: แผ่น BBS จาก `rebarDetails.barList` (ข้าม REJECTED), คอลัมน์ provenance/สถานะ, log; `OfficialReportModal.tsx` แบนเนอร์ provisional | ไม่มีคอลัมน์ชุดเหล็ก/ทิศ/ที่มาต่อชุด |
| 12 | Tests | `qsEngine.test.ts`, `pipeline.test.ts`, `releaseGate.test.ts`, `reviewLog.test.ts`, `benchmark.test.ts` — ไม่มีเทสต์ React/เบราว์เซอร์อัตโนมัติ | — |

## 2. พฤติกรรมเหล็กฐานรากปัจจุบัน (probe จริง, ฐาน 0.90×0.90×0.30 ม., มิติจากแบบ)

| อินพุต | สถานะ | เหล็ก (กก.) | ระบบคิด | flags |
|---|---|---|---|---|
| ไม่ระบุเหล็ก | **AUTO_RELEASE** | 12.79 | 6×DB12 L1.20 ×2 ทิศ (DB12@0.15 + งอตั้ง ที่ระบบสร้างเอง) | info เท่านั้น |
| `3-DB12 + 3-DB12` | NEEDS_REVIEW* | 4.26 | 3 X + 3 Y (สมมติว่ากลุ่มแรก = X) | STEEL_RATIO:warn |
| `5-DB12 + 5-DB16` | **AUTO_RELEASE** | 7.10 | **5×DB12 + 5×DB12 — DB16 หายไป** | — |
| `4-DB12` (กลุ่มเดียว) | NEEDS_REVIEW* | 5.68 | สมมติ 4 เส้นทั้ง 2 ทิศ (ไม่มี flag ทิศ) | STEEL_RATIO:warn |
| `DB12@0.40` | NEEDS_REVIEW* | 4.26 | `Math.max(3, …)` บังคับขั้นต่ำ 3 เส้น | STEEL_RATIO:warn |
| `3-DB12+3-DB12+2-DB16` | NEEDS_REVIEW* | 4.26 | **กลุ่มที่ 3 ถูกทิ้งเงียบ** | STEEL_RATIO:warn |
| ไม่ระบุรูปงอ | **AUTO_RELEASE** | 6.39 | งอตั้งเต็มความหนา (ค่าเริ่มต้นสเปก) +50% เทียบเหล็กตรง | FOOTING_HOOK_ASSUMED:info |

\* NEEDS_REVIEW เพราะ STEEL_RATIO ต่ำ (เหตุบังเอิญ) ไม่ใช่เพราะระบบรู้ว่าอ่านเหล็กไม่ครบ

### ข้อบกพร่องที่มีหลักฐาน (ต้องแก้สูตรพร้อมเทสต์)
- **D1 (สูตร):** ตะแกรงคนละขนาดใน 2 ทิศ (`5-DB12 + 5-DB16`) คิดเป็นขนาดแรกทั้งสองทิศ → เหล็กขาด และปล่อยอัตโนมัติ (`qsEngine.ts:731-734` ใช้ `groups[0].bar`)
- **D2 (สูตร):** กลุ่มเหล็กเกิน 2 กลุ่มถูกทิ้งโดยไม่มี flag
- **D3 (clamping):** `Math.max(3, …)` ในเหล็กตามระยะห่าง (`:742-743, 747-748`) และ `Math.max(0.10, …)` ในความยาวงอ (`:765, 768, 778`) — ขัดข้อห้าม silent clamping
- **D4 (สมมติฐานซ่อน):** กลุ่มเดียว → สมมติเท่ากันสองทิศ; สองกลุ่ม → สมมติลำดับ X/Y — ไม่มี flag ทิศ
- **G1/G2/G3:** ช่องโหว่ gate (ดู approval safety audit)

## 3. สิ่งที่ขาดเทียบโจทย์

| Phase | ขาด |
|---|---|
| 1 เรขาคณิต | ฟอร์มฐานรากเฉพาะ (หน่วย, cover มม., lean, ชนิดฐาน); เก็บค่า OCR เดิมแยกจากค่าแก้; **ค่าขัดแย้งแบบมีทางเลือก** (เช่น หนา 0.30 จากชื่อ vs 0.20 จากรูปตัด) — ปัจจุบันเป็นข้อความ `conflicts[]` และ reader เลือกค่าเดียวไปแล้ว |
| 2 ชุดเหล็ก | โครงสร้าง RebarSet ทั้งหมด (ทิศ, ชั้น, รูปร่าง, งอต้น/ปลาย, ความยาวตัด, ที่มา, สถานะ) และ UI การ์ด เพิ่ม/ลบ/แก้/ทำซ้ำ |
| 3 Validation | ทิศ UNSPECIFIED, จำนวนเส้นเทียบช่วงจริง, งอ/ความยาวตัด, cover ทางตั้ง (หนา − 2·cover) |
| 4 BOQ | ปริมาณ/น้ำหนักต่อชุด + trace ไปยัง Set ID |
| 6 Approval | field-level, คลาส A/B/C, stable ID, ผู้อนุมัติ, revision |
| 8 Export | แผ่นชุดเหล็ก, revision, ผู้อนุมัติ |

## 4. ข้อเสนอสถาปัตยกรรม (เล็กที่สุดที่ปลอดภัย — รออนุมัติ)

### 4.1 RebarSet (Phase 2–4)
```ts
interface RebarSet {
  id: string;                         // คงที่ต่อชุด (สร้างตอนเพิ่ม/อ่าน)
  barType: 'RB' | 'DB'; diameterMm: number;
  mode: 'COUNT' | 'SPACING'; count?: number; spacingM?: number;   // ห้ามแปลงกันเอง
  direction: 'X' | 'Y' | 'BOTH' | 'UNSPECIFIED';
  layer: 'BOTTOM' | 'TOP';
  shape: 'STRAIGHT' | 'HOOK_90' | 'UPTURN' | 'UNSPECIFIED';
  hookStartM?: number; hookEndM?: number; cutLengthM?: number;    // undefined = ไม่ทราบ ไม่ใช่ 0
  sourceText?: string;                // ข้อความเดิมจากแบบ
  source: FieldSource;                // drawing / reviewer / assumed / ...
}
// ExtractedMember: rebarSets?: RebarSet[]
```
- **ความเข้ากันได้ย้อนหลัง:** ถ้าไม่มี `rebarSets` engine แปลง `bottomRebar` เดิมเป็นชุดผ่านฟังก์ชันเดียว (`footingRebarSets`) — กลุ่มเดียว → ทิศ `BOTH` + flag สมมติ, สองกลุ่ม → ทิศ `UNSPECIFIED` เว้นแต่ข้อความระบุทิศ, เกินสองกลุ่ม → ทุกกลุ่มเป็นชุด ไม่ทิ้ง
- **ผลต่อสูตร:** ค่าที่ถูกต้องอยู่แล้ว (กลุ่มเดียว/สองกลุ่มขนาดเดียวกัน, ระยะห่าง) ให้ตัวเลขเดิม; เปลี่ยนเฉพาะ D1, D2, D3 — แต่ละข้อมีเทสต์ที่ล้มก่อนแก้
- ทิศ `UNSPECIFIED`, รูปร่าง `UNSPECIFIED`, ความยาวงอไม่ทราบ → `warn`/คลาส B → NEEDS_REVIEW (ไม่ใช้ 12d/งอเต็มความหนาเป็นค่าสากล เว้นแต่ผู้ใช้เลือกเป็น "สมมติฐาน" โดยชัดแจ้ง ซึ่งติดป้าย ENGINEERING_ASSUMPTION)
- `approvalKey` ครอบ `rebarSets` อัตโนมัติ → แก้ชุดเหล็กแล้ว approval หลุด

### 4.2 ค่าขัดแย้ง (Phase 1)
`provenance.candidates?: Record<field, { value: number; source: string }[]>` — reader เก็บทุกค่าที่พบ (เช่น หนา 0.30 จากชื่อ, 0.20 จากรูปตัด) และตั้ง `fieldSources[field] = 'conflict'`*; engine ถือเป็นคลาส B จนกว่าผู้ตรวจเลือกค่า (→ `reviewer`) — ต้องแก้ reader (`sheetMerge`/`sheetReader`) ให้ส่งค่าทางเลือก ซึ่งกระทบความแม่นยำการอ่าน → ต้องรัน `check:full` บนสำเนา
\* หรือคง `FieldSource` เดิมและใช้ `candidates.length > 1` เป็นเงื่อนไข — เลือกแบบหลังเพื่อไม่เปลี่ยนความหมาย provenance

### 4.3 Approval (Phase 6)
1. **คลาส A/B/C ใน engine:** block → C (มีอยู่); เพิ่ม G3 เป็น block; คลาส B = flag ที่ผูกกับฟิลด์ required/ชุดเหล็ก (FIELD_VALUE_UNSOURCED, FIELD_ASSUMED/INFERRED ของ required, REBAR_DEFAULTED, CONFLICT, ทิศ UNSPECIFIED) — approval ระดับชิ้นไม่ข้าม B; คลาส A = ที่เหลือ ข้ามได้ด้วย approval ที่มี `note` (เหตุผล) บังคับ
2. **Field-level:** ยืนยันฟิลด์ = `fieldSources[f] = 'reviewer'` (มีอยู่) + เก็บค่าที่ยืนยันใน `review.fields?: Record<f, {value, at}>`; แก้ฟิลด์ → ลบเฉพาะรายการของฟิลด์นั้น
3. **Stable member ID:** `memberId` กำหนดตอนอ่าน (`type:tag@grid#n` ตามลำดับที่พบภายใน tag+grid) และตอนเพิ่มเอง (สุ่มครั้งเดียว) เก็บบน member; log อ้าง `memberId` แทน index (log เก่า: fallback index พร้อมป้าย "อ้างตำแหน่ง")
4. **ผู้อนุมัติ + revision:** ชื่อผู้ตรวจระดับโครงการ (กรอกเอง — ระบุไว้ชัดว่า "ไม่ได้ยืนยันตัวตน"), revision = ชื่อไฟล์ + SHA-256 ของไฟล์ (Web Crypto) เก็บใน `audit` และในทุก approval
5. **Export:** แผ่น "ชุดเหล็ก" (memberId, setId, ขนาด, จำนวน/ระยะ, ทิศ, ชั้น, รูปร่าง, ความยาวตัด, น้ำหนัก, ที่มา, สถานะ), revision, ผู้อนุมัติ; BBS คงคำเตือน "ห้ามใช้สั่งตัดเหล็ก" เดิม

### 4.4 แก้เฉพาะจุดที่ไม่ต้องเปลี่ยนโครงสร้าง (ทำก่อนได้ทันทีถ้าอนุมัติ)
G1 (`REBAR_RATIO_ASSUMED`/`REBAR_CODE_MINIMUM` → warn), G2 (`FOOTING_HOOK_ASSUMED` → warn), G3 (`COVER_INVALID` → block), D1 (ขนาดต่อทิศ), D2 (ไม่ทิ้งกลุ่ม → block "อ่านเหล็กไม่ครบ" จนกว่าจะมี RebarSet) — ทุกข้อเข้มขึ้นหรือแก้สูตรที่มีหลักฐาน พร้อมเทสต์

## 5. ไฟล์ที่ต้องแก้ (ถ้าอนุมัติทั้งหมด)

`src/engine/qsEngine.ts` (model, footing rebar, gate คลาส A/B/C), `src/engine/reviewLog.ts` (memberId), `src/App.tsx` (revision hash, ชื่อผู้ตรวจ), `src/components/ReviewWorkspace.tsx` + ฟอร์มฐานรากใหม่ 1 ไฟล์ (การ์ดชุดเหล็ก, สาเหตุที่ยังรอ), `src/components/SectionTable.tsx` (แสดงเหล็กเป็นชุด), `src/export/excelWorkbook.ts`, `src/engine/sheetMerge.ts` (candidates + memberId), เทสต์ 4 ไฟล์ + เทสต์ใหม่

## 6. ความเสี่ยง

| ประเภท | ความเสี่ยง |
|---|---|
| Data migration | โครงการ/รีวิวที่บันทึกใน `localStorage` ไม่มี `rebarSets`/`memberId` → ต้อง fallback; approval เดิมจะหลุด (`valuesKey` เปลี่ยนเมื่อเพิ่มฟิลด์) — ผู้ใช้ต้องอนุมัติใหม่ |
| Formula compatibility | D1/D2/D3 เปลี่ยนตัวเลข (ตั้งใจ); benchmark 22 รายการต้องเทียบก่อน/หลัง — ฐานรากใน benchmark ใช้กลุ่มขนาดเดียว จึงคาดว่าไม่เปลี่ยน (ต้องยืนยันด้วยการรัน) |
| Reader | การเก็บค่าทางเลือกต้องแก้ reader → ต้อง `check:full` บนสำเนา (ห้ามรันในที่) |
| Approval integrity | คลาส B ทำให้รายการที่เคยอนุมัติได้ต้องแก้ระดับฟิลด์ก่อน → งาน QS เพิ่มขึ้น (ตั้งใจ) |
| ขอบเขต | Phase 1–11 ทั้งหมดเป็นงานหลายรอบ — เสนอแบ่ง: 18a (4.4 เฉพาะจุด) → 18b (RebarSet + ฟอร์ม + export) → 18c (คลาส A/B/C + field-level) → 18d (memberId + ผู้อนุมัติ + revision) |

## 7. การตัดสิน

- **FOUNDATION IMPLEMENTATION: BLOCKED** — รออนุมัติโครงสร้าง RebarSet / candidates (หัวข้อ 4) ก่อน implement; ไม่มีโค้ดใหม่ในรอบนี้
- **APPROVAL SAFETY: APPROVAL NOT SAFE** — ดู `STRUCTBOQ_ROUND18_APPROVAL_SAFETY_AUDIT.md` (G1–G4)

ไม่ได้ทำ: Phase 1–11 (implementation, browser verification, benchmark ใหม่) — ไม่มี screenshot และไม่มี migration notes เพราะไม่มีการเปลี่ยน schema; ไม่ได้เปิดแบบจริง

---

## 8. Round 18a — แก้เฉพาะจุด (2026-11-03, หลังผู้ใช้อนุมัติ)

ไม่เปลี่ยน schema · ไม่แตะ ground truth · ทุกข้อเข้มขึ้น หรือแก้สูตรที่มีหลักฐานพร้อมเทสต์ที่ล้มก่อนแก้

| # | แก้ที่ (`src/engine/qsEngine.ts`) | ก่อน | หลัง |
|---|---|---|---|
| G1 | `REBAR_CODE_MINIMUM`, `REBAR_RATIO_ASSUMED` | info → ปล่อยเหล็กที่ระบบสร้างเองอัตโนมัติ | **warn** → NEEDS_REVIEW (QS อนุมัติได้ = คลาส A) |
| G2 | `FOOTING_HOOK_ASSUMED` | info เฉพาะค่าเริ่มต้น FULL_UPTURN | **warn** ทุกกรณีที่แบบไม่ระบุรูปงอแล้วใช้ค่าจากสเปก (รวม STANDARD_HOOK/STRAIGHT ในสเปก) |
| G3 | `COVER_INVALID` (cover นอกช่วง 0–20 ซม. → ระบบแทนด้วยค่ามาตรฐาน) | warn → อนุมัติได้ | **block** → อนุมัติไม่ได้ (คลาส C) |
| D1 | ตะแกรงฐานราก 2 กลุ่มคนละขนาด | ใช้ขนาดกลุ่มแรกทั้งสองทิศ | แต่ละทิศใช้ขนาดของตัวเอง (และขอ 12d ตามขนาดนั้น) |
| D2 | เหล็กฐานรากเกิน 2 กลุ่ม | กลุ่มที่ 3+ ถูกทิ้งเงียบ | **block** `REBAR_GROUPS_UNREAD` ไม่คำนวณเหล็กจนกว่าจะแยกทิศให้ชัด |

**การเปลี่ยนสูตร:** เฉพาะ D1 (`5-DB12 + 5-DB16`: 7.10 → **9.86 กก.**, ทิศ Y เป็น DB16 ตามแบบ) — กรณีขนาดเดียวกันให้ตัวเลขเดิมทุกหลัก

### Probe หลังแก้ (ฐาน 0.90×0.90×0.30 ม.)

| อินพุต | ก่อน | หลัง |
|---|---|---|
| ไม่ระบุเหล็ก | AUTO_RELEASE 12.79 | NEEDS_REVIEW 12.79 (REBAR_RATIO_ASSUMED, FOOTING_HOOK_ASSUMED: warn) |
| `5-DB12 + 5-DB16` | AUTO_RELEASE 7.10 (DB16 หาย) | AUTO_RELEASE **9.86** (5×DB12 + 5×DB16) |
| `3-DB12+3-DB12+2-DB16` | NEEDS_REVIEW 4.26 (ทิ้งกลุ่ม) | NEEDS_REVIEW 0 + **block** REBAR_GROUPS_UNREAD |
| ไม่ระบุรูปงอ | AUTO_RELEASE 6.39 | NEEDS_REVIEW 6.39 (warn) |
| cover 60 ซม. + อนุมัติ | AUTO_RELEASE | NEEDS_REVIEW (block) |

### เทสต์
- ใหม่: `releaseGate.test.ts` "Round 18a: footing rebar the drawing did not give is never released unreviewed, and every bar group is counted" — ล้มก่อนแก้ (ยืนยันแล้ว: AUTO_RELEASE แทน NEEDS_REVIEW) ผ่านหลังแก้
- ปรับ 7 assertion ใน `qsEngine.test.ts` (6 เทสต์สูตร: คานพื้นฐาน, หักเสา, ตรวจซ้ำ, ฐานราก lean/ทราย/ขุด, พื้น+บันได, Factor F) — สมาชิกในเทสต์ **ไม่มีเหล็ก/รูปงอในข้อมูล** จึงต้อง NEEDS_REVIEW ตามกฎ G1/G2; เปลี่ยนเฉพาะสถานะ/ตัวนับ พร้อม assert เหตุผล (flag) — ค่าปริมาตร/ไม้แบบ/ต้นทุนที่ assert ไม่เปลี่ยน

| ตรวจ | ผล |
|---|---|
| `npm test` | **148/148** (38 + 110) — ก่อนแก้ 147/147; ไม่มีเทสต์เดิมล้มที่ไม่ได้ปรับตามเหตุผลข้างบน |
| `npx tsc --noEmit` / `npm run build` | ผ่าน / ผ่าน (1.52 s) |
| Benchmark 5 ชุด | 0 AUTO_RELEASE / 28 NEEDS_REVIEW / 0 false release (เหมือนก่อน — ชุดข้อมูลไม่มี source record) |
| Parity 22 member / ปริมาณเทียบ Round 16 | ต่าง 0 / ต่าง 0 (ฐานรากใน benchmark ใช้ขนาดเดียว จึงไม่กระทบจาก D1) |
| เบราว์เซอร์ | **ไม่ได้ตรวจ** — โครงการตัวอย่างไม่มีฐานรากที่มีเหล็ก และไม่ได้เปิดชุดแบบจริง; ตรวจด้วย unit test + probe เท่านั้น |

### ยังไม่แก้ (อยู่ใน 18b–18d)
- `5-DB12 + 5-DB16` ยังปล่อยอัตโนมัติโดย**สมมติว่ากลุ่มแรก = ทิศ X** (D4: ไม่มี flag ทิศ) — ต้องใช้ RebarSet `direction`
- กลุ่มเดียว (`4-DB12`) ยังสมมติเท่ากันสองทิศโดยไม่มี flag (D4)
- `Math.max(3, …)` และ `Math.max(0.10, …)` (D3) ยังอยู่
- **cover เทียบความหนา:** cover 20 ซม. ในฐานหนา 0.30 ม. (2·cover > หนา) ไม่ถูก block — ตรวจเฉพาะกว้าง/ยาว (`COVER_EXCEEDS_DIMENSION`) → เสนอเพิ่มใน 18b
- การอนุมัติรายชิ้นยังข้ามคลาส B ได้ (CONFLICT, FIELD_VALUE_UNSOURCED, REBAR_DEFAULTED, FIELD_ASSUMED) → 18c

### การตัดสิน (อัปเดต)
- **FOUNDATION IMPLEMENTATION: PARTIALLY IMPLEMENTED** — แก้ข้อบกพร่องเหล็กฐานรากที่มีหลักฐาน (D1, D2) และช่องโหว่ gate (G1–G3); RebarSet, ฟอร์ม, ค่าขัดแย้งแบบทางเลือก ยังไม่ทำ
- **APPROVAL SAFETY: APPROVAL NOT SAFE** — ยังคงเดิม จนกว่าคลาส B จะถูกบังคับ (18c) และมีตัวตนผู้อนุมัติ/revision (18d)

## 9. Round 18c — บังคับคลาส B (2026-11-03)

รายละเอียดและ probe อยู่ใน `STRUCTBOQ_ROUND18_APPROVAL_SAFETY_AUDIT.md` หัวข้อ "อัปเดตหลัง Round 18c" — สรุปส่วนฐานราก: ฐานรากที่ไม่ระบุเหล็ก (DB12@0.15 ที่ระบบสร้าง) อนุมัติทั้งชิ้นแล้ว **ยังไม่ปล่อย** จนกว่าผู้ตรวจพิมพ์สเปคเหล็ก; ไม่มีการเปลี่ยนสูตรหรือปริมาณ (parity 22/22 เหมือนเดิม)

**การตัดสิน:** FOUNDATION **PARTIALLY IMPLEMENTED** (18b ยังไม่ทำ: RebarSet, D3, D4, cover เทียบความหนา) · APPROVAL **SAFE WITH RESTRICTIONS** (ข้อจำกัดในรายงาน approval safety)

## 10. Round 18d — ผู้อนุมัติ + revision (2026-11-03)

รายละเอียดใน `STRUCTBOQ_ROUND18_APPROVAL_SAFETY_AUDIT.md` หัวข้อ "อัปเดตหลัง Round 18d" — ไม่แตะสูตร/ปริมาณ (parity 22/22 เหมือนเดิม); `memberId` ไม่ทำเพราะตำแหน่งชิ้นคงที่อยู่แล้ว (มีเหตุผลและเงื่อนไขในรายงานนั้น)

**การตัดสิน:** FOUNDATION **PARTIALLY IMPLEMENTED** (เหลือ 18b) · APPROVAL **SAFE WITH RESTRICTIONS**

## 11. Round 18b — ปิดช่องที่เหลือของเหล็กฐานราก (2026-11-03)

**ทำ (ไม่เปลี่ยนตัวเลขปริมาณ — เพิ่มการตรวจและ flag เท่านั้น)**

| # | เดิม | ตอนนี้ |
|---|---|---|
| cover เทียบความหนา | cover 20 ซม. บนฐานหนา 0.30 ม. ผ่าน (ตรวจแค่กว้าง/ยาว) | `COVER_EXCEEDS_DIMENSION:block` เมื่อ 2×cover ≥ ความหนา — อนุมัติไม่ได้ (คลาส C) |
| D3 จำนวนเส้นขั้นต่ำ | `Math.max(3,…)` เงียบ | คงค่า 3 เส้นเดิม แต่ `REBAR_COUNT_RAISED:warn` บอกจำนวนจากระยะเรียงจริง (เช่น DB12@0.50 ในฐาน 0.90 = 2 เส้น → ใช้ 3) |
| D3 ขางอขั้นต่ำ | `Math.max(0.10,…)` เงียบ | คงค่าเดิม แต่ `FOOTING_HOOK_RAISED:warn` เมื่อความหนาหักระยะหุ้ม < 0.10 ม. |
| D4 กลุ่มเดียว | `4-DB12` = 4 เส้นต่อทิศ ไม่มี flag | `REBAR_DIRECTION_ASSUMED:warn` "ระบุกลุ่มเดียว — คิด 4 เส้นในแต่ละทิศ (รวม 8)" |
| D4 ลำดับ X/Y | สมมติกลุ่มแรก = X เงียบ | `REBAR_DIRECTION_ASSUMED:warn` เฉพาะเมื่อสองกลุ่มต่างกัน **และ** ฐานไม่จัตุรัส (ฐานจัตุรัสลำดับไม่มีผล จึงไม่ flag) |
| Excel ชุดเหล็ก | แผ่น "ตารางดัด-ตัดเหล็กเสริม" มี ชุดละแถว (รหัสชิ้น, ขนาด, หน้าที่+ทิศ+รูปงอ, จำนวน, ความยาวตัด, น้ำหนัก, สถานะ) แต่ไม่บอกว่าส่วนไหนไม่ใช่ค่าจากแบบ | เพิ่มคอลัมน์ "สมมติฐาน/ข้อสงสัยเหล็ก (ไม่ใช่ค่าจากแบบ)" ต่อแถว |

flag ใหม่ทั้งหมดเป็นคลาส A (QS อนุมัติได้หลังตรวจ) ยกเว้น cover เทียบความหนาเป็นคลาส C

**probe ฐาน 0.90×0.90×0.30 (เทียบหัวข้อ 2):** `4-DB12` → NEEDS_REVIEW + REBAR_DIRECTION_ASSUMED (เดิมรอตรวจเพราะ STEEL_RATIO โดยบังเอิญ) · `5-DB12+5-DB16` ฐาน 1.20×0.90 → NEEDS_REVIEW + ทิศ (ฐานจัตุรัสยัง AUTO_RELEASE 9.86 กก.) · cover 20 ซม. → block · ฐานหนา 0.15 งอตั้ง → FOOTING_HOOK_RAISED · `5-DB12+5-DB12` ตรง → AUTO_RELEASE (ไม่มี flag เพิ่ม)

**ตรวจ:** `npm test` 151/151 (เทสต์ใหม่ "Round 18b" ล้มกับโค้ดเดิมทุกข้อเพราะ flag/คอลัมน์ไม่มี) · tsc/build ผ่าน · benchmark ไม่เปลี่ยน (0/28 auto, 0 false release) · parity 22/22 ปริมาณและสถานะเหมือนเดิม — ต่างเฉพาะความมั่นใจของ DPT-H2-F03 (ฐาน 1.45×0.95 สองกลุ่มต่างกัน) 83% → 71% จาก flag ทิศ · ไม่ได้ตรวจในเบราว์เซอร์ (เปลี่ยนเฉพาะ engine/Excel; flag แสดงผ่านรายการ flag เดิม)

**ไม่ทำ (ตั้งใจ) — ส่วนที่เหลือของข้อเสนอ 4.1/4.2**
- **โมเดล `RebarSet` + การ์ดแก้ชุดเหล็กใน UI:** หลัง 18a/18b ไม่มีกรณีที่ให้ตัวเลขผิดแบบเงียบเหลืออยู่ — >2 กลุ่ม block, ทิศ/จำนวน/ขางอที่ไม่ใช่ค่าจากแบบมี flag ทุกกรณี สิ่งที่โมเดลจะเพิ่มคือ "คิดได้" แทน "block/flag" (ฐานเหล็กหลายชั้น, ระบุทิศชัดแจ้ง) — เป็นความสามารถใหม่ที่เปลี่ยน schema + `approvalKey` (approval ที่บันทึกไว้ทั้งหมดจะหลุด) ควรทำเมื่อพบแบบจริงที่ต้องใช้
- **ค่าทางเลือกเมื่อขัดแย้ง (`candidates`):** ต้องแก้ reader (`sheetMerge`) ซึ่งกระทบความแม่นยำการอ่านและต้องรัน `check:full` บนสำเนา — ปัจจุบันค่าขัดแย้งเป็นคลาส B แล้ว (18c) คือไม่ถูกปล่อยจนกว่าผู้ตรวจยืนยันค่า จึงปลอดภัยแต่ผู้ตรวจต้องพิมพ์ค่าเอง

**การตัดสิน:** FOUNDATION **PARTIALLY IMPLEMENTED** — ความถูกต้องและการกักกันครบ (ไม่มีตัวเลขที่ระบบเดาแล้วปล่อยเงียบ) แต่ยังไม่มี RebarSet/ฟอร์มฐานราก/ค่าทางเลือก · APPROVAL **SAFE WITH RESTRICTIONS** (ไม่เปลี่ยน)
