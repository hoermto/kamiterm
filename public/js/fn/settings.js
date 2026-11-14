// SETTINGS: personal settings of this terminal. Colour scheme, name top left, which apps sit in the top bar
// (auto = most used, or your own pick and order), exchange clocks top right, ticker tape, and the app usage
// counts behind the ranking, the update source and the SEC contact email.
// Stored in data/state.json (amberPrefs, amberUsage) via prefs.js.
import { esc, api } from "../api.js";
import { table, sect, html } from "../ui.js";
import { FUNCS } from "./index.js";
import { THEMES, TAPE_MODES, DEFAULT_NAME, DEFAULT_BAR, NAME_MAX, BAR_MIN, BAR_MAX, barApps, barCandidates } from "../prefs-core.js";
import { getPrefs, getUsage, savePrefs, resetUsage, onPrefs } from "../prefs.js";
import { EXCHANGES, DEFAULT_CLOCKS, CLOCKS_MAX, sessionState } from "../markets-core.js";

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
    html(`<p class="para dim">SEC EDGAR asks every program that downloads its data to name a contact email. It is saved in data/settings.json on this computer and sent only to sec.gov, in the request header. Without it, filings and insider trades still work under the generic Amber Terminal name, but the earnings history (8-K dates) needs it.</p>`),
    form,
    html(`<p class="para">${c.contact ? `Requests name <b>${esc(c.contact)}</b>` : "No address set: generic name"}${msg ? ` · <span class="dim">${esc(msg)}</span>` : ""}</p>`),
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
    html(`<p class="para dim">New versions are looked up here and installed by start.bat on its next start. Empty fields use start.bat's value or the default. Saved in data/launcher.cfg on this computer.${c.gitCheckout ? " This folder is a git checkout: without a URL here it updates from its own origin remote; its remotes are never changed." : ""}</p>`),
    form,
    html(`<p class="para">Using <b>${esc(st.source || shownUrl)}</b> · branch <b>${esc(c.branch)}</b> <span class="dim">(${FROM[c.repoFrom] || c.repoFrom})</span><br>Status: <b>${stText}</b> · installed ${esc(v(st.localVersion) || "?")}${st.local ? ` @ ${esc(st.local)}` : ""}${st.checkedAt ? ` · checked ${esc(new Date(st.checkedAt).toLocaleString())}` : ""}${msg ? ` · <span class="dim">${esc(msg)}</span>` : ""}</p>`),
  );
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
  ctx.el.replaceChildren(html('<p class="para dim">Personal settings of this terminal, saved in data/state.json. Changes apply immediately.</p>'));

  // ---- appearance ----
  ctx.el.append(sect("Appearance"));
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
  ctx.el.append(nameForm);

  const themes = html('<div class="tabs set-themes" role="radiogroup" aria-label="Colour scheme"></div>');
  for (const [id, t] of Object.entries(THEMES)) {
    const b = btn("", () => p.theme !== id && save({ theme: id }), `${t.label} accent`);
    b.className = `tab set-theme${p.theme === id ? " on" : ""}`;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(p.theme === id));
    b.innerHTML = `<i style="background:${t.accent}"></i>${esc(t.label)}`;
    themes.append(b);
  }
  ctx.el.append(row(html("<label>Colour scheme</label>")), themes);

  const tapes = html('<div class="tabs" role="radiogroup" aria-label="Ticker tape"></div>');
  for (const [id, label] of Object.entries(TAPE_MODES)) {
    const b = btn(label, () => p.tape !== id && save({ tape: id }));
    b.className = `tab${p.tape === id ? " on" : ""}`;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(p.tape === id));
    tapes.append(b);
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  ctx.el.append(
    row(html("<label>Ticker tape (bottom line)</label>")),
    tapes,
    html(`<p class="para dim">Windows on this computer currently ${reduced ? "<b>asks for fewer animations</b> (Remote Desktop session, or Settings › Accessibility › Visual effects › Animation effects is off), so “Follow Windows” stands still here" : "allows animations"}.</p>`),
  );

  // ---- exchange clocks ----
  ctx.el.append(sect("Market clocks (top right)"));
  ctx.el.append(html(`<p class="para dim">Tick the exchanges to show (max. ${CLOCKS_MAX}), in the order ticked. The dot shows the session: <span class="mk-dot open"></span>trading <span class="mk-dot ext"></span>extended hours (pre-market, after hours, auctions, Tradegate for Xetra) <span class="mk-dot"></span>closed. Local exchange time, Monday to Friday; exchange holidays are not known.</p>`));
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
  ctx.el.append(ctab, row(btn("Standard (NY, LDN, TKY)", () => save({ clocks: [...DEFAULT_CLOCKS] }, "Market clocks reset")), btn("None", () => save({ clocks: [] }))));

  // ---- top bar ----
  ctx.el.append(sect("Top bar apps"));
  const mode = html('<div class="tabs"></div>');
  for (const [m, label, tip] of [
    ["auto", "Auto (most used)", "Most used apps first, ranked by launch count"],
    ["custom", "Configure", "You choose the apps and their order"],
  ]) {
    const b = btn(label, () => p.bar.mode !== m && save({ bar: { mode: m } }), tip);
    b.className = `tab${p.bar.mode === m ? " on" : ""}`;
    mode.append(b);
  }
  ctx.el.append(mode);
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
    ctx.el.append(
      row(lab, html(`<span class="hint" style="margin:0">Ranked by launches; apps never used yet fill up from the standard bar. The order updates on the next start or settings change.</span>`)),
    );
    ctx.el.append(
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
    ctx.el.append(list);

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
    ctx.el.append(
      row(
        html("<label>Add app</label>"),
        sel,
        add,
        btn("Take auto order", () => save({ bar: { apps: barApps({ ...p, bar: { ...p.bar, mode: "auto" } }, usage, cands) } }), "Start from today's most-used ranking"),
        btn("Standard list", () => save({ bar: { apps: DEFAULT_BAR.slice() } }), "The original top bar"),
      ),
    );
  }

  // ---- usage ----
  // ---- updates ----
  ctx.el.append(sect("Updates"));
  const updBox = html('<div><p class="para dim">Loading…</p></div>');
  ctx.el.append(updBox);
  renderUpdates(ctx, updBox);

  ctx.el.append(sect("Data sources"));
  const secBox = html('<div><p class="para dim">Loading…</p></div>');
  ctx.el.append(secBox);
  renderSec(ctx, secBox);

  ctx.el.append(sect("App usage"));
  const used = Object.entries(usage).sort((a, b) => b[1] - a[1]);
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
  ctx.el.append(row(html(`<span class="hint" style="margin:0">${total} launches of ${used.length} apps counted (startup restore and Back don't count).</span>`), reset));
  if (used.length)
    ctx.el.append(
      table(
        used.map(([id, n]) => ({ id, name: fname(id) || "(no longer available)", n, share: total ? (100 * n) / total : 0 })),
        [
          { key: "id", label: "Code", left: true, lbl: true },
          { key: "name", label: "App", left: true },
          { key: "n", label: "Launches" },
          { key: "share", label: "Share", fmt: (v) => `${v.toFixed(1)}%` },
        ],
      ),
    );
}

export default [
  {
    id: "SETTINGS",
    name: "Settings",
    group: "Help",
    source: "This app",
    render(ctx) {
      render(ctx);
      // Launch counts change while this screen is open (other panels): keep the tables current.
      let t = null;
      const off = onPrefs(() => {
        clearTimeout(t);
        t = setTimeout(() => ctx.live() && document.activeElement?.name !== "brandName" && render(ctx), 300);
      });
      ctx.onCleanup(() => {
        off();
        clearTimeout(t);
      });
    },
  },
];
