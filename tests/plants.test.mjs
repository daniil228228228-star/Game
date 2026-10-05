// Industrial plants v161 (CHANGELOG_V161.md 2026-10-05 (6)): concrete plant, metal yard, frame workshop (assets/plants-v161.js) + the plank pile of the sawmill.
// ONE browser launch on the late-game save with every staged unlock built out (the same setup as tests/buildings-physics.test.mjs). Everything is driven through the
// game's own update functions inside single synchronous evaluates (nothing else runs in between), so the real timers are the only clock:
//   A. one building per plant, the same group at levels 1/2/3 (same object, same name, the old group is gone), more parts with the level, mesh budget, no geometry leak
//      after rebuilding, the level change re-lays 0 road meshes, labels / loading plates / pile pose unchanged.
//   B. live cycles follow the real timers: concretePlantTimer / metalPlantTimer / the frame recipe timer. Phase = timer / interval, the in-flight items exist only in the
//      pour / slide / drop (and carry / land) windows, as many as the game credits for that cycle (1 at prestige 0, 2 at prestige 3 / 4), they land on the slot of the pile
//      they will occupy and the pile equals the stock in the very frame the game credits. Idle when the plant cannot work (store full, locked stage, no recipe inputs).
//   C. piles equal the stock for 0 / 1 / N / cap / more than the draw cap (concrete, metal, frames, planks), one merged mesh whose draw range is the number.
//   D. particles: dust / sparks / sawdust never exceed their pool (12), they only emit while the matching work phase runs, chimney smoke only while the yard works.
//   E. 0 console errors, 0 4xx.
import { openGame, check } from './lib/harness.mjs';
import { installProbe } from '../tools/lib/buildings-probe-v161.mjs';

const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 8000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;
await ev(installProbe);
console.log('build-out', (await ev(() => __BLD_PROBE__.buildOut())).join(' | '));
await page.waitForTimeout(4000);
await ev(() => __BLD_PROBE__.finishGrowth());
await page.waitForTimeout(2500);

// ------------------------------------------------------------------------------------------------ A. one building, levels 1/2/3
const roadUuids = () => ev(() => { const tags = ['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad'], o = []; scene.traverse((m) => { if (m.isMesh && m.userData && tags.some((t) => m.userData[t])) o.push(m.uuid); }); return o; });
const roads0 = await roadUuids();
const A = await ev(() => {
  const root = (k) => ({ concrete: () => concretePlant, metal: () => metalPlant }[k]());
  const geoms = (o) => { const s = new Set(); o.traverse((x) => { if (x.geometry) s.add(x.geometry.uuid); }); return s.size; };
  const count = (o) => { let n = 0; o.traverse(() => n++); return n; };
  const meshes = (o) => { let n = 0; o.traverse((x) => { if (x.isMesh && x.visible) n++; }); return n; };
  const out = { frame: null, rows: [] };
  const names = { concrete: 'v161ConcretePlant', metal: 'v161MetalYard' };
  for (const kind of ['concrete', 'metal']) {
    const obj = root(kind), id0 = obj, rows = [];
    for (const L of [1, 2, 3, 1, 3, 1]) {
      industrialLevelsV161[kind] = L; refreshIndustrialBadgesV161();
      const grp = obj.group;
      rows.push({
        L, name: grp.name, level: grp.userData.levelV161, sameObject: root(kind) === id0, oneInScene: scene.children.filter((o) => o.name === names[kind]).length === 1, inScene: grp.parent === scene,
        meshes: meshes(grp), geoms: geoms(grp), nodes: count(grp), tris: (() => { let t = 0; grp.traverse((x) => { if (x.isMesh) t += (x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position.count) / 3; }); return t; })(),
        labelIn: !!obj.label && obj.label.parent === grp, pos: [grp.position.x, grp.position.z], v161: obj.v161 === true, boxes: grp.userData.v161Footprint.length,
        pileAt: [grp.children.find((c) => /PileGroup/.test(c.name)).position.x + grp.position.x, grp.children.find((c) => /PileGroup/.test(c.name)).position.z + grp.position.z],
        zone: [LOGISTICS_ZONES[kind].pos.x, LOGISTICS_ZONES[kind].pos.z], pileRot: grp.children.find((c) => /PileGroup/.test(c.name)).rotation.y, zoneRot: LOGISTICS_ZONES[kind].group.rotation.y,
        registry: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === grp && e.flags.player && e.flags.agent && !e.flags.placement).length,
      });
    }
    out.rows.push({ kind, rows });
  }
  // an old build (PlantsV161.enabled = false) still works and comes back
  PlantsV161.enabled = false; const old = buildConcretePlant(); const oldMeshes = meshes(old.group); scene.remove(old.group); disposeObject3D(old.group); PlantsV161.enabled = true;
  out.oldConcreteMeshes = oldMeshes;
  return out;
});
for (const { kind, rows } of A.rows) {
  check(rows.every((r) => r.v161 && r.sameObject && r.oneInScene && r.inScene && r.labelIn), `${kind}: levels 1,2,3,1,3,1 rebuild the SAME building (one group in the scene, the game's object ${kind}Plant keeps its identity, its label moves with it) ${J(rows.map((r) => [r.L, r.level]))}`);
  check(rows.every((r) => r.level === r.L), `${kind}: the group carries the production level (${J(rows.map((r) => r.level))})`);
  const byL = (L) => rows.filter((r) => r.L === L);
  check(byL(1)[0].tris < byL(2)[0].tris && byL(2)[0].tris < byL(3)[0].tris, `${kind}: every level ADDS parts (triangles ${byL(1)[0].tris} < ${byL(2)[0].tris} < ${byL(3)[0].tris}); rebuilding level 3 / 1 again gives identical numbers (${byL(1).map((r) => r.tris)} / ${byL(3).map((r) => r.tris)})`);
  check(byL(1).every((r) => r.tris === byL(1)[0].tris && r.nodes === byL(1)[0].nodes && r.geoms === byL(1)[0].geoms) && byL(3).every((r) => r.tris === byL(3)[0].tris && r.nodes === byL(3)[0].nodes), `${kind}: no growth after rebuilding (nodes ${J(byL(1).map((r) => r.nodes))}, geometries ${J(byL(1).map((r) => r.geoms))})`);
  check(rows.every((r) => r.meshes <= (kind === 'concrete' ? 16 : 20)), `${kind}: mesh budget (${J(rows.map((r) => r.meshes))} meshes = draw calls at levels ${J(rows.map((r) => r.L))}${kind === 'concrete' ? `; the old plant had ${A.oldConcreteMeshes}` : ''})`);
  check(rows.every((r) => Math.abs(r.pileAt[0] - r.zone[0]) < 1e-6 && Math.abs(r.pileAt[1] - r.zone[1]) < 1e-6 && Math.abs(r.pileRot - r.zoneRot) < 1e-9), `${kind}: the pile stands exactly on the loading plate (${J(rows[0].pileAt.map((v) => +v.toFixed(2)))} == ${J(rows[0].zone.map((v) => +v.toFixed(2)))}, same yaw)`);
  check(rows.every((r) => r.registry === r.boxes), `${kind}: every footprint box is a player+agent collider in the registry at every level (${J(rows.map((r) => [r.boxes, r.registry]))})`);
}
check(A.oldConcreteMeshes >= 60, `the old 74-mesh concrete builder is still reachable behind PlantsV161.enabled=false (${A.oldConcreteMeshes} meshes)`);
const roads1 = await roadUuids();
check(roads0.length > 0 && roads1.length === roads0.length && roads1.every((u, i) => u === roads0[i]), `levels 1,2,3 of both plants re-laid 0 road meshes (${roads0.length} before, ${roads1.length} after, same uuids)`);
await ev(() => { for (const k of ['concrete', 'metal']) industrialLevelsV161[k] = 1; refreshIndustrialBadgesV161(); });

// ------------------------------------------------------------------------------------------------ B. live cycles (real timers), concrete + metal + frames
// sim: call the game's own update function in dt steps inside one synchronous evaluate; every step reads the picture state (plain data)
const sim = (kind, { seconds, dt = 0.1, prestige = 0, stock = 0, stage = 8, extra = null }) => ev(({ kind, seconds, dt, prestige, stock, stage, extra }) => {
  stageIndex = stage; stats.prestige = prestige;
  const stockOf = () => (kind === 'concrete' ? concrete : kind === 'metal' ? metal : framesV161);
  const setStock = (v) => { if (kind === 'concrete') concrete = v; else if (kind === 'metal') metal = v; else framesV161 = v; };
  setStock(stock);
  if (extra) new Function('a', extra)();
  const step = kind === 'concrete' ? updateConcretePlant : kind === 'metal' ? updateMetalPlant : (d) => PRODUCTION_CHAIN_V161.tick(d);
  if (kind === 'concrete') concretePlantTimer = 0; else if (kind === 'metal') metalPlantTimer = 0; else PRODUCTION_CHAIN_V161.resetTimer();
  const rows = []; let t = 0;
  const slot = (n) => PlantsV161.pileSlotWorld(kind === 'frame' ? 'frame' : kind, n);
  while (t < seconds) {
    const before = stockOf();
    step(dt); t += dt;
    const s = PlantsV161.snap(kind), shown = s.pile.shown;
    const row = { t: +t.toFixed(2), stock: stockOf(), credited: stockOf() - before, p: +s.p.toFixed(4), running: s.running, k: s.k, shown, range: s.pile.range, inflight: s.inflight.length, spin: +s.spin.toFixed(3), live: s.particles.live, max: s.particles.max, cutting: s.cutting, planks: s.planksVisible };
    if (s.inflight.length) row.pos0 = s.inflight[0];
    if (s.bucket) row.bucketY = +s.bucket.y.toFixed(3);
    if (s.jib) { row.jibAngle = +s.jib.angle.toFixed(3); row.hookY = +s.jib.hookY.toFixed(3); }
    if (kind === 'frame' && s.inflight[0]) row.parts = s.inflight[0].parts;
    if (kind !== 'frame') row.smoke = smokePuffs.length;
    rows.push(row);
  }
  return rows;
}, { kind, seconds, dt, prestige, stock, stage, extra });

async function cycleChecks(kind, label, opts, expectK, lastSlotOf) {
  const rows = await sim(kind, { seconds: opts.seconds, dt: opts.dt || 0.1, prestige: opts.prestige || 0, stock: opts.stock || 0, extra: opts.extra });
  const credits = rows.filter((r) => r.credited > 0);
  check(credits.length >= 2 && credits.every((r) => r.credited === expectK), `${label}: ${credits.length} credits in ${opts.seconds} s of the real loop, each exactly ${expectK} (${J(credits.map((r) => r.credited))})`);
  check(rows.every((r) => r.shown === Math.min(kind === 'frame' ? 16 : 24, Math.floor(r.stock)) && r.range === r.shown), `${label}: the pile equals the real stock after EVERY update, also in the frame of each credit (${rows.length} samples)`);
  // phase = timer / interval: strictly increases within a cycle and falls back only at a credit
  let mono = true, wraps = 0;
  for (let i = 1; i < rows.length; i++) { if (rows[i].p < rows[i - 1].p) { if (rows[i].credited > 0) wraps++; else mono = false; } }
  check(mono && wraps >= 2, `${label}: the cycle phase is the game's timer / interval: rises monotonically, falls back only in the frame of a credit (${wraps} wraps)`);
  const first = rows.findIndex((r) => r.credited > 0);
  const one = rows.slice(0, first + 1);
  const inflightRows = rows.filter((r) => r.inflight > 0);
  check(inflightRows.length > 0 && inflightRows.every((r) => r.inflight === expectK && r.running), `${label}: items in flight exist only while the plant runs and are exactly the credited number (${expectK}; ${inflightRows.length} samples with items)`);
  // what is in flight just before the credit is where the credited item will be in the pile
  const pre = rows[first - 1], dest = await ev(({ kind, n, k }) => Array.from({ length: k }, (_, j) => PlantsV161.pileSlotWorld(kind, Math.min(n + j, PlantsV161.PILES[kind].cap - 1))), { kind: kind === 'frame' ? 'frame' : kind, n: pre.shown, k: expectK });
  return { rows, credits, one, pre, dest, inflightRows };
}

// ---- concrete, prestige 0: 1 block per cycle
const C0 = await cycleChecks('concrete', 'concrete (prestige 0)', { seconds: 50, dt: 0.1 }, 1);
const INTER = await ev(() => ({ c: CONCRETE_AUTO_INTERVAL / productionSpeedMultiplier() / industrialSpeedV161('concrete'), m: METAL_AUTO_INTERVAL / productionSpeedMultiplier() / industrialSpeedV161('metal'), f: PRODUCTION_CHAIN_V161.table.recipe.interval / productionSpeedMultiplier() }));
const interC = INTER.c;
check(C0.rows.some((r) => r.credited > 0 && Math.abs(r.t - interC) < 0.35), `concrete: the first credit comes at the real interval ${interC.toFixed(1)} s (CONCRETE_AUTO_INTERVAL / productionSpeedMultiplier()): ${C0.rows.find((r) => r.credited > 0).t} s`);
check(C0.inflightRows.every((r) => r.p >= 0.795), `concrete: blocks exist only in the pour / slide / drop window (phase >= 0.80; first at ${C0.inflightRows[0].p})`);
check(Math.min(...C0.rows.map((r) => r.bucketY)) < 0.6 && Math.max(...C0.rows.map((r) => r.bucketY)) > 2.2, `concrete: the skip rides the rails from the pit to the hopper (y ${Math.min(...C0.rows.map((r) => r.bucketY))}..${Math.max(...C0.rows.map((r) => r.bucketY))})`);
check(C0.rows.filter((r) => r.t > 3).every((r) => r.spin > 0.5), `concrete: the drum turns while the plant runs (spin ${Math.min(...C0.rows.filter((r) => r.t > 3).map((r) => r.spin))}..${Math.max(...C0.rows.map((r) => r.spin))} rad/s)`);
{
  const r = C0.pre.pos0, d = C0.dest[0];
  check(C0.pre.inflight === 1 && Math.hypot(r.x - d[0], r.z - d[2]) < 0.3 && Math.abs(r.y - d[1]) < 0.35, `concrete: just before the credit the block is on its way to the exact slot of the pile (now ${J([r.x, r.y, r.z].map((v) => +v.toFixed(2)))}, slot ${J(d.map((v) => +v.toFixed(2)))})`);
}
check(Math.max(...C0.rows.map((r) => r.live)) > 0 && Math.max(...C0.rows.map((r) => r.live)) <= 12 && C0.rows.every((r) => r.max === 12), `concrete: dust puffs happen (max live ${Math.max(...C0.rows.map((r) => r.live))}) and never exceed the pool of 12`);
// a finer pass over the end of one cycle: the block lands on the slot in the frame of the credit (dt 0.02)
{
  const rows = await sim('concrete', { seconds: 16, dt: 0.02, stock: 4 });
  const i = rows.findIndex((r) => r.credited > 0), pre = rows[i - 1];
  const dest = await ev((n) => PlantsV161.pileSlotWorld('concrete', n), pre.shown);
  const p = pre.pos0;
  check(pre.p > 0.985 && Math.hypot(p.x - dest[0], p.z - dest[2]) < 0.03 && Math.abs(p.y - dest[1]) < 0.04, `concrete: one update before the credit the block sits on the next slot of the pile (p ${pre.p}; ${J([p.x, p.y, p.z].map((v) => +v.toFixed(3)))} vs slot ${J(dest.map((v) => +v.toFixed(3)))}); after the credit the pile shows ${rows[i].shown} == stock ${rows[i].stock}`);
}
// prestige 3: two blocks per cycle (planks use the same 1 + floor(prestige / 3) formula)
const C3 = await cycleChecks('concrete', 'concrete (prestige 3)', { seconds: 50, dt: 0.1, prestige: 3 }, 2);
check(C3.pre.inflight === 2, `concrete: at prestige 3 two blocks are in flight and two are credited (${C3.pre.inflight})`);
// stores: full store stops the cycle, near-full credits only what fits, locked stage idles
{
  const cap = await ev(() => concreteCapacity());
  const full = await sim('concrete', { seconds: 4, dt: 0.1, stock: cap });
  check(full.every((r) => !r.running && r.p === 0 && r.inflight === 0 && r.credited === 0) && full[full.length - 1].spin < 0.25 && full[full.length - 1].shown === Math.min(24, cap), `concrete: a full store (${cap}) stops everything (no phase, no items, drum coasts down to ${full[full.length - 1].spin}) and the pile shows ${full[full.length - 1].shown}`);
  const near = await sim('concrete', { seconds: 22, dt: 0.1, prestige: 6, stock: cap - 1 });
  const cr = near.filter((r) => r.credited > 0);
  check(cr.length === 1 && cr[0].credited === 1 && near.filter((r) => r.inflight > 0).every((r) => r.inflight === 1 || r.stock >= cap), `concrete: one place left at prestige 6 (3 per cycle): 1 block is credited and 1 is in flight (${J(cr.map((r) => r.credited))})`);
  const locked = await sim('concrete', { seconds: 4, dt: 0.1, stage: 3 });
  check(locked.every((r) => !r.running && r.inflight === 0 && r.credited === 0), 'concrete: before the unlock stage nothing moves and nothing is credited');
}

// ---- metal: beams, jib, sparks, smoke
const M0 = await cycleChecks('metal', 'metal (prestige 0)', { seconds: 40, dt: 0.1 }, 1);
const interM = INTER.m;
check(M0.rows.some((r) => r.credited > 0 && Math.abs(r.t - interM) < 0.35), `metal: the first credit comes at the real interval ${interM.toFixed(1)} s (METAL_AUTO_INTERVAL / productionSpeedMultiplier()): ${M0.rows.find((r) => r.credited > 0).t} s`);
{
  const r = M0.pre.pos0, d = M0.dest[0];
  check(M0.pre.inflight === 1 && Math.hypot(r.x - d[0], r.z - d[2]) < 0.4 && Math.abs(r.y - d[1]) < 0.45, `metal: just before the credit the beam hangs over the exact slot of the pile (now ${J([r.x, r.y, r.z].map((v) => +v.toFixed(2)))}, slot ${J(d.map((v) => +v.toFixed(2)))})`);
}
{
  const rows = await sim('metal', { seconds: 12, dt: 0.02, stock: 3 });
  const i = rows.findIndex((r) => r.credited > 0), pre = rows[i - 1];
  const dest = await ev((n) => PlantsV161.pileSlotWorld('metal', n), pre.shown);
  const p = pre.pos0;
  check(pre.p > 0.98 && Math.hypot(p.x - dest[0], p.z - dest[2]) < 0.05 && Math.abs(p.y - dest[1]) < 0.05, `metal: one update before the credit the beam has landed on the next slot (p ${pre.p}; ${J([p.x, p.y, p.z].map((v) => +v.toFixed(3)))} vs slot ${J(dest.map((v) => +v.toFixed(3)))}); after the credit the pile shows ${rows[i].shown} == stock ${rows[i].stock}`);
}
check(Math.max(...M0.rows.map((r) => r.jibAngle)) - Math.min(...M0.rows.filter((r) => r.running).map((r) => r.jibAngle)) > 1.0 && Math.min(...M0.rows.map((r) => r.hookY)) < 1.1 && Math.max(...M0.rows.map((r) => r.hookY)) > 2.2, `metal: the jib swings between the rack and the pile (${Math.min(...M0.rows.map((r) => r.jibAngle))}..${Math.max(...M0.rows.map((r) => r.jibAngle))} rad) and the hook goes down (${Math.min(...M0.rows.map((r) => r.hookY))}) and up (${Math.max(...M0.rows.map((r) => r.hookY))})`);
const orphanSparks = M0.rows.filter((r, i) => r.live > 0 && !M0.rows.slice(Math.max(0, i - 8), i + 1).some((q) => q.cutting));
check(M0.rows.some((r) => r.cutting) && Math.max(...M0.rows.map((r) => r.live)) > 0 && Math.max(...M0.rows.map((r) => r.live)) <= 12 && orphanSparks.length === 0 && M0.rows.every((r) => r.max === 12), `metal: sparks fly only at the cut-off (cutting in ${M0.rows.filter((r) => r.cutting).length} samples, max live ${Math.max(...M0.rows.map((r) => r.live))} of 12, sparks outside a cut: ${orphanSparks.length})`);
check(M0.rows.every((r) => r.smoke <= 28) && M0.rows.some((r) => r.smoke > 0), `metal: chimney smoke goes through the game's own puff pool (max ${Math.max(...M0.rows.map((r) => r.smoke))} <= its cap)`);
const M4 = await cycleChecks('metal', 'metal (prestige 4)', { seconds: 40, dt: 0.1, prestige: 4 }, 2);
{
  const cap = await ev(() => metalCapacity());
  const full = await sim('metal', { seconds: 4, dt: 0.1, stock: cap });
  check(full.every((r) => !r.running && r.p === 0 && r.inflight === 0 && r.credited === 0) && full[full.length - 1].spin < 0.5, `metal: a full store (${cap}) stops everything, the pile shows ${full[full.length - 1].shown}`);
  const locked = await sim('metal', { seconds: 4, dt: 0.1, stage: 4 });
  check(locked.every((r) => !r.running && r.inflight === 0 && r.credited === 0), 'metal: before the unlock stage nothing moves');
}
// level 3 (overhead hoist): the same cycle, the credited beam still lands on its slot
{
  await ev(() => { industrialLevelsV161.metal = 3; refreshIndustrialBadgesV161(); });
  const rows = await sim('metal', { seconds: 12, dt: 0.02, stock: 2 });
  const i = rows.findIndex((r) => r.credited > 0), pre = rows[i - 1], dest = await ev((n) => PlantsV161.pileSlotWorld('metal', n), pre.shown), p = pre.pos0;
  check(i > 0 && Math.hypot(p.x - dest[0], p.z - dest[2]) < 0.05 && rows[i].shown === rows[i].stock, `metal level 3 (hoist): the beam still lands on the slot in the credit frame (${J([p.x, p.y, p.z].map((v) => +v.toFixed(3)))} vs ${J(dest.map((v) => +v.toFixed(3)))}), pile ${rows[i].shown} == stock ${rows[i].stock}`);
  await ev(() => { industrialLevelsV161.metal = 1; refreshIndustrialBadgesV161(); });
}

// ---- frame workshop: the recipe timer of production-chain-v161.js
const FEXTRA = 'planks = 99999; metal = 99999; frameWorkshopBuiltV161 = true;';
const F0 = await cycleChecks('frame', 'frame workshop', { seconds: 70, dt: 0.1, extra: FEXTRA }, 1);
const interF = INTER.f;
check(F0.rows.some((r) => r.credited > 0 && Math.abs(r.t - interF) < 0.35), `frames: the first frame is crafted at the real interval ${interF.toFixed(1)} s (recipe 14 s / productionSpeedMultiplier()): ${F0.rows.find((r) => r.credited > 0).t} s`);
check(Math.max(...F0.rows.map((r) => r.parts || 0)) === 6 && F0.rows.filter((r) => r.parts > 0).every((r) => r.p >= 0.37), `frames: the six members of the frame appear one after the other on the jig after the planks were sawn (parts ${Math.max(...F0.rows.map((r) => r.parts || 0))})`);
check(F0.rows.some((r) => r.planks) && F0.rows.filter((r) => r.planks).every((r) => r.p < 0.39) && F0.rows.some((r) => r.cutting && r.spin > 20) && Math.max(...F0.rows.map((r) => r.live)) <= 12 && Math.max(...F0.rows.map((r) => r.live)) > 0, `frames: the three planks ride into the saw only while it saws (sawdust max live ${Math.max(...F0.rows.map((r) => r.live))} of 12)`);
{
  const r = F0.pre.pos0, d = F0.dest[0];
  check(F0.pre.inflight === 1 && Math.hypot(r.x - d[0], r.z - d[2]) < 0.45, `frames: just before the craft the frame is on its way to the next slot of the stack (${J([r.x, r.z].map((v) => +v.toFixed(2)))} vs ${J([d[0], d[2]].map((v) => +v.toFixed(2)))})`);
  const cap = await ev(() => frameCapacityV161());
  const idleFull = await sim('frame', { seconds: 4, dt: 0.1, stock: cap, extra: FEXTRA });
  check(idleFull.every((r) => !r.running && r.p === 0 && r.inflight === 0 && r.credited === 0) && idleFull[idleFull.length - 1].shown === Math.min(16, cap), `frames: a full store (${cap}) stops the saw, the stack shows ${idleFull[idleFull.length - 1].shown}`);
  const idleNoInput = await sim('frame', { seconds: 4, dt: 0.1, stock: 0, extra: 'planks = 1; metal = 0; frameWorkshopBuiltV161 = true;' });
  check(idleNoInput.every((r) => !r.running && r.inflight === 0 && r.credited === 0), 'frames: without planks / metal for the recipe nothing moves and nothing is credited');
}

// ------------------------------------------------------------------------------------------------ C. piles equal the stock for 0 / 1 / N / cap / more than the draw cap
const P = await ev(() => {
  const out = [];
  const rows = (kind, setter, values, cap) => { for (const v of values) { setter(v); if (kind === 'planks') syncPlankStackV161(); else if (kind === 'concrete') PlantsV161.updateConcrete(0); else if (kind === 'metal') PlantsV161.updateMetal(0); else PlantsV161.updateWorkshop(PRODUCTION_CHAIN_V161.prop(), 0);
    const mesh = kind === 'planks' ? plankStackV161.mesh : (kind === 'concrete' ? concretePlant : kind === 'metal' ? metalPlant : PRODUCTION_CHAIN_V161.prop()).group.children.find((c) => new RegExp(kind === 'frame' ? 'PileGroup' : 'PileGroup').test(c.name))?.children[0];
    const per = kind === 'planks' ? 36 : mesh.userData.drawPer, n = mesh.geometry.drawRange.count / per;
    out.push({ kind, stock: v, shown: n, visible: mesh.visible, expect: Math.min(cap, Math.floor(v)), meshesOfPile: 1 }); } };
  stageIndex = 16;
  const vals = (cap) => [0, 1, 2, 7, cap - 1, cap, cap + 9];
  rows('planks', (v) => { planks = v; }, vals(24), 24);
  rows('concrete', (v) => { concrete = v; }, vals(concreteCapacity()), 24);
  rows('metal', (v) => { metal = v; }, vals(metalCapacity()), 24);
  rows('frame', (v) => { framesV161 = v; }, vals(frameCapacityV161()), 16);
  return out;
});
check(P.every((r) => r.shown === r.expect && r.visible === (r.expect > 0)), `piles equal the real stock for 0 / 1 / 2 / 7 / cap-1 / cap / cap+9 (planks, concrete, metal, frames; draw range = count, empty plate = hidden): ${J(P.filter((r) => r.shown !== r.expect || r.visible !== (r.expect > 0)))} (${P.length} cases)`);
console.log('INFO caps: concrete pile cap 24 (store 18 + 16 per warehouse level), metal 24 (12 + 12), frames 16 (6 + 4), planks 24; above the cap the pile shows the cap (nearest honest picture, see KNOWN ISSUE in the changelog)');

// ------------------------------------------------------------------------------------------------ D. particles + no leak over cycles (the group's own geometries / nodes do not change while it runs)
const leak = await ev(() => {
  const geoms = (o) => { const s = new Set(); o.traverse((x) => { if (x.geometry) s.add(x.geometry.uuid); }); return s.size; };
  const nodes = (o) => { let n = 0; o.traverse(() => n++); return n; };
  const before = { c: [geoms(concretePlant.group), nodes(concretePlant.group)], m: [geoms(metalPlant.group), nodes(metalPlant.group)] };
  stageIndex = 8; concrete = 0; metal = 0; concretePlantTimer = 0; metalPlantTimer = 0; stats.prestige = 0;
  let maxDust = 0, maxSpark = 0;
  for (let i = 0; i < 1500; i++) { updateConcretePlant(0.05); updateMetalPlant(0.05); maxDust = Math.max(maxDust, PlantsV161.snap('concrete').particles.live); maxSpark = Math.max(maxSpark, PlantsV161.snap('metal').particles.live); }
  const after = { c: [geoms(concretePlant.group), nodes(concretePlant.group)], m: [geoms(metalPlant.group), nodes(metalPlant.group)] };
  return { before, after, maxDust, maxSpark, cc: stats.concreteProduced, mm: stats.metalProduced };
});
check(J(leak.before) === J(leak.after) && leak.maxDust <= 12 && leak.maxSpark <= 12, `75 s of both plants (>= 3 cycles each): geometries and scene nodes of both groups return to baseline ${J(leak.before)} == ${J(leak.after)}, particle pools stay <= 12 (dust ${leak.maxDust}, sparks ${leak.maxSpark})`);

check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${J([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
