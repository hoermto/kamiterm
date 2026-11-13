import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR, never the real watchlist
// Synthetic upstream, real provider/parser/backend path. No network or fake live results.
process.env.QT_NO_OHLCV = "1"; // bypass general SQLite OHLCV so the mocked Yahoo fetch is used
import {test} from 'node:test';
import assert from 'node:assert/strict';
const end=Math.floor(Date.now()/86400e3)*86400;
const timestamp=Array.from({length:1700},(_,i)=>end-(1699-i)*86400);
const values=timestamp.map(()=>100);
const upstream={chart:{result:[{meta:{gmtoffset:0},timestamp,indicators:{quote:[{open:values,high:values,low:values,close:values,volume:values.map(()=>1000000)}]}}]}};
const urls=[];
globalThis.fetch=async url=>{urls.push(String(url));assert.match(String(url),/finance\/chart\//);return new Response(JSON.stringify(upstream));};
const {clearProviderCache}=(await import('../lib/providers.js'));
clearProviderCache();
const rsl=(await import('../lib/fn/rsl26.js')).default;
const rrg=(await import('../lib/fn/rrg.js')).default;
const mput=(await import('../lib/fn/mput.js')).default;
test('backend RSL SPX full S&P 500 returns ranks, source and backtest',async()=>{
 const d=await rsl({years:'2',n:'3',backtest:'1'});assert.ok(d.rows.length>=500, d.rows.length);assert.equal(d.coverage.requested,503);assert.equal(d.rows[0].rsl,1);assert.ok(d.source);assert.ok(Math.abs(d.backtest.cagr)<0.5, String(d.backtest.cagr), 'flat prices: only fees move CAGR');
});
test('backend RSL accepts TRAIL/TRAILLOCK and runs the backtest with them',async()=>{
 const d=await rsl({years:'2',n:'3',backtest:'1',trail:'20',trailLock:'4'});
 assert.equal(d.trail,20);assert.equal(d.trailLock,4);
 assert.equal(d.backtest.stats.trail,20);assert.equal(d.backtest.stats.trailLock,4);
 assert.equal(d.backtest.stats.trailingExits,0,'flat prices never hit a trailing stop');
 assert.match(d.rules.trailing,/TRAIL=/);
 const off=await rsl({years:'2',n:'3'});assert.equal(off.trail,0);assert.equal(off.trailLock,4);
 await assert.rejects(()=>rsl({trail:'abc'}),/number/i);
});
test('backend RSL RANKING=MOM52_4 ranks by 12-1 momentum and keeps RSL26 for display/RS-exit',async()=>{
 const d=await rsl({years:'2',n:'3',ranking:'MOM52_4',backtest:'1'});
 assert.equal(d.ranking,'MOM52_4');assert.equal(d.rankingLabel,'Mom 12-1 %');
 assert.ok(d.rows.length>=500);assert.equal(d.rows[0].ranking,'MOM52_4');
 assert.equal(d.rows[0].score,0,'flat prices: zero momentum');assert.equal(d.rows[0].rsl,1);
 assert.equal(d.backtest.ranking,'MOM52_4');assert.equal(d.backtest.stats.ranking,'MOM52_4');
 assert.match(d.rules.ranking,/MOM52_4/);
 const def=await rsl({years:'2',n:'3'});assert.equal(def.ranking,'RSL26');assert.equal(def.rows[0].score,def.rows[0].rsl);
 await assert.rejects(()=>rsl({ranking:'RSL20'}),/RANKING/);
});
test('backend RRG resolves SPX index, sector overview and stock drill-down/filter',async()=>{
 const d=await rrg();assert.equal(d.rows.length,11);assert.equal(d.rows[0].ratio,100);assert.ok(urls.some(u=>u.includes('%5EGSPC')));
 const sector=await rrg({sector:'XLC',season:'Summer'});assert.equal(sector.mode,'sector stocks');assert.ok(sector.rows.length>5);
 assert.equal((await rrg({symbols:'AAPL,MSFT',season:'Winter'})).rows.length,0);
});
test('backend MPUT flat stocks yield no bottom candidates and no options fetch',async()=>{
 const d=await mput();assert.equal(d.rows.length,0);assert.equal(d.coverage.bottoms,0);assert.match(d.warning,/not true IV Rank/);
});
test('backend query validation returns errors, not silent defaults',async()=>{
 await assert.rejects(()=>rsl({years:'abc'}),/integer/);
 await assert.rejects(()=>rrg({season:'nonsense'}),/season/);
 await assert.rejects(()=>mput({universe:'DAX'}),/universe/);
});
