// Personal settings of the terminal (SETTINGS): colour scheme, brand name, top-bar apps, app usage.
// Pure functions only (no DOM, no fetch), so Node tests can load this file directly.

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

export const DEFAULT_PREFS = Object.freeze({
  theme: "amber",
  name: DEFAULT_NAME,
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

// Which app codes the top bar shows, left to right.
//   available: codes that may appear (market-wide functions, in a stable order).
//   auto:   most used first (ties: DEFAULT_BAR order, then `available` order), filled up with DEFAULT_BAR, `size` keys.
//   custom: the user's own list and order (codes that no longer exist are skipped).
export function barApps(prefs, usage, available) {
  const p = normalizePrefs(prefs);
  const avail = new Set(available);
  if (p.bar.mode === "custom") return p.bar.apps.filter((c) => avail.has(c));
  const u = normalizeUsage(usage);
  const rank = (c) => {
    const d = DEFAULT_BAR.indexOf(c);
    return d >= 0 ? d : DEFAULT_BAR.length + available.indexOf(c);
  };
  const used = available.filter((c) => u[c] > 0).sort((a, b) => u[b] - u[a] || rank(a) - rank(b));
  const fill = DEFAULT_BAR.filter((c) => avail.has(c) && !used.includes(c));
  return [...used, ...fill].slice(0, p.bar.size);
}
