# StructBOQ Round 20.2 + Round 21 — Engine Identity Hardening & Visual PDF Page Selection

**วันที่:** 2026-11-04 · ไม่ได้ commit/push · ไม่ได้ใช้ paid API · ไม่ได้เปิดหรือประมวลผลแบบจริง (ใช้ PDF ทดสอบที่สร้างเอง 5 และ 3 หน้า)

## 1. Executive Summary

**Round 20.2 — engine identity**
- ไม่มีไฟล์ identity ที่สร้างไว้ล่วงหน้าแล้ว จึงไม่มีค่าเก่าค้างได้ identity คำนวณจาก source ทุกครั้งที่ engine โหลด:
  - **Node:** tests, npm scripts, direct scripts และ benchmark คำนวณตอน engine โหลด
  - **Vite:** dev และ build คำนวณตอน serve หรือ build; ตอน dev คำนวณใหม่เมื่อ source ของ engine เปลี่ยน
- **ขอบเขต:** ครอบ dependency ที่ engine ใช้จริง โดยอ่านจาก metafile ของ esbuild
- **ส่วนแสดงผล:** ข้อความ `message:` ของ flag ถูกตัดออก แก้ข้อความแล้ว approval จึงไม่หลุด
- **Production build:** มี `engine-identity.json` และคำสั่งตรวจ artifact
- **Fail-closed:** ถ้าคำนวณ identity ไม่ได้ → `UNVERIFIED` → อนุมัติไม่ปล่อยยอด

**Round 21 — visual page selection**
- อัปโหลด PDF แล้วเห็น thumbnail ทุกหน้า ติ๊กเลือกหน้าได้ และมีปุ่ม เลือกทั้งหมด / ไม่เลือก / สลับ
- **อ่านเฉพาะหน้าที่เลือก:** text layer, stroke scan, OCR และ text sheet ทั้งหมด พิสูจน์ด้วย execution log จริงในเบราว์เซอร์และ spy บน `getPage` ใน Node
- **เลขหน้า:** ยังเป็นเลขหน้าต้นฉบับตลอดทาง จนถึง Excel และบันทึกการอนุมัติ
- **ผูกกับไฟล์:** selection ผูกกับ SHA-256 ของไฟล์; เปลี่ยนไฟล์แล้ว selection reset และไม่มีข้อมูลปนกัน

**ผลรวม**
- `npm test` **201/201** (39 + 162)
- tsc ผ่าน, build ผ่าน, verify build identity ผ่าน
- parity เหมือนเดิมทุกตัว, benchmark 0/28 auto และ 0 false release (เท่าเดิม)
- **ไม่แก้สูตรคำนวณ ไม่แตะ gate และไม่แตะ provenance**

## 2. ไฟล์ที่แก้ไข
| ไฟล์ | ประเภท | การเปลี่ยนแปลง |
|---|---|---|
| `scripts/gen_engine_identity.ts` | แก้ (เขียนใหม่ภายในไฟล์เดิม) | `engineSources()` (dependency จาก esbuild metafile), `calculationCode()` (ตัด comment/type/whitespace และค่าของ `message:` ด้วย AST ของ rolldown), `engineIdentityOf()` (รวม source ของ generator เอง), `currentEngineIdentity()`, `verifyBuildIdentity()`, `engineIdentityPlugin()` (Vite), CLI `--verify` |
| `src/engine/engineIdentity.ts` | ใหม่ | ใน Node คำนวณ identity จาก source ตอนโหลด (top-level await); ล้มเหลว → `UNVERIFIED` |
| `src/engine/engineIdentity.gen.ts` | **ลบ** | ไม่มีไฟล์ identity ที่สร้างไว้ล่วงหน้าอีก |
| `src/engine/qsEngine.ts` | แก้ 2 บรรทัด | import จาก `engineIdentity.ts`; ข้อความ `ENGINE_IDENTITY_UNVERIFIED` |
| `vite.config.ts` | แก้ | ใช้ `engineIdentityPlugin()` |
| `package.json` | แก้ | ลบ `pretest`; เพิ่ม test 2 ไฟล์ |
| `src/pdf/pdfText.ts` | แก้ (เพิ่มท้ายไฟล์) | `readTextLayers()` + `ProcessLog` |
| `src/pdf/browserPipeline.ts` | แก้ | อ่าน text layer เฉพาะหน้าที่เลือก; กรอง cached OCR/BOQ ตาม selection; บันทึก `processLog` ทุกขั้น; ส่งคืน `processLog`, `requestedPages` |
| `src/pdf/pageSelection.ts` | ใหม่ | state ของ selection (pure) |
| `src/pdf/fileIdentity.ts` | ใหม่ | SHA-256 ของไฟล์ (ย้ายมาจาก App) + `fileKey` |
| `src/components/PageSelector.tsx` | ใหม่ | grid thumbnail + checkbox |
| `src/components/UploadSection.tsx` | แก้ | PDF → PageSelector (แทนช่องพิมพ์ช่วงหน้าเดิม 2 ช่อง); DXF อ่านทันทีเหมือนเดิม |
| `src/App.tsx` | แก้ | ตรวจว่า selection เป็นของไฟล์นี้ (hash) ก่อนอ่าน; รีวิวที่บันทึกผูกกับ hash ของไฟล์ (`reviewKey`) |
| `src/pdf/fixtures/makeTestPdf.ts` | ใหม่ | สร้าง PDF ทดสอบที่ควบคุมได้ (ไม่ใช้ไลบรารี) |
| เทสต์ | ใหม่/แก้ | `engineIdentityHardening.test.ts` (ใหม่), `pageSelection.test.ts` (ใหม่), `engineIdentity.test.ts` (ข้อ 3 ปรับตาม API ใหม่) |

## 3. Architecture ก่อนและหลังแก้ไข
**Engine identity**
| | ก่อน (20.1) | หลัง (20.2) |
|---|---|---|
| ที่มาของ identity | ไฟล์ `engineIdentity.gen.ts` สร้างด้วย `pretest` / `buildStart` / watcher | คำนวณจาก source ทุกครั้ง ไม่มีไฟล์สร้างไว้ |
| Direct script (`tsx x.ts`) | ใช้ไฟล์ gen ที่อาจค้าง | คำนวณใหม่ตอนโหลด engine |
| Vite dev | watcher เขียนไฟล์ gen | plugin `load` คืนค่าที่คำนวณตอน serve; engine เปลี่ยน → invalidate + full reload |
| Build | `buildStart` เขียนไฟล์ gen | plugin ฝังค่าลง bundle + ออก `engine-identity.json` + `--verify` |
| Dependency | รายการไฟล์คงที่ + เทสต์ห้าม import | หาเองจาก esbuild metafile (ไฟล์ local และ package) |
| ข้อความ flag | นับรวม (แก้ข้อความ → approval หลุด) | ค่าของ `message:` ถูกตัดก่อน hash |
| Generator | ไม่นับ | นับ source ของ generator ด้วย (แก้ generator → identity เปลี่ยน) |

**Page selection**
| | ก่อน | หลัง |
|---|---|---|
| วิธีเลือกหน้า | พิมพ์ช่วงหน้า 2 ช่อง | thumbnail + checkbox (หรือ "อ่านทุกหน้า" = พฤติกรรมเดิมที่ระบบหาแผ่นโครงสร้างเอง) |
| text layer เมื่อเลือกหน้า | อ่าน**ทุกหน้า** (BOQ, หมายเหตุทั่วไป → สเปก, `materialText` มาจากหน้าที่ไม่ได้เลือก) | อ่านเฉพาะหน้าที่เลือก; หน้าอื่นไม่ถูก `getPage` เลย |
| cached OCR (ชุดข้อมูล) | ไม่กรองตาม selection | กรอง |
| หลักฐานว่าอ่านหน้าไหน | console timing table | `processLog` ใน `BrowserExtraction` |
| ผูก selection กับไฟล์ | ไม่มี | SHA-256 (`fileKey`) และ App ตรวจซ้ำก่อนอ่าน |
| กู้รีวิวที่บันทึก | ชื่อไฟล์ + reading signature | ชื่อไฟล์ + **SHA-256** + reading signature |

## 4. Engine Identity Design
- **SOURCE_ENGINE_HASH** = `currentEngineIdentity().id` = SHA-256 ของ:
  - ทุกไฟล์ที่ esbuild bundle จาก `src/engine/qsEngine.ts` (ตอนนี้มีไฟล์เดียว; `engineIdentity.ts` ถูกตัดออกเพราะเป็นตัวถือค่า)
  - แต่ละไฟล์ผ่าน `transformSync` (ตัด comment/type/whitespace) แล้ว blank ค่าของ property `message` ที่เป็น string หรือ template literal (หาด้วย AST จาก `rolldown/parseAst`)
  - บวกกับโค้ดของ generator เอง
- **BUILD_ENGINE_HASH** = ค่าที่ plugin ฝังลง bundle ตอน build และเขียนลง `dist/engine-identity.json` (`engineId` + `sources`)
  - `tsx scripts/gen_engine_identity.ts --verify dist` ตรวจสามอย่าง: มี manifest, ค่าใน manifest อยู่ใน bundle, ค่าตรงกับ source ปัจจุบัน
- **ไม่อ้างเกินจริง:**
  - identity ครอบเฉพาะไฟล์ที่ esbuild bundle จริง (รายการอยู่ใน manifest และ CLI)
  - การตัดข้อความครอบเฉพาะ `message:` ข้อความแสดงผลอื่น (`reviews.push`, `formulaStr`, `confidenceBasis`) ยังนับรวม เพราะยังพิสูจน์ไม่ได้ว่าแยกได้ปลอดภัยทุกจุด
  - flag `code` ยังนับ เพราะ gate อ่าน code (เทสต์ 3 ยืนยัน)
- **ใช้ `message` ในการคำนวณไหม:** ค้นแล้วพบว่าใช้แค่สร้างข้อความ (`reviewWarnings`, `reasons`, `formulaStr` ของรายการที่ข้อมูลไม่ครบ) ไม่มีจุดที่ใช้คำนวณ

## 5. Execution Path Coverage
| Path | กลไก | หลักฐาน | สถานะ |
|---|---|---|---|
| Test environment (`node --test`, `tsx --test`) | `engineIdentity.ts` คำนวณตอนโหลด | เทสต์ R20.1 ข้อ 3: `ENGINE_ID` = `currentEngineIdentity().id` | **VERIFIED** |
| npm scripts | เหมือน Node | `npm test` / ไม่มี `pretest` แล้ว | **VERIFIED** |
| Direct scripts | เหมือน Node | เทสต์ 5–6, 9: spawn `tsx probe.ts` จริงในโปรเจกต์ชั่วคราว → identity ตรง source; แก้ค่าคงที่ → identity ใหม่ (ไม่ใช่ค่าเก่า); ลบ generator → `UNVERIFIED` + ไม่ปล่อยยอด | **VERIFIED** |
| Benchmark | เหมือน Node | `bench` probe (ESM) ผ่าน: 28 รายการ 0 auto 0 false release; `benchmark_offline.ts` / `eval_reading.ts` โหลด engine ได้ (ถูก guard ปฏิเสธเพราะไม่มี `FULL_BOQ` ตามคาด) | **VERIFIED** (load + probe + `check:full` บนสำเนา ด้วย `FULL_BOQ=1`: ผลเท่ารอบ 20.1) |
| Vite dev | plugin `load` | เทสต์ 7: `createServer().transformRequest('/src/engine/engineIdentity.ts')` ได้ค่าปัจจุบันและไม่มีโค้ดฝั่ง Node; เบราว์เซอร์จริงได้ `1edd05bd…` = ค่าที่ Node คำนวณ | **VERIFIED** |
| Vite dev — แก้ engine ระหว่างรัน | `handleHotUpdate` → invalidate + full-reload | เทสต์ 7: เรียก hook จริงบนโปรเจกต์ชั่วคราว ใช้ server object จำลองบันทึกการเรียก; โหลดใหม่ได้ค่าใหม่ | **PARTIALLY** — ยังไม่ได้ทดสอบ watcher จริงของ dev server ที่กำลังรันอยู่ |
| Production build | plugin ฝังค่า + manifest | เทสต์ 8: `vite build` จริง → `verifyBuildIdentity` ok; `npm run build` + `--verify dist` → OK | **VERIFIED** |
| Browser runtime (bundle) | ค่าคงที่ใน bundle | ตรวจรูปแบบได้ (ไม่ใช่ hex 64 → fail closed) แต่ **เบราว์เซอร์ตรวจกับ source ไม่ได้** เพราะ bundle ไม่มี source | **PARTIALLY** — ตรวจ artifact ได้ตอน deploy ด้วย `--verify` |
| CommonJS consumer นอก repo | — | `require()` engine ไม่ได้ (`ERR_REQUIRE_ASYNC_MODULE` เพราะ top-level await) → ล้มทันที ไม่ได้คำนวณด้วยค่าเก่า | ข้อจำกัด (fail loud) |

## 6. PDF Page Selection Architecture
```
UploadSection ── เลือก PDF ──► fileIdentity (SHA-256) ──► PageSelector(key = fileKey)
                                                         ├─ loadPdf (pdf.js เดิม) → thumbnails
                                                         └─ PageSelection { fileHash, totalPages, selectedPages (1-based) }
   "ประมวลผลหน้าที่เลือก" ──► App.handleFileUpload(file, "2,5", selection)
                                  ├─ ตรวจ selection.fileHash === fileKey(file, SHA-256 ของไฟล์ที่ส่งมา) ไม่ตรง → หยุด
                                  └─ processPdf → extractInBrowser({ pages: "2,5" })
                                        parsePageSpec → [2,5]
                                        readTextLayers(เฉพาะ 2,5) → stroke-scan(2,5) → OCR(candidates ⊂ 2,5)
                                        → text sheets(⊂ 2,5) → readSheets → mergeSheetReadings → computeProject
```
- `PageSelection` อยู่ใน `src/pdf/pageSelection.ts`: `selectionFor` (reset เมื่อ hash หรือจำนวนหน้าต่าง), `selectAll`, `deselectAll`, `invert`, `toggle` (ไม่รับเลขหน้านอกไฟล์), `canProcess`, `toPageSpec`
- **"อ่านทุกหน้า (หาแผ่นโครงสร้างเอง)"** = พฤติกรรมเดิมที่ไม่มี selection ระบบจัดประเภทแผ่นเอง
- ปุ่มประมวลผลกดไม่ได้เมื่อไม่ได้เลือกหน้า

## 7. Thumbnail Rendering Strategy
- **ไม่สร้าง renderer ใหม่:** ใช้ `loadPdf` และ `page.render` ของ pdf.js ที่มีอยู่
- **ไม่ใช้ `renderPageUrl` cache:** cache นั้นจำกัด 20 ภาพแล้ว revoke URL และ `extractInBrowser` ล้างทุกครั้ง จึงไม่เหมาะกับ thumbnail
- **ขนาด:** กว้าง 150 CSS px × devicePixelRatio (สูงสุด 1.5) ประมาณ 225×159 px ต่อหน้า วาดลง `<canvas>` โดยตรง ไม่สร้าง blob
- **Lazy:** `IntersectionObserver` (rootMargin 300px) วาดเมื่อหน้าใกล้เข้ามาในจอ
  - หลักฐาน: ไฟล์ที่สองเปิดตอนแท็บ import ไม่อยู่บนจอ → วาดแล้ว 0/3; สลับมาแท็บนั้น → 3/3
- **ไม่ให้เบราว์เซอร์ค้าง:** วาดทีละหน้าเป็นคิว และ `page.cleanup()` หลังวาดแต่ละหน้า
- **Loading/Error:** spinner ต่อหน้า, "แสดงภาพไม่ได้" ต่อหน้า, และข้อความเมื่อเปิด PDF ไม่ได้
- **ไม่เรียก OCR, reader หรือการคำนวณ:** component นี้ import แค่ `loadPdf` และ pageSelection
- **ปิดไฟล์:** unmount หรือเปลี่ยนไฟล์ → `doc.destroy()`; render ที่ยังค้างหยุดผ่าน `alive()`

## 8. Page Index Mapping
- **ใช้แบบเดียวทั้งระบบ:** เลขหน้าต้นฉบับเริ่มที่ 1 ตั้งแต่ UI → `toPageSpec` ("2,5") → `parsePageSpec` → `doc.getPage(p)` → `PageOcr.page`, `SheetReading.page`, `provenance.evidence.page`, `gridLocation` (`Sheet-P2`), `sourceSheetOrLayer` (`Page 2`) → Excel
- **ไม่มีการแปลงเป็นลำดับในรายการที่เลือก:** `readTextLayers` คืน array ยาวเท่าจำนวนหน้าทั้งไฟล์ ตำแหน่ง p−1 = หน้า p และหน้าที่ไม่ได้เลือกเป็นช่องว่าง โค้ดเดิมที่ใช้ `texts[p - 1]` จึงยังถูกต้อง
- **เทสต์:** `toPageSpec(เลือก 9, 2 จาก 24 หน้า)` = `"2,9"` → `parsePageSpec` = `[2,9]`

## 9. Processing Pipeline Changes
- **`extractInBrowser`:**
  - `requested` คำนวณก่อนอ่าน text layer
  - `readTextLayers` เปิดเฉพาะหน้าที่เลือก
  - `cachedOcr` และ `cachedBoqOcr` กรองตาม selection
  - **ผล:** BOQ, `materialText`, หมายเหตุทั่วไป (→ สเปก), schedule, stroke-scan, OCR และ text sheet มาจากหน้าที่เลือกเท่านั้น (เดิม BOQ, หมายเหตุ และ `materialText` มาจากทุกหน้า)
- **`processLog`:** บันทึกทุกครั้งที่ขั้นใดเปิดหน้าใด (`text`, `stroke-scan`, `classify`, `ocr`, `text-sheet`)
- **ไม่ได้แก้:** OCR algorithm, reader, merge และสูตร
- **ไม่มี selection:** พฤติกรรมเดิมทุกอย่าง (เทสต์: อ่านครบ 1..5)

## 10. Tests และผลลัพธ์ (วัดจริง)
`npm test` **201/201 ผ่าน** (39 + 162; รอบก่อน 39 + 148 → เพิ่ม 9 + 5)

**Round 20.2 (`engineIdentityHardening.test.ts`, ~10 วินาที รวม spawn, dev server และ build จริง)**
| # | ตรวจ | ผล |
|---|---|---|
| 1 | แก้ logic (lean `+0.20` → `+0.25`, ค่าเริ่มต้นรูปงอ) → identity เปลี่ยน | ผ่าน |
| 2, 10 | engine import `./rates.ts` ใหม่ → `engineSources` เจอเอง; แก้ค่าใน `rates.ts` → identity เปลี่ยน; engine จริงวันนี้ = `qsEngine.ts` ไฟล์เดียว | ผ่าน |
| 3 | แก้ข้อความ `message` 2 จุด → identity เท่าเดิม; แก้ flag `code` → เปลี่ยน; ไม่มีไฟล์ UI ใน sources | ผ่าน |
| 4 | ไม่มีไฟล์ gen ใน source; build artifact ที่ identity เก่า → `verifyBuildIdentity` = stale | ผ่าน |
| 5, 6 | direct script จริง: identity = source; แก้ค่าคงที่ → identity ใหม่; ไม่มี generator → `UNVERIFIED` + `NEEDS_REVIEW` + `ENGINE_IDENTITY_UNVERIFIED` | ผ่าน |
| 7 | Vite dev `transformRequest` ได้ค่าปัจจุบันและไม่ส่งโค้ด Node ไปเบราว์เซอร์; hook HMR → invalidate + full-reload และค่าใหม่ | ผ่าน |
| 8 | `vite build` จริง → verify ok; bundle ไม่มีโค้ด generator | ผ่าน |
| 9 | approve ใน direct script → แก้แค่ข้อความ → ยัง APPROVED → แก้สูตร → STALE (`engineId: …`) | ผ่าน |
| + | process นี้: identity = source และ approval ปล่อยยอดได้ | ผ่าน |

**Round 21 (`pageSelection.test.ts`)**
| ข้อ | ตรวจ | ผล |
|---|---|---|
| D2-1..6 | select all / none / invert / ทีละหน้า / หลายหน้า (เรียงตามเลขหน้า) / ไม่มีหน้า → กด process ไม่ได้ / เลขหน้านอกไฟล์ถูกละ | ผ่าน |
| D2-7, 8 | ไฟล์อื่น (hash ต่าง หรือจำนวนหน้าต่าง) → เริ่มว่าง; bytes เดิม → selection เดิม | ผ่าน |
| D2-9 | 2,000 หน้า: select all / invert / toggle | ผ่าน |
| D2-10 | mapping เลขหน้า `"2,9"` | ผ่าน |
| D3 | PDF 5 หน้าจริง (pdf.js) เลือก 2, 5: `getPage` ถูกเรียกแค่ `[2,5]`; log = text 2, 5; OCR candidates / text sheets = `[2,5]`; members `F2`/`F5` อ้างหน้า 2/5 (`Sheet-P2`, `Page 2`); ค่าจากแถวของหน้านั้นจริง (1.20 / 1.50); ไม่เลือก → อ่าน 1..5; Excel แผ่น 7 "น.2"/"น.5", แผ่น 2 "Page 5" | ผ่าน |
| file identity | ชื่อเดียวกัน bytes ต่าง → key ต่าง; bytes เดียวกันชื่อต่าง → key เดียวกัน; ไม่มี hash → `nohash:ชื่อ:ขนาด:เวลา` (ไม่ใช่ชื่ออย่างเดียว) | ผ่าน |

**ข้อจำกัดของ D3 ใน Node:** `extractInBrowser` รันใน Node ไม่ได้ เพราะ OCR worker และ `?url` import ใช้ได้แค่ในเบราว์เซอร์ Node test จึงพิสูจน์ขั้น text layer ด้วย spy และขั้นอื่นผ่านฟังก์ชันจริงที่ pipeline เรียก ส่วนขั้น OCR พิสูจน์ใน browser run ด้วย `processLog` (หัวข้อ 11)

## 11. Browser Workflow Evidence (dev server, PDF ทดสอบสร้างในหน้าเว็บแล้วใส่ใน `<input type=file>`)
| ขั้น | ผล (จากข้อมูลจริงในหน้า ไม่ใช่แค่ภาพ) | ภาพ |
|---|---|---|
| 1–3 อัปโหลด `five_pages.pdf` (5 หน้า มี stroke) | selector `e3f081a5…`, thumbnail 5 ช่อง วาดแล้ว 5 · engine id ใน dev = `1edd05bd…` = ค่าจาก Node | `tools/artifacts/round21/01_thumbnails_5_pages.jpg` |
| ปุ่ม | เริ่ม 0/5 (กด process ไม่ได้) → เลือกทั้งหมด 5/5 → สลับ 0/5 (กดไม่ได้) → ไม่เลือก 0/5 | — |
| 4–5 คลิก checkbox หน้า 2 และ 5 (คลิกจริง) | "เลือกแล้ว 2 / 5 หน้า" | `02_selected_2_and_5.jpg` |
| 6–7 ประมวลผล (21.9 วินาที) | `requestedPages [2,5]`; `processLog`: text 2, text 5, stroke-scan 2, stroke-scan 5, **ocr 2, ocr 5**; `ocrPages [2,5]`; readings หน้า `[2,5]`; ไม่มีหน้า 1, 3, 4 ในทุกขั้น | — |
| 8–9 เลขหน้าและ provenance | members `F2` (Page 2, Sheet-P2, evidence หน้า 2) และ `F5` (Page 5, Sheet-P5, evidence หน้า 5); หน้าตรวจทานแสดง "บรรทัดในตาราง (หน้า 2)" และ viewer "หน้า 2" | `03_review_original_pages.jpg` |
| อนุมัติ F2 | ถูกกันไว้ตามกฎ 20.1 (ไม่มีความลึกขุดและสเปกไม่มีที่มา) แต่บันทึกการตัดสินอ้าง `QS-F-001 F2 @Sheet-P2 Story 1` และไฟล์ `five_pages.pdf · e3f081a5904d9165` | — |
| 10 Excel (ดึง blob ในหน้า ไม่ได้ดาวน์โหลด) | แผ่น 7: F2 "บรรทัดในตาราง (หน้า 2) น.2", F5 "น.5"; หัวแผ่นมีไฟล์ + hash + engine id; แผ่น 2: "Page 2", "Page 5"; แผ่น 8: แถวตัดสินอ้าง F2 @Sheet-P2 | — |
| 11–12 อัปโหลด `three_pages.pdf` | selector ใหม่ `fc2a3587…` (มีอันเดียว), 0/3, ไม่มีช่องไหนถูกติ๊ก | `04_new_file_selection_reset.jpg` |
| 13 ไม่ปนกัน | เลือกหน้า 1 → `processLog` = text 1, stroke-scan 1, text-sheet 1; member `F1` จาก `three_pages.pdf` หน้า 1 เท่านั้น ไม่มี F2/F5 ของไฟล์เก่า; thumbnail ของไฟล์ใหม่วาดจาก doc ใหม่ | — |
| console | ไม่มี error | — |

## 12. Performance และ Memory
- **Thumbnail:** ประมาณ 225×159 px × 4 byte ≈ 140 KB ต่อหน้า วาดเฉพาะหน้าที่เลื่อนผ่าน
  - **ข้อจำกัด:** ไม่คืน canvas ของหน้าที่เลื่อนผ่านไปแล้ว เลื่อนดูครบ 200 หน้า ≈ 28 MB; ไม่มี DOM virtualization (ทุกหน้ามี placeholder element)
- **วาดทีละหน้า:** ไม่แย่ง main thread กับ UI จนค้าง ส่วน pdf.js render ทำใน worker
- **ไฟล์ถูกเปิดสองครั้ง:** ครั้งแรกเพื่อ thumbnail (doc ถูก destroy เมื่อปิด selector) และอีกครั้งตอนประมวลผล ทำให้ใช้หน่วยความจำมากขึ้นช่วงสั้น ๆ ราวขนาดไฟล์
- **อ่านเฉพาะหน้าที่เลือกเร็วกว่าเดิม:** ไม่อ่าน text layer ของหน้าอื่น วัดได้ 1.25 วินาทีสำหรับ 1 หน้า text และ 21.9 วินาทีสำหรับ OCR 2 หน้า
- **Identity ใน Node:** esbuild bundle + parse ประมาณ 0.1–0.2 วินาทีตอนโหลด engine
- **Vite build:** ช้าลงเล็กน้อย (≈ 1.9 วินาที เท่าเดิม)

## 13. Regression Results (วัดจริง, input เดียวกัน)
| การตรวจ | ผล |
|---|---|
| `npm test` | 201/201 |
| `tsc --noEmit` | ผ่าน |
| `npm run build` + `--verify dist` | ผ่าน / OK (`1edd05bd…`) |
| Parity (`tools/test_parity_round14.ts`) เทียบกับผลก่อนรอบนี้ (`parity_r201b.txt`) | **identical** — ปริมาณคอนกรีต, ไม้แบบ, เหล็ก, ความมั่นใจ และสถานะทุกรายการเท่าเดิม |
| Benchmark probe (28 รายการ) | auto 0, false release 0 — เท่าเดิม |
| RebarSet, ฐานราก, approval, snapshot, fingerprint, Excel | อยู่ในชุด `npm test` ทั้งหมด ผ่านโดยไม่ต้องแก้ assertion |
| `check:full` (`FULL_BOQ=1` บน**สำเนา** ใน scratchpad หลังผู้ใช้อนุญาต) | benchmark_offline 5 ชุด **identical กับผลรอบ 20.1 ทุก field** (ยกเว้น `generatedAt`); eval_reading **ถูก 83% · ผิด 3% · ไม่พบ 14%** เท่ารอบ 20.1 (house_ready_1 76%, _2 88%, _3 84%, _4 83%); members 27/39/62/60/47 auto 0, rejected 0/0/0/1/0; SHA-256 ของ baseline ต้นฉบับ 5 ไฟล์ไม่เปลี่ยน; อ่านแค่ OCR cache ไม่ render แบบ — ยังต่างจาก baseline 2026-10-23 เท่าเดิม (22–42 field ต่อชุด จากงานก่อน Round 20 ตามรายงาน 20.1) |

**ความต่างที่ตั้งใจ (ไม่ใช่ regression):**
- เมื่อเลือกหน้า BOQ ในไฟล์เดียวกันจะไม่ถูกหาเจอจากหน้าที่ไม่ได้เลือก ต้องติ๊กหน้า BOQ ด้วยหรือใช้ "อ่านทุกหน้า"
- หมายเหตุทั่วไปจากหน้าที่ไม่ได้เลือกจะไม่ไปตั้งค่าสเปก (เดิมไปตั้งได้)

## 14. Known Limitations
1. **เบราว์เซอร์ตรวจ identity ของ bundle กับ source ไม่ได้:** ตรวจได้แค่รูปแบบ การยืนยันว่า build มาจาก source ชุดไหนทำตอน deploy ด้วย `--verify`
2. **การตัดส่วนแสดงผลทำเฉพาะ `message:`:** ข้อความอื่นใน engine ยังนับรวม แก้แล้ว approval หลุด (ฝั่งปลอดภัย)
3. **CommonJS นอก repo `require` engine ไม่ได้:** มี top-level await จึงต้องใช้ ESM (`.mts` หรือ `"type":"module"`) โปรเจกต์นี้เป็น ESM ทั้งหมด
4. **HMR ตอน dev ทดสอบที่ระดับ hook:** ยังไม่ได้ทดสอบ watcher จริงของ dev server ที่กำลังรัน (ในเบราว์เซอร์ identity ตรงกับ Node)
5. **ไม่มี DOM virtualization:** canvas ของ thumbnail ที่วาดแล้วไม่ถูกคืน
6. **ไฟล์ถูกเปิดสองครั้ง:** สำหรับ thumbnail และการประมวลผล
7. **ช่องพิมพ์ช่วงหน้าเดิมถูกแทนด้วย selector:** ผู้ใช้ที่เคยพิมพ์ "18-19" ต้องติ๊กแทน
8. **รีวิวที่บันทึกก่อนรอบนี้จะไม่ถูกกู้:** key เดิมเป็นชื่อไฟล์ ตอนนี้ต้องเป็นชื่อ + SHA-256 ซึ่ง approval เดิมก็หลุดตามกฎ 20.1 อยู่แล้ว
9. **D3 ใน Node ไม่ได้รัน `extractInBrowser` ทั้งก้อน:** ขั้น OCR พิสูจน์ในเบราว์เซอร์

## 15. Remaining Risks
- identity ของ bundle ที่ deploy ต้องตรวจด้วย `--verify` ใน CI หรือ deploy ถ้าไม่ตรวจ จะไม่มีอะไรห้ามการ deploy bundle ที่ build จาก source อื่น
- อัปเกรด esbuild หรือ rolldown อาจทำให้ output ต่าง → identity เปลี่ยน → approval ทั้งหมดหลุด (ฝั่งปลอดภัย แต่ต้องอนุมัติใหม่)
- ถ้าวันหนึ่งโค้ดคำนวณอ่าน `flag.message` (ตอนนี้ไม่มี) การตัด `message:` จะทำให้ identity ไม่เปลี่ยนเมื่อข้อความนั้นเปลี่ยน — ต้องคงหลักว่า "message ใช้แสดงผลเท่านั้น"
- ผู้ตรวจยังไม่ยืนยันตัวตน และ fingerprint/identity ไม่มีลายเซ็น (จากรอบก่อน)

## 16. สิ่งที่ยังไม่ได้ทำ
- อัปเดต baseline ของ `check:full` (ยังเป็นของ 2026-10-23 — ผู้ใช้ต้องตัดสิน)
- ทดสอบ watcher จริงของ dev server ตอนแก้ไฟล์ engine ระหว่างรัน
- DOM virtualization และการคืน canvas ของ thumbnail ที่เลื่อนผ่าน
- ใช้ doc เดียวกันสำหรับ thumbnail และการประมวลผล
- ตัดข้อความแสดงผลอื่นนอกจาก `message:` ออกจาก identity
- ขั้นตอน `--verify` ใน CI/deploy (ยังไม่มี CI ใน repo)

## สถานะ
| ส่วน | สถานะ |
|---|---|
| R20.2 identity ครอบ dependency จริง | **VERIFIED** |
| R20.2 Node / tests / npm / direct scripts / benchmark | **VERIFIED** |
| R20.2 Vite dev (serve ค่าปัจจุบัน) | **VERIFIED** |
| R20.2 Vite dev (คำนวณใหม่เมื่อแก้ไฟล์ระหว่างรัน) | **PARTIALLY IMPLEMENTED** (ทดสอบที่ระดับ hook) |
| R20.2 Production build + verify | **VERIFIED** |
| R20.2 Browser runtime ตรวจกับ source | **PARTIALLY IMPLEMENTED** (ตรวจรูปแบบ; artifact ตรวจตอน deploy) |
| R20.2 Missing/invalid → fail closed | **VERIFIED** |
| R20.2 แก้สูตร → STALE; แก้ข้อความ flag → ไม่ stale | **VERIFIED** |
| R21 thumbnail + checkbox + เลือกทั้งหมด/ไม่เลือก/สลับ | **VERIFIED** |
| R21 ประมวลผลเฉพาะหน้าที่เลือก (ไม่ OCR หน้าอื่น) | **VERIFIED** |
| R21 เลขหน้าต้นฉบับ / provenance / approval record / Excel | **VERIFIED** |
| R21 เปลี่ยนไฟล์ → reset, ไม่ปนกัน | **VERIFIED** |
| R21 PDF จำนวนหน้ามาก (lazy render) | **PARTIALLY IMPLEMENTED** (lazy ใช่, virtualization ไม่มี) |
| `check:full` (บนสำเนา) | **VERIFIED** — identical กับรอบ 20.1, baseline ต้นฉบับไม่ถูกแตะ |
| BLOCKED | ไม่มี |
