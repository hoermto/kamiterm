import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_VERSION } from '../public/js/version.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Terminal-Version: package.json, UI-Konstante, Kopfzeile und CHANGELOG stimmen überein', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(APP_VERSION, pkg.version);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp(`id="appVer"[^>]*>v${pkg.version.replace(/\./g, '\\.')}<`));
  const cl = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(cl, new RegExp(`^## \\[?${pkg.version.replace(/\./g, '\\.')}`, 'm'));
});
