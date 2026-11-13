/** Candidate entry filters / extra exits for rule tests (weekly signal, Monday-open exec). */
import { entryFeatures } from './trade-features.mjs';
import { wIdxAtOrBefore } from './rotation-hooks.mjs';

const peakOf = h => Math.max(h.entryPrice, ...h.path.map(x => x.close ?? 0));
export function exitRules() {
  return {
    X_lagging:   { label: 'Exit sobald RRG-Quadrant Lagging', fn: c => c.quadrant === 'Lagging' ? 'Zusatz: RRG Lagging' : null },
    X_w2neg:     { label: 'Exit wenn nach 2 Wochen unter Einstand', fn: c => c.h.path.length === 2 && c.close < c.h.entryPrice ? 'Zusatz: 2 Wo. negativ' : null },
    X_w2neg5:    { label: 'Exit wenn nach 2 Wochen ≤ −5 %', fn: c => c.h.path.length === 2 && c.close <= c.h.entryPrice * 0.95 ? 'Zusatz: 2 Wo. ≤ −5 %' : null },
    X_stop10:    { label: 'Stop −10 % (Wochenschluss)', fn: c => c.close <= c.h.entryPrice * 0.90 ? 'Zusatz: Stop −10 %' : null },
    X_stop15:    { label: 'Stop −15 % (Wochenschluss)', fn: c => c.close <= c.h.entryPrice * 0.85 ? 'Zusatz: Stop −15 %' : null },
    X_trail15:   { label: 'Trailing −15 % vom Hoch (Wochenschluss)', fn: c => c.close <= peakOf(c.h) * 0.85 ? 'Zusatz: Trailing −15 %' : null },
    X_trail20:   { label: 'Trailing −20 % vom Hoch (Wochenschluss)', fn: c => c.close <= peakOf(c.h) * 0.80 ? 'Zusatz: Trailing −20 %' : null },
    X_sma10:     { label: 'Exit Wochenschluss < SMA10w', fn: c => { const W = c.p.W, i = c.wi; if (i < 9) return null; let s = 0; for (let k = i - 9; k <= i; k++) s += W[k].close; return c.close < s / 10 ? 'Zusatz: < SMA10w' : null; } },
    X_rank25:    { label: 'Exit wenn Rang > 25', fn: c => c.rank != null && c.rank > 25 ? 'Zusatz: Rang > 25' : null },
    X_rsl1:      { label: 'Exit wenn RSL < 1,0', fn: c => c.stockRsl != null && c.stockRsl < 1 ? 'Zusatz: RSL < 1' : null },
  };
}
export function entryRules(P, RT, N) {
  const F = ctx => (ctx._f ??= entryFeatures(P, RT, ctx.row.s, ctx.signalT, ctx.execT, N));
  return {
    F_bench40:  { label: 'Keine Neukäufe, wenn S&P < SMA40w', fn: ctx => { const B = ctx.bench, i = wIdxAtOrBefore(B, ctx.sk); return !(B.sma40[i] != null && B.W[i].close < B.sma40[i]); } },
    F_bench26:  { label: 'Keine Neukäufe, wenn S&P-RSL < 1,0 (unter SMA26w)', fn: ctx => !(ctx.benchRsl != null && ctx.benchRsl < 1) },
    F_gap3:     { label: 'Kein Kauf bei Montags-Gap > +3 %', fn: ctx => { const f = F(ctx); return !(f.gapPct > 3); } },
    F_high15:   { label: 'Kein Kauf > 15 % unter 52-Wochen-Hoch', fn: ctx => { const f = F(ctx); return !(f.distHigh52 < -15); } },
    F_vol80:    { label: 'Kein Kauf bei Wochen-Vola > 80 % p. a.', fn: ctx => { const f = F(ctx); return !(f.volW13 > 80); } },
    F_rsl16:    { label: 'Kein Kauf bei RSL > 1,6 (überdehnt)', fn: ctx => !(ctx.row.score > 1.6) },
    F_ext35:    { label: 'Kein Kauf > 35 % über SMA10w', fn: ctx => { const f = F(ctx); return !(f.distSma10 > 35); } },
    F_bhot:     { label: 'Keine Neukäufe, wenn S&P-RSL > 1,07 (überhitzt)', fn: ctx => !(ctx.benchRsl != null && ctx.benchRsl > 1.07) },
  };
}
