// Tastenkürzel des Amber Terminals (Quelle für KEYS/TASTEN und die „?“-Übersicht). Bei neuen Kürzeln in app.js hier mitpflegen.
export const SHORTCUTS = [
  ['Befehlszeile', 'Enter', 'Befehl ausführen (GO), z. B. AAPL US EQUITY DES oder RSL26 SPX'],
  ['Befehlszeile', '/', 'Obere Befehlszeile fokussieren (wenn nicht gerade in einem Eingabefeld getippt wird)'],
  ['Befehlszeile', '↑ / ↓', 'In der Vorschlagsliste (Wertpapier-/Funktionssuche) wählen'],
  ['Befehlszeile', 'Tab', 'Markierten bzw. ersten Vorschlag übernehmen'],
  ['Befehlszeile', 'Enter (Vorschlag markiert)', 'Markierten Vorschlag übernehmen'],
  ['Navigation', 'Esc', 'Vorschläge schließen; sonst eine Ansicht zurück im aktiven Panel (auch außerhalb der Befehlszeile)'],
  ['Navigation', '◂ (Panel-Leiste)', 'Eine Ansicht zurück (Verlauf bis 50 Schritte je Panel), z. B. vom Chart zurück zu RSL26'],
  ['Panels', 'Strg/Cmd + 1 … 4', 'Panel 1–4 aktivieren und seine Befehlszeile fokussieren (nur sichtbare Panels)'],
  ['Panels', 'Mausklick ins Panel', 'Panel aktivieren (der obere Befehl läuft im aktiven Panel)'],
  ['Panels', 'Doppelklick Panel-Titel / Max-Knopf', 'Panel maximieren bzw. zurück'],
  ['Panels', 'LAYOUT 1 · 2 · 4 (Befehl) / Knöpfe 1 2 4', 'Raster mit 1, 2 oder 4 Panels'],
  ['Hilfe', 'F1', 'HELP: alle Funktionen'],
  ['Hilfe', '?', 'Diese Tastenkürzel-Übersicht (wenn nicht in einem Eingabefeld); auch Befehl KEYS oder TASTEN'],
  ['Gelbe Tasten', 'F2', 'GOVT an die Befehlszeile anhängen'],
  ['Gelbe Tasten', 'F8', 'EQUITY anhängen'],
  ['Gelbe Tasten', 'F9', 'CMDTY anhängen'],
  ['Gelbe Tasten', 'F10', 'INDEX anhängen'],
  ['Gelbe Tasten', 'F11', 'CRNCY anhängen'],
  ['RSL26', 'Klick auf Zeile der Rangliste', 'Öffnet TICKER GP (Chart); zurück mit Esc oder ◂'],
  ['RSL26', 'Enter im Formular', 'Aktualisieren (wie Knopf „Aktualisieren“)'],
  ['GSW', 'GSW (Befehl)', 'Gold/Silber-Swap: Signal, Schwellen, Holdings mit Swap-Knopf, Charts; Einstellungen oben (⚙)'],
  ['GSW', 'Enter im Formular', 'Kauf, Verkauf, Swap bzw. Einstellungen absenden (Swap und Verkauf mit Rückfrage)'],
  ['GSW', 'GSWBT (Befehl)', 'GSW-Backtest: Grid, Robust-Rangliste, Walk-Forward, OOS; Klick auf Grid-Zeile rechnet die Zelle im Detail'],
  ['ALERTS', 'ALERTS (Befehl) oder 🔔 in der Kopfzeile', 'Kurs- und Status-Alarme (GSW, RSL) mit Quittieren; Mail/Telegram unter SETTINGS › Benachrichtigungen'],
];
/** True, wenn der Fokus in einem Feld liegt, in dem getippt wird (dann keine Einzeltasten-Kürzel). */
export function isTyping(el) {
  if (!el) return false;
  const t = String(el.tagName || '').toUpperCase();
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || !!el.isContentEditable;
}
