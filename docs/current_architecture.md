# StructBOQ — Current Architecture Document

**Version:** 1.0 (Audit Baseline)  
**Date:** 2026-10-21  
**Author:** Senior Python Engineer, CAD/PDF Processing Engineer & Civil Quantity Surveyor  

---

## 1. Executive Overview

StructBOQ is a deterministic construction drawing quantity takeoff (QS) system designed for reinforced concrete (RC) structures according to Thai Engineering Institute (วสท.) and Comptroller General's Department (กรมบัญชีกลาง) standards.

The system is strictly offline, deterministic, and operates with **ZERO Generative AI / LLM dependencies**. All geometry extraction, optical character recognition (OCR), structural rule interpretation, and quantity survey formulas run locally on the host machine.

---

## 2. Technology Stack & Runtime Architecture

| Layer | Technologies / Libraries | Execution Environment | Role |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | React 19, TypeScript, Tailwind CSS v4, Lucide Icons | Client Browser (Vite Dev / Preview) | Interactive 3-step workflow, 2D framing plan canvas, PDF viewer, Review Workspace, BOQ tables |
| **PDF Processing (Client)** | `pdfjs-dist` (v4.10.38) | Web Worker & Canvas | PDF vector stroke extraction, canvas rasterization for viewport display and 400 DPI OCR prep |
| **Local OCR (Client/Node)** | ONNX Runtime (`onnxruntime-web`), PaddleOCR v4 models (`@gutenye/ocr-models`), Tesseract.js (v5.1.1) | Local CPU / WASM / Node.js | Local text detection (DBNet) and recognition (SVTR/CTC) for blueprint raster scans; Thai script fallback |
| **CAD / Vector Parsing** | Python 3.14 (`ezdxf` 1.4.4, `shapely` 2.1.2), TypeScript (`dxfParser.ts`) | Python CLI / Local engine | ASCII DXF parsing ($INSUNITS, TEXT, MTEXT, LINE, POLYLINE), CAD coordinate translation |
| **Local Python Core** | Python 3.14 (`pymupdf` / `fitz` 1.28.2, `opencv-python` 4.13, `openpyxl` 3.1.5, `numpy`, `pandas`) | Local Python Environment | Deterministic CAD/PDF processing, vector geometry extraction, test fixture generation, high-precision quantity calculations |
| **Quantity Engine** | TypeScript (`qsEngine.ts`, `sheetMerge.ts`), Python mathematical rules | Node / Browser runtime | Mathematical formulas for Concrete, Formwork, Rebar (RB/DB), Earthwork, Factor F, and Por Ror 4/5 exports |
| **BOQ Export** | `xlsx` (SheetJS), `openpyxl` | Client & Local Python | Official 5-sheet Thai Government BOQ (ปร.4, ปร.5, Factor F, Summary, Quantities) |

---

## 3. Directory & Module Structure

```
structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/
├── docs/                             # Engineering and architecture documentation
│   ├── current_architecture.md       # (This document) Comprehensive system architecture
│   ├── known_issues.md               # Identified bugs, bottlenecks, and accuracy gaps
│   ├── processing_pipeline.md        # Deterministic data flow from drawing to BOQ
│   ├── drawing-reading.md            # Structural drafting rules and interpretation principles
│   └── handover-2026-10-21.md        # Handover status and regression baseline
├── public/                           # Static assets, traineddata models, sample CAD/PDF files
│   ├── eng.traineddata               # Local Tesseract English model (5.2 MB)
│   ├── tha.traineddata               # Local Tesseract Thai model (1.0 MB)
│   └── samples/                      # Sample DXF and PDF files
├── real_drawings/                    # Ground truth datasets (house_ready_1..4, plan_house_1, etc.)
│   ├── plan_house_1/                 # DPT 1-storey House Plan 1 (Drawings, BOQ XLS, Manifest)
│   └── ...                           # CDC and pavilion benchmark suites
├── scripts/                          # Deterministic processing & benchmark scripts
│   ├── benchmark_offline.ts          # Offline evaluation vs official BOQs (Por Ror 4)
│   ├── eval_reading.ts               # Accuracy measurement vs ground truth answer keys
│   ├── offline_ocr.ts                # Batch local OCR rasterizer (PaddleOCR + Tesseract)
│   ├── scanImage.ts                  # Otsu thresholding, deskew, line removal
│   ├── generate_sample_pdf.py        # Python PyMuPDF sample structural schedule generator
│   └── generate_sample_dxf.py        # Python ezdxf sample structural framing generator
├── src/
│   ├── components/                   # React presentation and interactive inspection UI
│   │   ├── PdfViewer.tsx             # Canvas-based PDF viewer with clickable evidence bounding boxes
│   │   ├── PlanView.tsx              # Interactive 2D Framing Plan (White paper & Blueprint modes)
│   │   ├── ReviewWorkspace.tsx       # Side-by-side member audit & reviewer patch panel
│   │   ├── QuantityTable.tsx         # Por Ror 4 category breakdown with formula breakdown
│   │   ├── MaterialSpecsModal.tsx    # Live material unit rates, waste factors, concrete grades
│   │   └── OfficialReportModal.tsx   # Comptroller General printable government report
│   ├── engine/                       # Core Takeoff & Merging Engine
│   │   ├── qsEngine.ts               # Verified engineering formulas (Concrete, Formwork, Rebar)
│   │   ├── sheetMerge.ts             # Cross-sheet linking (Plan instances + Section definitions)
│   │   ├── boqCompare.ts             # Tolerance and reconciliation against official BOQ
│   │   └── reviewLog.ts              # Audit trail of manual overrides and accepted suggestions
│   ├── export/                       # Excel export generators
│   │   └── excelWorkbook.ts          # 5-Sheet Excel Workbook with native formulas
│   └── pdf/                          # Ingestion, OCR & Vector Parsing
│       ├── sheetReader.ts            # Rule-based structural drawing interpreter (~1,500 lines)
│       ├── barNotation.ts            # Structural rebar notation parser (DB/RB, stirrups, spacing)
│       ├── dxfParser.ts              # Lightweight browser DXF ASCII text parser
│       ├── paddleOcr.ts              # Local ONNX PP-OCRv4 detection & recognition runner
│       ├── pdfOcrPipeline.ts         # Dual-pass raster/vector OCR controller
│       ├── scanPrep.ts               # Deskew, line removal, ring/bubble detection
│       └── vectorText.ts             # Small stroke clustering for CAD-generated PDF text
├── requirements.txt                  # Python dependencies (PyMuPDF, ezdxf, opencv, shapely)
└── package.json                      # Web dependencies and build scripts
```

---

## 4. Subsystem Details

### 4.1 Ingestion & Parsing Subsystem
1. **PDF Ingestion:**
   - Vector PDFs (e.g. AutoCAD PDF exports) are inspected for native font objects and small stroke segments. Text is reconstructed via `vectorText.ts`.
   - Scanned PDFs (e.g. scanned blueprints) are rasterized at 400 DPI, processed with Otsu adaptive thresholding and horizontal projection deskew, and passed to local PaddleOCR v4 / Tesseract.
2. **DXF / DWG Ingestion:**
   - In browser: `dxfParser.ts` parses ASCII DXF pairs for text labels containing member patterns (`B1 0.20x0.40`).
   - In Python: `ezdxf` reads AutoCAD DXF/DWG geometries, layers, block definitions, and dimension entities.

### 4.2 Structural Interpretation Subsystem (`sheetReader.ts`)
- **Grid Axis Extraction:** Discovers dimension chains (`findChains`), detects grid bubbles (`circlesAtEnds`), and builds spatial coordinates ($X_0..X_n, Y_0..Y_m$).
- **Plan Detection:** Evaluates spatial clustering of member labels against grid lines (`plansOn`), separating multi-plan drawings via horizontal (`splitSideBySide`) and vertical (`splitStacked`) gap analysis.
- **Section Detail Extraction:** Reads member cross-sections, matching width, depth, thickness, and longitudinal/transverse rebar notes to candidate member tags (`repairTag`).
- **Completeness & Inference:** Identifies missing member definitions, orphan cross-sections, and structural continuity requirements (e.g. Footing-to-Column stub continuity).

### 4.3 Quantity Calculation Subsystem (`qsEngine.ts`)
- **Concrete:** Pure geometric volumes minus structural intersections:
  $$V_{\text{beam}} = W \times D \times L_{\text{net}}, \quad L_{\text{net}} = L_{\text{gross}} - \frac{W_{\text{col1}} + W_{\text{col2}}}{2}$$
  $$V_{\text{col}} = W \times D \times H_{\text{gross}} - V_{\text{joint}}$$
  $$V_{\text{footing}} = W \times L \times T$$
- **Formwork:** Contact surface area excluding concrete-to-concrete joints:
  $$A_{\text{beam, form}} = (2D + W) \times L_{\text{net}}$$
  $$A_{\text{col, form}} = 2(W + D) \times (H - D_{\text{beam}})$$
  $$A_{\text{footing, form}} = 2(W + L) \times T$$
- **Reinforcement Steel:** Exact unit weights per TIS (มอก. 24-2559 / มอก. 20-2559):
  $$\text{RB6} = 0.222 \text{ kg/m}, \quad \text{RB9} = 0.499 \text{ kg/m}$$
  $$\text{DB12} = 0.888 \text{ kg/m}, \quad \text{DB16} = 1.578 \text{ kg/m}, \quad \text{DB20} = 2.466 \text{ kg/m}, \quad \text{DB25} = 3.853 \text{ kg/m}$$
  $$W_{\text{rebar}} = \sum N_{\text{bars}} \times L_{\text{cut}} \times w_{\text{unit}}$$

---

## 5. Verification & Traceability Data Model

Every single quantity in the system implements the `CalculatedQuantity` schema:
- `itemId`: Unique deterministic ID (e.g. `QS-B-001`)
- `tag`: Member structural identifier (e.g. `B1`)
- `gridLocation`: Precise structural grid reference (e.g. `B/1–C/1`)
- `level`: Structural story (e.g. `ฐานราก`, `ชั้น 1`)
- `status`: Validation state (`VALIDATED`, `NEEDS_REVIEW`, `REJECTED`, `OVERRIDDEN`)
- `flags`: Explicit civil engineering warning codes (`FIELD_MISSING`, `FIELD_ASSUMED`, `REBAR_CODE_MINIMUM`, `DUPLICATE_TAKEOFF`)
- `provenance`: File source, sheet number, pixel/point 2D bounding box (`box_2d`), and calculation breakdown formula.
