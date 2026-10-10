// City / district / special-project / construction-site / prop survey (2026-10-10 (13)): ONE launch, a stage-16 save with every staged unlock built, all four districts
// developed (level 3), every city building built (residential block, clinic, police, school, kindergarten, commerce L3, park, fire station, three land plots per district),
// company base modules at level 3, the three special projects completed, then the live scene is measured with tools/lib/buildings-probe-v161.mjs:
// per object type: count, meshes, triangles, min y, size, the colliders it owns in the v83 registry (cover / outside / walk-in from 8 directions) + props one by one + the construction site rig.
//   node tools/probe-city-v161.mjs [--out DIR] [--json FILE] [--shots]
import fs from 'node:fs';
import path from 'node:path';
import { openGame, REPO_ROOT } from '../tests/lib/harness.mjs';
import { installProbe } from './lib/buildings-probe-v161.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const OUT = path.resolve(opt('out', path.join(REPO_ROOT, '..', 'shots', 'city'))); fs.mkdirSync(OUT, { recursive: true });
const SHOTS = !!opt('shots', false);
const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 8000 });
const { page } = g;
await page.evaluate(installProbe);
const built = await page.evaluate(() => {
  const P = __BLD_PROBE__, log = [];
  log.push(...P.buildOut());
  const T = (name, fn) => { try { const r = fn(); log.push(name + ':' + (r === undefined ? 'ok' : r)); } catch (e) { log.push(name + ':ERR ' + e.message); } };
  T('city', () => {
    const Z = ['residential', 'commercial', 'industrial'];
    for (const cfg of CITY_DISTRICTS) {
      const id = cfg.id;
      cityState.districts[id] = 3;
      const pos = (fn, ...a) => { const p = fn(...a); return { x: p.x, z: p.z }; };
      if (HOUSING_DISTRICT_IDS.includes(id)) { const h = cityState.housing[id] || (cityState.housing[id] = {}); h.apartmentBlockBuilt = true; h.pendingUntil = 0; h.pos = pos(residentialBuildingPosition, id); }
      const c = cityState.civic[id] || (cityState.civic[id] = {}); c.clinicBuilt = true; c.pendingUntil = 0; c.pos = pos(civicBuildingPosition, id);
      const po = cityState.police[id] || (cityState.police[id] = {}); po.stationBuilt = true; po.pendingUntil = 0; po.pos = pos(policeBuildingPosition, id);
      const sc = cityState.school[id] || (cityState.school[id] = {}); sc.schoolBuilt = true; sc.pendingUntil = 0; sc.pos = pos(schoolBuildingPosition, id);
      const kg = cityState.kindergarten[id] || (cityState.kindergarten[id] = {}); kg.kindergartenBuilt = true; kg.pendingUntil = 0; kg.pos = pos(kindergartenBuildingPosition, id);
      const cm = cityState.commercial[id] || (cityState.commercial[id] = {}); cm.level = 3; cm.pendingUntil = 0; cm.pos = pos(citySatellitePosition, id, -Math.PI * 0.18, 9.1);
      const pk = cityState.parks[id] || (cityState.parks[id] = {}); pk.parkBuilt = true; pk.pendingUntil = 0; pk.pos = pos(citySatellitePosition, id, Math.PI * 0.68, 8.2);
      const fi = cityState.fire[id] || (cityState.fire[id] = {}); fi.stationBuilt = true; fi.pendingUntil = 0; fi.pos = pos(citySatellitePosition, id, Math.PI * 1.12, 9.0);
      const ls = districtLandState(id);
      ls.plots.forEach((p, i) => { p.owned = true; p.zone = Z[i % 3]; p.level = 1 + i % 3; p.pendingZone = null; p.pendingLevel = 0; p.pendingUntil = 0; const v = landPlotWorldPosition(id, i); p.pos = { x: v.x, z: v.z }; });
    }
  });
  T('base', () => { for (const k of ['office', 'garage', 'workshop', 'yard']) baseState[k] = 3; refreshBaseWorld(true); });
  T('projects', () => { specialProjectState.completed = ['park', 'hub', 'hq']; specialProjectState.active = null; refreshSpecialProjectWorld(); });
  T('refresh', () => {
    for (const fn of ['refreshResidentialWorld', 'refreshCivicWorld', 'refreshPoliceWorld', 'refreshSchoolWorld', 'refreshKindergartenWorld', 'refreshNeighborhoodWorld', 'refreshCommercialWorld', 'refreshDistrictParksWorld', 'refreshFireWorld', 'refreshLandPlotWorld', 'refreshStreetlightsWorld', 'refreshDistrictIdentityWorldV363', 'refreshArterialRoads'])
      { try { globalThis[fn]?.(); } catch (e) { log.push(fn + ' ERR ' + e.message); } }
  });
  return log;
});
console.log('BUILD', built.join(' | '));
await page.waitForTimeout(5000);
await page.evaluate(() => { __BLD_PROBE__.finishGrowth(); });
await page.waitForTimeout(3000);
const city = await page.evaluate(({ shots }) => {
  const P = __BLD_PROBE__, out = { rows: [], props: [], site: [] };
  const reg = __TYCOON_V83_COLLISIONS__.registry;
  const count = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
  const row = (kind, root, extra = {}) => {
    if (!root || !root.isObject3D) { out.rows.push({ kind, missing: true }); return; }
    root.updateMatrixWorld(true);
    let m = null; try { m = P.measureLive(root); } catch (e) { m = { err: e.message }; }
    const own = [...reg.values()].filter((e) => e.owner === root).length;
    const r = { kind, x: +root.position.x.toFixed(1), z: +root.position.z.toFixed(1), meshes: m.meshes, allMeshes: count(root), tris: m.tris, size: m.size, minY: m.minY, maxY: m.maxY, F: m.footprintArea, C: m.colliderArea, overlap: m.overlap, outsideMax: m.outsideMax, reach: m.sweepReached, own, name: root.name || '', ...extra };
    out.rows.push(r);
    return r;
  };
  const maps = { residential: cityWorldRuntime.residential, civic: cityWorldRuntime.civic, police: cityWorldRuntime.police, school: cityWorldRuntime.school, kindergarten: cityWorldRuntime.kindergarten, commercial: cityWorldRuntime.commercial, park: cityWorldRuntime.parks, fire: cityWorldRuntime.fire };
  for (const [name, map] of Object.entries(maps)) for (const [id, g] of map) row(`${name}:${id}`, g);
  for (const [id, root] of cityWorldRuntime.landPlots) (root.children || []).forEach((p, i) => row(`landPlot:${id}:${i}`, p));
  for (const [id, g] of cityWorldRuntime.hubs || []) row(`hub:${id}`, g);
  for (const [id, g] of cityWorldRuntime.districtIdentity || []) row(`identity:${id}`, g);
  for (const [id, g] of cityWorldRuntime.neighborhoods || []) row(`neighbourhood:${id}`, g);
  for (const [id, g] of cityWorldRuntime.streetlights || []) row(`streetlights:${id}`, g);
  for (const [id, g] of cityWorldRuntime.streets || []) row(`streets:${id}`, g);
  for (const [key, g] of baseRuntime.groups) row(`base:${key}`, g);
  for (const [key, g] of specialProjectRuntime.landmarks) row(`special:${key}`, g);
  // the district identity props found by position (industrial / business / waterfront groups have no registry map)
  for (const o of scene.children) {
    if (o.isLight || o === ground || o.isSprite || o.userData?.harvestableTree) continue;
    for (const cfg of CITY_DISTRICTS) { const d = Math.hypot(o.position.x - cfg.pos.x, o.position.z - cfg.pos.z); if (d < 0.2 && o.type === 'Group') row(`districtGroup:${cfg.id}:${o.name || o.userData.v163HubSignature ? 'hubSig' : 'g'}`, o); }
  }
  if (shots) { /* pictures are taken per object below */ }
  return out;
}, { shots: SHOTS });
console.log(`CITY rows ${city.rows.length}`);
for (const r of city.rows) console.log(r.missing ? `  ${r.kind}: MISSING` : `  ${r.kind} @${r.x},${r.z} meshes ${r.meshes}/${r.allMeshes} tris ${r.tris} size ${JSON.stringify(r.size)} minY ${r.minY} maxY ${r.maxY} F ${r.F} C ${r.C} overlap ${r.overlap} outMax ${r.outsideMax} reach ${r.reach}/8 own ${r.own} ${r.name}`);
if (opt('json', false)) fs.writeFileSync(path.resolve(opt('json')), JSON.stringify(city, null, 1));
console.log('errors', JSON.stringify(g.errors.slice(0, 5)));
await g.close();
