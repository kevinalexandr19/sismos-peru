# Sismos del Perú · mapa interactivo

Mapa web 2D de los sismos reportados por el **Instituto Geofísico del Perú (IGP) – Centro Sismológico Nacional**, inspirado en el mapa de sismos del USGS. Se publica en GitHub Pages y se actualiza automáticamente.

**Sitio:** https://kevinalexandr19.github.io/sismos-peru/

## Motivación

Esta aplicación es una herramienta complementaria a los productos del IGP: recopila los reportes sísmicos que publica y los reúne en un mapa, un catálogo filtrable, estadísticas y perfiles sísmicos, junto con fallas activas, volcanes, la placa de Nazca (Slab2), límites de placas, ciudades, carreteras y límites departamentales, para ver cada sismo en su contexto tectónico. No reemplaza al IGP, que es la fuente oficial de información sísmica del Perú.

## Funciones

- Catálogo de sismos reportados por el IGP desde 2019 (código, fecha y hora local/UTC, magnitud, profundidad, epicentro, referencia, intensidad y enlace al reporte acelerométrico en PDF).
- Fechas: últimas 24 h, 7 días, 30 días o 12 meses; un día, un mes o un año concretos (con flechas para avanzar o retroceder); un rango personalizado o todo el catálogo.
- Filtros por magnitud mínima, profundidad (superficial ≤ 60 km, intermedia 61–300 km, profunda > 300 km), región del epicentro, epicentro en tierra o en el mar, y texto libre.
- Pestaña **Estadísticas e insights**: indicadores, textos automáticos (mayor sismo, mayor intensidad, región más activa, día más activo, comparación con el periodo anterior con prueba binomial, valor b) y gráficos (sismos por hora/día/semana/mes, magnitud en el tiempo, Gutenberg–Richter, sección de profundidad, distribución de profundidades, sismos por región).
- Modo claro (por defecto) y modo oscuro, con el botón ☾/☀; la elección se recuerda.
- Uso en el celular: panel lateral compacto que se abre con ☰, herramientas en una fila, y perfil a media pantalla. Con el teléfono en horizontal el mapa queda a la izquierda y el perfil a la derecha; el botón «Girar» del perfil intenta girar la pantalla (en Android, en pantalla completa; en iPhone basta con girar el teléfono).
- Capas: límites y nombres departamentales, ciudades principales y secundarias, carreteras y autopistas, fallas activas (nombre al pasar el cursor), volcanes activos y potencialmente activos (por nivel de peligrosidad), límites de placas, mapa de calor y cinco mapas base.
- **Perfil sísmico (corte vertical A–A′):** se traza con dos clics en el mapa (extremos arrastrables) y una franja de 10 a 1000 km de ancho. Muestra los sismos M ≥ 4.5 proyectados en distancia–profundidad, bajo un perfil de topografía y batimetría con ciudades, volcanes y cruces de fallas (con su buzamiento aparente cuando se conoce). Incluye un deslizador de tiempo (acumulado o ventana móvil) con reproducción y las fechas elegidas siempre visibles, sincronización con el mapa, exageración vertical y exportación a PNG y CSV. El botón **🔗 Compartir** genera un enlace que abre la misma vista (corte, ancho, magnitud, colores, capas, filtros, intervalo de tiempo y encuadre del mapa), y **🎬 Video** exporta la evolución temporal del perfil como MP4 (H.264, codificado cuadro por cuadro en el navegador con WebCodecs y [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), MIT; en navegadores sin WebCodecs se graba en tiempo real).
- **Ambiente tectónico con Slab2:** cada sismo se clasifica según la posición de su hipocentro respecto de la placa de Nazca subducida (modelo Slab2; Hayes et al., 2018): cortical, interfase, intraplaca de profundidad intermedia, intraplaca profundo, o fuera del modelo. Se puede colorear y filtrar el mapa por ambiente; el perfil dibuja el techo de la placa con su incertidumbre y su base, y hay curvas de profundidad de la placa en el mapa. Detalles en la sección *Clasificación tectónica*.
- Ventanas flotantes (capas, leyenda, resumen) que se ocultan una a una o todas a la vez.
- Exportación a PNG de la vista actual del mapa, sin la interfaz, con título, resumen de datos, leyenda, escala y norte.
- Enlace directo a cada sismo (`?evento=2026-0825`) y aviso de sismos nuevos mientras la página está abierta.

## Clasificación tectónica (Slab2)

Para cada sismo se interpolan (bilinealmente) en el epicentro la profundidad del techo de la placa (`techo`), la de su base (`base` = techo + espesor / cos(buzamiento)) y la incertidumbre del modelo (`incert.`), y se compara con la profundidad del hipocentro `d`:

| Clase | Regla |
|---|---|
| Fuera del modelo | no hay placa modelada bajo el epicentro |
| Cortical (placa Sudamericana) | `d < techo − tol` y `d ≤ 70 km` |
| Sobre la placa modelada | `d < techo − tol` y `d > 70 km` |
| Interfase | `|d − techo| ≤ tol` y `techo ≤ 60 km` |
| Intraplaca (intermedia / profunda) | `techo − tol ≤ d ≤ base + tol` (profunda si `d > 300 km`) |
| Bajo la placa modelada | `d > base + tol` |

con `tol = máx(20 km, incertidumbre de Slab2)`. Si la clase cambia al mover la profundidad ±10 km, el sismo se marca *en el límite* con la otra clase. Son umbrales operativos: 60 km como límite inferior habitual de la interfase sismogénica, 70 km como espesor máximo aproximado de la corteza andina y 20 km como tolerancia del orden del error de profundidad de los catálogos rutinarios. Es una clasificación **geométrica**: depende de la calidad de la profundidad del IGP y del modelo, y no reemplaza el análisis de mecanismos focales.

La implementación de referencia está en `scripts/clasificar_slab2.py`; la del navegador (`js/slab.js`) se verificó contra ella sobre todo el catálogo. Las grillas se prepararon con `scripts/prep_slab2.py` (recorte 84–62° O, 26° S–3° N, remuestreo a 0.1°; error de interpolación frente a la grilla original de 0.05° ≤ 0.44 km).

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
| Volcanes | 17 volcanes activos y potencialmente activos evaluados por el IGP (Informe Técnico N.° 029-2022/IGP, nivel de peligrosidad); estado activo según INGEMMET; coordenadas, altitud y última erupción del Smithsonian Global Volcanism Program (`scripts/prep_volcanes.py`) |
| Topografía y batimetría del perfil | AWS Terrain Tiles (formato Terrarium; fuentes SRTM, GMTED, ETOPO1 y otras) |
| Placa de Nazca | Slab2, región Sudamérica: Hayes, G. P., et al. (2018), *Slab2, a comprehensive subduction zone geometry model*, Science 362, 58–61; datos: USGS, doi:10.5066/F7PV6JNV |
| Mapas base | Esri (gris claro, gris oscuro, relieve, satélite) y OpenStreetMap |
| Límites de placas | Bird (2003), modelo PB2002 |
| Departamentos | INEI, vía [juaneladio/peru-geojson](https://github.com/juaneladio/peru-geojson) |
| Ciudades y carreteras | Natural Earth 1:10m (populated places, roads), recortadas al Perú |

La región de cada sismo es el departamento que contiene el epicentro. Para los sismos en el mar o fuera del país se usa el departamento de la localidad de referencia del IGP.

En los registros de 2022–2024 la API del IGP a menudo no trae la hora UTC; en ese caso se calcula como hora local + 5 h (el Perú no usa horario de verano; la relación se cumple en todos los registros que traen ambas horas).

Las estadísticas se calculan en el navegador con los sismos filtrados. Los reportes del IGP no son un catálogo completo para magnitudes bajas, así que el valor b y la magnitud de completitud reflejan ese umbral de reporte.

Mapa informativo. Para información oficial, consulte al IGP.
