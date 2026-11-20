// /api/fn/fvscan?universe=SPX&basis=EPS&pe=15 : the FV numbers for every stock of a universe (the FVSCAN screen).
// Universes: SPX, NDX, DAX (40), SXXP (STOXX Europe 600) and the watchlists (W = the active one, W:TECH).
// The screen filters and sorts the rows itself (presets like "below normal P/E" or "dividend champions").
// A cold scan downloads annual figures for hundreds of stocks (SEC: one file per company, Yahoo for Europe):
// what is not done within the time budget keeps loading in the background, so the next run has it.
import { quotes, loadChart, loadFundamentals } from "../fundamentals.js";
import { prepare, fvParams } from "./fv.js";
import { UNIVERSES, EU_UNIVERSES } from "./grokki-universes.js";
import { batch } from "./grokki-data.js";
import * as store from "../store.js";
import { register as liveRegister } from "../ohlc-live.js";
import { toSecurity, yahooSymbol } from "../../public/js/securities.js";

const bad = (m) => Object.assign(new Error(m), { status: 400 });
export const FV_UNIVERSES = { SPX: "S&P 500", NDX: "Nasdaq-100", DAX: "DAX 40", SXXP: "STOXX Europe 600" };
const ALIASES = { SP500: "SPX", NASDAQ: "NDX", DAX40: "DAX", STOXX: "SXXP", STOXX600: "SXXP", EUROSTOXX600: "SXXP" };
const BUDGET = 100e3;

/** Watchlist entries (AAPL US EQUITY, SAP GR EQUITY, ...) -> Yahoo tickers of the shares in it. */
export function watchTickers(items) {
  const out = [];
  for (const raw of items || []) {
    const sec = toSecurity(String(raw).trim().split(/\s+/));
    if (sec?.sector !== "EQUITY") continue;
    const y = yahooSymbol(sec);
    if (y && !/[\^=:]/.test(y)) out.push(y.replace(/\//g, "-"));
  }
  return [...new Set(out)];
}

/** universe -> {key, label, tickers} */
export function fvUniverse(raw) {
  const k = String(raw || "SPX").toUpperCase();
  if (k === "W" || k.startsWith("W:")) {
    const w = store.read("state", {})?.amberWatch || {};
    const lists = w.lists || {};
    const name = k === "W" ? w.active || Object.keys(lists)[0] : k.slice(2);
    if (!lists[name]) throw bad(`No watchlist ${name}. Lists: ${Object.keys(lists).join(", ") || "none"}`);
    return { key: `W:${name}`, label: `Watchlist ${name}`, tickers: watchTickers(lists[name]), lists: Object.keys(lists) };
  }
  const key = ALIASES[k] || k;
  if (!FV_UNIVERSES[key]) throw bad(`Universe is one of ${Object.keys(FV_UNIVERSES).join(", ")}, W or W:<list>`);
  const tickers = key === "SXXP" ? EU_UNIVERSES.SXXP.members.map((m) => m.t) : UNIVERSES[key];
  return { key, label: FV_UNIVERSES[key], tickers, lists: Object.keys(store.read("state", {})?.amberWatch?.lists || {}) };
}

// Background loading of what a scan did not get to (one queue, three at a time).
const queue = new Set();
let running = 0;
function warm(tickers) {
  for (const t of tickers) queue.add(t);
  while (running < 3 && queue.size) {
    const t = queue.values().next().value;
    queue.delete(t);
    running++;
    loadChart(t)
      .then((c) => loadFundamentals(t, c.splits))
      .catch(() => {})
      .finally(() => {
        running--;
        warm([]);
      });
  }
}
export const warming = () => queue.size + running;

/** The compact row FVSCAN shows. */
export function scanRow(p) {
  const a = p.a;
  const q = a.quality;
  return {
    t: p.t,
    name: p.name,
    currency: p.currency,
    price: p.price,
    source: p.source,
    financial: p.financial,
    oneOff: a.oneOff,
    pe: a.currentPe,
    fairValue: a.fairValue,
    vsFairPct: a.vsFairPct,
    normalPe: a.normalPe,
    normalValue: a.normalValue,
    vsNormalPct: a.vsNormalPct,
    value: a.value.level,
    growth: a.growth.g,
    growthSource: a.growth.source,
    peg: a.peg,
    expectedReturn: a.expectedReturn,
    expectedReturnAtFair: a.expectedReturnAtFair,
    expectedReturnAnalysts: a.expectedReturnAnalysts,
    // the lower of the two growth assumptions (own history, analysts): what FVSCAN ranks by
    // (none for erratic earnings: two or more loss years in ten make the P/E maths meaningless)
    expectedReturnLow: a.erratic ? null : [a.expectedReturn, a.expectedReturnAnalysts].filter(Number.isFinite).reduce((m, v) => Math.min(m, v), Infinity),
    erratic: a.erratic,
    exitPe: a.exitPe,
    shortHistory: a.shortHistory,
    yieldPct: a.dividend.yieldPct,
    raisedYears: a.dividend.raisedYears,
    paidYears: a.dividend.paidYears,
    divGrowth5: a.dividend.growth5,
    payoutPct: q.payoutPct,
    fcfPayoutPct: q.fcfPayoutPct,
    category: a.dividend.category,
    yieldTheoryVsPct: a.yieldTheory?.vsPct ?? null,
    roe: q.roePct,
    roic: q.roicPct,
    margin: q.netMarginPct,
    debtToCapital: q.debtToCapitalPct,
    fcfDivCover5: q.fcfDivCover5,
    piotroski: q.piotroski?.score ?? null,
    altman: a.altman?.z ?? null,
    rsl: a.rsl,
    cheapMomentum: a.cheapMomentum,
    rating: p.rating,
    years: a.years,
    lastYear: a.lastYear,
  };
}

// Finished scans are kept 15 minutes per universe, basis and P/E (going back from FV is then instant);
// a scan that is still loading stocks in the background is not kept. fresh=1 scans again.
const RESULT_TTL = 15 * 60e3;
const results = new Map();

export default async function (q = {}) {
  const u = fvUniverse(q.universe);
  const { basis, pe } = fvParams(q);
  const key = `${u.key}|${basis}|${pe}|${u.tickers.join(",")}`;
  const hit = results.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL && !/^(1|true)$/i.test(String(q.fresh ?? ""))) return { ...hit.out, cachedAt: hit.at };
  const out = await scanUniverse(u, basis, pe);
  if (!out.coverage.loading && !out.coverage.partial) results.set(key, { at: Date.now(), out });
  else results.delete(key);
  return out;
}

async function scanUniverse(u, basis, pe) {
  if (!u.tickers.length) return { universe: u.key, label: u.label, lists: u.lists, basis, pe, rows: [], coverage: { stocks: 0, loaded: 0 }, errors: [] };
  const qs = await quotes(u.tickers);
  const today = new Date().toISOString().slice(0, 10);
  const scan = await batch(u.tickers, async (t) => scanRow(await prepare(t, { basis, pe, quote: qs[t] ?? null, today })), BUDGET, 6);
  const missing = scan.errors.filter((e) => /budget|deadline/i.test(e.error)).map((e) => e.ticker);
  if (missing.length) warm(missing);
  for (const r of scan.results) if (!Number.isFinite(r.expectedReturnLow ?? NaN)) r.expectedReturnLow = null;
  const rows = scan.results.sort((a, b) => (b.expectedReturnLow ?? -1e9) - (a.expectedReturnLow ?? -1e9));
  return {
    live: { key: `fvscan:${u.key}`, version: liveRegister(`fvscan:${u.key}`, u.tickers) },
    universe: u.key,
    label: u.label,
    universes: FV_UNIVERSES,
    lists: u.lists,
    basis,
    pe,
    rows,
    coverage: { stocks: u.tickers.length, loaded: rows.length, loading: warming(), partial: scan.partial },
    errors: scan.errors.filter((e) => !/budget|deadline/i.test(e.error)).slice(0, 30),
    source:
      "Annual figures: SEC company facts (US, 10-K) or Yahoo (others, about 4 years), kept two weeks in data/cache/fundamentals. " +
      "Prices, dividends, splits, TTM and forward EPS: Yahoo. RSL26: OHLC cache.",
  };
}
