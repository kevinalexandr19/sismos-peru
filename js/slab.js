"use strict";
/* Slab2 (Hayes et al., 2018): geometry of the subducted Nazca plate and a
   geometric classification of each earthquake relative to it.
   Same rules as scripts/clasificar_slab2.py (reference implementation):
     tol = max(20 km, model uncertainty)
     no slab under the epicentre        -> fuera
     d < top - tol, d <= 70 km          -> cortical   (South American plate crust)
     d < top - tol, d > 70 km           -> sobre      (above the modelled slab; usually location/model mismatch)
     |d - top| <= tol and top <= 60 km  -> interfase  (plate contact)
     top - tol <= d <= bot + tol        -> intraplaca (d <= 300 km) / profundo (d > 300 km)
     d > bot + tol                      -> bajo       (below the modelled slab)
   An event whose class changes when its depth is moved ±10 km is flagged as
   being "en el límite" with the other class. */
(function(){
const A = window.APP, esc = A.esc, nf = A.nf;
const TOL_MIN = 20, IFACE_MAX = 60, DEEP = 300, CRUST = 70, EDGE = 10;

const CLASSES = A.SLAB_CLASSES = {
  cortical:  {name:"Cortical (placa Sudamericana)", short:"Cortical", color:"#1a9850", desc:"Por encima de la placa de Nazca, dentro de la corteza continental (≤ 70 km)."},
  interfase: {name:"Interfase (contacto entre placas)", short:"Interfase", color:"#7b3294", desc:"Junto al techo de la placa, donde este está a ≤ 60 km de profundidad."},
  intraplaca:{name:"Intraplaca, profundidad intermedia", short:"Intraplaca", color:"#f46d43", desc:"Dentro de la placa de Nazca subducida, hasta 300 km."},
  profundo:  {name:"Intraplaca profundo", short:"Profundo", color:"#2c7bb6", desc:"Dentro de la placa de Nazca, a más de 300 km."},
  sobre:     {name:"Sobre la placa modelada (> 70 km)", short:"Sobre la placa", color:"#bdbdbd", desc:"Por encima de la placa pero bajo la corteza; suele indicar un desajuste entre la ubicación y el modelo."},
  bajo:      {name:"Bajo la placa modelada", short:"Bajo la placa", color:"#8c8c8c", desc:"Por debajo de la base modelada de la placa; suele indicar un desajuste entre la ubicación y el modelo."},
  fuera:     {name:"Fuera del modelo Slab2", short:"Fuera del modelo", color:"#5e5e5e", desc:"No hay placa modelada bajo el epicentro (p. ej., al oeste de la fosa)."}
};
const ORDER = ["cortical","interfase","intraplaca","profundo","sobre","bajo","fuera"];
A.SLAB_ORDER = ORDER;

const S = A.slab = {ready:false};
function grid(arr){ const f = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) f[i] = arr[i] == null ? NaN : arr[i] / 10; return f; }
function interp(g, lat, lon){
  const fx = (lon - S.lon0) / S.dlon, fy = (lat - S.lat0) / S.dlat, i = Math.floor(fy), j = Math.floor(fx);
  if (i < 0 || j < 0 || i >= S.ny - 1 || j >= S.nx - 1) return NaN;
  const a = g[i * S.nx + j], b = g[i * S.nx + j + 1], c = g[(i + 1) * S.nx + j], d = g[(i + 1) * S.nx + j + 1];
  if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d)) return NaN;     // cell touches the model edge
  const tx = fx - j, ty = fy - i;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
S.at = (lat, lon) => ({top:interp(S.top, lat, lon), bot:interp(S.bot, lat, lon), unc:interp(S.unc, lat, lon)});
function rule(d, top, bot, tol){
  if (d < top - tol) return d <= CRUST ? "cortical" : "sobre";
  if (Math.abs(d - top) <= tol && top <= IFACE_MAX) return "interfase";
  if (d <= bot + tol) return d > DEEP ? "profundo" : "intraplaca";
  return "bajo";
}
function classify(e){
  const d = e.prof; if (d == null) return {cls:"fuera"};
  const s = S.at(e.lat, e.lon); if (isNaN(s.top)) return {cls:"fuera"};
  const tol = Math.max(TOL_MIN, s.unc || 0), cls = rule(d, s.top, s.bot, tol);
  const lo = rule(Math.max(0, d - EDGE), s.top, s.bot, tol), hi = rule(d + EDGE, s.top, s.bot, tol);
  const alt = lo !== cls ? lo : hi !== cls ? hi : null;
  return {cls, alt, top:s.top, bot:s.bot, unc:s.unc, tol, dz:d - s.top};
}
S.classify = classify;
S.text = function(e){
  const c = e.slab; if (!c) return "";
  if (c.cls === "fuera") return CLASSES.fuera.name;
  const rel = Math.abs(c.dz) < 0.5 ? "en el techo de la placa" : `${nf(Math.abs(c.dz))} km ${c.dz > 0 ? "bajo" : "sobre"} el techo de la placa`;
  return `${CLASSES[c.cls].short}${c.alt ? ` (en el límite con ${CLASSES[c.alt].short.toLowerCase()})` : ""} · ${rel} (techo a ${nf(c.top)} km; tolerancia ±${nf(c.tol)} km)`;
};

function annotate(){ if (!S.ready) return; A.ALL.forEach(e => { e.slab = classify(e); }); }

// ------------------------------------------------------------ map layer: depth contours of the slab top
const contourColor = () => A.theme === "dark" ? "#c9a7ff" : "#6a3d9a";
A.layers.slab = L.geoJSON(null, {renderer:A.renderer,
  style:f => ({color:contourColor(), weight:f.properties.prof % 100 === 0 ? 2 : 1.1, opacity:.9, dashArray:f.properties.prof % 100 === 0 ? null : "5 4"}),
  onEachFeature:(f, l) => l.bindTooltip(`Techo de la placa de Nazca a ${f.properties.prof} km de profundidad<br><span class="tip-sub">Slab2 (Hayes et al., 2018)</span>`, {sticky:true})});
const slabLabels = L.layerGroup();
A.layers.slab.on("add", () => slabLabels.addTo(A.map)); A.layers.slab.on("remove", () => slabLabels.remove());
A.LAYER_DEFS.splice(A.LAYER_DEFS.findIndex(d => d[0] === "plates"), 0, ["slab", "Profundidad de la placa de Nazca (Slab2)"]);

A.legendExtras = A.legendExtras || [];
A.legendExtras.push(() => {
  const out = [];
  if (A.colorBy === "tect" && S.ready && A.map.hasLayer(A.layers.quakes))
    out.push({replaceDepth:true, title:"Ambiente tectónico (Slab2)", items:ORDER.map(k => ({type:"dot", color:CLASSES[k].color, label:CLASSES[k].short}))});
  if (A.map.hasLayer(A.layers.slab))
    out.push({title:"Placa de Nazca (Slab2)", items:[{type:"line", color:contourColor(), width:2, label:"Techo cada 100 km"}, {type:"line", color:contourColor(), width:1.1, dash:[5,4], label:"Techo cada 20 km (< 200 km)"}]});
  return out;
});

async function load(){
  try {
    const [g, c] = await Promise.all([fetch("data/slab2_peru.json").then(r => r.json()), fetch("data/slab2_contornos.geojson").then(r => r.json())]);
    Object.assign(S, {lon0:g.lon0, lat0:g.lat0, dlon:g.dlon, dlat:g.dlat, nx:g.nx, ny:g.ny, top:grid(g.top), bot:grid(g.bot), unc:grid(g.unc), ready:true});
    A.layers.slab.addData(c);
    A.layers.slab.eachLayer(l => {                                     // one label per contour, at its midpoint
      const ll = l.getLatLngs(); if (ll.length < 6) return;
      const t = L.tooltip({permanent:true, direction:"center", className:"lbl slab-label", interactive:false}).setLatLng(ll[Math.floor(ll.length / 2)]).setContent(`${l.feature.properties.prof} km`);
      slabLabels.addLayer(t); A.labels.push({tip:t, pri:5e6});
    });
    annotate();
    if (A.drawLayersWin) A.drawLayersWin();
    A.apply();                                                          // refresh colours, popups, statistics
    if (A.redrawProfile) A.redrawProfile();
  } catch (err){ console.error("Slab2:", err); }
}
A.onDataReady = A.onDataReady || [];
A.onDataReady.push(() => { if (S.ready){ annotate(); A.apply(); } else if (!S.loading){ S.loading = true; load(); } });
A.onThemeChange = A.onThemeChange || [];
A.onThemeChange.push(() => A.layers.slab.setStyle(f => ({color:contourColor(), weight:f.properties.prof % 100 === 0 ? 2 : 1.1, opacity:.9, dashArray:f.properties.prof % 100 === 0 ? null : "5 4"})));
})();
