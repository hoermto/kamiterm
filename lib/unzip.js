// Minimal ZIP reader for the updater: unpacks a repo archive (GitHub / Gitea "Download ZIP") with Node's zlib,
// so updates need no unzip or tar on Linux and macOS. Handles stored and deflated entries, which is all
// git archives use; no ZIP64, no encryption.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;

export function unzipBuffer(buf, dest) {
  // End of central directory: last 22 bytes plus an optional comment (GitHub puts the commit id there).
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { e = i; break; }
  }
  if (e < 0) throw new Error("Not a ZIP file");
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const root = path.resolve(dest);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error("Broken ZIP directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const extAttr = buf.readUInt32LE(p + 38);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const out = path.resolve(root, name);
    if (out !== root && !out.startsWith(root + path.sep)) throw new Error(`Unsafe path in ZIP: ${name}`);
    if (name.endsWith("/")) { fs.mkdirSync(out, { recursive: true }); continue; }
    if (buf.readUInt32LE(local) !== LOC) throw new Error(`Broken ZIP entry: ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error(`Unsupported ZIP compression ${method}: ${name}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // Symlinks in an archive are written as plain files (none in this repo); keep the executable bit on Unix.
    const mode = (extAttr >>> 16) & 0o777;
    fs.writeFileSync(out, data, mode && process.platform !== "win32" ? { mode } : undefined);
    files.push(name);
  }
  return files;
}
