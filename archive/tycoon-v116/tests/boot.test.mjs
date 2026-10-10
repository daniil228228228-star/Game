// Fresh-boot (empty localStorage) regression test -- the tenth-pass "empty world for a new
// player" feature (VISION.md "Старт новой игры: пустой мир"). See CHANGELOG_V116.md, десятый
// заход.
import { openGame, partitionKnownErrors, checkAllScriptBlocks, assert, assertEqual } from './lib/harness.mjs';

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  // 1. All inline <script> blocks must still parse (node --check). This is independent of the
  // browser -- runs against the file directly.
  const { blockCount, errors: scriptErrors } = await checkAllScriptBlocks();
  if (scriptErrors.length === 0) ok(`node --check: ${blockCount} script blocks, 0 errors`);
  else { fail(`node --check found ${scriptErrors.length} broken blocks: ${JSON.stringify(scriptErrors.slice(0, 3))}`); }

  // 2. Fresh boot: completely empty localStorage.
  const game = await openGame({ save: 'clear', waitMs: 3000 });
  try {
    const { known, unknown } = partitionKnownErrors(game.errors);
    if (unknown.length === 0) ok(`0 unexpected console errors on fresh boot (${known.length} known road-union warnings)`);
    else fail(`unexpected console errors on fresh boot: ${JSON.stringify(unknown.slice(0, 5))}`);

    const state = await game.page.evaluate(() => {
      function countMeshesExcept(names) {
        let n = 0;
        scene.traverse((o) => { if (o.isMesh) n++; });
        return n;
      }
      // "grass + player only": no sawmill/concrete/metal industrial scenery, no fleet yard, no
      // industrial service roads -- see tycoon-v116.html's boot block (~line 974) and
      // buildSawmillScenery()/buildConcretePlant()/buildMetalYard() gates.
      return {
        industrialZoneBuiltV116: typeof industrialZoneBuiltV116 !== 'undefined' ? industrialZoneBuiltV116 : 'undef',
        manualRoadModeV116: typeof manualRoadModeV116 !== 'undefined' ? manualRoadModeV116 : 'undef',
        concretePlant: typeof concretePlant !== 'undefined' ? !!concretePlant : 'undef',
        metalPlant: typeof metalPlant !== 'undefined' ? !!metalPlant : 'undef',
        fleetYardExists: !!scene.getObjectByName('v116FleetYard'),
        sawmillOfficeExists: !!scene.getObjectByName('sawmillOfficeV116') || !!scene.getObjectByName('sawmillMillV116'),
        buildingsCount: typeof buildings !== 'undefined' ? buildings.length : -1,
        stageIndex: typeof stageIndex !== 'undefined' ? stageIndex : -1,
        playerExists: !!player,
        bootErrorVisible: (() => {
          const el = document.getElementById('bootError');
          return !!(el && el.style.display !== 'none' && el.textContent);
        })(),
      };
    });
    console.log('fresh-boot state:', JSON.stringify(state, null, 2));

    assertEqual(state.industrialZoneBuiltV116, false, 'industrialZoneBuiltV116 must be false on a genuinely new save');
    assertEqual(state.manualRoadModeV116, true, 'manualRoadModeV116 must be true on a genuinely new save');
    assertEqual(state.concretePlant, false, 'no concrete plant before the player builds the factory pad');
    assertEqual(state.metalPlant, false, 'no metal yard before the player builds the factory pad');
    assert(!state.fleetYardExists, 'no fleet yard before the factory pad is built');
    assert(!state.sawmillOfficeExists, 'no sawmill scenery before the factory pad is built');
    assertEqual(state.buildingsCount, 0, 'zero buildings on a genuinely new save (not even house 0)');
    assert(state.playerExists, 'player must exist');
    assert(!state.bootErrorVisible, 'no boot error banner');
    ok('empty-world invariants all hold');
  } catch (e) {
    fail(e.message);
  } finally {
    await game.close();
  }

  console.log(failures === 0 ? '\nboot.test.mjs: PASS' : `\nboot.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
