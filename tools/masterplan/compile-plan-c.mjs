// Masterplan C, step C1: plan-C.json -> assets/plan-c-data-v161.js   (node tools/masterplan/compile-plan-c.mjs [--check] [--stats])
// Everything the game draws and walks on in layout C is DATA made here; the layer (assets/plan-c-v161.js) only turns it into meshes.
// Output: window.PlanCDataV161 = { cell: 60, colors: [hex], cells: {"cx,cz": {g,r,p,f}}, graph, floor/access functions, ... }
//   cell layers (flat arrays, strides in brackets): g = ground, r = road bodies (asphalt, kerbs, sidewalks, medians), p = paint
//     q  [6]  x0 z0 x1 z1 y ci                       axis-aligned horizontal rectangle
//     t  [8]  x0 z0 x1 z1 x2 z2 y ci                 triangle (curved pieces: ring roads, ramps, water, fields)
//     w  [7]  x0 z0 x1 z1 y0 y1 ci                   vertical wall between two points (kerbs)
//   f  furniture lists: lamp [x z yaw], sig [x z yaw], pole [x z yaw] (sign pole), plate [x z yaw ci], stop [x z yaw], tree [x z scale tint]
// Road geometry is a UNION: the rectangles of all streets of a 60 m cell are decomposed on a coordinate grid, the highest type wins
// (median > asphalt > sidewalk), so there are no overlapping asphalt quads and no gaps; kerb walls come from the height steps between grid cells.
// Curved pieces (roundabout rings, ramps, bends) are layered triangles at distinct heights.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/masterplan/plan-C.json'), 'utf8'));
const OUT = path.join(ROOT, 'assets/plan-c-data-v161.js');
const require = createRequire(import.meta.url);
const THREE = require(path.join(ROOT, 'vendor/three_r128/three.min.js'));

export const CELL = 60;
const R2 = (n) => Math.round(n * 100) / 100, R3 = (n) => Math.round(n * 1000) / 1000;
const CLS = PLAN.classes;
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---- palette (sRGB hex; the layer converts to linear) and heights (game metres above the old ground plane)
const COLORS = {
  grass: 0x5f8f48, grassB: 0x6a9a50, lawn: 0x76a85c, park: 0x5d9a4a, forest: 0x3f6d37, field0: 0x9a9a52, field1: 0x6f9b45, field2: 0xb0a45a, field3: 0x7e9a4a, field4: 0x8f7a4c,
  urban: 0x86ad68, industry: 0x8d8f86, verge: 0x6c9650, parking: 0x6a6e72, embank: 0x8b9566, beach: 0xdac99b, promenade: 0xcfc6b2, port: 0x9fa09a,
  sea: 0x3f7fae, seaLight: 0x7fb7d2, river: 0x4a88b4, bank: 0xb9ae8c, dirt: 0x8d7a58,
  asph: 0x353a3f, ramp: 0x3a4045, walk: 0xc4bfae, kerb: 0xaaa595, median: 0xb8b4a4, medLawn: 0x6f9d57, medM: 0xa9a99f, plaza: 0xd4cab4, islandL: 0x6ea154, islandC: 0xd9d1bb,
  white: 0xf2f2ec, yellow: 0xe7c85a, ballast: 0x8a8782, rail: 0x56585b, platform: 0xb8b5aa, moleC: 0x9b9a92, rock: 0x77756f,
  resid: 0x82b064, mixed: 0x95b57a, cbd: 0xaaa898, indus: 0x959890, school: 0x90bd72, hospital: 0xa4b88e, station: 0xa9a79b, villas: 0x78b45f, waterf: 0xa6b88f, market: 0xb4ae98, stadium: 0x6fae55,
};
const PAL = Object.keys(COLORS), CI = Object.fromEntries(PAL.map((k, i) => [k, i]));
const H = { ground: 0, asph: 0.05, walk: 0.12, med: 0.12, paint: 0.062, ramp: 0.053, ringWalk: 0.12, island: 0.09, plaza: 0.03, zone: -0.045, zone2: -0.03, water: -0.02, bank: -0.03, base: -0.06, rail: 0.035, railPaint: 0.066 };

// ---- the cell store
const cells = new Map();
const ck = (cx, cz) => cx + ',' + cz;
function cellOf(cx, cz) {
  const k = ck(cx, cz); let c = cells.get(k);
  if (!c) { c = { g: { q: [], t: [] }, r: { q: [], t: [], w: [] }, p: { q: [], t: [] }, f: { lamp: [], sig: [], pole: [], plate: [], stop: [], tree: [] } }; cells.set(k, c); }
  return c;
}
const cellRange = (a, b) => { const out = []; for (let i = Math.floor(a / CELL + 1e-9); i <= Math.floor((b - 1e-9) / CELL); i++) out.push(i); return out; };
function clipPoly(poly, x0, z0, x1, z1) {   // Sutherland-Hodgman against an axis-aligned rectangle (convex window, any subject)
  const edges = [[0, x0, 1], [0, x1, -1], [1, z0, 1], [1, z1, -1]];
  let out = poly;
  for (const [ax, v, s] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length], da = (a[ax] - v) * s, db = (b[ax] - v) * s;
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; p[ax] = v; out.push(p); }
    }
    if (!out.length) return [];
  }
  return out;
}
const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const push = (arr, ...v) => { for (const n of v) arr.push(R2(n)); };

function emitRect(layer, sub, x0, z0, x1, z1, y, ci) {
  if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4) return;
  for (const cx of cellRange(x0, x1)) for (const cz of cellRange(z0, z1)) {
    const a = Math.max(x0, cx * CELL), b = Math.min(x1, (cx + 1) * CELL), c = Math.max(z0, cz * CELL), d = Math.min(z1, (cz + 1) * CELL);
    if (b - a > 1e-4 && d - c > 1e-4) push(cellOf(cx, cz)[layer][sub], a, c, b, d, y, ci);
  }
}
function emitTri(layer, a, b, c, y, ci) {   // clips to every touched cell, fan-triangulates the convex result
  const x0 = Math.min(a[0], b[0], c[0]), x1 = Math.max(a[0], b[0], c[0]), z0 = Math.min(a[1], b[1], c[1]), z1 = Math.max(a[1], b[1], c[1]);
  for (const cx of cellRange(x0, x1 + 1e-6)) for (const cz of cellRange(z0, z1 + 1e-6)) {
    const poly = clipPoly([a, b, c], cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL);
    if (poly.length < 3 || Math.abs(area2(poly)) < 1e-5) continue;
    const t = cellOf(cx, cz)[layer].t;
    for (let i = 1; i + 1 < poly.length; i++) push(t, poly[0][0], poly[0][1], poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1], y, ci);
  }
}
function emitPoly(layer, poly, y, ci, holes = []) {   // arbitrary simple polygon (+ holes) -> triangles
  const v = poly.map((p) => new THREE.Vector2(p[0], p[1])), hv = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  const all = poly.concat(...holes);
  for (const t of THREE.ShapeUtils.triangulateShape(v, hv)) emitTri(layer, all[t[0]], all[t[1]], all[t[2]], y, ci);
}
function emitWall(x0, z0, x1, z1, y0, y1, ci) {   // wall between two points; lives in the cells its midpoint crosses (kerbs never span cells: they come from the cell raster)
  push(cellOf(Math.floor((x0 + x1) / 2 / CELL), Math.floor((z0 + z1) / 2 / CELL)).r.w, x0, z0, x1, z1, y0, y1, ci);
}
function ribbon(layer, pts, w, y, ci, join = true) {   // constant-width strip along a polyline (mitred), as triangles
  const n = pts.length, L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    L.push([pts[i][0] + dz * w / 2, pts[i][1] - dx * w / 2]); Rr.push([pts[i][0] - dz * w / 2, pts[i][1] + dx * w / 2]);
  }
  for (let i = 0; i + 1 < n; i++) { emitTri(layer, L[i], Rr[i], L[i + 1], y, ci); emitTri(layer, Rr[i], Rr[i + 1], L[i + 1], y, ci); }
}
function disc(layer, c, r, y, ci, seg = 28) { for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2; emitTri(layer, c, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], y, ci); } }
function annulus(layer, c, r0, r1, a0, a1, y, ci, step = 6) {   // angles in degrees, screen frame
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
  for (let i = 0; i < n; i++) {
    const s = (a0 + (a1 - a0) * i / n) * Math.PI / 180, e = (a0 + (a1 - a0) * (i + 1) / n) * Math.PI / 180;
    const p = (r, a) => [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    emitTri(layer, p(r0, s), p(r1, s), p(r1, e), y, ci); emitTri(layer, p(r0, s), p(r1, e), p(r0, e), y, ci);
  }
}

// ---- graph helpers
const N = new Map(PLAN.nodes.map((n) => [n.id, n])), J = new Map(PLAN.junctions.map((j) => [j.id, j]));
const hw = (cls) => CLS[cls].w / 2;
const rightOf = (h) => [-h[1], h[0]];
const MW = CLS.motorway.w / 2;
const ringW = (j) => j.lanes === 2 ? 6.2 : 3.6;
const RAIL_Z = PLAN.rail.pts[0][1], M1_Z = -240, M2_X = 250;
function trimAt(nodeId, e) {   // how far markings / medians stay away from a node
  const n = N.get(nodeId), j = J.get(nodeId);
  if (!j) return n.legs && n.legs.length > 1 ? 1.5 : 0;
  if (j.type === 'roundabout') return j.R + 6.5;
  if (j.type === 'mini') return 5.5;
  const cross = j.arms.filter((a) => (a.dir[0] !== 0) !== (e.dir === 'x')).map((a) => hw(a.cls));
  const ch = cross.length ? Math.max(...cross) : 0;
  if (j.type === 'signal') return ch + 5.2;
  if (j.type === 'riro' && e.cls === 'arterial') return 0;
  return ch + 0.8;
}
// intervals along an edge's axis where a higher road / the railway owns the surface (flat model of step C1; heights come in C6)
function cutsOf(e) {
  const a = N.get(e.a), b = N.get(e.b), cuts = [];
  if (e.underRail != null) { const c = e.dir === 'z' ? e.underRail : null; if (c != null) cuts.push([c - 4.6, c + 4.6]); }
  if (e.underMotorway === 'M1') cuts.push([M1_Z - MW - 0.8, M1_Z + MW + 0.8]);
  if (e.underMotorway === 'M2') cuts.push([M2_X - MW - 0.8, M2_X + MW + 0.8]);
  if (e.underRamps === 'I4') cuts.push([M2_X - MW - 6, M2_X + MW + 6]);
  return cuts;
}
function subtractIntervals(lo, hi, cuts) {
  let parts = [[lo, hi]];
  for (const [c0, c1] of cuts) { const next = []; for (const [a, b] of parts) { if (c1 <= a || c0 >= b) next.push([a, b]); else { if (c0 > a) next.push([a, c0]); if (c1 < b) next.push([c1, b]); } } parts = next; }
  return parts.filter(([a, b]) => b - a > 0.05);
}

// ---- 1. raster shapes of the straight streets
const shapes = [];   // {x0,z0,x1,z1,type}
const PRIO = { walk: 1, asph: 2, med: 3 };
const addShape = (x0, z0, x1, z1, type) => { if (x1 - x0 > 1e-4 && z1 - z0 > 1e-4) shapes.push({ x0: R3(x0), z0: R3(z0), x1: R3(x1), z1: R3(z1), type }); };
const roundAt = (nodeId) => { const j = J.get(nodeId); return j && j.type === 'roundabout' ? j : null; };
const edgeSpan = (e) => {   // along-axis span of the carriageway/sidewalk, trimmed to the chord of a roundabout
  const a = N.get(e.a), b = N.get(e.b), ax = e.dir === 'x' ? 0 : 1, lo = Math.min(a.x * (1 - ax) + a.z * ax, b.x * (1 - ax) + b.z * ax), hi = Math.max(a.x * (1 - ax) + a.z * ax, b.x * (1 - ax) + b.z * ax);
  const lowNode = (a.x * (1 - ax) + a.z * ax) <= (b.x * (1 - ax) + b.z * ax) ? e.a : e.b, highNode = lowNode === e.a ? e.b : e.a;
  const ch = (id) => { const j = roundAt(id); return j ? Math.sqrt(Math.max(0, j.R * j.R - hw(e.cls) ** 2)) - 0.12 : 0; };
  const mo = e.cls === 'motorway';
  const mt = (id) => mo && (N.get(id).legs.length === 1) ? 0 : 0;
  return { lo: lo + ch(lowNode) + mt(lowNode), hi: hi - ch(highNode) - mt(highNode), lowNode, highNode, ax };
};
for (const e of PLAN.edges) {
  const a = N.get(e.a), s = edgeSpan(e), cl = CLS[e.cls], half = cl.w / 2, sw = cl.sidewalk, c = e.dir === 'x' ? a.z : a.x;
  const put = (lo, hi, l0, l1, type) => e.dir === 'x' ? addShape(lo, c + l0, hi, c + l1, type) : addShape(c + l0, lo, c + l1, hi, type);
  put(s.lo, s.hi, -half, half, 'asph');
  const cuts = cutsOf(e);
  if (sw > 0) for (const [lo, hi] of subtractIntervals(s.lo, s.hi, cuts)) { put(lo, hi, half, half + sw, 'walk'); put(lo, hi, -half - sw, -half, 'walk'); }
  if (cl.median > 0) {
    const t0 = trimAt(s.lowNode, e), t1 = trimAt(s.highNode, e), mh = cl.median / 2;
    const lo0 = Math.min(e.dir === 'x' ? a.x : a.z, e.dir === 'x' ? N.get(e.b).x : N.get(e.b).z), hi0 = Math.max(e.dir === 'x' ? a.x : a.z, e.dir === 'x' ? N.get(e.b).x : N.get(e.b).z);
    const mlo = e.cls === 'motorway' ? lo0 + (N.get(s.lowNode).legs.length > 1 ? 1 : 0) : lo0 + t0, mhi = e.cls === 'motorway' ? hi0 - (N.get(s.highNode).legs.length > 1 ? 1 : 0) : hi0 - t1;
    if (mhi - mlo > 1) for (const [lo, hi] of subtractIntervals(mlo, mhi, cuts)) put(lo, hi, -mh, mh, e.cls === 'motorway' ? 'medM' : 'med');
  }
}

// ---- 2. raster decomposition per cell -> disjoint rectangles + kerb walls
const TYPES = { asph: { h: H.asph, ci: CI.asph, prio: 2 }, walk: { h: H.walk, ci: CI.walk, prio: 1 }, med: { h: H.med, ci: CI.median, prio: 3 }, medM: { h: H.med, ci: CI.medLawn, prio: 3 } };
const rasterOut = new Map();   // cell key -> list of {x0,z0,x1,z1,type} (the disjoint result, used by furniture/tree placement and the tests)
function rasterCell(cx, cz) {
  const X0 = cx * CELL, Z0 = cz * CELL, X1 = X0 + CELL, Z1 = Z0 + CELL;
  const list = shapes.filter((s) => s.x1 > X0 && s.x0 < X1 && s.z1 > Z0 && s.z0 < Z1).map((s) => ({ ...s, x0: Math.max(s.x0, X0), x1: Math.min(s.x1, X1), z0: Math.max(s.z0, Z0), z1: Math.min(s.z1, Z1) }));
  if (!list.length) return;
  const xs = [...new Set(list.flatMap((s) => [s.x0, s.x1]))].sort((a, b) => a - b), zs = [...new Set(list.flatMap((s) => [s.z0, s.z1]))].sort((a, b) => a - b);
  const nx = xs.length - 1, nz = zs.length - 1, grid = new Array(nx * nz).fill(null);
  for (const s of list) {
    const i0 = xs.indexOf(s.x0), i1 = xs.indexOf(s.x1), j0 = zs.indexOf(s.z0), j1 = zs.indexOf(s.z1);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const cur = grid[j * nx + i]; if (!cur || TYPES[s.type].prio > TYPES[cur].prio) grid[j * nx + i] = s.type; }
  }
  // merge: runs along x, then identical runs stacked along z
  const rows = [];
  for (let j = 0; j < nz; j++) {
    const runs = []; let i = 0;
    while (i < nx) { const t = grid[j * nx + i]; if (!t) { i++; continue; } let k = i; while (k < nx && grid[j * nx + k] === t) k++; runs.push({ type: t, i0: i, i1: k }); i = k; }
    rows.push(runs);
  }
  const out = [], open = new Map();
  for (let j = 0; j <= nz; j++) {
    const runs = j < nz ? rows[j] : [], seen = new Set();
    for (const r of runs) { const key = r.type + ':' + r.i0 + ':' + r.i1; seen.add(key); if (open.has(key)) open.get(key).j1 = j + 1; else open.set(key, { ...r, j0: j, j1: j + 1 }); }
    for (const [key, o] of [...open]) if (!seen.has(key)) { out.push(o); open.delete(key); }
  }
  const rects = out.map((o) => ({ type: o.type, x0: xs[o.i0], x1: xs[o.i1], z0: zs[o.j0], z1: zs[o.j1] }));
  rasterOut.set(ck(cx, cz), rects);
  for (const r of rects) emitRect('r', 'q', r.x0, r.z0, r.x1, r.z1, TYPES[r.type].h, TYPES[r.type].ci);
  // kerbs: height steps between neighbouring grid cells (and to the open ground); the taller side emits the wall once
  const walls = new Map();
  const typeAt = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz) ? null : grid[j * nx + i];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const t = grid[j * nx + i]; if (!t) continue;
    const h = TYPES[t].h;
    for (const [di, dj, ax] of [[1, 0, 'x'], [-1, 0, 'x'], [0, 1, 'z'], [0, -1, 'z']]) {
      const ni = i + di, nj = j + dj, tn = typeAt(ni, nj);
      const line = ax === 'x' ? (di > 0 ? xs[i + 1] : xs[i]) : (dj > 0 ? zs[j + 1] : zs[j]);
      if (!tn && (ni < 0 || nj < 0 || ni >= nx || nj >= nz)) { const border = ax === 'x' ? (di > 0 ? X1 : X0) : (dj > 0 ? Z1 : Z0); if (Math.abs(line - border) < 1e-6) continue; }   // the neighbouring cell owns its border
      const hn = tn ? TYPES[tn].h : 0;
      if (h - hn < 0.005) continue;
      const a0 = ax === 'x' ? zs[j] : xs[i], a1 = ax === 'x' ? zs[j + 1] : xs[i + 1], y0 = tn ? hn : -0.02;
      const key = ax + ':' + R3(line) + ':' + y0 + ':' + h; const arr = walls.get(key) || []; arr.push({ a0, a1, y0, y1: h }); walls.set(key, arr);
    }
  }
  for (const [key, arr] of walls) {
    arr.sort((p, q) => p.a0 - q.a0);
    const merged = [];
    for (const w of arr) { const l = merged[merged.length - 1]; if (l && Math.abs(l.a1 - w.a0) < 1e-6) l.a1 = w.a1; else merged.push({ ...w }); }
    const [ax, line] = key.split(':'), L = +line;
    for (const w of merged) { if (ax === 'x') push(cellOf(cx, cz).r.w, L, w.a0, L, w.a1, w.y0, w.y1, CI.kerb); else push(cellOf(cx, cz).r.w, w.a0, L, w.a1, L, w.y0, w.y1, CI.kerb); }
  }
}

// ---- 3. curved pieces: roundabouts, mini roundabouts, ramps, plaza
const ringsOut = [];
for (const j of PLAN.junctions) {
  const c = j.at;
  if (j.type === 'roundabout') {
    const R = j.R, W = ringW(j), Ri = R - W, big = j.lanes === 2;
    annulus('r', c, Ri, R, 0, 360, H.asph, CI.asph, 5);
    ringsOut.push({ id: j.id, at: c, R, Ri });
    // paved circus around the big ring, island with kerb
    if (big) annulus('r', c, R, 25, 0, 360, H.plaza, CI.plaza, 6);
    // walk arcs between the arms
    const angs = j.arms.map((a) => ({ a: (Math.atan2(a.dir[1], a.dir[0]) * 180 / Math.PI + 360) % 360, cls: a.cls })).sort((p, q) => p.a - q.a);
    const sw = Math.max(...j.arms.map((a) => CLS[a.cls].sidewalk)), wr = sw + 1.0;
    for (let i = 0; i < angs.length; i++) {
      const A = angs[i], B = angs[(i + 1) % angs.length], bb = B.a + (i + 1 === angs.length ? 360 : 0);
      const dA = Math.asin(Math.min(0.99, (hw(A.cls) + 0.1) / (R + wr / 2))) * 180 / Math.PI, dB = Math.asin(Math.min(0.99, (hw(B.cls) + 0.1) / (R + wr / 2))) * 180 / Math.PI;
      if (bb - dB - (A.a + dA) > 1) annulus('r', c, R, R + wr, A.a + dA, bb - dB, H.walk, CI.walk, 5);
    }
    // kerb ring of the island + lawn + centre
    for (let k = 0; k < 36; k++) { const s = k / 36 * Math.PI * 2, e = (k + 1) / 36 * Math.PI * 2; emitWall(c[0] + Math.cos(s) * Ri, c[1] + Math.sin(s) * Ri, c[0] + Math.cos(e) * Ri, c[1] + Math.sin(e) * Ri, H.asph, H.island + 0.03, CI.kerb); }
    annulus('r', c, 0.01, Ri, 0, 360, H.island + 0.03, CI.islandC, 8);
    annulus('r', c, 0.01, Ri - 0.8, 0, 360, H.island + 0.035, CI.islandL, 8);
    if (big) annulus('r', c, 0.01, 2.4, 0, 360, H.island + 0.04, CI.plaza, 10);
    if (big) { // second dashed lane line of the two-lane ring
      for (let a = 0; a < 360; a += 12) annulus('p', c, R - W / 2 - 0.07, R - W / 2 + 0.07, a, a + 6.5, H.paint, CI.white, 3);
    }
    // arms: splitter island, yield teeth
    for (const a of j.arms) {
      const d = a.dir, r = rightOf(d), w = hw(a.cls), base = R + 0.5, tip = R + 7.5, iw = Math.min(1.0, w * 0.4);
      const P = (t, l) => [c[0] + d[0] * t + r[0] * l, c[1] + d[1] * t + r[1] * l];
      emitTri('r', P(base, iw), P(tip, 0), P(base, -iw), H.island, CI.islandC);
      // teeth on the incoming half (right of the incoming heading = rightOf(-d) = -r)
      const sgn = -1;
      for (let l = iw + 0.2; l < w - 0.1; l += 0.7) { const q0 = P(R + 0.35, sgn * l), q1 = P(R + 0.7, sgn * (l + 0.35)), q2 = P(R + 0.7, sgn * l); emitTri('p', q0, q1, q2, H.paint, CI.white); }
    }
  } else if (j.type === 'mini') {
    disc('r', c, 1.5, H.island + 0.03, CI.islandC, 20); disc('r', c, 1.25, H.island + 0.035, CI.islandL, 20);
    for (let k = 0; k < 20; k++) { const s = k / 20 * Math.PI * 2, e = (k + 1) / 20 * Math.PI * 2; emitWall(c[0] + Math.cos(s) * 1.5, c[1] + Math.sin(s) * 1.5, c[0] + Math.cos(e) * 1.5, c[1] + Math.sin(e) * 1.5, H.asph, H.island + 0.03, CI.kerb); }
    for (let a = 0; a < 360; a += 20) annulus('p', c, 2.75, 2.9, a, a + 11, H.paint, CI.white, 4);
  }
}
// ramps (interchanges): 2 m ribbons with white edge dashes
const rampsOut = [];
for (const ic of PLAN.interchanges) for (const r of ic.ramps) {
  ribbon('r', r.pts, CLS.ramp.w, H.ramp, CI.ramp);
  rampsOut.push({ ic: ic.id, kind: r.kind, pts: r.pts });
  // dashed centre line every 4 m
  let acc = 0;
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nrm = [-d[1], d[0]];
    if ((acc % 4) < 1.5 && L > 0.5) { const e0 = [a[0] + nrm[0] * 0.04, a[1] + nrm[1] * 0.04], e1 = [b[0] + nrm[0] * 0.04, b[1] + nrm[1] * 0.04]; ribbon('p', [e0, e1], 0.08, H.paint + 0.001, CI.white); }
    acc += L;
  }
}

// ---- 4. markings of the straight streets
function dashed(axis, c, lo, hi, width, dash, gap, y, ci, phase = 0) {   // axis 'x': line along x at z = c
  for (let s = lo + phase; s < hi; s += dash + gap) { const e = Math.min(s + dash, hi); if (e - s < 0.2) continue; if (axis === 'x') emitRect('p', 'q', s, c - width / 2, e, c + width / 2, y, ci); else emitRect('p', 'q', c - width / 2, s, c + width / 2, e, y, ci); }
}
function solid(axis, c, lo, hi, width, y, ci) { if (hi - lo < 0.1) return; if (axis === 'x') emitRect('p', 'q', lo, c - width / 2, hi, c + width / 2, y, ci); else emitRect('p', 'q', c - width / 2, lo, c + width / 2, hi, y, ci); }
for (const e of PLAN.edges) {
  const a = N.get(e.a), b = N.get(e.b), ax = e.dir, cl = CLS[e.cls], cuts = cutsOf(e);
  const lo0 = ax === 'x' ? Math.min(a.x, b.x) : Math.min(a.z, b.z), hi0 = ax === 'x' ? Math.max(a.x, b.x) : Math.max(a.z, b.z);
  const lowNode = (ax === 'x' ? a.x <= b.x : a.z <= b.z) ? e.a : e.b, highNode = lowNode === e.a ? e.b : e.a;
  const c = ax === 'x' ? a.z : a.x;
  const mo = e.cls === 'motorway';
  const t0 = mo ? 1 : trimAt(lowNode, e), t1 = mo ? 1 : trimAt(highNode, e);
  const lo = lo0 + t0, hi = hi0 - t1;
  if (hi - lo < 1) continue;
  const parts = subtractIntervals(lo, hi, cuts);
  for (const [pl, ph] of parts) {
    if (mo) {
      for (const o of [-(MW - 0.35), MW - 0.35, -1.4, 1.4]) solid(ax, c + o, pl, ph, 0.13, H.paint, CI.white);
      for (const o of [-3.175, 3.175]) dashed(ax, c + o, pl, ph, 0.14, 1.6, 1.8, H.paint, CI.white);
    } else if (e.cls === 'arterial') {
      for (const o of [-1.85, 1.85]) dashed(ax, c + o, pl, ph, 0.12, 1.0, 1.4, H.paint, CI.white);
    } else if (e.cls === 'collector') dashed(ax, c, pl, ph, 0.12, 1.0, 1.2, H.paint, CI.white);
  }
}

// ---- 5. junction furniture: zebra crossings, stop lines, signal / sign points
const poleSet = [];   // pole / head positions for the cell furniture lists, filled below
function zebra(c, dir, at, cls, len = 1.1) {
  const w = hw(cls), med = CLS[cls].median / 2, p = [c[0] + dir[0] * at, c[1] + dir[1] * at];
  for (let l = -(w - 0.3); l <= w - 0.29; l += 0.8) {
    if (Math.abs(l) < med + 0.1) continue;
    if (dir[0] === 0) emitRect('p', 'q', p[0] + l - 0.2, p[1] - len / 2, p[0] + l + 0.2, p[1] + len / 2, H.paint, CI.white);
    else emitRect('p', 'q', p[0] - len / 2, p[1] + l - 0.2, p[0] + len / 2, p[1] + l + 0.2, H.paint, CI.white);
  }
}
function stopLine(c, dir, at, cls) {   // across the incoming half of an arm
  const w = hw(cls), med = CLS[cls].median / 2, r = [dir[1], -dir[0]], l0 = med, l1 = w, p = [c[0] + dir[0] * at, c[1] + dir[1] * at];
  const q = (l) => [p[0] + r[0] * l, p[1] + r[1] * l];
  const A = q(l0), B = q(l1);
  if (dir[0] === 0) emitRect('p', 'q', Math.min(A[0], B[0]), p[1] - 0.16, Math.max(A[0], B[0]), p[1] + 0.16, H.paint, CI.white);
  else emitRect('p', 'q', p[0] - 0.16, Math.min(A[1], B[1]), p[0] + 0.16, Math.max(A[1], B[1]), H.paint, CI.white);
}
const furniture = { lamp: [], sig: [], pole: [], plate: [], stop: [] };   // world lists, then split into cells
const yawOf = (d) => Math.atan2(d[0], d[1]);
const crossingKey = new Set();
for (const cr of PLAN.crossings) {
  if (cr.arm) {
    const j = J.get(cr.id.split('-')[0]); if (!j) continue;
    const dir = cr.arm, cross = j.arms.filter((a) => (a.dir[0] !== 0) !== (dir[0] !== 0)).map((a) => hw(a.cls));
    const along = cr.setback != null ? cr.setback : (cross.length ? Math.max(...cross) : 0) + 2.2;
    const arm = j.arms.find((a) => a.dir[0] === dir[0] && a.dir[1] === dir[1]);
    if (!arm) continue;
    zebra(j.at, dir, along, cr.cls, cr.kind === 'ped-signal' ? 1.4 : 1.1);
    crossingKey.add(cr.id);
    if (j.type !== 'roundabout' && j.type !== 'mini') stopLine(j.at, dir, along + 1.5, cr.cls);
  } else if (cr.axis) {
    const w = hw(cr.cls);
    const e = PLAN.edges.find((q) => q.cls === cr.cls && q.dir === cr.axis && ((cr.axis === 'x' && Math.abs(N.get(q.a).z - cr.at[1]) < 0.01 && Math.min(N.get(q.a).x, N.get(q.b).x) <= cr.at[0] && Math.max(N.get(q.a).x, N.get(q.b).x) >= cr.at[0]) || (cr.axis === 'z' && Math.abs(N.get(q.a).x - cr.at[0]) < 0.01)));
    if (!e) continue;
    zebra(cr.at, cr.axis === 'x' ? [1, 0] : [0, 1], 0, cr.cls, 1.5);
  }
}
// give-way lines of priority-junction minor arms; signal heads; stop / yield signs
const SIGN = { stop: 0, yield: 1, round: 2, main: 3 };
for (const j of PLAN.junctions) {
  const c = j.at;
  if (j.type === 'priority' || j.type === 'riro') {
    const major = j.major;
    for (const a of j.arms) {
      if (major && a.cls === major) continue;
      if (!major && j.arms.length === 4 && 0) continue;
      const cross = j.arms.filter((x) => (x.dir[0] !== 0) !== (a.dir[0] !== 0)).map((x) => hw(x.cls)), ch = cross.length ? Math.max(...cross) : 0;
      const at = ch + 1.0;
      if (j.arms.length >= 3 && major) {
        stopLine(c, a.dir, at, a.cls);
        const r = [a.dir[1], -a.dir[0]];
        furniture.pole.push([c[0] + a.dir[0] * (at + 0.6) + r[0] * (hw(a.cls) + 0.5), c[1] + a.dir[1] * (at + 0.6) + r[1] * (hw(a.cls) + 0.5), yawOf(a.dir), SIGN.stop]);
      }
    }
  } else if (j.type === 'signal') {
    const hx = Math.max(...j.arms.filter((a) => a.dir[0] === 0).map((a) => hw(a.cls)), j.terminal ? 1.0 : 0), hz = Math.max(...j.arms.filter((a) => a.dir[1] === 0).map((a) => hw(a.cls)), j.terminal ? 1.0 : 0);
    for (const a of j.arms) {
      const w = hw(a.cls), along = (a.dir[0] !== 0 ? hx : hz) + 2.2;
      if (!PLAN.crossings.some((cr) => cr.id.startsWith(j.id + '-') && cr.arm && cr.arm[0] === a.dir[0] && cr.arm[1] === a.dir[1])) zebra(c, a.dir, along, a.cls, 1.4);
      stopLine(c, a.dir, along + 1.6, a.cls);
      const r = [a.dir[1], -a.dir[0]];
      furniture.sig.push([c[0] + a.dir[0] * (along + 1.2) + r[0] * (w + 0.55), c[1] + a.dir[1] * (along + 1.2) + r[1] * (w + 0.55), yawOf(a.dir)]);
    }
  } else if (j.type === 'roundabout') {
    for (const a of j.arms) {
      const r = [a.dir[1], -a.dir[0]];
      furniture.pole.push([c[0] + a.dir[0] * (j.R + 1.2) + r[0] * (hw(a.cls) + 0.5), c[1] + a.dir[1] * (j.R + 1.2) + r[1] * (hw(a.cls) + 0.5), yawOf(a.dir), SIGN.yield]);
    }
    furniture.pole.push([c[0] + (j.R >= 12 ? 3.2 : 0), c[1], 0, SIGN.round]);
  }
}
for (const cr of PLAN.crossings) if (cr.kind === 'ped-signal-midblock') {
  const w = hw(cr.cls), d = cr.axis === 'x' ? [1, 0] : [0, 1], r = [d[1], -d[0]];
  for (const sgn of [-1, 1]) furniture.sig.push([cr.at[0] + r[0] * sgn * (w + 0.6) + d[0] * 1.2, cr.at[1] + r[1] * sgn * (w + 0.6) + d[1] * 1.2, yawOf([-r[0] * sgn, -r[1] * sgn])]);
}

// ---- 6. rail
const railOut = { bed: [], tracks: 0 };
{
  const crossX = PLAN.edges.filter((e) => e.underRail != null && e.dir === 'z').map((e) => [N.get(e.a).x - hw(e.cls) - CLS[e.cls].sidewalk - 0.4, N.get(e.a).x + hw(e.cls) + CLS[e.cls].sidewalk + 0.4]);
  crossX.push([M2_X - MW - 0.8, M2_X + MW + 0.8]);
  const st = PLAN.rail.stations[0];
  const run = (x0, x1, z, tracks, halfBed) => {
    for (const [a, b] of subtractIntervals(x0, x1, crossX)) {
      emitRect('g', 'q', a, z - halfBed, b, z + halfBed, H.rail, CI.ballast);
      for (let k = 0; k < tracks; k++) { const zz = z + (k - (tracks - 1) / 2) * 3.2; for (const o of [-0.6, 0.6]) emitRect('g', 'q', a, zz + o - 0.07, b, zz + o + 0.07, H.railPaint, CI.rail); }
    }
    railOut.bed.push([x0, z - halfBed, x1, z + halfBed]);
  };
  run(-320, st.x0, RAIL_Z, 2, 3.6); run(st.x0, st.x1, RAIL_Z, 4, 7.2); run(st.x1, 320, RAIL_Z, 2, 3.6);
  emitRect('g', 'q', st.x0 + 2, RAIL_Z - 12.2, st.x1 - 2, RAIL_Z - 8.8, H.walk, CI.platform);
  emitRect('g', 'q', st.x0 + 2, RAIL_Z + 8.8, st.x1 - 2, RAIL_Z + 12.2, H.walk, CI.platform);
  const y = PLAN.rail.yard; emitRect('g', 'q', y.x0, y.z0, y.x1, y.z1, H.rail, CI.ballast);
  for (let k = 0; k < y.tracks; k++) { const zz = y.z0 + 3 + k * (y.z1 - y.z0 - 6) / (y.tracks - 1); for (const o of [-0.6, 0.6]) emitRect('g', 'q', y.x0, zz + o - 0.07, y.x1, zz + o + 0.07, H.railPaint, CI.rail); }
  const sp = PLAN.rail.spur.pts; ribbon('g', sp, 2.6, H.rail, CI.ballast);
  const lines = [[-0.6], [0.6]];
  for (const [o] of lines) { const off = sp.map((p, i) => { const q = sp[Math.min(sp.length - 1, i + 1)], r = sp[Math.max(0, i - 1)]; let dx = q[0] - r[0], dz = q[1] - r[1]; const l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * o, p[1] + dx / l * o]; }); ribbon('g', off, 0.14, H.railPaint, CI.rail); }
}

// ---- 7. landscape: base grass, areas, blocks, fields, forests, water
const SZ = PLAN.size;
{
  // base grass in 5 m squares with a deterministic tint (cheap mottling)
  const rnd = mulberry(7);
  for (let x = Math.floor(SZ.x0 / 10) * 10; x < SZ.x1; x += 10) for (let z = Math.floor(SZ.z0 / 10) * 10; z < SZ.z1; z += 10) {
    emitRect('g', 'q', x, z, x + 10, z + 10, H.base, rnd() < 0.5 ? CI.grass : CI.grassB);
  }
  const KIND = { forest: 'forest', industry: 'industry', verge: 'verge', park: 'park', parking: 'parking', embankment: 'embank', beach: 'beach', promenade: 'promenade', port: 'port', urban: 'urban' };
  for (const a of PLAN.areas) emitPoly('g', a.poly, H.zone, CI[KIND[a.kind]]);
  const ZONE = { residential: 'resid', mixed: 'mixed', cbd: 'cbd', industrial: 'indus', logistics: 'indus', railyard: 'indus', station: 'station', busterm: 'station', villas: 'villas', school: 'school', hospital: 'hospital', park: 'park', market: 'market', east: 'mixed', stadium: 'stadium', campus: 'school', waterfront: 'waterf' };
  for (const b of PLAN.blocks) { const r = b.lot || b.rect; emitRect('g', 'q', r[0], r[1], r[2], r[3], H.zone2, CI[ZONE[b.zone] || 'resid']); }
  // fields in strips
  const triOf = (poly) => { const v = poly.map((p) => new THREE.Vector2(p[0], p[1])); return THREE.ShapeUtils.triangulateShape(v, []).map((t) => t.map((i) => poly[i])); };
  for (const f of PLAN.rural.fields) {
    const xs = f.poly.map((p) => p[0]), zs = f.poly.map((p) => p[1]), n = f.strips || 2, tris = triOf(f.poly);
    for (let k = 0; k < n; k++) {
      const ci = CI['field' + ((f.crop + k) % 4)];
      const rect = f.angle === 0 ? [Math.min(...xs), Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * k / n, Math.max(...xs), Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * (k + 1) / n] : [Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * k / n, Math.min(...zs), Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * (k + 1) / n, Math.max(...zs)];
      for (const t of tris) { const poly = clipPoly(t, rect[0], rect[1], rect[2], rect[3]); if (poly.length < 3) continue; for (let i = 1; i + 1 < poly.length; i++) emitTri('g', poly[0], poly[i], poly[i + 1], H.zone, ci); }
    }
  }
  for (const f of PLAN.rural.forests) emitPoly('g', f, H.zone, CI.forest);
  for (const ln of PLAN.rural.lanes) ribbon('g', ln, 1.4, H.zone2, CI.dirt);
  // sea (below the coast line), shore band, river with banks, marina, rocks
  const coast = PLAN.water.sea.coast;
  const sea = coast.concat([[SZ.x1 + 40, 300], [SZ.x0 - 40, 300]]);
  const seaTris = THREE.ShapeUtils.triangulateShape(sea.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const t of seaTris) emitTri('g', sea[t[0]], sea[t[1]], sea[t[2]], H.water, CI.sea);
  for (let i = 0; i + 1 < coast.length; i++) { const a = coast[i], b = coast[i + 1]; if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) > 5) continue; ribbon('g', [[a[0], a[1] + 1.2], [b[0], b[1] + 1.2]], 2.4, H.water + 0.004, CI.seaLight); }
  const rv = PLAN.water.river;
  ribbon('g', rv.pts, rv.w + 4, H.bank, CI.bank); ribbon('g', rv.pts, rv.w, H.water, CI.river);
  for (const [x, z, r] of PLAN.water.rocks) disc('r', [x, z], r, 0.1, CI.rock, 10);
  for (const m of PLAN.water.marina.moles) ribbon('r', m, 2.4, 0.1, CI.moleC);
  PLAN.water.piers.forEach((p) => emitRect('r', 'q', p.x0, p.z0, p.x1, p.z1, 0.1, CI.port));
}

// ---- 8. run the raster for every cell that has shapes
const cxs = cellRange(Math.min(SZ.x0, ...shapes.map((q) => q.x0)) - 1, Math.max(SZ.x1, ...shapes.map((q) => q.x1)) + 1), czs = cellRange(Math.min(SZ.z0, ...shapes.map((q) => q.z0)) - 1, Math.max(SZ.z1, ...shapes.map((q) => q.z1)) + 1);   // roads run on past the map edge (M1 to x 370, Northern road to z -370)
for (const cx of cxs) for (const cz of czs) rasterCell(cx, cz);
const rasterAt = (x, z) => { const r = rasterOut.get(ck(Math.floor(x / CELL), Math.floor(z / CELL))); return r ? r.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) : null; };
const ringAt = (x, z) => ringsOut.find((r) => Math.hypot(x - r.at[0], z - r.at[1]) < r.R + 2.5);
const inPoly = (x, z, poly) => { let yes = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes; } return yes; };
const seaPoly = PLAN.water.sea.coast.concat([[SZ.x1 + 40, 300], [SZ.x0 - 40, 300]]);
const riverPts = PLAN.water.river.pts;
function segDist(x, z, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0; return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)); }
const riverDist = (x, z) => { let b = Infinity; for (let i = 0; i + 1 < riverPts.length; i++) b = Math.min(b, segDist(x, z, riverPts[i], riverPts[i + 1])); return b; };
// bridges: where a street / motorway crosses the river the floor stays walkable
const bridgeRects = [];
for (const e of PLAN.edges) if (e.bridge === 'river') { const a = N.get(e.a), b = N.get(e.b), w = hw(e.cls) + CLS[e.cls].sidewalk; bridgeRects.push([Math.min(a.x, b.x), a.z - w, Math.max(a.x, b.x), a.z + w]); }
{ // M1 over the river
  const near = riverPts.reduce((q, p) => Math.abs(p[1] - M1_Z) < Math.abs(q[1] - M1_Z) ? p : q); bridgeRects.push([near[0] - 24, M1_Z - MW - 1, near[0] + 24, M1_Z + MW + 1]);
}
for (const f of PLAN.footbridges) if (f.over === 'река') bridgeRects.push([f.at[0] - f.len / 2, f.at[1] - 1.5, f.at[0] + f.len / 2, f.at[1] + 1.5]);
const isWater = (x, z) => inPoly(x, z, seaPoly) || (riverDist(x, z) < PLAN.water.river.w / 2 && !bridgeRects.some((r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]));
const blocked = (x, z, pad = 0.6) => !!(rasterAt(x, z) || rasterAt(x + pad, z) || rasterAt(x - pad, z) || rasterAt(x, z + pad) || rasterAt(x, z - pad) || ringAt(x, z) || rangeRamp(x, z) || railBlocked(x, z)) || isWater(x, z);
const rampSegs = rampsOut.flatMap((r) => r.pts.slice(1).map((p, i) => [r.pts[i], p]));
const rangeRamp = (x, z) => rampSegs.some(([a, b]) => Math.abs((a[0] + b[0]) / 2 - x) < 60 && segDist(x, z, a, b) < 2.2);
const railBlocked = (x, z) => railOut.bed.some((b) => x >= b[0] - 1 && x <= b[2] + 1 && z >= b[1] - 1 && z <= b[3] + 1) || segDist(x, z, PLAN.rail.spur.pts[0], PLAN.rail.spur.pts[PLAN.rail.spur.pts.length - 1]) < 4;

// ---- 9. furniture lists: lamps / street trees along the streets, bus shelters, landscape trees
const lampsPer = { arterial: 26, collector: 28, local: 32 };
const rndF = mulberry(99);
for (const e of PLAN.edges) {
  if (e.cls === 'motorway' || e.cls === 'service') continue;
  const a = N.get(e.a), b = N.get(e.b), ax = e.dir, cl = CLS[e.cls], c = ax === 'x' ? a.z : a.x;
  const lo = ax === 'x' ? Math.min(a.x, b.x) : Math.min(a.z, b.z), hi = ax === 'x' ? Math.max(a.x, b.x) : Math.max(a.z, b.z);
  const lowNode = (ax === 'x' ? a.x <= b.x : a.z <= b.z) ? e.a : e.b, highNode = lowNode === e.a ? e.b : e.a;
  const t0 = trimAt(lowNode, e) + 3, t1 = trimAt(highNode, e) + 3, step = lampsPer[e.cls], cuts = cutsOf(e);
  const sideOff = hw(e.cls) + cl.sidewalk * 0.5;
  const n = Math.floor((hi - lo - t0 - t1) / step);
  for (let k = 0; k <= n; k++) {
    const s = lo + t0 + (n > 0 ? k * (hi - lo - t0 - t1) / n : (hi - lo - t0 - t1) / 2);
    if (cuts.some(([q0, q1]) => s > q0 - 3 && s < q1 + 3)) continue;
    const sides = e.cls === 'local' ? [(k % 2) ? 1 : -1] : [-1, 1];
    for (const sgn of sides) {
      const pos = ax === 'x' ? [s, c + sgn * sideOff] : [c + sgn * sideOff, s], yaw = ax === 'x' ? (sgn > 0 ? Math.PI : 0) : (sgn > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (blocked(pos[0] + (ax === 'x' ? 0 : sgn * 0.8), pos[1] + (ax === 'x' ? sgn * 0.8 : 0), 0.1) && !rasterAt(pos[0], pos[1])) continue;
      furniture.lamp.push([pos[0], pos[1], yaw]);
    }
    if (e.cls !== 'local' && k < n) {
      const m = s + step / 2;
      if (!cuts.some(([q0, q1]) => m > q0 - 3 && m < q1 + 3)) for (const sgn of [-1, 1]) {
        const off = hw(e.cls) + cl.sidewalk + 0.9, pos = ax === 'x' ? [m, c + sgn * off] : [c + sgn * off, m];
        if (!blocked(pos[0], pos[1], 0.9)) cellOf(Math.floor(pos[0] / CELL), Math.floor(pos[1] / CELL)).f.tree.push(R2(pos[0]), R2(pos[1]), R2(0.8 + rndF() * 0.35), R2(rndF()));
      }
    }
  }
}
// bus shelters at the stops of the three lines (side = right of the heading, the kerb the bus stops at)
const stopsOut = [];
for (const line of PLAN.transit.lines) for (const s of line.stops) {
  let best = null; for (let i = 0; i + 1 < line.pts.length; i++) { const d = segDist(s[0], s[1], line.pts[i], line.pts[i + 1]); if (!best || d < best.d) best = { d, i }; }
  const p0 = line.pts[best.i], p1 = line.pts[best.i + 1], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, h = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L], r = rightOf(h);
  const e = PLAN.edges.find((q) => { const a = N.get(q.a), b = N.get(q.b); return q.dir === 'x' ? Math.abs(a.z - s[1]) < 0.01 && s[0] >= Math.min(a.x, b.x) && s[0] <= Math.max(a.x, b.x) : Math.abs(a.x - s[0]) < 0.01 && s[1] >= Math.min(a.z, b.z) && s[1] <= Math.max(a.z, b.z); });
  const off = e ? hw(e.cls) + CLS[e.cls].sidewalk * 0.55 : 3;
  furniture.stop.push([s[0] + r[0] * off, s[1] + r[1] * off, Math.atan2(-r[0], -r[1]), line.id]);
  stopsOut.push({ line: line.id, at: s });
}
// landscape trees
{
  const rnd = mulberry(2026);
  const treeAreas = PLAN.areas.filter((a) => a.kind === 'forest').map((a) => a.poly).concat(PLAN.rural.forests);
  for (const poly of treeAreas) {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    for (let x = x0; x < x1; x += 6) for (let z = z0; z < z1; z += 6) {
      const px = x + rnd() * 6, pz = z + rnd() * 6;
      if (rnd() < 0.18 || !inPoly(px, pz, poly) || blocked(px, pz, 1.4)) continue;
      cellOf(Math.floor(px / CELL), Math.floor(pz / CELL)).f.tree.push(R2(px), R2(pz), R2(1.0 + rnd() * 0.9), R2(rnd()));
    }
  }
  // urban park / verge trees: sparse
  for (const a of PLAN.areas.filter((q) => q.kind === 'park' || q.kind === 'verge' || q.kind === 'embankment')) {
    const xs = a.poly.map((p) => p[0]), zs = a.poly.map((p) => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 9) for (let z = Math.min(...zs); z < Math.max(...zs); z += 9) {
      const px = x + rnd() * 9, pz = z + rnd() * 9;
      if (rnd() < 0.35 || !inPoly(px, pz, a.poly) || blocked(px, pz, 1.4)) continue;
      cellOf(Math.floor(px / CELL), Math.floor(pz / CELL)).f.tree.push(R2(px), R2(pz), R2(0.8 + rnd() * 0.5), R2(rnd()));
    }
  }
  // central circus: a ring of trees on the paved plaza
  for (let k = 0; k < 16; k++) { const a = (k + 0.5) * Math.PI / 8; const px = Math.cos(a) * 19.5, pz = Math.sin(a) * 19.5; if (!rasterAt(px, pz)) cellOf(Math.floor(px / CELL), Math.floor(pz / CELL)).f.tree.push(R2(px), R2(pz), 0.95, R2(rnd())); }
  for (const j of PLAN.junctions) if (j.type === 'roundabout' && j.R < 12) cellOf(Math.floor(j.at[0] / CELL), Math.floor(j.at[1] / CELL)).f.tree.push(j.at[0], j.at[1], 1.1, 0.5);
}
for (const [kind, list] of Object.entries(furniture)) for (const f of list) { const c = cellOf(Math.floor(f[0] / CELL), Math.floor(f[1] / CELL)).f[kind]; for (const v of f) c.push(typeof v === 'number' ? R2(v) : v); }

// ---- 10. graph (for tests and later steps), walkable floor
const graph = {
  nodes: PLAN.nodes.map((n) => [n.id, n.x, n.z, n.kind || '']),
  edges: PLAN.edges.map((e) => { const a = N.get(e.a), b = N.get(e.b); return [e.id, e.a, e.b, e.cls, a.x, a.z, b.x, b.z, e.name || '']; }),
  rings: ringsOut.map((r) => [r.id, r.at[0], r.at[1], r.R, r.Ri]),
  ramps: rampsOut.map((r) => [r.ic, r.kind, r.pts.map((p) => [R2(p[0]), R2(p[1])])]),
  crossings: PLAN.crossings.map((c) => [c.id, c.kind, c.at[0], c.at[1], c.arm ? c.arm[0] : 0, c.arm ? c.arm[1] : 0, c.cls, c.setback == null ? 0 : c.setback]),
  signals: PLAN.junctions.filter((j) => j.type === 'signal').map((j) => [j.id, j.at[0], j.at[1]]),
  stops: stopsOut,
  landmarks: PLAN.landmarks.map((l) => [l.id, l.kind, l.name, l.at[0], l.at[1]]),
  footbridges: PLAN.footbridges.map((f) => [f.id, f.at[0], f.at[1], f.axis, f.len]), tunnels: PLAN.tunnels.map((f) => [f.id, f.at[0], f.at[1], f.axis, f.len]),
};
const floorData = { x0: SZ.x0, x1: SZ.x1, z0: SZ.z0, z1: SZ.z1, sea: PLAN.water.sea.coast.map((p) => [R2(p[0]), R2(p[1])]), river: riverPts.map((p) => [R2(p[0]), R2(p[1])]), riverW: PLAN.water.river.w, bridges: bridgeRects.map((r) => r.map(R2)) };

// ---- 11. serialise
const cellsOut = {};
const keys = [...cells.keys()].sort((a, b) => { const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number); return ax - bx || az - bz; });
for (const k of keys) {
  const c = cells.get(k), o = {};
  for (const L of ['g', 'r', 'p']) { const l = {}; for (const [s, arr] of Object.entries(c[L])) if (arr.length) l[s] = arr; if (Object.keys(l).length) o[L] = l; }
  const f = {}; for (const [s, arr] of Object.entries(c.f)) if (arr.length) f[s] = arr; if (Object.keys(f).length) o.f = f;
  cellsOut[k] = o;
}
const data = { version: 1, cell: CELL, size: SZ, classes: Object.fromEntries(Object.entries(CLS).map(([k, c]) => [k, [c.w, c.sidewalk, c.median, c.lanes]])), colors: PAL.map((k) => COLORS[k]), palette: CI, heights: H, cells: cellsOut, graph, floor: floorData, counts: PLAN.counts };
const FLOOR_FN = `
(function(D){
  var F=D.floor;
  function ring(poly,x,z){var yes=false;for(var i=0,j=poly.length-1;i<poly.length;j=i++){var a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
  function segd(x,z,a,b){var dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l)):0;return Math.hypot(x-(a[0]+dx*t),z-(a[1]+dz*t));}
  var seaPoly=F.sea.concat([[F.x1+40,300],[F.x0-40,300]]);
  D.onBridge=function(x,z){for(var i=0;i<F.bridges.length;i++){var r=F.bridges[i];if(x>=r[0]&&x<=r[2]&&z>=r[1]&&z<=r[3])return true;}return false;};
  // the land of the plan: inside the map, not in the sea, not in the river (except under a bridge)
  D.floor=function(x,z){
    if(x<F.x0||x>F.x1||z<F.z0||z>F.z1)return false;
    if(ring(seaPoly,x,z))return false;
    if(!D.onBridge(x,z)){var best=1e9;for(var i=0;i+1<F.river.length;i++){var d=segd(x,z,F.river[i],F.river[i+1]);if(d<best)best=d;}if(best<F.riverW/2)return false;}
    return true;
  };
  // a point is accessible when the ring of 8 samples around it is floor too (no standing on the very edge of the water)
  D.access=function(x,z,m){m=m==null?.65:m;if(!D.floor(x,z))return false;for(var i=0;i<8;i++){var a=i*Math.PI/4;if(!D.floor(x+Math.cos(a)*m,z+Math.sin(a)*m))return false;}return true;};
  D.cellKey=function(x,z){return Math.floor(x/D.cell)+','+Math.floor(z/D.cell);};
})(window.PlanCDataV161);
`;
const text = '// Generated by tools/masterplan/compile-plan-c.mjs from tools/masterplan/plan-C.json (masterplan C, step C1); do not edit.\nwindow.PlanCDataV161=' + JSON.stringify(data) + ';' + FLOOR_FN;

if (process.argv.includes('--stats')) {
  let q = 0, t = 0, w = 0; for (const c of Object.values(cellsOut)) for (const L of ['g', 'r', 'p']) { q += (c[L]?.q?.length || 0) / 6; t += (c[L]?.t?.length || 0) / 8; w += (c[L]?.w?.length || 0) / 7; }
  console.log('cells', keys.length, 'quads', q, 'tris', t, 'walls', w, 'bytes', text.length, 'palette', PAL.length);
  let trees = 0, lamps = 0, sigs = 0, poles = 0, stops = 0; for (const c of Object.values(cellsOut)) { trees += (c.f?.tree?.length || 0) / 4; lamps += (c.f?.lamp?.length || 0) / 3; sigs += (c.f?.sig?.length || 0) / 3; poles += (c.f?.pole?.length || 0) / 4; stops += (c.f?.stop?.length || 0) / 4; }
  console.log({ trees, lamps, sigs, poles, stops });
}
if (process.argv.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== text) { console.error('plan-c-data-v161.js is stale: run node tools/masterplan/compile-plan-c.mjs'); process.exit(1); }
  console.log('plan-c-data-v161.js matches plan-C.json (' + text.length + ' bytes, ' + keys.length + ' cells)');
} else {
  fs.writeFileSync(OUT, text);
  console.log('wrote', path.relative(ROOT, OUT), text.length, 'bytes,', keys.length, 'cells');
}
export { data };
