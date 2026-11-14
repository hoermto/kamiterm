import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { unzipBuffer } from '../lib/unzip.js';

let hasGit = true;
try { execFileSync('git', ['--version']); } catch { hasGit = false; }

// One-entry ZIP built by hand: lets the test use names git would never write.
function zipOf(name, text, { method = 8 } = {}) {
  const data = Buffer.from(text);
  const comp = method === 8 ? zlib.deflateRawSync(data) : data;
  const n = Buffer.from(name);
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(method, 8); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(method, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42);
  const body = Buffer.concat([loc, n, comp]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cen, n, end]);
}

test('unzipBuffer: stored and deflated entries', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-unzip-'));
  unzipBuffer(zipOf('top/a.txt', 'hello'), d);
  unzipBuffer(zipOf('top/b.txt', 'plain', { method: 0 }), d);
  assert.equal(fs.readFileSync(path.join(d, 'top', 'a.txt'), 'utf8'), 'hello');
  assert.equal(fs.readFileSync(path.join(d, 'top', 'b.txt'), 'utf8'), 'plain');
  fs.rmSync(d, { recursive: true, force: true });
});

test('unzipBuffer: refuses paths outside the target and non-ZIP data', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-unzip-'));
  assert.throws(() => unzipBuffer(zipOf('../evil.txt', 'x'), d), /Unsafe path/);
  assert.equal(fs.existsSync(path.join(d, '..', 'evil.txt')), false);
  assert.throws(() => unzipBuffer(Buffer.from('not a zip at all, just text'), d), /Not a ZIP/);
  fs.rmSync(d, { recursive: true, force: true });
});

test('unzipBuffer: a git archive (with comment) unpacks byte for byte', { skip: !hasGit }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-unzip-'));
  const zip = execFileSync('git', ['archive', '--format=zip', '--prefix=app/', 'HEAD', 'package.json', 'server.js'], { cwd: new URL('..', import.meta.url) });
  const files = unzipBuffer(zip, d);
  assert.ok(files.includes('app/package.json'));
  const head = execFileSync('git', ['show', 'HEAD:package.json'], { cwd: new URL('..', import.meta.url) });
  assert.deepEqual(fs.readFileSync(path.join(d, 'app', 'package.json')), head);
  fs.rmSync(d, { recursive: true, force: true });
});
