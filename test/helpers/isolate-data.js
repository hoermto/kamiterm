// Import this FIRST (before lib/store.js) in any test that touches the RSL book or other data files.
// Points QT_DATA_DIR at a throw-away temp dir so tests never read or write the real
// data/ folder (above all data/rsl-watchlist.json, the user's live positions book).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REAL_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
const cur = process.env.QT_DATA_DIR ? path.resolve(process.env.QT_DATA_DIR) : null;
if (!cur || cur === REAL_DATA_DIR) {
  process.env.QT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-test-data-'));
} else {
  // npm test runs the test files in parallel with one shared QT_DATA_DIR: give each file its own
  // subfolder, or two files writing rsl-watchlist.json at the same time break each other.
  process.env.QT_DATA_DIR = fs.mkdtempSync(path.join(cur, 'file-'));
}
export const TEST_DATA_DIR = path.resolve(process.env.QT_DATA_DIR);
// Also keep the SQLite OHLCV cache (data/cache/ohlcv.sqlite) out of reach.
const ohlcv = process.env.QT_OHLCV_PATH ? path.resolve(process.env.QT_OHLCV_PATH) : null;
if (!ohlcv || ohlcv.startsWith(REAL_DATA_DIR + path.sep)) {
  fs.mkdirSync(path.join(TEST_DATA_DIR, 'cache'), { recursive: true });
  process.env.QT_OHLCV_PATH = path.join(TEST_DATA_DIR, 'cache', 'ohlcv.sqlite');
}

/** Throws if a path points into the real data dir. */
export function assertNotRealData(file) {
  const abs = path.resolve(file);
  if (abs === REAL_DATA_DIR || abs.startsWith(REAL_DATA_DIR + path.sep)) {
    throw new Error(`test tried to touch real data file: ${abs}`);
  }
  return abs;
}
