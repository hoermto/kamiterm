// /api/fn/dmov?symbol=KO&period=2Y : how a stock moved around its past ex-dividend dates. Run-up before,
// the drop on the ex-day against the dividend, the moves 1 to 3 weeks after, and how long the price took
// to get back. US and European stocks (Yahoo tickers such as SAP.DE).
// Dividends: Yahoo's dividend events (split-adjusted, like the prices), kept in the event cache and
// refreshed weekly; for US stocks also Nasdaq's list, for an announced next ex-date. Prices: the daily
// price cache. The maths: lib/event-moves.js.
// Buy-write over the ex-date (entry=1..10 trading days before, call on the first expiry dtemin..dtemax days
// after the entry): the stock side from history for every stock; for US stocks also today's call on the next
// ex-date from the CBOE chain (lib/buywrite.js), applied to the past events.
import { getJson, YAHOO_UA, NQ, resolve } from "../providers.js";
import { parseYahoo, parseNasdaq } from "./dvd.js";
import { history, intParam } from "./grokki-data.js";
import { loadBuyWrite } from "../buywrite.js";
import * as cache from "../events-cache.js";
import {
  exDivEvents, summarizeExDiv, periodStart, nextExDate,
  buyWriteEvents, summarizeBuyWrite, simulateBuyWrite,
  PERIODS, DEFAULT_PERIOD, HORIZONS, PRE_DAYS, RECOVER_MAX, BW_DEFAULTS,
} from "../event-moves.js";

const DAY = 86400e3;
const MONTHLY_MAX_DTE = 45; // buy-write expiry for stocks without weeklies, days after the entry
const YEARS_LOADED = 10; // prices and dividends for ALL; the periods filter within them
const bad = (m) => Object.assign(new Error(m), { status: 400 });

/** The Yahoo ticker of a stock, or null for indices, currencies, crypto and spreads. */
export function stockTicker(sym) {
  if (sym.exchange === "US") return sym.ticker;
  if (sym.exchange === "YAHOO" && !/[\^=]/.test(sym.ticker)) return sym.ticker;
  return null;
}

/** Dividends from the event cache, asking the source when the cached copy is older than maxAgeMs. */
function cachedDividends(ticker, source, maxAgeMs, fetchRows) {
  return cache.refresh({
    source: `div-${source}`,
    symbol: ticker,
    maxAgeMs,
    read: () => cache.readDividends(ticker, source),
    write: (rows) => cache.replaceDividends(ticker, source, rows),
    fetch: fetchRows,
  });
}

/**
 * Yahoo's dividend history of a stock via the event cache (refreshed weekly). Also used by DSCAN.
 * Weekly bars over 15 years: the complete dividend list in about 90 KB. range=max leaves out most
 * dividends of the last decades, and monthly bars merge two payments in one month.
 */
export function yahooDividends(t) {
  return cachedDividends(t, "yahoo", 7 * DAY, async () => {
    const j = await getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1wk&range=15y&events=div`,
      YAHOO_UA,
    );
    const rows = parseYahoo(j);
    if (!rows) throw new Error(`Yahoo has no data for ${t}`);
    return rows;
  });
}

/** The buy-write section: history (stock side) for every stock, today's call for US stocks. */
async function buyWrite(t, sym, divs, bars, next, today, opts, inPeriod) {
  const history = (o) => {
    const events = inPeriod(buyWriteEvents(divs, bars, o));
    return { events, summary: summarizeBuyWrite(events) };
  };
  const out = { ...opts, ...history(opts), quote: null, sim: null, monthlyMaxDte: MONTHLY_MAX_DTE };
  if (sym.exchange !== "US") return { ...out, note: "Option quotes are only available for US stocks." };
  if (!next) return { ...out, note: "No upcoming ex-date." };
  try {
    // Stocks with monthly options only: the first expiry after the ex-date up to MONTHLY_MAX_DTE days.
    out.quote = await loadBuyWrite(t, { exDate: next.date, dividend: next.amount, today, ...opts, fallbackMaxDte: MONTHLY_MAX_DTE });
  } catch (e) {
    return { ...out, note: `Option chain: ${e.message}` };
  }
  if (!out.quote) return { ...out, note: "No US options for this stock." };
  const qt = out.quote;
  // A monthly expiry: the past events are held for the same number of days instead of to a weekly Friday.
  if (qt.fallback && qt.dte) Object.assign(out, history({ ...opts, fixedDte: qt.dte }));
  if (qt.premiumPct != null && qt.strikePct != null)
    out.sim = simulateBuyWrite(out.events, { strikePct: qt.strikePct, premiumPct: qt.premiumPct, dividendPct: qt.dividendPct, dte: qt.dte });
  return out;
}

export default async function (q) {
  const period = String(q.period || DEFAULT_PERIOD).toUpperCase();
  if (!(period in PERIODS)) throw bad(`Period is one of ${Object.keys(PERIODS).join(", ")}`);
  const bwOpts = {
    entryDays: intParam(q.entry, BW_DEFAULTS.entryDays, 1, 10),
    dteMin: intParam(q.dtemin, BW_DEFAULTS.dteMin, 0, 30),
    dteMax: intParam(q.dtemax, BW_DEFAULTS.dteMax, 1, 45),
  };
  if (bwOpts.dteMin > bwOpts.dteMax) throw bad("dtemin must not be above dtemax");
  const sym = await resolve(q.symbol);
  const t = stockTicker(sym);
  if (!t) throw bad("DMOV covers stocks: US tickers like KO, or Yahoo tickers like SAP.DE.");
  const today = new Date().toISOString().slice(0, 10);

  const yahoo = await yahooDividends(t);
  // Nasdaq lists announced ex-dates before Yahoo does (US stocks); only its future dates are used,
  // because its past amounts are not split-adjusted.
  const nasdaq = sym.exchange === "US"
    ? await cachedDividends(t, "nasdaq", DAY, async () => parseNasdaq(
        await getJson(`https://api.nasdaq.com/api/quote/${encodeURIComponent(t)}/dividends?assetclass=stocks`, NQ),
      ) || []).catch(() => null)
    : null;

  const divs = yahoo.rows;
  const announced = (nasdaq?.rows || []).filter((d) => d.exDate > today);
  const next = nextExDate([...divs, ...announced], today);
  if (next && !next.estimated) {
    try {
      cache.upsertUpcoming("exdiv", announced.some((d) => d.exDate === next.date) ? "nasdaq" : "yahoo", [{ symbol: t, date: next.date, amount: next.amount }]);
    } catch { /* the cache is optional */ }
  }
  const currency = divs[0]?.currency || null;
  const base = {
    symbol: t,
    currency,
    period,
    periods: Object.keys(PERIODS),
    horizons: HORIZONS,
    preDays: PRE_DAYS,
    recoverMax: RECOVER_MAX,
    next,
    cache: { fromCache: yahoo.fromCache, stale: yahoo.stale, fetchedAt: yahoo.fetchedAt },
    source: `Yahoo dividend events and daily prices (split-adjusted)${nasdaq ? ", announced ex-dates from Nasdaq" : ""}. Moves from the close of the last day before the ex-date; weeks = 5 trading days.${yahoo.stale ? " Dividends from the cache: the source did not answer." : ""}`,
  };
  if (!divs.length) return { ...base, since: null, lastClose: null, summary: null, events: [], note: "No dividends on record." };

  const h = await history(t, YEARS_LOADED + 1);
  const events = exDivEvents(divs, h.bars);
  const since = periodStart(period, today);
  const inPeriod = (list) => (since ? list.filter((e) => e.exDate >= since) : list);
  return {
    ...base,
    since,
    lastClose: h.bars.at(-1).close,
    asOf: h.asOf,
    summary: summarizeExDiv(events, { since }),
    events: inPeriod(events),
    buyWrite: await buyWrite(t, sym, divs, h.bars, next, today, bwOpts, inPeriod),
  };
}
