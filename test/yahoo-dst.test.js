// Datierung von Yahoo-Tagesbalken je Balken in der Börsenzeitzone (Sommer-/Winterzeit) und Selbstreparatur
// falsch datierter Futures-/Devisen-Einträge im SQLite-Cache. Fixtures: echte Yahoo-Antworten (gekürzt) für eine
// Sommerwoche (13.–17.07.2026) und eine Winterwoche (12.–16.01.2026), abgerufen im Winter (gmtoffset = Winterzeit).
import './helpers/isolate-data.js'; // zuerst: temporäres QT_DATA_DIR
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Eigene Cache-Datei für diese Datei (npm test lässt die Dateien parallel laufen).
process.env.QT_OHLCV_PATH = path.join(fs.mkdtempSync(path.join(process.env.QT_DATA_DIR, 'dst-')), 'ohlcv.sqlite');
process.env.QT_TIMEOUT_MS = '500';

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/yahoo-dst/${n}.json`, import.meta.url), 'utf8'));
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const days = (bars) => bars.map((b) => iso(b.time));
const WEEK_S = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'];
const WEEK_W = ['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16'];

// Netz-Attrappe: Yahoo-Chart liefert die GC=F-Fixtures (Sommer + Winter zusammen), alles andere schlägt fehl.
const yahooCalls = [];
globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.host.includes('yahoo') && u.pathname.includes('/chart/') && decodeURIComponent(u.pathname).includes('GC=F')) {
    yahooCalls.push(u.search);
    const s = fx('gcf-summer'), w = fx('gcf-winter');
    const r = structuredClone(w);
    const R = r.chart.result[0], S = s.chart.result[0].indicators.quote[0], Q = R.indicators.quote[0];
    R.timestamp = [...w.chart.result[0].timestamp, ...s.chart.result[0].timestamp];
    for (const k of Object.keys(Q)) Q[k] = [...Q[k], ...S[k]];
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
};

const { parseYahoo } = await import('../lib/providers.js');
const cache = await import('../lib/ohlcv-cache.js');

test('parseYahoo: Sommer- und Winterbalken landen auf ihrem Handelstag (alle Symbolklassen)', () => {
  for (const n of ['gcf', 'sif', 'eurusd', 'aapl', 'sapde', 'gspc', 'gdaxi']) {
    assert.deepEqual(days(parseYahoo(fx(`${n}-summer`), '1D')), WEEK_S, `${n} Sommer`);
    assert.deepEqual(days(parseYahoo(fx(`${n}-winter`), '1D')), WEEK_W, `${n} Winter`);
  }
  // Krypto (UTC, 7 Tage) unverändert
  assert.deepEqual(days(parseYahoo(fx('btc-summer'), '1D')), ['2026-07-12', ...WEEK_S, '2026-07-18', '2026-07-19']);
});

test('parseYahoo: alte Datierung (aktueller gmtoffset) verschob Futures/FX-Sommerbalken — Regression', () => {
  const old = (j) => j.chart.result[0].timestamp.map((t) => iso(Math.floor((t + j.chart.result[0].meta.gmtoffset) / 86400) * 86400));
  assert.equal(old(fx('gcf-summer')).at(-1), '2026-07-16'); // Freitag lag früher auf Donnerstag
  assert.equal(old(fx('eurusd-summer'))[0], '2026-07-12'); // Montag lag früher auf Sonntag
  const gc = parseYahoo(fx('gcf-summer'), '1D');
  assert.equal(iso(gc.at(-1).time), '2026-07-17');
  assert.equal(gc.at(-1).close, fx('gcf-summer').chart.result[0].indicators.quote[0].close.at(-1));
  // ohne Zeitzone: alter Weg (gmtoffset)
  const noTz = fx('aapl-summer'); delete noTz.chart.result[0].meta.exchangeTimezoneName;
  assert.deepEqual(days(parseYahoo(noTz, '1D')), WEEK_S);
  // Intraday unverändert (Rohzeitstempel)
  assert.equal(parseYahoo(fx('gcf-summer'), '1h')[0].time, fx('gcf-summer').chart.result[0].timestamp[0]);
});

test('Cache: Parser-Version je Symbol, staleParser nur für =F/=X, replace löscht alte Balken', () => {
  assert.equal(cache.PARSER_VERSION, 2);
  assert.equal(cache.staleParser('GC=F', { parser: 1 }), true);
  assert.equal(cache.staleParser('EURUSD=X', {}), true);
  assert.equal(cache.staleParser('GC=F', { parser: 2 }), false);
  for (const s of ['AAPL', 'SAP.DE', '^GSPC', 'BTC-USD']) assert.equal(cache.staleParser(s, { parser: 1 }), false, s);
  const b = (d, c) => ({ time: Date.parse(d) / 1000, open: c, high: c, low: c, close: c, volume: 0 });
  cache.upsertBars('TST=F', [b('2026-07-16', 1), b('2026-07-19', 2)]);
  assert.equal(cache.readMeta('TST=F').parser, 2);
  cache.upsertBars('TST=F', [b('2026-07-17', 3)], Date.now(), { replace: true });
  assert.deepEqual(cache.readBars('TST=F').map((x) => [iso(x.time), x.close]), [['2026-07-17', 3]]);
});

test('Cache: alte DB ohne Parser-Spalte wird migriert und falsch datierte GC=F-Einträge selbst repariert', async () => {
  // Zustand wie ein v1-Cache aus dem Winter: Sommerbalken einen Tag zu früh, inkl. Sonntag.
  const b = (d, c) => ({ time: Date.parse(d) / 1000, open: c, high: c, low: c, close: c, volume: 0 });
  const wrong = [...WEEK_W.map((d, i) => b(d, 4000 + i)), b('2026-07-12', 1), b('2026-07-13', 2), b('2026-07-14', 3), b('2026-07-15', 4), b('2026-07-16', 5)];
  cache.upsertBars('GC=F', wrong, Date.now());
  // Auf v1 zurücksetzen: Spalte wie vor der Migration = Standard 1
  const db = new DatabaseSync(process.env.QT_OHLCV_PATH);
  db.prepare('UPDATE meta SET parser=1 WHERE symbol=?').run('GC=F');
  db.close();
  assert.equal(cache.staleParser('GC=F', cache.readMeta('GC=F')), true);

  const { getCandles } = await import('../lib/providers.js');
  const r = await getCandles('GC=F', '1D', 50);
  const got = days(r.candles);
  assert.deepEqual(got, [...WEEK_W, ...WEEK_S], 'nur echte Handelstage, kein Sonntag');
  assert.ok(yahooCalls.length >= 1, 'komplett neu geladen');
  const fri = r.candles.find((c) => iso(c.time) === '2026-07-17');
  assert.equal(fri.close, fx('gcf-summer').chart.result[0].indicators.quote[0].close.at(-1));
  // Cache ersetzt (nicht gemischt) und auf Version 2
  assert.deepEqual(days(cache.readBars('GC=F')), [...WEEK_W, ...WEEK_S]);
  assert.equal(cache.readMeta('GC=F').parser, 2);
});

test('Cache: Migration einer echten v1-Datei (meta ohne parser-Spalte)', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.QT_DATA_DIR, 'v1-'));
  const file = path.join(dir, 'ohlcv.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE bars (symbol TEXT NOT NULL, time INTEGER NOT NULL, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(symbol,time));
           CREATE TABLE meta (symbol TEXT PRIMARY KEY, last_fetch INTEGER NOT NULL);
           INSERT INTO meta VALUES ('SI=F', 1), ('AAPL', 1);
           INSERT INTO bars VALUES ('SI=F', 1784246400, 1,1,1,1,0);`);
  db.close();
  const { spawnSync } = await import('node:child_process');
  const code = `const c = await import(${JSON.stringify(new URL('../lib/ohlcv-cache.js', import.meta.url).href)});
    console.log(JSON.stringify([c.readMeta('SI=F'), c.staleParser('SI=F', c.readMeta('SI=F')), c.staleParser('AAPL', c.readMeta('AAPL')), c.readBars('SI=F').length]));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, QT_OHLCV_PATH: file }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const [meta, siStale, aaplStale, n] = JSON.parse(out.stdout.trim().split('\n').at(-1));
  assert.equal(meta.parser, 1);
  assert.equal(siStale, true);
  assert.equal(aaplStale, false);
  assert.equal(n, 1);
});
