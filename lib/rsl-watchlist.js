// User RSL positions book (Kauf/Verkauf). Persisted as data/rsl-watchlist.json via store.
// Buy/sell dates are ISO calendar dates (UTC day, YYYY-MM-DD). buyDate is stored/shown; exit evaluation ignores it.

import crypto from 'node:crypto';
import * as store from './store.js';
import {UNIVERSES, canonUniverse} from './fn/grokki-universes.js';

const NAME = 'rsl-watchlist';
const UNIS = ['SPX', 'NDX', 'HDAX', 'SXXP']; // DAX (alt) wird beim Lesen als HDAX geführt, die Datei bleibt unverändert

export const emptyBook = () => ({version: 1, updatedAt: null, positions: []});

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s || !/^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(s)) {
    throw Object.assign(new Error('Symbol ungültig (erwartet Ticker wie AAPL oder SAP.DE)'), {status: 400});
  }
  return s;
}

export function normalizeUniverse(universe = 'SPX') {
  const u = canonUniverse(universe || 'SPX');
  if (!UNIS.includes(u)) {
    throw Object.assign(new Error(`universe must be ${UNIS.join(', ')}`), {status: 400});
  }
  return u;
}

export function parseIsoDate(value, label = 'date') {
  if (value == null || value === '') return todayUTC();
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) {
    throw Object.assign(new Error(`${label} muss YYYY-MM-DD sein`), {status: 400});
  }
  return s;
}

/** Pure migration: add stable ids / defaults, keep every existing field. */
export function migrateBook(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.positions)) return {book: emptyBook(), changed: false};
  let changed = false;
  const positions = raw.positions.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const q = {...p};
    if (!q.id) { q.id = crypto.randomUUID(); changed = true; }
    if (!q.symbol && q.ticker) { q.symbol = String(q.ticker).toUpperCase(); changed = true; }
    if (!q.status) { q.status = q.closedDate ? 'closed' : 'open'; changed = true; }
    if (!q.universe) { q.universe = 'SPX'; changed = true; }
    return q;
  }).filter((p) => p && typeof p === 'object');
  return {book: {version: 1, updatedAt: raw.updatedAt || null, positions}, changed};
}

export function loadBook() {
  const raw = store.read(NAME, emptyBook());
  const {book, changed} = migrateBook(raw);
  if (changed) {
    // Back up the pre-migration file once, then persist ids.
    try { store.write(NAME + '.backup', raw); } catch {}
    return aliasUniverses(saveBook(book));
  }
  return aliasUniverses(book);
}

/** Alt-Universum DAX → HDAX nur im Speicher (kein Schreiben); erst eine Buchaktion des Nutzers speichert HDAX. */
function aliasUniverses(book) {
  for (const p of book?.positions || []) if (p && p.universe && canonUniverse(p.universe) !== p.universe) { p.legacyUniverse = p.universe; p.universe = canonUniverse(p.universe); }
  return book;
}

const err = (msg) => Object.assign(new Error(msg), {status: 400});
/** Zahl mit Punkt oder Komma ("3,25", "1.234,5" → 1234.5, "1,234.5" → 1234.5). */
export function parseNum(v) {
  if (typeof v === 'number') return v;
  let t = String(v).trim().replace(/\s/g, '');
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(',', '.');
  return t === '' ? NaN : Number(t);
}
const numOrNull = (v, label) => {
  if (v == null || v === '') return null;
  const n = parseNum(v);
  if (!Number.isFinite(n)) throw err(`${label} muss eine Zahl sein`);
  return n;
};
/** Stückzahl: Bruchstücke erlaubt (> 0, max. 6 Nachkommastellen); leer → null. */
export function parseQty(v, label = 'qty') {
  if (v == null || v === '') return null;
  const n = parseNum(v);
  if (!Number.isFinite(n) || n <= 0) throw err(`${label} muss eine Zahl > 0 sein (Bruchstücke erlaubt, z. B. 3,25)`);
  return Math.round(n * 1e6) / 1e6;
}
const strictDate = (v, label) => {
  if (v == null || v === '') throw err(`${label} fehlt`);
  return parseIsoDate(v, label);
};

/** Locate a position by id, or by symbol(+universe) among a given status. */
export function findPosition(book, input = {}, status = 'open') {
  if (input.id) {
    const p = book.positions.find((x) => x.id === String(input.id));
    if (!p) return {error: `Keine Position mit id ${input.id}.`};
    return {position: p};
  }
  const symbol = normalizeSymbol(input.symbol || input.ticker);
  const universe = input.universe ? normalizeUniverse(input.universe) : null;
  const list = book.positions.filter((p) => (!status || p.status === status) && p.symbol === symbol && (universe == null || p.universe === universe));
  if (!list.length) return {error: `Keine ${status === 'open' ? 'offene ' : status === 'closed' ? 'geschlossene ' : ''}Position ${symbol}${universe ? ` (${universe})` : ''}.`};
  if (list.length > 1 && status === 'open') return {error: `${symbol} ist mehrfach offen (${list.map((p) => p.universe).join(', ')}). Bitte Universe oder id angeben.`};
  // closed: newest first
  list.sort((a, b) => String(b.closedDate || '').localeCompare(String(a.closedDate || '')));
  return {position: list[0]};
}

const dupOpen = (book, symbol, universe, exceptId) => book.positions.find(
  (p) => p.status === 'open' && p.symbol === symbol && p.universe === universe && p.id !== exceptId);

/** Edit buyDate/price/qty/note/universe (also sellDate/sellPrice on closed). */
export function editPosition(input = {}) {
  const book = loadBook();
  const f = findPosition(book, input, input.id ? null : 'open');
  if (f.error) return {ok: false, message: f.error, book, position: null};
  const p = f.position;
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;
  const next = {...p};
  const newUni = has('newUniverse') ? normalizeUniverse(input.newUniverse) : (input.id && has('universe') ? normalizeUniverse(input.universe) : p.universe);
  next.universe = newUni;
  if (newUni !== p.universe) delete next.legacyUniverse;
  if (has('buyDate')) next.buyDate = strictDate(input.buyDate, 'buyDate');
  if (has('buyPrice')) next.buyPrice = numOrNull(input.buyPrice, 'buyPrice');
  if (has('qty')) next.qty = parseQty(input.qty, 'qty');
  if (has('note')) next.note = String(input.note ?? '').slice(0, 200);
  if (p.status === 'closed') {
    if (has('sellDate')) next.closedDate = strictDate(input.sellDate, 'sellDate');
    if (has('sellPrice')) next.sellPrice = numOrNull(input.sellPrice, 'sellPrice');
  }
  if (next.closedDate && next.buyDate && next.closedDate < next.buyDate) throw err('Verkaufsdatum liegt vor dem Kaufdatum');
  if (next.status === 'open' && dupOpen(book, next.symbol, next.universe, p.id)) {
    return {ok: false, duplicated: true, message: `${next.symbol} (${next.universe}) ist bereits offen — keine Dublette.`, book, position: p};
  }
  next.rosterWarning = inUniverseRoster(next.symbol, next.universe) ? null
    : `Ticker nicht in der statischen ${next.universe}-Referenzliste — Exit-Rank ggf. unvollständig.`;
  next.editedAt = new Date().toISOString();
  Object.assign(p, next);
  if (!('legacyUniverse' in next)) delete p.legacyUniverse;
  const saved = saveBook(book);
  return {ok: true, message: `Geändert: ${p.symbol} (${p.universe}), Kauf ${p.buyDate}`, book: saved, position: p};
}

/** Hard delete (open or closed). */
export function deletePosition(input = {}) {
  const book = loadBook();
  const f = findPosition(book, input, input.id ? null : 'open');
  if (f.error) return {ok: false, message: f.error, book, position: null};
  book.positions = book.positions.filter((x) => x.id !== f.position.id);
  const saved = saveBook(book);
  return {ok: true, message: `Gelöscht: ${f.position.symbol} (${f.position.universe})`, book: saved, position: f.position};
}

/** Reopen a closed position (clears sell data). */
export function reopenPosition(input = {}) {
  const book = loadBook();
  const f = findPosition(book, input, 'closed');
  if (f.error) return {ok: false, message: f.error, book, position: null};
  const p = f.position;
  if (p.status !== 'closed') return {ok: false, message: `${p.symbol} ist bereits offen.`, book, position: p};
  if (dupOpen(book, p.symbol, p.universe, p.id)) return {ok: false, duplicated: true, message: `${p.symbol} (${p.universe}) ist bereits offen — keine Dublette.`, book, position: p};
  p.status = 'open'; p.closedDate = null; p.sellPrice = null; p.closedAt = null; p.reopenedAt = new Date().toISOString();
  const saved = saveBook(book);
  return {ok: true, message: `Wieder geöffnet: ${p.symbol} (${p.universe}), Kauf ${p.buyDate}`, book: saved, position: p};
}

/** Dispatch for API / command. */
export function applyAction(action, body = {}) {
  const a = String(action || '').toUpperCase();
  if (['ADD', 'BUY', 'KAUF'].includes(a)) return buyPosition(body);
  if (['EDIT', 'BEARBEITEN'].includes(a)) return editPosition(body);
  if (['SELL', 'VERKAUF', 'VERKAUFEN'].includes(a)) return sellPosition(body);
  if (['DELETE', 'LOESCHEN', 'LÖSCHEN'].includes(a)) return deletePosition(body);
  if (['REOPEN', 'WIEDER'].includes(a)) return reopenPosition(body);
  throw err('action muss ADD|BUY, EDIT, SELL, DELETE oder REOPEN sein');
}

export function saveBook(book) {
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    positions: Array.isArray(book.positions) ? book.positions : [],
  };
  store.write(NAME, next);
  return next;
}

export function openPositions(book = loadBook(), universe) {
  const list = book.positions.filter((p) => p.status === 'open');
  if (!universe) return list;
  const u = normalizeUniverse(universe);
  return list.filter((p) => p.universe === u);
}

export function closedPositions(book = loadBook(), limit = 20) {
  return book.positions
    .filter((p) => p.status === 'closed')
    .sort((a, b) => String(b.closedDate || '').localeCompare(String(a.closedDate || '')))
    .slice(0, limit);
}

/** Universes supported for holdings (order = filter order in the UI). */
export const HOLDING_UNIVERSES = UNIS.slice();

/**
 * Universe tags for a position (read-only, never writes the book).
 * universe = stored buy universe (set at purchase); if missing/invalid it is derived:
 * ticker suffix .DE → DAX, else first static roster containing the ticker (SPX, NDX, DAX), else SPX.
 * memberOf = every static roster that lists the ticker (e.g. AAPL → SPX, NDX); the buy universe always first.
 */
export function universeInfo(pos = {}) {
  const sym = String(pos.symbol || pos.ticker || '').trim().toUpperCase();
  const rawStored = String(pos.universe || '').trim().toUpperCase();
  const stored = canonUniverse(rawStored, '');
  const legacy = pos.legacyUniverse && canonUniverse(pos.legacyUniverse) === stored ? String(pos.legacyUniverse).toUpperCase() : rawStored;
  const memberOf = UNIS.filter((u) => (UNIVERSES[u] || []).includes(sym));
  let universe = UNIS.includes(stored) ? stored : null;
  let universeSource = universe ? (legacy !== stored ? `gespeichert ${legacy} → ${stored}` : 'gespeichert') : null;
  if (!universe) {
    if (/\.DE$/.test(sym)) universe = 'HDAX';
    else universe = memberOf[0] || 'SPX';
    universeSource = /\.DE$/.test(sym) ? 'abgeleitet (.DE)' : memberOf.length ? 'abgeleitet (Indexliste)' : 'Standard (SPX)';
  }
  const tags = [universe, ...memberOf.filter((u) => u !== universe)];
  return { universe, universeSource, memberOf: tags };
}

/** Counts per universe for a list of positions (uses universeInfo). */
export function universeCounts(list = []) {
  const out = Object.fromEntries(UNIS.map((u) => [u, 0]));
  for (const p of list) { const u = universeInfo(p).universe; out[u] = (out[u] || 0) + 1; }
  return out;
}

/** True if ticker is on the static universe roster (warn-only callers may still allow). */
export function inUniverseRoster(symbol, universe) {
  const list = UNIVERSES[normalizeUniverse(universe)] || [];
  return list.includes(normalizeSymbol(symbol));
}

/**
 * Open a position. Same symbol+universe already open → no duplicate.
 * Default buyDate = today UTC. Optional buyPrice, qty, note.
 */
export function buyPosition(input = {}) {
  const symbol = normalizeSymbol(input.symbol || input.ticker);
  const universe = normalizeUniverse(input.universe);
  const buyDate = parseIsoDate(input.buyDate || input.date, 'buyDate');
  const book = loadBook();
  const existing = book.positions.find(
    (p) => p.status === 'open' && p.symbol === symbol && p.universe === universe,
  );
  if (existing) {
    return {
      ok: false,
      message: `${symbol} (${universe}) ist bereits als offene Position geführt (Kauf ${existing.buyDate}).`,
      book,
      position: existing,
      duplicated: true,
    };
  }
  const buyPrice = numOrNull(input.buyPrice, 'buyPrice');
  const qty = parseQty(input.qty, 'qty');
  const position = {
    id: crypto.randomUUID(),
    symbol,
    universe,
    status: 'open',
    buyDate,
    buyPrice,
    qty,
    note: input.note != null ? String(input.note).slice(0, 200) : '',
    closedDate: null,
    sellPrice: null,
    createdAt: new Date().toISOString(),
    rosterWarning: inUniverseRoster(symbol, universe)
      ? null
      : `Ticker nicht in der statischen ${universe}-Referenzliste — Exit-Rank ggf. unvollständig.`,
  };
  book.positions.push(position);
  const saved = saveBook(book);
  return {
    ok: true,
    message: `Kauf ${symbol} (${universe}) am ${buyDate}`,
    book: saved,
    position,
    duplicated: false,
  };
}

/**
 * Close an open position (keep history). Default sellDate = today UTC.
 */
export function sellPosition(input = {}) {
  const symbol = input.id && !(input.symbol || input.ticker) ? null : normalizeSymbol(input.symbol || input.ticker);
  const universe = input.universe ? normalizeUniverse(input.universe) : null;
  const closedDate = parseIsoDate(input.sellDate || input.closedDate || input.date, 'sellDate');
  const book = loadBook();
  const open = book.positions.filter(
    (p) =>
      p.status === 'open' &&
      (input.id ? p.id === String(input.id) : (p.symbol === symbol &&
      (universe == null || p.universe === universe))),
  );
  if (!open.length) {
    return {
      ok: false,
      message: universe
        ? `Keine offene Position ${symbol || input.id} (${universe}).`
        : `Keine offene Position ${symbol || input.id}.`,
      book,
      position: null,
    };
  }
  if (open.length > 1 && universe == null) {
    return {
      ok: false,
      message: `${symbol} ist in mehreren Universen offen (${open.map((p) => p.universe).join(', ')}). Bitte Universe angeben.`,
      book,
      position: null,
    };
  }
  const target = open[0];
  if (target.buyDate && closedDate < target.buyDate) throw err('Verkaufsdatum liegt vor dem Kaufdatum');
  const sellPrice = numOrNull(input.sellPrice, 'sellPrice');
  // Teilverkauf: sellQty (oder qty) < offene Stückzahl → geschlossener Teil als eigener Datensatz, Rest bleibt offen.
  const sellQty = parseQty(input.sellQty ?? input.qty, 'sellQty');
  if (sellQty != null && target.qty != null && sellQty > target.qty + 1e-9) throw err(`Verkaufsmenge ${sellQty} > offene Stückzahl ${target.qty}`);
  if (sellQty != null && target.qty != null && sellQty < target.qty - 1e-9) {
    const part = {...target, id: crypto.randomUUID(), qty: sellQty, status: 'closed', closedDate, sellPrice,
      closedAt: new Date().toISOString(), partialOf: target.id};
    target.qty = Math.round((target.qty - sellQty) * 1e6) / 1e6;
    target.editedAt = part.closedAt;
    book.positions.push(part);
    const saved = saveBook(book);
    return {ok: true, partial: true, message: `Teilverkauf ${target.symbol} (${target.universe}) ${sellQty} Stk. am ${closedDate}, offen bleiben ${target.qty}`, book: saved, position: part, remaining: target};
  }
  target.status = 'closed';
  target.closedDate = closedDate;
  target.sellPrice = sellPrice;
  target.closedAt = new Date().toISOString();
  const saved = saveBook(book);
  return {
    ok: true,
    message: `Verkauf ${target.symbol} (${target.universe}) am ${closedDate}`,
    book: saved,
    position: target,
  };
}
