// Progression-curve model for tycoon-v161 WITHOUT a browser: "time to next step" for every purchasable step of the main
// line, before and after the late-game curve (assets/late-game-v161.js), and the production-chain step list.
//   node tools/balance-v161.mjs              print assumptions, the before/after table (run 1) and the summary
//   node tools/balance-v161.mjs --full       also print the table of prestige runs 2 and 3
//   node tools/balance-v161.mjs --check      exit 1 when the curve leaves the contract (see CONTRACT below)
//
// Source of every number (parsed from the files, not re-typed):
//   tycoon-v161.html  STAGES (cost/resources/incomeAdd) + FIRST_RUN_STAGE_COSTS_V36 (v36 overrides STAGES[0..9].cost at boot, BEFORE
//                     v124 -- the first version of this script missed that and priced stages 1-9 up to 29 % too high), v124 BALANCE
//                     (money x1.25, resources x1.08 up, income x0.72, construction x1.92, production x0.68), industrial pad prices,
//                     production intervals/unlock stages, storage (BASE_*_CAPACITY + 16/12 per warehouse level), starter job,
//                     constructionDuration(), level speeds, upgrade formulas (buildingUpgradeCost/-PlankCost/-ConcreteCost/-MetalCost),
//                     MAX_BUILDING_LEVEL, constructionCapacity() (2 parallel jobs)
//   assets/production-chain-v161.js   TABLE (frame recipe, workshop and level-3 prices/gates/speeds)
//   assets/expansion-v159.js          construction time factor of stages 10..15
//   assets/development-core-v160.js   company programmes (3 tracks x 5 levels: cost, unlock stage, minimum duration)
//   assets/late-game-v161.js          TABLE = the lever of this task (stage price multipliers + prestige price step)
// Replicated formulas (the game has them inline in functions, line refs in CHANGELOG_V161.md): totalIncomePerSec,
// constructionDuration, sawmill/concrete/metal auto timers, builtWarehouseLevels, doPrestige reset.
//
// Model assumptions (NOT game data, stated so they can be argued with):
//  * "active play": the player spends every second gathering by hand the resource the best next target is short of; manual rates are
//    rough (carry trips, 3 s / 4.2 s mine cooldowns + ~2.5 s work); WALKING between pads, truck delivery tickets, crew slots and the
//    construction queue are ignored, so waits are LOWER bounds;
//  * income = base income only (stage income x level x v124 0.72 x (1 + 0.5 x prestige)); no staff/base/fleet/meta/contract/city
//    bonuses, no districts, no events, no optional programme levels 3-5 (they are extra money sinks: reality is slower, bonuses make it faster);
//  * greedy buying = cheapest affordable step first; at most 2 construction jobs at once (constructionCapacity());
//  * the six programme levels the game requires (3 before stage 10, 6 for prestige) are bought as soon as unlocked;
//  * prestige = doPrestige(): buildings, stock, frames, programmes reset, industrial pads/levels stay, start cash 300.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('tycoon-v161.html');
const chainJs = read('assets/production-chain-v161.js');
const devJs = read('assets/development-core-v160.js');
const lateJs = fs.existsSync(path.join(root, 'assets/late-game-v161.js')) ? read('assets/late-game-v161.js') : null;
const evalLiteral = (text) => vm.runInNewContext('(' + text + ')');
const num = (name) => { const m = html.match(new RegExp(`const ${name}\\s*=\\s*([0-9.]+)`)); if (!m) throw new Error('constant not found: ' + name); return Number(m[1]); };
const cost = (name) => { const m = html.match(new RegExp(`const ${name}\\s*=\\s*(\\{[^}]*\\})`)); if (!m) throw new Error('cost not found: ' + name); return evalLiteral(m[1]); };
const between = (src, a, b) => src.slice(src.indexOf(a) + a.length, src.indexOf(b, src.indexOf(a)));

// ---- CONTRACT (the numbers the check enforces) -----------------------------------------------------------------------------------
export const CONTRACT = {
  totalHoursMin: 15, totalHoursMax: 25, runsCounted: 3, // total = run 1 + the first two prestige runs (a run alone is 5-6 h: ~175 steps cannot exceed 6 min each)
  gapMinS: 60, gapMaxS: 360,                           // every step 1..6 min ...
  minAppliesFromS: 3600,                               // ... the lower bound only after the first hour, only in run 1 and only for the MAJOR steps
                                                       //     (stage purchases and upgrades to level >= 3 of buildings 6+; the first upgrade L2 right after a build,
                                                       //     programme levels, industrial pads and the cheap upgrades of the first six buildings are quick follow-ups)
  firstS: 2400, firstGapMaxS: 120,                     // first 40 min of run 1: nobody waits more than 2 min
  hourS: 3600, hourGapMaxS: 180,                       // up to the end of hour 1: at most 3 min (the resource wall of the Factory chain starts here)
};
export const isMajor = (e) => { const m = e.id.match(/^stage (\d+)/), u = e.id.match(/^upg (.*) -> L(\d+)/); if (m) return Number(m[1]) >= 6; if (u) return Number(u[2]) >= 3 && BASE_STAGES.findIndex((x) => x.nameEn === u[1]) >= 6; return false; };

// ---- parse the game ---------------------------------------------------------------------------------------------------------------
const stagesText = html.slice(html.indexOf('const STAGES = ['), html.indexOf('\n];', html.indexOf('const STAGES = [')) + 3).replace(/^const STAGES = /, '').replace(/;$/, '');
const RAW_STAGES = evalLiteral(stagesText);
const V36 = evalLiteral(html.match(/const FIRST_RUN_STAGE_COSTS_V36=(\[[^\]]*\])/)[1]);
const BAL = evalLiteral(html.match(/const BALANCE=(\{[^}]*\})/)[1]);
const TABLE = evalLiteral(between(chainJs, 'const TABLE = ', '/* TABLE END */').trim().replace(/;$/, ''));
export const LATE = lateJs ? evalLiteral(between(lateJs, 'const TABLE = ', '/* TABLE END */').trim().replace(/;$/, '')) : { stageCostMul: [], prestigeCostStep: 0 };
const speedRows = evalLiteral(html.match(/const INDUSTRIAL_LEVEL_SPEED_V161 = (\{[^}]*\})/)[1].replace(/\]\s*,\s*\}/, ']}'));
speedRows.sawmill.push(TABLE.levels3.sawmill.speed); speedRows.concrete.push(TABLE.levels3.concrete.speed); speedRows.metal.push(TABLE.levels3.metal.speed);

const mon = (n) => Math.max(1, Math.round(n * BAL.moneyCost));
const res = (n) => Math.max(0, Math.ceil((n || 0) * BAL.resourceCost));
const scale = (c) => ({ money: mon(c.money || 0), wood: res(c.wood), concrete: res(c.concrete), metal: res(c.metal), frame: c.frame || 0 });
export const MAX_LEVEL_GAME = num('MAX_BUILDING_LEVEL');   // what tycoon-v161.html says now (after the late-game edit)
const MAX_LEVEL_BEFORE = 5;                         // v161 as uploaded: 'four upgrade levels on top of the first'
const CONCRETE_UNLOCK = num('CONCRETE_UNLOCK_STAGE'), METAL_UNLOCK = num('METAL_UNLOCK_STAGE');
const SAW_I = num('BASE_SAWMILL_AUTO_INTERVAL'), CON_I = num('CONCRETE_AUTO_INTERVAL'), MET_I = num('METAL_AUTO_INTERVAL');
const CAP = { concrete: num('BASE_CONCRETE_CAPACITY'), metal: num('BASE_METAL_CAPACITY') }; // + 16 / 12 per warehouse level
const STARTER = 220 + Number(html.match(/RUNS_REQUIRED=2,RUN_REWARD=(\d+)/)[1]) * 2; // start cash + two starter runs
const PRESTIGE_START_CASH = 300;
const PRESTIGE_INCOME_STEP = 0.5; // incomeMultiplier(): 1 + stats.prestige * 0.5

// the game's price of stage i after v36 (first ten stages) and v124 = what the late-game layer reads as its base
export const BASE_STAGES = RAW_STAGES.map((s, i) => ({ ...s, cost: mon(i < V36.length ? V36[i] : s.cost), plankCost: res(s.plankCost), concreteCost: res(s.concreteCost), metalCost: res(s.metalCost) }));
const EXPANSION_FIRST = 10;
const exp = (i, upgrading) => (RAW_STAGES[i].expansionV159 ? (upgrading ? 1.65 + (i - EXPANSION_FIRST) * 0.15 : 2.6 + (i - EXPANSION_FIRST) * 0.25) : 1);
const constructionS = (i, level, upgrading, crew) => Math.max(2.0, Math.min(6.4, 3.25 + i * 0.23 + (level - 1) * 0.42 + (upgrading ? 0.52 : 0))) * BAL.constructionTime * exp(i, upgrading) * (1 - 0.03 * crew);

const dev = (() => { // company programmes (assets/development-core-v160.js)
  const arr = (n) => evalLiteral(devJs.match(new RegExp(`${n}=(\\[[^\\]]*\\])`))[1]);
  return { unlocks: arr('unlocks'), seconds: arr('seconds'), cash: arr('cash'), wood: arr('wood'), concrete: arr('concrete'), metal: arr('metal'), mult: { storage: 1, production: 1.2, crew: 1.1 } };
})();

const PAD_COST = {
  depot: scale(cost('FLEET_DEPOT_PAD_COST_V118')), sawmill: scale(cost('SAWMILL_PAD_COST_V118')),
  concrete: scale(cost('CONCRETE_PAD_COST_V118')), metal: scale(cost('METAL_PAD_COST_V118')),
  sawmill2: scale(cost('SAWMILL_L2_COST_V161')), concrete2: scale(cost('CONCRETE_L2_COST_V161')), metal2: scale(cost('METAL_L2_COST_V161')),
  frame: scale(TABLE.workshop.cost),
  sawmill3: scale(TABLE.levels3.sawmill.cost), concrete3: scale(TABLE.levels3.concrete.cost), metal3: scale(TABLE.levels3.metal.cost),
};
const MANUAL = { planks: 0.25, concrete: 1 / (3 + 2.5), metal: 1 / (4.2 + 2.5) }; // active-play units/s (assumption)

// stage table the model plays with: base x late multipliers x prestige step (assets/late-game-v161.js does the same to STAGES at boot).
// money = round(base x stageCostMul[i] x (1 + prestigeCostStep x prestige)); resources = ceil(base x stageResMul[i]) (never raised by prestige:
// the storage capacity is limited and a cost above it would be a dead end).
export function stageTable(table, prestige) {
  const step = 1 + (table.prestigeCostStep || 0) * prestige;
  return BASE_STAGES.map((s, i) => {
    const rm = table.stageResMul?.[i] ?? 1;
    const r = (n) => (n > 0 ? Math.max(1, Math.ceil(n * rm - 1e-9)) : 0);
    return { cost: Math.max(1, Math.round(s.cost * (table.stageCostMul?.[i] ?? 1) * step)), plankCost: r(s.plankCost), concreteCost: r(s.concreteCost), metalCost: r(s.metalCost) };
  });
}
export const stagePrices = (table, prestige) => stageTable(table, prestige).map((x) => x.cost);

// ---- the simulation ---------------------------------------------------------------------------------------------------------------
// One call = `runs` consecutive runs separated by prestige. Returns the step log of every run.
export function simulate(table, { runs = 3, withChain = true, hours = 60, freeResources = false, maxLevel = MAX_LEVEL_GAME, dt = 1 } = {}) {
  const N = BASE_STAGES.length;
  const persist = { flags: new Set(), lv: { sawmill: 1, concrete: 1, metal: 1 } };
  const out = [];
  let tAbs = 0, last = 0;
  for (let run = 0; run < runs; run++) {
    const T = stageTable(table, run), prices = T.map((x) => x.cost);
    const st = {
      t: 0, money: run === 0 ? STARTER : PRESTIGE_START_CASH, planks: 0, concrete: 0, metal: 0, frames: 0,
      b: [], pending: [], flags: persist.flags, lv: persist.lv, timers: { saw: 0, con: 0, met: 0, frame: 0 },
      prog: { storage: 0, production: 0, crew: 0 }, progBusy: null,
    };
    const log = [];
    const ready = new Map(); // candidate id -> { ms, rs }: last tick money / resources were short for it
    const income = () => {
      let s = 0;
      for (const x of st.b) s += BASE_STAGES[x.i].incomeAdd * (x.upUntil > st.t ? x.level - 1 : x.level);
      return s > 0 ? Math.max(1, s * (1 + PRESTIGE_INCOME_STEP * run) * BAL.income) : 0;
    };
    const stageN = () => st.b.length; // stageIndex = number of stages bought (pending ones included, they are in st.b with ready=false)
    const warehouseLevels = () => st.b.reduce((a, x) => a + (BASE_STAGES[x.i].archetype === 'warehouse' && x.ready <= st.t && x.upUntil <= st.t ? x.level : 0), 0);
    const capC = () => CAP.concrete + 16 * warehouseLevels() + 10 * st.prog.storage, capM = () => CAP.metal + 12 * warehouseLevels() + 8 * st.prog.storage;
    const frameCap = () => TABLE.capacityBase + TABLE.capacityPerWarehouseLevel * warehouseLevels();
    const prodMul = () => BAL.productionSpeed * (1 + 0.04 * st.prog.production);
    const speed = (k) => speedRows[k][st.lv[k] - 1];
    const has = (f) => st.flags.has(f);
    const jobs = () => st.b.filter((x) => x.ready > st.t || x.upUntil > st.t).length;
    const stageCost = (i) => { const s = T[i]; return { money: prices[i], wood: s.plankCost, concrete: s.concreteCost, metal: s.metalCost, frame: 0 }; };
    const progTotal = () => st.prog.storage + st.prog.production + st.prog.crew;
    function candidates() {
      const out2 = [];
      const n = stageN();
      if (n < N && !(n >= 10 && progTotal() < 3)) { // chapter lock: programmes >= 3 from stage 10 (assets/development-v160.js)
        const c = stageCost(n);
        if (!(c.wood > 0 && !has('sawmill'))) out2.push({ id: 'stage ' + n + ' ' + BASE_STAGES[n].nameEn, kind: 'stage', idx: n, cost: c });
      }
      const add = (id, ok) => { if (!has(id) && ok) out2.push({ id, kind: 'pad', cost: PAD_COST[id] }); };
      add('depot', true); add('sawmill', has('depot')); add('concrete', has('sawmill')); add('metal', has('sawmill'));
      add('sawmill2', has('sawmill') && n >= 3); add('concrete2', has('concrete') && n >= CONCRETE_UNLOCK + 1); add('metal2', has('metal') && n >= METAL_UNLOCK + 1);
      if (withChain) {
        add('frame', has('sawmill2') && has('metal2') && n >= TABLE.workshop.gate);
        for (const k of ['sawmill', 'concrete', 'metal']) add(k + '3', has(k + '2') && has('frame') && n >= TABLE.levels3[k].gate);
      }
      for (const x of st.b) if (x.ready <= st.t && x.upUntil <= st.t && x.level < maxLevel) { // upgrade pads: buildingUpgrade*Cost formulas of the game
        const s = T[x.i], L = x.level, base = prices[x.i];
        const nameEn = BASE_STAGES[x.i].nameEn;
        out2.push({
          id: `upg ${nameEn} -> L${L + 1}`, kind: 'upgrade', x,
          cost: { money: Math.round(base * 0.48 * L), wood: Math.max(1, Math.ceil(Math.max(1, s.plankCost) * 0.45 * L)), concrete: s.concreteCost <= 0 ? 0 : Math.max(1, Math.ceil(s.concreteCost * 0.36 * L)), metal: s.metalCost <= 0 ? 0 : Math.max(1, Math.ceil(s.metalCost * 0.32 * L)), frame: 0 },
        });
      }
      // the six programme levels the game requires (3 for the stage-10 chapter, 6 for prestige): L1 of each track, then L2 of each
      if (!st.progBusy) for (const track of ['storage', 'production', 'crew']) {
        const lvl = st.prog[track];
        const wanted = lvl === 0 || (lvl === 1 && st.prog.storage >= 1 && st.prog.production >= 1 && st.prog.crew >= 1);
        if (wanted && n >= dev.unlocks[lvl]) out2.push({ id: `programme ${track} L${lvl + 1}`, kind: 'prog', track, cost: { money: Math.round(dev.cash[lvl] * dev.mult[track]), wood: dev.wood[lvl], concrete: dev.concrete[lvl], metal: dev.metal[lvl], frame: 0 } });
      }
      return out2;
    }
    const afford = (c) => st.money >= c.cost.money && (freeResources || st.planks >= c.cost.wood && st.concrete >= c.cost.concrete && st.metal >= c.cost.metal && st.frames >= c.cost.frame);
    const crew = () => st.prog.crew;
    function buy(c) {
      st.money -= c.cost.money; st.planks -= c.cost.wood; st.concrete -= c.cost.concrete; st.metal -= c.cost.metal; st.frames -= c.cost.frame;
      if (c.kind === 'stage') st.b.push({ i: c.idx, level: 1, ready: st.t + constructionS(c.idx, 1, false, crew()), upUntil: 0 });
      else if (c.kind === 'upgrade') { c.x.level += 1; c.x.upUntil = st.t + constructionS(c.x.i, c.x.level, true, crew()); }
      else if (c.kind === 'prog') st.progBusy = { track: c.track, done: st.t + dev.seconds[st.prog[c.track]] };
      else {
        st.flags.add(c.id);
        const m = c.id.match(/^(sawmill|concrete|metal)([23])$/); if (m) st.lv[m[1]] = Number(m[2]);
      }
      const rd = ready.get(c.id) || {}; ready.delete(c.id);
      log.push({ run, t: st.t, tAbs: tAbs + st.t, gap: tAbs + st.t - last, id: c.id, kind: c.kind, stage: stageN(), bind: rd.rs == null ? '?' : (rd.rs > rd.ms ? 'res' : (rd.ms > rd.rs ? 'money' : '-')) });
      last = tAbs + st.t;
    }
    const horizon = hours * 3600;
    let stuck = 0;
    while (st.t < horizon) {
      st.t += dt;
      if (st.progBusy && st.t >= st.progBusy.done) { st.prog[st.progBusy.track] += 1; st.progBusy = null; }
      st.money += income() * dt;
      const n = stageN();
      if (has('sawmill') && n >= 1) { st.timers.saw += dt; const iv = Math.max(3.2, SAW_I / prodMul()) / speed('sawmill'); while (st.timers.saw >= iv) { st.timers.saw -= iv; st.planks += 1; } }
      if (has('concrete') && n >= CONCRETE_UNLOCK) { st.timers.con += dt; const iv = CON_I / prodMul() / speed('concrete'); while (st.timers.con >= iv) { st.timers.con -= iv; st.concrete = Math.min(capC(), st.concrete + 1); } }
      if (has('metal') && n >= METAL_UNLOCK) { st.timers.met += dt; const iv = MET_I / prodMul() / speed('metal'); while (st.timers.met >= iv) { st.timers.met -= iv; st.metal = Math.min(capM(), st.metal + 1); } }
      if (withChain && has('frame') && n >= TABLE.recipe.unlockStage) { // surplus-only recipe (assets/production-chain-v161.js reserve()/canCraft())
        st.timers.frame += dt;
        const iv = TABLE.recipe.interval / prodMul();
        if (st.timers.frame >= iv) {
          const c = n < N ? stageCost(n) : { wood: 0, metal: 0 }, R = TABLE.recipe;
          const rm = Math.min(c.metal, Math.max(0, capM() - R.metal));
          if (st.frames + R.out <= frameCap() && st.planks >= R.planks + c.wood && st.metal >= R.metal + rm) { st.planks -= R.planks; st.metal -= R.metal; st.frames += R.out; st.timers.frame -= iv; } else st.timers.frame = iv;
        }
      }
      let cs = candidates();
      for (const c of cs) { // remember the LAST tick each kind of shortage was seen: whichever cleared last is what the purchase waited for
        const rd = ready.get(c.id) || { ms: -1, rs: -1 };
        if (st.money < c.cost.money) rd.ms = st.t;
        if (st.planks < c.cost.wood || st.concrete < c.cost.concrete || st.metal < c.cost.metal || st.frames < c.cost.frame) rd.rs = st.t;
        ready.set(c.id, rd);
      }
      for (;;) {
        if (jobs() >= 2) break; // constructionCapacity(): 2 parallel jobs
        let pick = null;
        for (const c of cs) if (afford(c) && (!pick || c.cost.money < pick.cost.money)) pick = c;
        if (!pick) break;
        buy(pick);
        cs = candidates();
      }
      // active play: gather by hand what the soonest-completable target lacks most
      if (cs.length) {
        const inc = Math.max(0.01, income());
        let best = null, bestEta = Infinity, bestRes = null;
        for (const c of cs) {
          const miss = { planks: Math.max(0, c.cost.wood - st.planks), concrete: Math.max(0, c.cost.concrete - st.concrete), metal: Math.max(0, c.cost.metal - st.metal) };
          let eta = Math.max(0, c.cost.money - st.money) / inc, scarce = null, scarceEta = 0;
          for (const k of ['planks', 'concrete', 'metal']) {
            if (miss[k] <= 0) continue;
            const can = k === 'planks' ? has('sawmill') : (k === 'concrete' ? has('concrete') && n >= CONCRETE_UNLOCK : has('metal') && n >= METAL_UNLOCK);
            const rate = (can ? MANUAL[k] : 0) + 0.02; const e = miss[k] / rate;
            if (e > scarceEta) { scarceEta = e; scarce = can ? k : null; }
          }
          eta = Math.max(eta, scarceEta);
          if (eta < bestEta) { bestEta = eta; best = c; bestRes = scarce; }
        }
        if (best && bestRes) { st[bestRes] += MANUAL[bestRes] * dt; if (bestRes === 'concrete') st.concrete = Math.min(capC(), st.concrete); if (bestRes === 'metal') st.metal = Math.min(capM(), st.metal); }
      } else if (st.b.every((x) => x.ready <= st.t && x.upUntil <= st.t) && !st.progBusy) break; // everything bought and finished
      if (st.t - (log.length ? log[log.length - 1].t : 0) > 3 * 3600) { stuck = 1; break; }
    }
    const lastBuy = log.length ? log[log.length - 1].t : 0;
    out.push({ run, log, endT: lastBuy, stuck: !!stuck, timeToPrestigeEligible: (log.filter((e) => e.kind === 'stage').pop() || {}).t || 0 });
    tAbs += lastBuy;
  }
  return out;
}

// ---- reporting --------------------------------------------------------------------------------------------------------------------
const hms = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const fmtMoney = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(n);

export function checkCurve(runsOut, contract = CONTRACT) {
  const problems = [];
  const counted = runsOut.slice(0, contract.runsCounted);
  const total = counted.reduce((a, r) => a + r.endT, 0);
  if (counted.some((r) => r.stuck)) problems.push('a run got stuck (no purchase for 3 h)');
  if (total < contract.totalHoursMin * 3600 || total > contract.totalHoursMax * 3600) problems.push(`total of ${counted.length} runs ${hms(total)} outside ${contract.totalHoursMin}-${contract.totalHoursMax} h`);
  for (const r of counted) {
    for (const e of r.log) {
      const lim = r.run === 0 && e.t <= contract.firstS ? contract.firstGapMaxS : (r.run === 0 && e.t <= contract.hourS ? contract.hourGapMaxS : contract.gapMaxS);
      if (e.gap > lim) problems.push(`run ${r.run + 1}: '${e.id}' waits ${Math.round(e.gap)} s (> ${lim} s) at ${hms(e.t)}`);
      if (r.run === 0 && e.t > contract.minAppliesFromS && isMajor(e) && e.gap < contract.gapMinS) problems.push(`run 1: '${e.id}' only ${Math.round(e.gap)} s after the previous step (< ${contract.gapMinS} s) at ${hms(e.t)}`);
    }
  }
  return { total, problems: [...new Set(problems)] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const before = simulate({}, { runs: 3, maxLevel: MAX_LEVEL_BEFORE });
  const after = simulate(LATE, { runs: 3, maxLevel: LATE.maxLevel });
  if (LATE.maxLevel !== MAX_LEVEL_GAME) console.log(`WARNING: late-game TABLE.maxLevel ${LATE.maxLevel} != MAX_BUILDING_LEVEL ${MAX_LEVEL_GAME} in tycoon-v161.html`);
  console.log(`Assumptions: manual rates ${JSON.stringify(Object.fromEntries(Object.entries(MANUAL).map(([k, v]) => [k, +v.toFixed(3)])))} units/s, start money ${STARTER} (run 1) / ${PRESTIGE_START_CASH} (after prestige), v124 ${JSON.stringify(BAL)}`);
  console.log(`Stage prices in the game (v36 + v124): ${BASE_STAGES.map((s) => fmtMoney(s.cost)).join(' ')}`);
  console.log(`Late-game table: maxLevel ${LATE.maxLevel} (was ${MAX_LEVEL_BEFORE}), stageResMul = [${(LATE.stageResMul || []).join(', ')}]`);
  const tt = stageTable(LATE, 0);
  console.log(`Stage resource costs wood/concrete/metal BEFORE: ${BASE_STAGES.map((s) => `${s.plankCost}/${s.concreteCost}/${s.metalCost}`).join(' ')}`);
  console.log(`Stage resource costs wood/concrete/metal AFTER:  ${tt.map((s) => `${s.plankCost}/${s.concreteCost}/${s.metalCost}`).join(' ')}`);
  const table = (title, b, a) => {
    console.log(`\n=== ${title}: time to next step (s since the previous purchase), BEFORE vs AFTER the late-game curve ===`);
    console.log('  #  step                                  gap before   at before |  gap after    at after');
    const byId = new Map(b.log.map((e) => [e.id, e]));
    a.log.forEach((e, k) => {
      const o = byId.get(e.id);
      console.log(`${String(k + 1).padStart(3)}  ${e.id.padEnd(36)}  ${o ? String(Math.round(o.gap)).padStart(8) : '       -'}  ${o ? hms(o.t) : '        -'} | ${String(Math.round(e.gap)).padStart(8)}  ${hms(e.t)}  ${e.bind}`);
    });
    console.log(`steps ${b.log.length} -> ${a.log.length}; finished (last purchase) ${hms(b.endT)} -> ${hms(a.endT)}; last stage bought ${hms(b.timeToPrestigeEligible)} -> ${hms(a.timeToPrestigeEligible)}`);
  };
  table('Run 1', before[0], after[0]);
  if (args.includes('--full')) { table('Run 2 (prestige 1)', before[1], after[1]); table('Run 3 (prestige 2)', before[2], after[2]); }
  const stat = (r) => { const g = r.log.filter((e) => e.t > CONTRACT.hourS).map((e) => e.gap); return g.length ? `min ${Math.round(Math.min(...g))} s, mean ${Math.round(g.reduce((a, b) => a + b, 0) / g.length)} s, max ${Math.round(Math.max(...g))} s` : '-'; };
  console.log('\nRuns (completionist: every stage, upgrade, industrial pad and required programme bought):');
  for (const [name, set] of [['before', before], ['after ', after]]) {
    console.log(`  ${name}: ` + set.map((r) => `run ${r.run + 1} ${hms(r.endT)} (${r.log.length} steps; gaps after hour 1: ${stat(r)})`).join(' | ') + ` | total of 3 = ${hms(set.reduce((a, r) => a + r.endT, 0))}`);
  }
  const chainSteps = after[0].log.filter((e) => /^(frame|sawmill3|concrete3|metal3)$/.test(e.id));
  console.log('\nChain steps: ' + chainSteps.map((e) => `${e.id} at ${hms(e.t)} (gap ${Math.round(e.gap)} s)`).join(', '));
  const verdict = checkCurve(after);
  console.log(`\nCONTRACT: total of ${CONTRACT.runsCounted} runs ${hms(verdict.total)} must be ${CONTRACT.totalHoursMin}-${CONTRACT.totalHoursMax} h; every step <= ${CONTRACT.gapMaxS / 60} min (<= ${CONTRACT.firstGapMaxS / 60} min in the first ${CONTRACT.firstS / 60} min, <= ${CONTRACT.hourGapMaxS / 60} min in hour 1); major steps of run 1 >= ${CONTRACT.gapMinS} s after hour 1.`);
  console.log(verdict.problems.length ? 'PROBLEMS:\n  ' + verdict.problems.join('\n  ') : 'curve OK');
  if (args.includes('--check')) process.exit(verdict.problems.length ? 1 : 0);
}
