// Masterplan C (2026-10-18), step C0: the new city layout on paper.  node tools/masterplan/plan-c.mjs  ->  tools/masterplan/plan-C.json
// Game metres (x east, z south). Scale: 1 game metre = 2.5 real metres (cars are ~0.4 of real size, docs/ROAD_STANDARDS_V161.md).
// Right-hand traffic in the plan (as on real Russian roads): a carriageway heading +x lies on the +z side.
// Everything here is DATA: street lines -> graph (nodes / edges), junction types, interchanges with ramp polylines built from
// circular arcs and cubic tapers in a local frame, crossings, footbridges, tunnels, rail, water, transit, land use, blocks.
// Picture: tools/masterplan/render-plan-c.mjs. Norm check: tools/masterplan/audit-plan-c.mjs. Not in the game yet (docs/MASTERPLAN_C_PLAN.md, C1+).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R = (n) => Math.round(n * 100) / 100;
const P2 = (p) => [R(p[0]), R(p[1])];

// ---- classes: carriageway width (game m; real = x2.5), lanes per direction, median, design speed (km/h real), sidewalk per side
export const CLS = {
  // widths from the REAL game vehicles (car 1.4 x 2.14, truck 1.15 x 2.11), not from the 0.4 scale: lane >= 1.9 (car + 0.25 clearance each side)
  motorway: { w: 12.6, lanes: 2, median: 2.2, speed: 90, sidewalk: 0, lane: 2.1, shoulder: 1.0 },
  arterial: { w: 9.2, lanes: 2, median: 1.2, speed: 60, sidewalk: 1.8, lane: 2.0 },
  collector: { w: 4.4, lanes: 1, median: 0, speed: 40, sidewalk: 1.4, lane: 2.2 },
  local: { w: 4.0, lanes: 1, median: 0, speed: 30, sidewalk: 1.2, lane: 2.0 },
  service: { w: 4.0, lanes: 1, median: 0, speed: 20, sidewalk: 0, lane: 2.0 },
  ramp: { w: 2.8, lanes: 1, median: 0, speed: 50, sidewalk: 0, lane: 2.8 },
};
const MW = CLS.motorway.w / 2, ATT = MW - 1.0, TRK = MW * 0.61;   // ramps leave / join a motorway with their centre line inside the outer lane

// ---- small geometry kit (screen frame: x right, z down; a right turn = increasing angle)
const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
export function cubic(p0, h0, k0, p3, h3, k3, n = 28) {   // tangent-continuous taper: leaves p0 along h0, arrives at p3 along h3
  const p1 = add(p0, mul(h0, k0)), p2 = sub(p3, mul(h3, k3)), out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3; out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]); }
  return out;
}
export function arc(c, r, a0, a1, step = 6) {   // degrees; a1 > a0 = right turn (clockwise on screen)
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step)), out = [];
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  return out;
}
const seg = (a, b, n = 6) => { const out = []; for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return out; };
const join = (...parts) => { const out = []; for (const p of parts) for (const q of p) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - q[0], l[1] - q[1]) > 1e-6) out.push(q); } return out; };
// local interchange frame: u along the main road (+u = the direction of the carriageway on the +v side), rotated by k * 90 degrees, then moved to `at`
const frame = (at, k) => (p) => { const [u, v] = p, r = [[u, v], [-v, u], [-u, -v], [v, -u]][k & 3]; return [R(at[0] + r[0]), R(at[1] + r[1])]; };
function catmull(pts, per = 8) {   // smooth a sparse polyline (river)
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < per; s++) { const t = s / per, t2 = t * t, t3 = t2 * t; out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3))); }
  }
  out.push(pts[pts.length - 1]); return out.map(P2);
}

function blob(c, r, rnd) {   // irregular forest patch
  const n = 18, k = [rnd(), rnd(), rnd()], out = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = r * (1 + 0.22 * Math.sin(3 * a + k[0] * 6) + 0.12 * Math.sin(5 * a + k[1] * 6) + 0.08 * (k[2] - 0.5)); out.push(P2([c[0] + Math.cos(a) * rr * 1.25, c[1] + Math.sin(a) * rr])); }
  return out;
}
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

export function buildPlan() {
  const size = { x0: -300, x1: 300, z0: -370, z1: 262 };
  const M1_Z = -240, M2_X = 250, RAIL_Z = -120, SEA_Z = 200, RIVER = { x: -210, w: 20 };

  // ------------------------------------------------------------------ street lines (explicit spans; a road exists only where it serves a block)
  const V = [
    { x: -280, cls: 'local', name: 'ул. Дачная', spans: [[-80, 160]] },
    { x: -232, cls: 'collector', name: 'Береговая ул.', spans: [[-160, 160]] },
    { x: -194, cls: 'local', name: 'Речная наб.', spans: [[-108, 188]] },
    { x: -160, cls: 'arterial', name: 'Западный пр.', spans: [[-160, 160]] },
    { x: -120, cls: 'local', spans: [[-108, 80], [160, 188]] },
    { x: -160, cls: 'local', spans: [[160, 188]] },
    { x: -80, cls: 'collector', name: 'Школьная ул.', spans: [[-160, 188]] },
    { x: -40, cls: 'local', spans: [[-108, 188]] },
    { x: 0, cls: 'arterial', name: 'Главный пр.', spans: [[-262, 188]] },
    { x: 0, cls: 'collector', name: 'Северное ш.', spans: [[-370, -262]] },
    { x: 40, cls: 'local', spans: [[-108, 188]] },
    { x: 80, cls: 'collector', name: 'Университетская ул.', spans: [[-190, 160]] },
    { x: 80, cls: 'service', name: 'Портовая ул.', spans: [[160, 196]] },
    { x: 120, cls: 'local', spans: [[-108, 80]] },
    { x: 160, cls: 'arterial', name: 'Восточный пр.', spans: [[-190, 160]] },
    { x: 160, cls: 'service', name: 'Портовый пр.', spans: [[160, 214]] },
    { x: 200, cls: 'local', name: 'Окраинная ул.', spans: [[-108, 120]] },
    { x: 280, cls: 'service', name: 'Терминальный пр.', spans: [[160, 214]] },
    { x: 290, cls: 'service', name: 'въезд P+R', spans: [[0, 10]], lot: 'P+R' },
  ];
  const H = [
    { z: -190, cls: 'collector', name: 'Промышленная ул.', spans: [[0, 160]] },
    { z: -160, cls: 'arterial', name: 'Северный пр.', spans: [[-300, 160]] },
    { z: -108, cls: 'local', name: 'Привокзальная ул.', spans: [[-194, -40], [40, 200]] },
    { z: -80, cls: 'collector', name: 'Вокзальная ул.', spans: [[-300, 200]] },
    { z: -40, cls: 'local', spans: [[-280, -232], [-194, 200]] },
    { z: 0, cls: 'arterial', name: 'Центральная магистраль', spans: [[-300, 300]] },
    { z: 40, cls: 'local', spans: [[-280, -232], [-160, 200]] },
    { z: 80, cls: 'collector', name: 'Университетский б-р', spans: [[-300, 200]] },
    { z: 120, cls: 'local', spans: [[-280, -232], [-194, -160], [-80, 80], [160, 200]] },
    { z: 160, cls: 'arterial', name: 'Южный пр. / Портовое ш.', spans: [[-300, 330]] },
    { z: 188, cls: 'collector', name: 'Набережная', spans: [[-194, 40]] },
    { z: 196, cls: 'service', name: 'Причальная ул.', spans: [[80, 160]] },
    { z: 214, cls: 'service', name: 'Контейнерный пр.', spans: [[160, 280]] },
  ];
  // extra split points: diamond terminals, the P+R entrance
  const DT = 18;   // half spacing of the diamond ramp terminals (36 game m = 90 m real, the 300 ft desirable spacing)
  const extraZ = { 0: [M1_Z - DT, M1_Z + DT] }, extraX = { 0: [M2_X - DT, M2_X + DT, 290] };

  // ------------------------------------------------------------------ graph
  const nodes = new Map(), edges = [], key = (x, z) => `${R(x)},${R(z)}`;
  const node = (x, z) => { const k = key(x, z); let n = nodes.get(k); if (!n) { n = { id: 'n' + nodes.size, x: R(x), z: R(z), legs: [] }; nodes.set(k, n); } return n; };
  const addEdge = (a, b, cls, name, extra = {}) => { const e = { id: 'e' + edges.length, a: a.id, b: b.id, cls, name: name || null, w: CLS[cls].w, ...extra }; edges.push(e); a.legs.push(e.id); b.legs.push(e.id); return e; };
  const covers = (spans, v) => spans.some(([a, b]) => v >= a - 1e-6 && v <= b + 1e-6);
  const riverOver = (x0, x1) => Math.max(x0, x1) > RIVER.x - RIVER.w / 2 && Math.min(x0, x1) < RIVER.x + RIVER.w / 2;
  for (const l of V) for (const [a, b] of l.spans) {
    const cuts = [a, b, ...H.filter((h) => covers(h.spans, l.x) && h.z > a && h.z < b).map((h) => h.z), ...((extraZ[l.x] || []).filter((z) => z > a && z < b))];
    const zs = [...new Set(cuts)].sort((p, q) => p - q);
    for (let i = 0; i + 1 < zs.length; i++) {
      const z0 = zs[i], z1 = zs[i + 1], ex = { dir: 'z' };
      if (z0 < RAIL_Z && z1 > RAIL_Z) ex.underRail = RAIL_Z;
      if (z0 < M1_Z && z1 > M1_Z && l.x === 0) ex.underMotorway = 'M1';
      if (l.lot) ex.lot = l.lot;
      addEdge(node(l.x, z0), node(l.x, z1), l.cls, l.name, ex);
    }
  }
  for (const l of H) for (const [a, b] of l.spans) {
    const cuts = [a, b, ...V.filter((v) => covers(v.spans, l.z) && v.x > a && v.x < b).map((v) => v.x), ...((extraX[l.z] || []).filter((x) => x > a && x < b))];
    const xs = [...new Set(cuts)].sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], ex = { dir: 'x' };
      if (riverOver(x0, x1) && l.z > -175) ex.bridge = 'river';
      if (x0 < M2_X && x1 > M2_X && l.z === 0) ex.underMotorway = 'M2';
      if (x0 < M2_X && x1 > M2_X && l.z === 160) ex.underRamps = 'I4';
      addEdge(node(x0, l.z), node(x1, l.z), l.cls, l.name, ex);
    }
  }
  // motorways (own node keys: they cross the street grid only on bridges)
  const mnode = (x, z) => node(x + 1e-3, z + 1e-3);
  const M1x = [-300, 0, M2_X, 370];   // runs on past the map edge: the east cloverleaf ramps join it there
  for (let i = 0; i + 1 < M1x.length; i++) addEdge(mnode(M1x[i], M1_Z), mnode(M1x[i + 1], M1_Z), 'motorway', 'М1 Северная хорда', { dir: 'x', ref: 'M1' });
  const M2z = [-370, M1_Z, 0, 88];
  for (let i = 0; i + 1 < M2z.length; i++) addEdge(mnode(M2_X, M2z[i]), mnode(M2_X, M2z[i + 1]), 'motorway', 'М2 Восточная хорда', { dir: 'z', ref: 'M2', ...(M2z[i] < RAIL_Z && M2z[i + 1] > RAIL_Z ? { overRail: RAIL_Z } : {}) });
  const exits = [...nodes.values()].filter((n) => n.legs.length === 1 && (Math.abs(n.x) >= 299.9 || n.z <= size.z0 + 0.1)).map((n) => n.id);   // roads that leave the map (to the region)

  // ------------------------------------------------------------------ interchanges (ramps are polylines in game metres; `bridges` = parts above another road)
  const interchanges = [];
  function diamond(id, at, k, name, cross, cwPlus, cwMinus, slipPlus = cwPlus, slipMinus = cwMinus, SC = 1, SH = 0) {   // SH: pulls the whole slip-lane turn + merge SH game m towards the motorway (I2: the merge must not touch the junction with Окраинная ул.)
    // SC shortens only the SOUTH end of the ramps (the side of the trumpet I4); `south` = the local u sign that points south in this pair's frame
    const sqf = (south) => (p) => [Math.sign(p[0]) * (Math.abs(p[0]) > 10 && Math.sign(p[0]) === south ? 10 + (Math.abs(p[0]) - 10) * SC : Math.abs(p[0])), p[1]];   // shorten the ramps along the motorway (I2: the trumpet I4 starts 80 m south)
    // real diamond: taper (1:15 real) into a parallel deceleration lane beside the carriageway, then ONE smooth curve to the terminal;
    // the ramp hugs the motorway (8-13 game m = 20-33 m real from the carriageway edge). The -v side is the same pair turned 180 degrees.
    const ramps = [], LN = MW + CLS.ramp.w / 2;   // centre of an added lane right beside the carriageway
    // + free right-turn slip lanes (channelised): from the off-ramp's parallel lane one smooth curve turns ~90 degrees, runs as its own lane
    //   beside the crossing road for ~15 game m (35-40 m real) and merges tangentially into its outer lane; the on-slip is the mirror.
    //   Left turns and straight-on stay at the two signalised terminals, so all 8 movements work.
    const pair = (Fk, cw, cs, south) => {
      const sq = sqf(south);
      const off = join(cubic([-104, ATT], [1, 0], 7, [-86, LN], [1, 0], 7, 10), seg([-86, LN], [-60, LN], 4), cubic([-60, LN], [1, 0], 24, [-(cw - 0.3), DT], [1, 0], 16));
      const on = join(cubic([cw - 0.3, DT], [1, 0], 16, [60, LN], [1, 0], 24), seg([60, LN], [86, LN], 4), cubic([86, LN], [1, 0], 7, [104, ATT], [1, 0], 7, 10));
      const sl = (cs ?? 0) + CLS.ramp.w / 2 + 0.6;   // slip lane centre: its own lane beside the road with a painted / kerbed island
      // The final control point must stay OUTSIDE the parallel ramp lane.
      // Old end v=28, k3=28 put it at v=0 and bowed the slip back across
      // the motorway edge. A longer initial tangent and a bend 2 m outward
      // preserve >=14 m radii while keeping the original avenue merge point.
      const slipOff = join(cubic([-80, LN], [1, 0], 44, [-sl, DT + 12 - SH], [0, 1], 22, 36), seg([-sl, DT + 12 - SH], [-sl, DT + 13 - SH], 2), cubic([-sl, DT + 13 - SH], [0, 1], 7, [-((cs ?? 0) - 0.8), DT + 28 - SH], [0, 1], 7, 12));
      const slipOn = slipOff.map(([u, v]) => [-u, v]).reverse();
      ramps.push({ kind: 'off', pts: off.map(sq).map(Fk), attach: ['motorway', 'cross'], decel: 26 }, { kind: 'on', pts: on.map(sq).map(Fk), attach: ['cross', 'motorway'], accel: 26 });
      if (cs == null) return;   // no room for slip lanes (P+R entrance): right turns use the signalised terminal
      ramps.push({ kind: 'slip-off', pts: slipOff.map(sq).map(Fk), attach: ['ramp', 'cross'], note: 'свободный правый поворот с хорды на проспект' }, { kind: 'slip-on', pts: slipOn.map(sq).map(Fk), attach: ['cross', 'ramp'], note: 'свободный правый поворот с проспекта на хорду' });
    };
    const F = frame(at, k);
    pair(F, cwPlus, slipPlus, 1); pair(frame(at, k + 2), cwMinus, slipMinus, -1);
    const terminals = [F([0, DT]), F([0, -DT])];
    interchanges.push({ id, kind: 'diamond', name, at, cross, ramps, terminals, terminalSpacing: 2 * DT, deck: [F([-(cwPlus + 4), 0]), F([cwPlus + 4, 0])], deckRoad: 'motorway' });
  }
  function cloverleaf(id, at, name) {
    const r = 18, a = MW + 4, L = 110, kk = 30, ramps = [];
    for (let q = 0; q < 4; q++) {
      const F = frame(at, q), C = [a + r, a + r];
      const loop = join(cubic([MW + 2.8, ATT], [1, 0], 8, [a + r, a], [1, 0], 9), arc(C, r, -90, 180), cubic([a, a + r], [0, -1], 9, [ATT, MW + 2.8], [0, -1], 8));
      ramps.push({ kind: 'loop', pts: loop.map(F), r, attach: ['motorway', 'motorway'] });
      ramps.push({ kind: 'outer', pts: cubic([ATT, L], [0, -1], kk, [L, ATT], [1, 0], kk, 36).map(F), attach: ['motorway', 'motorway'] });
    }
    interchanges.push({ id, kind: 'cloverleaf', name, at, ramps, deck: [frame(at, 0)([0, -(MW + 4)]), frame(at, 0)([0, MW + 4])], deckRoad: 'motorway', note: 'М2 проходит над М1; четыре петли (левые повороты) и четыре внешних съезда (правые)' });
  }
  const TR_K = 5, TR_R2 = 16, TR_L = 14, TR_Y = 1.0;   // I4 semi-direct ramp: entry arc 16 (was 17), lead-in 14 -> the taper starts at x = 174.5, 14.5 m (36 m real) behind the signal at x = 160 (was 9.5); tightest radius stays 14.2
  function trumpet(id, at, name) {
    // M2 ends from the north; the through road H (z = at.z) runs east-west. Bell (loop + rim) on the far (south) side, two trunk ramps cross H on a bridge.
    const F = frame(at, 0), hw = CLS.arterial.w / 2, r = 17, C = [-TRK - r, hw + CLS.ramp.w / 2 + 0.4 + r], Rr = r + 2 * TRK, top = -72, ramps = [];
    const b = join(seg([-TRK, top], [-TRK, C[1]], 10), arc(C, r, 0, 270), seg([C[0], hw + CLS.ramp.w / 2 + 0.4], [6, hw + CLS.ramp.w / 2 + 0.4], 6), cubic([6, hw + CLS.ramp.w / 2 + 0.4], [1, 0], 7, [22, hw - 1.0], [1, 0], 7, 10));
    const R2 = TR_R2, yb = hw + CLS.ramp.w / 2 + 0.4, X2 = C[0] - Rr - R2;   // entry arc radius R2 (was 17): the ramp leaves the road later, the lead-in starts TR_L m before the arc
    const d = join(cubic([X2 - TR_L, hw - TR_Y], [1, 0], TR_K, [X2, yb], [1, 0], TR_K, 12), arc([X2, yb + R2], R2, -90, 0), ...(R2 < 17 ? [seg([C[0] - Rr, yb + R2], [C[0] - Rr, C[1]], 3)] : []), arc(C, Rr, 180, 0), seg([TRK, C[1]], [TRK, top], 10));
    const LM = MW + CLS.ramp.w / 2, LH = hw + CLS.ramp.w / 2;   // added lanes beside M2 and beside the through road
    const a = join(cubic([-ATT, -96], [0, 1], 6, [-LM, -80], [0, 1], 6, 10), seg([-LM, -80], [-LM, -66], 3), cubic([-LM, -66], [0, 1], 30, [-34, -LH], [-1, 0], 24), seg([-34, -LH], [-50, -LH], 3), cubic([-50, -LH], [-1, 0], 6, [-64, -(hw - 1.0)], [-1, 0], 6, 10));
    const c = join(cubic([64, -(hw - 1.0)], [-1, 0], 6, [50, -LH], [-1, 0], 6, 10), seg([50, -LH], [34, -LH], 3), cubic([34, -LH], [-1, 0], 24, [LM, -66], [0, -1], 30), seg([LM, -66], [LM, -80], 3), cubic([LM, -80], [0, -1], 6, [ATT, -96], [0, -1], 6, 10));
    ramps.push({ kind: 'loop', pts: b.map(F), r, attach: ['motorway', 'cross'], bridges: [[F([-TRK, -hw - 4]), F([-TRK, hw + 4])]], note: 'М2 на юг -> Портовое ш. на восток (петля 270°)' });
    ramps.push({ kind: 'semi-direct', pts: d.map(F), attach: ['cross', 'motorway'], bridges: [[F([TRK, hw + 4]), F([TRK, -hw - 4])]], note: 'Южный пр. на восток -> М2 на север (раструб вокруг петли)' });
    ramps.push({ kind: 'direct', pts: a.map(F), attach: ['motorway', 'cross'], note: 'М2 на юг -> Южный пр. на запад' });
    ramps.push({ kind: 'direct', pts: c.map(F), attach: ['cross', 'motorway'], note: 'Портовое ш. на запад -> М2 на север' });
    interchanges.push({ id, kind: 'trumpet', name, at, ramps, trunkEnd: F([0, top]), note: 'три ветви: М2 заканчивается; раструб на стороне порта' });
  }
  diamond('I1', [0, M1_Z], 0, 'Ромб: Главный пр. × М1', 'Главный пр.', CLS.arterial.w / 2, CLS.arterial.w / 2, CLS.arterial.w / 2, CLS.collector.w / 2);
  diamond('I2', [M2_X, 0], 1, 'Ромб: Центральная магистраль × М2', 'Центральная магистраль', CLS.arterial.w / 2, CLS.arterial.w / 2, null, null, 0.82);   // no slip lanes: their merge would end at the Окраинная ул. junction (x 204 vs its kerb at 204); the right turns use the signalised terminals. Only the SOUTH ramp ends are shortened (trumpet I4 starts at z 88), the north ends keep the full 104 m
  cloverleaf('I3', [M2_X, M1_Z], 'Клеверный лист: М1 × М2');
  trumpet('I4', [M2_X, 160], 'Трубка: М2 × Портовое ш.');

  // ------------------------------------------------------------------ junction types
  const nodeArr = [...nodes.values()], byId = new Map(nodeArr.map((n) => [n.id, n])), eById = new Map(edges.map((e) => [e.id, e]));
  const inner = (x, z) => Math.abs(x) <= 160 && Math.abs(z) <= 160;
  const SPECIAL = {
    '0,0': { type: 'roundabout', R: 15, lanes: 2, name: 'Центральная площадь' },
    '0,188': { type: 'roundabout', R: 11, lanes: 1, name: 'Морская площадь' },
    '-232,-160': { type: 'roundabout', R: 11, lanes: 1 }, '-232,0': { type: 'roundabout', R: 11, lanes: 1 }, '-232,160': { type: 'roundabout', R: 11, lanes: 1 },
    '-232,-80': { type: 'priority', major: null }, '-232,80': { type: 'priority', major: null }, '-80,188': { type: 'priority', major: null }, '80,-190': { type: 'priority', major: null },
    '160,-190': { type: 'roundabout', R: 11, lanes: 1 }, '0,-190': { type: 'riro' },
  };
  const junctions = [];
  for (const n of nodeArr) {
    const L = n.legs.map((id) => eById.get(id)), isTerm = interchanges.some((ic) => (ic.terminals || []).some((t) => Math.hypot(t[0] - n.x, t[1] - n.z) < 0.5));
    if (L.length < 3 && !isTerm && !(L.length === 2 && L[0].dir !== L[1].dir)) continue;
    if (L.some((e) => e.cls === 'motorway')) continue;
    const cl = L.map((e) => e.cls), k = `${n.x},${n.z}`, RANK = { arterial: 4, collector: 3, service: 2, local: 1 };
    const ax = { x: null, z: null }; for (const e of L) if (!ax[e.dir] || RANK[e.cls] > RANK[ax[e.dir]]) ax[e.dir] = e.cls;
    const pair = [ax.x, ax.z].sort((p, q) => RANK[q] - RANK[p]), [hi, lo] = pair;
    let j = { type: 'priority' };
    if (SPECIAL[k]) j = { ...SPECIAL[k] };
    else if (isTerm) j = { type: 'signal', terminal: true };
    else if (L.length === 2) j = { type: 'corner' };
    else if (hi === 'arterial' && lo === 'arterial') j = { type: 'signal' };
    else if (hi === 'arterial' && lo === 'collector') j = inner(n.x, n.z) ? { type: 'signal' } : { type: 'roundabout', R: 11, lanes: 1 };
    else if (hi === 'arterial' && lo === 'service' && !L.some((e) => e.lot) && (n.x === 160 || n.x === 80)) j = { type: 'signal' };
    else if (hi === 'arterial') j = { type: 'riro' };
    else if (hi === 'collector' && lo === 'collector') j = { type: 'mini' };
    else if (hi === 'collector') j = { type: 'priority', major: 'collector' };
    else j = { type: 'priority', major: null };
    n.kind = j.type;
    junctions.push({ id: n.id, at: [n.x, n.z], ...j, legs: L.length, classes: cl, arms: L.map((e) => { const o = byId.get(e.a === n.id ? e.b : e.a); return { edge: e.id, cls: e.cls, dir: [Math.sign(R(o.x - n.x)), Math.sign(R(o.z - n.z))] }; }) });
  }

  // ------------------------------------------------------------------ crossings (pedestrian), footbridges, tunnels
  const crossings = [];
  for (const j of junctions) {
    if (j.type === 'signal') for (const a of j.arms) crossings.push({ id: `${j.id}-p${crossings.length}`, kind: 'ped-signal', at: j.at, arm: a.dir, cls: a.cls });
    else if (j.type === 'roundabout') for (const a of j.arms) crossings.push({ id: `${j.id}-z${crossings.length}`, kind: 'zebra-refuge', at: j.at, arm: a.dir, cls: a.cls, setback: j.R + 2.6 });
    else if (j.type === 'mini') for (const a of j.arms) crossings.push({ id: `${j.id}-z${crossings.length}`, kind: 'zebra', at: j.at, arm: a.dir, cls: a.cls, setback: 9 });
  }
  // mid-block pedestrian signals where an urban arterial runs more than 80 game m (200 m real) from the nearest crossing
  const midBlock = [[-256, 0], [-256, 160], [-256, -160], [-256, -80], [-256, 80], [-140, 188], [20, 188]];
  for (const [x, z] of midBlock) {
    const e = edges.find((g) => { const a = byId.get(g.a), b = byId.get(g.b); return g.dir === 'x' && a.z === z && Math.min(a.x, b.x) < x && Math.max(a.x, b.x) > x; });
    if (e) crossings.push({ id: `MB${crossings.length}`, kind: e.cls === 'arterial' ? 'ped-signal-midblock' : 'zebra', at: [x, z], arm: null, cls: e.cls, axis: 'x', note: 'у остановки / у вилл' });
  }
  const footbridges = [
    { id: 'FB1', at: [250, -104], axis: 'x', over: 'М2 Восточная хорда', len: 46, note: 'конец Университетского б-ра -> Восточный лесопарк', ramps: 'пандусы + лифт' },
    { id: 'FB2', at: [-210, 40], axis: 'x', over: 'река', len: 34, note: 'пешеходно-велосипедный мост набережного парка' },
    { id: 'FB3', at: [120, 0], axis: 'z', over: 'Центральная магистраль', len: 16, note: 'улица «право-право»: пешеходы переходят по мосту (рынок, университет)', ramps: 'пандусы' },
    { id: 'FB4', at: [-120, 0], axis: 'z', over: 'Центральная магистраль', len: 16, note: 'больница и школа по разные стороны магистрали', ramps: 'пандусы' },
    { id: 'FB5', at: [-160, 108], axis: 'x', over: 'Западный пр.', len: 16, note: 'к стадиону', ramps: 'пандусы + лифт' },
    { id: 'FB6', at: [-150, M1_Z], axis: 'z', over: 'М1 Северная хорда', len: 30, note: 'лесопарк по обе стороны хорды' },
  ];
  const tunnels = [
    { id: 'PT1', at: [-28, RAIL_Z], axis: 'z', under: 'пути вокзала', len: 22, note: 'подземный переход к платформам, выход к депо' },
    { id: 'PT2', at: [-52, RAIL_Z], axis: 'z', under: 'пути вокзала', len: 22, note: 'второй выход, к Школьной ул.' },
    { id: 'PT3', at: [0, 0], axis: 'ring', under: 'Центральная площадь (кольцо)', len: 30, note: 'подземный переход под кольцом, 4 выхода' },
  ];

  // ------------------------------------------------------------------ rail
  const spur = join(cubic([90, RAIL_Z - 1.6], [1, 0], 18, [118, -140], [0, -1], 12, 20), seg([118, -140], [118, -186], 4));
  const rail = {
    id: 'RAIL1', name: 'Главный ход', pts: [[size.x0 - 20, RAIL_Z], [size.x1 + 20, RAIL_Z]], tracks: 2, gauge: 1.2,
    stations: [{ id: 'ST1', name: 'Центральный вокзал', at: [-40, RAIL_Z], x0: -62, x1: -18, platforms: 3, tracks: 4 }],
    spur: { pts: spur.map(P2), name: 'Подъездной путь промзоны', levelCrossings: [], roadBridges: [[118, -160]] },
    yard: { x0: -64, x1: -8, z0: -158, z1: -128, tracks: 5, name: 'Депо', joinX: -72 },
  };
  const grade = [];
  for (const e of edges) if (e.underRail) { const a = byId.get(e.a); grade.push({ id: 'U' + grade.length, kind: 'underpass', at: [a.x, RAIL_Z], road: e.name, cls: e.cls, len: 12, note: 'дорога под ж/д насыпью' }); }
  grade.push({ id: 'BR-RAIL', kind: 'rail-bridge', at: [RIVER.x, RAIL_Z], len: RIVER.w + 8, note: 'ж/д мост через реку' });
  grade.push({ id: 'OV-M2-RAIL', kind: 'motorway-over-rail', at: [M2_X, RAIL_Z], len: 16 });
  for (const e of edges) if (e.bridge) { const a = byId.get(e.a), b = byId.get(e.b); grade.push({ id: 'BR' + grade.length, kind: 'road-bridge', at: [RIVER.x, a.z], road: e.name, cls: e.cls, len: RIVER.w + 8, span: [Math.min(a.x, b.x), Math.max(a.x, b.x)] }); }

  // ------------------------------------------------------------------ water and land use
  // river: natural meander in the fields, a gentle meander in town that crosses every bridge line square-on (x = -210 at z = -160, -80, 0, 80, 160)
  const ph = (z) => Math.sin((z + 160) / 80 * Math.PI);   // 0 on every bridge line: bridges cross square-on at x = -210
  const townBends = []; for (let z = -170; z <= 200; z += 8) townBends.push([-210 + 3 * ph(z), z]);
  const riverPts = catmull([[-168, -380], [-182, -352], [-206, -326], [-226, -300], [-216, -282], [-232, -258], [-221, -232], [-212, -204], ...townBends], 4);
  // natural banks: the width breathes (wide on the inside of a bend, narrower in the crossings), 16-24 m; the mouth opens into a sandy estuary
  const widthAt = (p) => { const z = p[1]; if (z < -176) return 18 + 4 * Math.sin(z / 23) + 2 * Math.sin(z / 9); const w = 19 - 3 * ph(z) + 1.2 * Math.sin(z / 11) * Math.abs(ph(z)); return z > 184 ? w + (z - 184) * 1.1 : w; };
  const banks = { left: [], right: [] };
  riverPts.forEach((p, i) => { const a = riverPts[Math.max(0, i - 1)], b = riverPts[Math.min(riverPts.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l], w = widthAt(p) / 2; banks.left.push(P2([p[0] - n[0] * w, p[1] - n[1] * w])); banks.right.push(P2([p[0] + n[0] * w, p[1] + n[1] * w])); });
  const piers = [[56, 88], [112, 144], [168, 200], [228, 300]];
  const coast = [...catmull([[-320, 212], [-296, 207], [-270, 213], [-248, 209], [-236, 211]], 5), ...catmull([[-188, 207], [-172, 211], [-154, 206], [-132, 210], [-112, 208]], 6), ...catmull([[-8, 208], [8, 212], [24, 207], [40, 205]], 5)];
  coast.push([40, 222]); for (const [p0, p1] of piers) { coast.push([p0, 222], [p0, 252], [p1, 252]); if (p1 < 300) coast.push([p1, 222]); } coast.push([320, 252]);
  const ships = [[100, 238, 40, 9, 'контейнеровоз'], [156, 236, 36, 8, 'контейнеровоз'], [214, 240, 30, 8, 'балкер'], [-26, 252, 14, 4, 'яхта']];
  const water = {
    sea: { z: SEA_Z, coast: coast.map(P2) },
    river: { x: RIVER.x, w: RIVER.w, pts: riverPts, banks, mouth: [[-236, 211], [-221, 196], [-199, 196], [-188, 207]] },
    rocks: [[-190, 209, 2.4], [-185, 211, 1.6], [-10, 211, 2.2], [-4, 213, 1.4], [37, 207, 2.0], [-298, 209, 1.8]],
    piers: piers.map(([x0, x1]) => ({ x0, x1, z0: 222, z1: 252 })), ships: ships.map(([x, z, len, w, kind]) => ({ at: [x, z], len, w, kind })),
    marina: { x0: -112, x1: -8, z0: 208, z1: 236, moles: [cubic([-112, 208], [0, 1], 18, [-70, 238], [1, 0], 22, 20).map(P2), cubic([-8, 208], [0, 1], 18, [-48, 238], [-1, 0], 22, 20).map(P2)] },
  };
  const rural = (() => {
    const rnd = mulberry(4242), fields = [], forests = [], farms = [], lanes = [];
    const xsF = [-300, -246, -190, -128, -64, -6], xsE = [6, 58, 112, 160], zsF = [-372, -334, -296, -254];
    const jitter = (v, k) => v + (rnd() - 0.5) * k;
    const grid = (xs) => zsF.map((z, j) => xs.map((x, i) => [i === 0 || i === xs.length - 1 ? x : jitter(x, 14), j === 0 || j === zsF.length - 1 ? z : jitter(z, 10)]));
    for (const xs of [xsF, xsE]) {
      const g = grid(xs);
      for (let j = 0; j + 1 < g.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
        const q = [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]], cx = (q[0][0] + q[2][0]) / 2, cz = (q[0][1] + q[2][1]) / 2;
        if (rnd() < 0.18) { forests.push(blob([cx, cz], 20 + rnd() * 8, rnd)); continue; }
        fields.push({ poly: q.map(P2), crop: Math.floor(rnd() * 5), angle: rnd() < 0.5 ? 0 : 90, strips: 2 + Math.floor(rnd() * 3) });
      }
      for (let j = 1; j + 1 < g.length; j++) lanes.push(g[j].map(P2));   // east-west tracks along field edges
      for (let i = 1; i + 1 < xs.length; i++) if (rnd() < 0.6) lanes.push(g.map((row) => P2(row[i])));
    }
    for (const [x, z] of [[-150, -316], [-40, -274], [84, -318], [-262, -280]]) farms.push({ at: [x, z], rot: Math.floor(rnd() * 2) * 90 });
    for (const [c, r] of [[[-90, -352], 16], [[30, -300], 12], [[140, -352], 14]]) forests.push(blob(c, r, rnd));
    return { fields, forests, farms, lanes };
  })();
  const areas = [
    { kind: 'forest', poly: [[-300, -240], [0, -240], [0, -168], [-300, -168]], name: 'Лесопарк' },
    { kind: 'forest', poly: [[-300, -168], [-236, -168], [-236, -84], [-300, -84]] },
    { kind: 'forest', poly: [[-300, -84], [-284, -84], [-284, 164], [-300, 164]] },
    { kind: 'industry', poly: [[4, -232], [164, -232], [164, -164], [4, -164]] },
    { kind: 'verge', poly: [[164, -232], [300, -232], [300, -164], [164, -164]] },
    // the verge strip leaves the P+R lot [262,298]x[8,34] free: two flat ground polygons 4 mm apart z-fought into a grey triangle at a grazing view
    { kind: 'verge', poly: [[204, -164], [300, -164], [300, 8], [204, 8]] }, { kind: 'verge', poly: [[204, 8], [262, 8], [262, 34], [204, 34]] },
    { kind: 'verge', poly: [[298, 8], [300, 8], [300, 34], [298, 34]] }, { kind: 'verge', poly: [[204, 34], [300, 34], [300, 156], [204, 156]] },
    { kind: 'park', poly: [[256, 40], [300, 40], [300, 156], [256, 156]], name: 'Восточный лесопарк' },
    { kind: 'parking', poly: [[262, 8], [298, 8], [298, 34], [262, 34]], name: 'P+R' },
    { kind: 'embankment', poly: [[-236, -168], [-188, -168], [-188, 206], [-236, 206]] },
    { kind: 'beach', poly: [[-300, 164], [-236, 164], [-226, 192], [-226, 212], [-300, 212]] },
    { kind: 'promenade', poly: [[-188, 191], [44, 191], [44, 212], [-188, 212]] },
    { kind: 'port', poly: [[40, 164], [300, 164], [300, 256], [40, 256]] },
    { kind: 'urban', poly: [[-284, -164], [204, -164], [204, 191], [-284, 191]] },
  ];

  // ------------------------------------------------------------------ blocks: cells between street lines, merged where no street separates them
  const xs = [-280, -232, -194, -160, -120, -80, -40, 0, 40, 80, 120, 160, 200], zs = [-218, -190, -160, -126, -108, -80, -40, 0, 40, 80, 120, 160, 188];
  const zoneAt = (cx, cz) => {
    if (cz < -160) return cx > 0 && cx < 160 ? 'industrial' : null;
    if (cz < -126) { if (cx < -194) return null; if (cx > -80 && cx < 0) return 'railyard'; return 'logistics'; }
    if (cz < -108) return null;
    if (cx < -232) return cz > -80 && cz < 160 ? 'villas' : null;
    if (cx < -194) return null;
    if (cz > 160) return cx < 40 ? 'waterfront' : null;
    if (cz < -80) { if (cx > -40 && cx < 0) return 'station'; if (cx > 0 && cx < 40) return 'busterm'; return 'residential'; }
    if (cx < -160) return cz > -40 && cz < 120 ? 'park' : 'residential';
    if (cx > -120 && cx < -80 && cz > -40 && cz < 0) return 'hospital';
    if (cx > -120 && cx < -80 && cz > 0 && cz < 40) return 'school';
    if (cx > 40 && cx < 80 && cz > -40 && cz < 0) return 'market';
    if (cx > -160 && cx < -80 && cz > 80) return 'stadium';
    if (cx > 80 && cx < 160 && cz > 80) return 'campus';
    if (cx > 160) return cz > -80 && cz < -40 ? 'school' : 'east';
    if (Math.abs(cx) < 80 && Math.abs(cz) < 80) return 'cbd';
    return Math.abs(cx) < 120 && Math.abs(cz) < 120 ? 'mixed' : 'residential';
  };
  const streetAlong = (axis, c, a, b) => {   // the street on a cell side (V line at x = c covering z in [a, b], or H line at z = c)
    const L = axis === 'x' ? V.filter((l) => l.x === c) : H.filter((l) => l.z === c);
    for (const l of L) for (const [s0, s1] of l.spans) if (s0 <= a + 1e-6 && s1 >= b - 1e-6) return l;
    if (axis === 'x' && c === 0 && a >= -262 && b <= 188) return V.find((l) => l.x === 0 && l.cls === 'arterial');
    return null;
  };
  const cells = [];
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1], zone = zoneAt((x0 + x1) / 2, (z0 + z1) / 2);
    if (zone) cells.push({ i, j, x0, x1, z0, z1, zone, g: cells.length });
  }
  const anyStreet = (axis, c, a, b) => (axis === 'x' ? V.filter((l) => l.x === c) : H.filter((l) => l.z === c)).some((l) => l.spans.some(([s0, s1]) => s0 < b - 1e-6 && s1 > a + 1e-6));
  let rects = cells.map((c) => ({ x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, zone: c.zone, n: 1 }));
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < rects.length; i++) for (let k = 0; k < rects.length; k++) {
      const A = rects[i], B = rects[k]; if (i === k || A.zone !== B.zone) continue;
      const hz = A.x1 === B.x0 && A.z0 === B.z0 && A.z1 === B.z1 && !anyStreet('x', A.x1, A.z0, A.z1);
      const vt = A.z1 === B.z0 && A.x0 === B.x0 && A.x1 === B.x1 && !anyStreet('z', A.z1, A.x0, A.x1);
      if (hz || vt) { rects[i] = { x0: A.x0, z0: A.z0, x1: hz ? B.x1 : A.x1, z1: vt ? B.z1 : A.z1, zone: A.zone, n: A.n + B.n }; rects.splice(k, 1); changed = true; break outer; }
    }
  }
  const blocks = [];
  for (const g of rects) {
    const { x0, x1, z0, z1 } = g, list = [g];
    const half = (l) => l ? CLS[l.cls].w / 2 + CLS[l.cls].sidewalk + 0.4 : 1.5;
    const sides = { w: streetAlong('x', x0, z0, z1) || streetAlong('x', x0, z0 + 1, z0 + 2), e: streetAlong('x', x1, z0, z1) || streetAlong('x', x1, z0 + 1, z0 + 2), n: streetAlong('z', z0, x0, x1) || streetAlong('z', z0, x0 + 1, x0 + 2), s: streetAlong('z', z1, x0, x1) || streetAlong('z', z1, x0 + 1, x0 + 2) };
    const lot = [x0 + half(sides.w), z0 + half(sides.n), x1 - half(sides.e), z1 - half(sides.s)].map(R);
    blocks.push({ id: 'b' + blocks.length, rect: [x0, z0, x1, z1], lot, zone: g.zone, cells: g.n, frontage: Object.entries(sides).filter(([, l]) => l).map(([k, l]) => `${k}:${l.cls}`) });
  }
  blocks.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]); blocks.forEach((b, i) => { b.id = 'b' + i; });

  // ------------------------------------------------------------------ transit (stops placed by hand mid-block, ~80 game m = 200 m real apart)
  const lines = [
    { id: 'B1', name: 'Автобус 1: P+R «Восток» — Центр — Береговая', color: '#d9480f', pts: [[290, 0], [-280, 0]], stops: [286, 186, 104, 24, -56, -136, -256].map((x) => [x, 0]) },
    { id: 'B2', name: 'Автобус 2: Вокзал — Центр — Морская площадь', color: '#1c6dd0', pts: [[0, -100], [0, 188]], stops: [-100, -24, 56, 136, 176].map((z) => [0, z]) },
    { id: 'B3', name: 'Автобус 3: кольцо по проспектам', color: '#2b8a3e', pts: [[-160, -160], [160, -160], [160, 160], [-160, 160], [-160, -160]], stops: [] },
  ];
  const rbs = [{ c: [0, 0], r: 8.6 }, { c: [0, 188], r: 6.6 }];
  const roundRoute = (pts) => {
    const out = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], d = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
      for (const rb of rbs) {
        const onSeg = (d[0] ? rb.c[1] === a[1] && (rb.c[0] - a[0]) * d[0] > 0 && (b[0] - rb.c[0]) * d[0] >= 0 : rb.c[0] === a[0] && (rb.c[1] - a[1]) * d[1] > 0 && (b[1] - rb.c[1]) * d[1] >= 0); if (!onSeg) continue;
        const ang = Math.atan2(-d[1], -d[0]) * 180 / Math.PI, end = b[0] === rb.c[0] && b[1] === rb.c[1];
        out.push([rb.c[0] - d[0] * (rb.r + 6), rb.c[1] - d[1] * (rb.r + 6)]);
        if (end) { out.push(...arc(rb.c, rb.r, ang, ang - 360, 10), [rb.c[0] - d[0] * (rb.r + 6), rb.c[1] - d[1] * (rb.r + 6)]); continue; }   // terminus: once round the island and back
        out.push(...arc(rb.c, rb.r, ang, ang - 180, 10), [rb.c[0] + d[0] * (rb.r + 6), rb.c[1] + d[1] * (rb.r + 6)]);
      }
      if (!rbs.some((rb) => rb.c[0] === b[0] && rb.c[1] === b[1])) out.push(b);
    }
    return join(out.map(P2));
  };
  for (const l of lines) l.pts = roundRoute(l.pts);
  for (const v of [-120, -40, 40, 120]) lines[2].stops.push([v, -160], [160, v], [-v, 160], [-160, -v]);
  const transit = { lines, note: 'остановки ~80 игровых м (200 м настоящих), у перекрёстков и в середине кварталов; метро / трамвай позже (C5)' };

  const landmarks = [
    { id: 'L1', kind: 'plaza', name: 'Центральная площадь', at: [0, 0] }, { id: 'L2', kind: 'market', name: 'Рынок', at: [60, -20] },
    { id: 'L3', kind: 'hospital', name: 'Больница', at: [-100, -20] }, { id: 'L4', kind: 'school', name: 'Школа', at: [-100, 20] },
    { id: 'L5', kind: 'university', name: 'Университет', at: [120, 120] }, { id: 'L6', kind: 'stadium', name: 'Стадион', at: [-120, 120] },
    { id: 'L7', kind: 'station', name: 'Центральный вокзал', at: [-20, -94] }, { id: 'L8', kind: 'port', name: 'Порт', at: [120, 180] },
    { id: 'L9', kind: 'park', name: 'Набережный парк', at: [-177, 40] }, { id: 'L10', kind: 'industry', name: 'Промзона', at: [60, -205] },
    { id: 'L11', kind: 'pnr', name: 'P+R «Восток»', at: [280, 41] }, { id: 'L12', kind: 'marina', name: 'Яхтенная гавань', at: [-60, 224] },
    { id: 'L13', kind: 'cityhall', name: 'Мэрия', at: [-22, -22] }, { id: 'L14', kind: 'church', name: 'Собор', at: [22, 22] },
    { id: 'L15', kind: 'busterm', name: 'Автовокзал', at: [20, -95] }, { id: 'L16', kind: 'depot', name: 'Депо', at: [-36, -146] },
    { id: 'L17', kind: 'forest', name: 'Лесопарк', at: [-110, -205] }, { id: 'L18', kind: 'school', name: 'Школа №2', at: [180, -60] },
    { id: 'L19', kind: 'beach', name: 'Пляж', at: [-262, 190] },
  ];

  const sig = junctions.filter((j) => j.type === 'signal');
  return {
    version: 'C0', generated: 'tools/masterplan/plan-c.mjs', scale: 0.4, unit: 'game metre (x east, z south); real = x2.5', traffic: 'right-hand',
    size, water, areas, rural, classes: CLS, lines: { V, H },
    nodes: nodeArr.map(({ legs, ...n }) => ({ ...n, legs: legs.length })), edges, exits, junctions, interchanges, crossings, footbridges, tunnels, rail, grade, transit, blocks, landmarks,
    counts: { nodes: nodes.size, edges: edges.length, junctions: junctions.length, signals: sig.length, roundabouts: junctions.filter((j) => j.type === 'roundabout').length, interchanges: interchanges.length, ramps: interchanges.reduce((s, i) => s + i.ramps.length, 0), crossings: crossings.length, footbridges: footbridges.length, tunnels: tunnels.length, blocks: blocks.length, busStops: lines.reduce((s, l) => s + l.stops.length, 0) },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = buildPlan();
  fs.writeFileSync(path.join(ROOT, 'tools/masterplan/plan-C.json'), JSON.stringify(p));
  console.log(JSON.stringify(p.counts));
}
