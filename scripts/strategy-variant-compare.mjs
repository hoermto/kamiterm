#!/usr/bin/env node
/**
 * Compare original monthly Levy, the user's weekly RRG variant,
 * and previously evaluated/recommended weekly configs.
 * Writes JSON/CSV into the Grokki strategies folder.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { history, batch } from '../lib/fn/grokki-data.js';
import { universe } from '../lib/fn/grokki-universes.js';
import { levy, rotationBacktest, toGermanCsv } from '../lib/fn/grokki-math.js';
import { STRATEGY } from './lib/strategy-env.mjs';

const OUT = '/workspace/thoBox/Grokki/strategies';
mkdirSync(OUT, { recursive: true });

const START = 10000, FEE = 1, FETCH_YEARS = 12;

const WEEKLY = [
  { id: 'baseline_weekly_n25', label: 'Baseline wöchentlich: RANK N25 RT25 RS1', group: 'baseline', mode: 'RANK', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  { id: 'user_rrg_n5_rt25', label: 'Deine Variante: RRG-Exit RANK, N=5, Rank-Schutz 25, RS-Exit', group: 'user', mode: 'RANK', n: 5, rankTop: 25, rsExit: true, confirmWeeks: 1 },
  { id: 'user_rrg_n5_rt25_nors', label: 'Deine Variante ohne RS-Exit: RANK N5 RT25', group: 'user', mode: 'RANK', n: 5, rankTop: 25, rsExit: false, confirmWeeks: 1 },
  { id: 'rec_confirm_n10', label: 'Empfohlen: CONFIRM 2 Wo., N=10, Rank-Schutz 10, ohne RS-Exit', group: 'recommended', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
  { id: 'eval_rank_n5_rt10', label: 'Evaluiert (höchste Rendite): RANK N5 RT10 RS1', group: 'evaluated', mode: 'RANK', n: 5, rankTop: 10, rsExit: true, confirmWeeks: 1 },
  { id: 'eval_plateau_n8', label: 'Evaluiert (Plateau): RANK N8 RT8, ohne RS-Exit', group: 'evaluated', mode: 'RANK', n: 8, rankTop: 8, rsExit: false, confirmWeeks: 1 },
  { id: 'eval_rank_n8_rt5', label: 'Evaluiert (Top-5 Raster): RANK N8 RT5, ohne RS-Exit', group: 'evaluated', mode: 'RANK', n: 8, rankTop: 5, rsExit: false, confirmWeeks: 1 },
  { id: 'eval_confirm_n10_rs', label: 'Evaluiert: CONFIRM 2 Wo., N=10, RT10, mit RS-Exit', group: 'evaluated', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: true, confirmWeeks: 2 },
];

function iso(t) { return new Date(t * 1000).toISOString().slice(0, 10); }
function ym(t) { return iso(t).slice(0, 7); }
function execPx(bar) {
  if (bar?.open > 0) return { px: bar.open, kind: 'open' };
  if (bar?.close > 0) return { px: bar.close, kind: 'close' };
  return null;
}
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function weekRets(equity) {
  const sampled = []; let lastW = null;
  for (const p of equity || []) {
    const wk = Math.floor((Date.parse(p.time + 'T00:00:00Z') / 86400e3 + 3) / 7);
    if (wk !== lastW) { sampled.push(p); lastW = wk; }
  }
  const rets = [];
  for (let i = 1; i < sampled.length; i++) {
    const a = sampled[i - 1].value, b = sampled[i].value;
    if (a > 0) rets.push({ time: sampled[i].time, r: b / a - 1 });
  }
  return rets;
}
function sharpeFromRets(rets) {
  const x = rets.map((z) => z.r ?? z);
  const s = stdev(x);
  if (!(s > 0)) return null;
  return (mean(x) / s) * Math.sqrt(52);
}
function cagrBetween(a, b, ta, tb) {
  if (!(a > 0) || !(b > 0)) return null;
  const y = (Date.parse(tb) - Date.parse(ta)) / (365.25 * 86400e3);
  if (!(y > 0.2)) return null;
  return 100 * ((b / a) ** (1 / y) - 1);
}
function splitCagr(equity, startY, endY) {
  const pts = (equity || []).filter((p) => {
    const y = +p.time.slice(0, 4);
    return y >= startY && y <= endY;
  });
  if (pts.length < 10) return null;
  return cagrBetween(pts[0].value, pts.at(-1).value, pts[0].time, pts.at(-1).time);
}

/** Classic Levy: first trading day of each month, sell all, buy current Top-N equal weight. */
function monthlyLevyBacktest(series, years, n, opts = {}) {
  const startCapital = opts.startCapital ?? 10000;
  const fee = Number.isFinite(Number(opts.fee)) ? Math.max(0, Number(opts.fee)) : 1;
  const fractional = opts.fractional !== false && opts.fractional !== 0;
  const allDates = [...new Set(series.flatMap((s) => s.bars.map((b) => b.time)))].sort((a, b) => a - b);
  if (!allDates.length) return { error: 'No price histories', equity: [], stats: null };
  const endT = Number.isFinite(Number(opts.windowEnd)) ? Number(opts.windowEnd) : allDates.at(-1);
  const cutoff = Number.isFinite(Number(opts.windowStart))
    ? Number(opts.windowStart)
    : endT - years * 365.25 * 86400;
  const maps = series.map((s) => ({ ...s, map: new Map(s.bars.map((b) => [b.time, b])) }));
  const bmBars = opts.benchmarkBars || null;

  const byMonth = new Map();
  for (const t of allDates) {
    const k = ym(t);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(t);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, days]) => {
    days.sort((a, b) => a - b);
    return { key, first: days[0], last: days.at(-1) };
  });
  const monthFirst = new Set(months.map((m) => m.first));
  const monthIdx = new Map(months.map((m, i) => [m.key, i]));

  function rankAt(asOfSec) {
    return maps.map((s) => {
      const prior = s.bars.filter((b) => b.time <= asOfSec);
      const last = prior.at(-1);
      return { ...s, score: last && asOfSec - last.time <= 10 * 86400 ? levy(prior) : null };
    }).filter((s) => s.score != null).sort((a, b) => b.score - a.score)
      .map((s, i) => ({ ticker: s.ticker, rank: i + 1, score: s.score, s }));
  }

  let cash = startCapital;
  let holdings = [];
  let peak = startCapital, mdd = 0;
  const equity = [];
  const closedTrades = [];
  let totalFees = 0;
  const tradeDates = allDates.filter((t) => t >= cutoff && t <= endT);

  for (const t of tradeDates) {
    if (monthFirst.has(t)) {
      const idx = monthIdx.get(ym(t));
      const prev = idx > 0 ? months[idx - 1] : null;
      if (prev) {
        const ranked = rankAt(prev.last);
        const top = ranked.slice(0, n);
        const kept = [];
        for (const h of holdings) {
          const bar = h.s.map.get(t);
          const px = execPx(bar);
          if (!px) { kept.push(h); continue; }
          const proceeds = h.shares * px.px - fee;
          cash += proceeds;
          totalFees += fee;
          const sellIso = iso(t);
          const holdDays = Math.max(0, Math.round((Date.parse(sellIso + 'T00:00:00Z') - Date.parse(h.bought + 'T00:00:00Z')) / 86400e3));
          closedTrades.push({
            ticker: h.s.ticker, pnl: proceeds - h.shares * (h.entryPrice ?? px.px), fee, holdDays,
          });
        }
        holdings = kept;
        const mtm = cash + holdings.reduce((v, h) => v + h.shares * (h.last || 0), 0);
        const budget = mtm / n;
        for (const r of top) {
          if (holdings.some((h) => h.s.ticker === r.ticker)) continue;
          const bar = r.s.map.get(t);
          const px = execPx(bar);
          if (!px) continue;
          const cap = Math.min(budget, Math.max(0, cash - fee));
          let shares = cap / px.px;
          if (!fractional) shares = Math.floor(shares);
          if (!(shares > 0)) continue;
          const cost = shares * px.px + fee;
          if (cost > cash + 1e-9) continue;
          cash -= cost;
          totalFees += fee;
          holdings.push({ s: r.s, shares, entryPrice: px.px, bought: iso(t), last: px.px, feePaid: fee });
        }
      }
    }
    for (const h of holdings) if (h.s.map.has(t)) h.last = h.s.map.get(t).close;
    const value = cash + holdings.reduce((v, h) => v + h.shares * h.last, 0);
    if (value > 0) { peak = Math.max(peak, value); mdd = Math.min(mdd, value / peak - 1); }
    equity.push({ time: iso(t), value, cash });
  }

  const elapsed = equity.length > 1
    ? (Date.parse(equity.at(-1).time) - Date.parse(equity[0].time)) / (365.25 * 86400e3) : 0;
  const finalValue = equity.length ? equity.at(-1).value : startCapital;
  const cagr = elapsed > 0 && startCapital > 0 ? 100 * ((finalValue / startCapital) ** (1 / elapsed) - 1) : null;
  const wins = closedTrades.filter((tr) => tr.pnl > 0);
  const holdVals = closedTrades.map((tr) => tr.holdDays).filter((d) => Number.isFinite(d));
  const avg = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;

  let benchmarkEquity = null;
  let benchCagr = null;
  if (bmBars?.length && equity.length) {
    const bmMap = new Map(bmBars.map((b) => [iso(b.time), b.close]));
    const firstIso = equity[0].time;
    let startPx = null;
    for (const b of bmBars) {
      if (iso(b.time) >= firstIso && b.close > 0) { startPx = b.close; break; }
    }
    if (startPx) {
      const sh = startCapital / startPx;
      let last = startPx;
      benchmarkEquity = equity.map((pt) => {
        if (bmMap.has(pt.time)) last = bmMap.get(pt.time);
        return { time: pt.time, value: sh * last };
      });
      const bmFinal = benchmarkEquity.at(-1).value;
      benchCagr = elapsed > 0 ? 100 * ((bmFinal / startCapital) ** (1 / elapsed) - 1) : null;
    }
  }

  return {
    n, mode: 'MONTHLY_LEVY', startCapital, fee, fractional,
    actualYears: elapsed, cagr, maxDD: 100 * mdd,
    totalReturnPct: startCapital > 0 ? 100 * ((finalValue / startCapital) - 1) : null,
    finalEquity: finalValue, equity, benchmarkEquity,
    stats: {
      startCapital, finalEquity: finalValue, cagr, maxDD: 100 * mdd, actualYears: elapsed,
      tradesClosed: closedTrades.length, tradesOpen: holdings.length,
      winRate: closedTrades.length ? 100 * (wins.length / closedTrades.length) : null,
      holdWeeksAvg: avg(holdVals) ? avg(holdVals) / 7 : null,
      totalFees, benchmarkCagr: benchCagr,
      model: 'Classic Levy monthly full rotation: signal = last session of prior month (Levy RSL26), exec = first session of month at open (else close). Sell entire book, buy current Top-N equal weight (equity/n). FEE=$1/trade. Fractional shares. No mid-month exits, no dividends. Survivorship: current constituents.',
    },
  };
}

function summarize(id, label, group, engine, cfg, bt) {
  const s = bt.stats || {};
  const cagr = s.cagr ?? bt.cagr;
  const maxDD = s.maxDD ?? bt.maxDD;
  const mar = Math.abs(maxDD) > 1e-9 && Number.isFinite(cagr) ? cagr / Math.abs(maxDD) : null;
  const sharpe = sharpeFromRets(weekRets(bt.equity));
  const eq = bt.equity || [];
  return {
    id, label, group, engine,
    mode: cfg.mode ?? engine,
    n: cfg.n, rankTop: cfg.rankTop ?? null, rsExit: cfg.rsExit == null ? null : (cfg.rsExit ? 1 : 0),
    confirmWeeks: cfg.confirmWeeks ?? null,
    from: eq[0]?.time, to: eq.at(-1)?.time,
    years: s.actualYears ?? bt.actualYears,
    cagr, maxDD, mar, sharpe,
    finalEquity: s.finalEquity ?? bt.finalEquity,
    totalFees: s.totalFees ?? null,
    tradesClosed: s.tradesClosed ?? null,
    tradesOpen: s.tradesOpen ?? null,
    winRate: s.winRate ?? null,
    holdWeeksAvg: s.holdWeeksAvg ?? null,
    benchCagr: s.benchmarkCagr ?? null,
    cagr_2016_21: splitCagr(eq, 2016, 2021),
    cagr_2021_26: splitCagr(eq, 2021, 2026),
  };
}

function nfix(v, d = 2) {
  if (v == null || !Number.isFinite(+v)) return null;
  return +(+v).toFixed(d);
}

console.log('Loading SPX + benchmark…');
const t0 = Date.now();
const u = universe({ universe: 'SPX' });
const [benchmark, data] = await Promise.all([
  history('^GSPC', FETCH_YEARS),
  batch(u.tickers, (t) => history(t, FETCH_YEARS), 300000, 8),
]);
console.log(`loaded ${data.results.length}/${u.tickers.length} in ${Date.now() - t0}ms; errors=${data.errors.length}`);

const common = {
  benchmarkBars: benchmark.bars,
  startCapital: START,
  fractional: true,
  sizeMode: 'EQUITY',
  fee: FEE,
};

const windows = [
  { key: 'y5', years: 5, label: '5 Jahre' },
  { key: 'y10', years: 10, label: '10 Jahre' },
];

const monthlyCfgs = [
  { id: 'levy_monthly_n25', label: 'Original Levy: monatliche Komplettrotation, Top 25', group: 'original_levy', n: 25 },
  { id: 'levy_monthly_n5', label: 'Original Levy: monatliche Komplettrotation, Top 5', group: 'original_levy', n: 5 },
];

const byWindow = {};
for (const w of windows) {
  console.log('\n===', w.label, '===');
  const rows = [];
  for (const cfg of monthlyCfgs) {
    console.log('run', cfg.id, w.key);
    const bt = monthlyLevyBacktest(data.results, w.years, cfg.n, common);
    rows.push(summarize(cfg.id, cfg.label, cfg.group, 'monthly_levy', cfg, bt));
    const s = rows.at(-1);
    console.log(`  CAGR=${nfix(s.cagr)} MaxDD=${nfix(s.maxDD)} MAR=${nfix(s.mar, 3)} Sh=${nfix(s.sharpe, 3)} Eq=${nfix(s.finalEquity, 0)}`);
  }
  for (const cfg of WEEKLY) {
    console.log('run', cfg.id, w.key);
    const bt = rotationBacktest(data.results, w.years, cfg.n, {
      ...common, mode: cfg.mode, rankTop: cfg.rankTop, rsExit: cfg.rsExit, confirmWeeks: cfg.confirmWeeks,
      ...STRATEGY, // optional --trail/--trail-lock/--ranking (or RSL_* env)
    });
    rows.push(summarize(cfg.id, cfg.label, cfg.group, 'weekly_signal', cfg, bt));
    const s = rows.at(-1);
    console.log(`  CAGR=${nfix(s.cagr)} MaxDD=${nfix(s.maxDD)} MAR=${nfix(s.mar, 3)} Sh=${nfix(s.sharpe, 3)} Eq=${nfix(s.finalEquity, 0)}`);
  }
  byWindow[w.key] = { label: w.label, years: w.years, rows };
}

const payload = {
  generated: new Date().toISOString(),
  universe: 'SPX',
  start: START,
  fee: FEE,
  size: 'EQUITY',
  fractional: 1,
  coverage: {
    requested: u.tickers.length,
    loaded: data.results.length,
    loadErrors: data.errors.length,
    note: 'Nur heutige S&P-500-Mitglieder (Survivorship). Keine Dividenden, keine historische M&A-Bereinigung. Gebühr 1 $ je Trade. Startkapital 10.000.',
  },
  windows: byWindow,
};
writeFileSync(`${OUT}/RSL26_Strategievarianten_Vergleich_2026-11-09.json`, JSON.stringify(payload, null, 2));

const csvRows = [];
for (const w of windows) {
  for (const r of byWindow[w.key].rows) {
    csvRows.push({
      Fenster: w.label,
      Von: r.from, Bis: r.to,
      ID: r.id, Variante: r.label, Gruppe: r.group, Engine: r.engine,
      Exit: r.mode, N: r.n, RANKTOP: r.rankTop, RSExit: r.rsExit, confirmWeeks: r.confirmWeeks,
      CAGR: nfix(r.cagr), MaxDD: nfix(r.maxDD), MAR: nfix(r.mar, 3), Sharpe: nfix(r.sharpe, 3),
      Endwert: nfix(r.finalEquity, 2), Gebuehren: nfix(r.totalFees, 2),
      TradesZu: r.tradesClosed, TradesOffen: r.tradesOpen,
      Winrate: nfix(r.winRate), HaltWochen: nfix(r.holdWeeksAvg, 2),
      BenchCAGR: nfix(r.benchCagr),
      CAGR_2016_21: nfix(r.cagr_2016_21), CAGR_2021_26: nfix(r.cagr_2021_26),
    });
  }
}
writeFileSync(`${OUT}/RSL26_Strategievarianten_Vergleich_2026-11-09.csv`, toGermanCsv(csvRows, [
  { key: 'Fenster', label: 'Fenster' }, { key: 'Von', label: 'Von' }, { key: 'Bis', label: 'Bis' },
  { key: 'ID', label: 'ID' }, { key: 'Variante', label: 'Variante' }, { key: 'Gruppe', label: 'Gruppe' },
  { key: 'Engine', label: 'Regelwerk' }, { key: 'Exit', label: 'Exit/Modus' },
  { key: 'N', label: 'N' }, { key: 'RANKTOP', label: 'RANKTOP' }, { key: 'RSExit', label: 'RS-Exit' },
  { key: 'confirmWeeks', label: 'confirmWeeks' },
  { key: 'CAGR', label: 'CAGR' }, { key: 'MaxDD', label: 'MaxDD' }, { key: 'MAR', label: 'MAR' },
  { key: 'Sharpe', label: 'Sharpe' }, { key: 'Endwert', label: 'Endwert' }, { key: 'Gebuehren', label: 'Gebühren' },
  { key: 'TradesZu', label: 'Trades geschlossen' }, { key: 'TradesOffen', label: 'Trades offen' },
  { key: 'Winrate', label: 'Winrate' }, { key: 'HaltWochen', label: 'Haltedauer Wochen' },
  { key: 'BenchCAGR', label: 'S&P CAGR' },
  { key: 'CAGR_2016_21', label: 'CAGR 2016–21' }, { key: 'CAGR_2021_26', label: 'CAGR 2021–26' },
]));
console.log('Wrote files to', OUT);
