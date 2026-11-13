// Updates from the git repo: used by the Windows starter (scripts/update.js --apply, on every start) and by the
// running server (daily check, warning in the top bar). Only fast-forwards: a folder with local edits, local
// commits or another branch checked out is never changed, only reported. data/ is git-ignored, so an update
// never touches your settings, holdings or caches.
//
// Where to update from, first match wins:
//   data/launcher.cfg   REPO_URL=… / BRANCH=… / UPDATE_CHECK_HOURS=…   (per machine, survives updates)
//   environment         AMBER_REPO_URL / AMBER_BRANCH                  (defaults set at the top of start.bat)
//   the checkout's "origin" remote, branch "master"
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./store.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_FILE = () => path.join(DATA_DIR, "update-status.json");
const UPDATE_REF = (branch) => `refs/remotes/amber-update/${branch}`;

// KEY=VALUE lines, # comments, optional quotes.
export function parseCfg(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1].toUpperCase()] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

export function readConfig({ dataDir = DATA_DIR, env = process.env } = {}) {
  let file = {};
  try { file = parseCfg(fs.readFileSync(path.join(dataDir, "launcher.cfg"), "utf8")); } catch { /* optional */ }
  const hours = Number(file.UPDATE_CHECK_HOURS ?? env.AMBER_UPDATE_CHECK_HOURS ?? 24);
  return {
    repoUrl: (file.REPO_URL ?? env.AMBER_REPO_URL ?? "").trim(),
    branch: (file.BRANCH || env.AMBER_BRANCH || "master").trim(),
    checkHours: Number.isFinite(hours) && hours > 0 ? hours : 24,
  };
}

// git from the starter's portable runtime (.runtime next to start.bat), else the one on PATH.
export function gitBin(root = ROOT, env = process.env) {
  if (env.AMBER_GIT) return env.AMBER_GIT;
  for (const dir of [root, path.dirname(root)]) {
    const exe = path.join(dir, ".runtime", "git", "cmd", "git.exe");
    if (fs.existsSync(exe)) return exe;
  }
  return "git";
}

function git(root, args, { timeout = 90e3 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(gitBin(root), args, { cwd: root, timeout, windowsHide: true, maxBuffer: 8e6, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error((stderr || err.message).trim().split("\n").pop()), { code: err.code }));
      else resolve(stdout.trim());
    });
  });
}
const tryGit = (root, args) => git(root, args).catch(() => null);

const versionAt = async (root, rev) => {
  const txt = await tryGit(root, ["show", `${rev}:package.json`]);
  try { return txt ? JSON.parse(txt).version : null; } catch { return null; }
};

// state: uptodate | available (can install) | blocked (newer exists, but this folder can't fast-forward) |
//        unconfigured | not-git | error
export async function check(root = ROOT, { cfg = readConfig() } = {}) {
  const base = { checkedAt: new Date().toISOString(), branch: cfg.branch };
  const done = (s) => { const st = { ...base, ...s }; saveStatus(st); return st; };
  if (!fs.existsSync(path.join(root, ".git"))) return done({ state: "not-git", reason: "This folder is not a git checkout, so it can't update itself. Run start.bat from an empty folder to install an updatable copy." });
  if ((await tryGit(root, ["--version"])) == null) return done({ state: "error", reason: "git not found" });
  const origin = await tryGit(root, ["remote", "get-url", "origin"]);
  const source = cfg.repoUrl || origin;
  if (!source) return done({ state: "unconfigured", reason: "No repo URL set (REPO_URL in start.bat or data/launcher.cfg) and no origin remote." });
  const ref = UPDATE_REF(cfg.branch);
  try {
    await git(root, ["fetch", "--quiet", "--no-tags", source, `+refs/heads/${cfg.branch}:${ref}`]);
  } catch (e) {
    return done({ state: "error", source, reason: `Fetch failed: ${e.message}` });
  }
  const [local, remote, current, dirtyTxt] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]), git(root, ["rev-parse", ref]),
    tryGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]), tryGit(root, ["status", "--porcelain", "--untracked-files=no"]),
  ]);
  const [behind, ahead] = (await git(root, ["rev-list", "--left-right", "--count", `${ref}...HEAD`])).split(/\s+/).map(Number);
  const log = behind ? await git(root, ["log", "--format=%h%x09%cs%x09%s", "-n", "20", `HEAD..${ref}`]) : "";
  const commits = log ? log.split("\n").map((l) => { const [sha, date, subject] = l.split("\t"); return { sha, date, subject }; }) : [];
  const dirty = !!dirtyTxt;
  const s = {
    source, local: local.slice(0, 10), remote: remote.slice(0, 10), currentBranch: current, behind, ahead, dirty, commits,
    localVersion: await versionAt(root, "HEAD"), remoteVersion: behind ? await versionAt(root, ref) : null,
  };
  if (!behind) return done({ ...s, state: "uptodate" });
  const why = current !== cfg.branch ? `branch ${current} is checked out, updates come from ${cfg.branch}` : dirty ? "this folder has local file changes" : ahead ? `this folder has ${ahead} local commit(s)` : null;
  return done({ ...s, state: why ? "blocked" : "available", reason: why });
}

// Fast-forward to the fetched version. Only for state "available" from check().
export async function apply(root = ROOT, status) {
  if (status?.state !== "available") throw new Error(status?.reason || "No update to install");
  await git(root, ["merge", "--ff-only", "--quiet", UPDATE_REF(status.branch)]);
  const st = { ...status, state: "uptodate", appliedAt: new Date().toISOString(), behind: 0, local: status.remote, localVersion: status.remoteVersion || status.localVersion, commits: [] };
  saveStatus(st);
  return st;
}

export function loadStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE(), "utf8")); } catch { return null; }
}
function saveStatus(s) {
  try { fs.writeFileSync(STATUS_FILE(), JSON.stringify(s, null, 2)); } catch { /* read-only data dir: status stays in memory */ }
}

// Server side: check once per checkHours (default daily, also across restarts via data/update-status.json).
// onChange(status) runs after every check.
export function schedule({ root = ROOT, onChange = () => {}, tickMs = 60 * 60e3, firstMs = 30e3 } = {}) {
  let busy = false;
  const due = () => {
    const last = Date.parse(loadStatus()?.checkedAt || 0) || 0;
    return Date.now() - last >= readConfig().checkHours * 3600e3;
  };
  const tick = async () => {
    if (busy || !due()) return;
    busy = true;
    try { onChange(await check(root)); } catch { /* next tick */ } finally { busy = false; }
  };
  const first = setTimeout(tick, firstMs);
  const every = setInterval(tick, tickMs);
  first.unref?.();
  every.unref?.();
  return () => { clearTimeout(first); clearInterval(every); };
}
