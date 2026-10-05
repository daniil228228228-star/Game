// Showcase + physics audit for every building the player can see (2026-10-05 (4), docs/BUILDINGS_V161.md is the catalogue this feeds).
//   node tools/showcase-v161.mjs [--stages 0,1,..|all] [--levels 1,5,10] [--house-levels 1-10] [--views front,side,top,iso] [--other-views iso]
//                                [--survey] [--survey-shots N] [--out DIR] [--tag base] [--json FILE]
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
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const parseList = (s, all) => (s === 'all' || s === undefined ? all : String(s).split(',').flatMap((x) => { const m = /^(\d+)-(\d+)$/.exec(x); return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, k) => +m[1] + k) : [+x]; }));
const OUT = path.resolve(opt('out', path.join(REPO_ROOT, '..', 'shots')));
const TAG = opt('tag', 'bld');
const VIEWS = String(opt('views', 'front,side,top,iso')).split(',');
const OTHER_VIEWS = String(opt('other-views', 'iso')).split(',');
const WANT_SURVEY = !!opt('survey', false);
fs.mkdirSync(OUT, { recursive: true });

const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 8000 });
const { page } = g;
await page.evaluate(installProbe);
const info = await page.evaluate(() => __BLD_PROBE__.stageInfo());
const stages = parseList(opt('stages', 'all'), Array.from({ length: info.n }, (_, i) => i));
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

// neighbourhood mini houses (district housing ring)
for (const legacy of opt('also-legacy', false) ? [false, true] : [false]) {
  const r = await page.evaluate(({ legacy, views }) => {
    const P = __BLD_PROBE__; if (window.BuildingsV161) BuildingsV161.enabled = !legacy;
    const m = P.miniMesh(0xe0bb91, 0x8b4c39);
    try { const meas = P.measure(m, P.miniEntries()); const sh = P.shoot(m, views); meas.draw = sh.calls.draw; return { meas, shots: sh.shots }; } finally { P.dropMesh(m); if (window.BuildingsV161) BuildingsV161.enabled = true; }
  }, { legacy, views: legacy ? ['iso'] : ['front', 'iso'] });
  if (!legacy) for (const [v, url] of Object.entries(r.shots)) save(`${TAG}-mini-house-${v}.jpg`, url);
  report.push({ id: 'mini-house' + (legacy ? '-old' : ''), arch: 'house', level: 1, ...r.meas });
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
