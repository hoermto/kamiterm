#!/usr/bin/env node
// Runs every test/*.test.js except the live-network suite, on Node 22.13 and up (no glob support needed).
// All tests run with QT_DATA_DIR pointing to a fresh temp dir, so the real data/ folder
// (settings, alerts, data/rsl-watchlist.json, the SQLite OHLCV cache …) is never read or written by the suite.
import { readdirSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const files = readdirSync(new URL("../test/", import.meta.url)).filter((f) => f.endsWith(".test.js") && f !== "live.test.js").map((f) => `test/${f}`);
const dataDir = mkdtempSync(join(tmpdir(), "qt-test-data-"));
// Temp folders the tests make themselves (os.tmpdir()) go inside the run folder too, so one rmSync
// at the end leaves nothing behind in the system temp folder.
const tmp = join(dataDir, "tmp");
mkdirSync(tmp);
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit", env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, QT_DATA_DIR: dataDir, QT_OHLCV_PATH: join(dataDir, "cache", "ohlcv.sqlite") } });
rmSync(dataDir, { recursive: true, force: true });
process.exit(r.status ?? 1);
