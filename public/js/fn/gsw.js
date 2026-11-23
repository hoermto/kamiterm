// GSW (Gold/Silber-Swap: Status, Buch, Charts) und GSWBT (Backtest: Grid, Robustheit, Walk-Forward, OOS).
// Regel: Spezifikation strategies/Gold_Silber_Swap_Spec.md (v3). Server: lib/gsw/*, API /api/gsw*.
import { api, esc } from '../api.js';
import { highlightRows, hlArg } from '../highlight.js';
import { formatGpCommand } from '../gp-overlay.js';
import { table, sortRows, sect, html, kv, equityChart, createChart } from '../ui.js';

const de = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const deMax = (v, d = 4) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: d }) : '—');
const pc = (v, d = 2) => (Number.isFinite(v) ? `${de(v * 100, d)} %` : '—');
const pcs = (v, d = 2) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${de(v, d)} %` : '—');
const money = (v, cur) => (Number.isFinite(v) ? `${v.toLocaleString('de-DE', { maximumFractionDigits: 0 })} ${cur || ''}`.trim() : '—');
const deDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '—');
const note = (s, cls = 'hint') => html(`<p class="${cls}">${esc(s)}</p>`);
const metalName = (m) => (m === 'gold' ? 'Gold' : m === 'silver' ? 'Silber' : m);
const toTime = (iso) => Date.parse(iso + 'T00:00:00Z') / 1000;
const todayIso = () => new Date().toISOString().slice(0, 10);
const KIND_SHORT = { 'physical-delivery': 'physisch, Lieferanspruch', 'physical-no-delivery': 'physisch, ohne Lieferung', synthetic: 'synthetisch', futures: 'Futures' };
const kindShort = (p) => KIND_SHORT[p?.kind] || '';
const DAY_MS = 86400000;
const isLeapYear = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const daysInMonth = (y, m) => [0, 31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
const pad2 = (n) => String(n).padStart(2, '0');
function addCalendarYears(iso, k) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  const ny = y + k;
  return `${ny}-${pad2(m)}-${pad2(Math.min(d, daysInMonth(ny, m)))}`;
}
function addCalendarDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10); }
function holdUnlockDate(buy, days = 365) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0 || !buy) return buy;
  if (n === 365) return addCalendarDays(addCalendarYears(buy, 1), 1);
  return addCalendarDays(buy, n);
}
const inHoldPeriod = (buy, asOf, days = 365) => !!(buy && asOf && asOf < holdUnlockDate(buy, days));
const restHoldDays = (buy, asOf, days = 365) => Math.max(0, Math.round((Date.parse(holdUnlockDate(buy, days) + 'T00:00:00Z') - Date.parse(asOf + 'T00:00:00Z')) / DAY_MS));

const btn = (label, title, onclick, attrs = '') => { const b = html(`<button type="button" ${attrs}>${esc(label)}</button>`); if (title) b.title = title; b.onclick = onclick; return b; };
const iconBtn = (attr, id, sym, label, cls = '') => `<button type="button" class="ibtn${cls ? ' ' + cls : ''}" ${attr}="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}">${sym}</button>`;
const HINT_COLORS = { due: '#ff4a4a', warn: '#ffa028', ok: '#2fd36b', info: '#8c8c8c' };
// Signal/Aktion je Lot (Server: lib/gsw/advice.js): due = Swap fällig, hold = fällig aber Haltefrist, spike = Spike halten, ok = halten
export const ACTION_COLORS = { due: '#ff4a4a', hold: '#ffa028', spike: '#b469ff', ok: '#2fd36b', info: '#8c8c8c' };
export function actionCell(a) {
  if (!a) return '—';
  const c = ACTION_COLORS[a.level] || '#8c8c8c';
  const strong = a.level === 'due' || a.level === 'hold';
  return `<span class="gsw-action gsw-action-${esc(a.level)}" style="color:${c};${strong ? 'font-weight:700;' : ''}white-space:nowrap" title="${esc([a.text, a.dist].filter(Boolean).join(' · '))}">${strong ? '● ' : ''}${esc(a.text)}</span>${a.dist ? `<br><span class="hint" style="margin:0;font-size:90%">${esc(a.dist)}</span>` : ''}`;
}
/** Aufklappbarer Bereich (Zustand je key im Browser, wie RSL26); onOpen läuft beim ersten Aufklappen (Charts erst dann bauen). */
function collapsible(key, summary, nodes, { open = false, onOpen = null } = {}) {
  const d = document.createElement('details'); d.className = 'gsw-collapse'; d.dataset.key = key; d.style.margin = '6px 0';
  let isOpen = open; try { const v = localStorage.getItem(`amber.gsw.open.${key}`); if (v != null) isOpen = v === '1'; } catch {}
  const sm = document.createElement('summary'); sm.style.cssText = 'cursor:pointer;font-weight:600'; sm.textContent = summary; d.append(sm);
  for (const n of [].concat(nodes || [])) if (n) d.append(n);
  let done = false;
  const fire = () => { if (d.open && !done && onOpen) { done = true; onOpen(); } };
  d.addEventListener('toggle', () => { try { localStorage.setItem(`amber.gsw.open.${key}`, d.open ? '1' : '0'); } catch {} fire(); });
  d.open = isOpen; if (isOpen) queueMicrotask(fire);
  return d;
}
/** Aufklappbare Erläuterung: beim Laden der Seite immer zu (nichts gespeichert); innerhalb der Sitzung bleibt ein
 *  geöffneter Block bei einem Neuaufbau der Ansicht (Buchung, Profilwechsel) offen. */
const sessionOpen = new Map();
function explainRow(key, summary, nodes) {
  const d = document.createElement('details'); d.className = 'gsw-collapse gsw-explain'; d.dataset.key = key; d.style.margin = '6px 0';
  const sm = document.createElement('summary'); sm.style.cssText = 'cursor:pointer;font-weight:600'; sm.textContent = summary; d.append(sm);
  for (const n of [].concat(nodes || [])) if (n) d.append(n);
  d.open = sessionOpen.get(key) === true;
  d.addEventListener('toggle', () => sessionOpen.set(key, d.open));
  return d;
}
/** Legende unter einem Chart: [[Farbe, Text, gestrichelt?]]. */
const legend = (items) => html(`<div class="hint gsw-legend" style="margin:2px 0 8px;display:flex;gap:14px;flex-wrap:wrap">${items.map(([c, t, dash]) => `<span style="white-space:nowrap"><span style="display:inline-block;width:18px;height:0;border-top:2px ${dash ? 'dashed' : 'solid'} ${c};vertical-align:middle;margin-right:4px"></span>${esc(t)}</span>`).join('')}</div>`);

/** Paar-Auswahl (Presets + Benutzerdefiniert); gemeinsam für GSW und GSWBT. */
function pairPicker(pairs, cur) {
  const custom = cur.custom || {};
  const el = html(`<span class="gsw-pair" style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap">
    <label title="Handelspaar: womit gehandelt und bewertet wird. Das Signal bleibt immer GLD/SLV × k (GC=F/SI=F).">Handelspaar
    <select name="pairId">${pairs.map((p) => `<option value="${esc(p.id)}" title="${esc((p.note || '') + (kindShort(p) ? ` · Art: ${kindShort(p)}` : ''))}"${p.id === cur.pairId ? ' selected' : ''}>${esc(p.label)} · ${esc(p.venue)} · ${esc(p.currency)}${kindShort(p) ? ` · ${esc(kindShort(p))}` : ''}</option>`).join('')}
    <option value="CUSTOM"${cur.pairId === 'CUSTOM' ? ' selected' : ''}>Benutzerdefiniert…</option></select></label>
    <span class="gsw-custom" style="display:${cur.pairId === 'CUSTOM' ? 'inline-flex' : 'none'};gap:4px;align-items:center">
      <input name="cgold" placeholder="Gold-Ticker" value="${esc(custom.gold || '')}" style="width:90px" title="Yahoo-Symbol, z. B. 4GLD.DE">
      <input name="csilver" placeholder="Silber-Ticker" value="${esc(custom.silver || '')}" style="width:90px" title="Yahoo-Symbol, z. B. VZLC.DE">
      <input name="ccur" placeholder="Währ." value="${esc(custom.currency || '')}" style="width:48px" title="ISO-Währung (leer = aus Börsenkürzel: .DE/.MI → EUR, .L → GBP; LSE-USD wie PHAU.L bitte USD setzen)">
    </span></span>`);
  const sel = el.querySelector('select');
  sel.onchange = () => { el.querySelector('.gsw-custom').style.display = sel.value === 'CUSTOM' ? 'inline-flex' : 'none'; el.onPairChange?.(sel.value); };
  el.set = (v = {}) => {
    if (v.pairId) sel.value = v.pairId;
    const c = v.custom || {};
    el.querySelector('[name=cgold]').value = c.gold || ''; el.querySelector('[name=csilver]').value = c.silver || ''; el.querySelector('[name=ccur]').value = c.currency || '';
    el.querySelector('.gsw-custom').style.display = sel.value === 'CUSTOM' ? 'inline-flex' : 'none';
  };
  el.read = () => ({ pairId: sel.value, custom: { gold: el.querySelector('[name=cgold]').value.trim(), silver: el.querySelector('[name=csilver]').value.trim(), currency: el.querySelector('[name=ccur]').value.trim() } });
  return el;
}

const PARAM_FIELDS = [
  ['U1', 'Einstieg', 'Gold → Silber, wenn sig-Tagesschluss > U1 (Spot-Ratio-Einheiten)'],
  ['L1', 'Ausstieg', 'Silber → Gold, wenn sig < L1 (normal)'],
  ['S', 'Spike', 'In Silber: sig > S schaltet den Spike-Modus (dann gilt L2 statt L1)'],
  ['L2', 'Spike-Exit', 'Silber → Gold im Spike-Modus, wenn sig < L2'],
  ['window', 'Median', 'Fenster des kausalen Medians k (Handelstage)'],
  ['costPct', 'Kosten %', 'Kosten je Seite in %, auch beim Erstkauf'],
];

/**
 * Y-Autoscale mit Hilfslinien: Bereich der sichtbaren Daten (original) plus die Schwellen, die darin liegen, und je die
 * nächste darüber/darunter, sofern sie höchstens eine Datenspanne entfernt ist (sonst würde sie die Kurve stauchen).
 * guides: [{ value }] (konstant) oder [{ data: [{time, value}] }] (zeitabhängig, Bereich im sichtbaren Zeitfenster).
 */
export function guideAutoscale(original, guides, visible = null, { maxStretch = 1 } = {}) {
  const o = original();
  if (!o?.priceRange || !guides?.length) return o;
  let { minValue: lo, maxValue: hi } = o.priceRange;
  const span = Math.max(hi - lo, Math.abs(hi) * 0.002, 1e-9);
  const rng = guides.map((g) => {
    if (Number.isFinite(g.value)) return [g.value, g.value];
    const v = (g.data || []).filter((p) => (!visible || (p.time >= visible.from && p.time <= visible.to)) && Number.isFinite(p.value)).map((p) => p.value);
    return v.length ? [Math.min(...v), Math.max(...v)] : null;
  }).filter(Boolean);
  const inside = rng.filter(([a, b]) => b >= lo && a <= hi);
  const above = rng.filter(([a]) => a > hi).sort((x, y) => x[0] - y[0])[0];
  const below = rng.filter(([, b]) => b < lo).sort((x, y) => y[1] - x[1])[0];
  let nlo = lo, nhi = hi;
  for (const [a, b] of inside) { nlo = Math.min(nlo, a); nhi = Math.max(nhi, b); }
  if (above && above[0] - hi <= maxStretch * span) nhi = Math.max(nhi, above[1]);
  if (below && lo - below[1] <= maxStretch * span) nlo = Math.min(nlo, below[0]);
  return { ...o, priceRange: { minValue: nlo, maxValue: nhi } };
}

/** Y-Autoscale wieder einschalten (nach Zoom/Ziehen an der Achse). */
const autoY = (chart) => { for (const id of ['right', 'left']) { try { chart.priceScale(id).applyOptions({ autoScale: true }); } catch {} } };

/** Kleiner Linien-Chart mit optionaler zweiter Skala; series: {title,color,data,scale?,lines?,markers?,guides?,autoscale?}. Y skaliert auf den sichtbaren Zeitbereich. */
function multiChart(host, seriesList, { height = 260 } = {}) {
  const LW = window.LightweightCharts;
  host.style.height = `${height}px`; host.style.position = 'relative';
  const chart = createChart(host, {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#050505' }, textColor: '#ffa028', fontSize: 11, attributionLogo: false },
    grid: { vertLines: { color: '#161616' }, horzLines: { color: '#161616' } },
    rightPriceScale: { borderColor: '#262626', visible: true, autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } }, leftPriceScale: { borderColor: '#262626', visible: seriesList.some((s) => s.scale === 'left'), autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: '#262626', minBarSpacing: 0.01 },
    localization: { priceFormatter: (v) => v.toLocaleString('de-DE', { maximumFractionDigits: Math.abs(v) >= 100 ? 1 : 3 }) },
  });
  const out = [];
  for (const s of seriesList) {
    // Schwellen als Preislinien bzw. Hilfsreihen zählen über guides mit (nur die nahen), Hilfsreihen selbst nicht (autoscale:false)
    const guides = [...(s.lines || []).map((l) => ({ value: l.price })), ...(s.guides || [])];
    const vis = () => { try { const r = chart.timeScale().getVisibleRange(); return r ? { from: Number(r.from), to: Number(r.to) } : null; } catch { return null; } };
    const autoscaleInfoProvider = s.autoscale === false ? () => null : guides.length ? (orig) => guideAutoscale(orig, guides, vis()) : undefined;
    const ser = chart.addSeries(LW.LineSeries, { color: s.color, lineWidth: s.width || 2, lineStyle: s.style || 0, title: s.title, priceScaleId: s.scale || 'right', priceLineVisible: false, lastValueVisible: s.lastValue !== false, ...(autoscaleInfoProvider ? { autoscaleInfoProvider } : {}) });
    ser.setData(s.data.filter((p) => Number.isFinite(p.value)));
    for (const l of s.lines || []) ser.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.title });
    if (s.markers?.length) LW.createSeriesMarkers?.(ser, s.markers.sort((a, b) => a.time - b.time));
    out.push(ser);
  }
  chart.timeScale().fitContent();
  requestAnimationFrame(() => chart.timeScale().fitContent());
  return { chart, series: out, remove: () => chart.remove() };
}

function rangeTabs(charts, dates) {
  const bar = html('<span class="tabs" style="display:inline-flex;gap:2px"></span>');
  const last = dates.at(-1);
  for (const [k, yrs] of [['1J', 1], ['3J', 3], ['5J', 5], ['Max', 0]]) {
    const b = html(`<button type="button" class="tab">${k}</button>`);
    b.onclick = () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
      for (const c of charts) {
        autoY(c.chart);
        if (!yrs) { c.chart.timeScale().fitContent(); continue; }
        const from = `${Number(last.slice(0, 4)) - yrs}${last.slice(4)}`;
        c.chart.timeScale().setVisibleRange({ from: toTime(from < dates[0] ? dates[0] : from), to: toTime(last) });
      }
    };
    bar.append(b);
  }
  const ay = html('<button type="button" class="tab" title="Y-Achse wieder automatisch an den sichtbaren Zeitraum anpassen (nach Ziehen an der Achse; Doppelklick auf die Achse geht auch)">Y auto</button>');
  ay.onclick = () => charts.forEach((c) => autoY(c.chart));
  bar.append(ay);
  return bar;
}

// ================= GSW =================
async function gsw(ctx) {
  ctx.el.replaceChildren(note('Lade GLD, SLV, GC=F, SI=F und das Handelspaar…'));
  let d;
  const dr = loadDraft();
  const qs = dr ? `?draftFor=${encodeURIComponent(dr.profileId)}&draft=${encodeURIComponent(JSON.stringify(dr.draft))}` : '';
  try { d = await api.get('/api/gsw' + qs); } catch (e) { if (ctx.live()) ctx.el.replaceChildren(sect('Gold/Silber-Swap · GSW'), note(`Fehler: ${e.message}`), await profileFallback(ctx, !!dr)); return; }
  if (dr && d.profile?.draftStale) clearDraft();
  if (!ctx.live()) return;
  const charts = [];
  ctx.onCleanup?.(() => charts.forEach((c) => c.remove()));
  const P = d.params, st = d.state, pair = d.pair, cur = pair.currency;
  ctx.el.replaceChildren(sect(`Gold/Silber-Swap · GSW · ${pair.label} (${pair.venue}, ${cur}) · Stand ${deDate(d.asOf)}`));
  ctx.el.append(profileBox(ctx, d));
  // Hinweis Regel vs. Buch
  if (d.hint) ctx.el.append(html(`<p class="gsw-hint" style="margin:6px 0;padding:6px 8px;border-left:4px solid ${HINT_COLORS[d.hint.level] || '#777'};background:#111"><strong>${d.hint.level === 'due' ? 'Swap-Signal' : d.hint.level === 'ok' ? 'OK' : 'Hinweis'}:</strong> ${esc(d.hint.text)}</p>`));
  // Phasen, Datenqualität, Regeln & Schwellen: Erläuterung als eine aufklappbare Zeile, standardmäßig zu. Sichtbar
  // bleiben der Hinweis Regel vs. Buch (oben), eine Kurzfassung des Status in der Summary und Datenwarnungen.
  const nx = st.next;
  const dq = d.dataQuality || [];
  const dqWarn = dq.filter((n) => n.level === 'warn');
  if (dqWarn.length) ctx.el.append(html(`<p class="gsw-dq-warn" style="margin:6px 0;padding:4px 8px;border-left:4px solid #ffa028;background:#111;color:#ffa028">⚠ ${esc(dqWarn.map((n) => n.text).join(' · '))} <span class="hint" style="margin:0">(Details unter „Phasen, Datenqualität, Regeln & Schwellen“)</span></p>`));
  const statusKv = kv([
    ['Phase (Regel)', `${st.phase}${st.lastSwitch ? ` seit ${deDate(st.lastSwitch.execDate)} (Signal ${deDate(st.lastSwitch.signalDate)}, ${st.lastSwitch.rule})` : ''}`],
    ['sig (Spot-Einheiten)', `${de(st.sig, 2)} = GLD/SLV ${de(st.etfRatio, 5)} × k${st.window} ${de(st.kMed, 6)}`],
    ['Nächste Schwelle', `${nx.name} ${nx.key} = ${deMax(nx.spot, 2)} · Abstand ${pcs(nx.distPct)} (GLD/SLV ${de(nx.etf, 5)}${pair.id !== 'GLDSLV' ? ` · ${pair.label} ≈ ${de(nx.pair, 5)}` : ''})`],
    ['Spike-Modus', st.pos === 'silver' ? (st.spike ? 'aktiv: Ausstieg erst bei sig < L2' : `aus (scharf bei sig > ${deMax(P.S)})`) : 'nur im Silber-Bein'],
    ['Spot-Ratio GC=F/SI=F', `${de(st.spotRatio, 3)} (Kontrollgröße, nicht das Signal)`],
    ['Parameter', `U1 ${deMax(P.U1)} · L1 ${deMax(P.L1)} · S ${deMax(P.S)} · L2 ${deMax(P.L2)} · Median ${P.window} Tg · Kosten ${deMax(P.costPct, 3)} %/Seite · Start ${deDate(d.start)}`],
  ]);
  const rulesTable = table(d.levels, [
    { key: 'name', label: 'Schwelle', left: true, fmt: (v, r) => `${v} (${r.key})` },
    { key: 'spot', label: 'sig\n(Spot)', fmt: (v) => deMax(v, 2) },
    { key: 'etf', label: 'GLD/SLV', fmt: (v) => de(v, 5), title: `Schwelle / k${P.window} (heute ${de(st.kMed, 6)})` },
    ...(pair.id !== 'GLDSLV' ? [{ key: 'pair', label: `${pair.label}\n≈ heute`, fmt: (v) => de(v, 5), title: `Umgerechnet mit dem heutigen Verhältnis Paar-Ratio / GLD-SLV-Ratio (${de(st.conv, 5)}); nur Orientierung, das Signal bleibt GLD/SLV × k` }] : []),
    { key: 'distPct', label: 'Abstand\n%', fmt: (v) => pcs(v), title: 'Schwelle / sig − 1' },
    { key: 'role', label: 'Regel', left: true, short: 46 },
  ]);
  const sum = [`${dqWarn.length ? '⚠ ' : ''}Phasen, Datenqualität, Regeln & Schwellen`, `Phase ${st.phase}`, `sig ${de(st.sig, 2)}`, `nächste ${nx.key} ${deMax(nx.spot, 2)} (${pcs(nx.distPct)})`,
    `U1 ${deMax(P.U1)} · L1 ${deMax(P.L1)} · S ${deMax(P.S)} · L2 ${deMax(P.L2)}`].join(' · ');
  ctx.el.append(explainRow('rules', sum, [dq.length ? dataQualityBox(dq) : null, statusKv, sect('Regeln & Schwellen'), rulesTable]));
  // Holdings
  ctx.el.append(holdingsBox(ctx, d));
  { const hl = hlArg(ctx.args); if (hl) highlightRows(ctx.el, hl); } // Sprung aus ALERTS: GSW HL=EWG2
  // Charts
  const ch = d.chart, dates = ch.dates;
  const tradesBt = d.backtest.trades;
  const btMarks = (valOf) => tradesBt.map((t) => ({ time: toTime(t.execDate), position: t.dir === 'Gold→Silber' ? 'aboveBar' : 'belowBar', color: t.dir === 'Gold→Silber' ? '#c0c0c0' : '#f2d21b', shape: t.dir === 'Gold→Silber' ? 'arrowDown' : 'arrowUp', text: t.dir === 'Gold→Silber' ? 'S' : 'G' }));
  const lots = [...d.book.open, ...d.book.closed];
  const ownMarks = lots.filter((l) => l.buyDate >= dates[0]).map((l) => ({ time: toTime(l.buyDate), position: 'belowBar', color: '#2fd36b', shape: 'circle', text: `K ${l.metal === 'gold' ? 'Au' : 'Ag'}` }));
  const sigHost = document.createElement('div'), ratioHost = document.createElement('div'), pxHost = document.createElement('div');
  const chartSect = sect('Charts');
  ctx.el.append(chartSect);
  const tabsHost = document.createElement('div'); ctx.el.append(tabsHost);
  const pts = (arr) => arr.map((v, i) => ({ time: toTime(dates[i]), value: v }));
  const LC = { U1: '#ff4a4a', L1: '#2fd36b', S: '#b469ff', L2: '#63a9ff' };
  const LN = { U1: 'U1 Einstieg Silber', L1: 'L1 zurück in Gold', S: 'S Spike scharf', L2: 'L2 Spike-Exit' };
  // Chart 1: das Signal
  ctx.el.append(html(`<h4 class="gsw-chart-title" style="margin:8px 0 2px">① Signal sig mit Schwellen <span class="hint" style="margin:0;font-weight:normal">(y: sig in Spot-Einheiten = Unzen Silber je Unze Gold, aus GLD/SLV × k)</span></h4>`),
    note('Hiernach handelt die Regel: über U1 Gold → Silber, unter L1 zurück in Gold; steigt sig im Silber über S, gilt bis zum Rückgang unter L2 der Spike-Modus. ▼ S / ▲ G = Wechsel im Backtest, ● K = eigene Käufe.'), sigHost,
    legend([['#ffa028', 'sig'], ...['U1', 'L1', 'S', 'L2'].map((k) => [LC[k], `${LN[k]} (${deMax(P[k])})`, true])]));
  charts.push(multiChart(sigHost, [
    { title: 'sig', color: '#ffa028', data: pts(ch.sig), lines: [['U1', P.U1], ['L1', P.L1], ['S', P.S], ['L2', P.L2]].map(([k, v]) => ({ price: v, color: LC[k], title: `${k} ${v}` })), markers: [...btMarks(), ...ownMarks] },
  ], { height: 280 }));
  const ratio = ch.pg.map((g, i) => g / ch.ps[i]);
  const conv = ratio.map((r, i) => r / ch.etf[i]);
  // Chart 2: dieselben Schwellen, übersetzt in das Kursverhältnis des Handelspaars (einklappbar, Charts erst beim Aufklappen)
  const isSpec = pair.id === 'GLDSLV';
  const ratioNodes = [
    note(`Kurs ${pair.gold} geteilt durch Kurs ${pair.silver}, also „wie viele ${pair.silver} kostet ein ${pair.gold}“. Die gestrichelten Linien sind die Schwellen aus Chart ①, Tag für Tag in dieses Verhältnis umgerechnet: kreuzt die weiße Linie eine Schwelle, kreuzt sig sie auch. Nützlich, um Swap-Kurse fürs eigene Paar abzuschätzen${isSpec ? '; beim Spec-Paar GLD/SLV zeigt er dasselbe Bild wie ① in anderer Einheit' : ''}.`),
    ratioHost,
    legend([['#e6e6e6', `${pair.label} (Kursverhältnis)`], ...['U1', 'L1', 'S', 'L2'].map((k) => [LC[k], `${LN[k]} umgerechnet`, true])]),
  ];
  ctx.el.append(collapsible('chart-ratio', `② Kursverhältnis ${pair.label} mit umgerechneten Schwellen (y: ${pair.gold} / ${pair.silver})`, ratioNodes, { onOpen: () => {
    const thr = [['U1', P.U1], ['L1', P.L1], ['S', P.S], ['L2', P.L2]].map(([k, v]) => ({ title: k, color: LC[k], width: 1, style: 2, lastValue: true, autoscale: false, data: pts(ch.kMed.map((km, i) => (v / km) * conv[i])) }));
    const c = multiChart(ratioHost, [
      { title: `${pair.label}`, color: '#e6e6e6', data: pts(ratio), markers: btMarks(), guides: thr.map((t) => ({ data: t.data })) },
      ...thr,
    ], { height: 240 });
    charts.push(c);
  } }));
  // Chart 3: die beiden Kurse des Handelspaars
  const pxNodes = [
    note(`Die Tagesschlusskurse der beiden gehandelten Instrumente: ${pair.gold} (Gold, linke Achse) und ${pair.silver} (Silber, rechte Achse), in ${cur}. Zwei Achsen, weil die Preise sehr verschieden hoch sind; ● K = eigene Käufe. Zeigt, wie sich die Bestände wertmäßig entwickelt haben.`),
    pxHost,
    legend([['#f2d21b', `Gold ${pair.gold} (linke Achse, ${cur})`], ['#c0c0c0', `Silber ${pair.silver} (rechte Achse, ${cur})`]]),
  ];
  ctx.el.append(collapsible('chart-prices', `③ Kurse ${pair.gold} und ${pair.silver} (y: Kurs in ${cur})`, pxNodes, { onOpen: () => {
    charts.push(multiChart(pxHost, [
      { title: `Gold ${pair.gold}`, color: '#f2d21b', data: pts(ch.pg), scale: 'left', markers: ownMarks.filter((m) => m.text.endsWith('Au')) },
      { title: `Silber ${pair.silver}`, color: '#c0c0c0', data: pts(ch.ps), markers: ownMarks.filter((m) => m.text.endsWith('Ag')) },
    ], { height: 240 }));
  } }));
  const gpBar = html('<span style="display:inline-flex;gap:6px;margin-left:12px"></span>');
  for (const [m, t] of [['gold', pair.gold], ['silver', pair.silver]]) gpBar.append(btn(`GP ${t}`, 'Preischart mit Kauflinien der offenen Lots (GP-Overlay BUY=…)', () => ctx.go(gpCmd(t, d.book.open))));
  tabsHost.append(rangeTabs(charts, dates), gpBar);
  ctx.el.append(sect(`Backtest-Wechsel mit diesen Parametern (${deDate(d.backtest.from)} – ${deDate(d.asOf)})`), tradesTable(tradesBt, cur, pair));
  const m = d.backtest.metrics;
  ctx.el.append(note(`Laufender Backtest ab ${deDate(m.startDate)} (10.000 ${cur}): Endwert ${money(m.endValue, cur)}, CAGR ${pc(m.cagr)}, MaxDD ${pc(m.maxdd)}, ${m.switches} Wechsel, ${pc(m.timeInSilver, 1)} der Zeit in Silber, ${deMax(m.goldOz, 3)} Gold-oz. Details und Optimierung: GSWBT.`));
  for (const n of (d.notes || []).filter((x) => !/^[⚠ℹ] Daten(korrektur|warnung)/.test(x))) ctx.el.append(note(n));
}

/** Hinweisbox Datenqualität (oben in GSW und GSWBT). */
export function dataQualityBox(list) {
  const warn = list.some((n) => n.level === 'warn');
  const box = html(`<div class="gsw-dq" style="margin:6px 0;padding:6px 8px;border-left:4px solid ${warn ? '#ffa028' : '#63a9ff'};background:#111"><strong>Datenqualität:</strong></div>`);
  for (const n of list) box.append(html(`<div class="hint gsw-dq-${esc(n.level)}" style="margin:2px 0;${n.level === 'warn' ? 'color:#ffa028' : ''}">${n.level === 'warn' ? '⚠' : 'ℹ'} ${esc(n.text)}</div>`));
  return box;
}

function gpCmd(symbol, openLots) {
  const buys = openLots.filter((l) => l.symbol === symbol).map((l) => ({ price: l.buyPrice, date: l.buyDate }));
  return formatGpCommand(symbol, { buys, src: buys.length ? 'GSW' : undefined });
}

function tradesTable(trades, cur, pair) {
  return table([...trades].reverse(), [
    { key: 'signalDate', label: 'Signal', fmt: deDate },
    { key: 'execDate', label: 'Ausführung', fmt: deDate },
    { key: 'dir', label: 'Richtung', left: true },
    { key: 'rule', label: 'Regel', left: true, cls: (v, r) => (r.lapsed ? 'down' : r.deferred ? 'warn' : '') },
    { key: 'sig', label: 'sig', fmt: (v) => de(v, 2) },
    { key: 'ratioEtf', label: 'GLD/SLV', fmt: (v) => de(v, 4) },
    { key: 'execGold', label: `Kurs\n${pair.gold}`, fmt: (v) => de(v, 2) },
    { key: 'execSilver', label: `Kurs\n${pair.silver}`, fmt: (v) => de(v, 2) },
    { key: 'equityAfter', label: `Equity\n${cur}`, fmt: (v) => money(v) },
    { key: 'goldOzAfter', label: 'Gold-oz\ndanach', fmt: (v) => de(v, 3) },
    ...(trades.some((t) => 'tax' in t) ? [
      { key: 'gain', label: `Gewinn\n${cur}`, fmt: (v, r) => (r.lapsed ? '—' : money(v)), title: 'Realisierter Gewinn des Swaps: Nettoerlös (nach Kosten) − eingesetzter Betrag der verkauften Position, in Paarwährung' },
      { key: 'tax', label: `Steuer\n${cur}`, fmt: (v, r) => (r.lapsed ? '—' : r.taxFree ? 'frei (§23)' : money(v)), cls: (v, r) => (r.taxFree ? 'up' : v > 0 ? 'down' : ''), title: 'Steuer auf den Swap, aus dem Erlös bezahlt (weniger reinvestiert). frei (§23) = Verkauf ab „steuerfrei ab“. Keine Steuerberatung.' },
      { key: 'lossPotAfter', label: `Verlust-\ntopf ${cur}`, fmt: (v, r) => (r.lapsed ? '—' : money(v)), title: 'Verlustvortrag nach diesem Swap (vereinfachter Verlusttopf)' },
    ] : []),
  ]);
}

// ---------- Profile (data/gsw-profiles.json) ----------
const DRAFT_KEY = 'amber.gsw.draft';
function loadDraft() { try { const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return v && v.profileId && v.draft ? v : null; } catch { return null; } }
function saveDraft(profileId, draft) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ profileId, draft })); } catch {} }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }
const TAX_MODES = [['none', 'ohne Steuer (Rohertrag)'], ['kest', 'Abgeltungsteuer + Soli']];
const fmtSnap = (sn) => (sn ? `${deDate(sn.start)}–${deDate(sn.end)}: ${money(sn.endValue, sn.currency)} · CAGR ${pc(sn.cagr)} · MaxDD ${pc(sn.maxdd)} · ${sn.switches ?? '—'} Swaps${Number.isFinite(sn.taxPaid) && sn.taxPaid > 0 ? ` · Steuer ${money(sn.taxPaid, sn.currency)}` : ''}` : '');
const profLabel = (p) => `${p.name}${p.pairId && p.pairId !== 'GLDSLV' ? ` · ${p.pairId}` : ''}`;

/** Profilfelder (Paar, Parameter, Start, Sperre, Steuer, Notiz) als Formular; read() liefert ein Profil-Objekt (ohne id/name). */
function profileFields(pairs, p) {
  const wrap = html('<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0"></div>');
  const pp = pairPicker(pairs, p); wrap.append(pp);
  for (const [k, lab, tip] of PARAM_FIELDS) wrap.append(html(`<label title="${esc(tip)}">${esc(lab)} <input name="${k}" value="${esc(String(p.params?.[k] ?? ''))}" inputmode="decimal" style="width:52px"></label>`));
  wrap.append(html(`<label title="Erster Tag der Signal-/Backtest-Reihe (Spec: 2016-10-21); k startet dort">Start <input name="start" type="date" value="${esc(p.start || '2016-10-21')}"></label>`));
  wrap.append(html(`<label title="Haltefrist des Profils: in GSW Anzeige/Warnung je Lot ('steuerfrei ab' = Kauf + 1 Jahr + 1 Tag bei 365), in GSWBT die Swap-Sperre. Keine Steuerberatung; die Frist gilt nicht automatisch."><input type="checkbox" name="holdOn"${p.hold?.on ? ' checked' : ''}> Haltefrist / Sperre</label>`));
  wrap.append(html(`<label title="Tage (Default 365)">Tage <input name="holdDays" value="${esc(String(p.hold?.days ?? 365))}" inputmode="numeric" style="width:52px"></label>`));
  const t = p.tax || {};
  wrap.append(html(`<label title="Steuer im Backtest (GSWBT). Keine Steuerberatung.">Steuer <select name="taxMode">${TAX_MODES.map(([v, l]) => `<option value="${v}"${(t.mode || 'none') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`));
  wrap.append(html(`<label title="Satz in % (Default 26,375 = 25 % + 5,5 % Soli)">Satz % <input name="taxRate" value="${esc(String(t.rate ?? 26.375))}" style="width:60px"></label>`));
  wrap.append(html(`<label title="Pauschbetrag je Kalenderjahr (Default 0)">Pauschbetrag <input name="taxAllowance" value="${esc(String(t.allowance ?? 0))}" style="width:60px"></label>`));
  wrap.append(html(`<label title="§23 nur bei Paaren mit Lieferanspruch (8PSG/8PSB). auto = an, wenn die Haltefrist-Option des Paars in den GSW-Einstellungen nicht ausdrücklich aus ist.">§23 <select name="taxP23">${['auto', 'on', 'off'].map((v) => `<option value="${v}"${(t.p23 || 'auto') === v ? ' selected' : ''}>${v === 'on' ? 'an' : v === 'off' ? 'aus' : 'auto'}</option>`).join('')}</select></label>`));
  wrap.append(html(`<label title="Persönlicher Satz für §23 innerhalb der Frist; leer = wie Satz">§23-Satz % <input name="p23Rate" value="${esc(t.p23Rate == null ? '' : String(t.p23Rate))}" placeholder="wie oben" style="width:60px"></label>`));
  wrap.append(html(`<label title="Freie Notiz zum Profil">Notiz <input name="note" value="${esc(p.note || '')}" style="width:220px"></label>`));
  const v = (n) => wrap.querySelector(`[name=${n}]`).value;
  wrap.read = () => {
    const params = Object.fromEntries(PARAM_FIELDS.map(([k]) => [k, String(v(k)).replace(',', '.')]));
    return { ...pp.read(), params, start: v('start'), hold: { on: wrap.querySelector('[name=holdOn]').checked, days: String(v('holdDays')).replace(',', '.') },
      tax: { mode: v('taxMode'), rate: String(v('taxRate')).replace(',', '.'), allowance: String(v('taxAllowance')).replace(',', '.'), p23: v('taxP23'), p23Rate: String(v('p23Rate')).replace(',', '.') }, note: v('note') };
  };
  wrap.pp = pp;
  return wrap;
}

/** Ersatzansicht, wenn GSW nicht laden konnte (z. B. ungültiger Entwurf): Entwurf verwerfen, Profil wechseln. */
async function profileFallback(ctx, hasDraft) {
  const box = document.createElement('div');
  if (hasDraft) box.append(btn('Entwurf verwerfen', 'Ungespeicherte Änderungen verwerfen und das gespeicherte Profil laden', () => { clearDraft(); ctx.go('GSW'); }));
  try {
    const P = await api.get('/api/gsw/profiles');
    const sel = html(`<select>${P.profiles.map((p) => `<option value="${esc(p.id)}"${p.id === P.activeId ? ' selected' : ''}>${esc(profLabel(p))}</option>`).join('')}</select>`);
    sel.onchange = async () => { try { await api.post('/api/gsw/profiles/activate', { id: sel.value }); clearDraft(); ctx.go('GSW'); } catch (e) { alert(e.message); } };
    const l = html('<label style="margin-left:10px">Profil </label>'); l.append(sel); box.append(l);
  } catch {}
  return box;
}

function profileBox(ctx, d) {
  const PR = d.profile, A = PR.active, E = PR.effective;
  const box = html('<div class="gsw-profile" style="margin:6px 0"></div>');
  const bar = html('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>');
  const sel = html(`<select name="profileId" title="Aktives Profil: bestimmt Paar, Signal-Schwellen, Swap-Levels im Chart und Haltefrist-Warnung">${PR.list.map((p) => `<option value="${esc(p.id)}"${p.id === PR.activeId ? ' selected' : ''}>${esc(profLabel(p))}</option>`).join('')}</select>`);
  sel.onchange = async () => {
    if (PR.draft && !confirm('Ungespeicherte Änderungen verwerfen und Profil wechseln?')) { sel.value = PR.activeId; return; }
    try { await api.post('/api/gsw/profiles/activate', { id: sel.value }); clearDraft(); ctx.go('GSW'); } catch (e) { alert(`Nicht gewechselt: ${e.message}`); sel.value = PR.activeId; }
  };
  const lab = html('<label><strong>Profil</strong> </label>'); lab.append(sel); bar.append(lab);
  if (PR.implicit) bar.append(html('<span class="hint" style="margin:0" title="data/gsw-profiles.json gibt es noch nicht; sie wird erst beim Speichern angelegt">implizit (noch nicht gespeichert)</span>'));
  if (PR.draft) bar.append(html(`<span class="warn" style="font-weight:600" title="${esc('Geändert: ' + PR.changed.join(', '))}">● geändert</span>`));
  const fields = profileFields(d.pairs || [], E);
  const overwrite = async (vals) => {
    if (!confirm(`Profil „${A.name}“ mit diesen Werten überschreiben?`)) return;
    try { await api.put('/api/gsw/profiles', { id: A.id, profile: { ...vals, name: A.name } }); clearDraft(); ctx.go('GSW'); } catch (e) { alert(`Nicht gespeichert: ${e.message}`); }
  };
  const saveNew = async (vals) => {
    const name = prompt('Name des neuen Profils:', `${A.name} (Kopie)`); if (!name) return;
    try { await api.post('/api/gsw/profiles', { profile: { ...vals, name, snapshot: null }, activate: true }); clearDraft(); ctx.go('GSW'); } catch (e) { alert(`Nicht gespeichert: ${e.message}`); }
  };
  const discard = () => { clearDraft(); ctx.go('GSW'); };
  if (PR.draft) {
    bar.append(btn('Überschreiben', 'Änderungen ins aktive Profil schreiben (data/gsw-profiles.json)', () => overwrite(E)), btn('Als neues Profil', 'Änderungen als neues Profil speichern und aktivieren; das bisherige Profil bleibt unverändert', () => saveNew(E)), btn('Verwerfen', 'Änderungen verwerfen, gespeichertes Profil laden', discard));
  }
  box.append(bar);
  if (A.snapshot) box.append(note(`Backtest-Snapshot: ${fmtSnap(A.snapshot)}`));
  if (A.note) box.append(note(`Notiz: ${A.note}`));
  const det = html('<details class="gsw-settings" style="margin:6px 0"><summary>⚙ Profilwerte bearbeiten (Handelspaar, Parameter, Haltefrist, Steuer) · Signal fix: GLD/SLV × k aus GC=F/SI=F</summary></details>');
  try { det.open = localStorage.getItem('amber.gsw.settingsOpen') === '1' || PR.draft; } catch {}
  det.addEventListener('toggle', () => { try { localStorage.setItem('amber.gsw.settingsOpen', det.open ? '1' : '0'); } catch {} });
  const form = html('<form style="margin:4px 0"></form>');
  form.append(html(`<span class="hint" style="margin:0" title="Nicht änderbar (Spezifikation v3)">Signal: sig = (GLD/SLV) × Median<sub>w</sub>[(GC=F/SI=F)/(GLD/SLV)] · Yahoo Close</span>`), fields);
  const fbar = html('<div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0"></div>');
  const apply = html('<button type="submit">Anwenden (Vorschau)</button>'); apply.title = 'Werte sofort in GSW anzeigen, ohne zu speichern; danach Überschreiben, Als neues Profil oder Verwerfen';
  fbar.append(apply, btn('Überschreiben', 'Formularwerte direkt ins aktive Profil speichern', () => overwrite(fields.read())), btn('Als neues Profil', 'Formularwerte als neues Profil speichern und aktivieren', () => saveNew(fields.read())),
    btn('Spec-Werte', 'GLD/SLV, 90/82/100/66, Median 60, 0,1 %, Start 2016-10-21, ohne Haltefrist, ohne Steuer ins Formular (nichts gespeichert)', () => {
      fields.pp.set({ pairId: 'GLDSLV', custom: {} });
      for (const [k, v] of Object.entries({ U1: 90, L1: 82, S: 100, L2: 66, window: 60, costPct: 0.1, start: '2016-10-21', holdDays: 365, taxMode: 'none', taxRate: 26.375, taxAllowance: 0, taxP23: 'auto', p23Rate: '' })) fields.querySelector(`[name=${k}]`).value = String(v);
      fields.querySelector('[name=holdOn]').checked = false;
    }));
  form.append(fbar);
  form.onsubmit = (e) => { e.preventDefault(); saveDraft(A.id, fields.read()); ctx.go('GSW'); };
  det.append(form);
  // Verwaltung: Aktivieren / Umbenennen / Löschen (aktives nicht löschbar)
  const man = html('<details style="margin:4px 0"><summary>Profile verwalten</summary></details>');
  man.append(table(PR.list.map((p) => ({ ...p, active: p.id === PR.activeId })), [
    { key: 'name', label: 'Profil', left: true, fmt: (v, r) => `${v}${r.active ? ' (aktiv)' : ''}` },
    { key: 'pairId', label: 'Paar', left: true },
    { key: 'snapshot', label: 'Snapshot', left: true, fmt: (v) => fmtSnap(v) || '—' },
    { key: '_a', label: '', html: true, left: true, fmt: (_, r) => `<span class="ibtns">${r.active ? '' : iconBtn('data-gsw-pact', r.id, '▶', 'Aktivieren')}${iconBtn('data-gsw-pren', r.id, '✎', 'Umbenennen / Notiz')}${r.active ? '' : iconBtn('data-gsw-pdel', r.id, '✕', 'Löschen (mit Rückfrage)', 'del')}</span>` },
  ]));
  man.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.gswPact || b.dataset.gswPren || b.dataset.gswPdel; if (!id) return;
    const p = PR.list.find((x) => x.id === id);
    try {
      if (b.dataset.gswPact) { if (PR.draft && !confirm('Ungespeicherte Änderungen verwerfen?')) return; await api.post('/api/gsw/profiles/activate', { id }); clearDraft(); ctx.go('GSW'); }
      else if (b.dataset.gswPren) { const name = prompt('Profilname:', p.name); if (!name || name === p.name) return; await api.put('/api/gsw/profiles', { id, profile: { name } }); ctx.go('GSW'); }
      else if (b.dataset.gswPdel) { if (id === PR.activeId) return alert('Das aktive Profil kann nicht gelöscht werden.'); if (!confirm(`Profil „${p.name}“ wirklich löschen?`)) return; await api.post('/api/gsw/profiles/delete', { id }); ctx.go('GSW'); }
    } catch (err) { alert(err.message); }
  });
  det.append(man);
  box.append(det);
  if (d.pair) box.append(note(`Paar: ${d.pair.label} (${d.pair.venue}, ${d.pair.currency})${kindShort(d.pair) ? ` · ${kindShort(d.pair)}` : ''}${d.pair.isin ? ` · ISIN ${d.pair.isin.join(' / ')}` : ''} · ${d.pair.note || ''}`));
  return box;
}

function holdingsBox(ctx, d) {
  const box = document.createElement('div');
  const pair = d.pair, cur = pair.currency, B = d.book;
  const post = async (body, msg) => {
    try { const r = await api.post('/api/gsw/book', body); ctx.go('GSW'); if (r?.message) setTimeout(() => console.info(r.message), 0); }
    catch (e) { alert(`${msg || 'Aktion'} fehlgeschlagen: ${e.message}`); }
  };
  const lastOf = (sym) => d.book.lastClose?.[sym]?.close ?? d.closes?.[sym];
  box.append(sect(`Holdings (GSW-Buch, profilunabhängig) · Profil: ${d.profile?.effective?.name || '—'}${d.profile?.draft ? ' (geändert)' : ''} · ${B.open.length} offen · Gold ${money(B.valueBy.gold, cur)} · Silber ${money(B.valueBy.silver, cur)}`));
  if (B.open.length) {
    const tb = table(B.open, [
      { key: 'metal', label: 'Metall', left: true, fmt: metalName },
      { key: 'symbol', label: 'Symbol', left: true },
      { key: 'action', label: 'Signal/Aktion', html: true, left: true, sort: false, title: 'Was die Regel (aktives Profil, aktuelles sig) für dieses Lot sagt. Rot = Swap fällig (Buch-Metall weicht vom Regel-Metall ab), orange = fällig, aber Haltefrist läuft, violett = Spike-Modus halten, grün = halten. Zweite Zeile: Abstand von sig zur nächsten Schwelle.', fmt: (v) => actionCell(v) },
      { key: 'qty', label: 'Stück', fmt: (v) => deMax(v, 6) },
      { key: 'buyPrice', label: 'Kauf-\nkurs', fmt: (v) => de(v, 4) },
      { key: 'buyDate', label: 'Kauf-\ndatum', fmt: deDate },
      ...(d.holdMin?.enabled ? [{ key: 'taxFreeFrom', label: 'steuerfrei ab\nResttage', title: 'Erster Tag nach Ablauf der optionalen Haltefrist (bei 365 Tagen: Kaufdatum + 1 Kalenderjahr + 1 Tag). Resttage bis dahin. Farbig, solange die Frist läuft. Keine Steuerberatung; die Frist gilt nicht automatisch.', html: true, fmt: (v, r) => {
        const until = r.taxFreeFrom || (r.buyDate ? holdUnlockDate(r.buyDate, d.holdMin.days) : null);
        if (!until) return '—';
        const rest = r.restDays ?? restHoldDays(r.buyDate, todayIso(), d.holdMin.days);
        const on = r.inHold ?? (rest > 0);
        return `<span class="${on ? 'down' : ''}" title="${esc(`steuerfrei ab ${deDate(until)}${on ? ` · noch ${rest} Tage` : ' · Frist abgelaufen'}`)}">${deDate(until)}<br>${on ? `${rest} Tage` : 'abgelaufen'}</span>`;
      } }] : []),
      { key: 'last', label: 'Letzter\nSchluss', fmt: (v) => de(v, 4), title: 'Letzter Tagesschluss (Yahoo)' },
      { key: 'value', label: 'Wert', fmt: (v) => money(v) },
      { key: 'pnl', label: 'P&L', fmt: (v) => money(v), cls: (v) => (v > 0 ? 'up' : v < 0 ? 'down' : ''), title: 'Wert − (Stück × Kaufkurs + Kaufgebühr)' },
      { key: 'pnlPct', label: 'P&L\n%', fmt: (v) => pcs(v), cls: (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '') },
      { key: 'buyFees', label: 'Geb.', fmt: (v) => (v ? de(v, 2) : '—'), title: 'Kaufgebühr (absolut, Lot-Währung)' },
      { key: 'currency', label: 'Währ.', left: true },
      { key: 'note', label: 'Notiz', left: true, short: 24 },
      { key: '_a', label: '', html: true, left: true, fmt: (_, r) => `<span class="ibtns">${iconBtn('data-gsw-go', gpCmd(r.symbol, B.open), 'GP', `Chart mit Kauflinie: ${gpCmd(r.symbol, B.open)}`, 'txt')}${iconBtn('data-gsw-sell', r.id, '⏏', 'Verkaufen (auch Teilverkauf)')}${iconBtn('data-gsw-edit', r.id, '✎', 'Bearbeiten')}${iconBtn('data-gsw-del', r.id, '✕', 'Löschen', 'del')}</span>` },
    ]);
    box.append(tb);
  } else box.append(note('Keine offenen Lots. Lege unten einen Kauf an (z. B. den aktuellen Bestand).'));
  // Swap-Knopf
  const fromMetal = B.metal === 'gold' || B.metal === 'silver' ? B.metal : null;
  const swapBar = html('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0"></div>');
  for (const from of ['gold', 'silver']) {
    const has = B.open.some((l) => l.metal === from);
    const b = btn(`Swap ${metalName(from)} → ${metalName(from === 'gold' ? 'silver' : 'gold')}`, has ? 'Alle offenen Lots dieses Metalls verkaufen, Erlös nach Kosten vollständig ins andere Metall (Dialog mit vorbelegten Kursen)' : 'Keine offenen Lots dieses Metalls', () => swapDialog(from));
    b.disabled = !has; if (fromMetal === from && d.hint?.level === 'due') b.style.outline = '2px solid #ff4a4a';
    swapBar.append(b);
  }
  box.append(swapBar);
  const dlgHost = document.createElement('div'); box.append(dlgHost);
  const histDlg = html('<div data-gsw-hist-dlg></div>'); // Bearbeiten aus der Historie erscheint dort
  function swapDialog(from) {
    const to = from === 'gold' ? 'silver' : 'gold';
    const lots = B.open.filter((l) => l.metal === from);
    const syms = [...new Set(lots.map((l) => l.symbol))];
    const toSym = to === 'gold' ? pair.gold : pair.silver;
    const f = html(`<form class="gsw-swap" style="border:1px solid #444;padding:8px;margin:6px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <strong>Swap ${metalName(from)} → ${metalName(to)}</strong>
      <label>Datum <input name="date" type="date" value="${todayIso()}"></label>
      ${syms.map((s) => `<label title="Verkaufskurs je Stück (vorbelegt: letzter Schluss)">Verkauf ${esc(s)} <input name="sp_${esc(s)}" value="${esc(String(lastOf(s) ?? ''))}" inputmode="decimal" style="width:80px"></label>`).join('')}
      <label>Kauf <input name="toSymbol" value="${esc(toSym)}" style="width:80px"></label>
      <label>Kurs <input name="toPrice" value="${esc(String(lastOf(toSym) ?? ''))}" inputmode="decimal" style="width:80px"></label>
      <label>Kosten %/Seite <input name="costPct" value="${esc(String(d.params.costPct))}" inputmode="decimal" style="width:50px"></label>
      <span class="gsw-preview hint" style="margin:0"></span>
      <p class="gsw-hold-warn hint" style="margin:0;width:100%;color:#ffa028"></p>
      <button type="submit">Swap ausführen</button></form>`);
    const num = (v) => Number(String(v).replace(/\s/g, '').replace(',', '.'));
    const preview = () => {
      const fd = Object.fromEntries(new FormData(f)); const k = num(fd.costPct) / 100;
      let gross = 0; for (const l of lots) gross += l.qty * num(fd[`sp_${l.symbol}`]);
      const qty = (gross * (1 - k) * (1 - k)) / num(fd.toPrice);
      f.querySelector('.gsw-preview').textContent = Number.isFinite(qty) && qty > 0 ? `Erlös ${money(gross)} ${cur} → ≈ ${deMax(qty, 6)} ${fd.toSymbol} (Kosten ≈ ${money(gross - gross * (1 - k) * (1 - k))})` : 'Kurse prüfen';
      const w = f.querySelector('.gsw-hold-warn');
      w.textContent = '';
      if (d.holdMin?.enabled) {
        const asOf = fd.date || todayIso();
        const hit = lots.filter((l) => inHoldPeriod(l.buyDate, asOf, d.holdMin.days));
        if (hit.length) {
          let gain = 0;
          for (const l of hit) { const px = num(fd[`sp_${l.symbol}`]); if (Number.isFinite(px)) gain += l.qty * (px - l.buyPrice); }
          const untils = hit.map((l) => holdUnlockDate(l.buyDate, d.holdMin.days)).sort();
          w.textContent = `Warnung: ${hit.length} Lot(s) noch in der Haltefrist (steuerfrei ab ${untils.map(deDate).join(', ')}). Betroffener Gewinn ≈ ${money(gain)} ${cur}. Verkauf wird nicht blockiert. Keine Steuerberatung.`;
        }
      }
    };
    f.addEventListener('input', preview); preview();
    f.append(btn('Abbrechen', '', () => dlgHost.replaceChildren()));
    f.onsubmit = (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      if (!confirm(`Swap ${metalName(from)} → ${metalName(to)} am ${fd.date}: ${lots.length} Lot(s) verkaufen und ${fd.toSymbol} kaufen?`)) return;
      post({ action: 'SWAP', from, date: fd.date, prices: Object.fromEntries(syms.map((s) => [s, fd[`sp_${s}`]])), toSymbol: fd.toSymbol, toPrice: fd.toPrice, costPct: fd.costPct, currency: lots[0].currency }, 'Swap');
    };
    dlgHost.replaceChildren(f);
  }
  box.addEventListener('click', (e) => {
    const go = e.target.closest('button[data-gsw-go]'); if (go) { e.stopPropagation(); ctx.go(go.dataset.gswGo); return; }
    const sell = e.target.closest('button[data-gsw-sell]'), ed = e.target.closest('button[data-gsw-edit]'), del = e.target.closest('button[data-gsw-del]'), ro = e.target.closest('button[data-gsw-reopen]');
    const id = (sell || ed || del || ro)?.dataset.gswSell || (sell || ed || del || ro)?.dataset.gswEdit || (sell || ed || del || ro)?.dataset.gswDel || (sell || ed || del || ro)?.dataset.gswReopen;
    if (!id) return;
    e.stopPropagation();
    const lot = [...B.open, ...B.closed].find((l) => l.id === id); if (!lot) return;
    if (del) { if (confirm(`Lot ${lot.symbol} (${deMax(lot.qty)} Stück, Kauf ${deDate(lot.buyDate)}) löschen?`)) post({ action: 'DELETE', id }, 'Löschen'); return; }
    if (ro) { if (confirm(`Lot ${lot.symbol} wieder öffnen?`)) post({ action: 'REOPEN', id }, 'Wieder öffnen'); return; }
    const host = e.target.closest('[data-gsw-hist]') ? histDlg : dlgHost;
    if (sell) { lotForm(lot, 'SELL', host); return; }
    if (ed) lotForm(lot, 'EDIT', host);
  });
  function lotForm(lot, mode, host = dlgHost) {
    const f = html(mode === 'SELL'
      ? `<form style="border:1px solid #444;padding:8px;margin:6px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><strong>Verkauf ${esc(lot.symbol)}</strong>
        <label>Datum <input name="sellDate" type="date" value="${todayIso()}"></label><label>Kurs <input name="sellPrice" value="${esc(String(lastOf(lot.symbol) ?? ''))}" inputmode="decimal" style="width:80px"></label>
        <label title="Leer = ganzes Lot; weniger = Teilverkauf">Stück <input name="qty" value="${esc(String(lot.qty))}" inputmode="decimal" style="width:80px"></label>
        <label title="Verkaufsgebühr absolut in ${esc(lot.currency)} (leer = 0)">Gebühr <input name="sellFees" inputmode="decimal" style="width:60px"></label>
        <p class="gsw-hold-warn hint" style="margin:0;width:100%;color:#ffa028"></p>
        <button type="submit">Verkaufen</button></form>`
      : `<form style="border:1px solid #444;padding:8px;margin:6px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><strong>Bearbeiten ${esc(lot.symbol)}</strong>
        <select name="metal"><option value="gold"${lot.metal === 'gold' ? ' selected' : ''}>Gold</option><option value="silver"${lot.metal === 'silver' ? ' selected' : ''}>Silber</option></select>
        <input name="symbol" value="${esc(lot.symbol)}" style="width:80px"><label>Stück <input name="qty" value="${esc(String(lot.qty))}" style="width:80px"></label>
        <label>Kauf <input name="buyDate" type="date" value="${esc(lot.buyDate)}"></label><label>Kurs <input name="buyPrice" value="${esc(String(lot.buyPrice))}" style="width:80px"></label>
        <label title="Kaufgebühr absolut in Lot-Währung (leer = 0)">Geb. <input name="buyFees" value="${esc(lot.buyFees ? String(lot.buyFees) : '')}" inputmode="decimal" style="width:60px"></label>
        ${lot.status === 'closed' ? `<label>Verkauf <input name="sellDate" type="date" value="${esc(lot.sellDate || '')}"></label><label>Kurs <input name="sellPrice" value="${esc(String(lot.sellPrice ?? ''))}" style="width:80px"></label><label title="Verkaufsgebühr absolut (leer = 0)">Geb. <input name="sellFees" value="${esc(lot.sellFees ? String(lot.sellFees) : '')}" inputmode="decimal" style="width:60px"></label>` : ''}
        <input name="currency" value="${esc(lot.currency)}" style="width:44px"><input name="note" value="${esc(lot.note || '')}" placeholder="Notiz" style="width:140px"><button type="submit">Speichern</button></form>`);
    f.append(btn('Abbrechen', '', () => host.replaceChildren()));
    if (mode === 'SELL' && d.holdMin?.enabled) {
      const warnSell = () => {
        const fd = Object.fromEntries(new FormData(f));
        const asOf = fd.sellDate || todayIso();
        const w = f.querySelector('.gsw-hold-warn');
        if (!inHoldPeriod(lot.buyDate, asOf, d.holdMin.days)) { w.textContent = ''; return; }
        const px = Number(String(fd.sellPrice || '').replace(',', '.'));
        const qty = Number(String(fd.qty || lot.qty).replace(',', '.'));
        const gain = Number.isFinite(px) && Number.isFinite(qty) ? qty * (px - lot.buyPrice) : null;
        w.textContent = `Warnung: Lot noch in der Haltefrist (steuerfrei ab ${deDate(holdUnlockDate(lot.buyDate, d.holdMin.days))}). Betroffener Gewinn ≈ ${money(gain)} ${cur}. Verkauf wird nicht blockiert. Keine Steuerberatung.`;
      };
      f.addEventListener('input', warnSell); warnSell();
    }
    f.onsubmit = (e) => {
      e.preventDefault(); const fd = Object.fromEntries(new FormData(f));
      if (mode === 'SELL' && !confirm(`Verkauf ${lot.symbol}: ${fd.qty || lot.qty} Stück zu ${fd.sellPrice}?`)) return;
      post({ action: mode, id: lot.id, ...fd }, mode === 'SELL' ? 'Verkauf' : 'Bearbeiten');
    };
    host.replaceChildren(f);
  }
  // Kauf-Formular
  const buy = html(`<form class="gsw-buy" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0"><strong>Kauf</strong>
    <select name="metal"><option value="gold">Gold</option><option value="silver">Silber</option></select>
    <input name="symbol" value="${esc(pair.gold)}" style="width:80px" title="Symbol (vorbelegt: Instrument des Handelspaars)">
    <label>Datum <input name="buyDate" type="date" value="${todayIso()}"></label>
    <input name="buyPrice" placeholder="Kurs" value="${esc(String(lastOf(pair.gold) ?? ''))}" inputmode="decimal" style="width:80px">
    <input name="qty" placeholder="Stück" inputmode="decimal" style="width:80px" title="Stückzahl, Bruchstücke erlaubt">
    <input name="amount" placeholder="oder Betrag" inputmode="decimal" style="width:90px" title="Statt Stück: Betrag in Paarwährung (abzgl. Kosten je Seite)">
    <input name="currency" value="${esc(cur)}" style="width:44px"><input name="note" placeholder="Notiz" style="width:120px"><button type="submit">Kaufen</button></form>`);
  const mSel = buy.querySelector('[name=metal]');
  mSel.onchange = () => { const s = mSel.value === 'gold' ? pair.gold : pair.silver; buy.querySelector('[name=symbol]').value = s; buy.querySelector('[name=buyPrice]').value = String(lastOf(s) ?? ''); };
  buy.onsubmit = (e) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(buy)); post({ action: 'BUY', ...fd, costPct: d.params.costPct }, 'Kauf'); };
  box.append(buy);
  box.append(historySection(ctx, d, histDlg));
  box.append(note('Buch: data/gsw-book.json (getrennt vom RSL-Buch). Swap = alle offenen Lots eines Metalls zum angegebenen Kurs verkaufen, Erlös × (1 − Kosten) × (1 − Kosten) / Kaufkurs = neue Stückzahl, wie im Backtest. Haltefrist (falls eingeschaltet): Warnung, kein Block.'));
  return box;
}

// ---------- Historie: Equity des echten Buchs + geschlossene Lots (wie RSL26 „Equity der Holdings“) ----------
function historySection(ctx, d, histDlg) {
  const B = d.book, cur = d.pair.currency;
  const eqBody = html('<div data-gsw-equity></div>');
  let chart = null;
  ctx.onCleanup?.(() => chart?.remove());
  const loadEq = async () => {
    eqBody.replaceChildren(note('Lade Equity des Buchs…'));
    try {
      const r = await api.get('/api/gsw/history');
      if (!ctx.live()) return;
      eqBody.replaceChildren();
      if (r.points?.length) {
        const S = r.stats, c = r.currency;
        eqBody.append(note(`Seit ${deDate(r.first)}: eingezahlt ${money(S.deposits, c)} · Equity ${money(S.equity, c)} · G/V ${money(S.pnl, c)} (${pcs(S.pnlPct)}) · davon realisiert ${money(S.realized, c)} · Gebühren ${money(S.fees, c)}${S.rule != null ? ` · Regel gleiche Einzahlungen ${money(S.rule, c)}` : ''}${S.bhGold != null ? ` · Buy & Hold ${r.pair.gold} ${money(S.bhGold, c)}` : ''}${S.bhSilver != null ? ` · Buy & Hold ${r.pair.silver} ${money(S.bhSilver, c)}` : ''}`));
        const host = html('<div data-gsw-equity-chart></div>'); eqBody.append(host);
        const series = [{ title: `Buch (${c})`, color: '#ffa028', data: r.points.map((p) => ({ time: p.date, value: p.equity })) }];
        if (r.points.some((p) => p.rule != null)) series.push({ title: `Regel ${r.rule?.profile || ''}`.trim(), color: '#63a9ff', data: r.points.filter((p) => p.rule != null).map((p) => ({ time: p.date, value: p.rule })) });
        if (r.points.some((p) => p.bhGold != null)) series.push({ title: `Buy & Hold ${r.pair.gold}`, color: '#f2d21b', data: r.points.filter((p) => p.bhGold != null).map((p) => ({ time: p.date, value: p.bhGold })) });
        if (r.points.some((p) => p.bhSilver != null)) series.push({ title: `Buy & Hold ${r.pair.silver}`, color: '#c0c0c0', data: r.points.filter((p) => p.bhSilver != null).map((p) => ({ time: p.date, value: p.bhSilver })) });
        series.push({ title: 'Einzahlungen', color: '#777', flows: true, data: r.points.map((p) => ({ time: p.date, value: p.deposits })) });
        chart?.remove();
        chart = equityChart(host, series, { storeKey: 'gsw-book', cur: c });
      }
      for (const n of [r.method, ...(r.notes || [])].filter(Boolean)) eqBody.append(note(n));
    } catch (e) { eqBody.replaceChildren(note(`Equity nicht verfügbar: ${e.message}`)); }
  };
  const nodes = [
    note(`Wert des echten GSW-Buchs über die Zeit (${cur}): Buchungen + Tagesschlüsse; zum Vergleich die Regel (aktives Profil) sowie Buy & Hold Gold und Buy & Hold Silber mit denselben Einzahlungen. Darunter alle geschlossenen Lots mit Bearbeiten/Löschen.`),
    eqBody,
  ];
  if (B.closed.length) {
    const tb = table(B.closed, [
      { key: 'exitKind', label: 'Art', left: true, title: 'Swap = im Swap-Knopf verkauft, Verkauf = Einzelverkauf' },
      { key: 'metal', label: 'Metall', left: true, fmt: metalName }, { key: 'symbol', label: 'Symbol', left: true }, { key: 'qty', label: 'Stück', fmt: (v) => deMax(v, 6) },
      { key: 'buyDate', label: 'Kauf', fmt: deDate }, { key: 'buyPrice', label: 'Kauf-\nkurs', fmt: (v) => de(v, 4) }, { key: 'sellDate', label: 'Verkauf/\nSwap', fmt: deDate }, { key: 'sellPrice', label: 'Verk.-\nkurs', fmt: (v) => de(v, 4) },
      { key: 'fees', label: 'Gebühren', fmt: (v) => (v ? de(v, 2) : '—'), title: 'Kauf- + Verkaufsgebühr (absolut)' },
      { key: 'pnl', label: 'G/V', fmt: (v) => money(v), cls: (v) => (v > 0 ? 'up' : v < 0 ? 'down' : ''), title: 'Stück × (Verkaufskurs − Kaufkurs) − Gebühren, in Lot-Währung' }, { key: 'pnlPct', label: 'G/V\n%', fmt: (v) => pcs(v), cls: (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '') },
      { key: 'holdDaysHeld', label: 'Halte-\ndauer', fmt: (v) => (Number.isFinite(v) ? `${v} Tg` : '—'), title: 'Kalendertage Kauf → Verkauf' },
      { key: 'taxFreeFrom', label: 'steuerfrei\nab', html: true, fmt: (v, r) => (v ? `<span class="${r.soldTaxFree ? 'up' : ''}" title="${r.soldTaxFree ? 'nach Fristende verkauft' : 'vor Fristende verkauft'} · Frist ${esc(String(d.holdMin?.days || 365))} Tage (aktives Profil). Keine Steuerberatung.">${deDate(v)}</span>` : '—') },
      { key: 'note', label: 'Notiz', left: true, short: 24 },
      { key: '_a', label: '', html: true, left: true, fmt: (_, r) => `<span class="ibtns">${iconBtn('data-gsw-edit', r.id, '✎', 'Bearbeiten (Datum, Kurs, Stück, Gebühren, Notiz)')}${iconBtn('data-gsw-reopen', r.id, '↺', 'Wieder öffnen')}${iconBtn('data-gsw-del', r.id, '✕', 'Löschen (mit Rückfrage)', 'del')}</span>` },
    ]);
    const wrap = html('<div data-gsw-hist></div>');
    wrap.append(html(`<h4 style="margin:8px 0 2px">Historische Lots (${B.closed.length})</h4>`), tb, histDlg);
    nodes.push(wrap);
  } else nodes.push(note('Noch keine geschlossenen Lots.'));
  return collapsible('history', `📈 Historie: Equity des Buchs & historische Lots (${B.closed.length} geschlossen)`, nodes, { onOpen: loadEq });
}

// ================= GSWBT =================
const BT_KEY = 'amber.gswbt.form';
async function gswbt(ctx) {
  const charts = []; ctx.onCleanup?.(() => charts.forEach((c) => c.remove()));
  let settings = null, pairs = [];
  try { const s = await api.get('/api/gsw/settings'); settings = s.settings; pairs = s.pairs || []; } catch {}
  let PRF = null; try { PRF = await api.get('/api/gsw/profiles'); } catch {}
  if (!ctx.live()) return;
  const activeP = PRF?.profiles?.find((p) => p.id === PRF.activeId) || null;
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(BT_KEY) || '{}'); } catch {}
  const g0 = { U1: '78-96/1', gap: '2,3,4,5,6,8,10,12,14', S: '92-112/2', L2: '60-78/2', window: '60', costPct: '0.1', ...(saved.grid || {}) };
  const f0 = { start: '2016-10-21', end: '', wfStart: '2019-10-21', oosStart: '2023-10-20', ...saved };
  ctx.el.replaceChildren(sect('GSW-Backtest · GSWBT · Grid, Robustheit (Nachbarschaftsmittel End-Unzen), Walk-Forward, OOS-Neustart'));
  const form = html('<form style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0"></form>');
  const pp = pairPicker(pairs, { pairId: saved.pairId || activeP?.pairId || settings?.pairId || 'GLDSLV', custom: saved.custom || activeP?.custom || settings?.custom || {} });
  // Profile: laden füllt Paar, Sperre, Steuer und Einzelparameter
  const profBar = html('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%"><strong title="Parameter-Profile aus data/gsw-profiles.json (gemeinsam mit GSW)">Profil</strong></div>');
  const profSel = html(`<select name="btProfile">${(PRF?.profiles || []).map((p) => `<option value="${esc(p.id)}"${p.id === PRF.activeId ? ' selected' : ''}>${esc(profLabel(p))}${p.id === PRF.activeId ? ' (aktiv in GSW)' : ''}</option>`).join('')}</select>`);
  profBar.append(profSel, btn('Laden', 'Profil ins Formular laden: Handelspaar, Sperre, Steuer und Einzelparameter (Grid bleibt)', () => {
    const p = (PRF?.profiles || []).find((x) => x.id === profSel.value); if (!p) return;
    pp.set({ pairId: p.pairId, custom: p.custom });
    const setv = (n, v) => { const el = form.querySelector(`[name=${n}]`); if (el) el.value = v == null ? '' : String(v); };
    form.querySelector('[name=holdLock]').checked = !!p.hold?.on; setv('holdDays', p.hold?.days ?? 365);
    setv('taxMode', p.tax?.mode || 'none'); setv('taxRate', p.tax?.rate ?? 26.375); setv('taxAllowance', p.tax?.allowance ?? 0); setv('taxP23', p.tax?.p23 || 'auto'); setv('p23Rate', p.tax?.p23Rate ?? '');
    for (const [k] of PARAM_FIELDS) setv(`s_${k}`, p.params?.[k]);
    if (p.start) setv('start', p.start);
    status.replaceChildren(note(`Profil „${p.name}“ geladen.${p.snapshot ? ` Snapshot: ${fmtSnap(p.snapshot)}` : ''}`));
  }));
  if (PRF?.implicit) profBar.append(html('<span class="hint" style="margin:0">implizit (data/gsw-profiles.json noch nicht angelegt)</span>'));
  form.append(profBar, pp);
  for (const [k, lab, tip] of [['start', 'Start', 'Signal-/Backtest-Start (Spec 2016-10-21)'], ['end', 'Ende', 'leer = letzter Schluss (Spec-Referenz: 2026-10-21)'], ['wfStart', 'WF ab', 'Walk-Forward: jährliche Neuwahl ab diesem Datum (leer = aus)'], ['oosStart', 'OOS ab', 'OOS-Neustart mit 10.000 ab diesem Datum (leer = aus)']])
    form.append(html(`<label title="${esc(tip)}">${lab} <input name="${k}" type="date" value="${esc(f0[k] || '')}"></label>`));
  const gridRow = html('<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%"><strong title="Bereich a-b/Schritt oder Liste 1,2,3">Grid</strong></div>');
  for (const [k, lab, tip] of [['U1', 'Einstieg U1', 'z. B. 78-96/1'], ['gap', 'Abstand U1−L1', 'Liste, z. B. 2,3,4,5,6,8,10,12,14 (L1 = U1 − Abstand)'], ['S', 'Spike S', 'z. B. 92-112/2'], ['L2', 'Spike-Exit L2', 'z. B. 60-78/2'], ['window', 'Median', 'z. B. 60 oder 40,60,80'], ['costPct', 'Kosten %', 'z. B. 0.1']])
    gridRow.append(html(`<label title="${esc(tip)}">${lab} <input name="g_${k}" value="${esc(g0[k])}" style="width:${k === 'gap' ? 150 : 80}px"></label>`));
  form.append(gridRow);
  form.append(html(`<label title="Optionale Swap-Sperre: ein Regel-Swap wird aufgeschoben, solange die aktuelle Position jünger als N Tage ist (Anschaffung = letzter Swap bzw. Erstkauf). Nach Fristende Swap am nächsten Handelstag, sofern die Zustandsmaschine dann noch das andere Metall will; sonst entfällt er. Die Zustandsmaschine (inkl. Spike) läuft unverändert auf dem Signal weiter. Feste Einstellung, keine Grid-Achse. Keine Steuerberatung."><input type="checkbox" name="holdLock"${f0.holdLock ? ' checked' : ''}> Haltefrist als Swap-Sperre</label>`));
  form.append(html(`<label title="Tage der Swap-Sperre (Default 365, gleiche Formel wie 'steuerfrei ab': Kauf + 1 Jahr + 1 Tag).">Tage <input name="holdDays" value="${esc(String(f0.holdDays || 365))}" inputmode="numeric" style="width:52px"></label>`));
  const taxRow = html('<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%"><strong title="Keine Steuerberatung. Vereinfachtes Modell.">Steuer</strong></div>');
  const tm = f0.taxMode === 'kest' ? 'kest' : 'none';
  taxRow.append(html(`<label title="ohne Steuer = Rohertrag (z. B. physischer Swap außerhalb Deutschlands). Abgeltungsteuer + Soli = 25 % × 1,055 = 26,375 % auf jeden realisierten Gewinn (Swap = Verkauf + Neukauf), keine Kirchensteuer. Keine Steuerberatung.">Modus <select name="taxMode"><option value="none"${tm === 'none' ? ' selected' : ''}>ohne Steuer (Rohertrag)</option><option value="kest"${tm === 'kest' ? ' selected' : ''}>Abgeltungsteuer + Soli</option></select></label>`));
  taxRow.append(html(`<label title="Satz in % (Default 26,375 = 25 % + 5,5 % Soli, ohne Kirchensteuer)">Satz % <input name="taxRate" value="${esc(String(f0.taxRate ?? '26.375'))}" style="width:60px"></label>`));
  taxRow.append(html(`<label title="Optionaler Sparer-Pauschbetrag je Kalenderjahr in Paarwährung (Default 0). Gilt nicht für §23.">Pauschbetrag <input name="taxAllowance" value="${esc(String(f0.taxAllowance ?? '0'))}" inputmode="numeric" style="width:60px"></label>`));
  const p23m = ['auto', 'on', 'off'].includes(f0.taxP23) ? f0.taxP23 : 'auto';
  taxRow.append(html(`<label title="§23 EStG (privates Veräußerungsgeschäft) nur bei Paaren mit Lieferanspruch (Art physical-delivery, z. B. 8PSG/8PSB): Gewinne ab „steuerfrei ab“ (Kauf + 1 Jahr + 1 Tag) steuerfrei, davor mit dem §23-Satz; Verluste nach der Frist zählen nicht. auto = an, wenn die Haltefrist-Option des Paars in GSW an ist. Für alle anderen Arten gilt immer die Abgeltungsteuer.">§23 <select name="taxP23"><option value="auto"${p23m === 'auto' ? ' selected' : ''}>auto</option><option value="on"${p23m === 'on' ? ' selected' : ''}>an (nur Lieferanspruch)</option><option value="off"${p23m === 'off' ? ' selected' : ''}>aus</option></select></label>`));
  taxRow.append(html(`<label title="§23 wird eigentlich mit dem persönlichen Einkommensteuersatz (+ Soli) besteuert, nicht mit 26,375 %. Hier deinen Satz eintragen; leer = wie Satz oben.">§23-Satz % <input name="p23Rate" value="${esc(String(f0.p23Rate ?? ''))}" placeholder="wie oben" style="width:60px"></label>`));
  taxRow.append(html('<span class="hint" title="Vereinfachung">keine Steuerberatung · Währungseffekte ignoriert (Gewinn in Paarwährung)</span>'));
  form.append(taxRow);
  const s0 = { ...(activeP?.params || { U1: 90, L1: 82, S: 100, L2: 66, window: 60, costPct: 0.1 }), ...(saved.single || {}) };
  const singleRow = html('<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%"><strong title="Ein Lauf mit festen Parametern (ohne Grid)">Einzellauf</strong></div>');
  for (const [k, lab, tip] of PARAM_FIELDS) singleRow.append(html(`<label title="${esc(tip)}">${esc(lab)} <input name="s_${k}" value="${esc(String(s0[k] ?? ''))}" inputmode="decimal" style="width:52px"></label>`));
  singleRow.append(btn('Einzellauf', 'Backtest mit diesen festen Parametern (Paar, Zeitraum, Sperre, Steuer wie oben)', () => runSingleNow()), btn('Als Profil speichern', 'Einzellauf rechnen und als Profil speichern (Name abfragen, Kennzahlen als Snapshot)', () => runSingleNow(true)));
  form.append(singleRow);
  const run = html('<button type="submit">Backtest starten</button>');
  form.append(run, btn('Spec-Grid', 'Grid wie v3 grid.py (15.570 Hybrid-Zellen)', () => { for (const [k, v] of Object.entries({ U1: '78-96/1', gap: '2,3,4,5,6,8,10,12,14', S: '92-112/2', L2: '60-78/2', window: '60', costPct: '0.1' })) form.querySelector(`[name=g_${k}]`).value = v; }));
  ctx.el.append(form, note('Signal fix aus GLD/SLV + GC=F/SI=F. Ausführung, Equity und Kosten mit den Kursen des gewählten Paars (Paarwährung, Start 10.000). Zelle mit L2 < L1 und S > U1. Auswahl = max. Nachbarschaftsmittel der End-Unzen (±1 Gitterschritt je Achse), nicht die Zelle mit dem höchsten Rohwert. Haltefrist als Swap-Sperre (optional): Zustandsmaschine unverändert, nur die Ausführung wird aufgeschoben oder entfällt.'));
  const status = document.createElement('div'), singleHost = document.createElement('div'), out = document.createElement('div');
  ctx.el.append(status, singleHost, out);
  const singleCharts = [];
  const readReq = () => {
    const fd = Object.fromEntries(new FormData(form));
    const grid = Object.fromEntries(['U1', 'gap', 'S', 'L2', 'window', 'costPct'].map((k) => [k, fd[`g_${k}`]]));
    const single = Object.fromEntries(PARAM_FIELDS.map(([k]) => [k, String(fd[`s_${k}`] ?? '').replace(',', '.')]));
    return { ...pp.read(), start: fd.start, end: fd.end, wfStart: fd.wfStart, oosStart: fd.oosStart, grid, single, holdLock: !!form.querySelector('[name=holdLock]').checked, holdDays: Number(String(fd.holdDays).replace(',', '.')),
      taxMode: fd.taxMode || 'none', taxRate: fd.taxRate, taxAllowance: fd.taxAllowance, taxP23: fd.taxP23 || 'auto', p23Rate: fd.p23Rate };
  };
  /** Profil aus einem Lauf speichern: Paar/Sperre/Steuer aus dem Request, Parameter und Kennzahlen aus dem Lauf. */
  async function saveRunAsProfile(S, req, source) {
    const p = S.params, m = S.metrics;
    const name = prompt(`Profilname (${p.U1}/${p.L1}/${p.S}/${p.L2} · ${S.pair?.label || req.pairId}):`, `${S.pair?.label || req.pairId} ${p.U1}/${p.L1}/${p.S}/${p.L2}${req.holdLock ? ` Sperre ${req.holdDays}` : ''}${req.taxMode === 'kest' ? ' KapESt' : ''}`);
    if (!name) return;
    const activate = confirm('Profil gleich in GSW aktivieren? (OK = aktivieren, Abbrechen = nur speichern)');
    const profile = { name, pairId: req.pairId, custom: req.custom, params: p, start: req.start || '2016-10-21', hold: { on: !!req.holdLock, days: req.holdDays || 365 },
      tax: { mode: req.taxMode || 'none', rate: req.taxRate, allowance: req.taxAllowance, p23: req.taxP23 || 'auto', p23Rate: req.p23Rate }, note: `aus GSWBT (${source})`,
      snapshot: { start: m.startDate, end: m.endDate, endValue: m.endValue, cagr: m.cagr, maxdd: m.maxdd, switches: m.switches, lapsed: m.lapsed, taxPaid: m.taxPaid, endValueAfterLiq: m.endValueAfterLiq, cagrAfterLiq: m.cagrAfterLiq, currency: S.currency, pair: S.pair?.label, source, at: new Date().toISOString() } };
    try {
      const r = await api.post('/api/gsw/profiles', { profile, activate });
      PRF = { ...PRF, ...r }; profSel.append(html(`<option value="${esc(r.profile.id)}">${esc(profLabel(r.profile))}</option>`));
      alert(`Profil „${r.profile.name}“ gespeichert${activate ? ' und in GSW aktiviert' : ''}.`);
    } catch (e) { alert(`Nicht gespeichert: ${e.message}`); }
  }
  async function runSingleNow(andSave = false) {
    const req = readReq();
    try { localStorage.setItem(BT_KEY, JSON.stringify(req)); } catch {}
    status.replaceChildren(note('Einzellauf…'));
    try {
      const S = await api.post('/api/gsw/run', { ...req, params: req.single });
      status.replaceChildren(note(`Einzellauf fertig · ${S.pair.label} (${S.currency})`));
      singleCharts.splice(0).forEach((c) => c.remove());
      renderRun(singleHost, S, 'Einzellauf', req, singleCharts);
      if (andSave) await saveRunAsProfile(S, req, 'Einzellauf');
    } catch (e) { status.replaceChildren(note(`Fehler: ${e.message}`)); }
  }
  const selCharts = [];
  ctx.onCleanup?.(() => { singleCharts.forEach((c) => c.remove()); selCharts.forEach((c) => c.remove()); });
  /** Detailansicht eines Laufs (Kennzahlen, Kurve, Unzen, Wechsel) mit „Als Profil speichern“. */
  function renderRun(host, S, label, req, chartList) {
    host.replaceChildren();
    const p = S.params, cur = S.currency, pair = S.pair;
    host.append(sect(`${label}: U1 ${p.U1} · L1 ${p.L1} · S ${p.S} · L2 ${p.L2} · Median ${p.window} · Kosten ${deMax(p.costPct, 3)} % · ${pair.label}`));
    const bar = html('<div style="display:flex;gap:8px;margin:4px 0"></div>');
    bar.append(btn('Als Profil speichern', 'Diese Parameter mit Paar, Sperre und Steuer als Profil speichern (data/gsw-profiles.json); Kennzahlen als Snapshot', () => saveRunAsProfile(S, req, label)), btn('GSW öffnen', '', () => ctx.go('GSW')));
    host.append(bar);
    const rows = [[label, S], ['Buy & Hold ' + pair.gold, { metrics: S.bh.gold, bhOnly: true }], ['Buy & Hold ' + pair.silver, { metrics: S.bh.silver, bhOnly: true }]];
    host.append(metricsTable(rows, cur));
    if (S.tax && S.tax.mode === 'kest') host.append(note(taxNote(S.tax)));
    const eqHost = document.createElement('div'); host.append(eqHost);
    const c = S.curve; const pt = (a) => a.map((v, i) => ({ time: c.dates[i], value: v }));
    chartList.push(equityChart(eqHost, [
      { title: `Swap (${cur})`, color: '#ffa028', data: pt(c.eq) },
      { title: `B&H ${pair.gold}`, color: '#f2d21b', data: pt(c.bhGold) },
      { title: `B&H ${pair.silver}`, color: '#c0c0c0', data: pt(c.bhSilver) },
    ], { storeKey: 'gswbt', cur }));
    const ozHost = document.createElement('div');
    if (c.oz.some(Number.isFinite)) { host.append(sect('Gold-Unzen-Äquivalent (Equity × FX / GC=F)'), ozHost); chartList.push(multiChart(ozHost, [{ title: 'Gold-oz', color: '#f2d21b', data: c.oz.map((v, i) => ({ time: toTime(c.dates[i]), value: v })) }], { height: 200 })); }
    host.append(sect(`Wechsel (${S.trades.length})`), tradesTable(S.trades, cur, pair));
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const req = readReq();
    try { localStorage.setItem(BT_KEY, JSON.stringify(req)); } catch {}
    run.disabled = true; status.replaceChildren(note('Lade Kurse…'));
    try {
      const job = await api.post('/api/gsw/bt', req);
      const poll = async () => {
        if (!ctx.live()) return;
        const j = await api.get(`/api/gsw/bt?id=${encodeURIComponent(job.id)}`);
        if (j.status === 'done') { run.disabled = false; status.replaceChildren(note(`Fertig: ${j.result.cells.toLocaleString('de-DE')} Zellen in ${(j.result.ms / 1000).toLocaleString('de-DE')} s · ${j.pair.label} (${j.pair.currency}) · ${deDate(j.result.span.start)} – ${deDate(j.result.span.end)} (${j.result.span.days} Tage)`)); renderResult(j.result, req); return; }
        if (j.status === 'error') { run.disabled = false; status.replaceChildren(note(`Fehler: ${j.error}`)); return; }
        status.replaceChildren(html(`<p class="hint">${j.status === 'loading' ? 'Lade Kurse…' : `Grid ${j.progress.toLocaleString('de-DE')} / ${j.total.toLocaleString('de-DE')}`} <progress max="${j.total || 1}" value="${j.progress || 0}"></progress></p>`));
        setTimeout(poll, 600);
      };
      poll();
    } catch (err) { run.disabled = false; status.replaceChildren(note(`Fehler: ${err.message}`)); }
  };

  function renderResult(r, req) {
    charts.splice(0).forEach((c) => c.remove());
    out.replaceChildren();
    const cur = r.pair.currency;
    const sel = r.selected;
    const selHost = document.createElement('div');
    const showSelected = (S, label) => { selCharts.splice(0).forEach((c) => c.remove()); renderRun(selHost, S, label, req, selCharts); };
    out.append(selHost);
    showSelected(sel, r.selectedIsPick ? 'Robust-Auswahl (Rang 1 nach Nachbarschaftsmittel)' : 'Auswahl');
    // Vergleich
    const cmp = [['Robust-Auswahl', sel]];
    if (r.wf && !r.wf.error) cmp.push([`Walk-Forward ab ${deDate(r.wf.metrics.startDate)} (jährl. neu)`, r.wf]);
    if (r.oos) { cmp.push([`OOS-Neustart ${deDate(r.oos.start)} · Auswahl fest`, r.oos.fixed]); cmp.push([`OOS-Neustart ${deDate(r.oos.start)} · nur Daten bis dahin gewählt`, r.oos.picked]); }
    out.append(sect('Vergleich: statisch, Walk-Forward, OOS (Neustart mit 10.000, Start in Gold)'), metricsTable(cmp, cur, true));
    if (r.wf?.error) out.append(note(`Walk-Forward: ${r.wf.error}`));
    if (r.wf?.plan) {
      out.append(sect('Walk-Forward-Plan (Wahl je Jahrestag mit Daten bis dahin)'), table(r.wf.plan, [
        { key: 'date', label: 'Ab', fmt: deDate }, { key: 'U1', label: 'U1' }, { key: 'L1', label: 'L1' }, { key: 'S', label: 'S' }, { key: 'L2', label: 'L2' }, { key: 'window', label: 'Median' }, { key: 'costPct', label: 'Kosten %', fmt: (v) => deMax(v, 3) },
      ]));
      const wfHost = document.createElement('div'); out.append(wfHost);
      const c = r.wf.curve; const pt = (a) => a.map((v, i) => ({ time: c.dates[i], value: v }));
      charts.push(equityChart(wfHost, [{ title: 'Walk-Forward', color: '#ffa028', data: pt(c.eq) }, { title: `B&H ${r.pair.gold}`, color: '#f2d21b', data: pt(c.bhGold) }, { title: `B&H ${r.pair.silver}`, color: '#c0c0c0', data: pt(c.bhSilver) }], { storeKey: 'gswbt-wf', cur, height: 220 }));
    }
    // Grid-Tabelle
    const G = r.grid;
    if (r.tax) out.append(note('Grid mit Steuer: Auswahl nach Nachbarschaftsmittel der End-Unzen nach gezahlter Steuer (ohne Liquidationssteuer).'));
    out.append(sect(`Grid: ${G.total.toLocaleString('de-DE')} Zellen · Roh-Bester ${G.rawBest.U1}/${G.rawBest.L1}/${G.rawBest.S}/${G.rawBest.L2} (${de(G.rawBest.ozEnd, 3)} oz, robust Rang ${G.rawBest.rankRobust}) · Robust-Bester ${G.robustBest.U1}/${G.robustBest.L1}/${G.robustBest.S}/${G.robustBest.L2} (roh Rang ${G.robustBest.rankRaw})`));
    out.append(note(`Gezeigt: ${G.rows.length.toLocaleString('de-DE')} Zeilen (beste nach Robust- und Roh-Rang). Klick auf Spaltenkopf sortiert, Klick auf Zeile rechnet diese Zelle im Detail (oben). Ränge: gleicher Wert = gleicher Rang.`));
    const cols = [
      { key: 'rankRobust', label: 'Rang\nrobust' }, { key: 'rankRaw', label: 'Rang\nroh' },
      { key: 'U1', label: 'U1' }, { key: 'L1', label: 'L1' }, { key: 'S', label: 'S' }, { key: 'L2', label: 'L2' }, { key: 'window', label: 'Median' }, { key: 'costPct', label: 'Kosten\n%', fmt: (v) => deMax(v, 3) },
      { key: 'nbOzEnd', label: 'Nachb.-Mittel\nEnd-oz', fmt: (v) => de(v, 4), title: 'Mittel der End-Unzen über die Nachbarzellen (±1 Gitterschritt je Achse)' },
      { key: 'ozEnd', label: 'End-oz\n(roh)', fmt: (v) => de(v, 4) },
      { key: 'endValue', label: `Endwert\n${cur}`, fmt: (v) => money(v) }, { key: 'maxdd', label: 'MaxDD', fmt: (v) => pc(v) }, { key: 'switches', label: 'Wechsel' }, { key: 'timeInSilver', label: 'Zeit\nSilber', fmt: (v) => pc(v, 1) },
      ...(r.tax ? [{ key: 'taxPaid', label: `Steuer\n${cur}`, fmt: (v) => money(v) }, { key: 'endValueAfterLiq', label: `Endwert n.\nLiq. ${cur}`, fmt: (v) => money(v) }] : []),
      { key: '_p', label: '', html: true, left: true, sort: false, fmt: (_, row) => iconBtn('data-gsw-saveprof', `${row.U1}|${row.L1}|${row.S}|${row.L2}|${row.window}|${row.costPct}`, '＋P', 'Als Profil speichern (rechnet die Zelle, Name abfragen, Kennzahlen als Snapshot)', 'txt') },
    ];
    let sorted = { col: 0, dir: 'asc' }, rows = G.rows;
    const gridHost = document.createElement('div'); out.append(gridHost);
    gridHost.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gsw-saveprof]'); if (!b) return;
      e.stopPropagation(); e.preventDefault();
      const [U1, L1, S, L2, window, costPct] = b.dataset.gswSaveprof.split('|').map(Number);
      try { const R = await api.post('/api/gsw/run', { ...req, params: { U1, L1, S, L2, window, costPct } }); await saveRunAsProfile(R, req, `Grid-Zeile ${U1}/${L1}/${S}/${L2}`); } catch (err) { alert(err.message); }
    }, true);
    const paint = () => gridHost.replaceChildren(table(rows, cols, { max: 1500, sorted, onSort: (i) => { sorted = { col: i, dir: sorted.col === i && sorted.dir === 'desc' ? 'asc' : sorted.col === i ? 'desc' : (i <= 1 ? 'asc' : 'desc') }; rows = sortRows(G.rows, cols[i], sorted.dir); paint(); }, onRow: async (row) => {
      try {
        const p = { U1: row.U1, L1: row.L1, S: row.S, L2: row.L2, window: row.window, costPct: row.costPct };
        const S = await api.post('/api/gsw/run', { ...pp.read(), ...req, params: p });
        showSelected(S, `Zelle (Rang robust ${row.rankRobust}, roh ${row.rankRaw})`); selHost.scrollIntoView?.({ behavior: 'smooth' });
      } catch (e) { alert(e.message); }
    } }));
    paint();
    const dqRe = /^([⚠ℹ]) (Daten(korrektur|warnung).*)$/;
    const dq = (r.notes || []).map((n) => dqRe.exec(n)).filter(Boolean).map((m) => ({ level: m[1] === '⚠' ? 'warn' : 'info', text: m[2] }));
    if (dq.length) out.prepend(dataQualityBox(dq));
    for (const n of (r.notes || []).filter((x) => !dqRe.test(x))) out.append(note(n));
    out.append(note(`Sharpe neu berechnet (Tagesrenditen, rf = 0, × √252); in der Spezifikation v3 nicht berechnet. CAGR auf 10.000 Startkapital (nicht 9.990 nach Erstkauf). Buy & Hold ohne Kosten und ohne Steuer. ${r.tax ? '' : 'Steuern, '}TER, Spreads nicht enthalten.`));
    if (r.tax) out.append(note(taxNote(r.tax)));
  }
}

function metricsTable(rows, cur, withParams = false) {
  return table(rows.map(([name, S]) => ({ name, ...S.metrics, params: S.params, bhOnly: S.bhOnly })), [
    { key: 'name', label: 'Variante', left: true },
    ...(withParams ? [{ key: 'params', label: 'Parameter', left: true, fmt: (p, r) => (r.name.startsWith('Walk') ? 'jährlich' : p ? `${p.U1}/${p.L1}/${p.S}/${p.L2} · ${p.window} · ${p.costPct} %` : '—') }] : []),
    { key: 'startDate', label: 'Start', fmt: deDate }, { key: 'endDate', label: 'Ende', fmt: deDate },
    { key: 'endValue', label: `Endwert\n${cur}`, fmt: (v) => money(v) }, { key: 'cagr', label: 'CAGR', fmt: (v) => pc(v) }, { key: 'maxdd', label: 'MaxDD', fmt: (v) => pc(v) },
    { key: 'switches', label: 'Wechsel', fmt: (v, r) => (r.bhOnly ? '—' : String(v)) }, { key: 'timeInSilver', label: 'Zeit\nSilber', fmt: (v) => (Number.isFinite(v) ? pc(v, 1) : '—') },
    { key: 'deferred', label: 'aufgeschoben', fmt: (v, r) => (r.bhOnly ? '—' : (v == null ? '—' : String(v))), title: 'Ausgeführte Regel-Swaps, die wegen der Haltefrist-Sperre später als T+1 ausgeführt wurden' },
    { key: 'lapsed', label: 'entfallen', fmt: (v, r) => (r.bhOnly ? '—' : (v == null ? '—' : String(v))), title: 'Vorgemerkte Swaps, die am ersten Tag nach Fristende entfielen, weil die Regel das andere Metall nicht mehr wollte' },
    { key: 'avgDelay', label: 'Ø Verzögerung\nTage', fmt: (v, r) => (r.bhOnly || !Number.isFinite(v) ? '—' : de(v, 1)), title: 'Mittlere Kalendertage von Signal- bis Ausführungstag, nur über aufgeschobene ausgeführte Swaps' },
    { key: 'goldOz', label: 'End-\nGold-oz', fmt: (v) => de(v, 4) }, { key: 'sharpe', label: 'Sharpe\n(neu)', fmt: (v) => de(v, 2), title: 'Tagesrenditen, rf = 0, annualisiert mit √252' },
    ...(rows.some(([, S]) => S.metrics?.taxMode === 'kest') ? [
      { key: 'taxPaid', label: `Steuer gezahlt\n${cur}`, fmt: (v, r) => (r.bhOnly ? '—' : money(v)), title: 'Summe der auf Swaps gezahlten Steuer (aus dem Erlös). Endwert und CAGR links sind bereits nach dieser Steuer.' },
      { key: 'lossCarry', label: `Verlust-\nvortrag ${cur}`, fmt: (v, r) => (r.bhOnly ? '—' : money(v)), title: 'Verlustvortrag am Ende (vor fiktiver Liquidation)' },
      { key: 'liqTax', label: `Liq.-Steuer\n${cur}`, fmt: (v, r) => (r.bhOnly ? '—' : r.liqTaxFree ? 'frei (§23)' : money(v)), title: 'Fiktive Steuer, wenn die Endposition am letzten Tag verkauft würde (unrealisierter Gewinn, nach Verlustvortrag)' },
      { key: 'endValueAfterLiq', label: `Endwert n.\nLiq. ${cur}`, fmt: (v, r) => (r.bhOnly ? '—' : money(v)) },
      { key: 'cagrAfterLiq', label: 'CAGR n.\nLiq.', fmt: (v, r) => (r.bhOnly ? '—' : pc(v)) },
    ] : []),
  ]);
}

/** Erläuterung der Steuer-Einstellung eines Laufs (keine Steuerberatung). */
function taxNote(t) {
  const rate = (x) => `${de(x * 100, 3)} %`;
  const p23 = t.p23 ? ` §23 aktiv (Paar mit Lieferanspruch): Gewinne ab „steuerfrei ab“ (Anschaffung + 1 Jahr + 1 Tag) steuerfrei, davor ${rate(t.p23Rate)} (eigentlich persönlicher Satz).` : ' Abgeltungsteuer auf jeden Swap-Gewinn (§23-Frist nicht angewandt).';
  return `Keine Steuerberatung. Steuer: ${rate(t.rate)} (25 % + 5,5 % Soli, ohne Kirchensteuer)${t.allowance ? `, Pauschbetrag ${de(t.allowance, 0)} je Jahr` : ''}.${p23} Swap = Verkauf + Neukauf; Steuer aus dem Erlös, Verluste in einen vereinfachten Verlusttopf. Liquidationssteuer separat (fiktiver Verkauf am Ende). Währungseffekte ignoriert: Gewinn in Paarwährung, nicht in EUR.`;
}

export default [
  { id: 'GSW', name: 'Gold/Silber-Swap · Signal, Schwellen, Holdings, Swap-Knopf, Charts', help: 'Holdings-Spalte Signal/Aktion je Lot: rot = Swap fällig (Buch-Metall ≠ Regel-Metall), orange = fällig, Haltefrist läuft, violett = Spike halten, grün = halten, darunter Abstand zur nächsten Schwelle. „📈 Historie“ (aufklappbar): Equity des echten Buchs vs. Regel, Buy & Hold Gold und Buy & Hold Silber mit denselben Einzahlungen, historische Lots mit Bearbeiten (Datum, Kurs, Stück, Gebühren, Notiz) und Löschen. „Phasen, Datenqualität, Regeln & Schwellen“ (Status-Details, Datenqualität, U1/L1/S/L2 mit Abstand und Regel) ist eine aufklappbare Zeile, beim Öffnen zu; die Zeile selbst zeigt Phase, sig und nächste Schwelle, Datenwarnungen bleiben sichtbar. Charts: ① sig mit Schwellen; ② Kursverhältnis des Paars mit umgerechneten Schwellen und ③ Paar-Kurse sind einklappbar. Parameter-Profile (data/gsw-profiles.json): oben Profil wählen; das aktive Profil bestimmt Paar, Schwellen, Chart-Levels und Haltefrist-Warnung. Werte unter „Profilwerte bearbeiten“ ändern → „Anwenden (Vorschau)“, dann Überschreiben / Als neues Profil / Verwerfen. Aktives Profil nicht löschbar. Buch profilunabhängig.', group: 'Kamikaze', needs: false, source: 'Yahoo Close GLD, SLV, GC=F, SI=F + Handelspaar; Buch data/gsw-book.json; Regel v3 (Spec)', render: gsw },
  { id: 'GSWBT', name: 'GSW-Backtest · Grid, Robustheit, Walk-Forward, OOS, Handelspaar wählbar', help: 'Profil laden füllt Paar, Sperre, Steuer und Einzelparameter. „Als Profil speichern“ im Einzellauf, in der Detailansicht und per ＋P an jeder Grid-Zeile (Name abfragen, Kennzahlen als Snapshot).', group: 'Kamikaze', needs: false, source: 'Yahoo Close; gleiche Engine wie GSW (lib/gsw); Worker-Thread', render: gswbt },
];
