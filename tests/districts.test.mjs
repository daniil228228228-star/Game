// District 2 and 3 (industrial: reputation 25 + company tier 2 = stage 4; business: reputation 60 + tier 3 = stage 6)
// reached through the district hub ground pad (ROADMAP_V161 task 2). The hub pad itself is v116 code
// (nearestManualTargetV53 'district' candidate -> #actionPrompt/#actionBtn -> upgradeCityDistrict); this file checks
// it for the 2nd/3rd district and the v161 additions in assets/district-unlock-v161.js:
//   - the district is closed until BOTH reputation and tier are met (each condition alone is not enough), the hub is
//     in the scene either way, the pad appears exactly when the condition is met (awardCityReputation = the game's
//     own unlock path);
//   - a real #actionBtn press charges exactly districtUpgradeCost (read from the game) once and unlocks level 1;
//   - at level >= 1 the pad says "infrastructure first" and a press neither charges nor upgrades;
//   - the infra pads of the district appear in the right order (road -> light) at the district's own hub, with a marker
//     in the scene, exact charge on a real press, nothing for locked districts;
//   - guidance: nextActionableTargetV117() leads to an unlocked affordable hub pad (never null while one is buyable),
//     is null when it is not affordable, ground arrow points at it; infra-blocked districts are skipped;
//   - state survives a reload;
//   - OLD_SAVE (stage 1) behaves as before: only the suburb hub pad, no district guidance, no infra pads.
// Launch 1: fresh save + one reload. Launch 2: OLD_SAVE. Assertions are on scene / DOM / game state.
import { openGame, reloadGame, check, scaledCost, waitForState, jumpStage, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;

// ---------------------------------------------------------------- launch 1: fresh save
const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);

async function pressUntil(label, doneSrc, timeout = 25000) {
  const ok = await page.waitForFunction((src) => {
    if (new Function('return (' + src + ')')()) return true;
    const btn = document.getElementById('actionBtn');
    if (btn && !btn.hidden && !btn.disabled) btn.click();
    return false;
  }, doneSrc, { timeout, polling: 'raf' }).then(() => true, () => false);
  if (!ok) console.log(`KNOWN ISSUE: pressing #actionBtn on the ${label} pad did not trigger its action within ${timeout / 1000} s`);
  return ok;
}
// stand on a point and read what the shared pad pipeline offers there
const standAt = (id) => ev((id) => {
  const cfg = CITY_DISTRICTS.find((d) => d.id === id);
  player.position.set(cfg.pos.x, 0, cfg.pos.z);
  const t = nearestManualTargetV53();
  return { type: t?.type, id: t?.cfg?.id, unlocked: districtUnlocked(cfg), level: districtLevel(id), rep: cityState.reputation, stage: stageIndex, tier: companyTierIndex() };
}, id);
// wait until the prompt shows text matching `re` (the prompt is rewritten once per frame, so a bare read can be stale)
const promptText = (re = '.') => waitForState(page, (src) => { const el = document.getElementById('actionPrompt'); return el?.classList.contains('show') && new RegExp(src).test(el.textContent) ? el.textContent : false; }, re, { timeout: 20000, fallback: '' });

// ---- 1. fresh game: every hub is in the scene, only the suburb is open, nothing is offered for industrial/business
const f = await ev(() => ({
  levels: CITY_DISTRICTS.map((d) => districtLevel(d.id)),
  unlocked: CITY_DISTRICTS.map((d) => districtUnlocked(d)),
  hubs: CITY_DISTRICTS.map((d) => { const h = cityWorldRuntime.hubs.get(d.id); let ok = false; for (let p = h; p; p = p.parent) if (p === scene) ok = true; return [ok, h ? h.children.length : -1]; }),
  cond: CITY_DISTRICTS.map((d) => [d.id, d.unlockRep, d.unlockTier]),
}));
check(J(f.levels) === '[0,0,0,0]', `fresh game: all districts level 0 (${J(f.levels)})`);
check(J(f.unlocked) === '[true,false,false,false]', `fresh game: only the suburb is unlocked (${J(f.unlocked)})`);
check(f.hubs.every((h) => h[0]), `all 4 district hub groups are in the scene graph (${J(f.hubs)})`);
check(f.hubs[0][1] > 0 && f.hubs.slice(1).every((h) => h[1] === 0), `the open suburb hub has visible content, the locked ones are empty (${J(f.hubs.map((h) => h[1]))})`);
check(J(f.cond.slice(1, 3)) === '[["industrial",25,2],["business",60,3]]', `district 2/3 conditions from CITY_DISTRICTS (${J(f.cond.slice(1, 3))})`);
for (const id of ['industrial', 'business']) {
  const r = await standAt(id);
  check(r.type !== 'district' && !r.unlocked, `fresh game: standing on the ${id} hub offers no pad (${J(r)})`);
}

// ---- 2. district 2 (industrial): each condition alone does not open it; both do, through the game's own award path
const need2 = await ev(() => { const c = CITY_DISTRICTS.find((d) => d.id === 'industrial'); return { rep: c.unlockRep, tier: c.unlockTier, stage: COMPANY_TIERS[c.unlockTier].stage }; });
await jumpStage(page, need2.stage - 1);
await ev((n) => { cityState.reputation = n.rep; }, need2);
const i1 = await standAt('industrial');
check(!i1.unlocked && i1.type !== 'district', `industrial: reputation ${need2.rep} but tier ${i1.tier} < ${need2.tier} -> closed, no pad (${J(i1)})`);
await jumpStage(page, need2.stage);
await ev((n) => { cityState.reputation = n.rep - 1; }, need2);
const i2 = await standAt('industrial');
check(!i2.unlocked && i2.type !== 'district', `industrial: tier ${i2.tier} but reputation ${i2.rep} < ${need2.rep} -> closed, no pad (${J(i2)})`);
await ev(() => awardCityReputation(1, 'test'));
const i3 = await standAt('industrial');
check(i3.unlocked && i3.type === 'district' && i3.id === 'industrial' && i3.level === 0 && i3.rep >= need2.rep, `industrial: reputation ${i3.rep} + tier ${i3.tier} -> the hub pad appears (${J(i3)})`);

// ---- 3. guidance chain: finish the base industrial pads first, then the next target must be a district hub pad
const gd = await ev(() => {
  money = 1e6; planks = 500; concrete = 100; metal = 100;
  window.__TYCOON_V144__.state.runs = 2; // finish the starter supply loop so the compass chain is the base one again (same as guidance.test)
  for (const id of ['depot', 'sawmill', 'concrete', 'metal', 'sawmill2']) buildIndustrialStepV118(industrialStepV118(id));
  window.__keepPad = currentPad; currentPad = null;
  const sub = CITY_DISTRICTS.find((d) => d.id === 'suburb');
  const cost = districtUpgradeCost(sub);
  money = 1e6; planks = 500; concrete = 100; metal = 100;
  const t = nextActionableTargetV117();
  player.position.set(0, 0, 0);
  updateActionableHighlightV117();
  const arrow = ensureGroundArrowV117();
  arrow.updateMatrixWorld(true);
  const mesh = arrow.userData.arrowMesh, tipW = mesh.localToWorld(new THREE.Vector3(0, -0.6, 0)), baseW = mesh.localToWorld(new THREE.Vector3(0, 0.05, 0));
  const dir = new THREE.Vector3(tipW.x - baseW.x, 0, tipW.z - baseW.z).normalize(), want = new THREE.Vector3(sub.pos.x, 0, sub.pos.z).normalize();
  const r = { type: t?.type, id: t?.districtId, posOk: !!t && Math.hypot(t.pos.x - sub.pos.x, t.pos.z - sub.pos.z) < 1e-6, label: t?.label, arrowVisible: arrow.visible, arrowDot: dir.dot(want),
    compass: (() => { const c = currentGuidanceTarget(); return c && { label: c.label, type: c.type, hub: Math.hypot(c.pos.x - sub.pos.x, c.pos.z - sub.pos.z) < 1e-6, finite: Number.isFinite(c.pos.x) && Number.isFinite(c.pos.z) }; })() };
  money = cost.money - 1; // district not affordable -> nothing actionable, the chain does not offer it
  r.unaffordable = nextActionableTargetV117();
  r.unaffordable = r.unaffordable === null ? 'null' : r.unaffordable.type;
  money = 1e6;
  return r;
});
check(gd.type === 'district' && gd.id === 'suburb' && gd.posOk, `unlocked + affordable hub pad is the next guidance target, not null (${J({ type: gd.type, id: gd.id, label: gd.label })})`);
// currentGuidanceTarget() (compass + world marker) used to return null here: the v35 menu-quest layer (uiOnly quest
// "open the district via Systems -> City") blanked it. It now falls through to nextActionableTargetV117().
check(!!gd.compass && gd.compass.finite && gd.compass.hub, `currentGuidanceTarget() (compass / world marker source) returns a real target (${J(gd.compass)})`);
if (gd.compass && !gd.compass.hub) console.log(`INFO compass currently shows "${gd.compass.label}" (a work-layer target outranks the hub pad), the base chain nextActionableTargetV117() still returns the hub`);
check(gd.arrowVisible && gd.arrowDot > 0.999, `ground arrow is visible and its tip points at the hub (dot ${gd.arrowDot?.toFixed(5)})`);
check(gd.unaffordable === 'null', `unaffordable hub pad is not offered by the chain (${gd.unaffordable})`);

// ---- 4. real #actionBtn press on the industrial hub pad: exact charge once, district level 0 -> 1
await ev(() => {
  window.__charges = []; const orig = tryPayResources;
  tryPayResources = function (c) { const b = { m: money, p: planks, c: concrete, t: metal }, r = orig.apply(this, arguments); window.__charges.push({ ok: r, money: b.m - money, wood: b.p - planks, concrete: b.c - concrete, metal: b.t - metal }); return r; };
});
const cost2 = await ev(() => { money = 1e6; planks = 500; concrete = 100; metal = 100; return { ...districtUpgradeCost(CITY_DISTRICTS.find((d) => d.id === 'industrial')) }; });
await standAt('industrial');
const pr1 = await promptText('Развить|Develop');
check(/Развить|Develop/.test(pr1), `#actionPrompt offers the industrial hub pad (${pr1})`);
const btn1 = await ev(() => { const b = document.getElementById('actionBtn'); return { hidden: b.hidden, text: b.textContent }; });
check(!btn1.hidden && /Развить|Develop/.test(btn1.text), `#actionBtn is visible with the develop label (${J(btn1)})`);
const rep0 = await ev(() => cityState.reputation);
const pressed2 = await pressUntil('industrial hub', "districtLevel('industrial') >= 1");
const af2 = await ev(() => ({ charges: window.__charges.filter((c) => c.ok), level: districtLevel('industrial'), rep: cityState.reputation, hub: (() => { const h = cityWorldRuntime.hubs.get('industrial'); let ok = false; for (let p = h; p; p = p.parent) if (p === scene) ok = true; return ok && h.children.length > 0; })(), total: cityState.totalDistrictUpgrades }));
check(pressed2 && af2.level === 1, `real press unlocks the industrial district (level ${af2.level})`);
check(af2.charges.length === 1 && af2.charges[0].money === cost2.money && af2.charges[0].wood === cost2.wood && af2.charges[0].concrete === cost2.concrete && af2.charges[0].metal === cost2.metal, `exactly one charge equal to districtUpgradeCost ${J(cost2)} (${J(af2.charges)})`);
check(af2.rep > rep0 && af2.hub, `unlock awarded reputation (${rep0} -> ${af2.rep}) and the hub was rebuilt in the scene`);
console.log(`INFO industrial level-1 price read from districtUpgradeCost (not scaled by v124): ${J(cost2)}; scaledCost of the same base would be ${J(scaledCost(cost2))}`);

// ---- 5. level >= 1 and infrastructure not done: the pad says so and a press neither charges nor upgrades
const pr2 = await waitForState(page, () => { const el = document.getElementById('actionPrompt'); return el?.classList.contains('show') && /сначала|first/i.test(el.textContent) ? el.textContent : false; }, null, { timeout: 20000, fallback: '' });
check(!!pr2, `at level 1 without roads/light/power/water the pad asks for infrastructure first (${pr2})`);
const blocked = await ev(() => {
  const n = window.__charges.filter((c) => c.ok).length, lv = districtLevel('industrial');
  document.getElementById('actionBtn').click();
  return { n, lv, n2: window.__charges.filter((c) => c.ok).length, lv2: districtLevel('industrial'), btn: document.getElementById('actionBtn').textContent };
});
check(blocked.n2 === blocked.n && blocked.lv2 === blocked.lv && /Нужна инфраструктура|Infrastructure needed/.test(blocked.btn), `pressing the infra-blocked hub pad charges nothing and does not upgrade (${J(blocked)})`);
const need = await ev(() => districtInfraNeedV161(CITY_DISTRICTS.find((d) => d.id === 'industrial')));
check(need === 1, `industrial level 1 is infra-blocked: districtInfraNeedV161 = ${need} (road/light/power/water L1 still missing)`);

// ---- 6. infra pads of district 2: road first, at its own hub, marker in the scene, nothing for the locked business district
const inf = await ev(() => {
  refreshIndustrialPadMarkersV118();
  const hub = CITY_DISTRICTS.find((d) => d.id === 'industrial').pos, vis = INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq());
  const st = industrialStepV118('infra-industrial-road'), d = Math.hypot(st.pos.x - hub.x, st.pos.z - hub.z);
  return { vis: vis.map((s) => s.id), hubDist: d, inGround: Math.hypot(st.pos.x, st.pos.z) < GROUND_HALF, marker: industrialPadMarkersV118.get('infra-industrial-road')?.parent === scene,
    cost: { ...st.cost }, panel: { ...districtRoadsBuildCost('industrial') } };
});
check(J(inf.vis) === '["infra-industrial-road"]', `after the unlock only the industrial road L1 pad is offered (${J(inf.vis)})`);
check(inf.hubDist > 5.5 && inf.hubDist < 8.6 && inf.inGround && inf.marker, `road pad stands ${inf.hubDist.toFixed(1)} m from the industrial hub with a marker in the scene`);
const gd2 = await ev(() => { const t = nextActionableTargetV117(); return t && { type: t.type, id: t.stepId }; });
check(gd2?.type === 'industrial' && gd2.id === 'infra-industrial-road', `guidance leads to the road pad, not null (${J(gd2)})`);
await ev(() => { const p = industrialStepV118('infra-industrial-road').pos; player.position.set(p.x, 0, p.z); window.__charges.length = 0; nearestManualTargetV53(); });
const pr3 = await promptText('Дорога L1|Road L1');
check(/Дорога L1|Road L1/.test(pr3), `#actionPrompt offers the industrial road pad (${pr3})`);
const pressedRoad = await pressUntil('industrial road', "(cityState.districtRoads.industrial?.pendingUntil || 0) > 0 || districtRoadLevelV37('industrial') >= 1");
const road = await ev(() => ({ charges: window.__charges.filter((c) => c.ok), vis: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id) }));
check(pressedRoad && road.charges.length === 1 && road.charges[0].money === inf.cost.money && road.charges[0].wood === inf.cost.wood && inf.cost.money === inf.panel.money, `real press on the road pad charged exactly ${inf.cost.money} money once (${J(road.charges)})`);
check(road.vis.length === 0, `while the road is built no infra pad is offered (${J(road.vis)})`);
check(await waitForState(page, () => districtRoadLevelV37('industrial') >= 1, null, { timeout: 45000 }), 'industrial road L1 completed after its timer');
const afterRoad = await ev(() => INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id));
check(J(afterRoad) === '["infra-industrial-light"]', `road L1 done -> only the industrial lighting pad (${J(afterRoad)})`);

// ---- 7. district 3 (business): tier 3 = stage 6 and reputation 60 both needed; pad appears; its own infra pad is next
const need3 = await ev(() => { const c = CITY_DISTRICTS.find((d) => d.id === 'business'); return { rep: c.unlockRep, tier: c.unlockTier, stage: COMPANY_TIERS[c.unlockTier].stage }; });
await jumpStage(page, need3.stage - 1);
await ev((n) => { cityState.reputation = n.rep + 40; }, need3);
const b1 = await standAt('business');
check(!b1.unlocked && b1.type !== 'district', `business: reputation ${b1.rep} but tier ${b1.tier} < ${need3.tier} -> closed, no pad (${J(b1)})`);
await jumpStage(page, need3.stage);
await ev((n) => { cityState.reputation = n.rep - 1; }, need3);
const b2 = await standAt('business');
check(!b2.unlocked && b2.type !== 'district', `business: tier ${b2.tier} but reputation ${b2.rep} < ${need3.rep} -> closed, no pad (${J(b2)})`);
await ev(() => awardCityReputation(1, 'test'));
const b3 = await standAt('business');
check(b3.unlocked && b3.type === 'district' && b3.id === 'business', `business: reputation ${b3.rep} + tier ${b3.tier} -> the hub pad appears (${J(b3)})`);
const cost3 = await ev(() => { money = 1e6; planks = 500; concrete = 100; metal = 100; window.__charges.length = 0; return { ...districtUpgradeCost(CITY_DISTRICTS.find((d) => d.id === 'business')) }; });
await promptText('Развить|Develop');
const pressed3 = await pressUntil('business hub', "districtLevel('business') >= 1");
const af3 = await ev(() => ({ charges: window.__charges.filter((c) => c.ok), level: districtLevel('business'), vis: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id) }));
check(pressed3 && af3.level === 1 && af3.charges.length === 1 && af3.charges[0].money === cost3.money && af3.charges[0].wood === cost3.wood && af3.charges[0].concrete === cost3.concrete && af3.charges[0].metal === cost3.metal, `real press unlocks business, charged exactly ${J(cost3)} once (${J(af3.charges)})`);
check(af3.vis.includes('infra-business-road') && af3.vis.includes('infra-industrial-light') && !af3.vis.some((id) => id.startsWith('infra-waterfront')), `business road pad is offered next to the pending industrial one, waterfront has none (${J(af3.vis)})`);
const place = await ev(() => {
  const hub = CITY_DISTRICTS.find((d) => d.id === 'business').pos, st = industrialStepV118('infra-business-road');
  const near = INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.id !== st.id).map((s) => Math.hypot(s.pos.x - st.pos.x, s.pos.z - st.pos.z));
  return { d: Math.hypot(st.pos.x - hub.x, st.pos.z - hub.z), marker: industrialPadMarkersV118.get(st.id)?.parent === scene, minOther: Math.min(...near) };
});
check(place.d > 5.5 && place.d < 8.6 && place.marker && place.minOther > 2.5, `business road pad ${place.d.toFixed(1)} m from its hub, marker in scene, ${place.minOther.toFixed(1)} m from every other infra pad`);

// ---- 8. persistence: levels, reputation and the pads survive a reload
const pre = await ev(() => { save(); return { lv: CITY_DISTRICTS.map((d) => districtLevel(d.id)), rep: cityState.reputation, stage: stageIndex, road: districtRoadLevelV37('industrial'), vis: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id).sort() }; });
const errs = await reloadGame(g, 6000);
const post = await ev(() => ({ lv: CITY_DISTRICTS.map((d) => districtLevel(d.id)), rep: cityState.reputation, stage: stageIndex, road: districtRoadLevelV37('industrial'), vis: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).map((s) => s.id).sort(),
  hubs: CITY_DISTRICTS.map((d) => { const h = cityWorldRuntime.hubs.get(d.id); let ok = false; for (let p = h; p; p = p.parent) if (p === scene) ok = true; return ok && (d.id === 'waterfront' ? h.children.length === 0 : h.children.length > 0); }), unlocked: CITY_DISTRICTS.map((d) => districtUnlocked(d)) }));
// stageIndex itself is not saved (it follows the bought buildings; the test jumped it), levels/reputation/roads are
check(J(post.lv) === J(pre.lv) && post.rep === pre.rep && post.road === pre.road, `district levels / reputation / road level survive the reload (${J({ lv: post.lv, rep: post.rep, road: post.road })})`);
check(J(post.vis) === J(pre.vis) && post.hubs.every(Boolean) && J(post.unlocked) === '[true,true,true,false]', `infra pads and hubs are back after the reload (${J(post.vis)}, unlocked ${J(post.unlocked)})`);
const back = await standAt('industrial');
check(back.type === 'district' && back.id === 'industrial', `after the reload the industrial hub still offers its pad (${J(back)})`);
// guidance over several districts: suburb/industrial/business are at level 1 but not serviced -> skipped (null); the 4th
// district (waterfront: reputation 120 + tier 4 = stage 8) once unlocked is the next hub target
const chain = await ev(() => {
  money = 1e6; planks = 500; concrete = 100; metal = 100;
  upgradeCityDistrict('suburb'); // real owning function; suburb level 0 -> 1, its infra is not built
  const blockedOnly = districtGuideTargetV161();
  stageIndex = 8; checkCompanyTierRewards(); cityState.reputation = 119; awardCityReputation(1, 'test'); money = 1e6; planks = 500; concrete = 100; metal = 100;
  const w = districtGuideTargetV161(), cfg = CITY_DISTRICTS.find((d) => d.id === 'waterfront');
  return { levels: CITY_DISTRICTS.map((d) => districtLevel(d.id)), blockedOnly: blockedOnly === null, id: w?.districtId, posOk: !!w && Math.hypot(w.pos.x - cfg.pos.x, w.pos.z - cfg.pos.z) < 1e-6 };
});
check(J(chain.levels) === '[1,1,1,0]' && chain.blockedOnly, `levels ${J(chain.levels)}: districts that are not serviced are skipped by the guidance (null: ${chain.blockedOnly})`);
check(chain.id === 'waterfront' && chain.posOk, `waterfront unlocked (rep 120, stage 8) -> it is the next hub target (${chain.id})`);
check(errs.length === 0 && g.errors.length === 0 && g.badResponses.length === 0, `0 console errors, 0 4xx (reload: ${J(errs.slice(0, 3))}, run: ${J(g.errors.slice(0, 3))}, ${J(g.badResponses.slice(0, 3))})`);
await g.close();

// ---------------------------------------------------------------- launch 2: OLD_SAVE behaves as before
const o = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const oev = (fn, arg) => o.page.evaluate(fn, arg);
const old = await oev(() => {
  const at = (id) => { const c = CITY_DISTRICTS.find((d) => d.id === id); player.position.set(c.pos.x, 0, c.pos.z); const t = nearestManualTargetV53(); return t?.type === 'district' ? t.cfg.id : (t?.type || null); };
  return {
    stage: stageIndex, levels: CITY_DISTRICTS.map((d) => districtLevel(d.id)), unlocked: CITY_DISTRICTS.map((d) => districtUnlocked(d)),
    pads: ['suburb', 'industrial', 'business', 'waterfront'].map(at), infraVisible: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.prereq()).length,
    guide: typeof districtGuideTargetV161 === 'function' ? districtGuideTargetV161() : 'missing',
    hubs: CITY_DISTRICTS.map((d) => { const h = cityWorldRuntime.hubs.get(d.id); let ok = false; for (let p = h; p; p = p.parent) if (p === scene) ok = true; return [ok, h ? h.children.length : -1]; }),
  };
});
check(old.stage === 1 && J(old.levels) === '[0,0,0,0]', `old save: stage 1, all districts level 0 (${J({ stage: old.stage, levels: old.levels })})`);
check(J(old.unlocked) === '[true,false,false,false]' && J(old.pads) === '["suburb",null,null,null]', `old save: only the suburb hub pad exists as before (${J(old.pads)})`);
check(old.infraVisible === 0 && old.guide === null && old.hubs.every((h) => h[0]) && old.hubs[0][1] > 0 && old.hubs.slice(1).every((h) => h[1] === 0), `old save: no infra pad, no district guidance before stage 3, hubs in scene (suburb visible, others empty) (${J({ infra: old.infraVisible, guide: old.guide, hubs: old.hubs })})`);
check(o.errors.length === 0 && o.badResponses.length === 0, `old save: 0 console errors, 0 4xx (${J(o.errors.slice(0, 3))})`);
await o.close();
