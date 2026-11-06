# StructBOQ Benchmark Validation Report: {{projectName}}

**Dataset ID:** `{{datasetId}}`  
**Dataset Version:** `{{datasetVersion}}`  
**Dataset Split:** `{{split}}`  
**Drawing Reference:** `{{drawingFile}}`  
**Engine Version / Commit:** `{{engineVersion}}` (`{{engineCommit}}`)  
**Run Timestamp:** `{{runTimestamp}}`  

---

## 1. Executive Summary

| Metric | Benchmark Result | Target / Standard |
|:---|:---:|:---:|
| **Total Members Evaluated** | `{{totalMembers}}` | Full project coverage |
| **Verified Ground Truth Count** | `{{verifiedMembers}}` | Primary accuracy basis |
| **Processing Time** | `{{processingTimeMs}} ms` (`{{avgProcessingTimePerMemberMs}} ms/member`) | $< 5.0\text{ ms/member}$ |
| **NEEDS_REVIEW Quarantine Rate** | `{{needsReviewRatePct}}%` (`{{needsReviewCount}}` members) | Appropriate caution |
| **False Release Count** | `{{falseReleaseCount}}` (`{{falseReleaseRatePct}}%` of Auto-Releases) | $0$ target |

---

## 2. Accuracy by Quantity Component

| Component | Mean Signed Error | Mean Abs Error | Median Abs % Error (MdAPE) | P90 Abs % Error | Max Abs % Error |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Concrete Volume ($m^3$)** | `{{concreteMeanSigned}}` | `{{concreteMeanAbs}}` | `{{concreteMdAPE}}%` | `{{concreteP90}}%` | `{{concreteMax}}%` |
| **Formwork Area ($m^2$)** | `{{formworkMeanSigned}}` | `{{formworkMeanAbs}}` | `{{formworkMdAPE}}%` | `{{formworkP90}}%` | `{{formworkMax}}%` |
| **Reinforcement Weight ($\text{kg}$)** | `{{rebarMeanSigned}}` | `{{rebarMeanAbs}}` | `{{rebarMdAPE}}%` | `{{rebarP90}}%` | `{{rebarMax}}%` |

---

## 3. Performance Breakdown by Structural Member Type

| Member Type | Member Count | Concrete MdAPE | Formwork MdAPE | Rebar MdAPE | False Releases | Review Rate |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| **FOOTING** | `{{footingCount}}` | `{{footingConcreteMdAPE}}%` | `{{footingFormworkMdAPE}}%` | `{{footingRebarMdAPE}}%` | `{{footingFalseRelease}}` | `{{footingReviewRate}}%` |
| **COLUMN** | `{{columnCount}}` | `{{columnConcreteMdAPE}}%` | `{{columnFormworkMdAPE}}%` | `{{columnRebarMdAPE}}%` | `{{columnFalseRelease}}` | `{{columnReviewRate}}%` |
| **BEAM** | `{{beamCount}}` | `{{beamConcreteMdAPE}}%` | `{{beamFormworkMdAPE}}%` | `{{beamRebarMdAPE}}%` | `{{beamFalseRelease}}` | `{{beamReviewRate}}%` |
| **SLAB** | `{{slabCount}}` | `{{slabConcreteMdAPE}}%` | `{{slabFormworkMdAPE}}%` | `{{slabRebarMdAPE}}%` | `{{slabFalseRelease}}` | `{{slabReviewRate}}%` |

---

## 4. Error Taxonomy Distribution

| Error Category | Incident Count | Primary Affected Component | Typical Engineering Root Cause |
|:---|:---:|:---|:---|
| `OCR_ERROR` | `{{count_OCR_ERROR}}` | Dimensions / Schedules | Low contrast or stroke fragment on scan |
| `DRAWING_INTERPRETATION_ERROR` | `{{count_DRAWING_INTERPRETATION_ERROR}}` | Reinforcement | Ambiguity in callouts or split schedules |
| `DIMENSION_ERROR` | `{{count_DIMENSION_ERROR}}` | Concrete / Formwork | Grid spacing vs clear span mismatch |
| `REINFORCEMENT_COUNT_ERROR` | `{{count_REINFORCEMENT_COUNT_ERROR}}` | Rebar | Extra/missing bar along non-standard pitch |
| `COVER_ERROR` | `{{count_COVER_ERROR}}` | Rebar | Geometric core conflict |
| `HOOK_ASSUMPTION_ERROR` | `{{count_HOOK_ASSUMPTION_ERROR}}` | Rebar | Standard hook vs full vertical upturn |
| `LAP_ASSUMPTION_ERROR` | `{{count_LAP_ASSUMPTION_ERROR}}` | Rebar | Commercial stock length splice ($40d_b$) |
| `UNIT_CONVERSION_ERROR` | `{{count_UNIT_CONVERSION_ERROR}}` | General | Metric unit scaling mismatch |
| `FORMULA_ERROR` | `{{count_FORMULA_ERROR}}` | Formwork | Edge/side deduction variation |
| `REFERENCE_DATA_ERROR` | `{{count_REFERENCE_DATA_ERROR}}` | Reference | Drawing revision or unverified BOQ roundoff |
| `UNKNOWN` | `{{count_UNKNOWN}}` | Unclassified | Requires expert structural surveyor review |

---

## 5. False Release Inspection

{{#falseReleases}}
- **Member `{{memberId}}` (`{{tag}}`, `{{memberType}}`):**
  - Concrete Error: `{{concreteErrorPct}}%` | Formwork Error: `{{formworkErrorPct}}%` | Rebar Error: `{{rebarErrorPct}}%`
  - Flags Generated: `{{flags}}`
  - Cause: `{{diagnostics}}`
{{/falseReleases}}
{{^falseReleases}}
*No False Releases detected. All Auto-Released members satisfied strict accuracy thresholds.*
{{/falseReleases}}

---

## 6. Engineering Certification & Readiness Status

- **Evaluation Dataset Split:** `{{split}}`
- **Readiness Standard:** Verified against Level 2 Detailed BOQ standard.
- **Auditor Verdict:** `{{verdict}}`
