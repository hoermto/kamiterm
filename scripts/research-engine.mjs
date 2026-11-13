#!/usr/bin/env node
/**
 * Shared research engine (copied from scripts/wf-ranking.mjs, unchanged logic). Exports P, CANDS, run, stats, helpers.
 * Original header: Walk-forward for the ranking source of the weekly RSL rotation (analysis only, production untouched).
 * Candidates: RSL26, RSL39, MOM 52-4 (12-1), MOM 52-2, MOM 65-4 — all with trailing stop 20 % / lock 4.
 * (a) fixed rankings, continuous carry run 2018-01-01 → 2026-11-09, yearly OOS segments
 * (b) adaptive: each year Y pick ranking with best MAR on IS window ending Y-1-12-31
 *     (expanding from anchor 2016-11-09, rolling 3y, rolling 5y), trade Y with carry.
 * Engine = scripts/entry-variants.mjs engine + per-year ranking schedule (holdings, trail peaks and
 * re-entry locks carry across year boundaries; new ranking applies from first signal of the year).
 */
import { writeFileSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { evaluateTrailExit, iso, toGermanCsv } from '../lib/fn/grokki-math.js';
import { prepare, wIdxAtOrBefore, runBacktest as refRun } from './lib/rotation-hooks.mjs';

const ts = s => Date.parse(s + 'T00:00:00Z') / 1000;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sdev = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const weekKey = t => Math.floor((t + 3 * 86400) / (7 * 86400));
const yearOf = t => +iso(t).slice(0, 4);

// Universe flag (default SPX, unchanged): RSL_UNIVERSE=DAX|NDX|SPX → roster + own benchmark (^GDAXI / ^NDX / ^GSPC).
// Research-only universes (HDAX, SXXP, SXXP_EZ) from scripts/lib/research-universes.json; non-EUR prices converted to EUR.
const UNIVERSE_KEY = String(process.env.RSL_UNIVERSE || 'SPX').toUpperCase();
const RU0 = await import('./lib/research-universes.mjs');
// US research universes (R1000, R1000ex; Russell-1000-Studie 2026-11-10) live in a separate file so the production terminal (which imports
// research-universes.mjs/json) stays untouched. They carry base:'USD' → no EUR conversion in single-universe mode.
const { readFileSync: _rfs, existsSync: _ex } = await import('fs');
const _usP = new URL('./lib/research-universes-us.json', import.meta.url);
const _US = _ex(_usP) ? JSON.parse(_rfs(_usP, 'utf8')).universes : {};
const _RUX = { ...RU0.RESEARCH_UNIVERSES, ..._US };
const RU = { ...RU0, RESEARCH_UNIVERSES: _RUX, isResearchUniverse: k => Object.prototype.hasOwnProperty.call(_RUX, k) };
// Pooled research universes (e.g. RSL_UNIVERSE=SPX+SXXP or SPX+HDAX): all prices in EUR (USD via EURUSD=X), one ranking list,
// each stock keeps its own benchmark (RRG trail + RS exit vs ^GSPC in EUR / ^STOXX / ^GDAXI). Single universes unchanged.
const POOL = UNIVERSE_KEY.includes('+') ? UNIVERSE_KEY.split('+') : null;
const RESEARCH = !POOL && RU.isResearchUniverse(UNIVERSE_KEY) ? RU.RESEARCH_UNIVERSES[UNIVERSE_KEY] : null;
const BENCH_TICKER = process.env.RSL_BENCH || (POOL ? POOL.map(k => RU.isResearchUniverse(k) ? RU.RESEARCH_UNIVERSES[k].bench : ({ SPX: '^GSPC', NDX: '^NDX', DAX: '^GDAXI' }[k])).join('+') : RESEARCH ? RESEARCH.bench : ({ SPX: '^GSPC', NDX: '^NDX', DAX: '^GDAXI' }[UNIVERSE_KEY] || '^GSPC'));
const fxCache = new Map();
async function fxBars(c) { if (!fxCache.has(c)) fxCache.set(c, (await history(RU.RESEARCH_FX[c], 12)).bars); return fxCache.get(c); }
async function loadPart(key, toEUR) {
  const R = RU.isResearchUniverse(key) ? RU.RESEARCH_UNIVERSES[key] : null;
  const members = R ? R.members : universe({ universe: key }).tickers.map(t => ({ t, cur: key === 'DAX' ? 'EUR' : 'USD' }));
  const bt = R ? R.bench : ({ SPX: '^GSPC', NDX: '^NDX', DAX: '^GDAXI' }[key] || '^GSPC');
  const [bm, d] = await Promise.all([history(bt, 12), batch(members.map(m => m.t), t => history(t, 12), 900000, 8)]);
  const byT = new Map(members.map(m => [m.t, m])), repairs = [];
  let results = d.results;
  if (R) results = results.map(s => { const rp = RU.repairBars(s); if (rp.fixes.length) repairs.push({ ticker: s.ticker, fixes: rp.fixes }); return rp.series; });
  if (toEUR || R) results = await Promise.all(results.map(async s => { const m = byT.get(s.ticker); return m && m.cur !== 'EUR' ? RU.toEur(s, m, await fxBars(m.cur)) : s; }));
  results = results.filter(s => s.bars.length > 0);
  let bench = bm;
  if (toEUR && !R && key !== 'DAX') bench = RU.toEur(bm, { cur: 'USD' }, await fxBars('USD'));
  return { key, members, bench, data: { ...d, results }, repairs, benchTicker: bt };
}
let u, benchmark, data, P;
if (POOL) {
  const parts = await Promise.all(POOL.map(k => loadPart(k, true)));
  globalThis.__RSL_REPAIRS = parts.flatMap(x => x.repairs);
  const seen = new Set(), prepped = [];
  for (const pt of parts) { const Pp = prepare(pt.data.results.filter(s => !seen.has(s.ticker)), pt.bench.bars); for (const p of Pp.prepped) { p.bench = Pp.bench; p.part = pt.key; seen.add(p.ticker); prepped.push(p); } pt.P = Pp; }
  u = { key: UNIVERSE_KEY, tickers: parts.flatMap(x => x.members.map(m => m.t)), label: POOL.join(' + ') };
  benchmark = parts[0].bench; data = { results: parts.flatMap(x => x.data.results), parts: parts.map(x => ({ key: x.key, loaded: x.data.results.length, requested: x.members.length, bench: x.benchTicker })) };
  P = { prepped, bench: parts[0].P.bench };
} else {
  u = RESEARCH ? { key: UNIVERSE_KEY, tickers: RESEARCH.members.map(m => m.t), label: RESEARCH.label } : universe({ universe: UNIVERSE_KEY });
  [benchmark, data] = await Promise.all([history(BENCH_TICKER, 12), batch(u.tickers, t => history(t, 12), 900000, 8)]);
  if (RESEARCH) {
    const BASE = RESEARCH.base || 'EUR';
    const curs = [...new Set(RESEARCH.members.map(m => m.cur).filter(c => c !== BASE))];
    const fx = Object.fromEntries(await Promise.all(curs.map(async c => [c, (await history(RU.RESEARCH_FX[c], 12)).bars])));
    const byT = new Map(RESEARCH.members.map(m => [m.t, m]));
    globalThis.__RSL_REPAIRS = [];
    data.results = data.results.map(s => { const mm = byT.get(s.ticker); if (mm?.dropBefore) { const cut = Date.parse(mm.dropBefore + 'T00:00:00Z') / 1000; s = { ...s, bars: s.bars.filter(x => x.time >= cut) }; } const rp = RESEARCH.repair === false ? { series: s, fixes: [] } : RU.repairBars(s); if (rp.fixes.length) globalThis.__RSL_REPAIRS.push({ ticker: s.ticker, fixes: rp.fixes }); s = rp.series; const m = byT.get(s.ticker); return m && m.cur !== BASE ? RU.toEur(s, m, fx[m.cur]) : s; }).filter(s => s.bars.length > 0);
    if (globalThis.__RSL_REPAIRS.length) console.log(`[${UNIVERSE_KEY}] Datenreparaturen: ${globalThis.__RSL_REPAIRS.map(r => `${r.ticker} ${r.fixes.map(f => f.type + ' ' + iso(f.from) + '..' + iso(f.to)).join(', ')}`).join(' | ')}`);
  }
  P = prepare(data.results, benchmark.bars);
}
console.log(`[${UNIVERSE_KEY} vs ${BENCH_TICKER}] loaded ${P.prepped.length}/${u.tickers.length}; first bar ${iso(Math.min(...P.prepped.map(s => s.bars[0].time)))}`);

function rollRsl(W, L) { const out = new Array(W.length).fill(null); let s = 0; for (let i = 0; i < W.length; i++) { s += W[i].close; if (i >= L) s -= W[i - L].close; if (i >= L - 1) out[i] = W[i].close / (s / L); } return out; }
const MOMS = [[52, 4], [52, 2], [65, 4]];
for (const p of P.prepped) p.rsl20 = rollRsl(p.W, 20);
for (const p of P.prepped) {
  p.rsl39 = rollRsl(p.W, 39);
  p.mom = Object.fromEntries(MOMS.map(([lb, sk]) => [`${lb}_${sk}`, p.W.map((w, i) => i >= lb ? p.W[i - sk].close / p.W[i - lb].close - 1 : null)]));
}
const CANDS = {
  RSL26: { label: 'RSL26 (Basis)', f: (p, i) => p.rsl[i] },
  RSL20: { label: 'RSL20', f: (p, i) => p.rsl20[i] },
  RSL39: { label: 'RSL39', f: (p, i) => p.rsl39[i] },
  MOM52_4: { label: 'MOM 52-4 (12-1)', f: (p, i) => p.mom['52_4'][i] },
  MOM52_2: { label: 'MOM 52-2', f: (p, i) => p.mom['52_2'][i] },
  MOM65_4: { label: 'MOM 65-4', f: (p, i) => p.mom['65_4'][i] },
};
function trailUpTo(p, k) { let lo = 0, hi = p.trail.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.trail[m].key <= k) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }

const allDates = [...new Set(P.prepped.flatMap(s => s.bars.map(b => b.time)))].sort((a, b) => a - b);
const byWeek = new Map();
for (const t of allDates) { const k = weekKey(t); if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(t); }
const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([key, days]) => ({ key, first: days[0], last: days.at(-1) }));
const weekPos = new Map(weeks.map((w, i) => [w.key, i]));
const caches = Object.fromEntries(Object.keys(CANDS).map(k => [k, new Map()]));
function rankAt(cid, signalT) {
  // Optional leave-out (Russell-1000-Studie): globalThis.__RSL_EXCL = { key, set } entfernt Ticker aus der Rangliste (eigener Cache-Schlüssel).
  const EX = globalThis.__RSL_EXCL, ck = EX ? `${signalT}|${EX.key}` : signalT;
  const C = caches[cid]; if (C.has(ck)) return C.get(ck);
  const k = weekKey(signalT), rows = [];
  for (const p of P.prepped) {
    if (EX && EX.set.has(p.ticker)) continue;
    const i = wIdxAtOrBefore(p, k);
    if (i < 0 || !(signalT - p.W[i].time <= 7 * 86400) || p.rsl[i] == null) continue;
    const s = CANDS[cid].f(p, i); if (s == null) continue;
    rows.push({ ticker: p.ticker, score: s, s: p, wi: i });
  }
  rows.sort((a, b) => b.score - a.score); rows.forEach((r, i) => { r.rank = i + 1; });
  const out = { rows, byTicker: new Map(rows.map(r => [r.ticker, r])) }; C.set(ck, out); return out;
}

/** schedule: function(execT) -> candidate id. Ranking switch takes effect at the first Monday of a new year. */
function run(base, schedule, windowStart, windowEnd, { trail = 0.2, lock = 4 } = {}) {
  const { mode, rankTop, rsExit, n: nSlots } = base, confirmWeeks = base.confirmWeeks || 1, fee = 1, startCapital = 10000;
  const lastExtraExit = new Map(), pnlBy = new Map(); let partDays = {}, nDays = 0;
  let cash = startCapital, holdings = [], peak = startCapital, mdd = 0, initialized = false, lastWeekKey = null, trades = 0, fees = 0;
  const equity = [];
  const execPx = bar => bar?.open > 0 ? bar.open : bar?.close > 0 ? bar.close : null;
  const eqOpen = execT => { let v = cash; for (const h of holdings) v += h.shares * (execPx(h.s.map.get(execT)) ?? h.last); return v; };
  const benchRslAt = (k, bm = P.bench) => { const i = wIdxAtOrBefore(bm, k); return i >= 0 ? bm.rsl[i] : null; };
  function tryBuys(ranked, execT, sk) {
    const budget = eqOpen(execT) / nSlots, held = new Set(holdings.map(h => h.s.ticker)); let filled = 0;
    for (const row of ranked.rows.slice(0, nSlots)) {
      if (holdings.length >= nSlots) break;
      if (held.has(row.ticker) || !row.s.map.get(execT)) continue;
      if (lock > 0 && lastExtraExit.has(row.ticker) && sk - lastExtraExit.get(row.ticker) < lock) continue;
      const px = execPx(row.s.map.get(execT)); if (!px || !(cash > fee)) continue;
      const spend = Math.min(budget, cash - fee); if (!(spend > 0)) continue;
      cash -= spend + fee; fees += fee;
      holdings.push({ s: row.s, shares: spend / px, last: px, entryPrice: px, peak: px, cost: spend + fee }); held.add(row.ticker); filled++;
    }
    return filled;
  }
  for (const t of allDates) {
    if (t < windowStart || t > windowEnd) continue;
    const wk = weekKey(t);
    if (wk !== lastWeekKey) {
      const pos = weekPos.get(wk), signalWeek = pos > 0 ? weeks[pos - 1] : null;
      const execT = weeks[pos].first, signalT = signalWeek?.last ?? null;
      if (signalT != null) {
        const ranked = rankAt(schedule(execT), signalT), sk = weekKey(signalT), benchRsl = benchRslAt(sk);
        if (!initialized) { if (tryBuys(ranked, execT, sk) > 0) initialized = true; }
        else {
          const keep = [];
          for (const h of holdings) {
            const p = h.s, wi = wIdxAtOrBefore(p, sk), stockRsl = wi >= 0 ? p.rsl[wi] : null;
            const ti = trailUpTo(p, sk), tr = ti >= 0 ? p.trail.slice(0, ti + 1) : [];
            const rank = ranked.byTicker.get(p.ticker)?.rank ?? null;
            const ev = evaluateTrailExit(tr, { rank, stockRsl, benchRsl: p.bench ? benchRslAt(sk, p.bench) : benchRsl }, { mode, rankTop, confirmWeeks, rsExit });
            const wclose = wi >= 0 ? p.W[wi].close : null;
            if (wclose != null) h.peak = Math.max(h.peak, wclose);
            let reason = ev.exitHint || null, extra = false;
            if (!reason && trail > 0 && wclose != null && wclose <= h.peak * (1 - trail)) { reason = 'trail'; extra = true; }
            if (reason) {
              const px = execPx(p.map.get(execT)) ?? h.last; cash += h.shares * px - fee; fees += fee; trades++; pnlBy.set(p.ticker, (pnlBy.get(p.ticker) || 0) + h.shares * px - fee - h.cost);
              if (extra) lastExtraExit.set(p.ticker, sk);
            } else keep.push(h);
          }
          holdings = keep; tryBuys(ranked, execT, sk);
        }
      }
      lastWeekKey = wk;
    }
    for (const h of holdings) if (h.s.map.has(t)) h.last = h.s.map.get(t).close;
    const value = cash + holdings.reduce((v, h) => v + h.shares * h.last, 0);
    peak = Math.max(peak, value); mdd = Math.min(mdd, value / peak - 1);
    equity.push({ t, time: iso(t), value, fees, nh: holdings.length });
    nDays++; for (const h of holdings) if (h.s.part) partDays[h.s.part] = (partDays[h.s.part] || 0) + 1;
  }
  const res = stats(equity, { trades, fees, mdd, start: startCapital });
  for (const h of holdings) pnlBy.set(h.s.ticker, (pnlBy.get(h.s.ticker) || 0) + h.shares * h.last - h.cost);
  res.pnlBy = pnlBy; res.partSlots = Object.fromEntries(Object.entries(partDays).map(([k, v]) => [k, v / nDays]));
  return res;
}
function stats(equity, extra = {}) {
  const years = (equity.at(-1).t - equity[0].t) / (365.25 * 86400), fin = equity.at(-1).value, st = extra.start ?? equity[0].value;
  let pk = st, mdd = 0; for (const e of equity) { pk = Math.max(pk, e.value); mdd = Math.min(mdd, e.value / pk - 1); }
  const cagr = 100 * ((fin / st) ** (1 / years) - 1);
  const sampled = []; let lastW = null;
  for (const e of equity) { const w = weekKey(e.t); if (w !== lastW) { sampled.push(e); lastW = w; } }
  const rets = []; for (let i = 1; i < sampled.length; i++) rets.push(sampled[i].value / sampled[i - 1].value - 1);
  // yearly segments (return from last value of previous year to last value of the year; first year from start)
  const yearly = {}; let prev = st, prevY = null, pkY = null, ddY = 0;
  for (const e of equity) {
    const y = yearOf(e.t);
    if (y !== prevY) { if (prevY != null) yearly[prevY].ddMax = 100 * ddY; prevY = y; yearly[y] = { start: prev }; pkY = prev; ddY = 0; }
    yearly[y].end = e.value; pkY = Math.max(pkY, e.value); ddY = Math.min(ddY, e.value / pkY - 1); prev = e.value;
  }
  if (prevY != null) yearly[prevY].ddMax = 100 * ddY;
  for (const y in yearly) yearly[y].ret = 100 * (yearly[y].end / yearly[y].start - 1);
  return { cagr, maxDD: 100 * mdd, mar: cagr / Math.abs(100 * mdd), sharpe: mean(rets) / sdev(rets) * Math.sqrt(52), final: fin, years, weekRets: rets, yearly, trades: extra.trades, fees: extra.fees, equity };
}
export { RESEARCH, UNIVERSE_KEY, BENCH_TICKER, u as UNIVERSE, P, CANDS, run, stats, ts, mean, sdev, weekKey, yearOf, iso, refRun, benchmark, data, toGermanCsv };
