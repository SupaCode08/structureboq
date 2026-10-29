# -*- coding: utf-8 -*-
import os as _os, sys as _sys
if _os.environ.get('FULL_BOQ') != '1': _sys.exit("dump_all_9boqs.py: processes real drawing sets. Run again with FULL_BOQ=1 to confirm.")
import sys, os, glob, xlrd

sys.stdout.reconfigure(encoding='utf-8')

base = 'C:/Users/supak/Downloads/9PlanHouse+BOQ/ไฟล์แบบบ้าน + BOQ ทั้ง 9 แบบ-ZIP'

print("=== สรุปข้อมูล BOQ มาตรฐานทั้ง 9 แบบบ้าน (ฐานรากตอกเข็ม) ===")
for folder in sorted(os.listdir(base)):
    fpath = os.path.join(base, folder)
    if not os.path.isdir(fpath): continue
    xls_files = glob.glob(os.path.join(fpath, '*.xls'))
    if not xls_files: continue
    
    wb = xlrd.open_workbook(xls_files[0])
    # Pick sheet with 'ตอกเข็ม' or 'ตอกเสา'
    pile_sheet_name = None
    for s in wb.sheet_names():
        if 'ตอก' in s and 'ไม่' not in s:
            pile_sheet_name = s
            break
    if not pile_sheet_name:
        pile_sheet_name = wb.sheet_names()[0]
    
    sh = wb.sheet_by_name(pile_sheet_name)
    
    piles, exc, sand, lean, conc, form = '-', '-', '-', '-', '-', '-'
    rb6, rb9, db12, db16, db20, wire = '-', '-', '-', '-', '-', '-'
    
    for r in range(min(50, sh.nrows)):
        row = sh.row_values(r)
        desc = str(row[1]).strip() if len(row) > 1 else ''
        qty = row[2] if len(row) > 2 and row[2] != '' else '-'
        if isinstance(qty, float): qty = f"{qty:.2f}"
        
        if 'เสาเข็ม' in desc: piles = qty
        elif 'ขุดดิน' in desc: exc = qty
        elif 'ทราย' in desc: sand = qty
        elif 'คอนกรีตหยาบ' in desc: lean = qty
        elif 'คอนกรีตโครงสร้าง' in desc or '1:2:4' in desc: conc = qty
        elif 'ไม้แบบ' in desc and ('ลบ.ฟ.' in str(row[3]) or 'ตร.ม.' in str(row[3])): form = qty
        elif 'Dia   6' in desc or 'Dia 6' in desc: rb6 = qty
        elif 'Dia   9' in desc or 'Dia 9' in desc: rb9 = qty
        elif 'Dia   12' in desc or 'Dia 12' in desc: db12 = qty
        elif 'Dia   16' in desc or 'Dia 16' in desc: db16 = qty
        elif 'Dia   20' in desc or 'Dia 20' in desc: db20 = qty
        elif 'ลวดผูกเหล็ก' in desc: wire = qty
        
    print(f"\n[{folder}] Sheet: {pile_sheet_name}")
    print(f"  เสาเข็ม={piles} | ดินขุด={exc} | ทราย={sand} | ลีน={lean} | คอนกรีต={conc} m3 | ไม้แบบ={form}")
    print(f"  RB6={rb6} kg | RB9={rb9} kg | DB12={db12} kg | DB16={db16} kg | DB20={db20} kg | ลวดผูก={wire} kg")
