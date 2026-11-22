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
from datetime import datetime, timezone

API = "https://ultimosismo.igp.gob.pe/api/ultimo-sismo/ajaxb/{year}"
FIRST_YEAR = int(os.environ.get("FIRST_YEAR", "2019"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
ANUAL = os.path.join(DATA, "anual")

# Column order of each event in the output files
FIELDS = ["id", "utc", "lat", "lon", "mag", "prof", "ref", "int", "pdf"]


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


def utc_of(e):
    """fecha_utc holds the date and hora_utc holds the time (on 1970-01-01)."""
    f = str(e.get("fecha_utc") or "")[:10]
    h = str(e.get("hora_utc") or "")
    h = h[11:19] if "T" in h else h[:8]
    if len(f) != 10 or len(h) != 8:
        return None
    return f"{f}T{h}Z"


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def compact(raw):
    out = []
    for e in raw:
        if str(e.get("publicado", "1")) != "1":
            continue
        t, lat, lon, mag = utc_of(e), num(e.get("latitud")), num(e.get("longitud")), num(e.get("magnitud"))
        if t is None or lat is None or lon is None or mag is None:
            continue
        prof = num(e.get("profundidad"))
        out.append([
            e.get("codigo") or str(e.get("idlistasismos")),
            t, round(lat, 3), round(lon, 3), round(mag, 1),
            None if prof is None else round(prof),
            (e.get("referencia") or "").strip(),
            (e.get("intensidad") or "").strip(),
            (e.get("reporte_acelerometrico_pdf") or "").strip(),
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
    for y in years:
        path = os.path.join(ANUAL, f"{y}.json")
        if os.path.exists(path) and y not in refresh:
            continue
        try:
            rows = compact(fetch(y))
            if not rows and os.path.exists(path):
                raise RuntimeError("empty response; keeping previous file")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"year": y, "fields": FIELDS, "events": rows}, fh,
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
