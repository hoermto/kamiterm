import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
// Trailing-Stop (TRAIL / TRAILLOCK) for rotationBacktest and live holdings. Synthetic bars only;
// never reads or writes data/rsl-watchlist.json.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rotationBacktest,trailingStopStatus,trailingStopReason,evaluatePositionBook} from '../lib/fn/grokki-math.js';

const T=Date.UTC(2023,0,2)/1000, D=86400;
const mk=(n,fn)=>Array.from({length:n},(_,i)=>{const c=fn(i);return {time:T+i*D,open:c,high:c,low:c,close:c,volume:1e7};});
const N=900;
// A: steady rise to ~200, quick 30 % drop, then recovery. bench flat.
const A=mk(N,i=>i<500?100+i*0.2:(i<520?200-(i-500)*3:140+(i-520)*0.5));
const bench=mk(N,()=>100);
const Bslow=mk(N,i=>300*Math.pow(0.998,i));   // weaker than A, takes the slot after A's drop
const Bfast=mk(N,i=>3000*Math.pow(0.995,i));  // always weakest: A stays rank 1 after its drop
const base={benchmarkBars:bench,mode:'OFF',rsExit:false,fee:0};
const series=B=>[{ticker:'A',bars:A},{ticker:'B',bars:B}];

test('TRAIL unset and TRAIL=0 are identical to the old engine (no trailing exits)',()=>{
  const a=rotationBacktest(series(Bslow),2,1,base);
  const b=rotationBacktest(series(Bslow),2,1,{...base,trail:0,trailLock:4});
  assert.deepEqual(a.equity,b.equity);
  assert.deepEqual(a.tradeLog,b.tradeLog);
  assert.equal(a.stats.trailingExits,0);
  assert.equal(a.stats.trail,0);
  assert.equal(a.tradeLog.filter(t=>t.action==='SELL').length,0,'OFF + no RS exit: A is held to the end');
});

test('TRAIL=20 sells on weekly close <= 80 % of the high since entry, Monday open, German reason',()=>{
  const r=rotationBacktest(series(Bslow),2,1,{...base,trail:20,trailLock:4});
  const sell=r.tradeLog.find(t=>t.action==='SELL'&&t.ticker==='A');
  assert.ok(sell,'trailing exit expected');
  assert.equal(sell.trailing,true);
  assert.match(sell.reason,/^Trailing-Stop −20 % vom Hoch \(Hoch \d+,\d\d, Close \d+,\d\d\)$/);
  const m=sell.reason.match(/Hoch ([\d,]+), Close ([\d,]+)/);
  const hi=Number(m[1].replace(',','.')), cl=Number(m[2].replace(',','.'));
  assert.ok(cl<=hi*0.8+0.01, `${cl} <= 0.8*${hi}`);
  assert.equal(new Date(sell.date+'T00:00:00Z').getUTCDay(),1,'executed on Monday');
  assert.ok(sell.signalDate<sell.date);
  // other name fills the freed slot the same Monday
  const buyB=r.tradeLog.find(t=>t.action==='BUY'&&t.ticker==='B');
  assert.equal(buyB?.date,sell.date);
  assert.ok(r.stats.trailingExits>=1);
  assert.ok(r.closedTrades.some(t=>t.trailing));
  assert.equal(r.stats.auditOk,true);
  assert.match(r.stats.model,/TRAIL=20%/);
});

test('TRAILLOCK blocks re-buying the stopped ticker for N weeks; 0 allows immediate re-buy',()=>{
  const lock4=rotationBacktest(series(Bfast),2,1,{...base,trail:20,trailLock:4});
  const lock0=rotationBacktest(series(Bfast),2,1,{...base,trail:20,trailLock:0});
  const sell4=lock4.tradeLog.find(t=>t.action==='SELL');
  const rebuy4=lock4.tradeLog.find(t=>t.action==='BUY'&&t.ticker==='A'&&t.date>sell4.date);
  assert.ok(rebuy4,'A re-bought after the lock');
  const weeks=(Date.parse(rebuy4.signalDate)-Date.parse(sell4.signalDate))/(7*86400e3);
  assert.ok(weeks>=4 && weeks<5, `lock ${weeks} weeks`);
  assert.ok(lock4.stats.trailLockSkips>=1);
  const sell0=lock0.tradeLog.find(t=>t.action==='SELL');
  const rebuy0=lock0.tradeLog.find(t=>t.action==='BUY'&&t.ticker==='A'&&t.date>=sell0.date&&t!==lock0.tradeLog[0]);
  assert.equal(rebuy0?.date,sell0.date,'no lock: same-Monday re-buy');
  assert.equal(lock0.stats.trailLockSkips,0);
});

test('backtest final holdings expose trailPeak/trailStop only when TRAIL>0',()=>{
  const on=rotationBacktest(series(Bslow),2,1,{...base,trail:20});
  const off=rotationBacktest(series(Bslow),2,1,base);
  assert.ok(on.holdings.every(h=>Number.isFinite(h.trailPeak)&&Math.abs(h.trailStop-h.trailPeak*0.8)<1e-9));
  assert.ok(off.holdings.every(h=>!('trailStop' in h)));
});

test('trailingStopReason formats German numbers',()=>{
  assert.equal(trailingStopReason(20,48.86,38.22),'Trailing-Stop −20 % vom Hoch (Hoch 48,86, Close 38,22)');
  assert.equal(trailingStopReason(17.5,100,80),'Trailing-Stop −17,5 % vom Hoch (Hoch 100,00, Close 80,00)');
});

test('live trailingStopStatus: high since buy date incl. buy price, stop level, distance, hit',()=>{
  const buyIdx=400, buyDate=new Date((T+buyIdx*D)*1000).toISOString().slice(0,10);
  const pre=A.slice(0,505);
  const s=trailingStopStatus(pre, buyDate, 180, 20);
  assert.ok(s.peak>=199 && s.peak<=200, String(s.peak));
  assert.equal(s.stop, s.peak*0.8);
  assert.equal(s.close, pre.at(-1).close);
  assert.equal(s.hit, s.close<=s.stop);
  assert.ok(Math.abs(s.distPct-100*(s.close-s.stop)/s.close)<1e-9);
  assert.ok(s.distPct<=20+1e-9, 'Fallhöhe bis Stop nie > TRAIL');
  // During the drop (cut history) the stop is hit
  const cut=A.slice(0,516);
  const h=trailingStopStatus(cut, buyDate, 180, 20);
  assert.equal(h.hit,true);
  assert.match(h.reason,/^Trailing-Stop −20 % vom Hoch/);
  // weeks before the buy date are ignored: buying after the drop gives a fresh high
  const late=new Date((T+560*D)*1000).toISOString().slice(0,10);
  const l=trailingStopStatus(A.slice(0,600), late, null, 20);
  assert.ok(l.peak<200 && l.hit===false, String(l.peak));
  assert.equal(trailingStopStatus(A,'',100,20),null);
  assert.equal(trailingStopStatus(A,buyDate,100,0),null);
});

test('evaluatePositionBook adds trailing fields and exit hint only with trail>0',()=>{
  const cut=A.slice(0,516);
  const buyDate=new Date((T+400*D)*1000).toISOString().slice(0,10);
  const pos=[{id:'x',symbol:'A',universe:'SPX',buyDate,buyPrice:180}];
  const bars=new Map([['A',cut]]);
  const off=evaluatePositionBook(pos,bars,bench.slice(0,516),new Map([['A',1]]),{mode:'OFF',rankTop:25});
  assert.ok(!('trailStop' in off[0]));
  const on=evaluatePositionBook(pos,bars,bench.slice(0,516),new Map([['A',1]]),{mode:'OFF',rankTop:25,trail:20,rsExit:false});
  assert.equal(on[0].trailHit,true);
  assert.equal(on[0].trailPct,20);
  assert.ok(Number.isFinite(on[0].trailStop)&&Number.isFinite(on[0].trailDistPct));
  assert.equal(on[0].exitSignal,true);
  assert.match(on[0].exitHint,/Trailing-Stop −20 %/);
});
