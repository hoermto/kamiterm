/**
 * Shared RSL evaluation primitives: scoring, grid build, selection, metrics,
 * checkpoints, SVG chart fallback (no npm deps). Python plotting optional.
 */
import { Worker } from 'worker_threads';
import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from 'fs';
import { cpus } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { rotationBacktest, parseRanking } from '../../lib/fn/grokki-math.js';
import { history, batch } from '../../lib/fn/grokki-data.js';
import { universe } from '../../lib/fn/grokki-universes.js';
import { adjustEuSeries } from '../../lib/fn/grokki-eu.js';
import { toGermanCsv } from '../../lib/fn/grokki-math.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.join(__dirname, '../..');
export const DEFAULT_OUT = path.join(PROJECT_ROOT, 'data/backtests');

/** Default selection / scoring — overridable via options or JSON. */
export const DEFAULT_SELECTION = {
  scoreWeights: { mar: 0.55, sharpe: 0.25, robustness: 0.20 },
  plateauMarFloor: 0.90,       // keep cells with MAR >= floor * maxMAR
  plateauRadiusN: 1,           // |ΔN-index| ≤ radius
  plateauRadiusRt: 1,          // |ΔRANKTOP-index| ≤ radius
  walkForwardPick: 'plateau',  // 'plateau' | 'raw' | 'manual'
  constraints: {
    maxAbsDD: null,            // e.g. 45 → reject |MaxDD| > 45
    minHoldWeeks: null,
    excludeModes: [],          // e.g. ['OFF']
    requireRsExit: null,       // true/false/null
  },
};

export const DEFAULT_GRID = {
  n: [5, 10, 15, 25],
  rankTop: [10, 25, '=N'],
  modes: ['RANK', 'CONFIRM', 'OFF'],
  confirmWeeks: [1],
  rsExit: [true, false],
};

export const MEDIUM_GRID = {
  n: [5, 8, 10, 15, 25],
  rankTop: [0, 10, 25, '=N'],
  modes: ['RANK', 'CONFIRM', 'OFF'],
  confirmWeeks: [1, 2],
  rsExit: [true, false],
};

/**
 * Strategy extras applied to every IS/OOS run: trailing stop (TRAIL %, 0 = aus), re-entry lock
 * (TRAILLOCK weeks) and entry ranking (RSL26 | RSL39 | MOM52_4). Defaults = previous behaviour.
 */
export const STRATEGY_DEFAULTS = { trail: 0, trailLock: 4, ranking: 'RSL26' };
export function normStrategy(c = {}) {
  const t = Number(c.trail);
  const l = Number(c.trailLock);
  return {
    trail: Number.isFinite(t) && t > 0 ? Math.min(90, t) : 0,
    trailLock: c.trailLock != null && c.trailLock !== '' && Number.isFinite(l) && l >= 0 ? Math.floor(l) : 4,
    ranking: parseRanking(c.ranking, 'RSL26'),
  };
}
export function isDefaultStrategy(c = {}) {
  const s = normStrategy(c);
  return s.trail === 0 && s.ranking === 'RSL26';
}
/** Grid with strategy dims: fixed values become one-element lists unless the grid already lists them. */
export function withStrategyGrid(grid = {}, fixed = {}, { tuneTrail = null, tuneRanking = null } = {}) {
  const f = normStrategy(fixed);
  const list = (v) => (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
  return {
    ...grid,
    trail: tuneTrail ? list(tuneTrail).map(Number).filter((x) => Number.isFinite(x) && x >= 0) : (grid.trail || [f.trail]),
    trailLock: grid.trailLock || [f.trailLock],
    ranking: tuneRanking ? list(tuneRanking).map((r) => parseRanking(r)) : (grid.ranking || [f.ranking]),
  };
}
function strategyId(c) {
  const s = normStrategy(c);
  return isDefaultStrategy(s) ? '' : `|TR${s.trail}|TL${s.trail > 0 ? s.trailLock : '-'}|RK${s.ranking}`;
}

export function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
export function median(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function iso(sec) { return new Date(sec * 1000).toISOString().slice(0, 10); }
export function sec(d) { return Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 1000; }
export function nfix(v, d = 2) { return Number.isFinite(v) ? Number(Number(v).toFixed(d)) : ''; }

export function weekRets(equity) {
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
export function sharpe(rets) {
  const s = stdev(rets);
  if (!(s > 0)) return null;
  return (mean(rets) / s) * Math.sqrt(52);
}
export function halves(equity) {
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

export function fmtCfg(c) {
  if (!c) return null;
  const s = normStrategy(c);
  const extra = (s.trail > 0 ? ` TRAIL=${s.trail}/${s.trailLock}` : '') + (s.ranking !== 'RSL26' ? ` RK=${s.ranking}` : '');
  return `${c.mode} N=${c.n} RT=${c.rankTopLabel ?? c.rankTop} RS=${c.rsExit ? 1 : 0} CW=${c.confirmWeeks || 1}${extra}`;
}

export function loadJson(p, fallback = null) {
  if (!p || !existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function mergeSelection(base, over) {
  return {
    ...base,
    ...over,
    scoreWeights: { ...base.scoreWeights, ...(over?.scoreWeights || {}) },
    constraints: { ...base.constraints, ...(over?.constraints || {}) },
  };
}

/** Expand grid definition into job list. rankTop may include '=N'. */
export function buildJobsFromGrid(grid, { windowStart, windowEnd, years, startCapital, fee, sizeMode, fractional }) {
  const NS = grid.n || DEFAULT_GRID.n;
  const RT_SPEC = grid.rankTop || DEFAULT_GRID.rankTop;
  const MODES = grid.modes || DEFAULT_GRID.modes;
  const CWS = grid.confirmWeeks || [1];
  const RS = grid.rsExit != null ? grid.rsExit : [true, false];
  const TRAILS = grid.trail?.length ? grid.trail : [STRATEGY_DEFAULTS.trail];
  const LOCKS = grid.trailLock?.length ? grid.trailLock : [STRATEGY_DEFAULTS.trailLock];
  const RANKS = grid.ranking?.length ? grid.ranking : [STRATEGY_DEFAULTS.ranking];
  const yearsFallback = years ?? Math.max(1, (windowEnd - windowStart) / (365.25 * 86400));
  const jobs = [];
  for (const mode of MODES) {
    for (const n of NS) {
      let rts;
      if (mode === 'OFF' || mode === 'DIRECT' || mode === 'DIRECT+RSL') {
        rts = [25]; // sentinel — RANKTOP ignored
      } else {
        rts = [...new Set(RT_SPEC.map((x) => (x === '=N' || x === 'N' ? n : Number(x))))].sort((a, b) => a - b);
      }
      const cws = mode === 'CONFIRM' ? CWS : [1];
      for (const rankTop of rts) {
        for (const rsExit of RS) {
          for (const confirmWeeks of cws) for (const tr of TRAILS) for (const tl of LOCKS) for (const rk of RANKS) {
            const st = normStrategy({ trail: tr, trailLock: tl, ranking: rk });
            jobs.push({
              id: `${mode}|N${n}|RT${rankTop}|RS${rsExit ? 1 : 0}|CW${confirmWeeks}${strategyId(st)}`,
              n, mode, rankTop, rsExit: !!rsExit, confirmWeeks,
              trail: st.trail, trailLock: st.trailLock, ranking: st.ranking,
              startCapital: startCapital ?? 10000,
              fee: fee ?? 1,
              years: yearsFallback,
              windowStart: windowStart ?? null,
              windowEnd: windowEnd ?? null,
              sizeMode: sizeMode || 'EQUITY',
              fractional: fractional !== false,
              offset: 0,
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

export function scoreCell(r, selection = DEFAULT_SELECTION) {
  const w = selection.scoreWeights || DEFAULT_SELECTION.scoreWeights;
  const sh = Number.isFinite(r.sharpe) ? r.sharpe : 0;
  const rob = Number.isFinite(r.robustness) ? r.robustness : (r.mar || 0);
  return (w.mar || 0) * (r.mar || 0) + (w.sharpe || 0) * sh + (w.robustness || 0) * rob;
}

export function passesConstraints(r, selection = DEFAULT_SELECTION) {
  const c = selection.constraints || {};
  if (c.excludeModes?.includes(r.mode)) return false;
  if (c.requireRsExit === true && !r.rsExit) return false;
  if (c.requireRsExit === false && r.rsExit) return false;
  if (c.maxAbsDD != null && Math.abs(r.maxDD || 0) > c.maxAbsDD) return false;
  if (c.minHoldWeeks != null && (r.holdWeeksAvg == null || r.holdWeeksAvg < c.minHoldWeeks)) return false;
  return true;
}

export function enrichCells(raw, selection = DEFAULT_SELECTION) {
  const cells = [];
  for (const r of raw) {
    if (r.error || !Number.isFinite(r.mar)) continue;
    const rob = Number.isFinite(r.mar1) || Number.isFinite(r.mar2)
      ? median([r.mar, r.mar1, r.mar2]) : r.mar;
    const cell = { ...r, robustness: rob, rsExit: !!r.rsExit };
    cell.score = scoreCell(cell, selection);
    if (!passesConstraints(cell, selection)) continue;
    cells.push(cell);
  }
  const NS = [...new Set(cells.map((c) => c.n))].sort((a, b) => a - b);
  const radN = selection.plateauRadiusN ?? 1;
  const radRt = selection.plateauRadiusRt ?? 1;
  const groups = new Map();
  for (const c of cells) {
    const k = `${c.mode}|RS${c.rsExit ? 1 : 0}|CW${c.confirmWeeks}${strategyId(c)}`; // plateau neighbours share TRAIL/RANKING
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const [, grp] of groups) {
    const rts = [...new Set(grp.map((c) => c.rankTop))].sort((a, b) => a - b);
    for (const c of grp) {
      const neighbors = grp.filter((o) => {
        const dn = Math.abs(NS.indexOf(o.n) - NS.indexOf(c.n));
        const dri = Math.abs(rts.indexOf(o.rankTop) - rts.indexOf(c.rankTop));
        return dn <= radN && dri <= radRt;
      });
      c.smoothScore = median(neighbors.map((n) => n.score));
    }
  }
  return cells;
}

export function pickBest(cells, selection = DEFAULT_SELECTION, manualCfg = null) {
  if (manualCfg) {
    const m = cells.find((c) =>
      c.mode === manualCfg.mode && c.n === manualCfg.n && c.rankTop === manualCfg.rankTop
      && !!c.rsExit === !!manualCfg.rsExit
      && (c.confirmWeeks || 1) === (manualCfg.confirmWeeks || 1)
      && strategyId(c) === strategyId(manualCfg));
    if (m) return { bestRaw: m, bestPlateau: m, pick: m, source: 'manual' };
  }
  if (!cells.length) return { bestRaw: null, bestPlateau: null, pick: null, source: null };
  const byMar = [...cells].sort((a, b) => (b.mar || -999) - (a.mar || -999) || (b.sharpe || 0) - (a.sharpe || 0) || (b.score || 0) - (a.score || 0));
  const bestRaw = byMar[0];
  const floor = selection.plateauMarFloor ?? 0.9;
  const maxMar = bestRaw.mar || 0;
  const pool = cells.filter((c) => (c.mar || 0) >= floor * maxMar);
  const bestPlateau = [...pool].sort((a, b) => (b.smoothScore || 0) - (a.smoothScore || 0) || (b.mar || 0) - (a.mar || 0))[0] || bestRaw;
  const prefer = selection.walkForwardPick || 'plateau';
  const pick = prefer === 'raw' ? bestRaw : bestPlateau;
  return { bestRaw, bestPlateau, pick, source: prefer };
}

export function slimCfg(c) {
  if (!c) return null;
  return {
    id: c.id, mode: c.mode, n: c.n, rankTop: c.rankTop, rankTopLabel: c.rankTopLabel || String(c.rankTop),
    rsExit: !!c.rsExit, confirmWeeks: c.confirmWeeks || 1,
    ...normStrategy(c),
    mar: c.mar, sharpe: c.sharpe, score: c.score, smoothScore: c.smoothScore, cagr: c.cagr, maxDD: c.maxDD,
  };
}

export function metricsFromBt(bt) {
  const s = bt.stats || {};
  const cagr = s.cagr ?? bt.cagr;
  const maxDD = s.maxDD ?? bt.maxDD;
  const absDD = Math.abs(maxDD || 0);
  const mar = absDD > 1e-9 && Number.isFinite(cagr) ? cagr / absDD : null;
  const sh = sharpe(weekRets(bt.equity));
  const h = halves(bt.equity);
  const rob = median([mar, h.mar1, h.mar2].filter(Number.isFinite));
  return {
    cagr, maxDD, mar, sharpe: sh, robustness: rob,
    holdWeeksAvg: s.holdWeeksAvg, finalEquity: s.finalEquity,
    equity: bt.equity, benchmarkEquity: bt.benchmarkEquity,
    mar1: h.mar1, mar2: h.mar2,
  };
}

export function runOne(series, bm, cfg, opts = {}) {
  const bt = rotationBacktest(series, opts.years ?? 5, cfg.n, {
    benchmarkBars: bm,
    mode: cfg.mode,
    rankTop: cfg.rankTop,
    confirmWeeks: cfg.confirmWeeks || 1,
    rsExit: cfg.rsExit,
    ...normStrategy(cfg),
    startCapital: opts.startCapital ?? 10000,
    fractional: opts.fractional !== false,
    sizeMode: opts.sizeMode || 'EQUITY',
    fee: opts.fee ?? 1,
    windowStart: opts.windowStart ?? null,
    windowEnd: opts.windowEnd ?? null,
  });
  return metricsFromBt(bt);
}

export async function loadUniverseData({ universeKey = 'SPX', fetchYears = 12, seriesPath, benchPath, force = false } = {}) {
  const sp = seriesPath || path.join('/tmp', `rsl-eval-${universeKey}-series.json`);
  const bp = benchPath || path.join('/tmp', `rsl-eval-${universeKey}-bench.json`);
  if (!force && existsSync(sp) && existsSync(bp)) {
    return {
      series: JSON.parse(readFileSync(sp, 'utf8')),
      benchmarkBars: JSON.parse(readFileSync(bp, 'utf8')),
      seriesPath: sp, benchPath: bp, fromCacheFile: true,
    };
  }
  const u = universe({ universe: universeKey });
  const [benchmark, data] = await Promise.all([
    history(u.bench || (u.key === 'NDX' ? '^NDX' : u.key === 'DAX' ? '^GDAXI' : '^GSPC'), fetchYears),
    batch(u.tickers, (t) => history(t, fetchYears), u.eur ? 900000 : 300000, 8),
  ]);
  if (u.eur) { const adj = await adjustEuSeries(u.key, data.results, fetchYears); data.results = adj.results; } // HDAX/STOXX 600: Reparatur + EUR
  writeFileSync(sp, JSON.stringify(data.results));
  writeFileSync(bp, JSON.stringify(benchmark.bars));
  return {
    series: data.results, benchmarkBars: benchmark.bars,
    seriesPath: sp, benchPath: bp, fromCacheFile: false,
    coverage: { requested: u.tickers.length, loaded: data.results.length, errors: data.errors?.length || 0 },
  };
}

export function runPool(jobs, seriesPath, benchPath, { workers } = {}) {
  const W = workers || Math.max(1, Math.min(cpus().length - 1, 6));
  return new Promise((resolve) => {
    if (!jobs.length) return resolve([]);
    const chunks = Array.from({ length: W }, () => []);
    jobs.forEach((j, i) => chunks[i % W].push(j));
    const results = [];
    let done = 0;
    const workerPath = path.join(__dirname, '../grid-worker.mjs');
    for (let w = 0; w < W; w++) {
      if (!chunks[w].length) { done++; if (done === W) resolve(results); continue; }
      const worker = new Worker(workerPath, {
        workerData: { seriesPath, benchmarkPath: benchPath, jobs: chunks[w] },
      });
      worker.on('message', (msg) => results.push(...msg));
      worker.on('error', (e) => console.error('worker', e.message));
      worker.on('exit', () => {
        done++;
        process.stdout.write(`  workers ${done}/${W}\n`);
        if (done === W) resolve(results);
      });
    }
  });
}

export async function tuneWindow({
  label, windowStart, windowEnd, grid, selection, seriesPath, benchPath,
  startCapital, fee, sizeMode, fractional, workers, manualCfg, ckpt, ckptKey,
}) {
  if (ckpt && ckptKey && ckpt.done?.[ckptKey]) {
    console.log(`  SKIP ${label} (checkpoint)`);
    return ckpt.done[ckptKey];
  }
  const jobs = buildJobsFromGrid(grid, { windowStart, windowEnd, startCapital, fee, sizeMode, fractional });
  console.log(`  tune ${label}: ${jobs.length} jobs ${iso(windowStart)}→${iso(windowEnd)}`);
  const t1 = Date.now();
  const raw = await runPool(jobs, seriesPath, benchPath, { workers });
  const cells = enrichCells(raw, selection);
  const picks = pickBest(cells, selection, manualCfg);
  const out = {
    label, window: [iso(windowStart), iso(windowEnd)],
    nCells: cells.length, nJobs: jobs.length,
    bestRaw: slimCfg(picks.bestRaw),
    bestPlateau: slimCfg(picks.bestPlateau),
    pick: slimCfg(picks.pick),
    pickSource: picks.source,
    cells: cells.map((c) => ({
      id: c.id, mode: c.mode, n: c.n, rankTop: c.rankTop, rsExit: !!c.rsExit, confirmWeeks: c.confirmWeeks,
      ...normStrategy(c),
      mar: c.mar, sharpe: c.sharpe, score: c.score, smoothScore: c.smoothScore, cagr: c.cagr, maxDD: c.maxDD,
    })),
    elapsedSec: (Date.now() - t1) / 1000,
    selection, grid,
  };
  console.log(`  done ${out.nCells} in ${out.elapsedSec.toFixed(1)}s → pick=${fmtCfg(out.pick)} (${out.pickSource})`);
  if (ckpt && ckptKey) {
    ckpt.done = ckpt.done || {};
    ckpt.done[ckptKey] = out;
    ckpt.phase = ckptKey;
    ckpt.updatedAt = new Date().toISOString();
    writeFileSync(ckpt.path, JSON.stringify(ckpt, null, 2));
  }
  return out;
}

/** Pure-Node SVG equity chart (log or linear). */
export function svgEquityChart(seriesList, { width = 900, height = 420, log = true, title = '' } = {}) {
  const pad = { l: 60, r: 20, t: 40, b: 40 };
  const colors = ['#ffa028', '#63a9ff', '#55c989', '#ef6a77', '#c084fc', '#e2ba43', '#888'];
  let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const s of seriesList) {
    for (const p of s.data || []) {
      const t = Date.parse(p.time);
      tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
      vMin = Math.min(vMin, p.value); vMax = Math.max(vMax, p.value);
    }
  }
  if (!Number.isFinite(tMin)) return '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><text x="10" y="50">keine Daten</text></svg>';
  if (log) { vMin = Math.max(vMin, 1e-6); }
  const x = (t) => pad.l + (t - tMin) / (tMax - tMin || 1) * (width - pad.l - pad.r);
  const y = (v) => {
    if (log) {
      const a = Math.log(vMin), b = Math.log(vMax);
      return pad.t + (1 - (Math.log(v) - a) / (b - a || 1)) * (height - pad.t - pad.b);
    }
    return pad.t + (1 - (v - vMin) / (vMax - vMin || 1)) * (height - pad.t - pad.b);
  };
  let paths = '';
  seriesList.forEach((s, i) => {
    const pts = (s.data || []).map((p) => `${x(Date.parse(p.time)).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    paths += `<polyline fill="none" stroke="${colors[i % colors.length]}" stroke-width="1.5" points="${pts}"/>`;
    paths += `<text x="${width - pad.r - 8}" y="${pad.t + 14 + i * 16}" fill="${colors[i % colors.length]}" font-size="11" text-anchor="end">${escapeXml(s.label || s.id || '')}</text>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#0d0d0d"/>
  <text x="${pad.l}" y="24" fill="#eee" font-size="14">${escapeXml(title)}</text>
  ${paths}
</svg>`;
}
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Try Python plot script; always also write SVG fallback. */
export function writeCharts(outDir, plotData, pyScript) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'plot-data.json'), JSON.stringify(plotData));
  // SVG fallbacks from plotData.equitySeries if present
  if (plotData.equitySeries?.length) {
    const svg = svgEquityChart(plotData.equitySeries, { log: true, title: plotData.title || 'Equity (log)' });
    writeFileSync(path.join(outDir, 'equity-log.svg'), svg);
  }
  if (pyScript && existsSync(pyScript)) {
    writeFileSync('/tmp/rsl-eval-plot.json', JSON.stringify({ ...plotData, dir: outDir }));
    const r = spawnSync('python3', [pyScript], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.log('Python-Plot optional fehlgeschlagen — SVG-Fallback genutzt.', r.stderr?.slice(0, 200));
      return { python: false, svg: true };
    }
    return { python: true, svg: true };
  }
  return { python: false, svg: true };
}



/** Run one config and keep tradeLog / equity / stats / finalCash. */
export function runOneDetailed(series, bm, cfg, opts = {}) {
  const bt = rotationBacktest(series, opts.years ?? 5, cfg.n, {
    benchmarkBars: bm,
    mode: cfg.mode,
    rankTop: cfg.rankTop,
    confirmWeeks: cfg.confirmWeeks || 1,
    rsExit: cfg.rsExit,
    ...normStrategy(cfg),
    startCapital: opts.startCapital ?? 10000,
    fractional: opts.fractional !== false,
    sizeMode: opts.sizeMode || 'EQUITY',
    fee: opts.fee ?? 1,
    windowStart: opts.windowStart ?? null,
    windowEnd: opts.windowEnd ?? null,
    seedHoldings: opts.seedHoldings || null,
    seedCash: opts.seedCash,
  });
  return {
    ...metricsFromBt(bt),
    tradeLog: bt.tradeLog || [],
    weeklyLog: bt.weeklyLog || [],
    holdings: bt.holdings || [],
    finalCash: bt.finalCash ?? bt.stats?.finalCash,
    stats: bt.stats || {},
    raw: bt,
  };
}

/** Stats from a continuous daily/weekly equity curve (same definitions as rotationBacktest). */
export function statsFromEquityCurve(equity, { startCapital, benchmarkEquity = null } = {}) {
  if (!equity?.length) {
    return { cagr: null, maxDD: null, mar: null, sharpe: null, finalEquity: startCapital, totalReturnPct: null, actualYears: 0 };
  }
  const a = equity[0].value;
  const b = equity.at(-1).value;
  const y = (Date.parse(equity.at(-1).time) - Date.parse(equity[0].time)) / (365.25 * 86400e3);
  const cagr = y > 0 && a > 0 ? 100 * ((b / a) ** (1 / y) - 1) : null;
  let peak = -Infinity, mdd = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.value);
    if (peak > 0) mdd = Math.min(mdd, p.value / peak - 1);
  }
  const maxDD = 100 * mdd;
  const absDD = Math.abs(maxDD);
  const mar = absDD > 1e-9 && Number.isFinite(cagr) ? cagr / absDD : null;
  const sh = sharpe(weekRets(equity));
  const out = {
    cagr, maxDD, mar, sharpe: sh,
    finalEquity: b,
    startCapital: startCapital ?? a,
    totalReturnPct: a > 0 ? 100 * (b / a - 1) : null,
    actualYears: y,
  };
  if (benchmarkEquity?.length >= 2 && startCapital) {
    const ba = benchmarkEquity[0].value, bb = benchmarkEquity.at(-1).value;
    out.benchmarkTotalReturnPct = ba > 0 ? 100 * (bb / ba - 1) : null;
    out.benchmarkCagr = y > 0 && ba > 0 ? 100 * ((bb / ba) ** (1 / y) - 1) : null;
  }
  return out;
}

/** Build retune/trade periods. period: yearly|semiannual|quarterly */
export function buildWfPeriods({ firstYear, lastYear, period = 'yearly' }) {
  const periods = [];
  if (period === 'yearly') {
    for (let Y = firstYear; Y <= lastYear; Y++) {
      periods.push({ id: String(Y), tradeFrom: sec(`${Y}-01-01`), tradeTo: sec(`${Y}-12-31`), tuneEnd: sec(`${Y - 1}-12-31`) });
    }
  } else if (period === 'semiannual') {
    for (let Y = firstYear; Y <= lastYear; Y++) {
      periods.push({ id: `${Y}H1`, tradeFrom: sec(`${Y}-01-01`), tradeTo: sec(`${Y}-06-30`), tuneEnd: sec(`${Y - 1}-12-31`) });
      periods.push({ id: `${Y}H2`, tradeFrom: sec(`${Y}-07-01`), tradeTo: sec(`${Y}-12-31`), tuneEnd: sec(`${Y}-06-30`) });
    }
  } else {
    for (let Y = firstYear; Y <= lastYear; Y++) {
      for (let q = 1; q <= 4; q++) {
        const startM = (q - 1) * 3 + 1;
        const endM = q * 3;
        const endD = [31, endM === 6 || endM === 9 ? 30 : 31, 30, 31][q - 1];
        periods.push({
          id: `${Y}Q${q}`,
          tradeFrom: sec(`${Y}-${String(startM).padStart(2, '0')}-01`),
          tradeTo: sec(`${Y}-${String(endM).padStart(2, '0')}-${String(endD).padStart(2, '0')}`),
          tuneEnd: sec(iso(sec(`${Y}-${String(startM).padStart(2, '0')}-01`) - 86400)),
        });
      }
    }
  }
  return periods;
}

/**
 * Walk-forward backtest: retune each period-end, trade next period with chosen config.
 * Builds a continuous daily MTM equity curve; MaxDD/Sharpe/MAR/CAGR from that curve
 * (same definitions as fixed rotationBacktest runs).
 *
 * transition:
 *   - 'carry' (default): holdings the new config would still hold are carried (no sell/rebuy/fees);
 *     others exit/enter under the new rules from the first trading Monday of the new period.
 *   - 'reset': flat cash at each period boundary (sell all at prior end, redeploy next period).
 */
export async function runWalkForwardBacktest({
  series, benchmarkBars, seriesPath, benchPath,
  firstYear, lastYear, wfWindow = 'expanding', rollYears = 2, period = 'yearly',
  transition = 'carry',
  anchorSec, grid = DEFAULT_GRID, selection = DEFAULT_SELECTION, manualCfg = null,
  startCapital = 10000, fee = 1, sizeMode = 'EQUITY', fractional = true, workers,
  onProgress, ckpt,
  /** Optional: pre-chosen configs per period id → skip tune (for research reruns). */
  picksByPeriod = null,
} = {}) {
  const anchor = anchorSec ?? sec(`${firstYear - 2}-01-01`);
  const periods = buildWfPeriods({ firstYear, lastYear, period });
  const trans = String(transition || 'carry').toLowerCase() === 'reset' ? 'reset' : 'carry';

  let cash = startCapital;
  let seedHoldings = [];
  const equity = [];
  const benchmarkEquity = [];
  const tradeLog = [];
  const weeklyLog = [];
  const yearly = [];
  let bmAnchorPx = null;

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    let tuneStart = wfWindow === 'expanding' ? anchor : (p.tuneEnd - rollYears * 365.25 * 86400);
    if (tuneStart < anchor) tuneStart = anchor;
    if (p.tuneEnd <= tuneStart + 60 * 86400) continue;

    onProgress?.({
      phase: 'tune', period: p.id, i, total: periods.length,
      progress: Math.round(5 + (i / periods.length) * 85),
      message: `Tune ${p.id} (${wfWindow})…`,
    });

    let pick;
    if (picksByPeriod?.[p.id]) {
      pick = picksByPeriod[p.id];
    } else if (manualCfg) {
      pick = { ...manualCfg };
    } else {
      const tuned = await tuneWindow({
        label: `WF-${wfWindow}-${p.id}`,
        windowStart: tuneStart, windowEnd: p.tuneEnd,
        seriesPath, benchPath, grid, selection, manualCfg: null,
        startCapital, fee, sizeMode, fractional, workers,
        ckpt, ckptKey: `tune_wf_${wfWindow}_${p.id}`,
      });
      pick = tuned.pick || tuned.bestPlateau || tuned.bestRaw;
      if (!pick) throw new Error(`Keine gültige Config für Periode ${p.id}`);
    }

    onProgress?.({
      phase: 'trade', period: p.id, i, total: periods.length,
      progress: Math.round(5 + ((i + 0.7) / periods.length) * 85),
      message: `Handel ${p.id}: ${fmtCfg(pick)} [${trans}]`,
      config: fmtCfg(pick),
    });

    const yearsApprox = Math.max(0.25, (p.tradeTo - p.tradeFrom) / (365.25 * 86400));
    const periodStartEquity = cash + seedHoldings.reduce((v, h) => v + h.shares * (h.last || h.entryPrice || 0), 0);

    const detailed = runOneDetailed(series, benchmarkBars, pick, {
      years: yearsApprox,
      startCapital: trans === 'reset' ? (equity.length ? (equity.at(-1).value) : startCapital) : Math.max(periodStartEquity, startCapital),
      fee, sizeMode, fractional,
      windowStart: p.tradeFrom, windowEnd: p.tradeTo,
      seedHoldings: trans === 'carry' && seedHoldings.length ? seedHoldings : null,
      seedCash: trans === 'carry' ? cash : (equity.length ? equity.at(-1).value : startCapital),
    });

    // For reset: seedCash = full equity as cash, no holdings → initial buys on first Monday.
    // For carry: seedHoldings + cash; first Monday applies new exit rules (kept names: no sell/rebuy).

    const cfgLabel = fmtCfg(pick);
    for (const t of detailed.tradeLog || []) {
      tradeLog.push({ ...t, activeConfig: cfgLabel, period: p.id });
    }
    for (const w of detailed.weeklyLog || []) {
      weeklyLog.push({ ...w, activeConfig: cfgLabel, period: p.id });
    }

    const eq = detailed.equity || [];
    const bm = detailed.benchmarkEquity || [];
    if (bmAnchorPx == null && bm.length) {
      // rebuild benchmark from raw bars scaled to startCapital once we have first equity date
    }
    const skipFirst = equity.length > 0;
    for (let j = 0; j < eq.length; j++) {
      if (skipFirst && j === 0) continue;
      equity.push(eq[j]);
    }

    const retPct = eq.length >= 2 && eq[0].value > 0 ? 100 * (eq.at(-1).value / eq[0].value - 1) : null;
    // Period return from continuous curve segment
    const segStart = skipFirst && eq.length ? eq[0].value : (eq[0]?.value);
    const segEnd = eq.at(-1)?.value;
    const periodRet = segStart > 0 && segEnd != null ? 100 * (segEnd / segStart - 1) : retPct;

    yearly.push({
      period: p.id,
      config: cfgLabel,
      mode: pick.mode, n: pick.n, rankTop: pick.rankTop,
      rsExit: pick.rsExit ? 1 : 0, confirmWeeks: pick.confirmWeeks || 1,
      ...normStrategy(pick),
      startCapital: segStart, endCapital: segEnd,
      retPct: periodRet,
      cagr: detailed.cagr, maxDD: detailed.maxDD, mar: detailed.mar, sharpe: detailed.sharpe,
      tuneStart: iso(tuneStart), tuneEnd: iso(p.tuneEnd),
      trades: (detailed.tradeLog || []).length,
      transition: trans,
    });

    // Prepare seed for next period
    if (trans === 'carry') {
      cash = detailed.finalCash ?? detailed.stats?.finalCash ?? 0;
      seedHoldings = (detailed.holdings || []).map((h) => ({
        ticker: h.ticker,
        shares: h.shares,
        entryPrice: h.entryPrice,
        last: h.last,
        bought: h.bought,
        feePaid: 0, // already paid; don't double-count
        execPriceKind: 'carry',
        // Trailing peak continues across periods (only exposed by the engine when TRAIL>0).
        ...(Number.isFinite(h.trailPeak) ? { peakClose: h.trailPeak } : {}),
      }));
    } else {
      cash = detailed.finalEquity ?? eq.at(-1)?.value ?? cash;
      seedHoldings = [];
    }
  }

  // Continuous benchmark aligned to equity dates
  if (benchmarkBars?.length && equity.length) {
    const bmMap = new Map(benchmarkBars.map((b) => [iso(b.time), b.close]));
    let startPx = null;
    for (const b of benchmarkBars) {
      if (iso(b.time) >= equity[0].time && b.close > 0) { startPx = b.close; break; }
    }
    if (startPx) {
      const sh = startCapital / startPx;
      let last = startPx;
      for (const pt of equity) {
        if (bmMap.has(pt.time)) last = bmMap.get(pt.time);
        benchmarkEquity.push({ time: pt.time, value: sh * last });
      }
    }
  }

  // Fill bmRet / excess on yearly from continuous bench if possible
  for (const y of yearly) {
    const pts = equity.filter((e) => e.time >= `${y.period}-01-01` && e.time <= `${y.period}-12-31`);
    const bpts = benchmarkEquity.filter((e) => e.time >= `${y.period}-01-01` && e.time <= `${y.period}-12-31`);
    if (bpts.length >= 2 && bpts[0].value > 0) {
      y.bmRet = 100 * (bpts.at(-1).value / bpts[0].value - 1);
      if (y.retPct != null) y.excess = y.retPct - y.bmRet;
    }
  }

  const curveStats = statsFromEquityCurve(equity, { startCapital, benchmarkEquity });
  onProgress?.({ phase: 'done', progress: 100, message: 'Fertig' });

  return {
    paramMode: 'WALKFORWARD',
    wfWindow, rollYears, period, firstYear, lastYear,
    transition: trans,
    selection, grid: { n: grid.n, rankTop: grid.rankTop, modes: grid.modes, confirmWeeks: grid.confirmWeeks, rsExit: grid.rsExit, trail: grid.trail, trailLock: grid.trailLock, ranking: grid.ranking },
    yearly,
    equity,
    benchmarkEquity,
    tradeLog,
    weeklyLog,
    holdings: seedHoldings,
    exits: tradeLog.filter((t) => t.action === 'SELL'),
    rebalances: [],
    stats: {
      ...curveStats,
      sharpe: curveStats.sharpe,
      mar: curveStats.mar,
      trades: tradeLog.length,
      tradesClosed: tradeLog.filter((x) => x.action === 'SELL').length,
      tradeLogRows: tradeLog.length,
      weeklyLogRows: weeklyLog.length,
      yearlyRows: yearly.length,
      feePerTrade: fee, sizeMode, fractional,
      mode: 'WALKFORWARD',
      transition: trans,
      equityPoints: equity.length,
      maxDDSource: 'daily_equity_curve',
    },
    startCapital, fee, sizeMode, fractional,
    mode: 'WALKFORWARD',
    cagr: curveStats.cagr,
    maxDD: curveStats.maxDD,
    mar: curveStats.mar,
    sharpe: curveStats.sharpe,
  };
}


export { toGermanCsv };
