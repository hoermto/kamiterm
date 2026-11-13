// SEC EDGAR M&A filing check for US tickers. Soft-fail on network errors.
// Cache: data/cache/ma-edgar.json (Seafile-ignored). Refresh when stale > 7 days.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tickerIndex, lookupCik, filingRows } from './fn/cf.js';

export const MA_UA = {
  'User-Agent': 'Amber Terminal name@example.com',
  'Accept-Encoding': 'gzip, deflate',
};

export const MERGER_FORMS = [
  'DEFM14A', 'PREM14A', 'DEFM14C', 'PREM14C',
  'SC TO-T', 'SC 14D9', 'S-4', 'SC 13E3',
];

const LOOKBACK_DAYS = 180;
const STALE_MS = 7 * 24 * 3600e3;
const MIN_GAP_MS = 220; // ~4.5 req/s, under SEC's ~5/s guidance
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const subUrl = (cik) =>
  `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.QT_DATA_DIR || path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'ma-edgar.json');

let lastFetchAt = 0;
let tickersMem = null; // { at, index }

function emptyCache() {
  return { version: 1, updatedAt: null, tickersIndexAt: null, bySymbol: {} };
}

export function loadEdgarCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyCache();
    return {
      version: 1,
      updatedAt: raw.updatedAt || null,
      tickersIndexAt: raw.tickersIndexAt || null,
      bySymbol: raw.bySymbol && typeof raw.bySymbol === 'object' ? raw.bySymbol : {},
    };
  } catch {
    return emptyCache();
  }
}

export function saveEdgarCache(cache) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const next = { ...cache, updatedAt: new Date().toISOString() };
  const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  try { fs.renameSync(tmp, CACHE_FILE); }
  catch {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(next, null, 2));
    fs.rmSync(tmp, { force: true });
  }
  return next;
}

/** Normalize form type for matching (upper, collapse spaces, keep /A). */
export function normForm(form) {
  return String(form || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Base form without amendment suffix. */
export function baseForm(form) {
  return normForm(form).replace(/\/A$/, '');
}

export function isMergerForm(form) {
  const b = baseForm(form);
  return MERGER_FORMS.some((f) => b === f || b.startsWith(f + ' ') || b === f.replace(/ /g, ''));
}

/** Role guess from form type when the company itself is the filer. */
export function roleForForm(form) {
  const b = baseForm(form);
  if (b === 'SC 14D9' || b === 'DEFM14A' || b === 'PREM14A' || b === 'DEFM14C' || b === 'PREM14C' || b === 'SC 13E3')
    return 'target';
  if (b === 'SC TO-T') return 'acquirer'; // tender offeror
  if (b === 'S-4') return 'possible-acquirer'; // often the issuer/acquirer
  return 'unclear';
}

export function isUsTicker(symbol, universe) {
  const s = String(symbol || '').toUpperCase();
  const u = String(universe || '').toUpperCase();
  if (u === 'DAX' || u === 'HDAX' || u === 'SXXP') return false;
  if (/\.(DE|F|PA|L|AS|BR|MI|MC|SW|HK|T|TO|V|CO|ST|OL|HE|LS|VI|IR|WA|AT)$/.test(s)) return false;
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(s);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttledFetch(url) {
  const wait = MIN_GAP_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await sleep(wait);
  lastFetchAt = Date.now();
  const res = await fetch(url, { headers: MA_UA });
  if (!res.ok) throw Object.assign(new Error(`SEC HTTP ${res.status}`), { status: res.status });
  return res.json();
}

export async function loadSecTickers({ force = false, fetchJson = throttledFetch } = {}) {
  const now = Date.now();
  if (!force && tickersMem && now - tickersMem.at < STALE_MS) return tickersMem.index;
  // Prefer disk cache of the raw index timestamp via ma-edgar.json companion? Keep in-memory + refetch weekly.
  try {
    const json = await fetchJson(TICKERS_URL);
    const index = tickerIndex(json);
    tickersMem = { at: now, index };
    return index;
  } catch {
    if (tickersMem) return tickersMem.index;
    return null;
  }
}

/**
 * Pick the newest merger-indicative filing within lookbackDays.
 * Pure: takes a submissions JSON (or filingRows output).
 */
export function pickMergerFiling(subOrRows, { asOf = new Date(), lookbackDays = LOOKBACK_DAYS } = {}) {
  const rows = Array.isArray(subOrRows) ? subOrRows : filingRows(subOrRows);
  const cutoff = new Date(asOf);
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  const cut = cutoff.toISOString().slice(0, 10);
  const hits = rows.filter((r) => isMergerForm(r.form) && r.filed && r.filed >= cut);
  hits.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  const hit = hits[0];
  if (!hit) return null;
  return {
    form: hit.form,
    filed: hit.filed,
    url: hit.url,
    accession: hit.accession || null,
    role: roleForForm(hit.form),
    cik: hit.cik ? String(hit.cik).padStart(10, '0') : null,
  };
}

function stale(entry, now = Date.now()) {
  if (!entry?.checkedAt) return true;
  const t = Date.parse(entry.checkedAt);
  return !Number.isFinite(t) || now - t > STALE_MS;
}

/**
 * Check one US ticker against EDGAR (uses cache unless force/stale).
 * Returns { symbol, flag|null, cached, error? } — never throws.
 */
export async function checkTickerEdgar(symbol, {
  force = false,
  cache = null,
  fetchJson = throttledFetch,
  asOf = new Date(),
  lookbackDays = LOOKBACK_DAYS,
  universe = 'SPX',
} = {}) {
  const sym = String(symbol || '').toUpperCase();
  const out = { symbol: sym, flag: null, cached: false, skipped: false, error: null };
  if (!isUsTicker(sym, universe)) {
    out.skipped = true;
    return out;
  }
  const owned = !cache;
  const store = cache || loadEdgarCache();
  const prev = store.bySymbol[sym];
  if (!force && prev && !stale(prev) && prev.ok !== false) {
    out.flag = prev.flag || null;
    out.cached = true;
    return out;
  }
  const persist = () => { if (owned) try { saveEdgarCache(store); } catch { /* soft */ } };
  try {
    const index = await loadSecTickers({ fetchJson });
    if (!index) {
      out.error = 'ticker index unavailable';
      // keep previous flag if any
      if (prev?.flag) { out.flag = prev.flag; out.cached = true; }
      return out;
    }
    const entry = lookupCik(index, sym);
    if (!entry) {
      store.bySymbol[sym] = { checkedAt: new Date().toISOString(), ok: true, flag: null, cik: null };
      out.flag = null;
      persist();
      return out;
    }
    const sub = await fetchJson(subUrl(entry.cik));
    const flag = pickMergerFiling(sub, { asOf, lookbackDays });
    if (flag && !flag.cik) flag.cik = String(entry.cik).padStart(10, '0');
    store.bySymbol[sym] = {
      checkedAt: new Date().toISOString(),
      ok: true,
      flag,
      cik: String(entry.cik).padStart(10, '0'),
      name: sub.name || entry.name || null,
    };
    out.flag = flag;
    persist();
    return out;
  } catch (e) {
    out.error = e.message || String(e);
    if (prev?.flag) { out.flag = prev.flag; out.cached = true; }
    store.bySymbol[sym] = {
      ...(prev || {}),
      checkedAt: prev?.checkedAt || new Date().toISOString(),
      ok: false,
      lastError: out.error,
    };
    persist();
    return out;
  }
}

/**
 * Check many tickers sequentially (rate-limited). Persists cache at end.
 * opts.universe used to skip DAX/.DE etc.
 */
export async function checkTickersEdgar(symbols, opts = {}) {
  const cache = opts.cache || loadEdgarCache();
  const results = new Map();
  const list = [...new Set((symbols || []).map((s) => String(s || '').toUpperCase()).filter(Boolean))];
  for (const sym of list) {
    const r = await checkTickerEdgar(sym, { ...opts, cache });
    results.set(sym, r);
  }
  try { saveEdgarCache(cache); } catch { /* soft */ }
  return results;
}

/** Test helpers */
export const _internal = { STALE_MS, LOOKBACK_DAYS, CACHE_FILE, subUrl, stale, emptyCache };
