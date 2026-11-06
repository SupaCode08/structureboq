# StructBOQ Round 23 — Full Architecture Audit & Optimization Roadmap

**วันที่:** 2026-11-05 · **Audit เท่านั้น:**
- ไม่ได้แก้ไฟล์ใดใน repository
- ไม่ได้ตั้ง `FULL_BOQ` และไม่ได้ประมวลผลแบบจริง
- รายงานนี้อยู่ใน scratchpad รอผู้ใช้อนุมัติก่อนจึงจะคัดลอกเข้า `tools/`

**วิธี:**
- ค้นโค้ดตาม symbol และอ่าน docblock ของทุก module ใน `src/pdf`, `src/engine`, `src/export`
- trace ฟังก์ชันที่เรียกจริง
- ใช้หลักฐานจากการทดสอบที่รันใน Round 19–22.1 ของ session นี้ และตัวเลข benchmark ที่บันทึกในรายงานเดิม (`tools/STRUCTBOQ_COMPREHENSIVE_AUDIT.md`) — **ไม่ได้วัดใหม่ในรอบนี้**

**ป้ายสถานะ:** VERIFIED · PARTIALLY VERIFIED · NOT VERIFIED · RECOMMENDATION · ASSUMPTION

---

## A. Current Architecture Map
```
Browser (React 19 + Vite 8, static, local-first, ไม่มี backend / ไม่มี paid API)
├─ UI: App.tsx · UploadSection → PageSelector · ReviewWorkspace (+ SectionTable, FootingRebarSets, ConflictPanel, DuplicatePanel)
│      MaterialSpecsModal · BoqComparison · ReviewHistory · SourceViewer/PdfViewer · excel export
├─ Document/Reading (src/pdf) ─ pdf.js 4.10 (pdfjs-dist) · tesseract.js 5 (eng, tha+eng) · PaddleOCR PP-OCRv4 ONNX (onnxruntime-web, WebGPU→WASM)
│   browserPipeline.extractInBrowser ─ pdfText (text layer) ─ pdfOcrPipeline.ocrPdfPage (vector_text / raster / blank)
│   vectorText (small strokes) · labelOcr · glyphRead · scanPrep (deskew, binarize) · imageBoxes · paddleOcr/paddleWorker
│   sheetReader.readSheets (rule-based, no AI) · scheduleParser · structuralNotesParser · boqParser/boqOcr · dxfParser
├─ Interpretation (src/engine) ─ sheetMerge.mergeSheetReadings (plan ⨝ detail ⨝ levels) · sourceConflicts (reconcile)
├─ Calculation (src/engine/qsEngine.ts, 2,508 บรรทัด) ─ calculateMember · computeProject (dup rule, slab overlap, duplicate groups, totals, Factor F)
│   gate: flags → classes A/B/C · approval snapshot/fingerprint · engine identity (engineIdentity.ts ← scripts/gen_engine_identity.ts)
├─ Review state ─ reviewLog (history/undo) · localStorage (review ต่อไฟล์ผูก SHA-256)
└─ Export ─ excelWorkbook.buildBoqWorkbook (แผ่น 1–8 + 7.1/7.2/7.3) · OfficialReportModal (ปร.4/ปร.5)
Node (tests/benchmark เท่านั้น) ─ scripts/benchmark_offline, eval_reading (FULL_BOQ guard), tools/test_parity_round14
```
**สถานะ: VERIFIED** — จาก import และ docblock ของแต่ละไฟล์ และจาก package.json (dependencies มี 11 ตัว ไม่มี backend)

## B. Actual Code Flow (Upload PDF → BOQ Export)
| # | ขั้น | ไฟล์ / ฟังก์ชัน | หมายเหตุ | สถานะ |
|---|---|---|---|---|
| 1 | เลือกไฟล์ + SHA-256 | `UploadSection.take` → `fileIdentity.fileIdentity` / `fileKey` | DXF อ่านทันที; PDF → PageSelector | VERIFIED (R21) |
| 2 | thumbnail + เลือกหน้า | `PageSelector` (pdf.js render ลง canvas, lazy, คิวทีละหน้า) · `pageSelection.ts` | ไม่ OCR | VERIFIED (R21) |
| 3 | เริ่มอ่าน | `App.handleFileUpload` (ตรวจ selection ตรง hash) → `processPdf` → `extractInBrowser(doc, name, {pages})` | | VERIFIED |
| 4 | text layer | `readTextLayers` → `toPageText` (Thai legacy font repair, `/Rotate` 90/270) | เฉพาะหน้าที่เลือก | VERIFIED |
| 5 | BOQ ในไฟล์ | `parseBoqPages` + `boqTotalsByVariant` | | VERIFIED |
| 6 | schedule จากข้อความ | `scheduleMembersFromPage` → `reconcileScheduleRows` | | VERIFIED |
| 7 | เลือกหน้าที่ต้อง OCR | `extractSmallStrokes` (≥200 เส้นเล็ก = ตัวอักษรเป็นเส้น) → `partitionDrawingPages` | | VERIFIED |
| 8 | OCR ต่อหน้า (วนทีละหน้า) | `fastClassifySheet` (เฉพาะโหมดอ่านทั้งไฟล์) → `ocrPdfPage`: `vector_text` (วาดเส้นเล็กใหม่ แล้ว OCR แบบตรงและแบบหมุน 90°) / `raster` (render 300/72, deskew, readScan → Paddle) | | VERIFIED (code) |
| 9 | text sheet | `pageTextToOcr` + `textSheetGeometry` | | VERIFIED |
| 10 | อ่านแผ่น | `readSheets([...ocrPages, ...textSheets])` → `SheetReading[]` (footing_plan / framing_plan / section_detail / building_section) | | VERIFIED |
| 11 | ประกอบชิ้น | `mergeSheetReadings` (plan instance ⨝ section ด้วย tag, ระดับชั้น, reconcile) | | VERIFIED |
| 12 | หมายเหตุทั่วไป → สเปก | `extractStructuralNotesFromWords` → `applyGeneralNotesToSpecs` | | VERIFIED |
| 13 | คำนวณ | `App.compute` → `computeProject(members, …, drawing)` → `calculateMember` ต่อชิ้น → dup rule / duplicate groups → totals | | VERIFIED |
| 14 | ตรวจ/อนุมัติ | `ReviewWorkspace` → `handleUpdateMembers` (approvalFor + snapshot + log) | | VERIFIED |
| 15 | Export | `buildBoqWorkbook` · `compareTakeoffWithBoq` | | VERIFIED |

## C. Existing Capability Matrix
| Feature | Implemented | Partial | Missing | Evidence |
|---|---|---|---|---|
| PDF parsing / page selection / file hash | ✔ | | | `browserPipeline.loadPdf`, `pageSelection.ts`, R21 tests |
| File validation (นามสกุล) | | ✔ ตรวจแค่นามสกุล | ตรวจไฟล์เสีย/ใส่รหัส/ขนาด | `UploadSection.take` |
| Page rotation (`/Rotate`) | | ✔ 90/270 ใน `toPageText` | มุมอื่น | `pdfText.ts` |
| CropBox / MediaBox / UserUnit | | | ✔ ไม่ได้จัดการเอง (ใช้ค่าเริ่มต้นของ pdf.js) | grep ไม่พบ — **ASSUMPTION:** pdf.js ใช้ CropBox |
| Document revision | | ✔ hash ใน snapshot/approval | การเทียบ revision เก่า-ใหม่ | R20, R22 report |
| Content cache (OCR) | | ✔ เฉพาะชุดข้อมูล (`offline_ocr.json`) | cache ตาม hash สำหรับไฟล์อัปโหลด | `extractInBrowser opts.cachedOcr` |
| Text: position/bbox | ✔ | | | `TextItem {x0..y1, nb}` |
| Text: font size / font name / rotation ต่อ item | | | ✔ ไม่เก็บ | `types.ts TextItem` |
| Thai legacy font decode | ✔ | | | `thaiText.ts` |
| Vector: small strokes / rects / circles / h-v segments | ✔ | | | `vectorText.extractSmallStrokes` |
| Vector: arcs, hatches, blocks, line width, dimension entity | | | ✔ (PDF ไม่มี entity เหล่านี้; มีแค่ใน DXF parser) | `vectorText.ts` |
| แยกเส้นโครงสร้าง / มิติ / กริด | | ✔ heuristic (ความยาวเส้น, ตัวเลข dimension → กริด) | classifier ของเส้น | `sheetReader` docblock |
| OCR engines | ✔ tesseract (eng, tha+eng), Paddle ONNX WebGPU→WASM | | | `browserPipeline`, `paddleWorker` |
| OCR หมุน 90° (vertical text) | ✔ | | | `ocrPdfPage` turned workers, `unrotate` |
| OCR มุมเอียงอื่น (เช่น 30°, 45°) | | | ✔ | ไม่มีโค้ดหมุนรายมุม |
| Deskew ของ scan | ✔ | | | `scanPrep`, `deskewed()` |
| ROI OCR | | ✔ เฉพาะ label ทีละป้าย (`labelOcr`, opt-in) | ROI จากผลตรวจ validation | `labelOcr.ts` |
| Adaptive retry หลัง validation | | | ✔ | ไม่มี loop ตรวจผลแล้วอ่านใหม่ |
| Sheet classification | | ✔ (sheet id prefix + reader rules) | classifier ที่วัดผลได้ | `fastClassifySheet`, `sheetReader` |
| Grid / dimension / level / tag | | ✔ rule-based | ความแม่นตามชนิด | eval: ถูก 83% (dev) |
| Cross-view identity | | ✔ plan ⨝ detail ด้วย tag | registry ของชิ้นงาน / ลิงก์ schedule กับผัง | R22.1 report |
| Conflict detection/resolution | ✔ | | revision เก่า vs ใหม่ | R22 |
| Duplicate detection / double counting | ✔ | | ตัวเลือก "schedule = สรุปของชิ้นในผัง" | R22.1 |
| Quantity engine + gate + snapshot | ✔ | | | R18–R22.1 tests |
| Spatial index | | | ✔ | grep ไม่พบ rtree/quadtree |
| Server/worker processing | | ✔ Web Worker สำหรับ Paddle | backend | `paddleWorker.ts` |
| Reviewer authentication / signature | | | ✔ | R18d, R20 |

## D. Bottleneck Analysis
| จุด | หลักฐาน | สถานะ |
|---|---|---|
| **OCR ต่อหน้าเป็นต้นทุนหลัก** | **วัดใน session นี้ (R21, เบราว์เซอร์):** หน้าข้อความล้วน 1 หน้า 1.25 s; หน้า stroke สังเคราะห์ 2 หน้า + OCR 21.9 s (≈ 11 s/หน้า) · **รายงานเดิม:** 7.5–21.5 s/หน้า บน WebGPU (เร็วกว่า WASM 2.5×) ที่ 400 DPI · **memory:** re-OCR บ้านหนึ่งหลังด้วย 2 engine ใน Node ใช้ 20–40 นาที | PARTIALLY VERIFIED (ตัวเลขเก่าไม่ได้วัดซ้ำ) |
| **ประมวลผลทีละหน้า** | `extractInBrowser`: `for (const p of pages) { … await ocrPdfPage … }` — ไม่มี page-level parallelism; Paddle workers สูงสุด `min(2, cores-1)` | VERIFIED (code) |
| **อ่านแนวตรงและแนวหมุนทุกหน้า vector_text** | `readSide(false)` + `readSide(true)` เสมอ → OCR ซ้ำ ~2× | VERIFIED (code) |
| **Render ความละเอียดสูง** | `renderForOcr(pg, 300/72)` และ scan prep 400 DPI → ภาพ ~6619×4680 (รายงานเดิม: VRAM 2.8–5.7 GB) | PARTIALLY VERIFIED |
| **ไม่มี OCR cache สำหรับไฟล์อัปโหลด** | อ่านไฟล์เดิมซ้ำต้อง OCR ใหม่ทั้งหมด (`clearPageCache` ทุกครั้ง; cache เฉพาะชุดข้อมูล) | VERIFIED |
| **โหลดโมเดล** | tesseract `tha+eng` ~0.9 MB + Paddle det 4.7 MB / rec 10.8 MB ครั้งแรกต่อ session | PARTIALLY VERIFIED |
| **main thread** | tesseract.js มี worker ของตัวเอง; render / `extractSmallStrokes` / reader ทำบน main thread | VERIFIED (code) — ผลต่อ UI ยังไม่ได้วัด (NOT VERIFIED) |
| **การคำนวณ (engine)** | ไม่ใช่คอขวด: parity 28 รายการรันในไม่กี่วินาที; identity ใช้ 0.1–0.2 s | VERIFIED |

**ข้อสรุป:** ห้ามอ้างว่า PDF หลายร้อยหน้าเสร็จในไม่กี่วินาที ด้วยตัวเลขปัจจุบัน OCR ประมาณ 7–20 s/หน้า แบบ 100 หน้าที่ต้อง OCR ทุกหน้าจะใช้เวลาเป็น**สิบนาที** — ASSUMPTION จากการคูณ ยังไม่ได้วัด

## E. Architecture Gap Analysis (เทียบ pipeline เป้าหมาย)
| ขั้นเป้าหมาย | ปัจจุบัน | Gap |
|---|---|---|
| Document validation & revision | hash + นามสกุล | ตรวจไฟล์เสีย/รหัสผ่าน; เทียบ revision |
| Page analysis | `partitionDrawingPages` (text vs stroke vs image) + page selection | ไม่มีบันทึกคุณสมบัติหน้า (เช่น มีภาพ, มุม, ขนาด) แยกไว้ |
| Text + vector extraction | มี (text items, small strokes, rects, circles) | ไม่เก็บ font/size/angle; ไม่มี vector model กลาง |
| Coordinate normalization | `nb` (0..1) สำหรับข้อความ; OCR words ใช้พิกัด raster แล้วแปลงกลับ (`unrotate`, `deskewed`) | ไม่มี transform matrix บันทึกใน provenance |
| Spatial index | ไม่มี (ค้นหาแบบไล่ทั้ง array ใน reader) | **ASSUMPTION:** จะมีประโยชน์เมื่อหน้ามีหลายหมื่นวัตถุ — ต้องวัดก่อน |
| OCR candidate detection | ระดับหน้า | ระดับ ROI |
| Adaptive ROI OCR | label OCR (opt-in) | validation → retry → หมุนเฉพาะ ROI |
| Drawing classification | id prefix + rules | ยังไม่มี metric ความแม่น |
| Member identity graph | tag join + duplicate groups (R22.1) | registry, ลิงก์ schedule ↔ plan, ลิงก์ elevation |
| Duplicate & conflict | มีครบ (R22/R22.1) | revision conflicts |
| Quantity engine | มี + gate | ไม่ต้องสร้างใหม่ |
| Evidence & approval | มี (snapshot, fingerprint, identity, history) | auth / signature |
| Export | Excel 8+ แผ่น | — |

## F. Recommended Architecture (additive, ไม่ rewrite)
- **RECOMMENDATION 1 — ใช้ TypeScript ต่อ:** คง TypeScript / ระบบในเบราว์เซอร์เป็นแกน pdf.js, tesseract.js และ onnxruntime-web ทำงานอยู่แล้ว และ reader กับ engine เป็น TS ที่ทดสอบได้ใน Node การย้ายไป Python (PyMuPDF/OpenCV/Shapely) จะต้องเขียน reader ใหม่ 1.7k บรรทัด และเสีย parity ที่ตรวจไว้
- **RECOMMENDATION 2 — แยก "Processing Core" ออกจาก UI:** `extractInBrowser` เป็น pure-ish อยู่แล้ว (env injection แบบ `OcrEnv`) ให้ห่อเป็น worker interface เดียว ซึ่งรันได้ทั้งใน Web Worker (local) และ Node worker (server ในอนาคต) โดยไม่เปลี่ยน logic
- **RECOMMENDATION 3 — Page Record + Content Cache:** แต่ละหน้ามี `PageRecord { fileSha, page, kind, textItems, strokes summary, ocrWords, transform }` เก็บใน IndexedDB ด้วย key `fileSha:page:readerVersion` เปิดไฟล์เดิมไม่ต้อง OCR ซ้ำ
- **RECOMMENDATION 4 — Adaptive ROI OCR ซ้อนบน `ocrPdfPage`:**
  1. หลังอ่านรอบแรก ตรวจคำด้วย validator ที่มีอยู่ (`barNotation`, รูปแบบ dimension, คลัง tag)
  2. คำที่ไม่ผ่าน → ROI → อ่านใหม่เฉพาะ ROI (มุมเดิมก่อน แล้วค่อยหมุน)
  3. บันทึก transform กลับพิกัดหน้า
  4. ถ้ายังไม่ผ่าน → `FIELD_VALUE_UNSOURCED` เข้าคิวตรวจ ห้ามเดา
- **RECOMMENDATION 5 — Member Identity Registry:** ขยายจาก R22.1 (หัวข้อ G) ไม่แทนที่ `ExtractedMember` / `computeProject`
- **RECOMMENDATION 6 — Spatial index ทำทีหลัง:** ใช้ grid hash ง่าย ๆ ใน reader เฉพาะเมื่อ profiling พบว่าการค้นหาเพื่อนบ้านเป็นคอขวด ตอนนี้ยังไม่มีหลักฐาน และไม่ควรเพิ่ม dependency (Shapely/STRtree เป็น Python)

## G. Data Model (เสนอ — ส่วนใหญ่ต่อยอดจาก type เดิม)
```ts
Document        { sha256, fileName, pageCount, revisionOf?: sha256, openedAt }                 // FileRef/DrawingRef เดิม
Page            { docSha, page(1-based), widthPt, heightPt, rotate, kind: 'text'|'vector_text'|'raster'|'blank', selected }
TextObject      { page, str, bboxPt, nb, fontName?, sizePt?, angleDeg?, source: 'text_layer' }          // TextItem + ฟิลด์ใหม่
VectorObject    { page, type: 'segment'|'rect'|'circle'|'polyline', pts, widthPt?, role?: 'structure'|'dimension'|'grid'|'annotation'|'unknown' }
OcrRegion       { page, roiPt, renderScale, rotationDeg, transform: number[6], engine, words: OcrWord[], conf, validated: boolean, retryOf? }
DrawingView     { page, kind: SheetReading['sheet_type'], sheetId?, level?, scale?, grid? }                    // SheetReading เดิม
PhysicalMember  { id, memberType, level, location (grid), specificationId?, references: DrawingReference[] }   // ใหม่
DrawingReference{ viewPage, tag, bboxNorm, role: 'plan_mark'|'detail'|'schedule_row'|'elevation' }
SourceOccurrence{ = ExtractedMember หนึ่งชิ้น (เดิม) + occurrenceOf() (R22.1) }
ScheduleRow     { page, text, tag, parsed: ParsedRow, rowBbox }                                               // scheduleParser เดิม
Specification   { id, memberType, dims, rebar, cover, source occurrences[] }
DuplicateRelationship { groupKey, classification, decision: DuplicateDecision }                              // R22.1
Conflict        { FieldConflict + ConflictResolution }                                                        // R22
CalculationEvidence { itemId, formulaStr, inputs + fieldSources, flags, snapshot, fingerprint, engineId }     // มีอยู่ใน CalculatedQuantity
ApprovalRecord  { ReviewDecision + by + revision + snapshot + quantities }                                    // R20
```
**ความสัมพันธ์**
```
Document 1─* Page 1─* {TextObject, VectorObject, OcrRegion}
Page 1─* DrawingView 1─* DrawingReference *─1 PhysicalMember *─1 Specification
SourceOccurrence(ExtractedMember) *─1 PhysicalMember (ผ่าน DuplicateRelationship/ruling เท่านั้น)
Conflict *─1 SourceOccurrence ; ApprovalRecord 1─1 SourceOccurrence (snapshot ครอบทุกอย่างข้างบนที่ใช้คำนวณ)
```
**กฎ:**
- tag เดียวกัน ≠ PhysicalMember เดียวกัน
- ScheduleRow ลิงก์ได้หลาย PhysicalMember (row.count)
- ลิงก์ทุกเส้นต้องมีหลักฐาน (ตำแหน่ง) หรือ ruling

**สถานะ:** RECOMMENDATION

## H. Risk Assessment
| ระดับ | ความเสี่ยง | เหตุผล / ผลกระทบ | หลักฐาน |
|---|---|---|---|
| **CRITICAL** | การอ่านแบบจริงยังไม่พอสำหรับปล่อยยอดเอง | eval dev: ถูก 83% · ผิด 3% · ไม่พบ 14%; benchmark 0/28 auto; held-out (scan) ~15% ถูก (memory) — ทุกยอดต้องผ่านคน | VERIFIED (dev) / PARTIALLY (held-out ตัวเลขเก่า) |
| **CRITICAL** | False merge / นับซ้ำ schedule ↔ plan | INSUFFICIENT_EVIDENCE ต้องใช้คน; ยังไม่มีลิงก์ schedule row กับชิ้นในผัง | VERIFIED (R22.1) |
| **HIGH** | ค่ามาตรฐานที่เป็นสมมติฐาน (hook 12d, lap 40d, ขอขั้นต่ำ 0.10 m, ความลึกขุด 1.50, lean +0.20) | กันด้วย flag แล้ว แต่ยังเป็นสมมติฐาน ไม่ใช่มาตรฐานที่อ้างอิงได้ | VERIFIED (code, R20.1) |
| **HIGH** | ความยาวตัดเหล็ก (cutting length) เป็นค่าประมาณ | engine คิดจากขนาด − cover + hook (estimated) ไม่ใช่ BBS; Excel เตือนแล้ว | VERIFIED (R19 Excel warning) |
| **HIGH** | ไม่มีตัวชี้วัด classification / tag / dimension แยกชนิด | ปรับ reader แล้วไม่รู้ว่าดีขึ้นหรือแย่ลงตรงไหน | VERIFIED (ไม่มี metric) |
| **MEDIUM** | ประสิทธิภาพ: OCR ทีละหน้า ไม่มี cache | ไฟล์ใหญ่ช้ามาก | VERIFIED (code) |
| **MEDIUM** | ผู้ตรวจไม่ยืนยันตัวตน, hash ไม่ใช่ลายเซ็น | ความน่าเชื่อถือของบันทึกอนุมัติ | VERIFIED |
| **MEDIUM** | ข้อความเอียงมุมอื่น (ไม่ใช่ 0/90) | อ่านไม่ได้ → ไม่พบ (ปลอดภัย แต่เพิ่มงานคน) | VERIFIED (code) |
| **LOW** | CropBox/UserUnit ไม่ได้จัดการเอง | ไฟล์ที่ใช้ UserUnit อาจคิดสเกลผิด | ASSUMPTION — ไม่มีตัวอย่าง |
| **LOW** | CommonJS consumer require engine ไม่ได้ (top-level await) | สคริปต์นอก repo | VERIFIED (R20.2) |

## I. Development Roadmap (เรียงตาม engineering risk → dependency → difficulty)
| Phase | งาน | เหตุผล | ยาก | ผลต่อความเร็ว | ขึ้นกับ |
|---|---|---|---|---|---|
| **0** | **Measurement first:** เพิ่ม metric ต่อชนิด (sheet class, tag, dimension, rebar, cross-view, duplicate P/R, false merge, quantity error %) ใน `eval_reading` + timing / memory ต่อหน้า (`processLog` + `perPage`) | ไม่มี metric = แก้แล้วพิสูจน์ไม่ได้ | ต่ำ–กลาง | — | — |
| **1** | **Content cache** (IndexedDB, key = sha:page:readerVersion) + บันทึก `PageRecord` | เปิดซ้ำไม่ต้อง OCR; ไม่กระทบความถูกต้อง | กลาง | สูง (เปิดซ้ำ) | 0 |
| **2** | **Schedule ↔ plan linking** (ลิงก์ row กับชิ้นในผังด้วย tag + count ที่ตรงกัน → เสนอให้คนยืนยัน ไม่ auto) + ตัวเลือก "ตารางสรุป" | ลดความเสี่ยงนับซ้ำ CRITICAL | กลาง | — | R22.1, 0 |
| **3** | **Adaptive ROI OCR** (validate → ROI retry → หมุนเฉพาะ ROI + transform) | ลด "ไม่พบ" 14% และลด OCR ทั้งหน้า | สูง | กลาง–สูง | 0, 1 |
| **4** | **Page-level parallelism + worker core** (หลายหน้าพร้อมกันตามจำนวน worker / VRAM) | เวลาไฟล์ใหญ่ | กลาง | สูง | 1 |
| **5** | **Member identity registry** (PhysicalMember/DrawingReference) | cross-view, elevation | สูง | — | 2 |
| **6** | **Server worker** (Node, ใช้ core เดียวกัน) + auth ผู้ตรวจ + ลายเซ็น | commercial | สูง | สูง (GPU server) | 4 |
| ภายหลัง | spatial index | ทำเฉพาะเมื่อ profiling ชี้ | กลาง | ไม่ทราบ | 0 |

## J. Benchmark Plan
- **ชุดข้อมูลคงที่:**
  - dev: house_ready_1..4, toilet_604_45, dot32_pavilion, cdc_1
  - held-out (วัดอย่างเดียว ห้ามปรับ): cdc_2, cdc_3, carpark_srinakorn, thaisuk_5..8
  - เครื่องและ browser เดิม; บันทึกรุ่น GPU/CPU, `engineId`, reader commit
- **ก่อน/หลังทุก phase:**
  1. `npm test` (ต้องผ่านทั้งหมด)
  2. parity
  3. `check:full` บนสำเนา (diff กับรอบก่อน)
  4. `eval_reading` ต่อชนิด
  5. timing ต่อหน้า (median, p90), เวลารวม, peak memory / VRAM
  6. จำนวนหน้าที่ OCR และจำนวน ROI retry
- **ตัวชี้วัดความถูกต้อง:** CER / WER บนคำที่มี answer key (ต้องสร้าง key ระดับคำเพิ่ม), tag / dimension accuracy, classification accuracy, cross-view และ duplicate precision / recall, **false merge rate**, **false release (ต้อง = 0)**, quantity error % เทียบ ปร.4, BOQ completeness
- **ห้ามใช้ test pass rate แทนความแม่นทางวิศวกรรม** และห้ามรายงานผลจาก synthetic ว่าเป็นผลกับแบบจริง

## K. Final Recommendation
1. **ควรทำก่อน:**
   - Phase 0 (วัดผลต่อชนิด + timing) และ Phase 1 (content cache) — ความเสี่ยงต่ำ ไม่แตะสูตร แต่ทำให้ทุกการปรับต่อจากนี้วัดผลได้และเร็วขึ้นทันทีเมื่อเปิดซ้ำ
   - ตามด้วย Phase 2 (schedule ↔ plan) ซึ่งตรงกับความเสี่ยงนับซ้ำที่เหลืออยู่
2. **ยังไม่ควรทำ:**
   - ย้ายระบบไป Python หรือ rewrite reader / engine
   - เพิ่ม spatial index หรือ dependency ใหม่ก่อนมีหลักฐานจาก profiling
   - auto-release จาก OCR confidence
   - auto-merge ชิ้นด้วย tag หรือค่าเหมือนกัน
   - ใช้ paid AI API เป็นทางหลัก
3. **ความเสี่ยงสูงสุดต่อความถูกต้องของ BOQ:**
   - ความแม่นการอ่านแบบจริงยังต่ำ โดยเฉพาะแบบสแกนที่ held-out ~15%
   - ร่วมกับการนับซ้ำระหว่าง schedule และชิ้นในผังที่ยังต้องพึ่งคน
   - ระบบตอนนี้ **ปลอดภัย** เพราะ gate ไม่ปล่อยยอดที่เสี่ยง (0 false release) แต่ยัง **ไม่อัตโนมัติ**: ทุกยอดต้องผ่านผู้ตรวจ

---
**ข้อจำกัดของ audit นี้:**
- ไม่ได้วัดเวลาหรือความแม่นใหม่ ตัวเลขประสิทธิภาพมาจาก session นี้ (synthetic) และรายงานเดิม
- อ่านโค้ดแบบเจาะจุด ไม่ได้อ่านทุกบรรทัดของ `sheetReader.ts` (1,728 บรรทัด) และ `qsEngine.ts` (2,508 บรรทัด)
- ข้อสรุปเรื่องคุณภาพการจำแนกแผ่นหรือเส้นจึงเป็นระดับ code-path ไม่ใช่ระดับความแม่น
