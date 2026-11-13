#!/usr/bin/env node
/**
 * Russell-1000-Studie 10.11.2026: Kopie von scripts/eu-analyse.mjs (nur TAG + Referenzen Kandidat A/B ergänzt). Ursprünglich:
 * HDAX/Europa-Studie (Analyse, Produktion unverändert): verallgemeinerte Kopie von scripts/dax-analyse.mjs für den reduzierten Grid
 * (RSL_GRID=reduced in scripts/dax-grid.mjs) und beliebige RSL_UNIVERSE (DAX, HDAX, SXXP, SXXP_EZ). Env: RSL_RTS (Grid-RANKTOPs),
 * RSL_WF_RTS (WF-RANKTOPs), RSL_BH (weitere Buy-&-Hold-Indizes), RSL_BH_PRIMARY (fairer Kursindex für Bootstrap).
 * Ursprünglicher Kopf: Liest den Grid aus scripts/dax-grid.mjs,
 * bewertet Robustheit (Hälften, Plateau, 52 Startwochen), PBO (CSCV), Deflated Sharpe, Block-Bootstrap,
 * Walk-Forward mit voller Config-Tuning (Exit/N/RANKTOP/RS/TRAIL/Ranking) in drei Lernfenstern (expanding, rolling 3 J., rolling 5 J.)
 * mit Carry, und vergleicht mit DAX-Default OFF, SPX-Favorit auf DAX und Buy & Hold (^GDAXI Performance, ^GDAXIP Kurs).
 * Aufruf: RSL_UNIVERSE=DAX node scripts/dax-analyse.mjs <gridDir>
 */
process.env.RSL_UNIVERSE = process.env.RSL_UNIVERSE || 'R1000';
const { readFileSync, readdirSync, writeFileSync } = await import('fs');
const E = await import('./research-engine.mjs');
const { run, stats, ts, mean, sdev, iso, P, CANDS, toGermanCsv, data, benchmark, UNIVERSE_KEY, BENCH_TICKER } = E;
const { history } = await import('../lib/fn/grokki-data.js');
const { rotationBacktest, evaluateTrailExit } = await import('../lib/fn/grokki-math.js');
const { wIdxAtOrBefore } = await import('./lib/rotation-hooks.mjs');
const DIR = process.argv[2] || '/workspace/tmp/dax';
const OUT = '/workspace/thoBox/Grokki/strategies', TAG = `RSL26_Russell1000_2026-11-10_${UNIVERSE_KEY}`;
const A = ts('2016-11-09'), B = ts('2026-11-09'), H = ts('2021-11-09');
const t0 = Date.now(); const lap = m => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
// ---------- grid
const grid = readdirSync(DIR).filter(f => /^grid-\d+\.json$/.test(f)).flatMap(f => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')).res);
lap(`grid ${grid.length}`);
const byId = new Map(grid.map(c => [c.id, c]));
const RTS = String(process.env.RSL_RTS || '0,10,25,50').split(',').map(Number), NS = [3, 5, 8, 10], TS = [0, 15, 20, 25], LS = [0, 4];
const idOf = c => `${c.mode}${c.mode === 'CONFIRM' ? c.cw : ''}|RT${c.rt}|RS${c.rs}|T${c.t}L${c.l}|${c.rk}|N${c.n}`;
for (const c of grid) c.R = Math.min(c.y10.mar, c.h1.mar, c.h2.mar);
const neigh = c => {
  const out = [];
  const step = (arr, v) => { const i = arr.indexOf(v); return [arr[i - 1], arr[i + 1]].filter(x => x != null); };
  if (c.rt !== 0 || ['CONFIRM', 'RANK'].includes(c.mode)) for (const rt of step(RTS, c.rt)) out.push({ ...c, rt });
  for (const n of step(NS, c.n)) out.push({ ...c, n });
  if (c.t === 0) { /* trail off: neighbour = T10 with same lock family not defined; use T10L4 */ out.push({ ...c, t: 15, l: 4 }); }
  else { for (const t of step(TS, c.t)) out.push(t === 0 ? { ...c, t: 0, l: 0 } : { ...c, t }); for (const l of step(LS, c.l)) out.push({ ...c, l }); }
  return out.map(idOf).map(id => byId.get(id)).filter(Boolean);
};
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
for (const c of grid) { const nb = [c, ...neigh(c)]; c.plateauR = med(nb.map(x => x.R)); c.plateauMar10 = med(nb.map(x => x.y10.mar)); c.nNeigh = nb.length - 1; c.score = Math.min(c.R, c.plateauR); }
const sortBy = (k) => [...grid].sort((a, b) => k(b) - k(a));
const byMar10 = sortBy(c => c.y10.mar), byScore = sortBy(c => c.score), byCagr10 = sortBy(c => c.y10.cagr);
byMar10.forEach((c, i) => c.rankMar10 = i + 1); byScore.forEach((c, i) => c.rankScore = i + 1); byCagr10.forEach((c, i) => c.rankCagr10 = i + 1);
sortBy(c => c.h2.mar).forEach((c, i) => c.rankMar5 = i + 1);
lap('ranked');
// ---------- references
const REF = {
  DAX_DEFAULT_OFF: { id: 'OFF|RT0|RS1|T0L0|RSL26|N5', label: 'DAX-Default OFF (RS-Exit an, kein Trail, N5)' },
  DAX_OFF_T20: { id: 'OFF|RT0|RS1|T20L4|RSL26|N5', label: 'DAX OFF + Trail 20 %/4 Wo. (N5)' },
  SPX_FAV: { id: 'RANK|RT25|RS1|T20L4|RSL26|N5', label: 'SPX-Favorit (RANK N5 RT25 RS1 T20/4 RSL26)' },
  DAX_CONS: { id: 'RANK|RT10|RS1|T20L4|RSL26|N5', label: 'DAX-Konservativ (RANK N5 RT10 RS1 T20/4 RSL26)' },
  DAX_MOM: { id: 'CONFIRM3|RT25|RS0|T25L0|MOM52_4|N3', label: 'DAX-Momentum (CONFIRM 3 Wo. RT25 RS0 MOM52-4 N3 T25/0)' },
  KAND_A: { id: 'OFF|RT0|RS0|T20L0|MOM52_4|N5', label: 'Kandidat A (OFF RS aus MOM52-4 N5 T20/0)' },
  KAND_B: { id: 'RANK|RT10|RS0|T20L4|MOM52_4|N5', label: 'Kandidat B (RANK RT10 RS aus MOM52-4 N5 T20/4)' },
};
for (const [k, r] of Object.entries(REF)) { r.c = byId.get(r.id); if (!r.c) throw new Error('missing ref ' + r.id); }
// ---------- buy & hold
const allDates = [...new Set(P.prepped.flatMap(s => s.bars.map(b => b.time)))].sort((a, b) => a - b);
const BH_LIST = String(process.env.RSL_BH || '').split(',').filter(Boolean);
const BH_PRIMARY = process.env.RSL_BH_PRIMARY || BENCH_TICKER;
const bhBars = Object.fromEntries(await Promise.all(BH_LIST.map(async t => [t, (await history(t, 12)).bars])));
// equal-weight universe (price only, daily rebalanced, names with prices on both days)
const ewBars = (() => { const maps = P.prepped.map(s => new Map(s.bars.map(b => [b.time, b.close]))); let v = 100, prev = null; const out = [];
  for (const t of allDates) { if (prev != null) { let s = 0, k = 0; for (const m of maps) { const a = m.get(prev), b = m.get(t); if (a > 0 && b > 0) { const r = b / a - 1; if (Math.abs(r) < 0.5) { s += r; k++; } } } if (k) v *= 1 + s / k; } out.push({ time: t, close: v }); prev = t; } return out; })();
function bh(bars, a, b) {
  const m = new Map(bars.map(x => [x.time, x.close])); let last = null, first = null; const eq = [];
  for (const t of allDates) { if (t < a || t > b) continue; if (m.has(t)) last = m.get(t); if (last == null) continue; if (first == null) first = last; eq.push({ t, time: iso(t), value: 10000 * last / first }); }
  return stats(eq, { trades: 1, fees: 0, start: 10000 });
}
const BH = {};
for (const [k, bars] of [[BENCH_TICKER, benchmark.bars], ...Object.entries(bhBars).filter(([t]) => t !== BENCH_TICKER), ['EW-Universum', ewBars]]) BH[k] = { y10: bh(bars, A, B), h1: bh(bars, A, ts('2021-11-08')), h2: bh(bars, H, B), wf: bh(bars, ts('2018-01-01'), B) };
lap('bh');
// ---------- detail runs for top + refs
const baseOf = c => ({ mode: c.mode, n: c.n, rankTop: c.rt, rsExit: !!c.rs, confirmWeeks: c.cw });
const runC = (c, a, b) => run(baseOf(c), () => c.rk, a, b, { trail: c.t / 100, lock: c.l });
const TOPK = 15;
const top = byScore.slice(0, TOPK);
const detailSet = [...new Map([...top, ...byMar10.slice(0, 5), ...Object.values(REF).map(r => r.c)].map(c => [c.id, c])).values()];
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
for (const c of detailSet) {
  const s10 = [], s5 = [];
  for (let i = 0; i < 52; i++) { s10.push(runC(c, A + i * 7 * 86400, B)); s5.push(runC(c, H + i * 7 * 86400, B)); }
  const sum = arr => ({ cagrMin: q(arr.map(x => x.cagr), 0), cagrMed: q(arr.map(x => x.cagr), 0.5), marMin: q(arr.map(x => x.mar), 0), marMed: q(arr.map(x => x.mar), 0.5), ddWorst: q(arr.map(x => x.maxDD), 0), sharpeMed: q(arr.map(x => x.sharpe), 0.5) });
  c.shift10 = sum(s10); c.shift5 = sum(s5); c.shiftList10 = s10.map(x => ({ cagr: x.cagr, mar: x.mar }));
  const full = runC(c, A, B); c.yearly = Object.fromEntries(Object.entries(full.yearly).map(([y, o]) => [y, o.ret])); c.weekRets = full.weekRets;
  const wf = runC(c, ts('2018-01-01'), B); c.wfFixed = { cagr: wf.cagr, maxDD: wf.maxDD, mar: wf.mar, sharpe: wf.sharpe, trades: wf.trades };
}
lap('details');
// paired start-week wins: best vs refs
const best = top[0];
const winsVs = ref => ({ mar: best.shiftList10.filter((x, i) => x.mar > ref.shiftList10[i].mar).length, cagr: best.shiftList10.filter((x, i) => x.cagr > ref.shiftList10[i].cagr).length });
// ---------- production parity (best + SPX fav), 10y
const seriesAll = data.results;
const prodPar = {};
for (const c of [best, REF.SPX_FAV.c]) {
  const bt = rotationBacktest(seriesAll, 10, c.n, { benchmarkBars: benchmark.bars, mode: c.mode, rankTop: c.rt, confirmWeeks: c.cw, rsExit: !!c.rs, startCapital: 10000, fractional: true, sizeMode: 'EQUITY', fee: 1, trail: c.t, trailLock: c.l, ranking: c.rk, windowStart: A, windowEnd: B });
  prodPar[c.id] = { prod: { cagr: bt.stats?.cagr ?? bt.cagr, maxDD: bt.stats?.maxDD ?? bt.maxDD, trades: bt.stats?.tradesClosed, open: bt.stats?.tradesOpen }, research: { cagr: c.y10.cagr, maxDD: c.y10.maxDD, trades: c.y10.trades }, note: c.rk === 'RSL20' ? 'RSL20 gibt es in der Produktion nicht – Vergleich nicht möglich' : '' };
}
lap('parity ' + JSON.stringify(prodPar));
// ---------- concentration: realized P&L by ticker (production engine) and leave-out of top-1 / top-2 contributors
const btFull = (c, series, a = A, b = B) => rotationBacktest(series, 10, c.n, { benchmarkBars: benchmark.bars, mode: c.mode, rankTop: c.rt, confirmWeeks: c.cw, rsExit: !!c.rs, startCapital: 10000, fractional: true, sizeMode: 'EQUITY', fee: 1, trail: c.t, trailLock: c.l, ranking: c.rk, windowStart: a, windowEnd: b });
const conc = {};
const FAST = process.env.RSL_CONC_FAST === '1';
if (FAST) { // Leave-out mit research run() (Ausschluss über globalThis.__RSL_EXCL); P&L je Ticker inkl. offener Positionen (run().pnlBy)
  for (const c of [best, ...Object.values(REF).map(r => r.c)]) {
    if (conc[c.id]) continue;
    const r = runC(c, A, B), by = Object.fromEntries(r.pnlBy), gain = r.final - 10000, topC = Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 5);
    const ex = {};
    for (const k of [1, 2]) { const drop = topC.slice(0, k).map(x => x[0]); globalThis.__RSL_EXCL = { key: drop.join('+'), set: new Set(drop) }; const a1 = runC(c, A, B), a5 = runC(c, H, B); globalThis.__RSL_EXCL = null; ex[`ohne Top${k}`] = { drop, c10: a1.cagr, dd10: a1.maxDD, c5: a5.cagr, dd5: a5.maxDD }; }
    conc[c.id] = { method: 'research run() + Ausschluss', gain, realizedTop: topC.map(([t, v]) => ({ t, pnl: v, shareOfGain: gain > 0 ? v / gain : null })), top2Share: gain > 0 ? (topC.slice(0, 2).reduce((s3, x) => s3 + x[1], 0)) / gain : null, ex };
  }
}
for (const c of FAST ? [] : [best, ...Object.values(REF).map(r => r.c)]) {
  if (conc[c.id]) continue;
  const r = btFull(c, seriesAll), by = {}; for (const t of r.closedTrades) by[t.ticker] = (by[t.ticker] || 0) + t.pnl;
  const gain = r.stats.finalEquity - 10000, topC = Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 5);
  const ex = {};
  for (const k of [1, 2]) { const drop = topC.slice(0, k).map(x => x[0]); const s2 = seriesAll.filter(x => !drop.includes(x.ticker)); const a1 = btFull(c, s2), a5 = btFull(c, s2, H, B); ex[`ohne Top${k}`] = { drop, c10: a1.stats.cagr, dd10: a1.stats.maxDD, c5: a5.stats.cagr, dd5: a5.stats.maxDD }; }
  conc[c.id] = { gain, realizedTop: topC.map(([t, v]) => ({ t, pnl: v, shareOfGain: gain > 0 ? v / gain : null })), top2Share: gain > 0 ? (topC.slice(0, 2).reduce((s3, x) => s3 + x[1], 0)) / gain : null, ex };
}
lap('concentration'); writeFileSync(`/workspace/tmp/r1000/ckpt-${UNIVERSE_KEY}-conc.json`, JSON.stringify({ best: best.id, top: top.map(c => ({ id: c.id, y10: c.y10, h1: c.h1, h2: c.h2, score: c.score, shift10: c.shift10, shift5: c.shift5, wfFixed: c.wfFixed })), conc, prodPar }));
// ---------- PBO (CSCV) + DSR
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const sampleIds = new Set(byMar10.slice(0, 50).map(c => c.id)); while (sampleIds.size < 450) sampleIds.add(grid[Math.floor(rnd() * grid.length)].id);
const pset = [...sampleIds].map(id => { const c = byId.get(id); const r = runC(c, A, B); return { id, rets: r.weekRets }; });
const T = Math.min(...pset.map(c => c.rets.length)); for (const c of pset) c.rets = c.rets.slice(c.rets.length - T);
const sr = a => { const s = sdev(a); return s > 0 ? mean(a) / s : -Infinity; };
function cscv(set, S = 16) {
  const M = set.length, L = Math.floor(T / S);
  const blocks = Array.from({ length: S }, (_, i) => [i * L, i === S - 1 ? T : (i + 1) * L]);
  const combos = []; const rec = (st, cur) => { if (cur.length === S / 2) { combos.push([...cur]); return; } for (let i = st; i < S; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } }; rec(0, []);
  const stat = set.map(c => blocks.map(([a, b]) => { const x = c.rets.slice(a, b); return { n: x.length, s: x.reduce((p, q2) => p + q2, 0), s2: x.reduce((p, q2) => p + q2 * q2, 0) }; }));
  const srOf = (j, ids) => { let n = 0, s = 0, s2 = 0; for (const i of ids) { n += stat[j][i].n; s += stat[j][i].s; s2 += stat[j][i].s2; } const m = s / n, v = (s2 - n * m * m) / (n - 1); return m / Math.sqrt(v); };
  let below = 0; const rel = []; const degr = []; const win = {};
  for (const isIds of combos) {
    const oosIds = [...Array(S).keys()].filter(i => !isIds.includes(i));
    const isS = set.map((_, j) => srOf(j, isIds)), oosS = set.map((_, j) => srOf(j, oosIds));
    let b = 0; for (let j = 1; j < M; j++) if (isS[j] > isS[b]) b = j;
    const rank = oosS.filter(x => x < oosS[b]).length + 1, w = rank / (M + 1);
    rel.push(w); if (w <= 0.5) below++; degr.push([isS[b], oosS[b]]); win[b] = (win[b] || 0) + 1;
  }
  return { M, S, splits: combos.length, pbo: below / combos.length, medianRelRank: med(rel), meanIS_SR: mean(degr.map(d => d[0])) * Math.sqrt(52), meanOOS_SR: mean(degr.map(d => d[1])) * Math.sqrt(52), topWinners: Object.entries(win).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([j, c]) => ({ id: set[j].id, share: c / combos.length })) };
}
const pbo16 = cscv(pset, 16), pbo8 = cscv(pset, 8);
lap('pbo ' + pbo16.pbo + ' / ' + pbo8.pbo);
const normInv = p => { const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00], b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01], c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00], d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; let qq, r; if (p < pl) { qq = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * qq + c[1]) * qq + c[2]) * qq + c[3]) * qq + c[4]) * qq + c[5]) / ((((d[0] * qq + d[1]) * qq + d[2]) * qq + d[3]) * qq + 1); }
  if (p > 1 - pl) { qq = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * qq + c[1]) * qq + c[2]) * qq + c[3]) * qq + c[4]) * qq + c[5]) / ((((d[0] * qq + d[1]) * qq + d[2]) * qq + d[3]) * qq + 1); }
  qq = p - 0.5; r = qq * qq; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * qq / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); };
const normCdf = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), dd = 0.3989423 * Math.exp(-x * x / 2), p = dd * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const moments = x => { const m = mean(x), s = sdev(x), n = x.length; return { m, s, sk: x.reduce((p, v) => p + ((v - m) / s) ** 3, 0) / n, ku: x.reduce((p, v) => p + ((v - m) / s) ** 4, 0) / n }; };
const psr = (x, sr0) => { const { m, s, sk, ku } = moments(x), S = m / s, n = x.length; return normCdf((S - sr0) * Math.sqrt(n - 1) / Math.sqrt(1 - sk * S + (ku - 1) / 4 * S * S)); };
const varSR = sdev(pset.map(c => sr(c.rets)).filter(Number.isFinite)) ** 2;
const dsrOf = (x, N) => { const g = 0.5772156649, sr0 = Math.sqrt(varSR) * ((1 - g) * normInv(1 - 1 / N) + g * normInv(1 - 1 / (N * Math.E))); return { sr0Ann: sr0 * Math.sqrt(52), dsr: psr(x, sr0) }; };
const dsrRows = [...detailSet.slice(0, 8), ...Object.values(REF).map(r => r.c)].filter((c, i, a) => a.indexOf(c) === i).map(c => ({ id: c.id, srAnn: sr(c.weekRets) * Math.sqrt(52), psr0: psr(c.weekRets, 0), dsr100: dsrOf(c.weekRets, 100).dsr, dsr1000: dsrOf(c.weekRets, 1000).dsr, dsrAll: dsrOf(c.weekRets, grid.length).dsr, sr0AnnAll: dsrOf(c.weekRets, grid.length).sr0Ann }));
lap('dsr');
// ---------- bootstrap
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
  return { nb, meanBlock: mb, weeks: n, dCagr: [qq('dC', 0.05), qq('dC', 0.5), qq('dC', 0.95)], pCagr: out.filter(o => o.dC > 0).length / nb, dSharpe: [qq('dS', 0.05), qq('dS', 0.5), qq('dS', 0.95)], pSharpe: out.filter(o => o.dS > 0).length / nb, dMar: [qq('dM', 0.05), qq('dM', 0.5), qq('dM', 0.95)], pMar: out.filter(o => o.dM > 0).length / nb };
}
const boots = [];
for (const [lab, y] of [['Default OFF', REF.DAX_DEFAULT_OFF.c.weekRets], ['SPX-Favorit', REF.SPX_FAV.c.weekRets], ['DAX-Konservativ', REF.DAX_CONS.c.weekRets], ['Kandidat A', REF.KAND_A.c.weekRets], ['Kandidat B', REF.KAND_B.c.weekRets], [`Buy & Hold ${BH_PRIMARY}`, BH[BH_PRIMARY].y10.weekRets], ['Buy & Hold EW-Universum', BH['EW-Universum'].y10.weekRets]])
  for (const mb of [4, 13, 26]) boots.push({ x: best.id, y: lab, ...bootPair(best.weekRets, y, 5000, mb) });
lap('boot');
// ---------- walk-forward with full config tuning (own carry engine, mirrors research-engine run())
const weekKey = t => Math.floor((t + 3 * 86400) / (7 * 86400));
const byWeek = new Map(); for (const t of allDates) { const k = weekKey(t); if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(t); }
const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([key, days]) => ({ key, first: days[0], last: days.at(-1) }));
const weekPos = new Map(weeks.map((w, i) => [w.key, i]));
const caches = {};
function rankAt(cid, signalT) {
  const C = caches[cid] || (caches[cid] = new Map()); if (C.has(signalT)) return C.get(signalT);
  const k = weekKey(signalT), rows = [];
  for (const p of P.prepped) { const i = wIdxAtOrBefore(p, k); if (i < 0 || !(signalT - p.W[i].time <= 7 * 86400) || p.rsl[i] == null) continue; const s = CANDS[cid].f(p, i); if (s == null) continue; rows.push({ ticker: p.ticker, score: s, s: p }); }
  rows.sort((a, b) => b.score - a.score); rows.forEach((r, i) => { r.rank = i + 1; });
  const out = { rows, byTicker: new Map(rows.map(r => [r.ticker, r])) }; C.set(signalT, out); return out;
}
function trailUpTo(p, k) { let lo = 0, hi = p.trail.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.trail[m].key <= k) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
function runSched(cfgAt, a, b) {
  const fee = 1, startCapital = 10000, lastExtraExit = new Map(); let cash = startCapital, holdings = [], initialized = false, lastWeekKey = null, trades = 0; const equity = [];
  const execPx = bar => bar?.open > 0 ? bar.open : bar?.close > 0 ? bar.close : null;
  const eqOpen = execT => { let v = cash; for (const h of holdings) v += h.shares * (execPx(h.s.map.get(execT)) ?? h.last); return v; };
  const benchRslAt = k => { const i = wIdxAtOrBefore(P.bench, k); return i >= 0 ? P.bench.rsl[i] : null; };
  function tryBuys(c, ranked, execT, sk) {
    const nS = c.n, budget = eqOpen(execT) / nS, held = new Set(holdings.map(h => h.s.ticker)); let filled = 0;
    for (const row of ranked.rows.slice(0, nS)) {
      if (holdings.length >= nS) break;
      if (held.has(row.ticker) || !row.s.map.get(execT)) continue;
      if (c.l > 0 && lastExtraExit.has(row.ticker) && sk - lastExtraExit.get(row.ticker) < c.l) continue;
      const px = execPx(row.s.map.get(execT)); if (!px || !(cash > fee)) continue;
      const spend = Math.min(budget, cash - fee); if (!(spend > 0)) continue;
      cash -= spend + fee; holdings.push({ s: row.s, shares: spend / px, last: px, peak: px }); held.add(row.ticker); filled++;
    }
    return filled;
  }
  for (const t of allDates) {
    if (t < a || t > b) continue;
    const wk = weekKey(t);
    if (wk !== lastWeekKey) {
      const pos = weekPos.get(wk), signalWeek = pos > 0 ? weeks[pos - 1] : null, execT = weeks[pos].first, signalT = signalWeek?.last ?? null;
      if (signalT != null) {
        const c = cfgAt(execT), ranked = rankAt(c.rk, signalT), sk = weekKey(signalT), benchRsl = benchRslAt(sk), trail = c.t / 100;
        if (!initialized) { if (tryBuys(c, ranked, execT, sk) > 0) initialized = true; }
        else {
          const keep = [];
          for (const h of holdings) {
            const p = h.s, wi = wIdxAtOrBefore(p, sk), stockRsl = wi >= 0 ? p.rsl[wi] : null, ti = trailUpTo(p, sk), tr = ti >= 0 ? p.trail.slice(0, ti + 1) : [];
            const rank = ranked.byTicker.get(p.ticker)?.rank ?? null;
            const ev = evaluateTrailExit(tr, { rank, stockRsl, benchRsl }, { mode: c.mode, rankTop: c.rt, confirmWeeks: c.cw, rsExit: !!c.rs });
            const wclose = wi >= 0 ? p.W[wi].close : null; if (wclose != null) h.peak = Math.max(h.peak, wclose);
            let reason = ev.exitHint || null, extra = false;
            if (!reason && trail > 0 && wclose != null && wclose <= h.peak * (1 - trail)) { reason = 'trail'; extra = true; }
            if (reason) { const px = execPx(p.map.get(execT)) ?? h.last; cash += h.shares * px - fee; trades++; if (extra) lastExtraExit.set(p.ticker, sk); } else keep.push(h);
          }
          holdings = keep; tryBuys(c, ranked, execT, sk);
        }
      }
      lastWeekKey = wk;
    }
    for (const h of holdings) if (h.s.map.has(t)) h.last = h.s.map.get(t).close;
    equity.push({ t, time: iso(t), value: cash + holdings.reduce((v, h) => v + h.shares * h.last, 0) });
  }
  return stats(equity, { trades, fees: trades, start: startCapital });
}
// parity of carry engine vs research run() for fixed configs
const parSched = [best, REF.SPX_FAV.c, REF.DAX_DEFAULT_OFF.c].map(c => { const r1 = runC(c, A, B), r2 = runSched(() => c, A, B); return { id: c.id, run: [r1.cagr, r1.maxDD, r1.trades], sched: [r2.cagr, r2.maxDD, r2.trades] }; });
lap('sched parity ' + JSON.stringify(parSched));
// WF candidate set
const WF_RTS = String(process.env.RSL_WF_RTS || '5,10,25').split(',').map(Number), WF_RT_IDX = [0, ...WF_RTS];
const WFC = [];
for (const e of [{ mode: 'OFF', cw: 1, rts: [0] }, { mode: 'DIRECT', cw: 1, rts: [0] }, { mode: 'RANK', cw: 1, rts: WF_RTS }, { mode: 'CONFIRM', cw: 1, rts: WF_RTS }, { mode: 'CONFIRM', cw: 2, rts: WF_RTS }])
  for (const rt of e.rts) for (const rs of [1, 0]) for (const n of [3, 5, 8]) for (const [t, l] of [[0, 0], [20, 4]]) for (const rk of ['RSL26', 'RSL39', 'MOM52_4'])
    WFC.push({ mode: e.mode, cw: e.cw, rt, rs, n, t, l, rk, id: idOf({ mode: e.mode, cw: e.cw, rt, rs, n, t, l, rk }) });
const WFC_FIXED_TRAIL_RSL26 = WFC.filter(c => c.t === 20 && c.rk === 'RSL26');
const ANCHOR = A, OOS = ts('2018-01-01'), YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const WINDOWS = { expanding: Y => ANCHOR, roll3: Y => Math.max(ANCHOR, ts(`${Y - 3}-01-01`)), roll5: Y => Math.max(ANCHOR, ts(`${Y - 5}-01-01`)) };
const isCache = new Map();
const isStat = (c, a, b) => { const k = `${c.id}@${a}-${b}`; if (!isCache.has(k)) { const r = runC(c, a, b); isCache.set(k, { mar: r.mar, cagr: r.cagr, maxDD: r.maxDD }); } return isCache.get(k); };
function wfVariant(cands, win, pickMode) {
  const picks = {};
  for (const Y of YEARS) {
    const a = WINDOWS[win](Y), b = ts(`${Y - 1}-12-31`);
    const sc = cands.map(c => ({ c, s: isStat(c, a, b) }));
    let chosen;
    if (pickMode === 'raw') chosen = sc.reduce((x, y) => (y.s.mar > x.s.mar ? y : x));
    else { // plateau: median IS-MAR over candidate neighbours (same mode/rs/rk/t; adjacent n or rt)
      const idx = new Map(sc.map(x => [x.c.id, x]));
      const nb = x => sc.filter(y => y.c.mode === x.c.mode && y.c.cw === x.c.cw && y.c.rs === x.c.rs && y.c.rk === x.c.rk && y.c.t === x.c.t && ((y.c.n === x.c.n) + (y.c.rt === x.c.rt) >= 1) && Math.abs([3, 5, 8].indexOf(y.c.n) - [3, 5, 8].indexOf(x.c.n)) <= 1 && Math.abs(WF_RT_IDX.indexOf(y.c.rt) - WF_RT_IDX.indexOf(x.c.rt)) <= 1);
      chosen = sc.map(x => ({ ...x, p: Math.min(x.s.mar, med(nb(x).map(y => y.s.mar))) })).reduce((x, y) => (y.p > x.p ? y : x));
    }
    picks[Y] = { id: chosen.c.id, cfg: chosen.c, isMar: chosen.s.mar, isFrom: iso(a), isTo: iso(b) };
  }
  const cfgAt = execT => { const y = +iso(execT).slice(0, 4); return picks[Math.max(YEARS[0], Math.min(YEARS.at(-1), y))].cfg; };
  const r = runSched(cfgAt, OOS, B);
  return { win, pickMode, nCands: cands.length, cagr: r.cagr, maxDD: r.maxDD, mar: r.mar, sharpe: r.sharpe, trades: r.trades, yearly: Object.fromEntries(Object.entries(r.yearly).map(([y, o]) => [y, o.ret])), picks: Object.fromEntries(Object.entries(picks).map(([y, p]) => [y, { id: p.id, isMar: p.isMar, isFrom: p.isFrom, isTo: p.isTo }])) };
}
const WF = [];
for (const win of Object.keys(WINDOWS)) for (const pm of ['raw', 'plateau']) { WF.push({ set: 'voll (Exit/N/RT/RS/TRAIL 0|20/Ranking)', ...wfVariant(WFC, win, pm) }); lap(`wf ${win} ${pm} ${WF.at(-1).cagr.toFixed(1)}`); }
for (const win of Object.keys(WINDOWS)) { WF.push({ set: 'nur Exit/N/RT/RS (TRAIL 20 fest, RSL26 fest)', ...wfVariant(WFC_FIXED_TRAIL_RSL26, win, 'plateau') }); lap(`wf fixed ${win}`); }
const roll5SameAsExp = YEARS.filter(Y => WINDOWS.roll5(Y) === WINDOWS.expanding(Y));
const wfRefs = Object.fromEntries([['best', best], ...Object.entries(REF).map(([k, r]) => [k, r.c])].map(([k, c]) => [k, { id: c.id, ...c.wfFixed, yearly: (() => { const r = runC(c, OOS, B); return Object.fromEntries(Object.entries(r.yearly).map(([y, o]) => [y, o.ret])); })() }]));
lap('wf done');
// ---------- marginals
const marg = (key, vals, filter = () => true) => vals.map(v => { const s = grid.filter(c => c[key] === v && filter(c)); return { key, value: v, n: s.length, medMar10: med(s.map(c => c.y10.mar)), maxMar10: Math.max(...s.map(c => c.y10.mar)), medR: med(s.map(c => c.R)), bestId: s.reduce((x, y) => (y.score > x.score ? y : x)).id }; });
const modeKey = c => c.mode + (c.mode === 'CONFIRM' ? c.cw : '');
for (const c of grid) c.modeK = modeKey(c);
const MARG = [
  ...marg('modeK', ['OFF', 'DIRECT', 'DIRECT+RSL', 'CONFIRM1', 'CONFIRM2', 'CONFIRM3', 'RANK']),
  ...marg('rt', RTS, c => ['RANK', 'CONFIRM'].includes(c.mode)), ...marg('rs', [0, 1]), ...marg('t', TS), ...marg('l', LS, c => c.t > 0),
  ...marg('rk', ['RSL26', 'MOM52_4']), ...marg('n', NS),
];
// ---------- output
const slim = c => ({ id: c.id, mode: c.modeK, rt: c.rt, rs: c.rs, t: c.t, l: c.l, rk: c.rk, n: c.n, y10: c.y10, h1: c.h1, h2: c.h2, R: c.R, plateauR: c.plateauR, score: c.score, rankScore: c.rankScore, rankMar10: c.rankMar10, rankMar5: c.rankMar5, rankCagr10: c.rankCagr10, nNeigh: c.nNeigh, shift10: c.shift10, shift5: c.shift5, yearly: c.yearly, wfFixed: c.wfFixed });
const res = { generated: new Date().toISOString(), universe: UNIVERSE_KEY, benchmark: BENCH_TICKER, loaded: data.results.length, tickers: data.results.map(s => ({ t: s.ticker, first: iso(s.bars[0].time), bars: s.bars.length })), nConfigs: grid.length,
  windows: { y10: [iso(A), iso(B)], h1: [iso(A), '2021-11-08'], h2_5y: [iso(H), iso(B)], wf: ['2018-01-01', iso(B)] },
  best: slim(best), top: top.map(slim), topMar10: byMar10.slice(0, 10).map(slim), refs: Object.fromEntries(Object.entries(REF).map(([k, r]) => [k, { label: r.label, ...slim(r.c) }])),
  buyHold: Object.fromEntries(Object.entries(BH).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([w, s]) => [w, { cagr: s.cagr, maxDD: s.maxDD, mar: s.mar, sharpe: s.sharpe, yearly: Object.fromEntries(Object.entries(s.yearly).map(([y, o]) => [y, o.ret])) }]))])),
  shiftWinsBestVs: Object.fromEntries(Object.entries(REF).map(([k, r]) => [k, winsVs(r.c)])), prodParity: prodPar, schedParity: parSched,
  concentration: conc, repairs: globalThis.__RSL_REPAIRS || [], bhPrimary: BH_PRIMARY, rts: RTS, wfRts: WF_RTS, pbo: { sample: pset.length, S16: pbo16, S8: pbo8 }, varSR, dsr: dsrRows, bootstrap: boots, wf: WF, wfRefs, roll5SameAsExpandingYears: roll5SameAsExp, marginals: MARG };
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(res, null, 1));
const n2 = (x, d = 2) => x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d);
const rowCsv = c => ({ id: c.id, mode: c.modeK, rt: c.rt, rs: c.rs, t: c.t, l: c.l, rk: c.rk, n: c.n, c10: n2(c.y10.cagr), d10: n2(c.y10.maxDD), m10: n2(c.y10.mar, 3), s10: n2(c.y10.sharpe, 3), tr10: c.y10.trades, ch1: n2(c.h1.cagr), mh1: n2(c.h1.mar, 3), c5: n2(c.h2.cagr), d5: n2(c.h2.maxDD), m5: n2(c.h2.mar, 3), R: n2(c.R, 3), pl: n2(c.plateauR, 3), sc: n2(c.score, 3), rS: c.rankScore, rM: c.rankMar10, rM5: c.rankMar5 });
const COLS = [['id', 'Config'], ['mode', 'Exit-Modus'], ['rt', 'RANKTOP'], ['rs', 'RS-Exit'], ['t', 'TRAIL %'], ['l', 'Sperre Wo.'], ['rk', 'Rangliste'], ['n', 'N'], ['c10', 'CAGR 10 J. %'], ['d10', 'MaxDD 10 J. %'], ['m10', 'MAR 10 J.'], ['s10', 'Sharpe 10 J.'], ['tr10', 'Trades 10 J.'], ['ch1', 'CAGR 2016–21 %'], ['mh1', 'MAR 2016–21'], ['c5', 'CAGR 5 J. (2021–26) %'], ['d5', 'MaxDD 5 J. %'], ['m5', 'MAR 5 J.'], ['R', 'min MAR (10J/H1/H2)'], ['pl', 'Plateau-Median min-MAR'], ['sc', 'Robust-Score'], ['rS', 'Rang Robust-Score'], ['rM', 'Rang MAR 10 J.'], ['rM5', 'Rang MAR 5 J.']].map(([key, label]) => ({ key, label }));
writeFileSync(`${OUT}/${TAG}.csv`, toGermanCsv(byScore.slice(0, 300).map(rowCsv), COLS));
writeFileSync(`${OUT}/${TAG}_Grid_alle.csv`, toGermanCsv(byScore.map(rowCsv), COLS));
writeFileSync(`${OUT}/${TAG}_WalkForward.csv`, toGermanCsv(WF.flatMap(w => YEARS.map(Y => ({ set: w.set, win: w.win, pm: w.pickMode, Y, id: w.picks[Y].id, isMar: n2(w.picks[Y].isMar, 3), isFrom: w.picks[Y].isFrom, ret: n2(w.yearly[Y], 1) }))), [['set', 'Kandidaten'], ['win', 'Lernfenster'], ['pm', 'Auswahl'], ['Y', 'Jahr'], ['id', 'gewählte Config'], ['isMar', 'IS-MAR'], ['isFrom', 'IS ab'], ['ret', 'Rendite Jahr %']].map(([key, label]) => ({ key, label }))));
writeFileSync(`${OUT}/${TAG}_Marginalien.csv`, toGermanCsv(MARG.map(m => ({ ...m, medMar10: n2(m.medMar10, 3), maxMar10: n2(m.maxMar10, 3), medR: n2(m.medR, 3) })), [['key', 'Dimension'], ['value', 'Wert'], ['n', 'Configs'], ['medMar10', 'Median MAR 10 J.'], ['maxMar10', 'Max MAR 10 J.'], ['medR', 'Median min-MAR'], ['bestId', 'beste Config (Robust-Score)']].map(([key, label]) => ({ key, label }))));
lap('wrote'); process.exit(0);
