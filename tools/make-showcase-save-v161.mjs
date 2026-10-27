// Builds tools/showcase-save-v161.json: a save of a fully built city (stage 16, every main building at level 10, the whole masterplan B01-B14,
// every district at level 3 with roads / lights / power / water / civic buildings / commerce, both utility plants), made by driving the REAL game
// with the same functions the city panel calls (so every world object and every save field is the game's own).
//   node tools/make-showcase-save-v161.mjs        (~5 min under SwiftShader; pending timers are waited out in real time)
// tools/build-variants-v161.mjs embeds the result into the "everything built" build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from '../tests/lib/harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 10 })) };
const g = await openGame({ save: SEED, waitMs: 9000 });
const ev = (fn, a) => g.page.evaluate(fn, a);
try {
  const ALL = Object.fromEntries(Array.from({ length: 14 }, (_, i) => ['B' + String(i + 1).padStart(2, '0'), true]));
  await ev((all) => { restoreMasterplanV161(all); MasterplanV161.refresh(); }, ALL);
  let last = '';
  let same = 0;
  for (let round = 0; round < 45; round++) {
    const state = await ev(() => {
      money = 1e12; planks = 5000; concrete = 500; metal = 500; cityState.reputation = Math.max(cityState.reputation, 1000);
      const ids = CITY_DISTRICTS.map((c) => c.id), tried = [];
      const t = (name, fn) => { try { fn(); } catch (e) { tried.push(name + ':' + String(e).slice(0, 60)); } };
      for (const id of ids) {
        t('district', () => upgradeCityDistrict(id));
        t('roads', () => buildDistrictRoads(id));
        t('light', () => buildStreetlights(id));
        t('power', () => window.__TYCOON_V41__.buildPower(id));
        t('water', () => window.__TYCOON_V41__.buildWater(id));
        t('housing', () => buildResidentialBlock(id));
        t('civic', () => buildCivicBuilding(id));
        t('police', () => buildPoliceStation(id));
        t('school', () => buildSchool(id));
        t('kindergarten', () => buildKindergarten(id));
        t('commercial', () => buildCommercial(id));
        t('park', () => buildDistrictPark(id));
        t('fire', () => buildFireStation(id));
      }
      t('plantP', () => window.__TYCOON_V42__.plant('power'));
      t('plantW', () => window.__TYCOON_V42__.plant('water'));
      return JSON.stringify({
        districts: ids.map((id) => districtLevel(id)), roads: ids.map((id) => districtRoadLevelV37(id)), lights: ids.map((id) => districtStreetlightLevelV37(id)),
        power: ids.map((id) => window.__TYCOON_V41__.power(id)), water: ids.map((id) => window.__TYCOON_V41__.water(id)),
        infra: ids.map((id) => districtInfrastructureCount(id)), commerce: ids.map((id) => commercialLevel(id)),
        plants: [window.__TYCOON_V42__.state.powerPlantLevel, window.__TYCOON_V42__.state.waterPlantLevel],
        housing: Object.values(cityState.housing).map((h) => h.apartmentBlockBuilt ? 1 : 0),
        errors: tried.slice(0, 4),
      });
    });
    console.log('round', round, state);
    await g.page.waitForTimeout(7000);
    same = state === last ? same + 1 : 0;
    if (same >= 5) break;   // nothing changed for five rounds (35 s): everything the game allows is built
    last = state;
  }
  await ev(() => { money = 5e8; planks = 5000; concrete = 500; metal = 500; player.position.set(0, 0, 8); save.flush(); });
  await g.page.waitForTimeout(1500);
  const keys = await ev(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('tycoon3d')) o[k] = localStorage.getItem(k); } return o; });
  const saved = JSON.parse(keys.tycoon3d_save_v3);
  console.log('saved keys', Object.keys(keys), 'stage', saved.stageIndex, 'masterplan', JSON.stringify(saved.masterplanV161), 'buildings', saved.buildings?.length, 'levels', saved.buildings?.map((b) => b.level).join(','));
  fs.writeFileSync(path.join(ROOT, 'tools/showcase-save-v161.json'), JSON.stringify(keys));
  console.log('bytes', JSON.stringify(keys).length, 'errors', JSON.stringify(g.errors.slice(0, 3)));
} finally { await g.close(); }
