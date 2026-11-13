// P&L je Jahr/Monat aus einer Equity-Kurve. Rein rechnerisch (kein DOM), damit Node-Tests es direkt laden können.
// data:  [{ time: 'YYYY-MM-DD', value }] aufsteigend.
// flows: optional [{ time, value }] = kumulierte Einzahlungen (gleiche Zeitpunkte). Dann gilt
//        P&L = ΔEquity − ΔEinzahlungen, und die erste Periode startet bei 0 (Equity und Einzahlungen).
// unit:  'Y' (Jahr) | 'M' (Monat)
// Ergebnis: [{ period: '2024' | '2024-03', start, end, flow, pnl, pct }]
//   pct = pnl / (start + positive Einzahlungen der Periode) — bei reinem Backtest ohne flows = Periodenrendite.
export function periodPnl(data, flows = null, unit = "Y") {
  const keyOf = (t) => String(t).slice(0, unit === "M" ? 7 : 4);
  const flowAt = flows?.length ? new Map(flows.map((p) => [String(p.time), p.value])) : null;
  const pts = (data || []).filter((p) => p && Number.isFinite(p.value));
  const out = [];
  if (!pts.length) return out;
  let baseV = flowAt ? 0 : pts[0].value;
  let baseF = 0;
  let lastF = 0;
  let cur = null;
  const close = () => {
    if (!cur) return;
    const flow = cur.endF - baseF;
    const pnl = cur.endV - baseV - flow;
    const cap = baseV + Math.max(flow, 0);
    out.push({ period: cur.key, start: baseV, end: cur.endV, flow, pnl, pct: cap > 0 ? (100 * pnl) / cap : null });
    baseV = cur.endV;
    baseF = cur.endF;
  };
  for (const p of pts) {
    const t = String(p.time);
    if (flowAt?.has(t) && Number.isFinite(flowAt.get(t))) lastF = flowAt.get(t);
    const k = keyOf(t);
    if (!cur || cur.key !== k) {
      close();
      cur = { key: k };
    }
    cur.endV = p.value;
    cur.endF = lastF;
  }
  close();
  return out;
}

// Runde Achsenschritte (1/2/5 × 10^n) für [lo, hi] mit etwa `count` Linien.
export function niceTicks(lo, hi, count = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0];
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const ticks = [];
  const top = Math.ceil(hi / step - 1e-9) * step;
  for (let v = Math.floor(lo / step + 1e-9) * step; v <= top + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}
