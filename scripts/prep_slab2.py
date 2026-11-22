#!/usr/bin/env python3
"""Prepare the Slab2 South America model (Hayes et al., 2018) for the web app.

Inputs (USGS ScienceBase, doi:10.5066/F7PV6JNV, South America region):
    sam_slab2_dep_02.23.18.grd  depth of the slab top (km, negative down)
    sam_slab2_thk_02.23.18.grd  slab thickness (km, measured perpendicular to the slab)
    sam_slab2_unc_02.23.18.grd  depth uncertainty (km)

Outputs:
    data/slab2_peru.json         grids on 0.1° (top, bottom and uncertainty, tenths of km)
    data/slab2_contornos.geojson depth contours of the slab top

The slab bottom is computed as top + thickness / cos(dip), with the dip taken from
the gradient of the slab-top surface on the native 0.05° grid. The grid is then
subsampled to 0.1°: on random points inside the crop, bilinear interpolation on
the 0.1° grid differs from the 0.05° grid by at most 0.44 km (99th pct 0.15 km),
far below the model uncertainty (>= 2.7 km).

Usage: python scripts/prep_slab2.py <dir with the three .grd files>
"""
import json
import os
import sys

import numpy as np
import xarray as xr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else "."
LON = (-84.0, -62.0)
LAT = (-26.0, 3.0)
STEP = 2                       # 0.05° -> 0.10°
LEVELS = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 250, 300, 400, 500, 600]


def load(kind):
    name = [f for f in os.listdir(SRC) if f"_{kind}" in f and f.endswith(".grd")][0]
    ds = xr.open_dataset(os.path.join(SRC, name))
    x = ds.x.values - 360.0 if ds.x.values.max() > 180 else ds.x.values
    return x, ds.y.values, ds.z.values.astype("float64")


x, y, dep = load("dep")
_, _, thk = load("thk")
_, _, unc = load("unc")
top = -dep                                            # positive depth (km)

# dip from the gradient of the slab top (km/km); grid spacing in km
R = 6371.0088
dy_km = np.deg2rad(y[1] - y[0]) * R
dx_km = np.deg2rad(x[1] - x[0]) * R * np.cos(np.deg2rad(y))[:, None]
gy, gx = np.gradient(top, axis=(0, 1))
slope = np.hypot(gx / dx_km, gy / dy_km)
dip = np.degrees(np.arctan(slope))
bot = top + thk / np.cos(np.radians(dip))
# at the model edge the gradient is undefined (229 cells in the crop): use the thickness without dip correction
bot = np.where(np.isfinite(bot), bot, top + thk)

mx = (x >= LON[0] - 1e-9) & (x <= LON[1] + 1e-9)
my = (y >= LAT[0] - 1e-9) & (y <= LAT[1] + 1e-9)
sub = lambda a: a[np.ix_(my, mx)][::STEP, ::STEP]
xs, ys = x[mx][::STEP], y[my][::STEP]
T, B, U = sub(top), sub(bot), sub(unc)


def pack(a):
    return [None if not np.isfinite(v) else int(round(v * 10)) for v in a.ravel()]   # tenths of km, row-major (lat, lon)


out = {
    "source": "Slab2, South America (Hayes et al., 2018, Science 362:58-61; USGS doi:10.5066/F7PV6JNV)",
    "units": "décimas de km; fila = latitud (de sur a norte), columna = longitud (de oeste a este)",
    "lon0": round(float(xs[0]), 4), "lat0": round(float(ys[0]), 4),
    "dlon": round(float(xs[1] - xs[0]), 4), "dlat": round(float(ys[1] - ys[0]), 4),
    "nx": int(len(xs)), "ny": int(len(ys)),
    "top": pack(T), "bot": pack(B), "unc": pack(U),
}
with open(os.path.join(ROOT, "data", "slab2_peru.json"), "w") as fh:
    json.dump(out, fh, separators=(",", ":"))

# contours of the slab top on the native grid
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

xc, yc, tc = x[mx], y[my], top[np.ix_(my, mx)]
cs = plt.contour(xc, yc, np.ma.masked_invalid(tc), levels=LEVELS)
feats = []
for lev, segs in zip(cs.levels, cs.allsegs):
    for seg in segs:
        if len(seg) < 4:
            continue
        coords = [[round(float(a), 3), round(float(b), 3)] for a, b in seg[::2]]
        feats.append({"type": "Feature", "properties": {"prof": int(lev)}, "geometry": {"type": "LineString", "coordinates": coords}})
with open(os.path.join(ROOT, "data", "slab2_contornos.geojson"), "w") as fh:
    json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))

print(f"grid {out['ny']}x{out['nx']} from ({out['lon0']}, {out['lat0']}) step {out['dlon']}°; "
      f"valid {int(np.isfinite(T).sum())} cells; top {np.nanmin(T):.1f}-{np.nanmax(T):.1f} km; "
      f"bottom-top {np.nanmin(B - T):.1f}-{np.nanmax(B - T):.1f} km; dip {np.nanmin(dip[np.ix_(my, mx)]):.1f}-{np.nanmax(dip[np.ix_(my, mx)]):.1f}°; "
      f"contours {len(feats)}")
