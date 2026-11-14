// Persistent cache for company events (SQLite via node:sqlite): dividends, earnings reports, upcoming
// dates from the calendars, and when each source was last asked. Lives in data/cache/events.sqlite
// (QT_EVENTS_PATH overrides), next to the price cache (ohlcv.sqlite), and can be cleared on its own.
// Past events never change, so most requests after the first are answered from here. If SQLite fails,
// refresh() still returns live data and the cache is simply skipped.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.js";

export const eventsDbPath = () => process.env.QT_EVENTS_PATH || path.join(DATA_DIR, "cache", "events.sqlite");

let db;
let dbPath;

function getDb() {
  const p = eventsDbPath();
  if (db && dbPath === p) return db;
  if (db) closeDb();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  db = new DatabaseSync(p);
  dbPath = p;
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS dividends (
      symbol TEXT NOT NULL,
      ex_date TEXT NOT NULL,
      source TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT,
      type TEXT,
      declared TEXT,
      record TEXT,
      paid TEXT,
      PRIMARY KEY (symbol, source, ex_date)
    );
    CREATE TABLE IF NOT EXISTS earnings (
      symbol TEXT NOT NULL,
      report_date TEXT NOT NULL,
      source TEXT NOT NULL,
      timing TEXT,
      period TEXT,
      eps REAL,
      consensus REAL,
      filed_at TEXT,
      PRIMARY KEY (symbol, source, report_date)
    );
    CREATE TABLE IF NOT EXISTS upcoming (
      kind TEXT NOT NULL,
      symbol TEXT NOT NULL,
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      timing TEXT,
      amount REAL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (kind, symbol, date)
    );
    CREATE TABLE IF NOT EXISTS fetch_log (
      source TEXT NOT NULL,
      symbol TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      PRIMARY KEY (source, symbol)
    );
  `);
  return db;
}

function closeDb() {
  try { db?.close(); } catch { /* already closed */ }
  db = undefined;
  dbPath = undefined;
}

/** For tests: close, and optionally delete the database files. */
export function resetEventsCache({ wipe = false } = {}) {
  const p = dbPath || eventsDbPath();
  closeDb();
  if (wipe) for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { fs.unlinkSync(f); } catch { /* missing */ } }
}

function tx(d, fn) {
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    try { d.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}

// ---------- dividends ----------
/** Dividends of one symbol from one source, newest first. */
export function readDividends(symbol, source) {
  return getDb()
    .prepare("SELECT ex_date, amount, currency, type, declared, record, paid FROM dividends WHERE symbol=? AND source=? ORDER BY ex_date DESC")
    .all(symbol, source)
    .map((r) => ({ exDate: r.ex_date, amount: r.amount, currency: r.currency, type: r.type, declared: r.declared, record: r.record, paid: r.paid }));
}

/** Replaces all dividends of one symbol from one source (a source always sends its whole history). */
export function replaceDividends(symbol, source, rows) {
  const d = getDb();
  const ins = d.prepare("INSERT OR REPLACE INTO dividends(symbol, ex_date, source, amount, currency, type, declared, record, paid) VALUES(?,?,?,?,?,?,?,?,?)");
  tx(d, () => {
    d.prepare("DELETE FROM dividends WHERE symbol=? AND source=?").run(symbol, source);
    for (const r of rows || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.exDate || "") || !Number.isFinite(r.amount)) continue;
      ins.run(symbol, r.exDate, source, r.amount, r.currency ?? null, r.type ?? null, r.declared ?? null, r.record ?? null, r.paid ?? null);
    }
  });
}

// ---------- earnings ----------
/** Earnings reports of one symbol from one source, newest first. */
export function readEarnings(symbol, source) {
  return getDb()
    .prepare("SELECT report_date, timing, period, eps, consensus, filed_at FROM earnings WHERE symbol=? AND source=? ORDER BY report_date DESC")
    .all(symbol, source)
    .map((r) => ({ date: r.report_date, timing: r.timing, period: r.period, eps: r.eps, consensus: r.consensus, filedAt: r.filed_at }));
}

export function replaceEarnings(symbol, source, rows) {
  const d = getDb();
  const ins = d.prepare("INSERT OR REPLACE INTO earnings(symbol, report_date, source, timing, period, eps, consensus, filed_at) VALUES(?,?,?,?,?,?,?,?)");
  tx(d, () => {
    d.prepare("DELETE FROM earnings WHERE symbol=? AND source=?").run(symbol, source);
    for (const r of rows || []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) continue;
      ins.run(symbol, r.date, source, r.timing ?? null, r.period ?? null, r.eps ?? null, r.consensus ?? null, r.filedAt ?? null);
    }
  });
}

// ---------- upcoming dates (calendars) ----------
/** Saves dates seen in a calendar; kind is "earnings" or "exdiv". */
export function upsertUpcoming(kind, source, rows, seenAt = Date.now()) {
  const d = getDb();
  const ins = d.prepare("INSERT OR REPLACE INTO upcoming(kind, symbol, date, source, timing, amount, seen_at) VALUES(?,?,?,?,?,?,?)");
  tx(d, () => {
    for (const r of rows || []) {
      if (!r.symbol || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || "")) continue;
      ins.run(kind, r.symbol, r.date, source, r.timing ?? null, r.amount ?? null, seenAt);
    }
  });
}

/** Upcoming dates of one kind between from and to (YYYY-MM-DD, inclusive), soonest first. */
export function readUpcoming(kind, from, to) {
  return getDb()
    .prepare("SELECT symbol, date, source, timing, amount, seen_at FROM upcoming WHERE kind=? AND date>=? AND date<=? ORDER BY date, symbol")
    .all(kind, from, to)
    .map((r) => ({ symbol: r.symbol, date: r.date, source: r.source, timing: r.timing, amount: r.amount, seenAt: r.seen_at }));
}

// ---------- fetch log ----------
export function logFetch(source, symbol, { ok = true, error = null, at = Date.now() } = {}) {
  getDb()
    .prepare("INSERT OR REPLACE INTO fetch_log(source, symbol, fetched_at, ok, error) VALUES(?,?,?,?,?)")
    .run(source, symbol, at, ok ? 1 : 0, error ? String(error).slice(0, 300) : null);
}

export function lastFetch(source, symbol) {
  const r = getDb().prepare("SELECT fetched_at, ok, error FROM fetch_log WHERE source=? AND symbol=?").get(source, symbol);
  return r ? { at: r.fetched_at, ok: !!r.ok, error: r.error } : null;
}

/**
 * Cached fetch of one symbol's data from one source.
 *   read():   rows from the cache        write(rows): store fetched rows
 *   fetch():  rows from the source (throws on failure)
 * Fresh (fetched successfully within maxAgeMs): served from the cache without asking the source.
 * Stale or never fetched: asks the source; if that fails, serves what the cache has (stale: true),
 * or throws when it has nothing. A failed fetch is retried after retryMs, not on every request.
 * When SQLite itself fails, the live rows are returned and nothing is stored.
 */
export async function refresh({ source, symbol, maxAgeMs, retryMs = 15 * 60e3, read, write, fetch, now = Date.now() }) {
  let last = null;
  let cachedRows = null;
  try {
    last = lastFetch(source, symbol);
    cachedRows = read();
  } catch {
    return { rows: await fetch(), fromCache: false, stale: false, fetchedAt: now, cache: false };
  }
  const fresh = last && (last.ok ? now - last.at < maxAgeMs : now - last.at < retryMs && cachedRows.length);
  if (fresh) return { rows: cachedRows, fromCache: true, stale: !last.ok, fetchedAt: last.at, cache: true };
  try {
    const rows = await fetch();
    write(rows);
    logFetch(source, symbol, { ok: true, at: now });
    return { rows: read(), fromCache: false, stale: false, fetchedAt: now, cache: true };
  } catch (e) {
    try { logFetch(source, symbol, { ok: false, error: e.message, at: now }); } catch { /* ignore */ }
    if (cachedRows.length) return { rows: cachedRows, fromCache: true, stale: true, fetchedAt: last?.at ?? null, cache: true, error: e.message };
    throw e;
  }
}

// ---------- maintenance ----------
export function cacheStats() {
  const d = getDb();
  const n = (sql) => d.prepare(sql).get().n;
  let bytes = 0;
  for (const f of [dbPath, `${dbPath}-wal`]) { try { bytes += fs.statSync(f).size; } catch { /* missing */ } }
  return {
    symbols: n("SELECT COUNT(DISTINCT symbol) AS n FROM fetch_log"),
    dividends: n("SELECT COUNT(*) AS n FROM dividends"),
    earnings: n("SELECT COUNT(*) AS n FROM earnings"),
    upcoming: n("SELECT COUNT(*) AS n FROM upcoming"),
    bytes,
    path: dbPath,
  };
}

/** Empties every table (the file stays; it is rebuilt from the sources on the next requests). */
export function clearCache() {
  const d = getDb();
  tx(d, () => {
    for (const t of ["dividends", "earnings", "upcoming", "fetch_log"]) d.exec(`DELETE FROM ${t}`);
  });
  d.exec("VACUUM");
  return cacheStats();
}
