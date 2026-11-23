#!/usr/bin/env node
// npm-Abhängigkeiten vor dem Start sicherstellen (aufgerufen von start.sh / start.command / start.bat).
// Installiert nur, wenn nötig: eine Abhängigkeit aus package.json fehlt in node_modules, oder package.json /
// package-lock.json sind neuer als die npm-Marke node_modules/.package-lock.json. Dann `npm ci --omit=dev`
// (mit Lockfile; schlägt das fehl: `npm install --omit=dev`), sonst `npm install --omit=dev`.
// Ohne npm oder bei Fehlern: Hinweis ausgeben und trotzdem starten (Mailversand ist dann aus, alles andere läuft).
// Exit-Code immer 0. AMBER_DEPS=0 überspringt die Prüfung.
//   node scripts/deps.js          prüfen und ggf. installieren
//   node scripts/deps.js --check  nur prüfen (Exit 0 = ok, 1 = Installation nötig)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (s) => console.log(`  ${s}`);
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

/** Was fehlt? -> { need: bool, why: string, missing: [] } (pure bis auf Dateisystem-Lesen) */
export function depsState(dir = root) {
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return { need: false, why: 'keine package.json', missing: [] }; }
  const deps = Object.keys(pkg.dependencies || {});
  if (!deps.length) return { need: false, why: 'keine Abhängigkeiten', missing: [] };
  const missing = deps.filter((d) => !fs.existsSync(path.join(dir, 'node_modules', ...d.split('/'), 'package.json')));
  if (missing.length) return { need: true, why: `fehlt: ${missing.join(', ')}`, missing };
  const marker = mtime(path.join(dir, 'node_modules', '.package-lock.json'));
  const newest = Math.max(mtime(path.join(dir, 'package.json')), mtime(path.join(dir, 'package-lock.json')));
  if (!marker) return { need: true, why: 'node_modules ohne npm-Marke', missing };
  if (newest > marker + 1000) return { need: true, why: 'package.json/package-lock.json neuer als node_modules', missing };
  return { need: false, why: 'aktuell', missing };
}

/** npm finden: zuerst das npm neben dem laufenden Node (auch die portable Kopie in .runtime), sonst npm aus PATH. */
export function findNpm() {
  const nd = path.dirname(process.execPath);
  for (const cli of [path.join(nd, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(nd, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')])
    if (fs.existsSync(cli)) return { cmd: process.execPath, pre: [cli], shell: false };
  const probe = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['-v'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (probe.status === 0) return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', pre: [], shell: process.platform === 'win32' };
  return null;
}

function run(npm, args) {
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` };
  const r = spawnSync(npm.cmd, [...npm.pre, ...args], { cwd: root, stdio: 'inherit', shell: npm.shell, env, timeout: 300000 });
  return r.status === 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.env.AMBER_DEPS === '0') process.exit(0);
  const st = depsState();
  if (process.argv.includes('--check')) { say(`Abhängigkeiten: ${st.why}`); process.exit(st.need ? 1 : 0); }
  if (st.need) {
    say(`Abhängigkeiten installieren (${st.why}) ...`);
    const npm = findNpm();
    if (!npm) say('HINWEIS: npm nicht gefunden. Das Terminal startet trotzdem; E-Mail-Versand ist aus, bis "npm install" im Ordner amber-terminal gelaufen ist.');
    else {
      const flags = ['--omit=dev', '--no-audit', '--no-fund'];
      let ok = fs.existsSync(path.join(root, 'package-lock.json')) && run(npm, ['ci', ...flags]);
      if (!ok) ok = run(npm, ['install', ...flags]);
      say(ok ? 'Abhängigkeiten installiert.' : 'HINWEIS: npm-Installation fehlgeschlagen (offline?). Das Terminal startet trotzdem; E-Mail-Versand ist aus.');
    }
  }
  process.exit(0);
}
