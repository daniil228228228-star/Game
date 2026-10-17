// Masterplan PHASE 3 (plan B pads B06 "Main avenue (to the Chord)", B07 "Eastern chord (north)", B08 "Industrial park (east) and ring street", B09 "Main avenue (east), housing
// blocks", B10 "Business centre"). Same pipeline as tests/masterplan-phase2.test.mjs (compile-port --phase=3, MASTERPLAN_REQUIRES_V161, masterplanStateV161, save field, generic cell groups).
//   launch 1 (fresh game, real purchases through #actionBtn):
//     * data is current (compile-port --check), B01..B05 compiled data byte-identical to phase 2 (hashes), every walkable point drawn, every phase-3 lot on land of its own pad or a pad it requires,
//       validate.mjs does not regress;
//     * gate matrix: B06..B10 appear only at stage >= 8 + reputation >= 60 + their chain (B06 <- B03, B07 <- B05, B08 <- B07, B09 <- B06+B07, B10 <- B09); early press neither charges nor builds;
//     * exact prices through the real button (19200 / 28800 / 33600 / 38400 / 48000, the plan prices, no second v124 multiplier); each purchase: group exists, road mesh uuids / count / hash unchanged;
//     * groups mp161Main / Chord / ParkE / East / Centre: names, no 'road', v83CollisionIgnore, one InstancedMesh each; seams between the pads; the old core ring <-> avenue transition;
//       8-direction pushes at every edge of every phase-3 floor (drawn floor within 12 cm, never in the sea, never beyond the land); solid props (trees, planters, lamps);
//     * backdrop hidden on the new floors; sea square covers the world; shadows within one texel at the far east end; draw-call budget (whole layer <= +40, phase 3 alone <= +14);
//     * save/reload keeps the flags and the player; lazy build / hide by distance; reset path clears groups, sea, colliders, retired scenery; 0 console errors, 0 4xx.
//   launch 2 (OLD_SAVE): all ten flags false, no objects, signature 51/648310607, restore chain B01 -> B03 -> B05 -> B07 -> B08 / B06 + B07 -> B09 -> B10.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openGame, reloadGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IDS = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'];
const GROUP = { B01: 'mp161Net', B02: 'mp161Net', B03: 'mp161North', B04: 'mp161NW', B05: 'mp161Park', B06: 'mp161Main', B07: 'mp161Chord', B08: 'mp161ParkE', B09: 'mp161East', B10: 'mp161Centre' };
const P3 = ['mp161Main', 'mp161Chord', 'mp161ParkE', 'mp161East', 'mp161Centre'];
const HASH05 = { B01: 'b72aec06e08d', B02: 'df807cbb0355', B03: 'fecb9bf1aaaa', B04: '79a2c88d6ea7', B05: '7f9663c3e0b4' };   // phase-2 data per pad, must never change

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
  check(Object.keys(HASH05).every((id) => hash(id) === HASH05[id]), `data: B01..B05 compiled data byte-identical to phase 2 (${J(Object.keys(HASH05).map(hash))})`);
  const inPoly = (x, z, poly) => { let y = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) y = !y; } return y; };
  const inRegion = (x, z, loops) => { let y = false; for (const l of loops) if (inPoly(x, z, l)) y = !y; return y; };
  const tris = [];
  for (const id in D.surfaces) for (const k of ['walk', 'asphalt']) for (const c of D.surfaces[id][k]) for (let i = 0; i < c.positions.length; i += 9) { const P = c.positions, a = [P[i], P[i + 2]], b = [P[i + 3], P[i + 5]], cc = [P[i + 6], P[i + 8]]; tris.push([Math.min(a[0], b[0], cc[0]), Math.min(a[1], b[1], cc[1]), Math.max(a[0], b[0], cc[0]), Math.max(a[1], b[1], cc[1]), ...a, ...b, ...cc]); }
  const side = (px, pz, ax, az, bx, bz) => (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const inTri = (x, z, t) => { if (x < t[0] - 1e-6 || x > t[2] + 1e-6 || z < t[1] - 1e-6 || z > t[3] + 1e-6) return false; const d1 = side(x, z, t[4], t[5], t[6], t[7]), d2 = side(x, z, t[6], t[7], t[8], t[9]), d3 = side(x, z, t[8], t[9], t[4], t[5]); return !((d1 < -1e-7 || d2 < -1e-7 || d3 < -1e-7) && (d1 > 1e-7 || d2 > 1e-7 || d3 > 1e-7)); };
  const decks = [D.pier, ...D.lots.filter((l) => l.pad === 'B02').map((l) => l.poly), ...Object.values(D.land)];
  let tested = 0; const holes = [];
  for (const id in D.walkable) {
    const b = D.bbox[id];
    for (let x = Math.floor(b[0]); x <= b[2]; x += 1) for (let z = Math.floor(b[1]); z <= b[3]; z += 1) {
      if (!D.walkable[id].some((r) => inRegion(x, z, r))) continue;
      tested++;
      if (!decks.some((d) => inPoly(x, z, d)) && !tris.some((t) => inTri(x, z, t))) holes.push([id, x, z]);
    }
  }
  check(holes.length === 0 && tested > 30000, `data: every walkable point (${tested} grid points of B01..B10) is covered by a drawn triangle, deck or slab (holes ${J(holes.slice(0, 5))})`);
  // lots: on the land of their own pad, or of a pad their pad requires (chain), never on air
  const req = {}; for (const p of D.pads) req[p.id] = p.requires;
  const chain = (id, seen = new Set()) => { if (seen.has(id)) return seen; seen.add(id); (req[id] || []).forEach((r) => chain(r, seen)); return seen; };
  const bad = [];
  for (const l of D.lots.filter((l) => l.pad >= 'B06')) for (const q of [...l.poly, l.door]) { if (![...chain(l.pad)].some((id) => D.land[id] && inPoly(q[0], q[1], D.land[id]))) bad.push([l.id, l.pad, q]); }
  check(bad.length === 0 && D.lots.filter((l) => l.pad >= 'B06').length === 82, `data: all 82 phase-3 parcels (corners and doors) stand on land of their pad or of a pad it requires (${J(bad.slice(0, 3))})`);
  check(D.pads.length === 10 && D.pads.slice(5).every((p) => p.gateStage === 8 && p.rep === 60) && J(D.pads.slice(5).map((p) => p.money)) === '[19200,28800,33600,38400,48000]' && Object.keys(D.land).join() === 'B03,B04,B05,B06,B07,B08,B09,B10', 'data: phase-3 pads: stage 8, reputation 60 (meta.phaseInfo), plan prices, land slabs');
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
    const sig0 = await ev(() => __sig());
    const pre = await ev(() => ({ mp: __mpObjects(), markers: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), flags: { ...masterplanStateV161 } }));
    check(pre.mp.length === 0 && pre.markers.every((m) => !m) && Object.keys(pre.flags).length === 10 && Object.values(pre.flags).every((f) => f === false), `fresh game: no object, no pad, ten flags all false (${J(pre.flags)})`);
    await ev(() => { stageIndex = 4; CITY_DISTRICTS.forEach((c, i) => cityState.districtRoads[c.id] = { level: i < 2 ? 3 : 1, pendingUntil: 0, roadsBuilt: true }); window.__TYCOON_ROAD_AUDIT_V59__.syncOuter(); refreshIndustrialPadMarkersV118(); });
    await ev(() => { window.__charges = []; const o = tryPayResources; tryPayResources = function (c) { const r = o.apply(this, arguments); if (r && c && c.money) window.__charges.push(c.money); return r; }; });
    const sigBefore = await ev(() => __sig());
    const marks = () => ev(() => ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join(''));
    const stand = {};
    async function buy(id, price) {
      await ev((id) => { money = 1e6; const p = industrialStepV118('mp161-' + id).pos; player.position.copy(p); playerVelocity.set(0, 0, 0); updateTreeInteraction(); window.__charges = []; }, id);
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
      check(await ev((n) => !!scene.getObjectByName(n), GROUP[id]), `${id}: group ${GROUP[id]} exists after the purchase`);
      check(J(r.sig.uuids) === J(sigBefore.uuids) && r.sig.count === sigBefore.count && r.sig.hash === sigBefore.hash, `${id}: road mesh uuids / count / hash unchanged (${r.sig.count}/${r.sig.hash})`);
    }
    await buy('B01', 350);
    await buy('B02', 750);
    await ev(() => { stageIndex = 6; cityState.reputation = 25; refreshIndustrialPadMarkersV118(); });
    await buy('B03', 3000);
    await buy('B05', 6800);

    // ---- gate matrix of the phase-3 pads
    const m3 = () => ev(() => ['B06', 'B07', 'B08', 'B09', 'B10'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join(''));
    const gates = await ev(() => {
      const m = () => ['B06', 'B07', 'B08', 'B09', 'B10'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join('');
      const out = {};
      stageIndex = 7; cityState.reputation = 500; refreshIndustrialPadMarkersV118(); out.stage7 = m();
      stageIndex = 8; cityState.reputation = 59; refreshIndustrialPadMarkersV118(); out.rep59 = m();
      stageIndex = 8; cityState.reputation = 60; refreshIndustrialPadMarkersV118(); out.ok = m();
      stageIndex = 7; refreshIndustrialPadMarkersV118();
      const step = industrialStepV118('mp161-B06'), before = money; const ok = buildIndustrialStepV118(step);
      out.earlyCharge = { ok, spent: before - money };
      stageIndex = 8; cityState.reputation = 60; refreshIndustrialPadMarkersV118();
      return out;
    });
    check(gates.stage7 === '00000' && gates.rep59 === '00000' && gates.ok === '11000' && !gates.earlyCharge.ok && gates.earlyCharge.spent === 0, `gate matrix: stage 7 ${gates.stage7}, reputation 59 ${gates.rep59}, stage 8 + 60 ${gates.ok} (B06 <- B03, B07 <- B05; B08..B10 wait for their chain); an early press neither charges nor builds (${J(gates.earlyCharge)})`);
    await buy('B07', 28800);
    check(await m3() === '10100', `after B07: B06 still there, B08 appears, B09 needs B06 (not yet): ${await m3()}`);
    await buy('B08', 33600);
    check(await m3() === '10000', `B08 bought before B06 / B09 (it needs only B07): ${await m3()}`);
    await buy('B06', 19200);
    check(await m3() === '00010', `after B06: B09 (B06 + B07) appears, B10 needs B09: ${await m3()}`);
    await buy('B09', 38400);
    check(await m3() === '00001', `after B09: B10 appears: ${await m3()}`);
    await buy('B10', 48000);
    check(await m3() === '00000', `all bought: no pad left: ${await m3()}`);
    console.log('purchase circles: ' + J(stand));

    // ---- groups, names, tags
    const meshInfo = await ev((P3) => {
      MasterplanV161.refresh();
      const out = {};
      for (const n of P3) {
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
        out[n] = { meshes, inst, tris: Math.round(tris), names, bad, rootRoad: /road/i.test(root.name) };
      }
      const sea = scene.getObjectByName('mp161Sea'); let covers = false;
      if (sea) { sea.geometry.computeBoundingBox(); const b = sea.geometry.boundingBox; covers = b.min.x <= -190 && b.max.x >= 215 && b.min.z <= -170 && b.max.z >= 242; }
      out.sea = !!sea && !!sea.userData.v83CollisionIgnore && covers;
      return out;
    }, P3);
    console.log('phase 3 groups (meshes / instanced / triangles): ' + J(P3.map((n) => [n, meshInfo[n] && meshInfo[n].meshes, meshInfo[n] && meshInfo[n].inst, meshInfo[n] && meshInfo[n].tris])));
    check(P3.every((n) => meshInfo[n] && meshInfo[n].bad.length === 0 && !meshInfo[n].rootRoad && meshInfo[n].names.every((x) => !x || x.startsWith('mp161'))), `group names are mp161*, no 'road' in any name, v83CollisionIgnore on every mesh, no road tag (${J(P3.map((n) => meshInfo[n] && meshInfo[n].bad))})`);
    check(P3.every((n) => meshInfo[n].inst === (n === 'mp161Main' ? 0 : 1) && meshInfo[n].meshes <= 4) && meshInfo.sea, `meshes merged: ${J(P3.map((n) => meshInfo[n].meshes))} (<= 4 each: surface, props, parcel lines), one InstancedMesh of parcel lines per group with parcels, the sea square covers the whole world (x -190..215, z -170..242)`);
    check(await ev(() => { const D = window.MasterplanPortDataV161, n = (id) => D.lots.filter((x) => x.pad === id).length; return n('B06') === 0 && n('B07') === 6 && n('B08') === 35 && n('B09') === 33 && n('B10') === 8; }), 'data: 0 / 6 / 35 / 33 / 8 parcels in B06..B10 (plan-B.json)');

    // ---- walkable floor: seams and outside
    const seams = await ev(() => {
      const bad = [], A = (x, z) => { if (!MasterplanV161.access(x, z)) bad.push([x, z]); };
      for (let x = 71; x <= 199; x += 2) { A(x, 0); A(x, 2.5); A(x, -2.5); }            // main avenue, B06 -> chord crossing -> B09 -> its end
      for (let z = -150; z <= 100; z += 2) { A(102, z); A(100, z); A(104, z); }          // the chord, B05 floor -> B07 stub
      for (let x = 104; x <= 200; x += 2) { A(x, -100); A(x, -148); A(x, -52); A(x, 48); }  // z=-100 / -148 / -52 / 48 streets
      for (let z = -146; z <= 46; z += 2) { A(150, z); A(198, z); }                       // x=150 / x=198 collectors
      for (let z = -153; z <= -96; z += 3) for (const x of [106, 107.5]) A(x, z);       // B05 land <-> chord <-> B08 R1/R2 floor
      return bad;
    });
    check(seams.length === 0, `no seam: the main avenue (z 0), the Chord (x 102), the z=-148/-100/-52/48 streets and the x=150/198 collectors are continuous floor (${J(seams.slice(0, 6))})`);
    const out = await ev(() => ({ a: MasterplanV161.access(130, -160), b: MasterplanV161.access(212, 0), c: MasterplanV161.access(100, 112), d: MasterplanV161.access(80, 30), e: MasterplanV161.access(160, 60), f: MasterplanV161.access(60, 40) }));
    check(!out.a && !out.b && !out.c && !out.d && !out.e && !out.f, `outside the paid land is not walkable: north of the coast, beyond the east end, south of the Chord stub, the water between the ring and the blocks (${J(out)})`);
    // ---- pushes in 8 directions at every edge of every phase-3 floor, through the real updatePlayer
    const starts = {
      core: [[66, 0], [66.5, 8], [64, -9], [70.5, 4]],
      main: [[80, 0], [95, 4], [84, -6.5], [84, 6.5]],
      chord: [[102, 60], [102, 104], [96, 50], [112, 100], [112, -90], [96, -120]],
      parkE: [[204, -125], [150, -154], [120, -154], [150, -70], [185, -153], [200, -70], [135, -70], [170, -72]],
      strips: [[150, 52], [200, 52], [135, 52], [165, 50], [183, 50], [204, 20]],
      east: [[204, -30], [130, -64], [160, 14], [204, -64], [120, -64]],
      centre: [[204, 50], [160, 53], [130, 52], [120, 40], [204, 20]],
    };
    const probe = [];
    for (const [zone, pts] of Object.entries(starts)) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, pts[0]);
      await page.waitForTimeout(1200);
      probe.push(...await ev(({ zone, pts }) => {
        const out = [];
        for (const [sx, sz] of pts) for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, end = __drive(sx, sz, Math.cos(a), Math.sin(a), 240);
          const inCore = Math.abs(end.x) <= 69.01 && Math.abs(end.z) <= 69.01;   // pushed back into the old city: fine
          const ok = inCore || MasterplanV161.access(player.position.x, player.position.z), floor = inCore ? { y: 0, name: 'core' } : __floorY(player.position.x, player.position.z, 'mp161');
          out.push({ zone, sx, sz, k, end: [end.x, end.z], ok, floorY: floor && floor.y, floorName: floor && floor.name });
        }
        return out;
      }, { zone, pts }));
    }
    const bad = probe.filter((r) => !r.ok || r.floorY === null || Math.abs(r.floorY) > 0.12 || /sea|water|estuary/i.test(r.floorName || ''));
    const moved = probe.filter((r) => Math.hypot(r.end[0] - r.sx, r.end[1] - r.sz) > 3).length;
    check(probe.length === 8 * Object.values(starts).flat().length && bad.length === 0, `${probe.length} pushes of 8 s (8 directions x ${probe.length / 8} starts at every edge of the new floors and at the core / avenue transition): all end on drawn floor within 12 cm, none in the sea, none off the paid land (bad ${J(bad.slice(0, 4))}; ${moved} travelled > 3 m)`);
    console.log('floor names under the pushes: ' + J([...new Set(probe.map((r) => r.floorName))]));
    // core <-> floor: walking east along the avenue from inside the old city leaves the core and continues on drawn floor
    const walkE = await ev(() => { const a = __drive(50, 0, 1, 0, 400); return { a, access: MasterplanV161.access(a.x, a.z), y: (__floorY(a.x, a.z, 'mp161') || {}).y }; });
    check(walkE.a.x > 100 && walkE.access, `walking east along the avenue from inside the old city crosses the ring (r 57) and keeps going on paid floor (${J(walkE)})`);
    // props are solid
    const props = await ev(() => {
      const list = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => c.label === 'mp161:prop');
      const free = (c, dz) => MasterplanV161.access(c.pos.x, c.pos.z + dz);
      const t = list.find((c) => c.hx > .1 && c.hx < .2 && free(c, -4)), pl = list.find((c) => c.hx > .4 && free(c, -4));
      const run = (c) => { if (!c) return null; const end = __drive(c.pos.x, c.pos.z - 4, 0, 1, 90); return +Math.hypot(end.x - c.pos.x, end.z - c.pos.z).toFixed(2); };
      return { count: list.length, ok: list.every((c) => c.category === 'decor' && c.flags.player === true), planters: list.filter((c) => c.hx > .4).length, tree: run(t), planter: run(pl) };
    });
    check(props.count >= 60 && props.ok && props.planters >= 15 && props.tree !== null && props.tree >= .25 && props.tree < 2 && props.planter !== null && props.planter >= .45 && props.planter < 2.2, `props are solid: ${props.count} colliders (decor, player:true), ${props.planters} planters; a walk at a trunk stops ${props.tree} m, at a planter ${props.planter} m from its centre`);
    // backdrop
    const bd = await ev(() => {
      const o = []; scene.traverse((c) => { if (c.userData && c.userData.v161Backdrop && !c.isGroup) o.push(c); });
      const D = window.MasterplanPortDataV161, near = o.filter((c) => { const b = c.userData.v161Backdrop; return ['B06', 'B07', 'B08', 'B09', 'B10'].some((id) => { const r = D.bbox[id]; return b.x > r[0] - b.r && b.x < r[2] + b.r && b.z > r[1] - b.r && b.z < r[3] + b.r; }); });
      const retired = []; scene.children.forEach((c) => { if (c.userData && c.userData.v161MpRetired) retired.push(c.userData.v64SceneryKind + '@' + c.position.x.toFixed(1) + ',' + c.position.z.toFixed(1)); });
      return { total: o.length, hidden: o.filter((c) => !c.visible).length, nearVisible: near.filter((c) => c.visible).length, near: near.length, retired };
    });
    check(bd.nearVisible === 0, `no backdrop hill / skyline stands on the phase-3 floors (${J({ ...bd, retired: bd.retired.length })}); scenery retired from the avenue: ${J(bd.retired)}`);

    // ---- shadows follow the player at the far east end
    const sh = [];
    for (const [name, x, z] of [['spawn', -2.6, -.5], ['avenue east', 190, 0], ['chord stub', 102, 98], ['park east', 200, -125], ['centre', 150, 45]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(1500);
      sh.push({ name, ...await ev(() => __shadowOffset()) });
    }
    console.log('shadow camera offset of the player in texels: ' + J(sh.map((s) => [s.name, s.lx, s.ly])));
    check(sh.every((s) => Math.abs(s.lx) <= 1 && Math.abs(s.ly) <= 1), `shadow camera centre within one texel of the player at spawn / avenue east / chord stub / park east / centre (texel ${sh[0].texel} m, map ${sh[0].map})`);
    check(sh.every((s) => s.half === 72 && [512, 1024, 2048].includes(s.map) && s.normalBias >= Math.min(.12, s.texel * .5) - 1e-9), `shadow settings of the v164/v165 layer intact (half-width ${sh[0].half}, map ${sh[0].map}, normalBias ${sh[0].normalBias})`);

    // ---- draw calls
    const budget = [];
    for (const [name, x, z] of [['ring junction (64,0)', 64, 0], ['avenue/chord crossing (102,0)', 102, 0], ['avenue east (150,0)', 150, 0], ['centre (150,40)', 150, 40], ['chord north (102,-90)', 102, -90], ['park east (150,-125)', 150, -125], ['B05 junction (6,-100)', 6, -100], ['east end (190,-10)', 190, -10]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(1500);
      const all = await ev(() => __frame());
      const delta = await ev(async (P3) => {
        const mp = []; scene.children.forEach((o) => { if (o.userData && o.userData.masterplanV161 || o.name === 'mp161Sea') mp.push(o); });
        const parts = (o) => o.name === 'mp161Sea' ? [o] : o.children;
        const p3 = mp.filter((o) => P3.includes(o.name));
        const hide = (list) => { const saved = []; list.forEach((o) => parts(o).forEach((c) => { saved.push([c, c.visible]); c.visible = false; })); return saved; };
        const restore = (saved) => saved.forEach(([c, v]) => { c.visible = v; });
        let s1 = hide(p3); const noP3 = await __frame(); restore(s1);
        s1 = hide(mp); const none = await __frame(); restore(s1);
        return { noP3, none };
      }, P3);
      budget.push({ name, calls: all.calls, layer: all.calls - delta.none.calls, phase3: all.calls - delta.noP3.calls, tris: all.tris - delta.none.tris });
    }
    console.log('draw calls (all / whole masterplan layer / phase 3 only), triangles of the layer: ' + J(budget));
    check(budget.every((b) => b.layer <= 40 && b.phase3 <= 14), `the whole masterplan layer costs <= +40 draw calls in the worst frame (max ${Math.max(...budget.map((b) => b.layer))}); phase 3 alone <= +14 (max ${Math.max(...budget.map((b) => b.phase3))})`);

    if (SHOTS) {
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
      for (const [name, x, z] of [['ring-junction', 66, 0], ['main-avenue-east', 135, 0], ['chord', 102, -60], ['residential-blocks', 130, -80], ['business-centre', 150, 30], ['industrial-east', 150, -125], ['avenue-end', 190, 0], ['chord-stub', 102, 96]]) {
        await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); MasterplanV161.refresh(); }, [x, z]);
        await page.waitForTimeout(3500);
        await page.screenshot({ path: path.join(SHOTS, name + '.png') });
      }
    }

    // ---- persistence + first visit
    await ev(() => { player.position.set(150, 0, 30); playerVelocity.set(0, 0, 0); save.flush(); });
    console.log('saved player: ' + await ev(() => localStorage.getItem(SAVE_KEY).match(/"player":\{[^}]*\}/)[0]));
    await reloadGame(g, 5000);
    await ev(PAGE);
    const far = await ev(() => ({ flags: { ...masterplanStateV161 }, x: player.position.x, z: player.position.z }));
    const wantFlags = J({ B01: true, B02: true, B03: true, B04: false, B05: true, B06: true, B07: true, B08: true, B09: true, B10: true });
    check(J(far.flags) === wantFlags && far.x > 140 && far.z > 25, `reload keeps the flags (B04 was never bought) and the position in the business centre (${J(far)})`);
    await ev(() => MasterplanV161.dropGroups());
    await page.waitForTimeout(1500);
    const lazy = await ev(() => Object.fromEntries(['mp161Net', 'mp161North', 'mp161Park', 'mp161Main', 'mp161Chord', 'mp161ParkE', 'mp161East', 'mp161Centre', 'mp161Sea'].map((n) => [n, !!scene.getObjectByName(n)])));
    check(lazy.mp161Main && lazy.mp161Chord && lazy.mp161ParkE && lazy.mp161East && lazy.mp161Centre && lazy.mp161Sea && !lazy.mp161Net && !lazy.mp161North, `lazy build by distance: from the centre the east groups are built, the port (250 m) and the north strip are not (${J(lazy)})`);
    const first = await ev(async () => {
      player.position.set(-120, 0, 26); playerVelocity.set(0, 0, 0); await __frame(); await __frame();
      const hid = ['mp161Main', 'mp161ParkE', 'mp161East', 'mp161Centre'].map((n) => { const o = scene.getObjectByName(n); return !o || o.visible; });
      player.position.set(200, 0, -125); playerVelocity.set(0, 0, 0); await __frame(); const f = await __frame();
      const g = scene.getObjectByName('mp161ParkE'), under = __floorY(200, -125, 'mp161');
      return { hiddenAtPort: hid.every((v) => v === false), built: !!g, visible: g && g.visible, floor: under };
    });
    check(first.hiddenAtPort && first.built && first.visible && first.floor && Math.abs(first.floor.y) <= .12 && /^mp161ParkE/.test(first.floor.name), `far groups hide at the port; two frames after a teleport back to the park's east end its floor is drawn (${J(first)})`);
    await ev(() => { player.position.set(170, 0, -125); playerVelocity.set(0, 0, 0); save.flush(); });
    await reloadGame(g, 5000);
    await ev(PAGE);
    const rel = await ev(() => ({ x: +player.position.x.toFixed(1), z: +player.position.z.toFixed(1), access: MasterplanV161.access(player.position.x, player.position.z), pk: !!scene.getObjectByName('mp161ParkE') }));
    check(Math.abs(rel.x - 170) < 1 && Math.abs(rel.z + 125) < 1 && rel.access && rel.pk, `reload keeps the player standing in the east park on paid floor (${J(rel)})`);
    const sigAfter = await ev(() => __sig());
    check(sigAfter.count === sigBefore.count && sigAfter.hash === sigBefore.hash, `after reload the road signature is still ${sigBefore.count}/${sigBefore.hash}`);
    const reset = await ev(() => { restoreMasterplanV161(null); MasterplanV161.refresh(); let hiddenScenery = 0; scene.children.forEach((c) => { if (c.userData && (c.userData.v161MpRetired || c.userData.v84HiddenRoadConflict && c.userData.v161MpRetired !== undefined)) hiddenScenery++; }); return { mp: __mpObjects(), colliders: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => /^mp161:/.test(c.label || '')).length, access: MasterplanV161.access(170, -125) || MasterplanV161.access(100, 0), hiddenScenery }; });
    check(reset.mp.length === 0 && reset.colliders === 0 && !reset.access && reset.hiddenScenery === 0, `reset clears the groups, the sea, every mp161 collider, the retired scenery and the paid floor (${J(reset)})`);
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
    const o = await ev(() => ({ flags: { ...masterplanStateV161 }, mp: __mpObjects(), markers: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), sig: __sig(), stage: stageIndex }));
    check(Object.keys(o.flags).length === 10 && Object.values(o.flags).every((f) => f === false) && o.mp.length === 0 && o.markers.every((m) => !m), `OLD_SAVE: ten flags false, no object, no pad (${J({ flags: o.flags, mp: o.mp.length, markers: o.markers, stage: o.stage })})`);
    check(o.sig.count === 51 && o.sig.hash === 648310607, `OLD_SAVE road signature stays 51 / 648310607 (${o.sig.count}/${o.sig.hash})`);
    check(await ev(() => !MasterplanV161.access(130, -100) && !MasterplanV161.access(100, 0) && !MasterplanV161.floor(150, 0)), 'OLD_SAVE: no paid floor anywhere (access false)');
    const chain = await ev(() => {
      const r = (d) => { restoreMasterplanV161(d); return Object.entries(masterplanStateV161).map(([k, v]) => k + (v ? '1' : '0')).join(' '); };
      const all = { B01: true, B02: true, B03: true, B04: true, B05: true, B06: true, B07: true, B08: true, B09: true, B10: true };
      return { all: r(all), noB05: r({ ...all, B05: false }), noB06: r({ ...all, B06: false }), noB07: r({ ...all, B07: false }), noB03: r({ ...all, B03: false }), none: r(null) };
    });
    check(chain.all === 'B011 B021 B031 B041 B051 B061 B071 B081 B091 B101' && chain.noB05 === 'B011 B021 B031 B041 B050 B061 B070 B080 B090 B100' && chain.noB06 === 'B011 B021 B031 B041 B051 B060 B071 B081 B090 B100' && chain.noB07 === 'B011 B021 B031 B041 B051 B061 B070 B080 B090 B100' && chain.noB03 === 'B011 B021 B030 B040 B050 B060 B070 B080 B090 B100' && chain.none === 'B010 B020 B030 B040 B050 B060 B070 B080 B090 B100', `restore enforces B03 -> B06; B05 -> B07 -> B08; B06 + B07 -> B09 -> B10 (${J(chain)})`);
    await ev(() => { stageIndex = 16; cityState.reputation = 500; refreshIndustrialPadMarkersV118(); });
    const later = await ev(() => ({ markers: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), mp: __mpObjects().length }));
    check(later.mp === 0 && later.markers.slice(1).every((m) => !m), `OLD_SAVE at stage 16: no object; B02..B10 stay locked behind B01 (${J(later.markers)})`);
    check(g.errors.length === 0, `OLD_SAVE: no console/page errors (${J(g.errors.slice(0, 4))})`);
  } finally { await g.close(); }
});
