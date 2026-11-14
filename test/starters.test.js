import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('start.command (macOS) is the same script as start.sh (Linux)', () => {
  assert.equal(read('start.command'), read('start.sh'));
});

test('shell starters: LF only, whole body in one { } block (safe against self-update)', () => {
  const s = read('start.sh');
  assert.equal(s.includes('\r'), false);
  assert.match(s, /^#!\/bin\/sh\n/);
  assert.match(s, /\n\{\n[\s\S]*\n\}\n$/);
});

test('default update repo is the same in start.sh, start.bat and the updater', async () => {
  const { DEFAULT_REPO_URL } = await import('../lib/updater.js');
  assert.match(read('start.sh'), new RegExp(`REPO_URL_DEFAULT="${DEFAULT_REPO_URL.replace(/\./g, '\.')}"`));
  assert.match(read('start.bat'), new RegExp(`AMBER_REPO_URL=${DEFAULT_REPO_URL.replace(/\./g, '\.')}"`));
});
