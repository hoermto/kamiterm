// Amber Terminal: four panels, each with its own command line, plus the global one at the top.
// The global command runs in the active panel. Your layout is saved to the data folder.
import { isTyping } from "./shortcuts.js";
import { APP_VERSION } from "./version.js";
import { api, esc, px, pct, cls } from "./api.js";
import { parse, defaultFn, suggestions, securityQuery } from "./commands.js";
import { FUNCS } from "./fn/index.js";
import { loadPrefs, countApp, onPrefs, getPrefs, getUsage } from "./prefs.js";
import { barApps, barCandidates } from "./prefs-core.js";
import { sessionState, sessionTitle } from "./markets-core.js";
import { lookupList, bbgCode } from "./securities.js";
import {
  tableBlocks,
  buildCsv,
  csvName,
  downloadText,
  linkSources,
  delayTag,
} from "./ui.js";

const $ = (s, el = document) => el.querySelector(s);
const grid = $("#grid");
if ($("#appVer")) $("#appVer").textContent = `v${APP_VERSION}`;
const LAYOUTS = { 1: "one", 2: "two", 4: "" };
const DEFAULT = ["WEI", "TOP", "SPX INDEX GP", "ECO"];

let state = { layout: 4, panels: DEFAULT.slice(), active: 0 };
const panels = [];
let saveTimer;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      api
        .put("/api/state", {
          amber: {
            layout: state.layout,
            panels: panels.map((p) => p.cmd),
            active: state.active,
          },
        })
        .catch(() => {}),
    500,
  );
};

export function toast(msg, err = false, ms = 4500) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast${err ? " err" : ""}`;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

class Panel {
  constructor(i) {
    this.i = i;
    this.cmd = "";
    this.sec = null;
    this.history = [];
    this.cleanups = [];
    const el = document.createElement("section");
    el.className = "panel";
    el.innerHTML = `<div class="pbar"><span class="pnum">${i + 1}</span><form class="pcmd" autocomplete="off"><input spellcheck="false" placeholder="ticker, function, GO"></form><button class="pbtn" data-a="export" title="Download every table on this screen as one CSV file, for Excel">Export</button><button class="pbtn" data-a="back" title="Back (Esc)">◂</button><button class="pbtn" data-a="max" title="Full screen">▢</button></div><div class="ptitle"><span class="fn"></span><span class="sec"></span></div><div class="pbody"></div><div class="pfoot"><span class="src"></span><span class="asof"></span></div>`;
    this.el = el;
    this.input = $("input", el);
    this.body = $(".pbody", el);
    $("form", el).onsubmit = (e) => {
      e.preventDefault();
      hideSuggest();
      this.run(this.input.value);
    };
    this.input.addEventListener("input", () => showSuggest(this.input));
    this.input.addEventListener("keydown", (e) => suggestKeys(e, this.input));
    el.addEventListener("mousedown", () => setActive(this.i));
    $('[data-a="back"]', el).onclick = () => this.back();
    $('[data-a="export"]', el).onclick = () => this.exportCsv();
    $('[data-a="max"]', el).onclick = () => el.classList.toggle("max");
    $(".ptitle", el).ondblclick = () => el.classList.toggle("max");
  }

  // Every table on the screen, one CSV file, named <FUNCTION>-<security>-<date>.csv.
  exportCsv() {
    const blocks = tableBlocks(this.body);
    if (!blocks.length)
      return toast(
        "This screen has no tables to export. HP shows a price history as a table.",
        true,
      );
    const sec = this.subject ? bbgCode(this.subject) : "";
    const heading = `${this.fn} ${this.fname}${sec ? `, ${sec}` : ""}, exported ${new Date().toLocaleString()}`;
    downloadText(
      csvName(this.fn, sec),
      buildCsv(blocks, {
        heading,
        footer: this.srcText ? `Source: ${this.srcText}` : "",
      }),
    );
    toast(
      `Exported ${blocks.length} table${blocks.length > 1 ? "s" : ""} to ${csvName(this.fn, sec)}`,
    );
  }

  back() {
    this.history.pop();
    const prev = this.history.pop();
    if (prev) this.run(prev, { count: false });
  }

  // A screen that follows live data (ctx.follow) is rebuilt quietly when the server has newer bars: off screen,
  // swapped in when done, scroll position and open sections kept. Waits while the user is typing in the panel.
  quietRefresh() {
    if (this.refreshing || !this.cmd) return;
    const a = document.activeElement;
    if (a && this.body.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
      clearTimeout(this.quietRetry);
      this.quietRetry = setTimeout(() => this.quietRefresh(), 30e3);
      return;
    }
    this.refreshing = true;
    this.run(this.cmd, { quiet: true }).finally(() => (this.refreshing = false));
  }

  // count: false for runs the user didn't start now (restoring panels at startup, going back).
  // quiet: rebuild the current screen off screen and swap it in (live data, see quietRefresh).
  async run(input, { push = true, count = true, quiet = false } = {}) {
    if (quiet) [push, count] = [false, false];
    const p = parse(input);
    if (!p) return;
    let { fn, sec, args } = p;
    if (sec) this.sec = sec;
    if (!fn) fn = defaultFn(this.sec);
    const f = FUNCS[fn];
    if (!f)
      return toast(`No function called ${fn}. Type HELP for the list.`, true);
    if (f.needs && !this.sec)
      return toast(
        `${fn} needs a security first, for example AAPL US EQUITY ${fn}.`,
        true,
      );
    const subject = f.needs ? this.sec : null;
    if (count) countApp(fn); // app usage: ranks the top bar in auto mode (SETTINGS)
    // A quiet run keeps the screen on view (its token, cleanups and liveData) until the new one is ready.
    const base = quiet ? this.token : null;
    const oldCleanups = quiet ? this.cleanups.length : 0;
    if (!quiet) {
      Object.assign(this, { fn, fname: f.name, subject, srcText: "", liveData: null });
      this.cmd = `${subject ? `${subject.raw} ` : ""}${fn}${args.length ? ` ${args.join(" ")}` : ""}`;
      if (push) this.history.push(this.cmd);
      if (this.history.length > 50) this.history.shift();
      this.input.value = "";
      this.input.placeholder = this.cmd;
      for (const c of this.cleanups.splice(0))
        try {
          c();
        } catch {}
      $(".fn", this.el).textContent = `${fn}  ${f.name}`;
      $(".sec", this.el).textContent = subject ? subject.name || subject.raw : "";
      $(".src", this.el).textContent = "";
      $(".asof", this.el).textContent = "";
      this.body.innerHTML = `<div class="loading">Loading ${esc(f.name)}</div>`;
    }
    const token = quiet ? {} : (this.token = {});
    if (quiet) this.quietToken = token;
    // quiet: alive while no other run started; becomes the panel's token when swapped in
    const isLive = quiet ? () => this.quietToken === token && (this.token === base || this.token === token) : () => token === this.token;
    const target = quiet ? document.createElement("div") : this.body;
    let follows = null;
    const ctx = {
      el: target,
      quiet,
      sec: subject,
      args,
      named: !!sec,
      panel: this,
      live: isLive,
      // The screen shows data the server refreshes in the background ({ key, version } from the API): it is
      // rebuilt quietly when newer bars come (event "ohlc", or the minute heartbeat in followLive()).
      follow: (live) => {
        if (!live?.key) return;
        follows = { key: live.key, version: live.version ?? 0 };
        if (!quiet && isLive()) this.liveData = follows;
      },
      setSource: (src) => {
        this.srcText = String(src ?? "");
        const s = $(".src", this.el);
        s.innerHTML = linkSources(this.srcText);
        s.title = this.srcText;
        $(".asof", this.el).textContent =
          `as of ${new Date().toLocaleTimeString()}`;
      },
      setTitle: (t) => ($(".sec", this.el).textContent = t),
      go: (c) => this.run(c),
      // A screen that edits something (W ADD NVDA) leaves the plain command behind, so a reload doesn't repeat it.
      setCmd: (c) => {
        if (!isLive()) return;
        this.cmd = c;
        this.history[this.history.length - 1] = c;
        this.input.placeholder = c;
        save();
      },
      toast,
      onCleanup: (fn2) => this.cleanups.push(fn2),
      every: (ms, fn2) => {
        const id = setInterval(() => isLive() && fn2(), ms);
        this.cleanups.push(() => clearInterval(id));
      },
    };
    if (quiet) {
      // Old view stays until the new one is complete; a failed or overtaken rebuild leaves it as it was.
      try {
        await f.render(ctx);
      } catch (e) {
        console.warn(`Quiet refresh of ${this.cmd} failed: ${e.message}`);
        if (this.quietToken === token) this.quietToken = null;
        for (const c of this.cleanups.splice(oldCleanups)) try { c(); } catch {}
        return;
      }
      if (!isLive() || this.token !== base) return;
      const open = new Set([...this.body.querySelectorAll("details[open] > summary")].map((s) => s.textContent));
      const top = this.body.scrollTop;
      const left = this.body.scrollLeft;
      this.token = token;
      this.quietToken = null;
      for (const c of this.cleanups.splice(0, oldCleanups)) try { c(); } catch {}
      this.body.replaceChildren(...target.childNodes);
      for (const d of this.body.querySelectorAll("details")) if (open.has(d.querySelector(":scope > summary")?.textContent)) d.open = true;
      this.body.scrollTop = top;
      this.body.scrollLeft = left;
      this.liveData = follows;
      return;
    }
    try {
      await f.render(ctx);
    } catch (e) {
      if (token === this.token)
        this.body.innerHTML = `<div class="err">${esc(e.message)}</div><div class="hint">Type HELP for functions, or DATA to see where each screen's data comes from.</div>`;
    }
    save();
  }
}

function setActive(i) {
  state.active = i;
  panels.forEach((p, j) => p.el.classList.toggle("active", i === j));
}

function setLayout(n) {
  state.layout = n;
  grid.className = `grid ${LAYOUTS[n] ?? ""}`;
  panels.forEach((p, j) => (p.el.style.display = j < n ? "" : "none"));
  if (state.active >= n) setActive(0);
  save();
}

// ---------- autocomplete: securities (Bloomberg's SECF) above functions ----------
let sugIdx = -1;
let secTimer;
const secCache = new Map();
const secHtml = (code) => {
  const w = code.split(" ");
  return `${esc(w.slice(0, -1).join(" "))} <i class="yk">${esc(w.at(-1))}</i>`;
};
function showSuggest(input, keep = false) {
  const box = $("#suggest");
  if (!keep) sugIdx = -1;
  const sq = securityQuery(input.value);
  clearTimeout(secTimer);
  if (sq && !secCache.has(sq.query))
    secTimer = setTimeout(() => lookup(input, sq.query), 200);
  const secs = sq ? secCache.get(sq.query) || lookupList([], sq.query) : [];
  const funcs = suggestions(input.value).slice(0, secs.length ? 6 : 12);
  // Nothing to show yet: close the box but keep the pending lookup.
  if ((!secs.length && !funcs.length) || !input.value.trim())
    return void ($("#suggest").hidden = true);
  const r = input.getBoundingClientRect();
  box.style.left = `${r.left}px`;
  box.style.top = `${r.bottom + 2}px`;
  box.innerHTML =
    secs
      .map(
        (s) =>
          `<div class="secrow" data-sec="${esc(s.code)}"><b>${secHtml(s.code)}</b><span>${esc(s.name)}</span></div>`,
      )
      .join("") +
    funcs
      .map(
        (f) =>
          `<div data-id="${f.id}"><b>${f.id}</b><span>${esc(f.name)}</span></div>`,
      )
      .join("");
  [...box.children].forEach((d, i) => d.classList.toggle("sel", i === sugIdx));
  box.hidden = false;
  box.onmousedown = (e) => {
    const d = e.target.closest("[data-id],[data-sec]");
    if (!d) return;
    e.preventDefault();
    pick(input, d);
  };
}
// Debounced lookup against /api/search; a stale answer for words no longer being typed is dropped.
async function lookup(input, q) {
  let res = [];
  try {
    res = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
  } catch {}
  secCache.set(q, lookupList(res, q));
  if (secCache.size > 200) secCache.delete(secCache.keys().next().value);
  if (
    document.activeElement === input &&
    securityQuery(input.value)?.query === q
  )
    showSuggest(input, true);
}
function hideSuggest() {
  $("#suggest").hidden = true;
  sugIdx = -1;
  clearTimeout(secTimer);
}
// A function replaces the word being typed; a security replaces the words of the name ("bank of am").
function pick(input, d) {
  const words = input.value.trim().split(/\s+/);
  if (d.dataset.sec) {
    const sq = securityQuery(input.value);
    input.value = `${[...words.slice(0, sq ? sq.start : words.length - 1), d.dataset.sec].join(" ")} `;
  } else {
    words[words.length - 1] = d.dataset.id;
    input.value = `${words.join(" ")} `;
  }
  hideSuggest();
  input.focus();
}
function suggestKeys(e, input) {
  const box = $("#suggest");
  if (e.key === "Escape") {
    if (!box.hidden) return hideSuggest();
    const p = panels[state.active];
    if (input !== $("#gInput") || p) p?.back();
    return;
  }
  if (box.hidden) return;
  const items = [...box.children];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    sugIdx =
      (sugIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((d, i) => d.classList.toggle("sel", i === sugIdx));
    items[sugIdx]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Tab" && items.length) {
    e.preventDefault();
    pick(input, items[Math.max(0, sugIdx)]);
  } else if (e.key === "Enter" && sugIdx >= 0) {
    e.preventDefault();
    pick(input, items[sugIdx]);
  }
}

// ---------- top bar ----------
const gInput = $("#gInput");
$("#globalCmd").onsubmit = (e) => {
  e.preventDefault();
  hideSuggest();
  const v = gInput.value.trim();
  if (!v) return;
  const n = /^(LAYOUT|GRID)\s+([124])$/i.exec(v);
  if (n) setLayout(+n[2]);
  else panels[state.active].run(v);
  gInput.value = "";
};
gInput.addEventListener("input", () => showSuggest(gInput));
gInput.addEventListener("keydown", (e) => suggestKeys(e, gInput));

// The yellow keys sit on the F-keys of a Bloomberg keyboard: F2 GOVT, F8 EQUITY, F9 CMDTY, F10 INDEX, F11 CRNCY.
const FKEYS = {
  F2: "GOVT",
  F8: "EQUITY",
  F9: "CMDTY",
  F10: "INDEX",
  F11: "CRNCY",
};
const fkeyOf = Object.fromEntries([
  ...Object.entries(FKEYS).map(([f, k]) => [k, f]),
  ["HELP", "F1"],
]);
// Yellow sector keys stay fixed on the left; the app keys after them come from SETTINGS:
// auto = most used first, custom = the user's own pick and order.
const YELLOW = ["GOVT", "EQUITY", "CMDTY", "INDEX", "CRNCY"];
function renderKeys() {
  const usage = getUsage();
  const apps = barApps(getPrefs(), usage, barCandidates(FUNCS));
  const yellow = YELLOW.map(
    (k) => `<button class="key" data-k="${k}"${fkeyOf[k] ? ` title="${fkeyOf[k]} on the keyboard"` : ""}>${fkeyOf[k] ? `<small>${fkeyOf[k]}</small>` : ""}${k}</button>`,
  );
  const fns = apps.map((k) => {
    const tip = [FUNCS[k]?.name, fkeyOf[k] ? `${fkeyOf[k]} on the keyboard` : "", usage[k] ? `used ${usage[k]}×` : ""].filter(Boolean).join(" · ");
    return `<button class="key fn" data-k="${esc(k)}" title="${esc(tip)}">${fkeyOf[k] ? `<small>${fkeyOf[k]}</small>` : ""}${esc(k)}</button>`;
  });
  $("#keys").innerHTML =
    [...yellow, ...fns].join("") +
    `<span style="flex:1"></span><button class="key fn" data-k="SETTINGS" title="Settings: colours, name, top-bar apps">⚙</button><button class="key fn quit" data-q="1" title="Quit: stop Amber Terminal and close the window">⏻</button><button class="key fn" data-l="1">1</button><button class="key fn" data-l="2">2</button><button class="key fn" data-l="4">4</button>`;
}
renderKeys();
// Re-rank only when the bar's settings change, not on every launch (keys would jump under the mouse);
// a new launch count shows on the next start or settings change.
let barSig = "";
onPrefs((p) => {
  const sig = JSON.stringify(p.bar);
  if (sig !== barSig) { barSig = sig; renderKeys(); }
});
$("#keys").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.q) return quitApp();
  if (b.dataset.l) return setLayout(+b.dataset.l);
  const k = b.dataset.k;
  if (b.classList.contains("fn")) panels[state.active].run(k);
  else {
    gInput.value = `${gInput.value.trim()} ${k} `.trimStart();
    gInput.focus();
  }
};

// Quit (⏻): stop the server, then close the window. A browser tab that may not be closed by script
// shows a "stopped" page instead.
async function quitApp() {
  if (!window.confirm("Quit Amber Terminal?\n\nThe server stops; alerts don't fire until you start it again with start.bat.")) return;
  try { window.amberEvents?.close(); } catch {}
  try { await api.post("/api/shutdown"); } catch {}
  document.title = "Amber Terminal stopped";
  document.body.innerHTML = `<div class="stopped"><b>${esc($(".brand .logo")?.textContent || "AMBER")} TERMINAL</b> stopped.<br><span class="hint">You can close this window. Start it again with start.bat.</span></div>`;
  setTimeout(() => window.close(), 300);
}

// Exchange clocks top right (SETTINGS > Market clocks): local time, dot = trading / extended hours / closed.
function clocks() {
  const now = new Date();
  $("#clocks").innerHTML = getPrefs()
    .clocks.map((c) => {
      const s = sessionState(c, now);
      return s ? `<span class="mk ${s.state}" title="${esc(sessionTitle(c, now))}"><i></i>${esc(c)} <b>${s.local}</b></span>` : "";
    })
    .join("");
}
clocks();
setInterval(clocks, 15e3);
onPrefs(clocks);

// Ticker tape: the big indices, gold, oil, the dollar and bitcoin, in one request.
const TAPE = [
  ["SPX", "^GSPC"],
  ["NDX", "^NDX"],
  ["INDU", "^DJI"],
  ["UKX", "^FTSE"],
  ["DAX", "^GDAXI"],
  ["NKY", "^N225"],
  ["HSI", "^HSI"],
  ["GOLD", "GC=F"],
  ["WTI", "CL=F"],
  ["US10Y", "^TNX"],
  ["EURUSD", "EURUSD=X"],
  ["USDJPY", "JPY=X"],
  ["BTC", "BTC-USD"],
  ["ETH", "ETH-USD"],
];
async function tape() {
  try {
    const { rows } = await api.fn("board", {
      symbols: TAPE.map(([, s]) => s).join(","),
    });
    const run = TAPE.map(([n, s]) => {
      const r = rows[s] || {};
      return `<span><b>${n}</b>${px(r.price)}${delayTag(r)} <span class="${cls(r.changePct)}">${pct(r.changePct)}</span></span>`;
    }).join("");
    $("#tape").innerHTML = run + run;
  } catch {}
}
tape();
setInterval(tape, 60e3);

// Screens with live data (ctx.follow) tell the server once a minute what they show, so it keeps refreshing
// those stocks; a newer version than the one on view (an "ohlc" event missed) rebuilds the screen quietly.
async function followLive() {
  const on = panels.filter((p) => p.liveData?.key && p.el.style.display !== "none");
  if (!on.length) return;
  try {
    const r = await api.post("/api/ohlc/follow", { keys: [...new Set(on.map((p) => p.liveData.key))] });
    for (const p of on) {
      const v = r?.versions?.[p.liveData?.key];
      if (v != null && v > p.liveData.version) p.quietRefresh();
    }
  } catch {}
}
setInterval(followLive, 60e3);

// Alerts fire on the server (ALRT); the event stream brings them here as a toast and a desktop notification.
function listenForAlerts() {
  if (!window.EventSource) return;
  // ?app=1: this is the app window from start.bat; closing the last window then stops the server.
  const isApp = new URLSearchParams(location.search).get("app") === "1";
  const streamId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const es = (window.amberEvents = new EventSource(`/api/events?id=${streamId}${isApp ? "&app=1" : ""}`));
  // Say goodbye when the page goes away: some browsers keep a closed window's connection open for a while,
  // and only a closed connection used to count. A reload says goodbye too and reconnects at once.
  addEventListener("pagehide", (e) => {
    if (e.persisted) return;
    try { fetch(`/api/events/bye?id=${streamId}`, { method: "POST", keepalive: true, headers: { "x-qt": "1" } }); } catch {}
  });
  es.addEventListener("update", (e) => {
    try { showUpdate(JSON.parse(e.data)); } catch {}
  });
  // Newer daily bars for a screen on view: rebuild it quietly (lib/ohlc-live.js).
  es.addEventListener("ohlc", (e) => {
    let x;
    try { x = JSON.parse(e.data); } catch { return; }
    for (const p of panels) if (p.liveData?.key === x.key && x.version > p.liveData.version) p.quietRefresh();
  });
  es.addEventListener("alert", (e) => {
    let a;
    try {
      a = JSON.parse(e.data);
    } catch {
      return;
    }
    toast(a.text, false, 12e3);
    try {
      if (window.Notification?.permission === "granted")
        new Notification("Amber Terminal alert", { body: a.text });
    } catch {}
    window.dispatchEvent(new CustomEvent("amber:alert", { detail: a }));
  });
}
listenForAlerts();

// Update warning: the server checks the git repo once a day (lib/updater.js). A newer version shows as a badge
// next to the version, plus one notice per session. Click the badge to check again now.
function showUpdate(st) {
  const b = $("#updBadge");
  if (!b || !st) return;
  const newer = st.state === "available" || st.state === "blocked";
  b.hidden = !newer;
  if (!newer) return;
  const v = st.remoteVersion ? ` v${st.remoteVersion}` : "";
  b.textContent = `⚠ UPDATE${v}`;
  b.classList.toggle("blocked", st.state === "blocked");
  const list = (st.commits || []).slice(0, 8).map((c) => `• ${c.subject}`).join("\n");
  const how = st.state === "blocked"
    ? `Not installed automatically: ${st.reason}.`
    : "Close the terminal and run start.bat to install it.";
  b.title = `${st.behind == null ? "Newer version" : `${st.behind} new commit(s)`} on ${st.branch}. ${how}\n${list}\nChecked ${new Date(st.checkedAt).toLocaleString()} · click to check again`;
  try {
    const seen = sessionStorage.getItem("amber.updSeen");
    if (seen !== st.remote) {
      sessionStorage.setItem("amber.updSeen", st.remote || "1");
      toast(`Update available${v}${st.behind == null ? "" : ` (${st.behind} commit(s))`}. ${how}`, false, 12e3);
    }
  } catch {}
}
api.get("/api/update").then(showUpdate).catch(() => {});
$("#updBadge")?.addEventListener("click", async () => {
  try {
    const st = await api.post("/api/update/check");
    showUpdate(st);
    if (!(st?.state === "available" || st?.state === "blocked")) toast(st?.state === "uptodate" ? "Amber Terminal is up to date." : `Update check: ${st?.reason || st?.state}`);
  } catch (e) {
    toast(`Update check failed: ${e.message}`, true);
  }
});

document.addEventListener("keydown", (e) => {
  if (FKEYS[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) {
    // A yellow key goes on the end of the command line being typed in (the top bar if none is).
    e.preventDefault();
    const a = document.activeElement;
    const input = a?.matches?.("#gInput, .pcmd input") ? a : gInput;
    input.value = `${input.value.trim()} ${FKEYS[e.key]} `.trimStart();
    input.focus();
    hideSuggest();
  } else if (e.key === "F1") {
    e.preventDefault();
    hideSuggest();
    panels[state.active].run("HELP");
  } else if ((e.metaKey || e.ctrlKey) && /^[1-4]$/.test(e.key)) {
    e.preventDefault();
    const i = +e.key - 1;
    if (i < state.layout) {
      setActive(i);
      panels[i].input.focus();
    }
  } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
    e.preventDefault();
    gInput.focus();
  } else if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(document.activeElement)) {
    // Tastenkürzel-Übersicht (KEYS) im aktiven Panel
    e.preventDefault();
    hideSuggest();
    panels[state.active].run("KEYS");
  } else if (e.key === "Escape" && !isTyping(document.activeElement) && !e.defaultPrevented) {
    // Esc außerhalb der Befehlszeilen: eine Ansicht zurück (in den Befehlszeilen regelt das suggestKeys)
    hideSuggest();
    panels[state.active]?.back();
  }
});

// ---------- start ----------
await loadPrefs(); // colour scheme, name, top-bar apps (SETTINGS)
for (let i = 0; i < 4; i++) {
  const p = new Panel(i);
  panels.push(p);
  grid.append(p.el);
}
try {
  const s = (await api.get("/api/state"))?.amber;
  if (s?.panels?.length === 4)
    state = { layout: s.layout || 4, panels: s.panels, active: s.active || 0 };
} catch {}
setLayout(state.layout);
setActive(state.active);
panels.forEach((p, i) => p.run(state.panels[i] || DEFAULT[i], { count: false }));
gInput.focus();
window.amber = { panels, run: (c, i = state.active) => panels[i].run(c) };
