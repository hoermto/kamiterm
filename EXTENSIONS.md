# Grokki extensions · Amber Terminal MVP

**Version 1.4.1** (in Arbeit) — Änderungen siehe [CHANGELOG.md](CHANGELOG.md). Versionsquelle: `package.json` (Server/MCP) und `public/js/version.js` (UI-Kopfzeile, HELP), Test `test/version.test.js`.

Installed **only on the bot's shared box**, not on the user's offline computer.
Folder: `/workspace/thoBox/Grokki/amber-terminal`.

## Start / stop

```sh
cd /workspace/thoBox/Grokki/amber-terminal
PORT=3788 QT_NO_OPEN=1 node scripts/launch.js --no-open
# http://localhost:3788 (launcher prints a higher free port if occupied)
PORT=3788 node scripts/stop.js
```

Original install on :3787 is left alone. The stop command checks this copy's root;
never use `--all` unless you mean to stop every copy. This is a loopback-only app:
localhost here means the bot's box, not your own laptop. Open the box desktop to use
it. After backend changes restart this copy; after UI changes refresh the browser.

## Command cheat sheet

| Command | Meaning |
|---|---|
| `RSL26` / `RSL26 SPX` | Scanner: Rangliste, Holdings, weekly Exits (kein automatischer Backtest) |
| `RSL26 NDX N=8` | Scanner NDX; default RRGEXIT=CONFIRM RANKTOP=50 (+1 Woche) |
| `RSL26 DAX N=5` | Scanner DAX/HDAX; default RRGEXIT=OFF (Exit über RSL < Bench) |
| `RSL26 SPX RRGEXIT=DIRECT RANKTOP=25` | Leading→Weakening Exit sofort |
| `RSL26 SPX RRGEXIT=DIRECT+RSL` | L→W nur wenn RSL Aktie < RSL Benchmark |
| `RSLBT SPX` | Backtest-Ansicht (Formular, startet erst mit `RUN` / Button) |
| `RSLBT SPX YEARS=10 N=8 RUN` | Manueller Backtest mit festen Parametern |
| `RSL26 KAUF AAPL` | Offene Position in Holdings (Universe = aktueller Scan, Default-Kaufdatum = heute UTC) |
| `RSL26 VERKAUF AAPL` | Offene Position schließen (Historie bleibt) |
| `RSL26 HOLDINGS` (Alias `RSL26 WATCH`) | Holdings (offene Positionen) + Live-Exits (ohne Monats-Backtest) |
| `RSL26 EDIT AAPL BUYDATE=2026-10-01 PRICE=180 QTY=50` | Offene Position bearbeiten (auch `NOTE=`, `NEWUNIVERSE=NDX`, Suche einschränken mit `POSUNIVERSE=`, oder `ID=`). Kaufdatum nur Anzeige/Audit; Exits unabhängig davon |
| `RSL26 LOESCHEN AAPL` (auch `LÖSCHEN` / `DELETE`) | Offene Position endgültig löschen (keine Historie) |
| `RSL26 REOPEN AAPL` | Zuletzt geschlossene Position wieder öffnen |
| `RSL26 KAUF AAPL DATE=2026-01-15` | Kauf mit Datum-Override (UTC YYYY-MM-DD) |
| `RSL26 … MASKIP=0` | „M&A ignorieren“ aus (Standard `MASKIP=1`: M&A-Titel zählen nicht zum Kauf-Fenster). `HIDEMA` ist entfallen und wird ignoriert |
| `RSLBT SPX START=10000 SIZE=EQUITY FRACTIONAL=1` | Backtest-Startkapital, Budget=Equity/n, Bruchstücke (Defaults) |
| `RSLBT SPX YEARS=10 N=5 RANKTOP=25 TRAIL=20 TRAILLOCK=4 RUN` | Backtest mit Trailing-Stop −20 % vom Hoch seit Kauf, 4 Wochen Rückkauf-Sperre |
| `RSLBT SPX YEARS=10 N=5 RANKTOP=25 TRAIL=20 TRAILLOCK=4 RANKING=MOM52_4 RUN` | Backtest mit Rangliste 12-1-Momentum statt RSL26 |
| `RSL26 SPX RANKING=MOM52_4` | Scanner: Rangliste nach 12-1-Momentum, Spalte „Mom 12-1 %“ (RSL26 bleibt als Spalte für den RS-Exit) |
| `RSL26 SPX TRAIL=20` | Scanner: Holdings zeigen Hoch seit Kauf, Stop-Level und Abstand; Exit-Hinweis bei Auslösung |
| `<Ticker> GP` | Preischart ohne Overlay (auch bei offener RSL-Position) |
| `GP AAPL BUY=150.20@2026-11-09 STOP=120.16 TRAIL=20 SRC=RSL` | Preischart mit Kauflinie, Marker „K“ und Stop-Linie aus Parametern (Aliase CHART/GRAPH/PRICE). Mehrere Lots: `BUY=150@2026-11-09,148@2026-10-01`. Ohne Datum hinter `@` nur Linie, kein Marker. |
| `MA` / `MA LIST` | Manuelle M&A-Liste anzeigen |
| `MA ADD AAPL NOTE=deal` | Ticker manuell als M&A markieren |
| `MA REMOVE AAPL` | Manuellen M&A-Eintrag löschen |
| `RRG` | Primary view: 11 SPX sector ETF proxies vs SPX |
| `RRG LEADING` | Only Leading sectors |
| `RRG XLK` | Technology representative stocks vs SPX (not vs XLK) |
| `RRG XLC IMPROVING` | Communication/telco stocks, Improving only |
| `RRG SECTOR=XLE SEASON=WINTER` | Energy stocks in Lagging/Winter phase |
| `RRG AAPL MSFT NVDA` | Named stocks' current rotation phase |
| `RRG AAPL MSFT SEASON=WEAKENING` | Named stocks with a phase filter |
| `MPUT` / `MPUT SPX` | Price-bottom + OTM long-put scanner |
| `MPUT NDX IVRMAX=30 OTM=5` | Nasdaq reference roster, low-IV proxy cutoff 30, target 5% OTM |
| `MPUT SPX OTM=20 MAXLOSS=15 MAXLOSSPCT=12 SEASON=W2S` | Far-OTM 6–12M put, max-loss filters ($/share, % of capital), RRG gate W2S/SPRING/OFF |
| `GSW` | Gold/Silber-Swap: Regelzustand (Gold/Silber/Spike), sig, k60, Schwellen in Spot-, GLD/SLV- und Paar-Einheiten, Holdings (eigenes Buch) mit Swap-Knopf und Kauf/Verkauf/Bearbeiten/Löschen, Charts. Einstellungen oben (⚙) |
| `GSWBT` | GSW-Backtest: Grid, Robust-Rangliste (Nachbarschaftsmittel End-Unzen), Walk-Forward jährlich, OOS-Neustart, Handelspaar wählbar; „Parameter übernehmen“ schreibt in die GSW-Einstellungen |


Gruppe „Kamikaze“ in HELP (Feld `group` je Funktion, kein Eintrag in `data/settings.json`): RSL26, RSLBT, RRG, MPUT, PARAMHEATMAP, GSW, GSWBT, FV, FVSCAN, HEAT sowie seit 22.11.2026 DMOV und DSCAN (vorher „Equities“).

RSL26 and MPUT have universe tabs and parameter inputs. RRG has quadrant tabs,
sector selector, a four-quadrant graph with eight weekly tail points, and a table.
Click a sector table row to drill down; stock rows open GP. MPUT rows open the
suggested expiry in OMON. HELP and DATA list the new functions under **Grokki**.

### Raw endpoints

- `/api/fn/rsl26?universe=SPX&years=5&n=10&rrgExit=RANK&rankTop=25` (`backtest=0` optional; `rrgExit=DIRECT+RSL` or `DIRECT_RSL`)
- `/api/fn/rsl26?action=BUY&symbol=AAPL&universe=SPX` / `action=SELL` / `action=WATCH`
- `GET /api/rsl-watch` · `POST /api/rsl-watch` mit `action`:
  - `ADD` (Alias `BUY`/`KAUF`) `{symbol, universe, buyDate?, buyPrice?, qty?, note?}`
  - `EDIT` `{id, universe?, buyDate?, buyPrice?, qty?, note?, sellDate?, sellPrice?}` (oder `symbol`+`universe` statt `id`)
  - `SELL` `{id | symbol[, universe], sellDate?, sellPrice?}` · `DELETE` `{id | symbol}` · `REOPEN` `{id | symbol}`
  - Antwort `{ok, message, position, duplicated?, open, sold}`; Dubletten (gleiches Symbol+Universe offen) werden bei ADD/EDIT/REOPEN abgelehnt (`ok:false`).
- `/api/fn/rrg` (sectors)
- `/api/fn/rrg?sector=XLK&season=Improving`
- `/api/fn/rrg?symbols=AAPL,MSFT&quadrant=Leading`
- `/api/fn/mput?universe=NDX&ivrMax=30&otm=5`

## Universe coverage — important

`lib/fn/grokki-universes.js` is the one editable roster file:

- **SPX: full S&P 500 constituents (~503 tickers incl. GOOG/GOOGL, BRK-B, BF-B)**,
  snapshot from [datasets/s-and-p-500-companies](https://github.com/datasets/s-and-p-500-companies)
  (Wikipedia-derived), **as-of 2026-11-09**, mapped into the eleven GICS→XL* sector
  buckets. Still a static snapshot — not point-in-time membership for backtests.
- **NDX: 100 reference tickers**, including legacy constituents; NOT a guaranteed
  current Nasdaq-100 roster. Stale/unavailable names are explicitly excluded.
- **DAX: 40 reference tickers** with Yahoo `.DE` suffixes, also unverified membership.
- RRG drill-down uses the same sector stock lists as SPX (full S&P sectors). ETF
  proxies: XLK, XLC, XLY, XLP, XLE, XLF, XLV, XLI, XLB, XLU, XLRE.

### OHLCV cache (general)

Daily bars are stored in **`data/cache/ohlcv.sqlite`** (`node:sqlite`; table
`bars(symbol,time,OHLCV)` + `meta(symbol,last_fetch)`). The cache is the **general
1D layer inside `lib/providers.js` `getCandles()`** for Yahoo-sourced symbols (US
equities without API keys, `YAHOO:…`, FX/metals via Yahoo). Charts (`/api/candles`),
BTST, COMP, PORT, SURP, and Grokki scanners all share it. Intraday, Binance/Kraken,
and keyed feeds (Alpaca/Polygon) are untouched. An in-memory TTL sits on top.
Cold loads fetch from Yahoo and warm the DB; warm loads serve from SQLite and only
pull missing/recent bars (refresh if `last_fetch` >15 min during US market hours, or
last bar older than the last trading day). Today's partial daily bar is overwritten
on refresh. If SQLite fails, behaviour falls back to the previous live chain.
Scan budget default is 180s / concurrency 6 so a first full SPX run can complete.

**Tagesbalken-Datierung (Parser-Version 2, 22.11.2026).** `parseYahoo` datiert Tages-, Wochen- und Monatsbalken je Balken
mit dem Kalendertag in der Börsenzeitzone (`meta.exchangeTimezoneName`, `providers.yahooDayOf`), also mit der an diesem Tag
gültigen Sommer- oder Winterzeit. Vorher galt der **aktuelle** `gmtoffset` für alle Balken. Betroffen waren Symbole, deren
Yahoo-Zeitstempel Mitternacht Börsenzeit ist: Futures `=F` (Mitternacht New York) und Devisen `=X` (Mitternacht London,
auch die Metall-/FX-Kürzel, die auf `=X`/`=F` gehen). Je nach Jahreszeit beim Abruf rutschten die Balken der anderen
Jahreszeit einen Tag zurück (Freitag → Donnerstag, Montag → Sonntag). Aktien, ETFs, Indizes (`^`), `.DE`/`.L`/`.T` (Zeitstempel
zur Eröffnung) und Krypto (UTC) sind unverändert (geprüft gegen Live-Yahoo, 0 Abweichungen). Ohne Zeitzone gilt der alte Weg.
`meta` hat die Spalte `parser` (alte Dateien werden beim Öffnen per `ALTER TABLE` ergänzt, Standard 1). Ist ein `=F`/`=X`-Eintrag
älter als `PARSER_VERSION` (`staleParser`), lädt die nächste Abfrage das Symbol komplett neu und **ersetzt** seine Balken
(`upsertBars(…, {replace:true})`); die Hintergrund-Aktualisierung (`refreshDaily`) überspringt solche Einträge. So repariert
sich jeder Cache (Box und lokale Terminals) selbst, ohne dass die Datei angefasst werden muss.
The cache directory is listed in the Seafile library `seafile-ignore.txt`
(`amber-terminal/data/cache/`) and is not synced.

Coverage is shown on screen and in JSON, together with per-symbol errors. Missing
history does not become a zero score. Histories with latest price >14 days old are
rejected. A scan budget can return partial coverage; retry reuses cached histories.
Do not interpret a partial-universe rank as an all-index rank.

## RSL26: classic Levy formula + weekly exits

Daily source bars are grouped into Monday-based weeks; latest available close per
week is used. `RSL26 = current weekly close / SMA(last 26 weekly closes)`. The SMA
includes the current observation. This is the classic Levy variant (not the average
of 26 price ratios). RSL >1 means above the 26-week average. Descending ranking.
The current incomplete week is included and the result can change during the week.

### Parameters

| Param | Meaning | Defaults |
|---|---|---|
| `YEARS` | Backtest length | 5 (1–15) |
| `N` | Top-N positions | 10 (1–100) |
| `RRGEXIT` | `OFF` \| `DIRECT` \| `DIRECT+RSL` \| `CONFIRM` \| `RANK` | **SPX=`RANK`**, **NDX=`CONFIRM`**, **DAX=`OFF`** |
| `RANKTOP` | Leader-Schutz Rank-Band | **SPX=25**, **NDX=50**, DAX unused for RRG |
| `BACKTEST=1` / `RUN` | Backtest nur auf expliziten Trigger (Default: aus) | off |
| `START` | Backtest start capital | **10000** |
| `SIZE` | `EQUITY` (Kapital = Open-Equity vor Entries) oder `START` (fix Startkapital) | **EQUITY** |
| `FRACTIONAL` | `1` Bruchstücke / `0` ganze Stücke | **1** |
| `FEE` | Absolute Gebühr je Trade (BUY und SELL) in $ | **1** |

Benchmarks: SPX `^GSPC`, NDX `^NDX`, DAX `^GDAXI`. RRG is always **weekly, stock vs market, never daily**.

### Exit rules (weekly only, current criteria — independent of purchase date)

Recommendation: use RRG-Exit **together with** Levy monthly rotation or the
`RSL Aktie < RSL Benchmark` exit. Live Holdings exits evaluate the **current** weekly
state (RRG weakness phase, Rank, Rank-Schutz, RSL vs Benchmark). The buy date is stored
and shown but **does not suppress** an exit. `offen seit …` marks the start of the
still-active weakness condition (Leading→Weakening/Lagging in the weekly trail that has
not yet returned to Improving/Leading), not the buy date. A trail that never showed
Leading→Weakening/Lagging does not invent a weakness phase.

1. **`DIRECT`** — Exit as soon as the title switches week-to-week from Leading to Weakening
   (or Leading→Lagging).
2. **`DIRECT+RSL`** — Same switch, but only if stock RSL 26W is also below benchmark RSL.
3. **`CONFIRM`** (NDX standard: Top 50 + 1 week) — Inside Rank-Schutz (`rank ≤ RANKTOP`)
   the L→W switch gets **one week confirmation**; outside the band, exit immediately on
   the switch. After the confirmation week, exit if still Weakening/Lagging.
4. **`RANK`** (SPX standard: Top 25) — After Leading→Weakening or Leading→Lagging the title is in a
   **weakness phase** while it stays Weakening or Lagging. Exit only when, during this
   phase, rank falls **outside** the Rank-Schutz band; titles inside stay held.
   Return to Improving/Leading ends the phase (no exit from the phase end alone).
   Example Top 25: L→W while rank≤25 stays protected; if during Weakening/Lagging rank
   drops below Top 25 → exit; Improving/Leading ends the weakness phase.
   User-provided context: Backtest SPX 2020–2026 was better in 6 of 7 years than
   Leader-Schutz + 1 week.
5. **`OFF`** (DAX/HDAX standard) — No RRG-Exit; exit via **RSL Aktie < RSL Benchmark**.
6. **Always (all universes):** weekly exit when **RSL Aktie < RSL Benchmark**.

### Holdings UI

**GP-Overlay (Befehlsparameter, seit 21.11.2026):** GP kennt RSL nicht selbst. Linien kommen nur aus
Parametern, damit beliebige Tools dieselben Daten mitgeben können:
`GP AAPL BUY=150.20@2026-11-09 STOP=120.16 TRAIL=20 SRC=RSL` (auch `AAPL GP …`, Aliase CHART/GRAPH/PRICE;
`SAP GY EQUITY` bleibt der Ticker, die `KEY=Wert`-Wörter sind Argumente). `BUY=` Lots kommagetrennt
`preis@YYYY-MM-DD` — ohne Datum nur die gelbe gestrichelte Kauflinie, mit Datum zusätzlich Marker „K“.
`STOP=` rot gestrichelt, Label „Stop 120,16“; `TRAIL=20` ergänzt das Label zu „Stop −20 % 120,16“.
`SRC=RSL` stellt das Präfix voran und erscheint im Hinweis. Dezimalpunkt in den Werten. Ungültige
Teile: Hinweis „Ungültig: …“, Chart wird trotzdem gezeichnet. Reines `GP AAPL` hat kein Overlay.
Der GP-Knopf in den RSL-Holdings und in der Rangliste (nur wenn der Ticker offen gehalten wird)
baut den Befehl aus den bereits berechneten Tabellenwerten (alle offenen Lots des Tickers, Stop und
Trail-% wie in der Holdings-Tabelle, `SRC=RSL`) — keine zweite Stop-Berechnung, keine Lookup-API.
`/api/fn/rsloverlay` entfällt. Lightweight Charts 5.3: `createPriceLine` und `createSeriesMarkers`.

Holdings / Exit-Watch show RRG quadrant, week change, rank, weakness-phase flag, and
`RRG-Exit offen seit YYYY-MM-DD` while a Leading→Weakening/Lagging phase is still active.
The label clears on Improving/Leading. Backtest final holdings carry the same fields;
weekly exits are listed under the equity section.

### Holdings (offene Positionen) (live exits)

Die Holdings-Liste ist die RSL-„Watchliste“: Ihre echten Positionen. Direkt in der Liste:
Zeile **Hinzufügen** (Symbol frei, muss nicht in der Rangliste sein; Universe, Kaufdatum
= heute, optional Preis/Stück/Notiz), pro Zeile **Bearbeiten** (Speichern/Abbrechen),
**Verkaufen** (Verkaufsdatum, Historie bleibt) und **Löschen** (endgültig, mit Rückfrage).
Geschlossene Positionen: **Wieder öffnen** und **Löschen**. Jede Position hat eine stabile `id`;
alte Einträge ohne id werden beim Laden migriert (Backup `data/rsl-watchlist.backup.json`).

Persistenz: `data/rsl-watchlist.json` (Seafile-Sync). Pro Position: symbol, universe,
status open/closed, buyDate (UTC ISO day), optional buyPrice/qty/note, closedDate.

- **Kauf** aus der Rangliste (Button) oder `RSL26 KAUF TICKER` — Universe = aktueller
  Scan. Bereits offene gleiche Symbol+Universe-Kombination wird nicht dupliziert.
- **Verkauf** markiert closed (Historie bleibt auditierbar). Live-Exits nur für **open**.
- Exit-Engine: wöchentlich, **unabhängig vom Kaufdatum** — aktuelle Kriterien
  (RRGEXIT/RANKTOP je Universe, Rank-Schutz, RSL < Bench). Kaufdatum bleibt für
  Anzeige/Audit. Command überschreibt Defaults nur für das Scan-Universe.
- Monats-Backtest bleibt simuliert und überschreibt die Holdings **nicht**.
- Datum-Default: heutiger UTC-Kalendertag; Override `DATE=` / `BUYDATE=` / `SELLDATE=`.

### M&A flags (manual + SEC EDGAR)

Flag stocks with announced or in-progress mergers so they can be marked in Holdings /
RSL ranking (and annotated in RRG / MPUT when those tickers were checked).

1. **Manual list** — `data/ma-list.json` (Seafile-synced user data). Always flags.
   Manage in the RSL26 UI block „M&A-Liste (manuell)“ or via `/api/fn/ma`:
   - `GET /api/fn/ma?action=LIST`
   - `GET /api/fn/ma?action=ADD&symbol=AAPL&note=deal&date=2026-11-01`
   - `GET /api/fn/ma?action=REMOVE&symbol=AAPL`
2. **SEC EDGAR auto-check** (US tickers only; **DAX / `.DE` skipped**). Scope per
   owner request: **open Holdings ∪ current Top max(N, Top X ≤ 50)** of the RSL ranking (`N` / `TOPX`
   input) — not the full universe. Resolves ticker→CIK via
   `company_tickers.json`, reads `data.sec.gov/submissions/CIK….json`, and flags if
   a filing in the last **180 days** matches: `DEFM14A`, `PREM14A`, `DEFM14C`,
   `PREM14C`, `SC TO-T`, `SC 14D9`, `S-4` (+ `/A`), `SC 13E3` (+ `/A`).
   Role labels when the company itself is the filer: `SC 14D9` / `DEFM14*` /
   `PREM14*` / `SC 13E3` → **target**; `SC TO-T` → **acquirer**; `S-4` →
   **possible-acquirer** (S-4 is often filed by the issuer/acquirer). Soft-fail on
   network errors (no flag, no crash). User-Agent: the contact email from
   SETTINGS → Data sources (SEC asks for one; stored only in `data/settings.json`),
   or the generic Amber Terminal name when none is set. Rate ≤ ~5 req/s. Cache:
   `data/cache/ma-edgar.json` (Seafile-ignored), refresh when stale > 7 days.
3. **UI** — `M&A` badge with tooltip (source, form, date, link) on Holdings and the
   RSL ranking; also on RRG / MPUT rows that were checked. The ranking always shows
   flagged names (marked). Entry option **M&A ignorieren** (`MASKIP=1`, default on)
   skips them for the buy window — see „M&A ignorieren“ below. (`HIDEMA` removed.)

API check helper: `/api/fn/ma?action=CHECK&symbols=AAPL,MPC&universe=SPX`.

### Backtest

**Data path:** `history()` → `getCandles(…, '1D')` → SQLite OHLCV cache
(`data/cache/ohlcv.sqlite`). Field `ohlcvCache` reports `fromCache` hits.

**Portfolio model (weekly Top-N, shared cash pool):**
- **Signal:** last trading day of the week (Friday / prior session) on **close**.
  Ranking = Levy RSL26. Exits = same rules as live Holdings (`evaluateTrailExit` /
  RRGEXIT / Rank-Schutz / RSL < Benchmark).
- **Execution:** first trading day of the next week (Monday / next session) at
  **OPEN** when present, else close (`execPriceKind`).
- **Cash pool:** on each exec day, sell all exit signals first (proceeds → cash),
  then buy fills in rank order among Top-n not already held, until `n` positions or
  cash runs out.
- **Position budget** for each new entry = `min(Kapital / n, available cash)`.
  - `SIZE=EQUITY` (default): `Kapital` = total portfolio equity at that day's open
    marks, computed **once before entries** (after exits; same total as pre-exit open
    equity).
  - `SIZE=START`: `Kapital` = fixed `START` capital.
  If cash &lt; budget, buy with what's available; if cash ≈ 0, no entry that week.
- **`FRACTIONAL=1`** (default): fractional shares allowed. **`FRACTIONAL=0`**: whole
  shares `floor(budget/price)`; leftover stays cash; skip if 0 shares.
- **`FEE=`** (default **1**): absolute currency fee **per execution** (each BUY and
  each SELL). Deducted from cash; recorded in trade log / `stats.totalFees`. Not a
  percentage. UI: „Gebühr pro Trade“.
- **`RSEXIT=`** (default **1**): weekly exit when stock RSL26 < benchmark RSL26.
- **`TRAIL=`** (API-Default **0** = aus, 0–90 %; Terminal-Standard seit 10.11.2026 **20**, siehe „Standardprofil“): Trailing-Stop. Exit, wenn der
  Wochen-Schluss (Freitag) ≤ (1 − TRAIL/100) × höchster Wochen-Schluss seit Einstieg
  (Startwert = Einstiegskurs). Ausführung wie alle Exits am nächsten Montag-Open.
  Greift nur, wenn kein anderer Exit (RS/RRG) in derselben Woche feuert. Grund im
  Trade-Log z. B. `Trailing-Stop −20 % vom Hoch (Hoch 48,86, Close 38,22)` (orange markiert);
  Stats: `trailingExits`, `trailLockSkips`.
- **`TRAILLOCK=`** (default **4**, 0–52 Wochen): nach einem Trailing-Exit wird der Ticker
  N Wochen nicht zurückgekauft; der Slot wird mit dem nächsten Top-N-Namen gefüllt.
  `TRAILLOCK=0` erlaubt sofortigen Rückkauf.
- Parität (SPX, 503 Ticker, 10 J. 2016-11-09..2026-11-09, Stand 10.11.2026):
  RANK N5 RT25 RS1 ohne TRAIL bzw. TRAIL=0 → CAGR 57,62 % / MaxDD −50,08 % (unverändert);
  mit TRAIL=20 TRAILLOCK=4 → 68,76 % / −37,96 % / MAR 1,811 (37 Trailing-Exits, 24 gesperrte Käufe).
  Walk-Forward („Parameter neu bestimmen“, `rsl-eval.mjs`) übernimmt TRAIL/TRAILLOCK fest oder tunt TRAIL 0/20 mit (siehe unten).
- **`RANKING=`** (default **RSL26**): Rangliste für Neukäufe (Top-N) **und** für den
  Rank-Schutz (`RANKTOP` vergleicht den Rang in dieser Rangliste).
  - `RSL26` — Levy (Wochenschluss / SMA 26 Wochenschlüsse), bisheriges Verhalten.
  - `RSL39` — Wochenschluss / SMA 39 Wochenschlüsse.
  - `MOM52_4` — 12-1-Momentum: Wochenschluss vor 4 Wochen / Wochenschluss vor 52 Wochen − 1
    (die letzten 4 Wochen zählen nicht; braucht 53 Wochenschlüsse).
  RS-Exit (RSL26 Aktie < RSL26 Benchmark) und RRG-Exits bleiben unverändert. Scanner zeigt
  die aktive Kennzahl als eigene Spalte („Mom 12-1 %“ bzw. „RSL39“) und weiter RSL26.
  Für MOM52_4 lädt der Scanner 2 Jahre Kurshistorie statt 1.
  Parität (SPX, 10 J. 2016-11-09..2026-11-09, RANK N5 RT25 RS1 TRAIL=20 TRAILLOCK=4):
  RSL26 68,76 % / −37,96 % / MAR 1,811 (265 Trades, unverändert);
  MOM52_4 81,03 % / −37,95 % / MAR 2,135 (428 Trades) = identisch mit `scripts/entry-variants.mjs` (D_mom12_1).
  Walk-Forward übernimmt RANKING fest oder tunt RSL26/RSL39/MOM52_4 mit (siehe unten).
- **`confirmWeeks=`** (default **1**, range 1–8): confirmation weeks for
  `RRGEXIT=CONFIRM` before a protected leader exits.
- **`RANKTOP=0`**: Rank-Schutz aus (sofortiger Exit bei Weakness für RANK/CONFIRM).
- Parameter-Grid / Heatmaps: `PARAMHEATMAP` UI + `data/backtests/grid-2026-11-09.*`
  and `data/backtests/heatmaps-2026-11-09/`.
- Tool-Einstellungen: `data/settings.json` (Seafile-sync) + localStorage; UI merkt
  letzte Werte; `RSL26 RESET` / Button „Zurücksetzen“. Exit-Info-Panel in RSL26.
- 10y-Vergleich: `data/backtests/10y-2026-11-09/` (+ `10y-2026-11-09.csv`).
- Held names without an exit stay held even outside Top-n.
- Daily equity = cash + MTM at close. Survivorship bias; no historical M&A filter.

**Results (`backtest.stats`):** start/final equity, total return, CAGR, max DD,
closed / offen (held at period end), win rate, hold days & weeks, avg cash quota,
`entriesReducedDueToCash`, realized/unrealized P&L, benchmark B&H, equity chart.
`START=` default 10000.

**Trade log / CSV (optional UI):** `backtest.tradeLog` (one row per BUY/SELL:
date, signalDate, ticker, action, reason, price/open, shares, value, budget,
cash before/after, equityAtOpen, P&L, hold days, rank) and `backtest.weeklyLog`
(week, equity, cash, #positions, exits/entries/reduced, kapital, budget).
UI: collapsible Trade-Protokoll (paged) + Wochen-Summary; buttons
`CSV Trades` / `CSV Wochen`. German Excel: UTF-8 BOM, `;` separator, decimal
comma, ISO dates (client Blob via existing `downloadText`). Helpers:
`toGermanCsv` / `backtestTradesCsv` / `backtestWeeklyCsv`. Invariants via
`auditBacktestInvariants` (`backtest.audit`).


## RRG: JdK-style approximation, not proprietary JdK

Benchmark is **SPX itself (`^GSPC`)**, never the selected sector ETF. Align weekly
observations by Monday-based week:

1. `RS = security_close / SPX_close`.
2. `RS-Ratio = 100 * RS / SMA13(RS)`.
3. `RS-Momentum = 100 * RS-Ratio / SMA4(RS-Ratio)`.
4. Four quadrants at axes 100:
   - Leading (ratio>=100, momentum>=100) = **Summer**.
   - Weakening (ratio>=100, momentum<100) = **Autumn**.
   - Lagging (ratio<100, momentum<100) = **Winter**.
   - Improving (ratio<100, momentum>=100) = **Spring**.

Seasons mean **rotation phase**, NOT calendar seasonal returns. These normalized
moving-average formulas are transparent approximations, not licensed JdK values.
Around sixteen aligned weekly observations are required; partial current week is
included. Sector/subgroup filter and stock filter operate on the same quadrants.
Use ALL to clear the filter. Up to 50 named stock/ETF tickers per request. Sector
codes such as XLK are interpreted as drill-down commands; overview displays ETFs.

## MPUT: married puts = long stock + long protective put (v2, 5 Nov 2026)

Pipeline: (1) price-bottom stock filter → (2) RRG season gate → (3) 6–12M far-OTM long put → (4) dividends → (5) max risk → (6) max-loss filter.

1. **Stock** (unchanged): >=126 daily bars; 20-day avg dollar volume >= $20m; close >=10% below 126-bar high;
   rebound 3–15% above 20-bar low; low >=5 bars old; close >= SMA10. Universe SPX subset or NDX roster.
2. **RRG season** (same JdK-style math as `RRG`, stock vs SPX weekly). `SEASON=`:
   - `W2S` (default) "Winter → Frühling": current quadrant **Improving/Spring** AND a **Lagging/Winter** point within the
     last 8 weekly trail points, with only Winter/Spring points since then (no detour via Summer/Autumn).
   - `SPRING`: only current Spring required. `OFF`: gate disabled.
3. **Long put (LP)**: 180–365 calendar DTE (6–12 months); strike 2–40% below spot; bid>0, ask>=bid, OI>=50,
   spread/mid<=35%; IVR proxy <= `IVRMAX` (default 30). Choose min `|OTM%−OTM| + |DTE−270|/90`; `OTM` default **15** (2–40).
   Theta shown as Black-Scholes estimate per calendar day (r=0): `−S·φ(d1)·σ/(2√T)/365`, also as % of premium.
4. **Expected dividends** (now < ex-date <= LP expiry), per share: declared future ex-dates from Yahoo dividend events, then
   the last regular dividend repeated at the median gap of the last ≤9 payments. If a payer missed >2 gaps → no projection.
   No history → 0. Projection, not guaranteed; ex-date matters (must hold stock on ex-date).
5. **Max risk** (LP strike = guaranteed sale price of the stock until expiry):
   `maxLoss/sh = stock + put ask − strike − expected dividends`; `/100 = ×100`; `maxLossPct = maxLoss/(stock+ask)·100`;
   `breakEven = stock + ask − dividends`. Ignores commissions, taxes, early assignment/exercise.
6. **Filters**: `MAXLOSS=` max $/share, `MAXLOSSPCT=` max % of capital (stock+put). Rows sorted by lowest risk %.

Table columns: liquidity (Ø $ vol), fall from high %, rebound %, bottom age, RRG season, RRG trail (8 weeks, W/S/…),
RS-Ratio, RS-Momentum, weeks since Winter, IVR proxy, LP expiry/DTE/strike/OTM%, IV, ask, theta $/day & %/day, OI,
dividends to expiry and count, breakeven, max risk $/sh, /100, %. Exclusion reasons (season, no put, max loss) in a details box.
API: `/api/fn/mput?universe=SPX&ivrMax=30&otm=15&season=W2S&maxLoss=15&maxLossPct=12`.

### IVR proxy caveat

No historical implied-volatility series in this free provider; we do **not** compute true IV Rank.
`proxy = clamp(100·(contract IV − min HV20)/(max HV20 − min HV20), 0, 100)` over up to 252 realized-vol observations.
Missing IV (Nasdaq fallback) excludes a contract. No candidates is a valid result.

## Data / safety / next iteration

No new API keys, credentials, paid services, external writes or broker orders.
History uses existing Yahoo OHLC through Amber's provider. Errors return explicitly;
no fake fallback prices (QT_OFFLINE fixture data is rejected). In-memory history
cache 15 minutes; eight concurrent loads / 45-second history budget, then MPUT
four concurrent chain loads / 30-second budget. Upstream delays can mean fewer rows.
Dates in tables are source trading dates. Option quote timestamps display Europe/Berlin.

Priority upgrades: verified full index constituents and fine-grained industry groups;
point-in-time/adjusted-price backtests with fees and saved snapshots; real 52-week
constant-maturity historical IV to replace the proxy; earnings exclusion; tunable
bottom/option/liquidity parameters; sector-as-benchmark optional mode only if requested.

## Validation

- `npm test` (scripts/test.js) setzt `QT_DATA_DIR` auf ein frisches Temp-Verzeichnis; die Tests lesen/schreiben
  nie `data/` (insbesondere nicht `data/rsl-watchlist.json`). Tests, die das Positionsbuch anfassen, importieren
  zuerst `test/helpers/isolate-data.js` (gilt auch bei Einzelaufruf `node --test test/grokki.test.js`) und brechen ab,
  falls ein Pfad doch in `data/` zeigt. Auch der SQLite-OHLCV-Cache (`QT_OHLCV_PATH`) liegt während der Tests im Temp-Verzeichnis.

`node --test test/grokki.test.js test/grokki-api.test.js` exercises formulas, history minimums, four-quadrant
math, no-future-signal behavior, portfolio equity, bottom/liquidity rules, option
cost/risk math, command parsing, HELP registration and partial-failure reporting.
Tests use explicitly synthetic prices; they are not evidence of strategy performance.

`npm test` runs the existing offline regression suite plus these tests. Live HTTP
smoke JSON and summaries are saved in `data/grokki-smoke/`. See the implementation
report for actual run outcomes; no browser rendering or investment validation is
implied by backend/unit-test success.

### Recorded validation — 5 November 2026, 23:00 CET (Europe/Berlin)

- `npm test`: **392 tests passed, 0 failed**, including 14 new Grokki tests.
- All nine live endpoint cases returned HTTP 200 with source information.
- RSL26 SPX: full S&P 500 (~503); ranks use SQLite-backed OHLCV cache after first warm-up.
- RSL26 DAX: 39 ranked of 40; 1COV.DE had fewer than 26 weekly closes.
- RSL26 NDX: 97 ranked of 100; ANSS unavailable, EA stale, WBD empty history.
- RRG: 11 sector proxies; Leading filter 7; XLC drill-down 11 stocks of 12;
  named AAPL/MSFT query 2 rows.
- MPUT default proxy cutoff 30: 9 bottom stocks / 9 option chains / **0 candidates**.
  Diagnostic cutoff 100 (disables the low-IV preference): 9 candidates. This is a
  filter check, not a recommendation to relax the threshold for real investing.
- Backend regression initially found SPX prefix parsing; fixed and covered by an
  actual-provider-path synthetic upstream test before the final successful smoke.
- Browser visual/layout interaction was **not tested**. Review the UI manually.


## RSL26 Evaluierung / Walk-Forward

Lokale Pipeline (Node ≥20, keine npm-Deps) für Parameter-Grid, Split-Test, Walk-Forward und N-Sweep.

### CLI

```bash
node scripts/rsl-eval.mjs --help
node scripts/rsl-eval.mjs grid --from 2021-11-09 --to 2026-11-09 --grid medium
node scripts/rsl-eval.mjs split --tune-from 2016-11-09 --tune-to 2021-11-09 \
  --test-from 2021-11-09 --test-to 2026-11-09 --grid medium
node scripts/rsl-eval.mjs walkforward --wf-window expanding --grid coarse \
  --wf-first-year 2018 --wf-period yearly --resume
node scripts/rsl-eval.mjs walkforward --wf-window rolling --wf-roll-years 2 \
  --wf-period semiannual --grid coarse
node scripts/rsl-eval.mjs compare --from 2016-11-09 --to 2026-11-09
```

Presets: `data/backtests/eval-presets/{coarse,medium,full,compare-default}.json`  
Grid, Scoring, Constraints und manuelle Config (`--manual MODE,N,RT,RS,CW`) sind editierbar.

**Auswahlregel (Default):** Score = 0.55·MAR + 0.25·Sharpe + 0.20·Robustheit;  
bestRaw = argmax MAR; bestPlateau = argmax smoothScore unter MAR ≥ 0.9·maxMAR.  
Walk-Forward wählt Plateau (überschreibbar mit `--pick raw|manual`).

**TRAIL / TRAILLOCK / RANKING in Grid, Split, Walk-Forward, N-Sweep, Compare:**
- Feste Werte gelten in **jedem** IS-Tune-Lauf und jedem OOS-/Handelslauf:
  `--trail 20 --trail-lock 4 --ranking MOM52_4` (Default 0 / 4 / RSL26 = bisheriges Verhalten).
- Optional als Grid-Dimension: `--tune-trail 0,20` und/oder `--tune-ranking RSL26,RSL39,MOM52_4`
  (Plateau-Nachbarn nur innerhalb gleicher TRAIL/RANKING-Werte).
- `--manual MODE,N,RT,RS,CW[,TRAIL[,TRAILLOCK[,RANKING]]]`; fehlende Extras = feste Werte.
- Ergebnisse: `walkforward-yearly.csv`, `grid.csv`, `backtest.json` (`yearly[].trail/trailLock/ranking`,
  `fixedStrategy`, `stats.tunedDims`). Config-Label z. B. `RANK N=5 RT=25 RS=1 CW=1 TRAIL=20/4 RK=MOM52_4`
  (ohne Extras unverändert).
- Checkpoints (`--resume`) tragen eine Parameter-Signatur (inkl. TRAIL/TRAILLOCK/RANKING/Tuning);
  passt sie nicht, wird der Checkpoint ignoriert — keine veralteten Tune-Ergebnisse.
- Carry-Übergang: das Trailing-Hoch gehaltener Titel läuft über Periodengrenzen weiter; die
  Wiederkauf-Sperre beginnt pro Periode neu (Sperren aus der Vorperiode werden nicht übertragen).
- `grid-worker.mjs` nutzt jetzt auch SIZE/FRACTIONAL des Jobs (vorher fest EQUITY/1; Defaults unverändert).
- Ältere Einzelskripte (`n-sweep.mjs`, `10y-compare.mjs`, `walk-forward.mjs`, `param-grid.mjs`,
  `strategy-variant-compare.mjs`) akzeptieren dieselben Extras per `--trail/--trail-lock/--ranking`
  oder `RSL_TRAIL`, `RSL_TRAILLOCK`, `RSL_RANKING` (ohne Angabe: unveränderte Ergebnisse).
- Die Heatmap-Ansicht (`PARAMHEATMAP`) zeigt gespeicherte Grid-Dateien vom 09.11.2026 (TRAIL 0, RSL26); sie rechnet nicht live.

### RSL26 Scanner vs. RSL-BT, Profile

#### Scanner-Layout (seit 10.11.2026)

- Formular in Gruppen: **Entry (Einstieg)** = Positionen N + Rangliste (Universum/Benchmark über die Reiter); **Exit (Ausstieg)** = RRG-Exit-Modus, Rank-Schutz RANKTOP, Bestätigung Wo. (nur CONFIRM), RS-Exit, Trailing-Stop %, Rückkauf-Sperre; Top X (Rangzeilen) steht seit 11.11.2026 im Kopf der Rangliste, ein eigener Abschnitt „Anzeige“ entfällt (M&A-Titel stehen immer in der Rangliste, markiert; „M&A ausblenden“ ist durch **M&A ignorieren** unter Entry ersetzt).
- **N** = „Positionen (Ziel N)“, Zielanzahl Positionen (Slots, Standard 5). Gekauft wird nur aus Rang 1…N.
- **Top X / Rangzeilen** (seit 10.11.2026; seit 11.11.2026 im Kopf der Rangliste: Zahlenfeld „Rangzeilen“ 1–500 plus Schnellwahl 10/25/50/100, Änderung zeichnet die Liste ohne neuen Scan neu — die Antwort enthält die ganze Rangliste) = Zeilen der Rangliste, Standard 25, unabhängig von N. Wird X größer als der beim letzten Scan EDGAR-geprüfte Bereich (≤ 50), steht dort ein Hinweis; „Aktualisieren“ prüft dann bis Rang min(X, 50). **Persistenz (Fix 11.11.2026):** Der Panel-Befehl (`data/state.json`) wird nach dem Laden auf `RSL26 <U>` / `RSLBT <U>` ohne Parameter gesetzt; beim Neuladen gelten damit die gespeicherten Einstellungen (vorher gewann ein altes `TOPX=25` im gespeicherten Befehl). Explizite Parameter in einem getippten Befehl wirken weiter und werden gespeichert. RSLBT speichert `topX` und `byUniverse` mit. Das Standardprofil enthält kein `topX` mehr (Laden behält die Rangzeilen); eigene Profile mit `topX` setzen ihren Wert. Gespeichert als `topX` in den zuletzt benutzten Einstellungen und in Profilen (optional; alte Profile ohne `topX` behalten den aktuellen Wert, sonst 25). Befehl: `RSL26 SPX TOPX=40`. Die EDGAR-M&A-Prüfung deckt Holdings ∪ Top max(N + 10, X ≤ 50) ab (Puffer für das erweiterte Kauf-Fenster).
- **Markierungen in der Rangliste** (seit 10.11.2026): Spalte „Status“. „im Depot“ (blau, Zeile blau getönt) = offene Position im aktiven Universum. „Depot NDX“ o. ä. (klein) = Titel unter einem anderen Universum gehalten, zählt nicht für die Slots. „KAUF“ (grün, Zeile grün getönt) = Kauf-Kandidat: Bei weniger Holdings als N im aktiven Universum werden die nächsten N − Holdings nicht gehaltenen Titel aus Rang 1…N in Rang-Reihenfolge markiert (wie der Backtest: „fill from Top-n not held“). Darüber steht „Holdings x / N – y freie Slots“ mit Kandidaten und dem Rang der gehaltenen Titel. Nur Markierung, kein automatischer Kauf, keine Schreibzugriffe aufs Buch. Die Rückkauf-Sperre nach Trailing-Exit wird live nicht geprüft (Verkaufsgrund nicht im Buch). Logik: `public/js/fn/rsl-slots.js` (`buySlotCandidates`, `topXVal`), Tests in `test/rsl-slots.test.js`.
- **M&A ignorieren** (seit 11.11.2026, Entry, Checkbox, Standard an, Parameter `maSkip` / Befehl `MASKIP=0|1`): Titel mit M&A-Flag (laufender Deal; manuelle Liste + SEC EDGAR 180 Tage) werden beim Einstieg übersprungen und zählen nicht zum Kauf-Fenster Rang 1…N. Das Fenster rückt auf die nächsten Ränge ohne M&A vor (N=5, Rang 3 M&A → Kandidaten aus Rang 1, 2, 4, 5, 6). KAUF-Markierung und Slot-Zusammenfassung folgen dem; M&A-Zeilen im Fenster tragen „M&A-Skip“ (voller Hinweis im Tooltip). Gehaltene M&A-Titel bleiben gehalten und sichtbar (kein Zwangsverkauf). Aus = bisheriges Verhalten (M&A zählt mit, nur Warnung im KAUF-Tooltip). Gespeichert je Universum (`byUniverse`) und in Profilen; fehlt `maSkip` (alte Profile/Einstellungen) → an; altes `hideMa` wird ignoriert. Eingebaute Profile: an. **Backtest (RSLBT):** keine historischen M&A-Daten → keine Wirkung; die Checkbox dort heißt „M&A ignorieren (nur Scanner)“ und wird nur mitgespeichert. Helfer: `buySlotCandidates(rows, positions, {n, universe, skipMa})` in `public/js/fn/rsl-slots.js` (liefert zusätzlich `skippedMa`, `windowEnd`).
- Holdings: Spalte „Exit?“ steht vorn, der Grund steht im Tooltip. Aufklappbar (Standard zu, Zustand in localStorage `amber.rsl.open.<key>`): Formel/Empfehlung, Holdings-Hinweise, Geschlossene Positionen, M&A-Liste, Exit-Methoden.
- RSLBT hat eigenen Formularcode und ist noch nicht gruppiert. Die Trailing-Labels sind geteilt.
- **Holdings nach Universum** (seit 10.11.2026): Spalte „Univ.“ (farbiges Badge = Kauf-Universum aus dem Buch, kleine Zusatz-Tags = weitere Indexlisten, z. B. AAPL SPX+NDX). Filterleiste „Universum:“ (Aktiver Reiter [Standard] · Alle · SPX · NDX · DAX) mit Zählern offen/geschlossen; gilt für offene und geschlossene Positionen, ohne neue Abfrage; Wahl in localStorage `amber.rsl.holdingsUniverse`.
  Universum = gespeichertes `universe` der Position; fehlt es: `.DE` → DAX, sonst erste Indexliste, sonst SPX (`universeInfo` in `lib/rsl-watchlist.js`, schreibt nichts). Geschlossene: alle werden geladen, je Filter die neuesten 15 gezeigt.
  Live-Exits je Position gegen die eigene Benchmark (SPX ^GSPC, NDX ^NDX, DAX ^GDAXI). RSEXIT und confirmWeeks werden jetzt auch in den Live-Holdings berücksichtigt (vorher implizit RSEXIT=1, CW=1).

#### Standardprofil „Favorit RSL26 Trail20“ (seit 10.11.2026)

- Default-Parametersatz im Terminal für Scanner (`RSL26`) und Backtest (`RSLBT`):
  **RANK · N=5 · RANKTOP 25 · RS-Exit an · CW 1 · Rangliste RSL26 · TRAIL 20 % · TRAILLOCK 4 Wo. · SPX · Gebühr $1 · fraktional · SIZE=EQUITY · Start 10000**.
  Backtest bleibt aus (nur manuell per „Backtest starten“).
- Code: `lib/tool-settings.js` → `TOOL_DEFAULTS.RSL26` und `DEFAULT_RSL_PROFILE` (id `favorit-rsl26-trail20`).
  `listProfiles('RSL26')` liefert das Standardprofil immer zuerst (`isDefault: true`), auch wenn es nicht in `settings.json` steht.
  In der Profil-Auswahl steht es fett mit „(Standard)“. Löschen ist gesperrt; Speichern unter demselben Namen überschreibt es.
- `RSL26 RESET` / `RSLBT RESET` lädt diese Werte. Die Frontend-Fallbacks in `public/js/fn/grokki.js` sind gleich gesetzt (n 5, trail 20).
- Die rohe API `rsl26` behält ihre eigenen Query-Defaults (n 25, trail 0). Das Terminal sendet N und TRAIL immer explizit mit.
- Hinweis: Die Rangliste zeigt Top X Zeilen (Standard 25). Kauf-Kandidaten kommen nur aus Rang 1…N (Standard 5) und sind mit „KAUF“ markiert; RANKTOP 25 bleibt der Halteschutz.
- Warum N=5 und nicht N=4: siehe `strategies/RSL26_N4_vs_N5_2026-11-10.md`. Erzeugt von `scripts/n4-vs-n5.mjs`; die Produktionsparität für N4 und N5 ist identisch.
  N4 verliert in 10 J., WF 2018–26, beiden Hälften und allen 52 Startwochen. Bootstrap: P(Sharpe N4 besser) ≈ 1 %.

- **RSL26** ist nur noch der Scanner: Holdings, Rangliste, Live-Exits. Der Backtest läuft dort **nicht** automatisch. Button „Zum Backtest“ öffnet `RSLBT` mit den aktuellen Parametern.
- **RSLBT** (RSL-BT) ist der manuelle Backtest. Beim Öffnen erscheint zuerst das Formular; der Lauf startet erst mit „Backtest starten“ (`RUN` / `BACKTEST=1`). Hier liegen Years, Startkapital, Gebühr, Size, Fractional, Walk-Forward und „Parameter neu bestimmen“.
- Ein Backend-Aufruf `rsl26` ohne `backtest=1` berechnet keinen Backtest (Default ist aus). Der Scanner setzt `backtest=0`; RSL-BT setzt `backtest=1` erst beim Start.
- **Profile** merken die Strategieparameter (Universum / Top-RSL-Liste, Top-N, Exit-Strategie, plus Backtest-Felder Years/Start/Size/Fee/Fractional) unter einem Namen. Speichern und Laden per Klick in beiden Ansichten. „Im Scanner verwenden“ übernimmt die aktuellen Backtest-Parameter ohne extra Profilnamen.
- **Rangliste** (`RANKING`, Auswahl „Rangliste“ in Scanner und RSL-BT) wird ebenfalls in Profilen und den zuletzt benutzten Einstellungen gespeichert.
- **Trailing-Stop** (`TRAIL`, `TRAILLOCK`) wird in Profilen und in den zuletzt benutzten Einstellungen gespeichert (Felder „Trailing %“ und „Sperre Wochen“ in beiden Ansichten). Der Scanner nutzt TRAIL aus dem geladenen Profil.
- **Scanner-Holdings mit TRAIL>0**: Spalten „Hoch seit Kauf (Wo.-Schluss)“ (höchster Wochen-Schluss ab Kaufdatum, mindestens Kaufkurs; **nicht** das Intraday-Handelshoch), „Stop −x %“ (Stop-Level) und „Fallhöhe bis Stop“ = (Wochenschluss − Stop) / Wochenschluss, max. x %, negativ = unter Stop (rot = ausgelöst, orange < 5 %). Ausgelöst → Exit-Hinweis „Trailing-Stop …“, falls kein anderer Exit vorliegt. `*` = Kurshistorie beginnt nach dem Kaufdatum (Hoch evtl. unvollständig). Für alte Kaufdaten wird bis zu 15 Jahre Historie geladen.
- **„gesperrt bis“** wird im Scanner **nicht** angezeigt: die Watchlist speichert beim Verkauf keinen Verkaufsgrund, daher lässt sich ein Trailing-Verkauf nicht sauber von anderen Verkäufen unterscheiden. Die Sperre selbst gilt nur im Backtest.
- Profile liegen in `data/settings.json` unter `profiles.RSL26` (nicht in `tools.RSL26`) und überleben `RSL26 RESET` / `resetTool`. API: `GET/POST /api/settings/profiles` (`{tool, profile}` bzw. `{tool, action:'delete', id}`).
- Die Scanner- und die normale Backtest-Ansicht verwenden immer die **festen** Einstellungen (RRGEXIT, N, RANKTOP, …). `PARAMMODE=FEST` ist der Default.
- **Parameter neu bestimmen** (nur in RSL-BT) ist ein Test, den du selbst startest: Walk-Forward-Backtest, der am Periodenende neu tunet (expanding oder rolling N-Jahre); die gewählte Config handelt die Folgeperiode. Die Ansicht bleibt stehen; der Fortschritt erscheint in einer Box.
- API/Kommando `RSLBT … PARAMMODE=WALKFORWARD` (Alias: `TUNE=YEARLY`) plus `STARTJOB=1` startet denselben Job. Gespeicherte Einstellungen merken diesen Modus **nicht** als Live-Ansicht.
- Stats (MaxDD/Sharpe/MAR/CAGR) aus **kontinuierlicher Tages-Equity**. Übergang: `WFTRANSITION=carry` (Default: Holdings behalten, die die neue Config weiter hält, ohne Sell/Rebuy-Fees) oder `reset` (Cash-Flat).
- Optionen: `WFWINDOW=expanding|rolling`, `WFROLLYEARS=2`, `WFPERIOD=yearly|semiannual|quarterly`, `WFGRID=coarse|medium|full`, `WFTRANSITION=carry|reset`, `WFTUNETRAIL=1` (TRAIL 0/20 mittunen), `WFTUNERANKING=1` (Rangliste mittunen)
- Der Walk-Forward übernimmt **TRAIL, Sperre (TRAILLOCK) und Rangliste** aus dem Formular bzw. geladenen Profil fest in jedem Tune- und Handelslauf. Checkboxen „TRAIL mittunen (0/20)“ / „Rangliste mittunen“ machen daraus Grid-Dimensionen. Die Ergebnisansicht zeigt „Strategie (fest)“ und je Periode TRAIL %, Sperre und Rangliste (auch im Perioden-CSV). Ein laufender WF-Job wird nur wiederverwendet, wenn alle Parameter (inkl. TRAIL/TRAILLOCK/RANKING/Tuning) gleich sind.
- Läuft als Hintergrund-Job mit Progress (`/api/rsl-eval/jobs?id=…` oder `POST /api/rsl-eval/jobs`); Ergebnis: Stats, Equity+Benchmark, Perioden-Tabelle (gewählte Params), Trade-Log/CSV mit Spalte `AktiveConfig`.
- In `data/settings.json` werden die festen Handelsparameter und die WF-Optionen gemerkt, nicht aber ein aktiver Walk-Forward als Ansichtsmodus.

Beispiel-Kommando (CLI-äquivalent bleibt `node scripts/rsl-eval.mjs walkforward`):

```
RSLBT SPX YEARS=10 PARAMMODE=WALKFORWARD WFWINDOW=expanding WFPERIOD=yearly WFGRID=coarse STARTJOB=1
```

FEE=$1, SIZE=EQUITY, FRACTIONAL=1, START=10000 bleiben Fixpunkte (nicht Grid-Dimension).
Watchlist `data/rsl-watchlist.json` wird nicht verändert.



### RSL26: HDAX und STOXX 600, Bruchstücke, P&L, Equity, Tastenkürzel (seit 10.11.2026)

- **Reiter** im Scanner und in RSL-BT: **SPX · NDX · HDAX · STOXX 600** (Schlüssel `SXXP`). Der DAX-40-Reiter ist durch **HDAX** (DAX+MDAX+TecDAX, 102 Titel) ersetzt. Alt-Befehle `RSL26 DAX` / `RSLBT DAX` landen auf HDAX, `STOXX`/`STOXX600` auf SXXP.
  Listen: `scripts/lib/research-universes.json` (iShares-Holdings Nov 2026, heutige Mitglieder, kein point-in-time). Code: `lib/fn/grokki-universes.js` (`EU_UNIVERSES`, `canonUniverse`, `SCAN_UNIVERSES`).
- **Benchmarks:** HDAX `^GDAXI` (Yahoo hat keinen HDAX-Index), STOXX 600 `^STOXX`. **Währung:** HDAX EUR; STOXX 600 alle Kurse täglich mit `EURxxx=X` in **EUR** (GBp→GBP /100), wie `scripts/research-engine.mjs`. Spalte „Lokal“ zeigt den Kurs in Handelswährung. **Datenreparatur** (`repairBars`: x100-Einheitensprünge, kurze Spikes) für beide EU-Universen, z. B. ROSE.L; ZEG.L/ABVX.PA sind echte Sprünge und werden nur als Hinweis gezeigt. Logik: `lib/fn/grokki-eu.js` (`adjustEuSeries`), auch im Walk-Forward-Loader `scripts/lib/rsl-eval-core.mjs`.
- **Voreinstellungen je Universum** (Research `strategies/RSL26_HDAX_Europa_2026-11-10.md`): HDAX = Kandidat B `RANK · RANKTOP 10 · RS-Exit aus · MOM52_4 · N5 · TRAIL 20 / Sperre 4`; STOXX 600 = Kandidat A `OFF · RS-Exit aus · MOM52_4 · N5 · TRAIL 20 / Sperre 0`. SPX/NDX unverändert. `rrgExitDefaults('HDAX'|'SXXP')` entsprechend.
  Strategie-Felder (N, RRG-Modus, RANKTOP, CW, RS-Exit, TRAIL, Sperre, Rangliste) merkt sich das Terminal jetzt **je Universum** (`byUniverse` in den RSL26-Einstellungen); ein Reiterwechsel lädt die Werte dieses Universums, beim ersten Mal die Research-Voreinstellung.
- **Eingebaute Profile** (im Code, nicht in `settings.json`): „HDAX Kandidat B RANK10 MOM Trail20“ und „STOXX600 Kandidat A MOM Trail20“ (`BUILTIN_RSL_PROFILES` in `lib/tool-settings.js`). Löschen gesperrt; Speichern unter demselben Namen legt eine eigene Fassung an.
- **Rechenumfang:** Ein Scan lädt nur das gewählte Universum (Kurse aus `data/cache/ohlcv.sqlite`, 15 min In-Memory-Cache). Holdings anderer Universen: nur deren eigene Titel + deren Benchmark (Rang nur unter den Holdings). Kein Timer scannt automatisch (nur Uhr 15 s und Ticker-Band 60 s). Gemessen 10.11.2026 (Box): HDAX kalt 2,2 s / warm 0,5 s, STOXX 600 kalt 8,7 s / warm 3,0 s, SPX warm 7,9 s.
- **Bruchstücke:** Stück im Buch mit Komma oder Punkt (z. B. `3,25`), > 0, bis 6 Nachkommastellen (`parseQty`), Anzeige bis 4 Stellen im deutschen Format. **Teilverkauf:** Feld „Stück“ im Verkaufen-Dialog (`sellQty`); der verkaufte Teil wird ein eigener geschlossener Datensatz (`partialOf`), der Rest bleibt offen.
- **P&L je Holding** (`public/js/fn/rsl-pnl.js`): offen = unrealisiert (letzter Schluss vs. Kaufkurs, % ohne Gebühr, absolut − 1 Gebühr), geschlossen = realisiert (% und absolut − 2 Gebühren, Haltedauer in Tagen). Summenzeile je Filter (realisiert, unrealisiert, gesamt, Trefferquote), Währungen getrennt (USD für SPX/NDX, EUR für HDAX/STOXX 600).
- **Equity-Kurve** (aufklappbar, lädt erst beim Öffnen): `GET /api/fn/rslpnl?filter=SPX|NDX|HDAX|SXXP|ALL&bench=^GSPC` (nur lesen). Geldgewichtet: Jeder Kauf ist eine Einzahlung; ein Benchmark-Zwilling kauft am selben Tag mit demselben Geld Indexanteile und verkauft sie am Verkaufstag; Erlöse bleiben Cash. Linien: Holdings, Benchmark, Einzahlungen. „Alle“ mit gemischten Währungen in USD (EUR→USD mit `EURUSD=X`). Positionen ohne Stück/Kaufkurs fehlen (Hinweis).
- **Tastenkürzel:** Übersicht mit `?` (außerhalb von Eingabefeldern) oder Befehl `KEYS` / `TASTEN` (`public/js/shortcuts.js`). Neu: Esc außerhalb der Befehlszeilen geht ebenfalls eine Ansicht zurück. Liste auch in `strategies/Amber_Terminal_Tastenkuerzel.md`.

## GSW: Gold/Silber-Swap (seit 22.11.2026)

Regel und Referenzzahlen: `/workspace/thoBox/Grokki/strategies/Gold_Silber_Swap_Spec.md` (v3, Hybrid 90/82, Spike 100→66). Code: `lib/gsw/` (math, engine, data, book, settings, service, worker), UI `public/js/fn/gsw.js`, Test `test/gsw.test.js` (Fixture `test/fixtures/gsw/prices_and_ratio_2016-2026.csv` = `/workspace/gold_silver/prices_and_ratio.csv`).

### Regel (fix)
- `sig = (GLD/SLV) × k_w`, `k_w` = kausaler Median der letzten w alignierten Handelstage von `(GC=F/SI=F)/(GLD/SLV)` (min. 1 Wert, wie pandas `rolling(w, min_periods=1)`). Yahoo **Close**. Signal-Kalender = innerer Verbund der vier US-Reihen ab Start (Standard 21.10.2016).
- Gold → Silber bei Tagesschluss `sig > U1`; Silber → Gold bei `sig < L1`; in Silber schaltet `sig > S` den Spike-Modus, dann zurück erst bei `sig < L2`; Spike wird beim Wechsel zu Gold gelöscht. Ausführung am **nächsten** Schluss, immer 100 % investiert, Kosten je Seite auch beim Erstkauf (Start-Equity 9.990 bei 10.000). Gold-Unzen = Equity × FX / GC=F.
- Das Signal kommt **immer** aus GLD/SLV + GC=F/SI=F, auch wenn in 8PSG/8PSB oder XAD5/XAD6 gehandelt wird.

### Handelspaare
Jedes Preset hat ein Feld **Art** (in der Auswahl sichtbar): 8PSG/8PSB physisch mit (bedingtem) Lieferanspruch; GLD/SLV, XAD5/XAD6, PHAU/PHAG physisch ohne Privatanleger-Lieferung; GC=F/SI=F Futures; BULL/SLVR synthetisch. Presets: GLD/SLV (USD, Spec), 8PSG.DE/8PSB.DE (Xetra, EUR, IE00B579F325 / IE00B43VDT70), XAD5.DE/XAD6.DE (Xetra, EUR, DE000A1E0HR8 / DE000A1E0HS6), PHAU.L/PHAG.L (LSE, USD, JE00B1VS3770 / JE00B1VS3333; Yahoo-Währung USD, nicht GBp), PHAU.MI/PHAG.MI (Borsa Italiana, EUR, dieselben ISINs; WisdomTree Physical Gold/Silver, keine physische Lieferung für Privatanleger), BULL.L/SLVR.L (LSE, USD, GB00B15KXX56 / GB00B15KY328; Yahoo-Währung USD, nicht GBp), BULL.MI/SLVR.MI (Borsa Italiana, EUR, dieselben ISINs; WisdomTree Gold/Silver, synthetisch, besicherter Swap auf Bloomberg Commodity Gold/Silver Subindex 4W TR, keine physische Hinterlegung; Hinweis „synthetisch, Futures-Index inkl. Roll, Kontrahentenrisiko besichert“), GC=F/SI=F (USD, Front-Month), benutzerdefiniert (zwei Yahoo-Ticker + Währung; leer = `.DE`/`.MI` usw. → EUR, `.L` → GBP, sonst USD — LSE-USD-Notierungen daher Währung setzen). Das Paar wird per asof auf den Signal-Kalender gelegt; ein fälliger Swap wird am nächsten Tag ausgeführt, an dem **beide** Paar-Instrumente einen eigenen Schluss haben (Hinweis mit Anzahl der Tage ohne eigenen Schluss). Kürzere Historie: Start am ersten handelbaren Tag. Nicht-USD-Paare: Equity/Kosten in Paarwährung, Gold-Unzen mit `<CUR>USD=X`.

### GSW (Befehl `GSW`)
- **⚙ Einstellungen** (eigene Datei `data/gsw-settings.json`, nie `data/settings.json`): Handelspaar, U1/L1/S/L2, Median-Fenster, Kosten %, Start, optionale **Mindesthaltedauer** (an/aus + Tage, Default 365). Default an nur bei Art „physisch mit Lieferanspruch“ (8PSG/8PSB), sonst aus; der User kann je Paar umstellen (nur Overrides werden gespeichert). „Standard (Spec)“ setzt zurück, inkl. der Overrides. „steuerfrei ab“ = Kaufdatum + 1 Kalenderjahr + 1 Tag (Schaltjahre: 29.2. wird zum 28.2. des folgenden Nicht-Schaltjahrs, dann +1 Tag). Keine Steuerberatung; die Frist gilt nicht automatisch.
- **Status**: Phase laut Regel mit letztem Wechsel, sig = GLD/SLV × k, nächste Schwelle mit Abstand %, Spike-Zustand, Spot-Ratio als Kontrollgröße. **Signalhinweis**, wenn das Buch vom Regelzustand abweicht („Swap zu Silber fällig …“) oder der letzte Schluss einen Wechsel für den nächsten Schluss auslöst. Läuft dabei die Mindesthaltedauer noch, lautet der Hinweis „Swap fällig – Haltefrist bis TT.MM.JJJJ“ (letzter „steuerfrei ab“-Tag der betroffenen Lots).
- **Schwellen**: Spot-Einheiten, GLD/SLV (= Schwelle / k), beim Nicht-Spec-Paar zusätzlich ≈ Paar-Ratio (mit heutigem Verhältnis Paar-Ratio / GLD-SLV-Ratio umgerechnet; nur Orientierung).
- **Holdings** aus `data/gsw-book.json` (getrennt vom RSL-Buch): Lots mit Metall, Symbol, Stück (Bruchstücke), Kaufkurs, Datum, bei eingeschalteter Mindesthaltedauer Spalte **steuerfrei ab / Resttage** (zweizeiliger Header, Tooltip; farbig, solange die Frist läuft), letzter Schluss, Wert, P&L. **Swap-Knopf**: alle offenen Lots eines Metalls zum (vorbelegten, editierbaren) Kurs verkaufen, Erlös × (1−k) × (1−k) / Kaufkurs ins andere Metall, mit Vorschau und Rückfrage. Ist die Frist noch offen, warnt die Vorschau welche Lots betroffen sind und wieviel Gewinn in der Frist läge — der Swap wird nicht blockiert. Einzeln: Kaufen (Stück oder Betrag), Verkaufen (auch Teilverkauf, mit gleicher Warnung), Bearbeiten, Löschen, Wieder öffnen. GP-Knopf je Lot öffnet `SYMBOL GP BUY=kurs@datum SRC=GSW`.
- **Charts**: sig mit Linien U1/L1/S/L2 und Markern (▼ S / ▲ G Backtest-Wechsel, ● K eigene Käufe); Paar-Ratio mit tagesgenau umgerechneten Schwellen (`Schwelle / k_t × Paar-Ratio_t / GLD-SLV-Ratio_t`); Kurse des Paars (Gold linke, Silber rechte Achse). Zeitraum 1J/3J/5J/Max. Darunter die Wechsel des laufenden Backtests.

### GSW-Profile (`data/gsw-profiles.json`)
- Datei `{ version, activeId, profiles[] }`, geschrieben atomar über `lib/store.js`; Code `lib/gsw/profiles.js`. Profil: `id`, `name` (eindeutig), `pairId` (Vorbelegung oder `CUSTOM` + `custom.gold/silver/currency`), `start`, `hold {on, days}`, `tax {mode none|kest, rate %, allowance, p23 auto|on|off, p23Rate % | null}`, `params {U1, L1, S, L2, window, costPct}` (gleiche Prüfung wie bisher), `note`, `snapshot` (optional: `start`, `end`, `endValue`, `cagr`, `maxdd`, `switches`, `lapsed`, `taxPaid`, `endValueAfterLiq`, `cagrAfterLiq`, `currency`, `pair`, `source`, `at`), `createdAt`, `updatedAt`.
- Fehlt die Datei: implizites Profil `spec-v3` „Spec v3“ (GLD/SLV, 90/82/100/66, Median 60, 0,1 %, ohne Sperre, ohne Steuer). Enthält `gsw-settings.json` abweichende Werte, ist es „Aus GSW-Einstellungen“ mit Paar, Parametern, Start und Haltefrist von dort (Haltefrist wie bisher: Override je Paar, sonst an bei Lieferanspruch). Die erste schreibende Aktion legt die Datei mit dem impliziten Profil an; `gsw-settings.json` wird nie verändert.
- API: `GET /api/gsw/profiles` → `{activeId, profiles, implicit, pairs}`; `POST` `{profile, activate}` legt an; `PUT` `{id, profile}` ändert (Teil-Update); `DELETE ?id=` bzw. `POST /api/gsw/profiles/delete {id}` löscht (aktives Profil → 400); `POST /api/gsw/profiles/activate {id}`.
- `GET /api/gsw` rechnet mit dem aktiven Profil (Paar, Parameter, Start, Haltefrist-Anzeige). Optional `draft` (JSON, ungespeicherte Profilwerte) + `draftFor` (Profil-ID): Vorschau ohne Speichern; gehört der Entwurf nicht zum aktiven Profil, wird er ignoriert (`profile.draftStale`). Antwort `profile {active, effective, draft, changed[], activeId, implicit, list}`. Der laufende Regel-Backtest in GSW bleibt ohne Sperre und ohne Steuer (Live-Signal = Spec-Regel mit den Profil-Schwellen).
- GSWBT: „Laden“ füllt Paar, Sperre, Steuer, Start, Einzelparameter; „Als Profil speichern“ (Einzellauf, Detailansicht, ＋P je Grid-Zeile) speichert Paar/Sperre/Steuer aus dem Formular, Parameter und Kennzahlen aus dem Lauf.

### GSWBT (Befehl `GSWBT`)
- Formular: Handelspaar, Start, Ende (leer = letzter Schluss), WF-Start (Standard 21.10.2019), OOS-Start (Standard 20.10.2023), optionale **Haltefrist als Swap-Sperre** (Tage; fest, keine Grid-Achse), **Steuer** (Modus, Satz, Pauschbetrag, §23, §23-Satz; fest), Grid je Achse als Bereich `a-b/Schritt` oder Liste (`U1`, Abstand `U1−L1`, `S`, `L2`, Median, Kosten %). „Spec-Grid“ = v3 (15.570 Zellen). Zellen nur mit `L2 < L1` und `S > U1`, Limit 250.000.
- **Haltefrist als Swap-Sperre:** Ein Regel-Swap wird aufgeschoben, solange die aktuelle Position jünger als N Tage ist. Anschaffung = Start (Erstkauf) bzw. Datum des letzten **ausgeführten** Swaps. Bei N = 365 gilt dieselbe Formel wie „steuerfrei ab“ (Kauf + 1 Kalenderjahr + 1 Tag); sonst der erste Tag, an dem die Position nicht mehr jünger als N Kalendertage ist. Die Zustandsmaschine (inkl. Spike und Vormerken am Signaltag) läuft unverändert weiter; nur die Ausführung wird gesperrt, solange `Datum < Unlock`. War ein Swap während der Frist vorgemerkt, wird er am ersten handelbaren Tag mit `Datum >= Unlock` ausgeführt, **sofern die Maschine an diesem Schluss noch das andere Metall will** (gleiche Schwellen, aktueller Spike); sonst **entfällt** er. Ohne vorherigen Aufschub gilt die übliche T+1-Ausführung auch dann, wenn das Signal am Ausführungstag schon wieder weg ist (keine Nachprüfung — sonst würde die Spec brechen). Ausgeführte aufgeschobene Swaps stehen in der Wechselliste als „aufgeschoben, +X Tage“; entfallene als eigene Zeile. Kennzahlen: `aufgeschoben` (Anzahl ausgeführter, zuvor gesperrter Swaps), `entfallen`, `Ø Verzögerung` (mittlere Kalendertage Signal→Ausführung nur über die aufgeschobenen ausgeführten Swaps). Ein am Ende noch gesperrtes Pending zählt nicht als aufgeschoben oder entfallen. Grid, Robustheit, Walk-Forward und OOS verwenden dieselbe feste Einstellung. Ohne Sperre bleibt der Spec-Lauf unverändert (102.111,00 USD, 14 Wechsel).
- **Steuer (keine Steuerberatung, vereinfacht):** `taxMode` `none` (Rohertrag, Default) | `kest`. Bei `kest`: Satz `taxRate` in % (Default 26,375 = 25 % + 5,5 % Soli, keine Kirchensteuer), Steuer bei jeder Realisierung (Swap = Verkauf + Neukauf). Gewinn = Nettoerlös (nach Verkaufskosten) − Anschaffungskosten (eingesetzter Betrag inkl. Kaufkosten); Steuer aus dem Erlös, reinvestiert wird der Rest (neue Anschaffungskosten). Verluste → Verlusttopf (ein Topf, keine Topftrennung), mit späteren Gewinnen verrechnet; `taxAllowance` = Pauschbetrag je Kalenderjahr (Default 0, nicht bei §23). **§23 EStG** (`taxP23` `auto` | `on` | `off`): nur für Paare der Art `physical-delivery` (8PSG/8PSB); `auto` = an, wenn die Haltefrist-Option des Paars in GSW an ist (Default bei Lieferanspruch). Verkauf am oder nach „steuerfrei ab“ (Anschaffung + 1 Kalenderjahr + 1 Tag, unabhängig von den Sperr-Tagen) steuerfrei, auch Verluste zählen dann nicht; davor `p23Rate` (Default = Satz; eigentlich persönlicher Einkommensteuersatz + Soli, keine Freigrenze). Arten `physical-no-delivery`, `synthetic`, `futures` und eigene Ticker: immer Abgeltungsteuer. Am Ende fiktive **Liquidationssteuer** auf den unrealisierten Gewinn (nach Verlusttopf), separat: Endwert/CAGR vor Liquidation (= Equity, nach gezahlter Steuer) und nach Liquidation. Kennzahlen `taxPaid`, `lossCarry`, `liqTax`, `endValueAfterLiq`, `cagrAfterLiq`; Wechselliste `gain`, `tax`, `taxFree`, `lossPotAfter`. Gewinne in Paarwährung, Währungseffekte (EUR-Sicht bei USD-Paaren) ignoriert. Buy & Hold ohne Steuer. Code: `normTax`/`runCore` in `lib/gsw/math.js`, `taxFromInput` in `lib/gsw/service.js`.
- Rechnet im Worker-Thread mit Fortschritt (UI und Server bleiben bedienbar). Robustheit wie `robust.py`: Mittel der End-Unzen über alle existierenden Nachbarzellen ±1 Gitterschritt je Achse; Auswahl wie `compare.py pick()` (max. Nachbarschaftsmittel, dann max. roh, dann mittlere nach S). Ränge mit Gleichstand = gleicher Rang.
- Ergebnis: Kennzahlen (Endwert, CAGR auf 10.000, MaxDD, Wechsel, aufgeschoben, entfallen, Ø Verzögerung, Zeit in Silber, End-Gold-oz, **Sharpe neu**: Tagesrenditen, rf = 0, √252) gegen Buy & Hold des Paars; Equity-Kurve (linear/log, P&L Jahr/Monat); Gold-Unzen-Kurve; Wechselliste; Vergleich statisch / Walk-Forward (jährliche Neuwahl nur mit Daten bis zum Jahrestag, Neustart mit 10.000 am WF-Start) / OOS-Neustart (Auswahl fest und „nur Daten bis OOS-Start gewählt“); WF-Plan; Grid-Tabelle (sortierbar, Klick = Detail der Zelle). **Parameter übernehmen** schreibt Parameter und Paar in `data/gsw-settings.json`.

### Holdings: Signal/Aktion, Historie, Charts (seit 22.11.2026)
- **Signal/Aktion** je offenem Lot (`lib/gsw/advice.js`, `lotAction(lot, st)`): Ziel = `due.due` (heutiges Signal, Ausführung nächster Schluss) oder die Regelposition. Lot-Metall ≠ Ziel → `due` (rot) bzw. `hold` (orange, Haltefrist-Option an und Lot in der Frist); sonst `spike` (violett, halten bis sig < L2) oder `ok` (grün) mit Abstand zur nächsten Schwelle. Kommt mit `GET /api/gsw` als `book.open[].action`.
- **Historie** (`lib/gsw/history.js`, `GET /api/gsw/history`, nur lesen): `bookEquity()` verarbeitet je Handelstag erst Verkäufe (Stück × Kurs − `sellFees` → Cash), dann Käufe (Stück × Kurs + `buyFees` aus dem Cash, Fehlbetrag = Einzahlung). Equity = Cash + offene Lots × Schluss. Zwillinge (Regel-Equity des aktiven Profils, Buy & Hold Gold-Instrument) kaufen mit jeder Einzahlung Anteile und halten sie; nur wenn das Profil-Paar dieselbe Währung wie das Buch hat. Mehrere Buchwährungen → keine Kurve (Hinweis). `closedRow()` liefert G/V nach Gebühren, Haltedauer, steuerfrei ab (Frist des Profils, sonst 365), Art Swap/Verkauf.
- **Buch:** `buyFees`/`sellFees` (≥ 0), Swap bucht Kosten als Gebühren und setzt `sellSwapId`/`buySwapId`; Datum Verkauf ≥ Kauf wird geprüft; Bearbeiten/Löschen über `POST /api/gsw/book` (EDIT/DELETE), atomar (tmp + rename).
- **Charts:** ① sig mit Schwellen (Signal der Regel), ② Kursverhältnis Gold-/Silber-Instrument mit tagesgenau umgerechneten Schwellen (Schwelle / k × Paar-Ratio / GLD-SLV-Ratio; beim Spec-Paar GLD/SLV dasselbe Bild wie ①), ③ Tagesschlüsse beider Instrumente (zwei Achsen). ② und ③ einklappbar (localStorage `amber.gsw.open.chart-ratio` / `chart-prices`), Historie `amber.gsw.open.history`.
- **Tests:** `test/gsw-history.test.js`.

### API
- `GET /api/gsw` Status, Schwellen, Buch mit P&L, Chartreihen · `GET|PUT /api/gsw/settings` (`{reset:true}`) · `GET|POST /api/gsw/book` mit `action` `BUY|SELL|EDIT|DELETE|REOPEN|SWAP` (`SWAP {from, date, prices:{SYM:kurs}, toSymbol, toPrice, costPct}`) · `POST /api/gsw/bt` → Job, `GET /api/gsw/bt?id=` Fortschritt/Ergebnis (Jobs nur im Speicher) · `POST /api/gsw/run` Einzellauf.

### Validierung (22.11.2026)
- Fixture (Spec-Daten): 90/82/100/66 → 102.111,00 USD, 24,60506 Gold-oz, CAGR 26,1598 %, MaxDD −33,8391 % (Tal 18.03.2020), 14 Wechsel, 761/2.511 Tage Silber; OOS-Neustart 20.10.2023 35.920,68 USD / 6 Wechsel; WF-Fenster statisch 78.361,75 USD; Grid 15.570 Zellen, 90/82/100/66 Nachbarschaftsmittel 22,66559 (robust Rang 1, roh Rang 21); Walk-Forward-Plan und 50.056,36 USD / 12,06177 oz identisch mit `compare.json`.
- Live-Yahoo-Daten bis 21.10.2026 liefern dieselben Zahlen. Stand 20.11.2026: Gold seit 22.12.2025, sig 86,652, k60 9,922028, Abstand zum Einstieg +3,86 %.

### Datenpfad Futures
- GC=F und SI=F laufen wie alle anderen Reihen über `history()` → `getCandles` → SQLite-OHLCV-Cache. Die frühere Sonderroute (`futuresHistory`/`yahooDailyLocal`) ist entfernt; die Datierung je Balken in der Börsenzeitzone macht jetzt `providers.parseYahoo` (siehe „Tagesbalken-Datierung“ beim OHLCV-Cache). Live-Prüfung 22.11.2026 über den Cache (alter v1-Cache, selbst repariert): 102.111,00 USD, 24,60506 oz, CAGR 26,1598 %, MaxDD −33,8391 %, 14 Wechsel, 761 Tage Silber.

## W:HOLD: Auto-Watchlist der Holdings (seit 22.11.2026, Release 1.8.0)

Virtuelle, nur lesbare Watchlist mit allen aktuell gehaltenen Symbolen. Aufruf: `W:HOLD`, `W W:HOLD`, `W HOLD` oder Reiter „W:HOLD“ in W; `FVSCAN W:HOLD` scannt sie.

- **Nicht gespeichert:** Die eigenen W-Listen liegen in `data/state.json` (`amberWatch`), die per Seafile mit dem lokalen Terminal geteilt wird. W:HOLD steht dort bewusst nicht drin, sondern wird bei jedem Abruf live berechnet (`GET /api/watch/hold`). Dadurch zieht jede Buchung automatisch nach (spätestens beim 30-s-Refresh der Ansicht), es gibt keine Doppelpflege und keinen Sync-Konflikt.
- **Quellen (Provider-Registry `lib/holdings.js`):** `RSL` = offene Positionen in `data/rsl-watchlist.json` (gelesen mit `store.read` + reinem `migrateBook`, nie `loadBook`, das bei Migration schreiben würde), `GSW` = offene Lots in `data/gsw-book.json`, `PORT` = `amberPort` in `state.json` (nur gelesen). MPUT speichert keine Positionen. Neue App: `registerHoldingProvider({ id, label, file, list })`, `list()` liefert `[{ yahoo | words, source, qty }]` und darf nichts schreiben.
- **Aggregation:** Yahoo-Symbol → Security-Code wie in W (`SAP.DE` → `SAP GR EQUITY`), dedupliziert nach Code; je Code alle Quellen mit Stückzahl (gleiche Quelle summiert). Antwort `{ name:'HOLD', virtual, readOnly, codes, rows:[{ code, yahoo, sources }], providers:[{ id, label, count, error }], asOf }`; ein fehlerhafter Provider wird gemeldet, die anderen bleiben.
- **Schreibschutz:** `W HOLD ADD …` usw. zeigt einen Hinweis und speichert nichts; `HOLD` ist als Name eigener Listen reserviert (eine bereits bestehende eigene Liste HOLD bleibt erreichbar mit `W HOLD`, die Auto-Liste dann mit `W:HOLD`). Die Scanner-„+“-Ziele (FVSCAN/DSCAN) bieten W:HOLD nicht an.
- **Tests:** `test/holdings-watch.test.js` (Aggregation, Dedupe, Nachziehen nach Buchung, keine Schreibzugriffe, API, FVSCAN-Universe, Schreibschutz).

## Datenqualität: eingefrorene Kurse (seit 22.11.2026)

Yahoo liefert für manche Listings zeitweise denselben Schluss Tag für Tag (8PSG.DE 03.06.2022–06.02.2024 auf 167,14; .MI-Listings 12.–20.09.2022). `lib/data-quality.js` erkennt und repariert das beim Lesen in `lib/fn/grokki-data.js` `history()`; Rohdaten über `rawHistory()`.

- **Erkennung (`findFreezes`):** ≥ 5 aufeinanderfolgende echte Bars mit identischem Schluss (Wochenenden/Feiertage haben keine Bar und zählen nicht), wenn die Referenz (`FREEZE_REF`: GC=F für Gold-, SI=F für Silber-Produkte) im selben Zeitraum um ≥ 0,5 % schwankt; ohne Referenz ≥ 10 Bars. Der erste Bar eines Runs gilt als echt, die übrigen (`stale`) werden ersetzt.
- **Ersatz (`FREEZE_PATCHES`, `patchFreezes`):** je Tag die erste Quelle mit sauberem Kurs (eigene eingefrorene Bars der Alternative zählen nicht, `altMap`): 8PSG.DE → SGLD.MI → SGLD.L ÷ EURUSD → synthetisch GC=F ÷ EURUSD; 8PSB.DE → SSLV.L ÷ EURUSD → SI=F; PHAU/PHAG/BULL/SLVR.MI → jeweiliges .L ÷ EURUSD → GC=F/SI=F; XAD5/XAD6 nur synthetisch. Skalierung: Median Original/Alternative über 20 saubere Tage vor und nach dem Run, linear dazwischen. Ersetzte Bars: `patched: <Quelle>`, `synthetic: true|false`. Overlap-Qualität: Abweichung der skalierten Alternative vom Original über bis zu 250 saubere Tage je Seite (median/p95/max).
- **Ergebnis:** `history()` liefert `quality: { freezes, patches, unpatched }`; `qualityNotes()` erzeugt die deutschen Hinweise, GSW zeigt sie als Box (`dataQuality` in `GET /api/gsw`), GSWBT über den Ergebnissen. Nicht ersetzbare Runs → „Datenwarnung …“.
- **Warum im Code:** Der OHLCV-Cache (`data/cache/ohlcv.sqlite`) ist lokal je Rechner und wird nicht gesynct; die Korrektur greift so überall, der Cache bleibt original. `QT_DATA_FIX=0` zeigt die Rohdaten (Vergleich, reproduziert die alten Berichtszahlen).
- **GSW-Signal:** kommt nur aus `SIGNAL_TICKERS` (GC=F, SI=F, GLD, SLV); das Handelspaar liefert nur Ausführungskurse und Equity. Geprüft: gleiche sig-Reihe für GLD/SLV und 8PSG/8PSB, nach der Korrektur identische Signaltage.
- **Y-Autoscale (GSW/GSWBT/Historie):** `guideAutoscale(original, guides, visibleRange)` in `public/js/fn/gsw.js` nimmt Schwellen nur auf, wenn sie im Datenbereich liegen oder höchstens eine Datenspanne darüber/darunter (jeweils die nächste); Hilfsreihen mit `autoscale:false` zählen nicht. Knopf „Y auto“ setzt `priceScale().autoScale` zurück.
- **Tests:** `test/data-quality.test.js` (Erkennung, Alternativ-Map, Patch-Skalierung/Overlap/synthetisch, Hinweise, Signal unabhängig vom Paar, `guideAutoscale`).

## GSW-Historie: Vergleich Buy & Hold Gold und Silber (seit 22.11.2026)

Die Equity des echten GSW-Buchs (`GET /api/gsw/history`, `lib/gsw/history.js` `bookEquity`, nur lesen) wird gegen drei Zwillinge mit denselben Einzahlungen gezeigt: Regel (aktives Profil), Buy & Hold Gold (`pair.gold`, gelb) und Buy & Hold Silber (`pair.silver`, grau #c0c0c0). Jede Einzahlung (Fehlbetrag eines Kaufs inkl. Kaufgebühr; Swaps aus dem Verkaufserlös sind keine Einzahlung) kauft am Buchungstag Anteile des jeweiligen Instruments zum Paar-Schluss (`ds.pg` bzw. `ds.ps`, as-of) und hält sie, ohne weitere Kosten. Punkte tragen `bhGold`/`bhSilver`, `stats` die Endwerte. Die Zwillinge gibt es nur, wenn Buch und Profil-Paar dieselbe Währung haben. Test: `test/gsw-history.test.js`.

