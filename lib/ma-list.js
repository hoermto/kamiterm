// Manual M&A flag list. Persisted as data/ma-list.json (user data — Seafile-synced).
import * as store from './store.js';

const NAME = 'ma-list';

export const emptyList = () => ({ version: 1, updatedAt: null, entries: [] });

export function normalizeSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s || !/^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(s)) {
    throw Object.assign(new Error('Symbol ungültig (erwartet Ticker wie AAPL oder SAP.DE)'), { status: 400 });
  }
  return s;
}

export function loadList() {
  const raw = store.read(NAME, null);
  if (!raw || typeof raw !== 'object') return emptyList();
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  return {
    version: 1,
    updatedAt: raw.updatedAt || null,
    entries: entries
      .map((e) => ({
        symbol: String(e.symbol || e.ticker || '').toUpperCase(),
        note: e.note != null ? String(e.note) : '',
        date: e.date || e.announced || null,
        addedAt: e.addedAt || null,
      }))
      .filter((e) => e.symbol),
  };
}

export function saveList(list) {
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: list.entries || [],
  };
  store.write(NAME, next);
  return next;
}

export function listEntries() {
  return loadList();
}

export function addEntry({ symbol, note, date } = {}) {
  const sym = normalizeSymbol(symbol);
  const list = loadList();
  const existing = list.entries.find((e) => e.symbol === sym);
  if (existing) {
    if (note != null) existing.note = String(note);
    if (date != null && date !== '') existing.date = String(date).slice(0, 10);
    const saved = saveList(list);
    return { ok: true, updated: true, entry: existing, list: saved };
  }
  const entry = {
    symbol: sym,
    note: note != null ? String(note) : '',
    date: date ? String(date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    addedAt: new Date().toISOString(),
  };
  list.entries.push(entry);
  const saved = saveList(list);
  return { ok: true, updated: false, entry, list: saved };
}

export function removeEntry({ symbol } = {}) {
  const sym = normalizeSymbol(symbol);
  const list = loadList();
  const before = list.entries.length;
  list.entries = list.entries.filter((e) => e.symbol !== sym);
  if (list.entries.length === before) {
    return { ok: false, message: `${sym} steht nicht auf der M&A-Liste`, list };
  }
  const saved = saveList(list);
  return { ok: true, message: `${sym} von der M&A-Liste entfernt`, list: saved };
}

/** Map symbol -> manual entry */
export function manualMap(list = loadList()) {
  return new Map((list.entries || []).map((e) => [e.symbol, e]));
}
