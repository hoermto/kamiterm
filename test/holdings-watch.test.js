import { TEST_DATA_DIR, REAL_DATA_DIR } from './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
// W:HOLD: virtuelle Auto-Watchlist aller gehaltenen Symbole (RSL-Buch, GSW-Buch, PORT), live berechnet, nie gespeichert.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.QT_OFFLINE = '1';
const store = await import('../lib/store.js');
const H = await import('../lib/holdings.js');
const rsl = await import('../lib/rsl-watchlist.js');
const gswBook = await import('../lib/gsw/book.js');
const { fvUniverse } = await import('../lib/fn/fvscan.js');
const W = await import('../public/js/fn/workspace.js');
const { parse } = await import('../public/js/commands.js');
const { start } = await import('../server.js');

const F = (n) => path.join(TEST_DATA_DIR, `${n}.json`);
const reset = () => { for (const n of ['rsl-watchlist', 'gsw-book', 'state']) fs.rmSync(F(n), { force: true }); };
// Schnappschuss aller Dateien im Datenordner: Inhalt und mtime.
const snap = () => Object.fromEntries(fs.readdirSync(TEST_DATA_DIR).filter((f) => f.endsWith('.json')).map((f) => { const p = path.join(TEST_DATA_DIR, f); return [f, `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p, 'utf8')}`]; }));

let server, base;
before(async () => { const s = await start(42000 + Math.floor(Math.random() * 1000)); server = s.server; base = `http://127.0.0.1:${s.port}`; });
after(() => { server.close(); reset(); });

test('isolierter Datenordner', () => { assert.notEqual(path.resolve(TEST_DATA_DIR), path.resolve(REAL_DATA_DIR)); });

test('ohne Bücher: leere Liste, alle drei Quellen gemeldet, nichts geschrieben', () => {
  reset();
  const before = snap();
  const h = H.holdList();
  assert.equal(h.name, 'HOLD'); assert.equal(h.virtual, true); assert.equal(h.readOnly, true);
  assert.deepEqual(h.codes, []);
  assert.deepEqual(h.providers.map((p) => [p.id, p.count, p.error]), [['RSL', 0, null], ['GSW', 0, null], ['PORT', 0, null]]);
  assert.deepEqual(snap(), before);
  assert.ok(!fs.existsSync(F('state')) && !fs.existsSync(F('rsl-watchlist')) && !fs.existsSync(F('gsw-book')));
});

test('Aggregation: offene Positionen/Lots aller Quellen, geschlossene nicht, dedupliziert mit gesammelten Quellen', () => {
  reset();
  store.write('rsl-watchlist', { version: 2, positions: [
    { id: 'a', symbol: 'AAPL', universe: 'SPX', status: 'open', buyDate: '2026-10-01', qty: 3 },
    { id: 'b', symbol: 'SAP.DE', universe: 'DAX', status: 'open', buyDate: '2026-10-01', qty: 2 },
    { id: 'c', symbol: 'MSFT', universe: 'SPX', status: 'closed', buyDate: '2026-09-01', closedDate: '2026-10-01' },
  ] });
  store.write('gsw-book', { version: 1, lots: [
    { id: 'g1', metal: 'gold', symbol: '8PSG.DE', qty: 10, status: 'open' },
    { id: 'g2', metal: 'gold', symbol: '8PSG.DE', qty: 5, status: 'open' },
    { id: 's1', metal: 'silver', symbol: '8PSB.DE', qty: 7, status: 'closed' },
  ] });
  store.write('state', { amberPort: [{ sec: 'AAPL', shares: 4, cost: 100 }, { sec: 'VOD LN', shares: 0, cost: 1 }], amberWatch: { lists: { MAIN: ['NVDA US EQUITY'] }, active: 'MAIN' } });
  const before = snap();
  const h = H.holdList();
  assert.deepEqual(h.codes, ['8PSG GR EQUITY', 'AAPL US EQUITY', 'SAP GR EQUITY']);
  const row = (c) => h.rows.find((r) => r.code === c);
  assert.deepEqual(row('AAPL US EQUITY').sources.map((s) => [s.id, s.source, s.qty]), [['RSL', 'RSL SPX', 3], ['PORT', 'PORT', 4]]);
  assert.deepEqual(row('8PSG GR EQUITY').sources.map((s) => [s.id, s.source, s.qty]), [['GSW', 'GSW Gold', 15]]);
  assert.equal(row('SAP GR EQUITY').sources[0].source, 'RSL HDAX');
  assert.equal(row('SAP GR EQUITY').yahoo, 'SAP.DE');
  assert.equal(W.holdSources(row('AAPL US EQUITY')), 'RSL SPX 3 · PORT 4');
  assert.deepEqual(snap(), before, 'holdList darf keine Datei anfassen');
});

test('RSL-Buch im alten Format: Migration nur im Speicher, Datei bleibt unverändert', () => {
  reset();
  store.write('rsl-watchlist', { positions: [{ symbol: 'aapl', buyDate: '2026-10-01' }] }); // ohne version/status/universe
  const before = snap();
  assert.deepEqual(H.holdList().codes, ['AAPL US EQUITY']);
  assert.deepEqual(snap(), before);
});

test('Nachziehen: Kauf/Verkauf in RSL- und GSW-Buch ändern W:HOLD beim nächsten Abruf (auch über die API)', async () => {
  reset();
  const get = async () => (await (await fetch(`${base}/api/watch/hold`, { headers: { 'x-qt': '1' } })).json());
  assert.deepEqual((await get()).codes, []);
  const r = rsl.buyPosition({ symbol: 'NVDA', universe: 'NDX', buyDate: '2026-11-20', buyPrice: 100, qty: 1 });
  assert.ok(r.ok !== false, r.message);
  assert.deepEqual((await get()).codes, ['NVDA US EQUITY']);
  const g = gswBook.buy({ metal: 'silver', symbol: 'SLV', qty: 2, buyPrice: 30, buyDate: '2026-11-20' });
  assert.deepEqual((await get()).codes, ['NVDA US EQUITY', 'SLV US EQUITY']);
  const before = snap();
  await get(); await get();
  assert.deepEqual(snap(), before, 'GET /api/watch/hold schreibt nichts');
  assert.ok(!fs.existsSync(F('state')), 'state.json wird nicht angelegt');
  gswBook.sell({ id: g.lot.id, sellPrice: 31, sellDate: '2026-11-21' });
  assert.deepEqual((await get()).codes, ['NVDA US EQUITY']);
  rsl.sellPosition({ symbol: 'NVDA', sellDate: '2026-11-21', sellPrice: 110 });
  assert.deepEqual((await get()).codes, []);
});

test('Fehler in einer Quelle: gemeldet, die anderen bleiben', () => {
  reset();
  store.write('gsw-book', { version: 1, lots: [{ metal: 'gold', symbol: 'GLD', qty: 1, status: 'open' }] });
  const off = H.registerHoldingProvider({ id: 'BROKEN', label: 'Kaputt', list() { throw new Error('kaputt'); } });
  try {
    const h = H.holdList();
    assert.deepEqual(h.codes, ['GLD US EQUITY']);
    assert.equal(h.providers.find((p) => p.id === 'BROKEN').error, 'kaputt');
  } finally { off(); }
  assert.ok(!H.holdingProviders().some((p) => p.id === 'BROKEN'));
});

test('Erweiterbar: eigener Provider mit Wörtern statt Yahoo-Symbol', () => {
  reset();
  const off = H.registerHoldingProvider({ id: 'X', label: 'Test', list: () => [{ words: ['VOD', 'LN'], source: 'Test', qty: 1 }] });
  try { assert.deepEqual(H.holdList().codes, ['VOD LN EQUITY']); } finally { off(); }
});

test('FVSCAN W:HOLD nutzt die Holdings, W-Listen bleiben unberührt', () => {
  reset();
  store.write('rsl-watchlist', { version: 2, positions: [{ id: 'a', symbol: 'AAPL', universe: 'SPX', status: 'open', buyDate: '2026-10-01' }] });
  store.write('state', { amberWatch: { lists: { MAIN: ['NVDA US EQUITY'] }, active: 'MAIN' } });
  const before = snap();
  const u = fvUniverse('W:HOLD');
  assert.equal(u.key, 'W:HOLD');
  assert.deepEqual(u.tickers, ['AAPL']);
  assert.ok(u.lists.includes('HOLD') && u.lists.includes('MAIN'));
  assert.deepEqual(fvUniverse('W').tickers, ['NVDA']);
  assert.ok(fvUniverse('SPX').lists.includes('HOLD'));
  assert.deepEqual(snap(), before);
});

test('Client: W:HOLD-Befehle, Schreibschutz, reservierter Name', () => {
  assert.deepEqual(parse('W:HOLD'), { fn: 'W', sec: null, args: ['W:HOLD'] });
  assert.deepEqual(W.holdCommand(['W:HOLD'], ['MAIN']), { show: true });
  assert.deepEqual(W.holdCommand(['hold'], ['MAIN']), { show: true });
  assert.equal(W.holdCommand(['MAIN'], ['MAIN']), null);
  assert.equal(W.holdCommand([], ['MAIN']), null);
  assert.match(W.holdCommand(['HOLD', 'ADD', 'NVDA'], ['MAIN']).error, /nicht bearbeiten/);
  assert.match(W.holdCommand(['W:HOLD', 'DEL', 'AAPL'], ['MAIN']).error, /nicht bearbeiten/);
  assert.equal(W.holdCommand(['HOLD'], ['MAIN', 'HOLD']), null, 'alte eigene Liste HOLD hat bei W HOLD Vorrang');
  assert.deepEqual(W.holdCommand(['W:HOLD'], ['MAIN', 'HOLD']), { show: true });
  const st = W.watchState({ lists: { MAIN: [] }, active: 'MAIN' });
  assert.match(W.applyWatch(st, { op: 'NEW', name: 'HOLD' }).error, /command word/);
  assert.match(W.applyWatch(st, { op: 'RENAME', name: 'MAIN', to: 'HOLD' }).error, /command word/);
});
