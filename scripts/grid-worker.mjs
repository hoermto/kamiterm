import { parentPort, workerData } from 'worker_threads';
import { rotationBacktest } from '../lib/fn/grokki-math.js';
import { readFileSync } from 'fs';

const { seriesPath, benchmarkPath, jobs } = workerData;
const series = JSON.parse(readFileSync(seriesPath, 'utf8'));
const benchmarkBars = JSON.parse(readFileSync(benchmarkPath, 'utf8'));

function weekReturns(equity) {
  const sampled = [];
  let lastW = null;
  for (const p of equity || []) {
    const wk = Math.floor((Date.parse(p.time + 'T00:00:00Z') / 86400e3 + 3) / 7);
    if (wk !== lastW) { sampled.push(p); lastW = wk; }
  }
  const rets = [];
  for (let i = 1; i < sampled.length; i++) {
    const a = sampled[i - 1].value, b = sampled[i].value;
    if (a > 0) rets.push(b / a - 1);
  }
  return rets;
}
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function sharpe(rets) {
  const s = stdev(rets);
  if (!(s > 0)) return null;
  return (mean(rets) / s) * Math.sqrt(52);
}
function halves(equity) {
  if (!equity?.length) return { half1: null, half2: null };
  const mid = Math.floor(equity.length / 2);
  const cagr = (a, b, ta, tb) => {
    if (!(a > 0) || !(b > 0)) return null;
    const y = (Date.parse(tb) - Date.parse(ta)) / (365.25 * 86400e3);
    if (!(y > 0.25)) return null;
    return 100 * ((b / a) ** (1 / y) - 1);
  };
  const mdd = (pts) => {
    let peak = -Infinity, m = 0;
    for (const p of pts) { peak = Math.max(peak, p.value); if (peak > 0) m = Math.min(m, p.value / peak - 1); }
    return 100 * m;
  };
  const h1 = equity.slice(0, mid + 1), h2 = equity.slice(mid);
  const c1 = cagr(h1[0].value, h1.at(-1).value, h1[0].time, h1.at(-1).time);
  const c2 = cagr(h2[0].value, h2.at(-1).value, h2[0].time, h2.at(-1).time);
  const d1 = Math.abs(mdd(h1)), d2 = Math.abs(mdd(h2));
  return {
    half1: c1, half2: c2,
    mar1: d1 > 1e-9 && c1 != null ? c1 / d1 : null,
    mar2: d2 > 1e-9 && c2 != null ? c2 / d2 : null,
  };
}

function runOne(job) {
  const bt = rotationBacktest(series, job.years ?? 5, job.n, {
    benchmarkBars,
    mode: job.mode,
    rankTop: job.rankTop,
    confirmWeeks: job.confirmWeeks,
    rsExit: job.rsExit,
    // Strategy extras (absent = engine defaults: TRAIL 0, TRAILLOCK 4, RANKING RSL26).
    ...(job.trail != null ? { trail: job.trail } : {}),
    ...(job.trailLock != null ? { trailLock: job.trailLock } : {}),
    ...(job.ranking ? { ranking: job.ranking } : {}),
    startCapital: job.startCapital,
    fractional: job.fractional !== false,
    sizeMode: job.sizeMode || 'EQUITY',
    fee: job.fee,
    startOffsetWeeks: job.offset || 0,
    windowStart: job.windowStart ?? null,
    windowEnd: job.windowEnd ?? null,
  });
  const s = bt.stats || {};
  const cagr = s.cagr ?? bt.cagr;
  const maxDD = s.maxDD ?? bt.maxDD;
  const absDD = Math.abs(maxDD || 0);
  const mar = absDD > 1e-9 && Number.isFinite(cagr) ? cagr / absDD : null;
  const rets = weekReturns(bt.equity);
  const h = halves(bt.equity);
  return {
    ...job,
    cagr, maxDD, mar,
    sharpe: sharpe(rets),
    totalReturnPct: s.totalReturnPct,
    finalEquity: s.finalEquity,
    tradesClosed: s.tradesClosed,
    winRate: s.winRate,
    holdWeeksAvg: s.holdWeeksAvg,
    avgCashQuota: s.avgCashQuota,
    totalFees: s.totalFees,
    half1: h.half1, half2: h.half2, mar1: h.mar1, mar2: h.mar2,
    equity: job.keepEquity ? bt.equity : undefined,
  };
}

const out = [];
for (const job of jobs) {
  try { out.push(runOne(job)); }
  catch (e) { out.push({ ...job, error: e.message }); }
}
parentPort.postMessage(out);
