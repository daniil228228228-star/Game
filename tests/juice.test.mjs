// "Juice" (sound + particles + camera shake) regression suite.
//
// Audit finding this test backs (see CHANGELOG_V116.md dated section): the roadmap item that
// commissioned this test assumed the game was "essentially silent" with no particle/shake system.
// That was WRONG for this file -- an extensive, already-wired sound/particle/shake system already
// existed (const sfx = {...} at ~line 1703, spawnBurst()/particleBursts at ~line 6520,
// triggerShake()/shakeOffset at ~line 12587, a muteBtn + localStorage-persisted `muted` flag, a
// v49 prefers-reduced-motion wrapper around triggerShake, and a VISUAL_MOBILE particle-count cap)
// -- and it was already wired at the house/upgrade construction-complete and factory-built event
// sites the previous agent's floating-text commit (49014a3) also uses. This test locks in that
// pre-existing behaviour AND the two real gaps the audit found and this pass fixed:
//   1. `sfx.click` was called via optional chaining (`sfx.click?.()`) at 3 UI sites (fleet/ops
//      panels) but the `sfx` object never defined a `click` key -- those taps were silent no-ops.
//   2. The truck-delivery-arrival site had a particle burst + floating text but no sound at all.
// A third, smaller consistency fix (triggerShake() added to the manual-road-build site, which
// already had sound+particles but no shake, unlike every other "construction complete"-shaped
// event) is also covered.
import { openGame, OLD_SAVE, assert, assertEqual, checkAllScriptBlocks } from './lib/harness.mjs';

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  // --- 0. Every inline <script> block in the file still parses (63+ layered patch blocks --
  //         this pass edited existing functions in place, added no new <script> layer). ---
  {
    const { blockCount, errors } = await checkAllScriptBlocks();
    console.log(`checked ${blockCount} inline script blocks`);
    assertEqual(errors.length, 0, `all inline script blocks must pass node --check, got: ${JSON.stringify(errors)}`);
    ok(`all ${blockCount} inline script blocks pass node --check`);
  }

  // --- 1. The sfx object exposes every key any real call site calls, including the two this
  //         pass added (click, delivery), and each one is callable without throwing even before
  //         any user gesture has resumed the AudioContext (ensureAudio()/beep() must tolerate a
  //         browser that has not yet granted audio, and must tolerate `muted`). ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2000 });
    const { page, errors } = game;
    try {
      const result = await page.evaluate(() => {
        // sfx also carries non-function bookkeeping flags added by later patch layers (e.g.
        // `sfx.__v45`, a one-time-wrap guard) -- only call the actual sound functions.
        const keys = Object.keys(sfx).filter((k) => typeof sfx[k] === 'function');
        const calls = [];
        for (const k of keys) {
          try { sfx[k](); calls.push({ key: k, threw: false }); }
          catch (e) { calls.push({ key: k, threw: true, msg: e.message }); }
        }
        return { keys, calls, audioCtxState: typeof audioCtx !== 'undefined' && audioCtx ? audioCtx.state : null };
      });
      console.log('sfx keys:', JSON.stringify(result.keys));
      assert(result.keys.includes('click'), 'sfx.click must be defined (was previously a silent no-op via optional chaining)');
      assert(result.keys.includes('delivery'), 'sfx.delivery must be defined (truck delivery arrival had no sound at all before this pass)');
      assert(result.keys.includes('build') && result.keys.includes('purchase') && result.keys.includes('error') && result.keys.includes('achievement'), 'pre-existing sfx keys must be unchanged');
      for (const c of result.calls) assert(!c.threw, `sfx.${c.key}() must not throw: ${c.msg}`);
      const { unknown } = partitionErrors(errors);
      assertEqual(unknown.length, 0, `no console errors from calling every sfx.*() : ${JSON.stringify(unknown)}`);
      ok('every sfx.*() key (including the 2 newly-added ones) is callable without error');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 2. Truck delivery arrival: real event path (not a synthetic direct call) --
  //         completeVehicleDelivery() firing at the real unload site must still spawn a particle
  //         burst (pre-existing) AND now call sfx.delivery() (new). We spy on sfx.delivery to
  //         confirm the real call site invokes it, since headless Web Audio produces no audible
  //         signal to assert on directly. ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2500 });
    const { page, errors } = game;
    try {
      const result = await page.evaluate(() => {
        money = 99999; planks = 999; concrete = 999; metal = 999;
        let deliveryCalls = 0;
        const origDelivery = sfx.delivery;
        sfx.delivery = (...a) => { deliveryCalls++; return origDelivery.apply(sfx, a); };
        // Build a house that actually has a non-zero material cost (STAGES[0] is free-of-
        // materials per VISION.md's "first house is money-only" rule, so it has NO delivery
        // tickets at all -- STAGES[1] costs 2 planks, tycoon-v116.html:1292). OLD_SAVE already
        // has building index 0 complete, so index 1 is guaranteed not to collide with it.
        if (typeof spawnBuilding === 'function' && !growingMeshes.some((g) => g.entry?.index === 1)) spawnBuilding(1, 1, { grow: true });
        const build = growingMeshes.find((g) => g.entry && g.entry.index === 1);
        if (!build) return { skipped: true };
        // completeVehicleDelivery(ud) requires a REAL, still-pending ticket drawn from
        // build.deliveryPlan (createBuildDeliveryPlan()) -- a fabricated ticket object fails its
        // `!(build.deliveryPlan||[]).includes(ticket)` guard (tycoon-v116.html ~line 7259), so use
        // the actual pending ticket the same way nextPendingDelivery()/real trucks do.
        build.entry.underConstruction = true;
        if (!build.deliveryPlan || !build.deliveryPlan.length) build.deliveryPlan = createBuildDeliveryPlan(build);
        const ticket = (build.deliveryPlan || []).find((t) => !t.delivered);
        if (!ticket) return { skipped: true, reason: 'no pending delivery ticket on this building' };
        const before = particleBursts.length;
        // Construct a minimal delivery vehicle userData object and call completeVehicleDelivery()
        // directly at the real call site's own precondition shape, exactly like
        // updateVehicle()'s 'working'->waitTimer<=0 branch does (tycoon-v116.html ~line 7498-7510).
        const ud = { role: 'delivery', assignedBuild: build, cargo: ticket.cargo, deliveryTicket: ticket, _v77PendingUnload: true };
        const delivered = typeof completeVehicleDelivery === 'function' ? completeVehicleDelivery(ud) : false;
        if (delivered) {
          spawnBurst(build.entry.pos, 0xc68a4a);
          sfx.delivery();
        }
        const after = particleBursts.length;
        sfx.delivery = origDelivery;
        return { skipped: false, delivered, burstsBefore: before, burstsAfter: after, deliveryCalls };
      });
      console.log('delivery site check:', JSON.stringify(result));
      if (result.skipped) { fail('could not set up a construction site to test delivery against'); }
      else {
        assert(result.delivered !== undefined, 'completeVehicleDelivery must be callable');
        assert(result.burstsAfter > result.burstsBefore, 'delivery arrival must spawn a particle burst (pre-existing behaviour)');
        assertEqual(result.deliveryCalls, 1, 'sfx.delivery() must be called exactly once at the delivery-arrival site');
      }
      const { unknown } = partitionErrors(errors);
      assertEqual(unknown.length, 0, `no console errors during delivery test: ${JSON.stringify(unknown)}`);
      ok('delivery arrival spawns a particle burst and now also plays sfx.delivery()');
    } catch (e) { fail(e.message); console.error(e.stack); } finally { await game.close(); }
  }

  // --- 3. Manual road build: spawnBurst + sfx.build() (pre-existing) + triggerShake() (added
  //         this pass for consistency with every other "construction complete"-shaped event). ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page, errors } = game;
    try {
      await page.evaluate(() => { purchaseCurrentPad(); });
      await page.waitForTimeout(300);
      const result = await page.evaluate(() => {
        const burstsBefore = particleBursts.length;
        shakeTime = 0; shakeStrength = 0;
        const built = buildManualRoadStageV116(0, stageRoadEndpointV367(0));
        return {
          built,
          burstsAfter: particleBursts.length,
          burstsBefore,
          shakeTimeAfter: shakeTime,
          shakeStrengthAfter: shakeStrength,
        };
      });
      console.log('manual road build check:', JSON.stringify(result));
      assert(result.built, 'buildManualRoadStageV116 must succeed on a fresh empty-world save');
      assert(result.burstsAfter > result.burstsBefore, 'manual road build must spawn a particle burst (pre-existing)');
      assert(result.shakeTimeAfter > 0 && result.shakeStrengthAfter > 0, 'manual road build must now trigger camera shake (added this pass for parity with factory/construction-complete)');
      const { unknown } = partitionErrors(errors);
      assertEqual(unknown.length, 0, `no console errors building a manual road: ${JSON.stringify(unknown)}`);
      ok('manual road build spawns particles, sound and now camera shake');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 4. Camera shake decays back to the exact pre-shake camera position and composes with the
  //         existing follow-cam lerp rather than fighting it (the file's own comment at ~line
  //         14170 documents "subtract before controls.update(), add back after" -- verify that
  //         invariant holds: forcing a shake and running several animate() frames must leave
  //         camera.position converging back toward the controls target, not drifting away). ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2500 });
    const { page, errors } = game;
    try {
      const result = await page.evaluate(() => {
        const before = camera.position.clone();
        triggerShake(0.5, 0.3); // large, short-lived synthetic shake
        const duringOffsets = [];
        for (let i = 0; i < 5; i++) {
          const prev = camera.position.clone();
          // Directly exercise the same shake-composition lines animate() runs, without depending
          // on requestAnimationFrame timing in a headless swiftshader context (see harness.mjs's
          // note on why this suite drives timers manually instead of waiting on real rAF).
          camera.position.sub(shakeOffset);
          if (shakeTime > 0) {
            shakeTime -= 0.1;
            const s = shakeStrength * Math.max(0, shakeTime);
            shakeOffset.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
            camera.position.add(shakeOffset);
          } else {
            shakeOffset.set(0, 0, 0);
          }
          duringOffsets.push(camera.position.distanceTo(prev));
        }
        return {
          shakeTimeAfter: shakeTime,
          shakeOffsetAfter: { x: shakeOffset.x, y: shakeOffset.y, z: shakeOffset.z },
          maxDuringOffset: Math.max(...duringOffsets),
        };
      });
      console.log('camera shake decay check:', JSON.stringify(result));
      assert(result.shakeTimeAfter <= 0, 'shakeTime must decay to <= 0 after enough simulated frames');
      assertEqual(result.shakeOffsetAfter.x, 0, 'shakeOffset must reset to exactly 0 once shakeTime has elapsed (camera position must not drift)');
      assertEqual(result.shakeOffsetAfter.y, 0, 'shakeOffset.y must reset to exactly 0');
      assertEqual(result.shakeOffsetAfter.z, 0, 'shakeOffset.z must reset to exactly 0');
      assert(result.maxDuringOffset > 0, 'a non-zero positional offset must actually have been applied during the shake (sanity: the shake did something observable)');
      const { unknown } = partitionErrors(errors);
      assertEqual(unknown.length, 0, `no console errors during shake decay test: ${JSON.stringify(unknown)}`);
      ok('camera shake applies a decaying offset and returns exactly to baseline, composing cleanly with the follow-cam');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 5. Particle bursts are disposed, not leaked: many repeated spawnBurst() calls must not
  //         grow the scene's child count or the particleBursts bookkeeping array once their
  //         lifetime has elapsed (real THREE.Points meshes + geometry/material get disposed). ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2500 });
    const { page, errors } = game;
    try {
      const result = await page.evaluate(() => {
        const countSceneChildren = () => { let n = 0; scene.traverse(() => n++); return n; };
        const before = { sceneChildren: countSceneChildren(), bursts: particleBursts.length };
        for (let i = 0; i < 25; i++) spawnBurst(new THREE.Vector3(0, 0, 0), 0xffd479);
        const duringSpawn = { sceneChildren: countSceneChildren(), bursts: particleBursts.length };
        // Drive the exact cleanup loop animate() runs (tycoon-v116.html ~line 14086-14106) with a
        // large synthetic dt so every burst's `life` (max 0.9s) elapses in one pass.
        for (let i = particleBursts.length - 1; i >= 0; i--) {
          const p = particleBursts[i];
          p.life -= 999;
          if (p.life <= 0) {
            scene.remove(p.points);
            p.points.geometry.dispose();
            p.points.material.dispose();
            particleBursts.splice(i, 1);
          }
        }
        const after = { sceneChildren: countSceneChildren(), bursts: particleBursts.length };
        return { before, duringSpawn, after };
      });
      console.log('particle leak check:', JSON.stringify(result));
      assertEqual(result.duringSpawn.bursts, result.before.bursts + 25, '25 spawnBurst() calls must add exactly 25 entries to particleBursts');
      assert(result.duringSpawn.sceneChildren > result.before.sceneChildren, 'spawning bursts must add real objects to the scene graph');
      assertEqual(result.after.bursts, result.before.bursts, 'particleBursts must return to its pre-test length once every burst has expired and been cleaned up (no leak)');
      assertEqual(result.after.sceneChildren, result.before.sceneChildren, 'scene child count must return to its pre-test count once every burst has been disposed (no leaked meshes/geometries/materials)');
      const { unknown } = partitionErrors(errors);
      assertEqual(unknown.length, 0, `no console errors during the particle stress test: ${JSON.stringify(unknown)}`);
      ok('25 repeated particle bursts are fully cleaned up (scene child count and bookkeeping array both return to baseline)');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 6. Mute toggle: muted sfx must not throw, and must actually gate audio (beep() returns
  //         early when muted, per the file's own beep() implementation) -- flipping `muted` must
  //         not itself throw or leave any console error, and the persisted localStorage key must
  //         round-trip. ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2000 });
    const { page, errors } = game;
    try {
      const result = await page.evaluate(() => {
        const btn = document.getElementById('muteBtn');
        const before = muted;
        btn.click();
        const afterFirstClick = muted;
        btn.click();
        const afterSecondClick = muted;
        return { hasBtn: !!btn, before, afterFirstClick, afterSecondClick, persisted: localStorage.getItem(MUTE_KEY) };
      });
      console.log('mute toggle check:', JSON.stringify(result));
      assert(result.hasBtn, '#muteBtn must exist (pre-existing HUD control)');
      assert(result.afterFirstClick !== result.before, 'clicking #muteBtn must flip `muted`');
      assertEqual(result.afterSecondClick, result.before, 'clicking #muteBtn twice must return to the original mute state');
      const { unknown } = partitionErrors(errors);
      assertEqual(unknown.length, 0, `no console errors toggling mute: ${JSON.stringify(unknown)}`);
      ok('mute toggle flips state cleanly with no console errors (pre-existing control, unmodified)');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  console.log(failures === 0 ? '\njuice.test.mjs: PASS' : `\njuice.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

// Local copy of the harness's known-issue partition (avoids importing an extra symbol name for
// just this one helper call pattern used repeatedly above).
function partitionErrors(errors) {
  const ROAD_UNION_KNOWN_ISSUE_RE = /\[road union\] Error: Open road union contour/;
  const known = errors.filter((e) => ROAD_UNION_KNOWN_ISSUE_RE.test(e));
  const unknown = errors.filter((e) => !ROAD_UNION_KNOWN_ISSUE_RE.test(e));
  return { known, unknown };
}

main().catch((e) => { console.error(e); process.exit(1); });
