// Ground pads exist in the world only when they are really available (iPhone test 2026-10-04: "много кружков, которые вообще не задействованы пока
// тк нет зданий"), CHANGELOG_V161.md "2026-10-04 (9)", VISION.md "кружок только когда открыт". TWO browser launches: A = fresh save, B = OLD_SAVE.
//
// Before the fix a fresh world showed 3 lilac field-upgrade pads (Переноска / Мотор лесопилки / Распил, paid in planks that do not exist before the
// sawmill) and the orange log drop-off pad with no sawmill, far from the player. Now fieldPadAvailableV161() / syncStagedPadVisibilityV161()
// (tycoon-v161.html next to createFieldUpgradePads) show them from the moment the sawmill is built (field pads only while stage < 2, as before).
//
// For every pad-like object in the scene (registries: current stage pad, building upgrade pads, field pads, log drop-off, industrial/infra/chain markers,
// road pads, special-project and market-stall vacant markers, district hubs, starter-job markers) the page computes `available` from the OWNING
// conditions (built()/prereq(), stage unlocks, flags) independently of the pad's visible flag, and the test compares it with the real visibility (whole
// parent chain) of the real group. A flat-disc scan of the scene catches pads that are in no registry. Hidden pads must also not be interaction targets.
import { openGame, check, OLD_SAVE, jumpStage } from './lib/harness.mjs';
import fs from 'node:fs';

const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const J = JSON.stringify;

// ---- in the page: the pad table ------------------------------------------------------------------------------------------------------------------
const TABLE = () => {
  const vis = (o) => { if (!o) return false; for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  const inScene = (o) => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };
  const rows = [];
  const add = (id, group, available, kind = 'pad') => rows.push({ id, kind, group, inScene: !!group && inScene(group), visible: !!group && inScene(group) && vis(group), available: !!available, pos: group ? [+group.position.x.toFixed(1), +group.position.z.toFixed(1)] : null });
  add('stage-pad', currentPad && currentPad.group, !!currentPad && stageIndex < STAGES.length);
  for (const b of buildings) if (b.upgradePad) add('upgrade#' + b.index, b.upgradePad.group, !b.underConstruction && b.level < MAX_BUILDING_LEVEL);
  for (const p of fieldUpgradePads) add('field:' + p.cfg.key, p.group, stageIndex < 2 && sawmillBuiltV118 && ['carry', 'sawmill', 'yield'].includes(p.cfg.key));
  add('log-dropoff', sawmillDropoff && sawmillDropoff.group, sawmillBuiltV118);
  for (const step of INDUSTRIAL_BUILD_STEPS_V118) add('industrial:' + step.id, industrialPadMarkersV118.get(step.id), !step.built() && step.prereq());
  for (const [i, grp] of roadPadMarkersV116) add('road:' + i, grp, buildings.some((b) => b.index === i) && !manualRoadStagesV116.has(i));
  for (const pr of SPECIAL_PROJECTS) add('project:' + pr.id, specialProjectRuntime.available.get(pr.id), stageIndex >= pr.unlock && !specialProjectState.completed.includes(pr.id) && specialProjectState.active?.id !== pr.id);
  for (const cfg of MARKET_STALLS_V116) add('stall-site:' + cfg.id, marketRuntimeV116.vacant.get(cfg.id), !marketStallsBuiltV118.has(cfg.id) && stageIndex >= cfg.unlock);
  for (const cfg of CITY_DISTRICTS) { const h = cityWorldRuntime.hubs.get(cfg.id); rows.push({ id: 'hub:' + cfg.id, kind: 'hub', group: h, inScene: !!h && inScene(h), visible: !!h && inScene(h) && vis(h) && h.children.length > 0, available: districtUnlocked(cfg) && districtLevel(cfg.id) < 3, pos: [cfg.pos.x, cfg.pos.z] }); }
  for (const key of ['concrete', 'metal']) add('mine:' + key, scene.getObjectByName('manualMineV119_' + key), (key === 'concrete' ? concretePlantBuiltV118 && stageIndex >= CONCRETE_UNLOCK_STAGE : metalYardBuiltV118 && stageIndex >= METAL_UNLOCK_STAGE));
  for (const nm of ['starterSupplyV144', 'starterForemanV144']) { const g = scene.getObjectByName(nm); add('starter:' + nm.slice(7, -4), g, vis(g)); rows[rows.length - 1].kind = 'starter'; }
  // flat-disc scan: a visible pad that is in no registry
  const owned = new Set(rows.map((r) => r.group && r.group.uuid).filter(Boolean));
  const stray = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.geometry.type !== 'CylinderGeometry' || !vis(o)) return;
    o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox, s = new THREE.Vector3(); o.getWorldScale(s);
    const w = (bb.max.x - bb.min.x) * s.x, d = (bb.max.z - bb.min.z) * s.z, h = (bb.max.y - bb.min.y) * s.y, wp = new THREE.Vector3(); o.getWorldPosition(wp);
    if (h > 0.2 || h < 0.01 || wp.y > 0.5 || Math.max(w, d) < 1.0 || Math.max(w, d) > 7 || Math.abs(w - d) > 0.3 * Math.max(w, d)) return;
    let top = o; while (top.parent && top.parent !== scene) top = top.parent;
    if (top.userData && (top.userData.v45Site || top.userData.v149Site)) return; // construction site (not a pad)
    if (top === concretePlant || top === metalPlant || (concretePlant && top === concretePlant.group) || (metalPlant && top === metalPlant.group)) return; // the plant's own loading disc is part of the building
    if (!owned.has(top.uuid)) { owned.add(top.uuid); stray.push({ x: +wp.x.toFixed(1), z: +wp.z.toFixed(1), w: +w.toFixed(1), col: o.material && o.material.color ? o.material.color.getHexString() : '', top: top.name || Object.keys(top.userData).join(',') }); }
  });
  return { stage: stageIndex, money: Math.floor(money), flags: [fleetDepotBuiltV118, sawmillBuiltV118, concretePlantBuiltV118, metalYardBuiltV118], stray, rows: rows.filter((r) => r.group || r.available).map(({ group, ...r }) => r) };
};

function report(tag, t, { strict = true } = {}) {
  const real = t.rows.filter((r) => r.kind !== 'starter');
  console.log(`  ${tag}: stage ${t.stage}, money ${t.money}, flags depot/sawmill/concrete/metal ${J(t.flags)}`);
  console.log('    id'.padEnd(34) + 'visible'.padEnd(9) + 'available');
  for (const r of t.rows) console.log(('    ' + r.id).padEnd(34) + String(r.visible).padEnd(9) + String(r.available) + (r.visible !== r.available ? '   <-- MISMATCH' : '') + (r.kind === 'starter' ? '   (owner: v144 starter job)' : ''));
  const vis = real.filter((r) => r.visible).length, av = real.filter((r) => r.available).length;
  check(vis === av && real.every((r) => r.visible === r.available), `${tag}: visible pads ${vis} == available pads ${av}${real.filter((r) => r.visible !== r.available).length ? ' MISMATCH ' + J(real.filter((r) => r.visible !== r.available).map((r) => r.id)) : ''}`);
  if (strict) check(t.stray.length === 0, `${tag}: no visible pad-like disc outside the registries ${J(t.stray)}`);
}

// the market-stall vacant markers follow stageIndex through refreshMarketStallsV118() a moment later: wait on state, then report whatever is left
const settle = (page) => page.waitForFunction(() => MARKET_STALLS_V116.every((c) => (!marketStallsBuiltV118.has(c.id) && stageIndex >= c.unlock) === marketRuntimeV116.vacant.has(c.id)), null, { timeout: 8000, polling: 'raf' }).catch(() => {});

async function run(label, save, body) {
  const g = await openGame({ save, waitMs: 6000 });
  console.log(`---- ${label}`);
  try { await body(g); } finally {
    check(g.errors.length === 0, `${label}: 0 console errors ${J(g.errors.slice(0, 3))}`);
    check(g.badResponses.length === 0, `${label}: 0 4xx ${J(g.badResponses.slice(0, 3))}`);
    await g.close();
  }
}

// =================================================================================================================== A. fresh save
await run('A fresh save', 'clear', async (g) => {
  const { page } = g, ev = (fn, arg) => page.evaluate(fn, arg);
  const t0 = await ev(TABLE);
  report('fresh boot', t0);
  const byId = Object.fromEntries(t0.rows.map((r) => [r.id, r]));
  check(!byId['field:carry'].visible && !byId['field:sawmill'].visible && !byId['field:yield'].visible && !byId['log-dropoff'].visible, 'fresh: the 3 lilac field pads and the orange log drop-off pad are not in the world');
  check(byId['stage-pad'].visible && byId['industrial:depot'].visible, 'fresh: the current house pad and the depot pad (first industrial step) are there');

  // hidden pads are not interaction targets: stand on each, real nearest-target + tree-interaction code
  const tg = await ev(() => {
    carriedLogs = 1; money = 1e6; planks = 500;
    const out = {};
    for (const p of fieldUpgradePads) { player.position.set(p.cfg.pos.x, 0, p.cfg.pos.z); const t = nearestManualTargetV53(); out[p.cfg.key] = t ? t.type : null; }
    player.position.set(SAWMILL_DROPOFF_POS.x, 0, SAWMILL_DROPOFF_POS.z); updateTreeInteraction(); out.dropoff = nearSawmillDropoff;
    const pr = document.getElementById('actionPrompt'); out.dropoffPrompt = pr && pr.classList.contains('show') ? pr.textContent.trim().slice(0, 40) : '';
    carriedLogs = 0; player.position.set(0, 0, 8);
    const ng = currentGuidanceTarget(); out.guidance = ng ? ng.label + '/' + (ng.type || '') : null; const nx = nextActionableTargetV117(); out.chain = nx ? nx.type : null;
    return out;
  });
  console.log(`  hidden pads as targets: ${J(tg)}`);
  check(Object.values({ a: tg.carry, b: tg.sawmill, c: tg.yield }).every((v) => v !== 'field'), `fresh: standing on a hidden field pad offers nothing (${J({ carry: tg.carry, sawmill: tg.sawmill, yield: tg.yield })})`);
  check(tg.dropoff === false && !/лесопилк|sawmill|logs|брёвн/i.test(tg.dropoffPrompt), `fresh: standing on the hidden drop-off with logs in hand offers no delivery (near=${tg.dropoff}, prompt "${tg.dropoffPrompt}")`);
  check(tg.guidance !== null && tg.chain !== null, `fresh: guidance never returns null while something is available (compass ${tg.guidance}, chain ${tg.chain})`);

  if (SHOTS) { // fresh world, player at the (empty) industrial zone: nothing but the depot pad
    await ev(() => { player.position.set(-44, 0, -2); money = 220; });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${SHOTS}/fresh-world-no-empty-pads.png` });
  }

  // ---- progression: every next pad appears exactly when its condition is met
  await ev(() => { money = 1e7; planks = 500; concrete = 500; metal = 500; });
  const st1 = await ev(() => { const id = purchaseCurrentPad(); return { stage: stageIndex, depotBuilt: fleetDepotBuiltV118 }; });
  await settle(page);
  report('after the first house was bought (stage ' + st1.stage + ')', await ev(TABLE));
  const depot = await ev(() => { const ok = buildIndustrialStepV118(industrialStepV118('depot')); return ok; });
  const t2 = await ev(TABLE);
  report('after the depot', t2);
  const b2 = Object.fromEntries(t2.rows.map((r) => [r.id, r]));
  check(depot && !(b2['industrial:depot'] || {}).visible && b2['industrial:sawmill'].visible && !b2['field:carry'].visible && !b2['log-dropoff'].visible, 'depot built: its pad is gone, the sawmill pad appears, field pads and drop-off still hidden (no sawmill yet)');
  const saw = await ev(() => buildIndustrialStepV118(industrialStepV118('sawmill')));
  await settle(page);
  const t3 = await ev(TABLE);
  report('after the sawmill', t3);
  const b3 = Object.fromEntries(t3.rows.map((r) => [r.id, r]));
  check(saw && b3['field:carry'].visible && b3['field:sawmill'].visible && b3['field:yield'].visible && b3['log-dropoff'].visible && b3['industrial:concrete'].visible && b3['industrial:metal'].visible,
    'sawmill built: field pads (carry/sawmill/yield), drop-off, concrete and metal pads appear at once (no wait for a timer)');
  const gd = await ev(() => { const t = nextActionableTargetV117(); return t ? t.type + (t.stepId ? ':' + t.stepId : '') : null; });
  check(gd !== null, `guidance chain still returns a target after the sawmill (${gd})`);
  // now they are real targets
  const tg2 = await ev(() => { const p = fieldUpgradePads.find((x) => x.cfg.key === 'carry'); player.position.set(p.cfg.pos.x, 0, p.cfg.pos.z); const t = nearestManualTargetV53(); return t ? t.type : null; });
  check(tg2 === 'field', `sawmill built: standing on the carry pad offers it (${tg2})`);
  // stage >= 2: the first-run field pads leave again (unchanged rule)
  await jumpStage(page, 2);
  await ev(() => { refreshIndustrialPadMarkersV118(); });
  await settle(page);
  const t4 = await ev(TABLE);
  report('stage 2', t4);
  check(!(t4.rows.find((r) => r.id === 'field:carry') || {}).visible, 'stage 2: field pads are gone again (first-run range is stage < 2, unchanged)');
  if (SHOTS) {
    await ev(() => { player.position.set(-44, 0, -2); });
    await page.waitForTimeout(2500);
  }
});

// =================================================================================================================== B. OLD_SAVE
await run('B OLD_SAVE (stage 1, everything built)', OLD_SAVE, async (g) => {
  const { page } = g, ev = (fn, arg) => page.evaluate(fn, arg);
  const t0 = await ev(TABLE);
  report('old save boot', t0);
  const byId = Object.fromEntries(t0.rows.map((r) => [r.id, r]));
  check(byId['field:carry'].visible && byId['field:sawmill'].visible && byId['field:yield'].visible && byId['log-dropoff'].visible && byId['stage-pad'].visible && byId['upgrade#0'].visible,
    'old save: every pad that was visible before is still visible (3 field pads, drop-off, stage pad, house upgrade pad)');
  // the old save keeps its pads through the periodic sync as well
  await page.waitForTimeout(1500);
  const t1 = await ev(TABLE);
  check(t1.rows.filter((r) => r.visible).map((r) => r.id).join() === t0.rows.filter((r) => r.visible).map((r) => r.id).join(), 'old save: the set of visible pads is unchanged 1.5 s later (700 ms industrial sync ran)');
  for (const stage of [3, 6, 9]) {
    await jumpStage(page, stage);
    await ev(() => { refreshIndustrialPadMarkersV118(); refreshMarketStallsV118(); refreshSpecialProjectWorld(); });
    await settle(page);
    const t = await ev(TABLE);
    report(`old save, stage ${stage}`, t);
    const ids = t.rows.filter((r) => r.visible && r.kind !== 'starter').map((r) => r.id);
    const exp = await ev(() => ({ chain: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => !s.built() && s.prereq()).map((s) => s.id), stalls: MARKET_STALLS_V116.filter((c) => !marketStallsBuiltV118.has(c.id) && stageIndex >= c.unlock).map((c) => c.id) }));
    console.log(`    unlocked now: industrial ${J(exp.chain)}, stall sites ${J(exp.stalls)}`);
    check(J(ids.filter((i) => i.startsWith('industrial:'))) === J(exp.chain.map((i) => 'industrial:' + i)), `old save, stage ${stage}: visible industrial/infra/chain pads == the steps whose built()/prereq() say so (${exp.chain.length})`);
    check(!(t.rows.find((r) => r.id === 'field:carry') || {}).visible, `old save, stage ${stage}: field pads hidden (stage >= 2)`);
    const guide = await ev(() => { const x = nextActionableTargetV117(), c = currentGuidanceTarget(); return { chain: x ? x.type : null, compass: c ? c.label : null }; });
    check(guide.compass !== null, `old save, stage ${stage}: compass target exists (${J(guide)})`);
  }
});
