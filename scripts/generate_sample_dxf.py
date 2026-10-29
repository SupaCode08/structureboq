"""
Generates standard ASCII DXF files for sample testing.
"""
import os
import ezdxf

def create_dxf_sample():
    os.makedirs("public/samples", exist_ok=True)

    # 1. Villa Framing DXF (Meters)
    doc1 = ezdxf.new("R2010")
    doc1.header["$INSUNITS"] = 6  # Meters
    msp1 = doc1.modelspace()

    # Add layers
    doc1.layers.add("S-BEAM", color=3)
    doc1.layers.add("S-COLS", color=1)
    doc1.layers.add("S-GRID", color=7)
    doc1.layers.add("S-TEXT", color=2)

    # Add text annotations for beams and columns
    msp1.add_text("4-B1 0.20x0.40 L=4.00m", dxfattribs={"layer": "S-BEAM", "height": 0.25}).set_placement((2.0, 4.0))
    msp1.add_text("2-B2 0.25x0.50 L=5.00m", dxfattribs={"layer": "S-BEAM", "height": 0.25}).set_placement((0.0, 2.5))
    msp1.add_text("2-B3 0.20x0.45 L=4.50m", dxfattribs={"layer": "S-BEAM", "height": 0.25}).set_placement((6.0, 2.25))
    msp1.add_text("4-RB1 0.20x0.35 L=4.00m", dxfattribs={"layer": "S-BEAM", "height": 0.25}).set_placement((2.0, 8.0))
    msp1.add_text("8-C1 0.25x0.25 H=3.50m", dxfattribs={"layer": "S-COLS", "height": 0.25}).set_placement((0.0, 0.0))

    # Add beam lines
    msp1.add_line((0, 0), (4, 0), dxfattribs={"layer": "S-BEAM"})
    msp1.add_line((0, 4), (4, 4), dxfattribs={"layer": "S-BEAM"})

    doc1.saveas("public/samples/villa_framing.dxf")
    print("Created public/samples/villa_framing.dxf")

    # 2. Warehouse Framing DXF (Millimeters)
    doc2 = ezdxf.new("R2010")
    doc2.header["$INSUNITS"] = 4  # Millimeters
    msp2 = doc2.modelspace()
    doc2.layers.add("S-BEAM-HEAVY", color=4)
    doc2.layers.add("S-TIE-BEAM", color=5)
    doc2.layers.add("S-COLUMNS", color=1)

    msp2.add_text("2-TG1 400x1200 L=12.0m", dxfattribs={"layer": "S-BEAM-HEAVY", "height": 250}).set_placement((6000, 12000))
    msp2.add_text("8-TB1 250x500 L=6.0m", dxfattribs={"layer": "S-TIE-BEAM", "height": 250}).set_placement((3000, 0))
    msp2.add_text("10-C2 400x400 H=4.5m", dxfattribs={"layer": "S-COLUMNS", "height": 250}).set_placement((0, 0))

    doc2.saveas("public/samples/warehouse_framing.dxf")
    print("Created public/samples/warehouse_framing.dxf")

if __name__ == "__main__":
    create_dxf_sample()
