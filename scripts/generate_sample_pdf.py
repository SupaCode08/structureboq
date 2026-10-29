"""
Generates a realistic structural beam schedule PDF for testing.
"""
import os
import pymupdf as fitz

def create_sample_pdf():
    os.makedirs("public/samples", exist_ok=True)
    doc = fitz.open()
    page = doc.new_page(width=842, height=595)  # A4 Landscape

    # Add Title
    title_rect = fitz.Rect(50, 40, 792, 80)
    page.insert_textbox(title_rect, "STRUCTURAL BEAM SCHEDULE - 2-STORY RESIDENTIAL VILLA", fontsize=16, fontname="helv", color=(0.1, 0.2, 0.3))

    subtitle_rect = fitz.Rect(50, 65, 792, 95)
    page.insert_textbox(subtitle_rect, "Engineering Specification: Concrete C25/30, Rebar SD40 / Thai Standard Comptroller General Dept.", fontsize=10, fontname="helv", color=(0.4, 0.4, 0.4))

    # Add Schedule Table text
    rows = [
        "TAG | WIDTH x DEPTH | SPAN (L) | COUNT | REINFORCEMENT TOP | REINFORCEMENT BTM | REMARKS",
        "B1 | 0.20 x 0.40 m | 4.00 m | 4 | 2-DB16 | 2-DB16 | Floor Beams Story 1",
        "B2 | 0.25 x 0.50 m | 5.00 m | 2 | 3-DB20 | 3-DB20 | Main Girder Story 1",
        "B3 | 0.20 x 0.45 m | 4.50 m | 2 | 2-DB16 | 3-DB16 | Intermediate Girder",
        "RB1 | 0.20 x 0.35 m | 4.00 m | 4 | 2-DB12 | 2-DB12 | Roof Tie Beams",
        "C1 | 0.25 x 0.25 m | 3.50 m | 8 | 4-DB16 | 4-DB16 | Main RC Columns",
    ]

    y = 120
    for r in rows:
        rect = fitz.Rect(50, y, 792, y + 25)
        is_header = (y == 120)
        page.insert_textbox(rect, r, fontsize=11 if is_header else 10, fontname="courier", color=(0, 0, 0) if is_header else (0.2, 0.2, 0.2))
        y += 28

    doc.save("public/samples/beam_schedule.pdf")
    print("Created public/samples/beam_schedule.pdf")

if __name__ == "__main__":
    create_sample_pdf()
