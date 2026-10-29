# CURRENT CONTEXT

- **Active Workspace**: `C:\Users\supak\Desktop\structboq-ai-construction-quantity-surveying-oct-16-2026-5-13-56-pm`
- **Handoff Reference**: `HANDOFF_2026-10-29.md` (supersedes `CLAUDE_HANDOFF.md`)
- **Verification State (2026-10-29)**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npm test`: PASS (**28/28** engine tests + **69/69** pdf/tools tests)
  - All 9 `real_drawings/*/benchmark_offline.json` SHA-256 hashes verified intact.
- **Completed in 2026-10-27..28 Handoff**:
  1. Parallel Tesseract vector passes (`turnedWorkers` in `browserPipeline.ts` & `pdfOcrPipeline.ts`): identical words/order, 97.8s -> 39.6s on dot32 p16-21.
  2. PDF.js Document Lifecycle (`src/pdf/docLifecycle.ts` + `docLifecycle.test.ts`): `swapDoc` and `destroyOnError` prevent worker/memory leaks.
  3. Section Title Tie-Break (`src/pdf/sheetReader.ts`): low-confidence (<40%) titles not present on any plan no longer steal values from valid titles (`dot32` improved from 17/1/5 to 19/1/3).
- **Survey Completed (R2 - Slab 'S' & Thai Slab Titles across 7 Dev Sets)**:
  - Surveyed `answer_key.json` and `offline_ocr.json` across all 7 dev sets (`house_ready_1..4`, `toilet_604_45`, `dot32_pavilion`, `cdc_1`).
  - Only `dot32_pavilion` (the sole digital text-layer set) uses bare `'S'` (11x on p19) and Thai title `'แบบขยายเหล็กเสริมพื้น'` (p20). Other 6 dev sets are scanned (PaddleOCR Latin/digits) and use `S1`, `S0`, `GS`, `SP`.
- **Awaiting User Decision / Approval Before Any Production Code Edit**:
  1. **R1 (Browser Scan OCR Quality vs Speed/RAM)**: Test middle ground (400 dpi full-image + 2 workers splitting flat vs turned instead of 2 horizontal bands) + regenerate `test:paddle` fixtures?
  2. **R2 (Bare `'S'` Slab + `'แบบขยายเหล็กเสริมพื้น'`)**: Since only 1 dev set (`dot32_pavilion`) has this pattern, confirm whether to skip (avoid single-set rule) or approve a general rule.
  3. **Small Bug Fixes (2-line diffs ready)**:
     - `readBand` `'error'` listener leak in `src/pdf/browserPipeline.ts`.
     - `paddleStatsSink` per-call scoping in `src/pdf/browserPipeline.ts`.
  4. **Git Repository Initialization**: `git init` and commit verified changes if desired.
