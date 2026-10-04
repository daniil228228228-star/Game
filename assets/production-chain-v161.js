/* Longer production chain (v161 layer, CHANGELOG_V161.md "Производственная цепочка длиннее", ROADMAP task 3).
 *
 * Reuses the industrial ground-pad pipeline (INDUSTRIAL_BUILD_STEPS_V118: marker, nearestManualTargetV53
 * candidate, #actionPrompt/#actionBtn, compass/ground-arrow guidance, x1.25 / x1.08 v124 price scaling is
 * applied HERE because v124 ran before this file) and adds four steps:
 *   frame     Frame Workshop ("Каркасный цех"): a one-time building pad. Once built it turns surplus
 *             planks + metal into the new intermediate product "frame" (каркас) on a timer.
 *   sawmill3 / concrete3 / metal3   production level 3 (INDUSTRIAL_LEVEL_SPEED_V161 gets a 3rd entry), the
 *             existing `upgradeOf` branch of buildIndustrialStepV118 does the purchase, level and badge.
 * The only demand for frames is the cost of the level-3 pads (see TABLE.levels3[*].cost.frame): the
 * construction tables (STAGES, delivery tickets, market exchange panel hard-coded to planks/concrete/metal)
 * are a closed 4-resource model, hooking a 5th resource into them needs >5 layers, so none is touched.
 *
 * Game-side hooks (grep "V161" in tycoon-v161.html): framesV161 / frameWorkshopBuiltV161 state, 'frame' key in
 * canPayResources/tryPayResources, frameCapacityV161() next to concreteCapacity() (storage = BASE + warehouse
 * levels, the game's existing storage concept), save/load of `productionChainV161`, the per-frame call of
 * updateFrameWorkshopV161(dt), the `step.run` delegation in buildIndustrialStepV118, level-3 badge text.
 * Loaded after district-unlock-v161.js. Everything below is try/catch-guarded where a missing helper
 * must not break boot.
 */
(function () {
  'use strict';
  if (typeof INDUSTRIAL_BUILD_STEPS_V118 === 'undefined' || typeof THREE === 'undefined' || typeof frameWorkshopBuiltV161 === 'undefined') return;
  if (INDUSTRIAL_BUILD_STEPS_V118.some((s) => s.chainV161)) return; // idempotent

  /* TABLE BEGIN (tools/balance-v161.mjs reads exactly this literal) */
  const TABLE = {
    // v124 price scaling replicated (it runs before this file): money x1.25 rounded, resources x1.08 rounded up.
    // `frame` prices are final numbers (new resource, nothing to scale).
    scale: { money: 1.25, resource: 1.08 },
    // Recipe: `planks` + `metal` -> `out` frame every `interval` s (divided by productionSpeedMultiplier(), v124 x0.68).
    // Runs only from `unlockStage` and only on SURPLUS: the stock must stay >= the next stage's own wood/metal cost.
    recipe: { planks: 3, metal: 1, out: 1, interval: 14, unlockStage: 6 },
    capacityPerWarehouseLevel: 4, // frameCapacityV161() in the game: 6 + 4 per built warehouse level
    capacityBase: 6,
    // base prices (before scaling); gate = first `stageIndex` at which the pad can show
    workshop: { gate: 6, cost: { money: 3200, wood: 10, concrete: 4, metal: 2 } },
    levels3: {
      sawmill: { gate: 6, speed: 2.0, cost: { money: 2600, wood: 8, concrete: 3, metal: 1, frame: 2 } },
      concrete: { gate: 7, speed: 1.8, cost: { money: 6500, wood: 12, concrete: 6, metal: 2, frame: 3 } },
      metal: { gate: 8, speed: 1.8, cost: { money: 15000, wood: 14, concrete: 8, metal: 4, frame: 4 } },
    },
  };
  /* TABLE END */

  const scaleCost = (c) => {
    const out = { money: Math.max(1, Math.round((c.money || 0) * TABLE.scale.money)), wood: 0, concrete: 0, metal: 0 };
    for (const k of ['wood', 'concrete', 'metal']) out[k] = Math.max(0, Math.ceil((c[k] || 0) * TABLE.scale.resource));
    if (c.frame) out.frame = c.frame;
    out.__v124 = true; // never scaled twice
    return out;
  };

  // ---- positions: relative to the building anchors, found by a live clearance probe (CHANGELOG): >= 3.3 m from the
  // service roads/other pads/loading zones/mine nodes, outside every tree ring, clear of tall meshes and colliders.
  const V = (base, dx, dz) => new THREE.Vector3(base.x + dx, 0, base.z + dz);
  const POS = {
    sawmill3: V(SAWMILL_POS, -1.5, -3.8),
    concrete3: V(CONCRETE_PLANT_POS, -3.4, -3.7),
    metal3: V(METAL_YARD_POS, 3.3, -3.4),
    workshop: V(METAL_YARD_POS, -2.5, -6.6),
  };
  const PROP_POS = new THREE.Vector3(POS.workshop.x, 0, POS.workshop.z - 3.0); // the shed stands 3 m behind its pad
  const PROP_COLLIDER_RADIUS = 1.7;

  // ---- level-3 speeds (the game's table gets a third entry; idempotent)
  for (const kind of Object.keys(TABLE.levels3)) {
    const row = INDUSTRIAL_LEVEL_SPEED_V161[kind];
    if (Array.isArray(row) && row.length === 2) row.push(TABLE.levels3[kind].speed);
  }

  const L3_NAMES = {
    sawmill: ['Лесопилка · ур. 3', 'Sawmill · Lv 3', () => sawmillBuiltV118],
    concrete: ['Бетонный завод · ур. 3', 'Concrete Plant · Lv 3', () => concretePlantBuiltV118],
    metal: ['Металлобаза · ур. 3', 'Metal Yard · Lv 3', () => metalYardBuiltV118],
  };

  // ---- frame workshop prop (walk-around shed + beam stack, label with the frame stock)
  let prop = null;
  function frameLabelLines() {
    return [lang === 'ru' ? 'КАРКАСНЫЙ ЦЕХ' : 'FRAME WORKSHOP', `📐 ${framesV161}/${frameCapacityV161()}`];
  }
  function buildWorkshopProp(withCollider) {
    if (prop) return prop;
    const g = new THREE.Group();
    g.name = 'v161FrameWorkshop';
    g.add(createFoundation(3.0, 2.6, 0.16, 0xb9b6b0));
    const shed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 1.5), createCorrugatedMaterial(0x8a6f4e, { roughness: 0.74, metalness: 0.16 }));
    shed.position.set(-0.45, 0.76, -0.2);
    shed.castShadow = true;
    g.add(shed);
    const roof = createGableRoof(2.2, 1.8, 0.45, createMetalMaterial(0x4a525c, { roughness: 0.58, metalness: 0.28 }));
    roof.position.set(-0.45, 1.36, -0.2);
    g.add(roof);
    const wood = createWoodMaterial(0xb98a52, {});
    const steel = createMetalMaterial(0xa6adb5, { roughness: 0.46, metalness: 0.5 });
    for (let i = 0; i < 4; i++) { // stacked wooden frames with steel straps
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.1), wood);
      beam.position.set(0.95, 0.2 + i * 0.13, 0.55 + (i % 2) * 0.16);
      beam.castShadow = true;
      g.add(beam);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), steel);
      cross.position.set(0.7 + (i % 2) * 0.5, 0.31 + i * 0.13, 0.62);
      g.add(cross);
    }
    const label = makeLabelSprite(frameLabelLines());
    label.position.set(0, 2.5, 0);
    label.scale.set(1.5, 0.62, 1);
    g.add(label);
    g.position.copy(PROP_POS);
    scene.add(g);
    prop = { group: g, label };
    if (withCollider) {
      STATIC_COLLIDERS.push({ pos: PROP_POS, radius: PROP_COLLIDER_RADIUS });
      try { window.__TYCOON_V83_COLLISIONS__?.rebuild?.(); } catch (err) { console.warn('[v161 frame workshop] collisions', err); }
    }
    return prop;
  }
  function refreshLabel() {
    try { if (prop?.label) updateLabelSprite(prop.label, frameLabelLines()); } catch (_) { /* label is cosmetic */ }
  }

  // ---- the recipe (surplus only, see TABLE.recipe)
  function reserve() {
    const c = stageIndex < STAGES.length ? stageResourceCost(stageIndex) : null;
    const R = TABLE.recipe;
    return {
      planks: Math.max(0, Number(c?.wood) || 0),
      // never reserve more metal than the storage can hold next to the recipe's own input, else a late stage could starve the chain
      metal: Math.min(Math.max(0, Number(c?.metal) || 0), Math.max(0, metalCapacity() - R.metal)),
    };
  }
  function canCraft() {
    if (!frameWorkshopBuiltV161 || stageIndex < TABLE.recipe.unlockStage) return false;
    const R = TABLE.recipe, r = reserve();
    return framesV161 + R.out <= frameCapacityV161() && planks >= R.planks + r.planks && metal >= R.metal + r.metal;
  }
  function craft() {
    if (!canCraft()) return false;
    const R = TABLE.recipe;
    planks -= R.planks;
    metal -= R.metal;
    framesV161 += R.out;
    try { spawnBurst(PROP_POS, 0xd9a35b); sfx.plank(); } catch (_) { /* feedback only */ }
    refreshLabel();
    updateHUD();
    save();
    return true;
  }
  let timer = 0, labelTimer = 0;
  function tick(dt) {
    if (!frameWorkshopBuiltV161) return;
    if (!prop) buildWorkshopProp(true);
    labelTimer += dt;
    if (labelTimer >= 1) { labelTimer = 0; refreshLabel(); }
    if (stageIndex < TABLE.recipe.unlockStage) return;
    timer += dt;
    const interval = TABLE.recipe.interval / productionSpeedMultiplier();
    if (timer < interval) return;
    timer = craft() ? Math.min(timer - interval, interval) : interval; // blocked: keep the progress bar full, craft the moment inputs arrive
  }
  window.updateFrameWorkshopV161 = tick;

  // ---- pad steps
  const pushStep = (step) => INDUSTRIAL_BUILD_STEPS_V118.push(step);
  pushStep({
    id: 'frame', chainV161: true, icon: '📐', ru: 'Каркасный цех', en: 'Frame Workshop', pos: POS.workshop, cost: scaleCost(TABLE.workshop.cost),
    built: () => frameWorkshopBuiltV161,
    prereq: () => sawmillBuiltV118 && metalYardBuiltV118 && industrialLevelV161('sawmill') >= 2 && industrialLevelV161('metal') >= 2 && stageIndex >= TABLE.workshop.gate,
    run(step) { // one-time building: pay, flag, shed, feedback; no road/fleet/collider-graph rebuild
      if (step.built() || !step.prereq()) return false;
      if (!tryPayResources(step.cost)) {
        sfx.error();
        toast(lang === 'ru' ? `Не хватает: ${opsCostText(step.cost)}` : `Missing: ${opsCostText(step.cost)}`);
        spawnFloatingTextV117(step.pos, lang === 'ru' ? '❗ Не хватает ресурсов' : '❗ Not enough resources');
        return false;
      }
      removeIndustrialPadMarkerV118(step.id);
      frameWorkshopBuiltV161 = true;
      buildWorkshopProp(true);
      const label = lang === 'ru' ? '📐 Каркасный цех построен: доски + металл → каркас' : '📐 Frame workshop built: planks + metal → frames';
      refreshIndustrialPadMarkersV118();
      spawnBurst(step.pos, 0xffd479);
      triggerShake(0.14, 0.22);
      sfx.build();
      toast(label);
      spawnFloatingTextV117(step.pos, label);
      updateHUD();
      save();
      return true;
    },
  });
  for (const kind of ['sawmill', 'concrete', 'metal']) {
    const [ru, en, built] = L3_NAMES[kind], row = TABLE.levels3[kind];
    pushStep({
      id: kind + '3', chainV161: true, upgradeOf: kind, level: 3, ru, en, pos: POS[kind + '3'], cost: scaleCost(row.cost),
      built: () => industrialLevelV161(kind) >= 3,
      prereq: () => built() && industrialLevelV161(kind) >= 2 && frameWorkshopBuiltV161 && stageIndex >= row.gate,
    });
  }

  // ---- HUD: one more `.stat` chip next to the metal one, shown once the workshop exists or frames are held
  function ensureHudStat() {
    let el = document.getElementById('frameStat');
    if (el) return el;
    const anchor = document.getElementById('metalStat');
    if (!anchor) return null;
    el = document.createElement('div');
    el.className = 'stat';
    el.id = 'frameStat';
    el.hidden = true;
    el.innerHTML = '<span id="frameAmt">0</span>'; // like the other chips: number only, the icon is the game's own SVG chip icon (ensureHudIconV36)
    anchor.after(el);
    try { ensureHudIconV36('frameStat', 'project'); } catch (_) { /* icon is cosmetic */ }
    return el;
  }
  function refreshHudStat() {
    const el = ensureHudStat();
    if (!el) return;
    el.hidden = !(frameWorkshopBuiltV161 || framesV161 > 0);
    const amt = document.getElementById('frameAmt');
    if (amt) amt.textContent = `${fmt(framesV161)}/${fmt(frameCapacityV161())}`;
  }
  if (typeof updateHUD === 'function') {
    const prevHud = updateHUD;
    updateHUD = function () { const r = prevHud.apply(this, arguments); try { refreshHudStat(); } catch (_) { /* HUD chip is cosmetic */ } return r; };
  }

  // ---- old/new saves: the shed of a loaded workshop comes back with the page
  if (frameWorkshopBuiltV161) buildWorkshopProp(true);
  refreshIndustrialPadMarkersV118();
  try { refreshHudStat(); } catch (_) { /* cosmetic */ }

  window.PRODUCTION_CHAIN_V161 = { table: TABLE, craft, canCraft, reserve, tick, resetTimer: () => { timer = 0; }, positions: POS, propPos: PROP_POS, propCollider: PROP_COLLIDER_RADIUS, prop: () => prop };
})();
