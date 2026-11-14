// Updates from the repo: used by the Windows starter (scripts/update.js --apply, on every start) and by the
// running server (daily check, warning in the top bar). data/ is never touched (settings, holdings, caches).
//
// Two ways, picked by the folder:
//   no .git (installed from a ZIP or by start.bat)  "http": asks the repo server's web API (GitHub, or
//       Gitea/Forgejo) for the branch's newest commit, compares it with data/installed.json and installs by
//       downloading that commit as a ZIP. Needs neither git nor .git.
//   a git checkout (development)  "git": fetch into a private ref + fast-forward only. A folder with local edits,
//       local commits or another branch checked out is never changed, only reported. Its remotes stay as they are.
//
// Where to update from, first match wins:
//   data/launcher.cfg   REPO_URL=… / BRANCH=… / UPDATE_CHECK_HOURS=…   (per machine, survives updates;
//                       SETTINGS > Updates writes REPO_URL and BRANCH here)
//   environment         AMBER_REPO_URL / AMBER_BRANCH                  (set by start.bat)
//   a git checkout's "origin" remote
//   DEFAULT_REPO_URL, branch "master"
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./store.js";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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

export const DEFAULT_REPO_URL = "https://github.com/hoermto/kamiterm.git";
export const DEFAULT_BRANCH = "master";

export function readConfig({ dataDir = DATA_DIR, env = process.env } = {}) {
  let file = {};
  try { file = parseCfg(fs.readFileSync(path.join(dataDir, "launcher.cfg"), "utf8")); } catch { /* optional */ }
  const hours = Number(file.UPDATE_CHECK_HOURS ?? env.AMBER_UPDATE_CHECK_HOURS ?? 24);
  const fileUrl = (file.REPO_URL || "").trim(), envUrl = (env.AMBER_REPO_URL || "").trim();
  return {
    repoUrl: fileUrl || envUrl,
    repoFrom: fileUrl ? "settings" : envUrl ? "start.bat" : "default",
    branch: (file.BRANCH || env.AMBER_BRANCH || DEFAULT_BRANCH).trim(),
    branchFrom: file.BRANCH ? "settings" : env.AMBER_BRANCH ? "start.bat" : "default",
    checkHours: Number.isFinite(hours) && hours > 0 ? hours : 24,
  };
}

// SETTINGS > Updates: write REPO_URL / BRANCH into data/launcher.cfg, keeping its other lines and comments.
// An empty value removes the key (back to start.bat's value or the default).
export function saveConfig({ repoUrl, branch } = {}, { dataDir = DATA_DIR } = {}) {
  const file = path.join(dataDir, "launcher.cfg");
  let lines = [];
  try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch { /* new file */ }
  const set = (key, value) => {
    if (value === undefined) return;
    const v = String(value).trim();
    const re = new RegExp(`^\\s*${key}\\s*=`, "i");
    const i = lines.findIndex((l) => re.test(l) && !l.trim().startsWith("#"));
    if (!v) { if (i >= 0) lines.splice(i, 1); return; }
    if (i >= 0) lines[i] = `${key}=${v}`;
    else lines.splice(lines.length && lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${key}=${v}`);
  };
  set("REPO_URL", repoUrl);
  set("BRANCH", branch);
  const text = lines.join("\r\n").replace(/^(\r\n)+/, "");
  fs.writeFileSync(file, text.endsWith("\r\n") || !text ? text : `${text}\r\n`);
}

// Checks a URL / branch typed in SETTINGS; returns an error text or null.
export function validateConfig({ repoUrl, branch } = {}) {
  if (repoUrl) { try { repoEndpoints(repoUrl); } catch (e) { return e.message; } }
  if (branch && !/^[\w.\-/]{1,100}$/.test(branch)) return `Invalid branch name: ${branch}`;
  return null;
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
//        error
export async function check(root = ROOT, { cfg = readConfig(), dataDir = DATA_DIR, fetchImpl = globalThis.fetch } = {}) {
  const base = { checkedAt: new Date().toISOString(), branch: cfg.branch };
  const done = (s) => { const st = { ...base, ...s }; saveStatus(st, dataDir); return st; };
  if (!fs.existsSync(path.join(root, ".git"))) return httpCheck(root, { cfg, dataDir, fetchImpl, done });
  if ((await tryGit(root, ["--version"])) == null) return done({ state: "error", reason: "git not found" });
  const origin = await tryGit(root, ["remote", "get-url", "origin"]);
  const source = cfg.repoUrl || origin || DEFAULT_REPO_URL;
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
    mode: "git", source, local: local.slice(0, 10), remote: remote.slice(0, 10), currentBranch: current, behind, ahead, dirty, commits,
    localVersion: await versionAt(root, "HEAD"), remoteVersion: behind ? await versionAt(root, ref) : null,
  };
  if (!behind) return done({ ...s, state: "uptodate" });
  const why = current !== cfg.branch ? `branch ${current} is checked out, updates come from ${cfg.branch}` : dirty ? "this folder has local file changes" : ahead ? `this folder has ${ahead} local commit(s)` : null;
  return done({ ...s, state: why ? "blocked" : "available", reason: why });
}

// Install the version found by check(). Only for state "available".
// git: fast-forward. http: download the commit's ZIP and copy it over the app folder.
export async function apply(root = ROOT, status, { dataDir = DATA_DIR, fetchImpl = globalThis.fetch } = {}) {
  if (status?.state !== "available") throw new Error(status?.reason || "No update to install");
  if (status.mode === "http") await httpApply(root, status, { dataDir, fetchImpl });
  else await git(root, ["merge", "--ff-only", "--quiet", UPDATE_REF(status.branch)]);
  const st = { ...status, state: "uptodate", appliedAt: new Date().toISOString(), behind: 0, local: status.remote, localVersion: status.remoteVersion || status.localVersion, commits: [] };
  saveStatus(st, dataDir);
  return st;
}

// ---- http mode: the repo server's web API, no git needed ----

// The repo server's web addresses for one repo.
//   GitHub:        https://github.com/<owner>/<repo>.git  -> api.github.com, raw.githubusercontent.com, github.com/.../archive
//   Gitea/Forgejo: http://host:4000/home/amber-terminal.git -> http://host:4000/api/v1/repos/home/amber-terminal
//                  (a server under a sub-path keeps its prefix)
export function repoEndpoints(repoUrl) {
  const u = new URL(String(repoUrl).trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error(`REPO_URL must be http(s) for updates without git: ${repoUrl}`);
  const parts = u.pathname.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`REPO_URL needs owner and repo: ${repoUrl}`);
  const [owner, repo] = parts.slice(-2).map(encodeURIComponent);
  const b = encodeURIComponent;
  if (/^(www\.)?github\.com$/i.test(u.hostname)) {
    const api = `https://api.github.com/repos/${owner}/${repo}`;
    return {
      kind: "github",
      web: `https://github.com/${owner}/${repo}`,
      api,
      branchUrl: (branch) => `${api}/branches/${b(branch)}`,
      headOf: (json) => json?.commit?.sha,
      commitsUrl: (sha) => `${api}/commits?sha=${b(sha)}&per_page=30`,
      rawUrl: (sha, file) => `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${file}`,
      archiveUrl: (sha) => `https://github.com/${owner}/${repo}/archive/${sha}.zip`,
    };
  }
  const prefix = parts.slice(0, -2).map((p) => `/${p}`).join("");
  const origin = `${u.protocol}//${u.host}${prefix}`;
  const web = `${origin}/${owner}/${repo}`;
  const api = `${origin}/api/v1/repos/${owner}/${repo}`;
  return {
    kind: "gitea",
    web,
    api,
    branchUrl: (branch) => `${api}/branches/${b(branch)}`,
    headOf: (json) => json?.commit?.id,
    commitsUrl: (sha) => `${api}/commits?sha=${b(sha)}&limit=30&stat=false&verification=false&files=false`,
    rawUrl: (sha, file) => `${web}/raw/commit/${sha}/${file}`,
    archiveUrl: (sha) => `${web}/archive/${sha}.zip`,
  };
}

const INSTALLED = (dataDir) => path.join(dataDir, "installed.json");
export function loadInstalled(dataDir = DATA_DIR) {
  try { return JSON.parse(fs.readFileSync(INSTALLED(dataDir), "utf8")); } catch { return null; }
}

async function getHttp(fetchImpl, url, kind = "json") {
  // GitHub's API refuses requests without a User-Agent.
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(60e3), redirect: "follow", headers: { accept: kind === "json" ? "application/json" : "*/*", "user-agent": "amber-terminal-updater" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return kind === "json" ? r.json() : kind === "text" ? r.text() : Buffer.from(await r.arrayBuffer());
}

const localVersionOf = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version; } catch { return null; } };

async function httpCheck(root, { cfg, dataDir, fetchImpl, done }) {
  const source = cfg.repoUrl || DEFAULT_REPO_URL;
  let ep;
  try { ep = repoEndpoints(source); } catch (e) { return done({ mode: "http", state: "error", source, reason: e.message }); }
  const inst = loadInstalled(dataDir);
  const s = { mode: "http", source, local: inst?.commit?.slice(0, 10) || null, currentBranch: inst?.branch || null, ahead: 0, dirty: false, localVersion: localVersionOf(root) };
  let head, list;
  try {
    const br = await getHttp(fetchImpl, ep.branchUrl(cfg.branch));
    head = ep.headOf(br);
    if (!head) throw new Error(`branch ${cfg.branch} not found`);
    list = await getHttp(fetchImpl, ep.commitsUrl(head)).catch(() => []);
  } catch (e) {
    return done({ ...s, state: "error", reason: `Repo not reachable: ${e.message}` });
  }
  s.remote = head.slice(0, 10);
  if (inst?.commit === head) return done({ ...s, behind: 0, commits: [], state: "uptodate" });
  const newer = [];
  let found = false;
  for (const c of Array.isArray(list) ? list : []) {
    if (c.sha === inst?.commit) { found = true; break; }
    newer.push({ sha: c.sha.slice(0, 7), date: String(c.commit?.committer?.date || c.created || "").slice(0, 10), subject: String(c.commit?.message || "").split("\n")[0] });
  }
  const remoteVersion = await getHttp(fetchImpl, ep.rawUrl(head, "package.json"), "text").then((t) => JSON.parse(t).version).catch(() => null);
  return done({
    ...s, state: "available", head, archive: ep.archiveUrl(head), remoteVersion,
    behind: found ? newer.length : null, // null: unknown (ZIP download, other branch, or more than 30 commits back)
    commits: newer.slice(0, 20),
  });
}

// Never written from the archive: user data, portable runtimes, a git checkout.
const KEEP_TOP = new Set(["data", ".runtime", ".git"]);

function unzip(zip, dest) {
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  const tries = [[tar, ["-xf", zip, "-C", dest]], ["unzip", ["-q", "-o", zip, "-d", dest]]];
  for (const [cmd, args] of tries) {
    if (spawnSync(cmd, args, { windowsHide: true, stdio: "ignore" }).status === 0) return;
  }
  throw new Error("Could not unpack the update (tar or unzip needed)");
}

function listFiles(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && KEEP_TOP.has(e.name)) continue;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

async function httpApply(root, status, { dataDir, fetchImpl }) {
  const tmp = fs.mkdtempSync(path.join(dataDir, "update-"));
  try {
    const zip = path.join(tmp, "app.zip");
    fs.writeFileSync(zip, await getHttp(fetchImpl, status.archive, "bin"));
    const out = path.join(tmp, "x");
    fs.mkdirSync(out);
    unzip(zip, out);
    const top = fs.readdirSync(out, { withFileTypes: true });
    const src = top.length === 1 && top[0].isDirectory() ? path.join(out, top[0].name) : out;
    if (!fs.existsSync(path.join(src, "package.json")) || !fs.existsSync(path.join(src, "server.js"))) throw new Error("The download is not an Amber Terminal archive");
    const files = listFiles(src);
    for (const f of files) {
      const to = path.join(root, f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(src, f), to);
    }
    // Files the previous update installed that the new version no longer has.
    const prev = loadInstalled(dataDir)?.files || [];
    const now = new Set(files);
    for (const f of prev) {
      if (now.has(f) || KEEP_TOP.has(f.split("/")[0])) continue;
      try { fs.rmSync(path.join(root, f), { force: true }); } catch { /* in use: harmless leftover */ }
    }
    fs.writeFileSync(INSTALLED(dataDir), JSON.stringify({ commit: status.head, branch: status.branch, source: status.source, version: status.remoteVersion, installedAt: new Date().toISOString(), files }, null, 2));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function loadStatus(dataDir = DATA_DIR) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, "update-status.json"), "utf8")); } catch { return null; }
}
function saveStatus(s, dataDir = DATA_DIR) {
  try { fs.writeFileSync(path.join(dataDir, "update-status.json"), JSON.stringify(s, null, 2)); } catch { /* read-only data dir: status stays in memory */ }
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
