import { TEST_DATA_DIR, REAL_DATA_DIR } from './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
// GSW-Parameter-Profile: data/gsw-profiles.json (implizit Spec v3, Migration aus gsw-settings.json ohne Schreiben),
// API /api/gsw/profiles (list/create/update/delete/activate), Anbindung an Engine/Steuer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.QT_OFFLINE = '1';
const P = await import('../lib/gsw/profiles.js');
const { profileDiff, taxFromInput } = await import('../lib/gsw/service.js');
const { backtest } = await import('../lib/gsw/engine.js');
const { PAIRS } = await import('../lib/gsw/data.js');
const { start } = await import('../server.js');

const FILE = path.join(TEST_DATA_DIR, 'gsw-profiles.json');
const SETTINGS = path.join(TEST_DATA_DIR, 'gsw-settings.json');
let server, base;
before(async () => { const s = await start(41000 + Math.floor(Math.random() * 1000)); server = s.server; base = `http://127.0.0.1:${s.port}`; });
after(() => server.close());
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'x-qt': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const reset = () => { fs.rmSync(FILE, { force: true }); fs.rmSync(SETTINGS, { force: true }); };

test('isolierter Datenordner', () => { assert.notEqual(path.resolve(TEST_DATA_DIR), path.resolve(REAL_DATA_DIR)); });

test('Datei fehlt → implizites Profil Spec v3, nichts geschrieben', () => {
  reset();
  const st = P.loadProfiles();
  assert.equal(st.implicit, true);
  assert.equal(st.profiles.length, 1);
  const p = st.profiles[0];
  assert.equal(p.name, 'Spec v3');
  assert.equal(p.pairId, 'GLDSLV');
  assert.deepEqual([p.params.U1, p.params.L1, p.params.S, p.params.L2, p.params.window, p.params.costPct], [90, 82, 100, 66, 60, 0.1]);
  assert.equal(p.hold.on, false);
  assert.equal(p.tax.mode, 'none');
  assert.equal(fs.existsSync(FILE), false);
});

test('Migration: gsw-settings.json als Startwert, Datei bleibt unverändert', () => {
  reset();
  const raw = { version: 1, pairId: 'INVESCO', custom: { gold: '', silver: '', currency: '' }, params: { U1: 92, L1: 84, S: 104, L2: 68, window: 60, costPct: 0.2 }, start: '2016-10-21', holdMin: { days: 365, on: {} } };
  fs.writeFileSync(SETTINGS, JSON.stringify(raw));
  const before = fs.readFileSync(SETTINGS, 'utf8');
  const p = P.loadProfiles().profiles[0];
  assert.equal(p.name, 'Aus GSW-Einstellungen');
  assert.equal(p.pairId, 'INVESCO');
  assert.equal(p.params.U1, 92);
  assert.equal(p.params.costPct, 0.2);
  assert.equal(p.hold.on, true, 'Lieferanspruch → Haltefrist an (Default wie bisher)');
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), before);
  assert.equal(fs.existsSync(FILE), false);
  // Spec-gleiche Einstellungen → Spec v3
  fs.writeFileSync(SETTINGS, JSON.stringify({ ...raw, pairId: 'GLDSLV', params: { U1: 90, L1: 82, S: 100, L2: 66, window: 60, costPct: 0.1 } }));
  assert.equal(P.loadProfiles().profiles[0].name, 'Spec v3');
  reset();
});

test('API: anlegen, aktivieren, ändern, löschen (aktives nicht), Validierung', async () => {
  reset();
  let r = await call('GET', '/api/gsw/profiles');
  assert.equal(r.status, 200);
  assert.equal(r.body.implicit, true);
  assert.ok(r.body.pairs.length >= 8);
  r = await call('POST', '/api/gsw/profiles', { profile: { name: 'BULL Sperre', pairId: 'WTSWAPM', params: { U1: 95, L1: 81, S: 96, L2: 74 }, hold: { on: true, days: 365 }, tax: { mode: 'kest', rate: 26.375 }, note: 'Test', snapshot: { start: '2016-10-21', end: '2026-10-21', endValue: 46992.52, cagr: 0.1674, maxdd: -0.4786, switches: 6, taxPaid: 14353.23, currency: 'EUR', evil: 'x' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const id = r.body.profile.id;
  assert.equal(r.body.profiles.length, 2, 'implizites Profil wird beim ersten Speichern mitgeschrieben');
  assert.equal(r.body.activeId, P.IMPLICIT_ID);
  assert.equal(r.body.profile.snapshot.evil, undefined);
  assert.equal(r.body.profile.snapshot.switches, 6);
  assert.equal(r.body.profile.params.window, 60, 'fehlende Felder aus Spec');
  assert.ok(fs.existsSync(FILE));
  const disk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  assert.equal(disk.profiles.length, 2);
  // doppelter Name, ungültige Werte
  assert.equal((await call('POST', '/api/gsw/profiles', { profile: { name: 'bull sperre' } })).status, 400);
  assert.equal((await call('POST', '/api/gsw/profiles', { profile: { name: 'X', params: { U1: 80, L1: 85 } } })).status, 400);
  assert.equal((await call('POST', '/api/gsw/profiles', { profile: { name: 'X', pairId: 'NOPE' } })).status, 400);
  assert.equal((await call('POST', '/api/gsw/profiles', { profile: { name: '' } })).status, 400);
  assert.equal((await call('POST', '/api/gsw/profiles', { profile: { name: 'X', tax: { mode: 'church' } } })).status, 400);
  // aktivieren
  r = await call('POST', '/api/gsw/profiles/activate', { id });
  assert.equal(r.body.activeId, id);
  assert.equal(P.activeProfile().name, 'BULL Sperre');
  // ändern (Teil-Update)
  r = await call('PUT', '/api/gsw/profiles', { id, profile: { params: { U1: 94 }, note: 'geändert' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.params.U1, 94);
  assert.equal(r.body.profile.params.L1, 81);
  assert.equal(r.body.profile.note, 'geändert');
  assert.equal(r.body.profile.name, 'BULL Sperre');
  // aktives löschen → 400; anderes löschen ok
  assert.equal((await call('DELETE', `/api/gsw/profiles?id=${id}`)).status, 400);
  assert.equal((await call('POST', '/api/gsw/profiles/delete', { id })).status, 400);
  r = await call('POST', '/api/gsw/profiles/delete', { id: P.IMPLICIT_ID });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.profiles.map((p) => p.id), [id]);
  assert.equal((await call('POST', '/api/gsw/profiles/activate', { id: 'nope' })).status, 404);
  // settings.json und Buch nicht angelegt
  assert.equal(fs.existsSync(path.join(TEST_DATA_DIR, 'settings.json')), false);
  assert.equal(fs.existsSync(path.join(TEST_DATA_DIR, 'gsw-book.json')), false);
  reset();
});

test('Engine-Anbindung: Profil → Backtest-Request, Steuer, Abweichungsliste', () => {
  const p = P.normProfile({ name: 'T', pairId: 'INVESCO', params: { U1: 94, L1: 84, S: 104, L2: 68 }, hold: { on: true, days: 365 }, tax: { mode: 'kest', p23: 'auto' } });
  const req = P.profileRequest(p);
  assert.equal(req.holdLock, true);
  assert.equal(req.holdDays, 365);
  assert.equal(req.taxMode, 'kest');
  const tax = taxFromInput(req, {}, PAIRS.INVESCO);
  assert.equal(tax.p23, true);
  // Fixture-Lauf mit Profil-Parametern = direkter Lauf
  const here = path.dirname(fileURLToPath(import.meta.url));
  const L = fs.readFileSync(path.join(here, 'fixtures', 'gsw', 'prices_and_ratio_2016-2026.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const F = (k) => Float64Array.from(L.map((r) => +r[k]));
  const ds = { dates: L.map((r) => r[0]), gold: F(1), silver: F(2), GLD: F(3), SLV: F(4), tradable: null, tradeFrom: 0, pair: { gold: 'GLD', silver: 'SLV', currency: 'USD' } };
  ds.pg = ds.GLD; ds.ps = ds.SLV; ds.ozf = Float64Array.from(ds.gold, (g) => 1 / g);
  const spec = P.specProfile();
  const r = backtest(ds, spec.params, { holdDays: spec.hold.on ? spec.hold.days : 0, tax: taxFromInput(P.profileRequest(spec), {}, PAIRS.GLDSLV) });
  assert.ok(Math.abs(r.metrics.endValue - 102111.00) < 0.01, 'Spec-v3-Profil reproduziert die Spec');
  const r2 = backtest(ds, p.params, { holdDays: 365, tax: { mode: 'kest', p23: true } });
  const r3 = backtest(ds, req.params, { holdDays: req.holdDays, tax: taxFromInput(req, {}, PAIRS.INVESCO) });
  assert.equal(r2.metrics.endValue, r3.metrics.endValue);
  // Abweichungen für „geändert“
  assert.deepEqual(profileDiff(spec, spec), []);
  const d = P.normProfile({ params: { U1: 91 }, hold: { on: true } }, spec);
  assert.deepEqual(profileDiff(spec, d), ['U1', 'hold.on']);
});
