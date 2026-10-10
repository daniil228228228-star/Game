// Progression curve contract WITHOUT a browser (ROADMAP task 4): tools/balance-v161.mjs simulates the whole game with the game's own
// formulas (parsed from tycoon-v161.html and assets/*.js) and exits 1 when the curve leaves tools/balance-v161.mjs CONTRACT
// (total of 3 runs 15-25 h, every step <= 6 min, <= 2 min in the first 40 min, >= 1 min for the major steps after hour 1).
// Also: the late-game table is consistent with the game (maxLevel, 16 multipliers, nothing above the storage capacity, nothing zeroed).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { check, REPO_ROOT } from './lib/harness.mjs';
import { LATE, BASE_STAGES, MAX_LEVEL_GAME, stageTable, simulate, checkCurve } from '../tools/balance-v161.mjs';

const bal = spawnSync('node', [path.join(REPO_ROOT, 'tools/balance-v161.mjs'), '--check'], { encoding: 'utf8' });
const verdict = (bal.stdout.match(/^CONTRACT: .*$/m) || [''])[0];
console.log(bal.stdout.split('\n').filter((l) => /^(  (before|after )|steps |Chain steps|curve OK|PROBLEMS)/.test(l)).join('\n'));
check(bal.status === 0 && /curve OK/.test(bal.stdout), `balance-v161.mjs --check exits 0 (${verdict.slice(0, 160)})`);

check(LATE.maxLevel === MAX_LEVEL_GAME && MAX_LEVEL_GAME === 10, `TABLE.maxLevel ${LATE.maxLevel} equals MAX_BUILDING_LEVEL ${MAX_LEVEL_GAME} in tycoon-v161.html`);
check(LATE.stageResMul.length === BASE_STAGES.length && LATE.stageResMul.every((m) => m >= 0.3 && m <= 1.8), `stageResMul has ${LATE.stageResMul.length} entries inside 0.3..1.8`);
check(BASE_STAGES[1].cost === 150 && BASE_STAGES[9].cost === 97500 && BASE_STAGES[15].cost === 1562500, 'model prices = the game after v36 (stages 0-9) and v124 (x1.25): 150 / 97500 / 1562500');

// no stage or upgrade (levels 1..MAX-1) asks for more concrete/metal than the storage can ever hold (18 + 16 x 10 warehouse levels + 30 programme levels / 12 + 120 + 24)
const T = stageTable(LATE, 0);
let worst = { c: 0, m: 0 };
for (const s of T) for (let L = 1; L < MAX_LEVEL_GAME; L++) {
  worst.c = Math.max(worst.c, s.concreteCost <= 0 ? 0 : Math.max(1, Math.ceil(s.concreteCost * 0.36 * L)));
  worst.m = Math.max(worst.m, s.metalCost <= 0 ? 0 : Math.max(1, Math.ceil(s.metalCost * 0.32 * L)));
}
check(worst.c <= 18 + 160 + 30 && worst.m <= 12 + 120 + 24, `largest concrete / metal cost of any step is ${worst.c} / ${worst.m} (capacity ${18 + 160 + 30} / ${12 + 120 + 24}): no dead end`);
check(T.every((s, i) => (BASE_STAGES[i].concreteCost > 0) === (s.concreteCost > 0) && (BASE_STAGES[i].metalCost > 0) === (s.metalCost > 0) && (BASE_STAGES[i].plankCost > 0) === (s.plankCost > 0)), 'a resource that a stage needed is still needed (never rounded to 0) and none was added');
check(T.every((s, i) => s.cost === BASE_STAGES[i].cost), 'money prices of the stages are unchanged (the lever is the resource cost)');

// the contract itself must reject a curve that is too short / too steep: sanity of the checker
const bare = checkCurve(simulate({}, { runs: 3, maxLevel: 5 }));
check(bare.problems.length > 0 && bare.total < 15 * 3600, `the unchanged game (5 levels, no table) fails the contract: total ${(bare.total / 3600).toFixed(1)} h, ${bare.problems.length} problems`);
process.exit(process.exitCode || 0);
