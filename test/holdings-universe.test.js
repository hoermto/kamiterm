import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR (never the real data/rsl-watchlist.json)
// Holdings universe tags (SPX / NDX / DAX) and per-universe benchmark for live exit signals. Pure functions only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {universeInfo, universeCounts, HOLDING_UNIVERSES} from '../lib/rsl-watchlist.js';
import {evaluatePositionBook} from '../lib/fn/grokki-math.js';

test('universe: stored buy universe wins, other index memberships as extra tags', () => {
  assert.deepEqual(HOLDING_UNIVERSES, ['SPX', 'NDX', 'HDAX', 'SXXP']);
  const a = universeInfo({symbol: 'AAPL', universe: 'NDX'});
  assert.equal(a.universe, 'NDX');
  assert.equal(a.universeSource, 'gespeichert');
  assert.deepEqual(a.memberOf, ['NDX', 'SPX'], 'buy universe first, then other rosters');
  assert.deepEqual(universeInfo({symbol: 'AAPL', universe: 'spx'}).memberOf, ['SPX', 'NDX']);
});

test('universe: derived when missing — .DE suffix → HDAX, roster lookup, else SPX', () => {
  assert.equal(universeInfo({symbol: 'SAP.DE'}).universe, 'HDAX');
  assert.match(universeInfo({symbol: 'SAP.DE'}).universeSource, /\.DE/);
  assert.equal(universeInfo({symbol: 'ASML'}).universe, 'NDX', 'only on the NDX roster');
  assert.equal(universeInfo({symbol: 'MRNA', universe: 'FOO'}).universe, 'SPX', 'unknown stored universe → derived');
  const legacy = universeInfo({symbol: 'SAP.DE', universe: 'DAX'});
  assert.equal(legacy.universe, 'HDAX', 'stored DAX (alt) → HDAX at read time');
  assert.match(legacy.universeSource, /DAX → HDAX/);
  assert.equal(universeInfo({symbol: 'ASML.AS'}).universe, 'SXXP', 'STOXX-600 roster');
  const z = universeInfo({symbol: 'ZZZZ'});
  assert.equal(z.universe, 'SPX');
  assert.equal(z.universeSource, 'Standard (SPX)');
  assert.deepEqual(universeCounts([{symbol: 'SAP.DE'}, {symbol: 'X', universe: 'NDX'}, {symbol: 'Y', universe: 'NDX'}]), {SPX: 0, NDX: 2, HDAX: 1, SXXP: 0});
});

test('live exits use each position\'s own benchmark; RSEXIT=0 is respected', () => {
  const T = Date.UTC(2025, 0, 6) / 1000, W = 7 * 86400;
  const mk = (fn) => Array.from({length: 60}, (_, i) => { const c = fn(i); return {time: T + i * W, open: c, high: c, low: c, close: c, volume: 1e6}; });
  const stock = mk((i) => 100 + i * 0.2);           // gentle rise
  const spx = mk((i) => 100 * Math.pow(1.03, i));   // strong rise → stock RSL < SPX RSL
  const dax = mk((i) => 200 - i);                    // falling → stock RSL > DAX RSL
  const bars = new Map([['AAA', stock], ['BBB.DE', stock]]);
  const bench = new Map([['SPX', spx], ['DAX', dax]]);
  const rows = evaluatePositionBook([
    {symbol: 'AAA', universe: 'SPX', buyDate: '2025-01-06', buyPrice: 100},
    {symbol: 'BBB.DE', universe: 'DAX', buyDate: '2025-01-06', buyPrice: 100},
  ], bars, bench, null, {mode: 'OFF'});
  const [spxRow, daxRow] = rows;
  assert.ok(spxRow.benchRsl > spxRow.rsl, 'SPX position measured against ^GSPC-like bench');
  assert.equal(spxRow.rsBelowBench, true);
  assert.equal(spxRow.exitSignal, true);
  assert.ok(daxRow.benchRsl < daxRow.rsl, 'DAX position measured against its own (DAX) bench');
  assert.equal(daxRow.rsBelowBench, false);
  assert.equal(daxRow.exitSignal, false);
  const off = evaluatePositionBook([{symbol: 'AAA', universe: 'SPX'}], bars, bench, null, {mode: 'OFF', rsExit: false});
  assert.equal(off[0].exitSignal, false, 'RSEXIT=0 → no RS exit');
});
