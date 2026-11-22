#!/usr/bin/env python3
"""Reference implementation of the tectonic classification used in js/slab.js.

For each earthquake the slab-top depth (top), slab-bottom depth (bot) and model
uncertainty (unc) are interpolated bilinearly from data/slab2_peru.json at the
epicentre, and the hypocentre depth d is compared with them:

    tol = max(20 km, unc)
    no slab under the epicentre            -> "fuera"      (outside the Slab2 model)
    d < top - tol and d <= 70 km           -> "cortical"   (South American plate crust)
    d < top - tol and d > 70 km            -> "sobre"      (above the modelled slab, below the crust:
                                                            usually a location/model mismatch)
    |d - top| <= tol and top <= 60 km      -> "interfase"  (plate contact)
    top - tol <= d <= bot + tol, d <= 300  -> "intraplaca" (intermediate-depth, within the Nazca slab)
    top - tol <= d <= bot + tol, d > 300   -> "profundo"   (deep, within the slab)
    d > bot + tol                          -> "bajo"       (below the modelled slab)

These are operational thresholds: 60 km is a common down-dip limit of the
seismogenic plate interface, 70 km an upper bound for the Andean crustal
thickness, and 20 km a tolerance of the order of hypocentral depth errors of
routine catalogues, widened to the Slab2 uncertainty where it is larger.
The result is a geometric estimate, not a substitute for focal mechanisms.

Usage: python scripts/clasificar_slab2.py  -> prints counts by class (M >= 4.5)
"""
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOL_MIN, IFACE_MAX, DEEP, CRUST = 20.0, 60.0, 300.0, 70.0


def load():
    with open(os.path.join(ROOT, "data", "slab2_peru.json")) as fh:
        return json.load(fh)


def interp(S, key, lat, lon):
    fx = (lon - S["lon0"]) / S["dlon"]
    fy = (lat - S["lat0"]) / S["dlat"]
    i, j = math.floor(fy), math.floor(fx)
    if i < 0 or j < 0 or i >= S["ny"] - 1 or j >= S["nx"] - 1:
        return None
    a = S[key]
    v = [a[i * S["nx"] + j], a[i * S["nx"] + j + 1], a[(i + 1) * S["nx"] + j], a[(i + 1) * S["nx"] + j + 1]]
    if any(t is None for t in v):
        return None                      # cell touches the model edge: treat as outside
    tx, ty = fx - j, fy - i
    return ((v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty) / 10.0


def classify(S, lat, lon, d):
    top = interp(S, "top", lat, lon)
    if top is None or d is None:
        return "fuera", None
    bot, unc = interp(S, "bot", lat, lon), interp(S, "unc", lat, lon)
    tol = max(TOL_MIN, unc)
    if d < top - tol:
        c = "cortical" if d <= CRUST else "sobre"
    elif abs(d - top) <= tol and top <= IFACE_MAX:
        c = "interfase"
    elif d <= bot + tol:
        c = "profundo" if d > DEEP else "intraplaca"
    else:
        c = "bajo"
    return c, {"top": top, "bot": bot, "unc": unc, "dz": d - top}


if __name__ == "__main__":
    S = load()
    with open(os.path.join(ROOT, "data", "sismos.json")) as fh:
        E = json.load(fh)["events"]
    big = [e for e in E if e[4] >= 4.5]
    c = Counter(classify(S, e[2], e[3], e[5])[0] for e in big)
    print(f"M>=4.5: {len(big)} events")
    for k in ["cortical", "interfase", "intraplaca", "profundo", "sobre", "bajo", "fuera"]:
        print(f"  {k:11s} {c[k]:5d}  {100 * c[k] / len(big):5.1f}%")
    with open("/tmp/clases_ref.json", "w") as fh:
        json.dump({e[0]: classify(S, e[2], e[3], e[5])[0] for e in E}, fh)
