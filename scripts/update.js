#!/usr/bin/env node
// Check the repo for a newer Amber Terminal; with --apply, install it and stop a running copy from this
// folder first, so the starter launches the new version. How: see lib/updater.js (web API + ZIP, or git).
//   node scripts/update.js            report only
//   node scripts/update.js --apply    install when possible (used by start.bat)
//   node scripts/update.js --apply --restart   also refresh npm packages and start the terminal again (without
//                                     opening a window): the app's "Install & restart" button
// Never fails the start: problems are printed, the exit code stays 0.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { check, apply, readConfig, ROOT } from "../lib/updater.js";

const say = (s) => console.log(`  ${s}`);
const cfg = readConfig();
let st;
try {
  st = await check(ROOT, { cfg });
} catch (e) {
  st = { state: "error", reason: e.message };
}
const v = (x) => (x ? `v${x}` : "");
switch (st.state) {
  case "uptodate":
    say(`Up to date ${v(st.localVersion)} (${st.branch} @ ${st.local}).`);
    break;
  case "unconfigured":
  case "error":
    say(`Update check skipped: ${st.reason}`);
    break;
  case "blocked":
    say(`Newer version available ${v(st.remoteVersion)} (${st.behind} commit(s)), NOT installed: ${st.reason}.`);
    break;
  case "available": {
    if (st.behind == null && !st.local) say(`Version of this copy not recorded yet (first start after a download): installing ${v(st.remoteVersion)} from ${st.branch} @ ${st.remote}.`);
    else if (st.behind == null) say(`New version ${v(st.remoteVersion)} on ${st.branch} @ ${st.remote} (installed ${st.local} is not among its last 30 commits).`);
    else {
      say(`New version ${v(st.remoteVersion)} on ${st.branch}: ${st.behind} commit(s)`);
      for (const c of st.commits.slice(0, 10)) say(`  ${c.sha} ${c.date} ${c.subject}`);
      if (st.commits.length > 10) say(`  … and ${st.commits.length - 10} more`);
    }
    if (!process.argv.includes("--apply")) break;
    // A running old version would keep serving old code: stop it, the starter launches the new one.
    spawnSync(process.execPath, [path.join(ROOT, "scripts", "stop.js")], { stdio: "ignore", timeout: 15e3 });
    try {
      const done = await apply(ROOT, st);
      say(`Updated to ${v(done.localVersion)} (${done.local}).`);
    } catch (e) {
      say(`Update failed, starting the current version: ${e.message}`);
    }
    break;
  }
}
// After "Install & restart" the server is stopped (or still running if nothing was installed): bring it back.
if (process.argv.includes("--restart")) {
  const run = (script, env = process.env) => spawnSync(process.execPath, [path.join(ROOT, "scripts", script)], { cwd: ROOT, stdio: "inherit", env, timeout: 600e3 });
  run("deps.js");
  run("launch.js", { ...process.env, QT_NO_OPEN: "1" });
}
