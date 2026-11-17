#!/usr/bin/env node
// Russell 2000 roster for FVSCAN RUT: node scripts/update-rut.mjs
// Holdings of the State Street SPDR Russell 2000 U.S. Small Cap UCITS ETF (ZPRR, daily Excel file from ssga.com;
// iShares and Vanguard do not hand out their IWM/VTWO lists to scripts). The file has ISINs, not tickers:
// OpenFIGI (Bloomberg's free identifier mapping, no key: 25 requests a minute, 10 ISINs each) gives the US ticker.
// Only public ISINs are sent. Writes scripts/lib/rut-universe.json: {asOf, source, members: [{t, name, w, sector}]}.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipBuffer } from "../lib/unzip.js";

const URL = "https://www.ssga.com/library-content/products/fund-data/etfs/emea/holdings-daily-emea-en-zprr-gy.xlsx";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib", "rut-universe.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unxml = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Rows of the first sheet as arrays of cell texts (shared strings resolved). */
export function readSheet(dir) {
  const ss = [...fs.readFileSync(path.join(dir, "xl", "sharedStrings.xml"), "utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml(m[1]));
  const sheet = fs.readFileSync(path.join(dir, "xl", "worksheets", "sheet1.xml"), "utf8");
  const col = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const out = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(?:<v>([\s\S]*?)<\/v>)?/g)) out[col(c[1])] = /t="s"/.test(c[2]) ? ss[Number(c[3])] : c[3] ?? "";
    return out;
  });
}

async function main() {
  const res = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`ssga.com returned HTTP ${res.status}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rut-"));
  try {
    unzipBuffer(Buffer.from(await res.arrayBuffer()), tmp);
    const rows = readSheet(tmp);
    const asOf = rows.find((r) => r[0] === "Holdings As Of:")?.[1] || null;
    const head = rows.findIndex((r) => r[0] === "ISIN");
    const H = rows[head];
    const ix = (name) => H.indexOf(name);
    const holdings = rows.slice(head + 1)
      .filter((r) => /^US[A-Z0-9]{10}$|^[A-Z]{2}[A-Z0-9]{10}$/.test(r[ix("ISIN")] || "") && r[ix("Trade Country Name")] === "United States")
      .map((r) => ({ isin: r[ix("ISIN")], name: r[ix("Security Name")], w: Number(r[ix("Percent of Fund")]) || 0, sector: r[ix("Sector Classification")] || "" }));
    console.log(`${holdings.length} US holdings as of ${asOf}; mapping ISINs to tickers (about ${Math.ceil(holdings.length / 10 / 25)} minutes)…`);
    const members = [];
    const missing = [];
    for (let i = 0; i < holdings.length; i += 10) {
      const part = holdings.slice(i, i + 10);
      let j = null;
      for (let attempt = 0; attempt < 5 && !j; attempt++) {
        const r = await fetch("https://api.openfigi.com/v3/mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(part.map((h) => ({ idType: "ID_ISIN", idValue: h.isin, exchCode: "US" }))),
        });
        if (r.status === 429) { await sleep(15000); continue; }
        if (!r.ok) throw new Error(`OpenFIGI returned HTTP ${r.status}`);
        j = await r.json();
      }
      if (!j) throw new Error("OpenFIGI kept refusing (429)");
      part.forEach((h, k) => {
        const hit = (j[k]?.data || []).find((d) => d.marketSector === "Equity") || j[k]?.data?.[0];
        if (hit?.ticker) members.push({ t: hit.ticker.replace(/\//g, "-"), name: h.name, w: h.w, sector: h.sector });
        else missing.push(h.name);
      });
      process.stdout.write(`\r${Math.min(i + 10, holdings.length)} / ${holdings.length}`);
      await sleep(2500); // 25 requests a minute without a key
    }
    const uniq = [...new Map(members.map((m) => [m.t, m])).values()].sort((a, b) => b.w - a.w);
    fs.writeFileSync(OUT, `${JSON.stringify({ asOf, source: "State Street SPDR Russell 2000 U.S. Small Cap UCITS ETF (ZPRR) holdings; tickers via OpenFIGI", members: uniq }, null, 1)}\n`);
    console.log(`\nWrote ${uniq.length} members to ${path.relative(process.cwd(), OUT)}${missing.length ? `; no ticker for ${missing.length}: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}` : ""}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
