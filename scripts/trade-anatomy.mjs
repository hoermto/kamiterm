#!/usr/bin/env node
/**
 * Winner/loser trade anatomy for the weekly RSL26 rotation + rule tests.
 * Uses an analysis copy of rotationBacktest (scripts/lib/rotation-hooks.mjs) that reproduces
 * the production engine exactly for baseline settings; production code is not modified.
 * Writes CSV/JSON into the Grokki strategies folder.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { rotationBacktest, toGermanCsv } from '../lib/fn/grokki-math.js';
import { prepare, runBacktest } from './lib/rotation-hooks.mjs';
import { buildRankTable, entryFeatures, pathFeatures } from './lib/trade-features.mjs';
import { exitRules, entryRules } from './lib/trade-rules.mjs';

const OUT = '/workspace/thoBox/Grokki/strategies';
const TAG = 'RSL26_Gewinner_Verlierer_Analyse_2026-11-10';
mkdirSync(OUT, { recursive: true });
const ts = s => Date.parse(s + 'T00:00:00Z') / 1000;
const WIN = [
  { k: 'y10', label: '10 Jahre 2016–26', a: '2016-11-09', b: '2026-11-09' },
  { k: 'h1', label: 'Hälfte 1 2016–21', a: '2016-11-09', b: '2021-11-08' },
  { k: 'h2', label: 'Hälfte 2 2021–26', a: '2021-11-09', b: '2026-11-09' },
];
const V = [
  { id: 'user_rank_n5_rt25_rs1', label: 'Deine Variante RANK N5 RT25 RS1', mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  { id: 'rec_confirm_n10_rt10_rs0_cw2', label: 'Empfohlen CONFIRM N10 RT10 RS0 CW2', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
  { id: 'eval_rank_n5_rt10_rs1', label: 'Evaluiert RANK N5 RT10 RS1', mode: 'RANK', n: 5, rankTop: 10, rsExit: true, confirmWeeks: 1 },
];
const COMMON = { startCapital: 10000, fee: 1 };

console.log('Loading SPX + ^GSPC…');
const u = universe({ universe: 'SPX' });
const [benchmark, data] = await Promise.all([history('^GSPC', 12), batch(u.tickers, t => history(t, 12), 300000, 8)]);
console.log(`loaded ${data.results.length}/${u.tickers.length}, errors=${data.errors.length}`);
const P = prepare(data.results, benchmark.bars);
const RT = buildRankTable(P);

// --- parity check vs production engine (10y baseline)
const parity = [];
for (const v of V) {
  const prod = rotationBacktest(data.results, 10, v.n, { ...COMMON, benchmarkBars: benchmark.bars, fractional: true, sizeMode: 'EQUITY', mode: v.mode, rankTop: v.rankTop, rsExit: v.rsExit, confirmWeeks: v.confirmWeeks });
  const mine = runBacktest(P, v.n, { ...v, ...COMMON, years: 10 });
  parity.push({ id: v.id, prodCagr: prod.cagr, copyCagr: mine.cagr, prodDD: prod.maxDD, copyDD: mine.maxDD, prodTrades: prod.stats.tradesClosed, copyTrades: mine.trades });
  console.log('parity', v.id, prod.cagr.toFixed(4), mine.cagr.toFixed(4), prod.stats.tradesClosed, mine.trades);
}

// --- stats helpers
const fin = a => a.filter(x => x != null && Number.isFinite(x));
const med = a => { const s = fin(a).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = a => { const s = fin(a); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
function auc(w, l) {
  const W = fin(w), L = fin(l); if (!W.length || !L.length) return null;
  const all = [...W.map(x => [x, 1]), ...L.map(x => [x, 0])].sort((a, b) => a[0] - b[0]);
  let R1 = 0; for (let i = 0; i < all.length;) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) if (all[k][1]) R1 += r; i = j; }
  return (R1 - W.length * (W.length + 1) / 2) / (W.length * L.length);
}
const ENTRY_F = ['rsl', 'rank', 'rank1w', 'rank4w', 'rslChg1w', 'rslChg4w', 'rslRelBench', 'rsRatio', 'rsMom', 'leadWeeks', 'distSma10', 'distSma26', 'ret1w', 'ret4w', 'ret13w', 'ret26w', 'ret52w', 'volW13', 'atrPct', 'gapPct', 'benchRsl', 'benchAbove26', 'benchAbove40', 'benchRet4w', 'weeksInTopN', 'price', 'distHigh52'];
const PATH_F = ['mfePct', 'maePct', 'weeksToMae', 'ddFromPeakAtExit', 'givebackPct', 'retW1', 'retW2', 'retW4', 'rankW1', 'rankW2', 'rankWorst', 'rslAtExit', 'holdDays'];
function quint(T, f) {
  const a = T.filter(t => Number.isFinite(t[f])).sort((x, y) => x[f] - y[f]); const out = [];
  for (let i = 0; i < 5; i++) { const s = a.slice(Math.floor(i * a.length / 5), Math.floor((i + 1) * a.length / 5)); if (!s.length) continue;
    out.push({ q: i + 1, from: s[0][f], to: s.at(-1)[f], n: s.length, hit: 100 * s.filter(t => t.pnl > 0).length / s.length, meanRet: mean(s.map(t => t.pnlPct)), medRet: med(s.map(t => t.pnlPct)), bigLoserShare: 100 * s.filter(t => t.pnlPct < -10).length / s.length }); }
  return out;
}
function groupBy(T, f) {
  const g = {}; for (const t of T) { const k = t[f] === '' || t[f] == null ? '—' : String(t[f]); (g[k] ??= []).push(t); }
  return Object.entries(g).map(([k, a]) => ({ key: k, n: a.length, hit: 100 * a.filter(t => t.pnl > 0).length / a.length, meanRet: mean(a.map(t => t.pnlPct)) })).sort((a, b) => b.n - a.n);
}

// --- trade anatomy (10y baseline)
const anatomy = {}; const csvRows = [];
for (const v of V) {
  const r = runBacktest(P, v.n, { ...v, ...COMMON, ...{ windowStart: ts('2016-11-09'), windowEnd: ts('2026-11-09') } });
  const T = r.closedTrades.map(t => {
    const x = { ...t, ...entryFeatures(P, RT, t.s, t.signalT, t.buyT, v.n), ...pathFeatures(t) };
    x.reasonGroup = /Rank \d+>/.test(t.reason) ? t.reason.replace(/\(Rank \d+>(\d+)\)/, '(Rang > $1)') : t.reason;
    return x;
  });
  const q20 = [...T].sort((a, b) => a.pnlPct - b.pnlPct)[Math.floor(T.length * 0.2)]?.pnlPct;
  for (const t of T) t.bucket = t.pnl > 0 ? 'Gewinner' : (t.pnlPct < -10 ? 'Großer Verlierer' : 'Verlierer');
  const W = T.filter(t => t.pnl > 0), L = T.filter(t => t.pnl <= 0), BL = T.filter(t => t.pnlPct < -10), Q1 = T.filter(t => t.pnlPct <= q20);
  const feat = f => ({ f, medW: med(W.map(t => t[f])), medL: med(L.map(t => t[f])), medBigL: med(BL.map(t => t[f])), meanW: mean(W.map(t => t[f])), meanL: mean(L.map(t => t[f])), aucWvsL: auc(W.map(t => t[f]), L.map(t => t[f])) });
  anatomy[v.id] = {
    label: v.label, trades: T.length, winners: W.length, losers: L.length, bigLosers: BL.length, worstQuintileCut: q20, worstQuintileN: Q1.length,
    meanRet: mean(T.map(t => t.pnlPct)), medWin: med(W.map(t => t.pnlPct)), medLoss: med(L.map(t => t.pnlPct)),
    sumPnlWin: W.reduce((s, t) => s + t.pnl, 0), sumPnlLoss: L.reduce((s, t) => s + t.pnl, 0),
    holdWeeksMedW: med(W.map(t => t.holdDays)) / 7, holdWeeksMedL: med(L.map(t => t.holdDays)) / 7,
    entry: ENTRY_F.map(feat), path: PATH_F.map(feat),
    quintiles: Object.fromEntries(['rsl', 'rslChg4w', 'rank4w', 'distSma10', 'ret1w', 'ret4w', 'ret13w', 'volW13', 'atrPct', 'gapPct', 'benchRsl', 'distHigh52', 'rsRatio', 'rsMom', 'price'].map(f => [f, quint(T, f)])),
    groups: { quadrant: groupBy(T, 'quadrant'), sector: groupBy(T, 'sector'), reason: groupBy(T, 'reasonGroup'), quadrantFirstNeg: groupBy(T, 'quadrantFirstNeg'), benchAbove40: groupBy(T, 'benchAbove40') },
    worst10: [...T].sort((a, b) => a.pnlPct - b.pnlPct).slice(0, 10).map(t => ({ ticker: t.ticker, buy: t.buyDate, sell: t.sellDate, pnlPct: t.pnlPct, reason: t.reason })),
  };
  for (const t of T) csvRows.push({ variant: v.id, ...t, sideHoldWeeks: t.holdDays / 7 });
  console.log(v.id, 'trades', T.length);
}

// --- rule tests
const res = [];
const runAll = (v, ro) => Object.fromEntries(WIN.map(w => { const r = runBacktest(P, v.n, { ...v, ...COMMON, windowStart: ts(w.a), windowEnd: ts(w.b), ...ro });
  return [w.k, { cagr: r.cagr, maxDD: r.maxDD, mar: r.mar, sharpe: r.sharpe, trades: r.trades, winRate: r.winRate, finalEquity: r.finalEquity }]; }));
const peakOf = h => Math.max(h.entryPrice, ...h.path.map(x => x.close ?? 0));
for (const v of V) {
  const X = exitRules(), F = entryRules(P, RT, v.n);
  const tests = [['base', 'Unverändert', {}],
    ...Object.entries(X).map(([k, r]) => [k, r.label + ' (Wiederkauf-Sperre 4 Wo.)', { extraExit: r.fn, reentryCooldownWeeks: 4 }]),
    ...Object.entries(F).map(([k, r]) => [k, r.label, { entryFilter: r.fn }]),
    ...[0.18, 0.22, 0.25, 0.30].map(x => [`X_trail${Math.round(x * 100)}`, `Trailing −${Math.round(x * 100)} % vom Hoch (Sperre 4 Wo.)`, { extraExit: c => c.close <= peakOf(c.h) * (1 - x) ? 'trail' : null, reentryCooldownWeeks: 4 }]),
    ...[0, 1, 2, 8].map(cd => [`X_trail20_cd${cd}`, `Trailing −20 %, Wiederkauf-Sperre ${cd} Wo.`, { extraExit: X.X_trail20.fn, reentryCooldownWeeks: cd }]),
    ['C_trail20_lagging', 'Kombi: Trailing −20 % + Lagging-Exit', { extraExit: c => X.X_trail20.fn(c) || X.X_lagging.fn(c), reentryCooldownWeeks: 4 }],
    ['C_trail20_bench40', 'Kombi: Trailing −20 % + keine Käufe bei S&P < SMA40w', { extraExit: X.X_trail20.fn, reentryCooldownWeeks: 4, entryFilter: F.F_bench40.fn }],
  ];
  for (const [rk, label, ro] of tests) {
    const row = { variant: v.id, variantLabel: v.label, rule: rk, ruleLabel: label, ...runAll(v, ro) };
    res.push(row);
    console.log(v.id, rk, row.y10.cagr.toFixed(2), row.y10.maxDD.toFixed(2), row.h1.cagr.toFixed(2), row.h2.cagr.toFixed(2));
  }
}

writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify({ generated: new Date().toISOString(), universe: 'SPX (heutige Mitglieder)', loaded: data.results.length, requested: u.tickers.length, windows: WIN, variants: V, parity, anatomy, ruleTests: res,
  notes: 'Signal Freitagsschluss, Ausführung Montagseröffnung. Zusatz-Exits werden wie die RRG-Exits am Freitagsschluss geprüft. Nach einem Zusatz-Exit Wiederkauf-Sperre (Standard 4 Wochen). Gebühr 1 $ je Trade, Start 10.000, fraktionale Stücke, SIZE=EQUITY. Survivorship-Bias, keine Dividenden.' }, null, 1));

const n = (v, d = 2) => v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(d);
const TCOLS = [['variant', 'Variante'], ['ticker', 'Ticker'], ['sector', 'Sektor'], ['bucket', 'Gruppe'], ['buyDate', 'Kauf'], ['sellDate', 'Verkauf'], ['entryPrice', 'Einstand', 4], ['exitPrice', 'Ausstieg', 4], ['pnl', 'PnL $', 2], ['pnlPct', 'PnL %', 2], ['sideHoldWeeks', 'Haltedauer Wo.', 1], ['reason', 'Exit-Grund'],
  ['rank', 'Rang Einstieg', 0], ['rsl', 'RSL', 4], ['rslChg1w', 'RSL Δ1W', 4], ['rslChg4w', 'RSL Δ4W', 4], ['rank1w', 'Rang vor 1W', 0], ['rank4w', 'Rang vor 4W', 0], ['weeksInTopN', 'Wochen schon in Top-N', 0], ['quadrant', 'RRG-Quadrant'], ['rsRatio', 'RS-Ratio', 2], ['rsMom', 'RS-Momentum', 2], ['leadWeeks', 'Wochen Leading', 0],
  ['distSma10', 'Abst. SMA10w %', 2], ['distSma26', 'Abst. SMA26w %', 2], ['ret1w', 'Rend. 1W %', 2], ['ret4w', 'Rend. 4W %', 2], ['ret13w', 'Rend. 13W %', 2], ['ret26w', 'Rend. 26W %', 2], ['ret52w', 'Rend. 52W %', 2], ['volW13', 'Vola 13W % p.a.', 2], ['atrPct', 'ATR14 %', 2], ['gapPct', 'Montags-Gap %', 2], ['distHigh52', 'Abst. 52W-Hoch %', 2], ['price', 'Kurs Signal', 2],
  ['benchRsl', 'S&P RSL', 4], ['benchAbove26', 'S&P > SMA26w', 0], ['benchAbove40', 'S&P > SMA40w', 0], ['benchRet4w', 'S&P Rend. 4W %', 2],
  ['mfePct', 'MFE %', 2], ['maePct', 'MAE %', 2], ['weeksToMae', 'Wochen bis MAE', 1], ['ddFromPeakAtExit', 'Abst. vom Hoch bei Exit %', 2], ['givebackPct', 'Giveback %-Pkt', 2], ['retW1', 'Rend. nach 1W %', 2], ['retW2', 'Rend. nach 2W %', 2], ['retW4', 'Rend. nach 4W %', 2], ['rankW1', 'Rang nach 1W', 0], ['rankW2', 'Rang nach 2W', 0], ['rankWorst', 'Schlechtester Rang', 0], ['quadrantFirstNeg', 'Quadrant erste Minuswoche'], ['quadrantAtExit', 'Quadrant Exit-Signal'], ['rslAtExit', 'RSL Exit-Signal', 4]];
writeFileSync(`${OUT}/${TAG}_Trades.csv`, toGermanCsv(csvRows.map(r => Object.fromEntries(TCOLS.map(([k, , d]) => [k, d == null ? r[k] : n(r[k], d)]))), TCOLS.map(([k, l]) => ({ key: k, label: l }))));
const RCOLS = [['variant', 'Variante'], ['rule', 'Regel-ID'], ['ruleLabel', 'Regel']];
const rr = res.map(r => { const o = { variant: r.variantLabel, rule: r.rule, ruleLabel: r.ruleLabel }; for (const w of WIN) for (const [k, d] of [['cagr', 2], ['maxDD', 2], ['mar', 3], ['sharpe', 3], ['trades', 0]]) o[`${w.k}_${k}`] = n(r[w.k][k], d); return o; });
const rcols = [...RCOLS.map(([k, l]) => ({ key: k, label: l })), ...WIN.flatMap(w => [['cagr', 'CAGR'], ['maxDD', 'MaxDD'], ['mar', 'MAR'], ['sharpe', 'Sharpe'], ['trades', 'Trades']].map(([k, l]) => ({ key: `${w.k}_${k}`, label: `${l} ${w.label}` })))];
writeFileSync(`${OUT}/${TAG}_Regeltests.csv`, toGermanCsv(rr, rcols));
console.log('wrote', OUT);
process.exit(0);
