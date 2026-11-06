# StructBOQ Round 23 — Phase 0 (Measurement) + Phase 1 (Content Cache)

**วันที่:** 2026-11-05 · ไม่ได้ commit/push · ไม่ได้แก้สูตรหรือ gate · ไม่ได้ตั้ง `FULL_BOQ` · ไม่ได้เปิดแบบจริง

**ที่มา:** ทำตาม roadmap ใน `tools/STRUCTBOQ_ROUND23_ARCHITECTURE_AUDIT.md` (ผู้ใช้อนุมัติ Phase 0 + 1) และคัดลอก audit report เข้า `tools/` แล้ว

## สรุป
| ส่วน | สถานะ | หลักฐาน |
|---|---|---|
| Phase 0: คะแนนการอ่านแยกตามชนิดค่าและชนิดชิ้น + ผล JSON | **VERIFIED** — unit test + เทียบเดิม/ใหม่บนแบบจริง (สำเนา) ตรงทุกบรรทัด | `tools/readingScore.test.ts`, หัวข้อ 5 |
| Phase 0: เวลาและหน่วยความจำต่อหน้าในผลการอ่าน + แสดงในบันทึกการอ่าน | **VERIFIED** (เบราว์เซอร์) | หัวข้อ 4 |
| Phase 1: cache ผล OCR ต่อหน้า (IndexedDB) | **VERIFIED** (unit + เบราว์เซอร์) | หัวข้อ 4 |
| Regression | **VERIFIED** — `npm test` 226/226, tsc, build, `--verify dist`, parity identical, benchmark 0/28 auto / 0 false release | หัวข้อ 5 |

## 1. Files Changed
| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `tools/readingScore.ts` (ใหม่) | ย้ายตัวให้คะแนนออกจาก `eval_reading` มาเป็นฟังก์ชัน pure `scoreReading()` (logic เดิม) + นับแยก `byCategory` (grid, tag, count, dimension, rebar) และ `byType` (FOOTING, COLUMN, …) |
| `scripts/eval_reading.ts` | ใช้ `scoreReading`; บรรทัดสรุปเดิมคงเดิมทุกตัวอักษร; เพิ่มบรรทัดแยกตามชนิดค่าและชนิดชิ้นต่อ split; `--json <file>` สำหรับเทียบก่อน/หลัง |
| `src/pdf/pdfText.ts` | `PageTiming`, `timingSummary()` (median/p90 ของ OCR ต่อหน้า, จำนวนหน้าที่ใช้ cache, heap สูงสุดเฉพาะเมื่อ browser รายงาน); `ProcessLog` เพิ่ม `ocr-cache` |
| `src/pdf/pageCache.ts` (ใหม่) | key = `SHA-256 ไฟล์ : เลขหน้า : OCR identity`; `cachedRead/cacheWrite` (เก็บไม่ได้ = miss); `indexedDbStore()`; `memoryStore()` สำหรับเทสต์ |
| `src/pdf/ocrIdentity.ts` (ใหม่) | identity ของโค้ดการอ่าน: Node คำนวณจาก source; เบราว์เซอร์ใช้ค่าจาก Vite plugin |
| `scripts/gen_engine_identity.ts` | `currentOcrIdentity()` = SHA-256 ของทุกไฟล์ใน `src/pdf` (ไม่รวม test) + version ของ tesseract.js, @gutenye/ocr-models, onnxruntime-web, pdfjs-dist; plugin เสิร์ฟ `OCR_ID` และ invalidate เมื่อไฟล์ใน `src/pdf` เปลี่ยน |
| `src/pdf/browserPipeline.ts` | อ่าน cache ก่อน OCR; หน้าที่มี cache ไม่ต้อง classify และ OCR; โหลด OCR engine เฉพาะเมื่อมีหน้าที่ cache ไม่มี; เขียน cache หลัง OCR (ก่อนเติมคำจาก text layer); ส่งคืน `timing` |
| `src/App.tsx` | ส่ง `fileSha` ให้ pipeline; ส่ง `timing` ให้บันทึกการอ่าน |
| `src/components/ReadingLog.tsx` | บรรทัด "เวลาอ่าน … · OCR n หน้า (มัธยฐาน … วิ/หน้า, p90 …) · ใช้ผล OCR เดิม n หน้า · หน่วยความจำ JS สูงสุด … MB" |
| `tools/readingScore.test.ts`, `src/pdf/pageCache.test.ts` (ใหม่), `package.json` | เทสต์ |

**ผลข้างเคียงที่ตั้งใจ:**
- `scripts/gen_engine_identity.ts` เป็นส่วนหนึ่งของ engine identity (R20.2) การแก้รอบนี้จึงเปลี่ยน `engineId`
- approval ที่บันทึกในเบราว์เซอร์จะเป็น STALE และต้องอนุมัติใหม่ ซึ่งเป็นพฤติกรรมที่ออกแบบไว้ ไม่ใช่การแก้สูตร

## 2. Phase 0 — การวัดผล
- **`eval_reading`:**
  - บรรทัดเดิม (ต่อชุด และรวม dev/held-out) ยังพิมพ์เหมือนเดิม
  - เพิ่ม "แยกตามชนิดค่า" (grid / tag / count / dimension / rebar) และ "แยกตามชนิดชิ้น" (FOOTING / COLUMN / BEAM / SLAB / GRID)
  - `--json` เขียนผลทุกชุดพร้อมการแยกกลุ่ม ไว้ใช้ diff ก่อน/หลังการปรับ reader
- **ยังไม่ได้วัดกับแบบจริง:** `eval_reading` ต้องใช้ `FULL_BOQ`
  - ได้เก็บสำเนา `eval_reading.ts` เดิมไว้ใน scratchpad
  - ควรรันทั้งเดิมและใหม่บนสำเนา `real_drawings` แล้วยืนยันว่าบรรทัดสรุปตรงกัน (83% / 3% / 14%)
- **ตัวชี้วัดที่ยังวัดไม่ได้ เพราะ answer key ยังไม่มีข้อมูลนี้ (NOT IMPLEMENTED):**
  - sheet classification accuracy (key ยังไม่ระบุชนิดแผ่นรายหน้า)
  - cross-view / duplicate precision-recall และ false merge (key ยังไม่มีคู่ชิ้น)
  - OCR CER/WER (key ยังไม่มีคำรายคำ)
  - ต้องขยาย answer key ก่อน ห้ามเดาค่าความจริง
  - quantity error % เทียบ ปร.4 มีอยู่แล้วใน `benchmark_offline`
- **เวลา/หน่วยความจำ:**
  - `BrowserExtraction.timing` มีเวลารวม, เวลาแต่ละ phase, เวลาต่อหน้าพร้อมวิธีอ่าน (OCR / cache / skipped), median/p90 ของหน้าที่ OCR และ heap JS สูงสุด
  - heap มีเฉพาะ Chrome (`performance.memory`) browser อื่นแสดงว่าไม่มีค่า ไม่ประมาณเอง
  - ยังไม่วัด VRAM

## 3. Phase 1 — Content Cache
- **ใช้ cache เมื่อ:** มี SHA-256 ของไฟล์ (เฉพาะไฟล์ที่อัปโหลด; ชุดข้อมูลใช้ `offline_ocr.json` อยู่แล้ว) และ OCR identity ตรวจได้
  - hash ไม่ได้ (crypto ถูกปฏิเสธ) หรือ identity เป็น `UNVERIFIED` → ไม่อ่านและไม่เขียน cache
- **key:** `fileSha:page:OCR_ID`
  - ไฟล์อื่น (แม้ชื่อเดียวกัน), หน้าอื่น หรือโค้ดการอ่านที่แก้แล้ว → miss
  - OCR_ID รวมทุกไฟล์ใน `src/pdf` แก้ reader ก็ทำให้ cache หลุด (เกินจำเป็น แต่ปลอดภัย) และรวม version ของ OCR/PDF package
- **ค่าที่เก็บ:** ผลของ `ocrPdfPage` ตามที่ OCR ให้ (ก่อนเติมคำจาก text layer ซึ่งคำนวณใหม่ทุกครั้ง) → reader และ merge ได้ input เดิม
- **การจัดการปัญหา:** เก็บไม่ได้หรืออ่านไม่ได้ (quota เต็ม, ถูกบล็อก) → miss แล้วอ่านหน้าใหม่ ไม่ error
- **หลักฐานย้อนกลับ:** `processLog` บันทึก `ocr-cache` แทน `ocr` ส่วนบันทึกการอ่านแสดง "ใช้ผล OCR เดิม n หน้า"
- **ข้อจำกัด:**
  - ไม่มีการลบ cache เก่าอัตโนมัติ และไม่มีปุ่มล้าง cache
  - ไม่รวม provider ของ OCR (WebGPU/WASM) ใน key — **ASSUMPTION** จากรายงานเดิมว่าทั้งสองให้ผลตรงกัน 100% บน 5 หน้า ยังไม่ได้ทดสอบทุกกรณี
  - ไม่ได้ cache ผล classify ของโหมดอ่านทั้งไฟล์ (ใช้เวลาแค่ 50–150 ms ต่อหน้า)

## 4. หลักฐานจากเบราว์เซอร์ (dev server, PDF ทดสอบ 5 หน้าที่มี stroke เลือกหน้า 2 และ 5, cache ล้างก่อนเริ่ม)
| รอบ | processLog | เวลา | ผล |
|---|---|---|---|
| 1. เปิดครั้งแรก | `text:2 text:5 stroke-scan:2 stroke-scan:5 ocr:2 ocr:5` | รวม 9,586 ms (โหลด engine 449 ms, median OCR 4.4 วิ/หน้า), heap สูงสุด 108 MB | F2 (หน้า 2, กว้าง 1.2), F5 (หน้า 5) |
| 2. เปิดไฟล์เดิมซ้ำ | `… ocr-cache:2 ocr-cache:5` | รวม **76 ms** (ไม่โหลด engine, OCR 0 หน้า) | **เหมือนรอบ 1 ทุกอย่าง:** members, readings (JSON เท่ากัน) และจำนวนคำ 304/304 |
| 3. ไฟล์ชื่อเดิม bytes ต่าง (หน้า 2 เขียน 1.90) | `… ocr:2 ocr:5` | 8,983 ms | F2 กว้าง 1.9 — ไม่ใช้ cache ของไฟล์เดิม |

- บันทึกการอ่านแสดง: "เวลาอ่าน 9.0 วินาที · OCR 2 หน้า (มัธยฐาน 4.4 วิ/หน้า, p90 4.5 วิ) · หน่วยความจำ JS สูงสุด 151 MB" (`tools/artifacts/round23_phase0_1/01_reading_timing_line.jpg`)
- console ไม่มี error
- **ข้อควรระวัง:** ตัวเลขเวลาเป็นของ PDF สังเคราะห์ ไม่ใช่ประสิทธิภาพกับแบบจริง

## 5. Tests และ Regression (วัดจริง)
- `npm test` **226/226** (39 + 187; เพิ่ม 6 จาก 220)
  - `readingScore.test.ts` (2): ทุก field ถูกนับครั้งเดียวทั้งในชนิดค่าและชนิดชิ้น (15 = 15 = 15), notes เดิม, การเทียบเหล็ก
  - `pageCache.test.ts` (4):
    - key ต่างตามไฟล์ / หน้า / โค้ด และเป็น null เมื่อไม่มี hash หรือ identity
    - ค่าที่เก็บไม่ถูกแก้ตามเมื่อแก้ object ภายหลัง
    - store เสียแล้วไม่ error
    - OCR identity เปลี่ยนเมื่อแก้ไฟล์ reader หรือ package version และไม่เปลี่ยนเมื่อแก้ไฟล์ test
    - timing summary
- tsc ผ่าน · build ผ่าน · `--verify dist` OK · bundle ไม่มีโค้ด Node ของ generator
- **Parity:** identical กับรอบ 22.1
- **Benchmark probe:** 28 รายการ, auto 0, false release 0
- **`check:full`:** รันบน**สำเนา**ใน scratchpad ด้วย `FULL_BOQ=1` หลังผู้ใช้อนุญาต อ่านแค่ OCR cache
  - **`eval_reading` เดิม vs ใหม่** (ชุดพัฒนา 4 ชุด, `--detail`): ผลตรงกัน**ทุกบรรทัด** (55 บรรทัด รวม note รายค่าทุกตัว) — ยืนยันว่าการย้าย logic ไม่เปลี่ยนคะแนน (รวม: ถูก 83% · ผิด 3% · ไม่พบ 14%)
  - **benchmark_offline:** 5 ชุด identical กับรอบ 22.1 ทุก field
  - **baseline ต้นฉบับ:** SHA-256 ไม่เปลี่ยน และ git ไม่เห็นการแก้ใน `real_drawings/`

## 5.1 Breakdown ตั้งต้นของแบบจริง (ชุดพัฒนา house_ready_1..4 — **VERIFIED** วัดจริง, JSON อยู่ใน scratchpad `eval_new.json`)
| ชนิดค่า | ถูก | ผิด | ไม่พบ | n |
|---|---|---|---|---|
| grid | 100% | 0% | 0% | 8 |
| tag | 95% | 0% | 5% | 42 |
| count | 84% | **16%** | 0% | 32 |
| dimension | 92% | 1% | 7% | 87 |
| rebar | 62% | 1% | **37%** | 71 |

| ชนิดชิ้น | ถูก | ผิด | ไม่พบ | n |
|---|---|---|---|---|
| FOOTING | 93% | 0% | 7% | 84 |
| COLUMN | 80% | 5% | 15% | 20 |
| BEAM | 78% | 4% | 19% | 113 |
| SLAB | 60% | **13%** | 27% | 15 |

**อ่านผล** (ชุดพัฒนาเท่านั้น ไม่ใช่ held-out; จำนวนตัวอย่างของบางกลุ่มน้อย เช่น SLAB = 15):
- **ค่าที่ผิดมากที่สุดคือจำนวนชิ้น (count 16%)** — เป็นค่าที่ "ดูน่าเชื่อแต่ผิด" จึงเสี่ยงที่สุดต่อ BOQ
- **ค่าที่หายมากที่สุดคือเหล็กเสริม (37%)**
- ทั้งสองเรื่องเป็นเป้าที่วัดผลได้สำหรับการปรับ reader รอบถัดไป

## 6. ขั้นต่อไป
1. ~~รัน `eval_reading` (เดิม vs ใหม่) และ `check:full` บนสำเนา~~ — ทำแล้ว (หัวข้อ 5, 5.1)
2. ขยาย answer key: ชนิดแผ่นรายหน้า และคู่ชิ้นข้าม view สำหรับวัด classification และ cross-view
3. Phase 2 (ลิงก์ schedule ↔ ผัง) ตาม roadmap
