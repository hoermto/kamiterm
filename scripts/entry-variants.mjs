#!/usr/bin/env node
/**
 * Entry-variant research for the weekly RSL rotation (analysis only, production untouched).
 * Engine = copy of scripts/lib/rotation-hooks.mjs runBacktest with pluggable ranking score,
 * candidate selection (entry filters / fill depth) and built-in trailing stop + re-entry lock.
 * Exit logic (RRG via evaluateTrailExit, RS-exit on RSL26) is unchanged unless a config says so.
 * Usage: node scripts/entry-variants.mjs [--quick]
 */
import { writeFileSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { evaluateTrailExit, iso, toGermanCsv } from '../lib/fn/grokki-math.js';
import { prepare, wIdxAtOrBefore, runBacktest as refRun } from './lib/rotation-hooks.mjs';

const OUT = '/workspace/thoBox/Grokki/strategies';
const TAG = 'RSL26_Entry_Varianten_2026-11-10';
const ts = s => Date.parse(s + 'T00:00:00Z') / 1000;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const weekKey = t => Math.floor((t + 3 * 86400) / (7 * 86400));

// ---------- data
const t0 = Date.now();
const u = universe({ universe: 'SPX' });
const [benchmark, data] = await Promise.all([history('^GSPC', 12), batch(u.tickers, t => history(t, 12), 300000, 8)]);
const P = prepare(data.results, benchmark.bars);
console.log(`loaded ${data.results.length}/${u.tickers.length} in ${Date.now() - t0}ms`);

// ---------- extra per-ticker indicators (point in time, weekly closes incl. signal week)
const LENS = [10, 13, 16, 20, 26, 30, 35, 39, 45, 52];
const MOMS = [[52, 4], [52, 0], [52, 2], [52, 8], [39, 4], [65, 4]];
function rollRsl(W, L) { const out = new Array(W.length).fill(null); let s = 0; for (let i = 0; i < W.length; i++) { s += W[i].close; if (i >= L) s -= W[i - L].close; if (i >= L - 1) out[i] = W[i].close / (s / L); } return out; }
for (const p of [...P.prepped, P.bench]) {
  p.rslL = Object.fromEntries(LENS.map(L => [L, rollRsl(p.W, L)]));
  p.roc13 = p.W.map((w, i) => i >= 13 ? w.close / p.W[i - 13].close - 1 : null);
  p.mom = Object.fromEntries(MOMS.map(([lb, sk]) => [`${lb}_${sk}`, p.W.map((w, i) => i >= lb ? p.W[i - sk].close / p.W[i - lb].close - 1 : null)]));
  p.rslChg4 = p.W.map((w, i) => i >= 4 && p.rsl[i] != null && p.rsl[i - 4] != null ? p.rsl[i] - p.rsl[i - 4] : null);
}
function trailUpTo(p, k) { let lo = 0, hi = p.trail.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.trail[m].key <= k) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
const quadAt = (p, sk) => { const ti = trailUpTo(p, sk); return ti >= 0 && sk - p.trail[ti].key <= 1 ? p.trail[ti].quadrant : null; };
const ratioAt = (p, sk) => { const ti = trailUpTo(p, sk); return ti >= 0 && sk - p.trail[ti].key <= 1 ? p.trail[ti].ratio : null; };

// ---------- engine
const allDates = [...new Set(P.prepped.flatMap(s => s.bars.map(b => b.time)))].sort((a, b) => a - b);
const byWeek = new Map();
for (const t of allDates) { const k = weekKey(t); if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(t); }
const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([key, days]) => ({ key, first: days[0], last: days.at(-1) }));
const weekPos = new Map(weeks.map((w, i) => [w.key, i]));
const rankCaches = new Map(); // scoreId -> Map(signalT -> ranked)

/** score kinds: {type:'rsl',L} | {type:'roc13'} | {type:'mom12_1'} | {type:'rsratio'} | {type:'rankavg', parts:[score,...]} */
function scoreId(sc) { return JSON.stringify(sc); }
function rawScore(sc, p, i, sk) {
  switch (sc.type) {
    case 'rsl': return sc.L === 26 ? p.rsl[i] : p.rslL[sc.L][i];
    case 'roc13': return p.roc13[i];
    case 'mom': return p.mom[`${sc.lb}_${sc.skip}`][i];
    case 'rslchg4': return p.rslChg4[i];
    case 'rsratio': return ratioAt(p, sk);
    default: throw new Error('score ' + sc.type);
  }
}
function rankAt(sc, signalT) {
  const id = scoreId(sc);
  if (!rankCaches.has(id)) rankCaches.set(id, new Map());
  const C = rankCaches.get(id);
  if (C.has(signalT)) return C.get(signalT);
  const k = weekKey(signalT);
  let rows = [];
  if (sc.type === 'rankavg') {
    const subs = sc.parts.map(ps => rankAt(ps, signalT));
    const base = subs[0];
    for (const r of base.rows) {
      const rs = subs.map(S => S.byTicker.get(r.ticker)?.rank);
      if (rs.some(x => x == null)) continue;
      rows.push({ ticker: r.ticker, score: -mean(rs.map((x, j) => x * (sc.w?.[j] ?? 1))), tie: r.rank, s: r.s, wi: r.wi });
    }
    rows.sort((a, b) => b.score - a.score || a.tie - b.tie);
  } else {
    for (const p of P.prepped) {
      const i = wIdxAtOrBefore(p, k);
      if (i < 0) continue;
      if (!(signalT - p.W[i].time <= 7 * 86400)) continue;
      if (p.rsl[i] == null) continue; // same eligibility as engine (>= 26 weekly bars)
      const s = rawScore(sc, p, i, k);
      if (s == null) continue;
      rows.push({ ticker: p.ticker, score: s, s: p, wi: i });
    }
    rows.sort((a, b) => b.score - a.score);
  }
  rows.forEach((r, i) => { r.rank = i + 1; });
  const out = { rows, byTicker: new Map(rows.map(r => [r.ticker, r])) };
  C.set(signalT, out);
  return out;
}
const RSL26 = { type: 'rsl', L: 26 };

/**
 * cfg: mode, n, rankTop, rsExit, confirmWeeks,
 *   score (ranking for entry), protectScore (ranking used for rank protection; default = score),
 *   rsL (RSL length used for RS-exit; default 26), filter(ctx)->bool, fillDepth (#ranked rows scanned; default n),
 *   order(rows, ctx)->rows (custom candidate order), trail (fraction or 0), lock (weeks after trail exit), regime(ctx)->bool (allow new buys)
 */
function run(cfg, windowStart, windowEnd) {
  const { mode, rankTop = 25, rsExit = false, trail = 0, lock = 4 } = cfg;
  const confirmWeeks = Math.max(1, Math.min(8, cfg.confirmWeeks | 0 || 1));
  const nSlots = cfg.n, fee = 1, startCapital = 10000;
  const score = cfg.score || RSL26, protectScore = cfg.protectScore || score, rsL = cfg.rsL || 26;
  const fillDepth = cfg.fillDepth || nSlots;
  const lastExtraExit = new Map();
  const benchRslAt = k => { const i = wIdxAtOrBefore(P.bench, k); return i >= 0 ? (rsL === 26 ? P.bench.rsl[i] : P.bench.rslL[rsL][i]) : null; };
  let cash = startCapital, holdings = [], peak = startCapital, mdd = 0, initialized = false, lastWeekKey = null, totalFees = 0;
  const equity = [], closed = [];
  const execPx = bar => bar?.open > 0 ? bar.open : bar?.close > 0 ? bar.close : null;
  const eqOpen = execT => { let v = cash; for (const h of holdings) v += h.shares * (execPx(h.s.map.get(execT)) ?? h.last); return v; };
  function buy(row, execT, budget) {
    const px = execPx(row.s.map.get(execT));
    if (!px || !(cash > fee) || !(budget > 0)) return false;
    const spend = Math.min(budget, cash - fee); if (!(spend > 0)) return false;
    cash -= spend + fee; totalFees += fee;
    holdings.push({ s: row.s, shares: spend / px, last: px, entryPrice: px, buyT: execT, peak: px, feePaid: fee, entryRank: row.rank });
    return true;
  }
  function candidates(ranked, ctx) {
    let rows = ranked.rows.slice(0, fillDepth);
    if (cfg.order) rows = cfg.order(rows, ctx);
    return rows;
  }
  function tryBuys(ranked, execT, signalT, sk, benchRsl) {
    const ctx = { signalT, sk, benchRsl };
    if (cfg.regime && !cfg.regime(ctx)) return 0;
    const budget = eqOpen(execT) / nSlots, held = new Set(holdings.map(h => h.s.ticker));
    let filled = 0;
    for (const row of candidates(ranked, ctx)) {
      if (holdings.length >= nSlots) break;
      if (held.has(row.ticker) || !row.s.map.get(execT)) continue;
      if (lock > 0 && lastExtraExit.has(row.ticker) && sk - lastExtraExit.get(row.ticker) < lock) continue;
      if (cfg.filter && !cfg.filter({ ...ctx, row, p: row.s })) continue;
      if (buy(row, execT, budget)) { held.add(row.ticker); filled++; }
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
        const ranked = rankAt(score, signalT), protect = protectScore === score ? ranked : rankAt(protectScore, signalT);
        const sk = weekKey(signalT), benchRsl = benchRslAt(sk);
        if (!initialized) { if (tryBuys(ranked, execT, signalT, sk, benchRsl) > 0) initialized = true; }
        else {
          const keep = [];
          for (const h of holdings) {
            const p = h.s, wi = wIdxAtOrBefore(p, sk);
            const stockRsl = wi >= 0 ? (rsL === 26 ? p.rsl[wi] : p.rslL[rsL][wi]) : null;
            const ti = trailUpTo(p, sk), tr = ti >= 0 ? p.trail.slice(0, ti + 1) : [];
            const rank = protect.byTicker.get(p.ticker)?.rank ?? null;
            const ev = evaluateTrailExit(tr, { rank, stockRsl, benchRsl }, { mode, rankTop, confirmWeeks, rsExit });
            const wclose = wi >= 0 ? p.W[wi].close : null;
            if (wclose != null) h.peak = Math.max(h.peak, wclose);
            let reason = ev.exitHint || null, extra = false;
            if (!reason && trail > 0 && wclose != null && wclose <= h.peak * (1 - trail)) { reason = 'trail'; extra = true; }
            if (reason) {
              const px = execPx(p.map.get(execT)) ?? h.last;
              const gross = h.shares * px, cost = h.shares * h.entryPrice;
              cash += gross - fee; totalFees += fee;
              if (extra) lastExtraExit.set(p.ticker, sk);
              closed.push({ ticker: p.ticker, pnl: gross - cost - h.feePaid - fee, pnlPct: 100 * (gross - cost - h.feePaid - fee) / cost, holdDays: (execT - h.buyT) / 86400, reason, extra, entryRank: h.entryRank });
            } else keep.push(h);
          }
          holdings = keep;
          tryBuys(ranked, execT, signalT, sk, benchRsl);
        }
      }
      lastWeekKey = wk;
    }
    for (const h of holdings) if (h.s.map.has(t)) h.last = h.s.map.get(t).close;
    const value = cash + holdings.reduce((v, h) => v + h.shares * h.last, 0);
    peak = Math.max(peak, value); mdd = Math.min(mdd, value / peak - 1);
    equity.push({ time: iso(t), value, invested: value - cash });
  }
  const years = (Date.parse(equity.at(-1).time) - Date.parse(equity[0].time)) / (365.25 * 86400e3);
  const fin = equity.at(-1).value, cagr = 100 * ((fin / startCapital) ** (1 / years) - 1);
  const sampled = []; let lastW = null;
  for (const e of equity) { const w = Math.floor((Date.parse(e.time + 'T00:00:00Z') / 86400e3 + 3) / 7); if (w !== lastW) { sampled.push(e); lastW = w; } }
  const rets = []; for (let i = 1; i < sampled.length; i++) rets.push(sampled[i].value / sampled[i - 1].value - 1);
  const m = mean(rets), sd = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1));
  const wins = closed.filter(x => x.pnl > 0).length;
  return { cagr, maxDD: 100 * mdd, mar: cagr / Math.abs(100 * mdd), sharpe: m / sd * Math.sqrt(52), finalEquity: fin, trades: closed.length, open: holdings.length,
    winRate: 100 * wins / Math.max(1, closed.length), fees: totalFees, holdW: mean(closed.map(x => x.holdDays)) / 7, trailExits: closed.filter(x => x.extra).length,
    investedPct: 100 * mean(equity.map(e => e.invested / e.value)) };
}

// ---------- parity check vs. scripts/lib/rotation-hooks.mjs (which reproduces production engine)
const peakOf = h => Math.max(h.entryPrice, ...h.path.map(x => x.close ?? 0));
const W10 = [ts('2016-11-09'), ts('2026-11-09')];
const BASES = [
  { id: 'user', label: 'Deine Variante RANK N5 RT25 RS1', mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  { id: 'confirm', label: 'Empfohlen CONFIRM N10 RT10 RS0 CW2', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
];
const parity = [];
for (const b of BASES) for (const tr of [0, 0.2]) {
  const ref = refRun(P, b.n, { ...b, startCapital: 10000, fee: 1, windowStart: W10[0], windowEnd: W10[1], ...(tr ? { extraExit: c => c.close <= peakOf(c.h) * 0.8 ? 'trail' : null, reentryCooldownWeeks: 4 } : {}) });
  const mine = run({ ...b, trail: tr, lock: tr ? 4 : 0 }, ...W10);
  parity.push({ base: b.id, trail: tr, refCagr: ref.cagr, refDD: ref.maxDD, refTrades: ref.trades, cagr: mine.cagr, maxDD: mine.maxDD, trades: mine.trades });
  console.log('parity', b.id, tr, ref.cagr.toFixed(2), mine.cagr.toFixed(2), ref.maxDD.toFixed(2), mine.maxDD.toFixed(2), ref.trades, mine.trades);
}

// ---------- configs
const Q = (row, sk) => quadAt(row.s, sk);
const CONFIGS = [
  ...LENS.map(L => ({ id: `L${L}`, group: [35, 45, 52].includes(L) ? 'E Nachbarn RSL lang' : 'A Ranking-Länge', supp: [35, 45, 52].includes(L), label: `Ranking RSL${L}${L === 26 ? ' (Basis)' : ''}`, score: { type: 'rsl', L } })),
  { id: 'L20_rs20', group: 'A Ranking-Länge', label: 'Ranking RSL20 + RS-Exit ebenfalls auf RSL20', score: { type: 'rsl', L: 20 }, rsL: 20, onlyRs: true },
  { id: 'L20_prot26', group: 'A Ranking-Länge', label: 'Ranking RSL20, Rank-Schutz weiter nach RSL26-Rang', score: { type: 'rsl', L: 20 }, protectScore: RSL26 },
  { id: 'RRG_lead_skip', group: 'B RRG-Einstieg', label: 'Nur kaufen wenn RRG Leading (Slot bleibt sonst leer)', filter: c => Q(c.row, c.sk) === 'Leading' },
  { id: 'RRG_lead_fill', group: 'B RRG-Einstieg', label: 'Nur RRG Leading, nachrücken aus Top 25', filter: c => Q(c.row, c.sk) === 'Leading', fillDepth: 25 },
  { id: 'RRG_li_fill', group: 'B RRG-Einstieg', label: 'Nur RRG Leading/Improving, nachrücken aus Top 25', filter: c => ['Leading', 'Improving'].includes(Q(c.row, c.sk)), fillDepth: 25 },
  { id: 'RRG_imp_first', group: 'B RRG-Einstieg', label: 'Improving bevorzugt (aus Top 25), dann RSL-Reihenfolge', fillDepth: 25, order: (rows, c) => [...rows.filter(r => Q(r, c.sk) === 'Improving'), ...rows.filter(r => Q(r, c.sk) !== 'Improving')] },
  { id: 'RRG_ratio', group: 'B RRG-Einstieg', label: 'Ranking nach RRG RS-Ratio statt RSL', score: { type: 'rsratio' } },
  { id: 'C_26_13', group: 'C Kombi-Score', label: 'Ø Rang aus RSL26 und RSL13', score: { type: 'rankavg', parts: [RSL26, { type: 'rsl', L: 13 }] } },
  { id: 'C_26_10', group: 'C Kombi-Score', label: 'Ø Rang aus RSL26 und RSL10', score: { type: 'rankavg', parts: [RSL26, { type: 'rsl', L: 10 }] } },
  { id: 'C_26_d4', group: 'C Kombi-Score', label: 'Ø Rang aus RSL26 und RSL-Änderung 4 Wo.', score: { type: 'rankavg', parts: [RSL26, { type: 'rslchg4' }] } },
  { id: 'D_regime', group: 'D Weitere', label: 'Keine Neukäufe wenn S&P-RSL26 < 1,0 (Regime), Aktie RSL > 1,0', regime: c => !(c.benchRsl != null && c.benchRsl < 1), filter: c => c.row.s.rsl[c.row.wi] > 1 },
  { id: 'D_relbench', group: 'D Weitere', label: 'Kauf nur wenn RSL Aktie > RSL S&P', filter: c => c.benchRsl == null || c.row.s.rsl[c.row.wi] > c.benchRsl },
  { id: 'D_roc13', group: 'D Weitere', label: 'Ranking nach 13-Wochen-Rendite (ROC13)', score: { type: 'roc13' } },
  { id: 'D_mom12_1', group: 'D Weitere', label: 'Ranking 12-1-Momentum (52 Wo. ohne letzte 4 Wo.)', score: { type: 'mom', lb: 52, skip: 4 } },
  { id: 'D_roc52', group: 'E Nachbarn 12-1', label: 'Ranking 52-Wochen-Rendite (ohne Auslassung)', score: { type: 'mom', lb: 52, skip: 0 }, supp: true },
  { id: 'D_mom52_2', group: 'E Nachbarn 12-1', label: 'Momentum 52 Wo. ohne letzte 2 Wo.', score: { type: 'mom', lb: 52, skip: 2 }, supp: true },
  { id: 'D_mom52_8', group: 'E Nachbarn 12-1', label: 'Momentum 52 Wo. ohne letzte 8 Wo.', score: { type: 'mom', lb: 52, skip: 8 }, supp: true },
  { id: 'D_mom39_4', group: 'E Nachbarn 12-1', label: 'Momentum 39 Wo. ohne letzte 4 Wo.', score: { type: 'mom', lb: 39, skip: 4 }, supp: true },
  { id: 'D_mom65_4', group: 'E Nachbarn 12-1', label: 'Momentum 65 Wo. ohne letzte 4 Wo.', score: { type: 'mom', lb: 65, skip: 4 }, supp: true },
  { id: 'C_26_mom', group: 'E Nachbarn 12-1', label: 'Ø Rang aus RSL26 und 12-1-Momentum', score: { type: 'rankavg', parts: [RSL26, { type: 'mom', lb: 52, skip: 4 }] }, supp: true },
  { id: 'C_39_mom', group: 'E Nachbarn 12-1', label: 'Ø Rang aus RSL39 und 12-1-Momentum', score: { type: 'rankavg', parts: [{ type: 'rsl', L: 39 }, { type: 'mom', lb: 52, skip: 4 }] }, supp: true },
  { id: 'D_lock8', group: 'D Weitere', label: 'Wiederkauf-Sperre nach Trailing-Exit 8 Wo.', lock: 8, onlyTrail: true },
  { id: 'D_lock13', group: 'D Weitere', label: 'Wiederkauf-Sperre nach Trailing-Exit 13 Wo.', lock: 13, onlyTrail: true },
];
const WIN = [
  { k: 'y10', label: '10 J.', a: '2016-11-09', b: '2026-11-09' },
  { k: 'h1', label: '2016–21', a: '2016-11-09', b: '2021-11-08' },
  { k: 'h2', label: '2021–26', a: '2021-11-09', b: '2026-11-09' },
];
const results = [];
const tStart = Date.now();
for (const b of BASES) for (const tr of [0, 0.2]) for (const c of CONFIGS) {
  if (c.onlyRs && !b.rsExit) continue;
  if (c.onlyTrail && !tr) continue;
  const cfg = { ...b, ...c, id: c.id, trail: tr, lock: tr ? (c.lock ?? 4) : 0 };
  const row = { base: b.id, baseLabel: b.label, trail: tr ? 'Trail 20 %/Sperre ' + cfg.lock : 'ohne', cfgId: c.id, group: c.group, cfgLabel: c.label };
  for (const w of WIN) row[w.k] = run(cfg, ts(w.a), ts(w.b));
  results.push(row);
  console.log(b.id.padEnd(8), (tr ? 'T' : '-'), c.id.padEnd(14), ['y10', 'h1', 'h2'].map(k => `${row[k].cagr.toFixed(1)}/${row[k].maxDD.toFixed(1)}`).join('  '), 'MAR', row.y10.mar.toFixed(3), 'tr', row.y10.trades);
}
console.log('grid done in', ((Date.now() - tStart) / 1000).toFixed(0), 's');

// ---------- robustness: shifted start weeks for baseline + top candidates (by 10y MAR, both halves >= baseline CAGR-5)
const SHIFTS = [0, 1, 2, 3, 4, 13, 26, 39, 52];
const robust = [];
const pick = new Set(['L26']);
for (const b of BASES) for (const tr of [0, 0.2]) {
  const rs = results.filter(r => r.base === b.id && r.trail.startsWith(tr ? 'Trail' : 'ohne'));
  const sorted = [...rs].sort((x, y) => y.y10.mar - x.y10.mar);
  sorted.slice(0, 4).forEach(r => pick.add(r.cfgId));
}
for (const extra of ['L20', 'L16', 'L13', 'L30', 'L39', 'L45', 'L52', 'RRG_lead_fill', 'RRG_imp_first', 'C_26_13', 'D_mom12_1', 'D_roc52', 'D_mom39_4', 'C_26_mom', 'D_regime']) pick.add(extra);
for (const b of BASES) for (const tr of [0, 0.2]) for (const id of pick) {
  const c = CONFIGS.find(x => x.id === id);
  if ((c.onlyRs && !b.rsExit) || (c.onlyTrail && !tr)) continue;
  const cfg = { ...b, ...c, trail: tr, lock: tr ? (c.lock ?? 4) : 0 };
  const runs = SHIFTS.map(s => run(cfg, ts('2016-11-09') + s * 7 * 86400, ts('2026-11-09')));
  const cg = runs.map(r => r.cagr).sort((a, b) => a - b), md = runs.map(r => r.mar).sort((a, b) => a - b), dd = runs.map(r => r.maxDD).sort((a, b) => a - b);
  robust.push({ base: b.id, trail: tr ? 'Trail 20 %' : 'ohne', cfgId: id, cfgLabel: c.label, cagrMin: cg[0], cagrMed: cg[(cg.length - 1) >> 1], cagrMax: cg.at(-1), marMin: md[0], marMed: md[(md.length - 1) >> 1], ddWorst: dd[0], ddMed: dd[(dd.length - 1) >> 1], runs: runs.map(r => ({ cagr: r.cagr, maxDD: r.maxDD, mar: r.mar })) });
  console.log('robust', b.id, tr, id, cg[0].toFixed(1), cg[(cg.length - 1) >> 1].toFixed(1), md[0].toFixed(2), md[(md.length - 1) >> 1].toFixed(2), dd[0].toFixed(1));
}

// ---------- output
const n = (v, d = 2) => v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(d);
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ generated: new Date().toISOString(), loaded: data.results.length, requested: u.tickers.length, windows: WIN, bases: BASES, shifts: SHIFTS, parity, configs: CONFIGS.map(c => ({ id: c.id, group: c.group, label: c.label })), results, robust }, null, 1));
const KEYS = [['cagr', 'CAGR', 2], ['maxDD', 'MaxDD', 2], ['mar', 'MAR', 3], ['sharpe', 'Sharpe', 3], ['trades', 'Trades', 0], ['fees', 'Gebühren $', 0], ['winRate', 'Winrate %', 1], ['holdW', 'Halte-Wo.', 1], ['trailExits', 'Trailing-Exits', 0], ['investedPct', 'Investiert %', 1], ['finalEquity', 'Endwert', 0]];
const csvRows = results.map(r => { const o = { base: r.baseLabel, trail: r.trail, group: r.group, id: r.cfgId, label: r.cfgLabel }; for (const w of WIN) for (const [k, , d] of KEYS) o[`${w.k}_${k}`] = n(r[w.k][k], d); return o; });
const cols = [['base', 'Basis'], ['trail', 'Trailing-Stop'], ['group', 'Gruppe'], ['id', 'Config-ID'], ['label', 'Beschreibung']].map(([key, label]) => ({ key, label }))
  .concat(WIN.flatMap(w => KEYS.map(([k, l]) => ({ key: `${w.k}_${k}`, label: `${l} ${w.label}` }))));
writeFileSync(`${OUT}/${TAG}.csv`, toGermanCsv(csvRows, cols));
writeFileSync(`${OUT}/${TAG}_Robustheit.csv`, toGermanCsv(robust.map(r => ({ ...r, cagrMin: n(r.cagrMin), cagrMed: n(r.cagrMed), cagrMax: n(r.cagrMax), marMin: n(r.marMin, 3), marMed: n(r.marMed, 3), ddWorst: n(r.ddWorst), ddMed: n(r.ddMed) })),
  [['base', 'Basis'], ['trail', 'Trailing-Stop'], ['cfgId', 'Config-ID'], ['cfgLabel', 'Beschreibung'], ['cagrMin', 'CAGR min'], ['cagrMed', 'CAGR Median'], ['cagrMax', 'CAGR max'], ['marMin', 'MAR min'], ['marMed', 'MAR Median'], ['ddWorst', 'MaxDD schlechtester'], ['ddMed', 'MaxDD Median']].map(([key, label]) => ({ key, label }))));
console.log('wrote', OUT);
process.exit(0);
