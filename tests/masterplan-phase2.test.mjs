// Masterplan PHASE 2 (plan B pads B04 "North-west blocks" and B05 "Industrial park and Northern artery") and the prerequisites found by the slice-1 verification
// (tests/masterplan-port-verify.test.mjs): the shadow camera follows the player on the light-space texel grid, walkable polygons live in the data file, the clamp slides
// along the edge for continuous movement, a paid group is built before the next render when the player is within reach, the backdrop is hidden where a floor stands.
//   launch 1 (fresh game, real purchases B01..B05 through #actionBtn):
//     * data is up to date (compile-port --check) and tools/masterplan/validate.mjs does not regress (3 known violations of the draft plan B are reported, none new);
//     * gate matrix: B04/B05 appear ONLY when stage >= 6 + reputation >= 25 + B03 paid; B05 needs B03 (not B04); B04's pad does not depend on B05 (bought in the other order);
//     * exact price through the real button: one charge of 5950 / 6800 (the game's own step price, JSON price final, no second v124 multiplier);
//     * groups mp161NW / mp161Park built, names mp161*, no 'road' in any name, v83CollisionIgnore on every surface mesh, no road tags; road mesh uuids / count / hash unchanged;
//     * walkable polygons: seams between the pads (strip <-> NW, strip <-> park, avenue <-> arteries) have no gap; 8-direction pushes (real updatePlayer) at every edge of every
//       paid floor end on drawn floor within 12 cm, never in the sea; a diagonal push into the coast slides along it, a jump does not;
//     * shadows: the shadow camera centre is within one texel (light space) of the player at spawn, NW, park, north strip end; map size / bias rules of the v164/v165 layer unchanged;
//     * draw calls of the whole masterplan layer at the worst viewpoints (budget <= +40), meshes and triangles of both new groups;
//     * first visit: after a reload at the far pier a teleport into the park builds its group and floor within two frames (before the 500 ms tick);
//     * save/reload keeps all five flags, the built groups and a player standing in the NW blocks; 0 console errors, 0 4xx.
//   launch 2 (OLD_SAVE): all flags false, no objects, no pads, signature 51/-720375465, requires chain B01 -> B03 -> B04/B05 enforced by restore.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { openGame, reloadGame, check, waitForState, OLD_SAVE, jumpStage } from './lib/harness.mjs';

const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GROUP = { B01: 'mp161Net', B02: 'mp161Net', B03: 'mp161North', B04: 'mp161NW', B05: 'mp161Park' };

// ---- offline: the compiled data is current, the plan validator does not regress
{
  const r = spawnSync('node', ['tools/masterplan/compile-port.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  check(r.status === 0, `compile-port --check: ${r.stdout.trim()}`);
  const v = spawnSync('node', ['tools/masterplan/validate.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const fails = (v.stdout.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5, 60));
  console.log('validate.mjs FAIL rows (known, draft plan B): ' + J(fails));
  // known: dead ends (quay end N-Q-END belongs to phase 1/7 data of slice 1), clearance to stage buildings (B-WF-LINK, B-S-1: phase 3-4), redundant edges (B-X-54 = B05 street, see changelog)
  check(fails.length <= 3 && /НАРУШЕНИЙ: 3/.test(v.stdout), `validator: no new violations (${fails.length} FAIL rows, "${(v.stdout.match(/НАРУШЕНИЙ: \d+/) || [''])[0]}")`);
}

// ---- offline: every walkable point of every pad is DRAWN (surface triangles, pier / lot decks, earth slab): the walkable polygons and the meshes come from one source
{
  const vm = await import('node:vm');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/masterplan-port-data-v161.js'), 'utf8'), ctx);
  const D = ctx.window.MasterplanPortDataV161;
  const inPoly = (x, z, poly) => { let y = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) y = !y; } return y; };
  const inRegion = (x, z, loops) => { let y = false; for (const l of loops) if (inPoly(x, z, l)) y = !y; return y; };
  const tris = []; // [minx, minz, maxx, maxz, ax, az, bx, bz, cx, cz]
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
  check(holes.length === 0 && tested > 10000, `data: every walkable point (${tested} grid points of B01..B05) is covered by a drawn triangle, deck or slab (holes ${J(holes.slice(0, 5))})`);
  check(Object.keys(D.land).slice(0, 3).join() === 'B03,B04,B05' && D.walkable.B04.length === 2 && D.pads.length >= 5, 'data: earth slabs only for the phase-2 pads, walkable regions per pad');
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
    const pre = await ev(() => ({ mp: __mpObjects(), markers: ['B01', 'B02', 'B03', 'B04', 'B05'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), flags: { ...masterplanStateV161 } }));
    check(pre.mp.length === 0 && pre.markers.every((m) => !m) && Object.keys(pre.flags).length >= 5 && Object.values(pre.flags).every((f) => f === false), `fresh game: no object, no pad, five flags all false (${J(pre.flags)})`);
    // ring + stage 4 -> B01 .. B03 through the real button
    await ev(() => { stageIndex = 4; CITY_DISTRICTS.forEach((c, i) => cityState.districtRoads[c.id] = { level: i < 2 ? 3 : 1, pendingUntil: 0, roadsBuilt: true }); window.__TYCOON_ROAD_AUDIT_V59__.syncOuter(); refreshIndustrialPadMarkersV118(); });
    await ev(() => { window.__charges = []; const o = tryPayResources; tryPayResources = function (c) { const r = o.apply(this, arguments); if (r && c && c.money) window.__charges.push(c.money); return r; }; });
    const sigBefore = await ev(() => __sig());
    const marks = () => ev(() => ['B01', 'B02', 'B03', 'B04', 'B05'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join(''));
    async function buy(id, price) {
      await ev((id) => { money = 1e6; const p = industrialStepV118('mp161-' + id).pos; player.position.copy(p); playerVelocity.set(0, 0, 0); updateTreeInteraction(); window.__charges = []; }, id);
      const owns = await waitForState(page, (id) => { const t = nearestManualTargetV53(), b = document.getElementById('actionBtn'); return t?.step?.id === 'mp161-' + id && !b.hidden && !b.disabled; }, id, { timeout: 25000 });
      check(owns, `${id}: the real #actionBtn is live and owned by this pad (pad stands on the floor the player owns: ${owns})`);
      check(await ev((id) => { const p = industrialStepV118('mp161-' + id).pos; return MasterplanV161.access(p.x, p.z) || Math.hypot(p.x, p.z) < 69; }, id), `${id}: its purchase circle is reachable (inside the old city or on already paid floor)`);
      await ev(() => document.getElementById('actionBtn').click());
      await waitForState(page, (id) => masterplanStateV161[id], id, { timeout: 25000 });
      const r = await ev((id) => ({ charged: window.__charges.slice(), step: industrialStepV118('mp161-' + id).cost.money, sig: __sig() }), id);
      check(r.charged.length === 1 && r.charged[0] === price && r.step === price, `${id}: one charge of exactly ${price} (game price ${r.step}, charged ${J(r.charged)})`);
      const exists = await ev((n) => !!scene.getObjectByName(n), GROUP[id]);
      check(exists, `${id}: group ${GROUP[id]} exists after the purchase`);
      check(J(r.sig.uuids) === J(sigBefore.uuids) && r.sig.count === sigBefore.count && r.sig.hash === sigBefore.hash, `${id}: road mesh uuids / count / hash unchanged (${r.sig.count}/${r.sig.hash})`);
    }
    await buy('B01', 350);
    await buy('B02', 750);
    // ---- gate matrix of the phase-2 pads
    await ev(() => { stageIndex = 6; cityState.reputation = 25; refreshIndustrialPadMarkersV118(); });
    check(await marks() === '00100', `B03 only (B04/B05 need B03): markers B01..B05 = ${await marks()}`);
    await buy('B03', 3000);
    check(await marks() === '00011', `after B03: B04 and B05 appear together: ${await marks()}`);
    const gates = await ev(() => {
      const m = () => ['B04', 'B05'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join('');
      const out = {};
      stageIndex = 5; cityState.reputation = 25; refreshIndustrialPadMarkersV118(); out.stage5 = m();
      stageIndex = 6; cityState.reputation = 24; refreshIndustrialPadMarkersV118(); out.rep24 = m();
      stageIndex = 6; cityState.reputation = 25; refreshIndustrialPadMarkersV118(); out.ok = m();
      const early = (() => { stageIndex = 5; const step = industrialStepV118('mp161-B04'), before = money; const ok = buildIndustrialStepV118(step); return { ok, spent: before - money }; })();
      out.earlyCharge = early;
      stageIndex = 6; refreshIndustrialPadMarkersV118();
      return out;
    });
    check(gates.stage5 === '00' && gates.rep24 === '00' && gates.ok === '11' && !gates.earlyCharge.ok && gates.earlyCharge.spent === 0, `gate matrix: stage 5 ${gates.stage5}, reputation 24 ${gates.rep24}, stage 6 + 25 ${gates.ok}; an early press neither charges nor builds (${J(gates.earlyCharge)})`);
    // B05 FIRST (it needs B03, not B04), then B04 (independent of B05)
    await buy('B05', 6800);
    check(await marks() === '00010', `B05 bought first: its pad is gone, B04's pad is still there: ${await marks()}`);
    await buy('B04', 5950);
    check(await marks() === '00000', `both bought: no pad left: ${await marks()}`);

    // ---- groups, names, tags
    const meshInfo = await ev(() => {
      const out = {};
      for (const n of ['mp161NW', 'mp161Park']) {
        const root = scene.getObjectByName(n); let meshes = 0, tris = 0, inst = 0; const names = [], bad = [];
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
      const sea = scene.getObjectByName('mp161Sea');
      out.sea = !!sea && !!sea.userData.v83CollisionIgnore;
      return out;
    });
    console.log('phase 2 groups (meshes / instanced / triangles): ' + J({ NW: [meshInfo.mp161NW.meshes, meshInfo.mp161NW.inst, meshInfo.mp161NW.tris], Park: [meshInfo.mp161Park.meshes, meshInfo.mp161Park.inst, meshInfo.mp161Park.tris] }));
    check(['mp161NW', 'mp161Park'].every((n) => meshInfo[n].bad.length === 0 && !meshInfo[n].rootRoad && meshInfo[n].names.every((x) => !x || x.startsWith('mp161'))), `group names are mp161*, no 'road' in any name, v83CollisionIgnore on every mesh, no road tag (${J([meshInfo.mp161NW.bad, meshInfo.mp161Park.bad])})`);
    check(meshInfo.mp161NW.meshes <= 12 && meshInfo.mp161Park.meshes <= 10 && meshInfo.mp161NW.inst === 1 && meshInfo.mp161Park.inst === 1 && meshInfo.sea, `meshes merged: NW ${meshInfo.mp161NW.meshes} (<= 12), park ${meshInfo.mp161Park.meshes} (<= 10), one InstancedMesh of parcel lines each, one sea quad`);
    check(await ev(() => { const l = D => D.lots.filter((x) => x.pad === 'B04').length === 35 && D.lots.filter((x) => x.pad === 'B05').length === 8; return l(window.MasterplanPortDataV161); }), 'data: 35 NW parcels, 8 park parcels (plan-B.json B04 / B05)');

    // ---- walkable floor: seams
    const seams = await ev(() => {
      const bad = [];
      for (let z = -153; z <= -96; z += 3) for (const x of [-8, -7.5, -8.5, 14, 13.5, 14.5, 6]) if (!MasterplanV161.access(x, z)) bad.push([x, z]);
      for (let x = -104; x <= 104; x += 4) if (!MasterplanV161.access(x, -100)) bad.push([x, -100]);   // the whole arterial, strip crossing included
      return bad;
    });
    check(seams.length === 0, `no seam: the arterial z=-100 and the strip edges x=-8 / x=14 are continuous floor (${J(seams.slice(0, 6))})`);
    check(await ev(() => !MasterplanV161.access(-60, -160) && !MasterplanV161.access(-60, -90) && !MasterplanV161.access(111, -125) && !MasterplanV161.access(-112, -125)), 'outside the paid land is not walkable (north of the coast, between the old city and the blocks, beyond the west and east ends)');
    // ---- pushes in 8 directions at every edge of every paid floor, through the real updatePlayer
    const starts = {
      nw: [[-104, -125], [-60, -152], [-60, -96], [-30, -125], [-104, -97], [-104, -152], [-12, -97], [-12, -152]],
      park: [[104, -125], [60, -152], [60, -96], [30, -125], [104, -97], [104, -152], [18, -97], [18, -152]],
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
    check(probe.length === 128 && bad.length === 0, `128 pushes of 8 s (8 directions x 16 starts at every edge of the NW blocks and the park): all end on drawn floor within 12 cm, none in the sea, none off the paid land (bad ${J(bad.slice(0, 4))}; ${moved} travelled > 3 m)`);
    console.log('floor names under the pushes: ' + J([...new Set(probe.map((r) => r.floorName))]));
    // props are solid (rule 3: no ghost trees / lamps): trunks and poles are registered colliders and stop a real walk
    const props = await ev(() => {
      const list = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => c.label === 'mp161:prop');
      const t = list.find((c) => c.hx > .1 && MasterplanV161.access(c.pos.x, c.pos.z - 4));   // a tree trunk with free floor 4 m south of it
      const tc = t ? { x: t.pos.x, z: t.pos.z } : null;
      const end = t ? __drive(tc.x, tc.z - 4, 0, 1, 90) : null;
      return { count: list.length, ok: list.every((c) => c.category === 'decor' && c.flags.player === true), tc, end, dist: end ? +Math.hypot(end.x - tc.x, end.z - tc.z).toFixed(2) : null };
    });
    check(props.count >= 30 && props.ok && props.dist !== null && props.dist >= .25 && props.dist < 2, `props are solid: ${props.count} tree / lamp colliders (decor, player:true); a walk straight at a trunk stops ${props.dist} m from its centre`);
    // slide: continuous movement along the coast; a jump keeps the last safe spot
    const slide = await ev(() => {
      const a = __drive(-60, -153.4, 1, -1, 60);
      player.position.set(-60, 0, -153.4); const jump = clampPlayerBoundsV161(-60, -170);
      const stay = { x: player.position.x, z: player.position.z };
      return { a, jump, stay };
    });
    check(slide.a.x > -60 + 4 && slide.a.z >= -154.45 && slide.jump.x === slide.stay.x && slide.jump.z === slide.stay.z, `diagonal push into the north coast slides along it (x ${-60} -> ${slide.a.x}, z ${slide.a.z}); a 17 m jump keeps the last safe spot (${J(slide.jump)})`);
    // the backdrop standing on a phase-2 floor is hidden
    const bd = await ev(() => {
      const o = []; scene.traverse((c) => { if (c.userData && c.userData.v161Backdrop && !c.isGroup) o.push(c); });
      const D = window.MasterplanPortDataV161, inRect = (b, r, m) => b.x > r[0] - m && b.x < r[2] + m && b.z > r[1] - m && b.z < r[3] + m;
      const near = o.filter((c) => { const b = c.userData.v161Backdrop; return inRect(b, D.bbox.B04, b.r) || inRect(b, D.bbox.B05, b.r); });
      return { total: o.length, hidden: o.filter((c) => !c.visible).length, nearVisible: near.filter((c) => c.visible).length, near: near.length };
    });
    check(bd.nearVisible === 0, `no backdrop hill / skyline stands on the phase-2 floors (${J(bd)})`);

    // ---- shadows follow the player
    const sh = [];
    for (const [name, x, z] of [['spawn', -2.6, -.5], ['nw', -60, -125], ['park', 60, -125], ['north end', 6, -150], ['port end', -120, 25]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(1500);
      sh.push({ name, ...await ev(() => __shadowOffset()) });
    }
    console.log('shadow camera offset of the player in texels: ' + J(sh.map((s) => [s.name, s.lx, s.ly])));
    check(sh.every((s) => Math.abs(s.lx) <= 1 && Math.abs(s.ly) <= 1), `shadow camera centre within one texel of the player at spawn / NW / park / north end / port end (texel ${sh[0].texel} m)`);
    check(sh.every((s) => s.half === 72 && [512, 1024, 2048].includes(s.map) && s.normalBias >= Math.min(.12, s.texel * .5) - 1e-9), `shadow settings of the v164/v165 layer intact (half-width ${sh[0].half}, map ${sh[0].map}, normalBias ${sh[0].normalBias})`);
    // a still player must not make the frustum swim: 20 frames, the target must not move
    await ev(() => { player.position.set(-60, 0, -125); playerVelocity.set(0, 0, 0); }); await page.waitForTimeout(1500);
    const still = await ev(async () => { const t0 = sun.target.position.clone(); for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r)); return sun.target.position.distanceTo(t0); });
    check(still <= sh[0].texel, `a standing player: the shadow target drifts ${still.toFixed(4)} m over 20 frames, at most one texel (${sh[0].texel} m; only the slow day cycle rotates the grid)`);

    // ---- draw calls of the whole layer at the worst viewpoints
    const budget = [];
    for (const [name, x, z] of [['junction (6,-100)', 6, -100], ['NW centre', -60, -125], ['park centre', 55, -125], ['strip end', 6, -148], ['NW west end', -100, -125]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(1500);
      const all = await ev(() => __frame());
      const delta = await ev(async () => {
        // the layer re-asserts the visibility of its GROUPS every frame (within 150 m); hide the meshes inside them (the sea quad is a mesh of its own)
        const mp = []; scene.children.forEach((o) => { if (o.userData && o.userData.masterplanV161 || o.name === 'mp161Sea') mp.push(o); });
        const parts = (o) => o.name === 'mp161Sea' ? [o] : o.children;
        const phase2 = mp.filter((o) => o.name === 'mp161NW' || o.name === 'mp161Park' || o.name === 'mp161Sea');
        const hide = (list) => { const saved = []; list.forEach((o) => parts(o).forEach((c) => { saved.push([c, c.visible]); c.visible = false; })); return saved; };
        const restore = (saved) => saved.forEach(([c, v]) => { c.visible = v; });
        let s1 = hide(phase2); const noP2 = await __frame(); restore(s1);
        s1 = hide(mp); const none = await __frame(); restore(s1);
        return { noP2, none };
      });
      budget.push({ name, calls: all.calls, layer: all.calls - delta.none.calls, phase2: all.calls - delta.noP2.calls, tris: all.tris - delta.none.tris });
    }
    console.log('draw calls (all / whole masterplan layer / phase 2 only), triangles of the layer: ' + J(budget));
    check(budget.every((b) => b.layer <= 40), `the whole masterplan layer costs <= +40 draw calls in the worst frame (max ${Math.max(...budget.map((b) => b.layer))}, phase 2 alone max ${Math.max(...budget.map((b) => b.phase2))})`);

    if (SHOTS) {
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
      for (const [name, x, z] of [['nw-blocks', -60, -125], ['industrial-park', 55, -125], ['north-magistral', 6, -100], ['shadow-north-end', 6, -150], ['nw-corner', -100, -140]]) {
        await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); MasterplanV161.refresh(); }, [x, z]);
        await page.waitForTimeout(3500);
        await page.screenshot({ path: path.join(SHOTS, name + '.png') });
      }
    }

    // ---- persistence + first visit
    await ev(() => { player.position.set(-120, 0, 26); playerVelocity.set(0, 0, 0); save.flush(); });   // save() is the v52 coordinator: it defers a call made < 420 ms after another, flush() writes now
    console.log('saved player: ' + await ev(() => JSON.stringify(JSON.parse(localStorage.getItem(SAVE_KEY)).player)));
    await reloadGame(g, 5000);
    await ev(PAGE);
    const far = await ev(() => ({ flags: { ...masterplanStateV161 }, x: player.position.x, z: player.position.z, raw: JSON.parse(localStorage.getItem(SAVE_KEY)).player }));
    check(['B01', 'B02', 'B03', 'B04', 'B05'].every((k) => far.flags[k]) && far.x < -100 && far.z > 20, `reload at the pier end keeps all five flags and the position on the paid pier (${J(far)})`);
    // the first visit of a group that is not built yet: drop every group (flags stay), the player is at the pier: only what is within 150 m is rebuilt
    await ev(() => MasterplanV161.dropGroups());
    await page.waitForTimeout(1500);
    const lazy = await ev(() => ({ net: !!scene.getObjectByName('mp161Net'), north: !!scene.getObjectByName('mp161North'), nw: !!scene.getObjectByName('mp161NW'), park: !!scene.getObjectByName('mp161Park'), sea: !!scene.getObjectByName('mp161Sea') }));
    check(lazy.net && lazy.nw && !lazy.north && !lazy.park, `lazy build by distance: from the pier end the port (near) and the NW blocks (125 m) are built, the north strip (184 m) and the park (174 m) are not (${J(lazy)})`);
    const first = await ev(async () => {
      player.position.set(55, 0, -125); playerVelocity.set(0, 0, 0);
      const t0 = performance.now(); const f = await __frame();
      const g = scene.getObjectByName('mp161Park'), under = __floorY(55, -125, 'mp161');
      return { built: !!g, visible: g && g.visible, floor: under, north: !!scene.getObjectByName('mp161North'), ms: Math.round(performance.now() - t0) };
    });
    check(first.built && first.visible && first.floor && Math.abs(first.floor.y) <= .12 && /^mp161Park/.test(first.floor.name) && first.north, `first visit: two frames after a teleport (before the 500 ms tick) the park group exists and the floor under the player is drawn (${J(first)})`);
    await ev(() => { player.position.set(-60, 0, -125); playerVelocity.set(0, 0, 0); save.flush(); });
    await reloadGame(g, 5000);
    await ev(PAGE);
    const rel = await ev(() => ({ flags: { ...masterplanStateV161 }, nw: !!scene.getObjectByName('mp161NW'), x: +player.position.x.toFixed(1), z: +player.position.z.toFixed(1), access: MasterplanV161.access(player.position.x, player.position.z) }));
    check(['B01', 'B02', 'B03', 'B04', 'B05'].every((k) => rel.flags[k]) && rel.nw && Math.abs(rel.x + 60) < 1 && Math.abs(rel.z + 125) < 1 && rel.access, `reload keeps B01..B05, the built blocks and the player standing in them (${J(rel)})`);
    const sigAfter = await ev(() => __sig());
    check(sigAfter.count === sigBefore.count && sigAfter.hash === sigBefore.hash, `after reload the road signature is still ${sigBefore.count}/${sigBefore.hash}`);
    // prestige / reset path (restoreMasterplanV161(null) + refresh): groups, sea, prop colliders and the floor all go
    const reset = await ev(() => { restoreMasterplanV161(null); MasterplanV161.refresh(); return { mp: __mpObjects(), colliders: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => /^mp161:/.test(c.label || '')).length, access: MasterplanV161.access(-60, -125) || MasterplanV161.access(55, -125) }; });
    check(reset.mp.length === 0 && reset.colliders === 0 && !reset.access, `reset clears the phase-2 groups, the sea, every mp161 collider and the paid floor (${J(reset)})`);
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
    const o = await ev(() => ({ flags: { ...masterplanStateV161 }, mp: __mpObjects(), markers: ['B01', 'B02', 'B03', 'B04', 'B05'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), sig: __sig(), stage: stageIndex }));
    check(Object.keys(o.flags).length >= 5 && Object.values(o.flags).every((f) => f === false) && o.mp.length === 0 && o.markers.every((m) => !m), `OLD_SAVE: five flags false, no object, no pad (${J({ flags: o.flags, mp: o.mp.length, markers: o.markers, stage: o.stage })})`);
    check(o.sig.count === 51 && o.sig.hash === -720375465, `OLD_SAVE road signature stays 51 / -720375465 (${o.sig.count}/${o.sig.hash})`);
    check(await ev(() => !MasterplanV161.access(-60, -125) && !MasterplanV161.access(55, -125) && !MasterplanV161.floor(-60, -125)), 'OLD_SAVE: no paid floor anywhere (access false)');
    const chain = await ev(() => {
      const r = (d) => { restoreMasterplanV161(d); return Object.entries(masterplanStateV161).slice(0, 5).map(([k, v]) => k + (v ? '1' : '0')).join(' '); };
      const out = { noB01: r({ B02: true, B03: true, B04: true, B05: true }), noB03: r({ B01: true, B02: true, B04: true, B05: true }), full: r({ B01: true, B03: true, B04: true }), none: r(null) };
      return out;
    });
    check(chain.noB01 === 'B010 B020 B030 B040 B050' && chain.noB03 === 'B011 B021 B030 B040 B050' && chain.full === 'B011 B020 B031 B041 B050' && chain.none === 'B010 B020 B030 B040 B050', `restore enforces B01 -> B03 -> B04 / B05 (${J(chain)})`);
    await ev(() => { stageIndex = 16; cityState.reputation = 500; refreshIndustrialPadMarkersV118(); });
    const later = await ev(() => ({ markers: ['B01', 'B02', 'B03', 'B04', 'B05'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), mp: __mpObjects().length }));
    check(later.mp === 0 && later.markers.slice(1).every((m) => !m), `OLD_SAVE at stage 16: no object; B02..B05 stay locked behind B01 (${J(later.markers)})`);
    check(g.errors.length === 0, `OLD_SAVE: no console/page errors (${J(g.errors.slice(0, 4))})`);
  } finally { await g.close(); }
});
