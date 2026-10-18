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
  asph: 0x353a3f, ramp: 0x353a3f, walk: 0xc4bfae, kerb: 0xaaa595, median: 0xb8b4a4, medLawn: 0x6f9d57, medM: 0xa9a99f, plaza: 0xd4cab4, islandL: 0x6ea154, islandC: 0xd9d1bb,
  conc: 0xbdb9ad, concD: 0x8d8a82, sleeper: 0x4a3f36, white: 0xf2f2ec, yellow: 0xe7c85a, ballast: 0x8a8782, rail: 0x56585b, platform: 0xb8b5aa, moleC: 0x9b9a92, rock: 0x77756f,
  resid: 0x82b064, mixed: 0x95b57a, cbd: 0xaaa898, indus: 0x959890, school: 0x90bd72, hospital: 0xa4b88e, station: 0xa9a79b, villas: 0x78b45f, waterf: 0xa6b88f, market: 0xb4ae98, stadium: 0x6fae55,
};
const PAL = Object.keys(COLORS), CI = Object.fromEntries(PAL.map((k, i) => [k, i]));
const H = { ground: 0, asph: 0.05, walk: 0.12, med: 0.12, paint: 0.062, ramp: 0.052, ringWalk: 0.12, island: 0.09, plaza: 0.03, fillet: 0.123, zone: -0.06, zone2: -0.05, water: -0.02, bank: -0.03, base: -0.08, rail: 0.035, railPaint: 0.066 };   // every ground layer has its own height (no coplanar overlaps = no z-fighting seams)

// ---- the cell store
const cells = new Map();
const ck = (cx, cz) => cx + ',' + cz;
function cellOf(cx, cz) {
  const k = ck(cx, cz); let c = cells.get(k);
  if (!c) { c = { g: { q: [], t: [] }, r: { q: [], t: [], w: [] }, p: { q: [], t: [] }, d: { v: [], s: [] }, f: { lamp: [], sig: [], pole: [], plate: [], stop: [], tree: [], cat: [] } }; cells.set(k, c); }
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
// 3D primitives for decks / ramps / bridges (layer d): v = triangle with its own y per vertex [x y z x y z x y z ci], s = vertical quad with sloped bottom/top [x0 z0 x1 z1 b0 t0 b1 t1 ci]
function emitTri3(a, b, c, ci) {   // a,b,c = [x, y, z]
  const x0 = Math.min(a[0], b[0], c[0]), x1 = Math.max(a[0], b[0], c[0]), z0 = Math.min(a[2], b[2], c[2]), z1 = Math.max(a[2], b[2], c[2]);
  const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(den) < 1e-9) return;
  const yAt = (x, z) => { const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den; return u * a[1] + v * b[1] + (1 - u - v) * c[1]; };
  for (const cx of cellRange(x0, x1 + 1e-6)) for (const cz of cellRange(z0, z1 + 1e-6)) {
    const poly = clipPoly([[a[0], a[2]], [b[0], b[2]], [c[0], c[2]]], cx * CELL, cz * CELL, (cx + 1) * CELL, (cz + 1) * CELL);
    if (poly.length < 3 || Math.abs(area2(poly)) < 1e-5) continue;
    const arr = cellOf(cx, cz).d.v, V = (q) => [q[0], yAt(q[0], q[1]), q[1]];
    for (let i = 1; i + 1 < poly.length; i++) { const p0 = V(poly[0]), p1 = V(poly[i]), p2 = V(poly[i + 1]); push(arr, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]); arr.push(ci); }
  }
}
function emitQuadS(x0, z0, x1, z1, b0, t0, b1, t1, ci) {   // vertical quad between two ground points, bottom / top heights at both ends
  if (Math.hypot(x1 - x0, z1 - z0) < 1e-4) return;
  const arr = cellOf(Math.floor((x0 + x1) / 2 / CELL), Math.floor((z0 + z1) / 2 / CELL)).d.s;
  push(arr, x0, z0, x1, z1, b0, t0, b1, t1); arr.push(ci);
}
function box3(x0, z0, x1, z1, y0, y1, ci, top = true) {   // axis-aligned solid: 4 walls (+ top)
  emitQuadS(x0, z0, x1, z0, y0, y1, y0, y1, ci); emitQuadS(x1, z0, x1, z1, y0, y1, y0, y1, ci); emitQuadS(x1, z1, x0, z1, y0, y1, y0, y1, ci); emitQuadS(x0, z1, x0, z0, y0, y1, y0, y1, ci);
  if (top) { emitTri3([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], ci); emitTri3([x0, y1, z0], [x1, y1, z1], [x1, y1, z0], ci); }
}
function offsetPts3(pts, o) {   // [x,z,h] polyline shifted sideways (o > 0 = right of travel, screen frame)
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; out.push([pts[i][0] - dz * o, pts[i][1] + dx * o, pts[i][2]]); }
  return out;
}
function deckRibbon(pts, w, dy, ci) {   // road surface following [x,z,h]
  const L = offsetPts3(pts, -w / 2), Rr = offsetPts3(pts, w / 2);
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = [L[i][0], L[i][2] + dy, L[i][1]], B = [Rr[i][0], Rr[i][2] + dy, Rr[i][1]], C = [L[i + 1][0], L[i + 1][2] + dy, L[i + 1][1]], D = [Rr[i + 1][0], Rr[i + 1][2] + dy, Rr[i + 1][1]];
    emitTri3(A, B, C, ci); emitTri3(B, D, C, ci);
  }
}
function wallAlong(pts, o, b, t, ci, from = 0, to = pts.length - 1) {   // vertical wall along an offset of the polyline; b / t are absolute heights (number) or functions of h
  const q = offsetPts3(pts, o);
  for (let i = from; i < to; i++) { const bb0 = typeof b === 'function' ? b(pts[i][2]) : b, bb1 = typeof b === 'function' ? b(pts[i + 1][2]) : b, tt0 = typeof t === 'function' ? t(pts[i][2]) : t, tt1 = typeof t === 'function' ? t(pts[i + 1][2]) : t; emitQuadS(q[i][0], q[i][1], q[i + 1][0], q[i + 1][1], bb0, tt0, bb1, tt1, ci); }
}
function capAlong(pts, o, w, dy, ci, from = 0, to = pts.length - 1) { const sub = pts.slice(from, to + 1); deckRibbon(offsetPts3(sub, o), w, dy, ci); }
function paintAlong(pts, o, w, dash, gap, dy, ci) {   // dashed (or solid when gap = 0) line on a deck
  const q = offsetPts3(pts, o); let acc = 0, on = true, cur = [];
  const flush = () => { if (cur.length > 1) deckRibbon(cur, w, dy, ci); cur = []; };
  for (let i = 0; i + 1 < q.length; i++) {
    const a = q[i], b = q[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    if (!gap) { if (!cur.length) cur.push(a); cur.push(b); continue; }
    let s = 0;
    while (s < L) {
      const lim = on ? dash : gap, take = Math.min(L - s, lim - acc), t0 = s / L, t1 = (s + take) / L, p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1];
      if (on) { if (!cur.length) cur.push(p0); cur.push(p1); }
      s += take; acc += take; if (acc >= lim - 1e-9) { if (on) flush(); on = !on; acc = 0; }
    }
  }
  flush();
}
const arcLen = (pts) => { const out = [0]; for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return out; };
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
const ringW = (j) => j.lanes === 2 ? 5.4 : 3.0;   // circulatory lane: 2 lanes 5.4 (>= 5.0), 1 lane 3.0 (car + truck swept path >= 2.6)
const laneW = (cls) => CLS[cls].lane || (CLS[cls].w - CLS[cls].median) / 2 / CLS[cls].lanes;
const RAIL_Z = PLAN.rail.pts[0][1], M1_Z = -240, M2_X = 250;
function trimAt(nodeId, e) {   // how far markings / medians stay away from a node
  const n = N.get(nodeId), j = J.get(nodeId);
  if (!j) return n.legs && n.legs.length > 1 ? 1.5 : 0;
  if (j.type === 'roundabout') return j.R + 6.5;
  if (j.type === 'mini') return 7;
  const cross = j.arms.filter((a) => (a.dir[0] !== 0) !== (e.dir === 'x')).map((a) => hw(a.cls));
  const ch = cross.length ? Math.max(...cross) : 0;
  if (j.type === 'signal') return ch + 5.2;
  if (j.type === 'riro' && e.cls === 'arterial') return 0;
  return ch + 0.8;
}
// ---- vertical profiles: motorways climb to DECKH over the roads that cross them (6 % grades, rounded vertical curves); everything else stays at 0
const SLOPE = 0.06, FLATH = 11, DECKH = 5.3, CLEAR = 4.5;   // deck top 5.3, slab 0.8 -> 4.5 m headroom for trucks
function smoothFn(fn, lo, hi, step = 2, k = 2) {
  const n = Math.round((hi - lo) / step); let arr = Array.from({ length: n + 1 }, (_, i) => fn(lo + i * step));
  for (let pass = 0; pass < 2; pass++) { const src = arr; arr = src.map((_, i) => { let sum = 0, c = 0; for (let j = -k; j <= k; j++) { sum += src[Math.min(n, Math.max(0, i + j))]; c++; } return sum / c; }); }
  return (v) => { const t = Math.max(0, Math.min(n - 1e-9, (v - lo) / step)), i = Math.floor(t), f = t - i; return arr[i] * (1 - f) + arr[i + 1] * f; };
}
const trap = (d) => Math.max(0, Math.min(DECKH, DECKH - SLOPE * Math.max(0, d - FLATH)));
const hM1 = smoothFn((x) => trap(Math.abs(x)), -330, 390), hM2 = smoothFn((z) => Math.max(trap(Math.abs(z - M1_Z)), trap(Math.abs(z))), -390, 100);
const intervalsAbove = (fn, lo, hi, th) => { const out = []; let a = null; for (let v = lo; v <= hi + 1e-9; v += 1) { const on = fn(v) > th; if (on && a == null) a = v; if (!on && a != null) { out.push([a, v]); a = null; } } if (a != null) out.push([a, hi]); return out; };
const M1_UP = intervalsAbove(hM1, -330, 390, 0.25), M2_UP = intervalsAbove(hM2, -390, 100, 0.25);
function lookupH(x, z) { const d1 = Math.abs(z - M1_Z), d2 = Math.abs(x - M2_X); if (d1 < MW + 5 && d1 <= d2) return hM1(x); if (d2 < MW + 5) return hM2(z); return 0; }
// raster cuts: the ground surface of a motorway disappears where its deck stands on a causeway (the crossing road keeps its own surface under the deck)
function cutsOf(e) {
  if (e.cls !== 'motorway') return [];
  return e.ref === 'M1' ? M1_UP : e.ref === 'M2' ? M2_UP : [];
}
// old flat-crossing intervals, still used to keep lamps / trees away from the crossings
function furnCuts(e) {
  const cuts = [];
  if (e.underRail != null && e.dir === 'z') cuts.push([e.underRail - 7, e.underRail + 7]);
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
  const cuts = cutsOf(e);
  for (const [lo, hi] of subtractIntervals(s.lo, s.hi, cuts)) put(lo, hi, -half, half, 'asph');
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
const ringsOut = [], minisOut = [], rampsOut = [];
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
      for (const sg of [-1, 1]) ribbon('p', [P(base, sg * iw), P(tip, 0)], 0.14, H.paint, CI.white);   // painted splitter island: outline on the asphalt, no fill
      // teeth on the incoming half (right of the incoming heading = rightOf(-d) = -r)
      const sgn = -1;
      for (let l = iw + 0.2; l < w - 0.1; l += 0.7) { const q0 = P(R + 0.35, sgn * l), q1 = P(R + 0.7, sgn * (l + 0.35)), q2 = P(R + 0.7, sgn * l); emitTri('p', q0, q1, q2, H.paint, CI.white); }
    }
  } else if (j.type === 'mini') {
    const Ri = 1.9, Ro = Ri + 2.8;   // island r 1.9, circulatory lane 2.8 (>= 2.6), painted outer edge
    disc('r', c, Ri, H.island + 0.03, CI.islandC, 24); disc('r', c, Ri - 0.25, H.island + 0.035, CI.islandL, 24);
    for (let k = 0; k < 24; k++) { const s = k / 24 * Math.PI * 2, e = (k + 1) / 24 * Math.PI * 2; emitWall(c[0] + Math.cos(s) * Ri, c[1] + Math.sin(s) * Ri, c[0] + Math.cos(e) * Ri, c[1] + Math.sin(e) * Ri, H.asph, H.island + 0.03, CI.kerb); }
    for (let a = 0; a < 360; a += 15) annulus('p', c, Ro - 0.07, Ro + 0.07, a, a + 9, H.paint, CI.white, 3);
    minisOut.push({ id: j.id, at: c, R: Ro, Ri });
  }
}
// kerb returns (radius 3) at every corner of a junction where two perpendicular streets meet: asphalt fillet at kerb height, white-free, rounded
for (const j of PLAN.junctions) {
  if (j.type === 'roundabout') continue;
  const c = j.at, RET = 3.0;
  for (const A of j.arms.filter((a) => a.dir[1] === 0)) for (const B of j.arms.filter((b) => b.dir[0] === 0)) {
    if (A.cls === 'motorway' || B.cls === 'motorway') continue;
    const sx = A.dir[0], sz = B.dir[1], K = [c[0] + sx * hw(B.cls), c[1] + sz * hw(A.cls)];
    const O = [K[0] + sx * RET, K[1] + sz * RET], pts = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10 * Math.PI / 2, a0 = Math.atan2(-sz, 0), vx = -sx * Math.cos(t) , vz = -sz * Math.sin(t); pts.push([O[0] + vx * RET, O[1] + vz * RET]); }
    // arc runs from (O.x - sx*R, O.z) [on the edge z = K.z ... see below] : build the patch K, P1, arc, P2 as a fan
    const P1 = [K[0] + sx * RET, K[1]], P2 = [K[0], K[1] + sz * RET], arc2 = [];
    for (let k = 0; k <= 10; k++) { const t = k / 10 * Math.PI / 2; arc2.push([O[0] - sx * RET * Math.sin(t), O[1] - sz * RET * Math.cos(t)]); }   // from P1 (t = 0: O - (0, sz R)... ) to P2
    void pts; void P1; void P2;
    for (let k = 0; k + 1 < arc2.length; k++) emitTri('r', K, arc2[k], arc2[k + 1], H.fillet, CI.asph);
  }
}
// ramps (interchanges): 2 m ribbons with white edge dashes



// ---- 4. markings of the straight streets
function dashed(axis, c, lo, hi, width, dash, gap, y, ci, phase = 0) {   // axis 'x': line along x at z = c
  for (let s = lo + phase; s < hi; s += dash + gap) { const e = Math.min(s + dash, hi); if (e - s < Math.min(0.6, dash * 0.6)) continue; if (axis === 'x') emitRect('p', 'q', s, c - width / 2, e, c + width / 2, y, ci); else emitRect('p', 'q', c - width / 2, s, c + width / 2, e, y, ci); }
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
      const mh = CLS.motorway.median / 2, mdv = mh + CLS.motorway.lane, edge = MW - CLS.motorway.shoulder;
      for (const o of [-edge, edge, -(mh + 0.3), mh + 0.3]) solid(ax, c + o, pl, ph, 0.13, H.paint, CI.white);
      for (const o of [-mdv, mdv]) dashed(ax, c + o, pl, ph, 0.14, 1.6, 1.8, H.paint, CI.white);
    } else if (e.cls === 'arterial') {
      for (const o of [-(CLS.arterial.median / 2 + CLS.arterial.lane), CLS.arterial.median / 2 + CLS.arterial.lane]) dashed(ax, c + o, pl, ph, 0.12, 1.0, 1.4, H.paint, CI.white);
    } else if (e.cls === 'collector') dashed(ax, c, pl, ph, 0.12, 1.0, 1.2, H.paint, CI.white);
  }
}

// ---- 5. junction furniture: zebra crossings, stop lines, signal / sign points
const poleSet = [], furnCat = [];   // pole / head positions for the cell furniture lists, filled below
function zebra(c, dir, at, cls, len = 1.6) {   // bars parallel to the street, symmetric about the centre line / median
  const w = hw(cls), med = CLS[cls].median / 2, p = [c[0] + dir[0] * at, c[1] + dir[1] * at], start = med > 0 ? med + 0.4 : 0.475;
  for (const sg of [-1, 1]) for (let l = start; l <= w - 0.4; l += 0.95) {
    const o = sg * l;
    if (dir[0] === 0) emitRect('p', 'q', p[0] + o - 0.25, p[1] - len / 2, p[0] + o + 0.25, p[1] + len / 2, H.paint, CI.white);
    else emitRect('p', 'q', p[0] - len / 2, p[1] + o - 0.25, p[0] + len / 2, p[1] + o + 0.25, H.paint, CI.white);
  }
}
function stopLine(c, dir, at, cls) {   // across the incoming half of an arm
  const w = hw(cls), med = CLS[cls].median / 2, r = [dir[1], -dir[0]], l0 = med, l1 = w, p = [c[0] + dir[0] * at, c[1] + dir[1] * at];
  const q = (l) => [p[0] + r[0] * l, p[1] + r[1] * l];
  const A = q(l0), B = q(l1);
  if (dir[0] === 0) emitRect('p', 'q', Math.min(A[0], B[0]), p[1] - 0.2, Math.max(A[0], B[0]), p[1] + 0.2, H.paint, CI.white);
  else emitRect('p', 'q', p[0] - 0.2, Math.min(A[1], B[1]), p[0] + 0.2, Math.max(A[1], B[1]), H.paint, CI.white);
}
const furniture = { lamp: [], sig: [], pole: [], plate: [], stop: [], cat: [] };   // world lists, then split into cells
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
        const r = [a.dir[1], -a.dir[0]];
        furniture.pole.push([c[0] + a.dir[0] * (at + 0.6) + r[0] * (hw(a.cls) + 0.5), c[1] + a.dir[1] * (at + 0.6) + r[1] * (hw(a.cls) + 0.5), yawOf(a.dir), SIGN.stop]);
      }
    }
  } else if (j.type === 'signal') {
    const hx = Math.max(...j.arms.filter((a) => a.dir[0] === 0).map((a) => hw(a.cls)), j.terminal ? 1.0 : 0), hz = Math.max(...j.arms.filter((a) => a.dir[1] === 0).map((a) => hw(a.cls)), j.terminal ? 1.0 : 0);
    for (const a of j.arms) {
      const w = hw(a.cls), along = (a.dir[0] !== 0 ? hx : hz) + 2.2;
      if (!PLAN.crossings.some((cr) => cr.id.startsWith(j.id + '-') && cr.arm && cr.arm[0] === a.dir[0] && cr.arm[1] === a.dir[1])) zebra(c, a.dir, along, a.cls, 1.4);
      if (a.cls === 'arterial' || a.cls === 'collector') stopLine(c, a.dir, along + 1.7, a.cls);
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

// ---- 6. rail: the main line stands on a 5.2 m embankment, streets and the M2 run through openings (4.5 m headroom), the station widens it
const RAIL_Y = 5.2;
const railOut = { bed: [], tracks: 0 };
const STRUCT = { ribbons: [], blockers: [], rails: [], openings: [] };   // runtime data: walkable decks / ramps, solid ground rectangles, parapet pieces (level-aware colliders)
const stRail = PLAN.rail.stations[0];
{
  const openings = [];
  for (const e of PLAN.edges) if (e.underRail != null && e.dir === 'z') openings.push({ x: N.get(e.a).x, half: hw(e.cls) + CLS[e.cls].sidewalk + 0.5, clear: CLEAR });
  openings.push({ x: M2_X, half: MW + 0.9, clear: CLEAR });
  for (const t of PLAN.tunnels) if (t.under === 'пути вокзала') openings.push({ x: t.at[0], half: 1.9, clear: 2.8 });
  openings.sort((a, b) => a.x - b.x);
  STRUCT.openings = openings.map((o) => [o.x, o.half, o.clear]);
  const X0 = -330, X1 = 330, zoneHalf = (x) => (x > stRail.x0 - 4 && x < stRail.x1 + 4) ? 14 : 5;
  const brk = [X0, X1, stRail.x0 - 4, stRail.x1 + 4];
  for (const o of openings) brk.push(o.x - o.half, o.x + o.half);
  const xs = [...new Set(brk)].sort((a, b) => a - b);
  const inOpening = (x) => openings.find((o) => x > o.x - o.half && x < o.x + o.half);
  for (let i = 0; i + 1 < xs.length; i++) {
    const xa = xs[i], xb = xs[i + 1], mid = (xa + xb) / 2, hz = zoneHalf(mid), op = inOpening(mid), zA = RAIL_Z - hz, zB = RAIL_Z + hz;
    emitRect('g', 'q', xa, zA, xb, zB, RAIL_Y, CI.ballast);   // ballast bed = embankment top (also the deck over an opening)
    if (op) {
      // deck over the opening: underside, fascia on both faces
      emitTri3([xa, op.clear, zA], [xa, op.clear, zB], [xb, op.clear, zB], CI.concD); emitTri3([xa, op.clear, zA], [xb, op.clear, zB], [xb, op.clear, zA], CI.concD);
      emitQuadS(xa, zA, xb, zA, op.clear, RAIL_Y, op.clear, RAIL_Y, CI.conc); emitQuadS(xb, zB, xa, zB, op.clear, RAIL_Y, op.clear, RAIL_Y, CI.conc);
      // abutment walls lining the opening
      if (Math.abs(xa - (op.x - op.half)) < 1e-6) emitQuadS(xa, zA, xa, zB, 0, op.clear, 0, op.clear, CI.concD);
      if (Math.abs(xb - (op.x + op.half)) < 1e-6) emitQuadS(xb, zA, xb, zB, 0, op.clear, 0, op.clear, CI.concD);
    } else {
      emitQuadS(xa, zA, xb, zA, 0, RAIL_Y, 0, RAIL_Y, CI.conc); emitQuadS(xb, zB, xa, zB, 0, RAIL_Y, 0, RAIL_Y, CI.conc);
      STRUCT.blockers.push([xa, zA, xb, zB]);
      railOut.bed.push([xa, zA, xb, zB]);
    }
  }
  for (const xe of [stRail.x0 - 4, stRail.x1 + 4]) for (const sg of [-1, 1]) emitQuadS(xe, RAIL_Z + sg * 5, xe, RAIL_Z + sg * 14, 0, RAIL_Y, 0, RAIL_Y, CI.conc);   // step where the station widens the embankment
  // tracks: rails + sleepers
  const track = (zz, x0, x1) => {
    for (const o of [-0.6, 0.6]) emitRect('g', 'q', x0, zz + o - 0.07, x1, zz + o + 0.07, RAIL_Y + 0.035, CI.rail);
    for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.5) emitRect('g', 'q', x - 0.17, zz - 1.0, x + 0.17, zz + 1.0, RAIL_Y + 0.012, CI.sleeper);
  };
  for (const zz of [RAIL_Z - 1.6, RAIL_Z + 1.6]) { track(zz, X0, stRail.x0 - 4); track(zz, stRail.x1 + 4, X1); }
  for (const zz of [RAIL_Z - 4.8, RAIL_Z - 1.6, RAIL_Z + 1.6, RAIL_Z + 4.8]) track(zz, stRail.x0 - 4, stRail.x1 + 4);
  emitRect('g', 'q', stRail.x0 + 2, RAIL_Z - 12.2, stRail.x1 - 2, RAIL_Z - 8.8, RAIL_Y + 0.1, CI.platform);
  emitRect('g', 'q', stRail.x0 + 2, RAIL_Z + 8.8, stRail.x1 - 2, RAIL_Z + 12.2, RAIL_Y + 0.1, CI.platform);
  for (const z of [RAIL_Z - 12.2, RAIL_Z - 8.8, RAIL_Z + 8.8, RAIL_Z + 12.2]) emitQuadS(stRail.x0 + 2, z, stRail.x1 - 2, z, RAIL_Y, RAIL_Y + 0.1, RAIL_Y, RAIL_Y + 0.1, CI.conc);
  // catenary poles (instanced furniture, y = RAIL_Y)
  for (let x = X0 + 15; x < X1; x += 30) { if (inOpening(x)) continue; const hz = zoneHalf(x); furnCat.push([x, RAIL_Z - (hz - 0.9), 0], [x, RAIL_Z + (hz - 0.9), Math.PI]); }
  // yard (ground) and spur (ground, starts at the embankment wall)
  const y = PLAN.rail.yard; emitRect('g', 'q', y.x0, y.z0, y.x1, y.z1, H.rail, CI.ballast);
  for (let k = 0; k < y.tracks; k++) { const zz = y.z0 + 3 + k * (y.z1 - y.z0 - 6) / (y.tracks - 1); for (const o of [-0.6, 0.6]) emitRect('g', 'q', y.x0, zz + o - 0.07, y.x1, zz + o + 0.07, H.railPaint, CI.rail); }
  const sp = PLAN.rail.spur.pts.filter((q) => q[1] < RAIL_Z - 5.4); ribbon('g', sp, 2.6, H.rail, CI.ballast);
  for (const o of [-0.6, 0.6]) { const off = sp.map((p, i) => { const q = sp[Math.min(sp.length - 1, i + 1)], r = sp[Math.max(0, i - 1)]; let dx = q[0] - r[0], dz = q[1] - r[1]; const l = Math.hypot(dx, dz) || 1; return [p[0] - dz / l * o, p[1] + dx / l * o]; }); ribbon('g', off, 0.14, H.railPaint, CI.rail); }
}

// ---- 6b. decks, causeways, ramps, bridges, footbridges
function addParapets(pts, o, level0 = null) {   // level-aware collider pieces along an offset of a [x,z,h] path
  const q = offsetPts3(pts, o); let acc = 0, start = 0;
  for (let i = 1; i < q.length; i++) { acc += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); if (acc >= 10 || i === q.length - 1) { const a = q[start], b = q[i]; STRUCT.rails.push([R2(a[0]), R2(a[1]), R2(b[0]), R2(b[1]), R2((a[2] + b[2]) / 2 + (level0 || 0))]); start = i; acc = 0; } }
}
function structureDeck(pts, o) {   // o = {w (surface), halfOuter, med (median half or 0), crossings: [[s0,s1]] along arc length, paint: {edge, divider}, kerbC, walls: true}
  const S = arcLen(pts);
  const inCross = (s) => o.crossings.some(([a, b]) => s > a && s < b);
  deckRibbon(pts, o.w, 0.05, CI.asph);
  // parapets (both sides) + caps
  for (const sg of [-1, 1]) { const off = sg * (o.w / 2 + 0.15); wallAlong(pts, off, (h) => h + 0.05, (h) => h + 0.95, CI.conc); capAlong(pts, off, 0.3, 0.95, CI.conc); addParapets(pts, off); }
  if (o.med) for (const sg of [-1, 1]) { wallAlong(pts, sg * o.med, (h) => h + 0.05, (h) => h + 0.85, CI.conc); capAlong(pts, sg * o.med, 0.2, 0.85, CI.conc); }
  // sides: retaining wall to the ground, a fascia beam in front of every crossing
  for (const sg of [-1, 1]) {
    const q = offsetPts3(pts, sg * (o.w / 2 + 0.3));
    for (let i = 0; i + 1 < q.length; i++) {
      const cross = inCross((S[i] + S[i + 1]) / 2);
      emitQuadS(q[i][0], q[i][1], q[i + 1][0], q[i + 1][1], cross ? q[i][2] - 0.8 : 0, q[i][2] + 0.05, cross ? q[i + 1][2] - 0.8 : 0, q[i + 1][2] + 0.05, CI.conc);
    }
  }
  // ceiling + abutments at crossings
  for (const [a, b] of o.crossings) {
    const idx = pts.map((_, i) => i).filter((i) => S[i] >= a - 1e-6 && S[i] <= b + 1e-6);
    if (idx.length > 1) deckRibbon(pts.slice(idx[0], idx[idx.length - 1] + 1), o.w + 0.6, -0.8 + 0.05, CI.concD);
    for (const sv of [a, b]) { const i = S.findIndex((v) => v >= sv - 1e-6); if (i < 0) continue; const L = offsetPts3(pts, -(o.w / 2 + 0.3))[i], Rr = offsetPts3(pts, o.w / 2 + 0.3)[i]; emitQuadS(L[0], L[1], Rr[0], Rr[1], 0, L[2] - 0.8, 0, Rr[2] - 0.8, CI.concD); }
  }
  // paint
  if (o.paint) {
    for (const sg of [-1, 1]) { paintAlong(pts, sg * o.paint.edge, 0.13, 1, 0, 0.062, CI.white); if (o.paint.divider) paintAlong(pts, sg * o.paint.divider, 0.14, 1.6, 1.8, 0.062, CI.white); if (o.paint.inner) paintAlong(pts, sg * o.paint.inner, 0.13, 1, 0, 0.062, CI.white); }
    if (o.paint.center) paintAlong(pts, 0, 0.11, 1.0, 3.0, 0.062, CI.white);
  }
}
function sampleAxis(axis, c, lo, hi, hfn, step = 3) {
  const out = []; for (let v = lo; v <= hi + 1e-6; v += step) { const vv = Math.min(v, hi); out.push(axis === 'x' ? [vv, c, hfn(vv)] : [c, vv, hfn(vv)]); } if (out.length && (axis === 'x' ? out[out.length - 1][0] : out[out.length - 1][1]) < hi - 1e-6) out.push(axis === 'x' ? [hi, c, hfn(hi)] : [c, hi, hfn(hi)]); return out;
}
// motorway causeways
const MOTOR_CROSS = { M1: [0], M2: [M1_Z, 0] };   // axis coordinates where another road passes underneath
for (const [ref, axis, c, up, hfn] of [['M1', 'x', M1_Z, M1_UP, hM1], ['M2', 'z', M2_X, M2_UP, hM2]]) for (const [a, b] of up) {
  const pts = sampleAxis(axis, c, a, b, hfn, 3), S = arcLen(pts), s0 = axis === 'x' ? pts[0][0] : pts[0][1];
  const crossings = MOTOR_CROSS[ref].map((v) => [v - 7.4 - s0, v + 7.4 - s0]).filter(([x0, x1]) => x1 > 0 && x0 < S[S.length - 1]).map(([x0, x1]) => [Math.max(0, x0), Math.min(S[S.length - 1], x1)]);
  structureDeck(pts, { w: 2 * (MW - 0.5), med: CLS.motorway.median / 2, crossings, paint: { edge: MW - 1.1, divider: CLS.motorway.median / 2 + CLS.motorway.lane, inner: CLS.motorway.median / 2 + 0.3 } });
  STRUCT.ribbons.push({ id: ref, w: 2 * (MW - 0.5), p: pts.map((q) => [R2(q[0]), R2(q[1]), R2(q[2])]) });
  // solid body: ground floor is closed under the walls where the deck is higher than 0.3 m, except under the crossing roads
  for (const [x0, x1] of intervalsAbove(hfn, a, b, 0.3)) for (const [y0, y1] of subtractIntervals(x0, x1, MOTOR_CROSS[ref].map((v) => [v - 8, v + 8]))) STRUCT.blockers.push(axis === 'x' ? [y0, c - MW - 0.6, y1, c + MW + 0.6] : [c - MW - 0.6, y0, c + MW + 0.6, y1]);
}
// ramps with heights
const rampPts = [];   // {ic, kind, pts3}
for (const ic of PLAN.interchanges) {
  const done = [];
  const order = [...ic.ramps.keys()].sort((p, q) => (/slip/.test(ic.ramps[p].kind) ? 1 : 0) - (/slip/.test(ic.ramps[q].kind) ? 1 : 0));
  for (const ri of order) {
    const r = ic.ramps[ri], pts = r.pts, S = arcLen(pts), L = S[S.length - 1], near = (pt) => { let best = null, bd = 1e9; for (const d of done) for (const q of d.p3) { const dd = Math.hypot(q[0] - pt[0], q[1] - pt[1]); if (dd < bd) { bd = dd; best = q; } } return best && bd < 4 ? best[2] : 0; };
    const slip = /slip/.test(r.kind);
    const hs = slip && r.attach[0] === 'ramp' ? near(pts[0]) : lookupH(pts[0][0], pts[0][1]), he = slip && r.attach[1] === 'ramp' ? near(pts[pts.length - 1]) : lookupH(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    const knots = [[0, hs]];
    const bridge = (r.bridges || [])[0];
    let sBr = null;
    if (bridge) { const mid = [(bridge[0][0] + bridge[1][0]) / 2, (bridge[0][1] + bridge[1][1]) / 2]; let bi = 0, bd = 1e9; pts.forEach((q, i) => { const d = Math.hypot(q[0] - mid[0], q[1] - mid[1]); if (d < bd) { bd = d; bi = i; } }); sBr = S[bi]; knots.push([Math.max(8, sBr - 9), 5.0], [Math.min(L - 8, sBr + 9), 5.0]); }
    knots.push([L, he]);
    const kf = (s) => { for (let i = 0; i + 1 < knots.length; i++) if (s <= knots[i + 1][0]) { const t = (s - knots[i][0]) / Math.max(1e-6, knots[i + 1][0] - knots[i][0]); return knots[i][1] + (knots[i + 1][1] - knots[i][1]) * Math.min(1, Math.max(0, t)); } return knots[knots.length - 1][1]; };
    const hf = smoothFn(kf, 0, L, 1, 3);
    const p3 = pts.map((q, i) => [q[0], q[1], hf(S[i])]);
    done.push({ p3 }); rampPts.push({ ic: ic.id, kind: r.kind, p3, bridge: sBr, S });
    rampsOut.push({ ic: ic.id, kind: r.kind, pts: p3.map((q) => [R2(q[0]), R2(q[1]), R2(q[2])]) });
    // surface
    deckRibbon(p3, CLS.ramp.w, 0.052, CI.asph);
    const hMax = Math.max(...p3.map((q) => q[2]));
    for (const sg of [-1, 1]) {
      const q = offsetPts3(p3, sg * (CLS.ramp.w / 2 + 0.2));
      for (let i = 0; i + 1 < q.length; i++) {
        const h0 = q[i][2], h1 = q[i + 1][2];
        if (Math.max(h0, h1) < 0.3) continue;
        const cross = sBr != null && Math.abs((S[i] + S[i + 1]) / 2 - sBr) < 9;
        emitQuadS(q[i][0], q[i][1], q[i + 1][0], q[i + 1][1], cross ? h0 - 0.6 : 0, h0 + 0.05, cross ? h1 - 0.6 : 0, h1 + 0.05, CI.conc);
        if (Math.max(h0, h1) > 1.2) emitQuadS(q[i][0], q[i][1], q[i + 1][0], q[i + 1][1], h0 + 0.05, h0 + 0.8, h1 + 0.05, h1 + 0.8, CI.conc);
      }
      if (hMax > 1.2) addParapets(p3.filter((v) => v[2] > 1.0), sg * (CLS.ramp.w / 2 + 0.2));
    }
    paintAlong(p3, 0, 0.1, 1.0, 3.0, 0.064, CI.white);
    for (const sg of [-1, 1]) paintAlong(p3, sg * (CLS.ramp.w / 2 - 0.2), 0.1, 1, 0, 0.064, CI.white);
    STRUCT.ribbons.push({ id: ic.id + '.' + r.kind, w: CLS.ramp.w - 0.2, p: p3.map((q) => [R2(q[0]), R2(q[1]), R2(q[2])]) });
  }
}
// river bridges (flat decks with a slab, parapets and piers), M1 over the river
{
  const riverXat = (z) => PLAN.water.river.pts.reduce((b, p) => Math.abs(p[1] - z) < Math.abs(b[1] - z) ? p : b)[0];
  const br = [];
  for (const e of PLAN.edges) if (e.bridge === 'river') { const z = N.get(e.a).z, rx = riverXat(z), half = hw(e.cls) + CLS[e.cls].sidewalk; br.push({ axis: 'x', c: z, a: rx - PLAN.water.river.w / 2 - 3.2, b: rx + PLAN.water.river.w / 2 + 3.2, half }); }
  { const rx = riverXat(M1_Z); br.push({ axis: 'x', c: M1_Z, a: rx - PLAN.water.river.w / 2 - 6, b: rx + PLAN.water.river.w / 2 + 6, half: MW }); }
  for (const b of br) {
    const lo = b.c - b.half, hi = b.c + b.half;
    deckRibbon([[b.a, b.c, 0], [b.b, b.c, 0]], 2 * b.half, -0.75, CI.concD);
    emitQuadS(b.a, lo, b.b, lo, -0.75, 0.12, -0.75, 0.12, CI.conc); emitQuadS(b.a, hi, b.b, hi, -0.75, 0.12, -0.75, 0.12, CI.conc);
    for (const z of [lo + 0.1, hi - 0.1]) { emitQuadS(b.a, z, b.b, z, 0.12, 1.0, 0.12, 1.0, CI.conc); emitRect('r', 'q', b.a, z - 0.15, b.b, z + 0.15, 1.0, CI.conc); }
    for (const fx of [b.a + (b.b - b.a) * 0.3, b.a + (b.b - b.a) * 0.7]) box3(fx - 0.5, lo + 0.6, fx + 0.5, hi - 0.6, -2.6, -0.75, CI.concD, false);
  }
}
// footbridges
for (const f of PLAN.footbridges) {
  const isRiver = f.over === 'река', over = f.over.startsWith('М') ? MW + 3 : isRiver ? 12 : hw('arterial') + CLS.arterial.sidewalk + 1.2;
  const top = isRiver ? 2.4 : 5.1, g = isRiver ? 0.1 : 0.12, ramp = top / g, half = over + ramp, lat = f.id === 'FB3' || f.id === 'FB4' ? 3.6 : 0;
  const hfn = smoothFn((s) => Math.max(0, Math.min(top, top - g * (Math.abs(s) - over))), -half - 4, half + 4, 1, 2);
  const pts = []; for (let s = -half; s <= half + 1e-6; s += 3) pts.push(f.axis === 'x' ? [f.at[0] + s, f.at[1] + lat, hfn(s)] : [f.at[0] + lat, f.at[1] + s, hfn(s)]);
  const S = arcLen(pts);
  deckRibbon(pts, 2.4, 0, CI.conc);
  for (const sg of [-1, 1]) { const off = sg * 1.25; wallAlong(pts, off, (h) => h + 0.02, (h) => h + 1.1, CI.conc); capAlong(pts, off, 0.15, 1.1, CI.conc); wallAlong(pts, off, (h) => Math.max(0, h - 0.55), (h) => h, CI.concD); addParapets(pts.filter((q) => q[2] > 0.8), off); }
  deckRibbon(pts, 2.4, -0.55, CI.concD);
  // columns: at the ends of the span, and every 9 m under the ramps (higher than 0.8 m)
  for (let i = 0; i < pts.length; i += 3) { const q = pts[i]; if (q[2] > 0.8) box3(q[0] - 0.3, q[1] - 0.3, q[0] + 0.3, q[1] + 0.3, 0, q[2] - 0.55, CI.concD, false); }
  STRUCT.ribbons.push({ id: f.id, w: 2.0, p: pts.map((q) => [R2(q[0]), R2(q[1]), R2(q[2])]) });
  void S;
}

// ---- 7. landscape: base grass, areas, blocks, fields, forests, water
const SZ = PLAN.size;
{
  // base grass in 5 m squares with a deterministic tint (cheap mottling)
  const rnd = mulberry(7);
  for (let x = Math.floor(SZ.x0 / 10) * 10; x < SZ.x1; x += 10) for (let z = Math.floor(SZ.z0 / 10) * 10; z < SZ.z1; z += 10) {
    emitRect('g', 'q', x, z, x + 10, z + 10, H.base, CI.grass); void rnd;
  }
  const KIND = { forest: 'forest', industry: 'industry', verge: 'verge', park: 'park', parking: 'parking', embankment: 'embank', beach: 'beach', promenade: 'promenade', port: 'port', urban: 'urban' };
  const KORDER = ['urban', 'industry', 'verge', 'park', 'parking', 'embankment', 'port', 'beach', 'promenade', 'forest'];
  for (const a of PLAN.areas) emitPoly('g', a.poly, -0.075 + KORDER.indexOf(a.kind) * 0.002, CI[KIND[a.kind]]);
  const ZONE = { residential: 'resid', mixed: 'mixed', cbd: 'cbd', industrial: 'indus', logistics: 'indus', railyard: 'indus', station: 'station', busterm: 'station', villas: 'villas', school: 'school', hospital: 'hospital', park: 'park', market: 'market', east: 'mixed', stadium: 'stadium', campus: 'school', waterfront: 'waterf' };
  for (const b of PLAN.blocks) { const r = b.lot || b.rect; emitRect('g', 'q', r[0], r[1], r[2], r[3], H.zone2, CI[ZONE[b.zone] || 'resid']); }
  // fields in strips
  const triOf = (poly) => { const v = poly.map((p) => new THREE.Vector2(p[0], p[1])); return THREE.ShapeUtils.triangulateShape(v, []).map((t) => t.map((i) => poly[i])); };
  for (const f of PLAN.rural.fields) {
    const xs = f.poly.map((p) => p[0]), zs = f.poly.map((p) => p[1]), n = f.strips || 2, tris = triOf(f.poly);
    for (let k = 0; k < n; k++) {
      const ci = CI['field' + ((f.crop + k) % 4)];
      const rect = f.angle === 0 ? [Math.min(...xs), Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * k / n, Math.max(...xs), Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * (k + 1) / n] : [Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * k / n, Math.min(...zs), Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * (k + 1) / n, Math.max(...zs)];
      for (const t of tris) { const poly = clipPoly(t, rect[0], rect[1], rect[2], rect[3]); if (poly.length < 3) continue; for (let i = 1; i + 1 < poly.length; i++) emitTri('g', poly[0], poly[i], poly[i + 1], -0.06, ci); }
    }
  }
  for (const f of PLAN.rural.forests) emitPoly('g', f, -0.058, CI.forest);
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
const blocked = (x, z, pad = 0.6) => !!(rasterAt(x, z) || rasterAt(x + pad, z) || rasterAt(x - pad, z) || rasterAt(x, z + pad) || rasterAt(x, z - pad) || ringAt(x, z) || rangeRamp(x, z) || railBlocked(x, z) || STRUCT.blockers.some((b) => x > b[0] - 1 && x < b[2] + 1 && z > b[1] - 1 && z < b[3] + 1)) || isWater(x, z);
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
  const t0 = trimAt(lowNode, e) + 3, t1 = trimAt(highNode, e) + 3, step = lampsPer[e.cls], cuts = furnCuts(e);
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
furniture.cat = furnCat;
for (const [kind, list] of Object.entries(furniture)) for (const f of list) { const c = cellOf(Math.floor(f[0] / CELL), Math.floor(f[1] / CELL)).f[kind]; for (const v of f) c.push(typeof v === 'number' ? R2(v) : v); }

// ---- 10. graph (for tests and later steps), walkable floor
const graph = {
  nodes: PLAN.nodes.map((n) => [n.id, n.x, n.z, n.kind || '']),
  edges: PLAN.edges.map((e) => { const a = N.get(e.a), b = N.get(e.b); return [e.id, e.a, e.b, e.cls, a.x, a.z, b.x, b.z, e.name || '']; }),
  rings: ringsOut.map((r) => [r.id, r.at[0], r.at[1], r.R, r.Ri]),
  minis: minisOut.map((r) => [r.id, r.at[0], r.at[1], r.R, r.Ri]),
  ramps: rampsOut.map((r) => [r.ic, r.kind, r.pts.map((p) => [R2(p[0]), R2(p[1]), R2(p[2] || 0)])]),
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
  for (const L of ['g', 'r', 'p', 'd']) { const l = {}; for (const [s, arr] of Object.entries(c[L])) if (arr.length) l[s] = arr; if (Object.keys(l).length) o[L] = l; }
  const f = {}; for (const [s, arr] of Object.entries(c.f)) if (arr.length) f[s] = arr; if (Object.keys(f).length) o.f = f;
  cellsOut[k] = o;
}
const data = { struct: { ...STRUCT, deckH: DECKH, clear: CLEAR, slope: SLOPE, railY: RAIL_Y }, version: 1, cell: CELL, size: SZ, classes: Object.fromEntries(Object.entries(CLS).map(([k, c]) => [k, [c.w, c.sidewalk, c.median, c.lanes]])), colors: PAL.map((k) => COLORS[k]), palette: CI, heights: H, cells: cellsOut, graph, floor: floorData, counts: PLAN.counts };
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
  // ---- levels: the ground (land minus sea / river / solid bodies of embankments and causeways) and the walkable ribbons of decks, ramps and footbridges
  var S=D.struct, blk=S.blockers, rib=S.ribbons;
  for(var ri=0;ri<rib.length;ri++){var r=rib[ri],x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;for(var k=0;k<r.p.length;k++){var q=r.p[k];if(q[0]<x0)x0=q[0];if(q[0]>x1)x1=q[0];if(q[1]<z0)z0=q[1];if(q[1]>z1)z1=q[1];}r.bb=[x0-r.w,z0-r.w,x1+r.w,z1+r.w];}
  D.ground=function(x,z){if(!D.floor(x,z))return false;for(var i=0;i<blk.length;i++){var b=blk[i];if(x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3])return false;}return true;};
  // heights of every walkable surface above (x, z): [0 if ground] + ribbon heights (a ribbon counts inside its half width)
  D.surfaces=function(x,z){
    var out=[];if(D.ground(x,z))out.push(0);
    for(var i=0;i<rib.length;i++){var r=rib[i],bb=r.bb;if(x<bb[0]||x>bb[2]||z<bb[1]||z>bb[3])continue;var p=r.p,hw=r.w/2,best=1e9,bh=0;
      for(var k=0;k+1<p.length;k++){var a=p[k],b=p[k+1],dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l)):0,d=Math.hypot(x-(a[0]+dx*t),z-(a[1]+dz*t));if(d<best){best=d;bh=a[2]+(b[2]-a[2])*t;}}
      if(best<=hw)out.push(bh);}
    return out;
  };
  // the surface the player stands on: the highest one not more than step above hint (the current level), else the lowest above
  D.surfaceY=function(x,z,hint,step){step=step==null?.75:step;var s=D.surfaces(x,z),best=null;for(var i=0;i<s.length;i++)if(s[i]<=hint+step&&(best==null||s[i]>best))best=s[i];if(best==null&&s.length){best=s[0];for(i=1;i<s.length;i++)if(s[i]<best)best=s[i];}return best;};
  // underside of the lowest deck above a point that stands at y (camera clearance); null when open sky
  D.overhead=function(x,z,y){var s=D.surfaces(x,z),low=null;for(var i=0;i<s.length;i++)if(s[i]>y+1.6&&(low==null||s[i]<low))low=s[i];return low==null?null:low-.8;};
  D.access=function(x,z,m){m=m==null?.65:m;if(!D.surfaces(x,z).length)return false;for(var i=0;i<8;i++){var a=i*Math.PI/4;if(!D.surfaces(x+Math.cos(a)*m,z+Math.sin(a)*m).length)return false;}return true;};
  D.cellKey=function(x,z){return Math.floor(x/D.cell)+','+Math.floor(z/D.cell);};
})(window.PlanCDataV161);
`;
const text = '// Generated by tools/masterplan/compile-plan-c.mjs from tools/masterplan/plan-C.json (masterplan C, step C1); do not edit.\nwindow.PlanCDataV161=' + JSON.stringify(data) + ';' + FLOOR_FN;

if (process.argv.includes('--stats')) {
  let q = 0, t = 0, w = 0; for (const c of Object.values(cellsOut)) for (const L of ['g', 'r', 'p', 'd']) { q += (c[L]?.q?.length || 0) / 6; t += (c[L]?.t?.length || 0) / 8; w += (c[L]?.w?.length || 0) / 7; }
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
