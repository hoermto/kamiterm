import { TEST_DATA_DIR, REAL_DATA_DIR } from './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
// GSW Gold/Silber-Swap: Signal, Zustandsautomat, Regression gegen die Spezifikation (v3), Grid/Robustheit/WF,
// Handelspaar-Kalender, Buch inkl. Swap, Einstellungen, Futures-Datierung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollingMedian, signalSeries, runCore, gridCells, neighbourMean, pickRobust, ranks, SPEC_GRID, DEFAULT_PARAMS, holdUnlockDate, taxFreeFrom, inHoldPeriod, restHoldDays, addCalendarYears, isLeapYear, normTax, KEST_RATE } from '../lib/gsw/math.js';
import { backtest, runGrid, gridRows, walkForward, lastDaySignal, normParams } from '../lib/gsw/engine.js';
import { buildDataset, resolvePair, guessCurrency, PAIRS, defaultHoldOn, kindInfo } from '../lib/gsw/data.js';
import * as book from '../lib/gsw/book.js';
import { loadSettings, saveSettings, holdMinDays, holdMinEnabled, defaults as gswDefaults } from '../lib/gsw/settings.js';
import { gridFromInput, taxFromInput } from '../lib/gsw/service.js';
import { SHORTCUTS } from '../public/js/shortcuts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'gsw', 'prices_and_ratio_2016-2026.csv');
function specDs() {
  const L = fs.readFileSync(FIX, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const F = (k) => Float64Array.from(L.map((r) => +r[k]));
  const ds = { dates: L.map((r) => r[0]), gold: F(1), silver: F(2), GLD: F(3), SLV: F(4), tradable: null, tradeFrom: 0, pair: { gold: 'GLD', silver: 'SLV', currency: 'USD', label: 'GLD / SLV' } };
  ds.pg = ds.GLD; ds.ps = ds.SLV; ds.ozf = Float64Array.from(ds.gold, (g) => 1 / g);
  return ds;
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('isolated data dir (never the real data folder)', () => {
  assert.notEqual(path.resolve(TEST_DATA_DIR), path.resolve(REAL_DATA_DIR));
});

test('rollingMedian = naive pandas rolling(w, min_periods=1).median()', () => {
  const x = Float64Array.from({ length: 200 }, (_, i) => Math.sin(i * 1.7) * 10 + (i % 7) + (i % 13 === 0 ? 5 : 0));
  for (const w of [1, 2, 5, 60]) {
    const m = rollingMedian(x, w);
    for (let i = 0; i < x.length; i++) {
      const win = Array.from(x.slice(Math.max(0, i - w + 1), i + 1)).sort((a, b) => a - b), L = win.length;
      const exp = L % 2 ? win[(L - 1) / 2] : (win[L / 2 - 1] + win[L / 2]) / 2;
      near(m[i], exp, 1e-12, `w=${w} i=${i}`);
    }
  }
});

test('Zustandsautomat: nächster Schluss, Spike hält Silber bis < L2, Reset bei Gold, Erstkauf kostet', () => {
  //            0   1   2   3    4    5   6   7   8   9  10  11  12
  const sig = [80, 91, 85, 101, 85, 70, 65, 64, 88, 91, 85, 81, 80];
  const n = sig.length, one = new Float64Array(n).fill(10);
  const r = runCore({ sig: Float64Array.from(sig), pg: one, ps: one, U1: 90, L1: 82, S: 100, L2: 66, cost: 0.001, cap: 10000 });
  assert.equal(r.eq[0], 9990); // 0,1 % Erstkauf
  const t = r.trades.map((x) => [x.sigI, x.i, x.dir, x.spike]);
  // Signal Tag 1 (>90) → Ausführung Tag 2; Spike ab Tag 3; 85/70 halten (nicht < 82 gilt nicht); 65 < 66 an Tag 6 → Tag 7 Gold;
  // Tag 9 > 90 → Tag 10 Silber, Spike zurückgesetzt → normal < 82 an Tag 11 → Tag 12 Gold.
  assert.deepEqual(t, [[1, 2, 1, 0], [6, 7, -1, 1], [9, 10, 1, 0], [11, 12, -1, 0]]);
  assert.equal(r.final.pos, 0);
  assert.equal(r.final.spike, 0);
  // Am letzten Tag wird nichts mehr vorgemerkt
  const r2 = runCore({ sig: Float64Array.from([80, 80, 95]), pg: one, ps: one, U1: 90, L1: 82, S: 100, L2: 66 });
  assert.equal(r2.trades.length, 0);
});

test('Signal: sig = GLD/SLV × Median(k), k = (GC/SI)/(GLD/SLV)', () => {
  const s = signalSeries({ gold: Float64Array.from([1000, 1100]), silver: Float64Array.from([10, 10]), GLD: Float64Array.from([100, 100]), SLV: Float64Array.from([10, 11]) }, 60);
  near(s.k[0], 10, 1e-12, 'k0'); near(s.k[1], 110 / (100 / 11), 1e-12, 'k1');
  near(s.kMed[1], (s.k[0] + s.k[1]) / 2, 1e-12, 'median of 2');
  near(s.sig[1], (100 / 11) * s.kMed[1], 1e-12, 'sig');
});

test('Regression gegen Spec v3 (GLD/SLV, 90/82/100/66, 21.10.2016–21.10.2026)', () => {
  const ds = specDs();
  const r = backtest(ds, DEFAULT_PARAMS);
  const m = r.metrics;
  assert.equal(m.days, 2511);
  near(m.endValue, 102111.00, 0.01, 'Endwert USD');
  near(m.goldOz, 24.60506, 1e-5, 'Gold-oz');
  near(m.cagr * 100, 26.1598, 1e-4, 'CAGR %');
  near(m.maxdd * 100, -33.8391, 1e-4, 'MaxDD %');
  assert.equal(m.maxddDate, '2020-03-18');
  assert.equal(m.switches, 14);
  assert.equal(m.deferred, 0);
  assert.equal(m.lapsed, 0);
  assert.equal(m.holdDays, 0);
  assert.equal(m.silverDays, 761);
  near(m.timeInSilver * 100, 30.31, 0.005, 'Zeit in Silber %');
  near(r.eq[0], 9990, 1e-9, 'Start-Equity');
  near(r.sig.kMed.at(-1), 9.948871, 1e-6, 'k60 21.10.2026');
  assert.deepEqual(r.trades.map((t) => t.execDate), ['2019-06-06', '2019-09-04', '2020-02-26', '2021-02-02', '2022-07-05', '2022-11-07', '2023-03-08', '2023-04-05', '2024-01-22', '2024-05-16', '2024-09-09', '2024-10-21', '2024-12-31', '2025-12-22']);
  assert.deepEqual(r.trades.filter((t) => t.rule.startsWith('Spike')).map((t) => t.signalDate), ['2021-02-01', '2025-12-19']);
  near(r.trades.at(-1).equityAfter, 110000.72, 0.01, 'Equity nach letztem Switch');
  near(r.bhMetrics.gold.endValue, 31362.25, 0.01, 'Hold GLD'); near(r.bhMetrics.silver.endValue, 31387.39, 0.01, 'Hold SLV');
  near(r.bhMetrics.silver.maxdd * 100, -52.4432, 1e-4, 'Hold SLV DD');
  assert.ok(Number.isFinite(m.sharpe));
  // OOS-Neustart 20.10.2023 und WF-Fenster 21.10.2019 (gleiches Set)
  const oos = backtest(ds, DEFAULT_PARAMS, { start: '2023-10-20' });
  near(oos.metrics.endValue, 35920.68, 0.01, 'OOS USD'); near(oos.metrics.goldOz, 8.65559, 1e-5, 'OOS oz'); assert.equal(oos.metrics.switches, 6);
  near(oos.metrics.cagr * 100, 53.0749, 1e-4, 'OOS CAGR');
  const wfw = backtest(ds, DEFAULT_PARAMS, { start: '2019-10-21' });
  near(wfw.metrics.endValue, 78361.75, 0.01, 'WF-Fenster USD'); assert.equal(wfw.metrics.switches, 12);
  assert.equal(lastDaySignal(r, DEFAULT_PARAMS).due, null);
});

test('Grid wie v3 (15.570 Zellen), Robustheit, Walk-Forward = Spec', () => {
  const ds = specDs();
  const G = runGrid(ds, SPEC_GRID, { wfStart: '2019-10-21', oosStart: '2023-10-20' });
  assert.equal(G.cells.length, 15570);
  assert.deepEqual(G.ckDates, ['2019-10-21', '2020-10-21', '2021-10-21', '2022-10-21', '2023-10-20', '2024-10-21', '2025-10-21', '2026-10-21']);
  const R = gridRows(G);
  const spec = R.rows.find((x) => x.U1 === 90 && x.L1 === 82 && x.S === 100 && x.L2 === 66);
  near(spec.nbOzEnd, 22.66559, 1e-5, 'nb_oz_end'); assert.equal(spec.rankRobust, 1); assert.equal(spec.rankRaw, 21);
  assert.deepEqual([R.pick.U1, R.pick.L1, R.pick.S, R.pick.L2], [90, 82, 98, 66]); // Gleichstand mit S=100, pick() nimmt die mittlere nach S
  near(R.rawBest.ozEnd, 29.30994, 1e-5, 'roh bester'); near(R.rawBest.nbOzEnd, 17.52015, 1e-5, 'roh bester nb');
  const wf = walkForward(ds, G);
  assert.deepEqual(wf.plan.map((p) => [p.date, p.U1, p.L1, p.S, p.L2]), [
    ['2019-10-21', 92, 82, 104, 68], ['2020-10-21', 93, 83, 94, 74], ['2021-10-21', 93, 83, 94, 66], ['2022-10-21', 92, 84, 104, 66],
    ['2023-10-20', 90, 82, 104, 66], ['2024-10-21', 89, 81, 104, 66], ['2025-10-21', 90, 82, 108, 66]]);
  near(wf.metrics.endValue, 50056.36, 0.01, 'WF USD'); near(wf.metrics.goldOz, 12.06177, 1e-5, 'WF oz');
  near(wf.metrics.cagr * 100, 25.867, 1e-3, 'WF CAGR'); near(wf.metrics.maxdd * 100, -31.520, 1e-3, 'WF DD');
});

test('Neighbourhood/ranks/pick klein', () => {
  const cells = gridCells({ U1: [90, 91], gap: [8], S: [100], L2: [66, 68], window: [60], costPct: [0.1] });
  assert.equal(cells.length, 4);
  const nb = neighbourMean(cells, [1, 2, 3, 4]);
  assert.deepEqual(nb, [2.5, 2.5, 2.5, 2.5]);
  assert.deepEqual(ranks([3, 5, 5, 1]), [3, 1, 1, 4]);
  assert.equal(pickRobust(cells, [1, 2, 3, 4], [1, 2, 3, 3]), 3);
  assert.deepEqual(gridFromInput({ U1: '88-90/1', gap: '4, 8', S: '100', costPct: '0,1' }).U1, [88, 89, 90]);
  assert.deepEqual(gridFromInput({ gap: '4, 8' }).gap, [4, 8]);
  assert.throws(() => normParams({ U1: 80, L1: 82 }), /unter/);
});

test('Handelspaar mit eigenem Kalender: asof-Bewertung, Swap wartet auf echten Schluss, Währung/FX', () => {
  const days = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05', '2024-01-08'];
  const t = (d) => Date.parse(d + 'T00:00:00Z') / 1000;
  const bar = (d, c) => ({ time: t(d), open: c, close: c });
  const sigBars = (vals) => days.map((d, i) => bar(d, vals[i]));
  // GLD/SLV 9,5 × k 10 = sig 95 ab Tag 1 → sig > 90 → Swap fällig am nächsten Schluss (Tag 2), Paar handelt dort nicht.
  const bars = { 'GC=F': sigBars([2000, 1900, 1900, 1900, 1900]), 'SI=F': sigBars([25, 20, 20, 20, 20]), GLD: sigBars([180, 190, 190, 190, 190]), SLV: sigBars([22.5, 20, 20, 20, 20]),
    'AAA.DE': [bar('2024-01-02', 100), bar('2024-01-03', 101), bar('2024-01-05', 103), bar('2024-01-08', 104)], 'BBB.DE': [bar('2024-01-02', 10), bar('2024-01-03', 10), bar('2024-01-05', 11), bar('2024-01-08', 12)] };
  const pair = resolvePair({ pairId: 'CUSTOM', custom: { gold: 'aaa.de', silver: 'bbb.de' } });
  assert.equal(pair.currency, 'EUR'); assert.equal(guessCurrency('GLD'), 'USD');
  const fx = days.map((d) => bar(d, 1.1));
  const ds = buildDataset({ bars, pair, fxBars: fx, start: '2024-01-01' });
  assert.deepEqual(Array.from(ds.tradable), [1, 1, 0, 1, 1]);
  assert.equal(ds.pg[2], 101); // asof
  const r = backtest(ds, { ...DEFAULT_PARAMS, window: 1 }, { start: '2024-01-01' });
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].signalDate, '2024-01-03');
  assert.equal(r.trades[0].execDate, '2024-01-05'); // nicht am 04.01. (kein Xetra-Schluss im Test)
  near(ds.ozf[0], 1.1 / 2000, 1e-12, 'oz-Faktor mit FX');
  assert.ok(ds.notes.some((n) => /EUR/.test(n)));
  assert.throws(() => resolvePair({ pairId: 'CUSTOM', custom: { gold: 'x y', silver: 'SLV' } }), /ungültig/);
});

test('WisdomTree-Vorbelegungen: London USD (nicht GBP), Mailand EUR, Hinweis ohne Privatanleger-Lieferung', () => {
  const l = resolvePair({ pairId: 'WTPHL' });
  assert.equal(l.gold, 'PHAU.L'); assert.equal(l.silver, 'PHAG.L');
  assert.equal(l.currency, 'USD');
  assert.equal(guessCurrency('PHAU.L'), 'GBP'); // Heuristik für Custom-Ticker; Preset überschreibt
  assert.notEqual(l.currency, guessCurrency(l.gold));
  assert.match(l.note, /keine physische Lieferung für Privatanleger/);
  assert.deepEqual(l.isin, ['JE00B1VS3770', 'JE00B1VS3333']);
  assert.equal(l.venue, 'LSE');
  const m = resolvePair({ pairId: 'WTPHM' });
  assert.equal(m.gold, 'PHAU.MI'); assert.equal(m.silver, 'PHAG.MI');
  assert.equal(m.currency, 'EUR');
  assert.equal(guessCurrency('PHAU.MI'), 'EUR');
  assert.deepEqual(m.isin, l.isin);
  assert.equal(m.venue, 'Borsa Italiana');
  assert.match(m.note, /keine physische Lieferung für Privatanleger/);
});

test('Buch: Kauf (Bruchstücke), Teilverkauf, Bearbeiten, Swap, Löschen, Wieder öffnen (temp)', () => {
  const realBook = path.join(REAL_DATA_DIR, 'gsw-book.json');
  const realBefore = fs.existsSync(realBook) ? fs.readFileSync(realBook, 'utf8') : null;
  const a = book.buy({ metal: 'gold', symbol: 'gld', qty: '10,5', buyPrice: '300', buyDate: '2026-01-05' });
  assert.equal(a.lot.qty, 10.5); assert.equal(a.lot.symbol, 'GLD'); assert.equal(a.lot.currency, 'USD');
  const b = book.buy({ metal: 'gold', symbol: 'GLD', amount: '1000', buyPrice: '250', buyDate: '2026-02-02', costPct: 0.1 });
  near(b.lot.qty, 1000 * 0.999 / 250, 1e-6, 'Stück aus Betrag');
  const s = book.sell({ id: a.lot.id, qty: '0,5', sellPrice: '320', sellDate: '2026-03-01' });
  assert.equal(s.partial, true); assert.equal(s.lot.qty, 0.5);
  assert.equal(book.loadBook().lots.find((l) => l.id === a.lot.id).qty, 10);
  book.edit({ id: b.lot.id, note: 'Nachkauf' });
  const sw = book.swap({ from: 'gold', date: '2026-03-02', prices: { GLD: '310' }, toSymbol: 'slv', toPrice: '31', costPct: '0.1' });
  const gross = (10 + 1000 * 0.999 / 250) * 310;
  near(sw.swap.gross, gross, 1e-6, 'Erlös'); near(sw.lot.qty, Math.round(gross * 0.999 * 0.999 / 31 * 1e6) / 1e6, 1e-9, 'Silber-Stück');
  assert.equal(sw.lot.metal, 'silver');
  const open = book.openLots(book.loadBook());
  assert.deepEqual(open.map((l) => l.symbol), ['SLV']);
  assert.equal(book.closedLots(book.loadBook()).filter((l) => l.swapId === sw.swap.swapId).length, 2);
  assert.throws(() => book.swap({ from: 'gold', toSymbol: 'SLV', toPrice: 30 }), /Keine offenen Gold/);
  assert.throws(() => book.swap({ from: 'silver', toSymbol: 'GLD', toPrice: 300, currency: 'EUR', prices: { SLV: 30 } }), /Währung/);
  const ro = book.reopen({ id: a.lot.id }); assert.equal(ro.lot.status, 'open');
  book.remove({ id: ro.lot.id });
  assert.equal(book.loadBook().lots.some((l) => l.id === a.lot.id), false);
  assert.throws(() => book.applyAction('NOPE', {}), /action/);
  assert.ok(fs.existsSync(path.join(TEST_DATA_DIR, 'gsw-book.json')));
  const realAfter = fs.existsSync(realBook) ? fs.readFileSync(realBook, 'utf8') : null;
  assert.equal(realAfter, realBefore);
});

test('Einstellungen: eigene Datei, Validierung, Reset; data/settings.json bleibt unberührt', () => {
  const realSettings = path.join(REAL_DATA_DIR, 'settings.json');
  const before = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;
  assert.deepEqual(loadSettings().params, DEFAULT_PARAMS);
  const s = saveSettings({ pairId: 'xtrackers', params: { U1: '91', S: 104 } });
  assert.equal(s.pairId, 'XTRACKERS'); assert.equal(s.params.U1, 91); assert.equal(s.params.L1, 82);
  assert.throws(() => saveSettings({ params: { L1: 95 } }), /unter/);
  assert.throws(() => saveSettings({ pairId: 'FOO' }), /unbekannt/);
  saveSettings({ pairId: 'CUSTOM', custom: { gold: '4gld.de', silver: 'vzlc.de' } });
  assert.equal(loadSettings().custom.gold, '4GLD.DE');
  assert.deepEqual(saveSettings({ reset: true }).params, DEFAULT_PARAMS);
  assert.ok(fs.existsSync(path.join(TEST_DATA_DIR, 'gsw-settings.json')));
  assert.equal(fs.existsSync(path.join(TEST_DATA_DIR, 'settings.json')), false);
  const after = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;
  assert.equal(after, before);
});

test('Tastenkürzel/Hilfe kennen GSW und GSWBT', () => {
  assert.ok(SHORTCUTS.some((s) => s[0] === 'GSW'));
  assert.ok(SHORTCUTS.some((s) => /GSWBT/.test(s.join(' '))));
});

test('steuerfrei ab = Kauf + 1 Jahr + 1 Tag, Schaltjahr', () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(2025), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(addCalendarYears('2024-02-29', 1), '2025-02-28');
  assert.equal(taxFreeFrom('2024-02-29', 365), '2025-03-01');
  assert.equal(taxFreeFrom('2020-02-29'), '2021-03-01');
  assert.equal(taxFreeFrom('2023-02-28', 365), '2024-02-29');
  assert.equal(taxFreeFrom('2020-03-15', 365), '2021-03-16');
  assert.equal(inHoldPeriod('2020-03-15', '2021-03-15', 365), true); // Jahrestag noch in der Frist
  assert.equal(inHoldPeriod('2020-03-15', '2021-03-16', 365), false);
  assert.equal(restHoldDays('2020-03-15', '2021-03-15', 365), 1);
  assert.equal(holdUnlockDate('2020-01-01', 10), '2020-01-11');
  assert.equal(inHoldPeriod('2020-01-01', '2020-01-10', 10), true);
  assert.equal(inHoldPeriod('2020-01-01', '2020-01-11', 10), false);
});

test('Paar-Art und WisdomTree-Swap-Presets (BULL/SLVR, USD in London)', () => {
  assert.equal(PAIRS.INVESCO.kind, 'physical-delivery');
  assert.equal(PAIRS.GLDSLV.kind, 'physical-no-delivery');
  assert.equal(PAIRS.XTRACKERS.kind, 'physical-no-delivery');
  assert.equal(PAIRS.WTPHL.kind, 'physical-no-delivery');
  assert.equal(PAIRS.WTPHM.kind, 'physical-no-delivery');
  assert.equal(PAIRS.FUTURES.kind, 'futures');
  const l = resolvePair({ pairId: 'WTSWAPL' });
  assert.equal(l.gold, 'BULL.L'); assert.equal(l.silver, 'SLVR.L');
  assert.equal(l.currency, 'USD');
  assert.equal(guessCurrency('BULL.L'), 'GBP');
  assert.notEqual(l.currency, guessCurrency(l.gold));
  assert.equal(l.kind, 'synthetic');
  assert.match(l.note, /synthetisch, Futures-Index inkl\. Roll, Kontrahentenrisiko besichert/);
  assert.deepEqual(l.isin, ['GB00B15KXX56', 'GB00B15KY328']);
  assert.equal(l.venue, 'LSE');
  const m = resolvePair({ pairId: 'WTSWAPM' });
  assert.equal(m.gold, 'BULL.MI'); assert.equal(m.silver, 'SLVR.MI');
  assert.equal(m.currency, 'EUR');
  assert.equal(m.kind, 'synthetic');
  assert.deepEqual(m.isin, l.isin);
  assert.equal(kindInfo('synthetic').short, 'synthetisch');
});

test('Mindesthaltedauer: Default nur bei Lieferanspruch, Override je Paar', () => {
  assert.equal(defaultHoldOn(PAIRS.INVESCO), true);
  assert.equal(defaultHoldOn(PAIRS.GLDSLV), false);
  assert.equal(defaultHoldOn(PAIRS.WTSWAPL), false);
  assert.equal(defaultHoldOn({ id: 'CUSTOM', kind: null }), false);
  const d = gswDefaults();
  assert.equal(holdMinDays(d), 365);
  assert.equal(holdMinEnabled(d, PAIRS.INVESCO), true);
  assert.equal(holdMinEnabled(d, PAIRS.GLDSLV), false);
  const off = saveSettings({ pairId: 'INVESCO', holdMin: { enabled: false } });
  assert.equal(off.holdMin.on.INVESCO, false);
  assert.equal(holdMinEnabled(off, PAIRS.INVESCO), false);
  const on = saveSettings({ pairId: 'GLDSLV', holdMin: { enabled: true, days: 365 } });
  assert.equal(on.holdMin.on.GLDSLV, true);
  assert.equal(holdMinEnabled(on, PAIRS.GLDSLV), true);
  assert.equal(holdMinDays(on), 365);
  assert.throws(() => saveSettings({ holdMin: { days: 0 } }), /Tage/);
  assert.deepEqual(saveSettings({ reset: true }).holdMin, { days: 365, on: {} });
});

test('Swap-Sperre: aufschieben, entfallen, ohne Sperre unverändert; Grid übernimmt holdDays', () => {
  const n = 20;
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.parse('2020-01-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10));
  const one = new Float64Array(n).fill(10);
  const sigLapse = Float64Array.from(Array.from({ length: n }, (_, i) => (i === 1 ? 91 : i === 0 ? 80 : 85)));
  const base = { pg: one, ps: one, U1: 90, L1: 82, S: 100, L2: 66, cost: 0.001, cap: 10000, dates };
  const free = runCore({ ...base, sig: sigLapse });
  assert.deepEqual(free.trades.map((x) => [x.sigI, x.i, x.dir]), [[1, 2, 1]]);
  const lapse = runCore({ ...base, sig: sigLapse, holdDays: 10 });
  assert.equal(lapse.trades.length, 0);
  assert.equal(lapse.lapsed.length, 1);
  assert.equal(lapse.hold.lapsed, 1);
  assert.equal(lapse.hold.deferred, 0);
  assert.equal(dates[lapse.lapsed[0].i], '2020-01-11');
  assert.equal(lapse.final.pos, 0);

  const sigKeep = Float64Array.from(Array.from({ length: n }, (_, i) => (i >= 1 ? 91 : 80)));
  const def = runCore({ ...base, sig: sigKeep, holdDays: 10 });
  assert.equal(def.trades.length, 1);
  assert.equal(def.trades[0].deferred, true);
  assert.equal(dates[def.trades[0].i], '2020-01-11');
  assert.equal(def.trades[0].delayCal, 9);
  assert.equal(def.hold.deferred, 1);
  assert.equal(def.hold.avgDelay, 9);
  assert.equal(def.final.pos, 1);

  // Spec ohne Sperre unverändert
  const ds = specDs();
  const r0 = backtest(ds, DEFAULT_PARAMS, { holdDays: 0 });
  near(r0.metrics.endValue, 102111.00, 0.01, 'Spec ohne Sperre');
  assert.equal(r0.metrics.switches, 14);
  assert.equal(r0.metrics.deferred, 0);
  const r365 = backtest(ds, DEFAULT_PARAMS, { holdDays: 365 });
  assert.ok(r365.metrics.switches !== 14 || Math.abs(r365.metrics.endValue - 102111) > 1, '365-Tage-Sperre ändert den Pfad');
  assert.ok(r365.hold.deferred + r365.hold.lapsed > 0, 'Sperre erzeugt aufgeschobene oder entfallene Swaps');
  assert.equal(r365.metrics.holdDays, 365);

  const grid = { U1: [90], gap: [8], S: [100], L2: [66], window: [60], costPct: [0.1] };
  const G0 = runGrid(ds, grid, { start: '2016-10-21', end: '2026-10-21' });
  const G1 = runGrid(ds, grid, { start: '2016-10-21', end: '2026-10-21', holdDays: 365 });
  assert.equal(G0.holdDays, 0);
  assert.equal(G1.holdDays, 365);
  assert.notEqual(G0.ozCk[0][0], G1.ozCk[0][0]);
});

test('Steuer: none = Rohertrag unverändert, KapESt je Swap aus dem Erlös, Verlusttopf, Liquidation', () => {
  assert.equal(normTax(null), null);
  assert.equal(normTax({ mode: 'none' }), null);
  assert.equal(KEST_RATE, 0.26375);
  near(normTax({ mode: 'kest' }).rate, 0.25 * 1.055, 1e-12, 'KapESt + Soli');
  const n = 12;
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.parse('2020-01-01T00:00:00Z') + i * 86400000).toISOString().slice(0, 10));
  // Tag 1 Signal → Silber an Tag 2 (Gold 10 → 12: Gewinn), Tag 5 Signal → Gold an Tag 6 (Silber 10 → 8: Verlust), Tag 8 → Silber an Tag 9 (Gold steigt: Gewinn gegen Topf)
  const pg = Float64Array.from([10, 10, 12, 12, 12, 12, 12, 12, 12, 15, 15, 15]);
  const ps = Float64Array.from([10, 10, 10, 10, 10, 10, 8, 8, 8, 8, 8, 9]);
  const sig = Float64Array.from([85, 91, 85, 85, 85, 70, 85, 85, 91, 85, 85, 85]);
  const base = { sig, pg, ps, U1: 90, L1: 82, S: 100, L2: 66, cost: 0, cap: 1000, dates };
  const raw = runCore(base);
  const none = runCore({ ...base, tax: { mode: 'none' } });
  assert.equal(none.final.equity, raw.final.equity);
  assert.equal(none.tax.paid, 0);
  const k = runCore({ ...base, tax: { mode: 'kest' } });
  assert.equal(k.trades.length, 3);
  // Swap 1: 100 Gold-Anteile × 12 = 1200, Gewinn 200, Steuer 52,75 → 1147,25 reinvestiert
  near(k.trades[0].gain, 200, 1e-9, 'Gewinn 1');
  near(k.trades[0].tax, 200 * 0.26375, 1e-9, 'Steuer 1');
  // Swap 2: Silber 10 → 8: Verlust 20 % von 1147,25 → Verlusttopf
  near(k.trades[1].gain, -1147.25 * 0.2, 1e-9, 'Verlust 2');
  assert.equal(k.trades[1].tax, 0);
  near(k.trades[1].lossPotAfter, 229.45, 1e-9, 'Topf nach Verlust');
  // Swap 3: Gold 12 → 15 auf 917,8: Gewinn 229,45, voll mit Topf verrechnet → keine Steuer
  near(k.trades[2].gain, 917.8 * 0.25, 1e-9, 'Gewinn 3');
  near(k.trades[2].tax, 0, 1e-9, 'Topf verrechnet');
  near(k.tax.lossCarry, 0, 1e-9, 'Topf leer');
  near(k.tax.paid, 52.75, 1e-9, 'Summe Steuer');
  // Ende: Silber 8 → 9 auf 1147,25 → unrealisiert +143,41; Liquidationssteuer separat, Equity bleibt vor Liquidation
  near(k.final.equity, 1147.25 * 9 / 8, 1e-9, 'Endwert vor Liquidation');
  near(k.tax.liqTax, 1147.25 / 8 * 0.26375, 1e-9, 'Liquidationssteuer');
  near(k.tax.endAfterLiq, k.final.equity - k.tax.liqTax, 1e-9, 'nach Liquidation');
  // Pauschbetrag 100 je Jahr: Swap 1 zahlt nur auf 100
  const a = runCore({ ...base, tax: { mode: 'kest', allowance: 100 } });
  near(a.trades[0].tax, 100 * 0.26375, 1e-9, 'Pauschbetrag');
  // §23: innerhalb der Frist mit p23Rate, nach Frist steuerfrei
  const p = runCore({ ...base, tax: { mode: 'kest', p23: true, p23Rate: 0.45 } });
  near(p.trades[0].tax, 200 * 0.45, 1e-9, '§23 in Frist');
  const long = Array.from({ length: n }, (_, i) => new Date(Date.parse('2020-01-01T00:00:00Z') + i * 400 * 86400000).toISOString().slice(0, 10));
  const pl = runCore({ ...base, dates: long, tax: { mode: 'kest', p23: true } });
  assert.ok(pl.trades.every((t) => t.taxFree && t.tax === 0), '§23 nach Frist steuerfrei');
  assert.equal(pl.tax.paid, 0);
  assert.equal(pl.tax.lossCarry, 0, 'Verlust nach Frist nicht verrechenbar');
  assert.equal(pl.final.equity, raw.final.equity);
});

test('Steuer im Backtest/Grid/WF/OOS und taxFromInput (Art-Logik)', () => {
  const ds = specDs();
  const r0 = backtest(ds, DEFAULT_PARAMS, {});
  near(r0.metrics.endValue, 102111.00, 0.01, 'Spec ohne Steuer');
  assert.equal(r0.metrics.taxMode, 'none');
  assert.equal(r0.metrics.endValueAfterLiq, r0.metrics.endValue);
  const rk = backtest(ds, DEFAULT_PARAMS, { tax: { mode: 'kest' } });
  assert.equal(rk.metrics.taxMode, 'kest');
  assert.ok(rk.metrics.endValue < r0.metrics.endValue);
  assert.ok(rk.metrics.taxPaid > 0);
  assert.ok(rk.trades.filter((t) => !t.lapsed).every((t) => Number.isFinite(t.tax)));
  assert.ok(rk.metrics.endValueAfterLiq <= rk.metrics.endValue + 1e-9);
  // §23 mit 365-Tage-Sperre: alle Swaps nach Frist → Ergebnis = ohne Steuer
  const r365 = backtest(ds, DEFAULT_PARAMS, { holdDays: 365 });
  const p365 = backtest(ds, DEFAULT_PARAMS, { holdDays: 365, tax: { mode: 'kest', p23: true } });
  near(p365.metrics.endValue, r365.metrics.endValue, 1e-6, '§23 + Sperre steuerfrei');
  assert.equal(p365.metrics.taxPaid, 0);
  const grid = { U1: [88, 90], gap: [8], S: [100], L2: [66], window: [60], costPct: [0.1] };
  const G0 = runGrid(ds, grid, { start: '2016-10-21', end: '2026-10-21', wfStart: '2019-10-21', oosStart: '2023-10-20' });
  const G1 = runGrid(ds, grid, { start: '2016-10-21', end: '2026-10-21', wfStart: '2019-10-21', oosStart: '2023-10-20', tax: { mode: 'kest' } });
  assert.equal(G0.tax, null);
  assert.equal(G1.tax.mode, 'kest');
  const j = G1.cells.findIndex((c) => c.U1 === 90);
  near(G1.usd[j], rk.metrics.endValue, 1e-6, 'Grid-Zelle = Einzellauf mit Steuer');
  assert.ok(gridRows(G1).rows.every((x) => Number.isFinite(x.taxPaid)));
  const wf0 = walkForward(ds, G0), wf1 = walkForward(ds, G1);
  assert.equal(wf1.metrics.taxMode, 'kest');
  assert.ok(wf1.metrics.endValue < wf0.metrics.endValue);
  // taxFromInput: Art steuert §23
  const s0 = gswDefaults();
  assert.equal(taxFromInput({}, s0, PAIRS.GLDSLV), null);
  assert.equal(taxFromInput({ taxMode: 'none' }, s0, PAIRS.GLDSLV), null);
  const tg = taxFromInput({ taxMode: 'kest' }, s0, PAIRS.GLDSLV);
  assert.equal(tg.p23, false);
  near(tg.rate, 0.26375, 1e-12, 'Default-Satz');
  assert.equal(taxFromInput({ taxMode: 'kest', taxP23: 'on' }, s0, PAIRS.WTSWAPL).p23, false, 'synthetisch immer KapESt');
  assert.equal(taxFromInput({ taxMode: 'kest' }, s0, PAIRS.INVESCO).p23, true, 'Lieferanspruch + Default-Haltefrist');
  assert.equal(taxFromInput({ taxMode: 'kest', taxP23: 'off' }, s0, PAIRS.INVESCO).p23, false);
  const sOff = { ...s0, holdMin: { days: 365, on: { INVESCO: false } } };
  assert.equal(taxFromInput({ taxMode: 'kest' }, sOff, PAIRS.INVESCO).p23, false, 'auto folgt Haltefrist-Option');
  assert.equal(taxFromInput({ taxMode: 'kest', taxP23: 'on' }, sOff, PAIRS.INVESCO).p23, true);
  near(taxFromInput({ taxMode: 'kest', taxRate: '26,375', p23Rate: '44.31' }, s0, PAIRS.INVESCO).p23Rate, 0.4431, 1e-12, '§23-Satz');
  assert.throws(() => taxFromInput({ taxMode: 'xyz' }, s0, PAIRS.GLDSLV), /Steuermodus/);
  assert.throws(() => taxFromInput({ taxMode: 'kest', taxRate: 80 }, s0, PAIRS.GLDSLV), /0–60/);
});
