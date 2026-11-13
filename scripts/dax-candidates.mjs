#!/usr/bin/env node
// DAX-Optimierung Stufe 3: Detailprüfung zweier Empfehlungskandidaten (Analyse only). RSL_UNIVERSE=DAX node scripts/dax-candidates.mjs
process.env.RSL_UNIVERSE = process.env.RSL_UNIVERSE || 'DAX';
const { writeFileSync } = await import('fs');
const E = await import('./research-engine.mjs');
const { run, ts, mean, sdev, data, benchmark } = E;
const { history } = await import('../lib/fn/grokki-data.js');
const { rotationBacktest } = await import('../lib/fn/grokki-math.js');
const A = ts('2016-11-09'), B = ts('2026-11-09'), H = ts('2021-11-09'), W0 = ts('2018-01-01');
const C = {
  REC: { label: 'Empfehlung CONFIRM 3 Wo. RT25 RS0 MOM52-4 N3 TRAIL 25/0', mode: 'CONFIRM', cw: 3, rt: 25, rs: 0, n: 3, t: 25, l: 0, rk: 'MOM52_4' },
  CONS: { label: 'Konservativ RANK RT10 RS1 RSL26 N5 TRAIL 20/2', mode: 'RANK', cw: 1, rt: 10, rs: 1, n: 5, t: 20, l: 2, rk: 'RSL26' },
  DEF: { label: 'DAX-Default OFF RS1 RSL26 N5', mode: 'OFF', cw: 1, rt: 25, rs: 1, n: 5, t: 0, l: 0, rk: 'RSL26' },
  SPX: { label: 'SPX-Favorit auf DAX', mode: 'RANK', cw: 1, rt: 25, rs: 1, n: 5, t: 20, l: 4, rk: 'RSL26' },
};
const runC = (c, a, b) => run({ mode: c.mode, n: c.n, rankTop: c.rt, rsExit: !!c.rs, confirmWeeks: c.cw }, () => c.rk, a, b, { trail: c.t / 100, lock: c.l });
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
const sr = a => mean(a) / sdev(a);
function bootPair(x, y, nb = 5000, mb = 13) {
  const n = Math.min(x.length, y.length); x = x.slice(-n); y = y.slice(-n); const out = []; let s2 = 42; const r2 = () => { s2 = (s2 * 1664525 + 1013904223) % 4294967296; return s2 / 4294967296; };
  for (let b = 0; b < nb; b++) {
    let i = Math.floor(r2() * n); const xs = [], ys = [];
    for (let k = 0; k < n; k++) { if (k > 0 && r2() < 1 / mb) i = Math.floor(r2() * n); else if (k > 0) i = (i + 1) % n; xs.push(x[i]); ys.push(y[i]); }
    const cg = a => 100 * (Math.exp(a.reduce((p, v) => p + Math.log(1 + v), 0) / (n / 52)) - 1);
    const dd = a => { let v = 1, pk = 1, m = 0; for (const r of a) { v *= 1 + r; pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); } return 100 * m; };
    const cx = cg(xs), cy = cg(ys); out.push({ dC: cx - cy, dS: (sr(xs) - sr(ys)) * Math.sqrt(52), dM: cx / Math.abs(dd(xs)) - cy / Math.abs(dd(ys)) });
  }
  const qq = (k, p) => q(out.map(o => o[k]), p);
  return { meanBlock: mb, weeks: n, dCagr: [qq('dC', 0.05), qq('dC', 0.5), qq('dC', 0.95)], pCagr: out.filter(o => o.dC > 0).length / nb, dSharpe: [qq('dS', 0.05), qq('dS', 0.5), qq('dS', 0.95)], pSharpe: out.filter(o => o.dS > 0).length / nb, dMar: [qq('dM', 0.05), qq('dM', 0.5), qq('dM', 0.95)], pMar: out.filter(o => o.dM > 0).length / nb };
}
const allDates = [...new Set(E.P.prepped.flatMap(s => s.bars.map(b => b.time)))].sort((a, b) => a - b);
const gdaxip = await history('^GDAXIP', 12);
const bhRets = (bars, a, b) => { const m = new Map(bars.map(x => [x.time, x.close])); let last = null, first = null; const eq = []; for (const t of allDates) { if (t < a || t > b) continue; if (m.has(t)) last = m.get(t); if (last == null) continue; if (first == null) first = last; eq.push({ t, time: '', value: 10000 * last / first }); } return E.stats(eq, { start: 10000 }); };
const BHP = bhRets(gdaxip.bars, A, B), BHT = bhRets(benchmark.bars, A, B);
const bt = (c, series, a = A, b = B) => rotationBacktest(series, 10, c.n, { benchmarkBars: benchmark.bars, mode: c.mode, rankTop: c.rt, confirmWeeks: c.cw, rsExit: !!c.rs, startCapital: 10000, fractional: true, sizeMode: 'EQUITY', fee: 1, trail: c.t, trailLock: c.l, ranking: c.rk, windowStart: a, windowEnd: b });
const res = {};
const full = Object.fromEntries(Object.entries(C).map(([k, c]) => [k, runC(c, A, B)]));
for (const [k, c] of Object.entries(C)) {
  const r = full[k], r5 = runC(c, H, B), rwf = runC(c, W0, B);
  const s10 = [], s5 = []; for (let i = 0; i < 52; i++) { s10.push(runC(c, A + i * 604800, B)); s5.push(runC(c, H + i * 604800, B)); }
  const sum = arr => ({ cagrMin: q(arr.map(x => x.cagr), 0), cagrMed: q(arr.map(x => x.cagr), 0.5), cagrMax: q(arr.map(x => x.cagr), 1), marMin: q(arr.map(x => x.mar), 0), marMed: q(arr.map(x => x.mar), 0.5), ddWorst: q(arr.map(x => x.maxDD), 0) });
  const p = bt(c, data.results); const by = {}; for (const t of p.closedTrades) by[t.ticker] = (by[t.ticker] || 0) + t.pnl;
  const ex = {}; for (const drop of [['RHM.DE'], ['ENR.DE'], ['RHM.DE', 'ENR.DE']]) { const s = data.results.filter(x => !drop.includes(x.ticker)); const a1 = bt(c, s), a5 = bt(c, s, H, B); ex[drop.join('+')] = { c10: a1.stats.cagr, dd10: a1.stats.maxDD, c5: a5.stats.cagr, dd5: a5.stats.maxDD }; }
  res[k] = { ...c, y10: { cagr: r.cagr, maxDD: r.maxDD, mar: r.mar, sharpe: r.sharpe, trades: r.trades }, y5: { cagr: r5.cagr, maxDD: r5.maxDD, mar: r5.mar, sharpe: r5.sharpe, trades: r5.trades }, wf2018: { cagr: rwf.cagr, maxDD: rwf.maxDD, mar: rwf.mar },
    yearly: Object.fromEntries(Object.entries(r.yearly).map(([y, o]) => [y, o.ret])), shift10: sum(s10), shift5: sum(s5), prodParity10: { cagr: p.stats.cagr, maxDD: p.stats.maxDD, closed: p.stats.tradesClosed, open: p.stats.tradesOpen },
    realizedPnlTop: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, v]) => [t, Math.round(v)]), finalEquity: p.stats.finalEquity, exTicker: ex };
  console.log(k, JSON.stringify(res[k]).slice(0, 900));
}
const winsStart = (x, y) => { let w = 0; for (let i = 0; i < 52; i++) { const a = runC(C[x], A + i * 604800, B), b = runC(C[y], A + i * 604800, B); if (a.mar > b.mar) w++; } return w; };
res.startWins = { REC_vs_DEF: winsStart('REC', 'DEF'), REC_vs_SPX: winsStart('REC', 'SPX'), CONS_vs_DEF: winsStart('CONS', 'DEF'), CONS_vs_SPX: winsStart('CONS', 'SPX') };
res.boot = [];
for (const [x, y, yl, yr] of [['REC', 'DEF', 'DAX-Default', full.DEF.weekRets], ['REC', 'SPX', 'SPX-Favorit auf DAX', full.SPX.weekRets], ['REC', 'BHP', 'B&H ^GDAXIP', BHP.weekRets], ['REC', 'BHT', 'B&H ^GDAXI', BHT.weekRets], ['CONS', 'DEF', 'DAX-Default', full.DEF.weekRets], ['CONS', 'BHP', 'B&H ^GDAXIP', BHP.weekRets], ['CONS', 'BHT', 'B&H ^GDAXI', BHT.weekRets]])
  for (const mb of [4, 13, 26]) res.boot.push({ x, y: yl, ...bootPair(full[x].weekRets, yr, 5000, mb) });
console.log(JSON.stringify(res.startWins)); res.boot.filter(b => b.meanBlock === 13).forEach(b => console.log(b.x, b.y, b.dCagr.map(v => v.toFixed(1)), b.pCagr, b.pMar));
writeFileSync('/workspace/thoBox/Grokki/strategies/RSL26_DAX_Optimierung_2026-11-10_Kandidaten.json', JSON.stringify(res, null, 1));
process.exit(0);
