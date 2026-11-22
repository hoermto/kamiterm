// GSW-Einstellungen in eigener Datei data/gsw-settings.json (nie data/settings.json).
import * as store from '../store.js';
import { DEFAULT_PARAMS, SPEC_START } from './math.js';
import { PAIRS, resolvePair, defaultHoldOn } from './data.js';
import { normParams } from './engine.js';

const NAME = 'gsw-settings';
export const pairsList = () => Object.values(PAIRS);
export const defaults = () => ({ version: 1, pairId: 'GLDSLV', custom: { gold: '', silver: '', currency: '' }, params: { ...DEFAULT_PARAMS }, start: SPEC_START, holdMin: { days: 365, on: {} }, updatedAt: null });

export function loadSettings() {
  const raw = store.read(NAME, null);
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  return { ...d, ...raw, custom: { ...d.custom, ...(raw.custom || {}) }, params: { ...d.params, ...(raw.params || {}) }, holdMin: { days: d.holdMin.days, on: {}, ...(raw.holdMin || {}), on: { ...((raw.holdMin && raw.holdMin.on) || {}) } } };
}

/** Patch prüfen und speichern. reset:true → Standard. */
export function saveSettings(patch = {}) {
  if (patch.reset) { const d = defaults(); d.updatedAt = new Date().toISOString(); store.write(NAME, d); return d; }
  const cur = loadSettings();
  const next = { ...cur, custom: { ...cur.custom }, params: { ...cur.params } };
  if (patch.pairId != null) next.pairId = String(patch.pairId).toUpperCase();
  if (patch.custom) for (const k of ['gold', 'silver', 'currency']) if (patch.custom[k] != null) next.custom[k] = String(patch.custom[k]).trim().toUpperCase();
  if (patch.params) next.params = normParams({ ...next.params, ...patch.params });
  if (patch.start != null) {
    const s = String(patch.start).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s < '2006-01-01') throw Object.assign(new Error('Start als YYYY-MM-DD (ab 2006)'), { status: 400 });
    next.start = s;
  }
  if (patch.holdMin) {
    const hm = { ...next.holdMin, on: { ...(next.holdMin.on || {}) } };
    if (patch.holdMin.days != null && patch.holdMin.days !== '') {
      const n = Number(String(patch.holdMin.days).replace(',', '.'));
      if (!Number.isFinite(n) || n < 1 || n > 3650 || !Number.isInteger(n)) throw Object.assign(new Error('Mindesthaltedauer: ganze Tage 1–3650'), { status: 400 });
      hm.days = n;
    }
    if (patch.holdMin.enabled != null) hm.on[next.pairId] = !!patch.holdMin.enabled;
    if (patch.holdMin.on && typeof patch.holdMin.on === 'object') Object.assign(hm.on, patch.holdMin.on);
    next.holdMin = hm;
  }
  if (next.pairId !== 'CUSTOM' && !PAIRS[next.pairId]) throw Object.assign(new Error(`Handelspaar unbekannt: ${next.pairId}`), { status: 400 });
  if (next.pairId === 'CUSTOM') resolvePair(next); // prüft Ticker
  next.updatedAt = new Date().toISOString();
  store.write(NAME, next);
  return next;
}

/** Tage der optionalen Mindesthaltedauer (Default 365). */
export function holdMinDays(s) {
  const n = Number(s?.holdMin?.days);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 365;
}
/** Ist die Frist für dieses Paar eingeschaltet? Fehlender Eintrag → Default nur bei Lieferanspruch. */
export function holdMinEnabled(s, pair) {
  const on = s?.holdMin?.on;
  if (on && Object.prototype.hasOwnProperty.call(on, pair.id)) return !!on[pair.id];
  return defaultHoldOn(pair);
}
