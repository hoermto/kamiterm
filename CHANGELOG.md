# Changelog · Amber Terminal

Alle nennenswerten Änderungen am Terminal. Versionsnummer: `package.json` (Server-Banner, `/api/health`, `/api/about`, MCP-Server) und `public/js/version.js` (Kopfzeile, HELP).

## [Unreleased]

### Holdings
- **„Fallhöhe bis Stop“** ersetzt „Abstand Stop“: (Wochenschluss − Stop) / Wochenschluss, also wie viel % der Kurs bis zum Trailing-Stop noch fallen darf (max. TRAIL %, negativ = unter Stop). Vorher Close / Stop − 1 (bis 25 % bei TRAIL 20).
- **Zweizeilige Spaltenköpfe** in Holdings, geschlossenen Positionen, Rangliste und Backtest-Holdings (z. B. „Kauf-/datum“, „Fallhöhe/bis Stop“); voller Name als Tooltip, CSV-Export einzeilig. Tabellen werden deutlich schmaler.
- **Hinweis unter der Holdings-Tabelle:** Referenz des Trailing-Stops ist der höchste Wochenschluss seit Kauf, nicht das Intraday-Handelshoch (wie im Backtest).

## [1.1.0] – 2026-11-11

### RSL26-Scanner
- **Formular neu gegliedert** in **Entry** (Positionen N, Rangliste, M&A ignorieren), **Exit** (RRG-Exit-Modus, Rank-Schutz RANKTOP, Bestätigung, RS-Exit, Trailing-Stop, Rückkauf-Sperre). Ein eigener Abschnitt „Anzeige“ entfällt.
- **Top X / Rangzeilen**: Länge der Rangliste, Standard 25, unabhängig von N. Einstellbar direkt im Kopf der Rangliste (Zahlenfeld „Rangzeilen“ plus Schnellwahl 10/25/50/100); die Liste wird ohne neuen Scan neu gezeichnet. Gespeichert in den Einstellungen und bleibt nach dem Neuladen erhalten; eigene Profile können Top X mitspeichern, das Standardprofil und die eingebauten Profile setzen es nicht zurück (`TOPX=`).
- **Neuladen nutzt die gespeicherten Einstellungen:** Der Panel-Befehl wird nach dem Laden auf `RSL26 <Universum>` bzw. `RSLBT <Universum>` ohne feste Parameter gesetzt, so dass alte Werte im Befehl (z. B. `TOPX=25`) keine Einstellung mehr überschreiben und Aktionen wie KAUF/VERKAUF beim Neuladen nicht wiederholt werden. RSLBT-Speichern übernimmt Top X und die Werte je Universum.
- **Markierungen in der Rangliste** (Spalte „Status“): **im Depot** (offene Position im aktiven Universum), **Depot NDX/…** (in einem anderen Universum gehalten), **KAUF** (Kauf-Kandidat für freie Slots, wenn weniger Holdings als N). Darüber eine Slot-Zusammenfassung „Holdings x / N“. Nur Markierung, kein automatischer Kauf.
- **M&A ignorieren** (Entry, Standard an, `MASKIP=0|1`): Titel mit M&A-Flag zählen nicht zum Kauf-Fenster Rang 1…N; das Fenster rückt auf den nächsten Rang ohne M&A vor, die Zeile zeigt „übersprungen (M&A)“. Gehaltene M&A-Titel bleiben gehalten. Die Rangliste zeigt M&A-Titel immer (markiert); die frühere Anzeige-Option „M&A ausblenden“ (`HIDEMA`) entfällt. Im Backtest ohne Wirkung (keine historischen M&A-Daten).

### Universen
- **HDAX** ersetzt DAX; **STOXX Europe 600** (SXXP) neu, beide in EUR mit eigenem Benchmark.
- **Eingebaute Profile** „HDAX Kandidat B RANK10 MOM Trail20“ und „STOXX600 Kandidat A MOM Trail20“ aus den besten Backtests; Strategie-Einstellungen werden **je Universum** gemerkt (`byUniverse`).
- Berechnung und Aktualisierung nur für das ausgewählte Universum.
- **Universums-Badges und -Filter** in Holdings und geschlossenen Positionen.

### Holdings
- **Bruchstücke**: Stückzahl mit Nachkommastellen; **Teilverkauf** möglich.
- **P&L je Holding** (offen und geschlossen, realisiert/unrealisiert) und **Equity-Kurve gegen den Universums-Benchmark**.

### Strategie / Backtest
- **Trailing-Stop** (`TRAIL=`, Wochenschluss vs. Hoch seit Kauf), **Rückkauf-Sperre** nach Trailing-Exit (`TRAILLOCK=`), **Rangliste wählbar** (`RANKING=RSL26 | RSL39 | MOM52_4`) im Scanner und in RSLBT.

### Bedienung
- **Zurück-Navigation**: Esc (außerhalb der Befehlszeilen) bzw. Schaltfläche ◂ geht eine Ansicht zurück.
- **Tastenkürzel-Übersicht**: `?` (außerhalb von Eingabefeldern) oder Befehl `KEYS` / `TASTEN`.
- Versionsanzeige in der Kopfzeile und in HELP.

## [1.0.0]
- Erste Version (MVP).
