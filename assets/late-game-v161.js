/* Late game 14-20 h (v161 layer, CHANGELOG_V161.md "Контент 14-20 ч", ROADMAP task 4).
 *
 * The curve is stretched with exactly two levers, both read by tools/balance-v161.mjs from the TABLE below:
 *   1. MAX_BUILDING_LEVEL 5 -> 10 (the one-line `const` in tycoon-v161.html). Every building keeps the same upgrade pad and the
 *      same price formulas (buildingUpgradeCost/-PlankCost/-ConcreteCost/-MetalCost, linear in the level), so levels 6-10 are
 *      five more real upgrade steps per building (80 more per run). Levels 6-10 are "gold tiers": createBuildingMesh() is called
 *      with level min(level, 5) (same silhouette, no 18 %-per-level growth) and this file adds gold accents, a crown at level 10.
 *   2. stageResMul: per-stage multiplier of the RESOURCE cost (planks/concrete/metal) of a stage and, through the game's own
 *      formulas, of its upgrades. The model shows the game is resource-bound from the Factory on (money is not the wall), so the
 *      late stages (>= 0.3 x) get cheaper in resources and the middle ones are left at about 0.8 x: that keeps every step of the
 *      run inside 1-6 min. Money prices are NOT touched (stageCostMul exists in the model only, all 1).
 *
 * Old saves: stages already bought when this layer first runs keep their old prices ("frozen"): `tycoon3d_late_v161` stores
 * { frozen: n } (n = stageIndex of an existing save, 0 for a new game); a prestige resets it to 0 (a new run has nothing built).
 * Only unbuilt stages are re-priced; levels 6+ simply appear as the next upgrade pad of a maxed building.
 * Loaded last (after the layers that wrap createBuildingMesh / read STAGES costs).
 */
(function () {
  'use strict';
  if (typeof STAGES === 'undefined' || typeof THREE === 'undefined' || typeof createBuildingMesh !== 'function') return;
  if (window.LATE_GAME_V161) return; // idempotent

  /* TABLE BEGIN (tools/balance-v161.mjs reads exactly this literal) */
  const TABLE = {
    maxLevel: 10, // must equal MAX_BUILDING_LEVEL in tycoon-v161.html (tests/late-game.test.mjs checks it)
    // resource-cost multiplier per stage index 0..15 (applied to the v124-scaled plank/concrete/metal cost, rounded up, >= 1 when the stage had a cost)
    stageResMul: [1, 1, 1, 0.8, 0.75, 0.8, 0.8, 0.8, 0.8, 0.8, 0.72, 0.58, 0.5, 0.42, 0.37, 0.3],
    stageCostMul: [], // money multiplier per stage: empty = 1 everywhere (kept for the balance model)
    prestigeCostStep: 0,
  };
  /* TABLE END */

  const KEY = 'tycoon3d_late_v161';
  const original = STAGES.map((s) => ({ money: s.cost, plank: s.plankCost, concrete: s.concreteCost, metal: s.metalCost }));

  // ---- which stages are frozen at their old price -------------------------------------------------------------------------------
  let frozen = 0;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) frozen = Math.max(0, Math.min(STAGES.length, Math.floor(Number(JSON.parse(raw)?.frozen) || 0)));
    else {
      frozen = (typeof knownSaveRawV64 !== 'undefined' && knownSaveRawV64) ? Math.max(0, Math.min(STAGES.length, Number(stageIndex) || 0)) : 0;
      localStorage.setItem(KEY, JSON.stringify({ frozen }));
    }
  } catch (_) { /* private mode: behave like a new game */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ frozen })); } catch (_) { /* optional */ } };

  const resCost = (n, mul) => (n > 0 ? Math.max(1, Math.ceil(n * mul - 1e-9)) : 0);
  function reprice() {
    const prestige = Math.max(0, Number(stats?.prestige) || 0);
    let changed = false;
    STAGES.forEach((s, i) => {
      const o = original[i];
      const live = i < frozen;
      const rm = live ? 1 : (TABLE.stageResMul[i] ?? 1);
      const mm = live ? 1 : (TABLE.stageCostMul[i] ?? 1) * (1 + (TABLE.prestigeCostStep || 0) * prestige);
      const next = { money: Math.max(1, Math.round(o.money * mm)), plank: resCost(o.plank, rm), concrete: resCost(o.concrete, rm), metal: resCost(o.metal, rm) };
      if (s.cost !== next.money || s.plankCost !== next.plank || s.concreteCost !== next.concrete || s.metalCost !== next.metal) changed = true;
      s.cost = next.money; s.plankCost = next.plank; s.concreteCost = next.concrete; s.metalCost = next.metal;
    });
    // pad labels (current stage pad, upgrade pads) are drawn from these numbers: applyLanguage() regenerates them (v124 does the same)
    if (changed) { try { applyLanguage(); } catch (_) { /* labels refresh on the next language/stage change */ } }
    return changed;
  }
  reprice();

  // a prestige starts a run with nothing built: everything is re-priced (and the old-save freeze ends)
  let lastPrestige = Math.max(0, Number(stats?.prestige) || 0);
  const tick = () => {
    const p = Math.max(0, Number(stats?.prestige) || 0);
    if (p === lastPrestige) return;
    lastPrestige = p; frozen = 0; persist(); reprice();
  };
  (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push(tick);

  // ---- gold tiers: levels 6..10 ---------------------------------------------------------------------------------------------------
  const mats = () => ({
    gold: new THREE.MeshStandardMaterial({ color: 0xffd479, metalness: 0.68, roughness: 0.28, emissive: 0x664400, emissiveIntensity: 0.42 }),
    pip: new THREE.MeshStandardMaterial({ color: 0xffe29b, emissive: 0xb86a00, emissiveIntensity: 0.7, roughness: 0.4 }),
  });
  function addGoldTiers(group, stage, level) {
    const m = mats();
    const baseSize = stage.baseSize || 2.6;
    const h5 = stage.height * (1 + 4 * 0.18); // the silhouette of level 5
    const extra = level - 5;
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); group.add(mesh); return mesh; };
    // second pip row on the wall (one gold pip per tier above 5), like the level pips of the base game
    for (let i = 0; i < extra; i++) add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.025), m.pip), -(extra - 1) * 0.07 + i * 0.14, 0.43, baseSize * 0.44 + 0.03);
    add(new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.9, 0.06, baseSize * 0.8), m.gold), 0, 0.11, 0); // gold plinth strip (L6+)
    if (level >= 7) add(new THREE.Mesh(new THREE.BoxGeometry(baseSize * 0.7, 0.05, 0.035), m.gold), 0, Math.max(0.9, h5 * 0.86), baseSize * 0.43 + 0.04); // front cornice
    if (level >= 8) for (const sx of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.06, h5 * 0.62, 0.06), m.gold), sx * baseSize * 0.36, h5 * 0.4, baseSize * 0.43 + 0.04); // gold pilasters
    if (level >= 9) add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), m.gold), 0, h5 * (stage.crown ? 1.62 : 1.18) + 0.45, 0); // spire
    if (level >= 10) { // the golden crown
      const w = baseSize;
      add(new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.34, 0.1, 8), m.gold), 0, h5 * (stage.crown ? 1.5 : 1.12) + 0.1, 0);
      const crown = add(new THREE.Mesh(new THREE.ConeGeometry(w * 0.3, Math.max(0.5, h5 * 0.14), 8), m.gold), 0, h5 * (stage.crown ? 1.5 : 1.12) + 0.1 + Math.max(0.5, h5 * 0.14) / 2 + 0.05, 0);
      crown.castShadow = true;
    }
    group.userData.goldTierV161 = level;
  }
  const createBefore = createBuildingMesh;
  createBuildingMesh = function (stage, level = 1) {
    const g = createBefore.call(this, stage, Math.min(level, 5));
    if (level > 5) {
      try {
        // houses (assets/buildings-v161.js) and the shop (assets/shop-v161.js) carry their own gold trim that fits their silhouette; every other archetype keeps addGoldTiers
        if (g.userData.v161House && window.BuildingsV161?.addHouseGold) window.BuildingsV161.addHouseGold(g, stage, level);
        else if (g.userData.v161Logistics && window.LogisticsV161?.addGold) window.LogisticsV161.addGold(g, stage, level); // warehouse + terminal (assets/warehouse-v161.js)
        else if (g.userData.v161Factory && window.FactoryV161?.addGold) window.FactoryV161.addGold(g, stage, level); // the three main-line factories (assets/factory-v161.js)
        else if ((g.userData.v161Office || g.userData.v161Tower) && window.OfficeTowerV161?.addGold) window.OfficeTowerV161.addGold(g, stage, level); // the four offices and four towers (assets/towers-v161.js)
        else if (g.userData.v161Shop && window.ShopV161?.addGold) window.ShopV161.addGold(g, stage, level); // the shop (assets/shop-v161.js) has gold trim that fits its facade
        else addGoldTiers(g, stage, level);
      } catch (err) { console.warn('[v161 gold tiers]', err); }
    }
    return g;
  };

  window.LATE_GAME_V161 = { table: TABLE, reprice, frozen: () => frozen, original, addGoldTiers };
})();
