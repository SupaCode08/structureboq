# -*- coding: utf-8 -*-
import os as _os, sys as _sys
if _os.environ.get('FULL_BOQ') != '1': _sys.exit("dump_boq1_items.py: processes real drawing sets. Run again with FULL_BOQ=1 to confirm.")
import sys
import xlrd

sys.stdout.reconfigure(encoding='utf-8')

f = 'C:/Users/supak/Downloads/9PlanHouse+BOQ/ไฟล์แบบบ้าน + BOQ ทั้ง 9 แบบ-ZIP/1 บ้านประหยัด 1/บัญชีแสดงปริมาณงาน บ้านแบบประหยัด 1.xls'
wb = xlrd.open_workbook(f)
sheet = wb.sheet_by_name('ปร.4 แบบประหยัด1(ตอกเข็ม)')

print("=== สรุปรายการโครงสร้างและสถาปัตย์ ปร.4 แบบประหยัด 1 (ตอกเข็ม) ===")
for r in range(4, 100):
    vals = sheet.row_values(r)
    col1 = str(vals[1]).strip() if len(vals) > 1 else ''
    qty = str(vals[2]).strip() if len(vals) > 2 else ''
    unit = str(vals[3]).strip() if len(vals) > 3 else ''
    if col1:
        print(f"Row {r:2d}: {col1:<50} | Qty: {qty:<8} | Unit: {unit}")
