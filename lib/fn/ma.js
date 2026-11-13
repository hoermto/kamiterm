// /api/fn/ma — manual M&A list + optional EDGAR check for given tickers.
// Actions: LIST (default), ADD, REMOVE, CHECK
import { listEntries, addEntry, removeEntry, loadList } from '../ma-list.js';
import { resolveMaFlags, tooltipFor } from '../ma-flags.js';
import { MERGER_FORMS } from '../ma-edgar.js';

// LOOKBACK re-export for docs; define local if missing
const LOOKBACK_DAYS = 180;

export default async function (q = {}) {
  const action = String(q.action || q.op || 'LIST').trim().toUpperCase();
  if (action === 'LIST') {
    const list = listEntries();
    return {
      action: 'LIST',
      list,
      count: list.entries.length,
      mergerForms: MERGER_FORMS,
      lookbackDays: LOOKBACK_DAYS,
      note: 'Manuelle Liste in data/ma-list.json (Seafile-Sync). EDGAR-Cache in data/cache/ma-edgar.json (lokal).',
    };
  }
  if (action === 'ADD') {
    const r = addEntry({ symbol: q.symbol || q.ticker, note: q.note, date: q.date });
    return { action: 'ADD', ...r, message: r.updated ? `Aktualisiert: ${r.entry.symbol}` : `Hinzugefügt: ${r.entry.symbol}` };
  }
  if (action === 'REMOVE' || action === 'DELETE') {
    const r = removeEntry({ symbol: q.symbol || q.ticker });
    return { action: 'REMOVE', ...r };
  }
  if (action === 'CHECK') {
    const raw = String(q.symbols || q.tickers || q.symbol || q.ticker || '')
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    const universe = String(q.universe || 'SPX').toUpperCase();
    const force = q.force === '1' || q.force === 'true' || q.refresh === '1';
    const resolved = await resolveMaFlags(raw, { universe, force });
    const rows = raw.map((symbol) => {
      const ma = resolved.flags.get(symbol) || null;
      return { symbol, ma, maFlag: !!ma, tooltip: tooltipFor(ma) };
    });
    return {
      action: 'CHECK',
      universe,
      rows,
      flagged: rows.filter((r) => r.maFlag),
      checked: resolved.checked,
      skipped: resolved.skipped,
      errors: resolved.errors,
      mergerForms: MERGER_FORMS,
      lookbackDays: LOOKBACK_DAYS,
      list: loadList(),
    };
  }
  throw Object.assign(new Error('action muss LIST|ADD|REMOVE|CHECK sein'), { status: 400 });
}
