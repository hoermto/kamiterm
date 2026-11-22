import {getCandles,cached} from '../providers.js';
import {iso} from './grokki-math.js';
import {cacheStats,getRefreshMs} from '../ohlcv-cache.js';
import {FREEZE_REF,FREEZE_PATCHES,findFreezes,altMap,patchFreezes} from '../data-quality.js';

export function intParam(value, fallback, min, max) {
  if(value==null || value==='') return fallback;
  const n=Number(value);
  if(!Number.isInteger(n)||n<min||n>max) throw Object.assign(new Error(`Expected integer ${min}..${max}`),{status:400});
  return n;
}
export function numParam(value, fallback, min, max) {
  if(value==null || value==='') return fallback;
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max) throw Object.assign(new Error(`Expected number ${min}..${max}`),{status:400});
  return n;
}

/**
 * Daily history via the general providers.getCandles() SQLite+Yahoo layer.
 * Thin in-memory dedupe kept for scanner bursts; no second SQLite path.
 */
export function history(ticker, years=2) {
  // kept as long as the refresh interval (SETTINGS); a background refresh with new bars drops it (lib/ohlc-live.js)
  return cached(`grokki:${ticker}:${years}`,getRefreshMs(),async()=>{
    const h=await rawHistory(ticker,years);
    return {...h,...await checkQuality(ticker,years,h.bars)};
  });
}

/**
 * Datenqualität beim Lesen (lib/data-quality.js): eingefrorene Schlusskurse erkennen; für bekannte Instrumente
 * (FREEZE_PATCHES) aus der Alternativquelle ersetzen. Der Cache bleibt unverändert, darum wirkt es auf jedem Rechner.
 * -> { bars (ggf. korrigiert), quality: { freezes, patches, unpatched } }
 */
async function checkQuality(ticker,years,bars){
  if(process.env.QT_DATA_FIX==='0') return {quality:null}; // nur zum Vergleich/Debug: Rohdaten ohne Korrektur
  const refT=FREEZE_REF[ticker], alts=FREEZE_PATCHES[ticker];
  const raw=async(t)=>{try{return (await rawHistory(t,years)).bars;}catch{return null;}};
  const ref=refT?await raw(refT):null;
  // ohne Referenz erst ab 10 gleichen Schlüssen in Folge (sonst nur bei bewegter Referenz ab 5)
  const freezes=findFreezes(bars,refT?{minRun:5,ref}:{minRun:10});
  if(!freezes.length) return {quality:null};
  let patched={bars,patches:[]};
  if(alts?.length){
    const fxCache=new Map();
    const sources=[];
    for(const a of alts){
      const ab=await raw(a.alt); if(!ab) continue;
      let fb=null; if(a.fx){ if(!fxCache.has(a.fx)) fxCache.set(a.fx,await raw(a.fx)); fb=fxCache.get(a.fx); if(!fb) continue; }
      sources.push({label:a.label,synthetic:!!a.synthetic,map:altMap(ab,fb,a.op)});
    }
    patched=patchFreezes(bars,freezes,sources);
  }
  const done=new Set(patched.patches.filter(p=>p.filled>0).map(p=>p.from));
  return {bars:patched.bars,quality:{freezes:freezes.map(({start,end,...f})=>f),patches:patched.patches,unpatched:freezes.filter(f=>!done.has(f.from)).map(({start,end,...f})=>f)}};
}

/** Rohe Tageskurse wie im Cache (ohne Datenkorrektur). */
export function rawHistory(ticker, years=2) {
  return cached(`grokki:${ticker}:raw:${years}`,getRefreshMs(),async()=>{
    const limit=Math.ceil((years+1)*270);
    const r=await getCandles(ticker.startsWith('^')?ticker:`YAHOO:${ticker}`,'1D',limit);
    if(r.provider==='fixture') throw new Error('Offline fixture prices are not valid scanner data');
    const bars=r.candles.filter(b=>b.close>0 && b.open>0).sort((a,b)=>a.time-b.time);
    if(!bars.length) throw new Error('Empty history');
    if(Date.now()/1000-bars.at(-1).time>14*86400) throw new Error('Latest price is older than 14 days; stale/delisted symbol excluded');
    return {ticker,bars,provider:r.provider,asOf:iso(bars.at(-1).time),fromCache:!!r.fromCache};
  });
}

/**
 * Parallel scan helper. Default budget 180s / concurrency 6 so a cold 500-name SPX
 * can warm the SQLite cache; warm runs finish from DB well under budget.
 */
export async function batch(tickers, fn, budget=180000, concurrency=6) {
  const results=[], errors=[]; let next=0; const end=Date.now()+budget;
  async function worker() {
    while(next<tickers.length && Date.now()<end) {
      const ticker=tickers[next++]; let timer;
      try {
        const row=await Promise.race([Promise.resolve().then(()=>fn(ticker)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Scan deadline exceeded')),Math.max(1,end-Date.now()));})]);
        results.push(row);
      } catch(e) { errors.push({ticker,error:e.message}); } finally {clearTimeout(timer);}
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,tickers.length)},worker));
  for(const ticker of tickers.slice(next)) errors.push({ticker,error:'Not fetched within scan budget; retry to use cached histories'});
  return {results,errors,requested:tickers.length,loaded:results.length,partial:errors.length>0};
}

export {cacheStats};
export const SOURCE='Yahoo daily raw OHLC via Amber provider + general persistent SQLite cache (data/cache/ohlcv.sqlite) inside getCandles for 1D; in-memory layer on top; up to 15-minute delay. SPX = full S&P 500 snapshot (as-of 2026-11-09); NDX/DAX static reference rosters.';
