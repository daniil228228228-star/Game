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
const specs = process.argv.includes('--kerbs') ? [
  { name: 'industrial-bend', at: [-88,0.2,-151], dist: 35, az: 0.7, el: 0.55 },
  { name: 'pnr-island', at: [296,0.2,58], dist: 22, az: 0.7, el: 0.4 },
  { name: 'central-island', at: [0,0.2,0], dist: 31, az: 0.7, el: 0.42 },
  { name: 'port-join', at: [225,0.2,160], dist: 31, az: 0.4, el: 0.5 },
] : process.argv.includes('--navigation') ? [
  { name: 'mini-ring', at: [D.graph.minis[0][1],0.4,D.graph.minis[0][2]], dist: 31, az: 0.3, el: 1.3 },
  { name: 'i2-east-receiving', at: [285,0.4,3], dist: 42, az: 0.2, el: 1.3 },
  { name: 'central-square', at: [0,0.5,0], dist: 54, az: 0.1, el: 1.3 },
] : process.argv.includes('--network-fixes') ? [
  { name: 'pnr-return', at: [288, 0.5, 35], dist: 95, az: 0.2, el: 1.25 },
  { name: 'port-turnaround', at: [315, 0.5, 160], dist: 85, az: 0.3, el: 1.2 },
  { name: 'm1-east', at: [325, 1, -240], dist: 120, az: 0.2, el: 1.25 },
] : process.argv.includes('--interchanges') ? [
  { name: 'diamond-main', at: [0, 1, -240], dist: 170, az: 0.6, el: 0.9 },
  { name: 'diamond-east', at: [250, 1, 0], dist: 150, az: 2.1, el: 0.9 },
  { name: 'motorway-toe', at: [-100, 0.5, -240], dist: 27, az: -1.0, el: 0.32 },
  { name: 'merge-close', at: [250, 1.5, 68], dist: 32, az: 2.6, el: 0.5 },
  { name: 'cloverleaf', at: [250, 1.5, -240], dist: 170, az: 0.6, el: 0.95 },
  { name: 'trumpet', at: [245, 1, 155], dist: 160, az: 0.4, el: 0.95 },
] : [
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
