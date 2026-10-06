// Road network regression checklist (ported from archive/tycoon-v116/tests/roads.test.mjs, re-verified
// against v161). Everything is measured on the real scene graph (mesh uuids, world matrices, Box3 /
// OBB), never on the file's own self-audit objects. One browser launch on the old-format save
// (industrial zone + automatic roads already built, like the user's returning player).
//   1. no road mesh overlaps the fleet-yard parking lot, no conveyor object is left (the log belt was removed 2026-10-04 (10); the SAT
//      check against the real triangles stays as a guard if one is ever added back),
//   2. after building several houses through purchaseCurrentPad(): every building has a driveway
//      that reaches it, stage-road CORNER and T/X junction pieces exist, still no overlaps,
//   3. an unrelated base upgrade and idle ticks must not rebuild the road network (same mesh uuids,
//      same unified-surface layer),
//   3b. (2026-10-06 (9)) the upgrades 1 -> 5 of EVERY main-line stage (0..15) re-lay no road mesh: all 16 stages stand at level 1, then four rounds upgrade all of them (the real
//      upgradeBuilding: the old mesh goes, the invisible upgrade site stands, the new mesh comes back); the uuid set of the road meshes is identical after every round.
//   4. "[road union]" never shows up in the console during the whole run.
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';

const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);

await ev(() => { money = 999999999; planks = 999999; concrete = 999999; metal = 999999; });

// uuids of every road mesh (source meshes of the union stay in the scene, hidden) + the unified surface group
const roadSnapshot = () => ev(() => {
  const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'];
  const meshes = [], stage = [], layout = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.userData) return;
    if (tags.some((t) => o.userData[t])) { o.updateWorldMatrix(true, false); meshes.push(o.uuid); layout.push(`${o.geometry.type}:${o.geometry.attributes?.position?.count}:${o.matrixWorld.elements.map((x) => x.toFixed(2)).join(',')}`); }
    if (o.userData.v86StageRoad) stage.push(o.uuid);
  });
  layout.sort();
  return { meshes, stage, layout, union: scene.getObjectByName('v113UnifiedStarterRoadSurface')?.uuid || null };
});
function diff(a, b) {
  const A = new Set(a), B = new Set(b);
  return { destroyed: a.filter((x) => !B.has(x)).length, created: b.filter((x) => !A.has(x)).length };
}

// Geometry checks in one evaluate: fleet-yard lot vs roads, conveyor vs road decks (OBB SAT), driveway gaps.
const geometryChecks = () => ev(() => {
  const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'];
  const roads = [];
  scene.traverse((o) => { if (o.isMesh && o.userData && tags.some((t) => o.userData[t])) { o.updateWorldMatrix(true, false); roads.push(o); } });
  const isBox = (m) => m.geometry?.type === 'BoxGeometry' && m.geometry.parameters?.width && m.geometry.parameters?.depth;
  const corners = (m) => { // XZ corners of a BoxGeometry mesh in world space
    const p = m.geometry.parameters, hx = p.width / 2, hz = p.depth / 2;
    return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([x, z]) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(m.matrixWorld); return { x: v.x, z: v.z }; });
  };
  const sat = (A, B) => { // strict overlap of two convex polygons in XZ
    for (const poly of [A, B]) for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length], ax = -(p2.z - p1.z), az = p2.x - p1.x, len = Math.hypot(ax, az) || 1;
      const proj = (P) => { const d = P.map((p) => (p.x * ax + p.z * az) / len); return [Math.min(...d), Math.max(...d)]; };
      const [a0, a1] = proj(A), [b0, b1] = proj(B);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= 0.01) return false;
    }
    return true;
  };
  const insidePoly = (pt, P) => { let s = null; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], c = (b.x - a.x) * (pt.z - a.z) - (b.z - a.z) * (pt.x - a.x); if (Math.abs(c) < 1e-9) continue; if (s === null) s = c > 0; else if (s !== (c > 0)) return false; } return true; };

  // --- fleet yard: the parking lot is the biggest flat box in the group
  const fleet = scene.getObjectByName('v116FleetYard');
  let lot = null, area = 0;
  fleet?.traverse((o) => { if (isBox(o)) { const a = o.geometry.parameters.width * o.geometry.parameters.depth; if (a > area) { area = a; lot = o; } } });
  let fleetOverlaps = 0;
  const fleetHits = [];
  if (lot) {
    lot.updateWorldMatrix(true, false);
    const lotC = corners(lot), lotBox = new THREE.Box3().setFromObject(lot);
    for (const r of roads) {
      let hit = false;
      if (isBox(r)) hit = sat(lotC, corners(r)) && !(new THREE.Box3().setFromObject(r).max.y < lotBox.min.y || new THREE.Box3().setFromObject(r).min.y > lotBox.max.y + 0.2);
      else { // curved/junction fills: a vertex inside the lot rectangle is a real overlap (AABBs give false positives)
        const pos = r.geometry.attributes.position, v = new THREE.Vector3();
        for (let i = 0; i < pos.count && !hit; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(r.matrixWorld); if (insidePoly({ x: v.x, z: v.z }, lotC) && Math.abs(v.y - lotBox.max.y) < 0.2) hit = true; }
      }
      if (hit) { fleetOverlaps++; fleetHits.push(`${r.name || r.geometry.type}:${Object.keys(r.userData).filter((k) => /^v\d+/.test(k)).join('+')}`); }
    }
  }

  // --- conveyor belt vs road decks. v161 swaps the belt's box geometry for BufferGeometry (tagged v116Conveyor),
  // so test real triangles (XZ, SAT) of every conveyor mesh against the BoxGeometry road decks + a Y-range check.
  const conveyors = [];
  scene.traverse((o) => { if (o.isMesh && o.userData?.v116Conveyor && o.geometry?.attributes?.position) { o.updateWorldMatrix(true, false); conveyors.push(o); } });
  let conveyorOverlaps = 0;
  const v3 = new THREE.Vector3();
  for (const c of conveyors) {
    const cb = new THREE.Box3().setFromObject(c), pos = c.geometry.attributes.position, idx = c.geometry.index;
    const n = idx ? idx.count : pos.count;
    const vert = (k) => { const i = idx ? idx.getX(k) : k; return v3.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld).clone(); };
    for (const r of roads) {
      if (!isBox(r)) continue;
      const rb = new THREE.Box3().setFromObject(r);
      if (!cb.intersectsBox(rb)) continue;
      const rc = corners(r);
      let hit = false;
      for (let k = 0; k + 2 < n && !hit; k += 3) {
        const t = [vert(k), vert(k + 1), vert(k + 2)];
        const poly = t.map((p) => ({ x: p.x, z: p.z }));
        const area = Math.abs((poly[1].x - poly[0].x) * (poly[2].z - poly[0].z) - (poly[2].x - poly[0].x) * (poly[1].z - poly[0].z));
        if (area < 1e-4) continue; // vertical or degenerate in XZ
        const y0 = Math.min(t[0].y, t[1].y, t[2].y), y1 = Math.max(t[0].y, t[1].y, t[2].y);
        if (y1 < rb.min.y || y0 > rb.max.y) continue;
        hit = sat(poly, rc);
      }
      if (hit) conveyorOverlaps++;
    }
  }

  // --- driveways: distance from each building's footprint edge to the nearest road mesh (exact for box decks, AABB otherwise)
  const driveways = buildings.filter((b) => b?.pos && Number.isInteger(b.index)).map((b) => {
    const rad = buildingCollisionRadius(b);
    let best = Infinity;
    for (const r of roads) {
      let d;
      if (isBox(r)) { // point -> OBB distance in XZ
        const inv = r.matrixWorld.clone().invert(), l = new THREE.Vector3(b.pos.x, r.position.y, b.pos.z).applyMatrix4(inv), p = r.geometry.parameters;
        d = Math.hypot(Math.max(Math.abs(l.x) - p.width / 2, 0), Math.max(Math.abs(l.z) - p.depth / 2, 0)) * Math.abs(r.matrixWorld.getMaxScaleOnAxis());
      } else {
        const bx = new THREE.Box3().setFromObject(r);
        d = Math.hypot(Math.max(bx.min.x - b.pos.x, b.pos.x - bx.max.x, 0), Math.max(bx.min.z - b.pos.z, b.pos.z - bx.max.z, 0));
      }
      best = Math.min(best, d);
    }
    return { index: b.index, gap: +(best - rad).toFixed(2) };
  });
  return { fleetFound: !!lot, fleetOverlaps, fleetHits: fleetHits.slice(0, 4), conveyorCount: conveyors.length, conveyorOverlaps, roadCount: roads.length, driveways };
});

const net = () => ev(() => { const n = cityWorldRuntime?.stageRoads?.userData?.v86StageNetwork || null; return n && { stageIds: [...(n.stageIds || [])], kinds: { ...(n.kinds || {}) } }; });

// ---- 1. geometry on the loaded save
let geo = await geometryChecks();
console.log('geometry (loaded save):', JSON.stringify({ ...geo, driveways: geo.driveways.length }));
check(geo.roadCount > 0, `road meshes present in the scene (${geo.roadCount})`);
check(geo.fleetFound, 'fleet-yard parking lot (v116FleetYard) exists in the scene');
check(geo.fleetOverlaps === 0, `no road mesh overlaps the fleet-yard lot (${geo.fleetOverlaps} ${JSON.stringify(geo.fleetHits)})`);
// 2026-10-04 (10): the log belt (and the camp it started at) was removed on the user's request; there must be no conveyor object left, hence nothing to overlap a road
check(geo.conveyorCount === 0, `no conveyor meshes left in the scene (${geo.conveyorCount}; removed 2026-10-04 (10), was 33 objects)`);
check(geo.conveyorOverlaps === 0, `no road deck overlaps a conveyor (${geo.conveyorOverlaps})`);

// ---- 2. several houses through the real purchase path, then network pieces + driveways
const before6 = await net();
const stageBefore6 = (await roadSnapshot()).stage;
for (let i = 0; i < 6; i++) {
  await ev(() => { purchaseCurrentPad(); });
  await page.waitForTimeout(150);
  await ev(() => { // finish construction by hand (real timers take minutes at 3 fps)
    for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; }
    for (let i = growingMeshes.length - 1; i >= 0; i--) if (!growingMeshes[i]?.entry?.underConstruction) { growingMeshes[i].mesh.visible = true; growingMeshes[i].mesh.scale.set(1, 1, 1); growingMeshes.splice(i, 1); }
  });
  await page.waitForTimeout(150);
}
const nb = await ev(() => buildings.length);
check(nb >= 7, `houses bought through purchaseCurrentPad() (${nb} buildings)`);
// wait for the road planner to pick the new stages up (it refreshes on its own timer)
const okNet = await page.waitForFunction(() => {
  const n = cityWorldRuntime?.stageRoads?.userData?.v86StageNetwork;
  return !!n && (n.stageIds?.length || 0) >= 6;
}, null, { timeout: 60000, polling: 500 }).then(() => true, () => false);
const network = await net();
console.log('stage network before/after:', JSON.stringify(before6), JSON.stringify(network));
check(okNet && network.stageIds.length >= 6, `stage-road network covers the new houses (${network?.stageIds?.length} stages)`);
const stageAfter6 = (await roadSnapshot()).stage;
check(diff(stageBefore6, stageAfter6).created > 0, `a real road change (6 new stage houses) still rebuilds stage roads (${JSON.stringify(diff(stageBefore6, stageAfter6))})`);
check((network.kinds.CORNER || 0) > 0, `stage-road CORNER pieces exist (kinds ${JSON.stringify(network.kinds)})`);
check((network.kinds.T || 0) + (network.kinds.X || 0) > 0, 'stage-road T or X junction exists once several houses share a stem');

geo = await geometryChecks();
console.log('geometry (after houses):', JSON.stringify({ ...geo, driveways: geo.driveways.map((d) => d.index + ':' + d.gap).join(' ') }));
check(geo.fleetOverlaps === 0 && geo.conveyorOverlaps === 0, `still no overlap with the fleet yard (${geo.fleetOverlaps}) / conveyor (${geo.conveyorOverlaps}) after the new roads`);
check(geo.driveways.length >= 7, `driveway check covers every building (${geo.driveways.length})`);
for (const d of geo.driveways) check(d.gap < 0.5, `building ${d.index}: a road mesh reaches it (edge gap ${d.gap} m)`);

// ---- 3. no network rebuild: control (nothing happens), then an unrelated base upgrade, then idle ticks.
// Judged on uuids (mesh objects rebuilt?) AND on the laid-out geometry (did the roads really change?).
const snapA = await roadSnapshot();
await page.waitForTimeout(800);
const snap0 = await roadSnapshot();
const control = diff(snapA.meshes, snap0.meshes);
check(control.destroyed === 0 && control.created === 0 && snapA.union === snap0.union, `control: no road churn without any action (${JSON.stringify(control)})`);
const unrelated = await ev(() => {
  const key = (BASE_CONFIG || []).map((c) => c.key).find((k) => { const c = baseConfig(k); return c && stageIndex >= c.unlock && baseLevel(k) < 3; });
  if (!key) return { key: null };
  const before = baseLevel(key); buyBaseUpgrade(key);
  if (typeof refreshInfrastructureWorldV37 === 'function') refreshInfrastructureWorldV37();
  return { key, before, after: baseLevel(key) };
});
console.log('unrelated upgrade:', JSON.stringify(unrelated));
check(unrelated.key && unrelated.after === unrelated.before + 1, `an unrelated base upgrade really happened (${unrelated.key} ${unrelated.before} -> ${unrelated.after})`);
await page.waitForTimeout(800);
let prev = await roadSnapshot(); // right after the upgrade; the idle ticks below are compared to this
const upgradeChurn = diff(snap0.meshes, prev.meshes);
const sameLayout = JSON.stringify(snap0.layout) === JSON.stringify(prev.layout);
console.log('upgrade churn:', JSON.stringify({ ...upgradeChurn, unionKept: snap0.union === prev.union, sameLayout, meshesBefore: snap0.meshes.length, meshesAfter: prev.meshes.length }));
// hard check since 2026-10-03 (v161 guards in refreshAccessRoads / v86 refresh, see CHANGELOG_V161.md); a changed layout is still reported, never counted as churn
if (!sameLayout) console.log(`NOTE: the base upgrade (${unrelated.key}) changed the laid-out roads (${upgradeChurn.destroyed} meshes replaced, layout differs): not counted as churn, the new building may be a legitimate obstacle`);
else check(upgradeChurn.destroyed === 0 && upgradeChurn.created === 0 && snap0.union === prev.union, `an unrelated base upgrade (${unrelated.key}) does not rebuild the road network (destroyed ${upgradeChurn.destroyed}, created ${upgradeChurn.created}, unified surface kept ${snap0.union === prev.union})`);
const churn = [];
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(2200);
  const cur = await roadSnapshot();
  churn.push({ meshes: diff(prev.meshes, cur.meshes), stage: diff(prev.stage, cur.stage), unionSame: prev.union === cur.union });
  prev = cur;
}
console.log('idle churn:', JSON.stringify(churn));
check(snap0.stage.length > 0, `stage-road meshes exist before the idle ticks (${snap0.stage.length})`);
check(churn.every((c) => c.meshes.destroyed === 0 && c.meshes.created === 0 && c.stage.destroyed === 0 && c.stage.created === 0), 'idle ticks: road meshes not destroyed or created');
check(churn.every((c) => c.unionSame), 'idle ticks: unified road surface layer not rebuilt');

// ---- 3b. upgrades 1 -> 5 of every main-line stage re-lay 0 road meshes (2026-10-06 (9): the road planners read a level-independent box per stage building, see planBoxV161 in rebuildStatic)
{
  const fin = () => ev(() => { for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; } for (let k = growingMeshes.length - 1; k >= 0; k--) { growingMeshes[k].mesh.visible = true; growingMeshes[k].mesh.scale.set(1, 1, 1); growingMeshes.splice(k, 1); } });
  const uu = () => ev(() => { const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], o = []; scene.traverse((m) => { if (m.isMesh && m.userData && tags.some((t) => m.userData[t])) o.push(m.uuid); }); return o; });
  const same = (a, b) => { const A = new Set(a), B = new Set(b); return a.length === b.length && a.every((x) => B.has(x)) && b.every((x) => A.has(x)); };
  const settleU = async (min = 3, max = 45) => { let prevU = await uu(), n = 0; for (let k = 0; k < max; k++) { await page.waitForTimeout(900); const now = await uu(); if (same(prevU, now)) { if (++n >= min) return now; } else n = 0; prevU = now; } return prevU; };
  await ev(() => { stageIndex = 16; money = 1e12; planks = 1e7; concrete = 1e6; metal = 1e6; });
  // the rest of the stages one by one (spawning 16 at once makes the planner re-lay the whole map and logs "[road union]", see tests/house-door.test.mjs): each new stage paves its own road, then the planner settles
  for (let i = 0; i < 16; i++) {
    const had = await ev((i) => buildings.some((b) => b.index === i), i);
    if (had) continue;
    await ev((i) => { spawnBuilding(i, 1, { grow: false }); }, i);
    await fin();
    await settleU(2, 25);
  }
  await ev(() => { for (const b of buildings) b.level = 1; });
  const lv1 = await ev(() => buildings.map((b) => `${b.index}:${b.level}`).join(','));
  let beforeU = await settleU(6, 90);
  const rounds = [];
  for (let L = 2; L <= 5; L++) {
    // the game has two construction slots: upgrade two buildings, let the planner see the upgrade sites stand (the new meshes are invisible), finish them, next pair
    for (let k = 0; k < 16; k += 2) {
      await ev((k) => { money = 1e12; planks = 1e7; concrete = 1e6; metal = 1e6; for (const i of [k, k + 1]) { const b = buildings.find((x) => x.index === i); if (b) upgradeBuilding(b, { fromQueue: true }); } }, k);
      await page.waitForTimeout(1400);
      await fin();
    }
    const afterU = await settleU(3, 45);
    rounds.push({ L, before: beforeU.length, after: afterU.length, same: same(beforeU, afterU), destroyed: beforeU.filter((x) => !new Set(afterU).has(x)).length });
    beforeU = afterU;
  }
  const lvs = await ev(() => buildings.map((b) => b.level));
  console.log('3b: stages at level 1:', lv1, '| after the rounds:', JSON.stringify(lvs), '| rounds', JSON.stringify(rounds));
  check(lvs.length >= 16 && lvs.every((l) => l === 5), `3b: all ${lvs.length} main-line stages went 1 -> 5 through upgradeBuilding`);
  check(rounds.length === 4 && rounds.every((r) => r.same), `3b: upgrades 1 -> 5 of all 16 main-line stages re-lay 0 road meshes (uuid sets identical after every round: ${rounds.map((r) => r.before + '>' + r.after + ' (' + r.destroyed + ' re-laid)').join(', ')}; before the fix the shop alone re-laid 27 of 41 on every step)`);
}

// ---- 4. console
const union = g.errors.filter((e) => e.includes('[road union]'));
check(union.length === 0, `no "[road union]" console error during the whole run (${union.length})`);
check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${JSON.stringify([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
