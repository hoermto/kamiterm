// AT-17: SETTINGS-Reiter — Zuordnung der Abschnitte, Deep-Link-Argumente, gespeicherter Reiter, Tastatur.
import './helpers/isolate-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SETTINGS_TABS, SECTION_TAB, DEFAULT_TAB, tabFromWord, pickTab, nextTab } from '../public/js/settings-tabs.js';

test('fünf Reiter in fester Reihenfolge, jeder mit mindestens einem Abschnitt', () => {
  assert.deepEqual(SETTINGS_TABS.map((t) => t.label), ['Allgemein', 'Benachrichtigungen', 'Updates', 'Datenquellen', 'UI']);
  const ids = SETTINGS_TABS.map((t) => t.id);
  for (const id of ids) assert.ok(Object.values(SECTION_TAB).includes(id), `${id} leer`);
  for (const [sec, tab] of Object.entries(SECTION_TAB)) assert.ok(ids.includes(tab), `${sec} → unbekannter Reiter ${tab}`);
});

test('jeder Abschnitt in settings.js ist genau einem Reiter zugeordnet', () => {
  const src = fs.readFileSync(new URL('../public/js/fn/settings.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const sections = {'), src.indexOf('for (const [id, tab] of Object.entries(SECTION_TAB))'));
  const defined = [...body.matchAll(/^ {4}(\w+)\(\) \{/gm)].map((m) => m[1]).sort();
  assert.deepEqual(defined, Object.keys(SECTION_TAB).sort());
});

test('App-Nutzung steht im Reiter UI direkt nach „Top bar apps“, Allgemein hat nur den Namen', () => {
  assert.equal(SECTION_TAB.usage, 'UI');
  const ui = Object.entries(SECTION_TAB).filter(([, t]) => t === 'UI').map(([k]) => k);
  assert.equal(ui.indexOf('usage'), ui.indexOf('bar') + 1);
  assert.deepEqual(Object.entries(SECTION_TAB).filter(([, t]) => t === 'GENERAL').map(([k]) => k), ['name']);
});

test('Deep-Link: SETTINGS NOTIFY usw., auch deutsch; sonst gespeicherter Reiter, sonst Allgemein', () => {
  assert.equal(pickTab(['NOTIFY'], 'UI'), 'NOTIFY');
  assert.equal(pickTab(['benachrichtigungen']), 'NOTIFY');
  assert.equal(pickTab(['DATENQUELLEN']), 'DATA');
  assert.equal(pickTab(['UPDATE']), 'UPDATES');
  assert.equal(pickTab(['UI']), 'UI');
  assert.equal(pickTab(['XYZ'], 'UPDATES'), 'UPDATES');
  assert.equal(pickTab([], 'kaputt'), DEFAULT_TAB);
  assert.equal(pickTab(), 'GENERAL');
  assert.equal(tabFromWord(''), null);
});

test('Tastatur: Pfeile umlaufend, Pos1/Ende', () => {
  assert.equal(nextTab('GENERAL', 'ArrowRight'), 'NOTIFY');
  assert.equal(nextTab('UI', 'ArrowRight'), 'GENERAL');
  assert.equal(nextTab('GENERAL', 'ArrowLeft'), 'UI');
  assert.equal(nextTab('DATA', 'Home'), 'GENERAL');
  assert.equal(nextTab('DATA', 'End'), 'UI');
  assert.equal(nextTab('DATA', 'a'), null);
});
