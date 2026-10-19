// Camera-in-geometry probe for plan C: stands the player on accessible ground right beside every kind of wall / bank / deck edge (fill quads of PlanCDataV161.struct.fills), lets the game's own
// camera resolver run, and reports how often the final camera has a drawn deck / wall mesh between it and the player's head, or sits closer than 1 m to him.   node tools/probe-camera-plan-c.mjs [--n=60]
import { openGame } from '../tests/lib/harness.mjs';
const n = Number((process.argv.find((a) => a.startsWith('--n=')) || '--n=60').split('=')[1]);
const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
const r = await g.page.evaluate(async (n) => {
  const D = PlanCDataV161, fills = D.struct.fills, spots = [];
  const step = Math.max(1, Math.floor(fills.length / n));
  for (let i = 0; i < fills.length && spots.length < n; i += step) {
    const q = fills[i], cx = (q[0] + q[2] + q[4] + q[6]) / 4, cz = (q[1] + q[3] + q[5] + q[7]) / 4;
    for (let rad = 1.2; rad < 14; rad += 0.8) { let found = null; for (let a = 0; a < 16 && !found; a++) { const x = cx + Math.cos(a * Math.PI / 8) * rad, z = cz + Math.sin(a * Math.PI / 8) * rad; if (D.access(x, z, 0.6, 0) && D.ground(x, z)) found = [x, z]; } if (found) { spots.push(found); break; } }
  }
  const out = { spots: spots.length, hits: 0, close: 0, rows: [] };
  for (const [x, z] of spots) {
    for (const az of [0, 90, 180, 270]) {
      PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(x, z); player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); PlanCV161.level = 0; for (let k = 0; k < 3; k++) updatePlayer(1 / 30);
      const A = az * Math.PI / 180; camera.position.set(x + Math.sin(A) * 6.5, 4.5, z + Math.cos(A) * 6.5); controls.target.set(x, 1, z); camera.lookAt(controls.target);
      for (let k = 0; k < 2; k++) await new Promise((rr) => requestAnimationFrame(rr));
      camera.position.set(x + Math.sin(A) * 6.5, 4.5, z + Math.cos(A) * 6.5); controls.target.set(x, 1, z); for (let k = 0; k < 6; k++) resolveCameraObstructionV85(1 / 30);   // the game's own resolver, as animate() runs it
      const head = new THREE.Vector3(x, 1.4, z), d = camera.position.distanceTo(head), dir = camera.position.clone().sub(head).normalize();
      const rc = new THREE.Raycaster(head, dir, 0.05, d - 0.05); const meshes = []; PlanCV161.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) meshes.push(o); });
      const hit = rc.intersectObjects(meshes, false)[0];
      if (hit) { out.hits++; if (out.rows.length < 6) out.rows.push([+x.toFixed(1), +z.toFixed(1), az, +hit.distance.toFixed(2), +d.toFixed(2), hit.object.name]); }
      if (d < 1.2) out.close++;
    }
  }
  return out;
}, n);
console.log(JSON.stringify(r));
console.log('errors', g.errors.slice(0, 3));
await g.close();
