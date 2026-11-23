// Sprung aus ALERTS (AT-22): Zeilen mit einem Ticker hervorheben und die erste ins Bild holen.
// Treffer = Tabellenzelle, deren erstes Wort (ohne Badges/Leerraum) der Ticker ist. -> Anzahl markierter Zeilen
export function highlightRows(root, ticker, { scroll = true } = {}) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!root || !t) return 0;
  const hits = [];
  for (const td of root.querySelectorAll('table td')) {
    const first = String(td.textContent || '').trim().split(/\s+/)[0].toUpperCase();
    if (first !== t) continue;
    const tr = td.closest('tr');
    if (tr && !hits.includes(tr)) hits.push(tr);
  }
  for (const tr of hits) {
    tr.classList.add('hl-row');
    tr.style.outline = '2px solid #ffa028';
    tr.style.outlineOffset = '-2px';
    tr.title = tr.title || `Aus ALERTS: ${t}`;
  }
  if (scroll && hits[0]?.scrollIntoView) { try { hits[0].scrollIntoView({ block: 'center' }); } catch { /* jsdom */ } }
  return hits.length;
}
/** HL=TICKER aus den Befehlsargumenten. */
export const hlArg = (args = []) => (args.find((a) => /^HL=/i.test(String(a))) || '').slice(3).trim().toUpperCase() || null;
