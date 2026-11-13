/**
 * Research-only universes (HDAX, STOXX Europe 600, STOXX-600 Eurozone) for scripts/research-engine.mjs.
 * Not used by the production terminal. Lists: scripts/lib/research-universes.json (iShares holdings, Nov 2026; current constituents only).
 * Non-EUR prices are converted to EUR with Yahoo daily FX (EURxxx=X, close at or before the bar date); London GBp → GBP (/100).
 */
import { readFileSync } from 'fs';
const J = JSON.parse(readFileSync(new URL('./research-universes.json', import.meta.url), 'utf8'));
export const RESEARCH_UNIVERSES = J.universes, RESEARCH_FX = J.FX, RESEARCH_SOURCES = J.sources;
export function isResearchUniverse(key) { return Object.prototype.hasOwnProperty.call(J.universes, key); }
/** Convert one series to EUR. fxBars: sorted [{time, close}] of EURxxx=X (units of xxx per 1 EUR). Bars before FX start are dropped. */
export function toEur(series, member, fxBars) {
  if (!member || member.cur === 'EUR') return series;
  const div = member.pence ? 100 : 1; let j = -1; const out = [];
  for (const b of series.bars) {
    while (j + 1 < fxBars.length && fxBars[j + 1].time <= b.time + 86399) j++;
    if (j < 0 || !(fxBars[j].close > 0)) continue;
    const f = fxBars[j].close * div;
    out.push({ ...b, open: b.open / f, high: b.high / f, low: b.low / f, close: b.close / f });
  }
  return { ...series, bars: out, fx: member.cur };
}

/**
 * Data repair for research universes (Yahoo glitches seen in STOXX 600 data):
 * (1) unit switches by ~100x (GBp↔GBP) that later revert: segment rescaled to the surrounding level;
 * (2) isolated spikes (>4x or <0.25x) that revert within 5 bars to ±30 % of the prior close: spike bars replaced by the prior bar.
 * Returns { series, fixes: [{type, from, to}] }.
 */
export function repairBars(series) {
  const b = series.bars.map(x => ({ ...x })), fixes = [];
  const scale = (i, f) => { b[i].open *= f; b[i].high *= f; b[i].low *= f; b[i].close *= f; };
  for (let i = 1; i < b.length; i++) {
    const r = b[i].close / b[i - 1].close;
    if (r < 0.02 || r > 50) {
      const f = r < 0.02 ? 100 : 0.01; let j = i;
      while (j < b.length && !(j > i && Math.abs(Math.log((b[j].close) / (b[j - 1].close * (j - 1 >= i ? 1 / f : 1))) ) > Math.log(20))) j++;
      // segment [i, j) is off by factor 1/f relative to prior level; j is where the data jumps back
      for (let k = i; k < j; k++) scale(k, f);
      fixes.push({ type: 'x100', from: b[i].time, to: b[Math.min(j, b.length) - 1].time }); i = j - 1; continue;
    }
    if (r > 4 || r < 0.25) {
      for (let k = i + 1; k <= Math.min(i + 5, b.length - 1); k++) {
        if (Math.abs(Math.log(b[k].close / b[i - 1].close)) < Math.log(1.3)) { for (let m = i; m < k; m++) b[m] = { ...b[i - 1], time: b[m].time }; fixes.push({ type: 'spike', from: b[i].time, to: b[k - 1].time }); i = k - 1; break; }
      }
    }
  }
  return { series: { ...series, bars: b }, fixes };
}
