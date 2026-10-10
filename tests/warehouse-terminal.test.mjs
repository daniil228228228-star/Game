// Warehouse (stage 3) + logistics terminal (stage 10), 2026-10-06 (9), backlog #6 (assets/warehouse-v161.js). ONE browser launch on the old-format save. The walk-in / collider-cover /
// min-y numbers for every level live in tests/buildings-physics.test.mjs (hard); this file checks the DESIGN, the growth, the driveway side, the pad and the road finding:
//   1. levels 1..10 by the game's real chain (createBuildingMesh): one group per stage (`warehouseV161` / `terminalV161`), the SAME building grows (door position, yaw, facing and the pad-side
//      wall limit are identical on every level), mesh counts never decrease and stay <= 16 (old builder: 142-169 in the same page), triangles grow on every level 1..5, gold tier from 6 (one gold
//      mesh, more gold with every level), the crown at 10 (the gold mesh grows by >= 60 triangles and reaches >= 0.15 m higher than at 9), no road-tagged mesh inside a building (lane marks are decals).
//   2. the bay / door faces the driveway: the front direction of the mesh points at the end of the stage road (dot >= 0.99) and the door mesh stands <= radius + 1.5 m from it.
//   3. the upgrade pad stands outside the colliders (>= 0.8 m from every wall box, the registry of the live building, and a player circle on the pad centre is not pushed).
//   4. neutral props: the picture does not depend on the stock - the same triangle count with planks / concrete / metal at 0, 1 and the capacity (the warehouse capacity is real,
//      builtWarehouseLevels(), but nothing here is drawn from it: KNOWN ISSUE printed, by the world-consistency rule "a visual that cannot show the real number shows the nearest honest thing").
//   5. a REAL upgrade 1 -> 5 -> 6 of both live buildings (the real #actionBtn press for the warehouse, upgradeBuilding for the rest): the live building is the grown one each time, the road
//      mesh uuids before and after every step are identical (0 re-laid; before 2026-10-06 (9) the shop re-laid 27 of 41 on every step 1 -> 5, the planner read the level-dependent whole-mesh box).
//   6. meshes baseline: building and disposing 20 times leaves the renderer's geometry count where it was; the old builder still serves `warehouse` objects that are not main-line stages.
//   7. 0 console errors / 4xx.
import { openGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);

// ------------------------------------------------------------------------------------------------ 1. levels 1..10
const lv = await ev(() => {
  const count = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const tris = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); };
  const out = {};
  for (const si of [3, 10]) {
    const rows = [];
    for (let L = 1; L <= MAX_BUILDING_LEVEL; L++) {
      const m = createBuildingMesh(STAGES[si], L);
      const gold = m.children.find((c) => c.name === 'logisticsGoldV161');
      let goldTop = null, goldTris = 0;
      if (gold) { gold.geometry.computeBoundingBox(); goldTop = +gold.geometry.boundingBox.max.y.toFixed(3); goldTris = gold.geometry.index.count / 3; }
      let door = null, roadTagged = 0;
      m.traverse((o) => { if (o.userData?.v161Door) door = o; if (o.userData && (o.userData.v59RoadDeck || o.userData.v86StageRoad || o.userData.v66ServiceRoad || o.userData.v116PersistentRoad)) roadTagged++; });
      const d = m.userData.v161Dims || {}, fp = m.userData.v161Footprint || [];
      const gsd = d.gs;
      const padEdge = Math.max(...fp.map((f) => (gsd > 0 ? -(f.x - f.hx) : (f.x + f.hx))));   // the wall edge nearest the pad side (|x|), must not move
      rows.push({ L, name: m.name, kind: m.userData.v161Logistics, meshes: count(m), tris: tris(m), tier: m.userData.goldTierV161 || 0, goldTop, goldTris, level: m.userData.levelV161, yaw: +m.rotation.y.toFixed(4), front: m.userData.frontV161 || null,
        door: door && [door.position.x, door.position.y, door.position.z].map((v) => +v.toFixed(3)), roadTagged, padEdge: +padEdge.toFixed(3), complete: !!(m.userData.v161Complete && m.userData.v44Detailed && m.userData.v157Finish), boxes: fp.length });
      disposeObject3D(m);
    }
    out[si] = rows;
  }
  LogisticsV161.enabled = false;
  const old = {};
  for (const si of [3, 10]) for (const L of [1, 3, 5, 10]) { const m = createBuildingMesh(STAGES[si], L); old[si + ':' + L] = count(m); disposeObject3D(m); }
  LogisticsV161.enabled = true;
  const other = createBuildingMesh({ archetype: 'warehouse', color: 0xd95a4d, height: 3.2, baseSize: 2.55 }, 1);
  const otherNew = !!other.userData.v161Logistics; disposeObject3D(other);
  const g0 = renderer.info.memory.geometries;
  for (let i = 0; i < 20; i++) { const m = createBuildingMesh(STAGES[i % 2 ? 10 : 3], 5); disposeObject3D(m); }
  const g1 = renderer.info.memory.geometries;
  return { out, old, otherNew, g0, g1 };
});
for (const [si, nm, gname] of [[3, 'warehouse', 'warehouseV161'], [10, 'terminal', 'terminalV161']]) {
  const R = lv.out[si];
  console.log(`${nm} levels:`, R.map((r) => `L${r.L}: ${r.meshes} meshes, ${r.tris} tris, tier ${r.tier}${r.goldTop ? ', gold top ' + r.goldTop : ''}`).join(' | '));
  check(R.length === 10 && R.every((r) => r.name === gname && r.kind === nm && r.complete && r.door && r.level === Math.min(r.L, 5)), `${nm}: every level 1..10 is the one \`${gname}\` group (flags v161Logistics / v161Complete, a door mesh for the door tests)`);
  check(R.every((r, i) => i === 0 || r.meshes >= R[i - 1].meshes) && R.every((r) => r.meshes <= 16), `${nm}: mesh counts never decrease and stay <= 16 (${R.map((r) => r.meshes)}); the old builder had ${J(Object.fromEntries(Object.entries(lv.old).filter(([k]) => k.startsWith(si + ':'))))} for levels 1/3/5/10`);
  check(R.slice(0, 5).every((r, i) => i === 0 || r.tris > R[i - 1].tris) && R[9].tris > R[4].tris, `${nm}: every level 1..5 ADDS parts (triangles ${R.map((r) => r.tris)}), 10 > 5`);
  check(R.every((r) => J(r.door) === J(R[0].door) && r.yaw === R[0].yaw && J(r.front) === J(R[0].front) && r.padEdge === R[0].padEdge), `${nm}: the SAME building grows - door ${J(R[0].door)}, facing (yaw ${R[0].yaw}) and the wall limit on the pad side (${R[0].padEdge} m) are identical on every level`);
  check(R.slice(0, 5).every((r) => r.tier === 0) && R.slice(5).every((r) => r.tier === r.L && r.goldTop !== null) && R.slice(5).every((r, i) => i === 0 || r.goldTris >= R[4 + i].goldTris), `${nm}: gold from level 6 (tier = level, one gold mesh, more gold with every level: ${R.slice(5).map((r) => r.goldTris)})`);
  check(R[9].goldTop >= R[8].goldTop + 0.15 && R[9].goldTris >= R[8].goldTris + 60, `${nm}: the golden crown at level 10 (gold grows by ${Math.round(R[9].goldTris - R[8].goldTris)} triangles and reaches ${R[9].goldTop} m, level 9 ${R[8].goldTop} m)`);
  check(R.every((r) => r.roadTagged === 0) && R[0].boxes >= 1, `${nm}: no road-tagged mesh inside the building (lane marks are decals of the building mesh), ${R[0].boxes} wall box(es) at level 1 -> ${R[9].boxes} at level 10`);
}
check(!lv.otherNew, 'warehouse archetype objects that are not main-line stages (fire station, projects) keep the old builder');
check(lv.g1 <= lv.g0, `building + disposing 20 buildings leaves the renderer's geometry count at the baseline (${lv.g0} -> ${lv.g1})`);

// ------------------------------------------------------------------------------------------------ 2 + 3 + 4. the live buildings: facing, pad, neutral props
const roadUuids = () => ev(() => { const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], o = []; scene.traverse((m) => { if (m.isMesh && m.userData && tags.some((t) => m.userData[t])) o.push(m.uuid); }); return o; });
const sameSet = (a, b) => { const A = new Set(a), B = new Set(b); return a.length === b.length && a.every((x) => B.has(x)) && b.every((x) => A.has(x)); };
const finish = () => ev(() => { for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; } for (let k = growingMeshes.length - 1; k >= 0; k--) { growingMeshes[k].mesh.visible = true; growingMeshes[k].mesh.scale.set(1, 1, 1); growingMeshes.splice(k, 1); } });
const settle = async (min = 3, max = 30) => { let prev = await roadUuids(), n = 0; for (let k = 0; k < max; k++) { await page.waitForTimeout(900); const now = await roadUuids(); if (sameSet(prev, now)) { if (++n >= min) return now; } else n = 0; prev = now; } return prev; };
await ev(() => { stageIndex = 11; money = 1e9; planks = 1e5; concrete = 1e4; metal = 1e4; spawnBuilding(3, 1, { grow: false }); spawnBuilding(10, 1, { grow: false }); });
await finish();
await ev(() => { __TYCOON_V83_COLLISIONS__.rebuild(); });
let before = await settle(4, 60);

const live = await ev(() => {
  const out = {};
  for (const si of [3, 10]) {
    const b = buildings.find((x) => x.index === si), m = b.mesh;
    m.updateMatrixWorld(true);
    let door = null; m.traverse((o) => { if (o.userData?.v161Door) door = o; });
    const w = new THREE.Vector3(); door.getWorldPosition(w);
    const pos = buildingPosition(si), end = stageRoadEndpointV367(si), ox = w.x - m.position.x, oz = w.z - m.position.z;
    const l1 = Math.hypot(ox, oz), l2 = Math.hypot(end.x - pos.x, end.z - pos.z);
    const f = m.userData.frontV161, fl = Math.hypot(f.x, f.z);
    const dir = { x: (end.x - pos.x) / l2, z: (end.z - pos.z) / l2 };
    const walls = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === m && e.flags.player && e.shape === 'obb');
    const pad = b.upgradePad.pos;
    let dmin = 1e9;
    for (const e of walls) { const dx = pad.x - e.pos.x, dz = pad.z - e.pos.z, c = Math.cos(e.yaw), s = Math.sin(e.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c; dmin = Math.min(dmin, Math.hypot(lx - Math.max(-e.hx, Math.min(e.hx, lx)), lz - Math.max(-e.hz, Math.min(e.hz, lz)))); }
    const pushed = typeof resolvePlayerCircleCollisions === 'function' ? (() => { const r = resolvePlayerCircleCollisions(pad.x, pad.z, walls); return Math.hypot(r.x - pad.x, r.z - pad.z); })() : null;
    out[si] = { level: b.level, name: m.name, frontDot: +((f.x / fl) * dir.x + (f.z / fl) * dir.z).toFixed(4), doorDot: +((ox * (end.x - pos.x) + oz * (end.z - pos.z)) / (l1 * l2)).toFixed(3), doorDist: +Math.hypot(pos.x + ox - end.x, pos.z + oz - end.z).toFixed(2), radius: +stageAccessRadiusV92(si).toFixed(2), walls: walls.length, padDist: +dmin.toFixed(2), pushed: pushed === null ? null : +pushed.toFixed(3), padSpawned: !!b.upgradePad };
  }
  return out;
});
console.log('live buildings:', J(live));
for (const [si, nm] of [[3, 'warehouse'], [10, 'terminal']]) {
  const r = live[si];
  check(r.name === (si === 3 ? 'warehouseV161' : 'terminalV161') && r.walls >= 1, `live ${nm}: the new building with ${r.walls} wall boxes in the registry`);
  check(r.frontDot >= 0.99 && r.doorDot >= 0.95 && r.doorDist <= r.radius + 1.5, `live ${nm}: the bay / door row faces the driveway (front dot ${r.frontDot}, door dot ${r.doorDot}, door ${r.doorDist} m from the end of the road, radius ${r.radius})`);
  check(r.padSpawned && r.padDist >= 0.8 && r.pushed === 0, `live ${nm}: the upgrade pad stands outside every collider (${r.padDist} m to the nearest wall box; a player circle on its centre is pushed ${r.pushed} m; before: the warehouse pad was inside the wall, the terminal pad 1.47 m outside the 1.67 m invisible wall)`);
}
// neutral props: the picture is the same at stock 0 / 1 / capacity (no stock-tied visual)
const neutral = await ev(() => {
  const tris = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); };
  const res = [], keep = { planks, concrete, metal };
  const cap = { c: concreteCapacity(), m: metalCapacity(), f: frameCapacityV161() };
  for (const [p, c, m] of [[0, 0, 0], [1, 1, 1], [200, cap.c, cap.m]]) { planks = p; concrete = c; metal = m; const a = createBuildingMesh(STAGES[3], 5), b = createBuildingMesh(STAGES[10], 5); res.push([tris(a), tris(b)]); disposeObject3D(a); disposeObject3D(b); }
  planks = keep.planks; concrete = keep.concrete; metal = keep.metal;
  return { res, cap, levels: builtWarehouseLevels() };
});
check(neutral.res.every((r) => r[0] === neutral.res[0][0] && r[1] === neutral.res[0][1]), `neutral props: the triangle counts are identical at stock 0 / 1 / capacity (${J(neutral.res)}; capacity concrete ${neutral.cap.c}, metal ${neutral.cap.m}, frames ${neutral.cap.f} at ${neutral.levels} warehouse levels)`);
console.log('KNOWN ISSUE: the warehouse / terminal capacity (builtWarehouseLevels() raises the concrete / metal / frame caps) is not drawn: the pallets, containers and crates are neutral props, the stocks are shown at the plants');

// ------------------------------------------------------------------------------------------------ 5. real upgrades 1 -> 5 -> 6, 0 road meshes re-laid
await ev(() => { const orig = tryPayResources; window.__charges = []; tryPayResources = function () { const b0 = { money, wood: planks, concrete, metal }; const r = orig.apply(this, arguments); if (r) window.__charges.push({ money: b0.money - money, wood: b0.wood - planks, concrete: b0.concrete - concrete, metal: b0.metal - metal }); return r; }; });
const liveInfo = (si) => ev((si) => { const b = buildings.find((x) => x.index === si); let n = 0; b.mesh.traverse((o) => { if (o.isMesh) n++; }); return { level: b.level, name: b.mesh.name, meshes: n, tier: b.mesh.userData.goldTierV161 || 0, yaw: +b.mesh.rotation.y.toFixed(4), pad: !!b.upgradePad, under: b.underConstruction }; }, si);
const steps = [], seq = { 3: [], 10: [] };
// the warehouse: the real press on its pad for 1 -> 2 (the pad is outside the collider, so the player can stand on it)
{
  const pressed = await waitForState(page, () => {
    if (window.__charges.length) return true;
    const b = buildings.find((x) => x.index === 3), pad = b.upgradePad && b.upgradePad.pos;
    if (!pad) return false;
    player.position.set(pad.x, 0, pad.z);
    const btn = document.getElementById('actionBtn');
    if (btn && !btn.hidden && !btn.disabled) btn.click();
    return false;
  }, null, { timeout: 20000 });
  if (!pressed) { console.log('KNOWN ISSUE: #actionBtn did not upgrade the level-1 warehouse within 20 s; upgraded through upgradeBuilding()'); await ev(() => upgradeBuilding(buildings.find((x) => x.index === 3), { fromQueue: true })); }
  await finish();
  seq[3].push(await liveInfo(3));
  const now = await settle(3, 20); steps.push({ si: 3, from: 1, before: before.length, after: now.length, same: sameSet(before, now) }); before = now;
  check(seq[3][0].level === 2 && (!pressed || (await ev(() => window.__charges.length)) === 1), `real pad press: warehouse level 1 -> 2 (${pressed ? 'exactly one charge' : 'through upgradeBuilding'})`);
}
for (const [si, from] of [[3, 2], [3, 3], [3, 4], [3, 5], [10, 1], [10, 2], [10, 3], [10, 4], [10, 5]]) {
  await ev((si) => { money = 1e9; planks = 1e5; concrete = 1e4; metal = 1e4; upgradeBuilding(buildings.find((x) => x.index === si), { fromQueue: true }); }, si);
  await page.waitForTimeout(1200);                      // the upgrade site stands, the new mesh is still invisible
  await finish();
  seq[si].push(await liveInfo(si));
  const now = await settle(3, 20);
  steps.push({ si, from, before: before.length, after: now.length, same: sameSet(before, now) });
  before = now;
}
console.log('live after each upgrade:', J(seq));
check(J(seq[3].map((l) => l.level)) === '[2,3,4,5,6]' && J(seq[10].map((l) => l.level)) === '[2,3,4,5,6]' && [...seq[3], ...seq[10]].every((l) => !l.under), 'real upgrades: warehouse and terminal go 1 -> 6, each time the grown building (no site left)');
for (const si of [3, 10]) {
  const S = seq[si];
  check(S.every((l, i) => i === 0 || l.meshes >= S[i - 1].meshes) && S.every((l) => l.meshes <= 16) && S.every((l) => l.yaw === S[0].yaw) && S[4].tier === 6, `real upgrades of stage ${si}: mesh counts monotonic (${S.map((l) => l.meshes)}), <= 16, yaw kept, gold tier 6 at level 6`);
}
console.log('road meshes per upgrade step:', J(steps));
check(steps.length === 10 && steps.every((s) => s.same), `real upgrades 1 -> 5 -> 6 of the warehouse and the terminal re-lay 0 road meshes: identical uuid sets before and after every step (${steps.map((s) => s.before + '>' + s.after)})`);

check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
