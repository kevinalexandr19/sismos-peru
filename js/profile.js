"use strict";
/* Vertical cross-section tool.
   The user draws a line A–A′ on the map; earthquakes (M ≥ 4.5 by default) inside a
   swath of adjustable width are projected onto the line (spherical along-/cross-track
   distances) and plotted as distance vs depth, under a topography/bathymetry profile
   with cities, volcanoes and fault crossings (faults with a known dip are drawn with
   their apparent dip). A time slider filters the events and can be animated; the map
   can be synchronised to show only the events in the profile. */
(function(){
const A = window.APP, map = A.map, $ = A.$, esc = A.esc, nf = A.nf;
const RE = 6371.0088, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

// ------------------------------------------------------------ spherical geometry (km, radians)
function dist(a, b){
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = p2 - p1, dl = rad(b.lon - a.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * RE * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a, b){
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(b.lon - a.lon);
  return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
}
function dest(p, brg, km){
  const d = km / RE, p1 = rad(p.lat), l1 = rad(p.lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg));
  const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return {lat:deg(p2), lon:deg(l2)};
}
function along(a, b, f){                       // point at fraction f of the great circle a→b
  const d = dist(a, b) / RE; if (d < 1e-9) return {lat:a.lat, lon:a.lon};
  const s = Math.sin(d), A1 = Math.sin((1 - f) * d) / s, B1 = Math.sin(f * d) / s;
  const p1 = rad(a.lat), l1 = rad(a.lon), p2 = rad(b.lat), l2 = rad(b.lon);
  const x = A1 * Math.cos(p1) * Math.cos(l1) + B1 * Math.cos(p2) * Math.cos(l2);
  const y = A1 * Math.cos(p1) * Math.sin(l1) + B1 * Math.cos(p2) * Math.sin(l2);
  const z = A1 * Math.sin(p1) + B1 * Math.sin(p2);
  return {lat:deg(Math.atan2(z, Math.hypot(x, y))), lon:deg(Math.atan2(y, x))};
}
// along-track (from A, signed) and cross-track (signed, + = right of A→B) distances in km
function project(p){
  const d13 = dist(P.A, p) / RE, t13 = bearing(P.A, p), dt = t13 - P.brg;
  const xt = Math.asin(Math.sin(d13) * Math.sin(dt));
  const c = Math.cos(d13) / Math.cos(xt);
  const at = Math.acos(Math.max(-1, Math.min(1, c))) * (Math.cos(dt) >= 0 ? 1 : -1);
  return {at:at * RE, xt:xt * RE};
}
A.profileGeo = {dist, bearing, dest, along};

// ------------------------------------------------------------ state
const P = A.profile = {
  open:false, A:null, B:null, L:0, brg:0, width:100, magMin:4.5, ve:"auto", color:"depth",
  mode:"acum", win:365, t0:null, t1:null, playing:false, speed:1, sync:true,
  ev:[], faults:[], cities:[], volcs:[], topo:null, topoKey:"", hits:[]
};
const WIDTH_MIN = 10, WIDTH_MAX = 1000;              // total swath width, km
const w2s = w => Math.round(100 * Math.log10(w / WIDTH_MIN) / Math.log10(WIDTH_MAX / WIDTH_MIN));
const s2w = v => { const w = WIDTH_MIN * Math.pow(WIDTH_MAX / WIDTH_MIN, v / 100); return w < 100 ? Math.round(w / 5) * 5 : w < 400 ? Math.round(w / 10) * 10 : Math.round(w / 50) * 50; };

// ------------------------------------------------------------ map overlay (line, swath, endpoints)
const ov = L.layerGroup();
const lineLayer = L.polyline([], {renderer:A.renderer, color:"#b8321f", weight:2.5, interactive:false});
const swathLayer = L.polygon([], {renderer:A.renderer, color:"#b8321f", weight:1, dashArray:"5 4", fillColor:"#b8321f", fillOpacity:.08, interactive:false});
ov.addLayer(swathLayer).addLayer(lineLayer);
const endIcon = t => L.divIcon({className:"prof-end", html:`<span>${t}</span>`, iconSize:[24, 24], iconAnchor:[12, 12]});
const mA = L.marker([0, 0], {draggable:true, icon:endIcon("A"), zIndexOffset:1000, pane:"volcanoes"});
const mB = L.marker([0, 0], {draggable:true, icon:endIcon("A′"), zIndexOffset:1000, pane:"volcanoes"});
const profQuakes = L.layerGroup();                 // events shown on the map while synced

function drawOverlay(){
  const n = 64, pts = [], left = [], right = [], half = P.width / 2;
  for (let i = 0; i <= n; i++) pts.push(along(P.A, P.B, i / n));
  for (let i = 0; i <= n; i++){
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)], br = bearing(a, b);
    left.push(dest(pts[i], br - Math.PI / 2, half)); right.push(dest(pts[i], br + Math.PI / 2, half));
  }
  lineLayer.setLatLngs(pts.map(p => [p.lat, p.lon]));
  swathLayer.setLatLngs([...left, ...right.reverse()].map(p => [p.lat, p.lon]));
  mA.setLatLng([P.A.lat, P.A.lon]); mB.setLatLng([P.B.lat, P.B.lon]);
}
let dragRaf = null;
function onDrag(){
  P.A = {lat:mA.getLatLng().lat, lon:mA.getLatLng().lng}; P.B = {lat:mB.getLatLng().lat, lon:mB.getLatLng().lng};
  if (dragRaf) return;
  dragRaf = requestAnimationFrame(() => { dragRaf = null; drawOverlay(); recompute(false); draw(); });
}
mA.on("drag", onDrag); mB.on("drag", onDrag);
mA.on("dragend", () => { recompute(true); }); mB.on("dragend", () => { recompute(true); });

// ------------------------------------------------------------ drawing mode
let drawing = null;
A.startProfile = function(){
  if (drawing) return cancelDraw();
  closePanel(true);
  drawing = {stage:0, tmp:L.polyline([], {renderer:A.renderer, color:"#b8321f", weight:2, dashArray:"6 4", interactive:false}).addTo(map)};
  map.getContainer().classList.add("drawing");
  map.doubleClickZoom.disable();
  setHint("Haz clic en el mapa para el punto <b>A</b> (Esc para cancelar)");
};
function setHint(html){ let h = $("#prof-hint"); if (!h){ h = document.createElement("div"); h.id = "prof-hint"; map.getContainer().appendChild(h); } h.innerHTML = html; h.style.display = html ? "block" : "none"; }
function cancelDraw(){
  if (!drawing) return;
  drawing.tmp.remove(); if (drawing.mk) drawing.mk.remove();
  drawing = null; map.getContainer().classList.remove("drawing"); map.doubleClickZoom.enable(); setHint("");
}
map.on("click", ev => {
  if (!drawing) return;
  setTimeout(() => map.closePopup(), 0);
  const p = {lat:ev.latlng.lat, lon:ev.latlng.lng};
  if (drawing.stage === 0){
    drawing.A = p; drawing.stage = 1;
    drawing.mk = L.marker([p.lat, p.lon], {icon:endIcon("A"), interactive:false, pane:"volcanoes"}).addTo(map);
    setHint("Ahora haz clic en el punto <b>A′</b>. Conviene trazar el corte perpendicular a la fosa.");
  } else {
    const a = drawing.A; cancelDraw();
    if (dist(a, p) < 5){ A.toast("El corte es demasiado corto (mínimo 5 km)."); return; }
    openProfile(a, p);
  }
});
map.on("mousemove", ev => {
  if (!drawing || drawing.stage !== 1) return;
  const b = {lat:ev.latlng.lat, lon:ev.latlng.lng}, pts = [];
  for (let i = 0; i <= 32; i++){ const q = along(drawing.A, b, i / 32); pts.push([q.lat, q.lon]); }
  drawing.tmp.setLatLngs(pts);
});
document.addEventListener("keydown", e => { if (e.key === "Escape"){ cancelDraw(); if (P.playing) togglePlay(false); } });

// ------------------------------------------------------------ panel
const panel = document.createElement("div");
panel.id = "profile"; panel.className = "prof hidden";
panel.innerHTML = `
  <div class="prof-h">
    <div class="prof-title"><div><b>Perfil A–A′</b> <span id="pf-info"></span></div>
      <div class="prof-wbtn"><button id="pf-min" title="Minimizar" aria-label="Minimizar perfil">–</button><button id="pf-close" title="Cerrar perfil" aria-label="Cerrar perfil">×</button></div></div>
    <div class="prof-ctrls">
      <label title="Ancho total de la franja">Ancho <input type="range" id="pf-width" min="0" max="100"><span id="pf-wval"></span></label>
      <label>M ≥ <select id="pf-mag"><option>4.5</option><option>5.0</option><option>5.5</option><option>6.0</option><option>6.5</option></select></label>
      <label title="Exageración vertical de la sección de profundidad">Exag. vert. <select id="pf-ve"><option value="auto">Auto</option><option value="1">1:1</option><option value="2">2:1</option><option value="5">5:1</option><option value="10">10:1</option></select></label>
      <label>Color <select id="pf-color"><option value="depth">Profundidad</option><option value="tect">Ambiente (Slab2)</option><option value="year">Año</option></select></label>
      <label title="Techo y base de la placa de Nazca según Slab2"><input type="checkbox" id="pf-slab" checked> Placa (Slab2)</label>
      <label title="Mostrar en el mapa solo los sismos del perfil y del intervalo de tiempo"><input type="checkbox" id="pf-sync" checked> Sincronizar mapa</label>
      <button id="pf-flip" title="Invertir la dirección del perfil (intercambiar A y A′)">⇄ Invertir</button>
      <button id="pf-share" title="Copiar un enlace que abre esta misma vista (perfil, filtros, capas y encuadre)">🔗 Compartir</button>
      <button id="pf-video" title="Generar un video (MP4) de la evolución temporal del perfil">🎬 Video</button>
      <button id="pf-png" title="Descargar el perfil como imagen">⤓ PNG</button>
      <button id="pf-csv" title="Descargar los sismos de la franja (CSV)">⤓ CSV</button>
    </div>
  </div>
  <div class="prof-body">
    <div class="prof-chart"><canvas id="pf-canvas"></canvas><div id="pf-tip" class="prof-tip"></div></div>
    <div class="prof-time">
      <button id="pf-play" class="pf-play" title="Reproducir" aria-label="Reproducir">▶</button>
      <select id="pf-mode" title="Modo de visualización en el tiempo">
        <option value="acum">Acumulado</option><option value="30">Ventana 30 días</option><option value="90">Ventana 90 días</option>
        <option value="365">Ventana 1 año</option><option value="730">Ventana 2 años</option>
      </select>
      <select id="pf-speed" title="Velocidad"><option value="0.5">×0.5</option><option value="1" selected>×1</option><option value="2">×2</option><option value="4">×4</option></select>
      <div class="pf-range">
        <canvas id="pf-hist"></canvas>
        <input type="range" id="pf-t0" min="0" max="1000" value="0" aria-label="Inicio del intervalo">
        <input type="range" id="pf-t1" min="0" max="1000" value="1000" aria-label="Fin del intervalo">
      </div>
      <div class="pf-dates"><span id="pf-d0"></span><span id="pf-d1"></span></div>
    </div>
  </div>`;
document.querySelector("main").appendChild(panel);                 // full-width bottom row (under the left column too)
["click","dblclick","mousedown","wheel","touchstart"].forEach(t => panel.addEventListener(t, e => e.stopPropagation()));
const cv = $("#pf-canvas"), tip = $("#pf-tip"), hcv = $("#pf-hist");

function openProfile(a, b, width){
  P.A = a; P.B = b; if (width) P.width = width;
  P.open = true; panel.classList.remove("hidden", "min"); map.invalidateSize();
  ov.addTo(map); mA.addTo(map); mB.addTo(map);
  if (P.t0 == null){ P.t0 = catStart(); P.t1 = Date.now(); }
  $("#pf-width").value = w2s(P.width);
  drawOverlay(); recompute(true); syncUrl();
  if (width){                                     // opened from a shared link: frame the swath above the panel
    map.fitBounds(swathLayer.getBounds(), {padding:[30, 30], maxZoom:8});
  }
}
A.openProfile = openProfile;
function closePanel(keepLine){
  if (P.playing) togglePlay(false);
  P.open = false; panel.classList.add("hidden"); map.invalidateSize();
  ov.remove(); mA.remove(); mB.remove();
  setSync(false); syncUrl(true);
}
$("#pf-close").onclick = () => closePanel(false);
$("#pf-min").onclick = () => { panel.classList.toggle("min"); $("#pf-min").textContent = panel.classList.contains("min") ? "▢" : "–"; map.invalidateSize(); setTimeout(draw, 50); };
$("#pf-width").oninput = e => { P.width = s2w(+e.target.value); drawOverlay(); recompute(false); };
$("#pf-width").onchange = () => { syncUrl(); };
$("#pf-mag").onchange = e => { P.magMin = +e.target.value; recompute(false); };
$("#pf-ve").onchange = e => { P.ve = e.target.value; draw(); };
$("#pf-color").onchange = e => { P.color = e.target.value; draw(); scheduleMapSync(); };
$("#pf-slab").onchange = e => { P.showSlab = e.target.checked; draw(); };
$("#pf-sync").onchange = e => { P.sync = e.target.checked; setSync(P.sync); };
$("#pf-mode").onchange = e => { P.mode = e.target.value; if (P.mode !== "acum") P.win = +P.mode; updateTime(); };
$("#pf-speed").onchange = e => { P.speed = +e.target.value; };
$("#pf-play").onclick = () => togglePlay(!P.playing);
$("#pf-csv").onclick = exportCSV;
$("#pf-flip").onclick = () => { const a = P.A; P.A = P.B; P.B = a; drawOverlay(); recompute(true); syncUrl(); };
$("#pf-png").onclick = exportPNG;
$("#pf-share").onclick = () => A.openShare();
$("#pf-video").onclick = () => A.openVideo();

// ------------------------------------------------------------ data selection
const catStart = () => A.ALL.length ? A.ALL[A.ALL.length - 1].t : Date.now() - 365 * A.DAY;
// Projections depend only on the line A–A′ (and the magnitude threshold); they are cached so
// that moving the width slider is just a filter on the cached cross-track distances.
let geomKey = "";
function projectAll(){
  P.L = dist(P.A, P.B); P.brg = bearing(P.A, P.B);
  const HMAX = WIDTH_MAX / 2;
  P.cand = [];
  A.ALL.forEach(e => {
    if (e.mag < P.magMin - 1e-9) return;
    const q = project(e);
    if (q.at < -1e-6 || q.at > P.L + 1e-6 || Math.abs(q.xt) > HMAX) return;
    P.cand.push({e, at:q.at, xt:q.xt});
  });
  // faults: crossings of the section line + apparent dip
  P.faults = [];
  A.layers.faults.eachLayer(l => {
    const g = l.feature.geometry, p = l.feature.properties;
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    lines.forEach(cs => {
      let prev = null;
      cs.forEach(([lon, lat]) => {
        const q = project({lat, lon});
        if (prev && Math.sign(prev.xt) !== Math.sign(q.xt) && Math.abs(prev.xt - q.xt) > 0){
          const f = prev.xt / (prev.xt - q.xt), at = prev.at + f * (q.at - prev.at);
          if (at >= 0 && at <= P.L && Math.abs(prev.at - q.at) < 200) P.faults.push({at, p, dip:parseDip(p)});
        }
        prev = {...q, lat, lon};
      });
    });
  });
  // apparent dip: tan(a) = tan(dip)·|cos(angle between section azimuth and dip direction)|
  P.faults.forEach(f => {
    if (f.dip == null) return;
    if (f.dip >= 89.5){ f.app = 90; f.side = 0; return; }
    const dd = DIRAZ[f.p.buz_dir]; if (dd == null){ f.dip = null; return; }
    const c = Math.cos(rad(dd) - P.brg);
    f.app = deg(Math.atan(Math.tan(rad(f.dip)) * Math.abs(c)));
    f.side = c >= 0 ? 1 : -1;                     // +1: dips towards A′
  });
  P.citiesAll = []; [A.layers.citiesMain, A.layers.citiesSec].forEach(g => g.eachLayer(m => {
    const ll = m.getLatLng(), q = project({lat:ll.lat, lon:ll.lng});
    if (q.at >= 0 && q.at <= P.L) P.citiesAll.push({at:q.at, xt:q.xt, name:m.getTooltip().getContent(), main:m.options.main});
  }));
  P.volcsAll = []; A.layers.volcanoes.eachLayer(m => {
    const ll = m.getLatLng(), q = project({lat:ll.lat, lon:ll.lng});
    if (q.at >= 0 && q.at <= P.L) P.volcsAll.push({at:q.at, xt:q.xt, p:m.options.volc});
  });
  sampleSlab();
}
function filterWidth(){
  const half = P.width / 2, half2 = Math.min(half, 60);      // surface features: within the swath (≤ 60 km)
  P.ev = P.cand.filter(x => Math.abs(x.xt) <= half);
  P.cities = P.citiesAll.filter(c => Math.abs(c.xt) <= half2);
  P.volcs = P.volcsAll.filter(v => Math.abs(v.xt) <= Math.max(half2, 30));
  $("#pf-wval").textContent = `${nf(P.width)} km`;
}
function recompute(withTopo, force){
  if (!P.A) return;
  const key = [P.A.lat, P.A.lon, P.B.lat, P.B.lon, P.magMin, A.ALL.length].join(",");
  if (force || key !== geomKey){ geomKey = key; projectAll(); }
  filterWidth();
  drawHist(); updateTime(true);
  if (withTopo) loadTopo();
}
const DIRAZ = {N:0, NE:45, E:90, SE:135, S:180, SO:225, O:270, NO:315};
function parseDip(p){ const m = String(p.average_dip || "").match(/\(?\s*([\d.]+)/); return m ? +m[1] : null; }

// ------------------------------------------------------------ topography (AWS Terrain Tiles, Terrarium encoding)
const tileCache = new Map();
function tileData(z, x, y){
  const k = `${z}/${x}/${y}`;
  if (!tileCache.has(k)) tileCache.set(k, new Promise(res => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d"); g.drawImage(img, 0, 0); try { res(g.getImageData(0, 0, 256, 256).data); } catch (e) { res(null); } };
    img.onerror = () => res(null);
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  }));
  return tileCache.get(k);
}
async function loadTopo(){
  const n = 500, key = `${P.A.lat},${P.A.lon},${P.B.lat},${P.B.lon}`;
  if (P.topoKey === key && P.topo) return;
  P.topoKey = key; P.topo = null; draw();
  const mPerSample = P.L * 1000 / n;
  const z = Math.max(3, Math.min(11, Math.floor(Math.log2(156543 * Math.cos(rad((P.A.lat + P.B.lat) / 2)) / mPerSample))));
  const N = 1 << z, pts = [];
  for (let i = 0; i < n; i++){
    const q = along(P.A, P.B, i / (n - 1));
    const xf = (q.lon + 180) / 360 * N, s = Math.sin(rad(q.lat)), yf = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N;
    pts.push({tx:Math.floor(xf), ty:Math.floor(yf), px:Math.min(255, Math.floor((xf % 1) * 256)), py:Math.min(255, Math.floor((yf % 1) * 256))});
  }
  const elev = new Float32Array(n);
  await Promise.all([...new Set(pts.map(p => `${p.tx},${p.ty}`))].map(k => { const [x, y] = k.split(",").map(Number); return tileData(z, x, y); }));
  for (let i = 0; i < n; i++){
    const p = pts[i], d = await tileData(z, p.tx, p.ty);
    if (!d){ elev[i] = NaN; continue; }
    const o = (p.py * 256 + p.px) * 4; elev[i] = d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  }
  if (P.topoKey !== key) return;                  // the line moved meanwhile
  P.topo = {elev, n, z};
  draw();
}
function elevAt(km){
  if (!P.topo) return 0;
  const i = Math.round(km / P.L * (P.topo.n - 1)), v = P.topo.elev[Math.max(0, Math.min(P.topo.n - 1, i))];
  return isNaN(v) ? 0 : v;
}

// ------------------------------------------------------------ time
const tAt = v => catStart() + (Date.now() - catStart()) * v / 1000;
const vAt = t => Math.round(1000 * (t - catStart()) / (Date.now() - catStart()));
function curWindow(){ return P.mode === "acum" ? [P.t0, P.t1] : [Math.max(P.t0, P.t1 - P.win * A.DAY), P.t1]; }
function updateTime(silent){
  $("#pf-t0").value = vAt(P.t0); $("#pf-t1").value = vAt(P.t1);
  const [a, b] = curWindow();
  $("#pf-d0").textContent = A.fmtDate(a); $("#pf-d1").textContent = A.fmtDate(b);
  drawHist(); draw(); scheduleMapSync();
  if (!silent) syncUrl();
}
$("#pf-t0").oninput = e => { P.t0 = Math.min(tAt(+e.target.value), P.t1 - A.DAY); updateTime(); };
$("#pf-t1").oninput = e => { P.t1 = Math.max(tAt(+e.target.value), P.t0 + A.DAY); updateTime(); };
let raf = null, last = 0;
function togglePlay(on){
  P.playing = on; $("#pf-play").textContent = on ? "❚❚" : "▶"; $("#pf-play").title = on ? "Pausar" : "Reproducir";
  if (on){
    if (P.t1 >= Date.now() - A.DAY) P.t1 = P.mode === "acum" ? P.t0 + A.DAY : Math.min(Date.now(), P.t0 + P.win * A.DAY);
    last = performance.now(); raf = requestAnimationFrame(step);
  } else if (raf){ cancelAnimationFrame(raf); raf = null; }
}
function step(now){
  const dt = Math.min(100, now - last); last = now;
  const span = Date.now() - P.t0, rate = span / 25000 * P.speed;     // whole interval in ~25 s at ×1
  P.t1 = Math.min(Date.now(), P.t1 + rate * dt);
  updateTime(true);
  if (P.t1 >= Date.now()){ togglePlay(false); syncUrl(); return; }
  raf = requestAnimationFrame(step);
}
function visibleEvents(){ const [a, b] = curWindow(); return P.ev.filter(x => x.e.t >= a && x.e.t <= b); }

// ------------------------------------------------------------ map synchronisation
let syncT = null, quakesWereOn = true;
function setSync(on){
  if (on && P.open){
    if (!map.hasLayer(profQuakes)){ quakesWereOn = map.hasLayer(A.layers.quakes); map.removeLayer(A.layers.quakes); profQuakes.addTo(map); }
    scheduleMapSync();
  } else if (map.hasLayer(profQuakes)){
    profQuakes.remove(); profQuakes.clearLayers(); shownIds = new Set(); if (quakesWereOn) A.layers.quakes.addTo(map); A.restack();
  }
}
function scheduleMapSync(){
  if (!P.open || !P.sync || syncT) return;
  syncT = requestAnimationFrame(() => { syncT = null; mapSync(); });       // at most one map update per frame
}
const pool = new Map();                    // event id -> circle marker (created once, reused)
let shownIds = new Set(), styleKey = "";
function markerFor(e){
  let m = pool.get(e.id);
  if (!m){
    m = L.circleMarker([e.lat, e.lon], {renderer:A.renderer, radius:A.radiusOf(e.mag), color:"#2b2b2b", weight:.7, fillColor:colorOf(e), fillOpacity:.9});
    m.bindTooltip(() => `M${e.mag.toFixed(1)} · ${esc(e.ref)}<br>${A.fmtLocal(e.t, false)} · ${e.prof ?? "?"} km`, {direction:"top", offset:[0, -4]});
    m.on("click", () => L.popup({maxWidth:340}).setLatLng([e.lat, e.lon]).setContent(A.popupHtml(e)).openOn(map));
    pool.set(e.id, m);
  }
  return m;
}
function mapSync(){
  if (!P.open || !P.sync) return;
  if (!map.hasLayer(profQuakes)) setSync(true);
  const [a, b] = curWindow(), vis = visibleEvents(), next = new Set(vis.map(x => x.e.id));
  // remove markers that left the swath/interval, add the ones that entered (small diff while dragging)
  shownIds.forEach(id => { if (!next.has(id)) profQuakes.removeLayer(pool.get(id)); });
  const added = vis.filter(x => !shownIds.has(x.e.id)).sort((x, y) => x.e.mag - y.e.mag);
  added.forEach(({e}) => profQuakes.addLayer(markerFor(e)));
  // restyle only when colours/fading can change
  const key = P.color + "|" + A.theme;
  const fade = P.mode !== "acum";
  if (fade || key !== styleKey || added.length){
    (fade || key !== styleKey ? vis : added).forEach(({e}) => {
      const age = fade ? (b - e.t) / Math.max(1, b - a) : 0;
      pool.get(e.id).setStyle({fillColor:colorOf(e), fillOpacity:.9 - .6 * age, opacity:1 - .6 * age});
    });
    styleKey = key;
  }
  shownIds = next;
}
A._profMapSync = mapSync;

// ------------------------------------------------------------ colours
const YEAR_COLS = ["#440154","#46327e","#365c8d","#277f8e","#1fa187","#4ac16d","#a0da39","#fde725"];
// slab top / bottom / uncertainty sampled along the section
P.showSlab = true;
function sampleSlab(){
  P.slabProf = null;
  if (!A.slab || !A.slab.ready) return;
  const n = 300, pts = [];
  for (let i = 0; i < n; i++){ const q = along(P.A, P.B, i / (n - 1)), s = A.slab.at(q.lat, q.lon); pts.push({at:i / (n - 1) * P.L, ...s}); }
  P.slabProf = pts.some(p => !isNaN(p.top)) ? pts : null;
}
function colorOf(e){
  if (P.color === "tect" && e.slab && A.SLAB_CLASSES) return A.SLAB_CLASSES[e.slab.cls].color;
  if (P.color === "year"){ const y0 = A.limaParts(catStart()).y, y1 = A.limaParts(Date.now()).y, y = A.limaParts(e.t).y;
    const f = y1 === y0 ? 1 : (y - y0) / (y1 - y0); return YEAR_COLS[Math.round(f * (YEAR_COLS.length - 1))]; }
  return A.depthColor(e.prof);
}
const TH = () => A.theme === "dark"
  ? {bg:"#1a1f26", ink:"#e4e7eb", muted:"#a3acb7", grid:"#2c333c", axis:"#5b636d", land:"#7a6a52", landLine:"#c9b48f", sea:"#2b5f8a", seaLine:"#6fb0e6", label:"#f3f4f6", halo:"rgba(0,0,0,.85)", stroke:"#111"}
  : {bg:"#ffffff", ink:"#1d232b", muted:"#56606b", grid:"#eeece7", axis:"#c3bfb7", land:"#d8c8a8", landLine:"#7a6440", sea:"#a9cbe6", seaLine:"#3b78ad", label:"#111", halo:"rgba(255,255,255,.95)", stroke:"#2b2b2b"};

function niceStep(range, n){ const raw = range / n, m = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(f => f * m).find(s => s >= raw); }

// ------------------------------------------------------------ main drawing
function layout(w, h, legW){
  const m = {l:56, r:legW ? legW + 26 : 16, t:18, b:30}, topoH = Math.max(60, Math.min(110, h * .26)), gap = 4;
  return {w, h, m, topoH, y0:m.t + topoH + gap, plotW:w - m.l - m.r, plotH:h - (m.t + topoH + gap) - m.b};
}
function draw(target){
  if (!P.open || !P.A || panel.classList.contains("min")) return;
  const box = target && target.__w ? {width:target.__w, height:target.__h} : cv.parentElement.getBoundingClientRect(); if (!box.width) return;
  const dpr = window.devicePixelRatio || 1, W = Math.round(box.width), H = Math.round(box.height);
  const c = target || cv;
  if (!target){ c.width = W * dpr; c.height = H * dpr; c.style.width = W + "px"; c.style.height = H + "px"; }
  const g = c.getContext("2d"); g.setTransform(target ? target.__scale : dpr, 0, 0, target ? target.__scale : dpr, 0, 0);
  if (target && target.__w) g.clearRect(0, 0, W, H);
  const T = TH(), F = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  // legend contents first: its width sets the right margin of the plot
  const leg = {items:[], sl:P.showSlab && P.slabProf, title:"", w:0};
  if (P.color === "tect" && A.SLAB_CLASSES){ const present = new Set(visibleEvents().map(v => v.e.slab && v.e.slab.cls)); leg.title = "Ambiente (Slab2)"; leg.items = A.SLAB_ORDER.filter(k => present.has(k)).map(k => ({c:A.SLAB_CLASSES[k].color, t:A.SLAB_CLASSES[k].short})); }
  else if (P.color === "depth"){ leg.title = "Profundidad"; leg.items = A.DEPTH_COLORS.map(c => ({c:c[1], t:c[2]})); }
  else if (P.color === "year"){ const y0y = A.limaParts(catStart()).y, y1y = A.limaParts(Date.now()).y; leg.title = "Año"; for (let y = y0y; y <= y1y; y++) leg.items.push({c:colorOf({t:A.limaStart(y, 7, 1)}), t:String(y)}); }
  g.font = `11px ${F}`;
  // rows of the legend (title, colour items, slab entries, size note); 15 px each
  leg.rows = [];
  if (leg.title) leg.rows.push({k:"title", t:leg.title});
  leg.items.forEach(i => leg.rows.push({k:"dot", ...i}));
  if (leg.sl) leg.rows.push({k:"gap"}, {k:"top", t:"Techo de la placa"}, {k:"unc", t:"Incertidumbre (Slab2)"}, {k:"bot", t:"Base de la placa"});
  leg.rows.push({k:"gap"}, {k:"note", t:"Tamaño ∝ magnitud"});
  const colW = Math.max(...leg.rows.map(r => r.t ? g.measureText(r.t).width + (r.k === "title" || r.k === "note" ? 4 : 18) : 0));
  let lay = layout(W, H, colW);
  const rowH = r => r.k === "gap" ? 6 : 15, need = leg.rows.reduce((s, r) => s + rowH(r), 0) + 4;
  leg.cols = need > lay.plotH ? 2 : 1;
  leg.colW = colW; leg.w = colW * leg.cols + (leg.cols - 1) * 14;
  if (leg.cols === 2) lay = layout(W, H, leg.w);
  const {m, topoH, y0, plotW, plotH} = lay;
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
  const X = km => m.l + km / P.L * plotW;
  // depth scale
  const slabMax = P.showSlab && P.slabProf ? Math.max(0, ...P.slabProf.filter(p => !isNaN(p.top)).map(p => p.top)) : 0;
  const maxDepthData = Math.max(50, slabMax * 1.05, ...P.ev.map(x => x.e.prof || 0));
  let dmax, veEff;
  if (P.ve === "auto"){ const st = niceStep(maxDepthData, 5); dmax = Math.ceil(maxDepthData * 1.05 / st) * st; veEff = (plotH / dmax) / (plotW / P.L); }
  else { veEff = +P.ve; dmax = plotH / (plotW / P.L) / veEff; }
  const Y = d => y0 + d / dmax * plotH;
  // topography scale
  let eMin = -500, eMax = 1000;
  if (P.topo){ const v = [...P.topo.elev].filter(x => !isNaN(x)); if (v.length){ eMin = Math.min(-200, Math.min(...v)); eMax = Math.max(500, Math.max(...v)); } }
  const padE = (eMax - eMin) * .12, Yt = e => m.t + (eMax + padE - e) / (eMax + padE - eMin) * topoH;
  // grid + axes (depth panel)
  g.font = `11px ${F}`; g.textBaseline = "middle"; g.lineWidth = 1;
  const ds = niceStep(dmax, 6);
  for (let d = 0; d <= dmax + 1e-6; d += ds){ g.strokeStyle = T.grid; g.beginPath(); g.moveTo(m.l, Y(d)); g.lineTo(m.l + plotW, Y(d)); g.stroke(); g.fillStyle = T.muted; g.textAlign = "right"; g.fillText(nf(d), m.l - 6, Y(d)); }
  const xs = niceStep(P.L, Math.max(3, Math.floor(plotW / 90)));
  g.textAlign = "center"; g.textBaseline = "top";
  for (let k = 0; k <= P.L + 1e-6; k += xs){ g.strokeStyle = T.grid; g.beginPath(); g.moveTo(X(k), y0); g.lineTo(X(k), y0 + plotH); g.stroke(); g.fillStyle = T.muted; g.fillText(nf(k), X(k), y0 + plotH + 4); }
  g.strokeStyle = T.axis; g.strokeRect(m.l + .5, y0 + .5, plotW, plotH);
  g.fillStyle = T.muted; g.textAlign = "right"; g.fillText(`Distancia desde A (km) · exageración vertical ${veEff >= 1.95 ? Math.round(veEff) : veEff.toFixed(1)}:1`, m.l + plotW, y0 + plotH + 17);
  g.save(); g.translate(13, y0 + plotH / 2); g.rotate(-Math.PI / 2); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("Profundidad (km)", 0, 0); g.restore();
  // topography panel
  g.save(); g.beginPath(); g.rect(m.l, m.t, plotW, topoH); g.clip();
  if (P.topo){
    const n = P.topo.n, xk = i => X(i / (n - 1) * P.L);
    g.beginPath(); g.moveTo(X(0), m.t + topoH);
    for (let i = 0; i < n; i++){ const e = P.topo.elev[i]; g.lineTo(xk(i), Yt(isNaN(e) ? 0 : e)); }
    g.lineTo(X(P.L), m.t + topoH); g.closePath(); g.fillStyle = T.land; g.fill();
    // water above the sea floor
    g.fillStyle = T.sea;
    for (let i = 0; i < n - 1; i++){ const e = P.topo.elev[i]; if (e < 0){ const x0 = xk(i), x1 = xk(i + 1) + .5; g.fillRect(x0, Yt(0), x1 - x0, Yt(e) - Yt(0)); } }
    g.beginPath(); for (let i = 0; i < n; i++){ const e = P.topo.elev[i]; i ? g.lineTo(xk(i), Yt(isNaN(e) ? 0 : e)) : g.moveTo(xk(i), Yt(isNaN(e) ? 0 : e)); }
    g.strokeStyle = T.landLine; g.lineWidth = 1.2; g.stroke();
    g.setLineDash([4, 3]); g.strokeStyle = T.seaLine; g.lineWidth = 1; g.beginPath(); g.moveTo(m.l, Yt(0)); g.lineTo(m.l + plotW, Yt(0)); g.stroke(); g.setLineDash([]);
  } else { g.fillStyle = T.muted; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("Cargando topografía…", m.l + plotW / 2, m.t + topoH / 2); }
  g.restore();
  g.strokeStyle = T.axis; g.lineWidth = 1; g.strokeRect(m.l + .5, m.t + .5, plotW, topoH);
  g.fillStyle = T.muted; g.textAlign = "right"; g.textBaseline = "middle"; g.font = `10px ${F}`;
  if (P.topo){
    const used = [];
    [0, eMax, eMin].forEach(e => { const y = Yt(e); if (used.some(u => Math.abs(u - y) < 12) || Math.abs(y - y0) < 9) return; used.push(y); g.fillText(`${e === 0 ? "0" : nf(e / 1000, 1)} km`, m.l - 6, y); });
  }
  // A / A′ labels
  g.font = `700 13px ${F}`; g.fillStyle = T.ink; g.textBaseline = "bottom";
  g.textAlign = "left"; g.fillText("A", m.l, m.t - 2); g.textAlign = "right"; g.fillText("A′", m.l + plotW, m.t - 2);

  // Slab2: uncertainty band around the slab top, slab top (solid) and bottom (dashed)
  if (P.showSlab && P.slabProf){
    const sp = P.slabProf, col = A.theme === "dark" ? "#c9a7ff" : "#6a3d9a";
    g.save(); g.beginPath(); g.rect(m.l, y0, plotW, plotH); g.clip();
    const runs = []; let cur = [];
    sp.forEach(p => { if (isNaN(p.top)){ if (cur.length) runs.push(cur); cur = []; } else cur.push(p); }); if (cur.length) runs.push(cur);
    runs.forEach(r => {
      g.beginPath(); r.forEach((p, i) => { const y = Y(Math.max(0, p.top - (p.unc || 0))); i ? g.lineTo(X(p.at), y) : g.moveTo(X(p.at), y); });
      [...r].reverse().forEach(p => g.lineTo(X(p.at), Y(p.top + (p.unc || 0))));
      g.closePath(); g.fillStyle = A.theme === "dark" ? "rgba(201,167,255,.16)" : "rgba(106,61,154,.12)"; g.fill();
      g.beginPath(); r.forEach((p, i) => i ? g.lineTo(X(p.at), Y(p.top)) : g.moveTo(X(p.at), Y(p.top))); g.strokeStyle = col; g.lineWidth = 2.2; g.stroke();
      g.beginPath(); r.forEach((p, i) => i ? g.lineTo(X(p.at), Y(p.bot)) : g.moveTo(X(p.at), Y(p.bot))); g.setLineDash([6, 4]); g.lineWidth = 1.4; g.stroke(); g.setLineDash([]);
    });
    P._slabLabelRun = runs.sort((a, b) => b.length - a.length)[0];
    g.restore();
    const shallowest = Math.min(...sp.filter(p => !isNaN(p.top)).map(p => p.top));
    if (shallowest > dmax){
      g.font = `italic 11px ${F}`; g.textAlign = "center"; g.textBaseline = "bottom"; g.fillStyle = col;
      g.fillText(`La placa de Nazca (Slab2) está a más de ${nf(dmax)} km en este corte: use la exageración vertical «Auto» o una menor para verla.`, m.l + plotW / 2, y0 + plotH - 6);
    }
  }
  // fault crossings: surface tick + apparent dip down to 20 km (typical crustal seismogenic depth),
  // at most 60 km horizontally; short dashed tick when the dip is unknown
  P.hits = [];
  P.faults.forEach(f => {
    const st = A.faultStyleOf(f.p.clase), x = X(f.at), ys = Yt(elevAt(f.at));
    g.strokeStyle = st[0]; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(x, ys - 7); g.lineTo(x, ys + 3); g.stroke();
    g.beginPath(); g.lineWidth = 1.8;
    if (f.dip != null){
      let zd = Math.min(20, dmax), dx = f.app >= 89.9 ? 0 : zd / Math.tan(rad(f.app));
      if (Math.abs(dx) > 60){ zd *= 60 / Math.abs(dx); dx = 60; }
      g.moveTo(x, y0); g.lineTo(X(f.at + dx * f.side), Y(zd)); g.stroke();
    } else { g.setLineDash([3, 3]); g.moveTo(x, y0); g.lineTo(x, Y(Math.min(15, dmax))); g.stroke(); g.setLineDash([]); }
    P.hits.push({x, y:ys - 2, r:7, kind:"falla", f});
  });
  // events
  const [ta, tb] = curWindow(), vis = visibleEvents().sort((a, b) => a.e.mag - b.e.mag);
  vis.forEach(v => {
    const e = v.e, x = X(v.at), y = Y(e.prof || 0), r = Math.max(2.5, A.radiusOf(e.mag) * .8);
    const age = P.mode === "acum" ? 0 : (tb - e.t) / Math.max(1, tb - ta);
    g.globalAlpha = 1 - .7 * age;
    g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = colorOf(e); g.fill();
    g.lineWidth = .8; g.strokeStyle = T.stroke; g.stroke();
    if (P.playing && tb - e.t < (tb - ta) * .04 + 3 * A.DAY){ g.globalAlpha = 1; g.lineWidth = 2; g.strokeStyle = A.theme === "dark" ? "#fff" : "#000"; g.beginPath(); g.arc(x, y, r + 3, 0, 2 * Math.PI); g.stroke(); }
    g.globalAlpha = 1;
    P.hits.push({x, y, r:Math.max(r, 5), kind:"sismo", e, v});
  });
  // surface: volcanoes and cities (labels decluttered)
  const placed = [];
  const label = (txt, x, y, font, col) => {
    g.font = font; const w = g.measureText(txt).width;
    let lx = x + 6; if (lx + w > m.l + plotW) lx = x - 6 - w;
    const rect = [lx - 2, y - 7, lx + w + 2, y + 7];
    if (placed.some(q => rect[0] < q[2] && rect[2] > q[0] && rect[1] < q[3] && rect[3] > q[1])) return;
    placed.push(rect); g.textAlign = "left"; g.textBaseline = "middle"; g.lineJoin = "round";
    g.lineWidth = 3; g.strokeStyle = T.halo; g.strokeText(txt, lx, y); g.fillStyle = col; g.fillText(txt, lx, y);
  };
  [...P.volcs].sort((a, b) => ["Muy alta","Alta","Moderada","Baja","Muy baja"].indexOf(a.p.peligrosidad) - ["Muy alta","Alta","Moderada","Baja","Muy baja"].indexOf(b.p.peligrosidad)).forEach(v => {
    const x = X(v.at), y = Yt(elevAt(v.at)) - 6, s = 13, act = v.p.estado === "Activo", col = A.VOLC_COLORS[v.p.peligrosidad];
    g.beginPath(); g.moveTo(x, y - s * .55); g.lineTo(x + s * .5, y + s * .4); g.lineTo(x - s * .5, y + s * .4); g.closePath();
    g.fillStyle = act ? col : "#fff"; g.fill(); g.lineWidth = act ? 1.2 : 2.4; g.strokeStyle = act ? "#1a1a1a" : col; g.stroke();
    label(v.p.nombre.replace("Campo volcánico monogenético ", "CVM "), x, y - 11, `italic 650 10.5px ${F}`, A.theme === "dark" ? "#ffb199" : "#7a1b0c");
    P.hits.push({x, y, r:9, kind:"volcan", v});
  });
  [...P.cities].sort((a, b) => b.main - a.main).forEach(ci => {
    const x = X(ci.at), y = Yt(elevAt(ci.at));
    g.beginPath(); g.arc(x, y, ci.main ? 4 : 3, 0, 2 * Math.PI);
    g.fillStyle = ci.main ? "#fff" : "#000"; g.fill(); g.lineWidth = ci.main ? 1.8 : 1.2; g.strokeStyle = ci.main ? "#000" : "#fff"; g.stroke();
    label(ci.name, x, y - 9, `${ci.main ? 650 : 400} ${ci.main ? 11 : 10}px ${F}`, T.label);
  });
  // slab label, on top of the events (placed under the slab top line, on its longest stretch)
  if (P.showSlab && P.slabProf && P._slabLabelRun && P._slabLabelRun.length > 10){
    const r = P._slabLabelRun, p = r[Math.floor(r.length * .55)], col = A.theme === "dark" ? "#c9a7ff" : "#6a3d9a";
    g.save(); g.beginPath(); g.rect(m.l, y0, plotW, plotH); g.clip();
    g.font = `italic 650 11px ${F}`; g.textAlign = "left"; g.textBaseline = "top"; g.lineWidth = 3.5; g.strokeStyle = T.halo; g.lineJoin = "round";
    g.strokeText("Placa de Nazca (Slab2)", X(p.at) + 6, Y(p.top) + 6); g.fillStyle = col; g.fillText("Placa de Nazca (Slab2)", X(p.at) + 6, Y(p.top) + 6);
    g.restore();
  }
  // legend, in its own column to the right of the plot (never over the data)
  if (leg.w){
    const col = A.theme === "dark" ? "#c9a7ff" : "#6a3d9a", x0 = m.l + plotW + 14, yTop = y0 + 2, yMax = y0 + plotH;
    let c = 0, yy = yTop;
    g.textAlign = "left"; g.textBaseline = "middle";
    leg.rows.forEach(r => {
      const h = r.k === "gap" ? 6 : 15;
      if (yy + h > yMax && c < leg.cols - 1 && r.k !== "gap"){ c++; yy = yTop; }
      if (r.k === "gap"){ yy += h; return; }
      const bx = x0 + c * (leg.colW + 14), cy = yy + h / 2;
      g.font = r.k === "title" ? `700 11px ${F}` : `11px ${F}`; g.fillStyle = r.k === "note" ? T.muted : T.ink;
      if (r.k === "dot"){ g.beginPath(); g.arc(bx + 6, cy, 4.5, 0, 2 * Math.PI); g.fillStyle = r.c; g.fill(); g.strokeStyle = T.stroke; g.lineWidth = .8; g.stroke(); g.fillStyle = T.ink; g.fillText(r.t, bx + 18, cy); }
      else if (r.k === "top"){ g.strokeStyle = col; g.lineWidth = 2.2; g.beginPath(); g.moveTo(bx, cy); g.lineTo(bx + 13, cy); g.stroke(); g.fillText(r.t, bx + 18, cy); }
      else if (r.k === "unc"){ g.fillStyle = A.theme === "dark" ? "rgba(201,167,255,.25)" : "rgba(106,61,154,.18)"; g.fillRect(bx, cy - 5, 13, 10); g.fillStyle = T.ink; g.fillText(r.t, bx + 18, cy); }
      else if (r.k === "bot"){ g.strokeStyle = col; g.setLineDash([5, 3]); g.lineWidth = 1.4; g.beginPath(); g.moveTo(bx, cy); g.lineTo(bx + 13, cy); g.stroke(); g.setLineDash([]); g.fillText(r.t, bx + 18, cy); }
      else g.fillText(r.t, bx, cy);
      yy += h;
    });
  }
  // time label while playing
  if ((P.playing || P.mode !== "acum") && !(target && target.__w)){        // video frames show the date in their header
    g.font = `700 13px ${F}`; g.textAlign = "right"; g.textBaseline = "top"; g.fillStyle = T.ink;
    g.fillText(P.mode === "acum" ? `hasta ${A.fmtDate(tb)}` : `${A.fmtDate(ta)} – ${A.fmtDate(tb)}`, m.l + plotW - 6, y0 + 6);
  }
  // info line
  if (!target) $("#pf-info").textContent = `· ${nf(P.L)} km · franja ${nf(P.width)} km · ${nf(vis.length)} de ${nf(P.ev.length)} sismos M ≥ ${P.magMin.toFixed(1)} · ${P.faults.length} cruces de fallas · ${P.volcs.length} volcanes`;
  return {lay, veEff, vis};
}

// ------------------------------------------------------------ histogram under the time slider
function drawHist(){
  const box = hcv.getBoundingClientRect(); if (!box.width || !P.open) return;
  const dpr = window.devicePixelRatio || 1, W = box.width, H = box.height;
  hcv.width = W * dpr; hcv.height = H * dpr; const g = hcv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t0 = catStart(), t1 = Date.now(), nb = Math.max(12, Math.floor(W / 6)), bins = new Array(nb).fill(0);
  P.ev.forEach(x => { const i = Math.min(nb - 1, Math.floor((x.e.t - t0) / (t1 - t0) * nb)); if (i >= 0) bins[i]++; });
  const mx = Math.max(1, ...bins), [a, b] = curWindow(), T = TH();
  bins.forEach((n, i) => {
    const bt = t0 + (i + .5) / nb * (t1 - t0), on = bt >= a && bt <= b, h = n / mx * (H - 4);
    g.fillStyle = on ? (A.theme === "dark" ? "#ff6b55" : "#b8321f") : (A.theme === "dark" ? "#4a525c" : "#c9ced4");
    g.fillRect(i / nb * W + .5, H - h, W / nb - 1, h);
  });
}

// ------------------------------------------------------------ hover / click on the chart
function hitAt(px, py){
  let best = null, bd = 1e9;
  P.hits.forEach(h => { const d = Math.hypot(h.x - px, h.y - py); if (d <= h.r + 6 && d < bd){ bd = d; best = h; } });
  return best;
}
cv.addEventListener("mousemove", ev => {
  const r = cv.getBoundingClientRect(), h = hitAt(ev.clientX - r.left, ev.clientY - r.top);
  if (!h){ tip.style.display = "none"; cv.style.cursor = "default"; return; }
  cv.style.cursor = h.kind === "sismo" ? "pointer" : "default";
  let html = "";
  if (h.kind === "sismo"){ const e = h.e; html = `<b>M${e.mag.toFixed(1)}</b> · ${e.prof ?? "?"} km · ${A.fmtLocal(e.t, false)}<br>${esc(e.ref)}<br><span class="tip-sub">${nf(h.v.at)} km desde A · ${nf(Math.abs(h.v.xt))} km fuera del corte${e.slab ? "<br>Ambiente (Slab2): " + esc(A.slab.text(e)) : ""}</span>`; }
  else if (h.kind === "volcan"){ const p = h.v.p; html = `<b>Volcán ${esc(p.nombre)}</b><br><span class="tip-sub">${esc(p.estado)} · peligrosidad ${esc(p.peligrosidad.toLowerCase())} · ${nf(Math.abs(h.v.xt))} km del corte</span>`; }
  else { const f = h.f; html = `<b>${esc(f.p.nombre || "Falla sin nombre")}</b><br><span class="tip-sub">${esc(f.p.tipo)}${f.dip != null ? ` · buzamiento ${f.dip}° ${esc(f.p.buz_dir || "")} (aparente en el corte: ${Math.round(f.app)}°)` : " · buzamiento desconocido"}</span>`; }
  tip.innerHTML = html; tip.style.display = "block";
  const tx = Math.min(ev.clientX - r.left + 14, r.width - tip.offsetWidth - 4);
  tip.style.left = tx + "px"; tip.style.top = Math.max(4, ev.clientY - r.top - tip.offsetHeight - 8) + "px";
});
cv.addEventListener("mouseleave", () => tip.style.display = "none");
cv.addEventListener("click", ev => {
  const r = cv.getBoundingClientRect(), h = hitAt(ev.clientX - r.left, ev.clientY - r.top);
  if (h && h.kind === "sismo"){ const e = h.e; map.panTo([e.lat, e.lon]); L.popup({maxWidth:340}).setLatLng([e.lat, e.lon]).setContent(A.popupHtml(e)).openOn(map); }
});
new ResizeObserver(() => { draw(); drawHist(); }).observe(panel);

// ------------------------------------------------------------ export
function exportCSV(){
  const rows = [["codigo","fecha_utc","latitud","longitud","magnitud","profundidad_km","distancia_desde_A_km","distancia_al_corte_km","ambiente_slab2","en_limite_con","techo_placa_km","dist_vertical_al_techo_km","tolerancia_km","referencia"]];
  const [a, b] = curWindow();
  P.ev.filter(x => x.e.t >= a && x.e.t <= b).sort((x, y) => x.at - y.at).forEach(({e, at, xt}) =>
    rows.push([e.id, new Date(e.t).toISOString().slice(0, 19) + "Z", e.lat, e.lon, e.mag, e.prof, at.toFixed(2), xt.toFixed(2),
      e.slab ? e.slab.cls : "", e.slab && e.slab.alt ? e.slab.alt : "", e.slab && e.slab.top != null ? e.slab.top.toFixed(1) : "",
      e.slab && e.slab.dz != null ? e.slab.dz.toFixed(1) : "", e.slab && e.slab.tol != null ? e.slab.tol.toFixed(1) : "",
      `"${(e.ref || "").replace(/"/g, '""')}"`]));
  const meta = `# Perfil A (${P.A.lat.toFixed(4)}, ${P.A.lon.toFixed(4)}) – A′ (${P.B.lat.toFixed(4)}, ${P.B.lon.toFixed(4)}); franja ${P.width} km; M >= ${P.magMin}; ${A.fmtDate(a)} a ${A.fmtDate(b)}; fuente: IGP\n# distancia_al_corte_km: positiva a la derecha de A->A′\n# ambiente_slab2: clasificación geométrica respecto de Slab2 (Hayes et al., 2018); dist_vertical_al_techo_km positiva = bajo el techo de la placa\n`;
  download(new Blob(["﻿" + meta + rows.map(r => r.join(",")).join("\n")], {type:"text/csv;charset=utf-8"}), "csv");
}
function download(blob, ext){
  const p = A.limaParts(Date.now()), name = `perfil-sismos-peru_${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}.${ext}`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  A.lastProfileExport = name;
}
async function exportPNG(){
  const box = cv.parentElement.getBoundingClientRect(), s = 2, W = Math.round(box.width), H = Math.round(box.height);
  const head = 58, foot = 22, T = TH(), F = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const out = document.createElement("canvas"); out.width = W * s; out.height = (H + head + foot) * s;
  const g = out.getContext("2d"); g.scale(s, s); g.fillStyle = T.bg; g.fillRect(0, 0, W, H + head + foot);
  const chart = document.createElement("canvas"); chart.width = W * s; chart.height = H * s; chart.__scale = s;
  const res = draw(chart); g.drawImage(chart, 0, head, W, H);
  const [a, b] = curWindow(), f4 = v => Math.abs(v).toFixed(2) + "°" + (v < 0 ? "S" : "N");
  g.fillStyle = T.ink; g.font = `700 16px ${F}`; g.textBaseline = "top"; g.fillText("Perfil sísmico A–A′ · Sismos del Perú", 14, 10);
  g.font = `12px ${F}`; g.fillStyle = T.muted;
  g.fillText(`A ${f4(P.A.lat)} ${f4(P.A.lon).replace("N", "E").replace("S", "O")} → A′ ${f4(P.B.lat)} ${f4(P.B.lon).replace("N", "E").replace("S", "O")} · ${nf(P.L)} km · franja ${nf(P.width)} km · ${nf(res.vis.length)} sismos M ≥ ${P.magMin.toFixed(1)} · ${A.fmtDate(a)} – ${A.fmtDate(b)}`, 14, 32);
  g.font = `9.5px ${F}`; g.textAlign = "right"; g.textBaseline = "middle";
  g.fillText(`Sismos: IGP · Fallas: GEM GAF-DB · Volcanes: IGP (2022), Smithsonian GVP · Placa: Slab2 (Hayes et al., 2018) · Topografía/batimetría: AWS Terrain Tiles · Generado ${A.fmtLocal(Date.now(), false)} (hora de Perú)`, W - 10, H + head + foot / 2);
  const blob = await new Promise(r => out.toBlob(r, "image/png"));
  download(blob, "png");
}


// ------------------------------------------------------------ shareable link with the current settings
const ymdL = t => { const p = A.limaParts(t); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
function shareUrl(){
  const u = new URL(location.origin + location.pathname), st = A.state, kv = o => Object.entries(o).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k}:${v}`).join(";");
  if (P.open){
    u.searchParams.set("perfil", [P.A.lat, P.A.lon, P.B.lat, P.B.lon].map(v => v.toFixed(3)).join(",") + "," + P.width);
    u.searchParams.set("pv", kv({m:P.magMin, ve:P.ve, c:P.color, s:P.showSlab ? 1 : 0, sy:P.sync ? 1 : 0, mo:P.mode, t0:ymdL(P.t0), t1:ymdL(P.t1)}));
  }
  u.searchParams.set("f", kv({m:st.mode, dia:st.mode === "dia" ? st.dia : "", mes:st.mode === "mes" ? `${st.mes.y}-${st.mes.m}` : "", anio:st.mode === "anio" ? st.anio : "",
    d0:st.mode === "rango" ? st.d0 : "", d1:st.mode === "rango" ? st.d1 : "", mag:st.mag, dep:st.depth !== "all" ? st.depth : "", reg:st.region ? encodeURIComponent(st.region) : "",
    loc:st.loc, tec:st.tect, col:A.colorBy, base:A.base}));
  // while the map is synced to the profile the main earthquake layer is temporarily replaced: count it as on
  const isOn = k => map.hasLayer(A.layers[k]) || (k === "quakes" && map.hasLayer(profQuakes) && quakesWereOn);
  u.searchParams.set("capas", A.LAYER_DEFS.filter(([k]) => isOn(k)).map(([k]) => k).join(","));
  const c = map.getCenter(); u.searchParams.set("mapa", `${c.lat.toFixed(3)},${c.lng.toFixed(3)},${map.getZoom()}`);
  return u.toString();
}
A.shareUrl = shareUrl;
const parseKV = s => Object.fromEntries((s || "").split(";").filter(Boolean).map(x => { const i = x.indexOf(":"); return [x.slice(0, i), x.slice(i + 1)]; }));
const fromYmd = s => { const [y, m, d] = s.split("-").map(Number); return A.limaStart(y, m, d); };
function applySharedMapState(q){
  const f = parseKV(q.get("f")), st = A.state;
  if (q.get("f")){
    if (f.m) st.mode = f.m;
    if (f.dia) st.dia = f.dia;
    if (f.mes){ const [y, m] = f.mes.split("-").map(Number); st.mes = {y, m}; }
    if (f.anio) st.anio = +f.anio;
    if (f.d0) st.d0 = f.d0; if (f.d1) st.d1 = f.d1;
    if (f.mag) st.mag = +f.mag;
    st.depth = f.dep || "all"; st.region = f.reg ? decodeURIComponent(f.reg) : ""; st.loc = f.loc || ""; st.tect = f.tec || "";
    if (f.col){ A.colorBy = f.col; document.querySelectorAll("#colorby button").forEach(b => b.classList.toggle("on", b.dataset.v === f.col)); }
    if (f.base && A.BASES[f.base] && f.base !== A.base){ map.removeLayer(A.BASES[A.base].layer); A.base = f.base; A.BASES[f.base].layer.addTo(map); }
  }
  if (q.get("capas") != null){
    const on = new Set(q.get("capas").split(","));
    A.LAYER_DEFS.forEach(([k]) => { const l = A.layers[k]; if (on.has(k)) { if (!map.hasLayer(l)) l.addTo(map); } else if (map.hasLayer(l)) map.removeLayer(l); });
    A.restack();
  }
  A.syncControls(); if (A.drawDateInputs) A.drawDateInputs(); if (A.drawLayersWin) A.drawLayersWin(); A.apply();
}
function applySharedProfileState(q){
  const v = parseKV(q.get("pv"));
  if (v.m){ P.magMin = +v.m; $("#pf-mag").value = (+v.m).toFixed(1); }
  if (v.ve){ P.ve = v.ve; $("#pf-ve").value = v.ve; }
  if (v.c){ P.color = v.c; $("#pf-color").value = v.c; }
  if (v.s != null){ P.showSlab = v.s === "1"; $("#pf-slab").checked = P.showSlab; }
  if (v.sy != null){ P.sync = v.sy === "1"; $("#pf-sync").checked = P.sync; }
  if (v.mo){ P.mode = v.mo; if (P.mode !== "acum") P.win = +P.mode; $("#pf-mode").value = v.mo; }
  if (v.t0) P.t0 = Math.max(catStart(), fromYmd(v.t0));
  if (v.t1) P.t1 = Math.min(Date.now(), fromYmd(v.t1) + A.DAY - 1);
  recompute(false, true); setSync(P.sync);
}
const shareDlg = document.createElement("div");
shareDlg.className = "modal"; shareDlg.id = "share-dlg";
shareDlg.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="share-h">
  <h2 id="share-h">Compartir esta vista</h2>
  <p class="muted" style="margin:0 0 8px;font-size:13px">El enlace abre el mapa y el perfil con la misma configuración: corte, ancho, magnitud, colores, capas, filtros, intervalo de tiempo y encuadre del mapa.</p>
  <div class="fld"><input type="text" id="share-url" readonly aria-label="Enlace para compartir"></div>
  <div class="btns"><button id="share-close">Cerrar</button><button class="primary" id="share-copy">Copiar enlace</button></div></div>`;
document.body.appendChild(shareDlg);
shareDlg.addEventListener("click", e => { if (e.target === shareDlg) shareDlg.classList.remove("on"); });
$("#share-close").onclick = () => shareDlg.classList.remove("on");
$("#share-copy").onclick = async () => {
  const inp = $("#share-url");
  try { await navigator.clipboard.writeText(inp.value); A.toast("Enlace copiado"); } catch (e) { inp.select(); document.execCommand && document.execCommand("copy"); A.toast("Enlace seleccionado: cópielo con Ctrl+C"); }
};
function openShare(){ $("#share-url").value = shareUrl(); shareDlg.classList.add("on"); $("#share-url").select(); }
A.openShare = openShare;

// ------------------------------------------------------------ video of the timeline (MP4)
const vidDlg = document.createElement("div");
vidDlg.className = "modal"; vidDlg.id = "video-dlg";
vidDlg.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="vid-h">
  <h2 id="vid-h">Video de la evolución temporal del perfil</h2>
  <p class="muted" style="margin:0 0 10px;font-size:13px">Se anima el intervalo elegido en el deslizador de tiempo, con el modo actual (acumulado o ventana móvil). Cada cuadro incluye el perfil, un mapa de ubicación y la línea de tiempo.</p>
  <div class="fld"><label for="vid-title">Título</label><input type="text" id="vid-title" value="Perfil sísmico A–A′ · Sismos del Perú"></div>
  <div class="vid-row">
    <label>Duración <select id="vid-dur"><option value="10">10 s</option><option value="20" selected>20 s</option><option value="30">30 s</option><option value="45">45 s</option></select></label>
    <label>Resolución <select id="vid-res"><option value="1280">1280 × 720</option><option value="1920" selected>1920 × 1080</option></select></label>
    <label><input type="checkbox" id="vid-inset" checked> Mapa de ubicación</label>
  </div>
  <div id="vid-status" class="vid-status" aria-live="polite"></div>
  <div class="vid-bar"><div id="vid-prog"></div></div>
  <div class="btns"><button id="vid-cancel">Cerrar</button><button class="primary" id="vid-go">Generar video</button></div></div>`;
document.body.appendChild(vidDlg);
let vidAbort = false, vidBusy = false;
$("#vid-cancel").onclick = () => { if (vidBusy) vidAbort = true; else vidDlg.classList.remove("on"); };
function openVideo(){ $("#vid-status").textContent = videoSupportText(); $("#vid-prog").style.width = "0"; $("#vid-go").disabled = false; vidDlg.classList.add("on"); }
A.openVideo = openVideo;
function videoSupportText(){
  if ("VideoEncoder" in window) return "Formato: MP4 (H.264), codificado cuadro por cuadro en su navegador.";
  if ("MediaRecorder" in window) return "Su navegador no permite codificar cuadro por cuadro: el video se grabará en tiempo real" + (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("video/mp4") ? " en MP4." : " en WebM (ábralo con VLC o conviértalo a MP4).");
  return "Su navegador no permite generar video. Use Chrome, Edge o Safari recientes.";
}
function loadMuxer(){
  if (window.Mp4Muxer) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = "js/vendor/mp4-muxer.js"; s.onload = res; s.onerror = () => rej(new Error("no se pudo cargar mp4-muxer")); document.head.appendChild(s); });
}
// inset location map (equirectangular around the swath)
function drawInset(g, x, y, w, h, vis){
  const T = TH(), sw = swathLayer.getLatLngs()[0].map(p => [p.lng, p.lat]);
  let [x0, x1, y0, y1] = [Math.min(...sw.map(p => p[0])), Math.max(...sw.map(p => p[0])), Math.min(...sw.map(p => p[1])), Math.max(...sw.map(p => p[1]))];
  const padX = (x1 - x0) * .35 + .5, padY = (y1 - y0) * .35 + .5; x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const kx = Math.cos(rad((y0 + y1) / 2)), sx = w / ((x1 - x0) * kx), sy = h / (y1 - y0), s = Math.min(sx, sy);
  const ox = x + (w - (x1 - x0) * kx * s) / 2, oy = y + (h - (y1 - y0) * s) / 2;
  const PX = lon => ox + (lon - x0) * kx * s, PY = lat => oy + (y1 - lat) * s;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = A.theme === "dark" ? "#18202a" : "#e9eef2"; g.fillRect(x, y, w, h);
  // departments
  g.lineWidth = .8; g.strokeStyle = A.theme === "dark" ? "#6b7480" : "#8b939c"; g.fillStyle = A.theme === "dark" ? "#252c35" : "#f8f6f1";
  A.layers.deps.eachLayer(l => {
    const gm = l.feature.geometry, polys = gm.type === "Polygon" ? [gm.coordinates] : gm.coordinates;
    polys.forEach(poly => { g.beginPath(); poly[0].forEach(([lo, la], i) => i ? g.lineTo(PX(lo), PY(la)) : g.moveTo(PX(lo), PY(la))); g.closePath(); g.fill(); g.stroke(); });
  });
  // swath and line
  g.beginPath(); sw.forEach(([lo, la], i) => i ? g.lineTo(PX(lo), PY(la)) : g.moveTo(PX(lo), PY(la))); g.closePath();
  g.fillStyle = "rgba(184,50,31,.10)"; g.fill(); g.setLineDash([5, 4]); g.strokeStyle = "#b8321f"; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
  const ln = lineLayer.getLatLngs(); g.beginPath(); ln.forEach((p, i) => i ? g.lineTo(PX(p.lng), PY(p.lat)) : g.moveTo(PX(p.lng), PY(p.lat))); g.strokeStyle = "#b8321f"; g.lineWidth = 2.5; g.stroke();
  // events visible in this frame
  [...vis].sort((a, b) => a.e.mag - b.e.mag).forEach(({e}) => { g.beginPath(); g.arc(PX(e.lon), PY(e.lat), Math.max(2, A.radiusOf(e.mag) * .45), 0, 2 * Math.PI); g.fillStyle = colorOf(e); g.fill(); g.lineWidth = .6; g.strokeStyle = T.stroke; g.stroke(); });
  // volcanoes of the swath
  P.volcs.forEach(v => { const ll = along(P.A, P.B, v.at / P.L); const vx = PX(ll.lon), vy = PY(ll.lat); g.beginPath(); g.moveTo(vx, vy - 5); g.lineTo(vx + 4.5, vy + 3.5); g.lineTo(vx - 4.5, vy + 3.5); g.closePath(); g.fillStyle = A.VOLC_COLORS[v.p.peligrosidad]; g.fill(); g.strokeStyle = "#111"; g.lineWidth = .8; g.stroke(); });
  // A / A′
  [["A", P.A], ["A′", P.B]].forEach(([t, p]) => { const px = PX(p.lon), py = PY(p.lat); g.beginPath(); g.arc(px, py, 9, 0, 2 * Math.PI); g.fillStyle = "#b8321f"; g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke(); g.fillStyle = "#fff"; g.font = "700 10px system-ui,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, px, py + .5); });
  g.restore();
  g.strokeStyle = T.axis; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
}
function drawTimeline(g, x, y, w, h, tA, tB, tCur){
  const T = TH(), F = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', nb = Math.max(24, Math.floor(w / 7)), bins = new Array(nb).fill(0);
  P.ev.forEach(v => { const i = Math.floor((v.e.t - tA) / (tB - tA) * nb); if (i >= 0 && i < nb) bins[i]++; });
  const mx = Math.max(1, ...bins), bh = h - 22;
  bins.forEach((n, i) => { const bt = tA + (i + .5) / nb * (tB - tA), hh = n / mx * (bh - 2);
    g.fillStyle = bt <= tCur ? (A.theme === "dark" ? "#ff6b55" : "#b8321f") : (A.theme === "dark" ? "#3a424c" : "#d5d9de"); g.fillRect(x + i / nb * w + .5, y + bh - hh, w / nb - 1, hh); });
  const px = x + (tCur - tA) / (tB - tA) * w;
  g.strokeStyle = T.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(px, y); g.lineTo(px, y + bh); g.stroke();
  g.font = `12px ${F}`; g.fillStyle = T.muted; g.textBaseline = "top";
  g.textAlign = "left"; g.fillText(A.fmtDate(tA), x, y + bh + 4); g.textAlign = "right"; g.fillText(A.fmtDate(tB), x + w, y + bh + 4);
}
function renderVideoFrame(g, W, H, tCur, tA, tB, opt){
  const T = TH(), F = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', f4 = (v, pos, neg) => `${Math.abs(v).toFixed(2)}°${v < 0 ? neg : pos}`;
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
  const saved = [P.t1, P.playing]; P.t1 = tCur; P.playing = true;
  const vis = visibleEvents();
  // header
  g.fillStyle = T.ink; g.font = `700 22px ${F}`; g.textAlign = "left"; g.textBaseline = "top"; g.fillText(opt.title, 24, 16);
  g.font = `13px ${F}`; g.fillStyle = T.muted;
  g.fillText(`A ${f4(P.A.lat, "N", "S")} ${f4(P.A.lon, "E", "O")} → A′ ${f4(P.B.lat, "N", "S")} ${f4(P.B.lon, "E", "O")} · ${nf(P.L)} km · franja ${nf(P.width)} km · sismos M ≥ ${P.magMin.toFixed(1)} · ${P.mode === "acum" ? "acumulado" : "ventana de " + P.win + " días"}`, 24, 46);
  const [wa, wb] = curWindow();
  g.font = `700 26px ${F}`; g.fillStyle = T.ink; g.textAlign = "right";
  g.fillText(P.mode === "acum" ? A.fmtDate(tCur) : `${A.fmtDate(wa)} – ${A.fmtDate(wb)}`, W - 24, 14);
  g.font = `13px ${F}`; g.fillStyle = T.muted; g.fillText(`${nf(vis.length)} sismos en el perfil`, W - 24, 46);
  // body
  const top = 72, foot = 26, tl = 70, insetW = opt.inset ? Math.round(W * .27) : 0, gap = opt.inset ? 16 : 0;
  const bodyH = H - top - tl - foot;
  if (opt.inset) drawInset(g, 24, top, insetW, bodyH, vis);
  const cx = 24 + insetW + gap, cw = W - cx - 16;
  const chart = opt.chart; chart.__w = cw; chart.__h = bodyH;
  draw(chart);
  g.drawImage(chart, 0, 0, cw * chart.__scale, bodyH * chart.__scale, cx, top, cw, bodyH);
  drawTimeline(g, 24, H - tl - foot + 8, W - 48, tl - 8, tA, tB, tCur);
  g.font = `11px ${F}`; g.fillStyle = T.muted; g.textAlign = "right"; g.textBaseline = "middle";
  g.fillText("Sismos: IGP · Placa: Slab2 (Hayes et al., 2018) · Fallas: GEM GAF-DB · Volcanes: IGP, Smithsonian GVP · Topografía: AWS Terrain Tiles · kevinalexandr19.github.io/sismos-peru", W - 24, H - foot / 2);
  P.t1 = saved[0]; P.playing = saved[1];
}
async function makeVideo(){
  if (vidBusy) return;
  vidBusy = true; vidAbort = false; $("#vid-go").disabled = true;
  const status = t => { $("#vid-status").textContent = t; }, prog = f => { $("#vid-prog").style.width = (100 * f).toFixed(1) + "%"; };
  const res = +$("#vid-res").value, Wpx = res, Hpx = Math.round(res * 9 / 16), fps = 30, dur = +$("#vid-dur").value, hold = Math.round(1.5 * fps);
  const s = Wpx / 1280, W = 1280, H = 720;                         // draw at 1280×720 logical units, scaled to the output size
  const out = document.createElement("canvas"); out.width = Wpx; out.height = Hpx;
  const g = out.getContext("2d", {alpha:false});
  const chart = document.createElement("canvas"); chart.__scale = s; chart.width = Math.ceil(W * s); chart.height = Math.ceil(H * s);
  const opt = {title:$("#vid-title").value.trim() || "Perfil sísmico A–A′", inset:$("#vid-inset").checked, chart};
  const tA = P.t0, tB = P.t1, N = dur * fps, frameAt = k => tA + (tB - tA) * Math.min(1, (k + 1) / N);
  const render = k => { g.setTransform(s, 0, 0, s, 0, 0); renderVideoFrame(g, W, H, frameAt(k), tA, tB, opt); };
  const wasPlaying = P.playing; if (wasPlaying) togglePlay(false);
  try {
    let blob = null, ext = "mp4";
    let cfg = null;
    if ("VideoEncoder" in window){
      for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.42001f"]){
        const c = {codec, width:Wpx, height:Hpx, bitrate:Wpx >= 1920 ? 8e6 : 5e6, framerate:fps};
        try { if ((await VideoEncoder.isConfigSupported(c)).supported){ cfg = c; break; } } catch (e) {}
      }
    }
    if (cfg){
      status("Preparando el codificador…"); await loadMuxer();
      const muxer = new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(), video:{codec:"avc", width:Wpx, height:Hpx, frameRate:fps}, fastStart:"in-memory"});
      let encErr = null;
      const enc = new VideoEncoder({output:(chunk, meta) => muxer.addVideoChunk(chunk, meta), error:e => { encErr = e; }});
      enc.configure(cfg);
      for (let k = 0; k < N + hold; k++){
        if (vidAbort || encErr) break;
        render(Math.min(k, N - 1));
        const vf = new VideoFrame(out, {timestamp:Math.round(k * 1e6 / fps), duration:Math.round(1e6 / fps)});
        enc.encode(vf, {keyFrame:k % (fps * 2) === 0}); vf.close();
        if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
        if (k % 10 === 0){ prog(k / (N + hold)); status(`Generando cuadros: ${k} de ${N + hold}`); await new Promise(r => setTimeout(r, 0)); }
      }
      if (encErr) throw encErr;
      if (!vidAbort){ status("Finalizando el archivo MP4…"); await enc.flush(); muxer.finalize(); blob = new Blob([muxer.target.buffer], {type:"video/mp4"}); }
      enc.close && enc.state !== "closed" && enc.close();
    } else if ("MediaRecorder" in window && out.captureStream){
      const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find(m => MediaRecorder.isTypeSupported(m));
      ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      const stream = out.captureStream(fps), rec = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:6e6}), parts = [];
      rec.ondataavailable = e => e.data.size && parts.push(e.data);
      const done = new Promise(r => rec.onstop = r);
      rec.start(); status("Grabando en tiempo real…");
      for (let k = 0; k < N + hold && !vidAbort; k++){ render(Math.min(k, N - 1)); prog(k / (N + hold)); await new Promise(r => setTimeout(r, 1000 / fps)); }
      rec.stop(); await done; if (!vidAbort) blob = new Blob(parts, {type:mime});
    } else throw new Error("este navegador no permite generar video");
    if (vidAbort){ status("Generación cancelada."); prog(0); }
    else { prog(1); status(`Listo: video ${ext.toUpperCase()} de ${dur + 1.5} s, ${Wpx}×${Hpx} (${(blob.size / 1048576).toFixed(1)} MB).`); A.lastVideo = {size:blob.size, type:blob.type, ext}; if (!A._noDownload) download(blob, ext); }
  } catch (err){ console.error(err); status("No se pudo generar el video: " + (err && err.message || err)); }
  finally { vidBusy = false; $("#vid-go").disabled = false; draw(); }
}
$("#vid-go").onclick = makeVideo;
A.makeVideo = makeVideo;

// ------------------------------------------------------------ URL state (?perfil=latA,lonA,latB,lonB,ancho)
function syncUrl(remove){
  const u = new URLSearchParams(location.search);
  if (remove || !P.open) u.delete("perfil");
  else u.set("perfil", [P.A.lat, P.A.lon, P.B.lat, P.B.lon].map(v => v.toFixed(3)).join(",") + "," + P.width);
  const q = u.toString(); history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
}
A.onDataReady = A.onDataReady || [];
let sharedApplied = false;
A.onDataReady.push(() => {
  const q = new URLSearchParams(location.search), s = q.get("perfil");
  if (!sharedApplied && (q.get("f") || q.get("capas") != null)){ applySharedMapState(q); }
  if (s && !P.open && !sharedApplied){
    const v = s.split(",").map(Number);
    if (v.length >= 4 && v.every(isFinite)){ openProfile({lat:v[0], lon:v[1]}, {lat:v[2], lon:v[3]}, v[4] || 100); if (q.get("pv")) applySharedProfileState(q); }
  }
  if (!sharedApplied && q.get("mapa")){ const [la, lo, z] = q.get("mapa").split(",").map(Number); if ([la, lo, z].every(isFinite)) map.setView([la, lo], z); }
  if (!sharedApplied){ sharedApplied = true; return; }
  else if (P.open){ pool.clear(); profQuakes.clearLayers(); shownIds = new Set(); recompute(false, true); }
});
A.redrawProfile = () => { if (P.open){ sampleSlab(); filterWidth(); drawHist(); draw(); } };
})();
