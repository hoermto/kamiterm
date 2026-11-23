// SETTINGS-Reiter (pure, ohne DOM): welche Reiter es gibt, welcher Abschnitt wohin gehört, und welcher Reiter
// beim Öffnen gilt (Befehlsargument `SETTINGS NOTIFY` > zuletzt benutzter Reiter > Allgemein).
export const SETTINGS_TABS = Object.freeze([
  { id: "GENERAL", label: "Allgemein", aliases: ["ALLGEMEIN", "GEN"] },
  { id: "NOTIFY", label: "Benachrichtigungen", aliases: ["BENACHRICHTIGUNGEN", "NOTIFICATION", "NOTIFICATIONS", "ALERTS", "MAIL", "TELEGRAM"] },
  { id: "UPDATES", label: "Updates", aliases: ["UPDATE"] },
  { id: "DATA", label: "Datenquellen", aliases: ["DATENQUELLEN", "DATEN", "SOURCES", "DATASOURCES", "SEC", "OHLC", "CACHE"] },
  { id: "UI", label: "UI", aliases: ["APPEARANCE", "OBERFLAECHE", "OBERFLÄCHE", "ANZEIGE"] },
]);
export const DEFAULT_TAB = "GENERAL";
export const TAB_STORE_KEY = "amberSettingsTab";

/** Abschnitt → Reiter (Reihenfolge innerhalb eines Reiters = Reihenfolge hier). */
export const SECTION_TAB = Object.freeze({
  name: "GENERAL",
  notify: "NOTIFY",
  updates: "UPDATES",
  sec: "DATA",
  ohlc: "DATA",
  eventsCache: "DATA",
  theme: "UI",
  tape: "UI",
  clocks: "UI",
  bar: "UI",
  usage: "UI", // direkt unter „Top bar apps“: die Zählung ist die Grundlage der Auto-Leiste
});

/** Wort → Reiter-id oder null. */
export function tabFromWord(w) {
  const u = String(w ?? "").trim().toUpperCase();
  if (!u) return null;
  const t = SETTINGS_TABS.find((x) => x.id === u || x.label.toUpperCase() === u || x.aliases.includes(u));
  return t ? t.id : null;
}

/** Reiter beim Öffnen: erstes passendes Argument, sonst gespeicherter Reiter, sonst Allgemein. */
export function pickTab(args = [], stored = null) {
  for (const a of args || []) {
    const t = tabFromWord(a);
    if (t) return t;
  }
  return tabFromWord(stored) || DEFAULT_TAB;
}

/** Pfeiltasten in der Reiterleiste: nächster/vorheriger (umlaufend), Pos1/Ende. */
export function nextTab(cur, key) {
  const ids = SETTINGS_TABS.map((t) => t.id);
  const i = Math.max(0, ids.indexOf(cur));
  if (key === "ArrowRight" || key === "ArrowDown") return ids[(i + 1) % ids.length];
  if (key === "ArrowLeft" || key === "ArrowUp") return ids[(i - 1 + ids.length) % ids.length];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return null;
}
