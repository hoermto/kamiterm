import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowWatch } from '../lib/window-watch.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('browser-only use never stops the server', async () => {
  let idle = 0;
  const w = windowWatch({ graceMs: 20, onIdle: () => idle++ });
  w.connect(); w.disconnect();
  await wait(60);
  assert.equal(idle, 0);
});

test('app window closed: stops after the grace time', async () => {
  let idle = 0;
  const w = windowWatch({ graceMs: 30, onIdle: () => idle++ });
  w.connect({ app: true }); w.disconnect();
  assert.equal(w.state.pending, true);
  await wait(80);
  assert.equal(idle, 1);
});

test('reload within the grace time keeps it running; a second tab keeps it running', async () => {
  let idle = 0;
  const w = windowWatch({ graceMs: 40, onIdle: () => idle++ });
  w.connect({ app: true });
  w.disconnect(); await wait(10); w.connect({ app: true }); // reload
  await wait(80);
  assert.equal(idle, 0);
  w.connect(); // a browser tab as well
  w.disconnect(); // app window closed, tab still open
  await wait(80);
  assert.equal(idle, 0);
  w.disconnect(); // tab closed too
  await wait(80);
  assert.equal(idle, 1);
});
