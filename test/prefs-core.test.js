import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefs, normalizeUsage, countRun, barApps, DEFAULT_BAR, THEMES } from '../public/js/prefs-core.js';

const AVAIL = [...DEFAULT_BAR, 'RSL26', 'RSLBT', 'SETTINGS', 'KEYS'];

test('normalizePrefs: defaults and cleaning', () => {
  const p = normalizePrefs(null);
  assert.equal(p.theme, 'amber');
  assert.equal(p.name, 'AMBER');
  assert.equal(p.bar.mode, 'auto');
  assert.deepEqual(p.bar.apps, DEFAULT_BAR);
  const q = normalizePrefs({ theme: 'pink', name: '   Grokki   Capital Partners Ltd  ', bar: { mode: 'custom', size: 999, apps: ['rsl26', 'RSL26', ' wei ', ''] }, evil: 1 });
  assert.equal(q.theme, 'amber');
  assert.equal(q.name, 'Grokki Capital P'); // 16 chars, spaces collapsed
  assert.deepEqual(q.bar, { mode: 'custom', size: 30, apps: ['RSL26', 'WEI'] });
  assert.ok(!('evil' in q));
  assert.equal(normalizePrefs({ name: '  ' }).name, 'AMBER');
  for (const t of Object.keys(THEMES)) assert.equal(normalizePrefs({ theme: t }).theme, t);
});

test('usage: count and clean', () => {
  let u = normalizeUsage({ wei: 2, X: -1, Y: 'a', Z: 0 });
  assert.deepEqual(u, { WEI: 2 });
  u = countRun(countRun(u, 'rsl26'), 'RSL26');
  assert.deepEqual(u, { WEI: 2, RSL26: 2 });
});

test('barApps auto: no usage = original bar', () => {
  assert.deepEqual(barApps({}, {}, AVAIL), DEFAULT_BAR);
});

test('barApps auto: most used left, ties keep original order, size limit', () => {
  const r = barApps({ bar: { mode: 'auto', size: 5 } }, { RSLBT: 9, RSL26: 20, ECO: 9, TOP: 1 }, AVAIL);
  assert.deepEqual(r, ['RSL26', 'ECO', 'RSLBT', 'TOP', 'WEI']); // ECO before RSLBT (original bar), WEI fills up
});

test('barApps custom: user list and order, unknown codes skipped', () => {
  const r = barApps({ bar: { mode: 'custom', apps: ['RSLBT', 'GONE', 'RSL26', 'HELP'] } }, { HELP: 100 }, AVAIL);
  assert.deepEqual(r, ['RSLBT', 'RSL26', 'HELP']);
});
