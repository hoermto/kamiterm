import {universe} from './grokki-universes.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { refreshDaily, uncache } from '../providers.js';
import { weekCloseAsOf, settleMarksBetween, basisText } from './rsl-weekclose.js';
import {history,batch,intParam,numParam,SOURCE} from './grokki-data.js';
import { register as liveRegister } from '../ohlc-live.js';
import {
  levy,rotationBacktest,rrgExitDefaults,parseRrgExitMode,BENCHMARKS,holdingsWatch,RRG_EXIT_MODES,
  evaluatePositionBook,parseRanking,rankingScore,RANKINGS,RANKING_LABELS,trailLocks,
} from './grokki-math.js';
import {
  loadBook,buyPosition,sellPosition,applyAction,openPositions,closedPositions,normalizeUniverse, universeInfo, universeCounts, HOLDING_UNIVERSES} from '../rsl-watchlist.js';
import { resolveMaFlags, applyMaFlags } from '../ma-flags.js';
import { adjustEuSeries, isEuUniverse } from './grokki-eu.js';
import {
  startWalkForwardJob, readJob, loadJobResult, listJobs, wfParamSig,
} from '../rsl-eval-jobs.js';


// Stichtag für Status-Alarme (lib/status-alerts.js, AT-21): withUntil('YYYY-MM-DD', () => rsl26(q)) rechnet mit
// Tageskursen nur bis einschließlich dieses Datums (Freitagsschluss). Die App-Anzeige ruft rsl26 ohne Stichtag auf
// (laufende Woche eingeschlossen) und bleibt unverändert. Gecachte Kursobjekte werden nicht verändert.
const untilCtx = new AsyncLocalStorage();
export const withUntil = (until, fn) => untilCtx.run(until || null, fn);
const isoDay = (t) => new Date(t * 1000).toISOString().slice(0, 10);
export function cutHistory(h, until) {
  if (!until || !h?.bars) return h;
  const bars = h.bars.filter((b) => isoDay(b.time) <= until);
  if (!bars.length) throw new Error(`Keine Kurse bis ${until}`);
  return { ...h, bars, asOf: isoDay(bars.at(-1).time) };
}
function hist(ticker, years) {
  const until = untilCtx.getStore();
  return until ? history(ticker, years).then((h) => cutHistory(h, until)) : history(ticker, years);
}

/** Holdings/closed rows tagged with their universe (buy universe, else derived); counts per universe. */
function tagUniverses(positions, sold, allClosed) {
  const tag = (p) => ({ ...p, ...universeInfo(p) });
  const pos = (positions || []).map(tag);
  return {
    positions: pos,
    sold: (sold || []).map(tag),
    universeCounts: { open: universeCounts(pos), closed: universeCounts(allClosed || sold || []), list: HOLDING_UNIVERSES },
  };
}

function parseRankMap(raw) {
  const m=new Map();
  if(!raw) return m;
  for(const part of String(raw).split(',')) {
    const [t,r]=part.split(':');
    if(!t) continue;
    const n=Number(r);
    if(Number.isFinite(n)) m.set(String(t).trim().toUpperCase(), n);
  }
  return m;
}

/**
 * Rückkauf-Sperre nach Trailing-Exit für die Kauf-Kandidaten (UI und RSL-Alarme): verkaufte Positionen der letzten
 * TRAILLOCK Wochen, deren Trailing-Stop bis zum Verkauf ausgelöst war (grokki-math trailLocks). Kurse aus dem Cache.
 */
async function computeTrailLocks(sold, trail, trailLock) {
  if(!(trail>0) || !(trailLock>0)) return [];
  const today=new Date().toISOString().slice(0,10);
  const from=new Date(Date.now()-trailLock*7*86400e3).toISOString().slice(0,10);
  const uniOf=(p)=>{ try { return normalizeUniverse(p.universe||'SPX'); } catch { return 'SPX'; } };
  const recent=(sold||[]).filter(p=>p.symbol && String(p.closedDate||'')>=from);
  if(!recent.length) return [];
  const bars=new Map();
  for(const uni of [...new Set(recent.map(p=>uniOf(p)))]) {
    const list=recent.filter(p=>uniOf(p)===uni);
    const years=trailYears(list);
    try {
      const data=await batch([...new Set(list.map(p=>p.symbol))], t=>hist(t, years));
      const res=isEuUniverse(uni)?(await adjustEuSeries(uni, data.results, years)).results:data.results;
      for(const s of res) bars.set(`${uni}:${s.ticker}`, s.bars);
    } catch { /* ohne Kurse keine Sperre: lieber anzeigen als falsch sperren */ }
  }
  return trailLocks(recent.map(p=>({...p, universe:uniOf(p)})),
    (sym)=>{ for(const [k,v] of bars) if(k.endsWith(`:${sym}`)) return v; return null; }, {trail, trailLock, today});
}

/** History years needed so the trailing peak covers the oldest open buy date (min 2, max 15). */
function trailYears(open) {
  let oldest=null;
  for(const p of open||[]) {
    const t=Date.parse(String(p.buyDate||'')+'T00:00:00Z');
    if(Number.isFinite(t) && (oldest==null || t<oldest)) oldest=t;
  }
  if(oldest==null) return 2;
  const yrs=Math.ceil((Date.now()-oldest)/(365.25*86400e3));
  return Math.max(2, Math.min(15, yrs+1));
}

function parseAction(q={}) {
  const raw=String(q.action||q.op||'').trim().toUpperCase();
  if(!raw) return null;
  if(['BUY','KAUF','K'].includes(raw)) return 'BUY';
  if(['SELL','VERKAUF','V'].includes(raw)) return 'SELL';
  if(['ADD'].includes(raw)) return 'BUY';
  if(['EDIT','BEARBEITEN'].includes(raw)) return 'EDIT';
  if(['DELETE','LOESCHEN','LÖSCHEN'].includes(raw)) return 'DELETE';
  if(['REOPEN','WIEDER'].includes(raw)) return 'REOPEN';
  if(['WATCH','WATCHLIST','POSITIONEN','BOOK','HOLDINGS'].includes(raw)) return 'WATCH';
  throw Object.assign(new Error('action muss BUY|SELL|EDIT|DELETE|REOPEN|HOLDINGS sein (oder KAUF|VERKAUF|LOESCHEN)'),{status:400});
}

function parseParamMode(raw) {
  const s = String(raw ?? 'FEST').trim().toUpperCase();
  if (!s || ['FEST', 'FIXED', 'FIX', 'STATIC', 'EINMAL'].includes(s)) return 'FEST';
  if (['WALKFORWARD', 'WF', 'YEARLY', 'JAEHRLICH', 'JÄHRLICH', 'JAERLICH', 'RETUNE', 'TUNEYEARLY', 'TUNE'].includes(s)) return 'WALKFORWARD';
  return 'FEST';
}

function parseWfPeriod(raw) {
  const s = String(raw ?? 'yearly').trim().toLowerCase();
  if (['semiannual', 'half', 'halbjaehrlich', 'halbjährlich', 'h1'].includes(s)) return 'semiannual';
  if (['quarterly', 'quarter', 'vierteljaehrlich', 'vierteljährlich', 'q'].includes(s)) return 'quarterly';
  return 'yearly';
}


/** Evaluate open positions per universe (own RRGEXIT defaults; override for scan universe). */
async function evaluateOpenBook(open, {overrideUniverse, mode, rankTop, rankMap, years=2, trail=0, ranking='RSL26', confirmWeeks=1, rsExit=true, friAsOf=null}) {
  if(!open.length) return {positions:[], errors:[]};
  const byUni=new Map();
  for(const p of open) {
    const u=p.universe||'SPX';
    if(!byUni.has(u)) byUni.set(u,[]);
    byUni.get(u).push(p);
  }
  const barMap=new Map();
  const errors=[];
  const evaluated=[];

  for(const [uni, posList] of byUni) {
    const defaults=rrgExitDefaults(uni);
    const uniMode=(overrideUniverse && uni===overrideUniverse && mode!=null) ? mode : defaults.mode;
    const uniRankTop=(overrideUniverse && uni===overrideUniverse && rankTop!=null) ? rankTop : defaults.rankTop;
    const benchTicker=BENCHMARKS[uni]||'^GSPC';
    let bmBars=null;
    try { bmBars=(await hist(benchTicker, years)).bars; }
    catch(e) { errors.push({ticker:benchTicker,error:e.message,universe:uni}); }

    const tickers=[...new Set(posList.map(p=>p.symbol))];
    const need=tickers.filter(t=>!barMap.has(t));
    if(need.length) {
      const data=await batch(need,t=>hist(t,years));
      const adj=isEuUniverse(uni)?(await adjustEuSeries(uni, data.results, years)).results:data.results; // EU: repariert + EUR
      for(const s of adj) barMap.set(s.ticker,s.bars);
      for(const e of data.errors) errors.push({...e,universe:uni});
    }

    const ranks=uni===overrideUniverse && rankMap ? rankMap : new Map(
      posList.map(p=>{
        const bars=barMap.get(p.symbol);
        return [p.symbol, null];
      }),
    );
    // If no scan ranks, rank open names among themselves by the active ranking for display only.
    if(uni!==overrideUniverse || !rankMap) {
      const scored=posList.map(p=>{
        const bars=barMap.get(p.symbol);
        return {ticker:p.symbol,rsl:bars?rankingScore(bars, uni===overrideUniverse?ranking:'RSL26'):null};
      }).filter(s=>s.rsl!=null).sort((a,b)=>b.rsl-a.rsl).map((s,i)=>[s.ticker,i+1]);
      for(const [t,r] of scored) ranks.set(t,r);
    }

    const rows=evaluatePositionBook(posList, barMap, bmBars, ranks, {
      mode:uniMode, rankTop:uniRankTop, universe:uni, trail, rsExit,
      confirmWeeks:uni===overrideUniverse?confirmWeeks:1,
    });
    for(const r of rows) {
      r.rrgExit=uniMode;
      r.rankTopUsed=uniRankTop;
      if(friAsOf) r.friRsl=rslAt(barMap.get(r.symbol), friAsOf);
      evaluated.push(r);
    }
  }
  return {positions:evaluated, errors};
}

/** MASKIP / maSkip: fehlt → 1 (Standard). */
function maSkipParam(q){
  const v=q.maSkip??q.maskip;
  if(v==null||v==='') return 1;
  return (v==='0'||v===0||v===false||String(v).toLowerCase()==='false')?0:1;
}

// Signal-Basis (AT-21): basis=FRI (Standard der App: „Fr-Schluss (regelkonform)“) rechnet mit Kursen bis zum Stichtag
// der letzten abgeschlossenen Woche (lib/fn/rsl-weekclose.js, gleiche Funktion wie die RSL-Status-Alarme);
// basis=LIVE (oder ohne basis, z. B. API/Backtest) = laufende Woche eingeschlossen wie bisher. Backtests immer LIVE.
export const isFriBasis = (v) => ['FRI', 'FR', 'FRIDAY', 'FREITAG', 'REGEL', 'RULE'].includes(String(v || '').trim().toUpperCase());
const bt = (q) => q.backtest === '1' || q.backtest === 1 || q.backtest === true || String(q.backtest || '').toLowerCase() === 'true';

/**
 * Stichtag für ein Universum bestimmen und Kurse, die vor Schluss + 30 min geholt wurden (z. B. Freitag intraday),
 * einmal nachladen. deps für Tests. -> weekCloseAsOf(...) + { refreshed }
 */
export async function fridayBasis(uKey, tickers = [], { now = new Date(), hist: h = history, refresh = refreshDaily, drop = uncache } = {}) {
  const bench = BENCHMARKS[uKey] || '^GSPC';
  const marks = settleMarksBetween(now.getTime() - 8 * 86400e3, now.getTime()).filter((m) => m.universe === String(uKey).toUpperCase());
  const lastSettle = marks.length ? Math.max(...marks.map((m) => m.at)) : null;
  let refreshed = 0;
  const pull = async (t) => {
    if (!lastSettle) return;
    try {
      const r = await refresh(t, { maxAgeMs: Math.max(0, now.getTime() - lastSettle) });
      if (r?.changed) { refreshed++; drop((c) => c.startsWith(`grokki:${t}:`)); } // candles:-Einträge räumt refreshDaily selbst
    } catch { /* Yahoo nicht erreichbar: mit vorhandenen Kursen */ }
  };
  await pull(bench);
  const bm = await h(bench, 1);
  const wk = weekCloseAsOf(bm.bars.map((b) => new Date(b.time * 1000).toISOString().slice(0, 10)), now, uKey);
  if (!wk) throw new Error(`${uKey}: kein Wochenschluss im Benchmark ${bench}`);
  if (lastSettle && Date.parse(wk.settleAt) === lastSettle) { // gerade abgeschlossene Woche: alle Kurse nach Schluss + 30 min
    const list = [...new Set(tickers.filter(Boolean))];
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { while (next < list.length) await pull(list[next++]); }));
  }
  return { ...wk, refreshed };
}

/** Schlusskurs am Stichtag (letzter Tageskurs bis einschließlich until). */
const rslAt = (bars, until) => (bars?.length ? levy(friBars(bars, until)) : null);
const friBars = (bars, until) => (bars || []).filter((b) => isoDay(b.time) <= until);
function closeAt(bars, until) {
  for (let i = (bars || []).length - 1; i >= 0; i--) if (isoDay(bars[i].time) <= until) return bars[i].close;
  return null;
}

// Holdings: RSL26 aktuell, am letzten Freitagsschluss und die Änderung dazwischen (Δ Woche), Rang aktuell.
function withRslWeek(p, now, fri, rankNow) {
  return { ...p, rslNow: now, rslFri: fri, rslDelta: now != null && fri != null ? now - fri : null, rankNow };
}

// rankLive=1 (RSL26-App): die Rangliste rechnet immer mit aktuellen Kursen (Rang, Kauf-Kandidaten) und zeigt den letzten
// Freitagsschluss nur zur Orientierung (friClose). Die Signal-Basis (Aktuell / Fr-Schluss) gilt allein für die
// Verkaufssignale der Holdings; Kurs und P&L der Holdings sind immer aktuell. Ohne rankLive (API, RSL-Alarme) wie bisher:
// mit basis=FRI rechnet alles, auch die Rangliste, auf den Stichtag.
export default async function(q={}) {
  const rankLive = q.rankLive === '1' || q.ranklive === '1' || q.rankLive === 1;
  if (bt(q) || untilCtx.getStore() || (!isFriBasis(q.basis) && !rankLive)) {
    const r = await run(q);
    return isFriBasis(q.basis) || !r || typeof r !== 'object' ? r : { ...r, basis: 'LIVE' };
  }
  const u = universe(q);
  const book = loadBook();
  const wk = await fridayBasis(u.key, [...(u.tickers || []), ...openPositions(book).map((p) => p.symbol)]);
  if (!isFriBasis(q.basis)) { // Aktuell: alles mit laufenden Kursen, Freitagsschluss nur als Referenz in der Rangliste
    const r = await run({ ...q, friAsOf: wk.asOf });
    const fr = new Map((r.rowsAll || r.rows || []).map((x) => [x.ticker, x]));
    if (r.positions) r.positions = r.positions.map((p) => withRslWeek(p, p.rsl, p.friRsl ?? fr.get(p.symbol)?.friRsl ?? null, p.rank));
    return { ...r, basis: 'LIVE', weekClose: { ...wk, text: basisText(wk) } };
  }
  // Fr-Schluss: Signale der Holdings auf den Stichtag (mit Kauf/Verkauf, falls angefragt), parallel die Rangliste und
  // die aktuellen Kurse ohne Buchaktion.
  const { action, op, ...rest } = q;
  const fri = () => withUntil(wk.asOf, () => run(q));
  const live = () => (rankLive ? run({ ...rest, friAsOf: wk.asOf }) : null);
  // mit Buchaktion nacheinander (die aktuelle Rechnung soll das geänderte Buch sehen), sonst parallel
  const [r, now] = action || op ? [await fri(), await live()] : await Promise.all([fri(), live()]);
  // nach dem Stichtag gekauft: Signal erst ab dem nächsten Freitagsschluss (wie die Alarme)
  for (const p of r.positions || []) {
    if (p.buyDate && String(p.buyDate).slice(0, 10) > wk.asOf) {
      Object.assign(p, { exitSignal: false, signalPending: true, exitShort: null, exitHint: `Kein Exit: gekauft nach dem letzten Freitagsschluss (${wk.asOf.split('-').reverse().join('.')}). Exit-Signale gelten nur auf Wochenschluss; diese Position wird erst am nächsten Freitagsschluss geprüft.` });
    }
  }
  const out = { ...r, basis: 'FRI', weekClose: { ...wk, text: basisText(wk) } };
  if (!now) return out;
  // Kurs und P&L der Holdings aktuell; die Signale (Rang, Trailing, RRG) bleiben auf dem Stichtag
  const cur = new Map((now.positions || []).map((p) => [p.id, p]));
  out.positions = (r.positions || []).map((p) => {
    const c = cur.get(p.id);
    return c ? withRslWeek({ ...p, friClose: p.lastClose ?? null, friDate: p.lastDate ?? null, lastClose: c.lastClose ?? p.lastClose, lastDate: c.lastDate ?? p.lastDate }, c.rsl ?? null, p.rsl ?? null, c.rank ?? null) : p;
  });
  if (!r.bookOnly) Object.assign(out, { rows: now.rows, rowsAll: now.rowsAll, holdings: now.holdings, watch: now.watch, coverage: { ...now.coverage, positionsOpen: r.coverage?.positionsOpen }, ma: now.ma, live: now.live, rankBasis: 'LIVE' });
  return out;
}

async function run(q={}) {
  const t0=Date.now();
  const action=parseAction(q);
  let bookResult=null;

  if(action==='BUY') {
    bookResult=buyPosition({
      symbol:q.symbol||q.ticker,
      universe:normalizeUniverse(q.universe||'SPX'),
      buyDate:q.buyDate||q.date,
      buyPrice:q.buyPrice,
      qty:q.qty,
      note:q.note,
    });
  } else if(action==='SELL') {
    bookResult=sellPosition({
      symbol:q.symbol||q.ticker,
      universe:q.universe||undefined,
      sellDate:q.sellDate||q.closedDate||q.date,
      sellPrice:q.sellPrice,
      sellQty:q.sellQty??q.sellqty??q.qty, // Teilverkauf (Bruchstücke erlaubt)
    });
  }

  else if(['EDIT','DELETE','REOPEN'].includes(action)) {
    const body={id:q.id||undefined,symbol:q.symbol||q.ticker,universe:q.posUniverse||undefined}; // lookup across universes unless POSUNIVERSE= given
    if(action==='EDIT') {
      for(const k of ['buyDate','buyPrice','qty','note','sellDate','sellPrice','newUniverse']) if(q[k]!=null&&q[k]!=='') body[k]=q[k];
      if(q.price!=null&&q.price!=='') body.buyPrice=q.price;
    }
    bookResult=applyAction(action, body);
  }

  const watchOnly=action==='WATCH' || q.watch==='1';
  const u=universe(q);
  const years=intParam(q.years, watchOnly?2:5, 1, 15);
  const n=intParam(q.n, 25, 1, 500);
  const defaults=rrgExitDefaults(u.key);
  const mode=parseRrgExitMode(q.rrgExit??q.rrgexit, defaults.mode);
  const rankTop=intParam(q.rankTop??q.ranktop, defaults.rankTop, 1, 500);
  const startCapital=numParam(q.start??q.startCapital??q.capital, 10000, 100, 1e9);
  const fractionalRaw=q.fractional??q.frac??'1';
  const fractional=!(fractionalRaw==='0'||fractionalRaw===0||String(fractionalRaw).toLowerCase()==='false');
  const sizeMode=String(q.size??q.sizeMode??'EQUITY').toUpperCase()==='START'?'START':'EQUITY';
  const fee=numParam(q.fee??q.gebühr??q.gebuehr, 1, 0, 1e6);
  const confirmWeeks=intParam(q.confirmWeeks??q.confirmweeks??q.confirmweks??q.cw, 1, 1, 8);
  const rsExitRaw=q.rsexit??q.rsExit??q.rslExit??'1';
  const rsExit=!(rsExitRaw==='0'||rsExitRaw===0||String(rsExitRaw).toLowerCase()==='false');
  // Trailing stop: TRAIL in % (0 = aus), TRAILLOCK = Wiederkauf-Sperre in Wochen (Default 4).
  const trail=numParam(q.trail??q.TRAIL??q.trailing, 0, 0, 90);
  const trailLock=intParam(q.trailLock??q.traillock??q.TRAILLOCK, 4, 0, 52);
  // Entry ranking: RSL26 (Default, Levy) | RSL39 | MOM52_4 (12-1-Momentum). Rank-Schutz nutzt denselben Rang; RS-Exit bleibt RSL26.
  const ranking=parseRanking(q.ranking??q.RANKING??q.rangliste, 'RSL26');
  const rankingLabel=RANKING_LABELS[ranking];
  // Walk-Forward: TRAIL/RANKING mittunen (0/20 bzw. RSL26/RSL39/MOM52_4) statt fest.
  const flagOn=v=>v==='1'||v===1||v===true||String(v||'').toLowerCase()==='true';
  const wfTuneTrail=flagOn(q.wfTuneTrail??q.wftunetrail??q.tuneTrail);
  const wfTuneRanking=flagOn(q.wfTuneRanking??q.wftuneranking??q.tuneRanking);
  const paramMode=parseParamMode(q.paramMode??q.parammode??q.tune??q.PARAMMODE);
  const wfWindow=String(q.wfWindow??q.wfwindow??q.lookback??'expanding').toLowerCase()==='rolling'?'rolling':'expanding';
  const wfRollYears=intParam(q.wfRollYears??q.wfrollyears??q.rollYears, 2, 1, 10);
  const wfPeriod=parseWfPeriod(q.wfPeriod??q.wfperiod??q.retune??'yearly');
  const wfGrid=String(q.wfGrid??q.grid??q.wfgrid??'coarse').toLowerCase();
  const wfTransition=String(q.wfTransition??q.wftransition??q.transition??'carry').toLowerCase()==='reset'?'reset':'carry';
  const jobId=q.jobId||q.jobid||null;
  const startJob=q.startJob==='1'||q.startjob==='1'||q.startJob===true || q.startJob===1;

  const bookOnly=q.bookOnly==='1'||q.bookonly==='1'||q.skipScan==='1';
  const wantBt=q.backtest==='1'||q.backtest===1||q.backtest===true||String(q.backtest||'').toLowerCase()==='true';
  const run=wantBt && !watchOnly && !bookOnly;
  const benchTicker=BENCHMARKS[u.key]||'^GSPC';

  if(bookOnly) {
    const book=loadBook();
    const open=openPositions(book);
    const sold=closedPositions(book, 500); // all closed (book is small); UI filters by universe and shows 15
    const rankMap=parseRankMap(q.ranks||q.rankMap);
    const bookEval=await evaluateOpenBook(open, {
      overrideUniverse:u.key, mode, rankTop, rankMap, years:Math.max(trail>0?trailYears(open):2, ranking==='MOM52_4'?3:2), trail, ranking, confirmWeeks, rsExit, friAsOf:q.friAsOf||null,
    });
    const maSkip = maSkipParam(q);
    let maInfo={flags:new Map(),errors:[],checked:[],skipped:[],manualCount:0};
    const maSymbols=[...new Set(open.map(p=>p.symbol))];
    if(maSymbols.length) {
      try { maInfo = await resolveMaFlags(maSymbols, {universe:u.key, force:false}); }
      catch(e) { maInfo.errors=[{error:e.message||String(e)}]; }
    }
    const positions=applyMaFlags(bookEval.positions, maInfo.flags, {key:'symbol'});
    return {
      universe:u.key, universeLabel:u.label, warning:u.warning,
      years, n, rrgExit:mode, rankTop, confirmWeeks, rsExit, trail, trailLock, ranking, rankingLabel, rankings:RANKINGS, startCapital, fractional, sizeMode, fee,
      paramMode, wfWindow, wfRollYears, wfPeriod, wfGrid, wfTransition,
      bookOnly:true,
      rows:[], rowsAll:[], holdings:[], watch:[],
      ...tagUniverses(positions, sold), maSkip,
      trailLocks:await computeTrailLocks(sold, trail, trailLock),
      ma:{
        checked:maInfo.checked, skipped:maInfo.skipped, manualCount:maInfo.manualCount,
        flagged:[...maInfo.flags.keys()], errors:maInfo.errors,
        note:'bookOnly: M&A nur für offene Holdings, ohne Universum-Scan.',
      },
      book:{updatedAt:book.updatedAt, open:open.length, closed:book.positions.length-open.length},
      bookAction:bookResult?{ok:bookResult.ok,message:bookResult.message,duplicated:!!bookResult.duplicated,position:bookResult.position}:null,
      coverage:{requested:0,loaded:0,ranked:0,partial:false,positionsOpen:open.length,bookOnly:true},
      errors:bookEval.errors||[],
      backtest:null,
      source:SOURCE,
    };
  }

  let benchmark=null, benchError=null;
  try { benchmark=await hist(benchTicker, run?years:2); }
  catch(e) { benchError={ticker:benchTicker,error:e.message}; }

  // Scan history: 1 year suffices for RSL26/RSL39; MOM52_4 needs 53 weekly closes → 2 years.
  const scanYears=ranking==='RSL26'?1:2;
  const data=await batch(u.tickers,t=>hist(t,run?Math.max(years,scanYears):scanYears), u.eur?300000:180000, u.eur?8:6);
  // HDAX / STOXX 600: Datenreparatur (x100/Spikes) und EUR-Umrechnung wie in der Research-Engine.
  let euInfo=null;
  if(u.eur) {
    const adj=await adjustEuSeries(u.key, data.results, run?Math.max(years,scanYears):scanYears);
    data.results=adj.results; data.loaded=adj.results.length;
    for(const e of adj.fxErrors) data.errors.push(e);
    euInfo={repairs:adj.repairs, fxErrors:adj.fxErrors.length, currency:'EUR'};
  }
  const ohlcvCache={fromCache:data.results.filter(s=>s.fromCache).length, loaded:data.results.length, path:'data/cache/ohlcv.sqlite', via:'getCandles(1D)'};
  // rsl = Levy RSL26 (always shown, used by RS-Exit); score = active ranking metric (RSL26/RSL39 ratio, MOM52_4 fraction); rank by score.
  const rows=data.results.map(s=>{
    const rsl=levy(s.bars);
    // friAsOf (RSL26-App): Stand am letzten Freitagsschluss zum Vergleich (Δ Woche): Kurs, RSL26, Score, Rang
    const fri=q.friAsOf?friBars(s.bars, q.friAsOf):null;
    const friRsl=fri?levy(fri):null;
    return {ticker:s.ticker,price:s.bars.at(-1).close,cur:s.cur||null,priceLocal:s.priceLocal??null,rsl,score:ranking==='RSL26'?rsl:rankingScore(s.bars, ranking),asOf:s.asOf,
      ...(q.friAsOf?{friClose:closeAt(s.bars, q.friAsOf), friRsl, friScore:fri?(ranking==='RSL26'?friRsl:rankingScore(fri, ranking)):null, rslDelta:rsl!=null&&friRsl!=null?rsl-friRsl:null}:{})};
  }).filter(s=>s.score!=null).sort((a,b)=>b.score-a.score).map((s,i)=>({...s,rank:i+1,ranking}));
  if(q.friAsOf) {
    const fr=new Map(rows.filter(r=>r.friScore!=null).sort((a,b)=>b.friScore-a.friScore).map((r,i)=>[r.ticker,i+1]));
    for(const r of rows) r.friRank=fr.get(r.ticker)??null;
  }
  for(const s of data.results) {
    if(levy(s.bars)==null) data.errors.push({ticker:s.ticker,error:'Fewer than 26 weekly closes; no RSL rank'});
    else if(ranking!=='RSL26' && rankingScore(s.bars, ranking)==null) data.errors.push({ticker:s.ticker,error:`Zu wenig Wochenschlüsse für ${ranking}; kein Rang`});
  }
  if(benchError) data.errors.push(benchError);

  const barMap=new Map(data.results.map(s=>[s.ticker,s.bars]));
  const rankMap=new Map(rows.map(r=>[r.ticker,r.rank]));
  const top=rows.slice(0,n);
  const watch=benchmark
    ? holdingsWatch(top, barMap, benchmark.bars, {mode, rankTop})
    : top.map(r=>({...r,quadrant:null,openSince:null,weaknessPhase:false,rrgExitLabel:null,exitHint:null,weekChange:null,rsBelowBench:false}));

  let backtest=null;
  let evalJob=null;
  if(run && paramMode==='WALKFORWARD') {
    if(jobId) {
      evalJob=readJob(jobId);
      if(evalJob?.status==='done') {
        const loaded=loadJobResult(jobId);
        if(loaded) backtest={...loaded, jobId};
        else backtest={error:'Walk-Forward Ergebnisdatei fehlt', equity:[], holdings:[], exits:[], rebalances:[], jobId};
      } else if(evalJob?.status==='error'||evalJob?.status==='failed') {
        backtest={error:evalJob.message||'Walk-Forward Job fehlgeschlagen', equity:[], holdings:[], exits:[], rebalances:[], jobId};
      } else {
        // still running — return job status, no equity yet
        backtest={pending:true, jobId, message:evalJob?.message||'Walk-Forward läuft…', equity:[], holdings:[], exits:[], rebalances:[]};
      }
    } else if(startJob) {
      const nowY0=new Date().getUTCFullYear();
      const fy0=intParam(q.wfFirstYear??q.wffirstyear, nowY0-years+1, 1995, nowY0);
      const ly0=intParam(q.wfLastYear??q.wflastyear, nowY0, fy0, nowY0);
      const wantSig=wfParamSig({universe:u.key, from:`${Math.max(1995, fy0-2)}-01-01`, to:`${ly0}-12-31`, firstYear:fy0, wfWindow, rollYears:wfRollYears, period:wfPeriod,
        grid:['coarse','medium','full'].includes(wfGrid)?wfGrid:'coarse', transition:wfTransition, fee, start:startCapital, size:sizeMode, fractional,
        trail, trailLock, ranking, tuneTrail:wfTuneTrail, tuneRanking:wfTuneRanking});
      // Reuse a running job only if it was started with exactly these parameters (incl. TRAIL/TRAILLOCK/RANKING).
      const already=listJobs(5).find(j=>j.mode==='walkforward'&&j.status==='running'&&j.paramSig===wantSig);
      if(already) {
        evalJob=already;
        backtest={pending:true, jobId:already.id, message:already.message||'Walk-Forward läuft bereits…', equity:[], holdings:[], exits:[], rebalances:[]};
      } else {
      // Derive years window for first/last year
      const nowY=new Date().getUTCFullYear();
      const firstYear=intParam(q.wfFirstYear??q.wffirstyear, nowY-years+1, 1995, nowY);
      const lastYear=intParam(q.wfLastYear??q.wflastyear, nowY, firstYear, nowY);
      const from=`${Math.max(1995, firstYear-2)}-01-01`;
      evalJob=startWalkForwardJob({
        universe:u.key, from, to:`${lastYear}-12-31`,
        firstYear, wfWindow, rollYears:wfRollYears, period:wfPeriod,
        grid:['coarse','medium','full'].includes(wfGrid)?wfGrid:'coarse',
        transition:wfTransition,
        fee, start:startCapital, size:sizeMode, fractional,
        trail, trailLock, ranking, tuneTrail:wfTuneTrail, tuneRanking:wfTuneRanking,
      });
      backtest={pending:true, jobId:evalJob.id, message:'Walk-Forward gestartet (jährlich neu tunen)…', equity:[], holdings:[], exits:[], rebalances:[]};
      }
    } else {
      // list latest or wait for explicit start
      const recent=listJobs(5).find(j=>j.mode==='walkforward'&&j.status==='running');
      if(recent) {
        evalJob=recent;
        backtest={pending:true, jobId:recent.id, message:recent.message||'Walk-Forward läuft…', equity:[], holdings:[], exits:[], rebalances:[]};
      } else {
        backtest={pending:true, needStart:true, message:'PARAMMODE=WALKFORWARD — Job starten mit STARTJOB=1', equity:[], holdings:[], exits:[], rebalances:[]};
      }
    }
  } else if(run && benchmark) {
    backtest=rotationBacktest(data.results, years, n, {benchmarkBars:benchmark.bars, mode, rankTop, confirmWeeks, rsExit, universe:u.key, startCapital, fractional, sizeMode, fee, trail, trailLock, ranking});
  } else if(run && !benchmark) {
    backtest={error:`Benchmark ${benchTicker} unavailable; backtest skipped`,equity:[],holdings:[],exits:[],rebalances:[]};
  }

  // Simulated backtest holdings only — never overwrites the user watchlist.
  const holdings=backtest?.holdings?.length ? backtest.holdings : watch;

  const book=loadBook();
  const open=openPositions(book);
  // Seed barMap with scan histories so current-universe positions reuse them.
  const bookEval=await evaluateOpenBook(open, {
    overrideUniverse:u.key, mode, rankTop, rankMap, years:trail>0?trailYears(open):2, trail, ranking, confirmWeeks, rsExit, friAsOf:q.friAsOf||null,
  });
  // Prefer scan bars/ranks for current universe: re-run that slice with barMap merge.
  const openHere=open.filter(p=>p.universe===u.key);
  const missing=openHere.map(p=>p.symbol).filter(t=>!barMap.has(t));
  if(missing.length) {
    const extra=await batch(missing,t=>hist(t,ranking==='MOM52_4'?3:2));
    const ex=u.eur?(await adjustEuSeries(u.key, extra.results, 3)).results:extra.results;
    for(const s of ex) barMap.set(s.ticker,s.bars);
    for(const e of extra.errors) data.errors.push(e);
  }
  // Scan bars cover only ~1y; for the trailing peak since an older buy date load longer histories (cached).
  const trailBars=new Map(barMap);
  if(trail>0 && openHere.length) {
    const ty=trailYears(openHere);
    const longer=await batch([...new Set(openHere.map(p=>p.symbol))],t=>hist(t,ty));
    const lg=u.eur?(await adjustEuSeries(u.key, longer.results, ty)).results:longer.results;
    for(const s of lg) trailBars.set(s.ticker,s.bars);
    for(const e of longer.errors) data.errors.push(e);
  }
  const positionsHere=evaluatePositionBook(openHere, trailBars, benchmark?.bars||null, rankMap, {
    mode, rankTop, universe:u.key, trail, confirmWeeks, rsExit,
  }).map(r=>({...r, rrgExit:mode, rankTopUsed:rankTop, ...(q.friAsOf?{friRsl:rslAt(trailBars.get(r.symbol), q.friAsOf)}:{})}));
  const positionsOther=bookEval.positions.filter(p=>p.universe!==u.key);
  const positions=[...positionsHere, ...positionsOther];
  const sold=closedPositions(book, 500); // all closed (book is small); UI filters by universe and shows 15

  // M&A flags: manual list + EDGAR for holdings ∪ Kauf-Fenster/Top X (DAX skips EDGAR).
  // Rangliste zeigt M&A-Titel immer (markiert); „M&A ignorieren“ (MASKIP, Standard 1) wirkt nur auf die Kauf-Markierung im UI.
  // Altes HIDEMA wird ignoriert.
  const maSkip = maSkipParam(q);
  const maForce = q.maRefresh==='1' || q.marefresh==='1';
  // Top X (Rangzeilen) erweitert die EDGAR-Prüfung auf die sichtbaren Zeilen (max. 50, Cache 180d).
  const topXRaw=Math.floor(Number(q.topX??q.topx)); const topX=Number.isFinite(topXRaw)&&topXRaw>0?Math.min(topXRaw,500):0;
  const maSymbols = [...new Set([
    ...open.map(p=>p.symbol),
    // n+10: Puffer, damit das Kauf-Fenster bei übersprungenen M&A-Titeln über Rang N hinaus geprüft ist.
    ...rows.slice(0,Math.max(n+10, Math.min(topX, 50))).map(r=>r.ticker),
  ])];
  let maInfo={flags:new Map(),errors:[],checked:[],skipped:[],manualCount:0};
  try { maInfo = await resolveMaFlags(maSymbols, {universe:u.key, force:maForce}); }
  catch(e) { maInfo.errors=[{error:e.message||String(e)}]; }
  const positionsMa = applyMaFlags(positions, maInfo.flags, {key:'symbol'});
  const rowsMa = applyMaFlags(rows, maInfo.flags, {key:'ticker'});
  const watchMa = applyMaFlags(watch, maInfo.flags, {key:'ticker'});
  const holdingsMa = applyMaFlags(holdings, maInfo.flags, {key:'ticker'});
  const rankRows = rowsMa;

  return {
    // open screen follows these stocks: refreshed bars in the background, quiet update (lib/ohlc-live.js)
    live:{key:`rsl26:${u.key}`, version:liveRegister(`rsl26:${u.key}`, [...u.tickers, benchTicker])},
    universe:u.key, universeLabel:u.label, warning:u.warning,
    formula:(ranking==='RSL26'?'':`Rangliste nach ${ranking==='MOM52_4'?'12-1-Momentum (Wochenschluss vor 4 Wochen / Wochenschluss vor 52 Wochen − 1)':'RSL39 (Wochenschluss / SMA 39 Wochenschlüsse)'}; Rank-Schutz nutzt diesen Rang. `)+'Levy RSL26: Wochenschluss / SMA(26 Wochenschlüsse), laufende Woche eingeschlossen. Einstieg: freie Positionen (N) werden aus Rang 1…N der Rangliste gefüllt. Exits (wöchentlich): RRG-Modus (Aktie vs. Markt) mit Rank-Schutz, RS-Exit (RSL26 Aktie < RSL26 Benchmark) und Trailing-Stop (falls TRAIL > 0). RRG-Schwächephase nach Leading→Weakening oder Leading→Lagging (aktueller Zustand, unabhängig vom Kaufdatum). Live-Exits = aktuelle Kriterien (RRG/Rank/Rank-Schutz/RSL/Trailing). N = Zielanzahl Positionen (Terminal-Standard 5, API-Default 25). Die Rangliste im Terminal zeigt Top X Zeilen (Feld „Rangzeilen“ im Kopf der Rangliste, Standard 25, unabhängig von N); bei weniger Holdings als N werden die nächsten nicht gehaltenen Titel aus Rang 1…N als KAUF-Kandidat markiert (nur Markierung), gehaltene Titel als „im Depot“.',
    years, n, topX:topX||null, rrgExit:mode, rankTop, confirmWeeks, rsExit, trail, trailLock, ranking, rankingLabel, rankings:RANKINGS, wfTuneTrail, wfTuneRanking, startCapital, fractional, sizeMode, fee, paramMode, wfWindow, wfRollYears, wfPeriod, wfGrid, wfTransition, evalJob, ohlcvCache, rrgExitModes:RRG_EXIT_MODES,
    rrgExitDefaults:defaults,
    benchmark:benchmark?{ticker:benchTicker,asOf:benchmark.asOf}:null,
    recommendation:'Favorit (Standardprofil): RANK, N=5, RANKTOP 25, RS-Exit an, Rangliste RSL26, Trailing-Stop 20 % mit 4 Wochen Sperre. Live-Exit-Signale in Holdings bewerten den aktuellen Stand (RRG/Rank/Rank-Schutz/RSL/Trailing), unabhängig vom Kaufdatum.',
    rules:{
      weeklyOnly:true,
      neverDaily:true,
      exitIndependentOfEntry:true,
      dateMode:'UTC (YYYY-MM-DD)',
      watchlist:'data/rsl-watchlist.json — Holdings (offene Positionen): Hinzufügen/Bearbeiten/Verkaufen/Löschen/Wieder öffnen; Exits nur auf offenen Positionen, Kriterien aktuell (ohne Kaufdatum-Gate).',
      modes:{
        OFF:'Kein RRG-Exit (Standard DAX). Verkauft wird nur über den RS-Exit (falls RSEXIT an) oder den Trailing-Stop (falls TRAIL > 0).',
        DIRECT:'Exit in der Signalwoche, sobald von Leading → Weakening ODER Leading → Lagging gewechselt wird (Freitag-Close).',
        'DIRECT+RSL':'Wie DIRECT, aber nur wenn in der Wechselwoche zugleich RSL26 der Aktie < RSL26 Benchmark.',
        CONFIRM:'Nach L→W/L→Lagging: innerhalb Rank-Schutz (Rank ≤ RANKTOP) wird confirmWeeks Wochen auf Bestätigung gewartet; bleibt die Aktie Weakening/Lagging, folgt der Exit. Rückkehr nach Improving/Leading bricht ab. Außerhalb Rank-Schutz: sofort. Standard NDX, RANKTOP 50, confirmWeeks=1.',
        RANK:'Nach L→W/L→Lagging beginnt eine Schwächephase. Exit erst wenn Rank > RANKTOP (außerhalb Rank-Schutz). Rückkehr nach Improving/Leading beendet die Phase ohne Exit. Standard SPX, RANKTOP 25. RANKTOP=0 = kein Schutz (sofort Exit).',
      },
      rankSchutz:'Rank-Schutz = Band Rank ≤ RANKTOP (Rang laut gewählter Rangliste). Er verhindert nur RRG-Exits, nicht RS-Exit oder Trailing-Stop. Eine Aktie, die z.B. bei Rank 10 gekauft wurde und RANKTOP=10 hat, kann in der nächsten Woche wieder raus, sobald sie Rank 11+ hat UND in einer RRG-Schwächephase (nach L→W/L→Lagging) ist — Kaufpreis/Kaufdatum spielen keine Rolle.',
      confirmWeeks:'Nur CONFIRM: Anzahl Wochen Bestätigung innerhalb des Rank-Schutzes bevor verkauft wird (Default 1, max 8).',
      trailing:'TRAIL=x in % (0 = aus; Terminal-Standard 20, API-Default 0): Exit, wenn der Freitags-Wochenschluss ≤ (1 − x/100) × höchster Wochenschluss seit Kauf (Kaufkurs eingeschlossen). Kein Intraday-Stop. Ausführung Montag-Open wie andere Exits; greift nur, wenn in derselben Woche kein anderer Exit feuert. Danach TRAILLOCK Wochen (Default 4) kein Wiederkauf dieses Titels; andere Titel füllen den Slot. Die Sperre wirkt im Backtest und im Scanner: ein verkaufter Titel, dessen Trailing-Stop bis zum Verkauf ausgelöst war (aus den Kursen ermittelt, der Verkaufsgrund muss nicht im Buch stehen), ist bis Verkaufsdatum + TRAILLOCK Wochen kein Kauf-Kandidat (Rangliste „gesperrt bis“, auch für die RSL-Kauf-Alarme). Getestet: TRAIL=20 TRAILLOCK=4. In Holdings: Hoch seit Kaufdatum, Stop-Level und Abstand.',
      ranking:'RANKING=RSL26 (Default) | RSL39 | MOM52_4. Bestimmt die Rangliste für Neukäufe (Rang 1…N) und den Rang für den Rank-Schutz (RANKTOP). MOM52_4 = 12-1-Momentum: Rendite vom Wochenschluss vor 52 Wochen bis zum Wochenschluss vor 4 Wochen (die letzten 4 Wochen werden ausgelassen). RS-Exit (RSL Aktie < RSL Benchmark) und RRG-Exits bleiben unverändert auf RSL26/RRG.',
      rsBelowBench:'RSEXIT=1 (Default): zusätzlicher wöchentlicher Exit wenn RSL26 Aktie < RSL26 Benchmark (immer RSL26, auch bei anderer Rangliste) — unabhängig vom RRG-Modus und vom Rank-Schutz. RSEXIT=0 schaltet das ab.',
      lagging:'Leading→Lagging wird wie Leading→Weakening behandelt (gleiche Schwächephase / gleichen Exit-Trigger).',
      openSince:'„RRG-Exit offen seit …“ = Start der noch aktiven Schwächephase; entfällt bei Improving/Leading.',
      maSkip:'MASKIP=1 (Standard, „M&A ignorieren“ unter Entry): Titel mit M&A-Flag (laufender Deal) werden beim Einstieg übersprungen und zählen nicht zum Kauf-Fenster Rang 1…N; das Fenster erweitert sich auf den nächsten Rang ohne M&A (N=5, Rang 3 M&A → Ränge 1, 2, 4, 5, 6). Gehaltene M&A-Titel bleiben (kein Zwangsverkauf). MASKIP=0: nur Warnung. Die Rangliste zeigt M&A-Titel immer. Backtest: keine historischen M&A-Daten → keine Wirkung.',
      timing:'Signale Freitag-Close (bzw. letzter Wochen-Session-Tag); Ausführung Montag-Open (bzw. nächste Session) im Backtest.',
    },
    rows:rankRows, rowsAll:rowsMa, holdings:holdingsMa, watch:watchMa, eu:euInfo, currency:u.eur?'EUR':(u.key==='SPX'||u.key==='NDX'?'USD':null),
    ...tagUniverses(positionsMa, sold),
    trailLocks:await computeTrailLocks(sold, trail, trailLock),
    maSkip,
    ma:{
      checked:maInfo.checked,
      skipped:maInfo.skipped,
      manualCount:maInfo.manualCount,
      flagged: [...maInfo.flags.keys()],
      errors:maInfo.errors,
      note:'M&A: manuelle Liste + SEC EDGAR (US only, Holdings ∪ Top max(N+10, X≤50), Lookback 180d). M&A ignorieren (MASKIP=1, Standard): M&A-Titel zählen nicht zum Kauf-Fenster Rang 1…N, das Fenster rückt vor; gehaltene bleiben. Kein Einfluss auf Backtests (keine historischen M&A-Daten). DAX/EDGAR übersprungen. Cache data/cache/ma-edgar.json.',
    },
    book:{updatedAt:book.updatedAt, open:open.length, closed:book.positions.length-open.length},
    bookAction:bookResult?{
      ok:bookResult.ok,
      message:bookResult.message,
      duplicated:!!bookResult.duplicated,
      position:bookResult.position,
    }:null,
    coverage:{
      requested:data.requested,loaded:data.loaded,ranked:rows.length, scanMs:Date.now()-t0, fromCache:ohlcvCache.fromCache,
      partial:data.errors.length>0,positionsOpen:open.length,
    },
    errors:[...data.errors, ...(bookEval.errors||[])],
    backtest,
    source:SOURCE,
  };
}
