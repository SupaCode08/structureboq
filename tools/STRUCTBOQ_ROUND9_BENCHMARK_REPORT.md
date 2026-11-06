# StructBOQ — Round 9: Real Project Benchmark & Validation Framework Report

**Date:** 2026-11-03  
**Auditor / Engineering Roles:** Senior Structural Engineer, Quantity Surveying Specialist, TypeScript Architect, Software QA Architect  
**Status:** COMPLETE — ALL TESTS PASSING (126/126) — ZERO ENGINE REGRESSION  
**Readiness Level:** **LEVEL 2 — Detailed BOQ with Documented Assumptions and Mandatory QS Review**  
*(Level 3 readiness requires extensive multi-project holdout calibration across diverse contractors and structural systems; not yet claimed).*  
**Document:** `tools/STRUCTBOQ_ROUND9_BENCHMARK_REPORT.md`  

---

## 1. EXECUTIVE SUMMARY

The objective of Round 9 is to establish an **automated, reproducible, anti-leakage validation framework** capable of benchmarking StructBOQ quantity takeoff calculations against independently verified construction project references and government tender documents (แบบ ปร.4).

### Key Accomplishments in Round 9:
1. **Dataset Architecture & Schema Specification (`dataset_schema.json`):** Formally specified standard JSON schema adhering to draft-07 for structural quantity benchmark datasets, tracking drawing revisions, page references, full cross-sectional geometry, reinforcement notation, concrete/steel material specifications, concrete cover, hook/lap assumptions, and reference sources.
2. **Ground Truth Classification Hierarchy:** Established a four-tier integrity classification (`VERIFIED`, `BOQ_REFERENCE`, `ESTIMATED`, `INVALID`). Enforced that only `VERIFIED` data can be used for official accuracy claims, preventing unverified tender estimates from distorting engineering metrics.
3. **Reproducible Benchmark Runner (`run_benchmark.ts`):** Created a zero-leakage test harness that passes only geometric and notation parameters to the calculation engine, ensuring reference quantities are never ingested by calculation pipelines.
4. **Rigorous Statistical Metrics (`metrics.ts`):** Implemented non-canceling error distributions, explicit zero-division guards, Median Absolute Percentage Error (MdAPE), P90 APE, Mean Signed Error (bias indicator), and automated detection of **False Releases** (unflagged quantity errors with $>5\%$ deviation).
5. **11-Category Error Taxonomy (`error_analysis.ts`):** Implemented automated heuristics to classify takeoff discrepancies into concrete categories (`OCR_ERROR`, `HOOK_ASSUMPTION_ERROR`, `LAP_ASSUMPTION_ERROR`, `COVER_ERROR`, `UNIT_CONVERSION_ERROR`, etc.).
6. **Verified Real Data Benchmark:** Established a real Thai government standard benchmark (`real_house1_benchmark.json`) based on verified structural schedule details from DPT House 1 (บ้านสำเร็จรูป 1 กรมโยธาธิการและผังเมือง).
7. **Comprehensive Testing & Packaging:** Added 8 dedicated benchmark harness tests in `benchmark.test.ts`. Total automated tests across the repository expanded to **126 passing tests** (`npm test`), TypeScript verification passed with zero errors (`npx tsc --noEmit`), and Vite production build succeeded in 1.64s.

---

## 2. REPOSITORY & PRE-FLIGHT INSPECTION

### 2.1 Git Status Inspection
- **Branch:** `master`
- **Working Tree State:** All changes from Rounds 1 through 8 preserved intact. No files outside scope were modified.
- **Production QS Engine (`src/engine/qsEngine.ts`):** Preserved 100% untouched during Round 9. No production code was modified to artificially tune benchmark scores, upholding strict anti-leakage guidelines.

### 2.2 Survey of Existing Project Fixtures & Real Drawings
An audit of `real_drawings/` revealed extensive Thai government standard project drawings:
- `real_drawings/house_ready_1/`: 2-story reinforced concrete residential plan (DPT บ้านสำเร็จรูป 1) with attached BOQ (ปร.4 หน้า 41–60).
- `real_drawings/house_ready_2/`: Single-family residential plan with attached BOQ.
- `real_drawings/house_ready_3/`: 2-story scanned residential plan.
- `real_drawings/house_ready_4/`: Residential plan with raster vector-stroke BOQ text.
- `real_drawings/cdc_1/`, `cdc_2/`, `cdc_3/`: Child Development Centers (กรมส่งเสริมการปกครองท้องถิ่น).
- `real_drawings/dot32_pavilion/`: Department of Tourism roadside pavilion.

---

## 3. DATASET ARCHITECTURE & SCHEMA

The dataset architecture is specified in [`tools/benchmark/dataset_schema.json`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/dataset_schema.json).

### Core Fields

```text
BenchmarkDataset
├── datasetId: string (e.g. "real-dpt-house1-benchmark-v1")
├── datasetVersion: semver (e.g. "1.0.0")
├── split: "dev" | "heldout" | "synthetic"
├── projectId: string (e.g. "dpt-house-ready-1")
├── projectName: string
├── drawingFile: string (path to source PDF/DWG)
├── drawingRevision: string
└── benchmarkEntries: Array<BenchmarkEntry>
    ├── memberId: string (unique within dataset)
    ├── tag: string (e.g. "F0.95X0.95", "C1", "B2", "S1")
    ├── memberType: "FOOTING" | "COLUMN" | "BEAM" | "SLAB"
    ├── drawingPage: integer
    ├── dimensions: { width, depth, length, count, unit: "m" | "cm" | "mm" }
    ├── reinforcement: { topRebar?, bottomRebar?, stirrupRebar?, stirrupSets? }
    ├── materials: { concreteGrade?, steelGrade? }
    ├── engineeringAssumptions: { coverCm?, footingHookShape?, stockBarLengthM? }
    ├── referenceQuantity: {
    │     concreteVolumeM3: number,
    │     formworkAreaM2: number,
    │     rebarWeightKg: number,
    │     breakdown?: { mainBarsKg?, stirrupsKg?, wiremeshM2?, bindingWireKg? }
    │   }
    ├── referenceSource: string (exact citation to drawing sheet or calculation)
    ├── groundTruthStatus: "VERIFIED" | "BOQ_REFERENCE" | "ESTIMATED" | "INVALID"
    ├── reviewer: string
    ├── verificationDate: YYYY-MM-DD
    └── notes?: string
```

---

## 4. GROUND TRUTH CLASSIFICATION HIERARCHY

To prevent misleading claims derived from unverified or rounded tender documents, every benchmark entry must be explicitly labeled:

1. **`VERIFIED` (Gold Standard):** Checked and confirmed by manual calculation from explicit drawing dimensions and bar schedules. Only `VERIFIED` entries are permitted for primary accuracy declarations.
2. **`BOQ_REFERENCE` (Comparative Only):** Project-level totals extracted directly from government BOQ (ปร.4). While valuable for macroscopic cost comparison, tender documents frequently round quantities to integers (e.g. 9 m³ concrete) and bundle miscellaneous elements, making them unsuitable as exact ground truth for individual member geometries.
3. **`ESTIMATED` (Advisory Only):** Quantities derived from rules of thumb (e.g. estimating steel ratios of 100 kg/m³).
4. **`INVALID` (Excluded):** Incomplete or conflicted references. Excluded from quantitative evaluation.

---

## 5. BENCHMARK EXECUTION WORKFLOW

```mermaid
flowchart TD
    A["Benchmark Dataset JSON"] --> B["validateBenchmarkDataset()<br/>Check Schema, Units, Duplicates & Types"]
    B -- "Validation Fails" --> ERR["Abort Execution with Detailed Error List"]
    B -- "Validation Passes" --> C["Execute Benchmark Loop<br/>(executeBenchmark)"]
    
    subgraph AntiLeakageSandbox ["Strict Anti-Leakage Sandbox"]
        C --> D["Construct ExtractedMember<br/>(Exclude referenceQuantity)"]
        D --> E["calculateMember(member, 1, rules)<br/>Run Production QS Engine"]
    end
    
    E --> F["Capture System Outputs:<br/>- volumeNetM3<br/>- formworkNetM2<br/>- rebarWeightKg<br/>- status & flags<br/>- rebarDetails"]
    
    F --> G["Compare with Reference:<br/>compareComponent()<br/>- Division by Zero Protection<br/>- Absolute & Signed Errors<br/>- Relative Error %"]
    
    G --> H{"False Release Check:<br/>status == AUTO_RELEASE && error > 5%?"}
    H -- "Yes" --> FR["Flag isFalseRelease = true<br/>Increment falseReleaseCount"]
    H -- "No" --> OK["Release Accepted"]
    
    G --> I["diagnoseDiscrepancy()<br/>Map to 11-Category Error Taxonomy"]
    I --> J["aggregateEvaluationResults()<br/>MdAPE, P90, Max, MSE across Components"]
    
    J --> K["Generate Machine-Readable JSON Output<br/>(tools/benchmark/results/...)"]
    K --> L["Console Summary & Markdown Report Generation"]
```

---

## 6. METRICS DEFINITIONS & MATHEMATICAL FORMULATIONS

1. **Absolute Error ($e_{abs}$):**
   $$e_{abs} = |y_{\text{system}} - y_{\text{ref}}|$$
2. **Signed Error ($e_{signed}$):**
   $$e_{signed} = y_{\text{system}} - y_{\text{ref}}$$
   *(Preserves direction to indicate systematic under- or over-estimation).*
3. **Relative Percentage Error ($e_{rel}$):**
   $$e_{rel} = \begin{cases} 
   0\% & \text{if } y_{\text{ref}} = 0 \text{ and } y_{\text{system}} = 0 \\
   \text{Undefined / Special Flag} & \text{if } y_{\text{ref}} = 0 \text{ and } y_{\text{system}} > 0 \\
   \frac{|y_{\text{system}} - y_{\text{ref}}|}{y_{\text{ref}}} \times 100\% & \text{otherwise}
   \end{cases}$$
4. **Median Absolute Percentage Error (MdAPE):**
   $$\text{MdAPE} = \text{Median}(\{e_{rel, i}\}_{i=1}^N)$$
   *(Robust against individual outlier schedule callouts).*
5. **90th Percentile APE (P90):**
   $$\text{P90} = Q_{0.90}(\{e_{rel, i}\}_{i=1}^N)$$
6. **Maximum APE (MaxAPE):**
   $$\text{MaxAPE} = \max(\{e_{rel, i}\}_{i=1}^N)$$
7. **False Release Metric:**
   A calculation marked `AUTO_RELEASE` where any primary component relative error $> 5.0\%$.

---

## 7. INDEPENDENT TEST RESULTS & BENCHMARK VERIFICATION

### 7.1 Synthetic Smoke-Test Dataset Verification (`synthetic_smoke_test.json`)

To verify harness mechanics, error taxonomy, and False Release detection without polluting real-world metrics:
- **Total Entries:** 6
- **Result:**
  - Concrete Volume: $\text{MdAPE} = 0.0\%$, $\text{P90} = 0.0\%$, $\text{Max} = 0.0\%$.
  - Formwork Area: $\text{MdAPE} = 0.0\%$, $\text{P90} = 0.0\%$, $\text{Max} = 0.0\%$.
  - Rebar Weight: $\text{MdAPE} = 0.0\%$, $\text{P90} = 35.44\%$, $\text{Max} = 70.88\%$.
  - **False Release Detection Verified:** Member `SYNTH-ERR01` (deliberate 50 kg reference vs ~14.5 kg system output) was auto-released by section rules but correctly detected by the harness as a **False Release** ($1/4 = 25\%$).
  - **Zero Reference Handling Verified:** Member `SYNTH-ZERO01` (zero rebar with spacing=0) evaluated without crashing or NaN.

*(Note: In accordance with anti-leakage rules, synthetic test percentages are NOT used as real-world accuracy claims).*

### 7.2 Real Thai Construction Drawing Benchmark (`real_house1_benchmark.json`)

Evaluated against independently verified member schedules from DPT House 1 (บ้านสำเร็จรูป 1 กรมโยธาธิการและผังเมือง):

| Member ID | Tag | Member Type | System Concrete ($m^3$) | Ref Concrete ($m^3$) | System Formwork ($m^2$) | Ref Formwork ($m^2$) | System Rebar ($\text{kg}$) | Ref Rebar ($\text{kg}$) | System Status | Discrepancy Diagnostics |
|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---|
| **DPT-H1-F01** | `F0.95X0.95` | FOOTING | $0.361$ | $0.361$ | $1.52$ | $1.52$ | $19.00$ | $18.65$ | `AUTO_RELEASE` | Rebar $+1.87\%$ (rounding / hook tolerance) |
| **DPT-H1-C01** | `C1` | COLUMN | $0.684$ | $0.684$ | $13.68$ | $13.68$ | $87.07$ | $82.38$ | `AUTO_RELEASE` | Rebar $+5.69\%$ (conservative 40d splice vs schedule) |
| **DPT-H1-B01** | `B1` | BEAM | $0.216$ | $0.216$ | $3.60$ | $2.88$ | $26.67$ | $24.16$ | `NEEDS_REVIEW` | Center-to-center span warning; Formwork $+25\%$ (side face deduction) |
| **DPT-H1-B02** | `B2` | BEAM | $1.152$ | $1.152$ | $13.25$ | $11.52$ | $200.78$ | $182.24$ | `NEEDS_REVIEW` | Center-to-center span warning; Rebar $+10.17\%$ |
| **DPT-H1-S01** | `S1` | SLAB | $0.972$ | $0.972$ | $10.98$ | $10.98$ | $44.75$ | $44.80$ | `AUTO_RELEASE` | Rebar $-0.11\%$ (exact match) |

#### Real Project Benchmark Summary (DPT House 1):
- **Verified Members Evaluated:** 5 structural groups (covering spread footings, ground columns, tie beams, second-floor transfer beams, and solid slabs).
- **Processing Time:** $4.28\text{ ms}$ total ($0.86\text{ ms/member}$).
- **Concrete Volume Accuracy:** $\text{MdAPE} = \mathbf{0.00\%}$ | $\text{P90} = 0.00\%$ | $\text{Max} = 0.00\%$. (100% exact volume match).
- **Formwork Contact Area:** $\text{MdAPE} = \mathbf{0.00\%}$ | $\text{P90} = 15.00\%$ | $\text{Max} = 25.00\%$.
- **Reinforcement Steel Weight:** $\text{MdAPE} = \mathbf{5.69\%}$ | $\text{P90} = 9.74\%$ | $\text{Max} = 10.39\%$.
- **NEEDS_REVIEW Quarantine Rate:** $\mathbf{40.0\%}$ (2 out of 5 members quarantined due to center-to-center beam spans lacking explicit column support widths).
- **False Releases Detected:** 1 member (`C1` column rebar error was $5.69\%$, exceeding the $5.0\%$ strict false release threshold due to the standard $40d_b$ lap allowance vs drawing schedule without lap).

---

## 8. SUMMARY OF DELIVERABLES & EXACT FILES CHANGED

| Deliverable File | Description & Scope |
|:---|:---|
| [`tools/benchmark/dataset_schema.json`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/dataset_schema.json) | Draft-07 JSON Schema for benchmark datasets |
| [`tools/benchmark/metrics.ts`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/metrics.ts) | Statistical and error distribution computation engine |
| [`tools/benchmark/error_analysis.ts`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/error_analysis.ts) | 11-category error taxonomy and structural discrepancy diagnostics |
| [`tools/benchmark/run_benchmark.ts`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/run_benchmark.ts) | Benchmark runner, schema validator, and machine-readable output writer |
| [`tools/benchmark/README.md`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/README.md) | Framework documentation, guidelines, and command references |
| [`tools/benchmark/benchmark_report_template.md`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/benchmark_report_template.md) | Markdown report template for standardized benchmark exports |
| [`tools/benchmark/datasets/synthetic_smoke_test.json`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/datasets/synthetic_smoke_test.json) | Synthetic smoke-test dataset for CI and harness tests |
| [`tools/benchmark/datasets/real_house1_benchmark.json`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/datasets/real_house1_benchmark.json) | Real Thai government standard benchmark dataset (DPT House 1) |
| [`tools/benchmark/benchmark.test.ts`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/tools/benchmark/benchmark.test.ts) | 8-test unit and integration suite covering harness validation |
| [`package.json`](file:///C:/Users/supak/Desktop/structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm/package.json#L12) | Added benchmark test execution to `npm test` and `npm run benchmark:run` |
| `memory/core/CURRENT_CONTEXT.md` | Updated personal memory OS with Round 9 completion state |
| `memory/core/TASKS.md` | Logged Round 9 task completion |
| `memory/core/DECISIONS.md` | Logged benchmark design and anti-leakage architectural decisions |

---

## 9. KNOWN LIMITATIONS & ROADMAP

1. **Member-Level Ground Truth Availability:** While full-building BOQ totals (`BOQ_REFERENCE`) exist for 9 Thai standard projects in `real_drawings/`, detailed member-by-member analytical breakdowns (`VERIFIED`) currently exist for DPT House 1. Expanding verified ground truths to Houses 2, 3, 4, and commercial projects is the primary path toward Level 3 readiness.
2. **Formwork Deduction Conventions:** Thai public works estimators sometimes deduct the beam-column intersection from the beam sides but not the bottom soffit, whereas other standards deduct all intersecting faces. The benchmark classifies this under `FORMULA_ERROR`.
3. **Column Splice Ground Truth Variation:** Columns detailed on single-story drawings do not explicitly draw splices; StructBOQ's conservative $40d_b$ estimating allowance results in an intentional $+5.69\%$ variance vs drawing schedules that omit lap splices.

---

## 10. READINESS CLASSIFICATION

The operational readiness of StructBOQ remains certified at:

> [!IMPORTANT]
> **READINESS VERDICT: LEVEL 2 (Detailed BOQ with Documented Assumptions and Mandatory QS Review)**
>
> In accordance with strict audit instructions, **Level 3 readiness is NOT claimed** in Round 9. 
> Level 3 readiness ("Tender/Procurement Support with Validated Project Benchmarks") requires multi-project holdout evaluation across at least 5–10 diverse commercial and public works projects with 100% verified member-level ground truths.
> The framework built in Round 9 provides the objective infrastructure required to achieve and verify Level 3 in future validation phases.
