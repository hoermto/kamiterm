// Kompakte JSON-Form eines Backtest-Laufs für die UI (Kurven gerundet).
const r = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
export function summarize(ds, bt, { curve = true } = {}) {
  const dates = ds.dates.slice(bt.from, bt.to);
  const oz = curve ? Array.from(bt.eq, (e, k) => r(e * ds.ozf[bt.from + k], 5)) : null;
  return {
    params: bt.params, plan: bt.plan || null, metrics: bt.metrics, holdDays: bt.holdDays || 0, hold: bt.hold || null, tax: bt.tax || null, bh: bt.bhMetrics, final: bt.final, trades: bt.trades, lapsed: bt.lapsed || [],
    currency: ds.pair.currency, pair: ds.pair, notes: ds.notes || [],
    curve: curve ? { dates, eq: Array.from(bt.eq, (v) => r(v, 2)), bhGold: Array.from(bt.bhGold, (v) => r(v, 2)), bhSilver: Array.from(bt.bhSilver, (v) => r(v, 2)), oz, pos: Array.from(bt.pos) } : null,
  };
}
