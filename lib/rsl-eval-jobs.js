import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JOBS = path.join(DATA_DIR, 'backtests', 'jobs');
fs.mkdirSync(JOBS, { recursive: true });

export function jobPath(id) { return path.join(JOBS, `${id}.json`); }

export function readJob(id) {
  try { return JSON.parse(fs.readFileSync(jobPath(id), 'utf8')); }
  catch { return null; }
}

export function writeJob(id, patch) {
  const prev = readJob(id) || { id };
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  const tmp = jobPath(id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, jobPath(id));
  return next;
}

export function listJobs(limit = 20) {
  const files = fs.readdirSync(JOBS).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp.json')).sort().reverse();
  return files.slice(0, limit).map((f) => readJob(f.replace(/\.json$/, ''))).filter(Boolean);
}

export function loadJobResult(id) {
  const job = readJob(id);
  if (!job?.outDir) return null;
  const bt = path.join(job.outDir, 'backtest.json');
  if (!fs.existsSync(bt)) return null;
  try { return JSON.parse(fs.readFileSync(bt, 'utf8')); }
  catch { return null; }
}

/** Spawn detached CLI eval; returns job id. */
export function startEvalJob({ mode, args = [], outDir, label, params = null, paramSig = null }) {
  const id = `eval-${mode}-${Date.now().toString(36)}`;
  const out = outDir || path.join(DATA_DIR, 'backtests', id);
  fs.mkdirSync(out, { recursive: true });
  writeJob(id, {
    id, mode, status: 'running', progress: 0, label: label || mode,
    outDir: out, args, params, paramSig, startedAt: new Date().toISOString(), log: path.join(out, 'job.log'),
  });
  const script = path.join(ROOT, 'scripts', 'rsl-eval.mjs');
  const cliArgs = [script, mode, ...args, '--out', out, '--job-id', id];
  const logFd = fs.openSync(path.join(out, 'job.log'), 'a');
  const child = spawn(process.execPath, cliArgs, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  });
  child.unref();
  writeJob(id, { pid: child.pid });
  return readJob(id);
}

/** Normalised strategy extras for WF jobs (TRAIL %, TRAILLOCK weeks, RANKING, optional tuning dims). */
export function wfStrategyParams(opts = {}) {
  const t = Number(opts.trail);
  const l = Number(opts.trailLock ?? opts.traillock);
  const r = String(opts.ranking || 'RSL26').toUpperCase();
  const on = (v) => v === true || v === 1 || v === '1' || String(v || '').toLowerCase() === 'true';
  return {
    trail: Number.isFinite(t) && t > 0 ? Math.min(90, t) : 0,
    trailLock: Number.isFinite(l) && l >= 0 && opts.trailLock !== '' ? Math.floor(l) : 4,
    ranking: ['RSL26', 'RSL39', 'MOM52_4'].includes(r) ? r : 'RSL26',
    tuneTrail: on(opts.tuneTrail ?? opts.wfTuneTrail),
    tuneRanking: on(opts.tuneRanking ?? opts.wfTuneRanking),
  };
}
/** Everything that changes WF results — used to decide whether a running job can be reused. */
export function wfParamSig(opts = {}) {
  const st = wfStrategyParams(opts);
  return JSON.stringify({
    universe: String(opts.universe || 'SPX').toUpperCase(), from: opts.from || null, to: opts.to || null,
    firstYear: opts.firstYear ?? null, wfWindow: opts.wfWindow || 'expanding', rollYears: opts.rollYears ?? 2,
    period: opts.period || 'yearly', grid: opts.grid || 'coarse', transition: opts.transition || opts.wfTransition || 'carry',
    fee: opts.fee ?? 1, start: opts.start ?? 10000, size: opts.size || 'EQUITY', fractional: opts.fractional ?? true,
    pick: opts.pick || null, manual: opts.manual || null, ...st,
  });
}

/**
 * Start walk-forward backtest job for RSL26 UI/API.
 * args map: universe, years/from/to, wfWindow, rollYears, period, grid, fee, start, …
 */
export function startWalkForwardJob(opts = {}) {
  const args = [];
  if (opts.universe) args.push('--universe', String(opts.universe));
  if (opts.from) args.push('--from', String(opts.from));
  if (opts.to) args.push('--to', String(opts.to));
  if (opts.wfWindow) args.push('--wf-window', String(opts.wfWindow));
  if (opts.rollYears != null) args.push('--wf-roll-years', String(opts.rollYears));
  if (opts.period) args.push('--wf-period', String(opts.period));
  if (opts.firstYear) args.push('--wf-first-year', String(opts.firstYear));
  if (opts.grid) args.push('--grid', String(opts.grid));
  if (opts.fee != null) args.push('--fee', String(opts.fee));
  if (opts.start != null) args.push('--start', String(opts.start));
  if (opts.size) args.push('--size', String(opts.size));
  if (opts.fractional != null) args.push('--fractional', opts.fractional ? '1' : '0');
  if (opts.workers) args.push('--workers', String(opts.workers));
  if (opts.pick) args.push('--pick', String(opts.pick));
  if (opts.manual) args.push('--manual', String(opts.manual));
  if (opts.resume) args.push('--resume');
  if (opts.transition || opts.wfTransition) args.push('--wf-transition', String(opts.transition || opts.wfTransition));
  // Strategy extras: fixed in every IS/OOS run, or tuned as grid dimension.
  const st = wfStrategyParams(opts);
  args.push('--trail', String(st.trail), '--trail-lock', String(st.trailLock), '--ranking', st.ranking);
  if (st.tuneTrail) args.push('--tune-trail', '0,20');
  if (st.tuneRanking) args.push('--tune-ranking', 'RSL26,RSL39,MOM52_4');
  args.push('--no-python');
  const extra = `${st.tuneTrail ? ' TRAIL=0/20 (tune)' : st.trail > 0 ? ` TRAIL=${st.trail}/${st.trailLock}` : ''}${st.tuneRanking ? ' RANKING=tune' : st.ranking !== 'RSL26' ? ` ${st.ranking}` : ''}`;
  return startEvalJob({
    mode: 'walkforward',
    args,
    label: `WF ${opts.wfWindow || 'expanding'} ${opts.universe || 'SPX'}${extra}`,
    params: st,
    paramSig: wfParamSig(opts),
  });
}
