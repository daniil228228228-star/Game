// HUD regression checklist: the floating quest/toast overlay stack stays removed (commit
// 6ccb464), the white collar ring decal on world-nav ground pads stays removed (commit
// 0803642), and the v47/v48 HUD stat-feedback shimmer stays fixed (commit 2578212) -- measured
// as a bounded TRIGGER COUNT via MutationObserver over real flowing income, per that commit's own
// documented finding that whole-scenario screenshot pixel-diff is too timing-noisy under
// swiftshader to be a reliable signal (see CHANGELOG_V116.md, четвёртый заход).
import { openGame, assert, assertEqual } from './lib/harness.mjs';

async function main() {
  let failures = 0;
  const fail = (msg) => { failures++; console.error('FAIL:', msg); };
  const ok = (msg) => console.log('ok:', msg);

  const game = await openGame({ save: 'clear', waitMs: 2000 });
  const { page } = game;
  try {
    // --- 1. Floating quest/toast overlay stack stays hidden. ---
    const overlayDisplay = await page.evaluate(() => {
      if (typeof ensureRequiredActionV38 === 'function') ensureRequiredActionV38();
      const ids = ['nextCard', 'requiredActionV38', 'eventBanner'];
      const out = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        out[id] = el ? getComputedStyle(el).display : 'missing-element';
      }
      return out;
    });
    console.log('overlay display:', JSON.stringify(overlayDisplay));
    for (const [id, display] of Object.entries(overlayDisplay)) {
      assertEqual(display, 'none', `#${id} must stay display:none (floating quest/toast stack removed per commit 6ccb464)`);
    }
    ok('#nextCard/#requiredActionV38/#eventBanner all display:none');

    // --- 2. No white collar ring decal (0xe6edf7 / 0xffefc7) anywhere in the scene. ---
    await page.evaluate(() => {
      money = 999999; planks = 999; concrete = 999; metal = 999;
      for (let i = 0; i < 4; i++) { try { spawnBuilding(i, 1, { grow: false }); } catch (_) {} }
      if (typeof stageIndex !== 'undefined') stageIndex = 4;
      if (typeof cityState !== 'undefined') cityState.reputation = 200;
      if (typeof refreshCityExpansionWorld === 'function') refreshCityExpansionWorld();
      if (typeof refreshSpecialProjectWorld === 'function') refreshSpecialProjectWorld();
      if (typeof updateHUD === 'function') updateHUD();
    });
    await page.waitForTimeout(800);
    const ringCheck = await page.evaluate(() => {
      const BANNED = new Set([0xe6edf7, 0xffefc7]);
      let hits = 0;
      const names = [];
      scene.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m?.color && BANNED.has(m.color.getHex())) { hits++; names.push(o.name || o.parent?.name || 'unnamed'); }
        }
      });
      return { hits, names, worldNavRuntimeExists: typeof worldNavRuntimeV362 !== 'undefined', buildWorldNavPadExists: typeof buildWorldNavPadV362 !== 'undefined' };
    });
    console.log('ringCheck:', JSON.stringify(ringCheck));
    assertEqual(ringCheck.hits, 0, `no mesh may use the removed white-collar-ring colors, found ${ringCheck.hits} (${JSON.stringify(ringCheck.names)})`);
    ok('no 0xe6edf7/0xffefc7 white ring decal anywhere in the scene');

    // --- 3. HUD stat-feedback trigger frequency stays bounded during continuous passive income
    //         (deterministic MutationObserver count, not screenshot pixel-diff -- see commit
    //         2578212's own methodology note). v47 must be fully removed (0 triggers ever); v48
    //         must not fire near-continuously.
    await page.evaluate(() => {
      money = 20000; planks = 200; concrete = 100; metal = 100;
      for (let i = 0; i < 6; i++) { try { spawnBuilding(i, 1, { grow: false }); } catch (_) {} }
      if (typeof stageIndex !== 'undefined') stageIndex = 6;
      if (typeof cityState !== 'undefined') cityState.population = 50;
      if (typeof updateHUD === 'function') updateHUD();
    });
    const counts = await page.evaluate(async () => {
      const hud = document.getElementById('hud');
      let v47Count = 0, v48Count = 0;
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
          const t = m.target;
          if (t.classList?.contains('v47-stat-pulse')) v47Count++;
          if (t.classList?.contains('v48-stat-feedback')) v48Count++;
        }
      });
      obs.observe(hud, { attributes: true, attributeFilter: ['class'], subtree: true });
      await new Promise((r) => setTimeout(r, 15000));
      obs.disconnect();
      return { v47Count, v48Count };
    });
    console.log('HUD feedback trigger counts over 15s of flowing income:', JSON.stringify(counts));
    assertEqual(counts.v47Count, 0, 'the v47 stat-pulse layer must stay fully removed (dead layer that used to force a reflow with zero visual effect)');
    assert(counts.v48Count <= 20, `v48 feedback must not fire near-continuously (bounded, non-flickery), got ${counts.v48Count} triggers/15s`);
    ok(`HUD feedback bounded: v47=${counts.v47Count} v48=${counts.v48Count}/15s`);
  } catch (e) {
    fail(e.message);
    console.error(e.stack);
  } finally {
    await game.close();
  }

  console.log(failures === 0 ? '\nhud.test.mjs: PASS' : `\nhud.test.mjs: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
