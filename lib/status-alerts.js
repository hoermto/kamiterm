// Status-Alarme: Zustandswechsel in den Büchern/Strategien erkennen und einmal melden (Popup per SSE, Liste ALERTS,
// optional Mail/Telegram über lib/notify.js auf dem Rechner, auf dem die Kanäle in den Einstellungen eingetragen sind).
// Provider-Registry wie lib/holdings.js: registerStatusProvider({ id, label, snapshot(), diff(prev, next) }).
//   snapshot() -> beliebiges JSON (aktueller Zustand), diff(prev, next) -> [{ key, kind, title, text, ref? }]
//   key = stabiler Ereignisschlüssel (gleiches Ereignis → gleicher Schlüssel, auch auf dem zweiten Rechner).
// Zustand in data/status-alerts.json (eigene Datei; state.json/settings.json/gsw-*/rsl-watchlist.json werden nur
// gelesen). Regel: kein gespeicherter Stand oder ein anderer Stand → neue Meldung; ohne Stand (Erstinstallation,
// fehlende Datei, nach „Reset all alerts“) wird gegen provider.empty() verglichen, also der aktuelle Zustand
// einmal gemeldet. Bestehende Installationen mit Stand melden nichts doppelt. Vor dem Schreiben wird die Datei neu gelesen
// und per Schlüssel dedupliziert, damit Box und lokales Terminal (geteilte Datei via Seafile) nicht doppelt loggen.
import crypto from 'node:crypto';
import os from 'node:os';
import * as store from './store.js';
import { basisText as wcBasisText, settleMarksBetween as wcMarks } from './fn/rsl-weekclose.js';

const FILE = 'status-alerts';
const MAX_EVENTS = 500, MAX_SEEN = 5000;
const providers = new Map();
const listeners = new Set();

export const emptyState = () => ({ version: 1, baseline: {}, snaps: {}, events: [], seen: {}, priceAck: {}, priceAckBefore: null, priceHideBefore: null, lastRun: null, errors: {} });
export function loadState() {
  const s = store.read(FILE, null);
  if (!s || typeof s !== 'object') return emptyState();
  return { ...emptyState(), ...s, events: Array.isArray(s.events) ? s.events : [], seen: s.seen && typeof s.seen === 'object' ? s.seen : {} };
}
const saveState = (s) => store.write(FILE, s);

export function registerStatusProvider(p) {
  if (!p || !p.id || typeof p.snapshot !== 'function' || typeof p.diff !== 'function') throw new Error('Status-Provider braucht id, snapshot() und diff()');
  providers.set(String(p.id), { label: p.label || p.id, ...p });
  return () => providers.delete(String(p.id));
}
export const statusProviders = () => [...providers.values()];
export function onStatusEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * Pure: Snapshot eines Providers in den Zustand einarbeiten. -> { state, events (neu) }
 * Kein Stand: gegen provider.empty(snap) vergleichen (aktueller Zustand wird gemeldet); Provider ohne empty()
 * legen still eine Basislinie an. Ereignisse mit bekanntem Schlüssel werden verworfen.
 */
export function applySnapshot(state, provider, snap, { now = new Date().toISOString(), host = os.hostname() } = {}) {
  const st = { ...state, baseline: { ...state.baseline }, snaps: { ...state.snaps }, seen: { ...state.seen }, events: [...state.events] };
  const id = provider.id;
  const fresh = [];
  // Kein gespeicherter Stand = „kein Status“ → Vergleich gegen den leeren Stand des Providers (provider.empty):
  // der aktuelle Zustand wird gemeldet (fällige Swaps, aktive Verkaufssignale, aktuelle Kauf-Kandidaten).
  const noBase = !st.baseline[id];
  if (noBase && typeof provider.empty !== 'function') st.baseline[id] = now;
  else {
    if (noBase) st.baseline[id] = now;
    let list = [];
    const prev = noBase ? provider.empty(snap) : st.snaps[id] ?? null;
    try { list = provider.diff(prev, snap) || []; } catch (e) { st.errors = { ...st.errors, [id]: `diff: ${e.message}` }; }
    for (const e of list) {
      if (!e?.key || st.seen[e.key]) continue;
      const ev = { id: crypto.randomUUID(), key: e.key, kind: e.kind, source: id, title: e.title || '', text: e.text || '', ref: e.ref || null, at: now, host, ackedAt: null };
      st.seen[e.key] = now; st.events.unshift(ev); fresh.push(ev);
    }
  }
  st.snaps[id] = snap;
  st.events = st.events.slice(0, MAX_EVENTS);
  const seenKeys = Object.keys(st.seen);
  if (seenKeys.length > MAX_SEEN) st.seen = Object.fromEntries(Object.entries(st.seen).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, MAX_SEEN));
  return { state: st, events: fresh };
}

let running = null;
/** Alle (oder ausgewählte) Provider auswerten. -> { events, errors, ran } — eine Auswertung zur Zeit. */
export function evaluate(opts = {}) {
  running ||= evaluateOnce(opts).finally(() => { running = null; });
  return running;
}
async function evaluateOnce({ only = null } = {}) {
  const snaps = [], errors = {};
  for (const p of providers.values()) {
    if (only && !only.includes(p.id)) continue;
    try { snaps.push([p, await p.snapshot()]); }
    catch (e) { errors[p.id] = e.message || String(e); }
  }
  // neu lesen direkt vor dem Schreiben (zweite Instanz via Seafile)
  let state = loadState();
  const all = [];
  for (const [p, snap] of snaps) {
    if (snap == null) continue;
    const r = applySnapshot(state, p, snap);
    state = r.state; all.push(...r.events);
  }
  delete state.reportNext; // Altlast aus der ersten Reset-Version
  if (!state.priceAckBefore) state.priceAckBefore = new Date().toISOString(); // ältere Kursalarme gelten als gesehen
  state.lastRun = new Date().toISOString();
  state.errors = errors;
  saveState(state);
  for (const ev of all) for (const fn of listeners) { try { fn(ev); } catch { /* Listener-Fehler ignorieren */ } }
  return { events: all, errors, ran: snaps.map(([p]) => p.id), lastRun: state.lastRun };
}

/**
 * „Reset all alerts“: löscht alle Status-Alarme, die letzten Stände und die gemeldeten Schlüssel (nur
 * data/status-alerts.json), blendet bisherige Kursalarm-Meldungen in ALERTS aus (Kursalarm-Definitionen und
 * data/alert-log.json bleiben hier unverändert; „einmalig“-Kursalarme schaltet der Server über lib/alerts.js
 * rearmFired() wieder scharf) und prüft sofort alle Quellen; ohne Stand wird der aktuelle Zustand gemeldet.
 * -> Ergebnis von evaluate()
 */
export async function resetAndCheck({ only = null } = {}) {
  if (running) await running.catch(() => {}); // laufende Prüfung abwarten, sonst schriebe sie den alten Stand zurück
  const now = new Date().toISOString();
  saveState({ ...emptyState(), priceAckBefore: now, priceHideBefore: now, resetAt: now });
  return evaluate({ only });
}

// ---------- Liste ALERTS: Kurs- und Status-Alarme gemeinsam, mit Quittieren ----------
const priceKind = 'price';
/**
 * Pure: gemeinsame Liste (neueste zuerst). priceLog = lib/alerts.js history().
 * bellKinds (SETTINGS › Benachrichtigungen › Glocke): abgewählte Typen stehen in der Liste (bell: false),
 * zählen aber nicht im 🔔-Zähler (unacked). muted = unquittierte, nicht gezählte.
 */
export function combinedLog(state, priceLog = [], { limit = 300, bellKinds = null } = {}) {
  const before = state.priceAckBefore || '9999';
  const hide = state.priceHideBefore || '';
  const price = (priceLog || []).filter((e) => !hide || !e.at || e.at >= hide).map((e) => ({ id: e.id, kind: priceKind, source: 'ALRT', title: `Kursalarm ${e.symbol || ''}`.trim(), text: e.text, at: e.at,
    ackedAt: state.priceAck?.[e.id] || (e.at && e.at < before ? before : null), delivery: e.delivery || null }));
  const status = (state.events || []).map((e) => ({ id: e.id, kind: e.kind, source: e.source, title: e.title, text: e.text, at: e.at, ackedAt: e.ackedAt || null, host: e.host, delivery: e.delivery || null }));
  const bell = (k) => !Array.isArray(bellKinds) || bellKinds.includes(k);
  const all = [...status, ...price].map((r) => ({ ...r, bell: bell(r.kind) }));
  const rows = all.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
  const open = all.filter((r) => !r.ackedAt);
  return { rows, unacked: open.filter((r) => r.bell).length, muted: open.filter((r) => !r.bell).length };
}
export function unackedCount(priceLog = [], bellKinds = null) { return combinedLog(loadState(), priceLog, { limit: 1e6, bellKinds }).unacked; }

/** Quittieren: id (Status- oder Kursalarm) oder all. Liest neu, schreibt nur diese Datei. */
export function ack({ id = null, all = false } = {}, priceLog = [], { bellKinds = null } = {}) {
  const s = loadState();
  const now = new Date().toISOString();
  if (all) {
    for (const e of s.events) if (!e.ackedAt) e.ackedAt = now;
    s.priceAckBefore = now; s.priceAck = {};
  } else if (id) {
    const e = s.events.find((x) => x.id === id);
    if (e) e.ackedAt ||= now;
    else if ((priceLog || []).some((p) => p.id === id)) s.priceAck = { ...(s.priceAck || {}), [id]: now };
    else throw Object.assign(new Error('Alarm nicht gefunden'), { status: 404 });
    // Kurs-Quittungen klein halten: nur ids, die es im Kurs-Log noch gibt
    const live = new Set((priceLog || []).map((p) => p.id));
    s.priceAck = Object.fromEntries(Object.entries(s.priceAck || {}).filter(([k]) => live.has(k)));
  }
  saveState(s);
  return combinedLog(s, priceLog, { bellKinds });
}
/** Zustellstatus an einem Ereignis vermerken (nur Status-Ereignisse). */
export function markDelivery(id, delivery) {
  const s = loadState();
  const e = s.events.find((x) => x.id === id);
  if (!e) return;
  e.delivery = delivery; saveState(s);
}

// ---------- Zeitplan: stündlich, nach EU- und US-Schluss, nach neuen Kursdaten ----------
const berlinHM = (d) => {
  const p = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
};
export const CLOSE_MARKS = [17 * 60 + 45, 22 * 60 + 20]; // Europe/Berlin: nach Xetra-Schluss (17:30) und US-Schluss (22:00)
/** Pure: Auswertung fällig? stündlich, eine Schlussmarke (täglich 17:45/22:20 Berlin) oder ein RSL-Wochenschluss (Fr Schluss + 30 min) liegt zwischen letztem Lauf und jetzt. */
export function dueNow(lastRunMs, nowMs, { everyMs = 3600e3 } = {}) {
  if (!lastRunMs) return true;
  if (nowMs - lastRunMs >= everyMs) return true;
  const a = berlinHM(new Date(lastRunMs)), b = berlinHM(new Date(nowMs));
  if (nowMs - lastRunMs > 86400e3) return true;
  if (CLOSE_MARKS.some((m) => (a <= b ? a < m && m <= b : a < m || m <= b))) return true;
  // freitags Handelsschluss + 30 min je Börse (RSL-Wochenschluss: 16:30 New York, 18:00 Xetra/STOXX), Sommerzeit korrekt
  return wcMarks(lastRunMs, nowMs).length > 0;
}
let timer = null, lastMs = 0, kickT = null;
export function start({ tickMs = 5 * 60e3, firstDelayMs = 60e3 } = {}) {
  if (timer) return;
  const s = loadState();
  lastMs = s.lastRun ? Date.parse(s.lastRun) : 0;
  const tick = async () => {
    if (dueNow(lastMs, Date.now())) { lastMs = Date.now(); await evaluate().catch(() => {}); }
  };
  setTimeout(tick, firstDelayMs).unref?.();
  timer = setInterval(tick, tickMs); timer.unref?.();
}
/** Nach neuen Kursdaten (ohlc-live): höchstens alle 10 Minuten, leicht verzögert. */
export function kick({ minGapMs = 10 * 60e3, delayMs = 30e3 } = {}) {
  if (kickT || Date.now() - lastMs < minGapMs) return;
  kickT = setTimeout(() => { kickT = null; lastMs = Date.now(); evaluate().catch(() => {}); }, delayMs);
  kickT.unref?.();
}
export function stop() { clearInterval(timer); timer = null; clearTimeout(kickT); kickT = null; }

// ---------- eingebaute Provider ----------
const dd = (x) => (x ? `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}` : '—');
const MN = { gold: 'Gold', silver: 'Silber' };
const DUE = new Set(['due', 'hold']);

/** Pure: GSW-Diff. snap: { asOf, dueSince, lots: { id: { symbol, metal, level, target, text } }, swaps: { swapId: { date, from, to } } } */
export function gswDiff(prev, next) {
  if (!prev || !next) return [];
  const out = [];
  for (const [id, l] of Object.entries(next.lots || {})) {
    const p = prev.lots?.[id];
    const isDue = DUE.has(l.level), wasDue = p && DUE.has(p.level);
    if (isDue && (!wasDue || p.target !== l.target))
      out.push({ key: `gsw:due:${id}:${l.target}:${next.dueSince || next.asOf}`, kind: 'gsw', title: `GSW: Swap fällig → ${MN[l.target] || l.target}`,
        text: `${l.symbol} (${MN[l.metal] || l.metal}): ${l.text} · Stand ${dd(next.asOf)}`, ref: { app: 'GSW', lot: id } });
    if (wasDue && !isDue && l.level !== 'info' && l.metal === p.metal)
      out.push({ key: `gsw:lapsed:${id}:${p.target}:${next.asOf}`, kind: 'gsw', title: p.level === 'hold' ? 'GSW: aufgeschobener Swap entfallen' : 'GSW: Swap nicht mehr fällig',
        text: `${l.symbol} (${MN[l.metal] || l.metal}): ${p.level === 'hold' ? 'Swap war wegen Haltefrist aufgeschoben; ' : ''}Regel wieder in ${MN[l.target] || l.target}, kein Swap nötig · Stand ${dd(next.asOf)}`, ref: { app: 'GSW', lot: id } });
  }
  for (const [sid, s] of Object.entries(next.swaps || {})) {
    if (prev.swaps?.[sid]) continue;
    out.push({ key: `gsw:swap:${sid}`, kind: 'gsw', title: `GSW: Swap gebucht ${MN[s.fromMetal] || ''} → ${MN[s.toMetal] || ''}`.trim(),
      text: `${dd(s.date)}: ${s.from || '?'} → ${s.to || '?'}`, ref: { app: 'GSW', swapId: sid } });
  }
  return out;
}

/** Pure: Swaps aus dem GSW-Buch (gebucht = Verkauf + Kauf mit gleicher swapId). */
export function gswSwaps(lots = []) {
  const m = {};
  const f = (v) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: 4 }) : '?');
  for (const l of lots) {
    const sell = l.sellSwapId || (l.status === 'closed' && l.swapId && !l.buySwapId ? l.swapId : null);
    const buy = l.buySwapId || (l.status === 'open' && l.swapId && !l.sellSwapId ? l.swapId : null);
    if (sell) { const s = (m[sell] ||= {}); s.date = s.date || l.sellDate; s.from = `${f(l.qty)} ${l.symbol}`; s.fromMetal = l.metal; }
    if (buy) { const s = (m[buy] ||= {}); s.date = l.buyDate || s.date; s.to = `${f(l.qty)} ${l.symbol}`; s.toMetal = l.metal; }
  }
  return m;
}

registerStatusProvider({
  id: 'gsw', label: 'GSW (Swap fällig / gebucht / entfallen)', kind: 'gsw',
  async snapshot() {
    const book = await import('./gsw/book.js');
    const b = book.loadBook();
    const swaps = gswSwaps(b.lots || []);
    const open = book.openLots(b);
    if (!open.length) return { asOf: null, dueSince: null, lots: {}, swaps };
    const svc = await import('./gsw/service.js');
    const st = await svc.status({});
    const lots = {};
    for (const r of st.book?.open || []) lots[r.id] = { symbol: r.symbol, metal: r.metal, level: r.action?.level || 'info', target: r.action?.target || null, text: r.action?.text || '' };
    const dueSince = st.state?.due?.due ? `sig${st.asOf}` : `rule${st.state?.lastSwitch?.execDate || ''}`;
    return { asOf: st.asOf, dueSince, lots, swaps };
  },
  diff: gswDiff,
  // ohne Stand (Erstlauf, Reset): fällige/aufgeschobene Swaps melden; gebuchte Swaps sind vergangene Ereignisse, nicht neu melden
  empty: (snap) => ({ asOf: snap?.asOf ?? null, dueSince: snap?.dueSince ?? null, lots: {}, swaps: { ...(snap?.swaps || {}) } }),
});

// ---------- RSL: nur auf Basis des Freitagsschlusses (Regelwerk; AT-21) ----------
// Stichtag je Universum = letzter Freitag nach Handelsschluss + 30 min (lib/fn/rsl-weekclose.js); gerechnet wird mit
// rsl26 basis=FRI, also genau wie die RSL26-App im Modus „Fr-Schluss (regelkonform)“.
export { weekCloseAsOf, settleMarksBetween, MARKET_CLOSE } from './fn/rsl-weekclose.js';
const basisText = (asOf, holiday) => wcBasisText({ asOf, holiday });

/** Pure: RSL-Diff. snap: { pos: { id: { symbol, universe, signal, reason, lastDate, week?, holiday? } }, buy: { U: { asOf, week?, holiday?, list: [{ ticker, rank }] } } } */
export function rslDiff(prev, next) {
  if (!prev || !next) return [];
  const out = [];
  for (const [id, p] of Object.entries(next.pos || {})) {
    const was = prev.pos?.[id];
    if (p.signal && !(was && was.signal))
      out.push({ key: `rsl:sell:${id}:${p.reason || 'exit'}:${p.week ? `wk${p.week}` : p.lastDate || ''}`, kind: 'rslSell', title: `RSL: Verkaufssignal ${p.symbol}`,
        text: `${p.symbol} (${p.universe}): ${p.reason || 'Exit-Signal'}${p.week ? ` · ${basisText(p.lastDate, p.holiday)}` : p.lastDate ? ` · Kurs vom ${dd(p.lastDate)}` : ''}`, ref: { app: 'RSL26', universe: p.universe, symbol: p.symbol } });
  }
  for (const [u, b] of Object.entries(next.buy || {})) {
    const before = new Set((prev.buy?.[u]?.list || []).map((c) => c.ticker));
    // Universum neu beobachtet = kein Stand → aktuelle Kandidaten melden (Regel: kein oder anderer Stand → neu)
    for (const c of b.list || []) {
      if (before.has(c.ticker)) continue;
      out.push({ key: `rsl:buy:${u}:${c.ticker}:${b.week ? `wk${b.week}` : b.asOf || ''}`, kind: 'rslBuy', title: `RSL: neuer Kauf-Kandidat ${c.ticker}`,
        text: `${c.ticker} (${u}, Rang ${c.rank}) ist neu im Kauf-Fenster für einen freien Slot${b.week ? ` · ${basisText(b.asOf, b.holiday)}` : b.asOf ? ` · Stand ${dd(b.asOf)}` : ''}. Nur Hinweis, Kauf manuell.`, ref: { app: 'RSL26', universe: u, symbol: c.ticker } });
    }
  }
  return out;
}

registerStatusProvider({
  id: 'rsl', label: 'RSL26 (Verkaufssignale, Kauf-Kandidaten)',
  async snapshot() {
    const [{ migrateBook }, ts, { canonUniverse }, { buySlotCandidates }] = await Promise.all([
      import('./rsl-watchlist.js'), import('./tool-settings.js'), import('./fn/grokki-universes.js'), import('../public/js/fn/rsl-slots.js')]);
    const { book } = migrateBook(store.read('rsl-watchlist', null)); // nur lesen
    const open = book.positions.filter((p) => p && (p.status || 'open') === 'open' && p.symbol);
    const cfg = ts.getTool('RSL26');
    const unis = [...new Set([...open.map((p) => canonUniverse(p.universe || 'SPX')), canonUniverse(cfg.universe || 'SPX')])];
    const { default: rsl26 } = await import('./fn/rsl26.js');
    const pos = {}, buy = {};
    for (const u of unis) {
      const sv = { n: 5, trail: 20, trailLock: 4, maSkip: 1, rsExit: 1, confirmWeeks: 1, ranking: 'RSL26', ...cfg, ...(cfg.byUniverse?.[u] || {}) }; // Standardwerte wie die RSL26-App
      const q = { universe: u, watch: '1', n: sv.n, rrgExit: sv.rrgExit, rankTop: sv.rankTop, confirmWeeks: sv.confirmWeeks, rsExit: sv.rsExit, trail: sv.trail, trailLock: sv.trailLock, ranking: sv.ranking, maSkip: sv.maSkip };
      for (const k of Object.keys(q)) if (q[k] == null) delete q[k];
      // Regelwerk: nur Kurse bis zum Stichtag der letzten abgeschlossenen Woche (gleicher Aufruf wie die App im Modus Fr-Schluss)
      const r = await rsl26({ ...q, basis: 'FRI' });
      const wk = r.weekClose;
      if (!wk?.asOf) throw new Error(`${u}: kein Wochenschluss`);
      for (const p of r.positions || []) {
        if (canonUniverse(p.universe || 'SPX') !== u || !p.id) continue;
        // nach dem Stichtag gekauft: rsl26 setzt exitSignal=false (signalPending) → Meldung frühestens am nächsten Freitag
        pos[p.id] = { symbol: p.symbol, universe: u, signal: !!p.exitSignal, reason: p.exitShort || p.exitReason || null, lastDate: wk.asOf, week: wk.week, holiday: wk.holiday };
      }
      // Rückkauf-Sperre nach Trailing-Exit (rsl26 → trailLocks): gesperrte Titel sind kein Kauf-Kandidat
      const locked = (r.trailLocks || []).filter((l) => canonUniverse(l.universe || 'SPX') === u).map((l) => l.symbol);
      const slots = buySlotCandidates(r.rows || [], r.positions || [], { n: Number(sv.n) || 5, universe: u, skipMa: !!Number(sv.maSkip ?? 1), lockedSymbols: locked });
      buy[u] = { asOf: wk.asOf, week: wk.week, holiday: wk.holiday, list: slots.candidates.map((c) => ({ ticker: c.ticker, rank: c.rank })) };
    }
    return { pos, buy };
  },
  // ohne Stand (Erstlauf, Reset): alle aktiven Verkaufssignale und die aktuellen Kauf-Kandidaten je Universum melden
  empty: () => ({ pos: {}, buy: {} }),
  diff: rslDiff,
});
