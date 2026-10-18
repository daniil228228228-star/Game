// Screenshots of the plan C city with a free camera:  node tools/shoot-plan-c.mjs OUT_DIR "name:x,z,dist,el,az" ...   (el/az in degrees; el 90 = straight down)
import fs from 'node:fs';
import path from 'node:path';
import { openGame } from '../tests/lib/harness.mjs';
const out = path.resolve(process.argv[2] || 'shots'); fs.mkdirSync(out, { recursive: true });
const specs = process.argv.slice(3).map((s) => { const [n, r] = s.split(':'); const [x, z, d, el, az] = r.split(',').map(Number); return { n, x, z, d, el: el ?? 60, az: az ?? 0 }; });
const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
const errs = g.errors;
for (const s of specs) {
  const url = await g.page.evaluate(({ x, z, d, el, az }) => {
    if (d > 200) { PlanCV161.R_BUILD = 900; PlanCV161.R_KEEP = 1200; }
    PlanCV161.ensureNear(x, z);
    const cv = renderer.domElement, cam = new THREE.PerspectiveCamera(50, cv.width / cv.height, 0.3, 900);
    const E = el * Math.PI / 180, A = az * Math.PI / 180;
    cam.position.set(x + Math.sin(A) * Math.cos(E) * d, Math.sin(E) * d, z + Math.cos(A) * Math.cos(E) * d); cam.up.set(0, 1, 0); cam.lookAt(x, 0, z); cam.updateMatrixWorld(true);
    const fog = scene.fog; scene.fog = null;
    renderer.render(scene, cam); const calls = renderer.info.render.calls;
    const u = cv.toDataURL('image/jpeg', 0.88); scene.fog = fog; window.__lastCalls = calls; return u;
  }, s);
  fs.writeFileSync(path.join(out, s.n + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', s.n, 'calls', await g.page.evaluate(() => window.__lastCalls));
}
console.log('stats', JSON.stringify(await g.page.evaluate(() => PlanCV161.stats())));
console.log('errors', errs.slice(0, 8));
await g.close();
