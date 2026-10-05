/* District infrastructure ground pads (v161 layer, CHANGELOG_V161.md "Инфраструктура района: кружки").
 *
 * Road / lighting / power / water already exist as 0..3 ladders per district (v37 roads+lights,
 * v41 power+water, each with its own cost, world effect, pending timer and stage/district gates)
 * but could only be bought through the City overlay panel. This file adds NO new economy and NO
 * new save field: it appends one ground-pad step per (district, kind) to INDUSTRIAL_BUILD_STEPS_V118,
 * the shared pad pipeline (marker, nearestManualTargetV53 candidate, #actionPrompt/#actionBtn,
 * compass/ground-arrow guidance, pad highlight); plus two city-wide steps for the v42 power plant and
 * water works that district power/water levels depend on. A pad is visible only while that exact next
 * level is buyable (same conditions as the panel button), its cost is read from the game's own
 * cost functions at press time, and pressing it calls the same build function the panel button
 * calls (buildDistrictRoads / buildStreetlights / __TYCOON_V41__.buildPower|buildWater).
 *
 * Hooks in tycoon-v161.html (grep "infraOf" / "v161 district infra"): buildIndustrialStepV118 calls
 * step.run, the 'industrial' prompt uses step.icon / the upgrade verb, the guidance loop does not stop
 * at an unaffordable infra step, and window.__TYCOON_V41__ exports powerCost/waterCost and __TYCOON_V42__ plantCost/canPlant.
 * Loaded last (after interface-v161.js) so every function used below already exists.
 */
(function () {
  'use strict';
  if (typeof INDUSTRIAL_BUILD_STEPS_V118 === 'undefined' || typeof CITY_DISTRICTS === 'undefined' || typeof THREE === 'undefined') return;
  if (INDUSTRIAL_BUILD_STEPS_V118.some((s) => s.infraOf)) return; // idempotent

  const v41 = () => window.__TYCOON_V41__ || null;
  const v41d = (id) => v41()?.state?.district?.[id] || {};
  const KINDS = [
    { k: 'road', icon: '🛣️', ru: 'Дорога', en: 'Road', color: 0xd6c9a8,
      level: (id) => districtRoadLevelV37(id),
      pending: (id) => (cityState.districtRoads?.[id]?.pendingUntil || 0) > 0,
      allowed: (id) => districtRoadLevelV37(id) < Math.min(3, districtLevel(id)),
      cost: (id) => districtRoadsBuildCost(id),
      run: (id) => buildDistrictRoads(id) },
    { k: 'light', icon: '💡', ru: 'Освещение', en: 'Lighting', color: 0xffd88a,
      level: (id) => districtStreetlightLevelV37(id),
      pending: (id) => (cityState.streetlights?.[id]?.pendingUntil || 0) > 0,
      allowed: (id) => districtStreetlightLevelV37(id) < Math.min(3, districtRoadLevelV37(id)),
      cost: (id) => streetlightsBuildCost(id),
      run: (id) => buildStreetlights(id) },
    { k: 'power', icon: '⚡', ru: 'Электричество', en: 'Power', color: 0xffe35a,
      level: (id) => v41()?.power(id) || 0,
      pending: (id) => (v41d(id).powerPendingUntil || 0) > Date.now(),
      allowed: (id) => !!v41()?.canPower(id),
      cost: (id) => v41()?.powerCost?.(id) || null,
      run: (id) => v41().buildPower(id) },
    { k: 'water', icon: '💧', ru: 'Вода', en: 'Water', color: 0x7ec8f5,
      level: (id) => v41()?.water(id) || 0,
      pending: (id) => (v41d(id).waterPendingUntil || 0) > Date.now(),
      allowed: (id) => !!v41()?.canWater(id),
      cost: (id) => v41()?.waterCost?.(id) || null,
      run: (id) => v41().buildWater(id) },
  ];

  // Pad positions: a ring around the district hub (hub disc 3.25, street ring 4.1-4.55, satellite
  // buildings from ~7.2), one preferred angle per kind, first candidate that is clear of
  // buildings/colliders/roads/other pads. Computed once per session and cached (deterministic for a
  // given world); falls back to the preferred angle at radius 6.
  const taken = [];
  const posCache = new Map();
  function clear(x, z) {
    try {
      if (Math.hypot(x, z) > GROUND_HALF - 4) return false;
      if (occupiedBuildingPositions().some((p) => Math.hypot(x - p.x, z - p.z) < 3.6)) return false;
      if (STATIC_COLLIDERS.some((c) => Math.hypot(x - c.pos.x, z - c.pos.z) - c.radius < 1.2)) return false;
      if (typeof distToNearestRoadNetworkV369 === 'function' && distToNearestRoadNetworkV369(x, z) < 1.4) return false;
      if (taken.some((p) => Math.hypot(x - p.x, z - p.z) < 2.6)) return false;
    } catch (_) { /* a missing helper must not hide the pad */ }
    return true;
  }
  function padPos(cfg, kindIndex) {
    const key = cfg.id + ':' + kindIndex;
    let p = posCache.get(key);
    if (p) return p;
    const base = Math.PI / 4 + kindIndex * Math.PI / 2;
    outer: for (const r of [6.0, 7.0, 8.0]) {
      for (let j = 0; j < 12; j++) {
        const a = base + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * (Math.PI / 10);
        const x = cfg.pos.x + Math.cos(a) * r, z = cfg.pos.z + Math.sin(a) * r;
        if (clear(x, z)) { p = new THREE.Vector3(x, 0, z); break outer; }
      }
    }
    if (!p) p = new THREE.Vector3(cfg.pos.x + Math.cos(base) * 6, 0, cfg.pos.z + Math.sin(base) * 6);
    taken.push(p);
    posCache.set(key, p);
    return p;
  }

  CITY_DISTRICTS.forEach((cfg) => KINDS.forEach((K, ki) => {
    const id = cfg.id;
    const ZERO = { money: 0, wood: 0, concrete: 0, metal: 0 };
    const can = () => {
      try {
        return districtUnlocked(cfg) && districtLevel(id) >= 1 && K.level(id) < 3 && !K.pending(id) && K.allowed(id) && !!K.cost(id);
      } catch (_) { return false; }
    };
    INDUSTRIAL_BUILD_STEPS_V118.push({
      id: `infra-${id}-${K.k}`, infraOf: id, kind: K.k, icon: K.icon, color: K.color,
      get level() { return K.level(id) + 1; },
      get ru() { return `${K.ru} L${this.level}`; },
      get en() { return `${K.en} L${this.level}`; },
      get plateSub() { return { ru: cfg.ru.toUpperCase(), en: cfg.en.toUpperCase() }; }, // 2nd plate line: WHICH district (the four districts share the same 4 titles); read by spawnIndustrialPadMarkerV118
      get pos() { return padPos(cfg, ki); },
      get cost() { try { return K.cost(id) || ZERO; } catch (_) { return ZERO; } },
      built: () => false, // a district ladder is never "finished" as a whole; visibility is `prereq`
      prereq: can,
      run(step) {
        if (!can()) return false;
        K.run(id);
        refreshIndustrialPadMarkersV118();
        spawnBurst(step.pos, K.color);
        triggerShake(0.08, 0.14); // v161 feel: same small kick as a road section (the build functions already play sfx.build + their toast)
        updateHUD();
        return true;
      },
    });
  }));
  // City-wide backbone: the power plant / water works that power & water district levels depend on
  // (v42: utilityBuildAllowedV41 needs plant level >= the district tier). Same pad pipeline; the pad
  // stands beside the plant's own world model (-12,52 / 0,52, refreshV42World) and shows only when a
  // district has roads + lighting at the plant's next level (the panel hides the dependency, the pad
  // simply appears at the moment it is the next useful step).
  const v42 = () => window.__TYCOON_V42__ || null;
  const PLANTS = [
    { k: 'power', icon: '⚡', ru: 'Электростанция', en: 'Power plant', color: 0xffe35a, x: -12, z: 52, lvl: 'powerPlantLevel', pend: 'powerPendingUntil' },
    { k: 'water', icon: '💧', ru: 'Водоканал', en: 'Water works', color: 0x7ec8f5, x: 0, z: 52, lvl: 'waterPlantLevel', pend: 'waterPendingUntil' },
  ];
  PLANTS.forEach((P) => {
    const ZERO = { money: 0, wood: 0, concrete: 0, metal: 0 };
    const lv = () => Math.max(0, Number(v42()?.state?.[P.lvl]) || 0);
    const cost = () => (lv() < 3 && v42()?.plantCost?.(P.k, lv() + 1)) || null;
    const ready = (n) => CITY_DISTRICTS.some((c) => districtUnlocked(c) && Math.min(districtRoadLevelV37(c.id), districtStreetlightLevelV37(c.id)) >= n);
    const can = () => {
      try {
        const next = lv() + 1;
        return next <= 3 && !((Number(v42().state[P.pend]) || 0) > Date.now()) && ready(next) && !!v42().canPlant(P.k) && !!cost();
      } catch (_) { return false; }
    };
    let pos = null;
    INDUSTRIAL_BUILD_STEPS_V118.push({
      id: `infra-plant-${P.k}`, infraOf: 'city', kind: 'plant-' + P.k, icon: P.icon, color: P.color,
      get level() { return lv() + 1; },
      get ru() { return `${P.ru} L${this.level}`; },
      get en() { return `${P.en} L${this.level}`; },
      get pos() {
        if (pos) return pos;
        for (const dz of [-6.5, -8, 6.5]) if (clear(P.x, P.z + dz)) { pos = new THREE.Vector3(P.x, 0, P.z + dz); break; }
        if (!pos) pos = new THREE.Vector3(P.x, 0, P.z - 6.5);
        taken.push(pos);
        return pos;
      },
      get cost() { try { return cost() || ZERO; } catch (_) { return ZERO; } },
      built: () => false,
      prereq: can,
      run(step) {
        if (!can()) return false;
        v42().plant(P.k);
        refreshIndustrialPadMarkersV118();
        spawnBurst(step.pos, P.color);
        triggerShake(0.08, 0.14);
        updateHUD();
        return true;
      },
    });
  });
  refreshIndustrialPadMarkersV118();
})();
