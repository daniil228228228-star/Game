// Invisible choppable trees (iPhone test 2026-10-04: "баг с деревьями остался, типа как будто они есть, но по факту они невидимые"),
// CHANGELOG_V161.md "2026-10-04 (9)". TWO browser launches: A = fresh save, B = OLD_SAVE (stage 1, roads, retired trees).
//
// Two real causes, both reproduced on the scene before the fix:
//   1. updateCameraFoliageOcclusion() hides every tree on the camera ray (up to 8) every 0.1 s; the tree the chop prompt was offered for stands within
//      2.65 m of the player and the camera sits ~9.7 m behind/above, so it was hidden in 174 of 912 poses (19 %) -- prompt, no tree.
//   2. a tree that a layout layer retired (hideSceneryOnRoads v84/v93, sawmill clearance v161) stayed state 'grown' in sourceTrees, so
//      updateTreeInteraction() kept offering "chop" for it (OLD_SAVE: 4 of 61 trees); the tutorial syncs v61/v62 also made sawmill-retired trees visible again.
// Assertions are made on the real scene objects: every tree the chop prompt can be offered for (updateTreeInteraction -> nearbyHarvestTree) is a mesh
// whose whole parent chain is visible, with scale ~ its base scale (<= 1.1x, the nearby pulse) and every material opacity 1, in a sweep over all trees x
// 2 distances x 4 sides x 4 camera azimuths, after the real occlusion pass; chop -> falling -> regrow keeps the tree visible and growing, it is a target
// again only when grown, and a retired tree is never a target.
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';
import fs from 'node:fs';

const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const J = JSON.stringify;

// Poses: every grown tree, player 1.2 m / 2.4 m away on 4 sides, camera rotated to 4 azimuths around the player. Returns the numbers.
const SWEEP = () => {
  const chain = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  const base = camera.position.clone().sub(new THREE.Vector3(player.position.x, 0, player.position.z));
  const saved = player.position.clone();
  const res = { poses: 0, targets: 0, trees: sourceTrees.length, bad: [], neverTarget: 0, hiddenByCamera: 0, minRatio: 9, maxRatio: 0, opacityBad: 0, noMesh: 0 };
  const targeted = new Set();
  const retiredNow = (t) => !!(t.mesh.userData.v84HiddenRoadConflict || t.mesh.userData.v93RoadClearance || t.mesh.userData.v161SawmillClearance);
  for (const az of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const c = Math.cos(az), s = Math.sin(az), ox = base.x * c - base.z * s, oz = base.x * s + base.z * c;
    for (const t of sourceTrees) {
      if (t.state !== 'grown') continue;
      for (const d of [1.2, 2.4]) for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + 0.4;
        player.position.set(t.mesh.position.x + Math.cos(a) * d, 0, t.mesh.position.z + Math.sin(a) * d);
        camera.position.set(player.position.x + ox, base.y, player.position.z + oz);
        camEyeTarget.set(player.position.x, PLAYER_EYE_HEIGHT, player.position.z);
        camera.updateMatrixWorld(true);
        res.poses++;
        updateTreeInteraction();
        const tg = nearbyHarvestTree;
        if (!tg) continue;
        updateCameraFoliageOcclusion(); // the real occlusion pass for this camera pose
        res.targets++; targeted.add(tg);
        const m = tg.mesh;
        const ratio = m.scale.x / tg.baseScale;
        res.minRatio = Math.min(res.minRatio, ratio); res.maxRatio = Math.max(res.maxRatio, ratio);
        let meshes = 0, opBad = 0;
        m.traverse((o) => { if (!o.isMesh) return; meshes++; const mats = Array.isArray(o.material) ? o.material : [o.material]; for (const mt of mats) if (mt && (mt.opacity !== 1 || mt.visible === false)) opBad++; });
        if (!meshes) res.noMesh++;
        res.opacityBad += opBad;
        if (!chain(m) || hiddenCameraFoliage.includes(m)) { res.hiddenByCamera++; if (res.bad.length < 5) res.bad.push({ x: +m.position.x.toFixed(1), z: +m.position.z.toFixed(1), az, d, k, vis: m.visible, retired: retiredNow(tg) }); }
        else if (ratio < 0.9 || ratio > 1.1 || opBad || !meshes || retiredNow(tg)) { if (res.bad.length < 5) res.bad.push({ ratio, opBad, meshes, retired: retiredNow(tg) }); }
      }
    }
  }
  res.neverTarget = sourceTrees.filter((t) => t.state === 'grown' && !targeted.has(t)).length;
  res.neverTargetRetired = sourceTrees.filter((t) => t.state === 'grown' && !targeted.has(t) && (retiredNow(t) || t.mesh.visible === false)).length;
  player.position.copy(saved);
  updateCameraFoliageOcclusion();
  return res;
};

async function run(label, save) {
  const g = await openGame({ save, waitMs: 6000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  console.log(`---- ${label}`);
  const boot = await ev(() => ({ stage: stageIndex, trees: sourceTrees.length, grown: sourceTrees.filter((t) => t.state === 'grown').length,
    retired: sourceTrees.filter((t) => t.mesh.userData.v84HiddenRoadConflict || t.mesh.userData.v93RoadClearance || t.mesh.userData.v161SawmillClearance).length,
    hiddenGrown: sourceTrees.filter((t) => t.state === 'grown' && t.mesh.visible === false).length }));
  console.log(`  boot ${J(boot)}`);
  check(boot.trees >= 40, `${label}: ${boot.trees} choppable trees registered, ${boot.grown} grown, ${boot.retired} retired by a layout layer`);

  // ---- 1. sweep: every chop target is drawn (fresh state)
  const sw = await ev(SWEEP);
  console.log(`  sweep ${J({ ...sw, bad: undefined })}`);
  check(sw.targets > 300, `${label}: ${sw.targets} of ${sw.poses} poses offer a chop target`);
  check(sw.hiddenByCamera === 0, `${label}: the chop target is never hidden by the camera-occlusion pass or by anything else (${sw.hiddenByCamera}/${sw.targets}) ${J(sw.bad)}`);
  check(sw.minRatio >= 0.9 && sw.maxRatio <= 1.1 && sw.opacityBad === 0 && sw.noMesh === 0, `${label}: every target has scale ${sw.minRatio.toFixed(3)}..${sw.maxRatio.toFixed(3)} x base, all materials opacity 1 and visible, mesh children present`);
  check(sw.neverTargetRetired === sw.neverTarget, `${label}: every tree that never became a target is retired/hidden (${sw.neverTarget} never targeted, ${sw.neverTargetRetired} of them retired or hidden)`);

  // ---- 2. a retired tree is not a chop target, not guidance, and stays hidden through the tutorial syncs and the camera pass
  const ret = await ev(() => {
    const pick = sourceTrees.filter((t) => t.state === 'grown' && t.mesh.visible !== false);
    const a = pick[0], b = pick[Math.floor(pick.length / 2)];
    const out = {};
    const stand = (t, d = 0.9) => { player.position.set(t.mesh.position.x + d, 0, t.mesh.position.z); updateTreeInteraction(); return nearbyHarvestTree === t; };
    out.beforeA = stand(a); out.beforeB = stand(b);
    // exactly what hideSceneryOnRoads (v84) and the sawmill tree guard (v161) do
    a.mesh.visible = false; a.mesh.userData.v84HiddenRoadConflict = true; a.mesh.userData.v93RoadClearance = true;
    b.mesh.visible = false; b.mesh.userData.v161SawmillClearance = true; b.mesh.userData.v93RoadClearance = true;
    out.afterA = stand(a); out.afterB = stand(b);
    window.__TYCOON_V61_AUDIT__?.refresh?.(); // v61 syncTutorialWorld61 (+ v62 sync) used to set visible = !v84 flag only
    camera.updateMatrixWorld(true); updateCameraFoliageOcclusion(); updateCameraFoliageOcclusion();
    out.stillHidden = [a.mesh.visible, b.mesh.visible];
    out.afterSyncA = stand(a); out.afterSyncB = stand(b);
    sawmillBuiltV118 = true; carriedLogs = 0;
    const g = currentGuidanceTarget(); out.guidanceLabel = g && g.label;
    // restore for the rest of the test
    for (const t of [a, b]) { t.mesh.visible = true; delete t.mesh.userData.v84HiddenRoadConflict; delete t.mesh.userData.v93RoadClearance; delete t.mesh.userData.v161SawmillClearance; }
    return out;
  });
  console.log(`  retired ${J(ret)}`);
  check(ret.beforeA && ret.beforeB, `${label}: a standing visible tree is a chop target (control)`);
  check(!ret.afterA && !ret.afterB, `${label}: road-retired and sawmill-retired trees are not chop targets`);
  check(ret.stillHidden[0] === false && ret.stillHidden[1] === false && !ret.afterSyncA && !ret.afterSyncB, `${label}: retired trees stay hidden through the tutorial sync and the camera pass (${J(ret.stillHidden)}) and stay non-targets`);

  // ---- 3. chop -> fall -> regrow: visible and growing the whole time, target again only when grown
  const chop = await ev(() => {
    const t = sourceTrees.find((x) => x.state === 'grown' && x.mesh.visible !== false);
    carriedLogs = 0; sawmillBuiltV118 = true;
    player.position.set(t.mesh.position.x + 1.0, 0, t.mesh.position.z);
    updateTreeInteraction();
    const wasTarget = nearbyHarvestTree === t;
    startChopping(t);
    const log = { wasTarget, states: [], scales: [], vis: [], target: [] };
    const chain = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
    const sampleOnce = () => { updateSawmill(0.1); updateTreeInteraction(); updateCameraFoliageOcclusion(); log.states.push(t.state); log.scales.push(+(t.mesh.scale.x / t.baseScale).toFixed(3)); log.vis.push(chain(t.mesh)); log.target.push(nearbyHarvestTree === t); };
    for (let i = 0; i < 12 && t.state !== 'regrowing'; i++) sampleOnce();
    log.reachedRegrow = t.state === 'regrowing';
    let guard = 0; while (t.state === 'regrowing' && guard++ < 80) sampleOnce();
    log.endState = t.state; log.endScale = +(t.mesh.scale.x / t.baseScale).toFixed(3); log.endRot = t.mesh.rotation.z;
    // at the end it is a chop target again, drawn, scale ~ 1
    for (let i = 0; i < 3; i++) sampleOnce();
    log.logs = carriedLogs;
    return log;
  });
  const regrowIdx = chop.states.indexOf('regrowing');
  const regrowScales = chop.scales.filter((_, i) => chop.states[i] === 'regrowing');
  const growing = regrowScales.every((v, i) => i === 0 || v >= regrowScales[i - 1] - 1e-6) && regrowScales[regrowScales.length - 1] > 0.9;
  console.log(`  chop ${J({ ...chop, scales: undefined, vis: undefined, target: undefined, states: undefined })} regrow scales ${J(regrowScales.filter((_, i) => i % 6 === 0))}`);
  check(chop.wasTarget && chop.reachedRegrow, `${label}: chopped tree was the target, fell, and entered regrow (${regrowIdx} samples before)`);
  check(chop.vis.every(Boolean), `${label}: the tree is visible (whole parent chain) in every sample of fall + regrow (${chop.vis.length} samples)`);
  check(growing, `${label}: regrow is monotone small -> full (first ${regrowScales[0]}, last ${regrowScales[regrowScales.length - 1]} x base)`);
  check(chop.target.every((tg, i) => !tg || chop.states[i] === 'grown'), `${label}: the tree is a chop target only while grown (never while falling or regrowing)`);
  check(chop.endState === 'grown' && Math.abs(chop.endScale - 1) < 0.1 && chop.endRot === 0 && chop.logs === 1, `${label}: regrown tree is grown again with scale ${chop.endScale} x base, upright, +1 log carried`);
  check(chop.target.slice(-3).every(Boolean) && chop.vis.slice(-3).every(Boolean), `${label}: and it is a drawn chop target again`);

  // ---- 4. after the chop: the sweep again (camera moves are part of the sweep: 4 azimuths)
  const sw2 = await ev(SWEEP);
  check(sw2.hiddenByCamera === 0 && sw2.minRatio >= 0.9 && sw2.maxRatio <= 1.1 && sw2.opacityBad === 0, `${label}: after the chop the sweep is still clean (${sw2.targets} targets, hidden ${sw2.hiddenByCamera}, ratio ${sw2.minRatio.toFixed(3)}..${sw2.maxRatio.toFixed(3)})`);

  // ---- 5. real prompt: standing at a tree shows the chop prompt and the tree is drawn
  const prompt = await ev(() => {
    sawmillBuiltV118 = true; carriedLogs = 0;
    const t = sourceTrees.find((x) => x.state === 'grown' && x.mesh.visible !== false);
    player.position.set(t.mesh.position.x + 1.0, 0, t.mesh.position.z);
    updateTreeInteraction();
    const p = document.getElementById('actionPrompt');
    const chain = (o) => { for (let q = o; q; q = q.parent) if (q.visible === false) return false; return true; };
    return { shown: !!p && p.classList.contains('show'), text: p ? p.textContent.trim().slice(0, 60) : '', target: nearbyHarvestTree === t, vis: chain(t.mesh), x: t.mesh.position.x, z: t.mesh.position.z };
  });
  console.log(`  prompt ${J(prompt)}`);
  check(prompt.target && prompt.vis, `${label}: the tree next to the player is the target and drawn (prompt shown: ${prompt.shown} "${prompt.text}")`);
  if (SHOTS && label.startsWith('A')) {
    await ev((p) => { player.position.set(p.x + 1.6, 0, p.z); }, prompt);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/tree-about-to-chop.png` });
  }
  check(g.errors.length === 0, `${label}: 0 console errors ${J(g.errors.slice(0, 3))}`);
  check(g.badResponses.length === 0, `${label}: 0 4xx ${J(g.badResponses.slice(0, 3))}`);
  await g.close();
}

await run('A fresh save', 'clear');
await run('B OLD_SAVE (stage 1, roads, retired trees)', OLD_SAVE);
