// RSL26 Holdings: Equity-Kurve der echten Buch-Trades vs. Benchmark (geldgewichtet). Nur lesen — schreibt nie data/rsl-watchlist.json.
// GET /api/fn/rslpnl?filter=TAB-Universum|ALL|SPX|NDX|HDAX|SXXP&bench=^GSPC&fee=1
import { history, batch } from './grokki-data.js';
import { iso } from './grokki-math.js';
import { loadBook } from '../rsl-watchlist.js';
import { canonUniverse, SCAN_UNIVERSES } from './grokki-universes.js';
import { adjustEuSeries, isEuUniverse } from './grokki-eu.js';

export const UNI_CUR = { SPX: 'USD', NDX: 'USD', HDAX: 'EUR', SXXP: 'EUR' };
export const UNI_BENCH = { SPX: '^GSPC', NDX: '^NDX', HDAX: '^GDAXI', SXXP: '^STOXX' };
const BENCH_CUR = { '^GSPC': 'USD', '^NDX': 'USD', '^GDAXI': 'EUR', '^STOXX': 'EUR' };
const DAY = 86400;
const dayOf = (s) => { const t = Date.parse(String(s || '').slice(0, 10) + 'T00:00:00Z'); return Number.isFinite(t) ? t / 1000 : null; };

/** Schlusskurs am Tag t oder davor (bars sortiert). */
function closeAt(bars, t) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= t + DAY - 1) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans >= 0 ? bars[ans].close : null;
}

/**
 * Pure: Tages-Equity der Trades und eines Benchmark-Zwillings.
 * positions: [{symbol, universe, buyDate, buyPrice, qty, closedDate?, sellPrice?}] (qty Bruchstücke erlaubt)
 * seriesBy: Map ticker → bars (in Positionswährung). benchBars: bars der Benchmark (in benchCur).
 * fx(t, from, to): Umrechnungsfaktor (from → to) am Tag t; reportCur: Berichtswährung.
 * Methode: Jeder Kauf ist eine Einzahlung (Kaufkurs × Stück + Gebühr). Der Benchmark-Zwilling kauft am selben Tag mit
 * demselben Geld Indexanteile und verkauft sie am Verkaufstag der Position. Erlöse bleiben als Cash im jeweiligen Konto.
 * Equity = Cash + Marktwert; Einzahlungen kumuliert als Referenzlinie.
 */
export function buildEquity({ positions, seriesBy, benchBars, benchCur = 'USD', reportCur = 'USD', fx = () => 1, fee = 1, today = Math.floor(Date.now() / 1000) }) {
  const trades = [], skipped = [];
  for (const p of positions || []) {
    const b = dayOf(p.buyDate), q = Number(p.qty), bp = Number(p.buyPrice);
    if (b == null || !(q > 0) || !(bp > 0)) { skipped.push({ symbol: p.symbol, reason: !(q > 0) ? 'Stückzahl fehlt' : !(bp > 0) ? 'Kaufkurs fehlt' : 'Kaufdatum fehlt' }); continue; }
    const bars = seriesBy.get(p.symbol);
    const closed = p.status === 'closed' || !!p.closedDate;
    const s = closed ? dayOf(p.closedDate) : null;
    if (!bars?.length && !closed) { skipped.push({ symbol: p.symbol, reason: 'keine Kursdaten' }); continue; }
    trades.push({ ...p, b, s, q, bp, sp: closed ? Number(p.sellPrice) : null, bars: bars || [], cur: UNI_CUR[canonUniverse(p.universe)] || 'USD' });
  }
  if (!trades.length || !benchBars?.length) return { points: [], skipped, trades: 0 };
  const start = Math.min(...trades.map((t) => t.b));
  const days = [];
  for (let t = start; t <= today; t += DAY) { const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) days.push(t); }
  const benchAt = (t) => closeAt(benchBars, t);
  for (const tr of trades) {
    const r = fx(tr.b, tr.cur, reportCur);
    tr.deposit = (tr.bp * tr.q + fee) * r; // in Berichtswährung
    const bc = benchAt(tr.b), rb = fx(tr.b, benchCur, reportCur);
    tr.benchUnits = bc ? ((tr.bp * tr.q) * r) / (bc * rb) : 0; // gleiche Geldmenge (ohne Gebühr) in Indexanteile
  }
  const points = [];
  for (const t of days) {
    let mv = 0, cash = 0, dep = 0, bmv = 0, bcash = 0;
    for (const tr of trades) {
      if (t < tr.b) continue;
      dep += tr.deposit;
      const sold = tr.s != null && t >= tr.s;
      if (sold) {
        const sp = tr.sp > 0 ? tr.sp : closeAt(tr.bars, tr.s);
        cash += (sp * tr.q - fee) * fx(tr.s, tr.cur, reportCur);
        bcash += tr.benchUnits * (benchAt(tr.s) || 0) * fx(tr.s, benchCur, reportCur) - fee * fx(tr.s, tr.cur, reportCur);
      } else {
        const c = closeAt(tr.bars, t) ?? tr.bp;
        mv += c * tr.q * fx(t, tr.cur, reportCur);
        bmv += tr.benchUnits * (benchAt(t) || 0) * fx(t, benchCur, reportCur);
      }
    }
    const equity = mv + cash, bench = bmv + bcash;
    points.push({ date: iso(t), time: t, equity: +equity.toFixed(2), bench: +bench.toFixed(2), deposits: +dep.toFixed(2) });
  }
  const last = points.at(-1);
  return { points, skipped, trades: trades.length, last,
    pnl: last ? +(last.equity - last.deposits).toFixed(2) : null, benchPnl: last ? +(last.bench - last.deposits).toFixed(2) : null };
}

/** FX-Funktion aus EURUSD=X-Bars (USD je EUR). */
export function makeFx(eurUsdBars) {
  return (t, from, to) => {
    if (from === to) return 1;
    const r = eurUsdBars?.length ? closeAt(eurUsdBars, t) ?? eurUsdBars[0].close : null;
    if (!r) return NaN;
    if (from === 'EUR' && to === 'USD') return r;
    if (from === 'USD' && to === 'EUR') return 1 / r;
    return NaN;
  };
}

export default async function rslpnl(q = {}) {
  const t0 = Date.now();
  const f = String(q.filter || q.universe || 'ALL').toUpperCase();
  const filter = f === 'ALL' ? 'ALL' : canonUniverse(f);
  if (filter !== 'ALL' && !SCAN_UNIVERSES.includes(filter)) throw Object.assign(new Error(`filter muss ALL oder ${SCAN_UNIVERSES.join(', ')} sein`), { status: 400 });
  const fee = Number.isFinite(Number(q.fee)) ? Math.max(0, Number(q.fee)) : 1;
  const book = loadBook(); // nur lesen
  const positions = book.positions.filter((p) => filter === 'ALL' || p.universe === filter);
  const curs = [...new Set(positions.map((p) => UNI_CUR[p.universe] || 'USD'))];
  const reportCur = filter === 'ALL' ? (curs.length === 1 ? curs[0] : 'USD') : UNI_CUR[filter];
  const benchOk = Object.keys(BENCH_CUR);
  const bench = benchOk.includes(String(q.bench || '').toUpperCase()) ? String(q.bench).toUpperCase() : (filter === 'ALL' ? (reportCur === 'EUR' ? '^STOXX' : '^GSPC') : UNI_BENCH[filter]);
  if (!positions.length) return { filter, reportCur, bench, points: [], skipped: [], trades: 0, note: 'Keine Positionen im Filter.' };
  const first = Math.min(...positions.map((p) => dayOf(p.buyDate) ?? Infinity));
  const years = Math.max(1, Math.min(15, Math.ceil((Date.now() / 1000 - first) / (365.25 * DAY)) + 1));
  const seriesBy = new Map(), errors = [];
  const byUni = new Map();
  for (const p of positions) { if (!byUni.has(p.universe)) byUni.set(p.universe, new Set()); byUni.get(p.universe).add(p.symbol); }
  for (const [u, set] of byUni) {
    const d = await batch([...set], (t) => history(t, years), 60000, 6);
    const res = isEuUniverse(u) ? (await adjustEuSeries(u, d.results, years)).results : d.results;
    for (const s of res) seriesBy.set(s.ticker, s.bars);
    errors.push(...d.errors);
  }
  const needFx = reportCur !== BENCH_CUR[bench] || curs.some((c) => c !== reportCur);
  let eurUsd = null;
  if (needFx) { try { eurUsd = (await history('EURUSD=X', years)).bars; } catch (e) { errors.push({ ticker: 'EURUSD=X', error: e.message }); } }
  let benchBars = null;
  try { benchBars = (await history(bench, years)).bars; } catch (e) { errors.push({ ticker: bench, error: e.message }); }
  const r = buildEquity({ positions, seriesBy, benchBars, benchCur: BENCH_CUR[bench], reportCur, fx: makeFx(eurUsd), fee });
  return {
    filter, reportCur, bench, benchCur: BENCH_CUR[bench], fee, ...r, errors, ms: Date.now() - t0,
    fxNote: needFx ? `EUR↔USD mit Yahoo EURUSD=X (Tagesschluss am Tag bzw. davor).` : null,
    method: 'Geldgewichtet: Jeder Kauf zahlt Kaufkurs × Stück + Gebühr ein. Der Benchmark-Zwilling kauft am selben Tag mit demselben Geld Indexanteile und verkauft sie am Verkaufstag der Position; Erlöse bleiben als Cash im Konto. Equity = Cash + Marktwert (Tagesschluss, Cache). Gebühr je Order in beiden Konten gleich.',
  };
}
