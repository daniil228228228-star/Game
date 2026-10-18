// Geometry previews using the repository's software rasteriser, NOT WebGL
// screenshots. The scene comes from the actual compiled/runtime Plan C meshes.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ctx } from '../tests/plan-c-c1c-geometry.test.mjs';
const require = createRequire(import.meta.url);
const { render, save } = require('./offline-v161/render.cjs');
const { THREE, PlanCV161: C, PlanCDataV161: D } = ctx;
const out = path.resolve(process.argv[2] || 'scratchpad/c1c-software');
fs.mkdirSync(out, { recursive: true });
const stops = Object.values(D.cells).flatMap((c) => {
  const a = c.f?.stop || [], r = []; for (let i = 0; i < a.length; i += 4) r.push(a.slice(i, i + 4)); return r;
});
const stop = stops.find((s) => Math.abs(s[0]) < 150 && Math.abs(s[1]) < 100);
const specs = [
  { name: 'bridge-ramp', at: [123.6, 1.8, -10], dist: 42, az: 1.0, el: 0.45 },
  { name: 'underpass', at: [0, 1.5, -240], dist: 36, az: 0.6, el: 0.3 },
  { name: 'bus-stop', at: [stop[0], 0.8, stop[1]], dist: 13, az: stop[2] + 0.6, el: 0.65 },
  { name: 'curb-corner', at: [0, 0.3, 120], dist: 24, az: 0.5, el: 0.9 },
];
for (const spec of specs) {
  C.ensureNear(spec.at[0], spec.at[2]); ctx.scene.updateMatrixWorld(true);
  const group = new THREE.Group();
  C.root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.name === 'planCfurn_lamppool' || o.name === 'planCfurn_lampglow') return;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        const m = new THREE.Matrix4(); o.getMatrixAt(i, m); m.premultiply(o.matrixWorld);
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        if (Math.hypot(p.x - spec.at[0], p.z - spec.at[2]) > 75) continue;
        const mesh = new THREE.Mesh(o.geometry, o.material); mesh.matrix.copy(m); mesh.matrixAutoUpdate = false; group.add(mesh);
      }
    } else { const mesh = new THREE.Mesh(o.geometry, o.material); mesh.matrix.copy(o.matrixWorld); mesh.matrixAutoUpdate = false; group.add(mesh); }
  });
  const result = render(group, { W: 780, H: 780, target: spec.at, dist: spec.dist, az: spec.az, el: spec.el, ground: false, fov: 55 });
  const file = path.join(out, spec.name + '.jpg'); await save(result, file);
  console.log('SOFTWARE PREVIEW', file);
}
