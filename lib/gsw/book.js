// GSW-Buch (eigene Datei data/gsw-book.json, getrennt vom RSL-Buch). Lots je Metall, Bruchstücke erlaubt.
// Aktionen: BUY/ADD, SELL (auch Teilverkauf), EDIT, DELETE, REOPEN, SWAP (alle offenen Lots eines Metalls verkaufen,
// Erlös nach Kosten vollständig ins andere Metall).
import crypto from 'node:crypto';
import * as store from '../store.js';
import { parseNum, parseQty, parseIsoDate } from '../rsl-watchlist.js';

const NAME = 'gsw-book';
const err = (m) => Object.assign(new Error(m), { status: 400 });
export const emptyBook = () => ({ version: 1, updatedAt: null, lots: [] });
export function loadBook() {
  const b = store.read(NAME, null);
  return b && Array.isArray(b.lots) ? b : emptyBook();
}
function save(book) { book.updatedAt = new Date().toISOString(); store.write(NAME, book); return book; }

const METALS = ['gold', 'silver'];
const metalOf = (v) => { const m = String(v || '').toLowerCase(); const x = m.startsWith('g') ? 'gold' : m.startsWith('s') ? 'silver' : null; if (!x) throw err('Metall muss gold oder silver sein'); return x; };
const sym = (v) => { const s = String(v || '').trim().toUpperCase(); if (!/^[A-Z0-9^][A-Z0-9._=^-]{0,19}$/.test(s)) throw err('Symbol ungültig'); return s; };
const price = (v, label) => { const n = parseNum(v); if (!Number.isFinite(n) || n <= 0) throw err(`${label} muss eine Zahl > 0 sein`); return n; };
const cur = (v) => { const c = String(v || 'USD').trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) throw err('Währung als ISO-Code'); return c; };
// Gebühren je Lot absolut in Lot-Währung (Kauf: buyFees, Verkauf: sellFees); leer = 0.
const fee = (v, label) => { if (v == null || v === '') return 0; const n = parseNum(v); if (!Number.isFinite(n) || n < 0 || n > 1e7) throw err(`${label} muss eine Zahl ≥ 0 sein`); return Math.round(n * 1e4) / 1e4; };
const has = (input, k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
const checkDates = (l) => { if (l.status === 'closed' && l.sellDate && l.buyDate && l.sellDate < l.buyDate) throw err('Verkaufsdatum liegt vor dem Kaufdatum'); };
const costPct = (v) => { if (v == null || v === '') return 0.1; const n = parseNum(v); if (!Number.isFinite(n) || n < 0 || n > 5) throw err('Kosten 0–5 %'); return n; };

export const openLots = (b) => b.lots.filter((l) => l.status === 'open');
export const closedLots = (b) => b.lots.filter((l) => l.status === 'closed').sort((a, b2) => String(b2.sellDate).localeCompare(String(a.sellDate)));

export function buy(input = {}) {
  const book = loadBook();
  const bp = price(input.buyPrice, 'Kaufkurs');
  let qty = parseQty(input.qty, 'Stück');
  let fees = fee(input.buyFees, 'Kaufgebühr');
  if (qty == null && input.amount != null && input.amount !== '') {
    const a = price(input.amount, 'Betrag'), k = costPct(input.costPct) / 100;
    qty = Math.round((a * (1 - k) / bp) * 1e6) / 1e6;
    if (!has(input, 'buyFees') || input.buyFees === '') fees = Math.round(a * k * 1e4) / 1e4; // Kosten vom Betrag abgezogen
  }
  if (qty == null) throw err('Stück oder Betrag angeben');
  const lot = { id: crypto.randomUUID(), metal: metalOf(input.metal), symbol: sym(input.symbol), qty, buyPrice: bp, buyDate: parseIsoDate(input.buyDate, 'Kaufdatum'), currency: cur(input.currency), note: String(input.note ?? '').slice(0, 200), status: 'open' };
  if (fees > 0) lot.buyFees = fees;
  book.lots.push(lot); save(book);
  return { ok: true, message: `Kauf ${lot.symbol} ${lot.qty} @ ${lot.buyPrice}`, lot, book };
}

const find = (book, id) => { const l = book.lots.find((x) => x.id === String(id || '')); if (!l) throw err(`Kein Lot mit id ${id}`); return l; };

export function sell(input = {}) {
  const book = loadBook(); const l = find(book, input.id);
  if (l.status !== 'open') throw err('Lot ist nicht offen');
  const sp = price(input.sellPrice, 'Verkaufskurs'), sd = parseIsoDate(input.sellDate, 'Verkaufsdatum');
  const q = input.qty == null || input.qty === '' ? l.qty : parseQty(input.qty, 'Stück');
  if (q > l.qty + 1e-9) throw err(`Nur ${l.qty} Stück offen`);
  if (l.buyDate && sd < l.buyDate) throw err('Verkaufsdatum liegt vor dem Kaufdatum');
  const sf = fee(input.sellFees, 'Verkaufsgebühr');
  let closed = l, partial = false;
  if (q < l.qty - 1e-9) {
    partial = true;
    closed = { ...l, id: crypto.randomUUID(), qty: q, parentId: l.id };
    // Kaufgebühr anteilig auf den verkauften Teil
    if (l.buyFees) { closed.buyFees = Math.round(l.buyFees * (q / l.qty) * 1e4) / 1e4; l.buyFees = Math.round((l.buyFees - closed.buyFees) * 1e4) / 1e4; }
    l.qty = Math.round((l.qty - q) * 1e6) / 1e6; book.lots.push(closed);
  }
  Object.assign(closed, { status: 'closed', sellPrice: sp, sellDate: sd });
  if (sf > 0) closed.sellFees = sf;
  save(book);
  return { ok: true, partial, message: `Verkauf ${closed.symbol} ${closed.qty} @ ${sp}${partial ? ' (Teilverkauf)' : ''}`, lot: closed, book };
}

export function edit(input = {}) {
  const book = loadBook(); const l = find(book, input.id);
  const before = JSON.stringify(l);
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  if (has('metal')) l.metal = metalOf(input.metal);
  if (has('symbol')) l.symbol = sym(input.symbol);
  if (has('qty')) l.qty = parseQty(input.qty, 'Stück') ?? l.qty;
  if (has('buyPrice')) l.buyPrice = price(input.buyPrice, 'Kaufkurs');
  if (has('buyDate')) l.buyDate = parseIsoDate(input.buyDate, 'Kaufdatum');
  if (has('currency')) l.currency = cur(input.currency);
  if (has('note')) l.note = String(input.note ?? '').slice(0, 200);
  if (has('buyFees')) { const f = fee(input.buyFees, 'Kaufgebühr'); if (f > 0) l.buyFees = f; else delete l.buyFees; }
  if (l.status === 'closed') {
    if (has('sellPrice')) l.sellPrice = price(input.sellPrice, 'Verkaufskurs');
    if (has('sellDate')) l.sellDate = parseIsoDate(input.sellDate, 'Verkaufsdatum');
    if (has('sellFees')) { const f = fee(input.sellFees, 'Verkaufsgebühr'); if (f > 0) l.sellFees = f; else delete l.sellFees; }
  }
  try { checkDates(l); } catch (e) { Object.assign(l, JSON.parse(before)); throw e; }
  save(book);
  return { ok: true, message: `Lot ${l.symbol} geändert`, lot: l, book };
}

export function remove(input = {}) {
  const book = loadBook(); const l = find(book, input.id);
  book.lots = book.lots.filter((x) => x !== l); save(book);
  return { ok: true, message: `Lot ${l.symbol} gelöscht`, lot: l, book };
}

export function reopen(input = {}) {
  const book = loadBook(); const l = find(book, input.id);
  if (l.status !== 'closed') throw err('Lot ist nicht geschlossen');
  l.status = 'open'; delete l.sellPrice; delete l.sellDate; delete l.sellFees; delete l.sellSwapId; save(book);
  return { ok: true, message: `Lot ${l.symbol} wieder offen`, lot: l, book };
}

/**
 * Swap: alle offenen Lots von `from` (gold|silver) zu prices[symbol] verkaufen; Erlös × (1−k) → Kauf von toSymbol zu toPrice
 * mit Stück = Erlös × (1−k) / toPrice (k = Kosten je Seite, Standard 0,1 % wie im Backtest). Ein Schritt, eine swapId.
 */
export function swap(input = {}) {
  const book = loadBook();
  const from = metalOf(input.from), to = from === 'gold' ? 'silver' : 'gold';
  const lots = openLots(book).filter((l) => l.metal === from);
  if (!lots.length) throw err(`Keine offenen ${from === 'gold' ? 'Gold' : 'Silber'}-Lots für den Swap`);
  const date = parseIsoDate(input.date, 'Datum'), k = costPct(input.costPct) / 100;
  const prices = input.prices || {};
  const curs = new Set(lots.map((l) => l.currency));
  const toCur = cur(input.currency || [...curs][0]);
  if (curs.size > 1 || !curs.has(toCur)) throw err(`Swap nur innerhalb einer Währung (offen: ${[...curs].join(', ')}, Ziel ${toCur})`);
  const toSymbol = sym(input.toSymbol), toPrice = price(input.toPrice, `Kaufkurs ${toSymbol}`);
  let gross = 0;
  const sells = lots.map((l) => { const sp = price(prices[l.symbol] ?? input.sellPrice, `Verkaufskurs ${l.symbol}`); gross += l.qty * sp; return { l, sp }; });
  const net = gross * (1 - k), invest = net * (1 - k);
  const qty = Math.round((invest / toPrice) * 1e6) / 1e6;
  if (!(qty > 0)) throw err('Erlös zu klein');
  const swapId = crypto.randomUUID();
  for (const { l, sp } of sells) {
    if (l.buyDate && date < l.buyDate) throw err(`Swap-Datum liegt vor dem Kauf von ${l.symbol}`);
  }
  // Kosten je Seite als Gebühren buchen (Verkauf: Brutto × k je Lot, Kauf: Nettoerlös × k), damit Historie/Equity sie kennt.
  for (const { l, sp } of sells) Object.assign(l, { status: 'closed', sellPrice: sp, sellDate: date, swapId, sellSwapId: swapId, sellFees: Math.round(l.qty * sp * k * 1e4) / 1e4 });
  const lot = { id: crypto.randomUUID(), metal: to, symbol: toSymbol, qty, buyPrice: toPrice, buyDate: date, currency: toCur, note: String(input.note ?? `Swap ${from === 'gold' ? 'Gold→Silber' : 'Silber→Gold'}`).slice(0, 200), status: 'open', swapId, buySwapId: swapId, buyFees: Math.round(net * k * 1e4) / 1e4 };
  book.lots.push(lot); save(book);
  return { ok: true, message: `Swap ${from === 'gold' ? 'Gold→Silber' : 'Silber→Gold'}: ${sells.length} Lot(s) verkauft, ${qty} ${toSymbol} @ ${toPrice} gekauft (Kosten ${(k * 100).toFixed(2)} % je Seite)`, swap: { swapId, from, to, date, gross, net, invest, costs: gross - invest, qty, toSymbol, toPrice }, lot, book };
}

export function applyAction(action, body) {
  switch (String(action || '').toUpperCase()) {
    case 'BUY': case 'ADD': return buy(body);
    case 'SELL': return sell(body);
    case 'EDIT': return edit(body);
    case 'DELETE': return remove(body);
    case 'REOPEN': return reopen(body);
    case 'SWAP': return swap(body);
    default: throw err('action muss BUY, SELL, EDIT, DELETE, REOPEN oder SWAP sein');
  }
}
export { METALS };
