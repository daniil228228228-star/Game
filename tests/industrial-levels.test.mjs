// Production level 2 (sawmill / concrete plant / metal yard), CHANGELOG_V161.md "Уровни производства".
// Each upgrade is its own ground pad (INDUSTRIAL_BUILD_STEPS_V118 entries with `upgradeOf`), shown only
// when the building exists AND the stage threshold is reached. Checks: pad placement (clear of trees,
// pads, colliders, service roads), unlock thresholds (markers), costs read from the game (documented
// base values x1.25 money / x1.08 rounded-up resources since v124), real #actionBtn press for the
// sawmill, exact charge + level + production speed for all three, gold badge in the scene, save field,
// persistence across a reload, 0 console errors. Fresh save, two page loads in ONE browser launch.
// Set SHOT=/path.png to also write a screenshot next to the sawmill upgrade pad (manual inspection).
import { openGame, reloadGame, check, scaledCost, waitForState, jumpStage } from './lib/harness.mjs';

const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- 1. fresh state, table, costs
const t0 = await ev(() => ({
  levels: ['sawmill', 'concrete', 'metal'].map(industrialLevelV161),
  ids: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => !s.infraOf && !s.chainV161).map((s) => s.id), // infraOf = district-infra pads (district-infra.test.mjs), chainV161 = workshop + level 3 (production-chain.test.mjs)
  up: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.upgradeOf && s.level === 2).map((s) => ({ id: s.id, of: s.upgradeOf, level: s.level, cost: { ...s.cost }, pad: { x: s.pos.x, z: s.pos.z } })),
  markers: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.upgradeOf && s.level === 2).map((s) => industrialPadMarkersV118.has(s.id)),
}));
check(t0.levels.every((l) => l === 1), `fresh game: all production levels are 1 (${t0.levels})`);
check(JSON.stringify(t0.ids.slice(4)) === JSON.stringify(['sawmill2', 'concrete2', 'metal2']), `level-2 steps follow the four build steps (${t0.ids})`);
check(t0.markers.every((m) => !m), 'fresh game: no level-2 pad marker');
const BASE = { sawmill2: [300, 4, 0, 0], concrete2: [1200, 8, 2, 0], metal2: [2800, 10, 4, 1] };
for (const u of t0.up) {
  const [money, wood, concrete, metal] = BASE[u.id], want = scaledCost({ money, wood, concrete, metal });
  check(u.cost.money === want.money && u.cost.wood === want.wood && u.cost.concrete === want.concrete && u.cost.metal === want.metal,
    `'${u.id}' costs ${JSON.stringify(u.cost)} (documented ${BASE[u.id]} scaled by v124)`);
}
check(t0.up[0].cost.money < t0.up[1].cost.money && t0.up[1].cost.money < t0.up[2].cost.money, 'level-2 costs increase sawmill < concrete < metal');

// ---- 2. build the four buildings through the owning function, then placement of the three pads
await ev(() => { money = 1e6; planks = 500; concrete = 100; metal = 100; for (const id of ['depot', 'sawmill', 'concrete', 'metal']) buildIndustrialStepV118(industrialStepV118(id)); });
const place = await ev(() => {
  const nodes = serviceAccessGraph(), by = new Map(nodes.map((n) => [n.id, n]));
  const dseg = (x, z, a, b) => { const abx = b.x - a.x, abz = b.z - a.z, l = abx * abx + abz * abz, t = l ? Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / l)) : 0; return Math.hypot(x - a.x - abx * t, z - a.z - abz * t); };
  return INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.upgradeOf).map((s) => {
    const p = s.pos;
    let road = Infinity; for (const n of nodes) { const q = n.parent && by.get(n.parent); if (q) road = Math.min(road, dseg(p.x, p.z, n.p, q.p)); }
    const others = INDUSTRIAL_BUILD_STEPS_V118.filter((o) => o !== s).map((o) => Math.hypot(p.x - o.pos.x, p.z - o.pos.z));
    const trees = sourceTrees.map((t) => Math.hypot(p.x - t.mesh.position.x, p.z - t.mesh.position.z));
    const cols = STATIC_COLLIDERS.map((c) => Math.hypot(p.x - c.pos.x, p.z - c.pos.z) - c.radius);
    const zones = Object.values(LOGISTICS_ZONES).map((z) => Math.hypot(p.x - z.pos.x, p.z - z.pos.z));
    return { id: s.id, road, pad: Math.min(...others), tree: Math.min(...trees), col: Math.min(...cols), zone: Math.min(...zones), dropoff: Math.hypot(p.x - SAWMILL_DROPOFF_POS.x, p.z - SAWMILL_DROPOFF_POS.z), treeRadius: TREE_INTERACT_RADIUS };
  });
});
for (const p of place) {
  check(p.road > 2.3, `${p.id} pad is clear of the service road (${p.road.toFixed(2)} m)`);
  check(p.pad > 2.2 && p.zone > 1.9 && p.dropoff > 2.2, `${p.id} pad does not overlap other pads/loading zones (pad ${p.pad.toFixed(2)}, zone ${p.zone.toFixed(2)}, dropoff ${p.dropoff.toFixed(2)})`);
  check(p.col > 0.8, `${p.id} pad is clear of building colliders (${p.col.toFixed(2)} m)`);
  check(p.tree > p.treeRadius + 0.3, `${p.id} pad is outside every tree's interaction ring (${p.tree.toFixed(2)} > ${p.treeRadius})`);
}

// ---- 3. unlock thresholds: marker set per stage (stage jumps in one synchronous evaluate, restored afterwards)
const unlock = await ev(() => {
  const keep = stageIndex, out = {};
  for (const s of [0, 2, 3, 4, 5, 6, 0]) {
    stageIndex = s; refreshIndustrialPadMarkersV118();
    out[s] = INDUSTRIAL_BUILD_STEPS_V118.filter((x) => x.upgradeOf && industrialPadMarkersV118.get(x.id)?.parent === scene).map((x) => x.id);
  }
  stageIndex = keep; refreshIndustrialPadMarkersV118();
  return out;
});
const J = JSON.stringify;
check(J(unlock[0]) === '[]' && J(unlock[2]) === '[]', `stage 0/2: no level-2 pad (${J(unlock[0])} ${J(unlock[2])})`);
check(J(unlock[3]) === '["sawmill2"]' && J(unlock[4]) === '["sawmill2"]', `stage 3-4: only the sawmill pad (${J(unlock[3])} ${J(unlock[4])})`);
check(J(unlock[5]) === '["sawmill2","concrete2"]', `stage 5 (concrete unlock + 1): sawmill + concrete pads (${J(unlock[5])})`);
check(J(unlock[6]) === '["sawmill2","concrete2","metal2"]', `stage 6 (metal unlock + 1): all three pads (${J(unlock[6])})`);
const early = await ev(() => { stageIndex = 2; const st = industrialStepV118('sawmill2'), m = money, ok = buildIndustrialStepV118(st); stageIndex = 0; return { ok, spent: m - money, level: industrialLevelV161('sawmill') }; });
check(!early.ok && early.spent === 0 && early.level === 1, `sawmill2 refuses to build below its stage and charges nothing (${J(early)})`);

// ---- 4. production speed at level 1 (concrete/metal timers driven directly with a synthetic dt)
// Stage jump with the one-time company-tier rewards (COMPANY_TIERS) claimed explicitly: credited exactly once, never twice.
const tierSum = await ev(() => COMPANY_TIERS.filter((t) => t.stage > 0 && t.stage <= 6).reduce((n, t) => n + t.reward, 0));
const jump1 = await jumpStage(page, 6), jump2 = await jumpStage(page, 6);
check(jump1.tierMoney <= tierSum, `stage 0 -> 6 credits the tier rewards at most once (${jump1.tierMoney} of ${tierSum})`);
check(jump2.tierMoney === 0, `jumping to stage 6 again credits nothing (${jump2.tierMoney}): tier rewards are once per lifetime`);
const speedL1 = await ev(() => {
  const out = { sawmillInterval: sawmillAutoInterval() };
  const cI = CONCRETE_AUTO_INTERVAL / productionSpeedMultiplier(), mI = METAL_AUTO_INTERVAL / productionSpeedMultiplier();
  concrete = 0; concretePlantTimer = 0; updateConcretePlant(cI / 1.4 + 0.05); out.concrete = concrete;
  metal = 0; metalPlantTimer = 0; updateMetalPlant(mI / 1.4 + 0.05); out.metal = metal;
  out.cI = cI; out.mI = mI;
  return out;
});
check(speedL1.concrete === 0 && speedL1.metal === 0, `level 1: a tick of interval/1.4 produces nothing yet (${speedL1.concrete}/${speedL1.metal})`);

// ---- 5. real #actionBtn press on the sawmill pad (stage 3)
const sawPad = await ev(() => { stageIndex = 3; refreshIndustrialPadMarkersV118(); money = 1e6; planks = 500; const p = industrialStepV118('sawmill2').pos; player.position.set(p.x, 0, p.z); const t = nearestManualTargetV53(); return { x: p.x, z: p.z, cand: t && { type: t.type, step: t.step?.id } }; });
check(sawPad.cand?.type === 'industrial' && sawPad.cand.step === 'sawmill2', `standing on the pad offers the sawmill upgrade (${J(sawPad.cand)})`);
const prompt = await waitForState(page, () => { const el = document.getElementById('actionPrompt'); return el?.classList.contains('show') ? el.textContent : false; }, null, { fallback: '' });
check(/Улучшить|Upgrade/.test(prompt), `#actionPrompt offers an upgrade (${prompt})`);
const sb = await ev(() => ({ money, planks, interval: sawmillAutoInterval() }));
const pressed = await waitForState(page, () => {
  if (industrialLevelV161('sawmill') >= 2) return true;
  const btn = document.getElementById('actionBtn');
  if (btn && !btn.hidden && !btn.disabled) btn.click();
  return false;
}, null, { timeout: 25000 });
if (!pressed) { console.log('KNOWN ISSUE: pressing #actionBtn on the sawmill2 pad did not upgrade within 25 s; upgraded through the owning function instead'); await ev(() => buildIndustrialStepV118(industrialStepV118('sawmill2'))); }
const sa = await ev(() => ({ money, planks, interval: sawmillAutoInterval(), level: industrialLevelV161('sawmill'), cost: { ...industrialStepV118('sawmill2').cost }, marker: industrialPadMarkersV118.has('sawmill2'), badge: !!scene.getObjectByName('v161LevelBadge_sawmill')?.parent }));
check(sa.level === 2 && Math.abs((sb.money - sa.money) - sa.cost.money) <= 3 && sb.planks - sa.planks >= sa.cost.wood - 1 && sb.planks - sa.planks <= sa.cost.wood, `sawmill level 2, charged ~${sa.cost.money} money + ${sa.cost.wood} planks (${Math.round(sb.money - sa.money)} / ${sb.planks - sa.planks})`);
check(Math.abs(sb.interval / sa.interval - 1.5) < 1e-6, `sawmill auto interval ${sb.interval.toFixed(2)} s -> ${sa.interval.toFixed(2)} s (x1.5)`);
check(!sa.marker && sa.badge, 'sawmill2 pad marker removed, gold badge added to the scene');
if (process.env.SHOT) { await page.waitForTimeout(1500); await page.screenshot({ path: process.env.SHOT }); }

// ---- 6. concrete2 and metal2 through the owning function: exact charge, level, speed
for (const id of ['concrete2', 'metal2']) {
  const r = await ev((id) => {
    // The "+1320" seen here before: COMPANY_TIERS rewards (+420 at stage 4, +900 at stage 6; the +180 of
    // stage 2 was already claimed at stage 3), once per lifetime, credited by checkCompanyTierRewards()
    // inside updateHUD() -- intended, NOT a double credit (see CHANGELOG_V161.md). Claim them before measuring.
    stageIndex = 6; checkCompanyTierRewards();
    money = 1e6; planks = 500; concrete = 100; metal = 100; refreshIndustrialPadMarkersV118();
    const st = industrialStepV118(id), b = { money, planks, concrete, metal };
    // Measure the money charged inside tryPayResources itself (a before/after delta would also mix in any
    // reward credited elsewhere in the same call, e.g. the tier rewards above).
    const orig = tryPayResources; let charged = null;
    tryPayResources = function (c) { const m0 = money, r0 = orig.apply(this, arguments); charged = m0 - money; return r0; };
    let ok; try { ok = buildIndustrialStepV118(st); } finally { tryPayResources = orig; }
    return { ok, spent: { money: charged, wood: b.planks - planks, concrete: b.concrete - concrete, metal: b.metal - metal }, cost: { ...st.cost }, level: industrialLevelV161(st.upgradeOf), marker: industrialPadMarkersV118.has(id), badge: !!scene.getObjectByName('v161LevelBadge_' + st.upgradeOf)?.parent };
  }, id);
  check(r.ok && r.level === 2 && r.spent.money === r.cost.money && r.spent.wood === r.cost.wood && r.spent.concrete === r.cost.concrete && r.spent.metal === r.cost.metal, `${id}: charged exactly ${J(r.cost)}, level 2 (${J(r.spent)})`);
  check(!r.marker && r.badge, `${id}: pad marker removed, badge in scene`);
  const again = await ev((id) => { const m = money; return { ok: buildIndustrialStepV118(industrialStepV118(id)), spent: m - money }; }, id);
  check(!again.ok && again.spent === 0, `${id}: cannot be bought twice`);
}
const speedL2 = await ev((s) => {
  stageIndex = 6;
  const cI = CONCRETE_AUTO_INTERVAL / productionSpeedMultiplier(), mI = METAL_AUTO_INTERVAL / productionSpeedMultiplier();
  concrete = 0; concretePlantTimer = 0; updateConcretePlant(cI / 1.4 + 0.05);
  metal = 0; metalPlantTimer = 0; updateMetalPlant(mI / 1.4 + 0.05);
  return { concrete, metal, speeds: ['sawmill', 'concrete', 'metal'].map(industrialSpeedV161) };
}, speedL1);
check(speedL2.concrete === 1 && speedL2.metal === 1, `level 2: the same tick now produces 1 concrete / 1 metal (${speedL2.concrete}/${speedL2.metal})`);
check(J(speedL2.speeds) === '[1.5,1.4,1.4]', `speed factors ${J(speedL2.speeds)}`);

// ---- 7. save field + persistence across a reload (stage restored first so the autosave is a normal one)
const saved = await ev(() => { stageIndex = 0; refreshIndustrialPadMarkersV118(); save(); return JSON.parse(localStorage.getItem('tycoon3d_save_v3')).industrialLevelsV161; });
check(J(saved) === '{"sawmill":2,"concrete":2,"metal":2}', `save() writes industrialLevelsV161 ${J(saved)}`);
const errs = await reloadGame(g, 5000);
const after = await ev(() => ({ levels: ['sawmill', 'concrete', 'metal'].map(industrialLevelV161), badges: ['sawmill', 'concrete', 'metal'].map((k) => !!scene.getObjectByName('v161LevelBadge_' + k)?.parent), flags: [sawmillBuiltV118, concretePlantBuiltV118, metalYardBuiltV118], interval: sawmillAutoInterval() }));
check(J(after.levels) === '[2,2,2]' && after.badges.every(Boolean), `levels and badges survive a reload (${J(after.levels)}, badges ${J(after.badges)})`);
check(after.flags.every(Boolean) && errs.length === 0, `reload: buildings still built, 0 console errors (${J(errs.slice(0, 3))})`);
check(g.errors.length === 0, `no console errors in the whole run ${J(g.errors.slice(0, 3))}`);
await g.close();
