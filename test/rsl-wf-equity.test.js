import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  statsFromEquityCurve, runWalkForwardBacktest, buildWfPeriods, fmtCfg,
} from '../scripts/lib/rsl-eval-core.mjs';
import { rotationBacktest } from '../lib/fn/grokki-math.js';

describe('statsFromEquityCurve (daily MaxDD)', () => {
  it('MaxDD reflects intra-year dip larger than any calendar-year loss', () => {
    // Yearly ends: 100→95 (−5%), 95→100 (+5.26%). Yearly-chain MaxDD would be −5%.
    // Daily curve dips to 70 mid-year-1 → MaxDD must be −30%, not −5%.
    const equity = [];
    const push = (time, value) => equity.push({ time, value });
    push('2020-01-02', 100);
    push('2020-03-15', 70);   // intra-year crash
    push('2020-12-31', 95);   // year end −5% vs start
    push('2021-01-04', 95);
    push('2021-06-01', 80);
    push('2021-12-31', 100);

    const s = statsFromEquityCurve(equity, { startCapital: 100 });
    assert.ok(s.maxDD <= -29.5 && s.maxDD >= -30.5, `expected MaxDD≈-30, got ${s.maxDD}`);
    // Naive yearly-end chain MaxDD
    const yearlyEnds = [95, 100];
    let peak = 100, mddY = 0;
    for (const e of yearlyEnds) { peak = Math.max(peak, e); mddY = Math.min(mddY, e / peak - 1); }
    assert.ok(Math.abs(100 * mddY) < 10, 'yearly-chain MaxDD should be shallow');
    assert.ok(Math.abs(s.maxDD) > Math.abs(100 * mddY) + 10, 'daily MaxDD must be deeper than yearly-chain');
  });

  it('CAGR/MAR use the same curve', () => {
    const equity = [
      { time: '2018-01-02', value: 10000 },
      { time: '2019-01-02', value: 11000 },
      { time: '2020-01-02', value: 9000 },
      { time: '2021-01-02', value: 12000 },
    ];
    const s = statsFromEquityCurve(equity, { startCapital: 10000 });
    assert.ok(Number.isFinite(s.cagr));
    assert.ok(s.maxDD < -15); // 11000→9000 from peak
    assert.ok(Number.isFinite(s.mar));
  });
});

describe('rotationBacktest seedHoldings carry', () => {
  it('carries shares without forced sell on first bar when seeded', () => {
    // Minimal synthetic series: 2 tickers, enough weeks for RSL
    const mk = (ticker, start, n = 80, drift = 0.002) => {
      const bars = [];
      let px = start;
      const t0 = Date.parse('2020-01-02T00:00:00Z') / 1000;
      for (let i = 0; i < n; i++) {
        px *= 1 + drift;
        const t = t0 + i * 86400;
        bars.push({ time: t, open: px, high: px * 1.01, low: px * 0.99, close: px });
      }
      return { ticker, bars };
    };
    const series = [mk('AAA', 100, 90, 0.001), mk('BBB', 50, 90, 0.0015)];
    const bm = mk('BM', 100, 90, 0.0005).bars;
    const winStart = series[0].bars[40].time;
    const winEnd = series[0].bars[70].time;
    const seedPx = series[0].bars[39].close;
    const bt = rotationBacktest(series, 1, 2, {
      benchmarkBars: bm, mode: 'OFF', rankTop: 25, rsExit: false,
      startCapital: 10000, fee: 1, windowMode: 'EQUITY', fractional: true,
      windowStart: winStart, windowEnd: winEnd,
      seedCash: 1000,
      seedHoldings: [{ ticker: 'AAA', shares: 50, entryPrice: seedPx, last: seedPx, bought: '2020-01-15', feePaid: 1 }],
    });
    assert.ok(bt.equity?.length > 5);
    // First equity point should reflect carried shares + cash (≈1000+50*px), not flat 10000 redeploy only
    const first = bt.equity[0].value;
    assert.ok(first > 2000, `seeded MTM should be well above cash-only; got ${first}`);
    // No immediate SELL of AAA on day 0 solely due to transition (OFF + rsExit false → no exit)
    const earlySells = (bt.tradeLog || []).filter((t) => t.action === 'SELL' && t.ticker === 'AAA' && t.date === bt.equity[0].time);
    assert.equal(earlySells.length, 0, 'carried AAA must not be fee-sold on first bar without exit signal');
  });
});

describe('buildWfPeriods', () => {
  it('still builds yearly periods', () => {
    assert.equal(buildWfPeriods({ firstYear: 2020, lastYear: 2021, period: 'yearly' }).length, 2);
  });
});
