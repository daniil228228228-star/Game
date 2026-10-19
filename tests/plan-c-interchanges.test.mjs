// Actual compiled/runtime meshes, no browser. In particular, attachment checks
// must NOT accept the ramp's own surface as evidence that it joins another road.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { ctx } from './plan-c-height-unit.test.mjs';
const { THREE, PlanCDataV161: D, PlanCV161: C } = ctx;
const P = JSON.parse(fs.readFileSync(new URL('../tools/masterplan/plan-C.json', import.meta.url), 'utf8'));
const motors = D.struct.ribbons.filter((r) => /^M[12]$/.test(r.id));
function heightOn(p, path) {
  let best = Infinity, h = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b[0] - a[0], dz = b[1] - a[1], ll = dx * dx + dz * dz;
    const t = ll ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / ll)) : 0;
    const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
    if (d < best) { best = d; h = a[2] + t * (b[2] - a[2]); }
  }
  return { distance: best, h };
}
const hostHeight = (p) => {
  const ref = Math.abs(p[1] + 240) < Math.abs(p[0] - 250) ? 'M1' : 'M2';
  const candidates = motors.filter((r) => r.id === ref).map((r) => heightOn(p, r.p));
  return candidates.sort((a, b) => a.distance - b.distance)[0]?.h || 0;
};
function hitAt(x, z, h) {
  C.ensureNear(x, z); ctx.scene.updateMatrixWorld(true);
  // Only neighbouring cells, including both sides of a boundary.
  const meshes = [];
  for (const [key, cell] of C.cells) {
    const [cx, cz] = key.split(',').map(Number);
    if (x < cx * 60 - 0.01 || x > (cx + 1) * 60 + 0.01 || z < cz * 60 - 0.01 || z > (cz + 1) * 60 + 0.01) continue;
    if (cell.mesh) meshes.push(cell.mesh); if (cell.decks) meshes.push(cell.decks);
  }
  return new THREE.Raycaster(new THREE.Vector3(x, h + 0.35, z), new THREE.Vector3(0, -1, 0), 0, 0.5).intersectObjects(meshes, false)[0];
}
function color(hit) {
  const a = hit.object.geometry.attributes.color;
  return new THREE.Color().fromArray(a.array, hit.face.a * 3).convertLinearToSRGB().getHex();
}
let toes = 0, toeSamples = 0;
for (const r of motors) {
  assert.equal(r.w, P.classes.motorway.w, 'deck preserves the complete motorway cross section');
  for (const k of [0, r.p.length - 1]) {
    const p = r.p[k];
    if (r.id === 'M2' && p[1] === 88) continue; // joins the trumpet, not flat ground
    assert.equal(p[2], 0, r.id + ' includes the full smoothed ground toe'); toes++;
    const axis = r.id === 'M1' ? 0 : 1;
    for (const along of [-0.04, 0.04]) for (const lateral of [-5.7, -4.25, -2.15, 2.15, 4.25, 5.7]) {
      const q = [...p]; q[axis] += along; q[1 - axis] += lateral;
      const hit = hitAt(q[0], q[1], 0);
      assert.ok(hit, `drawn asphalt exists across the toe ${q}`);
      assert.equal(color(hit), D.colors[D.palette.asph], 'no grass slit / concrete intruding into a lane at ' + q);
      assert.ok(Math.abs(hit.point.y - 0.05) < 0.012, 'no raised uncapped end face'); toeSamples++;
    }
  }
}
assert.equal(toes, 2);   // the two ends of the M1 deck over I1 (I3 and the M2 decks are gone, the I2 crossing is at grade)
 console.log(`PASS ${toes} full-width ground toes, ${toeSamples} drawn-surface raycasts`);

const ramps = P.interchanges.flatMap((ic) => ic.ramps.map((r) => {
  const g = D.graph.ramps.find(([id, kind, p]) => id === ic.id && kind === r.kind && Math.hypot(p[0][0] - r.pts[0][0], p[0][1] - r.pts[0][1]) < 0.01);
  assert.ok(g, ic.id + ' ramp present'); return { ...r, ic: ic.id, path: g[2] };
}));
let ends = 0;
for (const r of ramps) for (const k of [0, 1]) {
  const p = k ? r.path.at(-1) : r.path[0], type = r.attach[k];
  const h = type === 'motorway' ? hostHeight(p) : type === 'ramp'
    ? ramps.filter((a) => a !== r && a.ic === r.ic && !/slip/.test(a.kind)).map((a) => heightOn(p, a.path)).sort((a, b) => a.distance - b.distance)[0].h : 0;
  assert.ok(Math.abs(p[2] - h) < 0.025, `${r.ic}/${r.kind} end ${k} is at its OTHER road's level: ${p[2]} vs ${h}`); ends++;
}
assert.equal(ends, 24); console.log(`PASS ${ends} ramp endpoints meet an independently selected host surface`);

// The slip must turn AWAY from the motorway, not hook back into its edge.
for (const r of ramps.filter((r) => /slip/.test(r.kind))) {
  const bend = r.kind === 'slip-off' ? r.path.slice(0, 37) : r.path.slice(-37).reverse();
  const lateral = (p) => r.ic === 'I1' ? Math.abs(p[1] + 240) : Math.abs(p[0] - 250);
  assert.ok(bend.every((p) => lateral(p) >= lateral(bend[0]) - 0.015), r.ic + ' slip bends outside the motorway');
}
let pavementSamples = 0;
for (const r of ramps) {
  const S = [0]; for (let i = 1; i < r.path.length; i++) S.push(S.at(-1) + Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]));
  for (let i = 1; i < r.path.length; i++) {
    if (S[i] > 30 && S.at(-1) - S[i - 1] > 30) continue;
    const a = r.path[i - 1], b = r.path[i], ds = S[i] - S[i - 1];
    for (const t of [0.2, 0.8]) for (const off of [-0.65, 0, 0.65]) {
      const x = a[0] + (b[0] - a[0]) * t - (b[1] - a[1]) / ds * off;
      const z = a[1] + (b[1] - a[1]) * t + (b[0] - a[0]) / ds * off;
      const h = a[2] + (b[2] - a[2]) * t, hit = hitAt(x, z, h);
      assert.ok(hit, `${r.ic}/${r.kind} drawn pavement at ${x},${z}`);
      assert.ok([D.palette.asph, D.palette.white].some((ci) => color(hit) === D.colors[ci]), `${r.ic}/${r.kind} no grass / concrete in join pavement at ${x},${z}`);
      assert.ok(Math.abs(hit.point.y - h - 0.052) < 0.09, `${r.ic}/${r.kind} drawn join has no height step (${hit.point.y} vs ${h})`); pavementSamples++;
    }
  }
}
console.log(`PASS ${pavementSamples} join-pavement raycasts across the full vehicle width`);

// Independent STREET lane rays: the ramp-axis checks above cannot detect a
// raised merge lip covering the adjacent avenue. These failed by 3-5 cm on
// the previous compiled profiles although every ramp-axis check was green.
let streetMergeSamples=0;
for(const [x,z]of [-3.7,3.7].flatMap(x=>[-257.091,-256.092,-255.093,-224.907,-223.908,-222.909].map(z=>[x,z])).concat([[264.024,163.6]])){
  const hit=hitAt(x,z,0);
  assert.ok(hit,'drawn street exists beside the ramp');
  assert.ok([D.palette.asph,D.palette.white].some(ci=>color(hit)===D.colors[ci]),'street lane has no invading support face');
  assert.ok(Math.abs(hit.point.y-.05)<=.03,`ramp lip above street lane at ${x},${z}: ${hit.point.y}`);streetMergeSamples++;
}
console.log(`PASS ${streetMergeSamples} independent street-lane rays: no raised merge lip`);

// Full vertical faces, not just the collider registry: a visible wall must not
// slice through the car + 0.25 m clearance swept along ANY ramp centre line.
const walls = Object.values(D.cells).flatMap((c) => {
  const a = c.d?.s || [], out = []; for (let i = 0; i < a.length; i += 9) out.push(a.slice(i, i + 9)); return out;
});
const bad = [], badRails = []; let samples = 0;
for (const r of ramps) for (let i = 1; i < r.path.length; i++) {
  const a = r.path[i - 1], b = r.path[i], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5);
  for (let j = 0; j <= n; j++) {
    const p = a.map((v, k) => v + (b[k] - v) * j / n); samples++;
    for (const w of walls) {
      if (p[0] < Math.min(w[0], w[2]) - 1 || p[0] > Math.max(w[0], w[2]) + 1 || p[1] < Math.min(w[1], w[3]) - 1 || p[1] > Math.max(w[1], w[3]) + 1) continue;
      const q = [[w[0], w[1], 0], [w[2], w[3], 0]], hit = heightOn(p, q);
      if (hit.distance >= 0.94) continue;
      const dx = w[2] - w[0], dz = w[3] - w[1], ll = dx * dx + dz * dz;
      const t = ll ? Math.max(0, Math.min(1, ((p[0] - w[0]) * dx + (p[1] - w[1]) * dz) / ll)) : 0;
      const bottom = w[4] + (w[6] - w[4]) * t, top = w[5] + (w[7] - w[5]) * t;
      if (top > p[2] + 0.18 && bottom < p[2] + 1.2) { bad.push([r.ic, r.kind, p, w]); break; }
    }
    for (const rail of D.struct.rails) if (Math.abs(p[2] - rail[4]) < 1.4 &&
      heightOn(p, [[rail[0], rail[1], 0], [rail[2], rail[3], 0]]).distance < 1.09) {
      badRails.push([r.ic, r.kind, p, rail]); break;
    }
  }
}
assert.equal(bad.length, 0, 'wall cuts through a ramp swept corridor: ' + JSON.stringify(bad.slice(0, 3)));
assert.equal(badRails.length, 0, 'active parapet collider cuts through a ramp: ' + JSON.stringify(badRails.slice(0, 3)));
console.log(`PASS ${samples} ramp samples: no structural wall crosses the car-clearance corridor`);
