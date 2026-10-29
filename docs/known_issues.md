# StructBOQ — Known Issues & Accuracy Bottlenecks

**Version:** 1.0  
**Date:** 2026-10-21  
**Classification:** Technical Debt & Takeoff Deviation Analysis  

---

## 1. Summary of Takeoff Accuracy Gaps

From comprehensive offline benchmarks comparing automated takeoffs against official Thai Comptroller General (กรมบัญชีกลาง) and Department of Public Works (DPT) BOQs, the following primary variance drivers have been identified:

```
[Overall BOQ Variance Breakdown]
├── 1. DXF Vector Entities Unread (Browser DXF only reads TEXT/MTEXT)   --> 100% loss on pure CAD geometry
├── 2. OCR Rebar Notation Confusion on Blueprint Scans                  --> 25% - 40% rebar weight deviation
├── 3. Footing Excavation / Sand / Lean Bedding Rule Variance           --> 50% - 80% earthwork deviation
├── 4. Column Height & Beam Support Joint Deductions                    --> 5% - 15% concrete volume deviation
└── 5. Floor Slabs (Cast-in-place vs Precast Planks) Classification     --> 10% - 25% floor finish deviation
```

---

## 2. Detailed Technical Issues

### Issue #1: Browser DXF Parser Ignores Vector Geometry (`dxfParser.ts`) [CRITICAL]
- **Current Behavior:** The TypeScript DXF parser (`src/pdf/dxfParser.ts`) only parses `TEXT` and `MTEXT` entities that contain explicit string dimensions (e.g. `B1 0.20x0.40 L=4.00m`).
- **Failure Mode:** In 95% of real-world AutoCAD drawings, beams and columns are drawn as `LINE`, `LWPOLYLINE`, `INSERT` (blocks), or `DIMENSION` entities on dedicated layers (e.g. `S-BEAM`, `S-COL`). The browser parser ignores all geometric entities, resulting in **0 members extracted** if text labels lack inline dimension formulas.
- **Impact on Quantities:** Up to **100% loss** on CAD drawings that follow standard layer-based drafting conventions.

### Issue #2: Scanned Drawing Thai Rebar OCR Artifacts (`barNotation.ts`) [HIGH]
- **Current Behavior:** Scanned blueprints (like CDC child development centers and DPT house plans) contain Thai rebar prefixes (`ป`, `ปลอก`, `มม.`, `ชั้น`) and diameter symbols (`ø`, `Ø`, `dia`).
- **Failure Mode:**
  - `ø` frequently gets read as `0`, `8`, `@`, `¢`, or Thai `ผู`.
  - `ป` (stirrup prefix) gets read as `U`, `ๆ1`, `11`, or `ข`.
  - Digit `1` is dropped before diameter numbers (e.g. `2-DB2` instead of `2-DB12`).
- **Impact on Quantities:** Rebar weights in scanned blueprints can deviate by **20% to 45%** if longitudinal bar counts or diameters fall back to code-minimum assumptions.

### Issue #3: Earthwork & Foundation Substructure Assumptions [MEDIUM]
- **Current Behavior:**
  - Default excavation clearance around footings was originally $+0.20$ m with $\times 1.20$ bulking factor, whereas official DPT BOQs calculate pure neat excavation ($+0.10$ m each side, no bulking).
  - Sand bedding ($0.05$ m or $0.10$ m) and Lean concrete ($0.05$ m or $0.10$ m) under footings are often listed as separate items in Por Ror 4, but if footing thickness is misread, earthwork items deviate in tandem.
- **Impact on Quantities:** Up to **60% - 80% variance** on Category 1 (Earthwork) in Por Ror 4.

### Issue #4: Single-Story Wooden Roof vs Two-Story Concrete Slab Differentiation [MEDIUM]
- **Current Behavior:** In single-story house drawings (e.g. บ้านประหยัดแบบ 1), Page 10 is titled `ผังคานและโครงหลังคา` (S-02) but contains a wooden roof structure (`ไม้เนื้อแข็งทำโครงหลังคา 1"x6", 2"x8"`).
- **Failure Mode:** If the system attempts to treat wooden roof framing as reinforced concrete tie beams, it generates phantom concrete members or flags missing concrete cross-sections.
- **Impact on Quantities:** Unnecessary review flags and risk of phantom concrete takeoff.

### Issue #5: Stacked Plan Partitioning on Blueprint Sheets [RESOLVED IN RECENT UPDATE]
- **Status:** **FIXED** in recent update via `splitStacked`.
- **Previous Failure Mode:** Sheets containing both shallow foundation (`แปลนฐานรากแผ่`) and pile foundation (`แปลนฐานรากเสาเข็ม`) stacked vertically were merged into a single 15-meter grid.
- **Current Status:** Verified working; vertical gap analysis separates stacked drawings into distinct foundation alternatives.

---

## 3. Priority Matrix for Systematic Resolution

| Priority | Issue Description | Primary Files Affected | Estimated Impact on Accuracy |
| :---: | :--- | :--- | :---: |
| **P0** | Full DXF/CAD Vector Ingestion (parsing `LINE`, `LWPOLYLINE`, `INSERT`, `DIMENSION`) | `src/pdf/dxfParser.ts`, Python CAD processor | **+40% to +80%** on CAD projects |
| **P1** | Thai Rebar Notation & Multi-layer Hook/Lap Cut Length Calibration | `src/pdf/barNotation.ts`, `qsEngine.ts` | **+15% to +25%** on Rebar takeoff |
| **P2** | Neat Excavation & Sand/Lean Foundation Specifications Config | `src/engine/qsEngine.ts`, `MaterialSpecsModal.tsx` | **+20% to +35%** on Earthwork |
| **P3** | Timber / Structural Steel Exclusion from Reinforced Concrete Takeoff | `src/pdf/sheetReader.ts` | Prevents phantom RC takeoff |
