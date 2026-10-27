// Общее ядро описания плана: классы дорог, сборка узлов/рёбер, генератор кварталов и лотов (периметральная застройка), развязки.
import { P, arc, catmull, bez, dist, polyLen, segDist, polyDist, inPoly, rot, xf, smooth, polarOf, frontageLots, D2R, r1 } from './lib.mjs';

// Классы дорог. w = полная ширина проезжей части в метрах игры (полоса ~1,8 м, грузовик 1,15 м, дом 4-5 м). sw = тротуар с каждой стороны.
export const CLS = {
  expressway: { ru: 'Скоростная магистраль', w: 14, sw: 0, lanes: 4, speed: 3.2 },
  ramp:       { ru: 'Съезд / въезд', w: 3.0, sw: 0, lanes: 1, speed: 2.0 },
  arterial:   { ru: 'Магистраль (кольцо)', w: 7.6, sw: 1.4, lanes: 4, speed: 2.4 },
  avenue:     { ru: 'Проспект (радиальный)', w: 9, sw: 1.6, lanes: 4, speed: 2.2 },
  collector:  { ru: 'Сборная улица', w: 5.4, sw: 1.2, lanes: 2, speed: 1.8 },
  local:      { ru: 'Местная улица', w: 3.8, sw: 1.0, lanes: 2, speed: 1.4 },
  service:    { ru: 'Служебный проезд', w: 2.8, sw: 0, lanes: 1, speed: 1.2 },
  quay:       { ru: 'Набережная', w: 6, sw: 2.4, lanes: 2, speed: 1.2 },
  ped:        { ru: 'Пешеходная улица', w: 3.2, sw: 0, lanes: 0, speed: 0 },
  old:        { ru: 'Историческая улочка (существует)', w: 1.8, sw: 0, lanes: 1, speed: 1 },
};

export class Plan {
  constructor(id, name, meta) { Object.assign(this, { id, name, meta, land: [], water: [], roads: [], nodes: [], rails: [], stations: [], districts: [], zones: [], landmarks: [], pads: [], fabrics: [], lots: [], keepout: [], notes: [] }); }
  road(o) {
    const c = CLS[o.cls]; if (!c) throw new Error('cls ' + o.cls);
    const pts = o.pts.map((p) => [r1(p[0]), r1(p[1])]);
    this.roads.push({ level: 0, phase: 1, ...o, w: o.w ?? c.w, sw: o.sw ?? c.sw, lanes: o.lanes ?? c.lanes, pts });
    return o.id;
  }
  node(o) { this.nodes.push({ phase: 1, ...o, x: r1(o.x), z: r1(o.z) }); }
  rail(o) { this.rails.push({ tracks: 2, level: 0, phase: 5, ...o, pts: o.pts.map((p) => [r1(p[0]), r1(p[1])]) }); }
  zone(o) { this.zones.push({ phase: 1, ...o }); }
}

// ---- развязки -------------------------------------------------------------------------------------------------------------
// Клеверный лист (cloverleaf): H = магистраль вдоль локальной оси x, V = пересекающая улица вдоль y. Возвращает массив {id, cls, pts, level}.
export function cloverleaf(id, centre, yawDeg, o = {}) {
  const gV = o.gV ?? 4.4, gH = o.gH ?? 7.5, R = o.R ?? 5.5, tail = o.tail ?? 7, Y1 = gH + 2 * R + 6, X1 = gV + 2 * R + 8;
  const T = (pts) => xf(pts, yawDeg, centre), out = [];
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sy], q) => {
    const cx = sx * (gV + R), cy = sy * (gH + R);
    // надёжнее: строим в первой четверти и отражаем
    const base = [];
    for (let k = 0; k <= 24; k++) { const t = (180 - 270 * k / 24) * D2R; base.push([gV + R + R * Math.cos(t), gH + R + R * Math.sin(t)]); }
    // base начинается в (gV, gH+R) и заканчивается в (gV+R, gH) (через верх и право)
    const loopPts = [[gV, gH + R + tail], ...base, [gV + R + tail, gH]].map(([x, y]) => [sx * x, sy * y]);
    out.push({ id: `${id}-L${q + 1}`, cls: 'ramp', kind: 'loop', pts: T(loopPts), level: 0 });
    // внешний съезд: четверть эллипса с центром (gV,gH)
    const ell = []; for (let k = 0; k <= 16; k++) { const t = (Math.PI / 2) * k / 16; ell.push([gV + (X1 - gV) * Math.sin(t), gH + (Y1 - gH) * Math.cos(t)]); }
    out.push({ id: `${id}-D${q + 1}`, cls: 'ramp', kind: 'diag', pts: T(ell.map(([x, y]) => [sx * x, sy * y])), level: 0 });
  });
  return { ramps: out, extent: Math.max(X1, Y1) };
}
// Стек: 4 правоповоротных съезда (уровень 0) + 4 левоповоротные эстакады (уровень 2) через центр
export function stackIC(id, centre, yawDeg, o = {}) {
  const gV = o.gV ?? 4.4, gH = o.gH ?? 7.5, s = o.s ?? 12, L = o.L ?? 32, out = [], T = (pts) => xf(pts, yawDeg, centre);
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sy], q) => {
    const a = [sx * (gV + 2 * s + 6), sy * gH], b = [sx * gV, sy * (gH + 2 * s + 6)];
    out.push({ id: `${id}-R${q + 1}`, cls: 'ramp', kind: 'right', pts: T(bez(a, [a[0] - sx * s, a[1]], [b[0], b[1] - sy * s], b, 14)), level: 0 });
    const c = [sx * L, -sy * gH], d = [-sx * gV, sy * L];
    out.push({ id: `${id}-F${q + 1}`, cls: 'ramp', kind: 'flyover', pts: T(bez(c, [sx * L * 0.3, -sy * gH * 2.2], [-sx * gV * 2.2, sy * L * 0.3], d, 20)), level: 2 });
  });
  return { ramps: out, extent: L };
}
// Трубка (trumpet): стем V входит в магистраль H. Петля в +x+y, прямой съезд в -x+y
export function trumpetIC(id, centre, yawDeg, o = {}) {
  const gV = o.gV ?? 4.4, gH = o.gH ?? 7.5, R = o.R ?? 6.5, T = (pts) => xf(pts, yawDeg, centre), out = [];
  const base = []; for (let k = 0; k <= 24; k++) { const t = (180 - 270 * k / 24) * D2R; base.push([gV + R + R * Math.cos(t), gH + R + R * Math.sin(t)]); }
  out.push({ id: `${id}-L1`, cls: 'ramp', kind: 'loop', pts: T([[gV, gH + R + 8], ...base, [gV + R + 8, gH]]), level: 0 });
  const d1 = [-gV, gH + 26], d2 = [-(gV + 24), gH];
  out.push({ id: `${id}-D1`, cls: 'ramp', kind: 'diag', pts: T(bez(d1, [-gV, gH + 8], [-gV - 10, gH], d2, 16)), level: 0 });
  const e1 = [gV + 30, -gH], e2 = [gV + 2, -gH - 26];
  out.push({ id: `${id}-D2`, cls: 'ramp', kind: 'diag', pts: T(bez(e1, [gV + 14, -gH], [gV + 2, -gH - 8], e2, 16)), level: 0 });
  return { ramps: out, extent: 30 };
}

// ---- кварталы и лоты ------------------------------------------------------------------------------------------------------
// Периметральный квартал по четырёхугольнику q=[c00,c10,c11,c01] (после отступа на полуширину улиц): лоты по 4 сторонам глубиной d + двор.
export function perimeterBlock(q, d, front, gap = 0.6) {
  const lots = [], n = 4, cx = q.reduce((s, p) => s + p[0], 0) / 4, cz = q.reduce((s, p) => s + p[1], 0) / 4;
  const side = (a, b) => { // inward normal
    const L = dist(a, b), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; let nx = -uz, nz = ux;
    if ((cx - a[0]) * nx + (cz - a[1]) * nz < 0) { nx = -nx; nz = -nz; } return { L, ux, uz, nx, nz };
  };
  for (let i = 0; i < n; i++) {
    const a = q[i], b = q[(i + 1) % n], s = side(a, b);
    // концы сторон уступают место угловым лотам
    const a2 = [a[0] + s.ux * d, a[1] + s.uz * d], b2 = [b[0] - s.ux * d, b[1] - s.uz * d];
    if (dist(a2, b2) > front * 0.9) lots.push(...frontageLots(a2, b2, [s.nx, s.nz], d, front, gap).map((l) => ({ ...l, side: i })));
    // угловой лот: квадрат d x d в вершине a, фасад на сторону i
    const c = [a[0], a[1]];
    const sp = side(q[(i + n - 1) % n], a);
    const A = [c[0] + gap / 2 * s.ux, c[1] + gap / 2 * s.uz], B = [c[0] + s.ux * (d - gap / 2), c[1] + s.uz * (d - gap / 2)];
    lots.push({ poly: [A, B, [B[0] + s.nx * d, B[1] + s.nz * d], [A[0] + s.nx * d, A[1] + s.nz * d]], door: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], normal: [-s.nx, -s.nz], w: d - gap, d, corner: true, side: i });
  }
  return lots;
}
// Лот -> компактная запись для JSON
export const lotRec = (l, kind, fid) => ({ c: [r1(l.poly.reduce((s, p) => s + p[0], 0) / 4), r1(l.poly.reduce((s, p) => s + p[1], 0) / 4)], p: l.poly.map((p) => [r1(p[0]), r1(p[1])]), door: [r1(l.door[0]), r1(l.door[1])], k: kind, f: fid, w: r1(l.w), d: r1(l.d) });
