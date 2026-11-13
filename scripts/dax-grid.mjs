#!/usr/bin/env node
/**
 * DAX-Optimierung, Stufe 1 (Analyse, Produktion unverändert): voller Parameter-Grid auf research-engine (RSL_UNIVERSE=DAX).
 * Exit OFF/DIRECT/DIRECT+RSL/CONFIRM(cw1-3)/RANK × RANKTOP {0,5,10,15,20,25} × RS {0,1} × TRAIL {0,10,15,20,25,30} × LOCK {0,2,4,8}
 * × Ranking {RSL26,RSL20,RSL39,MOM52_4} × N {3,4,5,6,8,10}. Fenster: 10 J. 2016-11-09..2026-11-09, H1 ..2021-11-08, H2/5 J. 2021-11-09..
 * Aufruf: RSL_UNIVERSE=DAX node scripts/dax-grid.mjs <shard> <shards> <outDir>
 */
process.env.RSL_UNIVERSE = process.env.RSL_UNIVERSE || 'DAX';
const { writeFileSync } = await import('fs');
const { run, ts } = await import('./research-engine.mjs');
const [shard, shards, out] = [+process.argv[2] || 0, +process.argv[3] || 1, process.argv[4] || '/workspace/tmp/dax'];
export const WIN = { y10: ['2016-11-09', '2026-11-09'], h1: ['2016-11-09', '2021-11-08'], h2: ['2021-11-09', '2026-11-09'] };
// RSL_GRID=reduced (HDAX/Europa): Exit-Modi wie oben, RANKTOP aus RSL_RTS (z. B. "0,10,25,50"), RS 0/1, TRAIL 0 | 15/20/25 × Sperre 0/4,
// Ranking RSL26/MOM52_4, N 3/5/8/10. Default (ohne RSL_GRID) = voller DAX-Grid wie bisher.
const REDUCED = process.env.RSL_GRID === 'reduced';
const RTS = REDUCED ? String(process.env.RSL_RTS || '0,10,25,50').split(',').map(Number) : [0, 5, 10, 15, 20, 25];
const EXITS = [{ mode: 'OFF', cw: 1, rts: [0] }, { mode: 'DIRECT', cw: 1, rts: [0] }, { mode: 'DIRECT+RSL', cw: 1, rts: [0] },
  ...[1, 2, 3].map(cw => ({ mode: 'CONFIRM', cw, rts: RTS })), { mode: 'RANK', cw: 1, rts: RTS }];
const TRAILS = REDUCED ? [[0, 0], ...[15, 20, 25].flatMap(t => [0, 4].map(l => [t, l]))] : [[0, 0], ...[10, 15, 20, 25, 30].flatMap(t => [0, 2, 4, 8].map(l => [t, l]))];
const RKS = REDUCED ? ['RSL26', 'MOM52_4'] : ['RSL26', 'RSL20', 'RSL39', 'MOM52_4'];
const NS = REDUCED ? [3, 5, 8, 10] : [3, 4, 5, 6, 8, 10];
const cfgs = [];
for (const e of EXITS) for (const rt of e.rts) for (const rs of [1, 0]) for (const [t, l] of TRAILS) for (const rk of RKS) for (const n of NS)
  cfgs.push({ mode: e.mode, cw: e.cw, rt, rs, t, l, rk, n, id: `${e.mode}${e.mode === 'CONFIRM' ? e.cw : ''}|RT${rt}|RS${rs}|T${t}L${l}|${rk}|N${n}` });
const mine = cfgs.filter((_, i) => i % shards === shard);
const res = []; const t0 = Date.now();
for (const [i, c] of mine.entries()) {
  const base = { mode: c.mode, n: c.n, rankTop: c.rt, rsExit: !!c.rs, confirmWeeks: c.cw }, o = { ...c };
  for (const [k, [a, b]] of Object.entries(WIN)) { const s = run(base, () => c.rk, ts(a), ts(b), { trail: c.t / 100, lock: c.l }); o[k] = { cagr: s.cagr, maxDD: s.maxDD, mar: s.mar, sharpe: s.sharpe, trades: s.trades }; }
  res.push(o);
  if (i % 500 === 0) console.log(`shard ${shard}: ${i}/${mine.length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
writeFileSync(`${out}/grid-${shard}.json`, JSON.stringify({ total: cfgs.length, shard, shards, res }));
console.log(`shard ${shard} done ${res.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`); process.exit(0);
