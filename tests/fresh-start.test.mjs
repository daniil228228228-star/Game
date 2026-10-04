// Fresh save (no tycoon3d_save_v3 key) = empty world with the v144 starter flow:
//   2 starter supply runs (+25 each) -> first house -> road -> fleet depot -> sawmill -> first plank,
// then the staged industrial unlock: depot -> sawmill -> concrete + metal (parallel), each pad only
// a candidate once its prerequisite is built. Exactly one browser launch; the two supply runs go
// through the real #actionBtn path (player position + prompt + click), everything after uses the
// owning game functions directly (purchaseCurrentPad, buildIndustrialStepV118) instead of long
// real-time waits (the game runs at ~3 fps in software rendering). Costs are read from the game
// because v124 scales them x1.25 at boot (e.g. depot 60 -> 75, sawmill 100 -> 125).
import { openGame, check } from './lib/harness.mjs';

const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- boot state of a brand-new game ----
const s0 = await ev(() => ({
  money: Math.floor(money), stageIndex, buildings: buildings.length, manualRoad: manualRoadModeV116,
  flags: { depot: fleetDepotBuiltV118, sawmill: sawmillBuiltV118, concrete: concretePlantBuiltV118, metal: metalYardBuiltV118 },
  stalls: marketStallsBuiltV118.size, stallsInScene: marketRuntimeV116.stalls.size,
  markers: Object.fromEntries(INDUSTRIAL_BUILD_STEPS_V118.map((s) => [s.id, industrialPadMarkersV118.has(s.id)])),
  hasPad: !!currentPad && currentPad.index === 0, step: window.__TYCOON_V144__.step()?.id ?? null,
}));
check(s0.stageIndex === 0 && s0.buildings === 0 && s0.manualRoad === true, 'fresh game: empty world, manual road mode on');
// (startingCashAmount() itself flips 220 -> 300 once the first autosave exists, so don't compare to it)
check(s0.money > 0 && s0.money <= 250, `fresh game: small starting cash (${s0.money})`);
check(Object.values(s0.flags).every((v) => v === false) && s0.stalls === 0 && s0.stallsInScene === 0, 'fresh game: nothing industrial or market built');
check(s0.markers.depot && !s0.markers.sawmill && !s0.markers.concrete && !s0.markers.metal, `fresh game: only the depot pad marker exists ${JSON.stringify(s0.markers)}`);
check(s0.hasPad && s0.step === 'supplies', `first step is the starter supply job, first house pad spawned (step ${s0.step})`);

// ---- starter supply runs through the real action button ----
const PICKUP = { x: -5.8, z: 2.65 }, DROP = { x: 1.35, z: 2.85 };
async function pressAt(pos, action) {
  await ev((p) => { player.position.set(p.x, 0, p.z); }, pos);
  // Click the real #actionBtn on every animation frame until the starter state flips: the prompt
  // is only valid on frames where the starter layer owns the button, so a single click can race it.
  await page.waitForFunction((a) => {
    const f = window.__TYCOON_V144__.state;
    if (a === 'pickup' ? f.carrying : !f.carrying) return true;
    const btn = document.getElementById('actionBtn');
    if (btn?.dataset.v144StarterAction === a) btn.click();
    return false;
  }, action, { timeout: 60000, polling: 'raf' });
}
const money0 = s0.money;
await pressAt(PICKUP, 'pickup');
check(await ev(() => window.__TYCOON_V144__.state.carrying === true && window.__TYCOON_START_CARRY__() === true), 'pickup: player is carrying starter supplies');
await pressAt(DROP, 'drop');
const afterRun1 = await ev(() => ({ runs: window.__TYCOON_V144__.state.runs, money: Math.floor(money), carrying: window.__TYCOON_V144__.state.carrying }));
check(afterRun1.runs === 1 && !afterRun1.carrying && afterRun1.money >= money0 + 25, `run 1 paid out (+25): ${money0} -> ${afterRun1.money}`);
await pressAt(PICKUP, 'pickup');
await pressAt(DROP, 'drop');
const afterRun2 = await ev(() => ({ runs: window.__TYCOON_V144__.state.runs, money: Math.floor(money), step: window.__TYCOON_V144__.step()?.id ?? null }));
check(afterRun2.runs === 2 && afterRun2.money >= money0 + 50, `run 2 paid out: money ${afterRun2.money}`);
check(afterRun2.step === 'house', `after 2 runs the next step is the first house (step ${afterRun2.step})`);

// ---- first house through the owning function (real cost deducted, real mesh in the scene) ----
const house = await ev(() => {
  const cost = STAGES[0].cost, before = money, meshesBefore = buildings.length;
  const ok = purchaseCurrentPad();
  return { ok, cost, spent: Math.round(before - money), stageIndex, buildings: buildings.length, meshesBefore, meshInScene: !!buildings[0]?.mesh?.parent, nextStep: window.__TYCOON_V144__.step()?.id ?? null };
});
check(house.ok && house.stageIndex === 1 && house.buildings === 1 && house.meshInScene, `first house purchased: stage ${house.stageIndex}, mesh in scene ${house.meshInScene}`);
check(house.spent === house.cost, `house cost deducted exactly (${house.spent} of ${house.cost})`);
check(house.nextStep === 'road', `after the house the next step is the road (step ${house.nextStep})`);

// ---- staged industrial unlock: order, prerequisites, costs, real scene objects ----
const order = await ev(() => INDUSTRIAL_BUILD_STEPS_V118.filter((s) => !s.upgradeOf && !String(s.id).startsWith('infra-')).map((s) => s.id)); // v161 appends level-2 steps (industrial-levels.test.mjs) and 18 infra-* pads (district-infra.test.mjs)
check(JSON.stringify(order) === JSON.stringify(['depot', 'sawmill', 'concrete', 'metal']), `industrial order depot -> sawmill -> concrete -> metal (${order})`);
const costs = await ev(() => Object.fromEntries(INDUSTRIAL_BUILD_STEPS_V118.filter((s) => !s.upgradeOf && !String(s.id).startsWith('infra-')).map((s) => [s.id, s.cost.money])));
check(costs.depot < costs.sawmill && costs.sawmill < costs.concrete && costs.concrete < costs.metal, `step costs strictly increase ${JSON.stringify(costs)}`);

async function build(id) {
  return ev((id) => {
    const st = industrialStepV118(id), before = { money, wood: planks };
    const ok = buildIndustrialStepV118(st);
    return { ok, spent: Math.round(before.money - money), woodSpent: Math.round(before.wood - planks), cost: st.cost, built: st.built(), marker: industrialPadMarkersV118.has(id),
      markers: Object.fromEntries(INDUSTRIAL_BUILD_STEPS_V118.map((s) => [s.id, industrialPadMarkersV118.has(s.id) && industrialPadMarkersV118.get(s.id).parent === scene])) };
  }, id);
}
await ev(() => { money = 100000; planks = 200; });

// prerequisites: sawmill/concrete/metal refuse to build out of order and charge nothing
for (const id of ['sawmill', 'concrete', 'metal']) {
  const r = await build(id);
  check(!r.ok && !r.built && r.spent === 0, `'${id}' refuses to build before its prerequisite (spent ${r.spent})`);
}
let r = await build('depot');
check(r.ok && r.built && r.spent === r.cost.money, `depot built, charged ${r.spent}`);
check(!r.markers.depot && r.markers.sawmill && !r.markers.concrete && !r.markers.metal, `depot done -> only the sawmill marker is in the scene ${JSON.stringify(r.markers)}`);
for (const id of ['concrete', 'metal']) check(!(await build(id)).ok, `'${id}' still locked while the sawmill is missing`);
r = await build('sawmill');
check(r.ok && r.built && r.spent === r.cost.money, `sawmill built, charged ${r.spent}`);
check(!r.markers.sawmill && r.markers.concrete && r.markers.metal, `sawmill done -> concrete and metal markers appear in parallel ${JSON.stringify(r.markers)}`);
r = await build('concrete');
check(r.ok && r.spent === r.cost.money && r.woodSpent === r.cost.wood, `concrete plant built (charged ${r.spent} money + ${r.woodSpent} planks)`);
r = await build('metal');
check(r.ok && r.spent === r.cost.money && r.woodSpent === r.cost.wood, `metal yard built (charged ${r.spent} money + ${r.woodSpent} planks)`);
const done = await ev(() => ({
  flags: [fleetDepotBuiltV118, sawmillBuiltV118, concretePlantBuiltV118, metalYardBuiltV118],
  markers: industrialPadMarkersV118.size,
  concreteInScene: !!(concretePlant?.group || concretePlant)?.parent, metalInScene: !!(metalPlant?.group || metalPlant)?.parent,
  fleetYard: !!scene.getObjectByName('v116FleetYard'),
}));
check(done.flags.every(Boolean) && done.markers === 0, `all four built, no leftover pad markers (${done.markers})`);
check(done.concreteInScene && done.metalInScene, 'concrete plant and metal yard objects are attached to the scene');

// the new game's own save records the staged flags (so a reload keeps them)
const saved = await ev(() => { save(); const d = JSON.parse(localStorage.getItem('tycoon3d_save_v3')); return [d.fleetDepotBuiltV118, d.sawmillBuiltV118, d.concretePlantBuiltV118, d.metalYardBuiltV118, d.manualRoadModeV116]; });
check(saved.slice(0, 4).every(Boolean) && saved[4] === true, `save() persists the staged flags ${JSON.stringify(saved)}`);

check(g.errors.length === 0, `no console errors during the first steps ${JSON.stringify(g.errors.slice(0, 3))}`);
await g.close();
