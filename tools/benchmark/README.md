# StructBOQ Independent Benchmark & Validation Framework

This directory contains the automated benchmark framework for evaluating **StructBOQ** takeoff calculations against independently verified construction drawings and reference quantities.

---

## 1. Objectives

1. **Empirical Engineering Validation:** Provide deterministic, reproducible validation of structural quantity estimates (concrete volume $m^3$, formwork area $m^2$, rebar weight $\text{kg}$) on actual Thai construction drawings.
2. **Anti-Leakage Isolation:** Ensure reference quantities are never ingested by calculation pipelines or used to overfit heuristics.
3. **Transparent Quality Gates:** Accurately measure False Releases (unflagged quantity errors) and quarantine rates (`NEEDS_REVIEW`).

---

## 2. Directory Structure

```text
tools/benchmark/
├── README.md                      # Framework documentation and guidelines
├── dataset_schema.json            # JSON Schema draft-07 specification for benchmark datasets
├── run_benchmark.ts               # Core execution harness and validation runner
├── metrics.ts                     # Mathematical error aggregation (MdAPE, P90, MSE, False Release)
├── error_analysis.ts              # 11-category error classification engine
├── benchmark_report_template.md   # Standardized Markdown report template
├── benchmark.test.ts              # Test suite verifying benchmark harness integrity
├── datasets/                      # Benchmark datasets
│   ├── synthetic_smoke_test.json  # [SYNTHETIC] Smoke-test dataset for CI and harness tests
│   └── real_house1_benchmark.json # Real verified Thai standard plan (DPT House 1)
└── results/                       # Machine-readable output JSONs (timestamped)
```

---

## 3. Ground Truth Classification Hierarchy

Every reference quantity in a benchmark dataset must be strictly classified under one of four statuses:

| Status | Definition | Eligible for Accuracy Claims? |
|:---|:---|:---:|
| **`VERIFIED`** | Individually checked against drawings and calculated by an independent qualified structural engineer or surveyor. | **YES (Primary Standard)** |
| **`BOQ_REFERENCE`** | Extracted from an official project BOQ (ปร.4 / ปร.5), but not broken down or re-verified by calculation. | **NO (Comparative Only)** |
| **`ESTIMATED`** | Derived from engineering heuristics, typical rules of thumb, or incomplete schedules. | **NO (Reference Only)** |
| **`INVALID`** | Conflicted, unreadable, or missing drawing evidence. Excluded from quantitative scoring. | **NO (Excluded)** |

> [!CAUTION]
> **ANTI-HALLUCINATION RULE:** Never silently promote a `BOQ_REFERENCE` or `ESTIMATED` value to `VERIFIED`. Official accuracy claims require verifiable drawing evidence.

---

## 4. Anti-Leakage Rules

1. **Strict Input Segregation:** The `referenceQuantity` field in a benchmark entry is strictly isolated from the `calculateMember()` invocation. The engine receives only geometric and notation parameters (`tag`, `width`, `depth`, `length`, `rebar`, `coveringCm`, etc.).
2. **No Formula Tuning on Held-out Sets:** Datasets labeled `split: "heldout"` must never be inspected during algorithm optimization.
3. **Preserve Original Outputs:** System outputs are logged in their raw, unmodified form before any manual survey edits.
4. **Synthetic Data Exclusion:** Synthetic test cases must be labeled `split: "synthetic"` and never included in real-world accuracy claims.

---

## 5. Metrics Definitions

- **Absolute Error:** $|y_{\text{sys}} - y_{\text{ref}}|$
- **Relative Error (%):** $\frac{|y_{\text{sys}} - y_{\text{ref}}|}{y_{\text{ref}}} \times 100\%$ (handled safely when $y_{\text{ref}} = 0$).
- **Median Absolute Percentage Error (MdAPE):** Median of percentage errors across all evaluated members (robust against extreme outliers).
- **P90 Absolute Percentage Error:** 90th percentile of absolute percentage errors.
- **Maximum Absolute Percentage Error (MaxAPE):** Worst-case percentage discrepancy.
- **Mean Signed Error (MSE):** $\frac{1}{N} \sum (y_{\text{sys}} - y_{\text{ref}})$. Positive indicates systematic overestimation; negative indicates underestimation.
- **False Release Count:** Instances where the system assigned `status: 'AUTO_RELEASE'`, but relative error exceeded the tolerance threshold ($5\%$) or suffered unflagged division-by-zero errors.
- **NEEDS_REVIEW Rate (%):** Fraction of members safely routed to human survey review.

---

## 6. Error Taxonomy (11 Categories)

Every discrepancy exceeding tolerance is classified into one or more categories:

1. `OCR_ERROR`: Misread numbers or missing characters on drawing scans.
2. `DRAWING_INTERPRETATION_ERROR`: Ambiguity in schedules, sections, or multi-option details.
3. `DIMENSION_ERROR`: Discrepancy between drawn span and center-to-center grid lines.
4. `REINFORCEMENT_COUNT_ERROR`: Missing or extra bar in pitch or group count.
5. `COVER_ERROR`: Cover thickness conflict or unverified casting condition.
6. `HOOK_ASSUMPTION_ERROR`: Discrepancy matching hook extension length (e.g. standard hook vs full upturn).
7. `LAP_ASSUMPTION_ERROR`: Discrepancy matching commercial stock bar splice ($40d_b$).
8. `UNIT_CONVERSION_ERROR`: 10x, 100x, or 1000x scaling mismatch (cm vs mm vs m).
9. `FORMULA_ERROR`: Contact area or volume deduction formula mismatch.
10. `REFERENCE_DATA_ERROR`: Inconsistency in the reference benchmark itself.
11. `UNKNOWN`: Unresolved discrepancy requiring engineering review.

---

## 7. How to Run Benchmarks

Run the synthetic smoke test:
```bash
npx tsx tools/benchmark/run_benchmark.ts tools/benchmark/datasets/synthetic_smoke_test.json
```

Run on real project dataset (House 1):
```bash
npx tsx tools/benchmark/run_benchmark.ts tools/benchmark/datasets/real_house1_benchmark.json
```

Run benchmark test suite:
```bash
npx tsx --test tools/benchmark/benchmark.test.ts
```
