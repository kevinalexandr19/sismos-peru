# Sismos del Perú · mapa interactivo

Mapa web 2D de los sismos reportados por el **Instituto Geofísico del Perú (IGP) – Centro Sismológico Nacional**, inspirado en el mapa de sismos del USGS. Se publica en GitHub Pages y se actualiza automáticamente.

## Funciones

- Catálogo de sismos reportados por el IGP desde 2019 (código, fecha y hora local/UTC, magnitud, profundidad, epicentro, referencia, intensidad y enlace al reporte acelerométrico en PDF).
- Filtros por periodo (24 h, 7 d, 30 d, año, todo o rango personalizado), magnitud mínima, profundidad (superficial ≤ 60 km, intermedia 61–300 km, profunda > 300 km), región de referencia y texto libre.
- Símbolos escalados por magnitud y coloreados por profundidad o antigüedad; histograma de magnitudes y estadísticas del filtro activo.
- Capas: límites departamentales con nombres, fallas activas (coloreadas por cinemática), límites de placas, mapa de calor y cinco mapas base.
- Enlace directo a cada sismo (`?evento=2026-0825`) y aviso de sismos nuevos mientras la página está abierta.

## Actualización automática

La API del IGP no permite solicitudes desde otros dominios (CORS), así que la página no la consulta directamente. El workflow `.github/workflows/update.yml` se ejecuta cada 30 minutos, descarga el catálogo con `scripts/update_sismos.py`, guarda `data/sismos.json` y vuelve a publicar el sitio. GitHub puede retrasar las ejecuciones programadas en horas de alta demanda.

Fuente: `https://ultimosismo.igp.gob.pe/api/ultimo-sismo/ajaxb/{año}`

## Publicación

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → "Actualizar sismos y publicar" → Run workflow** (la primera vez).

## Datos

| Capa | Fuente |
|---|---|
| Sismos | IGP – Centro Sismológico Nacional, reportes sísmicos |
| Fallas activas | GEM Global Active Faults Database (Styron & Pagani, 2020, *Earthquake Spectra*), recortada al Perú |
| Límites de placas | Bird (2003), modelo PB2002 |
| Departamentos | INEI, vía [juaneladio/peru-geojson](https://github.com/juaneladio/peru-geojson) |

La región de cada sismo se toma del texto de referencia del IGP (localidad más cercana); los sismos en el mar llevan la región de esa localidad.

Mapa informativo. Para información oficial, consulte al IGP.
