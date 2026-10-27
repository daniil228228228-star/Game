/* Game feel / guidance helper (v161 layer, CHANGELOG_V161.md "ROADMAP 5: игровое ощущение").
 *
 * One function, no panels, no new state, no save field:
 *   hintNextStepV161()  -- after the player buys a district hub level, a district infrastructure pad, the Frame Workshop or a
 *                          production level, ONE short toast says what the next step is ("Дальше: Освещение L1 · 12 м" when it is
 *                          affordable and the compass already leads to it, "Дальше: ... · <price>" when it is not). It goes through the
 *                          existing toast channel only, 1.9 s after the purchase (the purchase's own toast lasts 1.8 s, a second toast
 *                          at the same instant would replace it), at most once per 8 s and never stacked (one pending timer).
 * Callers (tycoon-v161.html, grep hintNextStepV161): buildIndustrialStepV118 (infra / chain / level pads), upgradeCityDistrict.
 * Loaded last, after traffic-v161.js.
 */
(function () {
  'use strict';
  if (typeof INDUSTRIAL_BUILD_STEPS_V118 === 'undefined' || typeof nextActionableTargetV117 !== 'function') return;
  let timer = 0, lastAt = -1e9;

  function costText(cost) {
    try { return typeof opsCostText === 'function' ? opsCostText(cost) : ''; } catch (_) { return ''; }
  }
  // Text of the hint, '' when there is nothing sensible to say.
  function hintText() {
    const ru = lang === 'ru', next = ru ? 'Дальше' : 'Next';
    const t = nextActionableTargetV117(); // the same target the compass / ground arrow lead to
    if (t && t.pos) {
      const m = Math.round(Math.hypot(t.pos.x - player.position.x, t.pos.z - player.position.z));
      return `${next}: ${t.label} · ${m} ${ru ? 'м' : 'm'}`;
    }
    // nothing affordable: name the nearest pad that is open but not paid for yet, with its price
    let best = null, bestD = Infinity;
    for (const s of INDUSTRIAL_BUILD_STEPS_V118) {
      try {
        if (s.built() || !s.prereq()) continue;
        const d = Math.hypot(s.pos.x - player.position.x, s.pos.z - player.position.z);
        if (d < bestD) { bestD = d; best = s; }
      } catch (_) { /* a broken step must not break the hint */ }
    }
    if (!best) return '';
    const price = costText(best.cost);
    return `${next}: ${ru ? best.ru : best.en}${price ? ' · ' + price : ''}`;
  }

  window.hintNextStepV161 = function () {
    const now = performance.now();
    if (timer || now - lastAt < 8000) return false;
    timer = setTimeout(() => {
      timer = 0;
      try {
        const text = hintText();
        if (!text) return;
        lastAt = performance.now();
        toast(text);
      } catch (_) { /* a hint is optional */ }
    }, 1900);
    return true;
  };
  window.__TYCOON_FEEL_V161__ = { hintText };
})();
