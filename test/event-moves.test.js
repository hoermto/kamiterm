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

// ---------- buy-write ----------
import { weeklyExpiryAfter, buyWriteEvents, simulateBuyWrite, summarizeBuyWrite, calDays } from '../lib/event-moves.js';

test('weeklyExpiryAfter: first Friday on/after the ex-date within DTE 2..10 from entry', () => {
  // 2026-11-10 is a Tuesday; entry Friday 2026-11-06 -> Friday 2026-11-13 is 7 days later.
  assert.equal(weeklyExpiryAfter('2026-11-10', '2026-11-06'), '2026-11-13');
  // ex-date Friday 2026-11-13, entry Wednesday 11-11: same-day Friday is only 2 days -> ok.
  assert.equal(weeklyExpiryAfter('2026-11-13', '2026-11-11'), '2026-11-13');
  // entry Thursday 11-12, ex Friday 11-13: 1 day is below DTE 2 -> next Friday 11-20 (8 days).
  assert.equal(weeklyExpiryAfter('2026-11-13', '2026-11-12'), '2026-11-20');
  // DTE window too narrow -> none.
  assert.equal(weeklyExpiryAfter('2026-11-13', '2026-11-12', { dteMin: 2, dteMax: 5 }), null);
  assert.equal(calDays('2026-11-06', '2026-11-13'), 7);
});

test('buyWriteEvents: entry N trading days before, exit at the last close on/before expiry; simulate today\'s terms', () => {
  // Real weekdays: Mon 2026-11-02 .. ; ex-date Wed 2026-11-11; entry 2 trading days before = Mon 11-09.
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16'];
  const closes = [98, 99, 100, 100, 100, 100, 101, 100, 101, 102, 103];
  const bw = days.map((d, i) => ({ time: Date.parse(`${d}T14:30:00Z`) / 1000, open: closes[i], close: closes[i] }));
  const [e] = buyWriteEvents([{ exDate: '2026-11-11', amount: 1 }], bw);
  assert.equal(e.entryDate, '2026-11-09'); assert.equal(e.entryClose, 100);
  assert.equal(e.expiry, '2026-11-13'); assert.equal(e.dte, 4);
  assert.equal(e.exitDate, '2026-11-13'); near(e.movePct, 2); near(e.totalPct, 3); near(e.dividendPct, 1);
  // Entry 1 day before (cum day 11-10, close 101): exit 102 -> +0.990%
  const [e1] = buyWriteEvents([{ exDate: '2026-11-11', amount: 1 }], bw, { entryDays: 1 });
  assert.equal(e1.entryDate, '2026-11-10'); near(e1.movePct, (102 / 101 - 1) * 100);
  // Expiry after the data ends: no outcome.
  const [late] = buyWriteEvents([{ exDate: '2026-11-16', amount: 1 }], bw);
  assert.equal(late.exitClose, null); assert.equal(late.movePct, null);

  const events = [{ exDate: 'a', movePct: 2, dividendPct: 1 }, { exDate: 'b', movePct: -3, dividendPct: 1 }, { exDate: 'c', movePct: 0.5, dividendPct: 1 }, { exDate: 'd', movePct: null }];
  const sim = simulateBuyWrite(events, { strikePct: 1, premiumPct: 0.8, dividendPct: 0.5, dte: 7 });
  assert.equal(sim.n, 3);
  assert.deepEqual(sim.rows.map((r) => +r.retPct.toFixed(6)), [2.3, -1.7, 1.8]); // min(move,1)+0.8+0.5
  near(sim.winPct, 200 / 3); near(sim.assignedPct, 100 / 3);
  near(sim.perYearPct, (sim.ret.avg * 365) / 7);
  const s = summarizeBuyWrite(events);
  assert.equal(s.n, 3); near(s.atOrAbovePct, 200 / 3); assert.equal(s.shortfall.max, 3);
});

test('buyWriteEvents fixedDte: hold a fixed number of calendar days (monthly expiry today)', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
  const bw = days.map((d, i) => ({ time: Date.parse(`${d}T14:30:00Z`) / 1000, open: 100 + i, close: 100 + i }));
  // ex Wed 11-11, entry Mon 11-09 (close 105); +6 days = Sun 11-15 -> exit at Fri 11-13 (close 109)
  const [e] = buyWriteEvents([{ exDate: '2026-11-11', amount: 1 }], bw, { fixedDte: 6 });
  assert.equal(e.expiry, '2026-11-15'); assert.equal(e.exitDate, '2026-11-13'); near(e.movePct, (109 / 105 - 1) * 100);
  // a fixed hold that ends before the ex-date gives no outcome
  const [short] = buyWriteEvents([{ exDate: '2026-11-11', amount: 1 }], bw, { fixedDte: 1 });
  assert.equal(short.expiry, null);
});

import { verdict } from '../lib/event-moves.js';

test('verdict: too little history, not promising, mixed, promising', () => {
  assert.equal(verdict([1, 2, 3]).level, 'na');
  assert.match(verdict([1, 2, 3]).reason, /3 past ex-dates, at least 8/);
  // average below zero
  assert.equal(verdict([1, -2, 1, -2, 1, -2, 1, -2]).level, 'poor');
  // average positive but fewer than half won
  assert.equal(verdict([5, -1, -1, -1, -1, 5, -1, -1]).level, 'poor');
  // 6 of 8 won (75%) but very noisy: t < 1.5 -> mixed, "could be luck"
  const noisy = verdict([3, 3, 3, 3, 3, 3, -8, -8]);
  assert.equal(noisy.level, 'mixed'); assert.match(noisy.reason, /could be luck/);
  // 5 of 8 won (62.5%) -> mixed, "under 65% won"
  const few = verdict([2, 2, 2, 2, 2, -0.5, -0.5, -0.5]);
  assert.equal(few.level, 'mixed'); assert.match(few.reason, /under 65% won/);
  // steady wins
  const good = verdict([1.2, 1.0, 1.5, 0.8, 1.1, -0.4, 1.3, 0.9, 1.0, -0.2], { basis: 'x' });
  assert.equal(good.level, 'good'); assert.equal(good.label, 'promising'); assert.equal(good.basis, 'x');
  assert.match(good.reason, /^8 of 10 won, average \+0\.82%, worst -0\.40%$/);
  assert.ok(good.t > 1.5);
});
