// Persistent daily OHLCV cache (SQLite via node:sqlite). Seafile-ignored under data/cache/.
// Used as the general Yahoo/daily layer inside providers.getCandles().
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OHLCV_DB_PATH = process.env.QT_OHLCV_PATH || path.join(here, '..', 'data', 'cache', 'ohlcv.sqlite');

let db;
let dbFailed = false;

function getDb() {
  if (dbFailed) throw new Error('ohlcv sqlite unavailable');
  if (db) return db;
  fs.mkdirSync(path.dirname(OHLCV_DB_PATH), { recursive: true });
  db = new DatabaseSync(OHLCV_DB_PATH);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS bars (
      symbol TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, time)
    );
    CREATE TABLE IF NOT EXISTS meta (
      symbol TEXT PRIMARY KEY,
      last_fetch INTEGER NOT NULL
    );
  `);
  return db;
}

/** For tests: close and optionally wipe the on-disk DB. */
export function resetOhlcvCache({ wipe = false } = {}) {
  if (db) {
    try { db.close(); } catch { /* already closed */ }
    db = undefined;
  }
  dbFailed = false;
  if (wipe) {
    for (const p of [OHLCV_DB_PATH, OHLCV_DB_PATH + '-wal', OHLCV_DB_PATH + '-shm']) {
      try { fs.unlinkSync(p); } catch { /* missing */ }
    }
  }
}

export function readBars(symbol) {
  return getDb()
    .prepare('SELECT time, open, high, low, close, volume FROM bars WHERE symbol=? ORDER BY time')
    .all(symbol)
    .map((r) => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
}

export function readMeta(symbol) {
  const row = getDb().prepare('SELECT last_fetch FROM meta WHERE symbol=?').get(symbol);
  return row ? { lastFetch: row.last_fetch } : null;
}

/** Upsert bars and set last_fetch. Same-time rows are overwritten (today's partial bar). */
export function upsertBars(symbol, bars, lastFetch = Date.now()) {
  if (!bars?.length) {
    getDb().prepare('INSERT INTO meta(symbol, last_fetch) VALUES(?,?) ON CONFLICT(symbol) DO UPDATE SET last_fetch=excluded.last_fetch')
      .run(symbol, lastFetch);
    return { inserted: 0 };
  }
  const d = getDb();
  const ins = d.prepare(
    'INSERT INTO bars(symbol, time, open, high, low, close, volume) VALUES(?,?,?,?,?,?,?) ON CONFLICT(symbol, time) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume',
  );
  d.exec('BEGIN');
  try {
    for (const b of bars) {
      if (!(b.close > 0 && b.open > 0 && b.time > 0)) continue;
      ins.run(symbol, b.time, b.open, b.high, b.low, b.close, b.volume || 0);
    }
    d.prepare('INSERT INTO meta(symbol, last_fetch) VALUES(?,?) ON CONFLICT(symbol) DO UPDATE SET last_fetch=excluded.last_fetch')
      .run(symbol, lastFetch);
    d.exec('COMMIT');
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }
  return { inserted: bars.length };
}

/** Merge remote bars into local: keep all unique times, remote wins on conflict (incl. last/partial bar). */
export function mergeBars(local, remote) {
  const map = new Map();
  for (const b of local || []) map.set(b.time, b);
  for (const b of remote || []) {
    if (b.close > 0 && b.open > 0 && b.time > 0) map.set(b.time, b);
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** US equity regular session heuristic (Mon–Fri, ~9:30–16:00 America/New_York). */
export function isUsMarketHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wd = get('weekday');
  if (wd === 'Sat' || wd === 'Sun') return false;
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/** Last completed US trading day (UTC midnight of that NY calendar day), skipping weekends. */
export function lastTradingDayUtcMidnight(now = new Date()) {
  let d = new Date(now);
  for (let i = 0; i < 10; i++) {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    if (wd !== 'Sat' && wd !== 'Sun') {
      if (i === 0 && isUsMarketHours(now)) {
        // session in progress — last completed is previous trading day
      } else if (i === 0) {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
        }).formatToParts(now);
        const hour = Number(parts.find((p) => p.type === 'hour')?.value);
        const minute = Number(parts.find((p) => p.type === 'minute')?.value);
        if (hour * 60 + minute >= 16 * 60) {
          const [Y, M, D] = ymd.split('-').map(Number);
          return Date.UTC(Y, M - 1, D) / 1000;
        }
      } else {
        const [Y, M, D] = ymd.split('-').map(Number);
        return Date.UTC(Y, M - 1, D) / 1000;
      }
    }
    d = new Date(d.getTime() - 86400e3);
  }
  return Math.floor(Date.now() / 1000) - 3 * 86400;
}

/**
 * Decide whether to hit Yahoo.
 * - no local bars → full fetch
 * - fewer bars than requested → expand (full)
 * - last_fetch older than 15 min during market hours → refresh (today's partial bar)
 * - last bar older than last completed trading day → refresh
 */
export function needsRefresh(meta, bars, now = Date.now(), { want = 0 } = {}) {
  if (!bars?.length) return { refresh: true, reason: 'empty', mode: 'full' };
  if (want > 0 && bars.length < want) return { refresh: true, reason: 'short', mode: 'full' };
  const lastBar = bars.at(-1).time;
  const ltd = lastTradingDayUtcMidnight(new Date(now));
  if (lastBar < ltd - 2 * 86400) return { refresh: true, reason: 'stale_bar', mode: 'incremental' };
  const lastFetch = meta?.lastFetch || 0;
  if (isUsMarketHours(new Date(now)) && now - lastFetch > 15 * 60e3) {
    return { refresh: true, reason: 'ttl_market', mode: 'incremental' };
  }
  if (!isUsMarketHours(new Date(now)) && lastFetch < ltd * 1000 && lastBar < ltd - 86400) {
    return { refresh: true, reason: 'post_close', mode: 'incremental' };
  }
  return { refresh: false, reason: 'fresh', mode: null };
}

export function deleteSymbol(symbol) {
  const d = getDb();
  d.prepare('DELETE FROM bars WHERE symbol=?').run(symbol);
  d.prepare('DELETE FROM meta WHERE symbol=?').run(symbol);
}

export function cacheStats() {
  const d = getDb();
  const symbols = d.prepare('SELECT COUNT(*) AS n FROM meta').get().n;
  const bars = d.prepare('SELECT COUNT(*) AS n FROM bars').get().n;
  let size = 0;
  try { size = fs.statSync(OHLCV_DB_PATH).size; } catch { /* */ }
  return { symbols, bars, bytes: size, path: OHLCV_DB_PATH };
}

/** Safe read: returns null if SQLite is unavailable (caller falls back). */
export function tryRead(symbol) {
  try {
    return { bars: readBars(symbol), meta: readMeta(symbol) };
  } catch (e) {
    dbFailed = true;
    return null;
  }
}

/** Safe write: ignores SQLite failures so the live response still returns. */
export function tryUpsert(symbol, bars, lastFetch = Date.now()) {
  try {
    dbFailed = false;
    return upsertBars(symbol, bars, lastFetch);
  } catch {
    dbFailed = true;
    return null;
  }
}
