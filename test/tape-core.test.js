// AT-18: Laufband aus Standard oder gewählten Watchlists (inkl. W:HOLD) — public/js/tape-core.js, Prefs.
import './helpers/isolate-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapeItems, tapeCodes, tapeLabel, normalizeTapeLists, STANDARD_TAPE, TAPE_MAX } from '../public/js/tape-core.js';
import { normalizePrefs } from '../public/js/prefs-core.js';

const LISTS = { TICKER: ['SPX INDEX', 'DAX INDEX', 'GC1 COMDTY', 'EURUSD CURNCY', 'BTC CRYPTO'], MAIN: ['AAPL US EQUITY', 'SPX INDEX', 'NVDA US EQUITY'], EMPTY: [] };

test('Standard ist Voreinstellung und bleibt die bisherige Liste', () => {
  const t = tapeItems({});
  assert.equal(t.source, 'standard');
  assert.equal(t.fallback, null);
  assert.deepEqual(t.items.map(([n]) => n), STANDARD_TAPE.map(([n]) => n));
  assert.equal(tapeItems({ tapeSource: 'standard', tapeLists: ['MAIN'] }, LISTS).source, 'standard');
});

test('Watchlists: Vereinigung in Auswahl-Reihenfolge, ohne Doppel, inkl. W:HOLD', () => {
  const t = tapeItems({ tapeSource: 'watch', tapeLists: ['TICKER', 'MAIN', 'W:HOLD'] }, LISTS, ['NVDA US EQUITY', 'SAP GR EQUITY']);
  assert.equal(t.source, 'watch');
  assert.deepEqual(t.items.map(([n]) => n), ['SPX', 'DAX', 'GC1', 'EURUSD', 'BTC', 'AAPL', 'NVDA', 'SAP']);
  assert.deepEqual(t.items.slice(0, 5).map(([, s]) => s), ['^GSPC', '^GDAXI', 'GC=F', 'EURUSD=X', 'BTC-USD']);
  assert.equal(t.items.at(-1)[1], 'SAP.DE');
  // andere Reihenfolge der Auswahl → andere Reihenfolge im Band
  assert.deepEqual(tapeCodes(['MAIN', 'TICKER'], LISTS).slice(0, 4), ['AAPL US EQUITY', 'SPX INDEX', 'NVDA US EQUITY', 'DAX INDEX']);
});

test('leere Auswahl oder leere Listen → Standard mit Hinweis', () => {
  assert.equal(tapeItems({ tapeSource: 'watch', tapeLists: [] }, LISTS).fallback, 'none');
  const e = tapeItems({ tapeSource: 'watch', tapeLists: ['EMPTY', 'W:HOLD', 'GONE'] }, LISTS, []);
  assert.equal(e.source, 'standard');
  assert.equal(e.fallback, 'empty');
  assert.equal(e.items.length, STANDARD_TAPE.length);
});

test('Obergrenze und Kurznamen', () => {
  const many = { BIG: Array.from({ length: 100 }, (_, i) => `T${i} US EQUITY`) };
  const t = tapeItems({ tapeSource: 'watch', tapeLists: ['BIG'] }, many);
  assert.equal(t.items.length, TAPE_MAX);
  assert.equal(t.capped, true);
  assert.equal(tapeLabel('AAPL US EQUITY'), 'AAPL');
  assert.equal(tapeLabel(''), '');
});

test('Prefs: tapeSource/tapeLists gesäubert, alte Prefs ohne Felder = Standard', () => {
  const old = normalizePrefs({ theme: 'amber', name: 'Tho', tape: 'scroll' });
  assert.equal(old.tapeSource, 'standard');
  assert.deepEqual(old.tapeLists, []);
  const p = normalizePrefs({ tapeSource: 'watch', tapeLists: ['main', 'MAIN', 'w:hold', 'bad name!', 7, ''] });
  assert.equal(p.tapeSource, 'watch');
  assert.deepEqual(p.tapeLists, ['MAIN', 'W:HOLD', '7']);
  assert.equal(normalizePrefs({ tapeSource: 'x' }).tapeSource, 'standard');
  assert.deepEqual(normalizeTapeLists('MAIN'), []);
});
