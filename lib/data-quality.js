// Datenqualität für Tageskurse: eingefrorene Schlusskurse erkennen und (für bekannte Instrumente) aus einer
// Alternativquelle ersetzen. Läuft beim Lesen (lib/fn/grokki-data.js history()), nicht im Cache: der OHLCV-Cache ist
// lokal je Rechner; so wird jede Kopie gleich repariert, und die Original-Bars bleiben unverändert im Cache.
//
// Erkennung: ≥ minRun aufeinanderfolgende Bars mit identischem Schluss (nur echte Bars, Wochenenden/Feiertage ohne
// Bar zählen nicht), während sich die Referenz (z. B. GC=F für Gold-ETCs) im selben Zeitraum bewegt.
// Ersatz: Alternativquelle (gleiches Produkt an anderer Börse, ggf. per Wechselkurs umgerechnet), skaliert auf das
// Verhältnis Original/Alternative an den Rändern (Median von bis zu 20 sauberen Tagen davor bzw. danach, linear dazwischen).

const dayIso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Referenz je Instrument (Bewegt sich die Referenz, ist ein flacher Run ein Datenfehler). */
export const FREEZE_REF = Object.freeze({
  '8PSG.DE': 'GC=F', 'SGLD.MI': 'GC=F', 'SGLD.L': 'GC=F', 'XAD5.DE': 'GC=F', 'PHAU.MI': 'GC=F', 'PHAU.L': 'GC=F', 'BULL.MI': 'GC=F', 'BULL.L': 'GC=F', GLD: 'GC=F',
  '8PSB.DE': 'SI=F', 'SSLV.L': 'SI=F', 'XAD6.DE': 'SI=F', 'PHAG.MI': 'SI=F', 'PHAG.L': 'SI=F', 'SLVR.MI': 'SI=F', 'SLVR.L': 'SI=F', SLV: 'SI=F',
});
/**
 * Ersatzquellen je Instrument, in dieser Reihenfolge versucht (je Tag die erste, die dort einen sauberen Kurs hat).
 * fx: Kurs in Zielwährung = alt / fx (op 'div', EURUSD=X = USD je EUR) bzw. alt × fx (op 'mul').
 * synthetic: kein gleiches Produkt, sondern ein Proxy (nur Notbehelf, so markiert).
 */
export const FREEZE_PATCHES = Object.freeze({
  // Invesco Physical Gold ETC (IE00B579F325): Mailand in EUR, sonst London in USD umgerechnet, zuletzt GC=F in EUR
  '8PSG.DE': [{ alt: 'SGLD.MI', label: 'SGLD.MI (Invesco Physical Gold, Borsa Italiana, EUR)' }, { alt: 'SGLD.L', fx: 'EURUSD=X', op: 'div', label: 'SGLD.L (LSE, USD) ÷ EURUSD' }, { alt: 'GC=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: GC=F ÷ EURUSD' }],
  'SGLD.MI': [{ alt: 'SGLD.L', fx: 'EURUSD=X', op: 'div', label: 'SGLD.L (LSE, USD) ÷ EURUSD' }, { alt: 'GC=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: GC=F ÷ EURUSD' }],
  '8PSB.DE': [{ alt: 'SSLV.L', fx: 'EURUSD=X', op: 'div', label: 'SSLV.L (Invesco Physical Silver, LSE, USD) ÷ EURUSD' }, { alt: 'SI=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: SI=F ÷ EURUSD' }],
  'PHAU.MI': [{ alt: 'PHAU.L', fx: 'EURUSD=X', op: 'div', label: 'PHAU.L (WisdomTree Physical Gold, LSE, USD) ÷ EURUSD' }, { alt: 'GC=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: GC=F ÷ EURUSD' }],
  'PHAG.MI': [{ alt: 'PHAG.L', fx: 'EURUSD=X', op: 'div', label: 'PHAG.L (WisdomTree Physical Silver, LSE, USD) ÷ EURUSD' }, { alt: 'SI=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: SI=F ÷ EURUSD' }],
  'BULL.MI': [{ alt: 'BULL.L', fx: 'EURUSD=X', op: 'div', label: 'BULL.L (WisdomTree Gold, LSE, USD) ÷ EURUSD' }, { alt: 'GC=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: GC=F ÷ EURUSD' }],
  'SLVR.MI': [{ alt: 'SLVR.L', fx: 'EURUSD=X', op: 'div', label: 'SLVR.L (WisdomTree Silver, LSE, USD) ÷ EURUSD' }, { alt: 'SI=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: SI=F ÷ EURUSD' }],
  'XAD5.DE': [{ alt: 'GC=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: GC=F ÷ EURUSD' }],
  'XAD6.DE': [{ alt: 'SI=F', fx: 'EURUSD=X', op: 'div', synthetic: true, label: 'synthetisch: SI=F ÷ EURUSD' }],
});

/** Schluss am Tag oder davor aus sortierten Bars. */
function asOf(bars, dates) {
  return (d) => { let lo = 0, hi = dates.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a >= 0 ? bars[a].close : null; };
}

/**
 * Eingefrorene Runs finden. bars: [{time, close}] sortiert. ref: Bars der Referenz (optional).
 * -> [{ from, to, start, end, n, stale, value, refMovePct }]  (start/end = Indizes; stale = Bars nach dem ersten = ersetzbar)
 */
export function findFreezes(bars, { minRun = 5, ref = null, minRefMovePct = 0.5 } = {}) {
  const out = [];
  if (!bars?.length) return out;
  const rd = ref?.length ? ref.map((b) => dayIso(b.time)) : null;
  const rAt = rd ? asOf(ref, rd) : null;
  let s = 0;
  for (let i = 1; i <= bars.length; i++) {
    if (i < bars.length && bars[i].close === bars[s].close) continue;
    const n = i - s;
    if (n >= minRun) {
      const from = dayIso(bars[s].time), to = dayIso(bars[i - 1].time);
      let refMovePct = null;
      if (rAt) {
        const vals = rd.map((d, k) => (d >= from && d <= to ? ref[k].close : null)).filter((v) => v > 0);
        if (vals.length >= 2) refMovePct = ((Math.max(...vals) - Math.min(...vals)) / median(vals)) * 100;
      }
      if (refMovePct == null || refMovePct >= minRefMovePct) out.push({ from, to, start: s, end: i - 1, n, stale: n - 1, value: bars[s].close, refMovePct: refMovePct == null ? null : Math.round(refMovePct * 100) / 100 });
    }
    s = i;
  }
  return out;
}

/** Saubere Alternativ-Kurse als Map Datum → Kurs in Zielwährung (eigene eingefrorene Bars der Alternative fallen raus). */
export function altMap(altBars, fxBars = null, op = 'div', { minRun = 5 } = {}) {
  const m = new Map();
  if (!altBars?.length) return m;
  const bad = new Set();
  for (const f of findFreezes(altBars, { minRun })) for (let i = f.start + 1; i <= f.end; i++) bad.add(i);
  const fd = fxBars?.length ? fxBars.map((b) => dayIso(b.time)) : null;
  const fxAt = fd ? asOf(fxBars, fd) : null;
  altBars.forEach((b, i) => {
    if (bad.has(i) || !(b.close > 0)) return;
    const d = dayIso(b.time);
    let v = b.close;
    if (fxBars) { const f = fxAt(d); if (!(f > 0)) return; v = op === 'mul' ? v * f : v / f; }
    m.set(d, v);
  });
  return m;
}

/**
 * Pure: eingefrorene Bars ersetzen. sources: [{ label, synthetic, map: Map(Datum → Kurs in Zielwährung) }] in Reihenfolge.
 * -> { bars (neu, ersetzte Bars mit patched: label), patches: [...], freezes: (alle gefundenen Runs) }
 */
export function patchFreezes(bars, freezes, sources, { edge = 20, overlapDays = 250 } = {}) {
  if (!freezes.length || !sources.length) return { bars, patches: [] };
  const out = bars.map((b) => ({ ...b }));
  const dates = bars.map((b) => dayIso(b.time));
  const frozen = new Set();
  for (const f of freezes) for (let i = f.start + 1; i <= f.end; i++) frozen.add(i);
  // Verhältnis Original/Alternative an sauberen Tagen (für Skalierung und Overlap-Qualität)
  const ratioAround = (src, from, dir) => {
    const r = [];
    for (let i = from; i >= 0 && i < bars.length && r.length < edge; i += dir) { if (frozen.has(i)) continue; const a = src.map.get(dates[i]); if (a > 0) r.push(bars[i].close / a); }
    return median(r);
  };
  const quality = (src, f) => {
    const dev = [];
    for (const dir of [-1, 1]) {
      let k = 0;
      for (let i = dir < 0 ? f.start : f.end + 1; i >= 0 && i < bars.length && k < overlapDays; i += dir) {
        if (frozen.has(i)) continue; const a = src.map.get(dates[i]); if (!(a > 0)) continue;
        const r = dir < 0 ? f.rBefore[src.label] : f.rAfter[src.label]; if (!r) continue;
        dev.push(Math.abs((a * r) / bars[i].close - 1) * 100); k++;
      }
    }
    dev.sort((x, y) => x - y);
    return dev.length ? { n: dev.length, medianAbsPct: Math.round(median(dev) * 1000) / 1000, p95AbsPct: Math.round(dev[Math.floor(dev.length * 0.95)] * 1000) / 1000, maxAbsPct: Math.round(dev.at(-1) * 1000) / 1000 } : null;
  };
  const patches = [];
  for (const f of freezes) {
    f.rBefore = {}; f.rAfter = {};
    for (const s of sources) { f.rBefore[s.label] = ratioAround(s, f.start, -1); f.rAfter[s.label] = ratioAround(s, f.end + 1, 1) ?? f.rBefore[s.label]; f.rBefore[s.label] ??= f.rAfter[s.label]; }
    const used = new Map(); let unfilled = 0;
    const span = Math.max(1, f.end - f.start);
    for (let i = f.start + 1; i <= f.end; i++) {
      const w = (i - f.start) / span;
      const src = sources.find((s) => s.map.get(dates[i]) > 0 && f.rBefore[s.label] > 0);
      if (!src) { unfilled++; continue; }
      const r = f.rBefore[src.label] * (1 - w) + f.rAfter[src.label] * w;
      const c = src.map.get(dates[i]) * r;
      const k = c / out[i].close;
      out[i] = { ...out[i], open: out[i].open * k, high: Math.max(out[i].high * k, c), low: Math.min(out[i].low * k, c), close: c, patched: src.label, synthetic: !!src.synthetic };
      used.set(src.label, (used.get(src.label) || 0) + 1);
    }
    const main = [...used.entries()].sort((a, b) => b[1] - a[1])[0];
    const srcMain = main ? sources.find((s) => s.label === main[0]) : null;
    patches.push({ from: f.from, to: f.to, stale: f.stale, value: f.value, refMovePct: f.refMovePct, filled: f.stale - unfilled, unfilled,
      sources: Object.fromEntries(used), synthetic: [...used.keys()].some((l) => sources.find((s) => s.label === l)?.synthetic),
      overlap: srcMain ? quality(srcMain, f) : null, source: main?.[0] || null });
    delete f.rBefore; delete f.rAfter;
  }
  return { bars: out, patches };
}

/** Kurztext für Hinweise in GSW/GSWBT. */
export function qualityNotes(ticker, q) {
  const fmtV = (v) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 4 });
  const dd = (x) => `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}`;
  const out = [];
  for (const p of q?.patches || []) {
    out.push({ level: p.unfilled ? 'warn' : 'info', text: `Datenkorrektur ${ticker}: ${p.stale} eingefrorene Schlusskurse ${dd(p.from)}–${dd(p.to)} (Yahoo: konstant ${fmtV(p.value)}) ${p.filled ? `ersetzt aus ${Object.entries(p.sources).map(([l, n]) => `${l}${Object.keys(p.sources).length > 1 ? ` (${n})` : ''}`).join(', ')}${p.synthetic ? ' – teilweise synthetisch gefüllt' : ''}` : 'nicht ersetzbar'}${p.unfilled ? `, ${p.unfilled} Tage ohne Ersatz` : ''}${p.overlap ? `; Overlap-Abweichung außerhalb der Lücke median ${String(p.overlap.medianAbsPct).replace('.', ',')} %, p95 ${String(p.overlap.p95AbsPct).replace('.', ',')} % (${p.overlap.n} Tage)` : ''}.` });
  }
  for (const f of q?.unpatched || []) out.push({ level: 'warn', text: `Datenwarnung ${ticker}: ${f.n} gleiche Schlusskurse in Folge ${dd(f.from)}–${dd(f.to)} (${fmtV(f.value)})${f.refMovePct != null ? `, Referenz bewegte sich ${String(f.refMovePct).replace('.', ',')} %` : ''} – vermutlich eingefrorene Yahoo-Daten, nicht korrigiert.` });
  return out;
}
