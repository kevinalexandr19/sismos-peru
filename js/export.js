"use strict";
/* Export the current map view to PNG: basemap tiles + vector canvases + labels,
   with title, data summary, legend, scale bar and north arrow. The interface
   (panels, buttons, floating windows) is not included. */
(function(){
const A = window.APP, map = A.map, $ = A.$;
const dlg = $("#exportdlg");

A.openExport = function(){
  const b = A.period, ft = A.filterText();
  if (!$("#exp-title").dataset.touched) $("#exp-title").value = "Sismos del Perú";
  $("#exp-sub").value = `${b.label[0].toUpperCase() + b.label.slice(1)}${ft ? " · " + ft : ""}`;
  dlg.classList.add("on"); $("#exp-title").focus();
};
$("#exp-title").addEventListener("input", e => e.target.dataset.touched = "1");
$("#exp-cancel").onclick = () => dlg.classList.remove("on");
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.classList.remove("on"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") dlg.classList.remove("on"); });
$("#exp-go").onclick = async () => {
  const opts = {title:$("#exp-title").value.trim(), sub:$("#exp-sub").value.trim(), legend:$("#exp-legend").checked,
                data:$("#exp-data").checked, north:$("#exp-north").checked, scale:+$("#exp-res").value};
  dlg.classList.remove("on");
  try { await exportPNG(opts, true); }
  catch (err){
    if (err && err.name === "SecurityError"){
      A.toast("El mapa base no permite exportarse; se generó la imagen sin él.");
      await exportPNG(opts, false);
    } else { console.error(err); A.toast("No se pudo generar la imagen: " + err.message); }
  }
};

function paneZ(el){
  for (let n = el; n && n !== map.getContainer(); n = n.parentElement){
    if (n.classList && n.classList.contains("leaflet-pane")){ const z = parseInt(getComputedStyle(n).zIndex); if (!isNaN(z)) return z; }
  }
  return 0;
}
function opacityChain(el){
  let o = 1; for (let n = el; n && n !== map.getContainer(); n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || 1);
  return o;
}
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function wrap(ctx, text, maxW){
  const words = text.split(" "), lines = []; let cur = "";
  words.forEach(w => { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > maxW && cur){ lines.push(cur); cur = w; } else cur = t; });
  if (cur) lines.push(cur); return lines;
}
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif';

async function exportPNG(o, withTiles){
  const dark = A.theme === "dark";            // the image follows the current light/dark theme
  const P = dark
    ? {box:"rgba(26,31,38,.93)", box85:"rgba(26,31,38,.85)", box80:"rgba(26,31,38,.8)", ink:"#e4e7eb", sub:"#aab2bc", text:"#cfd4da", fg:"#e6e6e6", alt:"#1a1f26", halo:"rgba(0,0,0,.9)", sizeFill:"#59626d", sizeStroke:"#aab"}
    : {box:"rgba(255,255,255,.93)", box85:"rgba(255,255,255,.85)", box80:"rgba(255,255,255,.8)", ink:"#1d232b", sub:"#4a525c", text:"#333333", fg:"#222222", alt:"#ffffff", halo:"rgba(255,255,255,.95)", sizeFill:"#cccccc", sizeStroke:"#555555"};
  const box = map.getContainer().getBoundingClientRect(), W = Math.round(box.width), H = Math.round(box.height), s = o.scale;
  const cv = document.createElement("canvas"); cv.width = W * s; cv.height = H * s;
  const ctx = cv.getContext("2d"); ctx.scale(s, s);
  ctx.fillStyle = getComputedStyle(map.getContainer()).backgroundColor || "#dfe6ea"; ctx.fillRect(0, 0, W, H);
  const at = el => { const r = el.getBoundingClientRect(); return [r.left - box.left, r.top - box.top, r.width, r.height]; };

  // 1. basemap tiles
  if (withTiles){
    document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile-loaded").forEach(img => {
      const [x, y, w, h] = at(img); if (x > W || y > H || x + w < 0 || y + h < 0) return;
      ctx.globalAlpha = opacityChain(img); ctx.drawImage(img, x, y, w, h);
    });
    ctx.globalAlpha = 1;
    ctx.getImageData(0, 0, 1, 1);                 // throws SecurityError if a tile tainted the canvas
  }
  // 2. vector layers (Leaflet canvas renderers and the heat map), in pane order
  const canvases = [...map.getPanes().mapPane.querySelectorAll("canvas")].filter(c => !c.closest(".leaflet-tile-pane") && c.width && getComputedStyle(c).display !== "none");
  canvases.sort((a, b) => paneZ(a) - paneZ(b)).forEach(c => { const [x, y, w, h] = at(c); ctx.globalAlpha = opacityChain(c); ctx.drawImage(c, x, y, w, h); });
  ctx.globalAlpha = 1;
  // 3. permanent labels (departments, cities)
  ctx.textBaseline = "middle";
  document.querySelectorAll(".leaflet-tooltip-pane .lbl").forEach(el => {
    const st = getComputedStyle(el); if (st.display === "none" || st.visibility === "hidden") return;
    const [x, y, w, h] = at(el); if (x > W || y > H || x + w < 0 || y + h < 0) return;
    ctx.font = `${st.fontWeight} ${st.fontSize} ${FONT}`;
    ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = P.halo; ctx.fillStyle = st.color;
    const text = el.textContent, tx = x + (w - ctx.measureText(text).width) / 2;
    if (st.letterSpacing && st.letterSpacing !== "normal" && "letterSpacing" in ctx) ctx.letterSpacing = st.letterSpacing;
    ctx.strokeText(text, tx, y + h / 2); ctx.fillText(text, tx, y + h / 2);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  });

  // 4. title + data block (top-left)
  const pad = 12;
  if (o.title || o.sub || o.data){
    const V = A.VIEW, maxW = Math.min(420, W - 140);
    const lines = [];
    ctx.font = `700 18px ${FONT}`; if (o.title) wrap(ctx, o.title, maxW).forEach(t => lines.push([t, `700 18px ${FONT}`, P.ink, 23]));
    ctx.font = `400 12.5px ${FONT}`; if (o.sub) wrap(ctx, o.sub, maxW).forEach(t => lines.push([t, `400 12.5px ${FONT}`, P.sub, 17]));
    if (o.data && V.length){
      const big = V.reduce((a, e) => e.mag > a.mag ? e : a);
      const d = [`${A.nf(V.length)} sismos · ${A.nf(V.filter(e => e.mag >= 4.5).length)} con M ≥ 4.5`,
                 `Mayor: M${big.mag.toFixed(1)} · ${A.fmtLocal(big.t, false)} · ${big.ref}`,
                 `Último del catálogo: ${A.fmtLocal(A.ALL[0].t, false)} (hora de Perú)`];
      ctx.font = `400 11.5px ${FONT}`;
      lines.push(["", "", "", 4]);
      d.forEach(t => wrap(ctx, t, maxW).forEach(x => lines.push([x, `400 11.5px ${FONT}`, P.text, 15])));
    }
    let bw = 0; lines.forEach(([t, f]) => { if (t){ ctx.font = f; bw = Math.max(bw, ctx.measureText(t).width); } });
    const bh = lines.reduce((a, l) => a + l[3], 0) + 14;
    ctx.fillStyle = P.box; ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 6;
    roundRect(ctx, pad, pad, bw + 24, bh, 8); ctx.fill(); ctx.shadowBlur = 0;
    let y = pad + 8;
    lines.forEach(([t, f, c, lh]) => { if (t){ ctx.font = f; ctx.fillStyle = c; ctx.fillText(t, pad + 12, y + lh / 2); } y += lh; });
  }

  // 5. legend (bottom-right)
  let legendTop = H;
  if (o.legend){
    const S = A.legendModel(), rows = [];
    S.forEach(sec => { rows.push({kind:"title", text:sec.title, h:17}); if (sec.sizes) rows.push({kind:"sizes", h:2 * A.radiusOf(7) + 16}); else sec.items.forEach(i => rows.push({kind:"item", i, h:16})); });
    ctx.font = `400 11px ${FONT}`;
    let lw = 0; rows.forEach(r => { if (r.kind === "title"){ ctx.font = `700 11px ${FONT}`; lw = Math.max(lw, ctx.measureText(r.text).width); } else if (r.kind === "item"){ ctx.font = `400 11px ${FONT}`; lw = Math.max(lw, 26 + ctx.measureText(r.i.label).width); } else lw = Math.max(lw, 5 * (2 * A.radiusOf(7)) * .62); });
    const bw = lw + 22, bh = rows.reduce((a, r) => a + r.h, 0) + 12;
    const x0 = W - pad - bw, y0 = H - 22 - bh; legendTop = y0;
    ctx.fillStyle = P.box; ctx.shadowColor = "rgba(0,0,0,.25)"; ctx.shadowBlur = 6;
    roundRect(ctx, x0, y0, bw, bh, 8); ctx.fill(); ctx.shadowBlur = 0;
    let y = y0 + 6;
    rows.forEach(r => {
      const cy = y + r.h / 2, x = x0 + 11;
      if (r.kind === "title"){ ctx.font = `700 11px ${FONT}`; ctx.fillStyle = P.ink; ctx.fillText(r.text, x, cy + 2); }
      else if (r.kind === "sizes"){
        let cx = x; const base = y + r.h - 12;
        [3,4,5,6,7].forEach(m => { const rr = A.radiusOf(m); ctx.beginPath(); ctx.arc(cx + rr, base - rr, rr, 0, 2 * Math.PI); ctx.fillStyle = P.sizeFill; ctx.fill(); ctx.strokeStyle = P.sizeStroke; ctx.lineWidth = 1; ctx.stroke();
          ctx.font = `400 10px ${FONT}`; ctx.fillStyle = P.sub; ctx.textAlign = "center"; ctx.fillText(String(m), cx + rr, base + 7); ctx.textAlign = "left"; cx += 2 * rr + 7; });
      } else {
        const i = r.i;
        if (i.type === "dot"){ ctx.beginPath(); ctx.arc(x + 6, cy, 5, 0, 2 * Math.PI); ctx.fillStyle = i.color; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 1; ctx.stroke(); }
        else if (i.type === "city"){ ctx.beginPath(); ctx.arc(x + 6, cy, i.main ? 4.5 : 3, 0, 2 * Math.PI); ctx.fillStyle = i.main ? A.TC("cityFill") : A.TC("secFill"); ctx.fill(); ctx.strokeStyle = P.fg; ctx.lineWidth = i.main ? 1.8 : 1; ctx.stroke(); }
        else { ctx.beginPath(); ctx.setLineDash(i.dash || []); ctx.moveTo(x, cy); ctx.lineTo(x + 20, cy); ctx.strokeStyle = i.color; ctx.lineWidth = Math.max(1.3, i.width); ctx.stroke(); ctx.setLineDash([]); }
        ctx.font = `400 11px ${FONT}`; ctx.fillStyle = P.ink; ctx.fillText(i.label, x + 26, cy + 1);
      }
      y += r.h;
    });
  }

  // 6. scale bar (bottom-left) and north arrow (top-right)
  if (o.north){
    const yb = H - 34, xb = pad + 4;
    const p1 = map.containerPointToLatLng([W / 2 - 50, H / 2]), p2 = map.containerPointToLatLng([W / 2 + 50, H / 2]);
    const mPerPx = map.distance(p1, p2) / 100;
    const maxKm = 160 * mPerPx / 1000, k = Math.pow(10, Math.floor(Math.log10(maxKm)));
    const km = [5, 2, 1].map(f => f * k).find(v => v <= maxKm) || k;
    const px = km * 1000 / mPerPx;
    ctx.fillStyle = P.box85; roundRect(ctx, xb - 6, yb - 20, px + 46, 34, 6); ctx.fill();
    for (let i = 0; i < 4; i++){ ctx.fillStyle = i % 2 ? P.alt : P.fg; ctx.fillRect(xb + i * px / 4, yb, px / 4, 6); }
    ctx.strokeStyle = P.fg; ctx.lineWidth = 1; ctx.strokeRect(xb, yb, px, 6);
    ctx.font = `400 10.5px ${FONT}`; ctx.fillStyle = P.fg; ctx.textAlign = "center";
    ctx.fillText("0", xb, yb - 8); ctx.fillText(String(km / 2).replace(".", ","), xb + px / 2, yb - 8); ctx.fillText(`${String(km).replace(".", ",")} km`, xb + px + 8, yb - 8);
    ctx.textAlign = "left";
    // north arrow
    const nx = W - pad - 22, ny = pad + 14;
    ctx.fillStyle = P.box85; roundRect(ctx, nx - 18, ny - 8, 36, 52, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(nx, ny + 4); ctx.lineTo(nx + 9, ny + 36); ctx.lineTo(nx, ny + 29); ctx.closePath(); ctx.fillStyle = P.fg; ctx.fill();
    ctx.beginPath(); ctx.moveTo(nx, ny + 4); ctx.lineTo(nx - 9, ny + 36); ctx.lineTo(nx, ny + 29); ctx.closePath(); ctx.fillStyle = P.alt; ctx.fill(); ctx.strokeStyle = P.fg; ctx.stroke();
    ctx.font = `700 11px ${FONT}`; ctx.fillStyle = P.fg; ctx.textAlign = "center"; ctx.fillText("N", nx, ny - 1); ctx.textAlign = "left";
  }

  // 7. credits (bottom edge)
  const now = Date.now();
  const credit = `Sismos: IGP – Centro Sismológico Nacional · Fallas: GEM GAF-DB · Ciudades y vías: Natural Earth · Departamentos: INEI${withTiles ? " · Mapa base: " + A.BASES[A.base].credit : ""} · Generado ${A.fmtLocal(now, false)} (hora de Perú)`;
  ctx.font = `400 9.5px ${FONT}`;
  const cw = Math.min(W - 2 * pad, ctx.measureText(credit).width + 12);
  ctx.fillStyle = P.box80; ctx.fillRect(W - cw - 4, H - 15, cw + 4, 15);
  ctx.fillStyle = P.text; ctx.textAlign = "right"; ctx.fillText(credit, W - 8, H - 7.5, W - 2 * pad - 12); ctx.textAlign = "left";

  const blob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("toBlob falló")), "image/png"));
  const p = A.limaParts(now), name = `sismos-peru_${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}_${String(p.h).padStart(2, "0")}${String(p.mi).padStart(2, "0")}.png`;
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  A.lastExport = {name, width:cv.width, height:cv.height};
  return cv;
}
A.exportPNG = exportPNG;
})();
