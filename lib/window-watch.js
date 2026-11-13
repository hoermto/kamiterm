// "Closing the window quits the app": the window opened by start.bat / launch.js connects its event stream with
// ?app=1. From then on, when no window or tab is connected any more for `graceMs` (long enough for a reload),
// the server stops. A server that never saw an app window (plain browser use) keeps running as before.
export function windowWatch({ graceMs = 20e3, onIdle }) {
  let armed = false;
  let open = 0;
  let timer = null;
  const disarm = () => { clearTimeout(timer); timer = null; };
  return {
    connect({ app = false } = {}) {
      if (app) armed = true;
      open++;
      disarm();
    },
    disconnect() {
      open = Math.max(0, open - 1);
      if (!armed || open > 0 || timer) return;
      timer = setTimeout(() => { timer = null; if (open === 0) onIdle(); }, graceMs);
      timer.unref?.();
    },
    get state() { return { armed, open, pending: !!timer }; },
  };
}
