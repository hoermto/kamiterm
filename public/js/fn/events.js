// Event scanners. DSCAN: buy-write candidates over the coming ex-dividend dates (US stocks): weekly options,
// an expiry a few days after the entry, the first call above the price, and the stock's past ex-dates at
// today's terms. The maths runs on the server (lib/fn/dscan.js, lib/buywrite.js, lib/event-moves.js).
import { api, esc, pct, num, cls } from "../api.js";
import { table, sect, tabs, html } from "../ui.js";
import { watchButtons } from "./workspace.js";

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const p2 = (v) => pct(v, 2);
const perc0 = (v) => (finite(v) ? `${v.toFixed(0)}%` : "—");
// Verdict colours: promising green, mixed amber, not promising red, too little history dim.
export const VERDICT_CLS = { good: "up", mixed: "amber", poor: "down", na: "dim" };
export const verdictHtml = (level, label, reason) =>
  `<span class="${VERDICT_CLS[level] || ""}" title="${esc(reason || "")}">${esc(label || "—")}</span>`;
const DSCAN_DEFAULTS = { universe: "SPX", days: 14, entry: 2, dtemin: 2, dtemax: 10, weekly: 1, mdte: 45, liquid: 0, minoi: 50, maxspread: 30, period: "5Y" };
const UNIS = ["SPX", "NDX", "ALL"];
const PERIODS = ["1Y", "2Y", "3Y", "5Y", "ALL"];
const keys = (args) => Object.fromEntries(args.filter((a) => a.includes("=")).map((a) => { const [k, ...v] = a.split("="); return [k.toLowerCase(), v.join("=")]; }));
const dscanCmd = (v) =>
  `DSCAN ${v.universe} DAYS=${v.days} ENTRY=${v.entry} DTE=${v.dtemin}-${v.dtemax} WEEKLY=${v.weekly ? 1 : 0}${v.weekly ? "" : ` MDTE=${v.mdte}`} LIQUID=${v.liquid ? 1 : 0}${v.liquid ? ` MINOI=${v.minoi} MAXSPREAD=${v.maxspread}` : ""} PERIOD=${v.period}`;

async function loadSaved() {
  try { return (await api.get("/api/settings?tool=DSCAN"))?.settings || {}; } catch { return {}; }
}

async function dscan(ctx) {
  const saved = await loadSaved();
  const k = keys(ctx.args);
  const pick = (name) => k[name] ?? saved[name] ?? DSCAN_DEFAULTS[name];
  const v = {
    universe: ctx.args.map((a) => String(a).toUpperCase()).find((a) => UNIS.includes(a)) || saved.universe || DSCAN_DEFAULTS.universe,
    days: pick("days"), entry: pick("entry"), dtemin: pick("dtemin"), dtemax: pick("dtemax"),
    minoi: pick("minoi"), maxspread: pick("maxspread"), weekly: Number(pick("weekly")) ? 1 : 0,
    mdte: pick("mdte"), liquid: Number(pick("liquid")) ? 1 : 0,
    period: String(pick("period")).toUpperCase(),
  };
  const dte = /^(\d+)-(\d+)$/.exec(k.dte || "");
  if (dte) [v.dtemin, v.dtemax] = [dte[1], dte[2]];
  ctx.el.replaceChildren(html(`<p class="hint">Looking up ex-dates and option chains (the first run can take a minute)…</p>`));
  const d = await api.fn("dscan", v);
  if (!ctx.live()) return;
  ctx.follow?.(d.live); // newer bars in the background rebuild the screen quietly
  api.put("/api/settings", { tool: "DSCAN", settings: { ...v, updatedAt: new Date().toISOString() } }).catch(() => {});

  ctx.el.replaceChildren(
    sect(`Buy-write over the ex-date · ${d.universeLabel} · ex-dates in the next ${d.days} days`),
    tabs(UNIS, d.universe, (u) => ctx.go(dscanCmd({ ...v, universe: u }))),
  );
  const form = html(`<form class="wform" autocomplete="off">
    <label>Days ahead <input name="days" type="number" min="1" max="30" style="width:52px" value="${esc(v.days)}"></label>
    <label>Entry, days before <input name="entry" type="number" min="1" max="10" style="width:46px" value="${esc(v.entry)}"></label>
    <label>DTE <input name="dtemin" type="number" min="0" max="30" style="width:46px" value="${esc(v.dtemin)}"> to <input name="dtemax" type="number" min="1" max="45" style="width:46px" value="${esc(v.dtemax)}"></label>
    <label><input name="weekly" type="checkbox"${v.weekly ? " checked" : ""}> weekly options only</label>
    <label title="Without weekly options only: stocks with monthly options get the first expiry after the ex-date up to this many days after the entry">else monthly up to <input name="mdte" type="number" min="5" max="90" style="width:52px" value="${esc(v.mdte)}"> days</label>
    <label><input name="liquid" type="checkbox"${v.liquid ? " checked" : ""}> liquidity filter:</label>
    <label>open interest ≥ <input name="minoi" type="number" min="0" style="width:64px" value="${esc(v.minoi)}"></label>
    <label>spread ≤ <input name="maxspread" type="number" min="1" max="200" style="width:52px" value="${esc(v.maxspread)}">%</label>
    <label>History <select name="period">${PERIODS.map((p) => `<option${p === v.period ? " selected" : ""}>${p}</option>`).join("")}</select></label>
    <button type="submit">Scan</button>
  </form>`);
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    ctx.go(dscanCmd({ ...v, days: f.get("days"), entry: f.get("entry"), dtemin: f.get("dtemin"), dtemax: f.get("dtemax"), minoi: f.get("minoi"), maxspread: f.get("maxspread"), weekly: f.get("weekly") ? 1 : 0, mdte: f.get("mdte"), liquid: f.get("liquid") ? 1 : 0, period: f.get("period") }));
  };
  const c = d.coverage;
  const sk = c.skipped;
  const out = [
    sk.noOptions && `${sk.noOptions} without US options`,
    sk.tooLate && `${sk.tooLate} too late to buy before the ex-date`,
    sk.noWeekly && `${sk.noWeekly} without weeklies`,
    sk.noExpiry && `${sk.noExpiry} without an expiry ${d.dteMin}-${d.weeklyOnly ? d.dteMax : d.monthlyMaxDte} days after the entry`,
    sk.noPremium && `${sk.noPremium} without a usable premium`,
    sk.illiquid && `${sk.illiquid} below ${d.minOi} open interest or above ${d.maxSpread}% spread`,
    sk.error && `${sk.error} where the option data did not load (CBOE limits requests: run again in a minute)`,
  ].filter(Boolean);
  // Watchlist: W column (✓ / +), list picker and "Add all" (workspace.js); the symbols are US stocks.
  const host = document.createElement("div");
  const wb = watchButtons(ctx, { item: (r) => ({ words: [r.symbol] }), key: (r) => r.symbol, redraw: () => drawTable() });
  if (d.rows.length) await wb.load();
  if (!ctx.live()) return;
  const info = html(`<p class="hint">${c.exDates} stocks with an ex-date · ${c.listed} listed${out.length ? ` · left out: ${out.join(", ")}` : ""}${c.partial ? " · not all checked in time, run again" : ""}</p>`);
  ctx.el.append(form, info, host);
  wb.bind(host, (sym) => d.rows.find((r) => r.symbol === sym));
  function drawTable() {
    info.querySelector("[data-wbar]")?.remove();
    host.replaceChildren();
    if (!d.rows.length) {
      host.append(html(`<p class="hint">No candidates with these filters. More days ahead, a wider DTE or looser liquidity filters find more.</p>`));
    } else {
      info.append(wb.bar(d.rows));
      const t = table(d.rows, [
          wb.col(),
          { key: "symbol", label: "Ticker", left: true, lbl: true, title: "Click a row for DMOV, the Chart button for the price chart" },
          { key: "symbol", label: "", left: true, html: true, fmt: (x) => `<button class="tab" data-chart="${esc(x)}" title="Price chart (GP) for ${esc(x)}">Chart</button>`, title: "Open the price chart" },
          { key: "verdictLabel", label: "Verdict", left: true, html: true, fmt: (x, r) => verdictHtml(r.verdict, x, r.verdictReason), title: "From the past ex-dates at today's terms; hover for the reason" },
          { key: "exDate", label: "Ex-date", left: true },
          { key: "dividendPct", label: "Dividend", fmt: (x) => (finite(x) ? `${x.toFixed(2)}%` : "—") },
          { key: "entryDate", label: "Entry", left: true },
          { key: "expiry", label: "Expiry", left: true, fmt: (x, r) => `${x}${r.monthly ? " M" : ""}`, title: "M = monthly expiry (no weekly one in the DTE range)" },
          { key: "dte", label: "DTE" },
          { key: "strike", label: "Strike", fmt: (x, r) => `${num(x, 2)} (${p2(r.strikePct)})` },
          { key: "premiumPct", label: "Premium", fmt: (x, r) => (finite(x) ? `${x.toFixed(2)}%${r.premiumEstimated ? "*" : ""}` : "—"), title: "Call bid over the price; * = estimated for the entry day" },
          { key: "flatPct", label: "Premium +\ndividend", fmt: (x) => (finite(x) ? `${x.toFixed(2)}%` : "—"), title: "What the trade makes if the stock ends where it started" },
          { key: "oi", label: "Open\ninterest" },
          { key: "spreadPct", label: "Spread", fmt: perc0 },
          { key: "n", label: "Past\nex-dates" },
          { key: "avgPct", label: "Avg per\ntrade", fmt: p2, cls, title: "Today's terms on the past ex-dates: average return per trade" },
          { key: "medianPct", label: "Median", fmt: p2, cls },
          { key: "worstPct", label: "Worst", fmt: p2, cls },
          { key: "winPct", label: "Win", fmt: perc0 },
          { key: "assignedPct", label: "Called\naway", fmt: perc0 },
          { key: "perYearPct", label: "Per year", fmt: p2, cls, title: "Average per trade x 365 / DTE (simple, before costs)" },
          { key: (r) => (r.earlyRisk ? "early assignment" : ""), label: "Warning", left: true },
        ], { onRow: (r) => ctx.go(`${r.symbol} DMOV ${d.period} ENTRY=${d.entryDays} DTE=${d.dteMin}-${d.dteMax}`) });
      // The Chart button opens GP; the rest of the row opens DMOV.
      t.addEventListener("click", (e) => {
        const sym = e.target.closest("[data-chart]")?.dataset.chart;
        if (!sym) return;
        e.stopImmediatePropagation();
        ctx.go(`${sym} GP`);
      }, true);
      host.append(t);
    }
  }
  drawTable();
  ctx.el.append(
    html(`<p class="hint">Buy ${d.entryDays} trading day${d.entryDays > 1 ? "s" : ""} before the ex-date, sell the first call above the price on the first expiry ${d.dteMin} to ${d.dteMax} days after the entry, keep the dividend, hold to expiry. Verdict: <span class="up">promising</span> = at least 8 past ex-dates, average above zero, at least 65% won and the average clearly above chance (t ≥ 1.5); <span class="down">not promising</span> = average at or below zero or under half won; <span class="amber">mixed</span> = in between. "Avg per trade" applies today's strike distance, premium and dividend to the stock's past ex-dates since ${esc(d.since || "the start of the data")}: the move to expiry capped at the strike, plus premium and dividend. Quotes are about 15 minutes behind; outside market hours the spreads are those of the close and often wide.</p>`),
  );
  ctx.setSource(d.source);
}

export default [
  {
    id: "DSCAN",
    name: "Buy-write scanner over ex-dividend dates",
    group: "Equities",
    needs: false,
    source: "Nasdaq dividend calendar, CBOE delayed option quotes, Yahoo dividends and prices",
    render: dscan,
  },
];
