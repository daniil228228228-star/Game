// Masterplan slice 1 (paid port B01/B02 + north avenue B03), second-opinion verification. Complements tests/masterplan-port.test.mjs (the user's own test: gating, prices,
// real button, clamp, geometry limits, reload) with what that one does not measure:
//   fresh save + stage jump: nothing of the layer exists before its turn; pads appear exactly when available (B01 needs stage 4 + a paid ring, B02 needs B01, B03 needs stage 6 +
//   reputation 25 + B01); every purchase through the real #actionBtn charges ONE exact price (read from the game: v124 x1.25 already applied) and builds the group;
//   road meshes (the groups behind the signatures 17/678830722, 47/-510574045, 51/648310607) have the same uuids and the same count/hash after every purchase;
//   draw-call / triangle / geometry delta of the whole layer at the same viewpoint (plan budget <= +40 draw calls);
//   edges of the paid floor probed in 8 directions at the pier end, the port avenue, the quay and the north strip end: the player stays on drawn floor (ray down hits the
//   floor within 10 cm), never reaches the sea, never gets stuck; real keyboard walk to the pier end and to the north end and back;
//   the pier guard barriers (decor, player:true) stop a real walk; screenshots at the pier end and the north strip end (SHOTS_DIR=<dir>);
//   save/reload keeps the flags and the built state, far reload builds nothing; OLD_SAVE (second launch) has all flags false, no new meshes, no pad before its gate, same road signature.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, reloadGame, check, waitForState, OLD_SAVE, jumpStage } from './lib/harness.mjs';

const J = JSON.stringify;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

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
  window.__frame = async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const i = renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geoms: i.memory.geometries }; };
  // the game's own updatePlayer (inertia, substeps, collision resolve, bounds clamp) driven by a camera-relative joystick vector; dt fixed at 1/30
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
  window.__floorY = (x, z) => { // first thing a ray from above hits at (x,z), among visible plain meshes (instanced / sprite / points are skipped)
    const rc = new THREE.Raycaster(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0), 0, 60), hits = [];
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || !o.material || o.material.transparent || !o.geometry) return;
      for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      if (x < bb.min.x - .1 || x > bb.max.x + .1 || z < bb.min.z - .1 || z > bb.max.z + .1) return;
      try { for (const h of rc.intersectObject(o, false)) if (h.point.y < 3) hits.push({ y: h.point.y, name: o.name || o.type }); } catch (_) {}
    });
    hits.sort((a, b) => b.y - a.y);
    return hits.length ? { y: +hits[0].y.toFixed(3), name: hits[0].name } : null;
  };
};

async function run(fn) { try { await fn(); } catch (e) { console.error('FAIL: exception ' + (e && e.stack || e)); process.exitCode = 1; } }

// =============================== launch 1: fresh game, stage jump, real purchases ===============================
await run(async () => {
  const g = await openGame({ save: 'clear', waitMs: 5000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    const sig0 = await ev(() => __sig());
    const pre = await ev(() => ({ mp: __mpObjects(), markers: ['B01', 'B02', 'B03'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), flags: { ...masterplanStateV161 }, steps: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.masterplanV161).map((s) => s.id) }));
    check(pre.mp.length === 0 && pre.markers.every((m) => !m) && Object.values(pre.flags).every((f) => f === false), `fresh game: no masterplan object, no pad marker, all flags false (${J(pre)})`);
    const fresh = await ev(() => __frame());
    // the stage-jump save: stage 16, but the ring is not paid and the rep is low -> still nothing
    await jumpStage(page, 16);
    await ev(() => { cityState.reputation = 0; refreshIndustrialPadMarkersV118(); });
    const jumped = await ev(() => ({ markers: ['B01', 'B02', 'B03'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), roads: totalRoadLevelsV37(), mp: __mpObjects().length, sig: __sig() }));
    check(jumped.markers.every((m) => !m) && jumped.mp === 0, `stage jump to 16 without a paid ring: no pad, no object (roads levels ${jumped.roads}, ${J(jumped.markers)})`);
    check(jumped.sig.count === sig0.count && jumped.sig.hash === sig0.hash, `a stage jump paves nothing through the layer: road signature ${sig0.count}/${sig0.hash} -> ${jumped.sig.count}/${jumped.sig.hash}`);
    // gate matrix: stage 3 + ring, stage 4 + ring
    const gates = await ev(() => {
      const out = {};
      const mark = () => ['B01', 'B02', 'B03'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join('');
      stageIndex = 3; CITY_DISTRICTS.forEach((c, i) => cityState.districtRoads[c.id] = { level: i < 2 ? 3 : 1, pendingUntil: 0, roadsBuilt: true }); window.__TYCOON_ROAD_AUDIT_V59__.syncOuter(); refreshIndustrialPadMarkersV118(); out.stage3 = mark();
      stageIndex = 4; refreshIndustrialPadMarkersV118(); out.stage4 = mark();
      stageIndex = 6; cityState.reputation = 25; refreshIndustrialPadMarkersV118(); out.stage6BeforeB01 = mark();
      return out;
    });
    check(gates.stage3 === '000' && gates.stage4 === '100' && gates.stage6BeforeB01 === '100', `pads appear exactly when available: stage 3 ${gates.stage3}, stage 4 + ring ${gates.stage4}, stage 6 + rep 25 but B01 unbought ${gates.stage6BeforeB01} (B01 B02 B03)`);

    // purchases through the real button
    await ev(() => { window.__charges = []; const o = tryPayResources; tryPayResources = function (c) { const r = o.apply(this, arguments); if (r && c && c.money) window.__charges.push(c.money); return r; }; });
    const sigBefore = await ev(() => __sig());
    async function buy(id, price) {
      await ev((id) => { money = 1e6; const p = industrialStepV118('mp161-' + id).pos; player.position.copy(p); playerVelocity.set(0, 0, 0); updateTreeInteraction(); window.__charges = []; }, id);
      const owns = await waitForState(page, (id) => { const t = nearestManualTargetV53(), b = document.getElementById('actionBtn'); return t?.step?.id === 'mp161-' + id && !b.hidden && !b.disabled; }, id, { timeout: 20000 });
      check(owns, `${id}: the real #actionBtn is live and owned by this pad`);
      await ev(() => document.getElementById('actionBtn').click());
      await waitForState(page, (id) => masterplanStateV161[id], id, { timeout: 20000 });
      const r = await ev((id) => ({ charged: window.__charges.slice(), step: industrialStepV118('mp161-' + id).cost.money, net: !!scene.getObjectByName(id === 'B03' ? 'mp161North' : 'mp161Net'), sig: __sig() }), id);
      check(r.charged.length === 1 && r.charged[0] === price && r.step === price, `${id}: one charge of exactly ${price} (game price ${r.step}, charged ${J(r.charged)})`);
      check(r.net, `${id}: ${id === 'B03' ? 'mp161North' : 'mp161Net'} group exists after the purchase`);
      check(J(r.sig.uuids) === J(sigBefore.uuids) && r.sig.count === sigBefore.count && r.sig.hash === sigBefore.hash, `${id}: road mesh uuids / count / hash unchanged (${r.sig.count}/${r.sig.hash})`);
    }
    // same viewpoint for the draw-call budget: beside the avenue start
    await ev(() => { player.position.set(-66, 0, 14); playerVelocity.set(0, 0, 0); });
    await page.waitForTimeout(1200);
    const f0 = await ev(() => __frame());
    await buy('B01', 350);
    check(await ev(() => industrialPadMarkersV118.has('mp161-B02') && !industrialPadMarkersV118.has('mp161-B01')), 'B01 pad gone, B02 appears (needs B01)');
    await buy('B02', 750);
    await ev(() => { stageIndex = 6; cityState.reputation = 25; refreshIndustrialPadMarkersV118(); });
    check(await ev(() => industrialPadMarkersV118.has('mp161-B03')), 'B03 pad appears at stage 6 + rep 25 once B01 is bought');
    await buy('B03', 3000);
    await ev(() => { player.position.set(-66, 0, 14); playerVelocity.set(0, 0, 0); });
    await page.waitForTimeout(1500);
    const f1 = await ev(() => __frame());
    console.log(`draw calls at the avenue start: before ${f0.calls} -> after ${f1.calls} (delta ${f1.calls - f0.calls}); triangles ${f0.tris} -> ${f1.tris}; geometries ${f0.geoms} -> ${f1.geoms}; fresh spawn view ${fresh.calls} calls`);
    check(f1.calls - f0.calls <= 40, `layer draw-call delta <= +40 at the same viewpoint (${f1.calls - f0.calls})`);
    await ev(() => { player.position.set(-114, 0, 26); playerVelocity.set(0, 0, 0); });
    await page.waitForTimeout(1500);
    const f2 = await ev(() => __frame());
    console.log(`draw calls at the pier end: ${f2.calls}, triangles ${f2.tris}`);
    const mesh = await ev(() => { const o = {}; ['mp161Net', 'mp161North'].forEach((n) => { let m = 0, t = 0; const r = scene.getObjectByName(n); r && r.traverse((c) => { if (c.isMesh) { m++; const g = c.geometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); o[n] = { meshes: m, tris: Math.round(t) }; }); return o; });
    console.log('layer meshes / triangles', J(mesh));

    // ---- edges: 8 directions from several starts, through the game's own updatePlayer (inertia + collision + clamp), 10 s of pushing each
    const starts = { pier: [[-110, 24], [-124, 26.5], [-100, 21]], avenue: [[-75, 15.5], [-88, 18]], quay: [[-99.5, 8], [-99.9, -2]], north: [[6, -90], [6, -150], [-4, -120], [10, -152]] };
    const probe = [];
    for (const [zone, pts] of Object.entries(starts)) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, pts[0]);
      await page.waitForTimeout(1200); // the layer shows its meshes within 150 m on a 500 ms tick, as it does for a walking player
      probe.push(...await ev(({ zone, pts }) => {
        const out = [];
        for (const [sx, sz] of pts) for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4;
          const end = __drive(sx, sz, Math.cos(a), Math.sin(a), 300);
          const inCore = Math.abs(end.x) <= 69.01 && Math.abs(end.z) <= 69.01;
          const ok = inCore || MasterplanV161.access(player.position.x, player.position.z); // exact position (the printed one is rounded)
          const floor = inCore ? null : __floorY(player.position.x, player.position.z);
          out.push({ zone, sx, sz, k, end: [end.x, end.z], inCore, ok, floorY: floor && floor.y, floorName: floor && floor.name, hasFloor: inCore || !!floor });
        }
        return out;
      }, { zone, pts }));
    }
    const outside = probe.filter((r) => !r.inCore);
    const bad = probe.filter((r) => !r.ok || !r.hasFloor || (!r.inCore && Math.abs(r.floorY) > 0.12));
    check(probe.length === 88 && outside.length >= 30 && bad.length === 0, `88 pushes of 10 s (8 directions x 11 starts at the pier end, quay, avenue, north strip): ${outside.length} end outside the old disc and all of them on drawn floor within 12 cm of y=0, none in the sea, none off the paid land (bad ${J(bad.slice(0, 4))})`);
    const frozen = outside.filter((r) => Math.abs(r.floorY) <= 0.12);
    console.log(`edge pushes ending outside the disc: ${outside.length}; floor names: ${J([...new Set(outside.map((r) => r.floorName))])}`);
    // the backdrop that used to stand on the avenue / in the north strip is hidden while the floor is paid
    const bd = await ev(() => { const o = []; scene.traverse((c) => { if (c.userData && c.userData.v161Backdrop && !c.isGroup) o.push(c); }); const near = o.filter((c) => { const b = c.userData.v161Backdrop; return Math.hypot(b.x + 90, b.z - 20) < b.r + 4 || Math.abs(b.x - 3) < b.r + 14 && b.z < -60; }); return { total: o.length, hidden: o.filter((c) => !c.visible).length, nearVisible: near.filter((c) => c.visible).length, near: near.length }; });
    check(bd.total >= 54 && bd.hidden >= 3 && bd.nearVisible === 0, `backdrop hills / skyline standing on the paid avenue or the north strip are hidden (${J(bd)})`);
    // sliding along the edge (info): a diagonal push into the pier edge
    const slide = await ev(() => { const a = __drive(-125, 26.2, -1, 1, 20), b = __drive(-125, 26.2, -1, 0, 20); return { diagonal: a, straight: b }; });
    console.log('push into the pier end, diagonal vs straight (info; the clamp keeps the last safe spot, it does not slide): ' + J(slide));

    // ---- barriers: the colliders alone (clamp switched off for the walk) stop the player at the guard line
    const pierInfo = await ev(() => { const g = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => c.label === 'mp161:guardrail'); return g.map((c) => ({ cat: c.category, flags: c.flags, pos: [+c.pos.x.toFixed(1), +c.pos.z.toFixed(1)], hx: c.hx, hz: +c.hz.toFixed(1) })); });
    check(pierInfo.length === 3 && pierInfo.every((c) => c.cat === 'decor' && c.flags.player === true), `3 guard barriers registered as decor with player:true ${J(pierInfo)}`);
    const barrier = await ev(() => {
      const P = window.MasterplanPortDataV161.pier, cx = P.reduce((t, p) => t + p[0], 0) / 4, cz = P.reduce((t, p) => t + p[1], 0) / 4;
      // signed distance of a point inside the deck to edge i (positive = on the deck side)
      const inside = (i, p) => { const a = P[i], b = P[i + 1], nx = -(b[1] - a[1]), nz = b[0] - a[0], l = Math.hypot(nx, nz), s = Math.sign((cx - a[0]) * nx + (cz - a[1]) * nz); return +(s * ((p.x - a[0]) * nx + (p.z - a[1]) * nz) / l).toFixed(2); };
      const real = clampPlayerBoundsV161; clampPlayerBoundsV161 = (x, z) => ({ x, z }); // collision only
      const out = { north: {}, south: {} };
      try { out.north.end = __drive(-118, 25.4, 0, -1, 400); out.north.d = inside(0, out.north.end); out.south.end = __drive(-118, 25.4, 0, 1, 400); out.south.d = inside(2, out.south.end); } finally { clampPlayerBoundsV161 = real; }
      return out;
    });
    console.log('guard barrier walks with the clamp off', J(barrier));
    check(barrier.north.d >= -0.15 && barrier.north.d <= 1.6 && barrier.south.d >= -0.15 && barrier.south.d <= 1.6, `the guard barrier colliders alone stop a 13 s walk at the north and at the south edge of the pier (distance to the guard line on the deck side: north ${barrier.north.d} m, south ${barrier.south.d} m)`);
    // the west end of the pier has a barrier too: walk straight at it, collider only
    const westEnd = await ev(() => { const P = window.MasterplanPortDataV161.pier; const real = clampPlayerBoundsV161; clampPlayerBoundsV161 = (x, z) => ({ x, z }); let end; try { end = __drive(-118, 27, -1, 0.17, 400); } finally { clampPlayerBoundsV161 = real; } return { end, edgeX: +(P[1][0] + (27 - P[1][1]) * (P[2][0] - P[1][0]) / (P[2][1] - P[1][1])).toFixed(2) }; });
    check(westEnd.end.x >= westEnd.edgeX - 0.3, `the west end barrier stops the walk at the end of the pier (edge x ${westEnd.edgeX}, stopped x ${westEnd.end.x})`);
    // ---- the long walks, with the real clamp: avenue -> pier end, and core -> north end
    let pos = await ev(() => __drive(-65, 13.8, -1, 0.2, 700));
    check(pos.x < -125, `real movement (updatePlayer, 23 s) from the core goes over the old disc, along the avenue and out to the pier end (stopped at ${J(pos)})`);
    pos = await ev(() => __drive(-120, 25.5, 1, -0.2, 700));
    check(pos.x > -80, `and the player can walk back into the old city (${J(pos)})`);
    pos = await ev(() => __drive(6, -62, 0, -1, 900));
    check(pos.z < -148 && pos.z > -156 && await ev(() => MasterplanV161.access(player.position.x, player.position.z)), `north: real movement from the core reaches the end of the strip and stops on paid land (${J(pos)})`);
    if (SHOTS) {
      await ev(() => { desiredCameraDistance = CAM_MAX_DIST; });
      for (const [name, x, z] of [['pier-end', -124, 26.5], ['avenue', -80, 17], ['north-end', 6, -148], ['north-mid', 6, -100]]) {
        await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); MasterplanV161.refresh(); }, [x, z]);
        await page.waitForTimeout(3500);
        await page.screenshot({ path: path.join(SHOTS, name + '.png') });
      }
    }
    const shadow = await ev(() => ({ sun: [sun.shadow.camera.left, sun.shadow.camera.right], layerShadows: scene.getObjectByName('mp161North') ? [...Object.values({ n: 1 })].length : 0 }));
    console.log('sun shadow camera ' + J(shadow.sun) + ': the layer surfaces beyond +-70 are outside it and take no shadow (flat light); see the screenshots');

    // ---- persistence
    await ev(() => { player.position.set(-120, 0, 26); save(); });
    await reloadGame(g, 5000);
    const rel = await ev(() => ({ flags: { ...masterplanStateV161 }, net: !!scene.getObjectByName('mp161Net'), x: player.position.x }));
    check(rel.flags.B01 && rel.flags.B02 && rel.flags.B03 && rel.net && rel.x < -100, `reload keeps B01/B02/B03, the built port and the player on the pier (${J(rel)})`);
    await ev(PAGE);
    const sigAfter = await ev(() => __sig());
    check(sigAfter.count === sigBefore.count && sigAfter.hash === sigBefore.hash, `after reload the road signature is still ${sigBefore.count}/${sigBefore.hash} (${sigAfter.count}/${sigAfter.hash})`);
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
    const o = await ev(() => ({ flags: { ...masterplanStateV161 }, mp: __mpObjects(), markers: ['B01', 'B02', 'B03'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), sig: __sig(), stage: stageIndex, calls: 0 }));
    check(Object.values(o.flags).every((f) => f === false) && o.mp.length === 0 && o.markers.every((m) => !m), `OLD_SAVE: all flags false, no masterplan object, no pad (${J({ flags: o.flags, mp: o.mp.length, markers: o.markers, stage: o.stage })})`);
    check(o.sig.count === 51 && o.sig.hash === 648310607, `OLD_SAVE road signature stays 51 / 648310607 (${o.sig.count}/${o.sig.hash})`);
    await ev(() => { stageIndex = 16; refreshIndustrialPadMarkersV118(); });
    const later = await ev(() => ({ markers: ['B01', 'B02', 'B03'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), roads: totalRoadLevelsV37(), mp: __mpObjects().length, sig: __sig() }));
    console.log('OLD_SAVE at stage 16 (opt-in): ' + J({ markers: later.markers, roadLevels: later.roads, mp: later.mp }));
    check(later.mp === 0 && !later.markers[1] && !later.markers[2], 'OLD_SAVE at stage 16: still no object, B02/B03 locked behind B01 (the road signature is asserted before the jump: the game itself lays the stage-16 roads on its own schedule)');
    check(g.errors.length === 0, `OLD_SAVE: no console/page errors (${J(g.errors.slice(0, 4))})`);
  } finally { await g.close(); }
});
