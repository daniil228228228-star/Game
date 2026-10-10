// Staged unlock (eighteenth pass, v118): both the market plaza's 7 stalls and the industrial
// zone's 4 buildings (sawmill/concrete/metal/fleet depot) now unlock and build one at a time,
// instead of a single ground-pad press putting up the whole market/whole factory at once
// (eleventh pass commit 8c9c741 / tenth pass commit d67901b respectively). User request: "рынок
// я бы проработал бы лучше... чтобы открывалась каждая лавочка по отдельности... также бы с
// заводом сделал бы, что всё прокачивалось отдельно". See CHANGELOG_V116.md, eighteenth pass,
// for the exact unlock order/cost reasoning this test backs.
import { openGame, OLD_SAVE, assert, assertEqual } from './lib/harness.mjs';

async function pressActionBtn(page) {
  await page.click('#actionBtn');
  await page.waitForTimeout(400);
}

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  // --- 1. Fresh save: nothing built yet, either system. ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      const state = await page.evaluate(() => ({
        sawmillBuiltV118, fleetDepotBuiltV118, concretePlantBuiltV118, metalYardBuiltV118,
        marketStallsBuiltV118Size: marketStallsBuiltV118.size,
        depotMarkerExists: !!industrialPadMarkersV118.get('depot'),
        sawmillMarkerExists: !!industrialPadMarkersV118.get('sawmill'),
        concreteMarkerExists: !!industrialPadMarkersV118.get('concrete'),
        metalMarkerExists: !!industrialPadMarkersV118.get('metal'),
        marketVacantCount: marketRuntimeV116.vacant.size,
        marketBuiltCount: marketRuntimeV116.stalls.size,
      }));
      console.log('fresh save state:', JSON.stringify(state));
      assertEqual(state.sawmillBuiltV118, false, 'sawmill must not be pre-built on a fresh save');
      assertEqual(state.fleetDepotBuiltV118, false, 'fleet depot must not be pre-built on a fresh save');
      assertEqual(state.concretePlantBuiltV118, false, 'concrete plant must not be pre-built on a fresh save');
      assertEqual(state.metalYardBuiltV118, false, 'metal yard must not be pre-built on a fresh save');
      assertEqual(state.marketStallsBuiltV118Size, 0, 'no market stalls built on a fresh save');
      assert(state.depotMarkerExists, 'the depot pad marker must exist immediately (no prereq)');
      assert(!state.sawmillMarkerExists, 'the sawmill pad marker must NOT exist yet (prereq: depot built)');
      assert(!state.concreteMarkerExists, 'the concrete pad marker must NOT exist yet (prereq: sawmill built)');
      assert(!state.metalMarkerExists, 'the metal pad marker must NOT exist yet (prereq: sawmill built)');
      assertEqual(state.marketBuiltCount, 0, 'no market stall tents built yet');
      // stageIndex is 0 at boot -- only stalls with unlock<=0 would show a vacant marker, and
      // every configured stall's unlock is >=1 (see MARKET_STALLS_V116), so none should show yet.
      assertEqual(state.marketVacantCount, 0, 'no market stall is unlocked yet at stageIndex 0');
      ok('fresh save: both systems start completely unbuilt, only the depot pad is visible');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 2. Industrial chain order: depot -> sawmill -> concrete/metal (parallel), each pad only
  //         becoming a real candidate once its prereq is met, each press paying its own cost and
  //         revealing the next step's marker. Also verifies the delivery-softlock fix: the plank
  //         truck only appears once BOTH sawmill and depot exist. ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      await page.evaluate(() => { money = 5000; });

      // Sawmill pad must not be a real candidate yet (depot not built).
      const preDepot = await page.evaluate(() => {
        const p = industrialStepV118('sawmill').pos;
        player.position.set(p.x, 0, p.z);
        return nearestManualTargetV53();
      });
      assertEqual(preDepot, null, 'standing at the sawmill pad position must yield no candidate before the depot is built');
      ok('sawmill pad is not interactable before its prereq (depot) is built');

      // Build the depot via the real ground-pad mechanism.
      const depotBefore = await page.evaluate(() => ({ money, fleetDepotBuiltV118 }));
      await page.evaluate(() => { const p = industrialStepV118('depot').pos; player.position.set(p.x, 0, p.z); });
      await page.waitForTimeout(400);
      await pressActionBtn(page);
      const depotAfter = await page.evaluate(() => ({
        money, fleetDepotBuiltV118,
        depotMarkerGone: !industrialPadMarkersV118.get('depot'),
        sawmillMarkerExists: !!industrialPadMarkersV118.get('sawmill'),
        fleetYardExists: !!scene.getObjectByName('v116FleetYard'),
      }));
      console.log('depot before/after:', JSON.stringify(depotBefore), JSON.stringify(depotAfter));
      assert(depotAfter.fleetDepotBuiltV118, 'depot must be built after pressing its pad');
      assertEqual(depotBefore.money - depotAfter.money, 60, 'depot must cost exactly 60 money (FLEET_DEPOT_PAD_COST_V118)');
      assert(depotAfter.depotMarkerGone, 'depot marker must be removed once built');
      assert(depotAfter.sawmillMarkerExists, 'sawmill marker must appear now that its prereq (depot) is built');
      assert(depotAfter.fleetYardExists, 'the fleet yard (v116FleetYard) must actually exist once the depot is built');

      // No plank truck yet -- sawmill itself does not exist.
      const stillNoTruck = await page.evaluate(() => hasDeliveryVehicle('planks'));
      assert(!stillNoTruck, 'no plank delivery truck yet -- the sawmill (the thing it delivers FROM) does not exist yet');

      // Build the sawmill.
      const sawmillBefore = await page.evaluate(() => ({ money, sourceTreesCount: sourceTrees.length }));
      await page.evaluate(() => { const p = industrialStepV118('sawmill').pos; player.position.set(p.x, 0, p.z); });
      await page.waitForTimeout(400);
      await pressActionBtn(page);
      const sawmillAfter = await page.evaluate(() => ({
        money, sawmillBuiltV118, industrialZoneBuiltV116,
        sawmillMarkerGone: !industrialPadMarkersV118.get('sawmill'),
        concreteMarkerExists: !!industrialPadMarkersV118.get('concrete'),
        metalMarkerExists: !!industrialPadMarkersV118.get('metal'),
        hasPlankTruck: hasDeliveryVehicle('planks'),
        sourceTreesCount: sourceTrees.length,
        serviceRoadsExist: (cityWorldRuntime.transportAccessRoads?.children?.length || 0) > 0,
      }));
      console.log('sawmill before/after:', JSON.stringify(sawmillBefore), JSON.stringify(sawmillAfter));
      assert(sawmillAfter.sawmillBuiltV118, 'sawmill must be built after pressing its pad');
      assert(sawmillAfter.industrialZoneBuiltV116, 'legacy industrialZoneBuiltV116 mirror must flip true once sawmill is built');
      assertEqual(sawmillBefore.money - sawmillAfter.money, 100, 'sawmill must cost exactly 100 money (SAWMILL_PAD_COST_V118)');
      assert(sawmillAfter.sawmillMarkerGone, 'sawmill marker must be removed once built');
      assert(sawmillAfter.concreteMarkerExists, 'concrete marker must appear now that its prereq (sawmill) is built');
      assert(sawmillAfter.metalMarkerExists, 'metal marker must appear in PARALLEL with concrete (both share the sawmill prereq)');
      assert(sawmillAfter.hasPlankTruck, 'the plank delivery truck must now exist -- both sawmill AND depot are built (the softlock fix)');
      assertEqual(sawmillAfter.sourceTreesCount - sawmillBefore.sourceTreesCount, 6, 'buildSawmillScenery() must have actually run (adds exactly 6 source trees; the map already has other decorative harvestable trees registered at boot, unrelated to this pass)');
      assert(sawmillAfter.serviceRoadsExist, 'the industrial service-road network must be rendered');
      ok('depot -> sawmill built via real ground-pad presses; costs correct; sawmill reveals BOTH concrete and metal pads; plank truck now exists (no delivery softlock)');

      // Build concrete and metal (parallel, either order) -- give enough money.
      await page.evaluate(() => { money = 5000; planks = 50; });
      const concreteBefore = await page.evaluate(() => ({ money, wood: planks, concretePlant: !!concretePlant }));
      await page.evaluate(() => { const p = industrialStepV118('concrete').pos; player.position.set(p.x, 0, p.z); });
      await page.waitForTimeout(400);
      await pressActionBtn(page);
      const concreteAfter = await page.evaluate(() => ({
        money, wood: planks, concretePlantBuiltV118, concretePlant: !!concretePlant,
        concreteMarkerGone: !industrialPadMarkersV118.get('concrete'),
      }));
      console.log('concrete before/after:', JSON.stringify(concreteBefore), JSON.stringify(concreteAfter));
      assert(concreteAfter.concretePlantBuiltV118, 'concrete plant must be built after pressing its pad');
      assert(concreteAfter.concretePlant, 'the concrete plant object (concretePlant) must actually exist');
      assertEqual(concreteBefore.money - concreteAfter.money, 380, 'concrete plant must cost exactly 380 money (CONCRETE_PAD_COST_V118)');
      assertEqual(concreteBefore.wood - concreteAfter.wood, 6, 'concrete plant must cost exactly 6 planks (CONCRETE_PAD_COST_V118)');
      assert(concreteAfter.concreteMarkerGone, 'concrete marker must be removed once built');

      const metalBefore = await page.evaluate(() => ({ money, wood: planks, metalPlant: !!metalPlant }));
      await page.evaluate(() => { const p = industrialStepV118('metal').pos; player.position.set(p.x, 0, p.z); });
      await page.waitForTimeout(400);
      await pressActionBtn(page);
      const metalAfter = await page.evaluate(() => ({
        money, wood: planks, metalYardBuiltV118, metalPlant: !!metalPlant,
        metalMarkerGone: !industrialPadMarkersV118.get('metal'),
        allBuilt: sawmillBuiltV118 && fleetDepotBuiltV118 && concretePlantBuiltV118 && metalYardBuiltV118,
      }));
      console.log('metal before/after:', JSON.stringify(metalBefore), JSON.stringify(metalAfter));
      assert(metalAfter.metalYardBuiltV118, 'metal yard must be built after pressing its pad');
      assert(metalAfter.metalPlant, 'the metal plant object (metalPlant) must actually exist');
      assertEqual(metalBefore.money - metalAfter.money, 520, 'metal yard must cost exactly 520 money (METAL_PAD_COST_V118)');
      assertEqual(metalBefore.wood - metalAfter.wood, 8, 'metal yard must cost exactly 8 planks (METAL_PAD_COST_V118)');
      assert(metalAfter.metalMarkerGone, 'metal marker must be removed once built');
      assert(metalAfter.allBuilt, 'all four industrial flags must be true once the full chain is built');
      ok('concrete + metal built in parallel after sawmill; all 4 industrial flags end true; no leftover markers');
    } catch (e) { fail(e.message); console.error(e.stack); } finally { await game.close(); }
  }

  // --- 3. Market: a stall is not even a candidate before its own unlock stageIndex; becomes a
  //         'stallBuild' vacant-marker candidate once unlocked; paying its cost builds the real
  //         tent and swaps it into the ordinary 'stall' purchase path, unchanged from before. ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2500 });
    const { page } = game;
    try {
      // 'team' unlocks at stageIndex 1. At stageIndex 0 it must not be a candidate at all.
      const beforeUnlock = await page.evaluate(() => {
        stageIndex = 0;
        const cfg = MARKET_STALLS_V116.find((c) => c.id === 'team');
        player.position.set(cfg.pos.x, 0, cfg.pos.z);
        return { target: nearestManualTargetV53(), vacantExists: !!marketRuntimeV116.vacant.get('team') };
      });
      assertEqual(beforeUnlock.target, null, 'the team stall must not be a candidate at all before stageIndex reaches its unlock');
      assert(!beforeUnlock.vacantExists, 'no vacant marker for the team stall before its unlock stageIndex');
      ok('an unlocked-too-early stall has no candidate and no vacant marker (mirrors SPECIAL_PROJECTS precedent)');

      // Reaching stageIndex 1 must reveal its vacant marker and make it a 'stallBuild' candidate.
      const atUnlock = await page.evaluate(() => {
        stageIndex = 1;
        money = 5000;
        refreshMarketStallsV118();
        const cfg = MARKET_STALLS_V116.find((c) => c.id === 'team');
        player.position.set(cfg.pos.x, 0, cfg.pos.z);
        const target = nearestManualTargetV53();
        return { type: target?.type, stallId: target?.stall?.id, vacantExists: !!marketRuntimeV116.vacant.get('team') };
      });
      console.log('team stall at unlock:', JSON.stringify(atUnlock));
      assertEqual(atUnlock.type, 'stallBuild', 'the team stall must become a stallBuild candidate once stageIndex reaches its unlock');
      assertEqual(atUnlock.stallId, 'team', 'the candidate must be the team stall specifically');
      assert(atUnlock.vacantExists, 'a vacant marker must exist for the team stall once unlocked');

      const before = await page.evaluate(() => ({ money, staffBuilder: staffState.builder, built: marketStallsBuiltV118.has('team') }));
      await pressActionBtn(page);
      const after = await page.evaluate(() => ({
        money, built: marketStallsBuiltV118.has('team'),
        tentExists: !!marketRuntimeV116.stalls.get('team'),
        vacantGone: !marketRuntimeV116.vacant.get('team'),
      }));
      console.log('team stall build before/after:', JSON.stringify(before), JSON.stringify(after));
      assert(after.built, 'team stall must be built after pressing its vacant marker');
      assertEqual(before.money - after.money, 130, 'team stall must cost exactly 130 money');
      assert(after.tentExists, 'the real stall tent (createMarketStall) must now exist');
      assert(after.vacantGone, 'the vacant marker must be removed once built');
      ok('team stall builds via the real ground-pad mechanism at exactly its documented cost');

      // Once built, the ORIGINAL purchase mechanism (unchanged) must work exactly as before.
      const purchaseBefore = await page.evaluate(() => staffState.builder);
      await page.waitForTimeout(400);
      await pressActionBtn(page);
      const purchaseAfter = await page.evaluate(() => staffState.builder);
      console.log('team stall purchase before/after:', purchaseBefore, purchaseAfter);
      assert(purchaseAfter > purchaseBefore, 'once built, the stall must resume its ORIGINAL purchase behaviour (buyStaffUpgrade) unchanged');
      ok('once built, a stall keeps its pre-existing purchase mechanics exactly as before this pass');
    } catch (e) { fail(e.message); console.error(e.stack); } finally { await game.close(); }
  }

  // --- 4. Unlock order sanity: every configured stageIndex threshold matches the documented
  //         reasoning (team/exchange earliest, meta latest -- only relevant post-prestige). ---
  {
    const game = await openGame({ save: 'clear', waitMs: 2000 });
    const { page } = game;
    try {
      const unlocks = await page.evaluate(() => Object.fromEntries(MARKET_STALLS_V116.map((c) => [c.id, c.unlock])));
      console.log('market unlock order:', JSON.stringify(unlocks));
      assertEqual(unlocks.team, 1, 'team unlocks at stageIndex 1');
      assertEqual(unlocks.exchange, 1, 'exchange unlocks at stageIndex 1');
      assertEqual(unlocks.operations, 2, 'operations unlocks at stageIndex 2');
      assertEqual(unlocks.fleet, 2, 'fleet unlocks at stageIndex 2');
      assertEqual(unlocks.tenders, 3, 'tenders unlocks at stageIndex 3 (matches MAJOR_TENDERS itself)');
      assertEqual(unlocks.bonus, 4, 'bonus unlocks at stageIndex 4');
      assertEqual(unlocks.meta, 6, 'meta unlocks latest (stageIndex 6) -- only really useful once the player has prestiged');
      assert(unlocks.meta > unlocks.tenders && unlocks.tenders > unlocks.team, 'meta must unlock strictly later than tenders, which unlocks strictly later than team/exchange');
      ok('market unlock order matches the documented reasoning (team/exchange first, meta last)');

      const industrialOrder = await page.evaluate(() => INDUSTRIAL_BUILD_STEPS_V118.map((s) => s.id));
      assertEqual(JSON.stringify(industrialOrder), JSON.stringify(['depot', 'sawmill', 'concrete', 'metal']), 'industrial build order must be depot -> sawmill -> concrete -> metal');
      ok('industrial build order matches the documented reasoning (depot first, to avoid the delivery softlock)');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  // --- 5. Old-save regression: an existing save (no v118 fields at all) keeps everything built,
  //         both systems -- exactly as before this pass. ---
  {
    const game = await openGame({ save: OLD_SAVE, waitMs: 2500 });
    const { page } = game;
    try {
      const state = await page.evaluate(() => ({
        sawmillBuiltV118, fleetDepotBuiltV118, concretePlantBuiltV118, metalYardBuiltV118,
        marketStallsBuiltV118: [...marketStallsBuiltV118].sort(),
        marketBuiltCount: marketRuntimeV116.stalls.size,
      }));
      console.log('old-save staged-unlock state:', JSON.stringify(state));
      assert(state.sawmillBuiltV118 && state.fleetDepotBuiltV118 && state.concretePlantBuiltV118 && state.metalYardBuiltV118, 'all 4 industrial flags must default true on an old save');
      assertEqual(state.marketStallsBuiltV118.length, 7, 'all 7 market stalls must default built on an old save');
      assertEqual(state.marketBuiltCount, 7, 'all 7 stall tents must actually exist in the scene on an old save');
      ok('an old save keeps the whole industrial zone and market fully built, unchanged by this pass');
    } catch (e) { fail(e.message); } finally { await game.close(); }
  }

  console.log(failures === 0 ? '\nstaged-unlock.test.mjs: PASS' : `\nstaged-unlock.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
