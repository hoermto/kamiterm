#!/usr/bin/env node
/**
 * Trailing-stop trigger comparison (analysis only, production untouched):
 *  W  = weekly close vs highest weekly close since entry, sell next Monday open (current research rule)
 *  DC = daily close vs highest daily close since entry, sell next day open
 *  DH = daily close vs highest daily high since entry, sell next day open
 *  I  = broker-style intraday: peak = highest daily HIGH since entry (through prior day; entry price on entry day),
 *       trigger if daily LOW <= stop; fill at stop, or at open if the day opens below the stop
 *  IN = like I, but freed cash buys next name at next day open (from last Friday ranking)
 *  G  = weekly GTC: after each Friday close set stop = (1-p) * highest Friday close since entry (entry price for new
 *       positions); stop stays fixed during the week and triggers intraday (fill at stop / gap open)
 * All: lock 4 weeks after a stop exit; RRG/RS exits unchanged; weekly rebalance Monday open.
 */
import { writeFileSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { evaluateTrailExit, iso, toGermanCsv } from '../lib/fn/grokki-math.js';
import { prepare, wIdxAtOrBefore, runBacktest as refRun } from './lib/rotation-hooks.mjs';

const OUT = '/workspace/thoBox/Grokki/strategies';
// Universe flag (default SPX, unchanged): RSL_UNIVERSE=DAX → DAX roster + ^GDAXI, outputs get suffix _DAX.
const UNIVERSE_KEY = String(process.env.RSL_UNIVERSE || 'SPX').toUpperCase();
const BENCH_TICKER = { SPX: '^GSPC', NDX: '^NDX', DAX: '^GDAXI' }[UNIVERSE_KEY] || '^GSPC';
const TAG = 'RSL26_TrailingStop_Intraday_vs_Wochenschluss_2026-11-10' + (UNIVERSE_KEY === 'SPX' ? '' : `_${UNIVERSE_KEY}`);
const ts = s => Date.parse(s + 'T00:00:00Z') / 1000;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
const sdev = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const weekKey = t => Math.floor((t + 3 * 86400) / (7 * 86400));

const u = universe({ universe: UNIVERSE_KEY });
const [benchmark, data] = await Promise.all([history(BENCH_TICKER, 12), batch(u.tickers, t => history(t, 12), 300000, 8)]);
const P = prepare(data.results, benchmark.bars);
console.log(`loaded ${data.results.length}/${u.tickers.length}`);
for (const p of P.prepped) p.mom524 = p.W.map((w, i) => i >= 52 ? p.W[i - 4].close / p.W[i - 52].close - 1 : null);
const SCORES = { RSL26: (p, i) => p.rsl[i], MOM52_4: (p, i) => p.mom524[i] };
function trailUpTo(p, k) { let lo = 0, hi = p.trail.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.trail[m].key <= k) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }

const allDates = [...new Set(P.prepped.flatMap(s => s.bars.map(b => b.time)))].sort((a, b) => a - b);
const byWeek = new Map();
for (const t of allDates) { const k = weekKey(t); if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(t); }
const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([key, days]) => ({ key, first: days[0], last: days.at(-1) }));
const weekPos = new Map(weeks.map((w, i) => [w.key, i]));
const caches = { RSL26: new Map(), MOM52_4: new Map() };
function rankAt(sid, signalT) {
  const C = caches[sid]; if (C.has(signalT)) return C.get(signalT);
  const k = weekKey(signalT), rows = [];
  for (const p of P.prepped) {
    const i = wIdxAtOrBefore(p, k);
    if (i < 0 || !(signalT - p.W[i].time <= 7 * 86400) || p.rsl[i] == null) continue;
    const s = SCORES[sid](p, i); if (s == null) continue;
    rows.push({ ticker: p.ticker, score: s, s: p });
  }
  rows.sort((a, b) => b.score - a.score); rows.forEach((r, i) => { r.rank = i + 1; });
  const out = { rows, byTicker: new Map(rows.map(r => [r.ticker, r])) }; C.set(signalT, out); return out;
}

function run(base, stopMode, pct, windowStart, windowEnd, gPct = null) {
  const { mode, rankTop, rsExit, n: nSlots, score = 'RSL26' } = base, confirmWeeks = base.confirmWeeks || 1, fee = 1, startCapital = 10000, lock = 4;
  const f = 1 - pct, fG = 1 - (gPct ?? pct); // WG: weekly-close rule at pct + weekly-set intraday GTC safety stop at gPct
  const lastStop = new Map();
  let cash = startCapital, holdings = [], peak = startCapital, mdd = 0, initialized = false, lastWeekKey = null, fees = 0, lastRanked = null, lastSk = null;
  let pendingBuy = false;
  const equity = [], closed = [];
  const execPx = bar => bar?.open > 0 ? bar.open : bar?.close > 0 ? bar.close : null;
  const eqOpen = t => { let v = cash; for (const h of holdings) v += h.shares * (execPx(h.s.map.get(t)) ?? h.last); return v; };
  const benchRslAt = k => { const i = wIdxAtOrBefore(P.bench, k); return i >= 0 ? P.bench.rsl[i] : null; };
  function sell(h, px, t, reason, isStop, info = {}) {
    const gross = h.shares * px, cost = h.shares * h.entryPrice;
    cash += gross - fee; fees += fee;
    if (isStop) lastStop.set(h.s.ticker, weekKey(t));
    closed.push({ ticker: h.s.ticker, buyT: h.buyT, sellT: t, pnlPct: 100 * (gross - cost - 2 * fee) / cost, reason, isStop, ...info });
  }
  function tryBuys(ranked, t, sk) {
    if (!ranked) return 0;
    const budget = eqOpen(t) / nSlots, held = new Set(holdings.map(h => h.s.ticker)); let filled = 0;
    for (const row of ranked.rows.slice(0, nSlots)) {
      if (holdings.length >= nSlots) break;
      if (held.has(row.ticker) || !row.s.map.get(t)) continue;
      if (lastStop.has(row.ticker) && sk - lastStop.get(row.ticker) < lock) continue;
      const px = execPx(row.s.map.get(t)); if (!px || !(cash > fee)) continue;
      const spend = Math.min(budget, cash - fee); if (!(spend > 0)) continue;
      cash -= spend + fee; fees += fee;
      holdings.push({ s: row.s, shares: spend / px, last: px, entryPrice: px, buyT: t, wPeak: px, dPeakC: px, dPeakH: px, gtc: px * fG, pendingSell: false });
      held.add(row.ticker); filled++;
    }
    return filled;
  }
  for (const t of allDates) {
    if (t < windowStart || t > windowEnd) continue;
    const wk = weekKey(t);
    // 1) pending next-open sells (DC/DH)
    if (holdings.some(h => h.pendingSell)) {
      const keep = [];
      for (const h of holdings) {
        const bar = h.s.map.get(t);
        if (h.pendingSell && bar) sell(h, execPx(bar), t, 'stop', true); else keep.push(h);
      }
      if (keep.length < holdings.length && stopMode === 'IN') pendingBuy = true;
      holdings = keep;
    }
    // 2) weekly logic on first session of week
    if (wk !== lastWeekKey) {
      const pos = weekPos.get(wk), signalWeek = pos > 0 ? weeks[pos - 1] : null;
      const signalT = signalWeek?.last ?? null, tx = weeks[pos].first; // engine parity: weekly exec uses first session of week
      if (signalT != null) {
        const ranked = rankAt(score, signalT), sk = weekKey(signalT), benchRsl = benchRslAt(sk);
        lastRanked = ranked; lastSk = sk;
        if (!initialized) { if (tryBuys(ranked, tx, sk) > 0) initialized = true; }
        else {
          const keep = [];
          for (const h of holdings) {
            const p = h.s, wi = wIdxAtOrBefore(p, sk), stockRsl = wi >= 0 ? p.rsl[wi] : null;
            const ti = trailUpTo(p, sk), tr = ti >= 0 ? p.trail.slice(0, ti + 1) : [];
            const rank = ranked.byTicker.get(p.ticker)?.rank ?? null;
            const ev = evaluateTrailExit(tr, { rank, stockRsl, benchRsl }, { mode, rankTop, confirmWeeks, rsExit });
            const wclose = wi >= 0 ? p.W[wi].close : null;
            if (wclose != null && p.W[wi].time >= h.buyT) h.wPeak = Math.max(h.wPeak, wclose);
            let reason = ev.exitHint || null, isStop = false;
            if (!reason && (stopMode === 'W' || stopMode === 'WG') && wclose != null && wclose <= h.wPeak * f) { reason = 'stop'; isStop = true; }
            if (reason) { const px = execPx(p.map.get(tx)) ?? h.last; if (isStop) lastStop.set(p.ticker, sk); sell(h, px, t, reason, false); if (isStop) closed.at(-1).isStop = true; }
            else { h.gtc = h.wPeak * fG; keep.push(h); }
          }
          holdings = keep; tryBuys(ranked, tx, sk);
        }
      }
      lastWeekKey = wk; pendingBuy = false;
    } else if (pendingBuy) { tryBuys(lastRanked, t, lastSk); pendingBuy = false; }
    // 3) intraday stops
    if (stopMode === 'I' || stopMode === 'IN' || stopMode === 'G' || stopMode === 'WG') {
      const keep = [];
      for (const h of holdings) {
        const bar = h.s.map.get(t);
        if (!bar) { keep.push(h); continue; }
        const level = (stopMode === 'G' || stopMode === 'WG') ? h.gtc : h.dPeakH * f;
        if (bar.low <= level) {
          const px = bar.open < level ? bar.open : level;
          const wi = h.s.idx.get(wk), friClose = wi != null ? h.s.W[wi].close : null;
          sell(h, px, t, 'stop', true, { level, gap: bar.open < level, recovered: friClose != null && friClose > level,
            weeklyWouldFire: friClose != null && friClose <= Math.max(h.wPeak, friClose) * 0.8 });
          if (stopMode === 'IN') pendingBuy = true;
        } else { h.dPeakH = Math.max(h.dPeakH, bar.high); keep.push(h); }
      }
      holdings = keep;
    }
    // 4) close: marks + daily-close triggers
    for (const h of holdings) {
      const bar = h.s.map.get(t); if (!bar) continue;
      h.last = bar.close;
      if (stopMode === 'DC') { h.dPeakC = Math.max(h.dPeakC, bar.close); if (bar.close <= h.dPeakC * f) h.pendingSell = true; }
      if (stopMode === 'DH') { h.dPeakH = Math.max(h.dPeakH, bar.high); if (bar.close <= h.dPeakH * f) h.pendingSell = true; }
    }
    const value = cash + holdings.reduce((v, h) => v + h.shares * h.last, 0);
    peak = Math.max(peak, value); mdd = Math.min(mdd, value / peak - 1);
    equity.push({ t, value });
  }
  const years = (equity.at(-1).t - equity[0].t) / (365.25 * 86400), fin = equity.at(-1).value;
  const cagr = 100 * ((fin / startCapital) ** (1 / years) - 1);
  const sampled = []; let lw = null; for (const e of equity) { const w = weekKey(e.t); if (w !== lw) { sampled.push(e); lw = w; } }
  const rets = []; for (let i = 1; i < sampled.length; i++) rets.push(sampled[i].value / sampled[i - 1].value - 1);
  const stops = closed.filter(c => c.isStop);
  return { cagr, maxDD: 100 * mdd, mar: cagr / Math.abs(100 * mdd), sharpe: mean(rets) / sdev(rets) * Math.sqrt(52), final: fin, trades: closed.length, fees,
    winRate: 100 * closed.filter(c => c.pnlPct > 0).length / closed.length,
    stopExits: stops.length, stopAvg: mean(stops.map(s => s.pnlPct)), stopMed: median(stops.map(s => s.pnlPct)), stopWin: stops.length ? 100 * stops.filter(s => s.pnlPct > 0).length / stops.length : null,
    gaps: stops.filter(s => s.gap).length, recovered: stops.filter(s => s.recovered).length };
}

const BASES = [
  { id: 'user', label: 'Deine Variante RANK N5 RT25 RS1 (RSL26)', mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1, score: 'RSL26' },
  { id: 'confirm', label: 'CONFIRM N10 RT10 CW2 (RSL26)', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2, score: 'RSL26' },
  { id: 'user_mom', label: 'Deine Variante mit 12-1-Ranking (MOM 52-4)', mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1, score: 'MOM52_4' },
  // Optional extra bases (JSON list) via RSL_EXTRA_BASES, e.g. the DAX favourite; score must be RSL26 or MOM52_4.
  ...JSON.parse(process.env.RSL_EXTRA_BASES || '[]'),
];
// parity
const peakOf = h => Math.max(h.entryPrice, ...h.path.map(x => x.close ?? 0));
const parity = [];
for (const b of BASES.slice(0, 2)) {
  const ref = refRun(P, b.n, { ...b, startCapital: 10000, fee: 1, windowStart: ts('2016-11-09'), windowEnd: ts('2026-11-09'), extraExit: c => c.close <= peakOf(c.h) * 0.8 ? 'trail' : null, reentryCooldownWeeks: 4 });
  const mine = run(b, 'W', 0.2, ts('2016-11-09'), ts('2026-11-09'));
  parity.push({ base: b.id, ref: [ref.cagr, ref.maxDD, ref.trades], mine: [mine.cagr, mine.maxDD, mine.trades] });
  console.log('parity', b.id, ref.cagr.toFixed(3), mine.cagr.toFixed(3), ref.maxDD.toFixed(3), mine.maxDD.toFixed(3), ref.trades, mine.trades);
}
const MODES = { NONE: 'ohne Trailing-Stop', W: 'Wochenschluss vs. höchster Wochenschluss (aktuell)', DC: 'Tagesschluss vs. höchster Tagesschluss', DH: 'Tagesschluss vs. höchstes Tageshoch', I: 'Broker intraday (Hoch-Referenz, Tief löst aus)', IN: 'Broker intraday, Nachkauf am nächsten Tag', G: 'Wöchentlich gesetzter Stop (Freitagsschluss-Referenz), intraday' };
const PCTS = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
const WIN = [{ k: 'y10', label: '10 J.', a: '2016-11-09', b: '2026-11-09' }, { k: 'h1', label: '2016–21', a: '2016-11-09', b: '2021-11-08' }, { k: 'h2', label: '2021–26', a: '2021-11-09', b: '2026-11-09' }];
const results = [];
for (const b of BASES) for (const [m, ml] of Object.entries(MODES)) for (const p of (m === 'NONE' ? [0] : PCTS)) {
  const row = { base: b.id, baseLabel: b.label, mode: m, modeLabel: ml, pct: Math.round(p * 100) };
  for (const w of WIN) row[w.k] = run(b, m === 'NONE' ? 'X' : m, m === 'NONE' ? 1 : p, ts(w.a), ts(w.b));
  results.push(row);
  const y = row.y10;
  console.log(b.id.padEnd(8), m.padEnd(4), String(row.pct).padStart(2), y.cagr.toFixed(2), y.maxDD.toFixed(2), y.mar.toFixed(3), y.sharpe.toFixed(3), 'tr', y.trades, 'stops', y.stopExits, 'avg', y.stopAvg?.toFixed(1), 'gap', y.gaps, 'recov', y.recovered, '| h1', row.h1.cagr.toFixed(1), row.h1.maxDD.toFixed(1), 'h2', row.h2.cagr.toFixed(1), row.h2.maxDD.toFixed(1));
}
// combo: weekly-close 20 % (manual) + weekly-set broker GTC safety stop at wider distance
const combo = [];
for (const b of BASES) for (const g of [0.25, 0.30, 0.35, 0.40]) {
  const row = { base: b.id, baseLabel: b.label, mode: 'WG', modeLabel: `Wochenschluss 20 % + Broker-Sicherheitsstopp ${Math.round(g * 100)} % (wöchentlich gesetzt)`, pct: Math.round(g * 100) };
  for (const w of WIN) row[w.k] = run(b, 'WG', 0.2, ts(w.a), ts(w.b), g);
  combo.push(row); results.push(row);
  console.log('combo', b.id, g, row.y10.cagr.toFixed(2), row.y10.maxDD.toFixed(2), row.y10.mar.toFixed(3), row.y10.sharpe.toFixed(3), 'stops', row.y10.stopExits, 'recov', row.y10.recovered, '| h1', row.h1.cagr.toFixed(1), row.h1.maxDD.toFixed(1), 'h2', row.h2.cagr.toFixed(1), row.h2.maxDD.toFixed(1));
}
// robustness: shifted start weeks + finer p grid for key settings
const SHIFTS = [0, 1, 2, 3, 4, 13, 26, 39, 52];
const RCFG = [['W', [0.18, 0.2, 0.22]], ['I', [0.25, 0.27, 0.3, 0.33, 0.35]], ['IN', [0.3]], ['G', [0.22, 0.25, 0.28]], ['DH', [0.3]], ['NONE', [0]]];
const robust = [];
for (const b of BASES) for (const [m, ps] of RCFG) for (const p of ps) {
  const rr = SHIFTS.map(sh => run(b, m === 'NONE' ? 'X' : m, m === 'NONE' ? 1 : p, ts('2016-11-09') + sh * 7 * 86400, ts('2026-11-09')));
  const c = rr.map(r => r.cagr).sort((x, y) => x - y), mr = rr.map(r => r.mar).sort((x, y) => x - y), dd = rr.map(r => r.maxDD).sort((x, y) => x - y);
  robust.push({ base: b.id, mode: m, pct: Math.round(p * 100), cagrMin: c[0], cagrMed: c[4], cagrMax: c.at(-1), marMin: mr[0], marMed: mr[4], ddWorst: dd[0], ddMed: dd[4], y10: { cagr: rr[0].cagr, maxDD: rr[0].maxDD, mar: rr[0].mar, stopExits: rr[0].stopExits, recovered: rr[0].recovered } });
  console.log('robust', b.id, m, Math.round(p * 100), c[0].toFixed(1), c[4].toFixed(1), c.at(-1).toFixed(1), mr[0].toFixed(2), mr[4].toFixed(2), dd[0].toFixed(1), '| 10y', rr[0].cagr.toFixed(1), rr[0].maxDD.toFixed(1), 'stops', rr[0].stopExits, 'recov', rr[0].recovered);
}
writeFileSync(`${OUT}/${TAG}_Robustheit.csv`, toGermanCsv(robust.map(r => ({ base: BASES.find(b => b.id === r.base).label, mode: r.mode, pct: r.pct, cagr10: +r.y10.cagr.toFixed(2), dd10: +r.y10.maxDD.toFixed(2), cagrMin: +r.cagrMin.toFixed(2), cagrMed: +r.cagrMed.toFixed(2), cagrMax: +r.cagrMax.toFixed(2), marMin: +r.marMin.toFixed(3), marMed: +r.marMed.toFixed(3), ddWorst: +r.ddWorst.toFixed(2), ddMed: +r.ddMed.toFixed(2) })),
  [['base', 'Basis'], ['mode', 'Stop-Typ'], ['pct', 'Abstand %'], ['cagr10', 'CAGR 10 J. (Start 09.11.2016)'], ['dd10', 'MaxDD 10 J.'], ['cagrMin', 'CAGR min'], ['cagrMed', 'CAGR Median'], ['cagrMax', 'CAGR max'], ['marMin', 'MAR min'], ['marMed', 'MAR Median'], ['ddWorst', 'MaxDD schlechtester'], ['ddMed', 'MaxDD Median']].map(([key, label]) => ({ key, label }))));
const n = (v, d = 2) => v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(d);
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ generated: new Date().toISOString(), loaded: data.results.length, windows: WIN, bases: BASES, modes: MODES, parity, results, robust }, null, 1));
const K = [['cagr', 'CAGR', 2], ['maxDD', 'MaxDD', 2], ['mar', 'MAR', 3], ['sharpe', 'Sharpe', 3], ['trades', 'Trades', 0], ['fees', 'Gebühren $', 0], ['stopExits', 'Stop-Exits', 0], ['stopAvg', 'Ø Rendite Stop-Exits %', 2], ['stopMed', 'Median Stop-Exits %', 2], ['gaps', 'Gap-Fills', 0], ['recovered', 'Whipsaw (Freitag wieder über Stop)', 0]];
const rows = results.map(r => { const o = { base: r.baseLabel, mode: r.mode, modeLabel: r.modeLabel, pct: r.pct }; for (const w of WIN) for (const [k, , d] of K) o[`${w.k}_${k}`] = n(r[w.k][k], d); return o; });
const cols = [['base', 'Basis'], ['mode', 'Stop-Typ'], ['modeLabel', 'Beschreibung'], ['pct', 'Abstand %']].map(([key, label]) => ({ key, label })).concat(WIN.flatMap(w => K.map(([k, l]) => ({ key: `${w.k}_${k}`, label: `${l} ${w.label}` }))));
writeFileSync(`${OUT}/${TAG}.csv`, toGermanCsv(rows, cols));
console.log('wrote');
process.exit(0);
