#!/usr/bin/env node
/**
 * RSL26 Evaluierungs-Pipeline — lokal lauffähig (Node ≥20, keine npm-Deps).
 *
 *   node scripts/rsl-eval.mjs <mode> [optionen]
 *
 * Modi: grid | split | walkforward | nsweep | compare | help
 *
 * Alle Tuning-Schritte sind konfigurierbar (Grid-JSON, Scoring, Constraints,
 * Lookback, Retune-Periode, manuelle Config-Override). Siehe --help.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cpus } from 'os';
import {
  PROJECT_ROOT, DEFAULT_OUT, DEFAULT_GRID, MEDIUM_GRID, DEFAULT_SELECTION,
  mergeSelection, loadJson, buildJobsFromGrid, enrichCells, pickBest, slimCfg,
  fmtCfg, runOne, loadUniverseData, runPool, tuneWindow, toGermanCsv, nfix,
  iso, sec, writeCharts, svgEquityChart, runWalkForwardBacktest, buildWfPeriods,
  normStrategy, withStrategyGrid,
} from './lib/rsl-eval-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELP = `
RSL26 Evaluierung — Parameter-Grid, Split-Test, Walk-Forward, N-Sweep, Vergleich

Verwendung:
  node scripts/rsl-eval.mjs <mode> [optionen]

Modi:
  grid          Parameter-Heatmap/Grid über ein Fenster (IS)
  split         Tune auf Fenster A, teste auf Fenster B (OOS)
  walkforward   Jährlich (oder halb-/vierteljährlich) neu tunen, Folgeperiode handeln
  nsweep        Nur N × RANKTOP-Sweep (wie n-sweep)
  compare       Feste Configs über ein Fenster vergleichen
  help          Diese Hilfe

Gemeinsame Optionen:
  --universe SPX|NDX|DAX     (Default SPX)
  --from YYYY-MM-DD          Fensterstart (Tune/Trade je nach Modus)
  --to YYYY-MM-DD            Fensterende
  --tune-from / --tune-to    Nur split: IS-Fenster
  --test-from / --test-to    Nur split: OOS-Fenster
  --years N                  Alternativ zu from/to (endet „heute“)
  --fee N                    Gebühr \$/Trade (Default 1)
  --start N                  Startkapital (Default 10000)
  --size EQUITY|START        (Default EQUITY)
  --fractional 0|1           (Default 1)
  --workers N                Parallelität (Default CPU-1)
  --out DIR                  Ausgabeordner (Default data/backtests/<mode>-<stamp>)
  --grid FILE|coarse|medium|full   Grid-Definition (JSON oder Preset-Name)
  --selection FILE           Scoring/Constraints JSON (überschreibt Preset)
  --pick plateau|raw|manual  Welche Config nach dem Tune gewählt wird
  --manual MODE,N,RT,RS,CW   Manuelle Config, z.B. RANK,10,10,1,1
  --max-dd N                 Constraint: |MaxDD| ≤ N
  --exclude-modes A,B        z.B. OFF,DIRECT
  --require-rs 0|1           Constraint RSEXIT
  --plateau-floor 0.9        MAR-Boden für Plateau-Pool
  --plateau-radius-n 1       Nachbarschaft in N
  --plateau-radius-rt 1      Nachbarschaft in RANKTOP
  --wf-window expanding|rolling   Walk-Forward Lookback (Default expanding)
  --wf-roll-years N          Bei rolling: N Jahre Lookback (Default 2)
  --wf-period yearly|semiannual|quarterly  Retune-Rhythmus (Default yearly)
  --wf-transition carry|reset   Periodenübergang (Default carry: Holdings behalten)
  --wf-first-year YYYY       Erstes Handelsjahr (Default 2018)
  --configs FILE             compare: JSON-Liste fester Configs
  --trail N                  Trailing-Stop % (Default 0 = aus) — fest in jedem IS-Tune- und OOS-Lauf
  --trail-lock N             Wiederkauf-Sperre Wochen nach Trailing-Exit (Default 4)
  --ranking R                Rangliste RSL26|RSL39|MOM52_4 (Default RSL26) — fest in jedem Lauf
  --tune-trail 0,20          TRAIL als Grid-Dimension mittunen (statt fest)
  --tune-ranking RSL26,RSL39,MOM52_4   RANKING als Grid-Dimension mittunen (statt fest)
  --job-id ID                Intern: Job-Statusdatei aktualisieren
  --resume                   Checkpoint fortsetzen (falls vorhanden)
  --no-python                Kein matplotlib; nur SVG/HTML
  --help, -h                 Hilfe

Beispiele:
  node scripts/rsl-eval.mjs grid --from 2021-11-09 --to 2026-11-09 --grid medium
  node scripts/rsl-eval.mjs split --tune-from 2016-11-09 --tune-to 2021-11-09 \\
       --test-from 2021-11-09 --test-to 2026-11-09 --grid medium
  node scripts/rsl-eval.mjs walkforward --wf-window expanding --grid coarse \\
       --wf-first-year 2018 --resume
  node scripts/rsl-eval.mjs compare --from 2016-11-09 --to 2026-11-09 \\
       --configs data/backtests/eval-presets/compare-10y.json
  node scripts/rsl-eval.mjs walkforward --pick manual --manual OFF,25,25,1,1

Manuelles Tuning:
  Grid und Selection als JSON editieren (siehe data/backtests/eval-presets/).
  --manual überschreibt die automatische Auswahl (OOS/WF handeln genau diese Config).
  Constraints (--max-dd, --exclude-modes, …) und Scoring-Gewichte sind frei setzbar.
`;

function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    return { mode: 'help' };
  }
  const mode = args[0];
  const o = { mode, _: [] };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { o.mode = 'help'; return o; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const nxt = args[i + 1];
      if (nxt == null || nxt.startsWith('--')) { o[key] = true; }
      else { o[key] = nxt; i++; }
    } else o._.push(a);
  }
  return o;
}

/** --manual MODE,N,RT,RS,CW[,TRAIL[,TRAILLOCK[,RANKING]]]; missing extras = fixed strategy values. */
function parseManual(s, fixed = {}) {
  if (!s) return null;
  const [mode, n, rt, rs, cw, tr, tl, rk] = String(s).split(',');
  return {
    mode: mode.toUpperCase(),
    n: Number(n),
    rankTop: Number(rt),
    rsExit: rs === '1' || rs === 'true',
    confirmWeeks: Number(cw || 1),
    ...normStrategy({
      trail: tr != null && tr !== '' ? tr : fixed.trail,
      trailLock: tl != null && tl !== '' ? tl : fixed.trailLock,
      ranking: rk || fixed.ranking,
    }),
  };
}
const tuneList = (v) => (v == null || v === false || v === '0' || v === '' ? null : (v === true || v === '1' ? null : String(v)));

function resolveGrid(nameOrPath) {
  const presets = path.join(PROJECT_ROOT, 'data/backtests/eval-presets');
  if (!nameOrPath || nameOrPath === 'coarse') return loadJson(path.join(presets, 'coarse.json'));
  if (nameOrPath === 'medium') return loadJson(path.join(presets, 'medium.json'));
  if (nameOrPath === 'full') return loadJson(path.join(presets, 'full.json'));
  const p = path.isAbsolute(nameOrPath) ? nameOrPath : path.join(PROJECT_ROOT, nameOrPath);
  return loadJson(p);
}

function buildSelection(opt, presetSel) {
  let sel = mergeSelection(DEFAULT_SELECTION, presetSel || {});
  if (opt.selection) {
    const p = path.isAbsolute(opt.selection) ? opt.selection : path.join(PROJECT_ROOT, opt.selection);
    sel = mergeSelection(sel, loadJson(p, {}));
  }
  if (opt.pick) sel.walkForwardPick = opt.pick;
  if (opt['plateau-floor'] != null) sel.plateauMarFloor = Number(opt['plateau-floor']);
  if (opt['plateau-radius-n'] != null) sel.plateauRadiusN = Number(opt['plateau-radius-n']);
  if (opt['plateau-radius-rt'] != null) sel.plateauRadiusRt = Number(opt['plateau-radius-rt']);
  if (opt['max-dd'] != null) sel.constraints.maxAbsDD = Number(opt['max-dd']);
  if (opt['require-rs'] != null) sel.constraints.requireRsExit = opt['require-rs'] === '1' || opt['require-rs'] === true;
  if (opt['exclude-modes']) sel.constraints.excludeModes = String(opt['exclude-modes']).split(',').map((s) => s.trim()).filter(Boolean);
  return sel;
}


function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

async function main() {
  const opt = parseArgs(process.argv);
  if (opt.mode === 'help') { console.log(HELP); process.exit(0); }

  const universeKey = (opt.universe || 'SPX').toUpperCase();
  const fee = opt.fee != null ? Number(opt.fee) : 1;
  const startCapital = opt.start != null ? Number(opt.start) : 10000;
  const sizeMode = (opt.size || 'EQUITY').toUpperCase();
  const fractional = !(opt.fractional === '0' || opt.fractional === 0 || opt.fractional === false);
  const workers = opt.workers != null ? Number(opt.workers) : Math.max(1, cpus().length - 1);
  const outDir = opt.out
    ? (path.isAbsolute(opt.out) ? opt.out : path.join(PROJECT_ROOT, opt.out))
    : path.join(DEFAULT_OUT, `${opt.mode}-${stamp()}`);
  mkdirSync(outDir, { recursive: true });

  const preset = resolveGrid(opt.grid || (opt.mode === 'split' ? 'medium' : 'coarse')) || { grid: DEFAULT_GRID, selection: DEFAULT_SELECTION };
  // Fixed strategy extras (from current settings/profile) apply to every IS tune and OOS run;
  // --tune-trail / --tune-ranking turn them into grid dimensions instead.
  const fixedStrategy = normStrategy({ trail: opt.trail, trailLock: opt['trail-lock'], ranking: opt.ranking });
  const tuneTrail = opt['tune-trail'] === true || opt['tune-trail'] === '1' ? '0,20' : tuneList(opt['tune-trail']);
  const tuneRanking = opt['tune-ranking'] === true || opt['tune-ranking'] === '1' ? 'RSL26,RSL39,MOM52_4' : tuneList(opt['tune-ranking']);
  const grid = withStrategyGrid(preset.grid || DEFAULT_GRID, fixedStrategy, { tuneTrail, tuneRanking });
  const selection = buildSelection(opt, preset.selection);
  const manualCfg = parseManual(opt.manual, fixedStrategy);
  const withFixed = (c) => ({ ...c, ...normStrategy({ ...fixedStrategy, ...c }) });

  const ckptPath = path.join(outDir, 'checkpoint.json');
  // Checkpoint signature: every parameter that changes results (incl. TRAIL/TRAILLOCK/RANKING and
  // tuned dimensions). A checkpoint with another signature is ignored → no stale tune results.
  const paramSig = JSON.stringify({
    mode: opt.mode, universe: (opt.universe || 'SPX').toUpperCase(), from: opt.from || null, to: opt.to || null, years: opt.years || null,
    fee: opt.fee ?? 1, start: opt.start ?? 10000, size: opt.size || 'EQUITY', fractional: opt.fractional ?? '1',
    grid, selection, manual: manualCfg, fixedStrategy,
    wf: [opt['wf-window'] || 'expanding', opt['wf-roll-years'] || 2, opt['wf-period'] || 'yearly', opt['wf-first-year'] || 2018, opt['wf-transition'] || 'carry'],
    split: [opt['tune-from'] || null, opt['tune-to'] || null, opt['test-from'] || null, opt['test-to'] || null],
  });
  let ckpt = { path: ckptPath, done: {}, phase: 'init', paramSig };
  if (opt.resume && existsSync(ckptPath)) {
    const prev = JSON.parse(readFileSync(ckptPath, 'utf8'));
    if (prev.paramSig === paramSig) {
      ckpt = { ...prev, path: ckptPath };
      console.log('Resume checkpoint phase=', ckpt.phase);
    } else {
      console.log('Checkpoint ignoriert: andere Parameter (z. B. TRAIL/TRAILLOCK/RANKING) als beim gespeicherten Lauf.');
    }
  }

  console.log(`Mode=${opt.mode} universe=${universeKey} out=${outDir} workers=${workers}`);
  console.log('Selection:', JSON.stringify(selection.scoreWeights), 'pick=', selection.walkForwardPick, 'manual=', fmtCfg(manualCfg) || '—');
  console.log('Strategie fest:', JSON.stringify(fixedStrategy), 'Grid TRAIL=', JSON.stringify(grid.trail), 'TRAILLOCK=', JSON.stringify(grid.trailLock), 'RANKING=', JSON.stringify(grid.ranking));

  try {
    const { writeJob } = await import('../lib/rsl-eval-jobs.js');
    if (opt['job-id']) writeJob(opt['job-id'], { status: 'running', progress: 5, outDir });
  } catch { /* ignore */ }

  const fetchYears = opt.years ? Number(opt.years) + 2 : 12;
  const data = await loadUniverseData({ universeKey, fetchYears, force: !!opt['refresh-cache'] });
  const { series, benchmarkBars, seriesPath, benchPath } = data;

  const commonOpts = { startCapital, fee, sizeMode, fractional, workers, selection, grid, manualCfg };

  if (opt.mode === 'grid') {
    const from = opt.from ? sec(opt.from) : (opt.years ? Date.now() / 1000 - Number(opt.years) * 365.25 * 86400 : sec('2021-11-09'));
    const to = opt.to ? sec(opt.to) : Date.now() / 1000;
    const tuned = await tuneWindow({
      label: 'grid', windowStart: from, windowEnd: to, seriesPath: benchPath && seriesPath, benchPath,
      ...commonOpts, seriesPath, benchPath, ckpt, ckptKey: 'grid',
    });
    // fix: pass seriesPath correctly
    writeFileSync(path.join(outDir, 'grid-results.json'), JSON.stringify(tuned, null, 2));
    writeFileSync(path.join(outDir, 'grid.csv'), toGermanCsv(
      tuned.cells.map((c) => ({ ...c, rsExit: c.rsExit ? 1 : 0, mar: nfix(c.mar, 3), sharpe: nfix(c.sharpe, 3), cagr: nfix(c.cagr), maxDD: nfix(c.maxDD) })),
      [
        { key: 'mode', label: 'Mode' }, { key: 'n', label: 'N' }, { key: 'rankTop', label: 'RANKTOP' },
        { key: 'rsExit', label: 'RSExit' }, { key: 'confirmWeeks', label: 'CW' },
        { key: 'trail', label: 'TRAIL' }, { key: 'trailLock', label: 'TRAILLOCK' }, { key: 'ranking', label: 'RANKING' },
        { key: 'cagr', label: 'CAGR' }, { key: 'maxDD', label: 'MaxDD' }, { key: 'mar', label: 'MAR' },
        { key: 'sharpe', label: 'Sharpe' }, { key: 'score', label: 'Score' }, { key: 'smoothScore', label: 'Smooth' },
      ],
    ));
    console.log('Best plateau', fmtCfg(tuned.bestPlateau), 'raw', fmtCfg(tuned.bestRaw));
  } else if (opt.mode === 'split') {
    const tuneFrom = sec(opt['tune-from'] || opt.from || '2016-11-09');
    const tuneTo = sec(opt['tune-to'] || '2021-11-09');
    const testFrom = sec(opt['test-from'] || '2021-11-09');
    const testTo = sec(opt['test-to'] || opt.to || '2026-11-09');
    const isTune = await tuneWindow({
      label: 'IS', windowStart: tuneFrom, windowEnd: tuneTo,
      seriesPath, benchPath, ...commonOpts, ckpt, ckptKey: 'split_is',
    });
    const pick = manualCfg ? { ...manualCfg, ...slimCfg(manualCfg) } : (isTune.pick || isTune.bestPlateau || isTune.bestRaw);
    const oos = runOne(series, benchmarkBars, pick, { ...commonOpts, windowStart: testFrom, windowEnd: testTo });
    const isM = runOne(series, benchmarkBars, pick, { ...commonOpts, windowStart: tuneFrom, windowEnd: tuneTo });
    const baselines = [
      { id: 'original', mode: 'RANK', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 },
      { id: 'late_ref', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
    ].map(withFixed).map((c) => {
      const m = runOne(series, benchmarkBars, c, { ...commonOpts, windowStart: testFrom, windowEnd: testTo });
      return { id: c.id, cfg: fmtCfg(c), cagr: m.cagr, maxDD: m.maxDD, mar: m.mar, sharpe: m.sharpe };
    });
    const result = {
      pick: fmtCfg(pick), pickSource: manualCfg ? 'manual' : isTune.pickSource,
      strategy: normStrategy(pick), fixedStrategy,
      is: { cagr: isM.cagr, maxDD: isM.maxDD, mar: isM.mar, sharpe: isM.sharpe },
      oos: { cagr: oos.cagr, maxDD: oos.maxDD, mar: oos.mar, sharpe: oos.sharpe },
      baselines, selection, grid,
    };
    writeFileSync(path.join(outDir, 'split-results.json'), JSON.stringify(result, null, 2));
    writeCharts(outDir, {
      title: 'Split OOS Equity',
      equitySeries: [
        { id: 'pick', label: fmtCfg(pick), data: oos.equity },
        { id: 'bench', label: 'Benchmark', data: oos.benchmarkEquity },
      ],
    }, opt['no-python'] ? null : path.join(__dirname, 'plot-wf.py'));
    console.log(JSON.stringify(result, null, 2));
  } else if (opt.mode === 'walkforward') {
    await runWalkForward({
      opt, series, benchmarkBars, seriesPath, benchPath, outDir, ckpt,
      commonOpts, selection, grid, manualCfg, universeKey, fixedStrategy,
    });
  } else if (opt.mode === 'nsweep') {
    const from = opt.from ? sec(opt.from) : Date.now() / 1000 - 5 * 365.25 * 86400;
    const to = opt.to ? sec(opt.to) : Date.now() / 1000;
    const nsGrid = {
      n: grid.n || [5, 8, 10, 12, 15, 20, 25, 30, 40, 50],
      rankTop: [25, '=N'],
      modes: ['RANK'],
      confirmWeeks: [1],
      rsExit: [true],
      trail: grid.trail, trailLock: grid.trailLock, ranking: grid.ranking,
    };
    const tuned = await tuneWindow({
      label: 'nsweep', windowStart: from, windowEnd: to,
      seriesPath, benchPath, ...commonOpts, grid: nsGrid, ckpt, ckptKey: 'nsweep',
    });
    writeFileSync(path.join(outDir, 'nsweep.json'), JSON.stringify(tuned, null, 2));
    console.log('Best', fmtCfg(tuned.pick));
  } else if (opt.mode === 'compare') {
    const from = opt.from ? sec(opt.from) : sec('2016-11-09');
    const to = opt.to ? sec(opt.to) : sec('2026-11-09');
    let configs = loadJson(
      opt.configs
        ? (path.isAbsolute(opt.configs) ? opt.configs : path.join(PROJECT_ROOT, opt.configs))
        : path.join(PROJECT_ROOT, 'data/backtests/eval-presets/compare-default.json'),
      null,
    );
    if (!configs) {
      configs = {
        configs: [
          { id: 'original', mode: 'RANK', n: 25, rankTop: 25, rsExit: true, confirmWeeks: 1 },
          { id: 'confirm10', mode: 'CONFIRM', n: 10, rankTop: 10, rsExit: false, confirmWeeks: 2 },
          { id: 'rank5', mode: 'RANK', n: 5, rankTop: 10, rsExit: true, confirmWeeks: 1 },
        ],
      };
    }
    const list = (configs.configs || configs).map(withFixed);
    const rows = [];
    const equitySeries = [];
    for (const c of list) {
      const m = runOne(series, benchmarkBars, c, { ...commonOpts, windowStart: from, windowEnd: to });
      rows.push({ id: c.id || fmtCfg(c), cfg: fmtCfg(c), cagr: nfix(m.cagr), maxDD: nfix(m.maxDD), mar: nfix(m.mar, 3), sharpe: nfix(m.sharpe, 3) });
      equitySeries.push({ id: c.id || fmtCfg(c), label: c.id || fmtCfg(c), data: m.equity });
      if (!equitySeries.find((e) => e.id === 'bench') && m.benchmarkEquity) {
        equitySeries.push({ id: 'bench', label: 'Benchmark', data: m.benchmarkEquity });
      }
    }
    writeFileSync(path.join(outDir, 'compare.csv'), toGermanCsv(rows, [
      { key: 'id', label: 'ID' }, { key: 'cfg', label: 'Config' }, { key: 'cagr', label: 'CAGR' },
      { key: 'maxDD', label: 'MaxDD' }, { key: 'mar', label: 'MAR' }, { key: 'sharpe', label: 'Sharpe' },
    ]));
    writeCharts(outDir, { title: 'Compare', equitySeries }, opt['no-python'] ? null : null);
    console.table(rows);
  } else {
    console.error('Unbekannter Modus:', opt.mode);
    console.log(HELP);
    process.exit(1);
  }

  try {
    const { writeJob } = await import('../lib/rsl-eval-jobs.js');
    if (opt['job-id']) writeJob(opt['job-id'], { status: 'done', progress: 100, outDir });
  } catch { /* ignore */ }
  console.log('Fertig. Ausgabe:', outDir);
}

async function runWalkForward({
  opt, series, benchmarkBars, seriesPath, benchPath, outDir, ckpt,
  commonOpts, selection, grid, manualCfg, universeKey, fixedStrategy,
}) {
  const period = opt['wf-period'] || 'yearly';
  const wfWindow = opt['wf-window'] || 'expanding';
  const rollYears = Number(opt['wf-roll-years'] || 2);
  const firstYear = Number(opt['wf-first-year'] || 2018);
  const lastYear = opt.to ? Number(String(opt.to).slice(0, 4)) : new Date().getUTCFullYear();
  const anchor = opt.from ? sec(opt.from) : sec('2016-11-09');

  const updateProg = async (info) => {
    console.log(`  [${info.progress ?? '?'}%] ${info.message || info.phase || ''}`);
    if (!opt['job-id']) return;
    try {
      const { writeJob } = await import('../lib/rsl-eval-jobs.js');
      writeJob(opt['job-id'], {
        status: info.phase === 'done' ? 'done' : 'running',
        progress: info.progress ?? 0,
        message: info.message,
        period: info.period,
        config: info.config,
      });
    } catch { /* optional */ }
  };

  const transition = (opt['wf-transition'] || 'carry').toLowerCase() === 'reset' ? 'reset' : 'carry';
  const result = await runWalkForwardBacktest({
    series, benchmarkBars, seriesPath, benchPath,
    firstYear, lastYear, wfWindow, rollYears, period, transition,
    anchorSec: anchor, grid, selection, manualCfg,
    startCapital: commonOpts.startCapital, fee: commonOpts.fee,
    sizeMode: commonOpts.sizeMode, fractional: commonOpts.fractional,
    workers: commonOpts.workers, ckpt, onProgress: updateProg,
  });

  writeFileSync(path.join(outDir, 'walkforward-results.json'), JSON.stringify({
    meta: result.stats, yearly: result.yearly, selection, grid, fixedStrategy,
    wfWindow, rollYears, period, transition, manual: fmtCfg(manualCfg),
  }, null, 2));
  result.fixedStrategy = fixedStrategy;
  result.stats = { ...result.stats, fixedStrategy, tunedDims: { trail: (grid.trail || []).length > 1, ranking: (grid.ranking || []).length > 1 } };
  writeFileSync(path.join(outDir, 'backtest.json'), JSON.stringify(result));
  writeFileSync(path.join(outDir, 'walkforward-yearly.csv'), toGermanCsv(
    result.yearly.map((r) => ({
      ...r, ret: nfix(r.retPct), bm: nfix(r.bmRet), excess: nfix(r.excess),
      cagr: nfix(r.cagr), maxDD: nfix(r.maxDD), mar: nfix(r.mar, 3),
    })),
    [
      { key: 'period', label: 'Periode' }, { key: 'config', label: 'Config' },
      { key: 'mode', label: 'Mode' }, { key: 'n', label: 'N' }, { key: 'rankTop', label: 'RANKTOP' },
      { key: 'rsExit', label: 'RSExit' }, { key: 'confirmWeeks', label: 'CW' },
      { key: 'trail', label: 'TRAIL' }, { key: 'trailLock', label: 'TRAILLOCK' }, { key: 'ranking', label: 'RANKING' },
      { key: 'ret', label: 'Return' }, { key: 'bm', label: 'Bench' }, { key: 'excess', label: 'Excess' },
      { key: 'cagr', label: 'CAGR' }, { key: 'maxDD', label: 'MaxDD' }, { key: 'mar', label: 'MAR' },
      { key: 'trades', label: 'Trades' },
    ],
  ));
  writeFileSync(path.join(outDir, 'trades.csv'), toGermanCsv(
    result.tradeLog || [],
    [
      { key: 'date', label: 'Datum' }, { key: 'signalDate', label: 'SignalDatum' },
      { key: 'period', label: 'Periode' }, { key: 'activeConfig', label: 'AktiveConfig' },
      { key: 'ticker', label: 'Ticker' }, { key: 'action', label: 'Aktion' },
      { key: 'reason', label: 'Grund' }, { key: 'price', label: 'Preis' },
      { key: 'shares', label: 'Stuecke' }, { key: 'value', label: 'Wert' },
      { key: 'fee', label: 'Gebuehr' }, { key: 'pnl', label: 'PnL' },
      { key: 'holdDays', label: 'Haltetage' }, { key: 'rank', label: 'Rank' },
    ],
  ));
  writeCharts(outDir, {
    title: `Walk-Forward ${wfWindow} ${period}`,
    equitySeries: [
      { id: 'wf', label: 'WF Strategy', data: result.equity },
      { id: 'bench', label: 'Benchmark', data: result.benchmarkEquity },
    ],
  }, null);
  console.log('WF CAGR≈', nfix(result.stats?.cagr), 'MaxDD', nfix(result.stats?.maxDD), 'final', nfix(result.stats?.finalEquity));
  console.table(result.yearly.map((r) => ({ period: r.period, config: r.config, ret: nfix(r.retPct), excess: nfix(r.excess) })));
}


main().catch((e) => {
  console.error(e);
  process.exit(1);
});
