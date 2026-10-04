// "Juice" regression checks (port of the v116 'juice' idea, adapted to v161): sfx keys callable, particle bursts
// spawned AND cleaned up by the real animate() loop (scene child count / particleBursts back to baseline),
// camera shake applies and decays back to a zero offset, mute button toggles + persists, manual road build
// still fires burst + shake + sfx.build. ONE browser launch (fresh save). Cleanup/decay are waited on through
// real animation frames (dt is clamped to 0.075 s, so a 0.9 s burst needs >= 12 frames).
import { openGame, check } from './lib/harness.mjs';

const g = await openGame({ save: 'clear', waitMs: 4000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = (o) => JSON.stringify(o);

// ---- 1. every sfx function is callable without throwing (also while the AudioContext is not unlocked)
const s = await ev(() => {
  const keys = Object.keys(sfx).filter((k) => typeof sfx[k] === 'function');
  const threw = [];
  for (const k of keys) { try { sfx[k](); } catch (e) { threw.push(k + ': ' + e.message); } }
  return { keys, threw };
});
console.log('sfx keys:', J(s.keys));
check(['build', 'purchase', 'error', 'achievement', 'click', 'delivery'].every((k) => s.keys.includes(k)), 'sfx exposes build/purchase/error/achievement/click/delivery');
check(s.threw.length === 0, `every sfx.*() call is error free (${J(s.threw)})`);

// ---- 2. particle bursts: 25 bursts spawn, the real animate() loop removes them all
const b0 = await ev(() => {
  const count = () => { let n = 0; scene.traverse(() => n++); return n; };
  window.__count = count;
  const before = { children: count(), bursts: particleBursts.length };
  for (let i = 0; i < 25; i++) spawnBurst(new THREE.Vector3(0, 0, 0), 0xffd479);
  return { before, during: { children: count(), bursts: particleBursts.length } };
});
check(b0.during.bursts === b0.before.bursts + 25 && b0.during.children > b0.before.children, `25 bursts add particles to the array and the scene (${J(b0)})`);
const cleaned = await page.waitForFunction((n) => particleBursts.length <= n, b0.before.bursts, { timeout: 40000, polling: 'raf' }).then(() => true, () => false);
const b1 = await ev(() => ({ children: window.__count(), bursts: particleBursts.length }));
check(cleaned && b1.bursts === b0.before.bursts, `the animate() loop expires every burst (${b1.bursts} left, baseline ${b0.before.bursts})`);
check(b1.children === b0.before.children, `scene child count returns to baseline after the bursts (${b1.children} vs ${b0.before.children})`);

// ---- 3. camera shake applies a non-zero offset and decays to exactly zero
const shake = await ev(() => new Promise((resolve) => {
  let maxOff = 0, frames = 0, started = false;
  triggerShake(0.5, 0.3);
  const t0 = performance.now();
  const step = () => {
    frames++;
    maxOff = Math.max(maxOff, shakeOffset.length());
    if (shakeTime <= 0 && frames > 2) {
      // one more frame so animate() has run its `else` branch that zeroes the offset
      requestAnimationFrame(() => requestAnimationFrame(() => resolve({ maxOff, frames, shakeTime, off: shakeOffset.length(), ms: performance.now() - t0 })));
      return;
    }
    if (performance.now() - t0 > 30000) { resolve({ timeout: true, maxOff, frames, shakeTime, off: shakeOffset.length() }); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}));
console.log('shake:', J(shake));
check(!shake.timeout && shake.maxOff > 0, `triggerShake applies a non-zero camera offset (max ${shake.maxOff})`);
check(!shake.timeout && shake.shakeTime <= 0 && shake.off === 0, `shake decays: shakeTime ${shake.shakeTime}, final offset ${shake.off}`);

// ---- 4. mute button flips `muted`, persists under MUTE_KEY, sfx while muted does not throw, second click restores
const m = await ev(() => {
  const btn = document.getElementById('muteBtn'); const before = muted;
  btn.click(); const a = { muted, stored: localStorage.getItem(MUTE_KEY) };
  let mutedThrew = null; try { sfx.build(); sfx.error(); } catch (e) { mutedThrew = e.message; }
  btn.click(); const b = { muted, stored: localStorage.getItem(MUTE_KEY) };
  return { has: !!btn, before, a, b, mutedThrew };
});
check(m.has && m.a.muted === !m.before && m.a.stored === (m.a.muted ? '1' : '0'), `#muteBtn toggles muted and persists it (${J(m)})`);
check(m.b.muted === m.before && m.b.stored === (m.before ? '1' : '0') && !m.mutedThrew, 'second click restores the state; sfx while muted does not throw');

// ---- 5. a road section (v122/v123: the manual-road pad builds the road in paid sections) keeps its juice:
//         burst + shake + sfx.build. The player has to stand at the section frontier.
const road = await ev(() => {
  money = 1e6; purchaseCurrentPad();
  const b = buildings.find((x) => Number.isInteger(x?.index) && !manualRoadStagesV116.has(x.index));
  if (!b) return { none: true };
  const pos = roadBuildPadPosV122(b.index); player.position.set(pos.x, 0, pos.z);
  let builds = 0; const orig = sfx.build; sfx.build = (...a) => { builds++; return orig.apply(sfx, a); };
  const bursts = particleBursts.length; shakeTime = 0; shakeStrength = 0;
  const built = buildManualRoadStageV116(b.index, pos);
  sfx.build = orig;
  return { idx: b.index, built, burstsDelta: particleBursts.length - bursts, shakeTime, shakeStrength, builds };
});
check(!road.none && road.built === true && road.burstsDelta >= 1 && road.shakeTime > 0 && road.shakeStrength > 0 && road.builds >= 1, `road section build: particle burst, camera shake and sfx.build (${J(road)})`);

check(g.errors.length === 0, `0 console errors (${J(g.errors.slice(0, 3))})`);
await g.close();
