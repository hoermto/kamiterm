#!/usr/bin/env node
/**
 * Russell-1000-Studie (Analyse only): Equity-Kurven, Wochenrenditen und Trade-Anatomie für feste Configs eines Universums.
 * Aufruf: RSL_UNIVERSE=R1000 IDS="id1,id2" node scripts/r1000-dump.mjs <out.json>
 * Trade-Anatomie mit Produktions-Engine rotationBacktest (identische Kennzahlen wie research run()). Bucket: inSPX (Large) vs ex (Mid).
 */
const { writeFileSync } = await import('fs');
const E = await import('./research-engine.mjs');
const { run, ts, iso, data, benchmark, RESEARCH, UNIVERSE_KEY } = E;
const { rotationBacktest } = await import('../lib/fn/grokki-math.js');
const { history } = await import('../lib/fn/grokki-data.js');
const out = process.argv[2];
const A = ts('2016-11-09'), B = ts('2026-11-09');
const parse = id => { const [m, rt, rs, tl, rk, n] = id.split('|'); const mode = m.replace(/\d$/, ''), cw = +(m.match(/\d$/)?.[0] || 1); const [, t, l] = tl.match(/T(\d+)L(\d+)/); return { id, mode, cw, rt: +rt.slice(2), rs: +rs.slice(2), t: +t, l: +l, rk, n: +n.slice(1) }; };
const spxSet = new Set(RESEARCH ? RESEARCH.members.filter(m => m.inSPX).map(m => m.t) : data.results.map(s => s.ticker));
const sMap = new Map(data.results.map(s => [s.ticker, s]));
const dvolAt = (tk, isoD) => { const s = sMap.get(tk); if (!s) return null; const t = Date.parse(isoD + 'T00:00:00Z') / 1000; let j = s.bars.findIndex(b => b.time >= t); if (j < 0) j = s.bars.length - 1; const a = Math.max(0, j - 20); const x = s.bars.slice(a, j); return x.length ? x.reduce((v, b) => v + b.close * (b.volume || 0), 0) / x.length : null; };
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
const res = { universe: UNIVERSE_KEY, configs: {} };
for (const id of String(process.env.IDS).split(',').filter(Boolean)) {
  const c = parse(id);
  const r = run({ mode: c.mode, n: c.n, rankTop: c.rt, rsExit: !!c.rs, confirmWeeks: c.cw }, () => c.rk, A, B, { trail: c.t / 100, lock: c.l });
  const bt = rotationBacktest(data.results, 10, c.n, { benchmarkBars: benchmark.bars, mode: c.mode, rankTop: c.rt, confirmWeeks: c.cw, rsExit: !!c.rs, startCapital: 10000, fractional: true, sizeMode: 'EQUITY', fee: 1, trail: c.t, trailLock: c.l, ranking: c.rk, windowStart: A, windowEnd: B });
  const tr = bt.closedTrades.map(t => ({ ...t, big: spxSet.has(t.ticker), dvol: dvolAt(t.ticker, t.buyDate) }));
  const grp = f => { const x = tr.filter(f), w = x.filter(t => t.pnl > 0), l = x.filter(t => t.pnl <= 0); return { n: x.length, winRate: x.length ? w.length / x.length : null, medHoldW: med(x.map(t => t.holdWeeks)), medHoldWin: med(w.map(t => t.holdWeeks)), medHoldLoss: med(l.map(t => t.holdWeeks)), p90HoldWin: (() => { const b = w.map(t => t.holdWeeks).sort((p, q) => p - q); return b.length ? b[Math.floor(0.9 * (b.length - 1))] : null; })(), weeksHeld: x.reduce((s, t) => s + t.holdWeeks, 0), pnl: x.reduce((s, t) => s + t.pnl, 0), medPnlPct: med(x.map(t => t.pnlPct)), avgWinPct: w.length ? w.reduce((s, t) => s + t.pnlPct, 0) / w.length : null, avgLossPct: l.length ? l.reduce((s, t) => s + t.pnlPct, 0) / l.length : null, trailShare: x.length ? x.filter(t => t.trailing).length / x.length : null, medDvolUSDm: med(x.map(t => t.dvol).filter(v => v != null)) / 1e6, minDvolUSDm: Math.min(...x.map(t => t.dvol).filter(v => v != null)) / 1e6 }; };
  const reasons = {}; for (const t of tr) { const k = t.trailing ? 'Trailing' : (t.reason || t.kind || '?').replace(/\d+/g, '#'); reasons[k] = (reasons[k] || 0) + 1; }
  const top = Object.entries(tr.reduce((m, t) => (m[t.ticker] = (m[t.ticker] || 0) + t.pnl, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, v]) => ({ t, pnl: Math.round(v), big: spxSet.has(t) }));
  const eqW = []; let lastW = null; for (const e of r.equity) { const w = Math.floor((e.t + 3 * 86400) / (7 * 86400)); if (w !== lastW) { eqW.push([e.time, +e.value.toFixed(2)]); lastW = w; } else eqW[eqW.length - 1] = [e.time, +e.value.toFixed(2)]; }
  res.configs[id] = { research: { cagr: r.cagr, maxDD: r.maxDD, mar: r.mar, sharpe: r.sharpe, trades: r.trades, final: r.final }, prod: { cagr: bt.stats.cagr, maxDD: bt.stats.maxDD, closed: bt.stats.tradesClosed, open: bt.stats.tradesOpen, final: bt.stats.finalEquity },
    tradesPerYear: tr.length / 10, all: grp(() => true), large: grp(t => t.big), mid: grp(t => !t.big), reasons, topContrib: top,
    openAtEnd: (bt.openPositions || bt.holdings || []).map?.(h => h.ticker || h.s?.ticker) || null, weekRets: r.weekRets, equityWeekly: eqW, yearly: Object.fromEntries(Object.entries(r.yearly).map(([y, o]) => [y, o.ret])) };
  console.log(id, JSON.stringify({ r: res.configs[id].research, p: res.configs[id].prod, large: res.configs[id].large, mid: res.configs[id].mid, reasons }).slice(0, 1500));
}
// B&H curves
res.bh = {};
for (const t of String(process.env.BH || '').split(',').filter(Boolean)) { let hb; try { hb = await history(t, 12); } catch (e) { console.log('BH fail', t, e.message); continue; } const b = hb.bars.filter(x => x.time >= A && x.time <= B); const eqW = []; let lastW = null; for (const x of b) { const w = Math.floor((x.time + 3 * 86400) / (7 * 86400)); const v = +(10000 * x.close / b[0].close).toFixed(2); if (w !== lastW) { eqW.push([iso(x.time), v]); lastW = w; } else eqW[eqW.length - 1] = [iso(x.time), v]; } res.bh[t] = eqW; }
writeFileSync(out, JSON.stringify(res)); process.exit(0);
