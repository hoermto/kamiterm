// Stock exchange clocks in the top bar (SETTINGS > Market clocks): local time and session state of each exchange.
// Pure functions (no DOM), so Node tests can load this file. Times are local exchange time, Monday to Friday;
// exchange holidays are not known here, so a holiday shows like a normal trading day.
//
// state: "open"   regular trading
//        "ext"    extended hours: pre-market / after-hours (US), off-exchange hours (Frankfurt/Tradegate for Xetra),
//                 opening and closing auctions where they are separate sessions
//        "closed" outside, lunch breaks and weekends

export const EXCHANGES = Object.freeze({
  NY: { name: "NYSE / Nasdaq", city: "New York", tz: "America/New_York", open: [["09:30", "16:00"]], ext: [["04:00", "09:30"], ["16:00", "20:00"]] },
  TOR: { name: "Toronto (TSX)", city: "Toronto", tz: "America/Toronto", open: [["09:30", "16:00"]], ext: [["16:15", "17:00"]] },
  SAO: { name: "B3", city: "São Paulo", tz: "America/Sao_Paulo", open: [["10:00", "17:00"]], ext: [["09:45", "10:00"], ["17:00", "17:10"]] },
  LDN: { name: "London (LSE)", city: "London", tz: "Europe/London", open: [["08:00", "16:30"]], ext: [["07:50", "08:00"], ["16:30", "16:35"]] },
  FRA: { name: "Xetra (Frankfurt/Tradegate 8–22)", city: "Frankfurt", tz: "Europe/Berlin", open: [["09:00", "17:30"]], ext: [["08:00", "09:00"], ["17:30", "22:00"]] },
  PAR: { name: "Euronext Paris", city: "Paris", tz: "Europe/Paris", open: [["09:00", "17:30"]], ext: [["07:15", "09:00"], ["17:30", "17:40"]] },
  AMS: { name: "Euronext Amsterdam", city: "Amsterdam", tz: "Europe/Amsterdam", open: [["09:00", "17:30"]], ext: [["07:15", "09:00"], ["17:30", "17:40"]] },
  ZRH: { name: "SIX Swiss Exchange", city: "Zurich", tz: "Europe/Zurich", open: [["09:00", "17:20"]], ext: [["06:00", "09:00"], ["17:20", "17:30"]] },
  MIL: { name: "Borsa Italiana", city: "Milan", tz: "Europe/Rome", open: [["09:00", "17:30"]], ext: [["08:00", "09:00"], ["17:30", "17:42"]] },
  BOM: { name: "NSE / BSE India", city: "Mumbai", tz: "Asia/Kolkata", open: [["09:15", "15:30"]], ext: [["09:00", "09:15"], ["15:40", "16:00"]] },
  SHA: { name: "Shanghai (SSE)", city: "Shanghai", tz: "Asia/Shanghai", open: [["09:30", "11:30"], ["13:00", "15:00"]], ext: [["09:15", "09:25"]] },
  HKG: { name: "Hong Kong (HKEX)", city: "Hong Kong", tz: "Asia/Hong_Kong", open: [["09:30", "12:00"], ["13:00", "16:00"]], ext: [["09:00", "09:30"], ["16:00", "16:10"]] },
  SEL: { name: "Korea (KRX)", city: "Seoul", tz: "Asia/Seoul", open: [["09:00", "15:30"]], ext: [["08:30", "09:00"], ["15:40", "18:00"]] },
  TKY: { name: "Tokyo (TSE)", city: "Tokyo", tz: "Asia/Tokyo", open: [["09:00", "11:30"], ["12:30", "15:30"]], ext: [] },
  SYD: { name: "Australia (ASX)", city: "Sydney", tz: "Australia/Sydney", open: [["10:00", "16:00"]], ext: [["07:00", "10:00"], ["16:00", "16:12"]] },
});
export const DEFAULT_CLOCKS = Object.freeze(["NY", "LDN", "TKY"]);
export const CLOCKS_MAX = 8;

const STATE_TEXT = { open: "trading", ext: "extended hours", closed: "closed" };
const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const inAny = (ranges, t) => ranges.some(([a, b]) => t >= mins(a) && t < mins(b));

// Local weekday (0 = Sunday) and minutes since midnight at the exchange.
export function localTime(tz, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const h = Number(parts.hour) % 24, m = Number(parts.minute);
  return { weekday: wd, minutes: h * 60 + m, hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

export function sessionState(code, date = new Date()) {
  const ex = EXCHANGES[code];
  if (!ex) return null;
  const t = localTime(ex.tz, date);
  const weekday = t.weekday >= 1 && t.weekday <= 5;
  const state = !weekday ? "closed" : inAny(ex.open, t.minutes) ? "open" : inAny(ex.ext, t.minutes) ? "ext" : "closed";
  return { code, state, text: STATE_TEXT[state], local: t.hhmm, weekend: !weekday };
}

// Tooltip: name, hours, current state.
export function sessionTitle(code, date = new Date()) {
  const ex = EXCHANGES[code];
  const s = sessionState(code, date);
  if (!ex || !s) return "";
  const r = (list) => list.map(([a, b]) => `${a}–${b}`).join(", ");
  return [
    `${ex.name} · ${ex.city} ${s.local}`,
    `Trading ${r(ex.open)}${ex.ext.length ? ` · extended ${r(ex.ext)}` : ""} (local time, Mon–Fri)`,
    `Now: ${s.weekend ? "weekend" : s.text}. Exchange holidays are not shown.`,
  ].join("\n");
}

export function normalizeClocks(raw) {
  if (!Array.isArray(raw)) return DEFAULT_CLOCKS.slice();
  return [...new Set(raw.map((c) => String(c).toUpperCase().trim()))].filter((c) => Object.hasOwn(EXCHANGES, c)).slice(0, CLOCKS_MAX);
}
