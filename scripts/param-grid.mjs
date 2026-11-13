#!/usr/bin/env node
import { Worker } from 'worker_threads';
import { writeFileSync, mkdirSync, readFileSync, copyFileSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { toGermanCsv } from '../lib/fn/grokki-math.js';
import { STRATEGY } from './lib/strategy-env.mjs';
import { cpus } from 'os';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/backtests');
const HEAT = path.join(OUT, 'heatmaps-2026-11-09');
const PUB = path.join(ROOT, 'public/data/backtests');
const YEARS = 5, START = 10000, FEE = 1;
const NS = [5, 8, 10, 12, 15, 20, 25, 30, 40, 50];
const RT_FIXED = [0, 5, 10, 15, 20, 25, 35, 50];
const MODES = ['RANK', 'CONFIRM', 'DIRECT', 'DIRECT+RSL', 'OFF'];
const WORKERS = Math.max(2, Math.min(8, cpus().length));

mkdirSync(HEAT, { recursive: true });
mkdirSync(PUB, { recursive: true });

console.log('Loading SPX cache…');
const t0 = Date.now();
const u = universe({ universe: 'SPX' });
const [benchmark, data] = await Promise.all([
  history('^GSPC', YEARS),
  batch(u.tickers, (t) => history(t, YEARS)),
]);
console.log(`loaded ${data.results.length} in ${Date.now() - t0}ms; workers=${WORKERS}`);

const seriesPath = '/tmp/grid-series.json';
const benchPath = '/tmp/grid-bench.json';
writeFileSync(seriesPath, JSON.stringify(data.results));
writeFileSync(benchPath, JSON.stringify(benchmark.bars));

function rankTopsFor(n, mode) {
  // OFF/DIRECT/DIRECT+RSL ignore RANKTOP — one sentinel
  if (mode === 'OFF' || mode === 'DIRECT' || mode === 'DIRECT+RSL') return [25];
  const set = new Set([...RT_FIXED, n]);
  return [...set].sort((a, b) => a - b);
}
function confirmWeeksFor(mode, phase) {
  if (mode !== 'CONFIRM') return [1];
  return phase === 'coarse' ? [1] : [1, 2, 3];
}

function buildJobs(phase, refineAround = null) {
  const jobs = [];
  const modes = refineAround ? [...new Set(refineAround.map((c) => c.mode))] : MODES;
  const ns = refineAround ? [...new Set(refineAround.flatMap((c) => {
    const i = NS.indexOf(c.n);
    return NS.slice(Math.max(0, i - 1), Math.min(NS.length, i + 2));
  }))] : NS;
  for (const mode of modes) {
    for (const n of ns) {
      let rts = rankTopsFor(n, mode);
      if (refineAround && (mode === 'RANK' || mode === 'CONFIRM')) {
        // full RANKTOP set near winners
        rts = [...new Set([...RT_FIXED, n])].sort((a, b) => a - b);
      }
      for (const rankTop of rts) {
        for (const rsExit of [true, false]) {
          for (const confirmWeeks of confirmWeeksFor(mode, phase)) {
            // skip redundant CONFIRM weeks on coarse non-refine
            jobs.push({
              id: `${mode}|N${n}|RT${rankTop}|RS${rsExit ? 1 : 0}|CW${confirmWeeks}`,
              years: YEARS, n, mode, rankTop, rsExit, confirmWeeks,
              startCapital: START, fee: FEE, offset: 0, ...STRATEGY,
              rankTopLabel: rankTop === n ? '=N' : String(rankTop),
            });
          }
        }
      }
    }
  }
  // dedupe by id
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
        workerData: { seriesPath: seriesPath, benchmarkPath: benchPath, jobs: chunks[w] },
      });
      worker.on('message', (msg) => { results.push(...msg); });
      worker.on('error', (e) => { console.error('worker err', e); failed++; });
      worker.on('exit', (code) => {
        if (code !== 0) failed++;
        done++;
        console.log(`  worker done ${done}/${WORKERS} (chunk ${chunks[w].length})`);
        if (done === WORKERS) resolve(results);
      });
    }
  });
}

function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

console.log('Phase 1 coarse…');
const coarseJobs = buildJobs('coarse');
console.log(`  jobs=${coarseJobs.length}`);
const t1 = Date.now();
let coarse = await runPool(coarseJobs);
console.log(`  done ${coarse.length} in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
coarse = coarse.filter((r) => !r.error && Number.isFinite(r.mar));

// Top cells by MAR for refine
const topCoarse = [...coarse].sort((a, b) => b.mar - a.mar).slice(0, 25);
console.log('Phase 2 refine around top MAR…');
const refineJobs = buildJobs('refine', topCoarse).filter((j) => !coarse.some((c) => c.id === j.id));
console.log(`  new jobs=${refineJobs.length}`);
const t2 = Date.now();
let refined = refineJobs.length ? await runPool(refineJobs) : [];
console.log(`  done in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
refined = refined.filter((r) => !r.error && Number.isFinite(r.mar));

const all = [...coarse, ...refined];
// merge by id keep best
const byId = new Map();
for (const r of all) {
  const prev = byId.get(r.id);
  if (!prev || (r.mar ?? -999) > (prev.mar ?? -999)) byId.set(r.id, r);
}
let cells = [...byId.values()];

// Phase 3 robustness: offsets 0-3 for top 40 by MAR
console.log('Phase 3 robustness offsets…');
const top40 = [...cells].sort((a, b) => b.mar - a.mar).slice(0, 40);
const robJobs = [];
for (const c of top40) {
  for (let off = 1; off <= 3; off++) {
    robJobs.push({ ...c, offset: off, id: c.id + `|off${off}`, keepEquity: false });
  }
}
const t3 = Date.now();
const rob = robJobs.length ? await runPool(robJobs) : [];
console.log(`  done ${rob.length} in ${((Date.now() - t3) / 1000).toFixed(1)}s`);

const robByBase = new Map();
for (const r of rob) {
  const base = r.id.replace(/\|off\d+$/, '');
  if (!robByBase.has(base)) robByBase.set(base, []);
  robByBase.get(base).push(r);
}

for (const c of cells) {
  const offs = robByBase.get(c.id) || [];
  const marSamples = [c.mar, c.mar1, c.mar2, ...offs.map((o) => o.mar)].filter(Number.isFinite);
  c.robustness = median(marSamples);
  c.offsetCagrs = [c.cagr, ...offs.map((o) => o.cagr)];
  c.cagr_off_spread = c.offsetCagrs.filter(Number.isFinite).length
    ? Math.max(...c.offsetCagrs.filter(Number.isFinite)) - Math.min(...c.offsetCagrs.filter(Number.isFinite))
    : null;
  // composite: MAR primary, Sharpe secondary, robustness
  const sh = Number.isFinite(c.sharpe) ? c.sharpe : 0;
  const rb = Number.isFinite(c.robustness) ? c.robustness : (c.mar || 0);
  c.score = 0.5 * (c.mar || 0) + 0.25 * sh + 0.25 * rb;
}

// Neighbor-smoothed score for plateau detection (same mode, rsExit, confirmWeeks)
function smoothKey(c) { return `${c.mode}|RS${c.rsExit ? 1 : 0}|CW${c.confirmWeeks}`; }
const groups = new Map();
for (const c of cells) {
  const k = smoothKey(c);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}
for (const [, grp] of groups) {
  for (const c of grp) {
    const neighbors = grp.filter((o) => {
      const dn = Math.abs(NS.indexOf(o.n) - NS.indexOf(c.n));
      const rts = [...new Set([...RT_FIXED, c.n, o.n])].sort((a, b) => a - b);
      const dri = Math.abs(rts.indexOf(o.rankTop) - rts.indexOf(c.rankTop));
      return dn <= 1 && dri <= 1;
    });
    c.smoothScore = median(neighbors.map((n) => n.score).filter(Number.isFinite));
  }
}

cells.sort((a, b) => (b.score || 0) - (a.score || 0));
const bestRaw = [...cells].sort((a, b) => (b.mar || 0) - (a.mar || 0))[0];
const bestRobust = [...cells].sort((a, b) => (b.smoothScore || 0) - (a.smoothScore || 0) || (b.robustness || 0) - (a.robustness || 0))[0];
const top5 = cells.slice(0, 5);

const payload = {
  meta: {
    date: '2026-11-09', universe: 'SPX', years: YEARS, start: START, fee: FEE,
    size: 'EQUITY', fractional: 1, workers: WORKERS,
    cells: cells.length, note: 'Survivorship bias (current constituents). FEE=$1/trade fixed.',
  },
  bestRaw, bestRobust, top5,
  cells: cells.map(({ equity, ...r }) => r),
};
writeFileSync(path.join(OUT, 'grid-2026-11-09.json'), JSON.stringify(payload));
copyFileSync(path.join(OUT, 'grid-2026-11-09.json'), path.join(PUB, 'grid-2026-11-09.json'));

const cols = [
  { key: 'mode', label: 'Mode' }, { key: 'n', label: 'N' }, { key: 'rankTop', label: 'RANKTOP' },
  { key: 'rankTopLabel', label: 'RANKTOPLabel' }, { key: 'rsExit', label: 'RSExit' },
  { key: 'confirmWeeks', label: 'ConfirmWeeks' }, { key: 'cagr', label: 'CAGR' },
  { key: 'maxDD', label: 'MaxDD' }, { key: 'mar', label: 'MAR' }, { key: 'sharpe', label: 'Sharpe' },
  { key: 'robustness', label: 'Robustness' }, { key: 'smoothScore', label: 'SmoothScore' },
  { key: 'score', label: 'Score' }, { key: 'half1', label: 'CAGR_half1' }, { key: 'half2', label: 'CAGR_half2' },
  { key: 'cagr_off_spread', label: 'CAGR_off_spread' }, { key: 'tradesClosed', label: 'TradesClosed' },
  { key: 'winRate', label: 'WinRate' }, { key: 'totalFees', label: 'TotalFees' },
];
const csvRows = cells.map((c) => ({
  ...c,
  rsExit: c.rsExit ? 1 : 0,
  cagr: num(c.cagr), maxDD: num(c.maxDD), mar: num(c.mar, 3), sharpe: num(c.sharpe, 3),
  robustness: num(c.robustness, 3), smoothScore: num(c.smoothScore, 3), score: num(c.score, 3),
  half1: num(c.half1), half2: num(c.half2), cagr_off_spread: num(c.cagr_off_spread),
  winRate: num(c.winRate, 1), totalFees: num(c.totalFees, 2),
}));
function num(v, d = 2) { return Number.isFinite(v) ? Number(v.toFixed(d)) : ''; }
writeFileSync(path.join(OUT, 'grid-2026-11-09.csv'), toGermanCsv(csvRows, cols));
copyFileSync(path.join(OUT, 'grid-2026-11-09.csv'), path.join(PUB, 'grid-2026-11-09.csv'));

writeFileSync('/tmp/grid-plot-data.json', JSON.stringify({ cells, bestRaw, bestRobust, NS, RT_FIXED, MODES, HEAT }));
console.log('Plotting heatmaps…');
const plot = spawnSync('python3', [path.join(__dirname, 'plot-heatmaps.py')], { encoding: 'utf8' });
console.log(plot.stdout);
if (plot.status !== 0) console.error(plot.stderr);

console.log('\nBEST RAW (MAR)', fmt(bestRaw));
console.log('BEST ROBUST PLATEAU', fmt(bestRobust));
console.log('TOP5');
top5.forEach((c, i) => console.log(i + 1, fmt(c)));

function fmt(c) {
  if (!c) return null;
  return `mode=${c.mode} N=${c.n} RT=${c.rankTopLabel||c.rankTop} RS=${c.rsExit?1:0} CW=${c.confirmWeeks} CAGR=${num(c.cagr)} MaxDD=${num(c.maxDD)} MAR=${num(c.mar,3)} Sharpe=${num(c.sharpe,3)} Rob=${num(c.robustness,3)} Smooth=${num(c.smoothScore,3)}`;
}
