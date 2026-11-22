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
  if (APP.colorBy === "tect" && e.slab && APP.SLAB_CLASSES) return APP.SLAB_CLASSES[e.slab.cls].color;
  if (APP.colorBy === "age"){ const days = (Date.now() - e.t) / DAY; return AGE_COLORS.find(c => days <= c[0])[1]; }
  return depthColor(e.prof);
}
const radiusOf = m => Math.min(26, Math.max(3, Math.pow(1.75, m - 1.2)));
// black or white text, whichever contrasts more with a hex background (WCAG relative luminance)
function textOn(hex){
  const v = hex.replace("#", ""), ch = i => { const x = parseInt(v.substr(i, 2), 16) / 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); };
  const Lb = .2126 * ch(0) + .7152 * ch(2) + .0722 * ch(4);
  return (1.05 / (Lb + .05)) >= ((Lb + .05) / .05) ? "#ffffff" : "#111111";
}
APP.textOn = textOn;
// Theme-dependent colours of reference layers (light / dark mode)
const THEME_COLORS = {
  // roads: dark grey on the light theme, light grey on the dark theme (faults keep their colours)
  light:{dep:"#6b7280", sub:"#111111", autopista:"#111111", principal:"#3a3a3a", secundaria:"#7d7d7d", cityFill:"#ffffff", cityStroke:"#000000", secFill:"#000000", secStroke:"#ffffff"},
  dark: {dep:"#a3acb7", sub:"#eeeeee", autopista:"#f5f5f5", principal:"#c2c2c2", secundaria:"#8e8e8e", cityFill:"#ffffff", cityStroke:"#000000", secFill:"#000000", secStroke:"#ffffff"}
};
APP.theme = "light";
const TC = k => THEME_COLORS[APP.theme][k];
APP.TC = TC;
// Fault classes come from data/fallas_activas.geojson ("clase"), written by scripts/traducir_fallas.py
const FAULT_STYLE = {subduccion:[null,3,"Subducción (fosa)"], inversa:["#c0392b",1.8,"Falla inversa"], normal:["#1f5fbf",1.8,"Falla normal"],
  dextral:["#1a9850",1.8,"Falla dextral"], sinistral:["#8e44ad",1.8,"Falla sinistral"], rumbo:["#0e9aa7",1.8,"Falla de rumbo (sentido no definido)"], otra:["#8a7660",1.4,"Cinemática no especificada"]};
const faultStyleOf = c => { const s = FAULT_STYLE[c] || FAULT_STYLE.otra; return [s[0] || TC("sub"), s[1], s[2]]; };
const ROAD_STYLE = {autopista:{weight:3,label:"Autopista / vía expresa"}, principal:{weight:1.9,label:"Carretera principal"}, secundaria:{weight:1.1,label:"Carretera secundaria"}};
const roadStyle = c => ({...ROAD_STYLE[c], color:TC(c), opacity:.85});
const PLATES = {NZ:"Nazca", SA:"Sudamericana", CO:"Cocos", PM:"Panamá", CA:"Caribe", ND:"Andes del Norte", AP:"Altiplano"};
const plateName = n => n.split(/[-\\/]/).map(c => PLATES[c] || c).join(" – ");
Object.assign(APP, {DEPTH_COLORS, AGE_COLORS, colorOf, depthColor, radiusOf, FAULT_STYLE, ROAD_STYLE});

// ---------------------------------------------------------------- map & layers
const map = APP.map = L.map("map", {preferCanvas:true, worldCopyJump:true, zoomSnap:.5}).setView([-9.3,-75.5], 5);
const tileOpts = {crossOrigin:"anonymous"};          // needed to export the basemap to PNG
const BASES = APP.BASES = {
  topo:{name:"Relieve (Esri)", layer:L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",{...tileOpts,maxZoom:18,attribution:"Tiles © Esri"}), credit:"Esri World Topo"},
  light:{name:"Gris claro (Esri)", layer:L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",{...tileOpts,maxZoom:16,attribution:"Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap"}), credit:"Esri World Light Gray Canvas"},
  osm:{name:"OpenStreetMap", layer:L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{...tileOpts,maxZoom:19,attribution:"© OpenStreetMap"}), credit:"© OpenStreetMap"},
  sat:{name:"Satélite (Esri)", layer:L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{...tileOpts,maxZoom:18,attribution:"Imagery © Esri"}), credit:"Esri World Imagery"},
  dark:{name:"Gris oscuro (Esri)", layer:L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",{...tileOpts,maxZoom:16,attribution:"Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap"}), credit:"Esri World Dark Gray Canvas"}
};
APP.base = "light";            // the theme code below may switch it to "dark" before first paint
map.createPane("quakes").style.zIndex = 420;        // only for the "latest quake" pulse marker
// One canvas for every vector layer: with one canvas per pane the top canvas would
// swallow all mouse events and hide tooltips/clicks of the layers below it.
// tolerance: extra pixels around lines and points that still count as hover/click
const R = APP.renderer = L.canvas({padding:.3, tolerance:8});

const L_ = APP.layers = {};
L_.quakes = L.layerGroup().addTo(map);
L_.heat = L.heatLayer([], {radius:18, blur:16, maxZoom:9, minOpacity:.25});
const depStyle = () => ({color:TC("dep"), weight:1.1, fill:true, fillOpacity:0, dashArray:"4 3"});
L_.deps = L.geoJSON(null, {renderer:R, style:depStyle}).addTo(map);
L_.depLabels = L.layerGroup().addTo(map);
L_.roads = L.geoJSON(null, {renderer:R, style:f => roadStyle(f.properties.clase),
  onEachFeature:(f, l) => l.bindTooltip(ROAD_STYLE[f.properties.clase].label + (f.properties.nombre ? `: ${esc(f.properties.nombre)}` : ""), {sticky:true})}).addTo(map);
L_.citiesMain = L.layerGroup().addTo(map);
L_.citiesSec = L.layerGroup().addTo(map);
L_.faults = L.geoJSON(null, {renderer:R,
  style:f => { const s = faultStyleOf(f.properties.clase); return {color:s[0], weight:s[1], opacity:.85}; },
  onEachFeature:(f, l) => {
    const p = f.properties, name = p.nombre || null;
    l.bindTooltip(name ? `<b>${esc(name)}</b><br><span class="tip-sub">${esc(p.tipo)}</span>`
                       : `Falla sin nombre<br><span class="tip-sub">${esc(p.tipo)}</span>`, {sticky:true, className:"fault-tip"});
    l.bindPopup(`<div class="pop"><h3>${esc(name || "Falla sin nombre")}</h3><div class="sub">Falla activa</div><table>
      <tr><td>Cinemática</td><td>${esc(p.tipo)}</td></tr>
      ${p.net_slip_rate ? `<tr><td>Tasa de desliz.</td><td>${esc(p.net_slip_rate)} mm/año</td></tr>` : ""}
      ${p.average_dip ? `<tr><td>Buzamiento</td><td>${esc(p.average_dip)}° ${esc(p.buz_dir || "")}</td></tr>` : ""}
      <tr><td>Fuente</td><td>${esc(p.fuente || "GEM GAF-DB")}</td></tr></table></div>`);
    const w = faultStyleOf(p.clase)[1];
    l.on("mouseover", () => { l.setStyle({weight:w + 2.5, opacity:1}); });
    l.on("mouseout", () => L_.faults.resetStyle(l));
  }}).addTo(map);
// Volcanoes: triangles coloured by IGP (2022) hazard level; filled = active, hollow = potentially active
const VOLC_COLORS = APP.VOLC_COLORS = {"Muy alta":"#7a0019", "Alta":"#d7301f", "Moderada":"#f46d43", "Baja":"#fdae61", "Muy baja":"#fee08b"};
const volcSize = h => h === "Muy alta" ? 26 : h === "Alta" ? 23 : 20;
const VOLC_PAD = 7;            // transparent margin around the triangle: larger hover/click target
function volcSvg(p){
  const s = volcSize(p.peligrosidad), c = VOLC_COLORS[p.peligrosidad] || "#999", act = p.estado === "Activo";
  return `<svg width="${s}" height="${s}" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 L18.5 17.5 L1.5 17.5 Z" fill="${act ? c : "#fff"}" stroke="${act ? "#1a1a1a" : c}" stroke-width="${act ? 1.4 : 3}" stroke-linejoin="round"/>${act ? "" : `<path d="M10 2 L18.5 17.5 L1.5 17.5 Z" fill="none" stroke="#1a1a1a" stroke-width=".8" stroke-linejoin="round"/>`}</svg>`;
}
APP.volcSize = volcSize;
map.createPane("volcanoes").style.zIndex = 430;
L_.volcanoes = L.layerGroup().addTo(map);
L_.plates = L.geoJSON(null, {renderer:R, style:{color:"#e8590c", weight:2.2, opacity:.8, dashArray:"8 5"},
  onEachFeature:(f, l) => l.bindTooltip(`Límite de placas: ${esc(plateName(f.properties.Name || ""))}${f.properties.Type === "subduction" ? "<br><span class=\"tip-sub\">zona de subducción</span>" : ""}`, {sticky:true})});
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
  ["faults","Fallas activas"],["volcanoes","Volcanes activos y potencialmente activos"],["plates","Límites de placas"]
];
L.control.scale({imperial:false, position:"bottomleft"}).addTo(map);

// label visibility by zoom (the layer checkbox decides whether labels exist at all)
function labelZoom(){
  const z = map.getZoom(), c = map.getContainer().classList;
  c.toggle("hide-dep", z < 5.5); c.toggle("hide-main", z < 5); c.toggle("hide-sec", z < 7); c.toggle("hide-volc", z < 6);
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
// floating windows are sized from the current map height (it shrinks while the cross-section is open)
const setMapH = () => document.documentElement.style.setProperty("--maph", map.getSize().y + "px");
map.on("resize", setMapH); setMapH();
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
    + `<button data-profile="1" title="Trazar un corte vertical (perfil de sismos en profundidad)">⟋ <span class="tx">Perfil</span></button>`
    + `<button data-export="1" class="primary" title="Descargar la vista actual como imagen">⤓ <span class="tx">PNG</span></button>`;
  d.addEventListener("click", ev => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.win) setWin(b.dataset.win, !WINS[b.dataset.win].open);
    else if (b.dataset.all) { const anyOpen = Object.values(WINS).some(w => w.open); Object.keys(WINS).forEach(k => setWin(k, !anyOpen)); }
    else if (b.dataset.export) APP.openExport && APP.openExport();
    else if (b.dataset.profile) APP.startProfile && APP.startProfile();
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
APP.drawLayersWin = drawLayersWin;

// legend model is shared with the PNG export
APP.legendModel = function(){
  const S = [], extra = [].concat(...(APP.legendExtras || []).map(f => f() || []));
  if (map.hasLayer(L_.quakes)){
    const rep = extra.find(x => x.replaceDepth);
    if (rep) S.push(rep);
    else { const src = APP.colorBy === "age" ? AGE_COLORS : DEPTH_COLORS;
      S.push({title: APP.colorBy === "age" ? "Antigüedad del sismo" : "Profundidad del hipocentro", items: src.map(c => ({type:"dot", color:c[1], label:c[2]}))}); }
    S.push({title:"Magnitud", sizes:[3,4,5,6,7]});
  }
  extra.filter(x => !x.replaceDepth).forEach(x => S.push(x));
  if (map.hasLayer(L_.faults)) S.push({title:"Fallas activas", items:Object.keys(FAULT_STYLE).map(k => { const s = faultStyleOf(k); return {type:"line", color:s[0], width:s[1], label:s[2]}; })});
  const other = [];
  if (map.hasLayer(L_.volcanoes)) S.push({title:"Volcanes · peligrosidad (IGP, 2022)", items:[
    ...Object.entries(VOLC_COLORS).map(([k, c]) => ({type:"tri", color:c, active:true, label:k})),
    {type:"tri", color:"#888", active:true, label:"Relleno: volcán activo"}, {type:"tri", color:"#888", active:false, label:"Hueco: potencialmente activo"}]});
  if (map.hasLayer(L_.plates)) other.push({type:"line", color:"#e8590c", width:2.2, dash:[8,5], label:"Límite de placas"});
  if (map.hasLayer(L_.roads)) Object.entries(ROAD_STYLE).forEach(([k, r]) => other.push({type:"line", color:TC(k), width:r.weight, dash:r.dashArray ? [4,3] : null, label:r.label}));
  if (map.hasLayer(L_.citiesMain)) other.push({type:"city", main:true, label:"Ciudad principal"});
  if (map.hasLayer(L_.citiesSec)) other.push({type:"city", main:false, label:"Ciudad secundaria"});
  if (map.hasLayer(L_.deps)) other.push({type:"line", color:TC("dep"), width:1.1, dash:[4,3], label:"Límite departamental"});
  if (other.length) S.push({title:"Referencias", items:other});
  return S;
};
function drawLegend(){
  const b = WINS.legend.ctl.getContainer().querySelector(".win-b");
  b.classList.add("legend");
  b.innerHTML = APP.legendModel().map(s => `<h4>${s.title}</h4>` + (s.sizes
    ? `<div class="sizes">${s.sizes.map(m => { const r = radiusOf(m); return `<span><i style="width:${2*r}px;height:${2*r}px"></i>${m}</span>`; }).join("")}</div>`
    : s.items.map(i => i.type === "dot" ? `<div><span class="sw" style="background:${i.color}"></span>${i.label}</div>`
      : i.type === "tri" ? `<div><svg width="13" height="13" viewBox="0 0 20 20" style="margin-right:6px;vertical-align:-1px"><path d="M10 2 L18.5 17.5 L1.5 17.5 Z" fill="${i.active ? i.color : "#fff"}" stroke="${i.active ? "#1a1a1a" : i.color}" stroke-width="${i.active ? 1.4 : 3}"/></svg>${i.label}</div>`
      : i.type === "city" ? `<div><span class="sw" style="background:${i.main ? TC("cityFill") : TC("secFill")};border:${i.main ? "2px solid " + TC("cityStroke") : "1.5px solid " + TC("secStroke")};box-shadow:0 0 0 1px ${i.main ? "transparent" : "#000"};width:${i.main ? 11 : 8}px;height:${i.main ? 11 : 8}px;margin-left:${i.main ? 0 : 2}px"></span>${i.label}</div>`
      : `<div><span class="ln" style="border-top:${Math.max(2.5, i.width)}px ${i.dash ? "dashed" : "solid"} ${i.color}"></span>${i.label}</div>`).join(""))).join("");
}
APP.drawLegend = drawLegend;
map.on("overlayadd overlayremove", drawLegend);

// ---------------------------------------------------------------- state & period
const state = APP.state = {mode:"30", dia:null, mes:null, anio:null, d0:null, d1:null, mag:4.5, depth:"all", region:"", loc:"", tect:"", q:"", sort:"t"};
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
  const names = ["departamentos","fallas_activas","placas","ciudades","carreteras","volcanes"];
  const res = await Promise.allSettled(names.map(n => getJSON(`data/${n}.geojson`)));
  const [dep, fal, pla, ciu, car, vol] = res.map(r => r.status === "fulfilled" ? r.value : null);
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
  if (vol) vol.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates, p = f.properties, sz = volcSize(p.peligrosidad);
    const m = L.marker([lat, lon], {pane:"volcanoes", icon:L.divIcon({className:"volc-icon", html:volcSvg(p), iconSize:[sz + 2 * VOLC_PAD, sz + 2 * VOLC_PAD], iconAnchor:[sz / 2 + VOLC_PAD, sz * .6 + VOLC_PAD]}), keyboard:false, volc:p});
    m.bindTooltip(`<b>Volcán ${esc(p.nombre)}</b><br><span class="tip-sub">${esc(p.estado)} · peligrosidad ${esc(p.peligrosidad.toLowerCase())}</span>`, {direction:"top", offset:[0, -sz * .5]});
    m.bindPopup(`<div class="pop"><h3>${/^Campo|^Cerro/.test(p.nombre) ? "" : "Volcán "}${esc(p.nombre)}</h3><div class="sub">${esc(p.estado)} · ${esc(p.region)}</div><table>
      <tr><td>Peligrosidad</td><td><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${VOLC_COLORS[p.peligrosidad]};margin-right:5px"></span>${esc(p.peligrosidad)} (IGP, 2022)</td></tr>
      <tr><td>Tipo</td><td>${esc(p.tipo)}</td></tr>
      <tr><td>Altitud</td><td>${nf(p.elevacion)} m s. n. m.</td></tr>
      <tr><td>Última erupción</td><td>${esc(p.ultima_erupcion)}</td></tr>
      <tr><td>Ubicación</td><td>${Math.abs(lat).toFixed(2)}° S, ${Math.abs(lon).toFixed(2)}° O</td></tr></table>
      <div class="links"><a href="https://volcano.si.edu/volcano.cfm?vn=${p.gvp}" target="_blank" rel="noopener">Ficha en el Global Volcanism Program</a>
      <a href="https://www.igp.gob.pe/servicios/centro-vulcanologico-nacional/" target="_blank" rel="noopener">Centro Vulcanológico Nacional (IGP)</a></div></div>`);
    const lbl = L.tooltip({permanent:true, direction:"right", offset:[sz * .55, 0], className:"lbl volc-label", interactive:false}).setLatLng([lat, lon]).setContent(esc(p.nombre.replace("Campo volcánico monogenético ", "CVM ")));
    m.on("add", () => lbl.addTo(map)); m.on("remove", () => lbl.remove());
    m.addTo(L_.volcanoes); lbl.addTo(map);
    // high-hazard volcanoes outrank city names (e.g. Misti next to Arequipa); the rest rank below main cities
    const rank = {"Muy alta":5,"Alta":4,"Moderada":3,"Baja":2,"Muy baja":1}[p.peligrosidad] || 0;
    APP.labels.push({tip:lbl, pri:(rank >= 4 ? 5e7 : 1.5e7) + rank * 1e5});
  });
  if (ciu) ciu.features.forEach(f => {
    const [lon, lat] = f.geometry.coordinates, p = f.properties, main = p.rango === "principal";
    const m = L.circleMarker([lat, lon], {renderer:R, radius: p.capital === "Capital nacional" ? 6.5 : main ? 5 : 3.6, main, color: main ? TC("cityStroke") : TC("secStroke"), weight: main ? 2 : 1.3, fillColor: main ? TC("cityFill") : TC("secFill"), fillOpacity:1});
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
  $("#latest").innerHTML = `<div class="m" style="background:${depthColor(e.prof)};color:${textOn(depthColor(e.prof))}">${e.mag.toFixed(1)}</div>
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
  if (state.tect && (!e.slab || e.slab.cls !== state.tect)) return false;
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
  if (state.tect && APP.SLAB_CLASSES) parts.push(`ambiente: ${APP.SLAB_CLASSES[state.tect].short.toLowerCase()}`);
  if (state.q) parts.push(`búsqueda "${state.q}"`);
  return parts.join(" · ");
};
function drawSummary(){
  const V = APP.VIEW, b = APP.period, box = WINS.summary.ctl.getContainer().querySelector(".win-b");
  const mx = V.length ? V.reduce((a, e) => e.mag > a.mag ? e : a) : null;
  box.classList.add("summary");
  box.innerHTML = `<div class="big">${nf(V.length)} sismos · ${esc(b.label)}</div>`
    + (mx ? `<div>Mayor: M${mx.mag.toFixed(1)} · ${fmtDate(mx.t)}<br><span class="muted">${esc(mx.ref)}</span></div>` : "")
    + `<div class="muted">${esc(APP.filterText() || "Sin filtros adicionales")}</div>`;
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
      <div class="mag" style="background:${c};color:${textOn(c)}">${e.mag.toFixed(1)}</div>
      <div><div class="ref">${esc(e.ref)}</div><div class="meta">${fmtLocal(e.t, false)} · ${ago(e.t)} · ${e.prof ?? "?"} km${e.int ? " · Int. " + esc(e.int) : ""}</div></div></div>`; }).join("")
    + (v.length > shown ? `<button id="more">Mostrar más (${nf(v.length - shown)} restantes)</button>` : "");
  const more = $("#more"); if (more) more.onclick = () => { shown += 300; drawList(); };
}
$("#list").addEventListener("click", ev => { const d = ev.target.closest(".ev"); if (d){ select(d.dataset.id, true); if (innerWidth < 820) $("#panel").classList.remove("open"); } });
$("#list").addEventListener("mouseover", ev => { const d = ev.target.closest(".ev"); const k = d && markers.get(d.dataset.id); if (k){ k.m.setStyle({weight:2.5, color:APP.theme === "dark" ? "#fff" : "#000"}); k.m.bringToFront(); } });
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
    <tr><td>Intensidad</td><td>${esc(e.int || "–")}</td></tr>
    ${e.slab ? `<tr><td>Ambiente (Slab2)</td><td>${esc(APP.slab.text(e))}</td></tr>` : ""}</table>
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
APP.popupHtml = popupHtml;
APP.faultStyleOf = faultStyleOf;
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
  $("#depth").value = state.depth; $("#region").value = state.region; $("#loc").value = state.loc; $("#tect").value = state.tect;
  $("#q").value = state.q; $("#sort").value = state.sort;
}
APP.syncControls = syncControls;
$("#mag").oninput = e => { $("#magval").textContent = (+e.target.value).toFixed(1); };
$("#mag").onchange = e => { state.mag = +e.target.value; apply(); };
$("#depth").onchange = e => { state.depth = e.target.value; apply(); };
$("#loc").onchange = e => { state.loc = e.target.value; apply(); };
$("#tect").onchange = e => { state.tect = e.target.value; apply(); };
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

// ---------------------------------------------------------------- light / dark theme
// Saved choice wins; otherwise follow the operating system. The basemap follows the
// theme only while it is one of the two neutral grey basemaps.
function applyTheme(t){
  const prev = APP.theme; APP.theme = t;
  document.documentElement.dataset.theme = t;
  const btn = $("#theme"); btn.textContent = t === "dark" ? "☀" : "☾";
  btn.title = btn.ariaLabel = t === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  const want = t === "dark" ? "dark" : "light";
  if (!map.hasLayer(BASES[APP.base].layer) || (APP.base !== want && ["light","dark"].includes(APP.base))){
    if (map.hasLayer(BASES[APP.base].layer)) map.removeLayer(BASES[APP.base].layer);
    APP.base = want; BASES[want].layer.addTo(map);
  }
  if (prev !== t || !APP.themeReady){
    L_.deps.setStyle(depStyle());
    L_.roads.setStyle(f => roadStyle(f.properties.clase));
    L_.faults.setStyle(f => { const s = faultStyleOf(f.properties.clase); return {color:s[0], weight:s[1], opacity:.85}; });
    [L_.citiesMain, L_.citiesSec].forEach(g => g.eachLayer(m => m.setStyle({color:m.options.main ? TC("cityStroke") : TC("secStroke"), fillColor:m.options.main ? TC("cityFill") : TC("secFill")})));
    drawLayersWin(); drawLegend();
    if (APP.drawStats){ APP.statsDirty = true; APP.maybeDrawStats(); }
    if (APP.redrawProfile) APP.redrawProfile();
    (APP.onThemeChange || []).forEach(f => f());
  }
  APP.themeReady = true;
}
APP.applyTheme = applyTheme;
let savedTheme = null; try { savedTheme = localStorage.getItem("theme"); } catch (e) {}
const mq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
applyTheme(savedTheme || (mq && mq.matches ? "dark" : "light"));
if (mq && mq.addEventListener) mq.addEventListener("change", ev => { let s = null; try { s = localStorage.getItem("theme"); } catch (e) {} if (!s) applyTheme(ev.matches ? "dark" : "light"); });
$("#theme").onclick = () => { const t = APP.theme === "dark" ? "light" : "dark"; try { localStorage.setItem("theme", t); } catch (e) {} applyTheme(t); };

// ---------------------------------------------------------------- start
// modules (e.g. the profile tool) register callbacks to run once layers and events are loaded
APP.onDataReady = APP.onDataReady || [];
const dataReady = () => APP.onDataReady.forEach(f => { try { f(); } catch (e) { console.error(e); } });
Promise.all([loadLayers(), loadQuakes(true)]).then(dataReady);
setInterval(() => loadQuakes(false).then(dataReady), 5 * 60e3);
setInterval(() => { if (APP.ALL.length) drawLatest(); }, 60e3);
