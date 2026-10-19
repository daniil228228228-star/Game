# Sketches of replacement variants for the I3 system interchange (M1 x M2), top view, right-hand traffic.  python3 tools/sketch-interchanges-v161.py OUT_DIR
# Game metres (x east, z south; 1 game m = 2.5 m real); centre = I3 (250, -240).  Hosts: M1 east-west, M2 north-south, carriageways 12.6 m, 2 lanes + shoulders per direction.
import math, sys
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
S = 4.0; W = H = 1100   # px per game m
def P(x, z): return (W / 2 + x * S * 0.78, H / 2 + z * S * 0.78)
def bez(p0, p1, p2, p3, n=60):
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        out.append((u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0], u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))
    return out
def arc(c, r, a0, a1, n=60):   # degrees, screen frame (angle increases clockwise on screen)
    return [(c[0] + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), c[1] + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
def length(pl): return sum(math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]) for i in range(1, len(pl)))
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18); FB = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 24); FS = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
except Exception: F = FB = FS = ImageFont.load_default()
COL = {0: (40, 150, 60), 1: (240, 150, 20), 2: (210, 50, 50), 3: (150, 60, 200)}   # level of the ramp deck: 0 ground, 1 / 2 / 3 raised
def base(title):
    im = Image.new('RGB', (W, H), (205, 225, 190)); d = ImageDraw.Draw(im)
    d.rectangle([P(-170, -170), P(170, 170)], outline=(120, 140, 110))
    # hosts: M1 (east-west) and M2 (north-south), two carriageways each with a median
    for horiz in (True, False):
        for sg in (-1, 1):
            a, b = (P(-170, sg * 7.4 + 0), P(170, sg * 7.4 + 0)) if horiz else (P(sg * 7.4, -170), P(sg * 7.4, 170))
            d.line([a, b], fill=(70, 74, 80), width=int(12.6 * S * 0.78 / 1.25))
    d.text((12, 10), title, font=FB, fill=(20, 20, 20))
    d.text(P(-166, 14), 'M1 запад  (EB вправо = юг)', font=FS, fill=(0, 0, 0)); d.text(P(70, -22), 'M1 восток', font=FS, fill=(0, 0, 0)); d.text(P(10, -166), 'M2 север', font=FS, fill=(0, 0, 0)); d.text(P(10, 160), 'M2 юг', font=FS, fill=(0, 0, 0))
    # host travel arrows (right-hand): EB on the south half, WB on the north half, SB on the west half, NB on the east half
    def arr(p, q, col=(255, 255, 255)):
        d.line([p, q], fill=col, width=3); ang = math.atan2(q[1] - p[1], q[0] - p[0])
        for s_ in (-0.5, 0.5): d.line([q, (q[0] - 11 * math.cos(ang + s_), q[1] - 11 * math.sin(ang + s_))], fill=col, width=3)
    for x in (-150, 110): arr(P(x, 7.4), P(x + 22, 7.4)); arr(P(-x - 22 + 0, -7.4), P(-x - 0, -7.4))
    for z in (-150, 110): arr(P(7.4, z + 22), P(7.4, z)); arr(P(-7.4, -z - 22), P(-7.4, -z))
    return im, d
def ramp(d, pl, level, label=None, lab_at=0.5, arrows=(0.35, 0.7)):
    pts = [P(*p) for p in pl]; d.line(pts, fill=COL[level], width=7)
    for f in arrows:
        i = max(1, min(len(pts) - 1, int(len(pts) * f))); p, q = pts[i - 1], pts[i]; ang = math.atan2(q[1] - p[1], q[0] - p[0])
        for s_ in (-0.45, 0.45): d.line([q, (q[0] - 15 * math.cos(ang + s_), q[1] - 15 * math.sin(ang + s_))], fill=(255, 255, 255), width=4)
    if label:
        i = int(len(pts) * lab_at); d.text((pts[i][0] + 6, pts[i][1] - 20), label, font=FS, fill=(10, 10, 10))
    return length(pl)
def legend(d, items, lines):
    y = H - 175
    d.rectangle([8, y - 6, 560, H - 8], fill=(245, 245, 240), outline=(90, 90, 90))
    for k, (lv, t) in enumerate(items): d.line([(20, y + 14 + 24 * k), (60, y + 14 + 24 * k)], fill=COL[lv], width=7); d.text((70, y + 5 + 24 * k), t, font=F, fill=(0, 0, 0))
    for k, t in enumerate(lines): d.text((20, y + 5 + 24 * len(items) + 20 * k), t, font=FS, fill=(0, 0, 0))
    d.line([P(-170, 168), P(-170 + 40, 168)], fill=(0, 0, 0), width=4); d.text(P(-166, 150), '40 м игровых = 100 м реальных', font=FS, fill=(0, 0, 0))
    d.text((W - 130, 20), 'N ↑', font=FB, fill=(0, 0, 0))
results = {}
# ---------- right turns: four slip ramps, the same in every variant (exit on the right, enter on the right)
def slips(d, lv=0, k=50):
    L = 0
    L += ramp(d, bez((-118, 4.9), (-118 + k, 4.9), (-4.9, 118 - k), (-4.9, 118)), lv, 'EB→S', 0.5)
    L += ramp(d, bez((-4.9, -118), (-4.9, -118 + k), (-118 + k, -4.9), (-118, -4.9)), lv, 'SB→W', 0.5)
    L += ramp(d, bez((118, -4.9), (118 - k, -4.9), (4.9, -118 + k), (4.9, -118)), lv, 'WB→N', 0.5)
    L += ramp(d, bez((4.9, 118), (4.9, 118 - k), (118 - k, 4.9), (118, 4.9)), lv, 'NB→E', 0.5)
    return L
# ---------- Variant A: four-level STACK (all left turns semi-direct flyovers, left exits and left entries, straight diagonals)
im, d = base('Вариант A: четырёхуровневый «стек» (направленная развязка)')
tot = slips(d, 0)
lefts = [('EB→N', (-135, 2.5), (-110, 2.5), (2.5, -110), (2.5, -135), 1), ('NB→W', (2.5, 135), (2.5, 110), (-110, -2.5), (-135, -2.5), 2), ('WB→S', (135, -2.5), (110, -2.5), (-2.5, 110), (-2.5, 135), 1), ('SB→E', (-2.5, -135), (-2.5, -110), (110, 2.5), (135, 2.5), 2)]
# the M2 / M1 axes cross at level 4 / level 1; the left ramps use levels 2 and 3
for lab, p0, p1, p2, p3, lv in lefts: tot += ramp(d, bez(p0, p1, p2, p3), lv, lab, 0.5)
results['A'] = tot
legend(d, [(0, 'уровень 1-2: правоповоротные съезды у земли (4 x ~190 м)'), (1, 'уровень 2: левоповоротные эстакады (2 шт.)'), (2, 'уровень 3: левоповоротные эстакады (2 шт.)')], ['M1 на высоте 4-го уровня, M2 на земле (уровень 1)', 'все 12 манёвров прямые, без петель и без переплетения', 'площадь узла ~ 270 x 270 игровых м (675 x 675 м)'])
im.save(OUT + '/interchange-A-stack.png')
# ---------- Variant B: TURBINE (left turns on four spiral ramps, left exits, 3 levels)
im, d = base('Вариант B: «турбина» (спиральные левоповоротные съезды)')
tot = slips(d, 0, 12)   # right turns on the OUTSIDE (large radius), spirals inside
tl = [('EB→N', (-135, 2.5), (-60, 2.5), (-8, -20), (2.5, -135), 1), ('NB→W', (2.5, 135), (2.5, 55), (20, 8), (-135, -2.5), 1), ('WB→S', (135, -2.5), (60, -2.5), (8, 20), (-2.5, 135), 1), ('SB→E', (-2.5, -135), (-2.5, -55), (-20, -8), (135, 2.5), 1)]
# spirals: the ramp leaves the inner lane, swings round the centre on a radius of 28-45 m and joins the other road from its left; every ramp crosses the other carriageways at the middle level
spirals = []
for lab, a, b in [('EB→N', 0, 1), ('SB→E', 1, 2), ('WB→S', 2, 3), ('NB→W', 3, 0)]:
    pass
turb = [('EB→N', bez((-135, 2.5), (-45, 2.5), (2.5, -45), (2.5, -135))), ('SB→E', bez((-2.5, -135), (-2.5, -45), (45, 2.5), (135, 2.5))),
        ('WB→S', bez((135, -2.5), (45, -2.5), (-2.5, 45), (-2.5, 135))), ('NB→W', bez((2.5, 135), (2.5, 45), (-45, -2.5), (-135, -2.5)))]
for lab, pl in turb: tot += ramp(d, pl, 1, lab, 0.5)
results['B'] = tot
legend(d, [(0, 'уровень 1: правоповоротные съезды у земли'), (1, 'уровень 2: 4 спиральных левоповоротных съезда (R 28-45 м)')], ['M1 поверх (уровень 3), M2 на земле; каждый спиральный съезд пересекает два потока', 'все 12 манёвров прямые, переплетения нет', 'площадь узла ~ 220 x 220 игровых м (550 x 550 м)'])
im.save(OUT + '/interchange-B-turbine.png')
# ---------- Variant C: HYBRID (two loops in NE / SW, two semi-direct flyovers in NW / SE), three levels
im, d = base('Вариант C: гибрид (2 петли + 2 полупрямые эстакады)')
tot = slips(d, 0)
# loops (left turns, exit right, 270 deg clockwise): NB->W in the NE... we keep the right-hand cloverleaf rule: exit right AFTER the crossing, loop clockwise.
# SB (west half) -> E: exit right (west) after the crossing, loop clockwise through W, N... in the SW quadrant: centre (-42, 42) r 20
loop1 = bez((-4.9, 30), (-4.9, 50), (-12, 64), (-24, 64)) + arc((-24, 44), 20, 90, 180 + 90 - 270 + 360 - 0, 1)[0:1]
l1 = arc((-24, 44), 20, 90, 360, 90); loop_sw = [(-4.9, 20)] + [(-4.9, 44)] + [(p[0], p[1]) for p in l1][:] 
# simple explicit loops: SB->E leaves SB at z 20, goes south then clockwise 270: south -> west -> north -> east, joining EB from the south (right) at x 30
sw = bez((-4.9, 20), (-4.9, 36), (-8, 44), (-24, 64)) + arc((-24, 44), 20, 90, 360, 60)[1:] + bez((-4, 44), (6, 44), (16, 18), (30, 4.9))[1:]
ne = [(-x, -z) for x, z in sw]   # NB->W: the same turned by 180 degrees (exit right after the crossing, clockwise loop in the NE quadrant)
tot += ramp(d, sw, 0, 'SB→E (петля R 20)', 0.45); tot += ramp(d, ne, 0, 'NB→W (петля R 20)', 0.45)
# semi-direct flyovers: EB->N (exit right at x -125, runs round the SE outside, crosses M2 on the second level, joins NB from the right) and WB->S
nw = bez((-125, 4.9), (-70, 4.9), (-30, 30), (70, 40)) + bez((70, 40), (100, 44), (112, 10), (112, -40))[1:] + bez((112, -40), (112, -60), (60, -50), (4.9, -118))[1:]
se = [(-x, -z) for x, z in nw]
tot += ramp(d, nw, 1, 'EB→N (полупрямая)', 0.4); tot += ramp(d, se, 1, 'WB→S (полупрямая)', 0.4)
results['C'] = tot
legend(d, [(0, 'уровень 1: 4 съезда вправо + 2 петли R 20 (у земли)'), (1, 'уровень 2: 2 полупрямые эстакады длиной ~ 260-300 м')], ['M1 на уровне 3 над M2; петли и эстакады по 2 диагональным квадрантам', 'переплетение только на двух петлях (SW, NE), 2 из 4 левых манёвров прямые', 'площадь узла ~ 260 x 260 игровых м (650 x 650 м)'])
im.save(OUT + '/interchange-C-hybrid.png')
print({k: round(v) for k, v in results.items()})
