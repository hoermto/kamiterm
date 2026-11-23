import { TEST_DATA_DIR, REAL_DATA_DIR } from './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
// Datenqualität (lib/data-quality.js): eingefrorene Kurse erkennen/ersetzen; GSW-Signal unabhängig vom Paar; Y-Autoscale-Helfer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

process.env.QT_OFFLINE = '1';
const { findFreezes, altMap, patchFreezes, qualityNotes, FREEZE_REF, FREEZE_PATCHES } = await import('../lib/data-quality.js');
const { buildDataset, PAIRS } = await import('../lib/gsw/data.js');
const { sigFor } = await import('../lib/gsw/engine.js');
const { guideAutoscale } = await import('../public/js/fn/gsw.js');

// Werktage ab 2022-01-03 (Mo); Wochenenden ohne Bar
const T0 = Date.UTC(2022, 0, 3) / 1000;
const days = (n) => { const out = []; for (let k = 0; out.length < n; k++) { const t = T0 + k * 86400; const wd = new Date(t * 1000).getUTCDay(); if (wd && wd < 6) out.push(t); } return out; };
const mk = (ts, f) => ts.map((time, i) => { const c = f(i); return { time, open: c, high: c, low: c, close: c, volume: 0 }; });

test('isolierter Datenordner', () => { assert.notEqual(path.resolve(TEST_DATA_DIR), path.resolve(REAL_DATA_DIR)); });

test('findFreezes: Wochenenden zählen nicht, Run nur bei bewegter Referenz, erster Bar bleibt echt', () => {
  const ts = days(60);
  const ref = mk(ts, (i) => 1800 + i * 3);
  // keine Wiederholungen trotz Wochenend-Lücken
  assert.deepEqual(findFreezes(mk(ts, (i) => 100 + i), { ref }), []);
  const frozen = mk(ts, (i) => (i >= 20 && i < 30 ? 120 : 100 + i));
  const f = findFreezes(frozen, { ref });
  assert.equal(f.length, 1);
  assert.equal(f[0].start, 20); assert.equal(f[0].end, 29); assert.equal(f[0].n, 10); assert.equal(f[0].stale, 9); assert.equal(f[0].value, 120);
  assert.ok(f[0].refMovePct > 0.5);
  // Referenz flach → kein Datenfehler (Markt stand still)
  assert.deepEqual(findFreezes(frozen, { ref: mk(ts, () => 1800) }), []);
  // kürzer als minRun → nichts
  assert.deepEqual(findFreezes(mk(ts, (i) => (i >= 20 && i < 23 ? 120 : 100 + i)), { ref }), []);
});

test('altMap: Wechselkurs angewandt, eigene eingefrorene Bars der Alternative fallen raus', () => {
  const ts = days(30);
  const alt = mk(ts, (i) => (i >= 10 && i < 16 ? 220 : 200 + i));
  const fx = mk(ts, () => 2);
  const m = altMap(alt, fx, 'div');
  const d = (i) => new Date(ts[i] * 1000).toISOString().slice(0, 10);
  assert.equal(m.get(d(0)), 100);
  assert.equal(m.get(d(10)), 110); // erster Bar des Runs gilt als echt
  for (let i = 11; i < 16; i++) assert.equal(m.has(d(i)), false);
  assert.equal(altMap(alt, fx, 'mul').get(d(1)), 402);
});

test('patchFreezes: skaliert auf Rand-Verhältnis, Overlap-Qualität, synthetisch markiert', () => {
  const ts = days(80);
  const truth = (i) => 100 + 10 * Math.sin(i / 7);
  const orig = mk(ts, (i) => (i > 30 && i <= 45 ? truth(30) : truth(i)));
  const ref = mk(ts, (i) => 1800 + i);
  const fr = findFreezes(orig, { ref });
  assert.equal(fr.length, 1); assert.equal(fr[0].stale, 15);
  const d = (i) => new Date(ts[i] * 1000).toISOString().slice(0, 10);
  // Alternative = halber Kurs (anderes Listing), Tag 40 fehlt → synthetischer Ersatz
  const altM = new Map(ts.map((_, i) => [d(i), truth(i) / 2]).filter(([k]) => k !== d(40)));
  const synM = new Map(ts.map((_, i) => [d(i), truth(i) * 3]));
  const { bars, patches } = patchFreezes(orig, fr, [{ label: 'ALT', map: altM }, { label: 'SYN', synthetic: true, map: synM }]);
  for (let i = 31; i <= 45; i++) assert.ok(Math.abs(bars[i].close - truth(i)) < 1e-9, `Bar ${i}`);
  assert.equal(bars[35].patched, 'ALT'); assert.equal(bars[35].synthetic, false);
  assert.equal(bars[40].patched, 'SYN'); assert.equal(bars[40].synthetic, true);
  assert.equal(bars[30].patched, undefined);
  assert.equal(orig[35].close, truth(30), 'Original unverändert');
  const p = patches[0];
  assert.equal(p.filled, 15); assert.equal(p.unfilled, 0); assert.deepEqual(p.sources, { ALT: 14, SYN: 1 }); assert.equal(p.synthetic, true); assert.equal(p.source, 'ALT');
  assert.ok(p.overlap.n > 0 && p.overlap.medianAbsPct < 1e-6);
  const notes = qualityNotes('8PSG.DE', { patches, unpatched: [] });
  assert.equal(notes.length, 1); assert.equal(notes[0].level, 'info');
  assert.match(notes[0].text, /^Datenkorrektur 8PSG\.DE: 15 eingefrorene Schlusskurse .* ersetzt aus ALT \(14\), SYN \(1\) – teilweise synthetisch gefüllt; Overlap-Abweichung/);
});

test('qualityNotes: nicht korrigierter Run → Datenwarnung', () => {
  const n = qualityNotes('XYZ.DE', { patches: [], unpatched: [{ from: '2022-09-12', to: '2022-09-20', n: 7, value: 12.5, refMovePct: 2.25 }] });
  assert.equal(n[0].level, 'warn');
  assert.equal(n[0].text, 'Datenwarnung XYZ.DE: 7 gleiche Schlusskurse in Folge 12.09.2022–20.09.2022 (12,5), Referenz bewegte sich 2,25 % – vermutlich eingefrorene Yahoo-Daten, nicht korrigiert.');
});

test('Patch-Tabelle: 8PSG.DE zuerst aus SGLD.MI, Referenz GC=F', () => {
  assert.equal(FREEZE_REF['8PSG.DE'], 'GC=F'); assert.equal(FREEZE_REF['8PSB.DE'], 'SI=F');
  assert.equal(FREEZE_PATCHES['8PSG.DE'][0].alt, 'SGLD.MI');
  assert.ok(FREEZE_PATCHES['8PSG.DE'].at(-1).synthetic);
});

test('GSW-Signal kommt nur aus Gold/Silber (GLD/SLV × k), unabhängig vom Handelspaar', () => {
  const ts = days(120);
  const bars = {
    'GC=F': mk(ts, (i) => 1800 + 20 * Math.sin(i / 9)), 'SI=F': mk(ts, (i) => 22 + Math.cos(i / 5)),
    GLD: mk(ts, (i) => 170 + 2 * Math.sin(i / 9)), SLV: mk(ts, (i) => 20 + Math.cos(i / 5)),
  };
  const ip = PAIRS.INVESCO;
  const a = buildDataset({ bars, pair: PAIRS.GLDSLV, start: '2000-01-01' });
  const b = buildDataset({ bars: { ...bars, [ip.gold]: mk(ts, (i) => 160 + i), [ip.silver]: mk(ts, () => 18) }, pair: ip, fxBars: mk(ts, () => 1.1), start: '2000-01-01' });
  const c = buildDataset({ bars: { ...bars, [ip.gold]: mk(ts, () => 167.14), [ip.silver]: mk(ts, (i) => 18 + i / 10) }, pair: ip, fxBars: mk(ts, () => 1.1), start: '2000-01-01' });
  const sa = sigFor(a, 60).sig, sb = sigFor(b, 60).sig, sc = sigFor(c, 60).sig;
  assert.ok(sa.length === a.dates.length && [...sa].some(Number.isFinite));
  assert.deepEqual(a.dates, b.dates);
  assert.deepEqual([...sa].map(String), [...sb].map(String));
  assert.deepEqual([...sa].map(String), [...sc].map(String));
});

test('guideAutoscale: Schwellen nur einbeziehen, wenn nah; flache Guide-Serien nach sichtbarem Bereich', () => {
  const orig = () => ({ priceRange: { minValue: 80, maxValue: 90 } });
  assert.deepEqual(guideAutoscale(orig, [{ value: 85 }]).priceRange, { minValue: 80, maxValue: 90 });
  assert.deepEqual(guideAutoscale(orig, [{ value: 95 }, { value: 120 }]).priceRange, { minValue: 80, maxValue: 95 }, 'nur der nächste Guide oben, innerhalb 1× Spanne');
  assert.deepEqual(guideAutoscale(orig, [{ value: 140 }, { value: 40 }]).priceRange, { minValue: 80, maxValue: 90 }, 'ferne Linien strecken nicht');
  assert.deepEqual(guideAutoscale(orig, [{ value: 75 }]).priceRange, { minValue: 75, maxValue: 90 });
  const g = [{ data: [{ time: '2022-01-01', value: 60 }, { time: '2023-01-01', value: 92 }] }];
  assert.deepEqual(guideAutoscale(orig, g).priceRange, { minValue: 60, maxValue: 92 }, 'Guide-Serie überlappt den Datenbereich → ganz einbezogen');
  assert.deepEqual(guideAutoscale(orig, g, { from: '2022-06-01', to: '2024-01-01' }).priceRange, { minValue: 80, maxValue: 92 });
  assert.deepEqual(guideAutoscale(orig, g, { from: '2021-06-01', to: '2022-06-01' }).priceRange, { minValue: 80, maxValue: 90 }, '60 liegt außerhalb 1× Spanne');
  assert.equal(guideAutoscale(() => null, [{ value: 1 }]), null);
  assert.deepEqual(guideAutoscale(orig, []), orig());
});
