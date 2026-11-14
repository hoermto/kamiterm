import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { check, apply, parseCfg, readConfig, repoEndpoints, saveConfig, validateConfig } from '../lib/updater.js';

// Real git repos in a temp dir: "remote" (bare), "app" (the install) and "dev" (publishes new versions).
let tmp, remote, app, dev;
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (dir, file, text, msg) => { fs.writeFileSync(path.join(dir, file), text); g(dir, 'add', '.'); g(dir, 'commit', '-q', '-m', msg); };
let hasGit = true;
try { execFileSync('git', ['--version']); } catch { hasGit = false; }

before(() => {
  if (!hasGit) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-upd-'));
  remote = path.join(tmp, 'remote.git'); app = path.join(tmp, 'app'); dev = path.join(tmp, 'dev');
  g(tmp, 'init', '-q', '--bare', '-b', 'master', remote);
  g(tmp, 'clone', '-q', remote, dev);
  for (const d of [dev]) { g(d, 'config', 'user.email', 't@example.invalid'); g(d, 'config', 'user.name', 'T'); g(d, 'checkout', '-q', '-b', 'master'); }
  commit(dev, 'package.json', JSON.stringify({ version: '1.2.0' }), 'v1.2.0');
  g(dev, 'push', '-q', 'origin', 'master');
  g(tmp, 'clone', '-q', '-b', 'master', remote, app);
  g(app, 'config', 'user.email', 't@example.invalid'); g(app, 'config', 'user.name', 'T');
});
after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const cfg = () => ({ repoUrl: remote, branch: 'master', checkHours: 24 });

test('parseCfg / readConfig: file beats environment', () => {
  assert.deepEqual(parseCfg('# x\nREPO_URL = "https://h/r.git"\nbranch=main\n\nbad line'), { REPO_URL: 'https://h/r.git', BRANCH: 'main' });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-cfg-'));
  assert.equal(readConfig({ dataDir: d, env: { AMBER_REPO_URL: 'u1', AMBER_BRANCH: 'b1' } }).repoUrl, 'u1');
  fs.writeFileSync(path.join(d, 'launcher.cfg'), 'REPO_URL=u2\nUPDATE_CHECK_HOURS=6\n');
  const c = readConfig({ dataDir: d, env: { AMBER_REPO_URL: 'u1', AMBER_BRANCH: 'b1' } });
  assert.deepEqual(c, { repoUrl: 'u2', repoFrom: 'settings', branch: 'b1', branchFrom: 'start.bat', checkHours: 6 });
  fs.rmSync(d, { recursive: true, force: true });
});

test('check: up to date, then a new commit is available and applied', { skip: !hasGit }, async () => {
  assert.equal((await check(app, { cfg: cfg() })).state, 'uptodate');
  commit(dev, 'package.json', JSON.stringify({ version: '1.2.1' }), 'Fix something');
  g(dev, 'push', '-q', 'origin', 'master');
  const st = await check(app, { cfg: cfg() });
  assert.equal(st.state, 'available');
  assert.equal(st.behind, 1);
  assert.equal(st.remoteVersion, '1.2.1');
  assert.equal(st.commits[0].subject, 'Fix something');
  const done = await apply(app, st);
  assert.equal(done.localVersion, '1.2.1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version, '1.2.1');
  assert.equal((await check(app, { cfg: cfg() })).state, 'uptodate');
});

test('check: local edits or local commits block the update, nothing is changed', { skip: !hasGit }, async () => {
  commit(dev, 'b.txt', 'b', 'Another');
  g(dev, 'push', '-q', 'origin', 'master');
  fs.writeFileSync(path.join(app, 'package.json'), '{"version":"local-edit"}');
  let st = await check(app, { cfg: cfg() });
  assert.equal(st.state, 'blocked');
  assert.match(st.reason, /local file changes/);
  await assert.rejects(apply(app, st));
  assert.equal(fs.readFileSync(path.join(app, 'package.json'), 'utf8'), '{"version":"local-edit"}');
  g(app, 'checkout', '-q', '--', 'package.json');
  commit(app, 'mine.txt', 'x', 'Local work');
  st = await check(app, { cfg: cfg() });
  assert.equal(st.state, 'blocked');
  assert.match(st.reason, /1 local commit/);
});

test('check: unreachable repo (git) / repo URL that is not http (no .git)', { skip: !hasGit }, async () => {
  const st = await check(app, { cfg: { ...cfg(), repoUrl: path.join(tmp, 'missing.git') } });
  assert.equal(st.state, 'error');
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-plain-'));
  const st2 = await check(plain, { cfg: cfg(), dataDir: plain });
  assert.equal(st2.mode, 'http');
  assert.equal(st2.state, 'error');
  fs.rmSync(plain, { recursive: true, force: true });
});

test('repoEndpoints: Gitea and GitHub addresses from the clone URL', () => {
  const g = repoEndpoints('http://192.168.0.25:4000/home/amber-terminal.git');
  assert.equal(g.kind, 'gitea');
  assert.equal(g.web, 'http://192.168.0.25:4000/home/amber-terminal');
  assert.equal(g.branchUrl('master'), 'http://192.168.0.25:4000/api/v1/repos/home/amber-terminal/branches/master');
  assert.equal(g.archiveUrl('abc'), 'http://192.168.0.25:4000/home/amber-terminal/archive/abc.zip');
  assert.equal(g.headOf({ commit: { id: 'x1' } }), 'x1');
  assert.equal(repoEndpoints('https://h.example/git/o/r/').api, 'https://h.example/git/api/v1/repos/o/r');
  const h = repoEndpoints('https://github.com/hoermto/kamiterm.git');
  assert.equal(h.kind, 'github');
  assert.equal(h.branchUrl('master'), 'https://api.github.com/repos/hoermto/kamiterm/branches/master');
  assert.equal(h.rawUrl('abc', 'package.json'), 'https://raw.githubusercontent.com/hoermto/kamiterm/abc/package.json');
  assert.equal(h.archiveUrl('abc'), 'https://github.com/hoermto/kamiterm/archive/abc.zip');
  assert.equal(h.headOf({ commit: { sha: 's1' } }), 's1');
  assert.throws(() => repoEndpoints('file:///c/repos/x.git'));
});

test('SETTINGS > Updates: saveConfig keeps other lines, empty removes; readConfig says where values come from', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-cfg2-'));
  const env = { AMBER_REPO_URL: 'https://github.com/a/b.git' };
  assert.equal(readConfig({ dataDir: d, env: {} }).repoFrom, 'default');
  assert.equal(readConfig({ dataDir: d, env }).repoFrom, 'start.bat');
  fs.writeFileSync(path.join(d, 'launcher.cfg'), '# mine\r\nAPP_WINDOW=0\r\n');
  saveConfig({ repoUrl: 'http://h:4000/o/r.git', branch: 'rel-2' }, { dataDir: d });
  let c = readConfig({ dataDir: d, env });
  assert.deepEqual([c.repoUrl, c.repoFrom, c.branch, c.branchFrom], ['http://h:4000/o/r.git', 'settings', 'rel-2', 'settings']);
  const txt = fs.readFileSync(path.join(d, 'launcher.cfg'), 'utf8');
  assert.match(txt, /# mine\r\nAPP_WINDOW=0\r\nREPO_URL=http:\/\/h:4000\/o\/r\.git\r\nBRANCH=rel-2\r\n$/);
  saveConfig({ repoUrl: '', branch: '' }, { dataDir: d });
  c = readConfig({ dataDir: d, env });
  assert.deepEqual([c.repoUrl, c.repoFrom, c.branch], ['https://github.com/a/b.git', 'start.bat', 'master']);
  assert.match(fs.readFileSync(path.join(d, 'launcher.cfg'), 'utf8'), /APP_WINDOW=0/);
  assert.equal(validateConfig({ repoUrl: 'ftp://x/y/z' }) !== null, true);
  assert.equal(validateConfig({ branch: 'bad branch' }) !== null, true);
  assert.equal(validateConfig({ repoUrl: 'https://github.com/hoermto/kamiterm.git', branch: 'master' }), null);
  fs.rmSync(d, { recursive: true, force: true });
});

// A Gitea-like web API answered from the "dev" repo: branches, commits, raw files, ZIP archives.
function fakeGitea(repoDir) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(body), text: async () => String(body), arrayBuffer: async () => body });
    let m;
    if ((m = u.pathname.match(/\/api\/v1\/repos\/o\/app\/branches\/(.+)$/))) return ok(JSON.stringify({ commit: { id: g(repoDir, 'rev-parse', `refs/heads/${m[1]}`) } }));
    if (u.pathname.endsWith('/api/v1/repos/o/app/commits')) {
      const lines = g(repoDir, 'log', '--format=%H%x09%cI%x09%s', '-n', '30', u.searchParams.get('sha')).split('\n');
      return ok(JSON.stringify(lines.map((l) => { const [sha, date, message] = l.split('\t'); return { sha, commit: { message, committer: { date } } }; })));
    }
    if ((m = u.pathname.match(/\/o\/app\/raw\/commit\/([0-9a-f]+)\/(.+)$/))) return ok(g(repoDir, 'show', `${m[1]}:${m[2]}`));
    if ((m = u.pathname.match(/\/o\/app\/archive\/([0-9a-f]+)\.zip$/))) {
      const buf = execFileSync('git', ['archive', '--format=zip', '--prefix=app/', m[1]], { cwd: repoDir });
      return ok(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
    return { ok: false, status: 404 };
  };
  return { fetchImpl, calls };
}

test('http mode (no .git): unknown ZIP copy is installed, then updates add and delete files, data/ is kept', { skip: !hasGit }, async () => {
  commit(dev, 'server.js', '// v1', 'server');
  g(dev, 'push', '-q', 'origin', 'master');
  const zipApp = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-zipapp-'));
  const data = path.join(zipApp, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'keep.txt'), 'mine');
  fs.writeFileSync(path.join(zipApp, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  const { fetchImpl } = fakeGitea(dev);
  const hcfg = { repoUrl: 'http://repo.test:4000/o/app.git', branch: 'master', checkHours: 24 };
  const opts = { cfg: hcfg, dataDir: data, fetchImpl };

  let st = await check(zipApp, opts);
  assert.equal(st.mode, 'http');
  assert.equal(st.state, 'available');
  assert.equal(st.behind, null); // never installed by the updater: version unknown
  assert.equal(st.localVersion, '1.0.0');
  await apply(zipApp, st, opts);
  assert.equal(JSON.parse(fs.readFileSync(path.join(zipApp, 'package.json'), 'utf8')).version, '1.2.1');
  assert.equal(fs.readFileSync(path.join(data, 'keep.txt'), 'utf8'), 'mine');
  assert.equal(fs.existsSync(path.join(zipApp, '.git')), false);
  assert.equal((await check(zipApp, opts)).state, 'uptodate');

  // Next version: one file added, one removed.
  commit(dev, 'added.txt', 'new', 'add a file');
  g(dev, 'rm', '-q', 'server.js'); fs.writeFileSync(path.join(dev, 'server.js'), '// v2'); g(dev, 'add', '.'); g(dev, 'commit', '-q', '-m', 'server v2');
  g(dev, 'rm', '-q', 'added.txt'); commit(dev, 'other.txt', 'x', 'swap file');
  g(dev, 'push', '-q', 'origin', 'master');
  st = await check(zipApp, opts);
  assert.equal(st.state, 'available');
  assert.equal(st.behind, 3);
  assert.deepEqual(st.commits.map((c) => c.subject), ['swap file', 'server v2', 'add a file']);
  await apply(zipApp, st, opts);
  assert.equal(fs.readFileSync(path.join(zipApp, 'server.js'), 'utf8'), '// v2');
  assert.equal(fs.existsSync(path.join(zipApp, 'other.txt')), true);
  assert.equal(fs.existsSync(path.join(zipApp, 'added.txt')), false);
  assert.equal(fs.readFileSync(path.join(data, 'keep.txt'), 'utf8'), 'mine');
  assert.equal((await check(zipApp, opts)).state, 'uptodate');
  fs.rmSync(zipApp, { recursive: true, force: true });
});
