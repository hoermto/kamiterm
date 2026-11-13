// Europäische Scan-Universen (HDAX, STOXX 600): Datenreparatur + EUR-Umrechnung wie scripts/research-engine.mjs.
import {EU_UNIVERSES, EU_FX, canonUniverse} from './grokki-universes.js';
import {history} from './grokki-data.js';
import {toEur, repairBars} from '../../scripts/lib/research-universes.mjs';

const memberMaps = new Map();
function memberMap(key) {
  if (!memberMaps.has(key)) memberMaps.set(key, new Map((EU_UNIVERSES[key]?.members || []).map((m) => [m.t, m])));
  return memberMaps.get(key);
}
export const isEuUniverse = (key) => !!EU_UNIVERSES[canonUniverse(key)];
/** Währung laut Mitgliederliste (EUR, GBP mit pence, CHF …) oder null. */
export function memberOf(key, ticker) { return memberMap(canonUniverse(key)).get(ticker) || null; }

/** FX-Historie je Währung (Yahoo EURxxx=X), aus dem OHLCV-Cache. */
async function fxBarsFor(curs, years) {
  const out = {}, errors = [];
  await Promise.all([...curs].map(async (c) => {
    try { out[c] = (await history(EU_FX[c], years)).bars; }
    catch (e) { errors.push({ ticker: EU_FX[c], error: e.message }); }
  }));
  return { fx: out, errors };
}

/**
 * Serien eines EU-Universums nachbearbeiten: repairBars für alle, toEur für Nicht-EUR-Titel.
 * Gibt {results, repairs, fxErrors} zurück. Titel ohne FX-Daten fallen weg (Fehler in fxErrors).
 */
export async function adjustEuSeries(key, results, years = 2) {
  const k = canonUniverse(key);
  if (!EU_UNIVERSES[k]) return { results, repairs: [], fxErrors: [] };
  const mm = memberMap(k);
  const curs = new Set(results.map((s) => mm.get(s.ticker)?.cur).filter((c) => c && c !== 'EUR'));
  const { fx, errors } = await fxBarsFor(curs, Math.max(2, years));
  const repairs = [], out = [];
  for (const s0 of results) {
    const rp = repairBars(s0);
    if (rp.fixes.length) repairs.push({ ticker: s0.ticker, fixes: rp.fixes.length, types: [...new Set(rp.fixes.map((f) => f.type))] });
    let s = rp.series;
    const m = mm.get(s.ticker);
    if (m && m.cur !== 'EUR') {
      if (!fx[m.cur]) { errors.push({ ticker: s.ticker, error: `FX ${m.cur} fehlt` }); continue; }
      const local = s.bars.at(-1)?.close;
      s = toEur(s, m, fx[m.cur]);
      s.priceLocal = local; s.cur = m.pence ? 'GBp' : m.cur;
    } else s.cur = 'EUR';
    if (s.bars.length) out.push(s);
  }
  return { results: out, repairs, fxErrors: errors };
}
