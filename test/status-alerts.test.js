// AT-16: Status-Alarme (lib/status-alerts.js) — Basislinie, Dedupe, GSW/RSL-Diffs, Liste/Quittieren, Zeitplan.
import { TEST_DATA_DIR } from './helpers/isolate-data.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sa = await import('../lib/status-alerts.js');

test('Provider ohne empty(): erster Lauf ist Basislinie, danach je Schlüssel genau ein Ereignis', () => {
  const p = { id: 'x', diff: (a, b) => (b.v !== a?.v ? [{ key: `x:${b.v}`, kind: 'gsw', title: 'T', text: `v=${b.v}` }] : []) };
  let r = sa.applySnapshot(sa.emptyState(), p, { v: 1 }, { now: '2026-11-22T10:00:00Z', host: 'h' });
  assert.equal(r.events.length, 0);
  assert.ok(r.state.baseline.x);
  r = sa.applySnapshot(r.state, p, { v: 2 }, { now: '2026-11-22T11:00:00Z', host: 'h' });
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].key, 'x:2');
  assert.equal(r.events[0].ackedAt, null);
  // zurück auf 1 und wieder auf 2: Schlüssel x:2 schon gesehen → kein zweites Ereignis
  r = sa.applySnapshot(r.state, p, { v: 1 }, { now: '2026-11-22T12:00:00Z' });
  const n = r.state.events.length;
  r = sa.applySnapshot(r.state, p, { v: 2 }, { now: '2026-11-22T13:00:00Z' });
  assert.equal(r.events.length, 0);
  assert.equal(r.state.events.length, n);
});

test('ein Fehler im diff bricht nichts ab', () => {
  const p = { id: 'e', diff: () => { throw new Error('kaputt'); } };
  let r = sa.applySnapshot(sa.emptyState(), p, {}, {});
  r = sa.applySnapshot(r.state, p, {}, {});
  assert.match(r.state.errors.e, /kaputt/);
});

test('GSW: fällig, entfallen (aufgeschoben) und gebuchter Swap', () => {
  const lot = (level, target) => ({ symbol: 'EWG2', metal: 'gold', level, target, text: 'Regel → Silber' });
  const a = { asOf: '2026-11-20', dueSince: 'sig2026-11-20', lots: { L1: lot('ok', 'gold') }, swaps: {} };
  const b = { ...a, lots: { L1: lot('due', 'silver') } };
  let ev = sa.gswDiff(a, b);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].key, 'gsw:due:L1:silver:sig2026-11-20');
  assert.equal(ev[0].kind, 'gsw');
  assert.equal(sa.gswDiff(b, { ...b, asOf: '2026-11-21' }).length, 0, 'weiter fällig: kein neues Ereignis');
  const hold = { ...b, lots: { L1: lot('hold', 'silver') } };
  ev = sa.gswDiff(hold, { ...a, asOf: '2026-11-25' });
  assert.equal(ev.length, 1);
  assert.match(ev[0].title, /aufgeschobener Swap entfallen/);
  assert.equal(ev[0].key, 'gsw:lapsed:L1:silver:2026-11-25');
  ev = sa.gswDiff(a, { ...a, swaps: { S1: { date: '2026-11-21', from: '10 EWG2', to: '50 XAD6', fromMetal: 'gold', toMetal: 'silver' } } });
  assert.deepEqual(ev.map((e) => e.key), ['gsw:swap:S1']);
  assert.equal(sa.gswDiff(null, a).length, 0);
});

test('GSW: Swaps aus dem Buch über swapId paaren', () => {
  const m = sa.gswSwaps([
    { symbol: 'EWG2', metal: 'gold', qty: 10, status: 'closed', sellDate: '2026-11-21', sellSwapId: 'S1' },
    { symbol: 'XAD6', metal: 'silver', qty: 50, status: 'open', buyDate: '2026-11-21', buySwapId: 'S1' },
    { symbol: 'EWG2', metal: 'gold', qty: 3, status: 'open', buyDate: '2026-01-02' },
  ]);
  assert.deepEqual(Object.keys(m), ['S1']);
  assert.equal(m.S1.date, '2026-11-21');
  assert.equal(m.S1.fromMetal, 'gold');
  assert.equal(m.S1.toMetal, 'silver');
  assert.match(m.S1.to, /50 XAD6/);
});

test('RSL: Verkaufssignal einmal, neue Kauf-Kandidaten (neu beobachtetes Universum: alle aktuellen)', () => {
  const a = { pos: { p1: { symbol: 'AAPL', universe: 'SPX', signal: false, reason: null, lastDate: '2026-11-20' } }, buy: { SPX: { asOf: '2026-11-20', list: [{ ticker: 'MSFT', rank: 1 }] } } };
  const b = { pos: { p1: { ...a.pos.p1, signal: true, reason: 'Rang-Exit' } },
    buy: { SPX: { asOf: '2026-11-21', list: [{ ticker: 'MSFT', rank: 1 }, { ticker: 'NVDA', rank: 2 }] }, DAX: { asOf: '2026-11-21', list: [{ ticker: 'SAP', rank: 1 }] } } };
  const ev = sa.rslDiff(a, b);
  assert.deepEqual(ev.map((e) => e.key).sort(), ['rsl:buy:DAX:SAP:2026-11-21', 'rsl:buy:SPX:NVDA:2026-11-21', 'rsl:sell:p1:Rang-Exit:2026-11-20']);
  assert.deepEqual(ev.map((e) => e.kind).sort(), ['rslBuy', 'rslBuy', 'rslSell']);
  assert.equal(sa.rslDiff(b, b).length, 0);
});

test('Liste: Kursalarme vor der Basislinie gelten als quittiert; Quittieren einzeln und alle', () => {
  const file = path.join(TEST_DATA_DIR, 'status-alerts.json');
  const st = { ...sa.emptyState(), priceAckBefore: '2026-11-22T00:00:00.000Z',
    events: [{ id: 'e1', key: 'k1', kind: 'gsw', source: 'gsw', title: 'GSW', text: 't', at: '2026-11-22T10:00:00Z', ackedAt: null }] };
  fs.writeFileSync(file, JSON.stringify(st));
  const price = [{ id: 'p-old', symbol: 'BTC', text: 'alt', at: '2026-11-01T00:00:00Z' }, { id: 'p-new', symbol: 'BTC', text: 'neu', at: '2026-11-22T11:00:00Z' }];
  let c = sa.combinedLog(sa.loadState(), price);
  assert.equal(c.rows[0].id, 'p-new');
  assert.equal(c.unacked, 2);
  c = sa.ack({ id: 'p-new' }, price);
  assert.equal(c.unacked, 1);
  assert.equal(sa.unackedCount(price), 1);
  assert.throws(() => sa.ack({ id: 'nope' }, price), (e) => e.status === 404);
  c = sa.ack({ all: true }, price);
  assert.equal(c.unacked, 0);
  sa.markDelivery('e1', { sender: true, mail: 'sent', telegram: 'off' });
  assert.equal(sa.loadState().events[0].delivery.mail, 'sent');
});

test('evaluate: Provider registrieren, Basislinie, Ereignis an Listener, kein Doppel nach „Neustart“', async () => {
  for (const p of sa.statusProviders()) assert.ok(['gsw', 'rsl'].includes(p.id));
  fs.rmSync(path.join(TEST_DATA_DIR, 'status-alerts.json'), { force: true });
  let v = 1;
  const off = sa.registerStatusProvider({ id: 'tst', snapshot: () => ({ v }), diff: (a, b) => (a.v !== b.v ? [{ key: `tst:${b.v}`, kind: 'gsw', text: String(b.v) }] : []) });
  const got = [];
  const unl = sa.onStatusEvent((e) => got.push(e.key));
  try {
    let r = await sa.evaluate({ only: ['tst'] });
    assert.equal(r.events.length, 0);
    assert.ok(sa.loadState().priceAckBefore);
    v = 2;
    r = await sa.evaluate({ only: ['tst'] });
    assert.deepEqual(got, ['tst:2']);
    // „Neustart“: Zustand liegt in der Datei, gleicher Zustand → nichts Neues
    r = await sa.evaluate({ only: ['tst'] });
    assert.equal(r.events.length, 0);
    assert.equal(sa.loadState().events.filter((e) => e.key === 'tst:2').length, 1);
  } finally { off(); unl(); }
});

test('Zeitplan: stündlich oder nach EU/US-Schluss (Berlin)', () => {
  const t = (s) => Date.parse(s);
  assert.equal(sa.dueNow(0, t('2026-11-22T10:00:00Z')), true);
  assert.equal(sa.dueNow(t('2026-11-23T10:00:00Z'), t('2026-11-23T10:20:00Z')), false);
  assert.equal(sa.dueNow(t('2026-11-23T10:00:00Z'), t('2026-11-23T11:00:00Z')), true);
  // 17:40 → 17:50 MEZ (16:40Z → 16:50Z) überschreitet 17:45
  assert.equal(sa.dueNow(t('2026-11-23T16:40:00Z'), t('2026-11-23T16:50:00Z')), true);
  // 22:15 → 22:25 MEZ überschreitet 22:20
  assert.equal(sa.dueNow(t('2026-11-23T21:15:00Z'), t('2026-11-23T21:25:00Z')), true);
  assert.equal(sa.dueNow(t('2026-11-23T21:25:00Z'), t('2026-11-23T21:35:00Z')), false);
});

const tstP = (id, prefix) => ({ id, empty: () => ({ on: [] }),
  diff: (a, b) => b.on.filter((x) => !(a?.on || []).includes(x)).map((x) => ({ key: `${prefix}:${x}`, kind: 'rslSell', text: x })) });

test('Kein Stand = melden (auch erster Lauf); mit Stand nur Wechsel', () => {
  const p = tstP('r', 'r');
  const first = sa.applySnapshot(sa.emptyState(), p, { on: ['MRNA', 'VEEV'] }, {});
  assert.deepEqual(first.events.map((e) => e.key), ['r:MRNA', 'r:VEEV']);
  assert.ok(first.state.baseline.r);
  assert.equal(sa.applySnapshot(first.state, p, { on: ['MRNA', 'VEEV'] }, {}).events.length, 0, 'gleicher Stand: nichts');
  assert.deepEqual(sa.applySnapshot(first.state, p, { on: ['MRNA', 'VEEV', 'X'] }, {}).events.map((e) => e.key), ['r:X']);
});

test('Upgrade: vorhandener Stand (alte stille Basislinie) meldet nichts doppelt', () => {
  const old = { ...sa.emptyState(), baseline: { r: '2026-11-22T18:02:21Z' }, snaps: { r: { on: ['MRNA', 'VEEV'] } }, reportNext: undefined };
  assert.equal(sa.applySnapshot(old, tstP('r', 'r'), { on: ['MRNA', 'VEEV'] }, {}).events.length, 0);
});

test('Ohne Stand: GSW meldet fällige Swaps, keine alten Buchungen; RSL alle Signale und Kandidaten', () => {
  const [gsw, rsl] = ['gsw', 'rsl'].map((id) => sa.statusProviders().find((p) => p.id === id));
  const g = { asOf: '2026-11-20', dueSince: 'sig2026-11-20', lots: { L1: { symbol: 'EWG2', metal: 'gold', level: 'due', target: 'silver', text: 'x' }, L2: { symbol: 'X', metal: 'gold', level: 'ok', target: 'gold', text: '' } }, swaps: { S1: { date: '2025-01-02' } } };
  assert.deepEqual(sa.applySnapshot(sa.emptyState(), gsw, g, {}).events.map((e) => e.key), ['gsw:due:L1:silver:sig2026-11-20']);
  const r = { pos: { a: { symbol: 'MRNA', universe: 'SPX', signal: true, reason: 'SL >20%', lastDate: '2026-11-20' }, b: { symbol: 'ACN', universe: 'SPX', signal: false } },
    buy: { SPX: { asOf: '2026-11-20', list: [{ ticker: 'NVDA', rank: 1 }] } } };
  assert.deepEqual(sa.applySnapshot(sa.emptyState(), rsl, r, {}).events.map((e) => e.key).sort(), ['rsl:buy:SPX:NVDA:2026-11-20', 'rsl:sell:a:SL >20%:2026-11-20']);
});

test('evaluate: fehlende status-alerts.json → einmal alle aktuellen Signale, dann nichts doppelt', async () => {
  fs.rmSync(path.join(TEST_DATA_DIR, 'status-alerts.json'), { force: true });
  const off = sa.registerStatusProvider({ ...tstP('tst3', 't3'), snapshot: () => ({ on: ['A', 'B'] }) });
  const got = [];
  const unl = sa.onStatusEvent((e) => got.push(e.key));
  try {
    await sa.evaluate({ only: ['tst3'] });
    assert.deepEqual(got.sort(), ['t3:A', 't3:B']);
    await sa.evaluate({ only: ['tst3'] });
    assert.equal(got.length, 2);
  } finally { off(); unl(); }
});

test('resetAndCheck: löscht Status-Alarme und Schlüssel, meldet neu, blendet alte Kursalarme aus', async () => {
  fs.rmSync(path.join(TEST_DATA_DIR, 'status-alerts.json'), { force: true });
  const off = sa.registerStatusProvider({ ...tstP('tst2', 't2'), snapshot: () => ({ on: ['MRNA'] }) });
  const got = [];
  const unl = sa.onStatusEvent((e) => got.push(e.key));
  try {
    await sa.evaluate({ only: ['tst2'] });
    assert.deepEqual(got, ['t2:MRNA']);
    await sa.evaluate({ only: ['tst2'] });
    assert.deepEqual(got, ['t2:MRNA'], 'ohne Reset kein zweites Mal');
    const r = await sa.resetAndCheck({ only: ['tst2'] }); // Test: nur der Test-Provider (keine echten Scans)
    assert.deepEqual(r.events.map((e) => e.key), ['t2:MRNA'], 'nach Reset wieder gemeldet');
    assert.deepEqual(got, ['t2:MRNA', 't2:MRNA'], 'Listener (Glocke/Mail/Telegram) bekommt es');
    const st = sa.loadState();
    assert.equal(st.events.length, 1);
    assert.ok(st.priceHideBefore && st.resetAt);
    const price = [{ id: 'old', at: '2000-01-01T00:00:00Z', text: 'alt' }, { id: 'new', at: '2999-01-01T00:00:00Z', text: 'neu' }];
    assert.deepEqual(sa.combinedLog(st, price).rows.filter((x) => x.kind === 'price').map((x) => x.id), ['new']);
  } finally { off(); unl(); }
});

test('Glocke: abgewählte Typen stehen in der Liste, zählen aber nicht', () => {
  const st = { ...sa.emptyState(), priceAckBefore: '2026-01-01T00:00:00Z', events: [
    { id: 'a', kind: 'rslBuy', at: '2026-11-22T10:00:00Z', ackedAt: null },
    { id: 'b', kind: 'rslSell', at: '2026-11-22T11:00:00Z', ackedAt: null },
    { id: 'c', kind: 'rslBuy', at: '2026-11-22T09:00:00Z', ackedAt: '2026-11-22T09:30:00Z' }] };
  const price = [{ id: 'p', at: '2026-11-22T12:00:00Z', text: 'x' }];
  const all = sa.combinedLog(st, price);
  assert.equal(all.unacked, 3); assert.equal(all.muted, 0);
  assert.ok(all.rows.every((r) => r.bell));
  const c = sa.combinedLog(st, price, { bellKinds: ['rslSell'] });
  assert.equal(c.rows.length, 4, 'alle in der Liste');
  assert.equal(c.unacked, 1); assert.equal(c.muted, 2);
  assert.deepEqual(c.rows.filter((r) => !r.bell).map((r) => r.id).sort(), ['a', 'c', 'p']);
  assert.equal(sa.combinedLog(st, price, { bellKinds: [] }).unacked, 0);
});

test('Kursalarme: rearmFired schaltet nur ausgelöste „einmalig“-Alarme wieder aktiv (nur Testordner)', async () => {
  const alerts = await import('../lib/alerts.js');
  const a = alerts.add({ symbol: 'BINANCE:BTCUSDT', left: 'close', op: '>', right: 1, trigger: 'once' });
  const b = alerts.add({ symbol: 'BINANCE:BTCUSDT', left: 'close', op: '>', right: 2, trigger: 'once' });
  const c = alerts.add({ symbol: 'BINANCE:BTCUSDT', left: 'close', op: '>', right: 3, trigger: 'oncePerBar' });
  try {
    alerts.update(a.id, { active: false, lastFiredAt: '2026-11-22T10:00:00Z', lastBar: 123 }); // ausgelöst
    alerts.update(b.id, { active: false }); // nie ausgelöst, von Hand aus
    assert.equal(alerts.rearmFired(), 1);
    const byId = Object.fromEntries(alerts.list().map((x) => [x.id, x]));
    assert.equal(byId[a.id].active, true); assert.equal(byId[a.id].lastBar, null);
    assert.equal(byId[b.id].active, false);
    assert.equal(byId[c.id].active, true);
    assert.ok(fs.existsSync(path.join(TEST_DATA_DIR, 'alerts.json')));
    assert.equal(alerts.rearmFired(), 0);
  } finally { for (const x of [a, b, c]) alerts.remove(x.id); }
});

test('RSL Freitagsschluss: Stichtag je Universum = Börsenschluss + 30 min (Zeitzone/Sommerzeit, Feiertag, Kurs fehlt)', () => {
  const wk = (from, to) => { const out = []; for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86400e3) { const d = new Date(t); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); } return out; };
  const pick = (r) => r && { asOf: r.asOf, week: r.week, holiday: r.holiday };
  const dates = wk('2026-11-02', '2026-11-20');
  const at = (iso, u = 'SPX') => sa.weekCloseAsOf(dates, new Date(iso), u);
  // Winter: 16:30 New York = 22:30 MEZ = 21:30Z; Xetra 18:00 MEZ = 17:00Z
  assert.equal(at('2026-11-20T21:29:00Z').asOf, '2026-11-13', 'SPX Fr 22:29 MEZ: Vorwoche');
  assert.deepEqual(pick(at('2026-11-20T21:31:00Z')), { asOf: '2026-11-20', week: '2026-11-20', holiday: false }, 'SPX Fr 22:31 MEZ');
  assert.equal(at('2026-11-20T21:31:00Z').settleAt, '2026-11-20T21:30:00.000Z');
  assert.equal(at('2026-11-20T16:59:00Z', 'DAX').asOf, '2026-11-13', 'DAX Fr 17:59 MEZ: Vorwoche');
  assert.equal(at('2026-11-20T17:01:00Z', 'HDAX').asOf, '2026-11-20', 'HDAX Fr 18:01 MEZ');
  assert.equal(at('2026-11-20T17:01:00Z', 'SXXP').asOf, '2026-11-20', 'STOXX Fr 18:01 MEZ');
  assert.equal(at('2026-11-20T17:01:00Z', 'NDX').asOf, '2026-11-13', 'NDX um 18:01 MEZ noch Vorwoche');
  // Sommer: 16:30 EDT = 20:30Z, Xetra 18:00 MESZ = 16:00Z
  const summer = wk('2026-06-29', '2026-07-10');
  assert.equal(sa.weekCloseAsOf(summer, new Date('2026-07-10T20:31:00Z'), 'SPX').asOf, '2026-07-10');
  assert.equal(sa.weekCloseAsOf(summer, new Date('2026-07-10T20:29:00Z'), 'SPX').asOf, '2026-07-03');
  assert.equal(sa.weekCloseAsOf(summer, new Date('2026-07-10T16:01:00Z'), 'DAX').asOf, '2026-07-10');
  assert.equal(at('2026-11-21T10:00:00Z').asOf, '2026-11-20', 'Samstag');
  assert.equal(at('2026-11-23T07:30:00Z').asOf, '2026-11-20', 'Montag früh');
  assert.equal(sa.weekCloseAsOf([...dates, '2026-11-23', '2026-11-25'], new Date('2026-11-25T20:00:00Z')).asOf, '2026-11-20', 'Mittwoch: Tageskurse der laufenden Woche zählen nicht');
  const ostern = [...wk('2027-03-15', '2027-03-25'), '2027-03-29', '2027-03-30'];
  assert.deepEqual(pick(sa.weekCloseAsOf(ostern, new Date('2027-03-30T20:00:00Z'))), { asOf: '2027-03-25', week: '2027-03-26', holiday: true });
  assert.equal(sa.weekCloseAsOf(wk('2026-11-02', '2026-11-19'), new Date('2026-11-21T10:00:00Z')).asOf, '2026-11-13', 'Freitag fehlt, nichts Späteres: Vorwoche');
  assert.equal(sa.weekCloseAsOf([], new Date()), null);
});

test('Zeitplan: Prüfung nach Fr-Schluss + 30 min je Börse', () => {
  const t = (s) => Date.parse(s);
  // 17:55 → 18:05 MEZ Freitag (Xetra-Wochenschluss 18:00) ohne andere Marke
  assert.equal(sa.dueNow(t('2026-11-20T16:55:00Z'), t('2026-11-20T17:05:00Z')), true);
  // 22:25 → 22:35 MEZ Freitag (16:30 New York)
  assert.equal(sa.dueNow(t('2026-11-20T21:25:00Z'), t('2026-11-20T21:35:00Z')), true);
  // gleiche Uhrzeit am Donnerstag: keine Marke
  assert.equal(sa.dueNow(t('2026-11-19T21:25:00Z'), t('2026-11-19T21:35:00Z')), false);
  // Sommer: 16:30 EDT = 22:30 MESZ = 20:30Z
  assert.equal(sa.dueNow(t('2026-07-10T20:25:00Z'), t('2026-07-10T20:35:00Z')), true);
  const marks = sa.settleMarksBetween(t('2026-11-20T00:00:00Z'), t('2026-11-21T00:00:00Z')).map((m) => `${m.universe}@${new Date(m.at).toISOString().slice(11, 16)}`).sort();
  assert.deepEqual(marks, ['DAX@17:00', 'HDAX@17:00', 'NDX@21:30', 'SPX@21:30', 'SXXP@17:00']);
});

test('rsl26 fridayBasis: Kurse vor Schluss + 30 min werden einmal nachgeladen (ohne Netz, gemockt)', async () => {
  const { fridayBasis } = await import('../lib/fn/rsl26.js');
  const d = (s) => Date.parse(`${s}T14:30:00Z`) / 1000;
  const bars = ['2026-11-12', '2026-11-13', '2026-11-18', '2026-11-19', '2026-11-20'].map((x) => ({ time: d(x), close: 1 }));
  const calls = [], dropped = [];
  const refresh = async (t, { maxAgeMs }) => { calls.push([t, maxAgeMs]); return { fetched: true, changed: t === 'AAA' }; };
  const now = new Date('2026-11-21T10:00:00Z');
  const wk = await fridayBasis('SPX', ['AAA', 'BBB', 'AAA'], { now, hist: async () => ({ bars }), refresh, drop: (f) => dropped.push(f('grokki:AAA:1')) });
  assert.equal(wk.asOf, '2026-11-20');
  assert.equal(wk.refreshed, 1);
  assert.deepEqual(calls.map((c) => c[0]), ['^GSPC', 'AAA', 'BBB']);
  assert.equal(calls[0][1], now.getTime() - Date.parse('2026-11-20T21:30:00Z'), 'nur Kurse, die vor 22:30 MEZ geholt wurden');
  assert.deepEqual(dropped, [true]);
  // Stichtag ist Vorwoche (Freitagskurs fehlt): Aktien nicht nachladen
  calls.length = 0;
  const prev = await fridayBasis('SPX', ['AAA'], { now, hist: async () => ({ bars: bars.slice(0, 4) }), refresh: async (t) => { calls.push(t); return {}; }, drop: () => {} });
  assert.deepEqual(calls, ['^GSPC']);
  assert.equal(prev.asOf, '2026-11-13');
});

test('RSL Freitagsschluss: Schlüssel je Woche, Text nennt den Stichtag', () => {
  const a = { pos: { p1: { symbol: 'MRNA', universe: 'SPX', signal: false, lastDate: '2026-11-13', week: '2026-11-13' } }, buy: { SPX: { asOf: '2026-11-13', week: '2026-11-13', list: [] } } };
  const b = { pos: { p1: { ...a.pos.p1, signal: true, reason: 'SL >20%', lastDate: '2026-11-20', week: '2026-11-20', holiday: false } },
    buy: { SPX: { asOf: '2026-11-19', week: '2026-11-20', holiday: true, list: [{ ticker: 'NVDA', rank: 1 }] } } };
  const ev = sa.rslDiff(a, b);
  const sell = ev.find((e) => e.kind === 'rslSell'), buyE = ev.find((e) => e.kind === 'rslBuy');
  assert.equal(sell.key, 'rsl:sell:p1:SL >20%:wk2026-11-20');
  assert.match(sell.text, /Basis Freitagsschluss 20\.11\.2026/);
  assert.equal(buyE.key, 'rsl:buy:SPX:NVDA:wk2026-11-20');
  assert.match(buyE.text, /Basis Wochenschluss 19\.11\.2026 \(Freitag kein Handelstag\)/);
  assert.equal(sa.rslDiff(b, b).length, 0, 'gleiche Woche: nichts');
});

test('rsl26 cutHistory/withUntil: Kurse nur bis Stichtag, Cache-Objekt unverändert', async () => {
  const { cutHistory, withUntil } = await import('../lib/fn/rsl26.js');
  const t = (d) => Date.parse(`${d}T14:30:00Z`) / 1000;
  const h = { ticker: 'X', asOf: '2026-11-23', bars: ['2026-11-19', '2026-11-20', '2026-11-23'].map((d) => ({ time: t(d), close: 1 })) };
  const c = cutHistory(h, '2026-11-20');
  assert.equal(c.bars.length, 2); assert.equal(c.asOf, '2026-11-20');
  assert.equal(h.bars.length, 3); assert.equal(h.asOf, '2026-11-23');
  assert.equal(cutHistory(h, null), h);
  assert.equal(await withUntil('2026-11-20', async () => 'ok'), 'ok');
});
