#!/usr/bin/env node
/**
 * A) Reverse split: tune 2016-11→2021-11, test 2021-11→2026-11
 * B) Walk-forward annual: expanding + rolling 2y (coarse grid)
 *
 * SELECTION RULE (fixed up-front, no peeking at test):
 *  1. Score = 0.55*MAR + 0.25*Sharpe + 0.20*robustness
 *     robustness = median(MAR, MAR_half1, MAR_half2) when halves exist else MAR
 *  2. bestRaw = argmax MAR (ties → Sharpe → Score)
 *  3. bestPlateau = argmax smoothScore among MAR ≥ 0.90*maxMAR
 *     neighborhood: |ΔN-index|≤1 & |ΔRT-index|≤1, same mode/rsExit/confirmWeeks
 *  4. WF uses bestPlateau else bestRaw
 *  5. Test/OOS never used in selection
 *
 * Grids:
 *  - IS (split A): medium — N∈{5,8,10,15,25} RT∈{0,10,25,=N}
 *    modes RANK / CONFIRM(cw1-2) / OFF × RS on/off
 *  - WF annual + OOS percentile: coarse — N∈{5,10,15,25} RT∈{10,25,=N}
 *    modes RANK / CONFIRM(cw1) / OFF × RS on/off (~56 jobs)
 *
 * WF note: continuous daily MTM equity for MaxDD/Sharpe/MAR/CAGR (same as fixed runs).
 * Period transition: carry (default) — holdings kept if new config still holds them (no fees);
 *   -- or reset to flat cash. Checkpoints under data/backtests/wf-2026-11-09/.
 */
import { Worker } from 'worker_threads';
import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { rotationBacktest, toGermanCsv } from '../lib/fn/grokki-math.js';
import { runWalkForwardBacktest } from './lib/rsl-eval-core.mjs';
import { STRATEGY } from './lib/strategy-env.mjs';
import { cpus } from 'os';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/backtests/wf-2026-11-09');
const PUB = path.join(ROOT, 'public/data/backtests');
const CKPT = path.join(OUT, 'checkpoint.json');
mkdirSync(OUT, { recursive: true });
mkdirSync(PUB, { recursive: true });

const WORKERS = Math.max(2, Math.min(6, cpus().length)); // 6 to limit RAM
const FEE = 1, START = 10000, FETCH_YEARS = 12;
const SERIES = '/tmp/wf-series.json';
const BENCH = '/tmp/wf-bench.json';

const SELECTION_RULE = {
  score: '0.55*MAR + 0.25*Sharpe + 0.20*robustness',
  bestRaw: 'argmax MAR (tie: Sharpe, Score)',
  bestPlateau: 'argmax smoothScore among MAR>=0.9*maxMAR; |ΔN|≤1,|ΔRT|≤1 same mode/RS/CW',
  walkForwardPick: 'bestPlateau else bestRaw',
  noPeek: true,
};

function iso(sec) { return new Date(sec * 1000).toISOString().slice(0, 10); }
function sec(d) { return Date.parse(d + 'T00:00:00Z') / 1000; }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function median(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function weekRets(equity) {
  const sampled = []; let lastW = null;
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
function sharpe(rets) {
  const s = stdev(rets);
  if (!(s > 0)) return null;
  return (mean(rets) / s) * Math.sqrt(52);
}
function halves(equity) {
  if (!equity?.length || equity.length < 40) return { mar1: null, mar2: null };
  const mid = Math.floor(equity.length / 2);
  const cagr = (pts) => {
    if (pts.length < 5) return null;
    const a = pts[0].value, b = pts.at(-1).value;
    const y = (Date.parse(pts.at(-1).time) - Date.parse(pts[0].time)) / (365.25 * 86400e3);
    if (!(y > 0.2) || !(a > 0)) return null;
    return 100 * ((b / a) ** (1 / y) - 1);
  };
  const mdd = (pts) => {
    let peak = -Infinity, m = 0;
    for (const p of pts) { peak = Math.max(peak, p.value); if (peak > 0) m = Math.min(m, p.value / peak - 1); }
    return Math.abs(100 * m);
  };
  const h1 = equity.slice(0, mid + 1), h2 = equity.slice(mid);
  const c1 = cagr(h1), c2 = cagr(h2), d1 = mdd(h1), d2 = mdd(h2);
  return {
    mar1: d1 > 1e-9 && c1 != null ? c1 / d1 : null,
    mar2: d2 > 1e-9 && c2 != null ? c2 / d2 : null,
  };
}
function nfix(v, d = 2) { return Number.isFinite(v) ? Number(Number(v).toFixed(d)) : ''; }
function fmtCfg(c) {
  if (!c) return null;
  return `${c.mode} N=${c.n} RT=${c.rankTopLabel ?? c.rankTop} RS=${c.rsExit ? 1 : 0} CW=${c.confirmWeeks || 1}`;
}

function loadCkpt() {
  if (!existsSync(CKPT)) return { phase: 'init', done: {} };
  try { return JSON.parse(readFileSync(CKPT, 'utf8')); } catch { return { phase: 'init', done: {} }; }
}
function saveCkpt(ckpt) {
  ckpt.updatedAt = new Date().toISOString();
  writeFileSync(CKPT, JSON.stringify(ckpt, null, 2));
  writeFileSync(path.join(OUT, 'checkpoint-latest.json'), JSON.stringify({ phase: ckpt.phase, updatedAt: ckpt.updatedAt, keys: Object.keys(ckpt.done || {}) }, null, 2));
}

function buildJobs({ windowStart, windowEnd, grid }) {
  // grid: 'medium' | 'coarse'
  const NS = grid === 'medium' ? [5, 8, 10, 15, 25] : [5, 10, 15, 25];
  const RT_FIXED = grid === 'medium' ? [0, 10, 25] : [10, 25];
  const MODES = ['RANK', 'CONFIRM', 'OFF'];
  const jobs = [];
  const yearsFallback = Math.max(1, (windowEnd - windowStart) / (365.25 * 86400));
  for (const mode of MODES) {
    for (const n of NS) {
      const rts = mode === 'OFF' ? [25] : [...new Set([...RT_FIXED, n])].sort((a, b) => a - b);
      const cws = mode === 'CONFIRM' ? (grid === 'medium' ? [1, 2] : [1]) : [1];
      for (const rankTop of rts) {
        for (const rsExit of [true, false]) {
          for (const confirmWeeks of cws) {
            jobs.push({
              id: `${mode}|N${n}|RT${rankTop}|RS${rsExit ? 1 : 0}|CW${confirmWeeks}`,
              n, mode, rankTop, rsExit, confirmWeeks,
              startCapital: START, fee: FEE, years: yearsFallback,
              windowStart, windowEnd, offset: 0, ...STRATEGY,
              rankTopLabel: rankTop === n ? '=N' : String(rankTop),
            });
          }
        }
      }
    }
  }
  const seen = new Set();
  return jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}

function runPool(jobs) {
  return new Promise((resolve, reject) => {
    if (!jobs.length) return resolve([]);
    const chunks = Array.from({ length: WORKERS }, () => []);
    jobs.forEach((j, i) => chunks[i % WORKERS].push(j));
    const results = [];
    let done = 0, failed = 0;
    const workerPath = path.join(__dirname, 'grid-worker.mjs');
    for (let w = 0; w < WORKERS; w++) {
      if (!chunks[w].length) { done++; if (done === WORKERS) resolve(results); continue; }
      const worker = new Worker(workerPath, {
        workerData: { seriesPath: SERIES, benchmarkPath: BENCH, jobs: chunks[w] },
      });
      worker.on('message', (msg) => results.push(...msg));
      worker.on('error', (e) => { console.error('worker err', e.message); failed++; });
      worker.on('exit', (code) => {
        if (code !== 0) failed++;
        done++;
        process.stdout.write(`  workers ${done}/${WORKERS}\n`);
        if (done === WORKERS) resolve(results);
      });
    }
  });
}

function enrichCells(raw) {
  const cells = [];
  for (const r of raw) {
    if (r.error || !Number.isFinite(r.mar)) continue;
    const sh = Number.isFinite(r.sharpe) ? r.sharpe : 0;
    const rob = Number.isFinite(r.mar1) || Number.isFinite(r.mar2)
      ? median([r.mar, r.mar1, r.mar2]) : r.mar;
    const score = 0.55 * (r.mar || 0) + 0.25 * sh + 0.20 * (rob ?? r.mar ?? 0);
    cells.push({ ...r, robustness: rob, score, rsExitFlag: r.rsExit ? 1 : 0 });
  }
  const NS = [...new Set(cells.map((c) => c.n))].sort((a, b) => a - b);
  const groups = new Map();
  for (const c of cells) {
    const k = `${c.mode}|RS${c.rsExit ? 1 : 0}|CW${c.confirmWeeks}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const [, grp] of groups) {
    const rts = [...new Set(grp.map((c) => c.rankTop))].sort((a, b) => a - b);
    for (const c of grp) {
      const neighbors = grp.filter((o) => {
        const dn = Math.abs(NS.indexOf(o.n) - NS.indexOf(c.n));
        const dri = Math.abs(rts.indexOf(o.rankTop) - rts.indexOf(c.rankTop));
        return dn <= 1 && dri <= 1;
      });
      c.smoothScore = median(neighbors.map((n) => n.score));
    }
  }
  return cells;
}

function pickBest(cells) {
  if (!cells.length) return { bestRaw: null, bestPlateau: null };
  const byMar = [...cells].sort((a, b) => (b.mar || -999) - (a.mar || -999) || (b.sharpe || 0) - (a.sharpe || 0) || (b.score || 0) - (a.score || 0));
  const bestRaw = byMar[0];
  const maxMar = bestRaw.mar || 0;
  const pool = cells.filter((c) => (c.mar || 0) >= 0.9 * maxMar);
  const bestPlateau = [...pool].sort((a, b) => (b.smoothScore || 0) - (a.smoothScore || 0) || (b.mar || 0) - (a.mar || 0))[0] || bestRaw;
  return { bestRaw, bestPlateau };
}

function slimCfg(c) {
  if (!c) return null;
  return {
    id: c.id, mode: c.mode, n: c.n, rankTop: c.rankTop, rankTopLabel: c.rankTopLabel || String(c.rankTop),
    rsExit: !!c.rsExit, confirmWeeks: c.confirmWeeks || 1,
    mar: c.mar, sharpe: c.sharpe, score: c.score, smoothScore: c.smoothScore, cagr: c.cagr, maxDD: c.maxDD,
  };
}

function metricsFromBt(bt) {
  const s = bt.stats || {};
  const cagr = s.cagr ?? bt.cagr;
  const maxDD = s.maxDD ?? bt.maxDD;
  const absDD = Math.abs(maxDD || 0);
  const mar = absDD > 1e-9 && Number.isFinite(cagr) ? cagr / absDD : null;
  const sh = sharpe(weekRets(bt.equity));
  const h = halves(bt.equity);
  const rob = median([mar, h.mar1, h.mar2].filter(Number.isFinite));
  const score = 0.55 * (mar || 0) + 0.25 * (Number.isFinite(sh) ? sh : 0) + 0.20 * (rob ?? mar ?? 0);
  return { cagr, maxDD, mar, sharpe: sh, robustness: rob, score, finalEquity: s.finalEquity, equity: bt.equity, benchmarkEquity: bt.benchmarkEquity };
}

function runOne(series, bm, cfg, windowStart, windowEnd, startCapital = START) {
  const bt = rotationBacktest(series, 5, cfg.n, {
    benchmarkBars: bm, mode: cfg.mode, rankTop: cfg.rankTop,
    confirmWeeks: cfg.confirmWeeks || 1, rsExit: cfg.rsExit,
    startCapital, fractional: true, sizeMode: 'EQUITY', fee: FEE,
    windowStart, windowEnd, ...STRATEGY,
  });
  return metricsFromBt(bt);
}

async function tuneWindow(label, windowStart, windowEnd, grid, ckptKey, ckpt) {
  if (ckpt.done[ckptKey]) {
    console.log(`  SKIP ${label} (checkpoint)`);
    return ckpt.done[ckptKey];
  }
  const jobs = buildJobs({ windowStart, windowEnd, grid });
  console.log(`  tune ${label}: ${jobs.length} jobs (${grid}) ${iso(windowStart)}→${iso(windowEnd)}`);
  const t1 = Date.now();
  const raw = await runPool(jobs);
  const cells = enrichCells(raw);
  const picks = pickBest(cells);
  const out = {
    label, grid, window: [iso(windowStart), iso(windowEnd)],
    nCells: cells.length,
    bestRaw: slimCfg(picks.bestRaw),
    bestPlateau: slimCfg(picks.bestPlateau),
    // keep compact cell list for percentile/scatter (no equity)
    cells: cells.map((c) => ({
      id: c.id, mode: c.mode, n: c.n, rankTop: c.rankTop, rsExit: !!c.rsExit, confirmWeeks: c.confirmWeeks,
      mar: c.mar, sharpe: c.sharpe, score: c.score, smoothScore: c.smoothScore, cagr: c.cagr, maxDD: c.maxDD,
    })),
    elapsedSec: (Date.now() - t1) / 1000,
  };
  console.log(`  done ${out.nCells} in ${out.elapsedSec.toFixed(1)}s → raw=${fmtCfg(out.bestRaw)} plateau=${fmtCfg(out.bestPlateau)}`);
  ckpt.done[ckptKey] = out;
  ckpt.phase = ckptKey;
  saveCkpt(ckpt);
  return out;
}

function chainYearly(rows) {
  let eq = START;
  const equity = [];
  for (const y of rows) {
    const start = eq;
    eq = eq * (1 + (y.retPct || 0) / 100);
    equity.push({ year: y.year, start, end: eq, retPct: y.retPct, config: y.config });
  }
  const years = rows.length;
  const cagr = years > 0 && eq > 0 ? 100 * ((eq / START) ** (1 / years) - 1) : null;
  let peak = -Infinity, mdd = 0;
  for (const p of equity) { peak = Math.max(peak, p.end); if (peak > 0) mdd = Math.min(mdd, p.end / peak - 1); }
  const maxDD = 100 * mdd;
  const mar = Math.abs(maxDD) > 1e-9 && cagr != null ? cagr / Math.abs(maxDD) : null;
  const yr = rows.map((r) => (r.retPct || 0) / 100);
  const sh = yr.length >= 2 && stdev(yr) > 0 ? mean(yr) / stdev(yr) : null;
  return { final: eq, equity, cagr, maxDD, mar, sharpeYearly: sh, totalReturnPct: 100 * (eq / START - 1) };
}

function tTestPaired(a, b) {
  const d = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Number.isFinite(a[i]) && Number.isFinite(b[i])) d.push(a[i] - b[i]);
  }
  if (d.length < 3) return { mean: null, t: null, p: null, n: d.length };
  const m = mean(d), s = stdev(d);
  const t = s > 0 ? m / (s / Math.sqrt(d.length)) : null;
  const p = t == null ? null : approxP(Math.abs(t), d.length - 1);
  return { mean: m, t, p, n: d.length };
}
function approxP(t, df) {
  const z = t * Math.sqrt(df / (df + t * t));
  return Math.max(0, Math.min(1, 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)))));
}
function erf(x) {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  return sign * (1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
}

function percentileOf(cells, cfg) {
  if (!cells?.length || !cfg) return null;
  const mars = cells.map((c) => c.mar).filter(Number.isFinite).sort((a, b) => a - b);
  const match = cells.find((c) => c.mode === cfg.mode && c.n === cfg.n && c.rankTop === cfg.rankTop && !!c.rsExit === !!cfg.rsExit && (c.confirmWeeks || 1) === (cfg.confirmWeeks || 1));
  if (!match || !Number.isFinite(match.mar)) return { mar: null, percentile: null, rank: null, n: mars.length };
  const better = mars.filter((x) => x < match.mar).length;
  return { mar: match.mar, percentile: 100 * better / mars.length, rank: mars.length - better, n: mars.length, id: match.id };
}

// ---------- main ----------
const ckpt = loadCkpt();
console.log('checkpoint phase=', ckpt.phase, 'done keys=', Object.keys(ckpt.done || {}));

let series, benchmarkBars;
if (existsSync(SERIES) && existsSync(BENCH) && ckpt.coverage) {
  console.log('Reusing cached series/bench JSON');
  series = JSON.parse(readFileSync(SERIES, 'utf8'));
  benchmarkBars = JSON.parse(readFileSync(BENCH, 'utf8'));
} else {
  console.log('Loading SPX', FETCH_YEARS, 'y…');
  const t0 = Date.now();
  const u = universe({ universe: 'SPX' });
  const [benchmark, data] = await Promise.all([
    history('^GSPC', FETCH_YEARS),
    batch(u.tickers, (t) => history(t, FETCH_YEARS), 300000, 8),
  ]);
  console.log(`loaded ${data.results.length} in ${Date.now() - t0}ms`);
  writeFileSync(SERIES, JSON.stringify(data.results));
  writeFileSync(BENCH, JSON.stringify(benchmark.bars));
  series = data.results;
  benchmarkBars = benchmark.bars;
  ckpt.coverage = {
    requested: u.tickers.length, loaded: data.results.length,
    note: 'Survivorship: current S&P 500 constituents. Some names <10y history.',
  };
  saveCkpt(ckpt);
}

const IS_START = sec('2016-11-09'), IS_END = sec('2021-11-09');
const OOS_START = sec('2021-11-09'), OOS_END = sec('2026-11-09');
const ANCHOR = sec('2016-11-09');
const WF_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

// ===== A =====
console.log('\n=== A) Reverse split ===');
const isTune = await tuneWindow('IS', IS_START, IS_END, 'medium', 'A_is', ckpt);
const isPick = isTune.bestPlateau || isTune.bestRaw;
const isRaw = isTune.bestRaw;

if (!ckpt.done.A_oos_evals) {
  const configs = [
    { id: 'is_plateau', label: 'IS-tuned plateau', ...isPick },
    { id: 'is_raw', label: 'IS-tuned raw MAR', ...isRaw },
    { id: 'original', label: 'Original RANK N25 RT25 RS1', mode: 'RANK', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 },
    { id: 'late_tuned', label: '2021-26 tuned CONFIRM N10 RT10 CW2 RS0', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
  ];
  const oosEvals = [];
  for (const cfg of configs) {
    const m = runOne(series, benchmarkBars, cfg, OOS_START, OOS_END);
    const { equity, benchmarkEquity, ...rest } = m;
    oosEvals.push({
      id: cfg.id, label: cfg.label, cfg: fmtCfg(cfg), ...rest,
      // keep equity for plots in separate file
      _equity: equity, _bm: benchmarkEquity,
    });
    console.log(`  OOS ${cfg.id}: CAGR=${nfix(m.cagr)} MaxDD=${nfix(m.maxDD)} MAR=${nfix(m.mar, 3)}`);
  }
  const isEvalPlat = runOne(series, benchmarkBars, isPick, IS_START, IS_END);
  const isEvalRaw = runOne(series, benchmarkBars, isRaw, IS_START, IS_END);
  let bhCagr = null, bhDD = null;
  const bh = oosEvals[0]?._bm;
  if (bh?.length > 1) {
    const a = bh[0].value, b = bh.at(-1).value;
    const y = (Date.parse(bh.at(-1).time) - Date.parse(bh[0].time)) / (365.25 * 86400e3);
    bhCagr = y > 0 && a > 0 ? 100 * ((b / a) ** (1 / y) - 1) : null;
    let peak = -Infinity, mdd = 0;
    for (const p of bh) { peak = Math.max(peak, p.value); if (peak > 0) mdd = Math.min(mdd, p.value / peak - 1); }
    bhDD = 100 * mdd;
  }
  // persist equities for plot
  writeFileSync(path.join(OUT, 'oos-equities.json'), JSON.stringify(
    Object.fromEntries(oosEvals.map((o) => [o.id, { equity: o._equity, benchmarkEquity: o._bm }])),
  ));
  ckpt.done.A_oos_evals = {
    oos: oosEvals.map(({ _equity, _bm, ...r }) => r),
    isPlat: { cfg: fmtCfg(isPick), cagr: isEvalPlat.cagr, maxDD: isEvalPlat.maxDD, mar: isEvalPlat.mar, sharpe: isEvalPlat.sharpe },
    isRaw: { cfg: fmtCfg(isRaw), cagr: isEvalRaw.cagr, maxDD: isEvalRaw.maxDD, mar: isEvalRaw.mar, sharpe: isEvalRaw.sharpe },
    spxBh: { cagr: bhCagr, maxDD: bhDD },
  };
  saveCkpt(ckpt);
}

const oosTune = await tuneWindow('OOS-grid', OOS_START, OOS_END, 'coarse', 'A_oos_grid', ckpt);
const pctPlat = percentileOf(oosTune.cells, isPick);
const pctRaw = percentileOf(oosTune.cells, isRaw);
ckpt.done.A_percentiles = { plateau: pctPlat, raw: pctRaw };
saveCkpt(ckpt);

// ===== B Walk-forward =====
async function walkForward(variant) {
  const rows = [];
  for (const Y of WF_YEARS) {
    const key = `B_${variant}_${Y}`;
    if (ckpt.done[key]) {
      console.log(`  SKIP ${key}`);
      rows.push(ckpt.done[key]);
      continue;
    }
    const tuneEnd = sec(`${Y - 1}-12-31`);
    let tuneStart = variant === 'expanding' ? ANCHOR : sec(`${Y - 2}-01-01`);
    if (tuneStart < ANCHOR) tuneStart = ANCHOR;
    if (tuneEnd <= tuneStart + 180 * 86400) {
      const skip = { year: Y, variant, skipped: true, reason: 'tune window too short' };
      ckpt.done[key] = skip; saveCkpt(ckpt); rows.push(skip); continue;
    }
    const tuned = await tuneWindow(`WF-${variant}-${Y}`, tuneStart, tuneEnd, 'coarse', `tune_${variant}_${Y}`, ckpt);
    const pick = tuned.bestPlateau || tuned.bestRaw;
    const traded = runOne(series, benchmarkBars, pick, sec(`${Y}-01-01`), sec(`${Y}-12-31`));
    const eq = traded.equity || [];
    const retPct = eq.length >= 2 && eq[0].value > 0 ? 100 * (eq.at(-1).value / eq[0].value - 1) : null;
    const bm = traded.benchmarkEquity || [];
    const bmRet = bm.length >= 2 && bm[0].value > 0 ? 100 * (bm.at(-1).value / bm[0].value - 1) : null;
    const row = {
      year: Y, variant, config: fmtCfg(pick),
      mode: pick.mode, n: pick.n, rankTop: pick.rankTop, rsExit: pick.rsExit ? 1 : 0, confirmWeeks: pick.confirmWeeks,
      tuneStart: iso(tuneStart), tuneEnd: iso(tuneEnd),
      retPct, bmRet, excess: retPct != null && bmRet != null ? retPct - bmRet : null,
      marTune: pick.mar,
    };
    console.log(`  ${variant} Y=${Y}: ${row.config} → ret=${nfix(retPct)}% excess=${nfix(row.excess)}%`);
    ckpt.done[key] = row;
    saveCkpt(ckpt);
    rows.push(row);
  }
  return rows.filter((r) => !r.skipped);
}

console.log('\n=== B) Walk-forward ===');
const wfExpRows = await walkForward('expanding');
const wfR2Rows = await walkForward('roll2');

const WF_TRANSITION = (process.env.WF_TRANSITION || 'carry').toLowerCase() === 'reset' ? 'reset' : 'carry';
console.log(`\n=== B2) Continuous equity + transition=${WF_TRANSITION} ===`);

async function summarizeWFContinuous(rows, label, wfWindow) {
  const picksByPeriod = Object.fromEntries(rows.map((r) => [String(r.year), {
    mode: r.mode, n: r.n, rankTop: r.rankTop, rsExit: !!r.rsExit, confirmWeeks: r.confirmWeeks || 1, ...STRATEGY,
  }]));
  const bt = await runWalkForwardBacktest({
    series, benchmarkBars, seriesPath: SERIES, benchPath: BENCH,
    firstYear: WF_YEARS[0], lastYear: WF_YEARS.at(-1),
    wfWindow: wfWindow === 'roll2' ? 'rolling' : 'expanding',
    rollYears: 2, period: 'yearly', transition: WF_TRANSITION,
    picksByPeriod, startCapital: START, fee: FEE, sizeMode: 'EQUITY', fractional: true,
    anchorSec: ANCHOR,
  });
  const changes = rows.slice(1).filter((r, i) => r.config !== rows[i].config).length;
  const modes = {}, ns = {};
  for (const r of rows) {
    modes[r.mode] = (modes[r.mode] || 0) + 1;
    ns[r.n] = (ns[r.n] || 0) + 1;
  }
  // Merge period returns from continuous curve onto rows (for CSV + t-test)
  const byPeriod = new Map((bt.yearly || []).map((y) => [String(y.period), y]));
  const rowsOut = rows.map((r) => {
    const y = byPeriod.get(String(r.year));
    return y ? {
      ...r,
      retPct: y.retPct, bmRet: y.bmRet, excess: y.excess,
      endCapital: y.endCapital, transition: WF_TRANSITION,
    } : { ...r, transition: WF_TRANSITION };
  });
  const equityChain = (bt.yearly || []).map((y) => ({
    year: Number(y.period), start: y.startCapital, end: y.endCapital, retPct: y.retPct, config: y.config,
  }));
  return {
    label, years: rows.length,
    final: bt.stats?.finalEquity, equity: equityChain,
    dailyEquity: bt.equity, benchmarkEquity: bt.benchmarkEquity,
    cagr: bt.stats?.cagr ?? bt.cagr,
    maxDD: bt.stats?.maxDD ?? bt.maxDD,
    mar: bt.stats?.mar ?? bt.mar,
    sharpe: bt.stats?.sharpe ?? bt.sharpe,
    sharpeYearly: null, // deprecated — use daily Sharpe
    totalReturnPct: bt.stats?.totalReturnPct,
    maxDDSource: 'daily_equity_curve',
    transition: WF_TRANSITION,
    equityPoints: bt.equity?.length || 0,
    paramChanges: changes, changeRate: rows.length > 1 ? changes / (rows.length - 1) : null,
    modeDist: modes, nDist: ns, rows: rowsOut,
  };
}

const sumExp = await summarizeWFContinuous(wfExpRows, 'WF expanding', 'expanding');
const sumR2 = await summarizeWFContinuous(wfR2Rows, 'WF roll2y', 'roll2');
console.log(`  expanding: CAGR=${nfix(sumExp.cagr)} MaxDD=${nfix(sumExp.maxDD)} MAR=${nfix(sumExp.mar, 3)} Sharpe=${nfix(sumExp.sharpe, 3)} pts=${sumExp.equityPoints}`);
console.log(`  roll2y:    CAGR=${nfix(sumR2.cagr)} MaxDD=${nfix(sumR2.maxDD)} MAR=${nfix(sumR2.mar, 3)} Sharpe=${nfix(sumR2.sharpe, 3)} pts=${sumR2.equityPoints}`);

// Persist continuous equities for plots
writeFileSync(path.join(OUT, 'wf-equities.json'), JSON.stringify({
  expanding: { equity: sumExp.dailyEquity, benchmarkEquity: sumExp.benchmarkEquity },
  roll2: { equity: sumR2.dailyEquity, benchmarkEquity: sumR2.benchmarkEquity },
  transition: WF_TRANSITION,
}));

// Fixed baselines 2018→2026
const WF_START = sec('2018-01-01'), WF_END = sec('2026-11-09');
if (!ckpt.done.B_fixed) {
  const fixedBaselines = [
    { id: 'original', label: 'Original RANK N25', mode: 'RANK', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 },
    { id: 'late_tuned', label: 'Late-tuned CONFIRM N10 CW2', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
    { id: 'is_plateau', label: 'IS-plateau', ...isPick },
  ];
  const fixedEvals = [];
  const fixedEq = {};
  for (const cfg of fixedBaselines) {
    const m = runOne(series, benchmarkBars, cfg, WF_START, WF_END);
    fixedEvals.push({ id: cfg.id, label: cfg.label, cfg: fmtCfg(cfg), cagr: m.cagr, maxDD: m.maxDD, mar: m.mar, sharpe: m.sharpe, finalEquity: m.finalEquity });
    fixedEq[cfg.id] = { equity: m.equity, benchmarkEquity: m.benchmarkEquity };
    console.log(`  fixed ${cfg.id}: CAGR=${nfix(m.cagr)} MAR=${nfix(m.mar, 3)}`);
  }
  writeFileSync(path.join(OUT, 'fixed-equities.json'), JSON.stringify(fixedEq));
  // yearly excess for t-test
  const origEx = [];
  for (const Y of WF_YEARS) {
    const m = runOne(series, benchmarkBars, fixedBaselines[0], sec(`${Y}-01-01`), sec(`${Y}-12-31`));
    const eq = m.equity || [];
    const ret = eq.length >= 2 && eq[0].value > 0 ? 100 * (eq.at(-1).value / eq[0].value - 1) : null;
    const bm = m.benchmarkEquity || [];
    const bmRet = bm.length >= 2 && bm[0].value > 0 ? 100 * (bm.at(-1).value / bm[0].value - 1) : null;
    origEx.push(ret != null && bmRet != null ? ret - bmRet : null);
  }
  ckpt.done.B_fixed = { fixedEvals, origYearlyExcess: origEx };
  saveCkpt(ckpt);
}

const tWf = tTestPaired(sumExp.rows.map((r) => r.excess), ckpt.done.B_fixed.origYearlyExcess);

// ===== Finalize outputs =====
const A = ckpt.done.A_oos_evals;
const payload = {
  meta: {
    generated: new Date().toISOString(),
    selectionRule: SELECTION_RULE,
    fee: FEE, start: START, coverage: ckpt.coverage,
    grids: {
      IS: 'medium N∈{5,8,10,15,25} RT∈{0,10,25,=N} RANK/CONFIRM(cw1-2)/OFF × RS',
      WF_and_OOS: 'coarse N∈{5,10,15,25} RT∈{10,25,=N} RANK/CONFIRM(cw1)/OFF × RS (~56 jobs)',
    },
    wfNote: `Annual WF: continuous daily MTM equity for MaxDD/Sharpe/MAR/CAGR; transition=${WF_TRANSITION} (carry=keep holdings new config still holds, no fees; reset=flat cash). Tune never sees year Y.`,
  },
  splitA: {
    isWindow: ['2016-11-09', '2021-11-09'],
    oosWindow: ['2021-11-09', '2026-11-09'],
    isBestRaw: A.isRaw,
    isBestPlateau: A.isPlat,
    oos: A.oos,
    spxBh: A.spxBh,
    degradation: {
      plateau: { isCagr: A.isPlat.cagr, oosCagr: A.oos.find((x) => x.id === 'is_plateau')?.cagr, isMar: A.isPlat.mar, oosMar: A.oos.find((x) => x.id === 'is_plateau')?.mar },
      raw: { isCagr: A.isRaw.cagr, oosCagr: A.oos.find((x) => x.id === 'is_raw')?.cagr, isMar: A.isRaw.mar, oosMar: A.oos.find((x) => x.id === 'is_raw')?.mar },
    },
    oosPercentile: ckpt.done.A_percentiles,
  },
  walkForward: {
    expanding: { ...sumExp, dailyEquity: undefined, benchmarkEquity: undefined, rows: sumExp.rows },
    roll2: { ...sumR2, dailyEquity: undefined, benchmarkEquity: undefined, rows: sumR2.rows },
    tTest_WFexp_vs_original: tWf,
  },
  fixedBaselines: ckpt.done.B_fixed.fixedEvals,
};
writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(payload, null, 2));
copyFileSync(path.join(OUT, 'results.json'), path.join(PUB, 'wf-2026-11-09-results.json'));

// CSVs
writeFileSync(path.join(OUT, 'splitA.csv'), toGermanCsv([
  { side: 'IS', pick: 'raw', cfg: A.isRaw.cfg, CAGR: nfix(A.isRaw.cagr), MaxDD: nfix(A.isRaw.maxDD), MAR: nfix(A.isRaw.mar, 3), Sharpe: nfix(A.isRaw.sharpe, 3) },
  { side: 'IS', pick: 'plateau', cfg: A.isPlat.cfg, CAGR: nfix(A.isPlat.cagr), MaxDD: nfix(A.isPlat.maxDD), MAR: nfix(A.isPlat.mar, 3), Sharpe: nfix(A.isPlat.sharpe, 3) },
  ...A.oos.map((o) => ({ side: 'OOS', pick: o.id, cfg: o.cfg, CAGR: nfix(o.cagr), MaxDD: nfix(o.maxDD), MAR: nfix(o.mar, 3), Sharpe: nfix(o.sharpe, 3) })),
  { side: 'OOS', pick: 'SPX_BH', cfg: 'B&H', CAGR: nfix(A.spxBh.cagr), MaxDD: nfix(A.spxBh.maxDD), MAR: '', Sharpe: '' },
  { side: 'OOS_pct', pick: 'plateau', cfg: A.isPlat.cfg, CAGR: nfix(pctPlat?.percentile), MaxDD: nfix(pctPlat?.rank), MAR: nfix(pctPlat?.mar, 3), Sharpe: nfix(pctPlat?.n) },
], [
  { key: 'side', label: 'Seite' }, { key: 'pick', label: 'Pick' }, { key: 'cfg', label: 'Config' },
  { key: 'CAGR', label: 'CAGR' }, { key: 'MaxDD', label: 'MaxDD' }, { key: 'MAR', label: 'MAR' }, { key: 'Sharpe', label: 'Sharpe' },
]));

const wfAll = [...sumExp.rows, ...sumR2.rows];
const wfCsv = toGermanCsv(wfAll.map((r) => ({
  variant: r.variant, year: r.year, config: r.config, mode: r.mode, n: r.n, rankTop: r.rankTop,
  rsExit: r.rsExit, confirmWeeks: r.confirmWeeks, ret: nfix(r.retPct), bm: nfix(r.bmRet), excess: nfix(r.excess),
  tuneStart: r.tuneStart, tuneEnd: r.tuneEnd,
})), [
  { key: 'variant', label: 'Variante' }, { key: 'year', label: 'Jahr' }, { key: 'config', label: 'Config' },
  { key: 'mode', label: 'Mode' }, { key: 'n', label: 'N' }, { key: 'rankTop', label: 'RANKTOP' },
  { key: 'rsExit', label: 'RSExit' }, { key: 'confirmWeeks', label: 'CW' },
  { key: 'ret', label: 'Return' }, { key: 'bm', label: 'Bench' }, { key: 'excess', label: 'Excess' },
  { key: 'tuneStart', label: 'TuneStart' }, { key: 'tuneEnd', label: 'TuneEnd' },
]);
writeFileSync(path.join(OUT, 'walkforward-yearly.csv'), wfCsv);
writeFileSync(path.join(ROOT, 'data/backtests/wf-2026-11-09.csv'), wfCsv);

writeFileSync(path.join(OUT, 'summary.csv'), toGermanCsv([
  { strategy: sumExp.label, CAGR: nfix(sumExp.cagr), MaxDD: nfix(sumExp.maxDD), MAR: nfix(sumExp.mar, 3), Sharpe: nfix(sumExp.sharpe, 3), paramChanges: sumExp.paramChanges, changeRate: nfix(sumExp.changeRate, 2) },
  { strategy: sumR2.label, CAGR: nfix(sumR2.cagr), MaxDD: nfix(sumR2.maxDD), MAR: nfix(sumR2.mar, 3), Sharpe: nfix(sumR2.sharpe, 3), paramChanges: sumR2.paramChanges, changeRate: nfix(sumR2.changeRate, 2) },
  ...ckpt.done.B_fixed.fixedEvals.map((f) => ({ strategy: f.label, CAGR: nfix(f.cagr), MaxDD: nfix(f.maxDD), MAR: nfix(f.mar, 3), Sharpe: nfix(f.sharpe, 3), paramChanges: 0, changeRate: 0 })),
], [
  { key: 'strategy', label: 'Strategie' }, { key: 'CAGR', label: 'CAGR' }, { key: 'MaxDD', label: 'MaxDD' },
  { key: 'MAR', label: 'MAR' }, { key: 'Sharpe', label: 'Sharpe' }, { key: 'paramChanges', label: 'ParamChanges' }, { key: 'changeRate', label: 'ChangeRate' },
]));

// scatter IS vs OOS
const oosMap = new Map((oosTune.cells || []).map((c) => [c.id, c]));
const scatter = (isTune.cells || []).map((c) => ({
  id: c.id, isMar: c.mar, oosMar: oosMap.get(c.id)?.mar ?? null,
  isPick: c.id === isPick.id, isRaw: c.id === isRaw.id,
})).filter((x) => x.oosMar != null);

writeFileSync('/tmp/wf-plot.json', JSON.stringify({
  dir: OUT,
  oosEquities: existsSync(path.join(OUT, 'oos-equities.json')) ? JSON.parse(readFileSync(path.join(OUT, 'oos-equities.json'), 'utf8')) : {},
  fixedEquities: existsSync(path.join(OUT, 'fixed-equities.json')) ? JSON.parse(readFileSync(path.join(OUT, 'fixed-equities.json'), 'utf8')) : {},
  wfExpand: sumExp, wfRoll2: sumR2, scatter,
  wfEquities: { expanding: sumExp.dailyEquity, roll2: sumR2.dailyEquity, transition: WF_TRANSITION },
  oosEvals: A.oos,
}));

const plot = spawnSync('python3', [path.join(__dirname, 'plot-wf.py')], { encoding: 'utf8' });
console.log(plot.stdout);
if (plot.status !== 0) console.error(plot.stderr);

ckpt.phase = 'done';
saveCkpt(ckpt);
console.log('\n=== DONE ===');
console.log('IS plateau', fmtCfg(isPick), 'IS raw', fmtCfg(isRaw));
console.log('OOS pct plateau', pctPlat);
console.log('WF exp', { cagr: sumExp.cagr, mar: sumExp.mar, changes: sumExp.paramChanges });
console.log('WF r2', { cagr: sumR2.cagr, mar: sumR2.mar, changes: sumR2.paramChanges });
console.log('t-test', tWf);
