// serviceVehicleYieldFactor (tycoon-v161.html:7421) -- direct function-level checks against the REAL
// function with synthetic vehicles of the same userData shape the game uses (ported from
// archive/tycoon-v116/tests/traffic.test.mjs; v161 still has our fairness override at :7476-7485).
// Covers: fresh crossing yields, long-stuck vehicle gets priority (no one-sided perpetual yield),
// no hair-trigger flip, car-following gap, parked vehicles out of the corridor don't block.
// serviceVehicles is swapped out for the call and restored, so the live scene is unaffected.
// Extended 2026-10-04 (ROADMAP task 4, assets/traffic-v161.js): (a) two trucks meeting at a crossing / queueing in one lane, stepped through the real
// serviceVehicleYieldFactor with the game's own stuck rule: nobody waits longer than WAIT_MAX_S and the bodies never sit on top of each other;
// (b) the pooled ambient traffic follows the stage with a HARD cap, grows lazily, reuses its objects and hides again; (c) on a late-stage save
// the scene is measured at a fixed camera (meshes / draw calls / triangles / vehicles) - run with TRAFFIC_ROOT=<old checkout> to print the same
// numbers for another build (no assertions then): `git worktree add ../old HEAD~N` + `TRAFFIC_ROOT=../old node tests/traffic.test.mjs`.
import { openGame, check, startServer, ENTRY } from './lib/harness.mjs';
import path from 'node:path';

const J = JSON.stringify;
// late-stage fixture: stages 0..14 built at the old maximum level 5, stage 15 next
const LATE_SAVE = { saveVersion: 20, stageIndex: 15, money: 5e8, planks: 5000, concrete: 150, metal: 150, buildings: Array.from({ length: 15 }, (_, i) => ({ index: i, level: 5 })) };
const root = process.env.TRAFFIC_ROOT ? path.resolve(process.env.TRAFFIC_ROOT) : null;
const srv = root ? await startServer(root) : null;
const g = root ? await openGame({ save: LATE_SAVE, url: `${srv.url}/${ENTRY}`, waitMs: 9000 }) : await openGame({ save: LATE_SAVE, waitMs: 9000 });
const { page } = g;

// the same state for every build: all four districts get roads (so the pooled cars have loops to drive), stage 15, fixed camera poses
const measure = () => page.evaluate(() => {
  for (const d of CITY_DISTRICTS) { cityState.districts[d.id] = Math.max(1, cityState.districts[d.id] || 0); }
  ensureInfrastructureStateV37(); for (const d of CITY_DISTRICTS) { cityState.districtRoads[d.id].level = Math.max(1, cityState.districtRoads[d.id].level || 0); }
  cityState.population = Math.max(cityState.population || 0, 400);
  syncLivingCityActors(); syncLivingCityActors();
  const poses = { overview: [[0, 95, 105], [0, 0, 0]], street: [[22, 14, 28], [0, 0, 0]], far: [[-60, 40, -60], [20, 0, 20]] };
  const savedPos = camera.position.clone(), savedQuat = camera.quaternion.clone(), out = {};
  for (const [k, [p, l]] of Object.entries(poses)) {
    camera.position.set(...p); camera.lookAt(...l); camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    out[k] = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  }
  camera.position.copy(savedPos); camera.quaternion.copy(savedQuat);
  let meshes = 0, all = 0; scene.traverse((o) => { if (o.isMesh) all++; }); scene.traverseVisible((o) => { if (o.isMesh) meshes++; });
  const cars = livingCityRuntime.cars, shown = cars.filter((c) => c.group.visible);
  return { stage: stageIndex, out, meshes, all, pooled: cars.length, shown: shown.length, freight: cars.filter((c) => c.group.userData.freightV161).length, districtCars: livingCityRuntime.districtCars.filter((c) => c.group.visible).length, arterial: livingCityRuntime.arterialCars.filter((c) => c.group.visible).length, service: serviceVehicles.length, cap: window.TRAFFIC_V161?.cap ?? null };
});
const report = (m) => console.log(`PERF ${root ? 'BEFORE (' + path.basename(root) + ')' : 'AFTER'} late-stage save (stage ${m.stage}, 15 buildings level 5, 4 district roads): visible meshes ${m.meshes} (all ${m.all}); draw calls overview/street/far ${m.out.overview.calls}/${m.out.street.calls}/${m.out.far.calls}; triangles ${m.out.overview.tris}/${m.out.street.tris}/${m.out.far.tris}; pooled cars ${m.pooled} (shown ${m.shown}, box trucks ${m.freight}), district cars ${m.districtCars}, arterial ${m.arterial}, service trucks ${m.service}, cap ${m.cap}`);
if (root) { report(await measure()); await g.close(); await srv.close(); process.exit(0); }

const factor = (cfg) => page.evaluate((c) => {
  const mk = (x, z, id, loaded, stuck, state, headingDeg) => {
    const rad = headingDeg * Math.PI / 180;
    return {
      position: new THREE.Vector3(x, 0, z), visible: true,
      userData: {
        role: 'delivery', state, logisticsId: id, deliveryTicket: loaded ? { delivered: false } : null,
        path: [{ x, z }, { x: x + Math.sin(rad), z: z + Math.cos(rad) }], pathIndex: 0, _auditStuck: stuck,
      },
    };
  };
  const L = mk(0, 0, 'delivery_zzz_loser', true, c.lStuck ?? 0, 'outbound', 0);
  const W = mk(c.wx, c.wz, 'delivery_aaa_winner', c.wLoaded ?? true, c.wStuck ?? 0, c.wState ?? 'outbound', c.heading);
  const saved = serviceVehicles.slice();
  serviceVehicles.length = 0;
  serviceVehicles.push(L, ...(c.noRival ? [] : [W]));
  let f;
  try { f = serviceVehicleYieldFactor(L, { x: 0, z: 5 }); } finally { serviceVehicles.length = 0; saved.forEach((v) => serviceVehicles.push(v)); }
  return f;
}, cfg);

check(await page.evaluate(() => typeof serviceVehicleYieldFactor) === 'function', 'serviceVehicleYieldFactor exists');
check(await factor({ noRival: true, wx: 0, wz: 0, heading: 0 }) === 1, 'alone on the road: factor 1');

for (const heading of [90, 60, 45, 135]) {
  const f = await factor({ wx: 0, wz: 0.6, heading });
  check(f === 0, `fresh crossing at ${heading} deg (both loaded, 0s stuck) still fully yields: ${f}`);
}
for (const heading of [90, 60, 135]) {
  const f = await factor({ lStuck: 6, wx: 0.3, wz: 0.6, heading });
  check(f === 1, `vehicle stuck 6s vs never-stuck rival at ${heading} deg gets priority (no perpetual yield): ${f}`);
}
check(await factor({ lStuck: 0.9, wStuck: 0.4, wx: 0.3, wz: 0.6, heading: 90 }) === 0, 'small stuck lead (0.9s vs 0.4s) does not flip priority');
check(await factor({ lStuck: 5.0, wStuck: 4.6, wx: 0.3, wz: 0.6, heading: 90 }) === 0, 'near-equal mutual stall stays on the static rule (no per-frame flip)');
check(await factor({ lStuck: 0, wLoaded: false, wx: 0.3, wz: 0.6, heading: 90 }) === 1, 'loaded vehicle has right of way over an empty one at a crossing');

// car-following (same lane): only the vehicle physically behind yields, and the gap eases in
check(await factor({ wx: 0, wz: 1.8, heading: 0 }) === 0, 'rival 1.8 m directly ahead in the same lane: stop (0)');
const mid = await factor({ wx: 0, wz: 3.2, heading: 0 });
check(mid > 0 && mid < 1, `rival 3.2 m ahead: slows proportionally (${mid.toFixed(2)})`);
check(await factor({ wx: 0, wz: -1.8, heading: 0 }) === 1, 'rival behind in the same lane never blocks');
check(await factor({ wx: 0, wz: 3.9, heading: 0 }) > 0.9, 'rival at the edge of the free gap barely slows');

// parked (idle) vehicles block only when inside the swept corridor
check(await factor({ wState: 'idle', wLoaded: false, wx: 3, wz: 0.5, heading: 90 }) === 1, 'parked vehicle beside the route (3 m lateral) does not block');
check(await factor({ wState: 'idle', wLoaded: false, wx: 0, wz: 0.8, heading: 90 }) === 0, 'parked vehicle inside the swept corridor blocks');

// ---- (a) two trucks at a crossing, stepped through the real yield function (the game's own stuck rule: updateVehicleProgressWatch, :7376)
const WAIT_MAX_S = 6, SIM_S = 40;
const crossing = (cfg) => page.evaluate((c) => {
  const mk = (id, x, z, hx, hz, loaded) => ({ position: new THREE.Vector3(x, 0, z), visible: true, userData: { role: 'delivery', state: 'outbound', logisticsId: id, deliveryTicket: loaded ? { delivered: false } : null, path: [{ x, z }, { x: x + hx * 40, z: z + hz * 40 }], pathIndex: 0, _auditStuck: 0, speed: 2.8, dir: { x: hx, z: hz } } });
  const trucks = c.trucks.map((t) => mk(t.id, t.x, t.z, t.hx, t.hz, t.loaded));
  const saved = serviceVehicles.slice(); serviceVehicles.length = 0; trucks.forEach((t) => serviceVehicles.push(t));
  const dt = 0.1, waits = trucks.map(() => 0), longest = trucks.map(() => 0), done = trucks.map(() => false);
  let minD = Infinity, minAhead = Infinity, t = 0;
  try {
    for (; t < c.seconds; t += dt) {
      for (let i = 0; i < trucks.length; i++) {
        const v = trucks[i], d = v.userData.dir;
        v.userData.path = [{ x: v.position.x, z: v.position.z }, { x: v.position.x + d.x, z: v.position.z + d.z }]; v.userData.pathIndex = 0;
        const f = serviceVehicleYieldFactor(v, { x: v.position.x + d.x * 6, z: v.position.z + d.z * 6 });
        const stalled = f < 0.05;
        v.userData._auditStuck = stalled ? v.userData._auditStuck + dt : 0;
        waits[i] = stalled ? waits[i] + dt : 0; longest[i] = Math.max(longest[i], waits[i]);
        v.position.x += d.x * v.userData.speed * f * dt; v.position.z += d.z * v.userData.speed * f * dt;
        if (Math.hypot(v.position.x - c.trucks[i].x, v.position.z - c.trucks[i].z) > c.travel) done[i] = true;
      }
      for (let i = 0; i < trucks.length; i++) for (let j = i + 1; j < trucks.length; j++) {
        const d = trucks[i].position.distanceTo(trucks[j].position); minD = Math.min(minD, d);
      }
      if (done.every(Boolean)) break;
    }
  } finally { serviceVehicles.length = 0; saved.forEach((v) => serviceVehicles.push(v)); }
  return { longest: longest.map((x) => +x.toFixed(2)), minD: +minD.toFixed(2), finished: done.every(Boolean), t: +t.toFixed(1) };
}, cfg);
const X = { trucks: [{ id: 'delivery_planks_1', x: 0, z: -10, hx: 0, hz: 1, loaded: true }, { id: 'delivery_metal_2', x: -10, z: 0, hx: 1, hz: 0, loaded: true }], seconds: SIM_S, travel: 20 };
for (const [name, cfg] of [
  ['both loaded, perpendicular, arriving together', X],
  ['loaded vs empty, perpendicular', { ...X, trucks: [{ ...X.trucks[0], loaded: false }, X.trucks[1]] }],
  ['same ids/cargo, perpendicular, 1.5 m offset', { ...X, trucks: [{ ...X.trucks[0], id: 'delivery_x_1', z: -11.5 }, { ...X.trucks[1], id: 'delivery_x_1' }] }],
  ['three trucks (the third in the opposite lane, 1.3 m off the axis)', { ...X, trucks: [...X.trucks, { id: 'delivery_concrete_3', x: 10, z: 1.3, hx: -1, hz: 0, loaded: true }] }],
]) {
  const r = await crossing(cfg);
  check(r.finished && Math.max(...r.longest) <= WAIT_MAX_S, `${name}: everybody passes the crossing in ${r.t} s, longest wait ${Math.max(...r.longest)} s <= ${WAIT_MAX_S} s (${J(r.longest)})`);
  check(r.minD >= 1.0, `${name}: bodies never overlap, closest centres ${r.minD} m (>= 1.0)`);
}
const queue = await crossing({ trucks: [{ id: 'delivery_a_1', x: 0, z: -3, hx: 0, hz: 1, loaded: true }, { id: 'delivery_b_2', x: 0, z: -6, hx: 0, hz: 1, loaded: true }, { id: 'delivery_c_3', x: 0, z: -9, hx: 0, hz: 1, loaded: true }], seconds: 20, travel: 25 });
check(queue.minD >= 2.0, `three trucks in one lane keep the car-following gap: closest centres ${queue.minD} m (>= 2.0)`);

// ---- (b) pooled ambient traffic: hard cap, lazy growth, reuse
const pool = await page.evaluate(() => {
  const T = window.TRAFFIC_V161, rt = livingCityRuntime, res = { cap: T.cap, table: T.table, mobile: VISUAL_MOBILE, steps: [] };
  const snap = (label) => { res.steps.push({ label, stage: stageIndex, pooled: rt.cars.length, shown: rt.cars.filter((c) => c.group.visible).length, freight: rt.cars.filter((c) => c.group.userData.freightV161).length, ids: rt.cars.map((c) => c.group.uuid).join('') }); };
  const keep = stageIndex;
  stageIndex = 0; syncLivingCityActors(); snap('stage 0');
  stageIndex = 9; syncLivingCityActors(); snap('stage 9');
  stageIndex = 15; syncLivingCityActors(); snap('stage 15');
  for (let i = 0; i < 6; i++) syncLivingCityActors(); snap('stage 15, 6 more syncs');
  stageIndex = 0; syncLivingCityActors(); snap('back to stage 0 (prestige)');
  stageIndex = 15; syncLivingCityActors(); snap('stage 15 again');
  stageIndex = 99; syncLivingCityActors(); snap('stage 99 (cap)');
  stageIndex = keep; syncLivingCityActors();
  res.wanted = [0, 4, 8, 12, 15, 99].map((s) => [s, T.wantedForStage(s)]);
  return res;
});
const st = Object.fromEntries(pool.steps.map((s) => [s.label, s]));
console.log('pool steps:', J(pool.steps.map((s) => ({ ...s, ids: undefined }))));
check(pool.wanted.every(([s, w], i, a) => w <= pool.cap && (i === 0 || w >= a[i - 1][1])), `wanted vehicles grow with the stage and never exceed the cap ${pool.cap}: ${J(pool.wanted)}`);
check(st['stage 15'].shown > st['stage 9'].shown || st['stage 9'].shown >= pool.cap, `more vehicles at stage 15 than at stage 9 (${st['stage 9'].shown} -> ${st['stage 15'].shown})`);
check(st['stage 99 (cap)'].pooled <= pool.cap && st['stage 99 (cap)'].shown <= pool.cap, `hard cap: pooled ${st['stage 99 (cap)'].pooled}, shown ${st['stage 99 (cap)'].shown} <= ${pool.cap}`);
check(st['stage 15, 6 more syncs'].ids === st['stage 15'].ids && st['stage 15 again'].ids === st['stage 15'].ids, 'repeated syncs and a prestige round trip create no new vehicle objects (pool reuse)');
check(st['back to stage 0 (prestige)'].shown < st['stage 15'].shown, `after a prestige the extra vehicles are hidden again (${st['stage 15'].shown} -> ${st['back to stage 0 (prestige)'].shown})`);
check(st['stage 15'].freight >= 1 || st['stage 15'].pooled - st['stage 0'].pooled < 3, `the extra vehicles include box trucks (${st['stage 15'].freight})`);

// ---- (c) vehicles driving on the district loops: nobody sits on top of anybody (sampled over real frames), then the fixed-camera measurement
const drive = await page.evaluate(async () => {
  for (const d of CITY_DISTRICTS) { cityState.districts[d.id] = Math.max(1, cityState.districts[d.id] || 0); }
  ensureInfrastructureStateV37(); for (const d of CITY_DISTRICTS) cityState.districtRoads[d.id].level = Math.max(1, cityState.districtRoads[d.id].level || 0);
  cityState.population = Math.max(cityState.population || 0, 400);
  syncLivingCityActors();
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  let minD = Infinity, samples = 0, moved = 0; const start = new Map();
  for (let k = 0; k < 90; k++) {
    await frame();
    const vis = livingCityRuntime.cars.filter((c) => c.group.visible);
    if (k === 5) vis.forEach((c) => start.set(c, c.group.position.clone()));
    if (k > 8 && k % 6 === 0) {
      samples++;
      for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) minD = Math.min(minD, vis[i].group.position.distanceTo(vis[j].group.position));
    }
  }
  for (const [c, p] of start) if (c.group.position.distanceTo(p) > 0.3) moved++;
  return { minD: Number.isFinite(minD) ? +minD.toFixed(2) : null, samples, moved, shown: livingCityRuntime.cars.filter((c) => c.group.visible).length };
});
console.log('driving sample:', J(drive));
check(drive.minD === null || drive.minD >= 0.9, `pooled vehicles on the loops keep apart over ${drive.samples} samples: closest ${drive.minD} m (>= 0.9), ${drive.moved}/${drive.shown} moved`);
report(await measure());

check(g.errors.length === 0, `no console errors ${JSON.stringify(g.errors.slice(0, 3))}`);
await g.close();
