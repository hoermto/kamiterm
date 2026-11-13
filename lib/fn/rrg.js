import {SECTORS} from './grokki-universes.js';
import {history,batch,SOURCE} from './grokki-data.js';
import {rrgPoint} from './grokki-math.js';
import { resolveMaFlags, applyMaFlags } from '../ma-flags.js';
export const QUADRANTS=['Leading','Weakening','Lagging','Improving'];
export default async function(q={}) {
  const sector=String(q.sector||'').toUpperCase(), season=String(q.season||q.quadrant||'').toLowerCase();
  if(sector && !SECTORS[sector]) throw Object.assign(new Error('sector must be '+Object.keys(SECTORS).join(', ')),{status:400});
  const seasons={summer:'Leading',autumn:'Weakening',winter:'Lagging',spring:'Improving'};
  const filter=QUADRANTS.find(x=>x.toLowerCase()===season)||seasons[season];
  if(season && !filter && season!=='all') throw Object.assign(new Error('season must be Leading, Weakening, Lagging, Improving (or Summer, Autumn, Winter, Spring)'),{status:400});
  const symbols=String(q.symbols||'').toUpperCase().split(/[\s,]+/).filter(Boolean);
  if(symbols.length>50 || symbols.some(t=>!/^([A-Z]{1,6})([.-][A-Z]{1,3})?$/.test(t))) throw Object.assign(new Error('Use up to 50 plain stock/ETF tickers'),{status:400});
  const tickers=[...new Set(symbols.length?symbols:sector?SECTORS[sector].stocks:Object.keys(SECTORS))];
  let bm;
  try{bm=await history('^GSPC',2);}catch(e){return {rows:[],errors:[{ticker:'^GSPC',error:e.message}],coverage:{requested:tickers.length,loaded:0,partial:true},source:SOURCE,benchmark:'SPX',warning:'Benchmark unavailable; no relative values fabricated.'};}
  const data=await batch(tickers,t=>history(t,2));
  const all=data.results.map(s=>{const p=rrgPoint(s.bars,bm.bars);return p?{ticker:s.ticker,name:SECTORS[s.ticker]?.name||s.ticker,...p}:null;}).filter(Boolean);
  for(const s of data.results) if(!all.some(r=>r.ticker===s.ticker)) data.errors.push({ticker:s.ticker,error:'Insufficient benchmark-aligned weekly history'});
  const filtered=all.filter(r=>!filter||r.quadrant===filter);
  // M&A: only annotate the rows actually shown (sector ETFs / drill-down / explicit symbols).
  let maFlags=new Map(), maErrors=[];
  try {
    const ma=await resolveMaFlags(filtered.map(r=>r.ticker), {universe:'SPX'});
    maFlags=ma.flags; maErrors=ma.errors;
  } catch(e) { maErrors=[{error:e.message||String(e)}]; }
  const rowsMa=applyMaFlags(filtered, maFlags, {key:'ticker'});
  return {benchmark:'SPX (^GSPC)',benchmarkAsOf:bm.asOf,sector:sector||null,mode:symbols.length?'stocks':sector?'sector stocks':'sector ETF proxies',filter:filter||'All',
    rows:rowsMa,sectors:Object.entries(SECTORS).map(([ticker,s])=>({ticker,name:s.name})),
    ma:{flagged:[...maFlags.keys()],errors:maErrors},
    coverage:{requested:data.requested,loaded:data.loaded,computed:all.length,partial:data.errors.length>0},errors:data.errors,
    warning:'JdK-style approximation, not proprietary JdK values. Sector ETF proxies; stock drill-down uses representative static subsets, not full GICS membership. Seasons mean rotation phase, NOT calendar seasonality.',
    formula:'Weekly RS = stock/SPX; Ratio = 100*RS/SMA13(RS); Momentum = 100*Ratio/SMA4(Ratio); axes at 100. Current partial week included.',source:SOURCE};
}
