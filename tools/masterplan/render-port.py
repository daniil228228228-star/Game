"""Exact first-slice map (optional matplotlib); game/build has no Python dependency."""
from pathlib import Path
import json, math
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, Circle, Wedge
root = Path(__file__).resolve().parents[2]
p = json.loads((root / 'tools/masterplan/plan-B.json').read_text())
fig, ax = plt.subplots(figsize=(12, 8))
fig.patch.set_facecolor('#f4f1e8'); ax.set_facecolor('#aad2e5')
ax.add_patch(Circle((0, 0), 70, color='#e7e0cc', alpha=.95))
ax.add_patch(Wedge((0, 0), 60.2, 0, 360, width=5.6, color='#8a9293'))
for pier in p['piers']:
    ax.add_patch(Polygon(pier['poly'], color='#cbc5b7', zorder=2))
for l in p['lots']:
    if l['pad'] != 'B02': continue
    ax.add_patch(Polygon(l['poly'], facecolor='#ece2c1', edgecolor='#bc9849', lw=1.5, zorder=5))
    c = [sum(q[k] for q in l['poly']) / 4 for k in [0, 1]]
    ax.text(*c, l['id'], ha='center', va='center', fontsize=9, zorder=6)
for e in p['edges']:
    if e.get('pad') not in ['B01', 'B02']: continue
    col = '#c6933e' if e['pad'] == 'B01' else '#477c8c'
    for width, color, zorder in [(e['w']+2*e['sw'], '#f4edd9', 3), (e['w'], col, 4)]:
        for a, b in zip(e['pts'], e['pts'][1:]):
            dx, dz = b[0]-a[0], b[1]-a[1]; length = math.hypot(dx, dz)
            nx, nz = -dz/length*width/2, dx/length*width/2
            ax.add_patch(Polygon([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]], color=color, zorder=zorder))
        for q in e['pts'][1:]: ax.add_patch(Circle(q, width/2, color=color, zorder=zorder))
ax.annotate('B01 · 350 монет\nПортовая авеню', xy=(-78,16.5), xytext=(-87,-10), arrowprops={'arrowstyle':'-','color':'#594c36'}, ha='center', fontsize=12, color='#594c36', bbox={'boxstyle':'round,pad=.5','fc':'#fffaf0','ec':'#c6933e'}, zorder=8)
ax.annotate('B02 · 750 монет\nПричал, набережная, 5 участков', xy=(-111,24), xytext=(-119,67), arrowprops={'arrowstyle':'-','color':'#335965'}, ha='center', fontsize=12, color='#335965', bbox={'boxstyle':'round,pad=.5','fc':'#f8fcfd','ec':'#477c8c'}, zorder=8)
ax.text(-56,-4,'Старое кольцо\nсохраняется',ha='center',fontsize=11,color='#424c48',zorder=7)
ax.text(-141,53,'Вода',fontsize=11,color='#32617c')
ax.set_xlim(-147,-43); ax.set_ylim(74,-21); ax.set_aspect('equal'); ax.grid(alpha=.18)
ax.set_xlabel('x, метры'); ax.set_ylabel('z, метры (север сверху)')
fig.suptitle('Генплан B — реализованный первый срез B01/B02',fontsize=18,fontweight='bold',y=.97)
fig.text(.5,.025,'Ширины дорог и участков — в масштабе, по plan-B.json. Кружок B01 в игре выбирает свободный подход.\nУчастки пока пустые; здания и транспортная экономика порта — следующие этапы.',ha='center',fontsize=10,color='#534e43')
fig.subplots_adjust(bottom=.15,top=.88)
fig.savefig(root/'docs/masterplan/port-phase1.png',dpi=150)
plt.close(fig)
