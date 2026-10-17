// Снимок существующего мира v161 (замер 2026-10-11: tycoon-v161.html, сейв stage 16, один запуск, только чтение). Пишет existing.json.
import fs from 'node:fs';
const stages = [
  ['House', 'Дом', 7, 0, 9.7, 0], ['Second House', 'Второй дом', 6.75, 9.44, 8.32, 11.63], ['Shop', 'Магазин', -5.24, 15.33, -6.11, 17.89],
  ['Warehouse', 'Склад', -19.92, 5.98, -22.51, 6.76], ['Mini Factory', 'Мини-завод', -20.09, -15.54, -22.23, -17.19], ['Factory', 'Завод', 1.13, -29.98, 1.23, -32.68],
  ['Office', 'Офис', 28.88, -19.05, 31.13, -20.54], ['Business Center', 'Бизнес-центр', 36.59, 14.06, 39.11, 15.03], ['Skyscraper', 'Небоскрёб', 11.01, 42.39, 11.68, 45.01],
  ['Empire', 'Империя', -31.03, 37.14, -32.76, 39.21], ['Logistics Terminal', 'Логистический терминал', 58.03, 24.53, 62.63, 26.48], ['Research Center', 'Исследовательский центр', 27.45, 56.71, 29.28, 60.49],
  ['Grand Hotel', 'Гранд-отель', -14.31, 61.35, -15.27, 65.44], ['Technology Park', 'Технопарк', -51.22, 36.69, -54.63, 39.13], ['Convention Center', 'Конгресс-центр', -47.84, -40.99, -51.03, -43.72],
  ['Financial District', 'Финансовый квартал', 34.93, -52.43, 37.25, -55.93]];
const costs = [50, 125, 320, 700, 1450, 3800, 8500, 20000, 48000, 110000, 140000, 210000, 330000, 520000, 800000, 1250000];
const ex = {
  _about: 'Замер живой сцены v161 (stage 16, все постройки), tycoon-v161.html. Метры мира, x на восток, z на юг. Только чтение; менять только пересъёмкой.',
  ground: { half: 70, shoreRing: [69.3, 71.4], waterRing: [71.4, 92.4], hills: [76, 89], skylineBoxes: [78, 88], fog: [42, 128.6], camMaxDist: 20, camMinDist: 3.5, fov: 55, far: 500, dpr: 0.95 },
  budget: { drawCallsLate: 402, trianglesLate: 122574, meshesLate: 3418, meshesVisible: 3219, geometries: 1631, textures: 26, note: 'свифтшейдер, 390x664, stage 16 L5, все постройки; dpr 0.95' },
  hub: [0, 0], spawn: [-2.66, -0.49],
  masterGrid: [[[-18, -16], [18, -16], 1.72], [[-18, 16], [18, 16], 1.72], [[-18, -16], [-18, 16], 1.66], [[18, -16], [18, 16], 1.66], [[0, -16], [0, 16], 1.82], [[-18, 0], [18, 0], 1.82]],
  stages: stages.map((s, i) => ({ i, en: s[0], ru: s[1], pad: [s[2], s[3]], bld: [s[4], s[5]], cost: costs[i], ring63: i >= 10 })),
  districts: [
    { id: 'suburb', ru: 'Жилой район', hub: [-46, -34], unlockRep: 0, tier: 0, arterial: { hint: [-15.8, -18.4], bends: [[-29, -26]] } },
    { id: 'industrial', ru: 'Промзона', hub: [43, -35], unlockRep: 25, tier: 2, arterial: { hint: [24.7, -20.7], bends: [[34, -27]] } },
    { id: 'business', ru: 'Деловой центр', hub: [45, 34], unlockRep: 60, tier: 3, arterial: { hint: [30.45, 20.86], bends: [] } },
    { id: 'waterfront', ru: 'Набережная', hub: [-42, 38], unlockRep: 120, tier: 4, arterial: { hint: [-25, 38], bends: [[-37, 32], [-28.5, 33.5]] } }],
  industrial: {
    sawmill: [-51, -7.7], generator: [-42.3, -3.8], concrete: [-44.1, -10.3], metal: [-39.3, -10.6], depotPad: [-40.7, 3.4], planksBay: [-49.6, -3.2],
    fleetYard: { x0: -46.66, x1: -34.74, z0: 4.86, z1: 10.62 }, serviceRoads: { x0: -48.4, x1: 0.05, z0: -8.04, z1: 4.5 } },
  market: { center: [14, -16], stallRing: 4.6 },
  infra: { power: [-12, 52], water: [0, 52] },
  ringRoad: { r0: 54.6, r1: 60.2, mid: 57.4, visibleFromRoadLevels: 8, width: 5.6 },
  plotRing: [65.1, 67.9], pocketPark: [17.3, -30.2],
  vehicles: { car: [1.4, 0.65, 2.14], truck: [1.15, 1.28, 2.11], truckLength: 2.2, house: [4, 5], lane: [1.5, 2.0] },
  signatures: { fresh_depot_sawmill: '17/678830722', fresh_all_built_service: '47/-510574045', OLD_SAVE: '51/648310607' }
};
fs.writeFileSync(new URL('./existing.json', import.meta.url), JSON.stringify(ex, null, 1));
console.log('existing.json', JSON.stringify(ex).length, 'bytes');
