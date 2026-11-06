@AGENTS.md

Ponytail (lazy senior dev mode, full level) is on for every session in this repo. Skills: `/ponytail [lite|full|ultra|off]`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-help` (in `.claude/skills/`, from github.com/DietrichGebert/ponytail, MIT).

## StructBOQ: never cut

- Reading accuracy is judged per field against `real_drawings/*/answer_key.json`. Dev sets: `house_ready_1..4`, `toilet_604_45`, `dot32_pavilion`, `cdc_1` (scan OCR was tuned on it, 2026-10-20). Held-out: `cdc_2`, `cdc_3`, `carpark_srinakorn`, `thaisuk_5..8` — measure only, never tune rules on them.
- Reader rules stay general: no dataset-specific constants.
- While coding, check with `npm test` only (unit tests + small fixtures in `src/pdf/fixtures/`; no PDF, no OCR).
- The full check on real drawing sets runs once, when a reader/engine change is finished or the user asks: `FULL_BOQ=1 npm run check:full` (no regressions = done). Read only its summary lines.
- `check:full` reads the stored `offline_ocr.json`, which is older OCR than the app runs today. The OCR the app runs today is checked by `FULL_BOQ=1 npx tsx scripts/check_ocr_current.ts` (reads the structural pages of house_ready_1/2/4 again with the current `src/pdf/` code, ~10 min, writes nothing under `real_drawings/`; fails if a wrong value rises or a right one falls against `tools/benchmark/ocr_current_baseline.json`). Run it when `src/pdf/` code that affects OCR or reading is finished, not on every edit. `--write-baseline` only when the user says so.
- Scripts that open real PDFs, run OCR or read whole sets (`offline_ocr`, `add_rects`, `boq_ocr`, `benchmark_offline`, `eval_reading`) refuse to run without `FULL_BOQ=1`. Don't set it, render PDF pages to images, or re-OCR a set unless the user asked for it.
- A value the drawing did not give is flagged on the item (assumed / code minimum), never passed off as read.
- Unguarded one-off scripts in `scripts/` also read real drawing sets (PDF, OCR caches or the whole reader): `check_*.ts`, `inspect_*.ts`, `test_*.ts`, `glyph_words.ts`, `boq_text.ts`, `text_to_ocr.ts`, `sync_datasets.ts` and the `*.py` scripts. They are not part of `npm test`; run one only when the user asks.
