#!/usr/bin/env node
/** Task A: CONFIRM N5 RT25 (user's claimed best) + full ranking of all variants with trailing stop 20 %/lock 4. Analysis only. */
import { writeFileSync } from 'fs';
import { run, ts, iso, refRun, P, toGermanCsv } from './research-engine.mjs';
const OUT = '/workspace/thoBox/Grokki/strategies';
const WIN = [{ k: 'y10', a: '2016-11-09', b: '2026-11-09' }, { k: 'h1', a: '2016-11-09', b: '2021-11-08' }, { k: 'h2', a: '2021-11-09', b: '2026-11-09' }, { k: 'wf', a: '2018-01-01', b: '2026-11-09' }];
const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const V = [];
const add = (id, label, group, cfg) => V.push({ id, label, group, ...cfg });
// new: user's claimed best
for (const rs of [true, false]) for (const cw of [1, 2, 3]) add(`CONF_N5_RT25_CW${cw}_RS${rs ? 1 : 0}`, `CONFIRM ${cw} Wo., N5, Rank-Schutz 25, RS-Exit ${rs ? 'an' : 'aus'}`, cw === 2 ? 'neu: deine Annahme' : 'neu: Nachbar CW', { mode: 'CONFIRM', n: 5, rankTop: 25, rsExit: rs, confirmWeeks: cw });
// earlier variants (strategy-variant-compare 2026-11-09)
add('RANK_N5_RT25_RS1', 'RANK N5 RT25 RS-Exit an (deine Variante)', 'bisher', { mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1 });
add('RANK_N5_RT25_RS0', 'RANK N5 RT25 RS-Exit aus', 'bisher', { mode: 'RANK', n: 5, rankTop: 25, rsExit: false, confirmWeeks: 1 });
add('RANK_N5_RT10_RS1', 'RANK N5 RT10 RS-Exit an', 'bisher', { mode: 'RANK', n: 5, rankTop: 10, rsExit: true, confirmWeeks: 1 });
add('RANK_N8_RT8_RS0', 'RANK N8 RT8 RS-Exit aus (Plateau)', 'bisher', { mode: 'RANK', n: 8, rankTop: 8, rsExit: false, confirmWeeks: 1 });
add('RANK_N8_RT5_RS0', 'RANK N8 RT5 RS-Exit aus', 'bisher', { mode: 'RANK', n: 8, rankTop: 5, rsExit: false, confirmWeeks: 1 });
add('CONF_N10_RT10_CW2_RS0', 'CONFIRM 2 Wo., N10, RT10, RS-Exit aus (bisher empfohlen)', 'bisher', { mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 });
add('CONF_N10_RT10_CW2_RS1', 'CONFIRM 2 Wo., N10, RT10, RS-Exit an', 'bisher', { mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: true, confirmWeeks: 2 });
add('RANK_N25_RT25_RS1', 'RANK N25 RT25 RS-Exit an (Baseline)', 'bisher', { mode: 'RANK', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 });

// parity check
const peakOf = h => Math.max(h.entryPrice, ...h.path.map(x => x.close ?? 0));
const chk = V.find(v => v.id === 'RANK_N5_RT25_RS1');
const ref = refRun(P, 5, { ...chk, startCapital: 10000, fee: 1, windowStart: ts('2016-11-09'), windowEnd: ts('2026-11-09'), extraExit: c => c.close <= peakOf(c.h) * 0.8 ? 'trail' : null, reentryCooldownWeeks: 4 });
console.log('parity ref', ref.cagr.toFixed(3), ref.maxDD.toFixed(3));

const rows = [];
for (const v of V) for (const rk of ['RSL26', 'MOM52_4']) for (const tr of [0, 0.2]) {
  const r = { id: v.id, label: v.label, group: v.group, ranking: rk, trail: tr ? 'Trail 20 %/4' : 'ohne', mode: v.mode, n: v.n, rankTop: v.rankTop, rsExit: v.rsExit ? 1 : 0, cw: v.confirmWeeks };
  for (const w of WIN) { const s = run(v, () => rk, ts(w.a), ts(w.b), { trail: tr, lock: 4 }); r[w.k] = { cagr: s.cagr, maxDD: s.maxDD, mar: s.mar, sharpe: s.sharpe, trades: s.trades, fees: s.fees, final: s.final, yearly: w.k === 'wf' ? Object.fromEntries(YEARS.map(y => [y, s.yearly[y].ret])) : undefined }; }
  rows.push(r);
  console.log(v.id.padEnd(22), rk.padEnd(7), tr ? 'T' : '-', ['y10', 'h1', 'h2', 'wf'].map(k => `${r[k].cagr.toFixed(2)}/${r[k].maxDD.toFixed(2)}/${r[k].mar.toFixed(3)}`).join('  '), 'Sh', r.y10.sharpe.toFixed(3), 'tr', r.y10.trades);
}
const n = (x, d = 2) => x == null || !Number.isFinite(+x) ? null : +(+x).toFixed(d);
writeFileSync(`${OUT}/RSL26_Confirm_N5_RT25_2026-11-10.json`, JSON.stringify({ generated: new Date().toISOString(), windows: WIN, parityRef: { cagr: ref.cagr, maxDD: ref.maxDD }, rows }, null, 1));
const K = [['cagr', 'CAGR', 2], ['maxDD', 'MaxDD', 2], ['mar', 'MAR', 3], ['sharpe', 'Sharpe', 3], ['trades', 'Trades', 0]];
const WL = { y10: '10 J.', h1: '2016–21', h2: '2021–26', wf: 'WF 2018–26' };
const csv = rows.map(r => { const o = { id: r.id, label: r.label, group: r.group, ranking: r.ranking, trail: r.trail }; for (const w of WIN) for (const [k, , d] of K) o[`${w.k}_${k}`] = n(r[w.k][k], d); for (const y of YEARS) o[`y${y}`] = n(r.wf.yearly[y], 1); return o; });
const cols = [['id', 'ID'], ['label', 'Variante'], ['group', 'Gruppe'], ['ranking', 'Ranking'], ['trail', 'Trailing-Stop']].map(([key, label]) => ({ key, label }))
  .concat(WIN.flatMap(w => K.map(([k, l]) => ({ key: `${w.k}_${k}`, label: `${l} ${WL[w.k]}` })))).concat(YEARS.map(y => ({ key: `y${y}`, label: `Rendite ${y} % (WF)` })));
writeFileSync(`${OUT}/RSL26_Confirm_N5_RT25_2026-11-10.csv`, toGermanCsv(csv, cols));
console.log('wrote');
process.exit(0);
