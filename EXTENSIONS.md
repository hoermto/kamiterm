# Grokki extensions · Amber Terminal MVP

**Version 1.5.0** (in Arbeit) — Änderungen siehe [CHANGELOG.md](CHANGELOG.md). Versionsquelle: `package.json` (Server/MCP) und `public/js/version.js` (UI-Kopfzeile, HELP), Test `test/version.test.js`.

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
| `DSCAN SPX` / `DSCAN ALL DAYS=21 MINOI=0` | Buy-write-Scanner über die kommenden Ex-Tage (US), siehe „DSCAN“ unten |
| `W` / `W TECH` / `W NEW TECH` / `W TECH ADD NVDA` / `W RENAME TECH CHIPS` / `W DROP TECH` | Mehrere Watchlists: Reiter je Liste; `W ADD`/`W DEL` gelten für die offene Liste. Gespeichert in `data/state.json` (`amberWatch.lists`, `active`) |
| `HEAT SPX` / `HEAT SPX XLK 1W` / `HEAT SXXP Germany YTD` / `HEAT DAX` | Markt-Heatmap, siehe „HEAT“ unten |
| `KO FV` / `KO FV FCF` / `SAP.DE FV PE=18` | Fair-Value-Analyse einer Aktie (auch als Link aus DES), siehe „FV / FVSCAN“ unten |
| `FVSCAN SPX` / `FVSCAN NDX FILTER=QUALITY SORT=YIELD` / `FVSCAN W:TECH BASIS=OE` | Fair-Value-Scanner über S&P 500, Nasdaq-100, DAX, STOXX 600 oder eine Watchlist |
| `KO DMOV` / `SAP.DE DMOV 5Y` | Kursbewegung um vergangene Ex-Dividenden-Tage (US und Europa), Zeitraum 1Y/2Y/3Y/5Y/ALL, siehe „DMOV“ unten |
| `RSL26 … MASKIP=0` | „M&A ignorieren“ aus (Standard `MASKIP=1`: M&A-Titel zählen nicht zum Kauf-Fenster). `HIDEMA` ist entfallen und wird ignoriert |
| `RSLBT SPX START=10000 SIZE=EQUITY FRACTIONAL=1` | Backtest-Startkapital, Budget=Equity/n, Bruchstücke (Defaults) |
| `RSLBT SPX YEARS=10 N=5 RANKTOP=25 TRAIL=20 TRAILLOCK=4 RUN` | Backtest mit Trailing-Stop −20 % vom Hoch seit Kauf, 4 Wochen Rückkauf-Sperre |
| `RSLBT SPX YEARS=10 N=5 RANKTOP=25 TRAIL=20 TRAILLOCK=4 RANKING=MOM52_4 RUN` | Backtest mit Rangliste 12-1-Momentum statt RSL26 |
| `RSL26 SPX RANKING=MOM52_4` | Scanner: Rangliste nach 12-1-Momentum, Spalte „Mom 12-1 %“ (RSL26 bleibt als Spalte für den RS-Exit) |
| `RSL26 SPX TRAIL=20` | Scanner: Holdings zeigen Hoch seit Kauf, Stop-Level und Abstand; Exit-Hinweis bei Auslösung |
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

RSL26 and MPUT have universe tabs and parameter inputs. RRG has quadrant tabs,
sector selector, a four-quadrant graph with eight weekly tail points, and a table.
Click a sector table row to drill down; stock rows open GP. MPUT rows open the
suggested expiry in OMON. HELP and DATA list the new functions under **Kamikaze**.

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
The cache directory is listed in the Seafile library `seafile-ignore.txt`
(`amber-terminal/data/cache/`) and is not synced.

### Event cache (dividends, earnings dates)

Company events are stored in **`data/cache/events.sqlite`** (`lib/events-cache.js`,
`node:sqlite`, `QT_EVENTS_PATH` overrides): tables `dividends` and `earnings` (per
symbol and source), `upcoming` (dates seen in calendars) and `fetch_log` (when each
source was last asked, and whether it answered). `refresh()` serves the cache while it
is fresh, asks the source when it is stale, and falls back to the cached rows (marked
stale) when the source fails; a failed source is asked again after 15 minutes, not on
every request. If SQLite fails, the live data is used without the cache. SETTINGS ›
Data sources shows the size and has **Clear**.

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


## DMOV: moves around the ex-dividend date (seit v1.5.0)

`<Ticker> DMOV [1Y|2Y|3Y|5Y|ALL]` (Standard 2Y), US-Aktien (`KO`) und europäische
Yahoo-Ticker (`SAP.DE`). Rechnung: `lib/event-moves.js` (rein, getestet), Daten:
`lib/fn/dmov.js`.

- **Daten:** Yahoo-Dividenden-Events (`interval=1wk&range=15y`: vollständig, ~90 KB;
  `range=max` lässt Jahrzehnte aus, Monatskerzen fassen zwei Zahlungen eines Monats
  zusammen), wöchentlich im Event-Cache aufgefrischt. Kurse: tägliche Yahoo-Kerzen
  aus dem OHLCV-Cache, 10 Jahre. Beide **split-, nicht dividendenbereinigt**, daher
  passen Dividende und Kursabschlag zusammen. US: angekündigte Ex-Tage von Nasdaq
  (nur künftige Termine; Nasdaqs alte Beträge sind nicht splitbereinigt).
- **Bezug:** Schlusskurs des letzten Handelstags vor dem Ex-Tag („cum“). Run-up = cum
  gegen 5 Handelstage davor; Ex-Tag Open (Gap) und Close; Abschlag ÷ Dividende
  (1 = genau um die Dividende gefallen); +1/+2/+3 Wochen = 5/10/15 Handelstage nach
  cum, ohne und mit Dividende; Erholung = Handelstage nach dem Ex-Tag bis zu einem
  Schluss ≥ cum (höchstens 60, nur bis zum nächsten Ex-Tag; noch laufend = „not yet“).
- **Statistik je Zeitraum:** Durchschnitt, Median, bester, schlechtester Wert,
  1 Standardabweichung, Anteil positiv, Durchschnitt in Währung.
- **Nächster Ex-Tag:** angekündigt, sonst geschätzt aus dem üblichen Abstand (Median
  der letzten 8); ein üblicher Termin, der weniger als einen halben Abstand zurückliegt,
  gilt als „expected, not announced yet“. Wer zwei Zahlungen ausgelassen hat: keiner.
- **Grenze:** Ist die Dividende klein gegen die normalen Tagesbewegungen (Median unter
  0,3 % des Kurses), ist Abschlag ÷ Dividende vor allem Rauschen; der Screen sagt das.

### Buy-write über den Ex-Tag (Abschnitt in DMOV)

`KO DMOV 5Y ENTRY=2 DTE=2-10` (Standard ENTRY=2, DTE=2-10; im Screen änderbar).
Rechnung: `lib/event-moves.js` (Historie) und `lib/buywrite.js` (Optionen).

- **Trade:** Kauf zum Schluss ENTRY Handelstage vor dem Ex-Tag, Verkauf des ersten
  Calls über dem Kurs auf dem ersten Verfall am oder nach dem Ex-Tag, der DTE
  Kalendertage nach dem Einstieg liegt; Dividende behalten, bis zum Verfall halten.
- **Historie (alle Aktien):** je Ex-Tag Einstieg, Verfall (erster Freitag in der
  Spanne; Feiertag → letzter Handelstag davor) und Kursbewegung Einstieg → Verfall,
  ohne/mit Dividende. Historische Optionspreise gibt es nicht frei.
- **Heute (nur US, CBOE-Kette, ~15 Min. verzögert):** Weeklys = mindestens 3
  Verfallstermine in den nächsten 35 Tagen; passender Verfall; erster Strike über dem
  Kurs mit Bid/Ask, Open Interest, Spread. **Prämie:** liegt der Einstieg heute bzw.
  am nächsten Handelstag, der Bid; liegt er später, eine Schätzung für den
  Einstiegstag (Black-Scholes mit der heutigen impliziten Vola des Strikes, den Tagen
  ab Einstieg und Kurs minus Dividende, mal Bid/Modell von heute), weil der Call dann
  weniger Restlaufzeit hat.
- **Heutige Konditionen auf die Historie:** je Ex-Tag Rendite = min(Bewegung,
  Strike-Abstand) + Prämie + Dividende (in % des Einstiegs); Durchschnitt, Median,
  bester/schlechtester Trade, Gewinnquote, Anteil ausgeübt, „pro Jahr“ (einfach
  hochgerechnet, vor Kosten).
- **Frühe Ausübung:** Risiko, wenn der Call im Geld ist und sein Zeitwert unter der
  Dividende liegt (dann übt der Käufer am Tag vor dem Ex-Tag aus).
- **Bewertung des Einstiegs** (`verdict()` in `lib/event-moves.js`, auch in DSCAN):
  Grundlage sind die Renditen je vergangenem Ex-Tag, mit Optionskurs die heutigen
  Buy-write-Konditionen, sonst Aktie + Dividende vom Einstieg bis zum Verfall.
  **promising** = mindestens 8 Ex-Tage, Durchschnitt > 0, mindestens 65 % gewonnen und
  der Durchschnitt deutlich über null (t = Durchschnitt / (SD / √n) ≥ 1,5);
  **not promising** = Durchschnitt ≤ 0 oder weniger als die Hälfte gewonnen;
  **mixed** = dazwischen; **too little history** = weniger als 8 Ex-Tage (bei
  jährlichen Zahlern einen längeren Zeitraum wählen). Mit Begründung (gewonnen,
  Durchschnitt, schlechtester Trade). DSCAN sortiert nach Bewertung, dann nach
  Durchschnitt.

## DSCAN: Buy-write-Scanner über die kommenden Ex-Tage (seit v1.5.0)

Je Zeile ein „Chart“-Knopf (öffnet `<Ticker> GP`); ein Klick auf den Rest der Zeile öffnet DMOV. DMOV selbst zeigt oben den Tageskurs des Zeitraums mit allen Ex-Tagen (Pfeil + Dividende) und „Full chart (GP)“.

`DSCAN [SPX|NDX|ALL] DAYS=14 ENTRY=2 DTE=2-10 WEEKLY=1 MDTE=45 LIQUID=0 MINOI=50 MAXSPREAD=30 PERIOD=5Y`
(Einstellungen werden gemerkt). Nur US-Aktien (Optionsdaten). `lib/fn/dscan.js`.

1. **Ex-Tage:** Nasdaq-Dividendenkalender, eine Abfrage je Werktag bis DAYS voraus,
   12 Stunden im Event-Cache. Nur Stammaktien (einfache Ticker, keine Preferreds/Notes).
2. **Universum:** SPX, NDX (wie RSL26) oder ALL (jede Aktie im Kalender).
3. **Optionen je Aktie** (CBOE, wie DMOV › Buy-write): Filter in dieser Reihenfolge,
   gezählt im Screen: keine US-Optionen · zu spät (letzter Kauftag vor dem Ex-Tag
   vorbei) · keine Weeklys (`WEEKLY=1`, Standard) · kein Verfall DTE nach dem Einstieg ·
   keine Prämie · nur mit `LIQUID=1`: Open Interest < MINOI oder Spread > MAXSPREAD
   (Spread = (Ask − Bid) / Mitte des ersten Calls über dem Kurs). Open Interest und
   Spread stehen immer in der Tabelle.
   **Monatsoptionen:** mit `WEEKLY=0` bekommt eine Aktie ohne Verfall im DTE-Bereich den
   ersten Verfall nach dem Ex-Tag bis MDTE Tage nach dem Einstieg (Standard 45, in der
   Tabelle „M“); ihre Historie hält dann dieselbe Anzahl Kalendertage statt bis zum
   Weekly-Freitag. DMOV nutzt diesen Rückfall immer.
4. **Historie:** die vergangenen Ex-Tage der Aktie im Zeitraum PERIOD mit den heutigen
   Konditionen (wie in DMOV): Durchschnitt, Median, schlechtester Trade, Gewinnquote,
   Anteil ausgeübt, „pro Jahr“. Dazu „Prämie + Dividende“ = Ertrag bei unverändertem Kurs.
5. **Sortierung:** Durchschnitt je Trade, absteigend. Klick auf eine Zeile öffnet DMOV
   mit denselben Parametern.

Außerhalb der Handelszeit sind die Spreads die vom Schluss und oft weit; Weekly-Strikes
haben anfangs wenig Open Interest. Zeitbudget 120 s, 4 Ketten parallel.

## HEAT: Markt-Heatmap (seit v1.5.0)

`HEAT [SPX|NDX|DAX|SXXP] [Sektor/Land] [1D|1W|1M|3M|YTD|1Y]`, z. B. `HEAT SPX XLK 1W`, `HEAT SXXP United_Kingdom`.

- **Universen** als Reiter: S&P 500 (nach den 11 Sektoren aus `SECTORS` in `grokki-universes.js` gruppiert; zweite Reiterzeile ALL / XLK … XLRE zeigt einen Sektor allein), Nasdaq-100 (S&P-Sektor, sonst „Not in the S&P 500“), DAX 40 (ungruppiert), STOXX Europe 600 (nach Land). Klick auf einen Gruppenkopf zoomt hinein, Klick auf eine Kachel öffnet `<Ticker> GP`.
- **Kachelgröße:** Marktkapitalisierung von Yahoo (v7 quote, 50 Titel je Anfrage, einen Tag gespeichert in `data/heat-caps.json`; dauert der erste Abruf über 20 s, zeichnet die Karte mit dem Gespeicherten und der Abruf läuft im Hintergrund weiter). STOXX 600: iShares-Indexgewicht aus der Mitgliederliste (Streubesitz). Ohne Wert: Mediangröße.
- **Farbe:** Veränderung über den Zeitraum aus den Tageskursen des OHLC-Caches (`history()`, bis 15 Minuten verzögert): n Handelstage zurück (1D=1, 1W=5, 1M=21, 3M=63, 1Y=252), YTD gegen den letzten Schluss des Vorjahres. Volles Rot/Grün bei ±3 % (1D), ±6 % (1W), ±10 % (1M), ±15 % (3M), ±30 % (YTD, 1Y). Europäische Kurse mit `repairBars` bereinigt; Veränderung in Landeswährung (keine EUR-Umrechnung).
- Alle Zeiträume kommen in einer Antwort, der Wechsel des Zeitraums lädt nicht neu. Universum und Zeitraum werden gemerkt (`/api/settings`, Tool HEAT). Gruppenkopf und Kopfzeile zeigen die nach Gewicht gemittelte Veränderung.
- Server: `lib/fn/heat.js`, Screen: `public/js/fn/heat.js` (squarified Treemap), Tests: `test/heat.test.js`.

## FV / FVSCAN: Fair Value (seit v1.6.0)

Nach dem Vorbild von ValueLens („Kamikaze-Trader“) und FAST Graphs, mit eigenen Daten (kein Login).

`<Aktie> FV [EPS|FCF|OE] [PE=15]` und `FVSCAN [SPX|NDX|DAX|SXXP|W:<Liste>] [BASIS=] [PE=] [FILTER=] [SORT=]`.

- **Daten** (`lib/fundamentals.js`, Cache `data/cache/fundamentals/`): US-Aktien aus den SEC Company Facts (10-K, bis 20 Jahre; je Feld eine Liste von US-GAAP-Tags, pro Geschäftsjahr gewinnt der erste mit Wert; Wert aus der neuesten Einreichung, „bekannt seit“ = erste Einreichung; EPS und Aktienzahl gegen Yahoos Splits bereinigt, wenn vor dem Split eingereicht). Andere Aktien und 20-F-Filer ohne US-GAAP: Yahoo-Jahreszeitreihe (4 Jahre, „bekannt“ 75 Tage nach Jahresende). Kurse, Dividenden, Splits: ein Yahoo-Chart-Abruf monatlich über die ganze Historie (`period1=0`; `range=max` lässt Jahre aus). Kurs, TTM- und Forward-EPS: Yahoo v7 quote. Berichtswährung ≠ Kurswährung (Shell: USD/GBp): Umrechnung zum heutigen Kurs. Cache: Jahreszahlen 14 Tage, Chart 2 Tage, Analystenprofil 1 Tag. Antwortet SEC nicht (z. B. 429 bei zu vielen Abrufen, eher ohne Kontaktadresse), gelten Yahoos 4 Jahre nur vorläufig: Hinweis in FV, neuer SEC-Versuch nach einer Stunde.
- **Basis:** EPS (GAAP verwässert), FCF je Aktie (operativer Cashflow − Capex) oder Owner Earnings (FCF − aktienbasierte Vergütung). „Jetzt“: TTM-EPS (nur SEC-Aktien; Yahoos TTM für Auslandslistings ist teils je ADR oder in gemischter Währung), sonst letztes Geschäftsjahr. TTM über 1,3 × Forward-EPS gilt als Einmaleffekt → Forward-EPS.
- **Fair Value** = Basis × fairer KGV (Standard 15). **Normal-KGV** = Median der Monats-KGVs der letzten 15 Jahre, je Monat mit dem zuletzt veröffentlichten Jahreswert (point in time), nur positive, KGV < 200, mindestens 12 Monate. **Wert bei Normal-KGV** = Basis × Normal-KGV. Bewertung: ≤ −10 % „below normal“, bis +10 % „near normal“, darüber „above normal“; unter 5 Jahren Historie mit „(short history)“.
- **Wachstum:** Median des Wachstums zwischen allen Jahrespaaren der letzten 10 Jahre (Theil-Sen auf den Logarithmen; ein Ausreißerjahr kippt es nicht; höchstens ein Verlustjahr), sonst 5-Jahres-CAGR (nur über sechs positive Jahre), sonst Analysten nächstes Jahr, danach 6 % (ein Jahr ist keine 5-Jahres-Rate). Begrenzt auf −10 … +25 %.
- **Erwartete Rendite (5 Jahre, p. a.):** Basis wächst mit g, KGV am Ende = Normal-KGV (höchstens 30; bei kurzer Historie höchstens das heutige), Dividenden wachsen mit g. Dazu dieselbe Rechnung mit KGV 15 und mit Analystenwachstum. FVSCAN rangiert nach dem kleineren der beiden Werte (eigene Historie, Analysten). **Erratisch:** ≥ 2 Verlustjahre unter den letzten 10 → keine erwartete Rendite im Scanner, Warnung in FV.
- **Qualität:** ROE (Durchschnitts-Eigenkapital), ROA, ROIC (operatives Ergebnis nach Steuern / (EK + Schulden − Cash)), Margen, Schulden/Kapital, Nettoschulden/EBITDA, Zinsdeckung, Current Ratio, Piotroski F (9 Kriterien), Altman Z (original; nicht für Banken, Versicherer, Immobilien). Ausschüttung zu Gewinn und FCF, FCF/Dividende über 5 Jahre.
- **Dividende** (aus Yahoos Zahlungen): Sonderdividenden und Yahoos doppelte Einträge fallen raus (≥ 1,75 × Median der zwei Jahre drumherum). Jahre erhöht = höchste reguläre Zahlung je Kalenderjahr über der des Vorjahres, in Folge bis zum Vorjahr. Champion ≥ 25, Contender 10–24, Challenger 5–9. Yield Theory: heutige Dividende / Durchschnittsrendite der letzten 10 Jahre (mindestens 36 Monate).
- **Momentum:** RSL26 (Levy) aus dem OHLC-Cache; „cheap+mom“ = unter Normalwert und RSL > 1.
- **Backtest (FV):** jeder Monat ab dem vierten Jahr: Kurs / (Basis damals × Normal-KGV aus den Monaten davor), Rendite der nächsten 12 Monate mit Dividenden, gruppiert (> 20 % darunter, 0–20 % darunter, 0–20 % darüber, > 20 % darüber). Überlappende Fenster, vor Kosten und Steuern.
- **FVSCAN-Filter** (wie ValueLens): ALL, UNDER, NORMAL, RET10, DIV10, ROE15, DEBT50, FCFDIV, QUALITY (ROE ≥ 15, Schulden/Kapital ≤ 50, FCF deckt Dividende, unter Normal), CHAMP / CONTENDER / CHALLENGER (fair bewertet = höchstens 10 % über Normalwert), GROWTH (g ≥ 10, fair, Rendite ≥ 10, PEG ≤ 1,5), GROWTHRET (g ≥ 15, fair), CHEAPMOM. Kombinierbar: ein Klick schaltet eine Voreinstellung zu oder ab, alle gewählten müssen gelten, „All“ löscht sie (`FILTER=QUALITY,CHAMP`). Sortierung: RET, RETHIST, NORMAL, FAIR, YIELD, RAISED, ROE, RSL, F. Universum, Basis, KGV, Filter und Sortierung werden gemerkt (Tool FVSCAN).
- **„More filters“** zusätzlich zur Voreinstellung, alle gesetzten müssen gelten (fehlt der Wert, fällt die Aktie raus), ohne neuen Scan, gemerkt: Dividende (zahlt Dividende, mindestens n Jahre gezahlt, mindestens n Jahre in Folge erhöht, Rendite von/bis, Dividendenwachstum 5 J., Ausschüttung zu Gewinn und FCF, FCF/Dividende), Bewertung (KGV, vs Normal, vs Fair, erwartete Rendite, Wachstum, PEG), Qualität (ROE, ROIC, Nettomarge, Schulden/Kapital, Piotroski), RSL26, Ausschlüsse (Banken/Versicherer/Immobilien, erratische Gewinne, kurze Historie). Auch in der Befehlszeile: `FVSCAN SPX PAYER=1 MINRAISED=10 MINYIELD=2 NOFIN=1`, `CLEAR=1` löscht die gemerkten. Zeitbudget 100 s; was nicht fertig wird, lädt im Hintergrund weiter (S&P 500 kalt rund 45 s).
- Server: `lib/fundamentals.js`, `lib/valuation.js`, `lib/fn/fv.js`, `lib/fn/fvscan.js`; Screen: `public/js/fn/fv.js`; Tests: `test/fv.test.js`.

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
- **M&A ignorieren** (seit 11.11.2026, Entry, Checkbox, Standard an, Parameter `maSkip` / Befehl `MASKIP=0|1`): Titel mit M&A-Flag (laufender Deal; manuelle Liste + SEC EDGAR 180 Tage) werden beim Einstieg übersprungen und zählen nicht zum Kauf-Fenster Rang 1…N. Das Fenster rückt auf die nächsten Ränge ohne M&A vor (N=5, Rang 3 M&A → Kandidaten aus Rang 1, 2, 4, 5, 6). KAUF-Markierung und Slot-Zusammenfassung folgen dem; M&A-Zeilen im Fenster tragen „übersprungen (M&A)“. Gehaltene M&A-Titel bleiben gehalten und sichtbar (kein Zwangsverkauf). Aus = bisheriges Verhalten (M&A zählt mit, nur Warnung im KAUF-Tooltip). Gespeichert je Universum (`byUniverse`) und in Profilen; fehlt `maSkip` (alte Profile/Einstellungen) → an; altes `hideMa` wird ignoriert. Eingebaute Profile: an. **Backtest (RSLBT):** keine historischen M&A-Daten → keine Wirkung; die Checkbox dort heißt „M&A ignorieren (nur Scanner)“ und wird nur mitgespeichert. Helfer: `buySlotCandidates(rows, positions, {n, universe, skipMa})` in `public/js/fn/rsl-slots.js` (liefert zusätzlich `skippedMa`, `windowEnd`).
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
