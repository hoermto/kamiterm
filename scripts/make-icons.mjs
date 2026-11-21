// Builds the app icons from public/icon.svg (development tool, run again after changing the SVG):
//   public/favicon.ico      16, 24, 32, 48, 64, 128, 256 px (browser tab, Windows shortcut and folder icon)
//   public/icon-192.png, public/icon-512.png   (app window / manifest)
// Renders with a local headless Chrome or Edge over the DevTools protocol; no packages needed.
//   node scripts/make-icons.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const svg = fs.readFileSync(path.join(PUB, "icon.svg"), "utf8");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZES = [192, 512];

const browsers = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p) => p && fs.existsSync(p));
if (!browsers.length) throw new Error("No Chrome or Edge found (set CHROME=path).");

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "amber-icons-"));
const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(browsers[0], ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let tabs;
  for (let i = 0; i < 40 && !tabs; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); }
  }
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d.result); pend.delete(d.id); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const render = async (size) => {
    await send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const page = `<html><body style="margin:0;background:transparent"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`;
    await send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(page).toString("base64")}` });
    await sleep(300);
    const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    return Buffer.from(shot.data, "base64");
  };

  const icoImages = [];
  for (const s of ICO_SIZES) icoImages.push({ s, png: await render(s) });
  for (const s of PNG_SIZES) fs.writeFileSync(path.join(PUB, `icon-${s}.png`), await render(s));
  ws.close();

  // ICO with PNG images inside (Windows Vista and later, all browsers).
  const head = Buffer.alloc(6 + 16 * icoImages.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(icoImages.length, 4);
  let offset = head.length;
  icoImages.forEach(({ s, png }, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, o);
    head.writeUInt8(s >= 256 ? 0 : s, o + 1);
    head.writeUInt16LE(1, o + 4); // planes
    head.writeUInt16LE(32, o + 6); // bits per pixel
    head.writeUInt32LE(png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(PUB, "favicon.ico"), Buffer.concat([head, ...icoImages.map((x) => x.png)]));
  console.log(`favicon.ico (${ICO_SIZES.join(", ")} px), ${PNG_SIZES.map((s) => `icon-${s}.png`).join(", ")} written to public/`);
} finally {
  proc.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still locked: temp folder */ }
}
