import { TEST_DATA_DIR, REAL_DATA_DIR } from './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
// Bruchstücke im RSL-Buch, Teilverkauf, DAX→HDAX beim Lesen, P&L-Helfer, Equity-Kurve, EU-Universen, Tastenkürzel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buyPosition, sellPosition, editPosition, loadBook, parseQty, parseNum, openPositions } from '../lib/rsl-watchlist.js';
import { pnlRow, pnlTotals } from '../public/js/fn/rsl-pnl.js';
import { buildEquity, makeFx } from '../lib/fn/rslpnl.js';
import { universe, canonUniverse, UNIVERSES } from '../lib/fn/grokki-universes.js';
import { rrgExitDefaults, BENCHMARKS } from '../lib/fn/grokki-math.js';
import { SHORTCUTS, isTyping } from '../public/js/shortcuts.js';

test('isolated data dir (never the real watchlist)', () => {
  assert.notEqual(path.resolve(TEST_DATA_DIR), path.resolve(REAL_DATA_DIR));
});

test('parseNum / parseQty: comma or dot, fractional, > 0, 6 decimals', () => {
  assert.equal(parseNum('3,25'), 3.25);
  assert.equal(parseNum('1.234,5'), 1234.5);
  assert.equal(parseNum('1,234.5'), 1234.5);
  assert.equal(parseQty('3,25'), 3.25);
  assert.equal(parseQty(10), 10);
  assert.equal(parseQty('0.1234567'), 0.123457);
  assert.equal(parseQty(''), null);
  assert.throws(() => parseQty('0'), /> 0/);
  assert.throws(() => parseQty('-1'), /> 0/);
  assert.throws(() => parseQty('abc'), /Zahl/);
});

test('buy with fractional qty, edit, partial and full sell (temp book)', () => {
  const b = buyPosition({ symbol: 'FRAC', universe: 'SPX', buyDate: '2026-01-05', buyPrice: '100,5', qty: '3,25' });
  assert.equal(b.ok, true);
  assert.equal(b.position.qty, 3.25);
  assert.equal(b.position.buyPrice, 100.5);
  const e = editPosition({ id: b.position.id, qty: '4.5' });
  assert.equal(e.position.qty, 4.5);
  const part = sellPosition({ symbol: 'FRAC', universe: 'SPX', sellDate: '2026-02-01', sellPrice: '110', sellQty: '1,5' });
  assert.equal(part.ok, true); assert.equal(part.partial, true);
  assert.equal(part.position.qty, 1.5); assert.equal(part.position.status, 'closed');
  assert.equal(part.remaining.qty, 3);
  assert.throws(() => sellPosition({ symbol: 'FRAC', universe: 'SPX', sellDate: '2026-02-02', sellQty: '5' }), /Verkaufsmenge/);
  const full = sellPosition({ symbol: 'FRAC', universe: 'SPX', sellDate: '2026-02-03', sellPrice: 120 });
  assert.equal(full.ok, true); assert.equal(full.partial, undefined);
  const book = loadBook();
  const all = book.positions.filter((p) => p.symbol === 'FRAC');
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((p) => p.qty).sort(), [1.5, 3]);
  // integer entries keep working
  const i = buyPosition({ symbol: 'INTG', universe: 'NDX', qty: 10, buyPrice: 50 });
  assert.equal(i.position.qty, 10);
});

test('stored DAX positions are read as HDAX (file not rewritten by reading)', () => {
  const file = path.join(TEST_DATA_DIR, 'rsl-watchlist.json');
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  book.positions.push({ id: 'legacy-1', symbol: 'SAP.DE', universe: 'DAX', status: 'open', buyDate: '2026-01-02', buyPrice: 200, qty: 1 });
  fs.writeFileSync(file, JSON.stringify(book));
  const before = fs.readFileSync(file, 'utf8');
  const open = openPositions(loadBook(), 'HDAX');
  assert.ok(open.some((p) => p.id === 'legacy-1' && p.universe === 'HDAX'));
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'reading must not write the book');
  assert.equal(buyPosition({ symbol: 'SAP.DE', universe: 'DAX' }).duplicated, true, 'DAX input maps to HDAX → duplicate detected');
});

test('pnlRow / pnlTotals: unrealized, realized, fees, fractional, currencies', () => {
  const open = { status: 'open', universe: 'SPX', buyDate: '2026-01-01', buyPrice: 100, qty: 2.5, lastClose: 110 };
  const r = pnlRow(open, { today: '2026-01-11' });
  assert.equal(r.kind, 'open'); assert.equal(r.cur, 'USD');
  assert.ok(Math.abs(r.pnlPct - 10) < 1e-9);
  assert.ok(Math.abs(r.pnlAbs - 24) < 1e-9, '(110−100)×2,5 − 1 Gebühr');
  assert.equal(r.days, 10);
  const closed = { status: 'closed', universe: 'HDAX', buyDate: '2026-01-01', closedDate: '2026-01-31', buyPrice: 50, sellPrice: 40, qty: 1 };
  const c = pnlRow(closed);
  assert.equal(c.cur, 'EUR'); assert.ok(Math.abs(c.pnlAbs - (-12)) < 1e-9); assert.equal(c.days, 30);
  const win = { ...closed, universe: 'SPX', sellPrice: 60 };
  const noQty = { ...open, qty: null };
  assert.equal(pnlRow(noQty).pnlAbs, null);
  const t = pnlTotals([open, closed, win, noQty], { today: '2026-01-11' });
  assert.deepEqual(t.currencies.sort(), ['EUR', 'USD']);
  assert.equal(t.byCur.USD.unrealized, 24); assert.equal(t.byCur.USD.realized, 8);
  assert.equal(t.byCur.EUR.realized, -12);
  assert.equal(t.closed, 2); assert.equal(t.wins, 1); assert.equal(t.winRate, 50); assert.equal(t.missing, 1);
});

test('buildEquity: holdings value + realized P&L, fractional qty, fees, EUR→USD', () => {
  const D = 86400, t0 = Date.UTC(2026, 0, 5) / 1000; // Montag
  const mk = (f) => Array.from({ length: 40 }, (_, i) => ({ time: t0 + i * D, close: f(i) }));
  const pos = [
    { symbol: 'A', universe: 'SPX', buyDate: '2026-01-05', buyPrice: 100, qty: 2.5, status: 'closed', closedDate: '2026-01-15', sellPrice: 110 },
    { symbol: 'B', universe: 'HDAX', buyDate: '2026-01-07', buyPrice: 10, qty: 10, status: 'open' },
  ];
  const seriesBy = new Map([['A', mk((i) => 100 + i)], ['B', mk(() => 12)]]);
  const one = buildEquity({ positions: [pos[0]], seriesBy, benchBars: mk(() => 50), fee: 1, today: t0 + 30 * D });
  assert.equal(one.pnl, 23, '(110−100)×2,5 − 2 Gebühren');
  assert.equal(one.benchPnl, -2, 'flat benchmark loses only the fees');
  assert.equal(one.points[0].deposits, 251);
  assert.equal(one.last.deposits, 0, 'nothing open at the end');
  assert.equal(one.last.equity, 23, 'equity = realized P&L only');
  const fx = makeFx(mk(() => 1.2)); // 1 EUR = 1,20 USD
  const mixed = buildEquity({ positions: pos, seriesBy, benchBars: mk(() => 50), benchCur: 'USD', reportCur: 'USD', fx, fee: 1, today: t0 + 30 * D });
  assert.equal(mixed.trades, 2);
  // B: Einsatz (10×10+1)×1,2 = 121,2 USD; Wert 10×12×1,2 = 144 USD; A realisiert 23
  assert.ok(Math.abs(mixed.last.deposits - 121.2) < 0.01);
  assert.ok(Math.abs(mixed.last.equity - (23 + 144)) < 0.01, 'A: realized 23; B: 10×12×1,2');
  assert.ok(Math.abs(mixed.pnl - (23 + 22.8)) < 0.01, 'P&L = realized + unrealized (144 − 121,2)');
  const skip = buildEquity({ positions: [{ symbol: 'C', universe: 'SPX', buyDate: '2026-01-05', buyPrice: 1 }], seriesBy, benchBars: mk(() => 1) });
  assert.equal(skip.trades, 0); assert.equal(skip.skipped[0].reason, 'Stückzahl fehlt');
});

test('buildEquity: proceeds reinvested on the sell day are not new money; last point uses current prices', () => {
  const D = 86400, t0 = Date.UTC(2026, 0, 5) / 1000;
  const mk = (f) => Array.from({ length: 40 }, (_, i) => ({ time: t0 + i * D, close: f(i) }));
  const pos = [
    { symbol: 'A', universe: 'SPX', buyDate: '2026-01-05', buyPrice: 100, qty: 10, status: 'closed', closedDate: '2026-01-12', sellPrice: 90 },
    { symbol: 'B', universe: 'SPX', buyDate: '2026-01-12', buyPrice: 50, qty: 18, status: 'open' },
  ];
  const seriesBy = new Map([['A', mk(() => 90)], ['B', mk(() => 50)]]);
  const r = buildEquity({ positions: pos, seriesBy, benchBars: mk(() => 50), fee: 1, today: t0 + 14 * D, nowPx: new Map([['B', 55]]) });
  // A: −100 − 2 Gebühren realisiert; B: Einsatz 901, Wert 18 × 55 = 990
  assert.equal(r.last.deposits, 901);
  assert.equal(r.last.equity, 990 - 102);
  assert.equal(r.pnl, -102 + 89);
  assert.equal(r.points.at(-2).equity, 900 - 102, 'earlier days use the daily close');
});

test('EU universes: HDAX replaces DAX tab, STOXX 600 added, research defaults', () => {
  assert.equal(canonUniverse('DAX'), 'HDAX');
  assert.equal(canonUniverse('stoxx600'), 'SXXP');
  const h = universe({ universe: 'DAX' });
  assert.equal(h.key, 'HDAX'); assert.equal(h.tickers.length, 102); assert.equal(h.bench, '^GDAXI');
  const x = universe({ universe: 'SXXP' });
  assert.ok(x.tickers.length >= 600); assert.equal(x.bench, '^STOXX'); assert.ok(x.eur);
  assert.equal(UNIVERSES.DAX.length, 40, 'old DAX-40 roster kept for membership tags');
  assert.deepEqual(rrgExitDefaults('HDAX'), { mode: 'RANK', rankTop: 10 });
  assert.deepEqual(rrgExitDefaults('SXXP'), { mode: 'OFF', rankTop: 25 });
  assert.equal(BENCHMARKS.SXXP, '^STOXX'); assert.equal(BENCHMARKS.HDAX, '^GDAXI');
  assert.throws(() => universe({ universe: 'SXXP' }, ['SPX', 'NDX']), /universe/);
});

test('shortcut overview covers every key handled in app.js', () => {
  const keys = SHORTCUTS.map((s) => s[1]).join(' | ');
  for (const k of ['Enter', '/', 'Tab', 'Esc', '◂', 'Strg/Cmd + 1 … 4', 'F1', '?', 'F2', 'F8', 'F9', 'F10', 'F11']) assert.ok(keys.includes(k), k);
  const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  for (const k of ['"Escape"', '"ArrowDown"', '"Tab"', '"Enter"', '"F1"', '"/"', '"?"']) assert.ok(app.includes(k), k);
  assert.equal(isTyping({ tagName: 'input' }), true);
  assert.equal(isTyping({ tagName: 'DIV' }), false);
});
