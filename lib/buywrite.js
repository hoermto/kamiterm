// The option side of a buy-write over the ex-date, from today's CBOE chain (US stocks only; there is no
// free option data for European stocks): does the stock have weekly options, which expiry fits the trade,
// the first call strike above the price, its premium, and whether early assignment before the ex-date
// is likely. The history side (how the stock moved) is in lib/event-moves.js.
import { loadChain, cboeSymbol, mid } from "./fn/omon.js";
import { calDays, BW_DEFAULTS } from "./event-moves.js";

const dayMs = 86400e3;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Weekly options: at least 3 different expiry dates within the next 35 days (monthlies alone give 1 or 2). */
export function hasWeeklies(expiries, today) {
  const dates = new Set((expiries || []).map((e) => e.date).filter((d) => d >= today && calDays(today, d) <= 35));
  return dates.size >= 3;
}

/** The trading day entryDays before exDate (weekends skipped; exchange holidays are not known). */
export function entryDateFor(exDate, entryDays = BW_DEFAULTS.entryDays) {
  let d = exDate;
  for (let n = 0; n < entryDays; ) {
    d = addDays(d, -1);
    if (weekday(d) !== 0 && weekday(d) !== 6) n++;
  }
  return d;
}

/** The first expiry on or after exDate that is dteMin..dteMax calendar days after entryDate, or null. */
export function targetExpiry(expiries, exDate, entryDate, { dteMin = BW_DEFAULTS.dteMin, dteMax = BW_DEFAULTS.dteMax } = {}) {
  return (expiries || []).find((e) => e.date >= exDate && calDays(entryDate, e.date) >= dteMin && calDays(entryDate, e.date) <= dteMax) || null;
}

/** The first strike above the price that has a call quote, with its quote. */
export function firstCallAbove(rows, price) {
  const r = (rows || []).find((x) => x.strike > price && x.call && (x.call.bid > 0 || x.call.ask > 0));
  if (!r) return null;
  const c = r.call;
  const m = mid(c);
  return {
    strike: r.strike,
    bid: c.bid ?? null,
    ask: c.ask ?? null,
    mid: m,
    delta: c.delta ?? null,
    iv: c.iv ?? null,
    oi: c.oi ?? 0,
    volume: c.volume ?? 0,
    spreadPct: c.bid > 0 && c.ask > 0 && m > 0 ? ((c.ask - c.bid) / m) * 100 : null,
  };
}

/**
 * Early assignment: a call holder exercises on the day before the ex-date (and takes the dividend) when the
 * call is in the money and its time value is smaller than the dividend. For a call above the price this only
 * matters if the stock rises above the strike before then.
 */
export function earlyAssignment({ price, strike, bid, dividend }) {
  const intrinsic = Math.max(0, price - strike);
  const extrinsic = bid - intrinsic;
  return { inTheMoney: price >= strike, extrinsic, risk: price >= strike && extrinsic < dividend };
}

/**
 * Today's buy-write terms for an upcoming ex-date from a parsed chain ({price, expiries}).
 * The entry is entryDays trading days before the ex-date, but not before today.
 */
export function buyWriteQuote(chain, { exDate, dividend, today, entryDays = BW_DEFAULTS.entryDays, dteMin = BW_DEFAULTS.dteMin, dteMax = BW_DEFAULTS.dteMax }) {
  const price = chain?.price;
  const weekly = hasWeeklies(chain?.expiries, today);
  const base = { price, weekly, exDate, dividend, entryDate: null, expiry: null, dte: null, call: null };
  if (!(price > 0)) return { ...base, reason: "No price in the option data" };
  if (!exDate || exDate <= today) return { ...base, reason: "The ex-date is not ahead" };
  const planned = entryDateFor(exDate, entryDays);
  const entryDate = planned < today ? today : planned;
  const exp = targetExpiry(chain.expiries, exDate, entryDate, { dteMin, dteMax });
  if (!exp) return { ...base, entryDate, reason: `No expiry ${dteMin}-${dteMax} days after the entry on ${entryDate}` };
  const call = firstCallAbove(exp.rows, price);
  if (!call) return { ...base, entryDate, expiry: exp.date, dte: calDays(entryDate, exp.date), reason: "No call quote above the price" };
  const premium = call.bid > 0 ? call.bid : null; // what selling gets you now; the ask is not reachable
  return {
    ...base,
    entryDate,
    expiry: exp.date,
    dte: calDays(entryDate, exp.date),
    call,
    strikePct: (call.strike / price - 1) * 100,
    premiumPct: premium != null ? (premium / price) * 100 : null,
    dividendPct: dividend > 0 ? (dividend / price) * 100 : null,
    early: premium != null && dividend > 0 ? earlyAssignment({ price, strike: call.strike, bid: premium, dividend }) : null,
    reason: premium == null ? "The call has no bid" : null,
  };
}

/** Loads the chain and returns buyWriteQuote, plus the chain's source and time; null when the stock has no US options. */
export async function loadBuyWrite(ticker, opts) {
  const sym = cboeSymbol(ticker);
  if (!sym || sym.index) return null;
  const chain = await loadChain(sym);
  return { ...buyWriteQuote(chain, opts), source: chain.source, asOf: chain.asOf };
}
