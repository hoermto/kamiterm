// GSW-Engine auf einem alignierten Datensatz (siehe lib/gsw/data.js oder Fixture im Test).
// ds = { dates[], gold, silver, GLD, SLV (Float64Array, Signal-Kalender = innerer Verbund der 4 US-Reihen),
//        pg, ps (Handelspaar, auf den Signal-Kalender per asof gelegt), tradable (Uint8Array|null), ozf (Equity → Gold-oz),
//        tradeFrom (erster Index, an dem das Paar handelbar ist), pair {gold, silver, currency, label} }
import { signalSeries, runCore, metrics, gridCells, neighbourMean, pickRobust, ranks, asofIdx, firstOnOrAfter, addYears, CAP, DEFAULT_PARAMS, normTax, yearsBetween } from './math.js';

export function sigFor(ds, window) {
  ds._sig ||= new Map();
  if (!ds._sig.has(window)) ds._sig.set(window, signalSeries(ds, window));
  return ds._sig.get(window);
}

/** Start-/Endindex innerhalb des Datensatzes (Start frühestens am ersten handelbaren Tag des Paars). */
export function span(ds, { start, end } = {}) {
  let from = start ? firstOnOrAfter(ds.dates, start) : 0;
  from = Math.max(from, ds.tradeFrom || 0);
  let to = end ? asofIdx(ds.dates, end) + 1 : ds.dates.length;
  if (to - from < 2) throw Object.assign(new Error('Zu wenige Handelstage im gewählten Zeitraum'), { status: 400 });
  return { from, to };
}

const normParams = (p = {}) => {
  const q = { ...DEFAULT_PARAMS, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, Number(v)])) };
  for (const k of ['U1', 'L1', 'S', 'L2', 'window', 'costPct']) if (!Number.isFinite(q[k])) throw Object.assign(new Error(`Parameter ${k} ungültig`), { status: 400 });
  if (!(q.L1 < q.U1)) throw Object.assign(new Error('Ausstieg (L1) muss unter Einstieg (U1) liegen'), { status: 400 });
  if (!(q.S > q.U1)) throw Object.assign(new Error('Spike (S) muss über Einstieg (U1) liegen'), { status: 400 });
  if (!(q.L2 < q.L1)) throw Object.assign(new Error('Spike-Exit (L2) muss unter Ausstieg (L1) liegen'), { status: 400 });
  q.window = Math.round(q.window); if (q.window < 1 || q.window > 500) throw Object.assign(new Error('Median-Fenster 1–500'), { status: 400 });
  if (q.costPct < 0 || q.costPct > 5) throw Object.assign(new Error('Kosten 0–5 %'), { status: 400 });
  return q;
};
export { normParams };

function tradeRows(ds, s, r, from) {
  const rows = r.trades.map((t) => {
    const rule0 = t.dir === 1 ? 'Einstieg > U1' : t.spike ? 'Spike-Exit < L2' : 'normal < L1';
    const rule = t.deferred ? `${rule0} (aufgeschoben, +${t.delayCal} Tage)` : rule0;
    const tx = 'tax' in t ? { tax: t.tax, gain: t.gain, taxFree: !!t.taxFree, lossOffset: t.lossOffset, lossPotAfter: t.lossPotAfter } : {};
    return { ...tx,
      signalDate: ds.dates[t.sigI], execDate: ds.dates[t.i], dir: t.dir === 1 ? 'Gold→Silber' : 'Silber→Gold',
      rule, deferred: !!t.deferred, delayCal: t.delayCal ?? null,
      sig: s.sig[t.sigI], ratioEtf: s.etf[t.sigI], ratioSpot: s.spot[t.sigI],
      execGold: ds.pg[t.i], execSilver: ds.ps[t.i], equityAfter: r.eq[t.i - from], goldOzAfter: r.eq[t.i - from] * ds.ozf[t.i],
    };
  });
  for (const t of r.lapsed || []) rows.push({
    signalDate: ds.dates[t.sigI], execDate: ds.dates[t.i], dir: t.dir === 1 ? 'Gold→Silber' : 'Silber→Gold',
    rule: 'entfallen (nach Frist will die Regel das andere Metall nicht mehr)', lapsed: true, deferred: true,
    sig: s.sig[t.sigI], ratioEtf: s.etf[t.sigI], ratioSpot: s.spot[t.sigI],
    execGold: null, execSilver: null, equityAfter: null, goldOzAfter: null,
  });
  rows.sort((a, b) => String(a.signalDate).localeCompare(String(b.signalDate)) || String(a.execDate).localeCompare(String(b.execDate)));
  return rows;
}

/** Ein Lauf mit festen Parametern (oder Arrays je Tag) inkl. Kurve, Trades, Buy & Hold des Paars. */
export function backtest(ds, params, { start, end, cap = CAP, startPos = 0, arrays = null, holdDays = 0, tax = null } = {}) {
  const q = arrays ? null : normParams(params);
  const { from, to } = span(ds, { start, end });
  const s = arrays ? arrays.sig : sigFor(ds, q.window);
  const P = arrays ? { U1: arrays.U1, L1: arrays.L1, S: arrays.S, L2: arrays.L2, cost: arrays.cost } : { U1: q.U1, L1: q.L1, S: q.S, L2: q.L2, cost: q.costPct / 100 };
  const hd = Number(holdDays) > 0 ? Number(holdDays) : 0;
  const r = runCore({ sig: s.sig, pg: ds.pg, ps: ds.ps, tradable: ds.tradable, ...P, cap, startPos, from, to, ozf: ds.ozf, dates: ds.dates, holdDays: hd, tax: normTax(tax) });
  const m = metrics({ dates: ds.dates, eq: r.eq, cap, ozf: ds.ozf, from });
  const bh = (arr) => { const out = new Float64Array(to - from); for (let i = from; i < to; i++) out[i - from] = cap * arr[i] / arr[from]; return out; };
  const bhG = bh(ds.pg), bhS = bh(ds.ps);
  const mG = metrics({ dates: ds.dates, eq: bhG, cap, ozf: ds.ozf, from }), mS = metrics({ dates: ds.dates, eq: bhS, cap, ozf: ds.ozf, from });
  const trades = tradeRows(ds, s, r, from);
  const X = r.tax;
  const taxM = { taxMode: X.mode, taxPaid: X.paid, lossCarry: X.lossCarry, liqTax: X.liqTax, liqTaxFree: X.liqTaxFree, endValueAfterLiq: X.endAfterLiq,
    cagrAfterLiq: m.years > 0 && X.endAfterLiq > 0 ? Math.pow(X.endAfterLiq / cap, 1 / m.years) - 1 : null, taxP23: !!X.p23 };
  return {
    params: q, from, to, holdDays: hd, tax: X,
    metrics: { ...m, ...taxM, switches: r.trades.length, timeInSilver: r.silverDays / r.days, silverDays: r.silverDays, deferred: r.hold.deferred, lapsed: r.hold.lapsed, avgDelay: r.hold.avgDelay, holdDays: hd },
    final: r.final, trades, lapsed: r.lapsed, hold: r.hold, eq: r.eq, pos: r.pos, bhGold: bhG, bhSilver: bhS, bhMetrics: { gold: mG, silver: mS }, sig: s,
  };
}

/**
 * Grid: jede Zelle läuft fortlaufend ab Start; oz an Checkpoints (Walk-Forward-Jahrestage, OOS-Start) und am Ende.
 * Danach Nachbarschaftsmittel je Checkpoint (robust.py). onProgress(done, total).
 */
export function runGrid(ds, grid, { start, end, wfStart = null, oosStart = null, maxCells = 250000, onProgress = null, holdDays = 0, tax = null } = {}) {
  const T = normTax(tax);
  const cells = gridCells(grid);
  if (!cells.length) throw Object.assign(new Error('Grid leer: prüfe Bedingungen L2 < L1 und S > U1'), { status: 400 });
  if (cells.length > maxCells) throw Object.assign(new Error(`Grid zu groß (${cells.length} Zellen, Limit ${maxCells})`), { status: 400 });
  const { from, to } = span(ds, { start, end });
  const wfIdx = [];
  if (wfStart) {
    for (let k = 0; ; k++) {
      const d = addYears(wfStart, k); if (d >= ds.dates[to - 1]) break;
      const i = asofIdx(ds.dates, d); if (i >= from && i < to - 1 && !wfIdx.includes(i)) wfIdx.push(i);
    }
  }
  let oosIdx = null;
  if (oosStart) { const i = asofIdx(ds.dates, oosStart); if (i >= from && i < to - 1) oosIdx = i; }
  const ck = [...new Set([...wfIdx, ...(oosIdx != null ? [oosIdx] : []), to - 1])].sort((x, y) => x - y);
  const ckDates = ck.map((i) => ds.dates[i]);
  const ozCk = ck.map(() => new Float64Array(cells.length));
  const usd = new Float64Array(cells.length), taxPaid = new Float64Array(cells.length), usdLiq = new Float64Array(cells.length), dd = new Float64Array(cells.length), sw = new Uint32Array(cells.length), silv = new Float64Array(cells.length);
  const t0 = Date.now();
  cells.forEach((c, j) => {
    const s = sigFor(ds, c.window);
    const r = runCore({ sig: s.sig, pg: ds.pg, ps: ds.ps, tradable: ds.tradable, U1: c.U1, L1: c.L1, S: c.S, L2: c.L2, cost: c.costPct / 100, from, to, keepEquity: false, ozf: ds.ozf, ck, dates: ds.dates, holdDays, tax: T });
    ck.forEach((_, k) => { ozCk[k][j] = r.ckOz[k]; });
    usd[j] = r.final.equity; taxPaid[j] = r.tax.paid; usdLiq[j] = r.tax.endAfterLiq; dd[j] = r.maxdd; sw[j] = r.trades.length; silv[j] = r.silverDays / r.days;
    if (onProgress && (j % 500 === 0 || j === cells.length - 1)) onProgress(j + 1, cells.length);
  });
  const nbCk = ozCk.map((v) => neighbourMean(cells, Array.from(v)));
  return { cells, ck, ckDates, ozCk, nbCk, usd, taxPaid, usdLiq, tax: T, dd, sw, silv, from, to, ms: Date.now() - t0, holdDays: Number(holdDays) > 0 ? Number(holdDays) : 0,
    wfK: wfIdx.map((i) => ck.indexOf(i)), oosK: oosIdx != null ? ck.indexOf(oosIdx) : null };
}

/** Robuste Auswahl am Checkpoint k (nur Daten bis dahin). */
export function pickAt(G, k) { const j = pickRobust(G.cells, Array.from(G.ozCk[k]), G.nbCk[k]); const c = G.cells[j]; return { U1: c.U1, L1: c.L1, S: c.S, L2: c.L2, window: c.window, costPct: c.costPct }; }

/** Zusammenfassung der Grid-Zeilen (sortierbar in der UI): rohe und robuste Rangliste am Ende. */
export function gridRows(G, { limit = 2000 } = {}) {
  const e = G.ozCk.length - 1;
  const raw = Array.from(G.ozCk[e]), nb = G.nbCk[e];
  const rr = ranks(raw), rn = ranks(nb);
  const rows = G.cells.map((c, j) => ({ U1: c.U1, L1: c.L1, S: c.S, L2: c.L2, window: c.window, costPct: c.costPct, ozEnd: raw[j], nbOzEnd: nb[j], rankRaw: rr[j], rankRobust: rn[j], endValue: G.usd[j], taxPaid: G.taxPaid ? G.taxPaid[j] : 0, endValueAfterLiq: G.usdLiq ? G.usdLiq[j] : G.usd[j], maxdd: G.dd[j], switches: G.sw[j], timeInSilver: G.silv[j] }));
  const best = rows.filter((r) => r.rankRobust <= limit || r.rankRaw <= Math.min(limit, 200));
  best.sort((a, b) => a.rankRobust - b.rankRobust);
  return { rows: best, total: rows.length, robustBest: rows.find((r) => r.rankRobust === 1), rawBest: rows.find((r) => r.rankRaw === 1), pick: rows[pickRobust(G.cells, raw, nb)] };
}

/** Jährliches Walk-Forward (compare.py): je Jahrestag Zelle mit max. Nachbarschaftsmittel der oz bis dahin; Neustart mit cap am WF-Start. */
export function walkForward(ds, G, { cap = CAP } = {}) {
  if (!G.wfK.length) throw Object.assign(new Error('Walk-Forward braucht mindestens einen Jahrestag vor dem Ende'), { status: 400 });
  const plan = G.wfK.map((k) => ({ from: G.ck[k], date: G.ckDates[k], ...pickAt(G, k) }));
  const n = ds.dates.length, A = { U1: new Float64Array(n), L1: new Float64Array(n), S: new Float64Array(n), L2: new Float64Array(n), cost: new Float64Array(n) };
  const sig = new Float64Array(n), etf = new Float64Array(n), spot = new Float64Array(n);
  plan.forEach((p, k) => {
    const s = sigFor(ds, p.window), stop = k + 1 < plan.length ? plan[k + 1].from : G.to;
    for (let i = p.from; i < stop; i++) { A.U1[i] = p.U1; A.L1[i] = p.L1; A.S[i] = p.S; A.L2[i] = p.L2; A.cost[i] = p.costPct / 100; sig[i] = s.sig[i]; etf[i] = s.etf[i]; spot[i] = s.spot[i]; }
  });
  const r = backtest(ds, null, { start: plan[0].date, end: ds.dates[G.to - 1], cap, arrays: { ...A, sig: { sig, etf, spot } }, holdDays: G.holdDays || 0, tax: G.tax || null });
  return { plan, ...r };
}

/** Signal am letzten Tag nach dem Zustand (für die Live-Anzeige): würde ein Swap für den nächsten Schluss vorgemerkt? */
export function lastDaySignal(r, q) {
  const n = r.sig.sig.length, i = r.to - 1, sig = r.sig.sig[i];
  const { pos, spike } = r.final;
  if (pos === 0 && sig > q.U1) return { due: 'silver', rule: `sig ${sig.toFixed(2)} > U1 ${q.U1}`, signalIdx: i };
  if (pos === 1) { const lvl = spike ? q.L2 : q.L1; if (sig < lvl) return { due: 'gold', rule: `sig ${sig.toFixed(2)} < ${spike ? 'L2' : 'L1'} ${lvl}`, signalIdx: i }; }
  return { due: null, n };
}
