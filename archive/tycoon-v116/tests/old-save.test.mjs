// Old-format save regression test -- the exact save this session standardized on
// ({saveVersion:20, stageIndex:1, money:500, planks:10, concrete:0, metal:0,
// buildings:[{index:0}]}), which predates every v116 boot-gate field. It must behave EXACTLY as
// before the tenth-pass empty-world feature: industrial zone / roads / fleet-yard already present,
// no manual road mode. See VISION.md "Старт новой игры" and tycoon-v116.html's boot block.
import { openGame, OLD_SAVE, partitionKnownErrors, assert, assertEqual } from './lib/harness.mjs';

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  const game = await openGame({ save: OLD_SAVE, waitMs: 3500 });
  try {
    const { known, unknown } = partitionKnownErrors(game.errors);
    if (unknown.length === 0) ok(`0 unexpected console errors loading the old save (${known.length} known road-union warnings)`);
    else fail(`unexpected console errors: ${JSON.stringify(unknown.slice(0, 5))}`);

    const state = await game.page.evaluate(() => ({
      industrialZoneBuiltV116: typeof industrialZoneBuiltV116 !== 'undefined' ? industrialZoneBuiltV116 : 'undef',
      manualRoadModeV116: typeof manualRoadModeV116 !== 'undefined' ? manualRoadModeV116 : 'undef',
      stageIndex: typeof stageIndex !== 'undefined' ? stageIndex : -1,
      money: Math.round(money),
      planks, concrete, metal,
      buildingsLen: buildings.length,
      concretePlant: !!concretePlant,
      metalPlant: !!metalPlant,
      fleetYardExists: !!scene.getObjectByName('v116FleetYard'),
      serviceRoadsExist: (cityWorldRuntime.transportAccessRoads?.children?.length || 0) > 0,
      stageRoadNetwork: window.__TYCOON_STAGE_ROADS__?.audit?.()?.network || null,
    }));
    console.log('old-save state:', JSON.stringify(state, null, 2));

    assertEqual(state.industrialZoneBuiltV116, true, 'an old save (no v116 fields at all) must default industrialZoneBuiltV116 to true');
    assertEqual(state.manualRoadModeV116, false, 'an old save must default manualRoadModeV116 to false (auto roads, as always)');
    assertEqual(state.stageIndex, 1, 'stageIndex carried over from the save');
    assertEqual(state.buildingsLen, 1, 'building 0 carried over from the save');
    assert(state.money >= 500, `money should be >= the saved 500 (passive income accrues while loading), got ${state.money}`);
    assert(state.concretePlant, 'concrete plant must already exist on an old save (built unconditionally at boot)');
    assert(state.metalPlant, 'metal yard must already exist on an old save');
    assert(state.fleetYardExists, 'fleet yard must already exist on an old save');
    assert(state.serviceRoadsExist, 'industrial service roads must already exist on an old save');
    ok('old-save boot invariants all hold (industrial zone/roads/fleet-yard present, as before the empty-world feature)');
  } catch (e) {
    fail(e.message);
  } finally {
    await game.close();
  }

  console.log(failures === 0 ? '\nold-save.test.mjs: PASS' : `\nold-save.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
