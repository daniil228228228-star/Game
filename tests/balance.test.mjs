// Balance-pass regression test (VISION.md Phase 1, item 1).
//
// Simulates the base (level-1, no upgrades, no achievement-reward bonuses) time-to-build
// curve from the STAGES data in tycoon.html and asserts it stays within the pacing target
// decided during the balance pass:
//   - stage 0 and 1 are instantly affordable with starting cash (fast, satisfying onboarding)
//   - stage 2 onward ramps up smoothly, roughly 1.5-7 minutes per stage
//   - a full, no-upgrade playthrough takes roughly 20-40 minutes
//
// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(ROOT, 'tycoon.html'), 'utf8');

function loadStages() {
  const m = html.match(/const STAGES = (\[[\s\S]*?\n\]);/);
  assert.ok(m, 'Could not find STAGES array in tycoon.html — has it been renamed/restructured?');
  // eslint-disable-next-line no-new-func — trusted local file, plain array literal
  return new Function(`return ${m[1]};`)();
}

const STARTING_MONEY = 300;

function simulateBuildCurve(stages) {
  let money = STARTING_MONEY;
  let income = 0;
  const seconds = [];
  for (const stage of stages) {
    if (money < stage.cost) {
      const shortfall = stage.cost - money;
      assert.ok(income > 0, `stage "${stage.name}" is unaffordable at zero income — a balance bug`);
      seconds.push(shortfall / income);
      money += shortfall;
    } else {
      seconds.push(0);
    }
    money -= stage.cost;
    income += stage.incomeAdd;
  }
  return seconds;
}

test('STAGES has the expected 10-building progression', () => {
  assert.equal(loadStages().length, 10);
});

test('the first two buildings are affordable with starting cash (fast onboarding, by design)', () => {
  const seconds = simulateBuildCurve(loadStages());
  assert.equal(seconds[0], 0, 'stage 0 should be instantly affordable with starting money');
  assert.equal(seconds[1], 0, 'stage 1 should be instantly affordable right after stage 0');
});

test('build time ramps up smoothly from stage 2 onward (no pacing cliffs or reversals)', () => {
  const stages = loadStages();
  const seconds = simulateBuildCurve(stages);
  for (let i = 3; i < seconds.length; i++) {
    assert.ok(
      seconds[i] >= seconds[i - 1] - 0.01,
      `stage ${i} ("${stages[i].name}") takes less time than stage ${i - 1} — pacing should ramp up, not dip`
    );
  }
});

test('each stage from 2 onward takes between 30s and 9min', () => {
  const stages = loadStages();
  const seconds = simulateBuildCurve(stages);
  for (let i = 2; i < seconds.length; i++) {
    assert.ok(seconds[i] >= 30, `stage ${i} ("${stages[i].name}") is too fast: ${seconds[i].toFixed(0)}s`);
    assert.ok(seconds[i] <= 540, `stage ${i} ("${stages[i].name}") is too slow: ${seconds[i].toFixed(0)}s`);
  }
});

test('a fresh, no-upgrade playthrough completes in roughly 20-40 minutes', () => {
  const seconds = simulateBuildCurve(loadStages());
  const total = seconds.reduce((a, b) => a + b, 0);
  assert.ok(total >= 20 * 60, `total build time too fast: ${(total / 60).toFixed(1)} min`);
  assert.ok(total <= 40 * 60, `total build time too slow: ${(total / 60).toFixed(1)} min`);
});
