/* Traffic grows with the city (v161 layer, CHANGELOG_V161.md "Контент 14-20 ч", ROADMAP task 4).
 *
 * The game already owns a pool of ambient cars (livingCityRuntime.cars, created once, shown/hidden by syncLivingCityActors()) driven by
 * the v82 transport kernel (moveLivingCar -> moveClosedLoopV82: lane following, car-following gap, crossing priority, resident/player
 * yield). Its size is MAX_CITY_CARS (7 on phones, 12 on desktop) and the number shown comes only from population/jobs/plots, so on a
 * late save the roads look the same as in the middle game. This layer changes exactly two things and nothing else:
 *   1. the number of pooled cars shown also follows the stage the player reached (TABLE.perStage), with a HARD cap (TABLE.cap*);
 *   2. the pool grows lazily (extra cars are created once, never destroyed, hidden again when the wanted count drops - e.g. after a
 *      prestige) and every third extra vehicle is a box truck ("грузовик"), built from 7 meshes like the original cars (6).
 * The pooled cars keep kind 'civilian' for the kernel, so avoidance/priority/speed are the kernel's own; a spawn guard shifts a
 * freshly added car along its loop when it would start on top of another one.
 */
(function () {
  'use strict';
  if (typeof livingCityRuntime === 'undefined' || typeof syncLivingCityActors !== 'function' || typeof createLivingCityCar !== 'function' || typeof THREE === 'undefined') return;
  if (window.TRAFFIC_V161) return; // idempotent

  /* TABLE BEGIN (tests/traffic.test.mjs reads the exported copy) */
  const TABLE = {
    capMobile: 14, capDesktop: 24,        // hard cap of pooled ambient vehicles (original cars + extras), per device class
    perStageMobile: 0.9, perStageDesktop: 1.5, // wanted = floor((stage - firstStage + 1) * perStage)
    firstStage: 4,
    freightEvery: 3,                      // every 3rd extra pooled vehicle is a box truck
    spawnClearance: 1.9,                  // m between a new car and any visible one (kernel car length 1.7)
  };
  /* TABLE END */

  const mobile = typeof VISUAL_MOBILE !== 'undefined' && VISUAL_MOBILE;
  const CAP = mobile ? TABLE.capMobile : TABLE.capDesktop;
  const PER = mobile ? TABLE.perStageMobile : TABLE.perStageDesktop;
  const COLORS = typeof CITY_CAR_COLORS !== 'undefined' ? CITY_CAR_COLORS : [0x4e81c4, 0xd45b4e, 0x5f9b68, 0xd8b04b];
  const wantedForStage = (stage) => Math.min(CAP, Math.max(0, Math.floor((Math.max(0, stage) - TABLE.firstStage + 1) * PER)));

  function createFreightTruck(color) {
    const g = new THREE.Group();
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.22, 1.86), new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.7, metalness: 0.1 }));
    chassis.position.y = 0.26; g.add(chassis);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.52, 0.6), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.06 }));
    cab.position.set(0, 0.55, 0.62); g.add(cab);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.62, 1.12), new THREE.MeshStandardMaterial({ color: 0xe7e2d8, roughness: 0.7 }));
    box.position.set(0, 0.67, -0.38); g.add(box);
    const wheels = [], wheelMat = new THREE.MeshStandardMaterial({ color: 0x202328, roughness: 0.95 });
    for (const x of [-0.5, 0.5]) for (const z of [-0.6, 0.62]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 10), wheelMat);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.16, z); g.add(w); wheels.push(w);
    }
    g.userData.cityWheels = wheels;
    g.userData.freightV161 = true;
    return g;
  }

  let created = 0;
  function addPooledVehicle() {
    const rt = livingCityRuntime, i = rt.cars.length;
    const freight = created % TABLE.freightEvery === TABLE.freightEvery - 1;
    created++;
    const g = freight ? createFreightTruck(COLORS[i % COLORS.length]) : createLivingCityCar('civilian', COLORS[i % COLORS.length]);
    g.visible = false;
    scene.add(g);
    rt.cars.push({ group: g, kind: 'civilian', s: 0, direction: i % 2 ? 1 : -1, laneCurrent: 0, speed: 2.15 + (i % 4) * 0.24, turnPause: 0, extraV161: true, freshV161: true });
  }

  function apply() {
    const rt = livingCityRuntime;
    if (!rt.cars.length) return;
    const original = rt.cars.filter((c) => c.group.visible && !c.extraV161).length;
    const want = Math.min(CAP, Math.max(original, wantedForStage(typeof stageIndex === 'number' ? stageIndex : 0)));
    while (rt.cars.length < want) addPooledVehicle();
    rt.cars.forEach((c, i) => { if (c.extraV161 || i >= original) c.group.visible = i < want; });
  }
  const syncBefore = syncLivingCityActors;
  syncLivingCityActors = function () {
    const r = syncBefore.apply(this, arguments);
    try { apply(); } catch (err) { console.warn('[v161 traffic]', err); }
    return r;
  };

  // spawn guard: the kernel places a car at its first move; if that spot is occupied slide it forward along its loop
  function guard() {
    for (const c of livingCityRuntime.cars) {
      if (!c.freshV161 || !c.group.visible || !Number.isFinite(c._v82LoopDistance)) continue;
      c._guardFramesV161 = (c._guardFramesV161 || 0) + 1;
      const p = c.group.position;
      const hit = livingCityRuntime.cars.some((o) => o !== c && o.group.visible && !o.freshV161 && Math.hypot(o.group.position.x - p.x, o.group.position.z - p.z) < TABLE.spawnClearance);
      if (hit) c._v82LoopDistance += 2.3 * (c.direction < 0 ? -1 : 1); // the kernel moves the car to the new spot next frame
      if ((!hit && c._guardFramesV161 >= 3) || c._guardFramesV161 >= 60) c.freshV161 = false;
    }
  }
  (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push(guard);

  window.TRAFFIC_V161 = { table: TABLE, cap: CAP, wantedForStage, apply, pooled: () => livingCityRuntime.cars.length, shown: () => livingCityRuntime.cars.filter((c) => c.group.visible).length, createFreightTruck };
  try { apply(); } catch (_) { /* first sync happens on the next actor tick */ }
})();
