# KamiTerm

A Bloomberg-style market terminal that runs on your own computer, extended with a relative-strength trading toolkit, personal settings and a one-click starter that installs and updates itself.

KamiTerm is based on **Amber Terminal by Lewis Jackson** ([announcement](https://www.skool.com/zero-one/i-reverse-engineered-the-bloomberg-terminal-and-made-it-free), MIT licence, see [LICENSE](LICENSE) and [NOTICE](NOTICE)). All of the original terminal is still here: four panels, function codes, world markets, news, filings, rates, options, charts, the backtester, the API and the MCP server. Its documentation is unchanged in **[README.original.md](README.original.md)**: read that for the functions, the API, adding your own screens and data feeds.

This file covers what was added.

## What's added

### RSL26: relative-strength scanner and holdings

`RSL26 <universe>`: a weekly scanner after Levy's relative strength (close / 26-week average), with a book of your own positions.

- **Universes:** Nasdaq 100, S&P 500, HDAX and STOXX Europe 600 (EUR), each with its own benchmark. Settings are remembered per universe.
- **Ranking:** RSL26, RSL39 or 12-1 momentum (`MOM52_4`), with a configurable list length (Top X) and markers in the list: *in portfolio*, *held in another universe*, *buy candidate* for free slots, *skipped (M&A)*.
- **Entry and exit rules:** N positions, M&A skip; exits on RRG weakness (Leading → Weakening/Lagging) with rank protection (RANKTOP) or confirmation weeks, RS exit (RSL below the benchmark), trailing stop on weekly closes, buy-back lock after a trailing exit. Profiles save a full parameter set; built-in profiles come from the best backtests.
- **Holdings:** buy, edit, sell (also partial, fractional shares), reopen; P&L per position, open and closed, and an equity curve against the benchmark. Exit signals with reasons, the distance to the trailing stop, and compact columns.
- **One click per row:** **GP** chart, **DES** description, **+** buy, **⏏** sell (ranking); **GP ✎ ⏏ ✕** in the holdings.

### RSLBT: backtest of the same strategy

`RSLBT <universe>`: a manual backtest of the RSL26 rules (monthly rotation, the same entry and exit logic), with parameter profiles per universe.

- **Equity chart** for the strategy and the benchmark: curve with a **linear or log** y-axis, or **P&L per year or month** as bars (amount or %). The same chart shows the RSL26 holdings' equity.

### More screens

- **RRG**: sector rotation against the S&P 500 with stock drill-down and a season filter (a JdK-style approximation).
- **MPUT**: married-put scanner (stock near a bottom, RRG winter → spring, far out-of-the-money put 6 to 12 months out).
- **PARAMHEATMAP**: parameter heat map for RSL26 (N × RANKTOP × exit mode × RS exit).
- **DMOV**: how a stock moved around its past ex-dividend dates, for US and European stocks: run-up before, the ex-day drop against the dividend, the moves 1 to 3 weeks after (average, median, best, worst, 1 SD, share up, in % and in the currency), and how long it took to get back. Over 1, 2, 3 or 5 years or all; next ex-date announced or estimated. With a **buy-write** section: buy a few days before the ex-date, sell the first call above the price on a weekly expiry shortly after, and see how today's terms would have done on the past ex-dates (US stocks; history only for European ones).
- **DSCAN**: buy-write scanner over the coming ex-dividend dates (S&P 500, Nasdaq 100 or all US stocks): weekly options, a matching expiry, premium, liquidity filters, and each stock's past ex-dates at today's terms.
- **FV**: fair value of one stock, in the style of ValueLens and FAST Graphs: earnings (or free cash flow, or owner earnings) per share x 15, the stock's own normal P/E and the value at it, forward, yield-theory and analysts' values, the earnings yield against the 10-year Treasury, a 5-year expected return (growth, P/E back to normal, dividends), quality (ROE, ROIC, margins, debt, Piotroski, Altman Z), dividend streak (Champion, Contender, Challenger), RSL26 momentum and a backtest of buying below the normal value. US stocks from SEC 10-K figures (up to 20 years), others from Yahoo (4 years).
- **FVSCAN**: the FV numbers for the S&P 500, Nasdaq-100, DAX 40, STOXX Europe 600 or a watchlist, with presets (below fair value, below normal P/E, return 10%+, quality, dividend champions, growth, cheap with RSL above 1) and sorting.
- **HEAT**: market heatmap for the S&P 500 (all, or one sector), the Nasdaq-100, the DAX 40 and the STOXX Europe 600: tiles sized by market cap (STOXX 600: index weight), coloured by the change over 1 day, 1 week, 1, 3 months, YTD or 1 year, grouped by sector or country. A tile opens the chart.

Details, formulas and validation notes: [EXTENSIONS.md](EXTENSIONS.md).

### Settings (⚙ in the key strip, or `SETTINGS`)

- **Colour scheme:** Amber, Grey, White, Green, Red.
- **Name** top left instead of "AMBER".
- **Top bar apps:** *Auto* (most used apps first; usage is counted per function and can be reset) or *Configure* (your own pick and order).
- **Market clocks** top right: up to 8 of 15 exchanges, each with a dot for **trading**, **extended hours** (pre-market, after hours, auctions, Tradegate for Xetra) or **closed**, and the hours as tooltip. Exchange holidays are not known.
- **Ticker tape:** scroll, follow Windows' animation setting (Remote Desktop turns animations off), or off.
- **Updates:** repo URL and branch the updates come from, the last check, and *Check now*.

### Starting, updating and quitting

- **Windows, `start.bat`:** one double-click installs, updates and starts.
  - Uses the installed Node.js (22.13 or newer), or downloads a portable copy into `.runtime` (checksum verified, no admin rights).
  - Copied alone into an empty folder, it downloads the app first.
  - On every start it checks the repo for a newer version and installs it; `data\` (settings, holdings, caches) is never touched.
  - Starts in its **own app window** (Edge or Chrome app mode), or a browser tab if neither is installed.
  - If the terminal already runs, it checks for an update and opens the window again.
- **Linux, `./start.sh`, and macOS, `start.command`:** the same, then the terminal opens in the browser. Uses Node.js 22.13 or newer if installed, otherwise downloads the official build for the system (Linux x64/arm64, Alpine/musl x64, macOS Intel/Apple Silicon) into `.runtime/node`, checksum verified, no root needed. Copied alone into an empty folder, the script downloads the app first. Needs `curl` or `wget`, and `tar` (standard on both).
- **Updates need neither git nor a `.git` folder:** the updater asks the repo's web API (GitHub, or Gitea/Forgejo) for the newest commit of the branch and installs it as a ZIP. A git checkout updates by git instead, fast-forward only, and its remotes are never changed.
- **Daily check while running:** a yellow **⚠ UPDATE** badge next to the version when a newer one exists (tooltip: the new commits; click to check again). It is installed on the next start.
- **Quitting:** closing the app window stops the terminal after 20 seconds (a reload doesn't count), and the **⏻** key quits at once. Started in a normal browser tab, it keeps running until ⏻ or `node scripts/stop.js`.

## Install

**Windows.** Either download the repository as ZIP (*Code → Download ZIP*) and unpack it, or save only [`start.bat`](https://raw.githubusercontent.com/hoermto/kamiterm/master/start.bat) into an empty folder. Then double-click `start.bat`.

**Linux and macOS.** Download and unpack the ZIP (or clone the repository), or save only [`start.sh`](https://raw.githubusercontent.com/hoermto/kamiterm/master/start.sh) into an empty folder. Then run `./start.sh` (Linux; `sh start.sh` if it isn't executable) or double-click `start.command` (macOS; the first time, right-click → Open, because macOS blocks downloaded scripts). Node.js is downloaded if it's missing or older than 22.13, also on Alpine and other musl systems (x64; they need `libstdc++`, e.g. `apk add libstdc++`). On musl ARM, install it with the package manager.

The terminal opens at http://localhost:3787 (or the next free port). More ways to start it, and the setup profiles, are in [README.original.md](README.original.md#install).

## Where updates come from

By default from **https://github.com/hoermto/kamiterm.git**, branch **master**. Change it in ⚙ SETTINGS → Updates, or per computer in `data/launcher.cfg` (kept across updates):

```ini
REPO_URL=https://github.com/hoermto/kamiterm.git
BRANCH=master
APP_WINDOW=0          # Windows: browser tab instead of an app window
EXIT_ON_CLOSE=0       # keep running when the window is closed
UPDATE_CHECK_HOURS=24
```

A `launcher.cfg` next to `start.bat` sets the same for a first install. `node scripts/update.js` shows the update status from the command line, `AMBER_UPDATE_CHECK=0` turns off the daily check, and `AMBER_UPDATE=0 ./start.sh` starts without updating.

New versions are developed on `rel-<version>` branches and merged into `master`, so installs following `master` only get finished releases. Changes per version: [CHANGELOG.md](CHANGELOG.md) (in German).

## Credits

Amber Terminal, the base of this project: Copyright (c) 2026 Lewis Jackson, MIT licence ([LICENSE](LICENSE), [NOTICE](NOTICE), [original README](README.original.md)).

Charts are drawn with [TradingView Lightweight Charts™](https://www.tradingview.com/) (Copyright TradingView, Inc.), used under the Apache License 2.0. The library is in `public/vendor/` with its licence header.

Market data comes from public endpoints, each under its own terms. Nothing in this software is financial advice.
