# Changelog · Amber Terminal

Alle nennenswerten Änderungen am Terminal. Versionsnummer: `package.json` (Server-Banner, `/api/health`, `/api/about`, MCP-Server) und `public/js/version.js` (Kopfzeile, HELP).

## [1.5.0] – in Arbeit

### Neue Funktionen
- **DMOV – Kursbewegung um den Ex-Dividenden-Tag** (`KO DMOV`, `SAP.DE DMOV 5Y`), US und Europa: Run-up in den 5 Tagen davor, Ex-Tag (Gap und Schluss), Abschlag ÷ Dividende, +1/+2/+3 Wochen ohne und mit Dividende, Erholung bis zum Kurs vor dem Ex-Tag. Je Zeitraum (1Y, 2Y, 3Y, 5Y, ALL) Durchschnitt, Median, bester, schlechtester Wert, 1 SD, Anteil positiv und Durchschnitt in Währung; dazu jeder Ex-Tag einzeln. Nächster Ex-Tag angekündigt (Nasdaq) oder geschätzt. Links aus DVD und DES. Auch über den MCP-Server.
- **DMOV › Buy-write über den Ex-Tag:** Kauf N Handelstage vorher (Standard 2), erster Call über dem Kurs auf dem ersten Verfall 2–10 Tage nach dem Einstieg (beides einstellbar, `ENTRY=`, `DTE=`). Für alle Aktien die Historie (Kurs Einstieg → Verfall, ohne/mit Dividende); für US-Aktien dazu der heutige Call aus der CBOE-Kette: Weeklys ja/nein, Verfall, Strike, Bid/Ask, Open Interest, Spread, Prämie (bei späterem Einstieg geschätzt für den Einstiegstag), Warnung vor früher Ausübung, und die heutigen Konditionen auf alle vergangenen Ex-Tage angewandt (Rendite je Trade, Gewinnquote, Anteil ausgeübt).
- **DSCAN – Buy-write-Scanner über die kommenden Ex-Tage** (`DSCAN SPX`, `NDX`, `ALL`): Ex-Tage der nächsten Tage aus dem Nasdaq-Dividendenkalender, je Aktie die CBOE-Kette (Weeklys, Verfall 2–10 Tage nach dem Einstieg, erster Call über dem Kurs, Prämie, Open Interest, Spread) und die vergangenen Ex-Tage mit den heutigen Konditionen; sortiert nach Ertrag je Trade. Filter einstellbar und gemerkt; der Screen zählt, wie viele Aktien welcher Filter aussortiert. Ohne „weekly options only“ auch Aktien mit nur Monatsoptionen (erster Verfall nach dem Ex-Tag bis 45 Tage, „M“; die Historie hält gleich lang; in DMOV immer). Liquiditätsfilter (Open Interest, Spread) als Schalter, Standard aus; beide Werte stehen immer in der Tabelle. „Zu spät“ (letzter Kauftag vorbei) wird eigens gezählt. Klick öffnet DMOV.
- **Event-Cache** `data/cache/events.sqlite`: Dividenden, Earnings-Termine und Kalender werden einmal geladen und dann aus dem Cache bedient (Dividenden wöchentlich aufgefrischt); fällt eine Quelle aus, gelten die gespeicherten Daten. Größe und „Clear“ in SETTINGS › Data sources.

### Starter
- **Node.js nur einmal laden (Windows, Linux, macOS):** Das Startskript der App (`amber-terminal\start.bat` bzw. `amber-terminal/start.sh`) nimmt auch das Node.js aus `.runtime` im Ordner darüber, das ein allein kopiertes `start.bat`/`start.sh` bei der Erstinstallation geladen hat. Vorher wurde es ein zweites Mal geladen (rund 30 MB).
- **Alpine und andere musl-Linux:** statt abzubrechen wird der offizielle musl-Build von nodejs.org geladen (x64, Prüfsumme geprüft). Fehlt `libstdc++`, sagt die Meldung, wie es installiert wird (`apk add libstdc++`). Für musl auf ARM gibt es keinen Build: Hinweis auf den Paketmanager.

### Datenschutz
- **SEC-Kontakt-E-Mail in SETTINGS › Data sources** statt fest im Code: SEC EDGAR verlangt von Programmen eine Kontaktadresse im Request-Header. Die Adresse steht jetzt nur in `data/settings.json` auf dem eigenen Rechner und geht nur an sec.gov. Ohne Adresse laufen Filings (CF), Insider (INSD), Dokumentsuche (DS) und der M&A-Check unter dem allgemeinen Amber-Terminal-Namen wie im Original. Gilt für alle SEC-Abfragen (`lib/sec-contact.js`).

### Abhängigkeiten
- **TradingView Lightweight Charts 5.3.0** (vorher 5.2.1), aus dem offiziellen npm-Paket, Prüfsumme geprüft; API unverändert, Charts (GP, GIP, RSLBT) geprüft.
- **Node.js 22.13 oder neuer** jetzt auch in `package.json` (`engines`) und `npm run doctor` (vorher 18): der SQLite-Cache braucht `node:sqlite`, das es ohne Flag erst ab 22.13 gibt. Die Starter laden ohnehin das aktuelle LTS (derzeit v26). Sonst hat das Projekt keine Pakete.

## [1.4.1] – in Arbeit

### Dokumentation
- **Neues README** (KamiTerm): nennt Lewis Jackson als Autor von Amber Terminal und verlinkt die Original-Dokumentation, jetzt **README.original.md** (unverändert im Originalzustand). Dazu eine Übersicht der Erweiterungen: RSL26, RSLBT, weitere Screens, Einstellungen, Starter mit automatischem Update für Windows, Linux und macOS.

### Updates
- **Linux und macOS:** `start.sh` bzw. `start.command` (dasselbe Skript) arbeiten jetzt wie `start.bat`: Node.js 22.13+ wird verwendet oder, falls es fehlt oder zu alt ist, als offizieller Build für das System (Linux x64/arm64, macOS Intel/Apple Silicon) nach `.runtime/node` geladen (Prüfsumme geprüft, ohne root). Allein in einen leeren Ordner kopiert, lädt das Skript zuerst die App. Vor jedem Start Update-Prüfung und Installation (`AMBER_UPDATE=0` überspringt das). Entpacken der Updates mit Node selbst, ohne unzip oder tar. Beide Skripte sind ausführbar (`./start.sh`). `server.js --open` beachtet `QT_NO_OPEN=1`.
- **Neues Standard-Repo für Updates: https://github.com/hoermto/kamiterm.git** (Branch master). Der Updater spricht jetzt neben Gitea/Forgejo auch die GitHub-API (neueste Commits, ZIP-Download). Gilt nur für die Update-Prüfung; die git-Remotes eines Checkouts bleiben unverändert.
- **SETTINGS › Updates:** Repo-URL und Branch einstellbar (gespeichert in `data/launcher.cfg`, leer = Wert aus start.bat bzw. Standard), mit Status der letzten Prüfung und „Check now“. Speichern prüft sofort.

## [1.4.0] – in Arbeit

### Bedienung
- Der HELP-Link oben rechts (externe Website) entfällt. Die Hilfe im Terminal (Taste HELP, Befehl `HELP`) bleibt.

### RSL26
- **GP und DES je Zeile der Rangliste:** Chart (`<Ticker> GP`) und Beschreibung (`<Ticker> DES`) mit einem Klick, neben + Kaufen und ⏏ Verkaufen.
- **GP auch in den Holdings** (offene Positionen), vor ✎ ⏏ ✕.

### Einstellungen
- **Börsenuhren oben rechts** wählbar (SETTINGS › Market clocks, bis zu 8, in der Reihenfolge des Anhakens): NY, Toronto, São Paulo, London, Xetra, Paris, Amsterdam, Zürich, Mailand, Indien, Shanghai, Hongkong, Seoul, Tokio, Sydney. Je Börse Ortszeit und ein Punkt für die Sitzung: grün = Handel, amber = erweiterte Handelszeit (Pre-Market/After Hours, Auktionen, Tradegate 8–22 Uhr bei Xetra), grau = geschlossen (auch Mittagspausen, Wochenende). Tooltip mit Handelszeiten. Börsenfeiertage werden nicht berücksichtigt. Standard bleibt NY, LDN, TKY.
- **Laufband (Tickerzeile unten)**: Scroll (Standard), Follow Windows oder Off. Bisher stand es still, sobald Windows weniger Animationen verlangt, was in Remote-Desktop-Sitzungen automatisch passiert oder wenn unter Einstellungen › Barrierefreiheit › Visuelle Effekte die Animationseffekte aus sind. SETTINGS zeigt an, was Windows gerade meldet.

## [1.3.1] – in Arbeit

### Windows-Starter
- **Updates ohne git:** Installationen ohne `.git`-Ordner (ZIP-Download) konnten sich nicht aktualisieren. Jetzt fragt der Updater die Web-API des Repo-Servers (Gitea/Forgejo) nach dem neuesten Commit des Branches und installiert ihn als ZIP über den App-Ordner; `data\` bleibt unberührt, nicht mehr enthaltene Dateien werden entfernt. Installierte Version in `data\installed.json`. Eine von Hand heruntergeladene Kopie wird beim ersten Start einmal aufgefrischt.
- **Neuinstallation** in einen leeren Ordner per ZIP-Download statt `git clone`. Git wird nicht mehr benötigt und nicht mehr heruntergeladen (spart etwa 21 MB); nur ein Git-Checkout (Entwicklung) aktualisiert weiter per git.
- **Update auch bei laufendem Terminal:** `start.bat` prüft jetzt auch dann auf Updates, wenn das Terminal noch läuft (z. B. Fenster gerade erst geschlossen oder Browser-Tab). Gibt es eins, wird der Server beendet, aktualisiert und auf demselben Port neu gestartet. Vorher öffnete er nur das Fenster und das Update blieb liegen.

### Fenster schließen
- Die Seite meldet dem Server beim Schließen ab: Edge hielt die Verbindung eines geschlossenen Fensters manchmal offen, dann lief der Server weiter. `data\server.log` protokolliert jetzt, wann ein Fenster verbunden und geschlossen wird.

## [1.3.0] – in Arbeit

### Holdings
- **Schmalere Tabelle:** RRG-Quadranten abgekürzt (Lead, Weak, Lag, Impr; voller Name als Tooltip), Spalte „RRG Δ Wo.“ statt „Woche Δ“. „RRG-Exit seit“ zeigt nur noch das Datum; die doppelte Spalte „Schwächephase“ (ja/nein) entfällt, ein Datum heißt ja. Gilt auch für die Backtest-Holdings.
- Spalte **„Modus“** entfällt: Der RRG-Exit-Modus ist eine globale Einstellung (Exit-Abschnitt) und war in jeder Zeile gleich.
- **Aktionen als Symbole:** ✎ Bearbeiten, ⏏ Verkaufen, ✕ Löschen, bei geschlossenen Positionen ↺ Wieder öffnen, in der Rangliste + Kaufen und ⏏ Verkaufen; Text als Tooltip.
- Schaltfläche **„Holdings“** (Sprung zur Tabelle) im Scanner-Formular entfällt.

## [1.2.0] – in Arbeit

### Einstellungen (`SETTINGS`, ⚙ in der Tastenleiste)
- **Farbschema**: Amber (Standard), Grey, White, Green, Red. Gilt sofort für Akzentfarbe, Titelzeilen, Tasten und Charts; wird beim Start ohne Aufblitzen des Amber-Schemas angewendet.
- **Name oben links** frei wählbar (statt „AMBER“, max. 16 Zeichen), auch im Browser-Titel.
- **Apps in der Tastenleiste**: Umschalter **Auto** (meistgenutzte Apps links, Anzahl Tasten einstellbar, nie genutzte füllen aus der Standardleiste auf) oder **Konfigurieren** (eigene Auswahl und Reihenfolge: hinzufügen, ↑/↓, entfernen; „Auto-Reihenfolge übernehmen“, „Standardliste“). Die gelben Sektor-Tasten (GOVT … CRNCY) bleiben fest links.
- **App-Nutzung** wird je Funktionscode gezählt (Wiederherstellen der Panels beim Start und „Zurück“ zählen nicht); Tabelle mit Anteil und **Zurücksetzen**. Die Auto-Rangfolge wird beim Start bzw. bei Änderung der Einstellungen neu sortiert, nicht nach jedem Klick.
- Gespeichert in `data/state.json` (`amberPrefs`, `amberUsage`).

### Windows-Starter und Updates
- **`start.bat`** prüft Node.js (≥ 22.13) und Git und lädt bei Bedarf portable Versionen nach `.runtime` (ohne Admin-Rechte, Prüfsummen geprüft). Allein in einen leeren Ordner kopiert, installiert er die App per `git clone`.
- **Automatisches Update beim Start** aus dem Git-Repo (Standard: LAN-Origin, Branch `master`), nur als Fast-Forward. Lokale Änderungen oder lokale Commits blockieren das Update, ohne etwas zu verändern. `data\` bleibt unberührt. Eine laufende alte Version wird vorher beendet.
- **Eigenes App-Fenster** (Edge/Chrome App-Modus) statt Browser-Tab; `APP_WINDOW=0` schaltet das ab.
- **Fenster schließen beendet das Terminal:** Ist 20 s lang kein Fenster und kein Tab mehr verbunden, stoppt der Server (ein Neuladen zählt nicht). `EXIT_ON_CLOSE=0` lässt ihn weiterlaufen. Neue Taste **⏻** in der Tastenleiste beendet sofort (mit Rückfrage).
- **Läuft schon:** `start.bat` öffnet nur das Fenster erneut, ohne Download- und Update-Prüfung.
- **Tägliche Update-Prüfung** im laufenden Terminal: Badge **⚠ UPDATE** neben der Versionsnummer, Tooltip mit den neuen Commits, Klick prüft sofort. Einstellungen je Rechner in `data\launcher.cfg`.
- Server überspringt Ports, die Browser blockieren (z. B. 4190). `stop.js` und `launch.js` warten länger auf einen beschäftigten Server.

### Charts
- **Equity-Charts in RSLBT und RSL26-Holdings**: Umschalter Kurve (Y-Achse **linear / log**) oder **P&L je Jahr / Monat** als Balken (Betrag oder %), Strategie neben Benchmark; bei Holdings ohne Einzahlungen. 10-Jahres-Kurven werden jetzt vollständig angezeigt (vorher nur die letzten ~5 Jahre).

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
