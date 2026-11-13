// SETTINGS: personal settings of this terminal. Colour scheme, name top left, which apps sit in the top bar
// (auto = most used, or your own pick and order) and the app usage counts behind the ranking.
// Stored in data/state.json (amberPrefs, amberUsage) via prefs.js.
import { esc } from "../api.js";
import { table, sect, html } from "../ui.js";
import { FUNCS } from "./index.js";
import { THEMES, TAPE_MODES, DEFAULT_NAME, DEFAULT_BAR, NAME_MAX, BAR_MIN, BAR_MAX, barApps, barCandidates } from "../prefs-core.js";
import { getPrefs, getUsage, savePrefs, resetUsage, onPrefs } from "../prefs.js";

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
