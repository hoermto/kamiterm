#!/usr/bin/env python3
"""Russell-1000-Studie: Zusammenführung (Analyse only). Liest /workspace/tmp/r1000/dump-*.json, trend.json und
strategies/RSL26_Russell1000_2026-11-10_{SPX,R1000,R1000EX}.json; schreibt Haupt-CSV/JSON + Equity-Chart (log, mit Drawdown)."""
import json, math, csv
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt, matplotlib.dates as mdates
from datetime import datetime
T = '/workspace/tmp/r1000'; S = '/workspace/thoBox/Grokki/strategies'; TAG = f'{S}/RSL26_Russell1000_2026-11-10'
D = {u: json.load(open(f'{T}/dump-{u}.json')) for u in ['SPX', 'R1000', 'R1000EX']}
A = {u: json.load(open(f'{TAG}_{u}.json')) for u in ['SPX', 'R1000', 'R1000EX']}
TR = json.load(open(f'{T}/trend.json'))
FAV, KA, KB = 'RANK|RT25|RS1|T20L4|RSL26|N5', 'OFF|RT0|RS0|T20L0|MOM52_4|N5', 'RANK|RT10|RS0|T20L4|MOM52_4|N5'
BEST = {u: A[u]['best']['id'] for u in A}
def st(rets):
    v, pk, mdd = 1.0, 1.0, 0.0
    for r in rets: v *= 1 + r; pk = max(pk, v); mdd = min(mdd, v / pk - 1)
    yrs = len(rets) / 52.18; cagr = 100 * (v ** (1 / yrs) - 1); return cagr, 100 * mdd, cagr / abs(100 * mdd)
# survivorship premium: EW heutige Mitglieder minus Kursindex (10 J.)
bh = {u: A[u]['buyHold'] for u in A}
prem = {'SPX': bh['SPX']['EW-Universum']['y10']['cagr'] - bh['SPX']['^GSPC']['y10']['cagr'],
        'R1000': bh['R1000']['EW-Universum']['y10']['cagr'] - bh['R1000']['^RUI']['y10']['cagr'],
        'R1000EX': bh['R1000EX']['EW-Universum']['y10']['cagr'] - bh['R1000EX']['IWR']['y10']['cagr']}
rows = []
def cfgrow(u, cid, label):
    c = D[u]['configs'].get(cid); a = next((x for x in [A[u]['best'], *A[u]['top'], *A[u]['refs'].values()] if x['id'] == cid), None)
    r = {'Universum': u, 'Config': label, 'id': cid}
    if a: r.update({'CAGR 10J %': a['y10']['cagr'], 'MaxDD 10J %': a['y10']['maxDD'], 'MAR 10J': a['y10']['mar'], 'CAGR 5J %': a['h2']['cagr'], 'MaxDD 5J %': a['h2']['maxDD'], 'MAR 5J': a['h2']['mar'],
                    'CAGR 2018-26 %': (a.get('wfFixed') or {}).get('cagr'), '52 Starts min CAGR %': (a.get('shift10') or {}).get('cagrMin'), '52 Starts min MAR': (a.get('shift10') or {}).get('marMin'), 'Rang Robust-Score': a.get('rankScore')})
    if c:
        r['Trades/Jahr'] = c['tradesPerYear']
        for h, extra in [('voll', 0), ('diff', None)]:
            hc = prem[u] if extra == 0 else prem[u] - prem['SPX']
            if u == 'SPX' and extra is None: continue
            adj = [(1 + x) * (1 - hc / 100) ** (1 / 52.18) - 1 for x in c['weekRets']]
            _, dd, _ = st(adj); cg = 100 * ((1 + c['research']['cagr'] / 100) * (1 - hc / 100) - 1); r[f'Haircut {h} CAGR %'] = cg; r[f'Haircut {h} MaxDD % (Wochenbasis)'] = dd; r[f'Haircut {h} pp'] = hc
    rows.append(r); return r
for u in ['SPX', 'R1000', 'R1000EX']:
    cfgrow(u, FAV, 'SPX-Favorit'); cfgrow(u, KA, 'Kandidat A'); cfgrow(u, KB, 'Kandidat B'); cfgrow(u, BEST[u], f'Robust-#1 {u}')
for u, k in [('R1000', '^RUI'), ('R1000', 'IWB'), ('R1000', '^SP500TR'), ('R1000', 'RSP'), ('R1000', 'EW-Universum'), ('R1000EX', 'IWR'), ('R1000EX', '^SP400'), ('R1000EX', 'EW-Universum'), ('SPX', '^GSPC'), ('SPX', 'EW-Universum')]:
    b = bh[u][k]; rows.append({'Universum': u, 'Config': f'Buy & Hold {k}', 'id': '', 'CAGR 10J %': b['y10']['cagr'], 'MaxDD 10J %': b['y10']['maxDD'], 'MAR 10J': b['y10']['mar'], 'CAGR 5J %': b['h2']['cagr'], 'MaxDD 5J %': b['h2']['maxDD'], 'MAR 5J': b['h2']['mar'], 'CAGR 2018-26 %': b['wf']['cagr']})
for u in A:
    for w in A[u]['wf']: rows.append({'Universum': u, 'Config': f"WF OOS 2018-26 {w['set']} {w['win']} {w['pickMode']}", 'id': '', 'CAGR 2018-26 %': w['cagr'], 'MaxDD 10J %': w['maxDD'], 'MAR 10J': w['mar']})
cols = []
for r in rows:
    for k in r:
        if k not in cols: cols.append(k)
def de(v):
    if isinstance(v, float): return f'{v:.2f}'.replace('.', ',')
    return '' if v is None else str(v)
with open(f'{TAG}.csv', 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f, delimiter=';'); w.writerow(cols); [w.writerow([de(r.get(k)) for k in cols]) for r in rows]
# trade anatomy table
anat = {u: {cid: {k: D[u]['configs'][cid][k] for k in ['research', 'tradesPerYear', 'all', 'large', 'mid', 'reasons', 'topContrib', 'yearly']} for cid in D[u]['configs']} for u in D}
out = {'generated': datetime.now().isoformat(), 'survivorshipPremiumPP': prem, 'best': BEST, 'rows': rows, 'tradeAnatomy': anat, 'trend': TR,
       'pbo': {u: {'S16': A[u]['pbo']['S16']['pbo'], 'S8': A[u]['pbo']['S8']['pbo']} for u in A},
       'dsr': {u: A[u]['dsr'][:3] for u in A}, 'wf': {u: [{k: w[k] for k in ['set', 'win', 'pickMode', 'cagr', 'maxDD', 'mar', 'yearly', 'picks']} for w in A[u]['wf']] for u in A},
       'bootstrap': {u: A[u]['bootstrap'] for u in A}, 'concentration': {u: A[u]['concentration'] for u in A}, 'marginals': {u: A[u]['marginals'] for u in A},
       'loaded': {u: A[u]['loaded'] for u in A}, 'lateStarts': {u: sum(1 for t in A[u]['tickers'] if t['first'] > '2016-11-09') for u in A}}
# cross-universe bootstrap: Robust-#1 R1000 / R1000EX vs SPX-Favorit auf SPX (13-Wochen-Blöcke)
import random
def boot(x, y, nb=5000, mb=13):
    n = min(len(x), len(y)); x = x[-n:]; y = y[-n:]; rnd = random.Random(42); dC = []; dM = []
    for _ in range(nb):
        i = rnd.randrange(n); xs = []; ys = []
        for k in range(n):
            if k > 0: i = rnd.randrange(n) if rnd.random() < 1 / mb else (i + 1) % n
            xs.append(x[i]); ys.append(y[i])
        a, b = st(xs), st(ys); dC.append(a[0] - b[0]); dM.append(a[2] - b[2])
    dC.sort(); dM.sort(); q = lambda a, p: a[int(p * (len(a) - 1))]
    return {'dCagr5_50_95': [q(dC, .05), q(dC, .5), q(dC, .95)], 'pCagr': sum(v > 0 for v in dC) / nb, 'dMar5_50_95': [q(dM, .05), q(dM, .5), q(dM, .95)], 'pMar': sum(v > 0 for v in dM) / nb}
spx = D['SPX']['configs'][FAV]['weekRets']
out['crossBoot'] = {f'{u} {cid} vs SPX-Favorit/SPX': boot(D[u]['configs'][cid]['weekRets'], spx, 2000) for u, cid in [('R1000', BEST['R1000']), ('R1000', FAV), ('R1000', KB), ('R1000EX', BEST['R1000EX'])]}
json.dump(out, open(f'{TAG}.json', 'w'), indent=1, ensure_ascii=False)
# chart
fig, (ax, ax2) = plt.subplots(2, 1, figsize=(13, 8.5), sharex=True, gridspec_kw={'height_ratios': [3, 1.2]})
R = lambda u, c: D[u]['configs'][c]['research']
bhr = A['R1000']['buyHold']['^RUI']['y10']
series = [(D['SPX']['configs'][FAV]['equityWeekly'], 'SPX-Favorit auf S&P 500 (RANK RT25 RS an T20/4 N5)', '#1f77b4', 2.2, R('SPX', FAV)),
          (D['R1000']['configs'][BEST['R1000']]['equityWeekly'], f"Robust-#1 R1000 ({BEST['R1000'].replace('|', ' ')})", '#d62728', 1.8, R('R1000', BEST['R1000'])),
          (D['R1000']['configs'][FAV]['equityWeekly'], 'SPX-Favorit auf Russell 1000', '#ff9896', 1.2, R('R1000', FAV)),
          (D['R1000EX']['configs'][BEST['R1000EX']]['equityWeekly'], f"Robust-#1 R1000 ohne S&P 500 ({BEST['R1000EX'].replace('|', ' ')})", '#9467bd', 1.8, R('R1000EX', BEST['R1000EX'])),
          (D['R1000']['bh']['^RUI'], 'Buy & Hold ^RUI (Russell 1000 Kursindex)', '#555555', 1.6, bhr)]
for eq, lab, col, lw, k in series:
    x = [datetime.strptime(d, '%Y-%m-%d') for d, _ in eq]; v = [e for _, e in eq]
    ax.plot(x, v, label=f"{lab} – CAGR {k['cagr']:.1f} % / MaxDD {k['maxDD']:.1f} %".replace('.', ','), color=col, lw=lw)
    pk = 0; dd = []
    for e in v: pk = max(pk, e); dd.append(100 * (e / pk - 1))
    ax2.plot(x, dd, color=col, lw=1)
ax.set_yscale('log'); ax.set_ylabel('Depotwert (Start 10 000, log)'); ax.grid(True, which='both', alpha=.3); ax.legend(fontsize=8.5, loc='upper left')
ax.set_title('RSL26 – S&P 500 vs Russell 1000 vs Russell 1000 ohne S&P 500, 10 J. (09.11.2016–09.11.2026)\nheutige Mitglieder (Survivorship-Bias!), Gebühr 1 $/Order, Signal Fr.-Schluss, Ausführung Mo.-Open', fontsize=10)
ax2.set_ylabel('Drawdown % (Wochenschluss)'); ax2.grid(True, alpha=.3); ax2.xaxis.set_major_locator(mdates.YearLocator()); ax2.xaxis.set_major_formatter(mdates.DateFormatter('%Y'))
plt.tight_layout(); plt.savefig(f'{TAG}.png', dpi=130)
print('prem', prem); print(json.dumps(out['crossBoot'], indent=0)); print('late', out['lateStarts'])
for r in rows[:16]: print({k: (round(v, 1) if isinstance(v, float) else v) for k, v in r.items()})
