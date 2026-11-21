import "./helpers/isolate-data.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  regressionGrowth, cagr, multipleHistory, normalMultiple, dividendStats, regularDividends, yieldTheory,
  expectedReturn, pickGrowth, fadeGrowth, piotroski, altmanZ, quality, valuationBacktest, analyse, LONG_RUN_GROWTH,
} from "../lib/valuation.js";
import { extractSec, parseYahooSeries, parseChart, splitFactorAfter } from "../lib/fundamentals.js";
import { watchTickers, fvUniverse } from "../lib/fn/fvscan.js";
import { filterRows, FILTERS } from "../public/js/fn/fv.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const month = (y, m) => Date.UTC(y, m - 1, 28) / 1000;

test("growth fit: steady growth exactly, one odd year does not tilt it, losses give null", () => {
  const v = [1, 1.1, 1.21, 1.331, 1.4641, 1.61051];
  near(regressionGrowth(v), 10);
  const odd = [...v];
  odd[1] = 0.2; // a write-off year
  near(regressionGrowth(odd), 10, 1e-9);
  assert.equal(regressionGrowth([1, -1, 2, -3, 3, 4]), null);
  assert.equal(regressionGrowth([1, 2, 3]), null);
  near(cagr(100, 200, 1), 100);
  assert.equal(cagr(-1, 2, 3), null);
});

test("normal P/E is point in time: a month only sees annual figures filed by then", () => {
  const years = [
    { end: "2020-12-31", filed: "2021-02-15", eps: 2 },
    { end: "2021-12-31", filed: "2022-02-15", eps: 4 },
  ];
  const months = [month(2021, 1), month(2021, 3), month(2022, 1), month(2022, 3)].map((time) => ({ time, close: 40 }));
  const h = multipleHistory(years, months);
  assert.deepEqual(h.map((x) => x.pe), [null, 20, 20, 10]);
  const many = Array.from({ length: 24 }, (_, i) => ({ time: month(2023, 1) + i * 2629800, close: i < 12 ? 20 : 30 }));
  const nm = normalMultiple(multipleHistory([{ end: "2021-12-31", filed: "2022-02-01", eps: 2 }], many));
  near(nm.value, 12.5); // median of 12 x 10 and 12 x 15
  assert.equal(nm.months, 24);
  assert.equal(normalMultiple(h).value, null); // fewer than 12 months
});

test("dividends: streak of raises by the highest payment a year, stray doubles and specials dropped", () => {
  const divs = [];
  for (let y = 2000; y <= 2025; y++) for (const m of ["03", "06", "09", "12"]) divs.push({ date: `${y}-${m}-15`, amount: 0.1 + (y - 2000) * 0.01 });
  divs.push({ date: "2010-06-16", amount: 0.4 }); // Yahoo's double record (2x the payment)
  const s = dividendStats(divs, "2026-11-17");
  assert.equal(s.raisedYears, 25);
  assert.equal(s.paidYears, 26);
  assert.equal(s.category, "Champion");
  near(s.annual, 0.35); // within the last 12 months only the December 2025 payment
  assert.equal(regularDividends(divs).length, divs.length - 1);
  const flat = divs.filter((d) => d.date < "2026").map((d) => (d.date.startsWith("2024") ? { ...d, amount: 0.33 } : d));
  // 2024 at 0.33 below 2023's 0.33? equal: no raise in 2024, so the streak is 1 (2025)
  assert.equal(dividendStats(flat, "2026-01-10").raisedYears, 1);
});

test("expected return: growth, re-rating and dividends over 5 years", () => {
  // no growth, no re-rating, no dividend: 0
  near(expectedReturn({ price: 100, basis: 5, g: 0, exitPe: 20 }), 0);
  // P/E from 20 to 10 halves the price over 5 years
  near(expectedReturn({ price: 100, basis: 5, g: 0, exitPe: 10 }), (0.5 ** 0.2 - 1) * 100);
  // 10% growth at a constant P/E is 10% a year
  near(expectedReturn({ price: 100, basis: 5, g: 10, exitPe: 20 }), 10);
  assert.ok(expectedReturn({ price: 100, basis: 5, g: 0, exitPe: 20, dividend: 3 }) > 2.5);
  assert.equal(expectedReturn({ price: 100, basis: -1, g: 5, exitPe: 15 }), null);
});

test("growth choice: own history first, analysts faded to the long-run rate, capped", () => {
  assert.equal(pickGrowth({ regression: 8, cagr5: 12, analysts: 30 }).g, 8);
  assert.equal(pickGrowth({ regression: null, cagr5: 40, analysts: 5 }).g, 25);
  const a = pickGrowth({ regression: null, cagr5: null, analysts: 30 });
  near(a.g, fadeGrowth(30));
  assert.ok(a.g > LONG_RUN_GROWTH && a.g < 30);
  assert.equal(pickGrowth({}).g, null);
});

test("Piotroski and Altman from two annual rows", () => {
  const prev = { ni: 80, ocf: 90, assets: 1000, ltDebt: 300, curAssets: 200, curLiab: 150, shares: 100, gp: 400, rev: 1000 };
  const cur = { ni: 100, ocf: 120, assets: 1050, ltDebt: 280, curAssets: 220, curLiab: 150, shares: 99, gp: 450, rev: 1100 };
  const p = piotroski(cur, prev);
  assert.equal(p.score, 9);
  assert.equal(p.known, 9);
  const bad = piotroski({ ...cur, ni: -5, ocf: -1, shares: 120 }, prev);
  assert.ok(bad.score <= 5);
  const z = altmanZ({ ...cur, liab: 500, retained: 300, opInc: 150 }, 2000);
  assert.ok(z.z > 2.99 && z.zone === "safe");
  assert.equal(altmanZ({ assets: 1 }, 1), null);
});

test("quality ratios", () => {
  const q = quality([
    { equity: 400, rev: 900 },
    { ni: 100, equity: 600, rev: 1000, gp: 600, opInc: 200, debt: 400, cash: 100, da: 50, interest: 20, tax: 20, pretax: 100, divPaid: 50, fcf: 100 },
  ]);
  near(q.roePct, 20); // 100 / avg(400, 600)
  near(q.debtToCapitalPct, 40);
  near(q.netDebtEbitda, 300 / 250);
  near(q.interestCover, 10);
  near(q.fcfPayoutPct, 50);
  near(q.roicPct, (200 * 0.8 / 900) * 100);
});

test("SEC company facts: fiscal years, tag switch, first filing date, comparatives restated, split-adjusted EPS", () => {
  const fy = (end, val, filed, start = `${Number(end.slice(0, 4)) - 1}${end.slice(4).replace("12-31", "12-31")}`) => ({ start: `${Number(end.slice(0, 4))}-01-01`, end, val, filed, form: "10-K", fp: "FY" });
  const facts = {
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: [fy("2019-12-31", 900, "2020-02-10")] } },
        RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [fy("2019-12-31", 901, "2020-02-10"), fy("2020-12-31", 1000, "2021-02-10")] } },
        NetIncomeLoss: { units: { USD: [fy("2019-12-31", 90, "2020-02-10"), fy("2020-12-31", 100, "2021-02-10"), fy("2019-12-31", 91, "2021-02-10"), { start: "2020-10-01", end: "2020-12-31", val: 30, filed: "2021-02-10", form: "10-K", fp: "FY" }] } },
        EarningsPerShareDiluted: { units: { "USD/shares": [fy("2019-12-31", 4, "2020-02-10"), fy("2020-12-31", 2.2, "2021-02-10")] } },
        StockholdersEquity: { units: { USD: [{ end: "2020-12-31", val: 500, filed: "2021-02-10", form: "10-K", fp: "FY" }] } },
      },
    },
  };
  // a 2:1 split in mid-2020: the 2019 EPS (filed before) halves, 2020 (filed after) stays
  const out = extractSec(facts, [{ date: "2020-08-01", ratio: 2 }]);
  assert.equal(out.years.length, 2);
  const [y19, y20] = out.years;
  assert.equal(y19.rev, 900); // the first tag in the list wins for the year
  assert.equal(y20.rev, 1000); // the newer tag fills the year the old one lacks
  assert.equal(y19.ni, 91); // restated in the later filing
  assert.equal(y19.filed, "2020-02-10"); // but known since the first one
  near(y19.eps, 2);
  near(y20.eps, 2.2);
  assert.equal(y20.equity, 500);
  assert.equal(splitFactorAfter([{ date: "2020-08-01", ratio: 2 }, { date: "2014-06-09", ratio: 7 }], "2014-01-01"), 14);
});

test("Yahoo annual series and monthly chart parsing", () => {
  const ys = parseYahooSeries({
    timeseries: {
      result: [
        { meta: { type: ["annualDilutedEPS"] }, annualDilutedEPS: [{ asOfDate: "2024-12-31", reportedValue: { raw: 2 }, currencyCode: "EUR" }, null] },
        { meta: { type: ["annualNetIncomeCommonStockholders"] }, annualNetIncomeCommonStockholders: [{ asOfDate: "2024-12-31", reportedValue: { raw: 200 }, currencyCode: "EUR" }] },
      ],
    },
  });
  assert.equal(ys.currency, "EUR");
  assert.equal(ys.years[0].eps, 2);
  assert.equal(ys.years[0].filed, "2025-03-16");
  const c = parseChart({ chart: { result: [{ meta: { currency: "USD" }, timestamp: [1, 2], indicators: { quote: [{ close: [10, null] }] }, events: { dividends: { a: { date: 1700000000, amount: 0.5 } }, splits: { b: { date: 1600000000, numerator: 4, denominator: 1 } } } }] } });
  assert.equal(c.months.length, 1);
  assert.equal(c.dividends[0].amount, 0.5);
  assert.equal(c.splits[0].ratio, 4);
});

test("backtest buckets by price vs the normal value known then", () => {
  // P/E alternates 10 and 20 a year at a time; the cheap months are followed by a rise
  const hist = [];
  for (let i = 0; i < 120; i++) {
    const cheap = Math.floor(i / 12) % 2 === 0;
    hist.push({ time: i, iso: `20${String(10 + Math.floor(i / 12)).padStart(2, "0")}-${String((i % 12) + 1).padStart(2, "0")}-28`, price: cheap ? 10 : 20, value: 1, pe: cheap ? 10 : 20 });
  }
  const bt = valuationBacktest(hist, []);
  assert.ok(bt.all.n > 0);
  const deep = bt.buckets.find((b) => b.key === "deep");
  const rich = bt.buckets.find((b) => b.key === "rich");
  assert.ok(deep.n > 0 && rich.n > 0);
  assert.ok(deep.avgPct > rich.avgPct);
});

test("analyse: short history gives no upward re-rating; value label", () => {
  const years = [2021, 2022, 2023, 2024].map((y) => ({ end: `${y}-12-31`, filed: `${y + 1}-02-15`, eps: 5 }));
  const months = Array.from({ length: 40 }, (_, i) => ({ time: Date.UTC(2022, 3 + i, 1) / 1000, close: 150 }));
  const a = analyse({ years, months, divs: [], price: 50, pe: 15, basis: "EPS", today: "2025-08-01", shortHistory: true });
  near(a.normalPe, 30);
  assert.equal(a.value.level, "cheap");
  assert.match(a.value.label, /short history/);
  near(a.exitPe, 10); // today's P/E, not the normal 30
  near(a.fairValue, 75);
  near(a.vsFairPct, (50 / 75 - 1) * 100);
});

test("FVSCAN: watchlist entries to Yahoo tickers, universes, presets", () => {
  assert.deepEqual(watchTickers(["AAPL US EQUITY", "SAP GR EQUITY", "SPX INDEX", "BTC CRYPTO", "EURUSD CURNCY", "AAPL US EQUITY"]), ["AAPL", "SAP.DE"]);
  assert.equal(fvUniverse("DAX").tickers.length, 40);
  assert.ok(fvUniverse("stoxx600").tickers.length > 590);
  assert.throws(() => fvUniverse("FTSE"), (e) => e.status === 400);
  assert.throws(() => fvUniverse("W:NOPE"), (e) => e.status === 400);
  const rows = [
    { t: "A", vsNormalPct: -20, vsFairPct: 10, expectedReturnLow: 12, roe: 20, debtToCapital: 30, fcfDivCover5: 2, raisedYears: 30 },
    { t: "B", vsNormalPct: 30, vsFairPct: -5, expectedReturnLow: 4, roe: 8, debtToCapital: 80, raisedYears: 12 },
  ];
  assert.deepEqual(filterRows(rows, "QUALITY", "RET").map((r) => r.t), ["A"]);
  assert.deepEqual(filterRows(rows, "CHAMP", "RET").map((r) => r.t), ["A"]);
  assert.deepEqual(filterRows(rows, "CONTENDER", "RET").map((r) => r.t), []); // B is not fairly valued
  assert.deepEqual(filterRows(rows, "UNDER", "RET").map((r) => r.t), ["B"]);
  assert.deepEqual(filterRows(rows, "ALL", "NORMAL").map((r) => r.t), ["A", "B"]);
  assert.ok(Object.keys(FILTERS).length >= 14);
});

test("yield theory needs three years of yields", () => {
  const months = Array.from({ length: 48 }, (_, i) => ({ time: Date.UTC(2021, i, 28) / 1000, close: 50 }));
  const divs = Array.from({ length: 20 }, (_, i) => ({ date: new Date(Date.UTC(2020, i * 3, 15)).toISOString().slice(0, 10), amount: 0.5 }));
  const y = yieldTheory(months, divs, 2);
  near(y.avgYieldPct, 4, 0.3);
  assert.equal(yieldTheory(months.slice(0, 20), divs, 2), null);
});

test("analyse: a TTM EPS far above next year's estimate is valued on the estimate", () => {
  const years = [{ end: "2024-12-31", filed: "2025-02-15", eps: 2 }];
  const a = analyse({ years, months: [], divs: [], price: 30, epsTtm: 6, epsForward: 2.2, today: "2025-08-01" });
  assert.equal(a.oneOff, true);
  near(a.now, 2.2);
  const b = analyse({ years, months: [], divs: [], price: 30, epsTtm: 2.5, epsForward: 2.2, today: "2025-08-01" });
  assert.equal(b.oneOff, false);
  near(b.now, 2.5);
});

test("analyse: two loss years in ten mark the earnings erratic; no 5-year CAGR from a loss window", () => {
  const eps = [0.25, 0.67, -27.7, -11.3, 2.61, 0.73];
  const years = eps.map((e, i) => ({ end: `${2020 + i}-12-31`, filed: `${2021 + i}-02-15`, eps: e }));
  const a = analyse({ years, months: [], divs: [], price: 27, epsTtm: 7, today: "2026-08-01" });
  assert.equal(a.erratic, true);
  assert.equal(a.losses, 2);
  assert.equal(a.growth.cagr5, null);
});

test("FVSCAN more filters: set thresholds combine with the preset, missing values fail, flags", async () => {
  const { customTest, cleanCustom, customText } = await import("../public/js/fn/fv.js");
  const rows = [
    { t: "KO", yieldPct: 3, paidYears: 50, raisedYears: 55, roe: 40, financial: false },
    { t: "BAC", yieldPct: 2.3, paidYears: 40, raisedYears: 5, roe: 10, financial: true },
    { t: "AMZN", yieldPct: null, paidYears: 0, raisedYears: 0, roe: 22 },
  ];
  const c = cleanCustom({ payer: "on", minRaised: "10", minYield: "", noFin: false, junk: 5 });
  assert.deepEqual(c, { payer: true, minRaised: 10 });
  assert.deepEqual(rows.filter((r) => customTest(r, c)).map((r) => r.t), ["KO"]);
  assert.deepEqual(rows.filter((r) => customTest(r, { minPaid: 30, noFin: true })).map((r) => r.t), ["KO"]);
  assert.deepEqual(rows.filter((r) => customTest(r, {})).length, 3);
  assert.deepEqual(filterRows(rows, "ALL", "ROE", { payer: true }).map((r) => r.t), ["KO", "BAC"]);
  assert.match(customText(c), /pays a dividend, raised at least 10/);
});

test("FVSCAN presets combine: all chosen must hold, ALL or nothing valid = no preset", async () => {
  const { parseFilters } = await import("../public/js/fn/fv.js");
  assert.deepEqual(parseFilters("quality,champ"), ["QUALITY", "CHAMP"]);
  assert.deepEqual(parseFilters("ALL"), []);
  assert.deepEqual(parseFilters("NOPE+ROE15"), ["ROE15"]);
  const rows = [
    { t: "A", roe: 20, raisedYears: 30, vsNormalPct: -5 },
    { t: "B", roe: 20, raisedYears: 2, vsNormalPct: -5 },
    { t: "C", roe: 5, raisedYears: 30, vsNormalPct: -5 },
  ];
  assert.deepEqual(filterRows(rows, "ROE15,DIV10", "ROE").map((r) => r.t), ["A"]);
  assert.deepEqual(filterRows(rows, ["ROE15"], "ROE").map((r) => r.t).sort(), ["A", "B"]);
  assert.equal(filterRows(rows, "ALL", "ROE").length, 3);
});


test("FVSCAN strategies: valid filter keys and sorts; 'buy now' needs the turn, 'still falling' the opposite", async () => {
  const { STRATEGIES, CUSTOM, SORTS, cleanCustom } = await import("../public/js/fn/fv.js");
  const keys = new Set(CUSTOM.map((c) => c[0]));
  for (const [k, s] of Object.entries(STRATEGIES)) {
    assert.ok(SORTS[s.sort], `${k} sort`);
    assert.ok(s.label && s.tip, `${k} label`);
    for (const f of Object.keys(s.custom)) assert.ok(keys.has(f), `${k}: unknown filter ${f}`);
    assert.deepEqual(cleanCustom(s.custom), s.custom, `${k}: values survive cleanCustom`);
  }
  const mkc = { t: "MKC", yieldPct: 4.3, raisedYears: 38, fcfDivCover5: 1.56, fcfPayoutPct: 65, roe: 14.3, debtToCapital: 41, piotroski: 7, erratic: false, vsNormalPct: -48, rsl: 0.92 };
  const run = (k, r) => filterRows([r], "ALL", STRATEGIES[k].sort, STRATEGIES[k].custom).length;
  assert.equal(run("DIVBUY", mkc), 0);
  assert.equal(run("DIVWATCH", mkc), 1);
  assert.equal(run("DIVBUY", { ...mkc, rsl: 1.04 }), 1);
  assert.equal(run("DIVWATCH", { ...mkc, rsl: 1.04 }), 0);
  assert.equal(run("DIVBUY", { ...mkc, rsl: 1.04, fcfDivCover5: 0.9 }), 0);
});

test("FVSCAN: Yahoo symbols become watchlist codes, table columns sort with empty values last", async () => {
  const { yahooWords, toSecurity, bbgCode } = await import("../public/js/securities.js");
  const code = (t) => bbgCode(toSecurity(yahooWords(t)));
  assert.equal(code("SAP.DE"), "SAP GR EQUITY");
  assert.equal(code("VOD.L"), "VOD LN EQUITY");
  assert.equal(code("AAPL"), "AAPL US EQUITY");
  assert.equal(code("BF-B"), "BF-B US EQUITY");
  // a Yahoo symbol with a dot the terminal has no exchange for stays as it is
  assert.deepEqual(yahooWords("ABC.ZZ"), ["ABC.ZZ"]);
  const { sortRows } = await import("../public/js/ui.js");
  const rows = [{ t: "B", y: 2 }, { t: "A", y: null }, { t: "C", y: 5 }];
  assert.deepEqual(sortRows(rows, { key: "y" }, "desc").map((r) => r.t), ["C", "B", "A"]);
  assert.deepEqual(sortRows(rows, { key: "y" }, "asc").map((r) => r.t), ["B", "C", "A"]);
  assert.deepEqual(sortRows(rows, { key: (r) => r.t }, "asc").map((r) => r.t), ["A", "B", "C"]);
});
