import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefs, normalizeUsage, countRun, barApps, barCandidates, usageOrder, DEFAULT_BAR, THEMES } from '../public/js/prefs-core.js';

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

test('barCandidates: market-wide functions only, SETTINGS has its own key', () => {
  const funcs = { WEI: { id: 'WEI' }, DES: { id: 'DES', needs: true }, SETTINGS: { id: 'SETTINGS' }, RSL26: { id: 'RSL26' } };
  assert.deepEqual(barCandidates(funcs), ['WEI', 'RSL26']);
});

test('normalizePrefs: ticker tape mode, default scroll', () => {
  assert.equal(normalizePrefs({}).tape, 'scroll');
  assert.equal(normalizePrefs({ tape: 'system' }).tape, 'system');
  assert.equal(normalizePrefs({ tape: 'off' }).tape, 'off');
  assert.equal(normalizePrefs({ tape: 'sideways' }).tape, 'scroll');
});

test('App usage (SETTINGS) and the Auto bar use the same order', () => {
  const avail = [...DEFAULT_BAR, 'RSL26', 'GSW'];
  const usage = { GP: 9, RSL26: 5, TOP: 5, WEI: 5, GSW: 2, DES: 2, GONE: 1 };
  const order = usageOrder(usage, avail).map(([c]) => c);
  assert.deepEqual(order, ['GP', 'WEI', 'TOP', 'RSL26', 'GSW', 'DES', 'GONE'], 'ties: standard bar first, then registry, then code');
  const bar = barApps({ bar: { mode: 'auto', size: 6 } }, usage, avail);
  assert.deepEqual(bar.slice(0, 4), order.filter((c) => avail.includes(c)), 'eligible apps in the same order as the stats');
  assert.deepEqual(bar, ['WEI', 'TOP', 'RSL26', 'GSW', 'ECO', 'GC']);
});

test('rslBasis: Standard Fr-Schluss (regelkonform), nur "live" als Alternative', () => {
  assert.equal(normalizePrefs({}).rslBasis, 'friday');
  assert.equal(normalizePrefs({ rslBasis: 'live' }).rslBasis, 'live');
  assert.equal(normalizePrefs({ rslBasis: 'quatsch' }).rslBasis, 'friday');
});
