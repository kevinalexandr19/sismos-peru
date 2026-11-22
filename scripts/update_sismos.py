#!/usr/bin/env python3
"""Download the IGP (Instituto Geofísico del Perú) seismic catalog and write
compact JSON files for the web map.

Source endpoint (public, used by https://ultimosismo.igp.gob.pe):
    https://ultimosismo.igp.gob.pe/api/ultimo-sismo/ajaxb/{year}

Outputs
    data/anual/{year}.json  compact catalog per year (cache)
    data/sismos.json        all years merged, newest first

If a download fails, the previously stored year file is kept, so the site never
loses data because of a temporary outage.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

API = "https://ultimosismo.igp.gob.pe/api/ultimo-sismo/ajaxb/{year}"
FIRST_YEAR = int(os.environ.get("FIRST_YEAR", "2019"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
ANUAL = os.path.join(DATA, "anual")

# Bump to force a re-download of every cached year after a parsing change
SCHEMA = 3

# Column order of each event in the output files
FIELDS = ["id", "utc", "lat", "lon", "mag", "prof", "ref", "int", "pdf", "reg", "tierra"]

DEP_NAMES = {
    "AMAZONAS": "Amazonas", "ANCASH": "Áncash", "APURIMAC": "Apurímac", "AREQUIPA": "Arequipa",
    "AYACUCHO": "Ayacucho", "CAJAMARCA": "Cajamarca", "CALLAO": "Callao", "CUSCO": "Cusco",
    "HUANCAVELICA": "Huancavelica", "HUANUCO": "Huánuco", "ICA": "Ica", "JUNIN": "Junín",
    "LA LIBERTAD": "La Libertad", "LAMBAYEQUE": "Lambayeque", "LIMA": "Lima", "LORETO": "Loreto",
    "MADRE DE DIOS": "Madre de Dios", "MOQUEGUA": "Moquegua", "PASCO": "Pasco", "PIURA": "Piura",
    "PUNO": "Puno", "SAN MARTIN": "San Martín", "TACNA": "Tacna", "TUMBES": "Tumbes", "UCAYALI": "Ucayali",
}


def _norm(s):
    import unicodedata
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if unicodedata.category(c) != "Mn").upper().strip()


def load_departments():
    with open(os.path.join(DATA, "departamentos.geojson"), encoding="utf-8") as fh:
        gj = json.load(fh)
    deps = []
    for f in gj["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        deps.append((f["properties"]["NOMBDEP"], polys))
    return deps


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def region_of(lat, lon, ref, deps):
    """Department containing the epicentre; offshore or abroad events take the
    department named in the IGP reference (nearest town), else the nearest one."""
    for name, polys in deps:
        for poly in polys:
            if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
                return DEP_NAMES.get(name, name), 1
    text = _norm(ref)
    if " - " in text:
        cand = text.rsplit(" - ", 1)[1].strip()
        if cand in DEP_NAMES:
            return DEP_NAMES[cand], 0
    if "CALLAO" in text:
        return "Callao", 0
    best, bd = None, 1e18
    for name, polys in deps:
        for poly in polys:
            for x, y in poly[0][::3]:
                d = (x - lon) ** 2 + (y - lat) ** 2
                if d < bd:
                    best, bd = name, d
    return DEP_NAMES.get(best, best), 0


def fetch(year, tries=3):
    req = urllib.request.Request(
        API.format(year=year),
        headers={"User-Agent": "sismos-peru-map (GitHub Pages; +https://github.com)",
                 "Accept": "application/json"},
    )
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"{year}: {last}")


def _join(fecha, hora):
    """fecha_* holds the date and hora_* holds the time (on 1970-01-01)."""
    f = str(fecha or "")[:10]
    h = str(hora or "")
    h = h[11:19] if "T" in h else h[:8]
    if len(f) != 10 or len(h) != 8:
        return None
    try:
        return datetime.strptime(f"{f}T{h}", "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None


def utc_of(e):
    """UTC origin time. Many 2022-2024 records only carry local time; Peru is
    UTC-5 with no daylight saving (checked: local+5 h == UTC in all records
    that have both)."""
    t = _join(e.get("fecha_utc"), e.get("hora_utc"))
    if t is None:
        loc = _join(e.get("fecha_local"), e.get("hora_local"))
        if loc is None:
            return None
        t = loc + timedelta(hours=5)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def compact(raw, deps):
    out = []
    for e in raw:
        if str(e.get("publicado", "1")) != "1":
            continue
        t, lat, lon, mag = utc_of(e), num(e.get("latitud")), num(e.get("longitud")), num(e.get("magnitud"))
        if t is None or lat is None or lon is None or mag is None:
            continue
        prof = num(e.get("profundidad"))
        ref = (e.get("referencia") or "").strip()
        reg, tierra = region_of(lat, lon, ref, deps)
        out.append([
            e.get("codigo") or str(e.get("idlistasismos")),
            t, round(lat, 3), round(lon, 3), round(mag, 1),
            None if prof is None else round(prof),
            ref,
            (e.get("intensidad") or "").strip(),
            (e.get("reporte_acelerometrico_pdf") or "").strip(),
            reg, tierra,
        ])
    out.sort(key=lambda r: r[1], reverse=True)
    return out


def main():
    os.makedirs(ANUAL, exist_ok=True)
    now = datetime.now(timezone.utc)
    years = range(FIRST_YEAR, now.year + 1)
    # Always refresh the current year (and the previous one during January);
    # older years are downloaded only when missing.
    refresh = {now.year} | ({now.year - 1} if now.month == 1 else set())
    errors = []
    deps = load_departments()
    for y in years:
        path = os.path.join(ANUAL, f"{y}.json")
        if os.path.exists(path) and y not in refresh:
            with open(path, encoding="utf-8") as fh:
                cached = json.load(fh)
            if cached.get("schema") == SCHEMA and cached.get("events"):
                continue
        try:
            rows = compact(fetch(y), deps)
            if not rows:
                raise RuntimeError(f"{y}: no valid events parsed; keeping previous file")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"schema": SCHEMA, "year": y, "fields": FIELDS, "events": rows}, fh,
                          ensure_ascii=False, separators=(",", ":"))
            print(f"{y}: {len(rows)} events")
        except Exception as e:  # noqa: BLE001
            errors.append(str(e))
            print(f"WARNING {e}", file=sys.stderr)

    events = []
    for y in years:
        path = os.path.join(ANUAL, f"{y}.json")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                events += json.load(fh)["events"]
    events.sort(key=lambda r: r[1], reverse=True)
    if not events:
        print("No data available", file=sys.stderr)
        sys.exit(1)

    merged_path = os.path.join(DATA, "sismos.json")
    old_ids = None
    if os.path.exists(merged_path):
        with open(merged_path, encoding="utf-8") as fh:
            old = json.load(fh)
        old_ids = [r[0] for r in old.get("events", [])]
    if old_ids == [r[0] for r in events] and not os.environ.get("FORCE"):
        print("No new events; sismos.json unchanged")
        return
    with open(merged_path, "w", encoding="utf-8") as fh:
        json.dump({
            "source": "Instituto Geofísico del Perú (IGP) – Centro Sismológico Nacional",
            "source_url": "https://ultimosismo.igp.gob.pe/productos/reportes-sismicos",
            "updated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "fields": FIELDS,
            "events": events,
        }, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"sismos.json: {len(events)} events, latest {events[0][0]} {events[0][1]}")
    if errors:
        print("Completed with warnings: " + "; ".join(errors), file=sys.stderr)


if __name__ == "__main__":
    main()
