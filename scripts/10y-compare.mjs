#!/usr/bin/env node
/**
 * 10y backtests: original defaults + top-5 grid + robust plateau.
 * Per-year metrics, trend of excess returns, CSV + PNGs.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { rotationBacktest, toGermanCsv } from '../lib/fn/grokki-math.js';
import { STRATEGY } from './lib/strategy-env.mjs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../data/backtests');
const DIR = path.join(OUT, '10y-2026-11-09');
mkdirSync(DIR, { recursive: true });

const YEARS = 10;
const FETCH_YEARS = 12; // lookback for RSL26/RRG
const START = 10000, FEE = 1;

const CONFIGS = [
  { id: 'original', label: 'Original (RANK N25 RT25 RS1)', mode: 'RANK', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  { id: 'top1', label: 'Top1 RANK N5 RT10 RS1', mode: 'RANK', n: 5, rankTop: 10, rsExit: true, confirmWeeks: 1 },
  { id: 'top2', label: 'Top2 RANK N5 RT10 RS0', mode: 'RANK', n: 5, rankTop: 10, rsExit: false, confirmWeeks: 1 },
  { id: 'top3', label: 'Top3 CONFIRM N10 RT10 RS0 CW2', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
  { id: 'top4', label: 'Top4 CONFIRM N10 RT10 RS1 CW2', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: true, confirmWeeks: 2 },
  { id: 'top5', label: 'Top5 RANK N8 RT5 RS0', mode: 'RANK', n: 8, rankTop: 5, rsExit: false, confirmWeeks: 1 },
  { id: 'plateau', label: 'Plateau RANK N8 RT8 RS0', mode: 'RANK', n: 8, rankTop: 8, rsExit: false, confirmWeeks: 1 },
];

console.log('Loading SPX + benchmark for', FETCH_YEARS, 'y…');
const t0 = Date.now();
const u = universe({ universe: 'SPX' });
const [benchmark, data] = await Promise.all([
  history('^GSPC', FETCH_YEARS),
  batch(u.tickers, (t) => history(t, FETCH_YEARS), 300000, 8),
]);
console.log(`loaded ${data.results.length}/${u.tickers.length} in ${Date.now() - t0}ms; errors=${data.errors.length}`);

// Coverage: bars spanning ~10y
const needSec = YEARS * 365.25 * 86400;
const now = benchmark.bars.at(-1)?.time || Date.now() / 1000;
const cutoff10 = now - needSec;
let full10 = 0, short = 0;
for (const s of data.results) {
  const first = s.bars[0]?.time;
  if (first != null && first <= cutoff10 + 60 * 86400) full10++;
  else short++;
}
const coverage = {
  requested: u.tickers.length,
  loaded: data.results.length,
  fullApprox10y: full10,
  shorterHistory: short,
  loadErrors: data.errors.length,
  note: 'Survivorship: current S&P 500 constituents only. Shorter history names still trade when data appears.',
};
console.log('coverage', coverage);

function weekRets(equity) {
  const sampled = []; let lastW = null;
  for (const p of equity || []) {
    const wk = Math.floor((Date.parse(p.time + 'T00:00:00Z') / 86400e3 + 3) / 7);
    if (wk !== lastW) { sampled.push(p); lastW = wk; }
  }
  const rets = [];
  for (let i = 1; i < sampled.length; i++) {
    const a = sampled[i - 1].value, b = sampled[i].value;
    if (a > 0) rets.push({ time: sampled[i].time, r: b / a - 1 });
  }
  return rets;
}
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function sharpeFromRets(rets) {
  const x = rets.map((z) => z.r ?? z);
  const s = stdev(x);
  if (!(s > 0)) return null;
  return (mean(x) / s) * Math.sqrt(52);
}
function maxDD(pts) {
  let peak = -Infinity, m = 0;
  for (const p of pts) {
    peak = Math.max(peak, p.value);
    if (peak > 0) m = Math.min(m, p.value / peak - 1);
  }
  return 100 * m;
}
function cagrBetween(a, b, ta, tb) {
  if (!(a > 0) || !(b > 0)) return null;
  const y = (Date.parse(tb) - Date.parse(ta)) / (365.25 * 86400e3);
  if (!(y > 0.2)) return null;
  return 100 * ((b / a) ** (1 / y) - 1);
}
function linreg(xs, ys) {
  const n = xs.length;
  if (n < 3) return { slope: null, t: null, p: null, r2: null };
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (!(sxx > 0)) return { slope: null, t: null, p: null, r2: null };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const resid = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const sse = resid.reduce((s, e) => s + e * e, 0);
  const df = n - 2;
  const se = Math.sqrt(sse / df / sxx);
  const tstat = se > 0 ? slope / se : null;
  // two-sided p via regularized incomplete beta approximation (simple erfc for large |t|)
  const p = tstat == null ? null : approxPValue(tstat, df);
  const r2 = syy > 0 ? 1 - sse / syy : null;
  return { slope, intercept, t: tstat, p, r2 };
}
function approxPValue(t, df) {
  // Abramowitz-like via student-t → normal for df>=8 else crude
  const x = Math.abs(t);
  const z = x * Math.sqrt(df / (df + x * x)); // rough
  // normal two-tail
  const p = 2 * (1 - normalCdf(z));
  return Math.max(0, Math.min(1, p));
}
function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function erf(x) {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const t=1/(1+p*x);
  const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}

function yearlyStats(equity, bmEquity) {
  const byY = new Map();
  for (const p of equity || []) {
    const y = p.time.slice(0, 4);
    if (!byY.has(y)) byY.set(y, []);
    byY.get(y).push(p);
  }
  const bmByY = new Map();
  for (const p of bmEquity || []) {
    const y = p.time.slice(0, 4);
    if (!bmByY.has(y)) bmByY.set(y, []);
    bmByY.get(y).push(p);
  }
  const years = [...byY.keys()].sort();
  const rows = [];
  for (const y of years) {
    const pts = byY.get(y);
    if (pts.length < 5) continue;
    const a = pts[0].value, b = pts.at(-1).value;
    const ret = a > 0 ? 100 * (b / a - 1) : null;
    const bm = bmByY.get(y);
    let bmRet = null;
    if (bm?.length >= 2) {
      const ba = bm[0].value, bb = bm.at(-1).value;
      if (ba > 0) bmRet = 100 * (bb / ba - 1);
    }
    const excess = ret != null && bmRet != null ? ret - bmRet : null;
    const dd = maxDD(pts);
    // weekly sharpe within year
    const wr = weekRets(pts);
    const sh = sharpeFromRets(wr);
    rows.push({ year: +y, ret, bmRet, excess, maxDD: dd, sharpe: sh });
  }
  return rows;
}

function rolling3y(equity) {
  const out = [];
  if (!equity?.length) return out;
  // sample year-end points
  const byY = new Map();
  for (const p of equity) {
    const y = p.time.slice(0, 4);
    byY.set(y, p);
  }
  const years = [...byY.keys()].sort();
  for (let i = 2; i < years.length; i++) {
    const y0 = years[i - 2], y1 = years[i];
    const a = byY.get(years[i - 3] || years[0]); // start ~3y before end of y1 window
    // better: use first point of y0 and last of y1
    const startPts = equity.filter((p) => p.time.startsWith(y0));
    const endPts = equity.filter((p) => p.time.startsWith(y1));
    if (!startPts.length || !endPts.length) continue;
    const c = cagrBetween(startPts[0].value, endPts.at(-1).value, startPts[0].time, endPts.at(-1).time);
    out.push({ endYear: +y1, cagr3y: c });
  }
  return out;
}

function splitCagr(equity, startY, endY) {
  const pts = (equity || []).filter((p) => {
    const y = +p.time.slice(0, 4);
    return y >= startY && y <= endY;
  });
  if (pts.length < 10) return null;
  return cagrBetween(pts[0].value, pts.at(-1).value, pts[0].time, pts.at(-1).time);
}

const results = [];
const yearlyRows = [];

for (const cfg of CONFIGS) {
  console.log('run', cfg.id, cfg.label);
  const bt = rotationBacktest(data.results, YEARS, cfg.n, {
    benchmarkBars: benchmark.bars,
    mode: cfg.mode,
    rankTop: cfg.rankTop,
    rsExit: cfg.rsExit,
    confirmWeeks: cfg.confirmWeeks,
    startCapital: START,
    fractional: true,
    sizeMode: 'EQUITY',
    fee: FEE,
    ...STRATEGY, // optional --trail/--trail-lock/--ranking (or RSL_* env)
  });
  const s = bt.stats || {};
  const cagr = s.cagr, maxDD = s.maxDD;
  const mar = Math.abs(maxDD) > 1e-9 ? cagr / Math.abs(maxDD) : null;
  const sh = sharpeFromRets(weekRets(bt.equity));
  const yearly = yearlyStats(bt.equity, bt.benchmarkEquity);
  const xs2 = [], ys2 = [];
  for (const r of yearly) if (Number.isFinite(r.excess)) { xs2.push(r.year); ys2.push(r.excess); }
  const reg = linreg(xs2, ys2);
  const cagrEarly = splitCagr(bt.equity, 2016, 2021);
  const cagrLate = splitCagr(bt.equity, 2021, 2026);
  let trend = 'stabil';
  if (reg.p != null && reg.p < 0.1) {
    trend = reg.slope > 0 ? 'verbessert (signifikant)' : 'verschlechtert (signifikant)';
  } else if (reg.slope != null) {
    trend = Math.abs(reg.slope) < 0.3 ? 'stabil' : (reg.slope > 0 ? 'leicht verbessert (n.s.)' : 'leicht verschlechtert (n.s.)');
  }
  // OOS note: grid optimized on ~2021-26; early window is OOS
  const oosHold = cagrEarly != null && cagrLate != null
    ? (cagrEarly > 0 && cagrLate > cagrEarly * 0.5 ? 'hält grob' : (cagrEarly <= 0 ? 'OOS schwach/negativ' : 'OOS schwächer als In-Sample'))
    : '—';

  const summary = {
    id: cfg.id, label: cfg.label, mode: cfg.mode, n: cfg.n, rankTop: cfg.rankTop,
    rsExit: cfg.rsExit ? 1 : 0, confirmWeeks: cfg.confirmWeeks,
    cagr10y: cagr, maxDD, mar, sharpe10y: sh,
    finalEquity: s.finalEquity, totalFees: s.totalFees,
    cagr_2016_21: cagrEarly, cagr_2021_26: cagrLate,
    excess_slope: reg.slope, excess_t: reg.t, excess_p: reg.p, excess_r2: reg.r2,
    trend, oosHold,
    equity: bt.equity, benchmarkEquity: bt.benchmarkEquity,
    yearly, rolling3y: rolling3y(bt.equity),
  };
  results.push(summary);
  for (const y of yearly) {
    yearlyRows.push({
      config: cfg.id, label: cfg.label, year: y.year,
      ret: y.ret, bmRet: y.bmRet, excess: y.excess, maxDD: y.maxDD, sharpe: y.sharpe,
    });
  }
}

// CSV
function nfix(v, d = 2) { return Number.isFinite(v) ? Number(Number(v).toFixed(d)) : ''; }
const summaryCsv = toGermanCsv(results.map((r) => ({
  id: r.id, label: r.label, mode: r.mode, n: r.n, rankTop: r.rankTop, rsExit: r.rsExit, confirmWeeks: r.confirmWeeks,
  CAGR_10y: nfix(r.cagr10y), MaxDD: nfix(r.maxDD), MAR: nfix(r.mar, 3), Sharpe_10y: nfix(r.sharpe10y, 3),
  CAGR_2016_21: nfix(r.cagr_2016_21), CAGR_2021_26: nfix(r.cagr_2021_26),
  excess_slope: nfix(r.excess_slope, 4), excess_t: nfix(r.excess_t, 3), excess_p: nfix(r.excess_p, 4),
  trend: r.trend, oos: r.oosHold, finalEquity: nfix(r.finalEquity), totalFees: nfix(r.totalFees),
})), [
  { key: 'id', label: 'ID' }, { key: 'label', label: 'Label' }, { key: 'mode', label: 'Mode' },
  { key: 'n', label: 'N' }, { key: 'rankTop', label: 'RANKTOP' }, { key: 'rsExit', label: 'RSExit' },
  { key: 'confirmWeeks', label: 'ConfirmWeeks' }, { key: 'CAGR_10y', label: 'CAGR_10y' },
  { key: 'MaxDD', label: 'MaxDD' }, { key: 'MAR', label: 'MAR' }, { key: 'Sharpe_10y', label: 'Sharpe_10y' },
  { key: 'CAGR_2016_21', label: 'CAGR_2016_21' }, { key: 'CAGR_2021_26', label: 'CAGR_2021_26' },
  { key: 'excess_slope', label: 'ExcessSlope_pp_per_year' }, { key: 'excess_t', label: 'tStat' },
  { key: 'excess_p', label: 'pValue' }, { key: 'trend', label: 'Trend' }, { key: 'oos', label: 'OOS_vs_GridWindow' },
  { key: 'finalEquity', label: 'FinalEquity' }, { key: 'totalFees', label: 'TotalFees' },
]);
const yearlyCsv = toGermanCsv(yearlyRows.map((r) => ({
  ...r, ret: nfix(r.ret), bmRet: nfix(r.bmRet), excess: nfix(r.excess), maxDD: nfix(r.maxDD), sharpe: nfix(r.sharpe, 3),
})), [
  { key: 'config', label: 'Config' }, { key: 'label', label: 'Label' }, { key: 'year', label: 'Jahr' },
  { key: 'ret', label: 'Return' }, { key: 'bmRet', label: 'BenchReturn' }, { key: 'excess', label: 'Excess' },
  { key: 'maxDD', label: 'MaxDD' }, { key: 'sharpe', label: 'Sharpe' },
]);
writeFileSync(path.join(OUT, '10y-2026-11-09.csv'), yearlyCsv);
writeFileSync(path.join(DIR, 'summary.csv'), summaryCsv);
writeFileSync(path.join(DIR, 'yearly.csv'), yearlyCsv);
writeFileSync(path.join(DIR, 'results.json'), JSON.stringify({
  coverage, meta: { years: YEARS, fee: FEE, start: START, generated: new Date().toISOString() },
  results: results.map(({ equity, benchmarkEquity, ...r }) => r),
  equities: Object.fromEntries(results.map((r) => [r.id, { equity: r.equity, benchmarkEquity: r.benchmarkEquity }])),
}, null, 2));

writeFileSync('/tmp/10y-plot.json', JSON.stringify({
  dir: DIR,
  results: results.map((r) => ({
    id: r.id, label: r.label, yearly: r.yearly,
    equity: r.equity, benchmarkEquity: r.benchmarkEquity,
  })),
}));

const plot = spawnSync('python3', [path.join(__dirname, 'plot-10y.py')], { encoding: 'utf8' });
console.log(plot.stdout);
if (plot.status !== 0) console.error(plot.stderr);

console.log('\n=== SUMMARY ===');
for (const r of results) {
  console.log(`${r.id}: CAGR10=${nfix(r.cagr10y)} MaxDD=${nfix(r.maxDD)} MAR=${nfix(r.mar,3)} Sh=${nfix(r.sharpe10y,3)} | 16-21=${nfix(r.cagr_2016_21)} 21-26=${nfix(r.cagr_2021_26)} | slope=${nfix(r.excess_slope,3)} p=${nfix(r.excess_p,3)} → ${r.trend} | OOS ${r.oosHold}`);
}
console.log('coverage', coverage);
