// Concrete road-network regression checklist documented in ROADS_V116_NOTES.md, run against a
// live game (old-format save -> industrial zone + auto roads already built, matching every prior
// agent's live-measurement convention this session: real scene geometry, never the file's own
// self-audit objects).
import { openGame, OLD_SAVE, buildHousesViaNormalPath, assert, assertEqual } from './lib/harness.mjs';

function stageDeckUUIDs(page) {
  return page.evaluate(() => {
    const s = [];
    scene.traverse((o) => { if (o.isMesh && o.userData?.v86StageRoad) s.push(o.uuid); });
    return s;
  });
}
function diffSets(before, after) {
  const b = new Set(before), a = new Set(after);
  return {
    destroyed: [...b].filter((x) => !a.has(x)).length,
    created: [...a].filter((x) => !b.has(x)).length,
    kept: [...b].filter((x) => a.has(x)).length,
  };
}

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  const game = await openGame({ save: OLD_SAVE, waitMs: 3500 });
  const { page } = game;
  try {
    await page.evaluate(() => {
      money = 999999999; wood = planks = 999999; concrete = 999999; metal = 999999;
      if (typeof cityState !== 'undefined') cityState.reputation = 999999;
    });

    // --- 1. Fleet-yard / road overlap (Box3 AABB overlap, real world matrices). ---
    const fleetOverlap = await page.evaluate(() => {
      const fleet = scene.getObjectByName('v116FleetYard');
      if (!fleet) return { skipped: true };
      // The parking-lot slab isn't named (only the group is) -- identify it as the largest-XZ-
      // footprint mesh directly in the group (built as a flat BoxGeometry(11.92,.032,3.72), by
      // far the biggest single mesh in the yard).
      let lotBox = null, bestArea = 0;
      fleet.traverse((o) => {
        if (!o.isMesh || !o.geometry?.parameters?.width || !o.geometry?.parameters?.depth) return;
        const area = o.geometry.parameters.width * o.geometry.parameters.depth;
        if (area > bestArea) { bestArea = area; o.updateWorldMatrix(true, false); lotBox = new THREE.Box3().setFromObject(o); }
      });
      if (!lotBox) return { skipped: true };
      let overlap = 0;
      scene.traverse((o) => {
        if (!o.isMesh || !o.userData) return;
        if (!(o.userData.v59RoadDeck || o.userData.v86StageRoad || o.userData.v66ServiceRoad || o.userData.v116PersistentRoad)) return;
        o.updateWorldMatrix(true, false);
        const b = new THREE.Box3().setFromObject(o);
        if (b.intersectsBox(lotBox)) overlap++;
      });
      return { overlap };
    });
    console.log('fleetOverlap:', JSON.stringify(fleetOverlap));
    if (!fleetOverlap.skipped) {
      assertEqual(fleetOverlap.overlap, 0, 'fleet-yard lot must not overlap any road deck mesh');
    }
    ok('fleet-yard/road overlap check ran');

    // --- 2. Conveyor <-> road clearance: real OBB-vs-OBB (SAT) in XZ plus a real Y-range check,
    //         not naive AABB -- a naive Box3 gives false positives against curved/diagonal road
    //         meshes (ShapeGeometry), whose axis-aligned bounding box is much larger than the
    //         actual paved polygon. Same method as scratchpad/roads116/conveyor_measure5.js
    //         (verified during the седьмой заход de-elevation pass), restricted like it was to
    //         rectangular BoxGeometry road decks (width/depth params) -- curved/junction fills
    //         are a separate, already-audited class (see roads.test.mjs's driveway/fleet-yard
    //         checks and ROADS_V116_NOTES.md for why straight decks are the right scope here).
    const conveyorClearance = await page.evaluate(() => {
      function obbCornersXZ(mesh) {
        mesh.updateWorldMatrix(true, false);
        const p = mesh.geometry.parameters;
        const hx = p.width / 2, hz = p.depth / 2;
        const local = [
          new THREE.Vector3(-hx, 0, -hz), new THREE.Vector3(hx, 0, -hz),
          new THREE.Vector3(hx, 0, hz), new THREE.Vector3(-hx, 0, hz),
        ];
        return local.map((v) => v.applyMatrix4(mesh.matrixWorld));
      }
      function satOverlap(polyA, polyB) {
        function axes(poly) {
          const out = [];
          for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
            const ex = -(p2.z - p1.z), ez = (p2.x - p1.x), len = Math.hypot(ex, ez) || 1;
            out.push({ x: ex / len, z: ez / len });
          }
          return out;
        }
        function project(poly, axis) {
          let min = Infinity, max = -Infinity;
          for (const p of poly) { const d = p.x * axis.x + p.z * axis.z; if (d < min) min = d; if (d > max) max = d; }
          return [min, max];
        }
        const allAxes = axes(polyA).concat(axes(polyB));
        for (const ax of allAxes) {
          const [aMin, aMax] = project(polyA, ax), [bMin, bMax] = project(polyB, ax);
          if (Math.min(aMax, bMax) - Math.max(aMin, bMin) <= 0) return false;
        }
        return true;
      }
      function realYRange(mesh) {
        mesh.updateWorldMatrix(true, false);
        const box = new THREE.Box3().setFromObject(mesh);
        return [box.min.y, box.max.y];
      }
      function yOverlap(a, b) { return !(a[1] < b[0] || a[0] > b[1]); }

      const conveyors = [];
      scene.traverse((o) => { if (o.isMesh && o.geometry?.type === 'BoxGeometry' && o.userData?.v116Conveyor) conveyors.push(o); });
      const roadTags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'];
      const roads = [];
      scene.traverse((o) => {
        if (!o.isMesh || !o.userData || !o.geometry?.parameters?.width || !o.geometry?.parameters?.depth) return;
        if (roadTags.some((t) => o.userData[t])) roads.push(o);
      });
      let overlaps = 0;
      for (const c of conveyors) {
        const cCorners = obbCornersXZ(c).map((v) => ({ x: v.x, z: v.z }));
        const cY = realYRange(c);
        for (const r of roads) {
          const rCorners = obbCornersXZ(r).map((v) => ({ x: v.x, z: v.z }));
          const rY = realYRange(r);
          if (satOverlap(cCorners, rCorners) && yOverlap(cY, rY)) overlaps++;
        }
      }
      return { conveyorCount: conveyors.length, roadCount: roads.length, overlaps };
    });
    console.log('conveyorClearance:', JSON.stringify(conveyorClearance));
    assertEqual(conveyorClearance.overlaps, 0, 'no conveyor mesh may overlap a road-deck mesh');
    ok('conveyor/road clearance check ran');

    // --- 3. Driveway reaches the building (real edge-to-nearest-road-mesh gap, not center-to-
    //         center). Building 0 came from the save; its driveway/road must already be paved. ---
    const driveway = await page.evaluate(() => {
      const b = buildings.find((bb) => bb.index === 0);
      if (!b) return { skipped: true };
      const realRadius = (typeof buildingCollisionRadius === 'function' ? buildingCollisionRadius(b) : 1.2) + 0.12;
      let bestGap = Infinity;
      scene.traverse((o) => {
        if (!o.isMesh || !o.userData) return;
        if (!(o.userData.v59RoadDeck || o.userData.v86StageRoad)) return;
        o.updateWorldMatrix(true, false);
        const box = new THREE.Box3().setFromObject(o);
        const dx = Math.max(box.min.x - b.pos.x, b.pos.x - box.max.x, 0);
        const dz = Math.max(box.min.z - b.pos.z, b.pos.z - box.max.z, 0);
        const d = Math.hypot(dx, dz) - realRadius;
        if (d < bestGap) bestGap = d;
      });
      return { bestGap: +bestGap.toFixed(3) };
    });
    console.log('driveway:', JSON.stringify(driveway));
    if (!driveway.skipped) {
      assert(driveway.bestGap < 0.35, `driveway must reach close to the building edge, got gap=${driveway.bestGap}`);
    }
    ok('driveway-reaches-building check ran');

    // --- 4. Road not relaid on an unrelated upgrade (signature-guard churn). ---
    let before = await stageDeckUUIDs(page);
    await page.evaluate(() => { if (typeof buyBaseUpgrade === 'function') buyBaseUpgrade('garage'); if (typeof refreshInfrastructureWorldV37 === 'function') refreshInfrastructureWorldV37(); });
    await page.waitForTimeout(400);
    let after = await stageDeckUUIDs(page);
    const garageChurn = diffSets(before, after);
    console.log('unrelatedGarageUpgradeChurn:', JSON.stringify(garageChurn));
    assertEqual(garageChurn.destroyed, 0, 'an unrelated garage upgrade must not destroy any stage-road mesh');
    assertEqual(garageChurn.created, 0, 'an unrelated garage upgrade must not create any stage-road mesh');
    ok('signature-guard churn check ran (0 destroyed / 0 created)');

    // --- 5. No idle-tick road rebuild: several 2s ticks with no state change must not touch the
    //         stage-road mesh set at all. ---
    before = await stageDeckUUIDs(page);
    const idleTicks = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(2000);
      after = await stageDeckUUIDs(page);
      idleTicks.push(diffSets(before, after));
      before = after;
    }
    console.log('idleTicks:', JSON.stringify(idleTicks));
    for (const t of idleTicks) {
      assertEqual(t.destroyed, 0, 'idle tick must not destroy any stage-road mesh');
      assertEqual(t.created, 0, 'idle tick must not create any stage-road mesh');
    }
    ok('idle-tick churn check ran (0 destroyed / 0 created across all ticks)');

    // --- 6. Stage-road corners actually rebuild after building houses via the REAL play path
    //         (purchaseCurrentPad, not spawnBuilding) -- regression test for commit 4bc7c60. ---
    await buildHousesViaNormalPath(page, 6);
    await page.waitForTimeout(1000);
    const network = await page.evaluate(() => window.__TYCOON_STAGE_ROADS__?.audit?.()?.network || null);
    console.log('stageRoadNetwork after building via normal path:', JSON.stringify(network));
    assert(network, 'stage-road audit API must be available');
    assert(network.stageIds.length >= 6, `expected several stage ids in the network, got ${JSON.stringify(network.stageIds)}`);
    assert((network.kinds.CORNER || 0) > 0, `expected CORNER junctions to actually appear (commit 4bc7c60 regression), got kinds=${JSON.stringify(network.kinds)}`);
    const hasTorX = (network.kinds.T || 0) > 0 || (network.kinds.X || 0) > 0;
    assert(hasTorX, `expected at least one T or X junction once several houses share a stage-road stem, got kinds=${JSON.stringify(network.kinds)}`);
    ok(`stage-road corners rebuild after normal-path house construction: kinds=${JSON.stringify(network.kinds)}`);
  } catch (e) {
    fail(e.message);
    console.error(e.stack);
  } finally {
    await game.close();
  }

  console.log(failures === 0 ? '\nroads.test.mjs: PASS' : `\nroads.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
