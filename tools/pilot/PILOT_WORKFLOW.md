# STRUCTBOQ COMMERCIAL PILOT OPERATIONAL WORKFLOW & PROTOCOL

**Document Version:** 15.0  
**Deployment Mode:** Level 2 Assisted Production with Mandatory Human-in-the-Loop Review  
**Audience:** Licensed Professional Engineers, Senior Quantity Surveyors (QS), and Construction Estimators  

---

## 1. Objectives & Executive Scope

This operational protocol establishes the standard operating procedure (SOP) for conducting supervised commercial pilots of the StructBOQ quantity surveying engine on real construction projects in Thailand.

> [!IMPORTANT]
> **Level 2 Operating Principle:**  
> StructBOQ operates as an **Assisted Takeoff Instrument**, not an autonomous agent.  
> The software accelerates dimension extraction and formula evaluation, while legal, financial, and structural sign-off remains strictly with the human Quantity Surveyor.

---

## 2. Nine-Stage Operational Workflow

The following diagram and step-by-step instructions outline the mandatory lifecycle of every drawing sheet processed during the pilot:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   STRUCTBOQ 9-STAGE PILOT WORKFLOW                               │
├──────────────────────────────────────────────────────────────────────────────────┤
│  [1. Upload Drawing]          PDF / CAD vector file uploaded to secure session   │
│         │                                                                        │
│         ▼                                                                        │
│  [2. Review Extracted Data]   Inspect OCR-parsed members, tags, and bay counts   │
│         │                                                                        │
│         ▼                                                                        │
│  [3. Inspect Provenance]      Audit Provenance Level (DRAWING vs OCR vs UNKNOWN) │
│         │                                                                        │
│         ▼                                                                        │
│  [4. Review Warnings]         Examine Amber (warn) and Red (block) flags         │
│         │                                                                        │
│         ▼                                                                        │
│  [5. Confirm / Correct] ───► [MANDATORY HUMAN GATE 1: QS Edits in Audit Trail]   │
│         │                    • Fill missing column widths                        │
│         │                    • Confirm story heights & rebar grades              │
│         ▼                                                                        │
│  [6. Recalculate]             Automatic recalculation & deduction update         │
│         │                                                                        │
│         ▼                                                                        │
│  [7. Review Quantities]       Examine net volume, formwork area, rebar weights   │
│         │                                                                        │
│         ▼                                                                        │
│  [8. Export BOQ]              Generate ปร.4 / ปร.5 Excel Workbook & PDF Report   │
│         │                                                                        │
│         ▼                                                                        │
│  [9. Record QS Approval] ──► [MANDATORY HUMAN GATE 2: Engineering Signature]     │
│                              Formal sign-off in Pilot Data Collection Sheet      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

### Stage 1: Upload Drawing (การนำเข้าแบบแปลน)
- **Action:** Ingest vector PDF or CAD DXF file via StructBOQ web interface.
- **System Behavior:**
  - Extracts structural notes (concrete grade $f'_c$, rebar grades SD30/SD40/SR24, cover specs).
  - Isolates structural schedules from architectural drawing lists.
  - Normalizes coordinate spaces and builds member graph.

---

### Stage 2: Review Extracted Member Data (การตรวจทานข้อมูลดิบ)
- **Action:** Inspect the extracted elements table in the main UI.
- **Verification Checklist:**
  - Are all column tags (`C1`, `C2`), beam tags (`B1`, `B2`), and footing tags (`F1`) correctly captured?
  - Are dimensions ($w \times d \times L$) in metric meters without millimeter/centimeter scale errors?
  - Did the schedule parser capture multi-layer reinforcement (top, bottom, and stirrup spacing)?

---

### Stage 3: Inspect Provenance (การตรวจสอบระดับที่มาของข้อมูล)
- **Action:** Open `TraceabilityModal` (ปุ่ม "ตรวจสอบที่มา & สมการ").
- **Classification Rules:**
  - `USER_CONFIRMED`: Highest authority. Value manually verified or provided by QS.
  - `DRAWING_VERIFIED`: Directly extracted from CAD vector lines or verified vector geometry.
  - `OCR_EXTRACTED`: Read via PaddleOCR / Tesseract from text schedules.
  - `ENGINEERING_ASSUMPTION`: System inferred a value (e.g. beam support width or standard lap splice). **Requires human review!**
  - `DEFAULT_VALUE`: Drawing omitted a field; standard civil defaults applied. **Requires human review!**
  - `UNKNOWN`: Missing provenance reference. **Provisional only; cannot be auto-released.**

---

### Stage 4: Review Warning Flags (การตรวจสอบข้อสังเกตเชิงวิศวกรรม)
- **Action:** Filter items by status (`NEEDS_REVIEW` and `REJECTED`).
- **Critical Flag Audit:**
  - `BEAM_SUPPORT_ASSUMED` (`warn`): Indicates beam span is center-to-center without column widths.
  - `COVER_INVALID` or `COVER_EXCEEDS_DIMENSION` (`block`): Concrete cover violates physical bounds.
  - `REBAR_SPACING_INVALID` (`block`): Spacing is zero, negative, or unparsed.
  - `ASPECT_RATIO_EXCEEDED` (`warn`): Deep beam ($d/b > 6.0$) or inverted beam ($d/b < 0.8$).
  - `STEEL_RATIO` (`warn`): Rebar kg/m³ falls outside standard civil envelopes.

---

### Stage 5: Confirm or Correct Dimensions (การยืนยันและแก้ไขค่าโดย QS)
> [!IMPORTANT]
> **MANDATORY HUMAN APPROVAL POINT 1**  
> Any element carrying an engineering assumption must be explicitly reviewed by the QS.

- **Procedure:**
  1. Click "แก้ไข" on the member row.
  2. Input true column support widths ($c_1, c_2$) from the column schedule.
  3. Confirm clear span vs center-to-center span.
  4. Enter reviewer note (e.g. *"ตรวจสอบระยะเสารองรับจากแบบแผ่น S-02 แล้ว กว้าง 0.25 ม."*).
  5. Click "ยืนยันและบันทึก" (System records immutable before/after diff in `reviewLog`).

---

### Stage 6: Recalculate (การคำนวณซ้ำอัตโนมัติ)
- **System Behavior:**
  - Immediately re-evaluates `calculateMember()` with updated inputs.
  - Applies joint intersection deductions: $L_{\text{net}} = L_{\text{gross}} - (c_1/2 + c_2/2)$.
  - Recalculates net concrete volume, gross contact formwork, and bar cut lengths.
  - If all warnings are resolved, elevates status to `AUTO_RELEASE` (`USER_CONFIRMED`).

---

### Stage 7: Review Quantity Results (การตรวจผลลัพธ์มิติและปริมาณ)
- **Action:** Inspect the calculated quantities:
  - **Concrete Volume ($V_{\text{net}}$):** Confirm deductions at intersections.
  - **Formwork Area ($A_{\text{form}}$):** Verify gross contact surface ($(2d+w) \cdot L$ for beams; $2(w+d) \cdot L$ for columns).
  - **Rebar Weight ($W_{\text{rebar}}$):** Check bar cut schedule, hook allowances, and 2.5% binding wire.

---

### Stage 8: Export BOQ (การส่งออกเอกสาร ปร.4 / ปร.5 และรายงานทางการ)
- **Action:** Click "ดาวน์โหลด Excel (ปร.4/ปร.5)" or "พิมพ์รายงานทางการ (PDF)".
- **Safety Checks:**
  - If any member remains in `NEEDS_REVIEW`, confirm that Sheet 1 displays the amber provisional banner:  
    `⚠️ ข้อควรระวัง: ยอดรวมเป็นยอดประมาณการเบื้องต้น (Provisional Quantity)`
  - Verify that Sheet 2 includes `Provenance` and `Confidence` columns.
  - Verify that rejected items have 0 volume and 0 cost.

---

### Stage 9: Record QS Approval (การลงนามรับรองผลการทดสอบ)
> [!IMPORTANT]
> **MANDATORY HUMAN APPROVAL POINT 2**  
> Formal certification of the pilot run.

- **Action:**
  - Record execution time, manual baseline time, and percentage error in `PILOT_DATA_COLLECTION_TEMPLATE.xlsx`.
  - Licensed QS signs off in Sheet 4 (Productivity) and the PDF signature block.

---

## 3. Mandatory Human Checkpoints Summary

| Checkpoint | Trigger Condition | Responsible Role | Required Action |
| :--- | :--- | :--- | :--- |
| **Gate 1: Beam Support Confirmation** | `BEAM_SUPPORT_ASSUMED` active | Senior QS / Estimator | Look up supporting column dimensions on structural framing plan and input $c_1, c_2$. |
| **Gate 2: Rebar Grade & Notes Check** | Drawing notes read via OCR | Senior QS | Verify whether rebar is SD30, SD40, or SR24; confirm Factor F parameters. |
| **Gate 3: Slab Negative Steel Review** | Cast-in-place slab lacking top rebar | Structural Engineer / QS | Confirm whether top rebar is required over continuous edges or if single mesh suffices. |
| **Gate 4: Pre-Export BOQ Sign-off** | `needsReviewCount > 0` | Project Lead QS | Ensure provisional banner is acknowledged and client is informed quantities are provisional. |
| **Gate 5: Rebar Fabrication Prohibition** | Exporting Bar Cut List (BBS) | Site Engineer / Contractor | **STRICT BAN:** BBS cannot be sent to steel cutting yard without approved structural Shop Drawings. |

---

## 4. Pilot Boundary Constraints

1. **Permitted for Direct Pilot Use:**
   - Isolated spread footings with clear schedules.
   - Rectangular tied columns with explicit story elevations.
   - Slabs-on-ground and precast plank topping takeoffs.
2. **Restricted / Provisional Pilot Use:**
   - Multi-span continuous beams (requires manual confirmation of each column support width).
   - Cast-in-place wet area slabs with ambiguous cantilever/continuity detailing.
3. **Strictly Prohibited:**
   - Automatic execution of complex post-tensioned slabs or seismic dual-frame ductile detailing without full structural redesign.
