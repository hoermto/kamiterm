// Pure P&L helpers for RSL26 holdings (open = unrealisiert, closed = realisiert). No DOM, no imports; shared with node --test.
export const UNI_CUR = { SPX: 'USD', NDX: 'USD', HDAX: 'EUR', SXXP: 'EUR', DAX: 'EUR' };
const DAY = 86400e3;
const dayNum = (s) => { const t = Date.parse(String(s || '').slice(0, 10) + 'T00:00:00Z'); return Number.isFinite(t) ? t : null; };

/**
 * P&L einer Position. fee = absolute Gebühr je Order (Kauf und Verkauf; offen: nur Kauf).
 * pnlPct = Kursrendite in % (ohne Gebühren), pnlAbs = (Kurs − Kaufkurs) × Stück − Gebühren (null ohne Stück/Kaufkurs).
 */
export function pnlRow(p, { fee = 1, today = new Date().toISOString().slice(0, 10) } = {}) {
  const closed = p.status === 'closed' || !!p.closedDate;
  const buy = Number(p.buyPrice), qty = p.qty == null || p.qty === '' ? null : Number(p.qty);
  const px = closed ? Number(p.sellPrice) : Number(p.lastClose ?? p.trailClose);
  const ok = buy > 0 && Number.isFinite(px) && px > 0;
  const fees = closed ? 2 * fee : fee;
  const pnlPct = ok ? (px / buy - 1) * 100 : null;
  const pnlAbs = ok && qty > 0 ? (px - buy) * qty - fees : null;
  const cost = buy > 0 && qty > 0 ? buy * qty + fee : null;
  const b = dayNum(p.buyDate), e = dayNum(closed ? p.closedDate : today);
  return { kind: closed ? 'closed' : 'open', cur: UNI_CUR[p.universe] || 'USD', price: ok ? px : null, pnlPct, pnlAbs, fees, cost,
    pnlAbsPct: pnlAbs != null && cost ? (pnlAbs / cost) * 100 : null, days: b != null && e != null ? Math.round((e - b) / DAY) : null };
}

/** Summen je Währung: realisiert, unrealisiert, gesamt, Trefferquote (geschlossene mit P&L > 0). */
export function pnlTotals(positions, opts = {}) {
  const by = {};
  let wins = 0, closedN = 0, openN = 0, missing = 0;
  for (const p of positions || []) {
    const r = pnlRow(p, opts);
    const t = by[r.cur] || (by[r.cur] = { cur: r.cur, realized: 0, unrealized: 0, total: 0, cost: 0 });
    if (r.kind === 'closed') { closedN++; if ((r.pnlAbs ?? (r.pnlPct != null ? r.pnlPct : null)) > 0) wins++; }
    else openN++;
    if (r.pnlAbs == null) { missing++; continue; }
    if (r.kind === 'closed') t.realized += r.pnlAbs; else t.unrealized += r.pnlAbs;
    t.total += r.pnlAbs;
  }
  for (const t of Object.values(by)) for (const k of ['realized', 'unrealized', 'total']) t[k] = Math.round(t[k] * 100) / 100;
  return { byCur: by, currencies: Object.keys(by), closed: closedN, open: openN, wins, winRate: closedN ? (wins / closedN) * 100 : null, missing };
}
