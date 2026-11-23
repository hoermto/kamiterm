// Personal settings of the terminal (SETTINGS): colour scheme, brand name, top-bar apps, app usage.
// Pure functions only (no DOM, no fetch), so Node tests can load this file directly.
import { DEFAULT_CLOCKS, normalizeClocks } from "./markets-core.js";
import { TAPE_SOURCES, normalizeTapeLists } from "./tape-core.js";

// Accent colour sets. Each replaces --amber (accent), --amber-2 (light), --amber-dim (dark) and two background tints.
export const THEMES = Object.freeze({
  amber: { label: "Amber", accent: "#ffa028", light: "#ffbf66", dim: "#a8661a", bg: "#2a1a05", bg2: "#1a1206" },
  grey: { label: "Grey", accent: "#b4bcc6", light: "#d6dce3", dim: "#6c737c", bg: "#1f2328", bg2: "#15181b" },
  white: { label: "White", accent: "#f2f2f2", light: "#ffffff", dim: "#8f8f8f", bg: "#262626", bg2: "#181818" },
  green: { label: "Green", accent: "#4be37a", light: "#8af0a8", dim: "#2b8a4a", bg: "#0b2615", bg2: "#08190e" },
  red: { label: "Red", accent: "#ff5a52", light: "#ff8f88", dim: "#a8352f", bg: "#2a0b09", bg2: "#1a0806" },
});
export const DEFAULT_NAME = "AMBER";
export const NAME_MAX = 16;
export const BAR_MIN = 3;
export const BAR_MAX = 30;

// Today's app keys, in their original order: the auto bar's fallback and tie-break, and the start of a configured bar.
export const DEFAULT_BAR = Object.freeze(["WEI", "TOP", "ECO", "GC", "BTMM", "WIRP", "FXC", "GLCO", "CRYPTO", "MOST", "EQS", "W", "ALRT", "HELP", "DATA"]);

// Ticker tape at the bottom: always scroll, follow the system's "reduce animations" (Remote Desktop sessions and
// Windows' "Animation effects: off" set it), or stand still.
export const TAPE_MODES = Object.freeze({ scroll: "Scroll", system: "Follow Windows", off: "Off" });

export const DEFAULT_PREFS = Object.freeze({
  theme: "amber",
  name: DEFAULT_NAME,
  tape: "scroll",
  tapeSource: "standard", // Laufband-Inhalt: "standard" oder "watch" (gewählte W-Listen, tape-core.js)
  tapeLists: Object.freeze([]),
  rslBasis: "friday", // RSL26-Signale: "friday" = Fr-Schluss (regelkonform, wie die Alarme) | "live" = aktuell (laufende Woche)
  clocks: DEFAULT_CLOCKS,
  bar: Object.freeze({ mode: "auto", size: DEFAULT_BAR.length, apps: DEFAULT_BAR }),
});

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// Anything stored (or sent) becomes a valid prefs object; unknown keys are dropped.
export function normalizePrefs(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const name = String(r.name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) || DEFAULT_NAME;
  const b = r.bar && typeof r.bar === "object" ? r.bar : {};
  const apps = Array.isArray(b.apps) ? [...new Set(b.apps.map((a) => String(a).toUpperCase().trim()).filter(Boolean))] : DEFAULT_BAR.slice();
  return {
    theme: Object.hasOwn(THEMES, r.theme) ? r.theme : DEFAULT_PREFS.theme,
    name,
    tape: Object.hasOwn(TAPE_MODES, r.tape) ? r.tape : DEFAULT_PREFS.tape,
    tapeSource: Object.hasOwn(TAPE_SOURCES, r.tapeSource) ? r.tapeSource : DEFAULT_PREFS.tapeSource,
    tapeLists: normalizeTapeLists(r.tapeLists),
    rslBasis: r.rslBasis === "live" ? "live" : "friday",
    clocks: normalizeClocks(r.clocks),
    bar: {
      mode: b.mode === "custom" ? "custom" : "auto",
      size: clampInt(b.size, BAR_MIN, BAR_MAX, DEFAULT_PREFS.bar.size),
      apps: apps.slice(0, BAR_MAX),
    },
  };
}

// Usage counts: { CODE: n }. Non-numbers and negatives are dropped.
export function normalizeUsage(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    const n = Math.floor(Number(v));
    if (k && Number.isFinite(n) && n > 0) out[String(k).toUpperCase()] = n;
  }
  return out;
}

export function countRun(usage, code) {
  const k = String(code || "").toUpperCase();
  if (!k) return usage;
  return { ...usage, [k]: (usage[k] || 0) + 1 };
}

// Apps that can sit on the bar: functions that run without a security (market-wide), in registry order.
export const barCandidates = (funcs) => Object.values(funcs || {}).filter((f) => f && !f.needs && f.id !== "SETTINGS").map((f) => f.id);

// Which app codes the top bar shows, left to right.
//   available: codes that may appear (market-wide functions, in a stable order).
//   auto:   most used first (ties: DEFAULT_BAR order, then `available` order), filled up with DEFAULT_BAR, `size` keys.
//   custom: the user's own list and order (codes that no longer exist are skipped).
/** All counted apps, most used first; ties in DEFAULT_BAR order, then `available` order, then by code. The Auto bar
 *  and SETTINGS › App usage both use this order, so the stats table and the bar agree. -> [[code, n]] */
export function usageOrder(usage, available = []) {
  const u = normalizeUsage(usage);
  const rank = (c) => {
    const d = DEFAULT_BAR.indexOf(c);
    if (d >= 0) return d;
    const a = available.indexOf(c);
    return a >= 0 ? DEFAULT_BAR.length + a : Infinity;
  };
  return Object.entries(u).sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

export function barApps(prefs, usage, available) {
  const p = normalizePrefs(prefs);
  const avail = new Set(available);
  if (p.bar.mode === "custom") return p.bar.apps.filter((c) => avail.has(c));
  const used = usageOrder(usage, available).map(([c]) => c).filter((c) => avail.has(c));
  const fill = DEFAULT_BAR.filter((c) => avail.has(c) && !used.includes(c));
  return [...used, ...fill].slice(0, p.bar.size);
}
