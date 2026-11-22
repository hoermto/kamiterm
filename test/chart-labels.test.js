// Serien-Titel auf der Y-Achse statt im Plot (public/js/chart-labels.js): reine Helfer + Wrapper um addSeries/createPriceLine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelText, formatAxisValue, spreadLabels, titlesOnAxis, AxisTitle, contrast } from '../public/js/chart-labels.js';

test('labelText/formatAxisValue: „Wert Titel“, Prozent-Modus relativ zum ersten sichtbaren Wert', () => {
  assert.equal(labelText('16.578', 'Regel Spec v3'), '16.578 Regel Spec v3');
  assert.equal(labelText('1,5', ''), '1,5');
  assert.equal(formatAxisValue(129.9, { mode: 2, base: 100 }), '29.90%');
  assert.equal(formatAxisValue(90, { mode: 2, base: 100 }), '\u221210.00%');
  assert.equal(formatAxisValue(18970, { fmt: (v) => v.toLocaleString('de-DE') }), '18.970');
  assert.equal(formatAxisValue(NaN), '');
});

test('spreadLabels: kein Überlappen, Reihenfolge bleibt, im Pane geklemmt', () => {
  assert.deepEqual(spreadLabels([10, 100], 16), [10, 100]);
  const y = spreadLabels([50, 52, null, 200], 16);
  assert.equal(y[2], null); assert.equal(y[3], 200);
  assert.ok(y[1] - y[0] >= 16); assert.equal((y[0] + y[1]) / 2, 51, 'Block um die Mitte zentriert');
  const c = spreadLabels([95, 98], 16, 100);
  assert.ok(c[1] <= 92 && c[1] - c[0] >= 16, 'unten im Pane gehalten');
  const t = spreadLabels([0, 1], 16, 100);
  assert.ok(t[0] >= 8);
});

function fakeChart() {
  const made = [];
  return {
    made,
    addSeries(type, o, pane) {
      const s = { type, o, pane, prims: [], lines: [], attachPrimitive(p) { this.prims.push(p); p.attached({ series: this, chart: ch, requestUpdate() {} }); },
        createPriceLine(l) { this.lines.push(l); return l; }, data: () => [{ time: 1, value: 10 }, { time: 2, value: 12 }], dataByIndex: (i) => (i >= 1 ? { time: 2, value: 12 } : { time: 1, value: 10 }),
        priceToCoordinate: (v) => 200 - v * 10, priceScale: () => ({ options: () => ({ mode: 0 }) }), priceFormatter: () => ({ format: (v) => v.toFixed(2) }), options: () => ({ priceScaleId: o.priceScaleId || 'right' }) };
      made.push(s); return s;
    },
    timeScale: () => ({ getVisibleLogicalRange: () => ({ from: 0, to: 1 }) }),
    options: () => ({ layout: { fontSize: 11 }, localization: {} }),
  };
}
let ch;

test('titlesOnAxis: Titel nie im Plot; Wert-Label der Serie wird zum Achsen-Label „Wert Titel“', () => {
  ch = titlesOnAxis(fakeChart());
  const a = ch.addSeries('line', { color: '#ffa028', title: 'Buch (EUR)' });
  assert.equal(a.o.title, ''); assert.equal(a.o.lastValueVisible, false); assert.equal(a.prims.length, 1);
  const v = a.prims[0].priceAxisViews()[0];
  a.prims[0].updateAllViews();
  assert.equal(v.text(), '12.00 Buch (EUR)'); assert.equal(v.coordinate(), 80); assert.equal(v.backColor(), '#ffa028'); assert.equal(v.visible(), true);
  // ohne Wert-Label: Titel entfällt nur
  const b = ch.addSeries('line', { color: '#777', title: 'Hilfslinie', lastValueVisible: false }, 1);
  assert.equal(b.o.title, ''); assert.equal(b.o.lastValueVisible, false); assert.equal(b.prims.length, 0); assert.equal(b.pane, 1);
  // ohne Titel: unverändert
  const c = ch.addSeries('area', { lineColor: '#fff' });
  assert.equal(c.o.lastValueVisible, undefined); assert.equal(c.prims.length, 0);
  assert.deepEqual(ch.seriesTitles(), [{ title: 'Buch (EUR)', color: '#ffa028' }, { title: 'Hilfslinie', color: '#777' }]);
  // Preislinien
  a.createPriceLine({ price: 9, color: '#ff4a4a', axisLabelVisible: true, title: 'U1' });
  assert.equal(a.lines[0].title, ''); assert.equal(a.lines[0].axisLabelVisible, false);
  const pl = a.prims.at(-1); pl.updateAllViews();
  assert.equal(pl.priceAxisViews()[0].text(), '9.00 U1');
  a.createPriceLine({ price: 70, axisLabelVisible: false, title: 'x' });
  assert.equal(a.lines[1].title, ''); assert.equal(a.prims.length, 2);
  assert.equal(titlesOnAxis(ch), ch, 'idempotent');
});

test('AxisTitle: Labels gleicher Achse überdecken sich nicht', () => {
  const c2 = titlesOnAxis(fakeChart());
  const s1 = c2.addSeries('line', { color: '#000000', title: 'A' });
  const s2 = c2.addSeries('line', { color: '#ffffff', title: 'B' });
  s1.prims[0].updateAllViews(); s2.prims[0].updateAllViews();
  const y1 = s1.prims[0].priceAxisViews()[0].coordinate(), y2 = s2.prims[0].priceAxisViews()[0].coordinate();
  assert.ok(Math.abs(y1 - y2) >= 16);
  assert.equal(contrast('#000000'), '#fff'); assert.equal(contrast('#ffffff'), '#000');
  assert.ok(new AxisTitle({ title: 'x', color: '#f00' }).priceAxisViews()[0].visible() === false);
});
