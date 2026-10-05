// Sawmill v2 + pad-beam/label fix + tree keep-out, CHANGELOG_V161.md "2026-10-04 (8)". ONE browser launch on OLD_SAVE (stage 1, every industrial flag built).
//   A. beams vs plates: the vertical beams above ground pads / construction sites / the guide marker / the manual-destination beacon must not cut the dark name
//      plates. Scene-graph assertions on the REAL objects (transparent, depthWrite false, sort key below the plate's), plus a before/after image of a plate with the
//      beam on its axis (SHOTS_DIR=<dir> writes sawmill-v2-labelbeam-{before,after}.jpg; "before" restores the old depthWrite/renderOrder on the same objects).
//   B. one building: a single v161SawmillMill group; plank belt inside the roofed footprint; log belt ends at the dock under the roof; collider/drop-off/pads at their
//      places and clear of the hall; hall blocks the player (oriented box in the collision registry); no overlap with fleet yard / concrete / metal / generator camp;
//      level 1/2/3 rebuild with <= 26 meshes; road meshes keep their uuids when the production level changes.
//   C. live cycle: phase = sawmillAutoTimer / sawmillAutoInterval(); the carriage moves one way through the saw, the log shrinks into the credited number of boards (1 at prestige 0, see tests/world-consistency.test.mjs) that ride the belt to the
//      stack, the carriage returns fast, the hoist lifts the next log; sawdust <= 12 live points; blade spins; smoke only while producing; no leak over 3 cycles
//      (scene child count, geometries and textures return to baseline); idle (stage 0, no logs) pauses; the real animate loop advances the cycle.
//   D. trees: no choppable or decorative tree within the keep-out margin of the footprint, also after chop + regrow and after a new tree is dropped next to the mill.
//   E. 0 console errors, 0 4xx.
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;
const near = (a, b, e) => Math.abs(a - b) <= e;

// ------------------------------------------------------------------------------------------------ boot facts (old save)
const boot = await ev(() => ({
  built: sawmillBuiltV118, level: industrialLevelV161('sawmill'), mill: !!scene.getObjectByName('v161SawmillMill'), stage: stageIndex,
  millRoots: scene.children.filter((o) => o.name === 'v161SawmillMill').length,
}));
check(boot.built && boot.mill && boot.level === 1 && boot.millRoots === 1, `old save: sawmill built, level 1, exactly one mill group ${J(boot)}`);

// ================================================================================================ A. beams vs plates
await ev(() => { money = 1e9; planks = 99999; concrete = 99999; metal = 99999; purchaseCurrentPad(); });
const siteReady = await page.waitForFunction(() => constructionSites.length > 0 && currentPad, null, { timeout: 30000, polling: 250 }).then(() => true).catch(() => false);
check(siteReady, 'a construction site and the next ground pad exist');
const beamInfo = await ev(() => {
  const sortKey = (o) => { let go = 0, p = o; const chain = []; while (p) { chain.unshift(p); p = p.parent; } for (const n of chain) if (n.isGroup) go = n.renderOrder; return [go, o.renderOrder]; };
  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const out = [];
  const add = (name, beam, label) => {
    const m = beam.material, bk = sortKey(beam), lk = sortKey(label);
    out.push({ name, transparent: m.transparent, depthWrite: m.depthWrite, depthTest: m.depthTest, beamKey: bk, labelKey: lk, labelDepthTest: label.material.depthTest, before: less(bk, lk) });
  };
  const site = constructionSites[constructionSites.length - 1];
  add('construction-site beacon vs phase plate', site.beacon, site.phaseLabel);
  add('stage pad beacon vs pad plate', currentPad.beacon, currentPad.sprite);
  ensureGuideWorldMarker(); guideWorld.group.visible = true;
  add('guide column vs TARGET plate', guideWorld.column, guideWorld.label);
  const dest = scene.getObjectByName('manualDestinationV142');
  const r = { v142: !!dest };
  if (dest) for (const c of dest.children) if (c.isMesh) add('v142 ' + c.geometry.type + ' vs pad plate', c, currentPad.sprite);
  return { out, r };
});
for (const b of beamInfo.out) {
  check(b.transparent && b.depthWrite === false && b.before && b.labelDepthTest === true, `${b.name}: transparent, depthWrite=false, drawn before the plate (beam ${J(b.beamKey)} < plate ${J(b.labelKey)}), plate depthTest on`);
}
check(beamInfo.r.v142 && beamInfo.out.some((b) => b.name.startsWith('v142')), 'the manual-destination beacon (v142) exists and was checked');
// before/after image: camera at the plate of the construction site, beam on the plate axis
const imgs = await ev(() => {
  const site = constructionSites[constructionSites.length - 1], label = site.phaseLabel, beam = site.beacon;
  label.visible = true; label.material.opacity = 1; site.group.visible = true;
  scene.updateMatrixWorld(true);
  const lp = label.getWorldPosition(new THREE.Vector3());
  const prev = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
  camera.position.set(lp.x + 0.6, lp.y + 0.05, lp.z + 3.0); camera.lookAt(lp); camera.updateMatrixWorld(true);
  const render = () => { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.9); };
  const W = renderer.domElement.width, H = renderer.domElement.height, gl = renderer.getContext();
  const grab = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
  const after = render(); const fa = grab();
  // old state: depth written by the beam, drawn before the plate by renderOrder 0 < 10 as well
  const keep = { dw: beam.material.depthWrite, ro: beam.renderOrder }; beam.material.depthWrite = true; beam.renderOrder = 0; beam.material.needsUpdate = true;
  const before = render(); const fb = grab();
  beam.material.depthWrite = keep.dw; beam.renderOrder = keep.ro; beam.material.needsUpdate = true;
  camera.position.copy(prev.pos); camera.quaternion.copy(prev.quat);
  let diff = 0, n = 0;
  for (let i = 0; i < fa.length; i += 4) { const d = Math.abs(fa[i] - fb[i]) + Math.abs(fa[i + 1] - fb[i + 1]) + Math.abs(fa[i + 2] - fb[i + 2]); if (d > 24) diff++; n++; }
  return { after, before, differingPixels: diff, total: n };
});
if (SHOTS) {
  for (const k of ['before', 'after']) fs.writeFileSync(path.join(SHOTS, `sawmill-v2-labelbeam-${k}.jpg`), Buffer.from(imgs[k].split(',')[1], 'base64'));
}
check(imgs.differingPixels > 40, `the old (depth-writing) beam visibly changes pixels of the plate, the fixed one does not: ${imgs.differingPixels} of ${imgs.total} pixels differ (report: before/after images)`);

// ================================================================================================ B. one building
const B = await ev(() => {
  scene.updateMatrixWorld(true);
  const m = sawmillMillV161, lay = m.userData.layout, P = m.userData.parts;
  const names = {}; m.traverse((o) => { if (o.isMesh || o.isPoints) names[o.name] = (names[o.name] || 0) + 1; });
  const gb = (o) => { o.geometry.computeBoundingBox(); return o.geometry.boundingBox; };
  const belt = gb(P.belt), roof = gb(P.roof);
  const dock = conveyorData.end.clone(); m.worldToLocal(dock);
  const startDock = SAWMILL_BELT_END_V161.clone(); m.worldToLocal(startDock);
  const toLocal = (v) => { const w = v.clone(); m.worldToLocal(w); return [+w.x.toFixed(2), +w.z.toFixed(2)]; };
  const sc = STATIC_COLLIDERS.find((c) => c.pos.distanceTo(SAWMILL_POS) < 1e-6);
  const up = industrialStepV118('sawmill2').pos, up3 = (typeof industrialStepV118('sawmill3') === 'object' && industrialStepV118('sawmill3')) ? industrialStepV118('sawmill3').pos : null;
  const obb = sawmillObstaclesV161();
  // player pushed out of the hall: a point inside the west part (outside the old circle)
  const inside = m.localToWorld(new THREE.Vector3(-2.3, 0, 1.8));
  const solved = resolvePlayerCircleCollisions(inside.x, inside.z);
  const insideBay = m.localToWorld(new THREE.Vector3(1.0, 0, 0.8)); // centre of the open log bay (the player circle 0.4 m must clear the carriage rail strip)
  const solved2 = resolvePlayerCircleCollisions(insideBay.x, insideBay.z);
  const insideMach = m.localToWorld(new THREE.Vector3(0.5, 0, -0.9)), solved3 = resolvePlayerCircleCollisions(insideMach.x, insideMach.z); // the log pile / saw machinery block
  return {
    top: scene.children.filter((o) => /sawmill/i.test(o.name || '') && o.name !== 'v161SawmillMill').map((o) => o.name),
    names, meshes: Object.values(names).reduce((a, b) => a + b, 0),
    belt: { min: [belt.min.x, belt.min.z], max: [belt.max.x, belt.max.z], y: belt.max.y }, roof: { min: [roof.min.x, roof.min.z], max: [roof.max.x, roof.max.z] },
    layout: { zf: lay.zf, zb: lay.zb, leanZ1: lay.leanZ1, x0: lay.x0, x1: lay.x1 },
    logBeltEndLocal: toLocal(conveyorData.end), dockLocal: toLocal(SAWMILL_BELT_END_V161),
    collider: sc ? sc.radius : null, dropoff: [SAWMILL_DROPOFF_POS.x - SAWMILL_POS.x, SAWMILL_DROPOFF_POS.z - SAWMILL_POS.z],
    upPad: [up.x - SAWMILL_POS.x, up.z - SAWMILL_POS.z], up3: up3 && toLocal(up3),
    obb: obb.map((o) => ({ l: o.label, hx: o.hx, hz: o.hz })),
    pushedHall: solved.hit && Math.hypot(solved.x - inside.x, solved.z - inside.z) > 0.2, pushedBay: solved2.hit, pushedMach: solved3.hit,
    nav: typeof nearestManualTargetV53,
  };
});
check(B.top.length === 0 && B.names.v161SawBelt === 1 && B.names.v161SawmillRoof === 1, `one building: a single group, no stray sawmill meshes in the scene (${J(B.top)})`);
check(B.belt.min[0] >= B.roof.min[0] && B.belt.max[0] <= B.roof.max[0] && B.belt.min[1] >= B.roof.min[1] && B.belt.max[1] <= B.roof.max[1],
  `plank conveyor ${J(B.belt.min.map((v) => +v.toFixed(2)))}..${J(B.belt.max.map((v) => +v.toFixed(2)))} lies inside the roofed footprint ${J(B.roof.min.map((v) => +v.toFixed(2)))}..${J(B.roof.max.map((v) => +v.toFixed(2)))} (hall roof + lean-to)`);
check(B.logBeltEndLocal[0] > B.layout.x0 && B.logBeltEndLocal[0] < B.layout.x1 && Math.abs(B.logBeltEndLocal[1]) < 0.8, `the game's log belt ends inside the hall under the roof (local ${J(B.logBeltEndLocal)}, hall x ${B.layout.x0}..${B.layout.x1})`);
check(B.collider === 2.15, `static collider unchanged: SAWMILL_POS r ${B.collider}`);
check(near(B.dropoff[0], 2.75, 1e-6) && near(B.dropoff[1], 1.7, 1e-6), `log drop-off point unchanged: SAWMILL_POS + ${J(B.dropoff)}`);
check(near(B.upPad[0], 0, 1e-6) && near(B.upPad[1], 4.4, 1e-6), `level-2 pad unchanged: SAWMILL_POS + ${J(B.upPad.map((v) => +v.toFixed(2)))}`);
// 2026-10-05 (6): the hall is solid where it is solid (walls, belt table, machinery block = real oriented boxes), the open log bay in the east gable stays walkable
check(B.obb.length >= 6 && B.pushedHall && B.pushedMach && !B.pushedBay, `the hall follows its real walls (${B.obb.length} oriented boxes ${J(B.obb.map((o) => o.l))}, pushed out of the west wall: ${B.pushedHall}, out of the machinery block: ${B.pushedMach}, the open log bay is walkable: ${!B.pushedBay})`);

// levels: mesh counts, draw calls (same camera), footprint vs neighbours, roads untouched
const roadUuids = () => ev(() => {
  const set = []; scene.traverse((o) => { if (!o.isMesh) return; for (let p = o.parent; p; p = p.parent) { if (p.name === 'v70RefinedServiceRoads' || p.name === 'v113UnifiedStarterRoadSurface' || p === cityWorldRuntime?.stageRoads) { set.push(o.uuid); break; } } });
  return set.sort();
});
const roads0 = await roadUuids();
const levels = {};
for (const lv of [1, 2, 3]) {
  levels[lv] = await ev((level) => {
    industrialLevelsV161.sawmill = level; refreshSawmillVisualsV161(); scene.updateMatrixWorld(true);
    const m = sawmillMillV161; let meshes = 0, tris = 0; m.traverse((o) => { if (o.isMesh || o.isPoints) meshes++; if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    camera.position.set(-51, 15, -7.7 + 11); camera.lookAt(-51, 0, -7.7); camera.updateMatrixWorld(true); renderer.render(scene, camera);
    const calls = renderer.info.render.calls;
    const lay = m.userData.layout, yaw = m.userData.yawV161, c = Math.cos(yaw), s = Math.sin(yaw);
    const rect = { x0: lay.x0 - 0.3, x1: lay.x1 + 0.4, z0: lay.zb - 0.4, z1: lay.leanZ1 + 0.3 };
    const hits = [];
    const hitsRect = (b) => {
      // SAT-lite: object AABB corners inside the rotated rect, rect corners inside the AABB, or the AABB centre inside
      const pts = [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.max.z], [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2]];
      for (const [x, z] of pts) { const dx = x - SAWMILL_POS.x, dz = z - SAWMILL_POS.z, lx = c * dx - s * dz, lz = s * dx + c * dz; if (lx > rect.x0 && lx < rect.x1 && lz > rect.z0 && lz < rect.z1) return true; }
      for (const [lx, lz] of [[rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x0, rect.z1], [rect.x1, rect.z1]]) { const wx = SAWMILL_POS.x + c * lx + s * lz, wz = SAWMILL_POS.z - s * lx + c * lz; if (wx > b.min.x && wx < b.max.x && wz > b.min.z && wz < b.max.z) return true; }
      return false;
    };
    const box = new THREE.Box3();
    const solids = [];
    const fleet = scene.getObjectByName('v116FleetYard'); if (fleet) solids.push(['fleet yard', fleet]);
    for (const o of scene.children) {
      if (!o.isGroup || o === m || o === fleet) continue;
      const p = o.position;
      for (const [nm, q, r] of [['concrete plant', CONCRETE_PLANT_POS, 3.5], ['metal yard', METAL_YARD_POS, 3.5], ['generator camp', GENERATOR_POS, 3.0]]) if (Math.hypot(p.x - q.x, p.z - q.z) < 0.01 && !o.userData?.harvestableTree) solids.push([nm, o]);
    }
    for (const [nm, o] of solids) { box.setFromObject(o); if (!box.isEmpty() && hitsRect(box)) hits.push(nm); }
    // trees: nearest tree to the keep-out footprint
    let nearestTree = Infinity; for (const o of scene.children) if (sawmillIsTreeV161(o) && o.visible !== false) nearestTree = Math.min(nearestTree, sawmillFootprintDistV161(o.position.x, o.position.z));
    const pad2 = industrialStepV118('sawmill2').pos, l2 = (() => { const dx = pad2.x - SAWMILL_POS.x, dz = pad2.z - SAWMILL_POS.z; return [c * dx - s * dz, s * dx + c * dz]; })();
    const pad3 = industrialStepV118('sawmill3'); const l3 = pad3 ? (() => { const dx = pad3.pos.x - SAWMILL_POS.x, dz = pad3.pos.z - SAWMILL_POS.z; return [c * dx - s * dz, s * dx + c * dz]; })() : null;
    // pads must stand >= 0.8 m (edge to roof edge, pad radius 0.73 incl.) away from the hall roof and from the lean-to roof
    const rectDist = (l, r) => Math.hypot(Math.max(r.x0 - l[0], 0, l[0] - r.x1), Math.max(r.z0 - l[1], 0, l[1] - r.z1));
    const hallR = { x0: lay.roof.x0, x1: lay.roof.x1, z0: lay.roof.z0, z1: lay.roof.z1 }, leanR = { x0: lay.leanX0 - 0.15, x1: lay.leanX1 + 0.15, z0: lay.zf, z1: lay.leanZ1 + 0.3 };
    const outside = (l) => !l || Math.min(rectDist(l, hallR), rectDist(l, leanR)) >= 0.8;
    return { level: m.userData.levelV161, meshes, tris: Math.round(tris), calls, hits, nearestTree: +nearestTree.toFixed(2), pad2Outside: outside(l2), pad3Outside: outside(l3), l2: l2.map((v) => +v.toFixed(2)), l3: l3 && l3.map((v) => +v.toFixed(2)) };
  }, lv);
  console.log(`LEVEL ${lv}:`, J(levels[lv]));
}
check([1, 2, 3].every((lv) => levels[lv].level === lv), 'level 1/2/3 rebuild the same building group');
check([1, 2, 3].every((lv) => levels[lv].meshes <= 26), `mesh count per level stays mobile-safe (${[1, 2, 3].map((lv) => levels[lv].meshes).join('/')} meshes, was 11/12/13; ${[1, 2, 3].map((lv) => levels[lv].tris).join('/')} triangles; ${[1, 2, 3].map((lv) => levels[lv].calls).join('/')} draw calls from the air view)`);
check([1, 2, 3].every((lv) => levels[lv].hits.length === 0), `footprint overlaps no fleet yard / concrete plant / metal yard / generator camp at any level ${J([1, 2, 3].map((lv) => levels[lv].hits))}`);
check([1, 2, 3].every((lv) => levels[lv].pad2Outside && levels[lv].pad3Outside), `level-2/3 pads stand outside the building footprint (pad 2 local ${J(levels[3].l2)}, pad 3 local ${J(levels[3].l3)})`);
await page.waitForTimeout(1800); // let the 700 ms refresh timers and the road planners run
const roads1 = await roadUuids();
check(roads0.length > 20 && J(roads0) === J(roads1), `road meshes keep their uuids across level 1 -> 3 (${roads0.length} before, ${roads1.length} after)`);
await ev(() => { industrialLevelsV161.sawmill = 1; refreshSawmillVisualsV161(); });

// ================================================================================================ C. live cycle
const C = await ev(() => {
  stageIndex = Math.max(1, stageIndex);
  const T = sawmillAutoInterval(), at = (p) => { sawmillAutoTimer = p * T; updateSawmillMillV161(0.016); return sawmillStateV161(); };
  const S = {};
  for (const p of [0.01, 0.1, 0.2, 0.3, 0.4, 0.5, 0.58, 0.61, 0.64, 0.68, 0.72, 0.78, 0.86, 0.95, 0.9999]) S[p] = at(p);
  // one-way carriage motion through the saw (strictly decreasing x during the cut), fast return
  const cut = []; for (let p = 0.04; p <= 0.59; p += 0.05) cut.push(at(p).carriageX);
  const mono = cut.every((x, i) => i === 0 || x < cut[i - 1] + 1e-9);
  let retStart = null, retEnd = null; for (let p = 0.55; p <= 0.8; p += 0.005) { const x = at(p).carriageX; if (retStart === null && p > 0.595) retStart = p; if (retEnd === null && p > 0.62 && x >= SAWMILL_L_V161.CX0 - 1e-6) retEnd = p; }
  return { T, S, mono, cut, returnSpan: retEnd - 0.6, cutSpan: 0.57 };
});
const s = C.S;
check(C.mono && s[0.5].carriageX < s[0.1].carriageX - 0.8, `carriage moves ONE way through the saw: x ${s[0.1].carriageX.toFixed(2)} -> ${s[0.5].carriageX.toFixed(2)} -> ${s[0.58].carriageX.toFixed(2)} (strictly decreasing over 12 samples)`);
check(C.returnSpan > 0 && C.returnSpan < C.cutSpan / 4, `return is fast: ${C.returnSpan.toFixed(3)} of the cycle vs ${C.cutSpan} for the cut`);
check(near(s[0.1].log.sx, 1, 1e-3) && s[0.3].log.sx < s[0.1].log.sx - 0.2 && s[0.5].log.sx < s[0.3].log.sx - 0.2 && s[0.58].log.sx < 0.1, `the log gets shorter as it is sawn: scale ${[0.1, 0.3, 0.5, 0.58].map((p) => s[p].log.sx.toFixed(2)).join(' -> ')}`);
check(!s[0.1].boards[0].visible && s[0.3].boards[0].visible && s[0.5].boards[0].sx > s[0.3].boards[0].sx + 0.3 && near(s[0.58].boards[0].sx, 1.47, 0.1) && s[0.3].boards.filter((b) => b.visible).length === 1, `one board (= the 1 plank a cut credits at prestige 0) appears on the belt and grows with the cut: length ${[0.3, 0.5, 0.58].map((p) => s[p].boards[0].sx.toFixed(2)).join(' -> ')}`);
check(s[0.78].boards[0].z > s[0.61].boards[0].z + 0.5 && s[0.9999].boards[0].z > 2.6, `boards ride the belt out through the outlet to the stack: z ${s[0.61].boards[0].z.toFixed(2)} -> ${s[0.78].boards[0].z.toFixed(2)} -> ${s[0.9999].boards[0].z.toFixed(2)} (stack from z 3.1)`);
check(s[0.64].log.visible && s[0.64].log.y < 1 && s[0.78].log.y > 1.4 && s[0.95].log.y < 1.2 && s[0.95].log.sx === 1 && near(s[0.95].carriageX, 0.95, 1e-6) && s[0.78].trolleyZ > s[0.64].trolleyZ, `the hoist fetches the next log from the pile (y ${s[0.64].log.y.toFixed(2)}), carries it over (y ${s[0.78].log.y.toFixed(2)}) and puts it on the waiting carriage (y ${s[0.95].log.y.toFixed(2)}, x ${s[0.95].log.x.toFixed(2)})`);
// blade, sawdust, smoke, pooling
const D = await ev(() => {
  stageIndex = Math.max(1, stageIndex);
  for (let i = 0; i < 4; i++) updateSmoke(1); // flush the game's own puffs (mobile cap 10) so the count below sees ours
  const T = sawmillAutoInterval(); let maxLive = 0, sawBlade = 0;
  const blade = sawmillMillV161.userData.blades[0].node, r0 = blade.rotation.z;
  const smokeBefore = smokePuffs.length;
  let spawnedSmoke = 0, prevSmoke = smokePuffs.length;
  for (let i = 0; i < 400; i++) { sawmillAutoTimer = (0.2 + 0.3 * i / 400) * T; updateSawmillMillV161(0.016); maxLive = Math.max(maxLive, sawmillStateV161().dustLive); if (smokePuffs.length > prevSmoke) spawnedSmoke++; prevSmoke = smokePuffs.length; }
  const spun = blade.rotation.z - r0;
  const midSpin = sawmillStateV161().spin;
  // idle: stage 0 and no logs in transit -> pauses (no pose change, blade coasts to a stop, no new smoke)
  const saveStage = stageIndex; stageIndex = 0; const pBefore = sawmillStateV161().p, smokeIdle0 = smokePuffs.length;
  for (let i = 0; i < 200; i++) { sawmillAutoTimer = 0.9 * T; updateSawmillMillV161(0.05); }
  const idle = sawmillStateV161(); const smokeIdle1 = smokePuffs.length; stageIndex = saveStage;
  return { maxLive, spun, midSpin, spawnedSmoke, idle: { running: idle.running, spin: idle.spin, pSame: Math.abs(idle.p - pBefore) < 1e-9, dust: idle.dustLive }, smokeIdleGrowth: smokeIdle1 - smokeIdle0, cap: sawmillStateV161().dustMax };
});
check(D.maxLive > 0 && D.maxLive <= D.cap && D.cap === 12, `sawdust: ${D.maxLive} live points at most (cap ${D.cap})`);
check(D.spun > 5 && D.midSpin > 2, `blade spins while sawing (${D.spun.toFixed(1)} rad over 400 frames, ${D.midSpin.toFixed(1)} rad/s)`);
check(D.spawnedSmoke >= 1, `chimney smoke while producing (${D.spawnedSmoke} puffs)`);
check(!D.idle.running && D.idle.pSame && D.idle.spin < 0.05 && D.idle.dust === 0 && D.smokeIdleGrowth <= 0, `idle (stage 0, no logs): the cycle pauses, blade stopped, no dust, no new smoke ${J(D.idle)}`);
// production speed is the game's real one: level 3 shortens the interval and the phase follows it
const sp = await ev(() => {
  stageIndex = Math.max(1, stageIndex);
  const T1 = sawmillAutoInterval(); industrialLevelsV161.sawmill = 3; refreshSawmillVisualsV161(); const T3 = sawmillAutoInterval();
  sawmillAutoTimer = 0.45 * T3; updateSawmillMillV161(0.016); const p3 = sawmillStateV161();
  industrialLevelsV161.sawmill = 1; refreshSawmillVisualsV161(); sawmillAutoTimer = 0.45 * T1; updateSawmillMillV161(0.016); const p1 = sawmillStateV161();
  return { T1, T3, p3: p3.p, p1: p1.p, same: Math.abs(p3.log.sx - p1.log.sx) < 1e-6 };
});
check(near(sp.T1 / sp.T3, 2, 1e-6) && near(sp.p3, 0.45, 1e-6) && near(sp.p1, 0.45, 1e-6) && sp.same, `cycle follows sawmillAutoInterval(): level 1 ${sp.T1.toFixed(2)} s, level 3 ${sp.T3.toFixed(2)} s (x2), same pose at 45 % of each`);
// no leak across 3 full cycles (timer-driven like the game does)
const leak = await ev(() => {
  stageIndex = Math.max(1, stageIndex);
  for (let i = 0; i < 5; i++) updateSmoke(1); // flush puffs of the checks above
  const base = { children: scene.children.length, geoms: renderer.info.memory.geometries, tex: renderer.info.memory.textures, mill: (() => { let n = 0; sawmillMillV161.traverse(() => n++); return n; })(), smoke: smokePuffs.length };
  const T = sawmillAutoInterval(); let maxLive = 0, peakChildren = 0;
  sawmillAutoTimer = 0;
  for (let cycle = 0; cycle < 3; cycle++) { for (let t = 0; t < T; t += 0.05) { sawmillAutoTimer = t; updateSawmillMillV161(0.05); updateSmoke(0.05); maxLive = Math.max(maxLive, sawmillStateV161().dustLive); peakChildren = Math.max(peakChildren, scene.children.length); } }
  for (let i = 0; i < 8; i++) updateSmoke(1);
  const end = { children: scene.children.length, geoms: renderer.info.memory.geometries, tex: renderer.info.memory.textures, mill: (() => { let n = 0; sawmillMillV161.traverse(() => n++); return n; })(), smoke: smokePuffs.length };
  return { base, end, maxLive, peakChildren };
});
check(leak.end.children === leak.base.children && leak.end.mill === leak.base.mill && leak.end.geoms <= leak.base.geoms + 1 && leak.end.tex <= leak.base.tex + 1 && leak.maxLive <= 12, `no leak over 3 cycles: scene children ${leak.base.children} -> ${leak.end.children} (peak ${leak.peakChildren}, smoke puffs), mill nodes ${leak.base.mill} -> ${leak.end.mill}, geometries ${leak.base.geoms} -> ${leak.end.geoms}, textures ${leak.base.tex} -> ${leak.end.tex}, dust <= ${leak.maxLive}`);
// the REAL animate loop advances the cycle
await ev(() => { stageIndex = Math.max(1, stageIndex); sawmillAutoTimer = 0.02; });
const p0 = await ev(() => sawmillStateV161().p);
const moved = await page.waitForFunction((q) => Math.abs(sawmillStateV161().p - q) > 0.01, p0, { timeout: 20000, polling: 'raf' }).then(() => true).catch(() => false);
check(moved, 'the real animate() loop advances the saw cycle (phase changed without any manual call)');

// ================================================================================================ D. trees
const trees = await ev(() => {
  const K = SAWMILL_KEEP_V161.margin;
  const all = () => { const d = []; for (const o of scene.children) if (sawmillIsTreeV161(o) && o.visible !== false) d.push(sawmillFootprintDistV161(o.position.x, o.position.z)); return d; };
  const src = () => sourceTrees.filter((t) => t.mesh.visible !== false).map((t) => sawmillFootprintDistV161(t.mesh.position.x, t.mesh.position.z));
  const out = { K, count: all().length, srcCount: src().length, minAll: Math.min(...all()), minSrc: Math.min(...src()) };
  // chop + regrow three trees through the game's own update
  for (const t of sourceTrees.slice(0, 3)) { t.state = 'chopping'; t.timer = 0; t.logSpawned = false; }
  for (let i = 0; i < 40; i++) updateSawmill(0.5);
  out.afterRegrow = Math.min(...src()); out.regrown = sourceTrees.slice(0, 3).every((t) => t.state === 'grown');
  // a harvestable tree and a decor tree appear right next to the mill, e.g. from a future layer
  const a = makeTree(), b = makeTree(); b.userData.harvestableTree = false; b.userData.foliageKindV154 = 'tree'; // b = a decorative tree
  a.position.set(SAWMILL_POS.x + 1.0, 0, SAWMILL_POS.z + 3.0); b.position.set(SAWMILL_POS.x - 3.0, 0, SAWMILL_POS.z - 1.0);
  scene.add(a, b); registerAllHarvestableTrees();
  const before = [sawmillFootprintDistV161(a.position.x, a.position.z), sawmillFootprintDistV161(b.position.x, b.position.z)];
  sawmillTreeGuardAtV161 = 0; refreshSawmillVisualsV161();
  const after = [sawmillFootprintDistV161(a.position.x, a.position.z), sawmillFootprintDistV161(b.position.x, b.position.z)];
  out.dropped = { before, after, moved: a.userData.v161MovedByMill && b.userData.v161MovedByMill, movedTo: [a.position.x.toFixed(1), a.position.z.toFixed(1)] };
  scene.remove(a, b); const i = sourceTrees.findIndex((t) => t.mesh === a); if (i >= 0) sourceTrees.splice(i, 1);
  // the generator camp ring (the log source) is untouched
  out.ring = sourceTrees.filter((t) => Math.hypot(t.mesh.position.x - GENERATOR_POS.x, t.mesh.position.z - GENERATOR_POS.z) < 4).length;
  return out;
});
check(trees.minAll >= trees.K - 0.05 && trees.minSrc >= trees.K - 0.05, `no tree (choppable ${trees.srcCount}, all scene trees ${trees.count}) closer than ${trees.K} m to the sawmill footprint: nearest ${trees.minAll.toFixed(2)} m`);
check(trees.regrown && trees.afterRegrow >= trees.K - 0.05, `after chop + regrow the choppable trees are still >= ${trees.K} m away (${trees.afterRegrow.toFixed(2)} m)`);
check(trees.dropped.before.every((d) => d < 2) && trees.dropped.after.every((d) => d >= trees.K - 0.05) && trees.dropped.moved, `trees dropped next to the mill (${trees.dropped.before.map((d) => d.toFixed(1)).join('/')} m) are moved out to the clearing edge (${trees.dropped.after.map((d) => d.toFixed(1)).join('/')} m)`);
check(trees.ring >= 5, `the generator camp tree ring is untouched (${trees.ring} trees)`);

// ================================================================================================ E. console
check(g.errors.length === 0, `no console errors (${g.errors.length}) ${J(g.errors.slice(0, 3))}`);
check(g.badResponses.length === 0, `no 4xx responses (${g.badResponses.length})`);
await g.close();
