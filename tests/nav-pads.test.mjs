// District / special-project / manual-road / factory pads all trigger their real action via the
// shared nearestManualTargetV53() / #actionPrompt / #actionBtn mechanism (commit 66fd1ec relocated
// these off the removed world-nav-hub cluster onto real ground locations); the old menu-hub pad
// system (buildWorldNavPadV362) must stay fully removed, not just unused.
import { openGame, OLD_SAVE, assert, assertEqual } from './lib/harness.mjs';

async function pressActionBtn(page) {
  await page.click('#actionBtn');
  await page.waitForTimeout(400);
}

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  // --- 0. Old menu-hub pad system confirmed gone (checked on a fresh boot -- no game-state
  //         dependency). ---
  {
    const game = await openGame({ save: 'clear', waitMs: 1500 });
    try {
      const gone = await game.page.evaluate(() => ({
        buildWorldNavPadV362: typeof buildWorldNavPadV362,
        createWorldNavPadsV362: typeof createWorldNavPadsV362,
        worldNavRuntimeV362: typeof worldNavRuntimeV362,
      }));
      console.log('old hub-pad system:', JSON.stringify(gone));
      for (const [k, v] of Object.entries(gone)) {
        assertEqual(v, 'undefined', `${k} must be fully removed (function/global gone, not just unused)`);
      }
      ok('buildWorldNavPadV362/createWorldNavPadsV362/worldNavRuntimeV362 all confirmed gone');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 1. District pad: walk up, press #actionBtn, verify a real district-level upgrade. ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2500 });
    const { page } = game;
    try {
      await page.evaluate(() => {
        money = 999999; planks = 999; concrete = 999; metal = 999; stageIndex = 3;
        cityState.reputation = 100; // unlocks suburb (rep 0) at minimum
        if (typeof refreshCityExpansionWorld === 'function') refreshCityExpansionWorld();
        const suburb = CITY_DISTRICTS.find((d) => d.id === 'suburb');
        player.position.set(suburb.pos.x, 0, suburb.pos.z);
      });
      await page.waitForTimeout(500);
      const before = await page.evaluate(() => districtLevel('suburb'));
      await pressActionBtn(page);
      const after = await page.evaluate(() => districtLevel('suburb'));
      console.log('district level before/after:', before, after);
      assert(after > before, `district pad must upgrade the district via #actionBtn (level ${before} -> ${after})`);
      ok('district pad triggers upgradeCityDistrict() via #actionBtn');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 2. Special-project pad: walk up to the vacant-site marker, press #actionBtn, verify the
  //         project actually starts. ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2500 });
    const { page } = game;
    try {
      await page.evaluate(() => {
        money = 999999; stageIndex = 3; // SPECIAL_PROJECTS[0] ('park') unlocks at stage 3
        if (typeof refreshSpecialProjectWorld === 'function') refreshSpecialProjectWorld();
        const p = SPECIAL_PROJECTS.find((pp) => pp.id === 'park');
        player.position.set(p.pos.x, 0, p.pos.z);
      });
      await page.waitForTimeout(500);
      await pressActionBtn(page);
      const active = await page.evaluate(() => specialProjectState.active?.id);
      console.log('special project active after press:', active);
      assertEqual(active, 'park', 'project pad must start the special project via #actionBtn');
      ok('special-project pad triggers startSpecialProject() via #actionBtn');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 3. Manual-road pad + factory pad: fresh empty-world boot (manualRoadModeV116=true), buy
  //         house 0 the normal way, walk to its unrouted driveway endpoint, press #actionBtn to
  //         pave it, then walk to the fixed industrial-zone pad and press #actionBtn to build it. ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      await page.evaluate(() => { money = 999999; });
      await page.evaluate(() => { purchaseCurrentPad(); });
      await page.waitForTimeout(300);
      const roadedBefore = await page.evaluate(() => manualRoadStagesV116.has(0));
      await page.evaluate(() => { const e = stageRoadEndpointV367(0); player.position.set(e.x, 0, e.z); });
      await page.waitForTimeout(400);
      const target = await page.evaluate(() => nearestManualTargetV53()?.type);
      console.log('nearest manual target at driveway endpoint:', target, 'roadedBefore:', roadedBefore);
      assertEqual(target, 'road', 'the nearest manual target at an unrouted house driveway endpoint must be a road pad');
      await pressActionBtn(page);
      const roadedAfter = await page.evaluate(() => manualRoadStagesV116.has(0));
      assert(roadedAfter, 'manual-road pad must pave the road via #actionBtn (manualRoadStagesV116 must gain stage 0)');
      ok('manual-road pad triggers buildManualRoadStageV116() via #actionBtn');

      await page.evaluate(() => { player.position.set(INDUSTRIAL_ZONE_PAD_POS_V116.x, 0, INDUSTRIAL_ZONE_PAD_POS_V116.z); });
      await page.waitForTimeout(400);
      const factoryTarget = await page.evaluate(() => nearestManualTargetV53()?.type);
      assertEqual(factoryTarget, 'factory', 'the nearest manual target at the industrial-zone pad must be the factory pad');
      const builtBefore = await page.evaluate(() => industrialZoneBuiltV116);
      await pressActionBtn(page);
      const builtAfter = await page.evaluate(() => industrialZoneBuiltV116);
      console.log('industrialZoneBuiltV116 before/after:', builtBefore, builtAfter);
      assertEqual(builtBefore, false, 'factory pad must not be pre-built on a fresh empty-world save');
      assertEqual(builtAfter, true, 'factory pad must build the industrial zone via #actionBtn');
      ok('factory pad triggers buildIndustrialZoneV116() via #actionBtn');
    } catch (e) { fail(e.message); console.error(e.stack); } finally { await game.close(); }
  }

  console.log(failures === 0 ? '\nnav-pads.test.mjs: PASS' : `\nnav-pads.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
