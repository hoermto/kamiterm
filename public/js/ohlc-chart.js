// Shared OHLC price chart with its controls: range tabs, CANDLES | LINE, studies (SMA, EMA, Bollinger, volume,
// RSI, MACD), LIVE and a quote line. Used by GP/GIP (fills the panel), FV (fair-value lines on top) and DMOV
// (ex-date markers). A screen adds its own drawing through `decorate`, called after every repaint.
import { api, esc, px, pct, cls } from "./api.js";
import { tabs, priceChart, html, liveTab, isLive, liveBar, tickClass, LIVE_MS, delayTag } from "./ui.js";
import { compute } from "../lib/indicators.js";

// Range → [bar size, bars shown]. 10Y on weekly bars, MAX on monthly bars.
export const RANGES = {
  "1D": ["5m", 120],
  "5D": ["15m", 160],
  "1M": ["1h", 200],
  "6M": ["1D", 130],
  "1Y": ["1D", 260],
  "5Y": ["1W", 270],
  "10Y": ["1W", 530],
  MAX: ["1M", 600],
};

// GP studies, drawn with the reference-tested formulas in public/lib/indicators.js. Overlays and volume sit
// on the price pane; RSI and MACD get panes of their own underneath. Your choice is saved as amberStudies.
const STUDIES = [
  { id: "SMA50", label: "SMA 50", color: "#5aaeff" },
  { id: "SMA200", label: "SMA 200", color: "#ff5ec8" },
  { id: "EMA20", label: "EMA 20", color: "#f2d21b" },
  { id: "BB", label: "Bollinger 20,2", color: "#b48cff" },
  { id: "VOL", label: "Volume", color: "#8c8c8c" },
  { id: "RSI", label: "RSI 14", color: "#ffbf66" },
  { id: "MACD", label: "MACD 12,26,9", color: "#3ee0c5" },
];
const DEFAULT_STUDIES = ["SMA50", "SMA200", "VOL"];
// Extra bars loaded before the visible range, so a 200-bar average is already running at the left edge.
const WARMUP = 250;
// Each screen keeps its own choice in /api/state under its key (GP: amberStudies).
const studiesSaved = new Map();
const loadStudies = (key, defaults) => {
  if (!studiesSaved.has(key))
    studiesSaved.set(key, api
      .get("/api/state")
      .then((s) =>
        Array.isArray(s?.[key])
          ? s[key].filter((id) => STUDIES.some((x) => x.id === id))
          : defaults.slice(),
      )
      .catch(() => defaults.slice()));
  return studiesSaved.get(key);
};
const saveStudies = (key, on) => {
  studiesSaved.set(key, Promise.resolve(on.slice()));
  api.put("/api/state", { [key]: on }).catch(() => {});
};

// Studies are worked out on every bar loaded (warm-up included) and drawn from bar `from` on, the visible range.
function drawStudies(chart, bars, on, from = 0) {
  const LW = window.LightweightCharts;
  const color = (id) => STUDIES.find((s) => s.id === id).color;
  const pts = (arr) =>
    bars
      .map((b, i) => ({ time: b.time, value: arr[i] }))
      .filter((p, i) => i >= from && Number.isFinite(p.value));
  const quiet = {
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  };
  const line = (values, c, pane = 0, extra = {}) =>
    chart
      .addSeries(LW.LineSeries, { ...quiet, color: c, ...extra }, pane)
      .setData(pts(values));
  if (on.includes("SMA50"))
    line(compute("sma", bars, { length: 50 }).value, color("SMA50"));
  if (on.includes("SMA200"))
    line(compute("sma", bars, { length: 200 }).value, color("SMA200"));
  if (on.includes("EMA20"))
    line(compute("ema", bars, { length: 20 }).value, color("EMA20"));
  if (on.includes("BB")) {
    const bb = compute("bb", bars, { length: 20, mult: 2 });
    line(bb.upper, color("BB"));
    line(bb.basis, color("BB"), 0, { lineStyle: 2 });
    line(bb.lower, color("BB"));
  }
  const shown = bars.slice(from);
  if (on.includes("VOL") && shown.some((b) => b.volume > 0)) {
    const v = chart.addSeries(
      LW.HistogramSeries,
      {
        priceScaleId: "vol",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      0,
    );
    v.setData(
      shown.map((b) => ({
        time: b.time,
        value: b.volume || 0,
        color:
          b.close >= b.open ? "rgba(47,211,107,0.35)" : "rgba(255,74,74,0.35)",
      })),
    );
    chart
      .priceScale("vol")
      .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart
      .priceScale("right")
      .applyOptions({ scaleMargins: { top: 0.06, bottom: 0.24 } });
  }
  let pane = 0;
  if (on.includes("RSI")) {
    pane += 1;
    const s = chart.addSeries(
      LW.LineSeries,
      {
        color: color("RSI"),
        lineWidth: 1,
        priceLineVisible: false,
        title: "RSI 14",
      },
      pane,
    );
    s.setData(pts(compute("rsi", bars, { length: 14, maLength: 0 }).value));
    for (const level of [70, 30])
      s.createPriceLine({
        price: level,
        color: "#555",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
      });
  }
  if (on.includes("MACD")) {
    pane += 1;
    const m = compute("macd", bars, { fast: 12, slow: 26, signal: 9 });
    const h = chart.addSeries(
      LW.HistogramSeries,
      { priceLineVisible: false, lastValueVisible: false },
      pane,
    );
    h.setData(
      bars
        .map((b, i) => ({
          time: b.time,
          value: m.hist[i],
          color:
            m.hist[i] >= 0 ? "rgba(47,211,107,0.55)" : "rgba(255,74,74,0.55)",
        }))
        .filter((p, i) => i >= from && Number.isFinite(p.value)),
    );
    line(m.macd, color("MACD"), pane, {
      lastValueVisible: true,
      title: "MACD",
    });
    line(m.signal, "#ffa028", pane, {
      lastValueVisible: true,
      title: "Signal",
    });
  }
  if (pane)
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
}

/**
 * Mounts the chart with its control row into `host`.
 * opts: range (start range), ranges (tabs shown; [] = none), rangeMap (own range → [bar size, bars]),
 *   type "candles" | "line", studiesKey + defaultStudies (saved choice), live (LIVE tab), fill (GP: fills the panel,
 *   otherwise `height` px), tools (extra elements in the control row), decorate(chart, series, {bars, vis, from,
 *   range, type}), onRange(range), source (set the panel's source line).
 * Returns { draw(range), repaint(), remove() }. Without `fill`, a failed load shows a hint instead of throwing.
 */
export async function ohlcChart(ctx, host, {
  symbol = ctx.sec?.id, range = "1Y", ranges = Object.keys(RANGES), rangeMap = RANGES, type = "candles",
  studiesKey = "amberStudies", defaultStudies = DEFAULT_STUDIES, live = true, fill = false, height = 320,
  tools = [], decorate = null, onRange = null, source = fill,
} = {}) {
  const top = html(`<div class="ohlc-bar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>`);
  const rangeTabs = tabs(ranges, range, (r) => draw(r));
  const kind = tabs(["CANDLES", "LINE"], type === "candles" ? "CANDLES" : "LINE", (k) => {
    type = k === "LINE" ? "line" : "candles";
    [...kind.children].forEach((b) => b.classList.toggle("on", b.textContent === k));
    paint();
  });
  const on = (await loadStudies(studiesKey, defaultStudies)).slice();
  const studyTabs = document.createElement("div");
  studyTabs.className = "tabs";
  for (const s of STUDIES) {
    const b = document.createElement("button");
    b.className = `tab${on.includes(s.id) ? " on" : ""}`;
    b.title = `Show or hide ${s.label}`;
    b.innerHTML = `<span style="color:${s.color}">■</span> ${esc(s.label)}`;
    b.onclick = () => {
      const i = on.indexOf(s.id);
      if (i >= 0) on.splice(i, 1);
      else on.push(s.id);
      b.classList.toggle("on", on.includes(s.id));
      saveStudies(studiesKey, on);
      paint();
    };
    studyTabs.append(b);
  }
  const quote = html(`<span class="dim"></span>`);
  top.append(...(ranges.length ? [rangeTabs] : []), kind, studyTabs, ...(live ? [liveTab(() => tick())] : []), quote, ...tools);
  const box = html(fill ? `<div class="chartbox"></div>` : `<div style="position:relative;height:${height}px;margin:4px 0"></div>`);
  host.append(top, box);
  // GP: the tabs can wrap onto more lines in a narrow panel, so the chart starts below them.
  const fit = () => { if (fill) box.style.top = `${top.offsetTop + top.offsetHeight + 4}px`; };
  const ro = new ResizeObserver(fit);
  ro.observe(top);
  let current, res, shown, gone = false;
  const remove = () => { if (gone) return; gone = true; ro.disconnect(); current?.remove(); current = null; };
  ctx.onCleanup(remove);
  function paint() {
    if (!res || gone) return;
    current?.remove();
    box.innerHTML = "";
    const bars = res.candles;
    if (!bars.length) { current = null; box.append(html(`<p class="hint">No price data for this range.</p>`)); return; }
    current = priceChart(box, { type });
    const from = Math.max(0, bars.length - shown);
    const vis = bars.slice(from);
    current.series.setData(type === "candles" ? vis : vis.map((b) => ({ time: b.time, value: b.close })));
    drawStudies(current.chart, bars, on, from);
    decorate?.(current.chart, current.series, { bars, vis, from, range, type });
    // Maximising the panel keeps the same dates in view instead of opening empty space on the left.
    current.chart.applyOptions({ timeScale: { lockVisibleTimeRangeOnResize: true } });
    current.chart.timeScale().fitContent();
    fit();
  }
  async function draw(r) {
    range = r;
    [...rangeTabs.children].forEach((b) => b.classList.toggle("on", b.textContent === r));
    const [tf, n] = rangeMap[r];
    let got;
    try {
      got = await api.candles(symbol, tf, n + WARMUP);
    } catch (e) {
      if (fill) throw e;
      if (!ctx.live() || gone) return;
      current?.remove();
      current = null;
      box.replaceChildren(html(`<p class="hint">Price chart not available: ${esc(e.message)}</p>`));
      return;
    }
    if (!ctx.live() || gone) return;
    got.candles = (got.candles || []).filter((b) => b.close > 0);
    res = got;
    shown = n;
    paint();
    showQuote();
    onRange?.(r);
    if (source) ctx.setSource(`${res.provider}${res.notes?.length ? `. ${res.notes.join(" ")}` : ""}`);
  }
  function showQuote(flash = "") {
    const bars = res.candles;
    const last = bars.at(-1), first = bars[Math.max(0, bars.length - shown)];
    const move = last && first ? ((last.close - first.open) / first.open) * 100 : null;
    quote.innerHTML = `${esc(res.symbol)}  last <b class="amber ${flash}">${px(last?.close)}</b>${delayTag(res)}  <span class="${cls(move)}">${pct(move)}</span> over ${range}${live && isLive() ? `  <span class="up">LIVE</span>` : ""}`;
  }
  // LIVE: every 5 seconds the latest price moves the last bar (or opens a new one on intraday ranges).
  async function tick() {
    if (!res?.candles.length) return;
    if (!isLive()) return showQuote();
    const q = Object.values(await api.quotes([symbol]))[0];
    if (!ctx.live() || gone || !res?.candles.length || !Number.isFinite(q?.price)) return;
    const bars = res.candles;
    const prev = bars.at(-1);
    const step = { "5m": 300, "15m": 900, "1h": 3600 }[rangeMap[range][0]];
    const now = Math.floor(Date.now() / 1000);
    const next =
      step && now >= prev.time + step
        ? { time: now - (now % step), open: q.price, high: q.price, low: q.price, close: q.price }
        : liveBar(prev, q.price);
    if (next === prev) return;
    res.asOf = q.asOf ?? null;
    if (next.time === prev.time) bars[bars.length - 1] = next;
    else bars.push(next);
    current?.series.update(type === "candles" ? next : { time: next.time, value: next.close });
    showQuote(tickClass(prev.close, next.close));
  }
  await draw(range);
  if (live) ctx.every(LIVE_MS, () => !gone && isLive() && tick().catch(() => {}));
  return { draw, repaint: paint, remove };
}
