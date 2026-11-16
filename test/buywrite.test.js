import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasWeeklies, entryDateFor, targetExpiry, firstCallAbove, earlyAssignment, buyWriteQuote } from '../lib/buywrite.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const q = (bid, ask, extra = {}) => ({ bid, ask, last: null, delta: 0.4, iv: 0.2, oi: 500, volume: 10, ...extra });
const rows = [
  { strike: 95, call: q(5.2, 5.4), put: null },
  { strike: 100, call: q(1.1, 1.2), put: null },
  { strike: 102.5, call: q(0.45, 0.5), put: null },
  { strike: 105, call: q(0.1, 0.15), put: null },
];
// Weeklies: Fridays 11-20, 11-27, 12-04, 12-18 (monthly), plus 2027-01-15.
const weeklyChain = { price: 100.4, expiries: ['2026-11-20', '2026-11-27', '2026-12-04', '2026-12-18', '2027-01-15'].map((date) => ({ date, root: 'KO', rows })) };
const monthlyChain = { price: 100.4, expiries: ['2026-11-20', '2026-12-18', '2027-01-15'].map((date) => ({ date, root: 'XY', rows })) };

test('hasWeeklies: three or more expiries within 35 days', () => {
  assert.equal(hasWeeklies(weeklyChain.expiries, '2026-11-14'), true);
  assert.equal(hasWeeklies(monthlyChain.expiries, '2026-11-14'), false);
  assert.equal(hasWeeklies([], '2026-11-14'), false);
});

test('entryDateFor skips weekends', () => {
  assert.equal(entryDateFor('2026-11-24', 2), '2026-11-20'); // Tue -> Fri before (Mon 23 is 1)
  assert.equal(entryDateFor('2026-11-23', 1), '2026-11-20'); // Mon -> Fri
  assert.equal(entryDateFor('2026-11-26', 1), '2026-11-25');
});

test('targetExpiry and firstCallAbove', () => {
  // ex-date Tue 11-24, entry Fri 11-20: 11-20 is before the ex-date; 11-27 is 7 days -> fits.
  assert.equal(targetExpiry(weeklyChain.expiries, '2026-11-24', '2026-11-20').date, '2026-11-27');
  // Monthlies only: the next after the ex-date is 12-18, 28 days -> none.
  assert.equal(targetExpiry(monthlyChain.expiries, '2026-11-24', '2026-11-20'), null);
  const c = firstCallAbove(rows, 100.4);
  assert.equal(c.strike, 102.5); near(c.mid, 0.475); near(c.spreadPct, (0.05 / 0.475) * 100);
  assert.equal(firstCallAbove(rows, 200), null);
});

test('earlyAssignment: in the money with time value below the dividend', () => {
  assert.deepEqual(earlyAssignment({ price: 101, strike: 100, bid: 1.2, dividend: 0.5 }).risk, true); // extrinsic 0.2
  assert.equal(earlyAssignment({ price: 101, strike: 100, bid: 1.8, dividend: 0.5 }).risk, false);
  assert.equal(earlyAssignment({ price: 99, strike: 100, bid: 0.1, dividend: 0.5 }).risk, false, 'out of the money');
});

test('buyWriteQuote: weekly, expiry, strike, premium, dividend in % of the price', () => {
  const r = buyWriteQuote(weeklyChain, { exDate: '2026-11-24', dividend: 0.51, today: '2026-11-14' });
  assert.equal(r.weekly, true); assert.equal(r.entryDate, '2026-11-20'); assert.equal(r.expiry, '2026-11-27'); assert.equal(r.dte, 7);
  assert.equal(r.call.strike, 102.5);
  near(r.strikePct, (102.5 / 100.4 - 1) * 100); near(r.dividendPct, (0.51 / 100.4) * 100);
  // Entry in 6 days: premium estimated for 7 days left instead of today's 13 -> below today's bid.
  assert.equal(r.premiumEstimated, true); assert.equal(r.dteNow, 13);
  assert.ok(r.premium > 0 && r.premium < 0.45, `estimated ${r.premium}`);
  assert.equal(r.early.risk, false); assert.equal(r.reason, null);
  // Entering today (the entry day itself): today's bid.
  const now = buyWriteQuote(weeklyChain, { exDate: '2026-11-24', dividend: 0.51, today: '2026-11-20' });
  assert.equal(now.premiumEstimated, false); near(now.premiumPct, (0.45 / 100.4) * 100);
  // entry date already passed -> the next trading day (Sat 11-21 -> Mon 11-23)
  assert.equal(buyWriteQuote(weeklyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-21' }).entryDate, '2026-11-23');
  // Today is the ex-date itself: too late.
  assert.match(buyWriteQuote(weeklyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-24' }).reason, /not ahead/);
  assert.match(buyWriteQuote(monthlyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-14' }).reason, /No expiry 2-10/);
  assert.match(buyWriteQuote(weeklyChain, { exDate: '2026-11-10', dividend: 0.5, today: '2026-11-14' }).reason, /not ahead/);
  // Saturday before a Monday ex-date: the next trading day is the ex-date itself.
  assert.equal(buyWriteQuote(weeklyChain, { exDate: '2026-11-23', dividend: 0.5, today: '2026-11-21' }).tooLate, true);
});

import { bsCall, premiumAtEntry, tradingDayOnOrAfter } from '../lib/buywrite.js';

test('bsCall: known values; premiumAtEntry shrinks with fewer days and keeps the bid haircut', () => {
  // S=100, K=100, T=1, sigma=0.2, r=0: 7.9656
  near(bsCall(100, 100, 1, 0.2), 7.965567, 1e-4);
  assert.equal(bsCall(110, 100, 0, 0.2), 10);
  const later = premiumAtEntry({ price: 99.37, strike: 100, iv: 0.1931, bid: 1.85, dividend: 0.53, dteNow: 34, dteEntry: 2 });
  assert.ok(later > 0 && later < 0.5, `${later}`);
  const same = premiumAtEntry({ price: 99.37, strike: 100, iv: 0.1931, bid: 1.85, dividend: 0.53, dteNow: 34, dteEntry: 34 });
  assert.ok(same <= 1.85 + 1e-9 && same > 1.5, `${same}`);
  assert.equal(premiumAtEntry({ price: 100, strike: 100, iv: null, bid: 1, dteNow: 5, dteEntry: 2 }), null);
  assert.equal(tradingDayOnOrAfter('2026-11-21'), '2026-11-23');
  assert.equal(tradingDayOnOrAfter('2026-11-20'), '2026-11-20');
});

test('buyWriteQuote: monthly fallback when no expiry lies in the DTE range', () => {
  const none = buyWriteQuote(monthlyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-14' });
  assert.equal(none.expiry, null); assert.equal(none.fallback, false);
  const m = buyWriteQuote(monthlyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-14', fallbackMaxDte: 45 });
  assert.equal(m.expiry, '2026-12-18'); assert.equal(m.dte, 28); assert.equal(m.fallback, true);
  // a weekly in range is preferred, no fallback
  assert.equal(buyWriteQuote(weeklyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-14', fallbackMaxDte: 45 }).fallback, false);
  // nothing within the fallback either
  assert.match(buyWriteQuote(monthlyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-14', fallbackMaxDte: 20 }).reason, /No expiry 2-20/);
});
