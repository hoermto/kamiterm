import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const esc = (v) => v.replace(/\./g, '\\.');

test('Terminal-Version: nur package.json; Lockfile und CHANGELOG passen, keine zweite Quelle', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, pkg.version, 'package-lock.json: npm version x.y.z --no-git-tag-version');
  assert.equal(lock.packages?.['']?.version, pkg.version);
  assert.match(read('CHANGELOG.md'), new RegExp(`^## \\[?${esc(pkg.version)}`, 'm'));
  // Die UI bekommt die Version vom Server (/js/version.js aus package.json), nicht aus einer Datei.
  assert.equal(fs.existsSync(new URL('../public/js/version.js', import.meta.url)), false);
  assert.match(read('server.js'), /p === "\/js\/version\.js"[\s\S]{0,300}APP_VERSION = \$\{JSON\.stringify\(VERSION\)\}/);
  assert.match(read('public/index.html'), /id="appVer"[^>]*><\/span>/, 'keine feste Nummer in der Kopfzeile');
});
