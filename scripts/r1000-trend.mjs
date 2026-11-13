#!/usr/bin/env node
/**
 * Russell-1000-Studie (Analyse only, Produktion unverändert): Trend-Persistenz nach Größe.
 * Buckets: SPX = R1000-Mitglieder im S&P 500 (Large Caps), EX = R1000 ohne S&P 500 (Mid Caps). Ränge jeweils innerhalb des Buckets.
 * Wöchentliche Stichtage 2016-11-11 .. 2026-11-06 (Freitagsschluss). Kennzahlen je Bucket:
 *  Rang-Autokorrelation (Spearman) RSL26 / MOM52-4 für h = 4/13/26/52 Wochen; Top-Dezil-Verbleib; Laufzeiten im Top-Dezil;
 *  Vorwärtsrendite Top-Dezil vs Bucket-Durchschnitt (Exzess, Trefferquote); P(-20 % vom Hoch binnen 26 Wo.); Vol; $-Volumen.
 * Aufruf: RSL_UNIVERSE=R1000 node scripts/r1000-trend.mjs <out.json>
 */
process.env.RSL_UNIVERSE = process.env.RSL_UNIVERSE || 'R1000';
const { writeFileSync } = await import('fs');
const E = await import('./research-engine.mjs');
const { P, RESEARCH, ts, iso } = E;
const out = process.argv[2] || '/workspace/tmp/r1000/trend.json';
const inSPX = new Map(RESEARCH.members.map(m => [m.t, !!m.inSPX]));
const A = ts('2016-11-09'), B = ts('2026-11-09');
const keys = [...new Set(P.prepped.flatMap(p => p.W.map(w => w.key)))].sort((a, b) => a - b);
const kIdx = new Map(keys.map((k, i) => [k, i]));
const sig = keys.filter(k => { const p0 = P.prepped.find(p => p.ticker === 'AAPL'); const i = p0.idx.get(k); return i != null && p0.W[i].time >= A && p0.W[i].time <= B; });
// per stock helpers
for (const p of P.prepped) {
  p.mom = p.W.map((w, i) => i >= 52 ? p.W[i - 4].close / p.W[i - 52].close - 1 : null);
  // 20-day avg dollar volume at each weekly bar (daily index of week's last bar)
  const dv = p.bars.map(b => b.close * (b.volume || 0)); const cs = [0]; for (const v of dv) cs.push(cs.at(-1) + v);
  p.dvol = p.W.map(w => { const di = p.dIdx.get(w.time); if (di == null) return null; const a = Math.max(0, di - 19); return (cs[di + 1] - cs[a]) / (di + 1 - a); });
}
const BUCKETS = { SPX: p => inSPX.get(p.ticker), EX: p => !inSPX.get(p.ticker) };
const H = [4, 13, 26, 52];
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
const qtl = (a, q) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(q * (b.length - 1))] : null; };
function ranksOf(rows) { const s = [...rows].sort((a, b) => b.v - a.v); s.forEach((r, i) => { r.pct = 1 - i / Math.max(1, s.length - 1); }); return new Map(s.map(r => [r.t, r.pct])); }
function spearman(xa, ya) { // inputs: arrays of pct ranks (already ranks) → Pearson on ranks
  const n = xa.length; if (n < 10) return null; const mx = mean(xa), my = mean(ya); let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = xa[i] - mx, dy = ya[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; } return sxy / Math.sqrt(sx * sy);
}
const res = { generated: new Date().toISOString(), weeks: sig.length, from: iso(A), to: iso(B), buckets: {} };
for (const [bk, f] of Object.entries(BUCKETS)) {
  const stocks = P.prepped.filter(f);
  // ranks per signal week
  const R = { rsl: new Map(), mom: new Map() }, at = new Map();
  for (const k of keys) {
    const rowsR = [], rowsM = [], idxs = new Map();
    for (const p of stocks) { const i = p.idx.get(k); if (i == null || p.rsl[i] == null) continue; idxs.set(p.ticker, i); rowsR.push({ t: p.ticker, v: p.rsl[i] }); if (p.mom[i] != null) rowsM.push({ t: p.ticker, v: p.mom[i] }); }
    R.rsl.set(k, ranksOf(rowsR)); R.mom.set(k, ranksOf(rowsM)); at.set(k, idxs);
  }
  const byT = new Map(stocks.map(p => [p.ticker, p]));
  const o = { names: stocks.length, avgRanked: mean(sig.map(k => R.rsl.get(k).size)) };
  // autocorrelation + top decile persistence
  for (const sc of ['rsl', 'mom']) {
    o[sc] = {};
    for (const h of H) {
      const cors = [], stay = [];
      for (const k of sig) {
        const k2 = keys[kIdx.get(k) + h]; if (k2 == null) continue;
        const a = R[sc].get(k), b = R[sc].get(k2); const xa = [], ya = []; let top = 0, kept = 0;
        for (const [t, v] of a) { if (!b.has(t)) continue; xa.push(v); ya.push(b.get(t)); if (v >= 0.9) { top++; if (b.get(t) >= 0.9) kept++; } }
        const c = spearman(xa, ya); if (c != null) cors.push(c); if (top) stay.push(kept / top);
      }
      o[sc][`h${h}`] = { rankAutocorr: mean(cors), topDecileStay: mean(stay), n: cors.length };
    }
  }
  // run lengths in top decile (RSL26), runs starting within window
  const runs = []; const cur = new Map();
  for (const k of keys) {
    const r = R.rsl.get(k); const now = new Set([...r].filter(([, v]) => v >= 0.9).map(([t]) => t));
    for (const [t, st] of cur) if (!now.has(t)) { if (st.k0 >= sig[0]) runs.push(st.len); cur.delete(t); }
    for (const t of now) { if (cur.has(t)) cur.get(t).len++; else cur.set(t, { k0: k, len: 1 }); }
  }
  o.topDecileRuns = { n: runs.length, median: med(runs), p75: qtl(runs, 0.75), p90: qtl(runs, 0.9), mean: mean(runs), share26plus: runs.filter(x => x >= 26).length / runs.length, share52plus: runs.filter(x => x >= 52).length / runs.length };
  // forward returns top decile vs bucket mean; trail-20 hits; vol; dollar volume
  o.fwd = {};
  for (const h of [4, 13, 26, 52]) {
    const ex = [], hitW = [], hitS = [], topM = [], allM = [];
    for (const k of sig) {
      const k2 = keys[kIdx.get(k) + h]; if (k2 == null) continue;
      const r = R.rsl.get(k), A1 = at.get(k), A2 = at.get(k2); const fr = [], frTop = [];
      for (const [t, v] of r) { const p = byT.get(t), i = A1.get(t); let j = A2.get(t); if (j == null) continue; const x = p.W[j].close / p.W[i].close - 1; if (Math.abs(x) > 20) continue; fr.push(x); if (v >= 0.9) frTop.push(x); }
      if (fr.length < 20 || !frTop.length) continue;
      const mAll = mean(fr), mTop = mean(frTop), mdAll = med(fr); ex.push(mTop - mAll); hitW.push(mTop > mAll ? 1 : 0); hitS.push(frTop.filter(x => x > mdAll).length / frTop.length); topM.push(mTop); allM.push(mAll);
    }
    o.fwd[`h${h}`] = { excessMeanPct: 100 * mean(ex), weeksTopBeatsBucketShare: mean(hitW), stockHitRateVsMedian: mean(hitS), topMeanPct: 100 * mean(topM), bucketMeanPct: 100 * mean(allM), n: ex.length };
  }
  const trailHit = [], tth = [], vols = [], dvTop = [], dvAll = [], mdd26 = [];
  for (const k of sig) {
    const r = R.rsl.get(k), A1 = at.get(k);
    for (const [t, v] of r) {
      const p = byT.get(t), i = A1.get(t);
      if (p.dvol[i] != null) dvAll.push(p.dvol[i]);
      if (v < 0.9) continue;
      if (p.dvol[i] != null) dvTop.push(p.dvol[i]);
      if (i + 26 >= p.W.length) continue;
      let pk = p.W[i].close, hit = null, mdd = 0;
      for (let j = i + 1; j <= i + 26; j++) { pk = Math.max(pk, p.W[j].close); const dd = p.W[j].close / pk - 1; mdd = Math.min(mdd, dd); if (hit == null && dd <= -0.2) hit = j - i; }
      trailHit.push(hit != null ? 1 : 0); if (hit != null) tth.push(hit); mdd26.push(mdd);
      const rets = []; for (let j = Math.max(1, i - 25); j <= i; j++) rets.push(Math.log(p.W[j].close / p.W[j - 1].close)); if (rets.length > 10) { const m = mean(rets); vols.push(Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(52)); }
    }
  }
  o.topDecileRisk = { pTrail20Within26w: mean(trailHit), medWeeksToTrail: med(tth), medMaxDD26wPct: 100 * med(mdd26), medVol26wPct: 100 * med(vols) };
  o.dollarVolume = { topDecileMedianUSDm: med(dvTop) / 1e6, topDecileP10USDm: qtl(dvTop, 0.1) / 1e6, bucketMedianUSDm: med(dvAll) / 1e6 };
  res.buckets[bk] = o; console.log(bk, JSON.stringify(o));
}
writeFileSync(out, JSON.stringify(res, null, 1)); process.exit(0);
