// GSW-Parameter-Profile in eigener Datei data/gsw-profiles.json (atomar über store.write; nie data/settings.json).
// Datei fehlt → implizites Profil „Spec v3“ (bzw. Startwert aus data/gsw-settings.json, falls dort schon Paar/Parameter
// liegen). Geschrieben wird erst bei einer Nutzeraktion (Anlegen, Ändern, Aktivieren, Löschen); gsw-settings.json bleibt unverändert.
import crypto from 'node:crypto';
import * as store from '../store.js';
import { DEFAULT_PARAMS, SPEC_START, KEST_RATE } from './math.js';
import { PAIRS, resolvePair, defaultHoldOn } from './data.js';
import { normParams } from './engine.js';
import { loadSettings } from './settings.js';

const NAME = 'gsw-profiles';
export const IMPLICIT_ID = 'spec-v3';
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export const specProfile = () => ({
  id: IMPLICIT_ID, name: 'Spec v3', pairId: 'GLDSLV', custom: { gold: '', silver: '', currency: '' },
  params: { ...DEFAULT_PARAMS }, start: SPEC_START,
  hold: { on: false, days: 365 },
  tax: { mode: 'none', rate: KEST_RATE * 100, allowance: 0, p23: 'auto', p23Rate: null },
  note: 'Spezifikation v3: GLD/SLV, 90/82/100/66, Median 60, 0,1 %/Seite, ohne Sperre, ohne Steuer', snapshot: null, createdAt: null, updatedAt: null,
});

/** Implizites Profil: Spec v3, Startwerte aus gsw-settings.json, wenn dort schon Paar/Parameter/Haltefrist liegen. */
export function implicitProfile() {
  const p = specProfile();
  const raw = store.read('gsw-settings', null);
  if (!raw || typeof raw !== 'object') return p;
  const s = loadSettings();
  const pairId = String(s.pairId || 'GLDSLV').toUpperCase();
  const params = { ...DEFAULT_PARAMS, ...s.params };
  const custom = { ...p.custom, ...(s.custom || {}) };
  let pair = null; try { pair = resolvePair({ pairId, custom }); } catch { pair = null; }
  const on = s.holdMin?.on && Object.prototype.hasOwnProperty.call(s.holdMin.on, pairId) ? !!s.holdMin.on[pairId] : defaultHoldOn(pair);
  const days = Number(s.holdMin?.days) >= 1 ? Math.round(Number(s.holdMin.days)) : 365;
  const same = pairId === 'GLDSLV' && Object.keys(DEFAULT_PARAMS).every((k) => Number(params[k]) === DEFAULT_PARAMS[k]) && !on && (s.start || SPEC_START) === SPEC_START;
  if (same) return p;
  return { ...p, name: 'Aus GSW-Einstellungen', pairId: pair ? pairId : 'GLDSLV', custom, params: pair ? params : { ...DEFAULT_PARAMS }, start: s.start || SPEC_START, hold: { on, days }, note: 'Startwert aus data/gsw-settings.json übernommen' };
}

const num = (v, name, lo, hi, d = null) => {
  if (v == null || v === '') return d;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < lo || n > hi) throw bad(`${name}: ${lo}–${hi}`);
  return n;
};

/** Profil prüfen und normalisieren (wirft 400). base = bisheriges Profil (für Teil-Updates). */
export function normProfile(input = {}, base = specProfile()) {
  const p = { ...base, ...input };
  const name = String(p.name ?? '').trim();
  if (!name) throw bad('Profilname fehlt');
  if (name.length > 80) throw bad('Profilname zu lang (max. 80 Zeichen)');
  const pairId = String(p.pairId || 'GLDSLV').toUpperCase();
  const custom = { gold: '', silver: '', currency: '', ...(base.custom || {}), ...(input.custom || {}) };
  for (const k of ['gold', 'silver', 'currency']) custom[k] = String(custom[k] || '').trim().toUpperCase();
  if (pairId !== 'CUSTOM' && !PAIRS[pairId]) throw bad(`Handelspaar unbekannt: ${pairId}`);
  resolvePair({ pairId, custom }); // prüft Ticker
  const params = normParams({ ...base.params, ...(input.params || {}) });
  const start = String(p.start || SPEC_START).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < '2006-01-01') throw bad('Start als YYYY-MM-DD (ab 2006)');
  const h = { ...base.hold, ...(input.hold || {}) };
  const days = num(h.days, 'Haltefrist-Tage', 1, 3650, 365);
  if (!Number.isInteger(days)) throw bad('Haltefrist: ganze Tage 1–3650');
  const t = { ...base.tax, ...(input.tax || {}) };
  const mode = String(t.mode || 'none').toLowerCase();
  if (!['none', 'kest'].includes(mode)) throw bad(`Steuermodus unbekannt: ${mode} (none | kest)`);
  const p23 = String(t.p23 || 'auto').toLowerCase();
  if (!['auto', 'on', 'off'].includes(p23)) throw bad('§23: auto | on | off');
  const tax = { mode, rate: num(t.rate, 'Steuersatz %', 0, 60, KEST_RATE * 100), allowance: num(t.allowance, 'Pauschbetrag', 0, 1e6, 0), p23, p23Rate: num(t.p23Rate, '§23-Satz %', 0, 60, null) };
  const note = String(p.note ?? '').slice(0, 2000);
  let snapshot = p.snapshot ?? null;
  if (snapshot != null) {
    if (typeof snapshot !== 'object') throw bad('Snapshot ungültig');
    const keep = ['start', 'end', 'endValue', 'cagr', 'maxdd', 'switches', 'taxPaid', 'endValueAfterLiq', 'cagrAfterLiq', 'lapsed', 'currency', 'pair', 'source', 'at'];
    snapshot = Object.fromEntries(keep.filter((k) => snapshot[k] != null).map((k) => [k, typeof snapshot[k] === 'number' ? snapshot[k] : String(snapshot[k]).slice(0, 120)]));
  }
  return { id: p.id, name, pairId, custom, params, start, hold: { on: !!h.on, days }, tax, note, snapshot, createdAt: p.createdAt || null, updatedAt: p.updatedAt || null };
}

/** Zustand lesen: { activeId, profiles[], implicit } — ohne zu schreiben. */
export function loadProfiles() {
  const raw = store.read(NAME, null);
  if (!raw || !Array.isArray(raw.profiles) || !raw.profiles.length) {
    const p = implicitProfile();
    return { version: 1, activeId: p.id, profiles: [p], implicit: true };
  }
  const profiles = raw.profiles.filter((p) => p && p.id);
  const activeId = profiles.some((p) => p.id === raw.activeId) ? raw.activeId : profiles[0].id;
  return { version: 1, activeId, profiles, implicit: false };
}
function save(st) {
  const out = { version: 1, activeId: st.activeId, profiles: st.profiles, updatedAt: new Date().toISOString() };
  store.write(NAME, out);
  return { ...out, implicit: false };
}
const newId = () => `p-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const stamp = (p, now) => ({ ...p, createdAt: p.createdAt || now, updatedAt: now });
export function getProfile(id, st = loadProfiles()) {
  const p = st.profiles.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error(`Profil nicht gefunden: ${id}`), { status: 404 });
  return p;
}
export const activeProfile = (st = loadProfiles()) => getProfile(st.activeId, st);

/** Neues Profil (aus Feldern, optional Basis = bestehendes Profil); activate:true → aktiv. */
export function createProfile(input = {}, { activate = false } = {}) {
  const st = loadProfiles();
  const now = new Date().toISOString();
  const base = input.fromId ? getProfile(input.fromId, st) : specProfile();
  const { fromId, id: _drop, createdAt: _c, updatedAt: _u, ...rest } = input;
  const p = stamp({ ...normProfile(rest, base), id: newId(), createdAt: now }, now);
  if (st.profiles.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) throw bad(`Profilname schon vergeben: ${p.name}`);
  const profiles = [...st.profiles.map((x) => stamp(x, x.updatedAt || now)), p];
  return { ...save({ activeId: activate ? p.id : st.activeId, profiles }), profile: p };
}

/** Profil ändern (Teil-Update, gleiche Prüfung). */
export function updateProfile(id, patch = {}) {
  const st = loadProfiles();
  const cur = getProfile(id, st);
  const now = new Date().toISOString();
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = patch;
  const p = stamp({ ...normProfile(rest, cur), id: cur.id, createdAt: cur.createdAt || now }, now);
  if (st.profiles.some((x) => x.id !== id && x.name.toLowerCase() === p.name.toLowerCase())) throw bad(`Profilname schon vergeben: ${p.name}`);
  const profiles = st.profiles.map((x) => (x.id === id ? p : stamp(x, x.updatedAt || now)));
  return { ...save({ activeId: st.activeId, profiles }), profile: p };
}

export function activateProfile(id) {
  const st = loadProfiles();
  getProfile(id, st);
  const now = new Date().toISOString();
  return save({ activeId: id, profiles: st.profiles.map((x) => stamp(x, x.updatedAt || now)) });
}

/** Löschen (aktives Profil nicht löschbar; Bestätigung macht die UI). */
export function deleteProfile(id) {
  const st = loadProfiles();
  getProfile(id, st);
  if (id === st.activeId) throw bad('Aktives Profil kann nicht gelöscht werden. Erst ein anderes Profil aktivieren.');
  return save({ activeId: st.activeId, profiles: st.profiles.filter((x) => x.id !== id) });
}

/** Request-Felder für Backtest/Steuer aus einem Profil (gleiche Form wie das GSWBT-Formular). */
export function profileRequest(p) {
  return {
    pairId: p.pairId, custom: p.custom, params: { ...p.params },
    holdLock: !!p.hold?.on, holdDays: p.hold?.days || 365,
    taxMode: p.tax?.mode || 'none', taxRate: p.tax?.rate, taxAllowance: p.tax?.allowance, taxP23: p.tax?.p23 || 'auto', p23Rate: p.tax?.p23Rate ?? '',
  };
}
