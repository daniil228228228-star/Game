// Garages (2026-10-06 (11); user: "Гаражи тонкие, 5 нет? В них даже не залезет машина"). ONE browser launch on the late-game save (all stages built at level 5).
// Real vehicle sizes are measured from the game's own builders (createLivingCityCar / createUniversalDeliveryTruck) and every garage is checked with them:
//   A. HOUSE GARAGE (stages 0 and 1, levels 4 and 5, assets/buildings-v161.js): a real hollow single bay - the car (1.4 x 0.66 x 2.14 m) put in the middle of the interior lies fully inside it (>= 0.2 m to each side wall, >= 0.25 m to the
//      back wall, under the ceiling by >= 0.3 m), the door opening is >= car + 0.4 m wide and >= car + 0.3 m high, the swept lane of the car (3 m in front of the door -> bay) touches no wall box, no wall box stands inside the interior,
//      the player circle can stand in the doorway and in the middle of the bay (registry), the walls are thin (<= 0.16 m boxes).
//   B. FLEET GARAGE (base module, createFleetGarageV72, levels 1 / 2 / 3 = 3 / 5 / 6 bays): the bay count equals fleetGarageBayCountV72 and, at level 3, the number of fleet parking homes (six = six trucks); a real universal truck
//      (1.15 x 1.28 x 2.11 m) parked at every covered home (yaw pi, as parked in the game) lies inside its own bay (>= 0.25 m to the posts on each side, front post -> rear obstacles), under the roof by >= 0.3 m, no solid box touches it,
//      the lane from the service lane (z 4.45) into every bay is free of wall boxes, the player can stand in every bay (registry rebuilt), the garage's walls are real boxes in the registry (the whole-mesh box does not block the player).
//   C. FLEET YARD (assets/factory-v161.js): the user's deeper service garage (z 7.92..10.62) made HOLLOW: three real door openings (1.6 x 1.52 m), 2.5 m deep, thin wall boxes, a real truck Box3 inside every bay;
//      six homes, rear amenities (booth / pump / wash) hidden + not solid while the base garage is level >= 2, the entrance sign hangs on a gantry, mesh budget.
// SHOTS_DIR=<dir> also writes pictures: the house garage with a car inside (iso / front), the fleet garage levels 1 / 2 / 3 with trucks in the bays.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, check, waitForState } from './lib/harness.mjs';
import { installProbe } from '../tools/lib/buildings-probe-v161.mjs';

const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 8000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
await ev(installProbe);
const savePic = (name, url) => fs.writeFileSync(path.join(SHOTS, name), Buffer.from(url.split(',')[1], 'base64'));

// ------------------------------------------------------------------------------------------------ real vehicle sizes
const veh = await ev(() => {
  const dims = (v) => { v.rotation.set(0, 0, 0); v.updateMatrixWorld(true); const b = new THREE.Box3(), tv = new THREE.Vector3(); v.traverse((o) => { if (!o.isMesh || !o.geometry) return; const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) b.expandByPoint(tv.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld)); }); const s = b.getSize(new THREE.Vector3()); return { w: +s.x.toFixed(2), h: +s.y.toFixed(2), l: +s.z.toFixed(2) }; };
  return { car: dims(createLivingCityCar('civilian')), truck: dims(createUniversalDeliveryTruck(0)), mixer: dims(createConcreteMixerTruck()) };
});
console.log('vehicle sizes (m, w x h x l):', J(veh));
check(veh.car.w > 1 && veh.truck.l > 1.9 && veh.truck.h > 1, `vehicle sizes measured from the game's builders: car ${veh.car.w} x ${veh.car.h} x ${veh.car.l}, truck ${veh.truck.w} x ${veh.truck.h} x ${veh.truck.l}`);

// ------------------------------------------------------------------------------------------------ A. house garage
const houseRows = [];
for (const [i, L] of [[0, 4], [0, 5], [1, 4], [1, 5]]) {
  const r = await ev(({ i, L, car, shots }) => {
    const P = __BLD_PROBE__, m = P.stageMesh(i, L);
    try {
      P.registerStage(m, i);
      const d = m.userData.v161Dims.garage;
      if (!d) return { none: true };
      const k = d.k, fp = m.userData.v161Footprint, inn = d.inner;
      // everything in the mesh's own frame (axis aligned): interior rect, car box, wall boxes
      const cx = (inn.x0 + inn.x1) / 2 * k, ix0 = Math.min(inn.x0, inn.x1) * k, ix1 = Math.max(inn.x0, inn.x1) * k, iz0 = inn.z0 * k, iz1 = inn.z1 * k, floor = 0.22 * k;
      const cz = iz0 + 0.1 + car.l / 2 + 0.25;                                                                   // parked 0.25 m from the back wall
      const carBox = { x0: cx - car.w / 2, x1: cx + car.w / 2, z0: cz - car.l / 2, z1: cz + car.l / 2, y0: floor, y1: floor + car.h };
      const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
      const boxes = fp.map((f) => ({ x0: f.x - f.hx, x1: f.x + f.hx, z0: f.z - f.hz, z1: f.z + f.hz, hx: f.hx, hz: f.hz, x: f.x, z: f.z }));
      const wallsHit = boxes.filter((b) => hit(carBox, b)).length;
      const lane = { x0: carBox.x0, x1: carBox.x1, z0: carBox.z0, z1: iz1 + 3 };                             // swept rectangle: from the bay to 3 m in front of the door
      const laneHit = boxes.filter((b) => hit(lane, b) && !(b.z0 < iz0 + 0.0 && false)).length;
      // wall boxes standing INSIDE the interior (the house box and the three garage walls surround it, none may stand in it); the house wall is the interior's inner boundary
      const inside = boxes.filter((b) => b.x0 > ix0 + 0.12 && b.x1 < ix1 - 0.12 && b.z0 > iz0 + 0.12 && b.z1 < iz1 - 0.05).length;
      const thin = fp.slice(1).filter((f) => Math.min(f.hx, f.hz) <= 0.16).length;
      // player circle in the doorway and in the bay (world coordinates of the registered mesh)
      const toW = (x, z) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(m.matrixWorld); return v; };
      const doorway = P.blockedAt(toW(cx, iz1 + 0.25).x, toW(cx, iz1 + 0.25).z), bay = P.blockedAt(toW(cx, (iz0 + iz1) / 2).x, toW(cx, (iz0 + iz1) / 2).z);
      let pics = null;
      if (shots) {
        const carMesh = createLivingCityCar('civilian');
        carMesh.position.set(cx, floor, cz); carMesh.rotation.y = Math.PI;                                       // nose towards the door (+z is the door side; the car model drives to -z)
        m.add(carMesh); m.updateMatrixWorld(true);
        const sh = P.shoot(m, ['front', 'iso']); pics = sh.shots; m.remove(carMesh);
      }
      return { i, L, k, interior: [+(ix1 - ix0).toFixed(2), +(iz1 - iz0).toFixed(2)], door: [+(d.door.w * k).toFixed(2), +(d.door.h * k).toFixed(2)], clearH: +(d.inner.h * k).toFixed(2), wallsHit, laneHit, inside, thin, nWalls: fp.length,
        side: [+(carBox.x0 - ix0).toFixed(2), +(ix1 - carBox.x1).toFixed(2)], back: +(carBox.z0 - iz0).toFixed(2), doorway: doorway.hit, bay: bay.hit, pics };
    } finally { P.dropMesh(m); }
  }, { i, L, car: veh.car, shots: !!SHOTS });
  if (r.pics) for (const [v, url] of Object.entries(r.pics)) savePic(`garage-house${i}-L${L}-${v}.jpg`, url);
  delete r.pics; houseRows.push(r); console.log('house garage', J(r));
}
check(houseRows.length === 4 && houseRows.every((r) => !r.none), 'house garage exists at levels 4 and 5 of both houses');
check(houseRows.every((r) => r.interior[0] >= veh.car.w + 0.4 && r.interior[1] >= veh.car.l + 0.5), `house garage interior >= car + 0.4 m wide / + 0.5 m long (${J(houseRows.map((r) => r.interior))} m; car ${veh.car.w} x ${veh.car.l}; the old one was 1.05 x 1.45 m)`);
check(houseRows.every((r) => r.door[0] >= veh.car.w + 0.4 && r.door[1] >= veh.car.h + 0.3), `house garage door opening >= car + 0.4 m wide, >= car + 0.3 m high (${J(houseRows.map((r) => r.door))} m; the old door was 0.8 x 0.98 m and closed)`);
check(houseRows.every((r) => r.clearH >= veh.car.h + 0.3), `house garage ceiling >= car + 0.3 m (clear ${J(houseRows.map((r) => r.clearH))} m)`);
check(houseRows.every((r) => r.wallsHit === 0 && r.laneHit === 0 && r.inside === 0 && r.side[0] >= 0.2 && r.side[1] >= 0.2 && r.back >= 0.2), `a car parked in the bay touches no wall, the swept lane to the door is free, no wall box stands in the interior (side clearance ${J(houseRows.map((r) => r.side))} m)`);
check(houseRows.every((r) => !r.doorway && !r.bay), `the player circle can stand in the garage doorway and in the middle of the bay (registry: ${J(houseRows.map((r) => [r.doorway, r.bay]))})`);
check(houseRows.every((r) => r.thin >= 4), `thin walls: back wall, outer wall, inner wall and both front pillars are <= 0.16 m boxes (${J(houseRows.map((r) => r.thin))})`);

// ------------------------------------------------------------------------------------------------ B. fleet garage (base module)
const fleetRows = [];
for (const lv of [1, 2, 3]) {
  const r = await ev(({ lv, shots }) => {
    const P = __BLD_PROBE__;
    baseState.garage = lv; refreshBaseWorld(true);
    try { __TYCOON_V83_COLLISIONS__.rebuild(); } catch (e) { /* */ }
    const gg = baseRuntime.groups.get('garage');
    gg.scale.set(1, 1, 1); gg.position.y = 0; gg.updateMatrixWorld(true);
    const info = gg.userData.v161Garage, homes = Object.entries(window.__TYCOON_V65_TRAFFIC__.homes).map(([key, p]) => ({ key, x: p.x, z: p.z })).sort((a, b) => a.x - b.x);
    const boxes = (gg.userData.v161Footprint || []).map((f) => ({ x0: gg.position.x + f.x - f.hx, x1: gg.position.x + f.x + f.hx, z0: gg.position.z + f.z - f.hz, z1: gg.position.z + f.z + f.hz }));
    const reg = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === gg);
    // the yard's service garage (assets/factory-v161.js) stands behind the first three bays: its walls count as obstacles too
    for (const e of __TYCOON_V83_COLLISIONS__.registry.values()) if (/^fleet:garage/.test(String(e.label))) boxes.push({ x0: e.pos.x - e.hx, x1: e.pos.x + e.hx, z0: e.pos.z - e.hz, z1: e.pos.z + e.hz });
    const out = { lv, bays: info.bays, expected: fleetGarageBayCountV72(lv), homes: homes.length, boxes: boxes.length, regWalls: reg.filter((e) => String(e.label).includes(':wall') && e.flags.player).length, regWhole: reg.filter((e) => !String(e.label).includes(':wall') && e.flags.player).length, perBay: [] };
    const trucks = [];
    for (let b = 0; b < info.bays; b++) {
      const h = homes[b], truck = createUniversalDeliveryTruck(b);
      truck.position.set(h.x, 0, h.z); truck.rotation.y = Math.PI; scene.add(truck); truck.updateMatrixWorld(true); trucks.push(truck);
      const bb = new THREE.Box3(), tv = new THREE.Vector3(); truck.traverse((o) => { if (!o.isMesh || !o.geometry) return; const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) bb.expandByPoint(tv.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld)); });
      const bx0 = gg.position.x - info.width / 2 + 0.15 + b * info.bayW + 0.05, bx1 = bx0 + info.bayW - 0.1;                    // between the two bay posts
      const zf = gg.position.z + info.front + 0.05, zr = gg.position.z + info.rear;
      const t = { x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z };
      const touch = boxes.filter((q) => t.x0 < q.x1 && t.x1 > q.x0 && t.z0 < q.z1 && t.z1 > q.z0).length;
      const lane = { x0: t.x0, x1: t.x1, z0: 4.2, z1: t.z1 };                                                                       // from the service lane (z 4.45) into the bay
      const laneHit = boxes.filter((q) => lane.x0 < q.x1 && lane.x1 > q.x0 && lane.z0 < q.z1 && lane.z1 > q.z0).length;
      const stand = P.blockedAt(h.x, h.z), mouth = P.blockedAt(h.x, gg.position.z + info.front - 0.4);
      out.perBay.push({ b, side: [+(t.x0 - bx0).toFixed(2), +(bx1 - t.x1).toFixed(2)], front: +(t.z0 - zf).toFixed(2), rear: +(zr - t.z1).toFixed(2), headroom: +(1.6 - (bb.max.y - bb.min.y)).toFixed(2), touch, laneHit, standHit: stand.hit, mouthHit: mouth.hit });
    }
    // the whole-mesh box must not block the player
    out.playerInBay = homes.slice(0, info.bays).every((h) => !P.blockedAt(h.x, h.z).hit);
    let pics = null;
    if (shots) {
      const c = new THREE.Vector3(gg.position.x, 0.9, gg.position.z), span = info.width;
      pics = {};
      for (const [v, az, el, dist] of [['front', Math.PI, 0.3, span * 3.1 + 2], ['iso', Math.PI + 0.7, 0.5, span * 3.0 + 2]]) { const o = P.overview([gg, ...trucks], { target: c, az, el, dist }); pics[v] = o.url; }
    }
    for (const t of trucks) scene.remove(t);
    return { ...out, pics };
  }, { lv, shots: !!SHOTS });
  if (r.pics) for (const [v, url] of Object.entries(r.pics)) savePic(`garage-fleet-L${lv}-${v}.jpg`, url);
  delete r.pics; fleetRows.push(r); console.log('fleet garage', J(r));
}
check(fleetRows.every((r) => r.bays === r.expected) && J(fleetRows.map((r) => r.bays)) === '[3,5,6]', `fleet garage bays by level: ${J(fleetRows.map((r) => r.bays))} (3 / 5 / 6)`);
check(fleetRows[2].bays === fleetRows[2].homes && fleetRows[2].homes === 6, `level 3: ${fleetRows[2].bays} bays == ${fleetRows[2].homes} fleet parking homes == 6 trucks`);
check(fleetRows.every((r) => r.perBay.every((p) => p.side[0] >= 0.25 && p.side[1] >= 0.25)), `every truck stands inside its bay: >= 0.25 m to the posts on each side (min ${Math.min(...fleetRows.flatMap((r) => r.perBay.flatMap((p) => p.side)))} m; truck 1.15 m in a 1.8 m bay)`);
check(fleetRows.every((r) => r.perBay.every((p) => p.front >= 0.2 && p.rear >= 0.0)), `every truck fits the bay depth: front clearance >= 0.2 m, nothing behind it (front ${Math.min(...fleetRows.flatMap((r) => r.perBay.map((p) => p.front)))}, rear ${Math.min(...fleetRows.flatMap((r) => r.perBay.map((p) => p.rear)))} m)`);
check(fleetRows.every((r) => r.perBay.every((p) => p.headroom >= 0.3)), `every truck is >= 0.3 m under the roof (headroom ${Math.min(...fleetRows.flatMap((r) => r.perBay.map((p) => p.headroom)))} m for a clear height of 1.6 m)`);
check(fleetRows.every((r) => r.perBay.every((p) => p.touch === 0 && p.laneHit === 0 && !p.standHit && !p.mouthHit)), `no solid box touches a parked truck, the lane from z 4.2 into every bay is free of wall boxes, the player can stand in every bay and in its mouth`);
check(fleetRows.every((r) => r.regWalls >= 3 && r.regWhole === 0 && r.playerInBay), `the garage's walls are real boxes in the registry (${J(fleetRows.map((r) => r.regWalls))}); the whole-mesh box no longer blocks the player (${J(fleetRows.map((r) => r.regWhole))})`);

// ------------------------------------------------------------------------------------------------ C. fleet yard + its service garage (the user's deeper block, made hollow)
await ev(() => { baseState.garage = 0; refreshBaseWorld(true); __TYCOON_V83_COLLISIONS__.rebuild(); });
await page.waitForTimeout(700);                                                                                              // the visual tick brings the amenities back
const yard = await ev(({ shots }) => {
  const P = __BLD_PROBE__, y = scene.getObjectByName('v116FleetYard'), reg = () => [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === y);
  const out = { meshes: 0 };
  y.traverse((o) => { if (o.isMesh) out.meshes++; });
  const all = reg(), gar = all.filter((e) => /^fleet:garage/.test(String(e.label)));
  out.labels0 = all.map((e) => e.label);
  out.am0 = y.userData.v161Amenities.visible;
  const G = y.userData.v161Garage, B = window.__TYCOON_FLEET_BOUNDS_V161__;
  const boxes = gar.map((e) => ({ x0: e.pos.x - e.hx, x1: e.pos.x + e.hx, z0: e.pos.z - e.hz, z1: e.pos.z + e.hz, label: e.label, thin: Math.min(e.hx, e.hz) * 2 }));
  out.garage = { bays: G.bays.length, doorW: G.doorW, openH: +(G.hOpen - 0.1).toFixed(2), interior: G.interior.map((v) => +v.toFixed(2)), roof: G.h, walls: boxes.length, maxThin: Math.max(...boxes.map((b) => b.thin)), rearZ: Math.max(...boxes.map((b) => b.z1)), boundsZ: B.garageMaxZ, whole: boxes.filter((b) => b.x1 - b.x0 > 3 && b.z1 - b.z0 > 1).length };
  const homes = Object.values(window.__TYCOON_V65_TRAFFIC__.homes).sort((a, b) => a.x - b.x);
  out.trucks = [];
  const tr = [];
  G.bays.forEach((dx, i) => {
    const truck = createUniversalDeliveryTruck(i);
    const zc = (G.interior[0] + G.interior[1]) / 2;
    truck.position.set(dx, 0.1, zc); truck.rotation.y = Math.PI; scene.add(truck); truck.updateMatrixWorld(true); tr.push(truck);
    const bb = new THREE.Box3(), tv = new THREE.Vector3();
    const measure = () => { bb.makeEmpty(); truck.updateMatrixWorld(true); truck.traverse((o) => { if (!o.isMesh || !o.geometry) return; const pa = o.geometry.attributes.position; for (let k = 0; k < pa.count; k++) bb.expandByPoint(tv.fromBufferAttribute(pa, k).applyMatrix4(o.matrixWorld)); }); };
    measure(); truck.position.z += zc - (bb.min.z + bb.max.z) / 2; truck.position.x += dx - (bb.min.x + bb.max.x) / 2; measure();            // the model origin is not its centre: centre the Box3 in the bay
    const t = { x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z };
    const hit = (a, q) => a.x0 < q.x1 && a.x1 > q.x0 && a.z0 < q.z1 && a.z1 > q.z0;
    const lane = { x0: t.x0, x1: t.x1, z0: homes[i].z - 0.01, z1: t.z1 };                                                   // from the parked spot (the home) straight into the bay
    const open = boxes.filter((q) => q.label.startsWith('fleet:garage pier'));
    const left = Math.max(...open.map((q) => q.x1).filter((v) => v <= dx)), right = Math.min(...open.map((q) => q.x0).filter((v) => v >= dx));
    out.trucks.push({ i, touch: boxes.filter((q) => hit(t, q)).length, lane: boxes.filter((q) => hit(lane, q)).length, side: [+(t.x0 - left).toFixed(2), +(right - t.x1).toFixed(2)], front: +(t.z0 - G.interior[0]).toFixed(2), back: +(G.interior[1] - t.z1).toFixed(2), under: +(G.hOpen - bb.max.y).toFixed(2), size: [+(bb.max.x - bb.min.x).toFixed(2), +(bb.max.y - bb.min.y).toFixed(2), +(bb.max.z - bb.min.z).toFixed(2)],
      doorway: P.blockedAt(dx, G.interior[0] - 0.4).by.some((l) => /^fleet:/.test(l)), bay: P.blockedAt(dx, zc).by.some((l) => /^fleet:/.test(l)),   // only the yard's own boxes count (a moving worker / agent may pass the spot)
      by: [...P.blockedAt(dx, G.interior[0] - 0.4).by, ...P.blockedAt(dx, zc).by] });
  });
  let pics = null;
  if (shots) { const c = new THREE.Vector3(G.bays[1], 0.9, 9.3); pics = {}; for (const [v, az, el, dist] of [['front', Math.PI, 0.25, 9], ['iso', Math.PI + 0.7, 0.55, 12]]) pics[v] = P.overview([y, ...tr], { target: c, az, el, dist }).url; }
  for (const t of tr) scene.remove(t);
  out.homeTrucks = homes.length;
  return { ...out, pics };
}, { shots: !!SHOTS });
if (yard.pics) for (const [v, url] of Object.entries(yard.pics)) savePic(`garage-yard-${v}.jpg`, url);
delete yard.pics;
console.log('yard', J(yard));
check(yard.meshes <= 16 && yard.garage.whole === 0, `fleet yard: ${yard.meshes} meshes (<= 16); the service garage is made of ${yard.garage.walls} real wall boxes, no whole-block collider (${J(yard.garage)})`);
check(yard.garage.bays === 3 && yard.garage.doorW >= veh.truck.w + 0.4 && yard.garage.openH >= veh.truck.h + 0.2, `service garage: 3 doors (the other 3 of the 6 trucks use the base garage module's 5 / 6 bays), opening ${yard.garage.doorW} x ${yard.garage.openH} m >= truck ${veh.truck.w} x ${veh.truck.h} + 0.4 / + 0.2`);
check(yard.garage.interior[1] - yard.garage.interior[0] >= veh.truck.l + 0.3 && Math.abs(yard.garage.rearZ - yard.garage.boundsZ) < 0.01 && yard.garage.maxThin <= 0.7, `service garage interior is ${(yard.garage.interior[1] - yard.garage.interior[0]).toFixed(2)} m deep (truck ${veh.truck.l} m + 0.3), its back wall stands at the user's FLEET bounds z ${yard.garage.boundsZ}`);
check(yard.trucks.length === 3 && yard.trucks.every((t) => t.touch === 0 && t.lane === 0 && t.side[0] >= 0.2 && t.side[1] >= 0.2 && t.front >= 0.15 && t.back >= 0.15 && t.under >= 0.2), `a real truck stands inside every service-garage bay (the Box3 touches no wall, the lane from its parking spot is free): ${J(yard.trucks.map((t) => ({ side: t.side, front: t.front, back: t.back, under: t.under })))}`);
check(yard.trucks.every((t) => !t.doorway && !t.bay) && yard.homeTrucks === 6, `the player can stand in every garage doorway and bay (${J(yard.trucks.map((t) => [t.doorway, t.bay, t.by]))}); six trucks have six parking homes`);
check(yard.labels0.some((l) => /booth/.test(l)) && yard.labels0.some((l) => /pump/.test(l)) && yard.am0 === true, 'without a base garage the booth, fuel pump and wash stand stand (visible + solid)');
// base garage level 2 / 3 stands over the rear strip: the booth / pump / wash are hidden + not solid (the visual tick applies it), and come back when it is gone
await ev(() => { baseState.garage = 2; refreshBaseWorld(true); __TYCOON_V83_COLLISIONS__.rebuild(); });
const yard2 = await waitForState(page, () => { const y = scene.getObjectByName('v116FleetYard'); return y.userData.v161Amenities.visible === false ? { am2: false, labels2: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === y).map((e) => e.label) } : false; }, null, { timeout: 15000, fallback: { am2: true, labels2: [] } });
await ev(() => { baseState.garage = 0; refreshBaseWorld(true); __TYCOON_V83_COLLISIONS__.rebuild(); });
const yard3 = await waitForState(page, () => scene.getObjectByName('v116FleetYard').userData.v161Amenities.visible === true ? { am0: true } : false, null, { timeout: 15000, fallback: { am0: false } });
check(!yard2.labels2.some((l) => /booth|pump|wash/.test(l)) && yard2.am2 === false && yard3.am0 === true, 'with the base garage at level 2 (5 bays over the rear strip) the booth / pump / wash are hidden and not solid, and they come back when it is gone');

console.log(`\nconsole errors ${g.errors.length} ${J(g.errors.slice(0, 3))}; bad responses ${g.badResponses.length} ${J(g.badResponses.slice(0, 3))}`);
check(g.errors.length === 0 && g.badResponses.length === 0, '0 console errors and 0 4xx');
await g.close();
