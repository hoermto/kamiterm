#!/usr/bin/env python3
import json, math
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

data = json.loads(Path('/tmp/grid-plot-data.json').read_text())
cells = data['cells']
best_raw = data['bestRaw']
best_rob = data['bestRobust']
NS = data['NS']
RT = sorted(set(data['RT_FIXED'] + [0]))  # y labels without =N; =N plotted at its numeric n
HEAT = Path(data['HEAT'])
HEAT.mkdir(parents=True, exist_ok=True)
MODES = data['MODES']

def rt_axis_for(mode_cells):
    vals = sorted({int(c['rankTop']) for c in mode_cells})
    return vals

def grid_matrix(subset, metric, ns, rts):
    # For each (n, rt) take best confirmWeeks by the metric (or score)
    m = np.full((len(rts), len(ns)), np.nan)
    for j, n in enumerate(ns):
        for i, rt in enumerate(rts):
            cands = [c for c in subset if c['n'] == n and int(c['rankTop']) == rt]
            if not cands:
                # =N cells: rankTop==n
                if rt == n:
                    cands = [c for c in subset if c['n'] == n and int(c['rankTop']) == n]
            if not cands:
                continue
            key = metric
            cands = [c for c in cands if c.get(key) is not None and isinstance(c.get(key), (int, float))]
            if not cands:
                continue
            if metric in ('maxDD',):
                best = min(cands, key=lambda c: abs(c[metric]))  # least severe? show raw maxDD (most negative worse)
                # actually show the cell with best MAR's maxDD when multiple CW — pick max MAR
                best = max(cands, key=lambda c: c.get('mar') or -999)
                m[i, j] = best[metric]
            else:
                best = max(cands, key=lambda c: c.get(metric) if c.get(metric) is not None else -999)
                m[i, j] = best[metric]
    return m

def mark(ax, cell, ns, rts, color, marker, label):
    if not cell: return
    try:
        j = ns.index(cell['n'])
        rt = int(cell['rankTop'])
        i = rts.index(rt) if rt in rts else None
        if i is None: return
        ax.scatter([j], [i], s=120, c=color, marker=marker, edgecolors='white', linewidths=1.2, zorder=5, label=label)
    except Exception:
        pass

metrics = [('mar', 'MAR'), ('cagr', 'CAGR'), ('maxDD', 'MaxDD'), ('robustness', 'Robustness')]
overview_axes = []
fig_ov, axes_ov = plt.subplots(2, 3, figsize=(14, 9), constrained_layout=True)
axes_ov = axes_ov.ravel()
ov_i = 0

for mode in MODES:
    for rs in (True, False):
        subset = [c for c in cells if c['mode'] == mode and bool(c['rsExit']) == rs]
        if not subset:
            continue
        rts = rt_axis_for(subset)
        if mode in ('OFF', 'DIRECT', 'DIRECT+RSL'):
            # single-row: still plot vs N as bars + fake heatmap with one RT
            rts = [25]
        for metric, title in metrics:
            mat = grid_matrix(subset, metric, NS, rts)
            fig, ax = plt.subplots(figsize=(9, 5.5))
            cmap = 'RdYlGn' if metric != 'maxDD' else 'RdYlGn_r'
            # maxDD is negative — use RdYlGn where less negative is greener: RdYlGn works if we pass values
            im = ax.imshow(mat, aspect='auto', cmap=cmap, origin='lower')
            ax.set_xticks(range(len(NS))); ax.set_xticklabels(NS)
            ax.set_yticks(range(len(rts))); ax.set_yticklabels(rts)
            ax.set_xlabel('N'); ax.set_ylabel('RANKTOP')
            ax.set_title(f'{mode} · RS-Exit={"on" if rs else "off"} · {title}')
            fig.colorbar(im, ax=ax, fraction=0.046)
            # mark best raw / robust if they match this panel
            br = best_raw if best_raw and best_raw['mode']==mode and bool(best_raw['rsExit'])==rs else None
            bb = best_rob if best_rob and best_rob['mode']==mode and bool(best_rob['rsExit'])==rs else None
            mark(ax, br, NS, rts, '#1a1a1a', '*', 'best raw')
            mark(ax, bb, NS, rts, '#00e5ff', 'o', 'best plateau')
            if br or bb:
                ax.legend(loc='upper right', fontsize=8)
            fname = HEAT / f'{mode}_RS{1 if rs else 0}_{metric}.png'
            fig.savefig(fname, dpi=110)
            plt.close(fig)

        # overview: MAR only
        if ov_i < len(axes_ov):
            ax = axes_ov[ov_i]; ov_i += 1
            mat = grid_matrix(subset, 'mar', NS, rts)
            im = ax.imshow(mat, aspect='auto', cmap='RdYlGn', origin='lower')
            ax.set_xticks(range(len(NS))); ax.set_xticklabels(NS, fontsize=7)
            ax.set_yticks(range(len(rts))); ax.set_yticklabels(rts, fontsize=7)
            ax.set_title(f'{mode} RS={"1" if rs else "0"}', fontsize=9)
            br = best_raw if best_raw and best_raw['mode']==mode and bool(best_raw['rsExit'])==rs else None
            bb = best_rob if best_rob and best_rob['mode']==mode and bool(best_rob['rsExit'])==rs else None
            mark(ax, br, NS, rts, 'black', '*', None)
            mark(ax, bb, NS, rts, 'cyan', 'o', None)
            fig_ov.colorbar(im, ax=ax, fraction=0.05)

# hide unused overview axes
for k in range(ov_i, len(axes_ov)):
    axes_ov[k].axis('off')
fig_ov.suptitle('RSL26 Parameter grid · MAR heatmaps · FEE=1 · SPX 5y', fontsize=12)
ov_path = HEAT / 'overview-MAR.png'
fig_ov.savefig(ov_path, dpi=120)
plt.close(fig_ov)
# also copy to data/backtests root for easy find
import shutil
shutil.copy(ov_path, HEAT.parent / 'heatmaps-2026-11-09-overview-MAR.png')
print('heatmaps written to', HEAT)
print('overview', ov_path)
