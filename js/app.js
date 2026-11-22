"use strict";
/* Sismos del Perú – main application (map, filters, list, floating windows).
   Shared state lives in window.APP so stats.js and export.js can use it. */
const APP = window.APP = {};

// ---------------------------------------------------------------- helpers
const $ = s => document.querySelector(s);
const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const LIMA = -5 * 3600e3;                      // Peru: UTC-5, no daylight saving
const DAY = 864e5;
const p2 = n => String(n).padStart(2, "0");
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const limaParts = ms => { const d = new Date(ms + LIMA); return {y:d.getUTCFullYear(), m:d.getUTCMonth()+1, d:d.getUTCDate(), h:d.getUTCHours(), mi:d.getUTCMinutes(), s:d.getUTCSeconds()}; };
const limaStart = (y, m = 1, d = 1) => Date.UTC(y, m - 1, d, 5, 0, 0);   // 00:00 Lima in UTC ms
const ymd = ms => { const p = limaParts(ms); return `${p.y}-${p2(p.m)}-${p2(p.d)}`; };
const parseYMD = s => { const [y, m, d] = s.split("-").map(Number); return limaStart(y, m, d); };
function fmtLocal(ms, sec = true){ const p = limaParts(ms); return `${p2(p.d)}/${p2(p.m)}/${p.y} ${p2(p.h)}:${p2(p.mi)}${sec ? ":" + p2(p.s) : ""}`; }
const fmtDate = ms => { const p = limaParts(ms); return `${p2(p.d)}/${p2(p.m)}/${p.y}`; };
const fmtUTC = ms => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
function ago(ms){
  const s = (Date.now() - ms) / 1000;
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < DAY / 1000) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  if (d < 60) return `hace ${d} día${d > 1 ? "s" : ""}`;
  const mo = Math.round(d / 30.44);
  return mo < 24 ? `hace ${mo} meses` : `hace ${Math.round(d / 365.25)} años`;
}
const nf = (x, dec = 0) => x.toLocaleString("es-PE", {minimumFractionDigits:dec, maximumFractionDigits:dec});
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const depthClass = p => p == null ? "?" : p <= 60 ? "s" : p <= 300 ? "i" : "p";
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toast._h); toast._h = setTimeout(() => t.style.display = "none", 5000); }
Object.assign(APP, {$, norm, LIMA, DAY, limaParts, limaStart, fmtLocal, fmtDate, fmtUTC, ago, nf, esc, depthClass, toast, MESES});

// ---------------------------------------------------------------- symbology
const DEPTH_COLORS = [[30,"#d7301f","0–30 km"],[60,"#fc8d3c","31–60 km"],[150,"#f2c12e","61–150 km"],[300,"#41ab5d","151–300 km"],[Infinity,"#2c7fb8","> 300 km"]];
const AGE_COLORS = [[1,"#c51b7d","Últimas 24 h"],[7,"#f1a340","Última semana"],[30,"#f7e04b","Último mes"],[365,"#9ecae1","Último año"],[Infinity,"#bdbdbd","Más antiguos"]];
APP.colorBy = "depth";
const depthColor = p => p == null ? "#999" : DEPTH_COLORS.find(c => p <= c[0])[1];
function colorOf(e){
  if (APP.colorBy === "age"){ const days = (Date.now() - e.t) / DAY; return AGE_COLORS.find(c => days <= c[0])[1]; }
  return depthColor(e.prof);
}
const radiusOf = m => Math.min(26, Math.max(3, Math.pow(1.75, m - 1.2)));
const lightBg = c => ["#f7e04b","#f2c12e","#9ecae1","#bdbdbd"].includes(c);
const FAULT_STYLE = {Subduction_Thrust:["#111",3,"Subducción (fosa)"],Reverse:["#c0392b",1.8,"Inversa"],Normal:["#1f5fbf",1.8,"Normal"],Dextral:["#1a9850",1.8,"Dextral"],Sinistral:["#8e44ad",1.8,"Sinistral"]};
const faultStyleOf = t => { const k = Object.keys(FAULT_STYLE).find(k => (t || "").startsWith(k)); return k ? FAULT_STYLE[k] : ["#7f6a55",1.4,"Otra / sin datos"]; };
const SLIP_ES = {Reverse:"inversa",Normal:"normal",Dextral:"dextral",Sinistral:"sinistral",Subduction_Thrust:"cabalgamiento de subducción",Blind_Thrust:"cabalgamiento ciego",Anticline:"anticlinal",Syncline:"sinclinal"};
const slipEs = t => t ? t.split("-").map(x => SLIP_ES[x] || x.toLowerCase()).join("–") : "no especificada";
const ROAD_STYLE = {autopista:{color:"#c2410c",weight:3,label:"Autopista / vía expresa"}, principal:{color:"#7c5a2e",weight:1.9,label:"Carretera principal"}, secundaria:{color:"#a4906f",weight:1.1,dashArray:"4 3",label:"Carretera secundaria"}};
Object.assign(APP, {DEPTH_COLORS, AGE_COLORS, colorOf, depthColor, radiusOf, FAULT_STYLE, ROAD_STYLE});

// ---------------------------------------------------------------- map & layers
const map = APP.map = L.map("map", {preferCanvas:true, worldCopyJump:true, zoomSnap:.5}).setView([-9.3,-75.5], 5);
const tileOpts = {crossOrigin:"anonymous"};          // needed to export the basemap to PNG
const BASES = APP.BASES = {
  topo:{name:"Relieve (Esri)", layer:L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",{...tileOpts,maxZoom:18,attribution:"Tiles © Esri"}), credit:"Esri World Topo"},
  light:{name:"Claro (CARTO)", layer:L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{...tileOpts,maxZoom:19,attribution:"© OpenStreetMap, © CARTO"}), credit:"© OpenStreetMap, © CARTO"},
  osm:{name:"OpenStreetMap", layer:L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{...tileOpts,maxZoom:19,attribution:"© OpenStreetMap"}), credit:"© OpenStreetMap"},
  sat:{name:"Satélite (Esri)", layer:L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{...tileOpts,maxZoom:18,attribution:"Imagery © Esri"}), credit:"Esri World Imagery"},
  dark:{name:"Oscuro (CARTO)", layer:L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{...tileOpts,maxZoom:19,attribution:"© OpenStreetMap, © CARTO"}), credit:"© OpenStreetMap, © CARTO"}
};
APP.base = "light"; BASES.light.layer.addTo(map);
map.createPane("quakes").style.zIndex = 420;        // only for the "latest quake" pulse marker
// One canvas for every vector layer: with one canvas per pane the top canvas would
// swallow all mouse events and hide tooltips/clicks of the layers below it.
const R = APP.renderer = L.canvas({padding:.3});

const L_ = APP.layers = {};
L_.quakes = L.layerGroup().addTo(map);
L_.heat = L.heatLayer([], {radius:18, blur:16, maxZoom:9, minOpacity:.25});
L_.deps = L.geoJSON(null, {renderer:R, style:{color:"#5b6470", weight:1.1, fill:true, fillOpacity:0, dashArray:"4 3"}}).addTo(map);
L_.depLabels = L.layerGroup().addTo(map);
L_.roads = L.geoJSON(null, {renderer:R, style:f => ({...ROAD_STYLE[f.properties.clase], opacity:.85}),
  onEachFeature:(f, l) => l.bindTooltip(ROAD_STYLE[f.properties.clase].label + (f.properties.nombre ? `: ${esc(f.properties.nombre)}` : ""), {sticky:true})}).addTo(map);
L_.citiesMain = L.layerGroup().addTo(map);
L_.citiesSec = L.layerGroup().addTo(map);
L_.faults = L.geoJSON(null, {renderer:R,
  style:f => { const s = faultStyleOf(f.properties.slip_type); return {color:s[0], weight:s[1], opacity:.85}; },
  onEachFeature:(f, l) => {
    const p = f.properties, name = p.name ? titleCase(p.name.replace(/_/g, " ")) : null;
    l.bindTooltip(name ? `<b>${esc(name)}</b><br><span style="color:#666">Falla ${esc(slipEs(p.slip_type))}</span>`
                       : `Falla sin nombre<br><span style="color:#666">${esc(slipEs(p.slip_type))}</span>`, {sticky:true, className:"fault-tip"});
    l.bindPopup(`<div class="pop"><h3>${esc(name || "Falla sin nombre")}</h3><div class="sub">Falla activa</div><table>
      <tr><td>Cinemática</td><td>${esc(slipEs(p.slip_type))}</td></tr>
      ${p.net_slip_rate ? `<tr><td>Tasa de desliz.</td><td>${esc(p.net_slip_rate)} mm/a</td></tr>` : ""}
      ${p.average_dip ? `<tr><td>Buzamiento</td><td>${esc(p.average_dip)}° ${esc(p.dip_dir || "")}</td></tr>` : ""}
      <tr><td>Fuente</td><td>${esc(p.catalog_name || "GEM GAF-DB")}</td></tr></table></div>`);
    const w = faultStyleOf(p.slip_type)[1];
    l.on("mouseover", () => { l.setStyle({weight:w + 2.5, opacity:1}); });
    l.on("mouseout", () => L_.faults.resetStyle(l));
  }}).addTo(map);
L_.plates = L.geoJSON(null, {renderer:R, style:{color:"#e8590c", weight:2.2, opacity:.8, dashArray:"8 5"},
  onEachFeature:(f, l) => l.bindTooltip(`Límite de placas: ${esc(f.properties.Name || "")}`, {sticky:true})});
const titleCase = s => s.toLowerCase().replace(/(^|[\s(-])\S/g, c => c.toUpperCase());
APP.titleCase = titleCase;
// drawing order inside the shared canvas, bottom to top
function restack(){
  ["deps","roads","plates","faults","citiesMain","citiesSec","quakes"].forEach(k => {
    if (map.hasLayer(L_[k])) L_[k].eachLayer(l => l.bringToFront && l.bringToFront());
  });
}
APP.restack = restack;
APP.LAYER_DEFS = [
  ["quakes","Sismos"],["heat","Mapa de calor de sismos"],["deps","Límites departamentales"],["depLabels","Nombres de departamentos"],
  ["citiesMain","Ciudades principales"],["citiesSec","Ciudades secundarias"],["roads","Carreteras y autopistas"],
  ["faults","Fallas activas"],["plates","Límites de placas"]
];
L.control.scale({imperial:false, position:"bottomleft"}).addTo(map);

// label visibility by zoom (the layer checkbox decides whether labels exist at all)
function labelZoom(){
  const z = map.getZoom(), c = map.getContainer().classList;
  c.toggle("hide-dep", z < 5.5); c.toggle("hide-main", z < 5); c.toggle("hide-sec", z < 7);
  declutter();
}
// hide labels that would overlap a higher-priority one (bigger cities first, then departments)
APP.labels = [];
function declutter(){
  const placed = [], pad = 2;
  [...APP.labels].sort((a, b) => b.pri - a.pri).forEach(({tip}) => {
    const el = tip.getElement && tip.getElement(); if (!el) return;
    el.style.visibility = "";
    if (getComputedStyle(el).display === "none") return;
    const r = el.getBoundingClientRect(); if (!r.width) return;
    const hit = placed.some(q => r.left < q.right + pad && r.right > q.left - pad && r.top < q.bottom + pad && r.bottom > q.top - pad);
    if (hit) el.style.visibility = "hidden"; else placed.push(r);
  });
}
APP.declutter = declutter;
map.on("zoomend", labelZoom); map.on("moveend layeradd layerremove", () => requestAnimationFrame(declutter)); labelZoom();

// ---------------------------------------------------------------- floating windows
function makeWin(id, title, position){
  const ctl = L.control({position});
  ctl.onAdd = () => {
    const d = L.DomUtil.create("div", "win " + id);
    d.innerHTML = `<div class="win-h"><span>${title}</span><button title="Ocultar" aria-label="Ocultar ${title}">×</button></div><div class="win-b"></div>`;
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
    d.querySelector(".win-h button").onclick = () => setWin(id, false);
    return d;
  };
  ctl.addTo(map);
  return ctl;
}
const WINS = APP.WINS = {
  layers:{ctl:null, title:"Capas", icon:"▤"},
  legend:{ctl:null, title:"Leyenda", icon:"◐"},
  summary:{ctl:null, title:"Resumen", icon:"Σ"}
};
// toolbar first so it sits under the zoom buttons
const toolbar = L.control({position:"topleft"});
toolbar.onAdd = () => {
  const d = L.DomUtil.create("div", "toolbar");
  L.DomEvent.disableClickPropagation(d);
  d.innerHTML = Object.entries(WINS).map(([k, w]) => `<button data-win="${k}" title="Mostrar/ocultar ${w.title.toLowerCase()}">${w.icon} <span class="tx">${w.title}</span></button>`).join("")
    + `<button data-all="1" title="Ocultar o mostrar todas las ventanas">◻ <span class="tx">Ocultar todo</span></button>`
    + `<button data-export="1" class="primary" title="Descargar la vista actual como imagen">⤓ <span class="tx">PNG</span></button>`;
  d.addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.win) setWin(b.dataset.win, !WINS[b.dataset.win].open);
    else if (b.dataset.all) { const anyOpen = Object.values(WINS).some(w => w.open); Object.keys(WINS).forEach(k => setWin(k, !anyOpen)); }
    else if (b.dataset.export) APP.openExport && APP.openExport();
  });
  return d;
};
toolbar.addTo(map);
WINS.layers.ctl = makeWin("layers", "Capas", "topright");
WINS.summary.ctl = makeWin("summary", "Resumen", "bottomleft");
WINS.legend.ctl = makeWin("legend", "Leyenda", "bottomright");
function setWin(k, open){
  const w = WINS[k]; w.open = open;
  w.ctl.getContainer().classList.toggle("hidden", !open);
  const b = document.querySelector(`.toolbar [data-win="${k}"]`); if (b) b.classList.toggle("off", !open);
  const anyOpen = Object.values(WINS).some(x => x.open);
  document.querySelector(".toolbar [data-all] .tx").textContent = anyOpen ? "Ocultar todo" : "Mostrar todo";
  try { localStorage.setItem("win-" + k, open ? "1" : "0"); } catch (e) {}
}
const small = innerWidth < 820;
Object.keys(WINS).forEach(k => {
  let saved = null; try { saved = localStorage.getItem("win-" + k); } catch (e) {}
  setWin(k, saved != null ? saved === "1" : !small);
});

// layers window content
function drawLayersWin(){
  const b = WINS.layers.ctl.getContainer().querySelector(".win-b");
  b.innerHTML = `<h4>Mapa base</h4>` + Object.entries(BASES).map(([k, v]) => `<label><input type="radio" name="base" value="${k}" ${APP.base === k ? "checked" : ""}> ${v.name}</label>`).join("")
    + `<h4>Capas</h4>` + APP.LAYER_DEFS.map(([k, n]) => `<label><input type="checkbox" data-layer="${k}" ${map.hasLayer(L_[k]) ? "checked" : ""}> ${n}</label>`).join("");
  b.onchange = ev => {
    const t = ev.target;
    if (t.name === "base"){ map.removeLayer(BASES[APP.base].layer); APP.base = t.value; BASES[APP.base].layer.addTo(map); }
    else if (t.dataset.layer){ const l = L_[t.dataset.layer]; t.checked ? l.addTo(map) : map.removeLayer(l); restack(); drawLegend(); }
  };
}
drawLayersWin();

// legend model is shared with the PNG export
APP.legendModel = function(){
  const S = [];
  if (map.hasLayer(L_.quakes)){
    const src = APP.colorBy === "age" ? AGE_COLORS : DEPTH_COLORS;
    S.push({title: APP.colorBy === "age" ? "Antigüedad del sismo" : "Profundidad del hipocentro", items: src.map(c => ({type:"dot", color:c[1], label:c[2]}))});
    S.push({title:"Magnitud", sizes:[3,4,5,6,7]});
  }
  if (map.hasLayer(L_.faults)) S.push({title:"Fallas activas", items:Object.values(FAULT_STYLE).map(s => ({type:"line", color:s[0], width:s[1], label:s[2]}))});
  const other = [];
  if (map.hasLayer(L_.plates)) other.push({type:"line", color:"#e8590c", width:2.2, dash:[8,5], label:"Límite de placas"});
  if (map.hasLayer(L_.roads)) Object.values(ROAD_STYLE).forEach(r => other.push({type:"line", color:r.color, width:r.weight, dash:r.dashArray ? [4,3] : null, label:r.label}));
  if (map.hasLayer(L_.citiesMain)) other.push({type:"city", main:true, label:"Ciudad principal"});
  if (map.hasLayer(L_.citiesSec)) other.push({type:"city", main:false, label:"Ciudad secundaria"});
  if (map.hasLayer(L_.deps)) other.push({type:"line", color:"#5b6470", width:1.1, dash:[4,3], label:"Límite departamental"});
  if (other.length) S.push({title:"Referencias", items:other});
  return S;
};
function drawLegend(){
  const b = WINS.legend.ctl.getContainer().querySelector(".win-b");
  b.classList.add("legend");
  b.innerHTML = APP.legendModel().map(s => `<h4>${s.title}</h4>` + (s.sizes
    ? `<div class="sizes">${s.sizes.map(m => { const r = radiusOf(m); return `<span><i style="width:${2*r}px;height:${2*r}px"></i>${m}</span>`; }).join("")}</div>`
    : s.items.map(i => i.type === "dot" ? `<div><span class="sw" style="background:${i.color}"></span>${i.label}</div>`
      : i.type === "city" ? `<div><span class="sw" style="background:${i.main ? "#fff" : "#888"};border:${i.main ? "2px solid #222" : "1px solid #555"};width:${i.main ? 10 : 7}px;height:${i.main ? 10 : 7}px;margin-left:${i.main ? 0 : 2}px"></span>${i.label}</div>`
      : `<div><span class="ln" style="border-top:${Math.max(2.5, i.width)}px ${i.dash ? "dashed" : "solid"} ${i.color}"></span>${i.label}</div>`).join(""))).join("");
}
APP.drawLegend = drawLegend;
map.on("overlayadd overlayremove", drawLegend);

// ---------------------------------------------------------------- state & period
const state = APP.state = {mode:"30", dia:null, mes:null, anio:null, d0:null, d1:null, mag:3, depth:"all", region:"", loc:"", q:"", sort:"t"};
APP.ALL = []; APP.VIEW = [];
let markers = new Map(), selected = null, shown = 300, pulse = null;

APP.bounds = function(){
  const now = Date.now(), m = state.mode;
  if (/^\d+$/.test(m)){
    const n = +m, lab = {1:"últimas 24 horas", 7:"últimos 7 días", 30:"últimos 30 días", 365:"últimos 12 meses"}[n];
    return {t0:now - n * DAY, t1:now, label:lab, inLabel:`en ${n === 1 ? "las" : "los"} ${lab}`, prev:[now - 2 * n * DAY, now - n * DAY], prevLabel:`los ${n === 1 ? "24 h" : n === 365 ? "12 meses" : n + " días"} anteriores`};
  }
  if (m === "dia"){ const t0 = parseYMD(state.dia); const p = limaParts(t0);
    return {t0, t1:t0 + DAY, label:`${p.d} de ${MESES[p.m-1]} de ${p.y}`, inLabel:`el ${p.d} de ${MESES[p.m-1]} de ${p.y}`, prev:[t0 - DAY, t0], prevLabel:"el día anterior"}; }
  if (m === "mes"){ const {y, m:mo} = state.mes; const t0 = limaStart(y, mo, 1), t1 = mo === 12 ? limaStart(y + 1, 1, 1) : limaStart(y, mo + 1, 1);
    const pm = mo === 1 ? [y - 1, 12] : [y, mo - 1];
    return {t0, t1, label:`${MESES[mo-1]} de ${y}`, inLabel:`en ${MESES[mo-1]} de ${y}`, prev:[limaStart(pm[0], pm[1], 1), t0], prevLabel:`${MESES[pm[1]-1]} de ${pm[0]}`}; }
  if (m === "anio"){ const y = state.anio;
    return {t0:limaStart(y), t1:limaStart(y + 1), label:`año ${y}`, inLabel:`en ${y}`, prev:[limaStart(y - 1), limaStart(y)], prevLabel:`${y - 1}`}; }
  if (m === "rango"){
    const t0 = state.d0 ? parseYMD(state.d0) : -Infinity, t1 = state.d1 ? parseYMD(state.d1) + DAY : Infinity;
    const lab = `${state.d0 ? fmtDate(t0) : "inicio"} – ${state.d1 ? fmtDate(t1 - 1) : "hoy"}`;
    return {t0, t1, label:lab, inLabel:`entre ${lab.replace(" – ", " y ")}`, prev:isFinite(t0) && isFinite(t1) ? [t0 - (t1 - t0), t0] : null, prevLabel:"el periodo anterior de igual duración"};
  }
  const first = APP.ALL.length ? APP.ALL[APP.ALL.length - 1].t : now;
  return {t0:-Infinity, t1:Infinity, label:`catálogo completo (${limaParts(first).y}–${limaParts(now).y})`, inLabel:`entre ${limaParts(first).y} y ${limaParts(now).y}`, prev:null};
};
// the current period, clipped to "now" for open-ended or ongoing periods (used for rates)
APP.effectiveSpan = function(b){
  const first = APP.ALL.length ? APP.ALL[APP.ALL.length - 1].t : Date.now();
  const t0 = Math.max(b.t0, first), t1 = Math.min(b.t1, Date.now());
  return Math.max(t1 - t0, 3600e3);
};

function yearsAvailable(){
  const cur = limaParts(Date.now()).y, first = APP.ALL.length ? limaParts(APP.ALL[APP.ALL.length - 1].t).y : cur;
  const ys = []; for (let y = cur; y >= first; y--) ys.push(y); return ys;
}
function drawDateInputs(){
  const box = $("#dateinputs"), m = state.mode, today = ymd(Date.now()), ys = yearsAvailable();
  const yearSel = (id, v) => `<select id="${id}">${ys.map(y => `<option ${y === v ? "selected" : ""}>${y}</option>`).join("")}</select>`;
  box.style.display = ["dia","mes","anio","rango"].includes(m) ? "flex" : "none";
  if (m === "dia") box.innerHTML = `<label></label><button class="step" data-s="-1" aria-label="Día anterior">◀</button><input type="date" id="in-dia" value="${state.dia}" max="${today}"><button class="step" data-s="1" aria-label="Día siguiente">▶</button>`;
  else if (m === "mes") box.innerHTML = `<label></label><button class="step" data-s="-1" aria-label="Mes anterior">◀</button><select id="in-mes">${MESES.map((n, i) => `<option value="${i+1}" ${i + 1 === state.mes.m ? "selected" : ""}>${n[0].toUpperCase() + n.slice(1)}</option>`).join("")}</select>${yearSel("in-mes-y", state.mes.y)}<button class="step" data-s="1" aria-label="Mes siguiente">▶</button>`;
  else if (m === "anio") box.innerHTML = `<label></label><button class="step" data-s="-1" aria-label="Año anterior">◀</button>${yearSel("in-anio", state.anio)}<button class="step" data-s="1" aria-label="Año siguiente">▶</button>`;
  else if (m === "rango") box.innerHTML = `<label></label><input type="date" id="in-d0" value="${state.d0 || ""}" max="${today}" aria-label="Desde"><span>–</span><input type="date" id="in-d1" value="${state.d1 || ""}" max="${today}" aria-label="Hasta">`;
  else box.innerHTML = "";
}
$("#dateinputs").addEventListener("change", ev => {
  const id = ev.target.id, v = ev.target.value;
  if (id === "in-dia" && v) state.dia = v;
  if (id === "in-mes") state.mes = {...state.mes, m:+v};
  if (id === "in-mes-y") state.mes = {...state.mes, y:+v};
  if (id === "in-anio") state.anio = +v;
  if (id === "in-d0") state.d0 = v || null;
  if (id === "in-d1") state.d1 = v || null;
  apply();
});
$("#dateinputs").addEventListener("click", ev => {
  const b = ev.target.closest(".step"); if (!b) return;
  const s = +b.dataset.s;
  if (state.mode === "dia") state.dia = ymd(parseYMD(state.dia) + s * DAY + 3600e3);
  if (state.mode === "mes"){ let {y, m} = state.mes; m += s; if (m < 1){ m = 12; y--; } if (m > 12){ m = 1; y++; } state.mes = {y, m}; }
  if (state.mode === "anio") state.anio += s;
  drawDateInputs(); apply();
});
$("#mode").onchange = ev => {
  state.mode = ev.target.value;
  const p = limaParts(Date.now());
  if (state.mode === "dia" && !state.dia) state.dia = ymd(Date.now());
  if (state.mode === "mes" && !state.mes) state.mes = {y:p.y, m:p.m};
  if (state.mode === "anio" && !state.anio) state.anio = p.y;
  if (state.mode === "rango" && !state.d0){ state.d1 = ymd(Date.now()); state.d0 = ymd(Date.now() - 90 * DAY); }
  drawDateInputs(); apply();
};

// ---------------------------------------------------------------- data loading
async function getJSON(url){ const r = await fetch(url, {cache:"no-store"}); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }
const DEP_NAMES = {AMAZONAS:"Amazonas",ANCASH:"Áncash",APURIMAC:"Apurímac",AREQUIPA:"Arequipa",AYACUCHO:"Ayacucho",CAJAMARCA:"Cajamarca",CALLAO:"Callao",CUSCO:"Cusco",HUANCAVELICA:"Huancavelica",HUANUCO:"Huánuco",ICA:"Ica",JUNIN:"Junín","LA LIBERTAD":"La Libertad",LAMBAYEQUE:"Lambayeque",LIMA:"Lima",LORETO:"Loreto","MADRE DE DIOS":"Madre de Dios",MOQUEGUA:"Moquegua",PASCO:"Pasco",PIURA:"Piura",PUNO:"Puno","SAN MARTIN":"San Martín",TACNA:"Tacna",TUMBES:"Tumbes",UCAYALI:"Ucayali"};
APP.DEP_NAMES = DEP_NAMES;

async function loadLayers(){
  const names = ["departamentos","fallas_activas","placas","ciudades","carreteras"];
  const res = await Promise.allSettled(names.map(n => getJSON(`data/${n}.geojson`)));
  const [dep, fal, pla, ciu, car] = res.map(r => r.status === "fulfilled" ? r.value : null);
  if (dep){
    L_.deps.addData(dep);
    L_.deps.eachLayer(l => {
      const nm = l.feature.properties.NOMBDEP, pretty = DEP_NAMES[nm] || nm;
      const tip = L.tooltip({permanent:true, direction:"center", className:"lbl dep-label", interactive:false}).setLatLng(l.getBounds().getCenter()).setContent(nm).addTo(L_.depLabels);
      APP.labels.push({tip, pri:0});
      l.on("click", ev => {
        const n = APP.VIEW.filter(e => e.reg === pretty).length;
        L.popup().setLatLng(ev.latlng).setContent(`<div class="pop"><h3>${esc(pretty)}</h3><div class="sub">${nf(n)} sismo(s) con epicentro asignado a esta región con los filtros actuales</div><a href="#" data-setregion="${esc(pretty)}">Filtrar por esta región</a></div>`).openOn(map);
      });
    });
  }
  if (fal) L_.faults.addData(fal);
  if (pla) L_.plates.addData(pla);
  if (car) L_.roads.addData(car);
  if (ciu) ciu.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates, p = f.properties, main = p.rango === "principal";
    const m = L.circleMarker([lat, lon], {renderer:R, radius: p.capital === "Capital nacional" ? 5.5 : main ? 4 : 2.6, color:"#222", weight: main ? 1.8 : 1, fillColor: main ? "#fff" : "#888", fillOpacity:1});
    m.bindTooltip(esc(p.nombre), {permanent:true, direction:"right", offset:[5,0], className:`lbl ${main ? "city-main" : "city-sec"}`, interactive:false});
    m.bindPopup(`<div class="pop"><h3>${esc(p.nombre)}</h3><div class="sub">${p.capital ? esc(p.capital) : main ? "Ciudad principal" : "Ciudad secundaria"}</div>${p.pob ? `Población aprox.: ${nf(p.pob)} hab. (Natural Earth)` : ""}</div>`);
    m.addTo(main ? L_.citiesMain : L_.citiesSec);
    APP.labels.push({tip:m.getTooltip(), pri:(main ? 2e7 : 1e7) + (p.capital === "Capital nacional" ? 1e7 : 0) + (p.pob || 50000)});
  });
  restack(); drawLegend(); labelZoom();
}
document.addEventListener("click", ev => {
  const a = ev.target.closest("[data-setregion]"); if (!a) return;
  ev.preventDefault(); state.region = a.dataset.setregion; syncControls(); apply(); map.closePopup();
});

function regionFromRef(ref){
  if (/callao/i.test(ref) && !/ - /.test(ref)) return "Callao";
  const i = ref.lastIndexOf(" - "); if (i < 0) return "";
  const k = norm(ref.slice(i + 3)); return DEP_NAMES[k] || ref.slice(i + 3).trim();
}

async function loadQuakes(initial){
  let data;
  try { data = await getJSON("data/sismos.json?t=" + Date.now()); }
  catch (err){
    $("#updated").textContent = "no se pudo cargar el catálogo";
    if (initial) $("#list").innerHTML = '<div class="empty">Aún no hay datos. El catálogo se descarga automáticamente del IGP cada 30 minutos.</div>';
    return;
  }
  const F = data.fields, ix = k => F.indexOf(k);
  const prevIds = new Set(APP.ALL.map(e => e.id));
  APP.ALL = data.events.map(r => {
    const ref = r[ix("ref")] || "";
    return {id:r[ix("id")], t:Date.parse(r[ix("utc")]), lat:r[ix("lat")], lon:r[ix("lon")], mag:r[ix("mag")], prof:r[ix("prof")],
      ref, int:r[ix("int")] || "", pdf:r[ix("pdf")] || "",
      reg: ix("reg") >= 0 ? r[ix("reg")] : regionFromRef(ref), tierra: ix("tierra") >= 0 ? r[ix("tierra")] : null};
  }).filter(e => !isNaN(e.t)).sort((a, b) => b.t - a.t);
  APP.updated = Date.parse(data.updated);
  $("#updated").textContent = `${nf(APP.ALL.length)} sismos · actualizado ${fmtLocal(APP.updated, false)} (hora Perú)`;
  const regs = [...new Set(APP.ALL.map(e => e.reg).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  $("#region").innerHTML = '<option value="">Todas las regiones</option>' + regs.map(r => `<option>${esc(r)}</option>`).join("");
  $("#region").value = state.region;
  if (!initial){
    const nuevos = APP.ALL.filter(e => !prevIds.has(e.id));
    if (nuevos.length) toast(`${nuevos.length} sismo(s) nuevo(s): M${nuevos[0].mag} ${nuevos[0].ref}`);
  }
  drawLatest(); drawDateInputs(); apply();
  if (initial){
    const want = new URLSearchParams(location.search).get("evento");
    const e = want && APP.ALL.find(x => x.id === want);
    if (e){ ensureVisible(e); select(e.id, true); }
  }
}

function drawLatest(){
  const e = APP.ALL[0]; if (!e) return;
  $("#latest").innerHTML = `<div class="m" style="background:${depthColor(e.prof)}">${e.mag.toFixed(1)}</div>
    <div class="t"><b>Último sismo: ${esc(e.ref)}</b><br>${fmtLocal(e.t)} hora local · ${ago(e.t)} · ${e.prof ?? "?"} km</div>`;
  $("#latest").onclick = () => { ensureVisible(e); select(e.id, true); };
  if (pulse) pulse.remove();
  pulse = L.marker([e.lat, e.lon], {icon:L.divIcon({className:"", html:'<div class="pulse"></div>', iconSize:[34,34], iconAnchor:[17,17]}), interactive:false, pane:"quakes"}).addTo(map);
}
function ensureVisible(e){
  if (APP.VIEW.includes(e)) return;
  Object.assign(state, {mode:"todo", mag:3, depth:"all", region:"", loc:"", q:""});
  syncControls(); drawDateInputs(); apply();
}

// ---------------------------------------------------------------- filtering
function passes(e, b){
  if (e.t < b.t0 || e.t >= b.t1) return false;
  if (e.mag < state.mag - 1e-9) return false;
  if (state.depth !== "all" && depthClass(e.prof) !== state.depth) return false;
  if (state.region && e.reg !== state.region) return false;
  if (state.loc !== "" && String(e.tierra) !== state.loc) return false;
  if (state.q){ const q = norm(state.q); if (!norm(e.ref + " " + e.id + " " + e.int + " " + e.reg).includes(q)) return false; }
  return true;
}
APP.passesExceptPeriod = (e, b) => passes(e, {t0:b[0], t1:b[1]});

function apply(){
  const b = APP.bounds();
  APP.period = b;
  APP.VIEW = APP.ALL.filter(e => passes(e, b));
  $("#periodlabel").textContent = b.label[0].toUpperCase() + b.label.slice(1);
  L_.quakes.clearLayers(); markers.clear();
  [...APP.VIEW].sort((a, c) => a.mag - c.mag).forEach(e => {
    const m = L.circleMarker([e.lat, e.lon], {renderer:R, radius:radiusOf(e.mag), color:"#2b2b2b", weight:.7, fillColor:colorOf(e), fillOpacity:.85});
    m.on("click", () => select(e.id, false));
    m.bindTooltip(`M${e.mag.toFixed(1)} · ${esc(e.ref)}<br>${fmtLocal(e.t, false)} · ${e.prof ?? "?"} km`, {direction:"top", offset:[0,-4]});
    m.addTo(L_.quakes); markers.set(e.id, {m, e});
  });
  L_.heat.setLatLngs(APP.VIEW.map(e => [e.lat, e.lon, Math.min(1, (e.mag - 2) / 5)]));
  const V = APP.VIEW;
  $("#s-n").textContent = nf(V.length);
  $("#s-max").textContent = V.length ? Math.max(...V.map(e => e.mag)).toFixed(1) : "–";
  $("#s-m4").textContent = nf(V.filter(e => e.mag >= 4.5).length);
  shown = 300; drawList(); drawLegend(); drawSummary();
  if (APP.drawStats) APP.statsDirty = true, APP.maybeDrawStats();
  if (selected && !markers.has(selected)) selected = null;
}
APP.apply = apply;

APP.filterText = function(){
  const parts = [];
  if (state.mag > 3) parts.push(`M ≥ ${state.mag.toFixed(1)}`);
  if (state.depth !== "all") parts.push({s:"superficiales (≤ 60 km)", i:"intermedios (61–300 km)", p:"profundos (> 300 km)"}[state.depth]);
  if (state.region) parts.push(`región ${state.region}`);
  if (state.loc === "1") parts.push("epicentro en tierra"); if (state.loc === "0") parts.push("epicentro en el mar o fuera del país");
  if (state.q) parts.push(`búsqueda "${state.q}"`);
  return parts.join(" · ");
};
function drawSummary(){
  const V = APP.VIEW, b = APP.period, box = WINS.summary.ctl.getContainer().querySelector(".win-b");
  const mx = V.length ? V.reduce((a, e) => e.mag > a.mag ? e : a) : null;
  box.classList.add("summary");
  box.innerHTML = `<div class="big">${nf(V.length)} sismos · ${esc(b.label)}</div>`
    + (mx ? `<div>Mayor: M${mx.mag.toFixed(1)} · ${fmtDate(mx.t)}<br><span style="color:#666">${esc(mx.ref)}</span></div>` : "")
    + `<div style="color:#666">${esc(APP.filterText() || "Sin filtros adicionales")}</div>`;
}

// ---------------------------------------------------------------- list
function sortedView(){
  const v = [...APP.VIEW];
  if (state.sort === "m") v.sort((a, b) => b.mag - a.mag || b.t - a.t);
  else if (state.sort === "p") v.sort((a, b) => (b.prof ?? -1) - (a.prof ?? -1) || b.t - a.t);
  return v;
}
function drawList(){
  const v = sortedView(), list = $("#list");
  $("#listcount").textContent = `${nf(v.length)} resultados`;
  if (!v.length){ list.innerHTML = '<div class="empty">Ningún sismo cumple los filtros.</div>'; return; }
  list.innerHTML = v.slice(0, shown).map(e => { const c = colorOf(e); return `<div class="ev${e.id === selected ? " sel" : ""}" data-id="${esc(e.id)}">
      <div class="mag" style="background:${c};${lightBg(c) ? "color:#222" : ""}">${e.mag.toFixed(1)}</div>
      <div><div class="ref">${esc(e.ref)}</div><div class="meta">${fmtLocal(e.t, false)} · ${ago(e.t)} · ${e.prof ?? "?"} km${e.int ? " · Int. " + esc(e.int) : ""}</div></div></div>`; }).join("")
    + (v.length > shown ? `<button id="more">Mostrar más (${nf(v.length - shown)} restantes)</button>` : "");
  const more = $("#more"); if (more) more.onclick = () => { shown += 300; drawList(); };
}
$("#list").addEventListener("click", ev => { const d = ev.target.closest(".ev"); if (d){ select(d.dataset.id, true); if (innerWidth < 820) $("#panel").classList.remove("open"); } });
$("#list").addEventListener("mouseover", ev => { const d = ev.target.closest(".ev"); const k = d && markers.get(d.dataset.id); if (k){ k.m.setStyle({weight:2.5, color:"#000"}); k.m.bringToFront(); } });
$("#list").addEventListener("mouseout", ev => { const d = ev.target.closest(".ev"); const k = d && markers.get(d.dataset.id); if (k) k.m.setStyle({weight:.7, color:"#2b2b2b"}); });

function popupHtml(e){
  const dc = {s:"superficial", i:"intermedia", p:"profunda", "?":"–"}[depthClass(e.prof)];
  const lat = `${Math.abs(e.lat).toFixed(2)}° ${e.lat < 0 ? "S" : "N"}`, lon = `${Math.abs(e.lon).toFixed(2)}° ${e.lon < 0 ? "O" : "E"}`;
  return `<div class="pop"><h3>M ${e.mag.toFixed(1)} · ${esc(e.ref)}</h3><div class="sub">Reporte IGP ${esc(e.id)} · ${ago(e.t)}</div><table>
    <tr><td>Hora local</td><td>${fmtLocal(e.t)} (UTC−5)</td></tr>
    <tr><td>Hora UTC</td><td>${fmtUTC(e.t)}</td></tr>
    <tr><td>Magnitud</td><td>${e.mag.toFixed(1)}</td></tr>
    <tr><td>Profundidad</td><td>${e.prof ?? "–"} km (${dc})</td></tr>
    <tr><td>Epicentro</td><td>${lat}, ${lon}</td></tr>
    <tr><td>Región</td><td>${esc(e.reg || "–")}${e.tierra === 0 ? " (en el mar o fuera del país)" : ""}</td></tr>
    <tr><td>Intensidad</td><td>${esc(e.int || "–")}</td></tr></table>
    <div class="links">${e.pdf ? `<a href="${esc(e.pdf)}" target="_blank" rel="noopener">Reporte acelerométrico (PDF)</a>` : ""}
    <a href="https://ultimosismo.igp.gob.pe/productos/reportes-sismicos" target="_blank" rel="noopener">IGP</a>
    <a href="#" data-copy="${esc(e.id)}">Copiar enlace</a></div></div>`;
}
function select(id, fly){
  const k = markers.get(id); if (!k) return;
  selected = id;
  document.querySelectorAll(".ev.sel").forEach(d => d.classList.remove("sel"));
  const row = document.querySelector(`.ev[data-id="${CSS.escape(id)}"]`); if (row){ row.classList.add("sel"); row.scrollIntoView({block:"nearest"}); }
  const go = () => L.popup({maxWidth:340}).setLatLng([k.e.lat, k.e.lon]).setContent(popupHtml(k.e)).openOn(map);
  if (fly){ map.flyTo([k.e.lat, k.e.lon], Math.max(map.getZoom(), 7), {duration:.8}); map.once("moveend", go); } else go();
  history.replaceState(null, "", `?evento=${encodeURIComponent(id)}`);
}
APP.select = (id) => select(id, true);
document.addEventListener("click", ev => {
  const a = ev.target.closest("[data-copy]"); if (!a) return; ev.preventDefault();
  const u = `${location.origin}${location.pathname}?evento=${encodeURIComponent(a.dataset.copy)}`;
  (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast("Enlace copiado"), () => prompt("Enlace:", u));
});
map.on("popupclose", () => { if (location.search) history.replaceState(null, "", location.pathname); });

// ---------------------------------------------------------------- controls
function syncControls(){
  $("#mode").value = state.mode;
  $("#mag").value = state.mag; $("#magval").textContent = (+state.mag).toFixed(1);
  $("#depth").value = state.depth; $("#region").value = state.region; $("#loc").value = state.loc;
  $("#q").value = state.q; $("#sort").value = state.sort;
}
APP.syncControls = syncControls;
$("#mag").oninput = e => { $("#magval").textContent = (+e.target.value).toFixed(1); };
$("#mag").onchange = e => { state.mag = +e.target.value; apply(); };
$("#depth").onchange = e => { state.depth = e.target.value; apply(); };
$("#loc").onchange = e => { state.loc = e.target.value; apply(); };
$("#region").onchange = e => {
  state.region = e.target.value; apply();
  let bb = null; L_.deps.eachLayer(l => { if ((DEP_NAMES[l.feature.properties.NOMBDEP] || "") === state.region) bb = l.getBounds(); });
  if (bb) map.flyToBounds(bb, {padding:[30,30], duration:.8});
};
let qT; $("#q").oninput = e => { clearTimeout(qT); qT = setTimeout(() => { state.q = e.target.value; apply(); }, 200); };
$("#sort").onchange = e => { state.sort = e.target.value; shown = 300; drawList(); };
$("#colorby").addEventListener("click", ev => {
  const b = ev.target.closest("button"); if (!b) return; APP.colorBy = b.dataset.v;
  document.querySelectorAll("#colorby button").forEach(x => x.classList.toggle("on", x === b)); apply();
});
document.querySelector(".tabs").addEventListener("click", ev => {
  const b = ev.target.closest("button"); if (!b) return;
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  document.querySelectorAll(".tabpane").forEach(p => p.classList.toggle("on", p.id === b.dataset.tab));
  if (APP.maybeDrawStats) APP.maybeDrawStats();
});
$("#toggle-panel").onclick = () => $("#panel").classList.toggle("open");

// ---------------------------------------------------------------- start
loadLayers();
loadQuakes(true);
setInterval(() => loadQuakes(false), 5 * 60e3);
setInterval(() => { if (APP.ALL.length) drawLatest(); }, 60e3);
