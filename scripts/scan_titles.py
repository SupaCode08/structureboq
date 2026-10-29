# -*- coding: utf-8 -*-
import os as _os, sys as _sys
if _os.environ.get('FULL_BOQ') != '1': _sys.exit("scan_titles.py: processes real drawing sets. Run again with FULL_BOQ=1 to confirm.")
import sys, os
sys.path.insert(0, os.path.abspath('.'))
import cv2
from scripts.test_paddle_python import run_rec

sys.stdout.reconfigure(encoding='utf-8')

for i in range(1, 15):
    img = cv2.imread(f'public/house1_p{i}.png', cv2.IMREAD_GRAYSCALE)
    h, w = img.shape
    patch = img[int(h*0.82):int(h*0.96), int(w*0.35):int(w*0.70)]
    _, thresh = cv2.threshold(patch, 200, 255, cv2.THRESH_BINARY_INV)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 3))
    dilated = cv2.dilate(thresh, kernel, iterations=1)
    contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    txts = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if cw > 20 and ch > 8:
            crop = patch[max(0, y-2):min(patch.shape[0], y+ch+2), max(0, x-2):min(patch.shape[1], x+cw+2)]
            t = run_rec(crop)
            if t: txts.append(t)
    joined = ' | '.join(txts[:4])
    print(f'Page {i:2d} Title: {joined}')
