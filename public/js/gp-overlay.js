// GP overlay from command parameters only. GP itself does not look up RSL (or any other book).
//   GP AAPL BUY=150.20@2026-11-09 STOP=120.16 TRAIL=20 SRC=RSL
// BUY/STOP may list several values, comma-separated (decimal point). Date after @ is optional (no date → line, no marker).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = { BUY: 'buy', STOP: 'stop', TRAIL: 'trail', SRC: 'src', SOURCE: 'src' };

export function dePrice(v, d = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(d).replace('.', ',');
}

export function deTrailPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const d = Number.isInteger(n) ? 0 : 1;
  return n.toFixed(d).replace('.', ',');
}

/** Compact decimal point for commands (strip trailing zeros, max 8 d.p.). */
export function fmtCmdNum(v, max = 8) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(max).replace(/\.?0+$/, '');
}

function validIsoDate(s) {
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

function buyLabel(src, price) {
  const kauf = `Kauf ${dePrice(price)}`;
  return src ? `${src} ${kauf}` : kauf;
}

function stopLabel(src, price, trail) {
  const stop = trail > 0 ? `Stop −${deTrailPct(trail)} % ${dePrice(price)}` : `Stop ${dePrice(price)}`;
  return src ? `${src} ${stop}` : stop;
}

/**
 * Read BUY=/STOP=/TRAIL=/SRC= from already-split command args (case-insensitive keys).
 * Invalid pieces go into `errors`; valid lines are kept so the chart can still render.
 */
export function parseGpOverlay(args = []) {
  const errors = [];
  const buys = [];
  const stops = [];
  let trail = null;
  let src = null;

  for (const raw of args) {
    const w = String(raw || '').trim();
    const eq = w.indexOf('=');
    if (eq < 1) continue;
    const key = w.slice(0, eq).toUpperCase();
    const val = w.slice(eq + 1).trim();
    const mapped = KEYS[key];
    if (!mapped) continue;

    if (mapped === 'src') {
      if (!val) errors.push('SRC fehlt (z. B. SRC=RSL)');
      else src = val;
      continue;
    }
    if (mapped === 'trail') {
      const n = Number(val);
      if (!Number.isFinite(n) || n <= 0) errors.push(`TRAIL ungültig: ${val || '(leer)'}`);
      else trail = n;
      continue;
    }
    if (mapped === 'buy') {
      if (!val) { errors.push('BUY fehlt (z. B. BUY=150.20@2026-11-09)'); continue; }
      for (const part of val.split(',').map((s) => s.trim()).filter(Boolean)) {
        const bits = part.split('@');
        if (bits.length > 2) { errors.push(`BUY ungültig: ${part}`); continue; }
        const price = Number(bits[0]);
        if (!Number.isFinite(price) || price <= 0) { errors.push(`BUY-Preis ungültig: ${part}`); continue; }
        let date = null;
        if (bits[1] != null && bits[1] !== '') {
          if (!validIsoDate(bits[1])) {
            errors.push(`BUY-Datum ungültig: ${part} (YYYY-MM-DD)`);
          } else date = bits[1];
        }
        buys.push({ price, date });
      }
      continue;
    }
    if (mapped === 'stop') {
      if (!val) { errors.push('STOP fehlt (z. B. STOP=120.16)'); continue; }
      for (const part of val.split(',').map((s) => s.trim()).filter(Boolean)) {
        const n = Number(part);
        if (!Number.isFinite(n) || n <= 0) errors.push(`STOP ungültig: ${part}`);
        else stops.push(n);
      }
    }
  }

  const buyItems = buys.map((b) => ({ ...b, label: buyLabel(src, b.price) }));
  const stopItems = stops.map((price) => ({ price, label: stopLabel(src, price, trail) }));
  const parts = [
    ...buyItems.map((b) => (b.date ? `${b.label} ${b.date}` : b.label)),
    ...stopItems.map((s) => s.label),
  ];
  let hint = parts.join(' · ') || null;
  if (errors.length) hint = [hint, `Ungültig: ${errors.join('; ')}`].filter(Boolean).join(' · ');
  return { buys: buyItems, stops: stopItems, trail, src, errors, hint };
}

function sameTicker(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

/**
 * Build `TICKER GP BUY=… STOP=… TRAIL=… SRC=RSL` from already-evaluated holdings rows
 * (uses trailStop / trailPct / buyPrice / buyDate from the table — no recalculation).
 * All open lots of the ticker are included. No open lot → plain `TICKER GP`.
 */
export function holdingsGpCommand(symbol, positions = []) {
  const sym = String(symbol || '').trim();
  if (!sym) return 'GP';
  const lots = (positions || []).filter((p) => p && (p.status == null || p.status === 'open')
    && sameTicker(sym, p.symbol || p.ticker));
  lots.sort((a, b) => String(a.buyDate || '').localeCompare(String(b.buyDate || ''))
    || String(a.id || '').localeCompare(String(b.id || '')));
  if (!lots.length) return `${sym} GP`;

  const buys = lots.filter((p) => Number.isFinite(Number(p.buyPrice)) && Number(p.buyPrice) > 0)
    .map((p) => ({ price: Number(p.buyPrice), date: p.buyDate || null }));
  const stops = lots.map((p) => Number(p.trailStop)).filter((n) => Number.isFinite(n) && n > 0);
  const trails = [...new Set(lots.map((p) => Number(p.trailPct)).filter((n) => Number.isFinite(n) && n > 0))];
  return formatGpCommand(sym, { buys, stops, trail: trails.length === 1 ? trails[0] : null, src: 'RSL' });
}

export function formatGpCommand(symbol, { buys = [], stops = [], trail, src } = {}) {
  const parts = [String(symbol || '').trim(), 'GP'].filter(Boolean);
  const buyBits = buys.map((b) => {
    const price = b && typeof b === 'object' ? b.price : b;
    const num = fmtCmdNum(price);
    if (!num) return null;
    const date = b && typeof b === 'object' ? b.date : null;
    return date ? `${num}@${date}` : num;
  }).filter(Boolean);
  if (buyBits.length) parts.push(`BUY=${buyBits.join(',')}`);
  const stopBits = (Array.isArray(stops) ? stops : [stops]).map((s) => fmtCmdNum(s)).filter(Boolean);
  if (stopBits.length) parts.push(`STOP=${stopBits.join(',')}`);
  if (trail > 0) {
    const t = fmtCmdNum(trail);
    if (t) parts.push(`TRAIL=${t}`);
  }
  if (src) parts.push(`SRC=${String(src).trim()}`);
  return parts.join(' ');
}
