// Masterplan C (2026-10-18), step C0: the new city layout on paper.  node tools/masterplan/plan-c.mjs  ->  tools/masterplan/plan-C.json
// Game metres (x east, z south). Scale of the game: 1 game metre = 2.5 real metres (cars are ~0.4 of real size, see docs/ROAD_STANDARDS_V161.md).
// Everything here is DATA (roads as graph edges, junctions, interchanges with ramp polylines, crossings, rail, water, transit, zones, blocks); the picture is tools/masterplan/render-plan-c.mjs,
// the norm check is tools/masterplan/audit-plan-c.mjs. Nothing of this is in the game yet (docs/MASTERPLAN_C_PLAN.md, stage C1+).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const R = (n) => Math.round(n * 100) / 100;
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---- classes: width of the carriageway strip in game metres (real = x2.5), lanes per direction, speed (km/h real)
export const CLS = {
  motorway: { w: 10.5, lanes: 2, median: 2.2, speed: 90, sidewalk: 0 },
  arterial: { w: 6.4, lanes: 2, median: 0.9, speed: 60, sidewalk: 1.0 },
  collector: { w: 3.6, lanes: 1, median: 0, speed: 40, sidewalk: 0.9 },
  local: { w: 2.4, lanes: 1, median: 0, speed: 30, sidewalk: 0.7 },
  ramp: { w: 2.0, lanes: 1, median: 0, speed: 50, sidewalk: 0 },
};

export function buildPlan() {
  const rnd = mulberry(20261018);
  const size = { x0: -300, x1: 300, z0: -290, z1: 250 };
  const SEA_Z = 200, RIVER_X = -205, RIVER_W = 22, RAIL_Z = -120, M1_Z = -250, M2_X = 250;

  // ------------------------------------------------------------------ the street lines (name, class, extent)
  const V = [   // N-S lines at x
    { x: -240, cls: 'collector', name: 'Береговая', z: [-160, 190] },
    { x: -160, cls: 'arterial', name: 'Западный проспект', z: [-160, 190], bus: 'B3' },
    { x: -120, cls: 'local' }, { x: -80, cls: 'collector', name: 'Школьная', z: [-160, 190] },
    { x: -40, cls: 'local' }, { x: 0, cls: 'arterial', name: 'Главный проспект', z: [-250, 200], bus: 'B2' },
    { x: 40, cls: 'local' }, { x: 80, cls: 'collector', name: 'Университетская', z: [-160, 190] },
    { x: 120, cls: 'local' }, { x: 160, cls: 'arterial', name: 'Восточный проспект', z: [-160, 190], bus: 'B3' },
    { x: 200, cls: 'local' },
  ];
  const H = [   // E-W lines at z
    { z: -160, cls: 'arterial', name: 'Северный проспект', x: [-285, 245], bus: 'B3' },
    { z: -80, cls: 'collector', name: 'Вокзальная', x: [-285, 245] },
    { z: -40, cls: 'local' }, { z: 0, cls: 'arterial', name: 'Центральная магистраль', x: [-285, 245], bus: 'B1' },
    { z: 40, cls: 'local' }, { z: 80, cls: 'collector', name: 'Университетский б-р', x: [-285, 245] },
    { z: 120, cls: 'local' }, { z: 160, cls: 'arterial', name: 'Южный проспект', x: [-285, 245], bus: 'B3' },
  ];

  // ------------------------------------------------------------------ land use of a cell (x0,x1,z0,z1)
  const inRiver = (x0, x1) => x1 > RIVER_X - RIVER_W / 2 && x0 < RIVER_X + RIVER_W / 2;
  function zoneOf(x0, x1, z0, z1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (inRiver(x0, x1)) return 'water';
    if (cz > SEA_Z - 1) return 'water';
    if (cz > 160 && cz < SEA_Z) return cx > 20 ? 'port' : 'waterfront';
    if (cz < M1_Z + 8) return 'verge';
    if (cz < -160) return cx > 40 ? 'industrial' : 'wood';
    if (cz > -160 && cz < RAIL_Z) return Math.abs(cx) < 100 ? 'station' : 'warehouse';
    if (cx < -216) return 'villas';
    if (cx < -160) return 'park';
    if (Math.abs(cx) < 80 && Math.abs(cz) < 80) return 'cbd';
    if (cx > -160 && cx < -80 && cz > 80 && cz < 160) return 'stadium';
    if (cx > 80 && cx < 160 && cz > 80 && cz < 160) return 'campus';
    if (cx > 160 && cz > -40 && cz < 40 && false) return 'hospital';
    if (cx > 160) return 'east';
    if (Math.abs(cx) < 160 && Math.abs(cz) < 160) return rnd() < 0.18 ? 'mixed' : 'residential';
    return 'residential';
  }
  const urban = (z) => ['cbd', 'residential', 'mixed', 'east', 'villas', 'station', 'campus'].includes(z);

  // ------------------------------------------------------------------ graph: nodes + edges (every line split at the crossings)
  const nodes = new Map(), edges = [], key = (x, z) => `${R(x)},${R(z)}`;
  const node = (x, z) => { const k = key(x, z); let n = nodes.get(k); if (!n) { n = { id: 'n' + nodes.size, x: R(x), z: R(z), legs: [], kind: 'priority' }; nodes.set(k, n); } return n; };
  const addEdge = (a, b, cls, name, extra = {}) => { const e = { id: 'e' + edges.length, a: a.id, b: b.id, cls, name: name || null, w: CLS[cls].w, ...extra }; edges.push(e); a.legs.push(e.id); b.legs.push(e.id); return e; };
  const xsAll = V.map((l) => l.x), zsAll = H.map((l) => l.z);
  const inSpan = (v, span) => !span || (v >= span[0] - 1e-6 && v <= span[1] + 1e-6);
  const bridgeXs = [];
  for (const l of V) {
    const zs = [...new Set([...zsAll, ...(l.z || [])])].sort((a, b) => a - b).filter((z) => (l.z ? inSpan(z, l.z) : true));
    for (let i = 0; i + 1 < zs.length; i++) {
      const z0 = zs[i], z1 = zs[i + 1], cz = (z0 + z1) / 2;
      let draw = !!l.z;
      if (!l.z) { const left = zoneOf(l.x - 20, l.x, z0, z1), right = zoneOf(l.x, l.x + 20, z0, z1); draw = (urban(left) || urban(right)) && cz > RAIL_Z + 1 && cz < SEA_Z - 40; }
      if (draw) addEdge(node(l.x, z0), node(l.x, z1), l.cls, l.name, { dir: 'z', bus: l.bus || null });
    }
  }
  for (const l of H) {
    const xs = [...new Set([...xsAll, -285, -205 - RIVER_W / 2, -205 + RIVER_W / 2, 245, ...(l.x || [])])].sort((a, b) => a - b).filter((x) => (l.x ? inSpan(x, l.x) : true));
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], cx = (x0 + x1) / 2;
      let draw = !!l.x;
      if (!l.x) { const up = zoneOf(x0, x1, l.z - 20, l.z), dn = zoneOf(x0, x1, l.z, l.z + 20); draw = (urban(up) || urban(dn)) && !inRiver(x0, x1); }
      if (!draw) continue;
      const over = inRiver(x0, x1) ? 'river' : null;
      addEdge(node(x0, l.z), node(x1, l.z), l.cls, l.name, { dir: 'x', bus: l.bus || null, ...(over ? { bridge: over } : {}) });
    }
  }
  // motorways (not part of the grid: their own nodes)
  const M1 = []; for (const x of [-300, -160, 0, M2_X, 300]) M1.push(node(x, M1_Z));
  for (let i = 0; i + 1 < M1.length; i++) addEdge(M1[i], M1[i + 1], 'motorway', 'М1 Северная хорда', { dir: 'x' });
  const M2z = [-290, M1_Z, -125, 0, 100, 160, 190];
  for (let i = 0; i + 1 < M2z.length; i++) addEdge(node(M2_X, M2z[i]), node(M2_X, M2z[i + 1]), 'motorway', 'М2 Восточная хорда', { dir: 'z' });
  // the main avenue joins M1 at the diamond; the east end of the central artery joins M2 at the second diamond; the southern avenue ends at the port trumpet
  // ------------------------------------------------------------------ the rail line and its crossings
  const rail = { id: 'RAIL1', name: 'Главный ход', pts: [[-300, RAIL_Z], [300, RAIL_Z]], gauge: 1.2, stations: [{ id: 'ST1', name: 'Центральный вокзал', at: [0, RAIL_Z], len: 70, platforms: 4 }], spur: { pts: [[110, RAIL_Z], [110, -205], [150, -205]], name: 'Подъездной путь промзоны' } };
  const grade = [];  // grade separations: road passes UNDER the rail embankment (underpass) or OVER the river (bridge)
  for (const e of edges) {
    const a = [...nodes.values()].find((n) => n.id === e.a), b = [...nodes.values()].find((n) => n.id === e.b);
    if (e.dir === 'z' && Math.min(a.z, b.z) < RAIL_Z && Math.max(a.z, b.z) > RAIL_Z) {   // a line crossing the rail: split into two edges at the rail
      e.railCrossing = true;
    }
  }
  // roads crossing the rail get an underpass node at z = RAIL_Z (arterials and collectors only; locals dead-end at the embankment)
  const xLines = V.filter((l) => l.z && l.z[0] < RAIL_Z - 1 && l.z[1] > RAIL_Z + 1 || (l.x === 0));
  for (const l of V) {
    if (l.cls === 'local') continue;
    const z0 = l.z ? l.z[0] : -160, z1 = l.z ? l.z[1] : 190;
    if (z0 < RAIL_Z && z1 > RAIL_Z) grade.push({ id: 'U' + grade.length, kind: 'underpass', at: [l.x, RAIL_Z], road: l.name, len: 24, note: 'дорога под насыпью железной дороги' });
  }
  grade.push({ id: 'BR-RAIL', kind: 'rail-bridge', at: [RIVER_X, RAIL_Z], note: 'железнодорожный мост через реку', len: RIVER_W + 8 });
  for (const e of edges) if (e.bridge) { const a = [...nodes.values()].find((n) => n.id === e.a); grade.push({ id: 'BR' + grade.length, kind: 'road-bridge', at: [R(a.x + (RIVER_W / 2)), a.z], road: e.name, cls: e.cls, len: RIVER_W + 8 }); }

  // ------------------------------------------------------------------ interchanges (ramps as polylines / curves, game metres)
  const interchanges = [];
  const map = (at, main, u, v) => main === 'x' ? [R(at[0] + u), R(at[1] + v)] : [R(at[0] + v), R(at[1] + u)];
  function diamond(id, at, main, name, cross) {
    const mw = CLS.motorway.w / 2, cw = CLS.arterial.w / 2, dT = 22, ramps = [];
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const p0 = map(at, main, su * 90, sv * (mw + 0.6)), p1 = map(at, main, su * 34, sv * (mw + 7)), p2 = map(at, main, su * (cw + 3.6), sv * dT);
      ramps.push({ kind: su * sv > 0 ? 'on' : 'off', pts: [p0, p1, p2] });
    }
    interchanges.push({ id, kind: 'diamond', name, at, main, cross, ramps, terminals: [[-1], [1]].map(([s]) => map(at, main, 0, s * dT)), terminalSpacing: 2 * dT });
  }
  function cloverleaf(id, at, name) {
    const mw = CLS.motorway.w / 2, Rl = 24, ramps = [], loops = [];
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      loops.push({ c: [R(at[0] + su * (mw + Rl + 1.5)), R(at[1] + sv * (mw + Rl + 1.5))], r: Rl, quadrant: [su, sv] });
      ramps.push({ kind: 'outer', pts: [[R(at[0] + su * 105), R(at[1] + sv * (mw + 0.6))], [R(at[0] + su * (mw + 2 * Rl + 14)), R(at[1] + sv * (mw + 2 * Rl + 14))], [R(at[0] + su * (mw + 0.6)), R(at[1] + sv * 105)]], curve: 'quad' });
    }
    interchanges.push({ id, kind: 'cloverleaf', name, at, main: 'x', cross: 'M2', ramps, loops });
  }
  function trumpet(id, at, name) {
    // M2 (N-S) ends in the port; the Southern avenue (z = 160) leaves to the west: one loop ramp + two direct ramps (three-leg interchange)
    const mw = CLS.motorway.w / 2, ramps = [], loops = [];
    loops.push({ c: [R(at[0] - mw - 24), R(at[1] - 26)], r: 24, quadrant: [-1, -1] });
    ramps.push({ kind: 'direct', pts: [[at[0] - mw, at[1] - 90], [at[0] - mw - 1, at[1] - 40], [at[0] - mw - 14, at[1] - 4]], curve: 'quad' });
    ramps.push({ kind: 'direct', pts: [[at[0] - mw - 3, at[1] + 6], [at[0] - 6, at[1] + 30], [at[0] - mw + 1, at[1] + 90]], curve: 'quad' });
    interchanges.push({ id, kind: 'trumpet', name, at, main: 'z', cross: 'Южный проспект', ramps, loops });
  }
  diamond('I1', [0, M1_Z], 'x', 'Развязка «ромб» Главный проспект × М1', 'Главный проспект');
  diamond('I2', [M2_X, 0], 'z', 'Развязка «ромб» Центральная магистраль × М2', 'Центральная магистраль');
  cloverleaf('I3', [M2_X, M1_Z], 'Клеверный лист М1 × М2 (две автомагистрали)');
  trumpet('I4', [M2_X, 160], 'Трубка М2 × порт (три ветви)');

  // ------------------------------------------------------------------ junction types
  const nl = (n) => n.legs.map((id) => edges.find((e) => e.id === id));
  const junctions = [];
  for (const n of nodes.values()) {
    const L = nl(n); if (L.length < 3) continue;
    const cl = L.map((e) => e.cls), has = (c) => cl.includes(c);
    let type = 'priority';
    if (n.x === 0 && n.z === 0) type = 'roundabout-2lane';
    else if (new Set(L.filter((e) => e.cls === 'arterial').map((e) => e.dir)).size === 2) type = 'signal';   // two arterials cross (grid points, 160 game m = 400 m real apart: the quarter-mile minimum)
    else if (has('arterial') && has('collector')) type = Math.abs(n.x) <= 160 && Math.abs(n.z) <= 160 ? 'signal' : 'riro';   // downtown signals every 80 game m (200 m real, a downtown block), outside the inner city right-in / right-out
    else if (has('arterial')) type = 'riro-local';
    else if (cl.filter((c) => c === 'collector').length >= 2) type = 'roundabout-mini';
    else if (has('collector')) type = 'priority-zebra';
    n.kind = type; junctions.push({ id: n.id, at: [n.x, n.z], type, legs: L.length, classes: cl });
  }
  for (const ic of interchanges) if (ic.kind === 'diamond') for (const t of ic.terminals) junctions.push({ id: ic.id + '-t' + t.join('_'), at: t, type: 'signal-ramp-terminal', legs: 4, classes: ['arterial', 'ramp', 'ramp'] });

  // ------------------------------------------------------------------ pedestrian crossings and grade-separated crossings
  const crossings = [];
  for (const j of junctions) {
    if (j.type === 'signal') for (let k = 0; k < 4; k++) crossings.push({ id: `${j.id}-p${k}`, kind: 'ped-signal', at: j.at, leg: k });
    else if (j.type === 'roundabout-2lane') for (let k = 0; k < 4; k++) crossings.push({ id: `${j.id}-z${k}`, kind: 'zebra-refuge', at: j.at, leg: k, setback: 9 });
    else if (j.type === 'roundabout-mini' || j.type === 'priority-zebra') crossings.push({ id: `${j.id}-z`, kind: 'zebra', at: j.at });
    else if (j.type === 'riro') crossings.push({ id: `${j.id}-hawk`, kind: 'ped-signal-midblock', at: j.at, note: 'пешеходный светофор у съезда «право-право»' });
  }
  const footbridges = [
    { id: 'FB1', at: [250, -80], over: 'М2 Восточная хорда', len: 30, note: 'к парку-и-езжай (P+R) и остановке Б1', ramps: 'пандусы + лифт' },
    { id: 'FB2', at: [-205, 40], over: 'река', len: 34, note: 'набережная: пешеходно-велосипедный мост' },
    { id: 'FB3', at: [120, 0], over: 'Центральная магистраль', len: 20, note: 'у университета и рынка', ramps: 'пандусы' },
    { id: 'FB4', at: [-120, 0], over: 'Центральная магистраль', len: 20, note: 'у больницы и школы', ramps: 'пандусы' },
    { id: 'FB5', at: [-160, 120], over: 'Западный проспект', len: 20, note: 'к стадиону', ramps: 'пандусы + лифт' },
  ];
  const tunnels = [
    { id: 'PT1', at: [-14, RAIL_Z], under: 'ж/д пути вокзала', len: 34, note: 'вокзал: подземный переход между платформами и привокзальной площадью' },
    { id: 'PT2', at: [14, RAIL_Z], under: 'ж/д пути вокзала', len: 34, note: 'второй выход' },
    { id: 'PT3', at: [0, 0], under: 'Центральное кольцо', len: 26, note: 'подземный переход под центральной площадью (4 выхода)' },
  ];
  const sig = junctions.filter((j) => j.type === 'signal');
  // mid-block signals on long arterial segments (no crossing within 90 game metres)
  const arterialSegments = edges.filter((e) => e.cls === 'arterial');

  // ------------------------------------------------------------------ transit (buses; stops near the junctions, about every 80-100 game metres)
  const lines = [
    { id: 'B1', name: 'Автобус 1: P+R восток — Центр — набережная', color: '#e4572e', road: 'Центральная магистраль', pts: [[245, 0], [-285, 0]], stops: [] },
    { id: 'B2', name: 'Автобус 2: Вокзал — Центр — Порт', color: '#2e86e4', road: 'Главный проспект', pts: [[0, -118], [0, 195]], stops: [] },
    { id: 'B3', name: 'Автобус 3: кольцо по проспектам', color: '#3aa655', road: 'проспекты', pts: [[-160, -160], [160, -160], [160, 160], [-160, 160], [-160, -160]], stops: [] },
  ];
  const stopsAlong = (pts, step) => { const out = []; for (let i = 0; i + 1 < pts.length; i++) { const [a, b] = [pts[i], pts[i + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = step / 2; s < L; s += step) out.push([R(a[0] + (b[0] - a[0]) * s / L), R(a[1] + (b[1] - a[1]) * s / L)]); } return out; };
  for (const l of lines) l.stops = stopsAlong(l.pts, l.id === 'B3' ? 160 : 80);
  const transit = { lines, note: 'остановки в 80 м игровых (200 м настоящих); выделенная полоса на проспектах, остановочные карманы; метро / трамвай - позже (C5)' };

  // ------------------------------------------------------------------ zones and blocks (cells between the street lines)
  const X = [...new Set([...xsAll, -285, 245])].sort((a, b) => a - b), Z = [-250, ...zsAll, SEA_Z].sort((a, b) => a - b).filter((z, i, a) => a.indexOf(z) === i);
  const blocks = [];
  const xr = [-285, ...X.filter((x) => x > -285 && x < -205 - RIVER_W / 2), -205 - RIVER_W / 2, -205 + RIVER_W / 2, ...X.filter((x) => x > -205 + RIVER_W / 2), 245].sort((a, b) => a - b);
  const zr = [M1_Z, -160, RAIL_Z, ...zsAll.filter((z) => z > RAIL_Z), SEA_Z].filter((z, i, a) => a.indexOf(z) === i).sort((a, b) => a - b);
  for (let i = 0; i + 1 < xr.length; i++) for (let j = 0; j + 1 < zr.length; j++) {
    const x0 = xr[i], x1 = xr[i + 1], z0 = zr[j], z1 = zr[j + 1];
    if (x1 - x0 < 6 || z1 - z0 < 6) continue;
    const zone = zoneOf(x0, x1, z0, z1);
    if (zone === 'water' || zone === 'verge') continue;
    blocks.push({ id: `b${blocks.length}`, rect: [x0, z0, x1, z1], zone });
  }
  // a hand-placed landmarks list (positions are plan-level, the game decides the exact building later)
  const landmarks = [
    { id: 'L1', kind: 'plaza', name: 'Центральная площадь', at: [0, 0] }, { id: 'L2', kind: 'market', name: 'Рынок', at: [60, -20] },
    { id: 'L3', kind: 'hospital', name: 'Больница', at: [-100, -20] }, { id: 'L4', kind: 'school', name: 'Школа', at: [-60, 20] },
    { id: 'L5', kind: 'university', name: 'Университет', at: [120, 120] }, { id: 'L6', kind: 'stadium', name: 'Стадион', at: [-120, 120] },
    { id: 'L7', kind: 'station', name: 'Центральный вокзал', at: [0, -140] }, { id: 'L8', kind: 'port', name: 'Порт', at: [130, 182] },
    { id: 'L9', kind: 'park', name: 'Набережный парк', at: [-180, 20] }, { id: 'L10', kind: 'industry', name: 'Промзона', at: [150, -205] },
    { id: 'L11', kind: 'pnr', name: 'Парк-и-езжай (P+R)', at: [230, -60] }, { id: 'L12', kind: 'marina', name: 'Яхтенная гавань', at: [-60, 182] },
  ];

  return {
    version: 'C0', generated: 'tools/masterplan/plan-c.mjs', scale: 0.4, unit: 'game metre (x east, z south); real = x2.5',
    size, water: { sea: { z: SEA_Z, coast: 'port basins at x 60..220' }, river: { x: RIVER_X, w: RIVER_W, from: [RIVER_X, size.z0], to: [RIVER_X, SEA_Z] } },
    classes: CLS, nodes: [...nodes.values()].map(({ legs, ...n }) => ({ ...n, legs: legs.length })), edges, junctions, interchanges, crossings, footbridges, tunnels, rail, grade, transit, blocks, landmarks,
    counts: { nodes: nodes.size, edges: edges.length, junctions: junctions.length, signals: sig.length, interchanges: interchanges.length, crossings: crossings.length, footbridges: footbridges.length, tunnels: tunnels.length },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const p = buildPlan();
  fs.writeFileSync(path.join(ROOT, 'tools/masterplan/plan-C.json'), JSON.stringify(p));
  console.log(JSON.stringify(p.counts));
}
