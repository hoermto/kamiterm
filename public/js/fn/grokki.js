import {api,esc,px,big} from '../api.js';
import {table,kv,sect,tabs,html,equityChart,downloadText} from '../ui.js';
import {topXVal,buySlotCandidates} from './rsl-slots.js';
import {pnlRow,pnlTotals} from './rsl-pnl.js';
const fmt=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'—';
const fmt0=v=>Number.isFinite(v)?String(Math.round(v)):'—';
const pct=v=>Number.isFinite(v)?`${v.toFixed(2)}%`:'—';
/** Stückzahl: bis 4 Nachkommastellen, deutsches Format, ohne Nullen am Ende (3,25 · 10 · 0,1235). */
const fmtQty=v=>{const n=Number(v);return v!=null&&v!==''&&Number.isFinite(n)?n.toLocaleString('de-DE',{maximumFractionDigits:4,minimumFractionDigits:0}):'—';};
const note=s=>html(`<p class="hint">${esc(s)}</p>`);
/** Aufklappbare Zeile (<details>), Standard zu; Offen-Zustand pro key in localStorage. */
function collapsible(key, summary, nodes, {open=false}={}){
  const d=document.createElement('details');d.className='rsl-collapse';d.dataset.key=key;d.style.margin='6px 0';
  let isOpen=open;try{const v=localStorage.getItem(`amber.rsl.open.${key}`);if(v!=null)isOpen=v==='1';}catch{}
  d.open=isOpen;
  const sm=document.createElement('summary');sm.style.cssText='cursor:pointer;font-weight:600';sm.textContent=summary;d.append(sm);
  for(const n of [].concat(nodes||[])) if(n) d.append(n);
  d.addEventListener('toggle',()=>{try{localStorage.setItem(`amber.rsl.open.${key}`,d.open?'1':'0');}catch{}});
  return d;
}
const maBadge=(ma)=>{
  if(!ma||!ma.flagged) return '—';
  const tip=[];
  if(ma.manual) tip.push(`Manuell${ma.manual.note?': '+ma.manual.note:''}${ma.manual.date?' ('+ma.manual.date+')':''}`);
  if(ma.edgar) tip.push(`EDGAR ${ma.edgar.form}${ma.edgar.role?' · '+ma.edgar.role:''}${ma.edgar.filed?' · '+ma.edgar.filed:''}`);
  if(ma.url||ma.edgar?.url) tip.push(ma.url||ma.edgar.url);
  const title=esc(tip.join(' | ')||ma.label||'M&A');
  const href=ma.url||ma.edgar?.url;
  const label=esc(ma.edgar?.form||(ma.manual?'manuell':'M&A'));
  return href
    ? `<a href="${esc(href)}" target="_blank" rel="noopener" title="${title}" style="color:#ff7a45;font-weight:600;text-decoration:none">M&A·${label}</a>`
    : `<span title="${title}" style="color:#ff7a45;font-weight:600">M&A·${label}</span>`;
};
const maCol={key:'ma',label:'M&A',html:true,left:true,fmt:v=>maBadge(v)};
/** Universe-Badge (Kauf-Universum farbig, weitere Index-Mitgliedschaften klein). */
const UNI_COLORS={SPX:'#3d7bd9',NDX:'#9b59d0',HDAX:'#d4a017',SXXP:'#1abc9c',DAX:'#d4a017'};
const UNI_LABELS={SPX:'SPX',NDX:'NDX (Nasdaq 100)',HDAX:'HDAX (DAX+MDAX+TecDAX)',SXXP:'STOXX Europe 600 (EUR)',DAX:'DAX → HDAX'};
const UNI_BENCH={SPX:'^GSPC',NDX:'^NDX',HDAX:'^GDAXI',SXXP:'^STOXX'};
/** Scanner-/Backtest-Reiter. DAX (alt) → HDAX, STOXX/STOXX600 → SXXP. */
const SCAN_UNIS=['SPX','NDX','HDAX','SXXP'];
const TAB_LABELS={SPX:'SPX',NDX:'NDX',HDAX:'HDAX',SXXP:'STOXX 600'};
const UNI_ALIAS={DAX:'HDAX',STOXX:'SXXP',STOXX600:'SXXP',SXXP600:'SXXP',EUROSTOXX600:'SXXP'};
const canonUni=v=>{const k=String(v||'').toUpperCase();return UNI_ALIAS[k]||k;};
const findUniArg=args=>{for(const a of args){const k=canonUni(a);if(SCAN_UNIS.includes(k))return k;}return null;};
function uniTabs(current,onPick){const el=tabs(SCAN_UNIS,current,onPick);el.querySelectorAll('button').forEach((b,i)=>{const u=SCAN_UNIS[i];b.textContent=TAB_LABELS[u];b.dataset.uni=u;b.title=`${UNI_LABELS[u]} · Benchmark ${UNI_BENCH[u]}`;});return el;}
/** Strategie-Felder je Universum: zuletzt benutzt (byUniverse) oder Research-Voreinstellung (HDAX Kandidat B, STOXX 600 Kandidat A). */
const STRAT_KEYS=['n','rrgExit','rankTop','confirmWeeks','rsExit','trail','trailLock','ranking','maSkip'];
const UNI_PRESETS={
  HDAX:{n:5,rrgExit:'RANK',rankTop:10,confirmWeeks:1,rsExit:0,trail:20,trailLock:4,ranking:'MOM52_4',maSkip:1},
  SXXP:{n:5,rrgExit:'OFF',rankTop:25,confirmWeeks:1,rsExit:0,trail:20,trailLock:0,ranking:'MOM52_4',maSkip:1},
};
const pickStrat=o=>Object.fromEntries(STRAT_KEYS.filter(k=>o&&o[k]!=null&&o[k]!=='').map(k=>[k,o[k]]));
function applyUniOverlay(saved,u){
  const global={...saved};
  const src=saved.byUniverse?.[u]||UNI_PRESETS[u];
  if(src) Object.assign(saved,pickStrat(src));
  return global;
}
function byUniversePatch(global,u,cur){
  const m={...(global.byUniverse||{})};
  const prev=canonUni(global.universe);
  if(prev&&prev!==u&&!m[prev]&&SCAN_UNIS.includes(prev)) m[prev]=pickStrat(global); // Werte des bisherigen Reiters sichern
  m[u]={...pickStrat({...cur,rsExit:cur.rsExit?1:0,maSkip:cur.maSkip?1:0})};
  return m;
}
function uniBadge(u,{small=false,title=''}={}){const c=UNI_COLORS[u]||'#777';return `<span title="${esc(title||UNI_LABELS[u]||u)}" style="display:inline-block;padding:0 5px;border-radius:3px;font-size:${small?'10px':'11px'};font-weight:600;background:${small?'transparent':c};color:${small?c:'#000'};border:1px solid ${c};margin-right:2px">${esc(u)}</span>`;}
const uniCol={key:'universe',label:'Univ.',html:true,left:true,fmt:(v,r)=>{const u=r.universe||v||'SPX';const other=(r.memberOf||[]).filter(x=>x!==u);
  return uniBadge(u,{title:`Kauf-Universum ${UNI_LABELS[u]||u}${r.universeSource&&r.universeSource!=='gespeichert'?` (${r.universeSource})`:''} · Exit-Signale gegen ${UNI_BENCH[u]||'^GSPC'}${u==='SXXP'||u==='HDAX'?' · Kurse in EUR':''}`})+other.map(x=>uniBadge(x,{small:true,title:`auch in ${UNI_LABELS[x]||x}`})).join('');}};
const HOLD_FILTER_KEY='amber.rsl.holdingsUniverse';
const keys=args=>Object.fromEntries(args.filter(a=>a.includes('=')).map(a=>{const [k,...v]=a.split('=');return [k.toLowerCase(),v.join('=')];}));

/** Persist last-used tool settings: server data/settings.json + localStorage fallback. */
const LS_KEY = (tool) => `amber.toolSettings.${tool}`;
async function loadToolSettings(tool, defaults = {}) {
  let saved = {};
  try {
    const r = await api.get(`/api/settings?tool=${encodeURIComponent(tool)}`);
    saved = r?.settings || {};
  } catch (_) {
    try { saved = JSON.parse(localStorage.getItem(LS_KEY(tool)) || '{}'); } catch { saved = {}; }
  }
  try {
    const local = JSON.parse(localStorage.getItem(LS_KEY(tool)) || '{}');
    // server wins on conflict except local-only keys; prefer newer updatedAt
    if (local?.updatedAt && (!saved?.updatedAt || local.updatedAt > saved.updatedAt)) {
      saved = { ...saved, ...local };
    } else {
      saved = { ...local, ...saved };
    }
  } catch { /* ignore */ }
  return { ...defaults, ...saved };
}
async function saveToolSettings(tool, settings) {
  const payload = { ...settings, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(LS_KEY(tool), JSON.stringify(payload)); } catch { /* ignore */ }
  try { await api.put('/api/settings', { tool, settings: payload }); } catch { /* offline ok */ }
  return payload;
}
async function resetToolSettings(tool) {
  try { localStorage.removeItem(LS_KEY(tool)); } catch { /* ignore */ }
  try { await api.put('/api/settings', { tool, reset: true }); } catch { /* ignore */ }
}

function rslFlag(v){return !(v===false||v===0||v==='0');}
/** „M&A ignorieren“ (Entry): fehlt der Wert (alte Profile/Einstellungen) → an. */
function maSkipVal(v){return v==null||v===''?true:rslFlag(v);}
/** Trailing-Stop: TRAIL in % (0 = aus), TRAILLOCK = Wiederkauf-Sperre Wochen (Default 4). */
function trailNum(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:0;}
function lockNum(v){const n=Number(v);return v!==''&&v!=null&&Number.isFinite(n)&&n>=0?Math.floor(n):4;}
function trailArgs(v){const t=trailNum(v.trail);return t>0?` TRAIL=${t} TRAILLOCK=${lockNum(v.trailLock)}`:' TRAIL=0';}
function trailInputs(form, cur){
  const tl=document.createElement('label');tl.textContent='Trailing-Stop % ';
  const ti=document.createElement('input');ti.name='trail';ti.type='number';ti.min='0';ti.max='90';ti.step='1';ti.style.width='55px';ti.value=trailNum(cur.trail);
  ti.title='Trailing-Stop: Exit, wenn der Freitags-Wochenschluss ≤ (1 − x/100) × höchster Wochenschluss seit Kauf; Ausführung Montag-Open. 0 = aus. Standard: 20.';tl.title=ti.title;
  tl.append(ti);form.append(tl);
  const ll=document.createElement('label');ll.textContent='Rückkauf-Sperre Wo. ';
  const li=document.createElement('input');li.name='trailLock';li.type='number';li.min='0';li.max='52';li.step='1';li.style.width='50px';li.value=lockNum(cur.trailLock);
  li.title='Nach einem Trailing-Exit wird der Titel so viele Wochen nicht wieder gekauft (Default 4). Wirkt im Backtest; im Scanner nicht automatisch.';ll.title=li.title;
  ll.append(li);form.append(ll);
}
/** Rangliste (Einstieg + Rank-Schutz): RSL26 (Default) | RSL39 | MOM52_4 (12-1-Momentum). */
const RANKINGS=[['RSL26','RSL26 (Levy, Standard)'],['RSL39','RSL39'],['MOM52_4','Momentum 12-1 (52–4 Wo.)']];
function rankingVal(v){const r=String(v||'').toUpperCase();return RANKINGS.some(([k])=>k===r)?r:'RSL26';}
function rankingInput(form, cur){
  const l=document.createElement('label');l.textContent='Rangliste ';
  const sel=document.createElement('select');sel.name='ranking';
  sel.title='Rangliste für Neukäufe und Rank-Schutz (RANKTOP). MOM52_4 = Rendite vom Wochenschluss vor 52 Wochen bis vor 4 Wochen. RS-Exit und RRG-Exits bleiben unverändert (RSL26/RRG).';
  for(const [k,lab] of RANKINGS){const o=document.createElement('option');o.value=k;o.textContent=lab;if(k===rankingVal(cur.ranking))o.selected=true;sel.append(o);}
  l.append(sel);form.append(l);
}
function buildRslScan(u,v,extra=''){
  let s=`RSL26 ${u} N=${v.n} RRGEXIT=${v.rrgExit} RANKTOP=${v.rankTop} confirmWeeks=${v.confirmWeeks??1} RSEXIT=${rslFlag(v.rsExit)?1:0}`;
  s+=trailArgs(v);
  s+=` RANKING=${rankingVal(v.ranking)}`;
  s+=` MASKIP=${maSkipVal(v.maSkip)?1:0}`;
  if(v.topX!=null&&v.topX!=='') s+=` TOPX=${topXVal(v.topX)}`;
  if(extra) s+=` ${extra}`;
  return s;
}
function buildRslBt(u,v,extra=''){
  let s=`RSLBT ${u} YEARS=${v.years??5} N=${v.n} RRGEXIT=${v.rrgExit} RANKTOP=${v.rankTop} START=${v.start??10000} SIZE=${v.size||'EQUITY'} FRACTIONAL=${rslFlag(v.fractional)?1:0} FEE=${v.fee??1} confirmWeeks=${v.confirmWeeks??1} RSEXIT=${rslFlag(v.rsExit)?1:0}`;
  s+=trailArgs(v);
  s+=` RANKING=${rankingVal(v.ranking)}`;
  if(String(v.paramMode||'').toUpperCase()==='WALKFORWARD'){
    s+=` PARAMMODE=WALKFORWARD WFWINDOW=${v.wfWindow||'expanding'} WFROLLYEARS=${v.wfRollYears??2} WFPERIOD=${v.wfPeriod||'yearly'} WFGRID=${v.wfGrid||'coarse'} WFTRANSITION=${v.wfTransition||'carry'}`;
    if(rslFlag(v.wfTuneTrail??0)) s+=' WFTUNETRAIL=1';
    if(rslFlag(v.wfTuneRanking??0)) s+=' WFTUNERANKING=1';
    if(v.jobId) s+=` JOBID=${v.jobId}`;
  }
  s+=` MASKIP=${maSkipVal(v.maSkip)?1:0}`;
  if(extra) s+=` ${extra}`;
  return s;
}
function profilePayload(src){
  return {
    universe:src.universe,
    n:Number(src.n),
    rrgExit:src.rrgExit,
    rankTop:Number(src.rankTop),
    confirmWeeks:Number(src.confirmWeeks)||1,
    rsExit:rslFlag(src.rsExit)?1:0,
    trail:trailNum(src.trail),
    trailLock:lockNum(src.trailLock),
    ranking:rankingVal(src.ranking),
    maSkip:maSkipVal(src.maSkip)?1:0, // ersetzt hideMa (alte Profile ohne maSkip → 1)
    ...(src.topX!=null&&src.topX!==''?{topX:topXVal(src.topX)}:{}), // Rangzeilen Top X; alte Profile ohne topX → aktueller Wert bzw. 25
    years:Number(src.years)||5,
    start:Number(src.start)||10000,
    size:src.size||'EQUITY',
    fractional:rslFlag(src.fractional)?1:0,
    fee:src.fee??1,
  };
}
async function fetchProfiles(){
  try{
    const r=await api.get('/api/settings/profiles?tool=RSL26');
    const list=r.profiles||[];
    try{localStorage.setItem(LS_KEY('RSL26')+'.profiles',JSON.stringify(list));}catch{}
    return list;
  }catch{
    try{return JSON.parse(localStorage.getItem(LS_KEY('RSL26')+'.profiles')||'[]');}catch{return [];}
  }
}
async function upsertProfile(profile){
  const r=await api.post('/api/settings/profiles',{tool:'RSL26',profile});
  try{localStorage.setItem(LS_KEY('RSL26')+'.profiles',JSON.stringify(r.profiles||[]));}catch{}
  return r;
}
async function removeProfile(id){
  const r=await api.post('/api/settings/profiles',{tool:'RSL26',action:'delete',id});
  try{localStorage.setItem(LS_KEY('RSL26')+'.profiles',JSON.stringify(r.profiles||[]));}catch{}
  return r;
}
function mountProfileBar(host, {current, profiles, onChange}){
  let list=profiles||[];
  const wrap=html('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0"></div>');
  const lab=document.createElement('strong');lab.textContent='Profil';
  const sel=document.createElement('select');sel.style.minWidth='220px';
  const fill=()=>{sel.innerHTML='<option value="">— gespeicherte Profile —</option>'+list.map(p=>`<option value="${esc(p.id)}"${p.isDefault?' style="font-weight:600"':''}>${esc(p.name)}${p.isDefault?' (Standard)':''}</option>`).join('');};
  fill();
  const loadBtn=document.createElement('button');loadBtn.type='button';loadBtn.textContent='Laden';
  loadBtn.title='Gespeichertes Profil übernehmen (Liste, N, Exit-Strategie)';
  loadBtn.onclick=()=>{
    const p=list.find(x=>x.id===sel.value);
    if(!p) return alert('Bitte zuerst ein Profil wählen.');
    onChange({type:'load',profile:p});
  };
  const saveBtn=document.createElement('button');saveBtn.type='button';saveBtn.textContent='Als Profil speichern';
  saveBtn.title='Aktuelle Parameter unter einem Namen merken und im Scanner oder Backtest laden';
  saveBtn.onclick=async()=>{
    const suggested=`${current.rrgExit||'RANK'} N${current.n} RT${current.rankTop}${current.universe?' '+current.universe:''}`;
    const name=prompt('Name für das Profil:', suggested);
    if(name==null) return;
    const trimmed=String(name).trim();
    if(!trimmed) return alert('Bitte einen Namen eingeben.');
    try{
      const r=await upsertProfile({...profilePayload(current),name:trimmed});
      list=r.profiles||[];
      fill();
      if(r.profile?.id) sel.value=r.profile.id;
      onChange?.({type:'save',profile:r.profile,profiles:list});
    }catch(e){alert(e.message);}
  };
  const delBtn=document.createElement('button');delBtn.type='button';delBtn.textContent='Löschen';
  delBtn.onclick=async()=>{
    const p=list.find(x=>x.id===sel.value);
    if(!p) return alert('Bitte zuerst ein Profil wählen.');
    if(p.isDefault) return alert('Das Standardprofil kann nicht gelöscht werden. Überschreiben geht mit „Als Profil speichern“ unter demselben Namen.');
    if(!confirm(`Profil „${p.name}“ löschen?`)) return;
    try{
      const r=await removeProfile(p.id);
      list=r.profiles||[];
      fill();
      onChange?.({type:'delete',profiles:list});
    }catch(e){alert(e.message);}
  };
  wrap.append(lab,sel,loadBtn,saveBtn,delBtn);
  host.append(wrap);
}
function exitInfoPanel(rules) {
  if (!rules) return html('<div></div>');
  const modes = rules.modes || {};
  const rows = Object.entries(modes).map(([k, v]) => `<tr><th style="text-align:left;vertical-align:top;padding:4px 8px;white-space:nowrap">${esc(k)}</th><td style="padding:4px 8px">${esc(v)}</td></tr>`).join('');
  const extra = [
    ['Rank-Schutz', rules.rankSchutz],
    ['confirmWeeks', rules.confirmWeeks],
    ['RSEXIT / RSL<Bench', rules.rsBelowBench],
    ['TRAIL / Trailing-Stop', rules.trailing],
    ['RANKING / Rangliste', rules.ranking],
    ['L→Lagging', rules.lagging],
    ['Timing', rules.timing],
    ['offen seit', rules.openSince],
  ].filter(([, v]) => v).map(([k, v]) => `<tr><th style="text-align:left;vertical-align:top;padding:4px 8px">${esc(k)}</th><td style="padding:4px 8px">${esc(v)}</td></tr>`).join('');
  return html(`<details style="margin:8px 0"><summary style="cursor:pointer;font-weight:600">ℹ Exit-Methoden &amp; Rank-Schutz (Info)</summary>
    <div style="margin-top:6px;padding:8px;border:1px solid #444;border-radius:6px;background:#111;max-width:900px">
      <table style="width:100%;font-size:13px;border-collapse:collapse">${rows}${extra}</table>
    </div></details>`);
}
const col=(key,label,format)=>({key,label,...(format?{fmt:v=>format(v)}:{left:true})});
// RRG quadrants abbreviated in narrow tables; full name as tooltip.
const Q_ABBR={Leading:'Lead',Weakening:'Weak',Lagging:'Lag',Improving:'Impr'};
const Q_TIP='RRG-Quadrant (Lead = Leading, Weak = Weakening, Lag = Lagging, Impr = Improving)';
const qShort=v=>v==null||v===''?'—':`<span title="${esc(String(v))}">${esc(String(v).split(' → ').map(q=>Q_ABBR[q]||q).join('→'))}</span>`;
const qCol=(key,label,title)=>({key,label,html:true,left:true,title,fmt:v=>qShort(v)});
const rrgCols=()=>[qCol('quadrant','RRG',Q_TIP),qCol('weekChange','RRG\nΔ Wo.','RRG-Quadrant Vorwoche → aktuelle Woche'),
  {key:'openSince',label:'RRG-Exit\nseit',left:true,title:'Beginn der noch aktiven Schwächephase (Leading → Weakening/Lagging); — = keine Schwächephase',fmt:v=>v||'—'}];
// Icon buttons for row actions: symbol plus tooltip / aria-label.
const iconBtn=(attr,id,sym,label,cls='')=>`<button type="button" class="ibtn${cls?' '+cls:''}" ${attr}="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}">${sym}</button>`;

/** German Excel CSV (UTF-8 BOM + semicolon + decimal comma). downloadText also adds BOM — strip first. */
function germanCsv(rows, columns) {
  const esc=v=>{
    if(v==null||v==='') return '';
    if(typeof v==='number'&&Number.isFinite(v)) return String(v).replace('.',',');
    const s=String(v);
    if(/[;"\r\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  };
  const head=columns.map(c=>esc(String(c.label??'').replace(/\n/g,' '))).join(';');
  const body=(rows||[]).map(r=>columns.map(c=>esc(r[c.key])).join(';'));
  return '\uFEFF'+[head,...body].join('\r\n');
}
function downloadGermanCsv(name, rows, columns) {
  const csv=germanCsv(rows, columns);
  downloadText(name, csv.replace(/^\uFEFF/, ''), 'text/csv;charset=utf-8');
}
const TRADE_LOG_COLS=[
  {key:'date',label:'Datum'},{key:'signalDate',label:'SignalDatum'},{key:'period',label:'Periode'},{key:'activeConfig',label:'AktiveConfig'},
  {key:'ticker',label:'Ticker'},
  {key:'action',label:'Aktion'},{key:'reason',label:'Grund'},{key:'price',label:'Preis'},
  {key:'priceKind',label:'PreisArt'},{key:'shares',label:'Stuecke'},{key:'value',label:'Wert'},
  {key:'budget',label:'Budget'},{key:'cashBefore',label:'CashVorher'},{key:'cashAfter',label:'CashNachher'},
  {key:'equityAtOpen',label:'EquityOpen'},{key:'pnl',label:'PnL'},{key:'holdDays',label:'Haltetage'},{key:'rank',label:'Rank'},
];
const WF_YEARLY_COLS=[
  {key:'period',label:'Periode'},{key:'config',label:'Config'},{key:'mode',label:'Mode'},
  {key:'n',label:'N'},{key:'rankTop',label:'RANKTOP'},{key:'rsExit',label:'RSExit'},{key:'confirmWeeks',label:'CW'},
  {key:'trail',label:'TRAIL'},{key:'trailLock',label:'TRAILLOCK'},{key:'ranking',label:'RANKING'},
  {key:'retPct',label:'Return %'},{key:'bmRet',label:'Bench %'},{key:'excess',label:'Excess pp'},
  {key:'cagr',label:'CAGR'},{key:'maxDD',label:'MaxDD'},{key:'mar',label:'MAR'},{key:'trades',label:'Trades'},
];
const WEEKLY_LOG_COLS=[
  {key:'week',label:'WocheExec'},{key:'signalDate',label:'SignalDatum'},{key:'equity',label:'Equity'},
  {key:'cash',label:'Cash'},{key:'positions',label:'Positionen'},{key:'exits',label:'Exits'},
  {key:'entries',label:'Entries'},{key:'reducedEntries',label:'EntriesReduziert'},
  {key:'kapital',label:'Kapital'},{key:'budget',label:'Budget'},{key:'kind',label:'Art'},
];
function diagnostics(ctx,d) {
  if(d.coverage) ctx.el.append(kv(Object.entries(d.coverage).map(([k,v])=>[k,String(v)])));
  if(d.warning) ctx.el.append(note(d.warning));
  if(d.excluded?.length) ctx.el.append(note('Excluded after option filters: '+d.excluded.map(e=>e.ticker).join(', ')));
  if(d.errors?.length) ctx.el.append(html(`<details><summary>${d.errors.length} unavailable / skipped symbols</summary><pre style="white-space:pre-wrap">${esc(d.errors.map(e=>`${e.ticker}: ${e.error}`).join('\n'))}</pre></details>`));
  if(!d.rows?.length) ctx.el.append(note('No qualifying rows available. Check coverage / errors; empty data is not a zero signal.'));
  ctx.setSource(d.source);
}
function fields(ctx, values, buildCommand) {
  const form=html('<form style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0"></form>');
  for(const [name,value] of Object.entries(values)) {
    const label=document.createElement('label');label.textContent=`${name} `;
    const input=document.createElement('input');input.name=name;input.value=value;input.style.width='65px';input.type='number';label.append(input);form.append(label);
  }
  const button=document.createElement('button');button.type='submit';button.textContent='Run';form.append(button);
  form.onsubmit=e=>{e.preventDefault();ctx.go(buildCommand(Object.fromEntries(new FormData(form))));};ctx.el.append(form);
}

/** Walk-Forward is a user-started evaluation, not a live view mode. Progress updates in place (no panel reload). */
function wfProgressBox(job){
  const box=html(`<div data-wf-progress style="margin:10px 0;padding:10px;border:1px solid #444;border-radius:6px;background:#141414"></div>`);
  const fill=()=>{
    const pctn=Math.min(100, Number(job.progress)||0);
    const st=job.status||'running';
    box.replaceChildren(
      sect('Parameter neu bestimmen · Walk-Forward'),
      note(job.message||(st==='done'?'Fertig':'Job läuft…')),
      note(`Job ${job.id||'—'} · ${pctn}% · ${st}`),
      html(`<div style="height:8px;background:#333;border-radius:4px;overflow:hidden;margin:6px 0"><div style="height:100%;width:${Math.max(2,pctn)}%;background:#ffa028"></div></div>`),
      note('Du startest diesen Test selbst, um die besten RSL26-Parameter zu finden. Die Rangliste und der normale Backtest bleiben bei den festen Regeln und werden währenddessen nicht neu geladen.')
    );
  };
  fill();
  box.update=j=>{job={...job,...j};fill();};
  return box;
}
function pollWalkForwardJob(ctx, box, jobId, onDone){
  let timer;
  const stop=()=>{if(timer)clearTimeout(timer);timer=null;};
  ctx.onCleanup?.(stop);
  const tick=async()=>{
    if(!ctx.live())return;
    try{
      const r=await api.get(`/api/rsl-eval/jobs?id=${encodeURIComponent(jobId)}`);
      const job=r.job||r;
      box.update?.(job);
      if(job.status==='done'){stop();onDone?.(job,r);return;}
      if(job.status==='error'||job.status==='failed'){stop();return;}
    }catch(e){
      box.update?.({id:jobId,status:'running',message:`Warte auf Status… (${e.message})`});
    }
    timer=setTimeout(tick,4000);
  };
  timer=setTimeout(tick,4000);
}
let rslFlash=null; // message carried across the reload after a Holdings edit
function renderBacktestResults(ctx,d) {
  const holdings=d.holdings||d.watch||[];
  if(holdings.length) {
    ctx.el.append(sect('Backtest-Holdings / Top-N Exit-Watch (simuliert, nicht Ihre Holdings)'),
      note('Nur Research: Monats-Rotation bzw. aktuelles Top-N. Dieselbe Kriterienlogik wie Holdings-Exits (aktueller Stand, ohne Kaufdatum-Gate).'),
      table(holdings,[
        col('rank','#',fmt0),col('ticker','Ticker'),col('rsl','RSL',v=>fmt(v,4)),col('benchRsl','Bench\nRSL',v=>fmt(v,4)),
        ...rrgCols(),col('exitHint','Exit-\nHinweis'),col('bought','Gekauft'),
        ...(holdings.some(h=>h.trailStop!=null)?[col('trailPeak','Trail-\nHoch',v=>fmt(v,2)),col('trailStop','Trail-\nStop',v=>fmt(v,2))]:[]),
      ],{onRow:r=>ctx.go(`${r.ticker} GP`)}));
  }
  const b=d.backtest;
  if(b && !b.pending) {
    const s=b.stats||{};
    const money=v=>Number.isFinite(v)?v.toLocaleString('de-DE',{maximumFractionDigits:2}):'—';
    const isWf=d.paramMode==='WALKFORWARD'||b.paramMode==='WALKFORWARD'||!!b.yearly;
    ctx.el.append(sect(isWf?'Backtest-Ergebnis · Walk-Forward (jährlich neu tunen)':'Backtest-Ergebnis · Wöchentliche Top-N (Cash-Pool, Research)'),
      kv([
        ['Startkapital', money(s.startCapital??b.startCapital)],
        ['Endkapital', money(s.finalEquity??b.finalEquity)],
        ['Total Return', pct(s.totalReturnPct??b.totalReturnPct)],
        ['CAGR', pct(s.cagr??b.cagr)],
        ['Max Drawdown', pct(s.maxDD??b.maxDD)],
        ['Jahre (effektiv)', fmt(s.actualYears??b.actualYears)],
        ['Trades (geschlossen)', String(s.tradesClosed??b.closedTrades?.length??0)],
        ['Offen am Periodenende (gehalten)', String(s.tradesOpen??b.holdings?.length??0)],
        ['Winrate', pct(s.winRate)],
        ['Wins / Losses / Flat', `${s.wins??0} / ${s.losses??0} / ${s.flats??0}`],
        ['Avg Win / Avg Loss', `${money(s.avgWin)} / ${money(s.avgLoss)}`],
        ['Holding min / avg / max (Tage)', `${fmt0(s.holdDaysMin)} / ${fmt(s.holdDaysAvg,1)} / ${fmt0(s.holdDaysMax)}`],
        ['Holding min / avg / max (Wochen)', `${fmt(s.holdWeeksMin,2)} / ${fmt(s.holdWeeksAvg,2)} / ${fmt(s.holdWeeksMax,2)}`],
        ['Wochen-Events', String(s.rebalances??b.rebalances?.length??0)],
        ['Exec-Preis', s.execPriceKind?`open ${s.execPriceKind.open||0} / close ${s.execPriceKind.close||0}`:'—'],
        ['Bruchstücke / Budget', `${(s.fractional??d.fractional)?'ja':'nein (ganze Stücke)'} / SIZE=${s.sizeMode||d.sizeMode||'EQUITY'}`],
        ['Gebühr pro Trade / Summe', `${money(s.feePerTrade??d.fee??1)} / ${money(s.totalFees)}`],
        ['Ø Cash-Quote', pct((s.avgCashQuota??0)*100)],
        ['Entries cash-reduziert', String(s.entriesReducedDueToCash??0)],
        ['Weekly Exits', String(s.weeklyExits??0)],
        ['Rangliste', `${s.ranking??b.ranking??'RSL26'}${(s.ranking??b.ranking??'RSL26')!=='RSL26'?' (Einstieg + Rank-Schutz; RS-Exit RSL26)':''}`],
        ['Trailing-Stop', (s.trail??b.trail)>0?`${s.trail??b.trail} % · Sperre ${s.trailLock??b.trailLock} Wo. · ${s.trailingExits??0} Trailing-Exits · ${s.trailLockSkips??0} Käufe gesperrt`:'aus'],
        ['Trade-Log / Wochen', `${s.tradeLogRows??b.tradeLog?.length??0} / ${s.weeklyLogRows??b.weeklyLog?.length??0}`],
        ['Realisiert / Unrealisiert', `${money(s.realizedPnl)} / ${money(s.unrealizedPnl)}`],
        ['Audit', s.auditOk===true?'OK':(s.auditOk===false?`${s.auditIssues||'?'} Issues`:'—')],
        ['Benchmark Total Return', pct(s.benchmarkTotalReturnPct)],
        ['Benchmark CAGR', pct(s.benchmarkCagr)],
        ['RRGEXIT / RANKTOP', `${b.mode||d.rrgExit} / ${b.rankTop??d.rankTop}`],
        ['OHLCV-Cache', d.ohlcvCache?`${d.ohlcvCache.fromCache}/${d.ohlcvCache.loaded} via ${d.ohlcvCache.via}`:'—'],
      ]),
      note(s.openNote||'offen = am Periodenende noch gehalten (Mark-to-Market).'),
      note(s.model||'Cash-Pool: Freitag-Close Signal, Montag-Open Exec; Budget=min(Kapital/n, Cash); Hold ohne Exit; Ersatz aus Top-n.'),
      note(b.warning||b.error||''));
    if(isWf){
      ctx.el.append(kv([
        ['Param-Modus','WALKFORWARD · jährlich neu tunen'],
        ['WF-Fenster', `${b.wfWindow||d.wfWindow||'expanding'}${ (b.wfWindow||d.wfWindow)==='rolling' ? ` (${b.rollYears||d.wfRollYears||2}y)` : '' }`],
        ['Retune-Periode', b.period||d.wfPeriod||'yearly'],
        ['Perioden / Configs', String(b.yearly?.length??0)],
        ['Strategie (fest)', (()=>{const f=b.fixedStrategy||b.stats?.fixedStrategy;const td=b.stats?.tunedDims||{};
          if(!f) return 'TRAIL 0 · RSL26 (Lauf vor TRAIL/RANKING-Unterstützung)';
          return `TRAIL ${td.trail?'0/20 mitgetunt':(f.trail>0?`${f.trail} % · Sperre ${f.trailLock} Wo.`:'aus')} · Rangliste ${td.ranking?'mitgetunt':f.ranking}`;})()],
        ['MAR / Sharpe', `${fmt(b.stats?.mar??s.mar,2)} / ${fmt(b.stats?.sharpe??s.sharpe,2)}`],
      ]), note('Auswahlregel: Score=0.55·MAR+0.25·Sharpe+0.20·Robustheit; Walk-Forward wählt Plateau (smoothScore unter MAR≥0.9·maxMAR) sofern nicht manuell überschrieben.'));
      if(b.yearly?.length){
        ctx.el.append(sect('Gewählte Parameter je Periode'), table(b.yearly,[
          col('period','Periode'),col('config','Config'),
          col('trail','TRAIL %',v=>v==null?'0':(v>0?fmt(v,0):'aus')),{key:'trailLock',label:'Sperre Wo.',fmt:(v,r)=>r.trail>0?fmt0(v):'—'},col('ranking','Rangliste',v=>v||'RSL26'),
          col('retPct','Return %',v=>fmt(v,2)),
          col('bmRet','Bench %',v=>fmt(v,2)),col('excess','Excess pp',v=>fmt(v,2)),
          col('mar','MAR',v=>fmt(v,2)),col('trades','Trades',fmt0),
        ]));
        const ybtn=document.createElement('button');ybtn.type='button';ybtn.textContent=`CSV Perioden (${b.yearly.length})`;
        ybtn.onclick=()=>downloadGermanCsv(`grokki-wf-yearly.csv`, b.yearly, WF_YEARLY_COLS);
        ctx.el.append(ybtn);
      }
    }
    if(b.exits?.length) ctx.el.append(html(`<details><summary>${b.exits.length} Closed trades / exits (letzte 40)</summary><pre style="white-space:pre-wrap">${esc(b.exits.slice(-40).map(e=>`${e.time} ${e.ticker}: ${e.reason||e.kind||''}${e.holdDays!=null?` · ${e.holdDays}d`:''}${e.pnlPct!=null?` · ${e.pnlPct.toFixed(1)}%`:''}`).join('\n'))}</pre></details>`));
    // Trade log + weekly summary (optional display + German CSV download)
    if(b.tradeLog?.length || b.weeklyLog?.length) {
      const audit=b.audit||{};
      if(audit.ok!=null) ctx.el.append(note(audit.ok?`Audit: OK (${audit.checks?.trades??b.tradeLog?.length??0} Trades, P&L-Bridge realisiert ${money(audit.checks?.realized)} + unrealisiert ${money(audit.checks?.unrealized)} ≈ Δ ${money(audit.checks?.delta)})`:`Audit: ${audit.issues?.length||0} Probleme — ${(audit.issues||[]).slice(0,5).join('; ')}`));
      const bar=html('<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;align-items:center"></div>');
      if(b.tradeLog?.length){
        const btn=document.createElement('button');btn.type='button';btn.textContent=`CSV Trades (${b.tradeLog.length})`;
        btn.onclick=()=>downloadGermanCsv(`grokki-trades-${b.years||''}y-n${b.n||''}.csv`, b.tradeLog, TRADE_LOG_COLS);
        bar.append(btn);
      }
      if(b.weeklyLog?.length){
        const btn=document.createElement('button');btn.type='button';btn.textContent=`CSV Wochen (${b.weeklyLog.length})`;
        btn.onclick=()=>downloadGermanCsv(`grokki-weekly-${b.years||''}y-n${b.n||''}.csv`, b.weeklyLog, WEEKLY_LOG_COLS);
        bar.append(btn);
      }
      ctx.el.append(bar);
      if(b.tradeLog?.length){
        const pageSize=100;
        const det=html(`<details><summary>Trade-Protokoll anzeigen (${b.tradeLog.length} Ausführungen)</summary></details>`);
        const wrap=html('<div></div>');
        det.append(wrap);
        const renderPage=(page)=>{
          const start=page*pageSize;
          const slice=b.tradeLog.slice(start, start+pageSize);
          wrap.replaceChildren();
          const nav=html(`<div style="display:flex;gap:8px;align-items:center;margin:6px 0"></div>`);
          const info=document.createElement('span');info.textContent=`Zeile ${start+1}–${Math.min(start+pageSize,b.tradeLog.length)} / ${b.tradeLog.length}`;
          const prev=document.createElement('button');prev.type='button';prev.textContent='←';prev.disabled=page<=0;prev.onclick=()=>renderPage(page-1);
          const next=document.createElement('button');next.type='button';next.textContent='→';next.disabled=start+pageSize>=b.tradeLog.length;next.onclick=()=>renderPage(page+1);
          nav.append(prev,info,next);wrap.append(nav);
          const cols=[
            col('date','Datum'),col('signalDate','Signal'),
            ...(b.yearly||b.tradeLog.some(r=>r.activeConfig)?[col('period','Periode'),col('activeConfig','Config')]:[]),
            col('ticker','Ticker'),col('action','Aktion'),
            {key:'reason',label:'Grund',html:true,left:true,fmt:(v,r)=>r.trailing?`<span style="color:#ff7a45;font-weight:600">${esc(v||'')}</span>`:esc(v||'')},col('price','Preis',v=>fmt(v,4)),col('shares','Stücke',v=>fmt(v,4)),
            col('value','Wert',money),col('budget','Budget',money),col('cashAfter','Cash',money),
            col('pnl','P&L',money),col('holdDays','Tage',fmt0),col('rank','Rank',fmt0),
          ];
          wrap.append(table(slice,cols));
        };
        renderPage(0);
        ctx.el.append(det);
      }
      if(b.weeklyLog?.length){
        const det=html(`<details><summary>Wochen-Summary (${b.weeklyLog.length})</summary></details>`);
        const last=b.weeklyLog.slice(-52);
        det.append(note(last.length<b.weeklyLog.length?`Letzte ${last.length} Wochen angezeigt.`:'Alle Wochen.'),
          table(last,[
            col('week','Woche'),col('equity','Equity',money),col('cash','Cash',money),
            col('positions','Pos',fmt0),col('exits','Exits',fmt0),col('entries','Entries',fmt0),
            col('reducedEntries','Red.',fmt0),col('budget','Budget',money),col('kind','Art'),
          ]));
        ctx.el.append(det);
      }
    }
    if(b.equity?.length) {
      const host=html('<div data-rsl-bt-equity></div>');ctx.el.append(host);
      const series=[{title:`Strategy (Start ${money(s.startCapital??b.startCapital)})`,color:'#ffa028',data:b.equity}];
      if(b.benchmarkEquity?.length) series.push({title:`Benchmark ${d.benchmark?.ticker||''} B&H`,color:'#63a9ff',data:b.benchmarkEquity});
      const chart=equityChart(host,series,{storeKey:'rslbt'});ctx.onCleanup(()=>chart.remove());
    }
  }
}
async function rsl(ctx) {
  const q=keys(ctx.args);
  const argsU=ctx.args.map(a=>String(a).toUpperCase());
  if(argsU.includes('RESET')||argsU.includes('ZURÜCKSETZEN')||argsU.includes('ZURUECKSETZEN')){
    await resetToolSettings('RSL26');
    ctx.el.replaceChildren(note('RSL26-Einstellungen zurückgesetzt. Lade Defaults…'));
    ctx.go('RSL26 SPX');
    return;
  }
  const saved=await loadToolSettings('RSL26',{universe:'SPX',years:5,n:5,rrgExit:'RANK',rankTop:25,start:10000,size:'EQUITY',fractional:1,fee:1,maSkip:1,topX:25,confirmWeeks:1,rsExit:1,trail:20,trailLock:4,ranking:'RSL26',paramMode:'FEST',wfWindow:'expanding',wfRollYears:2,wfPeriod:'yearly',wfGrid:'coarse',wfTransition:'carry'});
  const universe=findUniArg(ctx.args)||(SCAN_UNIS.includes(canonUni(saved.universe))?canonUni(saved.universe):'SPX');
  const savedGlobal=applyUniOverlay(saved,universe);
  const rrgExit=(q.rrgexit||saved.rrgExit||'').toUpperCase();
  let action=null, symbol=null;
  const kaufAt=argsU.findIndex(a=>a==='KAUF'||a==='BUY');
  const verkAt=argsU.findIndex(a=>a==='VERKAUF'||a==='SELL');
  const editAt=argsU.findIndex(a=>a==='EDIT'||a==='BEARBEITEN');
  const delAt=argsU.findIndex(a=>a==='LOESCHEN'||a==='LÖSCHEN'||a==='DELETE');
  const reAt=argsU.findIndex(a=>a==='REOPEN');
  const watchOnly=['WATCH','WATCHLIST','POSITIONEN','HOLDINGS'].some(x=>argsU.includes(x));
  if(kaufAt>=0){action='BUY';symbol=ctx.args[kaufAt+1];}
  else if(verkAt>=0){action='SELL';symbol=ctx.args[verkAt+1];}
  else if(editAt>=0){action='EDIT';symbol=ctx.args[editAt+1];}
  else if(delAt>=0){action='DELETE';symbol=ctx.args[delAt+1];}
  else if(reAt>=0){action='REOPEN';symbol=ctx.args[reAt+1];}
  else if(watchOnly) action='WATCH';
  if(symbol&&symbol.includes('=')) symbol=null;
  if(['EDIT','DELETE','REOPEN'].includes(action)&&!symbol){
    ctx.el.replaceChildren(note('Symbol angeben, z. B. RSL26 EDIT AAPL BUYDATE=2026-10-01 PRICE=180 QTY=50 · RSL26 LOESCHEN AAPL'));
    return;
  }
  if((action==='BUY'||action==='SELL') && !symbol){
    ctx.el.replaceChildren(note(action==='BUY'
      ?'Kauf: Symbol angeben, z. B. RSL26 KAUF AAPL oder Button in der Rangliste.'
      :'Verkauf: Symbol angeben, z. B. RSL26 VERKAUF AAPL.'));
    return;
  }
  const maSkipOn=maSkipVal(q.maskip??saved.maSkip);
  const pick=(explicit, savedVal, fallback)=> explicit!=null&&explicit!=='' ? explicit : (savedVal!=null&&savedVal!==''?savedVal:fallback);
  const wantBt=q.backtest==='1'||argsU.includes('BACKTEST');
  const wantWf=['WALKFORWARD','YEARLY','TUNE'].includes(String(q.parammode||q.tune||'').toUpperCase())||!!q.startjob;
  if((wantBt||wantWf)&&!action){
    const v={
      universe, years:pick(q.years, saved.years, 5), n:pick(q.n, saved.n, 5),
      rrgExit:rrgExit||saved.rrgExit||'RANK', rankTop:pick(q.ranktop, saved.rankTop, 25),
      start:pick(q.start||q.startcapital, saved.start, 10000), size:pick(q.size, saved.size, 'EQUITY'),
      fractional:q.fractional??saved.fractional??1, fee:pick(q.fee, saved.fee, 1),
      confirmWeeks:pick(q.confirmweeks||q.cw, saved.confirmWeeks, 1),
      rsExit:pick(q.rsexit??q.rslExit, saved.rsExit, 1), maSkip:maSkipOn,
      trail:pick(q.trail, saved.trail, 20), trailLock:pick(q.traillock, saved.trailLock, 4),
      ranking:rankingVal(pick(q.ranking, saved.ranking, 'RSL26')),
      paramMode:wantWf?'WALKFORWARD':'FEST',
      wfWindow:pick(q.wfwindow||q.lookback, saved.wfWindow, 'expanding'),
      wfRollYears:pick(q.wfrollyears||q.rollyears, saved.wfRollYears, 2),
      wfPeriod:pick(q.wfperiod||q.retune, saved.wfPeriod, 'yearly'),
      wfGrid:pick(q.wfgrid||q.grid, saved.wfGrid, 'coarse'),
      wfTransition:pick(q.wftransition||q.transition, saved.wfTransition, 'carry'),
      wfTuneTrail:pick(q.wftunetrail, saved.wfTuneTrail, 0), wfTuneRanking:pick(q.wftuneranking, saved.wfTuneRanking, 0),
      jobId:q.jobid||undefined,
    };
    ctx.go(buildRslBt(universe,v, wantBt&&!wantWf?'RUN': (q.jobid?'RUN':'')));
    return;
  }
  const loading=action==='BUY'?'Speichere Kauf und lade Exit-Watch…'
    :action==='SELL'?'Speichere Verkauf und lade Exit-Watch…'
    :action==='EDIT'?'Speichere Änderung und lade Exit-Watch…'
    :action==='DELETE'?'Lösche Position und lade Exit-Watch…'
    :action==='WATCH'?'Lade Holdings (offene Positionen) und wöchentliche Exits…'
    :'Lade Rangliste, Holdings und Exit-Signale…';
  ctx.el.replaceChildren(note(loading));
  const params={
    universe,
    n:pick(q.n, saved.n, 5),
    backtest:0,
    rrgExit:rrgExit||undefined,
    rankTop:pick(q.ranktop, saved.rankTop, undefined),
    maSkip:maSkipOn?1:0,
    confirmWeeks:pick(q.confirmweeks||q.cw, saved.confirmWeeks, 1),
    rsExit:pick(q.rsexit??q.rslExit, saved.rsExit, 1),
    trail:trailNum(pick(q.trail, saved.trail, 20)),
    trailLock:lockNum(pick(q.traillock, saved.trailLock, 4)),
    ranking:rankingVal(pick(q.ranking, saved.ranking, 'RSL26')),
    topX:topXVal(pick(q.topx, saved.topX, 25)),
    paramMode:'FEST',
  };
  if(action) params.action=action;
  if(symbol) params.symbol=symbol;
  if(q.date) params.date=q.date;
  if(q.buydate) params.buyDate=q.buydate;
  if(q.selldate) params.sellDate=q.selldate;
  if(q.price) params.price=q.price;
  if(q.qty) params.qty=q.qty;
  if(q.note) params.note=q.note;
  if(q.id) params.id=q.id;
  if(q.posuniverse) params.posUniverse=q.posuniverse;
  if(q.newuniverse) params.newUniverse=q.newuniverse;
  if(q.sellprice) params.sellPrice=q.sellprice;
  if(action==='BUY'&&q.price) params.buyPrice=q.price;
  const d=await api.fn('rsl26',params);if(!ctx.live())return;
  const cur={
    universe,
    years:saved.years??5,
    n:d.n,
    rrgExit:d.rrgExit,
    rankTop:d.rankTop,
    start:saved.start??10000,
    size:saved.size||'EQUITY',
    fractional:rslFlag(saved.fractional??1),
    fee:saved.fee??1,
    confirmWeeks:d.confirmWeeks??1,
    rsExit:d.rsExit!==false,
    trail:trailNum(d.trail),
    trailLock:lockNum(d.trailLock),
    ranking:rankingVal(d.ranking),
    maSkip:maSkipOn,
    topX:params.topX,
    paramMode:'FEST',
    wfWindow:saved.wfWindow||'expanding',
    wfRollYears:saved.wfRollYears??2,
    wfPeriod:saved.wfPeriod||'yearly',
    wfGrid:saved.wfGrid||'coarse',
    wfTransition:saved.wfTransition||'carry',
    wfTuneTrail:saved.wfTuneTrail??0, wfTuneRanking:saved.wfTuneRanking??0,
  };
  saveToolSettings('RSL26',{universe, n:cur.n, rrgExit:cur.rrgExit, rankTop:cur.rankTop, confirmWeeks:cur.confirmWeeks, rsExit:cur.rsExit?1:0, trail:cur.trail, trailLock:cur.trailLock, ranking:cur.ranking, maSkip:cur.maSkip?1:0, topX:cur.topX, paramMode:'FEST', byUniverse:byUniversePatch(savedGlobal,universe,cur)});
  // Panel-Befehl ohne Parameter merken: Beim Neuladen gelten die gespeicherten Einstellungen (sonst überschreibt z. B. ein altes TOPX=25 im Befehl
  // das zuletzt gesetzte Top X) und Aktionen wie KAUF/VERKAUF werden nicht wiederholt.
  ctx.setCmd?.(`RSL26 ${universe}${action==='WATCH'?' WATCH':''}`);
  const profiles=await fetchProfiles();
  ctx.el.replaceChildren(sect(`Levy RSL26 · Scanner · ${d.universeLabel} · Rangliste ${rankingVal(d.ranking)} · RRGEXIT=${d.rrgExit} · RANKTOP=${d.rankTop}`));
  ctx.el.append(uniTabs(universe,u=>ctx.go(`RSL26 ${u}`))); // Reiter: Strategie-Werte je Universum (zuletzt benutzt bzw. Research-Voreinstellung)
  mountProfileBar(ctx.el,{current:{...cur,universe},profiles,onChange:({type,profile})=>{
    if(type==='load'&&profile){
      saveToolSettings('RSL26',{...profilePayload(profile),universe:profile.universe||universe,paramMode:'FEST'});
      ctx.go(buildRslScan(profile.universe||universe, profile));
    }
  }});
  // Formular in Gruppen: Entry (Einstieg) · Exit (Ausstieg). Top X (Rangzeilen) steht im Kopf der Rangliste.
  const form=html('<form class="rsl-form" style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;margin:8px 0"></form>');
  const grp=(title,tip)=>{const fs=document.createElement('fieldset');fs.className='rsl-grp';fs.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid #333;border-radius:4px;padding:4px 8px;margin:0';
    const lg=document.createElement('legend');lg.textContent=title;lg.style.cssText='padding:0 4px;font-weight:600';if(tip)lg.title=tip;fs.append(lg);form.append(fs);return fs;};
  const gEntry=grp('Entry (Einstieg)','Wer gekauft wird: Universum/Benchmark (Reiter oben), Rangliste und Anzahl Positionen N.');
  const gExit=grp('Exit (Ausstieg)','Wann verkauft wird: RRG-Exit-Modus mit Rank-Schutz, Bestätigungswochen, RS-Exit und Trailing-Stop.');
  const numIn=(host,name,label,value,{min,max,title}={})=>{
    const l=document.createElement('label');l.textContent=`${label} `;
    const input=document.createElement('input');input.name=name;input.value=value;input.style.width='65px';input.type='number';
    if(min!=null)input.min=min;if(max!=null)input.max=max;if(title){input.title=title;l.title=title;}
    l.append(input);host.append(l);return input;
  };
  numIn(gEntry,'n','Positionen (Ziel N)',d.n,{min:'1',max:'500',title:'Zielanzahl Portfolio-Positionen (Slots), Standard 5. Gekauft wird nur aus Rang 1…N der Rangliste, solange ein Slot frei ist. Hast du im aktiven Universum weniger Holdings als N, markiert die Rangliste die nächsten nicht gehaltenen Titel aus Rang 1…N als KAUF-Kandidat (nur Markierung). Wie viele Zeilen die Liste zeigt, stellst du im Kopf der Rangliste unter „Rangzeilen“ (Top X) ein. Im Backtest ist N ebenfalls die Positionszahl.'});
  rankingInput(gEntry, cur);
  const maLab=document.createElement('label');maLab.style.marginLeft='4px';
  maLab.title='Standard an: Titel mit M&A-Flag (laufender Deal: manuelle Liste + SEC EDGAR 180 Tage) werden beim Einstieg übersprungen und zählen nicht zum Kauf-Fenster Rang 1…N; das Fenster rückt auf den nächsten Rang ohne M&A vor. Gehaltene M&A-Titel bleiben gehalten (kein Zwangsverkauf). Die Rangliste zeigt M&A-Titel immer (markiert). Nur live: Für den Backtest gibt es keine historischen M&A-Daten.';
  maLab.innerHTML=`<input name="maSkip" type="checkbox" value="1"${cur.maSkip?' checked':''}> M&amp;A ignorieren`;
  gEntry.append(maLab);
  const uniNote=document.createElement('span');uniNote.className='hint';uniNote.style.margin='0';uniNote.textContent=`Universum/Benchmark: ${universe} (Reiter oben)`;gEntry.append(uniNote);
  const exitLabel=document.createElement('label');exitLabel.textContent='RRG-Exit-Modus ';
  exitLabel.title='OFF · DIRECT · DIRECT+RSL · CONFIRM · RANK — Details unter „Exit-Methoden“.';
  const exitSel=document.createElement('select');exitSel.name='rrgExit';
  for(const m of (d.rrgExitModes||['OFF','DIRECT','DIRECT+RSL','CONFIRM','RANK'])) {
    const o=document.createElement('option');o.value=m;o.textContent=m;if(m===d.rrgExit)o.selected=true;exitSel.append(o);
  }
  exitLabel.append(exitSel);gExit.append(exitLabel);
  numIn(gExit,'rankTop','Rank-Schutz bis Rang (RANKTOP)',d.rankTop,{min:'0',max:'500',title:'Rank-Schutz-Band: Solange der Rang ≤ RANKTOP ist, verhindert er RRG-Exits (RANK/CONFIRM). 0 = aus. RS-Exit und Trailing-Stop gelten trotzdem.'});
  numIn(gExit,'confirmWeeks','Bestätigung Wo. (nur CONFIRM)',d.confirmWeeks??1,{min:'1',max:'8',title:'Nur Modus CONFIRM: Wochen Bestätigung innerhalb des Rank-Schutzes, bevor verkauft wird.'});
  const rsLab=document.createElement('label');rsLab.style.marginLeft='4px';
  rsLab.title='Wöchentlicher Exit, wenn RSL26 der Aktie < RSL26 der Benchmark (unabhängig von RRG-Modus und Rank-Schutz).';
  rsLab.innerHTML=`<input name="rsExit" type="checkbox" value="1"${cur.rsExit?' checked':''}> RS-Exit (RSL26 &lt; Benchmark)`;
  gExit.append(rsLab);
  trailInputs(gExit, cur);
  const gAct=document.createElement('div');gAct.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;align-self:center';form.append(gAct);
  const button=document.createElement('button');button.type='submit';button.textContent='Aktualisieren';button.title='Rangliste und Holdings neu laden (ohne Backtest)';gAct.append(button);
  const btBtn=document.createElement('button');btBtn.type='button';btBtn.textContent='Zum Backtest';
  btBtn.title='Öffnet RSL-BT mit den aktuellen Parametern. Der Backtest startet erst dort auf Knopfdruck.';
  gAct.append(btBtn);
  const resetBtn=document.createElement('button');resetBtn.type='button';resetBtn.textContent='Zurücksetzen';
  resetBtn.title='Gespeicherte RSL26-Einstellungen löschen und Standard laden: Favorit RSL26 Trail20 (RANK N5 RT25 RS-Exit, TRAIL 20 %, Sperre 4 Wo.). Profile bleiben.';
  resetBtn.onclick=()=>ctx.go('RSL26 RESET');gAct.append(resetBtn);
  const readForm=()=>{
    const fd=Object.fromEntries(new FormData(form));
    return {...cur,n:fd.n,rrgExit:fd.rrgExit,rankTop:fd.rankTop,confirmWeeks:fd.confirmWeeks||1,rsExit:!!fd.rsExit,trail:trailNum(fd.trail),trailLock:lockNum(fd.trailLock),ranking:rankingVal(fd.ranking),maSkip:!!fd.maSkip,topX:topXVal(cur.topX),universe};
  };
  form.onsubmit=e=>{e.preventDefault();const next=readForm();
    saveToolSettings('RSL26',{universe,n:next.n,rrgExit:next.rrgExit,rankTop:next.rankTop,confirmWeeks:next.confirmWeeks,rsExit:next.rsExit?1:0,trail:next.trail,trailLock:next.trailLock,ranking:next.ranking,maSkip:next.maSkip?1:0,topX:next.topX,paramMode:'FEST'});
    ctx.go(buildRslScan(universe,next));
  };
  btBtn.onclick=()=>{
    const next=readForm();
    saveToolSettings('RSL26',{universe,n:next.n,rrgExit:next.rrgExit,rankTop:next.rankTop,confirmWeeks:next.confirmWeeks,rsExit:next.rsExit?1:0,trail:next.trail,trailLock:next.trailLock,ranking:next.ranking,maSkip:next.maSkip?1:0,topX:next.topX,paramMode:'FEST'});
    ctx.go(buildRslBt(universe,next));
  };
  ctx.el.append(form);
  ctx.el.append(exitInfoPanel(d.rules));
  if(d.bookAction) ctx.el.append(note(d.bookAction.ok?`✓ ${d.bookAction.message}`:`⚠ ${d.bookAction.message}`));
  ctx.el.append(collapsible('scan-info','ℹ Formel, Empfehlung & Bedienung',[note(d.recommendation||''),note(d.formula||''),note('Der Backtest startet nicht automatisch — dazu „Zum Backtest“ oder den Befehl RSLBT. Parameter (Entry, Exit, Rangzeilen Top X) als Profil speichern und hier wieder laden. Kaufdatum/Verkaufdatum: UTC-Kalendertag (YYYY-MM-DD). Live-Exits unabhängig vom Kaufdatum. RSL26 RESET setzt die Einstellungen zurück, Profile bleiben.')]));

  // Holdings + ranking Kauf/Verkauf: mutate the book and refresh this block only (no full RSL/backtest reload).
  // Holdings + ranking Kauf/Verkauf: mutate the book and refresh this block only (no full RSL/backtest reload).
  let paintRankRef=null; // Rangliste-Markierungen (im Depot / KAUF) nach Holdings-Änderung neu zeichnen
  const holdingsHost=html('<div data-holdings></div>');
  ctx.el.append(holdingsHost);
  const today=new Date().toISOString().slice(0,10);
  const curSym=c=>c==='EUR'?'€':c==='USD'?'$':c;
  const money2=(v,c)=>Number.isFinite(v)?`${v.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})} ${curSym(c)}`:'—';
  const pnlColor=v=>!Number.isFinite(v)?'inherit':v>0?'#2ecc71':v<0?'#ff5555':'inherit';
  const pnlCols=(kind)=>[
    ...(kind==='open'?[{key:'_px',label:'Kurs',fmt:(_,r)=>{const x=pnlRow(r);return x.price!=null?px(x.price):'—';}}]:[]),
    {key:'_pp',label:'P&L %',html:true,fmt:(_,r)=>{const x=pnlRow(r);return x.pnlPct!=null?`<span data-pnl-pct style="color:${pnlColor(x.pnlPct)}" title="Kursrendite ${kind==='open'?'letzter Schluss':'Verkaufskurs'} vs. Kaufkurs, ohne Gebühren">${x.pnlPct.toFixed(2).replace('.',',')} %</span>`:'—';}},
    {key:'_pa',label:kind==='open'?'P&L\nunreal.':'P&L\nreal.',html:true,fmt:(_,r)=>{const x=pnlRow(r);return x.pnlAbs!=null?`<span style="color:${pnlColor(x.pnlAbs)}" title="(Kurs − Kaufkurs) × Stück − ${x.fees} × Gebühr 1 ${curSym(x.cur)}${x.pnlAbsPct!=null?` · ${x.pnlAbsPct.toFixed(2).replace('.',',')} % auf Einsatz inkl. Gebühr`:''}">${money2(x.pnlAbs,x.cur)}</span>`:'<span class="hint" style="margin:0" title="Stückzahl oder Kaufkurs fehlt">—</span>';}},
    {key:'_d',label:'Tage',fmt:(_,r)=>{const x=pnlRow(r);return x.days!=null?String(x.days):'—';}},
  ];
  const pnlSummary=(list,label)=>{
    const t=pnlTotals(list);
    const parts=t.currencies.map(c=>{const v=t.byCur[c];return `${c}: realisiert ${money2(v.realized,c)} · unrealisiert ${money2(v.unrealized,c)} · gesamt ${money2(v.total,c)}`;});
    const el=html('<div class="rsl-pnl-sum" data-rsl-pnl-sum style="margin:4px 0;padding:4px 8px;border-left:3px solid #ffa028"></div>');
    const h=document.createElement('div');h.style.fontWeight='600';h.textContent=`P&L ${label}: ${parts.length?parts.join(' | '):'keine Daten'}`;el.append(h);
    const sub=document.createElement('div');sub.className='hint';sub.style.margin='2px 0';
    sub.textContent=`${t.open} offen · ${t.closed} geschlossen · Trefferquote ${t.winRate!=null?t.winRate.toFixed(0)+' %':'—'} (${t.wins}/${t.closed})${t.missing?` · ${t.missing} ohne Stück/Kaufkurs nicht in den Summen`:''} · Gebühr 1 je Order (Kauf + Verkauf; offen nur Kauf). Gemischte Währungen werden getrennt summiert.`;
    el.append(sub);return el;
  };
  const paintHoldings=(bundle, flash)=>{
    const posAll=bundle.positions||[];
    const soldAll=bundle.sold||[];
    // Universe-Filter: 'TAB' = aktiver Reiter (Standard), 'ALL' = alle, sonst SPX/NDX/DAX. Merkt sich die Wahl in localStorage.
    let fMode='TAB';try{fMode=localStorage.getItem(HOLD_FILTER_KEY)||'TAB';}catch{}
    const uniList=bundle.universeCounts?.list||SCAN_UNIS;
    if(fMode!=='TAB'&&fMode!=='ALL'&&!uniList.includes(fMode)) fMode='TAB';
    const fUni=fMode==='TAB'?universe:fMode;
    const uOf=p=>p.universe||'SPX';
    const match=p=>fUni==='ALL'||uOf(p)===fUni;
    const pos=posAll.filter(match);
    const soldF=soldAll.filter(match);
    const sold=soldF.slice(0,15);
    const cOpen=bundle.universeCounts?.open||{}, cClosed=bundle.universeCounts?.closed||{};
    for(const p of posAll) if(!bundle.universeCounts) cOpen[uOf(p)]=(cOpen[uOf(p)]||0)+1;
    for(const p of soldAll) if(!bundle.universeCounts) cClosed[uOf(p)]=(cClosed[uOf(p)]||0)+1;
    const sum=o=>Object.values(o).reduce((a,b)=>a+(+b||0),0);
    holdingsHost.replaceChildren();
    if(flash) holdingsHost.append(note(flash));
    const fBar=html('<div class="rsl-uni-filter" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0"></div>');
    const fLab=document.createElement('strong');fLab.textContent='Universum:';fBar.append(fLab);
    const opts=[['TAB',`Aktiver Reiter (${universe})`,cOpen[universe]||0,cClosed[universe]||0],['ALL','Alle',sum(cOpen),sum(cClosed)],...uniList.map(u=>[u,u==='NDX'?'Nasdaq 100':u==='SXXP'?'STOXX 600':'',cOpen[u]||0,cClosed[u]||0])];
    for(const [k,lab,o,c] of opts){
      const b=document.createElement('button');b.type='button';b.dataset.uniFilter=k;
      b.innerHTML=`${UNI_COLORS[k]?uniBadge(k,{small:true}):''}${esc(lab)} <span class="hint" style="margin:0">${o} offen · ${c} geschl.</span>`;
      b.title='Filtert offene und geschlossene Positionen nach Kauf-Universum (keine neue Abfrage).';
      if(k===fMode){b.style.outline='2px solid #ffa028';b.setAttribute('aria-pressed','true');}
      b.onclick=()=>{try{localStorage.setItem(HOLD_FILTER_KEY,k);}catch{}paintHoldings(bundle);};
      fBar.append(b);
    }
    holdingsHost.append(sect(`Holdings (offene Positionen) (${pos.length} von ${posAll.length} offen${fUni==='ALL'?'':` · Filter ${fUni}`})`),fBar,
      collapsible('holdings-info','ℹ Hinweise zu Holdings & Exit-Signalen',[...(trailNum(cur.trail)>0?[note(`Trailing-Stop ${trailNum(cur.trail)} %: Hoch = max(Kaufkurs, Wochenschlüsse seit Kaufdatum, inkl. laufender Woche). Exit-Hinweis, sobald der Wochenschluss ≤ Stop. Ein „gesperrt bis“ für verkaufte Titel wird nicht angezeigt: Der Verkaufsgrund ist im Buch nicht gespeichert. Nach einem Trailing-Verkauf ${lockNum(cur.trailLock)} Wochen nicht zurückkaufen.`)]:[]),
      note('Exit-Signale nur für offene Positionen, unabhängig vom Kaufdatum (aktuelle Kriterien: RRG-Schwächephase, Rank, Rank-Schutz, RS-Exit RSL26 < Bench, Trailing-Stop). „offen seit …“ = Beginn der noch aktiven Schwächephase nach Leading→Weakening/Lagging; entfällt bei Improving/Leading. RANK: Exit erst bei Rank > RANKTOP in der Schwächephase. Rank-Schutz verhindert nur RRG-Exits, nicht RS-Exit oder Trailing-Stop. Kaufdatum bleibt gespeichert/angezeigt, unterdrückt aber kein Exit. Spalte „Exit?“ steht vorn; Grund im Tooltip und unter „Exit-Hinweis“. Befehle: RSL26 KAUF/EDIT/VERKAUF/LOESCHEN/HOLDINGS')]));
    const addForm=html(`<form style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0">
    <input name="symbol" placeholder="Symbol" required style="width:80px">${uniSel(universe)}
    <label>Kauf <input name="buyDate" type="date" value="${today}"></label>
    <input name="buyPrice" placeholder="Preis" inputmode="decimal" style="width:70px"><input name="qty" placeholder="Stück" inputmode="decimal" title="Stückzahl, Bruchstücke erlaubt (z. B. 3,25 oder 3.25)" style="width:70px">
    <input name="note" placeholder="Notiz" style="width:140px"><button type="submit">Hinzufügen</button></form>`);
    addForm.onsubmit=e=>{e.preventDefault();post({action:'ADD',...Object.fromEntries(new FormData(addForm))});};
    holdingsHost.append(addForm);
    if(pos.length) {
      const posTable=table(pos,[
        {key:'exitSignal',label:'Exit?',html:true,fmt:(v,r)=>v?`<b style="color:#ff5555" title="${esc(r.exitHint||'Exit-Signal')}">JA</b>`:`<span title="${esc(r.exitHint||'kein Exit-Signal')}">—</span>`},
        col('symbol','Ticker'),uniCol,maCol,col('buyDate','Kauf-\ndatum'),
        col('buyPrice','Kauf-\nkurs',px),col('qty','Stück',fmtQty),...pnlCols('open'),col('note','Notiz'),
        col('rank','Rank',fmt0),col('rsl','RSL',v=>fmt(v,4)),col('benchRsl','Bench\nRSL',v=>fmt(v,4)),
        ...rrgCols(),
        col('exitHint','Exit-\nHinweis'),
        ...(trailNum(cur.trail)>0?[
          {...col('trailPeak','Hoch\n(Wo.-Schl.)',v=>fmt(v,2)),title:'Höchster Wochenschluss seit Kauf (mind. Kaufkurs), nicht Intraday-Hoch'},
          col('trailStop',`Stop\n−${trailNum(cur.trail)} %`,v=>fmt(v,2)),
          {key:'trailDistPct',label:'Fallhöhe\nbis Stop',html:true,fmt:(v,r)=>Number.isFinite(v)?`<span style="color:${r.trailHit?'#ff5555':(v<5?'#ffa028':'inherit')}" title="${esc(r.trailNote||`(Wochenschluss − Stop) / Wochenschluss · Wochenschluss ${fmt(r.trailClose,2)} · Hoch (Wochenschluss) am ${r.trailPeakDate||'—'}`)}">${v.toFixed(2)} %${r.trailNote?' *':''}</span>`:'—'},
        ]:[]),
        {key:'_v',label:'',html:true,left:true,fmt:(_,r)=>`<span class="ibtns">${iconBtn('data-h-go',`${r.symbol} GP`,'GP',`Chart: ${r.symbol} GP`,'txt')}${iconBtn('data-h-edit',r.id,'✎','Bearbeiten')}${iconBtn('data-h-sell',r.id,'⏏','Verkaufen (auch Teilverkauf)')}${iconBtn('data-h-del',r.id,'✕','Löschen','del')}</span>`},
      ]);
      const byId=new Map(pos.map(p=>[p.id,p]));
      const editBox=html('<div></div>');
      posTable.addEventListener('click',e=>{
        const go=e.target.closest('button[data-h-go]');
        if(go){e.stopImmediatePropagation();ctx.go(go.dataset.hGo);return;}
        const b=e.target.closest('button[data-h-edit],button[data-h-sell],button[data-h-del]');
        if(!b) return;
        e.stopImmediatePropagation();
        const id=b.dataset.hEdit||b.dataset.hSell||b.dataset.hDel;const p=byId.get(id);if(!p)return;
        if(b.dataset.hDel){ if(confirm(`${p.symbol} (${p.universe}) endgültig löschen? Keine Historie.`)) post({action:'DELETE',id}); return; }
        if(b.dataset.hSell){
          const f=html(`<form style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0"><b>Verkaufen ${esc(p.symbol)} (${esc(p.universe)})</b>
            <label>Datum <input name="sellDate" type="date" value="${today}"></label><input name="sellPrice" placeholder="Verkaufskurs" inputmode="decimal" style="width:90px">
            <input name="sellQty" placeholder="Stück (leer = alle${p.qty!=null?' '+fmtQty(p.qty):''})" inputmode="decimal" title="Teilverkauf: Stückzahl (Bruchstücke erlaubt, z. B. 1,5). Leer = ganze Position." style="width:150px">
            <button type="submit">Verkaufen</button><button type="button" data-cancel>Abbrechen</button></form>`);
          f.onsubmit=ev=>{ev.preventDefault();post({action:'SELL',id,...Object.fromEntries(new FormData(f))});};
          f.querySelector('[data-cancel]').onclick=()=>editBox.replaceChildren();
          editBox.replaceChildren(f);return;
        }
        const f=html(`<form style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0"><b>Bearbeiten ${esc(p.symbol)}</b>${uniSel(p.universe)}
          <label>Kauf <input name="buyDate" type="date" value="${esc(p.buyDate||today)}"></label>
          <input name="buyPrice" placeholder="Preis" inputmode="decimal" value="${p.buyPrice??''}" style="width:70px"><input name="qty" placeholder="Stück" inputmode="decimal" title="Bruchstücke erlaubt (Komma oder Punkt)" value="${p.qty!=null?String(p.qty).replace('.',','):''}" style="width:70px">
          <input name="note" placeholder="Notiz" value="${esc(p.note||'')}" style="width:140px"><button type="submit">Speichern</button><button type="button" data-cancel>Abbrechen</button></form>`);
        f.onsubmit=ev=>{ev.preventDefault();post({action:'EDIT',id,...Object.fromEntries(new FormData(f))});};
        f.querySelector('[data-cancel]').onclick=()=>editBox.replaceChildren();
        editBox.replaceChildren(f);
      },true);
      holdingsHost.append(posTable,editBox);
      if(trailNum(cur.trail)>0) holdingsHost.append(note(`ℹ Trailing-Stop: Referenz ist der höchste Wochenschluss seit Kauf (meist Freitagsschluss, laufende Woche mit letztem Schlusskurs, mindestens Kaufkurs), nicht das Handelshoch (Intraday-Hoch). Stop = Hoch × (1 − ${trailNum(cur.trail)} %). Ausgelöst, wenn ein Wochenschluss ≤ Stop; Ausführung Montag-Open, kein Intraday-Stop. „Fallhöhe bis Stop“ = wie viel % der Kurs bis zum Stop noch fallen darf (max. ${trailNum(cur.trail)} %, negativ = unter Stop). Wie im Backtest.`));
    } else {
      holdingsHost.append(note(posAll.length?`Keine offenen Positionen im Universum ${fUni} (insgesamt ${posAll.length} offen, Filter „Alle“ zeigt sie).`:'Noch keine offenen Positionen. Oben hinzufügen, Kauf-Button in der Rangliste oder RSL26 KAUF TICKER.'));
    }
    if(sold.length) {
      const soldTable=table(sold,[col('symbol','Ticker'),uniCol,col('buyDate','Kauf'),col('closedDate','Verkauf'),col('buyPrice','Kauf-\nkurs',px),col('sellPrice','Verkaufs-\nkurs',px),col('qty','Stück',fmtQty),...pnlCols('closed'),col('note','Notiz'),
        {key:'_c',label:'',html:true,left:true,fmt:(_,r)=>`<span class="ibtns">${iconBtn('data-c-re',r.id,'↺','Wieder öffnen')}${iconBtn('data-c-del',r.id,'✕','Löschen','del')}</span>`}]);
      soldTable.addEventListener('click',e=>{
        const b=e.target.closest('button[data-c-re],button[data-c-del]');if(!b)return;
        e.stopImmediatePropagation();
        if(b.dataset.cRe) return post({action:'REOPEN',id:b.dataset.cRe});
        if(confirm('Geschlossene Position endgültig löschen?')) post({action:'DELETE',id:b.dataset.cDel});
      },true);
      holdingsHost.append(collapsible('closed',`Geschlossene Positionen (${soldF.length}${fUni==='ALL'?'':` · ${fUni}`}${soldF.length>sold.length?`, neueste ${sold.length} gezeigt`:''})`,[soldTable]));
    }
    if(pos.length||soldF.length) holdingsHost.append(pnlSummary([...pos,...soldF],fUni==='ALL'?'Alle':fUni));
    holdingsHost.append(equitySection(fUni));
  };
  // Equity-Kurve der echten Trades vs. Benchmark: lädt erst beim Aufklappen (GET /api/fn/rslpnl, nur lesen).
  const equitySection=(fUni)=>{
    const benchOpts=['^GSPC','^NDX','^GDAXI','^STOXX'];
    const body=html('<div data-rsl-equity></div>');
    const det=collapsible('equity',`📈 Equity der Holdings vs. Benchmark (${fUni==='ALL'?'Alle':fUni})`,[body]);
    let loaded=false, chart=null;
    const load=async(bench)=>{
      body.replaceChildren(note('Lade Equity…'));
      try{
        const r=await api.fn('rslpnl',{filter:fUni,bench:bench||undefined});
        if(!ctx.live())return;
        body.replaceChildren();
        const bar=html('<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0"></div>');
        const lab=document.createElement('label');lab.textContent='Benchmark ';const sel=document.createElement('select');sel.name='eqBench';
        for(const b of benchOpts){const o=document.createElement('option');o.value=b;o.textContent=b;if(b===r.bench)o.selected=true;sel.append(o);}
        sel.onchange=()=>load(sel.value);lab.append(sel);bar.append(lab);
        const info=document.createElement('span');info.className='hint';info.style.margin='0';info.title=r.method||'';
        info.textContent=r.points?.length?`${r.trades} Trades · Währung ${r.reportCur} · P&L ${money2(r.pnl,r.reportCur)} vs. Benchmark ${money2(r.benchPnl,r.reportCur)} · ⓘ Methode (Tooltip)`:(r.note||'Keine Daten.');
        bar.append(info);body.append(bar);
        if(r.points?.length){
          const host=html('<div data-rsl-equity-chart></div>');body.append(host);
          chart?.remove();
          // Einzahlungen = flows: P&L-Balken ziehen neu eingezahltes Kapital ab (gleiche Logik wie r.pnl).
          chart=equityChart(host,[
            {title:`Holdings (${r.reportCur})`,color:'#ffa028',data:r.points.map(p=>({time:p.date,value:p.equity}))},
            {title:`${r.bench} gleiche Cashflows`,color:'#63a9ff',data:r.points.map(p=>({time:p.date,value:p.bench}))},
            {title:'Einzahlungen',color:'#777',flows:true,data:r.points.map(p=>({time:p.date,value:p.deposits}))},
          ],{storeKey:'rsl26-holdings',cur:curSym(r.reportCur)});
          ctx.onCleanup(()=>chart?.remove());
        }
        const notes=[r.method,r.fxNote,r.skipped?.length?`Nicht enthalten: ${r.skipped.map(x=>`${x.symbol} (${x.reason})`).join(', ')}`:null,r.errors?.length?`Datenfehler: ${r.errors.map(e=>e.ticker).join(', ')}`:null].filter(Boolean);
        for(const n of notes) body.append(note(n));
      }catch(e){body.replaceChildren(note(`Equity nicht verfügbar: ${e.message}`));}
    };
    det.addEventListener('toggle',()=>{if(det.open&&!loaded){loaded=true;load();}});
    if(det.open){loaded=true;queueMicrotask(()=>load());}
    return det;
  };
  const uniSel=(val)=>`<select name="universe">${SCAN_UNIS.map(u=>`<option value="${u}"${u===canonUni(val)?' selected':''}>${TAB_LABELS[u]}</option>`).join('')}</select>`;
  const refreshHoldings=async(msg)=>{
    try{
      const ranks=(d.rows||d.rowsAll||[]).map(r=>`${r.ticker}:${r.rank}`).filter(x=>!x.endsWith(':undefined')&&!x.endsWith(':null')).join(',');
      const fresh=await api.fn('rsl26',{universe,years:cur.years,n:cur.n,rrgExit:cur.rrgExit,rankTop:cur.rankTop,confirmWeeks:cur.confirmWeeks,rsExit:cur.rsExit?1:0,trail:cur.trail||undefined,trailLock:cur.trailLock,ranking:cur.ranking,maSkip:cur.maSkip?1:0,watch:1,bookOnly:1,ranks:ranks||undefined});
      if(!ctx.live())return;
      d.positions=fresh.positions;
      d.sold=fresh.sold;
      d.book=fresh.book;
      d.bookAction=fresh.bookAction;
      paintHoldings(fresh, msg||(fresh.bookAction?.message?`✓ ${fresh.bookAction.message}`:undefined));
      paintRankRef?.(fresh.positions);
    }catch(e){alert(`Aktualisieren fehlgeschlagen: ${e.message}`);}
  };
  const post=async(body)=>{
    try{
      const r=await api.post('/api/rsl-watch',body);
      if(!r.ok){alert(r.message||'Aktion fehlgeschlagen');return;}
      await refreshHoldings(`✓ ${r.message}`);
    }catch(e){alert(`Fehler: ${e.message}`);}
  };
  paintHoldings(d, rslFlash); rslFlash=null;

  // RSL ranking list: Top X rows (Rangzeilen im Kopf der Rangliste), entkoppelt von Positionen (Ziel N).
  // Markiert gehaltene Titel (im Depot) und — bei freien Slots — die nächsten Kauf-Kandidaten aus Rang 1…N (nur Markierung, kein Kauf).
  const rankHost=html('<div data-rsl-rank></div>');
  ctx.el.append(rankHost);
  let topX=topXVal(cur.topX);
  const allRows=d.rows||[];
  // EDGAR-M&A-Prüfung dieses Scans: Holdings ∪ Top max(N+10, X≤50). Größeres X wirkt auf die Prüfung erst beim nächsten Aktualisieren.
  const maChecked=Math.max((Number(d.n)||Number(cur.n)||5)+10, Math.min(topXVal(d.topX??cur.topX),50));
  let lastPositions=d.positions||[];
  const TOPX_PRESETS=[10,25,50,100];
  const topXControl=()=>{
    const wrap=document.createElement('span');wrap.dataset.rslTopx='1';
    wrap.style.cssText='display:inline-flex;gap:4px;align-items:center;margin-left:10px;font-weight:400;font-size:12px';
    const lab=document.createElement('label');lab.textContent='Rangzeilen ';
    lab.title='Top X: so viele Zeilen der Rangliste werden gezeigt (Standard 25, 1–500). Nur Darstellung, unabhängig von Positionen (Ziel N); ändert keine Signale. Gespeichert wie bisher (Einstellungen/Profile), Befehl TOPX=…';
    const inp=document.createElement('input');inp.type='number';inp.name='topX';inp.min='1';inp.max='500';inp.value=String(topX);inp.style.width='55px';inp.title=lab.title;
    lab.append(inp);wrap.append(lab);
    for(const v of TOPX_PRESETS){
      const b=document.createElement('button');b.type='button';b.textContent=String(v);b.dataset.topx=String(v);
      b.style.cssText=`padding:0 5px;font-size:11px;${v===topX?'font-weight:700;outline:1px solid var(--amber,#f90)':''}`;
      b.title=`${v} Zeilen zeigen`;b.onclick=()=>setTopX(v);wrap.append(b);
    }
    inp.onchange=()=>setTopX(inp.value);
    inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();setTopX(inp.value);}};
    if(Math.min(topX,50)>maChecked){const h=document.createElement('span');h.className='hint';h.style.margin='0';h.textContent=`M&A-Prüfung (EDGAR) bis Rang ${maChecked} – „Aktualisieren“ prüft bis Rang ${Math.min(topX,50)}`;wrap.append(h);}
    return wrap;
  };
  const setTopX=(v)=>{
    const nx=topXVal(v);
    if(nx===topX){paintRank(lastPositions);return;}
    topX=nx;cur.topX=nx;
    saveToolSettings('RSL26',{universe, n:cur.n, rrgExit:cur.rrgExit, rankTop:cur.rankTop, confirmWeeks:cur.confirmWeeks, rsExit:cur.rsExit?1:0, trail:cur.trail, trailLock:cur.trailLock, ranking:cur.ranking, maSkip:cur.maSkip?1:0, topX:nx, paramMode:'FEST', byUniverse:byUniversePatch(savedGlobal,universe,cur)});
    ctx.setCmd?.(`RSL26 ${universe}`);
    paintRank(lastPositions); // ohne neuen Scan: die Daten enthalten die ganze Rangliste
  };
  const rankOf=new Map((d.rowsAll||allRows).map(r=>[String(r.ticker).toUpperCase(),r.rank]));
  const MARK_HELD='background:rgba(61,123,217,.16)', MARK_BUY='background:rgba(46,204,113,.16)';
  const paintRank=(positions)=>{
    lastPositions=positions||[];
    const rankRows=allRows.slice(0, topX);
    const slots=buySlotCandidates(allRows, positions||[], {n:cur.n, universe, skipMa:!!cur.maSkip});
    const winLabel=slots.skipMa&&slots.skippedMa.size?`Rang 1…${slots.windowEnd??slots.n} ohne M&A (${[...slots.skippedMa].join(', ')} übersprungen)`:`Rang 1…${slots.n}`;
    const candBy=new Map(slots.candidates.map(c=>[String(c.ticker).toUpperCase(),c]));
    const slotTip=`Freier Slot: Holdings ${slots.held}/${slots.n} (${universe})`;
    const statusCol={key:'_st',label:'Status',html:true,left:true,fmt:(_,r)=>{
      const t=String(r.ticker).toUpperCase();
      if(slots.heldSymbols.has(t)) return `<span data-rsl-held="${esc(r.ticker)}" title="Im Depot (offene Position ${esc(universe)}) · Rang ${esc(r.rank)}" style="display:inline-block;padding:0 5px;border-radius:3px;font-size:11px;font-weight:700;background:#3d7bd9;color:#000">im Depot</span>`;
      const c=candBy.get(t);
      const other=slots.heldElsewhere.get(t);
      if(slots.skippedMa.has(t)) return `<span data-rsl-maskip="${esc(r.ticker)}" title="M&A ignorieren ist an: Dieser Titel hat ein M&A-Flag und zählt nicht zum Kauf-Fenster; der nächste Rang ohne M&A rückt nach." style="display:inline-block;padding:0 5px;border-radius:3px;font-size:10px;font-weight:600;color:#ff7a45;border:1px solid #ff7a45">übersprungen (M&amp;A)</span>${other?` <span style="font-size:10px;color:#9b59d0">Depot ${esc(other.join('/'))}</span>`:''}`;
      const otherTag=other?` <span title="Im Depot unter ${esc(other.join(', '))} (zählt nicht für ${esc(universe)}-Slots)" style="font-size:10px;color:#9b59d0;border:1px solid #9b59d0;border-radius:3px;padding:0 3px">Depot ${esc(other.join('/'))}</span>`:'';
      if(c) return `<span data-rsl-buy="${esc(r.ticker)}" title="${esc(`${slotTip} · Kauf-Kandidat für Slot ${c.slot} (nächster nicht gehaltener Titel aus ${winLabel}). Nur Markierung — Kauf manuell.${r.maFlag?' ⚠ M&A-Flag (M&A ignorieren ist aus) — prüfen.':''}`)}" style="display:inline-block;padding:0 5px;border-radius:3px;font-size:11px;font-weight:700;background:#2ecc71;color:#000">KAUF</span>${otherTag}`;
      return otherTag||'';
    }};
    const rankTable=table(rankRows,[
      col('rank','#',fmt0),col('ticker','Ticker'),statusCol,maCol,col('price',d.eu?'Close €':'Close',px),
      ...(d.eu?[{key:'priceLocal',label:'Lokal',html:true,fmt:(v,r)=>r.cur&&r.cur!=='EUR'&&Number.isFinite(v)?`<span title="Letzter Kurs in Handelswährung; Rangliste/Stops rechnen in EUR">${esc(px(v))} ${esc(r.cur)}</span>`:'<span class="hint" style="margin:0">EUR</span>'}]:[]),
      ...(rankingVal(d.ranking)==='MOM52_4'?[{key:'score',label:'Mom\n12-1 %',html:true,fmt:v=>Number.isFinite(v)?`<b title="Rendite Wochenschluss vor 52 Wo. → vor 4 Wo. (Rangkriterium)">${(100*v).toFixed(2).replace('.',',')} %</b>`:'—'}]
        :rankingVal(d.ranking)==='RSL39'?[{key:'score',label:'RSL39',html:true,fmt:v=>Number.isFinite(v)?`<b title="Wochenschluss / SMA 39 Wochenschlüsse (Rangkriterium)">${fmt(v,4)}</b>`:'—'}]:[]),
      col('rsl',rankingVal(d.ranking)==='RSL26'?'RSL\n(1 = Ø)':'RSL26\n(RS-Exit)',v=>fmt(v,4)),col('asOf','Stand'),
      {key:'_a',label:'',html:true,left:true,fmt:(_,r)=>`<span class="ibtns">${iconBtn('data-rsl-go',`${r.ticker} GP`,'GP',`Chart: ${r.ticker} GP`,'txt')}${iconBtn('data-rsl-go',`${r.ticker} DES`,'DES',`Beschreibung: ${r.ticker} DES`,'txt')}${iconBtn('data-rsl-kauf',r.ticker,'+','Kaufen (Position anlegen)')}${iconBtn('data-rsl-verk',r.ticker,'⏏','Verkaufen')}</span>`},
    ],{onRow:r=>ctx.go(`${r.ticker} GP`)});
    rankTable.querySelectorAll('tbody tr[data-i]').forEach(tr=>{
      const r=rankRows[+tr.dataset.i];if(!r)return;const t=String(r.ticker).toUpperCase();
      if(slots.heldSymbols.has(t)){tr.dataset.rslMark='held';tr.style.cssText+=';'+MARK_HELD;}
      else if(candBy.has(t)){tr.dataset.rslMark='buy';tr.style.cssText+=';'+MARK_BUY;}
    });
    rankTable.addEventListener('click',e=>{
      const go=e.target.closest('button[data-rsl-go]');
      if(go){e.stopImmediatePropagation();ctx.go(go.dataset.rslGo);return;}
      const k=e.target.closest('button[data-rsl-kauf]');
      const v=e.target.closest('button[data-rsl-verk]');
      if(!k&&!v) return;
      e.stopImmediatePropagation();
      const tk=(k||v).dataset.rslKauf||(k||v).dataset.rslVerk;
      const row=rankRows.find(r=>r.ticker===tk);
      if(k){
        post({action:'ADD',symbol:tk,universe,buyDate:today,buyPrice:row?.price});
        return;
      }
      if(!confirm(`Verkauf ${tk} (${universe})?`)) return;
      post({action:'SELL',symbol:tk,universe,sellDate:today,sellPrice:row?.price});
    },true);
    // Zusammenfassung: Holdings x / N – y freie Slots, Kandidaten, Rang der gehaltenen Titel
    const heldList=[...slots.heldSymbols].map(t=>{const rk=rankOf.get(t);return {t,rk:Number.isFinite(rk)?rk:null};})
      .sort((a,b)=>(a.rk??1e9)-(b.rk??1e9))
      .map(({t,rk})=>`${t} #${rk??'—'}${rk==null?' (nicht gerankt)':rk>topX?' (außerhalb Top '+topX+')':''}`);
    const cand=slots.candidates.map(c=>`${c.ticker} (#${c.rank})${c.rank>topX?' – außerhalb Top '+topX:''}`);
    const sum=html('<div class="rsl-slots" style="margin:4px 0;padding:4px 8px;border-left:3px solid #2ecc71"></div>');
    const head=document.createElement('div');head.dataset.rslSlots='1';head.style.fontWeight='600';
    head.textContent=`Holdings ${slots.held} / ${slots.n} – ${slots.free} freie${slots.free===1?'r':''} Slot${slots.free===1?'':'s'} (${universe})${slots.held>slots.n?' · mehr Holdings als Ziel N':''}`;
    sum.append(head);
    const lines=[];
    if(slots.free>0) lines.push(cand.length?`Kauf-Kandidaten (${winLabel}, nicht gehalten): ${cand.join(', ')}`:`Keine Kauf-Kandidaten in ${winLabel}.`);
    if(slots.shortfall>0&&cand.length) lines.push(`${slots.shortfall} Slot${slots.shortfall===1?'':'s'} bleibt frei: kein weiterer nicht gehaltener Titel in ${winLabel}.`);
    lines.push(heldList.length?`Im Depot (${universe}): ${heldList.join(', ')}`:`Keine offenen ${universe}-Positionen.`);
    lines.push(cur.maSkip?'M&A ignorieren: an (M&A-Titel zählen nicht zum Kauf-Fenster; gehaltene M&A-Titel bleiben).':'M&A ignorieren: aus (M&A-Titel zählen mit; nur Warnung).');
    lines.push('Nur Markierung, kein automatischer Kauf. Rückkauf-Sperre nach Trailing-Exit wird live nicht geprüft (Verkaufsgrund nicht im Buch) — nach Trailing-Verkauf selbst beachten.');
    for(const t of lines){const p=document.createElement('div');p.className='hint';p.style.margin='2px 0';p.textContent=t;sum.append(p);}
    const euNote=d.eu?note(`${universe==='SXXP'?'STOXX Europe 600: alle Kurse in EUR (Yahoo EURxxx=X, Tagesschluss). ':'HDAX: Kurse in EUR. '}Benchmark ${UNI_BENCH[universe]}. Datenreparatur: ${d.eu.repairs?.length?d.eu.repairs.map(r=>`${r.ticker} (${r.fixes}× ${r.types.join('/')})`).join(', '):'keine nötig'}.${universe==='SXXP'?' Hinweis: ZEG.L (+353 % 14.11.2023) und ABVX.PA (+510 % 23.07.2025) sind echte, ungeprüfte Kurssprünge — vor einem Kauf prüfen.':''} Kaufkurs im Buch in EUR eintragen (Kauf-Button übernimmt den EUR-Kurs).${d.coverage?.scanMs!=null?` Scan ${(d.coverage.scanMs/1000).toFixed(1)} s (${d.coverage.fromCache??'?'} von ${d.coverage.loaded} aus Cache).`:''}`):null;
    const rankHead=document.createElement('div');rankHead.dataset.rslRankHead='1';
    rankHead.style.cssText='display:flex;align-items:baseline;flex-wrap:wrap;gap:4px';
    rankHead.append(sect(`Rangliste (Top ${rankRows.length} von ${d.coverage?.ranked??allRows.length} · Ziel N=${slots.n})`),topXControl());
    rankHost.replaceChildren(rankHead,sum,rankTable,...(euNote?[euNote]:[]));
  };
  paintRankRef=paintRank;
  paintRank(d.positions);
  if(d.ma?.flagged?.length) ctx.el.append(note('M&A-Flag (Holdings ∪ Top max(N+10, X≤50)): '+d.ma.flagged.join(', ')));
  else if(d.ma) ctx.el.append(note('M&A: keine Treffer in Holdings ∪ Top max(N+10, X≤50) (manuell + EDGAR 180d).'));

  // Manual M&A list manager
  const maBox=html('<div style="margin:10px 0;padding:8px;border:1px solid #333;border-radius:4px"></div>');
  maBox.append(note('Manuelle Flags immer sichtbar. EDGAR prüft nur Holdings + Top max(N+10, X≤50) (US). data/ma-list.json sync via Seafile; Cache data/cache/ma-edgar.json lokal.'));
  const maForm=html(`<form style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0">
    <input name="symbol" placeholder="Ticker" required style="width:80px">
    <input name="note" placeholder="Notiz (optional)" style="width:180px">
    <label>Datum <input name="date" type="date" value="${today}"></label>
    <button type="submit">M&A markieren</button></form>`);
  const maReload=async(msg)=>{rslFlash=msg;ctx.go(buildRslScan(universe,cur));};
  maForm.onsubmit=async e=>{
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(maForm));
    try{
      const r=await api.fn('ma',{action:'ADD',symbol:fd.symbol,note:fd.note,date:fd.date});
      await maReload(`✓ ${r.message||'M&A markiert'}`);
    }catch(err){alert(err.message);}
  };
  maBox.append(maForm);
  let maList={entries:[]};
  try{maList=await api.fn('ma',{action:'LIST'});}catch(_){/* soft */}
  if(maList.entries?.length){
    const maTable=table(maList.entries,[
      col('symbol','Ticker'),col('note','Notiz'),col('date','Datum'),
      {key:'_x',label:'',html:true,left:true,fmt:(_,r)=>`<button type="button" data-ma-del="${esc(r.symbol)}">Entfernen</button>`},
    ]);
    maTable.addEventListener('click',async e=>{
      const b=e.target.closest('button[data-ma-del]'); if(!b) return;
      e.stopImmediatePropagation();
      try{
        const r=await api.fn('ma',{action:'REMOVE',symbol:b.dataset.maDel});
        await maReload(`✓ ${r.message||'entfernt'}`);
      }catch(err){alert(err.message);}
    },true);
    maBox.append(maTable);
  } else maBox.append(note('Keine manuellen M&A-Einträge.'));
  ctx.el.append(collapsible('ma-list',`M&A-Liste (manuell, ${maList.entries?.length||0} Einträge)`,[maBox]));

  diagnostics(ctx,d);
}
const colors={Leading:'#55c989',Weakening:'#e2ba43',Lagging:'#ef6a77',Improving:'#63a9ff'};
function scatter(rows) {
  const points=rows.flatMap(r=>r.trail||[r]), spanX=Math.max(2,...points.map(p=>Math.abs(p.ratio-100)))*1.15,spanY=Math.max(1,...points.map(p=>Math.abs(p.momentum-100)))*1.15;
  const x=v=>300+(v-100)/spanX*250,y=v=>170-(v-100)/spanY*125;
  const trails=rows.map(r=>`<polyline points="${(r.trail||[r]).map(p=>`${x(p.ratio)},${y(p.momentum)}`).join(' ')}" fill="none" stroke="${colors[r.quadrant]}" opacity=".7"/><circle cx="${x(r.ratio)}" cy="${y(r.momentum)}" r="4" fill="${colors[r.quadrant]}"/><text x="${x(r.ratio)+5}" y="${y(r.momentum)-5}" fill="${colors[r.quadrant]}" font-size="11">${esc(r.ticker)}</text>`).join('');
  return html(`<div><svg viewBox="0 0 600 340" role="img" aria-label="Relative rotation graph, SPX benchmark" style="width:100%;max-height:340px;background:#090909"><path d="M50 170H550 M300 30V300" stroke="#888"/><g fill="#aaa" font-size="12"><text x="55" y="30">Improving / Spring</text><text x="370" y="30">Leading / Summer</text><text x="55" y="310">Lagging / Winter</text><text x="365" y="310">Weakening / Autumn</text><text x="255" y="335">RS-Ratio →</text><text x="8" y="160" transform="rotate(-90 8 160)">RS-Momentum →</text><text x="303" y="184">100 / 100</text></g>${trails}</svg></div>`);
}
async function rrg(ctx) {
  const q=keys(ctx.args);
  const saved=await loadToolSettings('RRG',{sector:'',season:'ALL'});
  const sector=q.sector||ctx.args.find(a=>/^XL(K|C|Y|P|E|F|V|I|B|U|RE)$/.test(a))||saved.sector||'';
  const names=['LEADING','WEAKENING','LAGGING','IMPROVING','SUMMER','AUTUMN','WINTER','SPRING','ALL'];
  const season=(q.season||q.quadrant||ctx.args.find(a=>names.includes(a))||saved.season||'ALL').toUpperCase();
  saveToolSettings('RRG',{sector,season});
  const symbols=ctx.args.filter(a=>!a.includes('=') && a!==sector && !names.includes(a)).join(',');
  ctx.el.replaceChildren(note('Loading sector / stock rotation against SPX…'));
  const d=await api.fn('rrg',{sector,season,symbols});if(!ctx.live())return;
  const cmd=(s,f)=>`RRG ${symbols||s} ${f}`;
  ctx.el.replaceChildren(sect(`RRG · ${d.mode||'unavailable'} · benchmark SPX`));
  ctx.el.append(tabs(['ALL','LEADING','WEAKENING','LAGGING','IMPROVING'],season.toUpperCase(),f=>ctx.go(cmd(sector,f))));
  const select=document.createElement('select');select.innerHTML='<option value="">Sector overview</option>'+(d.sectors||[]).map(s=>`<option value="${esc(s.ticker)}">${esc(s.ticker+' · '+s.name)}</option>`).join('');select.value=sector;select.onchange=()=>ctx.go(`RRG ${select.value} ${season}`);ctx.el.append(select);
  ctx.el.append(note('Click a sector row to drill into representative stocks. Filter applies to sectors or stocks. Specific tickers: RRG AAPL MSFT IMPROVING.'),scatter(d.rows||[]),table(d.rows||[],[col('ticker','Ticker / sector'),maCol,col('name','Name'),col('ratio','RS-Ratio',fmt),col('momentum','RS-Momentum',fmt),col('quadrant','Quadrant'),col('season','Season'),col('time','As of')],{onRow:r=>ctx.go(d.mode==='sector ETF proxies'?`RRG ${r.ticker} ${season}`:`${r.ticker} GP`)}),note(d.formula||''));
  diagnostics(ctx,d);
}
async function mput(ctx) {
  const q=keys(ctx.args);
  const saved=await loadToolSettings('MPUT',{universe:'SPX',season:'W2S',ivrMax:30,otm:15});
  const universe=ctx.args.includes('NDX')?'NDX':(ctx.args.includes('SPX')?'SPX':(saved.universe||'SPX'));
  const season=(q.season||ctx.args.find(a=>['W2S','SPRING','OFF'].includes(String(a).toUpperCase()))||saved.season||'W2S').toUpperCase();
  ctx.el.replaceChildren(note('Scanne Kursböden, RRG-Saison und 6–12M-Puts (bis ~75 Sekunden)…'));
  const d=await api.fn('mput',{universe,ivrMax:q.ivrmax??saved.ivrMax??30,otm:q.otm??saved.otm??15,season,maxLoss:q.maxloss??saved.maxLoss??'',maxLossPct:q.maxlosspct??saved.maxLossPct??''});if(!ctx.live())return;
  const build=(u,v)=>`MPUT ${u} IVRMAX=${v.ivrMax} OTM=${v.otm} SEASON=${season}`+(v.maxLoss!==''&&v.maxLoss!=null?` MAXLOSS=${v.maxLoss}`:'')+(v.maxLossPct!==''&&v.maxLossPct!=null?` MAXLOSSPCT=${v.maxLossPct}`:'');
  const cur={ivrMax:d.ivrMax,otm:d.otm,maxLoss:d.maxLoss??'',maxLossPct:d.maxLossPct??''};
  ctx.el.replaceChildren(sect(`Married Put · ${d.universeLabel} · Saison ${d.season}`));
  ctx.el.append(tabs(['SPX','NDX'],universe,u=>ctx.go(build(u,cur))));
  saveToolSettings('MPUT',{universe,season,ivrMax:cur.ivrMax,otm:cur.otm,maxLoss:cur.maxLoss,maxLossPct:cur.maxLossPct});
  fields(ctx,cur,v=>build(universe,v));
  const ok=v=>v?'✓':'✗';
  ctx.el.append(note(d.heuristic),table(d.rows,[col('ticker','Ticker'),maCol,col('price','Aktie',px),
   col('avgDollar','Liquid: Ø $-Vol',big),col('drawdown','Gefallen % v. Hoch',pct),col('rebound','Boden: Rebound %',pct),col('bottomAge','Tief vor (Tg)',fmt0),
   col('rrgSeason','RRG Saison'),col('rrgTrail','RRG Pfad (8W)'),col('rsRatio','RS-Ratio',fmt),col('rsMomentum','RS-Mom',fmt),col('weeksSinceWinter','Wo. seit Winter',fmt0),
   col('ivrProxy','IVR PROXY',v=>fmt(v,1)),col('expiry','LP Verfall'),col('dte','DTE',fmt0),col('strike','LP Strike',px),col('otm','OTM %',pct),col('iv','IV %',pct),
   col('ask','Put Ask/sh',px),col('theta','Theta $/Tag',v=>fmt(v,4)),col('thetaPctPerDay','Theta %/Tag',v=>fmt(v,3)),col('oi','OI',big),
   col('divExpected','Div. bis Verfall /sh',px),col('divCount','# Div',fmt0),col('breakEven','Breakeven',px),
   col('maxLoss','Max Risiko $/sh',px),col('maxLoss100','Max Risiko /100',px),col('maxLossPct','Max Risiko %',pct),
   col('asOf','Quote-Zeit',v=>v?new Date(v).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})+' Europe/Berlin':'—')],{onRow:r=>ctx.go(`OMON ${r.ticker} ${r.expiry}`)}));
  ctx.el.append(note('Max Risiko/Aktie = Aktienkurs + Put-Ask − LP-Strike − erwartete Dividenden bis Verfall. Dividenden projiziert (letzte Dividende im Median-Rhythmus), nicht garantiert.'));
  if(d.excluded?.length) ctx.el.append(html(`<details><summary>${d.excluded.length} ausgeschlossen (Gründe)</summary><pre style="white-space:pre-wrap">${esc(d.excluded.map(e=>`${e.ticker}: ${e.reason}`).join('\n'))}</pre></details>`));
  diagnostics(ctx,{...d,excluded:[]});
}

async function paramHeatmap(ctx) {
  ctx.el.replaceChildren(note('Lade Parameter-Grid …'));
  let data;
  try {
    const r = await fetch('/data/backtests/grid-2026-11-09.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    ctx.el.replaceChildren(sect('Parameter-Heatmap'), note(`Grid-Daten nicht gefunden (${e.message}). Zuerst scripts/param-grid.mjs ausführen.`));
    return;
  }
  if (!ctx.live()) return;
  const cells = data.cells || [];
  const modes = [...new Set(cells.map(c => c.mode))];
  const metrics = [
    { id: 'mar', label: 'MAR' },
    { id: 'cagr', label: 'CAGR' },
    { id: 'maxDD', label: 'MaxDD' },
    { id: 'robustness', label: 'Robustness' },
    { id: 'sharpe', label: 'Sharpe' },
    { id: 'score', label: 'Score' },
  ];
  const savedH = await loadToolSettings('PARAMHEATMAP',{mode:'RANK',rs:1,metric:'mar'});
  let mode = modes.includes(savedH.mode) ? savedH.mode : (modes.includes('RANK') ? 'RANK' : modes[0]);
  let rs = savedH.rs!=null?+savedH.rs:1;
  let metric = savedH.metric||'mar';
  const ns = [...new Set(cells.map(c => c.n))].sort((a, b) => a - b);

  const root = html('<div></div>');
  const controls = html('<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0"></div>');
  const modeSel = document.createElement('select');
  for (const m of modes) { const o = document.createElement('option'); o.value = m; o.textContent = m; if (m === mode) o.selected = true; modeSel.append(o); }
  const rsSel = document.createElement('select');
  rsSel.innerHTML = '<option value="1">RS-Exit an</option><option value="0">RS-Exit aus</option>';
  const metSel = document.createElement('select');
  for (const m of metrics) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; if (m.id === metric) o.selected = true; metSel.append(o); }
  controls.append(html('<label>Mode </label>'), modeSel, html('<label>RS </label>'), rsSel, html('<label>Metric </label>'), metSel);
  const summary = html('<div></div>');
  const heatHost = html('<div style="overflow:auto"></div>');
  const legend = note('Farbe = Metric-Wert (grün besser außer MaxDD). ★ best raw MAR · ○ best robust plateau (im gewählten Slice). Survivorship-Bias; FEE=$1/Trade fix.');

  function colorFor(v, metricId, vmin, vmax) {
    if (v == null || !Number.isFinite(v)) return '#222';
    let t = (vmax > vmin) ? (v - vmin) / (vmax - vmin) : 0.5;
    if (metricId === 'maxDD') t = 1 - t; // less negative = better → flip
    t = Math.max(0, Math.min(1, t));
    const r = Math.round(220 * (1 - t) + 40 * t);
    const g = Math.round(60 + 160 * t);
    const b = Math.round(70 * (1 - t) + 80 * t);
    return `rgb(${r},${g},${b})`;
  }
  function render() {
    mode = modeSel.value; rs = +rsSel.value; metric = metSel.value;
    const subset = cells.filter(c => c.mode === mode && (c.rsExit ? 1 : 0) === rs);
    const rts = [...new Set(subset.map(c => c.rankTop))].sort((a, b) => a - b);
    const vals = subset.map(c => c[metric]).filter(Number.isFinite);
    const vmin = vals.length ? Math.min(...vals) : 0;
    const vmax = vals.length ? Math.max(...vals) : 1;
    // best CW per (n,rt)
    const pick = new Map();
    for (const c of subset) {
      const k = `${c.n}|${c.rankTop}`;
      const prev = pick.get(k);
      if (!prev || (c.mar ?? -999) > (prev.mar ?? -999)) pick.set(k, c);
    }
    const br = data.bestRaw, bb = data.bestRobust;
    let table = `<table style="border-collapse:collapse;font-size:12px"><thead><tr><th style="padding:4px">RT\\N</th>${ns.map(n => `<th style="padding:4px">${n}</th>`).join('')}</tr></thead><tbody>`;
    for (const rt of rts) {
      table += `<tr><th style="padding:4px;text-align:right">${rt}</th>`;
      for (const n of ns) {
        const c = pick.get(`${n}|${rt}`);
        const v = c ? c[metric] : null;
        const bg = colorFor(v, metric, vmin, vmax);
        let mark = '';
        if (br && br.mode === mode && (br.rsExit ? 1 : 0) === rs && br.n === n && br.rankTop === rt) mark += '★';
        if (bb && bb.mode === mode && (bb.rsExit ? 1 : 0) === rs && bb.n === n && bb.rankTop === rt) mark += '○';
        const tip = c ? `N=${c.n} RT=${c.rankTop} CW=${c.confirmWeeks} CAGR=${c.cagr?.toFixed?.(1)} MaxDD=${c.maxDD?.toFixed?.(1)} MAR=${c.mar?.toFixed?.(2)} Sharpe=${c.sharpe?.toFixed?.(2)} Rob=${c.robustness?.toFixed?.(2)}` : '';
        const txt = v == null ? '—' : (typeof v === 'number' ? v.toFixed(metric === 'cagr' || metric === 'maxDD' ? 1 : 2) : v);
        table += `<td title="${esc(tip)}" style="padding:6px 8px;background:${bg};color:#111;text-align:center;border:1px solid #333">${esc(txt)}${mark}</td>`;
      }
      table += '</tr>';
    }
    table += '</tbody></table>';
    heatHost.innerHTML = table;
    const top = (data.top5 || []).map((c, i) => `${i + 1}. ${c.mode} N=${c.n} RT=${c.rankTopLabel || c.rankTop} RS=${c.rsExit ? 1 : 0} CW=${c.confirmWeeks} · CAGR ${c.cagr?.toFixed?.(1)}% · MaxDD ${c.maxDD?.toFixed?.(1)}% · MAR ${c.mar?.toFixed?.(2)} · Sharpe ${c.sharpe?.toFixed?.(2)} · Rob ${c.robustness?.toFixed?.(2)}`).join('\n');
    summary.replaceChildren(
      note(`Best raw MAR: ${br ? `${br.mode} N=${br.n} RT=${br.rankTop} RS=${br.rsExit ? 1 : 0} CW=${br.confirmWeeks} · MAR ${br.mar?.toFixed?.(2)}` : '—'}`),
      note(`Best robust plateau: ${bb ? `${bb.mode} N=${bb.n} RT=${bb.rankTop} RS=${bb.rsExit ? 1 : 0} CW=${bb.confirmWeeks} · Smooth ${bb.smoothScore?.toFixed?.(2)} Rob ${bb.robustness?.toFixed?.(2)}` : '—'}`),
      html(`<details><summary>Top 5 (Score)</summary><pre style="white-space:pre-wrap">${esc(top)}</pre></details>`),
      note(`Cells: ${cells.length} · FEE=${data.meta?.fee ?? 1} · ${data.meta?.note || ''}`),
    );
  }
  modeSel.onchange = rsSel.onchange = metSel.onchange = ()=>{ saveToolSettings('PARAMHEATMAP',{mode:modeSel.value,rs:+rsSel.value,metric:metSel.value}); render(); };
  rsSel.value=String(rs); metSel.value=metric;
  ctx.el.replaceChildren(sect('Parameter-Heatmap · RSL26 Grid'), controls, summary, heatHost, legend,
    note('PNG-Heatmaps: data/backtests/heatmaps-2026-11-09/ (Overview: overview-MAR.png)'),
    note('Rank-Schutz: geschützt nur solange Rank ≤ RANKTOP; z.B. Kauf Rank 10 bei RT=10 → Exit sobald Rank 11+ und Schwächephase. Exit-Details: RSL26 Info-Feld.'));
  root.append(); // noop
  render();
}


async function rslbt(ctx) {
  const q=keys(ctx.args);
  const argsU=ctx.args.map(a=>String(a).toUpperCase());
  if(argsU.includes('RESET')||argsU.includes('ZURÜCKSETZEN')||argsU.includes('ZURUECKSETZEN')){
    await resetToolSettings('RSL26');
    ctx.el.replaceChildren(note('RSL-BT-Einstellungen zurückgesetzt. Profile bleiben erhalten.'));
    ctx.go('RSLBT SPX');
    return;
  }
  const saved=await loadToolSettings('RSL26',{universe:'SPX',years:5,n:5,rrgExit:'RANK',rankTop:25,start:10000,size:'EQUITY',fractional:1,fee:1,maSkip:1,confirmWeeks:1,rsExit:1,trail:20,trailLock:4,ranking:'RSL26',paramMode:'FEST',wfWindow:'expanding',wfRollYears:2,wfPeriod:'yearly',wfGrid:'coarse',wfTransition:'carry'});
  const universe=findUniArg(ctx.args)||(SCAN_UNIS.includes(canonUni(saved.universe))?canonUni(saved.universe):'SPX');
  const savedGlobal=applyUniOverlay(saved,universe);
  const maSkipOn=maSkipVal(q.maskip??saved.maSkip);
  const pick=(explicit, savedVal, fallback)=> explicit!=null&&explicit!=='' ? explicit : (savedVal!=null&&savedVal!==''?savedVal:fallback);
  let cur={
    universe,
    years:pick(q.years, saved.years, 5),
    n:pick(q.n, saved.n, 5),
    rrgExit:(q.rrgexit||saved.rrgExit||'RANK').toUpperCase(),
    rankTop:pick(q.ranktop, saved.rankTop, 25),
    start:pick(q.start||q.startcapital, saved.start, 10000),
    size:pick(q.size, saved.size, 'EQUITY'),
    fractional:rslFlag(q.fractional??saved.fractional??1),
    fee:pick(q.fee, saved.fee, 1),
    confirmWeeks:pick(q.confirmweeks||q.cw, saved.confirmWeeks, 1),
    rsExit:rslFlag(q.rsexit??q.rslExit??saved.rsExit??1),
    trail:trailNum(pick(q.trail, saved.trail, 20)),
    trailLock:lockNum(pick(q.traillock, saved.trailLock, 4)),
    ranking:rankingVal(pick(q.ranking, saved.ranking, 'RSL26')),
    maSkip:maSkipOn,
    topX:topXVal(saved.topX),
    paramMode:'FEST',
    wfWindow:pick(q.wfwindow||q.lookback, saved.wfWindow, 'expanding'),
    wfRollYears:pick(q.wfrollyears||q.rollyears, saved.wfRollYears, 2),
    wfPeriod:pick(q.wfperiod||q.retune, saved.wfPeriod, 'yearly'),
    wfGrid:pick(q.wfgrid||q.grid, saved.wfGrid, 'coarse'),
    wfTransition:pick(q.wftransition||q.transition, saved.wfTransition, 'carry'),
    wfTuneTrail:rslFlag(pick(q.wftunetrail, saved.wfTuneTrail, 0))?1:0,
    wfTuneRanking:rslFlag(pick(q.wftuneranking, saved.wfTuneRanking, 0))?1:0,
    jobId:q.jobid||undefined,
  };
  const run=q.run==='1'||q.backtest==='1'||argsU.includes('RUN')||argsU.includes('START')||argsU.includes('GO');
  const wantWf=['WALKFORWARD','YEARLY','TUNE'].includes(String(q.parammode||q.tune||'').toUpperCase())||!!q.startjob;
  const profiles=await fetchProfiles();
  const labels={SPX:'S&P 500',NDX:'Nasdaq 100',HDAX:'HDAX',SXXP:'STOXX Europe 600 (EUR)'};

  const paintChrome=(d)=>{
    const modes=d?.rrgExitModes||['OFF','DIRECT','DIRECT+RSL','CONFIRM','RANK'];
    const src=d||cur;
    const titleU=d?.universeLabel||labels[universe]||universe;
    ctx.el.append(sect(`Levy RSL26 · Backtest · ${titleU} · Rangliste ${rankingVal(src.ranking||cur.ranking)} · RRGEXIT=${src.rrgExit||cur.rrgExit} · N=${src.n||cur.n}`));
    ctx.el.append(uniTabs(universe,u=>ctx.go(`RSLBT ${u}`)));
    mountProfileBar(ctx.el,{current:{...cur,universe},profiles,onChange:({type,profile})=>{
      if(type==='load'&&profile){
        saveToolSettings('RSL26',{...profilePayload(profile),universe:profile.universe||universe,paramMode:'FEST'});
        ctx.go(buildRslBt(profile.universe||universe, {...cur,...profile}));
      }
    }});
    const form=html('<form style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0"></form>');
    const fieldLabels={years:'Years',n:'Top-N',rankTop:'RANKTOP',start:'Start €',fee:'Gebühr pro Trade',confirmWeeks:'confirmWeeks'};
    const vals={years:src.years??cur.years,n:src.n??cur.n,rankTop:src.rankTop??cur.rankTop,start:src.startCapital??cur.start,fee:src.fee??cur.fee,confirmWeeks:src.confirmWeeks??cur.confirmWeeks};
    for(const [name,value] of Object.entries(vals)) {
      const label=document.createElement('label');label.textContent=`${fieldLabels[name]||name} `;
      const input=document.createElement('input');input.name=name;input.value=value;input.style.width=name==='start'?'90px':'65px';input.type='number';
      if(name==='n'){input.min='1';input.max='500';input.title='Anzahl Positionen (Top-N)';}
      if(name==='rankTop'){input.min='0';input.max='500';input.title='Rank-Schutz-Band (0=aus).';}
      if(name==='start'){input.min='100';input.step='100';input.title='Backtest-Startkapital (Default 10000)';}
      if(name==='fee'){input.min='0';input.step='0.01';input.style.width='70px';input.title='Absolute Gebühr je BUY und SELL in $ (Default 1)';}
      if(name==='confirmWeeks'){input.min='1';input.max='8';input.title='Nur CONFIRM: Bestätigungswochen innerhalb Rank-Schutz';}
      if(name==='years'){input.min='1';input.max='15';input.title='Backtest-Horizont in Jahren';}
      label.append(input);form.append(label);
    }
    const exitLabel=document.createElement('label');exitLabel.textContent='RRGEXIT ';
    const exitSel=document.createElement('select');exitSel.name='rrgExit';
    for(const m of modes) {
      const o=document.createElement('option');o.value=m;o.textContent=m;if(m===(src.rrgExit||cur.rrgExit))o.selected=true;exitSel.append(o);
    }
    exitLabel.append(exitSel);form.append(exitLabel);
    const hideLab=document.createElement('label');hideLab.style.marginLeft='4px';
    hideLab.title='Wirkt nur im Scanner (live): Für den Backtest gibt es keine historischen M&A-Daten, er kauft wie bisher alle Ränge. Die Einstellung wird mit Profil und Universum gespeichert.';
    hideLab.innerHTML=`<input name="maSkip" type="checkbox" value="1"${cur.maSkip?' checked':''}> M&A ignorieren (nur Scanner)`;
    form.append(hideLab);
    const fracLab=document.createElement('label');fracLab.style.marginLeft='4px';
    fracLab.innerHTML=`<input name="fractional" type="checkbox" value="1"${cur.fractional?' checked':''}> Bruchstücke erlauben`;
    form.append(fracLab);
    const rsLab=document.createElement('label');rsLab.style.marginLeft='4px';
    rsLab.innerHTML=`<input name="rsExit" type="checkbox" value="1"${cur.rsExit?' checked':''}> RSEXIT (RSL&lt;Bench)`;
    form.append(rsLab);
    trailInputs(form, {trail:src.trail??cur.trail, trailLock:src.trailLock??cur.trailLock});
    rankingInput(form, {ranking:src.ranking??cur.ranking});
    const sizeLab=document.createElement('label');sizeLab.textContent=' Budget ';
    const sizeSel=document.createElement('select');sizeSel.name='size';
    for(const [val,lab] of [['EQUITY','Kapital=Equity/n'],['START','Kapital=Start/n']]){
      const o=document.createElement('option');o.value=val;o.textContent=lab;if(val===(cur.size||'EQUITY'))o.selected=true;sizeSel.append(o);
    }
    sizeLab.append(sizeSel);form.append(sizeLab);
    const wfWrap=html('<span style="display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap"></span>');
    const winLab=document.createElement('label');winLab.textContent='WF-Fenster ';
    const winSel=document.createElement('select');winSel.name='wfWindow';
    for(const [val,lab] of [['expanding','expanding'],['rolling','rolling N-Jahre']]){
      const o=document.createElement('option');o.value=val;o.textContent=lab;if(val===(cur.wfWindow||'expanding'))o.selected=true;winSel.append(o);
    }
    winLab.append(winSel);wfWrap.append(winLab);
    const rollLab=document.createElement('label');rollLab.textContent='Roll-Jahre ';
    const rollIn=document.createElement('input');rollIn.name='wfRollYears';rollIn.type='number';rollIn.min='1';rollIn.max='10';rollIn.value=cur.wfRollYears??2;rollIn.style.width='50px';
    rollLab.append(rollIn);wfWrap.append(rollLab);
    const perLab=document.createElement('label');perLab.textContent='Retune ';
    const perSel=document.createElement('select');perSel.name='wfPeriod';
    for(const [val,lab] of [['yearly','jährlich'],['semiannual','halbjährlich'],['quarterly','vierteljährlich']]){
      const o=document.createElement('option');o.value=val;o.textContent=lab;if(val===(cur.wfPeriod||'yearly'))o.selected=true;perSel.append(o);
    }
    perLab.append(perSel);wfWrap.append(perLab);
    const gridLab=document.createElement('label');gridLab.textContent='Grid ';
    const gridSel=document.createElement('select');gridSel.name='wfGrid';
    for(const val of ['coarse','medium','full']){
      const o=document.createElement('option');o.value=val;o.textContent=val;if(val===(cur.wfGrid||'coarse'))o.selected=true;gridSel.append(o);
    }
    gridLab.append(gridSel);wfWrap.append(gridLab);
    const trLab=document.createElement('label');trLab.textContent='Übergang ';
    const trSel=document.createElement('select');trSel.name='wfTransition';
    for(const [val,lab] of [['carry','Carry (Holdings)'],['reset','Reset (Cash)']]){
      const o=document.createElement('option');o.value=val;o.textContent=lab;if(val===(cur.wfTransition||'carry'))o.selected=true;trSel.append(o);
    }
    trLab.append(trSel);wfWrap.append(trLab);
    const ttLab=document.createElement('label');ttLab.title='Walk-Forward: TRAIL 0 und 20 % als zusätzliche Grid-Dimension mittunen. Aus = fester TRAIL/Sperre aus dem Formular in jedem Tune- und Handelslauf.';
    ttLab.innerHTML=`<input name="wfTuneTrail" type="checkbox" value="1"${rslFlag(cur.wfTuneTrail??0)?' checked':''}> TRAIL mittunen (0/20)`;wfWrap.append(ttLab);
    const trkLab=document.createElement('label');trkLab.title='Walk-Forward: Rangliste RSL26/RSL39/MOM52_4 als Grid-Dimension mittunen. Aus = feste Rangliste aus dem Formular.';
    trkLab.innerHTML=`<input name="wfTuneRanking" type="checkbox" value="1"${rslFlag(cur.wfTuneRanking??0)?' checked':''}> Rangliste mittunen`;wfWrap.append(trkLab);
    form.append(wfWrap);
    const readForm=()=>{
      const fd=Object.fromEntries(new FormData(form));
      return {
        ...cur, years:fd.years, n:fd.n, rrgExit:fd.rrgExit, rankTop:fd.rankTop,
        start:fd.start||10000, size:fd.size||'EQUITY', fractional:!!fd.fractional,
        fee:fd.fee??1, confirmWeeks:fd.confirmWeeks||1, rsExit:!!fd.rsExit, maSkip:!!fd.maSkip,
        trail:trailNum(fd.trail), trailLock:lockNum(fd.trailLock), ranking:rankingVal(fd.ranking),
        paramMode:'FEST', wfWindow:fd.wfWindow||'expanding', wfRollYears:Number(fd.wfRollYears)||2,
        wfPeriod:fd.wfPeriod||'yearly', wfGrid:fd.wfGrid||'coarse', wfTransition:fd.wfTransition||'carry',
        wfTuneTrail:fd.wfTuneTrail?1:0, wfTuneRanking:fd.wfTuneRanking?1:0,
        universe,
      };
    };
    const persist=(next)=>saveToolSettings('RSL26',{universe, years:next.years, n:next.n, rrgExit:next.rrgExit, rankTop:next.rankTop, start:next.start, size:next.size, fractional:next.fractional?1:0, fee:next.fee, confirmWeeks:next.confirmWeeks, rsExit:next.rsExit?1:0, trail:next.trail, trailLock:next.trailLock, ranking:next.ranking, maSkip:next.maSkip?1:0, paramMode:'FEST', wfWindow:next.wfWindow, wfRollYears:next.wfRollYears, wfPeriod:next.wfPeriod, wfGrid:next.wfGrid, wfTransition:next.wfTransition, wfTuneTrail:next.wfTuneTrail?1:0, wfTuneRanking:next.wfTuneRanking?1:0, topX:topXVal(next.topX??cur.topX), byUniverse:byUniversePatch(savedGlobal,universe,next)});
    const runBtn=document.createElement('button');runBtn.type='submit';runBtn.textContent='Backtest starten';runBtn.title='Startet den Backtest mit den Einstellungen oben';form.append(runBtn);
    const tuneBtn=document.createElement('button');tuneBtn.type='button';tuneBtn.textContent='Parameter neu bestimmen';
    tuneBtn.title='Startet einen Walk-Forward-Backtest. Die Formularansicht bleibt stehen.';
    form.append(tuneBtn);
    const scanBtn=document.createElement('button');scanBtn.type='button';scanBtn.textContent='Im Scanner verwenden';
    scanBtn.title='Übernimmt Liste, Top-N und Exit-Strategie in den RSL-Scanner';
    scanBtn.onclick=()=>{const next=readForm();persist(next);ctx.go(buildRslScan(universe,next));};
    form.append(scanBtn);
    const resetBtn=document.createElement('button');resetBtn.type='button';resetBtn.textContent='Zurücksetzen';
    resetBtn.title='Einstellungen zurücksetzen (Profile bleiben)';
    resetBtn.onclick=()=>ctx.go('RSLBT RESET');form.append(resetBtn);
    form.onsubmit=e=>{e.preventDefault();const next=readForm();persist(next);ctx.go(buildRslBt(universe,next,'RUN'));};
    ctx.el.append(form);
    if(d?.rules) ctx.el.append(exitInfoPanel(d.rules));
    ctx.el.append(note('Der Backtest läuft nur auf Knopfdruck. Fertige Parameter als Profil speichern und im Scanner laden, oder direkt „Im Scanner verwenden“.'));
    return {form, readForm, persist, tuneBtn};
  };

  if(!run && !wantWf){
    ctx.el.replaceChildren();
    paintChrome(null);
    ctx.setCmd?.(`RSLBT ${universe}`); // ohne Parameter: Neuladen liest die gespeicherten Einstellungen
    return;
  }

  ctx.el.replaceChildren(note('Berechne Backtest (kann bis ~45 Sekunden dauern)…'));
  const params={
    universe, years:cur.years, n:cur.n, backtest:1, rrgExit:cur.rrgExit, rankTop:cur.rankTop,
    maSkip:cur.maSkip?1:0, start:cur.start, fractional:cur.fractional?1:0, size:cur.size,
    fee:cur.fee, confirmWeeks:cur.confirmWeeks, rsExit:cur.rsExit?1:0,
    trail:cur.trail||undefined, trailLock:cur.trailLock, ranking:cur.ranking,
    paramMode:wantWf?'WALKFORWARD':'FEST',
    wfWindow:cur.wfWindow, wfRollYears:cur.wfRollYears, wfPeriod:cur.wfPeriod,
    wfGrid:cur.wfGrid, wfTransition:cur.wfTransition, jobId:cur.jobId, startJob:q.startjob||undefined,
    wfTuneTrail:cur.wfTuneTrail?1:undefined, wfTuneRanking:cur.wfTuneRanking?1:undefined,
  };
  const d=await api.fn('rsl26',params);if(!ctx.live())return;
  cur={
    ...cur, years:d.years??cur.years, n:d.n, rrgExit:d.rrgExit, rankTop:d.rankTop,
    start:d.startCapital??cur.start, size:d.sizeMode||cur.size, fractional:d.fractional!==false,
    fee:d.fee??cur.fee, confirmWeeks:d.confirmWeeks??cur.confirmWeeks, rsExit:d.rsExit!==false,
    trail:trailNum(d.trail??cur.trail), trailLock:lockNum(d.trailLock??cur.trailLock), ranking:rankingVal(d.ranking??cur.ranking),
    maSkip:!!cur.maSkip, jobId:d.evalJob?.id||d.backtest?.jobId||cur.jobId,
  };
  saveToolSettings('RSL26',{universe, years:cur.years, n:cur.n, rrgExit:cur.rrgExit, rankTop:cur.rankTop, start:cur.start, size:cur.size, fractional:cur.fractional?1:0, fee:cur.fee, confirmWeeks:cur.confirmWeeks, rsExit:cur.rsExit?1:0, trail:cur.trail, trailLock:cur.trailLock, ranking:cur.ranking, maSkip:cur.maSkip?1:0, paramMode:'FEST', wfWindow:cur.wfWindow, wfRollYears:cur.wfRollYears, wfPeriod:cur.wfPeriod, wfGrid:cur.wfGrid, wfTransition:cur.wfTransition, wfTuneTrail:cur.wfTuneTrail?1:0, wfTuneRanking:cur.wfTuneRanking?1:0, topX:topXVal(cur.topX), byUniverse:byUniversePatch(savedGlobal,universe,cur)});
  if(wantWf) ctx.setCmd?.(buildRslBt(universe,{...cur,paramMode:'FEST',jobId:undefined}));
  ctx.el.replaceChildren();
  const ui=paintChrome(d);
  const wfHost=html('<div></div>');
  ctx.el.append(wfHost);
  const showWfJob=(job)=>{
    if(!job?.id)return;
    const box=wfProgressBox(job);
    wfHost.replaceChildren(box);
    if(job.status==='running'||job.status==='pending'||!job.status){
      pollWalkForwardJob(ctx,box,job.id,(done)=>{
        if(!ctx.live())return;
        if(done.status==='done'){
          box.update?.(done);
          const apply=document.createElement('button');apply.type='button';apply.textContent='Ergebnis anzeigen';
          apply.onclick=()=>ctx.go(buildRslBt(universe,{...cur,jobId:done.id,paramMode:'WALKFORWARD'},'RUN'));
          wfHost.append(apply);
        }
      });
    }
  };
  if(d.evalJob?.id) showWfJob(d.evalJob);
  else if(d.backtest?.pending && d.backtest?.jobId) showWfJob({id:d.backtest.jobId,status:'running',progress:d.backtest.progress||0,message:d.backtest.message});
  ui.tuneBtn.onclick=async()=>{
    ui.tuneBtn.disabled=true;
    try{
      const next=ui.readForm();
      ui.persist(next);
      const years=Number(next.years)||5;
      const nowY=new Date().getUTCFullYear();
      const firstYear=nowY-years+1;
      const r=await api.post('/api/rsl-eval/jobs',{
        universe,
        from:`${Math.max(1995, firstYear-2)}-01-01`,
        to:`${nowY}-12-31`,
        firstYear,
        wfWindow:next.wfWindow, rollYears:next.wfRollYears, period:next.wfPeriod,
        grid:next.wfGrid, transition:next.wfTransition,
        fee:next.fee, start:next.start, size:next.size, fractional:!!next.fractional,
        // Strategy extras: fixed from the form in every IS/OOS run, or tuned when the checkbox is on.
        trail:next.trail, trailLock:next.trailLock, ranking:next.ranking,
        tuneTrail:next.wfTuneTrail?1:0, tuneRanking:next.wfTuneRanking?1:0,
      });
      showWfJob(r.job||r);
    }catch(e){
      alert(`Walk-Forward konnte nicht starten: ${e.message}`);
    }finally{
      if(ctx.live()) ui.tuneBtn.disabled=false;
    }
  };
  renderBacktestResults(ctx,d);
  diagnostics(ctx,d);
}

export default [
  {id:'RSL26',name:'Levy RSL26 Scanner · Holdings, Rangliste, weekly Exits',group:'Kamikaze',needs:false,source:'Yahoo weekly closes; user book data/rsl-watchlist.json; RRG vs universe benchmark',render:rsl},
  {id:'RSLBT',name:'RSL-BT · manueller Backtest und Parameter-Profile',group:'Kamikaze',needs:false,source:'Yahoo weekly closes; same engine as RSL26; profiles in data/settings.json',render:rslbt},
  {id:'RRG',name:'Sector rotation vs SPX + stock drill-down / season filter',group:'Kamikaze',needs:false,source:'Yahoo; sector ETF proxies; JdK-style approximation',render:rrg},
  {id:'MPUT',name:'Married-put scanner: bottom + RRG Winter→Spring + 6–12M far-OTM put, dividends, max risk',group:'Kamikaze',needs:false,source:'Yahoo prices; CBOE delayed options; realized-vol IVR proxy, not true IVR',render:mput},
  {id:'PARAMHEATMAP',name:'Parameter-Heatmap (N × RANKTOP × Exit-Mode × RS-Exit)',group:'Kamikaze',needs:false,source:'Offline grid JSON public/data/backtests/grid-2026-11-09.json; FEE=$1/trade fixed',render:paramHeatmap},
];
