#!/usr/bin/env python3
"""Add Spanish names and descriptions to data/fallas_activas.geojson.

The GEM Global Active Faults database mixes English names ("CAYESH FAULT
SYSTEM", "MANU THRUST"), snake_case ("EL_HUEVO_FAULT") and Spanish names
("Falla Cusco"). This script writes, for every feature:
    nombre  Spanish name (or "" if the fault has no name)
    tipo    Spanish kinematic description, e.g. "Falla dextral con componente normal"
    clase   style class: inversa, normal, dextral, sinistral, rumbo, subduccion, otra
    fuente  Spanish name of the source catalogue
    buz_dir dip direction with Spanish cardinal points
The original English fields are kept. Safe to run more than once.
"""
import json
import os
import re

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fallas_activas.geojson")

# Names that are not "<name> FAULT" / "<name> FAULT SYSTEM"
SPECIAL = {
    "EASTERN PERU THRUST FRONT": "Frente de cabalgamiento del este del Perú",
    "CORDILLERA BLANCA DETACHMENT": "Despegue de la Cordillera Blanca",
    "GUAYLLABAMBA DEPRESSION": "Depresión de Guayllabamba",
    "GUAYAQUIL ALGECIRAS FAULT SYSTEM": "Sistema de fallas Guayaquil-Algeciras",
    "Santa Rosa segmento": "Falla Santa Rosa (segmento)",
    "Zona de Falla de la Cordillera Blanca": "Zona de falla de la Cordillera Blanca",
    "HUANCAYO FAUT": "Falla Huancayo",
    "MANU THRUST": "Cabalgamiento del Manu",
}
LOWER = {"de", "del", "la", "las", "los", "y", "el"}
ACCENTS = {"Rio": "Río", "Peru": "Perú", "Cuzco": "Cusco", "Bahia": "Bahía", "Canaveral": "Cañaveral",
           "Hollin": "Hollín", "Giron": "Girón", "Jambeli": "Jambelí", "Quininde": "Quinindé",
           "Enriquez": "Enríquez", "Mana": "Maná", "Angel": "Ángel"}


def title_es(s):
    """Title case that keeps Spanish particles in lower case (except first word)."""
    words = s.split()
    out = []
    for i, w in enumerate(words):
        parts = []
        for p in w.split("-"):
            lw = p.lower()
            if i > 0 and lw in LOWER:
                parts.append(lw)
            else:
                t = p[:1].upper() + p[1:].lower() if p.isupper() or p.islower() else p
                parts.append(ACCENTS.get(t, t))
        out.append("-".join(parts))
    return " ".join(out)


def nombre_es(raw):
    if not raw:
        return ""
    # "\x96" is a stray Windows-1252 en dash next to a hyphen in the source
    s = raw.replace("\x96", "").replace("_", " ").strip()
    s = re.sub(r"\s*-\s*", "-", s)
    if raw in SPECIAL:
        return SPECIAL[raw]
    if s in SPECIAL:
        return SPECIAL[s]
    if re.match(r"(?i)^sistema de fallas\s", s):
        return "Sistema de fallas " + s[len("sistema de fallas "):]
    if re.match(r"(?i)^(falla|zona de falla)\b", s):
        return " ".join(ACCENTS.get(w, w) for w in (s[0].upper() + s[1:]).split())
    m = re.match(r"(?i)^(.*?)\s+fault\s+system$", s)
    if m:
        return "Sistema de fallas " + title_es(m.group(1))
    m = re.match(r"(?i)^(.*?)\s+fau(l)?t$", s)
    if m:
        return "Falla " + title_es(m.group(1))
    m = re.match(r"(?i)^(.*?)\s+thrust$", s)
    if m:
        return "Cabalgamiento " + title_es(m.group(1))
    return "Falla " + title_es(s)          # bare names in the database are fault names


BASE = {
    "Reverse": ("inversa", "inversa"),
    "Normal": ("normal", "normal"),
    "Dextral": ("dextral", "dextral"),
    "Sinistral": ("sinistral", "sinistral"),
    "Strike-Slip": ("de rumbo", "rumbo"),
}
COMPONENT = {"Reverse": "inversa", "Normal": "normal", "Dextral": "dextral",
             "Sinistral": "sinistral", "Strike-Slip": "de rumbo"}


def tipo_es(slip):
    """Return (Spanish description, style class)."""
    if not slip:
        return "Falla de cinemática no especificada", "otra"
    if slip == "Subduction_Thrust":
        return "Cabalgamiento de subducción (fosa)", "subduccion"
    if slip.endswith("_Transform"):
        sense = slip.split("_")[0]
        return f"Falla transformante {BASE[sense][0]}", BASE[sense][1]
    for main in sorted(BASE, key=len, reverse=True):          # "Strike-Slip" before "Slip"
        if slip == main:
            return f"Falla {BASE[main][0]}", BASE[main][1]
        if slip.startswith(main + "-"):
            rest = slip[len(main) + 1:]
            return f"Falla {BASE[main][0]} con componente {COMPONENT.get(rest, rest.lower())}", BASE[main][1]
    return f"Falla ({slip})", "otra"


FUENTE = {
    "Active Tectonics of the Andes": "Tectónica Activa de los Andes (Veloza et al., 2012)",
    "SARA": "Proyecto SARA – Riesgo Sísmico de Sudamérica (GEM)",
}
DIRS = {"N": "N", "NE": "NE", "E": "E", "SE": "SE", "S": "S", "SW": "SO", "W": "O", "NW": "NO", "VERTICAL": "vertical"}


def main():
    with open(PATH, encoding="utf-8") as fh:
        gj = json.load(fh)
    for f in gj["features"]:
        p = f["properties"]
        p["nombre"] = nombre_es(p.get("name"))
        p["tipo"], p["clase"] = tipo_es(p.get("slip_type"))
        p["fuente"] = FUENTE.get(p.get("catalog_name"), p.get("catalog_name") or "GEM GAF-DB")
        p["buz_dir"] = DIRS.get(p.get("dip_dir"), p.get("dip_dir"))
        if p["clase"] == "subduccion" and not p["nombre"]:
            lat_max = max(c[1] for c in f["geometry"]["coordinates"])
            p["nombre"] = "Fosa Perú–Chile" if lat_max < -3 else "Fosa Colombia–Ecuador"
    with open(PATH, "w", encoding="utf-8") as fh:
        json.dump(gj, fh, ensure_ascii=False, separators=(",", ":"))
    names = sorted({(f["properties"].get("name"), f["properties"]["nombre"]) for f in gj["features"] if f["properties"].get("name")})
    for en, es in names:
        print(f"{en!r:45} -> {es}")
    tipos = sorted({(f["properties"].get("slip_type"), f["properties"]["tipo"], f["properties"]["clase"]) for f in gj["features"]}, key=str)
    for t in tipos:
        print(t)


if __name__ == "__main__":
    main()
