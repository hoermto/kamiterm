import "./helpers/isolate-data.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { changes, members, heatUniverse, cleanName, PERIOD_BARS } from "../lib/fn/heat.js";

const DAY = 86400;
// Weekday closes from 2025-01-02, rising by 1 a day from 100.
function bars(n) {
  const out = [];
  let t = Date.UTC(2025, 0, 2) / 1000;
  while (out.length < n) {
    const wd = new Date(t * 1000).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ time: t, open: 100 + out.length, close: 100 + out.length });
    t += DAY;
  }
  return out;
}

test("changes: each period against the close that many bars back, YTD against the last close of last year", () => {
  const b = bars(300);
  const last = b.at(-1).close;
  const c = changes(b);
  for (const [p, k] of Object.entries(PERIOD_BARS)) assert.ok(Math.abs(c[p] - (last / b.at(-1 - k).close - 1) * 100) < 1e-9, p);
  const year = new Date(b.at(-1).time * 1000).getUTCFullYear();
  const prev = b.findLast((x) => new Date(x.time * 1000).getUTCFullYear() < year);
  assert.ok(Math.abs(c.YTD - (last / prev.close - 1) * 100) < 1e-9);
});

test("changes: too short a history gives null, not a wrong number", () => {
  const c = changes(bars(10));
  assert.equal(c["1M"], null);
  assert.equal(c["1Y"], null);
  assert.equal(c.YTD, null); // all bars in 2025, no close of the year before
  assert.ok(c["1D"] > 0);
  assert.deepEqual(changes([]), {});
});

test("universes and aliases", () => {
  assert.equal(heatUniverse(), "SPX");
  assert.equal(heatUniverse("nasdaq"), "NDX");
  assert.equal(heatUniverse("STOXX600"), "SXXP");
  assert.equal(heatUniverse("DAX40"), "DAX");
  assert.throws(() => heatUniverse("FTSE"), (e) => e.status === 400);
});

test("members: S&P by sector, NDX outsiders in OTHER, STOXX 600 by country with weights", () => {
  const spx = members("SPX");
  assert.ok(spx.stocks.length > 490);
  assert.ok(spx.stocks.every((s) => s.group));
  assert.equal(spx.stocks.find((s) => s.t === "AAPL").group, "XLK");
  assert.equal(spx.groups.length, 11);
  const ndx = members("NDX");
  assert.equal(ndx.stocks.find((s) => s.t === "ASML").group, "OTHER");
  assert.equal(ndx.stocks.find((s) => s.t === "MSFT").group, "XLK");
  const sx = members("SXXP");
  assert.ok(sx.stocks.length > 590);
  assert.ok(sx.stocks.every((s) => s.weight > 0 || s.weight === 0));
  assert.ok(sx.groups.some((g) => g.key === "Germany"));
  assert.equal(members("DAX").stocks.length, 40);
});

test("cleanName drops Yahoo's padding", () => {
  assert.equal(cleanName("SAP SE                        I"), "SAP SE");
  assert.equal(cleanName("Apple Inc."), "Apple Inc.");
  assert.equal(cleanName(null), "");
});
