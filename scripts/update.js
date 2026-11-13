#!/usr/bin/env node
// Check the git repo for a newer Amber Terminal; with --apply, install it (fast-forward only) and stop a
// running copy from this folder first, so the starter launches the new version.
//   node scripts/update.js            report only
//   node scripts/update.js --apply    install when possible (used by start.bat)
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
  say(`Update check failed: ${e.message}`);
  process.exit(0);
}
const v = (x) => (x ? `v${x}` : "");
switch (st.state) {
  case "uptodate":
    say(`Up to date ${v(st.localVersion)} (${st.branch} @ ${st.local}).`);
    break;
  case "unconfigured":
  case "not-git":
  case "error":
    say(`Update check skipped: ${st.reason}`);
    break;
  case "blocked":
    say(`Newer version available ${v(st.remoteVersion)} (${st.behind} commit(s)), NOT installed: ${st.reason}.`);
    break;
  case "available": {
    say(`New version ${v(st.remoteVersion)} on ${st.branch}: ${st.behind} commit(s)`);
    for (const c of st.commits.slice(0, 10)) say(`  ${c.sha} ${c.date} ${c.subject}`);
    if (st.commits.length > 10) say(`  … and ${st.behind - 10} more`);
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
