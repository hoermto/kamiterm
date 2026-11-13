#!/usr/bin/env python3
import json
from pathlib import Path
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

data = json.loads(Path('/tmp/wf-plot.json').read_text())
DIR = Path(data['dir'])
DIR.mkdir(parents=True, exist_ok=True)

fig, ax = plt.subplots(figsize=(12, 6), constrained_layout=True)
colors = {'original': '#888', 'late_tuned': '#ef6a77', 'is_plateau': '#ffa028', 'is_raw': '#63a9ff'}
bm_done = False
fixed = data.get('fixedEquities') or {}
for fid, blob in fixed.items():
    eq = blob.get('equity') or []
    if not eq: continue
    xs = [datetime.strptime(p['time'], '%Y-%m-%d') for p in eq]
    ys = [p['value'] for p in eq]
    ax.plot(xs, ys, label=fid, color=colors.get(fid, '#63a9ff'), lw=1.3)
    if not bm_done and blob.get('benchmarkEquity'):
        bx = [datetime.strptime(p['time'], '%Y-%m-%d') for p in blob['benchmarkEquity']]
        by = [p['value'] for p in blob['benchmarkEquity']]
        ax.plot(bx, by, '--', color='#444', label='SPX B&H', lw=1.1)
        bm_done = True

wf_eq = data.get('wfEquities') or {}
for key, col, lab, eqkey in [
    ('wfExpand', '#55c989', 'WF expanding', 'expanding'),
    ('wfRoll2', '#c084fc', 'WF roll2y', 'roll2'),
]:
    daily = wf_eq.get(eqkey) or (data.get(key) or {}).get('dailyEquity')
    if daily and isinstance(daily, list) and daily and 'time' in daily[0]:
        xs = [datetime.strptime(p['time'], '%Y-%m-%d') for p in daily]
        ys = [p['value'] for p in daily]
        ax.plot(xs, ys, color=col, label=lab, lw=1.4)
        continue
    chain = (data.get(key) or {}).get('equity') or (data.get(key) or {}).get('chain') or []
    rows = chain if chain and isinstance(chain, list) and chain and isinstance(chain[0], dict) and 'year' in chain[0] else []
    if not rows:
        continue
    xs = [datetime(rows[0]['year'], 1, 1)] + [datetime(c['year'], 12, 31) for c in rows]
    ys = [rows[0]['start']] + [c['end'] for c in rows]
    ax.plot(xs, ys, '-o', color=col, label=lab, ms=3, lw=1.4)

ax.set_yscale('log')
ax.set_title('Walk-forward & fixed · Equity (log) · FEE=1')
ax.legend(fontsize=8, ncol=2)
ax.grid(True, which='both', alpha=0.3)
fig.savefig(DIR / 'equity-log.png', dpi=120)
plt.close(fig)

# params by year
fig, axes = plt.subplots(2, 1, figsize=(11, 6), constrained_layout=True, sharex=True)
rows = (data.get('wfExpand') or {}).get('rows') or []
if rows:
    years = [r['year'] for r in rows]
    ns = [r['n'] for r in rows]
    modes = [r['mode'] for r in rows]
    mode_code = {m: i for i, m in enumerate(sorted(set(modes)))}
    axes[0].plot(years, ns, 'o-', color='#ffa028')
    axes[0].set_ylabel('N'); axes[0].set_title('WF expanding · N pro Jahr'); axes[0].grid(True, alpha=0.3)
    axes[1].plot(years, [mode_code[m] for m in modes], 's-', color='#63a9ff')
    axes[1].set_yticks(list(mode_code.values())); axes[1].set_yticklabels(list(mode_code.keys()))
    axes[1].set_ylabel('Mode'); axes[1].set_xlabel('Jahr'); axes[1].grid(True, alpha=0.3)
fig.savefig(DIR / 'params-by-year.png', dpi=120)
plt.close(fig)

sc = data.get('scatter') or []
if sc:
    fig, ax = plt.subplots(figsize=(7, 7), constrained_layout=True)
    xs = [s['isMar'] for s in sc]; ys = [s['oosMar'] for s in sc]
    ax.scatter(xs, ys, s=18, alpha=0.5, c='#63a9ff', label='grid cells')
    for s in sc:
        if s.get('isPick'):
            ax.scatter([s['isMar']], [s['oosMar']], s=140, c='#55c989', marker='*', label='IS plateau', zorder=5)
        if s.get('isRaw'):
            ax.scatter([s['isMar']], [s['oosMar']], s=100, c='#ef6a77', marker='D', label='IS raw', zorder=5)
    lim0, lim1 = min(xs + ys) - 0.1, max(xs + ys) + 0.1
    ax.plot([lim0, lim1], [lim0, lim1], '--', color='#888')
    ax.set_xlabel('IS MAR (2016-21)'); ax.set_ylabel('OOS MAR (2021-26)')
    ax.set_title('IS vs OOS MAR'); ax.legend(fontsize=8); ax.grid(True, alpha=0.3)
    fig.savefig(DIR / 'is-vs-oos-scatter.png', dpi=120)
    plt.close(fig)

print('plots written', DIR)
