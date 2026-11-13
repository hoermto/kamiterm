import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { check, apply, parseCfg, readConfig } from '../lib/updater.js';

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
  assert.deepEqual(c, { repoUrl: 'u2', branch: 'b1', checkHours: 6 });
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

test('check: not a git checkout / unreachable repo', { skip: !hasGit }, async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-plain-'));
  assert.equal((await check(plain, { cfg: cfg() })).state, 'not-git');
  fs.rmSync(plain, { recursive: true, force: true });
  const st = await check(app, { cfg: { ...cfg(), repoUrl: path.join(tmp, 'missing.git') } });
  assert.equal(st.state, 'error');
});
