// Physics + design checks for every catalogued building (2026-10-05 (4); the catalogue is docs/BUILDINGS_V161.md, the probe is tools/lib/buildings-probe-v161.mjs,
// the picture tool is tools/showcase-v161.mjs). ONE browser launch on a late-game save (all 16 stages built at level 5, every staged unlock, all districts).
//   A. every STAGES building x levels (houses 1..10, the rest 1/5/10) built by the game's real builder chain (createBuildingMesh), registered in the real v83
//      collision registry (registerRoot, the call rebuildStatic makes) and measured with the 0.1 m raster of the probe: nothing floating or sunk (|min y| <= 5 cm),
//      the collider covers the wall footprint (>= 90 %), extends at most 1.0 m beyond it, the player walked at the centre from 8 directions never gets inside
//      (game's resolvePlayerCircleCollisions with the building's own colliders), door vs driveway (houses).
//   B. the live world: houses carry real wall boxes in the registry (the whole-mesh box keeps placement/camera only), the door and the upgrade pad of a built house
//      are standing places (not inside any collider), every pickup / drop-off / pad point, and the live industrial / market / district groups.
//   C. a real upgrade of house 0 (upgradeBuilding) keeps its colliders and re-lays 0 road meshes.
// IN SCOPE (hard checks): the house family = stage 0/1 at every level, the neighbourhood mini house. Everything else in the catalogue is measured and printed as
//   `KNOWN ISSUE:` (exit 0) - those lines are the backlog of the next building families. SHOTS_DIR=<dir> writes front + iso pictures of house levels 1/3/5/10.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, check } from './lib/harness.mjs';
import { installProbe } from '../tools/lib/buildings-probe-v161.mjs';

const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 8000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
await ev(installProbe);
const known = [];
const issue = (msg) => { known.push(msg); console.log('KNOWN ISSUE: ' + msg); };
const info = await ev(() => __BLD_PROBE__.stageInfo());

// ------------------------------------------------------------------------------------------------ A. stage buildings, isolated
const rows = [];
for (let i = 0; i < info.n; i++) {
  const house = info.arch[i] === 'house';
  const levels = house ? Array.from({ length: info.maxLevel }, (_, k) => k + 1) : [1, 5, 10];
  for (const L of levels) {
    const shots = SHOTS && house && [1, 3, 5, 10].includes(L) ? ['front', 'iso'] : [];
    const r = await ev(({ i, L, shots }) => {
      const P = __BLD_PROBE__, m = P.stageMesh(i, L);
      try {
        const legacyEntry = P.registerStage(m, i);
        const all = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === m);
        const meas = P.measure(m, P.ownEntries(m));
        meas.door = P.doorInfo(m, i);
        meas.gold = m.userData.goldTierV161 || 0;
        meas.goldMesh = m.children.some((c) => c.name === 'houseGoldV161');
        meas.goldTris = (() => { const c = m.children.find((x) => x.name === 'houseGoldV161'); return c ? c.geometry.index.count / 3 : 0; })();
        meas.legacyPlayer = legacyEntry ? !!legacyEntry.flags.player : null;
        meas.legacyPlacement = legacyEntry ? !!legacyEntry.flags.placement : null;
        meas.legacyCamera = legacyEntry ? !!legacyEntry.flags.camera : null;
        meas.walls = all.filter((e) => String(e.label).includes(':wall') && e.flags.player && e.flags.agent && !e.flags.placement).length;
        meas.wallYaw = all.find((e) => String(e.label).includes(':wall'))?.yaw;
        meas.meshYaw = m.rotation.y;
        meas.front = !!m.userData.frontV161;
        let out = null;
        if (shots.length) { const sh = P.shoot(m, shots); out = sh.shots; }
        return { meas, shots: out };
      } finally { P.dropMesh(m); }
    }, { i, L, shots });
    if (r.shots) for (const [v, url] of Object.entries(r.shots)) fs.writeFileSync(path.join(SHOTS, `bld-stage${i}-L${L}-${v}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    rows.push({ i, L, arch: info.arch[i], house, ...r.meas });
  }
}
// the old house for the draw-call comparison (same builder chain with the new house switched off)
const old = await ev(() => {
  const P = __BLD_PROBE__, out = {};
  BuildingsV161.enabled = false;
  for (const i of [0, 1]) for (const L of [1, 3, 5]) { const m = P.stageMesh(i, L); out[`${i}:${L}`] = P.measure(m, [], { sweep: false }).meshes; P.dropMesh(m); }
  BuildingsV161.enabled = true;
  return out;
});
const mini = await ev(() => {
  const P = __BLD_PROBE__, m = P.miniMesh(0xe0bb91, 0x8b4c39);
  try { return P.measure(m, P.miniEntries()); } finally { P.dropMesh(m); }
});
rows.push({ i: -1, L: 1, arch: 'mini-house', house: true, ...mini });

const label = (r) => (r.i < 0 ? 'mini house' : `stage ${r.i} (${r.arch}) L${r.L}`);
const hard = rows.filter((r) => r.house);
console.log(`measured ${rows.length} building meshes: ${hard.length} in the house family (hard checks), ${rows.length - hard.length} others (KNOWN ISSUE lines)`);
check(rows.length >= 16 * 3 + 14, `every stage x level measured (${rows.length})`);

// --- hard checks, house family
const bad = (pred) => hard.filter((r) => !pred(r)).map(label);
let b;
b = bad((r) => r.minY >= -0.05 && r.minY <= 0.05);
check(b.length === 0, `house family: nothing floating or sunk, min y within 5 cm of the ground for every level (${b.length} bad ${J(b.slice(0, 4))}; min y range ${Math.min(...hard.map((r) => r.minY))}..${Math.max(...hard.map((r) => r.minY))})`);
b = bad((r) => r.overlap !== null && r.overlap >= 0.9);
check(b.length === 0, `house family: colliders cover >= 90 % of the wall footprint (${b.length} bad ${J(b.slice(0, 4))}; worst ${Math.min(...hard.map((r) => r.overlap))})`);
b = bad((r) => r.outsideMax <= 1.0);
check(b.length === 0, `house family: no collider extends more than 1.0 m beyond the walls (worst ${Math.max(...hard.map((r) => r.outsideMax))} m; mesh-wide AABB before: 1.01 m / 4.6 m2 outside)`);
b = bad((r) => r.sweepReached === 0);
check(b.length === 0, `house family: the player walked at the centre from 8 directions never stands inside the building (${b.length} bad ${J(b.slice(0, 4))})`);
b = bad((r) => r.i < 0 || (r.door && r.door.dot >= 0.95 && r.door.dist <= r.door.radius + 1.5));
check(b.length === 0, `house family: the door faces its driveway and is within radius + 1.5 m of its end (${b.length} bad; door ${J(rows.find((r) => r.i === 0 && r.L === 1).door)})`);
const houses = rows.filter((r) => r.i >= 0 && r.house);
b = houses.filter((r) => !(r.walls >= 1 && r.legacyPlayer === false && r.legacyPlacement === true && r.legacyCamera === true && r.front)).map(label);
check(b.length === 0, `houses: wall boxes are the player/agent colliders, the whole-mesh box keeps placement + camera only (${b.length} bad ${J(b.slice(0, 3))})`);
b = houses.filter((r) => Math.abs((r.wallYaw ?? 0) - r.meshYaw) > 1e-6).map(label);
check(b.length === 0, `house wall boxes are rotated with the mesh (yaw ${J(houses.slice(0, 2).map((r) => [r.wallYaw, r.meshYaw]))})`);
for (const s of [0, 1]) {
  const t = houses.filter((r) => r.i === s).sort((p, q) => p.L - q.L).map((r) => r.tris);
  check(t.slice(0, 5).every((v, k) => k === 0 || v > t[k - 1]), `house ${s}: the silhouette grows with every level 1..5 (triangles ${t.slice(0, 5)})`);
  const gt = houses.filter((r) => r.i === s && r.L >= 6).sort((p, q) => p.L - q.L);
  check(gt.every((r) => r.gold === r.L && r.goldMesh) && gt.every((r, k) => k === 0 || r.goldTris >= gt[k - 1].goldTris) && gt[4].goldTris > gt[3].goldTris, `house ${s}: gold tiers 6..10 carry the tier and more gold with every level, the crown comes at 10 (gold triangles ${gt.map((r) => r.goldTris)})`);
}
const newMax = Math.max(...houses.map((r) => r.meshes)), oldMin = Math.min(...Object.values(old));
check(newMax <= 20 && newMax <= oldMin, `house draw calls: <= ${newMax} meshes per house at any level (old builder ${J(old)})`);
check(mini.meshes <= 5, `mini house: ${mini.meshes} meshes (old 5)`);

// --- known issues, everything else
for (const r of rows.filter((x) => !x.house)) {
  if (r.minY < -0.05 || r.minY > 0.05) issue(`${label(r)}: floating or sunk, min y ${r.minY}`);
  if (r.overlap !== null && r.overlap < 0.9) issue(`${label(r)}: collider covers only ${Math.round(r.overlap * 100)} % of the wall footprint`);
  if (r.outsideMax > 1.0 && (r.L === 1 || r.L === 5)) issue(`${label(r)}: collider (whole-mesh box) extends ${r.outsideMax} m beyond the walls (${r.outside} m2 of invisible wall)`);
  if (r.sweepReached > 0) issue(`${label(r)}: the player can walk into the building from ${r.sweepReached} of 8 directions`);
}
const kinds = {};
for (const r of rows.filter((x) => !x.house)) { (kinds[r.i] = kinds[r.i] || []).push(r); }
check(Object.values(kinds).every((rs) => rs.every((r) => r.sweepReached === 0)), 'other stage buildings: the player cannot walk into any of them (whole-mesh boxes cover the walls)');

// ------------------------------------------------------------------------------------------------ B. live world
const built = await ev(() => __BLD_PROBE__.buildOut());
console.log('build-out', built.join(' | '));
await page.waitForTimeout(4000);
await ev(() => __BLD_PROBE__.finishGrowth());
await page.waitForTimeout(2500);
const live = await ev(() => {
  const P = __BLD_PROBE__, reg = __TYCOON_V83_COLLISIONS__.registry, out = { houses: [] };
  for (const idx of [0, 1]) {
    const e = buildings.find((x) => x.index === idx), m = e.mesh, own = [...reg.values()].filter((x) => x.owner === m);
    let door = null; m.traverse((o) => { if (o.userData?.v161Door) door = o; });
    const w = new THREE.Vector3(); door.getWorldPosition(w);
    const f = m.userData.frontV161, px = w.x + f.x * 0.65, pz = w.z + f.z * 0.65;
    const pad = e.upgradePad?.pos;
    out.houses.push({
      idx, level: e.level, walls: own.filter((x) => String(x.label).includes(':wall')).length, legacyPlayer: own.filter((x) => !String(x.label).includes(':wall')).map((x) => !!x.flags.player),
      doorFree: P.blockedAt(px, pz), padFree: pad ? P.blockedAt(pad.x, pad.z) : null, padDist: pad ? +Math.hypot(pad.x - e.pos.x, pad.z - e.pos.z).toFixed(2) : null,
    });
  }
  out.points = P.workPoints().map((p) => ({ ...p, b: P.blockedAt(p.x, p.z) }));
  return out;
});
for (const h of live.houses) {
  check(h.walls >= 1 && h.legacyPlayer.every((v) => v === false), `live house ${h.idx} (level ${h.level}): ${h.walls} wall boxes in the registry, the old whole-mesh box is not a player collider`);
  check(!h.doorFree.hit, `live house ${h.idx}: the step in front of the door is a standing place (${J(h.doorFree)})`);
  check(h.padFree && h.padFree.moved <= 0.25, `live house ${h.idx}: the upgrade pad (${h.padDist} m from the centre) is reachable - a player circle on its centre is pushed at most 25 cm (${J(h.padFree)})`);
}
console.log(`work points checked: ${live.points.length} (${live.points.map((p) => p.id).join(', ')})`);
const houseBad = live.points.filter((p) => p.family === 'house' && p.b.moved > 0.25);
check(houseBad.length === 0, `house upgrade pads are reachable: not deeper than 25 cm inside a collider (${J(houseBad)})`);
for (const p of live.points.filter((x) => x.family !== 'house' && x.b.hit)) issue(`${p.id} @${p.x},${p.z} is inside a collider (${p.b.by.join(', ')}; the player circle would be pushed ${p.b.moved} m)`);

// live groups (named by the owning code; positions from the late-game survey)
const targets = [
  { id: 'sawmill', name: 'v161SawmillMill' }, { id: 'fleet-yard', name: 'v116FleetYard' }, { id: 'frame-workshop', name: 'v161FrameWorkshop' },
  { id: 'concrete-plant', expr: 'concretePlant.group' }, { id: 'metal-yard', expr: 'metalPlant.group' }, { id: 'market-plaza', name: 'marketPlazaV116' },
  ...['team', 'fleet', 'tenders', 'operations', 'meta', 'bonus', 'exchange'].map((k) => ({ id: 'market-stall-' + k, name: 'marketStallV116_' + k })),
  { id: 'manual-mine-concrete', name: 'manualMineV119_concrete' }, { id: 'manual-mine-metal', name: 'manualMineV119_metal' },
];
const liveRows = await ev((targets) => {
  const P = __BLD_PROBE__, out = [];
  for (const t of targets) {
    const root = t.name ? P.liveByName(t.name) : P.liveByExpr(t.expr);
    if (!root || !root.isObject3D) { out.push({ id: t.id, missing: true }); continue; }
    out.push({ id: t.id, ...P.measureLive(root) });
  }
  return out;
}, targets);
console.log('live groups:', liveRows.map((r) => (r.missing ? `${r.id}: missing` : `${r.id}: meshes ${r.meshes}, min y ${r.minY}, footprint ${r.footprintArea} m2, collider ${r.colliderArea} m2, overlap ${r.overlap}, outside max ${r.outsideMax} m, walk-in ${r.sweepReached ?? '-'}/8`)).join('\n  '));
check(liveRows.filter((r) => !r.missing).length >= 12, `live groups found and measured (${liveRows.filter((r) => !r.missing).length} of ${liveRows.length})`);
for (const r of liveRows.filter((x) => !x.missing)) {
  if (r.minY < -0.05 || r.minY > 0.05) issue(`${r.id}: floating or sunk, min y ${r.minY}`);
  if (r.footprintArea > 1 && r.overlap !== null && r.overlap < 0.9) issue(`${r.id}: collider covers only ${Math.round(r.overlap * 100)} % of the wall footprint (${r.uncovered} m2 uncovered)`);
  if (r.outsideMax > 1.0) issue(`${r.id}: collider extends ${r.outsideMax} m beyond the walls (${r.outside} m2 of invisible wall)`);
  if (r.sweepReached > 0) issue(`${r.id}: the player can walk into it from ${r.sweepReached} of 8 directions`);
}

// ------------------------------------------------------------------------------------------------ C. a real upgrade keeps colliders, re-lays no road
// house 0 is level 5 in the late save: the next real upgrade is the first gold tier (6). The road signature uses min(level, 5), so no road may be re-laid.
const roadUuids = () => ev(() => { const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], o = []; scene.traverse((m) => { if (m.isMesh && m.userData && tags.some((t) => m.userData[t])) o.push(m.uuid); }); return o; });
let before = await roadUuids();
for (let k = 0; k < 20; k++) { await page.waitForTimeout(1200); const now = await roadUuids(); const same = now.length === before.length && now.every((x, n) => x === before[n]); before = now; if (same) break; } // the planner has settled
await ev(() => { money = 5e8; planks = 5000; concrete = 500; metal = 500; const e = buildings.find((x) => x.index === 0); upgradeBuilding(e, { fromQueue: true }); });
await page.waitForTimeout(400);
await ev(() => { for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; } for (let k = growingMeshes.length - 1; k >= 0; k--) { growingMeshes[k].mesh.visible = true; growingMeshes[k].mesh.scale.set(1, 1, 1); growingMeshes.splice(k, 1); } });
await page.waitForTimeout(3500); // no explicit registry rebuild here: the game's own completion path has to produce the colliders
const up = await ev(() => {
  const e = buildings.find((x) => x.index === 0), reg = __TYCOON_V83_COLLISIONS__.registry, own = [...reg.values()].filter((x) => x.owner === e.mesh);
  return { level: e.level, houseMesh: !!e.mesh.userData.v161House, gold: e.mesh.userData.goldTierV161 || 0, walls: own.filter((x) => String(x.label).includes(':wall')).length, legacyPlayer: own.filter((x) => !String(x.label).includes(':wall')).map((x) => !!x.flags.player), meshes: (() => { let n = 0; e.mesh.traverse((o) => { if (o.isMesh) n++; }); return n; })() };
});
const after = await roadUuids();
const A = new Set(before), B = new Set(after);
check(up.level === 6 && up.houseMesh && up.gold === 6, `house 0 upgraded through upgradeBuilding to level ${up.level}: new house mesh with the gold tier ${up.gold} (${up.meshes} meshes)`);
check(up.walls >= 1 && up.legacyPlayer.every((v) => v === false), `after the upgrade the new mesh has its wall colliders (${up.walls}) and no whole-mesh player box (${J(up)})`);
check(before.every((x) => B.has(x)) && after.every((x) => A.has(x)), `the upgrade re-laid 0 road meshes (${before.length} before, ${after.length} after)`);

console.log(`\n${known.length} KNOWN ISSUE lines (the backlog of the next building families, see docs/BUILDINGS_V161.md)`);
check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
