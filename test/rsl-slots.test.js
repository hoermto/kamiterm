import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buySlotCandidates, topXVal } from '../public/js/fn/rsl-slots.js';

const rows = ['AAA','BBB','CCC','DDD','EEE','FFF','GGG'].map((t, i) => ({ ticker: t, rank: i + 1 }));

test('topXVal: default 25, clamps, backward compatible', () => {
  assert.equal(topXVal(undefined), 25);
  assert.equal(topXVal(null), 25);
  assert.equal(topXVal(''), 25);
  assert.equal(topXVal('abc'), 25);
  assert.equal(topXVal(0), 25);
  assert.equal(topXVal('40'), 40);
  assert.equal(topXVal(12.7), 12);
  assert.equal(topXVal(9999), 500);
});

test('no holdings: candidates = rank 1..N', () => {
  const r = buySlotCandidates(rows, [], { n: 5, universe: 'SPX' });
  assert.equal(r.held, 0); assert.equal(r.free, 5);
  assert.deepEqual(r.candidates.map((c) => c.ticker), ['AAA','BBB','CCC','DDD','EEE']);
  assert.deepEqual(r.candidates.map((c) => c.slot), [1,2,3,4,5]);
  assert.equal(r.shortfall, 0);
});

test('skips held names, fills in rank order, only from rank 1..N', () => {
  const pos = [{ symbol: 'BBB', universe: 'SPX' }, { symbol: 'zzz', universe: 'SPX' }];
  const r = buySlotCandidates(rows, pos, { n: 5, universe: 'SPX' });
  assert.equal(r.held, 2); assert.equal(r.free, 3);
  assert.deepEqual(r.candidates.map((c) => [c.ticker, c.rank, c.slot]), [['AAA',1,3],['CCC',3,4],['DDD',4,5]]);
  assert.ok(r.heldSymbols.has('BBB') && r.heldSymbols.has('ZZZ'));
});

test('holdings in another universe do not count, but are reported', () => {
  const pos = [{ symbol: 'AAA', universe: 'NDX' }, { symbol: 'CCC' }]; // missing universe → SPX
  const r = buySlotCandidates(rows, pos, { n: 3, universe: 'SPX' });
  assert.equal(r.held, 1);
  assert.deepEqual(r.heldElsewhere.get('AAA'), ['NDX']);
  assert.deepEqual(r.candidates.map((c) => c.ticker), ['AAA','BBB']);
});

test('full or over-full book: no candidates', () => {
  const pos = ['AAA','BBB','CCC'].map((s) => ({ symbol: s, universe: 'DAX' }));
  assert.equal(buySlotCandidates(rows, pos, { n: 3, universe: 'DAX' }).candidates.length, 0);
  const over = buySlotCandidates(rows, pos, { n: 2, universe: 'DAX' });
  assert.equal(over.free, 0); assert.equal(over.candidates.length, 0);
});

test('locked names are skipped; gaps in rank 1..N leave a shortfall (no fill beyond N)', () => {
  const r = buySlotCandidates(rows, [], { n: 3, universe: 'SPX', lockedSymbols: ['BBB'] });
  assert.deepEqual(r.candidates.map((c) => c.ticker), ['AAA','CCC']);
  assert.deepEqual(r.skippedLocked, ['BBB']);
  assert.equal(r.shortfall, 1);
  // M&A hidden row (rank 2 missing from list) → still only ranks ≤ N
  const gap = rows.filter((x) => x.rank !== 2);
  const g = buySlotCandidates(gap, [], { n: 3, universe: 'SPX' });
  assert.deepEqual(g.candidates.map((c) => c.ticker), ['AAA','CCC']);
  assert.equal(g.shortfall, 1);
});

test('unsorted input and bad rows are handled; nothing is mutated', () => {
  const messy = [{ ticker: 'EEE', rank: 5 }, { ticker: 'AAA', rank: 1 }, { ticker: 'X' }, null, { ticker: 'BBB', rank: 2 }];
  const copy = JSON.stringify(messy);
  const r = buySlotCandidates(messy, [], { n: 2, universe: 'SPX' });
  assert.deepEqual(r.candidates.map((c) => c.ticker), ['AAA','BBB']);
  assert.equal(JSON.stringify(messy), copy);
});

test('topX is a profile field and a RSL26 tool default (25)', async () => {
  const { RSL_PROFILE_FIELDS, TOOL_DEFAULTS, DEFAULT_RSL_PROFILE } = await import('../lib/tool-settings.js');
  assert.ok(RSL_PROFILE_FIELDS.includes('topX'));
  assert.equal(TOOL_DEFAULTS.RSL26.topX, 25);
  assert.equal(DEFAULT_RSL_PROFILE.topX, undefined); // Standardprofil setzt Rangzeilen nicht zurück (seit 11.11.2026)
  assert.equal(DEFAULT_RSL_PROFILE.n, 5);
});

// --- M&A ignorieren (skipMa) ---
const maRows = rows.map((r) => ({ ...r, maFlag: r.ticker === 'CCC' }));

test('skipMa: M&A-Titel zählt nicht zum Fenster, Fenster rückt vor (N=5, Rang 3 M&A → 1,2,4,5,6)', () => {
  const s = buySlotCandidates(maRows, [], { n: 5, universe: 'SPX', skipMa: true });
  assert.deepEqual(s.candidates.map((c) => c.rank), [1, 2, 4, 5, 6]);
  assert.deepEqual(s.candidates.map((c) => c.slot), [1, 2, 3, 4, 5]);
  assert.deepEqual([...s.skippedMa], ['CCC']);
  assert.equal(s.windowEnd, 6);
  assert.equal(s.shortfall, 0);
});

test('skipMa aus: altes Verhalten (Rang 1…N inkl. M&A, nur Warnung)', () => {
  const s = buySlotCandidates(maRows, [], { n: 5, universe: 'SPX', skipMa: false });
  assert.deepEqual(s.candidates.map((c) => c.ticker), ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
  assert.equal(s.skippedMa.size, 0);
  // Default (Option nicht übergeben) = aus im Helper; das UI übergibt maSkip (Standard an)
  assert.deepEqual(buySlotCandidates(maRows, [], { n: 5, universe: 'SPX' }).candidates.map((c) => c.rank), [1, 2, 3, 4, 5]);
});

test('skipMa: gehaltene Titel im Fenster + gehaltener M&A-Titel bleibt gehalten', () => {
  const pos = [{ symbol: 'AAA', universe: 'SPX' }, { symbol: 'CCC', universe: 'SPX' }];
  const s = buySlotCandidates(maRows, pos, { n: 5, universe: 'SPX', skipMa: true });
  assert.equal(s.held, 2);
  assert.ok(s.heldSymbols.has('CCC'));
  assert.equal(s.free, 3);
  // Fenster = 1,2,4,5,6 (CCC zählt nicht); AAA gehalten → BBB, DDD, EEE
  assert.deepEqual(s.candidates.map((c) => c.ticker), ['BBB', 'DDD', 'EEE']);
  assert.deepEqual(s.candidates.map((c) => c.slot), [3, 4, 5]);
});

test('skipMa: mehrere M&A und Liste zu kurz → Shortfall', () => {
  const r2 = rows.map((r) => ({ ...r, maFlag: ['AAA', 'DDD', 'GGG'].includes(r.ticker) }));
  const s = buySlotCandidates(r2, [], { n: 5, universe: 'SPX', skipMa: true });
  assert.deepEqual(s.candidates.map((c) => c.ticker), ['BBB', 'CCC', 'EEE', 'FFF']);
  assert.equal(s.shortfall, 1);
  assert.deepEqual([...s.skippedMa], ['AAA', 'DDD', 'GGG']);
});

test('skipMa: M&A unterhalb des Fensters wird nicht als übersprungen markiert', () => {
  const r3 = rows.map((r) => ({ ...r, maFlag: r.ticker === 'GGG' }));
  const s = buySlotCandidates(r3, [], { n: 3, universe: 'SPX', skipMa: true });
  assert.deepEqual(s.candidates.map((c) => c.rank), [1, 2, 3]);
  assert.equal(s.skippedMa.size, 0);
  assert.equal(s.windowEnd, 3);
});
