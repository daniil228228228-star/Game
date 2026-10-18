// Masterplan PHASE 6 (plan B pad B15 "South station" 330 000, requires B13, gate stage 12). Same pipeline as tests/masterplan-phase5.test.mjs (compile-port --phase=6,
// MASTERPLAN_REQUIRES_V161 B15 <- B13, masterplanStateV161 + save field) plus: the station hall, two platforms with canopies and the bus station (all merged into the pad's own batches,
// no new mesh beyond the pad group's three), the hall and the platforms solid (blockers + fences), forecourt and bus station on floor that is already paid.
// The plan's pedestrian underpass is not built (documented in compile-port.mjs): the bus station is reached over the apron south of the tracks.
//   launch 1 (fresh game): data (check, hashes of B01..B14 unchanged, station data, blockers, flood fill), gate matrix (stage 12 + B13), exact price 330000 through the real #actionBtn,
//   group / names / tags, hall + platforms not walkable, forecourt + bus station walkable, 8-direction pushes round the hall, draw-call budget, save/reload, reset.
//   launch 2 (OLD_SAVE): all flags false, no objects, signature 51/648310607, restore chain.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openGame, reloadGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IDS = Array.from({ length: 15 }, (_, i) => 'B' + String(i + 1).padStart(2, '0'));
const P6 = ['mp161Station'];
const HASH = { B01: 'b72aec06e08d', B02: 'df807cbb0355', B03: 'fecb9bf1aaaa', B04: '79a2c88d6ea7', B05: '7f9663c3e0b4', B06: 'bca9326a3427', B07: '49df0862c6c3', B08: '02a489d840a2', B09: 'ade4e6f0990b', B10: '73cf7652cb57', B11: '54615d10db48', B12: '0682bf34c3d7', B13: '682d7a798e7c', B14: 'bfb81dd614c9' };
const FLAGS = (list, all = IDS) => Object.fromEntries(all.map((id) => [id, list.includes(id)]));
const PARTIAL = ['B01', 'B03', 'B05', 'B06', 'B07', 'B09', 'B10', 'B11', 'B12', 'B13'];   // the chain B15 needs (B02, B04, B08 never bought; B14 is not needed)

// ---- offline
{
  const r = spawnSync('node', ['tools/masterplan/compile-port.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  check(r.status === 0, `compile-port --check: ${r.stdout.trim()}`);
  const v = spawnSync('node', ['tools/masterplan/validate.mjs'], { cwd: ROOT, encoding: 'utf8' });
  check(/НАРУШЕНИЙ: [0-9]+/.test(v.stdout) && +/НАРУШЕНИЙ: ([0-9]+)/.exec(v.stdout)[1] <= 3, `validator: no new violations ("${(v.stdout.match(/НАРУШЕНИЙ: \d+/) || [''])[0]}")`);
}
{
  const vm = await import('node:vm');
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/masterplan-port-data-v161.js'), 'utf8'), ctx);
  const D = ctx.window.MasterplanPortDataV161;
  const hash = (id) => crypto.createHash('sha1').update(J([D.surfaces[id], D.boundaries[id], D.walkable[id], D.bbox[id], D.land[id] || null])).digest('hex').slice(0, 12);
  check(Object.keys(HASH).every((id) => hash(id) === HASH[id]), `data: B01..B14 compiled data byte-identical to phase 5 (${J(Object.keys(HASH).map(hash))})`);
  const inPoly = (x, z, poly) => { let y = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) y = !y; } return y; };
  const inRegion = (x, z, loops) => { let y = false; for (const l of loops) if (inPoly(x, z, l)) y = !y; return y; };
  const p15 = D.pads.find((p) => p.id === 'B15');
  check(D.pads.length >= 15 && p15 && p15.gateStage === 12 && p15.rep === undefined && p15.money === 330000 && J(p15.requires) === '["B13"]' && p15.group === 'mp161Station', 'data: B15: stage 12, no reputation, plan price 330000, requires B13, group mp161Station');
  const st = D.stations.find((s) => s.id === 'ST-PAX');
  check(st && st.platforms.length === 2 && D.blockers.B15.length === 3 && D.fences.B15.length >= 10 && J(D.walkable.B15) === '[]', `data: ST-PAX hall + 2 platforms are blockers (${D.blockers.B15.length} regions, ${D.fences.B15.length} fence segments), the pad owns no floor`);
  const wk = (x, z) => { for (const id in D.walkable) { const b = D.bbox[id]; if (!b || x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue; if (D.walkable[id].some((r) => inRegion(x, z, r))) { for (const k in D.blockers) { const bb = D.bbox[k]; if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue; if (D.blockers[k].some((r) => inRegion(x, z, r))) return false; } return true; } } return false; };
  check(!wk(128, 60) && !wk(126, 71.3) && !wk(126, 82.7) && wk(128, 54) && wk(128, 91), 'data: hall and platforms are no floor, forecourt (128,54) and bus station (128,91) are');
  const seen = new Set(['100,60']), q = [[100, 60]];
  while (q.length) { const [x, z] = q.pop(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (x + dx) + ',' + (z + dz); if (seen.has(k) || !wk(x + dx, z + dz)) continue; seen.add(k); q.push([x + dx, z + dz]); } }
  let free = 0; const pockets = [];
  for (let x = 108; x <= 212; x++) for (let z = 52; z <= 96; z++) if (wk(x, z)) { free++; if (!seen.has(x + ',' + z)) pockets.push([x, z]); }
  check(free > 2000 && pockets.length === 0, `data: the free floor round the station (${free} grid points) is one piece with the old floor, no pocket (${J(pockets.slice(0, 5))})`);
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
    check(pre.mp.length === 0 && Object.keys(pre.flags).length >= 15 && Object.values(pre.flags).every((f) => f === false), `fresh game: no object, all flags false (${Object.keys(pre.flags).length} flags)`);
    await ev((flags) => { stageIndex = 11; cityState.reputation = 500; CITY_DISTRICTS.forEach((c, i) => cityState.districtRoads[c.id] = { level: i < 2 ? 3 : 1, pendingUntil: 0, roadsBuilt: true }); window.__TYCOON_ROAD_AUDIT_V59__.syncOuter(); restoreMasterplanV161(flags); MasterplanV161.refresh(); refreshIndustrialPadMarkersV118(); }, FLAGS(PARTIAL, Object.keys(await ev(() => masterplanStateV161))));
    await ev(() => { window.__charges = []; const o = tryPayResources; tryPayResources = function (c) { const r = o.apply(this, arguments); if (r && c && c.money) window.__charges.push(c.money); return r; }; });
    const sigBefore = await ev(() => __sig());
    const gates = await ev(() => {
      const m = () => industrialPadMarkersV118.has('mp161-B15') ? 1 : 0, out = {};
      stageIndex = 11; refreshIndustrialPadMarkersV118(); out.stage11 = m();
      stageIndex = 12; cityState.reputation = 0; refreshIndustrialPadMarkersV118(); out.noRep = m();
      const keep = masterplanStateV161.B13; masterplanStateV161.B13 = false; refreshIndustrialPadMarkersV118(); out.noB13 = m(); masterplanStateV161.B13 = keep;
      stageIndex = 11; refreshIndustrialPadMarkersV118();
      const step = industrialStepV118('mp161-B15'), before = money; const ok = buildIndustrialStepV118(step);
      out.earlyCharge = { ok, spent: before - money };
      stageIndex = 12; refreshIndustrialPadMarkersV118();
      return out;
    });
    check(gates.stage11 === 0 && gates.noRep === 1 && gates.noB13 === 0 && !gates.earlyCharge.ok && gates.earlyCharge.spent === 0, `gate matrix: stage 11 ${gates.stage11}, stage 12 without reputation ${gates.noRep}, without B13 ${gates.noB13}; an early press neither charges nor builds (${J(gates.earlyCharge)})`);
    await ev(() => { money = 1e7; const p = industrialStepV118('mp161-B15').pos; player.position.copy(p); playerVelocity.set(0, 0, 0); updateTreeInteraction(); window.__charges = []; });
    const owns = await waitForState(page, () => { const t = nearestManualTargetV53(), b = document.getElementById('actionBtn'); return t?.step?.id === 'mp161-B15' && !b.hidden && !b.disabled; }, null, { timeout: 25000 });
    check(owns, `B15: the real #actionBtn is live and owned by this pad (${owns})`);
    const pos = await ev(() => { const p = industrialStepV118('mp161-B15').pos; return { x: p.x, z: p.z, access: MasterplanV161.access(p.x, p.z) }; });
    check(pos.access, `B15: its purchase circle (${pos.x},${pos.z}) stands on floor the player already owns`);
    await ev(() => document.getElementById('actionBtn').click());
    await waitForState(page, () => masterplanStateV161.B15, null, { timeout: 25000 });
    const r = await ev(() => ({ charged: window.__charges.slice(), step: industrialStepV118('mp161-B15').cost.money, sig: __sig() }));
    check(r.charged.length === 1 && r.charged[0] === 330000 && r.step === 330000, `B15: one charge of exactly 330000 (game price ${r.step}, charged ${J(r.charged)})`);
    await ev(() => MasterplanV161.refresh());
    check(await ev(() => !!scene.getObjectByName('mp161Station')), 'B15: group mp161Station exists after the purchase');
    check(J(r.sig.uuids) === J(sigBefore.uuids) && r.sig.hash === sigBefore.hash, `B15: road mesh uuids / hash unchanged (${r.sig.count}/${r.sig.hash})`);
    const info = await ev(() => { const root = scene.getObjectByName('mp161Station'), bad = []; let meshes = 0; root.traverse((c) => { if (c === root || !c.isMesh) return; meshes++; if (!c.userData.v83CollisionIgnore) bad.push('no v83CollisionIgnore: ' + c.name); if (/road/i.test(c.name)) bad.push('road in name: ' + c.name); }); return { meshes, bad, rootRoad: /road/i.test(root.name) }; });
    check(info.bad.length === 0 && !info.rootRoad && info.meshes <= 4, `group: ${info.meshes} meshes, mp161 names, no 'road' in any name, v83CollisionIgnore everywhere (${J(info.bad)})`);

    const walk = await ev(() => ({ hall: MasterplanV161.access(128, 60), platN: MasterplanV161.access(126, 71.3), platS: MasterplanV161.access(126, 82.7), plaza: MasterplanV161.access(128, 54), bus: MasterplanV161.access(128, 91), apron: MasterplanV161.access(120, 88) }));
    check(!walk.hall && !walk.platN && !walk.platS && walk.plaza && walk.bus && walk.apron, `not walkable: the hall, both platforms; walkable: forecourt, bus station, apron (${J(walk)})`);
    // pushes in 8 directions round the hall and the platforms through the real updatePlayer
    const starts = [[128, 53.5], [112, 58], [144, 58], [128, 88], [118, 90], [140, 90], [112, 66], [144, 66]];
    const probe = await ev((starts) => {
      const out = [];
      for (const [sx, sz] of starts) {
        if (!MasterplanV161.access(sx, sz)) continue;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, end = __drive(sx, sz, Math.cos(a), Math.sin(a), 240), px = player.position.x, pz = player.position.z;
          const inCore = Math.abs(px) <= 69.01 && Math.abs(pz) <= 69.01, inHall = px > 115.6 && px < 140.4 && pz > 55.6 && pz < 64.4, onPlat = px > 113.6 && px < 138.4 && ((pz > 69.4 && pz < 73.2) || (pz > 80.8 && pz < 84.6));
          const f = inCore ? { y: 0 } : __floorY(px, pz, 'mp161');
          out.push({ sx, sz, k, end: [end.x, end.z], ok: (inCore || MasterplanV161.access(px, pz)) && !inHall && !onPlat, floorY: f && f.y });
        }
      }
      return out;
    }, starts);
    const bad = probe.filter((q) => !q.ok || q.floorY === null || Math.abs(q.floorY) > 0.12);
    check(probe.length >= 8 * 6 && bad.length === 0, `${probe.length} pushes of 8 s round the hall, the platforms and the bus station: all end on drawn floor, never inside the hall or on a platform (bad ${J(bad.slice(0, 3))})`);
    // draw calls
    const budget = [];
    for (const [name, x, z] of [['forecourt (128,52)', 128, 52], ['bus station (128,91)', 128, 91], ['yard (165,60)', 165, 60], ['M2 land (102,120)', 102, 120]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(2500);
      await ev(() => __frame()); await ev(() => __frame());
      const all = await ev(() => __frame());
      const delta = await ev(async (P6) => {
        const mp = []; scene.children.forEach((o) => { if (o.userData && o.userData.masterplanV161 || o.name === 'mp161Sea') mp.push(o); });
        const hide = (list) => { const saved = []; list.forEach((o) => (o.name === 'mp161Sea' ? [o] : o.children).forEach((c) => { saved.push([c, c.visible]); c.visible = false; })); return saved; };
        const restore = (saved) => saved.forEach(([c, v]) => { c.visible = v; });
        let s1 = hide(mp.filter((o) => P6.includes(o.name))); const noP6 = await __frame(); restore(s1);
        s1 = hide(mp); const none = await __frame(); restore(s1);
        return { noP6, none };
      }, P6);
      budget.push({ name, calls: all.calls, layer: all.calls - delta.none.calls, phase6: all.calls - delta.noP6.calls });
    }
    console.log('draw calls (all / whole layer / phase 6 only): ' + J(budget));
    check(budget.every((b) => b.layer <= 40 && b.phase6 <= 8), `the whole masterplan layer costs <= +40 draw calls (max ${Math.max(...budget.map((b) => b.layer))}); phase 6 alone <= +8 (max ${Math.max(...budget.map((b) => b.phase6))})`);
    // persistence + reset
    await ev(() => { player.position.set(128, 0, 53.5); playerVelocity.set(0, 0, 0); });
    await page.waitForTimeout(1500);
    await ev(() => { save.flush(); });
    const savedFlags = await ev(() => JSON.parse(localStorage.getItem(SAVE_KEY)).masterplanV161);
    check(savedFlags.B15 === true && savedFlags.B13 === true && savedFlags.B02 === false, `the save has the masterplan flags incl. B15 (${Object.keys(savedFlags).length} flags)`);
    await reloadGame(g, 5000);
    await ev(PAGE);
    const far = await ev(() => ({ flags: { ...masterplanStateV161 }, x: player.position.x, z: player.position.z }));
    check(far.flags.B15 === true && far.flags.B02 === false && Math.abs(far.x - 128) < 1 && Math.abs(far.z - 53.5) < 1, `reload keeps the flags and the position on the forecourt (${J({ x: far.x, z: far.z, B15: far.flags.B15 })})`);
    const sigAfter = await ev(() => __sig());
    check(sigAfter.count === sigBefore.count && sigAfter.hash === sigBefore.hash, `after reload the road signature is still ${sigBefore.count}/${sigBefore.hash}`);
    const reset = await ev(() => { restoreMasterplanV161(null); MasterplanV161.refresh(); return { mp: __mpObjects(), colliders: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => /^mp161/.test(c.label || '')).length, access: MasterplanV161.access(128, 54) }; });
    check(reset.mp.length === 0 && reset.colliders === 0 && !reset.access, `reset clears the groups, every mp161 collider and the paid floor (${J(reset)})`);
    check(g.errors.length === 0, `no console/page errors (${J(g.errors.slice(0, 4))})`);
    check(g.badResponses.length === 0, 'no 4xx');
  } finally { await g.close(); }
});

await run(async () => {
  const g = await openGame({ save: OLD_SAVE, waitMs: 6000 });
  const { page } = g;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    const o = await ev(() => ({ flags: { ...masterplanStateV161 }, mp: __mpObjects(), markers: ['B01', 'B13', 'B15'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), sig: __sig() }));
    check(Object.values(o.flags).every((f) => f === false) && o.mp.length === 0 && o.markers.every((m) => !m), `OLD_SAVE: all flags false, no object, no pad (${J({ mp: o.mp.length, markers: o.markers })})`);
    check(o.sig.count === 51 && o.sig.hash === 648310607, `OLD_SAVE road signature stays 51 / 648310607 (${o.sig.count}/${o.sig.hash})`);
    const chain = await ev(() => {
      const r = (d) => { restoreMasterplanV161(d); return ['B13', 'B14', 'B15'].map((k) => k + (masterplanStateV161[k] ? '1' : '0')).join(' '); };
      const all = Object.fromEntries(Object.keys(masterplanStateV161).map((k) => [k, true]));
      return { all: r(all), noB13: r({ ...all, B13: false }), noB12: r({ ...all, B12: false }), none: r(null) };
    });
    check(chain.all === 'B131 B141 B151' && chain.noB13 === 'B130 B140 B150' && chain.noB12 === 'B130 B140 B150' && chain.none === 'B130 B140 B150', `restore chain B12 -> B13 -> B14 / B15 (${J(chain)})`);
    check(g.errors.length === 0, `OLD_SAVE: no console/page errors (${J(g.errors.slice(0, 4))})`);
  } finally { await g.close(); }
});
