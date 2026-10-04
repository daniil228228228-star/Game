/* District hub pads: guidance + "infrastructure first" prompt (v161 layer, CHANGELOG_V161.md "Район 2 и 3: кружки").
 *
 * The district hub itself is already a ground pad in v161 (nearestManualTargetV53 'district' candidate, shown once
 * districtUnlocked(cfg) = reputation + company tier, price districtUpgradeCost, press -> upgradeCityDistrict) and the
 * infra pads live in district-infra-v161.js. What was missing:
 *   1. nextActionableTargetV117() never returned the hub pad, so the compass / ground arrow / world marker did not lead
 *      to "open district 2/3" (the chain ended in null or in a tree).
 *   2. a district at level >= 1 only expands once its CURRENT tier is serviced (v41 wrapper of upgradeCityDistrict:
 *      road + light + power + water at that level); the hub pad still said "Develop" and then only toasted.
 * No economy, no save field, no new rendering: two pure helpers read by tycoon-v161.html
 * (nextActionableTargetV117 step 4 and the 'district' branch of the manual prompt, grep "V161" near those).
 * Loaded after district-infra-v161.js.
 */
(function () {
  'use strict';
  if (typeof CITY_DISTRICTS === 'undefined' || typeof districtUnlocked !== 'function') return;

  // 0 = nothing blocks the upgrade, else the district level L whose roads/light/power/water must be finished first
  // (exactly the condition of the v38/v41 wrapper of upgradeCityDistrict).
  window.districtInfraNeedV161 = function (cfg) {
    try {
      const lv = districtLevel(cfg.id);
      if (lv <= 0) return 0;
      return (infrastructureReadyV38(cfg.id) && utilitiesReadyV41(cfg.id)) ? 0 : lv;
    } catch (_) { return 0; }
  };

  // Guidance target for the first district whose hub pad can really be bought right now: unlocked, below level 3,
  // infrastructure done, affordable. From stage 3 on (same gate as the v35 "open the first district" quest).
  window.districtGuideTargetV161 = function () {
    try {
      if (stageIndex < 3) return null;
      for (const cfg of CITY_DISTRICTS) {
        if (!districtUnlocked(cfg) || districtLevel(cfg.id) >= 3) continue;
        if (window.districtInfraNeedV161(cfg)) continue;
        if (!canPayResources(districtUpgradeCost(cfg))) continue;
        const open = districtLevel(cfg.id) === 0;
        const name = lang === 'ru' ? cfg.ru : cfg.en;
        return { pos: cfg.pos.clone(), label: (open ? (lang === 'ru' ? 'Открыть: ' : 'Open: ') : (lang === 'ru' ? 'Развить: ' : 'Develop: ')) + name, type: 'district', districtId: cfg.id };
      }
    } catch (_) { /* guidance must never throw */ }
    return null;
  };
})();
