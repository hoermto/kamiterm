// Rang Entry: which week close a buy is based on (lib/fn/rsl26.js entryWeekClose).
import { test } from "node:test";
import assert from "node:assert/strict";
import { entryWeekClose } from "../lib/fn/rsl26.js";

test("a buy Monday to Thursday is based on the Friday before", () => {
  assert.equal(entryWeekClose("2026-11-23"), "2026-11-20"); // Mo
  assert.equal(entryWeekClose("2026-11-26"), "2026-11-20"); // Do
});

test("a buy Friday to Sunday is based on that Friday's close", () => {
  assert.equal(entryWeekClose("2026-11-20"), "2026-11-20"); // Fr
  assert.equal(entryWeekClose("2026-11-21"), "2026-11-20"); // Sa
  assert.equal(entryWeekClose("2026-11-22"), "2026-11-20"); // So
});

test("an invalid date gives no entry week", () => {
  assert.equal(entryWeekClose("kein Datum"), null);
});
