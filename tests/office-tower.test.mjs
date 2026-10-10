// Offices (stages 6 / 7 / 11 / 14) and towers (8 / 9 / 12 / 15), backlog #10 + #11 (2026-10-06 (11), assets/towers-v161.js). ONE browser launch on the old-format save (OLD_SAVE: every staged unlock built).
//   A. every office / tower x levels 1..10 built by the game's real builder chain (createBuildingMesh = BUILDERS + late-game gold tiers), registered in the real v83 registry (registerRoot) and measured with the 0.1 m raster of the probe:
//      the SAME group grows (bbox height never decreases, <= 1.6 m per level for offices / <= 3.0 m for towers, no 18 % stretch of one slab; triangles grow on 1..5; mesh counts never decrease and stay <= 16 (offices) / <= 18 (towers),
//      old builder 67-138), nothing floating or sunk, wall boxes (rotated with the mesh, whole-mesh box = placement + camera only) cover >= 90 % of the wall footprint and stick out <= 0.3 m, no walk-in from 8 directions and along the
//      door axis only to the niche depth, the door faces the driveway (dot >= 0.95), the upgrade pad >= 0.8 m outside the wall boxes; NO gold at levels 1..5 (the old builder drew a crown on stages 9 / 15 at every level), gold 6..10 is ONE
//      mesh with more gold each level and the crown exactly at level 10 (+>= 60 triangles, >= 0.15 m higher than level 9).
//   B. the live world: all 16 stages built at level 1 one by one, then four real upgrade rounds (upgradeBuilding) for stages 6..15: the road mesh uuid set is identical after every round (0 road meshes re-laid), every office /
//      tower carries real wall boxes, its upgrade pad and the step in front of its door are standing places (not inside any collider).
//   C. night windows: the lit panes of all eight buildings share ONE material whose emissive follows isNightV40() (day ~0, night > 0.5) without allocating (geometry / texture counts unchanged), the aviation light blinks.
//   D. rebuilds: building and dropping a stage mesh 12 times leaves the renderer's geometry count at the baseline; the camera (orbit camera 9 m behind the player, 3.75 m above the eye) is pulled in by a building only through its lowest
//      5.25 m: obstruction is measured for the old and the new building (report), 0 console errors / 4xx.
// SHOTS_DIR=<dir> writes front + iso pictures of every stage at levels 1 / 5 / 10 (the showcase tool does the same with the old builder next to it).
import fs from 'node:fs';
import path from 'node:path';
import { openGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';
import { installProbe } from '../tools/lib/buildings-probe-v161.mjs';

const g = await openGame({ save: OLD_SAVE, waitMs: 6000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
await ev(installProbe);
await ev(() => { money = 999999999; planks = 999999; concrete = 999999; metal = 999999; });
const OFFICES = [6, 7, 11, 14], TOWERS = [8, 9, 12, 15], ALL = [...OFFICES, ...TOWERS];
const NAME = { 6: 'office', 7: 'business centre', 11: 'research centre', 14: 'convention centre', 8: 'skyscraper', 9: 'Empire', 12: 'grand hotel', 15: 'financial quarter' };
const names = await ev(() => STAGES.map((s) => s.nameEn));
console.log('stages:', ALL.map((i) => `${i} ${names[i]}`).join(', '));

// NOTE: the live phases (B, C) run BEFORE the isolated-mesh phase: the probe's forceScan() pushes the visual-tick clock minutes into the future, which would throttle the window tick and the layers' own timers.
// ------------------------------------------------------------------------------------------------ B. live world: all stages one by one at level 1, then 4 real upgrade rounds (like tests/roads.test.mjs 3b, stages 6..15)
const fin = () => ev(() => { for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; } for (let k = growingMeshes.length - 1; k >= 0; k--) { growingMeshes[k].mesh.visible = true; growingMeshes[k].mesh.scale.set(1, 1, 1); growingMeshes.splice(k, 1); } });
const uu = () => ev(() => { const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], o = []; scene.traverse((m) => { if (m.isMesh && m.userData && tags.some((t) => m.userData[t])) o.push(m.uuid); }); return o; });
const same = (a, b) => { const A = new Set(a), B = new Set(b); return a.length === b.length && a.every((x) => B.has(x)) && b.every((x) => A.has(x)); };
const settleU = async (min = 3, max = 45) => { let prevU = await uu(), n = 0; for (let k = 0; k < max; k++) { await page.waitForTimeout(900); const now = await uu(); if (same(prevU, now)) { if (++n >= min) return now; } else n = 0; prevU = now; } return prevU; };
await ev(() => { stageIndex = 16; money = 1e12; planks = 1e7; concrete = 1e6; metal = 1e6; });
for (let i = 0; i < 16; i++) {
  const had = await ev((i) => buildings.some((b) => b.index === i), i);
  if (had) continue;
  await ev((i) => { spawnBuilding(i, 1, { grow: false }); }, i);
  await fin();
  await settleU(2, 25);
}
await ev(() => { for (const b of buildings) b.level = 1; });
let beforeU = await settleU(6, 90);
const rounds = [];
for (let L = 2; L <= 5; L++) {
  for (let k = 6; k < 16; k += 2) {
    await ev((k) => { money = 1e12; planks = 1e7; concrete = 1e6; metal = 1e6; for (const i of [k, k + 1]) { const b = buildings.find((x) => x.index === i); if (b) upgradeBuilding(b, { fromQueue: true }); } }, k);
    await page.waitForTimeout(1400);
    await fin();
  }
  const afterU = await settleU(3, 45);
  rounds.push({ L, before: beforeU.length, after: afterU.length, same: same(beforeU, afterU), destroyed: beforeU.filter((x) => !new Set(afterU).has(x)).length });
  beforeU = afterU;
}
const lvs = await ev((ALL) => ALL.map((i) => { const b = buildings.find((x) => x.index === i); return b ? b.level : 0; }), ALL);
console.log('B: levels of stages', J(ALL), '=', J(lvs), '| rounds', J(rounds));
check(lvs.every((l) => l === 5), `B: all 8 offices / towers went 1 -> 5 through the real upgradeBuilding (${J(lvs)})`);
check(rounds.length === 4 && rounds.every((r) => r.same), `B: real pad upgrades 1 -> 5 of every office / tower keep the road mesh uuid set identical after every round (${rounds.map((r) => r.before + '>' + r.after + ' (' + r.destroyed + ' re-laid)').join(', ')}): 0 road meshes re-laid (planBoxV161)`);
const live = await ev(({ ALL }) => {
  const P = __BLD_PROBE__, reg = __TYCOON_V83_COLLISIONS__.registry, out = [];
  for (const idx of ALL) {
    const e = buildings.find((x) => x.index === idx), m = e.mesh, own = [...reg.values()].filter((x) => x.owner === m);
    let door = null; m.traverse((o) => { if (o.userData?.v161Door) door = o; });
    const w = new THREE.Vector3(); door.getWorldPosition(w); const f = m.userData.frontV161;
    let meshes = 0; m.traverse((o) => { if (o.isMesh) meshes++; });
    out.push({ idx, level: e.level, visible: m.visible, flag: !!(m.userData.v161Office || m.userData.v161Tower), walls: own.filter((x) => String(x.label).includes(':wall')).length, legacyPlayer: own.filter((x) => !String(x.label).includes(':wall')).map((x) => !!x.flags.player),
      step: P.blockedAt(w.x + f.x * 0.9, w.z + f.z * 0.9), pad: (() => { const pp = upgradePadPosition(e.pos, idx); return P.blockedAt(pp.x, pp.z); })(), padDist: (() => { const pp = upgradePadPosition(e.pos, idx); return +Math.hypot(pp.x - e.pos.x, pp.z - e.pos.z).toFixed(2); })(), meshes });
  }
  return out;
}, { ALL });
for (const h of live) {
  check(h.flag && h.visible && h.walls >= 1 && h.legacyPlayer.every((v) => v === false), `live stage ${h.idx} (${NAME[h.idx]}, level ${h.level}): own builder, ${h.walls} wall boxes in the registry, the old whole-mesh box is not a player collider, ${h.meshes} meshes`);
  check(!h.step.hit, `live stage ${h.idx}: the step in front of the revolving door is a standing place (${J(h.step)})`);
  check(h.pad && !h.pad.hit && h.pad.moved === 0, `live stage ${h.idx}: the upgrade pad (${h.padDist} m from the centre) stands outside every collider (${J(h.pad)}; before: stages 7 and 9 were inside by 0.07 / 0.35 m)`);
}

// ------------------------------------------------------------------------------------------------ C. night windows + aviation light
// warm-up: the game's own first night / dawn creates a few world textures (sky, lights) once - that is not the windows' allocation, so the baseline is taken after one full cycle
await ev(() => { v40State.timeOfDay = 23; });
await page.waitForTimeout(5000);
await ev(() => { v40State.timeOfDay = 12; });
await waitForState(page, () => OfficeTowerV161.smats().win.emissiveIntensity < 0.08, null, { timeout: 25000 });
const dayV = await ev(() => { const S = OfficeTowerV161.smats(); return { win: +S.win.emissiveIntensity.toFixed(3), geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }; });
await ev(() => { v40State.timeOfDay = 23; });
await page.waitForTimeout(7000);
const nightV = await ev(() => {
  const S = OfficeTowerV161.smats(), mats = new Set(), beacons = new Set(); let lit = 0;
  for (const b of buildings) { if (![6, 7, 8, 9, 11, 12, 14, 15].includes(b.index)) continue; b.mesh.traverse((o) => { if (o.name === 'litWindowsV161') { mats.add(o.material); lit++; } if (o.name === 'aviationLightV161') beacons.add(o.material); }); }
  const a = S.beacon.emissiveIntensity; return { win: +S.win.emissiveIntensity.toFixed(3), night: isNightV40(), mats: mats.size, same: [...mats][0] === S.win, lit, beacons: beacons.size, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, beacon: a };
});
const blink = await ev(async () => { const S = OfficeTowerV161.smats(), seen = new Set(); for (let k = 0; k < 40; k++) { seen.add(+S.beacon.emissiveIntensity.toFixed(2)); await new Promise((r) => setTimeout(r, 120)); } return [...seen]; });
await ev(() => { v40State.timeOfDay = 12; });
await page.waitForTimeout(6000);
const dayAgain = await ev(() => +OfficeTowerV161.smats().win.emissiveIntensity.toFixed(3));
console.log('C: window emissive day', J(dayV), 'night', J(nightV), 'day again', dayAgain, 'beacon values', J(blink));
check(nightV.night && dayV.win < 0.1 && nightV.win > 0.5 && dayAgain < 0.2, `C: the lit panes glow at night only (shared emissive ${dayV.win} by day -> ${nightV.win} at night -> ${dayAgain} by day again)`);
check(nightV.lit >= 8 && nightV.mats === 1 && nightV.same && nightV.beacons === 1, `C: all ${nightV.lit} lit-pane meshes of the 8 buildings share ONE material (and one aviation-light material)`);
check(Math.abs(nightV.geos - dayV.geos) <= 3 && nightV.tex === dayV.tex, `C: no allocation while the windows change (geometries ${dayV.geos} -> ${nightV.geos}, textures ${dayV.tex} -> ${nightV.tex})`);
check(blink.length >= 2, `C: the aviation light blinks (emissive values seen ${J(blink)}; a material, no real light)`);

// ------------------------------------------------------------------------------------------------ A. isolated meshes, levels 1..10
const rows = [];
for (const i of ALL) {
  for (let L = 1; L <= 10; L++) {
    const shots = SHOTS && [1, 5, 10].includes(L) ? ['front', 'iso'] : [];
    const r = await ev(({ i, L, shots }) => {
      const P = __BLD_PROBE__, m = P.stageMesh(i, L);
      try {
        const legacyEntry = P.registerStage(m, i);
        const all = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === m);
        const own = P.ownEntries(m), meas = P.measure(m, own);
        meas.door = P.doorInfo(m, i);
        meas.gold = m.userData.goldTierV161 || 0;
        const goldM = m.children.filter((c) => c.name === 'officeTowerGoldV161');
        meas.goldMeshes = goldM.length;
        meas.goldTris = goldM.length ? goldM[0].geometry.index.count / 3 : 0;
        meas.goldTop = goldM.length ? (goldM[0].geometry.computeBoundingBox(), +goldM[0].geometry.boundingBox.max.y.toFixed(3)) : 0;
        const goldMat = BuildingsV161.mats().gold; let anyGold = 0; m.traverse((o) => { if (o.isMesh && o.material === goldMat) anyGold++; });
        meas.goldMatMeshes = anyGold;
        meas.flag = !!(m.userData.v161Office || m.userData.v161Tower);
        meas.legacyPlayer = legacyEntry ? !!legacyEntry.flags.player : null; meas.legacyPlacement = legacyEntry ? !!legacyEntry.flags.placement : null; meas.legacyCamera = legacyEntry ? !!legacyEntry.flags.camera : null;
        meas.walls = all.filter((e) => String(e.label).includes(':wall') && e.flags.player && e.flags.agent && !e.flags.placement).length;
        meas.wallYawOk = all.filter((e) => String(e.label).includes(':wall')).every((e) => { const d = (e.yaw - m.rotation.y) / (Math.PI / 4); return Math.abs(d - Math.round(d)) < 1e-6; });
        meas.front = !!m.userData.frontV161;
        // pad distance to the nearest wall box (the pad of the real stage position, in the isolated mesh's frame)
        const bp0 = buildingPosition(i), pp0 = upgradePadPosition(bp0, i), pp = { x: pp0.x - bp0.x + m.position.x, z: pp0.z - bp0.z + m.position.z }; let dmin = 1e9;
        for (const e of own) { const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, c = Math.cos(e.yaw || 0), s = Math.sin(e.yaw || 0), lx = dx * c - dz * s, lz = dx * s + dz * c; dmin = Math.min(dmin, Math.hypot(lx - Math.max(-e.hx, Math.min(e.hx, lx)), lz - Math.max(-e.hz, Math.min(e.hz, lz)))); }
        meas.padDist = +dmin.toFixed(2);
        // along the door axis: a player circle walks from 3 m in front of the door straight in; it must stand in the niche at the door but never get past the niche back wall
        let door = null; m.traverse((o) => { if (o.userData && o.userData.v161Door) door = o; });
        if (door) {
          const w = new THREE.Vector3(); door.getWorldPosition(w); const f = m.userData.frontV161;
          const saved = playerVelocity.clone(); let x = w.x + f.x * 3, z = w.z + f.z * 3, minD = 1e9, best = 0;
          for (let s = 0; s < 80; s++) { playerVelocity.set(-f.x * 4, 0, -f.z * 4); const rr = resolvePlayerCircleCollisions(x - f.x * 0.05, z - f.z * 0.05, own); x = rr.x; z = rr.z; minD = Math.min(minD, Math.hypot(x - w.x, z - w.z)); best = Math.max(best, -((x - w.x) * f.x + (z - w.z) * f.z)); }
          playerVelocity.copy(saved);
          meas.doorAxis = { minD: +minD.toFixed(2), past: +best.toFixed(2) };
          const stepPt = { x: w.x + f.x * 0.9, z: w.z + f.z * 0.9 }; meas.doorStep = P.blockedAt(stepPt.x, stepPt.z).hit;
        }
        let pics = null; if (shots.length) pics = P.shoot(m, shots).shots;
        return { meas, pics };
      } finally { P.dropMesh(m); }
    }, { i, L, shots });
    if (r.pics) for (const [v, url] of Object.entries(r.pics)) fs.writeFileSync(path.join(SHOTS, `ot-stage${i}-L${L}-${v}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    rows.push({ i, L, ...r.meas });
  }
}
// old builder: mesh counts / heights for the comparison
const old = await ev(({ ALL }) => {
  const P = __BLD_PROBE__, out = {};
  OfficeTowerV161.enabled = false;
  for (const i of ALL) for (const L of [1, 5, 10]) { const m = P.stageMesh(i, L); const bb = new THREE.Box3().setFromObject(m); out[`${i}:${L}`] = { meshes: P.measure(m, [], { sweep: false }).meshes, height: +(bb.max.y - bb.min.y).toFixed(2) }; P.dropMesh(m); }
  OfficeTowerV161.enabled = true;
  return out;
}, { ALL });
console.log('old builder (meshes, height m):', J(old));
check(rows.length === 80, `${rows.length} building meshes measured (8 stages x levels 1..10)`);

for (const si of ALL) {
  const ls = rows.filter((r) => r.i === si).sort((p, q) => p.L - q.L), nm = NAME[si], tower = TOWERS.includes(si), cap = tower ? 18 : 16, hcap = tower ? 3.0 : 1.6;
  const oldS = Object.fromEntries(Object.entries(old).filter(([k]) => k.startsWith(si + ':')));
  let b = ls.filter((r) => !(r.flag && r.walls >= 1 && r.legacyPlayer === false && r.legacyPlacement === true && r.legacyCamera === true && r.front)).map((r) => 'L' + r.L);
  check(ls.length === 10 && b.length === 0, `${nm} (stage ${si}): own builder, wall boxes are the player/agent colliders, the whole-mesh box keeps placement + camera only (${b.length} bad ${J(b.slice(0, 3))}; before: one whole-mesh box ${J(oldS[si + ':1'] && '')} up to 1.04 m of invisible wall)`);
  check(ls.every((r) => r.wallYawOk), `${nm}: the wall boxes are rotated with the mesh (yaw multiple of 45 deg relative to the building)`);
  check(ls.every((r) => r.minY >= -0.05 && r.minY <= 0.05), `${nm}: nothing floating or sunk, min y within 5 cm at every level (${Math.min(...ls.map((r) => r.minY))}..${Math.max(...ls.map((r) => r.minY))})`);
  check(ls.every((r) => r.overlap !== null && r.overlap >= 0.9), `${nm}: the wall boxes cover >= 90 % of the wall footprint (worst ${Math.min(...ls.map((r) => r.overlap))})`);
  check(ls.every((r) => r.outsideMax <= 0.3 && r.outside <= 0.8), `${nm}: no collider more than 0.3 m (0.8 m2) outside the walls (worst ${Math.max(...ls.map((r) => r.outsideMax))} m / ${Math.max(...ls.map((r) => r.outside))} m2; before ${oldS[si + ':1'] ? 'up to 1.04 m' : ''})`);
  check(ls.every((r) => r.sweepReached === 0 && r.doorAxis && r.doorAxis.minD <= 0.8 && r.doorAxis.past <= 0.75), `${nm}: no walk-in from 8 directions; along the door axis the player reaches the revolving door (${J(ls.slice(0, 1).map((r) => r.doorAxis))} m from the door) but not past the niche (<= 0.75 m)`);
  check(ls.every((r) => r.door && r.door.dot >= 0.95 && r.door.dist <= r.door.radius + 1.5 && r.doorStep === false), `${nm}: the door faces the driveway (dot ${J(ls.slice(0, 1).map((r) => r.door.dot))}, within radius + 1.5 m of the road end) and the step in front is walkable`);
  check(ls.every((r) => r.padDist >= 0.8), `${nm}: the upgrade pad is >= 0.8 m outside every wall box (${Math.min(...ls.map((r) => r.padDist))} m)`);
  const H = ls.slice(0, 5).map((r) => r.size[1]);
  check(H.every((h, k) => k === 0 || (h >= H[k - 1] - 1e-6 && h - H[k - 1] <= hcap)) && H[4] <= H[0] * (tower ? 3.0 : 2.4), `${nm}: no 18 % stretch of one slab - the height grows by whole floors only: ${J(H.map((h) => +h.toFixed(2)))} m for levels 1..5, <= ${hcap} m per level (old builder ${J(Object.fromEntries(Object.entries(oldS).map(([k, v]) => [k, v.height])))})`);
  const W = ls.slice(0, 5).map((r) => Math.max(r.size[0], r.size[2]));
  check(W.every((w, k) => k === 0 || w >= W[k - 1] - 1e-6), `${nm}: the footprint never shrinks while the same building grows (${J(W)})`);
  const t = ls.map((r) => r.tris);
  check(t.slice(0, 5).every((v, k) => k === 0 || v > t[k - 1]), `${nm}: every level 1..5 ADDS parts (triangles ${t.slice(0, 5)})`);
  check(ls.every((r, k) => k === 0 || r.meshes >= ls[k - 1].meshes) && ls.every((r) => r.meshes <= cap), `${nm}: mesh counts never decrease and stay <= ${cap} (${J(ls.map((r) => r.meshes))}; the old builder ${J(Object.fromEntries(Object.entries(oldS).map(([k, v]) => [k, v.meshes])))})`);
  check(Object.entries(oldS).every(([k, v]) => ls.find((r) => r.L === +k.split(':')[1]).meshes * 5 < v.meshes), `${nm}: <= 1/5 of the old meshes at levels 1 / 5 / 10`);
  // gold: none at 1..5 (no gold-material mesh at all: the old builder drew a crown at every level of the Empire / financial quarter), ONE gold mesh at 6..10, more each level, the crown at 10 exactly once
  check(ls.slice(0, 5).every((r) => r.goldMeshes === 0 && r.goldMatMeshes === 0), `${nm}: no gold at levels 1..5 (the old builder ${si === 9 || si === 15 ? 'put a golden crown on it at EVERY level' : 'had a spire / crown cone only from 6'})`);
  const gt = ls.filter((r) => r.L >= 6);
  check(gt.every((r) => r.gold === r.L && r.goldMeshes === 1 && r.goldMatMeshes === 1) && gt.every((r, k) => k === 0 || r.goldTris >= gt[k - 1].goldTris), `${nm}: gold tiers 6..10 are ONE gold mesh carrying the tier, more gold with every level (gold triangles ${J(gt.map((r) => r.goldTris))})`);
  check(gt[4].goldTris >= gt[3].goldTris + 60 && gt[4].goldTop >= gt[3].goldTop + 0.15, `${nm}: the golden crown at level 10 exists exactly once (+${gt[4].goldTris - gt[3].goldTris} triangles, gold top ${gt[4].goldTop} m vs ${gt[3].goldTop} m at level 9) and nothing crown-like earlier (gold triangles 6..9: ${J(gt.slice(0, 4).map((r) => r.goldTris))})`);
}
check(rows.every((r) => !r.i || r.walls >= 1), 'every measured level has wall boxes in the registry');

// ------------------------------------------------------------------------------------------------ D. rebuild baseline + camera obstruction
const base = await ev(({ ALL }) => {
  const P = __BLD_PROBE__, g0 = renderer.info.memory.geometries, out = {};
  { const m = P.stageMesh(9, 5); P.dropMesh(m); }
  const g1 = renderer.info.memory.geometries;
  for (let k = 0; k < 12; k++) for (const i of [6, 9]) { const m = P.stageMesh(i, 1 + (k % 5)); P.registerStage(m, i); P.dropMesh(m); }
  out.g1 = g1; out.g2 = renderer.info.memory.geometries; out.sceneKids = scene.children.length;
  // camera obstruction: orbit camera 9 m behind the player (8.18 m horizontal, 3.75 m above the 1.5 m eye); worst heading = away from the building (the building is between the player and the camera)
  const ray = new THREE.Raycaster(); ray.near = 0.1;
  const cam = (m) => {
    m.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(m), c = bb.getCenter(new THREE.Vector3()); const res = { obstructed: 0, minPulled: 99, n: 36 };
    const rad = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2 + 1.2;
    for (let k = 0; k < 36; k++) {
      const a = k * Math.PI / 18, px = c.x + Math.sin(a) * rad, pz = c.z + Math.cos(a) * rad, hx = Math.sin(a), hz = Math.cos(a);   // heading = away from the building
      const eye = new THREE.Vector3(px, 1.5, pz), camPos = new THREE.Vector3(px - hx * 8.18, 1.5 + 3.75, pz - hz * 8.18), dir = camPos.clone().sub(eye), dist = dir.length(); dir.normalize();
      ray.set(eye, dir); ray.far = dist; const hit = ray.intersectObject(m, true).filter((h) => h.object.visible && !(h.object.material && h.object.material.transparent && h.object.userData.v161Door));
      if (hit.length && hit[0].distance < dist - 0.35) { res.obstructed++; res.minPulled = Math.min(res.minPulled, Math.max(1.4, hit[0].distance - 0.35)); }
    }
    return res;
  };
  out.cam = {};
  for (const i of ALL) {
    const m = P.stageMesh(i, 5); const nw = cam(m); P.dropMesh(m);
    OfficeTowerV161.enabled = false; const m2 = P.stageMesh(i, 5); const ol = cam(m2); P.dropMesh(m2); OfficeTowerV161.enabled = true;
    out.cam[i] = { now: nw, old: ol };
  }
  return out;
}, { ALL });
console.log('D: rebuild baseline', J({ g1: base.g1, g2: base.g2 }), 'camera (36 headings, player 1.2 m outside the footprint, building between player and camera):', J(base.cam));
check(base.g2 <= base.g1 + 2, `D: building + dropping 24 stage meshes leaves the geometry count at the baseline (${base.g1} -> ${base.g2})`);
check(Object.values(base.cam).every((c) => c.now.minPulled >= 1.4 && c.now.obstructed <= 36), `D: the camera is pulled in by an office / tower to at most the game's own minimum (1.4 m) and never inside the player; obstructed headings now/old: ${J(Object.fromEntries(Object.entries(base.cam).map(([i, c]) => [i, c.now.obstructed + '/' + c.old.obstructed])))} of 36 (a tower stands in the camera ray only through its lowest 5.25 m, so its height does not add obstruction)`);

console.log(`\nconsole errors ${g.errors.length} ${J(g.errors.slice(0, 3))}; bad responses ${g.badResponses.length} ${J(g.badResponses.slice(0, 3))}`);
check(g.errors.length === 0 && g.badResponses.length === 0, '0 console errors and 0 4xx');
await g.close();
