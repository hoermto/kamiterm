// /api/fn/dscan?universe=SPX&days=14 : buy-write candidates over the coming ex-dividend dates (US stocks).
// 1. Ex-dates in the next `days` days from Nasdaq's dividend calendar (one request per day, cached).
// 2. Stocks of the universe (SPX, NDX, or ALL: every plain US ticker in the calendar).
// 3. Per stock the CBOE chain (lib/buywrite.js): weekly options, an expiry dtemin..dtemax days after the
//    entry (weekly=0 also takes stocks with monthly options only: the first expiry after the ex-date up to
//    mdte days after the entry), the first call above the price, its premium; liquid=1 adds filters for
//    open interest and spread (off by default; both are shown either way).
// 4. The stock's past ex-dates (as in DMOV) with today's terms: return per trade, win rate, called away.
// Each row gets a verdict (promising / mixed / not promising / too little history, see verdict() in
// lib/event-moves.js); ranked by verdict, then by the average return per trade. Entry = `entry` trading days before the ex-date (default 2).
import { getJson, NQ } from "../providers.js";
import { universe } from "./grokki-universes.js";
import { history, batch, intParam } from "./grokki-data.js";
import { register as liveRegister } from "../ohlc-live.js";
import { yahooDividends } from "./dmov.js";
import { loadBuyWrite } from "../buywrite.js";
import * as cache from "../events-cache.js";
import { buyWriteEvents, simulateBuyWrite, verdict, periodStart, PERIODS, BW_DEFAULTS } from "../event-moves.js";

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const DAY = 86400e3;
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const mdyToIso = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || "").trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
// Common stock tickers only: preferreds, notes and units have longer or suffixed symbols.
const PLAIN = /^[A-Z]{1,5}(\.[AB])?$/;
const NOT_COMMON = /preferred|depositary|notes due|% notes|debentures|warrant|units?\b|trust preferred|perpetual/i;

/** Nasdaq dividend calendar rows of one day -> [{symbol, name, exDate, amount, payDate, announced}]. */
export function parseCalendar(j) {
  return (j?.data?.calendar?.rows || [])
    .map((r) => ({
      symbol: String(r.symbol || "").trim().toUpperCase(),
      name: r.companyName || "",
      exDate: mdyToIso(r.dividend_Ex_Date),
      amount: Number(r.dividend_Rate),
      payDate: mdyToIso(r.payment_Date),
      announced: mdyToIso(r.announcement_Date),
    }))
    .filter((r) => r.symbol && r.exDate && Number.isFinite(r.amount) && r.amount > 0);
}

/** Ex-dates from tomorrow to today + days (weekdays), from the event cache or Nasdaq (cached 12 hours per day). */
async function upcomingExDates(today, days) {
  const out = [];
  for (let t = Date.parse(`${today}T00:00:00Z`) + DAY; t <= Date.parse(`${today}T00:00:00Z`) + days * DAY; t += DAY) {
    const d = isoDay(t);
    const wd = new Date(t).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const r = await cache.refresh({
      source: "nasdaq-divcal",
      symbol: d,
      maxAgeMs: 12 * 3600e3,
      // DMOV re-saves a stock's announced date as "nasdaq" (same row): count it too, only Yahoo estimates are out.
      read: () => cache.readUpcoming("exdiv", d, d).filter((x) => x.source.startsWith("nasdaq")).map((x) => ({ symbol: x.symbol, exDate: x.date, amount: x.amount, name: "" })),
      write: (rows) => cache.upsertUpcoming("exdiv", "nasdaq-divcal", rows.map((x) => ({ symbol: x.symbol, date: x.exDate, amount: x.amount }))),
      fetch: async () => parseCalendar(await getJson(`https://api.nasdaq.com/api/calendar/dividends?date=${d}`, NQ)),
    }).catch(() => ({ rows: [] }));
    out.push(...r.rows);
  }
  return out;
}

export default async function (q = {}) {
  const uni = String(q.universe || "SPX").toUpperCase();
  const all = uni === "ALL";
  const u = all ? { key: "ALL", label: "All US stocks in the dividend calendar", tickers: null } : universe({ universe: uni }, ["SPX", "NDX"]);
  const days = intParam(q.days, 14, 1, 30);
  const opts = {
    entryDays: intParam(q.entry, BW_DEFAULTS.entryDays, 1, 10),
    dteMin: intParam(q.dtemin, BW_DEFAULTS.dteMin, 0, 30),
    dteMax: intParam(q.dtemax, BW_DEFAULTS.dteMax, 1, 45),
  };
  if (opts.dteMin > opts.dteMax) throw bad("dtemin must not be above dtemax");
  const minOi = intParam(q.minoi, 50, 0, 100000);
  const maxSpread = intParam(q.maxspread, 30, 1, 200);
  const liquidOnly = String(q.liquid ?? "0") === "1";
  const weeklyOnly = String(q.weekly ?? "1") !== "0";
  const monthlyMaxDte = intParam(q.mdte, 45, 5, 90);
  const period = String(q.period || "5Y").toUpperCase();
  if (!(period in PERIODS)) throw bad(`Period is one of ${Object.keys(PERIODS).join(", ")}`);
  const today = isoDay(Date.now());
  const since = periodStart(period, today);

  // 1-2. Candidates: one row per symbol (the nearest ex-date), plain common stocks, in the universe.
  const members = all ? null : new Set(u.tickers.map((t) => t.replace("-", ".")));
  const bySymbol = new Map();
  for (const r of await upcomingExDates(today, days)) {
    if (!PLAIN.test(r.symbol) || NOT_COMMON.test(r.name || "")) continue;
    if (members && !members.has(r.symbol)) continue;
    const prev = bySymbol.get(r.symbol);
    if (!prev || r.exDate < prev.exDate) bySymbol.set(r.symbol, r);
  }
  const candidates = [...bySymbol.values()].sort((a, b) => a.exDate.localeCompare(b.exDate));

  // 3-4. Chains first (cheap filter), history only for the ones that pass.
  const skipped = { noOptions: 0, tooLate: 0, noWeekly: 0, noExpiry: 0, noPremium: 0, illiquid: 0, error: 0 };
  const scan = await batch(candidates.map((c) => c.symbol), async (t) => {
    const c = bySymbol.get(t);
    const bw = await loadBuyWrite(t, { exDate: c.exDate, dividend: c.amount, today, ...opts, fallbackMaxDte: weeklyOnly ? null : monthlyMaxDte }).catch((e) => ({ error: e.message, status: e.status }));
    if (!bw || bw.status === 404) { skipped.noOptions++; return null; }
    if (bw.error) { skipped.error++; return null; }
    if (bw.tooLate) { skipped.tooLate++; return null; }
    if (weeklyOnly && !bw.weekly) { skipped.noWeekly++; return null; }
    if (!bw.expiry) { skipped.noExpiry++; return null; }
    if (bw.premiumPct == null) { skipped.noPremium++; return null; }
    if (liquidOnly && ((bw.call.oi ?? 0) < minOi || !(bw.call.spreadPct <= maxSpread))) { skipped.illiquid++; return null; }
    const [divs, h] = await Promise.all([yahooDividends(t), history(t, 6)]);
    // A monthly expiry today has no weekly counterpart in the past: hold the same number of days instead.
    let events = buyWriteEvents(divs.rows, h.bars, bw.fallback ? { ...opts, fixedDte: bw.dte } : opts);
    if (since) events = events.filter((e) => e.exDate >= since);
    const sim = simulateBuyWrite(events, { strikePct: bw.strikePct, premiumPct: bw.premiumPct, dividendPct: bw.dividendPct, dte: bw.dte });
    const v = verdict(sim.rows.map((r) => r.retPct), { basis: "buy-write at today's terms" });
    return {
      symbol: t,
      name: c.name,
      exDate: c.exDate,
      dividend: c.amount,
      price: bw.price,
      dividendPct: bw.dividendPct,
      entryDate: bw.entryDate,
      expiry: bw.expiry,
      dte: bw.dte,
      weekly: bw.weekly,
      monthly: bw.fallback,
      strike: bw.call.strike,
      strikePct: bw.strikePct,
      bid: bw.call.bid,
      ask: bw.call.ask,
      premium: bw.premium,
      premiumPct: bw.premiumPct,
      premiumEstimated: bw.premiumEstimated,
      oi: bw.call.oi,
      spreadPct: bw.call.spreadPct,
      earlyRisk: !!bw.early?.risk,
      n: sim.n,
      avgPct: sim.ret.avg,
      medianPct: sim.ret.median,
      worstPct: sim.ret.min,
      winPct: sim.winPct,
      assignedPct: sim.assignedPct,
      perYearPct: sim.perYearPct,
      verdict: v.level,
      verdictLabel: v.label,
      verdictReason: v.reason,
      // what the trade gives if the stock just stays: premium + dividend
      flatPct: bw.premiumPct + (bw.dividendPct || 0),
    };
  }, 120000, 4);
  // Promising first, then mixed, too little history, not promising; within each by average per trade.
  const rank = { good: 0, mixed: 1, na: 2, poor: 3 };
  const rows = scan.results.filter(Boolean).sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.avgPct ?? -1e9) - (a.avgPct ?? -1e9));
  const liveKey = `dscan:${u.key}:${days}`;
  return {
    live: { key: liveKey, version: liveRegister(liveKey, candidates.map((c) => c.symbol)) },
    universe: u.key,
    universeLabel: u.label,
    days,
    ...opts,
    minOi,
    maxSpread,
    liquidOnly,
    weeklyOnly,
    monthlyMaxDte,
    period,
    since,
    rows,
    coverage: { exDates: candidates.length, checked: scan.loaded, listed: rows.length, skipped, partial: scan.partial },
    errors: scan.errors.slice(0, 20),
    source: "Ex-dates: Nasdaq dividend calendar. Calls: CBOE delayed quotes (about 15 minutes behind); premium for a later entry day estimated from today's implied volatility. History: Yahoo dividends and daily prices.",
  };
}
