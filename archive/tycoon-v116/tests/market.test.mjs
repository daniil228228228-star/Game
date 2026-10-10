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

    // --- 1b. Orientation (v119, nineteenth pass): every stall's OPEN/counter side (local +Z --
    //          see createMarketStall(), counter at z=+hd, solid back wall at z=-hd) must face the
    //          plaza center, not an arbitrary angle. Checked two ways: the stored `facing` config
    //          value itself, and the actually-built group's live `rotation.y` in the scene. ---
    const orientation = await page.evaluate(() => MARKET_STALLS_V116.map((cfg) => {
      const toCenter = new THREE.Vector3(MARKET_PLAZA_CENTER_V116.x - cfg.pos.x, 0, MARKET_PLAZA_CENTER_V116.z - cfg.pos.z).normalize();
      // World front vector of local +Z after rotation.y=facing (THREE's Y-rotation convention).
      const front = { x: Math.sin(cfg.facing), z: Math.cos(cfg.facing) };
      const dot = front.x * toCenter.x + front.z * toCenter.z; // 1 = perfectly facing center
      const group = marketRuntimeV116.stalls.get(cfg.id)?.group;
      return { id: cfg.id, dot, liveRotationMatchesConfig: group ? Math.abs(group.rotation.y - cfg.facing) < 1e-6 : null };
    }));
    console.log('stall orientation:', JSON.stringify(orientation));
    for (const o of orientation) {
      assert(o.dot > 0.999, `stall '${o.id}' canopy must face the plaza center (facing-vector·toCenter = ${o.dot.toFixed(4)}, want ~1)`);
      assert(o.liveRotationMatchesConfig, `stall '${o.id}' built group.rotation.y must match its config's facing`);
    }
    ok('all 7 stalls face the plaza center (open/counter side pointed inward, not a haphazard angle)');

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

    // --- 3. Resource exchange (v119, nineteenth pass): pressing the button now opens a real
    //         pick-any-pair menu instead of executing one fixed cycled offer -- verify the menu
    //         actually opens with multiple rows, that picking two DIFFERENT pairs each executes at
    //         its own documented rate (10 planks -> 6 concrete / 10 planks -> 3 metal, both
    //         derived from the same MARKET_EXCHANGE_VALUE_V116/MARKET_EXCHANGE_FEE_V116 verified
    //         in commit 8c9c741 -- no new rates invented), and that walking away closes it. ---
    // Passive plant auto-production (concretePlantTimer/metalPlantTimer, METAL_AUTO_INTERVAL=8s)
    // keeps ticking in real wall-clock time while this test waits on page interactions, so it is
    // reset to 0 right before each measured trade below -- otherwise a stray +1 from a live plant
    // tick landing between "before" and "after" reads would masquerade as a wrong exchange rate.
    await page.evaluate(() => { planks = 499; concrete = 0; metal = 0; concretePlantTimer = 0; metalPlantTimer = 0; });
    await walkAndPress('exchange'); // now OPENS the menu instead of trading directly
    const menuState = await page.evaluate(() => ({
      open: marketExchangeMenuOpenV116,
      panelShown: document.getElementById('marketExchangePanel')?.classList.contains('show'),
      rowCount: document.querySelectorAll('#marketExchangePanel [data-mkt-exch-idx]').length,
    }));
    console.log('exchange menu state:', JSON.stringify(menuState));
    assert(menuState.open, "pressing the exchange stall's action button must open the pick-any-pair menu");
    assert(menuState.panelShown, '#marketExchangePanel must actually be visible (.show class)');
    assert(menuState.rowCount > 1, 'the menu must list more than one exchange pair to be a real picker, not a relabeled single offer');
    ok(`resource-exchange stall: action button opens a real menu with ${menuState.rowCount} pairs`);

    // Pick 1: planks -> concrete.
    const exBefore = await page.evaluate(() => ({ planks, concrete }));
    const p2cIdx = await page.evaluate(() => MARKET_EXCHANGE_OFFERS_V116.findIndex((o) => o.from === 'planks' && o.to === 'concrete'));
    await page.click(`#marketExchangePanel [data-mkt-exch-idx="${p2cIdx}"]`);
    await page.waitForTimeout(250);
    const exAfter = await page.evaluate(() => ({ planks, concrete }));
    console.log('exchange (planks->concrete) before/after:', JSON.stringify(exBefore), JSON.stringify(exAfter));
    assertEqual(exBefore.planks - exAfter.planks, 10, 'planks->concrete pick must consume exactly 10 planks (fixed amountIn)');
    assertEqual(exAfter.concrete - exBefore.concrete, 6, 'planks->concrete pick must produce exactly 6 concrete (10 * 1/1.5 * 0.9, floored) -- exact number verified in commit 8c9c741');

    // Menu must still be open after one trade (lets the player make several picks in a row).
    const stillOpen = await page.evaluate(() => marketExchangeMenuOpenV116);
    assert(stillOpen, 'the menu must stay open after a successful trade, so the player can pick another pair');

    // Pick 2: a genuinely DIFFERENT pair (planks -> metal), proving this is a real picker.
    await page.evaluate(() => { concretePlantTimer = 0; metalPlantTimer = 0; });
    const ex2Before = await page.evaluate(() => ({ planks, metal }));
    const p2mIdx = await page.evaluate(() => MARKET_EXCHANGE_OFFERS_V116.findIndex((o) => o.from === 'planks' && o.to === 'metal'));
    await page.click(`#marketExchangePanel [data-mkt-exch-idx="${p2mIdx}"]`);
    await page.waitForTimeout(250);
    const ex2After = await page.evaluate(() => ({ planks, metal }));
    console.log('exchange (planks->metal) before/after:', JSON.stringify(ex2Before), JSON.stringify(ex2After));
    assertEqual(ex2Before.planks - ex2After.planks, 10, 'planks->metal pick must consume exactly 10 planks (fixed amountIn)');
    assertEqual(ex2After.metal - ex2Before.metal, 3, 'planks->metal pick must produce exactly 3 metal (10 * 1/3 * 0.9, floored)');
    ok('resource-exchange menu: two different pairs each deduct/credit at their own documented rate (10 planks -> 6 concrete, 10 planks -> 3 metal)');

    // Walking away must close the menu, same dismiss-on-walk-away every other ground pad uses.
    await page.evaluate(() => { player.position.set(0, 0, 0); });
    await page.waitForTimeout(400);
    const closedState = await page.evaluate(() => ({
      open: marketExchangeMenuOpenV116,
      panelShown: document.getElementById('marketExchangePanel')?.classList.contains('show'),
    }));
    console.log('exchange menu after walking away:', JSON.stringify(closedState));
    assert(!closedState.open && !closedState.panelShown, 'walking away from the exchange stall must close the menu, consistent with nearestManualTargetV53()\'s dismiss-on-walk-away behaviour');
    ok('walking away from the exchange stall closes the menu');
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
