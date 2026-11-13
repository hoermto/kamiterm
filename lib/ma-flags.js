// Combine manual M&A list + SEC EDGAR flags for a set of tickers.
import { loadList, manualMap } from './ma-list.js';
import { checkTickersEdgar, isUsTicker } from './ma-edgar.js';

export function buildFlag({ symbol, manual = null, edgar = null } = {}) {
  if (!manual && !edgar) return null;
  const sources = [];
  if (manual) sources.push('manual');
  if (edgar) sources.push('edgar');
  const parts = ['M&A'];
  if (manual) {
    parts.push('manuell' + (manual.note ? `: ${manual.note}` : ''));
    if (manual.date) parts.push(manual.date);
  }
  if (edgar) {
    parts.push(edgar.form);
    if (edgar.role && edgar.role !== 'unclear') parts.push(edgar.role);
    if (edgar.filed) parts.push(edgar.filed);
  }
  return {
    flagged: true,
    sources,
    manual: manual || null,
    edgar: edgar || null,
    label: parts.join(' · '),
    form: edgar?.form || null,
    filed: edgar?.filed || manual?.date || null,
    url: edgar?.url || null,
    role: edgar?.role || (manual ? 'manual' : null),
  };
}

export function tooltipFor(flag) {
  if (!flag) return '';
  const bits = [];
  if (flag.manual) {
    bits.push(`Manuell${flag.manual.note ? ': ' + flag.manual.note : ''}${flag.manual.date ? ' (' + flag.manual.date + ')' : ''}`);
  }
  if (flag.edgar) {
    bits.push(`EDGAR ${flag.edgar.form}${flag.edgar.role ? ' · ' + flag.edgar.role : ''}${flag.edgar.filed ? ' · ' + flag.edgar.filed : ''}`);
    if (flag.edgar.url) bits.push(flag.edgar.url);
  }
  return bits.join('\n');
}

/**
 * Annotate tickers with M&A flags.
 * Only EDGAR-checks US tickers in `checkSymbols` (holdings + top N).
 * Manual list always applies to any symbol in the maps.
 *
 * returns { flags: Map<symbol, flag|null>, errors: [], checked: [], skipped: [] }
 */
export async function resolveMaFlags(checkSymbols, {
  universe = 'SPX',
  force = false,
  list = null,
} = {}) {
  const manual = manualMap(list || loadList());
  const want = [...new Set((checkSymbols || []).map((s) => String(s || '').toUpperCase()).filter(Boolean))];
  const us = want.filter((s) => isUsTicker(s, universe));
  const skipped = want.filter((s) => !isUsTicker(s, universe));
  let edgarMap = new Map();
  const errors = [];
  try {
    edgarMap = await checkTickersEdgar(us, { force, universe });
  } catch (e) {
    errors.push({ error: e.message || String(e) });
  }
  const flags = new Map();
  for (const sym of new Set([...want, ...manual.keys()])) {
    const man = manual.get(sym) || null;
    const ed = edgarMap.get(sym);
    if (ed?.error) errors.push({ ticker: sym, error: ed.error });
    const flag = buildFlag({ symbol: sym, manual: man, edgar: ed?.flag || null });
    if (flag) flags.set(sym, flag);
  }
  return {
    flags,
    errors,
    checked: us,
    skipped,
    manualCount: manual.size,
  };
}

/** Attach .ma to each row that has ticker/symbol. */
export function applyMaFlags(rows, flags, { key = 'ticker' } = {}) {
  return (rows || []).map((r) => {
    const sym = String(r[key] || r.symbol || r.ticker || '').toUpperCase();
    const ma = flags.get(sym) || null;
    return { ...r, ma, maFlag: !!ma };
  });
}
