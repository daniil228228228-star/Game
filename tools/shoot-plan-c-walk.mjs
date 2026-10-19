// Walk-view shots (the game's own follow camera, phone 390x664) ALONG ramps / decks of plan C: the player stands on the surface and looks along the route.
//   node tools/shoot-plan-c-walk.mjs OUT "name:ramp,frac[,back,up]" ...     ramp = index in PlanCDataV161.graph.ramps, frac 0..1 along it, back/up = camera distance behind / height above the player (default 6.5 / 4.5)
//   node tools/shoot-plan-c-walk.mjs OUT "name@x,z,dirx,dirz[,y,back,up]"    free position (y = deck height) and viewing direction
// NIGHT=1 -> 22:00. The camera is set once and then the game's own obstruction resolver / follow code runs for ~2 s (that is what the player sees).
import fs from 'node:fs';
import path from 'node:path';
import { openGame } from '../tests/lib/harness.mjs';
const out = path.resolve(process.argv[2] || 'shots'); fs.mkdirSync(out, { recursive: true });
const specs = process.argv.slice(3).map((s) => {
  if (s.includes('@')) { const [n, r] = s.split('@'); const [x, z, dx, dz, y, back, up] = r.split(',').map(Number); return { n, x, z, dx, dz, y: y || 0, back: back || 6.5, up: up || 4.5 }; }
  const [n, r] = s.split(':'); const [ramp, frac, back, up] = r.split(',').map(Number); return { n, ramp, frac, back: back || 6.5, up: up || 4.5 };
});
const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
await g.page.evaluate((n) => { try { __TYCOON_V40__.setTime(n ? (Number(n) > 1 ? Number(n) : 22) : 12); } catch (_) {} }, process.env.HOUR || (process.env.NIGHT ? 22 : 0));
for (const s of specs) {
  await g.page.evaluate((s) => {
    let x = s.x, z = s.z, y = s.y, dx = s.dx, dz = s.dz;
    if (s.ramp !== undefined) { const pts = PlanCDataV161.graph.ramps[s.ramp][2]; const i = Math.max(1, Math.min(pts.length - 2, Math.round(s.frac * (pts.length - 1)))); const a = pts[i - 1], b = pts[i + 1]; x = pts[i][0]; z = pts[i][1]; y = pts[i][2]; dx = b[0] - a[0]; dz = b[1] - a[1]; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(x, z); player.position.set(x, y, z); playerVelocity.set(0, 0, 0); PlanCV161.level = y;
    for (let i = 0; i < 3; i++) updatePlayer(1 / 30);
    player.rotation.y = Math.atan2(dx, dz);
    camera.position.set(x - dx * s.back, player.position.y + s.up, z - dz * s.back); controls.target.set(x, player.position.y + 1, z); camera.lookAt(controls.target);
  }, s);
  await g.page.waitForTimeout(2200);
  await g.page.screenshot({ path: path.join(out, s.n + '.png') });
  console.log('shot', s.n);
}
console.log('errors', g.errors.slice(0, 5));
await g.close();
