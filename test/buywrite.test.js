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
  near(r.strikePct, (102.5 / 100.4 - 1) * 100); near(r.premiumPct, (0.45 / 100.4) * 100); near(r.dividendPct, (0.51 / 100.4) * 100);
  assert.equal(r.early.risk, false); assert.equal(r.reason, null);
  // entry date already passed -> today
  assert.equal(buyWriteQuote(weeklyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-23' }).entryDate, '2026-11-23');
  assert.match(buyWriteQuote(monthlyChain, { exDate: '2026-11-24', dividend: 0.5, today: '2026-11-14' }).reason, /No expiry 2-10/);
  assert.match(buyWriteQuote(weeklyChain, { exDate: '2026-11-10', dividend: 0.5, today: '2026-11-14' }).reason, /not ahead/);
});
