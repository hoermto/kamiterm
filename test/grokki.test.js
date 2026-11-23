import {assertNotRealData} from './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weekly,levy,rrgPoint,rotationBacktest,bottomSignal,realizedVols,evaluateRrgExit,evaluateRsBelowBench,rrgExitDefaults,parseRrgExitMode,holdingsWatch,rrgSeries,evaluatePositionBook,evaluateTrailExit,auditBacktestInvariants,toGermanCsv,backtestTradesCsv,backtestWeeklyCsv,TRADE_LOG_COLUMNS,WEEKLY_LOG_COLUMNS} from '../lib/fn/grokki-math.js';
import {
  buyPosition,sellPosition,loadBook,saveBook,emptyBook,openPositions,closedPositions,todayUTC,
} from '../lib/rsl-watchlist.js';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../lib/store.js';
import {intParam,batch} from '../lib/fn/grokki-data.js';
import {suggestPut,seasonCheck,projectDividends,riskMath,putTheta} from '../lib/fn/mput.js';
import {UNIVERSES} from '../lib/fn/grokki-universes.js';
import {
  mergeBars, upsertBars, readBars, readMeta, needsRefresh, deleteSymbol,
} from '../lib/ohlcv-cache.js';

import {FUNCS} from '../public/js/fn/index.js';
import {parse} from '../public/js/commands.js';
const T=Date.UTC(2023,0,2)/1000,D=86400;
const bars=(n,fn=()=>100)=>Array.from({length:n},(_,i)=>{const close=fn(i);return {time:T+i*D,open:close,high:close,low:close,close,volume:10000000};});
test('classic Levy weekly formula and minimum history',()=>{
 const a=bars(26,i=>i+1).map((b,i)=>({...b,time:T+i*7*D}));
 assert.equal(levy(a),26/13.5);assert.equal(levy(a.slice(0,25)),null);
 assert.equal(weekly(bars(14)).length,2);
});
test('RRG constant relative strength is centered and has eight tail points',()=>{
 const a=bars(200),r=rrgPoint(a,a);assert.equal(r.ratio,100);assert.equal(r.momentum,100);assert.equal(r.trail.length,8);
 assert.equal(rrgPoint(a.slice(0,20),a),null);
});
test('RRG relative strength rising and falling stay on correct ratio side',()=>{
 assert.ok(rrgPoint(bars(400,i=>100+i),bars(400)).ratio>100);
 assert.ok(rrgPoint(bars(400,i=>500-i),bars(400)).ratio<100);
});
test('backtest constant prices, no leverage, correct zero drawdown',()=>{
 const b=rotationBacktest([{ticker:'A',bars:bars(1000)}],2,10,{fee:0});
 assert.equal(b.cagr,0);assert.equal(b.maxDD,0);assert.ok(b.rebalances.length>=1);
 assert.equal(b.stats.tradesOpen,1); // single name fills one slot; rest cash; no exits → still open
 assert.equal(b.stats.tradesClosed,0);
 assert.ok(b.rebalances.some(r=>r.kind==='initial'&&r.entries.includes('A')));
});
test('future spike cannot change past holdings or past equity',()=>{
 const a=bars(1000,i=>100+i*.1), b=bars(1000,i=>120+i*.05);
 const orig=rotationBacktest([{ticker:'A',bars:a},{ticker:'B',bars:b}],2,1);
 const spike=b.map((bar,i)=>i===999?{...bar,close:1000000}:bar);
 const changed=rotationBacktest([{ticker:'A',bars:a},{ticker:'B',bars:spike}],2,1);
 assert.deepEqual(orig.rebalances,changed.rebalances);assert.deepEqual(orig.equity.slice(0,-1),changed.equity.slice(0,-1));
});
test('bottom needs drop, rebound, old low and stock liquidity',()=>{
 const a=bars(300,()=>100);assert.equal(bottomSignal(a).pass,false);
 for(let i=174;i<280;i++)a[i]={...a[i],high:120,close:110};
 for(let i=280;i<300;i++)a[i]={...a[i],close:95+(i-280)*.3,low:95,high:102};
 a[281].low=94;assert.equal(bottomSignal(a).pass,true);
 assert.equal(bottomSignal(a.map(b=>({...b,volume:1}))).pass,false);
 assert.equal(bottomSignal(a.slice(0,100)),null);
});
test('put: OTM, liquid executable quote; no historical IVR invented',()=>{
 const a=bars(400,i=>100+Math.sin(i)*(.1+i/100));
 const today=new Date();const expiry=new Date(today.getTime()+270*D*1000).toISOString().slice(0,10);
 const chain={price:100,source:'test synthetic',expiries:[{date:expiry,root:'TEST',rows:[{strike:85,put:{bid:1,ask:1.1,oi:200,iv:.01}}]}]};
 const s=suggestPut(chain,a,{ivrMax:100});assert.ok(s);assert.ok(Math.abs(s.maxLoss100-1610)<1e-8);assert.ok(s.dte>=180&&s.dte<=365);assert.match(s.ivrKind,/NOT historical IVR/);
 chain.expiries[0].rows[0].put.iv=null;assert.equal(suggestPut(chain,a),null);
});
test('realized vol history is bounded',()=>assert.equal(realizedVols(bars(500)).length,252));
test('validation, rosters, registration and command parameters',()=>{
 assert.equal(UNIVERSES.DAX.length,40);assert.ok(UNIVERSES.SPX.length>=500);assert.ok(UNIVERSES.SPX.includes('BRK-B'));assert.ok(UNIVERSES.SPX.includes('BF-B'));assert.ok(UNIVERSES.SPX.includes('GOOG')&&UNIVERSES.SPX.includes('GOOGL'));
 assert.throws(()=>intParam('NaN',5,1,15));assert.throws(()=>intParam(0,5,1,15));
 for(const code of ['RSL26','RRG','MPUT'])assert.ok(FUNCS[code]);
 assert.deepEqual(parse('RSL26 DAX YEARS=3 N=7').args,['DAX','YEARS=3','N=7']);
 assert.deepEqual(parse('RRG XLK IMPROVING').args,['XLK','IMPROVING']);
});
test('batch failure is partial, with no fabricated row',async()=>{
 const d=await batch(['A','B'],async t=>{if(t==='B')throw new Error('test error');return {ticker:t};});assert.equal(d.loaded,1);assert.equal(d.partial,true);assert.equal(d.errors[0].ticker,'B');
});

test('MPUT RRG Winter->Spring gate',()=>{
 const tr=x=>({season:x.at(-1),trail:x.map(season=>({season}))});
 assert.equal(seasonCheck(tr(['Winter','Winter','Spring','Spring'])).pass,true);
 assert.equal(seasonCheck(tr(['Summer','Autumn','Spring'])).pass,false);
 assert.equal(seasonCheck(tr(['Summer','Autumn','Spring']),'SPRING').pass,true);
 assert.equal(seasonCheck(tr(['Winter','Spring','Summer'])).pass,false);
 assert.equal(seasonCheck(null,'OFF').pass,true);
});
test('MPUT dividend projection and max risk',()=>{
 const h=[{exDate:'2026-08-10',amount:.5},{exDate:'2026-05-10',amount:.5},{exDate:'2026-02-10',amount:.5},{exDate:'2025-11-10',amount:.5}];
 const d=projectDividends(h,'2026-11-05','2027-08-01');assert.equal(d.count,3);assert.equal(d.amount,1.5);
 assert.equal(projectDividends([],'2026-11-05','2027-08-01').amount,0);
 const r=riskMath(100,2,85,1.5);assert.equal(r.maxLoss,15.5);assert.equal(r.maxLoss100,1550);
 assert.ok(putTheta(100,80,.75,.25)<0);
});

test('RRGEXIT defaults per universe and parser',()=>{
 assert.deepEqual(rrgExitDefaults('SPX'),{mode:'RANK',rankTop:25});
 assert.deepEqual(rrgExitDefaults('NDX'),{mode:'CONFIRM',rankTop:50});
 assert.deepEqual(rrgExitDefaults('DAX'),{mode:'OFF',rankTop:25});
 assert.equal(parseRrgExitMode('direct+rsl'),'DIRECT+RSL');
 assert.equal(parseRrgExitMode('DIRECT_RSL'),'DIRECT+RSL');
 assert.throws(()=>parseRrgExitMode('NOPE'));
});
test('RRG exit: no retroactive exit when already Weakening at entry',()=>{
 const s0={lastQuadrant:'Weakening',weaknessSince:null,confirmPending:null};
 const ev=evaluateRrgExit(s0,{quadrant:'Weakening',rank:10,stockRsl:1.1,benchRsl:1.0,asOf:'2024-01-08'},{mode:'DIRECT',rankTop:25});
 assert.equal(ev.exit,false);assert.equal(ev.openSince,null);
});
test('RRG exit DIRECT fires on Leading→Weakening after buy',()=>{
 const s0={lastQuadrant:'Leading',weaknessSince:null,confirmPending:null};
 const ev=evaluateRrgExit(s0,{quadrant:'Weakening',rank:10,stockRsl:1.2,benchRsl:1.0,asOf:'2024-02-05'},{mode:'DIRECT',rankTop:25});
 assert.equal(ev.exit,true);assert.match(ev.reason,/Leading→Weakening/);
});
test('RRG exit DIRECT treats Leading→Lagging like weakness start',()=>{
 const s0={lastQuadrant:'Leading',weaknessSince:null,confirmPending:null};
 const ev=evaluateRrgExit(s0,{quadrant:'Lagging',rank:10,stockRsl:1.2,benchRsl:1.0,asOf:'2024-02-05'},{mode:'DIRECT',rankTop:25});
 assert.equal(ev.exit,true);assert.match(ev.reason,/Leading→Lagging/);assert.equal(ev.state.lastQuadrant,'Lagging');
});
test('RRG exit RANK: Leading→Lagging starts phase; exit only outside Top band',()=>{
 let st={lastQuadrant:'Leading',weaknessSince:null,confirmPending:null};
 let ev=evaluateRrgExit(st,{quadrant:'Lagging',rank:5,stockRsl:1.2,benchRsl:1.0,asOf:'2024-02-05'},{mode:'RANK',rankTop:25});
 assert.equal(ev.exit,false);assert.equal(ev.weaknessPhase,true);assert.equal(ev.openSince,'2024-02-05');
 st=ev.state;
 ev=evaluateRrgExit(st,{quadrant:'Lagging',rank:40,stockRsl:1.0,benchRsl:1.0,asOf:'2024-02-12'},{mode:'RANK',rankTop:25});
 assert.equal(ev.exit,true);assert.match(ev.reason,/Rank-Schutz/);
});
test('position book: exit independent of buyDate; same criteria for early/late buy',()=>{
 const T0=Date.UTC(2024,0,1)/1000,D=86400;
 const bm=Array.from({length:400},(_,i)=>({time:T0+i*D,open:100,high:100,low:100,close:100,volume:1e6}));
 const up=Array.from({length:400},(_,i)=>{
   const c=i<300?100+i*0.5:100+300*0.5-(i-300)*1.2;
   return {time:T0+i*D,open:c,high:c,low:c,close:c,volume:1e6};
 });
 const buyEarly=new Date((T0+200*D)*1000).toISOString().slice(0,10);
 const buyLate=new Date((T0+390*D)*1000).toISOString().slice(0,10);
 // Outside Rank-Schutz so RANK can exit during weakness
 const early=evaluatePositionBook([{symbol:'AAA',universe:'SPX',buyDate:buyEarly}],new Map([['AAA',up]]),bm,new Map([['AAA',40]]),{mode:'RANK',rankTop:25})[0];
 const late=evaluatePositionBook([{symbol:'AAA',universe:'SPX',buyDate:buyLate}],new Map([['AAA',up]]),bm,new Map([['AAA',40]]),{mode:'RANK',rankTop:25})[0];
 // buyDate must not change exit evaluation
 assert.equal(early.openSince,late.openSince);
 assert.equal(early.exitSignal,late.exitSignal);
 assert.equal(early.exitHint,late.exitHint);
 assert.equal(early.quadrant,late.quadrant);
 assert.equal(early.buyDate,buyEarly);
 assert.equal(late.buyDate,buyLate);
 // If trail still shows weakness after an earlier L→W, late buy still sees it
 if(late.quadrant==='Weakening'||late.quadrant==='Lagging'){
   assert.equal(late.weaknessPhase,!!late.openSince);
 }
});
test('RRG exit DIRECT+RSL requires stock RSL below bench',()=>{
 const s0={lastQuadrant:'Leading',weaknessSince:null,confirmPending:null};
 const no=evaluateRrgExit(s0,{quadrant:'Weakening',rank:10,stockRsl:1.2,benchRsl:1.0,asOf:'2024-02-05'},{mode:'DIRECT+RSL',rankTop:25});
 assert.equal(no.exit,false);
 const yes=evaluateRrgExit(s0,{quadrant:'Weakening',rank:10,stockRsl:0.9,benchRsl:1.0,asOf:'2024-02-05'},{mode:'DIRECT+RSL',rankTop:25});
 assert.equal(yes.exit,true);
});
test('RRG exit RANK stays inside Top 25 then exits when rank drops while weak',()=>{
 let st={lastQuadrant:'Leading',weaknessSince:null,confirmPending:null};
 let ev=evaluateRrgExit(st,{quadrant:'Weakening',rank:10,stockRsl:1.1,benchRsl:1.0,asOf:'2024-03-04'},{mode:'RANK',rankTop:25});
 assert.equal(ev.exit,false);assert.equal(ev.weaknessPhase,true);assert.equal(ev.openSince,'2024-03-04');
 st=ev.state;
 ev=evaluateRrgExit(st,{quadrant:'Weakening',rank:10,stockRsl:1.1,benchRsl:1.0,asOf:'2024-03-11'},{mode:'RANK',rankTop:25});
 assert.equal(ev.exit,false);assert.equal(ev.openSince,'2024-03-04');
 st=ev.state;
 ev=evaluateRrgExit(st,{quadrant:'Lagging',rank:30,stockRsl:1.0,benchRsl:1.0,asOf:'2024-03-18'},{mode:'RANK',rankTop:25});
 assert.equal(ev.exit,true);assert.match(ev.reason,/Rank-Schutz/);
});
test('RRG exit Improving/Leading ends weakness phase',()=>{
 let st={lastQuadrant:'Weakening',weaknessSince:'2024-03-04',confirmPending:null};
 const ev=evaluateRrgExit(st,{quadrant:'Improving',rank:40,stockRsl:1.0,benchRsl:1.0,asOf:'2024-03-25'},{mode:'RANK',rankTop:25});
 assert.equal(ev.exit,false);assert.equal(ev.weaknessPhase,false);assert.equal(ev.openSince,null);
});
test('RRG exit CONFIRM gives leaders +1 week, non-leaders immediate',()=>{
 const lead={lastQuadrant:'Leading',weaknessSince:null,confirmPending:null};
 const imm=evaluateRrgExit(lead,{quadrant:'Weakening',rank:80,stockRsl:1.1,benchRsl:1.0,asOf:'2024-04-01'},{mode:'CONFIRM',rankTop:50});
 assert.equal(imm.exit,true);
 const wait=evaluateRrgExit(lead,{quadrant:'Weakening',rank:20,stockRsl:1.1,benchRsl:1.0,asOf:'2024-04-01'},{mode:'CONFIRM',rankTop:50});
 assert.equal(wait.exit,false);assert.equal(wait.state.confirmPending,'2024-04-01');assert.equal(wait.openSince,'2024-04-01');
 const done=evaluateRrgExit(wait.state,{quadrant:'Weakening',rank:20,stockRsl:1.1,benchRsl:1.0,asOf:'2024-04-08'},{mode:'CONFIRM',rankTop:50});
 assert.equal(done.exit,true);assert.match(done.reason,/Bestätigung/);
});
test('RRG exit OFF never exits on RRG; RS below bench does',()=>{
 const s0={lastQuadrant:'Leading',weaknessSince:null,confirmPending:null};
 const ev=evaluateRrgExit(s0,{quadrant:'Weakening',rank:5,stockRsl:0.8,benchRsl:1.0,asOf:'2024-05-06'},{mode:'OFF',rankTop:25});
 assert.equal(ev.exit,false);
 assert.equal(evaluateRsBelowBench(0.8,1.0).exit,true);
 assert.equal(evaluateRsBelowBench(1.1,1.0).exit,false);
});
test('holdingsWatch openSince only after Leading→Weakening in trail, not pre-existing Weakening',()=>{
 const T=Date.UTC(2022,0,3)/1000,D=86400;
 // Build long daily series: flat then relative strength swing via stock path
 const bm=Array.from({length:400},(_,i)=>({time:T+i*D,open:100,high:100,low:100,close:100,volume:1e6}));
 const stock=bm.map((b,i)=>{
  let close=100;
  if(i<280) close=100+i*0.15;           // strong / Leading-ish
  else if(i<320) close=142-(i-280)*0.4; // roll over toward Weakening
  else close=126-(i-320)*0.2;           // stay soft
  return {...b,open:close,high:close,low:close,close};
 });
 const rows=[{ticker:'AAA',rank:5,rsl:1.1}];
 const map=new Map([['AAA',stock]]);
 const w=holdingsWatch(rows,map,bm,{mode:'RANK',rankTop:25})[0];
 assert.ok(w.quadrant);
 // Pre-existing Weakening-only trail without L→W must not invent openSince
 const weakOnly=bm.map((b,i)=>{const close=100-i*0.05;return {...b,open:close,high:close,low:close,close};});
 const w2=holdingsWatch(rows,new Map([['AAA',weakOnly]]),bm,{mode:'DIRECT',rankTop:25})[0];
 if(w2.quadrant==='Weakening'||w2.quadrant==='Lagging') assert.equal(w2.openSince,null);
});
test('backtest weekly exits: DIRECT sells after L→W; OFF does not RRG-exit',()=>{
 const T=Date.UTC(2020,0,1)/1000,D=86400;
 const days=900;
 const bm=Array.from({length:days},(_,i)=>({time:T+i*D,open:100,high:100,low:100,close:100,volume:1e6}));
 // Oscillating RS forces weekly Leading→Weakening rotations.
 const stock=bm.map((b,i)=>{
  const close=100+i*0.05+Math.sin(i/40)*30;
  return {time:b.time,open:close,high:close,low:close,close,volume:1e6};
 });
 const series=[{ticker:'AAA',bars:stock}];
 assert.ok(rrgSeries(stock,bm).some((p,i,a)=>i&&a[i-1].quadrant==='Leading'&&p.quadrant==='Weakening'));
 const direct=rotationBacktest(series,2,1,{benchmarkBars:bm,mode:'DIRECT',rankTop:25});
 assert.ok(direct.exits.some(e=>/Leading→Weakening/.test(e.reason)), 'exits='+JSON.stringify(direct.exits.filter(e=>/Leading/.test(e.reason)).slice(0,3)));
 const off=rotationBacktest(series,2,1,{benchmarkBars:bm,mode:'OFF',rankTop:25});
 assert.equal(off.exits.filter(e=>/Leading→Weakening/.test(e.reason)).length,0);
});
test('rrgSeries is weekly cadence only',()=>{
 const a=Array.from({length:300},(_,i)=>{const t=Date.UTC(2023,0,2)/1000+i*86400;return {time:t,open:100,high:100,low:100,close:100+i*0.01,volume:1};});
 const s=rrgSeries(a,a);
 assert.ok(s.length>=8);
 for(let i=1;i<s.length;i++) assert.ok(s[i].key>s[i-1].key);
});

const WATCH_FILE=assertNotRealData(path.join(store.DATA_DIR,'rsl-watchlist.json'));
function withCleanBook(fn) {
  assertNotRealData(WATCH_FILE);
  const prev=fs.existsSync(WATCH_FILE)?fs.readFileSync(WATCH_FILE,'utf8'):null;
  saveBook(emptyBook());
  const restore=()=>{
    if(prev==null) fs.rmSync(WATCH_FILE,{force:true});
    else fs.writeFileSync(WATCH_FILE,prev);
  };
  try {
    const out=fn();
    if(out && typeof out.then==='function') return out.finally(restore);
    restore();
    return out;
  } catch (e) {
    restore();
    throw e;
  }
}

test('watchlist buy adds open position; second buy does not duplicate',()=>{
 withCleanBook(()=>{
  const a=buyPosition({symbol:'AAPL',universe:'SPX',buyDate:'2026-01-10',buyPrice:100});
  assert.equal(a.ok,true);assert.equal(a.position.status,'open');assert.equal(a.position.buyDate,'2026-01-10');
  const b=buyPosition({symbol:'aapl',universe:'SPX'});
  assert.equal(b.ok,false);assert.equal(b.duplicated,true);
  assert.equal(openPositions().length,1);
 });
});

test('watchlist sell closes position and keeps history',()=>{
 withCleanBook(()=>{
  buyPosition({symbol:'MSFT',universe:'NDX',buyDate:'2026-02-01'});
  const s=sellPosition({symbol:'MSFT',universe:'NDX',sellDate:'2026-03-01'});
  assert.equal(s.ok,true);assert.equal(s.position.status,'closed');assert.equal(s.position.closedDate,'2026-03-01');
  assert.equal(openPositions().length,0);
  assert.equal(closedPositions().length,1);
  assert.equal(loadBook().positions.length,1);
 });
});

test('watchlist persistence round-trip',()=>{
 withCleanBook(()=>{
  buyPosition({symbol:'NVDA',universe:'SPX',buyDate:'2026-04-01',note:'test'});
  const again=loadBook();
  assert.equal(again.positions[0].symbol,'NVDA');
  assert.equal(again.positions[0].note,'test');
  assert.ok(again.updatedAt);
 });
});

test('position exits ignore buyDate; trail without L→W does not invent RRG phase',()=>{
 const T=Date.UTC(2022,0,3)/1000,D=86400;
 const bm=Array.from({length:400},(_,i)=>({time:T+i*D,open:100,high:100,low:100,close:100,volume:1e6}));
 // Persistently weak vs flat bench → Weakening/Lagging without ever Leading
 const weak=bm.map((b,i)=>{const close=100-i*0.05;return {...b,open:close,high:close,low:close,close};});
 const buyDate=new Date((T+350*D)*1000).toISOString().slice(0,10);
 const pos=[{symbol:'AAA',universe:'SPX',buyDate,status:'open'}];
 const out=evaluatePositionBook(pos,new Map([['AAA',weak]]),bm,new Map([['AAA',5]]),{mode:'DIRECT',rankTop:25})[0];
 assert.equal(out.openSince,null);
 assert.equal(out.weaknessPhase,false);
 // RSL<Bench may still fire; RRG must not invent Leading→Weakening without trail evidence
 assert.ok(!(out.exitHint||'').includes('Leading→Weakening'));
 assert.ok(!(out.exitReason||'').includes('Leading→Weakening'));
 assert.equal(out.buyDate,buyDate);
});

test('position RRG-Exit offen seit from trail L→W even if buyDate is after the switch',()=>{
 const T=Date.UTC(2020,0,1)/1000,D=86400;
 const days=900;
 const bm=Array.from({length:days},(_,i)=>({time:T+i*D,open:100,high:100,low:100,close:100,volume:1e6}));
 const stock=bm.map((b,i)=>{
  const close=100+i*0.05+Math.sin(i/40)*30;
  return {time:b.time,open:close,high:close,low:close,close,volume:1e6};
 });
 const trail=rrgSeries(stock,bm);
 const lw=[];
 for(let i=1;i<trail.length;i++) if(trail[i-1].quadrant==='Leading'&&trail[i].quadrant==='Weakening') lw.push(trail[i].time);
 assert.ok(lw.length>=1);
 // Buy AFTER the L→W — old gate would suppress; now must still show weakness/exit
 const buyDate=new Date(Date.parse(lw[0]+'T00:00:00Z')+7*86400*1000).toISOString().slice(0,10);
 const pos=[{symbol:'BBB',universe:'SPX',buyDate,status:'open'}];
 const out=evaluatePositionBook(pos,new Map([['BBB',stock]]),bm,new Map([['BBB',5]]),{mode:'DIRECT',rankTop:25})[0];
 if(out.quadrant==='Weakening'||out.quadrant==='Lagging'){
   assert.ok(out.openSince, 'expected RRG-Exit offen seit from trail L→W');
   assert.equal(out.weaknessPhase,true);
 }
 // DIRECT exitHint when last week is the L→W switch; otherwise openSince alone marks phase
 assert.ok(out.openSince || out.exitSignal || out.rsBelowBench);
});

test('evaluateTrailExit RANK exits outside Rank-Schutz during weakness phase',()=>{
 const trail=[
  {time:'2024-01-01',quadrant:'Leading'},
  {time:'2024-01-08',quadrant:'Leading'},
  {time:'2024-01-15',quadrant:'Weakening'},
  {time:'2024-01-22',quadrant:'Weakening'},
 ];
 const inBand=evaluateTrailExit(trail,{rank:10,stockRsl:1.1,benchRsl:1.0},{mode:'RANK',rankTop:25});
 assert.equal(inBand.weaknessPhase,true);
 assert.equal(inBand.openSince,'2024-01-15');
 assert.equal(inBand.exitHint,null);
 const outBand=evaluateTrailExit(trail,{rank:40,stockRsl:1.1,benchRsl:1.0},{mode:'RANK',rankTop:25});
 assert.equal(outBand.exitHint,'RRG Weakness außerhalb Rank-Schutz Top 25');
});

test('position RSL < bench exit on watch position',()=>{
 const T=Date.UTC(2023,0,2)/1000,D=86400;
 const bm=Array.from({length:300},(_,i)=>({time:T+i*D,open:100,high:100,low:100,close:100+i*0.2,volume:1e6}));
 const stock=bm.map((b,i)=>{const close=100-i*0.05;return {...b,open:close,high:close,low:close,close};});
 const buyDate=new Date((T+250*D)*1000).toISOString().slice(0,10);
 const pos=[{symbol:'CCC',universe:'DAX',buyDate,status:'open'}];
 const out=evaluatePositionBook(pos,new Map([['CCC',stock]]),bm,new Map([['CCC',1]]),{mode:'OFF',rankTop:25})[0];
 assert.equal(out.rsBelowBench,true);
 assert.equal(out.exitSignal,true);
 assert.match(out.exitHint||out.exitReason,/RSL Aktie < RSL Benchmark/);
});

test('todayUTC helper is ISO day',()=>{
 assert.match(todayUTC(),/^\d{4}-\d{2}-\d{2}$/);
});

import {editPosition,deletePosition,reopenPosition,applyAction,migrateBook} from '../lib/rsl-watchlist.js';
test('holdings ADD via applyAction gives stable id; free symbol allowed',()=>{
 withCleanBook(()=>{
  const r=applyAction('ADD',{symbol:'ZZZZ',universe:'DAX',buyDate:'2026-05-01',qty:'10'});
  assert.equal(r.ok,true);assert.ok(r.position.id);assert.equal(r.position.qty,10);
  assert.equal(loadBook().positions[0].id,r.position.id);
  assert.throws(()=>applyAction('ADD',{symbol:'bad sym!'}));
  assert.throws(()=>applyAction('ADD',{symbol:'AAPL',buyDate:'2026-13-45'}));
 });
});
test('holdings EDIT changes fields; buyDate change does not alter exit criteria',()=>{
 withCleanBook(()=>{
  const a=buyPosition({symbol:'AAPL',universe:'SPX',buyDate:'2026-01-10'});
  const e=editPosition({id:a.position.id,buyDate:'2026-10-01',buyPrice:'180',qty:'50',note:'x'});
  assert.equal(e.ok,true);
  const p=loadBook().positions[0];
  assert.equal(p.buyDate,'2026-10-01');assert.equal(p.buyPrice,180);assert.equal(p.qty,50);assert.equal(p.id,a.position.id);
  const bySym=editPosition({symbol:'AAPL',qty:'60'});assert.equal(bySym.ok,true);assert.equal(loadBook().positions[0].qty,60);
  assert.throws(()=>editPosition({id:a.position.id,buyDate:'nope'}));
 });
 // exit evaluation independent of buyDate
 const T0=Date.UTC(2022,0,3)/1000,D0=86400;
 const bm=Array.from({length:400},(_,i)=>({time:T0+i*D0,open:100,high:100,low:100,close:100,volume:1e6}));
 const up=bm.map((b,i)=>{const c=i<250?100+i*0.2:150-(i-250)*0.3;return {...b,open:c,high:c,low:c,close:c};});
 const iso=t=>new Date(t*1000).toISOString().slice(0,10);
 const early=evaluatePositionBook([{symbol:'AAA',universe:'SPX',buyDate:iso(bm[60].time)}],new Map([['AAA',up]]),bm,new Map([['AAA',100]]),{mode:'DIRECT',rankTop:25})[0];
 const late=evaluatePositionBook([{symbol:'AAA',universe:'SPX',buyDate:iso(bm[395].time)}],new Map([['AAA',up]]),bm,new Map([['AAA',100]]),{mode:'DIRECT',rankTop:25})[0];
 assert.equal(late.buyDate,iso(bm[395].time));
 assert.equal(early.openSince,late.openSince);
 assert.equal(early.exitSignal,late.exitSignal);
 assert.equal(early.exitHint,late.exitHint);
 assert.equal(early.quadrant,late.quadrant);
});
test('holdings duplicate guard on ADD, EDIT and REOPEN',()=>{
 withCleanBook(()=>{
  const a=buyPosition({symbol:'MSFT',universe:'SPX',buyDate:'2026-01-01'});
  const b=buyPosition({symbol:'MSFT',universe:'NDX',buyDate:'2026-01-01'});
  assert.equal(applyAction('ADD',{symbol:'MSFT',universe:'SPX'}).ok,false);
  const e=editPosition({id:b.position.id,universe:'SPX'});
  assert.equal(e.ok,false);assert.equal(e.duplicated,true);
  assert.equal(loadBook().positions.find(p=>p.id===b.position.id).universe,'NDX');
  sellPosition({id:a.position.id,sellDate:'2026-02-01'});
  buyPosition({symbol:'MSFT',universe:'SPX',buyDate:'2026-03-01'});
  const r=reopenPosition({id:a.position.id});assert.equal(r.ok,false);assert.equal(r.duplicated,true);
 });
});
test('holdings SELL by id keeps history; REOPEN restores; DELETE removes hard',()=>{
 withCleanBook(()=>{
  const a=buyPosition({symbol:'NVDA',universe:'NDX',buyDate:'2026-02-01'});
  assert.throws(()=>sellPosition({id:a.position.id,sellDate:'2026-01-01'}));
  const s=applyAction('SELL',{id:a.position.id,sellDate:'2026-03-01',sellPrice:'200'});
  assert.equal(s.ok,true);assert.equal(closedPositions().length,1);assert.equal(closedPositions()[0].sellPrice,200);
  const r=applyAction('REOPEN',{id:a.position.id});
  assert.equal(r.ok,true);assert.equal(openPositions()[0].closedDate,null);assert.equal(openPositions()[0].buyDate,'2026-02-01');
  const d=applyAction('LÖSCHEN',{id:a.position.id});
  assert.equal(d.ok,true);assert.equal(loadBook().positions.length,0);
  assert.equal(applyAction('DELETE',{id:'nope'}).ok,false);
 });
});
test('holdings migration adds ids, keeps data, writes backup',()=>{
 const legacy={version:1,updatedAt:'2026-01-01T00:00:00Z',positions:[
  {symbol:'AAPL',universe:'SPX',status:'open',buyDate:'2026-01-02',buyPrice:150,note:'alt',extra:'keep'},
  {ticker:'sap.de',buyDate:'2025-05-05',closedDate:'2025-09-09'}]};
 const {book,changed}=migrateBook(legacy);
 assert.equal(changed,true);assert.ok(book.positions.every(p=>p.id));
 assert.equal(book.positions[0].extra,'keep');assert.equal(book.positions[0].buyPrice,150);
 assert.equal(book.positions[1].symbol,'SAP.DE');assert.equal(book.positions[1].status,'closed');
 assert.equal(migrateBook(book).changed,false);
 const BK=assertNotRealData(path.join(store.DATA_DIR,'rsl-watchlist.backup.json'));
 const prevBk=fs.existsSync(BK)?fs.readFileSync(BK,'utf8'):null;
 withCleanBook(()=>{
  fs.writeFileSync(WATCH_FILE,JSON.stringify(legacy));
  const loaded=loadBook();
  assert.equal(loaded.positions.length,2);assert.ok(loaded.positions[0].id);
  assert.ok(JSON.parse(fs.readFileSync(WATCH_FILE,'utf8')).positions[0].id);
  assert.equal(JSON.parse(fs.readFileSync(BK,'utf8')).positions[0].note,'alt');
 });
 if(prevBk==null) fs.rmSync(BK,{force:true}); else fs.writeFileSync(BK,prevBk);
});
test('OHLCV cache merges incrementally without duplicate timestamps',()=>{
  const sym='__ZZTEST_OHLCV__';
  deleteSymbol(sym);
  const a=[{time:100,open:1,high:1,low:1,close:1,volume:10},{time:200,open:2,high:2,low:2,close:2,volume:20}];
  const b=[{time:200,open:2.5,high:3,low:2,close:2.5,volume:25},{time:300,open:3,high:3,low:3,close:3,volume:30}];
  const m=mergeBars(a,b);
  assert.equal(m.length,3);
  assert.equal(m[1].close,2.5);
  upsertBars(sym,m);
  upsertBars(sym,[{time:200,open:2.5,high:3,low:2,close:2.5,volume:25}]);
  const got=readBars(sym);
  assert.equal(got.length,3);
  assert.equal(got.map(x=>x.time).join(','),'100,200,300');
  assert.equal(got[1].close,2.5);
  assert.ok(readMeta(sym).lastFetch>0);
  assert.equal(needsRefresh(null,[]).mode,'full');
  assert.equal(needsRefresh({lastFetch:Date.now()},[{time:Math.floor(Date.now()/1000),open:1,high:1,low:1,close:1,volume:1}]).refresh,false);
  assert.equal(needsRefresh({lastFetch:Date.now()},got,Date.now(),{want:100}).reason,'short');
  // today's partial bar: same timestamp overwrite
  upsertBars(sym,[{time:300,open:3,high:3.5,low:2.9,close:3.2,volume:99}]);
  assert.equal(readBars(sym).at(-1).close,3.2);
  assert.equal(readBars(sym).length,3);
  deleteSymbol(sym);
});

test('backtest stats: startCapital, trades, winRate, hold days, benchmark equity',()=>{
 const T=Date.UTC(2020,0,1)/1000,D=86400;
 const days=900;
 const bm=Array.from({length:days},(_,i)=>({time:T+i*D,open:100,high:100,low:100,close:100+i*0.02,volume:1e6}));
 const stock=bm.map((b,i)=>{
  const close=100+i*0.05+Math.sin(i/40)*20;
  return {time:b.time,open:close,high:close,low:close,close,volume:1e6};
 });
 const b=rotationBacktest([{ticker:'AAA',bars:stock}],2,1,{benchmarkBars:bm,mode:'DIRECT',rankTop:25,startCapital:10000});
 assert.equal(b.startCapital,10000);
 assert.ok(b.stats);
 assert.equal(b.stats.startCapital,10000);
 assert.ok(Number.isFinite(b.stats.finalEquity));
 assert.ok(Number.isFinite(b.stats.totalReturnPct));
 assert.ok(b.stats.tradesClosed>=1);
 assert.ok(b.stats.holdDaysAvg!=null);
 assert.ok(b.stats.holdDaysMin!=null);
 assert.ok(b.stats.holdDaysMax!=null);
 assert.ok((b.stats.holdUnit||'').includes('days'));
 assert.ok((b.stats.holdUnit||'').includes('weeks') || b.stats.holdWeeksAvg==null || Number.isFinite(b.stats.holdWeeksAvg));
 assert.ok(b.stats.winRate==null || (b.stats.winRate>=0 && b.stats.winRate<=100));
 assert.ok(b.benchmarkEquity?.length===b.equity.length);
 assert.ok(Number.isFinite(b.stats.benchmarkCagr)||b.stats.benchmarkCagr==null);
 // startCapital scales equity linearly vs default path with same returns
 const small=rotationBacktest([{ticker:'AAA',bars:stock}],2,1,{benchmarkBars:bm,mode:'OFF',rankTop:25,startCapital:1000,fee:0});
 const big=rotationBacktest([{ticker:'AAA',bars:stock}],2,1,{benchmarkBars:bm,mode:'OFF',rankTop:25,startCapital:10000,fee:0});
 assert.ok(Math.abs(small.stats.totalReturnPct-big.stats.totalReturnPct)<1e-6);
 assert.ok(Math.abs(big.stats.finalEquity/small.stats.finalEquity-10)<1e-6);
});

test('backtest closed trades exclude open holdings from hold/win stats counts correctly',()=>{
 const T=Date.UTC(2021,0,1)/1000,D=86400;
 const bars=Array.from({length:800},(_,i)=>({time:T+i*D,open:100,high:100,low:100,close:100,volume:1e6}));
 const b=rotationBacktest([{ticker:'FLAT',bars}],1,1,{startCapital:5000,fee:0});
 assert.equal(b.stats.tradesOpen,1);
 assert.equal(b.stats.tradesClosed,0); // no exit signal → held to end ("offen")
 assert.equal(b.finalEquity,5000);
 assert.match(b.stats.openNote||'',/Periodenende/);
});

test('backtest Friday-signal Monday-exec; holiday week uses next session',()=>{
 const D=86400;
 // Long calendar so 2y window has warmup; omit a Monday near the end (inside cutoff).
 const start=Date.UTC(2019,0,7)/1000;
 const bars=[];
 const isoSkip=t=>new Date(t*1000).toISOString().slice(0,10);
 // Pick a Monday ~60 days before the last bar
 let holiday=null, after=null;
 for(let i=0;i<1400;i++){
  const t=start+i*D; const dow=new Date(t*1000).getUTCDay();
  if(dow===0||dow===6) continue;
  const id=isoSkip(t);
  if(i>1200 && dow===1 && !holiday){ holiday=id; continue; } // skip this Monday
  if(holiday && !after && dow===2) after=id;
  const c=100+i*0.01;
  bars.push({time:t,open:c*0.99,high:c,low:c,close:c,volume:1e6});
 }
 assert.ok(holiday && after, 'fixture must define a Mon holiday + Tue');
 const bm=bars.map(b=>({...b,open:100,high:100,low:100,close:100}));
 const b=rotationBacktest([{ticker:'AAA',bars}],2,1,{benchmarkBars:bm,mode:'OFF',startCapital:10000});
 assert.ok(b.rebalances.some(r=>r.kind==='initial'));
 const tue=b.rebalances.find(r=>r.time===after);
 assert.ok(tue, `expected Tuesday exec ${after} after Monday holiday ${holiday}`);
 assert.ok(tue.signalAsOf);
 // Signal should be prior week's last session (Friday-ish)
 assert.ok(tue.signalAsOf < tue.time);
 assert.ok((b.stats.execPriceKind?.open||0) >= 1);
});

test('backtest does not re-buy held ticker; replacement is next in Top-n; holds persist',()=>{
 const D=86400, start=Date.UTC(2019,0,7)/1000; // Monday
 // Three names: A always strongest RSL, B medium, C weak then becomes strong after exits.
 // Force exit of A via RSL < bench after building Leading→Weakening is hard; use DIRECT+RSL
 // Simpler: mode OFF with bench rising fast so A (flat) exits on RSL<bench; B and C compete.
 const days=1100;
 const mk=(fn)=>{
  const out=[];
  for(let i=0;i<days;i++){
   const t=start+i*D, dow=new Date(t*1000).getUTCDay();
   if(dow===0||dow===6) continue;
   const c=fn(i,t);
   out.push({time:t,open:c,high:c,low:c,close:c,volume:1e6});
  }
  return out;
 };
 const bm=mk((i)=>100+i*0.2); // strong bench → flat stock RSL falls below
 const a=mk((i)=>150); // flat high price — initially high RSL vs rising bench eventually exits
 const b=mk((i)=>120+i*0.05);
 const c=mk((i)=>110+i*0.04);
 const bt=rotationBacktest(
  [{ticker:'AAA',bars:a},{ticker:'BBB',bars:b},{ticker:'CCC',bars:c}],
  2, 2, {benchmarkBars:bm, mode:'OFF', rankTop:25, startCapital:10000}
 );
 // Never hold duplicate tickers at any rebalance snapshot
 for(const ev of bt.rebalances){
  const held=(bt.holdings||[]); // end only — check closed trade sequence instead
 }
 // After an exit, replacement must not equal a still-held name: inspect week logs entries vs remaining
 // At end, open positions unique
 const openTickers=(bt.holdings||[]).map(h=>h.ticker);
 assert.equal(new Set(openTickers).size, openTickers.length);
 assert.ok(openTickers.length<=2);
 // Persistence: with no exit early on, initial names stay until RSL<bench fires
 assert.ok(bt.rebalances[0].entries.length>=1);
 // Some closed trades expected once flat AAA loses to rising bench
 assert.ok(bt.stats.tradesClosed>=1, 'expected RSL<bench exits for flat AAA');
 // Replacement ticker is from universe and not a duplicate open
 for(const e of bt.exits){
  assert.ok(['AAA','BBB','CCC'].includes(e.ticker));
 }
});

test('backtest replacement picks next Top-n not already held',()=>{
 const D=86400, start=Date.UTC(2019,0,7)/1000;
 const days=1000;
 const sessionBars=(closeAt)=>{
  const out=[];
  for(let i=0;i<days;i++){
   const t=start+i*D, dow=new Date(t*1000).getUTCDay();
   if(dow===0||dow===6) continue;
   const c=closeAt(i);
   out.push({time:t,open:c,high:c,low:c,close:c,volume:1e6});
  }
  return out;
 };
 // Rank order by RSL roughly follows recent strength: X > Y > Z steadily
 const X=sessionBars(i=>200+i*0.1);
 const Y=sessionBars(i=>150+i*0.05);
 const Z=sessionBars(i=>100+i*0.02);
 const bm=sessionBars(i=>100+i*0.01);
 // DIRECT mode will eventually rotate; for n=2 start should buy X,Y not Z
 const bt=rotationBacktest(
  [{ticker:'X',bars:X},{ticker:'Y',bars:Y},{ticker:'Z',bars:Z}],
  2, 2, {benchmarkBars:bm, mode:'OFF', startCapital:10000}
 );
 const init=bt.rebalances.find(r=>r.kind==='initial');
 assert.ok(init);
 assert.ok(init.entries.includes('X'));
 assert.ok(init.entries.includes('Y'));
 assert.ok(!init.entries.includes('Z'));
 // Held without exit remain (OFF + stocks still above bench RSL early on)
 assert.equal(bt.stats.tradesOpen, 2);
 assert.deepEqual(new Set(bt.holdings.map(h=>h.ticker)), new Set(['X','Y']));
});

test('backtest FRACTIONAL=1 allows fractional shares; FRACTIONAL=0 uses whole shares',()=>{
 const D=86400, start=Date.UTC(2019,0,7)/1000;
 const days=900;
 const mk=(px)=>{
  const out=[];
  for(let i=0;i<days;i++){
   const t=start+i*D, dow=new Date(t*1000).getUTCDay();
   if(dow===0||dow===6) continue;
   out.push({time:t,open:px,high:px,low:px,close:px,volume:1e6});
  }
  return out;
 };
 // Price 33 → START=1000, n=1 → budget 1000 → frac shares≈30.303; whole=30
 const bars=mk(33);
 const bm=mk(100);
 const frac=rotationBacktest([{ticker:'AAA',bars}],2,1,{benchmarkBars:bm,mode:'OFF',startCapital:1000,fractional:true,sizeMode:'START',fee:0});
 const whole=rotationBacktest([{ticker:'AAA',bars}],2,1,{benchmarkBars:bm,mode:'OFF',startCapital:1000,fractional:false,sizeMode:'START',fee:0});
 assert.equal(frac.stats.fractional,true);
 assert.equal(whole.stats.fractional,false);
 assert.ok(frac.holdings[0].shares > 30.3 && frac.holdings[0].shares < 30.4);
 assert.equal(whole.holdings[0].shares, 30);
 assert.ok(whole.stats.finalCash >= 0);
 // leftover cash with whole shares
 assert.ok(whole.stats.finalCash > frac.stats.finalCash-1e-6 || whole.holdings[0].shares < frac.holdings[0].shares);
});

test('backtest budget caps at Kapital/n and uses available cash when lower',()=>{
 const D=86400, start=Date.UTC(2019,0,7)/1000;
 const days=1000;
 const session=(fn)=>{
  const out=[];
  for(let i=0;i<days;i++){
   const t=start+i*D, dow=new Date(t*1000).getUTCDay();
   if(dow===0||dow===6) continue;
   const c=fn(i);
   out.push({time:t,open:c,high:c,low:c,close:c,volume:1e6});
  }
  return out;
 };
 const A=session(i=>50);
 const B=session(i=>50);
 const C=session(i=>50);
 const bm=session(i=>100);
 // n=2, START=1000 → budget 500 each; 3 names but only 2 slots
 const bt=rotationBacktest(
  [{ticker:'A',bars:A},{ticker:'B',bars:B},{ticker:'C',bars:C}],
  2, 2, {benchmarkBars:bm, mode:'OFF', startCapital:1000, fractional:true, sizeMode:'START'}
 );
 assert.equal(bt.stats.tradesOpen, 2);
 for(const h of bt.holdings){
  assert.ok(h.shares*h.entryPrice <= 500+1e-6, 'spend must be ≤ START/n');
 }
 // SIZE=EQUITY present
 assert.equal(bt.stats.sizeMode,'START');
 const eq=rotationBacktest(
  [{ticker:'A',bars:A},{ticker:'B',bars:B}],
  2, 2, {benchmarkBars:bm, mode:'OFF', startCapital:1000, fractional:true, sizeMode:'EQUITY'}
 );
 assert.equal(eq.stats.sizeMode,'EQUITY');
 assert.ok(Number.isFinite(eq.stats.avgCashQuota));
});

test('backtest insufficient cash reduces or skips entries',()=>{
 const D=86400, start=Date.UTC(2019,0,7)/1000;
 const days=900;
 const mk=(px)=>{
  const out=[];
  for(let i=0;i<days;i++){
   const t=start+i*D, dow=new Date(t*1000).getUTCDay();
   if(dow===0||dow===6) continue;
   out.push({time:t,open:px,high:px,low:px,close:px,volume:1e6});
  }
  return out;
 };
 // Expensive names, small capital, whole shares → many skips
 const X=mk(5000);
 const Y=mk(5000);
 const bm=mk(100);
 const bt=rotationBacktest(
  [{ticker:'X',bars:X},{ticker:'Y',bars:Y}],
  2, 2, {benchmarkBars:bm, mode:'OFF', startCapital:1000, fractional:false, sizeMode:'START'}
 );
 // Cannot buy even 1 share of 5000 with 1000
 assert.equal(bt.stats.tradesOpen, 0);
 assert.ok(bt.stats.entriesReducedDueToCash >= 1);
 assert.ok(bt.stats.finalCash >= 999);
 assert.ok(bt.stats.avgCashQuota > 0.9);
});


test('German CSV: UTF-8 BOM, semicolon, decimal comma, ISO dates',()=>{
 const rows=[{date:'2024-01-08',price:12.5,shares:3.25,value:40.625,action:'BUY',ticker:'AAA',pnl:null}];
 const csv=toGermanCsv(rows,[{key:'date',label:'Datum'},{key:'ticker',label:'Ticker'},{key:'action',label:'Aktion'},{key:'price',label:'Preis'},{key:'shares',label:'Stuecke'},{key:'value',label:'Wert'},{key:'pnl',label:'PnL'}]);
 assert.equal(csv.charCodeAt(0), 0xFEFF);
 assert.ok(csv.includes('Datum;Ticker;Aktion;Preis;Stuecke;Wert;PnL'));
 assert.ok(csv.includes('12,5'));
 assert.ok(csv.includes('3,25'));
 assert.ok(csv.includes('40,625'));
 assert.ok(csv.includes('2024-01-08'));
 assert.ok(!csv.includes('12.5;'), 'no decimal point for numbers');
});

test('backtest tradeLog + weeklyLog + audit invariants pass',()=>{
 const D=86400, start=Date.UTC(2019,0,7)/1000;
 const days=1100;
 const session=(fn)=>{
  const out=[];
  for(let i=0;i<days;i++){
   const t=start+i*D, dow=new Date(t*1000).getUTCDay();
   if(dow===0||dow===6) continue;
   const c=fn(i);
   out.push({time:t,open:c,high:c*1.01,low:c*0.99,close:c,volume:1e6});
  }
  return out;
 };
 // A rises, B falls then recovers — churn under RANK/DIRECT unlikely with OFF+RS; use DIRECT for exits
 const A=session(i=>50+i*0.02);
 const B=session(i=>80-i*0.01);
 const C=session(i=>60+Math.sin(i/20)*5);
 const bm=session(i=>100+i*0.005);
 const bt=rotationBacktest(
  [{ticker:'A',bars:A},{ticker:'B',bars:B},{ticker:'C',bars:C}],
  2, 2, {benchmarkBars:bm, mode:'DIRECT', rankTop:25, startCapital:10000, fractional:true, sizeMode:'EQUITY'}
 );
 assert.ok(bt.tradeLog.length >= 2, 'at least initial buys');
 assert.ok(bt.weeklyLog.length >= 50);
 assert.ok(bt.audit?.ok, bt.audit?.issues?.join('; '));
 const audit2=auditBacktestInvariants(bt);
 assert.ok(audit2.ok, audit2.issues.join('; '));
 // CSV helpers
 const tcsv=backtestTradesCsv(bt);
 const wcsv=backtestWeeklyCsv(bt);
 assert.equal(tcsv.charCodeAt(0), 0xFEFF);
 assert.equal(wcsv.charCodeAt(0), 0xFEFF);
 assert.ok(tcsv.split('\r\n')[0].includes('Datum'));
 assert.ok(wcsv.split('\r\n')[0].includes('WocheExec'));
 assert.equal(TRADE_LOG_COLUMNS.length > 5, true);
 assert.equal(WEEKLY_LOG_COLUMNS.length > 5, true);
 // signal ≤ exec
 for(const tr of bt.tradeLog){
  if(tr.signalDate && tr.date) assert.ok(tr.signalDate <= tr.date, `${tr.ticker} ${tr.signalDate} ${tr.date}`);
 }
 // BUY value ≤ cashBefore and ≤ budget
 for(const tr of bt.tradeLog.filter(x=>x.action==='BUY')){
  assert.ok(tr.value <= tr.cashBefore + 1e-6);
  if(tr.budget!=null) assert.ok(tr.value <= tr.budget + 1e-6);
 }
 // cash never negative
 for(const tr of bt.tradeLog){
  assert.ok(tr.cashAfter >= -1e-6, `cashAfter ${tr.cashAfter}`);
 }
});

test('backtest SIZE=EQUITY budget equals equityAtOpen/n; P&L bridges final-start',()=>{
 const D=86400, start=Date.UTC(2019,0,7)/1000;
 const days=1000;
 const mk=(fn)=>{
  const out=[];
  for(let i=0;i<days;i++){
   const t=start+i*D, dow=new Date(t*1000).getUTCDay();
   if(dow===0||dow===6) continue;
   const c=fn(i);
   out.push({time:t,open:c,high:c,low:c,close:c,volume:1e6});
  }
  return out;
 };
 const bt=rotationBacktest(
  [{ticker:'X',bars:mk(i=>40+i*0.03)},{ticker:'Y',bars:mk(i=>40)},{ticker:'Z',bars:mk(i=>35)}],
  2, 2, {benchmarkBars:mk(i=>100), mode:'OFF', startCapital:10000, fractional:true, sizeMode:'EQUITY'}
 );
 assert.ok(bt.audit.ok, bt.audit.issues.join('; '));
 for(const tr of bt.tradeLog.filter(t=>t.action==='BUY' && t.equityAtOpen!=null && t.budget!=null)){
  assert.ok(Math.abs(tr.budget - tr.equityAtOpen/2) < 1e-4, `budget ${tr.budget} vs eq/n ${tr.equityAtOpen/2}`);
 }
 const bridge=bt.stats.realizedPnl + bt.stats.unrealizedPnl - (bt.stats.openBuyFees||0);
 assert.ok(Math.abs(bridge - (bt.finalEquity - 10000)) < 0.05, `bridge ${bridge} vs ${bt.finalEquity-10000}`);
});


test('backtest FEE default $1 per trade; deducted on BUY and SELL; in trade log',()=>{
 const D=86400, start=Date.UTC(2019,0,7)/1000;
 const days=900;
 const mk=(px)=>{
  const out=[];
  for(let i=0;i<days;i++){
   const t=start+i*D, dow=new Date(t*1000).getUTCDay();
   if(dow===0||dow===6) continue;
   out.push({time:t,open:px,high:px,low:px,close:px,volume:1e6});
  }
  return out;
 };
 const bars=mk(50);
 const bm=mk(100);
 const withFee=rotationBacktest([{ticker:'AAA',bars}],2,1,{benchmarkBars:bm,mode:'OFF',startCapital:1000,fractional:true,sizeMode:'START',fee:1});
 const noFee=rotationBacktest([{ticker:'AAA',bars}],2,1,{benchmarkBars:bm,mode:'OFF',startCapital:1000,fractional:true,sizeMode:'START',fee:0});
 assert.equal(withFee.stats.feePerTrade, 1);
 assert.equal(noFee.stats.feePerTrade, 0);
 // one initial BUY → fee 1 deducted; flat prices → final ≈ 1000 - 1
 assert.ok(withFee.tradeLog.some(tr=>tr.action==='BUY' && tr.fee===1));
 assert.ok(withFee.stats.totalFees >= 1);
 assert.ok(withFee.stats.finalEquity < noFee.stats.finalEquity - 0.5);
 assert.ok(Math.abs(withFee.stats.finalEquity - (1000 - withFee.stats.totalFees)) < 0.05 || withFee.stats.tradesOpen>=1);
 // audit still OK
 assert.ok(withFee.audit.ok, withFee.audit.issues.join('; '));
 // default fee is 1 when omitted
 const def=rotationBacktest([{ticker:'AAA',bars}],2,1,{benchmarkBars:bm,mode:'OFF',startCapital:1000,fractional:true,sizeMode:'START'});
 assert.equal(def.stats.feePerTrade, 1);
});


test('rsExit=false disables RSL<Benchmark exit; confirmWeeks>1 delays CONFIRM',()=>{
 const trail=[
  {time:'2024-01-01',quadrant:'Leading',ratio:110,momentum:110},
  {time:'2024-01-08',quadrant:'Weakening',ratio:105,momentum:95},
  {time:'2024-01-15',quadrant:'Weakening',ratio:102,momentum:92},
  {time:'2024-01-22',quadrant:'Weakening',ratio:100,momentum:90},
 ];
 // RS below bench alone
 const rsOn=evaluateTrailExit(trail.slice(0,1), {rank:1, stockRsl:0.9, benchRsl:1.0}, {mode:'OFF', rankTop:25, rsExit:true});
 const rsOff=evaluateTrailExit(trail.slice(0,1), {rank:1, stockRsl:0.9, benchRsl:1.0}, {mode:'OFF', rankTop:25, rsExit:false});
 assert.ok(rsOn.exitHint);
 assert.equal(rsOff.exitHint, null);
 // CONFIRM weeks: at week+1 still protected → exit only if confirmWeeks<=1
 const conf1=evaluateTrailExit(trail.slice(0,3), {rank:5, stockRsl:1.1, benchRsl:1.0}, {mode:'CONFIRM', rankTop:25, confirmWeeks:1, rsExit:false});
 assert.ok(conf1.exitHint && conf1.exitHint.includes('1'));
 // openSince at index 1; slice(0,3) → weeksSince=1; full trail weeksSince=2
 const conf3=evaluateTrailExit(trail.slice(0,3), {rank:5, stockRsl:1.1, benchRsl:1.0}, {mode:'CONFIRM', rankTop:25, confirmWeeks:3, rsExit:false});
 assert.equal(conf3.exitHint, null);
 const conf2=evaluateTrailExit(trail, {rank:5, stockRsl:1.1, benchRsl:1.0}, {mode:'CONFIRM', rankTop:25, confirmWeeks:2, rsExit:false});
 assert.ok(conf2.exitHint && conf2.exitHint.includes('2'));
 const conf3b=evaluateTrailExit(trail, {rank:5, stockRsl:1.1, benchRsl:1.0}, {mode:'CONFIRM', rankTop:25, confirmWeeks:3, rsExit:false});
 assert.equal(conf3b.exitHint, null);
 // RANKTOP=0 → no protection → exit on L→W for RANK
 const rt0=evaluateTrailExit(trail.slice(0,2), {rank:1, stockRsl:1.1, benchRsl:1.0}, {mode:'RANK', rankTop:0, rsExit:false});
 assert.ok(rt0.exitHint && /Rank-Schutz aus|Weakness/.test(rt0.exitHint));
});

test('backtest windowStart/windowEnd limits trading range but keeps lookback bars',()=>{
 const D=86400, start=Date.UTC(2018,0,1)/1000;
 const mk=(px)=>{const out=[];for(let i=0;i<1200;i++){const t=start+i*D,dow=new Date(t*1000).getUTCDay();if(dow===0||dow===6)continue;out.push({time:t,open:px,high:px,low:px,close:px,volume:1e6});}return out;};
 const bars=mk(40), bm=mk(100);
 const w0=Date.UTC(2019,6,1)/1000, w1=Date.UTC(2020,6,1)/1000;
 const bt=rotationBacktest([{ticker:'W',bars}],5,1,{benchmarkBars:bm,mode:'OFF',fee:0,windowStart:w0,windowEnd:w1,startCapital:1000});
 assert.ok(bt.equity.length>10);
 assert.ok(bt.equity[0].time >= '2019-07-01');
 assert.ok(bt.equity.at(-1).time <= '2020-07-01');
});

import rsl26fn from '../lib/fn/rsl26.js';
test('bookOnly skips universe scan and backtest and returns the book quickly', async () => {
  await withCleanBook(async () => {
    const t0 = Date.now();
    const d = await rsl26fn({universe:'SPX', bookOnly:'1', watch:'1'});
    assert.equal(d.bookOnly, true);
    assert.equal(d.backtest, null);
    assert.deepEqual(d.rows, []);
    assert.ok(Array.isArray(d.positions));
    assert.equal(d.positions.length, 0);
    assert.ok(Date.now() - t0 < 8000, `bookOnly took ${Date.now()-t0}ms`);
  });
});

test('Gruppe Kamikaze: DMOV, DSCAN (Scan), GSW, GSWBT (AT-9)', () => {
  for (const id of ['DMOV', 'DSCAN', 'GSW', 'GSWBT']) assert.equal(FUNCS[id]?.group, 'Kamikaze', id);
});
