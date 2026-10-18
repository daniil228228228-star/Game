// Browser-free geometry checks on the REAL compiled cell meshes and furniture.
// This does not replace the Safari/WebGL screenshot and touch acceptance.
import assert from 'node:assert/strict';
import { ctx } from './plan-c-height-unit.test.mjs';
const { THREE, PlanCDataV161: D, PlanCV161: C } = ctx;
ctx.LAYOUT_V161 = 'C';
const groundAt = (x, z) => {
  C.ensureNear(x, z);
  ctx.scene.updateMatrixWorld(true);
  const meshes = [...C.cells.values()].map((c) => c.mesh).filter(Boolean);
  // Sample pavement at pedestrian level, including pavement UNDER the railway.
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0), 0, 1.2);
  return ray.intersectObjects(meshes, false)[0];
};
const stops = [], lamps = [];
for (const cell of Object.values(D.cells)) {
  const f = cell.f || {};
  for (let i = 0; i < (f.stop || []).length; i += 4) stops.push(f.stop.slice(i, i + 4));
  for (let i = 0; i < (f.lamp || []).length; i += 3) lamps.push(f.lamp.slice(i, i + 3));
}
const failures = [];
for (const [x, z, yaw] of stops) {
  // All four corners AND the interior of the actual 2.2 x 1.1 m shelter roof.
  for (const u of [-1.1, -0.55, 0, 0.55, 1.1]) for (const v of [-0.55, 0, 0.55]) {
    const p = new THREE.Vector3(u, 0, v).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, 0, z));
    const hit = groundAt(p.x, p.z);
    if (!hit || Math.abs(hit.point.y - D.heights.walk) > 0.015) failures.push([x, z, 'shelter outside paving', u, v, hit?.point.y]);
  }
  // A continuous through-walk in FRONT of the shelter, towards its open side.
  for (const u of [-1.5, 0, 1.5]) for (const v of [0.65, 1.05, 1.4]) {
    const p = new THREE.Vector3(u, 0, v).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, 0, z));
    const hit = groundAt(p.x, p.z);
    if (!hit || Math.abs(hit.point.y - D.heights.walk) > 0.015) failures.push([x, z, 'through-walk', u, v, hit?.point.y]);
  }
  assert.ok(lamps.every((p) => Math.hypot(p[0] - x, p[1] - z) >= 3.18), 'no lamp inside the waiting recess');
  // The front points back to a carriageway, never out into a garden.
  const front = new THREE.Vector3(0, 0, 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const hit = groundAt(x + front.x, z + front.z);
  if (!hit || hit.point.y > 0.08) failures.push([x, z, 'shelter faces away from the carriageway', hit?.point.y]);
}
assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 8)));
console.log(`PASS ${stops.length} shelters: full footprint paved, clear front walk, correct orientation, lamp clearance`);

// Solid motorway paint must remain continuous at the 60 m mesh-cell seams.
const ribbon = D.struct.ribbons.find((r) => r.id === 'M1');
let paintSamples = 0;
for (const x of [-60, 0, 60]) for (const dz of [-5.2, -1.4, 1.4, 5.2]) for (const eps of [-0.015, 0.015]) {
  const px = x + eps;
  const i = ribbon.p.findIndex((p, k) => k + 1 < ribbon.p.length && p[0] <= px && ribbon.p[k + 1][0] >= px);
  if (i < 0) continue;
  const a = ribbon.p[i], b = ribbon.p[i + 1], t = (px - a[0]) / (b[0] - a[0]), y = a[2] + (b[2] - a[2]) * t;
  C.ensureNear(px, -240); ctx.scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(px, y + 0.2, -240 + dz), new THREE.Vector3(0, -1, 0), 0, 0.3);
  const hit = ray.intersectObjects(C.deckMeshes(), false)[0];
  assert.ok(hit, 'paint has a drawn face at the seam');
  const rgb = hit.object.geometry.attributes.color;
  const c = new THREE.Color().fromArray(rgb.array, hit.face.a * 3).convertLinearToSRGB().getHex();
  assert.equal(c, D.colors[D.palette.white], `white paint interrupted at (${px}, ${-240 + dz})`);
  paintSamples++;
}
assert.equal(paintSamples, 24);
console.log(`PASS solid M1 paint at all ${paintSamples} sampled sides of cell seams`);
// Ground-founded structural faces must keep a 0.5 m gap from ground-level
// carriageways. Clip the WHOLE segment, not just its endpoints/midpoint.
const asphalt = [], walls = [];
for (const c of Object.values(D.cells)) {
  const q = c.r?.q || [], s = c.d?.s || [];
  for (let i = 0; i < q.length; i += 6) if (q[i + 5] === D.palette.asph) asphalt.push(q.slice(i, i + 4));
  for (let i = 0; i < s.length; i += 9) if (Math.max(s[i + 4], s[i + 6]) <= 0.01 && Math.min(s[i + 5], s[i + 7]) >= 1.2) walls.push(s.slice(i, i + 4));
}
const crosses = (s, r) => {
  let lo = 0, hi = 1;
  for (const [a, b, min, max] of [[s[0], s[2], r[0] - 0.49, r[2] + 0.49], [s[1], s[3], r[1] - 0.49, r[3] + 0.49]]) {
    if (Math.abs(b - a) < 1e-8) { if (a < min || a > max) return false; }
    else { const u = (min - a) / (b - a), v = (max - a) / (b - a); lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v)); if (lo > hi) return false; }
  }
  return true;
};
const closeWalls = walls.filter((s) => asphalt.some((r) => crosses(s, r)));
assert.equal(closeWalls.length, 0, 'support/wall closer than 0.5 m to asphalt: ' + JSON.stringify(closeWalls.slice(0, 5)));
assert.ok(walls.length > 20);
console.log(`PASS ${walls.length} structural faces keep >= 0.5 m carriageway clearance (1 cm numeric tolerance)`);
export { ctx };
