// Auto-Watchlist W:HOLD: virtuelle, nur lesbare Liste aller aktuell gehaltenen Symbole aus den Holding-Quellen
// der Apps (RSL-Buch, GSW-Buch, PORT …). Wird bei jedem Abruf live aus den Quelldateien berechnet und nie
// gespeichert (nicht in data/state.json, damit es keinen Seafile-Sync-Konflikt gibt und jede Buchung sofort drin ist).
// Neue Apps hängen sich mit registerHoldingProvider({ id, label, list }) ein; list() liefert
// [{ yahoo: 'SAP.DE' } | { words: ['VOD', 'LN'] }, source: 'Detail', qty? ] und darf nichts schreiben.
import * as store from './store.js';
import { migrateBook } from './rsl-watchlist.js';
import { canonUniverse } from './fn/grokki-universes.js';
import { toSecurity, bbgCode, yahooSymbol, yahooWords } from '../public/js/securities.js';

export const HOLD_LIST = 'HOLD';
const providers = new Map();

/** Holding-Quelle registrieren (gleiche id ersetzt). */
export function registerHoldingProvider(p) {
  if (!p || !p.id || typeof p.list !== 'function') throw new Error('Holding-Provider braucht id und list()');
  providers.set(String(p.id), { label: p.label || p.id, ...p });
  return () => providers.delete(String(p.id));
}
export const holdingProviders = () => [...providers.values()];

// ---- eingebaute Quellen (nur lesen: store.read, keine Migration auf Platte) ----
registerHoldingProvider({
  id: 'RSL', label: 'RSL-Buch', file: 'data/rsl-watchlist.json',
  list() {
    const { book } = migrateBook(store.read('rsl-watchlist', null)); // pure, schreibt nicht
    return book.positions.filter((p) => p && (p.status || 'open') === 'open' && p.symbol)
      .map((p) => ({ yahoo: String(p.symbol).toUpperCase(), source: `RSL ${canonUniverse(p.universe || 'SPX')}`, qty: Number(p.qty) || null }));
  },
});
registerHoldingProvider({
  id: 'GSW', label: 'GSW-Buch', file: 'data/gsw-book.json',
  list() {
    const b = store.read('gsw-book', null);
    const lots = b && Array.isArray(b.lots) ? b.lots : [];
    return lots.filter((l) => l && l.status === 'open' && l.symbol)
      .map((l) => ({ yahoo: String(l.symbol).toUpperCase(), source: `GSW ${l.metal === 'gold' ? 'Gold' : l.metal === 'silver' ? 'Silber' : ''}`.trim(), qty: Number(l.qty) || null }));
  },
});
registerHoldingProvider({
  id: 'PORT', label: 'PORT (Portfolio)', file: 'data/state.json · amberPort',
  list() {
    const port = store.read('state', {})?.amberPort;
    return (Array.isArray(port) ? port : []).filter((h) => h && h.sec && Number(h.shares))
      .map((h) => ({ words: String(h.sec).toUpperCase().trim().split(/\s+/), source: 'PORT', qty: Number(h.shares) || null }));
  },
});

/** Security-Code (wie in W-Listen, z. B. "SAP GR EQUITY") für einen Eintrag; null wenn nicht auflösbar. */
export function holdingCode(it) {
  const words = it.words || (it.yahoo ? yahooWords(it.yahoo) : null);
  const sec = words ? toSecurity(words) : null;
  return sec ? bbgCode(sec) : null;
}

/**
 * W:HOLD berechnen: alle Provider abfragen, nach Security-Code deduplizieren, Quellen sammeln.
 * -> { name: 'HOLD', virtual: true, readOnly: true, codes, rows: [{ code, yahoo, sources: [{ id, label, source, qty }] }], providers: [{ id, label, count, error }], asOf }
 */
export function holdList() {
  const byCode = new Map();
  const prov = [];
  for (const p of providers.values()) {
    let items = [];
    try { items = p.list() || []; prov.push({ id: p.id, label: p.label, file: p.file || null, count: items.length, error: null }); }
    catch (e) { prov.push({ id: p.id, label: p.label, file: p.file || null, count: 0, error: e.message }); continue; }
    for (const it of items) {
      const code = holdingCode(it);
      if (!code) continue;
      let row = byCode.get(code);
      if (!row) { const sec = toSecurity(code.split(' ')); row = { code, yahoo: sec ? yahooSymbol(sec) : it.yahoo || null, sources: [] }; byCode.set(code, row); }
      const ex = row.sources.find((s) => s.id === p.id && s.source === it.source);
      if (ex) ex.qty = (ex.qty || 0) + (it.qty || 0) || null;
      else row.sources.push({ id: p.id, label: p.label, source: it.source || p.label, qty: it.qty ?? null });
    }
  }
  const rows = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { name: HOLD_LIST, virtual: true, readOnly: true, codes: rows.map((r) => r.code), rows, providers: prov, asOf: new Date().toISOString() };
}
