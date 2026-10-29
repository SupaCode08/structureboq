# -*- coding: utf-8 -*-
import os as _os, sys as _sys
if _os.environ.get('FULL_BOQ') != '1': _sys.exit("test_clusters.py: processes real drawing sets. Run again with FULL_BOQ=1 to confirm.")
import sys
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')

# Coordinates from morphology in house1_p9_fullplan.png
pts = [
    (784, 194), (797, 194), (1059, 193), (1073, 193), (507, 195), (519, 195),
    (784, 287), (797, 287), (506, 288), (519, 288), (506, 302), (519, 302),
    (784, 208), (797, 208), (1059, 207), (1073, 207)
]

# Let's inspect unique X and unique Y clusters with 15px tolerance
xs = sorted(list(set([p[0] for p in pts])))
ys = sorted(list(set([p[1] for p in pts])))

def cluster(vals, tol=25):
    res = []
    for v in vals:
        if not res or v - res[-1][-1] > tol:
            res.append([v])
        else:
            res[-1].append(v)
    return [int(np.mean(c)) for c in res]

cx = cluster(xs)
cy = cluster(ys)
print('X clusters:', cx)
print('Y clusters:', cy)
