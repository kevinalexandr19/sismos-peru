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
document.getElementById("mapwrap").appendChild(panel);           // below the map, inside the map column
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
$("#pf-width").oninput = e => { P.width = s2w(+e.target.value); $("#pf-wval").textContent = `${nf(P.width)} km`; drawOverlay(); recompute(false); draw(); };
$("#pf-width").onchange = () => { recompute(true); syncUrl(); };
$("#pf-mag").onchange = e => { P.magMin = +e.target.value; recompute(false); };
$("#pf-ve").onchange = e => { P.ve = e.target.value; draw(); };
$("#pf-color").onchange = e => { P.color = e.target.value; draw(); scheduleMapSync(); };
$("#pf-slab").onchange = e => { P.showSlab = e.target.checked; draw(); };
$("#pf-sync").onchange = e => { P.sync = e.target.checked; setSync(P.sync); };
$("#pf-mode").onchange = e => { P.mode = e.target.value; if (P.mode !== "acum") P.win = +P.mode; updateTime(); };
$("#pf-speed").onchange = e => { P.speed = +e.target.value; };
$("#pf-play").onclick = () => togglePlay(!P.playing);
$("#pf-csv").onclick = exportCSV;
$("#pf-png").onclick = exportPNG;

// ------------------------------------------------------------ data selection
const catStart = () => A.ALL.length ? A.ALL[A.ALL.length - 1].t : Date.now() - 365 * A.DAY;
function recompute(withTopo){
  if (!P.A) return;
  P.L = dist(P.A, P.B); P.brg = bearing(P.A, P.B);
  const half = P.width / 2;
  // a quick bounding test avoids projecting every event when the swath is small
  P.ev = [];
  A.ALL.forEach(e => {
    if (e.mag < P.magMin - 1e-9) return;
    const q = project(e);
    if (q.at < -1e-6 || q.at > P.L + 1e-6 || Math.abs(q.xt) > half) return;
    P.ev.push({e, at:q.at, xt:q.xt});
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
  const half2 = Math.min(half, 60);                // surface features: within the swath (≤ 60 km)
  P.cities = []; [A.layers.citiesMain, A.layers.citiesSec].forEach(g => g.eachLayer(m => {
    const ll = m.getLatLng(), q = project({lat:ll.lat, lon:ll.lng});
    if (q.at >= 0 && q.at <= P.L && Math.abs(q.xt) <= half2) P.cities.push({at:q.at, name:m.getTooltip().getContent(), main:m.options.main});
  }));
  P.volcs = []; A.layers.volcanoes.eachLayer(m => {
    const ll = m.getLatLng(), q = project({lat:ll.lat, lon:ll.lng});
    if (q.at >= 0 && q.at <= P.L && Math.abs(q.xt) <= Math.max(half2, 30)) P.volcs.push({at:q.at, xt:q.xt, p:m.options.volc});
  });
  $("#pf-wval").textContent = `${nf(P.width)} km`;
  sampleSlab();
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
    profQuakes.remove(); profQuakes.clearLayers(); if (quakesWereOn) A.layers.quakes.addTo(map); A.restack();
  }
}
function scheduleMapSync(){ if (!P.open || !P.sync) return; if (syncT) return; syncT = setTimeout(() => { syncT = null; mapSync(); }, P.playing ? 160 : 40); }
function mapSync(){
  if (!map.hasLayer(profQuakes)) setSync(true);
  profQuakes.clearLayers();
  const [a, b] = curWindow();
  visibleEvents().sort((x, y) => x.e.mag - y.e.mag).forEach(({e}) => {
    const age = P.mode === "acum" ? 0 : (b - e.t) / (b - a);
    const m = L.circleMarker([e.lat, e.lon], {renderer:A.renderer, radius:A.radiusOf(e.mag), color:"#2b2b2b", weight:.7, fillColor:colorOf(e), fillOpacity:.9 - .6 * age, opacity:1 - .6 * age});
    m.bindTooltip(`M${e.mag.toFixed(1)} · ${esc(e.ref)}<br>${A.fmtLocal(e.t, false)} · ${e.prof ?? "?"} km`, {direction:"top", offset:[0, -4]});
    m.on("click", () => L.popup({maxWidth:340}).setLatLng([e.lat, e.lon]).setContent(A.popupHtml(e)).openOn(map));
    m.addTo(profQuakes);
  });
}

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
function layout(w, h){
  const m = {l:56, r:16, t:18, b:30}, topoH = Math.max(60, Math.min(110, h * .26)), gap = 4;
  return {w, h, m, topoH, y0:m.t + topoH + gap, plotW:w - m.l - m.r, plotH:h - (m.t + topoH + gap) - m.b};
}
function draw(target){
  if (!P.open || !P.A || panel.classList.contains("min")) return;
  const box = cv.parentElement.getBoundingClientRect(); if (!box.width) return;
  const dpr = window.devicePixelRatio || 1, W = Math.round(box.width), H = Math.round(box.height);
  const c = target || cv;
  if (!target){ c.width = W * dpr; c.height = H * dpr; c.style.width = W + "px"; c.style.height = H + "px"; }
  const g = c.getContext("2d"); g.setTransform(target ? target.__scale : dpr, 0, 0, target ? target.__scale : dpr, 0, 0);
  const T = TH(), F = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', lay = layout(W, H), {m, topoH, y0, plotW, plotH} = lay;
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
  // compact legend (bottom-right of the depth panel)
  {
    let items = [];
    if (P.color === "tect" && A.SLAB_CLASSES){ const present = new Set(vis.map(v => v.e.slab && v.e.slab.cls)); items = A.SLAB_ORDER.filter(k => present.has(k)).map(k => ({c:A.SLAB_CLASSES[k].color, t:A.SLAB_CLASSES[k].short})); }
    else if (P.color === "depth") items = A.DEPTH_COLORS.map(c => ({c:c[1], t:c[2]}));
    const sl = P.showSlab && P.slabProf;
    if (items.length || sl){
      g.font = `11px ${F}`; const lh = 15, w = Math.max(0, ...items.map(i => g.measureText(i.t).width), sl ? g.measureText("Techo de la placa ± incert.").width : 0) + 34;
      const h = (items.length + (sl ? 2 : 0)) * lh + 8, bx = m.l + plotW - w - 6, by = y0 + plotH - h - 6;
      g.fillStyle = A.theme === "dark" ? "rgba(26,31,38,.9)" : "rgba(255,255,255,.9)"; g.fillRect(bx, by, w, h); g.strokeStyle = T.axis; g.lineWidth = 1; g.strokeRect(bx + .5, by + .5, w, h);
      g.textAlign = "left"; g.textBaseline = "middle"; let yy = by + 4 + lh / 2;
      items.forEach(i => { g.beginPath(); g.arc(bx + 12, yy, 4.5, 0, 2 * Math.PI); g.fillStyle = i.c; g.fill(); g.strokeStyle = T.stroke; g.lineWidth = .8; g.stroke(); g.fillStyle = T.ink; g.fillText(i.t, bx + 24, yy); yy += lh; });
      if (sl){ const col = A.theme === "dark" ? "#c9a7ff" : "#6a3d9a";
        g.strokeStyle = col; g.lineWidth = 2.2; g.beginPath(); g.moveTo(bx + 6, yy); g.lineTo(bx + 19, yy); g.stroke(); g.fillStyle = T.ink; g.fillText("Techo de la placa ± incert.", bx + 24, yy); yy += lh;
        g.setLineDash([5, 3]); g.lineWidth = 1.4; g.beginPath(); g.moveTo(bx + 6, yy); g.lineTo(bx + 19, yy); g.stroke(); g.setLineDash([]); g.fillText("Base de la placa", bx + 24, yy); }
    }
  }
  // time label while playing
  if (P.playing || P.mode !== "acum"){
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

// ------------------------------------------------------------ URL state (?perfil=latA,lonA,latB,lonB,ancho)
function syncUrl(remove){
  const u = new URLSearchParams(location.search);
  if (remove || !P.open) u.delete("perfil");
  else u.set("perfil", [P.A.lat, P.A.lon, P.B.lat, P.B.lon].map(v => v.toFixed(3)).join(",") + "," + P.width);
  const q = u.toString(); history.replaceState(null, "", location.pathname + (q ? "?" + q : ""));
}
A.onDataReady = A.onDataReady || [];
A.onDataReady.push(() => {
  const s = new URLSearchParams(location.search).get("perfil");
  if (s && !P.open){ const v = s.split(",").map(Number); if (v.length >= 4 && v.every(isFinite)) openProfile({lat:v[0], lon:v[1]}, {lat:v[2], lon:v[3]}, v[4] || 100); }
  else if (P.open) recompute(false);
});
A.redrawProfile = () => { if (P.open){ sampleSlab(); drawHist(); draw(); } };
})();
