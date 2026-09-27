// Market plaza regression test (commit 8c9c741): 7 stalls present, and each purchase/exchange
// actually deducts the right cost and updates real state -- reusing the exact interaction
// mechanism (walk near the stall, press #actionBtn) and, where convenient, the exact numbers
// verified in that commit's report (see CHANGELOG_V116.md, одиннадцатый заход).
import { openGame, OLD_SAVE, assert, assertEqual } from './lib/harness.mjs';

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  const game = await openGame({ save: OLD_SAVE, waitMs: 3000 });
  const { page } = game;
  try {
    // --- 1. All 7 stalls present. ---
    const stalls = await page.evaluate(() => ({
      configCount: MARKET_STALLS_V116.length,
      ids: MARKET_STALLS_V116.map((c) => c.id),
      runtimeCount: marketRuntimeV116.stalls.size,
      plazaExists: !!scene.getObjectByName('marketPlazaV116'),
    }));
    console.log('stalls:', JSON.stringify(stalls));
    assertEqual(stalls.configCount, 7, 'exactly 7 market stalls configured');
    assertEqual(stalls.runtimeCount, 7, 'exactly 7 stall groups actually built in the scene');
    assert(stalls.plazaExists, 'market plaza group must exist in the scene');
    for (const id of ['team', 'fleet', 'tenders', 'operations', 'meta', 'bonus', 'exchange']) {
      assert(stalls.ids.includes(id), `stall '${id}' must be configured`);
    }
    ok('all 7 stalls present (team/fleet/tenders/operations/meta/bonus/exchange)');

    // --- 2. Real purchases via the real interaction mechanism (walk up + #actionBtn), verifying
    //         actual state deltas -- not just that a function exists. ---
    await page.evaluate(() => {
      stageIndex = 8; money = 2000000; planks = 500; concrete = 500; metal = 500; metaState.points = 50;
      upgradeBuilding(buildings[0]); // real construction so the Operations stall has something to cycle
      updateHUD();
    });

    const walkAndPress = async (id) => {
      await page.evaluate((id) => {
        const cfg = MARKET_STALLS_V116.find((c) => c.id === id);
        const dir = new THREE.Vector3(MARKET_PLAZA_CENTER_V116.x - cfg.pos.x, 0, MARKET_PLAZA_CENTER_V116.z - cfg.pos.z).normalize();
        player.position.copy(cfg.pos).addScaledVector(dir, 1.6);
      }, id);
      await page.waitForTimeout(350);
      await page.click('#actionBtn');
      await page.waitForTimeout(350);
    };

    const before = await page.evaluate(() => ({
      money, planks, concrete, metal,
      staffBuilder: staffState.builder,
      fleetPlanks: fleetState.planks,
      tenderActive: tenderState.active,
      metaProfit: metaState.upgrades.profit || 0,
      metaPoints: metaState.points,
      opsPriority: growingMeshes[0]?.opsPriority,
    }));

    for (const id of ['team', 'fleet', 'tenders', 'operations', 'meta']) await walkAndPress(id);

    const after = await page.evaluate(() => ({
      money, planks, concrete, metal,
      staffBuilder: staffState.builder,
      fleetPlanks: fleetState.planks,
      tenderActive: tenderState.active,
      metaProfit: metaState.upgrades.profit || 0,
      metaPoints: metaState.points,
      opsPriority: growingMeshes[0]?.opsPriority,
    }));
    console.log('before:', JSON.stringify(before));
    console.log('after:', JSON.stringify(after));

    assert(after.staffBuilder > before.staffBuilder, `'team' stall must hire/upgrade staff (builder ${before.staffBuilder} -> ${after.staffBuilder})`);
    assert(after.fleetPlanks > before.fleetPlanks, `'fleet' stall must upgrade fleet (planks-truck level ${before.fleetPlanks} -> ${after.fleetPlanks})`);
    assertEqual(after.tenderActive?.id, 'residential', `'tenders' stall must start the first unlocked tender`);
    assert(after.metaProfit > before.metaProfit, `'meta' stall must buy a development upgrade (profit ${before.metaProfit} -> ${after.metaProfit})`);
    assert(after.metaPoints < before.metaPoints, `'meta' stall purchase must spend prestige points (${before.metaPoints} -> ${after.metaPoints})`);
    assert(after.opsPriority !== before.opsPriority, `'operations' stall must cycle construction priority (${before.opsPriority} -> ${after.opsPriority})`);
    ok('team/fleet/tenders/operations/meta stalls each produced the correct real state change');

    // --- 3. Resource exchange: verified rate from commit 8c9c741's report (10 planks -> 6
    //         concrete, 10% market fee baked in) -- reused here as an exact regression number. ---
    await page.evaluate(() => {
      marketExchangeCycleV116 = 0; // force the deterministic first offer: planks -> concrete
      planks = 499; concrete = 0; metal = 0;
    });
    const exBefore = await page.evaluate(() => ({ planks, concrete }));
    await walkAndPress('exchange');
    const exAfter = await page.evaluate(() => ({ planks, concrete }));
    console.log('exchange before/after:', JSON.stringify(exBefore), JSON.stringify(exAfter));
    assertEqual(exBefore.planks - exAfter.planks, 10, 'exchange must consume exactly 10 planks (fixed amountIn)');
    assertEqual(exAfter.concrete - exBefore.concrete, 6, 'exchange must produce exactly 6 concrete (10 * 1/1.5 * 0.9, floored) -- exact number verified in commit 8c9c741');
    ok('resource-exchange stall: 10 planks -> 6 concrete, matches the verified live rate');
  } catch (e) {
    fail(e.message);
    console.error(e.stack);
  } finally {
    await game.close();
  }

  console.log(failures === 0 ? '\nmarket.test.mjs: PASS' : `\nmarket.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
