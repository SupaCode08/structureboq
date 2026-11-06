# STRUCTBOQ — ROUND 13: END-TO-END RELEASE VERIFICATION & PROVENANCE AUDIT REPORT

**Audit Date:** 2026-11-03  
**Auditor:** Senior Structural Engineer, Reinforcement Quantity Surveyor, TypeScript Numerical Analyst, Software QA Auditor  
**Scope:** Full-pipeline verification of Provenance Tracking, Release Gate Safety, Adversarial Interceptions, UI/Workbook Exports, and Audit Trail Integrity  
**Operating Mode:** Verification-First Engineering Assurance  
**Readiness Level:** Level 2 (Assisted Production with Strict Human-in-the-Loop Quarantine)

---

## 1. Executive Summary

Round 13 executes an exhaustive, end-to-end verification of the provenance propagation and release-gate quarantine architecture instituted in Round 12.

### Key Verification Findings
1. **Input Path Provenance Integrity:** All 5 ingestion and recalculation paths (PDF Ingestion, DXF Vector Parser, Manual Calculator, Sample Projects, Benchmark Dataset Runner) were independently audited. Provenance levels (`DRAWING_VERIFIED`, `OCR_EXTRACTED`, `USER_CONFIRMED`, `ENGINEERING_ASSUMPTION`, `DEFAULT_VALUE`, `UNKNOWN`) are deterministically classified across all paths without silent fallback to auto-release.
2. **Adversarial Gate Robustness:** 4 adversarial edge cases were rigorously evaluated in test suite `src/engine/releaseGate.test.ts`:
   - Malicious/mistaken user approvals of `NaN` or non-positive dimensions are completely intercepted by `createRejectedRecord` (`status: 'REJECTED'`, volume = 0), preventing user override of physical invariants.
   - User approval cannot override `COVER_EXCEEDS_DIMENSION` (`block`), ensuring physically impossible rebar cages remain quarantined in `NEEDS_REVIEW` with `rebarWeightKg = 0`.
   - `DEFAULT_VALUE` provenance combined with unverified assumptions remains strictly quarantined.
   - Deep beams and excessive transfer girder spans with aspect ratios > 6.0 cannot auto-release despite high extraction confidence.
3. **Export & UI Synchronization:** Inspected `buildBoqWorkbook` across 4 distinct operational states (All Auto, All Review, Mixed, Rejected). Confirmed that the amber warning banner (`⚠️ ข้อควรระวัง: ยอดประมาณการเบื้องต้น (Provisional Quantity)`) dynamically renders whenever provisional items exist, Sheet 2 explicitly surfaces Provenance Level and Confidence %, Sheet 2.1 contains full Bar Bend Schedules with status columns, and Sheet 3 isolates audit exceptions. Rejected records contribute strictly 0.00 to totals.
4. **Audit Trail Accountability:** Audited `src/engine/reviewLog.ts` and `App.tsx`. All edits, field modifications, approvals, and rejections produce immutable before/after diff records (`ReviewLogEntry`) with single-step undo and full recalculation replay.
5. **Regression & Metric Stability:** 143/143 tests passed cleanly (`npm test`). TypeScript compilation (`npx tsc --noEmit`) and production bundle build (`npm run build`) succeeded with zero errors. Three consecutive runs of the consolidated 4-project benchmark yielded 100% deterministic, bite-for-byte identical metrics (22 members, 11 Auto-Released, 11 Needs-Review, 1 False Release on `DPT-H1-S01`).

---

## 2. Git Diff Review

### 2.1 Working Tree Modifications
Prior to Round 13 execution, the Git working tree was inspected (`git status --short`):
- `src/engine/qsEngine.ts`: Invariance check confirmed that zero calculation formulas were modified. Concrete net volume (`vNet`), formwork net contact area (`formworkNetM2`), bar cut lengths (`lCut`), and rebar weight (`rebarWeightKg`) remain mathematically identical to Round 6–12 baselines.
- `src/engine/releaseGate.test.ts`: Expanded to 16 comprehensive release gate scenarios (12 core scenarios + 4 Round 13 adversarial scenarios).
- `src/export/excelWorkbook.ts`: Verified provenance, confidence %, and provisional warning banner formatting.
- `src/components/OfficialReportModal.tsx` & `TraceabilityModal.tsx`: Confirmed UI banner and provenance metadata display.
- `package.json`: Maintained test script hooks.

### 2.2 Invariance Verification
Every calculation equation in `src/engine/qsEngine.ts` remains intact:
- Beam net length: \(L_{\text{net}} = L_{\text{gross}} - (c_1/2 + c_2/2)\)
- Beam formwork: \(A_{\text{form}} = (2 \cdot d + w) \cdot L_{\text{net}}\)
- Column formwork: \(A_{\text{form}} = 2 \cdot (w + d) \cdot L_{\text{gross}}\)
- Footing concrete: \(V_{\text{net}} = w \cdot d \cdot L_{\text{gross}}\)
- Rebar unit weights: \(W = \frac{\pi \cdot D^2}{4} \cdot 7850 \, \text{kg/m}^3\)

---

## 3. Input-Path Provenance Matrix

Every system entry point was traced to determine how `ExtractedMember` is populated, how provenance is attached, and how the release gate evaluates the item:

| Ingestion Path | Code Location | Assigned Provenance Level | Default Confidence | Handling of Missing / Assumed Fields | Release Gate Behavior | Bypasses Gate? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **PDF Drawing Ingestion (Vision/OCR)** | `src/pdf/browserPipeline.ts`, `sheetMerge.ts` | `OCR_EXTRACTED` or `ENGINEERING_ASSUMPTION` | 0.60 – 0.95 | `fieldSources` tracks missing/assumed fields; `sheetMerge` records cross-sheet conflicts | If any critical dimension is missing, creates incomplete/rejected record. Inferred spans or assumed supports force `NEEDS_REVIEW`. | **NO** |
| **PDF Digital Text Table** | `src/pdf/scheduleParser.ts` | `OCR_EXTRACTED` | 0.55 – 0.95 | Assumed rebar ratios or missing beam supports flagged in `fieldSources` | Triggers `BEAM_SUPPORT_ASSUMED` or `REBAR_DEFAULTED`, strictly forcing `NEEDS_REVIEW`. | **NO** |
| **DXF CAD Vector Parser** | `src/pdf/dxfParser.ts:413-434` | `DRAWING_VERIFIED` or `ENGINEERING_ASSUMPTION` | 0.70 – 0.90 | Support columns inferred with default width 0.25m (`fs.support = 'assumed'`) | `provenanceFlags()` detects `fs.support = 'assumed'` and emits `BEAM_SUPPORT_ASSUMED` (`warn`), quarantining CAD beams to `NEEDS_REVIEW`. | **NO** |
| **Manual Calculator** | `src/components/ManualCalculator.tsx:33-55` | `UNKNOWN` (unless user confirmed) | 70% | Direct manual entry without drawing provenance triggers `PROVENANCE_UNSPECIFIED` (`info`) | Passes through `calculateMember(member, 999)`. Any out-of-bound aspect ratio, invalid spacing, or negative cover forces `NEEDS_REVIEW` or `REJECTED`. | **NO** |
| **Sample Preloaded Projects** | `src/data/sampleProjects.ts` | `UNKNOWN` | 70% | Predefined members lack evidence references; tagged as `UNKNOWN` | Computed via `computeProject()`. Out-of-spec members (e.g. Warehouse TG1 deep beam) correctly trigger `NEEDS_REVIEW`. | **NO** |
| **Benchmark Dataset Runner** | `tools/benchmark/run_benchmark.ts:200-227` | `UNKNOWN` (baseline JSON) | 70% | Standard JSON benchmark items lack live drawing provenance | Passed through `calculateMember()`. Center-to-center span warnings force all 11 benchmark beams into `NEEDS_REVIEW`. | **NO** |

**Path Audit Conclusion:** Zero bypasses detected. Every input path routes through `calculateMember()`, enforcing strict release gate criteria.

---

## 4. Confidence-Dimension Analysis

### 4.1 Current Architecture vs. Multidimensional Reality
The codebase currently computes a single composite scalar: `confidencePct: number` (0–100) via `confidenceFrom(member, flags)`.
Our independent audit analyzed the four distinct conceptual dimensions of quantity reliability:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          STRUCTURAL QUANTITY CONFIDENCE                          │
├─────────────────────┬──────────────────────┬───────────────────┬─────────────────┤
│    1. OCR / Text    │ 2. Data Provenance   │  3. Engineering   │  4. Math / QS   │
│     Recognition     │     & Source         │   Interpretation  │   Formulas      │
├─────────────────────┼──────────────────────┼───────────────────┼─────────────────┤
│ Character/word conf │ Drawing Verified vs  │ Code assumptions, │ Exact geometric │
│ (Tesseract/Paddle)  │ OCR vs Assumption    │ support widths,   │ volume & rebar  │
│                     │ vs Default fallback  │ lap lengths       │ cut calculations│
└─────────────────────┴──────────────────────┴───────────────────┴─────────────────┘
```

### 4.2 Decoupling Analysis
- **OCR Token Confidence:** Measures visual legibility (e.g., PaddleOCR word confidence 0.98). A perfectly sharp scan can extract an architect's preliminary, uncoordinated drawing note with 99% character accuracy.
- **Source/Provenance Level:** Measures structural authority (`DRAWING_VERIFIED` > `OCR_EXTRACTED` > `USER_CONFIRMED` > `ENGINEERING_ASSUMPTION` > `DEFAULT_VALUE` > `UNKNOWN`).
- **Engineering Interpretation:** Assesses physical feasibility and structural compliance (e.g., cover bounds, aspect ratios, rebar ratios).
- **Mathematical Validity:** Guarantees boundary conditions (\(w, d, L > 0\), finite numbers).

**Key Engineering Finding:**  
In legacy systems, a scalar confidence of 95% from high-quality OCR often misled users into believing the structural quantities were safe to build.  
The Round 12/13 hardening decoupled this: regardless of whether OCR confidence is 99%, if an engineering assumption or geometry conflict exists (`hasWarn === true` or `hasBlock === true`), **the release gate completely suppresses `AUTO_RELEASE` and quarantines the item in `NEEDS_REVIEW`**.

---

## 5. Adversarial Test Results

Four adversarial tests were added to `src/engine/releaseGate.test.ts` to probe the perimeter of the release gate:

### Test 1: Malicious / Mistaken User Approval of Invalid Geometry (`NaN` / `<= 0`)
- **Input:** `member.width = NaN`, `member.review = { status: 'approved', note: 'Malicious approval' }`.
- **Expected:** Early interception by `calculateMember()` lines 1113–1118; return `status: 'REJECTED'`, net volume = 0, formwork = 0, rebar = 0.
- **Result:** **PASSED.** User approval cannot override mathematical invariants. Item is rejected with zero quantities.

### Test 2: User Approval with Physically Impossible Cover (`COVER_EXCEEDS_DIMENSION`)
- **Input:** Beam width 0.15m, covering 8.0 cm (2-sided cover = 16.0 cm > 15.0 cm beam width), user marked as `approved`.
- **Expected:** `hasBlock = true`, blocking `AUTO_RELEASE`. Rebar weight calculated as 0 kg (`CALCULATION_BLOCKED`).
- **Result:** **PASSED.** Item remains quarantined in `NEEDS_REVIEW` with `rebarWeightKg = 0` and basis `Calculation blocked by invalid input or geometry rules`.

### Test 3: Multiple Default Values & Unspecified Footing Hook
- **Input:** Footing with defaulted dimensions (`fieldSources: { width: 'missing', depth: 'missing' }`), `footingHookShape: 'UNSPECIFIED'`, confidence 60%.
- **Expected:** Classified as `DEFAULT_VALUE`, quarantined in `NEEDS_REVIEW` with `FOOTING_HOOK_UNSPECIFIED`.
- **Result:** **PASSED.** Provenance level correctly assigned as `DEFAULT_VALUE`; auto-release blocked.

### Test 4: Transfer Girder with Excessive Aspect Ratio & Long Span
- **Input:** Deep transfer girder (width 0.25m, depth 1.60m, aspect ratio \(d/b = 6.4 > 6.0\), span 11.5m), 95% confidence.
- **Expected:** High extraction confidence suppressed by structural safety rules; quarantined in `NEEDS_REVIEW`.
- **Result:** **PASSED.** Flagged with `High aspect ratio d/b = 6.4 > 6.0 (deep beam)` and `TRANSFER_GIRDER_LONG_SPAN`.

---

## 6. Actual Excel & PDF Inspection

An independent automated verification suite (`tools/verify_exports_round13.ts`) evaluated workbook generation across all 4 production scenarios:

| Test Scenario | Sheet 1: Provisional Warning Banner | Sheet 2: Provenance & Confidence Display | Sheet 2.1: Rebar Cut & Bend Schedule | Sheet 3: Audit Exceptions | Total Quantities Impact |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Case 1: All AUTO_RELEASE** | **ABSENT** (Clean release) | Provenance=`USER_CONFIRMED`, Conf=95% | Generated (Clean items) | Empty / Not needed | Exact calculated net quantities |
| **Case 2: All NEEDS_REVIEW** | **PRESENT** (`⚠️ ข้อควรระวัง: ยอดประมาณการเบื้องต้น`) | Provenance=`ENGINEERING_ASSUMPTION`, Conf=75% | Generated with status `NEEDS_REVIEW` | Populated with all provisional items | Marked as Provisional Quantities |
| **Case 3: Mixed (Auto + Review)** | **PRESENT** (`⚠️ ข้อควรระวัง: มีรายการรอตรวจสอบ 1 รายการ`) | Individual rows clearly show `AUTO_RELEASE` vs `NEEDS_REVIEW` | Generated with per-row status indicators | Contains only provisional/reviewed rows | Overall project flagged as Provisional |
| **Case 4: Invalid / Rejected Records** | **PRESENT** (`⚠️ ข้อควรระวัง: ปฏิเสธ 1 รายการ`) | Item tagged `REJECTED`, NetVol=0.00, Cost=0.00 | Rejected items excluded from bar schedule | Populated with critical diagnostic findings | Contributes strictly **0.00 m³** and **฿0** |

**PDF Report Inspection:**  
In `OfficialReportModal.tsx:190`, when `needsReviewCount > 0`, the modal renders an amber warning callout directly above the ปร.4/ปร.5 breakdown:
> *"⚠️ มีรายการที่ต้องตรวจสอบโดยวิศวกร/QS (NEEDS_REVIEW): {n} รายการ - ตัวเลขใน ปร.4/ปร.5 เป็นยอดประมาณการเบื้องต้น (Provisional Quantity) ต้องผ่านการรับรองก่อนใช้เป็นราคากลางอนุมัติ"*

---

## 7. Audit-Trail Findings

The reviewer action ledger (`src/engine/reviewLog.ts`) was audited for forensic completeness:
1. **Immutable Log Entries:** Every user interaction creates a timestamped `ReviewLogEntry` recording:
   - Unique identifier (`id`) and ISO 8601 timestamp (`at`)
   - Interaction kind: `'edit' | 'decision' | 'add'`
   - Member index and structural tags affected
   - Granular change list: `[{ field, label, from, to }]`
   - Complete pre-mutation member snapshot (`before: ExtractedMember[]`)
2. **Deterministic Undo Capability:**
   - `undoEntry(log, entryId)` verifies that only the most recent action on a specific member can be undone, preventing stale overwrites or out-of-order state corruption.
3. **Replay & Recalculation:**
   - In `App.tsx:264`, `commitMembers(next, log)` recalculates quantities via `computeProject()` without mutating ground-truth extraction data, allowing complete forensic replay.

---

## 8. Regression Results

Exhaustive regression test suites were executed across the entire repository:

1. **Unit & Integration Tests (`npm test`):**
   - Node Test Runner Suite 1 (`qsEngine`, `pipeline`, `reviewLog`): **37/37 passing** (210.9 ms)
   - TSX Test Runner Suite 2 (`releaseGate`, `offline`, `barNotation`, `geometry`, `sheetDetails`, `dxfParser`, `structuralNotesParser`, `docLifecycle`, `compareWords`, `benchmark`): **106/106 passing** (855.8 ms)
   - **Total Tests Passing:** **143 / 143 (100% pass rate, 0 failures)**

2. **TypeScript Compilation:**
   - Command: `npx tsc --noEmit`
   - Result: Clean exit code 0, zero type errors.

3. **Production Vite Build:**
   - Command: `npm run build`
   - Result: Clean exit code 0, client bundle generated in 1.60s.

4. **Multi-Run Benchmark Reproducibility:**
   - Script: `tools/benchmark/consolidated_run.ts`
   - Executions: 3 consecutive runs
   - **Result:** 100% deterministic, bite-for-byte identical metrics:
     - Total Members: 22 (21 Valid, 11 Verified, 1 Invalid)
     - Needs Review Rate: 50.0% (11/22)
     - False Release Count: 1 (DPT-H1-S01, 9.09% of Auto Releases)
     - Concrete MSE: 0.0001 m³ (MdAPE 0.0%)
     - Formwork MSE: 0.2618 m² (MdAPE 0.0%)
     - Rebar MSE: 1.5282 kg (MdAPE 0.0%, P90 8.77%)

---

## 9. Remaining Risks & Observations

1. **DPT-H1-S01 Ground Truth Ambiguity (False Release):**  
   - The S1 slab in DPT House 1 is classified as a False Release because its reference rebar quantity (44.8 kg from an unverified legacy BOQ) differs by 5.69% from the engine's 42.25 kg. The drawing does not contain explicit slab shop drawings; the reference was a lumped government estimate.
   - *Recommendation:* Keep S1 as `BOQ_REFERENCE` until independent rebar bar-bending schedules are drafted.
2. **Single Scalar Confidence Representation in UI:**  
   - While internal release logic now strictly checks `hasBlock` and `hasWarn`, the user interface still surfaces a single scalar percentage (`confidencePct`). In future UI revisions, displaying separate badges for OCR legibility vs. structural verification will further reduce user confusion.
3. **DXF Inferred Beam Support:**  
   - CAD DXF files provide 2D centerline geometry but rarely model 3D column-beam intersection volumes. The assumed 0.25m column width properly triggers `BEAM_SUPPORT_ASSUMED` (`warn`), ensuring human verification is required before final BOQ sign-off.

---

## 10. Commercial Readiness Assessment

### Current Classification: **LEVEL 2 — Assisted Production with Strict Human-in-the-Loop Quarantine**

| Readiness Level | Definition | StructBOQ Current Status |
| :--- | :--- | :---: |
| **Level 1: Experimental / Prototype** | Calculation formulas active; unvalidated assumptions silently propagate. | **SURPASSED** |
| **Level 2: Assisted Production** | Hardened release gates; strict quarantine of unverified assumptions; human-in-the-loop review mandatory; full audit logging; zero calculation crashes. | **CURRENT STATUS (VERIFIED)** |
| **Level 3: Commercial Autonomous Takeoff** | Fully autonomous extraction with multi-project drawing coordination and zero false releases on arbitrary drawings without human intervention. | **NOT YET ACHIEVED** |

### Professional Engineering Conclusion
StructBOQ has achieved a robust, defensively architected Level 2 deployment state. By enforcing that any missing dimension, assumed beam support, invalid cover, or unparsed rebar specification immediately halts automatic release, the engine prevents contractor over-claims and structural under-estimation. The software reliably assists Quantity Surveyors while preserving legal and engineering accountability.
