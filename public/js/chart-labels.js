// Serien-Titel rechts neben der Y-Achse statt im Plot (Lightweight Charts 5.x).
// Problem: LW zeichnet `title` einer Serie bzw. Preislinie links neben die Achse in den Plotbereich; der Text verdeckt
// die letzten (aktuellen) Kurse. Lösung zentral für alle Charts: Titel werden aus den Serienoptionen genommen und als
// eigenes Achsen-Label „Wert Titel“ über ein Series-Primitive (priceAxisViews) auf die Preisachse gezeichnet. Die Achse
// wird so breit wie das Label, der Plotbereich bleibt frei. Das eingebaute Wert-Label der Serie wird dafür abgeschaltet.

const NEAREST_LEFT = -1; // LW MismatchDirection.NearestLeft

/** Text des Achsen-Labels: „Wert Titel“ (Wert wie auf der Achse formatiert). */
export function labelText(valueText, title) {
  const t = String(title ?? "").trim();
  return t ? `${valueText} ${t}` : String(valueText);
}

/** Formatiert wie das eingebaute Label: Prozent-Modus (2) relativ zum ersten sichtbaren Wert, sonst Serien-Formatter. */
export function formatAxisValue(v, { mode = 0, base = null, fmt = null } = {}) {
  if (!Number.isFinite(v)) return "";
  if (mode === 2 && Number.isFinite(base) && base !== 0) {
    const p = (v / base - 1) * 100;
    return `${p.toFixed(2)}%`.replace("-", "\u2212");
  }
  if (mode === 3 && Number.isFinite(base) && base !== 0) return ((v / base) * 100).toFixed(2);
  return fmt ? fmt(v) : String(+v.toFixed(2));
}

/** Pure: Label-Positionen ohne Überlappung (sortiert, Mindestabstand h; Gruppen bleiben um ihre Mitte zentriert). ys: Zahl|null. */
export function spreadLabels(ys, h = 16, height = null) {
  const idx = ys.map((y, i) => [y, i]).filter(([y]) => Number.isFinite(y)).sort((a, b) => a[0] - b[0]);
  const out = ys.map((y) => (Number.isFinite(y) ? y : null));
  // Cluster bilden: überlappende Labels zu Blöcken zusammenfassen, Block um den Mittelwert der Originalpositionen legen
  let blocks = idx.map(([y, i]) => ({ ids: [i], ys: [y], top: y }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let k = 0; k < blocks.length - 1; k++) {
      const a = blocks[k], b = blocks[k + 1];
      if (a.top + a.ids.length * h > b.top) {
        const ids = [...a.ids, ...b.ids], yy = [...a.ys, ...b.ys];
        const mid = yy.reduce((x, y) => x + y, 0) / yy.length;
        blocks.splice(k, 2, { ids, ys: yy, top: mid - ((ids.length - 1) * h) / 2 });
        merged = true; break;
      }
    }
  }
  // im Pane halten (Label-Mitte mindestens h/2 vom Rand), dann nochmals von unten nach oben entzerren
  const flat = blocks.flatMap((b) => b.ids.map((i, k) => [i, b.top + k * h]));
  if (Number.isFinite(height) && height > h) {
    let lim = height - h / 2;
    for (let k = flat.length - 1; k >= 0; k--) { flat[k][1] = Math.min(flat[k][1], lim); lim = flat[k][1] - h; }
    let low = h / 2;
    for (const f of flat) { f[1] = Math.max(f[1], low); low = f[1] + h; }
  }
  for (const [i, y] of flat) out[i] = y;
  return out;
}

/** Alle Achsen-Labels eines Charts, gruppiert nach Pane + Preisachse, damit sie sich nicht überdecken. */
function labelGroup(chart) {
  if (chart.__axisLabelGroup) return chart.__axisLabelGroup;
  const items = new Set();
  const g = {
    items,
    resolve(item) {
      const key = item._key();
      const same = [...items].filter((x) => x._series && x._key() === key);
      let height = null;
      try { height = item._series.getPane?.().getHeight?.() ?? null; } catch { /* unbekannt */ }
      const ys = spreadLabels(same.map((x) => x._y), g.h, height);
      return ys[same.indexOf(item)] ?? item._y;
    },
    h: 16,
  };
  try { const fs = chart.options?.().layout?.fontSize; if (fs) g.h = fs + 5; } catch { /* Standard */ }
  chart.__axisLabelGroup = g;
  return g;
}

const valOf = (d) => (d == null ? null : Number.isFinite(d.value) ? d.value : Number.isFinite(d.close) ? d.close : null);

/** Achsen-Label-Primitive. kind 'last' = letzter sichtbarer Wert der Serie; kind 'line' = feste Preislinie (price). */
export class AxisTitle {
  constructor({ title, color, kind = "last", price = null, textColor = null }) {
    this.title = title; this.color = color; this.kind = kind; this.price = price; this.textColor = textColor;
    this._y = null; this._text = ""; this._series = null; this._chart = null;
    const self = this;
    this._view = {
      coordinate: () => (self._y == null ? -1e4 : self._group ? self._group.resolve(self) : self._y),
      text: () => self._text,
      textColor: () => self.textColor || contrast(self.color),
      backColor: () => self.color,
      visible: () => self._y != null && self._text !== "",
      tickVisible: () => true,
    };
  }
  attached({ series, chart, requestUpdate }) {
    this._series = series; this._chart = chart; this._req = requestUpdate;
    try { this._group = labelGroup(chart); this._group.items.add(this); } catch { this._group = null; }
  }
  detached() { this._group?.items.delete(this); this._series = null; this._chart = null; this._group = null; }
  _key() {
    let pane = 0, scale = "right";
    try { pane = this._series.getPane?.().paneIndex?.() ?? 0; } catch { /* ein Pane */ }
    try { scale = this._series.options().priceScaleId || "right"; } catch { /* Standard */ }
    return `${pane}|${scale}`;
  }
  _scaleMode() {
    try { return this._series.priceScale().options().mode ?? 0; } catch { return 0; }
  }
  _fmt() {
    // wie das eingebaute Label: eigener localization.priceFormatter des Charts, sonst Formatter der Serie
    try { const lf = this._chart?.options?.().localization?.priceFormatter; if (typeof lf === "function") return lf; } catch { /* weiter */ }
    try { const f = this._series.priceFormatter(); return (v) => f.format(v); } catch { return null; }
  }
  updateAllViews() {
    const s = this._series;
    this._y = null; this._text = "";
    if (!s) return;
    let v = this.kind === "line" ? this.price : null, base = null;
    const mode = this._scaleMode();
    if (this.kind === "last" || mode >= 2) {
      let r = null;
      try { r = this._chart?.timeScale().getVisibleLogicalRange(); } catch { /* noch kein Layout */ }
      const data = s.data?.() || [];
      if (!data.length) return;
      const to = r ? Math.floor(r.to) : data.length - 1;
      const from = r ? Math.max(0, Math.ceil(r.from)) : 0;
      const last = s.dataByIndex?.(to, NEAREST_LEFT) ?? data.at(-1);
      const first = s.dataByIndex?.(from, 1) ?? data[0];
      if (this.kind === "last") v = valOf(last);
      base = valOf(first);
    }
    if (!Number.isFinite(v)) return;
    const y = s.priceToCoordinate(v);
    if (y == null || !Number.isFinite(y)) return;
    this._y = y;
    this._text = labelText(formatAxisValue(v, { mode, base, fmt: this._fmt() }), this.title);
  }
  priceAxisViews() { return [this._view]; }
}

/** Schwarzer oder weißer Text je nach Hintergrund (wie LW). */
export function contrast(color) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color || "");
  if (!m) return "#000";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return 0.199 * r + 0.687 * g + 0.114 * b > 160 ? "#000" : "#fff";
}

const seriesColor = (o) => o.color || o.lineColor || o.upColor || "#ffa028";

/**
 * Zentral für alle Charts: chart.addSeries und series.createPriceLine so umhüllen, dass `title` nie im Plot landet.
 * - Serie mit Titel und sichtbarem Wert-Label: eingebautes Label aus, eigenes Achsen-Label „Wert Titel“.
 * - Serie mit Titel ohne Wert-Label (lastValueVisible:false): Titel entfällt im Plot (Legende/Überschrift nennt ihn).
 * - Preislinie mit Titel und axisLabelVisible: eigenes Achsen-Label „Preis Titel“; ohne Achsen-Label: Titel entfällt.
 * Gibt den Chart zurück; chart.seriesTitles() liefert [{title,color}] (für Legenden).
 */
export function titlesOnAxis(chart) {
  if (!chart || chart.__axisTitles) return chart;
  chart.__axisTitles = true;
  const titles = [];
  const add = chart.addSeries.bind(chart);
  chart.addSeries = (type, options = {}, pane) => {
    const o = { ...options };
    const title = o.title;
    const wantLabel = title && o.lastValueVisible !== false;
    if (title) { o.title = ""; titles.push({ title, color: seriesColor(o) }); }
    if (wantLabel) o.lastValueVisible = false;
    const ser = pane === undefined ? add(type, o) : add(type, o, pane);
    if (wantLabel && typeof ser.attachPrimitive === "function") ser.attachPrimitive(new AxisTitle({ title, color: seriesColor(o) }));
    const mkLine = ser.createPriceLine?.bind(ser);
    if (mkLine) {
      ser.createPriceLine = (lo = {}) => {
        const l = { ...lo };
        const lt = l.title;
        if (lt) {
          l.title = "";
          if (l.axisLabelVisible !== false && typeof ser.attachPrimitive === "function") {
            l.axisLabelVisible = false;
            ser.attachPrimitive(new AxisTitle({ title: lt, color: l.color || seriesColor(o), kind: "line", price: l.price }));
          }
        }
        return mkLine(l);
      };
    }
    return ser;
  };
  chart.seriesTitles = () => titles.slice();
  return chart;
}
