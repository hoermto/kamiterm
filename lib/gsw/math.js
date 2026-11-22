// Gold/Silber-Swap (GSW): reine Rechenfunktionen, keine I/O. Spezifikation:
// /workspace/thoBox/Grokki/strategies/Gold_Silber_Swap_Spec.md (v3-Engine, Hybrid 90/82, Spike 100→66).
// Signal fix: sig = (GLD/SLV) × k_w, k_w = kausaler w-Tage-Median von (GC=F/SI=F)/(GLD/SLV) (min_periods=1).
// Zustandsautomat je Tag i: 1) pending ausführen (am Schluss, 0,1 % je Seite), 2) Equity markieren,
// 3) in Silber und sig > S → spike, 4) (nicht letzter Tag) Gold & sig > U1 → pending Silber; Silber & sig < (spike ? L2 : L1) → pending Gold.

export const DEFAULT_PARAMS = Object.freeze({ U1: 90, L1: 82, S: 100, L2: 66, window: 60, costPct: 0.1 });
export const SPEC_START = '2016-10-21';
export const CAP = 10000;

/** Kausaler rollierender Median (Fenster w, min_periods=1), wie pandas rolling(w, min_periods=1).median(). */
export function rollingMedian(x, w) {
  const n = x.length, out = new Float64Array(n), win = [];
  for (let i = 0; i < n; i++) {
    // sortiertes Fenster pflegen: einfügen, ggf. ältesten Wert entfernen
    const v = x[i];
    let lo = 0, hi = win.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; }
    win.splice(lo, 0, v);
    if (i >= w) {
      const old = x[i - w];
      let a = 0, b = win.length - 1;
      while (a <= b) { const m = (a + b) >> 1; if (win[m] < old) a = m + 1; else if (win[m] > old) b = m - 1; else { a = m; break; } }
      win.splice(a, 1);
    }
    const L = win.length;
    out[i] = L % 2 ? win[(L - 1) >> 1] : (win[L / 2 - 1] + win[L / 2]) / 2;
  }
  return out;
}

/** Signalreihen aus alignierten Schlusskursen (Arrays gleicher Länge). */
export function signalSeries({ gold, silver, GLD, SLV }, window = 60) {
  const n = GLD.length, etf = new Float64Array(n), spot = new Float64Array(n), k = new Float64Array(n);
  for (let i = 0; i < n; i++) { etf[i] = GLD[i] / SLV[i]; spot[i] = gold[i] / silver[i]; k[i] = spot[i] / etf[i]; }
  const k60 = rollingMedian(k, window), sig = new Float64Array(n);
  for (let i = 0; i < n; i++) sig[i] = etf[i] * k60[i];
  return { etf, spot, k, kMed: k60, sig };
}


const DAY_MS = 86400000;
export const isLeapYear = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
export const daysInMonth = (y, m) => [0, 31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
const pad2 = (n) => String(n).padStart(2, '0');
/** Kalenderjahre addieren; 29.2. in einem Nicht-Schaltjahr wird zum 28.2. */
export function addCalendarYears(iso, k) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  const ny = y + k;
  return `${ny}-${pad2(m)}-${pad2(Math.min(d, daysInMonth(ny, m)))}`;
}
/** Kalendertage addieren (UTC-Datum, ohne Uhrzeitverschiebung). */
export function addCalendarDays(iso, n) {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
}
export const calendarDaysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);

/**
 * Erster Tag nach Ablauf der Haltefrist (ISO).
 * days === 365 (Default, Steuerformel): Kaufdatum + 1 Kalenderjahr (29.2.→28.2.) + 1 Tag = „steuerfrei ab“.
 * Anderer Wert N: Kaufdatum + N Kalendertage (erster Tag, an dem die Position nicht mehr jünger als N Tage ist).
 */
export function holdUnlockDate(buy, days = 365) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0 || !buy) return buy;
  if (n === 365) return addCalendarDays(addCalendarYears(buy, 1), 1);
  return addCalendarDays(buy, n);
}
export const taxFreeFrom = holdUnlockDate;
export const inHoldPeriod = (buy, asOf, days = 365) => !!(buy && asOf && asOf < holdUnlockDate(buy, days));
export const restHoldDays = (buy, asOf, days = 365) => Math.max(0, calendarDaysBetween(asOf, holdUnlockDate(buy, days)));

const at = (p, i) => (typeof p === 'number' ? p : p[i]);

/** Abgeltungsteuer 25 % + Soli 5,5 % darauf = 26,375 % (ohne Kirchensteuer). */
export const KEST_RATE = 0.26375;
/**
 * Steuer-Einstellung normalisieren. null/mode 'none' → null (Rohertrag, keine Steuer).
 * { mode: 'kest', rate (Anteil, Default 0.26375), p23 (bool: §23-Regel mit 1-Jahres-Frist), p23Rate (Anteil, Default = rate), allowance (je Kalenderjahr, Default 0) }
 */
export function normTax(t) {
  if (!t || t.mode !== 'kest') return null;
  const num = (v, d) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const rate = num(t.rate, KEST_RATE);
  return { mode: 'kest', rate, p23: !!t.p23, p23Rate: num(t.p23Rate, rate), allowance: Math.max(0, num(t.allowance, 0)) };
}

/**
 * v3-Kern. sig, pg, ps: Float64Array (pg/ps = Kurse des Handelspaars, ggf. ffill).
 * tradable (optional): true, wenn das Paar an Tag i einen echten Schluss hat; pending wartet sonst auf den nächsten solchen Tag.
 * U1/L1/S/L2/cost: Zahl oder Array je Tag. cost als Anteil (0.001). Startposition 0 = Gold.
 * ozf (optional): Faktor je Tag, Equity → Gold-Unzen (fx / GC=F). ck: Indizes, an denen oz gespeichert wird.
 * dates + holdDays (optional): Swap-Sperre. Zustandsmaschine (inkl. Spike, Pendeln am Signal) unverändert.
 * Ausführung nur, wenn dates[i] >= holdUnlockDate(Anschaffung, holdDays). Anschaffung = Start bzw. letzter Swap.
 * War ein Swap während der Frist vorgemerkt, wird am ersten handelbaren Tag ab Fristende ausgeführt,
 * sofern die Maschine dann noch das andere Metall will; sonst entfällt er. Ohne Sperre identisch zur Spec
 * (T+1, auch wenn das Signal am Ausführungstag schon wieder weg ist — Nachprüfung nur nach Aufschub).
 * tax (optional, normTax): Steuer bei Realisierung (Swap = Verkauf + Neukauf). Gewinn = Nettoerlös (nach Verkaufskosten)
 * − Anschaffungskosten (eingesetzter Betrag inkl. Kaufkosten). Steuer wird aus dem Erlös bezahlt (weniger reinvestiert).
 * Verluste → Verlusttopf, gegen spätere Gewinne verrechnet. Optional Pauschbetrag je Kalenderjahr (nur KapESt).
 * p23: Gewinne/Verluste ab „steuerfrei ab“ (Anschaffung + 1 Jahr + 1 Tag) steuerfrei, davor mit p23Rate.
 * Am Ende: fiktive Liquidationssteuer auf den unrealisierten Gewinn (separat, Equity bleibt vor Liquidation).
 */
export function runCore({ sig, pg, ps, tradable = null, U1, L1, S, L2, cost = 0.001, cap = CAP, startPos = 0, from = 0, to = sig.length, keepEquity = true, ozf = null, ck = null, dates = null, holdDays = 0, tax = null }) {
  const n = to - from;
  const eq = keepEquity ? new Float64Array(n) : null;
  const pos = keepEquity ? new Uint8Array(n) : null;
  const trades = [];
  const lapsed = [];
  const holdOn = Number(holdDays) > 0 && Array.isArray(dates);
  const want = (i, p, spike) => {
    if (p === 0 && sig[i] > at(U1, i)) return 1;
    if (p === 1 && sig[i] < (spike === 1 ? at(L2, i) : at(L1, i))) return -1;
    return 0;
  };
  let p = startPos, spike = 0, pend = 0, psig = -1;
  let sh = cap * (1 - at(cost, from)) / (p === 0 ? pg[from] : ps[from]);
  let peak = -Infinity, maxdd = 0, last = 0, silverDays = 0;
  let acqI = from, unlock = holdOn ? holdUnlockDate(dates[from], holdDays) : null, block = null;
  const T = normTax(tax);
  let basis = cap, acqDate = dates ? dates[from] : null, lossPot = 0, taxPaid = 0;
  const allowUsed = {};
  /** Steuer auf einen realisierten Gewinn g am Tag d (ISO); mutiert Verlusttopf und Pauschbetrag. */
  const realize = (g, d) => {
    if (T.p23 && d && acqDate && d >= holdUnlockDate(acqDate, 365)) return { tax: 0, free: true, offset: 0, allowance: 0 };
    if (!(g > 0)) { lossPot += -g; return { tax: 0, free: false, offset: 0, allowance: 0 }; }
    const off = Math.min(lossPot, g); lossPot -= off;
    let rest = g - off, al = 0;
    if (!T.p23 && T.allowance > 0 && d) {
      const y = d.slice(0, 4); al = Math.min(Math.max(0, T.allowance - (allowUsed[y] || 0)), rest);
      allowUsed[y] = (allowUsed[y] || 0) + al; rest -= al;
    }
    return { tax: rest * (T.p23 ? T.p23Rate : T.rate), free: false, offset: off, allowance: al };
  };
  const ckOz = ck ? new Float64Array(ck.length).fill(NaN) : null;
  let ckj = 0;
  for (let i = from; i < to; i++) {
    if (pend !== 0 && (!tradable || tradable[i])) {
      if (holdOn && dates[i] < unlock) {
        if (!block) block = { sigI: psig };
      } else if (holdOn && block && !want(i, p, spike)) {
        lapsed.push({ i, sigI: block.sigI, dir: pend, spike });
        pend = 0; psig = -1; block = null;
      } else {
        const c = at(cost, i);
        const net = sh * (p === 0 ? pg[i] : ps[i]) * (1 - c);
        let tx = null;
        if (T) {
          const gain = net - basis, R = realize(gain, dates ? dates[i] : null);
          tx = { tax: R.tax, gain, basis, proceeds: net, taxFree: R.free, lossOffset: R.offset, allowance: R.allowance, lossPotAfter: lossPot };
          taxPaid += R.tax;
        }
        const val = tx ? net - tx.tax : net;
        p = 1 - p;
        sh = val * (1 - c) / (p === 0 ? pg[i] : ps[i]);
        basis = val; acqDate = dates ? dates[i] : null;
        const rec = { i, sigI: psig, dir: p === 1 ? 1 : -1, spike };
        if (tx) Object.assign(rec, tx);
        if (block) {
          rec.deferred = true;
          rec.delayCal = calendarDaysBetween(dates[block.sigI], dates[i]);
        }
        trades.push(rec);
        if (p === 0) spike = 0;
        pend = 0; psig = -1; block = null;
        if (holdOn) { acqI = i; unlock = holdUnlockDate(dates[i], holdDays); }
      }
    }
    const e = sh * (p === 0 ? pg[i] : ps[i]);
    if (keepEquity) { eq[i - from] = e; pos[i - from] = p; }
    if (p === 1) silverDays++;
    if (e > peak) peak = e; else { const d = e / peak - 1; if (d < maxdd) maxdd = d; }
    last = e;
    if (ck) while (ckj < ck.length && ck[ckj] <= i) { if (ck[ckj] === i) ckOz[ckj] = e * ozf[i]; ckj++; }
    if (p === 1 && sig[i] > at(S, i)) spike = 1;
    if (i < to - 1 && pend === 0) {
      const w = want(i, p, spike);
      if (w) { pend = w; psig = i; }
    }
  }
  const defN = trades.filter((x) => x.deferred).length;
  const delays = trades.filter((x) => x.deferred).map((x) => x.delayCal);
  const hold = {
    days: holdOn ? Number(holdDays) : 0,
    deferred: defN,
    lapsed: lapsed.length,
    avgDelay: delays.length ? delays.reduce((s, v) => s + v, 0) / delays.length : null,
    pendingDeferred: !!(pend && block),
  };
  let taxOut = { mode: 'none', paid: 0, lossCarry: 0, liqGain: null, liqTax: 0, liqTaxFree: false, endAfterLiq: last, basis: null };
  if (T) {
    const lp0 = lossPot, au0 = { ...allowUsed };
    const g = last - basis, R = realize(g, dates ? dates[to - 1] : null);
    taxOut = { mode: 'kest', rate: T.rate, p23: T.p23, p23Rate: T.p23Rate, allowance: T.allowance, paid: taxPaid, lossCarry: lp0, liqGain: g, liqTax: R.tax, liqTaxFree: R.free, lossCarryAfterLiq: lossPot, endAfterLiq: last - R.tax, basis, acqDate };
    lossPot = lp0; Object.keys(allowUsed).forEach((k) => delete allowUsed[k]); Object.assign(allowUsed, au0);
  }
  return { eq, pos, trades, lapsed, hold, tax: taxOut, final: { pos: p, spike, pending: pend, pendingSigIdx: pend ? psig : null, shares: sh, equity: last }, maxdd, silverDays, days: n, ckOz };
}

export const yearsBetween = (d0, d1) => (Date.parse(d1 + 'T00:00:00Z') - Date.parse(d0 + 'T00:00:00Z')) / DAY_MS / 365.25;

/** Kennzahlen wie v3 metrics(): CAGR auf cap (nicht 9.990), MaxDD auf Equity; Sharpe neu (Tagesrenditen, rf = 0, √252). */
export function metrics({ dates, eq, cap = CAP, ozf = null, from = 0 }) {
  const n = eq.length, end = eq[n - 1];
  const yrs = yearsBetween(dates[from], dates[from + n - 1]);
  let peak = -Infinity, dd = 0, ddAt = null, s = 0, s2 = 0, m = 0;
  for (let i = 0; i < n; i++) {
    if (eq[i] > peak) peak = eq[i];
    const d = eq[i] / peak - 1; if (d < dd) { dd = d; ddAt = dates[from + i]; }
    if (i) { const r = eq[i] / eq[i - 1] - 1; s += r; s2 += r * r; m++; }
  }
  const mean = m ? s / m : 0, sd = m > 1 ? Math.sqrt((s2 - m * mean * mean) / (m - 1)) : 0;
  return {
    endValue: end, cagr: yrs > 0 ? Math.pow(end / cap, 1 / yrs) - 1 : null, maxdd: dd, maxddDate: ddAt,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(252) : null, years: yrs,
    goldOz: ozf ? end * ozf[from + n - 1] : null, startDate: dates[from], endDate: dates[from + n - 1], days: n,
  };
}

/** Standard-Hybrid-Grid wie v3 grid.py (U1 78–96, gap {2,3,4,5,6,8,10,12,14}, S 92–112/2, L2 60–78/2; L2 < L1, S > U1). */
export const SPEC_GRID = Object.freeze({
  U1: range(78, 96, 1), gap: [2, 3, 4, 5, 6, 8, 10, 12, 14], S: range(92, 112, 2), L2: range(60, 78, 2), window: [60], costPct: [0.1],
});
export function range(a, b, step = 1) { const out = []; if (!(step > 0)) return [a]; for (let v = a; v <= b + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6); return out; }

/** Zellen in der Reihenfolge von grid.py (U1, gap, S, L2, dann window, cost). Achsenindizes für die Nachbarschaft. */
export function gridCells(g) {
  const cells = [];
  const W = g.window?.length ? g.window : [60], C = g.costPct?.length ? g.costPct : [0.1];
  W.forEach((w, wi) => C.forEach((c, ci) => g.U1.forEach((U1, ui) => g.gap.forEach((gap, gi) => g.S.forEach((S, si) => g.L2.forEach((L2, li) => {
    const L1 = U1 - gap;
    if (L2 < L1 && S > U1) cells.push({ U1, L1, gap, S, L2, window: w, costPct: c, ix: [ui, gi, si, li, wi, ci] });
  }))))));
  return cells;
}

/** Nachbarschaftsmittel (robust.py, Hybrid): Mittel über alle existierenden Zellen mit Achsenindex ±1 (U1, gap, S, L2, window, cost). */
export function neighbourMean(cells, values) {
  if (!cells.length) return [];
  const dims = cells[0].ix.length;
  const size = Array.from({ length: dims }, (_, d) => 1 + Math.max(...cells.map((c) => c.ix[d])));
  const active = size.map((n, d) => (n > 1 ? d : -1)).filter((d) => d >= 0);
  const mul = []; let m = 1; for (let d = 0; d < dims; d++) { mul[d] = m; m *= size[d]; }
  const map = new Map(cells.map((c, i) => [c.ix.reduce((s, v, d) => s + v * mul[d], 0), i]));
  let offsets = [[]];
  for (let k = 0; k < active.length; k++) offsets = offsets.flatMap((o) => [-1, 0, 1].map((a) => [...o, a]));
  return cells.map((c) => {
    let s = 0, k = 0;
    for (const o of offsets) {
      let key = 0, ok = true;
      for (let d = 0; d < dims; d++) {
        const a = active.indexOf(d), v = c.ix[d] + (a >= 0 ? o[a] : 0);
        if (v < 0 || v >= size[d]) { ok = false; break; }
        key += v * mul[d];
      }
      if (!ok) continue;
      const j = map.get(key);
      if (j != null && Number.isFinite(values[j])) { s += values[j]; k++; }
    }
    return k ? s / k : NaN;
  });
}

/** compare.py pick(): max nb, dann max rohes oz, dann mittlere Zeile nach S (stabil sortiert). */
export function pickRobust(cells, raw, nb) {
  let m = -Infinity; for (const v of nb) if (v > m) m = v;
  let t = cells.map((c, i) => i).filter((i) => nb[i] >= m - 1e-9);
  let mr = -Infinity; for (const i of t) if (raw[i] > mr) mr = raw[i];
  t = t.filter((i) => raw[i] >= mr - 1e-9).sort((a, b) => cells[a].S - cells[b].S || a - b);
  return t[(t.length - 1) >> 1];
}

/** Ranglisten (1 = bester, Gleichstand = gleicher Rang, Methode „min“). */
export function ranks(values) {
  const v = values.map((x) => (Number.isFinite(x) ? x : -Infinity));
  const sorted = [...v].sort((a, b) => b - a);
  return v.map((x) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] > x + 1e-9) lo = m + 1; else hi = m; } return lo + 1; });
}

/** Index des letzten Datums <= d (asof); -1 wenn keins. */
export function asofIdx(dates, d) {
  let lo = 0, hi = dates.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
/** Index des ersten Datums >= d. */
export function firstOnOrAfter(dates, d) {
  let lo = 0, hi = dates.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; } return lo;
}
export const addYears = (iso, k) => `${Number(iso.slice(0, 4)) + k}${iso.slice(4, 10)}`;
