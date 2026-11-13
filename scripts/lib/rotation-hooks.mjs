/**
 * Analysis-only copy of rotationBacktest (lib/fn/grokki-math.js) with
 *  - precomputed weekly RSL / RRG per ticker (point-in-time identical, much faster)
 *  - optional hooks: entryFilter(ctx) -> bool, extraExit(ctx) -> reason|null
 *  - per-trade entry snapshot + weekly path (rank/quadrant/close) for anatomy.
 * Production engine is NOT touched. Baseline (no hooks) must reproduce engine numbers.
 */
import { weekly, levy, rrgSeries, evaluateTrailExit, iso } from '../../lib/fn/grokki-math.js';

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const weekKey = t => Math.floor((t + 3 * 86400) / (7 * 86400));

/** Precompute per-series weekly arrays + RSL + RRG trail keyed by week key. */
export function prepare(series, benchBars) {
  const bmW = weekly(benchBars);
  const bmIdx = new Map(bmW.map((w, i) => [w.key, i]));
  const bmRsl = bmW.map((w, i) => i >= 25 ? w.close / mean(bmW.slice(i - 25, i + 1).map(x => x.close)) : null);
  const bmSma40 = bmW.map((w, i) => i >= 39 ? mean(bmW.slice(i - 39, i + 1).map(x => x.close)) : null);
  const bench = { bars: benchBars, W: bmW, idx: bmIdx, rsl: bmRsl, sma40: bmSma40 };
  const prepped = series.map(s => {
    const W = weekly(s.bars);
    const idx = new Map(W.map((w, i) => [w.key, i]));
    const rsl = W.map((w, i) => i >= 25 ? w.close / mean(W.slice(i - 25, i + 1).map(x => x.close)) : null);
    const trail = rrgSeries(s.bars, benchBars);
    const trailIdx = new Map(trail.map((p, i) => [p.key, i]));
    const map = new Map(s.bars.map(b => [b.time, b]));
    const dIdx = new Map(s.bars.map((b, i) => [b.time, i]));
    return { ticker: s.ticker, bars: s.bars, map, dIdx, W, idx, rsl, trail, trailIdx };
  });
  return { prepped, bench };
}

/** weekly index of last weekly entry with key <= k */
export function wIdxAtOrBefore(p, k) {
  if (p.idx.has(k)) return p.idx.get(k);
  // binary search
  let lo = 0, hi = p.W.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (p.W[m].key <= k) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
function trailUpTo(p, k) {
  // last trail point with key <= k
  let lo = 0, hi = p.trail.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (p.trail[m].key <= k) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

export function runBacktest(P, n, opts = {}) {
  const { prepped, bench } = P;
  const allDates = [...new Set(prepped.flatMap(s => s.bars.map(b => b.time)))].sort((a, b) => a - b);
  const windowStart = opts.windowStart, windowEnd = opts.windowEnd;
  const endT = windowEnd ?? allDates.at(-1);
  const cutoff = windowStart ?? (endT - (opts.years ?? 10) * 365.25 * 86400);
  const mode = opts.mode || 'OFF', rankTop = opts.rankTop ?? 25;
  const confirmWeeks = Math.max(1, Math.min(8, (Number(opts.confirmWeeks) || 1) | 0));
  const rsExit = !!opts.rsExit;
  const startCapital = opts.startCapital ?? 10000, fee = opts.fee ?? 1;
  const nSlots = Math.max(1, n | 0);
  const userEntryFilter = opts.entryFilter || null, extraExit = opts.extraExit || null;
  const cooldown = Number(opts.reentryCooldownWeeks ?? 0) | 0; // only after extra (non-engine) exits
  const extraExitAt = new Map();
  const entryFilter = (userEntryFilter || (extraExit && cooldown > 0)) ? (ctx => {
    if (cooldown > 0 && extraExitAt.has(ctx.row.ticker) && ctx.sk - extraExitAt.get(ctx.row.ticker) < cooldown) return false;
    return userEntryFilter ? userEntryFilter(ctx) : true;
  }) : null;

  const byWeek = new Map();
  for (const t of allDates) { const k = weekKey(t); if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(t); }
  const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([key, days]) => ({ key, first: days[0], last: days.at(-1) }));
  const weekPos = new Map(weeks.map((w, i) => [w.key, i]));
  const rankCache = new Map();
  function rankAt(signalT) {
    if (rankCache.has(signalT)) return rankCache.get(signalT);
    const k = weekKey(signalT);
    const rows = [];
    for (const p of prepped) {
      const i = wIdxAtOrBefore(p, k);
      if (i < 0) continue;
      const lastT = p.W[i].time;
      if (!(signalT - lastT <= 7 * 86400)) continue;
      const sc = p.rsl[i];
      if (sc == null) continue;
      rows.push({ ticker: p.ticker, score: sc, s: p, wi: i });
    }
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => { r.rank = i + 1; });
    const out = { rows, byTicker: new Map(rows.map(r => [r.ticker, r])) };
    rankCache.set(signalT, out);
    return out;
  }
  const benchRslAt = k => { const i = wIdxAtOrBefore(bench, k); return i >= 0 ? bench.rsl[i] : null; };

  let cash = startCapital, holdings = [], peak = startCapital, mdd = 0, initialized = false, lastWeekKey = null;
  const equity = [], closedTrades = [];
  let totalFees = 0;

  function execPx(bar) { if (bar?.open > 0) return { px: bar.open, kind: 'open' }; if (bar?.close > 0) return { px: bar.close, kind: 'close' }; return null; }
  function eqOpen(execT) { let v = cash; for (const h of holdings) { const ep = execPx(h.s.map.get(execT)); v += h.shares * (ep?.px ?? h.last); } return v; }

  function buy(row, execT, budget, signalT, ranked) {
    const ep = execPx(row.s.map.get(execT));
    if (!ep || !(cash > fee) || !(budget > 0)) return false;
    const maxSh = Math.min(budget, cash - fee);
    if (!(maxSh > 0)) return false;
    const shares = maxSh / ep.px, spend = shares * ep.px;
    if (spend + fee > cash + 1e-9) return false;
    cash -= spend + fee; totalFees += fee;
    holdings.push({ s: row.s, shares, last: ep.px, entryPrice: ep.px, bought: iso(execT), buyT: execT, signalT, entryRank: row.rank, entryRsl: row.score, feePaid: fee, path: [] });
    return true;
  }

  for (const t of allDates.filter(t => t >= cutoff && (windowEnd == null || t <= windowEnd))) {
    const wk = weekKey(t);
    if (wk !== lastWeekKey) {
      const pos = weekPos.get(wk);
      const signalWeek = pos > 0 ? weeks[pos - 1] : null;
      const execT = weeks[pos].first, signalT = signalWeek?.last ?? null;
      if (signalT != null) {
        const ranked = rankAt(signalT), topN = ranked.rows.slice(0, nSlots);
        const sk = weekKey(signalT);
        const benchRsl = benchRslAt(sk);
        if (!initialized) {
          const budget = eqOpen(execT) / nSlots; let filled = 0;
          for (const row of topN) {
            if (holdings.length >= nSlots) break;
            if (!row.s.map.get(execT)) continue;
            if (entryFilter && !entryFilter({ row, signalT, execT, sk, ranked, bench, benchRsl })) continue;
            if (buy(row, execT, budget, signalT, ranked)) filled++;
          }
          if (filled > 0) initialized = true;
        } else {
          const keep = [];
          for (const h of holdings) {
            const p = h.s;
            const wi = wIdxAtOrBefore(p, sk);
            const stockRsl = wi >= 0 && p.W.length ? p.rsl[wi] : null; // levy(prior): last 26 weekly incl latest
            const ti = trailUpTo(p, sk);
            const trail = ti >= 0 ? p.trail.slice(0, ti + 1) : [];
            const rank = ranked.byTicker.get(p.ticker)?.rank ?? null;
            const ev = evaluateTrailExit(trail, { rank, stockRsl, benchRsl }, { mode, rankTop, confirmWeeks, rsExit });
            const q = trail.length ? trail.at(-1).quadrant : null;
            const wclose = wi >= 0 ? p.W[wi].close : null;
            h.path.push({ sk, signalT, rank, rsl: stockRsl, quadrant: q, close: wclose, ratio: trail.at(-1)?.ratio ?? null, momentum: trail.at(-1)?.momentum ?? null });
            let reason = ev.exitHint || null;
            if (!reason && extraExit) reason = extraExit({ h, p, wi, sk, signalT, rank, stockRsl, benchRsl, quadrant: q, trail, close: wclose, bench });
            if (reason) {
              const ep = execPx(p.map.get(execT)) || { px: h.last, kind: 'close' };
              const gross = h.shares * ep.px, proceeds = gross - fee;
              const cost = h.shares * h.entryPrice;
              const pnl = gross - cost - h.feePaid - fee;
              cash += proceeds; totalFees += fee;
              if (!ev.exitHint) extraExitAt.set(p.ticker, sk);
              closedTrades.push({ ticker: p.ticker, buyDate: h.bought, sellDate: iso(execT), buyT: h.buyT, sellT: execT, signalT: h.signalT, exitSignalT: signalT,
                entryPrice: h.entryPrice, exitPrice: ep.px, shares: h.shares, cost, pnl, pnlPct: 100 * pnl / cost, entryRank: h.entryRank, entryRsl: h.entryRsl,
                holdDays: Math.round((execT - h.buyT) / 86400), reason, extra: !ev.exitHint, path: h.path, s: p });
            } else keep.push(h);
          }
          holdings = keep;
          const budget = eqOpen(execT) / nSlots;
          const held = new Set(holdings.map(h => h.s.ticker));
          for (const row of topN) {
            if (holdings.length >= nSlots) break;
            if (held.has(row.ticker)) continue;
            if (!row.s.map.get(execT)) continue;
            if (entryFilter && !entryFilter({ row, signalT, execT, sk, ranked, bench, benchRsl })) continue;
            if (buy(row, execT, budget, signalT, ranked)) held.add(row.ticker);
          }
        }
      }
      lastWeekKey = wk;
    }
    for (const h of holdings) if (h.s.map.has(t)) h.last = h.s.map.get(t).close;
    const value = cash + holdings.reduce((v, h) => v + h.shares * h.last, 0);
    peak = Math.max(peak, value); mdd = Math.min(mdd, value / peak - 1);
    equity.push({ time: iso(t), value });
  }
  const years = (Date.parse(equity.at(-1).time) - Date.parse(equity[0].time)) / (365.25 * 86400e3);
  const fin = equity.at(-1).value;
  const cagr = 100 * ((fin / startCapital) ** (1 / years) - 1);
  // weekly sharpe like strategy-variant-compare
  const sampled = []; let lastW = null;
  for (const p of equity) { const w = Math.floor((Date.parse(p.time + 'T00:00:00Z') / 86400e3 + 3) / 7); if (w !== lastW) { sampled.push(p); lastW = w; } }
  const rets = []; for (let i = 1; i < sampled.length; i++) rets.push(sampled[i].value / sampled[i - 1].value - 1);
  const m = mean(rets), sd = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1));
  const sharpe = m / sd * Math.sqrt(52);
  const wins = closedTrades.filter(t => t.pnl > 0).length;
  return { cagr, maxDD: 100 * mdd, mar: cagr / Math.abs(100 * mdd), sharpe, finalEquity: fin, years, from: equity[0].time, to: equity.at(-1).time,
    trades: closedTrades.length, open: holdings.length, winRate: 100 * wins / closedTrades.length, totalFees,
    holdWeeksAvg: mean(closedTrades.map(t => t.holdDays)) / 7, closedTrades, openHoldings: holdings, equity };
}
