#!/usr/bin/env python3
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime

data = json.loads(Path('/tmp/10y-plot.json').read_text())
DIR = Path(data['dir'])
DIR.mkdir(parents=True, exist_ok=True)
results = data['results']
colors = ['#ffa028','#63a9ff','#55c989','#ef6a77','#e2ba43','#c084fc','#f472b6']

# Equity log-scale
fig, ax = plt.subplots(figsize=(12, 6), constrained_layout=True)
bm_plotted = False
for i, r in enumerate(results):
    eq = r.get('equity') or []
    if not eq: continue
    xs = [datetime.strptime(p['time'], '%Y-%m-%d') for p in eq]
    ys = [p['value'] for p in eq]
    ax.plot(xs, ys, color=colors[i % len(colors)], label=r['id'], lw=1.4)
    if not bm_plotted and r.get('benchmarkEquity'):
        bx = [datetime.strptime(p['time'], '%Y-%m-%d') for p in r['benchmarkEquity']]
        by = [p['value'] for p in r['benchmarkEquity']]
        ax.plot(bx, by, color='#888', ls='--', label='SPX B&H', lw=1.2)
        bm_plotted = True
ax.set_yscale('log')
ax.set_title('10y Equity (log) · FEE=1 · SIZE=EQUITY · SPX')
ax.set_ylabel('Equity ($)')
ax.legend(fontsize=8, ncol=2)
ax.grid(True, which='both', alpha=0.3)
fig.savefig(DIR / 'equity-log.png', dpi=120)
plt.close(fig)

# Yearly excess bars per config
n = len(results)
fig, axes = plt.subplots(n, 1, figsize=(11, 2.2 * n), constrained_layout=True, sharex=True)
if n == 1: axes = [axes]
for ax, r, col in zip(axes, results, colors):
    ys = r.get('yearly') or []
    years = [y['year'] for y in ys]
    excess = [y.get('excess') for y in ys]
    bars = ax.bar(years, [e if e is not None else 0 for e in excess], color=col, alpha=0.85)
    ax.axhline(0, color='#666', lw=0.8)
    ax.set_ylabel('Excess %')
    ax.set_title(r['label'], fontsize=9)
    ax.grid(True, axis='y', alpha=0.3)
axes[-1].set_xlabel('Jahr')
fig.suptitle('Jährliche Excess-Return vs SPX B&H', fontsize=12)
fig.savefig(DIR / 'yearly-excess.png', dpi=120)
plt.close(fig)
print('wrote', DIR / 'equity-log.png', DIR / 'yearly-excess.png')
