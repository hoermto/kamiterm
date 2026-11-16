// /api/fn/heat?universe=SPX : market heatmap data. Per stock: group (S&P sector, country for STOXX 600),
// market weight for the tile size and the price change over 1D, 1W, 1M, 3M, YTD and 1Y from the daily
// OHLC cache (lib/ohlcv-cache.js via history()). Changes are in the stock's own currency.
// Tile size: US and DAX = Yahoo market cap (one request per 50 stocks, kept a day in data/heat-caps.json);
// STOXX 600 = the iShares index weight from the roster (free-float, no extra request).
import { getJson, YAHOO_UA as UA } from "../providers.js";
import { yahooSession, resetYahooSession } from "./des.js";
import { SECTORS, UNIVERSES, EU_UNIVERSES } from "./grokki-universes.js";
import { history, batch } from "./grokki-data.js";
import { repairBars } from "../../scripts/lib/research-universes.mjs";
import * as store from "../store.js";

export const HEAT_UNIVERSES = {
  SPX: "S&P 500",
  NDX: "Nasdaq-100",
  DAX: "DAX 40",
  SXXP: "STOXX Europe 600",
};
const ALIASES = { SP500: "SPX", NASDAQ: "NDX", NDX100: "NDX", DAX40: "DAX", STOXX: "SXXP", STOXX600: "SXXP", EUROSTOXX600: "SXXP" };
export const PERIOD_BARS = { "1D": 1, "1W": 5, "1M": 21, "3M": 63, "1Y": 252 };
const CAP_FILE = "heat-caps";
const CAP_TTL = 24 * 3600e3;
const CAP_WAIT = 20e3;
const bad = (m) => Object.assign(new Error(m), { status: 400 });

// Yahoo pads some European short names to a fixed width with a stray letter at the end ("SAP SE      I").
export const cleanName = (s) => String(s || "").replace(/\s{2,}.*$/, "").trim();

const sectorOf = new Map(Object.entries(SECTORS).flatMap(([k, s]) => s.stocks.map((t) => [t, k])));

export function heatUniverse(raw) {
  const k = String(raw || "SPX").toUpperCase();
  const key = ALIASES[k] || k;
  if (!HEAT_UNIVERSES[key]) throw bad(`Universe is one of ${Object.keys(HEAT_UNIVERSES).join(", ")}`);
  return key;
}

/** Stocks of a universe: [{t, group, weight?, name?}]; groups = [{key, name}] in display order. */
export function members(key) {
  if (key === "SXXP") {
    const ms = EU_UNIVERSES.SXXP.members;
    const groups = [...new Set(ms.map((m) => m.country || "Other"))].map((c) => ({ key: c, name: c }));
    return { stocks: ms.map((m) => ({ t: m.t, group: m.country || "Other", weight: m.w, name: m.name })), groups };
  }
  if (key === "DAX") return { stocks: UNIVERSES.DAX.map((t) => ({ t, group: "DAX" })), groups: [{ key: "DAX", name: "DAX 40" }] };
  const sectors = Object.entries(SECTORS).map(([k, s]) => ({ key: k, name: s.name }));
  if (key === "SPX") return { stocks: UNIVERSES.SPX.map((t) => ({ t, group: sectorOf.get(t) })), groups: sectors };
  // Nasdaq-100: S&P sector where the stock is in the S&P 500, else "Other" (ASML, ARM, PDD, ...).
  const stocks = UNIVERSES.NDX.map((t) => ({ t, group: sectorOf.get(t) || "OTHER" }));
  return { stocks, groups: [...sectors, { key: "OTHER", name: "Not in the S&P 500" }] };
}

/** Price changes in % from daily bars (oldest first). YTD against the last close of the previous year. */
export function changes(bars) {
  const n = bars.length;
  if (!n) return {};
  const last = bars[n - 1].close;
  const out = {};
  for (const [p, k] of Object.entries(PERIOD_BARS)) out[p] = n > k && bars[n - 1 - k].close > 0 ? (last / bars[n - 1 - k].close - 1) * 100 : null;
  const year = new Date(bars[n - 1].time * 1000).getUTCFullYear();
  const prev = bars.findLast((b) => new Date(b.time * 1000).getUTCFullYear() < year);
  out.YTD = prev?.close > 0 ? (last / prev.close - 1) * 100 : null;
  return out;
}

/** Yahoo market caps (and short names) for the symbols, from data/heat-caps.json when under a day old. */
async function marketCaps(symbols, now = Date.now()) {
  const saved = store.read(CAP_FILE, { caps: {} });
  const caps = saved.caps || {};
  const stale = symbols.filter((t) => !(caps[t] && now - caps[t].at < CAP_TTL));
  for (let i = 0; i < stale.length; i += 50) {
    const part = stale.slice(i, i + 50);
    try {
      const s = await yahooSession();
      const j = await getJson(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(part.join(","))}&fields=marketCap,shortName,currency&crumb=${encodeURIComponent(s.crumb)}`,
        { ...UA, Cookie: s.cookie },
      );
      for (const q of j?.quoteResponse?.result || [])
        if (q.marketCap > 0) caps[q.symbol] = { cap: q.marketCap, name: cleanName(q.shortName || q.longName), cur: q.currency || "", at: now };
    } catch (e) {
      if (e.status === 401) resetYahooSession();
      // keep the older caps (or none: those tiles get the median size)
    }
  }
  if (stale.length) store.write(CAP_FILE, { updatedAt: new Date(now).toISOString(), caps });
  return caps;
}

export default async function (q = {}) {
  const key = heatUniverse(q.universe);
  const { stocks, groups } = members(key);
  // Market caps may take a while on a cold start (a Yahoo request per 50 stocks): after CAP_WAIT the map uses
  // the caps saved so far (missing ones get the median size); the fetch finishes in the background for next time.
  const caps = key === "SXXP" ? {} : await Promise.race([
    marketCaps(stocks.map((s) => s.t)),
    new Promise((r) => setTimeout(() => r(store.read(CAP_FILE, { caps: {} }).caps || {}), CAP_WAIT).unref?.()),
  ]);
  const eu = key === "SXXP" || key === "DAX";
  const scan = await batch(stocks.map((s) => s.t), async (t) => {
    let h = await history(t, 2);
    if (eu) h = { ...h, bars: repairBars(h).series?.bars || h.bars };
    return { t, bars: h.bars };
  }, 120000, 8);
  const byT = new Map(scan.results.map((r) => [r.t, r.bars]));
  const rows = [];
  for (const s of stocks) {
    const bars = byT.get(s.t);
    if (!bars) continue;
    const c = caps[s.t];
    rows.push({
      t: s.t,
      name: c?.name || s.name || "",
      group: s.group,
      weight: s.weight ?? c?.cap ?? null,
      price: bars.at(-1).close,
      asOf: new Date(bars.at(-1).time * 1000).toISOString().slice(0, 10),
      chg: changes(bars),
    });
  }
  // Tiles without a weight get the median, so they stay visible.
  const ws = rows.map((r) => r.weight).filter((w) => w > 0).sort((a, b) => a - b);
  const med = ws.length ? ws[Math.floor(ws.length / 2)] : 1;
  let sized = 0;
  for (const r of rows) if (r.weight > 0) sized++; else r.weight = med;
  const used = new Set(rows.map((r) => r.group));
  return {
    universe: key,
    label: HEAT_UNIVERSES[key],
    universes: HEAT_UNIVERSES,
    groups: groups.filter((g) => used.has(g.key)),
    groupBy: key === "SXXP" ? "country" : key === "DAX" ? null : "sector",
    sizeBy: key === "SXXP" ? "index weight" : "market cap",
    periods: [...Object.keys(PERIOD_BARS).slice(0, 4), "YTD", "1Y"],
    rows,
    asOf: rows.map((r) => r.asOf).sort().at(-1) || null,
    coverage: { stocks: stocks.length, loaded: rows.length, sized, partial: scan.partial },
    errors: scan.errors.slice(0, 20),
    source: `Daily prices: Yahoo via the OHLC cache (data/cache/ohlcv.sqlite), up to 15 minutes behind. Tile size: ${key === "SXXP" ? "iShares STOXX Europe 600 weights (Nov 2026)" : "Yahoo market cap, refreshed daily"}. Changes in each stock's own currency.`,
  };
}
