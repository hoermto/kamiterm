#!/usr/bin/env node
// Start Amber Terminal in the background and open your browser. It keeps running after this
// terminal closes. If it's already running, this just opens the browser.
//   node scripts/launch.js            node scripts/launch.js --no-open
//   node scripts/launch.js --app      own app window (Edge/Chrome app mode) instead of a browser tab
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const first = Number(process.env.PORT) || 3787;
const same = (a, b) => !!a && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

async function running() {
  for (let p = first; p < first + 21; p++) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(700) });
      const j = await r.json();
      // Only this folder's copy counts; another install on the same port range is left alone.
      if (j.app === 'amber-terminal' && same(j.root, root)) return p;
    } catch { /* not this port */ }
  }
  return null;
}

// Own app window (no tabs, no address bar, own taskbar icon) via Edge or Chrome "--app" mode, with a separate
// profile in data/app-window so it remembers its size and doesn't mix with your browser. Windows only;
// elsewhere, or without Edge/Chrome, the normal browser opens. Turn off with APP_WINDOW=0 / --browser.
function appBrowser() {
  if (process.platform !== 'win32') return null;
  const e = process.env;
  const dirs = [e['ProgramFiles(x86)'], e.ProgramFiles, e.LOCALAPPDATA].filter(Boolean);
  const exes = [['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe']];
  for (const x of exes) for (const d of dirs) { const f = path.join(d, ...x); if (fs.existsSync(f)) return f; }
  return null;
}
function openAppWindow(url) {
  const exe = appBrowser();
  if (!exe) return false;
  const profile = path.join(root, 'data', 'app-window');
  try {
    const c = spawn(exe, [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' });
    c.on('error', () => {});
    c.unref();
    return true;
  } catch { return false; }
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch { /* headless */ }
}

let port = await running();
if (!port) {
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const log = path.join(root, 'data', 'server.log');
  const fd = fs.openSync(log, 'a');
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env: process.env });
  child.unref();
  for (let i = 0; i < 40 && !port; i++) { await new Promise((r) => setTimeout(r, 400)); port = await running(); }
  if (!port) {
    console.error(`Amber Terminal didn't start. Last lines of ${log}:\n${fs.readFileSync(log, 'utf8').split('\n').slice(-20).join('\n')}`);
    process.exit(1);
  }
}
const url = `http://localhost:${port}`;
const wantApp = !process.argv.includes('--browser') && process.env.APP_WINDOW !== '0' && (process.argv.includes('--app') || process.env.APP_WINDOW === '1');
if (!process.argv.includes('--no-open') && process.env.QT_NO_OPEN !== '1') { if (!(wantApp && openAppWindow(url))) openBrowser(url); }
console.log(`Amber Terminal is running at ${url}\nStop it any time with: node scripts/stop.js`);
process.exit(0);
