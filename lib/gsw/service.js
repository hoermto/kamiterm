// GSW-API: Live-Status + Buch (GSW) und Backtest-Jobs (GSWBT). Schreibt nur data/gsw-settings.json und data/gsw-book.json.
import { Worker } from 'node:worker_threads';
import crypto from 'node:crypto';
import { loadDataset, resolvePair, PAIRS, SIGNAL_TICKERS, load, kindInfo } from './data.js';
import { backtest, lastDaySignal, normParams } from './engine.js';
import { SPEC_GRID, range, DEFAULT_PARAMS, SPEC_START, gridCells, taxFreeFrom, inHoldPeriod, restHoldDays, KEST_RATE } from './math.js';
import { loadSettings, holdMinDays, holdMinEnabled } from './settings.js';
import * as book from './book.js';
import * as profiles from './profiles.js';

const DS_TTL = 10 * 60e3;
const dsCache = new Map();
async function dataset(pair, start) {
  const key = `${pair.gold}|${pair.silver}|${pair.currency}|${start}`;
  const hit = dsCache.get(key);
  if (hit && Date.now() - hit.t < DS_TTL) return hit.p;
  const p = loadDataset({ pair, start });
  dsCache.set(key, { t: Date.now(), p });
  p.catch(() => dsCache.delete(key));
  return p;
}

const r4 = (v, d = 6) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const arr = (a, from = 0, to = a.length, d = 6) => Array.from(a.slice(from, to), (v) => r4(v, d));

function pairFrom(q, s) {
  const pairId = q.pairId || q.pair || s.pairId;
  const custom = { ...s.custom, ...(q.gold ? { gold: q.gold } : {}), ...(q.silver ? { silver: q.silver } : {}), ...(q.currency ? { currency: q.currency } : {}) };
  return resolvePair({ pairId, custom });
}

/** GSW-Status: Regelzustand, Schwellen, Buch mit P&L, Chartreihen. */
export async function status(q = {}) {
  const s = loadSettings();
  // Aktives Profil (oder q.profileId) bestimmt Paar, Parameter, Start und Haltefrist; q.draft = ungespeicherte Änderungen (nur Vorschau).
  const pst = profiles.loadProfiles();
  const base = q.profileId ? profiles.getProfile(String(q.profileId), pst) : profiles.activeProfile(pst);
  let draft = null;
  const draftStale = !!(q.draft && q.draftFor && String(q.draftFor) !== base.id);
  if (q.draft && !draftStale) {
    let dj; try { dj = typeof q.draft === 'string' ? JSON.parse(q.draft) : q.draft; } catch { throw Object.assign(new Error('Entwurf ungültig (JSON)'), { status: 400 }); }
    draft = profiles.normProfile({ ...dj, name: dj?.name || base.name }, base);
  }
  const prof = draft || base;
  const pair = q.pairId || q.gold ? pairFrom(q, s) : resolvePair({ pairId: prof.pairId, custom: prof.custom });
  const params = normParams({ ...prof.params });
  const start = prof.start || SPEC_START;
  const ds = await dataset(pair, start);
  const r = backtest(ds, params, { start });
  const n = ds.dates.length, i = n - 1, S = r.sig;
  const sig = S.sig[i], kM = S.kMed[i], etf = S.etf[i];
  const pairRatio = ds.pg[i] / ds.ps[i];
  const conv = pairRatio / etf; // GLD/SLV → Paar-Ratio (heutiges Verhältnis)
  const lv = (name, key, v, role) => ({ name, key, spot: v, etf: v / kM, pair: (v / kM) * conv, distPct: (v / sig - 1) * 100, role });
  const levels = [lv('Einstieg Silber', 'U1', params.U1, 'Gold → Silber, wenn sig > U1'), lv('Ausstieg normal', 'L1', params.L1, 'Silber → Gold, wenn sig < L1 (ohne Spike)'), lv('Spike scharf', 'S', params.S, 'in Silber: sig > S schaltet Spike-Modus'), lv('Spike-Exit', 'L2', params.L2, 'Silber → Gold im Spike-Modus, wenn sig < L2')];
  const due = lastDaySignal(r, params);
  const last = r.trades.at(-1);
  const rulePos = r.final.pos === 1 ? 'silver' : 'gold';
  const phase = r.final.pos === 1 ? (r.final.spike ? 'Silber (Spike)' : 'Silber') : 'Gold';
  const next = r.final.pos === 0 ? levels[0] : r.final.spike ? levels[3] : levels[1];
  // Buch bewerten (letzter Schluss je Symbol)
  const b = book.loadBook();
  const open = book.openLots(b), closed = book.closedLots(b);
  const syms = [...new Set([...open, ...closed].map((l) => l.symbol))];
  const lastClose = {};
  await Promise.all(syms.map(async (t) => { try { const h = await load(t, 1); lastClose[t] = { close: h.bars.at(-1).close, date: h.asOf }; } catch (e) { lastClose[t] = { error: e.message }; } }));
  const valBy = { gold: 0, silver: 0 };
  const openRows = open.map((l) => {
    const lc = lastClose[l.symbol] || {}; const px = lc.close;
    const value = Number.isFinite(px) ? l.qty * px : null;
    if (value != null) valBy[l.metal] += value;
    return { ...l, last: px ?? null, lastDate: lc.date || null, value, pnl: value != null ? value - l.qty * l.buyPrice : null, pnlPct: Number.isFinite(px) ? (px / l.buyPrice - 1) * 100 : null };
  });
  const closedRows = closed.slice(0, 50).map((l) => ({ ...l, pnl: l.qty * (l.sellPrice - l.buyPrice), pnlPct: (l.sellPrice / l.buyPrice - 1) * 100 }));
  const bookMetal = valBy.gold > 0 && valBy.silver > 0 ? 'mixed' : valBy.gold > 0 ? 'gold' : valBy.silver > 0 ? 'silver' : (open.length ? open[0].metal : 'none');
  const holdOn = !!prof.hold?.on;
  const holdDays = prof.hold?.days || 365;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (holdOn) {
    for (const row of openRows) {
      row.taxFreeFrom = taxFreeFrom(row.buyDate, holdDays);
      row.restDays = restHoldDays(row.buyDate, todayIso, holdDays);
      row.inHold = inHoldPeriod(row.buyDate, todayIso, holdDays);
    }
  }
  let hint = null;
  const target = due.due || rulePos;
  const tName = (m) => (m === 'gold' ? 'Gold' : 'Silber');
  const dd = (x) => (x ? `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}` : '—');
  if (due.due) hint = { level: 'due', text: `Signal am Schluss ${dd(ds.dates[i])}: Swap zu ${tName(due.due)} fällig am nächsten Schluss (${due.rule}).` };
  if (bookMetal === 'none') hint = hint || { level: 'info', text: `Buch leer. Regel liegt in ${tName(rulePos)}${last ? ` seit ${dd(last.execDate)}` : ''}.` };
  else if (bookMetal === 'mixed') hint = { level: 'warn', text: `Buch hält Gold und Silber gleichzeitig; Regel: 100 % ${tName(target)}.${hint ? ' ' + hint.text : ''}` };
  else if (bookMetal !== target) hint = { level: 'due', text: `Swap zu ${tName(target)} fällig: Buch in ${tName(bookMetal)}, Regel ${due.due ? `(Signal ${dd(ds.dates[i])})` : `seit ${dd(last?.execDate || ds.dates[r.from])}`} in ${tName(target)}.` };
  else if (!due.due) hint = { level: 'ok', text: `Buch passt zur Regel (${tName(target)}).` };
  if (holdOn && hint?.level === 'due' && bookMetal !== 'none' && bookMetal !== 'mixed' && bookMetal !== target) {
    const lots = openRows.filter((l) => l.metal === bookMetal && l.inHold);
    if (lots.length) {
      const until = lots.map((l) => l.taxFreeFrom).sort().at(-1);
      hint = { ...hint, text: `Swap fällig – Haltefrist bis ${dd(until)}`, holdUntil: until, holdLots: lots.length };
    }
  }
  // Chartreihen (ab Start)
  const from = 0;
  return {
    asOf: ds.dates[i], pair, params, start, settings: s, signalTickers: SIGNAL_TICKERS, pairs: Object.values(PAIRS),
    state: { phase, pos: rulePos, spike: !!r.final.spike, sig, kMed: kM, window: params.window, etfRatio: etf, spotRatio: S.spot[i], pairRatio, conv, lastSwitch: last || null, due, next: { ...next } },
    levels, closes: { GLD: ds.GLD[i], SLV: ds.SLV[i], 'GC=F': ds.gold[i], 'SI=F': ds.silver[i], [pair.gold]: ds.pg[i], [pair.silver]: ds.ps[i] },
    backtest: { metrics: r.metrics, trades: r.trades, from: ds.dates[r.from] },
    book: { open: openRows, closed: closedRows, valueBy: valBy, metal: bookMetal, lastClose }, hint,
    holdMin: { enabled: holdOn, days: holdDays, disclaimer: 'Keine Steuerberatung. Die Frist gilt nicht automatisch; sie hängt von der steuerlichen Einordnung des Produkts ab.' },
    kind: kindInfo(pair.kind),
    profile: { active: base, effective: prof, draft: !!draft, draftStale, changed: draft ? profileDiff(base, draft) : [], activeId: pst.activeId, implicit: pst.implicit, list: pst.profiles.map((p) => ({ id: p.id, name: p.name, pairId: p.pairId, snapshot: p.snapshot || null })) },
    chart: { dates: ds.dates.slice(from), sig: arr(S.sig, from, n, 4), kMed: arr(S.kMed, from, n, 6), etf: arr(S.etf, from, n, 5), pg: arr(ds.pg, from, n, 4), ps: arr(ds.ps, from, n, 4) },
    notes: ds.notes, meta: ds.meta,
  };
}

/** Welche Felder weicht der Entwurf vom gespeicherten Profil ab? (für die Markierung „geändert“) */
export function profileDiff(a, b) {
  const out = [];
  if (a.pairId !== b.pairId) out.push('pairId');
  if (b.pairId === 'CUSTOM') for (const k of ['gold', 'silver', 'currency']) if ((a.custom?.[k] || '') !== (b.custom?.[k] || '')) out.push(`custom.${k}`);
  for (const k of Object.keys(b.params || {})) if (Number(a.params?.[k]) !== Number(b.params[k])) out.push(k);
  if ((a.start || SPEC_START) !== (b.start || SPEC_START)) out.push('start');
  if (!!a.hold?.on !== !!b.hold?.on) out.push('hold.on');
  if ((a.hold?.days || 365) !== (b.hold?.days || 365)) out.push('hold.days');
  for (const k of ['mode', 'rate', 'allowance', 'p23', 'p23Rate']) if ((a.tax?.[k] ?? null) !== (b.tax?.[k] ?? null)) out.push(`tax.${k}`);
  if ((a.note || '') !== (b.note || '')) out.push('note');
  if (a.name !== b.name) out.push('name');
  return out;
}

// ---------- Backtest-Jobs (Worker-Thread, UI pollt Fortschritt) ----------
const jobs = new Map();
const parseList = (v, fb) => {
  if (v == null || v === '') return fb;
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  const t = String(v).trim();
  const m = /^(-?[\d.]+)\s*[-–:]\s*(-?[\d.]+)(?:\s*[/:]\s*([\d.]+))?$/.exec(t); // "78-96/1" oder "78:96:1"
  if (m) return range(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 1);
  const l = t.split(/[,;\s]+/).map((x) => Number(x.replace(',', '.'))).filter(Number.isFinite);
  if (!l.length) throw Object.assign(new Error(`Liste ungültig: ${t}`), { status: 400 });
  return l;
};
export function gridFromInput(g = {}) {
  const out = {};
  for (const k of ['U1', 'gap', 'S', 'L2', 'window', 'costPct']) out[k] = [...new Set(parseList(g[k], SPEC_GRID[k]))].sort((a, b) => a - b);
  if (out.window.some((w) => w < 1 || w > 500 || !Number.isInteger(w))) throw Object.assign(new Error('Median-Fenster: ganze Zahlen 1–500'), { status: 400 });
  if (out.costPct.some((c) => c < 0 || c > 5)) throw Object.assign(new Error('Kosten 0–5 %'), { status: 400 });
  return out;
}

export const TAX_DISCLAIMER = 'Keine Steuerberatung. Vereinfachtes Modell: Steuer je Realisierung (Swap = Verkauf + Neukauf) aus dem Erlös, Verlusttopf ohne Topftrennung, keine Kirchensteuer, keine Teilfreistellung, keine §23-Freigrenze; Gewinn in Handelswährung des Paars (Währungseffekte ignoriert). §23 EStG nur für Paare mit Lieferanspruch (physical-delivery): steuerfrei ab Kauf + 1 Jahr + 1 Tag, davor eigentlich persönlicher Steuersatz (einstellbar).';
const pctIn = (v, d, name) => {
  if (v == null || v === '') return d;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 60) throw Object.assign(new Error(`${name}: 0–60 %`), { status: 400 });
  return n / 100;
};
/**
 * Steueroption aus dem Request: taxMode 'none' (Rohertrag, Default) | 'kest'. taxRate/p23Rate in %, taxAllowance je Jahr.
 * taxP23 'auto' (Default: §23, wenn Paar-Art physical-delivery und Haltefrist-Option des Paars an) | 'on' (nur bei physical-delivery) | 'off'.
 */
export function taxFromInput(body = {}, s = {}, pair = {}) {
  const mode = String(body.taxMode || 'none').toLowerCase();
  if (mode === 'none' || mode === '') return null;
  if (mode !== 'kest') throw Object.assign(new Error(`Steuermodus unbekannt: ${mode} (none | kest)`), { status: 400 });
  const rate = pctIn(body.taxRate, KEST_RATE, 'Steuersatz');
  const p23Rate = pctIn(body.p23Rate, rate, '§23-Satz');
  const al = body.taxAllowance == null || body.taxAllowance === '' ? 0 : Number(String(body.taxAllowance).replace(',', '.'));
  if (!Number.isFinite(al) || al < 0 || al > 1e6) throw Object.assign(new Error('Pauschbetrag: 0–1.000.000'), { status: 400 });
  const pm = String(body.taxP23 || 'auto').toLowerCase();
  const deliv = pair?.kind === 'physical-delivery';
  const p23 = deliv && (pm === 'on' || (pm === 'auto' && holdMinEnabled(s, pair)));
  return { mode: 'kest', rate, p23Rate, allowance: al, p23, p23Mode: pm, kind: pair?.kind || null };
}

export async function startBacktest(body = {}) {
  const s = loadSettings();
  const pair = pairFrom(body, s);
  const start = String(body.start || SPEC_START).slice(0, 10), end = body.end ? String(body.end).slice(0, 10) : null;
  const grid = gridFromInput(body.grid || {});
  const nCells = gridCells(grid).length;
  if (!nCells) throw Object.assign(new Error('Grid leer: prüfe Bedingungen L2 < L1 und S > U1'), { status: 400 });
  if (nCells > 250000) throw Object.assign(new Error(`Grid zu groß (${nCells} Zellen, Limit 250.000)`), { status: 400 });
  const params = body.params ? normParams(body.params) : null;
  const lockOn = body.holdLock === true || body.holdLock === '1' || body.holdLock === 1 || body.holdLock === 'on' || body.holdLock === 'true';
  let holdDays = 0;
  if (lockOn) {
    const n = Number(String(body.holdDays || holdMinDays(s)).replace(',', '.'));
    if (!Number.isFinite(n) || n < 1 || n > 3650 || !Number.isInteger(n)) throw Object.assign(new Error('Haltefrist: ganze Tage 1–3650'), { status: 400 });
    holdDays = n;
  }
  const tax = taxFromInput(body, s, pair);
  const req = { tax, start, end, grid, params, wfStart: body.wfStart === '' ? null : String(body.wfStart || '2019-10-21').slice(0, 10), oosStart: body.oosStart === '' ? null : String(body.oosStart || '2023-10-20').slice(0, 10), maxCells: 250000, holdDays };

  const id = `gswbt-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const job = { id, status: 'loading', progress: 0, total: 0, startedAt: new Date().toISOString(), pair, req, result: null, error: null };
  jobs.set(id, job);
  for (const k of [...jobs.keys()].slice(0, Math.max(0, jobs.size - 6))) jobs.delete(k);
  (async () => {
    try {
      const ds = await dataset(pair, start);
      job.status = 'running';
      const plain = { dates: ds.dates, gold: ds.gold, silver: ds.silver, GLD: ds.GLD, SLV: ds.SLV, pg: ds.pg, ps: ds.ps, tradable: ds.tradable, ozf: ds.ozf, tradeFrom: ds.tradeFrom, pair: ds.pair, notes: ds.notes };
      const w = new Worker(new URL('./worker.js', import.meta.url), { workerData: { ds: plain, req } });
      w.on('message', (m) => {
        if (m.type === 'progress') { job.progress = m.done; job.total = m.total; job.phase = m.phase; }
        else if (m.type === 'done') { job.status = 'done'; job.result = m.result; job.finishedAt = new Date().toISOString(); }
        else if (m.type === 'error') { job.status = 'error'; job.error = m.error; }
      });
      w.on('error', (e) => { job.status = 'error'; job.error = e.message; });
      w.on('exit', (code) => { if (job.status === 'running') { job.status = 'error'; job.error = `Worker beendet (${code})`; } });
    } catch (e) { job.status = 'error'; job.error = e.message; }
  })();
  return publicJob(job);
}
const publicJob = (j, full = false) => ({ id: j.id, status: j.status, progress: j.progress, total: j.total, phase: j.phase || null, startedAt: j.startedAt, finishedAt: j.finishedAt || null, pair: j.pair, req: j.req, error: j.error, ...(full && j.result ? { result: j.result } : {}) });
export function getJob(id) { const j = jobs.get(String(id || '')); if (!j) throw Object.assign(new Error('Job nicht gefunden (Server neu gestartet?)'), { status: 404 }); return publicJob(j, true); }

/** Einzellauf (schnell, ohne Grid) für eine gewählte Parameterzeile. */
export async function runSingle(body = {}) {
  const s = loadSettings();
  const pair = pairFrom(body, s);
  const start = String(body.start || SPEC_START).slice(0, 10), end = body.end ? String(body.end).slice(0, 10) : null;
  const ds = await dataset(pair, start);
  const { summarize } = await import('./summary.js');
  const lockOn = body.holdLock === true || body.holdLock === '1' || body.holdLock === 1 || body.holdLock === 'on' || body.holdLock === 'true';
  let holdDays = 0;
  if (lockOn) {
    const n = Number(String(body.holdDays || holdMinDays(s)).replace(',', '.'));
    if (!Number.isFinite(n) || n < 1 || n > 3650 || !Number.isInteger(n)) throw Object.assign(new Error('Haltefrist: ganze Tage 1–3650'), { status: 400 });
    holdDays = n;
  }
  const tax = taxFromInput(body, s, pair);
  return { ...summarize(ds, backtest(ds, normParams(body.params || DEFAULT_PARAMS), { start, end, holdDays, tax })), taxReq: tax };

}

export { book };

export { profiles };
