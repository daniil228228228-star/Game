// Сборка кварталов (фабрик) и проверки целостности плана.
import fs from 'node:fs';
import { P, arc, dist, polyLen, polyDist, inPoly, polarOf, D2R, r1, segInter, segDist } from './lib.mjs';
import { CLS, perimeterBlock, lotRec } from './plan-core.mjs';

export function landPolygon(Rfn, edge) {
  const pts = [];
  for (let th = 0; th < 360; th += 1) {
    const c = Math.cos(th * D2R), s = Math.sin(th * D2R), Rc = edge / Math.max(Math.abs(c), Math.abs(s));
    const R = Math.min(Rfn(th), Rc); pts.push([r1(R * c), r1(R * s)]);
  }
  return pts;
}
const existing = JSON.parse(fs.readFileSync(new URL('./existing.json', import.meta.url)));
export const EX = existing;

// существующая сеть (схематично, по коду): мастер-сетка, дороги этапов (хаб -> колено -> здание), артерии районов, кольцо r57,4, служебные дороги промзоны
export function existingRoads() {
  const out = [];
  existing.masterGrid.forEach((s, i) => out.push({ id: `E-GRID-${i + 1}`, cls: 'old', w: s[2], pts: [s[0], s[1]], existing: true }));
  existing.stages.forEach((s) => {
    const e = s.bld, k = Math.abs(e[0]) >= Math.abs(e[1]) ? [e[0], 0] : [0, e[1]];
    out.push({ id: `E-STAGE-${s.i}`, cls: 'old', w: 1.8, pts: [[0, 0], k, e], existing: true });
  });
  existing.districts.forEach((d) => out.push({ id: `E-ART-${d.id}`, cls: 'old', w: 2.2, pts: [d.hub, ...d.arterial.bends, d.arterial.hint], existing: true }));
  out.push({ id: 'E-RING', cls: 'arterial', w: 5.6, pts: arc(0, 360, 57.4, 3), existing: true, conditional: true, note: 'r 54,6-60,2; рисуется при >= 8 уровнях дорог' });
  const ind = existing.industrial;
  out.push({ id: 'E-SVC-AXIS', cls: 'old', w: 2.4, pts: [[0, 0.5], [-24, 0.5], [-48, 0.5]], existing: true });
  out.push({ id: 'E-SVC-SAW', cls: 'old', w: 2.4, pts: [[-48, 0.5], [-49.6, -3.2]], existing: true });
  out.push({ id: 'E-SVC-FLEET', cls: 'old', w: 2.4, pts: [[-34.7, 4.45], [-46.7, 4.45]], existing: true });
  out.push({ id: 'E-SVC-CONC', cls: 'old', w: 2.4, pts: [[-39.3, 0.5], [-39.3, -8]], existing: true });
  return out;
}

export function makeBlocked(plan) {
  const roads = plan.roads.filter((r) => r.cls !== 'local');
  const rivers = plan.water.filter((w) => w.pts);
  const inset = 2.9;
  const blocked = (p) => {
    if (!inPoly(p, plan.land)) return 'sea';
    if (Math.hypot(p[0], p[1]) < 71.2) return 'core';
    for (const w of rivers) if (polyDist(p, w.pts) < w.w / 2 + 3.5) return 'river';
    for (const r of roads) { if (r.level > 0 && r.bridge) continue; if (polyDist(p, r.pts) < r.w / 2 + (r.sw || 0) + 0.7) return 'road:' + r.id; }
    for (const r of plan.rails) { if (r.level >= 1) continue; if (polyDist(p, r.pts) < 1.6 * (r.tracks || 1) + 2.6) return 'rail:' + r.id; }
    for (const k of plan.keepout) {
      if (k.circle && Math.hypot(p[0] - k.circle[0], p[1] - k.circle[1]) < k.circle[2]) return 'ko:' + k.id;
      if (k.poly && inPoly(p, k.poly)) return 'ko:' + k.id;
    }
    return null;
  };
  return blocked;
}
export function buildFabrics(plan, specs, opts = {}) {
  const blocked = makeBlocked(plan);
  const inset = 2.9;
  const stats = { cells: 0, cellsDropped: 0, lots: 0, byBlock: {} };
  for (const s of specs) {
    const rows = s.rows ?? Math.max(1, Math.round((s.r1 - s.r0) / 28)), rr = Array.from({ length: rows + 1 }, (_, i) => s.r0 + (s.r1 - s.r0) * i / rows);
    const dt = (((s.t1 - s.t0) % 360) + 360) % 360, rmid = (s.r0 + s.r1) / 2, nth = Math.max(1, Math.round(dt * D2R * rmid / s.arc));
    const th = Array.from({ length: nth + 1 }, (_, j) => (s.t0 + dt * j / nth) % 360);
    const arcUsed = new Set(), radUsed = new Set();
    for (let i = 0; i < rows; i++) for (let j = 0; j < nth; j++) {
      stats.cells++;
      const rin = rr[i] + inset, rout = rr[i + 1] - inset, ta = th[j], tb = th[j + 1] < ta ? th[j + 1] + 360 : th[j + 1];
      const i0 = (j === 0 && s.skipT0) ? 7.0 : inset, i1 = (j === nth - 1 && s.skipT1) ? 7.0 : inset;
      const d0 = (r) => i0 / r / D2R, d1 = (r) => i1 / r / D2R;
      const q = [P(ta + d0(rin), rin), P(tb - d1(rin), rin), P(tb - d1(rout), rout), P(ta + d0(rout), rout)];
      const why = {}; const lots = perimeterBlock(q, s.depth, s.front).filter((l) => { const b = l.poly.map(blocked).find(Boolean) || blocked(l.door); if (b) { why[b] = (why[b] || 0) + 1; return false; } return true; }); if (process.env.DBG) console.log(s.id, i, j, JSON.stringify(why));
      const expected = perimeterBlock(q, s.depth, s.front).length;
      if (!expected || lots.length / expected < 0.5) { stats.cellsDropped++; continue; }
      lots.forEach((l) => plan.lots.push(lotRec(l, s.kind, s.id)));
      stats.lots += lots.length; arcUsed.add(`${i},${j}`); arcUsed.add(`${i + 1},${j}`); radUsed.add(`${j},${i}`); radUsed.add(`${j + 1},${i}`);
    }
    // уличная сеть: дуги по границам рядов, радиалы по углам; рёбра, прилегающие к принятым кварталам; склеиваем подряд идущие
    const mk = (id, pts, nm) => { if (pts.length >= 2) plan.road({ id, name: nm, cls: 'local', pts, phase: s.phase, fabric: s.id, joins: [] }); };
    let n = 0;
    for (let i = 0; i <= rows; i++) {
      let run = [];
      const flush = () => { if (run.length) { const a = th[run[0]], b = th[run[run.length - 1] + 1]; mk(`${s.id}-S${++n}`, arc(a, b < a ? b + 360 : b, rr[i], 3), `${s.name}: улица ${n}`); run = []; } };
      for (let j = 0; j < nth; j++) { if (arcUsed.has(`${i},${j}`)) run.push(j); else flush(); }
      flush();
    }
    for (let j = 0; j <= nth; j++) {
      if ((j === 0 && s.skipT0) || (j === nth && s.skipT1)) continue;
      let run = [];
      const flush = () => { if (run.length) { mk(`${s.id}-S${++n}`, [P(th[j], rr[run[0]]), P(th[j], rr[run[run.length - 1] + 1])], `${s.name}: улица ${n}`); run = []; } };
      for (let i = 0; i < rows; i++) { if (radUsed.has(`${j},${i}`)) run.push(i); else flush(); }
      flush();
    }
    plan.fabrics.push({ id: s.id, district: s.district, name: s.name, kind: s.kind, phase: s.phase, t0: s.t0, t1: s.t1, r0: s.r0, r1: s.r1, rows, depth: s.depth, front: s.front, lotsOut: stats.lots });
  }
  plan.fabricStats = stats;
}

// ---- проверка: связность, тупики, размеры
export function analyse(plan) {
  const ex = existingRoads();
  const all = [...ex.map((r) => ({ ...r, level: 0 })), ...plan.roads.map((r) => ({ ...r }))];
  const tol = 3.2;
  const parent = all.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const uni = (a, b) => { parent[find(a)] = find(b); };
  const touchEnds = (A, B) => {
    for (const e of [A.pts[0], A.pts[A.pts.length - 1]]) if (polyDist(e, B.pts) < tol + (B.w || 0) / 2) return true;
    for (const e of [B.pts[0], B.pts[B.pts.length - 1]]) if (polyDist(e, A.pts) < tol + (A.w || 0) / 2) return true;
    return false;
  };
  const cross = (A, B) => { for (let i = 1; i < A.pts.length; i++) for (let j = 1; j < B.pts.length; j++) if (segInter(A.pts[i - 1], A.pts[i], B.pts[j - 1], B.pts[j])) return true; return false; };
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const A = all[i], B = all[j];
    if (A.existing && B.existing) { if (touchEnds(A, B) || cross(A, B)) uni(i, j); continue; }
    if (touchEnds(A, B)) uni(i, j); else if ((A.level || 0) === (B.level || 0) && !A.bridge && !B.bridge && cross(A, B)) uni(i, j);
  }
  const comps = new Map(); all.forEach((r, i) => { const k = find(i); (comps.get(k) || comps.set(k, []).get(k)).push(r.id); });
  const main = [...comps.values()].sort((a, b) => b.length - a.length)[0];
  const isolated = [...comps.values()].filter((c) => c !== main).map((c) => c.slice(0, 4).join(','));
  // тупики: конец дороги, который не касается никого и не помечен terminal/terminus/край карты
  const dead = [];
  const mapEdge = (p) => Math.abs(p[0]) > plan.meta.extent - 3 || Math.abs(p[1]) > plan.meta.extent - 3 || Math.hypot(p[0], p[1]) > 190;
  for (let i = 0; i < all.length; i++) {
    const A = all[i]; if (A.existing) continue;
    for (const e of [A.pts[0], A.pts[A.pts.length - 1]]) {
      let t = false;
      for (let j = 0; j < all.length && !t; j++) if (j !== i && polyDist(e, all[j].pts) < tol + (all[j].w || 0) / 2) t = true;
      if (!t && A.cls === 'ramp') for (let j = 0; j < all.length && !t; j++) if (all[j].cls !== 'ramp' && polyDist(e, all[j].pts) < 9 + (all[j].w || 0) / 2) t = true;
      if (!t && !mapEdge(e) && !A.terminal && !plan.nodes.some((n) => (n.type === 'terminus' || n.type === 'roundabout') && Math.hypot(n.x - e[0], n.z - e[1]) < 6)) dead.push(`${A.id}@${r1(e[0])},${r1(e[1])}`);
    }
  }
  const len = {}; plan.roads.forEach((r) => { const k = r.cls; len[k] = (len[k] || 0) + polyLen(r.pts); });
  const lenPhase = {}; plan.roads.forEach((r) => { lenPhase[r.phase] = (lenPhase[r.phase] || 0) + polyLen(r.pts); });
  const ids = new Set(), dup = []; [...plan.roads, ...plan.nodes, ...plan.rails, ...plan.stations, ...plan.landmarks].forEach((o) => { if (ids.has(o.id)) dup.push(o.id); ids.add(o.id); });
  // лоты: пересечения (по центрам < размера) - грубо
  let lotOverlap = 0; const L = plan.lots;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i].c, b = L[j].c; if (Math.abs(a[0] - b[0]) < 8 && Math.abs(a[1] - b[1]) < 8) { const dd = Math.hypot(a[0] - b[0], a[1] - b[1]); if (dd < Math.min(L[i].w, L[j].w, L[i].d, L[j].d) * 0.7) lotOverlap++; } }
  return { components: comps.size, mainSize: main.length, total: all.length, isolated, dead, len: Object.fromEntries(Object.entries(len).map(([k, v]) => [k, Math.round(v)])), lenPhase: Object.fromEntries(Object.entries(lenPhase).map(([k, v]) => [k, Math.round(v)])), dupIds: dup, lots: L.length, lotOverlap };
}

export function finishPlan(plan) { plan.check = analyse(plan); }

// прямоугольные кварталы (план B): сетка линий xs, zs; kindAt(cx,cz) -> {kind,depth,front,phase} | null
export function buildRectFabric(plan, o) {
  const blocked = makeBlocked(plan), inset = 2.9, st = { cells: 0, dropped: 0, lots: 0 };
  const used = { v: new Set(), h: new Set() };
  for (let i = 0; i < o.xs.length - 1; i++) for (let j = 0; j < o.zs.length - 1; j++) {
    const x0 = o.xs[i], x1 = o.xs[i + 1], z0 = o.zs[j], z1 = o.zs[j + 1], k = o.kindAt((x0 + x1) / 2, (z0 + z1) / 2); if (!k) continue; st.cells++;
    const ia = i === o.edgeW ? 7 : inset, q = [[x0 + inset, z0 + inset], [x1 - inset, z0 + inset], [x1 - inset, z1 - inset], [x0 + inset, z1 - inset]];
    const exp = perimeterBlock(q, k.depth, k.front).length;
    const lots = perimeterBlock(q, k.depth, k.front).filter((l) => !l.poly.some(blocked) && !blocked(l.door));
    if (!exp || lots.length / exp < 0.5) { st.dropped++; continue; }
    lots.forEach((l) => { const r = lotRec(l, k.kind, 'F-GRID'); r.ph = k.phase; plan.lots.push(r); });
    st.lots += lots.length; used.v.add(`${i},${j}`); used.v.add(`${i + 1},${j}`); used.h.add(`${i},${j}`); used.h.add(`${i},${j + 1}`);
  }
  let n = 0;
  const mk = (pts, ph) => plan.road({ id: `F-GRID-S${++n}`, name: 'Местная улица', cls: 'local', pts, phase: ph, fabric: 'F-GRID', joins: [] });
  for (let i = 0; i < o.xs.length; i++) { let run = []; const fl = () => { if (run.length) { mk([[o.xs[i], o.zs[run[0]]], [o.xs[i], o.zs[run[run.length - 1] + 1]]], o.phaseAt(o.xs[i], o.zs[run[0]])); run = []; } }; for (let j = 0; j < o.zs.length - 1; j++) { if (used.v.has(`${i},${j}`)) run.push(j); else fl(); } fl(); }
  for (let j = 0; j < o.zs.length; j++) { let run = []; const fl = () => { if (run.length) { mk([[o.xs[run[0]], o.zs[j]], [o.xs[run[run.length - 1] + 1], o.zs[j]]], o.phaseAt(o.xs[run[0]], o.zs[j])); run = []; } }; for (let i = 0; i < o.xs.length - 1; i++) { if (used.h.has(`${i},${j}`)) run.push(i); else fl(); } fl(); }
  plan.fabricStats = st; plan.fabrics.push({ id: 'F-GRID', name: 'Сетка кварталов 48 м', phase: 3, kind: 'mixed' });
}
