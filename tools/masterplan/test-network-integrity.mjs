// Browser-free regressions for the 2026-10-19 network audit. No movement/runtime acceptance implied.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildPlan } from './plan-c.mjs';
import { buildTurnGraph, movementAllowed, matrix, ARMS } from './turns-plan-c.mjs';

const P = buildPlan(), N = new Map(P.nodes.map((n) => [n.id, n]));
assert.equal(fs.readFileSync(new URL('./plan-C.json', import.meta.url), 'utf8'), JSON.stringify(P), 'generated plan is current (JSON normalises -0)');
const G = buildTurnGraph(P), ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../../assets/plan-c-data-v161.js', import.meta.url), 'utf8'), ctx);
const D = ctx.window.PlanCDataV161;
let checks = 0;
const check = (ok, msg) => { assert.ok(ok, msg); checks++; };

// Independent geometric oracle for EVERY ordered pair at EVERY RIRO node, including excluded pairs.
let legal = 0, forbidden = 0;
for (const j of P.junctions.filter((j) => j.type === 'riro')) {
  const n = N.get(j.id), es = P.edges.filter((e) => e.a === n.id || e.b === n.id);
  const main = es.find((e) => e.cls === 'arterial');
  assert.ok(main, 'RIRO oracle requires an arterial major road');
  for (const a of es) for (const b of es) {
    const na = N.get(a.a === n.id ? a.b : a.a), nb = N.get(b.a === n.id ? b.b : b.a);
    const ix = Math.sign(n.x - na.x), iz = Math.sign(n.z - na.z), ox = Math.sign(nb.x - n.x), oz = Math.sign(nb.z - n.z);
    const right = ix * oz - iz * ox === 1;
    const majorThrough = ix * ox + iz * oz === 1 && a.dir === main.dir;
    const expected = right || majorThrough;
    const u = `${a.id}|${a.b === n.id ? 1 : -1}@end`, v = `${b.id}|${b.a === n.id ? 1 : -1}@0`;
    check(G.nodeEdges.some((e) => e.u === u && e.v === v) === expected, `RIRO ${n.id} ${a.id}->${b.id}`);
    if (expected) legal++; else forbidden++;
  }
}

// A no-junction crossing cannot connect unlike classes; roundabouts alone permit a same-edge return.
const synthetic = { nodes: [{ id: 'n', x: 0, z: 0 }, { id: 'w', x: -10, z: 0 }, { id: 'e', x: 10, z: 0 }, { id: 's', x: 0, z: 10 }], edges: [] };
const A = { id: 'a', a: 'w', b: 'n', dir: 'x', cls: 'arterial' }, B = { id: 'b', a: 'n', b: 'e', dir: 'x', cls: 'arterial' }, C = { id: 'c', a: 'n', b: 's', dir: 'z', cls: 'motorway' };
synthetic.edges = [A, B, C];
check(movementAllowed(synthetic, null, A, B, synthetic.nodes[0]), 'unmarked straight continuation');
check(!movementAllowed(synthetic, null, A, C, synthetic.nodes[0]), 'grade-separated roads cannot turn');
check(!movementAllowed(synthetic, { type: 'signal' }, A, A, synthetic.nodes[0]), 'signal is not an implicit U-turn');
check(movementAllowed(synthetic, { type: 'roundabout' }, A, A, synthetic.nodes[0]), 'ring allows return');

const parking = P.edges.find((e) => e.lot === 'P+R');
const centreEdge = P.edges.find((e) => N.get(e.a).x === 0 && N.get(e.a).z === 0);
const arrive = `${parking.id}|1@end`, leave = `${parking.id}|-1@0`, centre = `${centreEdge.id}|1@0`;
check(!!G.dijkstra(G.full, centre, arrive), 'centre -> P+R');
check(!!G.dijkstra(G.full, arrive, leave), 'P+R turnaround');
check(!!G.dijkstra(G.full, arrive, centre), 'P+R -> centre with legal movements');
check(P.junctions.some((j) => j.at[0] === 296 && j.at[1] === 0 && j.type === 'signal'), 'parking return has a real controlled junction');

for (const ic of Object.keys(ARMS)) for (const row of matrix(P, ic)) check(row.full !== null && row.full <= 800, `${ic}: ${row.from} -> ${row.to}`);

// Both ring lanes and walking envelope, not only the logical node at its island centre.
for (const ring of D.graph.rings) {
  const [, x, z, outer, inner] = ring;
  for (let k = 0; k < 96; k++) for (const r of [inner + 0.8, (inner + outer) / 2, outer - 0.8]) {
    const a = k * Math.PI / 48;
    check(D.access(x + r * Math.cos(a), z + r * Math.sin(a), 0.45), `${ring[0]} support at ${k}, r=${r}`);
  }
}
for (let x = 298; x <= 370; x += 0.5) for (const z of [-245.3, -243.2, -236.8, -234.7]) {
  check(D.access(x, z, 0.8), `M1 east lane envelope ${x},${z}`);
}
for (let x = 298; x <= 334; x += 0.5) for (const z of [157.4, 158.4, 161.6, 162.6]) {
  check(D.access(x, z, 0.8), `port approach envelope ${x},${z}`);
}
for (const [x, z] of [[360, 0], [430, -240], [340, 235], [330, 100], [0, 250]]) check(!D.floor(x, z), `no blanket land extension at ${x},${z}`);
check(!D.floor(-210, 40), 'river remains non-walkable outside bridges');
for (const [key, cell] of Object.entries(D.cells)) for (const layer of ['g', 'r', 'p']) {
  const tris = cell[layer]?.t || [];
  check(tris.length % 8 === 0, `${key}/${layer} triangle records retain their stride`);
  for (let i = 0; i < tris.length; i += 8) {
    const [ax, az, bx, bz, cx, cz] = tris.slice(i, i + 6);
    check(Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) > 1e-9, `${key}/${layer} no degenerate clipped triangle at ${i}`);
  }
}
console.log(`PASS ${checks} network regressions; RIRO ${legal} allowed / ${forbidden} forbidden; 8 rings, east M1, port and P+R return`);
