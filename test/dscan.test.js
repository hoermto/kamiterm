import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR (dscan imports the event cache)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendar } from '../lib/fn/dscan.js';

test('parseCalendar: Nasdaq dividend calendar rows to ISO dates; rows without amount or date dropped', () => {
  const j = { data: { calendar: { rows: [
    { companyName: 'Astec Industries, Inc. Common Stock', symbol: 'ASTE', dividend_Ex_Date: '11/16/2026', payment_Date: '12/04/2026', record_Date: '11/16/2026', dividend_Rate: 0.13, indicated_Annual_Dividend: 0.52, announcement_Date: '10/30/2026' },
    { companyName: 'No Rate', symbol: 'NR', dividend_Ex_Date: '11/16/2026', dividend_Rate: null },
    { companyName: 'Bad date', symbol: 'BD', dividend_Ex_Date: 'N/A', dividend_Rate: 0.1 },
  ] } } };
  assert.deepEqual(parseCalendar(j), [{ symbol: 'ASTE', name: 'Astec Industries, Inc. Common Stock', exDate: '2026-11-16', amount: 0.13, payDate: '2026-12-04', announced: '2026-10-30' }]);
  assert.deepEqual(parseCalendar(null), []);
});
