// GSW-Holdings: Signal/Aktion je offenem Lot aus Regelzustand (aktives Profil) und aktuellem sig. Rein rechnerisch.
// „fällig“ = das Metall des Lots weicht vom Zielmetall der Regel ab (Ziel = heutiges Signal für den nächsten Schluss,
// sonst die aktuelle Regelposition).
const de = (v, d = 1) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const lv = (v) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '—');
const dd = (x) => (x ? `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}` : '—');
const MN = { gold: 'Gold', silver: 'Silber' };

/**
 * lot: { metal, inHold?, taxFreeFrom? }
 * st:  { pos: 'gold'|'silver' (Regelposition), spike, sig, due: { due: 'gold'|'silver'|null, rule }, P: { U1, L1, S, L2 }, since? (ISO, letzter Regelwechsel) }
 * -> { level: 'due'|'hold'|'spike'|'ok'|'info', target, text, dist, reason }
 *    due = Swap fällig (rot), hold = fällig aber Haltefrist läuft (orange), spike = Spike-Modus halten (violett), ok = halten (grün)
 */
export function lotAction(lot, st) {
  const P = st.P || {}, sig = st.sig;
  const target = st.due?.due || st.pos;
  if (lot.metal !== 'gold' && lot.metal !== 'silver') return { level: 'info', target, text: '—', dist: null, reason: null };
  if (lot.metal !== target) {
    let reason;
    if (st.due?.due) {
      const lvlName = target === 'silver' ? 'U1' : st.spike ? 'L2' : 'L1';
      reason = `sig ${de(sig)} ${target === 'silver' ? '>' : '<'} ${lv(P[lvlName])}`;
    } else reason = `Regel ${st.since ? `seit ${dd(st.since)} ` : ''}in ${MN[target]}`;
    if (lot.inHold) return { level: 'hold', target, text: `Swap fällig – Haltefrist bis ${dd(lot.taxFreeFrom)}`, dist: `→ ${MN[target]} (${reason})`, reason };
    return { level: 'due', target, text: `Swap fällig → ${MN[target]} (${reason})`, dist: st.due?.due ? 'Ausführung zum nächsten Schluss' : null, reason };
  }
  // Lot passt zum Ziel
  if (st.due?.due && st.due.due !== st.pos) return { level: 'ok', target, text: `Halten (${MN[target]}) – Regel wechselt zum nächsten Schluss ebenfalls`, dist: null, reason: null };
  if (target === 'silver' && st.spike) return { level: 'spike', target, text: `Spike aktiv: halten bis sig < ${lv(P.L2)}`, dist: `noch ${de(sig - P.L2)} bis ${lv(P.L2)}`, reason: null };
  if (target === 'silver') return { level: 'ok', target, text: 'Halten (Silber)', dist: `noch ${de(sig - P.L1)} bis L1 ${lv(P.L1)} (→ Gold) · ${de(P.S - sig)} bis S ${lv(P.S)} (Spike)`, reason: null };
  return { level: 'ok', target, text: 'Halten (Gold)', dist: `noch ${de(P.U1 - sig)} bis U1 ${lv(P.U1)} (→ Silber)`, reason: null };
}
