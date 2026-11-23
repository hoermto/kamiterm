// RSL-Regelwerk: Prüfung auf Basis des Freitagsschlusskurses (AT-21). Eine gemeinsame Funktion für die RSL-Status-Alarme
// (lib/status-alerts.js) und die RSL26-App im Modus „Fr-Schluss (regelkonform)“ (rsl26 basis=FRI), damit beide
// exakt dasselbe zeigen.
//
// Wochenschluss je Universum = Handelsschluss der Börse + 30 min, in Börsenzeit (Zeitzone und Sommerzeit über Intl):
//   SPX, NDX: 16:00 America/New_York → 16:30 ET · DAX, HDAX: Xetra 17:30 Europe/Berlin → 18:00 · SXXP: 17:30 → 18:00
// Frühe Handelsschlüsse (z. B. US Black Friday 13:00 ET) kennt der Code nicht (keine Kalenderquelle): dann gilt die
// Woche erst um 16:30 ET als abgeschlossen; der Stichtag (Freitag) ist trotzdem richtig.
export const SETTLE_MIN = 30;
export const MARKET_CLOSE = Object.freeze({
  SPX: { tz: 'America/New_York', close: 16 * 60, label: '16:00 New York' },
  NDX: { tz: 'America/New_York', close: 16 * 60, label: '16:00 New York' },
  DAX: { tz: 'Europe/Berlin', close: 17 * 60 + 30, label: '17:30 Xetra' },
  HDAX: { tz: 'Europe/Berlin', close: 17 * 60 + 30, label: '17:30 Xetra' },
  SXXP: { tz: 'Europe/Berlin', close: 17 * 60 + 30, label: '17:30 STOXX (MEZ)' },
});
export const marketClose = (u) => MARKET_CLOSE[String(u || 'SPX').toUpperCase()] || MARKET_CLOSE.SPX;

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmts = new Map();
/** Ortszeit in tz: { date: 'YYYY-MM-DD', wd (0=So), hm (Minuten) } */
export function localParts(d, tz) {
  let f = fmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); fmts.set(tz, f); }
  const p = f.formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, wd: WD.indexOf(g('weekday')), hm: Number(g('hour')) * 60 + Number(g('minute')) };
}
export const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
/** UTC-Millisekunden für Ortszeit ymd + hm in tz (Sommerzeit korrekt). */
export function zonedMs(ymd, hm, tz) {
  const [Y, M, D] = ymd.split('-').map(Number);
  const want = Date.UTC(Y, M - 1, D, Math.floor(hm / 60), hm % 60);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(t), tz);
    const [y, m, d] = p.date.split('-').map(Number);
    t += want - Date.UTC(y, m - 1, d, Math.floor(p.hm / 60), p.hm % 60);
  }
  return t;
}

/**
 * Pure: Stichtag der letzten abgeschlossenen Handelswoche eines Universums.
 * dates = Handelstage (YYYY-MM-DD) des Benchmarks. Woche = Mo–Fr bis zum letzten Freitag, dessen Schluss + 30 min
 * (Börsenzeit) vorbei ist. Stichtag = Freitag, wenn es dafür einen Kurs gibt; fehlt er, aber es gibt schon spätere
 * Kurse → Freitag kein Handelstag → letzter Handelstag dieser Woche; fehlt er und es gibt nichts Späteres → Kurs noch
 * nicht da → Vorwoche.
 * -> { asOf, week (Freitag = Wochenschlüssel), holiday, settleAt (ISO, Schluss+30 des Freitags), tz, close } | null
 */
export function weekCloseAsOf(dates, now = new Date(), universe = 'SPX') {
  const mc = marketClose(universe);
  const set = [...new Set(dates || [])].sort();
  if (!set.length) return null;
  const settle = mc.close + SETTLE_MIN;
  const p = localParts(now, mc.tz);
  let back = (p.wd - 5 + 7) % 7;
  if (back === 0 && p.hm < settle) back = 7;
  let fri = addDays(p.date, -back);
  const out = (asOf, holiday) => ({ asOf, week: fri, holiday, settleAt: new Date(zonedMs(fri, settle, mc.tz)).toISOString(), tz: mc.tz, close: mc.label });
  for (let i = 0; i < 4; i++, fri = addDays(fri, -7)) {
    if (set.includes(fri)) return out(fri, false);
    const later = set.some((d) => d > fri);
    const inWeek = set.filter((d) => d >= addDays(fri, -4) && d < fri);
    if (later && inWeek.length) return out(inWeek.at(-1), true);
  }
  return null;
}

/** Nächste Wochenschluss-Zeitpunkte (Schluss + 30 min am Freitag) aller Universen als UTC-ms im Fenster (a, b]. */
export function settleMarksBetween(aMs, bMs) {
  const out = [];
  for (const [u, mc] of Object.entries(MARKET_CLOSE)) {
    const p = localParts(new Date(bMs), mc.tz);
    for (let back = 0; back <= 7; back++) {
      const ymd = addDays(p.date, -back);
      if (new Date(`${ymd}T12:00:00Z`).getUTCDay() !== 5) continue;
      const t = zonedMs(ymd, mc.close + SETTLE_MIN, mc.tz);
      if (t > aMs && t <= bMs) out.push({ universe: u, at: t });
    }
  }
  return out;
}

export const basisText = (wk) => {
  if (!wk?.asOf) return '';
  const d = `${wk.asOf.slice(8, 10)}.${wk.asOf.slice(5, 7)}.${wk.asOf.slice(0, 4)}`;
  return wk.holiday ? `Basis Wochenschluss ${d} (Freitag kein Handelstag)` : `Basis Freitagsschluss ${d}`;
};
