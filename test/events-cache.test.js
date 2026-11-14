import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  readDividends, replaceDividends, readEarnings, replaceEarnings, upsertUpcoming, readUpcoming,
  logFetch, lastFetch, refresh, cacheStats, clearCache, resetEventsCache, eventsDbPath,
} from '../lib/events-cache.js';

const divs = [
  { exDate: '2026-02-10', amount: 0.5, currency: 'USD', type: 'Cash' },
  { exDate: '2026-05-10', amount: 0.52, currency: 'USD', type: 'Cash' },
  { exDate: 'bad', amount: 1 },
  { exDate: '2026-08-10', amount: NaN },
];

test('dividends: stored per symbol and source, newest first; bad rows skipped; replace swaps the set', () => {
  replaceDividends('KO', 'yahoo', divs);
  replaceDividends('KO', 'nasdaq', [{ exDate: '2026-11-28', amount: 0.53 }]);
  assert.deepEqual(readDividends('KO', 'yahoo').map((d) => d.exDate), ['2026-05-10', '2026-02-10']);
  assert.equal(readDividends('KO', 'nasdaq').length, 1);
  replaceDividends('KO', 'yahoo', [{ exDate: '2026-05-10', amount: 0.6 }]);
  assert.deepEqual(readDividends('KO', 'yahoo').map((d) => [d.exDate, d.amount]), [['2026-05-10', 0.6]]);
  assert.equal(readDividends('PEP', 'yahoo').length, 0);
});

test('earnings and upcoming dates round-trip', () => {
  replaceEarnings('AAPL', 'sec-8k', [{ date: '2026-10-30', timing: 'AMC', period: '2026Q4' }, { date: '2026-07-31', timing: 'AMC' }]);
  assert.deepEqual(readEarnings('AAPL', 'sec-8k').map((e) => e.date), ['2026-10-30', '2026-07-31']);
  upsertUpcoming('exdiv', 'nasdaq', [{ symbol: 'KO', date: '2026-11-28', amount: 0.53 }, { symbol: 'PEP', date: '2026-12-05' }]);
  assert.deepEqual(readUpcoming('exdiv', '2026-11-01', '2026-11-30').map((u) => u.symbol), ['KO']);
  assert.equal(readUpcoming('earnings', '2026-01-01', '2026-12-31').length, 0);
});

test('refresh: fetches once, then serves the cache until it is older than maxAge', async () => {
  let calls = 0;
  const opts = (now) => ({
    source: 'yahoo', symbol: 'T1', maxAgeMs: 1000, now,
    read: () => readDividends('T1', 'yahoo'),
    write: (rows) => replaceDividends('T1', 'yahoo', rows),
    fetch: async () => { calls++; return [{ exDate: '2026-01-02', amount: 1 }]; },
  });
  const a = await refresh(opts(10_000));
  assert.equal(a.fromCache, false); assert.equal(a.rows.length, 1); assert.equal(calls, 1);
  const b = await refresh(opts(10_500));
  assert.equal(b.fromCache, true); assert.equal(calls, 1);
  const c = await refresh(opts(11_500));
  assert.equal(c.fromCache, false); assert.equal(calls, 2);
  assert.equal(lastFetch('yahoo', 'T1').at, 11_500);
});

test('refresh: a failed fetch serves the old rows as stale, and waits retryMs before asking again', async () => {
  replaceDividends('T2', 'yahoo', [{ exDate: '2025-01-02', amount: 1 }]);
  logFetch('yahoo', 'T2', { at: 0 });
  let calls = 0;
  const failing = (now) => ({
    source: 'yahoo', symbol: 'T2', maxAgeMs: 1000, retryMs: 5000, now,
    read: () => readDividends('T2', 'yahoo'),
    write: (rows) => replaceDividends('T2', 'yahoo', rows),
    fetch: async () => { calls++; throw new Error('HTTP 429'); },
  });
  const a = await refresh(failing(100_000));
  assert.equal(a.stale, true); assert.equal(a.rows.length, 1); assert.match(a.error, /429/); assert.equal(calls, 1);
  const b = await refresh(failing(101_000));
  assert.equal(b.stale, true); assert.equal(calls, 1, 'no new request within retryMs');
  await refresh(failing(106_000));
  assert.equal(calls, 2);
  await assert.rejects(refresh({ ...failing(1), symbol: 'NONE', read: () => [] }), /429/);
});

test('stats and clear', () => {
  const s = cacheStats();
  assert.ok(s.dividends >= 1 && s.symbols >= 1 && s.bytes > 0);
  assert.equal(s.path, eventsDbPath());
  const c = clearCache();
  assert.deepEqual([c.dividends, c.earnings, c.upcoming, c.symbols], [0, 0, 0, 0]);
  resetEventsCache({ wipe: true });
  assert.equal(fs.existsSync(eventsDbPath()), false);
});
