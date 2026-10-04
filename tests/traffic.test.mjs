// serviceVehicleYieldFactor (tycoon-v161.html:7421) -- direct function-level checks against the REAL
// function with synthetic vehicles of the same userData shape the game uses (ported from
// archive/tycoon-v116/tests/traffic.test.mjs; v161 still has our fairness override at :7476-7485).
// Covers: fresh crossing yields, long-stuck vehicle gets priority (no one-sided perpetual yield),
// no hair-trigger flip, car-following gap, parked vehicles out of the corridor don't block.
// serviceVehicles is swapped out for the call and restored, so the live scene is unaffected.
import { openGame, check } from './lib/harness.mjs';

const g = await openGame({ save: 'clear', waitMs: 3500 });
const { page } = g;

const factor = (cfg) => page.evaluate((c) => {
  const mk = (x, z, id, loaded, stuck, state, headingDeg) => {
    const rad = headingDeg * Math.PI / 180;
    return {
      position: new THREE.Vector3(x, 0, z), visible: true,
      userData: {
        role: 'delivery', state, logisticsId: id, deliveryTicket: loaded ? { delivered: false } : null,
        path: [{ x, z }, { x: x + Math.sin(rad), z: z + Math.cos(rad) }], pathIndex: 0, _auditStuck: stuck,
      },
    };
  };
  const L = mk(0, 0, 'delivery_zzz_loser', true, c.lStuck ?? 0, 'outbound', 0);
  const W = mk(c.wx, c.wz, 'delivery_aaa_winner', c.wLoaded ?? true, c.wStuck ?? 0, c.wState ?? 'outbound', c.heading);
  const saved = serviceVehicles.slice();
  serviceVehicles.length = 0;
  serviceVehicles.push(L, ...(c.noRival ? [] : [W]));
  let f;
  try { f = serviceVehicleYieldFactor(L, { x: 0, z: 5 }); } finally { serviceVehicles.length = 0; saved.forEach((v) => serviceVehicles.push(v)); }
  return f;
}, cfg);

check(await page.evaluate(() => typeof serviceVehicleYieldFactor) === 'function', 'serviceVehicleYieldFactor exists');
check(await factor({ noRival: true, wx: 0, wz: 0, heading: 0 }) === 1, 'alone on the road: factor 1');

for (const heading of [90, 60, 45, 135]) {
  const f = await factor({ wx: 0, wz: 0.6, heading });
  check(f === 0, `fresh crossing at ${heading} deg (both loaded, 0s stuck) still fully yields: ${f}`);
}
for (const heading of [90, 60, 135]) {
  const f = await factor({ lStuck: 6, wx: 0.3, wz: 0.6, heading });
  check(f === 1, `vehicle stuck 6s vs never-stuck rival at ${heading} deg gets priority (no perpetual yield): ${f}`);
}
check(await factor({ lStuck: 0.9, wStuck: 0.4, wx: 0.3, wz: 0.6, heading: 90 }) === 0, 'small stuck lead (0.9s vs 0.4s) does not flip priority');
check(await factor({ lStuck: 5.0, wStuck: 4.6, wx: 0.3, wz: 0.6, heading: 90 }) === 0, 'near-equal mutual stall stays on the static rule (no per-frame flip)');
check(await factor({ lStuck: 0, wLoaded: false, wx: 0.3, wz: 0.6, heading: 90 }) === 1, 'loaded vehicle has right of way over an empty one at a crossing');

// car-following (same lane): only the vehicle physically behind yields, and the gap eases in
check(await factor({ wx: 0, wz: 1.8, heading: 0 }) === 0, 'rival 1.8 m directly ahead in the same lane: stop (0)');
const mid = await factor({ wx: 0, wz: 3.2, heading: 0 });
check(mid > 0 && mid < 1, `rival 3.2 m ahead: slows proportionally (${mid.toFixed(2)})`);
check(await factor({ wx: 0, wz: -1.8, heading: 0 }) === 1, 'rival behind in the same lane never blocks');
check(await factor({ wx: 0, wz: 3.9, heading: 0 }) > 0.9, 'rival at the edge of the free gap barely slows');

// parked (idle) vehicles block only when inside the swept corridor
check(await factor({ wState: 'idle', wLoaded: false, wx: 3, wz: 0.5, heading: 90 }) === 1, 'parked vehicle beside the route (3 m lateral) does not block');
check(await factor({ wState: 'idle', wLoaded: false, wx: 0, wz: 0.8, heading: 90 }) === 0, 'parked vehicle inside the swept corridor blocks');

check(g.errors.length === 0, `no console errors ${JSON.stringify(g.errors.slice(0, 3))}`);
await g.close();
