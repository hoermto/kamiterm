// GSW-Historie: Equity des echten Buchs (gebuchte Lots × Tagesschluss + Cash aus Verkäufen) über die Zeit, in Lot-Währung,
// optional gegen Regel-Backtest und Buy & Hold Gold/Silber mit denselben Einzahlungen. Rein rechnerischer Kern + Lader. Schreibt nichts.
import { calendarDaysBetween, holdUnlockDate } from './math.js';

/** As-of-Lookup für Tagesreihen: dates aufsteigend (ISO), values gleich lang. */
export function asOfFn(dates, values) {
  return (d) => {
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
    const v = ans >= 0 ? values[ans] : null;
    return Number.isFinite(v) ? v : null;
  };
}

const lotCost = (l) => l.qty * l.buyPrice + (Number(l.buyFees) || 0);
const lotProceeds = (l) => l.qty * l.sellPrice - (Number(l.sellFees) || 0);

/**
 * Pure. lots: Buch-Lots; days: Handelstage (ISO, aufsteigend); closeOf(symbol, iso) → Schluss am Tag oder davor | null.
 * twins: { name: idx(iso) → Indexwert | null } (z. B. Regel-Equity, Gold-Kurs). 
 * Methode: Ereignisse je Tag, erst Verkäufe (Erlös − Gebühr → Cash), dann Käufe (Kosten + Gebühr aus Cash; was fehlt, ist eine
 * Einzahlung). Ein Swap (Verkauf + Kauf am selben Tag) braucht daher keine neue Einzahlung. Equity = Cash + Marktwert offener Lots.
 * Zwillinge kaufen mit jeder Einzahlung Anteile ihres Index am selben Tag und halten sie.
 */
export function bookEquity({ lots, days, closeOf, twins = {} }) {
  const ev = new Map();
  const push = (d, e) => { if (!ev.has(d)) ev.set(d, []); ev.get(d).push(e); };
  const valid = (lots || []).filter((l) => l && l.buyDate && l.qty > 0 && l.buyPrice > 0);
  for (const l of valid) {
    push(l.buyDate, { t: 'buy', l });
    if (l.status === 'closed' && l.sellDate && l.sellPrice > 0) push(l.sellDate, { t: 'sell', l });
  }
  if (!valid.length || !days?.length) return { points: [], deposits: 0, twins: {} };
  const evDates = [...ev.keys()].sort();
  let cash = 0, deposits = 0, k = 0;
  const units = Object.fromEntries(Object.keys(twins).map((n) => [n, 0]));
  const twinOk = Object.fromEntries(Object.keys(twins).map((n) => [n, true]));
  const held = new Set(), bought = new Set(), pend = new Set();
  const points = [];
  const first = evDates[0];
  const cal = days.filter((d) => d >= first);
  for (const d of cal) {
    // alle Ereignisse bis einschließlich d (Wochenend-Buchungen landen am nächsten Handelstag)
    const todays = [];
    while (k < evDates.length && evDates[k] <= d) todays.push(...ev.get(evDates[k++]));
    todays.sort((a, b) => (a.t === b.t ? 0 : a.t === 'sell' ? -1 : 1));
    for (const e of todays) {
      if (e.t === 'sell') {
        if (bought.has(e.l)) { cash += lotProceeds(e.l); held.delete(e.l); } else pend.add(e.l); // Kauf kommt erst noch (gleicher Tag)
        continue;
      }
      const cost = lotCost(e.l);
      const dep = Math.max(0, cost - cash);
      cash += dep - cost; deposits += dep;
      if (dep > 0) for (const [n, idx] of Object.entries(twins)) { const v = idx(e.l.buyDate) ?? idx(d); if (v > 0) units[n] += dep / v; else twinOk[n] = false; }
      bought.add(e.l);
      if (pend.has(e.l)) cash += lotProceeds(e.l); // gekauft und am selben Tag verkauft
      else held.add(e.l);
    }
    let mv = 0;
    for (const l of held) mv += l.qty * (closeOf(l.symbol, d) ?? l.buyPrice);
    const pt = { date: d, equity: round2(cash + mv), deposits: round2(deposits), cash: round2(cash), mv: round2(mv) };
    for (const [n, idx] of Object.entries(twins)) { const v = idx(d); pt[n] = twinOk[n] && v > 0 ? round2(units[n] * v) : null; }
    points.push(pt);
  }
  return { points, deposits: round2(deposits), twinOk };
}
const round2 = (v) => Math.round(v * 100) / 100;

/** Geschlossene Lots für die Historien-Tabelle: G/V nach Gebühren, Haltedauer, steuerfrei ab, Swap/Verkauf. */
export function closedRow(l, holdDays = 365) {
  const fees = (Number(l.buyFees) || 0) + (Number(l.sellFees) || 0);
  const pnl = l.sellPrice > 0 ? l.qty * (l.sellPrice - l.buyPrice) - fees : null;
  const cost = l.qty * l.buyPrice + (Number(l.buyFees) || 0);
  const tff = l.buyDate ? holdUnlockDate(l.buyDate, holdDays) : null;
  return { ...l, fees, pnl, pnlPct: pnl != null && cost > 0 ? (pnl / cost) * 100 : null, holdDaysHeld: l.buyDate && l.sellDate ? calendarDaysBetween(l.buyDate, l.sellDate) : null,
    taxFreeFrom: tff, soldTaxFree: !!(tff && l.sellDate && l.sellDate >= tff), exitKind: l.sellSwapId || l.swapId ? 'Swap' : 'Verkauf' };
}
