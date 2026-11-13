#!/usr/bin/env node
/** Trade-level screen: what would each extra exit rule have done to each closed trade (no portfolio effects). */
import { writeFileSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { toGermanCsv } from '../lib/fn/grokki-math.js';
import { prepare, runBacktest } from './lib/rotation-hooks.mjs';
const OUT = '/workspace/thoBox/Grokki/strategies/RSL26_Gewinner_Verlierer_Analyse_2026-11-10_Einzeltrade-Screen.csv';
const u = universe({ universe: 'SPX' });
const [benchmark, data] = await Promise.all([history('^GSPC', 12), batch(u.tickers, t => history(t, 12), 300000, 8)]);
const P = prepare(data.results, benchmark.bars);
const ts = s => Date.parse(s + 'T00:00:00Z') / 1000;
const V = [
  { id: 'Deine Variante RANK N5 RT25 RS1', mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  { id: 'Empfohlen CONFIRM N10 RT10 RS0 CW2', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
  { id: 'Evaluiert RANK N5 RT10 RS1', mode: 'RANK', n: 5, rankTop: 10, rsExit: true, confirmWeeks: 1 },
];
const sma10 = (p, sk) => { const i = p.idx.get(sk); if (i == null || i < 9) return null; let s = 0; for (let k = i - 9; k <= i; k++) s += p.W[k].close; return s / 10; };
const RULES = {
  'Stop −5 %': (t, x) => x.close <= t.entryPrice * 0.95,
  'Stop −10 %': (t, x) => x.close <= t.entryPrice * 0.90,
  'Stop −15 %': (t, x) => x.close <= t.entryPrice * 0.85,
  'Trailing −10 %': (t, x, j, pk) => x.close <= pk * 0.90,
  'Trailing −15 %': (t, x, j, pk) => x.close <= pk * 0.85,
  'Trailing −20 %': (t, x, j, pk) => x.close <= pk * 0.80,
  'Rang > 25': (t, x) => x.rank != null && x.rank > 25,
  'RSL < 1,0': (t, x) => x.rsl != null && x.rsl < 1,
  'RRG Lagging': (t, x) => x.quadrant === 'Lagging',
  'nach 2 Wo. negativ': (t, x, j) => j === 1 && x.close < t.entryPrice,
  'nach 2 Wo. ≤ −5 %': (t, x, j) => j === 1 && x.close <= t.entryPrice * 0.95,
  'nach 4 Wo. negativ': (t, x, j) => j === 3 && x.close < t.entryPrice,
  'Wochenschluss < SMA10w': (t, x) => { const s = sma10(t.s, x.sk); return s != null && x.close < s; },
};
const nextBar = (p, t) => { const b = p.bars; let lo = 0, hi = b.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (b[m].time > t) { a = m; hi = m - 1; } else lo = m + 1; } return a >= 0 ? b[a] : null; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const rows = [];
for (const v of V) {
  const T = runBacktest(P, v.n, { ...v, startCapital: 10000, fee: 1, windowStart: ts('2016-11-09'), windowEnd: ts('2026-11-09') }).closedTrades;
  const W = T.filter(t => t.pnl > 0), L = T.filter(t => t.pnl <= 0);
  for (const [name, fn] of Object.entries(RULES)) {
    let fL = 0, fW = 0; const dW = [], dL = [], nr = [];
    for (const t of T) {
      let pk = t.entryPrice, hit = null;
      for (let j = 0; j < t.path.length - 1; j++) { const x = t.path[j]; pk = Math.max(pk, x.close); if (fn(t, x, j, pk)) { hit = x; break; } }
      let r = t.pnlPct;
      if (hit) { const b = nextBar(t.s, hit.signalT); if (b) { r = 100 * (t.shares * b.open - t.cost - 2) / t.cost; if (t.pnl > 0) { fW++; dW.push(r - t.pnlPct); } else { fL++; dL.push(r - t.pnlPct); } } }
      nr.push(r);
    }
    rows.push({ v: v.id, rule: name, trades: T.length, firedL: fL, firedW: fW, pctL: 100 * fL / L.length, pctW: 100 * fW / W.length, dL: mean(dL), dW: mean(dW), meanOld: mean(T.map(t => t.pnlPct)), meanNew: mean(nr) });
  }
}
const n = (x, d = 2) => x == null ? null : +x.toFixed(d);
writeFileSync(OUT, toGermanCsv(rows.map(r => ({ ...r, pctL: n(r.pctL, 1), pctW: n(r.pctW, 1), dL: n(r.dL), dW: n(r.dW), meanOld: n(r.meanOld), meanNew: n(r.meanNew) })), [
  { key: 'v', label: 'Variante' }, { key: 'rule', label: 'Zusatz-Exit' }, { key: 'trades', label: 'Trades' }, { key: 'firedL', label: 'ausgelöst bei Verlierern' }, { key: 'firedW', label: 'ausgelöst bei Gewinnern' },
  { key: 'pctL', label: '% der Verlierer erfasst' }, { key: 'pctW', label: '% der Gewinner erfasst' }, { key: 'dL', label: 'Ø Δ %-Pkt Verlierer' }, { key: 'dW', label: 'Ø Δ %-Pkt Gewinner' },
  { key: 'meanOld', label: 'Ø Trade-Rendite alt %' }, { key: 'meanNew', label: 'Ø Trade-Rendite neu %' }]));
for (const r of rows) console.log(r.v.slice(0, 12), r.rule.padEnd(24), r.firedL, r.firedW, n(r.pctL, 1), n(r.pctW, 1), n(r.dL), n(r.dW), n(r.meanOld), n(r.meanNew));
process.exit(0);
