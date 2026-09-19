// Shared helpers for tests that pull live data (STAGES, ACHIEVEMENTS, STRINGS, ...) straight
// out of tycoon.html, so the game's actual values and the test's model can never drift apart
// silently. (Named stages.mjs from its first use; it now hosts general game-data extraction.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const html = readFileSync(path.join(ROOT, 'tycoon.html'), 'utf8');

export const STARTING_MONEY = 300;

export function loadStages() {
  const m = html.match(/const STAGES = (\[[\s\S]*?\n\]);/);
  assert.ok(m, 'Could not find STAGES array in tycoon.html — has it been renamed/restructured?');
  // eslint-disable-next-line no-new-func — trusted local file, plain array literal
  return new Function(`return ${m[1]};`)();
}

export function loadAchievements() {
  const m = html.match(/const ACHIEVEMENTS = (\[[\s\S]*?\n\]);/);
  assert.ok(m, 'Could not find ACHIEVEMENTS array in tycoon.html — has it been renamed/restructured?');
  // The array's `check` fields are function literals — safe to construct without STAGES in
  // scope since we only ever inspect the plain-data fields, never call `check()` here.
  return new Function(`return ${m[1]};`)();
}

export function loadStrings() {
  const m = html.match(/const STRINGS = (\{[\s\S]*?\n\});/);
  assert.ok(m, 'Could not find STRINGS table in tycoon.html — has it been renamed/restructured?');
  return new Function(`return ${m[1]};`)();
}

// Mirrors incomeMultiplier() in tycoon.html.
export function incomeMultiplier(prestige) {
  return 1 + prestige * 0.5;
}

// Mirrors totalIncomePerSec() + the pad-purchase flow in tycoon.html: wait until money
// covers a stage's cost (earning at `income * multiplier` per second), spend it, repeat.
export function simulateBuildCurve(stages, multiplier = 1) {
  let money = STARTING_MONEY;
  let income = 0;
  const seconds = [];
  for (const stage of stages) {
    if (money < stage.cost) {
      const shortfall = stage.cost - money;
      assert.ok(income > 0, `stage "${stage.name}" is unaffordable at zero income — a balance bug`);
      seconds.push(shortfall / (income * multiplier));
      money += shortfall;
    } else {
      seconds.push(0);
    }
    money -= stage.cost;
    income += stage.incomeAdd;
  }
  return seconds;
}
