import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJobsFromGrid, enrichCells, pickBest, DEFAULT_SELECTION, DEFAULT_GRID,
  buildWfPeriods, fmtCfg, mergeSelection, passesConstraints, slimCfg, sec,
} from '../scripts/lib/rsl-eval-core.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('rsl-eval CLI help', () => {
  it('prints German help', () => {
    const r = spawnSync(process.execPath, ['scripts/rsl-eval.mjs', '--help'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Walk-Forward/);
    assert.match(r.stdout, /jährlich/);
    assert.match(r.stdout, /--manual/);
  });
});

describe('grid + selection', () => {
  it('builds coarse jobs without FEE as dimension', () => {
    const jobs = buildJobsFromGrid(DEFAULT_GRID, {
      windowStart: sec('2020-01-01'), windowEnd: sec('2021-12-31'), fee: 1,
    });
    assert.ok(jobs.length >= 20 && jobs.length <= 80);
    assert.ok(jobs.every((j) => j.fee === 1));
    assert.ok(jobs.some((j) => j.mode === 'OFF'));
  });

  it('picks plateau under selection rule', () => {
    const raw = [
      { id: 'a', mode: 'RANK', n: 10, rankTop: 10, rsExit: true, confirmWeeks: 1, mar: 1.0, sharpe: 1.0, mar1: 0.9, mar2: 1.1, cagr: 20, maxDD: -20 },
      { id: 'b', mode: 'RANK', n: 15, rankTop: 10, rsExit: true, confirmWeeks: 1, mar: 1.2, sharpe: 0.5, mar1: 0.4, mar2: 0.5, cagr: 24, maxDD: -20 },
      { id: 'c', mode: 'OFF', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1, mar: 0.8, sharpe: 0.8, mar1: 0.8, mar2: 0.8, cagr: 16, maxDD: -20 },
    ];
    const cells = enrichCells(raw, DEFAULT_SELECTION);
    const picks = pickBest(cells, DEFAULT_SELECTION);
    assert.ok(picks.bestRaw);
    assert.ok(picks.bestPlateau);
    assert.equal(picks.source, 'plateau');
  });

  it('honours excludeModes constraint', () => {
    const sel = mergeSelection(DEFAULT_SELECTION, { constraints: { excludeModes: ['OFF'] } });
    assert.equal(passesConstraints({ mode: 'OFF', mar: 2, maxDD: -10 }, sel), false);
    assert.equal(passesConstraints({ mode: 'RANK', mar: 2, maxDD: -10 }, sel), true);
  });

  it('manual pick wins', () => {
    const raw = [
      { id: 'a', mode: 'RANK', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 1, mar: 1.0, sharpe: 1, mar1: 1, mar2: 1, cagr: 10, maxDD: -10 },
      { id: 'b', mode: 'CONFIRM', n: 8, rankTop: 8, rsExit: true, confirmWeeks: 2, mar: 2.0, sharpe: 2, mar1: 2, mar2: 2, cagr: 20, maxDD: -10 },
    ];
    const cells = enrichCells(raw);
    const picks = pickBest(cells, DEFAULT_SELECTION, { mode: 'RANK', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 1 });
    assert.equal(picks.source, 'manual');
    assert.equal(picks.pick.mode, 'RANK');
  });
});

describe('walk-forward periods', () => {
  it('yearly periods', () => {
    const p = buildWfPeriods({ firstYear: 2020, lastYear: 2022, period: 'yearly' });
    assert.equal(p.length, 3);
    assert.equal(p[0].id, '2020');
    assert.ok(p[0].tuneEnd < p[0].tradeFrom);
  });
  it('semiannual + quarterly', () => {
    assert.equal(buildWfPeriods({ firstYear: 2021, lastYear: 2021, period: 'semiannual' }).length, 2);
    assert.equal(buildWfPeriods({ firstYear: 2021, lastYear: 2021, period: 'quarterly' }).length, 4);
  });
  it('fmtCfg', () => {
    assert.match(fmtCfg({ mode: 'OFF', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 }), /OFF N=25/);
  });
});
