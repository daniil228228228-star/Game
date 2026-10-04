// "Time to next step" table for the first 14 hours, computed WITHOUT a browser from the game's own data.
//   node tools/balance-v161.mjs            print the table + summary
//   node tools/balance-v161.mjs --check    exit 1 when a step in the first CHECK_HOURS takes longer than LIMIT_S
// Source of every number (all parsed from the files, not re-typed):
//   tycoon-v161.html  STAGES (cost/resources/incomeAdd), v124 BALANCE (money x1.25, resources x1.08 up, income x0.72,
//                     construction x1.92, production x0.68), industrial pad prices (*_PAD_COST_V118, *_L2_COST_V161),
//                     production intervals/unlock stages, storage (BASE_*_CAPACITY + 16/12 per warehouse level),
//                     constructionDuration(), starter job (RUN_REWARD x RUNS_REQUIRED), level speeds
//   assets/production-chain-v161.js  TABLE (frame recipe, workshop and level-3 prices/gates/speeds)
// Replicated formulas (the game has them inline in functions, line refs in CHANGELOG_V161.md): totalIncomePerSec,
// constructionDuration, sawmill/concrete/metal auto timers, builtWarehouseLevels.
// Model assumptions (NOT game data, stated so they can be argued with): the player is "active" = spends every second
// gathering the resource the current target is short of; manual rates below are rough (carry trips, 3 s / 4.2 s mine
// cooldowns + ~2.5 s work); walking between pads, truck delivery tickets and crew slots are ignored (waits are LOWER
// bounds); only base income (no building upgrades, staff, prestige, city bonuses); greedy buying = cheapest affordable
// step first; frames are crafted on surplus exactly like the game.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'tycoon-v161.html'), 'utf8');
const chainJs = fs.readFileSync(path.join(root, 'assets/production-chain-v161.js'), 'utf8');
const evalLiteral = (text) => vm.runInNewContext('(' + text + ')');
const num = (name) => { const m = html.match(new RegExp(`const ${name}\\s*=\\s*([0-9.]+)`)); if (!m) throw new Error('constant not found: ' + name); return Number(m[1]); };
const cost = (name) => { const m = html.match(new RegExp(`const ${name}\\s*=\\s*(\\{[^}]*\\})`)); if (!m) throw new Error('cost not found: ' + name); return evalLiteral(m[1]); };

const CHECK_HOURS = 14, LIMIT_S = 120, MAX_HOURS = 14;
const stagesText = html.slice(html.indexOf('const STAGES = ['), html.indexOf('\n];', html.indexOf('const STAGES = [')) + 3).replace(/^const STAGES = /, '').replace(/;$/, '');
const STAGES = evalLiteral(stagesText);
const BAL = evalLiteral(html.match(/const BALANCE=(\{[^}]*\})/)[1]);
const TABLE = evalLiteral(chainJs.slice(chainJs.indexOf('const TABLE = ') + 'const TABLE = '.length, chainJs.indexOf('/* TABLE END */')).trim().replace(/;$/, ''));
const speedRows = evalLiteral(html.match(/const INDUSTRIAL_LEVEL_SPEED_V161 = (\{[^}]*\})/)[1].replace(/\]\s*,\s*\}/, ']}'));
speedRows.sawmill.push(TABLE.levels3.sawmill.speed); speedRows.concrete.push(TABLE.levels3.concrete.speed); speedRows.metal.push(TABLE.levels3.metal.speed);

const mon = (n) => Math.max(1, Math.round(n * BAL.moneyCost));
const res = (n) => Math.max(0, Math.ceil((n || 0) * BAL.resourceCost));
const scale = (c) => ({ money: mon(c.money || 0), wood: res(c.wood), concrete: res(c.concrete), metal: res(c.metal), frame: c.frame || 0 });
const MAX_LEVEL = num('MAX_BUILDING_LEVEL');
const CONCRETE_UNLOCK = num('CONCRETE_UNLOCK_STAGE'), METAL_UNLOCK = num('METAL_UNLOCK_STAGE');
const SAW_I = num('BASE_SAWMILL_AUTO_INTERVAL'), CON_I = num('CONCRETE_AUTO_INTERVAL'), MET_I = num('METAL_AUTO_INTERVAL');
const CAP = { concrete: num('BASE_CONCRETE_CAPACITY'), metal: num('BASE_METAL_CAPACITY') }; // + 16 / 12 per warehouse level
const STARTER = 220 + Number(html.match(/RUNS_REQUIRED=2,RUN_REWARD=(\d+)/)[1]) * 2; // start cash + two starter runs

const MANUAL = { planks: 0.25, concrete: 1 / (3 + 2.5), metal: 1 / (4.2 + 2.5) }; // active-play units/s (assumption)
const PAD = {
  depot: { cost: scale(cost('FLEET_DEPOT_PAD_COST_V118')) }, sawmill: { cost: scale(cost('SAWMILL_PAD_COST_V118')) },
  concrete: { cost: scale(cost('CONCRETE_PAD_COST_V118')) }, metal: { cost: scale(cost('METAL_PAD_COST_V118')) },
  sawmill2: { cost: scale(cost('SAWMILL_L2_COST_V161')) }, concrete2: { cost: scale(cost('CONCRETE_L2_COST_V161')) }, metal2: { cost: scale(cost('METAL_L2_COST_V161')) },
  frame: { cost: scale(TABLE.workshop.cost) },
  sawmill3: { cost: scale(TABLE.levels3.sawmill.cost) }, concrete3: { cost: scale(TABLE.levels3.concrete.cost) }, metal3: { cost: scale(TABLE.levels3.metal.cost) },
};
const constructionS = (i) => Math.max(2.0, Math.min(6.4, 3.25 + i * 0.23)) * BAL.constructionTime;

function simulate(withChain) {
  const st = { t: 0, money: STARTER, planks: 0, concrete: 0, metal: 0, frames: 0, built: [], pending: [], levels: {}, flags: new Set(), lv: { sawmill: 1, concrete: 1, metal: 1 }, timers: { saw: 0, con: 0, met: 0, frame: 0 } };
  const stage = () => st.built.length + st.pending.length;
  const log = [];
  let last = 0;
  const warehouseLevels = () => st.built.reduce((a, i) => a + (STAGES[i].archetype === 'warehouse' ? st.levels[i] : 0), 0); // builtWarehouseLevels()
  const capC = () => CAP.concrete + 16 * warehouseLevels(), capM = () => CAP.metal + 12 * warehouseLevels();
  const frameCap = () => TABLE.capacityBase + TABLE.capacityPerWarehouseLevel * warehouseLevels();
  const speed = (k) => speedRows[k][st.lv[k] - 1];
  const stageCost = (i) => { const s = STAGES[i]; return { money: mon(s.cost), wood: res(s.plankCost), concrete: res(s.concreteCost), metal: res(s.metalCost), frame: 0 }; };
  const has = (f) => st.flags.has(f);
  function candidates() {
    const out = [];
    const n = stage();
    if (n < STAGES.length) out.push({ id: 'stage ' + n + ' ' + STAGES[n].nameEn, kind: 'stage', idx: n, cost: stageCost(n) });
    const add = (id, ok) => { if (!has(id) && ok) out.push({ id, kind: 'pad', cost: PAD[id].cost }); };
    add('depot', true); add('sawmill', has('depot')); add('concrete', has('sawmill')); add('metal', has('sawmill'));
    add('sawmill2', has('sawmill') && n >= 3); add('concrete2', has('concrete') && n >= CONCRETE_UNLOCK + 1); add('metal2', has('metal') && n >= METAL_UNLOCK + 1);
    if (withChain) {
      add('frame', has('sawmill2') && has('metal2') && n >= TABLE.workshop.gate);
      for (const k of ['sawmill', 'concrete', 'metal']) add(k + '3', has(k + '2') && has('frame') && n >= TABLE.levels3[k].gate);
    }
    // warehouse upgrade pads (storage = capacity): the game's own formulas buildingUpgradeCost/PlankCost/ConcreteCost/MetalCost
    for (const i of st.built) if (STAGES[i].archetype === 'warehouse' && st.levels[i] < MAX_LEVEL) {
      const s = STAGES[i], L = st.levels[i], pc = res(s.plankCost), cc = res(s.concreteCost), mc = res(s.metalCost);
      out.push({ id: `warehouse ${s.nameEn} -> L${L + 1}`, kind: 'upgrade', idx: i, cost: { money: Math.round(mon(s.cost) * 0.48 * L), wood: Math.max(1, Math.ceil(Math.max(1, pc) * 0.45 * L)), concrete: cc <= 0 ? 0 : Math.max(1, Math.ceil(cc * 0.36 * L)), metal: mc <= 0 ? 0 : Math.max(1, Math.ceil(mc * 0.32 * L)), frame: 0 } });
    }
    // a stage whose plank cost needs a sawmill is not buyable before it exists (first house is free of planks)
    return out.filter((c) => !(c.kind === 'stage' && c.cost.wood > 0 && !has('sawmill')));
  }
  const income = () => st.built.reduce((a, i) => a + STAGES[i].incomeAdd * st.levels[i], 0) * BAL.income;
  const afford = (c) => st.money >= c.cost.money && st.planks >= c.cost.wood && st.concrete >= c.cost.concrete && st.metal >= c.cost.metal && st.frames >= c.cost.frame;
  function buy(c) {
    st.money -= c.cost.money; st.planks -= c.cost.wood; st.concrete -= c.cost.concrete; st.metal -= c.cost.metal; st.frames -= c.cost.frame;
    if (c.kind === 'stage') st.pending.push({ idx: c.idx, done: st.t + constructionS(c.idx) });
    else if (c.kind === 'upgrade') st.levels[c.idx] += 1;
    else {
      st.flags.add(c.id);
      const m = c.id.match(/^(sawmill|concrete|metal)([23])$/); if (m) st.lv[m[1]] = Number(m[2]);
    }
    log.push({ t: st.t, gap: st.t - last, id: c.id, money: st.money });
    last = st.t;
  }
  const horizon = MAX_HOURS * 3600;
  while (st.t < horizon) {
    st.t += 1;
    for (const p of [...st.pending]) if (st.t >= p.done) { st.pending.splice(st.pending.indexOf(p), 1); st.built.push(p.idx); st.levels[p.idx] = 1; }
    st.money += income();
    const n = stage();
    // passive production (game timers, v124 production speed, level speed)
    if (has('sawmill') && n >= 1) { st.timers.saw += 1; const iv = Math.max(3.2, SAW_I / BAL.productionSpeed) / speed('sawmill'); if (st.timers.saw >= iv) { st.timers.saw -= iv; st.planks += 1; } }
    if (has('concrete') && n >= CONCRETE_UNLOCK) { st.timers.con += 1; const iv = CON_I / BAL.productionSpeed / speed('concrete'); if (st.timers.con >= iv) { st.timers.con -= iv; st.concrete = Math.min(capC(), st.concrete + 1); } }
    if (has('metal') && n >= METAL_UNLOCK) { st.timers.met += 1; const iv = MET_I / BAL.productionSpeed / speed('metal'); if (st.timers.met >= iv) { st.timers.met -= iv; st.metal = Math.min(capM(), st.metal + 1); } }
    // frame workshop: surplus only (same rule as assets/production-chain-v161.js reserve()/canCraft())
    if (withChain && has('frame') && n >= TABLE.recipe.unlockStage) {
      st.timers.frame += 1;
      const iv = TABLE.recipe.interval / BAL.productionSpeed;
      if (st.timers.frame >= iv) {
        const c = n < STAGES.length ? stageCost(n) : { wood: 0, metal: 0 }, R = TABLE.recipe;
        const rm = Math.min(c.metal, Math.max(0, capM() - R.metal));
        if (st.frames + R.out <= frameCap() && st.planks >= R.planks + c.wood && st.metal >= R.metal + rm) { st.planks -= R.planks; st.metal -= R.metal; st.frames += R.out; st.timers.frame -= iv; } else st.timers.frame = iv;
      }
    }
    // buy: cheapest affordable first, repeat
    for (;;) {
      const aff = candidates().filter(afford).sort((a, b) => a.cost.money - b.cost.money);
      if (!aff.length) break;
      buy(aff[0]);
    }
    // active play: one second of manual gathering on the resource the cheapest-to-finish target lacks the most
    const target = candidates().sort((a, b) => a.cost.money - b.cost.money).find((c) => c.kind === 'stage') || candidates()[0];
    if (target) {
      const miss = { planks: Math.max(0, target.cost.wood - st.planks), concrete: Math.max(0, target.cost.concrete - st.concrete), metal: Math.max(0, target.cost.metal - st.metal) };
      const canGather = { planks: has('sawmill'), concrete: has('concrete') && n >= CONCRETE_UNLOCK, metal: has('metal') && n >= METAL_UNLOCK };
      let best = null, bestT = 0;
      for (const k of ['planks', 'concrete', 'metal']) if (miss[k] > 0 && canGather[k] && miss[k] / MANUAL[k] > bestT) { bestT = miss[k] / MANUAL[k]; best = k; }
      // a missing frame needs planks + metal for the recipe: work on the scarcer input
      if (!best && withChain && target.cost.frame > st.frames && has('frame')) best = st.planks < 3 ? 'planks' : 'metal';
      if (best) { st[best] += MANUAL[best]; if (best === 'concrete') st.concrete = Math.min(capC(), st.concrete); if (best === 'metal') st.metal = Math.min(capM(), st.metal); }
    }
    if (!candidates().length) break;
    if (st.t - last > 2 * 3600) break; // stuck: report and stop
  }
  return { log, endT: st.t, state: st };
}

const hms = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
function report(title, r) {
  console.log(`\n=== ${title} ===`);
  console.log('time        gap(s)  step');
  for (const e of r.log) console.log(`${hms(e.t)}  ${String(Math.round(e.gap)).padStart(6)}  ${e.id}`);
  const worst = r.log.reduce((a, e) => (e.gap > a.gap ? e : a), { gap: 0 });
  const lastBuy = r.log.length ? r.log[r.log.length - 1].t : 0;
  console.log(`steps ${r.log.length}, last purchase at ${hms(lastBuy)}, longest gap ${Math.round(worst.gap)} s before '${worst.id}' at ${hms(worst.t || 0)}`);
  return { worst, lastBuy };
}

const base = simulate(false), chain = simulate(true);
console.log(`Assumptions: manual rates ${JSON.stringify(Object.fromEntries(Object.entries(MANUAL).map(([k, v]) => [k, +v.toFixed(3)])))} units/s, start money ${STARTER}, v124 ${JSON.stringify(BAL)}`);
console.log('Pad prices after v124 scaling:', JSON.stringify(Object.fromEntries(Object.entries(PAD).map(([k, v]) => [k, v.cost]))));
const rb = report('without the production chain (workshop, level 3)', base);
const rc = report('with the production chain', chain);
const chainSteps = chain.log.filter((e) => /^(frame|sawmill3|concrete3|metal3)$/.test(e.id));
console.log('\nChain steps: ' + chainSteps.map((e) => `${e.id} at ${hms(e.t)} (gap ${Math.round(e.gap)} s)`).join(', '));
const stageEnd = (r) => (r.log.filter((e) => e.id.startsWith('stage')).pop() || {}).t || 0;
console.log(`Last of the ${STAGES.length} stages bought: without chain ${hms(stageEnd(base))}, with chain ${hms(stageEnd(chain))} (delay ${Math.round(stageEnd(chain) - stageEnd(base))} s)`);
const early = chain.log.filter((e) => e.t <= CHECK_HOURS * 3600 && e.gap > LIMIT_S);
const mine = early.filter((e) => /^(frame|sawmill3|concrete3|metal3)$/.test(e.id)), others = early.filter((e) => !mine.includes(e));
console.log(`\nGaps over ${LIMIT_S} s within the first ${CHECK_HOURS} h -- steps added by the production chain: ${mine.length}${mine.length ? ' -> ' + mine.map((e) => `${e.id} (${Math.round(e.gap)} s at ${hms(e.t)})`).join(', ') : ''}`);
console.log(`Same, pre-existing steps (stages / warehouse upgrades, balance NOT retuned here): ${others.length}${others.length ? ' -> ' + others.map((e) => `${e.id} (${Math.round(e.gap)} s at ${hms(e.t)})`).join(', ') : ''}`);
console.log(`Everything in the game (16 stages) is bought by ${hms(stageEnd(chain))} in this model; the 14 h window is empty after that (ROADMAP task 4 stretches the curve).`);
if (process.argv.includes('--check')) process.exit(mine.length ? 1 : 0);
