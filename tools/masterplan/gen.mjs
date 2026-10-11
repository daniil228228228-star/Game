// Генератор схем генплана v161: node tools/masterplan/gen.mjs [--plan A|B|all] [--out docs/masterplan] [--png]
// Читает plan-A.json / plan-B.json (их пишут build-A.mjs / build-B.mjs) и existing.json, пишет SVG (и PNG через playwright-chromium, если есть).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P, arc, polarOf, dist, xf, D2R, polyLen, r1 } from './lib.mjs';
import { CLS } from './plan-core.mjs';
import { existingRoads, EX } from './plan-fab.mjs';
import { Canvas, drawBase, sectorPoly, stationModule, FONT, PH } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = path.resolve(HERE, '..', '..', opt('out', 'docs/masterplan'));
fs.mkdirSync(OUT, { recursive: true });

const ZC = { 'res-low': '#f7e7a8', 'res-mid': '#f3cf8f', cbd: '#ebaaa8', mixed: '#f3c29a', 'industry-heavy': '#b7a5cc', 'industry-light': '#d0c3df', port: '#a5bdd4', park: '#c2e3a6', forest: '#a7cf93', public: '#b9c8ea', utility: '#d0d0cc', freight: '#d9c7b4', station: '#efb9da', old: '#f3e8cb', waterfront: '#aedbe8', service: '#e6e1d2', airport: '#d6d6d6' };
const ZN = { 'res-low': 'Жилая малоэтажная', 'res-mid': 'Жилая среднеэтажная', cbd: 'Деловая / высотная', mixed: 'Смешанная', 'industry-heavy': 'Тяжёлая промышленность, порт', 'industry-light': 'Лёгкая индустрия, склады', park: 'Парк, спорт', forest: 'Лес, зелёный пояс', public: 'Больница, университет', utility: 'Коммунальная зона', freight: 'Грузовой парк', station: 'Вокзальный район', old: 'Старый город (существует)', waterfront: 'Набережная', port: 'Порт' };
const LOTC = { 'res-low': '#dba94f', mixed: '#d68244', cbd: '#c24f52', 'industry-light': '#8a74a6', port: '#6389ae', 'res-mid': '#d5934a', 'industry-heavy': '#7d63a0' };
const ROADC = { expressway: ['#701a0e', '#ee6c3c'], ramp: ['#701a0e', '#ee6c3c'], arterial: ['#6b4a00', '#f4b938'], avenue: ['#6b5a00', '#fadb7c'], collector: ['#4d4d4d', '#ffffff'], local: ['#7a7a7a', '#fffefa'], service: ['#6a6a6a', '#eeeeee'], quay: ['#4d6a7a', '#e6f2f7'], ped: ['#7a6a4a', '#f2e6c2'], old: ['#3b4350', '#aeb6c1'] };
const RANK = { local: 0, service: 1, old: 1, ped: 2, collector: 3, quay: 3, avenue: 4, arterial: 5, ramp: 4, expressway: 6 };

function bbox(pts) { let a = [1e9, 1e9, -1e9, -1e9]; pts.forEach((p) => { a = [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])]; }); return a; }

// ---- слои ------------------------------------------------------------------------------------------------------------------
function layerZones(c, plan, o) {
  c.defs.push(`<clipPath id="land"><path d="M${plan.land.map((p) => c.pt(p)).join('L')}Z"/></clipPath>`);
  c.defs.push(`<pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="9" stroke="#8a8372" stroke-width="1.6" opacity=".35"/></pattern>`);
  c.add('<g clip-path="url(#land)">');
  for (const d of plan.districts) {
    if (d.offmap) continue;
    const poly = d.poly || (d.r0 === 0 ? arc(0, 360, d.r1, 3) : sectorPoly(d));
    const col = o.zoneColor ? o.zoneColor(d) : ZC[d.type] || '#ddd';
    c.poly(poly, { fill: col, opacity: d.frozen ? 0.55 : 0.85, stroke: o.mono ? '#b9ad8d' : '#ffffff', 'stroke-width': 1.4, 'stroke-opacity': 0.9 });
    if (d.frozen && !o.noHatch) c.poly(poly, { fill: 'url(#hatch)', stroke: 'none' });
    // деревья на парках / лесу
    if (d.type === 'park' || d.type === 'forest') {
      const [x0, z0, x1, z1] = bbox(poly); const seed = (d.id.length * 7919) % 97; let k = seed;
      const rnd = () => { k = (k * 1103515245 + 12345) & 0x7fffffff; return k / 0x7fffffff; };
      for (let n = 0; n < 160; n++) { const p = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)]; if (!inPoly2(p, poly)) continue; c.circle(p, 1.6 + rnd() * 1.2, { fill: d.type === 'forest' ? '#6fa65f' : '#8cc577', opacity: 0.75 }); }
    }
  }
  c.add('</g>');
}
function inPoly2(p, poly) { let cc = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) cc = !cc; } return cc; }

function layerWater(c, plan, o) {
  for (const w of plan.water) {
    if (!w.pts) continue;
    if (o.phaseOnly && o.phaseOnly(w.phase) === false) continue;
    c.path(w.pts, { fill: 'none', stroke: '#7fb3d9', 'stroke-width': (w.w + 3) * c.s, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    c.path(w.pts, { fill: 'none', stroke: '#a9d4ee', 'stroke-width': w.w * c.s, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    // течение
    c.path(w.pts, { fill: 'none', stroke: '#e3f2fb', 'stroke-width': 1.5, 'stroke-dasharray': '10 22', opacity: 0.9 });
    if (o.labels !== false) { const mid = w.pts[Math.floor(w.pts.length * 0.3)]; c.textPath(w.pts, w.name, { size: 24, fill: '#1c5a8a', halo: '#e8f4fb', start: 36 }); }
  }
}

function drawRoad(c, r, o) {
  const cls = r.cls, w = Math.max(r.w ?? CLS[cls].w, cls === 'old' ? 1.5 : 2.4), col = o.roadColor ? o.roadColor(r) : ROADC[cls];
  const lw = w * c.s;
  if (r.level >= 1 || r.bridge) c.path(r.pts, { fill: 'none', stroke: '#ffffff', 'stroke-width': lw + 9, 'stroke-linecap': 'butt', opacity: 0.95 });
  c.path(r.pts, { fill: 'none', stroke: col[0], 'stroke-width': lw + 3.2, 'stroke-linecap': r.level ? 'butt' : 'round', 'stroke-linejoin': 'round' });
  c.path(r.pts, { fill: 'none', stroke: col[1], 'stroke-width': lw, 'stroke-linecap': r.level ? 'butt' : 'round', 'stroke-linejoin': 'round' });
  if (cls === 'expressway' || cls === 'arterial' || cls === 'avenue') c.path(r.pts, { fill: 'none', stroke: cls === 'expressway' ? '#fff' : '#a07b00', 'stroke-width': Math.max(1.2, lw * 0.07), 'stroke-dasharray': cls === 'expressway' ? '14 10' : '9 9', opacity: 0.9 });
  if (r.tram) c.path(r.pts, { fill: 'none', stroke: '#2f6f3e', 'stroke-width': Math.max(2.2, lw * 0.16), 'stroke-dasharray': '2 3' });
  if (r.bus && !o.noBus) c.path(r.pts, { fill: 'none', stroke: '#d7263d', 'stroke-width': Math.max(1.4, lw * 0.07), opacity: 0.0 });
}
function layerRoads(c, plan, o) {
  let roads = plan.roads.filter((r) => !(o.filter && !o.filter(r)));
  if (o.existing) roads = [...o.existingList.filter((r) => !(o.filter && !o.filter(r))), ...roads];
  roads = [...roads].sort((a, b) => ((a.level || 0) - (b.level || 0)) || (RANK[a.cls] - RANK[b.cls]));
  // дороги без мостов сначала: фон (casing) всех, потом fill - чтобы перекрёстки сливались
  const low = roads.filter((r) => !(r.level >= 1 || r.bridge)), high = roads.filter((r) => r.level >= 1 || r.bridge);
  const colOf = (r) => (o.roadColor ? o.roadColor(r) : ROADC[r.cls]);
  const cas = (r, pass) => {
    const w = Math.max(r.w ?? CLS[r.cls].w, r.cls === 'old' ? 1.5 : 2.4) * c.s;
    c.path(r.pts, { fill: 'none', stroke: colOf(r)[0], 'stroke-width': w + 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  };
  const fil = (r) => {
    const w = Math.max(r.w ?? CLS[r.cls].w, r.cls === 'old' ? 1.5 : 2.4) * c.s;
    c.path(r.pts, { fill: 'none', stroke: colOf(r)[1], 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    if (['expressway', 'arterial', 'avenue'].includes(r.cls)) c.path(r.pts, { fill: 'none', stroke: r.cls === 'expressway' ? '#ffffff' : '#9a7300', 'stroke-width': Math.max(1.2, w * 0.06), 'stroke-dasharray': r.cls === 'expressway' ? '14 10' : '10 10', opacity: 0.85 });
    if (r.tram) c.path(r.pts, { fill: 'none', stroke: '#2f6f3e', 'stroke-width': Math.max(2.4, w * 0.15), 'stroke-dasharray': '3 3' });
  };
  // по рангу: все casing ранга k, затем fill ранга k (больший ранг сверху)
  const ranks = [...new Set(low.map((r) => RANK[r.cls]))].sort((a, b) => a - b);
  for (const rk of ranks) { const g = low.filter((r) => RANK[r.cls] === rk); g.forEach(cas); g.forEach(fil); }
  high.forEach((r) => { drawRoad(c, r, o); });
}
function layerRails(c, plan, o) {
  for (const r of plan.rails) {
    if (o.railFilter && !o.railFilter(r)) continue;
    if (r.kind === 'tunnel') { c.path(r.pts, { fill: 'none', stroke: '#7a3fb0', 'stroke-width': 4, 'stroke-dasharray': '12 8' }); continue; }
    const col = o.railColor ? o.railColor(r) : '#4a4a52';
    const w = (r.kind === 'yard' || r.kind === 'siding' ? 1.6 : 1.6 * Math.min(r.tracks || 1, 2) + 1.2) * c.s;
    if (r.level >= 1) c.path(r.pts, { fill: 'none', stroke: '#ffffff', 'stroke-width': w + 8, opacity: 0.9 });
    c.path(r.pts, { fill: 'none', stroke: col, 'stroke-width': w + 2.6, 'stroke-linecap': 'butt' });
    c.path(r.pts, { fill: 'none', stroke: '#f6f6f6', 'stroke-width': w, 'stroke-linecap': 'butt' });
    c.path(r.pts, { fill: 'none', stroke: col, 'stroke-width': w, 'stroke-dasharray': `${(2.2 * c.s).toFixed(1)} ${(2.2 * c.s).toFixed(1)}` });
  }
}
function layerLots(c, plan, o) {
  for (const l of plan.lots) {
    if (o.lotFilter && !o.lotFilter(l)) continue;
    const col = o.lotColor ? o.lotColor(l) : LOTC[l.k] || '#c9a35f';
    c.poly(l.p, { fill: col, stroke: '#fffdf4', 'stroke-width': 0.8, opacity: o.lotOpacity ?? 0.96 });
    if (!o.noDoors) c.circle(l.door, 0.5, { fill: '#fffdf4', opacity: 0.9 });
  }
}
function layerNodes(c, plan, o) {
  for (const n of plan.nodes) {
    if (o.nodeFilter && !o.nodeFilter(n)) continue;
    if (n.type === 'roundabout') {
      c.circle([n.x, n.z], n.r, { fill: '#ffffff', stroke: '#2a2a2a', 'stroke-width': 2.4 });
      c.circle([n.x, n.z], n.r * 0.58, { fill: '#9fcf7d', stroke: '#4d7a3a', 'stroke-width': 1.6 });
      c.circle([n.x, n.z], n.r * 0.86, { fill: 'none', stroke: '#f4b938', 'stroke-width': Math.max(2.5, 0.35 * n.r * c.s * 0.5) });
    } else if (n.type === 'level-crossing') {
      c.circle([n.x, n.z], 3.4, { fill: '#fff', stroke: '#d7263d', 'stroke-width': 3 });
      c.path([[n.x - 3, n.z - 3], [n.x + 3, n.z + 3]], { stroke: '#d7263d', 'stroke-width': 3 }); c.path([[n.x - 3, n.z + 3], [n.x + 3, n.z - 3]], { stroke: '#d7263d', 'stroke-width': 3 });
    } else if (n.type === 'terminus') {
      c.circle([n.x, n.z], 2.6, { fill: '#fff', stroke: '#2a2a2a', 'stroke-width': 2.2 });
    }
  }
}
function layerBridgeLabels(c, plan, o) {
  for (const r of plan.roads) if (r.bridge && r.name && r.span) {
    const m = r.pts[Math.floor(r.pts.length / 2)] || r.pts[0];
    // риски устоев
    const a = r.pts[0], b = r.pts[r.pts.length - 1], vx = b[0] - a[0], vz = b[1] - a[1], L = Math.hypot(vx, vz), nx = -vz / L, nz = vx / L, hw = (r.w + 3.2) / 2;
    [a, b].forEach((q) => c.path([[q[0] + nx * hw, q[1] + nz * hw], [q[0] - nx * hw, q[1] - nz * hw]], { stroke: '#222', 'stroke-width': 4 }));
  }
}
function layerStations(c, plan, o) {
  for (const st of plan.stations) if (st.shapes) {
    for (const s of st.shapes) {
      if (s.t === 'track') { c.path(s.pts, { stroke: '#4a4a52', 'stroke-width': 1.4 * c.s, fill: 'none' }); c.path(s.pts, { stroke: '#f2f2f2', 'stroke-width': 0.8 * c.s, fill: 'none', 'stroke-dasharray': `${1.6 * c.s} ${1.4 * c.s}` }); }
      else { c.poly(s.pts, { fill: s.fill, stroke: s.stroke, 'stroke-width': 1.6 }); if (s.label) c.text([(s.pts[0][0] + s.pts[2][0]) / 2, (s.pts[0][1] + s.pts[2][1]) / 2], s.label, { size: s.label.length > 3 ? 15 : 22, fill: s.label === 'ВОКЗАЛ' ? '#fff' : '#3b4a63', halo: s.label === 'ВОКЗАЛ' ? '#6a1e48' : '#fff', haloW: 4 }); }
    }
  }
  const M = stationModule(plan); if (!M) return;
  const full = o.detail;
  M.tracks.forEach((t) => { c.path(t, { stroke: '#4a4a52', 'stroke-width': (full ? 1.1 : 1.2) * c.s, fill: 'none' }); c.path(t, { stroke: '#f2f2f2', 'stroke-width': (full ? 0.6 : 0.7) * c.s, fill: 'none', 'stroke-dasharray': `${1.5 * c.s} ${1.2 * c.s}` }); });
  M.platforms.forEach((p) => c.poly(p, { fill: '#d9d4c7', stroke: '#6b6558', 'stroke-width': 1.4 }));
  M.canopies.forEach((p) => c.poly(p, { fill: '#8aa0b8', opacity: 0.8, stroke: '#41546b', 'stroke-width': 1 }));
  c.poly(M.plaza, { fill: '#ece6d6', stroke: '#9a917c', 'stroke-width': 1.4 });
  c.poly(M.concourse, { fill: '#f0a0c4', stroke: '#7a2a56', 'stroke-width': 1.6 });
  c.poly(M.building, { fill: '#e277ab', stroke: '#6a1e48', 'stroke-width': 2 });
  c.poly(M.tower, { fill: '#7a2a56', stroke: '#fff', 'stroke-width': 1 });
  M.bus.forEach((b) => c.poly(b, { fill: '#3b78c4', stroke: '#fff', 'stroke-width': 0.8 }));
  M.taxi.forEach((b) => c.poly(b, { fill: '#f0c419', stroke: '#6a5600', 'stroke-width': 0.8 }));
  M.parking.forEach((b) => { c.poly(b, { fill: '#cfd8e3', stroke: '#6b7a8f', 'stroke-width': 1.2 }); });
  c.path(M.busRoad, { fill: 'none', stroke: '#fff', 'stroke-width': 2.4 * c.s, 'stroke-linecap': 'round' });
  if (full) {
    // разметка стоянок
    M.parking.forEach((b) => { const [a, , cc] = b; for (let i = 1; i < 9; i++) { const t = i / 9; c.path([[a[0] + (b[1][0] - a[0]) * t, a[1] + (b[1][1] - a[1]) * t], [b[3][0] + (cc[0] - b[3][0]) * t, b[3][1] + (cc[1] - b[3][1]) * t]], { stroke: '#8795aa', 'stroke-width': 1 }); } });
    const m = (p) => [(p[0][0] + p[2][0]) / 2, (p[0][1] + p[2][1]) / 2];
    c.text(m(M.building), 'ВОКЗАЛ', { size: 17, fill: '#fff', halo: '#6a1e48', haloW: 4 });
    c.text(m(M.parking[0]), 'P', { size: 24, fill: '#3b4a63', halo: '#fff' }); c.text(m(M.parking[1]), 'P', { size: 24, fill: '#3b4a63', halo: '#fff' });
    c.text(m(M.plaza), 'Вокзальная\nплощадь', { size: 14, fill: '#4a4332', halo: '#ece6d6', haloW: 3 });
    c.text([M.bus[2][0][0] + 4, M.bus[2][0][1] + 6], 'автовокзал', { size: 12, fill: '#1c4f91', halo: '#fff', haloW: 3 });
    c.text(m(M.taxi[1]), 'такси', { size: 12, fill: '#5a4a00', halo: '#fff', haloW: 3 });
    M.platforms.forEach((p, i) => c.text(m(p), `П${i + 1}`, { size: 12, fill: '#33302a', halo: '#d9d4c7', haloW: 3 }));
  }
}

function layerExistingMarks(c, plan, o) {
  const s = c.s, big = o.markScale || 1;
  // стадии: кольцо r63, площадки и здания
  EX.stages.forEach((st) => {
    c.circle(st.bld, 3.1 * big, { fill: o.exFill || '#2f3b4a', stroke: '#fff', 'stroke-width': 1.6 });
    if (o.numbers !== false) c.text(st.bld, String(st.i + 1), { size: Math.max(11, 3.4 * s * big), fill: '#fff', halo: null, weight: 'bold' });
  });
  // хабы районов
  EX.districts.forEach((d) => {
    c.poly([[d.hub[0], d.hub[1] - 4.6], [d.hub[0] + 4.6, d.hub[1]], [d.hub[0], d.hub[1] + 4.6], [d.hub[0] - 4.6, d.hub[1]]], { fill: '#ffd166', stroke: '#222', 'stroke-width': 2 });
  });
  // площадь-хаб, спавн, рынок
  c.circle(EX.hub, 5.2, { fill: '#fff6d8', stroke: '#222', 'stroke-width': 2.2 });
  c.text([EX.spawn[0], EX.spawn[1] - 0.2], '★', { size: Math.max(16, 4.6 * s), fill: '#e4572e', halo: '#fff', haloW: 3 });
  c.circle(EX.market.center, 8, { fill: '#ffd9b0', stroke: '#9b4a00', 'stroke-width': 2.4 });
  for (let k = 0; k < 7; k++) { const a = k * 2 * Math.PI / 7; c.circle([EX.market.center[0] + Math.cos(a) * 4.6, EX.market.center[1] + Math.sin(a) * 4.6], 1.2, { fill: '#c95f00', stroke: '#fff', 'stroke-width': 1 }); }
  // промзона запад
  const I = EX.industrial;
  [[I.sawmill, 'Лесопилка'], [I.concrete, 'Бетон'], [I.metal, 'Металл']].forEach(([p, n]) => c.poly([[p[0] - 3.4, p[1] - 3], [p[0] + 3.4, p[1] - 3], [p[0] + 3.4, p[1] + 3], [p[0] - 3.4, p[1] + 3]], { fill: '#8d6e63', stroke: '#fff', 'stroke-width': 1.6 }));
  const F = I.fleetYard; c.poly([[F.x0, F.z0], [F.x1, F.z0], [F.x1, F.z1], [F.x0, F.z1]], { fill: '#9aa9b8', stroke: '#2a3a4a', 'stroke-width': 1.8 });
  c.poly([[EX.infra.power[0] - 3, EX.infra.power[1] - 3], [EX.infra.power[0] + 3, EX.infra.power[1] - 3], [EX.infra.power[0] + 3, EX.infra.power[1] + 3], [EX.infra.power[0] - 3, EX.infra.power[1] + 3]], { fill: '#f3d34a', stroke: '#333', 'stroke-width': 1.6 });
  c.poly([[EX.infra.water[0] - 3, EX.infra.water[1] - 3], [EX.infra.water[0] + 3, EX.infra.water[1] - 3], [EX.infra.water[0] + 3, EX.infra.water[1] + 3], [EX.infra.water[0] - 3, EX.infra.water[1] + 3]], { fill: '#5ec0e8', stroke: '#333', 'stroke-width': 1.6 });
  if (o.exLabels !== false) {
    const L = (p, t, dz = -7, size = 13) => c.text([p[0], p[1] + dz], t, { size, fill: '#1b2430', haloW: 4 });
    L(EX.market.center, 'Рынок', -10); L(I.sawmill, 'Лесопилка', 6.5); L([I.concrete[0] + 2, I.concrete[1]], 'Бетон', -4.6, 12); L(I.metal, 'Металл', 5.5, 12); L([(F.x0 + F.x1) / 2, F.z1], 'Автопарк', 5.6, 12);
    L(EX.infra.power, 'ТЭС', -5.6, 12); L(EX.infra.water, 'Водоканал', 6, 12);
    L(EX.hub, 'Площадь-хаб', 8.8, 13);
    EX.districts.forEach((d) => L(d.hub, d.ru + ' (хаб)', d.hub[1] > 0 ? 8.6 : -7.4, 13));
  }
}

function layerLabels(c, plan, o) {
  const size = o.zoneFont || 28;
  for (const d of plan.districts) {
    if (d.offmap) continue; if (o.zoneFilter && !o.zoneFilter(d)) continue;
    let p, arcLen, depth;
    if (d.poly) { const b = bbox(d.poly); p = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; arcLen = b[2] - b[0]; depth = b[3] - b[1]; }
    else { const t1 = d.t1 < d.t0 ? d.t1 + 360 : d.t1, span = (t1 - d.t0), rm = (d.r0 + d.r1) / 2; arcLen = span * D2R * rm; depth = d.r1 - d.r0; p = P((d.t0 + t1) / 2, rm); }
    if (d.id === 'D-OLD' || d.id === 'D-CORE') { if (d.id === 'D-CORE') c.text([0, 36], 'СТАРЫЙ ГОРОД', { size: 20, fill: '#6b6350', weight: 'bold', haloW: 4 }); continue; }
    if (arcLen < 30 && depth < 22) continue; const words = d.name.split(' ');
    let txt = ''; let line = ''; for (const w of words) { if ((line + ' ' + w).trim().length > (o.wrap || 15)) { txt += line + '\n'; line = w; } else line = (line + ' ' + w).trim(); } txt += line;
    const nl = txt.split('\n').length, fs = Math.min(size, Math.max(14, Math.min(arcLen * c.s / (Math.max(...txt.split('\n').map((x) => x.length)) * 0.62), depth * c.s / (nl * 1.3))));
    c.text(p, txt, { size: Math.min(size, fs * 1.0), fill: d.frozen ? '#4b4637' : '#1b1b1b', haloW: 5, opacity: d.frozen ? 0.9 : 1 });
  }
}
function layerRoadNames(c, plan, o) {
  const named = ['A-N', 'A-NNE-1', 'A-E-1', 'A-M1-AV', 'A-S', 'A-PORT', 'A-R2-N', 'A-R2-E', 'A-R2-SE-a', 'A-EB', 'A-QUAY-SW', 'A-STN-BLV', 'A-QUAY-W', 'B-MAIN-E1', 'B-N', 'B-S', 'B-HORDA-N', 'B-NAV', 'B-S48', 'B-M2', 'B-STN-AV', 'B-PORT', 'B-EMB-S', 'B-QUAY-SW', 'B-BR1', 'B-BR2', 'B-SB'];
  for (const r of plan.roads) { if (!named.includes(r.id) || !r.name) continue; if (o.filter && !o.filter(r)) continue; if (polyLen(r.pts) < 30) continue; c.textPath(r.pts, r.name, { size: o.roadFont || 17, fill: '#2a2a2a', start: 50 }); }
}

function legend(c, plan, y0, o) {
  const x0 = 24, S = c.s; let y = y0;
  c.add(`<rect x="0" y="${y0 - 14}" width="${c.W}" height="${c.H - y0 + 14}" fill="#fbf8ef"/><line x1="0" x2="${c.W}" y1="${y0 - 14}" y2="${y0 - 14}" stroke="#b9ad8d" stroke-width="3"/>`);
  const T = (x, y, t, size = 24, w = 'bold', fill = '#1b1b1b', anchor = 'start') => c.add(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}">${String(t).replace(/&/g, '&amp;')}</text>`);
  T(x0, y + 22, o.legendTitle || 'Условные обозначения', 30); y += 52;
  const col = (i) => x0 + i * Math.floor((c.W - 48) / 3);
  // дороги
  T(col(0), y, 'Дороги (ширина в масштабе)', 22, 'bold', '#555');
  const items = [['expressway', 'Скоростная М1 (4 полосы, 14 м)'], ['arterial', 'Магистраль / кольцо (7,6 м)'], ['avenue', 'Проспект, автобус/трамвай (9 м)'], ['collector', 'Сборная улица (5,4 м)'], ['local', 'Местная улица (3,8 м)'], ['quay', 'Набережная / причал'], ['old', 'Исторические улочки (1,8 м, уже есть)']];
  items.forEach(([k, t], i) => { const yy = y + 34 + i * 34, w = Math.max(CLS[k].w * S * 0.6, 6); c.add(`<line x1="${col(0)}" x2="${col(0) + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="${ROADC[k][0]}" stroke-width="${w + 3}" stroke-linecap="round"/><line x1="${col(0)}" x2="${col(0) + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="${ROADC[k][1]}" stroke-width="${w}" stroke-linecap="round"/>`); T(col(0) + 76, yy, t, 20, 'normal'); });
  // инфраструктура
  T(col(1), y, 'Транспорт и объекты', 22, 'bold', '#555');
  const inf = [['rail', 'Железная дорога'], ['tram', 'Трамвай (зелёный пунктир)'], ['bridge', 'Мост / виадук / путепровод'], ['round', 'Круговой перекрёсток'], ['lc', 'Ж/д переезд со шлагбаумом'], ['stage', 'Здание этапа (номер 1-16)'], ['hub', 'Хаб района (ромб)'], ['lot', 'Новые лоты застройки (дверь = кружок)']];
  inf.forEach(([k, t], i) => {
    const yy = y + 34 + i * 34, xx = col(1);
    if (k === 'rail') c.add(`<line x1="${xx}" x2="${xx + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="#4a4a52" stroke-width="9"/><line x1="${xx}" x2="${xx + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="#f6f6f6" stroke-width="5"/><line x1="${xx}" x2="${xx + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="#4a4a52" stroke-width="5" stroke-dasharray="9 9"/>`);
    if (k === 'tram') c.add(`<line x1="${xx}" x2="${xx + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="#2f6f3e" stroke-width="5" stroke-dasharray="3 3"/>`);
    if (k === 'bridge') c.add(`<line x1="${xx}" x2="${xx + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="#fff" stroke-width="20"/><line x1="${xx}" x2="${xx + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="#701a0e" stroke-width="13"/><line x1="${xx}" x2="${xx + 60}" y1="${yy - 7}" y2="${yy - 7}" stroke="#ee6c3c" stroke-width="10"/>`);
    if (k === 'round') c.add(`<circle cx="${xx + 30}" cy="${yy - 7}" r="14" fill="#fff" stroke="#2a2a2a" stroke-width="3"/><circle cx="${xx + 30}" cy="${yy - 7}" r="8" fill="#9fcf7d" stroke="#4d7a3a" stroke-width="2"/>`);
    if (k === 'lc') c.add(`<circle cx="${xx + 30}" cy="${yy - 7}" r="13" fill="#fff" stroke="#d7263d" stroke-width="3.5"/><path d="M${xx + 22} ${yy - 15}L${xx + 38} ${yy + 1}M${xx + 22} ${yy + 1}L${xx + 38} ${yy - 15}" stroke="#d7263d" stroke-width="3.5"/>`);
    if (k === 'stage') c.add(`<circle cx="${xx + 30}" cy="${yy - 7}" r="13" fill="#2f3b4a" stroke="#fff" stroke-width="2"/><text x="${xx + 30}" y="${yy - 1}" font-size="16" font-weight="bold" font-family="${FONT}" fill="#fff" text-anchor="middle">7</text>`);
    if (k === 'hub') c.add(`<polygon points="${xx + 30},${yy - 22} ${xx + 44},${yy - 7} ${xx + 30},${yy + 8} ${xx + 16},${yy - 7}" fill="#ffd166" stroke="#222" stroke-width="2.5"/>`);
    if (k === 'lot') c.add(`<rect x="${xx + 10}" y="${yy - 20}" width="40" height="26" fill="#dba94f" stroke="#fffdf4" stroke-width="2"/><circle cx="${xx + 30}" cy="${yy + 6}" r="3.5" fill="#222"/>`);
    T(xx + 76, yy, t, 20, 'normal');
  });
  // зоны
  T(col(2), y, 'Функциональные зоны', 22, 'bold', '#555');
  const zs = o.zoneLegend || ['res-low', 'res-mid', 'mixed', 'cbd', 'station', 'industry-light', 'industry-heavy', 'port', 'freight', 'public', 'utility', 'park', 'forest', 'old'];
  zs.forEach((k, i) => { const yy = y + 34 + (i % 8) * 34, xx = col(2) + Math.floor(i / 8) * 215; c.add(`<rect x="${xx}" y="${yy - 22}" width="40" height="26" fill="${ZC[k]}" stroke="#8a8372" stroke-width="1.5"/>`); T(xx + 48, yy, (ZN[k] || k).replace(' (существует)','').slice(0,22), 16, 'normal'); });
  return y + 34 + 8 * 34 + 10;
}
function decorations(c, plan, o) {
  // масштабная линейка и стрелка севера (в углу карты)
  const bx = c.pad + 30, by = c.pad + c.hM * c.s - 40, L = 50 * c.s;
  c.add(`<g><rect x="${bx - 14}" y="${by - 38}" width="${L + 110}" height="64" fill="#fff" opacity=".85" rx="8"/><rect x="${bx}" y="${by - 6}" width="${L / 2}" height="10" fill="#222"/><rect x="${bx + L / 2}" y="${by - 6}" width="${L / 2}" height="10" fill="#fff" stroke="#222" stroke-width="2"/><text x="${bx}" y="${by - 14}" font-family="${FONT}" font-size="20" font-weight="bold">0</text><text x="${bx + L}" y="${by - 14}" font-family="${FONT}" font-size="20" font-weight="bold" text-anchor="middle">${o.scaleM || 50} м</text><text x="${bx + L + 14}" y="${by + 6}" font-family="${FONT}" font-size="18" fill="#444">≈ ${Math.round((o.scaleM || 50) / 5.9 * 10) / 10} с ходьбы</text></g>`);
  const nx = c.pad + c.wM * c.s - 70, ny = c.pad + 150;
  c.add(`<g><circle cx="${nx}" cy="${ny}" r="44" fill="#fff" opacity=".9" stroke="#222" stroke-width="2.5"/><polygon points="${nx},${ny - 38} ${nx + 14},${ny + 12} ${nx},${ny + 2} ${nx - 14},${ny + 12}" fill="#c0392b" stroke="#222" stroke-width="1.5"/><text x="${nx}" y="${ny + 34}" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="bold">С</text></g>`);
  // подписи осей: координаты каждые 50 м по краю
  for (let g = -150; g <= 150; g += 50) {
    c.text([g, c.z0 + 4], String(g), { size: 14, fill: '#8a8372', weight: 'normal', halo: '#fbf8ef', haloW: 3 });
    c.text([c.x0 + 6, g], String(g), { size: 14, fill: '#8a8372', weight: 'normal', halo: '#fbf8ef', haloW: 3, anchor: 'start' });
  }
}
function title(c, t, sub) {
  c.add(`<rect x="20" y="16" width="${c.W - 40}" height="100" rx="12" fill="#fff" opacity=".93" stroke="#222" stroke-width="2.5"/>`);
  c.raw(40, 54, t, { size: 34 });
  c.raw(40, 88, sub, { size: 19, fill: '#444', weight: 'normal' });
}

// ---- виды ------------------------------------------------------------------------------------------------------------------
function exList() { return existingRoads(); }
function viewOverview(plan) {
  const E = plan.meta.extent, s = 4.4, pad = 30, mapPx = Math.round(2 * E * s + 2 * pad);
  const c = new Canvas({ x0: -E, z0: -E, wM: 2 * E, hM: 2 * E, s, pad, extraH: 400 });
  const o = { existing: true, existingList: exList(), zoneFont: 22, wrap: 13 };
  c.defs.push(`<clipPath id="mapclip"><rect x="${c.pad}" y="${c.pad}" width="${c.wM*c.s}" height="${c.hM*c.s}"/></clipPath>`); c.add('<g clip-path="url(#mapclip)">'); drawBase(c, plan, o); layerZones(c, plan, o); layerWater(c, plan, o); layerRails(c, plan, o); layerLots(c, plan, o); layerRoads(c, plan, o); layerNodes(c, plan, o); layerBridgeLabels(c, plan, o); layerStations(c, plan, o);
  layerExistingMarks(c, plan, { ...o, markScale: 1 }); layerLabels(c, plan, o); layerRoadNames(c, plan, o); c.add('</g>'); decorations(c, plan, o); title(c, `${plan.name}`, 'Генплан v161: ядро r<70 сохранено, новые районы и сети снаружи (метры мира, север сверху)');
  legend(c, plan, 2 * E * s + 2 * pad + 20, o);
  return c;
}
function phaseColor(ph) { return PH[ph]?.[0] || '#999'; }
function viewPhases(plan) {
  const E = plan.meta.extent, s = 4.4, pad = 30;
  const c = new Canvas({ x0: -E, z0: -E, wM: 2 * E, hM: 2 * E, s, pad, extraH: 600 });
  const o = { existing: true, existingList: exList(), mono: true, noHatch: true, zoneColor: (d) => (d.phase ? '#f6f1e2' : '#ece7d6'), roadColor: (r) => (r.existing ? ['#8d98a6', '#c3cad3'] : [shade(phaseColor(r.phase)), phaseColor(r.phase)]),
    lotColor: (l) => phaseColor(l.ph ?? plan.fabrics.find((f) => f.id === l.f)?.phase ?? 1), railColor: (r) => shade(phaseColor(r.phase)), zoneFont: 24, noDoors: true };
  drawBase(c, plan, o); layerZones(c, plan, o); layerWater(c, plan, { ...o, labels: false });
  // фазовая заливка секторов (прозрачная)
  c.add('<g clip-path="url(#land)">');
  for (const d of plan.districts) { if (d.offmap || d.frozen || !d.phase) continue; c.poly((d.poly || sectorPoly(d)), { fill: phaseColor(d.phase), opacity: 0.18, stroke: phaseColor(d.phase), 'stroke-width': 1.5, 'stroke-dasharray': '6 5' }); }
  c.add('</g>');
  layerRails(c, plan, o); layerLots(c, plan, o); layerRoads(c, plan, o); layerNodes(c, plan, o); layerStations(c, plan, { ...o, detail: false });
  layerExistingMarks(c, plan, { ...o, exLabels: false, numbers: false, markScale: 0.8, exFill: '#7a8594' });
  // подписи фаз: у центроидов
  const lab = {}; plan.roads.forEach((r) => { if (r.phase && r.cls !== 'local' && r.cls !== 'ramp') (lab[r.phase] ||= []).push(r.pts[Math.floor(r.pts.length / 2)]); });
  layerPhaseBadges(c, plan);
  decorations(c, plan, o); title(c, `${plan.name}: фазы открытия`, 'Цвет = фаза (когда участок открывается через кружки на земле); серое = уже существует в игре');
  legendPhases(c, plan, 2 * E * s + 2 * pad + 20);
  return c;
}
const shade = (hex) => { const n = parseInt(hex.slice(1), 16), f = 0.62; return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join(''); };
function layerPhaseBadges(c, plan) {
  // номер фазы на ключевых элементах (по одному на фазу+класс)
  const seen = new Set();
  const put = (ph, p) => { const k = ph + '|' + Math.round(p[0] / 40) + '|' + Math.round(p[1] / 40); if (seen.has(k) || !ph) return; seen.add(k); c.circle(p, 4.2, { fill: phaseColor(ph), stroke: '#fff', 'stroke-width': 2.5 }); c.text(p, String(ph), { size: 22, fill: '#fff', halo: null }); };
  plan.roads.filter((r) => ['avenue', 'arterial', 'expressway', 'quay'].includes(r.cls)).forEach((r) => put(r.phase, r.pts[Math.floor(r.pts.length * 0.5)]));
  plan.rails.filter((r) => r.kind !== 'yard').forEach((r) => put(r.phase, r.pts[Math.floor(r.pts.length * 0.5)]));
  plan.landmarks.filter((l) => l.phase).forEach((l) => put(l.phase, [l.x, l.z]));
  plan.nodes.filter((n) => n.type.startsWith('interchange')).forEach((n) => put(n.phase, [n.x, n.z]));
}
function legendPhases(c, plan, y0) {
  c.add(`<rect x="0" y="${y0 - 14}" width="${c.W}" height="${c.H - y0 + 14}" fill="#fbf8ef"/><line x1="0" x2="${c.W}" y1="${y0 - 14}" y2="${y0 - 14}" stroke="#b9ad8d" stroke-width="3"/>`);
  const T = (x, y, t, size = 22, w = 'normal', fill = '#1b1b1b') => c.add(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${w}" fill="${fill}">${String(t).replace(/&/g, '&amp;')}</text>`);
  T(24, y0 + 22, 'Фазы открытия плана (кружок с номером = ключевой элемент фазы)', 30, 'bold');
  const gates = plan.phaseInfo || {};
  Object.keys(PH).forEach((k, i) => { const yy = y0 + 70 + i * 50, g = gates[k]; c.add(`<circle cx="46" cy="${yy - 8}" r="17" fill="${PH[k][0]}" stroke="#fff" stroke-width="3"/><text x="46" y="${yy - 1}" text-anchor="middle" font-size="22" font-weight="bold" fill="#fff" font-family="${FONT}">${k}</text>`); T(80, yy, PH[k][1] + (g ? ` — ${g}` : ''), 22, k === '0' ? 'normal' : 'bold'); });
}
function viewExisting(plan) {
  const E = plan.meta.extent, s = 4.4, pad = 30;
  const c = new Canvas({ x0: -E, z0: -E, wM: 2 * E, hM: 2 * E, s, pad, extraH: 420 });
  const ex = exList();
  const o = { existing: true, existingList: ex, mono: true, noHatch: true, zoneColor: () => '#efe9d8', roadColor: (r) => (r.existing ? ['#0e1a2b', '#3d5a80'] : ['#7a3300', '#ff8a2a']), lotColor: () => '#ff8a2a', lotOpacity: 0.9, railColor: () => '#8a3b00', exFill: '#0e1a2b', zoneFont: 24, noDoors: true };
  drawBase(c, plan, o);
  // тонкий контур существующей суши r70
  c.circle([0, 0], 70, { fill: '#e6dfc9', stroke: '#8a8372', 'stroke-width': 2.4, 'stroke-dasharray': '10 6' });
  layerWater(c, plan, { ...o, labels: true }); layerRails(c, plan, o); layerLots(c, plan, o); layerRoads(c, plan, o); layerNodes(c, plan, o); layerStations(c, plan, o);
  layerExistingMarks(c, plan, { ...o, markScale: 1.1 });
  c.text(P(300, 62), 'ЯДРО r<70:\nне меняется', { size: 26, fill: '#0e1a2b', haloW: 6 });
  decorations(c, plan, o); title(c, `${plan.name}: существует и добавлено`, 'Тёмно-синее = уже в игре (измерено по коду); оранжевое = добавляется планом, подключается только через узлы');
  const y0 = 2 * E * s + 2 * pad + 20;
  c.add(`<rect x="0" y="${y0 - 14}" width="${c.W}" height="${c.H - y0 + 14}" fill="#fbf8ef"/><line x1="0" x2="${c.W}" y1="${y0 - 14}" y2="${y0 - 14}" stroke="#b9ad8d" stroke-width="3"/>`);
  const T = (x, y, t, size = 24, w = 'normal', fill = '#1b1b1b') => c.add(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${w}" fill="${fill}">${String(t).replace(/&/g, '&amp;')}</text>`);
  const lenNew = Math.round(plan.roads.reduce((a, r) => a + polyLen(r.pts), 0)), lenEx = Math.round(ex.reduce((a, r) => a + polyLen(r.pts), 0)), lr = Math.round(plan.rails.reduce((a, r) => a + polyLen(r.pts) * (r.tracks || 1), 0));
  T(24, y0 + 24, 'Существует и добавляется (ориентиры)', 30, 'bold');
  c.add(`<line x1="30" x2="110" y1="${y0 + 64}" y2="${y0 + 64}" stroke="#0e1a2b" stroke-width="12" stroke-linecap="round"/><line x1="30" x2="110" y1="${y0 + 64}" y2="${y0 + 64}" stroke="#3d5a80" stroke-width="8" stroke-linecap="round"/>`); T(126, y0 + 72, `Существующие дороги и подъезды: ≈ ${lenEx} м (схематично, по коду). Ничего не меняется и не перекладывается`, 22);
  c.add(`<line x1="30" x2="110" y1="${y0 + 110}" y2="${y0 + 110}" stroke="#7a3300" stroke-width="12" stroke-linecap="round"/><line x1="30" x2="110" y1="${y0 + 110}" y2="${y0 + 110}" stroke="#ff8a2a" stroke-width="8" stroke-linecap="round"/>`); T(126, y0 + 118, `Новые дороги плана: ≈ ${lenNew} м, рельсы ≈ ${lr} м путей, лотов застройки: ${plan.lots.length}`, 22);
  c.add(`<circle cx="70" cy="${y0 + 158}" r="14" fill="#0e1a2b" stroke="#fff" stroke-width="2"/>`); T(126, y0 + 166, 'Существующие здания и объекты: 16 зданий этапов, 4 хаба районов, рынок, промзона запад, автопарк, ТЭС, водоканал', 22);
  c.add(`<polygon points="70,${y0 + 190} 84,${y0 + 205} 70,${y0 + 220} 56,${y0 + 205}" fill="#ffd166" stroke="#222" stroke-width="2.5"/>`); T(126, y0 + 212, 'Хаб района: к нему подключаются новые улицы района, сам хаб остаётся на месте', 22);
  T(24, y0 + 262, 'Стыковка: новая сеть касается старой только в узлах (кольцо r57,4 и хабы).', 20);
  T(24, y0 + 290, 'Сигнатуры 17/678830722, 47/-510574045, 51/648310607 не меняются: новый слой в отдельной группе', 20);
  T(24, y0 + 318, '(не v70RefinedServiceRoads / v113UnifiedStarterRoadSurface / stageRoads), старые меши не пересчитываются.', 20);
  return c;
}
function viewDetail(plan) {
  const st = plan.stations.find((q) => q.kind === 'pax-terminal'); const x0 = 18, z0 = 14, wM = 128, hM = 120, s = 12.5, pad = 0;
  const c = new Canvas({ x0, z0, wM, hM, s, pad, extraH: 260 });
  const o = { existing: true, existingList: exList(), detail: true, zoneFont: 26, wrap: 12 };
  drawBase(c, plan, o); layerZones(c, plan, o); layerWater(c, plan, { ...o, labels: false }); layerRails(c, plan, o); layerLots(c, plan, o);
  layerRoads(c, plan, o); layerNodes(c, plan, o); layerBridgeLabels(c, plan, o); layerStations(c, plan, o);
  layerExistingMarks(c, plan, { ...o, markScale: 1, exLabels: true });
  layerLabels(c, plan, { ...o, zoneFont: 24, zoneFilter: (d) => ['D-CBD', 'D-STN', 'D-E', 'D-OB-SE', 'D-BIZ'].includes(d.id) });
  layerRoadNames(c, plan, { ...o, roadFont: 18 });
  const IC = plan.nodes.find((n) => n.type === 'interchange-cloverleaf');
  if (IC) c.text([IC.x + 4, IC.z - 3], 'Развязка «клеверный лист»\nМ1 × Кольцо-2 (путепровод)', { size: 20, fill: '#701a0e', haloW: 6 });
  const M = stationModule(plan); if (M) c.text(M.T([62, -30]), 'ж/д ветка → вокзал\n(виадук над Кольцом-2)', { size: 17, fill: '#3a3a40', haloW: 5 });
  c.text([60, 14 + 106], 'река Лесная →', { size: 20, fill: '#1c5a8a', halo: '#e8f4fb' });
  decorations(c, plan, { scaleM: 20 }); title(c, 'Узел «вау»: развязка + вокзал + CBD', 'Деталь плана A, масштаб ≈12,5 px/м: клеверный лист, ж/д виадук, тупиковый вокзал на 4 пути, автовокзал, такси, парковки, трамвай T1 к хабу');
  // мини-легенда
  const y0z = hM * s + 20;
  c.add(`<rect x="0" y="${y0z - 14}" width="${c.W}" height="${c.H - y0z + 14}" fill="#fbf8ef"/><line x1="0" x2="${c.W}" y1="${y0z - 14}" y2="${y0z - 14}" stroke="#b9ad8d" stroke-width="3"/>`);
  const T = (x, y, t, size = 20, w = 'normal') => c.add(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${w}" fill="#1b1b1b">${String(t).replace(/&/g, '&amp;')}</text>`);
  T(24, y0z + 22, 'Как читать: ', 24, 'bold');
  T(24, y0z + 58, 'Белая подложка = путепровод (кольцо-2 над М1 и над жд; М1 над рекой). Петли R 7,5 м + внешние съезды 3 м; на петле ≈ ½ скорости.', 19);
  T(24, y0z + 90, 'Вокзал: тупик на 4 пути, 3 платформы по 23 м, здание + поперечный зал за упорами, площадь с остановкой T1 и бульваром к хабу «Деловой центр».', 19);
  T(24, y0z + 122, 'Автовокзал (синие стойла), такси (жёлтые), парковки P — на площади; все лоты обращены дверью (белая точка) на улицу.', 19);
  T(24, y0z + 154, 'Тёмные кружки: существующие здания этапов 11 и 12; ромб = хаб «Деловой центр» (уже стоит).', 19);
  return c;
}

// ---- вывод -------------------------------------------------------------------------------------------------------------------
async function toPng(files) {
  let chromium; try { ({ chromium } = await import('playwright')); } catch { console.log('playwright не найден: PNG пропущены'); return; }
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  for (const f of files) {
    const svg = fs.readFileSync(f, 'utf8'); const m = svg.match(/width="(\d+)" height="(\d+)"/);
    const page = await browser.newPage({ viewport: { width: +m[1], height: +m[2] } });
    await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
    await page.screenshot({ path: f.replace(/\.svg$/, '.png') });
    await page.close(); console.log('png', path.basename(f).replace(/\.svg$/, '.png'));
  }
  await browser.close();
}
const which = opt('plan', 'all'), only = opt('view', 'all'), out = [];
const plans = (which === 'all' ? ['A', 'B'] : [which]).filter((p) => fs.existsSync(path.join(HERE, `plan-${p}.json`)));
for (const p of plans) {
  const plan = JSON.parse(fs.readFileSync(path.join(HERE, `plan-${p}.json`), 'utf8'));
  const emit = (name, canvas) => { const f = path.join(OUT, name + '.svg'); fs.writeFileSync(f, canvas.svg()); out.push(f); };
  if (only === 'all' || only === 'overview') emit(`plan-${p}-overview`, viewOverview(plan));
  if (p === 'A') {
    if (only === 'all' || only === 'phases') emit('phases', viewPhases(plan));
    if (only === 'all' || only === 'detail') emit('interchange-station', viewDetail(plan));
    if (only === 'all' || only === 'existing') emit('existing-vs-added', viewExisting(plan));
  }
  if (p === 'B') {
    if (only === 'all' || only === 'phases') emit('phases-B', viewPhases(plan));
  }
}
if (opt('png', false)) await toPng(out);
console.log('written', out.map((f) => path.basename(f)).join(', '));
