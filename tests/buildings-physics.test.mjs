// Physics + design checks for every catalogued building (2026-10-05 (4); the catalogue is docs/BUILDINGS_V161.md, the probe is tools/lib/buildings-probe-v161.mjs,
// the picture tool is tools/showcase-v161.mjs). ONE browser launch on a late-game save (all 16 stages built at level 5, every staged unlock, all districts).
//   A. every STAGES building x levels (houses 1..10, the rest 1/5/10) built by the game's real builder chain (createBuildingMesh), registered in the real v83
//      collision registry (registerRoot, the call rebuildStatic makes) and measured with the 0.1 m raster of the probe: nothing floating or sunk (|min y| <= 5 cm),
//      the collider covers the wall footprint (>= 90 %), extends at most 1.0 m beyond it, the player walked at the centre from 8 directions never gets inside
//      (game's resolvePlayerCircleCollisions with the building's own colliders), door vs driveway (houses).
//   B. the live world: houses carry real wall boxes in the registry (the whole-mesh box keeps placement/camera only), the door and the upgrade pad of a built house
//      are standing places (not inside any collider), every pickup / drop-off / pad point, and the live industrial / market / district groups.
//   C. a real upgrade of house 0 (upgradeBuilding) keeps its colliders and re-lays 0 road meshes.
//   B2 (2026-10-05 (6), family #2): the INDUSTRIAL PLANTS (sawmill, concrete plant, metal yard, frame workshop) at production levels 1/2/3, built by the game's own refresh path
//   (industrialLevelsV161 -> refreshIndustrialBadgesV161) and measured with the colliders they own in the real registry: nothing floating or sunk, the colliders cover the walls /
//   machines (>= 90 %) and stick out <= 1.0 m, the player walked at the centre from 8 directions never gets inside (open bays stay walkable: the footprint is walls + machines),
//   every pad / pickup / mine / badge of the plant is outside every collider, the mines stand on their pad, draw-call budgets.
//   B3 (2026-10-05 (7), family #3): the MARKET - plaza + the 7 stalls built by the game (marketRuntimeV116) and measured with the colliders they own: nothing floating or sunk, the sealed stall body
//   (back wall, side panels, counter) and the big props are solid and cover the walls >= 90 %, the player walked at the centre from 8 directions never gets inside, the customer side in front of the
//   counter is open and walkable up to it, the lane from the plaza centre to every stall is free, the stall can be used from there (nearestManualTargetV53), fountain / benches / planters solid,
//   the entrance gate walkable, mesh budgets.
//   B4 (2026-10-05 (8), backlog #4): the SUBURB district identity group (lawn, trees, planters, ring of mini houses): real wall boxes for every house (+ shed), tree trunks standing on the ground and
//   clear of the houses, nothing floating or sunk, <= 8 meshes (was ~116), the player walked at every house from 8 directions never gets inside; the three mini-house variants are HARD in section A
//   (walls cover the footprint, no walk-in, min y 0), and the SHOP (stage 2, levels 1..10, backlog #5) joins the house family in sections A / B (walls, door, step, pad outside the collider).
//   B5 (2026-10-06 (9), backlog #6): the WAREHOUSE (stage 3) and the LOGISTICS TERMINAL (stage 10) join the hard family in sections A / B at every level 1..10 (walls, <= 0.3 m outside, growth, gold,
//   crown, <= 1/5 of the old meshes, door vs driveway, min y, no walk-in) and their upgrade pads must stand outside every collider (the pad stood 0.54 m inside the old warehouse wall).
//   B7 (2026-10-06 (11), backlog #10 + #11): the four OFFICES (stage 6 / 7 / 11 / 14) and the four TOWERS (8 / 9 / 12 / 15) join the hard family at every level 1..10 (walls, <= 0.3 m outside, same building grows by floors, gold, crown, <= 1/5 of the old
//   meshes, door vs driveway, min y, no walk-in) and their upgrade pads must stand outside every collider; this was the last KNOWN ISSUE group (0 left).
//   B6 (2026-10-06 (10), backlog #7 + #8): the three FACTORIES (stage 4 mini factory, 5 factory, 13 tech park) join the hard family at every level 1..10 (walls, <= 0.3 m outside, no height stretch, gold, crown, <= 1/5 of the old
//   meshes, door vs driveway, min y, no walk-in) and their upgrade pads must stand outside every collider; the FLEET YARD (v116FleetYard) is measured with the boxes it owns (<= 16 meshes, min y, fence / walls covered, no walk-in
//   from N / NE / E / W / NW, open only through the mouth along the service lane, truck homes free).
// IN SCOPE (hard checks): the house family = stage 0/1 at every level + the shop (stage 2) + the warehouse (3), the terminal (10) and the factories (4, 5, 13) at every level, the fleet yard, the three neighbourhood / suburb mini houses, the suburb district, the four industrial plants, the market. Everything else in the catalogue is measured and
//   printed as `KNOWN ISSUE:` (exit 0) - those lines are the backlog of the next building families. SHOTS_DIR=<dir> writes front + iso pictures of house levels 1/3/5/10
//   and of the plants at levels 1/3, the shop at levels 1/3/5/10.
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
  const house = info.arch[i] === 'house', shop = info.arch[i] === 'shop', logi = info.arch[i] === 'warehouse', fac = info.arch[i] === 'factory', ot = info.arch[i] === 'office' || info.arch[i] === 'tower';
  const levels = house || shop || logi || fac || ot ? Array.from({ length: info.maxLevel }, (_, k) => k + 1) : [1, 5, 10];
  for (const L of levels) {
    const shots = SHOTS && (house || shop || logi || fac || ot) && [1, 3, 5, 10].includes(L) ? ['front', 'iso'] : [];
    const r = await ev(({ i, L, shots }) => {
      const P = __BLD_PROBE__, m = P.stageMesh(i, L);
      try {
        const legacyEntry = P.registerStage(m, i);
        const all = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === m);
        const meas = P.measure(m, P.ownEntries(m));
        meas.door = P.doorInfo(m, i);
        meas.gold = m.userData.goldTierV161 || 0;
        meas.goldMesh = m.children.some((c) => c.name === 'houseGoldV161' || c.name === 'shopGoldV161' || c.name === 'logisticsGoldV161' || c.name === 'factoryGoldV161' || c.name === 'officeTowerGoldV161');
        meas.goldTris = (() => { const c = m.children.find((x) => x.name === 'houseGoldV161' || x.name === 'shopGoldV161' || x.name === 'logisticsGoldV161' || x.name === 'factoryGoldV161' || x.name === 'officeTowerGoldV161'); return c ? c.geometry.index.count / 3 : 0; })();
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
    rows.push({ i, L, arch: info.arch[i], house, shop, logi, fac, ot, ...r.meas });
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
const oldShop = await ev(() => {
  const P = __BLD_PROBE__, out = {};
  ShopV161.enabled = false;
  for (const L of [1, 3, 5, 10]) { const m = P.stageMesh(2, L); out[L] = P.measure(m, P.ownEntries(m), { sweep: false }).meshes; P.dropMesh(m); }
  ShopV161.enabled = true;
  return out;
});
const oldLogi = await ev(() => {
  const P = __BLD_PROBE__, out = {};
  LogisticsV161.enabled = false;
  for (const i of [3, 10]) for (const L of [1, 5, 10]) { const m = P.stageMesh(i, L); out[`${i}:${L}`] = P.measure(m, P.ownEntries(m), { sweep: false }).meshes; P.dropMesh(m); }
  LogisticsV161.enabled = true;
  return out;
});
const oldFac = await ev(() => {
  const P = __BLD_PROBE__, out = {};
  FactoryV161.enabled = false;
  for (const i of [4, 5, 13]) for (const L of [1, 5, 10]) { const m = P.stageMesh(i, L); const bb = new THREE.Box3().setFromObject(m); out[`${i}:${L}`] = { meshes: P.measure(m, P.ownEntries(m), { sweep: false }).meshes, height: +(bb.max.y - bb.min.y).toFixed(2) }; P.dropMesh(m); }
  FactoryV161.enabled = true;
  return out;
});
const minis = [];
for (const v of [0, 1, 2]) {
  const mini = await ev((v) => {
    const P = __BLD_PROBE__, m = P.miniMesh(0xe0bb91, 0x8b4c39, v);
    try { const r = P.measure(m, P.miniEntries(m)); r.variant = m.userData.v161Variant; return r; } finally { P.dropMesh(m); }
  }, v);
  minis.push(mini);
  rows.push({ i: -1, L: 1, arch: 'mini-house', house: true, ...mini });
}
const mini = minis[0];

const label = (r) => (r.i < 0 ? 'mini house' : `stage ${r.i} (${r.arch}) L${r.L}`);
const hard = rows.filter((r) => r.house || r.shop || r.logi || r.fac || r.ot);
console.log(`measured ${rows.length} building meshes: ${hard.length} in the house / shop family (hard checks), ${rows.length - hard.length} others (KNOWN ISSUE lines)`);
check(rows.length >= 16 * 3 + 14 + 10, `every stage x level measured (${rows.length})`);

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
check(b.length === 0, `house / shop family: the door faces its driveway and is within radius + 1.5 m of its end (${b.length} bad; door ${J(rows.find((r) => r.i === 0 && r.L === 1).door)})`);
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
// ---- the shop (stage 2, levels 1..10, assets/shop-v161.js)
const shops = rows.filter((r) => r.shop).sort((p, q) => p.L - q.L);
b = shops.filter((r) => !(r.walls >= 1 && r.legacyPlayer === false && r.legacyPlacement === true && r.legacyCamera === true && r.front)).map(label);
check(shops.length === 10 && b.length === 0, `shop: wall boxes are the player/agent colliders, the whole-mesh box keeps placement + camera only (${shops.length} levels, ${b.length} bad ${J(b.slice(0, 3))}; before: one whole-mesh box 1.96 x 2.05 m = 7.5 m2 invisible wall, up to 1.43 m)`);
b = shops.filter((r) => Math.abs((r.wallYaw ?? 0) - r.meshYaw) > 1e-6).map(label);
check(b.length === 0, `shop wall boxes are rotated with the mesh (yaw ${J(shops.slice(0, 2).map((r) => [r.wallYaw, r.meshYaw]))})`);
b = shops.filter((r) => !(r.outsideMax <= 0.3 && r.outside <= 0.8)).map(label);
check(b.length === 0, `shop: the collider is at most 0.3 m (and 0.8 m2) outside the walls at every level (worst ${Math.max(...shops.map((r) => r.outsideMax))} m / ${Math.max(...shops.map((r) => r.outside))} m2; before 1.43 m / 7.5 m2)`);
{ const t = shops.map((r) => r.tris);
  check(t.slice(0, 5).every((v, k) => k === 0 || v > t[k - 1]), `shop: the silhouette grows with every level 1..5 (triangles ${t.slice(0, 5)})`);
  const gt = shops.filter((r) => r.L >= 6);
  check(gt.every((r) => r.gold === r.L && r.goldMesh) && gt.every((r, k) => k === 0 || r.goldTris >= gt[k - 1].goldTris) && gt[4].goldTris > gt[3].goldTris, `shop: gold tiers 6..10 carry the tier and more gold with every level, the crown comes at 10 (gold triangles ${gt.map((r) => r.goldTris)})`); }
{ const mx = Math.max(...shops.map((r) => r.meshes));
  check(mx <= 14 && shops.every((r) => oldShop[r.L] === undefined || r.meshes < oldShop[r.L]), `shop draw calls: <= ${mx} meshes at any level (old builder ${J(oldShop)} for levels 1/3/5/10)`); }

// ---- the warehouse (stage 3) and the logistics terminal (stage 10), levels 1..10, assets/warehouse-v161.js (2026-10-06 (9), backlog #6)
for (const si of [3, 10]) {
  const ls = rows.filter((r) => r.logi && r.i === si).sort((p, q) => p.L - q.L), nm = si === 3 ? 'warehouse' : 'terminal';
  b = ls.filter((r) => !(r.walls >= 1 && r.legacyPlayer === false && r.legacyPlacement === true && r.legacyCamera === true && r.front)).map(label);
  check(ls.length === 10 && b.length === 0, `${nm}: wall boxes are the player/agent colliders, the whole-mesh box keeps placement + camera only (${ls.length} levels, ${b.length} bad ${J(b.slice(0, 3))}; before: one whole-mesh box ${si === 3 ? '2.37 x 2.58' : '2.75 x 3.05'} m, ${si === 3 ? '10.6' : '14'} m2 invisible wall up to ${si === 3 ? '1.53' : '1.67'} m)`);
  b = ls.filter((r) => Math.abs((r.wallYaw ?? 0) - r.meshYaw) > 1e-6).map(label);
  check(b.length === 0, `${nm} wall boxes are rotated with the mesh (yaw ${J(ls.slice(0, 1).map((r) => [r.wallYaw, r.meshYaw]))})`);
  b = ls.filter((r) => !(r.outsideMax <= 0.3 && r.outside <= 0.8)).map(label);
  check(b.length === 0, `${nm}: the collider is at most 0.3 m (and 0.8 m2) outside the walls at every level (worst ${Math.max(...ls.map((r) => r.outsideMax))} m / ${Math.max(...ls.map((r) => r.outside))} m2)`);
  const t = ls.map((r) => r.tris);
  check(t.slice(0, 5).every((v, k) => k === 0 || v > t[k - 1]), `${nm}: the SAME building grows - every level 1..5 ADDS parts (triangles ${t.slice(0, 5)})`);
  check(ls.every((r, k) => k === 0 || r.meshes >= ls[k - 1].meshes) && ls.every((r) => r.meshes <= 16), `${nm}: mesh counts never decrease and stay <= 16 (${ls.map((r) => r.meshes)}; the old builder ${J(Object.fromEntries(Object.entries(oldLogi).filter(([k]) => k.startsWith(si + ':'))))})`);
  const gt = ls.filter((r) => r.L >= 6);
  check(gt.every((r) => r.gold === r.L && r.goldMesh) && gt.every((r, k) => k === 0 || r.goldTris >= gt[k - 1].goldTris) && gt[4].goldTris > gt[3].goldTris, `${nm}: gold tiers 6..10 carry the tier and more gold with every level, the crown comes at 10 (gold triangles ${gt.map((r) => r.goldTris)})`);
  check(Object.entries(oldLogi).filter(([k]) => k.startsWith(si + ':')).every(([k, v]) => ls.find((r) => r.L === +k.split(':')[1]).meshes * 5 < v), `${nm}: <= 1/5 of the old meshes at levels 1/5/10`);
}
// ---- the three factories (stage 4 mini factory, 5 factory, 13 tech park), levels 1..10, assets/factory-v161.js (2026-10-06 (10), backlog #7)
for (const si of [4, 5, 13]) {
  const ls = rows.filter((r) => r.fac && r.i === si).sort((p, q) => p.L - q.L), nm = { 4: 'mini factory', 5: 'factory', 13: 'tech park' }[si];
  const oldS = Object.fromEntries(Object.entries(oldFac).filter(([k]) => k.startsWith(si + ':')));
  b = ls.filter((r) => !(r.walls >= 1 && r.legacyPlayer === false && r.legacyPlacement === true && r.legacyCamera === true && r.front)).map(label);
  check(ls.length === 10 && b.length === 0, `${nm}: wall boxes are the player/agent colliders, the whole-mesh box keeps placement + camera only (${ls.length} levels, ${b.length} bad ${J(b.slice(0, 3))}; before: one whole-mesh box, an invisible wall up to ~1.2 m)`);
  b = ls.filter((r) => Math.abs((r.wallYaw ?? 0) - r.meshYaw) > 1e-6).map(label);
  check(b.length === 0, `${nm} wall boxes are rotated with the mesh (yaw ${J(ls.slice(0, 1).map((r) => [r.wallYaw, r.meshYaw]))})`);
  b = ls.filter((r) => !(r.outsideMax <= 0.3 && r.outside <= 0.8)).map(label);
  check(b.length === 0, `${nm}: the collider is at most 0.3 m (and 0.8 m2) outside the walls at every level (worst ${Math.max(...ls.map((r) => r.outsideMax))} m / ${Math.max(...ls.map((r) => r.outside))} m2)`);
  const t = ls.map((r) => r.tris);
  check(t.slice(0, 5).every((v, k) => k === 0 || v > t[k - 1]), `${nm}: the SAME building grows - every level 1..5 ADDS parts (triangles ${t.slice(0, 5)})`);
  check(ls.every((r, k) => k === 0 || r.meshes >= ls[k - 1].meshes) && ls.every((r) => r.meshes <= 16), `${nm}: mesh counts never decrease and stay <= 16 (${ls.map((r) => r.meshes)}; the old builder ${J(Object.fromEntries(Object.entries(oldS).map(([k, v]) => [k, v.meshes])))})`);
  const H = ls.slice(0, 5).map((r) => r.maxY - r.minY);
  check(H.every((h, k) => k === 0 || (h >= H[k - 1] - 1e-6 && h - H[k - 1] <= 0.6)) && H[4] <= H[0] * 1.4, `${nm}: no 18 % height stretch - height ${J(H.map((h) => +h.toFixed(2)))} m for levels 1..5 (old builder ${J(Object.fromEntries(Object.entries(oldS).map(([k, v]) => [k, v.height])))})`);
  const gt = ls.filter((r) => r.L >= 6);
  check(gt.every((r) => r.gold === r.L && r.goldMesh) && gt.every((r, k) => k === 0 || r.goldTris >= gt[k - 1].goldTris) && gt[4].goldTris > gt[3].goldTris, `${nm}: gold tiers 6..10 carry the tier and more gold with every level, the crown comes at 10 (gold triangles ${gt.map((r) => r.goldTris)})`);
  check(Object.entries(oldS).every(([k, v]) => ls.find((r) => r.L === +k.split(':')[1]).meshes * 5 < v.meshes), `${nm}: <= 1/5 of the old meshes at levels 1/5/10`);
}
// ---- the four offices (stage 6, 7, 11, 14) and the four towers (8, 9, 12, 15), levels 1..10, assets/towers-v161.js (2026-10-06 (11), backlog #10 + #11); the detailed checks live in tests/office-tower.test.mjs
const oldOt = await ev(() => {
  const P = __BLD_PROBE__, out = {};
  OfficeTowerV161.enabled = false;
  for (const i of [6, 7, 8, 9, 11, 12, 14, 15]) for (const L of [1, 5, 10]) { const m = P.stageMesh(i, L); const bb = new THREE.Box3().setFromObject(m); out[`${i}:${L}`] = { meshes: P.measure(m, P.ownEntries(m), { sweep: false }).meshes, height: +(bb.max.y - bb.min.y).toFixed(2) }; P.dropMesh(m); }
  OfficeTowerV161.enabled = true;
  return out;
});
for (const si of [6, 7, 11, 14, 8, 9, 12, 15]) {
  const ls = rows.filter((r) => r.ot && r.i === si).sort((p, q) => p.L - q.L), nm = { 6: 'office', 7: 'business centre', 11: 'research centre', 14: 'convention centre', 8: 'skyscraper', 9: 'Empire', 12: 'grand hotel', 15: 'financial quarter' }[si], tower = [8, 9, 12, 15].includes(si);
  const oldS = Object.fromEntries(Object.entries(oldOt).filter(([k]) => k.startsWith(si + ':')));
  b = ls.filter((r) => !(r.walls >= 1 && r.legacyPlayer === false && r.legacyPlacement === true && r.legacyCamera === true && r.front)).map(label);
  check(ls.length === 10 && b.length === 0, `${nm}: wall boxes are the player/agent colliders, the whole-mesh box keeps placement + camera only (${ls.length} levels, ${b.length} bad ${J(b.slice(0, 3))}; before: one whole-mesh box, an invisible wall up to 1.04 m)`);
  b = ls.filter((r) => { const d = ((r.wallYaw ?? 0) - r.meshYaw) / (Math.PI / 4); return Math.abs(d - Math.round(d)) > 1e-6; }).map(label);
  check(b.length === 0, `${nm} wall boxes are rotated with the mesh (yaw ${J(ls.slice(0, 1).map((r) => [r.wallYaw, r.meshYaw]))})`);
  b = ls.filter((r) => !(r.outsideMax <= 0.3 && r.outside <= 0.8)).map(label);
  check(b.length === 0, `${nm}: the collider is at most 0.3 m (and 0.8 m2) outside the walls at every level (worst ${Math.max(...ls.map((r) => r.outsideMax))} m / ${Math.max(...ls.map((r) => r.outside))} m2)`);
  const t = ls.map((r) => r.tris);
  check(t.slice(0, 5).every((v, k) => k === 0 || v > t[k - 1]), `${nm}: the SAME building grows - every level 1..5 ADDS parts (triangles ${t.slice(0, 5)})`);
  check(ls.every((r, k) => k === 0 || r.meshes >= ls[k - 1].meshes) && ls.every((r) => r.meshes <= (tower ? 18 : 16)), `${nm}: mesh counts never decrease and stay <= ${tower ? 18 : 16} (${ls.map((r) => r.meshes)}; the old builder ${J(Object.fromEntries(Object.entries(oldS).map(([k, v]) => [k, v.meshes])))})`);
  const H = ls.slice(0, 5).map((r) => r.maxY - r.minY);
  check(H.every((h, k) => k === 0 || (h >= H[k - 1] - 1e-6 && h - H[k - 1] <= (tower ? 3.0 : 1.6))), `${nm}: no 18 % height stretch - height ${J(H.map((h) => +h.toFixed(2)))} m for levels 1..5 (old builder ${J(Object.fromEntries(Object.entries(oldS).map(([k, v]) => [k, v.height])))})`);
  const gt = ls.filter((r) => r.L >= 6);
  check(gt.every((r) => r.gold === r.L && r.goldMesh) && gt.every((r, k) => k === 0 || r.goldTris >= gt[k - 1].goldTris) && gt[4].goldTris > gt[3].goldTris, `${nm}: gold tiers 6..10 carry the tier and more gold with every level, the crown comes at 10 (gold triangles ${gt.map((r) => r.goldTris)})`);
  check(Object.entries(oldS).every(([k, v]) => ls.find((r) => r.L === +k.split(':')[1]).meshes * 5 < v.meshes), `${nm}: <= 1/5 of the old meshes at levels 1/5/10`);
}
const newMax = Math.max(...houses.map((r) => r.meshes)), oldMin = Math.min(...Object.values(old));
check(newMax <= 20 && newMax <= oldMin, `house draw calls: <= ${newMax} meshes per house at any level (old builder ${J(old)})`);
check(minis.every((m) => m.meshes <= 5), `mini houses: <= 5 meshes each (${J(minis.map((m) => m.meshes))}; old 5)`);
check(minis.every((m) => m.minY >= -0.05 && m.minY <= 0.05 && m.overlap >= 0.9 && m.outsideMax <= 0.3 && m.sweepReached === 0), `mini houses (3 variants): min y within 5 cm, the wall boxes cover >= 90 % of the footprint (${J(minis.map((m) => m.overlap))}), no collider more than 0.3 m outside the walls, the player walked at the centre from 8 directions never gets inside (reach ${J(minis.map((m) => m.sweepReached))}; the old r 0.92 circle: reach 0, but the wall corners poked 6 cm out of it)`);
check(new Set(minis.map((m) => m.tris)).size === 3 && new Set(minis.map((m) => m.variant)).size === 3, `mini houses: three distinct variants (triangles ${J(minis.map((m) => m.tris))})`);

// --- known issues, everything else
for (const r of rows.filter((x) => !x.house && !x.shop && !x.logi && !x.fac && !x.ot)) {
  if (r.minY < -0.05 || r.minY > 0.05) issue(`${label(r)}: floating or sunk, min y ${r.minY}`);
  if (r.overlap !== null && r.overlap < 0.9) issue(`${label(r)}: collider covers only ${Math.round(r.overlap * 100)} % of the wall footprint`);
  if (r.outsideMax > 1.0 && (r.L === 1 || r.L === 5)) issue(`${label(r)}: collider (whole-mesh box) extends ${r.outsideMax} m beyond the walls (${r.outside} m2 of invisible wall)`);
  if (r.sweepReached > 0) issue(`${label(r)}: the player can walk into the building from ${r.sweepReached} of 8 directions`);
}
const kinds = {};
for (const r of rows.filter((x) => !x.house && !x.shop && !x.logi && !x.fac && !x.ot)) { (kinds[r.i] = kinds[r.i] || []).push(r); }
check(Object.values(kinds).every((rs) => rs.every((r) => r.sweepReached === 0)), 'other stage buildings: the player cannot walk into any of them (whole-mesh boxes cover the walls)');

// ------------------------------------------------------------------------------------------------ B. live world
const built = await ev(() => __BLD_PROBE__.buildOut());
console.log('build-out', built.join(' | '));
await page.waitForTimeout(4000);
await ev(() => __BLD_PROBE__.finishGrowth());
await page.waitForTimeout(2500);
const live = await ev(() => {
  const P = __BLD_PROBE__, reg = __TYCOON_V83_COLLISIONS__.registry, out = { houses: [] };
  for (const idx of [0, 1, 2, 3, 4, 5, 10, 13]) {
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
check(houseBad.length === 0 && live.points.some((p) => p.id === 'upgrade-pad:stage2'), `house and shop upgrade pads are reachable: not deeper than 25 cm inside a collider (${J(houseBad)}; the shop pad stood 0.07 m inside its 1.43 m invisible wall)`);
check(live.points.filter((p) => ['upgrade-pad:stage4', 'upgrade-pad:stage5', 'upgrade-pad:stage13'].includes(p.id)).length === 3 && live.points.filter((p) => ['upgrade-pad:stage4', 'upgrade-pad:stage5', 'upgrade-pad:stage13'].includes(p.id)).every((p) => !p.b.hit && p.b.moved === 0), `the mini factory, factory and tech park upgrade pads stand OUTSIDE every collider (before: inside by 0.68-0.72 m for stages 4 / 5) ${J(live.points.filter((p) => ['upgrade-pad:stage4', 'upgrade-pad:stage5', 'upgrade-pad:stage13'].includes(p.id)).map((p) => [p.id, p.b.moved]))}`);
check(live.points.filter((p) => ['upgrade-pad:stage2', 'upgrade-pad:stage3', 'upgrade-pad:stage10'].includes(p.id)).length === 3 && live.points.filter((p) => ['upgrade-pad:stage3', 'upgrade-pad:stage10'].includes(p.id)).every((p) => !p.b.hit && p.b.moved === 0), `the warehouse and terminal upgrade pads stand OUTSIDE every collider (before: the warehouse pad was inside the wall) ${J(live.points.filter((p) => ['upgrade-pad:stage3', 'upgrade-pad:stage10'].includes(p.id)))}`);
check(live.points.filter((p) => p.id === 'upgrade-pad:stage2').every((p) => !p.b.hit), `the shop upgrade pad stands OUTSIDE every collider (${J(live.points.filter((p) => p.id === 'upgrade-pad:stage2'))})`);
const padsInside = live.points.filter((x) => x.family !== 'house' && x.b.hit);
for (const p of padsInside) issue(`${p.id} @${p.x},${p.z} is inside a collider (${p.b.by.join(', ')}; the player circle would be pushed ${p.b.moved} m)`);
// every pickup / drop-off / pad / mine of the industrial family (sawmill, plants, mines, field pads) stands outside every collider (2026-10-05 (6): hard)
const industrialPads = live.points.filter((x) => x.family === 'industrial');
check(industrialPads.length >= 8 && industrialPads.every((p) => !p.b.hit), `industrial pads / pickups / mines stand outside every collider: ${industrialPads.length} checked (${industrialPads.map((p) => p.id).join(', ')}); inside: ${J(industrialPads.filter((p) => p.b.hit).map((p) => [p.id, p.b.by, p.b.moved]))}`);

// ------------------------------------------------------------------------------------------------ B6. fleet yard (backlog #8, 2026-10-06 (10)): HARD
// The late world has the depot built, so rebuildParkingV65 made the yard group `v116FleetYard` (assets/factory-v161.js FleetYardV161.build): lot slab + road throat + <= 10 merged meshes. Measured with the colliders it OWNS in the
// registry (fence runs west / east / rear, pillars, garage, booth, pump, wash stand, gate leaf; player + agent only) and walked by the game's own resolver from 8 directions.
const fyRow = await ev(() => {
  const P = __BLD_PROBE__, yard = P.liveByName('v116FleetYard');
  if (!yard) return null;
  yard.updateMatrixWorld(true);
  const own = P.ownEntries(yard), meas = P.measure(yard, own, { sweep: false });
  delete meas.colliders;
  // a fence is a thin line, not an enclosed footprint, so the probe's raster cover (flood fill of closed outlines) does not apply: instead every drawn solid vertex between 0.3 and 1.2 m (opaque, non-soft meshes: fence
  // rails / pickets / posts, pillars, garage + booth walls, doors, gate leaf) must lie within 0.1 m of an own box, and every own box must have drawn geometry within 0.35 m (no invisible wall)
  const dist = (e, x, z) => { const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw), dx = x - e.pos.x, dz = z - e.pos.z, lx = dx * cy - dz * sy, lz = dx * sy + dz * cy; return Math.hypot(Math.max(0, Math.abs(lx) - e.hx), Math.max(0, Math.abs(lz) - e.hz)); };
  let tot = 0, near = 0, worst = 0; const closest = own.map(() => 1e9), v = new THREE.Vector3();
  yard.traverse((o) => {
    if (!o.isMesh || o.userData.v161Soft || (o.material && o.material.transparent)) return;
    o.updateMatrixWorld(true); const pa = o.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
      if (v.y < 0.05 || v.y > 2.2) continue;
      // (2026-10-06 (11): the hollow service garage's piers / walls have vertices only at floor and lintel height, so "box has geometry" looks at the whole 0.05..2.2 m band, the cover ratio at 0.3..1.2 m as before)
      if (v.y < 0.3 || v.y > 1.2) { own.forEach((e, k) => { closest[k] = Math.min(closest[k], dist(e, v.x, v.z)); }); continue; }
      let d = 1e9; own.forEach((e, k) => { const dd = dist(e, v.x, v.z); d = Math.min(d, dd); closest[k] = Math.min(closest[k], dd); });
      tot++; if (d <= 0.1) near++; else worst = Math.max(worst, d);
    }
  });
  meas.cover = +(near / Math.max(1, tot)).toFixed(3); meas.coverN = tot; meas.worst = +worst.toFixed(2); meas.boxGap = +Math.max(...closest).toFixed(2);
  const cx = -8.70 + INDUSTRIAL_ZONE_OFFSET_X, cz = 6.72;
  const entries = gatherPhysicsCircles().filter((e) => e.category !== 'vehicle' && !String(e.label || '').startsWith('vehicle') && e.kind !== 'vehicle');
  const saved = playerVelocity.clone(), walk = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
    let x = cx + dx * 9, z = cz + dz * 9, reached = false, inLot = false;
    for (let s = 0; s < 130; s++) { playerVelocity.set(-dx * 4, 0, -dz * 4); const r = resolvePlayerCircleCollisions(x - dx * 0.1, z - dz * 0.1, entries); x = r.x; z = r.z; if (Math.hypot(x - cx, z - cz) < 0.6) reached = true; if (Math.abs(x - cx) < 5.4 && z > 5.2 && z < 7.6) inLot = true; }
    walk.push({ a: Math.round(a * 180 / Math.PI), reached, inLot });
  }
  playerVelocity.copy(saved);
  const homes = Object.values(__TYCOON_V65_TRAFFIC__.homes).map((v) => P.blockedAt(v.x, v.z));
  return { meas, own: own.length, flags: own.every((e) => e.flags.player && e.flags.agent && !e.flags.placement && !e.flags.camera), walk, homes: homes.map((h) => h.hit) };
});
check(!!fyRow, 'fleet yard: the live group v116FleetYard exists in the late world');
console.log('fleet yard:', J({ meshes: fyRow.meas.meshes, minY: fyRow.meas.minY, cover: fyRow.meas.cover, of: fyRow.meas.coverN, worst: fyRow.meas.worst, boxGap: fyRow.meas.boxGap, boxes: fyRow.own, walk: fyRow.walk.map((w) => [w.a, w.reached]) }));
check(fyRow.meas.meshes <= 16, `fleet yard: <= 16 meshes (${fyRow.meas.meshes}; before 47: 40 loose fence / post / bay meshes)`);
check(fyRow.meas.minY >= -0.05 && fyRow.meas.minY <= 0.05, `fleet yard: nothing floating or sunk, min y ${fyRow.meas.minY}`);
check(fyRow.own >= 8 && fyRow.flags, `fleet yard: ${fyRow.own} real boxes (fence runs, pillars, garage, booth, pump, wash stand, gate leaf) in the registry, player + agent only (before: the fence was not solid - a player walked through it from every side)`);
check(fyRow.meas.cover >= 0.9 && fyRow.meas.boxGap <= 0.35, `fleet yard: the boxes cover >= 90 % of the drawn solid fence / walls (${fyRow.meas.cover} of ${fyRow.meas.coverN} vertices within 10 cm, the farthest uncovered one ${fyRow.meas.worst} m) and no box stands where nothing is drawn (every box has geometry within ${fyRow.meas.boxGap} m <= 0.35 m)`);
check(fyRow.walk.filter((w) => !w.reached).map((w) => w.a).sort((p, q) => p - q).join() === '0,45,90,270,315' && fyRow.walk.filter((w) => !w.reached).every((w) => !w.inLot) && fyRow.walk.filter((w) => w.reached).map((w) => w.a).sort((p, q) => p - q).join() === '135,180,225', `fleet yard: the fence blocks the walk-in from N / NE / E / W / NW and lets the player in only through the open mouth along the service lane (SE / S / SW): ${J(fyRow.walk.map((w) => [w.a, w.reached]))}`);
check(fyRow.homes.length === 6 && fyRow.homes.every((h) => !h), 'fleet yard: the six parking points (truck homes) stand outside every collider');

// ------------------------------------------------------------------------------------------------ B2. industrial plants (family #2, 2026-10-05 (6)): HARD
// Each plant is rebuilt by the game's own path at production level 1/2/3 and measured with the colliders it OWNS in the real registry (owner === root): the oriented boxes
// of its walls / machines. The old STATIC_COLLIDERS circle stays for roads and placement only (no player / agent flag).
const PLANT_BUDGET = { sawmill: 26, concrete: 16, metal: 20, frame: 12 }; // meshes (= draw calls of the plant) at any level; before: 22-24 / 74 / 14 / 11
const levels0 = await ev(() => ({ ...industrialLevelsV161 }));
const plantRows = [];
for (const kind of ['sawmill', 'concrete', 'metal', 'frame']) {
  for (const L of kind === 'frame' ? [1] : [1, 2, 3]) {
    if (kind !== 'frame') await ev(({ kind, L }) => { industrialLevelsV161[kind] = L; refreshIndustrialBadgesV161(); }, { kind, L });
    const views = SHOTS && [1, 3].includes(L) ? ['front', 'iso'] : [];
    const r = await ev(({ kind, L, views }) => {
      const P = __BLD_PROBE__, reg = __TYCOON_V83_COLLISIONS__.registry;
      const root = { sawmill: () => scene.getObjectByName('v161SawmillMill'), concrete: () => concretePlant.group, metal: () => metalPlant.group, frame: () => PRODUCTION_CHAIN_V161.prop().group }[kind]();
      root.updateMatrixWorld(true);
      const own = P.ownEntries(root), meas = P.measure(root, own);
      const pos = root.position;
      const circles = [...reg.values()].filter((e) => e.shape === 'circle' && e.category === 'industrial' && Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) < 0.01);
      const step = (id) => { try { const st = industrialStepV118(id); return st && st.pos ? st.pos : null; } catch (e) { return null; } };
      const padsOf = {
        sawmill: [['pickup:planks', LOGISTICS_ZONES.planks.pos], ['dropoff', SAWMILL_DROPOFF_POS], ['pad:sawmill build', SAWMILL_PAD_POS_V118], ['pad:sawmill2', SAWMILL_UPGRADE_PAD_POS_V161], ['pad:sawmill3', step('sawmill3')]],
        concrete: [['pickup:concrete', LOGISTICS_ZONES.concrete.pos], ['pad:concrete build', CONCRETE_PAD_POS_V118], ['pad:concrete2', CONCRETE_UPGRADE_PAD_POS_V161], ['pad:concrete3', step('concrete3')]],
        metal: [['pickup:metal', LOGISTICS_ZONES.metal.pos], ['pad:metal build', METAL_PAD_POS_V118], ['pad:metal2', METAL_UPGRADE_PAD_POS_V161], ['pad:metal3', step('metal3')]],
        frame: [['pad:frame', step('frame')]],
      }[kind];
      const mine = scene.getObjectByName('manualMineV119_' + kind);
      if (mine) { padsOf.push(['mine:' + kind, mine.position]); }
      const pads = padsOf.filter((q) => q[1]).map(([id, v]) => ({ id, x: +v.x.toFixed(2), z: +v.z.toFixed(2), b: P.blockedAt(v.x, v.z) }));
      const out = { meas, pads, own: own.length, circlesSolid: circles.filter((e) => e.flags.player || e.flags.agent).length, circlesPlacement: circles.filter((e) => e.flags.placement).length, circles: circles.length, mineMinY: mine ? P.measureLive(mine).minY : null, level: root.userData.levelV161 || null };
      if (kind === 'sawmill') { const w = root.localToWorld(new THREE.Vector3(1.0, 0, 0.5)); out.bay = P.blockedAt(w.x, w.z); const m = root.localToWorld(new THREE.Vector3(0.5, 0, -0.9)); out.mach = P.blockedAt(m.x, m.z); }
      if (views.length) out.shots = P.shoot(root, views).shots;
      delete meas.colliders;
      return out;
    }, { kind, L, views });
    if (r.shots) for (const [v, url] of Object.entries(r.shots)) fs.writeFileSync(path.join(SHOTS, `plant-${kind}-L${L}-${v}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    plantRows.push({ kind, L, ...r });
  }
}
await ev((lv) => { for (const k of Object.keys(lv)) industrialLevelsV161[k] = lv[k]; refreshIndustrialBadgesV161(); }, levels0);
const pl = (r) => `${r.kind} L${r.L}`;
const pbad = (pred) => plantRows.filter((r) => !pred(r)).map(pl);
let pb;
pb = pbad((r) => r.meas.minY >= -0.05 && r.meas.minY <= 0.05);
check(pb.length === 0, `plants: nothing floating or sunk, min y within 5 cm for every plant and level (${pb.length} bad ${J(pb)}; min y range ${Math.min(...plantRows.map((r) => r.meas.minY))}..${Math.max(...plantRows.map((r) => r.meas.minY))})`);
pb = pbad((r) => r.mineMinY === null || Math.abs(r.mineMinY) <= 0.05);
check(pb.length === 0, `plants: the manual mines stand ON their pad, min y ${J(plantRows.filter((r) => r.mineMinY !== null).map((r) => [r.kind, r.mineMinY]))} (was -0.12 / -0.20: rocks and scrap sunk into the pad)`);
pb = pbad((r) => r.meas.overlap !== null && r.meas.overlap >= 0.9);
check(pb.length === 0, `plants: the colliders cover >= 90 % of the walls / machines (${pb.length} bad ${J(pb)}; worst ${Math.min(...plantRows.map((r) => r.meas.overlap))}; concrete circle before: 85 %, 0.94 m2 uncovered)`);
pb = pbad((r) => r.meas.outsideMax <= 1.0);
check(pb.length === 0, `plants: no collider extends more than 1.0 m beyond the walls (worst ${Math.max(...plantRows.map((r) => r.meas.outsideMax))} m; the circles were up to 1.1-1.41 m)`);
pb = pbad((r) => r.meas.sweepReached === 0);
check(pb.length === 0, `plants: the player walked at the centre from 8 directions never stands inside a wall or machine (${pb.length} bad ${J(pb)})`);
pb = pbad((r) => r.own >= 3 && r.circlesSolid === 0 && r.circlesPlacement === r.circles && r.circles >= 1);
check(pb.length === 0, `plants: real boxes are the player/agent colliders (${J(plantRows.map((r) => [pl(r), r.own]))}); the old circle is placement-only (road/decor planning keeps its radius)`);
pb = pbad((r) => r.pads.every((q) => !q.b.hit));
check(pb.length === 0, `plants: every pad / pickup / mine / badge spot of a plant stands outside every collider (${plantRows.reduce((a, r) => a + r.pads.length, 0)} checked; inside: ${J(plantRows.flatMap((r) => r.pads.filter((q) => q.b.hit).map((q) => [pl(r), q.id, q.b.by, q.b.moved])))}; the planks pad was pushed 0.85 m out of the stack box)`);
pb = pbad((r) => r.meas.meshes <= PLANT_BUDGET[r.kind]);
check(pb.length === 0, `plants: mesh (= draw call) budget ${J(PLANT_BUDGET)} (${J(Object.fromEntries(plantRows.map((r) => [pl(r), r.meas.meshes])))})`);
const mill = plantRows.filter((r) => r.kind === 'sawmill');
check(mill.every((r) => r.bay && !r.bay.hit && r.mach && r.mach.hit), `sawmill: the open log bay of the east gable is walkable (not pushed), the machinery block north of the carriage line is solid ${J(mill.map((r) => [r.bay && r.bay.hit, r.mach && r.mach.hit]))}`);
const lv = (k) => plantRows.filter((r) => r.kind === k);
check(lv('concrete').every((r, i, a) => i === 0 || r.meas.tris > a[i - 1].meas.tris) && lv('metal').every((r, i, a) => i === 0 || r.meas.tris > a[i - 1].meas.tris), `concrete and metal: every level adds parts to the SAME building (triangles ${J(lv('concrete').map((r) => r.meas.tris))} / ${J(lv('metal').map((r) => r.meas.tris))})`);
console.log('plant rows:', plantRows.map((r) => `${pl(r)}: meshes ${r.meas.meshes}, tris ${r.meas.tris}, min y ${r.meas.minY}, footprint ${r.meas.footprintArea} m2, collider ${r.meas.colliderArea} m2, overlap ${r.meas.overlap}, outside max ${r.meas.outsideMax} m, walk-in ${r.meas.sweepReached}/8, boxes ${r.own}`).join('\n  '));

// ------------------------------------------------------------------------------------------------ B3. market (family #3, 2026-10-05 (7)): HARD
// The late save has every stall built (old-format save: staged flags true), so the stalls are the real marketRuntimeV116 groups. Everything is read from the scene and the v83 registry.
const mk = await ev(() => {
  const P = __BLD_PROBE__, C = MARKET_PLAZA_CENTER_V116, out = { stalls: [], plaza: null };
  const plaza = scene.getObjectByName('marketPlazaV116');
  const lane = (from, to) => { // a player circle walked from -> to through the game's resolver, only registry entries (no vehicles): the largest push on the way
    const saved = playerVelocity.clone(); let worst = 0; const n = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1);
    const entries = gatherPhysicsCircles().filter((e) => e.category !== 'vehicle' && !String(e.label || '').startsWith('vehicle'));
    for (let i = 0; i <= n; i++) { const x = from.x + (to.x - from.x) * i / n, z = from.z + (to.z - from.z) * i / n; playerVelocity.set(0, 0, 0); const r = resolvePlayerCircleCollisions(x, z, entries); worst = Math.max(worst, Math.hypot(r.x - x, r.z - z)); }
    playerVelocity.copy(saved); return +worst.toFixed(3);
  };
  const pm = P.measure(plaza, P.ownEntries(plaza)); delete pm.colliders;
  const gate = plaza.userData.v161Gate;
  const around = [];
  for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, r = 3.3; around.push(P.blockedAt(C.x + Math.cos(a) * r, C.z + Math.sin(a) * r).moved); }
  out.plaza = { meas: pm, fountain: P.blockedAt(C.x, C.z), gate: P.blockedAt(C.x + gate.x, C.z + gate.z), gateInside: P.blockedAt(C.x + gate.x * 0.85, C.z + gate.z * 0.85), ring3: around.every((m) => m <= 0.01), own: P.ownEntries(plaza).length,
    gateLane: lane({ x: C.x + gate.x * 1.15, z: C.z + gate.z * 1.15 }, { x: C.x + Math.cos(gate.angle) * 2.2, z: C.z + Math.sin(gate.angle) * 2.2 }), gateSlot: gate.slot,
    freeGaps: [0, 1, 2, 3, 4, 5, 6].filter((i) => [-0.1, -0.05, 0, 0.05, 0.1].some((d) => { const a = -Math.PI / 2 + i * 2 * Math.PI / 7 + Math.PI / 7 + d; return lane({ x: C.x + Math.cos(a) * 7.4, z: C.z + Math.sin(a) * 7.4 }, { x: C.x + Math.cos(a) * 3.5, z: C.z + Math.sin(a) * 3.5 }) <= 0.01; })) };
  for (const cfg of MARKET_STALLS_V116) {
    const st = marketRuntimeV116.stalls.get(cfg.id), g = st.group; g.updateMatrixWorld(true);
    const D = MarketV161.SPEC[cfg.id], own = P.ownEntries(g), meas = P.measure(g, own); delete meas.colliders;
    const W = (x, z) => { const v = g.localToWorld(new THREE.Vector3(x, 0, z)); return { x: v.x, z: v.z }; };
    const at = (x, z) => P.blockedAt(W(x, z).x, W(x, z).z);
    const front = W(0, D.hd + 0.5), axis = new THREE.Vector3(C.x - cfg.pos.x, 0, C.z - cfg.pos.z).normalize();
    const start = { x: C.x - axis.x * 2.0, z: C.z - axis.z * 2.0 };       // just outside the fountain collider, on the stall's axis
    out.stalls.push({
      id: cfg.id, meas, own: own.length, flags: own.every((e) => e.flags.player && e.flags.agent && !e.flags.placement && !e.flags.camera && e.category === 'market'),
      counter: at(0, D.hd - 0.2), back: at(0, -D.hd + 0.04), left: at(-(D.hw - 0.04), 0), right: at(D.hw - 0.04, 0),
      front: [at(0, D.hd + 0.5), at(-D.hw * 0.6, D.hd + 0.5), at(D.hw * 0.6, D.hd + 0.5), at(0, D.hd + 1.2)],
      lane: lane(start, front), apron: at(0, D.hd + 0.8),
      target: (() => { player.position.set(front.x, 0, front.z); const t = nearestManualTargetV53(); return t && { type: t.type, id: t.stall?.id, dist: t.dist == null ? null : +t.dist.toFixed(2) }; })(),
      yawOk: Math.abs(g.rotation.y - cfg.facing) < 1e-6, legacyEntries: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === g && !String(e.label).includes('-v161:')).length,
      meshes: meas.meshes,
    });
  }
  player.position.set(0, 0, 0);
  return out;
});
const M = mk.stalls;
console.log('market plaza:', J({ meshes: mk.plaza.meas.meshes, minY: mk.plaza.meas.minY, overlap: mk.plaza.meas.overlap, outsideMax: mk.plaza.meas.outsideMax, reach: mk.plaza.meas.sweepReached, fountain: mk.plaza.fountain, gate: mk.plaza.gate }));
console.log('market stalls:\n  ' + M.map((s) => `${s.id}: meshes ${s.meshes}, tris ${s.meas.tris}, min y ${s.meas.minY}, overlap ${s.meas.overlap}, outside max ${s.meas.outsideMax}, walk-in ${s.meas.sweepReached}/8, boxes ${s.own}, lane push ${s.lane}`).join('\n  '));
check(M.length === 7 && M.every((s) => s.own >= 1 && s.flags && s.legacyEntries === 0), `market: 7 stalls, each with its own real boxes (${J(M.map((s) => [s.id, s.own]))}) flagged player+agent, no placement / camera flags (roads and decor planners read no new box), no whole-mesh legacy box`);
check(mk.plaza.meas.minY >= -0.05 && mk.plaza.meas.minY <= 0.05 && M.every((s) => s.meas.minY >= -0.05 && s.meas.minY <= 0.05), `market: nothing floating or sunk, min y within 5 cm: plaza ${mk.plaza.meas.minY}, stalls ${J(M.map((s) => s.meas.minY))} (the old plaza torus read -0.03)`);
check(M.every((s) => s.meas.overlap !== null && s.meas.overlap >= 0.9) && mk.plaza.meas.overlap >= 0.9, `market: colliders cover >= 90 % of the walls / props (stalls ${J(M.map((s) => s.meas.overlap))}, plaza ${mk.plaza.meas.overlap}); the old stalls had no collider at all (0 %)`);
check(M.every((s) => s.meas.outsideMax <= 1.0) && mk.plaza.meas.outsideMax <= 1.0, `market: no collider extends more than 1.0 m beyond what is drawn (worst stall ${Math.max(...M.map((s) => s.meas.outsideMax))} m, plaza ${mk.plaza.meas.outsideMax} m)`);
check(M.every((s) => s.meas.sweepReached === 0) && mk.plaza.meas.sweepReached === 0, `market: the player walked at the centre from 8 directions never gets inside a stall (reach ${J(M.map((s) => s.meas.sweepReached))}; was 6-8 of 8 for every old stall)`);
check(M.every((s) => s.counter.hit && s.back.hit && s.left.hit && s.right.hit), `market: counter, back wall and both side panels are solid (a player circle on them is pushed out: ${J(M.map((s) => [s.id, s.counter.moved, s.back.moved]))})`);
check(M.every((s) => s.front.every((f) => !f.hit) && !s.apron.hit), `market: the customer side in front of the counter is open and walkable up to it (0.5 m from the counter plane: ${J(M.map((s) => [s.id, s.front.map((f) => f.moved)]))})`);
check(M.every((s) => s.lane <= 0.01), `market: the lane from the plaza centre (just outside the fountain) to the front of every stall is free, largest push ${J(M.map((s) => [s.id, s.lane]))} m`);
check(M.every((s) => s.target && s.target.type === 'stall' && s.target.id === s.id), `market: standing in front of the counter a stall is the interaction target of the real nearestManualTargetV53 (pad / trigger reachable with the colliders in place: ${J(M.map((s) => s.target))})`);
check(M.every((s) => s.yawOk), 'market: every stall keeps its configured facing (group.rotation.y == cfg.facing: the counter faces the plaza centre)');
check(mk.plaza.fountain.hit && mk.plaza.fountain.moved >= 1.0 && !mk.plaza.gate.hit && !mk.plaza.gateInside.hit && mk.plaza.ring3 && mk.plaza.gateLane <= 0.01 && mk.plaza.freeGaps.length >= 3 && mk.plaza.freeGaps.includes(mk.plaza.gateSlot), `market plaza (free ways in between the stalls: ${J(mk.plaza.freeGaps)} of 7 gaps, the gate gap among them): the fountain is solid (a player on its centre is pushed ${mk.plaza.fountain.moved} m out), the entrance gate is walkable (${J([mk.plaza.gate.moved, mk.plaza.gateInside.moved])}) and the lane from the gate to the fountain is free (largest push ${mk.plaza.gateLane} m, gate in the gap after stall slot ${mk.plaza.gateSlot}), the ring at r = 3.3 m is free (${mk.plaza.ring3})`);
check(M.every((s) => s.meshes <= 8) && mk.plaza.meas.meshes <= 10, `market: mesh (= draw call) budget <= 8 per stall, <= 10 plaza (stalls ${J(M.map((s) => s.meshes))}, plaza ${mk.plaza.meas.meshes}; before: 11 per stall, 32 plaza (12 objects, the 4 lamps are 2 meshes each))`);

// ------------------------------------------------------------------------------------------------ B4. suburb district (backlog #4, 2026-10-05 (8)): HARD
// The late world has the suburb identity group (cityWorldRuntime.districtIdentity 'suburb'): lawn + path, 4+lv trees, 3 planters, 2+lv mini houses on the old ring. Numbers are read from the scene
// and the v83 registry; the same group is rebuilt with BuildingsV161.enabled = false for the before numbers.
const sub = await ev(() => {
  const P = __BLD_PROBE__, g = P.suburbGroup();
  if (!g) return null;
  g.updateMatrixWorld(true);
  const count = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const houses = P.suburbEntries(g, 'house'), trees = P.suburbEntries(g, 'tree');
  const meas = P.measure(g, houses, { sweep: false });
  const inside = (e, x, z) => { const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw), dx = x - e.pos.x, dz = z - e.pos.z, lx = dx * cy - dz * sy, lz = dx * sy + dz * cy; return Math.abs(lx) < e.hx - 0.05 && Math.abs(lz) < e.hz - 0.05; };
  const saved = playerVelocity.clone();
  let walks = 0, reached = 0;
  for (const e of houses) for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a), R = e.radius + 2.5;
    let x = e.pos.x + dx * R, z = e.pos.z + dz * R, hit = false;
    for (let s = 0; s < Math.ceil(R / 0.1) + 30; s++) { playerVelocity.set(-dx * 4, 0, -dz * 4); const r = resolvePlayerCircleCollisions(x - dx * 0.1, z - dz * 0.1, houses); x = r.x; z = r.z; if (inside(e, x, z)) hit = true; }
    walks++; if (hit) reached++;
  }
  playerVelocity.copy(saved);
  const obbDist = (e, x, z) => { const sy = Math.sin(e.yaw), cy = Math.cos(e.yaw), dx = x - e.pos.x, dz = z - e.pos.z, lx = dx * cy - dz * sy, lz = dx * sy + dz * cy; return Math.hypot(Math.max(0, Math.abs(lx) - e.hx), Math.max(0, Math.abs(lz) - e.hz)); };
  const treeGap = Math.min(...trees.flatMap((t) => houses.map((h) => obbDist(h, t.pos.x, t.pos.z))));
  const flags = [...houses, ...trees].every((e) => e.flags.player && e.flags.agent && !e.flags.placement && !e.flags.camera);
  const trunkSolid = trees.every((t) => P.blockedAt(t.pos.x, t.pos.z).hit);
  const lv = districtLevel('suburb');
  const now = { meshes: count(g), minY: meas.minY, tris: meas.tris, overlap: meas.overlap, outsideMax: meas.outsideMax, outside: meas.outside, uncovered: meas.uncovered };
  // before: the old group
  BuildingsV161.enabled = false; refreshDistrictIdentityWorldV363();
  const og = P.suburbGroup(), oldM = og ? { meshes: count(og), minY: P.measure(og, [], { sweep: false }).minY } : null;
  BuildingsV161.enabled = true; refreshDistrictIdentityWorldV363(); __TYCOON_V83_COLLISIONS__.rebuild();
  return { lv, now, old: oldM, houses: houses.length, trees: trees.length, nHouses: g.userData.v161Houses, nTrees: g.userData.v161Trees, variants: g.userData.v161Variants, reached, walks, treeGap: +treeGap.toFixed(2), flags, trunkSolid, pos: g.position.toArray() };
});
check(!!sub, 'suburb: the district identity group exists in the late world');
console.log('suburb:', J(sub));
check(sub.nHouses === 2 + sub.lv && sub.nTrees === 4 + sub.lv, `suburb: the ring keeps its count (level ${sub.lv}: ${sub.nHouses} houses = 2 + lv, ${sub.nTrees} trees = 4 + lv)`);
check(sub.houses >= sub.nHouses && sub.flags, `suburb: every house has real wall boxes (${sub.houses} for ${sub.nHouses} houses, sheds included) and every trunk a circle in the registry, player + agent only (no placement / camera: roads and decor planners read nothing new; before: no collider at all, walk-through from 5 of 8 directions)`);
check(sub.walks >= 8 * sub.nHouses && sub.reached === 0, `suburb: the player walked at every house wall box from 8 directions never gets inside (${sub.walks} walks, ${sub.reached} reached)`);
check(sub.now.minY >= -0.05 && sub.now.minY <= 0.05, `suburb: nothing floating or sunk, min y ${sub.now.minY} (before ${sub.old && sub.old.minY}: the trees were sunk)`);
check(sub.now.overlap !== null && sub.now.overlap >= 0.9 && sub.now.outsideMax <= 0.3, `suburb: the wall boxes cover >= 90 % of the house footprint (${sub.now.overlap}, ${sub.now.uncovered} m2 uncovered) and stick out at most 0.3 m (${sub.now.outsideMax} m)`);
check(sub.trunkSolid && sub.treeGap >= 0.9, `suburb: tree trunks are solid and every trunk is >= 0.9 m from every house wall (closest ${sub.treeGap} m: no crown inside a house)`);
check(sub.now.meshes <= 8 && sub.old && sub.now.meshes < sub.old.meshes / 5, `suburb: ${sub.now.meshes} meshes per district (before ${sub.old && sub.old.meshes}; goal well under 60)`);
check(new Set(sub.variants).size === Math.min(3, sub.nHouses), `suburb: the houses use ${new Set(sub.variants).size} distinct variants (${J(sub.variants)}) so the ring does not look cloned`);

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
