import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.QT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-contact-'));
const { validateContact, getContact, hasContact, saveContact, secHeaders } = await import('../lib/sec-contact.js');

test('validateContact: empty is allowed, anything but an email is not', () => {
  assert.equal(validateContact(''), '');
  assert.equal(validateContact('  name@example.com '), '');
  assert.match(validateContact('name'), /email/);
  assert.match(validateContact('a b@example.com'), /email/);
  assert.match(validateContact('<x@example.com>'), /email/);
  assert.match(validateContact('x@'.padEnd(130, 'a') + '.com'), /At most/);
});

test('without a contact the generic name is sent', () => {
  assert.equal(getContact(), '');
  assert.equal(hasContact(), false);
  assert.match(secHeaders()['User-Agent'], /^AmberTerminal\/1\.0 \(\+https:/);
});

test('a saved contact goes into the User-Agent; empty removes it', () => {
  assert.equal(saveContact(' me@example.org '), 'me@example.org');
  assert.equal(hasContact(), true);
  assert.equal(secHeaders()['User-Agent'], 'AmberTerminal/1.0 me@example.org');
  assert.throws(() => saveContact('not an email'), (e) => e.status === 400);
  assert.equal(getContact(), 'me@example.org');
  saveContact('');
  assert.equal(hasContact(), false);
});

test('no personal email address is written in the code', () => {
  const root = path.join(import.meta.dirname, '..');
  const files = ['lib/ma-edgar.js', 'lib/sec-contact.js', 'lib/fn/cf.js', 'EXTENSIONS.md'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    const mails = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [])
      .map((m) => m.replace(/\.+$/, ''))
      .filter((m) => !/@example\.(com|org)$/.test(m));
    assert.deepEqual(mails, [], f);
  }
});
