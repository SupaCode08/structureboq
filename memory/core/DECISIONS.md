# DECISIONS

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
