// Regression (v1.1.0): Rangzeilen/Top X ging beim Neuladen verloren.
// Ursache: Der Panel-Befehl (data/state.json) behielt TOPX=25 als festen Parameter; beim Neuladen gewann er
// gegen die gespeicherte Einstellung und wurde wieder gespeichert. Dazu: RSLBT-Speichern ohne topX/byUniverse.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.QT_OFFLINE = '1';
process.env.QT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-rsl-settings-'));
const { start } = await import('../server.js');
let server, base;
before(async () => { const s = await start(41000 + Math.floor(Math.random() * 1000)); server = s.server; base = `http://127.0.0.1:${s.port}`; });
after(() => server.close());

const put = (settings) => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-qt': '1' }, body: JSON.stringify({ tool: 'RSL26', settings }) }).then((r) => r.json());
const get = () => fetch(`${base}/api/settings?tool=RSL26`).then((r) => r.json()).then((j) => j.settings || j);

test('Server-Round-Trip: Top X bleibt nach Scanner- und RSLBT-Speichern erhalten', async () => {
  // Rangzeilen 10 (setTopX speichert die vollen Scanner-Werte + topX)
  await put({ universe: 'SPX', n: 5, rrgExit: 'RANK', rankTop: 25, maSkip: 1, topX: 10, paramMode: 'FEST' });
  assert.equal((await get()).topX, 10);
  // RSLBT-Speichern (eigenes Formular, ohne Top-X-Feld) darf topX nicht auf 25 zurücksetzen
  await put({ universe: 'SPX', years: 5, n: 6, rrgExit: 'RANK', rankTop: 25, maSkip: 1, paramMode: 'FEST', byUniverse: { SPX: { n: 6 } } });
  const s = await get();
  assert.equal(s.topX, 10);
  assert.equal(s.n, 6);
  assert.equal(s.byUniverse.SPX.n, 6);
  // Universum-Wechsel (anderer Reiter) speichert ebenfalls ohne Verlust
  await put({ universe: 'HDAX', n: 5, maSkip: 1, topX: 10, byUniverse: { SPX: { n: 6 }, HDAX: { n: 5 } } });
  assert.equal((await get()).topX, 10);
});

test('UI-Code: Panel-Befehl ohne feste Parameter, RSLBT speichert topX und byUniverse', () => {
  const src = fs.readFileSync(new URL('../public/js/fn/grokki.js', import.meta.url), 'utf8');
  assert.match(src, /ctx\.setCmd\?\.\(`RSL26 \$\{universe\}\$\{action==='WATCH'\?' WATCH':''\}`\)/, 'Scanner setzt den Panel-Befehl auf RSL26 <U>');
  assert.match(src, /const setTopX=[\s\S]{0,700}ctx\.setCmd\?\.\(`RSL26 \$\{universe\}`\)/, 'Rangzeilen-Änderung setzt den Panel-Befehl zurück');
  assert.match(src, /ctx\.setCmd\?\.\(`RSLBT \$\{universe\}`\)/, 'RSLBT-Formular ohne feste Parameter');
  const persist = src.match(/const persist=\(next\)=>saveToolSettings\('RSL26',\{[^\n]*/)[0];
  assert.match(persist, /topX:/); assert.match(persist, /byUniverse:byUniversePatch/);
  const btSaves = src.match(/saveToolSettings\('RSL26',\{universe, years:cur\.years[^\n]*/g);
  assert.ok(btSaves.length >= 1);
  for (const l of btSaves) { assert.match(l, /topX:topXVal\(cur\.topX\)/); assert.match(l, /byUniverse:/); }
});
