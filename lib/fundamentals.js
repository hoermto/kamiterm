// Annual fundamentals per stock for FV and FVSCAN, kept on disk (data/cache/fundamentals/) so a scan does not
// download them again.
//   US stocks: SEC company facts (data.sec.gov/api/xbrl/companyfacts), every 10-K value with its filing date,
//              up to about 20 years. Per-share values are split-adjusted with Yahoo's split history.
//   Others (and US companies without SEC data): Yahoo's annual time series, about 4 years.
// Prices, dividends and splits: one Yahoo chart request (monthly, whole history; range=max skips years, so
// period1=0). Quotes: Yahoo v7 quote.
import fs from "node:fs";
import path from "node:path";
import { getJson, YAHOO_UA as UA } from "./providers.js";
import { DATA_DIR } from "./store.js";
import { secHeaders } from "./sec-contact.js";
import { loadTickers, lookupCik } from "./fn/cf.js";
import { yahooSession, resetYahooSession } from "./fn/des.js";

const DIR = path.join(DATA_DIR, "cache", "fundamentals");
const DAY = 86400e3;
export const FUND_TTL = 14 * DAY; // a new 10-K comes once a year; two weeks keeps a scan cheap
export const CHART_TTL = 2 * DAY;
const fileOf = (t, kind) => path.join(DIR, `${String(t).toUpperCase().replace(/[^A-Z0-9.^=-]/g, "_")}.${kind}.json`);

function readDisk(t, kind) {
  try {
    return JSON.parse(fs.readFileSync(fileOf(t, kind), "utf8"));
  } catch {
    return null;
  }
}
function writeDisk(t, kind, value) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const f = fileOf(t, kind);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(value));
    fs.renameSync(`${f}.tmp`, f);
  } catch {
    /* the cache is optional */
  }
}

// One load per ticker and kind at a time: a scan and the FV page asking together share the request.
const inflight = new Map();
async function diskCached(t, kind, ttl, load) {
  const hit = readDisk(t, kind);
  if (hit && Date.now() - hit.at < ttl) return hit;
  const key = `${kind}:${t}`;
  if (!inflight.has(key))
    inflight.set(
      key,
      (async () => {
        try {
          const v = { ...(await load()), at: Date.now() };
          writeDisk(t, kind, v);
          return v;
        } catch (e) {
          if (hit) return { ...hit, stale: true }; // older data beats none
          throw e;
        } finally {
          inflight.delete(key);
        }
      })(),
    );
  return inflight.get(key);
}

// ---------- SEC company facts -> annual rows ----------
// Each field: the US-GAAP tags in order of preference. Companies switch tags over the years (Revenues ->
// RevenueFromContractWithCustomer... in 2018), so the first tag with a value for a fiscal year wins per year.
export const SEC_FIELDS = {
  rev: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "RevenuesNetOfInterestExpense"],
  gp: ["GrossProfit"],
  opInc: ["OperatingIncomeLoss"],
  ni: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
  shares: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted", "WeightedAverageNumberOfSharesOutstandingBasic"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"],
  sbc: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  divPaid: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"],
  buyback: ["PaymentsForRepurchaseOfCommonStock"],
  da: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet"],
  interest: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"],
  pretax: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  tax: ["IncomeTaxExpenseBenefit"],
  // balance sheet (values at the fiscal year end)
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  assets: ["Assets"],
  curAssets: ["AssetsCurrent"],
  curLiab: ["LiabilitiesCurrent"],
  liab: ["Liabilities"],
  ltDebt: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"],
  stDebt: ["LongTermDebtCurrent", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  stBorrow: ["ShortTermBorrowings", "CommercialPaper"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
  retained: ["RetainedEarningsAccumulatedDeficit"],
};
const PER_SHARE = new Set(["eps"]);
const SHARE_COUNT = new Set(["shares"]);
const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "10-KT", "20-F", "20-F/A", "40-F"]);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;

/** The values of one tag: Map end -> {v, filed, first, firstFiled}; the latest filing gives v (restated), the first filed date says when it was known. */
function tagValues(units, field) {
  const unit = PER_SHARE.has(field)
    ? Object.keys(units).find((u) => /\/shares$/.test(u))
    : SHARE_COUNT.has(field)
      ? Object.keys(units).find((u) => u === "shares")
      : (units.USD ? "USD" : Object.keys(units).find((u) => !/shares|pure/.test(u)));
  if (!unit) return null;
  const out = new Map();
  for (const x of units[unit]) {
    if (!ANNUAL_FORMS.has(x.form) || x.val == null) continue;
    if (x.start) {
      const d = days(x.start, x.end);
      if (d < 330 || d > 400) continue; // quarters and odd stub periods
    }
    const prev = out.get(x.end);
    if (!prev) out.set(x.end, { v: x.val, filed: x.filed, first: x.val, firstFiled: x.filed, flow: !!x.start });
    else {
      if (x.filed > prev.filed) Object.assign(prev, { v: x.val, filed: x.filed });
      if (x.filed < prev.firstFiled) Object.assign(prev, { first: x.val, firstFiled: x.filed });
    }
  }
  return { unit, values: out };
}

/** Split factor to apply to a per-share value filed on `filed`: the product of the splits after it. */
export function splitFactorAfter(splits, filed) {
  let f = 1;
  for (const s of splits || []) if (s.date > filed) f *= s.ratio;
  return f;
}

/**
 * SEC company facts -> {currency, years:[{end, filed, rev, ni, eps, ...}]} (oldest first, at most 20 years).
 * Fiscal years are the end dates of annual net income or revenue. `filed` = the first filing that had the
 * year (point in time for backtests). Per-share values and share counts are split-adjusted.
 */
export function extractSec(facts, splits = []) {
  const g = facts?.facts?.["us-gaap"];
  if (!g) return null;
  const series = {};
  let currency = "USD";
  for (const [field, tags] of Object.entries(SEC_FIELDS)) {
    const merged = new Map();
    for (const tag of tags) {
      const u = g[tag]?.units;
      if (!u) continue;
      const tv = tagValues(u, field);
      if (!tv) continue;
      if (field === "ni" && tv.unit !== "USD") currency = tv.unit;
      for (const [end, v] of tv.values) if (!merged.has(end)) merged.set(end, v);
    }
    series[field] = merged;
  }
  // fiscal year ends: annual flows of net income (else revenue), one per ~year
  const ends = [...new Set([...series.ni.keys(), ...series.rev.keys()].filter((e) => (series.ni.get(e) || series.rev.get(e))?.flow))].sort();
  const yearEnds = [];
  for (const e of ends) if (!yearEnds.length || days(yearEnds.at(-1), e) > 300) yearEnds.push(e);
  const near = (map, end) => {
    if (map.has(end)) return map.get(end);
    for (const [k, v] of map) if (Math.abs(days(k, end)) <= 7) return v;
    return null;
  };
  const years = yearEnds.slice(-20).map((end) => {
    const row = { end, fy: Number(end.slice(0, 4)) };
    let filed = null;
    for (const field of Object.keys(SEC_FIELDS)) {
      const x = near(series[field], end);
      if (!x) continue;
      let v = x.v;
      if (PER_SHARE.has(field)) v = v / splitFactorAfter(splits, x.filed);
      if (SHARE_COUNT.has(field)) v = v * splitFactorAfter(splits, x.filed);
      row[field] = v;
      if (field === "ni" || field === "rev") filed = filed && filed < x.firstFiled ? filed : x.firstFiled;
    }
    row.filed = filed;
    return row;
  });
  return { currency, years: years.map(finishYear), source: "sec" };
}

/** Derived per-year values shared by both sources. */
function finishYear(r) {
  const debt = (r.ltDebt ?? 0) + (r.stDebt ?? 0) + (r.stBorrow ?? 0);
  if (r.debt == null) r.debt = r.ltDebt != null || r.stDebt != null || r.stBorrow != null ? debt : null;
  if (r.eps == null && r.ni != null && r.shares > 0) r.eps = r.ni / r.shares;
  if (r.shares == null && r.ni != null && r.eps) r.shares = r.ni / r.eps;
  if (r.ocf != null) r.fcf = r.ocf - Math.abs(r.capex ?? 0);
  if (r.fcf != null && r.shares > 0) {
    r.fcfPs = r.fcf / r.shares;
    r.oePs = (r.fcf - Math.abs(r.sbc ?? 0)) / r.shares; // owner earnings: FCF minus stock-based pay
  }
  if (r.divPaid != null) r.divPaid = Math.abs(r.divPaid);
  if (r.buyback != null) r.buyback = Math.abs(r.buyback);
  return r;
}

// ---------- Yahoo annual time series ----------
const YF = {
  rev: "TotalRevenue", gp: "GrossProfit", opInc: "OperatingIncome", ni: "NetIncomeCommonStockholders", eps: "DilutedEPS",
  shares: "DilutedAverageShares", ocf: "OperatingCashFlow", capex: "CapitalExpenditure", sbc: "StockBasedCompensation",
  divPaid: "CashDividendsPaid", buyback: "RepurchaseOfCapitalStock", da: "ReconciledDepreciation", interest: "InterestExpense",
  pretax: "PretaxIncome", tax: "TaxProvision", equity: "StockholdersEquity", assets: "TotalAssets", curAssets: "CurrentAssets",
  curLiab: "CurrentLiabilities", liab: "TotalLiabilitiesNetMinorityInterest", debt: "TotalDebt", cash: "CashAndCashEquivalents",
  retained: "RetainedEarnings",
};

export function parseYahooSeries(j) {
  const byEnd = new Map();
  for (const r of j?.timeseries?.result || []) {
    const type = r.meta?.type?.[0];
    const field = Object.keys(YF).find((k) => `annual${YF[k]}` === type);
    if (!field) continue;
    for (const x of r[type] || []) {
      if (!x?.asOfDate || x.reportedValue?.raw == null) continue;
      const row = byEnd.get(x.asOfDate) || { end: x.asOfDate, fy: Number(x.asOfDate.slice(0, 4)) };
      row[field] = x.reportedValue.raw;
      if (x.currencyCode) row.cur = x.currencyCode;
      byEnd.set(x.asOfDate, row);
    }
  }
  const years = [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end)).filter((r) => r.ni != null || r.rev != null);
  // Yahoo gives no filing date: assume the annual report is out 75 days after the year end.
  for (const r of years) r.filed = new Date(Date.parse(r.end) + 75 * DAY).toISOString().slice(0, 10);
  return { currency: years.find((r) => r.cur)?.cur || null, years: years.map(finishYear), source: "yahoo" };
}

async function yahooFetch(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await yahooSession();
    try {
      return await getJson(`${url}${url.includes("?") ? "&" : "?"}crumb=${encodeURIComponent(s.crumb)}`, { ...UA, Cookie: s.cookie });
    } catch (e) {
      if (e.status === 401 && attempt === 0) {
        resetYahooSession();
        continue;
      }
      throw e;
    }
  }
}

async function yahooFundamentals(t) {
  const now = Math.floor(Date.now() / 1000);
  const types = Object.values(YF).map((k) => `annual${k}`).join(",");
  const j = await yahooFetch(`https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(t)}?type=${types}&period1=${now - 12 * 365 * 86400}&period2=${now}`);
  const out = parseYahooSeries(j);
  if (!out.years.length) throw Object.assign(new Error(`No annual figures for ${t}`), { status: 404 });
  return out;
}

// ---------- Yahoo monthly chart: prices, dividends, splits ----------
export function parseChart(j) {
  const r = j?.chart?.result?.[0];
  if (!r) return null;
  const ts = r.timestamp || [];
  const close = r.indicators?.quote?.[0]?.close || [];
  const months = [];
  for (let i = 0; i < ts.length; i++) if (close[i] > 0) months.push({ time: ts[i], close: close[i] });
  const dividends = Object.values(r.events?.dividends || {})
    .map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const splits = Object.values(r.events?.splits || {})
    .map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.numerator / s.denominator }))
    .filter((s) => s.ratio > 0 && s.ratio !== 1)
    .sort((a, b) => a.date.localeCompare(b.date));
  return { currency: r.meta?.currency || null, name: r.meta?.longName || r.meta?.shortName || "", months, dividends, splits };
}

export const loadChart = (t) =>
  diskCached(t, "chart", CHART_TTL, async () => {
    const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1mo&period1=0&period2=${Math.floor(Date.now() / 1000)}&events=div%7Csplit`, UA);
    const c = parseChart(j);
    if (!c?.months.length) throw Object.assign(new Error(`Yahoo has no prices for ${t}`), { status: 404 });
    return c;
  });

/** Annual fundamentals: SEC for US tickers with company facts, else Yahoo. */
export const loadFundamentals = (t, splits = []) =>
  diskCached(t, "fund", FUND_TTL, async () => {
    const us = !/[.]/.test(t) || /^[A-Z]+\.[AB]$/.test(t) || /-[AB]$/.test(t);
    if (us) {
      try {
        const hit = lookupCik(await loadTickers(), t);
        if (hit) {
          const facts = await getJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(hit.cik).padStart(10, "0")}.json`, secHeaders());
          const out = extractSec(facts, splits);
          // 20-F filers with IFRS have no us-gaap facts; Yahoo then.
          if (out?.years.filter((y) => y.ni != null).length >= 3) return { ...out, cik: hit.cik, name: facts.entityName || hit.name };
        }
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
      }
    }
    return yahooFundamentals(t);
  });

// ---------- quotes ----------
const quoteCache = new Map();
/** Yahoo v7 quotes (50 per request, kept 10 minutes): price, currencies, TTM and forward EPS, rating. */
export async function quotes(symbols) {
  const out = {};
  const need = [];
  for (const s of new Set(symbols)) {
    const c = quoteCache.get(s);
    if (c && Date.now() - c.at < 10 * 60e3) out[s] = c.q;
    else need.push(s);
  }
  for (let i = 0; i < need.length; i += 50) {
    const part = need.slice(i, i + 50);
    try {
      const j = await yahooFetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(part.join(","))}`);
      for (const q of j?.quoteResponse?.result || []) {
        const v = {
          price: q.regularMarketPrice ?? null,
          currency: q.currency || null,
          financialCurrency: q.financialCurrency || null,
          epsTtm: q.epsTrailingTwelveMonths ?? null,
          epsForward: q.epsForward ?? null,
          rating: q.averageAnalystRating || null,
          marketCap: q.marketCap ?? null,
          name: String(q.longName || q.shortName || "").replace(/\s{2,}.*$/, "").trim(),
          type: q.quoteType || null,
        };
        quoteCache.set(q.symbol, { at: Date.now(), q: v });
        out[q.symbol] = v;
      }
    } catch {
      /* missing quotes fall back to the last monthly close */
    }
  }
  return out;
}

/** Price units per unit of the reporting currency (GBp, ZAc, ILA quote in minor units). 1 when equal. */
export async function fxRate(from, to) {
  if (!from || !to) return 1;
  const minor = { GBp: ["GBP", 100], GBX: ["GBP", 100], ZAc: ["ZAR", 100], ILA: ["ILS", 100] }[to];
  const [major, mult] = minor || [to, 1];
  if (from === major) return mult;
  const pair = `${from}${major}=X`;
  const q = await quotes([pair]);
  const r = q[pair]?.price;
  if (!(r > 0)) throw new Error(`No exchange rate ${from} to ${major}`);
  return r * mult;
}

/** Yahoo quoteSummary modules for the FV page (analysts, profile), kept a day on disk. */
export const loadProfile = (t) =>
  diskCached(t, "profile", DAY, async () => {
    const j = await yahooFetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t)}?modules=assetProfile,financialData,earningsTrend,recommendationTrend,defaultKeyStatistics`);
    const r = j?.quoteSummary?.result?.[0] || {};
    const f = r.financialData || {};
    const trend = (r.earningsTrend?.trend || []).map((x) => ({
      period: x.period,
      end: x.endDate || null,
      growth: x.growth?.raw ?? null,
      eps: x.earningsEstimate?.avg?.raw ?? null,
      low: x.earningsEstimate?.low?.raw ?? null,
      high: x.earningsEstimate?.high?.raw ?? null,
      analysts: x.earningsEstimate?.numberOfAnalysts?.raw ?? null,
    }));
    const rec = r.recommendationTrend?.trend?.[0] || null;
    return {
      sector: r.assetProfile?.sector || null,
      industry: r.assetProfile?.industry || null,
      country: r.assetProfile?.country || null,
      beta: r.defaultKeyStatistics?.beta?.raw ?? null,
      target: { mean: f.targetMeanPrice?.raw ?? null, high: f.targetHighPrice?.raw ?? null, low: f.targetLowPrice?.raw ?? null, analysts: f.numberOfAnalystOpinions?.raw ?? null, key: f.recommendationKey || null },
      recommendations: rec ? { strongBuy: rec.strongBuy, buy: rec.buy, hold: rec.hold, sell: rec.sell, strongSell: rec.strongSell } : null,
      trend,
    };
  });
