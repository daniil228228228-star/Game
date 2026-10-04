// Old-format save (the user's fixture: saveVersion 20, stage 1, one house) must load into v161 with
// everything staged-unlock "already built" (CLAUDE.md design rule), survive reloads of its own
// autosave, never log "[road union]" (v116 root cause, fixed in v161 at tycoon-v161.html:12401 and
// :29638), and keep the built market plaza consistent: each stall's open (+Z) side faces the plaza
// centre in the REAL scene graph, and the exchange offers table has no free-money loops.
// One browser launch; the seed is written once and the game's own save is what the reloads read.
import { openGame, reloadGame, check, OLD_SAVE, SAVE_KEY } from './lib/harness.mjs';

const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;

const snapshot = () => page.evaluate(() => ({
  stageIndex, buildings: buildings.length, money: Math.floor(money), planks, concrete, metal,
  industrialZone: industrialZoneBuiltV116, manualRoad: manualRoadModeV116,
  flags: [sawmillBuiltV118, fleetDepotBuiltV118, concretePlantBuiltV118, metalYardBuiltV118],
  levels: [industrialLevelV161('sawmill'), industrialLevelV161('concrete'), industrialLevelV161('metal')],
  levelBadges: industrialBadgesV161.size, speeds: [industrialSpeedV161('sawmill'), industrialSpeedV161('concrete'), industrialSpeedV161('metal')],
  stallsBuilt: marketStallsBuiltV118.size, stallsInScene: marketRuntimeV116.stalls.size,
  bootError: !!document.getElementById('bootError'), sceneChildren: scene.children.length,
}));

const s1 = await snapshot();
check(g.errors.length === 0, `0 console errors loading the old save ${JSON.stringify(g.errors.slice(0, 3))}`);
check(s1.stageIndex === 1 && s1.buildings === 1, `fixture state carried over (stage ${s1.stageIndex}, ${s1.buildings} building)`);
check(s1.money >= 500 && s1.planks >= 10, `money/planks not lower than the fixture (${s1.money}/${s1.planks})`);
check(s1.industrialZone && s1.flags.every(Boolean), 'old save: all 4 industrial flags default to built');
check(s1.levels.every((l) => l === 1) && s1.levelBadges === 0 && s1.speeds.every((v) => v === 1), `old save (no industrialLevelsV161 field): production levels default to 1, no badge, speed x1 (${s1.levels})`);
check(s1.manualRoad === false, 'old save: manual road mode off (roads stay automatic)');
check(s1.stallsBuilt === 7 && s1.stallsInScene === 7, `old save: 7 market stalls built and present in the scene (${s1.stallsInScene})`);
check(!s1.bootError && s1.sceneChildren > 100, `no boot error, scene populated (${s1.sceneChildren})`);

// --- market plaza: real scene orientation + exchange table sanity ---
const market = await page.evaluate(() => {
  const center = MARKET_PLAZA_CENTER_V116;
  const stalls = [...marketRuntimeV116.stalls.entries()].map(([id, entry]) => {
    const group = entry.group || entry;
    group.updateMatrixWorld(true);
    const o = group.getWorldPosition(new THREE.Vector3());
    const front = group.localToWorld(new THREE.Vector3(0, 0, 1)).sub(o).setY(0).normalize(); // counter side
    const toCenter = new THREE.Vector3(center.x - o.x, 0, center.z - o.z);
    const radius = toCenter.length();
    return { id, inScene: group.parent === scene, dot: front.dot(toCenter.normalize()), radius };
  });
  const OK = ['planks', 'concrete', 'metal'];
  const offers = MARKET_EXCHANGE_OFFERS_V116.map((o) => ({ ...o, out: marketExchangeOut(o) }));
  const problems = [];
  for (const o of offers) {
    if (!OK.includes(o.from) || !(OK.includes(o.to) || o.to === 'money') || o.from === o.to) problems.push(`bad pair ${o.from}->${o.to}`);
    if (!(o.amountIn > 0) || !Number.isInteger(o.out) || o.out <= 0) problems.push(`bad amounts ${o.from}->${o.to} in ${o.amountIn} out ${o.out}`);
    if (typeof o.minStage !== 'number' || Number.isNaN(o.minStage)) problems.push(`bad minStage ${o.from}->${o.to}`);
    if (OK.includes(o.to)) { // A->B->A must lose value (the trader's fee), else it is a free-resource loop
      const back = marketExchangeOut({ from: o.to, to: o.from, amountIn: o.out });
      if (back >= o.amountIn) problems.push(`loop ${o.from}->${o.to}->${o.from}: ${o.amountIn} -> ${back}`);
    }
  }
  const price = MARKET_SELL_PRICE_V116;
  return { stalls, problems, count: offers.length, priceOrdered: price.planks < price.concrete && price.concrete < price.metal };
});
check(market.stalls.length === 7 && market.stalls.every((s) => s.inScene), '7 stall groups are attached to the scene');
for (const s of market.stalls) {
  check(s.dot > 0.999 && Math.abs(s.radius - 4.6) < 0.05, `stall '${s.id}' counter faces the plaza centre (dot ${s.dot.toFixed(4)}, radius ${s.radius.toFixed(2)})`);
}
check(market.count >= 6 && market.problems.length === 0, `exchange offers table sane (${market.count} offers) ${JSON.stringify(market.problems)}`);
check(market.priceOrdered, 'sell prices ordered planks < concrete < metal');

// --- the game's own autosave round-trips ---
const saved = await page.evaluate((key) => { save(); const d = JSON.parse(localStorage.getItem(key) || 'null'); return d && { stageIndex: d.stageIndex, buildings: d.buildings?.length, sawmill: d.sawmillBuiltV118 }; }, SAVE_KEY);
check(saved && saved.stageIndex === 1 && saved.buildings === 1 && saved.sawmill === true, `save() writes the loaded state back ${JSON.stringify(saved)}`);

// --- 3 reloads: state survives, no console errors, '[road union]' stays at 0 ---
let roadUnion = 0, errorsAfterReload = 0;
for (let i = 1; i <= 3; i++) {
  const errs = await reloadGame(g, 4500);
  roadUnion += errs.filter((e) => e.includes('[road union]')).length;
  errorsAfterReload += errs.length;
  const s = await snapshot();
  check(s.stageIndex === 1 && s.buildings === 1 && s.stallsInScene === 7 && s.flags.every(Boolean) && s.money >= s1.money - 5,
    `reload ${i}: state survived (stage ${s.stageIndex}, ${s.buildings} building, ${s.stallsInScene} stalls, money ${s.money})`);
}
check(roadUnion === 0, `'[road union]' console errors over 1+3 loads: ${roadUnion} (and ${g.errors.filter((e) => e.includes('[road union]')).length} total)`);
check(errorsAfterReload === 0 && g.badResponses.length === 0, `0 console errors / 4xx across reloads ${JSON.stringify([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
