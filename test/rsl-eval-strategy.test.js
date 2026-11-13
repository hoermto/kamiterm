import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR (never the real watchlist)
// Walk-forward / grid / split pass TRAIL, TRAILLOCK and RANKING through (fixed or as tuning dims). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildJobsFromGrid, enrichCells, pickBest, slimCfg, fmtCfg, runOne, runOneDetailed, runWalkForwardBacktest,
  withStrategyGrid, normStrategy, DEFAULT_GRID, DEFAULT_SELECTION, sec,
} from '../scripts/lib/rsl-eval-core.mjs';
import { rotationBacktest } from '../lib/fn/grokki-math.js';
import { wfStrategyParams, wfParamSig } from '../lib/rsl-eval-jobs.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = Date.UTC(2022, 0, 3) / 1000, D = 86400, N = 900;
const mk = (f) => Array.from({ length: N }, (_, i) => { const c = f(i); return { time: T + i * D, open: c, high: c, low: c, close: c, volume: 1e6 }; });
// A: rise, sharp drop (trailing stop fires), recovery. B/C: slow drifts. Flat benchmark.
const A = mk((i) => (i < 500 ? 100 + i * 0.2 : i < 520 ? 200 - (i - 500) * 3 : 140 + (i - 520) * 0.3));
const Bs = mk((i) => 100 + i * 0.05), Cs = mk((i) => 120 - i * 0.02);
const series = [{ ticker: 'A', bars: A }, { ticker: 'B', bars: Bs }, { ticker: 'C', bars: Cs }];
const bench = mk(() => 100);
const W = { windowStart: T + 400 * D, windowEnd: T + (N - 1) * D };

test('default grid jobs keep old ids and carry TRAIL 0 / TRAILLOCK 4 / RSL26', () => {
  const g = withStrategyGrid(DEFAULT_GRID, {});
  const jobs = buildJobsFromGrid(g, { windowStart: sec('2020-01-01'), windowEnd: sec('2021-12-31') });
  const old = buildJobsFromGrid(DEFAULT_GRID, { windowStart: sec('2020-01-01'), windowEnd: sec('2021-12-31') });
  assert.deepEqual(jobs.map((j) => j.id), old.map((j) => j.id));
  assert.ok(jobs.every((j) => j.trail === 0 && j.trailLock === 4 && j.ranking === 'RSL26'));
  assert.ok(jobs.every((j) => !/TR|RK/.test(j.id.split('|').slice(5).join('|'))));
});

test('fixed strategy is applied to every grid job; tuning adds dimensions', () => {
  const fixed = withStrategyGrid({ n: [5], rankTop: [25], modes: ['RANK'], rsExit: [true] }, { trail: 20, trailLock: 6, ranking: 'MOM52_4' });
  const jf = buildJobsFromGrid(fixed, W);
  assert.equal(jf.length, 1);
  assert.deepEqual([jf[0].trail, jf[0].trailLock, jf[0].ranking], [20, 6, 'MOM52_4']);
  assert.match(jf[0].id, /\|TR20\|TL6\|RKMOM52_4$/);
  const tuned = withStrategyGrid({ n: [5], rankTop: [25], modes: ['RANK'], rsExit: [true] }, { trailLock: 4 }, { tuneTrail: '0,20', tuneRanking: 'RSL26,RSL39,MOM52_4' });
  const jt = buildJobsFromGrid(tuned, W);
  assert.equal(jt.length, 6);
  assert.deepEqual(new Set(jt.map((j) => j.id)).size, 6);
  assert.deepEqual([...new Set(jt.map((j) => j.trail))].sort(), [0, 20]);
  assert.deepEqual([...new Set(jt.map((j) => j.ranking))].sort(), ['MOM52_4', 'RSL26', 'RSL39']);
  assert.throws(() => withStrategyGrid({}, {}, { tuneRanking: 'RSL20' }), /RANKING/);
});

test('plateau neighbours never mix TRAIL/RANKING; slimCfg/fmtCfg/manual pick keep them', () => {
  const base = { mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1, sharpe: 1, mar1: 1, mar2: 1, cagr: 10, maxDD: -10 };
  const raw = [
    { ...base, id: 'a', mar: 1.0, trail: 0, trailLock: 4, ranking: 'RSL26' },
    { ...base, id: 'b', mar: 2.0, trail: 20, trailLock: 4, ranking: 'MOM52_4' },
  ];
  const cells = enrichCells(raw, DEFAULT_SELECTION);
  assert.equal(cells.find((c) => c.id === 'a').smoothScore, cells.find((c) => c.id === 'a').score);
  const pick = pickBest(cells, { ...DEFAULT_SELECTION, walkForwardPick: 'raw' }).pick;
  const s = slimCfg(pick);
  assert.deepEqual([s.trail, s.trailLock, s.ranking], [20, 4, 'MOM52_4']);
  assert.equal(fmtCfg(s), 'RANK N=5 RT=25 RS=1 CW=1 TRAIL=20/4 RK=MOM52_4');
  assert.equal(fmtCfg({ ...base }), 'RANK N=5 RT=25 RS=1 CW=1', 'default label unchanged');
  const man = pickBest(cells, DEFAULT_SELECTION, { mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1, ...normStrategy({}) });
  assert.equal(man.pick.id, 'a');
});

test('runOne / runOneDetailed pass TRAIL/TRAILLOCK/RANKING to rotationBacktest', () => {
  const cfg = { mode: 'OFF', n: 1, rankTop: 25, rsExit: false, confirmWeeks: 1, trail: 20, trailLock: 4, ranking: 'RSL26' };
  const direct = rotationBacktest(series, 5, 1, { benchmarkBars: bench, mode: 'OFF', rankTop: 25, rsExit: false, confirmWeeks: 1, trail: 20, trailLock: 4, ranking: 'RSL26', fee: 1, startCapital: 10000, ...W });
  const r = runOneDetailed(series, bench, cfg, { ...W });
  assert.ok(direct.stats.trailingExits >= 1, 'synthetic drop triggers the trailing stop');
  assert.equal(r.stats.trailingExits, direct.stats.trailingExits);
  assert.equal(r.cagr, direct.cagr);
  const off = runOne(series, bench, { ...cfg, trail: 0 }, { ...W });
  assert.notEqual(off.cagr, r.cagr);
  const mom = runOneDetailed(series, bench, { ...cfg, trail: 0, ranking: 'MOM52_4' }, { ...W });
  assert.equal(mom.stats.ranking, 'MOM52_4');
});

test('walk-forward (manual config) uses fixed TRAIL/RANKING per period, reports them, carries the trailing peak', async () => {
  const manualCfg = { mode: 'OFF', n: 1, rankTop: 25, rsExit: false, confirmWeeks: 1, ...normStrategy({ trail: 20, trailLock: 4 }) };
  const wf = await runWalkForwardBacktest({ series, benchmarkBars: bench, firstYear: 2023, lastYear: 2024, anchorSec: T, manualCfg, period: 'yearly' });
  assert.ok(wf.yearly.length >= 2);
  for (const y of wf.yearly) assert.deepEqual([y.trail, y.trailLock, y.ranking], [20, 4, 'RSL26']);
  assert.ok(wf.tradeLog.some((t) => t.trailing), 'trailing exit inside the WF');
  const off = await runWalkForwardBacktest({ series, benchmarkBars: bench, firstYear: 2023, lastYear: 2024, anchorSec: T, manualCfg: { ...manualCfg, trail: 0 }, period: 'yearly' });
  assert.ok(off.yearly.every((y) => y.trail === 0 && y.ranking === 'RSL26'));
  assert.ok(!off.tradeLog.some((t) => t.trailing));
});

test('WF job params: normalised strategy + signature changes with TRAIL/TRAILLOCK/RANKING/tuning', () => {
  assert.deepEqual(wfStrategyParams({}), { trail: 0, trailLock: 4, ranking: 'RSL26', tuneTrail: false, tuneRanking: false });
  assert.deepEqual(wfStrategyParams({ trail: '20', trailLock: '6', ranking: 'mom52_4', tuneTrail: 1 }), { trail: 20, trailLock: 6, ranking: 'MOM52_4', tuneTrail: true, tuneRanking: false });
  const base = { universe: 'SPX', wfWindow: 'expanding' };
  const sigs = new Set([
    wfParamSig(base), wfParamSig({ ...base, trail: 20 }), wfParamSig({ ...base, trail: 20, trailLock: 8 }),
    wfParamSig({ ...base, ranking: 'MOM52_4' }), wfParamSig({ ...base, tuneTrail: 1 }), wfParamSig({ ...base, tuneRanking: 1 }),
  ]);
  assert.equal(sigs.size, 6);
  assert.equal(wfParamSig(base), wfParamSig({ ...base, trail: 0, trailLock: 4, ranking: 'RSL26' }));
});

test('rsl-eval CLI: help lists strategy options; grid applies fixed TRAIL/RANKING; stale checkpoint ignored', () => {
  const h = spawnSync(process.execPath, ['scripts/rsl-eval.mjs', '--help'], { cwd: root, encoding: 'utf8' });
  assert.match(h.stdout, /--trail N/);
  assert.match(h.stdout, /--tune-ranking/);
  // Tiny synthetic universe through the CLI's file cache (no network): /tmp/rsl-eval-<KEY>-*.json.
  const key = `ZZT${process.pid}`;
  const sp = `/tmp/rsl-eval-${key}-series.json`, bp = `/tmp/rsl-eval-${key}-bench.json`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsl-eval-strat-'));
  const out = path.join(dir, 'out'), gridFile = path.join(dir, 'grid.json');
  try {
    fs.writeFileSync(sp, JSON.stringify(series)); fs.writeFileSync(bp, JSON.stringify(bench));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'checkpoint.json'), JSON.stringify({ paramSig: 'stale', done: { grid: { cells: [] } }, phase: 'grid' }));
    fs.writeFileSync(gridFile, JSON.stringify({ grid: { n: [1], rankTop: [25], modes: ['OFF'], rsExit: [false], confirmWeeks: [1] } }));
    const r = spawnSync(process.execPath, ['scripts/rsl-eval.mjs', 'grid', '--universe', key, '--from', '2023-02-06', '--to', '2024-06-17',
      '--grid', gridFile, '--out', out, '--resume', '--workers', '1', '--trail', '20', '--trail-lock', '4', '--ranking', 'RSL26', '--no-python'],
      { cwd: root, encoding: 'utf8', env: { ...process.env } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Checkpoint ignoriert/);
    const res = JSON.parse(fs.readFileSync(path.join(out, 'grid-results.json'), 'utf8'));
    assert.equal(res.cells.length, 1);
    assert.deepEqual([res.cells[0].trail, res.cells[0].trailLock, res.cells[0].ranking], [20, 4, 'RSL26']);
    const direct = runOne(series, bench, { mode: 'OFF', n: 1, rankTop: 25, rsExit: false, confirmWeeks: 1, trail: 20, trailLock: 4 },
      { windowStart: sec('2023-02-06'), windowEnd: sec('2024-06-17'), years: (sec('2024-06-17') - sec('2023-02-06')) / (365.25 * 86400) });
    assert.ok(Math.abs(res.cells[0].cagr - direct.cagr) < 1e-9, 'worker ran with TRAIL=20');
    const ck = JSON.parse(fs.readFileSync(path.join(out, 'checkpoint.json'), 'utf8'));
    assert.notEqual(ck.paramSig, 'stale');
    assert.match(ck.paramSig, /"trail":20/);
    assert.match(fs.readFileSync(path.join(out, 'grid.csv'), 'utf8'), /TRAIL;TRAILLOCK;RANKING/);
  } finally {
    fs.rmSync(sp, { force: true }); fs.rmSync(bp, { force: true }); fs.rmSync(dir, { recursive: true, force: true });
  }
});
