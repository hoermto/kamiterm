import { read, write } from './store.js';

const FILE = 'settings';

// Favorisierte Variante (Research 2026-11-10, strategies/RSL26_N4_vs_N5_2026-11-10.md):
// RANK · N=5 · RANKTOP 25 · RS-Exit an · Rangliste RSL26 · Trailing-Stop 20 % · Sperre 4 Wo. · SPX · Gebühr 1 · fraktional.
// N=4 wurde geprüft und verworfen (schlechter in 10 J., WF, beiden Hälften, 52 Startwochen; Bootstrap P(Sharpe besser) ≈ 1 %).
export const DEFAULT_RSL_PROFILE_ID = 'favorit-rsl26-trail20';
export const DEFAULT_RSL_PROFILE = Object.freeze({
  id: DEFAULT_RSL_PROFILE_ID, name: 'Favorit RSL26 Trail20', isDefault: true,
  universe: 'SPX', n: 5, rrgExit: 'RANK', rankTop: 25, confirmWeeks: 1, rsExit: 1,
  trail: 20, trailLock: 4, ranking: 'RSL26', maSkip: 1, // kein topX: Rangzeilen sind Darstellung, Laden des Standardprofils behält den aktuellen Wert
  years: 5, start: 10000, size: 'EQUITY', fractional: 1, fee: 1,
});

// Eingebaute Universum-Profile (Research 10.11.2026, strategies/RSL26_HDAX_Europa_2026-11-10.md + RSL26_Mischdepot_SPX_Europa_2026-11-10.md).
// Stehen im Code, nicht in settings.json; Löschen gesperrt, Speichern unter demselben Namen legt eine eigene Fassung an.
export const BUILTIN_RSL_PROFILES = Object.freeze([
  Object.freeze({ id: 'builtin-hdax-kandidat-b', name: 'HDAX Kandidat B RANK10 MOM Trail20', builtin: true,
    universe: 'HDAX', n: 5, rrgExit: 'RANK', rankTop: 10, confirmWeeks: 1, rsExit: 0, trail: 20, trailLock: 4, ranking: 'MOM52_4', maSkip: 1,
    years: 10, start: 10000, size: 'EQUITY', fractional: 1, fee: 1,
    note: '10 J. 24,8 % CAGR / −39,3 % MaxDD (EUR), 5 J. 17,6 %; WF nicht besser als DAX-40 — Paper-Trading zuerst.' }),
  Object.freeze({ id: 'builtin-sxxp-kandidat-a', name: 'STOXX600 Kandidat A MOM Trail20', builtin: true,
    universe: 'SXXP', n: 5, rrgExit: 'OFF', rankTop: 25, confirmWeeks: 1, rsExit: 0, trail: 20, trailLock: 0, ranking: 'MOM52_4', maSkip: 1,
    years: 10, start: 10000, size: 'EQUITY', fractional: 1, fee: 1,
    note: '10 J. 25,8 % CAGR / −52,4 % MaxDD (EUR), 5 J. 25,4 %, 52 Starts min 24,9 %; Paper-Trading zuerst.' }),
]);
/** Universum-Voreinstellung (Strategie-Felder) für Reiter ohne gespeicherte Werte. */
export const UNIVERSE_PRESETS = Object.freeze({
  HDAX: BUILTIN_RSL_PROFILES[0], SXXP: BUILTIN_RSL_PROFILES[1],
});

export const TOOL_DEFAULTS = {
  RSL26: {
    universe: 'SPX', years: 5, n: 5, rrgExit: 'RANK', rankTop: 25,
    start: 10000, size: 'EQUITY', fractional: 1, fee: 1, maSkip: 1, topX: 25,
    confirmWeeks: 1, rsExit: 1, trail: 20, trailLock: 4, ranking: 'RSL26', backtest: 0,
    paramMode: 'FEST', wfWindow: 'expanding', wfRollYears: 2, wfPeriod: 'yearly', wfGrid: 'coarse', wfTransition: 'carry',
    wfTuneTrail: 0, wfTuneRanking: 0,
  },
  RRG: { sector: '', season: 'ALL' },
  MPUT: { universe: 'SPX', ivrMax: 30, otm: 15, season: 'W2S', maxLoss: '', maxLossPct: '' },
  PARAMHEATMAP: { mode: 'RANK', rs: 1, metric: 'mar' },
  SEC: { contact: '' }, // contact email for SEC EDGAR requests, see lib/sec-contact.js
  OHLC: { refreshMin: 15 }, // minutes cached daily bars may age while a market is open, see lib/ohlc-live.js
};

export function loadAll() {
  const raw = read(FILE, { tools: {} });
  if (!raw.tools) raw.tools = {};
  return raw;
}

export function getTool(tool) {
  const all = loadAll();
  const def = TOOL_DEFAULTS[tool] || {};
  return { ...def, ...(all.tools[tool] || {}) };
}

export function saveTool(tool, patch, { reset = false } = {}) {
  const all = loadAll();
  if (!all.tools) all.tools = {};
  if (reset) {
    delete all.tools[tool];
  } else {
    const def = TOOL_DEFAULTS[tool] || {};
    const prev = all.tools[tool] || {};
    const next = { ...def, ...prev, ...patch, updatedAt: new Date().toISOString() };
    // strip undefined
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    all.tools[tool] = next;
  }
  all.updatedAt = new Date().toISOString();
  write(FILE, all);
  return getTool(tool);
}

export function resetTool(tool) {
  return saveTool(tool, {}, { reset: true });
}

export const RSL_PROFILE_FIELDS = [
  'universe', 'n', 'rrgExit', 'rankTop', 'confirmWeeks', 'rsExit', 'trail', 'trailLock', 'ranking', 'maSkip', 'topX',
  'years', 'start', 'size', 'fractional', 'fee',
];

// RSL26: das Standardprofil steht immer vorn (gespeicherte Fassung, sonst die eingebaute) und trägt isDefault.
export function listProfiles(tool = 'RSL26') {
  const all = loadAll();
  const raw = all.profiles?.[tool];
  const list = Array.isArray(raw) ? raw : [];
  if (tool !== 'RSL26') return list;
  const stored = list.find((p) => p.id === DEFAULT_RSL_PROFILE_ID);
  const def = { ...DEFAULT_RSL_PROFILE, ...(stored || {}), isDefault: true };
  const builtins = BUILTIN_RSL_PROFILES.map((b) => ({ ...b, ...(list.find((p) => p.id === b.id) || {}), builtin: true }));
  const fixedIds = new Set([DEFAULT_RSL_PROFILE_ID, ...BUILTIN_RSL_PROFILES.map((b) => b.id)]);
  return [def, ...builtins, ...list.filter((p) => !fixedIds.has(p.id))];
}

function nextProfileId() {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function saveProfile(tool, input = {}) {
  const name = String(input.name || '').trim();
  if (!name) {
    const err = new Error('Profilname fehlt');
    err.status = 400;
    throw err;
  }
  const all = loadAll();
  if (!all.profiles) all.profiles = {};
  const list = Array.isArray(all.profiles[tool]) ? all.profiles[tool].slice() : [];
  const now = new Date().toISOString();
  const fields = {};
  for (const k of RSL_PROFILE_FIELDS) {
    if (input[k] != null && input[k] !== '') fields[k] = input[k];
  }
  let rec = input.id ? list.find((p) => p.id === input.id) : list.find((p) => String(p.name).toLowerCase() === name.toLowerCase());
  if (!rec && tool === 'RSL26' && (input.id === DEFAULT_RSL_PROFILE_ID || name.toLowerCase() === DEFAULT_RSL_PROFILE.name.toLowerCase())) {
    rec = { ...DEFAULT_RSL_PROFILE, createdAt: now };
    list.unshift(rec);
  }
  const bi = !rec && tool === 'RSL26' ? BUILTIN_RSL_PROFILES.find((b) => b.id === input.id || b.name.toLowerCase() === name.toLowerCase()) : null;
  if (bi) { rec = { ...bi, createdAt: now }; list.push(rec); }
  if (rec) {
    Object.assign(rec, fields, { name, updatedAt: now });
  } else {
    rec = { id: nextProfileId(), name, ...fields, createdAt: now, updatedAt: now };
    list.push(rec);
  }
  all.profiles[tool] = list;
  all.updatedAt = now;
  write(FILE, all);
  return rec;
}

export function deleteProfile(tool, id) {
  if (tool === 'RSL26' && BUILTIN_RSL_PROFILES.some((b) => b.id === id || b.name === id)) {
    const err = new Error('Eingebaute Universum-Profile können nicht gelöscht werden');
    err.status = 400;
    throw err;
  }
  if (tool === 'RSL26' && (id === DEFAULT_RSL_PROFILE_ID || id === DEFAULT_RSL_PROFILE.name)) {
    const err = new Error('Das Standardprofil kann nicht gelöscht werden');
    err.status = 400;
    throw err;
  }
  const all = loadAll();
  const list = Array.isArray(all.profiles?.[tool]) ? all.profiles[tool] : [];
  const next = list.filter((p) => p.id !== id && p.name !== id);
  if (!all.profiles) all.profiles = {};
  all.profiles[tool] = next;
  all.updatedAt = new Date().toISOString();
  write(FILE, all);
  return { ok: true, profiles: listProfiles(tool) };
}
