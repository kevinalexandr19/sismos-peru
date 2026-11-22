#!/usr/bin/env python3
"""Build data/volcanes.geojson: the 17 volcanoes evaluated by the IGP volcanic
hazard assessment (Informe Técnico N°029-2022/IGP), located with the
Smithsonian Global Volcanism Program (GVP) "Volcanoes of the World" database.

GVP values were read from the GVP WFS service (GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes
and ..._Pleistocene_Volcanoes) on 2026-11-23:
  number | GVP name | type | elevation (m) | lat | lon | last eruption year (GVP; negative = BCE)
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import update_sismos as u  # noqa: E402  (department point-in-polygon helpers)

GVP = """\
354000|Quimsachata-Oroscocha|Lava dome|3848|-14.131|-71.363|-4450|H
354001|Auquihuato, Cerro|Pyroclastic cone|5001|-15.0726|-73.1914||H
354003|Coropuna|Stratovolcano|6377|-15.52|-72.65||H
354004|Andahua-Orcopampa|Volcanic field|4713|-15.42|-72.33|1490|H
354005|Huambo|Volcanic field|4554|-15.78|-72.08|-700|H
354006|Sabancaya|Stratovolcano(es)|5960|-15.787|-71.857|2026|H
354010|Misti, El|Stratovolcano|5793|-16.2991|-71.4056|1985|H
354020|Ubinas|Stratovolcano|5608|-16.345|-70.8972|2024|H
354031|Ticsani|Lava dome(s)|5382|-16.7586|-70.5981|1800|H
354030|Huaynaputina|Stratovolcano|4679|-16.6144|-70.8542|1600|H
354040|Tutupaca|Stratovolcano(es)|5801|-17.026|-70.372|1802|H
354050|Yucamane|Stratovolcano(es)|5495|-17.184|-70.196|-1320|H
354060|Casiri, Nevados|Stratovolcano(es)|5626|-17.4852|-69.7886||H
354002|Sara Sara|Stratovolcano|5490|-15.3299|-73.4456||P
354007|Chachani Volcanic Complex|Stratovolcano|6059|-16.1792|-71.5292||P
354803|Solimana|Stratovolcano|6093|-15.4|-72.9||P
354804|Purupuruni, Cerros|Lava dome(s)|4591|-17.2587|-69.8216||P"""

# Spanish name and IGP 2022 hazard level (nivel de peligrosidad volcánica)
IGP = {
    354010: ("Misti", "Muy alta"), 354006: ("Sabancaya", "Muy alta"), 354020: ("Ubinas", "Muy alta"),
    354007: ("Chachani", "Alta"), 354031: ("Ticsani", "Alta"), 354003: ("Coropuna", "Alta"), 354030: ("Huaynaputina", "Alta"),
    354002: ("Sara Sara", "Moderada"), 354040: ("Tutupaca", "Moderada"), 354050: ("Yucamane", "Moderada"), 354803: ("Solimana", "Moderada"),
    354060: ("Casiri", "Baja"), 354804: ("Purupuruni", "Baja"),
    354004: ("Campo volcánico monogenético Andagua", "Muy baja"), 354001: ("Cerro Auquihuato", "Muy baja"),
    354000: ("Quimsachata", "Muy baja"), 354005: ("Campo volcánico monogenético Huambo", "Muy baja"),
}
# INGEMMET (2019): the ten volcanoes classed as active; the others are potentially active
ACTIVOS = {354003, 354006, 354010, 354020, 354031, 354030, 354040, 354050, 354804, 354060}
TIPO = {"Stratovolcano": "Estratovolcán", "Stratovolcano(es)": "Estratovolcán (complejo)", "Lava dome": "Domo de lava",
        "Lava dome(s)": "Domos de lava", "Volcanic field": "Campo volcánico", "Pyroclastic cone": "Cono piroclástico"}


# Ages stated in the IGP 2022 report, used where GVP gives no eruption date
IGP_EDAD = {354003: "hace ~1500 años (IGP)", 354060: "hace ~2600 años (IGP)", 354804: "hace ~5300 años (IGP)",
            354002: "hace ~14 000 años (IGP)", 354803: "hace más de 500 000 años (IGP)"}


def erupcion(num, year, epoch):
    if year == "":
        if num in IGP_EDAD:
            return IGP_EDAD[num]
        return "Holoceno, sin fecha conocida (GVP)" if epoch == "H" else "Sin erupciones holocenas confirmadas (GVP)"
    y = int(year)
    txt = f"{-y} a. C." if y < 0 else f"{y}"
    if num == 354006:
        txt += ", en erupción desde 2016"
    return txt + " (GVP)"


def main():
    deps = u.load_departments()
    feats = []
    for line in GVP.splitlines():
        num, gname, typ, elev, lat, lon, last, epoch = line.split("|")
        num = int(num)
        nombre, peligro = IGP[num]
        reg, _ = u.region_of(float(lat), float(lon), "", deps)
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
                      "properties": {"nombre": nombre, "gvp": num, "gvp_nombre": gname, "tipo": TIPO.get(typ, typ),
                                     "elevacion": int(elev), "ultima_erupcion": erupcion(num, last, epoch),
                                     "peligrosidad": peligro, "estado": "Activo" if num in ACTIVOS else "Potencialmente activo",
                                     "region": reg}})
    order = ["Muy alta", "Alta", "Moderada", "Baja", "Muy baja"]
    feats.sort(key=lambda f: (order.index(f["properties"]["peligrosidad"]), f["properties"]["nombre"]))
    with open(os.path.join(ROOT, "data", "volcanes.geojson"), "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": feats}, fh, ensure_ascii=False, indent=1)
    for f in feats:
        p = f["properties"]
        print(f'{p["nombre"]:40} {p["peligrosidad"]:9} {p["estado"]:22} {p["region"]:10} {p["elevacion"]} m  {p["ultima_erupcion"]}')
    # string used to check the transcription against the GVP service
    print("CHECK", "#".join(sorted(line.rsplit("|", 1)[0] for line in GVP.splitlines())))


if __name__ == "__main__":
    main()
