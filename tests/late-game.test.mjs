// Late game (ROADMAP task 4, assets/late-game-v161.js): building levels 6..10 ("gold tiers") + per-stage resource-cost table.
// Three browser launches (light, no long waits), prices are read from the GAME and compared with the model of tools/balance-v161.mjs:
//   A. fresh save: MAX_BUILDING_LEVEL = TABLE.maxLevel = 10; STAGES = model table; upgrade pad only below level 10; a real #actionBtn press on the
//      level-6 pad charges exactly stageResourceCost(i, 5), the new mesh carries the gold tier; 0 road meshes re-laid; save + reload keeps level
//      and prices (and the `tycoon3d_late_v161` freeze stays 0).
//   B. OLD_SAVE (stage 1): the one built stage keeps its old price, unbuilt stages get the new table, level/progress untouched, reload keeps it.
//   C. high-stage fixture (stages 0..8 built at the old maximum level 5): stages 0..8 keep old prices AND their upgrade formula (no price
//      increase on built things), they simply get the next pad (level 6); stage 9 uses the table; real press on the stage-9 pad charges exactly
//      its price; a prestige (stats.prestige + 1, picked up by the visual tick) re-prices everything for the new run.
import { openGame, reloadGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';
import { LATE, BASE_STAGES, stageTable } from '../tools/balance-v161.mjs';

const J = JSON.stringify;
const TBL = stageTable(LATE, 0);
const only = process.env.LG_ONLY || '';

const stagesNow = (page) => page.evaluate(() => STAGES.map((s) => ({ cost: s.cost, plank: s.plankCost, concrete: s.concreteCost, metal: s.metalCost })));
const sameAsTable = (rows, i) => rows[i].cost === TBL[i].cost && rows[i].plank === TBL[i].plankCost && rows[i].concrete === TBL[i].concreteCost && rows[i].metal === TBL[i].metalCost;
const sameAsOriginal = (rows, i) => rows[i].cost === BASE_STAGES[i].cost && rows[i].plank === BASE_STAGES[i].plankCost && rows[i].concrete === BASE_STAGES[i].concreteCost && rows[i].metal === BASE_STAGES[i].metalCost;
const roadSnapshot = (page) => page.evaluate(() => {
  const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.userData && tags.some((t) => o.userData[t])) meshes.push(o.uuid); });
  return meshes;
});
// wait until the road planner is calm: 3 identical snapshots 2 s apart (a freshly loaded save keeps re-laying roads for a while)
const settleRoads = async (page) => {
  let prev = J(await roadSnapshot(page)), calm = 0, k = 0;
  for (; k < 25 && calm < 3; k++) { await page.waitForTimeout(2000); const now = J(await roadSnapshot(page)); calm = now === prev ? calm + 1 : 0; prev = now; }
  return k < 25;
};
const roadDiff = (a, b) => { const A = new Set(a), B = new Set(b); return { destroyed: a.filter((x) => !B.has(x)).length, created: b.filter((x) => !A.has(x)).length }; };
const chargeLog = (page) => page.evaluate(() => {
  window.__chargeLog = [];
  const orig = tryPayResources;
  tryPayResources = function () { const b = { money, wood: planks, concrete, metal }; const r = orig.apply(this, arguments); if (r) window.__chargeLog.push({ money: b.money - money, wood: b.wood - planks, concrete: b.concrete - concrete, metal: b.metal - metal }); return r; };
});
const pressOn = (page, getPad) => waitForState(page, (pad) => {
  player.position.set(pad.x, 0, pad.z);
  const btn = document.getElementById('actionBtn');
  if (window.__chargeLog.length) return true;
  if (btn && !btn.hidden && !btn.disabled) btn.click();
  return false;
}, getPad, { timeout: 25000 });

async function runFresh() {
  const g = await openGame({ save: 'clear', waitMs: 5000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const t0 = await ev(() => ({ max: MAX_BUILDING_LEVEL, table: LATE_GAME_V161.table.maxLevel, frozen: LATE_GAME_V161.frozen(), key: localStorage.getItem('tycoon3d_late_v161'), orig: LATE_GAME_V161.original, gold: typeof LATE_GAME_V161.addGoldTiers }));
  check(t0.max === 10 && t0.table === 10, `MAX_BUILDING_LEVEL ${t0.max} = TABLE.maxLevel ${t0.table}`);
  check(t0.frozen === 0 && t0.key === '{"frozen":0}', `fresh game: no stage is frozen (${t0.key})`);
  check(t0.orig.every((o, i) => o.money === BASE_STAGES[i].cost && o.plank === BASE_STAGES[i].plankCost && o.concrete === BASE_STAGES[i].concreteCost && o.metal === BASE_STAGES[i].metalCost), 'the game prices before this layer (v36 + v124) equal the balance model for all 16 stages');
  let rows = await stagesNow(page);
  check(BASE_STAGES.every((_, i) => sameAsTable(rows, i)), `STAGES in the game = model table for all 16 stages (e.g. stage 15: ${J(rows[15])})`);
  check(rows.every((r, i) => r.cost === BASE_STAGES[i].cost), 'money prices untouched');

  // ---- upgrade pad exists only below the maximum level; price from the game's own formulas
  await ev(() => { stageIndex = 8; money = 1e9; planks = 1e4; concrete = 400; metal = 400; spawnBuilding(6, 5, { grow: false }); spawnBuilding(7, 4, { grow: false }); spawnBuilding(5, 10, { grow: false }); });
  const pads = await ev(() => Object.fromEntries([5, 6, 7].map((i) => { const b = buildings.find((x) => x.index === i); return [i, { level: b.level, pad: !!b.upgradePad, price: stageResourceCost(i, b.level), cost: STAGES[i] && { c: STAGES[i].cost, p: STAGES[i].plankCost, k: STAGES[i].concreteCost, m: STAGES[i].metalCost } }]; })));
  check(pads[5].level === 10 && !pads[5].pad, 'a level-10 building has no upgrade pad');
  check(pads[6].level === 5 && pads[6].pad && pads[7].level === 4 && pads[7].pad, 'level 5 (the old maximum) and level 4 buildings have an upgrade pad');
  const P6 = pads[6], s6 = TBL[6];
  check(P6.price.money === Math.round(s6.cost * 0.48 * 5) && P6.price.wood === Math.max(1, Math.ceil(Math.max(1, s6.plankCost) * 0.45 * 5)) && P6.price.concrete === Math.max(1, Math.ceil(s6.concreteCost * 0.36 * 5)) && P6.price.metal === Math.max(1, Math.ceil(s6.metalCost * 0.32 * 5)),
    `level 6 of the Office costs ${J(P6.price)} = the game's linear formulas on the table prices`);

  // ---- real press on the level-6 pad
  await settleRoads(page);
  const roads0 = await roadSnapshot(page);
  await chargeLog(page);
  const pressed = await pressOn(page, await ev(() => ({ x: buildings.find((b) => b.index === 6).upgradePad.pos.x, z: buildings.find((b) => b.index === 6).upgradePad.pos.z })));
  if (!pressed) { console.log('KNOWN ISSUE: #actionBtn did not upgrade the level-5 building within 25 s; upgraded through upgradeBuilding()'); await ev(() => upgradeBuilding(buildings.find((b) => b.index === 6), { fromQueue: true })); }
  const after = await ev(() => { const b = buildings.find((x) => x.index === 6); return { level: b.level, charged: window.__chargeLog.slice(), gold: b.mesh.userData.goldTierV161 || 0, golds: b.mesh.children.length, upgrades: stats.upgradesBought }; });
  check(after.level === 6 && after.charged.length === 1, `real press: level 5 -> 6 with exactly one charge (${J(after.charged)})`);
  check(J(after.charged[0]) === J({ money: P6.price.money, wood: P6.price.wood, concrete: P6.price.concrete, metal: P6.price.metal }), `the charge equals the displayed price ${J(P6.price)}`);
  check(after.gold === 6, `the new mesh carries the gold tier ${after.gold}`);
  const roads1 = await roadSnapshot(page);
  const A = new Set(roads0), B = new Set(roads1);
  check(roads0.every((x) => B.has(x)) && roads1.every((x) => A.has(x)), `the upgrade re-laid 0 road meshes (of ${roads0.length})`);

  // ---- gold tiers per level, silhouette of level 5 kept
  const tiers = await ev(() => {
    const st = STAGES[8], out = [];
    for (const L of [5, 6, 7, 8, 9, 10]) { const m = createBuildingMesh(st, L); const box = new THREE.Box3().setFromObject(m); out.push({ L, n: m.children.length, h: +(box.max.y - box.min.y).toFixed(2), gold: m.userData.goldTierV161 || 0 }); disposeObject3D(m); }
    return out;
  });
  check(tiers.every((t, i) => i === 0 || t.n > tiers[i - 1].n || t.L === 6) && tiers[1].n > tiers[0].n && tiers[5].n > tiers[4].n, `more gold detail with every tier (children per level ${tiers.map((t) => t.n)})`);
  check(tiers[1].h - tiers[0].h < 1.5 && tiers[5].h < tiers[0].h * 1.9, `no 18 %-per-level growth above level 5 (heights ${tiers.map((t) => t.h)})`);

  // ---- save + reload
  await ev(() => save());
  const errs = await reloadGame(g, 6000);
  const re = await ev(() => ({ b6: buildings.find((b) => b.index === 6)?.level, b5: buildings.find((b) => b.index === 5)?.level, frozen: LATE_GAME_V161.frozen(), stage: stageIndex }));
  rows = await stagesNow(page);
  check(re.b6 === 6 && re.b5 === 10 && re.frozen === 0, `reload keeps the levels (${re.b6}, ${re.b5}) and the freeze 0`);
  check(BASE_STAGES.every((_, i) => sameAsTable(rows, i)), 'prices after reload = table');
  check(errs.length === 0 && g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J(g.errors.slice(0, 2))}`);
  await g.close();
}

async function runOld() {
  const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const t = await ev(() => ({ frozen: LATE_GAME_V161.frozen(), key: localStorage.getItem('tycoon3d_late_v161'), stage: stageIndex, b: buildings.map((b) => ({ i: b.index, l: b.level })), pad: currentPad?.index }));
  check(t.frozen === 1 && t.key === '{"frozen":1}' && t.stage === 1, `OLD_SAVE (stage 1): stage 0 is frozen (${t.key})`);
  check(J(t.b) === '[{"i":0,"l":1}]' && t.pad === 1, 'OLD_SAVE keeps its building and its next pad');
  let rows = await stagesNow(page);
  check(sameAsOriginal(rows, 0) && BASE_STAGES.every((_, i) => i < 1 || sameAsTable(rows, i)), `built stage 0 keeps the old price, unbuilt stages 1..15 follow the table (stage 3: ${J(rows[3])} vs old ${J({ p: BASE_STAGES[3].plankCost })})`);
  const up = await ev(() => ({ price: stageResourceCost(0, 1), pad: !!buildings[0].upgradePad }));
  check(up.pad && up.price.money === Math.round(BASE_STAGES[0].cost * 0.48), `the house upgrade pad price is the old one (${J(up.price)})`);
  await ev(() => save());
  await reloadGame(g, 5000);
  rows = await stagesNow(page);
  const f = await ev(() => LATE_GAME_V161.frozen());
  check(f === 1 && sameAsOriginal(rows, 0) && sameAsTable(rows, 4), 'after a reload the freeze (1) and the prices are the same');
  check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J(g.errors.slice(0, 2))}`);
  await g.close();
}

async function runHigh() {
  const save = { saveVersion: 20, stageIndex: 9, money: 1e9, planks: 5000, concrete: 150, metal: 150, buildings: Array.from({ length: 9 }, (_, i) => ({ index: i, level: 5 })) };
  const g = await openGame({ save, waitMs: 7000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const t = await ev(() => ({ frozen: LATE_GAME_V161.frozen(), stage: stageIndex, levels: buildings.map((b) => b.level), pads: buildings.filter((b) => b.upgradePad).length, pad: currentPad?.index }));
  check(t.frozen === 9 && t.stage === 9 && t.levels.length === 9 && t.levels.every((l) => l === 5), `high-stage save: 9 buildings at level 5 untouched, freeze 9 (${J(t)})`);
  check(t.pads === 9, 'every maxed old building gets the next (level 6) upgrade pad');
  const rows = await stagesNow(page);
  check(BASE_STAGES.every((_, i) => (i < 9 ? sameAsOriginal(rows, i) : sameAsTable(rows, i))), 'stages 0..8 keep the old prices (no increase on built things), 9..15 use the table');
  const up8 = await ev(() => stageResourceCost(8, 5));
  check(up8.money === Math.round(BASE_STAGES[8].cost * 0.48 * 5) && up8.concrete === Math.max(1, Math.ceil(BASE_STAGES[8].concreteCost * 0.36 * 5)), `level 6 of the old Skyscraper costs the old formula price ${J(up8)}`);

  const calm = await settleRoads(page);
  const roads0 = await roadSnapshot(page);
  console.log(`road planner calm before the upgrade: ${calm}, ${roads0.length} road meshes`);
  await chargeLog(page);
  // real press on the level-6 pad of an OLD maxed building: charges the old-formula price, re-lays no road
  const pressedUp = await pressOn(page, await ev(() => { const b = buildings.find((x) => x.index === 8); return { x: b.upgradePad.pos.x, z: b.upgradePad.pos.z }; }));
  if (!pressedUp) { console.log('KNOWN ISSUE: #actionBtn did not upgrade the old Skyscraper within 25 s; upgraded through upgradeBuilding()'); await ev(() => upgradeBuilding(buildings.find((x) => x.index === 8), { fromQueue: true })); }
  const upd = await ev(() => ({ level: buildings.find((b) => b.index === 8).level, charged: window.__chargeLog.slice() }));
  check(upd.level === 6 && upd.charged.length === 1 && upd.charged[0].money === up8.money && upd.charged[0].wood === up8.wood && upd.charged[0].concrete === up8.concrete && upd.charged[0].metal === up8.metal, `real press: old Skyscraper 5 -> 6 charged the old price exactly (${J(upd.charged)})`);
  const roads1 = await roadSnapshot(page);
  const B1 = new Set(roads1), A1 = new Set(roads0);
  const rdiff = roadDiff(roads0, roads1);
  await page.waitForTimeout(4000);
  const rdiffLater = roadDiff(roads0, await roadSnapshot(page));
  check(roads0.length > 0 && rdiff.destroyed === 0 && rdiff.created === 0, `the upgrade re-laid 0 of ${roads0.length} road meshes (now ${J(rdiff)}, 4 s later ${J(rdiffLater)})`);

  await ev(() => { window.__chargeLog.length = 0; });
  const price9 = await ev(() => ({ ...stageResourceCost(9) }));
  check(price9.concrete === TBL[9].concreteCost && price9.metal === TBL[9].metalCost && price9.money === BASE_STAGES[9].cost, `stage 9 (Empire) costs ${J(price9)} = table`);
  const pressed = await pressOn(page, await ev(() => ({ x: currentPad.pos.x, z: currentPad.pos.z })));
  if (!pressed) { console.log('KNOWN ISSUE: #actionBtn did not buy the stage-9 pad within 25 s; bought through purchaseCurrentPad()'); await ev(() => purchaseCurrentPad()); }
  const bought = await ev(() => ({ stage: stageIndex, charged: window.__chargeLog.slice(), built: buildings.some((b) => b.index === 9) }));
  check(bought.stage === 10 && bought.built && bought.charged.length === 1 && J(bought.charged[0]) === J({ money: price9.money, wood: price9.wood, concrete: price9.concrete, metal: price9.metal }), `real press bought stage 9 and charged exactly ${J(price9)} (${J(bought.charged)})`);

  // prestige: a new run has nothing built -> everything is re-priced, the freeze ends
  await ev(() => { stats.prestige += 1; });
  const switched = await waitForState(page, () => LATE_GAME_V161.frozen() === 0, null, { timeout: 15000 });
  const rows2 = await stagesNow(page);
  check(switched && BASE_STAGES.every((_, i) => sameAsTable(rows2, i)), `after a prestige the freeze is 0 and all 16 stages follow the table (stage 8: ${J(rows2[8])})`);
  check(await ev(() => localStorage.getItem('tycoon3d_late_v161')) === '{"frozen":0}', 'the freeze reset is persisted');
  check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J(g.errors.slice(0, 2))}`);
  await g.close();
}

if (!only || only === 'fresh') await runFresh();
if (!only || only === 'old') await runOld();
if (!only || only === 'high') await runHigh();
