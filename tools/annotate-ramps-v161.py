import json, math, sys
from PIL import Image, ImageDraw
P = json.load(open('/home/user/Game/tools/masterplan/plan-C.json'))
def run(name, cx, cz, d, ids):
    im = Image.open('/tmp/claude-0/s10/%s.jpg' % name).convert('RGB'); S = 2
    im = im.resize((im.width * S, im.height * S), Image.LANCZOS); dr = ImageDraw.Draw(im)
    k = im.height / (2 * d * math.tan(math.radians(25)))
    pr = lambda x, z: ((im.width / 2) + (x - cx) * k, (im.height / 2) + (z - cz) * k)
    cols = {'loop': (255, 60, 60), 'outer': (255, 160, 0), 'semi-direct': (180, 0, 255), 'direct': (0, 120, 255)}
    def arrow(a, b, col, w=4, head=14):
        dr.line([a, b], fill=col, width=w)
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        for s in (-0.5, 0.5): dr.line([b, (b[0] - head * math.cos(ang + s), b[1] - head * math.sin(ang + s))], fill=col, width=w)
    for ic in P['interchanges']:
        if ic['id'] not in ids: continue
        for i, r in enumerate(ic['ramps']):
            pts = r['pts']; col = cols.get(r['kind'], (0, 200, 0)); path = [pr(*p[:2]) for p in pts]
            dr.line(path, fill=col, width=3)
            n = len(pts)
            for f in (0.25, 0.5, 0.75):
                j = int(n * f); 
                if 0 < j < n - 1: arrow(pr(*pts[j - 1][:2]), pr(*pts[j + 1][:2]), col)
            dr.text((path[0][0] + 4, path[0][1] - 12), 'EXIT %s.%d' % (ic['id'], i), fill=(255, 255, 255)); dr.text((path[-1][0] + 4, path[-1][1] + 2), 'ENTRY', fill=(255, 255, 255))
    return im, dr, pr, arrow
im, dr, pr, arrow = run('I4b', 250, 160, 80, ['I4'])
# host travel directions at the Port road (right-hand: eastbound on the SOUTH half, westbound on the NORTH half) and on M2 (southbound west tube, northbound east tube)
for x0 in (300, 330):
    pass
arrow(pr(285, 163.2), pr(312, 163.2), (255, 255, 0), 5, 16); dr.text(pr(286, 165), 'Port rd EASTBOUND (south half = right)', fill=(255, 255, 0))
arrow(pr(312, 156.8), pr(285, 156.8), (0, 255, 255), 5, 16); dr.text(pr(286, 153.5), 'WESTBOUND (north half)', fill=(0, 255, 255))
im.save('/tmp/claude-0/s10/I4b-annot.png')
im, dr, pr, arrow = run('I4a', 250, 125, 110, ['I4'])
arrow(pr(244.8, 100), pr(244.8, 112), (255, 255, 0), 5, 16); arrow(pr(255.2, 112), pr(255.2, 100), (0, 255, 255), 5, 16)
dr.text(pr(226, 98), 'M2 southbound = WEST tube', fill=(255, 255, 0)); dr.text(pr(258, 98), 'northbound = EAST tube', fill=(0, 255, 255))
im.save('/tmp/claude-0/s10/I4a-annot.png')
for nm, cx, cz, d, ids in [('I1a', 0, -240, 115, ['I1']), ('I3a', 250, -240, 115, ['I3'])]:
    im, dr, pr, arrow = run(nm, cx, cz, d, ids); im.save('/tmp/claude-0/s10/%s-annot.png' % nm)
