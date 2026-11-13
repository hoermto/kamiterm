#!/usr/bin/env node
/**
 * Task B prototypes (analysis only): (1) PBO via CSCV over ~150 configs, (2) Deflated Sharpe Ratio,
 * (3) stationary block bootstrap of paired weekly returns (12-1 vs RSL26), (4) start-week path distribution (52 starts).
 */
import { writeFileSync } from 'fs';
import { run, ts, mean, sdev, toGermanCsv } from './research-engine.mjs';
const OUT = '/workspace/thoBox/Grokki/strategies';
const TAG = 'RSL26_PathSelection_Bewertung_2026-11-10';
const A = ts('2016-11-09'), B = ts('2026-11-09');
const BASES = {
  RANK_N5_RT25_RS1: { mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  RANK_N5_RT10_RS1: { mode: 'RANK', n: 5, rankTop: 10, rsExit: true, confirmWeeks: 1 },
  RANK_N8_RT8_RS0: { mode: 'RANK', n: 8, rankTop: 8, rsExit: false, confirmWeeks: 1 },
  RANK_N8_RT5_RS0: { mode: 'RANK', n: 8, rankTop: 5, rsExit: false, confirmWeeks: 1 },
  RANK_N25_RT25_RS1: { mode: 'RANK', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  CONF_N10_RT10_CW2_RS0: { mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
  CONF_N10_RT10_CW2_RS1: { mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: true, confirmWeeks: 2 },
  CONF_N5_RT25_CW1_RS1: { mode: 'CONFIRM', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  CONF_N5_RT25_CW2_RS1: { mode: 'CONFIRM', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 2 },
  CONF_N5_RT25_CW3_RS1: { mode: 'CONFIRM', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 3 },
  CONF_N5_RT25_CW2_RS0: { mode: 'CONFIRM', n: 5, rankTop: 25, rsExit: false, confirmWeeks: 2 },
  RANK_N5_RT25_RS0: { mode: 'RANK', n: 5, rankTop: 25, rsExit: false, confirmWeeks: 1 },
  RANK_N10_RT10_RS1: { mode: 'RANK', n: 10, rankTop: 10, rsExit: true, confirmWeeks: 1 },
  RANK_N10_RT25_RS1: { mode: 'RANK', n: 10, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  RANK_N15_RT25_RS1: { mode: 'RANK', n: 15, rankTop: 25, rsExit: true, confirmWeeks: 1 },
};
const RANKS = ['RSL26', 'RSL39', 'MOM52_4', 'MOM52_2', 'MOM65_4'];
const cfgs = [];
for (const [bid, b] of Object.entries(BASES)) for (const rk of RANKS) for (const tr of [0, 0.2]) {
  const r = run(b, () => rk, A, B, { trail: tr, lock: 4 });
  cfgs.push({ id: `${bid}|${rk}|${tr ? 'T20' : 'noT'}`, rets: r.weekRets, cagr: r.cagr, maxDD: r.maxDD, mar: r.mar, sharpe: r.sharpe });
}
const T = Math.min(...cfgs.map(c => c.rets.length));
for (const c of cfgs) c.rets = c.rets.slice(c.rets.length - T);
console.log('configs', cfgs.length, 'weeks', T);
// ---------- (1) PBO via CSCV
const sr = a => { const s = sdev(a); return s > 0 ? mean(a) / s : -Infinity; };
function cscv(set, S = 16, metric = sr) {
  const M = set.length, L = Math.floor(T / S);
  const blocks = Array.from({ length: S }, (_, i) => [i * L, i === S - 1 ? T : (i + 1) * L]);
  const combos = []; const rec = (st, cur) => { if (cur.length === S / 2) { combos.push([...cur]); return; } for (let i = st; i < S; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } }; rec(0, []);
  const seg = (c, ids) => ids.flatMap(i => c.rets.slice(blocks[i][0], blocks[i][1]));
  // precompute per block per config sums for speed
  const stat = set.map(c => blocks.map(([a, b]) => { const x = c.rets.slice(a, b); return { n: x.length, s: x.reduce((p, q) => p + q, 0), s2: x.reduce((p, q) => p + q * q, 0) }; }));
  const srOf = (j, ids) => { let n = 0, s = 0, s2 = 0; for (const i of ids) { n += stat[j][i].n; s += stat[j][i].s; s2 += stat[j][i].s2; } const m = s / n, v = (s2 - n * m * m) / (n - 1); return m / Math.sqrt(v); };
  let below = 0; const lambdas = []; let degr = []; const win = {};
  for (const isIds of combos) {
    const oosIds = [...Array(S).keys()].filter(i => !isIds.includes(i));
    const isS = set.map((_, j) => srOf(j, isIds)), oosS = set.map((_, j) => srOf(j, oosIds));
    let best = 0; for (let j = 1; j < M; j++) if (isS[j] > isS[best]) best = j;
    const rank = oosS.filter(x => x < oosS[best]).length + 1; // 1..M
    const w = rank / (M + 1), lam = Math.log(w / (1 - w));
    lambdas.push(lam); if (lam <= 0) below++;
    degr.push([isS[best], oosS[best]]); win[best] = (win[best] || 0) + 1;
  }
  const oosBestMedianRank = lambdas.map(l => 1 / (1 + Math.exp(-l))).sort((a, b) => a - b)[lambdas.length >> 1];
  return { M, S, splits: combos.length, pbo: below / combos.length, medianRelRank: oosBestMedianRank, meanIS: mean(degr.map(d => d[0])) * Math.sqrt(52), meanOOS: mean(degr.map(d => d[1])) * Math.sqrt(52), topWinners: Object.entries(win).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([j, c]) => ({ id: set[j].id, share: c / combos.length })) };
}
const pboAll = cscv(cfgs), pboTrail = cscv(cfgs.filter(c => c.id.endsWith('T20'))), pboUserRank = cscv(cfgs.filter(c => c.id.startsWith('RANK_N5_RT25_RS1|')));
const pboAll8 = cscv(cfgs, 8);
console.log('PBO all', JSON.stringify(pboAll), '\nPBO trail', pboTrail, '\nPBO userRank', pboUserRank, '\nPBO all S8', pboAll8);
// ---------- (2) Deflated Sharpe
const normInv = p => { // Acklam
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00], b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01], c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00], d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};
const normCdf = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), dd = 0.3989423 * Math.exp(-x * x / 2), p = dd * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const moments = x => { const m = mean(x), s = sdev(x), n = x.length; const sk = x.reduce((p, q) => p + ((q - m) / s) ** 3, 0) / n, ku = x.reduce((p, q) => p + ((q - m) / s) ** 4, 0) / n; return { m, s, sk, ku }; };
function psr(x, sr0) { const { m, s, sk, ku } = moments(x), S = m / s, n = x.length; return normCdf((S - sr0) * Math.sqrt(n - 1) / Math.sqrt(1 - sk * S + (ku - 1) / 4 * S * S)); }
function dsr(x, nTrials, varSR) { const g = 0.5772156649; const sr0 = Math.sqrt(varSR) * ((1 - g) * normInv(1 - 1 / nTrials) + g * normInv(1 - 1 / (nTrials * Math.E))); return { sr0w: sr0, sr0a: sr0 * Math.sqrt(52), dsr: psr(x, sr0) }; }
const get = id => cfgs.find(c => c.id === id);
const base = get('RANK_N5_RT25_RS1|RSL26|T20');
const KEYC = ['RANK_N5_RT25_RS1|RSL26|T20', 'RANK_N5_RT25_RS1|MOM52_4|T20', 'RANK_N5_RT10_RS1|MOM52_4|T20', 'CONF_N5_RT25_CW3_RS1|MOM52_4|T20', 'CONF_N5_RT25_CW2_RS1|RSL26|T20', 'CONF_N10_RT10_CW2_RS0|RSL26|T20'];
const varSRabs = (() => { const v = cfgs.map(c => sr(c.rets)).filter(Number.isFinite); return sdev(v) ** 2; })();
const diffs = cfgs.filter(c => c !== base).map(c => c.rets.map((r, i) => r - base.rets[i]));
const varSRdiff = sdev(diffs.map(sr).filter(Number.isFinite)) ** 2;
const dsrRows = [];
for (const id of KEYC) {
  const c = get(id); const d = c.rets.map((r, i) => r - base.rets[i]);
  const row = { id, srAnn: sr(c.rets) * Math.sqrt(52), psr0: psr(c.rets, 0) };
  for (const N of [150, 500, 1000]) row[`dsrAbs${N}`] = dsr(c.rets, N, varSRabs).dsr;
  row.sr0AbsAnn150 = dsr(c.rets, 150, varSRabs).sr0a;
  if (c !== base) { row.srDiffAnn = sr(d) * Math.sqrt(52); row.psrDiff = psr(d, 0); for (const N of [30, 150]) row[`dsrDiff${N}`] = dsr(d, N, varSRdiff).dsr; row.sr0DiffAnn150 = dsr(d, 150, varSRdiff).sr0a; }
  dsrRows.push(row); console.log('DSR', JSON.stringify(row));
}
// ---------- (3) stationary block bootstrap of paired weekly returns
let seed = 42; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
function bootstrapPair(x, y, nb = 5000, meanBlock = 13) {
  const n = x.length, out = [];
  for (let b = 0; b < nb; b++) {
    let i = Math.floor(rnd() * n); const xs = [], ys = [];
    for (let k = 0; k < n; k++) { if (k > 0 && rnd() < 1 / meanBlock) i = Math.floor(rnd() * n); else if (k > 0) i = (i + 1) % n; xs.push(x[i]); ys.push(y[i]); }
    const cg = a => 100 * (Math.exp(a.reduce((p, q) => p + Math.log(1 + q), 0) / (n / 52)) - 1);
    const dd = a => { let v = 1, pk = 1, m = 0; for (const r of a) { v *= 1 + r; pk = Math.max(pk, v); m = Math.min(m, v / pk - 1); } return 100 * m; };
    const cx = cg(xs), cy = cg(ys), dx = dd(xs), dy = dd(ys);
    out.push({ dC: cx - cy, dS: (sr(xs) - sr(ys)) * Math.sqrt(52), dM: cx / Math.abs(dx) - cy / Math.abs(dy), cx, cy, dx, dy });
  }
  const q = (k, p) => { const a = out.map(o => o[k]).sort((u, v) => u - v); return a[Math.floor(p * (a.length - 1))]; };
  return { nb, meanBlock, dCagr: [q('dC', 0.05), q('dC', 0.5), q('dC', 0.95)], pCagrPos: out.filter(o => o.dC > 0).length / nb, dSharpe: [q('dS', 0.05), q('dS', 0.5), q('dS', 0.95)], pSharpePos: out.filter(o => o.dS > 0).length / nb,
    dMar: [q('dM', 0.05), q('dM', 0.5), q('dM', 0.95)], pMarPos: out.filter(o => o.dM > 0).length / nb, cagrX: [q('cx', 0.05), q('cx', 0.5), q('cx', 0.95)], cagrY: [q('cy', 0.05), q('cy', 0.5), q('cy', 0.95)], ddX: [q('dx', 0.05), q('dx', 0.5), q('dx', 0.95)], ddY: [q('dy', 0.05), q('dy', 0.5), q('dy', 0.95)] };
}
const boots = [];
for (const [xid, yid] of [['RANK_N5_RT25_RS1|MOM52_4|T20', 'RANK_N5_RT25_RS1|RSL26|T20'], ['RANK_N5_RT25_RS1|RSL26|T20', 'RANK_N5_RT25_RS1|RSL26|noT'], ['CONF_N5_RT25_CW2_RS1|RSL26|T20', 'RANK_N5_RT25_RS1|RSL26|T20']]) for (const mb of [4, 13, 26]) {
  const r = bootstrapPair(get(xid).rets, get(yid).rets, 5000, mb); boots.push({ x: xid, y: yid, ...r }); console.log('boot', xid, 'vs', yid, mb, JSON.stringify(r));
}
// ---------- (4) start-week path distribution (52 consecutive start weeks, fixed end)
const paths = [];
for (const id of ['RANK_N5_RT25_RS1|RSL26|T20', 'RANK_N5_RT25_RS1|MOM52_4|T20', 'CONF_N5_RT25_CW2_RS1|RSL26|T20', 'CONF_N10_RT10_CW2_RS0|RSL26|T20']) {
  const [bid, rk, tr] = id.split('|'); const res = [];
  for (let s = 0; s < 52; s++) { const r = run(BASES[bid], () => rk, A + s * 7 * 86400, B, { trail: tr === 'T20' ? 0.2 : 0, lock: 4 }); res.push({ s, cagr: r.cagr, maxDD: r.maxDD, mar: r.mar }); }
  const qq = (k, p) => { const a = res.map(o => o[k]).sort((u, v) => u - v); return a[Math.floor(p * (a.length - 1))]; };
  paths.push({ id, res, cagr: [qq('cagr', 0), qq('cagr', 0.5), qq('cagr', 1)], mar: [qq('mar', 0), qq('mar', 0.5), qq('mar', 1)], dd: [qq('maxDD', 0), qq('maxDD', 0.5), qq('maxDD', 1)] });
  console.log('paths', id, paths.at(-1).cagr.map(x => x.toFixed(1)), paths.at(-1).mar.map(x => x.toFixed(2)), paths.at(-1).dd.map(x => x.toFixed(1)));
}
// paired path comparison: MOM vs RSL26 per start week
const pm = paths[1].res, pr = paths[0].res;
const winsPaths = pm.filter((x, i) => x.mar > pr[i].mar).length, winsPathsC = pm.filter((x, i) => x.cagr > pr[i].cagr).length;
console.log('paths MOM beats RSL26: MAR', winsPaths, '/52, CAGR', winsPathsC, '/52');
// ---------- (5) rolling 2-year windows every 13 weeks (paper-style disjoint-ish test windows), MOM vs RSL26 (user, trail)
const roll = [];
for (let st = A; st + 2 * 365.25 * 86400 <= B; st += 13 * 7 * 86400) {
  const en = st + 2 * 365.25 * 86400, b = BASES.RANK_N5_RT25_RS1;
  const r26 = run(b, () => 'RSL26', st, en, { trail: 0.2, lock: 4 }), rm = run(b, () => 'MOM52_4', st, en, { trail: 0.2, lock: 4 });
  const cn = run(BASES.CONF_N5_RT25_CW2_RS1, () => 'RSL26', st, en, { trail: 0.2, lock: 4 });
  roll.push({ start: new Date(st * 1000).toISOString().slice(0, 10), r26: { cagr: r26.cagr, mar: r26.mar, sharpe: r26.sharpe }, mom: { cagr: rm.cagr, mar: rm.mar, sharpe: rm.sharpe }, conf: { cagr: cn.cagr, mar: cn.mar, sharpe: cn.sharpe } });
}
const rollSum = { n: roll.length, momBeatsCagr: roll.filter(r => r.mom.cagr > r.r26.cagr).length, momBeatsSharpe: roll.filter(r => r.mom.sharpe > r.r26.sharpe).length, momBeatsMar: roll.filter(r => r.mom.mar > r.r26.mar).length,
  confBeatsCagr: roll.filter(r => r.conf.cagr > r.r26.cagr).length, confBeatsMar: roll.filter(r => r.conf.mar > r.r26.mar).length,
  medDiffCagr: (() => { const a = roll.map(r => r.mom.cagr - r.r26.cagr).sort((x, y) => x - y); return a[a.length >> 1]; })() };
console.log('rolling2y', JSON.stringify(rollSum));
writeFileSync(`${OUT}/${TAG}_Prototypen.json`, JSON.stringify({ generated: new Date().toISOString(), weeks: T, nConfigs: cfgs.length, configs: cfgs.map(c => ({ id: c.id, cagr: c.cagr, maxDD: c.maxDD, mar: c.mar, sharpe: c.sharpe })),
  pbo: { all: pboAll, all8: pboAll8, trail: pboTrail, userRankings: pboUserRank }, varSRabs, varSRdiff, dsr: dsrRows, bootstrap: boots, paths: paths.map(p => ({ ...p })), pathsMomBeats: { mar: winsPaths, cagr: winsPathsC }, rolling2y: { summary: rollSum, windows: roll } }, null, 1));
writeFileSync(`${OUT}/${TAG}_Konfigurationen.csv`, toGermanCsv(cfgs.map(c => ({ id: c.id, cagr: +c.cagr.toFixed(2), maxDD: +c.maxDD.toFixed(2), mar: +c.mar.toFixed(3), sharpe: +c.sharpe.toFixed(3) })), [['id', 'Config (Basis|Ranking|Trail)'], ['cagr', 'CAGR 10 J.'], ['maxDD', 'MaxDD'], ['mar', 'MAR'], ['sharpe', 'Sharpe']].map(([key, label]) => ({ key, label }))));
console.log('wrote'); process.exit(0);
