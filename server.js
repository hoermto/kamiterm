#!/usr/bin/env node
// Amber Terminal server. Node 22.13+ (built-in SQLite) and nothing else: no npm install, no build step.
//   node server.js            start on http://localhost:3787 (or the next free port)
//   node server.js --open     start and open your browser
//   PORT=4000 node server.js  pick a port

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as data from "./lib/providers.js";
import * as feeds from "./lib/feeds.js";
import * as alerts from "./lib/alerts.js";
import * as store from "./lib/store.js";
import * as toolSettings from "./lib/tool-settings.js";
import * as secContact from "./lib/sec-contact.js";
import * as eventsCache from "./lib/events-cache.js";
import * as rslEvalJobs from "./lib/rsl-eval-jobs.js";
import * as ptq from "./lib/ptq.js";
import * as info from "./lib/market-info.js";
import * as bbg from "./lib/bloomberg-fields.js";
import { yahooQuotes } from "./lib/fn/board.js";
import * as rslWatch from "./lib/rsl-watchlist.js";
import * as updater from "./lib/updater.js";
import { windowWatch } from "./lib/window-watch.js";
import { registerIndicator } from "./public/lib/indicators.js";
import { conditionFn } from "./public/lib/backtest.js";
import { relaunchForProxy, proxyNote } from "./lib/proxy.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const CUSTOM = path.join(ROOT, "custom");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version;
const HOST = process.env.HOST || "127.0.0.1";
const START_PORT = Number(process.env.PORT) || 3787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// ---------- helpers ----------
const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, headers = {}) {
  const isStr = typeof body === "string" || Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isStr ? "text/plain; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(isStr ? body : JSON.stringify(body));
}

async function readBody(req, limit = 2e6) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit)
      throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw httpError(400, "The request body isn't valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw httpError(400, "The request body must be a JSON object");
  return body;
}

// The server only answers to this machine's browser. Writes need a custom header, which a random
// website can't add to a cross-site request, so other pages can't drive your terminal.
function allowed(req) {
  const host = (req.headers.host || "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "");
  const extraHosts = (process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const okHosts = new Set(["localhost", "127.0.0.1", "::1", ...lanAddresses(), ...extraHosts]);
  const remote = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const fromLoopback = remote === "127.0.0.1" || remote === "::1";
  // Loopback (incl. a local reverse-proxy/tunnel) may use an external Host header.
  if (!okHosts.has(host) && !fromLoopback) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.headers["x-qt"] !== "1") return false;
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return false;
      } catch {
        return false; // "null" and other opaque origins
      }
    }
  }
  return true;
}

function lanAddresses() {
  if (HOST === "127.0.0.1" || HOST === "localhost") return [];
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .map((i) => i.address);
}

function serveStatic(res, baseDir, rel) {
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir + path.sep)) return send(res, 403, "Forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": rel.startsWith("vendor/")
        ? "public, max-age=86400"
        : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- custom indicators (your own "Pine scripts", as plain JS files in /custom) ----------
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "indicator";
const customErrors = {};

function listCustom() {
  fs.mkdirSync(CUSTOM, { recursive: true });
  return fs
    .readdirSync(CUSTOM)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({
      file: f,
      id: `custom:${f.replace(/\.js$/, "")}`,
      mtime: fs.statSync(path.join(CUSTOM, f)).mtimeMs,
      error: customErrors[f] || null,
    }));
}

async function loadCustom(file) {
  try {
    const full = path.join(CUSTOM, file);
    const mod = await import(
      `${pathToFileURL(full).href}?v=${fs.statSync(full).mtimeMs}`
    );
    registerIndicator({
      ...mod.default,
      id: `custom:${file.replace(/\.js$/, "")}`,
    });
    delete customErrors[file];
  } catch (e) {
    customErrors[file] = e.message;
  }
}

// ---------- server-sent events (alerts pop up in the browser) ----------
const clients = new Set();
function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}
alerts.onFire((e) => broadcast("alert", e));
let updateStatus = null;
// Closing the app window quits: see lib/window-watch.js (AMBER_CLOSE_GRACE_MS, default 20 s).
const windowGraceMs = Number(process.env.AMBER_CLOSE_GRACE_MS) || 20e3;
const streams = new Map(); // event-stream id (from the page) -> { res, release }
const windows = windowWatch({
  graceMs: windowGraceMs,
  onIdle: () => {
    console.log("\n  Last window closed: stopping.");
    process.exit(0);
  },
});
setInterval(() => {
  for (const res of clients) res.write(": keep-alive\n\n");
}, 25000).unref();

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// ---------- routes ----------
async function handle(req, res) {
  if (!allowed(req))
    return send(
      res,
      403,
      "Forbidden: Amber Terminal only answers to this computer.",
    );
  const url = new URL(req.url, "http://localhost");
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad URL");
  }
  const q = Object.fromEntries(url.searchParams);

  if (!p.startsWith("/api/")) {
    if (p === "/" || p === "/index.html")
      return serveStatic(res, PUBLIC, "index.html");
    if (p.startsWith("/custom/")) return serveStatic(res, CUSTOM, p.slice(8));
    return serveStatic(res, PUBLIC, p.slice(1));
  }

  try {
    if (p === "/api/health") {
      return send(res, 200, {
        ok: true,
        app: "amber-terminal",
        root: ROOT,
        version: VERSION,
        node: process.version,
        platform: process.platform,
        providers: data.health,
        feeds: feeds.configured(),
        yahoo: data.yahooAvailable() ? "available" : "rate limited",
        alerts: alerts.list().filter((a) => a.active).length,
      });
    }
    if (p === "/api/probe") return send(res, 200, await data.probeAll());
    if (p === "/api/resolve")
      return send(res, 200, await data.resolve(q.symbol));
    if (p === "/api/search") return send(res, 200, await data.search(q.q));
    if (p === "/api/spread") return send(res, 200, await data.getSpread(q.symbol));
    if (p === "/api/candles") {
      const c = await data.getCandles(q.symbol, q.tf || "1D", q.limit);
      // A Yahoo chart carries the delay Yahoo states for its symbol, so the screen can label the last price.
      const y = c.yahoo && (await yahooQuotes([c.yahoo], 10 * 60e3).catch(() => ({})))[c.yahoo];
      return send(res, 200, y ? { ...c, delayMin: y.delayMin } : c);
    }
    if (p === "/api/quotes")
      return send(
        res,
        200,
        await data.getQuotes(
          (q.symbols || "").split(",").filter(Boolean).slice(0, 200),
        ),
      );
    if (p === "/api/calendar")
      return send(res, 200, await data.economicCalendar());
    if (p === "/api/earnings") return send(res, 200, await info.earnings(Number(q.days) || 5));
    if (p === "/api/dividends") return send(res, 200, await info.dividends(Number(q.days) || 5));
    if (p === "/api/news") return send(res, 200, await info.news(q.symbol));
    if (p === "/api/financials") return send(res, 200, await info.financials(q.symbol, q.frequency));
    if (p === "/api/screener") {
      const u = q.universe || "crypto";
      const rows =
        u === "crypto"
          ? await data.cryptoScreener()
          : await data.nasdaqScreener(u === "etf" ? "etf" : "stocks");
      return send(res, 200, rows);
    }
    if (p === "/api/scan" && req.method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.symbols) || !Array.isArray(body.rules ?? []))
        throw httpError(400, "Send { symbols: [...], rules: [...] }");
      const symbols = body.symbols.slice(0, 150);
      const rules = body.rules || [];
      const results = await mapLimit(symbols, 4, async (symbol) => {
        try {
          const { candles } = await data.getCandles(
            symbol,
            body.tf || "1D",
            400,
          );
          const make = conditionFn(candles, body.indicators || {});
          const i = candles.length - 1;
          const passes = rules.map((r) => make(r)(i));
          return {
            symbol,
            pass: passes.every(Boolean),
            passes,
            close: candles[i].close,
          };
        } catch (e) {
          return { symbol, error: e.message };
        }
      });
      return send(res, 200, results);
    }

    if (p === "/api/settings/profiles") {
      const tool = q.tool || "RSL26";
      if (req.method === "GET") return send(res, 200, { tool, profiles: toolSettings.listProfiles(tool) });
      const body = await readBody(req);
      const t = body.tool || tool;
      if (req.method === "DELETE" || body.action === "delete" || body.delete) {
        const id = body.id || q.id;
        if (!id) throw httpError(400, "id required");
        return send(res, 200, toolSettings.deleteProfile(t, id));
      }
      const profile = toolSettings.saveProfile(t, body.profile || body);
      return send(res, 200, { ok: true, profile, profiles: toolSettings.listProfiles(t) });
    }
    if (p === "/api/settings") {
      if (req.method === "GET") {
        const tool = q.tool;
        if (tool) return send(res, 200, { tool, settings: toolSettings.getTool(tool), defaults: toolSettings.TOOL_DEFAULTS[tool] || {} });
        return send(res, 200, toolSettings.loadAll());
      }
      if (req.method === "PUT" || req.method === "POST") {
        const body = await readBody(req);
        const tool = body.tool || q.tool;
        if (!tool) throw httpError(400, "tool required");
        if (body.reset) return send(res, 200, { ok: true, settings: toolSettings.resetTool(tool), defaults: toolSettings.TOOL_DEFAULTS[tool] || {} });
        const settings = toolSettings.saveTool(tool, body.settings || body.patch || body);
        return send(res, 200, { ok: true, settings, defaults: toolSettings.TOOL_DEFAULTS[tool] || {} });
      }
    }


    if (p === "/api/rsl-eval/jobs" || p.startsWith("/api/rsl-eval/job")) {
      if (req.method === "GET") {
        const id = q.id || (p.startsWith("/api/rsl-eval/job/") ? p.slice("/api/rsl-eval/job/".length) : null);
        if (id) {
          const job = rslEvalJobs.readJob(id);
          if (!job) throw httpError(404, "job not found");
          const result = job.status === "done" ? rslEvalJobs.loadJobResult(id) : null;
          return send(res, 200, { job, result: result ? { stats: result.stats, yearly: result.yearly, tradeLogRows: result.tradeLog?.length, equityPoints: result.equity?.length } : null, backtest: q.full === "1" ? result : undefined });
        }
        return send(res, 200, { jobs: rslEvalJobs.listJobs(Number(q.limit) || 20) });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const job = rslEvalJobs.startWalkForwardJob(body || {});
        return send(res, 200, { ok: true, job });
      }
    }

    if (p === "/api/state") {
      if (req.method === "GET") return send(res, 200, store.read("state", {}));
      if (req.method === "PUT") {
        const patch = await readBody(req, 20e6);
        const next = { ...store.read("state", {}), ...patch };
        store.write("state", next);
        return send(res, 200, { ok: true });
      }
    }
    if (p === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 3000\n\n");
      clients.add(res);
      const app = q.app === "1";
      windows.connect({ app });
      console.log(`  ${new Date().toISOString()} window connected${app ? " (app window)" : ""} · open ${windows.state.open}`);
      // A comment line every 15 s: proxies keep the stream open, and a vanished window is noticed.
      const ping = setInterval(() => res.write(": ping\n\n"), 15e3);
      // Ends once, whether the connection drops or the page says goodbye (POST /api/events/bye): a browser
      // can keep the connection of a closed window open for a while.
      let gone = false;
      const release = (why) => {
        if (gone) return;
        gone = true;
        clearInterval(ping);
        clients.delete(res);
        if (q.id) streams.delete(q.id);
        windows.disconnect();
        const st = windows.state;
        console.log(`  ${new Date().toISOString()} window ${why} · open ${st.open}${st.pending ? ` · stopping in ${Math.round(windowGraceMs / 1000)} s unless a window comes back` : ""}`);
      };
      if (q.id) streams.set(q.id, { res, release });
      req.on("close", () => release("disconnected"));
      return;
    }
    if (p === "/api/events/bye" && req.method === "POST") {
      const s = streams.get(q.id || "");
      if (s) { s.release("closed"); try { s.res.end(); } catch { /* already gone */ } }
      return send(res, 200, { ok: true });
    }
    if (p === "/api/alerts") {
      if (req.method === "GET") return send(res, 200, alerts.list());
      if (req.method === "POST")
        return send(res, 200, alerts.add(await readBody(req)));
    }
    if (p === "/api/alerts/log") return send(res, 200, alerts.history());
    if (p === "/api/alerts/check" && req.method === "POST") {
      await alerts.evaluate();
      return send(res, 200, { ok: true });
    }
    if (p.startsWith("/api/alerts/")) {
      const id = p.split("/")[3];
      if (req.method === "DELETE") {
        alerts.remove(id);
        return send(res, 200, { ok: true });
      }
      if (req.method === "PATCH")
        return send(res, 200, alerts.update(id, await readBody(req)));
    }
    if (p === "/api/webhook-test" && req.method === "POST") {
      const { url: hook } = await readBody(req);
      if (!/^https?:\/\/[^\s]+$/i.test(String(hook || "")))
        throw httpError(400, "Webhook must be an http(s) URL");
      const r = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Amber Terminal test alert",
          content: "Amber Terminal test alert",
        }),
        signal: AbortSignal.timeout(10000),
      });
      return send(res, 200, { ok: r.ok, status: r.status });
    }
    if (p === "/api/custom") {
      if (req.method === "GET") return send(res, 200, listCustom());
      if (req.method === "POST") {
        const { name, code } = await readBody(req);
        if (!code || !/export\s+default/.test(code))
          throw Object.assign(
            new Error(
              "The file must `export default { name, calc(bars, params, ta) { ... } }`",
            ),
            { status: 400 },
          );
        const file = `${slug(name)}.js`;
        fs.mkdirSync(CUSTOM, { recursive: true });
        fs.writeFileSync(path.join(CUSTOM, file), code);
        await loadCustom(file);
        return send(
          res,
          customErrors[file] ? 400 : 200,
          customErrors[file]
            ? { error: customErrors[file], file }
            : { ok: true, file, id: `custom:${file.replace(/\.js$/, "")}` },
        );
      }
    }
    if (p.startsWith("/api/custom/") && req.method === "DELETE") {
      const file = path.basename(p.slice(12));
      fs.rmSync(path.join(CUSTOM, file), { force: true });
      return send(res, 200, { ok: true });
    }
    // Update status (daily check against the git repo, see lib/updater.js); POST .../check checks now.
    if (p === "/api/update") return send(res, 200, updateStatus || updater.loadStatus() || { state: "unknown" });
    if (p === "/api/update/check" && req.method === "POST") {
      const last = Date.parse((updateStatus || updater.loadStatus())?.checkedAt || 0) || 0;
      if (Date.now() - last > 60e3) {
        updateStatus = await updater.check();
        broadcast("update", updateStatus);
      }
      return send(res, 200, updateStatus || updater.loadStatus());
    }
    // SETTINGS > Updates: where updates come from (data/launcher.cfg REPO_URL / BRANCH). Saving checks at once.
    if (p === "/api/events-cache") {
      // Event cache (data/cache/events.sqlite): size for SETTINGS; POST {clear:true} empties it.
      if (req.method === "POST") {
        const body = await readBody(req, 1e3);
        if (body.clear) return send(res, 200, eventsCache.clearCache());
      }
      if (req.method === "GET") return send(res, 200, eventsCache.cacheStats());
    }
    if (p === "/api/sec/contact") {
      // Contact email for SEC EDGAR requests (SETTINGS > Data sources); stays in data/settings.json.
      if (req.method === "PUT") {
        const body = await readBody(req, 1e4);
        secContact.saveContact(body.contact);
      }
      if (req.method === "GET" || req.method === "PUT") return send(res, 200, { contact: secContact.getContact() });
    }
    if (p === "/api/update/config") {
      const view = () => {
        const c = updater.readConfig();
        return {
          repoUrl: c.repoUrl, repoFrom: c.repoFrom, branch: c.branch, branchFrom: c.branchFrom,
          defaultRepoUrl: updater.DEFAULT_REPO_URL, defaultBranch: updater.DEFAULT_BRANCH,
          gitCheckout: fs.existsSync(path.join(updater.ROOT, ".git")),
          status: updateStatus || updater.loadStatus(),
        };
      };
      if (req.method === "GET") return send(res, 200, view());
      if (req.method === "PUT") {
        const body = await readBody(req, 1e4);
        const next = { repoUrl: String(body.repoUrl ?? "").trim(), branch: String(body.branch ?? "").trim() };
        const err = updater.validateConfig(next);
        if (err) return send(res, 400, { error: err });
        updater.saveConfig(next);
        updateStatus = await updater.check();
        broadcast("update", updateStatus);
        return send(res, 200, view());
      }
    }
    if (p === "/api/shutdown" && req.method === "POST") {
      // Lets the installer stop a running copy before updating it, on any OS.
      send(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 100);
      return;
    }
    // PTQ connector: reads and fail-safe controls only. There is no route here that arms a
    // strategy or places an order; that stays inside PTQ (`ptq arm-strategy`).
    if (p === "/api/ptq/status") return send(res, 200, await ptq.status());
    if (p === "/api/ptq/overview") return send(res, 200, await ptq.overview());
    if (p === "/api/ptq/check" && req.method === "POST") {
      try {
        return send(res, 200, await ptq.check(await readBody(req)));
      } catch (e) {
        return send(res, e.status || 502, { error: e.message, code: e.code, problems: e.problems || [], notes: e.notes || [] });
      }
    }
    if (p === "/api/ptq/kill-switch" && req.method === "POST") return send(res, 200, await ptq.engageKillSwitch());
    const disarmMatch = /^\/api\/ptq\/arms\/([^/]+)\/disarm$/.exec(p);
    if (disarmMatch && req.method === "POST") return send(res, 200, await ptq.disarm(decodeURIComponent(disarmMatch[1])));
    // Bloomberg's Excel functions as URLs, for Excel (Data > From Web), pandas.read_csv and scripts. Read-only GETs,
    // so no app header is needed; the server still only answers to this computer.
    if (p === "/api/about")
      return send(res, 200, {
        app: "amber-terminal",
        dir: ROOT,
        port: req.socket.localPort,
        version: VERSION,
        mcp: bbg.mcpCommand(ROOT),
        fields: { bdp: bbg.BDP_FIELDS, bdh: bbg.BDH_FIELDS },
      });
    if (p === "/api/bdp" || p === "/api/bdh") {
      const out = p === "/api/bdp" ? await bbg.bdp(q) : await bbg.bdh(q);
      if (String(q.format || "").toLowerCase() === "csv")
        return send(res, 200, bbg.csvOf(out), { "Content-Type": "text/csv; charset=utf-8" });
      return send(res, 200, out);
    }
    // RSL user positions book (Kauf/Verkauf); JSON under data/rsl-watchlist.json
    if (p === "/api/rsl-watch") {
      if (req.method === "GET") {
        const book = rslWatch.loadBook();
        return send(res, 200, {
          book,
          open: rslWatch.openPositions(book),
          sold: rslWatch.closedPositions(book, 30),
          dateMode: "UTC (YYYY-MM-DD)",
        });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        const action = String(body.action || body.op || "").toUpperCase();
        // ADD|BUY, EDIT (id), SELL, DELETE, REOPEN
        const r = rslWatch.applyAction(action, body);
        const book = rslWatch.loadBook();
        return send(res, 200, {
          ...r,
          open: rslWatch.openPositions(book),
          sold: rslWatch.closedPositions(book, 30),
        });
      }
    }
    // Terminal functions: /api/fn/<name> runs lib/fn/<name>.js, one file per data source.

    const fm = /^\/api\/fn\/([a-z0-9-]{1,40})$/.exec(p);
    if (fm) {
      const mod = await loadFn(fm[1]);
      if (!mod) throw httpError(404, `No terminal function called ${fm[1]}`);
      return send(res, 200, await mod.default(q));
    }
    return send(res, 404, { error: "Unknown endpoint" });
  } catch (e) {
    // Upstream failures are a bad gateway, whatever status the provider used.
    const code = e.upstream ? 502 : e.status >= 400 && e.status < 600 ? e.status : 500;
    return send(res, code, { error: e.message });
  }
}

const fnCache = new Map();
async function loadFn(name) {
  if (!fnCache.has(name)) {
    const file = path.join(ROOT, "lib", "fn", `${name}.js`);
    fnCache.set(name, fs.existsSync(file) ? await import(pathToFileURL(file).href) : null);
  }
  return fnCache.get(name);
}

// ---------- start ----------
function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* no desktop: the URL is printed anyway */
  }
}

// Ports that browsers and Node's fetch refuse to connect to (Fetch spec "bad ports" above 1023):
// a server there would run but nobody could open it, so they are skipped.
const BAD_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

export function start(port = START_PORT, tries = 20) {
  if (port && BAD_PORTS.has(port)) return start(port + 1, tries);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        if (!res.headersSent) send(res, 500, { error: e.message });
      });
    });
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE" && tries > 0)
        resolve(start(port + 1, tries - 1));
      else reject(e);
    });
    server.listen(port, HOST, () => resolve({ server, port }));
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const relaunched = isMain ? relaunchForProxy() : null;
if (relaunched) process.exit(await relaunched);
if (isMain) {
  for (const c of listCustom()) await loadCustom(c.file);
  const { port } = await start();
  const url = `http://localhost:${port}`;
  alerts.start();
  // Daily update check (AMBER_UPDATE_CHECK=0 turns it off); a newer version shows as a warning in the top bar.
  if (process.env.AMBER_UPDATE_CHECK !== "0")
    updater.schedule({ onChange: (st) => { updateStatus = st; broadcast("update", st); } });
  console.log(
    `\n  Amber Terminal ${VERSION} is running\n\n  Open:  ${url}\n  Stop:  Ctrl+C\n  Data:  ${store.DATA_DIR}\n`,
  );
  if (proxyNote()) console.log(`  ${proxyNote()}\n`);
  if (HOST !== "127.0.0.1" && HOST !== "localhost")
    console.log(
      `  Also on your network: ${lanAddresses()
        .filter((a) => a.includes(".") && a !== "127.0.0.1")
        .map((a) => `http://${a}:${port}`)
        .join("  ")}\n`,
    );
  if ((process.argv.includes("--open") || process.env.QT_OPEN === "1") && process.env.QT_NO_OPEN !== "1")
    openBrowser(url);
  const bye = () => {
    console.log("\n  Stopped.");
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}
