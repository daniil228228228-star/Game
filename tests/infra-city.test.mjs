// Backbone plants, district identities, construction site and props (CHANGELOG_V161.md 2026-10-10 (13), docs/BUILDINGS_V161.md backlog #9 + city / site / props). ONE launch (fresh save, one reload).
//   1. POWER PLANT + WATER WORKS (assets/infra-plants-v161.js): nothing stands on the plant sites in a fresh game (no slab, no sign, no collider); the real pad function buys the plant and the yard
//      appears at once as a construction (fence, gate, formwork, crane) and as a real facility when the timer ends; the level changes the SAME group (no duplicates), the modules follow the level
//      (1..3), the rotors / water surface advance in the real loop within caps, colliders = fence runs with the gate gap, hall, transformers, stacks, tanks, basins; the pads stay outside every
//      collider; the plant persists across a reload (also while pending); the red beacon equals the game's own supply ratio < 0.8; no geometry leak across rebuilds.
//   2. DISTRICT IDENTITIES (assets/districts-v161.js): industrial / business / waterfront as merged groups (<= 8 meshes, was 21 / 61 / 113), min y within 5 cm, real colliders (walls, containers, tanks,
//      towers, annex, pool, planters, benches, palm trunks; the pond is solid except the pier corridors), no walk-in from 8 directions, the infra pads stay clear, the pond surface animates.
//   3. CONSTRUCTION SITE (assets/site-v161.js): the six archetypes at every phase: <= 16 visible meshes (was 62-103), min y 0, no vertical group scale at rest, final-size walls, crane base solid only
//      while the crane stands, no geometry leak when sites come and go.
//   4. PROPS (assets/props-v161.js): lamps / benches / signs / hydrants carry colliders of their size and lose them with the prop (watcher), transit stops are merged with colliders, makers stand on y 0
//      (natural vegetation and rocks are partly buried by design and listed separately).
import fs from 'node:fs';
import path from 'node:path';
import { openGame, reloadGame, check } from './lib/harness.mjs';
import { installProbe } from '../tools/lib/buildings-probe-v161.mjs';

const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(installProbe);

// ------------------------------------------------------------------------------------------------ helpers
const plantInfo = (k) => ev((k) => {
  const P = __BLD_PROBE__, w = __TYCOON_V42__.world[k];
  w.updateMatrixWorld(true);
  const names = {}; let meshes = 0, tris = 0;
  w.traverse((o) => { if (o.isMesh) { meshes++; names[o.name] = (names[o.name] || 0) + 1; const ge = o.geometry; tris += (ge.index ? ge.index.count : ge.attributes.position.count) / 3; } });
  const own = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => e.owner === w && e.flags.player);
  const label = k === 'power' ? 'v161PowerPlant' : 'v161WaterWorks';
  return { ud: w.userData.v161Plant, meshes, tris: Math.round(tris), names, own: own.length, groups: scene.children.filter((o) => o.name === label).length, inScene: w.parent === scene, pos: [w.position.x, w.position.z], sprites: w.children.filter((c) => c.isSprite).length };
}, k);
const plantMeasure = (k) => ev((k) => {
  const P = __BLD_PROBE__, w = __TYCOON_V42__.world[k];
  const own = P.ownEntries(w);
  const solids = own.filter((e) => !/:(fence|gate|light|crane)/.test(e.label));
  const meas = P.measure(w, solids); delete meas.colliders;
  return { minY: meas.minY, overlap: meas.overlap, outsideMax: meas.outsideMax, reach: meas.sweepReached, F: meas.footprintArea, size: meas.size };
}, k);
const lane = (from, to) => ev(({ from, to }) => {   // largest push of a player circle walked along the line, registry colliders only (no vehicles)
  const saved = playerVelocity.clone(); let worst = 0; const n = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.1);
  const entries = gatherPhysicsCircles().filter((e) => e.category !== 'vehicle' && !String(e.label || '').startsWith('vehicle'));
  for (let i = 0; i <= n; i++) { const x = from.x + (to.x - from.x) * i / n, z = from.z + (to.z - from.z) * i / n; playerVelocity.set(0, 0, 0); const r = resolvePlayerCircleCollisions(x, z, entries); worst = Math.max(worst, Math.hypot(r.x - x, r.z - z)); }
  playerVelocity.copy(saved); return +worst.toFixed(3);
}, { from, to });
const blockedAt = (x, z) => ev(({ x, z }) => __BLD_PROBE__.blockedAt(x, z), { x, z });
const geoCount = () => ev(() => renderer.info.memory.geometries);
async function waitLevel(id, before) { return page.waitForFunction(([id, before]) => industrialStepV118(id).level > before, [id, before], { timeout: 60000, polling: 250 }).then(() => true, () => false); }
async function buyPad(id) {
  const r = await ev((id) => {
    money = 1e6; planks = 500; concrete = 100; metal = 100;
    const st = industrialStepV118(id), lvl = st.level, vis = st.prereq(), ok = buildIndustrialStepV118(st);
    return { ok, lvl, vis };
  }, id);
  return r;
}

// ------------------------------------------------------------------------------------------------ 1. fresh game: nothing stands on the plant sites
const fresh = { power: await plantInfo('power'), water: await plantInfo('water') };
const freshOwn = await ev(() => [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => String(e.label).includes('-plant-v161')).length);
check(fresh.power.meshes === 0 && fresh.water.meshes === 0 && freshOwn === 0, `fresh game: nothing at the power plant / water works sites (meshes ${fresh.power.meshes} / ${fresh.water.meshes}, colliders ${freshOwn}; was a 0.5 m slab with posts and a "NOT BUILT" plate on each site)`);
check(fresh.power.sprites === 0 && fresh.water.sprites === 0, 'fresh game: no "NOT BUILT" sign / label sprite on the sites');

// ------------------------------------------------------------------------------------------------ 2. the real pad chain: road L1, lighting L1, then the plant pads appear
await ev(() => {
  money = 1e6; planks = 500; concrete = 100; metal = 100;
  for (const id of ['depot', 'sawmill', 'concrete', 'metal']) buildIndustrialStepV118(industrialStepV118(id));
  upgradeCityDistrict('suburb'); refreshIndustrialPadMarkersV118();
});
const r1 = await buyPad('infra-suburb-road'); check(r1.ok, 'road L1 pad bought');
check(await waitLevel('infra-suburb-road', r1.lvl), 'road L1 completed');
const r2 = await buyPad('infra-suburb-light'); check(r2.ok, 'lighting L1 pad bought');
check(await waitLevel('infra-suburb-light', r2.lvl), 'lighting L1 completed');
const padsBefore = await ev(() => ['infra-plant-power', 'infra-plant-water'].map((id) => { const s = industrialStepV118(id); return { id, vis: s.prereq(), x: +s.pos.x.toFixed(2), z: +s.pos.z.toFixed(2) }; }));
check(padsBefore.every((p) => p.vis), `both plant pads are offered (${J(padsBefore)})`);
const stillNothing = { power: (await plantInfo('power')).meshes, water: (await plantInfo('water')).meshes };
check(stillNothing.power === 0 && stillNothing.water === 0, `a visible pad is not a building: the sites are still empty (${J(stillNothing)})`);

// ---- 2a. buy the POWER plant through the pad function: the yard appears at once as a construction
const bp = await buyPad('infra-plant-power'); check(bp.ok && bp.vis, 'power plant pad bought through the real pad function');
const pend = await plantInfo('power');
check(pend.ud.pending === true && pend.ud.level === 0 && pend.meshes >= 5 && pend.names.v161InfraCrane === 1 && pend.names.v161InfraConcrete === 1 && !pend.names.v161InfraRotor, `power plant, pad bought: the yard stands at once as a construction (pending ${pend.ud.pending}, level ${pend.ud.level}, ${pend.meshes} meshes ${J(pend.names)})`);
check(pend.own >= 8, `the construction yard has its colliders already: fence runs with the gate gap, gate posts, flood lights, crane base (${pend.own})`);
const water0 = await plantInfo('water');
check(water0.meshes === 0, 'the water works site is still empty (its own pad was not bought)');
check(await waitLevel('infra-plant-power', bp.lvl), 'power plant level 1 reached after its pending timer');
const p1 = await plantInfo('power'), m1 = await plantMeasure('power');
check(p1.ud.level === 1 && !p1.ud.pending && p1.groups === 1 && p1.inScene && p1.names.v161InfraRotor === 1 && !p1.names.v161InfraCrane && p1.meshes >= 6 && p1.meshes <= 12, `power L1: one group, hall + transformer + pylon, ventilator, no crane (${p1.meshes} meshes ${J(p1.names)})`);
check(p1.sprites === 1, 'power L1: the label (real demand / capacity) is the only sprite');
check(m1.minY >= -0.05 && m1.minY <= 0.05, `power L1: nothing floating or sunk (min y ${m1.minY})`);
check(m1.overlap !== null && m1.overlap >= 0.9 && m1.outsideMax <= 1.0 && m1.reach === 0, `power L1: the hall / transformer boxes cover >= 90 % of the walls (${m1.overlap}), stick out <= 1 m (${m1.outsideMax}), walk-in from 8 directions 0 (${m1.reach})`);
const gate = { x: p1.pos[0], z: p1.pos[1] };
check((await lane({ x: gate.x, z: gate.z - 4.5 }, { x: gate.x, z: gate.z + 0.8 })) <= 0.01, 'power L1: the way from the pad through the gate to the middle of the yard is free (gate opening)');
check((await lane({ x: gate.x - 5.2, z: gate.z - 0.5 }, { x: gate.x - 2.2, z: gate.z - 0.5 })) >= 0.2 && (await lane({ x: gate.x + 5.2, z: gate.z - 0.5 }, { x: gate.x + 2.2, z: gate.z - 0.5 })) >= 0.2, 'power L1: the fence is solid from the west and the east (no walk-in except the gate)');
const padHit = await ev(() => ['infra-plant-power', 'infra-plant-water'].map((id) => { const s = industrialStepV118(id), b = __BLD_PROBE__.blockedAt(s.pos.x, s.pos.z); return [id, b.hit, b.by]; }));
check(padHit.every((p) => !p[1] || /tree/i.test(String(p[2]))), `the plant pads stand outside every plant collider (${J(padHit)})`);

// ---- 2b. animation in the real loop, within caps
const rot0 = await ev(() => { const m = __TYCOON_V42__.world.power.children.find((c) => c.name === 'v161InfraRotor'); return m.rotation.y; });
const rotMoved = await page.waitForFunction((r0) => { const m = __TYCOON_V42__.world.power.children.find((c) => c.name === 'v161InfraRotor'); return Math.abs(m.rotation.y - r0) > 0.2; }, rot0, { timeout: 30000, polling: 200 }).then(() => true, () => false);
check(rotMoved, 'power L1: the roof ventilator turns in the real loop');
const modeSpeed = await ev(() => {
  const w = __TYCOON_V42__.world.power, st = __TYCOON_V42__.state, out = {};
  for (const mode of ['eco', 'normal', 'boost']) {
    st.powerMode = mode; __TYCOON_V42__.refresh();
    const m = __TYCOON_V42__.world.power.children.find((c) => c.name === 'v161InfraRotor'), a = m.rotation.y;
    for (let i = 0; i < 5; i++) InfraV161.animate(0.1);
    out[mode] = +(m.rotation.y - a).toFixed(3);
  }
  st.powerMode = 'normal'; __TYCOON_V42__.refresh();
  return out;
});
check(modeSpeed.eco > 0 && modeSpeed.eco < modeSpeed.normal && modeSpeed.normal < modeSpeed.boost, `the ventilator speed follows the plant mode (rotation in 0.5 s: eco ${modeSpeed.eco} < normal ${modeSpeed.normal} < boost ${modeSpeed.boost})`);

// ---- 2c. the water works through its pad + a reload while it is under construction
const bw = await buyPad('infra-plant-water'); check(bw.ok && bw.vis, 'water works pad bought through the real pad function');
const wpend = await plantInfo('water');
check(wpend.ud.pending === true && wpend.ud.level === 0 && wpend.names.v161InfraCrane === 1 && wpend.meshes >= 5, `water works, pad bought: the yard stands as a construction (${wpend.meshes} meshes ${J(wpend.names)})`);
await ev(() => { save(); });
const errs1 = await reloadGame(g, 6000);
await ev(installProbe);
const wr = await plantInfo('water'), pr = await plantInfo('power');
check((wr.ud.pending === true || wr.ud.level === 1) && wr.groups === 1 && wr.meshes >= 5, `after the reload the water works is still there (pending ${wr.ud.pending}, level ${wr.ud.level}, groups ${wr.groups}, ${wr.meshes} meshes)`);
check(pr.ud.level === 1 && pr.groups === 1 && pr.meshes === p1.meshes && pr.tris === p1.tris, `after the reload the power plant is the same building (level ${pr.ud.level}, ${pr.meshes} meshes / ${pr.tris} tris vs ${p1.meshes} / ${p1.tris}, one group)`);
check(pr.own >= 10 && pr.own === p1.own, `colliders are back after the reload (${pr.own} vs ${p1.own})`);
check(await waitLevel('infra-plant-water', bw.lvl), 'water works level 1 completed (after the reload)');
const w1 = await plantInfo('water'), wm1 = await plantMeasure('water');
check(w1.ud.level === 1 && w1.groups === 1 && w1.names.v161InfraRotor === 1 && !w1.names.v161InfraWater && w1.meshes <= 12, `water L1: pump house + round tank + pipes, no basin yet (${w1.meshes} meshes ${J(w1.names)})`);
check(wm1.minY >= -0.05 && wm1.minY <= 0.05 && wm1.overlap >= 0.9 && wm1.outsideMax <= 1.0 && wm1.reach === 0, `water L1: min y ${wm1.minY}, cover ${wm1.overlap}, outside ${wm1.outsideMax} m, walk-in ${wm1.reach}/8`);

// ---- 2d. levels 2 and 3 (state driven: the pad chain for them needs district levels 2 / 3), the same groups grow
const lv = {};
for (const L of [2, 3]) {
  await ev((L) => { const st = __TYCOON_V42__.state; st.powerPlantLevel = L; st.waterPlantLevel = L; st.powerPendingUntil = 0; st.waterPendingUntil = 0; __TYCOON_V42__.refresh(); }, L);
  lv['p' + L] = await plantInfo('power'); lv['w' + L] = await plantInfo('water'); lv['pm' + L] = await plantMeasure('power'); lv['wm' + L] = await plantMeasure('water');
}
check(lv.p2.groups === 1 && lv.p3.groups === 1 && lv.w2.groups === 1 && lv.w3.groups === 1, 'levels 2 / 3 rebuild the SAME single group per plant (no duplicates)');
check(lv.p2.tris > p1.tris && lv.p3.tris > lv.p2.tris && lv.w2.tris > w1.tris && lv.w3.tris > lv.w2.tris, `every level adds parts (power tris ${p1.tris} -> ${lv.p2.tris} -> ${lv.p3.tris}; water ${w1.tris} -> ${lv.w2.tris} -> ${lv.w3.tris})`);
check(lv.p2.names.v161InfraRotor === 2 && lv.p3.names.v161InfraRotor === 2 && lv.w2.names.v161InfraRotor === 2 && lv.w3.names.v161InfraRotor === 3, `rotating parts follow the modules (power ${lv.p2.names.v161InfraRotor}/${lv.p3.names.v161InfraRotor}, water ${lv.w2.names.v161InfraRotor}/${lv.w3.names.v161InfraRotor}: ventilators + paddles)`);
check(!!lv.w2.names.v161InfraWater && !!lv.w3.names.v161InfraWater, 'water L2 / L3: the basins have an animated water surface mesh');
check([lv.p2, lv.p3, lv.w2, lv.w3].every((x) => x.meshes <= 12), `mesh (= draw call) budget <= 12 per plant (${J([lv.p2.meshes, lv.p3.meshes, lv.w2.meshes, lv.w3.meshes])}; the old plants were 6-7 flat boxes on a 0.5 m slab)`);
check([lv.pm2, lv.pm3, lv.wm2, lv.wm3].every((m) => m.minY >= -0.05 && m.minY <= 0.05 && m.overlap >= 0.9 && m.outsideMax <= 1.0 && m.reach === 0), `levels 2 / 3: min y, cover >= 90 %, outside <= 1 m, walk-in 0 ${J([lv.pm2, lv.pm3, lv.wm2, lv.wm3].map((m) => [m.minY, m.overlap, m.outsideMax, m.reach]))}`);
const wBox = await ev(() => { const w = __TYCOON_V42__.world.water, x = w.position.x, z = w.position.z, P = __BLD_PROBE__; return { basin: P.blockedAt(x - 2.0, z - 0.95).hit, tower: P.blockedAt(x - 0.75, z + 1.95).hit, aisle: P.blockedAt(x, z - 1.0).hit }; });
check(wBox.basin && wBox.tower && !wBox.aisle, `water L3: the basin and the tower are solid, the aisle from the gate is free (${J(wBox)})`);
// beacon = the game's supply ratio
const beacon = await ev(() => {
  const out = [];
  for (const [k, lv] of [['power', 1], ['power', 3], ['water', 1], ['water', 3]]) {
    const st = __TYCOON_V42__.state; if (k === 'power') st.powerPlantLevel = lv; else st.waterPlantLevel = lv; __TYCOON_V42__.refresh();
    const w = __TYCOON_V42__.world[k]; let b = 0; w.traverse((o) => { if (o.name === 'v161InfraBeacon') b++; });
    out.push({ k, lv, ratio: +__TYCOON_V42__.supply(k).toFixed(2), beacon: b });
  }
  return out;
});
check(beacon.every((b) => (b.ratio < 0.8) === (b.beacon === 1)), `the red roof beacon appears exactly when the game's supply ratio is < 0.8 (${J(beacon)})`);
await ev(() => { const st = __TYCOON_V42__.state; st.powerPlantLevel = 3; st.waterPlantLevel = 3; __TYCOON_V42__.refresh(); });
// water surface: vertices move inside a small band, border flat, capped vertex count
const wsA = await ev(() => { const m = __TYCOON_V42__.world.water.children.find((c) => c.name === 'v161InfraWater'); const p = m.geometry.attributes.position; let s = 0; for (let i = 0; i < p.count; i++) s += p.getY(i); return { sum: s, n: p.count }; });
const wsMoved = await page.waitForFunction((s0) => { const m = __TYCOON_V42__.world.water.children.find((c) => c.name === 'v161InfraWater'); const p = m.geometry.attributes.position; let s = 0; for (let i = 0; i < p.count; i++) s += p.getY(i); return Math.abs(s - s0) > 1e-4; }, wsA.sum, { timeout: 30000, polling: 200 }).then(() => true, () => false);
const wsBand = await ev(() => { const m = __TYCOON_V42__.world.water.children.find((c) => c.name === 'v161InfraWater'); const p = m.geometry.attributes.position, meta = m.userData.v161WaterMeta; let mx = 0, border = 0; for (let i = 0; i < p.count; i++) { const d = Math.abs(p.getY(i) - meta[i * 4 + 2]); mx = Math.max(mx, d); if (meta[i * 4 + 3] === 0) border = Math.max(border, d); } return { mx: +mx.toFixed(4), border, mat: m.material.color.b > m.material.color.r, transparent: m.material.transparent }; });
check(wsMoved && wsA.n <= 400 && wsBand.mx > 0.001 && wsBand.mx <= 0.03 && wsBand.border === 0 && wsBand.mat, `water works: the water surface ripples in the real loop (${wsA.n} vertices, max lift ${wsBand.mx} m <= 3 cm, border flat, blue material ${wsBand.mat})`);
// no leak: 12 rebuilds keep the geometry count (measured after the frames that upload / free them) and the live list bounded
await ev(() => { for (let i = 0; i < 2; i++) __TYCOON_V42__.refresh(); });
await page.waitForTimeout(2500);
const geo0 = await geoCount(), live0 = await ev(() => InfraV161.live.length);
await ev(() => { for (let i = 0; i < 12; i++) __TYCOON_V42__.refresh(); });
await page.waitForTimeout(2500);
const leak = await ev(() => ({ geo1: renderer.info.memory.geometries, live1: InfraV161.live.length, groups: scene.children.filter((o) => o.name === 'v161PowerPlant' || o.name === 'v161WaterWorks').length }));
check(leak.geo1 <= geo0 + 2 && leak.live1 <= 3 && leak.groups === 2, `12 rebuilds: no geometry leak (${geo0} -> ${leak.geo1}), live animation list ${live0} -> ${leak.live1} (<= 3), still exactly one group per plant (${leak.groups})`);
if (SHOTS) {
  for (const k of ['power', 'water']) { const sh = await ev((k) => __BLD_PROBE__.shootLive(__TYCOON_V42__.world[k], ['iso', 'top']).shots, k); for (const [v, u] of Object.entries(sh)) fs.writeFileSync(path.join(SHOTS, `plant-${k}-L3-${v}.jpg`), Buffer.from(u.split(',')[1], 'base64')); }
}

// ------------------------------------------------------------------------------------------------ 3. district identities
const dist = {};
for (const id of ['industrial', 'business', 'waterfront']) {
  dist[id] = [];
  for (const L of [1, 2, 3]) {
    const r = await ev(({ id, L }) => {
      const P = __BLD_PROBE__;
      cityState.districts[id] = L; refreshDistrictIdentityWorldV363(); __TYCOON_V83_COLLISIONS__.rebuild();
      const grp = cityWorldRuntime.districtIdentity.get(id); grp.updateMatrixWorld(true);
      const own = P.ownEntries(grp), solid = own.filter((e) => !/:pond/.test(e.label));
      const meas = P.measure(grp, solid); delete meas.colliders;
      let meshes = 0; grp.traverse((o) => { if (o.isMesh) meshes++; });
      const walkIn = (e) => { return null; };
      return { id, L, meshes, tris: meas.tris, minY: meas.minY, maxY: meas.maxY, size: meas.size, overlap: meas.overlap, outsideMax: meas.outsideMax, reach: meas.sweepReached, own: own.length, pond: own.length - solid.length, name: grp.name,
        dup: scene.children.filter((o) => o.name === grp.name).length, flags: own.every((e) => e.flags.player && e.flags.agent && !e.flags.placement && !e.flags.camera), hub: [grp.position.x, grp.position.z] };
    }, { id, L });
    dist[id].push(r);
  }
}
const D = Object.values(dist).flat();
console.log('district rows:\n  ' + D.map((r) => `${r.id} L${r.L}: meshes ${r.meshes}, tris ${r.tris}, size ${J(r.size)}, min y ${r.minY}, cover ${r.overlap}, outside ${r.outsideMax}, walk-in ${r.reach}/8, colliders ${r.own} (${r.pond} pond)`).join('\n  '));
check(D.every((r) => r.meshes <= 8 && r.dup === 1), `districts: <= 8 meshes per identity, one group each (${J(D.map((r) => [r.id, r.L, r.meshes]))}; before 21 / 61 / 113)`);
check(D.every((r) => r.minY >= -0.05 && r.minY <= 0.05), `districts: nothing floating or sunk, min y ${J(D.map((r) => r.minY))} (the old waterfront read -0.12)`);
check(D.every((r) => r.overlap !== null && r.overlap >= 0.9 && r.outsideMax <= 1.0), `districts: the solid boxes cover >= 90 % of the walls and stick out <= 1 m (${J(D.map((r) => [r.id, r.L, r.overlap, r.outsideMax]))}; before: no collider at all)`);
check(D.every((r) => r.reach === 0), `districts: the player walked at the middle from 8 directions never gets inside (reach ${J(D.map((r) => r.reach))}; before 6 / 8 / 1 of 8)`);
check(D.every((r) => r.own >= 8 && r.flags), `districts: real colliders for every part, player + agent only (${J(D.map((r) => r.own))})`);
for (const id of ['industrial', 'business', 'waterfront']) check(dist[id][0].tris < dist[id][1].tris && dist[id][1].tris < dist[id][2].tris, `${id}: the level adds parts (tris ${dist[id].map((r) => r.tris)})`);
const wf = await ev(() => {
  const P = __BLD_PROBE__, grp = cityWorldRuntime.districtIdentity.get('waterfront'), x = grp.position.x, z = grp.position.z, W = DistrictsV161.WF;
  const pier = (px) => P.blockedAt(x + px, z + W.quayZ1 + 1.0).hit, quay = P.blockedAt(x + 0, z + 1.9).hit;
  const pond = [P.blockedAt(x + 0, z + 4.5), P.blockedAt(x - 3.4, z + 4.5), P.blockedAt(x + 3.4, z + 4.5)];
  const walkInto = [-2.3, 2.3].map((px) => { const saved = playerVelocity.clone(); let worst = 0; const entries = gatherPhysicsCircles().filter((e) => e.category !== 'vehicle'); for (let i = 0; i <= 40; i++) { const zz = z + 1.9 + i * 0.1; playerVelocity.set(0, 0, 0); const r = resolvePlayerCircleCollisions(x + px, zz, entries); worst = Math.max(worst, Math.hypot(r.x - (x + px), r.z - zz)); } playerVelocity.copy(saved); return +worst.toFixed(3); });
  return { pierFree: [pier(-2.3), pier(2.3)], quayFree: quay, pondSolid: pond.map((p) => p.hit), walkOntoPier: walkInto };
});
check(!wf.pierFree[0] && !wf.pierFree[1] && !wf.quayFree && wf.pondSolid.every(Boolean) && wf.walkOntoPier.every((w) => w <= 0.01), `waterfront: the quay and both piers are walkable, the pond is solid (${J(wf)})`);
const pads = await ev(() => {
  const out = [];
  for (const s of INDUSTRIAL_BUILD_STEPS_V118.filter((q) => q.infraOf && q.infraOf !== 'city')) { const b = __BLD_PROBE__.blockedAt(s.pos.x, s.pos.z); out.push([s.id, b.hit, b.by.join('+')]); }
  return out;
});
check(pads.every((p) => !p[1] || /tree/i.test(p[2])), `all 16 district infra pads stand outside every district collider (${J(pads.filter((p) => p[1]))})`);
const pond = await ev(() => { const m = cityWorldRuntime.districtIdentity.get('waterfront').children.find((c) => c.name === 'v161InfraWater'); const p = m.geometry.attributes.position; let s = 0; for (let i = 0; i < p.count; i++) s += p.getY(i); return { s, n: p.count, blue: m.material.color.b > m.material.color.r }; });
const pondMoved = await page.waitForFunction((s0) => { const m = cityWorldRuntime.districtIdentity.get('waterfront').children.find((c) => c.name === 'v161InfraWater'); const p = m.geometry.attributes.position; let s = 0; for (let i = 0; i < p.count; i++) s += p.getY(i); return Math.abs(s - s0) > 1e-4; }, pond.s, { timeout: 30000, polling: 200 }).then(() => true, () => false);
check(pondMoved && pond.n <= 500 && pond.blue, `waterfront: the pond surface is animated and blue (${pond.n} vertices)`);
const live = await ev(() => { for (let i = 0; i < 10; i++) { refreshDistrictIdentityWorldV363(); } InfraV161.animate(0.016); return { live: InfraV161.live.length, groups: [...cityWorldRuntime.districtIdentity.values()].length }; });
check(live.live <= 3 && live.groups === 4, `10 district refreshes leave the animation list bounded (${live.live} <= 3 entries: two plants + the pond)`);
if (SHOTS) {
  for (const id of ['industrial', 'business', 'waterfront']) { const sh = await ev((id) => __BLD_PROBE__.shootLive(cityWorldRuntime.districtIdentity.get(id), ['iso', 'top']).shots, id); for (const [v, u] of Object.entries(sh)) fs.writeFileSync(path.join(SHOTS, `district-${id}-L3-${v}.jpg`), Buffer.from(u.split(',')[1], 'base64')); }
}

// ------------------------------------------------------------------------------------------------ 4. construction site rigs
const kinds = [['house', 0], ['shop', 2], ['warehouse', 3], ['factory', 5], ['office', 6], ['tower', 8]];
const siteRows = await ev((kinds) => {
  const P = __BLD_PROBE__, out = [], geo0 = renderer.info.memory.geometries;
  const T = [0.05, 0.2, 0.4, 0.6, 0.8, 1.0];
  for (const [kind, si] of kinds) {
    const site = spawnConstructionSite(new THREE.Vector3(30, 0, -58), STAGES[si], 30);
    const rows = [];
    for (let ph = 0; ph < 6; ph++) {
      site.buildRef = null; site.timer = T[ph] * site.duration; setConstructionPhaseVisual(site, ph, 1);
      site.group.updateMatrixWorld(true);
      const r = P.measure(site.group, [], { sweep: false });
      let nonUniform = 0; site.group.traverse((o) => { if (o !== site.group && !o.isSprite && o.scale && Math.abs(o.scale.y - 1) > 1e-6) nonUniform++; });
      rows.push({ ph, meshes: r.meshes, minY: r.minY, tris: r.tris, nonUniform, crane: !!site.craneParts[0].visible });
    }
    let all = 0; site.group.traverse((o) => { if (o.isMesh) all++; });
    const walls = site.wallVisual.children[0], wh = walls.geometry.boundingBox.max.y - walls.geometry.boundingBox.min.y;
    const beacons = []; site.group.traverse((o) => { if (o.userData && o.userData.v45SiteBeacon) beacons.push(1); });
    out.push({ kind, rows, all, envH: site.envH, trueEnvH: site.trueEnvH, wallH: +wh.toFixed(3), beacons: beacons.length, v45: !!site.group.userData.v45Site, sprites: site.group.children.filter((c) => c.isSprite).length });
    const i = constructionSites.indexOf(site); if (i >= 0) constructionSites.splice(i, 1); scene.remove(site.group); disposeObject3D(site.group);
  }
  return { out, geo0, geo1: renderer.info.memory.geometries };
}, kinds);
console.log('site rows:\n  ' + siteRows.out.map((s) => `${s.kind}: visible meshes per phase ${s.rows.map((r) => r.meshes).join('/')}, total ${s.all}, min y ${Math.min(...s.rows.map((r) => r.minY))}, wall height ${s.wallH} (true env ${s.trueEnvH.toFixed(2)})`).join('\n  '));
check(siteRows.out.every((s) => s.rows.every((r) => r.meshes <= 16)), `site: <= 16 visible meshes at every phase for all 6 archetypes (max ${Math.max(...siteRows.out.flatMap((s) => s.rows.map((r) => r.meshes)))}; before 62-103 of 141)`);
check(siteRows.out.every((s) => s.all <= 34), `site: <= 34 meshes in the whole rig (${J(siteRows.out.map((s) => s.all))}; before 141)`);
check(siteRows.out.every((s) => s.rows.every((r) => r.minY >= -0.05 && r.minY <= 0.05)), `site: nothing floating or sunk (min y ${J(siteRows.out.map((s) => Math.min(...s.rows.map((r) => r.minY))))})`);
check(siteRows.out.every((s) => s.rows.every((r) => r.nonUniform === 0) && s.envH === 1), 'site: no object is stretched in y at rest (the geometry has its final size; the growth animation plays scale.y 0.08 -> 1 only)');
check(siteRows.out.every((s) => Math.abs(s.wallH - 1.45 * s.trueEnvH) < 0.02), `site: walls are built at their real height 1.45 x envH (${J(siteRows.out.map((s) => [s.kind, s.wallH]))})`);
check(siteRows.out.every((s) => s.v45 && s.beacons === 2 && s.sprites === 1), 'site: the hazard boards + beacons are part of the rig (v45 decoration skipped: exactly 2 beacons), one phase plate');
check(siteRows.geo1 <= siteRows.geo0 + 2, `site: 6 rigs created and removed leave no geometry behind (${siteRows.geo0} -> ${siteRows.geo1})`);
const craneSolid = await ev(() => {
  const P = __BLD_PROBE__, site = spawnConstructionSite(new THREE.Vector3(30, 0, -58), STAGES[6], 30);
  const w = new THREE.Vector3(); site.craneRig.getWorldPosition(w);
  const res = {};
  return new Promise((resolve) => {
    setTimeout(() => {
      __TYCOON_V83_COLLISIONS__.rebuild();
      setConstructionPhaseVisual(site, 0, 0.05); res.hidden = P.blockedAt(w.x, w.z).hit;
      setConstructionPhaseVisual(site, 2, 0.4); res.shown = P.blockedAt(w.x, w.z).hit;
      res.yard = P.blockedAt(30 + 1.0, -58 + 1.0).hit;
      const i = constructionSites.indexOf(site); if (i >= 0) constructionSites.splice(i, 1); scene.remove(site.group); disposeObject3D(site.group);
      __TYCOON_V83_COLLISIONS__.rebuild(); res.gone = P.blockedAt(w.x, w.z).hit;
      resolve(res);
    }, 100);
  });
});
check(!craneSolid.hidden && craneSolid.shown && !craneSolid.yard && !craneSolid.gone, `site: the crane tower base is solid only while the crane stands, the yard is walkable, the base is gone with the site (${J(craneSolid)})`);

// ------------------------------------------------------------------------------------------------ 5. props
const makers = await ev(() => {
  const P = __BLD_PROBE__, out = [];
  const list = [['makeBench', () => makeBench()], ['makeSignPost', () => makeSignPost()], ['makeTrafficCone', () => makeTrafficCone()], ['makeFireHydrant', () => makeFireHydrant()], ['makeLamp', () => makeLamp()], ['makeBenchV39', () => makeBenchV39()],
    ['makeBusStopV39', () => makeBusStopV39()], ['makeBusStopV40', () => makeBusStopV40()], ['makeHydrantV40', () => makeHydrantV40()], ['makePlanterV40', () => makePlanterV40()], ['makeSimplePlanterV363', () => makeSimplePlanterV363()],
    ['makePromenadePierV363', () => makePromenadePierV363()], ['makeMiniHouse', () => makeMiniHouse(0xe2c8a4, 0x915947, 0)], ['makeBush', () => makeBush()], ['makeTree', () => makeTree({})], ['makeRock', () => makeRock()]];
  for (const [name, f] of list) { const m = f(); m.position.set(0, 0, 0); scene.add(m); m.updateMatrixWorld(true); const r = P.measure(m, [], { sweep: false }); out.push({ name, meshes: r.meshes, minY: r.minY, tag: m.userData.v161Prop || null }); scene.remove(m); disposeObject3D(m); }
  return out;
});
const NATURAL = ['makeBush', 'makeTree', 'makeRock'];
console.log('prop makers:\n  ' + makers.map((m) => `${m.name}: meshes ${m.meshes}, min y ${m.minY}${m.tag ? ', tag ' + m.tag : ''}`).join('\n  '));
check(makers.filter((m) => !NATURAL.includes(m.name)).every((m) => m.minY >= -0.05 && m.minY <= 0.05), `props: every manufactured prop stands on y 0 within 5 cm (${J(makers.filter((m) => !NATURAL.includes(m.name) && (m.minY < -0.05 || m.minY > 0.05)))}); bush / tree / rock are partly buried by design (${J(makers.filter((m) => NATURAL.includes(m.name)).map((m) => [m.name, m.minY]))})`);
check(['makeBench', 'makeSignPost', 'makeFireHydrant', 'makeLamp', 'makeBenchV39', 'makeHydrantV40', 'makeSimplePlanterV363'].every((n) => makers.find((m) => m.name === n)?.tag), 'props: the solid makers (lamp, bench x2, sign, hydrant x2, planter) tag their result');
const props = await ev(() => new Promise((resolve) => {
  const P = __BLD_PROBE__, res = {};
  const lamp = makeLamp(); lamp.position.set(75, 0, 75); scene.add(lamp);
  const bench = makeBench(); bench.position.set(75, 0, 70); bench.rotation.y = Math.PI / 2; scene.add(bench);
  const sign = makeSignPost(); sign.position.set(70, 0, 75); scene.add(sign);
  const hyd = makeFireHydrant(); hyd.position.set(70, 0, 70); scene.add(hyd);
  lamp.scale.setScalar(0.5);
  const count = () => [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => /^prop-/.test(e.label)).length;
  res.before = count();
  // the watcher (2 s tick) asks the registry to rebuild when tagged props appear: wait for it, never call rebuild here
  const t0 = performance.now();
  const poll = () => {
    if (count() > res.before || performance.now() - t0 > 20000) {
      res.afterAdd = count(); res.waited = Math.round(performance.now() - t0);
      res.lamp = P.blockedAt(75, 75).hit; res.lampFar = P.blockedAt(75.9, 75).hit;
      res.benchLong = P.blockedAt(75, 70.35).hit; res.benchShort = P.blockedAt(75.5, 70).hit; res.sign = P.blockedAt(70, 75).hit; res.hydrant = P.blockedAt(70, 70).hit;
      for (const o of [lamp, bench, sign, hyd]) { scene.remove(o); disposeObject3D(o); }
      const t1 = performance.now();
      const poll2 = () => { if (count() <= res.before || performance.now() - t1 > 20000) { res.afterRemove = count(); res.lampGone = P.blockedAt(75, 75).hit; resolve(res); } else setTimeout(poll2, 200); };
      poll2();
    } else setTimeout(poll, 200);
  };
  poll();
}));
check(props.afterAdd >= props.before + 4 && props.lamp && props.benchLong && props.sign && props.hydrant && !props.lampFar, `props: a lamp, a bench, a sign post and a hydrant added to the scene get colliders of their size by the watcher within ${props.waited} ms (${J(props)})`);
check(props.afterRemove <= props.before && !props.lampGone, `props: the colliders go with the props (${props.afterAdd} -> ${props.afterRemove}, lamp spot free ${!props.lampGone})`);
const live2 = await ev(() => {
  const tagged = []; scene.traverse((o) => { if (o.userData && o.userData.v161Prop && o.userData.v161Prop !== 'group') { let vis = true; for (let p = o; p; p = p.parent) if (p.visible === false) vis = false; if (vis) tagged.push(o.userData.v161Prop); } });
  const entries = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => /^prop-/.test(e.label)).length;
  const stops = [...cityWorldRuntime.transitStops.values()].map((s) => { s.updateMatrixWorld(true); const r = __BLD_PROBE__.measure(s, __BLD_PROBE__.ownEntries(s), { sweep: false }); let m = 0; s.traverse((o) => { if (o.isMesh) m++; }); return { meshes: m, minY: r.minY, own: __BLD_PROBE__.ownEntries(s).length }; });
  return { tagged: tagged.length, entries, stops };
});
check(live2.entries >= live2.tagged, `props: every visible tagged prop in the live world has a collider (${live2.tagged} tagged, ${live2.entries} entries)`);
check(live2.stops.length === 4 && live2.stops.every((s) => s.meshes <= 6 && s.minY >= -0.05 && s.minY <= 0.05 && s.own >= 1), `props: the 4 transit stops are merged (<= 6 meshes, was 28) with colliders, nothing sunk (${J(live2.stops)})`);

// ------------------------------------------------------------------------------------------------ 6. no errors
await ev(() => { save(); });
check(g.errors.length === 0 && g.badResponses.length === 0 && errs1.length === 0, `0 console errors / 4xx (${J([...g.errors, ...g.badResponses].slice(0, 4))})`);
await g.close();
