# StructBOQ Round 17.1 — Provenance & Release Gate Audit

**วันที่:** 2026-11-03 · **ประเภท:** Audit เท่านั้น — ไม่มีการแก้ซอร์สโค้ดในรอบนี้ ไม่ commit
**วิธีตรวจ:** ค้น symbol (`calculateMember`, `computeProject`, `confidenceFrom`, `provenance`, `review`) แล้วเปิดเฉพาะช่วงที่เกี่ยวข้อง; Test matrix รันผ่านสคริปต์ชั่วคราวนอก repo (`scratchpad/matrix.ts`) ที่เรียก `calculateMember` ตัวจริง; ไม่เปิดแบบ ไม่รัน OCR
(`calculateProject` และ `releaseGate` ไม่มีเป็น symbol ในโค้ด — gate อยู่ใน `calculateMember` ที่ `src/engine/qsEngine.ts:1446-1465`; ตัวรวมโครงการคือ `computeProject`)

---

## 1. ตรวจการเปลี่ยนแปลงรอบ 17

ข้อจำกัด: ไฟล์เหล่านี้มีการแก้ค้างจากรอบก่อน ๆ ที่ยังไม่ commit (`qsEngine.ts` +530/−56 เทียบ `682f513`) และ `releaseGate.test.ts`, `tools/benchmark/` ยังไม่ถูก track → **git แยก diff ของรอบ 17 ออกจากรอบก่อนไม่ได้** ตารางด้านล่างคือรายการแก้ของรอบ 17 ทั้งหมดตามบันทึกการทำงาน ตรวจกับไฟล์ปัจจุบันแล้ว

| ไฟล์ | การเปลี่ยน (รอบ 17) | สูตรปริมาณ | Validation | Ground truth | Gate อื่น |
|---|---|---|---|---|---|
| `src/engine/qsEngine.ts:1048-1056` | `PROVENANCE_UNSPECIFIED` `info` → `warn` + คอมเมนต์ 1 บรรทัด | ไม่แตะ | เข้มขึ้น | — | ไม่แตะ |
| `src/engine/releaseGate.test.ts:44-49` | assert severity `warn`, status `NEEDS_REVIEW`, และ `AUTO_RELEASE` หลัง approve | — | เพิ่ม assert | — | — |
| `src/engine/qsEngine.test.ts` | ค่าคงที่ `READ` + `provenance: READ` 18 จุดใน member ที่คาดว่า `AUTO_RELEASE` | — | ค่าที่ assert เดิมทั้งหมดคงที่ | — | — |
| `tools/benchmark/run_benchmark.ts` | ฟิลด์ `provenance?` ใน entry + ส่งต่อให้ engine | — | — | ไม่แตะ (JSON ไม่เปลี่ยน) | — |
| `tools/benchmark/benchmark.test.ts` | ใส่ provenance ให้ 2 entry ในเทสต์ false-release detector | — | — | เทสต์สังเคราะห์ ไม่ใช่ ground truth | — |
| `tools/STRUCTBOQ_ROUND17_BLIND_VALIDATION.md` | เพิ่มหัวข้อ 6.1 | — | — | — | — |

**ข้อสังเกตต่อการแก้เทสต์ของรอบ 17 (ต้องรายงานตามจริง):** ค่าคงที่ `READ = { evidence: [], fieldSources: {}, confidence: 0.95 }` เป็น **source record ว่าง** — ซึ่ง matrix ด้านล่างพบว่าเป็นช่องโหว่ (B1: record ว่างถูกจัดเป็น `DRAWING_VERIFIED` และปล่อยอัตโนมัติ) เทสต์จึงผ่านโดยอาศัยช่องโหว่นั้น ถ้าปิด B1 ต้องเปลี่ยน `READ` ให้มี evidence จริง (เช่น `method: 'dxf'` หรือ `'pdf_text'` + fieldSources `drawing`)

**พบจากรอบก่อน (ไม่ใช่รอบ 17) — การลด validation เทียบ HEAD:** ใน `682f513` ฟิลด์วิกฤตที่ `fieldSources = 'missing'` เป็น `block` เสมอ; ใน working tree ปัจจุบันเป็น `block` เฉพาะเมื่อค่าเป็น 0/ว่าง ถ้ามีค่า (ไม่ว่าใครใส่) เป็น `info` `FIELD_USER_PROVIDED` → ปล่อยอัตโนมัติได้ (ดู B2)

## 2. ความหมายของ Provenance (ตามโค้ดจริง `qsEngine.ts:1025-1041`)

| ระดับ | เงื่อนไขในโค้ด (ตามลำดับ) | ความหมายที่ควรเป็น |
|---|---|---|
| `USER_CONFIRMED` | `review.status === 'approved'` **หรือ** ฟิลด์ใดฟิลด์หนึ่งเป็น `'reviewer'` | QS ยืนยัน |
| `UNKNOWN` | ไม่มี `provenance` | ไม่รู้ที่มา |
| `ENGINEERING_ASSUMPTION` | มี flag สมมติฐาน หรือฟิลด์ใดเป็น `assumed`/`inferred` | ค่าสมมติ |
| `DEFAULT_VALUE` | ฟิลด์ใดเป็น `missing` | ค่าเริ่มต้น/ไม่พบในแบบ |
| `OCR_EXTRACTED` | evidence มี `vision`/`pdf_text` | อ่านจากแบบด้วย OCR/ข้อความ |
| `DRAWING_VERIFIED` | evidence `dxf` **หรือทุกกรณีที่เหลือ** (รวม evidence ว่าง, `manual`) | ยืนยันจากแบบเวกเตอร์ |

**สำคัญ:** ระดับ provenance **ไม่ได้ถูกใช้ตัดสินสถานะโดยตรง** — gate ใช้เฉพาะ flags (`block`/`warn`) + confidence ≥ 80 + approval ระดับเป็นเพียงป้ายที่แสดงใน UI/export

### คำตอบ 5 ข้อ

1. **Manual Calculator ควรเป็น UNKNOWN หรือ USER_CONFIRMED หลังผู้ใช้ยืนยัน?** ตอนนี้เป็น `UNKNOWN` (ไม่มี provenance, `ManualCalculator.tsx:33-52`) — ข้อเสนอในหัวข้อ 6: คงเป็น `UNKNOWN`/NEEDS_REVIEW จนกว่า QS กดอนุมัติใน Review Workspace จึงเป็น `USER_CONFIRMED`
2. **กรอกเองอย่างเดียวควร AUTO_RELEASE ได้หรือไม่?** ไม่ควร การพิมพ์ค่าไม่ใช่หลักฐานว่าค่ามาจากแบบ และไม่มีการอ้างอิงหน้าแบบ ต้องมีการอนุมัติที่บันทึกใน log
3. **USER_CONFIRMED ใช้แทน DRAWING_VERIFIED ได้หรือไม่?** ไม่ได้ในเชิงความหมาย — `USER_CONFIRMED` = "มีคนรับผิดชอบ" ส่วน `DRAWING_VERIFIED` = "มีหลักฐานจากแบบ" ทั้งสองควรแยกกันได้ แต่โค้ดปัจจุบันให้ approval **ทับ** ระดับเดิม (บรรทัด 1026) ทำให้ export ไม่บอกว่าเดิมเป็น OCR หรือสมมติฐาน (R4)
4. **แก้ข้อมูลหลัง OCR ต้องเปลี่ยน provenance อย่างไร?** ฟิลด์ที่แก้ควรเป็น `'reviewer'` เฉพาะฟิลด์นั้น — `ReviewWorkspace.decide()` และ `SectionTable.confirm()` ทำถูกส่วนนี้ แต่ (ก) ฟิลด์ `reviewer` ฟิลด์เดียวทำให้ทั้ง member เป็น `USER_CONFIRMED` (ข) confidence ทั้ง member ถูกยกเป็น ≥ 0.9 และ conflict "ไม่พบแบบขยาย" ถูกลบ แม้แก้ฟิลด์เดียว (`ReviewWorkspace.tsx:165-170`, `SectionTable.tsx:127-130`) → B5
5. **QS approval มีหลักฐานและ audit trail หรือไม่?** มีบางส่วน: `review = { status, note, at }` และ `reviewLog` บันทึกค่าเดิม/ค่าใหม่/เวลา/การตัดสิน (`reviewLog.ts:68-91`) และ export เป็นแผ่นงานใน Excel (`excelWorkbook.ts:249`) **แต่ไม่มีตัวตนผู้อนุมัติ** (ไม่มีชื่อ/ใบอนุญาต), เก็บใน `localStorage` ของเบราว์เซอร์เท่านั้น (ลบได้/แก้ได้), และการอนุมัติแบบกลุ่มบันทึกเป็น note สำเร็จรูป → ใช้เป็นหลักฐานทางวิชาชีพไม่ได้

## 3. ตรวจทุกเส้นทาง

| เส้นทาง | จุดในโค้ด | Source record | Evidence method → ระดับ | ข้อสังเกต |
|---|---|---|---|---|
| PDF ข้อความดิจิทัล | `sheetMerge.ts` (ทุกจุดใช้ `method: 'vision'`) | มี | `vision` → OCR_EXTRACTED | PDF ดิจิทัลก็ถูกติดป้าย vision — อนุรักษ์นิยม ไม่อันตราย แต่ป้ายไม่ตรง |
| PDF OCR (สแกน) | `sheetMerge.ts` | มี | `vision` → OCR_EXTRACTED | confidence ตาม reader; < 0.7 → warn |
| DXF | `dxfParser.ts:393-428` | มี | `dxf` → DRAWING_VERIFIED | |
| ตาราง (schedule) | `scheduleParser.ts:74-79` | มี | `pdf_text` → OCR_EXTRACTED | confidence 0.55–1.0 จากจำนวนฟิลด์ที่พบ; `supportColW1/W2 = 0` เสมอ (ตรวจต่อแยกต่างหาก) |
| Review Workspace (แก้/อนุมัติ) | `ReviewWorkspace.tsx:156-200` | คงเดิม + ฟิลด์ที่แก้เป็น `reviewer` | → USER_CONFIRMED | B3, B4, B5; `trust()` คืน `undefined` ถ้าไม่มี provenance เดิม → member UNKNOWN ยังต้อง approve |
| Section Table (ยืนยันหน้าตัดทั้งกลุ่ม) | `SectionTable.tsx:111-134` | `assumed`/`inferred` → `reviewer` ("confirmed as shown") + approve ทั้งกลุ่ม | → USER_CONFIRMED | เป็นการกระทำของ QS โดยตั้งใจ แต่ยืนยันฟิลด์ที่ไม่ได้ดูด้วย (เช่น support) |
| Manual Calculator | `ManualCalculator.tsx:33-54`, `App.tsx:323` | **ไม่มี** | → UNKNOWN | หลังรอบ 17: NEEDS_REVIEW เสมอ; เพิ่มเข้าโครงการพร้อม log entry "เพิ่มเองจากหน้าคำนวณเอง" |
| Sample Projects | `sampleProjects.ts`, `App.tsx:292-320` | **ไม่มี** | → UNKNOWN | ทุกรายการ NEEDS_REVIEW; มีป้าย "ข้อมูลสมมติ" แล้ว |
| Benchmark Runner | `tools/benchmark/run_benchmark.ts` | ไม่มีใน JSON 4 ชุด | → UNKNOWN | ตัวเลข false-release/NEEDS_REVIEW ของ Round 9–16 ใช้ไม่ได้แล้ว |
| กู้รีวิวเก่า / นำเข้าโครงการเดิม | `App.tsx:105-121` (`restoreReview`) | ตามที่บันทึก | ตามที่บันทึก | **B6** — แทนที่ผลอ่านใหม่ทั้งชุดด้วยของเก่า |
| Excel export | `excelWorkbook.ts` | อ่านจาก `currentProject` ที่คำนวณใหม่ทุกครั้งที่แก้ (`App.tsx:264, 422`) | `provenanceLevel ‖ 'UNKNOWN'` | สอดคล้องกับ UI; รายการที่ถูก block ไม่มี `provenanceLevel` → ขึ้น UNKNOWN (B7) |
| PDF export | `OfficialReportModal.tsx:185-190` | จาก `result` เดียวกัน | — | แสดงแบนเนอร์เมื่อ `needsReviewCount > 0` |

## 4. Test matrix (ผลจริงจาก `calculateMember`, ฐานราก 1.2×1.2×0.25 ม. DB12@0.15)

| กรณี | คาดหวัง | ผลจริง | ระดับ | Conf. | flags (warn/block) | ผล |
|---|---|---|---|---|---|---|
| UNKNOWN: ไม่มี provenance | NEEDS_REVIEW | NEEDS_REVIEW | UNKNOWN | 80 | PROVENANCE_UNSPECIFIED | ✅ |
| Source record ว่าง (confidence 0.95) | NEEDS_REVIEW | **AUTO_RELEASE** | **DRAWING_VERIFIED** | 92 | — | ❌ B1 |
| Source record ว่าง (confidence 0) | NEEDS_REVIEW | NEEDS_REVIEW | DRAWING_VERIFIED | 0 | LOW_CONFIDENCE | ✅ (ป้ายผิด) |
| DEFAULT_VALUE: width `missing` แต่มีค่า | NEEDS_REVIEW | **AUTO_RELEASE** | DEFAULT_VALUE | 84 | — | ❌ B2 |
| DEFAULT_VALUE: width `missing` ค่า 0 | REJECTED/NEEDS_REVIEW | NEEDS_REVIEW | (ไม่มี) | 50 | FIELD_MISSING | ✅ (B7) |
| DEFAULT_VALUE: rebar `missing` | NEEDS_REVIEW | NEEDS_REVIEW | DEFAULT_VALUE | 75 | REBAR_DEFAULTED | ✅ |
| ENG_ASSUMPTION: width `assumed` | NEEDS_REVIEW | NEEDS_REVIEW | ENGINEERING_ASSUMPTION | 75 | FIELD_ASSUMED | ✅ |
| ENG_ASSUMPTION: length `inferred` | NEEDS_REVIEW | **AUTO_RELEASE** | ENGINEERING_ASSUMPTION | 87 | — | ❌ B2 |
| ENG_ASSUMPTION: hook UNSPECIFIED | NEEDS_REVIEW | NEEDS_REVIEW | OCR_EXTRACTED | 75 | FOOTING_HOOK_UNSPECIFIED | ✅ (ป้ายไม่สะท้อนสมมติฐาน) |
| OCR `pdf_text` conf 0.90 | AUTO_RELEASE | AUTO_RELEASE | OCR_EXTRACTED | 87 | — | ✅ |
| OCR `vision` conf 0.78 | NEEDS_REVIEW | NEEDS_REVIEW | OCR_EXTRACTED | 75 | — | ✅ |
| OCR `vision` conf 0.65 | NEEDS_REVIEW | NEEDS_REVIEW | OCR_EXTRACTED | 50 | LOW_CONFIDENCE | ✅ |
| OCR + conflict | NEEDS_REVIEW | NEEDS_REVIEW | OCR_EXTRACTED | 80 | CONFLICT | ✅ |
| USER_CONFIRMED: แก้ 1 ฟิลด์ ไม่ได้ approve | ต้องมี approval | **AUTO_RELEASE** | USER_CONFIRMED | 87 | — | ⚠️ B5 |
| DRAWING_VERIFIED: `dxf` | AUTO_RELEASE | AUTO_RELEASE | DRAWING_VERIFIED | 92 | — | ✅ |
| evidence `method: 'manual'` | ไม่ใช่ DRAWING_VERIFIED | AUTO_RELEASE | **DRAWING_VERIFIED** | 92 | — | ❌ B1 |
| QS approve รายการ UNKNOWN | AUTO_RELEASE | AUTO_RELEASE | USER_CONFIRMED | 92 | — | ✅ (ตามออกแบบ) |
| QS approve + warn (width assumed) | AUTO_RELEASE (QS รับผิดชอบ) | AUTO_RELEASE | USER_CONFIRMED | 75 | FIELD_ASSUMED | ✅ ตามออกแบบ — แต่ดู B3 |
| QS approve + block (ค่า 0) | ไม่ปล่อย | REJECTED | (ไม่มี) | 0 | — | ✅ |
| แก้ค่าหลัง approve (approval ยังติดอยู่) | NEEDS_REVIEW | **AUTO_RELEASE** | USER_CONFIRMED | 92 | — | ❌ engine ไม่รู้ว่าค่าเปลี่ยน → พึ่ง UI (B4) |
| นำเข้าโครงการเก่า (ไม่มี provenance) | NEEDS_REVIEW | NEEDS_REVIEW | UNKNOWN | 80 | PROVENANCE_UNSPECIFIED | ✅ |
| เปลี่ยน drawing revision (ชื่อไฟล์เดิม, tag/grid เดิม) | ใช้ผลอ่านใหม่, ล้าง approval | ใช้ **members เก่าทั้งชุด** + approval เก่า | — | — | — | ❌ B6 (ตรวจจากโค้ด `App.tsx:117`, ไม่ได้รันในเบราว์เซอร์) |
| Export หลังแก้ข้อมูล | ตรงกับ UI | ตรงกับ UI | — | — | — | ✅ (ตรวจจากโค้ด: export ใช้ `currentProject` ที่ recompute ทุกครั้ง) |

## 5. Release gate bypass ที่พบ

| # | ช่องโหว่ | ที่ | ความรุนแรง |
|---|---|---|---|
| **B1** | source record **ว่าง** หรือ evidence `manual` ถูกจัดเป็น `DRAWING_VERIFIED` และปล่อยอัตโนมัติ — ใครก็สร้าง `provenance: {}` เพื่อข้าม `PROVENANCE_UNSPECIFIED` ได้ (รวมเทสต์ของรอบ 17 เอง) | `qsEngine.ts:1037-1040` | สูง |
| **B2** | ฟิลด์วิกฤต `missing` ที่มีค่า → `info` (ไม่ระบุว่าใครใส่ค่า); ฟิลด์วิกฤต `inferred` ไม่มี flag เลย (เฉพาะ `support` ที่มี) → ปล่อยอัตโนมัติ | `qsEngine.ts:1063-1073` | สูง (B2-a เป็นการลด validation จาก HEAD โดยรอบก่อน) |
| **B3** | "อนุมัติแบบกลุ่ม" อนุมัติทุก NEEDS_REVIEW ที่ไม่มี block และ confidence ≥ **75%** (ต่ำกว่าเกณฑ์ gate 80%) ด้วยคลิกเดียว รวมรายการ UNKNOWN (80%) และรายการที่มี warn สมมติฐาน → AUTO_RELEASE ทั้งหมด | `ReviewWorkspace.tsx:195-200` | สูง |
| **B4** | แก้ค่าแล้วกระจายไปยัง member tag เดียวกัน (`applyToSameTag`): member อื่นได้ค่าใหม่แต่ **ไม่ล้าง `review` เดิม** → approval เก่าครอบค่าใหม่ | `ReviewWorkspace.tsx:176-185` | ปานกลาง |
| **B5** | แก้ฟิลด์เดียว (ไม่กดอนุมัติ) → ทั้ง member เป็น `USER_CONFIRMED`, confidence ≥ 0.9, conflict ถูกลบ → ปล่อยอัตโนมัติโดยไม่มีบันทึกการอนุมัติ | `ReviewWorkspace.tsx:163-170`, `SectionTable.tsx:127-130`, `qsEngine.ts:1030` | ปานกลาง |
| **B6** | `restoreReview` เทียบเพียงจำนวน member + `tag@grid` ถ้าตรงจะ **แทนที่ผลอ่านใหม่ด้วย members ที่บันทึกไว้ทั้งชุด** → แบบ revision ใหม่ชื่อไฟล์เดิมจะแสดงมิติ/approval ของ revision เก่าโดยไม่เตือน | `App.tsx:105-121` | สูง (ข้อมูลผิดเงียบ) |
| **B7** | เส้นทาง block คืนผลโดยไม่มี `provenanceLevel` → export แสดง `UNKNOWN` แทน `DEFAULT_VALUE` | `qsEngine.ts` (ทางออก block), `excelWorkbook.ts:68` | ต่ำ (ป้ายผิด ไม่ปล่อยผิด) |

## 6. ข้อเสนอการตัดสินใจ: Manual Calculator (ยังไม่แก้โค้ด)

**ข้อเสนอ: คงเป็น `UNKNOWN` → NEEDS_REVIEW จนกว่า QS กดอนุมัติใน Review Workspace** (พฤติกรรมปัจจุบันหลังรอบ 17 — ไม่ต้องแก้โค้ด)

| ทางเลือก | ข้อดี | ข้อเสีย | ความเสี่ยง |
|---|---|---|---|
| **A. UNKNOWN + ต้องอนุมัติ (แนะนำ)** | ไม่มีทางลัด; การอนุมัติเข้า reviewLog มีเวลา/ค่า; สอดคล้องกับ "ค่าที่แบบไม่ได้ให้ต้องถูกติดธง" ใน CLAUDE.md | ผู้ใช้ต้องคลิกเพิ่ม 1 ครั้งต่อรายการ | ต่ำ — แต่ถ้า B3 ยังไม่ปิด รายการเหล่านี้ถูกอนุมัติแบบกลุ่มได้ (80% ≥ 75%) |
| B. USER_CONFIRMED เมื่อกดเพิ่มเข้าโครงการ | เร็ว; ผู้ใช้ "ยืนยัน" ด้วยการกดปุ่มอยู่แล้ว | การพิมพ์ ≠ การตรวจกับแบบ; ไม่มีอ้างอิงหน้าแบบ; ปุ่ม "เพิ่ม" กลายเป็นปุ่ม "อนุมัติ" โดยไม่รู้ตัว | สูง — ค่าที่พิมพ์ผิดหลุดเข้า BOQ เป็น AUTO_RELEASE |
| C. แบบ B แต่บังคับกรอกหน้าแบบ + ชื่อผู้ยืนยัน | มีหลักฐานขั้นต่ำ | ต้องเพิ่ม UI/ฟิลด์ | ปานกลาง — ยังไม่มีตัวตนผู้ใช้ที่ตรวจสอบได้ |

ถ้าเลือก A ควรปิด B3 ด้วย ไม่เช่นนั้นการอนุมัติแบบกลุ่มจะทำให้ A ไร้ผล

## 7. Regression

| ชุด | ผล |
|---|---|
| `tsx --test releaseGate.test.ts benchmark.test.ts` (เกี่ยวข้องโดยตรง) | 25/25 ผ่าน |
| `node --test qsEngine.test.ts` | 24/24 ผ่าน |
| `npm test` (ทั้งหมด) | 143/143 ผ่าน (37 + 106) |
| `npx tsc --noEmit` | ผ่าน |

ไม่มีการแก้เทสต์ในรอบ 17.1 — หมายเหตุ: เทสต์ที่ผ่านอยู่**ไม่ได้ครอบคลุม** B1–B7 (ไม่มีเทสต์ใดตรวจ record ว่าง, `inferred`, approval หลังแก้, bulk approve, หรือ restoreReview)

## 8. ความเสี่ยงที่ยังไม่ปิด

1. B1–B7 ข้างต้น (B1, B2, B3, B6 สำคัญที่สุด)
2. Audit trail ไม่มีตัวตนผู้อนุมัติ และเก็บใน `localStorage` เท่านั้น
3. ระดับ provenance ไม่ได้ร่วมตัดสินสถานะ — ความปลอดภัยพึ่ง flags ที่ต้องเพิ่มเองทีละกรณี
4. ตัวเลข Round 9–16 (false release, NEEDS_REVIEW) ล้าสมัยหลังรอบ 17 และยังไม่ได้รันใหม่
5. `scheduleParser` ใส่ `supportColW1/W2 = 0` ให้คาน — ยังไม่ได้ตรวจว่าถูกติดธง BEAM_SUPPORT_ASSUMED หรือไม่ (นอกขอบเขตรอบนี้)
6. ไม่ได้ตรวจในเบราว์เซอร์จริง — B3–B6 ตรวจจากโค้ด

## 9. ลำดับแก้ที่เสนอ (รอคำสั่ง)

1. B1: record ว่าง/`manual` → ไม่ใช่ DRAWING_VERIFIED + warn; แก้ `READ` ในเทสต์ให้มี evidence จริง
2. B3: bulk approve ใช้เกณฑ์ไม่ต่ำกว่า gate และข้ามรายการที่มี warn/UNKNOWN
3. B6: restoreReview ต้องเทียบ hash ไฟล์/มิติ ไม่ใช่แค่ tag@grid; ถ้าต่างให้ล้าง approval
4. B2: ฟิลด์วิกฤต `missing`-มีค่า และ `inferred` → warn
5. B4/B5: ล้าง approval ทุก member ที่ค่าเปลี่ยน; แก้ฟิลด์ไม่ยกระดับทั้ง member
6. เพิ่มเทสต์ตาม matrix นี้ (ทุกแถว ❌ เป็นเทสต์ที่ต้องล้มก่อนแก้)

---

## 10. การแก้ไขหลังผู้ใช้อนุมัติ (2026-11-03, ตามลำดับข้อ 9)

ไม่แตะสูตรปริมาณ ไม่แก้ ground truth ไม่ผ่อน gate ข้อใด — ทุกข้อทำให้เข้มขึ้น

| # | แก้ที่ | การเปลี่ยน |
|---|---|---|
| B1 | `qsEngine.ts` `classifyProvenanceLevel`, `provenanceFlags` | evidence ต้องเป็น `vision`/`pdf_text`/`dxf` จึงนับเป็นหลักฐานจากแบบ; record ว่างหรือ `manual` → ระดับ `UNKNOWN` + warn `PROVENANCE_UNSPECIFIED` (ยกเว้นเมื่อ QS อนุมัติ); กรณีที่เหลือคืน `UNKNOWN` แทน `DRAWING_VERIFIED` |
| B1 (เทสต์) | `qsEngine.test.ts` `READ`, `benchmark.test.ts` | เปลี่ยน record ว่างเป็น evidence `pdf_text` จริง (ค่าที่ assert ไม่เปลี่ยน) |
| B3 | `ReviewWorkspace.tsx` | **ลบปุ่ม "อนุมัติที่มั่นใจ ≥ 75%"** — เกณฑ์ที่ตกลง (≥ 80% และไม่มี warn/UNKNOWN) ไม่มีรายการ NEEDS_REVIEW ใดผ่านได้ (รายการที่ไม่มี block จะอยู่ใน NEEDS_REVIEW ได้ก็ต่อเมื่อมี warn หรือ < 80% เท่านั้น) ปุ่มจึงไม่มีประโยชน์ |
| B6 | `reviewLog.ts` `readingSignature` (ย้ายจาก `App.tsx`) | ลายเซ็นรวม tag, grid, จำนวน และทุกฟิลด์ใน `TRACKED_FIELDS` (มิติ, เสารองรับ, เหล็ก) → revision ใหม่ที่ค่าใดต่างจะไม่ถูกแทนด้วยรีวิวเก่า |
| B2 | `qsEngine.ts` `provenanceFlags` | ฟิลด์วิกฤต `missing` ที่มีค่า → warn `FIELD_VALUE_UNSOURCED` (เดิม info `FIELD_USER_PROVIDED`); ฟิลด์วิกฤต `inferred` → warn `FIELD_INFERRED` |
| B4 | `ReviewWorkspace.tsx` `decide()` | member tag เดียวกันที่ได้ค่าใหม่จะถูกล้าง `review` เดิม |
| B5 | `qsEngine.ts` | ฟิลด์ `reviewer` ที่ยังไม่อนุมัติ → warn `REVIEWER_EDIT_UNAPPROVED`; ฟิลด์ `reviewer` ไม่ยกระดับทั้ง member เป็น `USER_CONFIRMED` อีก (ใช้เฉพาะเมื่อไม่มีหลักฐานอื่น) |
| เทสต์ | `releaseGate.test.ts` (Round 17.1), `reviewLog.test.ts` | ครอบคลุม B1, B2, B5, approval, block, และลายเซ็น revision |

### Test matrix หลังแก้ (ผลจริง)

| กรณี | ก่อน | หลัง | ระดับหลังแก้ |
|---|---|---|---|
| Source record ว่าง | AUTO_RELEASE | **NEEDS_REVIEW** | UNKNOWN |
| evidence `manual` | AUTO_RELEASE | **NEEDS_REVIEW** | UNKNOWN |
| width `missing` แต่มีค่า | AUTO_RELEASE | **NEEDS_REVIEW** | DEFAULT_VALUE |
| length `inferred` | AUTO_RELEASE | **NEEDS_REVIEW** | ENGINEERING_ASSUMPTION |
| แก้ 1 ฟิลด์ ไม่อนุมัติ | AUTO_RELEASE (USER_CONFIRMED) | **NEEDS_REVIEW** | OCR_EXTRACTED |
| แก้ค่าหลังอนุมัติ (approval ยังติด) | AUTO_RELEASE | AUTO_RELEASE ที่ระดับ engine — UI ล้าง approval เมื่อค่าเปลี่ยนแล้ว (B4) | USER_CONFIRMED |
| กรณีอื่นทั้งหมดในหัวข้อ 4 | — | ไม่เปลี่ยน | — |

### การตรวจ

- `npm test` **145/145** ผ่าน (38 + 107), `npx tsc --noEmit` ผ่าน
- เบราว์เซอร์ (dev server, โครงการตัวอย่าง Villa Baan Suan): ไม่มี error ใน console; รายการแสดง "ไม่พบหลักฐานที่มา" และรอตรวจ; ไม่มีปุ่มอนุมัติแบบกลุ่ม; กดอนุมัติ 1 รายการ → ตัวนับรอตรวจลด 5 → 4
- ไม่ได้รัน `check:full` (ตามกฎ: ต้องรันบนสำเนา) — ไม่ได้เปิดแบบจริงหรือ OCR

### ผลกระทบที่ผู้ใช้จะเห็น

1. ชุดแบบจริง: ฟิลด์วิกฤตที่ reader อนุมาน (เช่น ช่วงคานจากกริด, ความสูงเสา, ขนาดฐานรากจากชื่อ) → รายการเข้า NEEDS_REVIEW มากขึ้น (ไม่กระทบความแม่นยำการอ่าน)
2. แก้ค่าโดยไม่กดอนุมัติ → รายการค้างในคิวรอตรวจจนกว่าจะอนุมัติ
3. รีวิวที่บันทึกในเบราว์เซอร์จากเวอร์ชันก่อนจะ **ไม่ถูกกู้คืนครั้งเดียว** เพราะรูปแบบลายเซ็นเปลี่ยน
4. ไม่มีปุ่มอนุมัติแบบกลุ่ม — QS อนุมัติรายชิ้น หรือยืนยันทั้งเบอร์ในตาราง "ตามเบอร์" (SectionTable)

### ยังไม่ปิด

- B7 (ป้าย provenance ของรายการที่ถูก block) — ไม่อยู่ในลำดับที่อนุมัติ
- Audit trail ยังไม่มีตัวตนผู้อนุมัติ และเก็บใน `localStorage`
- `SectionTable.confirm()` ยังแปลง `assumed`/`inferred` ทุกฟิลด์ของเบอร์เป็น `reviewer` และอนุมัติทั้งกลุ่มในคลิกเดียว (เป็นการกระทำของ QS โดยเจตนา แต่ยืนยันฟิลด์ที่อาจไม่ได้ดู)
- ตัวเลข benchmark/Round 16 ยังไม่ได้รันใหม่

*หยุดรอคำสั่ง — ยังไม่ commit*
