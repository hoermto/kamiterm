// HEAT: market heatmap. One tile per stock, sized by market cap (STOXX 600: index weight), coloured by the
// price change over the chosen period. S&P 500 and Nasdaq-100 grouped by sector, STOXX 600 by country.
// HEAT SPX · HEAT SPX XLK 1W · HEAT SXXP Germany YTD · HEAT DAX. A group header zooms in, a tile opens the chart.
// Data: lib/fn/heat.js (daily bars from the OHLC cache, all periods at once, so switching period needs no reload).
import { api, esc } from "../api.js";
import { sect, tabs, html } from "../ui.js";

const UNIS = ["SPX", "NDX", "DAX", "SXXP"];
const UNI_ALIASES = { SP500: "SPX", NASDAQ: "NDX", NDX100: "NDX", DAX40: "DAX", STOXX: "SXXP", STOXX600: "SXXP", EUROSTOXX600: "SXXP" };
const PERIODS = ["1D", "1W", "1M", "3M", "YTD", "1Y"];
// Full colour at this change (in %): a 3% day is as strong as a 30% year.
const SCALE = { "1D": 3, "1W": 6, "1M": 10, "3M": 15, YTD: 30, "1Y": 30 };
const HEAD = 15; // group header height in px
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const sgn = (v, d = 2) => (finite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
const groupArg = (k) => String(k).replace(/ /g, "_");

/** Squarified treemap: items [{value}] (any order) into the rectangle -> [{item, x, y, w, h}]. */
export function squarify(items, x, y, w, h) {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const out = [];
  let total = list.reduce((s, i) => s + i.value, 0);
  let i = 0;
  while (i < list.length && w > 0 && h > 0) {
    const scale = (w * h) / total;
    const side = Math.min(w, h);
    const worst = (sum, min, max) => {
      const s2 = sum * sum, l2 = side * side;
      return Math.max((l2 * max) / s2, s2 / (l2 * min));
    };
    let j = i, sum = 0, min = Infinity, max = 0, best = Infinity;
    while (j < list.length) {
      const a = list[j].value * scale;
      const r = worst(sum + a, Math.min(min, a), Math.max(max, a));
      if (j > i && r > best) break;
      best = r; sum += a; min = Math.min(min, a); max = Math.max(max, a); j++;
    }
    // Lay the row along the short side.
    const thick = sum / side;
    let off = 0;
    for (let k = i; k < j; k++) {
      const len = (list[k].value * scale) / thick;
      out.push(w >= h
        ? { item: list[k], x, y: y + off, w: thick, h: len }
        : { item: list[k], x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    total -= list.slice(i, j).reduce((s, it) => s + it.value, 0);
    i = j;
  }
  return out;
}

/** Change in % -> background colour: red through dark grey to green, full at ±limit. */
export function heatColor(v, limit) {
  if (!finite(v)) return "rgb(40,40,40)";
  const t = Math.max(-1, Math.min(1, v / limit));
  const base = [44, 44, 48], up = [24, 150, 70], down = [200, 45, 45];
  const to = t >= 0 ? up : down, a = Math.abs(t);
  return `rgb(${base.map((b, n) => Math.round(b + (to[n] - b) * a)).join(",")})`;
}

const wavg = (rows, p) => {
  let s = 0, w = 0;
  for (const r of rows) if (finite(r.chg[p])) { s += r.chg[p] * r.weight; w += r.weight; }
  return w ? s / w : null;
};

async function loadSaved() {
  try { return (await api.get("/api/settings?tool=HEAT"))?.settings || {}; } catch { return {}; }
}

async function heat(ctx) {
  const saved = await loadSaved();
  const args = ctx.args.map((a) => String(a));
  const up = args.map((a) => a.toUpperCase());
  const uni = up.map((a) => UNI_ALIASES[a] || a).find((a) => UNIS.includes(a)) || saved.universe || "SPX";
  let period = up.find((a) => PERIODS.includes(a)) || saved.period || "1D";
  const rest = args.filter((a, n) => !UNIS.includes(UNI_ALIASES[up[n]] || up[n]) && !PERIODS.includes(up[n]));
  const wanted = rest.join(" ").replace(/_/g, " ").trim().toLowerCase();

  ctx.el.replaceChildren(html(`<p class="hint">Loading ${esc(uni)} prices (the first run fills the price cache and can take a minute)…</p>`));
  const d = await api.fn("heat", { universe: uni });
  if (!ctx.live()) return;
  ctx.follow?.(d.live); // newer bars in the background rebuild the map quietly
  const zoom = wanted ? d.groups.find((g) => g.key.toLowerCase() === wanted || g.name.toLowerCase() === wanted) : null;
  const cmd = (o = {}) => {
    const g = "group" in o ? o.group : zoom?.key;
    return `HEAT ${o.universe || d.universe}${g ? ` ${groupArg(g)}` : ""} ${o.period || period}`;
  };
  const save = () => api.put("/api/settings", { tool: "HEAT", settings: { universe: d.universe, period, updatedAt: new Date().toISOString() } }).catch(() => {});
  save();

  const head = sect(`Heatmap · ${d.label}${zoom ? ` · ${zoom.name}` : ""}`);
  const uniTabs = tabs(UNIS, d.universe, (u) => ctx.go(cmd({ universe: u, group: null })));
  const periodTabs = tabs(PERIODS, period, (p) => { period = p; ctx.setCmd(cmd()); save(); draw(); });
  // S&P 500 sub-universes: one tab per sector (and Nasdaq-100 / STOXX 600 groups by clicking a header).
  const subTabs = d.groupBy === "sector" && d.universe === "SPX"
    ? tabs(["ALL", ...d.groups.map((g) => g.key)], zoom?.key || "ALL", (k) => ctx.go(cmd({ group: k === "ALL" ? null : k })))
    : zoom ? tabs(["ALL", zoom.name], zoom.name, (k) => k === "ALL" && ctx.go(cmd({ group: null }))) : null;
  if (subTabs && d.universe === "SPX") for (const b of subTabs.querySelectorAll(".tab")) b.title = d.groups.find((g) => g.key === b.textContent)?.name || "All sectors";
  const summary = html(`<p class="hint"></p>`);
  const map = html(`<div class="heatmap" style="position:relative;width:100%;user-select:none"></div>`);
  const legend = html(`<p class="hint"></p>`);
  ctx.el.replaceChildren(head, uniTabs, ...(subTabs ? [subTabs] : []), periodTabs, summary, map, legend);

  const rows = zoom ? d.rows.filter((r) => r.group === zoom.key) : d.rows;
  const groupName = new Map(d.groups.map((g) => [g.key, g.name]));

  function draw() {
    for (const b of periodTabs.querySelectorAll(".tab")) b.classList.toggle("on", b.textContent === period);
    const W = Math.max(320, map.clientWidth || ctx.el.clientWidth || 800);
    const H = Math.max(360, Math.min(900, Math.round(window.innerHeight - map.getBoundingClientRect().top - 40), Math.round(W * 0.62)));
    map.style.height = `${H}px`;
    const lim = SCALE[period];
    const ups = rows.filter((r) => r.chg[period] > 0).length, downs = rows.filter((r) => r.chg[period] < 0).length;
    summary.innerHTML = `${rows.length} stocks · weighted ${period} change <b class="${wavg(rows, period) >= 0 ? "up" : "down"}">${sgn(wavg(rows, period))}</b> · ${ups} up, ${downs} down · prices as of ${esc(d.asOf || "—")}`;
    const parts = [];
    const tile = (r, x, y, w, h) => {
      const v = r.chg[period];
      const big = w > 44 && h > 26, mid = w > 26 && h > 13;
      const fs = Math.max(9, Math.min(22, Math.sqrt(w * h) / 5));
      const label = big ? `<b style="font-size:${fs}px">${esc(r.t.replace(/\.[A-Z]+$/, ""))}</b><br><span style="font-size:${Math.max(9, fs * 0.7)}px">${sgn(v)}</span>`
        : mid ? `<span style="font-size:9px">${esc(r.t.replace(/\.[A-Z]+$/, ""))}</span>` : "";
      parts.push(`<div class="heat-tile" data-t="${esc(r.t)}" title="${esc(`${r.t} ${r.name}\n${period}: ${sgn(v)} · price ${r.price?.toFixed(2)} · ${PERIODS.filter((p) => p !== period).map((p) => `${p} ${sgn(r.chg[p], 1)}`).join(", ")}\nClick for the chart`)}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${Math.max(0, w - 1).toFixed(1)}px;height:${Math.max(0, h - 1).toFixed(1)}px;background:${heatColor(v, lim)}">${label}</div>`);
    };
    const grouped = d.groupBy && !zoom && d.groups.length > 1;
    if (!grouped) {
      for (const g of squarify(rows.map((r) => ({ ...r, value: r.weight })), 0, 0, W, H)) tile(g.item, g.x, g.y, g.w, g.h);
    } else {
      const gs = d.groups.map((g) => {
        const rs = rows.filter((r) => r.group === g.key);
        return { key: g.key, rs, value: rs.reduce((s, r) => s + r.weight, 0) };
      });
      for (const g of squarify(gs, 0, 0, W, H)) {
        const { key, rs } = g.item;
        const hh = g.h > 40 && g.w > 40 ? HEAD : 0;
        if (hh) {
          const avg = wavg(rs, period);
          parts.push(`<div class="heat-group" data-g="${esc(key)}" title="${esc(`${groupName.get(key)}: ${rs.length} stocks, weighted ${sgn(avg)}. Click to zoom in`)}" style="left:${g.x.toFixed(1)}px;top:${g.y.toFixed(1)}px;width:${Math.max(0, g.w - 1).toFixed(1)}px;height:${hh - 1}px">${esc(groupName.get(key))} <span class="${avg >= 0 ? "up" : "down"}">${sgn(avg, 1)}</span></div>`);
        }
        for (const t of squarify(rs.map((r) => ({ ...r, value: r.weight })), g.x, g.y + hh, g.w, g.h - hh)) tile(t.item, t.x, t.y, t.w, t.h);
      }
    }
    map.innerHTML = parts.join("");
    legend.innerHTML = `Tile size: ${esc(d.sizeBy)}. Colour: ${period} change, full red/green at ±${lim}%: ${[-lim, -lim / 2, 0, lim / 2, lim].map((v) => `<span style="background:${heatColor(v, lim)};color:#fff;padding:0 6px">${sgn(v, v % 1 ? 1 : 0)}</span>`).join(" ")}. ${d.groupBy ? `Click a ${d.groupBy} header to zoom in, ` : ""}click a tile for the chart.${d.coverage.loaded < d.coverage.stocks ? ` ${d.coverage.stocks - d.coverage.loaded} of ${d.coverage.stocks} without prices${d.coverage.partial ? " (not all loaded in time: run again)" : ""}.` : ""}`;
  }

  map.onclick = (e) => {
    const t = e.target.closest(".heat-tile")?.dataset.t;
    if (t) return ctx.go(`${t} GP`);
    const g = e.target.closest(".heat-group")?.dataset.g;
    if (g) ctx.go(cmd({ group: g }));
  };
  draw();
  let lastW = map.clientWidth;
  const ro = new ResizeObserver(() => {
    if (!ctx.live() || map.clientWidth === lastW) return;
    lastW = map.clientWidth;
    draw();
  });
  ro.observe(map);
  ctx.onCleanup(() => ro.disconnect());
  ctx.setSource(d.source);
}

export default [
  {
    id: "HEAT",
    name: "Market heatmap (S&P 500 and sectors, Nasdaq-100, DAX 40, STOXX Europe 600)",
    group: "Kamikaze",
    needs: false,
    source: "Yahoo daily prices via the OHLC cache, Yahoo market caps, iShares STOXX 600 weights",
    render: heat,
  },
];
