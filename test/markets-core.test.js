import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionState, sessionTitle, normalizeClocks, localTime, EXCHANGES, DEFAULT_CLOCKS, CLOCKS_MAX } from '../public/js/markets-core.js';

// Wednesday 2026-11-11; New York is UTC-5 (EST), Berlin UTC+1 (CET), Tokyo UTC+9.
const at = (iso) => new Date(iso);

test('New York: pre-market, regular, after hours, closed', () => {
  assert.equal(sessionState('NY', at('2026-11-11T10:00:00Z')).state, 'ext'); // 05:00 ET
  assert.equal(sessionState('NY', at('2026-11-11T14:30:00Z')).state, 'open'); // 09:30 ET
  assert.equal(sessionState('NY', at('2026-11-11T20:59:00Z')).state, 'open'); // 15:59 ET
  assert.equal(sessionState('NY', at('2026-11-11T21:00:00Z')).state, 'ext'); // 16:00 ET
  assert.equal(sessionState('NY', at('2026-11-12T01:00:00Z')).state, 'closed'); // 20:00 ET
  assert.equal(sessionState('NY', at('2026-11-11T14:30:00Z')).local, '09:30');
});

test('Xetra: Tradegate hours count as extended', () => {
  assert.equal(sessionState('FRA', at('2026-11-11T07:30:00Z')).state, 'ext'); // 08:30 CET
  assert.equal(sessionState('FRA', at('2026-11-11T12:00:00Z')).state, 'open');
  assert.equal(sessionState('FRA', at('2026-11-11T20:00:00Z')).state, 'ext'); // 21:00 CET
  assert.equal(sessionState('FRA', at('2026-11-11T21:30:00Z')).state, 'closed'); // 22:30 CET
});

test('Tokyo lunch break is closed; weekends are closed', () => {
  assert.equal(sessionState('TKY', at('2026-11-11T01:00:00Z')).state, 'open'); // 10:00 JST
  assert.equal(sessionState('TKY', at('2026-11-11T02:45:00Z')).state, 'closed'); // 11:45 JST lunch
  assert.equal(sessionState('TKY', at('2026-11-11T04:00:00Z')).state, 'open'); // 13:00 JST
  const sat = sessionState('NY', at('2026-11-14T15:00:00Z'));
  assert.equal(sat.state, 'closed');
  assert.equal(sat.weekend, true);
});

test('local weekday follows the exchange, not the viewer', () => {
  // Friday 23:30 UTC is already Saturday in Tokyo.
  assert.equal(localTime('Asia/Tokyo', at('2026-11-13T23:30:00Z')).weekday, 6);
  assert.match(sessionTitle('TKY', at('2026-11-13T23:30:00Z')), /weekend/);
});

test('normalizeClocks: known codes only, unique, max count, default when missing', () => {
  assert.deepEqual(normalizeClocks(undefined), [...DEFAULT_CLOCKS]);
  assert.deepEqual(normalizeClocks(['fra', 'NY', 'XXX', 'NY']), ['FRA', 'NY']);
  assert.deepEqual(normalizeClocks([]), []);
  assert.equal(normalizeClocks(Object.keys(EXCHANGES)).length, CLOCKS_MAX);
});
