// Screens about one security: description, financials, news, price chart (with studies), intraday chart,
// price history.
import { api, esc, px, pct, chg, cls, big, num, date, ago } from "../api.js";
import { table, kv, sect, tabs, html, delayTag } from "../ui.js";
import { ohlcChart, RANGES } from "../ohlc-chart.js";
import { parseGpOverlay } from "../gp-overlay.js";

function isoOfBar(t) {
  return new Date(t * 1000).toISOString().slice(0, 10);
}

// Horizontal buy / stop lines and a "K" marker on the buy date (Lightweight Charts 5.x: createSeriesMarkers).
// Overlay comes only from command parameters (BUY=/STOP=/TRAIL=/SRC=), never from a book lookup.
function applyGpOverlay(series, overlay, bars) {
  if (!overlay || !series) return;
  const barOn = (iso) => (bars || []).find((b) => isoOfBar(b.time) >= iso);
  const marks = [];
  for (const p of overlay.buys || []) {
    if (!Number.isFinite(p.price)) continue;
    series.createPriceLine({
      price: p.price,
      color: "#f2d21b",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: p.label || "Kauf",
    });
    const b = p.date && barOn(p.date);
    if (b) {
      marks.push({
        time: b.time,
        position: "belowBar",
        color: "#f2d21b",
        shape: "arrowUp",
        text: "K",
      });
    }
  }
  for (const s of overlay.stops || []) {
    if (!Number.isFinite(s.price)) continue;
    series.createPriceLine({
      price: s.price,
      color: "#ff4a4a",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: s.label || "Stop",
    });
  }
  if (marks.length) window.LightweightCharts.createSeriesMarkers?.(series, marks);
}

// GP / GIP: the shared OHLC chart (ohlc-chart.js) filling the panel, with the BUY=/STOP= overlay from the command.
async function chartScreen(ctx, range, type = "candles") {
  ctx.el.innerHTML = "";
  const overlay = parseGpOverlay(ctx.args);
  const holdHint = html(
    `<span class="dim" style="display:none" title="Kauf- und Stop-Linien aus den Befehlsparametern BUY= und STOP= (SRC= nur als Label-Präfix). Ohne Parameter keine Overlay-Linien."></span>`,
  );
  await ohlcChart(ctx, ctx.el, {
    range,
    type,
    fill: true,
    tools: [holdHint],
    decorate: (chart, series, { vis }) => {
      if (overlay?.buys?.length || overlay?.stops?.length) applyGpOverlay(series, overlay, vis);
      const text = overlay?.hint || "";
      holdHint.textContent = text;
      holdHint.style.display = text ? "" : "none";
    },
  });
}

export default [
  {
    id: "DES",
    name: "Description",
    group: "Equities",
    needs: true,
    source: "Nasdaq company profile (US stocks), Yahoo Finance prices",
    async render(ctx) {
      const d = await api.fn("des", { symbol: ctx.sec.id });
      if (!ctx.live()) return;
      if (d.name) ctx.setTitle(`${d.name}  ·  ${ctx.sec.raw}`);
      ctx.el.innerHTML = "";
      const p = d.price;
      if (p)
        ctx.el.append(
          html(
            `<div style="font-size:15px;margin-bottom:6px"><b class="amber">${px(p.price)}</b>${delayTag(p)}  <span class="${cls(p.change)}">${chg(p.change)}  ${pct(p.changePct)}</span>  <span class="dim">52w ${px(p.low52)} to ${px(p.high52)} · YTD</span> <span class="${cls(p.ytdPct)}">${pct(p.ytdPct)}</span></div>`,
          ),
        );
      const cols = html(`<div class="cols"><div></div><div></div></div>`);
      const [l, r] = cols.children;
      l.append(
        sect("Company"),
        kv([
          ["Name", d.name],
          ["Sector", d.sector],
          ["Industry", d.industry],
          ["Region", d.region],
          ["Website", d.website],
        ]),
      );
      if (d.stats?.length)
        r.append(sect("Key data"), kv(d.stats.map((s) => [s.label, s.value])));
      ctx.el.append(cols);
      if (d.description)
        ctx.el.append(
          sect("Business"),
          html(`<p class="para">${esc(d.description)}</p>`),
        );
      ctx.el.append(
        html(
          `<div class="hint">Next: <a href="#" data-c="FA">FA financials</a> · <a href="#" data-c="CN">CN news</a> · <a href="#" data-c="GP">GP chart</a> · <a href="#" data-c="OMON">OMON options</a> · <a href="#" data-c="GEX">GEX gamma</a> · <a href="#" data-c="CF">CF filings</a> · <a href="#" data-c="DVD">DVD dividends</a> · <a href="#" data-c="DMOV">DMOV ex-div moves</a> · <a href="#" data-c="FV">FV fair value</a> · <a href="#" data-c="EE">EE estimates</a> · <a href="#" data-c="ANR">ANR analysts</a></div>`,
        ),
      );
      ctx.el.querySelector(".hint:last-child").onclick = (e) => {
        e.preventDefault();
        if (e.target.dataset.c) ctx.go(e.target.dataset.c);
      };
      ctx.setSource(d.source);
    },
  },
  {
    id: "BQ",
    name: "Quote with pre-market and after hours",
    group: "Equities",
    needs: true,
    source: "Yahoo Finance quote",
    async render(ctx) {
      // Times in New York, where the US extended sessions run, so 4:00 to 9:30 and 16:00 to 20:00 read as such.
      const at = (t) =>
        t
          ? new Date(t * 1000).toLocaleString("en-GB", {
              timeZone: "America/New_York",
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            }) + " ET"
          : "—";
      const row = (label, l, delayMin) =>
        l
          ? `<tr><td class="l dim">${label}</td><td><b class="amber">${px(l.price)}</b>${delayTag({ delayMin, asOf: l.time })}</td><td class="${cls(l.change)}">${chg(l.change)}</td><td class="${cls(l.changePct)}">${pct(l.changePct)}</td><td class="dim">${at(l.time)}</td></tr>`
          : `<tr><td class="l dim">${label}</td><td colspan="4" class="dim">none</td></tr>`;
      const load = async () => {
        const d = await api.fn("bq", { symbol: ctx.sec.id });
        if (!ctx.live()) return;
        if (d.name) ctx.setTitle(`${d.name}  ·  ${ctx.sec.raw}`);
        ctx.el.innerHTML = "";
        ctx.el.append(
          html(
            `<div style="font-size:15px;margin-bottom:6px">Market now: <b class="amber">${esc(d.stateText || "—")}</b> <span class="dim">· ${esc(d.exchange || "")} ${esc(d.currency || "")}${d.delayMin ? ` · delayed ${d.delayMin} min` : ""}</span></div>`,
          ),
          html(
            `<table><tr><th></th><th>Price</th><th>Change</th><th>%</th><th>Time</th></tr>${row("Regular session", d.last, d.delayMin)}${row("Pre-market", d.pre, d.delayMin)}${row("After hours", d.post, d.delayMin)}</table>`,
          ),
          sect("Day"),
          kv([
            ["Bid", d.bid ? `${px(d.bid)} × ${num(d.bidSize, 0)}` : null],
            ["Ask", d.ask ? `${px(d.ask)} × ${num(d.askSize, 0)}` : null],
            ["Open", px(d.open)],
            [
              "Day range",
              d.low != null ? `${px(d.low)} to ${px(d.high)}` : null,
            ],
            ["Previous close", px(d.prevClose)],
            ["Volume", big(d.volume)],
            ["Average volume (3 months)", big(d.avgVolume)],
          ]),
          html(
            `<div class="hint">Pre-market runs 4:00 to 9:30 ET and after hours 16:00 to 20:00 ET. Each price keeps the time of its last trade, so outside a session you see the most recent one. Refreshes every 30 seconds. Next: <a href="#" data-c="DES">DES</a> · <a href="#" data-c="GIP">GIP intraday chart</a></div>`,
          ),
        );
        ctx.el.querySelector(".hint:last-child").onclick = (e) => {
          e.preventDefault();
          if (e.target.dataset.c) ctx.go(e.target.dataset.c);
        };
        ctx.setSource(d.source);
      };
      await load();
      ctx.every(30e3, () => load().catch(() => {}));
    },
  },
  {
    id: "FA",
    name: "Financial analysis",
    group: "Equities",
    needs: true,
    source:
      "Nasdaq financial statements (from company filings, in thousands of US dollars)",
    async render(ctx) {
      const freq = ctx.args[0] === "Q" ? "quarterly" : "annual";
      const d = await api.get(
        `/api/financials?symbol=${encodeURIComponent(ctx.sec.id)}&frequency=${freq}`,
      );
      if (!ctx.live()) return;
      const sheets = [
        ["Income statement", d.income],
        ["Balance sheet", d.balance],
        ["Cash flow", d.cashflow],
        ["Ratios", d.ratios],
      ].filter(([, t]) => t);
      let pick = sheets[0]?.[0];
      const draw = () => {
        ctx.el.innerHTML = "";
        const bar = html(
          `<div style="display:flex;gap:10px;flex-wrap:wrap"></div>`,
        );
        bar.append(
          tabs(
            sheets.map(([n]) => n),
            pick,
            (n) => {
              pick = n;
              draw();
            },
          ),
          tabs(
            ["ANNUAL", "QUARTERLY"],
            freq === "annual" ? "ANNUAL" : "QUARTERLY",
            (f) => ctx.go(`FA${f === "QUARTERLY" ? " Q" : ""}`),
          ),
        );
        ctx.el.append(bar);
        const t = sheets.find(([n]) => n === pick)?.[1];
        if (t)
          ctx.el.append(
            table(t.rows, [
              { key: "label", label: "", left: true, lbl: true },
              ...t.periods.map((p, i) => ({
                key: (r) => r.values[i],
                label: p,
              })),
            ]),
          );
        ctx.el.append(
          html(
            `<div class="hint">${esc(d.note || "")} ${d.nextEarnings ? `· ${esc(d.nextEarnings)}` : ""}</div>`,
          ),
        );
      };
      draw();
      ctx.setSource("Nasdaq financial statements");
    },
  },
  {
    id: "CN",
    name: "Company news",
    group: "News",
    needs: true,
    source: "Nasdaq news by symbol, plus public RSS",
    async render(ctx) {
      const load = async () => {
        const d = await api.get(
          `/api/news?symbol=${encodeURIComponent(ctx.sec.id)}`,
        );
        if (!ctx.live()) return;
        const items = d.items || d || [];
        ctx.el.innerHTML = `<div class="news"><ul>${
          items
            .slice(0, 60)
            .map(
              (n) =>
                `<li><span class="when">${esc(ago(n.time))}</span><span><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="srcn">${esc(n.source || "")}</span></span></li>`,
            )
            .join("") || `<li class="hint">No recent headlines.</li>`
        }</ul></div>`;
        ctx.setSource(d.note || "Nasdaq and public news feeds");
      };
      await load();
      ctx.every(120e3, load);
    },
  },
  {
    id: "GP",
    name: "Price graph",
    group: "Charts",
    needs: true,
    help: "Linien per BUY=150.20@2026-11-09 STOP=120.16 TRAIL=20 SRC=RSL (auch CHART/GRAPH/PRICE). Mehrere Lots kommagetrennt; Datum hinter @ ist optional. Ohne diese Parameter keine Overlay-Linien — GP sucht nicht selbst in den Holdings.",
    source:
      "Exchange and Yahoo price history (crypto live, stocks may be delayed). Optional overlays: BUY=/STOP=/TRAIL=/SRC= on the command (see HELP).",
    render: (ctx) =>
      chartScreen(
        ctx,
        ctx.args.find((a) =>
          Object.keys(RANGES).includes(a),
        ) || "1Y",
      ),
  },
  {
    id: "GIP",
    name: "Intraday price graph",
    group: "Charts",
    needs: true,
    source: "Exchange and Yahoo intraday bars",
    render: (ctx) => chartScreen(ctx, "1D", "line"),
  },
  {
    id: "HP",
    name: "Historical prices",
    group: "Charts",
    needs: true,
    source: "Daily bars from the same sources as GP",
    async render(ctx) {
      const tf = ctx.args[0] === "W" ? "1W" : ctx.args[0] === "M" ? "1M" : "1D";
      const res = await api.candles(ctx.sec.id, tf, 260);
      if (!ctx.live()) return;
      const rows = res.candles
        .slice()
        .reverse()
        .map((b, i, a) => ({
          ...b,
          chgPct: a[i + 1]
            ? ((b.close - a[i + 1].close) / a[i + 1].close) * 100
            : null,
        }));
      ctx.el.innerHTML = "";
      ctx.el.append(
        tabs(["D", "W", "M"], ctx.args[0] || "D", (t) => ctx.go(`HP ${t}`)),
      );
      ctx.el.append(
        table(rows, [
          { key: "time", label: "Date", left: true, lbl: true, fmt: date },
          { key: "open", label: "Open", fmt: px },
          { key: "high", label: "High", fmt: px },
          { key: "low", label: "Low", fmt: px },
          { key: "close", label: "Close", html: true, fmt: (v, r) => px(v) + (r === rows[0] ? delayTag(res) : "") },
          { key: "chgPct", label: "% chg", fmt: (v) => pct(v), cls },
          { key: "volume", label: "Volume", fmt: big },
        ]),
      );
      ctx.setSource(res.provider);
    },
  },
];
