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
  grass: 0x5f8f48, grassB: 0x6a9a50, lawn: 0x76a85c, park: 0x5f8f48, lawnG: 0x568041, forest: 0x3f6d37, field0: 0x9a9a52, field1: 0x6f9b45, field2: 0xb0a45a, field3: 0x7e9a4a, field4: 0x8f7a4c,
  urban: 0x5f8f48, industry: 0x8d8f86, verge: 0x5f8f48, parking: 0x43484d, embank: 0x8b9566, beach: 0xdac99b, promenade: 0xcfc6b2, port: 0x9fa09a,
  sea: 0x3f7fae, seaLight: 0x7fb7d2, river: 0x4a88b4, bank: 0xb9ae8c, dirt: 0x8d7a58,
  asph: 0x353a3f, ramp: 0x353a3f, walk: 0xc4bfae, kerb: 0xaaa595, median: 0xb8b4a4, medLawn: 0x6f9d57, medM: 0xa9a99f, plaza: 0xd4cab4, islandL: 0x558140, islandC: 0xd9d1bb,
  conc: 0xbdb9ad, concD: 0x8d8a82, sleeper: 0x4a3f36, white: 0xf2f2ec, yellow: 0xe7c85a, ballast: 0x8a8782, rail: 0x56585b, platform: 0xb8b5aa, moleC: 0x9b9a92, rock: 0x77756f,
  resid: 0x82b064, mixed: 0x95b57a, cbd: 0xaaa898, indus: 0x70757a, school: 0x90bd72, hospital: 0xa4b88e, station: 0xa9a79b, villas: 0x78b45f, waterf: 0xa6b88f, market: 0xb4ae98, stadium: 0x6fae55,
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
const push = (arr, ...v) => { for (const n of v) arr.push(R3(n)); };   // 3 decimals: layer heights differ by 3 mm (kerb-return fillet over the sidewalk) and must survive the rounding

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
function emitPoly(layer, poly, y, ci, holes = []) {   // arbitrary simple polygon (+ holes) -> triangles; an axis-aligned rectangle is a rect (a triangulation diagonal left a hairline crack across big lots / port apron, 2026-10-19)
  if (!holes.length && poly.length === 4) { const xs = poly.map((q) => q[0]), zs = poly.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs); if (poly.every((q) => (q[0] === x0 || q[0] === x1) && (q[1] === z0 || q[1] === z1))) { emitRect(layer, 'q', x0, z0, x1, z1, y, ci); return; } }
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
function offsetVar(pts, offs) {   // like offsetPts3 with a different sideways offset at every vertex
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; out.push([pts[i][0] - dz * offs[i], pts[i][1] + dx * offs[i], pts[i][2]]); }
  return out;
}
function asymRibbon(pts, offL, offR, dy, ci) {   // road surface with its own left / right edge offsets per vertex (merge tapers)
  const L = offsetVar(pts, offL), Rr = offsetVar(pts, offR);
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = [L[i][0], L[i][2] + dy, L[i][1]], B = [Rr[i][0], Rr[i][2] + dy, Rr[i][1]], C = [L[i + 1][0], L[i + 1][2] + dy, L[i + 1][1]], D = [Rr[i + 1][0], Rr[i + 1][2] + dy, Rr[i + 1][1]];
    emitTri3(A, B, C, ci); emitTri3(B, D, C, ci);
  }
}
function capAlong(pts, o, w, dy, ci, from = 0, to = pts.length - 1) { const sub = pts.slice(from, to + 1); deckRibbon(offsetPts3(sub, o), w, dy, ci); }
function paintAlong(pts, o, w, dash, gap, dy, ci) {   // dashed (or solid when gap = 0) line on a deck.  Dashed: whole dashes only, the row centred in the run (2026-10-19: no clipped stubs at the ends)
  const q = offsetPts3(pts, o);
  if (!gap) { if (q.length > 1) deckRibbon(q, w, dy, ci); return; }
  const S = [0]; for (let i = 1; i < q.length; i++) S.push(S[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]));
  const total = S[S.length - 1], n = Math.floor((total + gap) / (dash + gap)); if (n < 1) return;
  const at = (sv) => { let i = 1; while (i < S.length - 1 && S[i] < sv) i++; const a = q[i - 1], b = q[i], t = (sv - S[i - 1]) / Math.max(1e-9, S[i] - S[i - 1]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
  const start = (total - (n * dash + (n - 1) * gap)) / 2;
  for (let k = 0; k < n; k++) {
    const s0 = start + k * (dash + gap), s1 = s0 + dash, cur = [at(s0)];
    for (let i = 0; i < S.length; i++) if (S[i] > s0 + 1e-6 && S[i] < s1 - 1e-6) cur.push(q[i]);
    cur.push(at(s1)); deckRibbon(cur, w, dy, ci);
  }
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
const BENDS = new Map((PLAN.bends || []).map((b) => [b.node, b])), bendR = (id) => (BENDS.get(id) ? BENDS.get(id).R : 0);   // two-leg corners are drawn as circular bends, the straight edges stop at the tangent points
const hw = (cls) => CLS[cls].w / 2;
// ---- lane-drop transitions: where a street changes class at a node with only two legs (no junction), the wider carriageway narrows over L = 20 x offset (1:20 on each side)
const TRANS = new Map(), TRANS_LIST = [];
for (const n of PLAN.nodes) {
  if (n.legs !== 2) continue;
  const es = PLAN.edges.filter((e) => (e.a === n.id || e.b === n.id) && !e.split); if (es.length !== 2 || es[0].dir !== es[1].dir || es[0].cls === es[1].cls) continue;
  const [wide, narrow] = CLS[es[0].cls].w >= CLS[es[1].cls].w ? es : [es[1], es[0]]; if (CLS[wide.cls].w - CLS[narrow.cls].w < 0.05) continue;
  const L = Math.round(20 * (CLS[wide.cls].w - CLS[narrow.cls].w) / 2), other = wide.a === n.id ? wide.b : wide.a, on = N.get(other), sgn = Math.sign(wide.dir === 'z' ? on.z - n.z : on.x - n.x);
  TRANS.set(n.id + ':' + wide.id, { L, wide, narrow, node: n, sgn }); TRANS_LIST.push({ at: [n.x, n.z], axis: wide.dir, wide: wide.cls, narrow: narrow.cls, L, offset: (CLS[wide.cls].w - CLS[narrow.cls].w) / 2 });
}
const rightOf = (h) => [-h[1], h[0]];
const MW = CLS.motorway.w / 2;
const ringW = (j) => j.lanes === 2 ? 5.4 : 3.0;   // circulatory lane: 2 lanes 5.4 (>= 5.0), 1 lane 3.0 (car + truck swept path >= 2.6)
const laneW = (cls) => CLS[cls].lane || (CLS[cls].w - CLS[cls].median) / 2 / CLS[cls].lanes;
const RAIL_Z = PLAN.rail.pts[0][1], M1_Z = -240, M2_X = 250;
function trimAt(nodeId, e) {   // how far markings / medians stay away from a node
  if (BENDS.has(nodeId)) return BENDS.get(nodeId).R;   // the bend arc carries the markings from the tangent point on
  { const t = TRANS.get(nodeId + ':' + e.id); if (t) return t.L; }   // lane-drop: markings and the median start where the carriageway is full width again
  const n = N.get(nodeId), j = J.get(nodeId);
  if (!j) return n.legs && n.legs.length > 1 ? 1.5 : 0;
  if (j.type === 'roundabout') return j.R + 6.5;
  if (j.type === 'mini') return 8;
  const cross = j.arms.filter((a) => (a.dir[0] !== 0) !== (e.dir === 'x')).map((a) => hw(a.cls));
  const ch = cross.length ? Math.max(...cross) : 0;
  if (j.type === 'signal') return Math.max(ch, j.terminal ? (j.boxZ || 0) : 0) + (j.terminal && j.boxZ ? 3.8 : 5.2);   // diamond terminals: the median runs on to the stop line behind the corner fillets
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
const hM1 = smoothFn((x) => trap(Math.abs(x)), -330, 390), hM2 = smoothFn((z) => trap(Math.abs(z - M1_Z)), -390, 100);   // M2 rises only over M1 (I3); it is at ground level well before the at-grade crossing I2 (z -150 .. 88)
const intervalsAbove = (fn, lo, hi, th) => { const out = []; let a = null; for (let v = lo; v <= hi + 1e-9; v += 1) { const on = fn(v) > th; if (on && a == null) a = v; if (!on && a != null) { out.push([a, v]); a = null; } } if (a != null) out.push([a, hi]); return out; };
// Include the COMPLETE rounded toe, not only heights > 25 cm. Otherwise the
// flat asphalt stops at an elevated, uncapped edge: a visible grass slit.
const deckIntervals = (fn, lo, hi) => intervalsAbove(fn, lo, hi, 1e-6).map(([a, b]) => [Math.max(lo, a - 1), b]);
const M1_UP = deckIntervals(hM1, -300, 370), M2_UP = deckIntervals(hM2, -370, 88);
// raster cuts: the ground surface of a motorway disappears where its deck stands on a causeway (the crossing road keeps its own surface under the deck)
function cutsOf(e) {
  if (e.split) return [[-1e4, 1e4]];   // I2: the straight street is replaced by the split carriageways round the islands
  if (e.cls !== 'motorway') return [];
  return e.ref === 'M1' ? M1_UP : e.ref === 'M2' ? M2_UP.concat([[M2Z.z0, M2Z.z1 + 1]]) : [];   // M2: the zone round I2 .. I4 is drawn by drawM2Zone()
}
// old flat-crossing intervals, still used to keep lamps / trees away from the crossings
function furnCuts(e) {
  const cuts = [];
  if (e.split) cuts.push([-1e4, 1e4]);
  if (e.underRail != null && e.dir === 'z') cuts.push([e.underRail - 7, e.underRail + 7]);
  if (e.underMotorway === 'M1') cuts.push([M1_Z - MW - 0.8, M1_Z + MW + 0.8]);
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
const splitZones = [];   // outlines in which nothing random may stand (split-street branches, M2 zone)
const M2Z = { z0: -98, z1: 88, box: 18.5, flat3: -28, end3: 64, in0: 18.5 };   // M2 zone drawn by drawM2Zone(): third lane flat from z -28 to 64 (taper to z -98), inner edge closes from z 18.5 to 96
const mTrim = () => 0;
const edgeSpan = (e) => {   // along-axis span of the carriageway/sidewalk, trimmed to the chord of a roundabout
  const a = N.get(e.a), b = N.get(e.b), ax = e.dir === 'x' ? 0 : 1, lo = Math.min(a.x * (1 - ax) + a.z * ax, b.x * (1 - ax) + b.z * ax), hi = Math.max(a.x * (1 - ax) + a.z * ax, b.x * (1 - ax) + b.z * ax);
  const lowNode = (a.x * (1 - ax) + a.z * ax) <= (b.x * (1 - ax) + b.z * ax) ? e.a : e.b, highNode = lowNode === e.a ? e.b : e.a;
  const ch = (id) => { const j = roundAt(id); return j ? Math.sqrt(Math.max(0, j.R * j.R - hw(e.cls) ** 2)) - 0.12 : 0; };
  const mo = e.cls === 'motorway';
  const mt = () => 0;
  const tl = TRANS.get(lowNode + ':' + e.id), th = TRANS.get(highNode + ':' + e.id);   // the tapered end is drawn separately
  return { lo: lo + ch(lowNode) + mt(lowNode) + bendR(lowNode) + (tl ? tl.L : 0), hi: hi - ch(highNode) - mt(highNode) - bendR(highNode) - (th ? th.L : 0), lowNode, highNode, ax };
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
    const mlo = e.cls === 'motorway' ? lo0 : lo0 + t0, mhi = e.cls === 'motorway' ? hi0 : hi0 - t1;
    if (mhi - mlo > 1) for (const [lo, hi] of subtractIntervals(mlo, mhi, cuts)) put(lo, hi, -mh, mh, e.cls === 'motorway' ? 'medM' : 'med');
  }
}

// the tapers themselves: asphalt trapezoid, sidewalk trapezoids, kerb walls, a median nose and lane-drop arrows
function arrowH(x, z, hx, hz) {   // painted arrow at (x, z) pointing along the unit vector (hx, hz): stem + head
  const rx = -hz, rz = hx, P = (t, l) => [x + hx * t + rx * l, z + hz * t + rz * l];
  emitTri('p', P(-0.9, -0.09), P(-0.9, 0.09), P(0.4, -0.09), H.paint, CI.white); emitTri('p', P(-0.9, 0.09), P(0.4, 0.09), P(0.4, -0.09), H.paint, CI.white);
  emitTri('p', P(0.2, -0.5), P(0.2, 0.5), P(1.1, 0), H.paint, CI.white);
}

// ---- M2 between the I2 crossing and the trumpet I4, drawn as ONE smooth road (2026-10-19): every edge is a function of z (sampled each metre, a constant-slope taper with eased ends),
//      so the asphalt is one contour, the median closes in pointed noses, and every line starts / ends where its lane starts / ends.
//      third lane (aux): flat from z -28 to 64 on both carriageways (the exit lane of the trumpet ramp a / the entrance lane of ramp c), tapers away northwards over 70 m;
//      the inner lane closes southwards from z 18.5 to 96 (inner edge 1.1 -> 3.5, 1:34 mid slope), where the carriageways become the two trunk ramps (centre +-4.9).
{
  const c = M2_X, TRK2 = 4.9, K = 0.25;
  const f = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t < K ? t * t / (2 * K * (1 - K)) : t > 1 - K ? 1 - (1 - t) * (1 - t) / (2 * K * (1 - K)) : (t - K / 2) / (1 - K);   // constant slope with parabolic ends
  const L3N = 70, IN = 3.5 - 1.1, BOX = M2Z.box;
  const lane3 = (z) => z >= M2Z.flat3 ? (z <= M2Z.end3 ? 1 : 0) : 1 - f((M2Z.flat3 - z) / L3N);
  const outerA = (z) => 6.3 + 2.1 * lane3(z);                      // asphalt edge (shoulder included)
  const inner = (z) => {                                           // median half width
    const a = Math.abs(z);
    if (a <= BOX) return 0;
    const nose = a < BOX + 8 ? 1.1 * (3 * ((a - BOX) / 8) ** 2 - 2 * ((a - BOX) / 8) ** 3) : 1.1;
    return z > BOX + 8 ? 1.1 + IN * f((z - M2Z.in0 - 8) / (M2Z.z1 - M2Z.in0 - 8)) : nose;
  };
  const zs = []; for (let z = M2Z.z0; z < M2Z.z1 + 0.01; z += 1) zs.push(z);
  const X = (sg, lat) => c + sg * lat;
  for (let i = 0; i + 1 < zs.length; i++) {
    const za = zs[i], zb = zs[i + 1];
    if (za >= -BOX && zb <= BOX) {   // the junction box: full width, no median (0.05 m overlap with the lanes at both ends: no hairline crack on the shared edge)
      const ya = za <= -BOX + 1e-6 ? za - 0.05 : za, yb = zb >= BOX - 1e-6 ? zb + 0.05 : zb;
      emitTri('r', [X(-1, outerA(za)), ya], [X(1, outerA(za)), ya], [X(-1, outerA(zb)), yb], H.asph, CI.asph); emitTri('r', [X(1, outerA(za)), ya], [X(1, outerA(zb)), yb], [X(-1, outerA(zb)), yb], H.asph, CI.asph); continue;
    }
    for (const sg of [-1, 1]) {
      const a0 = [X(sg, outerA(za)), za], a1 = [X(sg, outerA(zb)), zb], b0 = [X(sg, inner(za)), za], b1 = [X(sg, inner(zb)), zb];
      emitTri('r', a0, b0, a1, H.asph, CI.asph); emitTri('r', b0, b1, a1, H.asph, CI.asph);
      if (inner(za) > 0.02 || inner(zb) > 0.02) emitWall(b0[0], b0[1], b1[0], b1[1], H.asph, H.med, CI.kerb);
    }
    if (inner(za) > 0.02 || inner(zb) > 0.02) { const m0 = inner(za), m1 = inner(zb); emitTri('r', [X(-1, m0), za], [X(1, m0), za], [X(-1, m1), zb], H.med, CI.lawnG); emitTri('r', [X(1, m0), za], [X(1, m1), zb], [X(-1, m1), zb], H.med, CI.lawnG); }
  }
  splitZones.push([[c - 9, M2Z.z0], [c + 9, M2Z.z0], [c + 9, M2Z.z1], [c - 9, M2Z.z1]]);   // nothing random may stand on it
  // paint: polylines along the profile, continuous or dashed, per carriageway
  const line = (fn, z0, z1, step = 1) => { const o = []; for (let z = z0; z <= z1 + 1e-6; z += step) o.push([z, fn(z)]); return o; };
  const ribbonZ = (sg, pts, dh = 0) => { if (pts.length > 1) ribbon('p', pts.map(([z, lat]) => [X(sg, lat), z]), 0.16, H.paint + dh, CI.white); };
  const runOn = (sg, fn, z0, z1) => { ribbonZ(sg, line(fn, z0, M2Z.z1 - 0.5)); ribbonZ(sg, line(fn, M2Z.z1 - 1.5, z1), 0.07); };   // the last metres lie above the start of the trunk ramp's deck
  const dashZ = (sg, pts, dash = 1.6, gap = 1.8) => { let acc = 0, on = true, cur = []; const flush = () => { if (cur.length > 1 && Math.abs(cur[cur.length - 1][0] - cur[0][0]) > 0.8) ribbonZ(sg, cur); cur = []; };
    for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let s0 = 0; while (s0 < L) { const lim = on ? dash : gap, take = Math.min(L - s0, lim - acc); if (on) { if (!cur.length) cur.push([a[0] + (b[0] - a[0]) * s0 / L, a[1] + (b[1] - a[1]) * s0 / L]); cur.push([a[0] + (b[0] - a[0]) * (s0 + take) / L, a[1] + (b[1] - a[1]) * (s0 + take) / L]); } s0 += take; acc += take; if (acc >= lim - 1e-9) { if (on) flush(); on = !on; acc = 0; } } }
    flush(); };
  const zN = -BOX - 2, zS = BOX + 2, zdN = -BOX - 6, zdS = BOX + 6;   // solid lines stop 2 m short of the box; lane DASHES stop 6 m short (a dash never touches the stop line or the zebra)   // markings stop 2 m short of the box (the zebra / stop line zone starts there)
  for (const sg of [-1, 1]) {
    // median edge line (solid): from the nose tip on, following the inner edge
    runOn(sg, (z) => inner(Math.min(z, M2Z.z1)) + 0.2, zS - 1, M2Z.z1 + 1.5);
    ribbonZ(sg, line((z) => 1.35, zN - 70, zN));   // north: median edge line at 1.35 (the plain M2 profile)
    // third-lane edge line (solid) 1.0 inside the asphalt edge: north taper and flat part, ends at the exit gore (z 64)
    ribbonZ(sg, line((z) => outerA(z) - 1.0, M2Z.z0, zN)); ribbonZ(sg, line((z) => outerA(z >= M2Z.end3 ? M2Z.end3 : z) - 1.0, zS, M2Z.end3 + 0.3));
    // lane divider 3|2 at 5.3: dashed in the three-lane stretch, SOLID from the exit gore on, easing to the trunk ramp's edge line (6.1)
    { let zd = M2Z.z0; while (zd < zN && 2.1 * lane3(zd) < 0.7) zd += 1; dashZ(sg, line(() => 5.3, zd, zdN)); } dashZ(sg, line(() => 5.3, zdS, M2Z.end3 - 2));
    runOn(sg, (z) => 5.3 + 0.8 * f((z - M2Z.end3) / (M2Z.z1 - M2Z.end3)), M2Z.end3 - 2, M2Z.z1 + 1.5);
    // lane divider 2|1 at 3.2: dashed from the box until lane 1 has become too narrow (inner edge line within 0.45 m of it)
    let zEnd = zS; while (zEnd < M2Z.z1 && inner(zEnd) + 0.25 < 3.2 - 0.45) zEnd += 1;
    dashZ(sg, line(() => 3.2, zdS, zEnd)); dashZ(sg, line(() => 3.2, M2Z.z0 + 0, zdN));
  }
  // lane-drop arrows for the inner lane of the southbound (west) carriageway, bent towards the exit side
  for (const zA of [zS + 8, zS + 26]) { const lat = (inner(zA) + 3.2) / 2 + 0.1, ang = 12 * Math.PI / 180; arrowH(X(-1, lat), zA, -Math.sin(ang), Math.cos(ang)); }
}
for (const { L, wide, narrow, node, sgn } of TRANS.values()) {
  const hn = hw(narrow.cls), hd = hw(wide.cls), sn = CLS[narrow.cls].sidewalk, sd = CLS[wide.cls].sidewalk, ax = wide.dir, c = ax === 'z' ? node.x : node.z, mh = CLS[wide.cls].median / 2;
  const W = (t, lat) => ax === 'z' ? [c + lat, node.z + sgn * t] : [node.x + sgn * t, c + lat];
  const half = (t) => hn + (hd - hn) * t / L, outer = (t) => half(t) + sn + (sd - sn) * t / L;
  emitTri('r', W(0, -hn), W(0, hn), W(L, hd), H.asph, CI.asph); emitTri('r', W(0, -hn), W(L, hd), W(L, -hd), H.asph, CI.asph);
  for (const sg of [-1, 1]) {
    emitTri('r', W(0, sg * hn), W(0, sg * (hn + sn)), W(L, sg * (hd + sd)), H.walk, CI.walk); emitTri('r', W(0, sg * hn), W(L, sg * (hd + sd)), W(L, sg * hd), H.walk, CI.walk);
    const a = W(0, sg * hn), b = W(L, sg * hd); emitWall(a[0], a[1], b[0], b[1], H.asph, H.walk, CI.kerb); void outer;
  }
  if (mh > 0) {   // the median ends in a pointed nose 8 m into the taper
    emitTri('r', W(L, -mh), W(L, mh), W(L - 8, 0), H.med, CI.median);
    for (const sg of [-1, 1]) { const a = W(L, sg * mh), b = W(L - 8, 0); emitWall(a[0], a[1], b[0], b[1], H.asph, H.med, CI.kerb); }
  }
  // lane-drop arrows on the outer lane of the traffic that loses a lane (the approach from the wide side towards the node), bent 12 degrees towards the centre
  for (const sg of [-1, 1]) {
    const t = L + 9, lat = sg * (mh + CLS[wide.cls].lane * 1.5), dirT = -sgn, ang = 12 * Math.PI / 180, p = W(t, lat);
    const hv = ax === 'z' ? [-sg * Math.sin(ang), dirT * Math.cos(ang)] : [dirT * Math.cos(ang), -sg * Math.sin(ang)];
    arrowH(p[0], p[1], hv[0], hv[1]);
  }
}

// ---- 2. raster decomposition per cell -> disjoint rectangles + kerb walls
const TYPES = { carve: { h: 0.05, ci: -1, prio: 1.5 }, asph: { h: H.asph, ci: CI.asph, prio: 2 }, walk: { h: H.walk, ci: CI.walk, prio: 1 }, med: { h: H.med, ci: CI.median, prio: 3 }, medM: { h: H.med, ci: CI.lawnG, prio: 3 } };
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
  for (const r of rects) if (r.type !== 'carve') {
    if (r.type === 'walk') {
      // Terminal aprons cut the ACTUAL ramp footprint through the sidewalk.
      // Leaving the 12 cm pavement over a 5 cm ramp produced concrete stripes
      // across the drivable join, even when both asphalt surfaces connected.
      const pieces = walkAroundRamps(r);
      if (pieces) for (const poly of pieces) emitPoly('r', poly, H.walk, CI.walk);
      else emitRect('r', 'q', r.x0, r.z0, r.x1, r.z1, H.walk, CI.walk);
    } else emitRect('r', 'q', r.x0, r.z0, r.x1, r.z1, TYPES[r.type].h, TYPES[r.type].ci);
  }
  // kerbs: height steps between neighbouring grid cells (and to the open ground); the taller side emits the wall once
  const walls = new Map();
  const typeAt = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz) ? null : grid[j * nx + i];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const t = grid[j * nx + i]; if (!t || t === 'carve') continue;
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
    for (const w of merged) {
      const pts = ax === 'x' ? [[L, w.a0, 0], [L, w.a1, 0]] : [[w.a0, L, 0], [w.a1, L, 0]];
      for (const run of exposedRuns(pts, 0, 'kerb', 0.03)) for (let i = 1; i < run.length; i++)
        emitWall(run[i - 1][0], run[i - 1][1], run[i][0], run[i][1], w.y0, w.y1, CI.kerb);
    }
  }
}

// ---- 3. curved pieces: roundabouts, mini roundabouts, ramps, plaza
const ringsOut = [], minisOut = [], rampsOut = [], cornerOut = [];
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
    const Ri = 2.6, Ro = Ri + 3.0;   // island r 2.6, circulatory lane 3.0 (>= 2.6), painted outer edge
    disc('r', c, Ri, H.island + 0.03, CI.islandC, 24); disc('r', c, Ri - 0.25, H.island + 0.035, CI.islandL, 24);
    for (let k = 0; k < 24; k++) { const s = k / 24 * Math.PI * 2, e = (k + 1) / 24 * Math.PI * 2; emitWall(c[0] + Math.cos(s) * Ri, c[1] + Math.sin(s) * Ri, c[0] + Math.cos(e) * Ri, c[1] + Math.sin(e) * Ri, H.asph, H.island + 0.03, CI.kerb); }
    for (let a = 0; a < 360; a += 15) annulus('p', c, Ro - 0.07, Ro + 0.07, a, a + 9, H.paint, CI.white, 3);
    minisOut.push({ id: j.id, at: c, R: Ro, Ri });
  }
}
// kerb returns (radius 3): at every corner where two streets meet the sidewalk corner is a quarter disc (centre = the far corner of a 3 x 3 square, tangent to both kerb lines), the rest of the square is asphalt
// at asphalt height - the square is carved out of the sidewalk raster first, so nothing is drawn twice and no kerb outline crosses the carriageway
for (const j of PLAN.junctions) {
  if (j.type === 'roundabout' || j.bend) continue;
  const c = j.at, RET = 3.0;
  for (const A of j.arms.filter((a) => a.dir[1] === 0)) for (const B of j.arms.filter((b) => b.dir[0] === 0)) {
    if (A.cls === 'motorway' || B.cls === 'motorway' || CLS[A.cls].sidewalk <= 0 || CLS[B.cls].sidewalk <= 0) continue;
    const sx = A.dir[0], sz = B.dir[1], K = [c[0] + sx * hw(B.cls), c[1] + sz * hw(A.cls)], O = [K[0] + sx * RET, K[1] + sz * RET];
    addShape(Math.min(K[0], O[0]), Math.min(K[1], O[1]), Math.max(K[0], O[0]), Math.max(K[1], O[1]), 'carve');
    cornerOut.push({ K, O, sx, sz, RET });
    const arc = []; for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI / 2; arc.push([O[0] - sx * RET * Math.sin(t), O[1] - sz * RET * Math.cos(t)]); }
    for (let k = 0; k + 1 < arc.length; k++) {
      emitTri('r', K, arc[k], arc[k + 1], H.asph, CI.asph);       // asphalt between the corner and the arc
      emitTri('r', O, arc[k], arc[k + 1], H.walk, CI.walk);       // sidewalk corner: quarter disc
      emitWall(arc[k][0], arc[k][1], arc[k + 1][0], arc[k + 1][1], H.asph, H.walk, CI.kerb);
    }
  }
}

// ---- 3b. bends (2026-10-19): the two-leg corners are circular arcs, R = tangent length.  Asphalt, median, sidewalks, kerb walls and lane / centre dashes follow the arc;
//      the straight edges (edgeSpan) stop at the tangent points, so there is one continuous contour and no square corner.
const bendsOut = [];
function dashPoly(pts, dash, gap, w, y) {   // whole dashes only, centred (same rule as paintAlong)
  const S = [0]; for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = S[S.length - 1], n = Math.floor((total + gap) / (dash + gap)); if (n < 1) return;
  const at = (sv) => { let i = 1; while (i < S.length - 1 && S[i] < sv) i++; const a = pts[i - 1], b = pts[i], t = (sv - S[i - 1]) / Math.max(1e-9, S[i] - S[i - 1]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  const start = (total - (n * dash + (n - 1) * gap)) / 2;
  for (let k = 0; k < n; k++) { const s0 = start + k * (dash + gap), s1 = s0 + dash, cur = [at(s0)]; for (let i = 0; i < S.length; i++) if (S[i] > s0 + 1e-6 && S[i] < s1 - 1e-6) cur.push(pts[i].slice(0, 2)); cur.push(at(s1)); ribbon('p', cur, w, y, CI.white); }
}
for (const b of BENDS.values()) {
  const c = b.at, R = b.R, [A, B] = b.arms, cA = CLS[A.cls], cB = CLS[B.cls];
  const a = A.dir, d = B.dir, O = [c[0] + (a[0] + d[0]) * R, c[1] + (a[1] + d[1]) * R], u0 = [-d[0], -d[1]], u1 = [-a[0], -a[1]];   // arc from the tangent point on leg A (O + R u0) to the one on leg B (O + R u1)
  const NS = 28, EX = 0.06, pts = [], T = [];   // 0.06 m of overlap into the straight edges at both ends: no hairline crack on the shared edge
  pts.push([c[0] + a[0] * (R + EX), c[1] + a[1] * (R + EX), 0]); T.push(0);
  for (let k = 0; k <= NS; k++) { const t = k / NS * Math.PI / 2; pts.push([O[0] + R * (u0[0] * Math.cos(t) + u1[0] * Math.sin(t)), O[1] + R * (u0[1] * Math.cos(t) + u1[1] * Math.sin(t)), 0]); T.push(k / NS); }
  pts.push([c[0] + d[0] * (R + EX), c[1] + d[1] * (R + EX), 0]); T.push(1);
  const sm = (t) => t * t * (3 - 2 * t), lerp = (x, y, t) => x + (y - x) * sm(t);   // class change (a lane drop on the arc): eased, constant-ish slope
  const half = T.map((t) => lerp(cA.w / 2, cB.w / 2, t)), sw = T.map((t) => lerp(cA.sidewalk, cB.sidewalk, t)), mh = T.map((t) => lerp(cA.median / 2, cB.median / 2, t));
  const neg = (v) => v.map((x) => -x), add = (u, v) => u.map((x, i) => x + v[i]);
  const strip = (o0, o1, y, ci) => { const P0 = offsetVar(pts, o0), P1 = offsetVar(pts, o1); for (let i = 0; i + 1 < pts.length; i++) { emitTri('r', P0[i], P1[i], P0[i + 1], y, ci); emitTri('r', P1[i], P1[i + 1], P0[i + 1], y, ci); } };
  const wall = (o, y0, y1) => { const P = offsetVar(pts, o); for (let i = 0; i + 1 < P.length; i++) emitWall(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], y0, y1, CI.kerb); };
  strip(neg(half), half, H.asph, CI.asph);
  if (Math.max(...mh) > 0.02) { strip(neg(mh), mh, H.med, CI.median); wall(neg(mh), H.asph, H.med); wall(mh, H.asph, H.med); }
  if (Math.max(...sw) > 0.02) for (const sg of [-1, 1]) { const o0 = half.map((h) => sg * h), o1 = half.map((h, i) => sg * (h + sw[i])); strip(o0, o1, H.walk, CI.walk); wall(o0, H.asph, H.walk); }
  // paint (only on the arc proper, the extensions are skipped): arterial lane dashes while they stay clear of the kerb, collector centre dashes once the median has closed
  const arcIdx = pts.map((_, i) => i).filter((i) => i > 0 && i < pts.length - 1);
  if (Math.max(...mh) > 0.02) for (const sg of [-1, 1]) {   // arterial lane line at median / 2 + lane, only where it stays >= 0.7 m inside the kerb
    const o = T.map((t, i) => sg * (mh[i] + (cA.median > 0 ? cA : cB).lane)), P = offsetVar(pts, o);
    const keep = arcIdx.filter((i) => Math.abs(o[i]) < half[i] - 0.7);
    if (keep.length > 2) dashPoly(keep.map((i) => P[i]), 1.0, 1.4, 0.18, H.paint);
  }
  if (A.cls === 'collector' || B.cls === 'collector') { const centre = arcIdx.filter((i) => mh[i] < 0.05); if (centre.length > 2) dashPoly(centre.map((i) => pts[i]), 1.0, 1.2, 0.18, H.paint); }   // collector centre dashes once the median has closed
  bendsOut.push({ node: b.node, at: c, R, half: Math.max(...half), sw: Math.max(...sw) });
}

// ---- 4. markings of the straight streets
function dashed(axis, c, lo, hi, width, dash, gap, y, ci, phase = 0) {   // axis 'x': line along x at z = c.  Whole dashes only, the row centred in the span (2026-10-19: clipped 0.6 m stubs at the ends read as litter)
  const len = hi - lo, n = Math.floor((len + gap) / (dash + gap)); if (n < 1) return;
  const start = lo + (len - (n * dash + (n - 1) * gap)) / 2 + phase;
  for (let k = 0; k < n; k++) { const s = start + k * (dash + gap), e = s + dash; if (axis === 'x') emitRect('p', 'q', s, c - width / 2, e, c + width / 2, y, ci); else emitRect('p', 'q', c - width / 2, s, c + width / 2, e, y, ci); }
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
      for (const o of [-(mh + 0.3), mh + 0.3]) solid(ax, c + o, pl, ph, 0.18, H.paint, CI.white);
      for (const o of [-mdv, mdv]) dashed(ax, c + o, pl, ph, 0.18, 1.6, 1.8, H.paint, CI.white);
      for (const o of [-edge, edge]) solid(ax, c + o, pl, ph, 0.18, H.paint, CI.white);
    } else if (e.cls === 'arterial') {
      for (const o of [-(CLS.arterial.median / 2 + CLS.arterial.lane), CLS.arterial.median / 2 + CLS.arterial.lane]) dashed(ax, c + o, pl, ph, 0.18, 1.0, 1.4, H.paint, CI.white);
    } else if (e.cls === 'collector') dashed(ax, c, pl, ph, 0.18, 1.0, 1.2, H.paint, CI.white);
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
function arrow(c, dir, at, lat) {   // straight lane arrow on the incoming half of an arm, pointing at the junction: stem + head
  const r = [dir[1], -dir[0]], p = (t, l) => [c[0] + dir[0] * (at + t) + r[0] * (lat + l), c[1] + dir[1] * (at + t) + r[1] * (lat + l)];
  const q = [p(0.5, -0.09), p(0.5, 0.09), p(-0.5, 0.09), p(-0.5, -0.09)];
  emitTri('p', q[0], q[1], q[2], H.paint, CI.white); emitTri('p', q[0], q[2], q[3], H.paint, CI.white);
  emitTri('p', p(-0.45, -0.38), p(-0.45, 0.38), p(-1.15, 0), H.paint, CI.white);
}
const furniture = { lamp: [], sig: [], pole: [], plate: [], stop: [], cat: [] };   // world lists, then split into cells
const yawOf = (d) => Math.atan2(d[0], d[1]);
const crossingKey = new Set();
for (const cr of PLAN.crossings) {
  if (cr.arm) {
    const j = J.get(cr.id.split('-')[0]); if (!j) continue;
    const dir = cr.arm, cross = j.arms.filter((a) => (a.dir[0] !== 0) !== (dir[0] !== 0)).map((a) => hw(a.cls));
    const along = cr.setback != null ? cr.setback : Math.max(cross.length ? Math.max(...cross) : 0, j.boxZ || 0) + 2.2;
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
    const hx = Math.max(...j.arms.filter((a) => a.dir[0] === 0).map((a) => hw(a.cls)), j.terminal ? 1.0 : 0), hz = Math.max(...j.arms.filter((a) => a.dir[1] === 0).map((a) => hw(a.cls)), j.terminal ? 1.0 : 0, j.boxZ || 0);
    for (const a of j.arms) {
      const w = hw(a.cls), along = (a.dir[0] !== 0 ? hx : hz) + 2.2;
      if (!PLAN.crossings.some((cr) => cr.id.startsWith(j.id + '-') && cr.arm && cr.arm[0] === a.dir[0] && cr.arm[1] === a.dir[1])) zebra(c, a.dir, along, a.cls, 1.4);
      if (a.cls === 'ramp2') {   // diamond mouth: the arriving ramp has a full-width stop line and a head on each side; the departing one has neither
        if (a.ramp === 'off') {
          const rr = [a.dir[1], -a.dir[0]], p0 = [c[0] + a.dir[0] * (along + 1.7), c[1] + a.dir[1] * (along + 1.7)];
          emitRect('p', 'q', p0[0] - 0.2, p0[1] - w + 0.1, p0[0] + 0.2, p0[1] + w - 0.1, H.paint, CI.white);
          for (const sgn of [-1, 1]) furniture.sig.push([c[0] + a.dir[0] * (along + 1.2) + rr[0] * sgn * (w + 0.55), c[1] + a.dir[1] * (along + 1.2) + rr[1] * sgn * (w + 0.55), yawOf(a.dir)]);
        }
        continue;
      }
      if (a.cls === 'arterial' || a.cls === 'collector' || a.cls.startsWith('motorway')) stopLine(c, a.dir, along + 1.7, a.cls);
      if (a.cls === 'arterial' || a.cls.startsWith('motorway')) for (let k = 0; k < (a.cls === 'motorway3' ? 3 : 2); k++) arrow(c, a.dir, along + 6.5, CLS[a.cls].median / 2 + CLS[a.cls].lane * (k + 0.5));
      const r = [a.dir[1], -a.dir[0]];
      furniture.sig.push([c[0] + a.dir[0] * (along + 1.2) + r[0] * (w + 0.55), c[1] + a.dir[1] * (along + 1.2) + r[1] * (w + 0.55), yawOf(a.dir)]);
      if (a.cls.startsWith('motorway')) { const al = along + 1.2 + (a.cls === 'motorway3' ? 3.2 : 0); furniture.sig.push([c[0] + a.dir[0] * al - r[0] * (CLS[a.cls].median / 2 - 0.3), c[1] + a.dir[1] * al - r[1] * (CLS[a.cls].median / 2 - 0.3), yawOf(a.dir)]); }   // M2: the median is still a narrow nose 3 m behind the stop line - the head stands where it is wide enough   // second head on the median: two per approach
    }
  } else if (j.type === 'roundabout') {
    for (const a of j.arms) {
      const r = [a.dir[1], -a.dir[0]];
      furniture.pole.push([c[0] + a.dir[0] * (j.R + 1.2) + r[0] * (hw(a.cls) + 0.5), c[1] + a.dir[1] * (j.R + 1.2) + r[1] * (hw(a.cls) + 0.5), yawOf(a.dir), SIGN.yield]);
    }
    furniture.pole.push([c[0] + (j.R >= 12 ? 3.2 : 0), c[1], 0, SIGN.round]);
  }
}
// ---- 5b. I2: the street splits into two one-way carriageways round a green island on each side of the main road (the Svetlanovskaya Square scheme, simplified).
// West island: oval (round tip away from the crossing), east island: rounded rectangle; carriageway band 4.8 m = 2 lanes of 2.4, island half width 6, sidewalks outside,
// the band ends square at the M2 edge with 7 m kerb returns (right-turn corners), zebra + signal heads on every branch, stop line + arrows + lane dashes on the inbound one.
const SPLIT = { hz: 6, band: 4.8, walk: 2.6, R: 7 }, islandsOut = [];   // splitZones: outline of band + sidewalk of each island (nothing random may stand there)
{
  const xm = M2_X, mw = CLS.motorway3.w / 2;   // the junction is 3+3 lanes wide
  const rr = (xa, xb, hz, rcs, d, n = 8) => {   // rounded-rectangle outline, CCW from the right-bottom side; corner order TR, TL, BL, BR; offset d
    const cs = [[xb, hz, 0], [xa, hz, 90], [xa, -hz, 180], [xb, -hz, 270]], out = [];
    cs.forEach(([cx, cz, a0], k) => { const r = rcs[k], ccx = cx + (cx === xb ? -r : r), ccz = cz + (cz === hz ? -r : r); for (let i = 0; i <= n; i++) { const t = (a0 + 90 * i / n) * Math.PI / 180; out.push([ccx + Math.cos(t) * (r + d), ccz + Math.sin(t) * (r + d)]); } });
    return out;
  };
  const strip = (A, B, y, ci, keep = () => true) => { for (let i = 0; i < A.length; i++) { const j = (i + 1) % A.length; if (!keep([(A[i][0] + A[j][0] + B[i][0] + B[j][0]) / 4, (A[i][1] + A[j][1] + B[i][1] + B[j][1]) / 4])) continue; emitTri('r', A[i], B[i], A[j], y, ci); emitTri('r', B[i], B[j], A[j], y, ci); } };
  const wall = (A, y0, y1, ci, keep = () => true) => { for (let i = 0; i < A.length; i++) { const j = (i + 1) % A.length; if (keep([(A[i][0] + A[j][0]) / 2, (A[i][1] + A[j][1]) / 2])) emitWall(A[i][0], A[i][1], A[j][0], A[j][1], y0, y1, ci); } };
  for (const side of [-1, 1]) {   // -1 west, +1 east
    const nose = xm + side * (mw + SPLIT.band + 0.1 - 0.0) - side * 0.0, farX = side < 0 ? 212 : 286;   // island end on the crossing side / the far end
    const edgeM = xm + side * mw, noseX = edgeM + side * SPLIT.band;     // x of the island nose: one band width from the M2 edge
    const xa = Math.min(noseX, farX), xb = Math.max(noseX, farX), hz = SPLIT.hz;
    const small = 0.6, far = 6;   // both far ends are round (a stadium)
    const rcs = side < 0 ? [small, far, far, small] : [far, small, small, far];   // TR, TL, BL, BR
    const inner = rr(xa, xb, hz, rcs, 0), outerB = rr(xa, xb, hz, rcs.map((r, k) => (side < 0 ? (k === 0 || k === 3) : (k === 1 || k === 2)) ? 0.01 - SPLIT.band : r), SPLIT.band, 8);   // crossing-side corners of the band are SHARP (radius 0.01)
    // outer outline: sharp corners on the crossing side
    const outer = outerB;
    const nearM = (q) => Math.abs(q[0] - edgeM) < SPLIT.R - 0.05, tipStub = (q) => (side < 0 ? q[0] < farX + 1 : q[0] > farX - 1) && Math.abs(q[1]) < hw('arterial') + CLS.arterial.sidewalk + 0.3;
    strip(inner, outer, H.asph, CI.asph);
    // sidewalk ring outside the band (not at the street stub, not at the corners)
    const outer2 = rr(xa, xb, hz, rcs.map((r, k) => (side < 0 ? (k === 0 || k === 3) : (k === 1 || k === 2)) ? 0.01 - SPLIT.band - SPLIT.walk : r), SPLIT.band + SPLIT.walk, 8);
    // sidewalk: the round far end as a polygon strip, the straight parts as rectangles that stop exactly at the tangent point of the corner fillet
    const tipOnly = (q) => (side < 0 ? q[0] < farX + 6 + 0.01 : q[0] > farX - 6 - 0.01) && !tipStub(q);
    strip(outer, outer2, H.walk, CI.walk, tipOnly);
    wall(outer, H.asph, H.walk, CI.kerb, tipOnly);
    for (const sz of [-1, 1]) {
      const xA = side < 0 ? farX + 6 : edgeM + side * SPLIT.R, xB = side < 0 ? edgeM + side * SPLIT.R : farX - 6, z0 = sz * (hz + SPLIT.band), z1 = sz * (hz + SPLIT.band + SPLIT.walk);
      emitRect('r', 'q', xA, Math.min(z0, z1), xB, Math.max(z0, z1), H.walk, CI.walk);
      emitWall(xA, z0, xB, z0, H.asph, H.walk, CI.kerb);
    }
    // island: kerb, rim, lawn
    wall(inner, H.asph, H.island + 0.03, CI.kerb);
    const c0 = [(xa + xb) / 2, 0];
    for (let i = 0; i < inner.length; i++) { const j = (i + 1) % inner.length; emitTri('r', c0, inner[i], inner[j], H.island + 0.03, CI.islandC); }
    const lawn = rr(xa, xb, hz, rcs, -0.7);
    for (let i = 0; i < lawn.length; i++) { const j = (i + 1) % lawn.length; emitTri('r', c0, lawn[i], lawn[j], H.island + 0.035, CI.islandL); }
    splitZones.push(outer2.map((q) => [q[0], q[1]]));
    islandsOut.push({ side, poly: inner.map((q) => [R2(q[0]), R2(q[1])]), outer: outer.map((q) => [R2(q[0]), R2(q[1])]) });
    // kerb returns at the crossing: asphalt fillets between the band edge and the M2 edge
    for (const sz of [-1, 1]) {
      const K = [edgeM, sz * (hz + SPLIT.band)], Rr = SPLIT.R, O = [edgeM + side * Rr, sz * (hz + SPLIT.band + Rr)], arc = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI / 2; arc.push([O[0] - side * Rr * Math.sin(t), O[1] - sz * Rr * Math.cos(t)]); }
      for (let k = 0; k + 1 < arc.length; k++) { emitTri('r', K, arc[k], arc[k + 1], H.asph, CI.asph); emitWall(arc[k][0], arc[k][1], arc[k + 1][0], arc[k + 1][1], H.asph, H.walk, CI.kerb); }
      // sidewalk round the corner (the ring just outside the arc) and a landing strip along the M2 edge: the zebra over M2 ends on it
      const arc2 = []; for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI / 2; arc2.push([O[0] - side * (Rr - SPLIT.walk) * Math.sin(t), O[1] - sz * (Rr - SPLIT.walk) * Math.cos(t)]); }
      for (let k = 0; k + 1 < arc.length; k++) { emitTri('r', arc[k], arc2[k], arc[k + 1], H.walk, CI.walk); emitTri('r', arc2[k], arc2[k + 1], arc[k + 1], H.walk, CI.walk); }
      { const zA = sz * (hz + SPLIT.band + Rr), zB = sz * (hz + SPLIT.band + Rr + 16), xA = edgeM, xB = edgeM + side * SPLIT.walk;
        emitRect('r', 'q', Math.min(xA, xB), Math.min(zA, zB), Math.max(xA, xB), Math.max(zA, zB), H.walk, CI.walk);
        splitZones.push([[Math.min(xA, xB), Math.min(zA, zB)], [Math.max(xA, xB), Math.min(zA, zB)], [Math.max(xA, xB), Math.max(zA, zB)], [Math.min(xA, xB), Math.max(zA, zB)]]);
        emitWall(edgeM, zA, edgeM, zB, H.asph, H.walk, CI.kerb); }
    }
    // markings: zebra on both branches, stop line + arrows + lane dashes on the inbound one (west: south branch eastbound, east: north branch westbound)
    const inSz = side < 0 ? 1 : -1, zx = noseX - side * 3.2, sx = zx + side * 3.0;   // zebra in front of the nose, the stop line 3 m before it (away from M2)
    for (const sz of [-1, 1]) {
      const z0 = sz * hz, z1 = sz * (hz + SPLIT.band), lo = Math.min(z0, z1), hi = Math.max(z0, z1);
      for (let z = lo + 0.45; z < hi - 0.3; z += 0.9) emitRect('p', 'q', zx - 0.9, z - 0.25, zx + 0.9, z + 0.25, H.paint, CI.white);
      if (sz === inSz) {
        emitRect('p', 'q', sx - 0.2, lo + 0.1, sx + 0.2, hi - 0.1, H.paint, CI.white);
        const zc = sz * (hz + SPLIT.band / 2), xA = sx + side * 1.5, xB = farX - side * 6;
        dashed('x', zc, Math.min(xA, xB), Math.max(xA, xB), 0.18, 1.0, 1.4, H.paint, CI.white);
        for (const lat of [-1, 1]) arrow([sx + side * 10, zc + lat * 1.2], [side, 0], 0, 0);
        furniture.sig.push([sx + side * 0.8, sz * (hz + SPLIT.band + 0.7), yawOf([side, 0])], [sx + side * 0.8, sz * (hz - 0.7), yawOf([side, 0])]);
      } else {
        const zc = sz * (hz + SPLIT.band / 2), xA = zx + side * 3, xB = farX - side * 6;
        dashed('x', zc, Math.min(xA, xB), Math.max(xA, xB), 0.18, 1.0, 1.4, H.paint, CI.white);
        for (const lat of [-1, 1]) arrow([zx + side * 9, zc + lat * 1.2], [-side, 0], 0, 0);
      }
    }
    // a second arrow pair on every branch near the round end (direction of travel: inbound towards M2, outbound away from it)
    for (const sz of [-1, 1]) { const zc = sz * (hz + SPLIT.band / 2), xt = farX - side * 6 + side * 0, dirT = sz === inSz ? [side, 0] : [-side, 0]; for (const lat of [-1, 1]) arrow([xt - side * 4, zc + lat * 1.2], dirT, 0, 0); }
    // bus shelters on the outer sidewalk of both branches (line B1 runs through the crossing), facing the carriageway
    for (const [sz, t] of [[1, 0.42], [-1, 0.58]]) { const xA = side < 0 ? farX + 6 : edgeM + side * SPLIT.R, xB = side < 0 ? edgeM + side * SPLIT.R : farX - 6, px = xA + (xB - xA) * t; furniture.stop.push([R2(px), R2(sz * (hz + SPLIT.band + 1.75)), sz > 0 ? Math.PI : 0, 'B1']); }
    // furniture on the island: lamps along the axis, a few trees
    for (const t of [0.22, 0.5, 0.78]) furniture.lamp.push([R2(xa + (xb - xa) * t), 0, 0]);
    for (const [t, zz] of [[0.14, 0], [0.34, 2.4], [0.34, -2.4], [0.66, 2.4], [0.66, -2.4], [0.86, 0]]) { const px = xa + (xb - xa) * t; cellOf(Math.floor(px / CELL), Math.floor(zz / CELL)).f.tree.push(R2(px), R2(zz), R2(0.9 + 0.2 * Math.abs(Math.sin(px))), R2(Math.abs(Math.cos(px * 3))));
    }
  }
}
for (const cr of PLAN.crossings) if (cr.kind === 'ped-signal-midblock') {
  const w = hw(cr.cls), d = cr.axis === 'x' ? [1, 0] : [0, 1], r = [d[1], -d[0]];
  for (const sgn of [-1, 1]) furniture.sig.push([cr.at[0] + r[0] * sgn * (w + 0.6) + d[0] * 1.2, cr.at[1] + r[1] * sgn * (w + 0.6) + d[1] * 1.2, yawOf([-r[0] * sgn, -r[1] * sgn])]);
}

// ---- 6. rail: the main line stands on a 5.2 m embankment, streets and the M2 run through openings (4.5 m headroom), the station widens it
const RAIL_Y = 5.2;
// The station approach is a parallel street at z=-108 (asphalt starts at -110).
// A 14 m half-width buried that street inside the embankment. Four tracks fit
// inside +/-5.8 m; two 2.8 m platforms at +/-6.2..9.0 fit a 9.5 m half-width,
// leaving the required 0.5 m from the station retaining wall to the asphalt.
const STATION_HALF = 9.5, PLATFORM_IN = 6.2, PLATFORM_OUT = 9.0;
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
  const X0 = -330, X1 = 330, zoneHalf = (x) => (x > stRail.x0 - 4 && x < stRail.x1 + 4) ? STATION_HALF : 5;
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
  for (const xe of [stRail.x0 - 4, stRail.x1 + 4]) for (const sg of [-1, 1]) emitQuadS(xe, RAIL_Z + sg * 5, xe, RAIL_Z + sg * STATION_HALF, 0, RAIL_Y, 0, RAIL_Y, CI.conc);   // step where the station widens the embankment
  // tracks: rails + sleepers
  const track = (zz, x0, x1) => {
    for (const o of [-0.6, 0.6]) emitRect('g', 'q', x0, zz + o - 0.07, x1, zz + o + 0.07, RAIL_Y + 0.035, CI.rail);
    for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.5) emitRect('g', 'q', x - 0.17, zz - 1.0, x + 0.17, zz + 1.0, RAIL_Y + 0.012, CI.sleeper);
  };
  for (const zz of [RAIL_Z - 1.6, RAIL_Z + 1.6]) { track(zz, X0, stRail.x0 - 4); track(zz, stRail.x1 + 4, X1); }
  for (const zz of [RAIL_Z - 4.8, RAIL_Z - 1.6, RAIL_Z + 1.6, RAIL_Z + 4.8]) track(zz, stRail.x0 - 4, stRail.x1 + 4);
  emitRect('g', 'q', stRail.x0 + 2, RAIL_Z - PLATFORM_OUT, stRail.x1 - 2, RAIL_Z - PLATFORM_IN, RAIL_Y + 0.1, CI.platform);
  emitRect('g', 'q', stRail.x0 + 2, RAIL_Z + PLATFORM_IN, stRail.x1 - 2, RAIL_Z + PLATFORM_OUT, RAIL_Y + 0.1, CI.platform);
  for (const z of [RAIL_Z - PLATFORM_OUT, RAIL_Z - PLATFORM_IN, RAIL_Z + PLATFORM_IN, RAIL_Z + PLATFORM_OUT]) emitQuadS(stRail.x0 + 2, z, stRail.x1 - 2, z, RAIL_Y, RAIL_Y + 0.1, RAIL_Y, RAIL_Y + 0.1, CI.conc);
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
  const q = offsetPts3(pts, o); let start = 0;
  const emit = (i) => { const a = q[start], b = q[i]; STRUCT.rails.push([R2(a[0]), R2(a[1]), R2(b[0]), R2(b[1]), R2((a[2] + b[2]) / 2 + (level0 || 0))]); start = i; };
  for (let i = 1; i < q.length; i++) {
    const a = q[start], b = q[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    // Long chords of tight curves cut INSIDE the lane although the drawn wall
    // follows its edge. Subdivide only where the approximation exceeds 10 cm.
    let error = 0;
    for (let j = start + 1; j < i; j++) error = Math.max(error, Math.abs(dx * (q[j][1] - a[1]) - dz * (q[j][0] - a[0])) / (len || 1));
    if (error > 0.1 && i > start + 1) emit(i - 1);
    if (len >= 10 || i === q.length - 1) emit(i);
  }
}
// Resolve ALL ramp profiles before drawing any boundaries. A motorway and its
// slip lane share an asphalt envelope; neither may put a wall across the join.
const rampPts = [];
const motorHosts = [
  { id: 'M1', axis: 0, c: M1_Z, lo: -300, hi: 370, h: hM1 },
  { id: 'M2', axis: 1, c: M2_X, lo: -370, hi: 88, h: hM2 },
];
const motorHost = (p) => motorHosts.reduce((a, b) => Math.abs(p[1 - a.axis] - a.c) <= Math.abs(p[1 - b.axis] - b.c) ? a : b);
function projectPath(p, path) {
  let best = null, distance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b[0] - a[0], dz = b[1] - a[1], ll = dx * dx + dz * dz;
    const t = ll ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / ll)) : 0;
    const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
    if (d < distance) { distance = d; best = a[2] + (b[2] - a[2]) * t; }
  }
  return { h: best || 0, distance };
}
function constrainRampProfile(p3, S, fixed, label) {
  // Keep attachment levels exact without increasing the established 7% grade
  // limit. The envelopes are cones from ALL fixed samples, not a forward-only
  // clamp that could silently detach the far end or lower a bridge opening.
  const grade = 0.0685, anchors = p3.map((p, i) => fixed[i] ? [S[i], p[2]] : null).filter(Boolean);
  const bounds = S.map((s) => [Math.max(0, ...anchors.map(([v, h]) => h - grade * Math.abs(s - v))), Math.min(...anchors.map(([v, h]) => h + grade * Math.abs(s - v)))]);
  for (let i = 0; i < p3.length; i++) {
    const [lo, hi] = bounds[i]; if (lo > hi + 1e-6) throw new Error(label + ': infeasible attachment heights / grade at ' + S[i]);
    p3[i][2] = Math.max(lo, Math.min(hi, p3[i][2]));
  }
  for (let pass = 0; pass < 32; pass++) {
    const src = p3.map((p) => p[2]);
    for (let i = 1; i < p3.length - 1; i++) if (!fixed[i]) {
      const t = (S[i] - S[i - 1]) / (S[i + 1] - S[i - 1]);
      const h = src[i] * 0.5 + (src[i - 1] * (1 - t) + src[i + 1] * t) * 0.5;
      p3[i][2] = Math.max(bounds[i][0], Math.min(bounds[i][1], h));
    }
    for (const direction of [1, -1]) for (let j = 1; j < p3.length; j++) {
      const i = direction > 0 ? j : p3.length - 1 - j, prev = i - direction, delta = grade * Math.abs(S[i] - S[prev]);
      if (!fixed[i]) p3[i][2] = Math.max(p3[prev][2] - delta, Math.min(p3[prev][2] + delta, p3[i][2]));
    }
    // Round the crest at the end of a held auxiliary lane. Penalising only
    // neighbour heights tends to converge to a sharp V at a fixed sample.
    for (const direction of [1, -1]) for (let j = 2; j < p3.length; j++) {
      const i = direction > 0 ? j : p3.length - 1 - j, prev = i - direction, prev2 = i - 2 * direction;
      if (fixed[i]) continue;
      const ds = Math.abs(S[i] - S[prev]), slope = (p3[prev][2] - p3[prev2][2]) / Math.abs(S[prev] - S[prev2]);
      const change = 0.018 * ds, lo = p3[prev][2] + Math.max(-grade, slope - change) * ds, hi = p3[prev][2] + Math.min(grade, slope + change) * ds;
      p3[i][2] = Math.max(bounds[i][0], Math.min(bounds[i][1], Math.max(lo, Math.min(hi, p3[i][2]))));
    }
  }
}
for (const ic of PLAN.interchanges) {
  const done = [];
  const order = [...ic.ramps.keys()].sort((a, b) => Number(/slip/.test(ic.ramps[a].kind)) - Number(/slip/.test(ic.ramps[b].kind)));
  for (const ri of order) {
    const r = ic.ramps[ri], pts = r.pts, S = arcLen(pts), L = S.at(-1);
    const ends = [0, pts.length - 1].map((i, k) => {
      const type = r.attach[k], p = pts[i], host = type === 'motorway' ? motorHost(p) : null;
      const parent = type === 'ramp' ? done.reduce((best, d) => !best || projectPath(p, d.p3).distance < projectPath(p, best.p3).distance ? d : best, null) : null;
      return { type, host, parent, h: host ? host.h(p[host.axis]) : parent ? projectPath(p, parent.p3).h : 0 };
    });
    const knots = [[0, ends[0].h], [L, ends[1].h]];
    // Hold the motorway's level through the actual taper, then descend to the
    // terminal. Previously an on-ramp could already be below its host road.
    const attached = ends.map((end, k) => {
      if (!end.host && !end.parent) return 0;
      const h = end.host, indices = [...pts.keys()]; if (k) indices.reverse();
      let last = indices[0];
      for (const i of indices) {
        const p = pts[i];
        // Include the PARALLEL auxiliary lane, not just the initial taper.
        // I2's acceleration lane and I4's deceleration lane overlap here;
        // different heights would put one ramp's parapet through the other.
        if (h ? Math.abs(p[1 - h.axis] - h.c) > MW + CLS.ramp.w / 2 + 0.005 || p[h.axis] < h.lo || p[h.axis] > h.hi || (r.holdLow && h.h(p[h.axis]) > 0.35) : projectPath(p, end.parent.p3).distance > CLS.ramp.w + 0.005) break;   // diamond ramps hold the host level only where the carriageway is still at ground
        last = i;
      }
      if (last !== indices[0]) knots.push([S[last], h ? h.h(pts[last][h.axis]) : projectPath(pts[last], end.parent.p3).h]);
      return k ? L - S[last] : S[last];
    });
    const bridge = (r.bridges || [])[0]; let sBr = null;
    if (bridge) {
      const mid = [(bridge[0][0] + bridge[1][0]) / 2, (bridge[0][1] + bridge[1][1]) / 2];
      let bi = 0; pts.forEach((p, i) => { if (Math.hypot(p[0] - mid[0], p[1] - mid[1]) < Math.hypot(pts[bi][0] - mid[0], pts[bi][1] - mid[1])) bi = i; });
      sBr = S[bi]; knots.push([Math.max(8, sBr - 9), 5], [Math.min(L - 8, sBr + 9), 5]);
    }
    knots.sort((a, b) => a[0] - b[0]);
    const kf = (s) => {
      for (let i = 1; i < knots.length; i++) if (s <= knots[i][0]) {
        const a = knots[i - 1], b = knots[i], t = Math.max(0, Math.min(1, (s - a[0]) / Math.max(1e-6, b[0] - a[0])));
        return a[1] + (b[1] - a[1]) * t;
      }
      return ends[1].h;
    };
    const hf = smoothFn(kf, 0, L, 1, 6);
    const p3 = pts.map((p, i) => {
      let h = hf(S[i]);
      for (const k of [0, 1]) {
        const end = ends[k], s = k ? L - S[i] : S[i], hold = attached[k];
        const sv = k ? L - hold : hold, j = S.reduce((best, v, n) => Math.abs(v - sv) < Math.abs(S[best] - sv) ? n : best, 0);
        const targetAt = (q) => end.host ? end.host.h(q[end.host.axis]) : end.parent ? projectPath(q, end.parent.p3).h : 0;
        const t = Math.max(0, Math.min(1, (s - hold) / Math.min(48, L / 3))), blend = t * t * (3 - 2 * t);
        // Add a LOCAL endpoint correction, rather than multiplying an entire
        // climbing profile by a fade (which artificially steepens loop ramps).
        if (s <= hold + 1e-6) h = targetAt(p);
        else h += (targetAt(pts[j]) - hf(sv)) * (1 - blend);
      }
      return [p[0], p[1], h];
    });
    constrainRampProfile(p3, S, pts.map((_, i) => i === 0 || i === pts.length - 1 ||
      ends.some((e, k) => (e.host || e.parent) && (k ? L - S[i] : S[i]) <= attached[k] + 1e-6) ||
      (sBr != null && Math.abs(S[i] - sBr) < 4)), ic.id + '.' + ri);
    const path = { id: ic.id + '.' + ri, ic: ic.id, kind: r.kind, p3, bridge: sBr, S, attach: r.attach, mouth: r.mouth, holdLow: r.holdLow, flare: r.flare, noWedge: r.noWedge };
    done.push(path); rampPts.push(path);
    rampsOut.push({ ic: ic.id, kind: r.kind, pts: p3.map((p) => [R2(p[0]), R2(p[1]), R3(p[2])]) });
  }
}

// Spatial index of paved corridors, including ground-level terminal roads.
// Height-aware clipping preserves the barrier on an overpass above another
// road. Sampling + bisection splits runs at joins; never filter vertices and
// reconnect across an opening (that used to create invisible collider chords).
const roadIndex = new Map(), INDEX_CELL = 16;
// Per-vertex edge offsets of every ramp: the merge wedge onto a parallel host (outer edge converges on the host kerb), and the widened mouth of a diamond terminal (2.8 -> 6 m over 22 m)
const rampOffs = new Map();
for (const { id, p3, attach, mouth, S, flare, noWedge } of rampPts) {
  const offL = p3.map(() => -CLS.ramp.w / 2), offR = p3.map(() => CLS.ramp.w / 2), dashed = [p3.map(() => false), p3.map(() => false)];
  const adjL = p3.map(() => 0), adjR = p3.map(() => 0), skipL = p3.map(() => false), skipR = p3.map(() => false);
  for (const k of [0, 1]) {
    if (flare && flare.includes(k)) {   // an exit / entrance lane that IS M2's third lane at its start: the ramp starts as wide as lane + shoulder (outer edge at 8.4) and narrows to its own width over 32 m
      const i0 = k ? p3.length - 1 : 0, step = k ? -1 : 1, outerLat = 2.1 + 6.3, dEnd = Math.abs(p3[i0][0] - M2_X);
      const sideOut = (() => { const a = p3[Math.min(p3.length - 1, i0 + 1)], b = p3[Math.max(0, i0 - 1)], nx = -(a[1] - b[1]); return Math.sign(nx * (Math.sign(p3[i0][0] - M2_X) || 1)) || 1; })();
      for (let i = i0, acc = 0; i >= 0 && i < p3.length && acc < 70; i += step) {
        const t = Math.max(0, 1 - acc / 32), e1 = t * t * (3 - 2 * t), w = 1.4 + (outerLat - dEnd - 1.4) * e1;   // eased flare back to the ramp's own width
        if (acc < 32) { if (sideOut > 0) { offR[i] = Math.max(offR[i], w); adjR[i] = -0.8 * e1; } else { offL[i] = Math.min(offL[i], -w); adjL[i] = 0.8 * e1; } }   // the outer line eases from M2's edge line (shoulder 1.0) to its own
        if (sideOut > 0) skipL[i] = true; else skipR[i] = true;   // the host-side edge line is M2's own (lane divider / edge line) for the first 70 m
        if (i + step >= 0 && i + step < p3.length) acc += Math.hypot(p3[i + step][0] - p3[i][0], p3[i + step][1] - p3[i][1]);
      }
      continue;
    }
    if (noWedge && noWedge.includes(k)) continue;   // a trunk ramp IS the carriageway: no merge wedge, its edge lines continue M2's
    const type = attach[k]; if (type !== 'motorway' && type !== 'cross') continue;
    const i0 = k ? p3.length - 1 : 0, step = k ? -1 : 1, p = p3[i0], q = p3[i0 + step];
    let host = null;
    if (type === 'motorway') { const m = motorHost(p); host = { axis: m.axis, c: m.c, Hw: MW }; }
    else {
      const e = PLAN.edges.find((x) => { if (x.cls === 'motorway') return false; const a = N.get(x.a), b = N.get(x.b), ax = x.dir === 'x' ? 0 : 1, lat = ax === 0 ? a.z : a.x, lo = Math.min(ax === 0 ? a.x : a.z, ax === 0 ? b.x : b.z), hi = Math.max(ax === 0 ? a.x : a.z, ax === 0 ? b.x : b.z); return Math.abs(p[1 - ax] - lat) <= hw(x.cls) + 0.8 && p[ax] >= lo - 0.01 && p[ax] <= hi + 0.01; });
      if (e) host = { axis: e.dir === 'x' ? 0 : 1, c: e.dir === 'x' ? N.get(e.a).z : N.get(e.a).x, Hw: hw(e.cls) };
    }
    if (!host) continue;
    const tl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    if (Math.abs(q[host.axis] - p[host.axis]) / tl < 0.8) continue;   // square-on terminals stay as they are
    const lat = (v) => v[1 - host.axis] - host.c, dEnd = Math.abs(lat(p)), dTouch = host.Hw + CLS.ramp.w / 2;
    if (dEnd >= dTouch - 0.2) continue;
    const sideOut = (() => { const a = p3[Math.min(p3.length - 1, i0 + 1)], b = p3[Math.max(0, i0 - 1)], dx = a[0] - b[0], dz = a[1] - b[1], n = [-dz, dx]; return Math.sign(n[1 - host.axis] * (Math.sign(lat(p)) || 1)) || 1; })();
    for (let i = i0; i >= 0 && i < p3.length; i += step) {
      const d = Math.abs(lat(p3[i]));
      if (d >= dTouch + 1e-6) break;
      const outer = Math.max(host.Hw, Math.min(d + CLS.ramp.w / 2, host.Hw + CLS.ramp.w * (d - dEnd) / (dTouch - dEnd)));
      if (sideOut > 0) { offR[i] = outer - d; dashed[0][i] = true; } else { offL[i] = -(outer - d); dashed[1][i] = true; }
    }
  }
  if (mouth != null) {   // terminal mouth: both edges flare symmetrically
    const L = S[S.length - 1];
    for (let i = 0; i < p3.length; i++) { const ds = mouth ? L - S[i] : S[i]; if (ds >= 22) continue; const t = 1 - ds / 22, w = CLS.ramp.w / 2 + (CLS.ramp2.w / 2 - CLS.ramp.w / 2) * t * t * (3 - 2 * t); offL[i] = Math.min(offL[i], -w); offR[i] = Math.max(offR[i], w); }
  }
  rampOffs.set(id, { offL, offR, dashed, adjL, adjR, skipL, skipR });
}
const rampMasks = [];
for (const r of rampPts) {
  const ro = rampOffs.get(r.id), l = offsetVar(r.p3, ro.offL), rr = offsetVar(r.p3, ro.offR);
  for (let i = 1; i < r.p3.length; i++) if (Math.min(r.p3[i - 1][2], r.p3[i][2]) < 0.2) {
    const p = [l[i - 1], rr[i - 1], rr[i], l[i]].map((v) => v.slice(0, 2));
    rampMasks.push({ p, x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), z0: Math.min(...p.map((q) => q[1])), z1: Math.max(...p.map((q) => q[1])) });
  }
}
function walkAroundRamps(rect) {
  const masks = rampMasks.filter((m) => m.x1 > rect.x0 && m.x0 < rect.x1 && m.z1 > rect.z0 && m.z0 < rect.z1);
  if (!masks.length) return null;
  let pieces = [[[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x1, rect.z1], [rect.x0, rect.z1]]];
  const halfPlane = (poly, a, b, sign, inside) => {
    const out = [], d = (p) => ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) * sign * (inside ? 1 : -1);
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], dp = d(p), dq = d(q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  for (const mask of masks) {
    const next = [], sign = Math.sign(area2(mask.p));
    for (const poly of pieces) {
      let rest = poly;
      for (let i = 0; i < mask.p.length && rest.length >= 3; i++) {
        const a = mask.p[i], b = mask.p[(i + 1) % mask.p.length], outside = halfPlane(rest, a, b, sign, false);
        if (outside.length >= 3 && Math.abs(area2(outside)) > 1e-6) next.push(outside);
        rest = halfPlane(rest, a, b, sign, true);
      }
    }
    pieces = next;
  }
  return pieces;
}
function indexRoad(id, pts, w, cutEnd = false) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], half = w / 2;
    const segment = { id, a, b, half, first: i === 1, last: i === pts.length - 1 || cutEnd && i >= pts.length - 8, dx: b[0] - a[0], dz: b[1] - a[1] };
    segment.ll = segment.dx ** 2 + segment.dz ** 2;
    for (let x = Math.floor((Math.min(a[0], b[0]) - half - 1) / INDEX_CELL); x <= Math.floor((Math.max(a[0], b[0]) + half + 1) / INDEX_CELL); x++)
      for (let z = Math.floor((Math.min(a[1], b[1]) - half - 1) / INDEX_CELL); z <= Math.floor((Math.max(a[1], b[1]) + half + 1) / INDEX_CELL); z++) {
        const key = x + ',' + z; if (!roadIndex.has(key)) roadIndex.set(key, []); roadIndex.get(key).push(segment);
      }
  }
}
for (const h of motorHosts) indexRoad(h.id, sampleAxis(h.axis === 0 ? 'x' : 'z', h.c, h.lo, h.axis !== 0 && Math.abs(h.c - M2_X) < 1 ? Math.min(h.hi, M2Z.z1) : h.hi, h.h, 1), CLS.motorway.w, h.axis !== 0 && Math.abs(h.c - M2_X) < 1);   // M2 ends where the trunk ramps start: they paint their own edge lines from there on
for (const r of rampPts) indexRoad(r.id, r.p3, CLS.ramp.w);
for (const e of PLAN.edges) if (e.cls !== 'motorway') {
  const a = N.get(e.a), b = N.get(e.b); indexRoad(e.id, [[a.x, a.z, 0], [b.x, b.z, 0]], CLS[e.cls].w);
}
function coveredRoad(p, own, margin = 0.2, body = false) {
  const segments = roadIndex.get(Math.floor(p[0] / INDEX_CELL) + ',' + Math.floor(p[1] / INDEX_CELL)) || [];
  return segments.some((s) => {
    if (s.id === own || !s.ll || own === 'kerb' && !/^I[1-4]\./.test(s.id)) return false;
    let t = ((p[0] - s.a[0]) * s.dx + (p[1] - s.a[1]) * s.dz) / s.ll;
    if (t < 0 && s.first || t > 1 && s.last) return false;
    // Internal vertices share a cap: treating every polyline segment as an
    // isolated butt-ended rectangle leaves tiny uncut wedges on outside bends.
    t = Math.max(0, Math.min(1, t));
    const h = s.a[2] + (s.b[2] - s.a[2]) * t;
    if (body === 'barrier') { if (h < p[2] - 1.25 || h > p[2] + 1.1) return false; }
    else if (body) { if (h < -0.1 || h > p[2] + 0.15) return false; }
    else if (Math.abs(h - p[2]) > 0.15) return false;
    return Math.hypot(p[0] - s.a[0] - s.dx * t, p[1] - s.a[1] - s.dz * t) < s.half + margin;
  });
}
function exposedRuns(pts, off, own, margin = 0.2, body = false) {
  const q = offsetPts3(pts, off), runs = []; let run = [];
  const flush = () => { if (run.length > 1) runs.push(run); run = []; };
  const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1], b = q[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    let prev = a, visible = !coveredRoad(a, own, margin, body);
    if (visible && !run.length) run.push(a);
    for (let j = 1; j <= n; j++) {
      const p = mix(a, b, j / n), next = !coveredRoad(p, own, margin, body);
      if (next !== visible) {
        let lo = prev, hi = p;
        for (let k = 0; k < 10; k++) { const mid = mix(lo, hi, 0.5); if (!coveredRoad(mid, own, margin, body) === visible) lo = mid; else hi = mid; }
        const edge = mix(lo, hi, 0.5);
        if (visible) { run.push(edge); flush(); } else run.push(edge);
      }
      if (next && j === n) run.push(p);
      prev = p; visible = next;
    }
    if (!visible) flush();
  }
  flush(); return runs;
}
function structureDeck(pts, o) {   // o = {w (surface), halfOuter, med (median half or 0), crossings: [[s0,s1]] along arc length, paint: {edge, divider}, kerbC, walls: true}
  const S = arcLen(pts);
  const inCross = (s) => o.crossings.some(([a, b]) => s > a && s < b);
  deckRibbon(pts, o.w, 0.05, CI.asph);
  // parapets (both sides) + caps
  for (const sg of [-1, 1]) for (const run of exposedRuns(pts, sg * (o.w / 2 + 0.15), o.id, 0.3, 'barrier')) {
    wallAlong(run, 0, (h) => h + 0.05, (h) => h + 0.05 + Math.min(0.9, h * 3), CI.conc);
    // The cap follows the same taper as the concrete face at the ground toe.
    deckRibbon(run.map((p) => [p[0], p[1], p[2] + Math.min(0.9, p[2] * 3)]), 0.3, 0.05, CI.conc);
    addParapets(run.filter((p) => p[2] > 0.2), 0);
  }
  if (o.med) for (const sg of [-1, 1]) {
    wallAlong(pts, sg * o.med, (h) => h + 0.05, (h) => h + 0.05 + Math.min(0.8, h * 3), CI.conc);
    capAlong(pts.map((p) => [p[0], p[1], p[2] + Math.min(0.8, p[2] * 3)]), sg * o.med, 0.2, 0.05, CI.conc);
  }
  // sides: retaining wall to the ground, a fascia beam in front of every crossing
  for (const sg of [-1, 1]) {
    const q = offsetPts3(pts, sg * (o.w / 2 + 0.3));
    for (let i = 0; i + 1 < q.length; i++) {
      const cross = inCross((S[i] + S[i + 1]) / 2);
      for (const run of exposedRuns([q[i], q[i + 1]], 0, o.id, 0.3, !cross))
        wallAlong(run, 0, (h) => cross ? h - 0.8 : 0, (h) => h + 0.05, cross ? CI.concD : CI.conc);
    }
  }
  // cornice: a pale band along the deck edge so the slab reads as a bridge from below
  for (const sg of [-1, 1]) for (const run of exposedRuns(pts, sg * (o.w / 2 + 0.42), o.id, 0.4)) capAlong(run, 0, 0.5, 0.07, CI.conc);
  // ceiling + abutments at crossings
  for (const [a, b] of o.crossings) {
    const idx = pts.map((_, i) => i).filter((i) => S[i] >= a - 1e-6 && S[i] <= b + 1e-6);
    if (idx.length > 1) deckRibbon(pts.slice(idx[0], idx[idx.length - 1] + 1), o.w + 0.6, -0.8 + 0.05, CI.concD);
    for (const sv of [a, b]) { const i = S.findIndex((v) => v >= sv - 1e-6); if (i < 0) continue; const L = offsetPts3(pts, -(o.w / 2 + 0.3))[i], Rr = offsetPts3(pts, o.w / 2 + 0.3)[i]; emitQuadS(L[0], L[1], Rr[0], Rr[1], 0, L[2] - 0.8, 0, Rr[2] - 0.8, CI.concD); }
  }
  // paint
  if (o.paint) {
    for (const sg of [-1, 1]) { for (const run of exposedRuns(pts, sg * o.paint.edge, o.id, 0.05)) paintAlong(run, 0, 0.18, 1, 0, 0.062, CI.white); if (o.paint.divider) paintAlong(pts, sg * o.paint.divider, 0.18, 1.6, 1.8, 0.062, CI.white); if (o.paint.inner) paintAlong(pts, sg * o.paint.inner, 0.18, 1, 0, 0.062, CI.white); }
    if (o.paint.center) paintAlong(pts, 0, 0.16, 1.0, 3.0, 0.062, CI.white);
  }
}
function sampleAxis(axis, c, lo, hi, hfn, step = 3, extra = []) {
  const vs = new Set(); for (let v = lo; v < hi; v += step) vs.add(R3(v)); vs.add(R3(hi)); for (const e of extra) if (e > lo + 0.3 && e < hi - 0.3) vs.add(R3(e));
  return [...vs].sort((a, b) => a - b).map((v) => axis === 'x' ? [v, c, hfn(v)] : [c, v, hfn(v)]);
}
// motorway causeways
const MOTOR_CROSS = { M1: [0], M2: [M1_Z] };   // axis coordinates where another road passes underneath
for (const [ref, axis, c, up, hfn] of [['M1', 'x', M1_Z, M1_UP, hM1], ['M2', 'z', M2_X, M2_UP, hM2]]) for (const [a, b] of up) {
  const pts = sampleAxis(axis, c, a, b, hfn, 3, MOTOR_CROSS[ref].flatMap((v) => [v - 7.4, v + 7.4])), S = arcLen(pts), s0 = axis === 'x' ? pts[0][0] : pts[0][1];
  const crossings = MOTOR_CROSS[ref].map((v) => [v - 7.4 - s0, v + 7.4 - s0]).filter(([x0, x1]) => x1 > 0 && x0 < S[S.length - 1]).map(([x0, x1]) => [Math.max(0, x0), Math.min(S[S.length - 1], x1)]);
  structureDeck(pts, { id: ref, w: CLS.motorway.w, med: CLS.motorway.median / 2, crossings, paint: { edge: MW - 1.1, divider: CLS.motorway.median / 2 + CLS.motorway.lane, inner: CLS.motorway.median / 2 + 0.3 } });
  STRUCT.ribbons.push({ id: ref, w: CLS.motorway.w, p: pts.map((q) => [R2(q[0]), R2(q[1]), R2(q[2])]) });
  // solid body: ground floor is closed under the walls where the deck is higher than 0.3 m, except under the crossing roads
  for (const [x0, x1] of intervalsAbove(hfn, a, b, 0.3)) for (const [y0, y1] of subtractIntervals(x0, x1, MOTOR_CROSS[ref].map((v) => [v - 8, v + 8]))) STRUCT.blockers.push(axis === 'x' ? [y0, c - MW - 0.6, y1, c + MW + 0.6] : [c - MW - 0.6, y0, c + MW + 0.6, y1]);
}
// Render the pre-resolved ramp profiles. Single-lane ramps have edge lines,
// NOT a dashed centre line suggesting a second lane.
for (const { id, ic, kind, p3, bridge: sBr, S, attach, mouth, flare } of rampPts) {
  // Merge geometry (2026-10-18 (8)): where a ramp joins a carriageway / avenue PARALLEL to it, its outer edge converges linearly onto the host's kerb line
  // (a true wedge, one asphalt contour), the edge line on the host side turns into a dashed line, the outer edge line runs on without a break.
  const { offL, offR, dashed, adjL, adjR, skipL, skipR } = rampOffs.get(id);
  asymRibbon(p3, offL, offR, 0.052, CI.asph);
  for (const sg of [-1, 1]) {
    const q = offsetPts3(p3, sg * (CLS.ramp.w / 2 + 0.2));
    const body = offsetPts3(p3, sg * (CLS.ramp.w / 2 - 0.3));
    for (let i = 1; i < p3.length; i++) {
      if (Math.max(p3[i - 1][2], p3[i][2]) < 0.3) continue;
      const cross = sBr != null && Math.abs((S[i - 1] + S[i]) / 2 - sBr) < 9;
      const support = cross ? q : body;
      for (const run of exposedRuns([support[i - 1], support[i]], 0, id, 0.3, !cross))
        wallAlong(run, 0, (h) => cross ? h - 0.6 : 0, (h) => h + 0.05, cross ? CI.conc : CI.verge);   // an embankment face (grass), not a concrete slab, where the ramp rides on fill
    }
    for (const run of exposedRuns(p3, sg * (CLS.ramp.w / 2 + 0.2), id, 0.3, 'barrier')) {
      // Split the height gate into contiguous runs too: filtering vertices
      // would reconnect opposite sides of a low section with a collider chord.
      // The barrier RISES out of the ground over the deck height 0.3 -> 1.2 m (a sloped end, 2026-10-19: it used to start as a full-height slab in mid air); the colliders keep the old gate (deck > 1.2 m)
      const tap = (h) => { const t = Math.max(0, Math.min(1, (h - 0.3) / 0.9)); return t * t * (3 - 2 * t); };
      let vis = [];
      const flush = () => {
        if (vis.length > 1) {
          wallAlong(vis, 0, (h) => h + 0.05, (h) => h + 0.05 + 0.75 * tap(h), CI.conc);
          capAlong(vis.map((q) => [q[0], q[1], q[2] - 0.75 * (1 - tap(q[2]))]), 0, 0.2, 0.8, CI.conc);
          let hi = []; for (const q of vis.concat([[0, 0, 0]])) { if (q[2] > 1.2) hi.push(q); else { if (hi.length > 1) addParapets(hi, 0); hi = []; } }
        }
        vis = [];
      };
      for (const p of run) { if (p[2] > 0.3) vis.push(p); else flush(); } flush();
    }
    {
      const si = sg < 0 ? 0 : 1, line = offsetVar(p3, p3.map((_, i) => sg < 0 ? offL[i] + 0.2 + adjL[i] : offR[i] - 0.2 + adjR[i])), n = p3.length, skip = sg < 0 ? skipL : skipR;
      for (let i = 0; i < n - 1;) {
        const dz = dashed[si][i] && dashed[si][i + 1]; let j = i;
        while (j < n - 1 && (dashed[si][j] && dashed[si][j + 1]) === dz) j++;
        if (!skip[i] && !skip[j]) for (const run of exposedRuns(line.slice(i, j + 1), 0, id, 0.05)) paintAlong(run, 0, 0.16, dz ? 1.6 : 1, dz ? 1.8 : 0, 0.064, CI.white);
        i = j;
      }
    }
  }
  // Direction arrows on every ramp and give-way teeth where a SLIP lane merges (2026-10-18 (8)); painted on the deck with the ramp's own heights.
  {
    const L = S[S.length - 1], at = (sv) => { let i = 1; while (i < S.length - 1 && S[i] < sv) i++; const a = p3[i - 1], b = p3[i], t = Math.max(0, Math.min(1, (sv - S[i - 1]) / Math.max(1e-6, S[i] - S[i - 1]))), dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return { x: a[0] + dx * t, z: a[1] + (b[1] - a[1]) * t, h: a[2] + (b[2] - a[2]) * t, tx: dx / l, tz: dz / l }; };
    const tri = (o, s0, l0, s1, l1, s2, l2) => {   // vertices in (along, right) metres from o; wound like deckRibbon's (left, right, next-left)
      const V = (s, l) => [o.x + o.tx * s - o.tz * l, o.h + 0.064, o.z + o.tz * s + o.tx * l];
      const cross = (s1 - s0) * (l2 - l0) - (l1 - l0) * (s2 - s0);
      if (cross < 0) emitTri3(V(s0, l0), V(s1, l1), V(s2, l2), CI.white); else emitTri3(V(s0, l0), V(s2, l2), V(s1, l1), CI.white);
    };
    const arrowAt = (sv) => { const o = at(sv); if (o.h > 0.4) return; tri(o, -0.9, -0.09, -0.9, 0.09, 0.4, -0.09); tri(o, -0.9, 0.09, 0.4, 0.09, 0.4, -0.09); tri(o, 0.2, -0.5, 0.2, 0.5, 1.1, 0); };
    const teethAt = (sv) => { const o = at(sv); if (o.h > 0.4) return; for (const l of [-1.05, -0.35, 0.35, 1.05]) tri(o, 0, l - 0.3, 0, l + 0.3, -0.75, l); };   // apexes point back at the oncoming driver
    if (/slip/.test(kind)) { arrowAt(L * 0.36); arrowAt(L * 0.62); teethAt(L - 4.5); } else if (L > 40) { arrowAt(L * 0.4); arrowAt(L * 0.6); }
  }
  STRUCT.ribbons.push({ id: ic + '.' + kind, w: CLS.ramp.w - 0.2, p: p3.map((p) => [R2(p[0]), R2(p[1]), R3(p[2])]) });
}
// Diamond terminals: kerb returns (R 7) between the widened ramp mouth and the avenue edge, both corners; sidewalks are carved out and a ring of walk follows the arc
const TERM_R = 7;
for (const { p3, mouth, S } of rampPts) {
  if (mouth == null) continue;
  const P = p3[mouth ? p3.length - 1 : 0], side = P[0] < 0 ? -1 : 1, mh = CLS.ramp2.w / 2;
  for (const sz of [-1, 1]) {
    const K = [P[0], P[1] + sz * mh], O = [K[0] + side * TERM_R, K[1] + sz * TERM_R];
    addShape(Math.min(K[0], O[0]), Math.min(K[1], O[1]), Math.max(K[0], O[0]), Math.max(K[1], O[1]), 'carve');
    const arc = [], arc2 = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI / 2; arc.push([O[0] - side * TERM_R * Math.sin(t), O[1] - sz * TERM_R * Math.cos(t)]); arc2.push([O[0] - side * (TERM_R - 1.4) * Math.sin(t), O[1] - sz * (TERM_R - 1.4) * Math.cos(t)]); }
    for (let k = 0; k + 1 < arc.length; k++) {
      emitTri('r', K, arc[k], arc[k + 1], H.asph, CI.asph);
      emitWall(arc[k][0], arc[k][1], arc[k + 1][0], arc[k + 1][1], H.asph, H.walk, CI.kerb);
      emitTri('r', arc[k], arc2[k], arc[k + 1], H.walk, CI.walk); emitTri('r', arc2[k], arc2[k + 1], arc[k + 1], H.walk, CI.walk);
    }
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
  if (f.over === 'река') continue;   // FB2: not drawn - the east bank street x=-194 lies 3 m behind the channel edge (river x -207 +-10), no room for ramps; the road bridges carry the pedestrians
  if (f.over === 'река') f.at = [PLAN.water.river.pts.reduce((b, q) => Math.abs(q[1] - f.at[1]) < Math.abs(b[1] - f.at[1]) ? q : b)[0], f.at[1]];   // centred on the river at its z (FB2: the flat span covers the 10 m channel + banks, the feet stay between the two bank streets)
  const isRiver = f.over === 'река', over = f.over.startsWith('М') ? MW + 3 : isRiver ? 10 : hw('arterial') + CLS.arterial.sidewalk + 1.2;
  const top = isRiver ? 1.0 : 5.1, g = isRiver ? 0.5 : 0.4,   // stair-ramps (22 degrees): the ramps of a footbridge must end before the next street (40 m grid)
   ramp = top / g, half = over + ramp, lat = f.id === 'FB3' || f.id === 'FB4' ? 3.6 : 0;
  // Two radius-2 smoothing passes spread the toe of the slope by 4 m. Keep that
  // entire tail in BOTH the drawn deck and the walkable ribbon: cutting at `half`
  // left a 0.32-0.34 m step at either entrance even after the endpoint fix in C1c.
  const toe = half + 4;
  const hfn = smoothFn((s) => Math.max(0, Math.min(top, top - g * (Math.abs(s) - over))), -toe, toe, 1, 2);
  const pts = []; const ss = []; for (let s = -toe; s < toe - 0.3; s += 3) ss.push(s); ss.push(toe); for (const s of ss) pts.push(f.axis === 'x' ? [f.at[0] + s, f.at[1] + lat, hfn(s)] : [f.at[0] + lat, f.at[1] + s, hfn(s)]);
  const S = arcLen(pts);
  deckRibbon(pts, 2.4, 0, CI.conc);
  for (const sg of [-1, 1]) { const off = sg * 1.25; wallAlong(pts, off, (h) => h + 0.02, (h) => h + 1.1, CI.conc); capAlong(pts, off, 0.15, 1.1, CI.conc); wallAlong(pts, off, (h) => Math.max(0, h - 0.55), (h) => h, CI.concD); addParapets(pts.filter((q) => q[2] > 0.8), off); }
  deckRibbon(pts, 2.4, -0.55, CI.concD);
  // columns: at the ends of the span, and every 9 m under the ramps (higher than 0.8 m)
  for (let i = 0; i < pts.length; i += 3) { const q = pts[i], sAx = ss[i]; if (q[2] > 0.8 && Math.abs(sAx) >= over - 0.01 && (!isRiver || Math.abs(sAx) <= over + 2)) box3(q[0] - 0.3, q[1] - 0.3, q[0] + 0.3, q[1] + 0.3, 0, q[2] - 0.55, CI.concD, false); }   // supports only outside the roadway (never a pier in a lane)
  STRUCT.ribbons.push({ id: f.id, w: 2.2, p: pts.map((q) => [R2(q[0]), R2(q[1]), R2(q[2])]) });
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
  for (let x = SZ.x1; x < SZ.x1 + 80; x += 10) for (let z = -330; z < -150; z += 10) emitRect('g', 'q', x, z, x + 10, z + 10, H.base, CI.grass);   // the east cloverleaf ramps of I3 run on to M1 beyond the map edge: lawn under them (no road over the void)
  for (let x = SZ.x1; x < SZ.x1 + 40; x += 10) for (let z = 120; z < 164; z += 10) emitRect('g', 'q', x, z, x + 10, z + 10, H.base, CI.grass);
  // fields and forests never run into a junction: a farm strip or a wood cut by the straight edge of the interchange lawn read as a second shade of ground with a rectangular border
  const ICENV = PLAN.interchanges.map((ic) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const rp of ic.ramps) for (const q of rp.pts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } return [x0 - 40, z0 - 40, x1 + 40, z1 + 40]; });
  const nearIC = (poly) => { const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]), a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...zs), d = Math.max(...zs); return ICENV.some((r) => a < r[2] && b > r[0] && c < r[3] && d > r[1]); };
  PLAN.rural.fields = PLAN.rural.fields.filter((f) => !nearIC(f.poly)); PLAN.rural.forests = PLAN.rural.forests.filter((f) => !nearIC(f));
  PLAN.areas = PLAN.areas.filter((a) => a.kind !== 'forest' || !nearIC(a.poly));
  PLAN.rural.lanes = PLAN.rural.lanes.filter((l) => !ICENV.some((r) => l.some((q) => q[0] > r[0] && q[0] < r[2] && q[1] > r[1] && q[1] < r[3])));   // no farm track ends at a ramp
  const KIND = { forest: 'forest', industry: 'industry', verge: 'verge', park: 'park', parking: 'parking', embankment: 'embank', beach: 'beach', promenade: 'promenade', port: 'port', urban: 'urban' };
  const KORDER = ['urban', 'industry', 'verge', 'park', 'parking', 'embankment', 'port', 'beach', 'promenade', 'forest'];
  for (const a of PLAN.areas) emitPoly('g', a.poly, a.kind === 'parking' ? -0.054 : -0.075 + KORDER.indexOf(a.kind) * 0.002, CI[KIND[a.kind]]);   // a lot lies well above the park / verge polygons under it (2 mm apart z-fought into stripes)
  // parking lots are paved and have bay lines (two rows of 2.8 m bays + a 6 m aisle), painted on the lot
  for (const a of PLAN.areas) if (a.kind === 'parking') {
    const xs = a.poly.map((q) => q[0]), zs = a.poly.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), zm = (z0 + z1) / 2;
    for (const [za, zb] of [[z0 + 1, zm - 3.4], [zm + 3.4, z1 - 1]]) for (let x = x0 + 2; x <= x1 - 2 + 1e-6; x += 2.8) emitRect('p', 'q', x - 0.06, za, x + 0.06, zb, -0.046, CI.white);
  }
  const ZONE = { residential: 'resid', mixed: 'mixed', cbd: 'cbd', industrial: 'indus', logistics: 'indus', railyard: 'indus', station: 'station', busterm: 'station', villas: 'villas', school: 'school', hospital: 'hospital', park: 'park', market: 'market', east: 'mixed', stadium: 'stadium', campus: 'school', waterfront: 'waterf' };
  for (const b of PLAN.blocks) { const r = b.lot || b.rect; emitRect('g', 'q', r[0], r[1], r[2], r[3], H.zone2, CI[ZONE[b.zone] || 'resid']); }
  // industrial / logistics lots are paved yards with bay lines (two rows of 3.2 m bays along the long edges, a loading apron between, a painted yard boundary), not a bare grey plate
  for (const b of PLAN.blocks) if (b.zone === 'industrial' || b.zone === 'logistics') {
    const [x0, z0, x1, z1] = b.lot || b.rect, inset = 1.4, w = x1 - x0, h = z1 - z0, y = H.zone2 + 0.004;
    for (const [ax0, az0, ax1, az1] of [[x0 + inset, z0 + inset, x1 - inset, z0 + inset + 0.15], [x0 + inset, z1 - inset - 0.15, x1 - inset, z1 - inset], [x0 + inset, z0 + inset, x0 + inset + 0.15, z1 - inset], [x1 - inset - 0.15, z0 + inset, x1 - inset, z1 - inset]]) emitRect('p', 'q', ax0, az0, ax1, az1, y, CI.white);
    const long = w >= h, depth = Math.min(8, (long ? h : w) * 0.22);
    for (const side of [0, 1]) for (let t = inset + 3.2; t < (long ? w : h) - inset - 1; t += 3.2) {
      if (long) { const zz0 = side ? z1 - inset - depth : z0 + inset, zz1 = side ? z1 - inset : z0 + inset + depth; emitRect('p', 'q', x0 + t - 0.07, zz0, x0 + t + 0.07, zz1, y, CI.white); }
      else { const xx0 = side ? x1 - inset - depth : x0 + inset, xx1 = side ? x1 - inset : x0 + inset + depth; emitRect('p', 'q', xx0, z0 + t - 0.07, xx1, z0 + t + 0.07, y, CI.white); }
    }
  }
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
const isWater = (x, z) => inPoly(x, z, seaPoly) || (riverDist(x, z) < PLAN.water.river.w / 2 && !bridgeRects.some((r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]));
const inSplitZone = (x, z, pad) => splitZones.some((poly) => inPoly(x, z, poly) || poly.some((p, i) => segDist(x, z, p, poly[(i + 1) % poly.length]) < pad));
const YARDS = PLAN.areas.filter((a) => a.kind === 'parking').map((a) => { const xs = a.poly.map((q) => q[0]), zs = a.poly.map((q) => q[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; }).concat(PLAN.blocks.filter((b) => b.zone === 'industrial' || b.zone === 'logistics').map((b) => b.lot || b.rect));   // paved lots with painted bays: no tree stands on them
const yardAt = (x, z) => YARDS.some((r) => x > r[0] - 0.8 && x < r[2] + 0.8 && z > r[1] - 0.8 && z < r[3] + 0.8);
const bendAt = (x, z, pad) => bendsOut.some((b) => {   // on the arc band of a bend (quadrant towards the corner node only)
  const bb = BENDS.get(b.node), O = [b.at[0] + (bb.arms[0].dir[0] + bb.arms[1].dir[0]) * b.R, b.at[1] + (bb.arms[0].dir[1] + bb.arms[1].dir[1]) * b.R];
  const r = Math.hypot(x - O[0], z - O[1]); if (Math.abs(r - b.R) >= b.half + b.sw + pad) return false;
  const ax = bb.arms[0].dir, ay = bb.arms[1].dir; return (x - O[0]) * (b.at[0] - O[0]) + (z - O[1]) * (b.at[1] - O[1]) > -2 * pad - 1 && ((x - O[0]) * (-ay[0]) + (z - O[1]) * (-ay[1]) > -1) && ((x - O[0]) * (-ax[0]) + (z - O[1]) * (-ax[1]) > -1);
});
const blocked = (x, z, pad = 0.6) => !!(inSplitZone(x, z, pad) || yardAt(x, z) || bendAt(x, z, pad) || rasterAt(x, z) || rasterAt(x + pad, z) || rasterAt(x - pad, z) || rasterAt(x, z + pad) || rasterAt(x, z - pad) || motorHosts.some((h) => { const p = [x, z]; return p[h.axis] >= h.lo && p[h.axis] <= h.hi && Math.abs(p[1 - h.axis] - h.c) < MW + pad; }) || ringAt(x, z) || rangeRamp(x, z) || railBlocked(x, z) || STRUCT.blockers.some((b) => x > b[0] - 1 && x < b[2] + 1 && z > b[1] - 1 && z < b[3] + 1)) || isWater(x, z);
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
for (const line of PLAN.transit.lines) for (const s0 of line.stops) { let s = s0;
  let best = null; for (let i = 0; i + 1 < line.pts.length; i++) { const d = segDist(s[0], s[1], line.pts[i], line.pts[i + 1]); if (!best || d < best.d) best = { d, i }; }
  const p0 = line.pts[best.i], p1 = line.pts[best.i + 1], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, h = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L], r = rightOf(h);
  { let sh = 0; while (sh < 4 && PLAN.nodes.some((n) => Math.hypot(n.x - s[0], n.z - s[1]) < 9)) { s = [s[0] + h[0] * 5, s[1] + h[1] * 5]; sh++; } }   // never at a junction: the shelter needs an unbroken sidewalk
  const e = PLAN.edges.find((q) => { const a = N.get(q.a), b = N.get(q.b); return q.dir === (Math.abs(h[0]) > Math.abs(h[1]) ? 'x' : 'z') && (q.dir === 'x' ? Math.abs(a.z - s[1]) < 0.01 && s[0] >= Math.min(a.x, b.x) && s[0] <= Math.max(a.x, b.x) : Math.abs(a.x - s[0]) < 0.01 && s[1] >= Math.min(a.z, b.z) && s[1] <= Math.max(a.z, b.z)); });
  // Keep a 0.9 m through-walk in front of the 1.1 m-deep shelter. Narrow
  // sidewalks get a paved waiting recess OUTSIDE their edge, not a shelter
  // blocking the whole pavement or standing half on grass.
  const off = e ? hw(e.cls) + Math.max(CLS[e.cls].sidewalk - 0.6, 1.5) : 3;
  if (e) {
    const inner = hw(e.cls) + CLS[e.cls].sidewalk, outer = off + 0.65;
    if (outer > inner) {
      const a = [s[0] - h[0] * 1.8 + r[0] * inner, s[1] - h[1] * 1.8 + r[1] * inner];
      const b = [s[0] + h[0] * 1.8 + r[0] * outer, s[1] + h[1] * 1.8 + r[1] * outer];
      emitRect('r', 'q', Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), H.walk, CI.walk);
    }
  }
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
const nearRampPt = (x, z, m) => rampSegs.some(([a, b]) => Math.abs((a[0] + b[0]) / 2 - x) < 60 && segDist(x, z, a, b) < CLS.ramp.w / 2 + m);
furniture.lamp = furniture.lamp.filter((l) => !nearRampPt(l[0], l[1], 0.8));
furniture.sig = furniture.sig.filter((l) => !nearRampPt(l[0], l[1], 0.5));
furniture.lamp = furniture.lamp.filter((l) => !furniture.stop.some((st) => Math.hypot(st[0] - l[0], st[1] - l[1]) < 3.2));   // no lamp inside a bus stop
for (const cellC of cells.values()) {
  const old = cellC.f.tree, kept = [];
  for (let i = 0; i < old.length; i += 4) if (!furniture.stop.some((st) => Math.hypot(st[0] - old[i], st[1] - old[i + 1]) < 2.2)) kept.push(...old.slice(i, i + 4));
  cellC.f.tree = kept;
}
// the lawn inside every cloverleaf loop: a ring of trees round the middle and one in the centre (the loop centre = circumcentre of three points of its middle third)
for (const ic of PLAN.interchanges) for (const rp of ic.ramps) {
  if (rp.kind !== 'loop' || !rp.r) continue;
  const n = rp.pts.length, [A, B, Cc] = [Math.floor(n * 0.4), Math.floor(n * 0.5), Math.floor(n * 0.6)].map((i) => rp.pts[i]);
  const d = 2 * (A[0] * (B[1] - Cc[1]) + B[0] * (Cc[1] - A[1]) + Cc[0] * (A[1] - B[1])); if (Math.abs(d) < 1e-6) continue;
  const ux = ((A[0] ** 2 + A[1] ** 2) * (B[1] - Cc[1]) + (B[0] ** 2 + B[1] ** 2) * (Cc[1] - A[1]) + (Cc[0] ** 2 + Cc[1] ** 2) * (A[1] - B[1])) / d, uz = ((A[0] ** 2 + A[1] ** 2) * (Cc[0] - B[0]) + (B[0] ** 2 + B[1] ** 2) * (A[0] - Cc[0]) + (Cc[0] ** 2 + Cc[1] ** 2) * (B[0] - A[0])) / d;
  const put = (x, z, sc, rn) => cellOf(Math.floor(x / CELL), Math.floor(z / CELL)).f.tree.push(R2(x), R2(z), R2(sc), R2(rn));
  disc('g', [ux, uz], rp.r - 1.9, -0.04, CI.grass, 40);   // the same grass as everywhere (2026-10-19: a lighter lawn disc read as a second shade of ground)
  for (const c of cells.values()) { const old = c.f.tree, kept = []; for (let i = 0; i < old.length; i += 4) if (Math.hypot(old[i] - ux, old[i + 1] - uz) > rp.r - 1.0) kept.push(...old.slice(i, i + 4)); c.f.tree = kept; }   // scatter trees inside the loop make way for the lawn   // a mown lawn over the fields / forest tint under the loop
  put(ux, uz, 1.25, 0.3);
  for (let k = 0; k < 7; k++) { const a = (k + 0.3) / 7 * Math.PI * 2; put(ux + Math.cos(a) * rp.r * 0.5, uz + Math.sin(a) * rp.r * 0.5, 0.9 + 0.25 * Math.abs(Math.sin(k * 2.1)), Math.abs(Math.cos(k * 1.7))); }
}
furniture.cat = furnCat;
for (const [kind, list] of Object.entries(furniture)) for (const f of list) { const c = cellOf(Math.floor(f[0] / CELL), Math.floor(f[1] / CELL)).f[kind]; for (const v of f) c.push(typeof v === 'number' ? R2(v) : v); }

// ---- 10. graph (for tests and later steps), walkable floor
const graph = {
  nodes: PLAN.nodes.map((n) => [n.id, n.x, n.z, n.kind || '']),
  edges: PLAN.edges.map((e) => { const a = N.get(e.a), b = N.get(e.b); return [e.id, e.a, e.b, e.cls, a.x, a.z, b.x, b.z, e.name || '']; }),
  bends: bendsOut.map((b) => [b.node, b.at[0], b.at[1], b.R]),
  rings: ringsOut.map((r) => [r.id, r.at[0], r.at[1], r.R, r.Ri]),
  minis: minisOut.map((r) => [r.id, r.at[0], r.at[1], r.R, r.Ri]),
  ramps: rampsOut.map((r) => [r.ic, r.kind, r.pts.map((p) => [R2(p[0]), R2(p[1]), R3(p[2] || 0)])]),
  crossings: PLAN.crossings.map((c) => [c.id, c.kind, c.at[0], c.at[1], c.arm ? c.arm[0] : 0, c.arm ? c.arm[1] : 0, c.cls, c.setback == null ? 0 : c.setback]),
  islands: islandsOut, signals: PLAN.junctions.filter((j) => j.type === 'signal').map((j) => [j.id, j.at[0], j.at[1]]),
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
  D.access=function(x,z,m){m=m==null?.45:m;if(!D.surfaces(x,z).length)return false;for(var i=0;i<8;i++){var a=i*Math.PI/4;if(!D.surfaces(x+Math.cos(a)*m,z+Math.sin(a)*m).length)return false;}return true;};
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
