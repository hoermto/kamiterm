// How a stock's price moved around company events, from daily bars. Pure functions, no network: the
// numbers DMOV (ex-dividend) shows, and later EMOV (earnings).
//
// Ex-dividend, per event (bars are split-adjusted, not dividend-adjusted, like Yahoo's dividend amounts):
//   cum day   = the last trading day before the ex-date (the price still includes the dividend)
//   run-up    = cum close vs. the close PRE trading days earlier
//   gap       = ex-day open vs. cum close;  ex-day = ex-day close vs. cum close
//   drop/div  = (cum close - ex-day close) / dividend: 1 = fell by exactly the dividend
//   after k   = close k trading days after the cum day vs. cum close (k = 5, 10, 15: about 1, 2, 3 weeks);
//               "total" adds the dividend (what a holder over the ex-date got)
//   recovery  = trading days after the ex-day until a close is back at the cum close (0 = on the ex-day);
//               looked for up to RECOVER_MAX days and only until the next ex-date.
import { iso } from "./fn/grokki-math.js";

export const PRE_DAYS = 5;
export const HORIZONS = [5, 10, 15];
export const RECOVER_MAX = 60;
export const PERIODS = { "1Y": 1, "2Y": 2, "3Y": 3, "5Y": 5, ALL: null };
export const DEFAULT_PERIOD = "2Y";

const pct = (a, b) => (a / b - 1) * 100;
const dayMs = 86400e3;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

/** First index whose date is on or after d (dates sorted ascending), or dates.length. */
export function firstOnOrAfter(dates, d) {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < d) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Per-event moves around each ex-date, newest first. divs: [{exDate, amount}], bars ascending by time. */
export function exDivEvents(divs, bars, { pre = PRE_DAYS, horizons = HORIZONS, recoverMax = RECOVER_MAX } = {}) {
  const dates = bars.map((b) => iso(b.time));
  const list = (divs || [])
    .filter((d) => isDate(d.exDate) && Number.isFinite(d.amount) && d.amount > 0)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const dv = list[i];
    const e = firstOnOrAfter(dates, dv.exDate);
    if (e < 1 || e >= bars.length) continue;
    // A gap in the price data around the ex-date would compare the wrong days.
    if ((Date.parse(dates[e]) - Date.parse(dv.exDate)) / dayMs > 4) continue;
    const c = e - 1;
    const cum = bars[c].close;
    const exBar = bars[e];
    const nextEx = list[i + 1]?.exDate || null;
    const ev = {
      exDate: dv.exDate,
      exDay: dates[e],
      amount: dv.amount,
      cumDate: dates[c],
      cumClose: cum,
      yieldPct: (dv.amount / cum) * 100,
      runUpPct: c - pre >= 0 ? pct(cum, bars[c - pre].close) : null,
      gapPct: pct(exBar.open, cum),
      exDayPct: pct(exBar.close, cum),
      exDayAmt: exBar.close - cum,
      dropVsDiv: (cum - exBar.close) / dv.amount,
      after: {},
    };
    for (const k of horizons) {
      const j = c + k;
      ev.after[k] = j < bars.length
        ? { date: dates[j], pricePct: pct(bars[j].close, cum), totalPct: pct(bars[j].close + dv.amount, cum), amt: bars[j].close - cum }
        : null;
    }
    let rec = null;
    let end = "window"; // why the search stopped without a recovery: window | nextEx | data
    for (let j = e; ; j++) {
      if (j - e >= recoverMax) { end = "window"; break; }
      if (nextEx && dates[j] >= nextEx) { end = "nextEx"; break; }
      if (j >= bars.length) { end = "data"; break; }
      if (bars[j].close >= cum) { rec = j - e; break; }
    }
    ev.recoveryDays = rec;
    ev.recoveryOpen = rec == null && end === "data"; // still running: the data ends before the search does
    out.push(ev);
  }
  return out.reverse();
}

/** n, average, median, min, max, standard deviation and share above zero (%) of the finite values. */
export function stats(values) {
  const v = (values || []).filter(Number.isFinite);
  const n = v.length;
  if (!n) return { n: 0, avg: null, median: null, min: null, max: null, sd: null, upPct: null };
  const s = [...v].sort((a, b) => a - b);
  const avg = v.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - avg) ** 2, 0) / (n - 1)) : null;
  return { n, avg, median, min: s[0], max: s[n - 1], sd, upPct: (v.filter((x) => x > 0).length / n) * 100 };
}

/** The first date of a period ending today ("2Y" = two years back), or null for ALL. */
export function periodStart(period, today) {
  const years = PERIODS[period];
  if (years == null) return null;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Statistics over the events on or after `since` (all when since is null). */
export function summarizeExDiv(events, { since = null, horizons = HORIZONS } = {}) {
  const ev = since ? events.filter((e) => e.exDate >= since) : events;
  const col = (f) => stats(ev.map(f));
  const after = {};
  for (const k of horizons) {
    after[k] = {
      price: col((e) => e.after[k]?.pricePct),
      total: col((e) => e.after[k]?.totalPct),
      amt: col((e) => e.after[k]?.amt),
    };
  }
  const closed = ev.filter((e) => !e.recoveryOpen);
  const recovered = closed.filter((e) => e.recoveryDays != null);
  return {
    n: ev.length,
    from: ev.at(-1)?.exDate || null,
    to: ev[0]?.exDate || null,
    yieldPct: col((e) => e.yieldPct),
    runUp: col((e) => e.runUpPct),
    gap: col((e) => e.gapPct),
    exDay: col((e) => e.exDayPct),
    exDayAmt: col((e) => e.exDayAmt),
    dropVsDiv: col((e) => e.dropVsDiv),
    after,
    recovery: {
      n: closed.length,
      recovered: recovered.length,
      pct: closed.length ? (recovered.length / closed.length) * 100 : null,
      days: stats(recovered.map((e) => e.recoveryDays)),
      open: ev.length - closed.length,
    },
  };
}

// ---------- buy-write over the ex-date ----------
// Buy the stock at the close entryDays trading days before the ex-date, sell a call on the first weekly
// expiry (Friday) on or after the ex-date that lies dteMin..dteMax calendar days after the entry, hold
// through the ex-date (dividend) to expiry. History has no option prices, so per event only the stock
// side is measured; simulateBuyWrite() then applies today's strike distance and premium to each event.
export const BW_DEFAULTS = { entryDays: 2, dteMin: 2, dteMax: 10 };

const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
export const calDays = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs);

/** The first Friday on or after exDate that is dteMin..dteMax calendar days after entryDate, or null. */
export function weeklyExpiryAfter(exDate, entryDate, { dteMin = BW_DEFAULTS.dteMin, dteMax = BW_DEFAULTS.dteMax } = {}) {
  let f = exDate;
  while (weekday(f) !== 5) f = addDays(f, 1);
  for (; calDays(entryDate, f) <= dteMax; f = addDays(f, 7)) if (calDays(entryDate, f) >= dteMin) return f;
  return null;
}

/** Per ex-date: entry, the weekly expiry, and the stock's move from entry to the last close on or before it. Newest first. */
export function buyWriteEvents(divs, bars, { entryDays = BW_DEFAULTS.entryDays, dteMin = BW_DEFAULTS.dteMin, dteMax = BW_DEFAULTS.dteMax } = {}) {
  const dates = bars.map((b) => iso(b.time));
  const list = (divs || [])
    .filter((d) => isDate(d.exDate) && Number.isFinite(d.amount) && d.amount > 0)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  const out = [];
  for (const dv of list) {
    const e = firstOnOrAfter(dates, dv.exDate);
    if (e < 1 || e >= bars.length) continue;
    if ((Date.parse(dates[e]) - Date.parse(dv.exDate)) / dayMs > 4) continue;
    const i0 = e - entryDays;
    if (i0 < 0) continue;
    const entryDate = dates[i0];
    const s0 = bars[i0].close;
    const expiry = weeklyExpiryAfter(dv.exDate, entryDate, { dteMin, dteMax });
    const ev = { exDate: dv.exDate, amount: dv.amount, entryDate, entryClose: s0, dividendPct: (dv.amount / s0) * 100, expiry, dte: expiry ? calDays(entryDate, expiry) : null, exitDate: null, exitClose: null, movePct: null, totalPct: null };
    if (expiry) {
      const j = firstOnOrAfter(dates, addDays(expiry, 1)) - 1; // last trading day on or before the expiry
      if (j >= e && j < bars.length && dates.at(-1) >= expiry) {
        ev.exitDate = dates[j];
        ev.exitClose = bars[j].close;
        ev.movePct = pct(bars[j].close, s0);
        ev.totalPct = pct(bars[j].close + dv.amount, s0);
      }
    }
    out.push(ev);
  }
  return out.reverse();
}

/**
 * Today's buy-write terms applied to each past event (only those with an outcome):
 *   return = min(stock move, strike distance) + premium + dividend   (all in % of the entry price)
 * strikePct: strike over price - 1 (in %); premiumPct: call bid over price; dividendPct: today's dividend over
 * price (default: each event's own). assigned = the stock ended at or above the strike.
 */
export function simulateBuyWrite(events, { strikePct, premiumPct, dividendPct = null, dte = null }) {
  const rows = (events || [])
    .filter((e) => Number.isFinite(e.movePct))
    .map((e) => {
      const div = dividendPct ?? e.dividendPct;
      return { exDate: e.exDate, movePct: e.movePct, retPct: Math.min(e.movePct, strikePct) + premiumPct + div, assigned: e.movePct >= strikePct };
    });
  const ret = stats(rows.map((r) => r.retPct));
  const n = rows.length;
  return {
    n,
    ret,
    winPct: n ? (rows.filter((r) => r.retPct > 0).length / n) * 100 : null,
    assignedPct: n ? (rows.filter((r) => r.assigned).length / n) * 100 : null,
    // what an average trade would make a year if repeated at this DTE (simple, not compounded)
    perYearPct: dte > 0 && ret.avg != null ? (ret.avg * 365) / dte : null,
    rows,
  };
}

/** Stock-side statistics of buy-write events on or after since. */
export function summarizeBuyWrite(events, { since = null } = {}) {
  const ev = (since ? events.filter((e) => e.exDate >= since) : events).filter((e) => Number.isFinite(e.movePct));
  const move = stats(ev.map((e) => e.movePct));
  return {
    n: ev.length,
    move,
    total: stats(ev.map((e) => e.totalPct)),
    atOrAbovePct: ev.length ? (ev.filter((e) => e.movePct >= 0).length / ev.length) * 100 : null,
    shortfall: stats(ev.filter((e) => e.movePct < 0).map((e) => -e.movePct)),
    dte: stats(ev.map((e) => e.dte)),
  };
}

/**
 * The next ex-date: an announced one (after today) if any source has it, otherwise an estimate from the
 * usual gap between the last payments (median of up to 8 gaps). Returns {date, amount, estimated} or null.
 */
export function nextExDate(divs, today) {
  const list = (divs || []).filter((d) => isDate(d.exDate)).sort((a, b) => a.exDate.localeCompare(b.exDate));
  const ahead = list.filter((d) => d.exDate > today);
  if (ahead.length) return { date: ahead[0].exDate, amount: ahead[0].amount ?? null, estimated: false };
  const past = list.slice(-9);
  if (past.length < 3) return null;
  const gaps = past.slice(1).map((d, i) => (Date.parse(d.exDate) - Date.parse(past[i].exDate)) / dayMs).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)];
  const last = past.at(-1);
  // A payer that has skipped two of its usual payments has probably stopped.
  if ((Date.parse(today) - Date.parse(last.exDate)) / dayMs > gap * 2 + 15) return null;
  // A usual date that passed less than half a gap ago without an announcement is "due": the payment
  // is probably just late. Further back, the estimate moves on by whole gaps.
  let t = Date.parse(last.exDate) + gap * dayMs;
  while (t < Date.parse(today) - (gap / 2) * dayMs) t += gap * dayMs;
  const date = new Date(t).toISOString().slice(0, 10);
  return { date, amount: last.amount, estimated: true, overdue: date < today, gapDays: Math.round(gap) };
}
