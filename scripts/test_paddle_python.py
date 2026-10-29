# -*- coding: utf-8 -*-
import os as _os, sys as _sys
if _os.environ.get('FULL_BOQ') != '1': _sys.exit("test_paddle_python.py: processes real drawing sets. Run again with FULL_BOQ=1 to confirm.")
import sys, os, glob
import cv2
import numpy as np
import onnxruntime as ort

sys.stdout.reconfigure(encoding='utf-8')

det_path = 'node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx'
rec_path = 'node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx'
dict_path = 'node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt'

with open(dict_path, 'r', encoding='utf-8') as f:
    dict_chars = ['', *[line.strip('\r\n') for line in f], ' ']

session_opts = ort.SessionOptions()
session_opts.intra_op_num_threads = 2
det_sess = ort.InferenceSession(det_path, session_opts)
rec_sess = ort.InferenceSession(rec_path, session_opts)

print("ONNX models loaded successfully!")

def run_rec(img_crop):
    h, w = img_crop.shape[:2]
    H = 48
    W = max(16, int(round((w * H) / h)))
    resized = cv2.resize(img_crop, (W, H))
    if len(resized.shape) == 2:
        resized = cv2.cvtColor(resized, cv2.COLOR_GRAY2RGB)
    elif resized.shape[2] == 1:
        resized = cv2.cvtColor(resized, cv2.COLOR_GRAY2RGB)
    
    inp = resized.astype(np.float32) / 255.0
    inp = (inp - 0.5) / 0.5
    inp = np.transpose(inp, (2, 0, 1))[np.newaxis, :]
    
    out = rec_sess.run(None, {rec_sess.get_inputs()[0].name: inp})[0]
    preds = np.argmax(out[0], axis=-1)
    chars = []
    prev = 0
    for idx in preds:
        if idx != 0 and idx != prev:
            if idx < len(dict_chars):
                chars.append(dict_chars[idx])
        prev = idx
    return "".join(chars)

if __name__ == '__main__':
    # Test recognizing cropped title blocks
    print("\n--- Title Block Recognition Results ---")
    for i in range(1, 15):
        img = cv2.imread(f'public/house1_p{i}_tb.png')
        if img is None: continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Simple threshold and morphological ops to find text lines
        _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
        dilated = cv2.dilate(thresh, kernel, iterations=1)
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        line_texts = []
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w > 20 and h > 8:
                crop = gray[max(0, y-2):min(gray.shape[0], y+h+2), max(0, x-2):min(gray.shape[1], x+w+2)]
                txt = run_rec(crop)
                if txt:
                    line_texts.append(txt)
        print(f"Page {i:2d} Title: {' | '.join(line_texts)}")
