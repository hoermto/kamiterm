// Editable reference rosters. SPX = full S&P 500 constituents (Yahoo tickers).
// Source: https://github.com/datasets/s-and-p-500-companies (Wikipedia-derived CSV).
// As-of: 2026-11-09. BRK.B/BF.B → Yahoo BRK-B/BF-B. NDX/DAX remain static reference rosters. See EXTENSIONS.md.
const words = s => s.trim().split(/\s+/);
export const SECTORS = {
  XLK: {name:'Technology', stocks:words('AAPL ACN ADBE ADI ADSK AKAM AMAT AMD ANET APH AVGO CDNS CDW CIEN COHR CRM CRWD CSCO CTSH DDOG DELL FFIV FICO FLEX FSLR FTNT GDDY GEN GLW HPE HPQ IBM INTC INTU IT JBL KEYS KLAC LITE LRCX MCHP MPWR MRVL MSFT MSI MU NOW NTAP NVDA NXPI OKTA ON ORCL P PANW PLTR PTC Q QCOM ROP SMCI SNDK SNPS STX SWKS TDY TEL TER TRMB TWLO TXN TYL VRSN WDAY WDC ZBRA')},
  XLC: {name:'Communication / telco', stocks:words('APP CHTR CMCSA DIS ECHO FOX FOXA GOOG GOOGL LYV META NFLX NWS NWSA OMC RDDT SKYD T TKO TMUS TTWO VZ')},
  XLY: {name:'Consumer discretionary', stocks:words('ABNB AMZN APTV AZO BBY BKNG CCL CMG CVNA DASH DECK DHI DPZ DRI EBAY EXPE F GM GPC GRMN HAS HD HLT LEN LOW LULU LVS MAR MCD MGM NCLH NKE NVR ORLY PHM RCL RL ROST SBUX TJX TPR TSCO TSLA ULTA WSM WYNN YUM')},
  XLP: {name:'Consumer staples', stocks:words('ADM BF-B BG CASY CHD CL CLX COST DG DLTR EL GIS HRL HSY KDP KHC KMB KO KR MDLZ MKC MNST MO PEP PG PM SJM STZ SYY TGT TSN VYLR WMT')},
  XLE: {name:'Energy', stocks:words('APA BKR COP CVX DVN EOG EQT EXE FANG HAL KMI MPC OKE OXY PSX SLB TPL TRGP VLO WMB XOM')},
  XLF: {name:'Financials', stocks:words('ACGL AFL AIG AIZ AJG ALL AMP AON APO ARES AXP BAC BEN BLK BNY BRK-B BRO BX C CB CBOE CFG CINF CME COF COIN CPAY EG ERIE FDS FIS FISV FITB GL GPN GS HBAN HIG HOOD IBKR ICE IVZ JKHY JPM KEY KKR L MA MCO MET MRSH MS MSCI MTB NDAQ NTRS PFG PGR PNC PRU PYPL RF RJF SCHW SPGI STT SYF TFC TROW TRV USB V WFC WRB WTW XYZ')},
  XLV: {name:'Health care', stocks:words('A ABBV ABT ALGN AMGN BAX BDX BIIB BMY BSX CAH CI CNC COO COR CRL CVS DGX DHR DVA DXCM ELV EW GEHC GILD HCA HSIC HUM IDXX ILMN INCY IQV ISRG JNJ LH LLY MCK MDT MRK MRNA MTD PFE PODD REGN RMD RVTY SOLV STE SYK TECH TMO UHS UNH VEEV VRTX VTRS WAT WST ZBH ZTS')},
  XLI: {name:'Industrials', stocks:words('ADP ALLE AME AOS AXON BA BE BR CARR CAT CHRW CMI CPRT CSX CTAS DAL DD DE DOV EFX EME EMR ETN EXPD FAST FDX FDXF FERG FIX FTV GD GE GEV GNRC GWW HII HON HONA HUBB HWM IEX IR ITW J JBHT JCI LDOS LHX LII LMT LUV MAS MMM NDSN NOC NSC ODFL OTIS PAYX PCAR PH PNR PWR ROK ROL RSG RTX SNA SWK TDG TT TXT UAL UBER UNP UPS URI VLTO VRSK VRT WAB WM XYL')},
  XLB: {name:'Materials', stocks:words('ALB AMCR APD AVY BALL CF CRH DOW ECL FCX IFF IP LIN LYB MLM MOS NEM NUE PKG PPG SHW STLD SW VMC')},
  XLU: {name:'Utilities', stocks:words('AEE AEP AES ATO AWK CEG CMS CNP D DTE DUK ED EIX ES ETR EVRG EXC FE LNT NEE NI NRG PCG PEG PNW PPL SO SRE VST WEC XEL')},
  XLRE: {name:'Real estate', stocks:words('AMT ARE BXP CBRE CCI CPT CSGP DLR DOC EQIX ESS EXR FRT HST INVH IRM KIM MAA O PLD PSA REG SBAC SPG UDR VICI VMRK VTR WELL WY')},
};
export const UNIVERSES = {
  SPX: [...new Set(Object.values(SECTORS).flatMap(s=>s.stocks))],
  NDX: words('AAPL ABNB ADBE ADI ADP ADSK AEP AMAT AMD AMGN AMZN ANSS ARM ASML AVGO AXON AZN BIIB BKNG BKR CCEP CDNS CDW CEG CHTR CMCSA COST CPRT CRWD CSCO CSGP CSX CTAS CTSH DASH DDOG DXCM EA EXC FANG FAST FTNT GEHC GFS GILD GOOG GOOGL HON IDXX INTC INTU ISRG KDP KHC KLAC LIN LRCX LULU MAR MCHP MDB MDLZ MELI META MNST MRVL MSFT MSTR MU NFLX NVDA NXPI ODFL ON ORLY PANW PAYX PCAR PDD PEP PLTR PYPL QCOM REGN ROP ROST SBUX SNPS TEAM TMUS TSLA TTD TTWO TXN VRSK VRTX WBD WDAY XEL ZS'),
  DAX: words('ADS.DE AIR.DE ALV.DE BAS.DE BAYN.DE BEI.DE BMW.DE BNR.DE CBK.DE CON.DE 1COV.DE DTG.DE DBK.DE DB1.DE DHL.DE DTE.DE EOAN.DE FME.DE FRE.DE HEI.DE HEN3.DE HNR1.DE IFX.DE MBG.DE MRK.DE MTX.DE MUV2.DE P911.DE PAH3.DE QIA.DE RHM.DE RWE.DE SAP.DE SRT3.DE SIE.DE ENR.DE SHL.DE SY1.DE VOW3.DE VNA.DE'),
};
// HDAX (DAX+MDAX+TecDAX, 102) und STOXX Europe 600 (~602) aus der Research-Liste (iShares-Holdings Nov 2026, heutige Mitglieder).
import {RESEARCH_UNIVERSES, RESEARCH_FX} from '../../scripts/lib/research-universes.mjs';
export const EU_UNIVERSES = {
  HDAX: {...RESEARCH_UNIVERSES.HDAX, key:'HDAX', bench:'^GDAXI', eur:true},
  SXXP: {...RESEARCH_UNIVERSES.SXXP, key:'SXXP', bench:'^STOXX', eur:true},
};
export const EU_FX = RESEARCH_FX;
UNIVERSES.HDAX = EU_UNIVERSES.HDAX.members.map(m=>m.t);
UNIVERSES.SXXP = EU_UNIVERSES.SXXP.members.map(m=>m.t);
/** Alt-Schlüssel: DAX → HDAX (Reiter ersetzt), STOXX/STOXX600 → SXXP. */
export const UNIVERSE_ALIASES = {DAX:'HDAX', STOXX:'SXXP', STOXX600:'SXXP', SXXP600:'SXXP', EUROSTOXX600:'SXXP'};
export const SCAN_UNIVERSES = ['SPX','NDX','HDAX','SXXP'];
export function canonUniverse(v, fallback='SPX') {
  const k=String(v||'').trim().toUpperCase();
  if(!k) return fallback;
  return UNIVERSE_ALIASES[k]||k;
}
export function universe(q={}, allowed=SCAN_UNIVERSES) {
  const raw=String(q.universe||'SPX').toUpperCase();
  const key=allowed.includes(raw)?raw:canonUniverse(raw);
  if(!allowed.includes(key)) throw Object.assign(new Error(`universe must be ${allowed.join(', ')}`),{status:400});
  const labels={SPX:`S&P 500 constituents (${UNIVERSES.SPX.length} tickers, as-of 2026-11-09)`,NDX:'NDX reference roster (membership unverified)',DAX:'DAX reference roster (membership unverified)',HDAX:`HDAX-Nachbau DAX+MDAX+TecDAX (${UNIVERSES.HDAX.length} Titel, iShares-Holdings Nov 2026; Benchmark ^GDAXI)`,SXXP:`STOXX Europe 600 (${UNIVERSES.SXXP.length} Titel, iShares-Holdings 06.11.2026; Kurse in EUR; Benchmark ^STOXX)`};
  if(EU_UNIVERSES[key]) return {key, tickers:UNIVERSES[key], label:labels[key], bench:EU_UNIVERSES[key].bench, members:EU_UNIVERSES[key].members, eur:true,
    warning:`Heutige Mitglieder (iShares-Holdings Nov 2026), nicht point-in-time: Survivorship-Bias im Backtest möglich. Yahoo-Daten europäischer Titel werden repariert (x100-Einheitensprünge, kurze Spikes).${key==='SXXP'?' Nicht-EUR-Kurse (GBP/GBp, CHF, DKK, SEK, NOK, PLN, USD) täglich mit EURxxx=X in EUR umgerechnet.':''}`};
  return {key, tickers:UNIVERSES[key], label: labels[key]||key, warning:key==='SPX'?'Static snapshot of S&P 500 constituents (datasets/s-and-p-500-companies, as-of 2026-11-09); not point-in-time for backtests. Survivorship bias possible. Edit grokki-universes.js.':'Static illustrative rosters; not verified current membership. Survivorship/selection bias. Edit grokki-universes.js.'};
}
