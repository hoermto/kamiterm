// GSWBT-Worker: Grid + Robustheit + Walk-Forward + OOS-Neustart, ohne den Server-Thread zu blockieren.
import { parentPort, workerData } from 'node:worker_threads';
import { runGrid, gridRows, walkForward, backtest, pickAt } from './engine.js';
import { summarize } from './summary.js';

try {
  const { ds, req } = workerData;
  const holdDays = Number(req.holdDays) > 0 ? Number(req.holdDays) : 0;
  const G = runGrid(ds, req.grid, { start: req.start, end: req.end, wfStart: req.wfStart, oosStart: req.oosStart, maxCells: req.maxCells, holdDays, tax: req.tax || null, onProgress: (done, total) => parentPort.postMessage({ type: 'progress', done, total, phase: 'grid' }) });
  const rows = gridRows(G, { limit: 1500 });
  const pick = { U1: rows.pick.U1, L1: rows.pick.L1, S: rows.pick.S, L2: rows.pick.L2, window: rows.pick.window, costPct: rows.pick.costPct };
  const chosen = req.params || pick;
  const end = ds.dates[G.to - 1];
  const sel = summarize(ds, backtest(ds, chosen, { start: req.start, end, holdDays, tax: req.tax || null }));
  let wf = null, oos = null;
  if (G.wfK.length) { try { wf = summarize(ds, walkForward(ds, G)); } catch (e) { wf = { error: e.message }; } }
  if (G.oosK != null) {
    const d = G.ckDates[G.oosK];
    const pIS = pickAt(G, G.oosK);
    oos = { start: d, fixed: summarize(ds, backtest(ds, chosen, { start: d, end, holdDays, tax: req.tax || null })), picked: { ...summarize(ds, backtest(ds, pIS, { start: d, end, holdDays, tax: req.tax || null })), pickedAt: d } };
  }
  parentPort.postMessage({ type: 'done', result: {
    span: { start: ds.dates[G.from], end, days: G.to - G.from }, ms: G.ms, cells: G.cells.length, ckDates: G.ckDates,
    grid: { rows: rows.rows, total: rows.total, robustBest: rows.robustBest, rawBest: rows.rawBest, pick: rows.pick, grid: req.grid },
    selected: sel, selectedIsPick: !req.params, wf, oos, notes: ds.notes || [], pair: ds.pair, tax: req.tax || null,
  } });
} catch (e) { parentPort.postMessage({ type: 'error', error: e.message }); }
