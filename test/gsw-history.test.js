import { TEST_DATA_DIR, REAL_DATA_DIR } from './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
// GSW: Signal/Aktion je Lot (lib/gsw/advice.js), Historie/Equity des Buchs (lib/gsw/history.js), Gebühren + Validierung im Buch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.QT_OFFLINE = '1';
const { lotAction } = await import('../lib/gsw/advice.js');
const { bookEquity, closedRow, asOfFn } = await import('../lib/gsw/history.js');
const book = await import('../lib/gsw/book.js');
const { start } = await import('../server.js');

const FILE = path.join(TEST_DATA_DIR, 'gsw-book.json');
const reset = () => fs.rmSync(FILE, { force: true });
let server, base;
before(async () => { const s = await start(43000 + Math.floor(Math.random() * 1000)); server = s.server; base = `http://127.0.0.1:${s.port}`; });
after(() => { server.close(); reset(); });
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'x-qt': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const P = { U1: 90, L1: 82, S: 100, L2: 66 };

test('isolierter Datenordner', () => { assert.notEqual(path.resolve(TEST_DATA_DIR), path.resolve(REAL_DATA_DIR)); });

test('Signal/Aktion: fällig, wenn Buch-Metall von der Regel abweicht', () => {
  const st = { pos: 'gold', spike: false, sig: 91.2, due: { due: 'silver', rule: 'sig 91.20 > U1 90' }, P };
  const a = lotAction({ metal: 'gold' }, st);
  assert.equal(a.level, 'due'); assert.equal(a.text, 'Swap fällig → Silber (sig 91,2 > 90)'); assert.equal(a.target, 'silver');
  // gleiches Lot, Regel seit Wochen in Silber (kein heutiges Signal)
  const b = lotAction({ metal: 'gold' }, { pos: 'silver', spike: false, sig: 86, due: { due: null }, P, since: '2026-10-05' });
  assert.equal(b.text, 'Swap fällig → Silber (Regel seit 05.10.2026 in Silber)');
  // Haltefrist läuft
  const h = lotAction({ metal: 'gold', inHold: true, taxFreeFrom: '2027-03-02' }, st);
  assert.equal(h.level, 'hold'); assert.equal(h.text, 'Swap fällig – Haltefrist bis 02.03.2027'); assert.match(h.dist, /Silber \(sig 91,2 > 90\)/);
  // zurück in Gold
  const g = lotAction({ metal: 'silver' }, { pos: 'silver', spike: false, sig: 80.5, due: { due: 'gold' }, P });
  assert.equal(g.text, 'Swap fällig → Gold (sig 80,5 < 82)');
  const g2 = lotAction({ metal: 'silver' }, { pos: 'silver', spike: true, sig: 65, due: { due: 'gold' }, P });
  assert.equal(g2.text, 'Swap fällig → Gold (sig 65,0 < 66)');
});

test('Signal/Aktion: halten mit Abstand zur nächsten Schwelle, Spike', () => {
  const a = lotAction({ metal: 'gold' }, { pos: 'gold', spike: false, sig: 86.6, due: { due: null }, P });
  assert.equal(a.level, 'ok'); assert.equal(a.text, 'Halten (Gold)'); assert.equal(a.dist, 'noch 3,4 bis U1 90 (→ Silber)');
  const s = lotAction({ metal: 'silver' }, { pos: 'silver', spike: false, sig: 85, due: { due: null }, P });
  assert.equal(s.text, 'Halten (Silber)'); assert.equal(s.dist, 'noch 3,0 bis L1 82 (→ Gold) · 15,0 bis S 100 (Spike)');
  const sp = lotAction({ metal: 'silver' }, { pos: 'silver', spike: true, sig: 96, due: { due: null }, P });
  assert.equal(sp.level, 'spike'); assert.equal(sp.text, 'Spike aktiv: halten bis sig < 66'); assert.equal(sp.dist, 'noch 30,0 bis 66');
  // Buch schon im Zielmetall eines heutigen Signals
  const ah = lotAction({ metal: 'silver' }, { pos: 'gold', spike: false, sig: 91, due: { due: 'silver' }, P });
  assert.equal(ah.level, 'ok'); assert.match(ah.text, /Halten \(Silber\)/);
});

const days = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12'];
const px = { GLD: [100, 101, 102, 103, 104, 105], SLV: [20, 20, 21, 22, 22, 23] };
const closeOf = (s, d) => asOfFn(days, px[s])(d);

test('Equity: Kauf, Kursänderung, Einzahlungen', () => {
  const r = bookEquity({ lots: [{ symbol: 'GLD', qty: 10, buyPrice: 100, buyDate: '2026-01-05', buyFees: 2, status: 'open' }], days, closeOf });
  assert.equal(r.points[0].deposits, 1002); assert.equal(r.points[0].equity, 1000);
  assert.equal(r.points.at(-1).equity, 1050); assert.equal(r.deposits, 1002);
});

test('Equity: Swap (Verkauf + Kauf am selben Tag) braucht keine neue Einzahlung; Gebühren mindern die Equity', () => {
  const lots = [
    { symbol: 'GLD', qty: 10, buyPrice: 100, buyDate: '2026-01-05', status: 'closed', sellDate: '2026-01-07', sellPrice: 102, sellFees: 1.02, swapId: 'x', sellSwapId: 'x' },
    { symbol: 'SLV', qty: 48.4, buyPrice: 21, buyDate: '2026-01-07', status: 'open', buyFees: 1.0188, swapId: 'x', buySwapId: 'x' },
  ];
  const r = bookEquity({ lots, days, closeOf });
  const at = (d) => r.points.find((p) => p.date === d);
  assert.equal(at('2026-01-07').deposits, 1000);
  // Erlös 1020 − 1,02 = 1018,98; Kauf 48,4 × 21 + 1,0188 = 1017,4188 → Rest-Cash 1,5612
  assert.equal(at('2026-01-07').cash, 1.56);
  assert.equal(at('2026-01-12').equity, Math.round((48.4 * 23 + 1.5612) * 100) / 100);
});

test('Equity: Wochenend-Buchung am nächsten Handelstag, gleicher Tag Kauf+Verkauf, Teilverkauf, Zwillinge', () => {
  const lots = [
    { symbol: 'GLD', qty: 5, buyPrice: 100, buyDate: '2026-01-04', status: 'open' }, // Sonntag
    { symbol: 'GLD', qty: 5, buyPrice: 100, buyDate: '2026-01-04', status: 'closed', sellDate: '2026-01-08', sellPrice: 103, parentId: 'p' },
    { symbol: 'SLV', qty: 1, buyPrice: 21, buyDate: '2026-01-07', status: 'closed', sellDate: '2026-01-07', sellPrice: 21 },
  ];
  const idx = asOfFn(days, [10, 11, 12, 13, 14, 15]);
  const r = bookEquity({ lots, days, closeOf, twins: { rule: idx } });
  const at = (d) => r.points.find((p) => p.date === d);
  assert.equal(r.points[0].date, '2026-01-05');
  assert.equal(at('2026-01-05').deposits, 1000); assert.equal(at('2026-01-05').equity, 1000);
  assert.equal(at('2026-01-07').deposits, 1021); assert.equal(at('2026-01-07').cash, 21); // Kauf+Verkauf gleicher Tag
  assert.equal(at('2026-01-08').equity, 5 * 103 + 515 + 21);
  // Zwilling: 1000 am 05.01. (Index 10, Sonntag as-of → kein Wert davor → Handelstag), 21 am 07.01. (Index 12)
  assert.equal(at('2026-01-12').rule, Math.round((1000 / 10 + 21 / 12) * 15 * 100) / 100);
});

test('Equity: Buy & Hold Gold und Silber mit denselben Einzahlungen (inkl. Gebühren), Swap ohne neue Einzahlung', () => {
  const lots = [
    { symbol: 'GLD', qty: 10, buyPrice: 100, buyDate: '2026-01-05', buyFees: 2, status: 'closed', sellDate: '2026-01-07', sellPrice: 102, sellFees: 1, swapId: 'x', sellSwapId: 'x' },
    { symbol: 'SLV', qty: 48, buyPrice: 21, buyDate: '2026-01-07', buyFees: 1, status: 'open', swapId: 'x', buySwapId: 'x' },
    { symbol: 'GLD', qty: 2, buyPrice: 103, buyDate: '2026-01-08', status: 'open' },
  ];
  const twins = { bhGold: asOfFn(days, px.GLD), bhSilver: asOfFn(days, px.SLV) };
  const r = bookEquity({ lots, days, closeOf, twins });
  const at = (d) => r.points.find((p) => p.date === d);
  // Einzahlungen: 1002 am 05.01. (inkl. Kaufgebühr), Swap aus Cash (1019 − 1009 = 10 Rest), 206 − 10 = 196 am 08.01.
  assert.equal(at('2026-01-07').deposits, 1002); assert.equal(at('2026-01-08').deposits, 1198);
  for (const p of r.points) { assert.ok('bhSilver' in p && 'bhGold' in p); }
  assert.equal(at('2026-01-05').bhSilver, 1002);
  assert.equal(at('2026-01-07').bhSilver, Math.round((1002 / 20) * 21 * 100) / 100, 'Swap ohne Einzahlung kauft nichts nach');
  assert.equal(at('2026-01-12').bhSilver, Math.round((1002 / 20 + 196 / 22) * 23 * 100) / 100);
  assert.equal(at('2026-01-12').bhGold, Math.round((1002 / 100 + 196 / 103) * 105 * 100) / 100);
  assert.notEqual(at('2026-01-12').bhSilver, at('2026-01-12').bhGold);
});

test('Historie-Service: B&H-Silber-Zwilling aus dem Silber-Bein des Paars, in stats und pair', () => {
  const src = fs.readFileSync(new URL('../lib/gsw/service.js', import.meta.url), 'utf8');
  assert.match(src, /twins\.bhSilver = asOfFn\(ds\.dates, Array\.from\(ds\.ps\)\)/);
  assert.match(src, /bhSilver: last\.bhSilver \?\? null/);
  assert.match(src, /silver: pair\.silver/);
});

test('Historien-Zeile: G/V nach Gebühren, Haltedauer, steuerfrei ab, Art', () => {
  const r = closedRow({ qty: 2, buyPrice: 100, sellPrice: 110, buyDate: '2025-02-28', sellDate: '2026-03-02', buyFees: 1, sellFees: 1, swapId: 's' });
  assert.equal(r.pnl, 18); assert.equal(r.fees, 2); assert.equal(r.holdDaysHeld, 367); assert.equal(r.taxFreeFrom, '2026-03-01'); assert.equal(r.soldTaxFree, true); assert.equal(r.exitKind, 'Swap');
  assert.equal(closedRow({ qty: 1, buyPrice: 1, sellPrice: 2, buyDate: '2026-01-01', sellDate: '2026-02-01' }).exitKind, 'Verkauf');
});

test('Buch: Gebühren (Kauf per Betrag, Verkauf, Swap), Validierung, atomar, Löschen', () => {
  reset();
  const b1 = book.buy({ metal: 'gold', symbol: 'GLD', amount: 1000, costPct: 0.1, buyPrice: 100, buyDate: '2026-01-05', currency: 'USD' });
  assert.equal(b1.lot.buyFees, 1); assert.equal(b1.lot.qty, 9.99);
  const b2 = book.buy({ metal: 'gold', symbol: 'GLD', qty: 1, buyPrice: 100, buyDate: '2026-01-06', buyFees: '2,5' });
  assert.equal(b2.lot.buyFees, 2.5);
  assert.throws(() => book.buy({ metal: 'gold', symbol: 'GLD', qty: 1, buyPrice: 100, buyDate: '2026-01-06', buyFees: '-1' }), /Kaufgebühr/);
  // Verkauf vor Kauf → Fehler, Datei unverändert
  const before = fs.readFileSync(FILE, 'utf8');
  assert.throws(() => book.sell({ id: b2.lot.id, sellPrice: 101, sellDate: '2026-01-01' }), /vor dem Kaufdatum/);
  assert.equal(fs.readFileSync(FILE, 'utf8'), before);
  // Teilverkauf: Kaufgebühr anteilig
  const s = book.sell({ id: b2.lot.id, qty: 0.4, sellPrice: 110, sellDate: '2026-01-08', sellFees: 0.5 });
  assert.equal(s.lot.buyFees, 1); assert.equal(s.lot.sellFees, 0.5);
  assert.equal(book.loadBook().lots.find((l) => l.id === b2.lot.id).buyFees, 1.5);
  // Edit eines geschlossenen Lots: Datum/Kurs/Stück/Gebühren/Notiz
  const e = book.edit({ id: s.lot.id, sellDate: '2026-01-09', sellPrice: '111', qty: '0,4', buyFees: '', sellFees: '0,7', note: 'korr.' });
  assert.equal(e.lot.sellDate, '2026-01-09'); assert.equal(e.lot.sellPrice, 111); assert.equal(e.lot.buyFees, undefined); assert.equal(e.lot.sellFees, 0.7); assert.equal(e.lot.note, 'korr.');
  const before2 = fs.readFileSync(FILE, 'utf8');
  assert.throws(() => book.edit({ id: s.lot.id, sellDate: '2025-12-31' }), /vor dem Kaufdatum/);
  assert.equal(fs.readFileSync(FILE, 'utf8'), before2);
  assert.equal(book.loadBook().lots.find((l) => l.id === s.lot.id).sellDate, '2026-01-09');
  assert.ok(!fs.readdirSync(TEST_DATA_DIR).some((f) => f.endsWith('.tmp')), 'keine tmp-Reste (atomar: tmp + rename)');
  // Swap bucht die Kosten als Gebühren
  const sw = book.swap({ from: 'gold', date: '2026-01-12', prices: { GLD: 105 }, toSymbol: 'SLV', toPrice: 23, costPct: 0.1, currency: 'USD' });
  const closed = book.loadBook().lots.filter((l) => l.sellSwapId === sw.swap.swapId);
  assert.equal(closed.length, 2);
  for (const l of closed) assert.equal(l.sellFees, Math.round(l.qty * 105 * 0.001 * 1e4) / 1e4);
  assert.equal(sw.lot.buySwapId, sw.swap.swapId); assert.equal(sw.lot.buyFees, Math.round(sw.swap.net * 0.001 * 1e4) / 1e4);
  // Erlös − Verkaufsgebühren = Kaufkosten inkl. Gebühr (bis auf Rundung) → keine neue Einzahlung in der Equity
  const proceeds = closed.reduce((a, l) => a + l.qty * l.sellPrice - l.sellFees, 0);
  assert.ok(Math.abs(proceeds - (sw.lot.qty * sw.lot.buyPrice + sw.lot.buyFees)) < 0.01);
  // Wieder öffnen entfernt Verkaufsfelder, Löschen entfernt das Lot
  const ro = book.reopen({ id: closed[0].id });
  assert.equal(ro.lot.sellFees, undefined); assert.equal(ro.lot.sellSwapId, undefined);
  book.remove({ id: closed[0].id });
  assert.ok(!book.loadBook().lots.some((l) => l.id === closed[0].id));
});

test('API: EDIT/DELETE über /api/gsw/book mit Validierung; /api/gsw/history liest nur', async () => {
  reset();
  const b = await call('POST', '/api/gsw/book', { action: 'BUY', metal: 'silver', symbol: 'SLV', qty: 3, buyPrice: 20, buyDate: '2026-01-05' });
  assert.equal(b.status, 200);
  const s = await call('POST', '/api/gsw/book', { action: 'SELL', id: b.body.lot.id, sellPrice: 22, sellDate: '2026-01-09' });
  assert.equal(s.status, 200);
  const bad = await call('POST', '/api/gsw/book', { action: 'EDIT', id: b.body.lot.id, sellDate: '2026-01-01' });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /vor dem Kaufdatum/);
  const bad2 = await call('POST', '/api/gsw/book', { action: 'EDIT', id: b.body.lot.id, sellFees: 'abc' });
  assert.equal(bad2.status, 400);
  const before = fs.readFileSync(FILE, 'utf8'), mt = fs.statSync(FILE).mtimeMs;
  const h = await call('GET', '/api/gsw/history');
  assert.equal(h.status, 200); assert.equal(h.body.currency, 'USD'); assert.ok(Array.isArray(h.body.points)); assert.match(h.body.method, /Einzahlung/);
  assert.equal(fs.readFileSync(FILE, 'utf8'), before); assert.equal(fs.statSync(FILE).mtimeMs, mt);
  const del = await call('POST', '/api/gsw/book', { action: 'DELETE', id: b.body.lot.id });
  assert.equal(del.status, 200); assert.equal(del.body.closed.length, 0);
  reset();
  const empty = await call('GET', '/api/gsw/history');
  assert.deepEqual(empty.body.points, []); assert.ok(!fs.existsSync(FILE));
});
