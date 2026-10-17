// Masterplan PHASE 5 (plan B pads B13 "Railway and freight yard" 210 000, B14 "Siding and warehouses" 105 000). Same pipeline as tests/masterplan-phase4.test.mjs (compile-port --phase=5,
// MASTERPLAN_REQUIRES_V161 B13 <- B12, B14 <- B13, masterplanStateV161 + save field, generic cell groups mp161Rail / mp161Siding) plus rails: static track (ballast bed, rails, sleepers as ONE
// InstancedMesh, buffer stops), container stacks, the loading dock. WALKING MODEL (documented decision): tracks, container stacks and the dock are NOT walkable: D.blockers (even-odd regions
// subtracted from the walkable floor while the pad is paid) with a thin fence on the strip boundary; the plan has no level crossings, so there is no way over a track and no trains.
//   launch 1 (fresh game): data (check, hashes of B01..B12 unchanged, rails / nodes / stations / blockers / fences), gate matrix (stage 11 + chain), exact prices 210000 / 105000 through the real
//   #actionBtn, groups / names / tags, seams (yard apron, south aisle), blocked tracks / yard / dock (siding only after B14), pushes into the tracks, draw-call budget (layer <= +40,
//   phase 5 <= +14), save/reload, lazy build, reset.   launch 2 (OLD_SAVE): fourteen flags false, no objects, signature 51/648310607, restore chain.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openGame, reloadGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IDS = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13', 'B14'];
const P5 = ['mp161Rail', 'mp161Siding'];
const HASH = { B01: 'b72aec06e08d', B02: 'df807cbb0355', B03: 'fecb9bf1aaaa', B04: '79a2c88d6ea7', B05: '7f9663c3e0b4', B06: 'bca9326a3427', B07: '49df0862c6c3', B08: '02a489d840a2', B09: 'ade4e6f0990b', B10: '73cf7652cb57', B11: '54615d10db48', B12: '0682bf34c3d7' };   // phase 1-4 data per pad, must stay byte-identical
const FLAGS = (list) => Object.fromEntries(IDS.map((id) => [id, list.includes(id)]));
const PARTIAL = ['B01', 'B03', 'B05', 'B06', 'B07', 'B09', 'B10', 'B11', 'B12'];   // the chain B13 needs (B02, B04, B08 were never bought)

// ---- offline
{
  const r = spawnSync('node', ['tools/masterplan/compile-port.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  check(r.status === 0, `compile-port --check: ${r.stdout.trim()}`);
  const v = spawnSync('node', ['tools/masterplan/validate.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const fails = (v.stdout.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5, 60));
  console.log('validate.mjs FAIL rows (known, draft plan B): ' + J(fails));
  check(fails.length <= 3 && /НАРУШЕНИЙ: 3/.test(v.stdout), `validator: no new violations (${fails.length} FAIL rows, "${(v.stdout.match(/НАРУШЕНИЙ: \d+/) || [''])[0]}")`);
  check(/OK\s+рельсы: концевые узлы только буфера\/выходы/.test(v.stdout) && /OK\s+переездов в одном уровне: 0/.test(v.stdout) && /OK\s+станция не пересекает дороги и посторонние пути/.test(v.stdout), 'validator: the rail rows pass (end nodes are bumpers / exits, 0 level crossings, stations clear of roads)');
}
{
  const vm = await import('node:vm');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/masterplan-port-data-v161.js'), 'utf8'), ctx);
  const D = ctx.window.MasterplanPortDataV161;
  const hash = (id) => crypto.createHash('sha1').update(J([D.surfaces[id], D.boundaries[id], D.walkable[id], D.bbox[id], D.land[id] || null])).digest('hex').slice(0, 12);
  check(Object.keys(HASH).every((id) => hash(id) === HASH[id]), `data: B01..B12 compiled data byte-identical to phase 4 (${J(Object.keys(HASH).map(hash))})`);
  const inPoly = (x, z, poly) => { let y = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) y = !y; } return y; };
  const inRegion = (x, z, loops) => { let y = false; for (const l of loops) if (inPoly(x, z, l)) y = !y; return y; };
  const blocked = (x, z) => IDS.some((id) => D.blockers && D.blockers[id] && D.blockers[id].some((r) => inRegion(x, z, r)));
  check(D.pads.length === 14 && D.pads.slice(12).every((p) => p.gateStage === 11 && p.rep === undefined) && J(D.pads.slice(12).map((p) => p.money)) === '[210000,105000]' && J(D.pads.slice(12).map((p) => p.requires)) === '[["B12"],["B13"]]' && D.pads.slice(12).map((p) => p.group).join() === 'mp161Rail,mp161Siding', 'data: B13 / B14: stage 11, no reputation (meta.phaseInfo[5]), plan prices 210000 / 105000, requires B12 / B13, groups mp161Rail / mp161Siding');
  check(D.rails.length === 10 && D.rails.filter((r) => r.pad === 'B13').length === 8 && D.rails.filter((r) => r.pad === 'B14').length === 2 && D.railNodes.length === 12 && J(D.stations.map((s) => s.id)) === '["ST-FRT","ST-WH"]', `data: 10 rails (8 + 2), 12 rail nodes, stations ST-FRT / ST-WH (${D.rails.length}/${D.railNodes.length}/${D.stations.length})`);
  // every rail axis point (every metre) is blocked, every point 3.2 m off the axis is not blocked by THIS rail's strip alone but the whole strip half width is 2.4 m
  let axisTested = 0; const axisFree = [], lenOk = [];
  for (const r of D.rails) for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < 1; t += Math.min(1, 1 / Math.max(L, 1))) { const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; axisTested++; if (!blocked(x, z)) axisFree.push([r.id, +x.toFixed(1), +z.toFixed(1)]); } }
  check(axisFree.length === 0 && axisTested > 300, `data: all ${axisTested} sampled points of the 10 rail axes lie in a blocked strip (free ${J(axisFree.slice(0, 4))})`);
  const lands = D.land.B13, inLand = D.rails.filter((r) => r.pts.some((p) => !inPoly(p[0], p[1], lands) && p[0] < 212)).map((r) => r.id);
  check(inLand.length === 0, `data: every rail point lies on the paid B13 slab (outside ${J(inLand)})`);
  // containers and the dock lie clear of every rail axis (>= 2.4 m of the strip)
  const clear = [];
  for (const c of D.yard.B13.containers) for (const [dx, dz] of [[-c.l / 2, -c.w / 2], [c.l / 2, -c.w / 2], [c.l / 2, c.w / 2], [-c.l / 2, c.w / 2]]) for (const r of D.rails) for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i], x = c.x + dx, z = c.z + dz, l2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2, t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / l2)); if (Math.hypot(x - a[0] - (b[0] - a[0]) * t, z - a[1] - (b[1] - a[1]) * t) < 1.7) clear.push([c.x, r.id]); }
  check(clear.length === 0 && D.yard.B13.containers.length === 6 && D.yard.B14.docks.length === 1, `data: 6 containers and 1 dock clear of every rail axis (violations ${J(clear.slice(0, 3))})`);
  // the dock is 0.8..2.4 m from the siding axis (plan rule for platforms)
  const dock = D.yard.B14.docks[0], dz = Math.abs(86 - dock[2][1]);
  check(dz >= .8 && dz <= 2.4, `data: the dock edge is ${dz.toFixed(2)} m from the siding axis (0.8..2.4)`);
  check(D.fences.B13.length > 20 && D.fences.B14.length > 10 && D.fences.B12.length > 0 && D.bbox.B14[0] > 140, `data: fences B13 ${D.fences.B13.length}, B14 ${D.fences.B14.length}, B12 ${D.fences.B12.length}; B14 has no slab of its own (walkable ${J(D.walkable.B14)})`);
  // walkable floor of B13 reaches the neighbours: B10 land (z 54) and B12 land (z 88)
  check(D.land.B13[0][1] <= 52 && D.land.B13[2][1] >= 90, 'data: the B13 slab overlaps the land of B10 (z 54) and B12 (z 88): no seam');
}

const PAGE = () => {
  window.__sig = () => {
    const roads = [];
    scene.traverse((o) => { if (!o.isMesh) return; for (let p = o.parent; p; p = p.parent) { if (p.name === 'v70RefinedServiceRoads' || p.name === 'v113UnifiedStarterRoadSurface' || p === cityWorldRuntime?.stageRoads) { roads.push(o); break; } } });
    scene.updateMatrixWorld(true);
    const strs = roads.map((o) => { const b = new THREE.Box3().setFromObject(o); return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => v.toFixed(2)).join(','); }).sort();
    let h = 5381; for (const s of strs.join('|')) h = ((h << 5) + h + s.charCodeAt(0)) | 0;
    return { count: roads.length, hash: h, uuids: roads.map((o) => o.uuid).sort() };
  };
  window.__mpObjects = () => { const n = []; scene.traverse((o) => { if (o.userData && o.userData.masterplanV161 || /^mp161/.test(o.name || '')) n.push(o.name || o.type); }); return n; };
  window.__frame = async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const i = renderer.info; return { calls: i.render.calls, tris: i.render.triangles }; };
  window.__drive = (sx, sz, dx, dz, steps) => {
    player.position.set(sx, 0, sz); playerVelocity.set(0, 0, 0);
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    for (let i = 0; i < steps; i++) {
      camera.getWorldDirection(camForward); camForward.y = 0; camForward.normalize(); camRight.crossVectors(camForward, worldUp).normalize();
      joyVec.z = dx * camForward.x + dz * camForward.z; joyVec.x = dx * camRight.x + dz * camRight.z;
      updatePlayer(1 / 30);
    }
    joyVec.x = joyVec.z = 0; playerVelocity.set(0, 0, 0);
    return { x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2) };
  };
  window.__floorY = (x, z, prefix) => {
    const rc = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0), 0, 60), hits = [];
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || !o.material || o.material.transparent || !o.geometry) return;
      if (prefix && !(o.name || '').startsWith(prefix)) return;
      for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (x < bb.min.x - .1 || x > bb.max.x + .1 || z < bb.min.z - .1 || z > bb.max.z + .1) return;
      try { for (const h of rc.intersectObject(o, false)) if (h.point.y < 3) hits.push({ y: h.point.y, name: o.name || o.type }); } catch (_) {}
    });
    hits.sort((a, b) => b.y - a.y);
    return hits.length ? { y: +hits[0].y.toFixed(3), name: hits[0].name } : null;
  };
  // the player in the light camera's texel coordinates (the shadow frustum centre must be within one texel of the player)
  window.__shadowOffset = () => {
    const c = sun.shadow.camera; sun.updateMatrixWorld(true); sun.target.updateMatrixWorld(true); sun.shadow.updateMatrices(sun);
    const v = new THREE.Vector3(player.position.x, 0, player.position.z).applyMatrix4(c.matrixWorldInverse);
    const t = (c.right - c.left) / sun.shadow.mapSize.x;
    return { lx: +(v.x / t).toFixed(3), ly: +(v.y / t).toFixed(3), texel: +t.toFixed(4), map: sun.shadow.mapSize.x, normalBias: sun.shadow.normalBias, half: c.right };
  };
};

async function run(fn) { try { await fn(); } catch (e) { console.error('FAIL: exception ' + (e && e.stack || e)); process.exitCode = 1; } }

await run(async () => {
  const g = await openGame({ save: 'clear', waitMs: 5000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    const pre = await ev(() => ({ mp: __mpObjects(), flags: { ...masterplanStateV161 } }));
    check(pre.mp.length === 0 && Object.keys(pre.flags).length === 14 && Object.values(pre.flags).every((f) => f === false), `fresh game: no object, fourteen flags all false (${J(pre.flags)})`);
    // phase 1-4 floors are bought in the earlier tests; here the chain B13 needs is restored from a save-shaped object (B02, B04, B08 never bought)
    await ev((flags) => { stageIndex = 10; cityState.reputation = 500; CITY_DISTRICTS.forEach((c, i) => cityState.districtRoads[c.id] = { level: i < 2 ? 3 : 1, pendingUntil: 0, roadsBuilt: true }); window.__TYCOON_ROAD_AUDIT_V59__.syncOuter(); restoreMasterplanV161(flags); MasterplanV161.refresh(); refreshIndustrialPadMarkersV118(); }, FLAGS(PARTIAL));
    await ev(() => { window.__charges = []; const o = tryPayResources; tryPayResources = function (c) { const r = o.apply(this, arguments); if (r && c && c.money) window.__charges.push(c.money); return r; }; });
    const sigBefore = await ev(() => __sig());
    const m5 = () => ev(() => ['B13', 'B14'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join(''));

    // ---- gate matrix
    const gates = await ev(() => {
      const m = () => ['B13', 'B14'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join(''), out = {};
      stageIndex = 10; refreshIndustrialPadMarkersV118(); out.stage10 = m();
      stageIndex = 11; cityState.reputation = 0; refreshIndustrialPadMarkersV118(); out.noRep = m();
      const keep = masterplanStateV161.B12; masterplanStateV161.B12 = false; refreshIndustrialPadMarkersV118(); out.noB12 = m(); masterplanStateV161.B12 = keep;
      stageIndex = 10; refreshIndustrialPadMarkersV118();
      const step = industrialStepV118('mp161-B13'), before = money; const ok = buildIndustrialStepV118(step);
      out.earlyCharge = { ok, spent: before - money };
      stageIndex = 11; refreshIndustrialPadMarkersV118();
      return out;
    });
    check(gates.stage10 === '00' && gates.noRep === '10' && gates.noB12 === '00' && !gates.earlyCharge.ok && gates.earlyCharge.spent === 0, `gate matrix: stage 10 ${gates.stage10}, stage 11 without reputation ${gates.noRep} (meta.phaseInfo[5] has none), without B12 ${gates.noB12}; B14 waits for B13; an early press neither charges nor builds (${J(gates.earlyCharge)})`);
    const stand = {};
    async function buy(id, price) {
      await ev((id) => { money = 1e7; const p = industrialStepV118('mp161-' + id).pos; player.position.copy(p); playerVelocity.set(0, 0, 0); updateTreeInteraction(); window.__charges = []; }, id);
      const owns = await waitForState(page, (id) => { const t = nearestManualTargetV53(), b = document.getElementById('actionBtn'); return t?.step?.id === 'mp161-' + id && !b.hidden && !b.disabled; }, id, { timeout: 25000 });
      check(owns, `${id}: the real #actionBtn is live and owned by this pad (${owns})`);
      const pos = await ev((id) => { const p = industrialStepV118('mp161-' + id).pos; return { x: p.x, z: p.z, access: MasterplanV161.access(p.x, p.z), core: Math.hypot(p.x, p.z) < 69 }; }, id);
      stand[id] = pos;
      check(pos.access || pos.core, `${id}: its purchase circle (${pos.x},${pos.z}) stands on floor the player already owns (paid floor ${pos.access}, old city ${pos.core})`);
      await ev(() => document.getElementById('actionBtn').click());
      await waitForState(page, (id) => masterplanStateV161[id], id, { timeout: 25000 });
      const r = await ev((id) => ({ charged: window.__charges.slice(), step: industrialStepV118('mp161-' + id).cost.money, sig: __sig() }), id);
      check(r.charged.length === 1 && r.charged[0] === price && r.step === price, `${id}: one charge of exactly ${price} (game price ${r.step}, charged ${J(r.charged)})`);
      await ev(() => MasterplanV161.refresh());
      check(await ev((n) => !!scene.getObjectByName(n), P5[id === 'B13' ? 0 : 1]), `${id}: group ${P5[id === 'B13' ? 0 : 1]} exists after the purchase`);
      check(J(r.sig.uuids) === J(sigBefore.uuids) && r.sig.count === sigBefore.count && r.sig.hash === sigBefore.hash, `${id}: road mesh uuids / count / hash unchanged (${r.sig.count}/${r.sig.hash})`);
    }
    const A = (x, z) => ev(([x, z]) => MasterplanV161.access(x, z), [x, z]);
    await buy('B13', 210000);
    check(await m5() === '01', `after B13: B14 appears: ${await m5()}`);
    // before B14 the siding strip is still plain earth: walkable (no invisible wall), the B13 tracks are not
    const early = await ev(() => ({ sidingEarth: MasterplanV161.access(165, 86) && MasterplanV161.access(190, 84.5), dockEarth: MasterplanV161.access(164, 83.5), trackN: MasterplanV161.access(150, 74), sidingGroup: !!scene.getObjectByName('mp161Siding') }));
    check(early.sidingEarth && early.dockEarth && !early.trackN && !early.sidingGroup, `with B13 only: the siding strip and the dock site are still earth (walkable), the main track is not, no siding group (${J(early)})`);
    await buy('B14', 105000);
    check(await m5() === '00', `all bought: no pad left: ${await m5()}`);
    console.log('purchase circles: ' + J(stand));

    // ---- groups, names, tags
    const meshInfo = await ev((P5) => {
      MasterplanV161.refresh();
      const out = {};
      for (const n of P5) {
        const root = scene.getObjectByName(n); let meshes = 0, tris = 0, inst = 0, sleepers = 0; const names = [], bad = [];
        if (!root) { out[n] = null; continue; }
        root.traverse((c) => {
          if (c === root) return; names.push(c.name);
          if (c.isMesh) {
            meshes++; if (c.isInstancedMesh) { inst++; if (/_sleepers$/.test(c.name)) sleepers = c.count; } const gg = c.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3;
            if (!c.userData.v83CollisionIgnore) bad.push('no v83CollisionIgnore: ' + c.name);
            if (/road/i.test(c.name)) bad.push('road in name: ' + c.name);
            if (['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad', 'v70ServiceRoad'].some((t) => c.userData[t])) bad.push('road tag: ' + c.name);
          }
        });
        out[n] = { meshes, inst, sleepers, tris: Math.round(tris), names, bad, rootRoad: /road/i.test(root.name), surfaces: names.filter((x) => /_surface$/.test(x)).length };
      }
      return out;
    }, P5);
    console.log('phase 5 groups (meshes / instanced / sleepers / triangles): ' + J(P5.map((n) => [n, meshInfo[n] && meshInfo[n].meshes, meshInfo[n] && meshInfo[n].inst, meshInfo[n] && meshInfo[n].sleepers, meshInfo[n] && meshInfo[n].tris])));
    check(P5.every((n) => meshInfo[n] && meshInfo[n].bad.length === 0 && !meshInfo[n].rootRoad && meshInfo[n].names.every((x) => !x || x.startsWith('mp161'))), `group names are mp161*, no 'road' in any name, v83CollisionIgnore on every mesh, no road tag (${J(P5.map((n) => meshInfo[n] && meshInfo[n].bad))})`);
    check(P5.every((n) => meshInfo[n].inst === 1 && meshInfo[n].surfaces === 1 && meshInfo[n].meshes <= 4) && meshInfo.mp161Rail.sleepers > 380 && meshInfo.mp161Siding.sleepers > 30, `meshes merged: ${J(P5.map((n) => meshInfo[n].meshes))} (surface with ballast / rails / fence / containers, props, sleepers as ONE InstancedMesh: ${meshInfo.mp161Rail.sleepers} + ${meshInfo.mp161Siding.sleepers} sleepers)`);
    // the track is drawn: ballast bed top, the rail head, the dock top, the container roof, the apron floor
    const draw = await ev(() => { const y = (x, z) => (__floorY(x, z, 'mp161') || {}).y; return { ballast: y(150, 74), rail: y(150, 74.7175), sidingBallast: y(165, 86), dock: y(164, 83.5), container: y(148, 57.4), stack: y(154.4, 57.4), apron: y(160, 60.5), bumper: y(112, 74) }; });
    check(Math.abs(draw.ballast - .18) < .02 && Math.abs(draw.rail - .44) < .03 && Math.abs(draw.sidingBallast - .18) < .02 && Math.abs(draw.dock - .9) < .02 && Math.abs(draw.container - 2.595) < .1 && Math.abs(draw.stack - 2.595) < .1 && Math.abs(draw.apron) < .1 && draw.bumper > .6, `drawn: ballast top ${draw.ballast}, rail head ${draw.rail}, siding ballast ${draw.sidingBallast}, dock ${draw.dock}, container ${draw.container} / ${draw.stack} (the probe ray starts at y 3: only the first level is seen), apron ${draw.apron}, buffer stop ${draw.bumper}`);

    // ---- walkable floor: seams, blocked strips
    const seams = await ev(() => {
      const bad = [], A = (x, z) => { if (!MasterplanV161.access(x, z)) bad.push([x, z]); };
      for (let x = 112; x <= 208; x += 4) { A(x, 53); A(x, 54.5); }                                 // B10's land <-> B13's slab
      for (let x = 112; x <= 136; x += 4) for (const z of [58, 62, 66, 69]) A(x, z);               // free yard apron west of the bumpers of the yard tracks
      for (let x = 166; x <= 200; x += 6) A(x, 60.5);                                              // aisle north of the lead track
      for (let x = 112; x <= 148; x += 6) A(x, 86.5);                                              // south apron west of the siding
      for (let x = 112; x <= 208; x += 8) { A(x, 89.6); A(x, 91); }                                // south of the siding: B13's slab <-> B12's land
      for (let x = 108; x <= 111; x += 1) for (const z of [70, 77, 83]) A(x, z);                   // the free end beyond the bumpers (3 m wide gap)
      return bad;
    });
    check(seams.length <= 4, `no seam: B10 land <-> B13 slab <-> B12 land, the apron north of the yard, the aisles and the end beyond the bumpers are continuous floor (${J(seams.slice(0, 8))})`);
    const blockedPts = await ev(() => {
      const P = { mainN: [[130, 74], [190, 74], [112.5, 74]], mainS: [[130, 80], [190, 80], [206, 80]], between: [[150, 77]], yard: [[160, 66], [150, 66], [165, 66], [145, 62], [143, 62]], lead: [[190, 70.6], [175, 66.2], [200, 73.6]], siding: [[165, 86], [152, 86], [190, 83], [180, 85.7]], dock: [[164, 83.5], [155, 83], [173, 84.5]], containers: [[148, 57.4], [154.4, 57], [160.8, 58], [190.4, 57.4], [196.8, 56.6]], exits: [[211, 74], [211, 80]] };
      const out = {}; for (const k in P) out[k] = P[k].filter(([x, z]) => MasterplanV161.access(x, z)).length;
      return out;
    });
    check(Object.values(blockedPts).every((v) => v === 0), `NOT walkable: both main tracks (ends and middle), the gap between them, the yard tracks, the lead, the siding, the dock, all container stacks, the exits at the map edge (walkable counts ${J(blockedPts)})`);
    // 8-direction pushes into the tracks through the real updatePlayer
    const starts = { south: [[130, 86.5], [160, 89.6], [190, 89.6], [112, 86]], north: [[130, 69], [125, 66], [118, 62]], apron: [[160, 60.5], [176, 60], [200, 60.5], [166, 55]], gap: [[109.5, 77], [109.5, 70]], sidingSide: [[165, 89.8], [150, 89.8]] };
    const probe = [];
    for (const [zone, pts] of Object.entries(starts)) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, pts[0]);
      await page.waitForTimeout(1200);
      probe.push(...await ev(({ zone, pts }) => {
        const out = [];
        for (const [sx, sz] of pts) for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, end = __drive(sx, sz, Math.cos(a), Math.sin(a), 240), px = player.position.x, pz = player.position.z;
          const floor = __floorY(px, pz, 'mp161');
          out.push({ zone, sx, sz, k, end: [end.x, end.z], ok: MasterplanV161.access(px, pz), floorY: floor && floor.y, floorName: floor && floor.name });
        }
        return out;
      }, { zone, pts }));
    }
    const bad = probe.filter((r) => !r.ok || r.floorY === null || Math.abs(r.floorY) > 0.12);
    const moved = probe.filter((r) => Math.hypot(r.end[0] - r.sx, r.end[1] - r.sz) > 3).length;
    check(probe.length === 8 * Object.values(starts).flat().length && bad.length === 0, `${probe.length} pushes of 8 s (8 directions x ${probe.length / 8} starts beside the tracks, the dock, the containers, the gap beyond the bumpers): all end on drawn floor (y within 12 cm), never on a track (bad ${J(bad.slice(0, 4))}; ${moved} travelled > 3 m)`);
    // a run straight at the main track from the south stops in front of the fence
    const run1 = await ev(() => { const a = __drive(130, 87, 0, -1, 300); return { a, access: MasterplanV161.access(a.x, a.z) }; });
    check(run1.a.z > 82.4 && run1.a.z < 86, `walking north at the main track S from the south stops in front of its fence (z ${run1.a.z}, strip edge 82.4)`);
    // fence colliders (long runs) + the fence drawn
    const fence = await ev(() => { const list = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => c.label === 'mp161:prop' && c.hz > 3 && c.hx < .1); return { n: list.length, ok: list.every((c) => c.category === 'decor' && c.flags.player === true) }; });
    check(fence.n >= 6 && fence.ok, `the long yard-fence runs are registered as solid decor colliders (${J(fence)})`);
    // backdrop
    const bd = await ev(() => {
      const o = []; scene.traverse((c) => { if (c.userData && c.userData.v161Backdrop && !c.isGroup) o.push(c); });
      const D = window.MasterplanPortDataV161, near = o.filter((c) => { const b = c.userData.v161Backdrop; return ['B13'].some((id) => { const r = D.bbox[id]; return b.x > r[0] - b.r && b.x < r[2] + b.r && b.z > r[1] - b.r && b.z < r[3] + b.r; }) && MasterplanV161.floor(b.x, b.z); });
      return { total: o.length, nearVisible: near.filter((c) => c.visible).length, near: near.length };
    });
    check(bd.nearVisible === 0, `no backdrop hill / skyline stands on the phase-5 floor (${J(bd)})`);

    // ---- shadows + draw calls
    const sh = [];
    for (const [name, x, z] of [['yard', 160, 60.5], ['dock', 164, 89.8], ['bumpers', 110, 77]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(1500);
      sh.push({ name, ...await ev(() => __shadowOffset()) });
    }
    check(sh.every((s) => Math.abs(s.lx) <= 1 && Math.abs(s.ly) <= 1), `shadow camera centre within one texel of the player at the yard / dock / bumpers (${J(sh.map((s) => [s.name, s.lx, s.ly]))})`);
    const budget = [];
    for (const [name, x, z] of [['yard (160,60.5)', 160, 60.5], ['dock (164,89.8)', 164, 89.8], ['bumpers (110,77)', 110, 77], ['east end (205,89.6)', 205, 89.6], ['B10 north (150,40)', 150, 40], ['chord (102,100)', 102, 100], ['ring (6,70)', 6, 70]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(2500);
      await ev(() => __frame()); await ev(() => __frame());
      const all = await ev(() => __frame());
      const delta = await ev(async (P5) => {
        const mp = []; scene.children.forEach((o) => { if (o.userData && o.userData.masterplanV161 || o.name === 'mp161Sea') mp.push(o); });
        const parts = (o) => o.name === 'mp161Sea' ? [o] : o.children;
        const p5 = mp.filter((o) => P5.includes(o.name));
        const hide = (list) => { const saved = []; list.forEach((o) => parts(o).forEach((c) => { saved.push([c, c.visible]); c.visible = false; })); return saved; };
        const restore = (saved) => saved.forEach(([c, v]) => { c.visible = v; });
        let s1 = hide(p5); const noP5 = await __frame(); restore(s1);
        s1 = hide(mp); const none = await __frame(); restore(s1);
        return { noP5, none };
      }, P5);
      budget.push({ name, calls: all.calls, layer: all.calls - delta.none.calls, phase5: all.calls - delta.noP5.calls, tris: all.tris - delta.none.tris });
    }
    console.log('draw calls (all / whole masterplan layer / phase 5 only), triangles of the layer: ' + J(budget));
    check(budget.every((b) => b.layer <= 40 && b.phase5 <= 14), `the whole masterplan layer costs <= +40 draw calls in the worst frame (max ${Math.max(...budget.map((b) => b.layer))}); phase 5 alone <= +14 (max ${Math.max(...budget.map((b) => b.phase5))})`);

    if (SHOTS) {
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
      for (const [name, x, z] of [['yard', 160, 60.5], ['main-tracks', 130, 86], ['dock', 168, 89.8], ['bumpers', 110, 77], ['east-end', 200, 60.5]]) {
        await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); MasterplanV161.refresh(); }, [x, z]);
        await page.waitForTimeout(3500);
        await page.screenshot({ path: path.join(SHOTS, 'rail-' + name + '.png') });
      }
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST * 3; player.position.set(160, 0, 70); MasterplanV161.refresh(); });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(SHOTS, 'rail-above.png') });
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
    }

    // ---- persistence + first visit
    await ev(() => { player.position.set(176, 0, 60.5); playerVelocity.set(0, 0, 0); });
    await page.waitForTimeout(1500);
    await ev(() => { save.flush(); });
    const savedFlags = await ev(() => JSON.parse(localStorage.getItem(SAVE_KEY)).masterplanV161);
    check(Object.keys(savedFlags).length === 14 && savedFlags.B13 === true && savedFlags.B14 === true && savedFlags.B02 === false, `the save has the fourteen masterplan flags (${J(savedFlags)})`);
    await reloadGame(g, 5000);
    await ev(PAGE);
    const far = await ev(() => ({ flags: { ...masterplanStateV161 }, x: player.position.x, z: player.position.z }));
    check(J(far.flags) === J(FLAGS([...PARTIAL, 'B13', 'B14'])) && Math.abs(far.x - 176) < 1 && Math.abs(far.z - 60.5) < 1, `reload keeps the flags (B02 / B04 / B08 were never bought) and the position on the yard apron (${J(far)})`);
    await ev(() => MasterplanV161.dropGroups());
    await page.waitForTimeout(1500);
    const lazy = await ev(() => Object.fromEntries(['mp161Net', 'mp161North', 'mp161Main', 'mp161M2', 'mp161Rail', 'mp161Siding', 'mp161Sea'].map((n) => [n, !!scene.getObjectByName(n)])));
    check(lazy.mp161Rail && lazy.mp161Siding && lazy.mp161Sea && !lazy.mp161Net && !lazy.mp161North, `lazy build by distance: at the yard the rail groups are built, the port and the north strip are not (${J(lazy)})`);
    const first = await ev(async () => {
      player.position.set(6, 0, -120); playerVelocity.set(0, 0, 0); await __frame(); await __frame();
      const hid = ['mp161Rail', 'mp161Siding'].map((n) => { const o = scene.getObjectByName(n); return !o || o.visible; });
      player.position.set(130, 0, 86.5); playerVelocity.set(0, 0, 0); await __frame(); await __frame();
      const gr = scene.getObjectByName('mp161Rail'), under = __floorY(130, 86.5, 'mp161');
      return { hiddenFar: hid.every((v) => v === false), built: !!gr, visible: gr && gr.visible, floor: under };
    });
    check(first.hiddenFar && first.built && first.visible && first.floor && Math.abs(first.floor.y) <= .12 && /^mp161Rail/.test(first.floor.name), `far groups hide in the north; two frames after a teleport to the yard its floor is drawn (${J(first)})`);
    await ev(() => { player.position.set(130, 0, 86.5); playerVelocity.set(0, 0, 0); save.flush(); });
    await reloadGame(g, 5000);
    await ev(PAGE);
    const rel = await ev(() => ({ x: +player.position.x.toFixed(1), z: +player.position.z.toFixed(1), access: MasterplanV161.access(player.position.x, player.position.z), rail: !!scene.getObjectByName('mp161Rail'), track: MasterplanV161.access(130, 80) }));
    check(Math.abs(rel.x - 130) < 1 && Math.abs(rel.z - 86.5) < 1 && rel.access && rel.rail && !rel.track, `reload keeps the player on the south apron beside the track (${J(rel)})`);
    const sigAfter = await ev(() => __sig());
    check(sigAfter.count === sigBefore.count && sigAfter.hash === sigBefore.hash, `after reload the road signature is still ${sigBefore.count}/${sigBefore.hash}`);
    const reset = await ev(() => { restoreMasterplanV161(null); MasterplanV161.refresh(); return { mp: __mpObjects(), colliders: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => /^mp161:/.test(c.label || '')).length, access: MasterplanV161.access(130, 86.5) || MasterplanV161.access(160, 60.5) }; });
    check(reset.mp.length === 0 && reset.colliders === 0 && !reset.access, `reset clears the groups, the sea, every mp161 collider and the paid floor (${J(reset)})`);
    check(g.errors.length === 0, `no console/page errors (${J(g.errors.slice(0, 4))})`);
    check(g.badResponses.length === 0, 'no 4xx');
  } finally { await g.close(); }
});

// =============================== launch 2: OLD_SAVE ===============================
await run(async () => {
  const g = await openGame({ save: OLD_SAVE, waitMs: 6000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    const o = await ev(() => ({ flags: { ...masterplanStateV161 }, mp: __mpObjects(), markers: ['B01', 'B12', 'B13', 'B14'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), sig: __sig(), stage: stageIndex }));
    check(Object.keys(o.flags).length === 14 && Object.values(o.flags).every((f) => f === false) && o.mp.length === 0 && o.markers.every((m) => !m), `OLD_SAVE: fourteen flags false, no object, no pad (${J({ flags: o.flags, mp: o.mp.length, markers: o.markers, stage: o.stage })})`);
    check(o.sig.count === 51 && o.sig.hash === 648310607, `OLD_SAVE road signature stays 51 / 648310607 (${o.sig.count}/${o.sig.hash})`);
    check(await ev(() => !MasterplanV161.access(150, 60.5) && !MasterplanV161.floor(130, 86.5)), 'OLD_SAVE: no paid floor anywhere (access false)');
    const chain = await ev(() => {
      const r = (d) => { restoreMasterplanV161(d); return Object.entries(masterplanStateV161).filter(([k, v]) => v).map(([k]) => k).join(','); };
      const all = Object.fromEntries(Object.keys(masterplanStateV161).map((k) => [k, true]));
      return { all: r(all), noB12: r({ ...all, B12: false }), noB13: r({ ...all, B13: false }), noB01: r({ ...all, B01: false }), none: r(null) };
    });
    const ALL = IDS.join(',');
    check(chain.all === ALL && chain.noB12 === IDS.slice(0, 11).join(',') && chain.noB13 === IDS.slice(0, 12).join(',') && chain.noB01 === '' && chain.none === '', `restore enforces B12 -> B13 -> B14 (${J(chain)})`);
    await ev(() => { stageIndex = 16; cityState.reputation = 500; refreshIndustrialPadMarkersV118(); });
    const later = await ev(() => ({ markers: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13', 'B14'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), mp: __mpObjects().length }));
    check(later.mp === 0 && later.markers.slice(1).every((m) => !m), `OLD_SAVE at stage 16: no object; B02..B14 stay locked behind B01 (${J(later.markers)})`);
    check(g.errors.length === 0, `OLD_SAVE: no console/page errors (${J(g.errors.slice(0, 4))})`);
  } finally { await g.close(); }
});
