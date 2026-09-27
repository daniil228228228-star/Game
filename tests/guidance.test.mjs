// In-world guidance (v117): nextActionableTargetV117() + the pad highlight / ground arrow /
// floating-text-popup systems that replace the removed #nextCard/#requiredActionV38/#eventBanner
// stack (commit 6ccb464) for the empty-world start (commit f9ade3a, VISION.md "Старт новой игры:
// пустой мир"). See CHANGELOG_V116.md for the dated section this test backs.
import { openGame, OLD_SAVE, assert, assertEqual } from './lib/harness.mjs';

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  // --- 1. Fresh empty-world boot: the very first target must be the (always-affordable,
  //         money-only) first house pad -- not the factory pad, even though the factory pad's
  //         150-money cost is also affordable with the default starting cash. See the "ordering
  //         note" comment on nextActionableTargetV117() for why this is checked in that order. ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      const state = await page.evaluate(() => {
        const t = nextActionableTargetV117();
        return {
          type: t?.type,
          label: t?.label,
          posMatchesCurrentPad: t && currentPad ? (Math.abs(t.pos.x - currentPad.pos.x) < 1e-6 && Math.abs(t.pos.z - currentPad.pos.z) < 1e-6) : false,
          moneyAtBoot: money,
          factoryCost: INDUSTRIAL_ZONE_PAD_COST_V116.money,
        };
      });
      console.log('fresh-boot target:', JSON.stringify(state));
      assertEqual(state.type, 'stage', 'fresh boot must target the first house pad (stage), not the factory pad');
      assert(state.posMatchesCurrentPad, 'stage target position must equal currentPad.pos');
      assert(state.moneyAtBoot >= state.factoryCost, 'sanity: starting money must already cover the factory pad cost (this is the ambiguous case the ordering note documents)');
      ok('fresh boot targets the first house pad ahead of the also-affordable factory pad');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 2. After buying house 0 (free-of-materials) without paving its road, the target must
  //         move to the manual road pad at that house's driveway endpoint. ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      await page.evaluate(() => { purchaseCurrentPad(); });
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => {
        const t = nextActionableTargetV117();
        const e = stageRoadEndpointV367(0);
        return {
          type: t?.type,
          stageIndexV117: t?.stageIndexV117,
          posMatchesEndpoint: t ? (Math.abs(t.pos.x - e.x) < 1e-6 && Math.abs(t.pos.z - e.z) < 1e-6) : false,
          markerExists: !!roadPadMarkersV116.get(0),
        };
      });
      console.log('after buying house 0:', JSON.stringify(state));
      assertEqual(state.type, 'road', 'target must be the pending road pad once a house is bought but not routed');
      assertEqual(state.stageIndexV117, 0, 'the pending road must be for house 0');
      assert(state.posMatchesEndpoint, 'road target position must equal stageRoadEndpointV367(0)');
      assert(state.markerExists, 'a visible road pad marker (spawnRoadPadMarkerV116) must exist for house 0');
      ok('target moves to the manual road pad after buying an unrouted house');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 3. After paving that road (still no factory), with stage 1 needing planks the player
  //         cannot get yet, the target must move to the (still unbuilt, affordable) factory pad
  //         -- and a real, visible ground marker must exist there (spawnFactoryPadMarkerV117()). ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      const before = await page.evaluate(() => ({
        factoryMarkerExists: !!scene.getObjectByName === 'function', // placeholder, real check below
      }));
      const state0 = await page.evaluate(() => {
        // The factory pad marker is a THREE.Group with no explicit .name -- find it by world
        // position instead (it's the only such marker there before the zone is built).
        let found = false;
        scene.traverse((o) => {
          if (o.isGroup && Math.abs(o.position.x - INDUSTRIAL_ZONE_PAD_POS_V116.x) < 1e-6 && Math.abs(o.position.z - INDUSTRIAL_ZONE_PAD_POS_V116.z) < 1e-6) found = true;
        });
        return { factoryMarkerExistsBeforeAnyHouse: found };
      });
      assert(state0.factoryMarkerExistsBeforeAnyHouse, 'the factory pad ground marker must exist from the very start of a fresh empty-world save (spawnFactoryPadMarkerV117)');

      await page.evaluate(() => { purchaseCurrentPad(); });
      await page.waitForTimeout(300);
      await page.evaluate(() => { buildManualRoadStageV116(0, stageRoadEndpointV367(0)); });
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => {
        const t = nextActionableTargetV117();
        return {
          type: t?.type,
          posMatchesFactory: t ? (Math.abs(t.pos.x - INDUSTRIAL_ZONE_PAD_POS_V116.x) < 1e-6 && Math.abs(t.pos.z - INDUSTRIAL_ZONE_PAD_POS_V116.z) < 1e-6) : false,
          stageIndex,
          planksNeeded: STAGES[1]?.plankCost,
          planks,
          industrialZoneBuiltV116,
        };
      });
      console.log('after road, before factory:', JSON.stringify(state));
      assertEqual(state.type, 'factory', 'target must move to the factory pad once house 0 is roaded and stage 1 needs planks the player cannot source yet');
      assert(state.posMatchesFactory, 'factory target position must equal INDUSTRIAL_ZONE_PAD_POS_V116');
      assert(state.planksNeeded > state.planks, 'sanity: stage 1 must actually require more planks than the player has (that is WHY the stage pad is not chosen)');
      ok('target moves to the factory pad once the next house needs materials the factory unlocks');

      // --- 4. Building the factory removes its marker and (per priority order) hands guidance
      //         back to the resource-fetch chain (go chop a tree) since stage 1 still needs
      //         planks and the base currentGuidanceTarget() already knows how to route that. ---
      await page.evaluate(() => { buildIndustrialZoneV116(); });
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => {
        let markerStillThere = false;
        scene.traverse((o) => {
          if (o.isGroup && Math.abs(o.position.x - INDUSTRIAL_ZONE_PAD_POS_V116.x) < 1e-6 && Math.abs(o.position.z - INDUSTRIAL_ZONE_PAD_POS_V116.z) < 1e-6) markerStillThere = true;
        });
        return {
          industrialZoneBuiltV116,
          nextActionableNull: nextActionableTargetV117() === null,
          fallbackTarget: currentGuidanceTarget(),
          markerStillThere,
        };
      });
      console.log('after building factory:', JSON.stringify(after));
      assert(after.industrialZoneBuiltV116, 'factory must actually be built');
      assert(!after.markerStillThere, 'the factory pad ground marker must be removed once built (removeFactoryPadMarkerV117)');
      assert(after.nextActionableNull, 'nextActionableTargetV117() must return null once the factory is built and stage 1 is still unaffordable (falls through to the pre-existing resource-fetch chain)');
      assert(!!after.fallbackTarget, 'currentGuidanceTarget() must still return SOMETHING (the pre-existing tree/sawmill fetch guidance) -- zero regression to that chain');
      ok('factory marker removed on build; guidance falls through cleanly to the existing resource-fetch chain');
    } catch (e) { fail(e.message); console.error(e.stack); } finally { await game.close(); }
  }

  // --- 5. Ground arrow: visible and pointed away from the player when the target is far, hidden
  //         once the player is close to it (GROUND_ARROW_HIDE_DIST_V117). ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      const far = await page.evaluate(() => {
        const t = nextActionableTargetV117();
        player.position.set(t.pos.x + 40, 0, t.pos.z + 40);
        updateActionableHighlightV117();
        return { visible: groundArrowGroupV117.visible, dist: Math.hypot(player.position.x - t.pos.x, player.position.z - t.pos.z) };
      });
      console.log('ground arrow far:', JSON.stringify(far));
      assert(far.visible, `ground arrow must be visible when target is far away (dist=${far.dist})`);

      const near = await page.evaluate(() => {
        const t = nextActionableTargetV117();
        player.position.set(t.pos.x + 1, 0, t.pos.z);
        updateActionableHighlightV117();
        return { visible: groundArrowGroupV117.visible };
      });
      console.log('ground arrow near:', JSON.stringify(near));
      assert(!near.visible, 'ground arrow must hide once the player is close to the target (GROUND_ARROW_HIDE_DIST_V117)');
      ok('ground arrow shows when far, hides when close');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 6. Floating text popup: spawns a fading world-space sprite on a real event (road built)
  //         and disposes itself after its lifetime. ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      await page.evaluate(() => { purchaseCurrentPad(); });
      await page.waitForTimeout(300);
      const spawned = await page.evaluate(() => {
        const before = floatingTextPopupsV117.length;
        buildManualRoadStageV116(0, stageRoadEndpointV367(0));
        return { before, after: floatingTextPopupsV117.length, opacityAtSpawn: floatingTextPopupsV117[floatingTextPopupsV117.length - 1]?.sprite.material.opacity };
      });
      console.log('popup spawn:', JSON.stringify(spawned));
      assertEqual(spawned.before, 0, 'no popups before the event');
      assertEqual(spawned.after, 1, 'building the road must spawn exactly one floating text popup');

      // Drive updateFloatingTextPopupsV117() directly with synthetic dt instead of waiting on
      // real wall-clock time -- this environment's software-rendered (swiftshader) rAF loop runs
      // far slower than a real device (a handful of fps under load), so animate()'s own dt
      // accumulation is not a reliable clock for a real-time wait here; every other timer-driven
      // check in this suite has the same trait (see harness.mjs's buildHousesViaNormalPath()
      // note on manually finishing construction rather than waiting out real timers).
      const gone = await page.evaluate(() => {
        for (let i = 0; i < 20; i++) updateFloatingTextPopupsV117(0.1); // 2.0s of simulated time > life (1.35s)
        return floatingTextPopupsV117.length;
      });
      assertEqual(gone, 0, 'the popup must dispose itself after its lifetime elapses');
      ok('floating text popup spawns on a real event and disposes itself');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 7. Old-save regression: manualRoadModeV116=false / industrialZoneBuiltV116=true means
  //         nextActionableTargetV117()'s road/factory branches are no-ops, and an affordable
  //         next stage still resolves to the same 'stage' target the base function always gave
  //         -- byte-identical guidance behaviour for a returning player. ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2500 });
    const { page } = game;
    try {
      const state = await page.evaluate(() => {
        money = 99999; planks = 99; concrete = 99; metal = 99;
        const t = nextActionableTargetV117();
        return {
          manualRoadModeV116, industrialZoneBuiltV116,
          type: t?.type,
          matchesCurrentPad: t && currentPad ? (t.pos.x === currentPad.pos.x && t.pos.z === currentPad.pos.z) : false,
        };
      });
      console.log('old-save target:', JSON.stringify(state));
      assertEqual(state.manualRoadModeV116, false, 'old save must keep automatic roads (sanity check)');
      assertEqual(state.industrialZoneBuiltV116, true, 'old save must keep the factory already built (sanity check)');
      assertEqual(state.type, 'stage', 'old save with an affordable next stage must target it exactly as before');
      assert(state.matchesCurrentPad, 'target position must equal currentPad.pos, unchanged from pre-v117 behaviour');
      ok('old save: road/factory branches are no-ops, stage targeting unchanged');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  console.log(failures === 0 ? '\nguidance.test.mjs: PASS' : `\nguidance.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
