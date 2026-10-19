// Phone-view screenshots (the game's own camera, 390x664 iPhone 13) of plan C:  node tools/shoot-plan-c-phone.mjs OUT "name:x,z,dx,dy,dz" ...   (camera = player + (dx,dy,dz)); NIGHT=1 -> 22:00
import fs from 'node:fs';
import path from 'node:path';
import { openGame } from '../tests/lib/harness.mjs';
const out = path.resolve(process.argv[2] || 'shots'); fs.mkdirSync(out, { recursive: true });
const specs = process.argv.slice(3).map((s) => { const [n, r] = s.split(':'); const [x, z, dx, dy, dz] = r.split(',').map(Number); return { n, x, z, dx: dx ?? 9, dy: dy ?? 12, dz: dz ?? 12 }; });
const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
await g.page.evaluate((n) => { try { __TYCOON_V40__.setTime(n ? 22 : 12); } catch (_) {} }, !!process.env.NIGHT);
for (const s of specs) {
  await g.page.evaluate(({ x, z, dx, dy, dz }) => { PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(x, z); player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); PlanCV161.level = 0; for (let i = 0; i < 3; i++) updatePlayer(1 / 30); camera.position.set(x + dx, player.position.y + dy, z + dz); controls.target.set(x, player.position.y + 1, z); camera.lookAt(controls.target); }, s);
  await g.page.waitForTimeout(1800);
  await g.page.screenshot({ path: path.join(out, s.n + '.png') });
  console.log('shot', s.n);
}
console.log('errors', g.errors.slice(0, 5));
await g.close();
