import "./helpers/isolate-data.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRefresh, sessionState, setRefreshMinutes, getRefreshMs, isEuSymbol } from "../lib/ohlcv-cache.js";
import * as live from "../lib/ohlc-live.js";

// Wed 19 Nov 2026: 10:00 in New York = 16:00 in Berlin; 08:00 New York = 14:00 Berlin; 12:00 New York = 18:00 Berlin
const at = (utc) => new Date(utc);
const NY10 = at("2026-11-19T15:00:00Z");
const NY08 = at("2026-11-19T13:00:00Z");
const NY12 = at("2026-11-19T17:00:00Z");
const SAT = at("2026-11-21T15:00:00Z");

test("OHLC: market session per symbol (US on New York hours, Europe on Berlin hours, others no intraday refresh)", () => {
  assert.equal(sessionState("AAPL", NY10).open, true);
  assert.equal(sessionState("AAPL", NY08).open, false);
  assert.equal(sessionState("SAP.DE", NY08).open, true); // 14:00 Berlin, New York not open yet
  assert.equal(sessionState("VOD.L", NY12).open, false); // 18:00 Berlin
  assert.equal(sessionState("VOD.L", at("2026-11-19T16:50:00Z")).justClosed, true); // 17:50 Berlin
  assert.equal(sessionState("7203.T", NY10).open, false);
  assert.equal(sessionState("EURUSD=X", NY10).open, true);
  assert.equal(sessionState("AAPL", SAT).open, false);
  assert.ok(isEuSymbol("ASML.AS") && !isEuSymbol("BF-B"));
});

test("OHLC: the refresh interval is a setting (5–60 minutes) and European stocks refresh in their own hours", () => {
  try {
    assert.equal(setRefreshMinutes(3), 5);
    assert.equal(setRefreshMinutes(90), 60);
    assert.equal(setRefreshMinutes(10), 10);
    assert.equal(getRefreshMs(), 10 * 60e3);
    const today = Math.floor(NY08.getTime() / 86400e3) * 86400;
    const bars = [{ time: today, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
    const meta = { lastFetch: NY08.getTime() - 12 * 60e3 }; // 12 minutes old
    assert.equal(needsRefresh(meta, bars, NY08.getTime(), { symbol: "SAP.DE" }).refresh, true);
    assert.equal(needsRefresh(meta, bars, NY08.getTime(), { symbol: "AAPL" }).refresh, false); // New York closed
    assert.equal(needsRefresh({ lastFetch: NY08.getTime() - 8 * 60e3 }, bars, NY08.getTime(), { symbol: "SAP.DE" }).refresh, false);
  } finally {
    setRefreshMinutes(15);
  }
});

test("OHLC live: followed screens get a pass per interval; the version rises only when bars changed", async () => {
  live._test.reset();
  assert.equal(live.register("fvscan:TEST", ["AAPL", "MSFT", "SAP.DE", "7203.T"]), 1);
  assert.deepEqual(live.follow(["fvscan:TEST", "gone"]), { "fvscan:TEST": 1, gone: null });
  const k = live._test.keys.get("fvscan:TEST");
  const now = NY10.getTime(); // New York 10:00, Berlin 16:00: both open, Tokyo not
  k.seen = now;
  k.lastPass = now - 5 * 60e3;
  assert.equal(live.due(now).length, 0, "interval not over");
  k.lastPass = now - 16 * 60e3;
  const [d] = live.due(now);
  assert.deepEqual(d.live, ["AAPL", "MSFT", "SAP.DE"]);
  k.seen = now - 4 * 60e3;
  assert.equal(live.due(now).length, 0, "screen no longer on view");
  k.seen = now;
  // nothing changed: no new version, no event
  const asked = [];
  let events = 0;
  live.start(() => events++);
  await live._test.pass(d, async (t) => { asked.push(t); return { fetched: true, changed: false }; });
  assert.deepEqual(asked.sort(), ["AAPL", "MSFT", "SAP.DE"]);
  assert.equal(k.version, 1);
  assert.equal(events, 0);
  // one stock with a new bar: version 2, one event
  await live._test.pass(d, async (t) => ({ fetched: true, changed: t === "MSFT" }));
  assert.equal(k.version, 2);
  assert.equal(events, 1);
  assert.equal(live.follow(["fvscan:TEST"])["fvscan:TEST"], 2);
  // a failing fetch does not stop the pass
  await live._test.pass(d, async (t) => { if (t === "AAPL") throw new Error("busy"); return { fetched: true, changed: t === "SAP.DE" }; });
  assert.equal(k.version, 3);
});

test("OHLC live: the setting is saved and checked", () => {
  assert.equal(live.saveSetting(20), 20);
  assert.equal(live.refreshMinutes(), 20);
  assert.throws(() => live.saveSetting(2), /5 to 60/);
  assert.throws(() => live.saveSetting("x"), /5 to 60/);
  assert.equal(live.saveSetting(15), 15);
});
