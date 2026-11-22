"use strict";
/* Statistics & insights tab: KPIs, auto-generated insights and SVG charts
   computed from the events that pass the current filters (APP.VIEW). */
(function(){
const A = window.APP, {nf, esc, DAY, limaParts, fmtDate, fmtLocal, depthColor, MESES} = A;
const W = 372;                                   // chart width in SVG units
// chart colours with >= 3:1 contrast against the panel in each theme
const CC = () => A.theme === "dark" ? {big:"#ff6b55", small:"#8b95a1", pt:"#9aa4ae"} : {big:"#b8321f", small:"#7c8692", pt:"#6b7480"};
let secAxis = "lon";

// ------------------------------------------------------------ small math helpers
function niceTicks(min, max, n = 5){
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max){ min -= 1; max += 1; }
  const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw);
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const sum = a => a.reduce((s, x) => s + x, 0);
const mean = a => sum(a) / a.length;
function median(a){ const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function logBinomPmf(k, n, p){
  let lg = 0; for (let i = 1; i <= k; i++) lg += Math.log((n - k + i) / i);
  return lg + k * Math.log(p) + (n - k) * Math.log(1 - p);
}
// exact two-sided binomial test (sum of probabilities <= P(observed))
function binomTwoSided(k, n, p){
  const lo = logBinomPmf(k, n, p); let s = 0;
  for (let i = 0; i <= n; i++){ const l = logBinomPmf(i, n, p); if (l <= lo + 1e-7) s += Math.exp(l); }
  return Math.min(1, s);
}
// Aki (1965) / Utsu maximum-likelihood b-value with Shi & Bolt (1982) uncertainty.
// Mc by maximum curvature (mode of the 0.1-unit histogram) + 0.2 correction (Woessner & Wiemer, 2005).
function bValue(mags){
  if (mags.length < 30) return null;
  const counts = new Map(); mags.forEach(m => { const k = Math.round(m * 10); counts.set(k, (counts.get(k) || 0) + 1); });
  let modeK = null, best = -1; [...counts.entries()].sort((a, b) => a[0] - b[0]).forEach(([k, c]) => { if (c > best){ best = c; modeK = k; } });
  const Mc = Math.round(modeK + 2) / 10, dM = 0.1;
  const sel = mags.filter(m => m >= Mc - 1e-9);
  if (sel.length < 50) return {Mc, n:sel.length, b:null};
  const mm = mean(sel), b = Math.LOG10E / (mm - (Mc - dM / 2));
  const sb = 2.3 * b * b * Math.sqrt(sum(sel.map(m => (m - mm) ** 2)) / (sel.length * (sel.length - 1)));
  const a = Math.log10(sel.length) + b * Mc;
  return {Mc, n:sel.length, b, sb, a};
}
const ROMAN = {I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10,XI:11,XII:12};
function maxIntensity(s){
  const m = (s || "").match(/^\s*([IVX]+)(?:\s*-\s*([IVX]+))?/); if (!m) return null;
  return Math.max(ROMAN[m[1]] || 0, ROMAN[m[2]] || 0) || null;
}
const toRoman = v => Object.keys(ROMAN).find(k => ROMAN[k] === v);

// ------------------------------------------------------------ chart helpers
function frame(h, xs, ys, opt = {}){
  const m = {l:38, r:8, t:8, b:24, ...opt.m}, iw = W - m.l - m.r, ih = h - m.t - m.b;
  const X = v => m.l + (v - xs[0]) / (xs[1] - xs[0]) * iw;
  const Y = opt.ylog ? v => m.t + ih - (Math.log10(v) - Math.log10(ys[0])) / (Math.log10(ys[1]) - Math.log10(ys[0])) * ih
                     : opt.yinv ? v => m.t + (v - ys[0]) / (ys[1] - ys[0]) * ih
                     : v => m.t + ih - (v - ys[0]) / (ys[1] - ys[0]) * ih;
  return {m, iw, ih, X, Y, h};
}
function axes(f, xt, yt, xfmt = v => v, yfmt = v => v, xlab = "", ylab = ""){
  const {m, iw, ih, X, Y, h} = f;
  let s = yt.map(v => `<line class="grid" x1="${m.l}" x2="${m.l + iw}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 4}" y="${Y(v) + 3}" text-anchor="end">${yfmt(v)}</text>`).join("");
  s += xt.map(v => `<line class="axis" x1="${X(v)}" x2="${X(v)}" y1="${m.t + ih}" y2="${m.t + ih + 3}"/><text x="${X(v)}" y="${m.t + ih + 13}" text-anchor="middle">${xfmt(v)}</text>`).join("");
  s += `<line class="axis" x1="${m.l}" x2="${m.l + iw}" y1="${m.t + ih}" y2="${m.t + ih}"/><line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ih}"/>`;
  if (xlab) s += `<text x="${m.l + iw / 2}" y="${h - 1}" text-anchor="middle">${xlab}</text>`;
  if (ylab) s += `<text transform="translate(9 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">${ylab}</text>`;
  return s;
}
const svg = (h, body) => `<svg viewBox="0 0 ${W} ${h}" role="img">${body}</svg>`;
const chart = (title, cap, body, extra = "") => `<div class="chart"><h3>${title}</h3>${cap ? `<p class="cap">${cap}</p>` : ""}${extra}${body}</div>`;

// time binning that adapts to the span of the period (week bins start on Monday;
// limaStart() returns 05:00 UTC, the same calendar day as in Lima)
function timeBins(V, b){
  const first = A.ALL.length ? A.ALL[A.ALL.length - 1].t : Date.now();
  const t0 = Math.max(b.t0, Math.min(first, ...V.map(e => e.t))), t1 = Math.min(b.t1, Date.now());
  const span = t1 - t0;
  let unit, start, next, lab;
  if (span <= 2.1 * DAY){ unit = "hora"; start = t => Math.floor(t / 3600e3) * 3600e3; next = t => t + 3600e3; lab = t => `${limaParts(t).h}h`; }
  else if (span <= 92 * DAY){ unit = "día"; start = t => { const p = limaParts(t); return A.limaStart(p.y, p.m, p.d); }; next = t => t + DAY; lab = t => { const p = limaParts(t); return `${p.d}/${p.m}`; }; }
  else if (span <= 550 * DAY){ unit = "semana"; start = t => { const p = limaParts(t); const d0 = A.limaStart(p.y, p.m, p.d); const wd = (new Date(d0).getUTCDay() + 6) % 7; return d0 - wd * DAY; }; next = t => t + 7 * DAY; lab = t => { const p = limaParts(t); return `${p.d}/${p.m}/${String(p.y).slice(2)}`; }; }
  else { unit = "mes"; start = t => { const p = limaParts(t); return A.limaStart(p.y, p.m, 1); }; next = t => { const p = limaParts(t); return p.m === 12 ? A.limaStart(p.y + 1, 1, 1) : A.limaStart(p.y, p.m + 1, 1); }; lab = t => { const p = limaParts(t); return `${MESES[p.m - 1].slice(0, 3)} ${String(p.y).slice(2)}`; }; }
  const bins = []; for (let t = start(t0); t < t1; t = next(t)) bins.push({t, n:0, big:0});
  const idx = new Map(bins.map((x, i) => [x.t, i]));
  V.forEach(e => { const i = idx.get(start(e.t)); if (i != null){ bins[i].n++; if (e.mag >= 4.5) bins[i].big++; } });
  return {bins, unit, lab};
}

// ------------------------------------------------------------ charts
function chartTimeline(V, b){
  const {bins, unit, lab} = timeBins(V, b);
  if (!bins.length) return "";
  const h = 150, ymax = Math.max(1, ...bins.map(x => x.n)), yt = niceTicks(0, ymax, 4);
  const f = frame(h, [0, bins.length], [0, Math.max(ymax, yt[yt.length - 1])]);
  const bw = f.iw / bins.length;
  let body = axes(f, [], yt, v => v, v => nf(v), "", "Sismos");
  const every = Math.ceil(bins.length / 7);
  bins.forEach((x, i) => {
    const xx = f.X(i) + Math.min(.6, bw * .1), w = Math.max(.6, bw - Math.min(1.2, bw * .2));
    if (x.n) body += `<rect x="${xx}" y="${f.Y(x.n)}" width="${w}" height="${f.Y(0) - f.Y(x.n)}" fill="${CC().small}"><title>${lab(x.t)}: ${x.n} sismos (${x.big} con M ≥ 4.5)</title></rect>`;
    if (x.big) body += `<rect x="${xx}" y="${f.Y(x.big)}" width="${w}" height="${f.Y(0) - f.Y(x.big)}" fill="${CC().big}" pointer-events="none"/>`;
    if (i % every === 0) body += `<text x="${f.X(i) + bw / 2}" y="${f.m.t + f.ih + 13}" text-anchor="middle">${lab(x.t)}</text>`;
  });
  return chart(`Sismos por ${unit}`, `<span style="color:${CC().big}">■</span> M ≥ 4.5 &nbsp; <span style="color:${CC().small}">■</span> M &lt; 4.5 · hora de Perú`, svg(h, body));
}
function chartMagTime(V, b){
  if (!V.length) return "";
  const first = A.ALL[A.ALL.length - 1].t;
  const t0 = Math.max(b.t0, Math.min(...V.map(e => e.t)), first), t1 = Math.min(b.t1, Date.now());
  const mags = V.map(e => e.mag), lo = Math.floor(Math.min(...mags)), hi = Math.ceil(Math.max(...mags) + .1);
  const h = 160, f = frame(h, [t0, t1], [lo, hi]);
  const span = t1 - t0;
  const ticks = []; for (let i = 0; i <= 4; i++) ticks.push(t0 + span * i / 4);
  const xf = span < 2.1 * DAY ? t => `${A.fmtLocal(t, false).slice(11)}` : span < 400 * DAY ? t => fmtDate(t).slice(0, 5) : t => fmtDate(t).slice(3);
  let body = axes(f, ticks, niceTicks(lo, hi, 4), xf, v => v.toFixed(0), "", "Magnitud");
  [...V].sort((a, c) => a.mag - c.mag).forEach(e => body += `<circle class="pt" data-id="${esc(e.id)}" cx="${f.X(e.t).toFixed(1)}" cy="${f.Y(e.mag).toFixed(1)}" r="${Math.max(1.6, (e.mag - 2) * 1.3)}" fill="${depthColor(e.prof)}" fill-opacity=".75" stroke="#333" stroke-width=".3"><title>M${e.mag} · ${esc(e.ref)} · ${fmtDate(e.t)}</title></circle>`);
  return chart("Magnitud en el tiempo", "Color según profundidad; clic en un punto para ubicarlo en el mapa.", svg(h, body));
}
function chartGR(V, bv){
  if (V.length < 10) return "";
  const mags = V.map(e => Math.round(e.mag * 10) / 10), mn = Math.min(...mags), mx = Math.max(...mags);
  const pts = []; for (let m = mn; m <= mx + 1e-9; m = Math.round((m + .1) * 10) / 10){ const n = mags.filter(x => x >= m - 1e-9).length; if (n) pts.push([m, n]); }
  const nonc = []; for (let m = mn; m <= mx + 1e-9; m = Math.round((m + .1) * 10) / 10){ const n = mags.filter(x => Math.abs(x - m) < 1e-6).length; if (n) nonc.push([m, n]); }
  const ymax = Math.pow(10, Math.ceil(Math.log10(V.length + .5)));
  const h = 170, f = frame(h, [Math.floor(mn * 2) / 2, Math.ceil((mx + .05) * 2) / 2], [1, ymax], {ylog:true});
  const yt = []; for (let v = 1; v <= ymax; v *= 10) yt.push(v);
  let body = axes(f, niceTicks(Math.floor(mn * 2) / 2, Math.ceil((mx + .05) * 2) / 2, 5), yt, v => v.toFixed(1), v => nf(v), "Magnitud", "N");
  nonc.forEach(([m, n]) => body += `<rect x="${f.X(m) - 1.6}" y="${f.Y(n)}" width="3.2" height="${f.Y(1) - f.Y(n)}" fill="#cfd5db"/>`);
  pts.forEach(([m, n]) => body += `<circle cx="${f.X(m)}" cy="${f.Y(n)}" r="2.6" fill="${bv && m >= bv.Mc - 1e-9 ? CC().big : CC().pt}"><title>M ≥ ${m.toFixed(1)}: ${n}</title></circle>`);
  let cap = "Puntos: número acumulado N(≥M) en escala logarítmica; barras: número por intervalo de 0.1.";
  if (bv && bv.b){
    const yAt = m => Math.pow(10, bv.a - bv.b * m), m1 = bv.Mc, m2 = mx;
    if (yAt(m2) >= 1) body += `<line x1="${f.X(m1)}" y1="${f.Y(yAt(m1))}" x2="${f.X(m2)}" y2="${f.Y(yAt(m2))}" stroke="${CC().big}" stroke-width="1.5" stroke-dasharray="5 3"/>`;
    body += `<line x1="${f.X(bv.Mc)}" x2="${f.X(bv.Mc)}" y1="${f.m.t}" y2="${f.m.t + f.ih}" stroke="#888" stroke-dasharray="2 2"/><text x="${f.X(bv.Mc) + 3}" y="${f.m.t + 9}">Mc ${bv.Mc.toFixed(1)}</text>`;
    cap += ` Línea: ajuste de máxima verosimilitud, b = ${bv.b.toFixed(2)} ± ${bv.sb.toFixed(2)} (n = ${nf(bv.n)}, M ≥ ${bv.Mc.toFixed(1)}).`;
  }
  return chart("Relación magnitud–frecuencia (Gutenberg–Richter)", cap, svg(h, body));
}
function chartSection(V){
  if (!V.length) return "";
  const key = secAxis, vals = V.map(e => e[key]);
  const lo = Math.floor(Math.min(...vals) - .2), hi = Math.ceil(Math.max(...vals) + .2);
  const dmax = Math.max(100, Math.ceil(Math.max(...V.map(e => e.prof || 0)) / 100) * 100);
  const h = 190, f = frame(h, [lo, hi], [0, dmax], {yinv:true});
  const fx = key === "lon" ? v => `${Math.abs(v)}°O` : v => `${Math.abs(v)}°${v < 0 ? "S" : "N"}`;
  let body = axes(f, niceTicks(lo, hi, 6), niceTicks(0, dmax, 5), fx, v => v, key === "lon" ? "Longitud" : "Latitud", "Profundidad (km)");
  [...V].sort((a, c) => a.mag - c.mag).forEach(e => body += `<circle class="pt" data-id="${esc(e.id)}" cx="${f.X(e[key]).toFixed(1)}" cy="${f.Y(e.prof || 0).toFixed(1)}" r="${Math.max(1.4, (e.mag - 2) * 1.2)}" fill="${depthColor(e.prof)}" fill-opacity=".7" stroke="#333" stroke-width=".3"><title>M${e.mag} · ${e.prof} km · ${esc(e.ref)}</title></circle>`);
  const tog = `<div class="seg" id="secaxis" style="max-width:320px;margin:4px 0"><button data-v="lon" class="${key === "lon" ? "on" : ""}">vs longitud (O–E)</button><button data-v="lat" class="${key === "lat" ? "on" : ""}">vs latitud (S–N)</button></div>`;
  return chart("Sección de profundidad", "Proyección de los hipocentros; en el Perú muestra la geometría de la placa de Nazca que subduce bajo Sudamérica.", svg(h, body), tog);
}
function chartDepthHist(V){
  if (!V.length) return "";
  const step = 25, dmax = Math.max(200, Math.ceil(Math.max(...V.map(e => e.prof || 0)) / 100) * 100), nb = dmax / step;
  const bins = Array.from({length:nb}, (_, i) => ({d:i * step, n:0}));
  V.forEach(e => { const i = Math.min(nb - 1, Math.floor((e.prof || 0) / step)); bins[i].n++; });
  const ymax = Math.max(1, ...bins.map(b => b.n)), h = 130, f = frame(h, [0, dmax], [0, ymax]);
  let body = axes(f, niceTicks(0, dmax, 6), niceTicks(0, ymax, 4), v => v, v => nf(v), "Profundidad (km)", "Sismos");
  bins.forEach(b => { if (b.n) body += `<rect x="${f.X(b.d) + .5}" y="${f.Y(b.n)}" width="${f.X(step) - f.X(0) - 1}" height="${f.Y(0) - f.Y(b.n)}" fill="${depthColor(b.d + step / 2)}"><title>${b.d}–${b.d + step} km: ${b.n}</title></rect>`; });
  return chart("Distribución de profundidades", "Intervalos de 25 km, coloreados con la misma escala del mapa.", svg(h, body));
}
function chartTect(V){
  if (!V.length || !A.slab || !A.slab.ready) return "";
  const c = new Map(); V.forEach(e => { if (e.slab) c.set(e.slab.cls, (c.get(e.slab.cls) || 0) + 1); });
  const rows = A.SLAB_ORDER.filter(k => c.get(k)).map(k => [k, c.get(k)]); if (!rows.length) return "";
  const amb = V.filter(e => e.slab && e.slab.alt).length;
  const rh = 18, h = rows.length * rh + 8, max = Math.max(...rows.map(r => r[1])), lw = 112, bwMax = W - lw - 52;
  let body = "";
  rows.forEach(([k, n], i) => {
    const y = 4 + i * rh, w = Math.max(1, n / max * bwMax), C = A.SLAB_CLASSES[k];
    body += `<g class="bar-reg" data-tect="${k}"><text x="${lw - 4}" y="${y + 12}" text-anchor="end">${esc(C.short)}</text><rect x="${lw}" y="${y + 3}" width="${w}" height="${rh - 6}" fill="${C.color}"/><text x="${lw + w + 4}" y="${y + 12}">${nf(n)} (${(100 * n / V.length).toFixed(0)}%)</text><title>${esc(C.name)}: ${esc(C.desc)} Clic para filtrar.</title></g>`;
  });
  return chart("Ambiente tectónico según Slab2", `Posición del hipocentro respecto de la placa de Nazca (Hayes et al., 2018). ${nf(amb)} sismo(s) quedan en el límite entre dos clases (±10 km de profundidad). Clic en una barra para filtrar.`, svg(h, body));
}
function chartRegions(V){
  if (!V.length) return "";
  const c = new Map(); V.forEach(e => c.set(e.reg || "Sin región", (c.get(e.reg || "Sin región") || 0) + 1));
  const rows = [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12), rh = 17, h = rows.length * rh + 8, max = rows[0][1];
  const lw = 96, bwMax = W - lw - 46;
  let body = "";
  rows.forEach(([r, n], i) => {
    const y = 4 + i * rh, w = Math.max(1, n / max * bwMax);
    body += `<g class="bar-reg" data-reg="${esc(r)}"><text x="${lw - 4}" y="${y + 11}" text-anchor="end">${esc(r)}</text><rect x="${lw}" y="${y + 2}" width="${w}" height="${rh - 5}" fill="#7d8fa3"/><text x="${lw + w + 4}" y="${y + 11}">${nf(n)} (${(100 * n / V.length).toFixed(0)}%)</text><title>Filtrar por ${esc(r)}</title></g>`;
  });
  return chart("Sismos por región", "Departamento del epicentro (para sismos en el mar, el de la localidad de referencia del IGP). Clic en una barra para filtrar.", svg(h, body));
}

// ------------------------------------------------------------ insights
function insights(V, b, bv){
  const out = [];
  if (!V.length) return ["Ningún sismo cumple los filtros actuales."];
  const span = A.effectiveSpan(b) / DAY;
  out.push(`<b>${nf(V.length)}</b> sismos reportados ${esc(b.inLabel || "en " + b.label)}${span >= 1.5 ? ` (${nf(V.length / span, V.length / span < 10 ? 1 : 0)} por día en promedio)` : ""}.`);
  const big = V.reduce((a, e) => e.mag > a.mag ? e : a);
  out.push(`El de mayor magnitud fue <a href="#" data-goto="${esc(big.id)}">M${big.mag.toFixed(1)} del ${fmtDate(big.t)}</a>, ${esc(big.ref)}, a ${big.prof ?? "?"} km de profundidad.`);
  const withI = V.map(e => [e, maxIntensity(e.int)]).filter(x => x[1]);
  if (withI.length){
    const top = withI.reduce((a, x) => x[1] > a[1] ? x : a);
    out.push(`Mayor intensidad reportada: <b>${toRoman(top[1])}</b> (escala de Mercalli Modificada) con el sismo M${top[0].mag.toFixed(1)} del ${fmtDate(top[0].t)} (${esc(top[0].int)}).`);
  }
  const reg = new Map(); V.forEach(e => reg.set(e.reg, (reg.get(e.reg) || 0) + 1));
  const [r1, n1] = [...reg.entries()].sort((a, c) => c[1] - a[1])[0];
  if (!A.state.region && r1) out.push(`Región con más sismos: <b>${esc(r1)}</b> (${nf(n1)}, ${(100 * n1 / V.length).toFixed(0)}% del total).`);
  const ds = {s:0, i:0, p:0}; V.forEach(e => { const c = A.depthClass(e.prof); if (ds[c] != null) ds[c]++; });
  out.push(`Por profundidad: ${(100 * ds.s / V.length).toFixed(0)}% superficiales (≤ 60 km), ${(100 * ds.i / V.length).toFixed(0)}% intermedios y ${(100 * ds.p / V.length).toFixed(0)}% profundos (> 300 km); mediana ${nf(median(V.map(e => e.prof || 0)))} km.`);
  if (A.slab && A.slab.ready && V.some(e => e.slab)){
    const n = k => V.filter(e => e.slab && e.slab.cls === k).length, pc = k => (100 * n(k) / V.length).toFixed(0);
    const amb = V.filter(e => e.slab && e.slab.alt).length;
    out.push(`Según su posición respecto de la placa de Nazca (Slab2): ${pc("intraplaca")}% intraplaca de profundidad intermedia, ${pc("interfase")}% de interfase, ${pc("cortical")}% corticales y ${pc("profundo")}% profundos; ${nf(amb)} quedan en el límite entre dos clases. Es una clasificación geométrica, no un análisis de mecanismo focal.`);
  }
  const tierra = V.filter(e => e.tierra === 1).length;
  if (V.some(e => e.tierra != null)) out.push(`${(100 * tierra / V.length).toFixed(0)}% de los epicentros está dentro del territorio; el resto, en el mar o en países vecinos.`);
  if (span > 2){
    const byDay = new Map(); V.forEach(e => { const k = A.fmtDate(e.t); byDay.set(k, (byDay.get(k) || 0) + 1); });
    const [dd, dn] = [...byDay.entries()].sort((a, c) => c[1] - a[1])[0];
    const avg = V.length / span;
    if (dn >= 3 && dn >= 3 * avg) out.push(`Día más activo: <b>${dd}</b> con ${dn} sismos (${(dn / avg).toFixed(1)} veces el promedio diario), lo que puede indicar una secuencia de réplicas o un enjambre.`);
  }
  // comparison with the previous period of equal length
  if (b.prev){
    const first = A.ALL[A.ALL.length - 1].t;
    if (b.prev[0] >= first){
      const n2 = A.ALL.filter(e => A.passesExceptPeriod(e, b.prev)).length, n1c = V.length;
      const s1 = Math.min(b.t1, Date.now()) - b.t0, s2 = b.prev[1] - b.prev[0];
      const r1d = n1c / (s1 / DAY), r2d = n2 / (s2 / DAY);
      if (n1c + n2 >= 10){
        const p = binomTwoSided(n1c, n1c + n2, s1 / (s1 + s2));
        const ratio = r2d > 0 ? r1d / r2d : Infinity;
        const ongoing = s1 < s2 - 3600e3 ? " (periodo en curso, se comparan tasas diarias)" : "";
        const verdict = p < 0.05 ? `la diferencia en la tasa es estadísticamente significativa (p = ${p < 0.001 ? "< 0.001" : p.toFixed(3)})`
                                 : `no hay evidencia de un cambio en la tasa (p = ${p.toFixed(2)})`;
        out.push(`Frente a ${esc(b.prevLabel)}: ${nf(n1c)} vs ${nf(n2)} sismos${ongoing}; tasa ×${isFinite(ratio) ? ratio.toFixed(2) : "∞"}. Según una prueba binomial condicional, ${verdict}. La prueba supone sismos independientes; las réplicas no lo son, así que tómese como orientativa.`);
      }
    }
  }
  if (bv){
    if (bv.b) out.push(`Valor b de Gutenberg–Richter: <b>${bv.b.toFixed(2)} ± ${bv.sb.toFixed(2)}</b> (máxima verosimilitud, ${nf(bv.n)} sismos con M ≥ ${bv.Mc.toFixed(1)}). El catálogo de reportes del IGP incluye principalmente sismos sentidos o de M ≥ 3, por lo que Mc refleja ese umbral de reporte.`);
    else out.push(`Muy pocos sismos sobre la magnitud de completitud estimada (M ${bv.Mc.toFixed(1)}; n = ${bv.n}) para calcular un valor b confiable (se requieren ≥ 50).`);
  }
  return out;
}

// ------------------------------------------------------------ render
function draw(){
  const V = A.VIEW, b = A.period, box = document.getElementById("statsbody");
  if (!b){ box.innerHTML = ""; return; }
  const bv = bValue(V.map(e => e.mag));
  const span = A.effectiveSpan(b) / DAY;
  const kpis = V.length ? [
    [nf(V.length), "Sismos"],
    [Math.max(...V.map(e => e.mag)).toFixed(1), "Mag. máxima"],
    [nf(V.filter(e => e.mag >= 4.5).length), "M ≥ 4.5"],
    [span >= 1.5 ? nf(V.length / span, V.length / span < 10 ? 1 : 0) : "–", "Sismos / día"],
    [nf(median(V.map(e => e.prof || 0))) + " km", "Prof. mediana"],
    [bv && bv.b ? bv.b.toFixed(2) : "–", "Valor b"]
  ] : [];
  box.innerHTML = `<div class="kpis">${kpis.map(([v, k]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("")}</div>`
    + `<div class="insights"><h3>Insights · ${esc(b.label)}${A.filterText() ? " · " + esc(A.filterText()) : ""}</h3><ul>${insights(V, b, bv).map(s => `<li>${s}</li>`).join("")}</ul></div>`
    + chartTimeline(V, b) + chartMagTime(V, b) + chartGR(V, bv) + chartTect(V) + chartSection(V) + chartDepthHist(V) + chartRegions(V)
    + `<p class="note">Estadísticas calculadas en su navegador a partir de los sismos que cumplen los filtros. Los reportes del IGP no son un catálogo completo para magnitudes bajas.</p>`;
}
A.drawStats = draw;
A.statsDirty = true;
A.maybeDrawStats = function(){
  if (!document.getElementById("t-stats").classList.contains("on") || !A.statsDirty) return;
  A.statsDirty = false; draw();
};
document.getElementById("statsbody").addEventListener("click", ev => {
  const pt = ev.target.closest("[data-id]"), g = ev.target.closest("[data-goto]"), r = ev.target.closest("[data-reg]"), s = ev.target.closest("#secaxis button"), tc = ev.target.closest("[data-tect]");
  if (tc){ A.state.tect = tc.dataset.tect; A.syncControls(); A.apply(); return; }
  if (pt) A.select(pt.dataset.id);
  else if (g){ ev.preventDefault(); A.select(g.dataset.goto); }
  else if (r && r.dataset.reg !== "Sin región"){ A.state.region = r.dataset.reg; A.syncControls(); A.apply(); }
  else if (s){ secAxis = s.dataset.v; draw(); }
});
// expose for testing
A._stats = {bValue, binomTwoSided, maxIntensity, timeBins};
})();
