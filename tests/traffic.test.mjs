// Regression test for the one-sided perpetual-yield bug reported by the user (Russian):
// "я бы проработал бы еще над физикой машин, а то одна ездит, а другая стоит на повороте, ждет
// пока проедет другая" -- one delivery truck drives normally while another stands at a turn
// waiting for it to pass, seemingly forever.
//
// Root cause (see CHANGELOG_V116.md dated section for the full live investigation):
// serviceVehicleYieldFactor() (tycoon-v116.html, ~line 7269) resolves a genuine crossing conflict
// between two service vehicles with a purely STATIC tie-break (cargo-loaded state, then a plain
// string comparison of logisticsId). It has no notion of how long either vehicle has already been
// waiting. At a junction where one vehicle's route repeatedly passes near another's, the vehicle
// that loses the static comparison loses it EVERY time, with no bound on how long it waits --
// confirmed live with the real, unmodified function: a vehicle already stuck 6 real seconds at a
// real crossing still got yield factor 0 against a rival that had never been stuck at all, and a
// live two-truck scene left the loser frozen at its start position for the full 20s measurement
// window before the fix, every time.
//
// Fix: serviceVehicleYieldFactor's crossing-conflict tie-break now checks each vehicle's
// `_auditStuck` (already computed every frame by the pre-existing updateVehicleProgressWatch()) --
// once one side has been genuinely stuck at least ~2s longer than the other, it takes priority
// over the static cargo/ID rule, so the loser is guaranteed to get a turn instead of waiting
// unboundedly. This only touches the crossing branch; the sameLane (real car-following/physical
// body ahead) branch above it is untouched, so this can never let a vehicle drive through another
// vehicle's actual body.
import { openGame, OLD_SAVE, assert, assertEqual, checkAllScriptBlocks } from './lib/harness.mjs';

// Calls the REAL, unmodified serviceVehicleYieldFactor(vehicle, target) in-page against
// synthetic-but-realistic vehicle objects (same userData shape the real code reads). This is a
// live test of the exact production function, not a re-implementation of its logic.
async function yieldFactorFor(page, { lId, lStuck, lLoaded, wId, wStuck, wLoaded, wx, wz, headingDeg }) {
  return page.evaluate(({ lId, lStuck, lLoaded, wId, wStuck, wLoaded, wx, wz, headingDeg }) => {
    function makeVehicle(x, z, id, loaded, stuck) {
      return {
        position: new THREE.Vector3(x, 0, z),
        visible: true,
        userData: {
          role: 'delivery', state: 'outbound', logisticsId: id,
          deliveryTicket: loaded ? { delivered: false } : null,
          path: [], pathIndex: 0, _auditStuck: stuck,
        },
      };
    }
    const L = makeVehicle(0, 0, lId, lLoaded, lStuck);
    const Ltarget = { x: 0, z: 5 }; // L always wants to go "north"
    const rad = headingDeg * Math.PI / 180;
    const W = makeVehicle(wx, wz, wId, wLoaded, wStuck);
    // W's own heading, at headingDeg from north -- 90 = a classic perpendicular X-junction
    // crossing, 45/135 = a T-junction merge/diverge angle. Never parallel to L (that would be
    // the sameLane car-following case, deliberately out of scope here -- see the comment above).
    W.userData.path = [
      { x: wx, z: wz },
      { x: wx + Math.sin(rad), z: wz + Math.cos(rad) },
    ];
    const before = serviceVehicles.slice();
    serviceVehicles.length = 0;
    serviceVehicles.push(L, W);
    const factor = serviceVehicleYieldFactor(L, Ltarget);
    serviceVehicles.length = 0;
    for (const v of before) serviceVehicles.push(v);
    return factor;
  }, { lId, lStuck, lLoaded, wId, wStuck, wLoaded, wx, wz, headingDeg });
}

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  // --- 0. Every inline <script> block still parses (this fix edited the existing
  //         serviceVehicleYieldFactor() function in place, no new <script> layer). ---
  {
    const { blockCount, errors } = await checkAllScriptBlocks();
    assertEqual(errors.length, 0, `all inline script blocks must pass node --check, got: ${JSON.stringify(errors)}`);
    ok(`all ${blockCount} inline script blocks pass node --check`);
  }

  const game = await openGame({ save: OLD_SAVE, waitMs: 2500 });
  const { page } = game;
  try {
    // --- 1. Immediate safety is unchanged: a vehicle that just arrived at a crossing (no
    //         accumulated wait at all) still yields normally to a rival at close range, at three
    //         different junction angles (X-junction 90 deg, T-junction merge 45/135 deg). This
    //         must still be true after the fix -- the fairness override must never weaken the
    //         very first, safety-critical encounter. ---
    for (const headingDeg of [90, 45, 135]) {
      const factor = await yieldFactorFor(page, {
        lId: 'delivery_zzz_loser', lStuck: 0, lLoaded: true,
        wId: 'delivery_aaa_winner', wStuck: 0, wLoaded: true,
        wx: 0, wz: 0.6, headingDeg,
      });
      assertEqual(factor, 0, `fresh crossing encounter at ${headingDeg} deg must still fully yield (factor 0), got ${factor}`);
    }
    ok('fresh crossing encounters (0s stuck either side) still yield normally at X- and T-junction angles');

    // --- 2. The actual bug: a vehicle that loses the static tie-break stays yieldToOther=0
    //         forever if it never gets a fairness bump. Confirm the OLD, purely-static-rule
    //         failure mode is gone: after being stuck long enough, the same static "loser" now
    //         gets priority over a rival that has never been stuck, at multiple junction angles. ---
    for (const headingDeg of [90, 60, 135]) {
      const stuckFactor = await yieldFactorFor(page, {
        lId: 'delivery_zzz_loser', lStuck: 6.0, lLoaded: true,
        wId: 'delivery_aaa_winner', wStuck: 0, wLoaded: true,
        wx: 0.3, wz: 0.6, headingDeg,
      });
      assertEqual(stuckFactor, 1, `a vehicle stuck 6s at a ${headingDeg} deg crossing against a never-stuck rival must get priority (factor 1), got ${stuckFactor}`);
    }
    ok('a genuinely long-stuck vehicle now gets priority over a static tie-break loss at multiple junction angles (X and T)');

    // --- 3. Fairness is bounded/graduated, not a hair-trigger: a small head start (under the
    //         ~2s+1.2s margin) must NOT flip priority, or two vehicles could ping-pong priority
    //         every frame from float jitter alone. ---
    {
      const factor = await yieldFactorFor(page, {
        lId: 'delivery_zzz_loser', lStuck: 0.9, lLoaded: true,
        wId: 'delivery_aaa_winner', wStuck: 0.4, wLoaded: true,
        wx: 0.3, wz: 0.6, headingDeg: 90,
      });
      assertEqual(factor, 0, `a small stuck-time lead (0.9s vs 0.4s) must not flip the static tie-break yet, got ${factor}`);
    }
    ok('small stuck-time differences do not flip priority (no jitter/ping-pong risk)');

    // --- 4. Symmetric mutual stall (both genuinely stuck a similar amount): falls back to the
    //         static rule rather than flip-flopping, leaving the existing v74 deadlock guard
    //         (pairwise, physical-nudge based) as the one responsible for that separate case. ---
    {
      const factor = await yieldFactorFor(page, {
        lId: 'delivery_zzz_loser', lStuck: 5.0, lLoaded: true,
        wId: 'delivery_aaa_winner', wStuck: 4.6, wLoaded: true,
        wx: 0.3, wz: 0.6, headingDeg: 90,
      });
      assertEqual(factor, 0, `near-equal mutual stall must not flip priority every frame, got ${factor}`);
    }
    ok('near-equal mutual stall (both similarly stuck) stays on the static rule, not a per-frame flip');

    // --- 5. Live, full-integration end-to-end check with real service vehicles driven by the
    //         real animate loop (not the isolated function call above): the previously-losing
    //         truck must make real forward progress within a bounded, real-time window even
    //         while a rival genuinely keeps occupying the crossing, instead of staying frozen
    //         for the whole observation window. ---
    {
      await page.evaluate(() => { stageIndex = 6; money = 999999; planks = 999; concrete = 999; metal = 999; syncDeliveryFleet(); });
      await page.waitForTimeout(400);
      const setup = await page.evaluate(() => {
        const L = serviceVehicles.find(v => v.userData?.fixedCargo === 'planks');
        const W = serviceVehicles.find(v => v.userData?.fixedCargo === 'concrete') || serviceVehicles.find(v => v.userData?.isUniversalTruck);
        if (!L || !W) return { ok: false };
        L.userData.logisticsId = 'delivery_zzz_forced_loser';
        W.userData.logisticsId = 'delivery_aaa_forced_winner';
        const cx = -10, cz = 0;
        L.position.set(cx, 0, cz);
        L.userData.role = 'delivery'; L.userData.state = 'outbound';
        L.userData.deliveryTicket = { delivered: false, cargo: 'planks' };
        L.userData.path = [{ x: cx, z: cz }, { x: cx, z: cz + 6 }];
        L.userData.pathIndex = 0; L.userData.currentSpeed = 0;
        L.userData._auditStuck = 0; L.userData._auditSampleTime = 0;
        L.userData._auditWatchState = 'outbound'; L.userData._auditLastPos = L.position.clone();
        window.__trafficTest = { lId: L.userData.logisticsId, wId: W.userData.logisticsId };
        window.__trafficTestTimer = setInterval(() => {
          W.userData.role = 'delivery'; W.userData.state = 'outbound';
          W.userData.deliveryTicket = { delivered: false, cargo: W.userData.fixedCargo || 'concrete' };
          W.position.x = L.position.x + 0.3; W.position.z = L.position.z + 0.6;
          W.userData.path = [{ x: L.position.x - 3, z: L.position.z + 0.6 }, { x: L.position.x + 3, z: L.position.z + 0.6 }];
          W.userData.pathIndex = 0;
        }, 100);
        return { ok: true };
      });
      assert(setup.ok, 'test setup must find a planks truck and a second (concrete/universal) truck');

      let cleared = false;
      const startZ = (await page.evaluate(() => serviceVehicles.find(v => v.userData.logisticsId === window.__trafficTest.lId).position.z));
      const DEADLINE_S = 15; // generous but bounded -- must NOT be "never" like the pre-fix run (20s, 0 movement)
      const stepMs = 500;
      for (let i = 0; i < (DEADLINE_S * 1000) / stepMs; i++) {
        const z = await page.evaluate(() => serviceVehicles.find(v => v.userData.logisticsId === window.__trafficTest.lId).position.z);
        if (Math.abs(z - startZ) > 0.5) { cleared = true; break; }
        await page.waitForTimeout(stepMs);
      }
      await page.evaluate(() => clearInterval(window.__trafficTestTimer));
      assert(cleared, `previously-losing truck must move >0.5m within ${DEADLINE_S}s of real time despite a rival continuously occupying the crossing (pre-fix: never moved in 20s)`);
      ok(`previously-losing truck made real forward progress within ${DEADLINE_S}s (live, full-integration check)`);
    }
  } finally {
    await game.close();
  }

  console.log(`\n${failures === 0 ? 'traffic.test.mjs: PASS' : `traffic.test.mjs: FAIL (${failures} failure(s))`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
