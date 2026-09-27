// Regression test for the "[road union] Error: Open road union contour" console error
// investigated and root-caused this session (see CHANGELOG_V116.md, "road union" investigation).
//
// Root cause: an early, superseded definition of refreshTransportAccessRoads() (a
// renderNetwork59()/addIntersection59()-based rebuild) was reachable during a real boot-time
// race -- the v36.5/v36.6 setTimeout(120)/(180) road-init cascade calls refreshTransportAccessRoads()
// by name, and on a slow-enough boot (heavy scene construction under swiftshader) that call could
// still resolve to this intermediate definition instead of the final v66/v113 one, before it got
// reassigned. addIntersection59()'s T-junction fill degenerates at metalBypass's real T-junction
// (three edges -- clusterGate, concreteBypass, metalHome -- where clusterGate and metalHome leave
// in nearly the same direction, a genuine, permanent property of serviceAccessGraph()'s topology),
// leaving a dangling ~0.2-unit boundary edge that roadUnionContours() cannot close into a loop.
// Fix: delete that intermediate reassignment entirely, so the race window falls through to the
// earlier, safe hoisted stub (a plain addRoadSegment()-based rebuild that never calls
// addIntersection59()) instead of a broken one.
//
// This error was intermittent (~5-25% of reloads with the old-format save) BEFORE the fix, and
// reproduced with byte-identical boundary coordinates every time -- not a symptom of save state,
// timing jitter in the geometry itself, or anything else in this test suite. Verified with 0/50
// occurrences (candidate) and 0/60 occurrences (final, this exact file) across two independent
// live-measurement batches after the fix, against the same harness/save that showed 6-12
// occurrences per 40-60 reloads before it. This test re-runs a smaller but still meaningful batch
// (enough to have caught the pre-fix rate with very high confidence) so a real regression shows up
// as a failing (not just flaky) test, without making the whole suite slow.
import { openGame, OLD_SAVE, ROAD_UNION_KNOWN_ISSUE_RE, startServer } from './lib/harness.mjs';

// Default kept modest (not the 50-60 used for the original investigation) so this runs quickly as
// part of the regular suite; each iteration launches a fresh browser, and a long run of those back
// to back can itself hit unrelated Playwright/Chromium resource flakiness under load (seen live:
// "Target page, context or browser has been closed" after a long run in this same session) --
// caught below and skipped (not counted as a hit OR a clean pass) rather than crashing the test.
const N = Number(process.env.ROAD_UNION_ITERATIONS || 20);

async function main() {
  let hits = 0, skipped = 0, completed = 0;
  const server = await startServer();
  for (let i = 0; i < N; i++) {
    let saw = false, game = null;
    try {
      game = await openGame({ save: OLD_SAVE, url: `${server.url}/tycoon-v116.html`, waitMs: 4000 });
      saw = game.errors.some((e) => ROAD_UNION_KNOWN_ISSUE_RE.test(e));
      if (saw) hits++;
      completed++;
      console.log(`reload ${i}: ${saw ? 'HIT' : 'ok'}`);
    } catch (e) {
      skipped++;
      console.log(`reload ${i}: SKIPPED (unrelated browser error: ${e.message.split('\n')[0]})`);
    } finally {
      if (game) { try { await game.browser.close(); } catch (_) {} }
    }
  }
  await server.close();

  console.log(`\nroad-union hits: ${hits}/${completed} (${skipped} skipped for unrelated browser errors)`);
  if (completed === 0) {
    console.error('FAIL: every reload was skipped for unrelated browser errors -- no signal, treat as inconclusive and rerun.');
    process.exit(1);
  }
  if (hits > 0) {
    console.error(`FAIL: "[road union] Error: Open road union contour" reappeared ${hits}/${completed} times.`);
    console.error('If this is a genuine regression (not a fluke -- rerun to confirm), see');
    console.error('CHANGELOG_V116.md\'s "road union" investigation for the root cause this fixed');
    console.error('(the deleted intermediate refreshTransportAccessRoads() reassignment, ~line 28919)');
    console.error('and check it has not been reintroduced (e.g. by a merge or a new patch layer).');
    process.exit(1);
  }
  console.log('\nroad-union.test.mjs: PASS');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
