/** Entry + path features for trade anatomy (analysis only). */
import { SECTORS } from '../../lib/fn/grokki-universes.js';
import { wIdxAtOrBefore } from './rotation-hooks.mjs';

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const weekKey = t => Math.floor((t + 3 * 86400) / (7 * 86400));
export const SECTOR_OF = new Map(Object.entries(SECTORS).flatMap(([k, v]) => v.stocks.map(t => [t, k])));

/** rank table per week key using engine eligibility (last weekly bar within 7d of signal). */
export function buildRankTable(P) {
  const allDates = [...new Set(P.prepped.flatMap(s => s.bars.map(b => b.time)))].sort((a, b) => a - b);
  const lastOfWeek = new Map();
  for (const t of allDates) lastOfWeek.set(weekKey(t), t);
  const table = new Map(); // key -> Map(ticker -> rank)
  for (const [k, signalT] of lastOfWeek) {
    const rows = [];
    for (const p of P.prepped) {
      const i = wIdxAtOrBefore(p, k);
      if (i < 0 || p.rsl[i] == null) continue;
      if (!(signalT - p.W[i].time <= 7 * 86400)) continue;
      rows.push([p.ticker, p.rsl[i]]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    table.set(k, new Map(rows.map((r, i) => [r[0], i + 1])));
  }
  return { table, keys: [...lastOfWeek.keys()].sort((a, b) => a - b), lastOfWeek };
}

function dailyIdxAtOrBefore(p, t) {
  let lo = 0, hi = p.bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (p.bars[m].time <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
export { dailyIdxAtOrBefore };

/** Features known at the signal Friday close (point in time). */
export function entryFeatures(P, RT, p, signalT, execT, N) {
  const sk = weekKey(signalT);
  const wi = wIdxAtOrBefore(p, sk);
  const W = p.W, c = W[wi].close;
  const ret = k => wi - k >= 0 ? 100 * (c / W[wi - k].close - 1) : null;
  const sma = k => wi - k + 1 >= 0 ? mean(W.slice(wi - k + 1, wi + 1).map(x => x.close)) : null;
  const sma10 = sma(10);
  const wr = []; for (let i = Math.max(1, wi - 12); i <= wi; i++) wr.push(Math.log(W[i].close / W[i - 1].close));
  const di = dailyIdxAtOrBefore(p, signalT);
  const d = p.bars;
  const trs = []; for (let i = Math.max(1, di - 13); i <= di; i++) trs.push(Math.max(d[i].high - d[i].low, Math.abs(d[i].high - d[i - 1].close), Math.abs(d[i].low - d[i - 1].close)));
  const hi52 = Math.max(...d.slice(Math.max(0, di - 251), di + 1).map(b => b.high));
  const ti = p.trailIdx.has(sk) ? p.trailIdx.get(sk) : -1;
  const pt = ti >= 0 ? p.trail[ti] : null;
  let leadWeeks = 0; if (ti >= 0) for (let i = ti; i >= 0 && p.trail[i].quadrant === 'Leading'; i--) leadWeeks++;
  // rank history
  const pos = RT.keys.indexOf(sk);
  const rankAtK = k => RT.table.get(k)?.get(p.ticker) ?? null;
  const rank = rankAtK(sk);
  let weeksInTopN = 0; for (let j = pos - 1; j >= 0; j--) { const r = rankAtK(RT.keys[j]); if (r != null && r <= N) weeksInTopN++; else break; }
  const rank1w = pos >= 1 ? rankAtK(RT.keys[pos - 1]) : null;
  const rank4w = pos >= 4 ? rankAtK(RT.keys[pos - 4]) : null;
  const B = P.bench, bi = wIdxAtOrBefore(B, sk);
  const bc = B.W[bi].close;
  const execBar = p.map.get(execT);
  const bRet4 = bi >= 4 ? 100 * (bc / B.W[bi - 4].close - 1) : null;
  return {
    sector: SECTOR_OF.get(p.ticker) || '',
    rsl: p.rsl[wi], rank, rank1w, rank4w,
    rslChg1w: wi >= 1 && p.rsl[wi - 1] != null ? p.rsl[wi] - p.rsl[wi - 1] : null,
    rslChg4w: wi >= 4 && p.rsl[wi - 4] != null ? p.rsl[wi] - p.rsl[wi - 4] : null,
    rslRelBench: B.rsl[bi] ? p.rsl[wi] / B.rsl[bi] : null,
    quadrant: pt?.quadrant ?? '', rsRatio: pt?.ratio ?? null, rsMom: pt?.momentum ?? null, leadWeeks,
    distSma10: sma10 ? 100 * (c / sma10 - 1) : null,
    distSma26: p.rsl[wi] != null ? 100 * (p.rsl[wi] - 1) : null,
    ret1w: ret(1), ret4w: ret(4), ret13w: ret(13), ret26w: ret(26), ret52w: ret(52),
    volW13: wr.length > 2 ? 100 * sd(wr) * Math.sqrt(52) : null,
    atrPct: 100 * mean(trs) / d[di].close,
    gapPct: execBar ? 100 * (execBar.open / d[di].close - 1) : null,
    benchRsl: B.rsl[bi], benchAbove26: B.rsl[bi] != null ? (B.rsl[bi] >= 1 ? 1 : 0) : null,
    benchAbove40: B.sma40[bi] != null ? (bc >= B.sma40[bi] ? 1 : 0) : null,
    benchRet4w: bRet4,
    weeksInTopN, price: c, distHigh52: 100 * (c / hi52 - 1),
  };
}

/** Path features from entry to exit (daily bars + weekly path recorded by engine). */
export function pathFeatures(tr) {
  const p = tr.s, d = p.bars;
  const i0 = p.dIdx.get(tr.buyT), i1 = p.dIdx.get(tr.sellT) ?? dailyIdxAtOrBefore(p, tr.sellT);
  const E = tr.entryPrice;
  let mfe = 0, mae = 0, maeDay = 0, mfeDay = 0, peakClose = E;
  for (let i = i0; i < i1; i++) {
    const b = d[i];
    const hi = b.high / E - 1, lo = b.low / E - 1;
    if (hi > mfe) { mfe = hi; mfeDay = i - i0; }
    if (lo < mae) { mae = lo; maeDay = i - i0; }
    peakClose = Math.max(peakClose, b.close);
  }
  const path = tr.path;
  const wret = k => path.length > k && path[k].close ? 100 * (path[k].close / E - 1) : null;
  const firstNeg = path.find(x => x.close < E);
  const ranks = path.map(x => x.rank).filter(x => x != null);
  return {
    mfePct: 100 * mfe, maePct: 100 * mae, daysToMae: maeDay, daysToMfe: mfeDay,
    weeksToMae: maeDay / 5,
    ddFromPeakAtExit: 100 * (tr.exitPrice / peakClose - 1),
    givebackPct: 100 * (mfe - (tr.exitPrice / E - 1)),
    retW1: wret(0), retW2: wret(1), retW4: wret(3),
    rankW1: path[0]?.rank ?? null, rankW2: path[1]?.rank ?? null, rankWorst: ranks.length ? Math.max(...ranks) : null,
    rankAtExitSignal: path.at(-1)?.rank ?? null,
    quadrantFirstNeg: firstNeg?.quadrant ?? '',
    weekFirstNeg: firstNeg ? path.indexOf(firstNeg) + 1 : null,
    quadrantAtExit: path.at(-1)?.quadrant ?? '',
    rslAtExit: path.at(-1)?.rsl ?? null,
  };
}
