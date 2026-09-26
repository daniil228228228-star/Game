// Prestige pacing regression test (VISION.md Phase 1, item 2).
//
// Verifies that each additional prestige (permanent income multiplier, currently
// 1 + prestige * 0.5 in tycoon.html) meaningfully shortens a full playthrough, and that
// returns stay non-trivial even at high prestige counts rather than flattening to ~0%.
//
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStages, simulateBuildCurve, incomeMultiplier } from './lib/stages.mjs';

function totalTime(stages, prestige) {
  return simulateBuildCurve(stages, incomeMultiplier(prestige)).reduce((a, b) => a + b, 0);
}

test('incomeMultiplier matches the formula in tycoon.html (1 + prestige * 0.5)', () => {
  assert.equal(incomeMultiplier(0), 1);
  assert.equal(incomeMultiplier(1), 1.5);
  assert.equal(incomeMultiplier(2), 2);
});

test('each additional prestige strictly shortens a full playthrough', () => {
  const stages = loadStages();
  let prev = totalTime(stages, 0);
  for (let p = 1; p <= 10; p++) {
    const t = totalTime(stages, p);
    assert.ok(t < prev, `prestige ${p} (${t.toFixed(0)}s) is not faster than prestige ${p - 1} (${prev.toFixed(0)}s)`);
    prev = t;
  }
});

test('the first prestige gives a substantial (>=25%) time reduction', () => {
  const stages = loadStages();
  const base = totalTime(stages, 0);
  const afterOne = totalTime(stages, 1);
  const reduction = 1 - afterOne / base;
  assert.ok(reduction >= 0.25, `first prestige only reduced time by ${(reduction * 100).toFixed(1)}%, expected >=25%`);
});

test('even the 10th prestige still meaningfully shortens the run (diminishing but non-trivial returns)', () => {
  const stages = loadStages();
  const t9 = totalTime(stages, 9);
  const t10 = totalTime(stages, 10);
  const reduction = 1 - t10 / t9;
  assert.ok(reduction >= 0.03, `10th prestige only reduced time by ${(reduction * 100).toFixed(2)}%, returns have flattened too much`);
});
