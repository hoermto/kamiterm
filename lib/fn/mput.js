import {universe} from './grokki-universes.js';
import {history,batch,intParam,SOURCE} from './grokki-data.js';
import {bottomSignal,realizedVols,rrgPoint} from './grokki-math.js';
import {loadChain,cboeSymbol,daysBetween,nyToday} from './omon.js';
import {parseYahoo} from './dvd.js';
import {getJson,cached,YAHOO_UA} from '../providers.js';
import { resolveMaFlags, applyMaFlags } from '../ma-flags.js';

// RRG season gate. W2S (default): current quadrant Improving/Spring AND a Lagging/Winter
// point within the last 8 weekly trail points (= came out of winter recently).
export function seasonCheck(point, mode='W2S') {
  if(mode==='OFF') return {pass:true,rule:'off'};
  if(!point) return {pass:false,rule:mode,reason:'no RRG point'};
  const trail=point.trail||[], idx=trail.map(t=>t.season).lastIndexOf('Winter');
  const spring=point.season==='Spring', fromWinter=idx>=0 && trail.slice(idx+1).every(t=>t.season==='Spring'||t.season==='Winter');
  const pass=mode==='SPRING'?spring:spring&&fromWinter;
  return {pass,rule:mode,spring,fromWinter,weeksSinceWinter:idx>=0?trail.length-1-idx:null};
}

// Expected dividends between today (exclusive) and expiry (inclusive) from ex-date history (newest first).
// Declared future ex-dates are used; then the last regular amount is projected at the median payment gap.
export function projectDividends(hist, today, expiry) {
  const DAY=86400e3, list=(hist||[]).filter(d=>Number.isFinite(d.amount)&&d.amount>0);
  if(!list.length) return {amount:0,count:0,events:[],method:'no dividend history (assumed 0)'};
  const past=list.filter(d=>d.exDate<=today), future=list.filter(d=>d.exDate>today&&d.exDate<=expiry);
  const recent=past.slice(0,9), gaps=recent.slice(1).map((d,i)=>(Date.parse(recent[i].exDate)-Date.parse(d.exDate))/DAY).sort((a,b)=>a-b);
  const gap=gaps.length?gaps[Math.floor(gaps.length/2)]:null, last=past[0];
  const events=future.map(d=>({exDate:d.exDate,amount:d.amount,kind:'declared'}));
  if(gap && last && (Date.parse(today)-Date.parse(last.exDate))/DAY <= gap*2+15) {
    let t=Date.parse((future.at(0)||last).exDate);
    for(t+=gap*DAY; t<=Date.parse(expiry); t+=gap*DAY) {
      const ex=new Date(t).toISOString().slice(0,10);
      if(ex>today) events.push({exDate:ex,amount:last.amount,kind:'projected'});
    }
  }
  return {amount:events.reduce((s,e)=>s+e.amount,0),count:events.length,events,
    method:gap?`declared + last dividend ($${last?.amount}) repeated every ~${Math.round(gap)} days`:'declared only (irregular history)'};
}
async function dividendsFor(ticker) {
  return cached(`mput-div:${ticker}`,3*3600e3,async()=>parseYahoo(await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5y&events=div`,YAHOO_UA))||[]);
}
// Black-Scholes put theta per calendar day (r=0, no dividends): -S*phi(d1)*sigma/(2*sqrt(T))/365.
export function putTheta(S,K,T,sigma) {
  if(!(S>0&&K>0&&T>0&&sigma>0)) return null;
  const d1=(Math.log(S/K)+sigma*sigma*T/2)/(sigma*Math.sqrt(T));
  return -S*Math.exp(-d1*d1/2)/Math.sqrt(2*Math.PI)*sigma/(2*Math.sqrt(T))/365;
}
export function riskMath(price,ask,strike,div=0) {
  const cost=price+ask, maxLoss=cost-strike-div;
  return {cost,breakEven:cost-div,maxLoss,maxLoss100:100*maxLoss,maxLossPct:100*maxLoss/cost};
}
export function suggestPut(chain,bars,q={}) {
  const p=chain.price, today=nyToday(), target=Number(q.otm??15), vols=realizedVols(bars);
  const dteMin=Number(q.dteMin??180), dteMax=Number(q.dteMax??365);
  if(!(p>0)) return null;
  const lo=vols.length?Math.min(...vols):null, hi=vols.length?Math.max(...vols):null;
  const suggestions=[];
  for(const e of chain.expiries) {
    const dte=daysBetween(today,e.date);if(dte<dteMin||dte>dteMax) continue;
    for(const row of e.rows) {
      const put=row.put, otm=100*(1-row.strike/p);
      if(!put || /\d$/.test(e.root) || otm<2||otm>40 || !(put.bid>0&&put.ask>=put.bid) || put.oi<50) continue;
      const spread=100*(put.ask-put.bid)/((put.ask+put.bid)/2);if(spread>35) continue;
      const iv=put.iv>0?put.iv:null;
      // NOT true IVR: current contract IV located in the trailing realized-volatility range.
      const ivrProxy=iv!=null && hi>lo && vols.length>=100 ? Math.max(0,Math.min(100,100*(iv-lo)/(hi-lo))) : null;
      if(ivrProxy==null || ivrProxy>Number(q.ivrMax??30)) continue;
      const theta=putTheta(p,row.strike,dte/365,iv);
      suggestions.push({expiry:e.date,root:e.root,strike:row.strike,dte,otm,iv:iv*100,ivrProxy,ivrKind:'IV vs trailing 20-day realized-vol range (NOT historical IVR)',
        bid:put.bid,ask:put.ask,premium:put.ask,premium100:put.ask*100,oi:put.oi,spreadPct:spread,theta,thetaPctPerDay:theta!=null?100*theta/put.ask:null,
        ...riskMath(p,put.ask,row.strike,0),
        score:Math.abs(otm-target)+Math.abs(dte-270)/90,source:chain.source,asOf:chain.asOf});
    }
  }
  return suggestions.sort((a,b)=>a.score-b.score)[0]||null;
}
const num=(v,name)=>{if(v==null||v==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0)throw Object.assign(new Error(`${name} must be a number >= 0`),{status:400});return n;};
export default async function(q={}) {
  const u=universe(q,['SPX','NDX']), ivrMax=intParam(q.ivrMax,30,0,100), otm=intParam(q.otm,15,2,40);
  const season=String(q.season||'W2S').toUpperCase();
  if(!['W2S','SPRING','OFF'].includes(season)) throw Object.assign(new Error('season must be W2S, SPRING or OFF'),{status:400});
  const maxLoss=num(q.maxLoss,'maxLoss'), maxLossPct=num(q.maxLossPct,'maxLossPct');
  const data=await batch(u.tickers,t=>history(t,2));
  let bm=null;if(season!=='OFF') bm=await history('^GSPC',2);
  const scored=data.results.map(s=>{const signal=bottomSignal(s.bars), rrg=bm?rrgPoint(s.bars,bm.bars):null;return {...s,signal,rrg,seasonGate:seasonCheck(rrg,season)};});
  const bottoms=scored.filter(s=>s.signal?.pass), picks=bottoms.filter(s=>s.seasonGate.pass);
  const opts=await batch(picks.map(s=>s.ticker),async ticker=>{
    const s=picks.find(s=>s.ticker===ticker),chain=await loadChain(cboeSymbol(ticker));
    const put=suggestPut(chain,s.bars,{ivrMax,otm});
    let div={amount:0,count:0,events:[],method:'n/a'};
    if(put) try{div=projectDividends(await dividendsFor(ticker),nyToday(),put.expiry);}catch(e){div={amount:0,count:0,events:[],method:'dividend data unavailable (assumed 0): '+e.message};}
    return {ticker,s,put:put?{...put,...riskMath(chain.price,put.ask,put.strike,div.amount)}:null,div,price:chain.price,priceAsOf:chain.priceTime};
  },30000,4);
  const all=opts.results.filter(x=>x.put).map(x=>({ticker:x.ticker,...x.s.signal,
    crit:{liquid:x.s.signal.avgDollar>=2e7,fallen:x.s.signal.drawdown>=10,bottom:true,ivrOk:true,season:x.s.seasonGate.pass},
    rrgSeason:x.s.rrg?.season??null,rsRatio:x.s.rrg?.ratio??null,rsMomentum:x.s.rrg?.momentum??null,weeksSinceWinter:x.s.seasonGate.weeksSinceWinter??null,
    rrgTrail:(x.s.rrg?.trail||[]).map(t=>t.season[0]).join(''),
    price:x.price,priceAsOf:x.priceAsOf,...x.put,divExpected:x.div.amount,divCount:x.div.count,divMethod:x.div.method,divEvents:x.div.events}));
  const rows=all.filter(r=>(maxLoss==null||r.maxLoss<=maxLoss)&&(maxLossPct==null||r.maxLossPct<=maxLossPct)).sort((a,b)=>a.maxLossPct-b.maxLossPct);
  let maFlags=new Map(), maErrors=[];
  try {
    const ma=await resolveMaFlags(rows.map(r=>r.ticker), {universe:u.key});
    maFlags=ma.flags; maErrors=ma.errors;
  } catch(e) { maErrors=[{error:e.message||String(e)}]; }
  const rowsMa=applyMaFlags(rows, maFlags, {key:'ticker'});
  return {universe:u.key,universeLabel:u.label,rows:rowsMa,ivrMax,otm,season,maxLoss,maxLossPct,
    ma:{flagged:[...maFlags.keys()],errors:maErrors},
    coverage:{requested:data.requested,loaded:data.loaded,bottoms:bottoms.length,seasonPass:picks.length,chainsLoaded:opts.loaded,withPut:all.length,candidates:rows.length,partial:data.partial||opts.partial},errors:[...data.errors,...opts.errors],
    excluded:[...bottoms.filter(s=>!s.seasonGate.pass).map(s=>({ticker:s.ticker,reason:`RRG season ${s.rrg?.season??'n/a'} (trail ${(s.rrg?.trail||[]).map(t=>t.season[0]).join('')}) fails ${season}`})),
      ...opts.results.filter(s=>!s.put).map(s=>({ticker:s.ticker,reason:'No 180–365 DTE, 2–40% OTM put meeting IV-proxy, OI and bid/ask filters'})),
      ...all.filter(r=>!rows.includes(r)).map(r=>({ticker:r.ticker,reason:`Max loss ${r.maxLoss.toFixed(2)}$/sh (${r.maxLossPct.toFixed(1)}%) above filter`}))],
    warning:'No historical IV series: IVR PROXY ONLY, not true IV Rank. Dividends are PROJECTED from ex-date history (Yahoo), not guaranteed. Theta is a Black-Scholes estimate (r=0). Max loss assumes holding stock + put to expiry, exercise at strike, dividends received, no costs/taxes/early assignment. Research candidates, not recommendations.',
    heuristic:`Stock: 20-day avg $ volume >= $20m; >=10% below 126-day high; rebound 3–15% from 20-day low; low >=5 bars old; close >= SMA10. RRG season ${season}: W2S = now Spring (Improving) and Winter (Lagging) within last 8 weeks, only Winter/Spring since. Put: 180–365 DTE (6–12 months), 2–40% OTM closest to target ${otm}% (score |OTM-target| + |DTE-270|/90), OI>=50, bid>0, spread<=35%, IVR proxy<=${ivrMax}. Max loss/sh = stock + put ask − strike − expected dividends.`,
    source:SOURCE+' Options: CBOE delayed / Nasdaq fallback (no IV, excluded). Dividends: Yahoo chart dividend events.'};
}
