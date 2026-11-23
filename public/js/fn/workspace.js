// Workspace: W, your own watchlist monitor (a Launchpad monitor), and ALRT, price alerts that fire from the server.
// The lists live in the server state (GET/PUT /api/state, key amberWatch = { lists: {MAIN: [...], TECH: [...]},
// active, names }); alerts use the engine in lib/alerts.js.
import { api, esc, px, pct, chg, cls } from "../api.js";
import { table, sect, html, delayTag } from "../ui.js";
import { toSecurity, bbgCode, yahooSymbol, lookupList } from "../securities.js";

export const DEFAULT_WATCH = [
  "SPX INDEX",
  "NDX INDEX",
  "AAPL US EQUITY",
  "NVDA US EQUITY",
  "MSFT US EQUITY",
  "BTC CRYPTO",
  "GC1 COMDTY",
  "EURUSD CURNCY",
];
const DEFAULT_NAMES = {
  "AAPL US EQUITY": "Apple Inc.",
  "NVDA US EQUITY": "NVIDIA Corporation",
  "MSFT US EQUITY": "Microsoft Corporation",
  "BTC CRYPTO": "Bitcoin",
  "EURUSD CURNCY": "Euro in US dollars",
};
const MAX = 60;
const words = (s) =>
  String(s || "")
    .toUpperCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
const secOf = (code) => toSecurity(words(code));

// ---------- several lists ----------
export const LIST_NAME = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
export const MAX_LISTS = 20;
const LIST_VERBS = { NEW: "NEW", CREATE: "NEW", RENAME: "RENAME", DROP: "DROP", DELLIST: "DROP" };
const RESERVED = ["ADD", "DEL", "DELETE", "REMOVE", "RM", "HOLD", ...Object.keys(LIST_VERBS)];

// ---------- W:HOLD, die Auto-Watchlist der Holdings ----------
// Virtuell und nur lesbar: der Server rechnet sie bei jedem Abruf aus den Holding-Quellen der Apps
// (RSL-Buch, GSW-Buch, PORT …, GET /api/watch/hold). Sie steht nie in amberWatch/state.json, darum zieht jede
// Buchung automatisch nach und es gibt nichts zu speichern oder zu synchronisieren.
export const HOLD = "HOLD";
export const HOLD_TAB = "W:HOLD";
/** W-Argumente -> null (normale Liste) | { show: true } | { error } für W HOLD / W W:HOLD. Eine eigene Liste HOLD (alt) hat bei "W HOLD" Vorrang. */
export function holdCommand(args, names = []) {
  const a = args.map((x) => String(x).toUpperCase());
  if (!a.length) return null;
  const hit = a[0] === HOLD_TAB || (a[0] === HOLD && !names.includes(HOLD));
  if (!hit) return null;
  if (a.length > 1) return { error: "W:HOLD füllt sich automatisch aus deinen Holdings (RSL, GSW, PORT) und lässt sich nicht bearbeiten. Kauf/Verkauf im jeweiligen Buch ändert sie." };
  return { show: true };
}
/** Quelle-Spalte: "RSL SPX 3.975 · GSW Gold 12". */
export const holdSources = (r) => (r?.sources || []).map((x) => `${x.source}${Number.isFinite(x.qty) && x.qty ? ` ${+x.qty.toFixed(4)}` : ""}`).join(" · ");
const loadHold = () => api.get("/api/watch/hold");
const holdNames = new Map(); // Namen der Holdings-Codes, nur im Speicher dieser Seite (nichts wird gespeichert)

/** W command words -> { show } | { op: NEW|RENAME|DROP, name, to } | { list, op, ws } (ADD/DEL, list null = active). */
export function watchCommand(args, names) {
  const a = args.map((x) => String(x).toUpperCase());
  if (!a.length) return { show: null };
  const [v, ...rest] = a;
  const verb = LIST_VERBS[v];
  if (verb === "NEW" || verb === "DROP") return { op: verb, name: rest[0] };
  if (verb === "RENAME") return rest.length >= 2 ? { op: verb, name: rest[0], to: rest[1] } : { op: verb, name: null, to: rest[0] };
  if (names.includes(v)) return rest.length ? { list: v, op: rest[0], ws: rest.slice(1) } : { show: v };
  return { list: null, op: v, ws: rest };
}

/** Normalises the saved amberWatch value: at least one list, a valid active list. */
export function watchState(w = {}) {
  const lists = {};
  for (const [k, v] of Object.entries(w.lists || {})) if (Array.isArray(v)) lists[k] = v.slice();
  if (!Object.keys(lists).length) lists.MAIN = DEFAULT_WATCH.slice();
  const active = lists[w.active] ? w.active : lists.MAIN ? "MAIN" : Object.keys(lists)[0];
  return { lists, active, names: { ...DEFAULT_NAMES, ...(w.names || {}) } };
}

/** Applies a command from watchCommand() to a state from watchState(). Returns { st, msg, code } or { error }; never changes st in place. */
export function applyWatch(st, cmd) {
  const names = Object.keys(st.lists);
  const next = { ...st, lists: { ...st.lists } };
  if (cmd.show !== undefined) {
    if (cmd.show) next.active = cmd.show;
    return { st: next };
  }
  if (cmd.op === "NEW") {
    const n = cmd.name;
    if (!n || !LIST_NAME.test(n)) return { error: "Name the list with letters, digits, - or _ (up to 20), for example W NEW TECH." };
    if (RESERVED.includes(n)) return { error: `${n} is a command word; pick another name.` };
    if (st.lists[n]) return { error: `There is already a list ${n}. Open it with W ${n}.` };
    if (names.length >= MAX_LISTS) return { error: `You can keep ${MAX_LISTS} lists. Delete one first (W DROP name).` };
    next.lists[n] = [];
    next.active = n;
    return { st: next, msg: `New list ${n}` };
  }
  if (cmd.op === "RENAME") {
    const from = cmd.name || st.active, to = cmd.to;
    if (!st.lists[from]) return { error: `There is no list ${from}.` };
    if (!to || !LIST_NAME.test(to)) return { error: "Give the new name, for example W RENAME TECH CHIPS (or W RENAME CHIPS for the open list)." };
    if (RESERVED.includes(to)) return { error: `${to} is a command word; pick another name.` };
    if (st.lists[to]) return { error: `There is already a list ${to}.` };
    // Keep the tab order: rebuild the object with the new key in the old place.
    next.lists = Object.fromEntries(Object.entries(st.lists).map(([k, v]) => [k === from ? to : k, v]));
    if (st.active === from) next.active = to;
    return { st: next, msg: `Renamed ${from} to ${to}` };
  }
  if (cmd.op === "DROP") {
    const n = cmd.name || st.active;
    if (!st.lists[n]) return { error: `There is no list ${n}.` };
    if (names.length <= 1) return { error: "This is your only list. Take securities off it instead." };
    delete next.lists[n];
    if (st.active === n) next.active = Object.keys(next.lists)[0];
    return { st: next, msg: `Deleted the list ${n}` };
  }
  const target = cmd.list || st.active;
  const r = editWatch(st.lists[target], cmd.op, cmd.ws);
  if (r.error) return { error: r.error };
  if (r.list === st.lists[target]) return { st, msg: r.msg, code: r.code };
  next.lists[target] = r.list;
  const added = r.msg.startsWith("Added");
  const msg = target === st.active ? r.msg : `${r.msg} ${added ? "to" : "from"} ${target}`;
  return { st: next, msg, code: r.code, added };
}

// W ADD NVDA, W ADD VOD LN, W DEL NVDA. Returns { list, code, msg } or { list (unchanged), error }.
export function editWatch(list, op, ws) {
  const verb = {
    ADD: "ADD",
    "+": "ADD",
    DEL: "DEL",
    DELETE: "DEL",
    REMOVE: "DEL",
    RM: "DEL",
    "-": "DEL",
  }[String(op || "").toUpperCase()];
  if (!verb)
    return {
      list,
      error: "Use W ADD or W DEL with a security, for example W ADD NVDA.",
    };
  const sec = ws?.length
    ? toSecurity(ws.map((w) => String(w).toUpperCase()))
    : null;
  if (!sec)
    return {
      list,
      error: `Type a security after ${verb}, for example W ${verb} NVDA or W ${verb} VOD LN.`,
    };
  let code = bbgCode(sec);
  if (verb === "ADD") {
    if (list.includes(code))
      return { list, code, msg: `${code} is already on the list` };
    if (list.length >= MAX)
      return {
        list,
        error: `The list holds ${MAX} securities. Take one off first.`,
      };
    return { list: [...list, code], code, msg: `Added ${code}` };
  }
  if (!list.includes(code)) {
    // "W DEL VOD" when only VOD LN EQUITY is on the list.
    const same = list.filter((c) => c.split(" ")[0] === code.split(" ")[0]);
    if (same.length !== 1)
      return { list, code, error: `${code} isn't on the list` };
    code = same[0];
  }
  return { list: list.filter((c) => c !== code), code, msg: `Removed ${code}` };
}

// One monitor row per security: Yahoo's board (last, change, YTD, 52 weeks, 30 days), with crypto's last
// price and 24-hour change from the live exchange quote.
export function watchRows(list, board = {}, quotes = {}, names = {}) {
  return list.map((code) => {
    const sec = secOf(code);
    const y = (sec && board[yahooSymbol(sec)]) || {};
    const row = {
      code,
      sector: sec?.sector,
      name: names[code] || sec?.name || "",
      price: y.price,
      change: y.change,
      changePct: y.changePct,
      ytdPct: y.ytdPct,
      low52: y.low52,
      high52: y.high52,
      spark: y.spark,
      delayMin: y.delayMin,
      asOf: y.asOf,
    };
    const q = sec?.sector === "CRYPTO" ? quotes[`BINANCE:${sec.id}`] : null;
    if (Number.isFinite(q?.price) && q.price > 0) {
      row.price = q.price;
      row.delayMin = 0; // live from the exchange
      if (Number.isFinite(q.changePct)) {
        row.changePct = q.changePct;
        row.change = q.price - q.price / (1 + q.changePct / 100);
      }
      if (Number.isFinite(row.low52)) row.low52 = Math.min(row.low52, q.price);
      if (Number.isFinite(row.high52))
        row.high52 = Math.max(row.high52, q.price);
    }
    return row;
  });
}

const spark = (vals) => {
  if (!vals?.length || vals.length < 2) return "";
  const lo = Math.min(...vals),
    hi = Math.max(...vals),
    w = 70,
    h = 14;
  const pts = vals
    .map(
      (v, i) =>
        `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / (hi - lo || 1)) * h).toFixed(1)}`,
    )
    .join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" style="stroke:var(${vals.at(-1) >= vals[0] ? "--up" : "--down"})" stroke-width="1.2" points="${pts}"/></svg>`;
};

async function loadWatch() {
  const st = await api.get("/api/state");
  return watchState(st?.amberWatch || {});
}
// After a save: amber:watch, so the ticker tape (app.js) follows when it shows watchlists.
const saveWatch = (s) => api.put("/api/state", { amberWatch: { lists: s.lists, active: s.active, names: s.names } })
  .then((r) => { try { dispatchEvent(new Event("amber:watch")); } catch { /* no window (tests) */ } return r; });
// Every change starts from the saved lists, not from what this screen loaded earlier: a second W panel
// (or window) would otherwise write its older copy back over a change made in the first.
async function changeWatch(cmd) {
  const st = await loadWatch();
  const r = applyWatch(st, cmd);
  if (r.error) return r;
  if (r.added && !r.st.names[r.code]) r.st.names = { ...r.st.names, [r.code]: await nameFor(r.code) };
  if (r.st !== st) await saveWatch(r.st);
  return r;
}

/**
 * Adds securities to the active list in one save (FVSCAN's watchlist buttons). items: [{ words: ["SAP", "GR"], name }].
 * -> { list, added: [codes], already: [codes], errors: [msg] }
 */
export async function watchAdd(items, list = null) {
  let st = await loadWatch();
  if (list && !st.lists[list]) list = null; // deleted meanwhile: the active list
  const out = { list: list || st.active, added: [], already: [], errors: [] };
  for (const { words, name } of items) {
    const r = applyWatch(st, { list, op: "ADD", ws: words });
    if (r.error) { out.errors.push(r.error); if (/holds/.test(r.error)) break; continue; }
    if (!r.added) { out.already.push(r.code); continue; }
    st = r.st;
    if (!st.names[r.code] && name) st.names = { ...st.names, [r.code]: name };
    out.added.push(r.code);
  }
  if (out.added.length) await saveWatch(st);
  return out;
}
// The list the scanners (FVSCAN, DSCAN) add to: picked on the screen, kept in this browser
// (amber.watchTarget), the active W list until one is picked or when the picked one is gone.
const TARGET_KEY = "amber.watchTarget";
const readTarget = () => { try { return localStorage.getItem(TARGET_KEY) || ""; } catch { return ""; } };
const writeTarget = (n) => { try { localStorage.setItem(TARGET_KEY, n); } catch { /* private window */ } };
export async function watchTarget() {
  const st = await loadWatch();
  const pick = readTarget();
  const name = st.lists[pick] ? pick : st.active;
  return { name, active: st.active, lists: Object.keys(st.lists), codes: new Set(st.lists[name] || []) };
}

/**
 * Watchlist buttons for a scanner table: a W column (✓ on the list, + adds the row), and a bar with the list
 * picker and "Add all" for the rows shown.
 *   item(row) -> { words: ["SAP", "GR"], name } for W ADD;  key(row) -> id for data-add;  redraw() after a change.
 */
export function watchButtons(ctx, { item, key, redraw }) {
  const codeOf = (r) => bbgCode(toSecurity(item(r).words));
  const s = { watch: null };
  s.load = async () => { s.watch = await watchTarget().catch(() => s.watch); return s.watch; };
  s.has = (r) => !!s.watch?.codes.has(codeOf(r));
  s.add = async (rows) => {
    if (!s.watch || !rows.length) return;
    let r;
    try {
      r = await watchAdd(rows.map(item), s.watch.name);
    } catch (e) {
      ctx.toast(`Not added: ${e.message}`, true);
      return;
    }
    await s.load();
    const parts = [r.added.length && `Added ${r.added.length} to ${r.list}`, r.already.length && `${r.already.length} already there`, r.errors[0]].filter(Boolean);
    ctx.toast(parts.join(" · ") || "Nothing to add", !r.added.length && !!r.errors.length);
    if (ctx.live()) redraw();
  };
  s.col = () => ({
    id: "w", key: (r) => (s.has(r) ? 1 : 0), label: "W", html: true, sort: false,
    title: s.watch ? `On the watchlist ${s.watch.name}? + adds it` : "Watchlist",
    fmt: (x, r) => (x
      ? `<span class="dim" title="On ${esc(s.watch.name)}">✓</span>`
      : `<button type="button" class="ibtn" data-add="${esc(key(r))}" title="Add ${esc(key(r))} to the watchlist ${esc(s.watch?.name || "")}" aria-label="Add to watchlist">+</button>`),
  });
  /** "to [list ▾] [Add n missing]" for the rows shown. */
  s.bar = (rows) => {
    const w = s.watch;
    const span = document.createElement("span");
    span.dataset.wbar = "";
    if (!w) return span;
    const missing = rows.filter((r) => !s.has(r));
    span.innerHTML = ` · watchlist <select data-wlist title="The list + and Add all put stocks on (W ${esc(w.active)} is the open one)">${w.lists.map((n) => `<option${n === w.name ? " selected" : ""}>${esc(n)}</option>`).join("")}</select> <button type="button" data-addall${missing.length ? "" : " disabled"} title="Add every stock shown to the watchlist ${esc(w.name)}">${!missing.length ? `All on ${esc(w.name)}` : `Add ${missing.length === rows.length ? "all" : `${missing.length} missing`}`}</button>`;
    span.querySelector("[data-wlist]").onchange = async (e) => {
      writeTarget(e.target.value);
      await s.load();
      if (ctx.live()) redraw();
    };
    span.querySelector("[data-addall]").onclick = () => {
      if (missing.length > 25 && !confirm(`Add ${missing.length} stocks to the watchlist ${w.name}?`)) return;
      s.add(missing);
    };
    return span;
  };
  /** + buttons in `el` (capture: not the row click). rowOf(key) -> row. */
  s.bind = (el, rowOf) => el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]");
    if (!b) return;
    e.stopImmediatePropagation();
    const r = rowOf(b.dataset.add);
    if (r) s.add([r]);
  }, { capture: true });
  return s;
}

// A company's name for a new row, from the same search the command line's lookup uses.
async function nameFor(code) {
  const sec = secOf(code);
  if (!sec || sec.name) return sec?.name || "";
  try {
    const res = await api.get(
      `/api/search?q=${encodeURIComponent(sec.ticker)}`,
    );
    return (
      lookupList(res, sec.ticker, 30).find((r) => r.code === code)?.name || ""
    );
  } catch {
    return "";
  }
}

// ---------- alerts ----------
// "ALRT BTC ABOVE 70000" -> { words: ["BTC"], dir: "above", level: "70000" }
export function alertArgs(args) {
  const i = args.findIndex((a) => /^(ABOVE|BELOW|>|<|>=|<=)$/i.test(a));
  if (i < 1) return null;
  return {
    words: args.slice(0, i),
    dir: /^(ABOVE|>|>=)$/i.test(args[i]) ? "above" : "below",
    level: args[i + 1],
  };
}

// A price alert in the engine's rule format (Quant Terminal's): it fires once, the first time the last
// 1-minute close is at or beyond the level.
export function alertRule(ws, dir, level) {
  const sec = ws?.length
    ? toSecurity(ws.map((w) => String(w).toUpperCase()))
    : null;
  if (!sec)
    return { error: "Type a security, for example BTC or AAPL US EQUITY." };
  const d = String(dir || "").toLowerCase();
  if (d !== "above" && d !== "below") return { error: "Pick above or below." };
  const n = Number(
    String(level ?? "")
      .replace(/,/g, "")
      .trim(),
  );
  if (!String(level ?? "").trim() || !Number.isFinite(n))
    return { error: "Type a price level, for example 70000." };
  const code = bbgCode(sec);
  return {
    code,
    rule: {
      symbol: sec.id,
      tf: "1m",
      left: "close",
      op: d === "above" ? ">=" : "<=",
      right: n,
      trigger: "once",
      message: `${code} ${d} ${n}`,
    },
  };
}

const OP_WORDS = {
  ">": "above",
  ">=": "above",
  "<": "below",
  "<=": "below",
  crossesAbove: "crosses above",
  crossesBelow: "crosses below",
  crosses: "crosses",
};
export const alertText = (a) =>
  a.message || `${a.symbol} ${OP_WORDS[a.op] || a.op} ${a.right}`;
const when = (t) =>
  t
    ? new Date(t).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export function alertStatus(a) {
  if (a.active && a.error) return `Error: ${a.error}`;
  if (a.active) return "Watching";
  if (a.fired) return `Fired ${when(a.lastFiredAt)}`;
  return "Off";
}

async function askNotify() {
  try {
    if (window.Notification?.permission === "default")
      await Notification.requestPermission();
  } catch {}
}

async function createAlert(ctx, ws, dir, level) {
  const r = alertRule(ws, dir, level);
  if (r.error) return (ctx.toast(r.error, true), false);
  askNotify();
  try {
    await api.post("/api/alerts", r.rule);
  } catch (e) {
    return (ctx.toast(`Couldn't create the alert: ${e.message}`, true), false);
  }
  ctx.toast(`Alert set: ${r.rule.message}`);
  // Check straight away, so a level that's already passed fires now rather than in 15 seconds.
  api.post("/api/alerts/check").catch(() => {});
  return true;
}

function holdTab(ctx, on, n = null) {
  const b = document.createElement("button");
  b.className = `tab hold${on ? " on" : ""}`;
  b.textContent = n == null ? HOLD_TAB : `${HOLD_TAB} (${n})`;
  b.title = "Auto-Watchlist: alle aktuell gehaltenen Symbole aus RSL, GSW, PORT (W HOLD), nur lesbar";
  b.onclick = () => ctx.go(`W ${HOLD_TAB}`);
  return b;
}

// Die Auto-Watchlist: gleiche Kursspalten wie W, dazu "Quelle"; kein Hinzufügen/Löschen, alle 30 s neu berechnet.
async function renderHold(ctx, st) {
  if (!ctx.live()) return;
  ctx.setTitle(`${HOLD_TAB} Auto-Watchlist`);
  ctx.el.innerHTML = "";
  const listTabs = document.createElement("div");
  listTabs.className = "tabs";
  for (const n of Object.keys(st.lists)) {
    const b = document.createElement("button");
    b.className = "tab";
    b.textContent = `${n} (${st.lists[n].length})`;
    b.title = `Show the list ${n} (W ${n})`;
    b.onclick = () => ctx.go(`W ${n}`);
    listTabs.append(b);
  }
  const tab = holdTab(ctx, true);
  listTabs.append(tab);
  const info = html(`<div class="hint hold-info">Automatisch aus deinen Holdings berechnet, nicht editierbar: jede Buchung im RSL- oder GSW-Buch (bzw. PORT) zieht hier beim nächsten Abruf nach (spätestens 30 s). Click a row to open it.</div>`);
  const body = document.createElement("div");
  ctx.el.append(listTabs, info, body);
  const cols = [
    { key: "code", label: "Security", left: true, lbl: true },
    { key: "name", label: "Name", left: true, fmt: (v) => String(v || "").slice(0, 24) },
    { key: "quelle", label: "Quelle", left: true },
    { key: "price", label: "Last", html: true, fmt: (v, r) => px(v) + delayTag(r) },
    { key: "change", label: "Net chg", fmt: (v) => chg(v), cls },
    { key: "changePct", label: "% chg", fmt: (v) => pct(v), cls },
    { key: "ytdPct", label: "YTD %", fmt: (v) => pct(v), cls },
    { key: "low52", label: "52w low", fmt: px },
    { key: "high52", label: "52w high", fmt: px },
    { key: "spark", label: "30 days", html: true, fmt: spark },
  ];
  const load = async () => {
    let h;
    try { h = await loadHold(); } catch (e) {
      if (!ctx.live()) return;
      body.innerHTML = "";
      body.append(html(`<div class="hint">Holdings nicht lesbar: ${esc(e.message)}</div>`));
      return;
    }
    const list = h.codes || [];
    const byCode = new Map((h.rows || []).map((r) => [r.code, r]));
    const secs = list.map(secOf).filter(Boolean);
    const ys = [...new Set(secs.map(yahooSymbol).filter(Boolean))];
    const crypto = secs.filter((s) => s.sector === "CRYPTO").map((s) => s.id);
    const missing = list.filter((c) => !st.names[c] && !holdNames.has(c));
    const [b, q] = await Promise.all([
      ys.length ? api.fn("board", { symbols: ys.join(",") }).catch(() => ({ rows: {} })) : { rows: {} },
      crypto.length ? api.quotes(crypto).catch(() => ({})) : {},
      ...missing.map((c) => nameFor(c).then((n) => holdNames.set(c, n || ""), () => holdNames.set(c, ""))),
    ]);
    if (!ctx.live()) return;
    tab.textContent = `${HOLD_TAB} (${list.length})`;
    const top = ctx.el.scrollTop;
    body.innerHTML = "";
    const provs = (h.providers || []).map((p) => `${p.label}: ${p.error ? `Fehler (${p.error})` : p.count}`).join(" · ");
    body.append(sect(`${HOLD_TAB}, ${list.length} securities`), html(`<div class="hint">Quellen: ${esc(provs)}</div>`));
    if (!list.length) body.append(html(`<div class="hint">Gerade keine offenen Positionen. Sobald du im RSL- oder GSW-Buch kaufst, steht das Symbol hier.</div>`));
    else {
      const rows = watchRows(list, b.rows, q, { ...Object.fromEntries(holdNames), ...st.names }).map((r) => ({ ...r, quelle: holdSources(byCode.get(r.code)) }));
      body.append(table(rows, cols, { onRow: (r) => ctx.go(`${r.code} ${r.sector === "EQUITY" ? "DES" : "GP"}`) }));
    }
    ctx.el.scrollTop = top;
    ctx.setSource(`Holdings live aus ${(h.providers || []).map((p) => p.label).join(", ")}; Yahoo Finance prices (some exchanges delayed 15 minutes)${crypto.length ? ", crypto live from Binance" : ""}`);
  };
  await load();
  ctx.every(30e3, () => load().catch(() => {}));
}

export default [
  {
    id: "W",
    name: "Watchlist monitor",
    help: "Auto-Watchlist W:HOLD (auch W HOLD oder Reiter W:HOLD): alle aktuell gehaltenen Symbole aus RSL-Buch, GSW-Buch und PORT, live berechnet, Spalte Quelle, nicht editierbar; jede Buchung zieht automatisch nach. FVSCAN W:HOLD scannt sie.",
    group: "Workspace",
    source:
      "Yahoo Finance prices (some exchanges delayed 15 minutes), crypto live from Binance. Your list is saved on this computer",
    async render(ctx) {
      let st = await loadWatch().catch((e) => {
        ctx.toast(`Couldn't read your lists: ${e.message}`, true);
        return null;
      });
      if (!st) return;
      const hc = holdCommand(ctx.args, Object.keys(st.lists));
      if (hc) {
        if (hc.error) ctx.toast(hc.error, true);
        ctx.setCmd(`W ${HOLD_TAB}`);
        return renderHold(ctx, st);
      }
      if (ctx.args.length) {
        const cmd = watchCommand(ctx.args, Object.keys(st.lists));
        const r = await changeWatch(cmd).catch((e) => ({ error: `Couldn't save the list: ${e.message}` }));
        if (r.error) ctx.toast(r.error, true);
        else {
          if (r.msg) ctx.toast(r.msg);
          st = r.st;
        }
        ctx.setCmd("W");
      }
      if (!ctx.live()) return;
      const name = st.active;
      ctx.setTitle(`${name} list`);
      ctx.el.innerHTML = "";
      const listTabs = document.createElement("div");
      listTabs.className = "tabs";
      for (const n of Object.keys(st.lists)) {
        const b = document.createElement("button");
        b.className = `tab${n === name ? " on" : ""}`;
        b.textContent = `${n} (${st.lists[n].length})`;
        b.title = `Show the list ${n} (W ${n})`;
        b.onclick = () => ctx.go(`W ${n}`);
        listTabs.append(b);
      }
      listTabs.append(holdTab(ctx, false));
      const form = html(
        `<form class="wform" autocomplete="off"><input class="sec" spellcheck="false" placeholder="Add to ${esc(name)}: NVDA, VOD LN, BTC, GC1 COMDTY"><button type="submit">Add</button><span class="hint">Click a row to open it.</span></form>`,
      );
      const lists = html(
        `<form class="wform lists" autocomplete="off"><input name="n" spellcheck="false" maxlength="20" style="width:110px;text-transform:uppercase" placeholder="list name"><button type="submit" title="Start an empty list with this name (W NEW name)">New list</button><button type="button" data-a="rename" title="Give ${esc(name)} the name typed on the left (W RENAME name)">Rename ${esc(name)}</button><button type="button" data-a="drop" title="Delete the list ${esc(name)} (W DROP ${esc(name)})"${Object.keys(st.lists).length < 2 ? " disabled" : ""}>Delete ${esc(name)}</button></form>`,
      );
      const body = document.createElement("div");
      ctx.el.append(listTabs, form, lists, body);

      // Runs a list command on the saved lists; a new, renamed or deleted list redraws the whole screen.
      const run = async (cmd, { redraw = false } = {}) => {
        const r = await changeWatch(cmd).catch((e) => ({ error: `Couldn't save the list: ${e.message}` }));
        if (r.error) return ctx.toast(r.error, true);
        if (r.msg) ctx.toast(r.msg);
        if (redraw || r.st.active !== name) return ctx.go("W");
        st = r.st;
        const on = listTabs.querySelector(".tab.on");
        if (on) on.textContent = `${name} (${(st.lists[name] || []).length})`;
        load();
      };
      const edit = (op, ws) => run({ list: name, op, ws });
      const typed = () => lists.querySelector("input").value.trim().toUpperCase();
      lists.onsubmit = (e) => {
        e.preventDefault();
        run({ op: "NEW", name: typed() }, { redraw: true });
      };
      lists.querySelector('[data-a="rename"]').onclick = () =>
        run({ op: "RENAME", name, to: typed() }, { redraw: true });
      lists.querySelector('[data-a="drop"]').onclick = () => {
        if (window.confirm(`Delete the list ${name} with its ${(st.lists[name] || []).length} securities?`))
          run({ op: "DROP", name }, { redraw: true });
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const input = form.querySelector("input");
        const ws = words(input.value);
        input.value = "";
        if (ws.length) edit("ADD", ws);
      };
      body.addEventListener(
        "click",
        (e) => {
          const b = e.target.closest("[data-del]");
          if (!b) return;
          e.stopPropagation();
          edit("DEL", words(b.dataset.del));
        },
        true,
      );

      const cols = [
        { key: "code", label: "Security", left: true, lbl: true },
        {
          key: "name",
          label: "Name",
          left: true,
          fmt: (v) => String(v || "").slice(0, 24),
        },
        { key: "price", label: "Last", html: true, fmt: (v, r) => px(v) + delayTag(r) },
        { key: "change", label: "Net chg", fmt: (v) => chg(v), cls },
        { key: "changePct", label: "% chg", fmt: (v) => pct(v), cls },
        { key: "ytdPct", label: "YTD %", fmt: (v) => pct(v), cls },
        { key: "low52", label: "52w low", fmt: px },
        { key: "high52", label: "52w high", fmt: px },
        { key: "spark", label: "30 days", html: true, fmt: spark },
        {
          key: "code",
          label: "",
          html: true,
          fmt: (v) =>
            `<button class="xbtn" data-del="${esc(v)}" title="Take ${esc(v)} off the list">×</button>`,
        },
      ];
      const load = async () => {
        const list = st.lists[name] || [];
        const secs = list.map(secOf).filter(Boolean);
        const ys = [...new Set(secs.map(yahooSymbol).filter(Boolean))];
        const crypto = secs
          .filter((s) => s.sector === "CRYPTO")
          .map((s) => s.id);
        const [b, q] = await Promise.all([
          ys.length
            ? api
                .fn("board", { symbols: ys.join(",") })
                .catch(() => ({ rows: {} }))
            : { rows: {} },
          crypto.length ? api.quotes(crypto).catch(() => ({})) : {},
        ]);
        if (!ctx.live()) return;
        const top = ctx.el.scrollTop;
        body.innerHTML = "";
        body.append(sect(`${name}, ${list.length} securities`));
        if (!list.length)
          body.append(
            html(
              `<div class="hint">The list is empty. Add a security above, or type W ${esc(name)} ADD NVDA.</div>`,
            ),
          );
        else
          body.append(
            table(watchRows(list, b.rows, q, st.names), cols, {
              onRow: (r) =>
                ctx.go(`${r.code} ${r.sector === "EQUITY" ? "DES" : "GP"}`),
            }),
          );
        ctx.el.scrollTop = top;
        ctx.setSource(
          `Yahoo Finance prices (some exchanges delayed 15 minutes)${crypto.length ? ", crypto live from Binance" : ""}`,
        );
      };
      await load();
      ctx.every(30e3, () => load().catch(() => {}));
    },
  },
  {
    id: "ALRT",
    name: "Alerts",
    group: "Workspace",
    source:
      "The alert engine on this computer: 1-minute closes every 15 seconds, from Binance for crypto and Yahoo Finance for the rest",
    async render(ctx) {
      const a = alertArgs(ctx.args);
      if (a) await createAlert(ctx, a.words, a.dir, a.level);
      else if (ctx.args.length)
        ctx.toast("Try ALRT BTC ABOVE 70000, or use the form.", true);
      if (ctx.args.length) ctx.setCmd("ALRT");
      if (!ctx.live()) return;
      ctx.el.innerHTML = "";
      const form = html(
        `<form class="wform" autocomplete="off"><input class="sec" spellcheck="false" placeholder="Security: BTC, AAPL, SPX INDEX" value="${esc(a ? a.words.join(" ") : "")}"><select><option value="above">above</option><option value="below">below</option></select><input class="lvl" inputmode="decimal" placeholder="Level"><button type="submit">Create alert</button></form>`,
      );
      const body = document.createElement("div");
      ctx.el.append(
        form,
        html(
          `<p class="hint">An alert fires once, the first time the price is at or past your level. You'll get a pop-up here and a desktop notification, as long as the app is running.</p>`,
        ),
        body,
      );
      form.onsubmit = async (e) => {
        e.preventDefault();
        const [sec, lvl] = form.querySelectorAll("input");
        if (
          await createAlert(
            ctx,
            words(sec.value),
            form.querySelector("select").value,
            lvl.value,
          )
        ) {
          lvl.value = "";
          load();
        }
      };
      body.addEventListener(
        "click",
        async (e) => {
          const b = e.target.closest("[data-del]");
          if (!b) return;
          e.stopPropagation();
          try {
            await api.del(`/api/alerts/${encodeURIComponent(b.dataset.del)}`);
          } catch (err) {
            ctx.toast(`Couldn't delete the alert: ${err.message}`, true);
          }
          load();
        },
        true,
      );
      const load = async () => {
        const [list, log] = await Promise.all([
          api.get("/api/alerts"),
          api.get("/api/alerts/log").catch(() => []),
        ]);
        if (!ctx.live()) return;
        body.innerHTML = "";
        body.append(
          sect(`Your alerts, ${list.filter((x) => x.active).length} watching`),
        );
        if (!list.length)
          body.append(
            html(
              `<div class="hint">No alerts yet. Pick a security and a level above, or type ALRT BTC ABOVE 70000.</div>`,
            ),
          );
        else
          body.append(
            table(list.slice().reverse(), [
              { key: alertText, label: "Alert", left: true, lbl: true },
              {
                key: alertStatus,
                label: "Status",
                left: true,
                cls: (v) =>
                  v === "Watching"
                    ? "amber"
                    : /^Fired/.test(v)
                      ? "up"
                      : /^Error/.test(v)
                        ? "down"
                        : "dim",
              },
              { key: (x) => when(x.createdAt), label: "Created", left: true },
              { key: "fired", label: "Times fired" },
              {
                key: "id",
                label: "",
                html: true,
                fmt: (v) =>
                  `<button class="xbtn" data-del="${esc(v)}" title="Delete this alert">×</button>`,
              },
            ]),
          );
        if (log.length) {
          body.append(sect("Fired recently"));
          body.append(
            table(log.slice(0, 15), [
              { key: (x) => when(x.at), label: "When", left: true },
              { key: "text", label: "Alert", left: true, wrap: true },
              { key: "price", label: "Price", fmt: px },
            ]),
          );
        }
        ctx.setSource(
          "Alert engine on this computer, checking 1-minute closes every 15 seconds (Binance for crypto, Yahoo Finance for the rest)",
        );
      };
      const onFire = () => ctx.live() && load().catch(() => {});
      window.addEventListener("amber:alert", onFire);
      ctx.onCleanup(() => window.removeEventListener("amber:alert", onFire));
      await load();
      ctx.every(15e3, () => load().catch(() => {}));
    },
  },
];
