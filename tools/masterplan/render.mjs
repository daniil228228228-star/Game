// Рисовальщик SVG для генплана. Всё в пикселях, шкала s px/м. Размеры дорог - в настоящих метрах игры (с минимумом для читаемости).
import { P, arc, polarOf, dist, xf, D2R, polyLen, r1 } from './lib.mjs';
import { CLS } from './plan-core.mjs';
import { existingRoads, EX } from './plan-fab.mjs';

export const FONT = "'DejaVu Sans','Liberation Sans',Arial,sans-serif";
export const PH = { 0: ['#6b7280', 'Существует'], 1: ['#e4572e', 'Фаза 1: порт и кольцо'], 2: ['#f3a712', 'Фаза 2: север и промпарк'], 3: ['#6ab04c', 'Фаза 3: восток и CBD'], 4: ['#1b9aaa', 'Фаза 4: река, М1, развязка'], 5: ['#3d5a80', 'Фаза 5: грузовая жд'], 6: ['#9b5de5', 'Фаза 6: вокзал и трамвай'], 7: ['#e056a0', 'Фаза 7: набережная, соцобъекты'], 8: ['#111827', 'Фаза 8: аэропорт, метро (резерв)'] };
const ZC = { 'res-low': '#f7e7a8', 'res-mid': '#f3cf8f', cbd: '#ebaaa8', mixed: '#f3c29a', 'industry-heavy': '#b7a5cc', 'industry-light': '#d0c3df', port: '#a5bdd4', park: '#c2e3a6', forest: '#a7cf93', public: '#b9c8ea', utility: '#d0d0cc', freight: '#d9c7b4', station: '#efb9da', old: '#f3e8cb', waterfront: '#aedbe8', service: '#e6e1d2', airport: '#d6d6d6' };
const ZN = { 'res-low': 'Жилая малоэтажная', 'res-mid': 'Жилая среднеэтажная', cbd: 'Деловая / высотная', mixed: 'Смешанная', 'industry-heavy': 'Тяжёлая промышленность / порт', 'industry-light': 'Лёгкая индустрия / склады', port: 'Порт', park: 'Парк / спорт', forest: 'Лес / зелёный пояс', public: 'Общественная (больница, вуз)', utility: 'Коммунальная', freight: 'Грузовой парк', station: 'Вокзальная', old: 'Старый город', waterfront: 'Набережная', service: 'Сервис' };
const LOTC = { 'res-low': '#e3b45c', mixed: '#d98a4b', cbd: '#c85a5a', 'industry-light': '#8e7aa8', port: '#6f8fb0', 'res-mid': '#d99b52', 'industry-heavy': '#8168a0' };
const ROADC = { expressway: ['#7a1f12', '#e8643a'], ramp: ['#7a1f12', '#e8643a'], arterial: ['#6b4a00', '#f2b134'], avenue: ['#6b5a00', '#f8d46a'], collector: ['#4d4d4d', '#ffffff'], local: ['#6a6a6a', '#fbfbf7'], service: ['#6a6a6a', '#eeeeee'], quay: ['#4d6a7a', '#e6f2f7'], ped: ['#7a6a4a', '#f2e6c2'], old: ['#3b4350', '#aab2bd'] };
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class Canvas {
  constructor({ x0, z0, wM, hM, s, pad = 0, extraH = 0, bg = '#fff' }) { Object.assign(this, { x0, z0, wM, hM, s, pad, extraH, bg }); this.W = Math.round(wM * s + pad * 2); this.H = Math.round(hM * s + pad * 2 + extraH); this.o = []; this.defs = []; this.layer = ''; }
  X(x) { return (x - this.x0) * this.s + this.pad; }
  Z(z) { return (z - this.z0) * this.s + this.pad; }
  pt(p) { return `${this.X(p[0]).toFixed(1)},${this.Z(p[1]).toFixed(1)}`; }
  add(s) { this.o.push(s); }
  path(pts, a = {}, close = false) { if (pts.length < 2) return; this.add(`<path d="M${pts.map((p) => this.pt(p)).join('L')}${close ? 'Z' : ''}" ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`); }
  poly(pts, a = {}) { this.path(pts, a, true); }
  circle(c, rM, a = {}) { this.add(`<circle cx="${this.X(c[0]).toFixed(1)}" cy="${this.Z(c[1]).toFixed(1)}" r="${(rM * this.s).toFixed(1)}" ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`); }
  text(p, str, { size = 20, fill = '#111', weight = 'bold', anchor = 'middle', halo = '#fff', haloW = 5, rot = 0, lh = 1.12, opacity = 1, family = FONT } = {}) {
    const lines = String(str).split('\n'), x = this.X(p[0]), y = this.Z(p[1]);
    const tr = rot ? ` transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"` : '';
    const body = lines.map((l, i) => `<tspan x="${x.toFixed(1)}" dy="${i === 0 ? (-(lines.length - 1) * 0.5 * size * lh + size * 0.35).toFixed(1) : (size * lh).toFixed(1)}">${esc(l)}</tspan>`).join('');
    this.add(`<text y="${y.toFixed(1)}"${tr} font-family="${family}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}" opacity="${opacity}" ${halo ? `stroke="${halo}" stroke-width="${haloW}" stroke-linejoin="round" paint-order="stroke"` : ''}>${body}</text>`);
  }
  // подпись вдоль дороги
  textPath(pts, str, { size = 15, fill = '#222', halo = '#fff', off = 0, start = 50, id } = {}) {
    let p = pts; if (p[0][0] > p[p.length - 1][0]) p = [...p].reverse();
    const pid = id || 'tp' + this.defs.length;
    this.defs.push(`<path id="${pid}" d="M${p.map((q) => this.pt(q)).join('L')}" fill="none"/>`);
    this.add(`<text font-family="${FONT}" font-size="${size}" font-weight="bold" fill="${fill}" stroke="${halo}" stroke-width="${size * 0.32}" paint-order="stroke" stroke-linejoin="round" dy="${size * 0.34 + off}"><textPath href="#${pid}" startOffset="${start}%" text-anchor="middle">${esc(str)}</textPath></text>`);
  }
  raw(x, y, str, { size = 20, fill = '#111', weight = 'bold', anchor = 'start' } = {}) { this.add(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`); }
  svg() { return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.W}" height="${this.H}" viewBox="0 0 ${this.W} ${this.H}"><defs>${this.defs.join('')}</defs><rect width="${this.W}" height="${this.H}" fill="${this.bg}"/>${this.o.join('\n')}</svg>`; }
}

const roadW = (c, r, kind) => Math.max(r.w ?? CLS[r.cls].w, kind === 'old' ? 1.4 : 2.2);
function sector(d, n = 3) { const t1 = d.t1 < d.t0 ? d.t1 + 360 : d.t1; return [...arc(d.t0, t1, d.r1, n), ...arc(t1, d.t0, d.r0, n)]; }
export function sectorPoly(d) { return sector(d); }
function centroidSector(d) { const t1 = d.t1 < d.t0 ? d.t1 + 360 : d.t1, tm = (d.t0 + t1) / 2, rm = (d.r0 + d.r1) / 2; return P(tm, rm); }

export function drawBase(c, plan, o = {}) {
  const s = c.s;
  // море
  c.add(`<rect x="0" y="0" width="${c.W}" height="${c.H}" fill="#a9d4ee"/>`);
  // береговая подсветка
  c.poly(plan.land, { fill: 'none', stroke: '#cfe9f7', 'stroke-width': 26 * s / 4, 'stroke-linejoin': 'round', opacity: 0.8 });
  c.poly(plan.land, { fill: 'none', stroke: '#bfe0f2', 'stroke-width': 14 * s / 4, 'stroke-linejoin': 'round' });
  c.poly(plan.land, { fill: '#f3efe4', stroke: '#b9ad8d', 'stroke-width': 2.2, 'stroke-linejoin': 'round' });
  // сетка 50 м
  for (let g = -150; g <= 150; g += 50) {
    c.path([[g, -plan.meta.extent], [g, plan.meta.extent]], { stroke: '#d9d2bd', 'stroke-width': 1, 'stroke-dasharray': '2 6', opacity: 0.9 });
    c.path([[-plan.meta.extent, g], [plan.meta.extent, g]], { stroke: '#d9d2bd', 'stroke-width': 1, 'stroke-dasharray': '2 6', opacity: 0.9 });
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Вокзал: модуль в локальной системе (u - наружу по радиусу от упоров, v - по касательной)
export function stationModule(plan) {
  const st = plan.stations.find((q) => q.kind === 'pax-terminal'); if (!st) return null;
  const th = st.axisTh, rb = st.rBuf, o = P(th, rb), yaw = th; // локальная ось x = радиально наружу
  const T = (pts) => xf(pts, yaw, o);                          // (u,v) -> мир
  const rect = (u0, u1, v0, v1) => T([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const M = { o, yaw, T };
  M.tracks = [-10.5, -3.5, 3.5, 10.5].map((v) => T([[0, v], [26, v], [34, v * 0.78], [48, Math.sign(v) * 2], [50, Math.sign(v) * 2]]));
  M.platforms = [-7, 0, 7].map((v) => rect(4, 27, v - 1.7, v + 1.7));
  M.canopies = [-7, 0, 7].map((v) => rect(6, 25, v - 1.0, v + 1.0));
  M.concourse = rect(-4, 0, -15, 15);
  M.building = rect(-13, -4, -18, 18);
  M.tower = rect(-10, -7, -2, 2);
  M.plaza = rect(-27, -13, -23, 23);
  M.bus = [0, 1, 2, 3, 4].map((i) => rect(-25 + i * 2.6, -23.2 + i * 2.6, 24.5, 29));
  M.busRoad = T([[-27, 23], [-27, 31], [-10, 31], [-10, 23]]);
  M.taxi = [0, 1, 2, 3].map((i) => rect(-25 + i * 3, -22.4 + i * 3, -27, -23.4));
  M.parking = [rect(-28, -8, -42, -29), rect(-28, -8, 32, 42)];
  M.boulevard = T([[-27, 0], [-34, 0]]);
  M.bridgeSpan = T([[40, -9], [40, 9]]);
  return M;
}
