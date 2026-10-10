// Factories (stage 4 mini factory, 5 factory, 13 tech park) + fleet yard, 2026-10-06 (10), backlog #7 + #8 (assets/factory-v161.js). ONE browser launch on the old-format save. The walk-in / collider-cover /
// min-y numbers of the factories for every level live in tests/buildings-physics.test.mjs (hard); this file checks the DESIGN, the growth, the driveway side, the pad, smoke, roads and the fleet yard:
//   1. levels 1..10 by the game's real chain (createBuildingMesh): one group per stage (`miniFactoryV161` / `factoryV161` / `techParkV161`), the SAME building grows - door position, yaw, facing and the pad-side
//      wall limit are identical on every level, NO height stretch (bbox height never decreases, every level changes it by <= 0.6 m, level 5 <= 1.4 x level 1; the old builder: 18 % per level, 9-10.7 m),
//      mesh counts never decrease and stay <= 16 (old builder 85-122 in the same page), triangles grow on every level 1..5, gold from 6 (one gold mesh, more with every level), the crown at 10 (+>= 60
//      triangles, >= 0.15 m higher), no road-tagged mesh inside, chimney tops listed for the smoke (userData.stackTops) and above the roof.
//   2. the loading door / entrance faces the driveway (front dot >= 0.99, door dot >= 0.95, <= radius + 1.5 m from the end of the road) and the upgrade pad stands outside the colliders (>= 0.8 m from every
//      wall box and a player circle on its centre is not pushed).
//   3. smoke only while the building works: no puff from a building under construction (or an invisible upgrade mesh), exactly one per chimney once it is complete.
//   4. real upgrades 1 -> 5 -> 6 of the three live factories: each time the grown building, mesh counts monotonic, 0 road meshes re-laid (identical uuid sets before / after every step).
//   5. FLEET YARD: <= 16 meshes (old 47), lot slab + throat + trucks' homes unchanged, solid fence runs / garage / booth / pump / pillars in the registry (player + agent only), the fence blocks a player walked from 5
//      of 8 directions, the open mouth along the service lane lets the other 3 in (a free gate gap >= 2.3 m), every truck bay and the lane -> bay lines are free (not pushed), parked trucks keep their positions
//      after the rebuild, no road mesh over the lot, lamps glow at night / beacon blinks, no leak over 20 rebuilds, the old yard comes back with FleetYardV161.enabled = false.
//   6. meshes baseline (build + dispose 20 factories) and 0 console errors / 4xx.
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const STAGE = [4, 5, 13], NAME = { 4: 'miniFactoryV161', 5: 'factoryV161', 13: 'techParkV161' };

// ------------------------------------------------------------------------------------------------ 1. levels 1..10
const lv = await ev(() => {
  const count = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const tris = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); return Math.round(n); };
  const out = {};
  for (const si of [4, 5, 13]) {
    const rows = [];
    for (let L = 1; L <= MAX_BUILDING_LEVEL; L++) {
      const m = createBuildingMesh(STAGES[si], L);
      m.updateMatrixWorld(true);
      const gold = m.children.find((c) => c.name === 'factoryGoldV161');
      let goldTop = null, goldTris = 0;
      if (gold) { gold.geometry.computeBoundingBox(); goldTop = +gold.geometry.boundingBox.max.y.toFixed(3); goldTris = gold.geometry.index.count / 3; }
      let door = null, roadTagged = 0;
      m.traverse((o) => { if (o.userData?.v161Door) door = o; if (o.userData && (o.userData.v59RoadDeck || o.userData.v86StageRoad || o.userData.v66ServiceRoad || o.userData.v116PersistentRoad)) roadTagged++; });
      const d = m.userData.v161Dims || {}, fp = m.userData.v161Footprint || [];
      const padEdge = Math.max(...fp.map((f) => (d.gs > 0 ? -(f.x - f.hx) : (f.x + f.hx))));
      const bb = new THREE.Box3(); m.traverse((o) => { if (o.isMesh && !o.userData.v161Gold) bb.expandByObject(o); });
      const tops = (m.userData.stackTops || []).map((t) => [t.x, t.y, t.z]);
      rows.push({ L, name: m.name, kind: m.userData.v161Factory, meshes: count(m), tris: tris(m), tier: m.userData.goldTierV161 || 0, goldTop, goldTris, level: m.userData.levelV161, yaw: +m.rotation.y.toFixed(4), front: m.userData.frontV161 || null,
        door: door && [door.position.x, door.position.y, door.position.z].map((v) => +v.toFixed(3)), roadTagged, padEdge: +padEdge.toFixed(3), complete: !!(m.userData.v161Complete && m.userData.v44Detailed && m.userData.v157Finish), boxes: fp.length,
        height: +(bb.max.y - bb.min.y).toFixed(2), tops, topMax: tops.length ? Math.max(...tops.map((t) => t[1])) : 0, bboxTop: +bb.max.y.toFixed(2) });
      disposeObject3D(m);
    }
    out[si] = rows;
  }
  FactoryV161.enabled = false;
  const old = {};
  for (const si of [4, 5, 13]) for (const L of [1, 3, 5, 10]) { const m = createBuildingMesh(STAGES[si], L); const bb = new THREE.Box3().setFromObject(m); old[si + ':' + L] = { meshes: count(m), height: +(bb.max.y - bb.min.y).toFixed(2) }; disposeObject3D(m); }
  FactoryV161.enabled = true;
  const other = createBuildingMesh({ archetype: 'factory', color: 0xd95a4d, height: 3.2, baseSize: 2.55 }, 1);
  const otherNew = !!other.userData.v161Factory; disposeObject3D(other);
  const g0 = renderer.info.memory.geometries;
  for (let i = 0; i < 20; i++) { const m = createBuildingMesh(STAGES[[4, 5, 13][i % 3]], 5); disposeObject3D(m); }
  const g1 = renderer.info.memory.geometries;
  return { out, old, otherNew, g0, g1 };
});
for (const si of STAGE) {
  const R = lv.out[si], nm = { 4: 'mini factory', 5: 'factory', 13: 'tech park' }[si];
  const oldS = Object.fromEntries(Object.entries(lv.old).filter(([k]) => k.startsWith(si + ':')));
  console.log(`${nm} levels:`, R.map((r) => `L${r.L}: ${r.meshes} meshes, ${r.tris} tris, h ${r.height} m, tier ${r.tier}${r.goldTop ? ', gold top ' + r.goldTop : ''}`).join(' | '));
  check(R.length === 10 && R.every((r) => r.name === NAME[si] && r.complete && r.door && r.level === Math.min(r.L, 5)), `${nm}: every level 1..10 is the one \`${NAME[si]}\` group (flags v161Factory / v161Complete, a door mesh for the door tests)`);
  check(R.every((r, i) => i === 0 || r.meshes >= R[i - 1].meshes) && R.every((r) => r.meshes <= 16), `${nm}: mesh counts never decrease and stay <= 16 (${R.map((r) => r.meshes)}); the old builder had ${J(Object.fromEntries(Object.entries(oldS).map(([k, v]) => [k, v.meshes])))} for levels 1/3/5/10`);
  const H = R.slice(0, 5).map((r) => r.height);
  check(H.every((h, i) => i === 0 || (h >= H[i - 1] - 1e-6 && h - H[i - 1] <= 0.6)) && H[4] <= H[0] * 1.4, `${nm}: NO height stretch - the bbox height ${J(H)} m for levels 1..5 never decreases, every level changes it by <= 0.6 m, level 5 <= 1.4 x level 1 (old builder ${J(Object.fromEntries(Object.entries(oldS).map(([k, v]) => [k, v.height])))})`);
  check(R.slice(0, 5).every((r, i) => i === 0 || r.tris > R[i - 1].tris) && R[9].tris > R[4].tris, `${nm}: every level 1..5 ADDS parts (triangles ${R.map((r) => r.tris)}), 10 > 5`);
  check(R.every((r) => J(r.door) === J(R[0].door) && r.yaw === R[0].yaw && J(r.front) === J(R[0].front) && r.padEdge === R[0].padEdge), `${nm}: the SAME building grows - door ${J(R[0].door)}, facing (yaw ${R[0].yaw}) and the wall limit on the pad side (${R[0].padEdge} m) are identical on every level`);
  check(R.slice(0, 5).every((r) => r.tier === 0) && R.slice(5).every((r) => r.tier === r.L && r.goldTop !== null) && R.slice(5).every((r, i) => i === 0 || r.goldTris >= R[4 + i].goldTris), `${nm}: gold from level 6 (tier = level, one gold mesh, more gold with every level: ${R.slice(5).map((r) => r.goldTris)})`);
  check(R[9].goldTop >= R[8].goldTop + 0.15 && R[9].goldTris >= R[8].goldTris + 60, `${nm}: the golden crown at level 10 (gold grows by ${Math.round(R[9].goldTris - R[8].goldTris)} triangles and reaches ${R[9].goldTop} m, level 9 ${R[8].goldTop} m)`);
  check(R.every((r) => r.roadTagged === 0) && R[0].boxes >= 1, `${nm}: no road-tagged mesh inside the building, ${R[0].boxes} wall box(es) at level 1 -> ${R[9].boxes} at level 10`);
  check(R.every((r) => r.tops.length >= 1 && r.topMax > 2.4 && r.topMax <= r.bboxTop + 0.2) && R[4].tops.length >= R[0].tops.length, `${nm}: chimney tops listed for the smoke (${R.map((r) => r.tops.length)} per level, highest ${R[4].topMax} m)`);
}
check(!lv.otherNew, 'factory archetype objects that are not main-line stages (district plots, projects) keep the old builder');
check(lv.g1 <= lv.g0, `building + disposing 20 buildings leaves the renderer's geometry count at the baseline (${lv.g0} -> ${lv.g1})`);

// ------------------------------------------------------------------------------------------------ 2. live buildings: facing, pad
const roadUuids = () => ev(() => { const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], o = []; scene.traverse((m) => { if (m.isMesh && m.userData && tags.some((t) => m.userData[t])) o.push(m.uuid); }); return o; });
const sameSet = (a, b) => { const A = new Set(a), B = new Set(b); return a.length === b.length && a.every((x) => B.has(x)) && b.every((x) => A.has(x)); };
const finish = () => ev(() => { for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; } for (let k = growingMeshes.length - 1; k >= 0; k--) { growingMeshes[k].mesh.visible = true; growingMeshes[k].mesh.scale.set(1, 1, 1); growingMeshes.splice(k, 1); } });
const settle = async (min = 3, max = 30) => { let prev = await roadUuids(), n = 0; for (let k = 0; k < max; k++) { await page.waitForTimeout(900); const now = await roadUuids(); if (sameSet(prev, now)) { if (++n >= min) return now; } else n = 0; prev = now; } return prev; };
await ev(() => { stageIndex = 15; money = 1e9; planks = 1e5; concrete = 1e4; metal = 1e4; for (const si of [4, 5, 13]) spawnBuilding(si, 1, { grow: false }); });
await finish();
await ev(() => { __TYCOON_V83_COLLISIONS__.rebuild(); });
let before = await settle(4, 60);

const live = await ev(() => {
  const out = {};
  for (const si of [4, 5, 13]) {
    const b = buildings.find((x) => x.index === si), m = b.mesh;
    m.updateMatrixWorld(true);
    let door = null; m.traverse((o) => { if (o.userData?.v161Door) door = o; });
    const w = new THREE.Vector3(); door.getWorldPosition(w);
    const pos = buildingPosition(si), end = stageRoadEndpointV367(si), ox = w.x - m.position.x, oz = w.z - m.position.z;
    const l1 = Math.hypot(ox, oz), l2 = Math.hypot(end.x - pos.x, end.z - pos.z);
    const f = m.userData.frontV161, fl = Math.hypot(f.x, f.z);
    const dir = { x: (end.x - pos.x) / l2, z: (end.z - pos.z) / l2 };
    const walls = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === m && e.flags.player && e.shape === 'obb');
    const pad = b.upgradePad && b.upgradePad.pos;
    let dmin = 1e9;
    if (pad) for (const e of walls) { const dx = pad.x - e.pos.x, dz = pad.z - e.pos.z, c = Math.cos(e.yaw), s = Math.sin(e.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c; dmin = Math.min(dmin, Math.hypot(lx - Math.max(-e.hx, Math.min(e.hx, lx)), lz - Math.max(-e.hz, Math.min(e.hz, lz)))); }
    const pushed = pad ? (() => { const r = resolvePlayerCircleCollisions(pad.x, pad.z, walls); return Math.hypot(r.x - pad.x, r.z - pad.z); })() : null;
    out[si] = { level: b.level, name: m.name, frontDot: +((f.x / fl) * dir.x + (f.z / fl) * dir.z).toFixed(4), doorDot: +((ox * (end.x - pos.x) + oz * (end.z - pos.z)) / (l1 * l2)).toFixed(3), doorDist: +Math.hypot(pos.x + ox - end.x, pos.z + oz - end.z).toFixed(2), radius: +stageAccessRadiusV92(si).toFixed(2), walls: walls.length, padSpawned: !!pad, padDist: +dmin.toFixed(2), pushed: pushed === null ? null : +pushed.toFixed(3) };
  }
  return out;
});
console.log('live buildings:', J(live));
for (const si of STAGE) {
  const r = live[si], nm = { 4: 'mini factory', 5: 'factory', 13: 'tech park' }[si];
  check(r.name === NAME[si] && r.walls >= 1, `live ${nm}: the new building with ${r.walls} wall boxes in the registry`);
  check(r.frontDot >= 0.99 && r.doorDot >= 0.95 && r.doorDist <= r.radius + 1.5, `live ${nm}: the loading door / entrance faces the driveway (front dot ${r.frontDot}, door dot ${r.doorDot}, door ${r.doorDist} m from the end of the road, radius ${r.radius})`);
  check(r.padSpawned && r.padDist >= 0.8 && r.pushed === 0, `live ${nm}: the upgrade pad stands outside every collider (${r.padDist} m to the nearest wall box; a player circle on its centre is pushed ${r.pushed} m; before: inside the old collider by 0.68-0.72 m for the mini factory / factory, 1.02 m for the tech park)`);
}

// ------------------------------------------------------------------------------------------------ 3. smoke only while the building works
const smoke = await ev(() => {
  const res = {};
  for (const si of [4, 5, 13]) {
    const e = buildings.find((x) => x.index === si);
    for (const b of buildings) b.smokeTimer = 0;
    for (const p of smokePuffs) p.life = 0; updateSmoke(0.01);
    for (const b of buildings) b.smokeTimer = 0;
    const n0 = smokePuffs.length;
    e.underConstruction = true; e.smokeTimer = 99; updateSmoke(0.01);
    const n1 = smokePuffs.length;
    e.underConstruction = false; e.mesh.visible = false; e.smokeTimer = 99; updateSmoke(0.01);
    const n2 = smokePuffs.length;
    e.mesh.visible = true; e.smokeTimer = 99; updateSmoke(0.01);
    const n3 = smokePuffs.length;
    // the puffs start above the roof at the chimney top of the yawed building
    const tops = e.smokeTops, bb = new THREE.Box3().setFromObject(e.mesh);
    const last = smokePuffs.slice(-tops.length).map((p) => p.sprite.position);
    res[si] = { under: n1 - n0, hidden: n2 - n1, done: n3 - n2, tops: tops.length, inside: last.every((p) => p.x > bb.min.x - 0.6 && p.x < bb.max.x + 0.6 && p.z > bb.min.z - 0.6 && p.z < bb.max.z + 0.6 && p.y > 2.4), cap: smokePuffs.length >= MAX_SMOKE_PUFFS };
    for (const p of smokePuffs) p.life = 0; updateSmoke(0.5);
  }
  return res;
});
console.log('smoke:', J(smoke));
for (const si of STAGE) check(smoke[si].cap || (smoke[si].under === 0 && smoke[si].hidden === 0 && smoke[si].done === smoke[si].tops && smoke[si].inside), `stage ${si}: no smoke from a building under construction or an invisible upgrade mesh, exactly ${smoke[si].tops} puff(s) (one per chimney) once it works, at the chimney top above the roof ${J(smoke[si])}`);

// ------------------------------------------------------------------------------------------------ 4. real upgrades 1 -> 5 -> 6, 0 road meshes re-laid
const liveInfo = (si) => ev((si) => { const b = buildings.find((x) => x.index === si); let n = 0; b.mesh.traverse((o) => { if (o.isMesh) n++; }); const bb = new THREE.Box3().setFromObject(b.mesh); return { level: b.level, name: b.mesh.name, meshes: n, tier: b.mesh.userData.goldTierV161 || 0, yaw: +b.mesh.rotation.y.toFixed(4), pad: !!b.upgradePad, under: b.underConstruction, height: +(bb.max.y - bb.min.y).toFixed(2) }; }, si);
const steps = [], seq = { 4: [], 5: [], 13: [] };
for (const si of STAGE) {
  for (let from = 1; from <= 5; from++) {
    await ev((si) => { money = 1e9; planks = 1e5; concrete = 1e4; metal = 1e4; upgradeBuilding(buildings.find((x) => x.index === si), { fromQueue: true }); }, si);
    await page.waitForTimeout(1200);                      // the upgrade site stands, the new mesh is still invisible
    await finish();
    seq[si].push(await liveInfo(si));
    const now = await settle(3, 20);
    steps.push({ si, from, before: before.length, after: now.length, same: sameSet(before, now) });
    before = now;
  }
}
console.log('live after each upgrade:', J(seq));
for (const si of STAGE) {
  const S = seq[si];
  check(J(S.map((l) => l.level)) === '[2,3,4,5,6]' && S.every((l) => !l.under), `real upgrades: stage ${si} goes 1 -> 6, each time the grown building (no site left)`);
  check(S.every((l, i) => i === 0 || l.meshes >= S[i - 1].meshes) && S.every((l) => l.meshes <= 16) && S.every((l) => l.yaw === S[0].yaw) && S[4].tier === 6 && S.every((l) => l.name === NAME[si]), `real upgrades of stage ${si}: mesh counts monotonic (${S.map((l) => l.meshes)}), <= 16, yaw kept, gold tier 6 at level 6`);
}
console.log('road meshes per upgrade step:', J(steps));
check(steps.length === 15 && steps.every((s) => s.same), `real upgrades 1 -> 5 -> 6 of the three factories re-lay 0 road meshes: identical uuid sets before and after every step (${steps.map((s) => s.before + '>' + s.after)})`);

// ------------------------------------------------------------------------------------------------ 5. fleet yard
const fleet = await ev(() => {
  const reg = __TYCOON_V83_COLLISIONS__.registry;
  // the three dedicated trucks are a purchase in the game (state.owned): own them here so the yard has trucks to keep (test fixture, the purchase code is untouched)
  const owned = window.__TYCOON_V119__.state.owned; owned.planks = owned.concrete = owned.metal = true; syncDeliveryFleet(); __TYCOON_V65_TRAFFIC__.refresh();
  const count = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const trucks = () => serviceVehicles.map((v) => [v.userData.logisticsId || v.userData.role || '?', +v.position.x.toFixed(2), +v.position.z.toFixed(2)]);
  const yard0 = scene.getObjectByName('v116FleetYard');
  const lot = (y) => { let r = null; y.traverse((o) => { if (o.userData && o.userData.v116FleetLot) r = o; }); return r && [r.position.x, r.position.y, r.position.z, r.geometry.parameters.width, r.geometry.parameters.depth]; };
  const out = { meshes: count(yard0), lot: lot(yard0), throat: !!(() => { let t = null; yard0.traverse((o) => { if (o.userData && o.userData.v116FleetEntrance) t = o; }); return t; })(), trucksBefore: trucks() };
  const own = [...reg.values()].filter((e) => e.owner === yard0);
  out.own = own.map((e) => [e.label, +e.pos.x.toFixed(2), +e.pos.z.toFixed(2), +e.hx.toFixed(2), +e.hz.toFixed(2), !!e.flags.player, !!e.flags.agent, !!e.flags.placement, !!e.flags.camera]);
  // yard centre + the 8-direction walk from 9 m, only the registry entries that are not vehicles (the game's resolver)
  const cx = -8.70 + INDUSTRIAL_ZONE_OFFSET_X, cz = 6.72;
  const entries = gatherPhysicsCircles().filter((e) => e.category !== 'vehicle' && !String(e.label || '').startsWith('vehicle') && e.kind !== 'vehicle');
  const saved = playerVelocity.clone();
  const walk = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
    let x = cx + dx * 9, z = cz + dz * 9, reached = false, inLot = false;
    for (let s = 0; s < 130; s++) { playerVelocity.set(-dx * 4, 0, -dz * 4); const r = resolvePlayerCircleCollisions(x - dx * 0.1, z - dz * 0.1, entries); x = r.x; z = r.z; if (Math.hypot(x - cx, z - cz) < 0.6) reached = true; if (Math.abs(x - cx) < 5.4 && z > 5.2 && z < 7.6) inLot = true; }
    walk.push({ a: Math.round(a * 180 / Math.PI), reached, inLot, end: [+x.toFixed(2), +z.toFixed(2)] });
  }
  playerVelocity.copy(saved);
  out.walk = walk;
  // free ways: the lane -> bay lines of the six truck homes and the road throat -> lane
  const homes = Object.values(__TYCOON_V65_TRAFFIC__.homes).map((v) => [v.x, v.z]);
  const pushAt = (x, z) => { playerVelocity.set(0, 0, 0); const r = resolvePlayerCircleCollisions(x, z, entries); return Math.hypot(r.x - x, r.z - z); };
  let worst = 0;
  for (const [hx, hz] of homes) for (let z = 4.2; z <= hz + 0.01; z += 0.1) worst = Math.max(worst, pushAt(hx, z));
  for (let z = 3.2; z <= 5.5; z += 0.1) worst = Math.max(worst, pushAt(cx, z));
  out.homes = homes.length; out.lanePush = +worst.toFixed(3);
  // is the fence solid? a player circle ON the middle of each wall box is pushed out by >= 0.3 m
  out.solid = own.filter((e) => String(e.label).startsWith('fleet:')).map((e) => [e.label, +pushAt(e.pos.x, e.pos.z).toFixed(2)]);
  // the mouth width along the lane: free x range at z = 5.6
  let free = 0; for (let x = cx - 5.9; x <= cx + 5.9; x += 0.05) if (pushAt(x, 5.3) === 0) free += 0.05;
  out.mouth = +free.toFixed(2);
  // lamps / beacon
  const yard = yard0;
  let lampM = null, beaconM = null; yard.traverse((o) => { if (o.name === 'fleetLampV161') lampM = o.material; if (o.name === 'fleetBeaconV161') beaconM = o.material; });
  const tickAll = (t) => { for (const f of window.__TYCOON_VISUAL_TICKS__ || []) { try { f(t); } catch (e) { /* */ } } };
  const T0 = performance.now() + 1e6; tickAll(T0); const b1 = beaconM && beaconM.emissiveIntensity; tickAll(T0 + 550); const b2 = beaconM && beaconM.emissiveIntensity;
  const l0 = lampM && lampM.emissiveIntensity;
  out.blink = [b1, b2]; out.lamp = l0;
  // no road meshes inside the yard group, and none over the lot
  let roadInside = 0; yard.traverse((o) => { if (o.userData && (o.userData.v59RoadDeck || o.userData.v86StageRoad || o.userData.v66ServiceRoad || o.userData.v116PersistentRoad)) roadInside++; }); out.roadInside = roadInside;
  // old yard + leak
  FleetYardV161.enabled = false; __TYCOON_V65_TRAFFIC__.refresh();
  const yardOld = scene.getObjectByName('v116FleetYard');
  out.oldMeshes = count(yardOld); out.oldSolid = [...reg.values()].filter((e) => e.owner === yardOld && String(e.label).startsWith('fleet:')).length;
  FleetYardV161.enabled = true; __TYCOON_V65_TRAFFIC__.refresh();
  const g0 = renderer.info.memory.geometries;
  for (let i = 0; i < 20; i++) __TYCOON_V65_TRAFFIC__.refresh();
  const g1 = renderer.info.memory.geometries;
  const yard2 = scene.getObjectByName('v116FleetYard');
  out.after = { meshes: count(yard2), lot: lot(yard2), trucks: trucks(), solid: [...reg.values()].filter((e) => e.owner === yard2 && String(e.label).startsWith('fleet:')).length, groups: scene.children.filter((o) => o.name === 'v116FleetYard').length };
  out.g0 = g0; out.g1 = g1;
  return out;
});
console.log('fleet yard:', J({ meshes: fleet.meshes, oldMeshes: fleet.oldMeshes, solid: fleet.own.length, walk: fleet.walk.map((w) => [w.a, w.reached]), mouth: fleet.mouth, lanePush: fleet.lanePush, blink: fleet.blink, lamp: fleet.lamp }));
check(fleet.meshes <= 16 && fleet.oldMeshes >= 40 && fleet.meshes * 2.5 <= fleet.oldMeshes, `fleet yard: <= 16 meshes (${fleet.meshes}; the old yard ${fleet.oldMeshes}), the lot slab ${J(fleet.lot)} and the road throat are the same objects of the same size`);
check(fleet.own.length >= 8 && fleet.own.every((e) => e[5] && e[6] && !e[7] && !e[8]) && fleet.oldSolid === 0, `fleet yard: ${fleet.own.length} solid boxes in the registry (fence west / east / rear, pillars, garage, booth, pump, wash stand, gate leaf), player + agent only (no placement / camera flag: the road planners keep the old keep-out parcel); the old yard had none`);
check(fleet.solid.every((s) => s[1] >= 0.3), `fleet yard: every fence run / pillar / building box is solid - a player circle on its centre is pushed out (${J(fleet.solid)})`);
const blocked = fleet.walk.filter((w) => !w.reached), opened = fleet.walk.filter((w) => w.reached);
check(blocked.map((w) => w.a).sort((p, q) => p - q).join() === '0,45,90,270,315' && blocked.every((w) => !w.inLot), `fleet yard: the fence + garage block a player walked at the yard centre from N / NE / E / W / NW and never let it into the lot (${J(blocked.map((w) => [w.a, w.end]))}); before: every direction walked straight in (the fence was not solid)`);
check(opened.map((w) => w.a).sort((p, q) => p - q).join() === '135,180,225', `fleet yard: the open mouth along the service lane (gate gap) lets the player in from SE / S / SW (${J(opened.map((w) => w.a))}), free width at the front ${fleet.mouth} m`);
check(fleet.homes === 6 && fleet.lanePush === 0 && fleet.mouth >= 2.3, `fleet yard: the six truck bays and the lines lane -> bay, road throat -> lane are free of colliders (largest push ${fleet.lanePush} m over ${fleet.homes} homes); the gate gap is >= 2.3 m wide (${fleet.mouth} m)`);
check(fleet.trucksBefore.length >= 3 && J(fleet.after.trucks) === J(fleet.trucksBefore) && J(fleet.after.lot) === J(fleet.lot) && fleet.after.groups === 1 && fleet.after.solid === fleet.own.length, `fleet yard: after 22 rebuilds the ${fleet.after.trucks.length} parked trucks stand where they stood (${J(fleet.after.trucks)}), the lot is unchanged, one yard group, the same ${fleet.after.solid} solid boxes`);
check(fleet.g1 <= fleet.g0, `fleet yard: 20 rebuilds leave the renderer's geometry count at the baseline (${fleet.g0} -> ${fleet.g1})`);
check(fleet.roadInside === 0, `fleet yard: no road-tagged mesh in the yard (the lane marks, arrows and hazard chevrons are decals of the yard mesh)`);
check(fleet.blink[0] !== fleet.blink[1] && fleet.lamp > 0, `fleet yard: live - the booth beacon blinks (${J(fleet.blink)}) and the floodlight material is lit (${fleet.lamp})`);
console.log('KNOWN ISSUE: the fleet yard front is the open mouth along the service lane (11.4 m) because the fleet graph (v65 nodes at z = 4.45) drives every truck straight from the lane into its bay; a closed fence with a single gate would need the graph nodes moved (not allowed here, road layout)');

check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
