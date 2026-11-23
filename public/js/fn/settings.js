// SETTINGS: personal settings of this terminal, in tabs (public/js/settings-tabs.js):
//   Allgemein (name top left) · Benachrichtigungen (Glocke/Mail/Telegram) · Updates (update source) ·
//   Datenquellen (SEC contact email, daily price refresh, event cache) · UI (colour scheme, ticker tape, market
//   clocks, top bar apps, app usage counts behind the Auto bar). `SETTINGS NOTIFY` (also UPDATES, DATA, UI, GENERAL) opens a tab; the last tab is kept
//   in localStorage. Prefs are stored in data/state.json (amberPrefs, amberUsage) via prefs.js, the rest via the APIs.
import { esc, api } from "../api.js";
import { installUpdate } from "../update-install.js";
import { table, sect, html } from "../ui.js";
import { FUNCS } from "./index.js";
import { THEMES, TAPE_MODES, DEFAULT_NAME, DEFAULT_BAR, NAME_MAX, BAR_MIN, BAR_MAX, barApps, barCandidates, usageOrder } from "../prefs-core.js";
import { getPrefs, getUsage, savePrefs, resetUsage, onPrefs } from "../prefs.js";
import { EXCHANGES, DEFAULT_CLOCKS, CLOCKS_MAX, sessionState } from "../markets-core.js";
import { TAPE_SOURCES, TAPE_HOLD, tapeItems } from "../tape-core.js";
import { SETTINGS_TABS, SECTION_TAB, DEFAULT_TAB, TAB_STORE_KEY, pickTab, nextTab } from "../settings-tabs.js";

const fname = (id) => FUNCS[id]?.name || "";
const btn = (label, onclick, title = "") => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (title) b.title = title;
  b.onclick = onclick;
  return b;
};
const row = (...nodes) => {
  const r = html('<div class="wform"></div>');
  r.append(...nodes);
  return r;
};

// Where updates come from: data/launcher.cfg REPO_URL / BRANCH, read and written by the server.
const FROM = { settings: "set here", "start.bat": "from start.bat", default: "default" };
const STATE = { uptodate: "up to date", available: "update available", blocked: "update blocked", error: "error", unknown: "not checked yet" };
// Contact email for SEC EDGAR (filings, insider trades, M&A check, earnings history). SEC asks automated
// clients to name one; it is kept in data/settings.json on this computer and sent only to sec.gov.
async function renderSec(ctx, box, msg = "") {
  let c;
  try {
    c = await api.get("/api/sec/contact");
  } catch (e) {
    box.replaceChildren(html(`<p class="para dim">Not available: ${esc(e.message)}</p>`));
    return;
  }
  if (!ctx.live()) return;
  const form = html(`<form class="wform" autocomplete="off">
    <label>SEC contact email <input name="contact" type="email" style="width:280px" placeholder="name@example.com" value="${esc(c.contact)}"></label>
  </form>`);
  const save = async (contact, done) => {
    try {
      await api.put("/api/sec/contact", { contact });
      dispatchEvent(new Event("amber:sec-contact")); // screens check again whether one is set
      renderSec(ctx, box, done);
    } catch (e) {
      ctx.toast(`Not saved: ${e.message}`, true);
    }
  };
  form.append(
    btn("Save", () => form.requestSubmit()),
    btn("Remove", () => save("", "Removed"), "Remove the address: requests use the generic name again"),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    save(new FormData(form).get("contact"), "Saved");
  };
  box.replaceChildren(
    html(`<p class="para dim">SEC EDGAR asks every program that downloads its data to name a contact email; there is no default. It is saved in data/settings.json on this computer and sent only to sec.gov, in the request header. It is used by CF (company filings), INSD (insider trades, Form 4), DS (document search), FV and FVSCAN (annual figures of US stocks, SEC company facts) and the M&amp;A check in RSL26. Without it, requests go out under the generic Amber Terminal name: they mostly work, but SEC may slow them down or refuse them (403/429), most likely in a large FVSCAN scan, and those screens then say so.</p>`),
    form,
    html(`<p class="para">${c.contact ? `Requests name <b>${esc(c.contact)}</b>` : "No address set: generic name"}${msg ? ` · <span class="dim">${esc(msg)}</span>` : ""}</p>`),
  );
}

// Daily prices (OHLC cache): how old they may get while a market is open, and the background refresh for
// the scanner screens on view (RSL26, DSCAN, FVSCAN, HEAT), lib/ohlc-live.js.
async function renderOhlc(ctx, box, msg = "") {
  let c;
  try {
    c = await api.get("/api/ohlc/settings");
  } catch (e) {
    box.replaceChildren(html(`<p class="para dim">Not available: ${esc(e.message)}</p>`));
    return;
  }
  if (!ctx.live()) return;
  const form = html(`<form class="wform" autocomplete="off">
    <label>Refresh daily prices every <input name="min" type="number" min="5" max="60" step="1" style="width:56px" value="${esc(c.refreshMin)}"> minutes while the market is open</label>
  </form>`);
  const save = async (min, done) => {
    try {
      await api.put("/api/ohlc/settings", { refreshMin: Number(min) });
      renderOhlc(ctx, box, done);
    } catch (e) {
      ctx.toast(`Not saved: ${e.message}`, true);
    }
  };
  form.append(btn("Save", () => form.requestSubmit()), btn("Standard", () => save(15, "Back to 15 minutes"), "15 minutes"));
  form.onsubmit = (e) => {
    e.preventDefault();
    save(new FormData(form).get("min"), "Saved");
  };
  box.replaceChildren(
    html(`<p class="para dim">Daily prices are kept in data/cache/ohlcv.sqlite. While a stock's market is open (US 9:30–16:00 New York, Europe 9:00–17:35 Berlin) a screen fetches them again once they are older than this. RSL26, DSCAN, FVSCAN and HEAT also refresh their stocks in the background while they are on view, and update themselves quietly when the prices really changed. 5 to 60 minutes; short intervals with large universes (S&amp;P 500, STOXX 600) mean many Yahoo requests.</p>`),
    form,
    html(`<p class="para">Every <b>${esc(c.refreshMin)} minutes</b>${msg ? ` · <span class="dim">${esc(msg)}</span>` : ""}</p>`),
  );
}

// Event cache (dividends, earnings dates): data/cache/events.sqlite, rebuilt from the sources when cleared.
async function renderEventsCache(ctx, box, msg = "") {
  let st;
  try {
    st = await api.get("/api/events-cache");
  } catch (e) {
    box.replaceChildren(html(`<p class="para dim">Event cache not available: ${esc(e.message)}</p>`));
    return;
  }
  if (!ctx.live()) return;
  const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const r = row(
    html(`<span>Event cache: <b>${st.symbols}</b> stocks · ${st.dividends} dividends · ${st.earnings} earnings dates · ${kb(st.bytes)}${msg ? ` · <span class="dim">${esc(msg)}</span>` : ""}</span>`),
    btn("Clear", async () => {
      try {
        await api.post("/api/events-cache", { clear: true });
        renderEventsCache(ctx, box, "Cleared");
      } catch (e) {
        ctx.toast(`Not cleared: ${e.message}`, true);
      }
    }, "Empty the cache; DMOV and the scanners load the data again from the sources"),
  );
  box.replaceChildren(r, html(`<p class="para dim">Past dividends and earnings dates are kept in data/cache/events.sqlite, so they are downloaded only once. Clearing is safe.</p>`));
}

// Benachrichtigungen (Mail/Telegram) für Kurs- und Status-Alarme, gespeichert in den Einstellungen (data/settings.json,
// tools.NOTIFY). Ein Kanal ist aktiv, sobald er ausgefüllt ist; je Kanal Mehrfachauswahl der Alarmtypen, auch für
// die Glocke (Popup + 🔔-Zähler; abgewählte Typen stehen weiter in ALERTS, zählen aber nicht).
// SMTP-Passwort und Bot-Token zeigt die API nie (nur „gesetzt“); leeres Feld = behalten.
export async function renderNotify(ctx, box, msg = "") {
  let c;
  try {
    c = await api.get("/api/notify/config");
  } catch (e) {
    box.replaceChildren(html(`<p class="para dim">Nicht verfügbar: ${esc(e.message)}</p>`));
    return;
  }
  if (!ctx.live()) return;
  const s = c.smtp, set = (b) => (b ? "gesetzt – leer lassen = behalten" : "nicht gesetzt");
  const opt = (v, cur) => `<option value="${v}"${v === cur ? " selected" : ""}>${{ starttls: "STARTTLS", ssl: "SSL/TLS", none: "keine" }[v] || v}</option>`;
  const kinds = (name, sel) => `<span class="notify-kinds" data-kinds="${name}">${Object.entries(c.kinds).map(([k, label]) =>
    `<label style="margin-right:10px"><input type="checkbox" name="${name}" value="${k}"${sel.includes(k) ? " checked" : ""}> ${esc(label)}</label>`).join("")}</span>`;
  const state = (on, what) => `<b data-active="${on ? "1" : "0"}">${on ? "aktiv" : "aus"}</b>${on ? "" : ` <span class="dim">(${what})</span>`}`;
  const form = html(`<form class="wform notify-form" autocomplete="off" style="flex-wrap:wrap">
    <div style="flex-basis:100%">Glocke (im Terminal): <b>immer aktiv</b> <span class="dim">(Popup + 🔔-Zähler; abgewählte Typen stehen weiter in ALERTS, ohne Popup und ohne Zählen)</span></div>
    <div style="flex-basis:100%">Über die Glocke melden: ${kinds("bellKinds", c.bellKinds || Object.keys(c.kinds))}</div>
    <div style="flex-basis:100%;margin-top:6px">E-Mail: ${state(c.active.mail, "Host, Absender und Empfänger eintragen")}</div>
    <label>SMTP-Host <input name="host" style="width:180px" placeholder="smtp.example.com" value="${esc(s.host)}"></label>
    <label>Port <input name="port" type="number" min="1" max="65535" style="width:64px" value="${esc(s.port)}"></label>
    <label>Sicherheit <select name="security">${c.securityModes.map((m) => opt(m, s.security)).join("")}</select></label>
    <label>Benutzer <input name="user" style="width:180px" autocomplete="off" value="${esc(s.user)}"></label>
    <label>Passwort <input name="smtpPass" type="password" style="width:170px" autocomplete="new-password" placeholder="${esc(set(c.secrets.smtpPass))}"></label>
    <label>Absender <input name="from" style="width:220px" placeholder="Amber &lt;alarm@example.com&gt;" value="${esc(s.from)}"></label>
    <label>Empfänger <input name="to" style="width:300px" placeholder="a@example.com, b@example.com" value="${esc(s.to.join(", "))}"></label>
    <div style="flex-basis:100%">Per Mail melden: ${kinds("mailKinds", c.mailKinds)}</div>
    <div style="flex-basis:100%;margin-top:6px">Telegram: ${state(c.active.telegram, "Bot-Token und Chat-ID eintragen")}</div>
    <label>Bot-Token <input name="telegramToken" type="password" style="width:220px" autocomplete="new-password" placeholder="${esc(set(c.secrets.telegramToken))}"></label>
    <label>Chat-ID <input name="chatId" style="width:140px" placeholder="123456789" value="${esc(c.telegram.chatId)}"></label>
    <div style="flex-basis:100%">Per Telegram melden: ${kinds("telegramKinds", c.telegramKinds)}</div>
  </form>`);
  const collect = () => {
    const f = new FormData(form);
    return {
      smtp: { host: f.get("host"), port: f.get("port"), security: f.get("security"), user: f.get("user"), from: f.get("from"), to: f.get("to") },
      telegram: { chatId: f.get("chatId") },
      mailKinds: f.getAll("mailKinds"), telegramKinds: f.getAll("telegramKinds"), bellKinds: f.getAll("bellKinds"),
      smtpPass: f.get("smtpPass") || "", telegramToken: f.get("telegramToken") || "",
    };
  };
  const save = async (extra = {}, done = "Gespeichert") => {
    try {
      await api.put("/api/notify/config", { ...collect(), ...extra });
      renderNotify(ctx, box, done);
    } catch (e) {
      ctx.toast(`Nicht gespeichert: ${e.message}`, true);
    }
  };
  const test = (channel) => async () => {
    try {
      await api.post("/api/notify/test", { channel });
      ctx.toast(`Test-${channel === "mail" ? "Mail" : "Telegram-Nachricht"} verschickt`);
    } catch (e) {
      ctx.toast(`Test fehlgeschlagen: ${e.message}`, true);
    }
  };
  const tm = btn("Test-Mail", test("mail"), "Testet die gespeicherte Konfiguration (vorher speichern)");
  const tt = btn("Test-Telegram", test("telegram"), "Testet die gespeicherte Konfiguration (vorher speichern)");
  tm.disabled = !c.active.mail;
  tt.disabled = !c.active.telegram;
  const actions = row(
    btn("Speichern", () => save()),
    tm, tt,
    btn("Passwort löschen", () => save({ clearSmtpPass: true }, "SMTP-Passwort gelöscht"), "SMTP-Passwort aus den Einstellungen entfernen"),
    btn("Token löschen", () => save({ clearTelegramToken: true }, "Telegram-Token gelöscht"), "Telegram-Bot-Token entfernen (Telegram dann aus)"),
  );
  form.onsubmit = (e) => { e.preventDefault(); save(); };
  box.replaceChildren(
    msg ? html(`<p class="para dim">${esc(msg)}</p>`) : document.createTextNode(""),
    form, actions,
    html(`<p class="para dim">Ein Kanal ist aktiv, sobald er ausgefüllt ist (Mail: Host, Absender, Empfänger; Telegram: Bot-Token und Chat-ID); leer = keine Benachrichtigung über diesen Kanal. Popups und die Liste ALERTS gibt es immer. Gespeichert in den Einstellungen dieses Rechners (data/settings.json, wird nicht per Seafile synchronisiert): nur der Rechner, auf dem hier etwas eingetragen ist, verschickt – trage es auf genau einem Rechner ein (z. B. der Box), dann kommt nichts doppelt. Passwort und Token werden nie angezeigt oder geloggt; ein leeres Feld behält den gespeicherten Wert. Telegram: Bot bei @BotFather anlegen, dem Bot einmal schreiben, Chat-ID z. B. über @userinfobot.</p>`),
  );
}

async function renderUpdates(ctx, box, msg = "") {
  let c;
  try {
    c = await api.get("/api/update/config");
  } catch (e) {
    box.replaceChildren(html(`<p class="para dim">Update settings not available: ${esc(e.message)}</p>`));
    return;
  }
  if (!ctx.live()) return;
  const st = c.status || { state: "unknown" };
  const shownUrl = c.repoUrl || c.defaultRepoUrl;
  const form = html(`<form class="wform" autocomplete="off">
    <label>Repo URL <input name="repoUrl" style="width:380px" placeholder="${esc(c.defaultRepoUrl)}" value="${esc(c.repoFrom === "settings" ? c.repoUrl : "")}"></label>
    <label>Branch <input name="branch" style="width:110px" placeholder="${esc(c.repoFrom === "default" && c.branchFrom === "default" ? c.defaultBranch : c.branch)}" value="${esc(c.branchFrom === "settings" ? c.branch : "")}"></label>
  </form>`);
  const save = async (body, done) => {
    box.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await api.put("/api/update/config", body);
      renderUpdates(ctx, box, done);
    } catch (e) {
      ctx.toast(`Not saved: ${e.message}`, true);
      box.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
  form.append(
    btn("Save", () => form.requestSubmit(), "Save and check for updates now"),
    btn("Default", () => save({ repoUrl: "", branch: "" }, "Back to the default repo"), `Remove the setting: ${c.defaultRepoUrl}, ${c.defaultBranch}`),
    btn("Check now", async () => {
      try { await api.post("/api/update/check"); } catch {}
      renderUpdates(ctx, box, "Checked");
    }),
  );
  if (st.state === "available")
    form.append(btn("Install & restart", (e) => { e?.target && (e.target.disabled = true); installUpdate(ctx.toast); }, "Install the new version now and restart the terminal; data/ is kept and this page reloads"));
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    save({ repoUrl: f.get("repoUrl"), branch: f.get("branch") }, "Saved and checked");
  };
  const v = (x) => (x ? `v${x}` : "");
  const num = (x) => String(x || "").split(".").map(Number);
  const older = st.state === "available" && st.remoteVersion && st.localVersion && num(st.remoteVersion).reduce((d, n, i) => d || n - (num(st.localVersion)[i] || 0), 0) < 0;
  const stText = older
    ? `the branch has ${v(st.remoteVersion)}, older than the installed one (start.bat would install it)`
    : `${STATE[st.state] || st.state}${st.state === "available" ? ` ${v(st.remoteVersion)}` : ""}${st.reason ? ` (${esc(st.reason)})` : ""}`;
  box.replaceChildren(
    html(`<p class="para dim">New versions are looked up here and installed by start.bat on its next start, or right away with “Install &amp; restart”. Empty fields use start.bat's value or the default. Saved in data/launcher.cfg on this computer.${c.gitCheckout ? " This folder is a git checkout: without a URL here it updates from its own origin remote; its remotes are never changed." : ""}</p>`),
    form,
    html(`<p class="para">Using <b>${esc(st.source || shownUrl)}</b> · branch <b>${esc(c.branch)}</b> <span class="dim">(${FROM[c.repoFrom] || c.repoFrom})</span><br>Status: <b>${stText}</b> · installed ${esc(v(st.localVersion) || "?")}${st.local ? ` @ ${esc(st.local)}` : ""}${st.checkedAt ? ` · checked ${esc(new Date(st.checkedAt).toLocaleString())}` : ""}${msg ? ` · <span class="dim">${esc(msg)}</span>` : ""}</p>`),
  );
}

// Reiter: Allgemein · Benachrichtigungen · Updates · Datenquellen · UI (public/js/settings-tabs.js). Aufbau nur des
// aktiven Reiters; Speichern unverändert (prefs.js bzw. die jeweilige API). `SETTINGS NOTIFY` usw. öffnet den Reiter.
let activeTab = null;
const storedTab = () => { try { return localStorage.getItem(TAB_STORE_KEY); } catch { return null; } };
const storeTab = (id) => { try { localStorage.setItem(TAB_STORE_KEY, id); } catch { /* privat/voll: egal */ } };
const TAB_INTRO = {
  GENERAL: "Personal settings of this terminal, saved in data/state.json. Changes apply immediately.",
  NOTIFY: "Mail and Telegram for price and status alerts (ALERTS), saved in data/settings.json on this computer.",
  UPDATES: "Where new versions of the terminal come from (data/launcher.cfg on this computer).",
  DATA: "Data sources and local caches: SEC contact, daily price refresh, event cache.",
  UI: "Look of the terminal: colour scheme, ticker tape, market clocks, top bar and the app usage behind its Auto mode, saved in data/state.json. Changes apply immediately.",
};

function tabBar(ctx, cur) {
  const bar = html('<div class="tabs set-tabs" role="tablist" aria-label="Settings"></div>');
  for (const t of SETTINGS_TABS) {
    const b = btn(t.label, () => switchTab(ctx, t.id), `SETTINGS ${t.id}`);
    b.className = `tab set-tab${t.id === cur ? " on" : ""}`;
    b.id = `set-tab-${t.id}`;
    b.dataset.tab = t.id;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(t.id === cur));
    b.setAttribute("aria-controls", "set-pane");
    b.tabIndex = t.id === cur ? 0 : -1;
    bar.append(b);
  }
  bar.addEventListener("keydown", (e) => {
    const n = nextTab(cur, e.key);
    if (!n) return;
    e.preventDefault();
    switchTab(ctx, n);
    ctx.el.querySelector(`#set-tab-${n}`)?.focus();
  });
  return bar;
}
function switchTab(ctx, id) {
  if (id === activeTab) return;
  activeTab = id;
  storeTab(id);
  ctx.setCmd?.(id === DEFAULT_TAB ? "SETTINGS" : `SETTINGS ${id}`);
  render(ctx);
}

function render(ctx) {
  const p = getPrefs();
  const usage = getUsage();
  const cands = barCandidates(FUNCS);
  const save = async (patch, msg) => {
    try {
      await savePrefs(patch);
      if (msg) ctx.toast(msg);
    } catch (e) {
      ctx.toast(`Not saved: ${e.message}`, true);
    }
    if (ctx.live()) render(ctx);
  };
  const cur = activeTab || DEFAULT_TAB;
  const el = html(`<div class="set-pane" id="set-pane" role="tabpanel" aria-labelledby="set-tab-${cur}" data-pane="${cur}"></div>`);
  ctx.el.replaceChildren(tabBar(ctx, cur), el);
  el.append(html(`<p class="para dim">${esc(TAB_INTRO[cur] || "")}</p>`));
  const box = (attrs = "") => { const d = html(`<div ${attrs}><p class="para dim">Loading…</p></div>`); el.append(d); return d; };

  const sections = {
    // ---- name top left ----
    name() {
      el.append(sect("Name"));
  const name = document.createElement("input");
  name.name = "brandName";
  name.maxLength = NAME_MAX;
  name.value = p.name;
  name.placeholder = DEFAULT_NAME;
  name.style.width = "180px";
  name.title = `Shown top left instead of ${DEFAULT_NAME} (max. ${NAME_MAX} characters)`;
  const nameForm = html('<form class="wform" autocomplete="off"><label>Name </label></form>');
  nameForm.firstChild.append(name);
  nameForm.append(btn("Save", () => nameForm.requestSubmit()), btn("Default", () => save({ name: DEFAULT_NAME }, "Name reset")));
  nameForm.onsubmit = (e) => {
    e.preventDefault();
    save({ name: name.value }, "Name saved");
  };
  el.append(nameForm);

    },
    // ---- appearance ----
    theme() {
      el.append(sect("Appearance"));
  const themes = html('<div class="tabs set-themes" role="radiogroup" aria-label="Colour scheme"></div>');
  for (const [id, t] of Object.entries(THEMES)) {
    const b = btn("", () => p.theme !== id && save({ theme: id }), `${t.label} accent`);
    b.className = `tab set-theme${p.theme === id ? " on" : ""}`;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(p.theme === id));
    b.innerHTML = `<i style="background:${t.accent}"></i>${esc(t.label)}`;
    themes.append(b);
  }
  el.append(row(html("<label>Colour scheme</label>")), themes);

    },
    tape() {
  const tapes = html('<div class="tabs" role="radiogroup" aria-label="Ticker tape"></div>');
  for (const [id, label] of Object.entries(TAPE_MODES)) {
    const b = btn(label, () => p.tape !== id && save({ tape: id }));
    b.className = `tab${p.tape === id ? " on" : ""}`;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(p.tape === id));
    tapes.append(b);
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.append(
    row(html("<label>Ticker tape (bottom line)</label>")),
    tapes,
    html(`<p class="para dim">Windows on this computer currently ${reduced ? "<b>asks for fewer animations</b> (Remote Desktop session, or Settings › Accessibility › Visual effects › Animation effects is off), so “Follow Windows” stands still here" : "allows animations"}.</p>`),
  );

  // Content of the tape: Standard or the union of chosen watchlists (incl. W:HOLD), public/js/tape-core.js.
  const srcTabs = html('<div class="tabs tape-source" role="radiogroup" aria-label="Ticker tape content"></div>');
  for (const [id, label] of Object.entries(TAPE_SOURCES)) {
    const b = btn(label, () => p.tapeSource !== id && save({ tapeSource: id }), id === "watch" ? "Symbols of the watchlists ticked below, in that order, without duplicates" : "Main indices, gold, oil, 10-year yield, EUR/USD, USD/JPY, bitcoin, ether");
    b.className = `tab${p.tapeSource === id ? " on" : ""}`;
    b.dataset.tapeSource = id;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(p.tapeSource === id));
    srcTabs.append(b);
  }
  el.append(row(html("<label>Ticker tape content</label>")), srcTabs);
  if (p.tapeSource === "watch") {
    const listBox = html('<div class="tape-lists"><p class="para dim">Loading watchlists…</p></div>');
    el.append(listBox);
    (async () => {
      const [st, h] = await Promise.all([api.get("/api/state").catch(() => ({})), api.get("/api/watch/hold").catch(() => null)]);
      if (!ctx.live()) return;
      const lists = st?.amberWatch?.lists || {};
      const names = [...Object.keys(lists), TAPE_HOLD];
      const count = (n) => (n === TAPE_HOLD ? (h ? (h.codes || []).length : "?") : lists[n].length);
      // shown order: ticked lists in the chosen order first, then the rest
      const order = [...p.tapeLists.filter((n) => names.includes(n)), ...names.filter((n) => !p.tapeLists.includes(n))];
      const t = tapeItems(p, lists, h?.codes || []);
      listBox.innerHTML = `<div class="wform" style="flex-wrap:wrap">${order.map((n) => {
        const pos = p.tapeLists.indexOf(n);
        return `<label title="${n === TAPE_HOLD ? "Auto-watchlist of your holdings (RSL, GSW, PORT), recomputed on every refresh" : `Watchlist ${esc(n)} (W ${esc(n)})`}"><input type="checkbox" data-tape-list="${esc(n)}"${pos >= 0 ? " checked" : ""}> ${pos >= 0 ? `${pos + 1}. ` : ""}${esc(n)} <span class="dim">(${count(n)})</span></label>`;
      }).join("")}</div>
      <p class="para dim" data-tape-hint>${t.fallback === "none" ? "<b>No watchlist ticked: the tape shows Standard.</b> " : t.fallback === "empty" ? "<b>The ticked watchlists are empty: the tape shows Standard.</b> " : `The tape shows ${t.items.length} symbols${t.capped ? ` (the first ${t.items.length}; more are cut off)` : ""}. `}Order: the lists in the order ticked, each in its own order; a symbol on several lists appears once. Changes to the lists (W ADD/DEL, bookings for W:HOLD) show up within a minute. Tip: a list such as W NEW TICKER with the main indices gives your own tape.</p>`;
      listBox.addEventListener("change", (e) => {
        const n = e.target.dataset?.tapeList;
        if (!n) return;
        const next = e.target.checked ? [...p.tapeLists.filter((x) => x !== n), n] : p.tapeLists.filter((x) => x !== n);
        save({ tapeLists: next });
      });
    })();
  }

    },
    // ---- exchange clocks ----
    clocks() {
      el.append(sect("Market clocks (top right)"));
  el.append(html(`<p class="para dim">Tick the exchanges to show (max. ${CLOCKS_MAX}), in the order ticked. The dot shows the session: <span class="mk-dot open"></span>trading <span class="mk-dot ext"></span>extended hours (pre-market, after hours, auctions, Tradegate for Xetra) <span class="mk-dot"></span>closed. Local exchange time, Monday to Friday; exchange holidays are not known.</p>`));
  const now = new Date();
  const picked = p.clocks;
  const rng = (list) => list.map(([a, b]) => `${a}–${b}`).join(", ") || "—";
  const ctab = html(`<table class="t"><thead><tr><th class="l">Show</th><th class="l">Code</th><th class="l">Exchange</th><th class="l">Trading</th><th class="l">Extended</th><th class="l">Now</th></tr></thead><tbody>${Object.entries(EXCHANGES)
    .map(([code, ex]) => {
      const st = sessionState(code, now);
      const pos = picked.indexOf(code);
      return `<tr><td class="l"><label><input type="checkbox" data-clock="${code}"${pos >= 0 ? " checked" : ""}${pos < 0 && picked.length >= CLOCKS_MAX ? " disabled" : ""}> ${pos >= 0 ? pos + 1 : ""}</label></td><td class="l"><b>${code}</b></td><td class="l">${esc(ex.name)} <span class="dim">${esc(ex.city)}</span></td><td class="l">${rng(ex.open)}</td><td class="l">${rng(ex.ext)}</td><td class="l"><span class="mk-dot ${st.state}"></span>${st.weekend ? "weekend" : st.text} · ${st.local}</td></tr>`;
    })
    .join("")}</tbody></table>`);
  ctab.addEventListener("change", (e) => {
    const c = e.target.dataset?.clock;
    if (!c) return;
    const next = e.target.checked ? [...picked.filter((x) => x !== c), c] : picked.filter((x) => x !== c);
    save({ clocks: next });
  });
  el.append(ctab, row(btn("Standard (NY, LDN, TKY)", () => save({ clocks: [...DEFAULT_CLOCKS] }, "Market clocks reset")), btn("None", () => save({ clocks: [] }))));

    },
    // ---- top bar ----
    bar() {
      el.append(sect("Top bar apps"));
  const mode = html('<div class="tabs"></div>');
  for (const [m, label, tip] of [
    ["auto", "Auto (most used)", "Most used apps first, ranked by launch count"],
    ["custom", "Configure", "You choose the apps and their order"],
  ]) {
    const b = btn(label, () => p.bar.mode !== m && save({ bar: { mode: m } }), tip);
    b.className = `tab${p.bar.mode === m ? " on" : ""}`;
    mode.append(b);
  }
  el.append(mode);
  const current = barApps(p, usage, cands);

  if (p.bar.mode === "auto") {
    const size = document.createElement("input");
    size.type = "number";
    size.name = "barSize";
    size.min = BAR_MIN;
    size.max = BAR_MAX;
    size.value = p.bar.size;
    size.style.width = "60px";
    size.onchange = () => save({ bar: { size: size.value } });
    const lab = html("<label>Keys shown </label>");
    lab.append(size);
    el.append(
      row(lab, html(`<span class="hint" style="margin:0">Ranked by launches; apps never used yet fill up from the standard bar. The order updates on the next start or settings change.</span>`)),
    );
    el.append(
      table(
        current.map((id, i) => ({ pos: i + 1, id, name: fname(id), n: usage[id] || 0 })),
        [
          { key: "pos", label: "#" },
          { key: "id", label: "Code", left: true, lbl: true },
          { key: "name", label: "App", left: true },
          { key: "n", label: "Launches" },
        ],
        { onRow: (r) => ctx.go(r.id) },
      ),
    );
  } else {
    const apps = p.bar.apps.filter((id) => cands.includes(id));
    const move = (i, d) => {
      const next = apps.slice();
      const j = i + d;
      if (j < 0 || j >= next.length) return;
      [next[i], next[j]] = [next[j], next[i]];
      save({ bar: { apps: next } });
    };
    const list = html('<table class="t set-bar"><thead><tr><th>#</th><th class="l">Code</th><th class="l">App</th><th>Launches</th><th></th></tr></thead><tbody></tbody></table>');
    const tb = list.querySelector("tbody");
    apps.forEach((id, i) => {
      const tr = html(`<table><tr><td>${i + 1}</td><td class="l lbl">${esc(id)}</td><td class="l">${esc(fname(id))}</td><td>${usage[id] || 0}</td><td class="l"></td></tr></table>`).querySelector("tr");
      const up = btn("↑", () => move(i, -1), "Move left");
      const dn = btn("↓", () => move(i, 1), "Move right");
      const rm = btn("✕", () => save({ bar: { apps: apps.filter((x) => x !== id) } }), "Remove from the bar");
      for (const b of [up, dn, rm]) b.className = "xbtn";
      up.disabled = i === 0;
      dn.disabled = i === apps.length - 1;
      tr.lastChild.append(up, dn, rm);
      tb.append(tr);
    });
    if (!apps.length) tb.append(html('<table><tr><td colspan="5" class="l dim">No apps selected: the bar shows only the yellow keys.</td></tr></table>').querySelector("tr"));
    el.append(list);

    const rest = cands.filter((id) => !apps.includes(id)).sort();
    const sel = document.createElement("select");
    sel.name = "addApp";
    for (const id of rest) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = `${id} · ${fname(id)}`;
      sel.append(o);
    }
    const add = btn("Add", () => sel.value && save({ bar: { apps: [...apps, sel.value] } }));
    add.disabled = !rest.length || apps.length >= BAR_MAX;
    el.append(
      row(
        html("<label>Add app</label>"),
        sel,
        add,
        btn("Take auto order", () => save({ bar: { apps: barApps({ ...p, bar: { ...p.bar, mode: "auto" } }, usage, cands) } }), "Start from today's most-used ranking"),
        btn("Standard list", () => save({ bar: { apps: DEFAULT_BAR.slice() } }), "The original top bar"),
      ),
    );
  }

    },
    // ---- notifications / updates / data sources ----
    notify() {
      el.append(sect("Benachrichtigungen"));
      renderNotify(ctx, box("data-notify"));
    },
    updates() {
      el.append(sect("Updates"));
      renderUpdates(ctx, box());
    },
    sec() {
      el.append(sect("SEC contact"));
      renderSec(ctx, box());
    },
    ohlc() {
      el.append(sect("Daily prices"));
      renderOhlc(ctx, box());
    },
    eventsCache() {
      el.append(sect("Event cache"));
      const d = html("<div></div>");
      el.append(d);
      renderEventsCache(ctx, d);
    },
    // ---- usage ----
    usage() {
      el.append(sect("App usage"));
  // Same counts and the same order as the Auto top bar (barApps: launches, ties in standard-bar order), so the
  // "Top bar" column shows where each app sits in Auto; apps that need a security (DES, GP …) never go on the bar.
  const autoBar = barApps({ ...p, bar: { ...p.bar, mode: "auto" } }, usage, cands);
  const used = usageOrder(usage, cands);
  const barCol = (id) => {
    const i = autoBar.indexOf(id);
    if (i >= 0) return `#${i + 1}`;
    if (!FUNCS[id]) return "—";
    if (!cands.includes(id)) return id === "SETTINGS" ? "own key (⚙)" : "no (needs a security)";
    return `no (beyond ${p.bar.size} keys)`;
  };
  const total = used.reduce((s, [, n]) => s + n, 0);
  const reset = btn("Reset app usage", async () => {
    if (!window.confirm("Reset all app launch counts to zero? The auto top bar falls back to the standard order.")) return;
    try {
      await resetUsage();
      ctx.toast("App usage reset");
    } catch (e) {
      ctx.toast(`Not reset: ${e.message}`, true);
    }
    if (ctx.live()) render(ctx);
  });
  reset.disabled = !used.length;
  el.append(row(html(`<span class="hint" style="margin:0">${total} launches of ${used.length} apps counted since the last reset (startup restore and Back don't count). The Auto top bar ranks the market-wide apps by these counts.</span>`), reset));
  if (used.length)
    el.append(
      table(
        used.map(([id, n]) => ({ id, name: fname(id) || "(no longer available)", n, share: total ? (100 * n) / total : 0, bar: barCol(id) })),
        [
          { key: "id", label: "Code", left: true, lbl: true },
          { key: "name", label: "App", left: true },
          { key: "n", label: "Launches" },
          { key: "share", label: "Share", fmt: (v) => `${v.toFixed(1)}%` },
          { key: "bar", label: "Top bar (Auto)", left: true, sort: false, title: "Position in the Auto top bar. Only market-wide apps (no security needed) can sit on the bar; the rest is filled from the standard bar." },
        ],
      ),
    );
    },
  };
  for (const [id, tab] of Object.entries(SECTION_TAB)) if (tab === cur) sections[id]();
}

export default [
  {
    id: "SETTINGS",
    name: "Settings",
    group: "Help",
    source: "This app",
    render(ctx) {
      activeTab = pickTab(ctx.args, storedTab());
      if ((ctx.args || []).length) storeTab(activeTab);
      render(ctx);
      // Launch counts change while this screen is open (other panels): keep the tables current.
      let t = null;
      const off = onPrefs(() => {
        clearTimeout(t);
        // nur Reiter mit Prefs-Inhalt neu aufbauen (sonst gingen Eingaben in Formularen anderer Reiter verloren)
        // Nicht neu aufbauen, solange in diesem Reiter ein Feld den Fokus hat (Name, Tastenzahl, App-Auswahl …):
        // sonst ginge eine angefangene Eingabe verloren; der nächste Wechsel holt es nach.
        t = setTimeout(() => {
          const f = document.activeElement;
          const typing = f && ctx.el.contains(f) && /^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName) && f.type !== "checkbox";
          if (ctx.live() && (activeTab === "GENERAL" || activeTab === "UI") && !typing) render(ctx);
        }, 300);
      });
      ctx.onCleanup(() => {
        off();
        clearTimeout(t);
      });
    },
  },
];
