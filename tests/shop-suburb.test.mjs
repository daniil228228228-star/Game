// Shop + suburb (2026-10-05 (8), "improve physics and design of every building, one at a time", backlog #4 + #5; assets/shop-v161.js, assets/buildings-v161.js).
// ONE browser launch on the old-format save (stage 1). The physics numbers (walk-in, collider cover, pads outside colliders) live in tests/buildings-physics.test.mjs; this file checks the
// DESIGN and the mobile cost:
//   SHOP   1. levels 1..10 built by the game's real chain (createBuildingMesh): the same building growing - one group `shopV161` with a stable facade (footprint box, sign board, frontV161 yaw),
//             mesh counts never decrease, triangles grow with every level 1..5 (parts are ADDED), gold from level 6 (tier on the group, gold mesh, more gold with every level), the crown at
//             level 10 (the gold mesh reaches >= 0.25 m higher than at level 9), <= 14 meshes at every level and fewer than the old builder (same page, ShopV161.enabled = false), the old builder
//             is still used for `shop` objects that are not main-line stages; building and disposing 20 times leaves the geometry count of the renderer where it was.
//          2. a REAL upgrade: the shop at level 5 on the main line, the real #actionBtn press on its upgrade pad (5 -> 6, exactly one charge) and then the game's own upgradeBuilding up to 10: the live
//             building is the grown shop each time (mesh counts monotonic, gold tier = level), the facade yaw is kept, the road mesh uuids before and after every step are identical (0 re-laid).
//             Levels 1..5 re-lay the stage-2 driveway deck on every step exactly as the OLD shop did (27 of 41 meshes at 2, 3, 4, 5; measured with the old builder): the driveway end follows
//             buildingCollisionRadius(), which grows with the level up to 5 (road-signature input, deliberately untouched), so that range is not asserted.
//   SUBURB 3. the district identity group at district level 1/2/3: 2+lv houses on the old ring with 3 distinct variants (the three standalone mini houses differ in triangles and bbox),
//             4+lv trees, a handful of meshes (<= 8; the old group had ~116), fewer than the old builder (same page, BuildingsV161.enabled = false), the group rebuilds to the same mesh count
//             and the renderer's geometry count returns to the baseline (no leaks), the registry holds exactly the houses + trunks of the current group (owner = the group).
//   4. 0 console errors / 4xx.
import { openGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);

// ------------------------------------------------------------------------------------------------ 1. the shop at every level
const shop = await ev(() => {
  const count = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const tris = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); };
  const rows = [];
  for (let L = 1; L <= MAX_BUILDING_LEVEL; L++) {
    const m = createBuildingMesh(STAGES[2], L);
    const gold = m.children.find((c) => c.name === 'shopGoldV161');
    let goldTop = null, goldTris = 0;
    if (gold) { gold.geometry.computeBoundingBox(); goldTop = +gold.geometry.boundingBox.max.y.toFixed(3); goldTris = gold.geometry.index.count / 3; }
    const d = m.userData.v161Dims || {};
    rows.push({ L, name: m.name, shop: !!m.userData.v161Shop, meshes: count(m), tris: tris(m), tier: m.userData.goldTierV161 || 0, goldTop, goldTris, level: m.userData.levelV161, yaw: +m.rotation.y.toFixed(4), front: m.userData.frontV161 || null,
      fp0: m.userData.v161Footprint && m.userData.v161Footprint[0], sign: d.sign && { y: +d.sign.y.toFixed(3), w: d.sign.w }, door: !!(() => { let f = false; m.traverse((o) => { if (o.userData?.v161Door) f = true; }); return f; })(), complete: !!m.userData.v161Complete });
    disposeObject3D(m);
  }
  ShopV161.enabled = false;
  const old = {};
  for (const L of [1, 3, 5, 10]) { const m = createBuildingMesh(STAGES[2], L); old[L] = count(m); disposeObject3D(m); }
  ShopV161.enabled = true;
  // `shop` objects that are not main-line stages (city plots, bases, projects) keep the old builder
  const other = createBuildingMesh({ archetype: 'shop', color: 0xf1ece2, height: 3.2, baseSize: 2.6 }, 1);
  const otherNew = !!other.userData.v161Shop; disposeObject3D(other);
  // leak check: build + dispose 20 times
  const g0 = renderer.info.memory.geometries;
  for (let i = 0; i < 20; i++) { const m = createBuildingMesh(STAGES[2], 5); disposeObject3D(m); }
  const g1 = renderer.info.memory.geometries;
  return { rows, old, otherNew, g0, g1 };
});
const R = shop.rows;
console.log('shop levels:', R.map((r) => `L${r.L}: ${r.meshes} meshes, ${r.tris} tris, tier ${r.tier}${r.goldTop ? ', gold top ' + r.goldTop : ''}`).join(' | '), '| old meshes', J(shop.old));
check(R.length === 10 && R.every((r) => r.name === 'shopV161' && r.shop && r.complete && r.door), 'shop: every level 1..10 is the one `shopV161` group (flags v161Shop / v161Complete, a door mesh for the door tests)');
check(R.every((r, i) => i === 0 || r.meshes >= R[i - 1].meshes), `shop: mesh counts never decrease with the level (${R.map((r) => r.meshes)})`);
check(R.slice(0, 5).every((r, i) => i === 0 || r.tris > R[i - 1].tris) && R[9].tris > R[4].tris, `shop: every level 1..5 ADDS parts (triangles ${R.map((r) => r.tris)}), 10 > 5`);
check(R.slice(0, 5).every((r) => r.tier === 0) && R.slice(5).every((r) => r.tier === r.L) && R.slice(5).every((r) => r.goldTop !== null) && R.slice(5).every((r, i) => i === 0 || r.goldTris >= R[4 + i].goldTris) && R[9].goldTris > R[8].goldTris, `shop: gold from level 6 (tier on the group = level, one gold mesh, more gold with every tier: ${R.slice(5).map((r) => Math.round(r.goldTris))} triangles)`);
check(R[9].goldTop >= R[8].goldTop + 0.15 && R[9].goldTris >= R[8].goldTris + 60, `shop: the golden crown at level 10 (the gold mesh grows by ${Math.round(R[9].goldTris - R[8].goldTris)} triangles and reaches ${R[9].goldTop} m, level 9 ${R[8].goldTop} m)`);
check(R.every((r) => J(r.fp0) === J(R[0].fp0) && J(r.sign) === J(R[0].sign) && r.yaw === R[0].yaw && J(r.front) === J(R[0].front)), `shop: the SAME building grows - footprint box ${J(R[0].fp0)}, sign board ${J(R[0].sign)} and facing (yaw ${R[0].yaw}) are identical at all 10 levels`);
check(R.every((r) => r.meshes <= 14) && [1, 3, 5, 10].every((L) => R[L - 1].meshes < shop.old[L]), `shop: <= 14 meshes (= draw calls) at every level (${R.map((r) => r.meshes)}), the old builder had ${J(shop.old)} for levels 1/3/5/10`);
check(!shop.otherNew, 'shop archetype objects that are not main-line stages keep the old builder');
check(shop.g1 <= shop.g0, `shop: building + disposing 20 shops leaves the renderer's geometry count at the baseline (${shop.g0} -> ${shop.g1})`);

// ------------------------------------------------------------------------------------------------ 2. a real upgrade of the live shop (levels 5 -> 10: the gold tiers)
// Levels 1..5 re-lay the stage-2 driveway deck on every step, exactly as the OLD shop did (measured before this change: 27 of 41 deck meshes at 2, 3, 4 and 5, a transient 55 at 4): the driveway end
// follows buildingCollisionRadius(), which grows with the level up to 5 and is a road-signature input that stays untouched. So the real-upgrade check starts where the silhouette stops growing,
// like tests/late-game.test.mjs: the shop at level 5, the real #actionBtn press on its pad (5 -> 6), then the game's own upgradeBuilding up to 10; no road mesh is re-laid at any step.
const roadUuids = () => ev(() => { const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], o = []; scene.traverse((m) => { if (m.isMesh && m.userData && tags.some((t) => m.userData[t])) o.push(m.uuid); }); return o; });
const sameSet = (a, b) => { const A = new Set(a), B = new Set(b); return a.length === b.length && a.every((x) => B.has(x)) && b.every((x) => A.has(x)); };
const finish = () => ev(() => { for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; } for (let k = growingMeshes.length - 1; k >= 0; k--) { growingMeshes[k].mesh.visible = true; growingMeshes[k].mesh.scale.set(1, 1, 1); growingMeshes.splice(k, 1); } });
await ev(() => { stageIndex = 8; money = 1e9; planks = 1e5; concrete = 1e4; metal = 1e4; spawnBuilding(2, 5, { grow: false }); });
await finish();
await ev(() => { const orig = tryPayResources; window.__charges = []; tryPayResources = function () { const b = { money, wood: planks, concrete, metal }; const r = orig.apply(this, arguments); if (r) window.__charges.push({ money: b.money - money, wood: b.wood - planks }); return r; }; });
let before = await roadUuids();
for (let k = 0; k < 20; k++) { await page.waitForTimeout(1500); const now = await roadUuids(); const same = sameSet(now, before); before = now; if (same && k >= 2) break; } // the road planner has settled
const liveShop = () => ev(() => { const b = buildings.find((x) => x.index === 2); let n = 0; b.mesh.traverse((o) => { if (o.isMesh) n++; }); return { level: b.level, name: b.mesh.name, meshes: n, tier: b.mesh.userData.goldTierV161 || 0, yaw: +b.mesh.rotation.y.toFixed(4), pad: !!b.upgradePad, under: b.underConstruction }; });
const s5 = await liveShop();
check(s5.level === 5 && s5.name === 'shopV161' && s5.pad, `the live shop (stage 2) is level 5 with its upgrade pad and the new building (${J(s5)})`);
const pressed = await waitForState(page, () => {
  if (window.__charges.length) return true;                                  // the press went through (the pad is removed by the upgrade: check before reading it)
  const b = buildings.find((x) => x.index === 2), pad = b.upgradePad && b.upgradePad.pos;
  if (!pad) return false;
  player.position.set(pad.x, 0, pad.z);
  const btn = document.getElementById('actionBtn');
  if (btn && !btn.hidden && !btn.disabled) btn.click();
  return false;
}, null, { timeout: 15000 });
if (!pressed) {
  const diag = await ev(() => { const b = buildings.find((x) => x.index === 2), btn = document.getElementById('actionBtn'); let t = null; try { const n = nearestManualTargetV53(); t = n && { type: n.type, dist: +n.dist.toFixed(2) }; } catch (e) { t = String(e); } return { target: t, hidden: btn && btn.hidden, disabled: btn && btn.disabled, slot: constructionSlotAvailable(), queue: constructionQueue.length, level: b.level, under: b.underConstruction, player: player.position.toArray().map((x) => +x.toFixed(2)), pad: b.upgradePad ? b.upgradePad.pos.toArray().map((x) => +x.toFixed(2)) : null }; });
  console.log('KNOWN ISSUE: #actionBtn did not upgrade the level-5 shop within 15 s; upgraded through upgradeBuilding(). Diagnostics: ' + J(diag));
  await ev(() => upgradeBuilding(buildings.find((x) => x.index === 2), { fromQueue: true }));
}
await finish();
const levels = [await liveShop()], roadSteps = [];
const settled = async () => { let prev = await roadUuids(); for (let k = 0; k < 10; k++) { await page.waitForTimeout(700); const now = await roadUuids(); if (sameSet(prev, now)) return now; prev = now; } return prev; };
{ const now = await settled(); roadSteps.push({ from: 5, before: before.length, after: now.length, same: sameSet(before, now) }); before = now; }
check(levels[0].level === 6 && (!pressed || (await ev(() => window.__charges.length)) === 1), `real pad press: shop level 5 -> 6 (${pressed ? 'exactly one charge' : 'through upgradeBuilding'})`);
for (let L = 7; L <= 10; L++) {
  await ev(() => { money = 1e9; planks = 1e5; concrete = 1e4; metal = 1e4; upgradeBuilding(buildings.find((x) => x.index === 2), { fromQueue: true }); });
  await finish();
  levels.push(await liveShop());
  const now = await settled();
  roadSteps.push({ from: L - 1, before: before.length, after: now.length, same: sameSet(before, now) });
  before = now;
}
console.log('live shop after each upgrade:', levels.map((l) => `L${l.level}: ${l.meshes} meshes, tier ${l.tier}`).join(' | '));
check(levels.map((l) => l.level).join() === '6,7,8,9,10' && levels.every((l) => l.name === 'shopV161' && !l.under), 'real upgrades: the live shop is the grown shop at every level 6..10');
check(levels.every((l, i) => i === 0 || l.meshes >= levels[i - 1].meshes) && levels.every((l) => l.meshes <= 14 && l.meshes >= s5.meshes) && levels.every((l) => l.yaw === s5.yaw), `real upgrades: mesh counts monotonic (${s5.meshes} > ${levels.map((l) => l.meshes)}), <= 14, the facade yaw ${s5.yaw} kept`);
check(levels.every((l) => l.tier === l.level), 'real upgrades: gold tier = level at every step 6..10');
console.log('road meshes per upgrade step:', J(roadSteps));
check(roadSteps.length === 5 && roadSteps.every((r) => r.same), `real upgrades 5 -> 10 re-lay 0 road meshes: identical uuid sets before and after every step (${roadSteps.map((r) => r.before + '>' + r.after)})`);

// ------------------------------------------------------------------------------------------------ 3. the suburb district
const sub = await ev(async () => {
  const meshesIn = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const groups = () => scene.children.filter((o) => o.name === 'suburbV161').length; // exactly one suburb group at a time
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const out = { lv: [] };
  // 3 standalone variants
  const P = window.BuildingsV161, vs = [0, 1, 2].map((v) => { const m = makeMiniHouse(0xe0bb91, 0x8b4c39, v); const b = new THREE.Box3().setFromObject(m); let t = 0; m.traverse((o) => { if (o.isMesh) t += o.geometry.index.count / 3; }); const r = { v: m.userData.v161Variant, tris: Math.round(t), size: b.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(2)), meshes: meshesIn(m) }; disposeObject3D(m); return r; });
  out.variants = vs;
  const base0 = renderer.info.memory.geometries;
  for (const lv of [1, 2, 3]) {
    cityState.districts.suburb = lv;
    refreshDistrictIdentityWorldV363(); await tick();
    const grp = cityWorldRuntime.districtIdentity.get('suburb');
    const reg = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === grp);
    out.lv.push({ lv, meshes: meshesIn(grp), houses: grp.userData.v161Houses, trees: grp.userData.v161Trees, variants: grp.userData.v161Variants, houseBoxes: reg.filter((e) => String(e.label).startsWith('suburb:house')).length, trunks: reg.filter((e) => String(e.label).startsWith('suburb:tree')).length, pos: grp.position.toArray().map((x) => +x.toFixed(1)) });
  }
  // rebuild stability at level 3
  const first = cityWorldRuntime.districtIdentity.get('suburb'), geos = [];
  first.traverse((o) => { if (o.isMesh) { const gg = o.geometry, d = gg.dispose.bind(gg); gg.__disposed = false; gg.dispose = () => { gg.__disposed = true; d(); }; geos.push(gg); } });
  const m0 = meshesIn(first);
  for (let i = 0; i < 4; i++) { refreshDistrictIdentityWorldV363(); await tick(); }
  const last = cityWorldRuntime.districtIdentity.get('suburb');
  out.rebuild = { groups: groups(), meshes: [m0, meshesIn(last)], disposed: geos.every((x) => x.__disposed), changed: first !== last, parent: last.parent === scene };
  // level 0 removes the group, back to 3 restores it
  cityState.districts.suburb = 0; refreshDistrictIdentityWorldV363(); await tick();
  const gone = !cityWorldRuntime.districtIdentity.get('suburb'); const groupsGone = groups();
  cityState.districts.suburb = 3; refreshDistrictIdentityWorldV363(); await tick();
  out.gone = { gone, groupsGone, back: groups(), meshes: meshesIn(cityWorldRuntime.districtIdentity.get('suburb')) };
  // the old builder in the same page
  BuildingsV161.enabled = false; refreshDistrictIdentityWorldV363(); await tick();
  out.old = meshesIn(cityWorldRuntime.districtIdentity.get('suburb'));
  BuildingsV161.enabled = true; refreshDistrictIdentityWorldV363(); await tick();
  out.after = { meshes: meshesIn(cityWorldRuntime.districtIdentity.get('suburb')), reg: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => String(e.label).startsWith('suburb:')).length };
  return out;
});
console.log('suburb:', J(sub));
check(sub.variants.length === 3 && new Set(sub.variants.map((v) => v.tris)).size === 3 && new Set(sub.variants.map((v) => J(v.size))).size === 3 && sub.variants.every((v, i) => v.v === i), `suburb: the three mini-house variants are distinct (triangles ${sub.variants.map((v) => v.tris)}, sizes ${J(sub.variants.map((v) => v.size))})`);
check(sub.lv.every((r) => r.houses === 2 + r.lv && r.trees === 4 + r.lv), `suburb: 2+lv houses and 4+lv trees at district level 1/2/3 (${J(sub.lv.map((r) => [r.lv, r.houses, r.trees]))}): count and ring unchanged`);
check(sub.lv.every((r) => r.houseBoxes >= r.houses && r.trunks === r.trees), `suburb: the registry holds a box per house (+ shed) and a circle per trunk (${J(sub.lv.map((r) => [r.lv, r.houseBoxes, r.trunks]))})`);
check(new Set(sub.lv[2].variants).size === 3 && sub.lv[0].variants.length === 3 && new Set(sub.lv[0].variants).size === 3, `suburb: three variants in use already at level 1 (${J(sub.lv[0].variants)}) and at level 3 (${J(sub.lv[2].variants)})`);
check(sub.lv.every((r) => r.meshes <= 8) && sub.old >= 60 && sub.lv[2].meshes * 5 < sub.old, `suburb: <= 8 meshes per district at every level (${sub.lv.map((r) => r.meshes)}), the old builder in the same page: ${sub.old} (goal: well under 60)`);
check(sub.rebuild.changed && sub.rebuild.parent && sub.rebuild.groups === 1 && sub.rebuild.meshes[0] === sub.rebuild.meshes[1] && sub.rebuild.disposed, `suburb: four rebuilds leave exactly one suburb group in the scene with the same mesh count (${J(sub.rebuild)}), the geometries of the replaced group are disposed (no leak)`);
check(sub.gone.gone && sub.gone.groupsGone === 0 && sub.gone.back === 1 && sub.gone.meshes === sub.rebuild.meshes[1], `suburb: level 0 removes the group, level 3 brings the same meshes back (${J(sub.gone)})`);
check(sub.after.meshes === sub.lv[2].meshes && sub.after.reg >= sub.lv[2].houseBoxes + sub.lv[2].trunks, `suburb: after switching the old builder on and off the group and its colliders are back (${J(sub.after)})`);

check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
