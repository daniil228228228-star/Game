// Sawmill surroundings, CHANGELOG_V161.md "2026-10-04 (10)": the right-hand camp building + the log belt are gone, the "ДОСКИ · ПОГРУЗКА" pickup moved to the plank outlet,
// its board stack is the real plank stock. TWO launches: fresh game (stage 0, depot + sawmill built, the user's screenshot situation) and OLD_SAVE (stage 1, every flag built).
//   FRESH:  A. camp (shed, porch, rack of boards, log pile) and the 33-object log belt are not in the scene graph, no orphan meshes at the old camp spot, the camp collider is gone,
//              the sawmill collider / drop-off / level pads are where they were, the 6 choppable trees (the log source) stay; road meshes == the pre-change signature (count + hash).
//           B. hand-cut logs still reach the mill: drop-off -> dock (no belt), planks are credited exactly once, a log in flight survives a snapshot/restore.
//           C. the pickup block (plate, stripes, posts, ring, name plate, stack) stands at the plank outlet under the lean-to: within 1.5 m of the belt exit, on the lean-to floor,
//              outside the hall box, approach walkable, >= 2.6 m from every other pad (so no two prompts compete), no tree within 4 m; trucks keep the road node plankBay.
//           D. the stack is the real stock: planks 0 -> nothing drawn (and no static lumber pile anywhere in the mill), 1, 5, 24, 60 (cap 24), spent -> shrinks, one merged mesh with
//              <= 24 boards; the live animate loop follows without any helper call; a log arriving adds exactly that many boards.
//           E. screenshots (SHOTS_DIR): the area after the cleanup, the pickup with an empty stack, with 7 boards, with 24; the name plate is visible at the pad. 0 console errors / 4xx.
//   OLD_SAVE: F. same removals + road signature; G. a real construction ticket: guidance (currentGuidanceTarget / __TYCOON_MANUAL_NAV__) leads to the NEW pickup, the real #actionBtn
//              loads there (and leaves `planks` and the stack alone: the cost was paid at purchase); H. a production event (the saw timer) adds exactly one board batch; scene child count,
//              geometries and textures return to baseline after 4 cycles; the stack never exceeds its cap; 0 errors.
//   LAUNCHES=fresh|old runs one.
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.LAUNCHES || '';
const J = JSON.stringify;
// road meshes (v70 service roads + v113 starter surface + stage roads). OLD_SAVE: measured on commit 93573ed, before the camp/belt removal, and unchanged ever since.
// fresh (stage 0, depot + sawmill, no house yet): 47 / -510574045 on 93573ed; since 2026-10-05 (5) ("nothing without a reason", tests/world-consistency.test.mjs) the north corridor for the
// unbuilt concrete / metal plants and the link to the empty city hub are not paved, so the same state is 17 meshes (hash 678830722).
const ROADS_BEFORE = { fresh: { count: 17, hash: 678830722 }, old: { count: 51, hash: 648310607 } };

// ---- helpers evaluated inside the page (kept as source strings so both launches share them)
const PAGE = () => {
  window.__roadSig = () => {
    const roads = [];
    scene.traverse((o) => { if (!o.isMesh) return; for (let p = o.parent; p; p = p.parent) { if (p.name === 'v70RefinedServiceRoads' || p.name === 'v113UnifiedStarterRoadSurface' || p === cityWorldRuntime?.stageRoads) { roads.push(o); break; } } });
    scene.updateMatrixWorld(true);
    const strs = roads.map((o) => { const b = new THREE.Box3().setFromObject(o); return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => v.toFixed(2)).join(','); }).sort();
    let h = 5381; for (const s of strs.join('|')) h = ((h << 5) + h + s.charCodeAt(0)) | 0;
    return { count: roads.length, hash: h, uuids: roads.map((o) => o.uuid) };
  };
  // everything of the old camp: any scene object whose subtree has a mesh within r of GENERATOR_POS, minus choppable trees, workers, trees' own decorations
  window.__campLeft = (r) => {
    const skip = new Set();
    for (const t of sourceTrees) skip.add(t.mesh);
    for (const k of Object.keys(LOGISTICS_ZONES)) skip.add(LOGISTICS_ZONES[k].group);   // 2026-10-10 (12): the concrete pad now stands in its loading yard (-43.1, -5.5), 1.15 m from the old camp anchor
    if (window.YardsV161?.group()) skip.add(window.YardsV161.group());
    for (const w of (typeof npcWorkers !== 'undefined' ? npcWorkers : [])) if (w.group) skip.add(w.group);
    const hits = [];
    const wp = new THREE.Vector3();
    scene.updateMatrixWorld(true);
    for (const o of scene.children) {
      if (skip.has(o)) continue;
      const d0 = Math.hypot(o.position.x - GENERATOR_POS.x, o.position.z - GENERATOR_POS.z);
      if (d0 > r + 6) continue;
      o.traverse((m) => { if (!m.isMesh && !m.isSprite) return; m.getWorldPosition(wp); const d = Math.hypot(wp.x - GENERATOR_POS.x, wp.z - GENERATOR_POS.z); if (d < r) hits.push({ top: o.type + ':' + (o.name || ''), kids: o.children.length, d: +d.toFixed(2), conv: !!m.userData?.v116Conveyor }); });
    }
    return hits;
  };
  window.__stackInfo = () => {
    const z = LOGISTICS_ZONES.planks, m = z.group.getObjectByName('v161PlankStack');
    const g = m.geometry, per = 36, dr = g.drawRange, total = g.index ? g.index.count : g.attributes.position.count;
    return { shown: m.visible ? Math.min(dr.count, total) / per : 0, visible: m.visible, drawCount: dr.count, boards: total / per, indexed: !!g.index, meshes: z.group.children.filter((c) => c.name === 'v161PlankStack').length, planks };
  };
  window.__shot = (target, camLocal, q) => { // camera placed in the mill frame (camLocal) looking at world `target`
    scene.updateMatrixWorld(true);
    const cp = sawmillMillV161.localToWorld(new THREE.Vector3(camLocal[0], camLocal[1], camLocal[2]));
    camera.position.copy(cp); camera.lookAt(new THREE.Vector3(target[0], target[1], target[2])); camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', q || 0.9);
  };
};
const save = (name, data) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data.split(',')[1], 'base64')); };

// ================================================================================================ FRESH
async function runFresh() {
  const g = await openGame({ save: 'clear', waitMs: 5000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(PAGE);
  await ev(() => { money = 1e9; planks = 0; buildIndustrialStepV118(industrialStepV118('depot')); buildIndustrialStepV118(industrialStepV118('sawmill')); });
  await page.waitForTimeout(4000);
  const boot = await ev(() => ({ stage: stageIndex, built: sawmillBuiltV118, mill: !!sawmillMillV161, planks }));
  check(boot.stage === 0 && boot.built && boot.mill && boot.planks === 0, `fresh game, stage 0, sawmill built, 0 planks ${J(boot)}`);

  // ---------------------------------------------------------------- A. camp + belt gone
  const A = await ev(() => {
    let conv = 0; scene.traverse((o) => { if (o.userData?.v116Conveyor) conv++; });
    const left = __campLeft(1.8);
    const big = scene.children.filter((o) => o.type === 'Group' && o.children.length >= 15 && Math.hypot(o.position.x - GENERATOR_POS.x, o.position.z - GENERATOR_POS.z) < 0.5).length;
    const ring = sourceTrees.filter((t) => Math.hypot(t.mesh.position.x - GENERATOR_POS.x, t.mesh.position.z - GENERATOR_POS.z) < 4).length;
    const campCollider = STATIC_COLLIDERS.filter((c) => Math.hypot(c.pos.x - GENERATOR_POS.x, c.pos.z - GENERATOR_POS.z) < 0.5).length;
    const saw = STATIC_COLLIDERS.find((c) => c.pos.distanceTo(SAWMILL_POS) < 1e-6);
    const sig = __roadSig();
    return { conv, left, big, ring, campCollider, sawR: saw && saw.radius, children: scene.children.length, roads: { count: sig.count, hash: sig.hash }, fnGone: [typeof addConveyorFlatBox, typeof addLogPile, typeof conveyorSlats],
      drop: [SAWMILL_DROPOFF_POS.x - SAWMILL_POS.x, SAWMILL_DROPOFF_POS.z - SAWMILL_POS.z], pad2: [SAWMILL_UPGRADE_PAD_POS_V161.x - SAWMILL_POS.x, SAWMILL_UPGRADE_PAD_POS_V161.z - SAWMILL_POS.z] };
  });
  check(A.conv === 0, `no log-belt object left in the scene graph (userData.v116Conveyor: ${A.conv}; before: 33)`);
  check(A.left.length === 0, `no mesh of the old camp (shed, porch, rack, log pile, belt) within 1.8 m of the old camp spot ${J(A.left.slice(0, 5))}`);
  check(A.big === 0 && A.fnGone.join() === 'undefined,undefined,undefined', `no 20-mesh camp group, builders removed ${J(A.fnGone)}`);
  check(A.campCollider === 0 && A.sawR === 2.15, `the camp collider is gone, the sawmill collider r ${A.sawR} stays`);
  check(A.ring >= 5, `the 6 choppable trees around the old camp (the log source) stay (${A.ring})`);
  check(Math.abs(A.drop[0] - 2.75) < 1e-6 && Math.abs(A.drop[1] - 1.7) < 1e-6 && Math.abs(A.pad2[1] - 4.4) < 1e-6, `drop-off and level-2 pad unchanged ${J(A.drop)} ${J(A.pad2)}`);
  check(A.roads.count === ROADS_BEFORE.fresh.count && A.roads.hash === ROADS_BEFORE.fresh.hash, `road meshes unchanged by the removal: ${A.roads.count} meshes, hash ${A.roads.hash} (before ${ROADS_BEFORE.fresh.count} / ${ROADS_BEFORE.fresh.hash}); scene children now ${A.children} (before 586)`);

  // ---------------------------------------------------------------- B. logs still reach the mill
  const Bl = await ev(() => {
    const before = planks, n0 = logsInTransit.length;
    carriedLogs = 2; deliverCarriedLogs();
    const spawned = logsInTransit.length - n0, start = logsInTransit[0].path.map((p) => [+p.x.toFixed(2), +p.z.toFixed(2)]);
    const snap = sawmillTransitSnapshotV153();
    const per = planksPerDeliveredLog();
    const onLine = []; let steps = 0, maxOff = 0;
    const a = SAWMILL_DROPOFF_POS, b = SAWMILL_BELT_END_V161, ab = new THREE.Vector3().subVectors(b, a).setY(0), len2 = ab.lengthSq();
    for (; steps < 200 && logsInTransit.length; steps++) {
      updateSawmill(0.1);
      for (const l of logsInTransit) {
        if (l.delay > 0) continue;
        const t = Math.max(0, Math.min(1, ((l.mesh.position.x - a.x) * ab.x + (l.mesh.position.z - a.z) * ab.z) / len2));
        const off = Math.hypot(l.mesh.position.x - (a.x + ab.x * t), l.mesh.position.z - (a.z + ab.z * t));
        maxOff = Math.max(maxOff, off);
      }
    }
    return { spawned, per, credited: planks - before, left: logsInTransit.length, steps, maxOff: +maxOff.toFixed(2), start, snap, dock: [b.x - SAWMILL_POS.x, b.z - SAWMILL_POS.z] };
  });
  check(Bl.spawned === 2 && Bl.left === 0 && Bl.credited === 2 * Bl.per, `2 delivered logs roll into the mill and credit exactly ${2 * Bl.per} planks once (credited ${Bl.credited}, ${Bl.steps} steps of 0.1 s, nothing left in transit)`);
  check(Bl.maxOff < 0.25, `the logs stay on the 1.2 m run drop-off -> dock (max off-line ${Bl.maxOff} m): no belt, no detour to the old camp`);
  const restored = await ev(() => { planks = 0; carriedLogs = 1; deliverCarriedLogs(); updateSawmill(1.5); const snap = sawmillTransitSnapshotV153(); restoreSawmillTransitV153(snap); const n = logsInTransit.length; const again = sawmillTransitSnapshotV153(); for (let i = 0; i < 100 && logsInTransit.length; i++) updateSawmill(0.1); return { snap, again, n, left: logsInTransit.length, planks }; });
  check(restored.snap.length === 1 && restored.n === 1 && J(restored.snap.map((s) => s.segment)) === J(restored.again.map((s) => s.segment)) && restored.left === 0 && restored.planks > 0, `a log in flight survives snapshot/restore and still arrives ${J(restored.snap)}`);

  // ---------------------------------------------------------------- C. pickup placement
  const C = await ev(() => {
    scene.updateMatrixWorld(true);
    const m = sawmillMillV161, lay = m.userData.layout, L = SAWMILL_L_V161, z = LOGISTICS_ZONES.planks;
    const loc = (x, zz) => { const v = m.worldToLocal(new THREE.Vector3(x, 0, zz)); return [v.x, v.z]; };
    const pk = loc(z.pos.x, z.pos.z);
    const outlet = m.localToWorld(new THREE.Vector3(L.BELT_X, 0, L.BELT_Z1));
    const front = m.localToWorld(new THREE.Vector3(L.PICK_X, 0, L.PICK_Z + 1.8));
    const side = m.localToWorld(new THREE.Vector3(L.PICK_X - 1.8, 0, L.PICK_Z + 0.2));
    const solveF = resolvePlayerCircleCollisions(front.x, front.z), solveS = resolvePlayerCircleCollisions(side.x, side.z);
    const others = [['dropoff', SAWMILL_DROPOFF_POS], ['level-2 pad', SAWMILL_UPGRADE_PAD_POS_V161], ['level-3 pad', industrialStepV118('sawmill3')?.pos], ...FIELD_UPGRADE_CONFIGS.map((f) => ['field ' + f.key, f.pos]), ['depot pad', FLEET_DEPOT_PAD_POS_V118], ['sawmill pad', SAWMILL_PAD_POS_V118]]
      .filter((o) => o[1]).map(([n, p]) => [n, +Math.hypot(p.x - z.pos.x, p.z - z.pos.z).toFixed(2)]);
    const trees = sourceTrees.map((t) => Math.hypot(t.mesh.position.x - z.pos.x, t.mesh.position.z - z.pos.z)).sort((a, b) => a - b)[0];
    const padSolve = resolvePlayerCircleCollisions(z.pos.x, z.pos.z), stackBoxes = sawmillObstaclesV161().filter((o) => /stack/.test(o.label)).length; // 2026-10-05 (6): the pickup pad is ON the pile, the pile has no collider any more
    const bay = serviceAccessGraph().find((n) => n.id === 'plankBay').p, src = cargoInfo('planks').source;
    const kids = z.group.children.map((c) => c.name || c.type);
    return {
      pick: pk.map((v) => +v.toFixed(2)), toOutlet: +Math.hypot(z.pos.x - outlet.x, z.pos.z - outlet.z).toFixed(2), y: z.group.position.y, rotMatch: Math.abs(z.group.rotation.y - m.rotation.y) < 1e-9,
      lean: [lay.leanX0, lay.leanX1, lay.zf, lay.leanZ1], visible: z.group.visible, labelY: z.label.position.y,
      hall: { z0: lay.zb, z1: lay.zf }, solvedFront: solveF.hit, solvedSide: solveS.hit, others, nearestTree: +trees.toFixed(2), padPushed: +Math.hypot(padSolve.x - z.pos.x, padSolve.z - z.pos.z).toFixed(3), padHit: padSolve.hit, stackBoxes,
      truck: { toBay: +bay.distanceTo(src).toFixed(3), fromPickup: +Math.hypot(src.x - z.pos.x, src.z - z.pos.z).toFixed(2) }, kids, keepDist: +sawmillFootprintDistV161(z.pos.x, z.pos.z).toFixed(2),
      oldSlab: scene.children.filter((o) => o.type === 'Group' && o !== z.group && o.children.some((c) => c.isSprite) && Math.hypot(o.position.x - PLANK_TRUCK_BAY_POS_V161.x, o.position.z - PLANK_TRUCK_BAY_POS_V161.z) < 1).length,
    };
  });
  check(C.toOutlet <= 1.5 && C.visible, `pickup block is ${C.toOutlet} m from the plank belt exit (limit 1.5), visible after the sawmill is built`);
  check(C.pick[0] >= C.lean[0] && C.pick[0] <= C.lean[1] && C.pick[1] > C.hall.z1 + 0.6 && C.pick[1] <= C.lean[3] + 0.2 && Math.abs(C.y - 0.2) < 1e-9 && C.rotMatch, `pickup stands under the lean-to (mill frame ${J(C.pick)}, lean-to x ${C.lean[0]}..${C.lean[1]}, z ${C.lean[2]}..${C.lean[3]}), on the lean-to floor (y ${C.y}), outside the hall box (z > ${C.hall.z1}), yawed with the mill`);
  check(!C.solvedFront && !C.solvedSide && !C.padHit && C.padPushed === 0 && C.stackBoxes === 0, `the approach is walkable (front/side points are not pushed) and the pickup pad stands outside every collider (pushed ${C.padPushed} m; the old stack box pushed 0.85 m, the pile has no collider now)`);
  check(C.others.every(([, d]) => d >= 2.6), `>= 2.6 m (interact radius 2.55) from every other pad ${J(C.others)}`);
  check(C.nearestTree > 4, `no choppable tree within 4 m of the pickup (${C.nearestTree} m); the pickup is inside the mill footprint, the keep-out distance is ${C.keepDist}`);
  check(C.labelY > 2.2 && C.kids.includes('v161PlankStack'), `name plate above the roof (y ${C.labelY}), the stack is a child of the zone (${J(C.kids.slice(-3))})`);
  check(C.truck.toBay > 1.5 && C.truck.toBay < 3 && C.truck.fromPickup > 3 && C.oldSlab === 0, `since 2026-10-10 (12) trucks load in the plank yard bay beside the spur end, off the lane node plankBay (${C.truck.toBay} m from it, ${C.truck.fromPickup} m from the pickup); nothing named/plated left at the old bay (${C.oldSlab})`);

  // ---------------------------------------------------------------- E. screenshots (taken BEFORE the simulated production below: updateSawmill() called in a loop leaves burst particles in the air)
  await ev(() => { planks = 0; syncPlankStackV161(); });
  await page.waitForTimeout(6000); // the build bursts of the sawmill pad expire through the real loop
  const shotA = await ev(() => { const c = new THREE.Vector3((GENERATOR_POS.x + SAWMILL_POS.x) / 2, 0, (GENERATOR_POS.z + SAWMILL_POS.z) / 2); camera.position.set(c.x, 16, c.z + 20); camera.lookAt(c); camera.updateMatrixWorld(true); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.88); });
  save('sawmill-area-1-after-cleanup.jpg', shotA);
  // the player stands at the pad (the name plate is distance-gated like every label)
  await ev(() => { const L = SAWMILL_L_V161, p = sawmillMillV161.localToWorld(new THREE.Vector3(L.PICK_X + 0.4, 0, L.PICK_Z + 2.2)); player.position.set(p.x, 0, p.z); });
  const plate = await page.waitForFunction(() => { const l = LOGISTICS_ZONES.planks.label; return l.visible && l.material.opacity > 0.5 ? { vis: l.visible, op: l.material.opacity } : false; }, null, { timeout: 15000, polling: 'raf' }).then((h) => h.jsonValue(), () => false);
  check(!!plate, `the name plate "ДОСКИ · ПОГРУЗКА" is visible with the player at the pad ${J(plate)}`);
  const aim = await ev(() => { const z = LOGISTICS_ZONES.planks; return [z.pos.x, 0.3, z.pos.z]; });
  const shotB = await ev((t) => __shot(t, [-5.2, 4.3, 8.6]), aim);
  save('sawmill-area-2-pickup-empty.jpg', shotB);
  await ev(() => { planks = 7; syncPlankStackV161(); });
  const shotC = await ev((t) => __shot(t, [-5.2, 4.3, 8.6]), aim);
  save('sawmill-area-3-pickup-7-boards.jpg', shotC);
  const shotD = await ev((t) => { planks = 24; syncPlankStackV161(); return __shot(t, [-3.4, 2.6, 6.2]); }, aim);
  save('sawmill-area-4-pickup-24-boards-close.jpg', shotD);
  check(shotA.length > 20000 && shotB.length !== shotC.length, `screenshots taken (${shotA.length}/${shotB.length}/${shotC.length}/${shotD.length} bytes of jpeg data; empty and 7-board images differ)`);

  // ---------------------------------------------------------------- D. the stack is the stock
  const D = await ev(() => {
    const out = {}, set = (n) => { planks = n; syncPlankStackV161(); return __stackInfo(); };
    out.s0 = set(0); out.s1 = set(1); out.s5 = set(5); out.s23 = set(23); out.s24 = set(24); out.s60 = set(60); out.s9999 = set(9999);
    planks = 40; out.pay = (() => { const ok = tryPayResources({ money: 0, wood: 36 }); syncPlankStackV161(); return { ok, ...__stackInfo() }; })();
    out.payMore = (() => { const ok = tryPayResources({ money: 0, wood: 2 }); syncPlankStackV161(); return { ok, ...__stackInfo() }; })();
    out.s0b = set(0);
    out.lumberMeshes = []; sawmillMillV161.traverse((o) => { if (o.isMesh && /plank|lumber/i.test(o.name) && o.name !== 'v161SawBoard0' && !/^v161SawBoard\d$/.test(o.name)) out.lumberMeshes.push(o.name); });
    out.mill = []; sawmillMillV161.traverse((o) => { if (o.isMesh && /^v161SawmillPlanks$/.test(o.name)) out.mill.push(o.name); });
    out.draw = { calls: renderer.info.render.calls };
    out.stackMeshes = 0; scene.traverse((o) => { if (o.name === 'v161PlankStack') out.stackMeshes++; });
    return out;
  });
  check(D.s0.shown === 0 && !D.s0.visible && D.s0.drawCount === 0, `planks 0: nothing drawn, the mesh is hidden ${J(D.s0)}`);
  check(D.s1.shown === 1 && D.s5.shown === 5 && D.s23.shown === 23 && D.s24.shown === 24, `stack count == stock: 1 -> ${D.s1.shown}, 5 -> ${D.s5.shown}, 23 -> ${D.s23.shown}, 24 -> ${D.s24.shown}`);
  check(D.s60.shown === 24 && D.s9999.shown === 24 && D.s60.boards === 24 && D.s60.indexed, `capped at 24 boards for stock 60 and 9999 (one merged mesh with ${D.s60.boards} boards, ${D.stackMeshes} stack mesh in the scene)`);
  check(D.pay.ok && D.pay.planks === 4 && D.pay.shown === 4 && D.payMore.planks === 2 && D.payMore.shown === 2 && D.s0b.shown === 0, `spending shrinks it: 40 -> pay 36 -> ${D.pay.shown} boards, -2 -> ${D.payMore.shown}, 0 -> ${D.s0b.shown}`);
  check(D.mill.length === 0 && D.lumberMeshes.length === 0, `no static lumber pile left in the mill (names ${J([...D.mill, ...D.lumberMeshes])})`);

  // live loop follows the real stock with no helper call; a log arriving adds exactly its boards
  await ev(() => { planks = 7; });
  const live = await page.waitForFunction(() => __stackInfo().shown === 7, null, { timeout: 15000, polling: 'raf' }).then(() => true, () => false);
  check(live, 'the real animate loop redraws the stack from planks = 7 without any helper call');
  const logAdd = await ev(() => {
    planks = 3; syncPlankStackV161(); const s0 = __stackInfo().shown, st0 = sawmillStateV161().stack;
    carriedLogs = 1; deliverCarriedLogs(); const per = planksPerDeliveredLog();
    const mid = []; for (let i = 0; i < 80 && logsInTransit.length; i++) { updateSawmill(0.1); syncPlankStackV161(); mid.push(__stackInfo().shown); }
    syncPlankStackV161(); const s1 = __stackInfo().shown, st1 = sawmillStateV161().stack;
    return { s0, s1, per, jumps: mid.filter((v, i) => i && v !== mid[i - 1]).length, added: st1.added - st0.added };
  });
  check(logAdd.s1 === logAdd.s0 + logAdd.per && logAdd.jumps <= 1 && logAdd.added === logAdd.per, `a log arriving puts exactly ${logAdd.per} boards on the stack in one step (${logAdd.s0} -> ${logAdd.s1}, ${logAdd.jumps} change event)`);

  check(g.errors.length === 0 && g.badResponses.length === 0, `fresh launch: 0 console errors, 0 4xx ${J(g.errors.slice(0, 3))} ${J(g.badResponses.slice(0, 3))}`);
  await g.close();
}

// ================================================================================================ OLD_SAVE
async function runOld() {
  const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(PAGE);
  const F = await ev(() => {
    let conv = 0; scene.traverse((o) => { if (o.userData?.v116Conveyor) conv++; });
    const sig = __roadSig(), z = LOGISTICS_ZONES.planks;
    return { stage: stageIndex, built: sawmillBuiltV118, conv, left: __campLeft(1.8).length, campCollider: STATIC_COLLIDERS.filter((c) => Math.hypot(c.pos.x - GENERATOR_POS.x, c.pos.z - GENERATOR_POS.z) < 0.5).length, roads: { count: sig.count, hash: sig.hash },
      planks, shown: (syncPlankStackV161(), __stackInfo().shown), zoneVisible: z.group.visible, ring: sourceTrees.filter((t) => Math.hypot(t.mesh.position.x - GENERATOR_POS.x, t.mesh.position.z - GENERATOR_POS.z) < 4).length };
  });
  check(F.stage === 1 && F.built && F.conv === 0 && F.left === 0 && F.campCollider === 0, `OLD_SAVE: camp and belt gone too ${J({ conv: F.conv, left: F.left, campCollider: F.campCollider })}`);
  check(F.roads.count === ROADS_BEFORE.old.count && F.roads.hash === ROADS_BEFORE.old.hash, `OLD_SAVE road meshes unchanged: ${F.roads.count} meshes, hash ${F.roads.hash} (before ${ROADS_BEFORE.old.count} / ${ROADS_BEFORE.old.hash})`);
  check(F.planks >= 10 && F.planks <= 12 && F.shown === F.planks && F.zoneVisible && F.ring >= 5, `OLD_SAVE keeps its planks (10 + whatever the saw made while booting) and the pickup shows exactly that many boards (${F.planks} planks, ${F.shown} boards), the pad is visible, ${F.ring} log trees stay`);

  // ---------------------------------------------------------------- G. guidance + real load
  await ev(() => { money = 1e9; planks = 99999; concrete = 99999; metal = 99999; purchaseCurrentPad(); });
  const ticket = await page.waitForFunction(() => growingMeshes.some((b) => b?.entry?.underConstruction && (b.deliveryPlan || []).some((t) => t.cargo === 'planks' && !t.delivered)), null, { timeout: 30000, polling: 250 }).then(() => true, () => false);
  check(ticket, 'a construction site with an open plank delivery ticket exists');
  await ev(() => { planks = 6; syncPlankStackV161(); const c = growingMeshes.find((b) => b?.entry?.underConstruction); for (const t of c.deliveryPlan) if (t.cargo !== 'planks') t.delivered = true; });
  const G = await ev(() => {
    const z = LOGISTICS_ZONES.planks, gt = currentGuidanceTarget(), nav = window.__TYCOON_MANUAL_NAV__();
    const keep = currentPad; currentPad = null; const na = nextActionableTargetV117(); currentPad = keep;
    const d = (p) => (p ? +Math.hypot(p.x - z.pos.x, p.z - z.pos.z).toFixed(2) : null);
    return { gt: gt && { d: d(gt.pos), label: gt.label }, nav: nav && { mode: nav.mode, cargo: nav.cargo, d: d(nav), amount: nav.amount }, na: na && { type: na.type, d: d(na.pos) }, oldBay: +Math.hypot(PLANK_TRUCK_BAY_POS_V161.x - z.pos.x, PLANK_TRUCK_BAY_POS_V161.z - z.pos.z).toFixed(2), label: (z.v120LabelKey || '') };
  });
  check(G.gt && G.gt.d < 0.05 && /Погрузка|Load/.test(G.gt.label), `compass/ground arrow (currentGuidanceTarget) leads to the NEW pickup (${J(G.gt)}), not to the old bay ${G.oldBay} m away`);
  check(G.nav && G.nav.mode === 'pickup' && G.nav.cargo === 'planks' && G.nav.d < 0.05, `manual carry route (__TYCOON_MANUAL_NAV__) = pickup at the new pad ${J(G.nav)}`);
  check(!G.na || G.na.d === null || G.na.d > 2.6, `nextActionableTargetV117 does not send the player to the old bay (${J(G.na)})`);
  // walk up to the pad (front side, 2 m), the real #actionBtn loads
  const front = await ev(() => { const L = SAWMILL_L_V161, p = sawmillMillV161.localToWorld(new THREE.Vector3(L.PICK_X + 0.4, 0, L.PICK_Z + 1.9)); player.position.set(p.x, 0, p.z); return [p.x, p.z, resolvePlayerCircleCollisions(p.x, p.z).hit]; });
  check(front[2] === false, 'the standing point 1.9 m in front of the pad is walkable');
  const prompt = await page.waitForFunction(() => { const b = document.getElementById('actionBtn'), p = document.getElementById('actionPrompt'); return b && !b.hidden && b.dataset.v119ManualAction === 'load' && p.classList.contains('show') ? p.textContent + '|' + b.textContent : false; }, null, { timeout: 20000, polling: 'raf' }).then((h) => h.jsonValue(), () => '');
  check(/для стройки|for the site/.test(prompt), `standing at the new pad offers the plank load through the real prompt (${prompt})`);
  const before = await ev(() => ({ planks, shown: __stackInfo().shown, carry: { ...window.__TYCOON_V123__.state.carry } }));
  const pressed = await page.waitForFunction(() => { if (window.__TYCOON_V123__.state.carry.amount > 0) return true; const b = document.getElementById('actionBtn'); if (b && !b.hidden && !b.disabled) b.click(); return false; }, null, { timeout: 25000, polling: 'raf' }).then(() => true, () => false);
  const after = await ev(() => { syncPlankStackV161(); return { planks, shown: __stackInfo().shown, carry: { ...window.__TYCOON_V123__.state.carry } }; });
  check(pressed && after.carry.type === 'planks' && after.carry.amount > 0, `the real #actionBtn press loads ${after.carry.amount} planks at the new pad`);
  check(after.planks === before.planks && after.shown === Math.min(24, after.planks), `taking is not a stock draw (the cost was paid at construction start): planks ${before.planks} -> ${after.planks}, stack ${before.shown} -> ${after.shown} == floor(planks)`);

  // ---------------------------------------------------------------- H. production event + leak
  const H = await ev(() => {
    planks = 3; syncPlankStackV161(); const s0 = __stackInfo().shown, a0 = sawmillStateV161().stack.added;
    sawmillAutoTimer = sawmillAutoInterval() - 0.05; updateSawmill(0.1);
    const produced = 1 + Math.floor(stats.prestige / 3); syncPlankStackV161();
    const s1 = __stackInfo().shown, a1 = sawmillStateV161().stack.added;
    return { s0, s1, produced, batches: a1 - a0, planks };
  });
  check(H.planks === 3 + H.produced && H.s1 === H.s0 + H.produced && H.batches === H.produced, `one saw production event adds exactly one board batch (+${H.produced}: ${H.s0} -> ${H.s1} boards, planks ${H.planks})`);
  await ev(() => { window.__plantVis = () => { const v = []; for (const o of [concretePlant && concretePlant.group, metalPlant && metalPlant.group, (window.PRODUCTION_CHAIN_V161 && PRODUCTION_CHAIN_V161.prop() || {}).group]) if (o) o.traverse((m) => { if (m.isMesh && m.visible) v.push(m.name); }); return v.join(','); }; });
  const leak = await ev(() => {
    planks = 0; syncPlankStackV161(); sawmillAutoTimer = 0;
    // 2026-10-05 (6): draw everything once without frustum culling, so the GPU upload of a plant that first comes into view during the wait below (renderer.info counts a geometry
    // when it is first drawn) is not mistaken for a leak (the 8-14 meshes of the new concrete plant / metal yard made this flaky)
    { const culled = []; scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.frustumCulled) { culled.push(o); o.frustumCulled = false; } }); try { renderer.render(scene, camera); } finally { for (const o of culled) o.frustumCulled = true; } }
    const c0 = scene.children.length, g0 = renderer.info.memory.geometries, t0 = renderer.info.memory.textures;
    const interval = sawmillAutoInterval(), seen = []; let events = 0;
    for (let i = 0; i < Math.ceil(4 * interval / 0.2) + 2; i++) { const p0 = planks; updateSawmill(0.2); if (planks > p0) events++; syncPlankStackV161(); seen.push(__stackInfo().shown); }
    const info = __stackInfo();
    planks = 500; syncPlankStackV161(); const capped = __stackInfo().shown;
    window.__leak0 = { c0, g0, t0, vis: window.__plantVis() };
    return { events, shown: info.shown, planks: info.planks, capped, monotone: seen.every((v, i) => !i || v >= seen[i - 1]) };
  });
  // the burst particles of the 4 production events expire through the REAL animate loop; then everything must be back at the baseline
  await page.waitForFunction(() => scene.children.length <= window.__leak0.c0, null, { timeout: 30000, polling: 250 }).catch(() => {});
  Object.assign(leak, await ev(() => ({ children: [window.__leak0.c0, scene.children.length], geos: [window.__leak0.g0, renderer.info.memory.geometries], texs: [window.__leak0.t0, renderer.info.memory.textures], plantVis: [window.__leak0.vis, window.__plantVis()], stage: stageIndex, res: [concrete, metal, planks], stackMeshes: (() => { let n = 0; scene.traverse((o) => { if (o.name === 'v161PlankStack') n++; }); return n; })() })));
  check(leak.events >= 3 && leak.shown === Math.min(24, leak.planks) && leak.monotone && leak.capped === 24, `${leak.events} production events in 4 cycles: the stack grows with the stock (${leak.shown} boards, planks ${leak.planks}), never decreases while producing, capped at 24`);
  console.log('INFO plants during the leak window: ' + J({ vis: leak.plantVis, stage: leak.stage, res: leak.res }));
  check(leak.children[1] <= leak.children[0] && leak.geos[1] <= leak.geos[0] + 2 && leak.texs[0] === leak.texs[1] && leak.stackMeshes === 1, `no leak over the cycles: scene children ${J(leak.children)}, geometries ${J(leak.geos)}, textures ${J(leak.texs)}, ${leak.stackMeshes} stack mesh`);
  check(g.errors.length === 0 && g.badResponses.length === 0, `OLD_SAVE launch: 0 console errors, 0 4xx ${J(g.errors.slice(0, 3))} ${J(g.badResponses.slice(0, 3))}`);
  await g.close();
}

if (ONLY !== 'old') await runFresh();
if (ONLY !== 'fresh') await runOld();
