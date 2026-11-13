import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-settings-'));
process.env.QT_DATA_DIR = tmp;

const { getTool, saveTool, resetTool, TOOL_DEFAULTS, loadAll, listProfiles, saveProfile, deleteProfile, DEFAULT_RSL_PROFILE, DEFAULT_RSL_PROFILE_ID } = await import('../lib/tool-settings.js');
const userProfiles = () => listProfiles('RSL26').filter((p) => !p.isDefault && !p.builtin);

test('tool settings defaults and save/load/reset', () => {
  const d = getTool('RSL26');
  assert.equal(d.n, TOOL_DEFAULTS.RSL26.n);
  assert.equal(d.rrgExit, 'RANK');
  const saved = saveTool('RSL26', { n: 8, rankTop: 8, rrgExit: 'CONFIRM', confirmWeeks: 2 });
  assert.equal(saved.n, 8);
  assert.equal(saved.confirmWeeks, 2);
  assert.equal(getTool('RSL26').n, 8);
  const file = path.join(tmp, 'settings.json');
  assert.ok(fs.existsSync(file));
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.tools.RSL26.n, 8);
  resetTool('RSL26');
  assert.equal(getTool('RSL26').n, TOOL_DEFAULTS.RSL26.n);
  assert.ok(!loadAll().tools.RSL26);
});

test('settings persist for multiple tools', () => {
  saveTool('RRG', { season: 'LEADING', sector: 'XLK' });
  saveTool('PARAMHEATMAP', { mode: 'CONFIRM', metric: 'sharpe' });
  assert.equal(getTool('RRG').season, 'LEADING');
  assert.equal(getTool('PARAMHEATMAP').mode, 'CONFIRM');
});

test('profiles save load overwrite and delete, survive tool reset', () => {
  assert.equal(TOOL_DEFAULTS.RSL26.backtest, 0);
  const a = saveProfile('RSL26', { name: 'RANK N25', universe: 'SPX', n: 25, rrgExit: 'RANK', rankTop: 25, rsExit: 1, years: 10 });
  assert.ok(a.id);
  assert.equal(a.n, 25);
  const b = saveProfile('RSL26', { name: 'CONFIRM N10', universe: 'SPX', n: 10, rrgExit: 'CONFIRM', rankTop: 10, confirmWeeks: 2 });
  assert.equal(userProfiles().length, 2);
  const again = saveProfile('RSL26', { name: 'rank n25', n: 20, rrgExit: 'RANK' });
  assert.equal(again.id, a.id, 'same name upserts');
  assert.equal(again.n, 20);
  assert.equal(userProfiles().length, 2);
  try {
    saveProfile('RSL26', { n: 5 });
    assert.fail('empty name should throw');
  } catch (e) {
    assert.match(e.message, /Profilname/);
  }
  saveTool('RSL26', { n: 8 });
  resetTool('RSL26');
  assert.equal(userProfiles().length, 2, 'reset must keep profiles');
  const del = deleteProfile('RSL26', a.id);
  assert.equal(del.profiles.length, 4, 'Standard + 2 eingebaute Universum-Profile + CONFIRM N10');
  assert.ok(del.profiles[0].isDefault);
  assert.deepEqual(del.profiles.slice(1, 3).map((p) => p.universe), ['HDAX', 'SXXP']);
  assert.equal(del.profiles[3].name, 'CONFIRM N10');
});

test('built-in universe profiles: HDAX Kandidat B / STOXX600 Kandidat A, not deletable, override by name', () => {
  const list = listProfiles('RSL26');
  const h = list.find((p) => p.id === 'builtin-hdax-kandidat-b');
  const x = list.find((p) => p.id === 'builtin-sxxp-kandidat-a');
  assert.deepEqual([h.rrgExit, h.rankTop, h.rsExit, h.ranking, h.n, h.trail, h.trailLock], ['RANK', 10, 0, 'MOM52_4', 5, 20, 4]);
  assert.deepEqual([x.rrgExit, x.rsExit, x.ranking, x.n, x.trail, x.trailLock], ['OFF', 0, 'MOM52_4', 5, 20, 0]);
  assert.throws(() => deleteProfile('RSL26', h.id), /nicht gelöscht/);
  const own = saveProfile('RSL26', { name: 'HDAX Kandidat B RANK10 MOM Trail20', n: 3 });
  assert.equal(own.id, h.id, 'same name stores an own version under the built-in id');
  const again = listProfiles('RSL26').filter((p) => p.id === h.id);
  assert.equal(again.length, 1);
  assert.equal(again[0].n, 3);
});

test('RSL26 trailing-stop defaults and profile fields (TRAIL / TRAILLOCK)', async () => {
  const { RSL_PROFILE_FIELDS } = await import('../lib/tool-settings.js');
  assert.equal(TOOL_DEFAULTS.RSL26.trail, 20, 'favourite: trailing stop 20 % by default');
  assert.equal(TOOL_DEFAULTS.RSL26.trailLock, 4);
  assert.ok(RSL_PROFILE_FIELDS.includes('trail') && RSL_PROFILE_FIELDS.includes('trailLock'));
  const p = saveProfile('RSL26', { name: 'RANK N5 RT25 Trail20', universe: 'SPX', n: 5, rrgExit: 'RANK', rankTop: 25, rsExit: 1, trail: 20, trailLock: 4 });
  assert.equal(p.trail, 20);
  assert.equal(p.trailLock, 4);
  const zero = saveProfile('RSL26', { name: 'Trail aus', n: 5, trail: 0, trailLock: 0 });
  assert.equal(zero.trail, 0, 'explicit 0 is stored');
  assert.equal(zero.trailLock, 0);
  const saved = saveTool('RSL26', { trail: 20, trailLock: 6 });
  assert.equal(saved.trail, 20);
  assert.equal(getTool('RSL26').trailLock, 6);
  resetTool('RSL26');
  assert.equal(getTool('RSL26').trail, 20);
});

test('RSL26 ranking default and profile field (RANKING)', async () => {
  const { RSL_PROFILE_FIELDS } = await import('../lib/tool-settings.js');
  assert.equal(TOOL_DEFAULTS.RSL26.ranking, 'RSL26');
  assert.ok(RSL_PROFILE_FIELDS.includes('ranking'));
  const p = saveProfile('RSL26', { name: 'Mom 12-1 Trail20', n: 5, rrgExit: 'RANK', rankTop: 25, rsExit: 1, trail: 20, trailLock: 4, ranking: 'MOM52_4' });
  assert.equal(p.ranking, 'MOM52_4');
  assert.equal(saveTool('RSL26', { ranking: 'RSL39' }).ranking, 'RSL39');
  resetTool('RSL26');
  assert.equal(getTool('RSL26').ranking, 'RSL26');
});

test('favourite RSL26 Trail20 is the default parameter set and the Standard profile', () => {
  const d = TOOL_DEFAULTS.RSL26;
  for (const [k, v] of Object.entries({ universe: 'SPX', n: 5, rrgExit: 'RANK', rankTop: 25, rsExit: 1, confirmWeeks: 1, trail: 20, trailLock: 4, ranking: 'RSL26', fee: 1, fractional: 1, size: 'EQUITY', backtest: 0, paramMode: 'FEST' })) {
    assert.equal(d[k], v, `default ${k}`);
  }
  assert.equal(DEFAULT_RSL_PROFILE.name, 'Favorit RSL26 Trail20');
  for (const k of ['universe', 'n', 'rrgExit', 'rankTop', 'rsExit', 'confirmWeeks', 'trail', 'trailLock', 'ranking', 'fee', 'fractional']) {
    assert.equal(DEFAULT_RSL_PROFILE[k], d[k], `profile ${k} matches defaults`);
  }
  const list = listProfiles('RSL26');
  assert.equal(list[0].id, DEFAULT_RSL_PROFILE_ID, 'Standard profile listed first');
  assert.equal(list[0].isDefault, true);
  assert.equal(list.filter((p) => p.isDefault).length, 1);
  assert.throws(() => deleteProfile('RSL26', DEFAULT_RSL_PROFILE_ID), /Standardprofil/);
  const edited = saveProfile('RSL26', { name: 'Favorit RSL26 Trail20', n: 6 });
  assert.equal(edited.id, DEFAULT_RSL_PROFILE_ID, 'same name overwrites the Standard profile');
  assert.equal(listProfiles('RSL26')[0].n, 6);
  assert.equal(listProfiles('RSL26').filter((p) => p.isDefault).length, 1);
  saveProfile('RSL26', { name: 'Favorit RSL26 Trail20', n: 5 });
  assert.equal(listProfiles('RRG').length, 0, 'no Standard profile for other tools');
  resetTool('RSL26');
  assert.equal(getTool('RSL26').n, 5);
  assert.equal(getTool('RSL26').trail, 20);
  assert.equal(getTool('RSL26').backtest, 0, 'backtest stays manual');
});

test('RSL26 M&A ignorieren: maSkip Standard 1, Profile/Builtins kompatibel, altes hideMa stört nicht', async () => {
  const { BUILTIN_RSL_PROFILES, RSL_PROFILE_FIELDS } = await import('../lib/tool-settings.js');
  assert.equal(TOOL_DEFAULTS.RSL26.maSkip, 1);
  assert.equal(DEFAULT_RSL_PROFILE.maSkip, 1);
  assert.ok(RSL_PROFILE_FIELDS.includes('maSkip'));
  assert.ok(!RSL_PROFILE_FIELDS.includes('hideMa'));
  for (const b of BUILTIN_RSL_PROFILES) assert.equal(b.maSkip, 1, b.id);
  for (const p of listProfiles('RSL26').filter((x) => x.isDefault || x.builtin)) assert.equal(p.maSkip, 1, p.id);
  // altes Profil mit hideMa, ohne maSkip
  const old = saveProfile('RSL26', { name: 'Alt mit hideMa', n: 6, hideMa: 1 });
  assert.equal(old.maSkip, undefined); // fehlt → UI/Backend behandeln als 1
  assert.equal(old.hideMa, undefined); // hideMa wird nicht mehr übernommen
  const off = saveProfile('RSL26', { name: 'Ohne M&A-Skip', n: 5, maSkip: 0 });
  assert.equal(off.maSkip, 0);
  assert.equal(listProfiles('RSL26').find((p) => p.id === off.id).maSkip, 0);
  // gespeicherte Tool-Einstellungen mit altem hideMa: maSkip fällt auf Default 1
  saveTool('RSL26', { hideMa: 1, n: 5 });
  assert.equal(getTool('RSL26').maSkip, 1);
  deleteProfile('RSL26', old.id); deleteProfile('RSL26', off.id); resetTool('RSL26');
});
