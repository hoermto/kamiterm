import './helpers/isolate-data.js'; // must stay first: temp QT_DATA_DIR
// RANKING=RSL26|RSL39|MOM52_4: entry ranking + rank used for RANKTOP rank protection. Synthetic data only.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rotationBacktest,levy,rslWeeks,mom52_4,rankingScore,parseRanking,RANKINGS,weekly} from '../lib/fn/grokki-math.js';

const T=Date.UTC(2023,0,2)/1000, D=86400, N=600;
const mk=f=>Array.from({length:N},(_,i)=>{const c=f(i);return {time:T+i*D,open:c,high:c,low:c,close:c,volume:1e6};});
// X: flat, then a sharp rise in the last ~6 weeks → high RSL26, ~0 12-1 momentum (last 4 weeks skipped).
const X=mk(i=>i<560?100:100+(i-560));
// Y: steady 1-year rise, then flat → moderate RSL26, high 12-1 momentum.
const Y=mk(i=>i<540?100+i*100/540:200);
const B=mk(()=>100);
const series=[{ticker:'X',bars:X},{ticker:'Y',bars:Y}];
const base={benchmarkBars:B,mode:'OFF',rsExit:false,fee:0,windowStart:T+580*D};

test('parseRanking: values, aliases, default and error', () => {
  assert.deepEqual(RANKINGS,['RSL26','RSL39','MOM52_4']);
  assert.equal(parseRanking(undefined),'RSL26');
  assert.equal(parseRanking(''),'RSL26');
  assert.equal(parseRanking('rsl39'),'RSL39');
  assert.equal(parseRanking('mom52_4'),'MOM52_4');
  assert.equal(parseRanking('12-1'),'MOM52_4');
  assert.throws(()=>parseRanking('RSL20'),/RANKING must be/);
});

test('ranking metrics on weekly closes: RSL26 = levy, RSL39, MOM52_4 = close[-5]/close[-53]-1', () => {
  assert.equal(rankingScore(X,'RSL26'), levy(X));
  const w=weekly(Y);
  assert.equal(mom52_4(Y), w.at(-5).close/w.at(-53).close-1);
  const w39=w.slice(-39).map(b=>b.close);
  assert.ok(Math.abs(rslWeeks(Y,39)-w.at(-1).close/(w39.reduce((a,b)=>a+b,0)/39))<1e-12);
  assert.equal(mom52_4(Y.slice(0,52*7)), null, 'needs 53 weekly closes');
  assert.equal(rslWeeks(Y.slice(0,30*7),39), null, 'needs 39 weekly closes');
  const cut=X.slice(0,585);
  assert.ok(rankingScore(cut,'RSL26')>rankingScore(Y.slice(0,585),'RSL26'));
  assert.ok(rankingScore(cut,'MOM52_4')<rankingScore(Y.slice(0,585),'MOM52_4'));
});

test('RANKING unset and RSL26 give identical backtests (non-breaking default)', () => {
  const a=rotationBacktest(series,1,1,base), b=rotationBacktest(series,1,1,{...base,ranking:'RSL26'});
  assert.deepEqual(a,b);
  assert.equal(a.ranking,'RSL26');
  assert.equal(a.stats.ranking,'RSL26');
  assert.equal(a.holdings[0].ticker,'X');
});

test('MOM52_4 buys the 12-1 momentum leader; RSL39 is selectable', () => {
  const m=rotationBacktest(series,1,1,{...base,ranking:'MOM52_4'});
  assert.equal(m.ranking,'MOM52_4');
  assert.equal(m.holdings[0].ticker,'Y');
  assert.match(m.stats.model,/RANKING=MOM52_4/);
  const r39=rotationBacktest(series,1,1,{...base,ranking:'RSL39'});
  assert.equal(r39.ranking,'RSL39');
  assert.equal(r39.holdings[0].ticker,'X');
  assert.throws(()=>rotationBacktest(series,1,1,{...base,ranking:'FOO'}),/RANKING/);
});

test('rank used for exits / RANKTOP rank protection is the active ranking rank', () => {
  const rsl=rotationBacktest(series,1,2,base);
  const mom=rotationBacktest(series,1,2,{...base,ranking:'MOM52_4'});
  const rk=r=>Object.fromEntries(r.holdings.map(h=>[h.ticker,h.rank]));
  assert.deepEqual(rk(rsl),{X:1,Y:2});
  assert.deepEqual(rk(mom),{X:2,Y:1});
  // RS exit stays on Levy RSL26: the holdings' rsl field is still RSL26.
  const y=mom.holdings.find(h=>h.ticker==='Y');
  assert.ok(Math.abs(y.rsl-levy(Y.filter(b=>b.time<=T+(N-1)*D)))<0.05);
});
