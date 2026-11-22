// GSW-Daten: Yahoo-Tagesschlüsse über den Terminal-Datenpfad (providers.getCandles + SQLite-Cache, wie RSL),
// auch für die Futures GC=F/SI=F (Datierung je Balken in der Börsenzeitzone, providers.yahooDayOf).
// Signal-Kalender = innerer Verbund von GC=F, SI=F, GLD, SLV (Spalte Close). Das Handelspaar wird per asof
// (letzter Schluss am oder vor dem Signaltag) daraufgelegt; tradable = an diesem Tag haben beide Paar-Instrumente
// einen eigenen Schluss (sonst wartet ein vorgemerkter Swap auf den nächsten gemeinsamen Handelstag).
import { history } from '../fn/grokki-data.js';
import { SPEC_START, yearsBetween } from './math.js';

export const SIGNAL_TICKERS = Object.freeze({ gold: 'GC=F', silver: 'SI=F', GLD: 'GLD', SLV: 'SLV' });

/** Art des Instruments: steuert Default der optionalen Mindesthaltedauer und die Anzeige. */
export const KINDS = Object.freeze({
  'physical-delivery': { id: 'physical-delivery', label: 'physisch mit (bedingtem) Lieferanspruch', short: 'physisch, Lieferanspruch' },
  'physical-no-delivery': { id: 'physical-no-delivery', label: 'physisch ohne Privatanleger-Lieferung', short: 'physisch, ohne Lieferung' },
  'synthetic': { id: 'synthetic', label: 'synthetisch, Futures-Index inkl. Roll, Kontrahentenrisiko besichert', short: 'synthetisch' },
  'futures': { id: 'futures', label: 'Futures (Front-Month)', short: 'Futures' },
});
export const kindInfo = (k) => KINDS[k] || null;
export const defaultHoldOn = (pair) => pair?.kind === 'physical-delivery';

export const PAIRS = Object.freeze({
  GLDSLV: { id: 'GLDSLV', label: 'GLD / SLV', gold: 'GLD', silver: 'SLV', currency: 'USD', venue: 'NYSE Arca', kind: 'physical-no-delivery', note: 'Spec-Paar (v3-Backtest) · physisch hinterlegt, keine Privatanleger-Lieferung' },
  INVESCO: { id: 'INVESCO', label: '8PSG / 8PSB', gold: '8PSG.DE', silver: '8PSB.DE', currency: 'EUR', venue: 'Xetra', isin: ['IE00B579F325', 'IE00B43VDT70'], kind: 'physical-delivery', note: 'Invesco Physical Gold/Silver ETC · physisch, Lieferanspruch bedingt (LBMA-Konto)' },
  XTRACKERS: { id: 'XTRACKERS', label: 'XAD5 / XAD6', gold: 'XAD5.DE', silver: 'XAD6.DE', currency: 'EUR', venue: 'Xetra', isin: ['DE000A1E0HR8', 'DE000A1E0HS6'], kind: 'physical-no-delivery', note: 'Xtrackers Physical Gold/Silver ETC (EUR) · physisch, keine Privatanleger-Lieferung' },
  WTPHL: { id: 'WTPHL', label: 'PHAU.L / PHAG.L', gold: 'PHAU.L', silver: 'PHAG.L', currency: 'USD', venue: 'LSE', isin: ['JE00B1VS3770', 'JE00B1VS3333'], kind: 'physical-no-delivery', note: 'WisdomTree Physical Gold/Silver · keine physische Lieferung für Privatanleger' },
  WTPHM: { id: 'WTPHM', label: 'PHAU.MI / PHAG.MI', gold: 'PHAU.MI', silver: 'PHAG.MI', currency: 'EUR', venue: 'Borsa Italiana', isin: ['JE00B1VS3770', 'JE00B1VS3333'], kind: 'physical-no-delivery', note: 'WisdomTree Physical Gold/Silver · keine physische Lieferung für Privatanleger' },
  WTSWAPL: { id: 'WTSWAPL', label: 'BULL.L / SLVR.L', gold: 'BULL.L', silver: 'SLVR.L', currency: 'USD', venue: 'LSE', isin: ['GB00B15KXX56', 'GB00B15KY328'], kind: 'synthetic', note: 'WisdomTree Gold/Silver · synthetisch, Futures-Index inkl. Roll, Kontrahentenrisiko besichert' },
  WTSWAPM: { id: 'WTSWAPM', label: 'BULL.MI / SLVR.MI', gold: 'BULL.MI', silver: 'SLVR.MI', currency: 'EUR', venue: 'Borsa Italiana', isin: ['GB00B15KXX56', 'GB00B15KY328'], kind: 'synthetic', note: 'WisdomTree Gold/Silver · synthetisch, Futures-Index inkl. Roll, Kontrahentenrisiko besichert' },
  FUTURES: { id: 'FUTURES', label: 'GC=F / SI=F', gold: 'GC=F', silver: 'SI=F', currency: 'USD', venue: 'COMEX (Front-Month, Yahoo)', kind: 'futures', note: 'Futures-Endloskontrakt, Rollsprünge nicht bereinigt' },
});

const EUR_SUFFIX = /\.(DE|F|SG|MU|BE|DU|HM|HA|AS|PA|MI|MC|BR|LS|VI|HE|IR)$/;
// .L wird für benutzerdefinierte Ticker als GBP geraten. LSE-USD-Notierungen (z. B. PHAU.L) müssen die Währung
// ausdrücklich setzen; die Vorbelegung WTPHL tut das (Yahoo-Währung der PHAU.L/PHAG.L-Serie ist USD, nicht GBp).
export function guessCurrency(t) { const s = String(t || '').toUpperCase(); return EUR_SUFFIX.test(s) ? 'EUR' : s.endsWith('.L') ? 'GBP' : s.endsWith('.SW') ? 'CHF' : 'USD'; }
const TICKER = /^[A-Z0-9^][A-Z0-9._=^-]{0,19}$/;
export function normTicker(t, label) {
  const s = String(t || '').trim().toUpperCase();
  if (!TICKER.test(s)) throw Object.assign(new Error(`${label}: Ticker ungültig (Yahoo-Symbol, z. B. 8PSG.DE)`), { status: 400 });
  return s;
}

/** Handelspaar aus Settings ({pairId, custom:{gold,silver,currency}}). */
export function resolvePair(s = {}) {
  const id = String(s.pairId || 'GLDSLV').toUpperCase();
  if (PAIRS[id]) return { ...PAIRS[id] };
  if (id !== 'CUSTOM') throw Object.assign(new Error(`Handelspaar unbekannt: ${id}`), { status: 400 });
  const gold = normTicker(s.custom?.gold, 'Gold-Instrument'), silver = normTicker(s.custom?.silver, 'Silber-Instrument');
  const cur = String(s.custom?.currency || '').trim().toUpperCase() || guessCurrency(gold);
  if (!/^[A-Z]{3}$/.test(cur)) throw Object.assign(new Error('Währung als ISO-Code (USD, EUR …)'), { status: 400 });
  return { id: 'CUSTOM', label: `${gold} / ${silver}`, gold, silver, currency: cur, venue: 'benutzerdefiniert', kind: null, note: 'eigene Ticker' };
}

const dayIso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const closeMap = (bars) => { const m = new Map(); for (const b of bars) m.set(dayIso(b.time), b.close); return m; };

/** Pure: Datensatz aus Bar-Listen bauen (auch im Test ohne Netz nutzbar). */
export function buildDataset({ bars, pair, fxBars = null, start = SPEC_START, end = null }) {
  const M = Object.fromEntries(Object.entries(SIGNAL_TICKERS).map(([k, t]) => [k, closeMap(bars[t] || [])]));
  let dates = [...M.GLD.keys()].filter((d) => M.SLV.has(d) && M.gold.has(d) && M.silver.has(d) && d >= start && (!end || d <= end)).sort();
  if (dates.length < 2) throw Object.assign(new Error('Keine gemeinsamen Kursdaten für GC=F, SI=F, GLD, SLV'), { status: 502 });
  const F = (m) => Float64Array.from(dates, (d) => m.get(d));
  const ds = { dates, gold: F(M.gold), silver: F(M.silver), GLD: F(M.GLD), SLV: F(M.SLV), pair, tradable: null, tradeFrom: 0, notes: [] };
  if (pair.gold === 'GLD' && pair.silver === 'SLV') { ds.pg = ds.GLD; ds.ps = ds.SLV; }
  else if (pair.gold === 'GC=F' && pair.silver === 'SI=F') { ds.pg = ds.gold; ds.ps = ds.silver; }
  else {
    const g = [...(bars[pair.gold] || [])].sort((a, b) => a.time - b.time), s = [...(bars[pair.silver] || [])].sort((a, b) => a.time - b.time);
    if (!g.length || !s.length) throw Object.assign(new Error(`Keine Kursdaten für ${!g.length ? pair.gold : pair.silver}`), { status: 502 });
    const gm = closeMap(g), sm = closeMap(s);
    const n = dates.length; ds.pg = new Float64Array(n).fill(NaN); ds.ps = new Float64Array(n).fill(NaN); ds.tradable = new Uint8Array(n);
    let gi = 0, si = 0, lg = NaN, ls = NaN; const gd = g.map((b) => dayIso(b.time)), sd = s.map((b) => dayIso(b.time));
    let stale = 0;
    for (let i = 0; i < n; i++) {
      const d = dates[i];
      while (gi < g.length && gd[gi] <= d) lg = g[gi++].close;
      while (si < s.length && sd[si] <= d) ls = s[si++].close;
      ds.pg[i] = lg; ds.ps[i] = ls; ds.tradable[i] = gm.has(d) && sm.has(d) ? 1 : 0;
      if (!ds.tradable[i] && Number.isFinite(lg) && Number.isFinite(ls)) stale++;
    }
    ds.tradeFrom = ds.tradable.findIndex((v, i) => v && Number.isFinite(ds.pg[i]) && Number.isFinite(ds.ps[i]));
    if (ds.tradeFrom < 0) throw Object.assign(new Error('Handelspaar hat im Zeitraum keine gemeinsamen Handelstage'), { status: 502 });
    if (ds.tradeFrom > 0) ds.notes.push(`Kürzere Historie: ${pair.label} handelbar erst ab ${dates[ds.tradeFrom]}; Backtest startet dort (Signal ab ${dates[0]}).`);
    if (stale) ds.notes.push(`${stale} Signaltage ohne eigenen Schluss im Paar (Feiertage/abweichender Kalender): dort Bewertung mit letztem Schluss, ein fälliger Swap wird am nächsten gemeinsamen Handelstag ausgeführt.`);
    if (pair.currency !== 'USD') ds.notes.push(`Paar in ${pair.currency} gehandelt; Signal bleibt GLD/SLV × k (USD). Equity und Kosten in ${pair.currency}; Wechselkursbewegungen wirken auf beide Beine gleich.`);
  }
  // Gold-Unzen-Äquivalent: Equity (Paarwährung) × FX (USD je Einheit) / GC=F
  ds.ozf = new Float64Array(dates.length);
  if (pair.currency === 'USD') for (let i = 0; i < dates.length; i++) ds.ozf[i] = 1 / ds.gold[i];
  else if (fxBars?.length) {
    const f = [...fxBars].sort((a, b) => a.time - b.time), fd = f.map((b) => dayIso(b.time)); let k = 0, last = NaN;
    for (let i = 0; i < dates.length; i++) { while (k < f.length && fd[k] <= dates[i]) last = f[k++].close; ds.ozf[i] = last / ds.gold[i]; }
  } else { ds.ozf.fill(NaN); ds.notes.push(`Kein Wechselkurs ${pair.currency}/USD: Gold-Unzen-Äquivalent nicht berechenbar.`); }
  return ds;
}

export const load = (t, years) => history(t, years);

/** Live-Daten laden (Terminal-Cache). */
export async function loadDataset({ pair, start = SPEC_START, end = null }) {
  const years = Math.max(2, Math.ceil(yearsBetween(start, new Date().toISOString().slice(0, 10))) + 1);
  const tickers = [...new Set([...Object.values(SIGNAL_TICKERS), pair.gold, pair.silver])];
  const fxT = pair.currency !== 'USD' ? `${pair.currency}USD=X` : null;
  const bars = {}, errors = [], meta = {};
  await Promise.all(tickers.map(async (t) => {
    try { const h = await load(t, years); bars[t] = h.bars; meta[t] = { asOf: h.asOf, provider: h.provider, fromCache: h.fromCache, first: dayIso(h.bars[0].time) }; }
    catch (e) { errors.push({ ticker: t, error: e.message }); }
  }));
  let fxBars = null;
  if (fxT) { try { fxBars = (await history(fxT, years)).bars; } catch (e) { errors.push({ ticker: fxT, error: e.message }); } }
  const miss = errors.filter((e) => tickers.includes(e.ticker));
  if (miss.length) throw Object.assign(new Error(`Kursdaten fehlen: ${miss.map((e) => `${e.ticker} (${e.error})`).join('; ')}`), { status: 502 });
  const ds = buildDataset({ bars, pair, fxBars, start, end });
  ds.meta = meta; ds.errors = errors; ds.fxTicker = fxT;
  return ds;
}
