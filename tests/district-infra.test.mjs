// District infrastructure ground pads (assets/district-infra-v161.js, CHANGELOG_V161.md "Инфраструктура района").
// Road / lighting / power / water ladders (v37, v41) and the v42 power plant / water works already existed
// but only in the City overlay; this layer adds one pad per (district, kind) plus two city-wide plant pads to
// the shared INDUSTRIAL_BUILD_STEPS_V118 pipeline. Checks: 18 steps, no pad on a fresh game or a district at
// level 0, placement clear of colliders/other pads/plant models, guidance target (only when affordable), one
// REAL #actionBtn press (exact charge, pad disappears while pending, level after the pending timer), the
// whole chain road L1 -> light L1 -> power plant -> power -> water works -> water through the pad function with
// the exact charge each (costs are the panel's own cost functions, read from the game), locked districts get
// no pad, district level 2 brings the road L2 pad back, persistence across a reload, 0 console errors.
// Fresh save, two page loads in ONE browser launch.
import { openGame, reloadGame, check } from './lib/harness.mjs';

const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;

// ---- 1. fresh game
const t0 = await ev(() => ({
  ids: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf).map((s) => s.id),
  visible: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).length,
  markers: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && industrialPadMarkersV118.has(s.id)).length,
  district: districtLevel('suburb'),
  nonInfra: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => !s.infraOf && !s.chainV161 /* workshop + level 3: production-chain.test.mjs */).map((s) => s.id),
}));
check(t0.ids.length === 18 && t0.ids.includes('infra-suburb-road') && t0.ids.includes('infra-waterfront-water') && t0.ids.includes('infra-plant-power') && t0.ids.includes('infra-plant-water'), `18 infra steps registered (${t0.ids.length})`);
check(t0.visible === 0 && t0.markers === 0 && t0.district === 0, 'fresh game: district level 0, no infra pad or marker');
check(J(t0.nonInfra) === J(['depot', 'sawmill', 'concrete', 'metal', 'sawmill2', 'concrete2', 'metal2']), `original pad steps untouched and first in order (${t0.nonInfra})`);

// ---- 2. unlock district level 1 through the real owning function; industrial chain first so guidance is not about it
const s2 = await ev(() => {
  money = 1e6; planks = 500; concrete = 100; metal = 100;
  for (const id of ['depot', 'sawmill', 'concrete', 'metal']) buildIndustrialStepV118(industrialStepV118(id));
  upgradeCityDistrict('suburb');
  refreshIndustrialPadMarkersV118();
  const vis = INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id);
  return { level: districtLevel('suburb'), vis, marker: industrialPadMarkersV118.get('infra-suburb-road')?.parent === scene,
    others: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.infraOf !== 'suburb' && s.infraOf !== 'city' && s.prereq()).length };
});
check(s2.level === 1, `suburb developed to level 1 (${s2.level})`);
check(J(s2.vis) === '["infra-suburb-road"]' && s2.marker, `only the suburb road L1 pad is offered, with a marker in the scene (${J(s2.vis)})`);
check(s2.others === 0, 'other districts (locked) have no pad');

// ---- 3. placement of the four suburb pads and the two plant pads
const place = await ev(() => {
  const steps = INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf);
  const hub = CITY_DISTRICTS.find((d) => d.id === 'suburb').pos;
  const rect = (o, x, z) => { const b = new THREE.Box3().setFromObject(o); return Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z)); };
  const model = (px) => scene.children.find((o) => o.type === 'Group' && Math.abs(o.position.x - px) < 1e-6 && Math.abs(o.position.z - 52) < 1e-6);
  const mp = model(-12), mw = model(0);
  return steps.map((s) => {
    const p = s.pos, others = steps.filter((o) => o !== s).map((o) => Math.hypot(p.x - o.pos.x, p.z - o.pos.z));
    return { id: s.id, hub: Math.hypot(p.x - hub.x, p.z - hub.z), pad: Math.min(...others), col: Math.min(...STATIC_COLLIDERS.map((c) => Math.hypot(p.x - c.pos.x, p.z - c.pos.z) - c.radius)),
      inGround: Math.hypot(p.x, p.z) < GROUND_HALF - 3, road: distToNearestRoadNetworkV369(p.x, p.z),
      model: s.id === 'infra-plant-power' ? (mp ? rect(mp, p.x, p.z) : -1) : s.id === 'infra-plant-water' ? (mw ? rect(mw, p.x, p.z) : -1) : null, x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
  });
});
for (const p of place.filter((q) => q.id.startsWith('infra-suburb'))) check(p.hub > 5.5 && p.hub < 8.6 && p.inGround, `${p.id} pad ${p.hub.toFixed(1)} m from the hub (${p.x},${p.z})`);
for (const p of place) check(p.pad > 2.4 && p.col > 0.8 && p.road > 1.0, `${p.id} pad clear of other pads (${p.pad.toFixed(1)}), colliders (${p.col.toFixed(1)}), roads (${p.road.toFixed(1)})`);
for (const p of place.filter((q) => q.model !== null)) check(p.model > 0.8, `${p.id} pad is outside the plant model's footprint (${p.model.toFixed(2)} m; -1 = model not found)`);

// ---- 4. guidance: the compass target is the affordable infra pad; nothing when unaffordable
const guide = await ev(() => {
  const keep = currentPad; currentPad = null; const m = money, pl = planks, c = concrete, mt = metal;
  const a = nextActionableTargetV117();
  money = 0; planks = 0; concrete = 0; metal = 0; const b = nextActionableTargetV117();
  money = m; planks = pl; concrete = c; metal = mt; currentPad = keep;
  return { a: a && { type: a.type, id: a.stepId }, b: b && { type: b.type, id: b.stepId } };
});
check(guide.a?.type === 'industrial' && guide.a.id === 'infra-suburb-road', `guidance points at the affordable road pad (${J(guide.a)})`);
check(guide.b === null, `guidance is empty when nothing is affordable (${J(guide.b)})`);

// ---- 5. real #actionBtn press on the road pad: exact charge, one press = one charge
const roadCost = await ev(() => ({ ...industrialStepV118('infra-suburb-road').cost, panel: { ...districtRoadsBuildCost('suburb') } }));
await ev(() => { const p = industrialStepV118('infra-suburb-road').pos; player.position.set(p.x, 0, p.z); nearestManualTargetV53(); });
const prompt = await page.waitForFunction(() => { const el = document.getElementById('actionPrompt'); return el?.classList.contains('show') ? el.textContent : false; }, null, { timeout: 20000, polling: 'raf' }).then((h) => h.jsonValue(), () => '');
check(/Дорога L1|Road L1/.test(prompt) && /Построить|Build/.test(prompt), `#actionPrompt offers the road pad (${prompt})`);
await ev(() => { window.__charges = []; const orig = tryPayResources; window.__origPay = orig; tryPayResources = function (c) { const b = { m: money, p: planks, c: concrete, t: metal }, r = orig.apply(this, arguments); window.__charges.push({ ok: r, money: b.m - money, wood: b.p - planks, concrete: b.c - concrete, metal: b.t - metal }); return r; }; });
const pressed = await page.waitForFunction(() => {
  if ((cityState.districtRoads.suburb.pendingUntil || 0) > 0 || districtRoadLevelV37('suburb') >= 1) return true;
  const btn = document.getElementById('actionBtn');
  if (btn && !btn.hidden && !btn.disabled) btn.click();
  return false;
}, null, { timeout: 25000, polling: 'raf' }).then(() => true, () => false);
const afterPress = await ev(() => { const o = { charges: window.__charges.slice(), pending: cityState.districtRoads.suburb.pendingUntil > 0, vis: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id), marker: industrialPadMarkersV118.has('infra-suburb-road') }; return o; });
if (!pressed) console.log('KNOWN ISSUE: pressing #actionBtn on the infra road pad did not start the road within 25 s');
const ch = afterPress.charges.filter((c) => c.ok);
check(pressed && ch.length === 1 && ch[0].money === roadCost.money && ch[0].wood === roadCost.wood && ch[0].concrete === roadCost.concrete && ch[0].metal === roadCost.metal, `real press charged exactly the pad cost once (${J(ch)} vs ${J({ ...roadCost, panel: undefined })})`);
check(roadCost.money === roadCost.panel.money && roadCost.wood === roadCost.panel.wood, `pad cost equals the City panel's districtRoadsBuildCost (${roadCost.money} money, ${roadCost.wood} wood)`);
check(afterPress.pending && !afterPress.marker && afterPress.vis.length === 0, `while the road is being built the pad is gone (pending ${afterPress.pending}, marker ${afterPress.marker}, visible ${J(afterPress.vis)})`);
const again = await ev(() => { const m = money; return { ok: buildIndustrialStepV118(industrialStepV118('infra-suburb-road')), spent: m - money }; });
check(!again.ok && again.spent === 0, 'the road cannot be bought twice while pending');

// ---- 6. the chain through the pad function, exact charge each, gating order
async function waitLevel(id, before) {
  return page.waitForFunction(([id, before]) => industrialStepV118(id).level > before, [id, before], { timeout: 45000, polling: 250 }).then(() => true, () => false);
}
async function buy(id) {
  const r = await ev((id) => {
    money = 1e6; planks = 500; concrete = 100; metal = 100; window.__charges.length = 0;
    const st = industrialStepV118(id), cost = { ...st.cost }, lvl = st.level, ok = buildIndustrialStepV118(st);
    return { ok, cost, lvl, charges: window.__charges.filter((c) => c.ok), marker: industrialPadMarkersV118.has(id) };
  }, id);
  const done = await waitLevel(id, r.lvl);
  const vis = await ev(() => INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id));
  const exact = r.charges.length === 1 && r.charges[0].money === r.cost.money && r.charges[0].wood === r.cost.wood && r.charges[0].concrete === r.cost.concrete && r.charges[0].metal === r.cost.metal;
  return { ...r, done, vis, exact };
}
check(await waitLevel('infra-suburb-road', 1), 'road L1 completed after its pending timer');
let vis = await ev(() => INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id));
check(J(vis) === '["infra-suburb-light"]', `road L1 done -> only the lighting pad (${J(vis)})`);
const costs = { road: roadCost.money };
const chain = [
  // the power plant and the water works are independent of each other (both only need road + lighting L1 somewhere)
  ['infra-suburb-light', ['infra-plant-power', 'infra-plant-water']],
  ['infra-plant-power', ['infra-suburb-power', 'infra-plant-water']],
  ['infra-suburb-power', ['infra-plant-water']],
  ['infra-plant-water', ['infra-suburb-water']],
  ['infra-suburb-water', []],
];
for (const [id, next] of chain) {
  const r = await buy(id);
  costs[id] = r.cost.money;
  check(r.ok && r.exact && !r.marker, `${id}: charged exactly ${J(r.cost)} (${J(r.charges)}), pad removed while pending`);
  check(r.done && J(r.vis) === J(next), `${id}: level reached, next visible pads ${J(r.vis)} (expected ${J(next)})`);
}
console.log('INFO money cost of each step (x1.25-scaled costs where the game scales them): ' + J(costs));
const lv1 = await ev(() => ({ road: districtRoadLevelV37('suburb'), light: districtStreetlightLevelV37('suburb'), power: __TYCOON_V41__.power('suburb'), water: __TYCOON_V41__.water('suburb'), pp: __TYCOON_V42__.state.powerPlantLevel, wp: __TYCOON_V42__.state.waterPlantLevel,
  lockedPads: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.infraOf !== 'suburb' && s.infraOf !== 'city' && s.prereq()).length }));
check(J(lv1) === J({ road: 1, light: 1, power: 1, water: 1, pp: 1, wp: 1, lockedPads: 0 }), `infrastructure L1 complete (${J(lv1)}), locked districts still have no pad`);

// ---- 7. district level 2 brings the road L2 pad back; save, reload, persistence
const s7 = await ev(() => {
  money = 1e6; planks = 500; concrete = 100; metal = 100;
  upgradeCityDistrict('suburb'); refreshIndustrialPadMarkersV118();
  const st = industrialStepV118('infra-suburb-road');
  save();
  return { level: districtLevel('suburb'), vis: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id), label: st.ru, pos: { x: st.pos.x, z: st.pos.z } };
});
check(s7.level === 2 && J(s7.vis) === '["infra-suburb-road"]' && /L2/.test(s7.label), `district level 2 -> road L2 pad (${J(s7.vis)}, "${s7.label}")`);
const errs = await reloadGame(g, 6000);
const after = await ev(() => ({ district: districtLevel('suburb'), road: districtRoadLevelV37('suburb'), light: districtStreetlightLevelV37('suburb'), power: __TYCOON_V41__.power('suburb'), water: __TYCOON_V41__.water('suburb'), pp: __TYCOON_V42__.state.powerPlantLevel, wp: __TYCOON_V42__.state.waterPlantLevel,
  steps: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf).length, vis: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id), marker: industrialPadMarkersV118.get('infra-suburb-road')?.parent === scene,
  pos: (() => { const p = industrialStepV118('infra-suburb-road').pos; return { x: p.x, z: p.z }; })() }));
check(J([after.district, after.road, after.light, after.power, after.water, after.pp, after.wp]) === '[2,1,1,1,1,1,1]', `levels survive the reload (${J(after)})`);
check(after.steps === 18 && J(after.vis) === '["infra-suburb-road"]' && after.marker, `after the reload the road L2 pad is offered again with its marker (${J(after.vis)})`);
console.log(`INFO road pad position before/after reload: ${J(s7.pos)} / ${J(after.pos)}`);
check(errs.length === 0 && g.errors.length === 0, `0 console errors (reload: ${J(errs.slice(0, 3))}, run: ${J(g.errors.slice(0, 3))})`);
await g.close();
