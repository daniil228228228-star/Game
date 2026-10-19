// Turning-movement matrix of the plan C street graph (2026-10-19).  node tools/masterplan/turns-plan-c.mjs [--all]
// Directed graph with right-hand traffic: every street / motorway edge is two directed lines (heading +/-), ramps are one-way (point order = travel direction) and are
// attached to the directed host line at the coordinate of their exit / entry point; a junction connects permitted movements only (RIRO enforced; a U-turn only on a
// roundabout / mini roundabout); a node without a junction connects only the straight continuation (a motorway crossing a street grade-separated has no connection).
// "direct" = inside the interchange: ramps + host lines only, NO junction turn (the movement exists without leaving the node); "full" = the whole network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared legality contract for graph consumers. x east / z south: positive cross product is a right turn.
// A RIRO junction is NOT an ordinary all-movements junction, including for collinear minor approaches.
export function movementAllowed(P, j, A, B, node) {
  if (A.id === B.id) return !!j && ['roundabout', 'mini'].includes(j.type);
  const collinear = A.dir === B.dir && (A.cls === 'motorway') === (B.cls === 'motorway');
  if (!j) return collinear;
  if (j.type !== 'riro') return true;
  const rank = { motorway: 5, arterial: 4, collector: 3, service: 2, local: 1 };
  const incident = P.edges.filter((e) => e.a === node.id || e.b === node.id);
  const major = incident.reduce((a, e) => !a || rank[e.cls] > rank[a.cls] ? e : a, null);
  if (collinear) return A.dir === major.dir;
  const opposite = (e) => P.nodes.find((n) => n.id === (e.a === node.id ? e.b : e.a));
  const a = opposite(A), b = opposite(B);
  const cross = (node.x - a.x) * (b.z - node.z) - (node.z - a.z) * (b.x - node.x);
  return cross > 0;
}

export function buildTurnGraph(P, arms) {
  const N = new Map(P.nodes.map((n) => [n.id, n])), E = P.edges, J = new Map(P.junctions.map((j) => [j.id, j]));
  const lines = new Map();   // key e.id|sgn -> { e, axis, sgn, c, lo, hi, L, pts: [{t, v}] }
  const dirName = (axis, sgn) => axis === 0 ? (sgn > 0 ? 'E' : 'W') : (sgn > 0 ? 'S' : 'N');
  for (const e of E) {
    const a = N.get(e.a), b = N.get(e.b), axis = e.dir === 'x' ? 0 : 1, c = axis === 0 ? a.z : a.x, lo = Math.min(axis === 0 ? a.x : a.z, axis === 0 ? b.x : b.z), hi = Math.max(axis === 0 ? a.x : a.z, axis === 0 ? b.x : b.z);
    const loNode = (axis === 0 ? a.x : a.z) <= (axis === 0 ? b.x : b.z) ? e.a : e.b, hiNode = loNode === e.a ? e.b : e.a;
    for (const sgn of [1, -1]) lines.set(e.id + '|' + sgn, { e, axis, sgn, c, lo, hi, L: hi - lo, start: sgn > 0 ? loNode : hiNode, end: sgn > 0 ? hiNode : loNode, pts: [] });
  }
  const adj = new Map(), label = new Map();   // vertex -> [{to, w, name}]
  const addE = (u, v, w, name) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push({ to: v, w, name }); if (!adj.has(v)) adj.set(v, []); };
  const startV = (L) => L.e.id + '|' + L.sgn + '@0', endV = (L) => L.e.id + '|' + L.sgn + '@end';
  const attach = (L, coord) => {   // vertex on a directed line at an axis coordinate
    const t = L.sgn > 0 ? coord - L.lo : L.hi - coord;
    if (t < 0.6) return startV(L); if (t > L.L - 0.6) return endV(L);
    const v = L.e.id + '|' + L.sgn + '@' + t.toFixed(1); if (!L.pts.some((q) => q.v === v)) L.pts.push({ t, v }); return v;
  };
  const hostLine = (p, h, type) => {   // the directed host line a ramp end (p, travel heading h along the host axis) sits on
    let best = null;
    for (const e of E) { if ((type === 'motorway') !== (e.cls === 'motorway')) continue; const a = N.get(e.a), b = N.get(e.b), axis = e.dir === 'x' ? 0 : 1, c = axis === 0 ? a.z : a.x, lo = Math.min(axis === 0 ? a.x : a.z, axis === 0 ? b.x : b.z), hi = Math.max(axis === 0 ? a.x : a.z, axis === 0 ? b.x : b.z), q = p[axis];
      if (q < lo - 1 || q > hi + 1) continue; const d = Math.abs((axis === 0 ? p[1] : p[0]) - c); if (!best || d < best.d || (d === best.d && e.split)) best = { d, e, axis, q }; }
    if (!best) return null; const sgn = Math.sign(h[best.axis]) || 1; return { L: lines.get(best.e.id + '|' + sgn), q: best.q };
  };
  const ramps = P.interchanges.flatMap((ic) => ic.ramps.map((r, i) => ({ ...r, id: `${ic.id}.${i}`, ic: ic.id })));
  const rampEdges = [];
  for (const r of ramps) {
    const n = r.pts.length, ends = [0, 1].map((end) => { const p = r.pts[end ? n - 1 : 0], q = r.pts[end ? n - 2 : 1], h = end ? [p[0] - q[0], p[1] - q[1]] : [q[0] - p[0], q[1] - p[1]], H = hostLine(p, h, r.attach[end]); return H ? attach(H.L, H.q) : null; });
    let len = 0; for (let i = 1; i < n; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
    if (ends[0] && ends[1]) rampEdges.push({ u: ends[0], v: ends[1], w: len, name: `${r.id} ${r.kind}` });
  }
  const armV = [];   // explicit arms: { name, ic, in: vertex, out: vertex }
  for (const a of arms || []) {
    const mk = (spec) => { const e = E.find((q) => q.id === spec.edge), axis = e.dir === 'x' ? 0 : 1; return attach(lines.get(e.id + '|' + spec.sgn), spec.at); };
    armV.push({ ...a, vin: mk(a.in), vout: mk(a.out) });
  }
  // straight lines
  for (const L of lines.values()) { const pts = [{ t: 0, v: startV(L) }, ...L.pts.sort((p, q) => p.t - q.t), { t: L.L, v: endV(L) }]; for (let i = 0; i + 1 < pts.length; i++) addE(pts[i].v, pts[i + 1].v, pts[i + 1].t - pts[i].t, L.e.name || L.e.id); }
  // node connections
  const incident = new Map(); for (const e of E) for (const id of [e.a, e.b]) { if (!incident.has(id)) incident.set(id, []); incident.get(id).push(e); }
  const nodeEdges = [];   // junction connections (turns): kept apart so that "direct" can leave them out
  for (const [id, es] of incident) {
    const j = J.get(id);
    for (const A of es) for (const B of es) {
      const inA = [1, -1].map((s) => lines.get(A.id + '|' + s)).find((L) => L.end === id), outB = [1, -1].map((s) => lines.get(B.id + '|' + s)).find((L) => L.start === id);
      if (!movementAllowed(P, j, A, B, N.get(id))) continue;
      if (A === B) { const inL = [1, -1].map((s) => lines.get(A.id + '|' + s)).find((L) => L.end === id), outL = [1, -1].map((s) => lines.get(A.id + '|' + s)).find((L) => L.start === id); nodeEdges.push({ u: endV(inL), v: startV(outL), w: 0, name: 'U-turn at ' + id, turn: true }); continue; }
      const collinear = A.dir === B.dir && (A.cls === 'motorway') === (B.cls === 'motorway');
      if (j || collinear) nodeEdges.push({ u: endV(inA), v: startV(outB), w: 0, name: id, turn: !collinear });
    }
  }
  const graph = (withTurns) => { const g = new Map(); const add = (x) => { if (!g.has(x.u)) g.set(x.u, []); g.get(x.u).push(x); if (!g.has(x.v)) g.set(x.v, []); }; for (const [u, l] of adj) for (const x of l) add({ u, v: x.to, w: x.w, name: x.name }); for (const x of rampEdges) add(x); for (const x of nodeEdges) if (withTurns || !x.turn) add(x); return g; };
  const dijkstra = (g, s, t) => {
    const dist = new Map([[s, 0]]), prev = new Map(), todo = new Set([s]), done = new Set();
    while (todo.size) { let u = null, best = Infinity; for (const x of todo) if (dist.get(x) < best) { best = dist.get(x); u = x; } todo.delete(u); if (done.has(u)) continue; done.add(u); if (u === t && u !== s) break;
      for (const x of g.get(u) || []) { const nd = best + x.w + 0.001; if (nd < (dist.has(x.v) ? dist.get(x.v) : Infinity)) { dist.set(x.v, nd); prev.set(x.v, x); todo.add(x.v); } } }
    if (s === t) { /* a U-turn: search a cycle */ let bestC = null; for (const x of g.get(s) || []) { const r = dijkstra2(g, x.v, s); if (r && (!bestC || r.len + x.w < bestC.len)) bestC = { len: r.len + x.w, via: [x.name, ...r.via] }; } return bestC; }
    if (!prev.has(t)) return null; const via = []; let v = t; while (v !== s) { const x = prev.get(v); via.push(x.name); v = x.u; } via.reverse(); return { len: dist.get(t), via };
  };
  const dijkstra2 = (g, s, t) => { if (s === t) return { len: 0, via: [] }; return dijkstra(g, s, t); };
  const compress = (via) => { const o = []; for (const n of via) if (!o.length || o[o.length - 1] !== n) o.push(n); return o; };
  return { armV, direct: graph(false), full: graph(true), dijkstra, compress, rampEdges, nodeEdges, lines };
}

// arms of the interchanges and of the I2 crossing (edge id, heading sign along its axis: +1 = E / S, -1 = W / N, coordinate along the axis)
export const ARMS = {
  I4: [
    { name: 'M2 с севера', in: { edge: 'e213', sgn: 1, at: 40 }, out: { edge: 'e213', sgn: -1, at: 40 } },
    { name: 'Портовая запад', in: { edge: 'e197', sgn: 1, at: 100 }, out: { edge: 'e197', sgn: -1, at: 100 } },
    { name: 'Портовая восток', in: { edge: 'e199', sgn: -1, at: 322 }, out: { edge: 'e199', sgn: 1, at: 322 } },
    { name: 'Порт. EB после слияния x275', in: { edge: 'e198', sgn: 1, at: 275 }, out: { edge: 'e198', sgn: -1, at: 275 } },
  ],
  I1: [
    { name: 'М1 запад', in: { edge: 'e208', sgn: 1, at: -200 }, out: { edge: 'e208', sgn: -1, at: -200 } },
    { name: 'М1 восток', in: { edge: 'e209', sgn: -1, at: 200 }, out: { edge: 'e209', sgn: 1, at: 200 } },
    { name: 'Проспект север', in: { edge: 'e52', sgn: 1, at: -365 }, out: { edge: 'e52', sgn: -1, at: -365 } },
    { name: 'Проспект юг', in: { edge: 'e52', sgn: -1, at: -110 }, out: { edge: 'e52', sgn: 1, at: -110 } },
  ],
  I2: [
    { name: 'М2 север', in: { edge: 'e212', sgn: 1, at: -60 }, out: { edge: 'e212', sgn: -1, at: -60 } },
    { name: 'М2 юг', in: { edge: 'e213', sgn: -1, at: 60 }, out: { edge: 'e213', sgn: 1, at: 60 } },
    { name: 'Центральная запад', in: { edge: 'e151', sgn: 1, at: 180 }, out: { edge: 'e151', sgn: -1, at: 180 } },
    { name: 'Центральная восток', in: { edge: 'e155', sgn: -1, at: 293 }, out: { edge: 'e155', sgn: 1, at: 293 } },
  ],
  I3: [
    { name: 'М1 запад', in: { edge: 'e209', sgn: 1, at: 100 }, out: { edge: 'e209', sgn: -1, at: 100 } },
    { name: 'М1 восток', in: { edge: 'e210', sgn: -1, at: 370 }, out: { edge: 'e210', sgn: 1, at: 370 } },
    { name: 'М2 север', in: { edge: 'e211', sgn: 1, at: -370 }, out: { edge: 'e211', sgn: -1, at: -370 } },
    { name: 'М2 юг', in: { edge: 'e212', sgn: -1, at: -100 }, out: { edge: 'e212', sgn: 1, at: -100 } },
  ],
};

// ---- CLI
export function matrix(P, ic) {
  const G = buildTurnGraph(P, ARMS[ic]), rows = [];
  for (const a of G.armV) for (const b of G.armV) {
    const full = G.dijkstra(G.full, a.vin, b.vout), direct = ic === 'I2' ? full : G.dijkstra(G.direct, a.vin, b.vout);
    const useful = (r) => r ? G.compress(r.via.filter((n) => !/^n\d+$/.test(n))).join(' > ') : '';
    rows.push({ ic, from: a.name, to: b.name, uturn: a === b, direct: direct && direct.len < 1e5 ? Math.round(direct.len) : null, directVia: useful(direct), full: full ? Math.round(full.len) : null, fullVia: useful(full) });
  }
  return rows;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/masterplan/plan-C.json'), 'utf8'));
  for (const ic of Object.keys(ARMS)) { console.log(`\n== ${ic} ==`); for (const r of matrix(P, ic)) console.log(`${r.from.padEnd(20)} -> ${r.to.padEnd(20)} ${r.uturn ? '(разворот)' : '          '} direct ${r.direct == null ? '-' : r.direct + ' m'} [${r.directVia}]  | full ${r.full == null ? 'NO PATH' : r.full + ' m'} [${r.fullVia.slice(0, 160)}]`); }
}
