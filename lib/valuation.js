// Valuation maths for FV and FVSCAN (no I/O, so the tests can feed it plain numbers).
// Inputs: annual rows from lib/fundamentals.js (oldest first, per-share values in the price currency),
// monthly closes [{time, close}] and dividends [{date, amount}] from Yahoo (split-adjusted).
export const DEFAULT_PE = 15;
export const BASES = { EPS: "eps", FCF: "fcfPs", OE: "oePs" };
export const BASIS_LABELS = { EPS: "earnings per share (GAAP, diluted)", FCF: "free cash flow per share", OE: "owner earnings per share (FCF minus stock-based pay)" };
const HORIZON = 5;
const DAY = 86400e3;
const isoOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const fin = (v) => typeof v === "number" && Number.isFinite(v);
export const median = (a) => {
  const s = a.filter(fin).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Compound growth in % from a to b over n years (both positive), else null. */
export function cagr(a, b, n) {
  return fin(a) && fin(b) && a > 0 && b > 0 && n > 0 ? ((b / a) ** (1 / n) - 1) * 100 : null;
}

/**
 * Growth in % over the last up to `n` annual values: the median of the growth between every pair of years
 * (Theil-Sen on the logs), so one odd year (a tax charge, a write-off) does not tilt it. Needs 5 positive
 * values and at most one year at or below zero (skipped); else null.
 */
export function regressionGrowth(values, n = 10) {
  const v = values.slice(-n).map((x, i) => [i, x]).filter(([, x]) => fin(x));
  const pos = v.filter(([, x]) => x > 0);
  if (pos.length < 5 || v.length - pos.length > 1) return null;
  const slopes = [];
  for (let a = 0; a < pos.length; a++)
    for (let b = a + 1; b < pos.length; b++) slopes.push((Math.log(pos[b][1]) - Math.log(pos[a][1])) / (pos[b][0] - pos[a][0]));
  return (Math.exp(median(slopes)) - 1) * 100;
}

/** The latest annual row that was public on `iso` (filed on or before it). */
export function knownAt(years, iso) {
  let out = null;
  for (const y of years) if (y.filed && y.filed <= iso) out = y;
  return out;
}

/**
 * Point-in-time multiple history: per month the price over the basis value of the last annual report out by
 * then. Only positive values count. -> [{time, iso, price, value, pe}]
 */
export function multipleHistory(years, months, key = "eps") {
  const out = [];
  for (const m of months) {
    const iso = isoOf(m.time);
    const y = knownAt(years, iso);
    const v = y?.[key];
    out.push({ time: m.time, iso, price: m.close, value: fin(v) ? v : null, pe: fin(v) && v > 0 ? m.close / v : null });
  }
  return out;
}

/** Normal multiple: median of the positive monthly multiples over the last `yearsBack` years (P/E above 200 is noise). */
export function normalMultiple(hist, yearsBack = 15) {
  if (!hist.length) return { value: null, months: 0, from: null };
  const from = hist.at(-1).time - yearsBack * 365.25 * 86400;
  const xs = hist.filter((h) => h.time >= from && fin(h.pe) && h.pe < 200);
  return { value: xs.length >= 12 ? median(xs.map((h) => h.pe)) : null, months: xs.length, from: xs[0]?.iso || null };
}

// ---------- dividends ----------
/** Regular payments: drops specials and Yahoo's stray double records (1.75 times the median payment of the two years around it or more). */
export function regularDividends(divs) {
  return divs.filter((d) => {
    const t = Date.parse(d.date);
    const near = divs.filter((x) => Math.abs(Date.parse(x.date) - t) <= 365 * DAY).map((x) => x.amount);
    return d.amount < 1.75 * median(near);
  });
}

/**
 * Dividend facts from the payment history: current annual rate (payments of the last 12 months), years paid in
 * a row, years raised in a row (the highest regular payment of each calendar year above the year before),
 * 5 and 10-year growth of the annual sum, the category (Champion 25+, Contender 10-24, Challenger 5-9).
 */
export function dividendStats(divs, todayIso) {
  const reg = regularDividends(divs || []);
  const thisYear = Number(todayIso.slice(0, 4));
  const yearEnd = new Date(Date.parse(todayIso) - 365 * DAY).toISOString().slice(0, 10);
  const last12 = reg.filter((d) => d.date > yearEnd);
  const annual = last12.reduce((s, d) => s + d.amount, 0);
  const byYear = new Map();
  for (const d of reg) {
    const y = Number(d.date.slice(0, 4));
    const r = byYear.get(y) || { sum: 0, max: 0, n: 0 };
    r.sum += d.amount;
    r.max = Math.max(r.max, d.amount);
    r.n++;
    byYear.set(y, r);
  }
  const full = [...byYear.keys()].filter((y) => y < thisYear).sort((a, b) => a - b);
  let paidYears = 0;
  for (let y = thisYear - 1; byYear.has(y); y--) paidYears++;
  let raisedYears = 0;
  for (let y = thisYear - 1; byYear.has(y) && byYear.has(y - 1) && byYear.get(y).max > byYear.get(y - 1).max * 1.0005; y--) raisedYears++;
  // A raise already paid this year continues the streak (a company that raises in spring shows it early).
  const sumOf = (y) => byYear.get(y)?.sum;
  const last = full.at(-1);
  const growth = (n) => (last && byYear.has(last - n) ? cagr(sumOf(last - n), sumOf(last), n) : null);
  const category = raisedYears >= 25 ? "Champion" : raisedYears >= 10 ? "Contender" : raisedYears >= 5 ? "Challenger" : null;
  return {
    annual: annual > 0 ? annual : null,
    payments12: last12.length,
    paidYears,
    raisedYears,
    growth5: growth(5),
    growth10: growth(10),
    category,
    history: full.slice(-20).map((y) => ({ year: y, sum: byYear.get(y).sum, payments: byYear.get(y).n })),
  };
}

/** Yield theory: average trailing yield over the last `yearsBack` years; fair value = today's dividend / that yield. */
export function yieldTheory(months, divs, annualNow, yearsBack = 10) {
  if (!(annualNow > 0) || !months.length) return null;
  const reg = regularDividends(divs || []);
  const from = months.at(-1).time - yearsBack * 365.25 * 86400;
  const ys = [];
  for (const m of months) {
    if (m.time < from) continue;
    const iso = isoOf(m.time);
    const start = new Date(m.time * 1000 - 365 * DAY).toISOString().slice(0, 10);
    const sum = reg.filter((d) => d.date > start && d.date <= iso).reduce((s, d) => s + d.amount, 0);
    if (sum > 0) ys.push((sum / m.close) * 100);
  }
  if (ys.length < 36) return null;
  const avg = mean(ys);
  return { avgYieldPct: avg, months: ys.length, fairValue: annualNow / (avg / 100), highYield: Math.max(...ys), lowYield: Math.min(...ys) };
}

// ---------- quality ----------
/** Piotroski F-score (0-9) from the last two annual rows; criteria with missing data count as not met and are listed. */
export function piotroski(cur, prev) {
  if (!cur || !prev) return null;
  const roa = (r, assets) => (fin(r.ni) && assets > 0 ? r.ni / assets : null);
  const lev = (r) => (fin(r.ltDebt ?? r.debt) && r.assets > 0 ? (r.ltDebt ?? r.debt) / r.assets : null);
  const cr = (r) => (r.curAssets > 0 && r.curLiab > 0 ? r.curAssets / r.curLiab : null);
  const gm = (r) => (fin(r.gp) && r.rev > 0 ? r.gp / r.rev : null);
  const turn = (r, assets) => (r.rev > 0 && assets > 0 ? r.rev / assets : null);
  const roaC = roa(cur, prev.assets);
  const roaP = roa(prev, prev.assets);
  const test = (name, a, b, ok) => ({ name, ok: a != null && (b === undefined || b != null) ? ok(a, b) : null });
  const criteria = [
    test("Net income positive", cur.ni, undefined, (a) => a > 0),
    test("Operating cash flow positive", cur.ocf, undefined, (a) => a > 0),
    test("Return on assets up", roaC, roaP, (a, b) => a > b),
    test("Cash flow above net income", cur.ocf, cur.ni, (a, b) => a > b),
    test("Long-term debt / assets down", lev(cur), lev(prev), (a, b) => a <= b),
    test("Current ratio up", cr(cur), cr(prev), (a, b) => a > b),
    test("No new shares", cur.shares, prev.shares, (a, b) => a <= b * 1.005),
    test("Gross margin up", gm(cur), gm(prev), (a, b) => a > b),
    test("Asset turnover up", turn(cur, prev.assets), turn(prev, prev.assets), (a, b) => a > b),
  ];
  return { score: criteria.filter((c) => c.ok).length, known: criteria.filter((c) => c.ok != null).length, criteria };
}

/** Altman Z (original, for industrial companies); null without the balance sheet items (banks, insurers). */
export function altmanZ(r, marketCap) {
  if (!r || !(r.assets > 0) || !(r.liab > 0) || !fin(r.curAssets) || !fin(r.curLiab) || !fin(r.opInc) || !fin(r.rev) || !(marketCap > 0)) return null;
  const A = r.assets;
  const z = 1.2 * ((r.curAssets - r.curLiab) / A) + 1.4 * ((r.retained ?? 0) / A) + 3.3 * (r.opInc / A) + 0.6 * (marketCap / r.liab) + (r.rev / A);
  return { z, zone: z > 2.99 ? "safe" : z > 1.81 ? "grey" : "distress" };
}

/** Return, margin and debt ratios of the latest year (prev for averages); fx converts money to the price currency is not needed: ratios. */
export function quality(years) {
  const n = years.length;
  const cur = years[n - 1];
  const prev = years[n - 2];
  if (!cur) return {};
  const avgEq = prev?.equity > 0 && cur.equity > 0 ? (cur.equity + prev.equity) / 2 : cur.equity;
  const taxRate = fin(cur.tax) && cur.pretax > 0 ? clamp(cur.tax / cur.pretax, 0, 0.5) : 0.21;
  const debt = cur.debt ?? null;
  const invested = (cur.equity ?? 0) + (debt ?? 0) - (cur.cash ?? 0);
  const ebitda = fin(cur.opInc) ? cur.opInc + (cur.da ?? 0) : null;
  const last5 = years.slice(-5);
  const fcf5 = last5.reduce((s, y) => s + (y.fcf ?? 0), 0);
  const div5 = last5.reduce((s, y) => s + (y.divPaid ?? 0), 0);
  const rev = years.map((y) => y.rev);
  return {
    fiscalYearEnd: cur.end,
    roePct: avgEq > 0 && fin(cur.ni) ? (cur.ni / avgEq) * 100 : null,
    roaPct: cur.assets > 0 && fin(cur.ni) ? (cur.ni / cur.assets) * 100 : null,
    roicPct: invested > 0 && fin(cur.opInc) ? ((cur.opInc * (1 - taxRate)) / invested) * 100 : null,
    grossMarginPct: cur.rev > 0 && fin(cur.gp) ? (cur.gp / cur.rev) * 100 : null,
    opMarginPct: cur.rev > 0 && fin(cur.opInc) ? (cur.opInc / cur.rev) * 100 : null,
    netMarginPct: cur.rev > 0 && fin(cur.ni) ? (cur.ni / cur.rev) * 100 : null,
    debtToCapitalPct: debt != null && fin(cur.equity) ? (cur.equity <= 0 ? 100 : (debt / (debt + cur.equity)) * 100) : null,
    netDebtEbitda: debt != null && ebitda > 0 ? (debt - (cur.cash ?? 0)) / ebitda : null,
    interestCover: fin(cur.opInc) && cur.interest > 0 ? cur.opInc / cur.interest : null,
    currentRatio: cur.curAssets > 0 && cur.curLiab > 0 ? cur.curAssets / cur.curLiab : null,
    payoutPct: cur.ni > 0 && cur.divPaid > 0 ? (cur.divPaid / cur.ni) * 100 : null,
    fcfPayoutPct: cur.fcf > 0 && cur.divPaid > 0 ? (cur.divPaid / cur.fcf) * 100 : null,
    fcfDivCover5: div5 > 0 ? fcf5 / div5 : null,
    revGrowth5: n > 5 ? cagr(rev[n - 6], rev[n - 1], 5) : null,
    revGrowth10: n > 10 ? cagr(rev[n - 11], rev[n - 1], 10) : null,
    taxRatePct: taxRate * 100,
    piotroski: piotroski(cur, prev),
  };
}

// ---------- expected return ----------
/**
 * FAST-Graphs-style 5-year return: earnings grow at g, the multiple moves to `exitPe`, dividends (growing at g,
 * at most the dividend growth) are collected. -> % per year, or null.
 */
export function expectedReturn({ price, basis, g, exitPe, dividend = 0, years = HORIZON }) {
  if (!(price > 0) || !(basis > 0) || !fin(g) || !(exitPe > 0)) return null;
  const gr = g / 100;
  const end = basis * (1 + gr) ** years * exitPe;
  let divs = 0;
  for (let k = 1; k <= years; k++) divs += (dividend || 0) * (1 + Math.max(gr, 0)) ** k;
  const total = (end + divs) / price;
  return total > 0 ? (total ** (1 / years) - 1) * 100 : -100;
}

export const LONG_RUN_GROWTH = 6; // % a year, where next year's estimate fades to (about nominal GDP)
export const MAX_EXIT_PE = 30;
export const ONE_OFF = 1.3; // TTM EPS above 1.3 x next year's estimate counts as a one-off
/** Next year's growth for one year, then LONG_RUN_GROWTH: as one rate per year over the horizon. */
export const fadeGrowth = (g1, years = HORIZON) => (((1 + g1 / 100) * (1 + LONG_RUN_GROWTH / 100) ** (years - 1)) ** (1 / years) - 1) * 100;
/**
 * Which growth rate the expected return uses: the fit over up to 10 annual values, else the 5-year CAGR,
 * else the analysts' next year faded to LONG_RUN_GROWTH (one year is no 5-year rate); capped -10..+25 %.
 */
export function pickGrowth({ regression, cagr5, analysts }) {
  const pick = fin(regression) ? ["fit over the annual values", regression]
    : fin(cagr5) ? ["5-year growth", cagr5]
      : fin(analysts) ? [`analysts' next year, then ${LONG_RUN_GROWTH}%`, fadeGrowth(clamp(analysts, -50, 100))] : [null, null];
  return pick[1] == null ? { g: null, source: null } : { g: clamp(pick[1], -10, 25), raw: pick[1], source: pick[0] };
}

// ---------- backtest ----------
/**
 * Was buying below the normal value worth it for this stock? Every month from the sixth year: price over the
 * value at the normal P/E known then (the median P/E of the months before, at least 36), and the return over
 * the next 12 months with dividends. Grouped by that ratio.
 */
export function valuationBacktest(hist, divs, { key = "pe", minMonths = 36 } = {}) {
  const reg = regularDividends(divs || []);
  const buckets = [
    { key: "deep", label: "more than 20% below", lo: 0, hi: 0.8 },
    { key: "below", label: "0-20% below", lo: 0.8, hi: 1 },
    { key: "above", label: "0-20% above", lo: 1, hi: 1.2 },
    { key: "rich", label: "more than 20% above", lo: 1.2, hi: Infinity },
  ].map((b) => ({ ...b, rets: [] }));
  const all = [];
  const pes = [];
  for (let i = 0; i < hist.length; i++) {
    const h = hist[i];
    const normal = pes.length >= minMonths ? median(pes) : null;
    if (fin(h[key]) && h[key] < 200) pes.push(h[key]);
    if (!normal || !(h.value > 0) || i + 12 >= hist.length) continue;
    const ratio = h.price / (h.value * normal);
    const exit = hist[i + 12];
    const dsum = reg.filter((d) => d.date > h.iso && d.date <= exit.iso).reduce((s, d) => s + d.amount, 0);
    const ret = ((exit.price + dsum) / h.price - 1) * 100;
    all.push(ret);
    buckets.find((b) => ratio >= b.lo && ratio < b.hi)?.rets.push(ret);
  }
  const sum = (rets) => ({ n: rets.length, avgPct: mean(rets), medianPct: median(rets), winPct: rets.length ? (rets.filter((r) => r > 0).length / rets.length) * 100 : null });
  return { all: sum(all), buckets: buckets.map((b) => ({ key: b.key, label: b.label, ...sum(b.rets) })) };
}

// ---------- the whole picture ----------
/**
 * Everything FV shows and FVSCAN ranks, from prepared inputs.
 *   years: annual rows in the price currency (per-share), months, divs, price, epsTtm, epsForward,
 *   pe (fair multiple, default 15), basis (EPS|FCF|OE), rsl, analystsGrowth, marketCap, bondYield, today.
 */
export function analyse(input) {
  const { years = [], months = [], divs = [], price, epsTtm = null, epsForward = null, pe = DEFAULT_PE, basis = "EPS", rsl = null, analystsGrowth = null, marketCap = null, bondYield = null, today, financial = false, shortHistory = false } = input;
  const key = BASES[basis] || "eps";
  const last = years.at(-1) || null;
  const series = years.map((y) => y[key]);
  // Current value of the basis: TTM EPS from the quote when on EPS, else the last fiscal year. TTM well above
  // what analysts expect for next year is a one-off gain (a sale, a tax benefit): then the forward EPS.
  const ttm = basis === "EPS" && fin(epsTtm) ? epsTtm : last?.[key] ?? null;
  const oneOff = basis === "EPS" && ttm > 0 && epsForward > 0 && ttm > ONE_OFF * epsForward;
  const now = oneOff ? epsForward : ttm;
  const hist = multipleHistory(years, months, key);
  const normal = normalMultiple(hist);
  const regression = regressionGrowth(series);
  const n = series.length;
  // 5-year CAGR only over six positive years: from a near-zero year after losses it is meaningless.
  const cagr5 = n > 5 && series.slice(-6).every((v) => v > 0) ? cagr(series[n - 6], series[n - 1], 5) : null;
  // Two or more loss years in the last ten: earnings too erratic for a P/E valuation.
  const losses = series.slice(-10).filter((v) => fin(v) && v <= 0).length;
  const erratic = losses >= 2;
  const cagr10 = n > 10 ? cagr(series[n - 11], series[n - 1], 10) : null;
  const growth = pickGrowth({ regression, cagr5, analysts: analystsGrowth });
  const div = dividendStats(divs, today);
  const yt = yieldTheory(months, divs, div.annual);
  const q = quality(years);
  const fv = now > 0 ? now * pe : null;
  const normalValue = now > 0 && normal.value ? now * normal.value : null;
  const fvForward = basis === "EPS" && epsForward > 0 ? epsForward * pe : null;
  const currentPe = now > 0 ? price / now : null;
  const earningsYield = now > 0 ? (now / price) * 100 : null;
  // The P/E the 5-year return assumes at the end: the normal one (at most MAX_EXIT_PE). With less than 5 years of
  // multiples the normal P/E is unreliable: then no re-rating upward (at most today's P/E).
  const short = shortHistory || normal.months < 60;
  const exitNormal = normal.value ? Math.min(normal.value, MAX_EXIT_PE, short && currentPe > 0 ? currentPe : Infinity) : null;
  const er = expectedReturn({ price, basis: now, g: growth.g, exitPe: exitNormal, dividend: div.annual });
  const erFair = expectedReturn({ price, basis: now, g: growth.g, exitPe: pe, dividend: div.annual });
  const erAnalysts = fin(analystsGrowth) ? expectedReturn({ price, basis: now, g: clamp(fadeGrowth(clamp(analystsGrowth, -50, 100)), -10, 25), exitPe: exitNormal, dividend: div.annual }) : null;
  const vsNormal = pct(price, normalValue);
  const peg = currentPe && growth.g > 0 ? currentPe / growth.g : null;
  const z = financial ? null : altmanZ(last, marketCap);
  const value =
    vsNormal == null ? { level: "na", label: "no normal P/E" }
      : vsNormal <= -10 ? { level: "cheap", label: "below normal" }
        : vsNormal <= 10 ? { level: "fair", label: "near normal" }
          : { level: "rich", label: "above normal" };
  if (short && value.level !== "na") value.label += " (short history)";
  return {
    basis,
    basisLabel: BASIS_LABELS[basis],
    pe,
    now,
    ttm,
    oneOff,
    losses,
    erratic,
    lastYear: last?.end || null,
    currentPe,
    earningsYield,
    bondYield,
    yieldGap: earningsYield != null && fin(bondYield) ? earningsYield - bondYield : null,
    fairValue: fv,
    vsFairPct: pct(price, fv),
    fairValueForward: fvForward,
    vsForwardPct: pct(price, fvForward),
    normalPe: normal.value,
    normalMonths: normal.months,
    normalFrom: normal.from,
    shortHistory: short,
    exitPe: exitNormal,
    normalValue,
    vsNormalPct: vsNormal,
    value,
    growth: { ...growth, regression, cagr5, cagr10, analysts: analystsGrowth },
    peg,
    expectedReturn: er,
    expectedReturnAtFair: erFair,
    expectedReturnAnalysts: erAnalysts,
    dividend: { ...div, yieldPct: div.annual && price > 0 ? (div.annual / price) * 100 : null },
    yieldTheory: yt ? { ...yt, vsPct: pct(price, yt.fairValue) } : null,
    quality: q,
    altman: z,
    rsl,
    cheapMomentum: vsNormal != null && vsNormal < 0 && rsl > 1,
    history: hist,
    years: years.length,
  };
}
