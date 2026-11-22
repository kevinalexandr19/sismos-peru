# Sismos del Perú · mapa interactivo

Mapa web 2D de los sismos reportados por el **Instituto Geofísico del Perú (IGP) – Centro Sismológico Nacional**, inspirado en el mapa de sismos del USGS. Se publica en GitHub Pages y se actualiza automáticamente.

**Sitio:** https://kevinalexandr19.github.io/sismos-peru/

## Motivación

El portal del IGP presenta los reportes sísmicos de uno en uno. Esta aplicación surge como una herramienta complementaria que recopila los datos publicados por el IGP y muestra todos los registros disponibles a la vez: en un mapa, en un catálogo filtrable y en estadísticas. Además, superpone las fallas activas (información que el portal del IGP no muestra), junto con límites de placas, ciudades, carreteras y límites departamentales, para ver cada sismo en su contexto tectónico. No reemplaza al IGP, que sigue siendo la fuente oficial de información sísmica del Perú.

## Funciones

- Catálogo de sismos reportados por el IGP desde 2019 (código, fecha y hora local/UTC, magnitud, profundidad, epicentro, referencia, intensidad y enlace al reporte acelerométrico en PDF).
- Fechas: últimas 24 h, 7 días, 30 días o 12 meses; un día, un mes o un año concretos (con flechas para avanzar o retroceder); un rango personalizado o todo el catálogo.
- Filtros por magnitud mínima, profundidad (superficial ≤ 60 km, intermedia 61–300 km, profunda > 300 km), región del epicentro, epicentro en tierra o en el mar, y texto libre.
- Pestaña **Estadísticas e insights**: indicadores, textos automáticos (mayor sismo, mayor intensidad, región más activa, día más activo, comparación con el periodo anterior con prueba binomial, valor b) y gráficos (sismos por hora/día/semana/mes, magnitud en el tiempo, Gutenberg–Richter, sección de profundidad, distribución de profundidades, sismos por región).
- Modo claro y modo oscuro (sigue la preferencia del sistema; se puede cambiar con el botón ☾/☀ y se recuerda).
- Capas: límites y nombres departamentales, ciudades principales y secundarias, carreteras y autopistas, fallas activas (nombre al pasar el cursor), límites de placas, mapa de calor y cinco mapas base.
- Ventanas flotantes (capas, leyenda, resumen) que se ocultan una a una o todas a la vez.
- Exportación a PNG de la vista actual del mapa, sin la interfaz, con título, resumen de datos, leyenda, escala y norte.
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
| Fallas activas | GEM Global Active Faults Database (Styron & Pagani, 2020, *Earthquake Spectra*), recortada al Perú; nombres y cinemática traducidos al español con `scripts/traducir_fallas.py` |
| Mapas base | Esri (gris claro, gris oscuro, relieve, satélite) y OpenStreetMap |
| Límites de placas | Bird (2003), modelo PB2002 |
| Departamentos | INEI, vía [juaneladio/peru-geojson](https://github.com/juaneladio/peru-geojson) |
| Ciudades y carreteras | Natural Earth 1:10m (populated places, roads), recortadas al Perú |

La región de cada sismo es el departamento que contiene el epicentro. Para los sismos en el mar o fuera del país se usa el departamento de la localidad de referencia del IGP.

En los registros de 2022–2024 la API del IGP a menudo no trae la hora UTC; en ese caso se calcula como hora local + 5 h (el Perú no usa horario de verano; la relación se cumple en todos los registros que traen ambas horas).

Las estadísticas se calculan en el navegador con los sismos filtrados. Los reportes del IGP no son un catálogo completo para magnitudes bajas, así que el valor b y la magnitud de completitud reflejan ese umbral de reporte.

Mapa informativo. Para información oficial, consulte al IGP.
