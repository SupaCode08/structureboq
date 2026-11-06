# แผนงานถัดไป (ให้ Sonnet เขียนโค้ด) — 2026-11-06

อ่านก่อนเริ่ม: `CLAUDE.md`, `AGENTS.md`, `tools/STRUCTBOQ_ROUND23_STEP3_SPEED_DESIGN.md` (หัวข้อ 7–8.6), `tools/STRUCTBOQ_ROUND23_PHASE0_2_ERROR_ANALYSIS.md`

## กติกาทุกงาน (ห้ามข้าม)
- ห้าม commit / push จนกว่าผู้ใช้สั่ง · ห้ามแก้ `real_drawings/*/answer_key.json` หรือ baseline ใด ๆ
- ระหว่างเขียนโค้ดใช้ `npm test` เท่านั้น · **ห้ามรัน `FULL_BOQ=1 npm run check:full` ในที่** (มันเขียนทับ `real_drawings/*/benchmark_offline.json`) — ถ้าต้องตรวจเต็ม ให้คัดลอก `real_drawings` ไป scratchpad แล้วรันสคริปต์บนสำเนา, เทียบ SHA-256 ของต้นฉบับก่อน/หลังว่าไม่เปลี่ยน และ**ขออนุญาตผู้ใช้ก่อน**
- ห้าม re-OCR / render หน้า PDF จริง / ตั้ง `FULL_BOQ` เว้นแต่ผู้ใช้สั่งในงานนั้น · ชุด held-out (`cdc_2`, `cdc_3`, `carpark_srinakorn`, `thaisuk_5..8`) วัดอย่างเดียว ห้ามปรับกฎตาม
- กฎ reader ต้องทั่วไป ห้ามค่าคงที่เฉพาะชุดข้อมูล · ค่าที่แบบไม่ได้ให้ต้องติดธง (assumed) ห้ามทำเหมือนอ่านได้
- งานที่เปลี่ยนผลการอ่าน: ถ้าวัดแล้วไม่ดีขึ้นหรือมีค่าถูกกลายเป็นผิด → **revert** (เคยทำแล้วสองครั้งในรอบ 23)
- ตอบ/รายงานเป็นภาษาไทย · ไม่รู้สาเหตุให้เขียน UNKNOWN ห้ามเดา

## สถานะตอนนี้ (ยังไม่ commit)
- อ่านหลายหน้าพร้อมกัน: `src/pdf/lanes.ts` (+test), `src/pdf/browserPipeline.ts` (lane loop, lane เพิ่มเฉพาะหน้าเวกเตอร์, `raceAbort`), `src/pdf/pdfOcrPipeline.ts` (`isVectorTextPage`, `VECTOR_TEXT_MIN_STROKES`)
- จำหน้าที่เลือกต่อไฟล์: `src/pdf/pageSelection.ts` (`rememberSelection`/`recallSelection`), `src/components/PageSelector.tsx`
- `npm test` 39 + 197 ผ่าน · ตรวจในเบราว์เซอร์แล้ว (dev mode เท่านั้น)

---

## งาน 1 — ปิดงานความเร็วให้ครบด่าน (ไม่เขียนโค้ดใหม่ ถ้าไม่เจอปัญหา)
1. `npm run build` แล้ว `npx tsx scripts/gen_engine_identity.ts --verify dist` ต้องผ่าน
2. เปิด preview `structboq-static` (production build) ด้วย `preview_start` → โหลด house_ready_4 จาก `/datasets/dpt-house-ready-4/Bann_Sumrejroop04.pdf` (วิธี: fetch → `DataTransfer` → `input[type=file]` change, ดู §8 ของเอกสารความเร็ว) เลือกหน้า 24,25,26,37,39 → บันทึกเวลาจากบรรทัด "เวลาอ่าน …" และจำนวนรายการ (dev ได้ 30.3–34.3 วิ, 45 รายการ)
3. **ขออนุญาตผู้ใช้** แล้วรัน check:full บนสำเนาใน scratchpad (ไม่ใช่ในที่) → รายงานเฉพาะบรรทัดสรุป และยืนยัน SHA-256 ต้นฉบับไม่เปลี่ยน
- เสร็จเมื่อ: build ผ่าน, เวลา production บันทึกแล้ว, check:full ไม่มี regression
- ถ้าเจอปัญหา: หยุดและรายงาน ห้ามแก้ reader เพื่อให้ผ่าน

## งาน 2 — ปุ่มยกเลิกระหว่างอ่านแบบ (UI)
ปัญหา: pipeline รับ `abortSignal` และ reject ทันทีแล้ว (`raceAbort`) แต่**ไม่มีที่ใดในแอปส่ง signal** — ผู้ใช้หยุดการอ่านไม่ได้ (ปุ่ม "ยกเลิก" ใน `PageSelector` ถูก disable ตอน busy)
- ไฟล์: `src/App.tsx` (`processPdf` → `extractInBrowser(..., { abortSignal })`), `src/components/UploadSection.tsx` (แสดงปุ่มยกเลิกใต้แถบ progress ขณะ `progress` มีค่า)
- ทำ: สร้าง `AbortController` ต่อการอ่านหนึ่งครั้ง เก็บใน `useRef`; ปุ่ม "หยุดอ่าน" เรียก `abort()`; จับ `AbortError` แล้วคืน UI สู่สถานะก่อนอ่าน (ไม่ใช่ข้อความ error สีแดง) แสดงข้อความสั้น "หยุดการอ่านแล้ว"
- ห้าม: ทิ้งผลการอ่านเดิมที่ผู้ใช้ตรวจไว้แล้ว (ถ้ามีผลเก่า ให้คงไว้ ไม่ทับด้วยผลว่าง) · ห้ามเขียน cache หน้าที่อ่านไม่เสร็จ (cache เขียนหลัง OCR ต่อหน้าอยู่แล้ว — ตรวจว่าหน้าที่ถูกยกเลิกกลางคันไม่ถูกเขียน)
- เสร็จเมื่อ: ในเบราว์เซอร์ กดหยุดระหว่างอ่าน 6 หน้า → UI กลับมาภายใน 1 วิ, console ไม่มี unhandled rejection, อ่านใหม่ทันทีได้ผลปกติ · `npm test` ผ่าน · เพิ่ม test เฉพาะถ้ามี logic ใหม่ที่แยกได้ (ไม่ต้องทำ test UI)

## งาน 3 — ตามหาสาเหตุ rebar "ไม่พบ" ที่ถูกที่สุด (อ่านอย่างเดียวก่อน แล้วหยุดรออนุมัติ)
ใช้ OCR cache ที่มีอยู่ (`real_drawings/<set>/offline_ocr.json`) + `readSheets` → `mergeSheetReadings` บน**สำเนา** เหมือนสคริปต์ trace ในรอบ 23 (ตัวอย่าง: scratchpad `trace_counts.mts`, `probe/trace3.mts`) — ไม่ต้องเปิด PDF
1. **R24 — house_ready_2 B3 ปลอก (key RB6@0.175):** cache หน้า 39 มีคำ `ø6@0.175` (conf 90) หลายตัว และ `parseBarNote('ø6@0.175')` อ่านได้ (dia 6, s 0.175) แต่ B3 ไม่ได้ปลอก → หาว่าคำนั้นอยู่ในพื้นที่ของหน้าตัดไหน และทำไม B3 ไม่ได้ (ดู `sheetReader.ts` ~L1335–1366: `inRegion`, `mine`, `stirrupNote`)
2. **R21–R23 — house_ready_1 B1 (หน้าตัดที่อ่านชื่อไม่ได้ เหล็กไปติดชิ้นอื่น):** หาตำแหน่งชื่อหน้าตัดในคำ OCR และคำที่ใกล้ที่สุด
3. **B1 ของ house_ready_4:** โน้ต `.@0.15` อยู่ใต้ชื่อหน้าตัด แต่ reader รับเฉพาะโน้ตเหนือชื่อ (`cy(o) < y - 0.004`) — วัดว่าในชุดพัฒนาทั้งหมดมีกี่หน้าตัดที่โน้ตอยู่ใต้ชื่อ (นับอย่างเดียว ห้ามเปลี่ยนกฎ)
- ผลที่ต้องส่ง: ต่อรายการ — สาเหตุ (หรือ UNKNOWN), หลักฐาน (หน้า, ตำแหน่ง, คำ), ฟังก์ชัน/บรรทัด, ข้อเสนอแก้ที่เล็กที่สุด + ความเสี่ยง · **หยุดรออนุมัติก่อนแก้โค้ด reader**
- ถ้าอนุมัติให้แก้: แก้ทีละสาเหตุ, เพิ่ม test fixture เล็กใน `src/pdf/fixtures/` (ห้ามใช้ข้อมูลจริงใน test), วัดด้วย eval_reading บนสำเนา (ต้องขออนุญาต `FULL_BOQ=1`) เทียบก่อน/หลังทุกชุดพัฒนา — ค่าถูกต้องไม่ลด ค่าผิดต้องไม่เพิ่ม ไม่งั้น revert

## งาน 4 — ปรับจำนวน lane (เล็ก, ทำหลังงาน 1)
- วัดในเบราว์เซอร์ (production) house_ready_4 หน้า 24–28,37–39 ด้วย 2 lanes vs 3 lanes (ตั้งค่าโดย override `navigator.hardwareConcurrency` ในคอนโซล: 8 → 2 lanes, 12 → 3 lanes) บันทึกเวลาและหน่วยความจำ JS สูงสุด
- ถ้า 2 lanes ช้ากว่า 3 lanes ไม่ถึง 10% แต่ใช้หน่วยความจำน้อยกว่ามาก → เปลี่ยนเพดานใน `laneCount` เป็น 2 พร้อมแก้ test; ไม่งั้นคงไว้ และเขียนผลลงเอกสารความเร็ว §8

---

## งาน 5 — ด่าน "OCR ปัจจุบัน" (ผู้ใช้เลือกทาง (ก), 2026-11-06)
เหตุผล: `real_drawings/*/offline_ocr.json` ไม่ตรงกับโค้ด OCR ปัจจุบัน (re-OCR ได้คำซ้ำ 74%; ทุกหน้าโครงสร้าง 3 บ้าน 75% ถูก / 6% ผิด vs cache เดิม ~83% / 3%) → `check:full` วัด OCR เก่า · **ตัดสินแล้ว: คง cache เดิมเป็นด่านของ reader ไม่แตะ** และเพิ่มด่านแยกที่ OCR ด้วยโค้ดปัจจุบัน
- ไฟล์ใหม่ `scripts/check_ocr_current.ts` — เรียก `requireFullBoq('check_ocr_current.ts')` บรรทัดแรก (เหมือน `scripts/eval_reading.ts`) · ไม่อยู่ใน `npm test` และไม่อยู่ใน `check:full`
- ทำ:
  1. ชุด: `house_ready_1`, `house_ready_2`, `house_ready_4` (ชุดพัฒนาที่เป็นหน้าเวกเตอร์) · หน้า = `structuralPages` ใน `manifest.json` ของแต่ละชุด
  2. OCR ด้วย `scripts/offline_ocr.ts` (spawn เป็น child process, env `FULL_BOQ=1 PADDLE=0`, 3 ชุดพร้อมกัน) เขียนผลลง**โฟลเดอร์ชั่วคราว** (`os.tmpdir()` หรือ `--out <dir>`) — **ห้ามเขียนลง `real_drawings/`**
  3. ต่อชุด: โหลด `offline_ocr.json` เดิม (อ่านอย่างเดียว) แทนหน้าที่ OCR ใหม่ด้วยผลใหม่ → `readSheets` → `mergeSheetReadings` (ตั้งค่าเหมือน `eval_reading.ts`) → `scoreReading` จาก `tools/readingScore.ts`
  4. พิมพ์ต่อชุด: ถูก/ผิด/ไม่พบ, ตามหมวด (`byCategory`), เวลา OCR รวม, `OCR_ID` (จาก `currentOcrIdentity()` ใน `scripts/gen_engine_identity.ts`)
  5. เทียบกับ `tools/benchmark/ocr_current_baseline.json` ถ้ามี: **ล้ม (exit 1)** เมื่อชุดใดค่าผิด (`wrong`) เพิ่ม หรือค่าถูก (`right`) ลด · พิมพ์รายการค่าที่เปลี่ยน (จาก `notes`) ก่อน/หลัง
  6. `--write-baseline` เขียน baseline (ชุด, right/wrong/missing, byCategory, OCR_ID, วันที่) — **ใช้เฉพาะเมื่อผู้ใช้สั่ง**
- test: แยกส่วนเทียบ baseline เป็นฟังก์ชันบริสุทธิ์ (เช่น `compareOcrBaseline(prev, now)` ใน `tools/`) แล้วเขียน test เล็กด้วยข้อมูลสังเคราะห์ ลงทะเบียนใน script `test` ของ `package.json` · ห้าม test ที่เปิด PDF จริง
- ค่าอ้างอิงที่วัดไว้ (300 DPI, 2026-11-06, ใช้ตรวจว่าสคริปต์ให้ผลสมเหตุสมผล ไม่ใช่ baseline): house_ready_1 ถูก 37 / ผิด 5 / ไม่พบ 10 · house_ready_2 48 / 3 / 6 · house_ready_4 48 / 3 / 18 (OCR นิ่ง รันซ้ำควรได้เท่าเดิม)
- เสร็จเมื่อ: รันครั้งแรก (**ขออนุญาตผู้ใช้ก่อน**, ใช้เวลาราว 4–5 นาที) ได้ตัวเลขตรงค่าอ้างอิง ±0, ผู้ใช้สั่งเขียน baseline แล้ว, รันซ้ำผ่าน, `npm test` ผ่าน, SHA-256 ของ `real_drawings/*` ไม่เปลี่ยน
- เพิ่มบรรทัดใน `CLAUDE.md` หัวข้อ "never cut": สคริปต์นี้คือด่าน OCR ปัจจุบัน รันเมื่อแก้โค้ดใน `src/pdf/` ที่กระทบ OCR (ไม่ใช่ทุกครั้ง) — **แสดง diff ให้ผู้ใช้ดูก่อนแก้ CLAUDE.md**

## ไม่อยู่ในแผน (วัดแล้วไม่คุ้ม — ห้ามทำซ้ำโดยไม่มีหลักฐานใหม่)
ลด DPI (200/250 ค่าผิดเพิ่ม) · ตัดรอบ OCR แนวหมุน (count ผิด 19%→45%) · ใช้ engine เดียว (rebar ตก) · OCR ทีละบรรทัด `LABELS=1` (ผลไม่นิ่งข้ามบ้าน) · ให้ตัวอ่านรูปตัวอักษรแทน OCR (สร้างซ้ำได้ ≤18%) · คัดหน้าอัตโนมัติด้วยเลขแผ่น/นับ tag (พลาดหน้าโครงสร้าง 9–11/20) · ปรับ glyphRead (@/ø) และการจัดบรรทัด (วัดแล้วคะแนนไม่ขยับ)

---
## สถานะ (2026-11-06)
- งาน 1: build + identity ผ่าน, production 39.1 วิ/5 หน้า, check:full บนสำเนา = เหมือนรอบก่อน (ไม่มี regression) — ดู §8.7, §8.9 ของเอกสารความเร็ว
- งาน 2: ปุ่ม "หยุดอ่าน" เสร็จ (§8.8) · งาน 3: รายงานอ่านอย่างเดียวเสร็จ `tools/STRUCTBOQ_REBAR_NOTFOUND_TRACE.md` — **รออนุมัติก่อนแก้ reader** · งาน 4: คง 3 lanes (§8.10)
- งาน 5: เขียนเสร็จ `scripts/check_ocr_current.ts` + `tools/ocrBaseline.ts` (+test, `npm test` 39 + 202 ผ่าน) · **ยังไม่ได้รันจริง และยังไม่มี baseline** — รอผู้ใช้อนุญาตรันครั้งแรก (~4–5 นาที) แล้วสั่งเขียน baseline · บรรทัดเสนอเพิ่มใน `CLAUDE.md` รออนุมัติ
- งาน 5 รันครั้งแรกแล้ว (2026-11-06): OCR 563 วิ (~9.5 นาที, 49 หน้า, 3 ชุดพร้อมกัน) · ผลตรงค่าอ้างอิงทุกตัว: house_ready_1 ถูก 37 / ผิด 5 / ไม่พบ 10, house_ready_2 48 / 3 / 6, house_ready_4 48 / 3 / 18 · SHA-256 ของ `real_drawings/house_ready_{1,2,4}` ไม่เปลี่ยน · ยังไม่ได้เขียน baseline (รอผู้ใช้สั่ง `--write-baseline`) · OCR code id 9e2d2863…
- งาน 5: **เขียน baseline แล้ว** `tools/benchmark/ocr_current_baseline.json` (2026-11-06, OCR code id 9e2d2863…; house_ready_1 37/5/10, house_ready_2 48/3/6, house_ready_4 48/3/18) จากผลรอบ 563 วิ โดยเพิ่มตัวเลือก `--from <dir>` ให้ให้คะแนนผล OCR ที่ทำไว้แล้ว (รับเฉพาะเมื่อ `ocr_id.txt` ในโฟลเดอร์ตรงกับรหัส OCR ปัจจุบัน) · รันเทียบกับ baseline ผ่าน (±0 ทุกชุด) · `real_drawings/*` ไม่เปลี่ยน · `CLAUDE.md` ยังไม่แก้ (รอผู้ใช้) · baseline นี้ใช้ตัดสิน regression ของ OCR ในแอป ไม่ใช่ค่าที่ "ถูกต้อง" (rebar ไม่พบ 38–67%)
- CLAUDE.md: เพิ่มบรรทัดด่าน OCR ปัจจุบันใต้บรรทัด check:full แล้ว (2026-11-06)
