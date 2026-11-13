import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-test-'));
process.env.QT_DATA_DIR = tmp;
fs.mkdirSync(path.join(tmp, 'cache'), { recursive: true });

const fj = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures', name), 'utf8'));

let routes = [];
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ u, ua: opts.headers?.['User-Agent'] || opts.headers?.['user-agent'] });
  const hit = routes.find(([re]) => re.test(u));
  if (!hit) throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  const [, status, body] = hit;
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
};
const serve = (...r) => {
  routes = r;
  calls.length = 0;
};

const { addEntry, removeEntry, loadList, listEntries } = await import('../lib/ma-list.js');
const {
  isMergerForm, roleForForm, pickMergerFiling, isUsTicker, checkTickerEdgar,
  checkTickersEdgar, loadEdgarCache, MA_UA, MERGER_FORMS,
} = await import('../lib/ma-edgar.js');
const { buildFlag, resolveMaFlags, applyMaFlags } = await import('../lib/ma-flags.js');
const maFn = (await import('../lib/fn/ma.js')).default;

test('merger form detection and roles', () => {
  assert.equal(isMergerForm('DEFM14A'), true);
  assert.equal(isMergerForm('S-4/A'), true);
  assert.equal(isMergerForm('SC TO-T'), true);
  assert.equal(isMergerForm('SC 14D9/A'), true);
  assert.equal(isMergerForm('SC 13E3'), true);
  assert.equal(isMergerForm('10-K'), false);
  assert.equal(isMergerForm('DEF 14A'), false);
  assert.equal(roleForForm('SC 14D9'), 'target');
  assert.equal(roleForForm('SC TO-T'), 'acquirer');
  assert.equal(roleForForm('S-4'), 'possible-acquirer');
  assert.equal(roleForForm('DEFM14A'), 'target');
  assert.ok(MERGER_FORMS.includes('DEFM14A'));
});

test('isUsTicker skips DAX and .DE', () => {
  assert.equal(isUsTicker('AAPL', 'SPX'), true);
  assert.equal(isUsTicker('SAP.DE', 'SPX'), false);
  assert.equal(isUsTicker('SAP', 'DAX'), false);
});

test('pickMergerFiling respects lookback and prefers newest', () => {
  const rows = [
    { form: 'DEFM14A', filed: '2025-01-01', url: 'old', cik: '1' },
    { form: 'S-4', filed: '2026-10-01', url: 'new', cik: '1' },
    { form: '10-K', filed: '2026-10-02', url: 'x', cik: '1' },
  ];
  const hit = pickMergerFiling(rows, { asOf: new Date('2026-11-09'), lookbackDays: 180 });
  assert.equal(hit.form, 'S-4');
  assert.equal(hit.filed, '2026-10-01');
  assert.equal(hit.role, 'possible-acquirer');
  const none = pickMergerFiling(rows, { asOf: new Date('2026-11-09'), lookbackDays: 30 });
  // S-4 on 2026-10-01 is within 30d of 2026-11-09? Oct 1 to Nov 9 = 39 days → outside 30
  assert.equal(none, null);
});

test('manual list ADD/REMOVE/LIST via module and fn', async () => {
  const a = addEntry({ symbol: 'xyz', note: 'deal', date: '2026-11-01' });
  assert.equal(a.ok, true);
  assert.equal(a.entry.symbol, 'XYZ');
  const list = listEntries();
  assert.equal(list.entries.length, 1);
  const apiList = await maFn({ action: 'LIST' });
  assert.equal(apiList.count, 1);
  const rem = await maFn({ action: 'REMOVE', symbol: 'XYZ' });
  assert.equal(rem.ok, true);
  assert.equal(loadList().entries.length, 0);
});

test('buildFlag merges manual and edgar', () => {
  const f = buildFlag({
    symbol: 'AAA',
    manual: { symbol: 'AAA', note: 'rumor', date: '2026-10-01' },
    edgar: { form: 'DEFM14A', filed: '2026-09-15', url: 'https://sec.gov/x', role: 'target' },
  });
  assert.equal(f.flagged, true);
  assert.deepEqual(f.sources, ['manual', 'edgar']);
  assert.match(f.label, /DEFM14A/);
  assert.equal(buildFlag({}), null);
});

test('EDGAR check uses User-Agent and caches; soft-fail on network', async () => {
  serve(
    [/company_tickers\.json/, 200, fj('newsfilings/sec-tickers.json')],
    [/submissions\/CIK0000320193\.json/, 200, fj('ma/sec-submissions-merger.json')],
  );
  const r = await checkTickerEdgar('AAPL', { force: true, universe: 'SPX', asOf: new Date('2026-11-09') });
  assert.equal(r.flag.form, 'DEFM14A');
  assert.equal(r.flag.role, 'target');
  assert.match(r.flag.url, /sec\.gov/);
  assert.ok(calls.some((c) => /Amber Terminal name@example\.com/.test(c.ua || '')));
  // second call hits cache (no new submissions fetch required if not stale — force false)
  const n = calls.length;
  const r2 = await checkTickerEdgar('AAPL', { force: false, universe: 'SPX' });
  assert.equal(r2.cached, true);
  assert.equal(r2.flag.form, 'DEFM14A');
  assert.equal(calls.length, n); // no new network

  // soft fail
  serve(); // nothing
  const bad = await checkTickerEdgar('MSFT', { force: true, universe: 'SPX', cache: loadEdgarCache() });
  assert.ok(bad.error || bad.flag === null);
  assert.doesNotThrow(() => {});
});

test('resolveMaFlags: manual always; EDGAR only for check set; DAX skipped', async () => {
  addEntry({ symbol: 'MANUAL1', note: 'hand' });
  serve(
    [/company_tickers\.json/, 200, fj('newsfilings/sec-tickers.json')],
    [/submissions\/CIK0000320193\.json/, 200, fj('ma/sec-submissions-merger.json')],
  );
  const res = await resolveMaFlags(['AAPL', 'SAP.DE', 'MANUAL1'], { universe: 'SPX', force: true });
  assert.ok(res.flags.get('AAPL'));
  assert.ok(res.flags.get('MANUAL1'));
  assert.ok(res.skipped.includes('SAP.DE'));
  assert.equal(res.flags.has('SAP.DE'), false); // no manual, no edgar
  const dax = await resolveMaFlags(['AAPL'], { universe: 'DAX', force: true });
  assert.ok(dax.skipped.includes('AAPL'));
  // manual still works on DAX universe for a manual ticker
  const dax2 = await resolveMaFlags(['MANUAL1'], { universe: 'DAX' });
  assert.ok(dax2.flags.get('MANUAL1'));
  removeEntry({ symbol: 'MANUAL1' });
});

test('applyMaFlags + hide filter', () => {
  const flags = new Map([['AAA', buildFlag({ manual: { note: 'x', date: '2026-01-01' } })]]);
  const rows = applyMaFlags([{ ticker: 'AAA' }, { ticker: 'BBB' }], flags);
  assert.equal(rows[0].maFlag, true);
  assert.equal(rows[1].maFlag, false);
  assert.equal(rows.filter((r) => !r.maFlag).length, 1);
});

test('ma fn CHECK action', async () => {
  serve(
    [/company_tickers\.json/, 200, fj('newsfilings/sec-tickers.json')],
    [/submissions\/CIK0000320193\.json/, 200, fj('ma/sec-submissions-merger.json')],
  );
  const d = await maFn({ action: 'CHECK', symbols: 'AAPL', universe: 'SPX', force: '1' });
  assert.equal(d.action, 'CHECK');
  assert.ok(d.flagged.some((r) => r.symbol === 'AAPL'));
});

test('filingRows from cf fixture yields merger via pickMergerFiling', async () => {
  const { filingRows } = await import('../lib/fn/cf.js');
  const sub = fj('ma/sec-submissions-merger.json');
  const rows = filingRows(sub);
  assert.ok(rows.some((r) => r.form === 'DEFM14A'));
  const hit = pickMergerFiling(rows, { asOf: new Date('2026-11-09') });
  assert.equal(hit.form, 'DEFM14A');
});
