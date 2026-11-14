import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exDivEvents, stats, summarizeExDiv, periodStart, nextExDate, firstOnOrAfter } from '../lib/event-moves.js';

// Daily bars on consecutive days from 2026-01-01; each item [open, close].
const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const bars = (oc) => oc.map(([open, close], i) => ({ time: Date.parse(`${day(i)}T14:30:00Z`) / 1000, open, close }));
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// 0-5: run-up 95 -> 100 (cum = day 5), ex-day 6: open 99, close 99.2; then 99.5, 100.1, ...
const B = bars([[95, 95], [96, 96], [97, 97], [98, 98], [99, 99], [100, 100], [99, 99.2], [99.3, 99.5], [99.8, 100.1],
  [100, 101], [101, 102], [102, 103], [103, 104], [104, 105], [105, 106], [106, 107], [107, 108], [108, 109], [109, 110], [110, 111], [111, 112], [112, 113]]);

test('exDivEvents: cum day, run-up, gap, ex-day, drop vs. dividend, after 1/2/3 weeks, recovery', () => {
  const [e] = exDivEvents([{ exDate: day(6), amount: 1 }], B);
  assert.equal(e.cumDate, day(5)); assert.equal(e.exDay, day(6)); assert.equal(e.cumClose, 100);
  near(e.yieldPct, 1);
  near(e.runUpPct, (100 / 95 - 1) * 100);
  near(e.gapPct, -1); near(e.exDayPct, -0.8); near(e.exDayAmt, -0.8); near(e.dropVsDiv, 0.8);
  assert.equal(e.after[5].date, day(10)); near(e.after[5].pricePct, 2); near(e.after[5].totalPct, 3); near(e.after[5].amt, 2);
  assert.equal(e.after[10].date, day(15)); near(e.after[10].pricePct, 7);
  assert.equal(e.after[15].date, day(20)); near(e.after[15].pricePct, 12);
  assert.equal(e.recoveryDays, 2); assert.equal(e.recoveryOpen, false);
});

test('exDivEvents: an ex-date on a holiday uses the next trading day; too little data is skipped or marked open', () => {
  const holiday = bars([[10, 10], [10, 10], [9, 9]]).filter((_, i) => i !== 1); // day 1 missing
  const [e] = exDivEvents([{ exDate: day(1), amount: 0.5 }], holiday);
  assert.equal(e.exDay, day(2)); assert.equal(e.cumDate, day(0));
  assert.equal(e.runUpPct, null, 'not enough days before');
  assert.equal(e.after[5], null, 'not enough days after');
  assert.equal(e.recoveryDays, null); assert.equal(e.recoveryOpen, true, 'data ends: still running');
  assert.deepEqual(exDivEvents([{ exDate: day(0), amount: 1 }], holiday), [], 'no cum day before the first bar');
  assert.deepEqual(exDivEvents([{ exDate: '2027-01-01', amount: 1 }], holiday), [], 'after the data');
  assert.deepEqual(exDivEvents([{ exDate: day(1), amount: 0 }, { exDate: 'x', amount: 1 }], holiday), []);
});

test('exDivEvents: no recovery before the next ex-date counts as not recovered (not open)', () => {
  const falling = bars([[10, 10], [10, 10], [9, 9], [9, 9], [8.9, 8.9], [8.8, 8.8], [8.7, 8.7]]);
  const ev = exDivEvents([{ exDate: day(2), amount: 0.2 }, { exDate: day(5), amount: 0.2 }], falling);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].exDate, day(5), 'newest first');
  assert.equal(ev[1].recoveryDays, null); assert.equal(ev[1].recoveryOpen, false);
});

test('stats: average, median, min, max, sample SD, share up', () => {
  const s = stats([1, -2, 3, NaN, null, 4]);
  assert.equal(s.n, 4); near(s.avg, 1.5); near(s.median, 2); assert.equal(s.min, -2); assert.equal(s.max, 4);
  near(s.sd, Math.sqrt(((1 - 1.5) ** 2 + (-2 - 1.5) ** 2 + (3 - 1.5) ** 2 + (4 - 1.5) ** 2) / 3));
  near(s.upPct, 75);
  assert.deepEqual(stats([]), { n: 0, avg: null, median: null, min: null, max: null, sd: null, upPct: null });
  assert.equal(stats([5]).sd, null);
});

test('summarizeExDiv: period filter, recovery share without open events', () => {
  const ev = [
    { exDate: '2026-06-01', yieldPct: 1, runUpPct: 1, gapPct: -1, exDayPct: -1, exDayAmt: -1, dropVsDiv: 1, after: { 5: { pricePct: 2, totalPct: 3, amt: 2 } }, recoveryDays: null, recoveryOpen: true },
    { exDate: '2025-06-01', yieldPct: 1, runUpPct: 2, gapPct: -1, exDayPct: -2, exDayAmt: -2, dropVsDiv: 2, after: { 5: { pricePct: -1, totalPct: 0, amt: -1 } }, recoveryDays: 4, recoveryOpen: false },
    { exDate: '2023-06-01', yieldPct: 1, runUpPct: 9, gapPct: -1, exDayPct: -3, exDayAmt: -3, dropVsDiv: 3, after: { 5: null }, recoveryDays: null, recoveryOpen: false },
  ];
  const all = summarizeExDiv(ev, { horizons: [5] });
  assert.equal(all.n, 3); assert.equal(all.from, '2023-06-01'); assert.equal(all.to, '2026-06-01');
  assert.equal(all.recovery.n, 2); assert.equal(all.recovery.recovered, 1); near(all.recovery.pct, 50); assert.equal(all.recovery.open, 1);
  assert.equal(all.after[5].price.n, 2);
  const two = summarizeExDiv(ev, { since: '2024-11-14', horizons: [5] });
  assert.equal(two.n, 2); near(two.runUp.avg, 1.5); assert.equal(two.recovery.days.median, 4);
});

test('periodStart and firstOnOrAfter', () => {
  assert.equal(periodStart('2Y', '2026-11-14'), '2024-11-14');
  assert.equal(periodStart('ALL', '2026-11-14'), null);
  assert.equal(firstOnOrAfter(['2026-01-01', '2026-01-03'], '2026-01-02'), 1);
  assert.equal(firstOnOrAfter(['2026-01-01'], '2027-01-01'), 1);
});

test('nextExDate: announced date first, else estimated from the usual gap; stopped payers give null', () => {
  const q = ['2025-02-10', '2025-05-10', '2025-08-10', '2025-11-10', '2026-02-10', '2026-05-10', '2026-08-10'].map((exDate) => ({ exDate, amount: 0.5 }));
  assert.deepEqual(nextExDate([...q, { exDate: '2026-11-20', amount: 0.55 }], '2026-11-14'), { date: '2026-11-20', amount: 0.55, estimated: false });
  // Usual gap 92 days: 2026-08-10 + 92 = 2026-11-10, 4 days ago and not announced -> due (overdue).
  const due = nextExDate(q, '2026-11-14');
  assert.deepEqual(due, { date: '2026-11-10', amount: 0.5, estimated: true, overdue: true, gapDays: 92 });
  // On 2026-10-01 the same date is still ahead.
  assert.equal(nextExDate(q, '2026-10-01').overdue, false);
  // More than half a gap after the usual date: the estimate moves on to the next one.
  assert.equal(nextExDate(q, '2027-01-05').date, '2027-02-10');
  assert.equal(nextExDate(q, '2027-06-01'), null, 'two payments missed');
  assert.equal(nextExDate(q.slice(0, 2), '2025-06-01'), null, 'too little history');
});
