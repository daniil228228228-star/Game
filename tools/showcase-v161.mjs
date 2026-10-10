// Showcase + physics audit for every building the player can see (2026-10-05 (4), docs/BUILDINGS_V161.md is the catalogue this feeds).
//   node tools/showcase-v161.mjs [--stages 0,1,..|all] [--levels 1,5,10] [--house-levels 1-10] [--views front,side,top,iso] [--other-views iso]
//                                [--survey] [--survey-shots N] [--out DIR] [--tag base] [--json FILE]
//   node tools/showcase-v161.mjs --plants [--plant-levels 1,3] [--plant-views front,iso] [--plant-only sawmill,concrete,metal,frame]   (2026-10-05 (6), family #2)
//     the late-game world is built out, then every industrial plant (sawmill, concrete plant, metal yard, frame workshop) is shown at every level in a LIVE mid-cycle pose
//     (timers set, one synchronous update, one shot) next to the OLD builder of the same plant (PlantsV161.enabled = false; the sawmill has no old version): PHYSICS
//     numbers (meshes, draw calls, triangles, min y, collider overlap/outside/walk-in) and DIR/<tag>-plant-<id>-L<n>-<view>.jpg (+ -old-).
//   node tools/showcase-v161.mjs --market [--market-views front,iso] [--market-only team,exchange] [--market-no-old]   (2026-10-05 (7), family #3)
//     the late-game world is built out, then the whole market is shot (plaza overview from above / from the gate / street level, each stall front + iso, one vacant lot) first with
//     the OLD plaza and stalls (MarketV161.enabled = false, rebuilt through the game's own buildMarketPlazaV116) and then with the new ones; numbers for the whole market
//     (meshes, draw calls in an overview frame, triangles) and per object (min y, collider cover, walk-in from 8 directions): DIR/<tag>-market-<id>-<view>.jpg (+ -old-).
//   node tools/showcase-v161.mjs --shop [--shop-levels 1,2,3,4,5,6,10] [--shop-views front,iso,side,top] [--shop-no-old] [--suburb] [--suburb-views ...]   (2026-10-05 (8), backlog #4 + #5)
//     --shop: the main-line shop (STAGES[2]) built by the real chain at every listed level, old builder (ShopV161.enabled = false) and new, numbers (meshes, draw calls, triangles, min y, collider cover /
//     outside / walk-in from 8 directions, door vs driveway) and DIR/<tag>-shop-L<n>-<view>.jpg (+ -old-). --suburb: the late-game world is built out, the suburb district identity group (lawn, trees,
//     planters, ring of mini houses) is rebuilt with the old and the new builders (BuildingsV161.enabled) and shot from above / low / one house of every variant: DIR/<tag>-suburb-*.jpg.
//   node tools/showcase-v161.mjs --factory [--factory-levels 1,3,5,6,10] [--factory-stages 4,5,13] [--factory-views front,iso,side] [--factory-no-old]   (2026-10-06 (10), backlog #7)
//     the three main-line factories (STAGES 4 / 5 / 13) built by the real chain, old builder (FactoryV161.enabled = false) and new: meshes, draw calls, triangles, height, min y, collider cover / outside / walk-in,
//     door vs driveway, pad distance; DIR/<tag>-factory<stage>-L<n>-<view>.jpg (+ -old-).
//   node tools/showcase-v161.mjs --fleet [--fleet-views front,iso,top,low]   (2026-10-06 (10), backlog #8)
//     the late-game world is built out, the fleet yard (v116FleetYard + the parked trucks) is rebuilt through the game's own rebuildParkingV65 with the old / the new builder (FleetYardV161.enabled) and shot from the lane side
//     (front, iso, low) and from above: meshes, draw calls in one frame, triangles, min y, DIR/<tag>-fleet-<view>.jpg (+ -old-).
//   node tools/showcase-v161.mjs --office [--office-levels 1,3,5,6,10] [--office-stages 6,7,11,14] [--office-views front,iso,side] [--office-no-old] [--night]   (2026-10-06 (11), backlog #10)
//   node tools/showcase-v161.mjs --tower  [--tower-levels 1,3,5,6,10]  [--tower-stages 8,9,12,15]  [--tower-views front,iso,side]  [--tower-no-old]  [--night]   (2026-10-06 (11), backlog #11)
//     the main-line offices / towers built by the real chain, old builder (OfficeTowerV161.enabled = false) and new: meshes, draw calls, triangles, height, min y, collider cover / outside / walk-in, door vs driveway, pad distance;
//     DIR/<tag>-office<stage>-L<n>-<view>.jpg / -tower<stage>-... (+ -old-); --night also writes -night-iso (the shared window material set to its night value for one shot).
//   node tools/showcase-v161.mjs --infra | --city | --site | --props [--out DIR]   (2026-10-10 (13), power plant + water works, district identities, construction site, props)
//     any of the four flags runs tests/infra-city.test.mjs with SHOTS_DIR=DIR (one launch of its own: the numbers AND the pictures): DIR/plant-<power|water>-<L1|L2|L3|pending>-<iso|front>.jpg, district-<id>-<L1|L3>-<iso|top>.jpg,
//     site-<house|factory|tower>-p<0|2|4>-iso.jpg, props-cluster-iso.jpg, props-stop-<district>-iso.jpg. Nothing else of this tool runs.
//   node tools/showcase-v161.mjs --yards [--out DIR]   (2026-10-10 (12), loading yards)
//     runs tests/loading-yards.test.mjs with SHOTS_DIR=DIR (one launch of its own: the numbers AND the pictures): each loading yard (planks / concrete / metal) with stock 12 and a truck in its bay,
//     from above and from an angle, plus the whole industrial zone: DIR/yards-<zone|planks|concrete|metal>_<top|iso|side>.jpg. Nothing else of this tool runs.
// ONE browser launch per run. Stage buildings (all 16 STAGES) are built by the game's real builder chain (createBuildingMesh: BUILDERS + polish layers +
// v44 + v157 + late-game gold tiers), put alone on the grass (everything else in the scene is hidden for the shot), registered in the real v83 collision
// registry with the call rebuildStatic uses, and shot from four fixed cameras at the phone viewport 390x664: DIR/bld-<id>-L<n>-<view>.jpg.
// `--survey` first builds the late-game world (every staged unlock built, all districts) and lists every structure group and every registry collider,
// then measures + shoots the ones found. PHYSICS REPORT per building: collider list vs footprint (overlap, uncovered m2, collider m2 outside the mesh,
// farthest outside distance), min/max y (floating/sunk), swept player test from 8 directions, door vs driveway, meshes / geometries / draw calls.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, REPO_ROOT } from '../tests/lib/harness.mjs';
import { installProbe } from './lib/buildings-probe-v161.mjs';

const args = process.argv.slice(2);
if (['--infra', '--city', '--site', '--props'].some((f) => args.includes(f))) {   // plants / district identities / construction site / props: the pictures come from tests/infra-city.test.mjs (one launch with the numbers)
  const { spawnSync } = await import('node:child_process');
  const oi = args.indexOf('--out'); const out = path.resolve(oi >= 0 ? args[oi + 1] : path.join(REPO_ROOT, '..', 'shots'));
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tests', 'infra-city.test.mjs')], { env: { ...process.env, SHOTS_DIR: out }, stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
if (args.includes('--yards')) {   // the yard pictures come from the yards test (same launch as its numbers); no second browser here
  const { spawnSync } = await import('node:child_process');
  const oi = args.indexOf('--out'); const out = path.resolve(oi >= 0 ? args[oi + 1] : path.join(REPO_ROOT, '..', 'shots'));
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tests', 'loading-yards.test.mjs')], { env: { ...process.env, SHOTS_DIR: out }, stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const parseList = (s, all) => (s === 'all' || s === undefined ? all : String(s).split(',').flatMap((x) => { const m = /^(\d+)-(\d+)$/.exec(x); return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, k) => +m[1] + k) : [+x]; }));
const OUT = path.resolve(opt('out', path.join(REPO_ROOT, '..', 'shots')));
const TAG = opt('tag', 'bld');
const VIEWS = String(opt('views', 'front,side,top,iso')).split(',');
const OTHER_VIEWS = String(opt('other-views', 'iso')).split(',');
const WANT_SURVEY = !!opt('survey', false);
const WANT_PLANTS = !!opt('plants', false);
const WANT_MARKET = !!opt('market', false);
const WANT_SHOP = !!opt('shop', false);
const WANT_SUBURB = !!opt('suburb', false);
const WANT_WH = !!opt('warehouse', false), WANT_TERM = !!opt('terminal', false);
const WANT_FACTORY = !!opt('factory', false), WANT_FLEET = !!opt('fleet', false);
const WANT_OFFICE = !!opt('office', false), WANT_TOWER = !!opt('tower', false);
fs.mkdirSync(OUT, { recursive: true });

const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 8000 });
const { page } = g;
await page.evaluate(installProbe);
const info = await page.evaluate(() => __BLD_PROBE__.stageInfo());
const stages = (WANT_PLANTS || WANT_MARKET || WANT_SHOP || WANT_SUBURB || WANT_WH || WANT_TERM || WANT_FACTORY || WANT_FLEET || WANT_OFFICE || WANT_TOWER) && !opt('stages', false) ? [] : parseList(opt('stages', 'all'), Array.from({ length: info.n }, (_, i) => i));
const levels = parseList(opt('levels', '1,5,10'), [1, 5, 10]);
const houseLevels = parseList(opt('house-levels', '1-10'), Array.from({ length: 10 }, (_, i) => i + 1));
const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
const report = [];

// ------------------------------------------------------------------------------------------------ 2. live survey of the late-game world
let survey = null;
if (WANT_SURVEY) {
  const built = await page.evaluate(() => __BLD_PROBE__.buildOut());
  console.log('BUILD-OUT', built.join(' | '));
  await page.waitForTimeout(4000);
  await page.evaluate(() => __BLD_PROBE__.finishGrowth());
  await page.waitForTimeout(2500);
  survey = await page.evaluate(() => __BLD_PROBE__.survey());
  console.log(`SURVEY groups ${survey.groups.length}, colliders ${survey.colliders.length}`);
  if (opt('verbose', false)) for (const r of survey.groups) console.log(`  G${r.idx} ${r.name || '(unnamed ' + r.type + ')'} @${r.cx},${r.cz} ${r.w}x${r.h}x${r.d} minY ${r.minY} meshes ${r.meshes} tris ${r.tris} vis ${r.visible} ud[${r.ud}]`);
  if (opt('verbose', false)) for (const c of survey.colliders) console.log(`  C ${c.cat} ${c.label} ${c.shape} @${c.x},${c.z} ${c.shape === 'obb' ? `hx ${c.hx} hz ${c.hz} yaw ${c.yaw || 0}` : `r ${c.r}`} [${c.flags}] ${c.owner}`);
  // curated list of what the player sees (names from the survey; the rest of the survey groups are vehicles, props, road layers and pads)
  const G = survey.groups, atPos = (x, z, minMeshes, tol = 0.7) => G.find((r) => Math.abs(r.cx - x) < tol && Math.abs(r.cz - z) < tol && r.meshes >= minMeshes);
  const targets = [
    { id: 'sawmill', name: 'v161SawmillMill' }, { id: 'fleet-yard', name: 'v116FleetYard' }, { id: 'frame-workshop', name: 'v161FrameWorkshop' },
    { id: 'concrete-plant', expr: 'concretePlant.group' }, { id: 'metal-yard', expr: 'metalPlant.group' }, { id: 'market-plaza', name: 'marketPlazaV116' },
    ...['team', 'fleet', 'tenders', 'operations', 'meta', 'bonus', 'exchange'].map((k) => ({ id: 'market-stall-' + k, name: 'marketStallV116_' + k })),
    { id: 'sawmill-badge', name: 'v161LevelBadge_sawmill' },
    { id: 'power-plant', row: atPos(-12, 52, 4, 1.5) }, { id: 'water-works', row: atPos(0, 52, 4, 1.5) },
    { id: 'district-suburb', row: atPos(-44.7, -33.9, 50) }, { id: 'district-industrial', row: atPos(42.9, -35, 10) }, { id: 'district-business', row: atPos(45.1, 34, 30) }, { id: 'district-waterfront', row: atPos(-41.7, 40.8, 50) },
    { id: 'hub-suburb', row: atPos(-46, -34, 6) }, { id: 'hub-industrial', row: atPos(43, -35, 6) }, { id: 'hub-business', row: atPos(45, 34, 6) }, { id: 'hub-waterfront', row: atPos(-42, 38, 6) },
    { id: 'manual-mine-concrete', name: 'manualMineV119_concrete' }, { id: 'manual-mine-metal', name: 'manualMineV119_metal' },
    { id: 'workers-camp-lift', row: atPos(-41.6, 6.6, 20, 1.5) },
  ];
  for (const t of targets) {
    let r = null;
    try { r = await page.evaluate(({ t, idx, views }) => {
      const P = __BLD_PROBE__;
      const root = t.name ? P.liveByName(t.name) : t.expr ? P.liveByExpr(t.expr) : idx >= 0 ? P.roots[idx] : null;
      if (!root || !root.isObject3D) return null;
      const meas = P.measureLive(root);
      const sh = P.shootLive(root, views);
      meas.draw = sh.calls.draw; meas.drawTris = sh.calls.tris;
      return { meas, shots: sh.shots };
    }, { t: { name: t.name, expr: t.expr }, idx: t.row ? t.row.idx : -1, views: OTHER_VIEWS }); } catch (e) { console.log(`  (live target ${t.id} failed: ${String(e.message).split('\n')[0]})`); }
    if (!r) { console.log(`  (live target ${t.id} not found)`); report.push({ id: 'live:' + t.id, arch: 'live', level: 0, missing: true }); continue; }
    for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-live-${t.id}-${v}.jpg`, url);
    report.push({ id: 'live:' + t.id, arch: 'live', level: 0, ...r.meas });
  }
}

// ------------------------------------------------------------------------------------------------ 2b. industrial plants (family #2): live pose + old builder side by side
const plantRows = [];
if (WANT_PLANTS) {
  const built = await page.evaluate(() => __BLD_PROBE__.buildOut());
  console.log('BUILD-OUT', built.join(' | '));
  await page.waitForTimeout(4000);
  await page.evaluate(() => __BLD_PROBE__.finishGrowth());
  await page.waitForTimeout(2500);
  const plantLevels = parseList(opt('plant-levels', '1,2,3'), [1, 2, 3]);
  const plantViews = String(opt('plant-views', 'front,iso')).split(',');
  const only = String(opt('plant-only', 'sawmill,concrete,metal,frame')).split(',');
  for (const kind of only) {
    for (const L of kind === 'frame' ? [1] : plantLevels) {
      for (const old of kind === 'sawmill' ? [false] : [false, true]) {
        const r = await page.evaluate(({ kind, L, old, views }) => {
          const P = __BLD_PROBE__;
          // production level (frame workshop has none); the plants rebuild through the game's own refresh path
          if (kind !== 'frame') { industrialLevelsV161[kind] = L; refreshIndustrialBadgesV161(); }
          const live = {
            sawmill: () => scene.getObjectByName('v161SawmillMill'),
            concrete: () => concretePlant.group, metal: () => metalPlant.group, frame: () => PRODUCTION_CHAIN_V161.prop().group,
          };
          const posOf = { concrete: CONCRETE_PLANT_POS, metal: METAL_YARD_POS };
          let root = live[kind](), entries = null, restore = () => {};
          if (old) {
            // the OLD builder: hide the new group, rebuild the old plant, measure it with the old circle collider the game registered for it
            PlantsV161.enabled = false;
            const was = root; was.visible = false;
            if (kind === 'concrete') { const o = buildConcretePlant(); root = o.group; restore = () => { scene.remove(root); disposeObject3D(root); }; }
            else if (kind === 'metal') { const o = buildMetalYard(); root = o.group; restore = () => { scene.remove(root); disposeObject3D(root); }; }
            else { PRODUCTION_CHAIN_V161.rebuildProp(); root = PRODUCTION_CHAIN_V161.prop().group; restore = () => { PlantsV161.enabled = true; PRODUCTION_CHAIN_V161.rebuildProp(); }; }
            const c = STATIC_COLLIDERS.find((q) => Math.hypot(q.pos.x - root.position.x, q.pos.z - root.position.z) < 0.01);
            entries = c ? [{ shape: 'circle', pos: c.pos, radius: c.radius, label: 'static-circle', flags: { player: true } }] : [];
            restore = ((r0) => () => { r0(); PlantsV161.enabled = true; was.visible = true; })(restore);
            root.updateMatrixWorld(true);
          } else {
            // LIVE pose: the real timers set to a mid-cycle value, then one synchronous update (nothing else runs in between)
            if (kind === 'sawmill') { stageIndex = 16; planks = 7; sawmillAutoTimer = 0.52 * sawmillAutoInterval(); updateSawmillMillV161(0); }
            if (kind === 'concrete') { concrete = 6; concretePlantTimer = 0.9 * concreteInterval(); PlantsV161.updateConcrete(0); }
            if (kind === 'metal') { metal = 7; metalPlantTimer = 0.72 * metalInterval(); PlantsV161.updateMetal(0); }
            if (kind === 'frame') { framesV161 = 5; PlantsV161.updateWorkshop(PRODUCTION_CHAIN_V161.prop(), 0); }
          }
          function concreteInterval() { return CONCRETE_AUTO_INTERVAL / productionSpeedMultiplier() / industrialSpeedV161('concrete'); }
          function metalInterval() { return METAL_AUTO_INTERVAL / productionSpeedMultiplier() / industrialSpeedV161('metal'); }
          try {
            const meas = entries ? P.measure(root, entries) : P.measureLive(root);
            const sh = P.shoot(root, views);
            meas.draw = sh.calls.draw; meas.drawTris = sh.calls.tris;
            return { meas, shots: sh.shots };
          } finally { restore(); }
        }, { kind, L, old, views: plantViews });
        for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-plant-${kind}-L${L}-${old ? 'old-' : ''}${v}.jpg`, url);
        plantRows.push({ id: `${kind}${old ? '-old' : ''}`, arch: 'plant', level: L, ...r.meas });
      }
    }
  }
  // restore the production levels the save started with
  await page.evaluate(() => { for (const k of ['sawmill', 'concrete', 'metal']) industrialLevelsV161[k] = 1; refreshIndustrialBadgesV161(); });
  report.push(...plantRows);
}

// ------------------------------------------------------------------------------------------------ 2c. market (family #3): plaza + 7 stalls + a vacant lot, old and new
const marketRows = [];
if (WANT_MARKET) {
  const built = await page.evaluate(() => __BLD_PROBE__.buildOut());
  console.log('BUILD-OUT', built.join(' | '));
  await page.waitForTimeout(4000);
  await page.evaluate(() => __BLD_PROBE__.finishGrowth());
  await page.waitForTimeout(2500);
  const mviews = String(opt('market-views', 'front,iso')).split(',');
  const only = String(opt('market-only', 'team,fleet,tenders,operations,meta,bonus,exchange')).split(',');
  for (const old of opt('market-no-old', false) ? [false] : [true, false]) {
    const r = await page.evaluate(({ old, mviews, only }) => {
      const P = __BLD_PROBE__, out = { stalls: [], overview: {} };
      // rebuild the market with the old or the new builders through the game's own owner function
      MarketV161.enabled = !old;
      { const pl = scene.getObjectByName('marketPlazaV116'); if (pl) { scene.remove(pl); disposeObject3D(pl); } }
      for (const m of [marketRuntimeV116.stalls, marketRuntimeV116.vacant]) { for (const v of m.values()) { const g = v.group || v; scene.remove(g); disposeObject3D(g); } m.clear(); }
      buildMarketPlazaV116(); __TYCOON_V83_COLLISIONS__.rebuild(); P.forceScan();
      const plaza = scene.getObjectByName('marketPlazaV116'), C = MARKET_PLAZA_CENTER_V116;
      const roots = () => [plaza, ...[...marketRuntimeV116.stalls.values()].map((s) => s.group), ...[...marketRuntimeV116.vacant.values()]];
      const gate = Math.atan2(-C.z, -C.x);
      const target = new THREE.Vector3(C.x, 0.4, C.z);
      const views = { top: { az: 0, el: 1.5, dist: 22 }, gate: { az: Math.PI / 2 - gate + Math.PI / 2 * 0, el: 0.62, dist: 21 }, low: { az: Math.PI / 2 - gate, el: 0.32, dist: 17 }, high: { az: Math.PI / 2 - gate, el: 0.95, dist: 19 } };
      for (const [k, v] of Object.entries(views)) { const o = P.overview(roots(), { target, ...v }); out.overview[k] = { url: o.url, draw: o.draw, tris: o.tris }; }
      out.market = { meshes: roots().reduce((n, r) => { let c = 0; r.traverse((m) => { if (m.isMesh) c++; }); return n + c; }, 0), sprites: roots().reduce((n, r) => { let c = 0; r.traverse((m) => { if (m.isSprite) c++; }); return n + c; }, 0), draw: out.overview.high.draw, tris: out.overview.high.tris };
      out.plaza = (() => { const m = P.measure(plaza, P.ownEntries(plaza)); delete m.colliders; return m; })();
      for (const id of only) {
        const st = marketRuntimeV116.stalls.get(id); if (!st) continue;
        const g = st.group, meas = P.measure(g, P.ownEntries(g), { ascii: true });
        meas.unc = (meas.unc || []).slice(0, 24); delete meas.ascii; delete meas.far;
        const sh = P.shoot(g, mviews, { only: [g] });
        meas.draw = P.overview([g], { target: g.position.clone().add(new THREE.Vector3(0, 1, 0)), az: g.rotation.y, el: 0.4, dist: 7 }).draw;
        out.stalls.push({ id, meas, shots: sh.shots });
      }
      // a vacant lot: take 'meta' out of the built set for one frame
      if (!old) {
        const cfg = marketStallConfig('meta'), keep = stageIndex;
        const g0 = marketRuntimeV116.stalls.get('meta'); scene.remove(g0.group); disposeObject3D(g0.group); marketRuntimeV116.stalls.delete('meta'); marketStallsBuiltV118.delete('meta');
        stageIndex = Math.max(stageIndex, cfg.unlock); refreshMarketStallsV118(); P.forceScan();
        const lot = marketRuntimeV116.vacant.get('meta');
        const meas = P.measure(lot, P.ownEntries(lot)), sh = P.shoot(lot, ['front', 'iso'], { only: [lot, plaza] });
        out.vacant = { meas, shots: sh.shots };
        marketRuntimeV116.vacant.delete('meta'); scene.remove(lot); disposeObject3D(lot); marketStallsBuiltV118.add('meta'); stageIndex = keep; refreshMarketStallsV118(); P.forceScan();
      }
      return out;
    }, { old, mviews, only });
    const tag = old ? 'old-' : '';
    for (const [k, v] of Object.entries(r.overview)) save(`${TAG}-market-${tag}overview-${k}.jpg`, v.url);
    for (const st of r.stalls) { for (const [v, url] of Object.entries(st.shots)) save(`${TAG}-market-${tag}${st.id}-${v}.jpg`, url); delete st.shots; }
    if (r.vacant) { for (const [v, url] of Object.entries(r.vacant.shots)) save(`${TAG}-market-vacant-${v}.jpg`, url); delete r.vacant.shots; }
    console.log(`MARKET ${old ? 'OLD' : 'NEW'}: meshes ${r.market.meshes} + sprites ${r.market.sprites}, draw calls in the overview ${r.market.draw}, triangles ${r.market.tris}; per view draw ${Object.entries(r.overview).map(([k, v]) => k + ':' + v.draw).join(' ')}`);
    marketRows.push({ id: 'plaza' + (old ? '-old' : ''), arch: 'market', level: 0, ...r.plaza });
    for (const st of r.stalls) { marketRows.push({ id: `stall-${st.id}${old ? '-old' : ''}`, arch: 'market', level: 0, ...st.meas }); if (!old && st.meas.unc && st.meas.unc.length) console.log(`  uncovered cells ${st.id}: ${JSON.stringify(st.meas.unc)}`); }
    if (r.vacant) marketRows.push({ id: 'vacant-lot', arch: 'market', level: 0, ...r.vacant.meas });
  }
  report.push(...marketRows);
}


// ------------------------------------------------------------------------------------------------ 2d. shop (backlog #5): stage 2 at every level, old builder and new
const shopRows = [];
if (WANT_SHOP) {
  const shopLevels = parseList(opt('shop-levels', '1,2,3,4,5,6,10'), [1, 2, 3, 4, 5, 6, 10]);
  const shopViews = String(opt('shop-views', 'front,iso')).split(',');
  for (const old of opt('shop-no-old', false) ? [false] : [true, false]) {
    for (const L of shopLevels) {
      const r = await page.evaluate(({ L, old, views }) => {
        const P = __BLD_PROBE__;
        window.ShopV161.enabled = !old;
        const m = P.stageMesh(2, L);
        try {
          P.registerStage(m, 2);
          const meas = P.measure(m, P.ownEntries(m));
          meas.door = P.doorInfo(m, 2);
          meas.gold = m.userData.goldTierV161 || 0;
          meas.yaw = +m.rotation.y.toFixed(3);
          const sh = P.shoot(m, views);
          meas.draw = sh.calls.draw; meas.drawTris = sh.calls.tris;
          return { meas, shots: sh.shots };
        } finally { P.dropMesh(m); window.ShopV161.enabled = true; }
      }, { L, old, views: old ? ['iso'] : shopViews });
      for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-shop-L${L}-${old ? 'old-' : ''}${v}.jpg`, url);
      shopRows.push({ id: `shop${old ? '-old' : ''}`, arch: 'shop', level: L, ...r.meas });
    }
  }
  report.push(...shopRows);
}

// ------------------------------------------------------------------------------------------------ 2f. warehouse (stage 3) + logistics terminal (stage 10), backlog #6: old builder and new at every listed level
const logiRows = [];
for (const [want, stageIdx, tag] of [[WANT_WH, 3, 'warehouse'], [WANT_TERM, 10, 'terminal']]) {
  if (!want) continue;
  const lv = parseList(opt(tag + '-levels', '1,3,5,6,10'), [1, 3, 5, 6, 10]);
  const lviews = String(opt(tag + '-views', 'front,iso,side')).split(',');
  for (const old of opt('logistics-no-old', false) ? [false] : [true, false]) {
    for (const L of lv) {
      const r = await page.evaluate(({ L, old, views, stageIdx }) => {
        const P = __BLD_PROBE__;
        window.LogisticsV161.enabled = !old;
        const m = P.stageMesh(stageIdx, L);
        try {
          P.registerStage(m, stageIdx);
          const meas = P.measure(m, P.ownEntries(m));
          meas.door = P.doorInfo(m, stageIdx);
          meas.gold = m.userData.goldTierV161 || 0;
          meas.yaw = +m.rotation.y.toFixed(3);
          const bp0 = buildingPosition(stageIdx), pp0 = upgradePadPosition(bp0, stageIdx), pp = { x: pp0.x - bp0.x + m.position.x, z: pp0.z - bp0.z + m.position.z }; let dmin = 1e9;
          for (const e of P.ownEntries(m)) { const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, c = Math.cos(e.yaw || 0), s = Math.sin(e.yaw || 0), lx = dx * c - dz * s, lz = dx * s + dz * c; if (e.shape === 'obb') dmin = Math.min(dmin, Math.hypot(lx - Math.max(-e.hx, Math.min(e.hx, lx)), lz - Math.max(-e.hz, Math.min(e.hz, lz)))); else dmin = Math.min(dmin, Math.hypot(dx, dz) - e.radius); }
          meas.padDist = +dmin.toFixed(2);
          const sh = P.shoot(m, views);
          meas.draw = sh.calls.draw; meas.drawTris = sh.calls.tris;
          return { meas, shots: sh.shots };
        } finally { P.dropMesh(m); window.LogisticsV161.enabled = true; }
      }, { L, old, views: old ? ['iso'] : lviews, stageIdx });
      for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-${tag}-L${L}-${old ? 'old-' : ''}${v}.jpg`, url);
      logiRows.push({ id: `${tag}${old ? '-old' : ''}`, arch: 'warehouse', level: L, ...r.meas });
      console.log(`  ${tag}${old ? ' OLD' : ''} L${L}: pad distance to the nearest collider ${r.meas.padDist} m`);
    }
  }
}
report.push(...logiRows);

// ------------------------------------------------------------------------------------------------ 2g. factories (stage 4 / 5 / 13), backlog #7: old builder and new at every listed level
const factoryRows = [];
if (WANT_FACTORY) {
  const fl = parseList(opt('factory-levels', '1,3,5,6,10'), [1, 3, 5, 6, 10]);
  const fviews = String(opt('factory-views', 'front,iso,side')).split(',');
  for (const stageIdx of parseList(opt('factory-stages', '4,5,13'), [4, 5, 13])) {
    for (const old of opt('factory-no-old', false) ? [false] : [true, false]) {
      for (const L of fl) {
        const r = await page.evaluate(({ L, old, views, stageIdx }) => {
          const P = __BLD_PROBE__;
          window.FactoryV161.enabled = !old;
          const m = P.stageMesh(stageIdx, L);
          try {
            P.registerStage(m, stageIdx);
            const meas = P.measure(m, P.ownEntries(m));
            meas.door = P.doorInfo(m, stageIdx);
            meas.gold = m.userData.goldTierV161 || 0;
            const bp0 = buildingPosition(stageIdx), pp0 = upgradePadPosition(bp0, stageIdx), pp = { x: pp0.x - bp0.x + m.position.x, z: pp0.z - bp0.z + m.position.z }; let dmin = 1e9;
            for (const e of P.ownEntries(m)) { const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, c = Math.cos(e.yaw || 0), s = Math.sin(e.yaw || 0), lx = dx * c - dz * s, lz = dx * s + dz * c; if (e.shape === 'obb') dmin = Math.min(dmin, Math.hypot(lx - Math.max(-e.hx, Math.min(e.hx, lx)), lz - Math.max(-e.hz, Math.min(e.hz, lz)))); else dmin = Math.min(dmin, Math.max(0, Math.hypot(pp.x - e.pos.x, pp.z - e.pos.z) - e.radius)); }
            meas.padDist = +dmin.toFixed(2);
            meas.height = meas.size[1];
            const sh = P.shoot(m, views);
            meas.draw = sh.calls.draw; meas.drawTris = sh.calls.tris;
            return { meas, shots: sh.shots };
          } finally { P.dropMesh(m); window.FactoryV161.enabled = true; }
        }, { L, old, views: old ? ['iso'] : fviews, stageIdx });
        for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-factory${stageIdx}-L${L}-${old ? 'old-' : ''}${v}.jpg`, url);
        factoryRows.push({ id: `factory${stageIdx}${old ? '-old' : ''}`, arch: 'factory', level: L, ...r.meas });
        console.log(`  factory ${stageIdx}${old ? ' OLD' : ''} L${L}: meshes ${r.meas.meshes}, draw ${r.meas.draw}, height ${r.meas.height} m, pad distance ${r.meas.padDist} m, walk-in ${r.meas.sweepReached}/8`);
      }
    }
  }
}
report.push(...factoryRows);


// ------------------------------------------------------------------------------------------------ 2g2. offices (6 / 7 / 11 / 14) and towers (8 / 9 / 12 / 15), backlog #10 + #11: old builder and new at every listed level
const otRows = [];
for (const [want, tag, defStages] of [[WANT_OFFICE, 'office', '6,7,11,14'], [WANT_TOWER, 'tower', '8,9,12,15']]) {
  if (!want) continue;
  const ol = parseList(opt(tag + '-levels', '1,3,5,6,10'), [1, 3, 5, 6, 10]);
  const oviews = String(opt(tag + '-views', 'front,iso,side')).split(',');
  for (const stageIdx of parseList(opt(tag + '-stages', defStages), defStages.split(',').map(Number))) {
    for (const old of opt(tag + '-no-old', false) ? [false] : [true, false]) {
      for (const L of ol) {
        const night = !old && !!opt('night', false) && [1, 5, 10].includes(L);
        const r = await page.evaluate(({ L, old, views, stageIdx, night }) => {
          const P = __BLD_PROBE__;
          window.OfficeTowerV161.enabled = !old;
          const m = P.stageMesh(stageIdx, L);
          try {
            P.registerStage(m, stageIdx);
            const meas = P.measure(m, P.ownEntries(m));
            meas.door = P.doorInfo(m, stageIdx);
            meas.gold = m.userData.goldTierV161 || 0;
            const bp0 = buildingPosition(stageIdx), pp0 = upgradePadPosition(bp0, stageIdx), pp = { x: pp0.x - bp0.x + m.position.x, z: pp0.z - bp0.z + m.position.z }; let dmin = 1e9;
            for (const e of P.ownEntries(m)) { const dx = pp.x - e.pos.x, dz = pp.z - e.pos.z, c = Math.cos(e.yaw || 0), s = Math.sin(e.yaw || 0), lx = dx * c - dz * s, lz = dx * s + dz * c; if (e.shape === 'obb') dmin = Math.min(dmin, Math.hypot(lx - Math.max(-e.hx, Math.min(e.hx, lx)), lz - Math.max(-e.hz, Math.min(e.hz, lz)))); else dmin = Math.min(dmin, Math.max(0, Math.hypot(dx, dz) - e.radius)); }
            meas.padDist = +dmin.toFixed(2);
            meas.height = meas.size[1];
            const sh = P.shoot(m, views);
            meas.draw = sh.calls.draw; meas.drawTris = sh.calls.tris;
            let nightShot = null;
            if (night) { const w = window.OfficeTowerV161.smats().win, b = window.OfficeTowerV161.smats().beacon, was = w.emissiveIntensity; w.emissiveIntensity = 0.95; b.emissiveIntensity = 1.9; nightShot = P.shoot(m, ['iso']).shots.iso; w.emissiveIntensity = was; }
            return { meas, shots: sh.shots, nightShot };
          } finally { P.dropMesh(m); window.OfficeTowerV161.enabled = true; }
        }, { L, old, views: old ? ['iso'] : oviews, stageIdx, night });
        for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-${tag}${stageIdx}-L${L}-${old ? 'old-' : ''}${v}.jpg`, url);
        if (r.nightShot) save(`${TAG}-${tag}${stageIdx}-L${L}-night-iso.jpg`, r.nightShot);
        otRows.push({ id: `${tag}${stageIdx}${old ? '-old' : ''}`, arch: tag, level: L, ...r.meas });
        console.log(`  ${tag} ${stageIdx}${old ? ' OLD' : ''} L${L}: meshes ${r.meas.meshes}, draw ${r.meas.draw}, tris ${r.meas.tris}, height ${r.meas.height} m, pad distance ${r.meas.padDist} m, walk-in ${r.meas.sweepReached}/8`);
      }
    }
  }
}
report.push(...otRows);

// ------------------------------------------------------------------------------------------------ 2h. fleet yard (backlog #8): rebuilt through the game's own rebuildParkingV65 with the old / the new builder
const fleetRows = [];
if (WANT_FLEET) {
  const built = await page.evaluate(() => __BLD_PROBE__.buildOut());
  console.log('BUILD-OUT', built.join(' | '));
  await page.waitForTimeout(4000);
  await page.evaluate(() => __BLD_PROBE__.finishGrowth());
  await page.waitForTimeout(2500);
  const fviews = String(opt('fleet-views', 'front,iso,top,low')).split(',');
  for (const old of opt('fleet-no-old', false) ? [false] : [true, false]) {
    const r = await page.evaluate(({ old, fviews }) => {
      const P = __BLD_PROBE__;
      window.FleetYardV161.enabled = !old;
      { const o = window.__TYCOON_V119__.state.owned; o.planks = o.concrete = o.metal = true; }
      try { syncDeliveryFleet(); } catch (e) { /* no fleet yet */ }
      __TYCOON_V65_TRAFFIC__.refresh();
      P.forceScan();
      const yard = scene.getObjectByName('v116FleetYard');
      const own = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === yard && e.flags.player);
      const meas = P.measureLive(yard);
      const tgt = new THREE.Vector3(-40.7, 0.5, 6.7), trucks = serviceVehicles.filter((v) => v.visible !== false);
      const views = { front: { az: Math.PI, el: 0.3, dist: 25 }, iso: { az: 2.5, el: 0.55, dist: 25 }, low: { az: 3.5, el: 0.25, dist: 20 }, top: { az: 0, el: 1.5, dist: 26 } };
      const shots = {}; let draw = 0, tris = 0;
      for (const v of fviews) { const o = P.overview([yard, ...trucks], { target: tgt, ...views[v] }); shots[v] = o.url; draw = Math.max(draw, o.draw); tris = Math.max(tris, o.tris); }
      let meshes = 0; yard.traverse((m) => { if (m.isMesh) meshes++; });
      return { meas: { ...meas, meshes, draw, drawTris: tris, solid: own.length }, shots, trucks: trucks.length };
    }, { old, fviews });
    for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-fleet-${old ? 'old-' : ''}${v}.jpg`, url);
    fleetRows.push({ id: `fleet-yard${old ? '-old' : ''}`, arch: 'special', level: 1, ...r.meas });
    console.log(`  fleet yard${old ? ' OLD' : ''}: meshes ${r.meas.meshes}, draw calls ${r.meas.draw} (with ${r.trucks} trucks in the frame), ${r.meas.solid} solid boxes, min y ${r.meas.minY}`);
  }
  await page.evaluate(() => { window.FleetYardV161.enabled = true; __TYCOON_V65_TRAFFIC__.refresh(); });
}
report.push(...fleetRows);

// ------------------------------------------------------------------------------------------------ 2e. suburb district (backlog #4): the identity group with the old and the new builders
const suburbRows = [];
if (WANT_SUBURB) {
  const built = await page.evaluate(() => __BLD_PROBE__.buildOut());
  console.log('BUILD-OUT', built.join(' | '));
  await page.waitForTimeout(4000);
  await page.evaluate(() => __BLD_PROBE__.finishGrowth());
  await page.waitForTimeout(2500);
  const sviews = String(opt('suburb-views', 'top,low,iso')).split(',');
  for (const old of opt('suburb-no-old', false) ? [false] : [true, false]) {
    const r = await page.evaluate(({ old, sviews }) => {
      const P = __BLD_PROBE__;
      BuildingsV161.enabled = !old;
      refreshDistrictIdentityWorldV363(); __TYCOON_V83_COLLISIONS__.rebuild(); P.forceScan();
      const g = P.suburbGroup();
      if (!g) return { missing: true };
      const meas = P.measure(g, [...P.suburbEntries(g, 'house'), ...P.suburbEntries(g, 'tree')], { sweep: false });
      const houses = P.suburbEntries(g, 'house');
      const center = new THREE.Box3().setFromObject(g).getCenter(new THREE.Vector3());
      const shots = {}, tgt = new THREE.Vector3(g.position.x + 1.6, 0.6, g.position.z + 0.1);
      const views = { top: { az: 0, el: 1.45, dist: 33 }, low: { az: 0.5, el: 0.4, dist: 27 }, iso: { az: -0.7, el: 0.75, dist: 30 } };
      let draw = 0;
      for (const v of sviews) { const o = P.overview([g], { target: tgt, ...views[v] }); shots[v] = o.url; draw = Math.max(draw, o.draw); }
      let tris = 0, meshes = 0; g.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
      meas.draw = draw; meas.meshes = meshes; meas.tris = Math.round(tris); meas.nHouses = houses.length;
      return { meas, shots, pos: g.position.toArray() };
    }, { old, sviews });
    if (r.missing) { console.log('  (suburb group missing)'); continue; }
    for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-suburb-${old ? 'old-' : ''}${v}.jpg`, url);
    suburbRows.push({ id: `suburb${old ? '-old' : ''}`, arch: 'district', level: 3, ...r.meas });
  }
  await page.evaluate(() => { BuildingsV161.enabled = true; refreshDistrictIdentityWorldV363(); __TYCOON_V83_COLLISIONS__.rebuild(); });
  // one mini house per variant, isolated (front + iso), numbers with the colliders the registry would give it
  for (let v = 0; v < 3; v++) {
    const r = await page.evaluate(({ v }) => {
      const P = __BLD_PROBE__, m = P.miniMesh(0xe0bb91, 0x8b4c39, v);
      try { const meas = P.measure(m, P.miniEntries(m)); const sh = P.shoot(m, ['front', 'iso']); meas.draw = sh.calls.draw; return { meas, shots: sh.shots }; } finally { P.dropMesh(m); }
    }, { v });
    for (const [vw, url] of Object.entries(r.shots)) save(`${TAG}-mini-house-v${v}-${vw}.jpg`, url);
    suburbRows.push({ id: `mini-house-v${v}`, arch: 'house', level: 1, ...r.meas });
  }
  // the neighbourhood ring around an apartment block (refreshNeighborhoodWorld, variants 0 / 1 by index): shot from above and low, with the wall boxes the registry holds for it
  const nb = await page.evaluate(() => {
    const P = __BLD_PROBE__; let found = null;
    { const h = cityState.housing.suburb; h.apartmentBlockBuilt = true; h.neighborhoodLevel = Math.max(2, h.neighborhoodLevel || 0); refreshNeighborhoodWorld(); __TYCOON_V83_COLLISIONS__.rebuild(); P.forceScan(); }
    for (const [id, grp] of cityWorldRuntime.neighborhoods) { if (grp.children.some((c) => c.userData && c.userData.v161MiniHouse)) { found = [id, grp]; break; } }
    if (!found) return null;
    const [id, grp] = found, houses = grp.children.filter((c) => c.userData && c.userData.v161MiniHouse);
    const b = new THREE.Box3().setFromObject(grp), c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    const boxes = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === grp && e.flags.player);
    const circles = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => String(e.label).startsWith('miniHouse:') && e.shape === 'circle');
    const dist = Math.max(size.x, size.z) * 2.3;
    const top = P.overview([grp], { target: new THREE.Vector3(c.x, 0.5, c.z), az: 0, el: 1.45, dist }), low = P.overview([grp], { target: new THREE.Vector3(c.x, 0.5, c.z), az: 0.6, el: 0.4, dist: dist * 0.8 });
    let meshes = 0, minY = 1e9; grp.traverse((o) => { if (o.isMesh) { meshes++; } });
    return { id, houses: houses.length, variants: houses.map((h) => h.userData.v161Variant), boxes: boxes.length, circlesPlayer: circles.filter((e) => e.flags.player).length, circlesPlacement: circles.filter((e) => e.flags.placement).length, meshes, shots: { top: top.url, low: low.url } };
  });
  if (nb) { for (const [v, url] of Object.entries(nb.shots)) save(`${TAG}-neighborhood-${v}.jpg`, url); delete nb.shots; console.log('NEIGHBOURHOOD', JSON.stringify(nb)); } else console.log('NEIGHBOURHOOD none built');
  report.push(...suburbRows);
}

// ------------------------------------------------------------------------------------------------ 1. stage buildings, isolated (after the survey: the forced surface scans below push the scan clock ahead)
const passes = [{ legacy: false }];
if (opt('also-legacy', false)) passes.push({ legacy: true });
for (const pass of passes) for (const i of stages) {
  const arch = info.arch[i];
  if (pass.legacy && arch !== 'house') continue;
  const lv = pass.legacy ? houseLevels.filter((L) => [1, 3, 5].includes(L)) : arch === 'house' ? houseLevels : levels;
  for (const L of lv) {
    const views = pass.legacy ? ['iso'] : arch === 'house' ? VIEWS : OTHER_VIEWS;
    await page.evaluate((legacy) => { if (window.BuildingsV161) BuildingsV161.enabled = !legacy; }, pass.legacy);
    const r = await page.evaluate(({ i, L, views }) => {
      const P = __BLD_PROBE__, m = P.stageMesh(i, L);
      try {
        const entry = P.registerStage(m, i);
        const entries = P.ownEntries(m);
        const meas = P.measure(m, entries);
        meas.door = P.doorInfo(m, i);
        meas.yaw = +m.rotation.y.toFixed(3);
        meas.gold = m.userData.goldTierV161 || 0;
        meas.children = m.children.length;
        meas.registered = !!entry;
        const sh = P.shoot(m, views);
        meas.draw = sh.calls.draw; meas.drawTris = sh.calls.tris;
        return { meas, shots: sh.shots };
      } finally { P.dropMesh(m); }
    }, { i, L, views });
    if (!pass.legacy) for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-stage${i}-L${L}-${v}.jpg`, url);
    report.push({ id: `stage${i}${pass.legacy ? '-old' : ''}`, name: info.names[i], arch, level: L, ...r.meas });
  }
}

// neighbourhood mini houses (district housing ring): the three variants, old (circle collider) and new
for (const legacy of WANT_PLANTS || WANT_SUBURB || WANT_SHOP || WANT_MARKET || WANT_WH || WANT_TERM || WANT_FACTORY || WANT_FLEET || WANT_OFFICE || WANT_TOWER ? [] : opt('also-legacy', false) ? [false, true] : [false]) {
  for (const v of legacy ? [0] : [0, 1, 2]) {
    const r = await page.evaluate(({ legacy, views, v }) => {
      const P = __BLD_PROBE__; if (window.BuildingsV161) BuildingsV161.enabled = !legacy;
      const m = P.miniMesh(0xe0bb91, 0x8b4c39, v);
      try { const meas = P.measure(m, P.miniEntries(m)); const sh = P.shoot(m, views); meas.draw = sh.calls.draw; return { meas, shots: sh.shots }; } finally { P.dropMesh(m); if (window.BuildingsV161) BuildingsV161.enabled = true; }
    }, { legacy, views: legacy ? ['iso'] : ['front', 'iso'], v });
    if (!legacy) for (const [vw, url] of Object.entries(r.shots)) save(`${TAG}-mini-house-v${v}-${vw}.jpg`, url);
    report.push({ id: 'mini-house' + (legacy ? '-old' : '-v' + v), arch: 'house', level: 1, ...r.meas });
  }
}

// ------------------------------------------------------------------------------------------------ 3. PHYSICS REPORT
console.log('\nPHYSICS REPORT');
const f = (v, n = 6) => String(v === undefined || v === null ? '-' : v).padStart(n);
console.log('id               L  meshes geos  mats draw  tris  minY   maxY  fp m2  col m2 overlap uncov outside outMax reach door(dist/dot) colliders');
for (const r of report) {
  const door = r.door ? `${r.door.dist}/${r.door.dot}` : '-';
  const cols = (r.colliders || []).map((c) => (c.shape === 'obb' ? `obb ${c.hx}x${c.hz}@${c.yaw || 0}` : `c r${c.r}`)).join(' ');
  console.log(`${String(r.id).padEnd(16)} ${f(r.level, 2)} ${f(r.meshes, 6)} ${f(r.geometries, 4)} ${f(r.materials, 5)} ${f(r.draw, 4)} ${f(r.tris, 5)} ${f(r.minY, 6)} ${f(r.maxY, 6)} ${f(r.footprintArea, 7)} ${f(r.colliderArea, 7)} ${f(r.overlap, 7)} ${f(r.uncovered, 5)} ${f(r.outside, 7)} ${f(r.outsideMax, 6)} ${f(r.sweepReached, 5)} ${door.padStart(12)} ${cols}`);
}
if (opt('json', false)) fs.writeFileSync(path.resolve(String(opt('json'))), JSON.stringify({ report, survey }, null, 1));
console.log(`\nconsole errors ${g.errors.length} ${JSON.stringify(g.errors.slice(0, 3))}; bad responses ${g.badResponses.length} ${JSON.stringify(g.badResponses.slice(0, 3))}`);
await g.close();
