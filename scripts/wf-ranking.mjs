#!/usr/bin/env node
/**
 * Walk-forward for the ranking source of the weekly RSL rotation (analysis only, production untouched).
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

const OUT = '/workspace/thoBox/Grokki/strategies';
const TAG = 'RSL26_WalkForward_Ranking_2026-11-10';
const ts = s => Date.parse(s + 'T00:00:00Z') / 1000;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sdev = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const weekKey = t => Math.floor((t + 3 * 86400) / (7 * 86400));
const yearOf = t => +iso(t).slice(0, 4);

const u = universe({ universe: 'SPX' });
const [benchmark, data] = await Promise.all([history('^GSPC', 12), batch(u.tickers, t => history(t, 12), 300000, 8)]);
const P = prepare(data.results, benchmark.bars);
console.log(`loaded ${data.results.length}/${u.tickers.length}; first bar ${iso(Math.min(...data.results.map(s => s.bars[0].time)))}`);

function rollRsl(W, L) { const out = new Array(W.length).fill(null); let s = 0; for (let i = 0; i < W.length; i++) { s += W[i].close; if (i >= L) s -= W[i - L].close; if (i >= L - 1) out[i] = W[i].close / (s / L); } return out; }
const MOMS = [[52, 4], [52, 2], [65, 4]];
for (const p of P.prepped) {
  p.rsl39 = rollRsl(p.W, 39);
  p.mom = Object.fromEntries(MOMS.map(([lb, sk]) => [`${lb}_${sk}`, p.W.map((w, i) => i >= lb ? p.W[i - sk].close / p.W[i - lb].close - 1 : null)]));
}
const CANDS = {
  RSL26: { label: 'RSL26 (Basis)', f: (p, i) => p.rsl[i] },
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
  const C = caches[cid]; if (C.has(signalT)) return C.get(signalT);
  const k = weekKey(signalT), rows = [];
  for (const p of P.prepped) {
    const i = wIdxAtOrBefore(p, k);
    if (i < 0 || !(signalT - p.W[i].time <= 7 * 86400) || p.rsl[i] == null) continue;
    const s = CANDS[cid].f(p, i); if (s == null) continue;
    rows.push({ ticker: p.ticker, score: s, s: p, wi: i });
  }
  rows.sort((a, b) => b.score - a.score); rows.forEach((r, i) => { r.rank = i + 1; });
  const out = { rows, byTicker: new Map(rows.map(r => [r.ticker, r])) }; C.set(signalT, out); return out;
}

/** schedule: function(execT) -> candidate id. Ranking switch takes effect at the first Monday of a new year. */
function run(base, schedule, windowStart, windowEnd, { trail = 0.2, lock = 4 } = {}) {
  const { mode, rankTop, rsExit, n: nSlots } = base, confirmWeeks = base.confirmWeeks || 1, fee = 1, startCapital = 10000;
  const lastExtraExit = new Map();
  let cash = startCapital, holdings = [], peak = startCapital, mdd = 0, initialized = false, lastWeekKey = null, trades = 0, fees = 0;
  const equity = [];
  const execPx = bar => bar?.open > 0 ? bar.open : bar?.close > 0 ? bar.close : null;
  const eqOpen = execT => { let v = cash; for (const h of holdings) v += h.shares * (execPx(h.s.map.get(execT)) ?? h.last); return v; };
  const benchRslAt = k => { const i = wIdxAtOrBefore(P.bench, k); return i >= 0 ? P.bench.rsl[i] : null; };
  function tryBuys(ranked, execT, sk) {
    const budget = eqOpen(execT) / nSlots, held = new Set(holdings.map(h => h.s.ticker)); let filled = 0;
    for (const row of ranked.rows.slice(0, nSlots)) {
      if (holdings.length >= nSlots) break;
      if (held.has(row.ticker) || !row.s.map.get(execT)) continue;
      if (lock > 0 && lastExtraExit.has(row.ticker) && sk - lastExtraExit.get(row.ticker) < lock) continue;
      const px = execPx(row.s.map.get(execT)); if (!px || !(cash > fee)) continue;
      const spend = Math.min(budget, cash - fee); if (!(spend > 0)) continue;
      cash -= spend + fee; fees += fee;
      holdings.push({ s: row.s, shares: spend / px, last: px, entryPrice: px, peak: px }); held.add(row.ticker); filled++;
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
            const ev = evaluateTrailExit(tr, { rank, stockRsl, benchRsl }, { mode, rankTop, confirmWeeks, rsExit });
            const wclose = wi >= 0 ? p.W[wi].close : null;
            if (wclose != null) h.peak = Math.max(h.peak, wclose);
            let reason = ev.exitHint || null, extra = false;
            if (!reason && trail > 0 && wclose != null && wclose <= h.peak * (1 - trail)) { reason = 'trail'; extra = true; }
            if (reason) {
              const px = execPx(p.map.get(execT)) ?? h.last; cash += h.shares * px - fee; fees += fee; trades++;
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
    equity.push({ t, time: iso(t), value });
  }
  return stats(equity, { trades, fees, mdd, start: startCapital });
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

// ---------- parity vs earlier engine (fixed RSL26, 10y)
const BASES = {
  user: { label: 'Deine Variante RANK N5 RT25 RS1', mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  confirm: { label: 'CONFIRM N10 RT10 CW2 (ohne RS-Exit)', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
};
const peakOf = h => Math.max(h.entryPrice, ...h.path.map(x => x.close ?? 0));
const parity = {};
for (const [bid, b] of Object.entries(BASES)) {
  const ref = refRun(P, b.n, { ...b, startCapital: 10000, fee: 1, windowStart: ts('2016-11-09'), windowEnd: ts('2026-11-09'), extraExit: c => c.close <= peakOf(c.h) * 0.8 ? 'trail' : null, reentryCooldownWeeks: 4 });
  const mine = run(b, () => 'RSL26', ts('2016-11-09'), ts('2026-11-09'));
  parity[bid] = { ref: [ref.cagr, ref.maxDD, ref.trades], mine: [mine.cagr, mine.maxDD, mine.trades] };
  console.log('parity', bid, ref.cagr.toFixed(2), mine.cagr.toFixed(2), ref.maxDD.toFixed(2), mine.maxDD.toFixed(2), ref.trades, mine.trades);
}

const ANCHOR = ts('2016-11-09'), OOS_START = ts('2018-01-01'), END = ts('2026-11-09');
const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const SBENCH = (() => { const eq = benchmark.bars.filter(b => b.time >= OOS_START && b.time <= END).map(b => ({ t: b.time, value: b.close })); return stats(eq); })();

// ---------- (a) fixed rankings, continuous carry run over OOS years
const fixed = {};
for (const bid of Object.keys(BASES)) {
  fixed[bid] = {};
  for (const cid of Object.keys(CANDS)) {
    const r = run(BASES[bid], () => cid, OOS_START, END);
    fixed[bid][cid] = r;
    console.log('fixed', bid, cid.padEnd(8), r.cagr.toFixed(2), r.maxDD.toFixed(2), r.mar.toFixed(3), r.sharpe.toFixed(3), YEARS.map(y => r.yearly[y].ret.toFixed(0)).join(' '));
  }
}
// ---------- stats tests
function tcdf(t, df) { // two-sided p via regularized incomplete beta
  const x = df / (df + t * t);
  return ibeta(x, df / 2, 0.5);
}
function ibeta(x, a, b) { // regularized incomplete beta I_x(a,b) via continued fraction
  if (x <= 0) return 0; if (x >= 1) return 1;
  const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b + lbeta);
  if (x < (a + 1) / (a + b + 2)) return front * betacf(x, a, b) / a;
  return 1 - front * betacf(1 - x, b, a) / b;
}
function betacf(x, a, b) { let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap; d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2)); d = 1 + aa * d; d = 1 / d; c = 1 + aa / c; h *= d * c; aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)); d = 1 + aa * d; d = 1 / d; c = 1 + aa / c; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break; } return h; }
function lgamma(z) { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z); z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x); }
function binom2(k, n) { // two-sided sign test p
  const pmf = i => Math.exp(lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) - n * Math.log(2));
  const lo = Math.min(k, n - k); let p = 0; for (let i = 0; i <= lo; i++) p += pmf(i); return Math.min(1, 2 * p);
}
function paired(a, b) {
  const d = a.map((x, i) => x - b[i]), n = d.length, m = mean(d), s = sdev(d), t = m / (s / Math.sqrt(n));
  const wins = d.filter(x => x > 0).length;
  return { n, meanDiff: m, sd: s, t, p: tcdf(t, n - 1), wins, signP: binom2(wins, n) };
}
const tests = [];
for (const bid of Object.keys(BASES)) for (const cid of ['RSL39', 'MOM52_4', 'MOM52_2', 'MOM65_4']) {
  const A = fixed[bid][cid], B = fixed[bid].RSL26;
  const ty = paired(YEARS.map(y => A.yearly[y].ret), YEARS.map(y => B.yearly[y].ret));
  const tw = paired(A.weekRets, B.weekRets);
  tests.push({ base: bid, cand: cid, years: ty, weeks: tw });
  console.log('test', bid, cid, 'yrs wins', ty.wins + '/' + ty.n, 'meanDiff', ty.meanDiff.toFixed(1), 't', ty.t.toFixed(2), 'p', ty.p.toFixed(3), 'sign p', ty.signP.toFixed(3), '| weeks wins', tw.wins + '/' + tw.n, 't', tw.t.toFixed(2), 'p', tw.p.toFixed(3));
}

// ---------- (b) adaptive walk-forward
const SETS = { core3: ['RSL26', 'RSL39', 'MOM52_4'], ext5: Object.keys(CANDS) };
const WINDOWS = { expanding: Y => ANCHOR, roll3: Y => Math.max(ANCHOR, ts(`${Y - 3}-01-01`)), roll5: Y => Math.max(ANCHOR, ts(`${Y - 5}-01-01`)) };
const isCache = new Map();
const isRun = (bid, cid, a, b) => { const k = `${bid}|${cid}|${a}|${b}`; if (!isCache.has(k)) { const r = run(BASES[bid], () => cid, a, b); isCache.set(k, { cagr: r.cagr, maxDD: r.maxDD, mar: r.mar, sharpe: r.sharpe }); } return isCache.get(k); };
const adaptive = [];
for (const bid of Object.keys(BASES)) for (const [sid, set] of Object.entries(SETS)) for (const [wid, wf] of Object.entries(WINDOWS)) {
  const picks = {}, isRows = {};
  for (const Y of YEARS) {
    const a = wf(Y), b = ts(`${Y - 1}-12-31`);
    const res = set.map(cid => ({ cid, ...isRun(bid, cid, a, b) })).sort((x, y) => y.mar - x.mar || y.sharpe - x.sharpe);
    picks[Y] = res[0].cid; isRows[Y] = { from: iso(a), to: iso(b), ranking: res.map(r => ({ cid: r.cid, mar: r.mar, cagr: r.cagr, maxDD: r.maxDD })) };
  }
  const r = run(BASES[bid], execT => picks[yearOf(execT)], OOS_START, END);
  const changes = YEARS.slice(1).filter((y, i) => picks[y] !== picks[YEARS[i]]).length;
  adaptive.push({ base: bid, set: sid, window: wid, picks, isRows, changes, res: r });
  console.log('adaptive', bid, sid, wid, r.cagr.toFixed(2), r.maxDD.toFixed(2), r.mar.toFixed(3), r.sharpe.toFixed(3), YEARS.map(y => picks[y]).join(','));
}
for (const a of adaptive) { const A = a.res, B = fixed[a.base].RSL26; a.vsBase = paired(YEARS.map(y => A.yearly[y].ret), YEARS.map(y => B.yearly[y].ret)); }

// ---------- output
const n = (v, d = 2) => v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(d);
const strip = r => ({ cagr: r.cagr, maxDD: r.maxDD, mar: r.mar, sharpe: r.sharpe, final: r.final, trades: r.trades, fees: r.fees, yearly: r.yearly });
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ generated: new Date().toISOString(), loaded: data.results.length, oos: [iso(OOS_START), iso(END)], anchor: iso(ANCHOR), years: YEARS, bases: BASES, candidates: Object.fromEntries(Object.entries(CANDS).map(([k, v]) => [k, v.label])), parity,
  spx: strip(SBENCH), fixed: Object.fromEntries(Object.entries(fixed).map(([b, o]) => [b, Object.fromEntries(Object.entries(o).map(([c, r]) => [c, strip(r)]))])), tests,
  adaptive: adaptive.map(a => ({ ...a, res: strip(a.res) })) }, null, 1));
const rows = [];
const push = (base, typ, id, label, r, extra = {}) => { const o = { base: BASES[base]?.label ?? base, typ, id, label, cagr: n(r.cagr), maxDD: n(r.maxDD), mar: n(r.mar, 3), sharpe: n(r.sharpe, 3), final: n(r.final, 0), trades: r.trades ?? '', fees: r.fees ?? '', ...extra }; for (const y of YEARS) { o[`r${y}`] = n(r.yearly[y]?.ret, 1); o[`d${y}`] = n(r.yearly[y]?.ddMax, 1); } rows.push(o); };
push('S&P 500', 'Benchmark', 'SPX', 'S&P 500 Kurs (ohne Dividenden)', SBENCH);
for (const b of Object.keys(BASES)) {
  for (const c of Object.keys(CANDS)) push(b, 'fix', c, CANDS[c].label + ' + Trail 20 %/4', fixed[b][c]);
  for (const a of adaptive.filter(x => x.base === b)) push(b, 'adaptiv', `WF_${a.set}_${a.window}`, `WF ${a.window}, Kandidaten ${SETS[a.set].join('/')}`, a.res, { picks: YEARS.map(y => `${y}:${a.picks[y]}`).join(' '), changes: a.changes });
}
const cols = [['base', 'Basis'], ['typ', 'Typ'], ['id', 'ID'], ['label', 'Beschreibung'], ['cagr', 'CAGR OOS 2018–26'], ['maxDD', 'MaxDD (täglich)'], ['mar', 'MAR'], ['sharpe', 'Sharpe (wöchentl.)'], ['final', 'Endwert'], ['trades', 'Trades'], ['fees', 'Gebühren $'], ['changes', 'Wechsel'], ['picks', 'Auswahl je Jahr'],
  ...YEARS.map(y => [`r${y}`, `Rendite ${y} %`]), ...YEARS.map(y => [`d${y}`, `MaxDD ${y} %`])].map(([key, label]) => ({ key, label }));
writeFileSync(`${OUT}/${TAG}.csv`, toGermanCsv(rows, cols));
const trows = tests.map(t => ({ base: BASES[t.base].label, cand: CANDS[t.cand].label, yw: `${t.years.wins}/${t.years.n}`, md: n(t.years.meanDiff, 2), t: n(t.years.t, 3), p: n(t.years.p, 4), sp: n(t.years.signP, 4), ww: `${t.weeks.wins}/${t.weeks.n}`, wmd: n(100 * t.weeks.meanDiff, 4), wt: n(t.weeks.t, 3), wp: n(t.weeks.p, 4) }));
writeFileSync(`${OUT}/${TAG}_Tests.csv`, toGermanCsv(trows, [['base', 'Basis'], ['cand', 'Kandidat vs RSL26'], ['yw', 'Jahre besser'], ['md', 'Ø Δ Jahresrendite %-Pkt'], ['t', 't (Jahre)'], ['p', 'p (Jahre, 2-seitig)'], ['sp', 'Vorzeichentest p'], ['ww', 'Wochen besser'], ['wmd', 'Ø Δ Wochenrendite %-Pkt'], ['wt', 't (Wochen)'], ['wp', 'p (Wochen)']].map(([key, label]) => ({ key, label }))));
console.log('wrote');
process.exit(0);
