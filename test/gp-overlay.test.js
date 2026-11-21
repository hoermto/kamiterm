import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse} from '../public/js/commands.js';
import {
  parseGpOverlay, holdingsGpCommand, formatGpCommand, dePrice, fmtCmdNum,
} from '../public/js/gp-overlay.js';

test('parse: GP/CHART/GRAPH/PRICE keep BUY/STOP/SRC/TRAIL as args, also when function-first', () => {
  const cases = [
    'GP AAPL BUY=150.20@2026-11-09 STOP=120.16 SRC=RSL',
    'AAPL GP BUY=150.20@2026-11-09 STOP=120.16 SRC=RSL',
    'AAPL CHART BUY=150.20@2026-11-09 STOP=120.16 SRC=RSL',
    'AAPL GRAPH BUY=150.20@2026-11-09 STOP=120.16 SRC=RSL',
    'AAPL PRICE BUY=150.20@2026-11-09 STOP=120.16 SRC=RSL',
  ];
  for (const s of cases) {
    const p = parse(s);
    assert.equal(p.fn, 'GP', s);
    assert.equal(p.sec.id, 'AAPL', s);
    assert.deepEqual(p.args, ['BUY=150.20@2026-11-09', 'STOP=120.16', 'SRC=RSL'], s);
  }
});

test('parse: SAP GY EQUITY does not collide with overlay params; range can sit anywhere', () => {
  const a = parse('SAP GY EQUITY GP BUY=100@2026-11-09 STOP=80 TRAIL=20 SRC=RSL');
  assert.equal(a.fn, 'GP');
  assert.equal(a.sec.id, 'SAP.DE');
  assert.equal(a.sec.exch, 'GY');
  assert.deepEqual(a.args, ['BUY=100@2026-11-09', 'STOP=80', 'TRAIL=20', 'SRC=RSL']);

  const b = parse('GP SAP GY EQUITY BUY=100@2026-11-09 STOP=80');
  assert.equal(b.fn, 'GP');
  assert.equal(b.sec.id, 'SAP.DE');
  assert.deepEqual(b.args, ['BUY=100@2026-11-09', 'STOP=80']);

  const c = parse('GP AAPL 1Y BUY=150.20@2026-11-09');
  assert.equal(c.sec.id, 'AAPL');
  assert.deepEqual(c.args, ['1Y', 'BUY=150.20@2026-11-09']);

  const d = parse('GP AAPL BUY=150.20@2026-11-09 1Y');
  assert.equal(d.sec.id, 'AAPL');
  assert.deepEqual(d.args, ['BUY=150.20@2026-11-09', '1Y']);
});

test('parse: futures CL=F and a bare GP AAPL stay unchanged', () => {
  const fut = parse('GP CL=F');
  assert.equal(fut.fn, 'GP');
  assert.equal(fut.sec.id, 'CL=F');
  assert.deepEqual(fut.args, []);

  const withBuy = parse('GP CL=F BUY=80');
  assert.equal(withBuy.sec.id, 'CL=F');
  assert.deepEqual(withBuy.args, ['BUY=80']);

  const plain = parse('GP AAPL');
  assert.equal(plain.fn, 'GP');
  assert.equal(plain.sec.id, 'AAPL');
  assert.deepEqual(plain.args, []);
  const ov = parseGpOverlay(plain.args);
  assert.deepEqual(ov.buys, []);
  assert.deepEqual(ov.stops, []);
  assert.equal(ov.hint, null);
});

test('parseGpOverlay: lots, optional date, SRC prefix, TRAIL in stop label', () => {
  const ov = parseGpOverlay(['BUY=150.20@2026-11-09,148@2026-10-01', 'STOP=120.16', 'TRAIL=20', 'SRC=RSL']);
  assert.equal(ov.errors.length, 0);
  assert.equal(ov.buys.length, 2);
  assert.equal(ov.buys[0].price, 150.20);
  assert.equal(ov.buys[0].date, '2026-11-09');
  assert.equal(ov.buys[0].label, 'RSL Kauf 150,20');
  assert.equal(ov.buys[1].price, 148);
  assert.equal(ov.buys[1].date, '2026-10-01');
  assert.equal(ov.stops[0].price, 120.16);
  assert.equal(ov.stops[0].label, 'RSL Stop −20 % 120,16');
  assert.match(ov.hint, /RSL Kauf 150,20 2026-11-09/);
  assert.match(ov.hint, /RSL Stop −20 % 120,16/);

  const noDate = parseGpOverlay(['BUY=150.20']);
  assert.equal(noDate.buys[0].date, null);
  assert.equal(noDate.buys[0].label, 'Kauf 150,20');
  assert.equal(noDate.hint, 'Kauf 150,20');

  const noTrail = parseGpOverlay(['STOP=120.16']);
  assert.equal(noTrail.stops[0].label, 'Stop 120,16');
});

test('parseGpOverlay: invalid values are reported, valid lines and the rest stay', () => {
  const ov = parseGpOverlay(['BUY=foo@2026-11-09,150.20@2026-13-40,200', 'STOP=abc,120.16', 'TRAIL=-5', '1Y']);
  assert.ok(ov.errors.some((e) => /BUY-Preis ungültig: foo/.test(e)));
  assert.ok(ov.errors.some((e) => /BUY-Datum ungültig: 150\.20@2026-13-40/.test(e)));
  assert.ok(ov.errors.some((e) => /STOP ungültig: abc/.test(e)));
  assert.ok(ov.errors.some((e) => /TRAIL ungültig/.test(e)));
  assert.equal(ov.buys.length, 2);
  assert.equal(ov.buys[0].price, 150.20);
  assert.equal(ov.buys[0].date, null, 'bad date dropped, line kept');
  assert.equal(ov.buys[1].price, 200);
  assert.equal(ov.stops.length, 1);
  assert.equal(ov.stops[0].price, 120.16);
  assert.match(ov.hint, /Ungültig:/);
});

test('holdingsGpCommand: all lots of a ticker, stop and trail from the table, else plain GP', () => {
  const positions = [
    {id: 'a', symbol: 'VEEV', universe: 'SPX', status: 'open', buyDate: '2026-11-09', buyPrice: 316.85449219, qty: 3.1, trailPct: 20, trailStop: 253.483593752},
    {id: 'b', symbol: 'AAPL', universe: 'SPX', status: 'open', buyDate: '2026-10-01', buyPrice: 180, trailPct: 20, trailStop: 144},
    {id: 'c', symbol: 'VEEV', universe: 'NDX', status: 'open', buyDate: '2026-10-15', buyPrice: 300, trailPct: 20, trailStop: 240},
    {id: 'd', symbol: 'VEEV', universe: 'SPX', status: 'closed', buyDate: '2026-01-01', buyPrice: 200, trailStop: 160},
  ];
  assert.equal(
    holdingsGpCommand('VEEV', positions),
    'VEEV GP BUY=300@2026-10-15,316.85449219@2026-11-09 STOP=240,253.48359375 TRAIL=20 SRC=RSL',
  );
  assert.equal(holdingsGpCommand('MSFT', positions), 'MSFT GP');
  assert.equal(holdingsGpCommand('AAPL', positions), 'AAPL GP BUY=180@2026-10-01 STOP=144 TRAIL=20 SRC=RSL');
  assert.equal(holdingsGpCommand('AAPL', []), 'AAPL GP');
});

test('formatGpCommand and dePrice helpers', () => {
  assert.equal(dePrice(316.85449219), '316,85');
  assert.equal(fmtCmdNum(316.85449219), '316.85449219');
  assert.equal(fmtCmdNum(20), '20');
  assert.equal(
    formatGpCommand('AAPL', {buys: [{price: 150.2, date: '2026-11-09'}], stops: [120.16], trail: 20, src: 'RSL'}),
    'AAPL GP BUY=150.2@2026-11-09 STOP=120.16 TRAIL=20 SRC=RSL',
  );
});
