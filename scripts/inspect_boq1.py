# -*- coding: utf-8 -*-
import os as _os, sys as _sys
if _os.environ.get('FULL_BOQ') != '1': _sys.exit("inspect_boq1.py: processes real drawing sets. Run again with FULL_BOQ=1 to confirm.")
import sys
import xlrd

sys.stdout.reconfigure(encoding='utf-8')

f = 'C:/Users/supak/Downloads/9PlanHouse+BOQ/ไฟล์แบบบ้าน + BOQ ทั้ง 9 แบบ-ZIP/1 บ้านประหยัด 1/บัญชีแสดงปริมาณงาน บ้านแบบประหยัด 1.xls'
wb = xlrd.open_workbook(f)
print('Sheet names:', wb.sheet_names())
for name in wb.sheet_names():
    sheet = wb.sheet_by_name(name)
    print(f"\n--- Sheet: {name} ({sheet.nrows} rows) ---")
    for r in range(min(40, sheet.nrows)):
        row = [str(v).strip() for v in sheet.row_values(r) if str(v).strip() != '']
        if row:
            print(f"Row {r:2d}:", ' | '.join(row[:7]))
