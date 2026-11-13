// Pure helpers for the RSL26 scanner: display length (Top X) and buy-slot candidates.
// No DOM, no imports — shared by public/js/fn/grokki.js and the node --test suite.

/** Top X (Anzeige): Zeilen der Rangliste. Default 25, 1…500. Fehlend/ungültig → 25 (rückwärtskompatibel). */
export function topXVal(v, fallback = 25) {
  const n = Math.floor(Number(v));
  return v !== '' && v != null && Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : fallback;
}

/**
 * Buy-slot candidates (nur Markierung, keine Käufe).
 * Strategie wie im Backtest: freie Slots = N − offene Holdings des aktiven Universums;
 * gefüllt in Rang-Reihenfolge aus dem Kauf-Fenster, nicht gehaltene Titel, ohne gesperrte (lockedSymbols).
 * Kauf-Fenster: Rang 1…N. Mit skipMa (Option „M&A ignorieren“) zählen M&A-markierte Titel (row.maFlag) nicht mit:
 * Das Fenster sind dann die ersten N Ränge ohne M&A (z. B. N=5, Rang 3 M&A → Ränge 1, 2, 4, 5, 6).
 * @param {Array<{ticker:string,rank:number,maFlag?:boolean}>} rows  Rangliste (rank = Original-Rang)
 * @param {Array<{symbol:string,universe?:string}>} positions offene Positionen (alle Universen)
 * @param {{n:number, universe:string, lockedSymbols?:Iterable<string>, maxRank?:number, skipMa?:boolean}} opts
 */
export function buySlotCandidates(rows, positions, { n, universe, lockedSymbols = [], maxRank, skipMa = false } = {}) {
  const N = Math.max(1, Math.floor(Number(n)) || 1);
  const up = (s) => String(s || '').toUpperCase();
  const uni = up(universe || 'SPX');
  const heldSymbols = new Set();
  const heldElsewhere = new Map();
  for (const p of positions || []) {
    const sym = up(p.symbol || p.ticker);
    if (!sym) continue;
    const pu = up(p.universe || 'SPX');
    if (pu === uni) heldSymbols.add(sym);
    else heldElsewhere.set(sym, [...(heldElsewhere.get(sym) || []), pu]);
  }
  const held = heldSymbols.size;
  const free = Math.max(0, N - held);
  const locked = new Set([...lockedSymbols].map(up));
  const sorted = [...(rows || [])].filter((r) => r && r.ticker && Number.isFinite(Number(r.rank)))
    .sort((a, b) => Number(a.rank) - Number(b.rank));
  // Kauf-Fenster bestimmen
  const fixedLimit = Number.isFinite(Number(maxRank)) && Number(maxRank) > 0 ? Math.floor(Number(maxRank)) : null;
  const windowRows = [], skippedMa = [];
  for (const r of sorted) {
    if (skipMa && r.maFlag) {
      if (windowRows.length < N) skippedMa.push(r.ticker);
      continue;
    }
    if (fixedLimit != null ? Number(r.rank) > fixedLimit : (skipMa ? windowRows.length >= N : Number(r.rank) > N)) break;
    windowRows.push(r);
  }
  const windowEnd = windowRows.length ? Number(windowRows.at(-1).rank) : null;
  const candidates = [];
  const skippedLocked = [];
  for (const r of windowRows) {
    if (candidates.length >= free) break;
    const t = up(r.ticker);
    if (heldSymbols.has(t)) continue;
    if (locked.has(t)) { skippedLocked.push(t); continue; }
    candidates.push({ ticker: r.ticker, rank: Number(r.rank), slot: held + candidates.length + 1 });
  }
  return { n: N, held, free, heldSymbols, heldElsewhere, candidates, shortfall: free - candidates.length, skippedLocked,
    skippedMa: new Set(skippedMa.map(up)), windowEnd, skipMa: !!skipMa };
}
