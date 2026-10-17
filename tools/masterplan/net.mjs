// Граф сети плана B: смежность, плечи узлов, классификация перекрёстков. Общий для build-B.mjs и validate.mjs.
import { dist, tess, norm, angDiff, polyLen, pointAt } from './geo.mjs';

export const CLS = {
  expressway: { ru: 'Скоростная магистраль', w: 14, sw: 0, lanes: 4, minR: 60, spacing: 60, speed: 3.2 },
  arterial: { ru: 'Магистраль', w: 7.6, sw: 1.4, lanes: 4, minR: 30, spacing: 40, speed: 2.4 },
  avenue: { ru: 'Проспект', w: 9, sw: 1.6, lanes: 4, minR: 30, spacing: 40, speed: 2.2 },
  collector: { ru: 'Сборная улица', w: 5.4, sw: 1.2, lanes: 2, minR: 18, spacing: 24, speed: 1.8 },
  local: { ru: 'Местная улица', w: 3.8, sw: 1.0, lanes: 2, minR: 12, spacing: 20, speed: 1.4 },
  quay: { ru: 'Набережная', w: 6, sw: 2.4, lanes: 2, minR: 18, spacing: 24, speed: 1.2 },
  ramp: { ru: 'Съезд / въезд (односторонний)', w: 4.2, sw: 0, lanes: 1, minR: 25, spacing: 0, speed: 2.0 },
  ring: { ru: 'Кольцо-1 (существует)', w: 5.6, sw: 0, lanes: 2, minR: 30, spacing: 0, speed: 1.8 },
};
export const RAIL = { minR: 35, gauge: 4 };
export const off = (cls) => CLS[cls].w / 2 + CLS[cls].sw; // от оси до фасадной линии лотов

export function roadEdges(plan, maxPhase = 99) { return plan.edges.filter((e) => e.phase <= maxPhase); }
export function adjacency(plan, maxPhase = 99) {
  const A = new Map(); const add = (n, e, o) => { if (!A.has(n)) A.set(n, []); A.get(n).push({ e, o, len: e.len }); };
  for (const e of roadEdges(plan, maxPhase)) { add(e.from, e, e.to); if (!e.oneway) add(e.to, e, e.from); else add(e.to, e, e.from); } // для связности односторонние считаем двусторонними
  return A;
}
// направление плеча от узла (курс, градусы): по точке на расстоянии 6 м вдоль ребра
export function armBearing(e, nodeId, nodes) {
  const n = nodes[nodeId], pts = e.from === nodeId ? e.pts : [...e.pts].reverse(); const q = pointAt(pts, Math.min(6, e.len * 0.5)).p;
  return norm(Math.atan2(q[1] - n.z, q[0] - n.x) * 180 / Math.PI);
}
export function junctions(plan) {
  const out = [], byNode = {};
  for (const e of plan.edges) for (const k of ['from', 'to']) (byNode[e[k]] ||= []).push(e);
  for (const [id, es] of Object.entries(byNode)) {
    const n = plan.nodeById[id]; if (es.length < 3 && n.type !== 'roundabout' && n.type !== 'terminal-roundabout') continue;
    const arms = es.map((e) => ({ edge: e.id, cls: e.cls, bearing: Math.round(armBearing(e, id, plan.nodeById)), end: e.from === id ? 'from' : 'to' })).sort((a, b) => a.bearing - b.bearing);
    let minAng = 360; for (let i = 0; i < arms.length; i++) { const a = arms[i], b = arms[(i + 1) % arms.length]; if (arms.length > 1) minAng = Math.min(minAng, angDiff(a.bearing, b.bearing)); }
    out.push({ id: 'J-' + id.replace(/^N-/, ''), node: id, type: n.type, x: n.x, z: n.z, r: n.r || 0, arms, minAngle: minAng, phase: n.phase });
  }
  return out;
}
