# StructBOQ — Round 7: Input Validation & Engineering Assumption Control Report

**Date:** 2026-11-03  
**Auditor / Architect Roles:** Senior Structural Engineer, Quantity Surveying Specialist, TypeScript Architect, Software QA Engineer  
**Status:** COMPLETE — ALL TESTS PASSING (118/118) — ZERO REGRESSION  
**Document:** `tools/STRUCTBOQ_ROUND7_IMPLEMENTATION_REPORT.md`  

---

## 1. EXECUTIVE SUMMARY

In Round 6's independent engineering validation, critical risks were uncovered regarding silent fallbacks, unverified hook shapes, and hardcoded stock lengths. Specifically:
- Invalid or missing reinforcement spacing could silently fall back to `0.15m` or use `Math.max(0.05, spacing)`, producing apparently valid BOQ quantities from corrupted input.
- Footing reinforcement rigidly assumed a full vertical upturn ($h_f - 2c$), which contributed over $31\%$ of footing steel weight without identifying whether the drawing actually detailed upturned bars.
- Slab lap splices were hardcoded to a $6.0\text{ m}$ stock bar limit without configuration options for commercial $10\text{ m}$ or $12\text{ m}$ stock lengths.
- Takeoff quantities lacked component-level traceability separating straight bar length from hook extensions and lap splices.

In Round 7, these defects and gaps have been comprehensively addressed with strict adherence to engineering safety:
1. **Explicit Input & Geometry Validation:** Replaced silent `Math.max(0.05, spacing)` fallbacks with structured validation (`validateSpacedBar`). Explicitly rejects `spacing <= 0`, negative dimensions, non-finite values (`NaN`, `Infinity`), and impossible geometry where concrete cover exceeds half the section dimension ($2c \ge \min(w, d)$). Invalid inputs immediately block rebar calculations with severity `'block'`, preventing misleading BOQ outputs.
2. **Footing Hook Assumption Control:** Introduced configurable `footingHookShape` (`FULL_UPTURN`, `STANDARD_HOOK`, `STRAIGHT`, `UNSPECIFIED`) with backward-compatible legacy defaults that explicitly log informative assumption flags.
3. **Configurable Stock Bar Length:** Added `stockBarLengthM` (`6.0`, `10.0`, `12.0` m) to `MaterialSpecs`, allowing estimators to match actual commercial delivery lengths and eliminating unnecessary lap splices on $7-10\text{ m}$ spans when $10\text{ m}/12\text{ m}$ stock is selected.
4. **Enhanced Quantity Traceability:** Extended `RebarBarDetail` and `RebarSummaryDetails` with explicit breakdowns: `netLengthM`, `hookLengthM`, `lapLengthM`, `netWeightKg`, `hookWeightKg`, `lapWeightKg`, and `wastageWeightKg`.
5. **Verification & Testing:** All **118 automated tests passing** (37 engine tests + 81 PDF/lifecycle tests), `npx tsc --noEmit` exited code 0, and Vite production build completed in 1.61s.

---

## 2. GIT STATUS BEFORE AND AFTER

### 2.1 Git Status Before Round 7
- **Commit Hash:** `682f513f01eb63a51c39fd2aa903acb53fd2d85d`
- **Branch:** `master`
- **Modified files:** 14 files (from previous remediation & audit rounds).
- **Untracked files:** Audit reports and WebGPU benchmarks.

### 2.2 Git Status After Round 7
- **Modified files:**
  - `src/engine/qsEngine.ts`: Core validation, footing hook configuration, stock length configuration, traceability metrics.
  - `src/engine/qsEngine.test.ts`: Added 4 comprehensive test suites (validation, hooks, stock lengths, traceability).
  - `memory/core/CURRENT_CONTEXT.md`, `memory/core/TASKS.md`, `memory/core/DECISIONS.md`: Updated personal memory OS.
- **New files created:**
  - `tools/STRUCTBOQ_ROUND7_IMPLEMENTATION_REPORT.md` (this report).
- **Unmodified files:** `real_drawings/**`, OCR pipelines, WASM/WebGPU runtimes, PDF lifecycles preserved 100% without change.

---

## 3. FILES MODIFIED

| File Path | Component | Changes Implemented |
|:---|:---|:---|
| `src/engine/qsEngine.ts` | Data Models | Added `netLengthM`, `hookLengthM`, `lapLengthM` to `RebarBarDetail`. Added `netWeightKg`, `hookWeightKg`, `lapWeightKg`, `wastageWeightKg` to `RebarSummaryDetails`. Added `footingHookShape` to `ExtractedMember` and `MaterialSpecs`. Added `stockBarLengthM` to `MaterialSpecs`. |
| `src/engine/qsEngine.ts` | Validation Functions | Added `validateSpacedBar()` to explicitly check `@` tokens and reject $\le 0$, NaN, and non-finite numbers. Updated `parseSpacedBar()` to delegate safely to validator. |
| `src/engine/qsEngine.ts` | `computeDetailedRebar()` | Removed silent `Math.max(0.05, st.spacing)` fallback. Implemented footing hook shapes. Implemented configurable stock bar laps. Populated net/hook/lap length tracking. |
| `src/engine/qsEngine.ts` | `calculateMember()` | Replaced raw `<=` with `Number.isFinite()` and positive checks. Added `COVER_EXCEEDS_DIMENSION` geometric check. Connected rebar validation flags to block invalid calculation. |
| `src/engine/qsEngine.test.ts` | Test Suite | Added 4 new test suites: Input Validation, Footing Hook Configuration, Stock Bar Length Configuration, and Quantity Traceability. |

---

## 4. INPUT VALIDATION DESIGN

### 4.1 Strict Spacing Validation (`validateSpacedBar`)
Previously, `parseSpacedBar` used a loose regular expression, and `qsEngine.ts:841` had `Math.max(0.05, st.spacing)`, which silently masked zero or negative spacings by forcing them to 5 cm.

**New Implementation (`qsEngine.ts:580–607`):**
```ts
export interface SpacedBarValidation {
  bar: string;
  spacing: number;
  isValid: boolean;
  error?: string;
}

export function validateSpacedBar(spec?: string): SpacedBarValidation | null {
  if (!spec || !/@/.test(spec)) return null;
  const m = spec.match(/(DB|RB|Ø|ø)?\s*(\d{1,2})\s*(?:มม\.?|mm)?\s*@\s*(-?\d+(?:\.\d+)?|NaN|Infinity)?\s*(cm|mm|m|ม\.)?/i);
  if (!m) return null;
  const diaNum = Number(m[2]);
  const bar = barName(m[1] === 'Ø' || m[1] === 'ø' ? undefined : m[1], isNaN(diaNum) ? 6 : diaNum);
  const rawNumStr = m[3];
  if (rawNumStr === undefined || rawNumStr === '') {
    return { bar, spacing: NaN, isValid: false, error: 'ไม่พบตัวเลขระยะห่างหลังเครื่องหมาย @' };
  }
  const rawNum = parseFloat(rawNumStr);
  if (!Number.isFinite(rawNum) || rawNum <= 0) {
    return { bar, spacing: rawNum, isValid: false, error: `ระยะห่างเหล็กไม่ถูกต้อง (${rawNumStr}) ต้องเป็นตัวเลขบวกที่แน่นอน (> 0)` };
  }
  let spacing = rawNum;
  const u = (m[4] || '').toLowerCase();
  if (u === 'cm' || (spacing > 1.0 && spacing < 100)) spacing /= 100.0;
  else if (u === 'mm' || spacing >= 100) spacing /= 1000.0;
  return { bar, spacing, isValid: true };
}
```
If a spaced bar is provided with invalid spacing (e.g. `'DB12@0'`, `'RB6@-0.15'`, `'RB6@NaN'`):
1. A structured flag `{ code: 'REBAR_SPACING_INVALID', severity: 'block', field: '...', message: ... }` is generated.
2. Calculation is blocked: rebar quantities evaluate to `0 kg`.
3. Formula string is set to `'CALCULATION_BLOCKED: ...'`.
4. The member status is assigned `'NEEDS_REVIEW'`, preventing fraudulent quantities from being aggregated into tender totals.

### 4.2 Section & Cover Boundary Validation
If concrete cover exceeds half the section dimension ($2c \ge \min(w_M, d_M)$), the physical core of the concrete section is negative or zero.
**New Implementation (`qsEngine.ts:1255–1267`):**
```ts
const coverExceedsDim = !isArch && (cover * 2 >= wM || cover * 2 >= dM);
if (coverExceedsDim) {
  const minDim = Math.min(wM, dM);
  flags.push({
    code: 'COVER_EXCEEDS_DIMENSION',
    severity: 'block',
    field: 'cover',
    message: `ระยะหุ้มคอนกรีต 2 ด้าน (${(cover * 2 * 100).toFixed(1)} ซม.) มากกว่าหรือเท่ากับขนาดหน้าตัดองค์อาคาร (${(minDim * 100).toFixed(1)} ซม.) — ไม่สามารถใส่เหล็กเสริมได้`,
  });
}
```

---

## 5. FLOATING-POINT REGRESSION RESULTS

The Round 5 machine epsilon fix (`+ 1e-7`) inside `Math.floor()` was reviewed in Round 6 and preserved intact in Round 7.
- **Exact Integer Ratios:** `1.40 / 0.20` evaluates to 8 bars, `0.60 / 0.20` evaluates to 4 ties, `1.20 / 0.20` evaluates to 7 stirrups.
- **Genuine Non-Integer Ratios:** `1.10 / 0.15` evaluates to 8 bars ($7.333 \rightarrow 8$), `3.96 / 0.15` evaluates to 27 bars ($26.4 \rightarrow 27$).
- **Regression Execution:** All floating-point regression test cases passed with zero errors.

---

## 6. FOOTING HOOK CONFIGURATION

### 6.1 Configuration Options
Added support for 4 discrete reinforcement detailing shapes:
1. `FULL_UPTURN`: Bends bottom mesh vertically upward across full footing thickness ($h = \max(0.10, h_f - 2c)$).
2. `STANDARD_HOOK`: Bends standard 90° hook ($12 d_b$).
3. `STRAIGHT`: Straight bars across footing without end hooks ($h = 0$).
4. `UNSPECIFIED`: Defaults to legacy full upturn for backward compatibility, but logs an informative assumption flag (`FOOTING_HOOK_UNSPECIFIED`).

### 6.2 Quantitative Comparison (Benchmark: $1.20 \times 1.20 \times 0.35\text{ m}$ Footing, DB12@0.15m)

| Detailing Shape | Hook Length per End | Cut Length per Bar | Total Rebar Weight | Relative Weight Delta | Traceability Flag |
|:---|:---:|:---:|:---:|:---:|:---|
| `FULL_UPTURN` | $0.250\text{ m}$ | $1.600\text{ m}$ | **22.73 kg** | Baseline ($100\%$) | `FOOTING_HOOK_ASSUMED` (if default) |
| `STANDARD_HOOK` | $0.144\text{ m}$ ($12 d_b$) | $1.388\text{ m}$ | **19.72 kg** | **-13.2% (-3.01 kg)** | Drawing / Spec explicitly tracked |
| `STRAIGHT` | $0.000\text{ m}$ | $1.100\text{ m}$ | **15.63 kg** | **-31.2% (-7.10 kg)** | Drawing / Spec explicitly tracked |
| `UNSPECIFIED` | $0.250\text{ m}$ | $1.600\text{ m}$ | **22.73 kg** | Baseline ($100\%$) | `FOOTING_HOOK_UNSPECIFIED` |

---

## 7. STOCK LENGTH CONFIGURATION

### 7.1 Parameter Design
Added `stockBarLengthM` to `MaterialSpecs` (default: `6.0\text{ m}`, supports commercial `6`, `10`, `12` m).

### 7.2 Quantitative Comparison (Benchmark: Slab $7.0\text{ m} \times 4.0\text{ m}$, DB10@0.20m, Base Cut $7.20\text{ m}$)

| Stock Setting | Stock Limit | Lap Condition | Laps Added | Final Cut Length | Lap Steel Delta |
|:---|:---:|:---:|:---:|:---:|:---:|
| `stockBarLengthM: 6.0` (Default) | $6.0\text{ m}$ | $7.20\text{ m} > 6.0\text{ m}$ | 1 lap ($40 d_b = 0.40\text{ m}$) | **7.600 m** | $+0.40\text{ m}$ per bar ($+5.5\%$) |
| `stockBarLengthM: 10.0` (Commercial) | $10.0\text{ m}$ | $7.20\text{ m} \le 10.0\text{ m}$ | 0 laps | **7.200 m** | **0.00 m (No lap needed)** |
| `stockBarLengthM: 12.0` (Heavy Civil) | $12.0\text{ m}$ | $7.20\text{ m} \le 12.0\text{ m}$ | 0 laps | **7.200 m** | **0.00 m (No lap needed)** |

---

## 8. QUANTITY TRACEABILITY

Every calculated member now provides an explicit component-level breakdown inside `rebarDetails`:
- `netLengthM`: Length of straight portion inside concrete boundaries ($L_{net}$).
- `hookLengthM`: Sum of all standard hooks or upturned vertical bends ($2h$).
- `lapLengthM`: Length added by commercial stock splices ($n_{laps} \times 40 d_b$).
- `netWeightKg`: Theoretical steel weight of pure structural spans.
- `hookWeightKg`: Steel weight attributed to anchorage/bends.
- `lapWeightKg`: Steel weight attributed to stock bar laps.
- `wastageWeightKg`: Budgeted cutting loss in kg based on user-configured `rebarWastagePct`.

**Mathematical Invariant Verified:**
$$\text{netWeightKg} + \text{hookWeightKg} + \text{lapWeightKg} \equiv \text{totalWeightKg} \pm 0.01\text{ kg}$$

---

## 9. UNIT TEST RESULTS

Command executed:
```powershell
npm test
```
Results:
- **Engine Unit & Integration Tests (`src/engine/qsEngine.test.ts`):** **37/37 passing** (4 new suites added).
- **Pipeline & Lifecycle Tests:** **81/81 passing**.
- **Total Test Suite:** **118/118 passing** (0 failures, 0 skipped).
- **Execution Duration:** ~1.1s total.

---

## 10. TYPESCRIPT CHECK

Command executed:
```powershell
npx tsc --noEmit
```
Results:
- **Exit Code:** `0` (Zero type errors across all modules, strict null checks satisfied).

---

## 11. PRODUCTION BUILD

Command executed:
```powershell
npm run build
```
Results:
- **Exit Code:** `0`.
- **Build Duration:** 1.61s.
- **Client Bundle:** Successfully rendered all chunks without warnings or failures.

---

## 12. REMAINING ENGINEERING RISKS

1. **Top-Story Column Splice ($40 d_b$):** All columns continue to receive $40 d_b$ lap allowance because the drawing parser does not yet build a vertical elevation continuity graph. On top-story columns, this results in an overestimation of approximately $+1.5\%$ steel weight per top-floor column. This is conservative and safe for preliminary BOQ, but should be refined in a future BIM graph milestone.
2. **Continuous Beam Moment-Lap Detailing:** Beam longitudinal bars apply $2 \times 12 d_b$ hooks to every span segment. For continuous multi-span beams, top bars at intermediate supports typically lap or pass through rather than hooking 90°.

---

## 13. READINESS ASSESSMENT

| Application Category | Assessment | Engineering Rationale |
|:---|:---:|:---|
| **Preliminary BOQ / Cost Feasibility** | **APPROVED (PRODUCTION READY)** | Highly reliable budgeting. All assumptions explicit, traceable, and configurable. |
| **Detailed BOQ / Tender Estimation (ปร.4)** | **APPROVED (PILOT READY)** | Full traceability of hooks, laps, and wastage. Estimators can inspect exact weight contributions. |
| **Material Procurement** | **NOT READY** | Commercial order bundling requires 1D bin-packing cut lists into standard 10m/12m bundles. |
| **Fabrication-Ready BBS** | **NOT SUPPORTED** | StructBOQ is a quantity surveying engine, not a CNC rebar bending software. |

---

## 14. RECOMMENDED NEXT ROUND (ROUND 8 ROADMAP)

1. **Elevation Graph Parser:** Implement vertical column linking (e.g., F1 $\rightarrow$ C1 Floor 1 $\rightarrow$ C1 Floor 2 $\rightarrow$ Roof) to automatically transition top-story columns from $40 d_b$ lap splices to $12 d_b$ roof anchorage hooks.
2. **Continuous Beam Chain Association:** Detect multi-span continuous beam chains along grid lines to place continuous top reinforcement across interior supports and reserve $12 d_b$ hooks exclusively for exterior columns.
3. **1D Stock Cutting Optimizer (Procurement Add-on):** Implement a stock bar cutting optimizer (Knapsack / 1D Bin Packing) that maps bar cut lengths into commercial 10m or 12m stock bars to calculate exact physical scrap percentage.
