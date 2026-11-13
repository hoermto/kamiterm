import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodPnl, niceTicks } from '../public/js/equity-pnl.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('periodPnl: Backtest ohne Einzahlungen, Jahr', () => {
  const eq = [
    { time: '2023-01-02', value: 10000 }, { time: '2023-06-01', value: 11000 }, { time: '2023-12-29', value: 12000 },
    { time: '2024-01-05', value: 11500 }, { time: '2024-12-27', value: 9000 },
  ];
  const r = periodPnl(eq, null, 'Y');
  assert.deepEqual(r.map((x) => x.period), ['2023', '2024']);
  near(r[0].pnl, 2000); near(r[0].pct, 20);
  near(r[1].pnl, -3000); near(r[1].pct, -25); // Basis = Jahresende 2023, nicht erster Punkt 2024
  near(r.reduce((s, x) => s + x.pnl, 0), 9000 - 10000);
});

test('periodPnl: Monat', () => {
  const eq = [{ time: '2024-01-31', value: 100 }, { time: '2024-02-15', value: 105 }, { time: '2024-02-28', value: 110 }, { time: '2024-03-01', value: 99 }];
  const r = periodPnl(eq, null, 'M');
  assert.deepEqual(r.map((x) => [x.period, x.pnl]), [['2024-01', 0], ['2024-02', 10], ['2024-03', -11]]);
});

test('periodPnl: Einzahlungen werden vom P&L abgezogen', () => {
  const eq = [{ time: '2024-03-01', value: 1000 }, { time: '2024-12-30', value: 1300 }, { time: '2025-02-01', value: 2400 }, { time: '2025-12-30', value: 2200 }];
  const dep = [{ time: '2024-03-01', value: 1000 }, { time: '2024-12-30', value: 1000 }, { time: '2025-02-01', value: 2000 }, { time: '2025-12-30', value: 2000 }];
  const r = periodPnl(eq, dep, 'Y');
  near(r[0].pnl, 300); near(r[0].pct, 30);
  near(r[1].flow, 1000); near(r[1].pnl, -100); // 2200 − 1300 − 1000
  near(r[1].pct, -100 / 2300 * 100);
  near(r.reduce((s, x) => s + x.pnl, 0), 2200 - 2000);
});

test('niceTicks: runde Schritte inkl. 0', () => {
  const t = niceTicks(-1234, 5678, 5);
  assert.ok(t.includes(0));
  assert.ok(t[0] <= -1234 && t.at(-1) >= 5678);
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
});
