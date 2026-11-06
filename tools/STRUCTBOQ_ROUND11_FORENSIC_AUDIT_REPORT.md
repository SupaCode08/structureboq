# STRUCTBOQ ROUND 11 — FALSE RELEASE AUDIT & BENCHMARK INTEGRITY REPORT

**Date:** 2026-11-03  
**Mode:** STRICT FORENSIC AUDIT (`PRODUCTION ENGINE: READ-ONLY`)  
**Engine Target:** `src/engine/qsEngine.ts` (Unmodified — Verified by Git Diff)  
**Benchmark Scope:** 4 Real Thai Government Projects (`dpt-house-ready-1`, `dpt-house-ready-2`, `dot32-pavilion`, `cdc-1`), 22 Member Groups (136 Physical Instances)

---

## 1. Executive Summary

This Round 11 Forensic Audit independently investigated whether the benchmark accuracy metrics and automatic release (`AUTO_RELEASE`) decisions reported in Rounds 9 and 10 are engineering-trustworthy.

### Key Forensic Conclusions
1. **Production Engine Preserved (`READ-ONLY`):** `src/engine/qsEngine.ts` was not modified during Round 11 (`git diff src/engine/qsEngine.ts` remains at the exact pre-Round-11 baseline: `447 insertions, 48 deletions`). No formulas, thresholds (`FALSE_RELEASE_TOLERANCE_PCT = 5.0%`, `AUTO_RELEASE_CONFIDENCE_PCT = 80%`), or material assumptions were tuned.
2. **Ground Truth Independence & Circularity Exposure:** Cross-auditing `tools/benchmark/datasets/real_*.json` against the raw visual sheet readings in `real_drawings/*/answer_key.json` and `boq.json` revealed that **11 of the 22 member groups** in Rounds 9–10 had been over-classified as `VERIFIED`:
   - `answer_key.json` contains only member tags, cross-section dimensions (`width`, `depth`, footing `thickness`), instance counts (for a subset of members), and reinforcement callout strings—it does **not** record beam spans, column heights, or per-member reference quantities.
   - `boq.json` contains only building-level aggregate totals from ปร.4, with no per-member breakdown.
   - Consequently, 9 member groups relied on assumed uniform spans (`2.70 m` or `4.00 m`) or assumed column heights (`1.50 m`, `2.85 m`, `3.80 m`) and computed reference rebar weights using formula parity with `qsEngine.ts`. These 9 records have been forensically reclassified from `VERIFIED` to `ESTIMATED`.
   - 1 member group (`DPT-H1-S01`) used a manual/BOQ gross-span bar count and hook/wastage allowance (`44.80 kg` vs net-span `42.25 kg`) and is reclassified as `BOQ_REFERENCE`.
   - 1 member group (`CDC1-GB03`) in the holdout dataset was found to have **truncated reinforcement callouts**: `real_drawings/cdc_1/answer_key.json` specifies `topRebar: "3-RB12+2-DB16"` and `bottomRebar: "2-DB16+3-RB12"`, whereas `real_cdc1_benchmark.json` dropped `+2-DB16` (`"3-RB12"` top/bottom) and computed `222.66 kg` from the truncated string (true multi-bar weight is `432.69 kg`). `CDC1-GB03` is reclassified as `INVALID`.
   - **11 member groups** (`DPT-H1-F01`, `DPT-H1-B01`, `DPT-H1-B02`, `DPT-H2-F01`, `DPT-H2-F02`, `DPT-H2-F03`, `DOT32-F01`, `DOT32-GB01`, `DOT32-GB02`, `CDC1-F01`, `CDC1-F02`) have drawing-verified geometry and counts and remain `VERIFIED` (noting that footing rebar still depends on the `FULL_UPTURN` hook assumption passed in the dataset).
3. **False Release Forensic Root Cause (`DPT-H1-S01` & Systemic `AUTO_RELEASE` Audit):**
   - `DPT-H1-S01` (`S1` slab) triggered a **False Release** (`AUTO_RELEASE` with `5.69%` rebar error: `42.25 kg` vs `44.80 kg`) because:
     1. `run_benchmark.ts` constructs `ExtractedMember` without `provenance`, causing `confidenceFrom()` (`src/engine/qsEngine.ts:1034-1038`) to start at `95%` (`> 80%`).
     2. `coverCm: 2.0` was explicitly supplied in the dataset (`coverRes.assumed = false`), and the steel ratio (`43.47 kg/m³`) fell inside the slab band `[25, 160] kg/m³`.
     3. Unlike `BEAM` (which emits an `ENGINEERING` `warn` flag whenever `supportColW1`/`supportColW2` are omitted, forcing 100% of beams into `NEEDS_REVIEW`), `SLAB`, `COLUMN`, and `FOOTING` (when `footingHookShape` is supplied) emit **zero `warn`/`block` flags** for unverified support widths, splice applicability, or bent-up bar (`เหล็กคอม้า`) detailing.
4. **Benchmark Metric & Taxonomy Remediations (`tools/benchmark/*`):**
   - Fixed `aggregateEvaluationResults()` in `tools/benchmark/metrics.ts` so `INVALID` records are tracked (`invalidMembers: 1`) and never silently discarded, while excluded from accuracy summaries; added `verifiedOnlyByComponent` to isolate `VERIFIED`-only metrics (`n = 11`) from `ESTIMATED`/`BOQ_REFERENCE` records.
   - Added `zeroDivCount` to `MetricSummary` (`tools/benchmark/metrics.ts`) and `Number.isFinite` validation checks for reference quantities and `count` (`tools/benchmark/run_benchmark.ts`).
   - Added `MEASUREMENT_CONVENTION_MISMATCH` to `BenchmarkErrorType` (`tools/benchmark/error_analysis.ts`) to properly classify formwork convention differences (such as `DPT-H1-B02`'s 25.00% slab-intersection deduction difference) where concrete volume matches exactly (`0.00%` error).
5. **Engineering Readiness:** **Level 2 (Controlled Engineering Validation — Provisional)** is maintained. Level 3 readiness is **not** claimed.

---

## 2. Audit of All 22 Benchmark Members

The table below presents the complete forensic record for all 22 benchmark member groups across all 4 projects (`136` physical structural instances total).

| Project ID | Member ID | Tag | Type | Inst. (`n`) | Ref Status (Round 11) | Reference Source & Method | Engine Status | Calc Conc / Form / Rebar | Ref Conc / Form / Rebar | Abs Error (C / F / R) | Rel Error % (C / F / R) | Warning Flags (`severity`) | False Release |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| `dpt-house-ready-1` | `DPT-H1-F01` | `F0.95X0.95` | `FOOTING` | 2 | `VERIFIED` | Sheet S-06 detail (`0.95x0.95x0.20`, `5+5-DB12`, `FULL_UPTURN`) | `AUTO_RELEASE` | `0.361 m³` / `1.52 m²` / `18.65 kg` | `0.361 m³` / `1.52 m²` / `18.65 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `NONE` | `false` |
| `dpt-house-ready-1` | `DPT-H1-C01` | `C1` | `COLUMN` | 6 | `ESTIMATED` | Sheet S-03 (`0.20x0.20`, `4-DB12`, `RB6@0.20m`; `n=6, H=2.85m` assumed) | `AUTO_RELEASE` | `0.684 m³` / `13.68 m²` / `84.16 kg` | `0.684 m³` / `13.68 m²` / `82.38 kg` | `0` / `0` / `1.78` | `0.00%` / `0.00%` / `2.16%` | `NONE` | `false` |
| `dpt-house-ready-1` | `DPT-H1-B01` | `B1` | `BEAM` | 1 | `VERIFIED` | Sheet S-07 detail B1 (`0.20x0.30x3.60`, `2-DB12` top, `3-DB12` bot, `RB6@0.15m`) | `NEEDS_REVIEW` | `0.216 m³` / `2.88 m²` / `22.04 kg` | `0.216 m³` / `2.88 m²` / `24.16 kg` | `0` / `0` / `2.12` | `0.00%` / `0.00%` / `8.77%` | `ENGINEERING(warn)` | `false` |
| `dpt-house-ready-1` | `DPT-H1-B02` | `B2` | `BEAM` | 4 | `VERIFIED` | Sheet S-07 detail B2 (`0.20x0.40x3.60`, `2-DB20` T/B, `RB9@0.20m`; formwork deducts slab) | `NEEDS_REVIEW` | `1.152 m³` / `14.40 m²` / `201.18 kg` | `1.152 m³` / `11.52 m²` / `182.24 kg` | `0` / `2.88` / `18.94` | `0.00%` / `25.00%` / `10.39%` | `ENGINEERING(warn)` | `false` |
| `dpt-house-ready-1` | `DPT-H1-S01` | `S1` | `SLAB` | 1 | `BOQ_REFERENCE` | Sheet S-07 slab S1 (`3.60x2.70x0.10`, `RB9@0.25m`; gross-span + hook allowance) | `AUTO_RELEASE` | `0.972 m³` / `10.98 m²` / `42.25 kg` | `0.972 m³` / `10.98 m²` / `44.80 kg` | `0` / `0` / `2.55` | `0.00%` / `0.00%` / `5.69%` | `NONE` | **`true`** |
| `dpt-house-ready-2` | `DPT-H2-F01` | `F1.05X1.05` | `FOOTING` | 2 | `VERIFIED` | Sheet S-35 detail (`1.05x1.05x0.25`, `5+5-DB12`, `FULL_UPTURN`) | `AUTO_RELEASE` | `0.5513 m³` / `2.10 m²` / `22.20 kg` | `0.551 m³` / `2.10 m²` / `22.20 kg` | `0.0003` / `0` / `0` | `0.05%` / `0.00%` / `0.00%` | `NONE` | `false` |
| `dpt-house-ready-2` | `DPT-H2-F02` | `F0.95X0.95` | `FOOTING` | 2 | `VERIFIED` | Sheet S-35 detail (`0.95x0.95x0.20`, `5+5-DB12`, `FULL_UPTURN`) | `AUTO_RELEASE` | `0.361 m³` / `1.52 m²` / `18.65 kg` | `0.361 m³` / `1.52 m²` / `18.65 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `NONE` | `false` |
| `dpt-house-ready-2` | `DPT-H2-F03` | `F1.45X0.95` | `FOOTING` | 1 | `VERIFIED` | Sheet S-35 combined footing (`1.45x0.95x0.25`, `7+8-DB12`, `FULL_UPTURN`) | `AUTO_RELEASE` | `0.3444 m³` / `1.20 m²` / `18.43 kg` | `0.344 m³` / `1.20 m²` / `18.43 kg` | `0.0004` / `0` / `0` | `0.12%` / `0.00%` / `0.00%` | `NONE` | `false` |
| `dpt-house-ready-2` | `DPT-H2-B01` | `B1` | `BEAM` | 2 | `ESTIMATED` | Sheet S-38 (`0.20x0.35`, `2-DB12` T/B, `RB6@0.175m`; uniform `2.70m` span assumed) | `NEEDS_REVIEW` | `0.378 m³` / `4.86 m²` / `28.05 kg` | `0.378 m³` / `4.86 m²` / `28.05 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `ENGINEERING(warn)` | `false` |
| `dpt-house-ready-2` | `DPT-H2-B02` | `B2` | `BEAM` | 14 | `ESTIMATED` | Sheet S-39 (`0.20x0.35`, `2-DB12` top, `3-DB12` bot; uniform `2.70m` span assumed) | `NEEDS_REVIEW` | `2.646 m³` / `34.02 m²` / `233.47 kg` | `2.646 m³` / `34.02 m²` / `224.28 kg` | `0` / `0` / `9.19` | `0.00%` / `0.00%` / `4.10%` | `ENGINEERING(warn)` | `false` |
| `dpt-house-ready-2` | `DPT-H2-B03` | `B3` | `BEAM` | 4 | `ESTIMATED` | Sheet S-39 (`0.20x0.35`, `2-DB16` T/B, `RB6@0.175m`; uniform `2.70m` span assumed) | `NEEDS_REVIEW` | `0.756 m³` / `9.72 m²` / `91.50 kg` | `0.756 m³` / `9.72 m²` / `82.52 kg` | `0` / `0` / `8.98` | `0.00%` / `0.00%` / `10.88%` | `ENGINEERING(warn)` | `false` |
| `dot32-pavilion` | `DOT32-F01` | `F` | `FOOTING` | 6 | `VERIFIED` | Sheet ST-06 detail (`1.20x1.20x0.25`, `7+7-DB12`, `FULL_UPTURN`) | `AUTO_RELEASE` | `2.160 m³` / `7.20 m²` / `104.43 kg` | `2.160 m³` / `7.20 m²` / `104.43 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `NONE` | `false` |
| `dot32-pavilion` | `DOT32-C01` | `C` | `COLUMN` | 6 | `ESTIMATED` | Sheet ST-05 (`0.25x0.25`, `4-DB12`, `RB6@0.15m`; `H=1.50m` assumed) | `AUTO_RELEASE` | `0.5625 m³` / `9.00 m²` / `54.80 kg` | `0.563 m³` / `9.00 m²` / `53.66 kg` | `0.0005` / `0` / `1.14` | `0.09%` / `0.00%` / `2.12%` | `NONE` | `false` |
| `dot32-pavilion` | `DOT32-GB01` | `GB1` | `BEAM` | 4 | `VERIFIED` | Sheet ST-05 (`0.20x0.35x2.50`, `2-DB12` T/B, `RB6@0.15m`) | `NEEDS_REVIEW` | `0.700 m³` / `9.00 m²` / `54.10 kg` | `0.700 m³` / `9.00 m²` / `54.10 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `ENGINEERING(warn)` | `false` |
| `dot32-pavilion` | `DOT32-GB02` | `GB1'` | `BEAM` | 2 | `VERIFIED` | Sheet ST-05 (`0.20x0.35x2.00`, `3-DB12` top, `2-DB12` bot, `RB6@0.15m`) | `NEEDS_REVIEW` | `0.280 m³` / `3.60 m²` / `26.28 kg` | `0.280 m³` / `3.60 m²` / `26.29 kg` | `0` / `0` / `0.01` | `0.00%` / `0.00%` / `0.04%` | `ENGINEERING(warn)` | `false` |
| `cdc-1` | `CDC1-F01` | `F1` | `FOOTING` | 13 | `VERIFIED` | Page 22 detail (`1.20x1.20x0.25`, `RB12@0.15m`, `FULL_UPTURN`) | `AUTO_RELEASE` | `4.680 m³` / `15.60 m²` / `258.59 kg` | `4.680 m³` / `15.60 m²` / `258.59 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `NONE` | `false` |
| `cdc-1` | `CDC1-F02` | `F2` | `FOOTING` | 9 | `VERIFIED` | Page 22 detail (`1.00x1.00x0.25`, `RB12@0.15m`, `FULL_UPTURN`) | `AUTO_RELEASE` | `2.250 m³` / `9.00 m²` / `134.27 kg` | `2.250 m³` / `9.00 m²` / `134.27 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `NONE` | `false` |
| `cdc-1` | `CDC1-C01` | `C1` | `COLUMN` | 22 | `ESTIMATED` | Page 22 (`0.20x0.20`, `4-RB12`, `RB6@0.20m`; `n=22, H=3.80m` assumed) | `AUTO_RELEASE` | `3.344 m³` / `66.88 m²` / `398.93 kg` | `3.344 m³` / `66.88 m²` / `398.93 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `NONE` | `false` |
| `cdc-1` | `CDC1-GB01` | `GB1` | `BEAM` | 16 | `ESTIMATED` | Page 22 (`0.15x0.40`, `2-RB12` T/B, `RB6@0.20m`; uniform `4.00m` span assumed) | `NEEDS_REVIEW` | `3.840 m³` / `60.80 m²` / `315.30 kg` | `3.840 m³` / `60.80 m²` / `315.31 kg` | `0` / `0` / `0.01` | `0.00%` / `0.00%` / `0.00%` | `ENGINEERING(warn)` | `false` |
| `cdc-1` | `CDC1-GB02` | `GB2` | `BEAM` | 9 | `ESTIMATED` | Page 22 (`0.15x0.40`, `3-RB12` T/B, `RB6@0.20m`; uniform `4.00m` span assumed) | `NEEDS_REVIEW` | `2.160 m³` / `34.20 m²` / `245.90 kg` | `2.160 m³` / `34.20 m²` / `245.90 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `ENGINEERING(warn)` | `false` |
| `cdc-1` | `CDC1-GB03` | `GB3` | `BEAM` | 4 | **`INVALID`** | Page 22 (`0.15x0.40x8.00`; **truncated `+2-DB16` top/bot bars from S-02 callout**) | `NEEDS_REVIEW` | `1.920 m³` / `30.40 m²` / `222.67 kg` | `1.920 m³` / `30.40 m²` / `222.66 kg` | `0` / `0` / `0.01` | `0.00%` / `0.00%` / `0.00%` | `ENGINEERING(warn)` | `false` |
| `cdc-1` | `CDC1-RB01` | `RB1` | `BEAM` | 16 | `ESTIMATED` | Page 22 (`0.15x0.35`, `2-RB12` T/B, `RB6@0.20m`; uniform `4.00m` span assumed) | `NEEDS_REVIEW` | `3.360 m³` / `54.40 m²` / `307.85 kg` | `3.360 m³` / `54.40 m²` / `307.85 kg` | `0` / `0` / `0` | `0.00%` / `0.00%` / `0.00%` | `ENGINEERING(warn)` | `false` |

### Summary of Reference Status Distribution
- **`VERIFIED`:** 11 member groups (`45` physical instances)
- **`ESTIMATED`:** 9 member groups (`85` physical instances)
- **`BOQ_REFERENCE`:** 1 member group (`1` physical instance — `DPT-H1-S01`)
- **`INVALID`:** 1 member group (`4` physical instances — `CDC1-GB03`)

---

## 3. False Release Forensic Investigation

### 3.1 Investigation of `DPT-H1-S01` (`S1` Slab False Release)
- **Observed Outcome:** `DPT-H1-S01` (`S1` cast-in-place slab, `width = 3.60 m`, `depth = 2.70 m`, `length/thickness = 0.10 m`, `bottomRebar = "RB9@0.25m"`, `coverCm = 2.0`) returned `status = 'AUTO_RELEASE'` with `rebarWeightKg = 42.25 kg` vs. reference `44.80 kg` (`absError = 2.55 kg`, `relErrorPct = 5.69% > 5.0%`), triggering `isFalseRelease = true`.
- **1. Why `AUTO_RELEASE` Was Returned (`src/engine/qsEngine.ts:1034-1038, 1388-1392`):**
  - In `calculateMember()`, `status` is set to `'AUTO_RELEASE'` whenever `needsHuman` is `false`:
    ```ts
    const confidencePct = confidenceFrom(member, flags);
    const needsHuman = flags.some(f => f.severity !== 'info') || confidencePct < AUTO_RELEASE_CONFIDENCE_PCT;
    ```
  - `confidenceFrom(member, flags)` starts at `(member.provenance?.confidence ?? 0.95) * 100 = 95%` when `member.provenance` is undefined (as constructed by `run_benchmark.ts`).
  - Because `coverCm = 2.0` was explicitly passed in the benchmark entry, `resolveMemberCoverM()` returned `assumed = false` (no `COVER_ASSUMED` flag).
  - In `computeDetailedRebar()` (`src/engine/qsEngine.ts:797-827`), `RB9@0.25m` parsed cleanly with no warning flags.
  - The steel-to-concrete ratio check (`src/engine/qsEngine.ts:1280-1297`) computed `42.25 / 0.972 = 43.47 kg/m³`, which is inside the `SLAB` band `[25, 160] kg/m³`.
  - With zero flags emitted (`flags = []`), `confidencePct = 95 >= 80` and `needsHuman = false`, causing `calculateMember()` to return `AUTO_RELEASE`.
- **2. Exact Mathematical Origin of the `2.55 kg` (`5.69%`) Discrepancy (`src/engine/qsEngine.ts:797-827`):**
  - **Engine Calculation (`42.25 kg`):**
    - `cover = 0.02 m`, `dia = 9 mm`, `hook = Math.max(0.10, Math.min(0.25, 12 * 0.009)) = 0.108 m`.
    - Direction X (spanning `wM = 3.60 m`, distributed over `dM - 2*cover = 2.66 m`):
      $$n_x = \lfloor 2.66 / 0.25 + 10^{-7} \rfloor + 1 = \lfloor 10.64 \rfloor + 1 = 11\text{ bars}$$
      $$\text{cutLen}_x = (3.60 - 0.04) + 2(0.108) = 3.776\text{ m} \implies L_x = 11 \times 3.776 = 41.536\text{ m}$$
    - Direction Y (spanning `dM = 2.70 m`, distributed over `wM - 2*cover = 3.56 m`):
      $$n_y = \lfloor 3.56 / 0.25 + 10^{-7} \rfloor + 1 = \lfloor 14.24 \rfloor + 1 = 15\text{ bars}$$
      $$\text{cutLen}_y = (2.70 - 0.04) + 2(0.108) = 2.876\text{ m} \implies L_y = 15 \times 2.876 = 43.140\text{ m}$$
    - Total length $= 41.536 + 43.140 = 84.676\text{ m}$. Using `REBAR_KG_PER_M['RB9'] = 0.499 kg/m`:
      $$W_{\text{engine}} = 84.676 \times 0.499 = \mathbf{42.25\text{ kg}}$$
  - **Reference Calculation (`44.80 kg`):**
    - Computed using gross bay dimensions (`3.60 m` and `2.70 m`) plus standard Thai QS anchorage/bent-up (`เหล็กคอม้า`) allowance (`~89.78 m × 0.499 kg/m = 44.80 kg`, a `+6.0%` detailing difference).
- **3. Did the Warning System Have Enough Information to Detect It?**
  - **Yes:** The engine received `width = 3.60 m`, `depth = 2.70 m` (center-to-center grid dimensions without supporting beam widths), a single `bottomRebar` string (`RB9@0.25m`) with no `topRebar` / bent-up bar specification, and no `provenance` object.
  - While `BEAM` explicitly pushes `reviews.push('Center-to-center span detected without exact column support widths; verify net clear span')` (`src/engine/qsEngine.ts:1153`), **`SLAB` has no equivalent warning** for center-to-center bay dimensions or unspecified slab edge anchorage / bent-up bars (`เหล็กคอม้า`).

### 3.2 Audit of All `AUTO_RELEASE` Conditions & Other 21 Members
Reviewing all `AUTO_RELEASE` paths in `src/engine/qsEngine.ts` across the 22 benchmark members revealed three systemic gaps:
1. **Asymmetric Member-Type Warning Gates (`src/engine/qsEngine.ts:1137-1158`):**
   - **All 11 Beams (`100%`)** entered `NEEDS_REVIEW` solely because `supportColW1` and `supportColW2` were omitted in the benchmark datasets, triggering the center-to-center span warning. Even beams with `8.77%` (`DPT-H1-B01`), `10.39%` (`DPT-H1-B02`), and `10.88%` (`DPT-H2-B03`) rebar error were shielded from being counted as False Releases only because this geometry warning was active!
   - Conversely, **all 7 Footings (`100%`), all 3 Columns (`100%`), and the 1 Slab (`100%`)** returned `AUTO_RELEASE`.
2. **Dataset-Injected Assumptions Suppressing Engine Warnings (`src/engine/qsEngine.ts:737-763, 1240-1246`):**
   - In all 7 footing entries (`DPT-H1-F01`, `DPT-H2-F01..F03`, `DOT32-F01`, `CDC1-F01..F02`), the benchmark dataset passed `"footingHookShape": "FULL_UPTURN"` and `"coverCm": 5.0`.
   - In `qsEngine.ts:760`, `FOOTING_HOOK_ASSUMED` (`severity: 'info'`) is emitted only `if (!member.footingHookShape)`, and `FOOTING_HOOK_UNSPECIFIED` (`severity: 'warn'`) is emitted only if `hookShape === 'UNSPECIFIED'`. Passing `"FULL_UPTURN"` in the dataset bypassed the provisional hook warning and forced `AUTO_RELEASE`.
3. **Unflagged Column Splice & Tie Hook Assumptions (`src/engine/qsEngine.ts:828-868`):**
   - Column main bars unconditionally add a `40d` lap splice (`lapLen = 40 * diaM`) and `+0.10 m` tie hook (`2 * ((wM - 2*cover) + (dM - 2*cover)) + 0.10`) without emitting a `warn` flag when story position (top story vs intermediate story) or seismic 135° tie hook requirements (`12d_b`) are unspecified. In `DPT-H1-C01` and `DOT32-C01`, this produced a `2.16%` and `2.12%` tie hook difference while still returning `AUTO_RELEASE`.

---

## 4. Benchmark Metric Implementation Audit

Inspection of `tools/benchmark/metrics.ts` and `tools/benchmark/run_benchmark.ts` identified three implementation defects, all of which were remediated and unit-tested in Round 11:

| Audit Check | Pre-Round 11 Behavior | Defect Found? | Round 11 Remediation |
| :--- | :--- | :---: | :--- |
| **1. `VERIFIED` vs Non-`VERIFIED` / `INVALID` Aggregation** | `aggregateEvaluationResults()` counted `evaluatedMembers` and `verifiedMembers`, but computed `byComponent` and `byMemberType` over **all** `evaluations` (including `INVALID` and `ESTIMATED` records). | **YES (Major)** | Excluded `INVALID` records from `byComponent` and `byMemberType`, added `invalidMembers` counter (no silent discard), and added `verifiedOnlyByComponent` to isolate `VERIFIED`-only metrics (`n=11`). |
| **2. Zero-Reference Division (`ref=0, out>0`)** | `compareComponent()` set `relErrorPct = null, isZeroDiv = true`, and `summarizeComponentComparisons()` filtered out `null` without reporting how many zero-divisions occurred. | **YES (Minor)** | Added `zeroDivCount: number` to `MetricSummary` so zero-reference non-zero outputs are explicitly counted in every summary table. |
| **3. Non-Finite Reference & Count Validation** | `validateBenchmarkDataset()` checked `typeof x !== 'number' || x < 0`, which allowed `NaN` and `Infinity` (`typeof NaN === 'number'`), and did not validate `dimensions.count`. | **YES (Major)** | Enforced `!Number.isFinite(...)` on `concreteVolumeM3`, `formworkAreaM2`, `rebarWeightKg`, and positive integer check on `dimensions.count`. |
| **4. MdAPE, P90 Quantile, Max APE, MSE** | Member-level non-canceling `absError` and `relErrorPct` with linear interpolation quantile (`pos = (N - 1) * q`). | **No (Verified)** | Mathematical implementation verified across edge cases (`N=0`, `N=1`, `N=10`). |
| **5. False Release on `INVALID` Ground Truth** | `isFalseRelease` did not check `entry.groundTruthStatus !== 'INVALID'`. | **YES (Minor)** | Guarded `isFalseRelease` with `entry.groundTruthStatus !== 'INVALID'`. |

---

## 5. Dataset Integrity & Effective Sample Size Audit

A forensic comparison of the 4 benchmark datasets against `real_drawings/*/answer_key.json` and `boq.json` established the true effective sample size:

| Project | Dataset Split | Physical Instances (`∑ count`) | Member Groups (`benchmarkEntries`) | Unique Cross-Section Geometries (`w × d × L`) | Unique Rebar Detail Callouts | `VERIFIED` Groups | `ESTIMATED` / `BOQ` / `INVALID` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. DPT House 1** (`dpt-house-ready-1`) | `dev` | 14 | 5 | 5 | 5 | 3 (`F01, B01, B02`) | 1 `ESTIMATED` (`C01`), 1 `BOQ_REFERENCE` (`S01`) |
| **2. DPT House 2** (`dpt-house-ready-2`) | `dev` | 25 | 6 | 4 (`B1/B2/B3` share `0.20x0.35x2.70`) | 5 (`F01/F02` share `5+5-DB12`) | 3 (`F01, F02, F03`) | 3 `ESTIMATED` (`B01, B02, B03`) |
| **3. DOT.32 Pavilion** (`dot32-pavilion`) | `dev` | 18 | 4 | 4 | 4 | 3 (`F01, GB01, GB02`) | 1 `ESTIMATED` (`C01`) |
| **4. CDC.1 Center** (`cdc-1`) | `heldout` | 89 | 7 | 6 (`GB1/GB2` share `0.15x0.40x4.00`) | 4 (`F1/F2` share `RB12@0.15m`; `GB1/RB1` share `2-RB12`; `GB2/GB3` share `3-RB12`) | 2 (`F01, F02`) | 4 `ESTIMATED` (`C01, GB01, GB02, RB01`), 1 `INVALID` (`GB03`) |
| **Total Across 4 Projects** | — | **146** | **22** | **18 Unique Geometries** | **16 Unique Rebar Specs** | **11 (`50.0%`)** | **11 (`50.0%`)** |

### Critical Dataset Integrity Findings
1. **Repeated Physical Instances Are Not Independent Design Cases:** While the 4 projects contain `146` physical member instances (`14 + 25 + 18 + 89`), they represent **22 member groups**, **18 unique geometric dimensions**, and **16 unique reinforcement strings**.
2. **Formula Parity in Reference Rebar Quantities:** In Round 9 and Round 10, the per-member reference rebar weights for all 7 footings (`FULL_UPTURN`), `CDC1-C01`, `DPT-H2-B01`, `DOT32-GB01/GB02`, and `CDC1-GB01/GB02/RB01` were computed using the exact analytical equations implemented in `src/engine/qsEngine.ts` (`L + 2×12d_b` beam hooks, `⌊L/s⌋ + 1` stirrups, `L + 40d_b` column splice). Therefore, `0.00%` relative error on those members proves **formula self-consistency (verification)**, not independent field/BOQ ground-truth accuracy (**validation**).
3. **`CDC1-GB03` Multi-Bar Callout Truncation (`INVALID`):** On sheet S-02 of `cdc_1` (`real_drawings/cdc_1/answer_key.json`), beam `GB3` has compound reinforcement `"topRebar": "3-RB12+2-DB16"` and `"bottomRebar": "2-DB16+3-RB12"`. In `real_cdc1_benchmark.json`, the `+2-DB16` bars were omitted (`"3-RB12"` top and bottom), reducing the reference rebar weight from `432.69 kg` to `222.66 kg`.

---

## 6. Holdout Leakage Audit (`CDC.1`)

We audited `src/engine/qsEngine.ts`, git history, and `tools/benchmark/` to determine whether `CDC.1` (`real_cdc1_benchmark.json`) suffered from holdout leakage:
1. **Was `CDC.1` used to tune production formulas or defaults?**
   - **No.** `src/engine/qsEngine.ts` was last modified in Round 8 (prior to the creation of `real_cdc1_benchmark.json` in Round 10). No production code or default constants were tuned to `CDC.1`.
2. **Do holdout reference quantities enter production calculation?**
   - **No.** `executeBenchmark()` (`tools/benchmark/run_benchmark.ts:200-224`) constructs `ExtractedMember` without `referenceQuantity`.
3. **Are test fixtures generated from holdout results used as production input?**
   - **No.**
4. **Reverse-Leakage / Circularity Risk Identified:**
   - While production code was **not** tuned to `CDC.1`, the **reverse leakage** occurred when constructing `real_cdc1_benchmark.json` in Round 10: the dataset author computed `referenceQuantity.rebarWeightKg` using `qsEngine.ts`'s exact equations and simplified `CDC1-GB03`'s `3-RB12+2-DB16` callout to `3-RB12`. Thus, the holdout set tested engine-to-engine formula parity rather than independent external ground truth.

---

## 7. Measurement Convention Taxonomy Analysis (`DPT-H1-B02`)

- **Case:** `DPT-H1-B02` (`B2` ground-floor beams, `4` spans of `0.20 × 0.40 × 3.60 m`).
- **Discrepancy:** Concrete volume matches (`1.152 m³` system vs `1.152 m³` reference, `0.00%` error), confirming identical member dimensions and instance counts. However, formwork area is `14.40 m²` (system) vs `11.52 m²` (reference)—a `+2.88 m²` (`+25.00%`) difference.
- **Engineering Root Cause:**
  - `qsEngine.ts:1182` computes beam formwork as full 3-sided contact area:
    $$A_{\text{system}} = 4 \times (2 \times 0.40 + 0.20) \times 3.60 = 4 \times 1.00 \times 3.60 = 14.40\text{ m}^2$$
  - The reference takeoff (`11.52 m²`) deducts the `0.10 m` cast-in-place slab thickness on both beam sides (`2 × 0.10 = 0.20 m/m`):
    $$A_{\text{ref}} = 4 \times (2 \times (0.40 - 0.10) + 0.20) \times 3.60 = 4 \times 0.80 \times 3.60 = 11.52\text{ m}^2$$
- **Taxonomy Decision:** Calling this `FORMULA_ERROR` is misleading because both conventions exist in Thai QS practice (gross beam sides vs. net beam sides after slab thickness deduction, depending on whether slab edge formwork is measured separately). We added `MEASUREMENT_CONVENTION_MISMATCH` to `BenchmarkErrorType` in `tools/benchmark/error_analysis.ts`, which automatically triggers when formwork differs (`> 3%`) while concrete volume matches (`<= 3%`).

---

## 8. Reproducibility Verification (3-Run Audit)

`npx tsx tools/benchmark/consolidated_run.ts` and the automated test suite (`tools/benchmark/benchmark.test.ts`) were executed 3 consecutive times:

| Metric / Check | Run 1 | Run 2 | Run 3 | Deterministic? |
| :--- | :---: | :---: | :---: | :---: |
| **Member Ordering (`22` IDs)** | `DPT-H1-F01 .. CDC1-RB01` | Identical | Identical | **YES (`100%`)** |
| **Total / Valid / Verified / Invalid** | `22 / 21 / 11 / 1` | `22 / 21 / 11 / 1` | `22 / 21 / 11 / 1` | **YES (`100%`)** |
| **Concrete (`VERIFIED` n=11) MSE / MdAPE / P90 / Max** | `0.0001 m³ / 0% / 0.05% / 0.12%` | Identical | Identical | **YES (`100%`)** |
| **Formwork (`VERIFIED` n=11) MSE / MdAPE / P90 / Max** | `0.2618 m² / 0% / 0% / 25%` | Identical | Identical | **YES (`100%`)** |
| **Rebar (`VERIFIED` n=11) MSE / MdAPE / P90 / Max** | `1.5282 kg / 0% / 8.77% / 10.39%` | Identical | Identical | **YES (`100%`)** |
| **Concrete (`All Valid` n=21) MSE / MdAPE / P90 / Max** | `0 m³ / 0% / 0.05% / 0.12%` | Identical | Identical | **YES (`100%`)** |
| **Formwork (`All Valid` n=21) MSE / MdAPE / P90 / Max** | `0.1371 m² / 0% / 0% / 25%` | Identical | Identical | **YES (`100%`)** |
| **Rebar (`All Valid` n=21) MSE / MdAPE / P90 / Max** | `1.6829 kg / 0% / 8.77% / 10.88%` | Identical | Identical | **YES (`100%`)** |
| **NEEDS_REVIEW / AUTO_RELEASE / False Release** | `11 (50%) / 11 (50%) / 1 (9.09%)` | Identical | Identical | **YES (`100%`)** |

*Note:* Runtime metadata (`runTimestamp`, `processingTimeMs`) is stored strictly in `BenchmarkRunOutput.metadata` / timing fields and never contaminates quantity or error comparisons.

---

## 9. Critical Findings Summary

1. **False Release Gate Asymmetry (High Severity):** `BEAM` is 100% gated into `NEEDS_REVIEW` when support column widths are absent, whereas `SLAB` (`DPT-H1-S01`, `5.69%` error), `COLUMN` (`DPT-H1-C01`, `2.16%` error), and `FOOTING` (when `footingHookShape` is passed) auto-release (`100%`) without warning on center-to-center bay dimensions, unverified lap splices, or bent-up slab bars.
2. **Dataset Reference Circularity (High Severity):** Half of the 22 benchmark entries (`9 ESTIMATED`, `1 BOQ_REFERENCE`, `1 INVALID`) relied on assumed member lengths or engine-formula-derived rebar weights rather than independent bar-bending schedules.
3. **Holdout Multi-Bar Truncation (`CDC1-GB03`, High Severity):** `CDC1-GB03` dropped `+2-DB16` top and bottom bars present in `cdc_1/answer_key.json`, masking a ~48% rebar weight difference if evaluated against the full drawing callout.
4. **Metric Contamination by `INVALID` & `ESTIMATED` Records (Remediated):** Prior to Round 11, `aggregateEvaluationResults()` mixed all ground truth statuses into a single summary. `metrics.ts` now separates `verifiedOnlyByComponent` (`n=11`) from `byComponent` (`n=21`) and excludes `INVALID` (`n=1`).

---

## 10. Recommended Next Steps (For Future Approved Remediation Rounds)

1. **Production Warning Gate Parity (Future Engine Round):**
   - Emit an advisory `warn` flag in `calculateMember()` for `SLAB` when center-to-center bay dimensions are supplied without beam width deductions or when bent-up bar (`เหล็กคอม้า`) / top edge negative reinforcement is unspecified.
   - Require `provenance` to be populated (or emit a `PROVENANCE_MISSING` warning) so unverified manual/extracted inputs do not default to `95%` confidence.
   - Emit a `warn` flag on `COLUMN` when `40d` lap splice is added without story-level verification.
2. **Independent Bar-Bending Schedule (BBS) Ground Truth:**
   - Replace formula-derived `ESTIMATED` rebar references with independent line-by-line Bar-Bending Schedules extracted from the full dimension chains on sheets S-01..S-07 and governmental ปร.4 detail sheets.
   - Restore `CDC1-GB03`'s full `"3-RB12+2-DB16"` / `"2-DB16+3-RB12"` specification with an independently verified BBS reference weight.

---

## 11. Exact Files Changed in Round 11

- **Production Engine (`src/engine/qsEngine.ts`):** **NONE (0 lines changed — strictly preserved)**
- **Benchmark Infrastructure & Datasets (`tools/benchmark/`):**
  1. `tools/benchmark/metrics.ts` — Added `zeroDivCount`, `invalidMembers`, `verifiedOnlyByComponent`, and excluded `INVALID` records from accuracy aggregations.
  2. `tools/benchmark/error_analysis.ts` — Added `MEASUREMENT_CONVENTION_MISMATCH` taxonomy and diagnostic heuristic.
  3. `tools/benchmark/run_benchmark.ts` — Added `Number.isFinite` validation for reference quantities and `dimensions.count`, and guarded `isFalseRelease` against `INVALID` reference records.
  4. `tools/benchmark/consolidated_run.ts` — Enhanced output to report `VERIFIED`-only vs. `All Valid` metrics and full 22-member forensic fields.
  5. `tools/benchmark/benchmark.test.ts` — Added edge-case tests (`NaN`/`Infinity`/negative refs, `zeroDivCount`, small references, `VERIFIED` vs `ESTIMATED` vs `INVALID` separation, `MEASUREMENT_CONVENTION_MISMATCH`, 3-run reproducibility).
  6. `tools/benchmark/datasets/real_house1_benchmark.json` — Reclassified `DPT-H1-C01` (`ESTIMATED`) and `DPT-H1-S01` (`BOQ_REFERENCE`).
  7. `tools/benchmark/datasets/real_house2_benchmark.json` — Reclassified `DPT-H2-B01`, `B02`, `B03` (`ESTIMATED`).
  8. `tools/benchmark/datasets/real_dot32_benchmark.json` — Reclassified `DOT32-C01` (`ESTIMATED`).
  9. `tools/benchmark/datasets/real_cdc1_benchmark.json` — Reclassified `CDC1-C01`, `GB01`, `GB02`, `RB01` (`ESTIMATED`) and `CDC1-GB03` (`INVALID`).
  10. `tools/STRUCTBOQ_ROUND11_FORENSIC_AUDIT_REPORT.md` — This forensic audit report.

---

## 12. Git Status & Verification

- **`git diff --stat src/engine/qsEngine.ts`:** `1 file changed, 447 insertions(+), 48 deletions(-)` (100% identical to pre-Round-11 working tree state; zero Round 11 edits to production engine).
- **Test Suite (`npm test`):** `127/127` tests passing (`37` in `qsEngine.test.ts` + `90` in PDF/benchmark tests).
- **TypeScript (`npx tsc --noEmit`):** Clean (`0` errors).
- **Production Build (`npm run build`):** Clean (`0` errors).
