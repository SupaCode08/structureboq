# TASKS

- **P0 - R1: In-Browser Scan OCR Parity with Offline Cache**:
  - Priority: P0
  - Status: AWAITING_USER_APPROVAL
  - Related Project: StructBOQ
  - Next Action: Await user decision on trying middle ground (400 dpi full image + 2 workers splitting flat/turned) and regenerating `test:paddle` fixtures.
  - Blockers: User approval required before changing OCR resolution/worker behavior or fixtures.
  - Last Updated: 2026-10-29

- **P1 - R2: Survey Single-Letter 'S' Slab & Thai Slab Detail Titles on Dev Sets**:
  - Priority: P1
  - Status: SURVEY_DONE_AWAITING_DECISION
  - Related Project: StructBOQ
  - Result: Only 1/7 dev sets (`dot32_pavilion`) has bare `'S'` and Thai title `'แบบขยายเหล็กเสริมพื้น'`.
  - Next Action: Await user decision on whether to leave as-is (avoid single-sheet overfitting) or add general rule.
  - Last Updated: 2026-10-29

- **P2 - Minor Cleanup (`readBand` error listener & `paddleStatsSink`)**:
  - Priority: P2
  - Status: AWAITING_USER_APPROVAL
  - Related Project: StructBOQ
  - Next Action: Apply 2-line listener cleanup in `src/pdf/browserPipeline.ts` once approved.
  - Last Updated: 2026-10-29
