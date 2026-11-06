# StructBOQ Round 20.1 — Engine Identity & Missing Specification Safety

**วันที่:** 2026-11-03 · **สถานะ:** IMPLEMENTED — audit + design (หัวข้อ 1–7) และผลการแก้ (หัวข้อ 8–14)

**วิธี:**
- ค้นตาม symbol: `CALC_ENGINE_VERSION`, `calcSnapshot`, `calculateMember`, `rules.*`, `SPEC_VALUE_MISSING`, `DEFAULT_MATERIAL_SPECS`, `normalizeMaterialSpecs`, `applyGeneralNotesToSpecs`, ฟอร์มสเปก (`MaterialSpecsModal`), script `check:full`
- ไม่ได้อ่านทั้ง source tree ไม่ได้เปิดแบบ และไม่ได้รันสคริปต์ที่อ่านชุดแบบจริง

## 1. Root cause — การเปลี่ยนแปลงที่ยังหลุดการถอด approval

### 1.1 Engine
- `qsEngine.ts` **ไม่ import ไฟล์อื่นเลย** (0 import): สูตร ค่าคงที่ ตารางน้ำหนักเหล็ก gate, `normalizeMaterialSpecs`, Factor F และ `DEFAULT_MATERIAL_SPECS` อยู่ในไฟล์นี้ทั้งหมด
  → ขอบเขตของ "engine" สำหรับปริมาณต่อชิ้นคือไฟล์นี้ไฟล์เดียว บวกกับ input ที่อยู่ใน snapshot อยู่แล้ว (ค่าบนชิ้น สเปก และไฟล์แบบ)
- **ช่องโหว่:** `CALC_ENGINE_VERSION = '20.0'` ต้องเพิ่มเลขเอง การแก้ต่อไปนี้โดยไม่เพิ่มเลขจะทำให้ approval เดิมยังผ่าน
  - สูตร เช่น lean ขยาย `+0.20` ม., ขอ `12d`, ทาบ `40d`, ขอขั้นต่ำ `0.10` ม.
  - ค่าคงที่ใน `??`/`||` fallback ของ engine
  - ค่าเริ่มต้นระดับชิ้น เช่น ความลึกขุดดิน `member.excavationDepthM || 1.50`: ชิ้นที่ไม่มีค่านี้จะไม่มี field นี้ใน snapshot ถ้าโค้ดเปลี่ยน 1.50 เป็นค่าอื่น snapshot จะไม่ต่าง
  - เกณฑ์ gate (`AUTO_RELEASE_CONFIDENCE_PCT = 80`) และการจัดชั้น flag
- **ที่ถูกจับอยู่แล้ว:** ค่าใน `DEFAULT_MATERIAL_SPECS` snapshot เก็บสเปกหลัง merge กับค่าเริ่มต้น ถ้าแก้ค่าเริ่มต้นในโค้ด snapshot จะต่าง

### 1.2 สเปกที่หาย
- **`SPEC_VALUE_MISSING` (R20) แทบไม่เคยทำงานในแอป:** `normalizeMaterialSpecs` เติมค่าเริ่มต้นให้ทุก field ที่ไม่ได้ให้มา ค่าจึงแทบไม่เคยเป็น `undefined` flag จึงไม่จับ "ค่าที่ไม่มีใครให้"
- **ปัญหาจริงคือค่าเริ่มต้นที่ไม่มีที่มา:**
  - ฟอร์มสเปกแก้ได้แค่ราคา, % เผื่อเสีย, เกรด, ชนิดไม้แบบ และระยะหุ้มรวม
  - หมายเหตุในแบบ (`applyGeneralNotesToSpecs`) ให้ได้แค่เกรดคอนกรีตกับเหล็ก และระยะหุ้ม
  - **ความหนา lean, ความหนาทราย, ระยะเผื่อขุด, ตัวคูณดินพอง, รูปงอเหล็กฐานราก, ความยาวเหล็กตลาด และไม้แบบท้องคานคอดิน จึงมาจากค่าเริ่มต้นเสมอ** ไม่มีที่ไหนบันทึกว่าใครให้ค่านี้ มีแค่ระยะหุ้มที่มี `coverSources` (R19.1)
- **พบข้อผิดเพิ่ม:** `EXCAVATION_ASSUMED` บอกผู้ใช้ว่า "ความลึกขุดดินใช้ค่ามาตรฐาน 1.00 ม." แต่ engine คิดด้วย **1.50 ม.** (`excavationDepthM || 1.50`)
  - flag นี้เป็นแค่ info และขึ้นเฉพาะเมื่อ provenance ระบุว่า assumed
  - ชิ้นที่ไม่มี provenance ใช้ 1.50 โดยไม่มีป้ายเลย

## 2. Dependency matrix — ค่าที่อาจหายกับปริมาณที่กระทบ

| ค่า | ที่มาวันนี้ | ปริมาณที่กระทบ | flag วันนี้ | คลาส | ข้อเสนอ |
|---|---|---|---|---|---|
| `concreteGrade`, `stirrupGrade`, `formworkType`, `sourceText` | แบบ / ฟอร์ม / ค่าเริ่มต้น | ไม่มี (แสดงผล; ราคาแยก field) | — | **A** แสดงผล | ไม่ flag |
| `leanThicknessM` | ค่าเริ่มต้นเสมอ (0.05) | lean ลบ.ม., ถมกลับ, ค่า lean | ไม่มี | **B + D** | ต้องมีที่มา |
| `sandThicknessM` (ฐาน; ชิ้นมีค่าเองได้) | ค่าเริ่มต้นเสมอ (0.05) | ทรายรองพื้น ลบ.ม., ถมกลับ, ค่าทราย | ไม่มี | **B + D** | ต้องมีที่มา (ยกเว้นชิ้นที่มีค่าเอง) |
| `excavationMarginM` | ค่าเริ่มต้นเสมอ (0.10) | ดินขุด, ถมกลับ, ค่าขุด/ถม | ไม่มี | **B + D** | ต้องมีที่มา |
| `excavationBulkingFactor` | ค่าเริ่มต้นเสมอ (1.0) | ดินขุด, ถมกลับ | ไม่มี | **B + D** | ต้องมีที่มา |
| `member.excavationDepthM` (ระดับชิ้น) | แบบ / ผู้ตรวจ / ไม่มี → 1.50 | ดินขุด, ถมกลับ | info (ข้อความผิด 1.00) หรือไม่มี | **B + D** | flag ระดับ field (คลาส B) + แก้ข้อความให้ตรง 1.50 |
| `footingHookShape` (สเปก; ใช้เมื่อชิ้นไม่ระบุและไม่มี RebarSet) | ค่าเริ่มต้นเสมอ (FULL_UPTURN) | เหล็กฐานราก กก. (probe R20: −27% ถ้าเป็น STRAIGHT) | `FOOTING_HOOK_ASSUMED` warn แต่อนุมัติทั้งชิ้นครอบได้ | **B + D** | ต้องมีที่มา |
| ระยะหุ้ม | แบบ / หมายเหตุ / สเปก / ค่าเริ่มต้น | เหล็ก | R19.1 ครบแล้ว (`COVER_ASSUMED` warn) | B (จัดการแล้ว) | คงเดิม |
| `stockBarLengthM` | ค่าเริ่มต้นเสมอ (6.0) | เหล็กพื้น (ระยะทาบ) เฉพาะเส้นที่ยาวเกิน | `STOCK_LAP_APPLIED` info | **B + D** เฉพาะพื้นที่เกิดการทาบ | ต้องมีที่มาเมื่อมีการทาบ |
| `slabSandThicknessM` | ค่าเริ่มต้นเสมอ (0.05) | ทรายใต้พื้นวางบนดิน | ไม่มี | **B + D** เฉพาะพื้นบนดิน | ต้องมีที่มาเมื่อใช้ |
| `groundBeamSoffitFormwork` | ค่าเริ่มต้นเสมอ (false) | ไม้แบบท้องคานคอดิน ตร.ม. | ไม่มี | **B + D** เฉพาะคาน GB | ต้องมีที่มาเมื่อใช้ |
| `mainRebarGrade` | หมายเหตุในแบบ / ฟอร์ม / ค่าเริ่มต้น | เหล็กขั้นต่ำตามมาตรฐาน (fy) เมื่อแบบไม่ให้เหล็ก, ราคา | `REBAR_CODE_MINIMUM` ระดับ field อยู่แล้ว | C (มี flag คุมแล้ว) | คงเดิม |
| `concreteWastagePct`, `formworkWastagePct`, `rebarWastagePct` | ฟอร์ม / ค่าเริ่มต้น | ค่าใช้จ่ายและน้ำหนักเผื่อเสีย (ปริมาณสุทธิไม่เปลี่ยน) | ไม่มี | **C** (ค่าตามแนวปฏิบัติที่ระบุใน `sourceText`) | ไม่บล็อก; แสดงที่มาใน Excel |
| อัตราราคาทุกตัว (`*MatRate`, `*LaborRate`, `excavationRate`, `backfillRate`, เสาเข็ม per M / per Nos) | ฟอร์ม / ค่าเริ่มต้น (ราคากลางกรมบัญชีกลาง) | ค่าใช้จ่ายเท่านั้น | ไม่มี | **C** (มีทางเลือกที่บันทึกไว้: ราคากลาง) | ไม่บล็อก; แสดงที่มาใน Excel |

**สรุป:** ค่าที่ต้องแก้คือคลาส B+D 8 ตัว (ฐานราก 6 ตัว, พื้น 2, คาน GB 1 — ความลึกขุดเป็นค่าระดับชิ้น)
- ราคาและ % เผื่อเสียไม่ควรบล็อก เพราะกระทบแค่มูลค่าและมีแหล่งอ้างอิงอยู่แล้ว
- ค่าที่แสดงผลอย่างเดียวไม่ควร flag

## 3. Check scripts — ขอบเขตก่อนรัน
- **ไม่มี script `check`** มีแค่ `check:full` = `benchmark:offline` (5 ชุด: house_ready_1..4, dot32_pavilion) + `eval_reading` (4 ชุด)
- **สิ่งที่ต้องรู้ก่อนรัน:**
  - ทั้งสองต้องตั้ง `FULL_BOQ=1`
  - อ่าน OCR cache `offline_ocr.json` ที่มีอยู่ ไม่ render หน้า PDF และไม่ OCR ใหม่
  - **เขียนทับ baseline** `real_drawings/<set>/benchmark_offline.json` ในที่เดิม
- **แผน (ต้องได้อนุมัติ เพราะต้องตั้ง `FULL_BOQ`):**
  1. คัดลอกไฟล์ที่ไม่ใช่ PDF ของ 5 ชุดไป scratchpad
  2. รันบนสำเนา
  3. diff ทุก field ยกเว้น `generatedAt`
  4. ยืนยันว่า SHA-256 ของต้นฉบับไม่เปลี่ยน
- **ใช้เวลาโดยประมาณ:** หลายนาที ทำงานบน cache ไม่มีการ render แบบ
- **ทำไมยังควรรัน:** Round 20 ไม่ได้แตะ reader แต่ `reportAfterReview` ผ่าน engine ด้วย

## 4. แบบ engine identity (เสนอ)
- **ตัว identity:** SHA-256 ของ **token stream** ของ `src/engine/qsEngine.ts` ใช้ scanner ของ TypeScript ที่ติดตั้งอยู่แล้ว (`skipTrivia`)
  - comment, ช่องว่าง และการขึ้นบรรทัดไม่มีผล ส่วนโค้ด ค่าคงที่ และ string มีผล
  - string ต้องนับ เพราะมีค่าที่มีความหมาย เช่น `'FULL_UPTURN'` และ regex
- **ที่ตั้งใจไม่รวม:** UI (`src/components/*`), App, Excel และ reader
  - reader ให้ผลเป็นค่าบนชิ้น ซึ่งอยู่ใน snapshot อยู่แล้ว
  - **ไม่อ้างว่า hash ไฟล์เดียวพิสูจน์ทั้งระบบ:** ไฟล์นี้คือ engine ทั้งหมดเพราะไม่มี import ข้อนี้จะคุมด้วยเทสต์ที่ fail ถ้า `qsEngine.ts` เริ่ม import ไฟล์อื่น ถ้ามี import เพิ่มต้องเพิ่มไฟล์นั้นในรายการ
  - **ข้อจำกัดที่รับไว้:** แก้ข้อความ flag ภาษาไทยก็เปลี่ยน identity (หลุดเกิน แต่ปลอดภัย)
- **สร้างตอนไหน:** `scripts/gen_engine_identity.ts` (ไม่อ่านแบบ) เขียน `src/engine/engineIdentity.gen.ts` ผ่าน hook `predev`, `prebuild` และ `pretest`
  - Vite plugin ราว 10 บรรทัดสร้างใหม่เมื่อ `qsEngine.ts` เปลี่ยนตอน dev
  - เทสต์คำนวณจาก source อีกรอบและ fail ถ้าไฟล์ gen ไม่ตรง จึงจับไฟล์ที่ค้างได้ทุกครั้งที่รัน `npm test`
  - ทางเลือกที่ตัดทิ้ง: (ก) Vite `define` อย่างเดียว ใช้ไม่ได้กับ `node --test`; (ข) hash ตอน runtime ในเบราว์เซอร์ ทำไม่ได้เพราะ bundle ไม่มี source
- **ใน snapshot:** `engineVersion` (ป้ายที่คนอ่าน เก็บไว้) + `engineId` (hash) อยู่ใน Excel แผ่น 7 ทั้งหัวแผ่นและต่อแถว
- **ตรวจไม่ได้:** ถ้าไฟล์ gen ยังเป็น placeholder (`'UNVERIFIED'`) การอนุมัติจะไม่ปล่อยยอด
  - flag `ENGINE_IDENTITY_UNVERIFIED` คลาส B: อนุมัติทั้งชิ้นไม่ครอบ
  - approval เดิมที่ไม่มี `engineId` → STALE ต้องอนุมัติใหม่

## 5. แบบความปลอดภัยของสเปกที่หาย (เสนอ)
- **ที่มาของค่า:** เพิ่ม `MaterialSpecs.valueSources` (แนวเดียวกับ `coverSources`) รูปแบบ `{ [field]: { source: 'drawing_notes' | 'user' | 'assumption', note?, by?, at? } }`
  - ถ้ากรอกในฟอร์ม → `user`
  - ถ้าผู้ตรวจยืนยันใช้ค่าเริ่มต้นเป็นสมมติฐาน → `assumption` ต้องมีเหตุผลและชื่อผู้ตรวจ ถือเป็น "authorized review process"
- **กฎ:** ค่าคลาส B ที่ชิ้นนั้นใช้จริงแต่ไม่มีที่มา → flag `SPEC_DEFAULT_UNSOURCED` (warn, **คลาส B ระดับ field**) ระบุค่า ค่าเริ่มต้นที่ใช้ และปริมาณที่กระทบ
  - **อนุมัติทั้งชิ้นปล่อยยอดไม่ได้** จนกว่าจะกรอกค่าหรือบันทึกสมมติฐาน
  - **ตัวเลขไม่เปลี่ยน:** ยังคิดด้วยค่าเริ่มต้นเท่าเดิม เพื่อให้เห็นยอดชั่วคราว
  - ความลึกขุดดินระดับชิ้นใช้กลไก field-level ที่มีอยู่ (`fieldSources.excavation`) แก้ข้อความ 1.00 → 1.50 ให้ตรงกับที่คิดจริง ไม่แก้สูตร
- **คลาส C** (ราคา, % เผื่อเสีย): ไม่บล็อก แต่ Excel แสดงค่าและที่มา (ค่าเริ่มต้นราคากลาง / ผู้ใช้)
- **คลาส A:** ไม่ flag
- **`SPEC_VALUE_MISSING` เดิม (`undefined`):** ยกเป็นคลาส B ด้วยกลไกเดียวกัน
- **Snapshot:** `valueSources` อยู่ในสเปกจึงเข้า snapshot เองโดยไม่ต้องเพิ่มโค้ด ถ้าแก้สมมติฐาน approval จะหลุด
- **UI:**
  - ฟอร์มสเปกเพิ่มช่องงานดินและฐานราก (lean, ทราย, ระยะเผื่อขุด, ดินพอง, รูปงอ, ความยาวเหล็กตลาด, ไม้แบบท้อง GB) แต่ละช่องมีปุ่ม "ใช้ค่านี้เป็นสมมติฐาน" พร้อมช่องเหตุผล
  - หน้าตรวจทานแสดงรายการค่าที่ยังไม่มีที่มาในกล่องข้อสงสัยเดิม
- **Excel:** แผ่นใหม่ "สมมติฐานสเปก" มีคอลัมน์ field, ค่า, ที่มา, เหตุผล, ผู้ยืนยัน, เวลา และจำนวนชิ้นที่ใช้

**ผลกระทบที่ต้องรู้:**
- ทุกโครงการต้องยืนยันค่างานดินฐานรากหนึ่งครั้งก่อนอนุมัติฐานรากได้
- benchmark จริงปล่อยเองได้ 0/28 อยู่แล้ว ตัวเลขนี้จึงไม่ลดลง
- approval ที่ทำใน Round 20 จะหลุดทั้งหมด ด้วยเหตุผลสองข้อ: engineId ใหม่ และ `valueSources` ใหม่

## 6. ไฟล์ที่จะแก้
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `scripts/gen_engine_identity.ts` (ใหม่), `src/engine/engineIdentity.gen.ts` (ใหม่, สร้างอัตโนมัติ) | สร้าง identity |
| `package.json`, `vite.config.ts` | hook `pre*` และ plugin regenerate ตอน dev |
| `src/engine/qsEngine.ts` | `engineId` ใน snapshot, `ENGINE_IDENTITY_UNVERIFIED`, `valueSources`, `SPEC_DEFAULT_UNSOURCED`, เพิ่มทั้งสองใน `FIELD_LEVEL_FLAGS`, แก้ข้อความ 1.00 → 1.50 |
| `src/components/MaterialSpecsModal.tsx` | ช่องงานดินและฐานราก + ปุ่มบันทึกสมมติฐาน |
| `src/export/excelWorkbook.ts` | engineId ในแผ่น 7 + แผ่น "สมมติฐานสเปก" |
| เทสต์ | ข้อ 1–10 ของโจทย์ + ปรับเทสต์เดิมที่อนุมัติฐานรากให้ใส่ `valueSources` (ไม่ลดความเข้มของ assertion) |

**ไม่แก้สูตร** — มีแค่การแก้ข้อความ flag ที่บอกค่าผิด (1.00 → 1.50)

## 7. ความเสี่ยง
- hook `pre*` ไม่ทำงานถ้ามีคนรัน `vite`/`tsx` ตรง ๆ → ไฟล์ gen ค้าง เทสต์ freshness จับได้เมื่อรัน `npm test` แต่ build ที่ข้าม hook จะได้ identity ของ source เดิม
- identity เปลี่ยนเมื่อแก้ข้อความใน engine → ต้องอนุมัติใหม่บ่อยขึ้นช่วงพัฒนา
- เพิ่มขั้นตอนต่อโครงการ คือยืนยันสมมติฐานสเปก

## สถานะตอน audit (ก่อนแก้ — ดูสถานะสุดท้ายท้ายรายงาน)
**PARTIALLY IMPLEMENTED (audit + design เท่านั้น)**

| การใช้งาน | ผลตอนนี้ (ก่อนแก้) |
|---|---|
| Internal testing | ได้ |
| Supervised pilot | ได้ **ถ้า** QS ตรวจค่างานดินและฐานรากที่เป็นค่าเริ่มต้นเองทุกโครงการ และอนุมัติใหม่ทุกครั้งที่อัปเดตโปรแกรม |
| Unsupervised BOQ production | **ไม่ได้** |

---

# ผลการแก้ไข (Phase 2–6) — 2026-11-03

ผู้ใช้อนุมัติแบบตามหัวข้อ 4–6 และให้รัน `check:full` บนสำเนา ("Yes, build both")

## 8. สิ่งที่แก้
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `scripts/gen_engine_identity.ts` (ใหม่) | `engineIdentityOf()` = SHA-256 ของโค้ด engine หลัง esbuild ตัด comment/ช่องว่าง/type; `writeEngineIdentity()` เขียนไฟล์ gen เฉพาะเมื่อค่าเปลี่ยน; ล้มเหลว → `UNVERIFIED`; ไม่อ่านแบบ |
| `src/engine/engineIdentity.gen.ts` (ใหม่, สร้างอัตโนมัติ) | `ENGINE_ID` |
| `vite.config.ts` | plugin `engine-identity`: สร้างใหม่ตอน `buildStart` และเมื่อ `qsEngine.ts` เปลี่ยนตอน dev |
| `package.json` | `pretest` สร้าง identity; เพิ่ม `engineIdentity.test.ts` ในชุด test |
| `src/engine/qsEngine.ts` | import ไฟล์ gen (import เดียว); `engineIdentity`, `engineIdVerified`; `engineId` ใน snapshot; `CALC_ENGINE_VERSION` เหลือเป็นป้าย (`20.1`); flag `ENGINE_IDENTITY_UNVERIFIED`; `MaterialSpecs.valueSources`, `REQUIRED_SPECS`, `specsUsed`, flag `SPEC_DEFAULT_UNSOURCED` (warn, ระดับ field) และ `SPEC_ASSUMPTION` (info); flag `EXCAVATION_DEPTH_DEFAULT` (warn, ระดับ field); แก้ข้อความ `EXCAVATION_ASSUMED` (1.00 → ค่าที่คิดจริง); `specKeysUsed` ในผลคำนวณ; `snapshotDiff` ไล่ลง object ย่อยจนถึง field ที่เปลี่ยน |
| `src/components/MaterialSpecsModal.tsx` | หมวด "งานดิน / ฐานราก / ค่าที่กระทบปริมาณ": ค่า + ที่มา (ไม่มีที่มา / ผู้ใช้กรอก / หมายเหตุในแบบ / สมมติฐาน) + เหตุผล; บันทึกไม่ได้ถ้าสมมติฐานไม่มีเหตุผลหรือชื่อผู้ตรวจ |
| `src/App.tsx` | ส่งชื่อผู้ตรวจให้ฟอร์มสเปก |
| `src/export/excelWorkbook.ts` | แผ่น 7: engine ID ในหัวแผ่นและต่อแถว; แผ่นใหม่ "7.1 สมมติฐานสเปก" (ค่า, ค่าที่ใช้, ที่มา, เหตุผล, ผู้ยืนยัน, เวลา, กระทบ, จำนวนรายการที่ใช้) |
| เทสต์ | `engineIdentity.test.ts` ใหม่ (ข้อ 1–10); ปรับเทสต์เดิมที่อนุมัติฐานรากให้กรอกที่มาของสเปกและความลึกขุด (`SOURCED`, `excavationDepthM: 1.5`) — **ไม่ได้ลดหรือลบ assertion ใด**; ปรับ regex ข้อความ stale ให้ตรงรูปแบบใหม่ (`cover.cm: 5 → 7.5`) |

**ไม่แก้สูตร** — parity ปริมาณเหมือนเดิมทุกรายการ (หัวข้อ 12)

## 9. Engine identity — ที่ทำจริง
- **ตัว identity:** `ENGINE_ID` = SHA-256 ของ `src/engine/qsEngine.ts` หลัง esbuild (`minifyWhitespace`, ตัด comment และ type)
  - **เปลี่ยน** เมื่อแก้โค้ด สูตร ค่าคงที่ ค่าเริ่มต้นในโค้ด เกณฑ์ gate หรือข้อความ flag
  - **ไม่เปลี่ยน** เมื่อแก้ comment หรือรูปแบบ
  - ไม่รวม UI, App, Excel และ reader (ผลของ reader อยู่ใน snapshot เป็นค่าบนชิ้นอยู่แล้ว)
- **เหตุผลที่ใช้ esbuild:** TypeScript 7 ใน repo ไม่มี JS scanner API ส่วน esbuild ติดตั้งมากับ tsx และ vite อยู่แล้ว
  - ข้อจำกัด: อัปเกรด esbuild แล้วผลลัพธ์อาจต่างได้ ซึ่งทำให้ approval หลุดเกิน แต่เป็นฝั่งที่ปลอดภัย
- **ขอบเขต (ไม่ได้อ้างเกินจริง):**
  - ขอบเขตครบเพราะ `qsEngine.ts` ไม่ import อะไรนอกจากไฟล์ gen
  - เทสต์ข้อ 3 จะ fail ถ้ามี import ใหม่ และบอกให้เพิ่มไฟล์นั้นใน `ENGINE_SOURCES`
  - เทสต์ข้อ 3 ยังจะ fail ถ้าไฟล์ gen ไม่ตรงกับ source (ทดสอบแล้วว่าจับได้จริงระหว่างพัฒนา)
- **สร้างเมื่อไร:**
  - `npm test` สร้างผ่าน `pretest`
  - `vite build` สร้างผ่าน `buildStart`
  - `vite` dev สร้างเมื่อไฟล์เปลี่ยน (ยืนยันในเบราว์เซอร์: id ใน Excel = id ที่คำนวณจาก source)
- **ใน snapshot และ Excel:** `engineId` อยู่ใน snapshot จึงอยู่ใน fingerprint; แสดงใน Excel แผ่น 7 ทั้งหัวแผ่นและคอลัมน์ "Engine ID ตอนอนุมัติ"
- **ตรวจไม่ได้:** ถ้า id ไม่ใช่ hex 64 ตัว (เช่น `UNVERIFIED`) จะขึ้น `ENGINE_IDENTITY_UNVERIFIED` แบบระดับ field อนุมัติทั้งชิ้นจึงปล่อยยอดไม่ได้
- **approval ของ Round 20 (ไม่มี `engineId`):** STALE `engineId: — → <hash>`

## 10. Missing specification — ที่ทำจริง
- ค่าคลาส B 8 ตัว (`REQUIRED_SPECS`) ถือว่ามีที่มาก็ต่อเมื่อมีรายการใน `valueSources`
  - `specsUsed` เลือกเฉพาะค่าที่ชิ้นนั้นใช้จริง:
    - ฐานราก: lean, ระยะเผื่อขุด, ดินพอง, ทราย (ถ้าชิ้นไม่มีค่าเอง), รูปงอ (เฉพาะเมื่อใช้รูปงอจากสเปก)
    - พื้น: เหล็กตลาด (เฉพาะเมื่อมีการทาบ), ทราย (พื้นบนดิน)
    - คาน GB: ไม้แบบท้องคาน
  - **ไม่มีที่มา:** `SPEC_DEFAULT_UNSOURCED` (warn, ระดับ field) ระบุค่าที่ใช้และปริมาณที่กระทบ → อนุมัติทั้งชิ้นไม่ครอบ ยอดยังคิดด้วยค่าเริ่มต้นเท่าเดิม
  - **สมมติฐาน:** ต้องมีเหตุผลและชื่อผู้ตรวจ (ฟอร์มบังคับ) → อนุมัติได้ และขึ้น `SPEC_ASSUMPTION` (info) ในหน้าตรวจทาน
  - `valueSources` อยู่ในสเปกจึงอยู่ใน snapshot เอง: แก้ค่า เหตุผล หรือที่มา → approval หลุด และข้อความระบุ field ย่อย
- **ความลึกขุดระดับชิ้น:** ไม่มีค่า → `EXCAVATION_DEPTH_DEFAULT` (warn, ระดับ field "ลึกขุดดิน") จนกว่าจะกรอกค่า
  - ข้อความ `EXCAVATION_ASSUMED` แก้ให้ตรงกับค่าที่คิดจริงแล้ว (เดิมบอก 1.00 แต่คิด 1.50)
- **คลาส A (แสดงผล) และ C (ราคา, % เผื่อเสีย):** ไม่ flag ไม่บล็อก (เทสต์ข้อ 7) แสดงที่มาของคลาส B ใน Excel แผ่น 7.1
- **`SPEC_VALUE_MISSING` (R20):** คงไว้แบบเดิม (warn คลาส A); ถ้าเป็นค่าคลาส B จะติด `SPEC_DEFAULT_UNSOURCED` ด้วย

## 11. ผลเทสต์ (วัดจริง)
- `npm test`: **39/39 + 148/148 ผ่าน** (เดิม 39 + 138; เพิ่ม 10)
- `tsc --noEmit` ผ่าน, `npm run build` ผ่าน

| # | ตรวจอะไร | ผล |
|---|---|---|
| 1 | แก้สูตร (lean `+0.20` → `+0.25`, ความลึกขุดเริ่มต้น 1.50 → 1.20) → identity เปลี่ยน | ผ่าน |
| 2 | แก้ค่าคงที่ (`AUTO_RELEASE_CONFIDENCE_PCT` 80 → 81, lean เริ่มต้น 0.05 → 0.07) → identity เปลี่ยน | ผ่าน |
| 3 | comment/ขึ้นบรรทัดไม่เปลี่ยน identity; ไม่มีไฟล์ UI ใน `ENGINE_SOURCES`; ไฟล์ gen ตรงกับ source; engine import แค่ไฟล์ gen | ผ่าน |
| 4 | identity ต่าง → STALE (`engineId:`); identity `UNVERIFIED` → อนุมัติไม่ปล่อยยอด ("ตัวตนของตัวคำนวณ") | ผ่าน |
| 5 | สเปกคลาส B ไม่มีที่มา → อนุมัติไม่ปล่อยยอด ระบุ "ความหนาคอนกรีตหยาบใต้ฐานราก 0.05 ม." และยอดไม่เปลี่ยน; ไม่มีความลึกขุด → ไม่ปล่อยยอด | ผ่าน |
| 6 | สมมติฐานพร้อมเหตุผล → APPROVED, `SPEC_ASSUMPTION` แสดงเหตุผลและผู้ตรวจ, อยู่ใน snapshot, แก้เหตุผล → STALE | ผ่าน |
| 7 | เกรด, ชนิดไม้แบบ และ `sourceText` ว่าง → ยัง APPROVED; เสาไม่ใช้สเปกคลาส B → ไม่มี flag | ผ่าน |
| 8 | Excel แผ่น 7.1 แสดงค่า ที่มา เหตุผล ผู้ยืนยัน และจำนวนรายการที่ใช้; "ไม่มีที่มา (ค่าเริ่มต้น)"; แผ่น 7 มี engine ID ในหัวแผ่นและต่อแถว; รายการที่ถูกกันแสดง "รอตรวจ" | ผ่าน |
| 9 | approval แบบ Round 20 (snapshot ไม่มี `engineId`) → STALE `engineId: —` | ผ่าน |
| 10 | บันทึกแล้วโหลดกลับ (JSON round-trip เหมือน localStorage) → fingerprint เดิม, APPROVED | ผ่าน |

## 12. Full validation (วัดจริง)
| การตรวจ | ผล |
|---|---|
| `npm test` | 187/187 ผ่าน |
| TypeScript (`tsc --noEmit`) | ผ่าน |
| Build | ผ่าน |
| `check` | **ไม่มี script ชื่อนี้** — ใช้ `check:full` |
| `check:full` (`FULL_BOQ=1`, รันบน **สำเนา** ใน scratchpad ตามที่อนุมัติ) | รันครบ 5 ชุด benchmark + eval 4 ชุด อ่านแค่ OCR cache ไม่ render แบบ — ดูรายละเอียดด้านล่าง |
| Benchmark probe (`bench.ts`, 28 รายการ) | auto 0/28, false release 0 (เท่าเดิม) |
| Parity (`test_parity_round14.ts`) | ปริมาณเหมือนเดิมทุกรายการ (0 mismatch); ต่างแค่ "Conf" ของฐานรากและคาน GB ที่ลดลง (เช่น 83% → 59%) เพราะ warn ใหม่ — สถานะทุกรายการเหมือนเดิม (NEEDS_REVIEW) |

**`check:full` — รายละเอียด:**
- **baseline ต้นฉบับไม่ถูกแตะ:** SHA-256 ของ `real_drawings/*/benchmark_offline.json` ก่อนและหลังรันตรงกันทั้ง 5 ไฟล์
- **eval_reading (อ่านแบบ):** house_ready_1 ถูก 76% · house_ready_2 88% · house_ready_3 84% · house_ready_4 83% — **รวม ถูก 83% · ผิด 3% · ไม่พบ 14%**
  - eval ไม่เรียก engine (import แค่ type) รอบนี้จึงไม่กระทบตัวเลขนี้
- **benchmark_offline:** ยอดรวมต่างจาก baseline 22–42 field ต่อชุด เช่น house_ready_1 แถว 6: 35.48 → 37.10
  - **สาเหตุไม่ใช่รอบนี้:**
    - baseline สร้างเมื่อ **2026-10-23** ก่อน Round 18–20 และก่อนงานของ session อื่นที่แก้ reader
    - `compareTakeoffWithBoq` ตัดเฉพาะรายการ REJECTED ส่วนรอบนี้ไม่มีทางทำให้รายการเป็น REJECTED และไม่เปลี่ยนปริมาณ (parity ยืนยัน)
  - **ข้อจำกัด:** แยกผลของรอบก่อน ๆ ทีละรอบไม่ได้ เพราะไม่มี baseline ระหว่างทาง และยังไม่ได้อัปเดต baseline (ตามกฎ ต้องให้ผู้ใช้ตัดสิน)

## 13. ตรวจในเบราว์เซอร์ (dev server, Bangkok Innovation Hub, ฐานราก F1)
| ขั้น | ผล | ภาพ |
|---|---|---|
| 1. ตั้งที่มาของสเปกคลาส B ครบ ("ผู้ใช้กรอก") → อนุมัติ F1 | "อนุมัติแล้ว #edcb2d5de801" | `tools/artifacts/round20_1/01_approved_sourced_specs.jpg` |
| 2–3. แก้ lean 0.05 → 0.10 | อนุมัติหมดอายุ: `specs.leanThicknessM: 0.05 → 0.1` และ `specs.valueSources.leanThicknessM.at` | `02_stale_after_lean_change.jpg` |
| 4–5. ตั้งที่มา lean เป็น "ไม่มีที่มา" → กดอนุมัติ | ไม่ปล่อยยอด: "สเปกไม่มีที่มา — คิดชั่วคราวด้วยค่าเริ่มต้น: ความหนาคอนกรีตหยาบใต้ฐานราก 0.1 ม. …" + "อนุมัติทั้งชิ้นไม่ครอบ สเปกโครงการที่ไม่มีที่มา"; ตรวจแล้ว 0 | `03_unsourced_spec_blocks_approval.jpg` |
| 6. เลือก "สมมติฐาน" โดยไม่ใส่เหตุผล → บันทึก | ถูกปฏิเสธ: "สมมติฐานต้องมีเหตุผลและชื่อผู้ตรวจ …" แล้วจึงใส่เหตุผล | `04_documented_assumption_form.jpg` |
| 7. บันทึก → อนุมัติ | อนุมัติแล้ว #a21881f541d2; หน้าตรวจทานแสดง "ใช้สมมติฐานสเปก: ความหนาคอนกรีตหยาบใต้ฐานราก 0.1 ม. — <เหตุผล> (QS ทดสอบ R20)"; Excel แผ่น 7.1 แถว lean: 0.1 ม. · สมมติฐานที่บันทึก · เหตุผล · QS ทดสอบ R20 · ใช้ 1 รายการ; แผ่น 7: Engine 20.1, Engine ID `9e6c37e4…` (= id ที่คำนวณจาก source) | `05_approved_with_assumption.jpg` |
| ยืนยันว่าสมมติฐานอยู่ใน snapshot | แก้เหตุผลหลังอนุมัติ → STALE `specs.valueSources.leanThicknessM.note: … → …` | — |

- console ไม่มี error
- **พบและแก้ระหว่างทดสอบ:** ข้อความ STALE ของ `valueSources` เดิมแสดงทั้ง object จนอ่านไม่ได้ → ให้ `snapshotDiff` ไล่ลง object ย่อย (เทสต์ปรับตามรูปแบบใหม่)

## 14. ข้อจำกัดที่ยังอยู่
- **ข้อความใน engine:** แก้ข้อความ flag ภาษาไทยก็เปลี่ยน identity ทำให้ approval หลุด (หลุดเกิน ฝั่งปลอดภัย)
- **รันข้าม hook:** รัน `tsx`/`node` ตรงโดยไม่ผ่าน `npm test` หรือ vite จะใช้ไฟล์ gen เดิม เทสต์ข้อ 3 จับได้เมื่อรันเทสต์ แต่ตอน runtime จะไม่รู้
- **ไม่มีลายเซ็น:** identity และ fingerprint ไม่มีกุญแจ คนที่แก้ทั้ง bundle หรือ localStorage อย่างตั้งใจปลอมได้
- **ชื่อผู้ตรวจ:** ยังไม่ได้ยืนยันตัวตน ทั้งตอนอนุมัติและตอนบันทึกสมมติฐาน
- **เหล็กตลาด (พื้น):** flag เฉพาะพื้นที่มีการทาบ พื้นที่เหล็กสั้นกว่า 6 ม. ไม่ flag แม้ความยาวเหล็กตลาดจริงจะสั้นกว่า
- **ข้อความช่วยเหลือในหน้าตรวจทาน:** สำหรับช่อง "สเปกโครงการที่ไม่มีที่มา" ข้อความยังบอกให้ "กดยืนยันค่าในช่องนั้น" แต่ต้องแก้ในฟอร์มสเปก (ข้อความของ flag บอกถูกแล้ว)
- **ต่อโครงการ:** ต้องยืนยันสเปกคลาส B ทุกโครงการ และ approval ที่ทำไว้ก่อนหน้า (Round 20) ต้องอนุมัติใหม่ทั้งหมด
- **Baseline ของ `check:full`:** ยังเป็นของ 2026-10-23 ควรให้ผู้ใช้ตัดสินว่าจะอัปเดตหรือไม่
- ไม่ได้ทำ conflict resolution (ตามโจทย์)

## สถานะสุดท้าย
**IMPLEMENTED**
- engine identity สร้างจากโค้ดอัตโนมัติ
- ค่าสเปกที่กระทบปริมาณต้องมีที่มาหรือสมมติฐานที่บันทึกก่อนอนุมัติได้
- ทดสอบแล้วทั้ง unit, เบราว์เซอร์, Excel, parity และ `check:full` บนสำเนา

| การใช้งาน | ผล |
|---|---|
| Internal testing | ได้ |
| Supervised pilot | ได้ — อัปเดตโปรแกรมแล้ว approval หลุดเอง และค่าเริ่มต้นที่ไม่มีที่มากันการอนุมัติไว้ (ยังต้องมี QS ตรวจทุกรายการ และต้องยืนยันสเปกคลาส B ต่อโครงการ) |
| Unsupervised BOQ production | **ไม่ได้** — เทสต์ผ่านไม่ได้แปลว่าพร้อม: benchmark จริงยังปล่อยเองได้ 0/28, ความแม่นการอ่านรวม 83%, ผู้ตรวจไม่ยืนยันตัวตน, ไม่มีลายเซ็น และ baseline benchmark ยังไม่ได้ทบทวน |
