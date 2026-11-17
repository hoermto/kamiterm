// /api/fn/fv?symbol=KO&basis=EPS&pe=15 : fair value analysis of one stock (the FV screen).
// Fair value at a fixed P/E (default 15), the stock's own normal P/E (median of the monthly P/E over up to
// 15 years, point in time), forward and yield-theory values, analysts' targets, a 5-year expected return
// (growth + P/E back to normal + dividends), quality (ROE, ROIC, margins, debt, Piotroski, Altman Z),
// dividend streaks, RSL26 momentum and a backtest of buying below the normal value.
// Data: lib/fundamentals.js (SEC company facts for US stocks, Yahoo otherwise), maths: lib/valuation.js.
import { loadChart, loadFundamentals, quotes, fxRate, loadProfile } from "../fundamentals.js";
import { analyse, valuationBacktest, BASES, DEFAULT_PE } from "../valuation.js";
import { history, numParam } from "./grokki-data.js";
import { levy } from "./grokki-math.js";
import { SECTORS } from "./grokki-universes.js";

const bad = (m) => Object.assign(new Error(m), { status: 400 });
const PER_SHARE = ["eps", "fcfPs", "oePs"];
const FIN_SECTORS = new Set(["XLF", "XLRE"]);
const finSector = new Set(Object.entries(SECTORS).filter(([k]) => FIN_SECTORS.has(k)).flatMap(([, s]) => s.stocks));

export function fvParams(q = {}) {
  const basis = String(q.basis || "EPS").toUpperCase();
  if (!BASES[basis]) throw bad(`Basis is one of ${Object.keys(BASES).join(", ")}`);
  return { basis, pe: numParam(q.pe, DEFAULT_PE, 5, 40) };
}

let bond = null;
/** US 10-year Treasury yield in % (Yahoo ^TNX), kept an hour. */
async function bondYield() {
  if (bond && Date.now() - bond.at < 3600e3) return bond.v;
  const h = await history("^TNX", 1).catch(() => null);
  const v = h?.bars.at(-1)?.close ?? null;
  bond = { at: Date.now(), v: v > 20 ? v / 10 : v };
  return bond.v;
}

/**
 * Loads and analyses one stock. opts: basis, pe, quote (from a batch, else fetched), profile (FV page: sector
 * and analysts), today. -> {t, name, currency, price, fund, chart, a (analyse result), notes}
 */
export async function prepare(t, { basis = "EPS", pe = DEFAULT_PE, quote, profile = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const chart = await loadChart(t);
  const [fund, q, daily] = await Promise.all([
    loadFundamentals(t, chart.splits).catch((e) => ({ error: e.message, years: [] })),
    quote !== undefined ? quote : quotes([t]).then((x) => x[t] || null),
    history(t, 1).catch(() => null),
  ]);
  const notes = [];
  const price = q?.price ?? daily?.bars.at(-1)?.close ?? chart.months.at(-1).close;
  const cur = q?.currency || chart.currency || null;
  const finCur = fund.currency || q?.financialCurrency || cur;
  let fx = 1;
  let fxQ = 1;
  try {
    fx = await fxRate(finCur, cur);
    fxQ = q?.financialCurrency ? await fxRate(q.financialCurrency, cur) : fx;
  } catch (e) {
    notes.push(`${e.message}: per-share values left in ${finCur}`);
  }
  const major = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" }[cur] || cur;
  if (finCur && major && finCur !== major) notes.push(`Reports in ${finCur}; per-share values converted to ${major} at today's rate`);
  const years = (fund.years || []).map((y) => {
    const r = { ...y };
    for (const k of PER_SHARE) if (r[k] != null) r[k] *= fx;
    return r;
  });
  if (fund.error) notes.push(`No annual figures: ${fund.error}`);
  if (fund.secError) notes.push(`SEC did not answer (${fund.secError}); Yahoo's 4 years for now, SEC again within the hour. Set your contact address in SETTINGS > Data sources if it is missing`);
  else if (fund.source === "yahoo") notes.push("Annual figures from Yahoo: only the last 4 years, so the normal P/E and growth rest on little history");
  if (fund.stale) notes.push("Annual figures could not be refreshed; showing the saved ones");
  const sector = profile?.sector || null;
  const financial = finSector.has(t) || /financial|real estate/i.test(sector || "");
  if (financial) notes.push("Bank, insurer or real estate: P/E and cash flow say less here (book value, FFO); Altman Z not applied");
  const trendNext = profile?.trend?.find((x) => x.period === "+1y");
  // Yahoo's TTM and forward EPS for listings outside the US can be per ADR or in a mixed currency (Shell):
  // with Yahoo's annual figures the valuation uses the last annual EPS, and the forward EPS only when close to it.
  const lastEps = years.at(-1)?.eps;
  const yahooOnly = fund.source !== "sec";
  const fwd = q?.epsForward != null ? q.epsForward * fxQ : null;
  const fwdOk = fwd != null && (!yahooOnly || (lastEps > 0 && fwd / lastEps > 0.5 && fwd / lastEps < 2));
  const a = analyse({
    years,
    months: chart.months,
    divs: chart.dividends,
    price,
    epsTtm: q?.epsTtm != null && !yahooOnly ? q.epsTtm * fxQ : null,
    epsForward: fwdOk ? fwd : null,
    shortHistory: yahooOnly,
    pe,
    basis,
    rsl: daily ? levy(daily.bars) : null,
    // analysts' growth for next year (FV page), else forward EPS over the last annual EPS (FVSCAN, no profile)
    analystsGrowth: trendNext?.growth != null ? trendNext.growth * 100 : fwdOk && lastEps > 0 ? (fwd / lastEps - 1) * 100 : null,
    marketCap: q?.marketCap != null ? q.marketCap / (fx || 1) : null,
    bondYield: /^USD$/.test(cur || "") ? await bondYield() : null,
    today,
    financial,
  });
  return { t, name: q?.name || fund.name || chart.name || t, currency: cur, financialCurrency: finCur, price, source: fund.source || null, fund, years, chart, a, notes, financial, rating: q?.rating || null };
}

export default async function (q = {}) {
  const t = String(q.symbol || "").trim().toUpperCase();
  if (!t) throw bad("Send ?symbol=KO");
  const { basis, pe } = fvParams(q);
  const profile = await loadProfile(t).catch(() => null);
  const p = await prepare(t, { basis, pe, profile });
  const a = p.a;
  // Chart: monthly price with the value lines from the first annual report on.
  const firstFiled = p.years.find((y) => y.filed)?.filed || null;
  const lines = a.history
    .filter((h) => firstFiled && h.iso >= firstFiled)
    .map((h) => ({ time: h.time, price: h.price, fair: h.value > 0 ? h.value * pe : null, normal: h.value > 0 && a.normalPe ? h.value * a.normalPe : null }));
  const backtest = valuationBacktest(a.history, p.chart.dividends);
  const { history: _h, ...rest } = a;
  return {
    symbol: t,
    name: p.name,
    currency: p.currency,
    financialCurrency: p.financialCurrency,
    price: p.price,
    rating: p.rating,
    profile,
    ...rest,
    backtest,
    lines,
    annual: p.years.slice(-15).map((y) => ({
      end: y.end, filed: y.filed, rev: y.rev, ni: y.ni, eps: y.eps, fcfPs: y.fcfPs, oePs: y.oePs, divPaid: y.divPaid, fcf: y.fcf,
      roe: y.equity > 0 && y.ni != null ? (y.ni / y.equity) * 100 : null, margin: y.rev > 0 && y.ni != null ? (y.ni / y.rev) * 100 : null,
      debt: y.debt, equity: y.equity, shares: y.shares,
    })),
    dataSource: p.source,
    notes: p.notes,
    source:
      `Annual figures: ${p.source === "sec" ? "SEC company facts (10-K, split-adjusted)" : "Yahoo annual time series"}. Prices, dividends and splits: Yahoo (monthly). ` +
      "Quote, TTM and forward EPS, analysts: Yahoo. RSL26: daily prices from the OHLC cache. 10-year yield: Yahoo ^TNX.",
  };
}
