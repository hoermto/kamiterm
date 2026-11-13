// Building blocks for function screens: tables, key-value grids, tabs and charts, all in the terminal's look.
import { esc } from "./api.js";
import { periodPnl, niceTicks } from "./equity-pnl.js";

// cols: [{ key, label, left, fmt(v,row) -> text, cls(v,row) -> class, html: true }]
export function table(rows, cols, { onRow, max = 500 } = {}) {
  const head = cols
    .map((c) => {
      // "\n" in a label = two-line header; full label (or c.title) as tooltip.
      const lab = String(c.label ?? "");
      const tip = c.title || (lab.includes("\n") ? lab.replace(/\n/g, " ") : "");
      return `<th class="${c.left ? "l" : ""}"${tip ? ` title="${esc(tip)}"` : ""}>${lab.split("\n").map(esc).join("<br>")}</th>`;
    })
    .join("");
  const body = rows
    .slice(0, max)
    .map((r, i) => {
      const tds = cols
        .map((c) => {
          const v = typeof c.key === "function" ? c.key(r) : r[c.key];
          const txt = c.fmt ? c.fmt(v, r) : v;
          const k = [
            c.left ? "l" : "",
            c.cls ? c.cls(v, r) : "",
            c.lbl ? "lbl" : "",
            c.wrap ? "wrap" : "",
          ].join(" ");
          return `<td class="${k}">${c.html ? (txt ?? "") : esc(txt ?? "—")}</td>`;
        })
        .join("");
      return `<tr data-i="${i}" class="${onRow ? "click" : ""}">${tds}</tr>`;
    })
    .join("");
  const el = document.createElement("table");
  el.className = "t";
  el.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  if (onRow)
    el.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-i]");
      if (tr) onRow(rows[+tr.dataset.i]);
    });
  return el;
}

export function kv(pairs) {
  const el = document.createElement("div");
  el.className = "kv";
  el.innerHTML = pairs
    .filter(([, v]) => v != null && v !== "")
    .map(
      ([k, v]) =>
        `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`,
    )
    .join("");
  return el;
}

export function sect(title) {
  const h = document.createElement("h3");
  h.className = "sect";
  h.textContent = title;
  return h;
}

export function html(s) {
  const d = document.createElement("div");
  d.innerHTML = s;
  return d.childElementCount === 1 ? d.firstElementChild : d;
}

export function tabs(names, current, onPick) {
  const el = document.createElement("div");
  el.className = "tabs";
  for (const n of names) {
    const b = document.createElement("button");
    b.className = `tab${n === current ? " on" : ""}`;
    b.textContent = n;
    b.onclick = () => onPick(n);
    el.append(b);
  }
  return el;
}

const css = (n) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// A price chart in the terminal's colours. Returns { chart, series, remove }.
export function priceChart(host, { type = "line", height } = {}) {
  const LW = window.LightweightCharts;
  const chart = LW.createChart(host, {
    autoSize: true,
    height,
    layout: {
      background: { type: "solid", color: "#050505" },
      textColor: css("--amber"),
      fontFamily: css("--mono"),
      fontSize: 11,
      attributionLogo: false, // credited on the DATA screen and in the README instead
    },
    grid: { vertLines: { color: "#161616" }, horzLines: { color: "#161616" } },
    rightPriceScale: { borderColor: "#262626" },
    timeScale: { borderColor: "#262626", timeVisible: true },
    crosshair: { mode: 0 },
  });
  const series =
    type === "candles"
      ? chart.addSeries(LW.CandlestickSeries, {
          upColor: css("--up"),
          downColor: css("--down"),
          wickUpColor: css("--up"),
          wickDownColor: css("--down"),
          borderVisible: false,
        })
      : chart.addSeries(LW.AreaSeries, {
          lineColor: css("--amber"),
          topColor: "rgba(255,160,40,0.28)",
          bottomColor: "rgba(255,160,40,0.02)",
          lineWidth: 2,
        });
  return { chart, series, remove: () => chart.remove() };
}

export function lineChart(host, seriesList, { percent = false } = {}) {
  const LW = window.LightweightCharts;
  const chart = LW.createChart(host, {
    autoSize: true,
    layout: {
      background: { type: "solid", color: "#050505" },
      textColor: css("--amber"),
      fontFamily: css("--mono"),
      fontSize: 11,
      attributionLogo: false, // credited on the DATA screen and in the README instead
    },
    grid: { vertLines: { color: "#161616" }, horzLines: { color: "#161616" } },
    rightPriceScale: { borderColor: "#262626", mode: percent ? 2 : 0 },
    timeScale: { borderColor: "#262626" },
  });
  for (const s of seriesList) {
    const ser = chart.addSeries(LW.LineSeries, {
      color: s.color,
      lineWidth: 2,
      title: s.title,
    });
    ser.setData(s.data);
  }
  chart.timeScale().fitContent();
  return { chart, remove: () => chart.remove() };
}

// ---------- equity chart with toggles ----------
// Ansicht „Kurve“ (Y-Achse linear | log) oder P&L-Balken je Jahr | Monat (Betrag | %), Strategie und Benchmark nebeneinander.
// seriesList wie lineChart; eine Serie mit flows:true = kumulierte Einzahlungen: nur als Linie, wird vom P&L der anderen abgezogen.
// Auswahl bleibt pro storeKey in localStorage. Returns { el, remove }.
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* privat/blockiert: egal */ } };

export function equityChart(host, seriesList, { storeKey = "equity", height = 260, cur = "" } = {}) {
  const key = `amber.eqchart.${storeKey}`;
  let st = { view: "curve", scale: "lin", unit: "abs" };
  try { st = { ...st, ...JSON.parse(lsGet(key) || "{}") }; } catch { /* default */ }
  const save = () => lsSet(key, JSON.stringify(st));

  const bar = document.createElement("div");
  bar.className = "tabs eqchart-bar";
  const plot = document.createElement("div");
  plot.style.cssText = `height:${height}px;position:relative`;
  const legend = document.createElement("div");
  legend.className = "hint eqchart-legend";
  host.replaceChildren(bar, plot, legend);

  const group = (label, opts, get, set) => {
    const g = document.createElement("span");
    g.className = "eqchart-grp";
    g.title = label;
    for (const [v, txt, tip] of opts) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `tab${get() === v ? " on" : ""}`;
      b.textContent = txt;
      if (tip) b.title = tip;
      b.onclick = () => { if (get() === v) return; set(v); save(); render(); };
      g.append(b);
    }
    return g;
  };

  let line = null;
  let ro = null;
  const flows = seriesList.find((s) => s.flows)?.data || null;
  const barSeries = seriesList.filter((s) => !s.flows && s.data?.length);

  const render = () => {
    line?.remove(); line = null;
    ro?.disconnect(); ro = null;
    plot.replaceChildren();
    legend.replaceChildren();
    bar.replaceChildren(
      group("Ansicht", [["curve", "Kurve", "Equity-Verlauf"], ["Y", "P&L Jahr", "Gewinn/Verlust je Kalenderjahr"], ["M", "P&L Monat", "Gewinn/Verlust je Monat"]], () => st.view, (v) => (st.view = v)),
      st.view === "curve"
        ? group("Y-Achse", [["lin", "Linear"], ["log", "Log", "Logarithmische Y-Achse: gleiche %-Bewegung = gleiche Höhe"]], () => st.scale, (v) => (st.scale = v))
        : group("Einheit", [["abs", cur || "Betrag", "P&L als Betrag"], ["pct", "%", "P&L in % des Periodenstarts (inkl. Einzahlungen der Periode)"]], () => st.unit, (v) => (st.unit = v)),
    );
    if (st.view === "curve") {
      line = lineChart(plot, seriesList);
      line.chart.priceScale("right").applyOptions({ mode: st.scale === "log" ? 1 : 0 });
      return;
    }
    const rows = barSeries.map((s) => ({ ...s, pnl: new Map(periodPnl(s.data, flows, st.view).map((r) => [r.period, r])) }));
    const draw = () => {
      const w = plot.clientWidth;
      if (w > 0) plot.replaceChildren(pnlBarsSvg(rows, { w, h: height, pct: st.unit === "pct", unit: st.view }));
    };
    draw();
    ro = new ResizeObserver(draw);
    ro.observe(plot);
    for (const s of rows) {
      const tot = [...s.pnl.values()];
      const sum = tot.reduce((a, r) => a + r.pnl, 0);
      const pos = tot.filter((r) => r.pnl > 0).length;
      const item = document.createElement("span");
      item.innerHTML = `<i style="background:${s.color}"></i>${esc(s.title)}: Σ ${esc(fmtPnl(sum, false))} · ${pos}/${tot.length} positiv`;
      legend.append(item);
    }
  };
  render();
  return {
    el: host,
    remove: () => { line?.remove(); ro?.disconnect(); },
  };
}

const fmtPnl = (v, pct) =>
  !Number.isFinite(v) ? "—" : pct
    ? `${v > 0 ? "+" : ""}${v.toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`
    : `${v > 0 ? "+" : ""}${v.toLocaleString("de-DE", { maximumFractionDigits: 0 })}`;
const fmtAxis = (v, pct) => {
  if (pct) return `${+v.toFixed(1)}%`;
  const a = Math.abs(v);
  return a >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : a >= 1e4 ? `${+(v / 1e3).toFixed(0)}k` : a >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : String(+v.toFixed(0));
};

// Gruppierte Balken: je Periode ein Balken pro Serie (Serienfarbe), Tooltip mit Betrag und %.
function pnlBarsSvg(rows, { w, h, pct, unit }) {
  const periods = [...new Set(rows.flatMap((s) => [...s.pnl.keys()]))].sort();
  const val = (r) => (r ? (pct ? r.pct : r.pnl) : null);
  const vals = rows.flatMap((s) => periods.map((p) => val(s.pnl.get(p)))).filter(Number.isFinite);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 5);
  const lo = ticks[0], hi = ticks.at(-1);
  const padL = 52, padR = 8, padT = 8, padB = 20;
  const pw = Math.max(10, w - padL - padR), ph = h - padT - padB;
  const y = (v) => padT + ((hi - v) / (hi - lo || 1)) * ph;
  const gw = pw / Math.max(1, periods.length);
  const bw = Math.max(1, Math.min(40, (gw * 0.8) / Math.max(1, rows.length)));
  const muted = css("--muted") || "#8c8c8c";
  const parts = [];
  for (const t of ticks) {
    parts.push(`<line x1="${padL}" x2="${w - padR}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? "#555" : "#1c1c1c"}"/>`);
    parts.push(`<text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end" fill="${muted}">${esc(fmtAxis(t, pct))}</text>`);
  }
  const showVals = unit === "Y" && bw >= 26;
  const every = Math.max(1, Math.ceil(46 / gw));
  periods.forEach((p, i) => {
    const gx = padL + i * gw + (gw - bw * rows.length) / 2;
    rows.forEach((s, j) => {
      const r = s.pnl.get(p);
      const v = val(r);
      if (!Number.isFinite(v)) return;
      const y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v));
      const tip = `${p} · ${s.title}: ${fmtPnl(r.pnl, false)} (${fmtPnl(r.pct, true)})${r.flow ? ` · Einzahlungen ${fmtPnl(r.flow, false)}` : ""}`;
      parts.push(`<rect x="${gx + j * bw}" y="${y0}" width="${Math.max(1, bw - 1)}" height="${Math.max(1, y1 - y0)}" fill="${s.color}" fill-opacity="${v < 0 ? 0.6 : 1}"><title>${esc(tip)}</title></rect>`);
      if (showVals) parts.push(`<text x="${gx + j * bw + bw / 2}" y="${v < 0 ? y1 + 11 : y0 - 3}" text-anchor="middle" fill="${s.color}" font-size="9">${esc(fmtAxis(v, pct))}</text>`);
    });
    const lab = unit === "Y" ? p : p.endsWith("-01") || periods.length <= 24 ? (periods.length <= 24 ? `${p.slice(5)}/${p.slice(2, 4)}` : p.slice(0, 4)) : "";
    const show = unit === "Y" ? i % every === 0 : periods.length <= 24 ? i % every === 0 : lab && (Number(p.slice(0, 4)) % Math.max(1, Math.ceil(every / 12)) === 0);
    if (lab && show) parts.push(`<text x="${padL + i * gw + gw / 2}" y="${h - 5}" text-anchor="middle" fill="${muted}">${esc(lab)}</text>`);
  });
  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="P&amp;L je ${unit === "Y" ? "Jahr" : "Monat"}" style="display:block;background:#050505;font:10px ${esc(css("--mono") || "monospace")}">${parts.join("")}</svg>`;
  const t = document.createElement("template");
  t.innerHTML = svg;
  return t.content.firstChild;
}

// ---------- export to CSV (every table on a screen, for Excel) ----------
// A cell as Excel reads it: numbers lose their thousands commas, a dash for "no value" becomes empty.
export function csvCell(v) {
  let s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (s === "—" || s === "-") s = "";
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?%?$/.test(s)) s = s.replace(/,/g, "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// blocks: [{ title, rows: [[cell, ...], ...] }] -> one CSV text, tables separated by a blank line and their titles.
export function buildCsv(blocks, { heading, footer } = {}) {
  const parts = [];
  if (heading) parts.push(csvCell(heading));
  for (const b of blocks) {
    if (!b.rows?.length) continue;
    const lines = b.rows.map((r) => r.map(csvCell).join(","));
    parts.push([b.title ? csvCell(b.title) : null, ...lines].filter((x) => x != null).join("\r\n"));
  }
  if (footer) parts.push(csvCell(footer));
  return `${parts.join("\r\n\r\n")}\r\n`;
}

// DES-AAPL_US_EQUITY-2026-10-15.csv, or WEI-2026-10-15.csv for a market-wide screen.
export function csvName(fn, security, d = new Date()) {
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const sec = String(security || "").trim().replace(/[^A-Za-z0-9.]+/g, "_").replace(/^_|_$/g, "");
  return `${[fn, sec, day].filter(Boolean).join("-")}.csv`;
}

// The tables (and key-value grids) inside a screen, in reading order, with the section title above each.
// Buttons and other controls marked data-noexp are left out, and so is a column with nothing in it (sparklines).
export function tableBlocks(root) {
  const text = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll("[data-noexp], button").forEach((x) => x.remove());
    return c.textContent.replace(/\s+/g, " ").trim();
  };
  const blocks = [];
  let title = null;
  for (const el of root.querySelectorAll("h3.sect, table, .kv")) {
    if (el.matches("h3.sect")) {
      title = text(el);
      continue;
    }
    if (el.parentElement?.closest("table")) continue;
    let rows;
    if (el.matches(".kv")) {
      const cells = [...el.children].map(text);
      rows = [];
      for (let i = 0; i + 1 < cells.length; i += 2) rows.push([cells[i], cells[i + 1]]);
    } else {
      const head = el.tHead ? [[...el.tHead.rows].at(-1)] : [];
      const body = [...el.rows].filter((r) => !el.tHead || r.parentElement !== el.tHead);
      const hrow = head.length ? [...head[0].cells].map(text) : null;
      const brows = body.map((r) => [...r.cells].map(text));
      const width = Math.max(hrow?.length || 0, ...brows.map((r) => r.length));
      const keep = Array.from({ length: width }, (_, j) => brows.some((r) => r[j]) || (!brows.length && hrow?.[j]));
      rows = [...(hrow ? [hrow] : []), ...brows].map((r) => r.filter((_, j) => keep[j]));
    }
    if (rows.length) blocks.push({ title, rows });
    title = null;
  }
  return blocks;
}

export function downloadText(name, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- delayed prices ----------
// "delayed, 14:32" beside a price that runs behind the market. q.delayMin is the delay its source states (0 or
// missing means live, and shows nothing); q.asOf is the source's own time for that price (seconds, milliseconds or
// an ISO date), shown in your local time with the date when it isn't today. A source with no time shows its stated
// delay instead ("delayed 15 min"). data-noexp keeps it out of CSV exports.
export function delayTag(q) {
  const min = Number(q?.delayMin);
  if (!(min > 0)) return "";
  const t = q.asOf == null ? null : new Date(typeof q.asOf === "number" && q.asOf < 1e12 ? q.asOf * 1000 : q.asOf);
  let text = `delayed ${min} min`;
  if (t && Number.isFinite(+t)) {
    const hm = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    text = `delayed, ${t.toDateString() === new Date().toDateString() ? hm : `${t.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${hm}`}`;
  }
  return ` <span class="delay" data-noexp title="The source runs ${min} minutes behind the market">${text}</span>`;
}

// ---------- source links ----------
// Footers name their sources in words; these turn into links to the public page the numbers came from.
export const SOURCE_LINKS = {
  "US Treasury": "https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
  Treasury: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates",
  TreasuryDirect: "https://www.treasurydirect.gov/auctions/upcoming/",
  "New York Fed": "https://www.newyorkfed.org/markets/reference-rates",
  "NY Fed": "https://www.newyorkfed.org/markets/reference-rates",
  "SEC EDGAR": "https://www.sec.gov/edgar/search/",
  EDGAR: "https://www.sec.gov/edgar/search/",
  SEC: "https://www.sec.gov/edgar/search/",
  CBOE: "https://www.cboe.com/delayed_quotes/",
  Cboe: "https://www.cboe.com/delayed_quotes/",
  FRED: "https://fred.stlouisfed.org/",
  "St. Louis Fed": "https://fred.stlouisfed.org/",
  BIS: "https://data.bis.org/",
  CFTC: "https://publicreporting.cftc.gov/",
  "Yahoo Finance": "https://finance.yahoo.com/",
  Yahoo: "https://finance.yahoo.com/",
  Nasdaq: "https://www.nasdaq.com/",
  Binance: "https://www.binance.com/",
  Coinbase: "https://www.coinbase.com/",
  Kraken: "https://www.kraken.com/",
  "Forex Factory": "https://www.forexfactory.com/calendar",
  CNBC: "https://www.cnbc.com/",
  MarketWatch: "https://www.marketwatch.com/",
  "Google News": "https://news.google.com/",
  CME: "https://www.cmegroup.com/",
  "Federal Reserve": "https://www.federalreserve.gov/",
  ECB: "https://data.ecb.europa.eu/",
  "Bank of England": "https://www.bankofengland.co.uk/boeapps/database/",
  BLS: "https://www.bls.gov/",
  BEA: "https://www.bea.gov/",
};
const SOURCE_RE = new RegExp(
  `(?<![A-Za-z])(${Object.keys(SOURCE_LINKS)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(?![A-Za-z])`,
  "g",
);
export function linkSources(text) {
  return String(text ?? "")
    .split(SOURCE_RE)
    .map((part, i) =>
      i % 2 ? `<a href="${SOURCE_LINKS[part]}" target="_blank" rel="noopener noreferrer">${esc(part)}</a>` : esc(part),
    )
    .join("");
}

// ---------- LIVE switch (WEI, GLCO, GP): faster refresh, and prices flash green or red when they move ----------
export const LIVE_MS = 5e3;
export const isLive = () => {
  try {
    return localStorage.getItem("amber.live") === "1";
  } catch {
    return false;
  }
};
// A LIVE button that remembers its state; onChange(on) runs when it's pressed.
export function liveTab(onChange) {
  const b = document.createElement("button");
  b.className = `tab${isLive() ? " on" : ""}`;
  b.title = "Live prices: refresh every 5 seconds and flash each change";
  b.textContent = "LIVE";
  b.onclick = () => {
    const on = !isLive();
    try {
      localStorage.setItem("amber.live", on ? "1" : "0");
    } catch {}
    b.classList.toggle("on", on);
    onChange(on);
  };
  return b;
}
// "flash-up", "flash-down" or "" for a value that went from prev to next.
export const tickClass = (prev, next) =>
  Number.isFinite(prev) && Number.isFinite(next) && prev !== next
    ? next > prev
      ? "flash-up"
      : "flash-down"
    : "";
// The last bar with a new live price folded in (high and low stretch to take it).
export const liveBar = (bar, price) =>
  bar && Number.isFinite(price) && price > 0
    ? {
        ...bar,
        close: price,
        high: Math.max(bar.high ?? price, price),
        low: Math.min(bar.low ?? price, price),
      }
    : bar;
