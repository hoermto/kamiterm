// FV: fair value analysis of one stock. FVSCAN: the same numbers for a whole universe, with filters.
//   KO FV · KO FV FCF · SAP.DE FV PE=18 · FVSCAN SPX · FVSCAN NDX FILTER=QUALITY,CHAMP · FVSCAN W:TECH SORT=YIELD
// Fair value = earnings (or free cash flow, or owner earnings) per share x a fair P/E (default 15). The normal
// P/E is the stock's own median over up to 15 years. The expected return assumes 5 years of growth, the P/E
// back at normal (at most 30) and the dividends. Maths on the server: lib/valuation.js, lib/fn/fv.js, lib/fn/fvscan.js.
import { api, esc, num, px, big } from "../api.js";
import { table, sect, tabs, html, lineChart } from "../ui.js";

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const BASES = ["EPS", "FCF", "OE"];
const BASIS_TIPS = { EPS: "Earnings per share (GAAP, diluted)", FCF: "Free cash flow per share", OE: "Owner earnings: free cash flow minus stock-based pay, per share" };
const sgn = (v, d = 1) => (finite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
const p1 = (v, d = 1) => (finite(v) ? `${v.toFixed(d)}%` : "—");
const x1 = (v, d = 1) => (finite(v) ? `${v.toFixed(d)}x` : "—");
// Price against a value: below is cheap (green), above dear (red).
const vsCls = (v) => (finite(v) ? (v <= -10 ? "up" : v > 10 ? "down" : "amber") : "");
const retCls = (v) => (finite(v) ? (v >= 10 ? "up" : v < 5 ? "down" : "amber") : "");
const keys = (args) => Object.fromEntries(args.filter((a) => a.includes("=")).map((a) => { const [k, ...v] = a.split("="); return [k.toLowerCase(), v.join("=")]; }));
const VALUE_CLS = { cheap: "up", fair: "amber", rich: "down", na: "dim" };

async function loadSaved(tool) {
  try { return (await api.get(`/api/settings?tool=${tool}`))?.settings || {}; } catch { return {}; }
}
const saveSettings = (tool, s) => api.put("/api/settings", { tool, settings: { ...s, updatedAt: new Date().toISOString() } }).catch(() => {});

/** A two-column block of label / value rows; values may carry a class and a tooltip. */
function grid(rows) {
  const el = document.createElement("div");
  el.className = "kv";
  el.innerHTML = rows
    .filter(Boolean)
    .map(([k, v, c = "", tip = ""]) => `<div class="k"${tip ? ` title="${esc(tip)}"` : ""}>${esc(k)}</div><div class="v ${c}"${tip ? ` title="${esc(tip)}"` : ""}>${v}</div>`)
    .join("");
  return el;
}
const money = (v, cur) => (finite(v) ? `${px(v)} ${esc(cur || "")}` : "—");
const vsTxt = (v) => (finite(v) ? ` <span class="${vsCls(v)}">(price ${sgn(v)})</span>` : "");

// ---------------- FV ----------------
async function fv(ctx) {
  const saved = await loadSaved("FV");
  const k = keys(ctx.args);
  const basis = ctx.args.map((a) => String(a).toUpperCase()).find((a) => BASES.includes(a)) || k.basis?.toUpperCase() || saved.basis || "EPS";
  const pe = Number(k.pe || saved.pe || 15);
  ctx.el.replaceChildren(html(`<p class="hint">Loading annual figures, prices and dividends (the first time for a stock takes a few seconds)…</p>`));
  const d = await api.fn("fv", { symbol: ctx.sec.id, basis, pe });
  if (!ctx.live()) return;
  saveSettings("FV", { basis, pe });
  const cur = d.currency;
  const go = (b, p) => ctx.go(`${ctx.sec.id} FV ${b}${p !== 15 ? ` PE=${p}` : ""}`);

  const head = html(`<p><b>${esc(d.name)}</b> · ${money(d.price, cur)} · <span class="${VALUE_CLS[d.value.level] || ""}">${esc(d.value.label)}</span>
    <span class="dim">· ${d.dataSource === "sec" ? `SEC 10-K, ${d.years} years` : `Yahoo, ${d.years} years`}${d.profile?.sector ? ` · ${esc(d.profile.sector)}${d.profile.industry ? ` / ${esc(d.profile.industry)}` : ""}` : ""}${d.lastYear ? ` · last fiscal year ${esc(d.lastYear)}` : ""}</span></p>`);
  const bar = tabs(BASES, basis, (b) => go(b, pe));
  for (const b of bar.children) b.title = BASIS_TIPS[b.textContent];
  const peForm = html(`<form class="wform" autocomplete="off" style="display:inline-flex;margin-left:12px"><label>Fair P/E <input name="pe" type="number" min="5" max="40" step="0.5" style="width:56px" value="${esc(pe)}"></label><button type="submit">Apply</button> <button type="button" data-gp>Price chart (GP)</button></form>`);
  peForm.onsubmit = (e) => { e.preventDefault(); go(basis, Number(new FormData(peForm).get("pe")) || 15); };
  peForm.querySelector("[data-gp]").onclick = () => ctx.go(`${ctx.sec.id} GP`);
  const barRow = html(`<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px"></div>`);
  barRow.append(bar, peForm);
  ctx.el.replaceChildren(head, barRow);
  const notes = [...(d.notes || [])];
  if (d.erratic) notes.push(`Erratic earnings: ${d.losses} loss years in the last 10. Fair values and the expected return say little here (FVSCAN leaves it out of the ranking)`);
  if (d.oneOff) notes.push(`TTM EPS ${px(d.ttm)} is more than 1.3 times what analysts expect for next year: probably a one-off gain, so the valuation uses next year's ${px(d.now)}`);
  for (const n of notes) ctx.el.append(html(`<p class="hint amber">${esc(n)}</p>`));

  // --- valuation ---
  const t = d.profile?.target;
  const unit = basis === "EPS" ? "P/E" : basis === "FCF" ? "P/FCF" : "P/OE";
  ctx.el.append(sect(`Valuation · ${d.basisLabel}`), grid([
    [`${basis} now`, money(d.now, cur), "", d.oneOff ? "Analysts' EPS for next year (TTM looks like a one-off)" : basis === "EPS" && d.dataSource === "sec" ? "Trailing 12 months (Yahoo)" : "Last fiscal year"],
    [`${unit} now`, x1(d.currentPe), "", `Price over ${basis} now`],
    [`Fair value (${unit} ${d.pe})`, `${money(d.fairValue, cur)}${vsTxt(d.vsFairPct)}`, "", `${basis} now x ${d.pe}`],
    [`Normal ${unit}`, `${x1(d.normalPe)} <span class="dim">median of ${d.normalMonths} months since ${esc(d.normalFrom || "—")}</span>`, "", "Each month: price over the last annual value published by then"],
    ["Value at normal", `${money(d.normalValue, cur)}${vsTxt(d.vsNormalPct)}`, "", `${basis} now x normal ${unit}`],
    d.fairValueForward != null && [`Forward fair value`, `${money(d.fairValueForward, cur)}${vsTxt(d.vsForwardPct)}`, "", `Analysts' EPS for next year x ${d.pe}`],
    d.yieldTheory && ["Yield theory", `${money(d.yieldTheory.fairValue, cur)}${vsTxt(d.yieldTheory.vsPct)} <span class="dim">at the ${d.yieldTheory.avgYieldPct.toFixed(2)}% average yield of ${Math.round(d.yieldTheory.months / 12)} years</span>`, "", "Today's dividend over the stock's average dividend yield"],
    t?.mean != null && ["Analysts' target", `${money(t.mean, cur)} <span class="dim">(${px(t.low)}-${px(t.high)}, ${t.analysts ?? "?"} analysts${t.key ? `, ${esc(t.key)}` : ""})</span>`, ""],
    d.earningsYield != null && ["Earnings yield", `${p1(d.earningsYield, 2)}${d.bondYield != null ? ` <span class="${d.yieldGap >= 0 ? "up" : "down"}">vs 10-year Treasury ${p1(d.bondYield, 2)} (${sgn(d.yieldGap, 2)})</span>` : ""}`, "", "Earnings over price. Below the bond yield, the stock pays for growth that has to come"],
  ]));

  // --- chart: price vs value lines ---
  const host = html(`<div style="height:320px;position:relative;margin:6px 0"></div>`);
  ctx.el.append(host, html(`<p class="hint"><span style="color:var(--amber)">Price</span> · <span class="up">Fair value (${unit} ${d.pe})</span> · <span style="color:#5aa9ff">Value at the normal ${unit} (${x1(d.normalPe)})</span>. Monthly, with the annual figures as published at the time.</p>`));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const line = (f) => d.lines.filter((r) => finite(r[f])).map((r) => ({ time: r.time, value: r[f] }));
  if (d.lines.length) {
    const c = lineChart(host, [
      { title: "Price", color: css("--amber"), data: line("price") },
      { title: "Fair", color: css("--up"), data: line("fair") },
      { title: "Normal", color: "#5aa9ff", data: line("normal") },
    ]);
    ctx.onCleanup(() => c.remove());
  } else host.replaceChildren(html(`<p class="hint">No annual figures for a chart.</p>`));

  // --- expected return ---
  const g = d.growth;
  ctx.el.append(sect("Expected return over 5 years"), grid([
    ["Growth used", `${p1(g.g)} <span class="dim">${esc(g.source || "no growth rate")}${finite(g.raw) && Math.abs(g.raw - g.g) > 0.05 ? `, ${p1(g.raw)} capped` : ""}</span>`, "", "Capped at -10% and +25% a year"],
    ["At the normal P/E", `<span class="${retCls(d.expectedReturn)}">${p1(d.expectedReturn)} a year</span> <span class="dim">exit ${unit} ${x1(d.exitPe)}${d.shortHistory ? ", short history: no re-rating upward" : ""}</span>`, "", "Growth, the multiple moving to the normal one (at most 30), dividends growing with earnings"],
    ["At the fair P/E", `<span class="${retCls(d.expectedReturnAtFair)}">${p1(d.expectedReturnAtFair)} a year</span> <span class="dim">exit ${unit} ${d.pe}</span>`],
    d.expectedReturnAnalysts != null && ["With analysts' growth", `<span class="${retCls(d.expectedReturnAnalysts)}">${p1(d.expectedReturnAnalysts)} a year</span> <span class="dim">next year ${p1(g.analysts)}, then 6%</span>`],
    ["PEG", finite(d.peg) ? d.peg.toFixed(2) : "—", d.peg != null && d.peg <= 1.5 ? "up" : "", `${unit} over the growth used`],
    [`${basis} growth`, `fit ${p1(g.regression)} · 5 years ${p1(g.cagr5)} · 10 years ${p1(g.cagr10)}`, "", "Fit: median growth between every pair of the last 10 years, so one odd year does not tilt it"],
    ["Revenue growth", `5 years ${p1(d.quality.revGrowth5)} · 10 years ${p1(d.quality.revGrowth10)}`],
  ]));

  // --- quality ---
  const q = d.quality;
  const pf = q.piotroski;
  ctx.el.append(sect(`Quality · fiscal year to ${q.fiscalYearEnd || "—"}`), grid([
    ["Return on equity", p1(q.roePct), q.roePct >= 15 ? "up" : ""],
    ["Return on invested capital", p1(q.roicPct), q.roicPct >= 12 ? "up" : "", "Operating income after tax over equity plus debt minus cash"],
    ["Return on assets", p1(q.roaPct)],
    ["Margins", `gross ${p1(q.grossMarginPct)} · operating ${p1(q.opMarginPct)} · net ${p1(q.netMarginPct)}`],
    ["Debt / capital", p1(q.debtToCapitalPct), q.debtToCapitalPct <= 50 ? "up" : q.debtToCapitalPct > 70 ? "down" : ""],
    ["Net debt / EBITDA", x1(q.netDebtEbitda), q.netDebtEbitda > 3 ? "down" : ""],
    ["Interest cover", x1(q.interestCover), q.interestCover != null && q.interestCover < 3 ? "down" : ""],
    ["Current ratio", finite(q.currentRatio) ? q.currentRatio.toFixed(2) : "—"],
    pf && ["Piotroski F-score", `${pf.score} of 9 <span class="dim">${pf.criteria.map((c) => `${c.ok == null ? "?" : c.ok ? "✓" : "✗"} ${esc(c.name)}`).join(" · ")}</span>`, pf.score >= 7 ? "up" : pf.score <= 3 ? "down" : ""],
    d.altman && ["Altman Z", `${d.altman.z.toFixed(2)} <span class="dim">${esc(d.altman.zone)}</span>`, d.altman.zone === "safe" ? "up" : d.altman.zone === "distress" ? "down" : "amber", "Above 3 safe, below 1.8 distress (industrial companies)"],
  ]));

  // --- dividend ---
  const dv = d.dividend;
  if (dv.annual || dv.paidYears) {
    ctx.el.append(sect("Dividend"), grid([
      ["Annual dividend", `${money(dv.annual, cur)} <span class="dim">${dv.payments12} payments in 12 months</span>`],
      ["Yield", p1(dv.yieldPct, 2)],
      ["Paid / raised", `${dv.paidYears} years paid · ${dv.raisedYears} years raised${dv.category ? ` · <span class="up">${esc(dv.category)}</span>` : ""}`, "", "Raised: the highest regular payment of each calendar year above the year before. Champion 25+, Contender 10-24, Challenger 5-9"],
      ["Dividend growth", `5 years ${p1(dv.growth5)} · 10 years ${p1(dv.growth10)}`],
      ["Payout", `of earnings ${p1(q.payoutPct)} · of free cash flow ${p1(q.fcfPayoutPct)}`, q.fcfPayoutPct > 100 ? "down" : ""],
      ["FCF / dividends, 5 years", x1(q.fcfDivCover5, 2), q.fcfDivCover5 != null ? (q.fcfDivCover5 >= 1 ? "up" : "down") : "", "Free cash flow of the last 5 years over the dividends paid in them"],
    ]));
  }

  // --- momentum ---
  ctx.el.append(sect("Momentum"), grid([
    ["RSL26", finite(d.rsl) ? d.rsl.toFixed(3) : "—", d.rsl > 1 ? "up" : d.rsl != null ? "down" : "", "Price over its 26-week average (Levy). Above 1: the trend is up"],
    ["Below normal and RSL above 1", d.cheapMomentum ? `<span class="up">yes</span>` : "no", "", "Cheap and already turning up: fewer falling knives"],
  ]));

  // --- backtest ---
  const bt = d.backtest;
  if (bt.all.n) {
    ctx.el.append(sect(`Backtest: next 12 months by price vs the normal value · ${bt.all.n} months`),
      table(bt.buckets, [
        { key: "label", label: "Price vs value at the normal P/E then", left: true },
        { key: "n", label: "Months" },
        { key: "avgPct", label: "Avg 12M return", fmt: (v) => sgn(v), cls: (v) => (finite(v) ? (v > 0 ? "up" : "down") : "") },
        { key: "medianPct", label: "Median", fmt: (v) => sgn(v) },
        { key: "winPct", label: "Positive", fmt: (v) => p1(v, 0) },
      ]),
      html(`<p class="hint">All months: average ${sgn(bt.all.avgPct)}, median ${sgn(bt.all.medianPct)}, ${p1(bt.all.winPct, 0)} positive. Each month from the fourth year on: the normal P/E from the months before only, the annual figures as published then; return with dividends, before costs and taxes. Overlapping 12-month windows, so the months are not independent.</p>`));
  }

  // --- annual figures ---
  const fc = d.financialCurrency || cur;
  ctx.el.append(sect(`Annual figures (${esc(fc)}${fc !== cur ? `; per share in ${esc(cur)}` : ""})`), table([...d.annual].reverse(), [
    { key: "end", label: "Year end", left: true },
    { key: "filed", label: "Known from", left: true, title: "First filing with the year (SEC) or 75 days after the year end (Yahoo)" },
    { key: "rev", label: "Revenue", fmt: big },
    { key: "ni", label: "Net income", fmt: big },
    { key: "eps", label: "EPS", fmt: (v) => num(v, 2) },
    { key: "fcfPs", label: "FCF / share", fmt: (v) => num(v, 2) },
    { key: "oePs", label: "Owner earnings / share", fmt: (v) => num(v, 2) },
    { key: "divPaid", label: "Dividends paid", fmt: big },
    { key: "roe", label: "ROE", fmt: (v) => p1(v) },
    { key: "margin", label: "Net margin", fmt: (v) => p1(v) },
    { key: "debt", label: "Debt", fmt: big },
  ]));
  ctx.el.append(html(`<p class="hint">Fair value at a fixed P/E of ${d.pe} ignores growth and interest rates: a P/E of 15 is a 6.7% earnings yield. The stock's own normal P/E is the better yardstick, unless the business has changed. Cyclicals look cheapest at the top of their cycle; banks and real estate need book value and FFO.</p>`));
  ctx.setSource(d.source);
}

// ---------------- FVSCAN ----------------
const UNIS = ["SPX", "NDX", "DAX", "SXXP"];
const CAT_SHORT = { Champion: "Champ", Contender: "Cont", Challenger: "Chall" };
const fair = (r) => finite(r.vsNormalPct) && r.vsNormalPct <= 10;
/** The presets (as in ValueLens' list view), plus cheap with momentum. */
export const FILTERS = {
  ALL: ["All", () => true],
  UNDER: ["Below fair value", (r) => r.vsFairPct < 0],
  NORMAL: ["Below normal P/E", (r) => r.vsNormalPct < 0],
  RET10: ["Return 10%+", (r) => r.expectedReturnLow >= 10],
  DIV10: ["Dividend raised 10y+", (r) => r.raisedYears >= 10],
  ROE15: ["ROE 15%+", (r) => r.roe >= 15],
  DEBT50: ["Debt/capital 50%-", (r) => finite(r.debtToCapital) && r.debtToCapital <= 50],
  FCFDIV: ["FCF covers dividend", (r) => r.fcfDivCover5 >= 1],
  QUALITY: ["Quality", (r) => r.roe >= 15 && finite(r.debtToCapital) && r.debtToCapital <= 50 && (r.fcfDivCover5 == null || r.fcfDivCover5 >= 1) && r.vsNormalPct < 0],
  CHAMP: ["Champions", (r) => r.raisedYears >= 25 && fair(r)],
  CONTENDER: ["Contenders", (r) => r.raisedYears >= 10 && r.raisedYears < 25 && fair(r)],
  CHALLENGER: ["Challengers", (r) => r.raisedYears >= 5 && r.raisedYears < 10 && fair(r)],
  GROWTH: ["Growth", (r) => r.growth >= 10 && fair(r) && r.expectedReturnLow >= 10 && finite(r.peg) && r.peg <= 1.5],
  GROWTHRET: ["Growth 15%+", (r) => r.growth >= 15 && fair(r)],
  CHEAPMOM: ["Cheap + RSL>1", (r) => r.cheapMomentum],
};
export const SORTS = {
  RET: ["Expected return (lower)", (r) => r.expectedReturnLow],
  RETHIST: ["Expected return (history)", (r) => r.expectedReturn],
  NORMAL: ["Cheapest vs normal", (r) => (finite(r.vsNormalPct) ? -r.vsNormalPct : null)],
  FAIR: ["Cheapest vs fair value", (r) => (finite(r.vsFairPct) ? -r.vsFairPct : null)],
  YIELD: ["Dividend yield", (r) => r.yieldPct],
  RAISED: ["Years raised", (r) => r.raisedYears],
  ROE: ["ROE", (r) => r.roe],
  RSL: ["RSL26", (r) => r.rsl],
  F: ["Piotroski", (r) => r.piotroski],
};
/**
 * "More filters": thresholds on top of the preset, all that are set must hold (a stock without the value fails).
 * [key, label, kind (min | max | bool), value]. Also on the command line: FVSCAN SPX MINRAISED=10 PAYER=1.
 */
export const CUSTOM = [
  ["payer", "Pays a dividend", "bool", (r) => r.yieldPct > 0, "Dividend"],
  ["minPaid", "Paid at least (years)", "min", (r) => r.paidYears, "Dividend"],
  ["minRaised", "Raised at least (years in a row)", "min", (r) => r.raisedYears, "Dividend"],
  ["minYield", "Yield at least (%)", "min", (r) => r.yieldPct, "Dividend"],
  ["maxYield", "Yield at most (%)", "max", (r) => r.yieldPct, "Dividend"],
  ["minDivGrowth", "Dividend growth 5y at least (%)", "min", (r) => r.divGrowth5, "Dividend"],
  ["maxPayout", "Payout of earnings at most (%)", "max", (r) => r.payoutPct, "Dividend"],
  ["maxFcfPayout", "Payout of FCF at most (%)", "max", (r) => r.fcfPayoutPct, "Dividend"],
  ["minFcfCover", "FCF / dividends 5y at least (x)", "min", (r) => r.fcfDivCover5, "Dividend"],
  ["maxPe", "P/E at most", "max", (r) => r.pe, "Valuation"],
  ["maxVsNormal", "vs normal at most (%)", "max", (r) => r.vsNormalPct, "Valuation"],
  ["maxVsFair", "vs fair value at most (%)", "max", (r) => r.vsFairPct, "Valuation"],
  ["minRet", "Exp. return at least (%)", "min", (r) => r.expectedReturnLow, "Valuation"],
  ["minGrowth", "Growth at least (%)", "min", (r) => r.growth, "Valuation"],
  ["maxPeg", "PEG at most", "max", (r) => r.peg, "Valuation"],
  ["minRoe", "ROE at least (%)", "min", (r) => r.roe, "Quality"],
  ["minRoic", "ROIC at least (%)", "min", (r) => r.roic, "Quality"],
  ["minMargin", "Net margin at least (%)", "min", (r) => r.margin, "Quality"],
  ["maxDebt", "Debt / capital at most (%)", "max", (r) => r.debtToCapital, "Quality"],
  ["minF", "Piotroski at least (0-9)", "min", (r) => r.piotroski, "Quality"],
  ["minRsl", "RSL26 at least", "min", (r) => r.rsl, "Momentum"],
  ["maxRsl", "RSL26 at most", "max", (r) => r.rsl, "Momentum"],
  ["noFin", "No banks, insurers, real estate", "bool", (r) => !r.financial, "Exclude"],
  ["noErratic", "No erratic earnings", "bool", (r) => !r.erratic, "Exclude"],
  ["noShort", "No short history (Yahoo, 4 years)", "bool", (r) => !r.shortHistory, "Exclude"],
];
/** Only the set entries of a custom filter object (numbers as numbers, flags as true). */
export function cleanCustom(c = {}) {
  const out = {};
  for (const [key, , kind] of CUSTOM) {
    const v = c[key];
    if (kind === "bool") { if (v === true || v === 1 || v === "1" || v === "on" || v === "true") out[key] = true; }
    else if (v !== "" && v != null && Number.isFinite(Number(v))) out[key] = Number(v);
  }
  return out;
}
export function customTest(r, c = {}) {
  for (const [key, , kind, get] of CUSTOM) {
    if (c[key] == null) continue;
    const v = get(r);
    if (kind === "bool" ? !v : !finite(v) || (kind === "min" ? v < c[key] : v > c[key])) return false;
  }
  return true;
}
export const customText = (c = {}) =>
  CUSTOM.filter(([key]) => c[key] != null).map(([key, label, kind]) => (kind === "bool" ? label.toLowerCase() : `${label.replace(/ \(.*\)$/, "").toLowerCase()} ${c[key]}`)).join(", ");

/**
 * Strategies: a whole screen in one click (More filters + sort; the preset tabs go to All). The user can change
 * any filter afterwards; then it is "own filters". Thresholds checked against an S&P 500 scan (Nov 2026).
 */
const QUALITY_DIV = { payer: true, minRaised: 10, minYield: 2, minFcfCover: 1.2, maxFcfPayout: 80, minRoe: 12, maxDebt: 65, minF: 5, noErratic: true };
export const STRATEGIES = {
  DIVBUY: {
    label: "Dividend quality, buy now",
    tip: "Raised the dividend 10+ years, yield 2%+, covered 1.2x by free cash flow (payout up to 80%), ROE 12%+, debt/capital up to 65%, Piotroski 5+, steady earnings; at least 10% below its normal value AND the trend has turned up (RSL26 1+).",
    custom: { ...QUALITY_DIV, maxVsNormal: -10, minRsl: 1 },
    sort: "RET",
  },
  DIVWATCH: {
    label: "Dividend quality, cheap, still falling",
    tip: "Same quality as 'buy now' and at least 10% below the normal value, but still in a downtrend (RSL26 below 1): a watchlist, buy when the trend turns or in steps.",
    custom: { ...QUALITY_DIV, maxVsNormal: -10, maxRsl: 0.9999 },
    sort: "NORMAL",
  },
  DIVGROW: {
    label: "Dividend growers",
    tip: "Yield 1%+, raised 5+ years, dividend up 7%+ a year over 5 years, payout up to 60% of earnings, FCF covers it 1.3x, ROE 15%+, at most 10% above the normal value.",
    custom: { payer: true, minYield: 1, minRaised: 5, minDivGrowth: 7, maxPayout: 60, minFcfCover: 1.3, minRoe: 15, maxVsNormal: 10, noErratic: true },
    sort: "RET",
  },
  HIGHYIELD: {
    label: "High yield, covered",
    tip: "Yield 4%+, raised 5+ years, FCF covers it 1.2x (payout up to 80%), debt/capital up to 65%, steady earnings. High yields are often a warning: check the FV page.",
    custom: { payer: true, minYield: 4, minRaised: 5, minFcfCover: 1.2, maxFcfPayout: 80, maxDebt: 65, noErratic: true },
    sort: "YIELD",
  },
  QUALFAIR: {
    label: "Quality at a fair price",
    tip: "ROE 15%+, ROIC 12%+, net margin 10%+, debt/capital up to 50%, Piotroski 6+, steady earnings, at or below the normal value, expected return 8%+. With or without a dividend.",
    custom: { minRoe: 15, minRoic: 12, minMargin: 10, maxDebt: 50, minF: 6, maxVsNormal: 0, minRet: 8, noErratic: true },
    sort: "RET",
  },
  GARP: {
    label: "Growth at a reasonable price",
    tip: "Earnings growth 10%+, PEG up to 1.5, ROE 15%+, Piotroski 6+, at most 10% above the normal value, expected return 12%+, steady earnings.",
    custom: { minGrowth: 10, maxPeg: 1.5, minRoe: 15, minF: 6, maxVsNormal: 10, minRet: 12, noErratic: true },
    sort: "RET",
  },
  DEEPVALUE: {
    label: "Deep value, sound balance",
    tip: "P/E at or below the fair 15, at least 25% below the normal value, expected return 8%+, Piotroski 6+, debt/capital up to 60%, steady earnings, no banks. Cheap for a reason more often than not: read the FV page.",
    custom: { maxVsFair: 0, maxVsNormal: -25, minRet: 8, minF: 6, maxDebt: 60, noErratic: true, noFin: true },
    sort: "NORMAL",
  },
  TURN: {
    label: "Turnaround: cheap and turning",
    tip: "At least 20% below the normal value, RSL26 between 1.00 and 1.10 (just turned up), expected return 8%+, Piotroski 5+, steady earnings.",
    custom: { maxVsNormal: -20, minRsl: 1, maxRsl: 1.1, minRet: 8, minF: 5, noErratic: true },
    sort: "NORMAL",
  },
  TREND: {
    label: "Quality in an uptrend",
    tip: "ROE 15%+, Piotroski 6+, steady earnings, RSL26 1.05+ (rising), at most 20% above the normal value, expected return 8%+.",
    custom: { minRoe: 15, minF: 6, minRsl: 1.05, maxVsNormal: 20, minRet: 8, noErratic: true },
    sort: "RSL",
  },
};

/** What each preset tab checks (tooltip and Guide). */
const FILTER_TIPS = {
  ALL: "No preset: every stock (More filters and strategies still apply). Clears the other tabs.",
  UNDER: "Price below the basis x fair P/E (default 15).",
  NORMAL: "Price below the value at the stock's own normal P/E (median of 15 years).",
  RET10: "Expected return 10%+ a year over 5 years (the lower of own and analysts' growth).",
  DIV10: "Dividend raised 10 or more years in a row.",
  ROE15: "Return on equity 15%+.",
  DEBT50: "Debt at most 50% of capital (debt + equity).",
  FCFDIV: "Free cash flow of the last 5 years at least as large as the dividends paid.",
  QUALITY: "ROE 15%+, debt/capital up to 50%, FCF covers the dividend (if any) and below the normal value.",
  CHAMP: "Dividend raised 25+ years, at most 10% above the normal value.",
  CONTENDER: "Dividend raised 10-24 years, at most 10% above the normal value.",
  CHALLENGER: "Dividend raised 5-9 years, at most 10% above the normal value.",
  GROWTH: "Growth 10%+, PEG up to 1.5, expected return 10%+, at most 10% above the normal value.",
  GROWTHRET: "Growth 15%+, at most 10% above the normal value.",
  CHEAPMOM: "Below the normal value and RSL26 above 1 (the price is above its 26-week average).",
};

/** The terms the screen uses, for the Guide. */
const TERMS = [
  ["Fair value", "Basis (EPS, FCF or owner earnings per share) x the fair P/E, 15 by default. A fixed yardstick, the same for every stock."],
  ["Normal P/E / normal value", "Median of the stock's own monthly P/E over up to 15 years, as known at the time; normal value = basis x normal P/E. * = short history (Yahoo, 4 years): treat with care."],
  ["vs normal / vs fair", "How far the price is above (+) or below (-) that value. -20% = 20% cheaper than usual."],
  ["Exp. return", "Return a year over 5 years: earnings grow at the stock's own past rate or the analysts' rate (whichever is lower), the P/E moves to its normal level (at most 30), plus dividends. Empty for erratic earnings."],
  ["Growth / PEG", "Earnings growth fitted over up to 10 years (else analysts', faded to 6%), capped -10..25%. PEG = P/E / growth; below 1.5 is reasonable."],
  ["Years raised", "Dividend raised every calendar year in a row (specials ignored). Champ 25+, Cont 10-24, Chall 5-9."],
  ["Payout / FCF/div 5y", "Share of earnings or free cash flow paid out; FCF/div = free cash flow of 5 years over dividends of 5 years (1.2x+ = safely covered)."],
  ["ROE, ROIC, Debt/capital", "Return on equity and on invested capital (15%+ is strong); debt as a share of debt + equity (above 70% is red)."],
  ["F (Piotroski)", "0-9 points for profit, cash flow, falling debt, liquidity, no dilution, margin and turnover improving. 7+ strong, 3- weak."],
  ["RSL26", "Price over its 26-week average (Levy). Above 1 = uptrend, below 1 = still falling. Cheap and RSL above 1 = the turn may be in."],
  ["Note column", "fin = bank/insurer/real estate (P/E and FCF say less); one-off = TTM EPS far above next year's estimate, valued on the estimate; erratic = 2+ loss years in 10."],
];

/** Collapsible guide: how to use the screen, strategies (with a Use button), presets and terms. Open state kept per browser. */
function guideBlock(onStrategy) {
  const KEY = "amber.fvscan.guide";
  const row = (k, v, extra = "") => `<tr><th style="text-align:left;vertical-align:top;padding:3px 10px 3px 0;white-space:nowrap">${esc(k)}${extra}</th><td style="padding:3px 0">${esc(v)}</td></tr>`;
  const h = (t) => `<div style="margin:10px 0 4px;color:var(--amber);font-weight:600">${esc(t)}</div>`;
  const el = html(`<details class="fv-guide" style="margin:4px 0"><summary style="cursor:pointer">Guide: strategies, presets, terms</summary>
    <div style="margin:4px 0 8px;padding:6px 10px;border:1px solid var(--line);max-width:1000px;font-size:13px">
      ${h("How to use")}
      <p style="margin:2px 0">1. Pick a universe (S&amp;P 500, Nasdaq-100, DAX, STOXX 600 or a watchlist). 2. Pick a strategy, or combine preset tabs and More filters yourself. 3. Click a row for the FV page: check the notes, the chart and the backtest before buying.
      A strategy sets More filters and the sort; changing anything afterwards makes it "own filters". Preset tabs combine: every one chosen must hold.</p>
      ${h("Strategies")}
      <table style="border-collapse:collapse">${Object.entries(STRATEGIES).map(([key, s]) => row(s.label, s.tip, ` <button type="button" data-use="${key}" title="Apply this strategy">Use</button>`)).join("")}</table>
      ${h("Presets (tabs)")}
      <table style="border-collapse:collapse">${Object.keys(FILTERS).map((k) => row(FILTERS[k][0], FILTER_TIPS[k] || "")).join("")}</table>
      ${h("Columns and terms")}
      <table style="border-collapse:collapse">${TERMS.map(([k, v]) => row(k, v)).join("")}</table>
      ${h("Keep in mind")}
      <p style="margin:2px 0">The numbers are a screen, not a verdict: a stock far below its normal P/E is often cheap for a reason (falling earnings, debt, a changed business). US figures come from SEC 10-K filings (up to 20 years); European ones from Yahoo (4 years), so their normal P/E and growth rest on little history. Strategy results change with prices, especially the trend condition.</p>
    </div></details>`);
  try { el.open = localStorage.getItem(KEY) === "1"; } catch {}
  el.addEventListener("toggle", () => { try { localStorage.setItem(KEY, el.open ? "1" : "0"); } catch {} });
  for (const b of el.querySelectorAll("[data-use]")) b.onclick = () => onStrategy(b.dataset.use);
  return el;
}

/** Presets to combine: "QUALITY,CHAMP" or an array -> the valid keys (none = ALL). */
export const parseFilters = (f) =>
  [...new Set((Array.isArray(f) ? f : String(f || "").split(/[,+]/)).map((x) => String(x).trim().toUpperCase()))].filter((x) => FILTERS[x] && x !== "ALL");
const filterLabel = (f) => parseFilters(f).map((k) => FILTERS[k][0]).join(" + ") || "All";

export function filterRows(rows, filter, sort, custom = {}) {
  const fs = parseFilters(filter).map((k) => FILTERS[k][1]);
  const f = (r) => fs.every((t) => t(r));
  const s = (SORTS[sort] || SORTS.RET)[1];
  return rows.filter((r) => f(r) && customTest(r, custom)).sort((a, b) => (s(b) ?? -1e9) - (s(a) ?? -1e9));
}

/** The "More filters" panel: one field per CUSTOM entry, grouped; Apply and Clear filter without a new scan. */
function moreFilters(v, onChange) {
  const groups = [...new Set(CUSTOM.map((c) => c[4]))];
  const field = ([key, label, kind]) =>
    kind === "bool"
      ? `<label><input type="checkbox" name="${key}"${v.custom[key] ? " checked" : ""}> ${esc(label)}</label>`
      : `<label>${esc(label)} <input name="${key}" type="number" step="any" style="width:64px" value="${v.custom[key] ?? ""}"></label>`;
  const el = html(`<details class="fv-more" style="margin:4px 0"${Object.keys(v.custom).length ? " open" : ""}><summary style="cursor:pointer">More filters</summary>
    <form class="wform" autocomplete="off" style="flex-direction:column;align-items:flex-start;gap:4px">
      ${groups.map((g) => `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><b style="min-width:80px">${esc(g)}</b>${CUSTOM.filter((c) => c[4] === g).map(field).join("")}</div>`).join("")}
      <div><button type="submit">Apply</button> <button type="button" data-clear>Clear</button></div>
    </form></details>`);
  const f = el.querySelector("form");
  f.onsubmit = (e) => {
    e.preventDefault();
    const raw = {};
    for (const [key, , kind] of CUSTOM) raw[key] = kind === "bool" ? f[key].checked : f[key].value;
    v.custom = cleanCustom(raw);
    onChange();
  };
  el.querySelector("[data-clear]").onclick = () => {
    f.reset();
    for (const [key, , kind] of CUSTOM) if (kind === "bool") f[key].checked = false; else f[key].value = "";
    v.custom = {};
    onChange();
  };
  return el;
}

let scanMemo = null;
let forceFresh = false; // Rescan button: next run skips both caches without putting FRESH into the command
async function fvscan(ctx) {
  const saved = await loadSaved("FVSCAN");
  const k = keys(ctx.args);
  const word = ctx.args.map((a) => String(a).toUpperCase()).find((a) => UNIS.includes(a) || /^W:/.test(a));
  const v = {
    universe: word || saved.universe || "SPX",
    basis: (k.basis || saved.basis || "EPS").toUpperCase(),
    pe: Number(k.pe || saved.pe || 15),
    filter: (k.filter || saved.filter || "ALL").toUpperCase(),
    sort: (k.sort || saved.sort || "RET").toUpperCase(),
  };
  // more filters: saved ones, overridden by the command line (MINRAISED=10 PAYER=1, CLEAR=1 drops them)
  const cli = Object.fromEntries(CUSTOM.filter(([key]) => k[key.toLowerCase()] != null).map(([key]) => [key, k[key.toLowerCase()]]));
  v.custom = cleanCustom(k.clear === "1" ? cli : { ...(saved.custom || {}), ...cli });
  v.filter = parseFilters(v.filter).join(",") || "ALL";
  if (!SORTS[v.sort]) v.sort = "RET";
  // STRATEGY=DIVBUY on the command line sets the whole screen; a saved strategy name is shown until changed.
  const applyStrategy = (key) => {
    const s = STRATEGIES[key];
    if (!s) return false;
    Object.assign(v, { strategy: key, filter: "ALL", custom: cleanCustom(s.custom), sort: s.sort });
    return true;
  };
  v.strategy = STRATEGIES[saved.strategy] ? saved.strategy : "";
  if (k.strategy) applyStrategy(k.strategy.toUpperCase());
  // Filters, sort and strategy live in the saved settings, not in the command: the panel history (ESC back from FV,
  // restore at start) then shows the screen as last left, not as first typed.
  const cmd = (o) => { const x = { ...v, ...o }; return `FVSCAN ${x.universe} BASIS=${x.basis} PE=${x.pe}`; };
  saveSettings("FVSCAN", v);
  ctx.el.replaceChildren(html(`<p class="hint">Scanning ${esc(v.universe)}: annual figures, prices and dividends per stock. The first scan of a universe can take a few minutes; what is not done keeps loading in the background.</p>`));
  // The server keeps a finished scan 15 minutes; the page keeps the last one too, so ESC back from FV is instant.
  const memoKey = `${v.universe}|${v.basis}|${v.pe}`;
  const fresh = k.fresh === "1" || forceFresh;
  forceFresh = false;
  const d = !fresh && scanMemo?.key === memoKey && Date.now() - scanMemo.at < 15 * 60e3
    ? scanMemo.d
    : await api.fn("fvscan", { universe: v.universe, basis: v.basis, pe: v.pe, fresh: fresh ? 1 : undefined });
  if (!d.coverage.loading && !d.coverage.partial && scanMemo?.d !== d) scanMemo = { key: memoKey, at: d.cachedAt || Date.now(), d };
  if (!ctx.live()) return;
  v.universe = d.universe;
  saveSettings("FVSCAN", v);
  ctx.setCmd(cmd({}));

  const uniTabs = tabs([...UNIS, ...(d.lists || []).map((l) => `W:${l}`)], d.universe, (u) => ctx.go(cmd({ universe: u })));
  for (const b of uniTabs.children) b.title = d.universes?.[b.textContent] || `Watchlist ${b.textContent.slice(2)}`;
  // Presets combine: a click adds or removes one (all chosen must hold), All clears them.
  const filterTabs = tabs(Object.keys(FILTERS), null, (f) => {
    const on = parseFilters(v.filter);
    v.filter = f === "ALL" ? "ALL" : (on.includes(f) ? on.filter((x) => x !== f) : [...on, f]).join(",") || "ALL";
    ownFilters();
    saveSettings("FVSCAN", v);
    draw();
    markTabs();
  });
  for (const b of filterTabs.children) { b.title = FILTER_TIPS[b.textContent] || FILTERS[b.textContent][0]; b.textContent = FILTERS[b.textContent][0]; }
  const filterKeys = Object.keys(FILTERS);
  const markTabs = () => {
    const on = parseFilters(v.filter);
    [...filterTabs.children].forEach((b, i) => b.classList.toggle("on", filterKeys[i] === "ALL" ? !on.length : on.includes(filterKeys[i])));
  };
  markTabs();
  const form = html(`<form class="wform" autocomplete="off">
    <label>Basis <select name="basis">${BASES.map((b) => `<option value="${b}"${b === v.basis ? " selected" : ""} title="${esc(BASIS_TIPS[b])}">${b}</option>`).join("")}</select></label>
    <label>Fair P/E <input name="pe" type="number" min="5" max="40" step="0.5" style="width:56px" value="${esc(v.pe)}"></label>
    <button type="submit">Scan</button>
    <label>Sort <select name="sort">${Object.entries(SORTS).map(([key, [lab]]) => `<option value="${key}"${key === v.sort ? " selected" : ""}>${esc(lab)}</option>`).join("")}</select></label>
  </form>`);
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const o = { basis: f.get("basis"), pe: Number(f.get("pe")) || 15 };
    if (o.basis === v.basis && o.pe === v.pe) forceFresh = true; // Scan with the same settings = scan again
    ctx.go(cmd(o));
  };
  form.sort.onchange = () => { v.sort = form.sort.value; ownFilters(); saveSettings("FVSCAN", v); draw(); };
  // Strategy picker: sets More filters and sort, clears the preset tabs; any manual change makes it "own filters".
  const strat = html(`<form class="wform" autocomplete="off"><label>Strategy <select name="s"><option value="">— own filters —</option>${Object.entries(STRATEGIES).map(([key, s]) => `<option value="${key}"${key === v.strategy ? " selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label> <span class="hint" data-tip></span></form>`);
  const showTip = () => { strat.querySelector("[data-tip]").textContent = STRATEGIES[v.strategy]?.tip || ""; strat.s.value = v.strategy || ""; };
  function ownFilters() { if (v.strategy) { v.strategy = ""; showTip(); } }
  strat.s.onchange = () => {
    if (!applyStrategy(strat.s.value)) { v.strategy = ""; showTip(); saveSettings("FVSCAN", v); return; }
    const fresh = moreFilters(v, onMore);
    more.replaceWith(fresh);
    more = fresh;
    form.sort.value = v.sort;
    markTabs();
    showTip();
    saveSettings("FVSCAN", v);
    draw();
  };
  showTip();
  const c = d.coverage;
  const info = html(`<p class="hint">${esc(d.label)} · ${c.loaded} of ${c.stocks} stocks${c.loading ? ` · <span class="amber">${c.loading} still loading in the background: scan again in a few minutes</span>` : ""}${d.errors.length ? ` · ${d.errors.length} without data` : ""} · basis ${esc(d.basis)}, fair P/E ${d.pe} · as of ${new Date(scanMemo?.d === d ? scanMemo.at : d.cachedAt || Date.now()).toTimeString().slice(0, 5)} <button type="button" data-rescan title="Scan again with fresh prices (results are kept 15 minutes)">Rescan</button></p>`);
  if (d.errors.length) info.title = d.errors.map((e) => `${e.ticker}: ${e.error}`).join("\n");
  info.querySelector("[data-rescan]").onclick = () => { forceFresh = true; scanMemo = null; ctx.go(cmd({})); };
  const out = document.createElement("div");
  const onMore = () => { ownFilters(); saveSettings("FVSCAN", v); draw(); };
  let more = moreFilters(v, onMore);
  const guide = guideBlock((key) => { strat.s.value = key; strat.s.onchange(); strat.scrollIntoView({ block: "nearest" }); });
  ctx.el.replaceChildren(sect(`FV scanner · ${d.label}`), uniTabs, strat, filterTabs, form, more, guide, info, out);

  function draw() {
    const rows = filterRows(d.rows, v.filter, v.sort, v.custom);
    const extra = customText(v.custom);
    const what = v.strategy ? `strategy "${esc(STRATEGIES[v.strategy].label)}"` : `${esc(filterLabel(v.filter))}${extra ? ` + ${esc(extra)}` : ""}`;
    more.querySelector("summary").textContent = `More filters${Object.keys(v.custom).length ? ` (${Object.keys(v.custom).length} on)` : ""}`;
    out.replaceChildren();
    if (!rows.length) { out.append(html(`<p class="hint">No stock passes ${what}.</p>`)); return; }
    out.append(html(`<p class="hint">${rows.length} stocks · ${what} · sorted by ${esc(SORTS[v.sort][0].toLowerCase())}</p>`), table(rows, [
      { key: "t", label: "Ticker", left: true, lbl: true },
      { key: "name", label: "Name", left: true, fmt: (x) => String(x || "").slice(0, 26) },
      { key: "price", label: "Price", fmt: (x, r) => `${px(x)} ${r.currency || ""}` },
      { key: "pe", label: "P/E", fmt: (x) => x1(x), title: "Price over the basis now" },
      { key: "normalPe", label: "Normal\nP/E", fmt: (x, r) => `${x1(x)}${r.shortHistory ? "*" : ""}`, title: "Median monthly P/E over up to 15 years; * = short history (Yahoo, 4 years)" },
      { key: "vsNormalPct", label: "vs\nnormal", fmt: (x) => sgn(x, 0), cls: vsCls, title: "Price against the value at the normal P/E" },
      { key: "vsFairPct", label: "vs fair\nvalue", fmt: (x) => sgn(x, 0), cls: vsCls, title: `Price against the basis x ${d.pe}` },
      { key: "expectedReturnLow", label: "Exp.\nreturn", fmt: (x) => p1(x), cls: retCls, title: "5-year return a year: the lower of own growth and analysts' growth" },
      { key: "expectedReturn", label: "Exp. ret.\nhistory", fmt: (x) => p1(x), title: "With the growth of the stock's own history" },
      { key: "growth", label: "Growth", fmt: (x) => p1(x), title: "Growth used (fit over up to 10 years, capped -10..25%)" },
      { key: "peg", label: "PEG", fmt: (x) => (finite(x) ? x.toFixed(2) : "—") },
      { key: "yieldPct", label: "Yield", fmt: (x) => p1(x, 2) },
      { key: "raisedYears", label: "Years\nraised", fmt: (x, r) => (x ? `${x}${r.category ? ` ${CAT_SHORT[r.category]}` : ""}` : "—"), title: "Years of dividend raises in a row: Champ 25+, Cont 10-24, Chall 5-9" },
      { key: "roe", label: "ROE", fmt: (x) => p1(x, 0), cls: (x) => (x >= 15 ? "up" : "") },
      { key: "debtToCapital", label: "Debt/\ncapital", fmt: (x) => p1(x, 0), cls: (x) => (x > 70 ? "down" : "") },
      { key: "fcfDivCover5", label: "FCF/div\n5y", fmt: (x) => x1(x), cls: (x) => (finite(x) ? (x >= 1 ? "up" : "down") : "") },
      { key: "piotroski", label: "F", title: "Piotroski F-score (0-9)" },
      { key: "rsl", label: "RSL26", fmt: (x) => (finite(x) ? x.toFixed(2) : "—"), cls: (x) => (finite(x) ? (x > 1 ? "up" : "down") : "") },
      { key: (r) => [r.financial && "fin", r.oneOff && "one-off", r.erratic && "erratic", r.cheapMomentum && "cheap+mom"].filter(Boolean).join(" "), label: "Note", left: true, title: "fin = bank/insurer/real estate (P/E says less); one-off = TTM EPS well above next year's estimate, valued on the estimate; erratic = 2+ loss years in 10, no expected return; cheap+mom = below normal and RSL above 1" },
    ], { onRow: (r) => ctx.go(`${r.t} FV${d.basis !== "EPS" ? ` ${d.basis}` : ""}${d.pe !== 15 ? ` PE=${d.pe}` : ""}`) }));
  }
  draw();
  ctx.el.append(html(`<p class="hint">Click a row for the FV analysis. "Exp. return": earnings grow at the stock's past rate (or analysts', whichever is lower), the P/E moves to its normal level (at most 30) over 5 years, plus dividends. Fairly valued (Champions, Contenders, Challengers, Growth) = at most 10% above the normal value. US stocks: SEC 10-K figures up to 20 years; Europe: Yahoo, 4 years (* normal P/E).</p>`));
  ctx.setSource(d.source);
}

export default [
  { id: "FV", name: "Fair value: P/E 15, normal P/E, expected return, quality, dividends, backtest", group: "Kamikaze", needs: true, source: "SEC company facts (US), Yahoo annual figures, prices, dividends and estimates", render: fv },
  { id: "FVSCAN", name: "Fair value scanner: S&P 500, Nasdaq-100, DAX, STOXX 600, watchlists", group: "Kamikaze", needs: false, source: "SEC company facts (US), Yahoo annual figures, prices, dividends and estimates", render: fvscan },
];
