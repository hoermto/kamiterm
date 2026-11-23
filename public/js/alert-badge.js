// 🔔 in der Kopfzeile (AT-23): immer sichtbar. 0 bzw. unbekannt = Glocke ohne Zahl in Terminal-Farbe (quiet),
// > 0 = rote Alarm-Optik mit Zahl. Gezählt werden nur Typen, die über die Glocke gemeldet werden (🔕-Typen nicht).
export function alertBadgeState(n) {
  const k = Number(n);
  const open = n != null && Number.isFinite(k) && k > 0;
  return {
    quiet: !open,
    text: open ? `🔔 ${k}` : '🔔',
    title: open ? `${k} unquittierte${k === 1 ? 'r Alarm' : ' Alarme'} (Kurs + Status) · Klick öffnet ALERTS`
      : n == null ? 'Alarmzähler nicht verfügbar · Klick öffnet ALERTS' : 'Keine offenen Alarme · Klick öffnet ALERTS',
  };
}
