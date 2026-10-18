// Masterplan PHASE 5 (plan B pads B13 "Railway and freight yard" 210 000, B14 "Siding and warehouses" 105 000). Same pipeline as tests/masterplan-phase4.test.mjs
// (compile-port --phase=5, MASTERPLAN_REQUIRES_V161 B13 <- B12, B14 <- B13, masterplanStateV161 + save field, generic cell groups) plus: static track (ballast bed, two rails per segment,
// ONE InstancedMesh of sleepers, buffer stops, container stacks, the loading dock), no trains. Tracks are NOT walkable (blockers, even-odd regions like the walkable floor) and are fenced.
// WALKING MODEL: flat y = 0; the blocked strips, the container stacks and the dock are holes in the floor (masterplanFloorV161 subtracts D.blockers of every bought pad), the yard fence runs
// along the strip boundary, long straight runs also stand in the v83 registry as thin decor colliders.
//   launch 1 (fresh game): data (check, hashes of B01..B12 unchanged, rails / nodes / stations / yard / blockers / fences), gate matrix (stage 11 + chain), exact prices 210000 / 140000..105000
//   through the real #actionBtn, groups / names / tags / sleeper InstancedMesh, seams, tracks not walkable, 8-direction pushes, draw-call budget (layer <= +40, phase 5 <= +10), save/reload, reset.
//   launch 2 (OLD_SAVE): fourteen flags false, no objects, signature 51/648310607, restore chain.
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
const HASH = { B01: 'b72aec06e08d', B02: 'df807cbb0355', B03: 'fecb9bf1aaaa', B04: '79a2c88d6ea7', B05: '7f9663c3e0b4', B06: 'bca9326a3427', B07: '49df0862c6c3', B08: '02a489d840a2', B09: 'ade4e6f0990b', B10: '73cf7652cb57', B11: '54615d10db48', B12: '0682bf34c3d7' };   // phase 1-4 data per pad, must never change
const FLAGS = (list) => Object.fromEntries([...IDS, 'B15', 'B16', 'B17', 'B18'].map((id) => [id, list.includes(id)]));
const PARTIAL = ['B01', 'B03', 'B05', 'B06', 'B07', 'B09', 'B10', 'B11', 'B12'];   // the chain B13 needs (B02, B04, B08 were never bought)

// ---- offline
{
  const r = spawnSync('node', ['tools/masterplan/compile-port.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  check(r.status === 0, `compile-port --check: ${r.stdout.trim()}`);
  const v = spawnSync('node', ['tools/masterplan/validate.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const fails = (v.stdout.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5, 60));
  console.log('validate.mjs FAIL rows (known, draft plan B): ' + J(fails));
  check(fails.length <= 3 && /НАРУШЕНИЙ: 3/.test(v.stdout), `validator: no new violations (${fails.length} FAIL rows, "${(v.stdout.match(/НАРУШЕНИЙ: \d+/) || [''])[0]}")`);
}
{
  const vm = await import('node:vm');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/masterplan-port-data-v161.js'), 'utf8'), ctx);
  const D = ctx.window.MasterplanPortDataV161;
  const hash = (id) => crypto.createHash('sha1').update(J([D.surfaces[id], D.boundaries[id], D.walkable[id], D.bbox[id], D.land[id] || null])).digest('hex').slice(0, 12);
  check(Object.keys(HASH).every((id) => hash(id) === HASH[id]), `data: B01..B12 compiled data byte-identical to phase 4 (${J(Object.keys(HASH).map(hash))})`);
  const inPoly = (x, z, poly) => { let y = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) y = !y; } return y; };
  const inRegion = (x, z, loops) => { let y = false; for (const l of loops) if (inPoly(x, z, l)) y = !y; return y; };
  check(D.pads.length >= 14 && D.pads.slice(12, 14).every((p) => p.gateStage === 11 && p.rep === undefined) && J(D.pads.slice(12, 14).map((p) => p.money)) === '[210000,105000]' && J(D.pads.slice(12, 14).map((p) => p.requires)) === '[["B12"],["B13"]]' && J(D.pads.slice(12, 14).map((p) => p.group)) === J(P5), 'data: B13 / B14: stage 11, no reputation, plan prices 210000 / 105000, requires B12 / B13, groups mp161Rail / mp161Siding');
  check(D.rails.length === 10 && D.rails.every((r) => r.level === 0 && (r.minR === null || r.minR >= 40)) && D.railNodes.length === 12 && D.stations.filter((x) => x.id !== 'ST-PAX').length === 2 && D.rails.filter((r) => r.pad === 'B13').length === 8 && D.rails.filter((r) => r.pad === 'B14').length === 2, 'data: 10 track pieces (8 + 2), level 0, curves R >= 40, 12 rail nodes, 2 stations (ST-FRT, ST-WH)');
  check(D.lots.filter((l) => l.pad === 'B13' || l.pad === 'B14').length === 0 && D.edges.filter((e) => e.pad === 'B13' || e.pad === 'B14').length === 0, 'data: phase 5 has no street edges and no parcels (the plan gives B13 / B14 only track)');
  // every track point is a hole of the floor (blocker) and the blockers cover the whole track strip
  const blockedAt = (x, z) => Object.keys(D.blockers).some((id) => inPoly(x, z, D.bbox[id] ? [[D.bbox[id][0], D.bbox[id][1]], [D.bbox[id][2], D.bbox[id][1]], [D.bbox[id][2], D.bbox[id][3]], [D.bbox[id][0], D.bbox[id][3]]] : []) && D.blockers[id].some((r) => inRegion(x, z, r)));
  const notBlocked = [];
  for (const r of D.rails) for (let i = 1; i < r.pts.length; i++) for (let t = 0; t <= 1; t += .5) { const x = r.pts[i - 1][0] + (r.pts[i][0] - r.pts[i - 1][0]) * t, z = r.pts[i - 1][1] + (r.pts[i][1] - r.pts[i - 1][1]) * t; if (x <= 211.9 && !blockedAt(x, z)) notBlocked.push([r.id, x, z]); }
  check(notBlocked.length === 0, `data: every point of every track lies inside a blocker (${J(notBlocked.slice(0, 4))})`);
  // the free floor of B13 is one connected piece with the old floor (flood fill on a 1 m grid from B10), no pocket between the two main tracks
  const wk = (x, z) => { for (const id in D.walkable) { const b = D.bbox[id]; if (!b || x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue; if (D.walkable[id].some((r) => inRegion(x, z, r))) { for (const k in D.blockers) { const bb = D.bbox[k]; if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue; if (D.blockers[k].some((r) => inRegion(x, z, r))) return false; } return true; } } return false; };
  const seen = new Set(['100,60']), q = [[100, 60]];
  while (q.length) { const [x, z] = q.pop(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (x + dx) + ',' + (z + dz); if (seen.has(k) || !wk(x + dx, z + dz)) continue; seen.add(k); q.push([x + dx, z + dz]); } }
  let free = 0; const pockets = [];
  for (let x = 108; x <= 212; x++) for (let z = 52; z <= 90; z++) if (wk(x, z)) { free++; if (!seen.has(x + ',' + z)) pockets.push([x, z]); }
  check(free > 1800 && pockets.length === 0, `data: the free floor of B13 (${free} grid points) is connected to the old floor, no walled-in pocket (${J(pockets.slice(0, 5))})`);
  check(D.fences.B13.length > 100 && D.fences.B14.length > 30 && D.yard.B13.containers.length === 6 && D.yard.B14.docks.length === 1 && D.blockers.B13.length >= 6 && D.blockers.B14.length >= 1, `data: fences ${D.fences.B13.length} + ${D.fences.B14.length}, 6 container stacks, 1 dock, blockers ${D.blockers.B13.length} + ${D.blockers.B14.length}`);
  const land = D.land.B13;
  check(Math.min(...land.map((p) => p[1])) >= 52 && Math.max(...land.map((p) => p[1])) <= 90, 'data: the B13 slab lies between z 52 (B10 floor) and z 90, the road C100 (z 100) and the M2 land stay untouched');
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
  window.__frame = async () => { const sm = renderer.shadowMap, keep = sm.autoUpdate; sm.autoUpdate = false; sun.shadow.needsUpdate = false; let calls = 1e9, tris = 1e9; for (let k = 0; k < 3; k++) { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const i = renderer.info; calls = Math.min(calls, i.render.calls); tris = Math.min(tris, i.render.triangles); } sm.autoUpdate = keep; return { calls, tris }; };   // main-pass draw calls only: whether a frame redraws the shadow map (the whole scene again) made the layer budget flaky
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
    check(pre.mp.length === 0 && Object.keys(pre.flags).length >= 14 && Object.values(pre.flags).every((f) => f === false), `fresh game: no object, fourteen flags all false (${J(pre.flags)})`);
    // the chain B13 needs is restored from a save-shaped object (B02, B04, B08 never bought)
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
    await buy('B13', 210000);
    check(await m5() === '01', `after B13: B14 appears: ${await m5()}`);
    await buy('B14', 105000);
    check(await m5() === '00', `all bought: no pad left: ${await m5()}`);
    console.log('purchase circles: ' + J(stand));

    // ---- groups, names, tags
    const meshInfo = await ev((P5) => {
      MasterplanV161.refresh();
      const out = {};
      for (const n of P5) {
        const root = scene.getObjectByName(n); let meshes = 0, tris = 0, inst = 0; const names = [], bad = [];
        if (!root) { out[n] = null; continue; }
        root.traverse((c) => {
          if (c === root) return; names.push(c.name);
          if (c.isMesh) {
            meshes++; if (c.isInstancedMesh) inst++; const gg = c.geometry; tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3;
            if (!c.userData.v83CollisionIgnore) bad.push('no v83CollisionIgnore: ' + c.name);
            if (/road/i.test(c.name)) bad.push('road in name: ' + c.name);
            if (['v59RoadDeck', 'v86StageRoad', 'v66ServiceRoad', 'v116PersistentRoad', 'v70ServiceRoad'].some((t) => c.userData[t])) bad.push('road tag: ' + c.name);
          }
        });
        out[n] = { meshes, inst, tris: Math.round(tris), names, bad, rootRoad: /road/i.test(root.name), sleepers: names.filter((x) => /_sleepers$/.test(x)).length };
      }
      return out;
    }, P5);
    console.log('phase 5 groups (meshes / instanced / triangles): ' + J(P5.map((n) => [n, meshInfo[n] && meshInfo[n].meshes, meshInfo[n] && meshInfo[n].inst, meshInfo[n] && meshInfo[n].tris])));
    check(P5.every((n) => meshInfo[n] && meshInfo[n].bad.length === 0 && !meshInfo[n].rootRoad && meshInfo[n].names.every((x) => !x || x.startsWith('mp161'))), `group names are mp161*, no 'road' in any name, v83CollisionIgnore on every mesh, no road tag (${J(P5.map((n) => meshInfo[n] && meshInfo[n].bad))})`);
    check(P5.every((n) => meshInfo[n].sleepers === 1 && meshInfo[n].inst === 1 && meshInfo[n].meshes <= 4), `meshes merged: ${J(P5.map((n) => meshInfo[n].meshes))}, one sleeper InstancedMesh per pad`);
    const sl = await ev((P5) => P5.map((n) => { const m = scene.getObjectByName(n + '_sleepers'); return m && m.count; }), P5);
    check(sl.every((n) => n > 50), `sleepers drawn as one InstancedMesh per pad (${J(sl)})`);

    // ---- walkable floor: seams, tracks not walkable
    const seams = await ev(() => {
      const bad = [], A = (x, z) => { if (!MasterplanV161.access(x, z)) bad.push([x, z]); };
      for (let x = 112; x <= 208; x += 4) { A(x, 54.5); if (x <= 140 || x >= 190) A(x, 88); }   // freight yard north apron, south apron (the siding strip blocks z 83..89 between x 150 and 178)
      for (const z of [54, 58, 62, 90 - 2]) { A(110, z); } for (const z of [54, 58, 62, 88]) { A(210.5, z); }   // the ends of the slab beside the bumpers / the exits
      for (let x = 100; x <= 115; x += 3) { A(x, 60); A(x, 54); }                                            // B10 floor <-> B13 slab
      return bad;
    });
    check(seams.length === 0, `no seam: the yard aprons, the slab ends and the join with the B10 floor are continuous (${J(seams.slice(0, 6))})`);
    const tracks = await ev(() => {
      const D = window.MasterplanPortDataV161, bad = [], tot = { n: 0 };
      for (const r of D.rails) for (let i = 1; i < r.pts.length; i++) for (let t = 0; t <= 1; t += .25) { const x = r.pts[i - 1][0] + (r.pts[i][0] - r.pts[i - 1][0]) * t, z = r.pts[i - 1][1] + (r.pts[i][1] - r.pts[i - 1][1]) * t; if (x > 211.9) continue; tot.n++; if (MasterplanV161.access(x, z) || MasterplanV161.floor(x, z)) bad.push([r.id, +x.toFixed(1), +z.toFixed(1)]); }
      const stacks = D.yard.B13.containers.map((c) => MasterplanV161.access(c.x, c.z)), dock = MasterplanV161.access(164, 83.7);
      return { bad, n: tot.n, stacks, dock };
    });
    check(tracks.n > 100 && tracks.bad.length === 0 && tracks.stacks.every((v) => v === false) && tracks.dock === false, `not walkable: ${tracks.n} points along all 10 track pieces, 6 container stacks, the dock (${J(tracks)})`);

    // ---- pushes in 8 directions at every edge of the rail floor, through the real updatePlayer
    const starts = {
      apronN: [[120, 55], [150, 56], [180, 54], [205, 56], [130, 52.5]],
      apronS: [[120, 88], [150, 89], [190, 89], [205, 88], [140, 85]],
      tracks: [[120, 68], [130, 85], [170, 69], [190, 72], [150, 78]],
      yard: [[146, 59], [165, 59], [200, 59], [165, 64], [175, 63.5]],
      ends: [[110, 60], [110, 86], [210.5, 60], [210.5, 88], [211.5, 65]],
      siding: [[160, 80.5], [180, 80.5], [165, 90], [150, 86.5]],
    };
    const probe = [];
    for (const [zone, pts] of Object.entries(starts)) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, pts[0]);
      await page.waitForTimeout(1200);
      probe.push(...await ev(({ zone, pts }) => {
        const out = [];
        for (const [sx, sz] of pts) for (let k = 0; k < 8; k++) {
          if (!MasterplanV161.access(sx, sz)) continue;   // start points inside a fenced strip / stack are skipped (the data checks cover them)
          const a = k * Math.PI / 4, end = __drive(sx, sz, Math.cos(a), Math.sin(a), 240);
          const px = player.position.x, pz = player.position.z, inCore = Math.abs(px) <= 69.01 && Math.abs(pz) <= 69.01;
          const D = window.MasterplanPortDataV161;
          const onTrack = D.rails.some((r) => { for (let i = 1; i < r.pts.length; i++) { const A = r.pts[i - 1], B = r.pts[i], dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - A[0]) * dx + (pz - A[1]) * dz) / l2)); if (Math.hypot(px - (A[0] + dx * t), pz - (A[1] + dz * t)) < 1.8 && px <= 211.9) return true; } return false; });
          const floor = __floorY(px, pz, 'mp161');
          out.push({ zone, sx, sz, k, end: [end.x, end.z], ok: (inCore || MasterplanV161.access(px, pz)) && !onTrack, floorY: inCore ? 0 : floor && floor.y, floorName: inCore ? 'core' : floor && floor.name });
        }
        return out;
      }, { zone, pts }));
    }
    const bad = probe.filter((r) => !r.ok || r.floorY === null || Math.abs(r.floorY) > 0.12 || /sea|water|estuary/i.test(r.floorName || ''));
    const moved = probe.filter((r) => Math.hypot(r.end[0] - r.sx, r.end[1] - r.sz) > 3).length;
    check(probe.length >= 8 * 15 && bad.length === 0, `${probe.length} pushes of 8 s (8 directions x ${probe.length / 8} starts at the aprons, the track fences, the yard, the slab ends, the siding): all end on drawn floor within 12 cm, never on a track (bad ${J(bad.slice(0, 3))}; moved > 3 m: ${moved})`);
    console.log('floor names under the pushes: ' + J([...new Set(probe.map((r) => r.floorName))]));
    // the yard fence is a real collider for the long runs
    const fence = await ev(() => { const list = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => c.label === 'mp161:prop' && c.hz > 3 && c.hx < .08); return { n: list.length, ok: list.every((c) => c.category === 'decor' && c.flags.player === true) }; });
    check(fence.n >= 4 && fence.ok, `the long yard-fence runs are registered as solid thin decor colliders (${J(fence)})`);
    // crossing attempt: from the north apron straight south through the tracks must stop at the fence
    const cross = await ev(() => { const a = __drive(120, 55, 0, 1, 400); return { a, access: MasterplanV161.access(a.x, a.z) }; });
    check(cross.a.z < 71 && cross.a.z > 60 && cross.access, `walking south from the north apron stops at the container stack / yard fence before the main tracks (${J(cross)})`);

    // backdrop
    const bd = await ev(() => {
      const o = []; scene.traverse((c) => { if (c.userData && c.userData.v161Backdrop && !c.isGroup) o.push(c); });
      const D = window.MasterplanPortDataV161, near = o.filter((c) => { const b = c.userData.v161Backdrop; return ['B13'].some((id) => { const r = D.bbox[id]; return b.x > r[0] - b.r && b.x < r[2] + b.r && b.z > r[1] - b.r && b.z < r[3] + b.r; }) && MasterplanV161.floor(b.x, b.z); });
      return { total: o.length, nearVisible: near.filter((c) => c.visible).length, near: near.length };
    });
    check(bd.nearVisible === 0, `no backdrop hill / skyline stands on the phase-5 floor (${J(bd)})`);

    // ---- shadows follow the player
    const sh = [];
    for (const [name, x, z] of [['spawn', -2.6, -.5], ['yard', 165, 60], ['siding', 160, 80.5], ['east end', 208, 60]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(1500);
      sh.push({ name, ...await ev(() => __shadowOffset()) });
    }
    check(sh.every((s) => Math.abs(s.lx) <= 1 && Math.abs(s.ly) <= 1), `shadow camera centre within one texel of the player at spawn / yard / siding / east end (texel ${sh[0].texel} m)`);

    // ---- draw calls
    const budget = [];
    for (const [name, x, z] of [['B10 edge (110,56)', 110, 56], ['yard (165,60)', 165, 60], ['main tracks (140,86)', 140, 86], ['siding (160,80)', 160, 80], ['east (205,60)', 205, 60], ['M2 land (102,120)', 102, 120]]) {
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
    check(budget.every((b) => b.layer <= 40 && b.phase5 <= 10), `the whole masterplan layer costs <= +40 draw calls in the worst frame (max ${Math.max(...budget.map((b) => b.layer))}); phase 5 alone <= +10 (main pass; max ${Math.max(...budget.map((b) => b.phase5))})`);

    if (SHOTS) {
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
      for (const [name, x, z] of [['rail-yard', 165, 58], ['rail-main', 140, 86], ['rail-switch', 200, 76], ['rail-siding', 160, 80.5], ['rail-bumper', 116, 70]]) {
        await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); MasterplanV161.refresh(); }, [x, z]);
        await page.waitForTimeout(3500);
        await page.screenshot({ path: path.join(SHOTS, name + '.png') });
      }
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST * 3; player.position.set(160, 0, 70); MasterplanV161.refresh(); });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(SHOTS, 'rail-above.png') });
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
    }

    // ---- persistence + first visit
    await ev(() => { player.position.set(165, 0, 60); playerVelocity.set(0, 0, 0); });
    await page.waitForTimeout(1500);
    await ev(() => { save.flush(); });
    const savedFlags = await ev(() => JSON.parse(localStorage.getItem(SAVE_KEY)).masterplanV161);
    check(Object.keys(savedFlags).length >= 14 && savedFlags.B13 === true && savedFlags.B14 === true && savedFlags.B02 === false, `the save has the fourteen masterplan flags (${J(savedFlags)})`);
    await reloadGame(g, 5000);
    await ev(PAGE);
    const far = await ev(() => ({ flags: { ...masterplanStateV161 }, x: player.position.x, z: player.position.z }));
    check(J(far.flags) === J(FLAGS([...PARTIAL, 'B13', 'B14'])) && Math.abs(far.x - 165) < 1 && Math.abs(far.z - 60) < 1, `reload keeps the flags and the position on the yard floor (${J(far)})`);
    await ev(() => MasterplanV161.dropGroups());
    await page.waitForTimeout(1500);
    const lazy = await ev(() => Object.fromEntries(['mp161Net', 'mp161North', 'mp161Rail', 'mp161Siding', 'mp161Sea'].map((n) => [n, !!scene.getObjectByName(n)])));
    check(lazy.mp161Rail && lazy.mp161Siding && lazy.mp161Sea && !lazy.mp161Net && !lazy.mp161North, `lazy build by distance: from the yard the rail groups are built, the port and the north strip are not (${J(lazy)})`);
    const first = await ev(async () => {
      player.position.set(6, 0, -120); playerVelocity.set(0, 0, 0); await __frame(); await __frame();
      const hid = ['mp161Rail', 'mp161Siding'].map((n) => { const o = scene.getObjectByName(n); return !o || o.visible; });
      player.position.set(150, 0, 56); playerVelocity.set(0, 0, 0); await __frame(); await __frame();
      const gr = scene.getObjectByName('mp161Rail'), under = __floorY(150, 56, 'mp161');
      return { hiddenFar: hid.every((v) => v === false), built: !!gr, visible: gr && gr.visible, floor: under };
    });
    check(first.hiddenFar && first.built && first.visible && first.floor && Math.abs(first.floor.y) <= .12, `far groups hide in the north; two frames after a teleport to the yard its floor is drawn (${J(first)})`);
    const sigAfter = await ev(() => __sig());
    check(sigAfter.count === sigBefore.count && sigAfter.hash === sigBefore.hash, `after reload the road signature is still ${sigBefore.count}/${sigBefore.hash}`);
    const reset = await ev(() => { restoreMasterplanV161(null); MasterplanV161.refresh(); return { mp: __mpObjects(), colliders: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => /^mp161/.test(c.label || '')).length, access: MasterplanV161.access(165, 60) }; });
    check(reset.mp.length === 0 && reset.colliders === 0 && !reset.access, `reset clears the groups, every mp161 collider and the paid floor (${J(reset)})`);
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
    check(Object.keys(o.flags).length >= 14 && Object.values(o.flags).every((f) => f === false) && o.mp.length === 0 && o.markers.every((m) => !m), `OLD_SAVE: fourteen flags false, no object, no pad (${J({ flags: o.flags, mp: o.mp.length, markers: o.markers, stage: o.stage })})`);
    check(o.sig.count === 51 && o.sig.hash === 648310607, `OLD_SAVE road signature stays 51 / 648310607 (${o.sig.count}/${o.sig.hash})`);
    check(await ev(() => !MasterplanV161.access(165, 60) && !MasterplanV161.floor(165, 60)), 'OLD_SAVE: no paid floor anywhere (access false)');
    const chain = await ev(() => {
      const r = (d) => { restoreMasterplanV161(d); return Object.entries(masterplanStateV161).slice(10, 14).map(([k, v]) => k + (v ? '1' : '0')).join(' '); };
      const all = Object.fromEntries(Object.keys(masterplanStateV161).map((k) => [k, true]));
      return { all: r(all), noB12: r({ ...all, B12: false }), noB13: r({ ...all, B13: false }), none: r(null) };
    });
    check(chain.all === 'B111 B121 B131 B141' && chain.noB12 === 'B111 B120 B130 B140' && chain.noB13 === 'B111 B121 B130 B140' && chain.none === 'B110 B120 B130 B140', `restore chain B12 -> B13 -> B14 (${J(chain)})`);
    await ev(() => { stageIndex = 16; cityState.reputation = 500; refreshIndustrialPadMarkersV118(); });
    const later = await ev((IDS) => ({ markers: IDS.map((id) => industrialPadMarkersV118.has('mp161-' + id)), mp: __mpObjects().length }), IDS);
    check(later.mp === 0 && later.markers.slice(1).every((m) => !m), `OLD_SAVE at stage 16: no object; B02..B14 stay locked behind B01 (${J(later.markers)})`);
    check(g.errors.length === 0, `OLD_SAVE: no console/page errors (${J(g.errors.slice(0, 4))})`);
  } finally { await g.close(); }
});
