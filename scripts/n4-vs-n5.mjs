#!/usr/bin/env node
/**
 * N=4 vs N=5 for the favoured variant RANK RT25 RS1 RSL26 TRAIL20 LOCK4 (analysis only).
 * N=3..7; RT 20/25/30 plateau for N4/N5; N4 MOM52_4 for info. 10y, halves, fixed WF 2018-26 (carry, continuous),
 * 52 shifted start weeks, stationary block bootstrap N4 vs N5 (paired weekly returns). Engine: scripts/research-engine.mjs
 * (parity vs production rotationBacktest checked for N4 below).
 */
import { writeFileSync } from 'fs';
import { run, ts, mean, sdev, toGermanCsv, data, benchmark } from './research-engine.mjs';
import { rotationBacktest } from '../lib/fn/grokki-math.js';
const OUT = '/workspace/thoBox/Grokki/strategies', TAG = 'RSL26_N4_vs_N5_2026-11-10';
const A = ts('2016-11-09'), B = ts('2026-11-09');
const WIN = { y10: [A, B], h1: [A, ts('2021-11-08')], h2: [ts('2021-11-09'), B], wf: [ts('2018-01-01'), B] };
const V = [];
for (const n of [3, 4, 5, 6, 7]) V.push({ id: `N${n}_RT25`, n, rankTop: 25, rk: 'RSL26', group: 'N-Sweep' });
for (const n of [4, 5]) for (const rt of [20, 30]) V.push({ id: `N${n}_RT${rt}`, n, rankTop: rt, rk: 'RSL26', group: 'Plateau RT' });
V.push({ id: 'N4_RT25_MOM', n: 4, rankTop: 25, rk: 'MOM52_4', group: 'Info MOM52_4' });
const cfg = v => ({ mode: 'RANK', n: v.n, rankTop: v.rankTop, rsExit: true, confirmWeeks: 1 });
const rows = [];
for (const v of V) {
  const r = { ...v };
  for (const [k, [a, b]] of Object.entries(WIN)) { const s = run(cfg(v), () => v.rk, a, b, { trail: 0.2, lock: 4 }); r[k] = { cagr: s.cagr, maxDD: s.maxDD, mar: s.mar, sharpe: s.sharpe, trades: s.trades, rets: k === 'y10' ? s.weekRets : undefined, yearly: k === 'wf' ? Object.fromEntries(Object.entries(s.yearly).map(([y, o]) => [y, o.ret])) : undefined }; }
  const sh = [];
  for (let i = 0; i < 52; i++) { const s = run(cfg(v), () => v.rk, A + i * 7 * 86400, B, { trail: 0.2, lock: 4 }); sh.push(s); }
  const q = (k, p) => { const a = sh.map(o => o[k]).sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; };
  r.shifts = { cagrMin: q('cagr', 0), cagrMed: q('cagr', 0.5), marMin: q('mar', 0), marMed: q('mar', 0.5), ddWorst: q('maxDD', 0), ddMed: q('maxDD', 0.5), sharpeMin: q('sharpe', 0), sharpeMed: q('sharpe', 0.5), list: sh.map(s => ({ cagr: s.cagr, mar: s.mar, sharpe: s.sharpe })) };
  rows.push(r);
  console.log(v.id.padEnd(12), ['y10', 'h1', 'h2', 'wf'].map(k => `${r[k].cagr.toFixed(2)}/${r[k].maxDD.toFixed(2)}/${r[k].mar.toFixed(3)}`).join('  '), 'Sh', r.y10.sharpe.toFixed(3), 'tr', r.y10.trades, 'shift CAGR min/med', r.shifts.cagrMin.toFixed(1), r.shifts.cagrMed.toFixed(1), 'MAR', r.shifts.marMin.toFixed(2), r.shifts.marMed.toFixed(2));
}
const get = id => rows.find(r => r.id === id);
// paired start-week wins N4 vs N5
const n4 = get('N4_RT25'), n5 = get('N5_RT25');
const shiftWins = { mar: n4.shifts.list.filter((x, i) => x.mar > n5.shifts.list[i].mar).length, cagr: n4.shifts.list.filter((x, i) => x.cagr > n5.shifts.list[i].cagr).length, sharpe: n4.shifts.list.filter((x, i) => x.sharpe > n5.shifts.list[i].sharpe).length };
// stationary block bootstrap (paired weekly returns, same weeks)
let seed = 42; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const sr = a => { const s = sdev(a); return s > 0 ? mean(a) / s : 0; };
function boot(x, y, nb = 5000, mb = 13) {
  const n = Math.min(x.length, y.length); x = x.slice(-n); y = y.slice(-n); const out = [];
  for (let b = 0; b < nb; b++) {
    let i = Math.floor(rnd() * n); const xs = [], ys = [];
    for (let k = 0; k < n; k++) { if (k > 0 && rnd() < 1 / mb) i = Math.floor(rnd() * n); else if (k > 0) i = (i + 1) % n; xs.push(x[i]); ys.push(y[i]); }
    const cg = a => 100 * (Math.exp(a.reduce((p, q) => p + Math.log(1 + q), 0) / (n / 52)) - 1);
    const dd = a => { let v = 1, pk = 1, m = 0; for (const r of a) { v *= 1 + r; pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); } return 100 * m; };
    const cx = cg(xs), cy = cg(ys);
    out.push({ dC: cx - cy, dS: (sr(xs) - sr(ys)) * Math.sqrt(52), dM: cx / Math.abs(dd(xs)) - cy / Math.abs(dd(ys)) });
  }
  const q = (k, p) => { const a = out.map(o => o[k]).sort((u, v) => u - v); return a[Math.floor(p * (a.length - 1))]; };
  return { nb, meanBlock: mb, weeks: n, dCagr: [q('dC', .05), q('dC', .5), q('dC', .95)], pCagr: out.filter(o => o.dC > 0).length / nb, dSharpe: [q('dS', .05), q('dS', .5), q('dS', .95)], pSharpe: out.filter(o => o.dS > 0).length / nb, dMar: [q('dM', .05), q('dM', .5), q('dM', .95)], pMar: out.filter(o => o.dM > 0).length / nb };
}
const boots = [4, 13, 26].map(mb => boot(n4.y10.rets, n5.y10.rets, 5000, mb));
for (const b of boots) console.log('boot N4 vs N5 mb', b.meanBlock, JSON.stringify(b));
// production engine parity for N4 / N5 (10y)
const prod = {};
for (const n of [4, 5]) { const bt = rotationBacktest(data.results, 10, n, { benchmarkBars: benchmark.bars, mode: 'RANK', rankTop: 25, rsExit: true, confirmWeeks: 1, fee: 1, startCapital: 10000, trail: 20, trailLock: 4, windowStart: A, windowEnd: B }); prod[n] = { cagr: bt.cagr, maxDD: bt.maxDD, trades: bt.stats.tradesClosed }; console.log('prod N', n, bt.cagr.toFixed(2), bt.maxDD.toFixed(2), bt.stats.tradesClosed); }
// decision rule
const b13 = boots[1];
const crit = {
  mar10y: n4.y10.mar > n5.y10.mar, marWf: n4.wf.mar > n5.wf.mar, marH1: n4.h1.mar > n5.h1.mar, marH2: n4.h2.mar > n5.h2.mar, pSharpe: b13.pSharpe >= 0.7,
};
const pickN4 = Object.values(crit).every(Boolean);
console.log('criteria', JSON.stringify(crit), 'pick', pickN4 ? 'N4' : 'N5');
const nn = (x, d = 2) => x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d);
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ generated: new Date().toISOString(), rows: rows.map(r => ({ ...r, y10: { ...r.y10, rets: undefined }, shifts: { ...r.shifts, list: undefined } })), shiftWins, boots, prod, crit, pick: pickN4 ? 4 : 5 }, null, 1));
const K = [['cagr', 'CAGR', 2], ['maxDD', 'MaxDD', 2], ['mar', 'MAR', 3], ['sharpe', 'Sharpe', 3], ['trades', 'Trades', 0]];
const WL = { y10: '10 J.', h1: '2016–21', h2: '2021–26', wf: 'WF 2018–26' };
const YRS = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];
const csv = rows.map(r => { const o = { id: r.id, group: r.group, n: r.n, rankTop: r.rankTop, ranking: r.rk }; for (const w of Object.keys(WIN)) for (const [k, , d] of K) o[`${w}_${k}`] = nn(r[w][k], d); for (const k of ['cagrMin', 'cagrMed', 'marMin', 'marMed', 'sharpeMin', 'sharpeMed', 'ddWorst', 'ddMed']) o[`s_${k}`] = nn(r.shifts[k], 3); for (const y of YRS) o[`y${y}`] = nn(r.wf.yearly[y], 1); return o; });
const cols = [['id', 'ID'], ['group', 'Gruppe'], ['n', 'N'], ['rankTop', 'RANKTOP'], ['ranking', 'Ranking']].map(([key, label]) => ({ key, label }))
  .concat(Object.keys(WIN).flatMap(w => K.map(([k, l]) => ({ key: `${w}_${k}`, label: `${l} ${WL[w]}` }))))
  .concat([['cagrMin', 'CAGR min 52 Starts'], ['cagrMed', 'CAGR Median 52 Starts'], ['marMin', 'MAR min 52 Starts'], ['marMed', 'MAR Median 52 Starts'], ['sharpeMin', 'Sharpe min 52 Starts'], ['sharpeMed', 'Sharpe Median 52 Starts'], ['ddWorst', 'MaxDD schlechtester Start'], ['ddMed', 'MaxDD Median Starts']].map(([k, l]) => ({ key: `s_${k}`, label: l })))
  .concat(YRS.map(y => ({ key: `y${y}`, label: `Rendite ${y} % (WF)` })));
writeFileSync(`${OUT}/${TAG}.csv`, toGermanCsv(csv, cols));
console.log('wrote', OUT);
process.exit(0);
