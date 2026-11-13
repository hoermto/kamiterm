export const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
export const iso = t => new Date(t*1000).toISOString().slice(0,10);
export function weekly(bars) {
  const out=[];
  for(const b of bars) {
    const key=Math.floor((b.time+3*86400)/(7*86400)); // Monday-based weeks
    if(out.at(-1)?.key===key) out[out.length-1]={...b,key}; else out.push({...b,key});
  }
  return out;
}
// Classic Levy: latest weekly close / average of the last 26 weekly closes, including latest.
export function levy(bars) {
  const w=weekly(bars).slice(-26);
  return w.length===26 ? w.at(-1).close/mean(w.map(x=>x.close)) : null;
}
export function rrgPoint(stock, benchmark) {
  const trail=rrgSeries(stock, benchmark);
  return trail.length ? {...trail.at(-1),trail:trail.slice(-8)} : null;
}
/** Full weekly RRG trail (JdK-style). Never daily. */
export function rrgSeries(stock, benchmark) {
  const bm=new Map(weekly(benchmark).map(b=>[b.key,b.close]));
  const rs=weekly(stock).filter(b=>bm.has(b.key)).map(b=>({key:b.key,time:b.time,value:b.close/bm.get(b.key)}));
  const ratios=[];
  for(let i=12;i<rs.length;i++) ratios.push({key:rs[i].key,time:rs[i].time,value:100*rs[i].value/mean(rs.slice(i-12,i+1).map(x=>x.value))});
  const trail=[];
  for(let i=3;i<ratios.length;i++) {
    const ratio=ratios[i].value, momentum=100*ratio/mean(ratios.slice(i-3,i+1).map(x=>x.value));
    const quadrant=ratio>=100?(momentum>=100?'Leading':'Weakening'):(momentum>=100?'Improving':'Lagging');
    const season={Leading:'Summer',Weakening:'Autumn',Lagging:'Winter',Improving:'Spring'}[quadrant];
    trail.push({key:ratios[i].key,time:iso(ratios[i].time),ratio,momentum,quadrant,season});
  }
  return trail;
}
/** RRG point using only bars strictly before asOfSec (point-in-time). */
export function rrgPointBefore(stock, benchmark, asOfSec) {
  return rrgPoint(stock.filter(b=>b.time<asOfSec), benchmark.filter(b=>b.time<asOfSec));
}
export function levyBefore(bars, asOfSec) {
  return levy(bars.filter(b=>b.time<asOfSec));
}
export function realizedVols(bars) {
  const returns=bars.slice(1).map((b,i)=>Math.log(b.close/bars[i].close)), out=[];
  for(let i=19;i<returns.length;i++) {
    const a=returns.slice(i-19,i+1), m=mean(a);
    out.push(Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/19)*Math.sqrt(252));
  }
  return out.slice(-252);
}
export function bottomSignal(bars) {
  if(bars.length<126) return null;
  const a=bars.slice(-126), recent=a.slice(-20), p=a.at(-1).close;
  const low=Math.min(...recent.map(x=>x.low)), high=Math.max(...a.map(x=>x.high));
  const lowIndex=recent.findIndex(x=>x.low===low), drawdown=100*(1-p/high), rebound=100*(p/low-1);
  const avgDollar=mean(a.slice(-20).map(b=>b.close*b.volume));
  return {price:p,drawdown,rebound,avgDollar,bottomAge:19-lowIndex,
    pass:drawdown>=10 && rebound>=3 && rebound<=15 && lowIndex<=14 && p>=mean(a.slice(-10).map(b=>b.close)) && avgDollar>=20000000};
}

export const RRG_EXIT_MODES=['OFF','DIRECT','DIRECT+RSL','CONFIRM','RANK'];
export const BENCHMARKS={SPX:'^GSPC',NDX:'^NDX',DAX:'^GDAXI',HDAX:'^GDAXI',SXXP:'^STOXX'};
export function rrgExitDefaults(universe='SPX') {
  const u=String(universe||'SPX').toUpperCase();
  if(u==='NDX') return {mode:'CONFIRM',rankTop:50};
  if(u==='DAX') return {mode:'OFF',rankTop:25};
  // Research 10.11.2026 (strategies/RSL26_HDAX_Europa_2026-11-10.md): HDAX Kandidat B = RANK RT10; STOXX 600 Kandidat A = OFF.
  if(u==='HDAX') return {mode:'RANK',rankTop:10};
  if(u==='SXXP') return {mode:'OFF',rankTop:25};
  return {mode:'RANK',rankTop:25};
}
export function parseRrgExitMode(value, fallback='RANK') {
  if(value==null || value==='') return fallback;
  const raw=String(value).trim().toUpperCase().replace(/\s+/g,'');
  const aliases={DIRECT_RSL:'DIRECT+RSL',DIRECTRSL:'DIRECT+RSL',DIRECTPLUSRSL:'DIRECT+RSL','DIRECT+RSL':'DIRECT+RSL'};
  const mode=aliases[raw]||raw;
  if(!RRG_EXIT_MODES.includes(mode)) throw Object.assign(new Error(`RRGEXIT must be ${RRG_EXIT_MODES.join(' | ')}`),{status:400});
  return mode;
}

/**
 * Weekly RRG-Exit decision. Leading→Weakening OR Leading→Lagging starts the weakness phase.
 * Caller supplies lastQuadrant from the prior weekly point (no buy-date gating here).
 *
 * state: {lastQuadrant, weaknessSince, confirmPending, rankAtSwitch}
 * snap:  {quadrant, rank, stockRsl, benchRsl, asOf}
 * opts:  {mode, rankTop}
 * returns {exit, reason, state, openSince, weaknessPhase}
 */
export function evaluateRrgExit(state, snap, opts={}) {
  const mode=opts.mode||'OFF';
  const rankTop=(opts.rankTop??25)|0;
  const rankSchutzOff=!(rankTop>0); // RANKTOP=0 → Rank-Schutz aus
  const confirmWeeks=Math.max(1, Math.min(8, (opts.confirmWeeks|0)||1));
  const prev=state?.lastQuadrant??null;
  const curr=snap.quadrant;
  const rank=snap.rank;
  let weaknessSince=state?.weaknessSince??null;
  let confirmPending=state?.confirmPending??null;
  let confirmCount=state?.confirmCount??0;
  let exit=false, reason=null;

  const weak=q=>q==='Weakening'||q==='Lagging';
  const strong=q=>q==='Leading'||q==='Improving';
  const outsideSchutz=()=>rankSchutzOff || rank==null || rank>rankTop;
  const insideSchutz=()=>!rankSchutzOff && rank!=null && rank<=rankTop;

  if(curr && strong(curr)) {
    weaknessSince=null;
    confirmPending=null;
    confirmCount=0;
  } else if(prev==='Leading' && weak(curr)) {
    const edge=`Leading→${curr}`;
    if(mode!=='OFF') weaknessSince=snap.asOf;
    if(mode==='DIRECT') { exit=true; reason=`RRG ${edge}`; }
    else if(mode==='DIRECT+RSL') {
      if(snap.stockRsl!=null && snap.benchRsl!=null && snap.stockRsl<snap.benchRsl) {
        exit=true; reason=`RRG ${edge} + RSL < Benchmark`;
      }
    } else if(mode==='CONFIRM') {
      if(insideSchutz()) { confirmPending=snap.asOf; confirmCount=0; }
      else { exit=true; reason=`RRG ${edge} (Rank ${rank}>${rankTop||0})`; }
    } else if(mode==='RANK') {
      if(outsideSchutz()) {
        exit=true;
        reason=rankSchutzOff?`RRG ${edge} (Rank-Schutz aus)`:`RRG Weakness außerhalb Rank-Schutz Top ${rankTop}`;
      }
    }
  } else if(weaknessSince && weak(curr)) {
    if(mode==='CONFIRM' && confirmPending) {
      confirmCount=(confirmCount||0)+1;
      if(confirmCount>=confirmWeeks) {
        exit=true;
        reason=`RRG Leader-Schutz: Bestätigung nach ${confirmWeeks} Woche${confirmWeeks>1?'n':''}`;
        confirmPending=null; confirmCount=0;
      }
    } else if(mode==='RANK' && outsideSchutz()) {
      exit=true;
      reason=rankSchutzOff?`RRG Weakness (Rank-Schutz aus)`:`RRG Weakness außerhalb Rank-Schutz Top ${rankTop}`;
    }
  }

  const next={
    lastQuadrant:curr??prev,
    weaknessSince:exit?null:weaknessSince,
    confirmPending:exit?null:confirmPending,
    confirmCount:exit?0:confirmCount,
  };
  return {
    exit,
    reason,
    state:next,
    openSince:next.weaknessSince,
    weaknessPhase:!!next.weaknessSince,
  };
}

const deNum=(v,d=2)=>Number.isFinite(v)?v.toFixed(d).replace('.',','):'—';
/** German reason text for a trailing-stop exit. */
export function trailingStopReason(trailPct, peak, close) {
  return `Trailing-Stop −${deNum(trailPct, Number.isInteger(trailPct)?0:1)} % vom Hoch (Hoch ${deNum(peak)}, Close ${deNum(close)})`;
}

/** Entry ranking metrics (higher = better). RS-exit always stays on Levy RSL26. */
export const RANKINGS=['RSL26','RSL39','MOM52_4'];
export const RANKING_LABELS={RSL26:'RSL26',RSL39:'RSL39',MOM52_4:'Mom 12-1 %'};
export function parseRanking(value, fallback='RSL26') {
  if(value==null || value==='') return fallback;
  const raw=String(value).trim().toUpperCase().replace(/[\s-]+/g,'_');
  const aliases={RSL:'RSL26',LEVY:'RSL26',MOM:'MOM52_4',MOM12_1:'MOM52_4',MOM_12_1:'MOM52_4','12_1':'MOM52_4',MOM52:'MOM52_4'};
  const r=aliases[raw]||raw;
  if(!RANKINGS.includes(r)) throw Object.assign(new Error(`RANKING must be ${RANKINGS.join(' | ')}`),{status:400});
  return r;
}
/** Close / mean of the last L weekly closes (latest included); null if < L weeks. */
export function rslWeeks(bars, L=26) {
  const w=weekly(bars).slice(-L);
  return w.length===L ? w.at(-1).close/mean(w.map(x=>x.close)) : null;
}
/** 12-1 momentum on weekly closes: close 4 weeks ago / close 52 weeks ago − 1 (fraction). Needs 53 weeks. */
export function mom52_4(bars) {
  const w=weekly(bars);
  if(w.length<53) return null;
  const a=w.at(-53).close, b=w.at(-5).close;
  return a>0 && b>0 ? b/a-1 : null;
}
/** Ranking score of a bar history (bars up to the signal day) for the given ranking. */
export function rankingScore(bars, ranking='RSL26') {
  if(ranking==='RSL39') return rslWeeks(bars, 39);
  if(ranking==='MOM52_4') return mom52_4(bars);
  return levy(bars);
}

export function evaluateRsBelowBench(stockRsl, benchRsl) {
  if(stockRsl==null || benchRsl==null) return {exit:false,reason:null};
  if(stockRsl<benchRsl) return {exit:true,reason:'RSL Aktie < RSL Benchmark'};
  return {exit:false,reason:null};
}

/**
 * Weekly Top-N RSL backtest with a shared cash pool (no monthly full rotation).
 *
 * Portfolio model:
 *   - Signal on the last trading day of each week (Friday, or prior session) on close:
 *     Levy RSL26 rank + Holdings exit rules (evaluateTrailExit / RRG / Rank-Schutz /
 *     RSL < Benchmark).
 *   - Execute on the first trading day of the next week (Monday, or next session) at
 *     OPEN when available, else close (`execPriceKind`).
 *   - Shared cash: on each exec day, sell all exit signals first (proceeds → cash),
 *     then buy replacements / fills in rank order among Top-n not already held.
 *   - Per new entry budget = min(Kapital/n, available cash).
 *       SIZE=EQUITY (default): Kapital = total equity at that day's open marks,
 *         computed once before entries (after exits; equal to pre-exit open equity).
 *       SIZE=START: Kapital = startCapital (fixed).
 *   - FRACTIONAL=1 (default): fractional shares. FRACTIONAL=0: whole shares
 *     floor(budget/price); leftover cash; skip if 0 shares.
 *   - Held names without an exit stay held even outside Top-n. Empty slots wait for
 *     cash/candidates next week.
 *   - Daily equity = cash + MTM at close. Survivorship bias; no historical M&A filter.
 *
 * opts: {benchmarkBars, mode, rankTop, confirmWeeks, rsExit, universe, startCapital, fractional, sizeMode, startOffsetWeeks, fee, windowStart, windowEnd, seedHoldings, seedCash, trail, trailLock, ranking}
 * ranking: entry ranking RSL26 (default, Levy) | RSL39 | MOM52_4 (12-1 momentum on weekly closes). Top-N entries and
 *   RANKTOP rank protection use this rank; the RS exit (stock vs benchmark) always stays on RSL26.
 * trail: optional trailing stop in % (0=off). Exit when weekly close <= (1-trail/100) * highest weekly close since entry (entry price included); exec next Monday open. After a trailing exit the ticker is not re-bought for trailLock weeks (default 4); other names fill the slot.
 * seedHoldings: [{ticker, shares, entryPrice, bought, feePaid}] carried into the window; seedCash overrides starting cash.
 * `tradesOpen` / "offen" = still held at period end (MTM).
 */
export function rotationBacktest(series, years=5, n=10, opts={}) {
  const allDates=[...new Set(series.flatMap(s=>s.bars.map(b=>b.time)))].sort((a,b)=>a-b);
  if(!allDates.length) return {error:'No price histories',equity:[],stats:null};
  const startOffsetWeeks=Math.max(0, Number(opts.startOffsetWeeks)||0)|0;
  // Optional absolute window (unix sec). Bars before windowStart remain for RSL/RRG lookback;
  // trading loop only runs inside [windowStart, windowEnd].
  const windowStart=Number.isFinite(Number(opts.windowStart))?Number(opts.windowStart):null;
  const windowEnd=Number.isFinite(Number(opts.windowEnd))?Number(opts.windowEnd):null;
  const endT=windowEnd!=null?windowEnd:allDates.at(-1);
  const cutoff=windowStart!=null
    ? windowStart + startOffsetWeeks*7*86400
    : endT-years*365.25*86400 + startOffsetWeeks*7*86400;
  const maps=series.map(s=>({...s,map:new Map(s.bars.map(b=>[b.time,b]))}));
  const bmBars=opts.benchmarkBars||null;
  const mode=opts.mode||'OFF';
  const rankTop=opts.rankTop??25;
  const confirmWeeks=Math.max(1, Math.min(8, (Number(opts.confirmWeeks)||1)|0));
  const rsExit=opts.rsExit!==false && opts.rsExit!==0 && opts.rsExit!=='0';
  const startCapital=Number.isFinite(opts.startCapital)&&opts.startCapital>0?opts.startCapital:10000;
  const fractional=opts.fractional!==false && opts.fractional!==0 && opts.fractional!=='0';
  const sizeMode=String(opts.sizeMode||opts.size||'EQUITY').toUpperCase()==='START'?'START':'EQUITY';
  // Absolute currency fee per execution (BUY and SELL each). Default $1. Not a % cost.
  const feePerTrade=Number.isFinite(Number(opts.fee??opts.FEE)) ? Math.max(0, Number(opts.fee??opts.FEE)) : 1;
  const nSlots=Math.max(1,n|0);
  const weekKey=t=>Math.floor((t+3*86400)/(7*86400));
  // Optional trailing stop (percent of highest weekly close since entry). 0 = off (default).
  const trailPct=Number.isFinite(Number(opts.trail))?Math.max(0, Math.min(95, Number(opts.trail))):0;
  const trailLockWeeks=Number.isFinite(Number(opts.trailLock))?Math.max(0, Math.floor(Number(opts.trailLock))):4;
  const trailLockedAt=new Map(); // ticker -> signal week key of the trailing exit
  const ranking=parseRanking(opts.ranking, 'RSL26');
  const holdDays=(buyIso, sellIso)=>Math.max(0, Math.round((Date.parse(sellIso+'T00:00:00Z')-Date.parse(buyIso+'T00:00:00Z'))/86400e3));

  const byWeek=new Map();
  for(const t of allDates) {
    const k=weekKey(t);
    if(!byWeek.has(k)) byWeek.set(k,[]);
    byWeek.get(k).push(t);
  }
  const weeks=[...byWeek.entries()].sort((a,b)=>a[0]-b[0]).map(([key,days])=>{
    days.sort((a,b)=>a-b);
    return {key, days, first:days[0], last:days.at(-1)};
  });
  const weekByKey=new Map(weeks.map(w=>[w.key,w]));

  function execPx(bar) {
    if(bar?.open>0) return {px:bar.open, kind:'open'};
    if(bar?.close>0) return {px:bar.close, kind:'close'};
    return null;
  }

  function universeRankAt(asOfSec) {
    return maps.map(s=>{
      const prior=s.bars.filter(b=>b.time<=asOfSec);
      const last=prior.at(-1);
      // RSL26 needs 26 weekly bars; other rankings need their own lookback (all >= 26 weeks).
      return {...s, score:last && asOfSec-last.time<=7*86400 ? rankingScore(prior, ranking) : null};
    }).filter(s=>s.score!=null).sort((a,b)=>b.score-a.score)
      .map((s,i)=>({ticker:s.ticker,rank:i+1,score:s.score,s}));
  }

  function signalExit(holding, signalT, ranked) {
    const prior=holding.s.bars.filter(b=>b.time<=signalT);
    const bmPrior=bmBars?bmBars.filter(b=>b.time<=signalT):null;
    const stockRsl=levy(prior);
    const benchRsl=bmPrior?levy(bmPrior):null;
    const trail=bmPrior?rrgSeries(prior, bmPrior):[];
    const rank=ranked.find(r=>r.ticker===holding.s.ticker)?.rank??null;
    const ev=evaluateTrailExit(trail, {rank, stockRsl, benchRsl}, {mode, rankTop, confirmWeeks, rsExit});
    const rrg=trail.length?trail.at(-1):null;
    return {
      exit:!!ev.exitHint,
      reason:ev.exitHint,
      openSince:ev.openSince,
      weaknessPhase:ev.weaknessPhase,
      weekChange:ev.weekChange,
      stockRsl, benchRsl, rank,
      quadrant:rrg?.quadrant??null,
      season:rrg?.season??null,
      ratio:rrg?.ratio??null,
      momentum:rrg?.momentum??null,
      prevWeekQuadrant:trail.length>=2?trail.at(-2).quadrant:null,
      weekClose:prior.length?prior.at(-1).close:null,
    };
  }

  const seedHoldingsIn=Array.isArray(opts.seedHoldings)?opts.seedHoldings:[];
  const seedCash=Number.isFinite(Number(opts.seedCash))?Number(opts.seedCash):null;
  let cash=seedCash!=null?seedCash:startCapital;
  let holdings=[]; // {s, shares, entryPrice, last, bought, execPriceKind, ...}
  const tickerMap=new Map(maps.map(s=>[s.ticker,s]));
  for(const sh of seedHoldingsIn){
    const s=tickerMap.get(sh.ticker);
    if(!s||!(sh.shares>0)) continue;
    const lastBar=s.bars.filter(b=>windowStart==null||b.time<= (windowEnd??Infinity)).at(-1)
      || s.bars.at(-1);
    holdings.push({
      s,
      shares:sh.shares,
      entryPrice:sh.entryPrice??sh.last??lastBar?.close??0,
      last:sh.last??lastBar?.close??0,
      bought:sh.bought||iso(windowStart||cutoff),
      execPriceKind:sh.execPriceKind||'carry',
      feePaid:sh.feePaid||0,
      lastSnap:null,
      openSince:sh.openSince||null,
      weaknessPhase:!!sh.weaknessPhase,
      peakClose:Number.isFinite(Number(sh.peakClose))?Number(sh.peakClose):(sh.entryPrice??sh.last??lastBar?.close??0),
    });
  }
  const equity=[], rebalances=[], exits=[], closedTrades=[], entries=[];
  const tradeLog=[], weeklyLog=[];
  // Peak starts at seeded MTM so MaxDD inside the window is relative to carried equity.
  const seedMtm=cash+holdings.reduce((v,h)=>v+h.shares*(h.last||0),0);
  let peak=Math.max(startCapital, seedMtm||startCapital), mdd=0;
  // Carried holdings → skip empty initial buy; first week applies new exit/entry rules.
  let initialized=holdings.length>0;
  let lastWeekKey=null;
  let execPriceKindUsed={open:0, close:0};
  let cashQuotaSum=0, cashQuotaN=0, entriesReduced=0, entriesAttempted=0;

  function heldSet() {
    return new Set(holdings.map(h=>h.s.ticker));
  }

  function equityAtOpen(execT) {
    let v=cash;
    for(const h of holdings) {
      const ep=execPx(h.s.map.get(execT));
      v+=h.shares*(ep?.px??h.last);
    }
    return v;
  }

  function closeTrade(h, sellIso, px, reason, kind, meta={}) {
    const entry=h.entryPrice??h.last;
    const feeSell=feePerTrade;
    const feeBuy=h.feePaid??0;
    const gross=h.shares*px;
    const proceeds=gross-feeSell; // cash credited
    const costBasis=h.shares*entry;
    const pnl=gross-costBasis-feeBuy-feeSell; // net of round-trip fees
    const pnlPct=costBasis>0?100*(pnl/costBasis):null;
    const days=holdDays(h.bought, sellIso);
    const trade={
      ticker:h.s.ticker, buyDate:h.bought, sellDate:sellIso,
      entryPrice:entry, exitPrice:px, shares:h.shares,
      pnl, pnlPct, holdDays:days, holdWeeks:days/7,
      reason, kind, fee:feeSell, feeBuy, grossProceeds:gross,
    };
    closedTrades.push(trade);
    exits.push({time:sellIso,ticker:h.s.ticker,reason,price:px,kind,pnl,pnlPct,holdDays:days,holdWeeks:days/7,fee:feeSell});
    tradeLog.push({
      date:sellIso,
      signalDate:meta.signalDate??null,
      ticker:h.s.ticker,
      action:'SELL',
      reason:reason||kind||'',
      price:px,
      priceKind:meta.priceKind||'open',
      shares:h.shares,
      value:gross,
      fee:feeSell,
      budget:null,
      cashBefore:meta.cashBefore,
      cashAfter:meta.cashAfter,
      equityAtOpen:meta.equityAtOpen??null,
      pnl, holdDays:days, rank:h.lastSnap?.rank??null,
    });
    return {trade, proceeds, fee:feeSell};
  }

  function tryBuy(rankedRow, execT, targetBudget, meta={}) {
    entriesAttempted++;
    const bar=rankedRow.s.map.get(execT);
    const ep=execPx(bar);
    const feeBuy=feePerTrade;
    if(!ep || !(cash>feeBuy) || !(targetBudget>0)) {
      entriesReduced++;
      return false;
    }
    // Budget is for shares; fee is paid on top from cash (capped so total ≤ cash).
    const maxForShares=Math.min(targetBudget, cash-feeBuy);
    let reduced=false;
    if(maxForShares+1e-9 < targetBudget) { entriesReduced++; reduced=true; }
    if(!(maxForShares>0)) { if(!reduced) entriesReduced++; return false; }
    let shares=maxForShares/ep.px;
    if(!fractional) {
      shares=Math.floor(maxForShares/ep.px+1e-12);
      if(shares<=0) { if(!reduced) entriesReduced++; return false; }
    }
    const spend=shares*ep.px; // share notional
    const totalOut=spend+feeBuy;
    if(spend<=0 || totalOut>cash+1e-9) { if(!reduced) entriesReduced++; return false; }
    const cashBefore=cash;
    cash-=totalOut;
    execPriceKindUsed[ep.kind]=(execPriceKindUsed[ep.kind]||0)+1;
    holdings.push({
      s:rankedRow.s, shares, last:ep.px, entryPrice:ep.px,
      bought:iso(execT), execPriceKind:ep.kind,
      openSince:null, weaknessPhase:false, lastSnap:null,
      targetBudget, spent:spend, feePaid:feeBuy, peakClose:ep.px,
    });
    entries.push({time:iso(execT),ticker:rankedRow.ticker,price:ep.px,kind:ep.kind,shares,spent:spend,fee:feeBuy,targetBudget,rank:rankedRow.rank});
    tradeLog.push({
      date:iso(execT),
      signalDate:meta.signalDate??null,
      ticker:rankedRow.ticker,
      action:'BUY',
      reason:meta.reason||`entry rank ${rankedRow.rank}`,
      price:ep.px,
      priceKind:ep.kind,
      shares,
      value:spend,
      fee:feeBuy,
      budget:targetBudget,
      cashBefore,
      cashAfter:cash,
      equityAtOpen:meta.equityAtOpen??null,
      pnl:null, holdDays:null, rank:rankedRow.rank,
    });
    return true;
  }

  const trailLocked=(ticker, signalT)=>{
    if(!(trailPct>0) || !(trailLockWeeks>0) || !trailLockedAt.has(ticker)) return false;
    return weekKey(signalT)-trailLockedAt.get(ticker) < trailLockWeeks;
  };
  let trailingExits=0, trailLockSkips=0;

  for(const t of allDates.filter(t=>t>=cutoff && (windowEnd==null || t<=windowEnd))) {
    const wk=weekKey(t);
    if(wk!==lastWeekKey) {
      const execWeek=weekByKey.get(wk);
      const prevKeys=[...weekByKey.keys()].filter(k=>k<wk).sort((a,b)=>a-b);
      const signalWeek=prevKeys.length?weekByKey.get(prevKeys.at(-1)):null;
      const execT=execWeek?.first??t;
      const signalT=signalWeek?.last??null;
      const weekLog={time:iso(execT),signalAsOf:signalT?iso(signalT):null,exits:[],entries:[],positions:0,kapital:null,budget:null,reduced:0};
      const reducedBefore=entriesReduced;

      if(signalT!=null) {
        const ranked=universeRankAt(signalT);
        const topN=ranked.slice(0,nSlots);
        const signalDate=iso(signalT);

        if(!initialized) {
          const equityOpen=equityAtOpen(execT); // == startCapital
          const kapital=sizeMode==='START'?startCapital:equityOpen;
          const budget=kapital/nSlots;
          weekLog.kapital=kapital;
          weekLog.budget=budget;
          weekLog.equityAtOpen=equityOpen;
          let filled=0;
          for(const row of topN) {
            if(holdings.length>=nSlots) break;
            if(!row.s.map.get(execT)) continue;
            if(trailLocked(row.ticker, signalT)) { trailLockSkips++; continue; }
            if(tryBuy(row, execT, budget, {signalDate, equityAtOpen:equityOpen, reason:`initial rank ${row.rank}`})) {
              filled++;
              weekLog.entries.push(row.ticker);
            }
          }
          if(filled>0) { initialized=true; weekLog.kind='initial'; }
        } else {
          // Equity at open BEFORE exits (for audit); Kapital for sizing AFTER exits equals same total.
          const equityOpenPre=equityAtOpen(execT);

          // 1) Exits first at open.
          const keep=[];
          for(const h of holdings) {
            const sig=signalExit(h, signalT, ranked);
            h.lastSnap={
              rank:sig.rank, stockRsl:sig.stockRsl, benchRsl:sig.benchRsl,
              quadrant:sig.quadrant, season:sig.season, ratio:sig.ratio, momentum:sig.momentum,
              prevWeekQuadrant:sig.prevWeekQuadrant,
            };
            h.openSince=sig.openSince;
            h.weaknessPhase=sig.weaknessPhase;
            if(trailPct>0) {
              // Weekly close = last close on/before the Friday signal; peak includes entry price and this close.
              const wClose=sig.weekClose;
              if(Number.isFinite(wClose)) {
                h.peakClose=Math.max(h.peakClose??h.entryPrice??wClose, wClose);
                h.trailStop=h.peakClose*(1-trailPct/100);
                if(!sig.exit && wClose<=h.trailStop) {
                  sig.exit=true;
                  sig.trailing=true;
                  sig.reason=trailingStopReason(trailPct, h.peakClose, wClose);
                }
              }
            }
            if(sig.exit) {
              const bar=h.s.map.get(execT);
              const ep=execPx(bar)||{px:h.last, kind:'close'};
              execPriceKindUsed[ep.kind]=(execPriceKindUsed[ep.kind]||0)+1;
              const cashBefore=cash;
              const {proceeds}=closeTrade(h, iso(execT), ep.px, sig.reason, 'weekly-exit', {
                signalDate, priceKind:ep.kind, cashBefore,
                cashAfter:cashBefore+(h.shares*ep.px-feePerTrade), equityAtOpen:equityOpenPre,
              });
              cash+=proceeds;
              if(sig.trailing) {
                trailingExits++;
                closedTrades.at(-1).trailing=true;
                exits.at(-1).trailing=true;
                tradeLog.at(-1).trailing=true;
                trailLockedAt.set(h.s.ticker, weekKey(signalT));
              }
              weekLog.exits.push(h.s.ticker);
            } else keep.push(h);
          }
          holdings=keep;

          // 2) Kapital once before entries (post-exit open equity == pre-exit open equity).
          const equityOpen=equityAtOpen(execT);
          const kapital=sizeMode==='START'?startCapital:equityOpen;
          const budget=kapital/nSlots;
          weekLog.kapital=kapital;
          weekLog.budget=budget;
          weekLog.equityAtOpen=equityOpen;

          // 3) Fill up to nSlots from Top-n not held, rank order.
          const held=heldSet();
          for(const row of topN) {
            if(holdings.length>=nSlots) break;
            if(held.has(row.ticker)) continue;
            if(!row.s.map.get(execT)) continue;
            if(trailLocked(row.ticker, signalT)) { trailLockSkips++; continue; }
            if(tryBuy(row, execT, budget, {signalDate, equityAtOpen:equityOpen, reason:`entry rank ${row.rank}`})) {
              held.add(row.ticker);
              weekLog.entries.push(row.ticker);
            }
          }
          weekLog.kind='weekly';
        }
      }

      weekLog.positions=holdings.length;
      weekLog.cash=cash;
      weekLog.reduced=entriesReduced-reducedBefore;
      // Mark-to-open equity snapshot for the week log (cash + holdings at last/open).
      weekLog.equity=cash+holdings.reduce((v,h)=>v+h.shares*h.last,0);
      if(weekLog.kind) {
        rebalances.push(weekLog);
        weeklyLog.push({
          week:weekLog.time,
          signalDate:weekLog.signalAsOf,
          equity:weekLog.equity,
          cash:weekLog.cash,
          positions:weekLog.positions,
          exits:weekLog.exits.length,
          entries:weekLog.entries.length,
          reducedEntries:weekLog.reduced,
          kapital:weekLog.kapital,
          budget:weekLog.budget,
          kind:weekLog.kind,
        });
      }
      lastWeekKey=wk;
    }

    for(const h of holdings) if(h.s.map.has(t)) h.last=h.s.map.get(t).close;
    const value=cash+holdings.reduce((v,h)=>v+h.shares*h.last,0);
    if(value>0) { cashQuotaSum+=cash/value; cashQuotaN++; }
    peak=Math.max(peak,value); mdd=Math.min(mdd,value/peak-1);
    equity.push({time:iso(t),value,cash});
  }

  const elapsed=equity.length>1?(Date.parse(equity.at(-1).time)-Date.parse(equity[0].time))/(365.25*86400e3):0;
  const finalValue=equity.length?equity.at(-1).value:startCapital;
  const totalReturnPct=startCapital>0?100*((finalValue/startCapital)-1):null;
  const cagr=elapsed>0&&startCapital>0?100*((finalValue/startCapital)**(1/elapsed)-1):null;

  const wins=closedTrades.filter(tr=>tr.pnl>0);
  const losses=closedTrades.filter(tr=>tr.pnl<0);
  const flats=closedTrades.filter(tr=>tr.pnl===0);
  const holdVals=closedTrades.map(tr=>tr.holdDays).filter(d=>Number.isFinite(d));
  const avg=(arr)=>arr.length?arr.reduce((s,x)=>s+x,0)/arr.length:null;

  // Unrealized P&L of open holdings (at last close), gross of still-open buy fees
  // (buy fees already reduced cash; included in totalFees / bridge).
  const unrealized=holdings.reduce((s,h)=>s+h.shares*h.last-h.shares*(h.entryPrice??h.last),0);
  const realized=closedTrades.reduce((s,tr)=>s+tr.pnl,0); // already net of fees
  const totalFees=tradeLog.reduce((s,tr)=>s+(Number(tr.fee)||0),0);
  const openBuyFees=holdings.reduce((s,h)=>s+(h.feePaid||0),0);

  const stats={
    startCapital,
    finalEquity:finalValue,
    finalCash:cash,
    totalReturnPct,
    cagr,
    maxDD:100*mdd,
    actualYears:elapsed,
    tradesClosed:closedTrades.length,
    tradesOpen:holdings.length,
    openNote:'offen = Positionen, die am Periodenende noch gehalten werden (Mark-to-Market); nicht „unerledigt“.',
    winRate:closedTrades.length?100*(wins.length/closedTrades.length):null,
    wins:wins.length,
    losses:losses.length,
    flats:flats.length,
    avgWin:avg(wins.map(tr=>tr.pnl)),
    avgLoss:avg(losses.map(tr=>tr.pnl)),
    holdDaysMin:holdVals.length?Math.min(...holdVals):null,
    holdDaysMax:holdVals.length?Math.max(...holdVals):null,
    holdDaysAvg:avg(holdVals),
    holdWeeksMin:holdVals.length?Math.min(...holdVals)/7:null,
    holdWeeksMax:holdVals.length?Math.max(...holdVals)/7:null,
    holdWeeksAvg:avg(holdVals)?avg(holdVals)/7:null,
    holdUnit:'calendar days and weeks (buy date → sell date UTC)',
    rebalances:rebalances.length,
    weeklyExits:closedTrades.filter(tr=>tr.kind==='weekly-exit').length,
    execPriceKind:execPriceKindUsed,
    fractional,
    sizeMode,
    feePerTrade,
    totalFees,
    openBuyFees,
    confirmWeeks,
    rsExit,
    trail:trailPct,
    trailLock:trailLockWeeks,
    ranking,
    trailingExits,
    trailLockSkips,
    avgCashQuota:cashQuotaN?cashQuotaSum/cashQuotaN:null,
    entriesReducedDueToCash:entriesReduced,
    entriesAttempted,
    realizedPnl:realized,
    unrealizedPnl:unrealized,
    tradeLogRows:tradeLog.length,
    weeklyLogRows:weeklyLog.length,
    model:`Weekly Top-N shared cash: Friday-close signals, Monday-open (else close) exec; exits then entries; budget=min(Kapital/n, cash) with SIZE=${sizeMode} (EQUITY=open equity once before entries, START=startCapital); FRACTIONAL=${fractional?1:0}. Hold without exit; fill from Top-n not held. FEE=${feePerTrade}/trade (absolute).${ranking!=='RSL26'?` RANKING=${ranking} (Einstieg + Rank-Schutz; RS-Exit bleibt RSL26).`:''}${trailPct>0?` TRAIL=${trailPct}% vom höchsten Wochenschluss seit Kauf (Exit Montag-Open), Wiederkauf-Sperre ${trailLockWeeks} Wochen.`:''} No dividends. No historical M&A. Survivorship: current constituents.`,
  };

  let benchmarkEquity=null;
  if(bmBars?.length && equity.length) {
    const bmMap=new Map(bmBars.map(b=>[iso(b.time),b.close]));
    const firstIso=equity[0].time;
    let startPx=null;
    for(const b of bmBars) {
      if(iso(b.time)>=firstIso && b.close>0) { startPx=b.close; break; }
    }
    if(startPx) {
      const sh=startCapital/startPx;
      let last=startPx;
      benchmarkEquity=equity.map(pt=>{
        if(bmMap.has(pt.time)) last=bmMap.get(pt.time);
        return {time:pt.time, value:sh*last};
      });
      const bmFinal=benchmarkEquity.at(-1).value;
      stats.benchmarkTotalReturnPct=100*((bmFinal/startCapital)-1);
      stats.benchmarkCagr=elapsed>0?100*((bmFinal/startCapital)**(1/elapsed)-1):null;
    }
  }

  const finalHoldings=holdings.map(h=>({
    ticker:h.s.ticker,
    shares:h.shares,
    last:h.last,
    entryPrice:h.entryPrice??null,
    bought:h.bought,
    execPriceKind:h.execPriceKind||null,
    rank:h.lastSnap?.rank??null,
    rsl:h.lastSnap?.stockRsl??null,
    benchRsl:h.lastSnap?.benchRsl??null,
    quadrant:h.lastSnap?.quadrant??null,
    season:h.lastSnap?.season??null,
    ratio:h.lastSnap?.ratio??null,
    momentum:h.lastSnap?.momentum??null,
    weekChange:h.lastSnap?.prevWeekQuadrant && h.lastSnap?.quadrant
      ? `${h.lastSnap.prevWeekQuadrant} → ${h.lastSnap.quadrant}`
      : (h.lastSnap?.quadrant||null),
    prevQuadrant:h.lastSnap?.prevWeekQuadrant??null,
    weaknessPhase:!!h.weaknessPhase,
    openSince:h.openSince,
    rrgExitLabel:h.openSince?`RRG-Exit offen seit ${h.openSince}`:null,
    ...(trailPct>0?{trailPeak:h.peakClose??null, trailStop:h.peakClose!=null?h.peakClose*(1-trailPct/100):null}:{}),
  }));

  const result={
    years,n,mode,rankTop,confirmWeeks,rsExit,trail:trailPct,trailLock:trailLockWeeks,ranking,startCapital,fractional,sizeMode,fee:feePerTrade,
    actualYears:elapsed,
    cagr,
    maxDD:100*mdd,
    totalReturnPct,
    finalEquity:finalValue,
    finalCash:cash,
    equity,benchmarkEquity,rebalances,exits,entries,closedTrades,stats,holdings:finalHoldings,
    tradeLog, weeklyLog,
    warning:'Exploratory raw OHLC backtest. Static membership (survivorship bias), missing/failed symbols, stale marks, no delistings, dividends, taxes or corporate-action repair (FEE per trade applied). Friday-signal / Monday-exec weekly shared-cash model. Not investable evidence.',
  };
  result.audit=auditBacktestInvariants(result);
  stats.auditOk=result.audit.ok;
  stats.auditIssues=result.audit.issues.length;
  return result;
}

/** Invariant checks on a backtest result (sizing / cash / uniqueness / P&L). */
export function auditBacktestInvariants(bt, eps=1e-4) {
  const issues=[];
  const start=bt.startCapital??bt.stats?.startCapital??0;
  const n=bt.n||1;
  const trades=bt.tradeLog||[];
  const weeks=bt.weeklyLog||[];
  const equity=bt.equity||[];

  // Cash never negative in trade log / weekly log / equity points.
  for(const tr of trades) {
    if(tr.cashBefore!=null && tr.cashBefore<-eps) issues.push(`cashBefore<0 on ${tr.date} ${tr.ticker}`);
    if(tr.cashAfter!=null && tr.cashAfter<-eps) issues.push(`cashAfter<0 on ${tr.date} ${tr.ticker}`);
  }
  for(const w of weeks) {
    if(w.cash!=null && w.cash<-eps) issues.push(`weekly cash<0 on ${w.week}`);
  }
  for(const e of equity) {
    if(e.cash!=null && e.cash<-eps) issues.push(`equity cash<0 on ${e.time}`);
  }

  // BUY value ≤ budget and ≤ cashBefore; budget ≤ equityAtOpen/n + eps (SIZE=EQUITY).
  for(const tr of trades.filter(t=>t.action==='BUY')) {
    if(tr.cashBefore!=null && tr.value>tr.cashBefore+eps) issues.push(`BUY value>cashBefore ${tr.date} ${tr.ticker}`);
    if(tr.budget!=null && tr.value>tr.budget+eps) issues.push(`BUY value>budget ${tr.date} ${tr.ticker}`);
    if(bt.sizeMode!=='START' && tr.equityAtOpen!=null && tr.budget!=null) {
      const cap=tr.equityAtOpen/n;
      if(tr.budget>cap+eps*Math.max(1,cap)) issues.push(`budget>equity/n ${tr.date} ${tr.ticker}`);
    }
  }

  // Daily equity ≈ cash + positions (we only store cash+value; value already includes both).
  for(const e of equity) {
    if(e.cash!=null && e.value!=null && e.cash-eps>e.value) issues.push(`cash>equity on ${e.time}`);
  }

  // No overlapping double-hold: scan trade log chronologically.
  const held=new Set();
  for(const tr of trades) {
    if(tr.action==='BUY') {
      if(held.has(tr.ticker)) issues.push(`double-hold BUY ${tr.date} ${tr.ticker}`);
      held.add(tr.ticker);
    } else if(tr.action==='SELL') {
      if(!held.has(tr.ticker)) issues.push(`SELL without hold ${tr.date} ${tr.ticker}`);
      held.delete(tr.ticker);
    }
  }
  // Open holdings at end should match held set.
  const open=(bt.holdings||[]).map(h=>h.ticker);
  if(open.length!==held.size || open.some(t=>!held.has(t))) {
    // allow if tradeLog incomplete; only flag when tradeLog present
    if(trades.length) {
      const a=[...held].sort().join(',');
      const b=[...open].sort().join(',');
      if(a!==b) issues.push(`open holdings mismatch log=${a} holdings=${b}`);
    }
  }

  // P&L bridge: realized (net of fees) + unrealized - openBuyFees ≈ final - start.
  const realized=(bt.stats?.realizedPnl??bt.closedTrades?.reduce((s,t)=>s+t.pnl,0))??0;
  const unrealized=bt.stats?.unrealizedPnl??0;
  const openBuyFees=bt.stats?.openBuyFees??0;
  const final=bt.finalEquity??bt.stats?.finalEquity??0;
  const bridge=realized+unrealized-openBuyFees;
  const delta=final-start;
  if(Math.abs(bridge-delta)>Math.max(1, Math.abs(delta)*1e-6)+0.05) {
    issues.push(`P&L bridge mismatch realized+unrealized-openFees=${bridge} vs final-start=${delta}`);
  }

  // Signal before exec for every trade with both dates.
  for(const tr of trades) {
    if(tr.signalDate && tr.date && tr.signalDate>tr.date) issues.push(`signal after exec ${tr.ticker} ${tr.signalDate}>${tr.date}`);
  }

  return {ok:issues.length===0, issues, checks:{
    trades:trades.length, weeks:weeks.length, open:open.length,
    realized, unrealized, final, start, delta,
  }};
}

/** German Excel CSV: UTF-8 BOM, semicolon, decimal comma, ISO dates. */
export function toGermanCsv(rows, columns) {
  const bom='\uFEFF';
  const esc=(v)=>{
    if(v==null || v==='') return '';
    if(typeof v==='number' && Number.isFinite(v)) return String(v).replace('.', ',');
    const s=String(v);
    if(/[;"\r\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  };
  const head=columns.map(c=>esc(c.label)).join(';');
  const body=(rows||[]).map(r=>columns.map(c=>esc(typeof c.fmt==='function'?c.fmt(r[c.key],r):r[c.key])).join(';'));
  return bom+[head, ...body].join('\r\n');
}

export const TRADE_LOG_COLUMNS=[
  {key:'date',label:'Datum'},
  {key:'signalDate',label:'SignalDatum'},
  {key:'ticker',label:'Ticker'},
  {key:'action',label:'Aktion'},
  {key:'reason',label:'Grund'},
  {key:'price',label:'Preis'},
  {key:'priceKind',label:'PreisArt'},
  {key:'shares',label:'Stuecke'},
  {key:'value',label:'Wert'},
  {key:'fee',label:'Gebuehr'},
  {key:'budget',label:'Budget'},
  {key:'cashBefore',label:'CashVorher'},
  {key:'cashAfter',label:'CashNachher'},
  {key:'equityAtOpen',label:'EquityOpen'},
  {key:'pnl',label:'PnL'},
  {key:'holdDays',label:'Haltetage'},
  {key:'rank',label:'Rank'},
];

export const WEEKLY_LOG_COLUMNS=[
  {key:'week',label:'WocheExec'},
  {key:'signalDate',label:'SignalDatum'},
  {key:'equity',label:'Equity'},
  {key:'cash',label:'Cash'},
  {key:'positions',label:'Positionen'},
  {key:'exits',label:'Exits'},
  {key:'entries',label:'Entries'},
  {key:'reducedEntries',label:'EntriesReduziert'},
  {key:'kapital',label:'Kapital'},
  {key:'budget',label:'Budget'},
  {key:'kind',label:'Art'},
];

export function backtestTradesCsv(bt) {
  return toGermanCsv(bt.tradeLog||[], TRADE_LOG_COLUMNS);
}
export function backtestWeeklyCsv(bt) {
  return toGermanCsv(bt.weeklyLog||[], WEEKLY_LOG_COLUMNS);
}





/**
 * From a weekly RRG trail + live snap: openSince / exitHint from CURRENT criteria.
 * No buy-date gating. openSince = start of the still-active L→W/L→Lagging phase.
 * Never invents a phase if the trail never showed Leading→Weakening/Lagging.
 * opts: {mode, rankTop}
 */
export function evaluateTrailExit(trail, snap={}, opts={}) {
  const mode=opts.mode||'OFF';
  const rankTop=(opts.rankTop??25)|0;
  const rankSchutzOff=!(rankTop>0);
  const confirmWeeks=Math.max(1, Math.min(8, (opts.confirmWeeks|0)||1));
  const rsExit=opts.rsExit!==false && opts.rsExit!==0 && opts.rsExit!=='0';
  const rank=snap.rank, stockRsl=snap.stockRsl, benchRsl=snap.benchRsl;
  let openSince=null, weekChange=null, exitHint=null;
  if(trail && trail.length>=2) {
    const prev=trail.at(-2), curr=trail.at(-1);
    weekChange=`${prev.quadrant} → ${curr.quadrant}`;
    let lastQ=null, since=null;
    for(const p of trail) {
      if(lastQ==='Leading' && (p.quadrant==='Weakening'||p.quadrant==='Lagging')) since=p.time;
      if(p.quadrant==='Leading'||p.quadrant==='Improving') since=null;
      lastQ=p.quadrant;
    }
    openSince=since;
    if(mode!=='OFF' && prev.quadrant==='Leading' && (curr.quadrant==='Weakening'||curr.quadrant==='Lagging')) {
      const ev=evaluateRrgExit({lastQuadrant:'Leading',weaknessSince:null,confirmPending:null,confirmCount:0}, {
        quadrant:curr.quadrant, rank, stockRsl, benchRsl, asOf:curr.time,
      }, {mode, rankTop, confirmWeeks});
      if(ev.exit) exitHint=ev.reason;
    } else if(mode==='RANK' && openSince && (rankSchutzOff || (rank!=null && rank>rankTop))) {
      exitHint=rankSchutzOff?`RRG Weakness (Rank-Schutz aus)`:`RRG Weakness außerhalb Rank-Schutz Top ${rankTop}`;
    } else if(mode==='CONFIRM' && openSince) {
      const idx=trail.findIndex(p=>p.time===openSince);
      const weeksSince=idx>=0?trail.length-1-idx:-1;
      const stillWeak=idx>=0 && trail.slice(idx).every(p=>p.quadrant==='Weakening'||p.quadrant==='Lagging');
      if(stillWeak && weeksSince>=confirmWeeks) {
        if(!rankSchutzOff && rank!=null && rank<=rankTop) {
          exitHint=`RRG Leader-Schutz: Bestätigung nach ${confirmWeeks} Woche${confirmWeeks>1?'n':''}`;
        } else {
          exitHint=`RRG Leading→Weakness (Rank ${rank}>${rankTop||0})`;
        }
      } else if(stillWeak && (rankSchutzOff || (rank!=null && rank>rankTop))) {
        exitHint=rankSchutzOff?`RRG Weakness (Rank-Schutz aus)`:`RRG Weakness außerhalb Rank-Schutz Top ${rankTop}`;
      }
    }
  } else if(trail && trail.length===1) {
    weekChange=trail[0].quadrant;
  }
  const rs=rsExit?evaluateRsBelowBench(stockRsl, benchRsl):{exit:false,reason:null};
  if(!exitHint && rs.exit) exitHint=rs.reason;
  return {
    openSince,
    weaknessPhase:!!openSince,
    weekChange,
    exitHint:exitHint||null,
    rsBelowBench:rs.exit,
    rrgExitLabel:openSince?`RRG-Exit offen seit ${openSince}`:null,
  };
}


export function holdingsWatch(rows, stockBarsByTicker, benchmarkBars, opts={}) {
  const mode=opts.mode||'OFF', rankTop=opts.rankTop??25;
  const confirmWeeks=opts.confirmWeeks, rsExit=opts.rsExit;
  return rows.map(row=>{
    const bars=stockBarsByTicker.get(row.ticker)||stockBarsByTicker[row.ticker];
    const trail=bars&&benchmarkBars?rrgSeries(bars, benchmarkBars):[];
    const stockRsl=bars?levy(bars):row.rsl??null;
    const benchRsl=benchmarkBars?levy(benchmarkBars):null;
    const rrg=trail.length?trail.at(-1):null;
    const ev=evaluateTrailExit(trail, {rank:row.rank, stockRsl, benchRsl}, {mode, rankTop, confirmWeeks, rsExit});
    return {
      ...row,
      benchRsl,
      quadrant:rrg?.quadrant??null,
      season:rrg?.season??null,
      ratio:rrg?.ratio??null,
      momentum:rrg?.momentum??null,
      weekChange:ev.weekChange,
      weaknessPhase:ev.weaknessPhase,
      openSince:ev.openSince,
      rrgExitLabel:ev.rrgExitLabel,
      exitHint:ev.exitHint,
      rsBelowBench:ev.rsBelowBench,
    };
  });
}

/**
 * Live trailing-stop status for one held position (same rule as rotationBacktest TRAIL):
 * peak = max(buy price, weekly closes of all weeks ending on/after the buy date, incl. the current
 * (possibly partial) week); stop = peak*(1-trail/100); hit when the latest weekly close <= stop.
 * Returns null without bars or a valid buy date.
 */
export function trailingStopStatus(bars, buyDate, buyPrice, trailPct) {
  if(!bars?.length || !(trailPct>0)) return null;
  const buyT=Date.parse(String(buyDate||'')+'T00:00:00Z')/1000;
  if(!Number.isFinite(buyT)) return null;
  // Weeks whose last session is on/after the buy date (buy week included, earlier weeks excluded).
  const W=weekly(bars).filter(w=>w.time>=buyT);
  if(!W.length) return null;
  const bp=Number(buyPrice);
  let peak=Number.isFinite(bp)&&bp>0?bp:null, peakDate=peak!=null?String(buyDate):null;
  for(const w of W) if(peak==null || w.close>peak) { peak=w.close; peakDate=iso(w.time); }
  const close=W.at(-1).close;
  const stop=peak*(1-trailPct/100);
  const hit=close<=stop;
  const note=bars[0].time>buyT?'Kurshistorie beginnt nach dem Kaufdatum; Hoch evtl. unvollständig':null;
  return {peak, peakDate, stop, close, distPct:100*(close-stop)/close, hit, reason:hit?trailingStopReason(trailPct, peak, close):null, note, asOf:iso(W.at(-1).time)};
}

/**
 * Exit evaluation for the user's open RSL positions.
 * Independent of buyDate: same current-criteria rules as the ranking / backtest watch
 * (RRG weakness phase per mode, Rank-Schutz, RSL < Benchmark). buyDate stays on the
 * position for display/audit only and must not suppress an exit.
 * openSince = start of the still-active exit/weakness condition (not tied to buy date).
 *
 * positions: [{symbol, universe, buyDate, ...}]
 * stockBarsByTicker: Map or object
 * benchmarkBarsByUniverse: Map universe -> bars (or single benchmarkBars + opts.universe)
 * rankByTicker: Map symbol -> rank (from current universe scan)
 * opts: {mode, rankTop, universe, dateMode:'UTC', trail}  trail>0 adds trailPeak/trailStop/trailDistPct and a Trailing-Stop exit hint.
 */
export function evaluatePositionBook(positions, stockBarsByTicker, benchmarkBars, rankByTicker, opts={}) {
  const mode=opts.mode||'OFF', rankTop=opts.rankTop??25;
  const trailPct=Number.isFinite(Number(opts.trail))?Math.max(0, Math.min(95, Number(opts.trail))):0;
  const confirmWeeks=opts.confirmWeeks, rsExit=opts.rsExit;
  const getBars=t=>{
    if(!stockBarsByTicker) return null;
    if(typeof stockBarsByTicker.get==='function') return stockBarsByTicker.get(t)||null;
    return stockBarsByTicker[t]||null;
  };
  const getBench=u=>{
    if(benchmarkBars && typeof benchmarkBars.get==='function') return benchmarkBars.get(u)||null;
    return benchmarkBars||null;
  };
  const getRank=t=>{
    if(!rankByTicker) return null;
    if(typeof rankByTicker.get==='function') return rankByTicker.get(t)??null;
    return rankByTicker[t]??null;
  };

  return (positions||[]).map(pos=>{
    const symbol=pos.symbol||pos.ticker;
    const bars=getBars(symbol);
    const bm=getBench(pos.universe||opts.universe);
    const rank=getRank(symbol)??pos.rank??null;
    const trail=bars&&bm?rrgSeries(bars, bm):[];
    const stockRslNow=bars?levy(bars):null;
    const benchRslNow=bm?levy(bm):null;
    const rrgNow=trail.length?trail.at(-1):null;
    const ev=evaluateTrailExit(trail, {rank, stockRsl:stockRslNow, benchRsl:benchRslNow}, {mode, rankTop, confirmWeeks, rsExit});
    const ts=trailPct>0?trailingStopStatus(bars, pos.buyDate, pos.buyPrice, trailPct):null;
    if(ts?.hit && !ev.exitHint) ev.exitHint=ts.reason;
    const exitSignal=!!ev.exitHint;
    return {
      ...pos,
      ticker:symbol,
      rank,
      rsl:stockRslNow,
      benchRsl:benchRslNow,
      quadrant:rrgNow?.quadrant??null,
      season:rrgNow?.season??null,
      ratio:rrgNow?.ratio??null,
      momentum:rrgNow?.momentum??null,
      weekChange:ev.weekChange,
      weaknessPhase:ev.weaknessPhase,
      openSince:ev.openSince,
      rrgExitLabel:ev.rrgExitLabel,
      exitHint:ev.exitHint,
      exitSignal,
      exitSince:exitSignal?(ev.openSince||rrgNow?.time||null):null,
      exitReason:ev.exitHint||null,
      rsBelowBench:ev.rsBelowBench,
      lastClose:bars?.length?bars.at(-1).close:null, lastDate:bars?.length?iso(bars.at(-1).time):null, // P&L (unrealisiert)
      ...(ts?{
        trailPct, trailPeak:ts.peak, trailPeakDate:ts.peakDate, trailStop:ts.stop, trailClose:ts.close,
        trailDistPct:ts.distPct, trailHit:ts.hit, trailHint:ts.hit?ts.reason:null, trailNote:ts.note||null,
      }:{}),
      dateMode:'UTC',
    };
  });
}
