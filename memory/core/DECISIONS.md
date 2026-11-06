# DECISIONS

- **Date**: 2026-11-03
  - **Decision**: Validate StructBOQ against 4 Real Construction Projects and Confirm 82.4% End-to-End QS Productivity Improvement.
  - **Reason**: Round 16 real project validation proved that (1) VERIFIED ground truth achieves 0.00% MdAPE across concrete, formwork, and rebar; (2) full-lifecycle assisted takeoff requires 14.1 minutes per sheet vs 80.0 minutes manual scratchpad takeoff (82.4% time reduction); (3) 0% of errors are caused by formula defects; and (4) strict 4-tier ground truth isolation protects benchmark independence.
  - **Alternatives Considered**: Claiming "zero-minute takeoff" based on 5.7 ms engine execution alone (rejected: dishonest and ignores necessary human verification time); merging BOQ_REFERENCE into VERIFIED (rejected: violates engineering rigor).
  - **Expected Outcome**: Verified commercial viability with strict Level 2 safety protocols.
  - **Reversal Conditions**: None; foundational real-project validation record.

- **Date**: 2026-11-03
  - **Decision**: Finalize Commercial Pilot Certification as READY WITH RESTRICTIONS under Level 2 Protocols.
  - **Reason**: Round 15 proved that numerical confidence must not override missing provenance. While the mathematical engine is 100% stable and invariant across 143 tests, commercial safety requires restricting autonomous release to isolated spread footings and rectangular tied columns, while maintaining mandatory provisional quarantine on beams (unconfirmed supports) and slabs (unconfirmed negative bars). Rebar BBS is strictly barred from direct fabrication cutting without approved shop drawings.
  - **Alternatives Considered**: Granting unconditional commercial readiness (rejected: unsafe for complex beam/slab detailing); declaring system not ready (rejected: footings and columns have 0.00% error and complete traceability).
  - **Expected Outcome**: Defensible, legally sound supervised commercial pilot workflow with zero construction liability.
  - **Reversal Conditions**: When automated 3D bay topological matching coordinates beam-column clear spans across all drawing sheets.

- **Date**: 2026-11-03
  - **Decision**: Preserve DPT-H1-S01 False Release Record Untouched and Enforce Strict Level 2 Supervised Pilot Boundaries.
  - **Reason**: Round 14 forensic audit proved that DPT-H1-S01 False Release is caused by synthetic benchmark input omitting provenance (triggering default 95% confidence) combined with reference government BOQ using gross-span bar placement (44.80 kg) vs engine net-span placement (42.25 kg, 5.69% error). Modifying the reference or suppressing the record would compromise benchmark independence and violate anti-leakage rules.
  - **Alternatives Considered**: Tuning S1 reference quantity to 42.25 kg to achieve 0 false releases (rejected: corrupts audit integrity); hardcoding a slab penalty rule (rejected: arbitrary formula tampering).
  - **Expected Outcome**: Absolute transparency in benchmark metrics; pilot scope strictly restricted to spread footings and rectangular tied columns with mandatory human verification for beams and slabs.
  - **Reversal Conditions**: When independent shop drawing rebar schedules are drafted for DPT House 1 wet area slab.

- **Date**: 2026-11-03
  - **Decision**: Validate End-to-End Release Safety Across All 5 Ingestion Paths and Enforce Invariant Physical Rejections.
  - **Reason**: Round 13 verified that user approval cannot override fatal geometry errors (`NaN`, `<=0`), that `COVER_EXCEEDS_DIMENSION` (`block`) halts rebar calculation even if reviewer marks approved, that `DEFAULT_VALUE` provenance remains quarantined, and that downstream Excel and PDF exports dynamically flag provisional quantities whenever `needsReviewCount > 0` or `rejectedCount > 0`.
  - **Alternatives Considered**: Permitting user approval to force-release `NaN` or blocked quantities (rejected: causes crashes downstream in financial systems and creates severe construction liability).
  - **Expected Outcome**: Comprehensive protection against rogue inputs; 100% deterministic test and benchmark suites; clean Level 2 commercial readiness maintained.
  - **Reversal Conditions**: Never allow software convenience to override structural or physical bounds.

- **Date**: 2026-10-21
  - **Decision**: Adopt Dual-Graph Topological Takeoff Architecture (Grid Graph x Member Graph x Plan-to-Schedule Bipartite Matching) based on international SOTA research (Togal.AI, Kreo, CAD-GNN 2024-2025).
  - **Reason**: Raster OCR alone suffers from letter dropouts and character confusions (e.g. `SO` for `SP`, `34` for `B4`). Relying purely on OCR text causes overfitting and brittle ad-hoc patches. The physical topology of structural frames provides deterministic ground truth.
  - **Alternatives Considered**: End-to-end heavy multimodal LLM vision (too expensive, slow, non-deterministic, hallucinates numbers); manual hardcoded string dictionary (overfits, breaks on new drawing styles).
  - **Expected Outcome**: Generalized, fast, zero-cost, deterministic takeoff matching official BOQ within acceptable engineering tolerance (<10-15%).
  - **Reversal Conditions**: If drawings lack any grid coordinate or schedule structure whatsoever (e.g. freehand sketches).

- **Date**: 2026-10-21
  - **Decision**: Disentangle Drawing Index Detection from Structural Member Tags.
  - **Reason**: Regex for drawing sheet references (`S-01`, `S-02`) previously matched member tags like `S1` and `ST1`, causing entire beam schedule sheets (e.g. Page 34) to be misclassified as drawing index and excluded.
  - **Expected Outcome**: All structural member detail sheets remain active and fully extracted.

- **Date**: 2026-11-03
  - **Decision**: Harden Release Gate Policy and Provenance Propagation Without Mathematical Formula Alteration.
  - **Reason**: Round 12 audit revealed that missing provenance records previously defaulted to 95% confidence and that beam support width assumptions were unflagged in provenanceFlags(), allowing unverified inputs to auto-release. In addition, downstream Excel and PDF exports lacked visibility of provisional review status.
  - **Alternatives Considered**: Silently auto-releasing all items when user review is missing (rejected: violates quantity surveyor safety and creates severe financial liability); hardcoding 100% needs-review across all elements (rejected: destroys utility of automated release for verified schedules).
  - **Expected Outcome**: Unsafe assumptions are quarantined to `NEEDS_REVIEW`; provenance levels are explicitly tagged; downstream exports show clear warning banners; 100% backward mathematical formula compatibility preserved across all 139 tests.
  - **Reversal Conditions**: Never revert to silent release on unverified assumptions.

- **Date**: 2026-11-03
  - **Decision**: Introduce `MEASUREMENT_CONVENTION_MISMATCH` in Benchmark Taxonomy and Strictly Segregate `VERIFIED` vs `ESTIMATED`/`BOQ_REFERENCE`/`INVALID` Metrics.
  - **Reason**: Round 11 forensic audit revealed that (1) the 25% formwork difference on `DPT-H1-B02` (where concrete volume matches 100%) is a QS measurement convention mismatch (full beam side vs slab-intersection deduction), not a mathematical formula bug; and (2) 11 of 22 benchmark entries in Rounds 9–10 used assumed spans/heights or truncated multi-bar callouts (`CDC1-GB03`). Mixing `ESTIMATED` and `INVALID` records into `VERIFIED` accuracy summaries inflated ground-truth claims.
  - **Alternatives Considered**: Tuning `qsEngine.ts` to deduct 10cm slab thickness on all beams (rejected: corrupts exterior/roof beams and violates read-only audit rules); silently deleting `CDC1-GB03` (rejected: violates forensic transparency).
  - **Expected Outcome**: Honest, non-inflated benchmark metrics with `verifiedOnlyByComponent` (`n=11`) separated from `byComponent` (`n=21`) and `invalidMembers` (`n=1`) explicitly tracked.
  - **Reversal Conditions**: When independent Bar-Bending Schedules (BBS) and drawing dimension chains are verified for all 22 member groups.

- **Date**: 2026-11-03
  - **Decision**: Preserve Gross Contact Surface in Beam Formwork Without Arbitrary Slab Deductions.
  - **Reason**: Investigation of the 25% formwork discrepancy on B2 in House 1 revealed that reference data deducted 10cm slab thickness from beam sides ((2(d - 0.10) + w) * L = 0.80m perimeter), whereas StructBOQ calculates gross physical formwork ((2d + w) * L = 1.00m perimeter). Arbitrarily deducting 10cm in the engine would corrupt exterior, roof, and parapet beams that have full-height side forms.
  - **Alternatives Considered**: Hardcoding a 10cm deduction on all beams (rejected: un-engineered and dangerous for non-interior beams), forcing system output to match BOQ reference (rejected: violates engineering independence).
  - **Expected Outcome**: Transparent documentation of measurement conventions under FORMULA_ERROR; zero arbitrary formula tampering.
  - **Reversal Conditions**: When 3D topological bay matching connects adjacent slabs to beam sides.

- **Date**: 2026-11-03
  - **Decision**: Establish Independent Benchmark Architecture with Strict 4-Tier Ground Truth Classification and Anti-Leakage Sandbox.
  - **Reason**: Without isolating ground truth from engine execution, benchmark numbers can be artificially inflated by feedback leakage. Government BOQ documents (แบบ ปร.4) round quantities to integers at building-level, making them unsuitable as unverified ground truth for member geometries. Only independently checked calculations (`VERIFIED`) may substantiate engineering claims.
  - **Alternatives Considered**: Direct string comparison against BOQ line items (rejected: BOQ merges elements and rounds numbers), tuning engine formulas on benchmark sets (rejected: violates scientific validation and causes overfitting).
  - **Expected Outcome**: Objective, repeatable benchmark metrics (MdAPE, P90, False Release detection) on real Thai construction drawings; zero engine contamination.
  - **Reversal Conditions**: None; foundational validation infrastructure.

- **Date**: 2026-11-03
  - **Decision**: Retain +1e-7 Absolute Numerical Slack in `Math.floor()` for Bar Counts and Correct Classification to Numerical Slack (Not Machine Epsilon).
  - **Reason**: JavaScript IEEE 754 float64 division produces values infinitesimally lower than integers (e.g. 1.20 / 0.20 = 5.9999999999999991, 0.70 / 0.10 = 6.9999999999999991), causing `Math.floor` to truncate by 1 full bar. Adding 1e-7 ($0.02\ \mu\text{m}$) safely absorbs floating-point loss without rounding across construction millimetre increments. Clarified that machine epsilon for float64 is strictly $2^{-52} \approx 2.22 \times 10^{-16}$.
  - **Alternatives Considered**: Integer millimetre arithmetic (rejected: loses float precision on meter coordinates and still produces float division), `Math.ceil()` (rejected: distorts pitch and inflates steel), using exact machine epsilon (rejected: too small to handle multi-step float rounding accumulation).
  - **Expected Outcome**: Robust numerical stability across integer and decimal dimensions with zero dropped bars.
  - **Reversal Conditions**: None; mathematically sound.

- **Date**: 2026-11-03
  - **Decision**: Quarantine Unspecified Footing Hook Geometry to `NEEDS_REVIEW` (`warn`) Rather than Allowing Auto-Release.
  - **Reason**: Full upturn hooks represent up to 31% of footing steel. If drawings do not detail hook shapes, assuming full upturn without alerting the QS can produce misleading tender totals.
  - **Alternatives Considered**: Auto-releasing with info flag (rejected: allowed unverified assumptions to slip into BOQ without survey sign-off), hardcoding straight bars (rejected: unsafe if upturns were required for anchorage).
  - **Expected Outcome**: Unresolved footing assumptions are clearly flagged as provisional quantities and require human QS verification before final BOQ release.
  - **Reversal Conditions**: When drawing extraction includes verified 2D/3D detail crop evidence showing hook geometry.

- **Date**: 2026-11-03
  - **Decision**: Reject Invalid Rebar Spacing and Section Cover Geometries Rather Than Silently Defaulting, and Expose Explicit Hook & Stock Length Configurations.
  - **Reason**: Silent fallbacks like `Math.max(0.05, spacing)` or defaulting `@0` to `0.15m` created apparently valid BOQ quantities from corrupted input. In addition, rigid full upturn hooks in footings and hardcoded 6m stock lengths distorted steel estimates without user control.
  - **Alternatives Considered**: Silently clamping invalid spacing to 0.15m (rejected: masks corrupted drawings and violates QS ethics); hardcoding standard hooks only (rejected: breaks backward compatibility for drawings detailed with upturned bars).
  - **Expected Outcome**: Completely eliminates silent corruption; exposes granular net/hook/lap weight breakdown; all 118 tests pass with 100% backward compatibility.
  - **Reversal Conditions**: Never revert to silent fallbacks.
