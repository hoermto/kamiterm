// Live OHLC for open scanner screens (RSL26, DSCAN, FVSCAN, HEAT).
// A scan registers the stocks it used under a key (rsl26:SPX); the screen, while it is on view, follows that key
// (POST /api/ohlc/follow every minute). For every followed key whose market is open (or closed less than half an
// hour ago, for the closing price) the server refreshes the cached daily bars once per refresh interval (SETTINGS >
// Data sources, default 15 minutes) and, only when some bars really changed, raises the key's version and tells the
// pages (event "ohlc"). The screen then rebuilds itself quietly, off screen, and swaps the result in.
import * as toolSettings from "./tool-settings.js";
import { setRefreshMinutes, getRefreshMs, sessionState, REFRESH_MIN } from "./ohlcv-cache.js";
import { refreshDaily, uncache } from "./providers.js";

const FOLLOW_MS = 3 * 60e3; // a key not followed for 3 minutes (screen closed, page gone) is left alone
const keys = new Map(); // key -> { tickers: [], seen, version, lastPass, passing }
let notify = () => {};

export const refreshMinutes = () => getRefreshMs() / 60e3;
export function loadSetting() {
  return setRefreshMinutes(toolSettings.getTool("OHLC").refreshMin ?? REFRESH_MIN.def);
}
/** SETTINGS: minutes (5–60). Throws a 400 error for anything else. */
export function saveSetting(min) {
  const n = Number(min);
  if (!Number.isInteger(n) || n < REFRESH_MIN.min || n > REFRESH_MIN.max)
    throw Object.assign(new Error(`Minutes from ${REFRESH_MIN.min} to ${REFRESH_MIN.max}.`), { status: 400 });
  toolSettings.saveTool("OHLC", { refreshMin: n });
  return loadSetting();
}

/** A scan says which stocks its screen shows. -> the key's current version (the screen keeps it). */
export function register(key, tickers) {
  const k = keys.get(key) || { tickers: [], seen: 0, version: 1, lastPass: Date.now(), passing: false };
  k.seen = Date.now(); // the screen that asked is on view now
  k.tickers = [...new Set(tickers.filter(Boolean))];
  keys.set(key, k);
  return k.version;
}

/** Open screens report the keys they show. -> { key: version } (null: unknown, e.g. after a restart: scan again). */
export function follow(list, now = Date.now()) {
  const out = {};
  for (const key of [].concat(list || []).slice(0, 20)) {
    const k = keys.get(String(key));
    if (k) k.seen = now;
    out[key] = k ? k.version : null;
  }
  return out;
}

/** The followed keys due for a pass now (followed lately, interval over, market open or just closed). */
export function due(now = Date.now()) {
  const every = getRefreshMs();
  const out = [];
  for (const [key, k] of keys) {
    if (k.passing || now - k.seen > FOLLOW_MS || now - k.lastPass < every) continue;
    const live = k.tickers.filter((t) => { const s = sessionState(t, new Date(now)); return s.open || s.justClosed; });
    if (live.length) out.push({ key, k, live });
  }
  return out;
}

async function pass({ key, k, live }, refresh = refreshDaily) {
  k.passing = true;
  k.lastPass = Date.now();
  let changed = 0;
  try {
    // Bars fetched by the screen itself within the last half interval are left as they are.
    const maxAgeMs = getRefreshMs() / 2;
    let next = 0;
    const worker = async () => {
      while (next < live.length) {
        const t = live[next++];
        try {
          const r = await refresh(t, { maxAgeMs });
          if (r.changed) {
            changed++;
            uncache((c) => c.startsWith(`grokki:${t}:`));
          }
        } catch { /* Yahoo busy or symbol gone: next pass */ }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
  } finally {
    k.passing = false;
  }
  if (changed) {
    k.version++;
    notify({ key, version: k.version, changed });
  }
  return changed;
}

let timer = null;
/** Starts the minute tick (server.js). onChange({ key, version, changed }) goes to the pages. */
export function start(onChange) {
  notify = onChange || (() => {});
  loadSetting();
  if (timer) return;
  timer = setInterval(() => { for (const d of due()) pass(d); }, 60e3);
  timer.unref?.();
}

/** For tests. */
export const _test = { keys, pass, reset: () => keys.clear() };
