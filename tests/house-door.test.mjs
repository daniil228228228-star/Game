// House door vs driveway (user, iPhone test: "вход в дом с другой стороны от въезда к нему").
// Every builder puts door/porch/apron on local +Z; the driveway of a main-line building arrives from the hub side
// (stageAccessAxisV92 -> stageRoadEndpointV367, last point of __TYCOON_STAGE_ROADS__.centerline(i)). createBuildingMesh()
// now yaws the whole building so +Z faces that side. One browser launch, real scene numbers:
//   1. for EVERY main-line stage (all STAGES entries) x EVERY level 1..MAX_BUILDING_LEVEL: the mesh's front direction
//      (world) vs the unit vector building -> driveway start: dot >= 0.99 (the legacy +Z orientation is printed for comparison),
//   2. the real door mesh of the house stages (userData.v161Door): angle to the driveway and door-to-driveway distance,
//      legacy (unrotated) vs now; the door must be closer than before and within radius + 1.5 m of the driveway end,
//   3. factory chimneys (stackTops -> smokeTops) are rotated with the building: smokeTops == world position of the stack tops,
//   4. roads are not re-laid by the yaw / by an upgrade: road mesh uuids identical before/after upgrading a house 1 -> 3
//      (and the upgraded mesh keeps its facing).
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';

const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => { money = 999999999; planks = 999999; concrete = 999999; metal = 999999; });

const finish = () => ev(() => {
  for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; }
  for (let i = growingMeshes.length - 1; i >= 0; i--) if (!growingMeshes[i]?.entry?.underConstruction) { growingMeshes[i].mesh.visible = true; growingMeshes[i].mesh.scale.set(1, 1, 1); growingMeshes.splice(i, 1); }
});
// the real purchase path for the first houses (so stage roads exist); the other stages are measured on detached meshes at their real
// buildingPosition() (spawning 16 buildings at once makes the road planner re-lay the whole map under the measurement)
for (let i = 0; i < 4; i++) { await ev(() => { purchaseCurrentPad(); }); await page.waitForTimeout(150); await finish(); await page.waitForTimeout(150); }
await page.waitForFunction(() => (cityWorldRuntime?.stageRoads?.userData?.v86StageNetwork?.stageIds?.length || 0) >= 3, null, { timeout: 60000, polling: 500 }).catch(() => {});
await page.waitForTimeout(2500);

const roadUuids = () => ev(() => {
  const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], out = [];
  scene.traverse((o) => { if (o.isMesh && o.userData && tags.some((t) => o.userData[t])) out.push(o.uuid); });
  return out;
});
// wait until the road planner has settled (3 identical snapshots 1.2 s apart) so the later diff only sees the upgrade
let settled = JSON.stringify(await roadUuids()), calm = 0;
for (let k = 0; k < 25 && calm < 3; k++) { await page.waitForTimeout(1200); const now = JSON.stringify(await roadUuids()); calm = now === settled ? calm + 1 : 0; settled = now; }
const roadsBefore = await roadUuids();

const data = await ev(() => {
  const V = (x, z) => ({ x, z });
  const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return V(x / l, z / l); };
  const dot = (a, b) => a.x * b.x + a.z * b.z;
  const rows = [], levelRows = [], doors = [], smoke = [];
  for (let i = 0; i < STAGES.length; i++) {
    const entry = buildings.find((b) => b.index === i);
    const pos = buildingPosition(i);
    const axis = stageAccessAxisV92(i);
    const bay = stageRoadEndpointV367(i);
    let cl = null;
    try { const c = window.__TYCOON_STAGE_ROADS__?.centerline?.(i) || []; cl = c.length ? c[c.length - 1] : null; } catch (_) {}
    const start = cl || bay;
    const toDrive = unit(start.x - pos.x, start.z - pos.z);
    // every level, straight from the builder
    for (let L = 1; L <= MAX_BUILDING_LEVEL; L++) {
      const m = createBuildingMesh(STAGES[i], L);
      m.updateMatrixWorld(true);
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
      levelRows.push({ i, L, arch: STAGES[i].archetype, dotNow: +dot(unit(f.x, f.z), toDrive).toFixed(4), dotLegacy: +dot(V(0, 1), toDrive).toFixed(4), hasFront: !!m.userData.frontV161 });
      disposeObject3D(m);
    }
    rows.push({ i, arch: STAGES[i].archetype, axis: [axis.x, axis.z], driveEnd: [+start.x.toFixed(2), +start.z.toFixed(2)], fromRoadApi: !!entry && !!cl, gapBayToRoadEnd: +Math.hypot(bay.x - start.x, bay.z - start.z).toFixed(2) });
    // built stages: the live mesh; the others: a detached mesh placed exactly where spawnBuilding() would put it
    const mesh = entry ? entry.mesh : createBuildingMesh(STAGES[i], 1);
    if (!entry) mesh.position.set(pos.x, 0, pos.z);
    mesh.updateMatrixWorld(true);
    let door = null;
    mesh.traverse((o) => { if (o.userData?.v161Door) door = o; });
    if (door) {
      const w = new THREE.Vector3(); door.getWorldPosition(w);
      const legacy = { x: pos.x + door.position.x, z: pos.z + door.position.z }; // same offset without the yaw
      const r = entry ? buildingCollisionRadius(entry) : stageAccessRadiusV92(i);
      doors.push({
        i, level: entry ? entry.level : 1, radius: +r.toFixed(2),
        distNow: +Math.hypot(w.x - start.x, w.z - start.z).toFixed(2), distLegacy: +Math.hypot(legacy.x - start.x, legacy.z - start.z).toFixed(2),
        dotNow: +dot(unit(w.x - pos.x, w.z - pos.z), toDrive).toFixed(4), dotLegacy: +dot(unit(legacy.x - pos.x, legacy.z - pos.z), toDrive).toFixed(4),
      });
    }
    const tops = mesh.userData.stackTops;
    if (tops && tops.length) {
      const st = entry ? entry.smokeTops : smokeTopsFor(mesh, pos);
      let worst = 0;
      tops.forEach((t, k) => { const w = mesh.localToWorld(t.clone()); const s = st[k]; worst = Math.max(worst, Math.hypot(w.x - s.x, w.z - s.z)); });
      smoke.push({ i, worst: +worst.toFixed(4) });
    }
    if (!entry) disposeObject3D(mesh);
  }
  return { rows, levelRows, doors, smoke, n: STAGES.length, maxL: MAX_BUILDING_LEVEL };
});

console.log('stages checked:', data.rows.length, '| level meshes:', data.levelRows.length);
console.log('driveway end source (road = last point of the real stage-road centerline of a built house; bay = stageRoadEndpointV367, the same point for built stages):', data.rows.map((r) => `${r.i}:${r.fromRoadApi ? 'road' : 'bay'}(gap ${r.gapBayToRoadEnd})`).join(' '));
const bad = data.levelRows.filter((r) => !(r.dotNow >= 0.99));
console.log('front/driveway dot, now vs legacy (+Z), per stage (level 1):', data.levelRows.filter((r) => r.L === 1).map((r) => `${r.i}:${r.arch} ${r.dotNow}/${r.dotLegacy}`).join(' | '));
check(data.levelRows.length === data.n * data.maxL && data.rows.length === data.n && data.rows.some((r) => r.fromRoadApi), `every stage x level measured (${data.n} stages x ${data.maxL} levels = ${data.levelRows.length})`);
check(data.levelRows.every((r) => r.hasFront), 'every main-line mesh carries frontV161');
check(bad.length === 0, `door/front faces the driveway for all stages and levels (dot >= 0.99; ${bad.length} bad ${JSON.stringify(bad.slice(0, 4))})`);
const legacyBad = data.levelRows.filter((r) => r.L === 1 && r.dotLegacy < 0.5).length;
console.log(`legacy +Z orientation faced away/sideways from the driveway for ${legacyBad} of ${data.levelRows.filter((r) => r.L === 1).length} stages (dot < 0.5)`);
check(data.doors.length >= 2, `house stages with a door mesh measured (${data.doors.length})`);
for (const d of data.doors) {
  console.log(`house stage ${d.i} (level ${d.level}): door->driveway end ${d.distLegacy} m -> ${d.distNow} m, door direction dot ${d.dotLegacy} -> ${d.dotNow}`);
  check(d.dotNow >= 0.95, `house ${d.i}: door direction points at the driveway (dot ${d.dotNow})`);
  check(d.distNow <= d.distLegacy + 1e-6 && d.distNow <= d.radius + 1.5, `house ${d.i}: door is within radius+1.5 m of the driveway end and not farther than before (${d.distNow} m, radius ${d.radius})`);
}
check(data.smoke.length >= 3 && data.smoke.every((s) => s.worst < 0.01), `chimney smoke anchors follow the yawed building (${JSON.stringify(data.smoke.slice(0, 4))})`);

// roads: the yaw / upgrades must not re-lay anything
const mid = await roadUuids();
await ev(() => { const e = buildings.find((b) => b.index === 0); upgradeBuilding(e, { fromQueue: true }); });
await page.waitForTimeout(300); await finish(); await page.waitForTimeout(300);
await ev(() => { const e = buildings.find((b) => b.index === 0); upgradeBuilding(e, { fromQueue: true }); });
await page.waitForTimeout(300); await finish(); await page.waitForTimeout(2500);
const after = await ev(() => {
  const e = buildings.find((b) => b.index === 0);
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(e.mesh.quaternion);
  const pos = buildingPosition(0), c = window.__TYCOON_STAGE_ROADS__.centerline(0), end = c[c.length - 1];
  const l = Math.hypot(end.x - pos.x, end.z - pos.z) || 1;
  return { level: e.level, dot: +((f.x * (end.x - pos.x) + f.z * (end.z - pos.z)) / l).toFixed(4) };
});
const roadsAfter = await roadUuids();
const A = new Set(mid), B = new Set(roadsAfter);
const diff = { destroyed: mid.filter((x) => !B.has(x)).length, created: roadsAfter.filter((x) => !A.has(x)).length };
console.log('road meshes before/after upgrading house 0 to level', after.level, ':', JSON.stringify({ before: mid.length, after: roadsAfter.length, ...diff }), '| facing after upgrade (dot):', after.dot);
check(after.level >= 3, `house 0 upgraded to level ${after.level}`);
check(after.dot >= 0.99, `the upgraded house mesh still faces its driveway (dot ${after.dot})`);
check(diff.destroyed === 0 && diff.created === 0, `upgrading a house re-lays no road (destroyed ${diff.destroyed}, created ${diff.created} of ${mid.length})`);
check(roadsBefore.length > 0, `road meshes exist (${roadsBefore.length})`);
check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${JSON.stringify([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();

