// AT-23: 🔔 immer sichtbar, gedämpft ohne offene Alarme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { alertBadgeState } from '../public/js/alert-badge.js';

test('alertBadgeState: 0/unbekannt gedämpft ohne Zahl, > 0 mit Zahl', () => {
  assert.deepEqual(alertBadgeState(0), { quiet: true, text: '🔔', title: 'Keine offenen Alarme · Klick öffnet ALERTS' });
  assert.equal(alertBadgeState(null).quiet, true);
  assert.match(alertBadgeState(null).title, /nicht verfügbar/);
  assert.equal(alertBadgeState(undefined).text, '🔔');
  assert.deepEqual(alertBadgeState(3), { quiet: false, text: '🔔 3', title: '3 unquittierte Alarme (Kurs + Status) · Klick öffnet ALERTS' });
  assert.match(alertBadgeState(1).title, /^1 unquittierter Alarm/);
});

test('index.html: Glocke nicht mehr hidden, startet gedämpft', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const tag = html.match(/<button[^>]*id="alertBadge"[^>]*>/)[0];
  assert.ok(!/\shidden/.test(tag), tag);
  assert.match(tag, /quiet/);
  const css = fs.readFileSync(new URL('../public/css/terminal.css', import.meta.url), 'utf8');
  assert.match(css, /\.upd\.alerts-badge\.quiet\s*\{/);
});
