// Equity tools: compare returns (COMP), the equity screener (EQS), your portfolio (PORT), dividends (DVD),
// moves around ex-dividend dates (DMOV),
// earnings estimates (EE) and analyst ratings (ANR). The maths runs on the server (lib/fn/eq-*.js, eqs.js,
// dvd.js, ee.js, anr.js), so the numbers the tests check are the numbers on screen.
import { api, esc, px, pct, cls, big, num, date } from "../api.js";
import { table, kv, sect, tabs, html, lineChart, priceChart, delayTag } from "../ui.js";
import { toSecurity, parseOption, YELLOW } from "../securities.js";
import { verdictHtml } from "./events.js";

// Six line colours that read on black and don't look like the green and red of up and down.
export const PALETTE = [
  "#ffa028",
  "#5aaeff",
  "#e9e9e9",
  "#ff5ec8",
  "#3ee0c5",
  "#b48cff",
];
const COMP_RANGES = ["1M", "6M", "1Y", "5Y"];

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const usd = (v, d = 2) =>
  finite(v) ? `${v < 0 ? "-" : ""}$${num(Math.abs(v), d)}` : "—";
const usdChg = (v) =>
  finite(v) ? `${v > 0 ? "+" : v < 0 ? "-" : ""}$${num(Math.abs(v), 2)}` : "—";
const perc1 = (v) => (finite(v) ? `${v.toFixed(1)}%` : "—");
const setCmd = (ctx, c) => ctx.setCmd?.(c);
// Dividend amounts: cents unless the payment has fractions of a cent.
const divAmt = (v) => usd(v, finite(v) && Math.abs(v * 100 - Math.round(v * 100)) > 1e-9 ? 4 : 2);
const hint = (text) =>
  html(`<div class="hint" style="margin-top:6px">${text}</div>`);

// Split words into securities: each starts with a ticker and can take an exchange code and a yellow key,
// so "AAPL MSFT NVDA", "SPX INDEX NDX INDEX" and "VOD LN AAPL US EQUITY" all read the way you'd expect.
export function secGroups(words) {
  const groups = [];
  for (const w of words) {
    const g = groups.at(-1);
    if (g && !g.some((x) => YELLOW[x])) {
      if (YELLOW[w]) {
        g.push(w);
        continue;
      }
      if (g.length === 1 && toSecurity([g[0], w])?.exch === w) {
        g.push(w);
        continue;
      }
    }
    if (!YELLOW[w]) groups.push([w]);
  }
  return groups;
}

// ---------- COMP ----------
async function renderComp(ctx) {
  let range = ctx.args.find((a) => COMP_RANGES.includes(a)) || "1Y";
  const words = ctx.args.filter((a) => !COMP_RANGES.includes(a));
  const list = [];
  if (ctx.panel?.sec) list.push(ctx.panel.sec);
  for (const g of secGroups(words)) {
    const s = toSecurity(g);
    if (s) list.push(s);
  }
  const secs = list
    .filter((s, i) => list.findIndex((x) => x.id === s.id) === i)
    .slice(0, 6);
  ctx.el.innerHTML = "";
  if (!secs.length) {
    ctx.el.append(
      html(
        `<p class="para">Compare up to six securities, each rebased to 100 at the start of the range. Type <b class="amber">COMP AAPL MSFT NVDA</b>, or load a security first: <b class="amber">SPX INDEX COMP NDX INDEX</b>. Each security is a ticker, plus an exchange code or yellow key if it needs one (<b class="amber">VOD LN</b>, <b class="amber">GC1 COMDTY</b>, <b class="amber">BTC</b>). Add 1M, 6M, 1Y or 5Y for the range.</p>`,
      ),
    );
    ctx.setSource("Daily closes from the same sources as GP");
    return;
  }
  ctx.setTitle(secs.map((s) => s.ticker).join(" vs "));
  const bar = html(
    `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>`,
  );
  const box = html(
    `<div style="position:relative;height:58%;min-height:170px"></div>`,
  );
  const out = document.createElement("div");
  ctx.el.append(bar, box, out);
  let chart;
  ctx.onCleanup(() => chart?.remove());
  const draw = async () => {
    bar.innerHTML = "";
    bar.append(
      tabs(COMP_RANGES, range, (r) => {
        range = r;
        draw();
      }),
    );
    setCmd(ctx, `COMP ${secs.map((s) => s.raw).join(" ")} ${range}`);
    out.innerHTML = `<div class="loading">Loading ${secs.length} price histories</div>`;
    const d = await api.fn("eq-comp", {
      symbols: secs.map((s) => s.id).join(","),
      range,
    });
    if (!ctx.live()) return;
    const rows = d.series.map((s, i) => ({
      ...s,
      sec: secs[i],
      color: PALETTE[i],
    }));
    chart?.remove();
    box.innerHTML = "";
    chart = lineChart(
      box,
      rows
        .filter((r) => r.points)
        .map((r) => ({ color: r.color, title: r.sec.ticker, data: r.points })),
    );
    chart.chart.applyOptions({ timeScale: { lockVisibleTimeRangeOnResize: true } });
    out.innerHTML = "";
    out.append(
      table(
        rows,
        [
          {
            key: "color",
            label: "",
            html: true,
            fmt: (c) => `<span style="color:${c}">■</span>`,
          },
          { key: (r) => r.sec.raw, label: "Security", left: true, lbl: true },
          { key: (r) => r.sec.name || "", label: "Name", left: true },
          { key: "from", label: "From", fmt: (v) => (v ? date(v) : "—") },
          { key: "first", label: "Start", fmt: px },
          { key: "last", label: "Last", fmt: px },
          { key: "ret", label: "Price return", fmt: (v) => pct(v), cls },
          { key: "vol", label: "Volatility (yr)", fmt: perc1 },
          { key: "mdd", label: "Max drawdown", fmt: (v) => pct(v), cls },
          { key: "error", label: "", left: true, wrap: true, fmt: (v) => v || "", cls: () => "err" },
        ],
        { onRow: (r) => ctx.go(`${r.sec.raw} GP`) },
      ),
      hint(
        `Rebased to 100 on the first close on or after ${esc(date(d.start))}. Price return leaves out dividends. Volatility is the standard deviation of daily returns times √252 (√365 for crypto). Max drawdown is the worst fall from a high within the range. Click a row for its chart.`,
      ),
    );
    ctx.setSource(d.source);
  };
  await draw();
}

// ---------- EQS ----------
const fmtAmt = (v) => {
  if (!finite(v)) return "";
  const a = Math.abs(v);
  for (const [n, s] of [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ])
    if (a >= n) return `${+(v / n).toFixed(2)}${s}`;
  return String(v);
};
const EQS_FIELDS = [
  ["capMin", "Market cap from", "10B"],
  ["capMax", "to", "200B"],
  ["priceMin", "Price from", "5"],
  ["priceMax", "to", "500"],
  ["chgMin", "Day % from", "-5"],
  ["chgMax", "to", "5"],
  ["volMin", "Volume at least", "1M"],
];
const TEXT_SORTS = ["ticker", "name", "sector", "country"];
const EQS_COLS = [
  { key: "ticker", label: "Ticker", left: true, lbl: true },
  { key: "name", label: "Name", left: true, fmt: (v) => (v.length > 30 ? `${v.slice(0, 29)}…` : v) },
  { key: "price", label: "Price", fmt: px },
  { key: "changePct", label: "Day %", fmt: (v) => pct(v), cls },
  { key: "volume", label: "Volume", fmt: big },
  { key: "marketCap", label: "Mkt cap", fmt: big },
  { key: "sector", label: "Sector", left: true },
  { key: "country", label: "Country", left: true },
];

async function renderEqs(ctx) {
  let query = { preset: ctx.args.join(" ") };
  let filters = {};
  const form = html(`<form class="wform" autocomplete="off"></form>`);
  const info = html(`<div class="hint" style="margin:2px 0 4px"></div>`);
  const body = document.createElement("div");
  ctx.el.innerHTML = "";
  ctx.el.append(form, info, body);
  const opt = (list, cur, all) =>
    `<option value="">${all}</option>` +
    list
      .map(
        (x) =>
          `<option value="${esc(x.name)}"${x.name === cur ? " selected" : ""}>${esc(x.name)} (${x.n})</option>`,
      )
      .join("");
  // The form's fields as a query (no preset words: the form now holds what they set).
  const current = () => {
    const q = { sort: filters.sort, dir: filters.dir };
    for (const el of form.elements)
      if (el.name && el.value.trim()) q[el.name] = el.value.trim();
    return q;
  };
  const load = async () => {
    body.innerHTML = `<div class="loading">Screening</div>`;
    const d = await api.fn("eqs", query);
    if (!ctx.live()) return;
    filters = d.filters;
    form.innerHTML =
      `<select name="sector">${opt(d.sectors, filters.sector, "Any sector")}</select>` +
      `<select name="country">${opt(d.countries, filters.country, "Any country")}</select>` +
      EQS_FIELDS.map(
        ([k, label, ph]) =>
          `<span class="dim">${label}</span><input name="${k}" style="width:70px" placeholder="${ph}" value="${esc(fmtAmt(filters[k]))}">`,
      ).join("") +
      `<button type="submit">Screen</button><button type="button" data-reset>Clear</button>`;
    const sortName =
      EQS_COLS.find((c) => c.key === filters.sort)?.label || filters.sort;
    info.textContent = `${d.total.toLocaleString("en-US")} of ${d.universe.toLocaleString("en-US")} US stocks match.${d.total > d.rows.length ? ` Showing the first ${d.rows.length}.` : ""} Sorted by ${sortName}, ${filters.dir === "asc" ? "lowest" : "highest"} first. Click a heading to sort, a row to open DES.`;
    body.innerHTML = "";
    const t = table(d.rows, EQS_COLS, {
      onRow: (r) => ctx.go(`${r.ticker} US EQUITY DES`),
    });
    t.querySelectorAll("th").forEach((th, i) => {
      const k = EQS_COLS[i].key;
      th.style.cursor = "pointer";
      if (k === filters.sort)
        th.textContent += filters.dir === "asc" ? " ▲" : " ▼";
      th.onclick = () => {
        const dir =
          k === filters.sort
            ? filters.dir === "asc"
              ? "desc"
              : "asc"
            : TEXT_SORTS.includes(k)
              ? "asc"
              : "desc";
        query = { ...current(), sort: k, dir };
        load();
      };
    });
    body.append(t);
    ctx.setSource(d.source);
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    query = current();
    load();
  };
  form.onclick = (e) => {
    if (!e.target.matches("[data-reset]")) return;
    query = {};
    load();
  };
  await load();
}

// ---------- PORT ----------
const isNum = (w) => /^-?\d*\.?\d+$/.test(w);
const sameSec = (a, b) => {
  const oa = parseOption(a),
    ob = parseOption(b);
  if (oa || ob) return oa?.key === ob?.key;
  const x = toSecurity(a.split(" ")),
    y = toSecurity(b.split(" "));
  return x && y ? x.id === y.id : a === b;
};

// "ADD NVDA 10 120", "SET NVDA 10 120" or "DEL NVDA" -> { list, msg } or { error }. ADD adds to a holding already
// there (shares summed, average cost weighted by shares); SET replaces it.
export function editPort(list, op, words) {
  words = words.slice();
  if (op === "ADD" || op === "SET" || op === "UPDATE") {
    const nums = [];
    while (words.length && isNum(words.at(-1)) && nums.length < 2)
      nums.unshift(Number(words.pop()));
    const sec = words.join(" ");
    if (!sec || !toSecurity(words))
      return {
        error:
          "Type PORT ADD, a security, the shares and the average cost: PORT ADD NVDA 10 120",
      };
    if (!nums.length || !nums[0])
      return {
        error: `How many? PORT ADD ${sec} 10 120 means 10 at an average cost of 120.`,
      };
    const [shares, cost = null] = nums;
    const old = op === "ADD" ? list.find((h) => sameSec(h.sec, sec)) : null;
    if (old) {
      const total = old.shares + shares;
      if (!total) return { error: `That would leave no ${old.sec}: PORT DEL ${old.sec} removes it.` };
      const avg =
        old.cost == null || cost == null
          ? (old.cost ?? cost)
          : Math.round(((old.shares * old.cost + shares * cost) / total) * 1e4) / 1e4;
      return {
        list: list.map((h) => (h === old ? { sec: old.sec, shares: total, cost: avg } : h)),
        msg: `${old.sec}: added ${shares}, now ${total} at ${avg ?? "no cost given"}`,
      };
    }
    const next = list.filter((h) => !sameSec(h.sec, sec));
    next.push({ sec, shares, cost });
    return {
      list: next,
      msg: `${sec}: ${shares} at ${cost ?? "no cost given"}`,
    };
  }
  if (op === "DEL" || op === "REMOVE") {
    const sec = words.join(" ");
    const next = list.filter((h) => !sameSec(h.sec, sec));
    if (next.length === list.length)
      return { error: `${sec} isn't in the portfolio` };
    return { list: next, msg: `Removed ${sec}` };
  }
  return {
    error:
      "PORT ADD NVDA 10 120 adds to a holding, PORT SET NVDA 10 120 replaces it, PORT DEL NVDA removes it, PORT IMPORT reads a CSV",
  };
}

// Imported holdings into the list: a security already there takes the imported numbers.
export const mergePort = (list, add) => [
  ...list.filter((h) => !add.some((a) => sameSec(a.sec, h.sec))),
  ...add,
];

// ---------- broker CSV import ----------
// Rows of cells from CSV text: quoted fields, commas inside quotes, CRLF, and tab or semicolon files.
export function csvRows(text) {
  const s = String(text ?? "");
  const head = s.split(/\r?\n/).slice(0, 12).join("\n");
  const count = (c) => head.split(c).length;
  const sep =
    count("\t") > count(",") ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.trim()));
}

// "$1,234.50" -> 1234.5, "(12.00)" -> -12, "--" -> null.
export function csvNumber(v) {
  let t = String(v ?? "").trim();
  const neg = /^\(.*\)$/.test(t);
  t = t.replace(/^\(|\)$/g, "").replace(/[$£€,%\s+]|USD/gi, "");
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  return neg ? -Number(t) : Number(t);
}

const norm = (h) => String(h).toLowerCase().replace(/\s+/g, " ").trim();
const COLUMN = {
  symbol: (h) =>
    /^(symbol|ticker|ticker symbol|stock symbol|security symbol|instrument symbol|code)\b/.test(
      h,
    ),
  shares: (h) => /\b(qty|quantity|shares|units)\b/.test(h) || h === "position",
  unitCost: (h) =>
    /(avg|average)\.? (cost|price|cost basis|purchase price)|cost (basis )?per (share|unit)|cost\/share|price paid|cost price|unit cost|purchase price/.test(
      h,
    ),
  totalCost: (h) =>
    /^(cost basis|cost basis total|total cost|total cost basis|book cost|cost)$/.test(
      h.replace(/ \(.*\)$/, ""),
    ),
  currency: (h) => h === "currency",
};

// A broker's positions export -> holdings, plus what was skipped and why, for the preview.
export function parseHoldingsCsv(text) {
  const rows = csvRows(text);
  const find = (cells, test) => cells.findIndex((c) => test(norm(c)));
  const hi = rows.findIndex(
    (r) => find(r, COLUMN.symbol) >= 0 && find(r, COLUMN.shares) >= 0,
  );
  if (hi < 0)
    return {
      error:
        "Couldn't find a header row with a symbol column and a quantity column (like Symbol and Quantity).",
      holdings: [],
      skipped: [],
    };
  const h = rows[hi];
  const col = {
    symbol: find(h, COLUMN.symbol),
    shares: find(h, COLUMN.shares),
    unitCost: find(h, COLUMN.unitCost),
    totalCost: find(h, (x) => COLUMN.totalCost(x) && !COLUMN.unitCost(x)),
    currency: find(h, COLUMN.currency),
  };
  const lots = new Map();
  const skipped = [];
  rows.slice(hi + 1).forEach((r, i) => {
    const line = hi + i + 2;
    const raw = (r[col.symbol] || "").trim();
    // Blank lines, totals and the notes brokers add at the end have no symbol: not holdings.
    if (!raw) return;
    const why = (w) =>
      skipped.push({
        line,
        text: raw || r.filter(Boolean).slice(0, 3).join(" "),
        why: w,
      });
    // "SPAXX**" -> SPAXX; class shares "BRK B", "BRK.B", "BRK/B" -> BRK-B, the form the price feeds know.
    const sym = raw
      .toUpperCase()
      .replace(/\*+$/, "")
      .replace(/^([A-Z]{1,5})[ ./]([A-Z])$/, "$1-$2");
    if (!/^[A-Z0-9][A-Z0-9.\-/]{0,11}$/.test(sym))
      return why("Not a stock, fund or crypto ticker");
    const shares = csvNumber(r[col.shares]);
    if (!shares) return why("No quantity");
    const ccy = col.currency >= 0 ? (r[col.currency] || "").toUpperCase() : "";
    if (ccy && ccy !== "USD")
      return why(
        `Priced in ${ccy}: add it by hand with its exchange code, like PORT ADD VOD LN 1000 70`,
      );
    const unit = col.unitCost >= 0 ? csvNumber(r[col.unitCost]) : null;
    const total = col.totalCost >= 0 ? csvNumber(r[col.totalCost]) : null;
    const costTotal = unit != null ? unit * shares : total;
    // Several lots of one security become one holding at their average cost.
    const lot = lots.get(sym) || {
      sec: sym,
      shares: 0,
      costTotal: 0,
      costKnown: true,
    };
    lot.shares += shares;
    if (costTotal == null) lot.costKnown = false;
    else lot.costTotal += costTotal;
    lots.set(sym, lot);
  });
  const holdings = [...lots.values()].map((l) => ({
    sec: l.sec,
    shares: +l.shares.toFixed(8),
    cost: l.costKnown && l.shares ? +(l.costTotal / l.shares).toFixed(6) : null,
  }));
  return {
    holdings,
    skipped,
    columns: {
      symbol: h[col.symbol],
      shares: h[col.shares],
      cost:
        col.unitCost >= 0
          ? h[col.unitCost]
          : col.totalCost >= 0
            ? `${h[col.totalCost]} (a total, divided by the quantity)`
            : null,
    },
  };
}

const loadPort = async () => {
  const s = await api.get("/api/state");
  return Array.isArray(s?.amberPort) ? s.amberPort : [];
};
const savePort = (list) => api.put("/api/state", { amberPort: list });

async function renderPort(ctx) {
  let list = await loadPort().catch(() => []);
  if (!ctx.live()) return;
  const save = async (next, msg) => {
    try {
      await savePort(next);
    } catch (e) {
      ctx.toast(`Couldn't save the portfolio: ${e.message}`, true);
      return false;
    }
    list = next;
    ctx.toast(msg);
    return true;
  };
  const change = async (op, words) => {
    const r = editPort(list, op, words);
    if (r.error) {
      ctx.toast(r.error, true);
      return false;
    }
    return save(r.list, r.msg);
  };
  const op = ctx.args[0];
  if (op && op !== "IMPORT") {
    await change(op, ctx.args.slice(1));
    if (!ctx.live()) return;
  }
  // The edit is done: keep it out of the saved layout and Back, so it can't run twice.
  if (op) setCmd(ctx, "PORT");
  ctx.el.innerHTML = "";
  const form = html(
    `<form class="wform" autocomplete="off"><input class="sec" spellcheck="false" placeholder="Security: NVDA, VOD LN, BTC, AAPL 2027-01-15 C200"><input style="width:80px" inputmode="decimal" placeholder="Shares"><input style="width:100px" inputmode="decimal" placeholder="Average cost"><button type="submit">Add or update</button><button type="button" data-import>Import CSV</button><span class="hint">On the command line: PORT ADD NVDA 10 120 adds to a holding, PORT SET replaces it, PORT DEL NVDA and PORT IMPORT.</span></form>`,
  );
  const box = document.createElement("div");
  const body = document.createElement("div");
  ctx.el.append(form, box, body);

  const load = async () => {
    if (!list.length) {
      body.innerHTML = "";
      body.append(
        html(
          `<p class="para">Type in what you hold: a security, the number of shares and your average cost, or import your broker's positions file. Stocks, ETFs, crypto, indices, non-US stocks and US options (AAPL 2027-01-15 C200: the number is contracts, the cost per share) all work. PORT values them at live prices, works out your profit and loss, and measures risk against the S&amp;P 500. These are your own numbers; nothing here is advice.</p>`,
        ),
      );
      ctx.setSource(
        "Your holdings are saved on this computer (data/state.json)",
      );
      return;
    }
    const d = await api.fn("eq-port");
    if (!ctx.live()) return;
    const t = d.totals;
    body.innerHTML = "";
    const holdings = table(
      d.holdings,
      [
        { key: "sec", label: "Security", left: true, lbl: true },
        { key: "shares", label: "Shares", fmt: (v) => num(v, v % 1 ? 4 : 0) },
        { key: "cost", label: "Avg cost", fmt: px },
        {
          key: "price",
          label: "Price",
          html: true,
          fmt: (v, r) =>
            `${px(v)}${r.currency && r.currency !== "USD" ? ` ${esc(r.currency)}` : ""}${delayTag(r)}`,
        },
        { key: "changePct", label: "Day %", fmt: (v) => pct(v), cls },
        { key: "value", label: "Value $", fmt: (v) => usd(v) },
        { key: "pnl", label: "P&L $", fmt: usdChg, cls },
        { key: "pnlPct", label: "P&L %", fmt: (v) => pct(v), cls },
        { key: "dayChg", label: "Today $", fmt: usdChg, cls },
        { key: "weight", label: "Weight", fmt: perc1 },
        { key: "beta", label: "Beta", fmt: (v) => num(v, 2) },
        { key: "vol", label: "Vol (yr)", fmt: perc1 },
        { key: "sector", label: "Sector", left: true },
        {
          key: () => `<button class="xbtn" title="Remove">×</button>`,
          label: "",
          html: true,
        },
      ],
      { onRow: (r) => ctx.go(r.option ? `OMON ${r.option.underlying} ${r.option.expiry}` : r.sec) },
    );
    // The remove button, caught before the row's click opens the security.
    holdings.addEventListener(
      "click",
      async (e) => {
        if (!e.target.closest(".xbtn")) return;
        e.stopPropagation();
        const r = d.holdings[+e.target.closest("tr").dataset.i];
        if (await change("DEL", r.sec.split(" "))) load();
      },
      true,
    );
    body.append(
      html(
        `<div style="font-size:14px;margin-bottom:6px">Value <b class="amber">${usd(t.value)}</b>  <span class="dim">cost</span> ${usd(t.cost)}  <span class="dim">P&amp;L</span> <span class="${cls(t.pnl)}">${usdChg(t.pnl)} ${pct(t.pnlPct)}</span>  <span class="dim">today</span> <span class="${cls(t.dayChg)}">${usdChg(t.dayChg)} ${pct(t.dayChgPct)}</span></div>`,
      ),
      holdings,
    );
    const cols = html(
      `<div class="cols" style="margin-top:8px"><div></div><div></div></div>`,
    );
    const [l, rt] = cols.children;
    l.append(
      sect("Risk, last year of daily returns"),
      kv([
        [
          `Beta vs ${d.market || "S&P 500"}`,
          finite(t.beta) ? num(t.beta, 2) : "—",
        ],
        ["Volatility (yr)", perc1(t.vol)],
        ["Holdings", String(d.holdings.length)],
      ]),
    );
    rt.append(
      sect("Sector mix"),
      table(d.sectors, [
        { key: "sector", label: "Sector", left: true, lbl: true },
        { key: "value", label: "Value $", fmt: (v) => usd(v, 0) },
        { key: "weight", label: "Weight", fmt: perc1 },
      ]),
    );
    body.append(
      cols,
      hint(
        `Beta is the covariance of a holding's daily returns with the S&amp;P 500's, over the variance of the S&amp;P's, on the days both traded; the portfolio's is the value-weighted average. Volatility is the standard deviation of daily returns times √252 (√365 for crypto). ${d.notes.map(esc).join(" ")}`,
      ),
    );
    ctx.setSource(d.source);
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const [s, n, c] = form.querySelectorAll("input");
    const words = [
      ...s.value.toUpperCase().trim().split(/\s+/),
      n.value.trim(),
      c.value.trim(),
    ].filter(Boolean);
    if (await change("SET", words)) {
      form.reset();
      load();
    }
  };

  // Paste a broker export, see what was understood, then save it.
  const openImport = () => {
    box.innerHTML = "";
    const f = html(
      `<div style="border:1px solid var(--line);padding:6px;margin-bottom:8px"><div class="hint">Paste the positions export from your broker (Schwab, Fidelity, Interactive Brokers, Vanguard and most others), or choose the file. It needs a symbol column and a quantity column; an average cost or cost basis column gives you P&amp;L.</div><textarea spellcheck="false" style="width:100%;height:120px;margin:6px 0;background:#0d0d0d;color:var(--white);border:1px solid #333;font:12px var(--mono)"></textarea><div class="wform"><input type="file" accept=".csv,.txt,text/csv"><button type="button" data-read>Read it</button><button type="button" data-close>Cancel</button></div><div data-preview></div></div>`,
    );
    box.append(f);
    const ta = f.querySelector("textarea");
    const preview = f.querySelector("[data-preview]");
    f.querySelector("input[type=file]").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (file) ta.value = await file.text();
    };
    f.onclick = async (e) => {
      if (e.target.matches("[data-close]")) box.innerHTML = "";
      if (e.target.matches("[data-read]")) {
        const r = parseHoldingsCsv(ta.value);
        preview.innerHTML = "";
        if (r.error)
          return preview.append(html(`<div class="err">${esc(r.error)}</div>`));
        preview.append(
          html(
            `<div class="hint">Read ${r.holdings.length} holding${r.holdings.length === 1 ? "" : "s"}. Symbol from "${esc(r.columns.symbol)}", shares from "${esc(r.columns.shares)}", cost ${r.columns.cost ? `from "${esc(r.columns.cost)}"` : "not found, so P&amp;L will be blank"}.</div>`,
          ),
          table(r.holdings, [
            { key: "sec", label: "Security", left: true, lbl: true },
            {
              key: "shares",
              label: "Shares",
              fmt: (v) => num(v, v % 1 ? 4 : 0),
            },
            { key: "cost", label: "Avg cost", fmt: px },
          ]),
        );
        if (r.skipped.length)
          preview.append(
            sect("Skipped"),
            table(r.skipped, [
              { key: "line", label: "Line", lbl: true },
              { key: "text", label: "Row", left: true },
              { key: "why", label: "Why", left: true, wrap: true },
            ]),
          );
        if (!r.holdings.length) return;
        const acts = html(
          `<div class="wform" style="margin-top:6px"><button type="button" data-replace>Save: replace my holdings</button><button type="button" data-merge>Save: add to my holdings</button></div>`,
        );
        preview.append(acts);
        acts.onclick = async (ev) => {
          const replace = ev.target.matches("[data-replace]");
          if (!replace && !ev.target.matches("[data-merge]")) return;
          const next = replace ? r.holdings : mergePort(list, r.holdings);
          if (await save(next, `Imported ${r.holdings.length} holdings`)) {
            box.innerHTML = "";
            load();
          }
        };
      }
    };
    ta.focus();
  };
  form.querySelector("[data-import]").onclick = openImport;
  if (op === "IMPORT") openImport();
  await load();
  ctx.every(60e3, load);
}

// ---------- DVD, EE, ANR ----------
async function renderDvd(ctx) {
  const d = await api.fn("dvd", { symbol: ctx.sec.id });
  if (!ctx.live()) return;
  ctx.el.innerHTML = "";
  const each =
    d.perYear && d.lastAmount != null ? `, ${divAmt(d.lastAmount)} a time` : "";
  ctx.el.append(
    html(
      `<div style="font-size:15px;margin-bottom:6px">Yield <b class="amber">${finite(d.yieldPct) ? `${d.yieldPct.toFixed(2)}%` : "—"}</b>  <span class="dim">${esc(d.frequency)}${each} · price</span> ${usd(d.price)}</div>`,
    ),
  );
  const cols = html(`<div class="cols"><div></div><div></div></div>`);
  const [l, r] = cols.children;
  l.append(
    sect("Next"),
    kv([
      ["Next ex-date", d.nextExDate || "Not announced yet"],
      ["Amount", d.nextAmount != null ? divAmt(d.nextAmount) : null],
      ["Payment date", d.nextPayDate],
      ["Last ex-date", d.lastExDate || "—"],
    ]),
  );
  r.append(
    sect("Yield"),
    kv([
      [
        "Indicated annual dividend",
        d.indicatedAnnual != null ? divAmt(d.indicatedAnnual) : "—",
      ],
      [
        "Indicated yield",
        finite(d.yieldPct) ? `${d.yieldPct.toFixed(2)}%` : "—",
      ],
      [
        "Paid in the last 12 months",
        d.trailing12m != null ? divAmt(d.trailing12m) : "—",
      ],
      [
        "Trailing yield",
        finite(d.trailingYieldPct) ? `${d.trailingYieldPct.toFixed(2)}%` : "—",
      ],
      ["Payments a year", d.perYear ? String(d.perYear) : "—"],
    ]),
  );
  ctx.el.append(
    cols,
    sect("History"),
    d.history.length
      ? table(d.history, [
          { key: "exDate", label: "Ex-date", left: true, lbl: true },
          { key: "amount", label: "Amount", fmt: divAmt },
          { key: "type", label: "Type", left: true },
          { key: "declared", label: "Declared", left: true },
          { key: "record", label: "Record", left: true },
          { key: "paid", label: "Paid", left: true },
        ])
      : html(`<p class="hint">No dividends on record.</p>`),
    hint(
      "Indicated annual dividend is the latest regular dividend times the payments a year; indicated yield is that over the live price. How the price moved around past ex-dates: <a href=\"#\" data-c=\"DMOV\">DMOV</a>.",
    ),
  );
  ctx.el.querySelector('a[data-c="DMOV"]').onclick = (e) => {
    e.preventDefault();
    ctx.go("DMOV");
  };
  ctx.setSource(d.source);
}

const epsCols = [
  { key: "period", label: "Period", left: true, lbl: true },
  { key: "consensus", label: "Consensus EPS", fmt: (v) => num(v, 2) },
  { key: "low", label: "Low", fmt: (v) => num(v, 2) },
  { key: "high", label: "High", fmt: (v) => num(v, 2) },
  { key: "estimates", label: "Analysts", fmt: (v) => num(v, 0) },
  { key: "up", label: "Revised up (4 wk)", fmt: (v) => num(v, 0) },
  { key: "down", label: "Revised down (4 wk)", fmt: (v) => num(v, 0) },
];

// ---------- DMOV: moves around the ex-dividend date ----------
const DMOV_PERIODS = ["1Y", "2Y", "3Y", "5Y", "ALL"];
// Buy-write options from the command: ENTRY=2 (trading days before the ex-date), DTE=2-10.
function dmovOpts(args) {
  const o = {};
  for (const a of args.map((x) => String(x).toUpperCase())) {
    let m;
    if ((m = /^ENTRY=(\d+)$/.exec(a))) o.entry = m[1];
    if ((m = /^DTE=(\d+)-(\d+)$/.exec(a))) [o.dtemin, o.dtemax] = [m[1], m[2]];
  }
  return o;
}
// Trading days of daily bars per DMOV period, for the chart.
const DMOV_BARS = { "1Y": 260, "2Y": 520, "3Y": 780, "5Y": 1300, ALL: 4000 };
const isoOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);
// DMOV chart: daily candles over the period, every past ex-date marked with its dividend; today's buy-write
// entry too once it is in the data. "Full chart" opens GP for the same security.
async function dmovChart(ctx, d, period, host) {
  ctx.dmovChart?.remove();
  ctx.dmovChart = null;
  const res = await api.candles(ctx.sec.id, "1D", DMOV_BARS[period] || 520).catch(() => null);
  if (!ctx.live() || !host.isConnected) return;
  const bars = (res?.candles || []).filter((b) => b.close > 0);
  if (!bars.length) {
    host.replaceChildren(html(`<p class="hint">No price chart available.</p>`));
    return;
  }
  host.replaceChildren();
  const c = priceChart(host, { type: "candles", height: 300 });
  let gone = false;
  const remove = () => { if (!gone) { gone = true; c.remove(); } };
  ctx.dmovChart = { remove };
  ctx.onCleanup(remove);
  c.series.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
  // Marker on the first bar on or after a date (an ex-date can fall on a holiday in the data).
  const barOn = (iso) => bars.find((b) => isoOf(b.time) >= iso);
  const marks = [];
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  for (const e of d.events || []) {
    const b = barOn(e.exDate);
    if (b) marks.push({ time: b.time, position: "belowBar", color: css("--amber"), shape: "arrowUp", text: `ex ${num(e.amount, 2)}` });
  }
  const q = d.buyWrite?.quote;
  const lastIso = isoOf(bars.at(-1).time);
  if (q?.entryDate && q.entryDate <= lastIso) marks.push({ time: barOn(q.entryDate).time, position: "aboveBar", color: css("--up"), shape: "arrowDown", text: "entry" });
  marks.sort((a, b) => a.time - b.time);
  window.LightweightCharts.createSeriesMarkers?.(c.series, marks);
  c.chart.timeScale().fitContent();
}
const dmovCmd = (ctx, period, o) =>
  `${ctx.sec.id} DMOV ${period}${o.entry ? ` ENTRY=${o.entry}` : ""}${o.dtemin ? ` DTE=${o.dtemin}-${o.dtemax}` : ""}`;
async function renderDmov(ctx, period, opts) {
  period = period || ctx.args.map((a) => String(a).toUpperCase()).find((a) => DMOV_PERIODS.includes(a)) || "2Y";
  opts = opts || dmovOpts(ctx.args);
  const d = await api.fn("dmov", { symbol: ctx.sec.id, period, ...opts });
  if (!ctx.live()) return;
  ctx.el.innerHTML = "";
  const cur = d.currency || "";
  const amt = (v, d2 = 2) => (finite(v) ? `${v > 0 ? "+" : v < 0 ? "-" : ""}${num(Math.abs(v), d2)} ${cur}` : "—");
  const div = (v) => (finite(v) ? `${num(v, Math.abs(v * 100 - Math.round(v * 100)) > 1e-9 ? 4 : 2)} ${cur}` : "—");
  const p1 = (v) => pct(v, 2);
  const last = d.events?.[0];
  const nx = d.next;
  const nextTxt = nx
    ? `${esc(nx.date)} <span class="dim">${nx.estimated ? (nx.overdue ? `expected, not announced yet (usually every ${nx.gapDays} days)` : `expected (usually every ${nx.gapDays} days)`) : "announced"}${nx.amount != null ? ` · ${esc(div(nx.amount))}` : ""}</span>`
    : `<span class="dim">none expected</span>`;
  ctx.el.append(
    html(`<div style="font-size:15px;margin-bottom:6px">Next ex-date <b class="amber">${nextTxt}</b>${last ? `  <span class="dim">· last</span> ${esc(div(last.amount))} <span class="dim">on ${esc(last.exDate)} (${last.yieldPct.toFixed(2)}% of the price)</span>` : ""}${d.buyWrite?.verdict ? `  <span class="dim">· buy-write entry</span> <b>${verdictHtml(d.buyWrite.verdict.level, d.buyWrite.verdict.label, `${d.buyWrite.verdict.reason} (${d.buyWrite.verdict.basis})`)}</b>` : ""}</div>`),
    tabs(DMOV_PERIODS, d.period, (p) => {
      setCmd(ctx, dmovCmd(ctx, p, opts));
      renderDmov(ctx, p, opts);
    }),
  );
  const chartHost = html(`<div style="position:relative;height:300px;margin:4px 0 8px"><p class="hint">Loading the chart…</p></div>`);
  const full = html(`<button class="tab" title="Open the full price chart (GP) for ${esc(d.symbol)}">Full chart (GP)</button>`);
  full.onclick = () => ctx.go(`${ctx.sec.id} GP`);
  ctx.el.append(
    html(`<div style="display:flex;gap:8px;align-items:center;margin-top:6px"><span class="dim">Daily price over ${esc(d.period)}, ex-dates marked with the dividend</span></div>`),
    chartHost,
  );
  ctx.el.lastElementChild.previousElementSibling.append(full);
  dmovChart(ctx, d, d.period, chartHost);
  const s = d.summary;
  if (!s || !s.n) {
    ctx.el.append(html(`<p class="hint">${esc(d.note || `No ex-dates with price data in this period. Try a longer one.`)}</p>`));
    ctx.setSource(d.source);
    return;
  }
  const [w1, w2, w3] = d.horizons;
  const rows = [
    { what: `Run-up, ${d.preDays} days before`, st: s.runUp },
    { what: "Ex-day open (gap)", st: s.gap },
    { what: "Ex-day close", st: s.exDay, am: s.exDayAmt },
    { what: "+1 week", st: s.after[w1].price, am: s.after[w1].amt },
    { what: "+2 weeks", st: s.after[w2].price, am: s.after[w2].amt },
    { what: "+3 weeks", st: s.after[w3].price, am: s.after[w3].amt },
    { what: "+1 week incl. dividend", st: s.after[w1].total },
    { what: "+3 weeks incl. dividend", st: s.after[w3].total },
  ];
  const r = s.recovery;
  const smallDiv = finite(s.yieldPct.median) && s.yieldPct.median < 0.3;
  ctx.el.append(
    sect(`Moves around the ex-date: ${s.n} ex-dates, ${s.from} to ${s.to}`),
    table(rows, [
      { key: "what", label: "From the close before the ex-date", left: true, lbl: true },
      { key: (x) => x.st.avg, label: "Average", fmt: p1, cls },
      { key: (x) => x.st.median, label: "Median", fmt: p1, cls },
      { key: (x) => x.st.max, label: "Best", fmt: p1, cls },
      { key: (x) => x.st.min, label: "Worst", fmt: p1, cls },
      { key: (x) => x.st.sd, label: "1 SD", fmt: (v) => (finite(v) ? `±${v.toFixed(2)}%` : "—"), title: "Standard deviation of the moves" },
      { key: (x) => x.st.upPct, label: "Up", fmt: perc1, title: "Share of ex-dates with a gain" },
      { key: (x) => x.am?.avg, label: `Average\n${cur}`, fmt: (v) => amt(v), cls },
    ]),
    kv([
      ["Ex-day drop ÷ dividend", finite(s.dropVsDiv.median) ? `median ${s.dropVsDiv.median.toFixed(2)} · average ${s.dropVsDiv.avg.toFixed(2)}  (1 = fell by exactly the dividend)` : "—"],
      ["Dividend per payment", finite(s.yieldPct.median) ? `median ${s.yieldPct.median.toFixed(2)}% of the price` : "—"],
      ["Back at the close before", r.n ? `${r.recovered} of ${r.n} (${perc1(r.pct)}) within ${d.recoverMax} trading days, before the next ex-date${r.days.n ? ` · median ${r.days.median} days, longest ${r.days.max}` : ""}${r.open ? ` · ${r.open} still open` : ""}` : "—"],
    ]),
  );
  if (smallDiv)
    ctx.el.append(hint("The dividend is small against the stock's normal daily moves, so the ex-day drop ÷ dividend is mostly noise. The moves themselves still count."));
  const recTxt = (e) => (e.recoveryDays != null ? (e.recoveryDays === 0 ? "ex-day" : `${e.recoveryDays} d`) : e.recoveryOpen ? "not yet" : "no");
  ctx.el.append(
    sect("Each ex-date"),
    table(d.events, [
      { key: "exDate", label: "Ex-date", left: true, lbl: true },
      { key: "amount", label: "Dividend", fmt: div },
      { key: "yieldPct", label: "Yield", fmt: (v) => `${v.toFixed(2)}%`, title: "Dividend over the close before the ex-date" },
      { key: "runUpPct", label: `Run-up\n${d.preDays} d`, fmt: p1, cls },
      { key: "exDayPct", label: "Ex-day", fmt: p1, cls },
      { key: "dropVsDiv", label: "Drop ÷\ndividend", fmt: (v) => (finite(v) ? v.toFixed(2) : "—") },
      { key: (e) => e.after[w1]?.pricePct, label: "+1 week", fmt: p1, cls },
      { key: (e) => e.after[w2]?.pricePct, label: "+2 weeks", fmt: p1, cls },
      { key: (e) => e.after[w3]?.pricePct, label: "+3 weeks", fmt: p1, cls },
      { key: recTxt, label: "Back at\nclose before", title: "Trading days after the ex-day until a close at or above the close before the ex-date (no = not before the next ex-date or within the limit)" },
    ]),
    hint(`All moves are measured from the close of the last trading day before the ex-date, the last day the price still included the dividend. A week is ${w1} trading days. Prices and dividends are split-adjusted, not dividend-adjusted. See also <a href="#" data-c="DVD">DVD</a> for the dividend history.`),
  );
  ctx.el.querySelector('a[data-c="DVD"]').onclick = (e) => {
    e.preventDefault();
    ctx.go("DVD");
  };
  if (d.buyWrite) renderDmovBuyWrite(ctx, d, opts, { p1, amt, div });
  ctx.setSource(d.source + (d.buyWrite?.quote?.source ? ` Calls: ${d.buyWrite.quote.source}.` : ""));
}

// Buy-write over the ex-date: buy N trading days before, sell the first call above the price on the first
// expiry DTE days after the entry, hold through the ex-date to expiry.
function renderDmovBuyWrite(ctx, d, opts, { p1, div }) {
  const b = d.buyWrite;
  const q = b.quote;
  const form = html(`<form class="wform" autocomplete="off">
    <label>Entry, trading days before the ex-date <input name="entry" type="number" min="1" max="10" style="width:52px" value="${b.entryDays}"></label>
    <label>DTE from entry <input name="dtemin" type="number" min="0" max="30" style="width:52px" value="${b.dteMin}"> to <input name="dtemax" type="number" min="1" max="45" style="width:52px" value="${b.dteMax}"></label>
    <button type="submit">Apply</button>
  </form>`);
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const o = { entry: f.get("entry"), dtemin: f.get("dtemin"), dtemax: f.get("dtemax") };
    setCmd(ctx, dmovCmd(ctx, d.period, o));
    renderDmov(ctx, d.period, o);
  };
  const v = b.verdict;
  ctx.el.append(
    sect("Buy-write over the ex-date"),
    ...(v ? [html(`<div style="font-size:15px;margin:4px 0 6px">Entry: <b>${verdictHtml(v.level, v.label.toUpperCase(), v.reason)}</b> <span class="dim">· ${esc(v.reason)} · ${esc(v.basis)}</span></div>`)] : []),
    hint(`Buy ${b.entryDays} trading day${b.entryDays > 1 ? "s" : ""} before the ex-date, sell the first call above the price on the first expiry ${b.dteMin} to ${b.dteMax} days after the entry, keep the dividend, hold to expiry.`),
    form,
  );
  if (q) {
    const c = q.call;
    const today = [
      ["Weekly options", q.weekly ? "yes" : "no (monthlies only)"],
      ["Next ex-date", `${d.next?.date || "—"}${d.next?.estimated ? " (expected, not announced)" : ""}`],
      ["Entry", q.entryDate || "—"],
      ["Expiry", q.expiry ? `${q.expiry} · ${q.dte} days after entry${q.fallback ? ` (monthly: no expiry ${b.dteMin}-${b.dteMax} days after the entry; the history below holds ${q.dte} days too)` : ""}` : "—"],
      ["Call", c ? `strike ${num(c.strike, 2)} (${pct(q.strikePct)} over the price ${num(q.price, 2)}) · bid ${num(c.bid, 2)} / ask ${num(c.ask, 2)} · open interest ${c.oi}${finite(c.spreadPct) ? ` · spread ${c.spreadPct.toFixed(0)}%` : ""}` : "—"],
      ["Premium", finite(q.premiumPct) ? `${num(q.premium, 2)} = ${q.premiumPct.toFixed(2)}% of the price${q.premiumEstimated ? ` (estimated for the entry day: ${q.dte} days left instead of ${q.dteNow} today, from today's implied volatility)` : " (today's bid)"}` : "—"],
      ["Dividend", finite(q.dividendPct) ? `${div(q.dividend)} = ${q.dividendPct.toFixed(2)}%` : "—"],
      ["Early assignment", q.early ? (q.early.risk ? "LIKELY: the call is in the money and its time value is below the dividend" : q.early.inTheMoney ? "unlikely (time value above the dividend)" : "only if the stock rises above the strike before the ex-date") : "—"],
    ];
    ctx.el.append(kv(today));
    if (q.reason) ctx.el.append(hint(esc(q.reason)));
  }
  const s = b.sim;
  const h = b.summary;
  ctx.el.append(
    sect(s ? `Today's terms on the past ${s.n} ex-dates` : `Stock side on the past ${h.n} ex-dates`),
  );
  if (s)
    ctx.el.append(
      kv([
        ["Return per trade", `average ${p1(s.ret.avg)} · median ${p1(s.ret.median)} · best ${p1(s.ret.max)} · worst ${p1(s.ret.min)}`],
        ["Winning trades", `${perc1(s.winPct)} · called away ${perc1(s.assignedPct)}`],
        ["Per year", finite(s.perYearPct) ? `${p1(s.perYearPct)} if repeated every ${q.dte} days (simple, before costs)` : "—"],
      ]),
      hint("Return = the stock's move from entry to expiry, capped at the strike, plus premium and dividend, each in % of the entry price."),
    );
  ctx.el.append(
    kv([
      ["Stock, entry to expiry", `average ${p1(h.move.avg)} · median ${p1(h.move.median)} · 1 SD ±${finite(h.move.sd) ? h.move.sd.toFixed(2) : "—"}%`],
      ["With the dividend", `average ${p1(h.total.avg)}`],
      ["At or above the entry", perc1(h.atOrAbovePct)],
      ["Below the entry", h.shortfall.n ? `${h.shortfall.n} times, by ${h.shortfall.avg.toFixed(2)}% on average, at most ${h.shortfall.max.toFixed(2)}%` : "never"],
    ]),
  );
  if (b.note) ctx.el.append(hint(esc(b.note)));
  const simBy = new Map((s?.rows || []).map((r) => [r.exDate, r.retPct]));
  ctx.el.append(
    table(b.events, [
      { key: "exDate", label: "Ex-date", left: true, lbl: true },
      { key: "entryDate", label: "Entry", left: true },
      { key: "expiry", label: "Expiry", left: true, fmt: (v) => v || "none" },
      { key: "dte", label: "DTE" },
      { key: "movePct", label: "Stock", fmt: p1, cls },
      { key: "totalPct", label: "Stock +\ndividend", fmt: p1, cls },
      ...(s ? [{ key: (e) => simBy.get(e.exDate), label: "Buy-write\ntoday's terms", fmt: p1, cls }] : []),
    ]),
  );
}

async function renderEe(ctx) {
  const d = await api.fn("ee", { symbol: ctx.sec.id });
  if (!ctx.live()) return;
  ctx.el.innerHTML = "";
  if (d.nextReport)
    ctx.el.append(
      html(
        `<div style="font-size:14px;margin-bottom:4px" class="amber">${esc(d.nextReport.replace(/\*/g, ""))}</div>`,
      ),
    );
  if (d.note)
    ctx.el.append(
      html(
        `<p class="para dim">${esc(d.note.replace(/\s+/g, " ").replace(/\*/g, ""))}</p>`,
      ),
    );
  if (d.quarterly.length)
    ctx.el.append(sect("Quarterly consensus"), table(d.quarterly, epsCols));
  if (d.yearly.length)
    ctx.el.append(sect("Fiscal year consensus"), table(d.yearly, epsCols));
  if (d.surprises.length)
    ctx.el.append(
      sect("Last reports against the forecast"),
      table(d.surprises, [
        { key: "period", label: "Quarter", left: true, lbl: true },
        { key: "reported", label: "Reported", left: true },
        { key: "eps", label: "EPS", fmt: (v) => num(v, 2) },
        { key: "consensus", label: "Forecast", fmt: (v) => num(v, 2) },
        { key: "surprisePct", label: "Surprise", fmt: (v) => pct(v), cls },
        {
          key: "beat",
          label: "",
          left: true,
          cls: (v) => (v === "Beat" ? "up" : v === "Missed" ? "down" : ""),
        },
      ]),
    );
  ctx.setSource(d.source);
}

async function renderAnr(ctx) {
  const d = await api.fn("anr", { symbol: ctx.sec.id });
  if (!ctx.live()) return;
  ctx.el.innerHTML = "";
  const share = (n) => (d.analysts ? (n / d.analysts) * 100 : 0);
  ctx.el.append(
    html(
      `<div style="font-size:15px;margin-bottom:6px">Consensus <b class="amber">${esc(d.consensus || "—")}</b>  <span class="dim">from ${d.analysts ?? "—"} analysts ·</span> <span class="up">${d.buy ?? "—"} buy</span> · ${d.hold ?? "—"} hold · <span class="down">${d.sell ?? "—"} sell</span></div>`,
    ),
    html(
      `<div style="display:flex;height:8px;margin-bottom:8px"><div style="width:${share(d.buy)}%;background:var(--up)"></div><div style="width:${share(d.hold)}%;background:var(--amber-dim)"></div><div style="width:${share(d.sell)}%;background:var(--down)"></div></div>`,
    ),
  );
  const cols = html(`<div class="cols"><div></div><div></div></div>`);
  const [l, r] = cols.children;
  l.append(
    sect("12-month price target"),
    kv([
      ["Mean", usd(d.mean)],
      ["Low", usd(d.low)],
      ["High", usd(d.high)],
      ["Live price", usd(d.price)],
      ["Mean target vs price", pct(d.upsidePct)],
    ]),
  );
  r.append(
    sect("Firms covering it"),
    html(`<p class="para">${esc(d.firms.join(", ") || "—")}</p>`),
  );
  ctx.el.append(
    cols,
    sect("Month by month, as of the 1st"),
    table(d.history.slice().reverse(), [
      { key: "date", label: "Month", left: true, lbl: true },
      { key: "buy", label: "Buy", fmt: (v) => num(v, 0) },
      { key: "hold", label: "Hold", fmt: (v) => num(v, 0) },
      { key: "sell", label: "Sell", fmt: (v) => num(v, 0) },
      { key: "consensus", label: "Consensus", left: true },
      { key: "meanTarget", label: "Mean target", fmt: (v) => usd(v) },
    ]),
    hint(
      "Counts and targets are the consensus Nasdaq publishes. Each analyst's own rating and target is paid data.",
    ),
  );
  ctx.setSource(d.source);
}

export default [
  {
    id: "COMP",
    name: "Compare returns",
    group: "Charts",
    source:
      "Daily closes from the same sources as GP; price return, volatility and drawdown worked out here",
    render: renderComp,
  },
  {
    id: "EQS",
    name: "Equity screener",
    group: "Equities",
    source:
      "Nasdaq stock screener (every US-listed stock; the 200 largest live, the rest last close)",
    render: renderEqs,
  },
  {
    id: "PORT",
    name: "Portfolio",
    group: "Workspace",
    source:
      "Your holdings, valued at live prices (Nasdaq, crypto exchanges, Yahoo); beta against the S&P 500",
    render: renderPort,
  },
  {
    id: "DVD",
    name: "Dividends",
    group: "Equities",
    needs: true,
    source:
      "Nasdaq dividend history (Nasdaq-listed), Yahoo dividend events (NYSE and others), live price from Nasdaq",
    render: renderDvd,
  },
  {
    id: "DMOV",
    name: "Ex-dividend moves",
    group: "Kamikaze",
    needs: true,
    source:
      "Yahoo dividend events and daily prices (US and European stocks), announced ex-dates from Nasdaq",
    render: renderDmov,
  },
  {
    id: "EE",
    name: "Earnings estimates",
    group: "Equities",
    needs: true,
    source:
      "Zacks consensus EPS estimates and surprises, published free by Nasdaq, updated daily",
    render: renderEe,
  },
  {
    id: "ANR",
    name: "Analyst ratings",
    group: "Equities",
    needs: true,
    source:
      "Analyst buy, hold and sell counts and price targets (Zacks consensus via Nasdaq), updated daily",
    render: renderAnr,
  },
];
