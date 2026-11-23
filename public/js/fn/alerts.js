// ALERTS: gemeinsame Liste der Kursalarme (ALRT) und Status-Alarme (GSW-Swap fällig/gebucht/entfallen,
// RSL-Verkaufssignal, neuer RSL-Kauf-Kandidat) mit Quittieren (einzeln / alle). Daten: GET /api/status-alerts.
// Benachrichtigungs-Einstellungen (Glocke/Mail/Telegram): SETTINGS › Benachrichtigungen. Über die Glocke abgewählte
// Typen stehen hier mit 🔕, ohne Popup und ohne Zählen im 🔔.
import { api, esc } from '../api.js';
import { table, sect, html } from '../ui.js';

export const KIND_LABELS = { price: 'Kurs', gsw: 'GSW', rslSell: 'RSL Verkauf', rslBuy: 'RSL Kauf-Kand.' };
const KIND_COLORS = { price: '#ffa028', gsw: '#f2d21b', rslSell: '#ff4a4a', rslBuy: '#2ecc71' };
const dt = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(+d) ? iso : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const btn = (label, onclick, title = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (title) b.title = title; b.onclick = onclick; return b; };
/** Zustellstatus kurz: „Mail ✓ · Telegram ✗ (Grund)“. */
export function deliveryText(d) {
  if (!d) return '';
  const one = (n, v) => (!v || v === 'off' ? null : v === 'sent' ? `${n} ✓` : `${n} ✗`);
  return [one('Mail', d.mail), one('Telegram', d.telegram)].filter(Boolean).join(' · ') || 'nur Popup';
}

/**
 * Sprungziel einer Alarmzeile (AT-22), aus Typ, Titel und Text abgeleitet (gilt auch für ältere Einträge):
 *   RSL Verkauf/Kauf → RSL26 <Universum> HL=<Ticker> · GSW → GSW HL=<Symbol> (gebuchter Swap: GSW)
 *   Kursalarm → <Symbol> GP (Kurschart), ohne Symbol ALRT. -> { cmd, label } | null
 */
export function alertTarget(r) {
  if (!r) return null;
  const title = String(r.title || ''), text = String(r.text || '');
  if (r.kind === 'rslSell' || r.kind === 'rslBuy') {
    const m = /^(\S+) \(([A-Z0-9]+)[,)]/.exec(text);
    const sym = r.ref?.symbol || m?.[1] || (/(?:Verkaufssignal|Kauf-Kandidat)\s+(\S+)/.exec(title) || [])[1] || null;
    const uni = r.ref?.universe || m?.[2] || null;
    const base = `RSL26${uni ? ` ${uni}` : ''}`;
    return { cmd: `${base}${sym ? ` HL=${sym}` : ''}`, label: `${base}${sym ? ` (${sym})` : ''}` };
  }
  if (r.kind === 'gsw') {
    const sym = /^Swap gebucht/.test(title.replace(/^GSW:\s*/, '')) ? null : (/^(\S+) \(/.exec(text) || [])[1] || null;
    return { cmd: `GSW${sym ? ` HL=${sym}` : ''}`, label: `GSW${sym ? ` (${sym})` : ''}` };
  }
  if (r.kind === 'price') {
    const sym = r.symbol || (/^Kursalarm\s+(\S+)/.exec(title) || [])[1] || null;
    return sym ? { cmd: `${sym} GP`, label: `${sym} GP (Kurschart)` } : { cmd: 'ALRT', label: 'ALRT' };
  }
  return null;
}

async function render(ctx) {
  const head = html('<div class="wform"></div>');
  const info = html('<p class="hint"></p>');
  const body = document.createElement('div');
  ctx.el.replaceChildren(head, info, body);
  let filter = 'all';
  let data = null;
  const load = async () => {
    try { data = await api.get('/api/status-alerts'); } catch (e) { body.replaceChildren(html(`<p class="para dim">Nicht verfügbar: ${esc(e.message)}</p>`)); return; }
    if (!ctx.live()) return;
    paint();
  };
  const ack = async (payload) => {
    try { await api.post('/api/status-alerts/ack', payload); } catch (e) { ctx.toast(`Nicht quittiert: ${e.message}`, true); }
    load();
  };
  const paint = () => {
    const rows = data.rows.filter((r) => filter === 'all' || (filter === 'open' ? !r.ackedAt : r.kind === filter));
    const ch = data.channels || {};
    const errs = Object.entries(data.errors || {});
    const chText = [ch.mail && 'Mail', ch.telegram && 'Telegram'].filter(Boolean).join(' + ') || 'nur Popup';
    info.innerHTML = `${data.unacked} unquittiert${data.muted ? ` (+${data.muted} 🔕 ohne Glocke)` : ''} · letzte Status-Prüfung ${esc(dt(data.lastRun))} · Versand auf diesem Rechner: <b data-channels>${esc(chText)}</b>${ch.mail || ch.telegram ? '' : ' (Mail/Telegram unter SETTINGS › Benachrichtigungen eintragen)'}${errs.length ? ` · <span class="dn">Fehler: ${errs.map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('; ')}</span>` : ''}`;
    body.replaceChildren(sect(`Alarme (${rows.length})`));
    if (!rows.length) { body.append(html('<p class="hint">Keine Alarme in dieser Auswahl. Status-Alarme entstehen, wenn zu einem Ereignis noch kein oder ein anderer Stand gespeichert ist.</p>')); return; }
    body.append(table(rows, [
      { key: 'at', label: 'Zeit', left: true, fmt: (v) => dt(v) },
      { key: 'kind', label: 'Typ', left: true, html: true, fmt: (v, r) => `<span data-kind="${esc(v)}" style="color:${KIND_COLORS[v] || '#ccc'};font-weight:600">${esc(KIND_LABELS[v] || v)}</span>${r.bell === false ? ' <span data-muted title="Über die Glocke abgewählt (SETTINGS › Benachrichtigungen): kein Popup, zählt nicht im 🔔">🔕</span>' : ''}` },
      { key: 'title', label: 'Alarm', left: true, lbl: true },
      { key: 'text', label: 'Details', left: true },
      { key: 'delivery', label: 'Zustellung', left: true, fmt: (v) => deliveryText(v) },
      { key: 'ackedAt', label: 'Status', left: true, html: true, sort: false, fmt: (v, r) => (v ? `<span class="dim" title="quittiert ${esc(dt(v))}">✓ quittiert</span>` : `<button type="button" data-ack="${esc(r.id)}" title="Als gesehen markieren">Quittieren</button>`) },
    ], { max: 1000, onRow: (r) => { const t = alertTarget(r); if (t) ctx.go(t.cmd); } }));
    // Klick auf die Zeile öffnet die passende App (Quittieren-Knopf nicht: der Klick wird vorher abgefangen)
    for (const tr of body.querySelectorAll('tr[data-i]')) {
      const t = alertTarget(rows[+tr.dataset.i]);
      if (t) { tr.title = `Öffnen in ${t.label}`; tr.style.cursor = 'pointer'; tr.dataset.jump = t.cmd; }
    }
  };
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ack]');
    if (b) { e.stopPropagation(); ack({ id: b.dataset.ack }); return; }
    if (e.target.closest('button, a, input, select')) e.stopPropagation(); // andere Bedienelemente: kein Sprung
  }, true);
  const sel = document.createElement('select');
  sel.name = 'filter';
  for (const [v, t] of [['all', 'Alle'], ['open', 'Unquittiert'], ['price', 'Kurs'], ['gsw', 'GSW'], ['rslSell', 'RSL Verkauf'], ['rslBuy', 'RSL Kauf-Kandidat']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
  sel.onchange = () => { filter = sel.value; if (data) paint(); };
  const check = btn('Jetzt prüfen', async () => {
    check.disabled = true; check.textContent = 'Prüfe …';
    try { const r = await api.post('/api/status-alerts/check'); ctx.toast(r.new ? `${r.new} neue Status-Alarme` : 'Keine neuen Status-Alarme'); }
    catch (e) { ctx.toast(`Prüfung fehlgeschlagen: ${e.message}`, true); }
    check.disabled = false; check.textContent = 'Jetzt prüfen';
    if (ctx.live()) load();
  }, 'GSW und RSL jetzt auswerten (sonst stündlich und nach EU-/US-Schluss)');
  const reset = btn('Reset all alerts', async () => {
    if (!window.confirm('Alle Alarme zurücksetzen?\n\nLöscht alle Status-Alarme (GSW, RSL) samt gespeicherter letzter Stände und blendet bisherige Kursalarm-Meldungen hier aus. Ausgelöste „einmalig“-Kursalarme (ALRT) werden wieder aktiv, sonst bleiben die Definitionen unverändert. Danach werden alle Quellen sofort geprüft; der aktuelle Zustand (fällige Swaps, aktive Verkaufssignale, aktuelle Kauf-Kandidaten, erfüllte Kursalarme) wird neu gemeldet – über Glocke, Mail und Telegram je Auswahl in SETTINGS › Benachrichtigungen.')) return;
    reset.disabled = check.disabled = true; reset.textContent = 'Setze zurück …';
    try { const r = await api.post('/api/status-alerts/reset'); const errs = Object.keys(r.errors || {}); ctx.toast(`Zurückgesetzt: ${r.new} Status-Alarme neu gemeldet${r.rearmed ? ` · ${r.rearmed} Kursalarm(e) wieder aktiv` : ''}${errs.length ? ` · Fehler bei ${errs.join(', ')}` : ''}`, !!errs.length); }
    catch (e) { ctx.toast(`Reset fehlgeschlagen: ${e.message}`, true); }
    reset.disabled = check.disabled = false; reset.textContent = 'Reset all alerts';
    if (ctx.live()) load();
  }, 'Alle Status-Alarme und gespeicherten Stände löschen und sofort neu prüfen: der aktuelle Zustand wird neu gemeldet');
  head.append(html('<label>Anzeigen</label>'), sel, btn('Alle quittieren', () => ack({ all: true })), check, reset);
  const onAlert = () => ctx.live() && load();
  window.addEventListener('amber:alert', onAlert);
  window.addEventListener('amber:alerts-count', onAlert);
  ctx.onCleanup?.(() => { window.removeEventListener('amber:alert', onAlert); window.removeEventListener('amber:alerts-count', onAlert); });
  await load();
}

export default [
  {
    id: 'ALERTS', name: 'Alarme · Kurs- und Status-Alarme mit Quittieren', group: 'Workspace', needs: false,
    help: 'Gemeinsame Liste: Kursalarme (ALRT) und Status-Alarme – GSW: Swap fällig, Swap gebucht, aufgeschobener Swap entfallen; RSL26: Verkaufssignal einer offenen Position (Rang-/RRG-Exit, RS < Benchmark, Trailing-Stop), neuer Kauf-Kandidat für einen freien Slot. Klick auf eine Zeile öffnet die App dazu (RSL26 mit hervorgehobenem Ticker, GSW mit hervorgehobenem Lot-Symbol, Kursalarm als Kurschart GP). Quittieren einzeln oder alle; der rote Zähler oben zeigt die unquittierten. Prüfung stündlich, nach EU- (17:45) und US-Schluss (22:20, Berlin) und nach neuen Kursen, oder „Jetzt prüfen“. „Reset all alerts“ löscht alle Status-Alarme und gespeicherten Stände, schaltet ausgelöste „einmalig“-Kursalarme wieder aktiv und meldet danach den aktuellen Zustand neu. Regel: kein oder anderer Stand → neue Meldung (auch beim allerersten Lauf). Glocke (Popup + 🔔) je Typ abwählbar; abgewählte stehen mit 🔕 in der Liste. Mail/Telegram: SETTINGS › Benachrichtigungen.',
    source: 'data/alert-log.json (Kursalarme), data/status-alerts.json (Status-Alarme); GSW-Buch, RSL-Buch, Kurse aus dem Cache',
    render,
  },
];
