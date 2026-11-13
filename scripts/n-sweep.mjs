#!/usr/bin/env node
/**
 * N-parameter sweep for weekly RSL backtest.
 * FEE=1 (static), SIZE=EQUITY, FRACTIONAL=1, START=10000, YEARS=5, RANK.
 * Variants: RANKTOP=25 fixed, RANKTOP=N.
 * Robustness: yearly windows + startOffsetWeeks 0..3.
 * Output: German Excel CSV + PNG chart.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { rotationBacktest, toGermanCsv } from '../lib/fn/grokki-math.js';
import { STRATEGY } from './lib/strategy-env.mjs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { spawnSync } from 'child_process';

const NS = [5, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const YEARS = 5;
const START = 10000;
const FEE = 1;
const MODE = 'RANK';
const OUT_DIR = new URL('../data/backtests/', import.meta.url);
const CSV_PATH = new URL('n-sweep-2026-11-09.csv', OUT_DIR);
const PNG_PATH = new URL('n-sweep-2026-11-09.png', OUT_DIR);

function weekReturns(equity) {
  // Use Monday-ish weekly samples from weeklyLog if available; else downsample equity by ~5 trading days
  const pts = equity || [];
  if (pts.length < 10) return [];
  // Prefer calendar-week spaced points: take every Friday-ish by ISO week or just every 5th point
  const sampled = [];
  let lastW = null;
  for (const p of pts) {
    const d = new Date(p.time + 'T00:00:00Z');
    const wk = Math.floor((d.getTime() / 86400e3 + 3) / 7);
    if (wk !== lastW) {
      sampled.push(p);
      lastW = wk;
    }
  }
  const rets = [];
  for (let i = 1; i < sampled.length; i++) {
    const a = sampled[i - 1].value, b = sampled[i].value;
    if (a > 0 && Number.isFinite(b)) rets.push(b / a - 1);
  }
  return rets;
}

function mean(a) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function sharpe(rets, rfWeekly = 0) {
  const x = rets.map((r) => r - rfWeekly);
  const s = stdev(x);
  if (!(s > 0)) return null;
  return (mean(x) / s) * Math.sqrt(52);
}
function sortino(rets, rfWeekly = 0) {
  const x = rets.map((r) => r - rfWeekly);
  const downside = x.filter((r) => r < 0);
  if (!downside.length) return mean(x) > 0 ? Infinity : null;
  const dd = Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length);
  if (!(dd > 0)) return null;
  return (mean(x) / dd) * Math.sqrt(52);
}
function volAnn(rets) {
  const s = stdev(rets);
  return s == null ? null : s * Math.sqrt(52) * 100;
}

function yearlyCagrs(equity, startCapital) {
  if (!equity?.length) return {};
  const byYear = new Map();
  for (const p of equity) {
    const y = p.time.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(p);
  }
  const out = {};
  for (const [y, pts] of [...byYear.entries()].sort()) {
    if (pts.length < 2) continue;
    const a = pts[0].value, b = pts.at(-1).value;
    const days = (Date.parse(pts.at(-1).time) - Date.parse(pts[0].time)) / 86400e3;
    if (days < 60 || !(a > 0)) continue;
    const years = days / 365.25;
    out[y] = 100 * ((b / a) ** (1 / years) - 1);
  }
  // also halves
  const mid = Math.floor(equity.length / 2);
  if (mid > 20) {
    const h1a = equity[0].value, h1b = equity[mid].value;
    const h2a = equity[mid].value, h2b = equity.at(-1).value;
    const y1 = (Date.parse(equity[mid].time) - Date.parse(equity[0].time)) / (365.25 * 86400e3);
    const y2 = (Date.parse(equity.at(-1).time) - Date.parse(equity[mid].time)) / (365.25 * 86400e3);
    if (y1 > 0.3 && h1a > 0) out.half1 = 100 * ((h1b / h1a) ** (1 / y1) - 1);
    if (y2 > 0.3 && h2a > 0) out.half2 = 100 * ((h2b / h2a) ** (1 / y2) - 1);
  }
  return out;
}

function metrics(bt) {
  const s = bt.stats || {};
  const rets = weekReturns(bt.equity);
  const maxDD = Math.abs(s.maxDD ?? bt.maxDD ?? 0);
  const cagr = s.cagr ?? bt.cagr;
  const mar = maxDD > 1e-9 && Number.isFinite(cagr) ? cagr / maxDD : null;
  const closed = s.tradesClosed ?? 0;
  const weeks = s.rebalances ?? bt.weeklyLog?.length ?? 1;
  const turnover = weeks > 0 ? (closed + (bt.entries?.length || 0)) / weeks : null; // approx exits+entries per week
  // better turnover from weeklyLog
  let turn = 0;
  for (const w of bt.weeklyLog || []) turn += (w.exits || 0) + (w.entries || 0);
  const turnPerWeek = (bt.weeklyLog?.length || 0) > 0 ? turn / bt.weeklyLog.length : turnover;
  return {
    cagr,
    totalReturnPct: s.totalReturnPct ?? bt.totalReturnPct,
    maxDD: s.maxDD ?? bt.maxDD,
    mar,
    sharpe: sharpe(rets),
    sortino: sortino(rets),
    vol: volAnn(rets),
    winRate: s.winRate,
    tradesClosed: closed,
    holdWeeksAvg: s.holdWeeksAvg,
    avgCashQuota: s.avgCashQuota != null ? s.avgCashQuota * 100 : null,
    turnoverPerWeek: turnPerWeek,
    finalEquity: s.finalEquity,
    totalFees: s.totalFees,
    auditOk: bt.audit?.ok,
    yearly: yearlyCagrs(bt.equity, s.startCapital),
  };
}

function deNum(v, d = 4) {
  if (v == null || !Number.isFinite(v)) return '';
  if (v === Infinity) return 'Inf';
  return Number(v.toFixed(d));
}

console.log('Loading SPX + benchmark from OHLCV cache…');
const t0 = Date.now();
const u = universe({ universe: 'SPX' });
const [benchmark, data] = await Promise.all([
  history('^GSPC', YEARS),
  batch(u.tickers, (t) => history(t, YEARS)),
]);
console.log(`loaded ${data.results.length} symbols in ${Date.now() - t0}ms`);

const rows = [];
const baseOpts = {
  benchmarkBars: benchmark.bars,
  mode: MODE,
  startCapital: START,
  fractional: true,
  sizeMode: 'EQUITY',
  fee: FEE,
  ...STRATEGY, // optional --trail/--trail-lock/--ranking (or RSL_* env)
};

for (const rankMode of ['FIXED25', 'EQ_N']) {
  for (const n of NS) {
    const rankTop = rankMode === 'FIXED25' ? 25 : n;
    console.log(`run N=${n} RANKTOP=${rankTop} (${rankMode}) …`);
    const bt = rotationBacktest(data.results, YEARS, n, { ...baseOpts, rankTop, startOffsetWeeks: 0 });
    const m = metrics(bt);

    // start offsets
    const offsetCagrs = [m.cagr];
    for (let off = 1; off <= 3; off++) {
      const bto = rotationBacktest(data.results, YEARS, n, { ...baseOpts, rankTop, startOffsetWeeks: off });
      offsetCagrs.push(bto.stats?.cagr ?? bto.cagr);
    }
    const offMean = mean(offsetCagrs.filter(Number.isFinite));
    const offSpread = Math.max(...offsetCagrs.filter(Number.isFinite)) - Math.min(...offsetCagrs.filter(Number.isFinite));

    const y = m.yearly || {};
    const yearVals = Object.entries(y).filter(([k]) => /^\d{4}$/.test(k)).map(([, v]) => v);
    const yearMin = yearVals.length ? Math.min(...yearVals) : null;
    const yearStd = yearVals.length >= 2 ? stdev(yearVals) : null;

    // composite robust score (higher better): prefer MAR + Sharpe, penalize offset spread & year std
    const marN = m.mar ?? 0;
    const shN = Number.isFinite(m.sharpe) ? m.sharpe : 0;
    const soN = Number.isFinite(m.sortino) && m.sortino !== Infinity ? Math.min(m.sortino, 5) : shN;
    const stab = (yearStd != null ? yearStd : 20) / 20; // ~0-2
    const offPen = (offSpread ?? 10) / 10;
    const score = 0.45 * marN + 0.35 * shN + 0.15 * soN - 0.25 * stab - 0.2 * offPen;

    rows.push({
      rankMode,
      n,
      rankTop,
      fee: FEE,
      cagr: deNum(m.cagr, 2),
      totalReturnPct: deNum(m.totalReturnPct, 2),
      maxDD: deNum(m.maxDD, 2),
      mar: deNum(m.mar, 3),
      sharpe: deNum(m.sharpe, 3),
      sortino: deNum(m.sortino === Infinity ? null : m.sortino, 3),
      vol: deNum(m.vol, 2),
      winRate: deNum(m.winRate, 1),
      tradesClosed: m.tradesClosed,
      holdWeeksAvg: deNum(m.holdWeeksAvg, 2),
      avgCashQuotaPct: deNum(m.avgCashQuota, 2),
      turnoverPerWeek: deNum(m.turnoverPerWeek, 3),
      finalEquity: deNum(m.finalEquity, 2),
      totalFees: deNum(m.totalFees, 2),
      cagr_off0: deNum(offsetCagrs[0], 2),
      cagr_off1: deNum(offsetCagrs[1], 2),
      cagr_off2: deNum(offsetCagrs[2], 2),
      cagr_off3: deNum(offsetCagrs[3], 2),
      cagr_off_spread: deNum(offSpread, 2),
      cagr_half1: deNum(y.half1, 2),
      cagr_half2: deNum(y.half2, 2),
      cagr_year_min: deNum(yearMin, 2),
      cagr_year_std: deNum(yearStd, 2),
      ...Object.fromEntries(yearVals.length ? Object.entries(y).filter(([k]) => /^\d{4}$/.test(k)).map(([k, v]) => [`cagr_${k}`, deNum(v, 2)]) : []),
      score: deNum(score, 3),
      auditOk: m.auditOk ? 1 : 0,
    });
  }
}

mkdirSync(new URL('.', OUT_DIR), { recursive: true });

const cols = [
  { key: 'rankMode', label: 'RankMode' },
  { key: 'n', label: 'N' },
  { key: 'rankTop', label: 'RANKTOP' },
  { key: 'fee', label: 'FEE' },
  { key: 'cagr', label: 'CAGR' },
  { key: 'totalReturnPct', label: 'TotalReturn' },
  { key: 'maxDD', label: 'MaxDD' },
  { key: 'mar', label: 'MAR' },
  { key: 'sharpe', label: 'Sharpe' },
  { key: 'sortino', label: 'Sortino' },
  { key: 'vol', label: 'VolAnn' },
  { key: 'winRate', label: 'WinRate' },
  { key: 'tradesClosed', label: 'TradesClosed' },
  { key: 'holdWeeksAvg', label: 'HoldWeeksAvg' },
  { key: 'avgCashQuotaPct', label: 'CashQuotaPct' },
  { key: 'turnoverPerWeek', label: 'TurnoverPerWeek' },
  { key: 'finalEquity', label: 'FinalEquity' },
  { key: 'totalFees', label: 'TotalFees' },
  { key: 'cagr_off0', label: 'CAGR_off0' },
  { key: 'cagr_off1', label: 'CAGR_off1' },
  { key: 'cagr_off2', label: 'CAGR_off2' },
  { key: 'cagr_off3', label: 'CAGR_off3' },
  { key: 'cagr_off_spread', label: 'CAGR_off_spread' },
  { key: 'cagr_half1', label: 'CAGR_half1' },
  { key: 'cagr_half2', label: 'CAGR_half2' },
  { key: 'cagr_year_min', label: 'CAGR_year_min' },
  { key: 'cagr_year_std', label: 'CAGR_year_std' },
  { key: 'score', label: 'Score' },
  { key: 'auditOk', label: 'AuditOK' },
];
// add dynamic year cols present
const yearCols = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => /^cagr_\d{4}$/.test(k))))].sort();
for (const k of yearCols) cols.push({ key: k, label: k.replace('cagr_', 'CAGR_') });

const csv = toGermanCsv(rows, cols);
writeFileSync(CSV_PATH, csv);
console.log('wrote', CSV_PATH.pathname, 'rows', rows.length);

// Pick best per mode and overall
function bestOf(subset) {
  return [...subset].sort((a, b) => (b.score || -999) - (a.score || -999))[0];
}
const bestFixed = bestOf(rows.filter((r) => r.rankMode === 'FIXED25'));
const bestEq = bestOf(rows.filter((r) => r.rankMode === 'EQ_N'));
const bestAll = bestOf(rows);
writeFileSync(new URL('n-sweep-2026-11-09-summary.json', OUT_DIR), JSON.stringify({ bestFixed, bestEq, bestAll, rows }, null, 2));

// PNG via matplotlib
const py = `
import json, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from pathlib import Path
data = json.loads(Path('${CSV_PATH.pathname.replace("n-sweep-2026-11-09.csv", "n-sweep-2026-11-09-summary.json")}').read_text())
rows = data['rows']
fig, axes = plt.subplots(2, 2, figsize=(11, 8), constrained_layout=True)
for ax, mode, title in [
    (axes[0,0], 'FIXED25', 'RANKTOP=25 fixed'),
    (axes[0,1], 'EQ_N', 'RANKTOP=N'),
]:
    sub = [r for r in rows if r['rankMode']==mode]
    ns = [r['n'] for r in sub]
    ax.plot(ns, [r['cagr'] for r in sub], 'o-', color='#ffa028', label='CAGR %')
    ax2 = ax.twinx()
    ax2.plot(ns, [abs(r['maxDD']) if r['maxDD'] is not None else None for r in sub], 's--', color='#ef6a77', label='|MaxDD| %')
    ax.set_title(title)
    ax.set_xlabel('N'); ax.set_ylabel('CAGR %', color='#ffa028')
    ax2.set_ylabel('|MaxDD| %', color='#ef6a77')
    ax.grid(True, alpha=0.3)
for ax, mode, title in [
    (axes[1,0], 'FIXED25', 'MAR & Sharpe · RANKTOP=25'),
    (axes[1,1], 'EQ_N', 'MAR & Sharpe · RANKTOP=N'),
]:
    sub = [r for r in rows if r['rankMode']==mode]
    ns = [r['n'] for r in sub]
    ax.plot(ns, [r['mar'] for r in sub], 'o-', color='#55c989', label='MAR')
    ax.plot(ns, [r['sharpe'] for r in sub], '^-', color='#63a9ff', label='Sharpe')
    ax.plot(ns, [r['score'] for r in sub], 'x-', color='#aaa', label='Score')
    ax.set_title(title); ax.set_xlabel('N'); ax.legend(fontsize=8); ax.grid(True, alpha=0.3)
fig.suptitle('RSL26 weekly Top-N sweep · SPX 5y · FEE=1 · SIZE=EQUITY · FRACTIONAL=1', fontsize=11)
fig.savefig('${PNG_PATH.pathname}', dpi=120)
print('wrote PNG')
`;
writeFileSync('/tmp/n-sweep-plot.py', py);
const r = spawnSync('python3', ['/tmp/n-sweep-plot.py'], { encoding: 'utf8' });
console.log(r.stdout, r.stderr);
console.log('\nBEST FIXED25', bestFixed);
console.log('BEST EQ_N', bestEq);
console.log('BEST ALL', bestAll);
