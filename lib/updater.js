// Updates from the repo: used by the Windows starter (scripts/update.js --apply, on every start) and by the
// running server (daily check, warning in the top bar). data/ is never touched (settings, holdings, caches).
//
// Two ways, picked by the folder:
//   no .git (installed from a ZIP or by start.bat)  "http": asks the repo server's web API (Gitea/Forgejo:
//       /api/v1/repos/<owner>/<repo>/branches/<branch>) for the newest commit, compares it with
//       data/installed.json and installs by downloading <repo>/archive/<commit>.zip. Needs neither git nor .git.
//   a git checkout (development)  "git": fetch + fast-forward only. A folder with local edits, local commits or
//       another branch checked out is never changed, only reported.
//
// Where to update from, first match wins:
//   data/launcher.cfg   REPO_URL=… / BRANCH=… / UPDATE_CHECK_HOURS=…   (per machine, survives updates)
//   environment         AMBER_REPO_URL / AMBER_BRANCH                  (defaults set at the top of start.bat)
//   the checkout's "origin" remote, branch "master"
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
//        unconfigured | error
export async function check(root = ROOT, { cfg = readConfig(), dataDir = DATA_DIR, fetchImpl = globalThis.fetch } = {}) {
  const base = { checkedAt: new Date().toISOString(), branch: cfg.branch };
  const done = (s) => { const st = { ...base, ...s }; saveStatus(st, dataDir); return st; };
  if (!fs.existsSync(path.join(root, ".git"))) return httpCheck(root, { cfg, dataDir, fetchImpl, done });
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

// http://host:4000/home/amber-terminal.git -> web http://host:4000/home/amber-terminal,
// api http://host:4000/api/v1/repos/home/amber-terminal (a server under a sub-path keeps its prefix).
export function repoEndpoints(repoUrl) {
  const u = new URL(String(repoUrl).trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error(`REPO_URL must be http(s) for updates without git: ${repoUrl}`);
  const parts = u.pathname.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`REPO_URL needs owner and repo: ${repoUrl}`);
  const [owner, repo] = parts.slice(-2);
  const prefix = parts.slice(0, -2).map((p) => `/${p}`).join("");
  const origin = `${u.protocol}//${u.host}${prefix}`;
  const enc = encodeURIComponent;
  return {
    web: `${origin}/${enc(owner)}/${enc(repo)}`,
    api: `${origin}/api/v1/repos/${enc(owner)}/${enc(repo)}`,
  };
}

const INSTALLED = (dataDir) => path.join(dataDir, "installed.json");
export function loadInstalled(dataDir = DATA_DIR) {
  try { return JSON.parse(fs.readFileSync(INSTALLED(dataDir), "utf8")); } catch { return null; }
}

async function getHttp(fetchImpl, url, kind = "json") {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(60e3), headers: { accept: kind === "json" ? "application/json" : "*/*" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return kind === "json" ? r.json() : kind === "text" ? r.text() : Buffer.from(await r.arrayBuffer());
}

const localVersionOf = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version; } catch { return null; } };

async function httpCheck(root, { cfg, dataDir, fetchImpl, done }) {
  if (!cfg.repoUrl) return done({ mode: "http", state: "unconfigured", reason: "No repo URL set (REPO_URL in start.bat or data/launcher.cfg)." });
  let ep;
  try { ep = repoEndpoints(cfg.repoUrl); } catch (e) { return done({ mode: "http", state: "error", source: cfg.repoUrl, reason: e.message }); }
  const inst = loadInstalled(dataDir);
  const s = { mode: "http", source: cfg.repoUrl, local: inst?.commit?.slice(0, 10) || null, currentBranch: inst?.branch || null, ahead: 0, dirty: false, localVersion: localVersionOf(root) };
  let head, list;
  try {
    const br = await getHttp(fetchImpl, `${ep.api}/branches/${encodeURIComponent(cfg.branch)}`);
    head = br?.commit?.id;
    if (!head) throw new Error(`branch ${cfg.branch} not found`);
    list = await getHttp(fetchImpl, `${ep.api}/commits?sha=${encodeURIComponent(head)}&limit=30&stat=false&verification=false&files=false`).catch(() => []);
  } catch (e) {
    return done({ ...s, state: "error", reason: `Repo not reachable: ${e.message}` });
  }
  s.remote = head.slice(0, 10);
  if (inst?.commit === head) return done({ ...s, behind: 0, commits: [], state: "uptodate" });
  const newer = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (c.sha === inst?.commit) break;
    newer.push({ sha: c.sha.slice(0, 7), date: String(c.commit?.committer?.date || c.created || "").slice(0, 10), subject: String(c.commit?.message || "").split("\n")[0] });
  }
  const remoteVersion = await getHttp(fetchImpl, `${ep.web}/raw/commit/${head}/package.json`, "text").then((t) => JSON.parse(t).version).catch(() => null);
  return done({
    ...s, state: "available", head, archive: `${ep.web}/archive/${head}.zip`, remoteVersion,
    behind: inst?.commit ? newer.length : null, // null: installed version unknown (ZIP download)
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
