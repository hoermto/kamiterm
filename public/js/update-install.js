// "Install & restart": asks the server to install the update found by its check (POST /api/update/install). The
// server hands over to scripts/update.js --apply --restart, which stops it, installs, and starts the new version
// on the same port. This page waits until /api/health answers with a new process id, then reloads itself.
// Used by the update popup and badge (app.js) and by SETTINGS > Updates.
import { api } from "./api.js";

let busy = false;

// say(text, isError, ms): how to show progress (the app's toast).
export async function installUpdate(say) {
  if (busy) return;
  busy = true;
  let before;
  try {
    const r = await api.post("/api/update/install");
    before = r.pid;
    const v = r.status?.remoteVersion ? ` v${r.status.remoteVersion}` : "";
    say(`Installing the update${v} … the terminal restarts by itself and this page reloads.`, false, 600e3);
  } catch (e) {
    busy = false;
    say(`Update not installed: ${e.message}`, true, 10e3);
    return;
  }
  const until = Date.now() + 5 * 60e3;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const h = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(3000) }).then((r) => r.json());
      if (h?.pid && h.pid !== before) { location.reload(); return; }
    } catch { /* restarting */ }
  }
  busy = false;
  say("The restart did not finish within 5 minutes. See data/update.log, or run start.bat.", true, 30e3);
}
