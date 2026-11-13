// Personal settings in the browser: loads/saves them in the server state (data/state.json: amberPrefs, amberUsage),
// applies colour scheme and brand name, and counts app launches. A copy in localStorage lets /js/boot.js
// paint the right colours before this module has loaded.
import { api } from "./api.js";
import { THEMES, DEFAULT_NAME, normalizePrefs, normalizeUsage, countRun } from "./prefs-core.js";

const LS_PREFS = "amber.prefs";
const LS_VARS = "amber.themeVars"; // read by boot.js
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked: server copy still counts */ } };

let prefs = normalizePrefs(lsGet(LS_PREFS));
let usage = {};
const listeners = new Set();
const emit = () => { for (const fn of listeners) try { fn(prefs, usage); } catch { /* one bad listener must not stop the rest */ } };

export const getPrefs = () => prefs;
export const getUsage = () => usage;
export function onPrefs(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function themeVars(theme) {
  const t = THEMES[theme] || THEMES.amber;
  return { "--amber": t.accent, "--amber-2": t.light, "--amber-dim": t.dim, "--amber-bg": t.bg, "--amber-bg2": t.bg2 };
}

export function applyPrefs(p = prefs) {
  const vars = themeVars(p.theme);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = p.theme;
  root.dataset.tape = p.tape;
  const logo = document.querySelector(".brand .logo");
  if (logo) logo.textContent = p.name;
  document.title = p.name === DEFAULT_NAME ? "Amber Terminal" : `${p.name} Terminal`;
  lsSet(LS_VARS, { vars, name: p.name, title: document.title });
}

export async function loadPrefs() {
  try {
    const st = await api.get("/api/state");
    if (st?.amberPrefs) prefs = normalizePrefs(st.amberPrefs);
    usage = normalizeUsage(st?.amberUsage);
  } catch { /* offline start: keep the local copy */ }
  lsSet(LS_PREFS, prefs);
  applyPrefs();
  emit();
  return prefs;
}

export async function savePrefs(patch) {
  prefs = normalizePrefs({ ...prefs, ...patch, bar: { ...prefs.bar, ...(patch.bar || {}) } });
  lsSet(LS_PREFS, prefs);
  applyPrefs();
  emit();
  await api.put("/api/state", { amberPrefs: prefs });
  return prefs;
}

let usageTimer = null;
const saveUsage = () => {
  clearTimeout(usageTimer);
  usageTimer = setTimeout(() => api.put("/api/state", { amberUsage: usage }).catch(() => {}), 1500);
};

export function countApp(code) {
  usage = countRun(usage, code);
  saveUsage();
  emit();
}

export async function resetUsage() {
  clearTimeout(usageTimer);
  usage = {};
  emit();
  await api.put("/api/state", { amberUsage: {} });
}
