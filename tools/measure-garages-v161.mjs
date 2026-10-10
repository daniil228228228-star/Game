// One-launch measurement of the real vehicle sizes and of every garage / bay in the game (2026-10-06 (11), user: "Гаражи тонкие, 5 нет? В них даже не залезет машина").
//   node tools/measure-garages-v161.mjs [--json FILE]
import fs from 'node:fs';
import { openGame } from '../tests/lib/harness.mjs';
import { installProbe } from './lib/buildings-probe-v161.mjs';
const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 8000 });
const { page } = g;
await page.evaluate(installProbe);
const r = await page.evaluate(() => {
  const out = {}, R = (v) => +v.toFixed(2);
  const dimsOf = (root) => {
    root.updateMatrixWorld(true);
    const b = new THREE.Box3(), tv = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || o.isSprite || !o.geometry) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.transparent && (m.opacity ?? 1) < 0.95 && !o.userData.keep) { /* glass is part of a vehicle */ }
      const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) b.expandByPoint(tv.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld));
    });
    const s = b.getSize(new THREE.Vector3()); return { w: R(s.x), h: R(s.y), l: R(s.z), minY: R(b.min.y), maxY: R(b.max.y) };
  };
  // 1. vehicles
  out.vehicles = {};
  const mk = { service: () => createServiceTruck(), plank: () => createPlankDeliveryTruck(), metal: () => createMetalDeliveryTruck(), mixer: () => createConcreteMixerTruck(), universal: () => createUniversalDeliveryTruck(0), car: () => createLivingCityCar('civilian'), ambulance: () => createLivingCityCar('ambulance'), bus: () => createLivingCityCar('bus'), fire: () => createLivingCityCar('fire') };
  for (const [k, f] of Object.entries(mk)) { try { const v = f(); v.rotation.set(0, 0, 0); out.vehicles[k] = dimsOf(v); } catch (e) { out.vehicles[k] = 'ERR ' + e.message; } }
  out.live = (typeof serviceVehicles !== 'undefined' ? serviceVehicles : []).map((v) => { const sv = v.rotation.y; const box = new THREE.Box3().setFromObject(v); const home = v.userData.home; return { kind: v.userData.vehicleKind || v.userData.fleetKey, x: R(v.position.x), z: R(v.position.z), yaw: R(v.rotation.y), home: home ? [R(home.x), R(home.z)] : null, state: v.userData.state, visible: v.visible, box: [R(box.min.x), R(box.min.z), R(box.max.x), R(box.max.z)] }; });
  // 2. house garage (levels 4 / 5)
  out.houseGarage = {};
  for (const [i, L] of [[0, 4], [0, 5], [1, 5]]) { const m = __BLD_PROBE__.stageMesh(i, L); const d = m.userData.v161Dims; out.houseGarage[`${i}:${L}`] = { garage: d && d.garage, yaw: R(m.rotation.y), fp: m.userData.v161Footprint.map((f) => [R(f.x), R(f.z), R(f.hx), R(f.hz)]) }; __BLD_PROBE__.dropMesh(m); }
  // 3. V72 base fleet garage, levels 1..3 (bays 3 / 5 / 6)
  out.baseGarage = {};
  const cfg = BASE_CONFIG.find((c) => c.key === 'garage');
  for (const lv of [1, 2, 3]) {
    const gg = createFleetGarageV72(cfg, lv, new THREE.Vector3(0, 0, 0));
    const d = dimsOf(gg);
    const wallMeshes = []; gg.traverse((o) => { if (o.isMesh && o.geometry.parameters && o.geometry.type === 'BoxGeometry') { const p = o.geometry.parameters; if (p.height > 1.6) wallMeshes.push([R(o.position.x), R(o.position.z), R(p.width), R(p.depth), R(p.height)]); } });
    out.baseGarage[lv] = { bays: fleetGarageBayCountV72(lv), dims: d, tall: wallMeshes.slice(0, 40), meshes: (() => { let n = 0; gg.traverse((o) => { if (o.isMesh) n++; }); return n; })() };
    scene.remove(gg);
  }
  // live base garage as the game builds it + collider entries
  try {
    baseState.garage = 3; refreshBaseWorld(true);
    const live = baseRuntime.groups.get('garage');
    if (live) {
      const pos = live.position;
      out.baseGarageLive = { x: R(pos.x), z: R(pos.z), entries: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === live).map((e) => ({ label: e.label, cat: e.category, shape: e.shape, x: R(e.pos.x), z: R(e.pos.z), hx: e.hx && R(e.hx), hz: e.hz && R(e.hz), flags: Object.keys(e.flags || {}).filter((k) => e.flags[k]).join(',') })), statics: STATIC_COLLIDERS.filter((c) => Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z) < 8).map((c) => [R(c.pos.x), R(c.pos.z), c.radius]) };
    }
  } catch (e) { out.baseGarageLive = 'ERR ' + e.message; }
  // 4. fleet yard (rear garage + obstacles)
  const yard = scene.getObjectByName('v116FleetYard');
  if (yard) out.yard = { obstacles: (yard.userData.v161Obstacles || []).map((b) => [b.label, R(b.pos.x), R(b.pos.z), R(b.hx), R(b.hz)]), dims: dimsOf(yard) };
  out.homes = Object.fromEntries(Object.entries(window.__TYCOON_V65_TRAFFIC__.homes).map(([k, p]) => [k, [R(p.x), R(p.z)]]));
  return out;
});
console.log(JSON.stringify(r, null, 1));
const jf = process.argv.indexOf('--json'); if (jf > 0) fs.writeFileSync(process.argv[jf + 1], JSON.stringify(r, null, 1));
console.log('errors', g.errors.length, JSON.stringify(g.errors.slice(0, 3)));
await g.close();
