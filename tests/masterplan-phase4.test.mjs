// Masterplan PHASE 4 (plan B pads B11 "South avenue and South street" 70 000, B12 "M2 and interchange IC-1" 140 000). Same pipeline as tests/masterplan-phase3.test.mjs
// (compile-port --phase=4, MASTERPLAN_REQUIRES_V161 B11 <- B10, B12 <- B11, masterplanStateV161 + save field, generic cell groups) plus: the M2 expressway in a 3 m open cut under the Chord
// (trench drawn from the plan profile with walls, the sea plane open above it), the overpass deck (level 0) crossing the cut, vehicle-only expressway / ramps (holes in the walkable floor,
// jersey barriers on their boundary), the floors stopping 4 m before the estuary (z 192).
// WALKING MODEL (documented decision): every walkable floor is flat y = 0, no height logic; the cut, the M2 carriageway and the four ramps are NOT walkable (holes in the pad's polygon + visible
// barriers), the chord crosses the cut on the deck (walkable, level 0 as in the plan), the shore is the edge of the slab.
//   launch 1 (fresh game): data (check, hashes of B01..B10 unchanged, lots 10 / 3, holes, fences), gate matrix (stage 10 + chain, no reputation in phaseInfo[4]), exact prices 70000 / 140000 through the real
//   #actionBtn, groups / names / tags / one surface mesh per pad, seams (avenue, South street, M2 arterial, frontage streets, deck), outside (water, cut, M2, ramps), 8-direction pushes at every edge,
//   trench depth by raycast, deck crossing, shadows at the south end, draw-call budget (layer <= +40, phase 4 <= +14), save/reload at a spot on the new floor, lazy build, reset.
//   launch 2 (OLD_SAVE): twelve flags false, no objects, signature 51/648310607, restore chain.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openGame, reloadGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IDS = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12'];
const P4 = ['mp161South', 'mp161M2'];
const HASH = { B01: 'b72aec06e08d', B02: 'df807cbb0355', B03: 'fecb9bf1aaaa', B04: '79a2c88d6ea7', B05: '7f9663c3e0b4', B06: 'bca9326a3427', B07: '49df0862c6c3', B08: '02a489d840a2', B09: 'ade4e6f0990b', B10: '73cf7652cb57' };   // phase 1-3 data per pad, must never change
const FLAGS = (list) => Object.fromEntries([...IDS, 'B13', 'B14', 'B15', 'B16', 'B17', 'B18'].map((id) => [id, list.includes(id)]));
const PARTIAL = ['B01', 'B03', 'B05', 'B06', 'B07', 'B09', 'B10'];   // the chain B11 needs (B02, B04, B08 were never bought)

// ---- offline
{
  const r = spawnSync('node', ['tools/masterplan/compile-port.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  check(r.status === 0, `compile-port --check: ${r.stdout.trim()}`);
  const v = spawnSync('node', ['tools/masterplan/validate.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const fails = (v.stdout.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5, 60));
  console.log('validate.mjs FAIL rows (known, draft plan B): ' + J(fails));
  check(fails.length <= 3 && /НАРУШЕНИЙ: 3/.test(v.stdout), `validator: no new violations (${fails.length} FAIL rows, "${(v.stdout.match(/НАРУШЕНИЙ: \d+/) || [''])[0]}")`);
  const red = ((v.stdout.match(/нет бесполезных[^\n]*\|\s*(.*)$/m) || [, ''])[1] || '').trim().split(/\s+/);
  check(!red.some((x) => /^B-(Q-|C100-|S-|M2-|IC1-|H-S-)/.test(x)), `validator: no phase-4 edge is flagged redundant (left: ${red.join(' ')})`);
}
{
  const vm = await import('node:vm');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/masterplan-port-data-v161.js'), 'utf8'), ctx);
  const D = ctx.window.MasterplanPortDataV161;
  const hash = (id) => crypto.createHash('sha1').update(J([D.surfaces[id], D.boundaries[id], D.walkable[id], D.bbox[id], D.land[id] || null])).digest('hex').slice(0, 12);
  check(Object.keys(HASH).every((id) => hash(id) === HASH[id]), `data: B01..B10 compiled data byte-identical to phase 3 (${J(Object.keys(HASH).map(hash))})`);
  const inPoly = (x, z, poly) => { let y = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) y = !y; } return y; };
  const inRegion = (x, z, loops) => { let y = false; for (const l of loops) if (inPoly(x, z, l)) y = !y; return y; };
  const tris = [];
  for (const id of ['B11', 'B12']) for (const k of ['walk', 'asphalt']) for (const c of D.surfaces[id][k]) for (let i = 0; i < c.positions.length; i += 9) { const P = c.positions, a = [P[i], P[i + 2]], b = [P[i + 3], P[i + 5]], cc = [P[i + 6], P[i + 8]]; tris.push([Math.min(a[0], b[0], cc[0]), Math.min(a[1], b[1], cc[1]), Math.max(a[0], b[0], cc[0]), Math.max(a[1], b[1], cc[1]), ...a, ...b, ...cc]); }
  const side = (px, pz, ax, az, bx, bz) => (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const inTri = (x, z, t) => { if (x < t[0] - 1e-6 || x > t[2] + 1e-6 || z < t[1] - 1e-6 || z > t[3] + 1e-6) return false; const d1 = side(x, z, t[4], t[5], t[6], t[7]), d2 = side(x, z, t[6], t[7], t[8], t[9]), d3 = side(x, z, t[8], t[9], t[4], t[5]); return !((d1 < -1e-7 || d2 < -1e-7 || d3 < -1e-7) && (d1 > 1e-7 || d2 > 1e-7 || d3 > 1e-7)); };
  let tested = 0; const holes = [];
  for (const id of ['B11', 'B12']) {
    const b = D.bbox[id];
    for (let x = Math.floor(b[0]); x <= b[2]; x += 1) for (let z = Math.floor(b[1]); z <= b[3]; z += 1) {
      if (!D.walkable[id].some((r) => inRegion(x, z, r))) continue;
      tested++;
      const slab = inPoly(x, z, D.land[id]) && !(D.landHoles[id] || []).some((h) => inPoly(x, z, h));
      if (!slab && !tris.some((t) => inTri(x, z, t))) holes.push([id, x, z]);
    }
  }
  check(holes.length === 0 && tested > 12000, `data: every walkable point of B11 / B12 (${tested} grid points) lies on a drawn triangle or on the slab outside the open cut (holes ${J(holes.slice(0, 5))})`);
  const wk = (x, z) => IDS.some((id) => D.walkable[id] && D.bbox[id] && x >= D.bbox[id][0] && x <= D.bbox[id][2] && z >= D.bbox[id][1] && z <= D.bbox[id][3] && D.walkable[id].some((r) => inRegion(x, z, r)));
  const e = (id) => D.edges.find((q) => q.id === id), vehicle = D.edges.filter((q) => q.pad === 'B12' && (q.cls === 'ramp' || q.cls === 'expressway'));
  const onVehicle = [];
  for (const q of vehicle) for (let i = 1; i < q.pts.length; i++) for (let t = 0; t <= 1; t += .25) { const x = q.pts[i - 1][0] + (q.pts[i][0] - q.pts[i - 1][0]) * t, z = q.pts[i - 1][1] + (q.pts[i][1] - q.pts[i - 1][1]) * t; if (wk(x, z) && !(Math.abs(x - 102) < 5.2 || z > 176 || z < 104.5 || (Math.abs(z - 140) < 5 && x < 33))) onVehicle.push([q.id, +x.toFixed(1), +z.toFixed(1)]); }
  check(vehicle.length === 8 && onVehicle.length === 0, `data: the 4 expressway pieces and 4 ramps are not walkable anywhere except where a street's floor lies over them (${J(onVehicle.slice(0, 4))})`);
  check(D.pads.length >= 12 && D.pads.slice(10, 12).every((p) => p.gateStage === 10 && p.rep === undefined) && J(D.pads.slice(10, 12).map((p) => p.money)) === '[70000,140000]' && J(D.pads.slice(10, 12).map((p) => p.requires)) === '[["B10"],["B11"]]' && D.pads.slice(10, 12).map((p) => p.group).join() === 'mp161South,mp161M2', 'data: B11 / B12: stage 10, no reputation (meta.phaseInfo[4]), plan prices 70000 / 140000, requires B10 / B11, groups mp161South / mp161M2');
  check(D.lots.filter((l) => l.pad === 'B11').length === 10 && D.lots.filter((l) => l.pad === 'B12').length === 3 && J(D.landHoles) === J({ B12: [[[50, 131], [154, 131], [154, 149], [50, 149]]] }) && D.fences.B12.length > 100 && D.fences.B12.every((f) => f.length === 4), `data: 10 / 3 parcels, the open cut 50..154 x 131..149 (clear span 18 of the overpass), ${D.fences.B12.length} barrier segments`);
  check(e('B-M2-3').trench.depth === 3 && e('B-H-S-2').overpass.over === 'B-M2-3' && D.edges.filter((q) => q.pad === 'B12' && q.cls === 'ramp').every((q) => q.minR === 31.5), 'data: trench depth 3, overpass over B-M2-3, ramps R 31.5');
  const req = {}; for (const p of D.pads) req[p.id] = p.requires;
  const chain = (id, seen = new Set()) => { if (seen.has(id)) return seen; seen.add(id); (req[id] || []).forEach((r) => chain(r, seen)); return seen; };
  const bad = [];
  for (const l of D.lots.filter((l) => l.pad >= 'B11')) for (const q of [...l.poly, l.door]) { if (![...chain(l.pad)].some((id) => D.land[id] && inPoly(q[0], q[1], D.land[id]))) bad.push([l.id, l.pad, q]); }
  check(bad.length === 0, `data: all 13 phase-4 parcels (corners and doors) stand on land of their pad or of a pad it requires (${J(bad.slice(0, 3))})`);
  check(Math.max(...D.land.B11.map((p) => p[1]), ...D.land.B12.map((p) => p[1])) <= 188 && 192 - 188 >= 4, 'data: the south floors end at z 188, the estuary starts at z 192 (W-EST), the bridge BR-S is a later phase');
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
  window.__frame = async () => { const sm = renderer.shadowMap, keep = sm.autoUpdate; sm.autoUpdate = false; sun.shadow.needsUpdate = false; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); sm.autoUpdate = keep; const i = renderer.info; return { calls: i.render.calls, tris: i.render.triangles }; };   // main-pass draw calls only: whether a frame redraws the shadow map (the whole scene again) made the layer budget flaky
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
    // (the absolute fresh signature 17/678830722 is asserted by tests/sawmill-area.test.mjs / masterplan-port-verify.test.mjs; here every purchase must leave the live signature untouched, and OLD_SAVE keeps 51/648310607)
    const pre = await ev(() => ({ mp: __mpObjects(), flags: { ...masterplanStateV161 } }));
    check(pre.mp.length === 0 && Object.keys(pre.flags).length >= 12 && Object.values(pre.flags).every((f) => f === false), `fresh game: no object, twelve flags all false (${J(pre.flags)})`);
    // phase 1-3 floors are bought in the earlier tests; here the chain B11 needs is restored from a save-shaped object (B02, B04, B08 never bought)
    await ev((flags) => { stageIndex = 9; cityState.reputation = 500; CITY_DISTRICTS.forEach((c, i) => cityState.districtRoads[c.id] = { level: i < 2 ? 3 : 1, pendingUntil: 0, roadsBuilt: true }); window.__TYCOON_ROAD_AUDIT_V59__.syncOuter(); restoreMasterplanV161(flags); MasterplanV161.refresh(); refreshIndustrialPadMarkersV118(); }, FLAGS(PARTIAL));
    await ev(() => { window.__charges = []; const o = tryPayResources; tryPayResources = function (c) { const r = o.apply(this, arguments); if (r && c && c.money) window.__charges.push(c.money); return r; }; });
    const sigBefore = await ev(() => __sig());
    const m4 = () => ev(() => ['B11', 'B12'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join(''));

    // ---- gate matrix
    const gates = await ev(() => {
      const m = () => ['B11', 'B12'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join(''), out = {};
      stageIndex = 9; refreshIndustrialPadMarkersV118(); out.stage9 = m();
      stageIndex = 10; cityState.reputation = 0; refreshIndustrialPadMarkersV118(); out.noRep = m();
      const keep = masterplanStateV161.B10; masterplanStateV161.B10 = false; refreshIndustrialPadMarkersV118(); out.noB10 = m(); masterplanStateV161.B10 = keep;
      stageIndex = 9; refreshIndustrialPadMarkersV118();
      const step = industrialStepV118('mp161-B11'), before = money; const ok = buildIndustrialStepV118(step);
      out.earlyCharge = { ok, spent: before - money };
      stageIndex = 10; refreshIndustrialPadMarkersV118();
      return out;
    });
    check(gates.stage9 === '00' && gates.noRep === '10' && gates.noB10 === '00' && !gates.earlyCharge.ok && gates.earlyCharge.spent === 0, `gate matrix: stage 9 ${gates.stage9}, stage 10 without reputation ${gates.noRep} (meta.phaseInfo[4] has none), without B10 ${gates.noB10}; B12 waits for B11; an early press neither charges nor builds (${J(gates.earlyCharge)})`);
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
      check(await ev((n) => !!scene.getObjectByName(n), P4[id === 'B11' ? 0 : 1]), `${id}: group ${P4[id === 'B11' ? 0 : 1]} exists after the purchase`);
      check(J(r.sig.uuids) === J(sigBefore.uuids) && r.sig.count === sigBefore.count && r.sig.hash === sigBefore.hash, `${id}: road mesh uuids / count / hash unchanged (${r.sig.count}/${r.sig.hash})`);
    }
    await buy('B11', 70000);
    check(await m4() === '01', `after B11: B12 appears: ${await m4()}`);
    await buy('B12', 140000);
    check(await m4() === '00', `all bought: no pad left: ${await m4()}`);
    console.log('purchase circles: ' + J(stand));

    // ---- groups, names, tags, sea
    const meshInfo = await ev((P4) => {
      MasterplanV161.refresh();
      const out = {};
      for (const n of P4) {
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
        out[n] = { meshes, inst, tris: Math.round(tris), names, bad, rootRoad: /road/i.test(root.name), surfaces: names.filter((x) => /_surface$/.test(x)).length };
      }
      const sea = scene.getObjectByName('mp161Sea'); let covers = false, seaTris = 0;
      if (sea) { sea.geometry.computeBoundingBox(); const b = sea.geometry.boundingBox; covers = b.min.x <= -190 && b.max.x >= 215 && b.min.z <= -170 && b.max.z >= 242; seaTris = sea.geometry.index.count / 3; }
      out.sea = !!sea && !!sea.userData.v83CollisionIgnore && covers; out.seaTris = seaTris;
      return out;
    }, P4);
    console.log('phase 4 groups (meshes / instanced / triangles): ' + J(P4.map((n) => [n, meshInfo[n] && meshInfo[n].meshes, meshInfo[n] && meshInfo[n].inst, meshInfo[n] && meshInfo[n].tris])) + ' sea triangles ' + meshInfo.seaTris);
    check(P4.every((n) => meshInfo[n] && meshInfo[n].bad.length === 0 && !meshInfo[n].rootRoad && meshInfo[n].names.every((x) => !x || x.startsWith('mp161'))), `group names are mp161*, no 'road' in any name, v83CollisionIgnore on every mesh, no road tag (${J(P4.map((n) => meshInfo[n] && meshInfo[n].bad))})`);
    check(P4.every((n) => meshInfo[n].inst === 1 && meshInfo[n].surfaces === 1 && meshInfo[n].meshes <= 4) && meshInfo.sea && meshInfo.seaTris > 2, `meshes merged: ${J(P4.map((n) => meshInfo[n].meshes))} (surface, props, parcel lines: one surface mesh and one InstancedMesh per pad), the sea square covers the world and has the hole of the trench (${meshInfo.seaTris} triangles)`);

    // ---- walkable floor: seams and outside
    const seams = await ev(() => {
      const bad = [], A = (x, z) => { if (!MasterplanV161.access(x, z)) bad.push([x, z]); };
      for (let z = 62; z <= 186; z += 2) { A(6, z); A(3, z); A(9, z); }                    // South avenue from the ring to the shore side
      for (let x = 8; x <= 100; x += 2) { A(x, 100); A(x, 98); A(x, 102.5); }             // South street (B11) up to the chord
      for (let x = 104; x <= 196; x += 2) { A(x, 100); A(x, 102.5); }                     // South street east (B12) to its end
      for (let x = 8; x <= 31; x += 1) { A(x, 140); A(x, 137); A(x, 143); }               // M2 arterial from the avenue to the expressway gate
      for (let z = 100; z <= 180; z += 2) { A(102, z); A(99, z); A(105, z); }             // the chord south, ACROSS the open cut on the deck (z 131..149)
      for (let x = 8; x <= 124; x += 2) { A(x, 180); A(x, 182); }                         // Q180 embankment street
      for (let z = 100; z <= 106; z += 2) for (const x of [96, 100, 104, 108, 112, 116]) A(x, z);   // B07 land <-> South street / chord
      for (let x = 30; x <= 60; x += 3) { A(x, 120); A(x, 160); A(x, 186); }              // free land west of the interchange
      for (let x = 180; x <= 210; x += 6) { A(x, 120); A(x, 160); A(x, 186); }            // free land east of it
      return bad;
    });
    check(seams.length === 0, `no seam: South avenue, South street, the M2 arterial, the chord over the cut, Q180 and the free land are continuous floor (${J(seams.slice(0, 6))})`);
    const out = await ev(() => ({ water: MasterplanV161.access(60, 192), shore: MasterplanV161.access(60, 189.5), river: MasterplanV161.access(6, 200), cut: MasterplanV161.access(80, 140), cutEdge: MasterplanV161.access(80, 131.5), m2East: MasterplanV161.access(190, 140), m2Gate: MasterplanV161.access(35, 140), beyond: MasterplanV161.access(214, 120), north: MasterplanV161.access(60, 80) }));
    const rampPt = await ev(() => { const D = window.MasterplanPortDataV161, e = D.edges.find((q) => q.id === 'B-IC1-WB-ON'); const mid = e.pts[Math.floor(e.pts.length / 2)]; return { mid, a: MasterplanV161.access(mid[0], mid[1]) }; });
    check(Object.values(out).every((v) => v === false) && rampPt.a === false, `not walkable: the water (z 192, 200), the last metre of the shore (z 189.5), the open cut, its edge, the M2 carriageway east and at its gate, ramp points, beyond the east edge, the unpaid ground north of South street (${J(out)}; ramp mid ${J(rampPt)})`);

    // ---- pushes in 8 directions at every edge of the phase-4 floors, through the real updatePlayer
    const starts = {
      avenue: [[6, 80], [6, 120], [3, 186], [9, 150], [11, 105]],
      street: [[40, 100], [90, 100], [60, 98], [50, 102.5], [150, 100], [195, 100]],
      m2Arterial: [[20, 140], [28, 138], [30, 142], [14, 137]],
      shore: [[60, 186], [30, 186], [150, 186], [200, 186], [8, 186], [102, 185]],
      cutEdges: [[70, 129.5], [120, 129.5], [80, 150.5], [140, 150.5], [100, 130], [104, 150]],
      m2Open: [[190, 130], [190, 150], [40, 130], [40, 150], [205, 130], [60, 131]],
      ramps: [[60, 118], [60, 162], [140, 118], [140, 162], [90, 105], [150, 168]],
      east: [[210, 110], [210, 170], [205, 186], [150, 92], [196, 95]],
      west: [[28, 120], [28, 160], [30, 186], [14, 120], [10, 170]],
    };
    const probe = [];
    for (const [zone, pts] of Object.entries(starts)) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, pts[0]);
      await page.waitForTimeout(1200);
      probe.push(...await ev(({ zone, pts }) => {
        const out = [];
        for (const [sx, sz] of pts) for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, end = __drive(sx, sz, Math.cos(a), Math.sin(a), 240);
          const inCore = Math.abs(end.x) <= 69.01 && Math.abs(end.z) <= 69.01;
          const px = player.position.x, pz = player.position.z;
          const deck = Math.abs(px - 102) < 5.4, inCut = !deck && pz > 131 && pz < 149 && px > 50 && px < 154, inM2 = !deck && pz > 133 && pz < 147 && px > 32.26 && px < 212;
          const ok = (inCore || MasterplanV161.access(px, pz)) && !inCut && !inM2 && pz < 190, floor = inCore ? { y: 0, name: 'core' } : __floorY(px, pz, 'mp161');
          out.push({ zone, sx, sz, k, end: [end.x, end.z], ok, floorY: floor && floor.y, floorName: floor && floor.name });
        }
        return out;
      }, { zone, pts }));
    }
    const bad = probe.filter((r) => !r.ok || r.floorY === null || Math.abs(r.floorY) > 0.12 || /sea|water|estuary/i.test(r.floorName || ''));
    const moved = probe.filter((r) => Math.hypot(r.end[0] - r.sx, r.end[1] - r.sz) > 3).length;
    check(probe.length === 8 * Object.values(starts).flat().length && bad.length === 0, `${probe.length} pushes of 8 s (8 directions x ${probe.length / 8} starts at every edge: shore, open cut, M2 carriageway, M2 gate, ramps, east / west land edges): all end on drawn floor within 12 cm, never in the cut / on the M2 / in the water (bad ${J(bad.slice(0, 4))}; ${moved} travelled > 3 m)`);
    console.log('floor names under the pushes: ' + J([...new Set(probe.map((r) => r.floorName))]));
    // walking across the chord's overpass deck over the open cut, north to south, then back
    const deck = await ev(() => {
      const a = __drive(102, 118, 0, 1, 300), floors = [131.5, 135, 140, 145, 148.5].map((z) => (__floorY(102, z, 'mp161') || {}).y);
      const b = __drive(102, 165, 0, -1, 300);
      return { a, b, floors, access: MasterplanV161.access(a.x, a.z) };
    });
    check(deck.a.z > 155 && deck.b.z < 125 && deck.access && deck.floors.every((y) => y !== undefined && Math.abs(y) <= .12), `the chord is walkable across the open cut on its deck (level 0): north -> south ends z ${deck.a.z}, south -> north ends z ${deck.b.z}; deck surface y ${J(deck.floors)}`);
    // the trench is drawn: floor depth along the plan profile, walls to the bottom, the sea plane open above it
    const tr = await ev(() => {
      const y = (x, z) => (__floorY(x, z, 'mp161') || {}).y, pr = [[154, 0], [111, -3], [93, -3], [50, 0]];
      const want = (x) => { for (let i = 1; i < pr.length; i++) { const a = pr[i - 1], b = pr[i]; if (x <= Math.max(a[0], b[0]) && x >= Math.min(a[0], b[0])) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return 0; };
      const rows = [60, 75, 93, 111, 118, 130, 148].map((x) => ({ x, got: y(x, 138.5), want: +(want(x) + .02).toFixed(3) }));
      return { rows, shoulder: y(80, 131.5), land: y(80, 125), wallTop: y(80, 120), sea: y(80, 200) };
    });
    check(tr.rows.every((r) => r.got !== undefined && Math.abs(r.got - r.want) < .08) && Math.abs(tr.rows[3].got + 2.98) < .08 && Math.abs(tr.rows[2].got + 2.98) < .08 && tr.land !== undefined && Math.abs(tr.land) < .1, `the M2 trench follows the plan profile (depth 3 m, 7 % grade): floor y ${J(tr.rows.map((r) => [r.x, r.got]))} (want ${J(tr.rows.map((r) => r.want))}), the ground beside it y ${tr.land}`);
    console.log('trench probes: ' + J(tr));
    // barriers are real colliders for the long runs; the walkable polygon is the rest
    const fence = await ev(() => { const list = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => c.label === 'mp161:prop' && c.hz > 3); return { n: list.length, ok: list.every((c) => c.category === 'decor' && c.flags.player === true && c.hx < .2) }; });
    check(fence.n >= 6 && fence.ok, `the long barrier runs are registered as solid decor colliders (${J(fence)})`);
    // core <-> South avenue: from inside the old city south along the avenue
    const walkS = await ev(() => { const a = __drive(6, 40, 0, 1, 400); return { a, access: MasterplanV161.access(a.x, a.z), y: (__floorY(a.x, a.z, 'mp161') || {}).y }; });
    check(walkS.a.z > 100 && walkS.access, `walking south along the avenue from inside the old city crosses the ring (r 57) and keeps going on paid floor (${J(walkS)})`);
    // backdrop
    const bd = await ev(() => {
      const o = []; scene.traverse((c) => { if (c.userData && c.userData.v161Backdrop && !c.isGroup) o.push(c); });
      const D = window.MasterplanPortDataV161, near = o.filter((c) => { const b = c.userData.v161Backdrop; return ['B11', 'B12'].some((id) => { const r = D.bbox[id]; return b.x > r[0] - b.r && b.x < r[2] + b.r && b.z > r[1] - b.r && b.z < r[3] + b.r; }) && MasterplanV161.floor(b.x, b.z); });
      const retired = []; scene.children.forEach((c) => { if (c.userData && c.userData.v161MpRetired) retired.push(c.userData.v64SceneryKind + '@' + c.position.x.toFixed(1) + ',' + c.position.z.toFixed(1)); });
      return { total: o.length, hidden: o.filter((c) => !c.visible).length, nearVisible: near.filter((c) => c.visible).length, near: near.length, retired };
    });
    check(bd.nearVisible === 0, `no backdrop hill / skyline stands on the phase-4 floors (${J({ ...bd, retired: bd.retired.length })}); scenery retired from the avenue: ${J(bd.retired)}`);

    // ---- shadows follow the player at the south end
    const sh = [];
    for (const [name, x, z] of [['spawn', -2.6, -.5], ['avenue end', 6, 184], ['interchange', 102, 150], ['east end', 205, 100], ['west ramps', 40, 130]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(1500);
      sh.push({ name, ...await ev(() => __shadowOffset()) });
    }
    console.log('shadow camera offset of the player in texels: ' + J(sh.map((s) => [s.name, s.lx, s.ly])));
    check(sh.every((s) => Math.abs(s.lx) <= 1 && Math.abs(s.ly) <= 1), `shadow camera centre within one texel of the player at spawn / avenue end / interchange / east end / west ramps (texel ${sh[0].texel} m, map ${sh[0].map})`);
    check(sh.every((s) => s.half === 72 && [512, 1024, 2048].includes(s.map) && s.normalBias >= Math.min(.12, s.texel * .5) - 1e-9), `shadow settings of the v164/v165 layer intact (half-width ${sh[0].half}, map ${sh[0].map}, normalBias ${sh[0].normalBias})`);

    // ---- draw calls
    const budget = [];
    for (const [name, x, z] of [['ring/avenue (6,70)', 6, 70], ['South street (50,100)', 50, 100], ['interchange (102,140)', 102, 140], ['ramps (60,150)', 60, 150], ['shore (6,184)', 6, 184], ['east (190,100)', 190, 100], ['chord/B07 (102,100)', 102, 100], ['east end (200,140)', 200, 140]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(2500);
      await ev(() => __frame()); await ev(() => __frame());   // let the shadow map / lazy builds of the teleport settle: the first frame after a jump counts shadow casters twice
      const all = await ev(() => __frame());
      const delta = await ev(async (P4) => {
        const mp = []; scene.children.forEach((o) => { if (o.userData && o.userData.masterplanV161 || o.name === 'mp161Sea') mp.push(o); });
        const parts = (o) => o.name === 'mp161Sea' ? [o] : o.children;
        const p4 = mp.filter((o) => P4.includes(o.name));
        const hide = (list) => { const saved = []; list.forEach((o) => parts(o).forEach((c) => { saved.push([c, c.visible]); c.visible = false; })); return saved; };
        const restore = (saved) => saved.forEach(([c, v]) => { c.visible = v; });
        let s1 = hide(p4); const noP4 = await __frame(); restore(s1);
        s1 = hide(mp); const none = await __frame(); restore(s1);
        return { noP4, none };
      }, P4);
      budget.push({ name, calls: all.calls, layer: all.calls - delta.none.calls, phase4: all.calls - delta.noP4.calls, tris: all.tris - delta.none.tris });
    }
    console.log('draw calls (all / whole masterplan layer / phase 4 only), triangles of the layer: ' + J(budget));
    check(budget.every((b) => b.layer <= 40 && b.phase4 <= 14), `the whole masterplan layer costs <= +40 draw calls in the worst frame (max ${Math.max(...budget.map((b) => b.layer))}); phase 4 alone <= +14 (max ${Math.max(...budget.map((b) => b.phase4))})`);

    if (SHOTS) {
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
      for (const [name, x, z] of [['south-avenue', 6, 110], ['trench', 80, 128], ['trench-bridge', 102, 120], ['interchange-west', 50, 125], ['interchange-east', 150, 125], ['shore', 40, 183], ['m2-gate', 24, 140], ['m2-east-end', 200, 128]]) {
        await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); MasterplanV161.refresh(); }, [x, z]);
        await page.waitForTimeout(3500);
        await page.screenshot({ path: path.join(SHOTS, name + '.png') });
      }
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST * 3; player.position.set(102, 0, 140); MasterplanV161.refresh(); });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: path.join(SHOTS, 'interchange-above.png') });
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
    }

    // ---- persistence + first visit
    await ev(() => { player.position.set(60, 0, 160); playerVelocity.set(0, 0, 0); });
    await page.waitForTimeout(1500);
    console.log('standing at the interchange land for 1.5 s: ' + await ev(() => JSON.stringify([player.position.x, player.position.z, MasterplanV161.access(player.position.x, player.position.z)])));
    await ev(() => { save.flush(); });
    const savedFlags = await ev(() => JSON.parse(localStorage.getItem(SAVE_KEY)).masterplanV161);
    check(Object.keys(savedFlags).length >= 12 && savedFlags.B11 === true && savedFlags.B12 === true && savedFlags.B02 === false, `the save has the twelve masterplan flags (${J(savedFlags)})`);
    await reloadGame(g, 5000);
    await ev(PAGE);
    const far = await ev(() => ({ flags: { ...masterplanStateV161 }, x: player.position.x, z: player.position.z }));
    check(J(far.flags) === J(FLAGS([...PARTIAL, 'B11', 'B12'])) && Math.abs(far.x - 60) < 1 && Math.abs(far.z - 160) < 1, `reload keeps the flags (B02 / B04 / B08 were never bought) and the position on the new floor (${J(far)})`);
    await ev(() => MasterplanV161.dropGroups());
    await page.waitForTimeout(1500);
    const lazy = await ev(() => Object.fromEntries(['mp161Net', 'mp161North', 'mp161Main', 'mp161Centre', 'mp161South', 'mp161M2', 'mp161Sea'].map((n) => [n, !!scene.getObjectByName(n)])));
    check(lazy.mp161South && lazy.mp161M2 && lazy.mp161Sea && !lazy.mp161Net && !lazy.mp161North, `lazy build by distance: from the south the south groups are built, the port and the north strip are not (${J(lazy)})`);
    const first = await ev(async () => {
      player.position.set(6, 0, -120); playerVelocity.set(0, 0, 0); await __frame(); await __frame();
      const hid = ['mp161South', 'mp161M2'].map((n) => { const o = scene.getObjectByName(n); return !o || o.visible; });
      player.position.set(150, 0, 160); playerVelocity.set(0, 0, 0); await __frame(); await __frame();
      const g = scene.getObjectByName('mp161M2'), under = __floorY(150, 160, 'mp161');
      return { hiddenFar: hid.every((v) => v === false), built: !!g, visible: g && g.visible, floor: under };
    });
    check(first.hiddenFar && first.built && first.visible && first.floor && Math.abs(first.floor.y) <= .12 && /^mp161M2/.test(first.floor.name), `far groups hide in the north; two frames after a teleport to the interchange its floor is drawn (${J(first)})`);
    await ev(() => { player.position.set(170, 0, 130); playerVelocity.set(0, 0, 0); save.flush(); });
    await reloadGame(g, 5000);
    await ev(PAGE);
    const rel = await ev(() => ({ x: +player.position.x.toFixed(1), z: +player.position.z.toFixed(1), access: MasterplanV161.access(player.position.x, player.position.z), m2: !!scene.getObjectByName('mp161M2') }));
    check(Math.abs(rel.x - 170) < 1 && Math.abs(rel.z - 130) < 1 && rel.access && rel.m2, `reload keeps the player standing on the interchange land (north of the M2, ${J(rel)})`);
    const sigAfter = await ev(() => __sig());
    check(sigAfter.count === sigBefore.count && sigAfter.hash === sigBefore.hash, `after reload the road signature is still ${sigBefore.count}/${sigBefore.hash}`);
    const reset = await ev(() => { restoreMasterplanV161(null); MasterplanV161.refresh(); let hiddenScenery = 0; scene.children.forEach((c) => { if (c.userData && (c.userData.v161MpRetired || c.userData.v84HiddenRoadConflict && c.userData.v161MpRetired !== undefined)) hiddenScenery++; }); return { mp: __mpObjects(), colliders: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => /^mp161:/.test(c.label || '')).length, access: MasterplanV161.access(170, 130) || MasterplanV161.access(6, 120), hiddenScenery }; });
    check(reset.mp.length === 0 && reset.colliders === 0 && !reset.access && reset.hiddenScenery === 0, `reset clears the groups, the sea (and its hole), every mp161 collider, the retired scenery and the paid floor (${J(reset)})`);
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
    const o = await ev(() => ({ flags: { ...masterplanStateV161 }, mp: __mpObjects(), markers: ['B01', 'B10', 'B11', 'B12'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), sig: __sig(), stage: stageIndex }));
    check(Object.keys(o.flags).length >= 12 && Object.values(o.flags).every((f) => f === false) && o.mp.length === 0 && o.markers.every((m) => !m), `OLD_SAVE: twelve flags false, no object, no pad (${J({ flags: o.flags, mp: o.mp.length, markers: o.markers, stage: o.stage })})`);
    check(o.sig.count === 51 && o.sig.hash === 648310607, `OLD_SAVE road signature stays 51 / 648310607 (${o.sig.count}/${o.sig.hash})`);
    check(await ev(() => !MasterplanV161.access(100, 140) && !MasterplanV161.access(6, 120) && !MasterplanV161.floor(60, 160)), 'OLD_SAVE: no paid floor anywhere (access false)');
    const chain = await ev(() => {
      const r = (d) => { restoreMasterplanV161(d); return Object.entries(masterplanStateV161).slice(0, 12).map(([k, v]) => k + (v ? '1' : '0')).join(' '); };
      const all = Object.fromEntries(Object.keys(masterplanStateV161).map((k) => [k, true]));
      return { all: r(all), noB10: r({ ...all, B10: false }), noB11: r({ ...all, B11: false }), noB09: r({ ...all, B09: false }), none: r(null) };
    });
    check(chain.all === 'B011 B021 B031 B041 B051 B061 B071 B081 B091 B101 B111 B121' && chain.noB10 === 'B011 B021 B031 B041 B051 B061 B071 B081 B091 B100 B110 B120' && chain.noB11 === 'B011 B021 B031 B041 B051 B061 B071 B081 B091 B101 B110 B120' && chain.noB09 === 'B011 B021 B031 B041 B051 B061 B071 B081 B090 B100 B110 B120' && chain.none === 'B010 B020 B030 B040 B050 B060 B070 B080 B090 B100 B110 B120', `restore enforces B09 -> B10 -> B11 -> B12 (${J(chain)})`);
    await ev(() => { stageIndex = 16; cityState.reputation = 500; refreshIndustrialPadMarkersV118(); });
    const later2 = await ev(() => ({ markers: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), mp: __mpObjects().length }));
    check(later2.mp === 0 && later2.markers.slice(1).every((m) => !m), `OLD_SAVE at stage 16: no object; B02..B12 stay locked behind B01 (${J(later2.markers)})`);
    check(g.errors.length === 0, `OLD_SAVE: no console/page errors (${J(g.errors.slice(0, 4))})`);
  } finally { await g.close(); }
});
