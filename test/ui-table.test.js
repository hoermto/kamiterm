import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clipText, table } from '../public/js/ui.js';

// Minimal document so table() can run in Node without a browser or jsdom.
if (!globalThis.document) {
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.className = '';
      this.innerHTML = '';
    }
    addEventListener() {}
    querySelector() { return this; }
  }
  globalThis.document = { createElement: (tag) => new El(tag) };
}

test('clipText: short strings stay intact, long ones get an ellipsis and the full title', () => {
  assert.deepEqual(clipText('abc', 20), { text: 'abc', clipped: false });
  assert.deepEqual(clipText('abcdefghijklmnopqrstuvwxyz', 8), {
    text: 'abcdefgh…',
    clipped: true,
    title: 'abcdefghijklmnopqrstuvwxyz',
  });
  assert.equal(clipText(null, 5).text, '');
  assert.equal(clipText('', 5).clipped, false);
});

test('table(): short:n truncates a plain-text cell and sets title to the full text', () => {
  const long = 'Trailing-Stop −20 % vom Hoch (Hoch 48,86, Close 38,22)';
  const clip = clipText(long, 20);
  assert.equal(clip.clipped, true);
  const el = table([{ note: long, ok: 'kurz' }], [
    { key: 'note', label: 'Notiz', left: true, short: 20 },
    { key: 'ok', label: 'Ok', short: 20 },
  ]);
  assert.match(el.innerHTML, new RegExp(`>${clip.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`));
  assert.match(el.innerHTML, /title="Trailing-Stop −20 % vom Hoch \(Hoch 48,86, Close 38,22\)"/);
  assert.match(el.innerHTML, />kurz</);
  assert.doesNotMatch(el.innerHTML, /title="kurz"/);
});

test('table(): html:true columns are not truncated even with short:n', () => {
  const html = '<span title="full reason">kept as-is and quite long actually</span>';
  const el = table([{ x: 1 }], [
    { key: 'x', label: 'X', html: true, short: 4, fmt: () => html },
  ]);
  assert.match(el.innerHTML, /kept as-is and quite long actually/);
  assert.match(el.innerHTML, /title="full reason"/);
  assert.doesNotMatch(el.innerHTML, /…/);
});

test('table(): special characters in the full text are escaped in title', () => {
  const el = table([{ note: 'A & B <C> "q" \'x\' 123456789' }], [
    { key: 'note', label: 'Notiz', short: 8 },
  ]);
  assert.match(el.innerHTML, /title="A &amp; B &lt;C&gt; &quot;q&quot; &#39;x&#39; 123456789"/);
});

test('table(): missing values stay as an em-dash and are not clipped', () => {
  const el = table([{ note: null }, { note: 'abcd' }], [
    { key: 'note', label: 'Notiz', short: 4 },
  ]);
  assert.match(el.innerHTML, />—</);
  assert.match(el.innerHTML, />abcd</);
  assert.doesNotMatch(el.innerHTML, /title="—"/);
  assert.doesNotMatch(el.innerHTML, /abcd…/);
});

test('RSL tables shorten Notiz, Grund and M&A status and keep the full text as a tooltip', () => {
  const src = fs.readFileSync(new URL('../public/js/fn/grokki.js', import.meta.url), 'utf8');
  assert.match(src, /short:20/, 'Notiz columns use short:20');
  assert.match(src, /short:22/, 'RRG Name uses short:22');
  assert.match(src, /function shortReason/, 'Trade-log reasons share the Exit-Hinweis short labels');
  assert.match(src, /function reasonCell/);
  assert.match(src, /fmt:reasonCell/);
  assert.match(src, /M&amp;A-Skip/);
  assert.match(src, /qCol\('quadrant','Quadrant',Q_TIP\)/);
});
