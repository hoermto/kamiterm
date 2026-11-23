// AT-22: Sprung aus ALERTS in die passende App (Zuordnung aus Typ/Titel/Text, auch für ältere Einträge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertTarget } from '../public/js/fn/alerts.js';
import { hlArg } from '../public/js/highlight.js';
import { parse } from '../public/js/commands.js';

test('alertTarget: RSL → RSL26 <Universum> HL=<Ticker>', () => {
  const sell = alertTarget({ kind: 'rslSell', title: 'RSL: Verkaufssignal MRNA', text: 'MRNA (SPX): SL >20% · Basis Freitagsschluss 20.11.2026' });
  assert.deepEqual(sell, { cmd: 'RSL26 SPX HL=MRNA', label: 'RSL26 SPX (MRNA)' });
  const buy = alertTarget({ kind: 'rslBuy', title: 'RSL: neuer Kauf-Kandidat SAP.DE', text: 'SAP.DE (DAX, Rang 3) ist neu im Kauf-Fenster' });
  assert.equal(buy.cmd, 'RSL26 DAX HL=SAP.DE');
  assert.equal(alertTarget({ kind: 'rslSell', title: 'RSL: Verkaufssignal X', text: '?', ref: { universe: 'NDX', symbol: 'AAPL' } }).cmd, 'RSL26 NDX HL=AAPL');
  assert.equal(alertTarget({ kind: 'rslSell', title: 'RSL: Verkaufssignal VEEV', text: 'kaputt' }).cmd, 'RSL26 HL=VEEV');
});

test('alertTarget: GSW → GSW HL=<Symbol>, gebuchter Swap → GSW', () => {
  assert.equal(alertTarget({ kind: 'gsw', title: 'GSW: Swap fällig → Silber', text: 'EWG2 (Gold): Swap fällig · Stand 20.11.2026' }).cmd, 'GSW HL=EWG2');
  assert.equal(alertTarget({ kind: 'gsw', title: 'GSW: aufgeschobener Swap entfallen', text: '8PSG.DE (Gold): Swap war …' }).cmd, 'GSW HL=8PSG.DE');
  assert.equal(alertTarget({ kind: 'gsw', title: 'GSW: Swap gebucht Gold → Silber', text: '20.11.2026: 10 EWG2 → 50 VZLE' }).cmd, 'GSW');
});

test('alertTarget: Kursalarm → <Symbol> GP, ohne Symbol ALRT; Befehle sind gültig', () => {
  const p = alertTarget({ kind: 'price', title: 'Kursalarm BINANCE:BTCUSDT', text: 'Alert: …' });
  assert.deepEqual(p, { cmd: 'BINANCE:BTCUSDT GP', label: 'BINANCE:BTCUSDT GP (Kurschart)' });
  assert.equal(alertTarget({ kind: 'price', symbol: 'AAPL' }).cmd, 'AAPL GP');
  assert.equal(alertTarget({ kind: 'price', title: 'Kursalarm' }).cmd, 'ALRT');
  assert.equal(alertTarget({ kind: 'unbekannt' }), null);
  for (const c of ['RSL26 SPX HL=MRNA', 'GSW HL=EWG2', 'BINANCE:BTCUSDT GP', 'ALRT']) assert.ok(parse(c)?.fn, c);
  assert.equal(parse('BINANCE:BTCUSDT GP').fn, 'GP');
  assert.equal(hlArg(['SPX', 'HL=mrna']), 'MRNA');
  assert.equal(hlArg(['SPX']), null);
});
