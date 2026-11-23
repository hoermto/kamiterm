// Laufband unten (pure, ohne DOM/fetch; Node-Tests laden die Datei direkt): Quelle „Standard“ (feste Liste der
// großen Indizes, Gold, Öl, Dollar, Bitcoin) oder „Watchlists“ (Vereinigung gewählter W-Listen inkl. W:HOLD).
import { toSecurity, yahooSymbol } from "./securities.js";

export const TAPE_HOLD = "W:HOLD";
export const TAPE_MAX = 80; // höchstens so viele Werte im Laufband (eine Board-Anfrage)
export const TAPE_SOURCES = Object.freeze({ standard: "Standard", watch: "Watchlists" });
const LIST_RE = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;

// Standard: [Anzeige, Yahoo-Symbol]
export const STANDARD_TAPE = Object.freeze([
  ["SPX", "^GSPC"], ["NDX", "^NDX"], ["INDU", "^DJI"], ["UKX", "^FTSE"], ["DAX", "^GDAXI"], ["NKY", "^N225"], ["HSI", "^HSI"],
  ["GOLD", "GC=F"], ["WTI", "CL=F"], ["US10Y", "^TNX"], ["EURUSD", "EURUSD=X"], ["USDJPY", "JPY=X"], ["BTC", "BTC-USD"], ["ETH", "ETH-USD"],
]);

/** Gespeicherte Auswahl säubern: Listennamen (W-Regel) oder W:HOLD, ohne Doppel, max. 21. */
export function normalizeTapeLists(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const n = String(x ?? "").trim().toUpperCase();
    if ((n === TAPE_HOLD || LIST_RE.test(n)) && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 21);
}

/** Codes aus den gewählten Listen in Auswahl-Reihenfolge, je Liste in Listen-Reihenfolge, ohne Doppel. */
export function tapeCodes(picked, lists = {}, holdCodes = []) {
  const seen = new Set(), out = [];
  for (const name of picked || []) {
    const src = name === TAPE_HOLD ? holdCodes : lists[name];
    for (const c of src || []) {
      const k = String(c || "").trim().toUpperCase();
      if (k && !seen.has(k)) { seen.add(k); out.push(k); }
    }
  }
  return out;
}

/** Kurzname im Band: „AAPL US EQUITY“ → AAPL, „SPX INDEX“ → SPX, „EURUSD CURNCY“ → EURUSD. */
export const tapeLabel = (code) => String(code || "").trim().split(/\s+/)[0] || "";

/**
 * Was das Band zeigt. -> { items: [[label, yahooSymbol]], source: 'standard'|'watch', fallback: null|'empty'|'none', capped }
 * prefs: { tapeSource, tapeLists }; lists: amberWatch.lists; holdCodes: W:HOLD-Codes.
 */
export function tapeItems(prefs = {}, lists = {}, holdCodes = []) {
  if (prefs.tapeSource !== "watch") return { items: STANDARD_TAPE.map((x) => [...x]), source: "standard", fallback: null, capped: false };
  const picked = normalizeTapeLists(prefs.tapeLists);
  if (!picked.length) return { items: STANDARD_TAPE.map((x) => [...x]), source: "standard", fallback: "none", capped: false };
  const seenSym = new Set(), items = [];
  for (const code of tapeCodes(picked, lists, holdCodes)) {
    const sym = yahooSymbol(toSecurity(code.split(/\s+/)));
    if (!sym || seenSym.has(sym)) continue;
    seenSym.add(sym);
    items.push([tapeLabel(code), sym]);
  }
  if (!items.length) return { items: STANDARD_TAPE.map((x) => [...x]), source: "standard", fallback: "empty", capped: false };
  return { items: items.slice(0, TAPE_MAX), source: "watch", fallback: null, capped: items.length > TAPE_MAX };
}
