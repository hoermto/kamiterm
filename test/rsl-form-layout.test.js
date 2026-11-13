import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Regression: Top X (Rangzeilen) darf beim Umbau des Formulars nicht verloren gehen (leerer Abschnitt „Anzeige“ in 1.1.0).
const src = fs.readFileSync(new URL('../public/js/fn/grokki.js', import.meta.url), 'utf8');

test('RSL26: kein leerer Abschnitt „Anzeige“, Rangzeilen-Feld im Kopf der Rangliste', () => {
  assert.ok(!/grp\('Anzeige'/.test(src), 'Abschnitt Anzeige soll entfallen');
  assert.match(src, /inp\.name='topX'/, 'Zahlenfeld topX im Ranglisten-Kopf');
  assert.match(src, /rankHead\.append\([^\n]*topXControl\(\)\)/, 'Steuerung hängt am Ranglisten-Kopf');
  assert.match(src, /topX:topXVal\(cur\.topX\)/, 'Formular-Submit behält das aktuelle Top X');
});
