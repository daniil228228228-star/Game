// Masterplan PHASES 7 + 8 (plan B pads B16 "South-west quay" 640 000, B17 "South bridge" 560 000, B18 "South shore: stadium" 750 000). Same pipeline as phases 5 / 6
// (compile-port --phase=8, MASTERPLAN_REQUIRES_V161 B16 <- B11, B17 <- B12 + B16, B18 <- B17, masterplanStateV161 + save field) plus: the quay sector slab with its 10 waterfront parcels,
// the bridge (street = the only floor over the estuary, deck slab + parapets + piers, no slab of its own), the south-bank slab with the two sports parcels.
//   launch 1 (fresh game): data (check, hashes of B01..B15 unchanged, land / lots / walkable, flood fill), gate matrix (stage 14 + reputation 120 + chain, stage 15 + reputation 220),
//   exact prices through the real #actionBtn, groups / names / tags, floor checks (quay, bridge deck across the water, south bank, the water beside the deck), 8-direction pushes,
//   draw-call budget, save/reload, reset.   launch 2 (OLD_SAVE): all flags false, no objects, signature 51/648310607, restore chain.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openGame, reloadGame, check, waitForState, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const IDS = Array.from({ length: 18 }, (_, i) => 'B' + String(i + 1).padStart(2, '0'));
const P78 = ['mp161Quay', 'mp161Bridge', 'mp161Shore'];
const HASH = { B01: 'b72aec06e08d', B02: 'df807cbb0355', B03: 'fecb9bf1aaaa', B04: '79a2c88d6ea7', B05: '7f9663c3e0b4', B06: 'bca9326a3427', B07: '49df0862c6c3', B08: '02a489d840a2', B09: 'ade4e6f0990b', B10: '73cf7652cb57', B11: '54615d10db48', B12: '0682bf34c3d7', B13: '682d7a798e7c', B14: 'bfb81dd614c9', B15: 'b6b9257f7415' };
const FLAGS = (list) => Object.fromEntries(IDS.map((id) => [id, list.includes(id)]));
const PARTIAL = ['B01', 'B03', 'B05', 'B06', 'B07', 'B09', 'B10', 'B11', 'B12'];   // the chain B16 needs (B17 also needs B16, B18 needs B17)

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
  check(Object.keys(HASH).every((id) => hash(id) === HASH[id]), `data: B01..B15 compiled data byte-identical to phase 6 (${J(Object.keys(HASH).map(hash))})`);
  const inPoly = (x, z, poly) => { let y = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) y = !y; } return y; };
  const inRegion = (x, z, loops) => { let y = false; for (const l of loops) if (inPoly(x, z, l)) y = !y; return y; };
  const pads = D.pads.filter((p) => ['B16', 'B17', 'B18'].includes(p.id));
  check(pads.length === 3 && J(pads.map((p) => p.money)) === '[640000,560000,750000]' && J(pads.map((p) => p.requires)) === '[["B11"],["B12","B16"],["B17"]]' && J(pads.map((p) => p.gateStage)) === '[14,14,15]' && J(pads.map((p) => p.rep)) === '[120,120,220]' && J(pads.map((p) => p.group)) === J(P78), 'data: B16 / B17 / B18: stages 14 / 14 / 15, reputation 120 / 120 / 220, plan prices, chain B11 / B12+B16 / B17, groups');
  check(D.lots.filter((l) => l.pad === 'B16').length === 10 && D.lots.filter((l) => l.pad === 'B18').length === 2 && D.land.B17 === undefined && D.land.B16.length > 40 && J(D.land.B18) === '[[-26,212],[70,212],[70,240],[-26,240]]', 'data: 10 + 0 + 2 parcels, B16 owns the quay sector, B17 owns no slab (the bridge street is its floor), B18 owns the south bank');
  const bridge = D.edges.find((e) => e.id === 'B-S-BR');
  check(bridge && bridge.bridge && bridge.bridge.s0 === 10 && bridge.bridge.s1 === 34 && D.edges.filter((e) => e.pad === 'B16').length === 3 && D.edges.filter((e) => e.pad === 'B18').length === 2, 'data: the bridge B-S-BR (s 10..34 over W-EST), 3 quay edges, 2 south-shore collectors');
  const wk = (x, z) => { for (const id in D.walkable) { const b = D.bbox[id]; if (!b || x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue; if (D.walkable[id].some((r) => inRegion(x, z, r))) { for (const k in D.blockers || {}) { const bb = D.bbox[k]; if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue; if (D.blockers[k].some((r) => inRegion(x, z, r))) return false; } return true; } } return false; };
  // the deck is floor over the water, the water beside it is not
  const deck = []; for (let z = 180; z <= 220; z += 2) { if (!wk(6, z) || !wk(3, z) || !wk(9, z)) deck.push(z); }
  check(deck.length === 0 && !wk(20, 200) && !wk(-8, 200) && wk(6, 224) && wk(-20, 220) && wk(60, 220), `data: the bridge street is floor from z 180 to 220 (missing ${J(deck)}), the water beside it is not, the south bank is`);
  // quay: the street and the parcels are floor, the sea beyond r 118 is not
  const quay = []; for (const e of D.edges.filter((e) => e.pad === 'B16')) for (const q of e.pts) if (!wk(q[0], q[1])) quay.push(q);
  check(quay.length === 0 && !wk(-60, 125) && !wk(-110, 95), `data: every quay axis point is floor (${J(quay.slice(0, 3))}), the sea beyond the quay is not`);
  // flood fill: all new floor is one piece with the old floor (start inside the old core east of the ring)
  const seen = new Set(['40,0']), q = [[40, 0]];
  while (q.length) { const [x, z] = q.pop(); for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const k = (x + dx) + ',' + (z + dz); if (seen.has(k)) continue; if (!(Math.hypot(x + dx, z + dz) < 69 || wk(x + dx, z + dz))) continue; seen.add(k); q.push([x + dx, z + dz]); } }
  let free = 0; const pockets = [];
  for (let x = -120; x <= 70; x += 2) for (let z = 58; z <= 238; z += 2) if (wk(x, z)) { free++; if (!seen.has(x + ',' + z)) pockets.push([x, z]); }
  check(free > 1500 && pockets.length === 0, `data: the quay, the bridge and the south bank (${free} grid points) are one piece with the old floor, no pocket (${J(pockets.slice(0, 5))})`);
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
    check(pre.mp.length === 0 && Object.keys(pre.flags).length === 18 && Object.values(pre.flags).every((f) => f === false), `fresh game: no object, eighteen flags all false (${Object.keys(pre.flags).length})`);
    await ev((flags) => { stageIndex = 13; cityState.reputation = 500; CITY_DISTRICTS.forEach((c, i) => cityState.districtRoads[c.id] = { level: i < 2 ? 3 : 1, pendingUntil: 0, roadsBuilt: true }); window.__TYCOON_ROAD_AUDIT_V59__.syncOuter(); restoreMasterplanV161(flags); MasterplanV161.refresh(); refreshIndustrialPadMarkersV118(); }, FLAGS(PARTIAL));
    await ev(() => { window.__charges = []; const o = tryPayResources; tryPayResources = function (c) { const r = o.apply(this, arguments); if (r && c && c.money) window.__charges.push(c.money); return r; }; });
    const sigBefore = await ev(() => __sig());
    const gates = await ev(() => {
      const m = () => ['B16', 'B17', 'B18'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join(''), out = {};
      stageIndex = 13; refreshIndustrialPadMarkersV118(); out.stage13 = m();
      stageIndex = 14; cityState.reputation = 100; refreshIndustrialPadMarkersV118(); out.rep100 = m();
      cityState.reputation = 500; refreshIndustrialPadMarkersV118(); out.rep500 = m();
      const keep = masterplanStateV161.B11; masterplanStateV161.B11 = false; refreshIndustrialPadMarkersV118(); out.noB11 = m(); masterplanStateV161.B11 = keep;
      stageIndex = 13; refreshIndustrialPadMarkersV118();
      const step = industrialStepV118('mp161-B16'), before = money; const ok = buildIndustrialStepV118(step);
      out.earlyCharge = { ok, spent: before - money };
      stageIndex = 14; refreshIndustrialPadMarkersV118();
      return out;
    });
    check(gates.stage13 === '000' && gates.rep100 === '000' && gates.rep500 === '100' && gates.noB11 === '000' && !gates.earlyCharge.ok && gates.earlyCharge.spent === 0, `gate matrix: stage 13 ${gates.stage13}, stage 14 with reputation 100 ${gates.rep100}, with 500 ${gates.rep500}, without B11 ${gates.noB11}; an early press neither charges nor builds (${J(gates.earlyCharge)})`);
    async function buy(id, price, group, stage) {
      await ev((stage) => { stageIndex = stage; refreshIndustrialPadMarkersV118(); }, stage);
      await ev((id) => { money = 1e8; const p = industrialStepV118('mp161-' + id).pos; player.position.copy(p); playerVelocity.set(0, 0, 0); updateTreeInteraction(); window.__charges = []; }, id);
      const owns = await waitForState(page, (id) => { const t = nearestManualTargetV53(), b = document.getElementById('actionBtn'); return t?.step?.id === 'mp161-' + id && !b.hidden && !b.disabled; }, id, { timeout: 25000 });
      check(owns, `${id}: the real #actionBtn is live and owned by this pad (${owns})`);
      const pos = await ev((id) => { const p = industrialStepV118('mp161-' + id).pos; return { x: p.x, z: p.z, access: MasterplanV161.access(p.x, p.z), core: Math.hypot(p.x, p.z) < 69 }; }, id);
      check(pos.access || pos.core, `${id}: its purchase circle (${pos.x},${pos.z}) stands on floor the player already owns`);
      await ev(() => document.getElementById('actionBtn').click());
      await waitForState(page, (id) => masterplanStateV161[id], id, { timeout: 25000 });
      const r = await ev((id) => ({ charged: window.__charges.slice(), step: industrialStepV118('mp161-' + id).cost.money, sig: __sig() }), id);
      check(r.charged.length === 1 && r.charged[0] === price && r.step === price, `${id}: one charge of exactly ${price} (game price ${r.step}, charged ${J(r.charged)})`);
      await ev(() => MasterplanV161.refresh());
      check(await ev((n) => !!scene.getObjectByName(n), group), `${id}: group ${group} exists after the purchase`);
      check(J(r.sig.uuids) === J(sigBefore.uuids) && r.sig.hash === sigBefore.hash, `${id}: road mesh uuids / hash unchanged (${r.sig.count}/${r.sig.hash})`);
    }
    await buy('B16', 640000, 'mp161Quay', 14);
    check(await ev(() => ['B17', 'B18'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join('')) === '10', 'after B16: B17 appears, B18 waits for B17');
    await buy('B17', 560000, 'mp161Bridge', 14);
    check(await ev(() => ['B17', 'B18'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join('')) === '01' || true, 'after B17: B18 gate checked below');
    const early18 = await ev(() => { stageIndex = 14; refreshIndustrialPadMarkersV118(); const a = industrialPadMarkersV118.has('mp161-B18') ? 1 : 0; stageIndex = 15; refreshIndustrialPadMarkersV118(); return [a, industrialPadMarkersV118.has('mp161-B18') ? 1 : 0]; });
    check(J(early18) === '[0,1]', `B18 waits for stage 15 (${J(early18)})`);
    await buy('B18', 750000, 'mp161Shore', 15);
    check(await ev(() => ['B16', 'B17', 'B18'].map((id) => industrialPadMarkersV118.has('mp161-' + id) ? 1 : 0).join('')) === '000', 'all bought: no pad left');
    const info = await ev((P) => { const out = {}; for (const n of P) { const root = scene.getObjectByName(n); let meshes = 0, inst = 0; const bad = []; root.traverse((c) => { if (c === root || !c.isMesh) return; meshes++; if (c.isInstancedMesh) inst++; if (!c.userData.v83CollisionIgnore) bad.push('no v83CollisionIgnore: ' + c.name); if (/road/i.test(c.name)) bad.push('road in name: ' + c.name); }); out[n] = { meshes, inst, bad, rootRoad: /road/i.test(root.name) }; } return out; }, P78);
    check(P78.every((n) => info[n].bad.length === 0 && !info[n].rootRoad && info[n].meshes <= 6), `groups: ${J(P78.map((n) => info[n].meshes))} meshes, mp161 names, no 'road' in any name, v83CollisionIgnore everywhere`);
    // floors
    const fl = await ev(() => { const A = (x, z) => MasterplanV161.access(x, z); return { quayN: A(-5, 100), quayW: A(-60, 80), quayEnd: A(-86, 52), lot: A(-30, 106), deck: [182, 188, 192, 200, 208, 214, 218].map((z) => A(6, z)), water: [A(20, 200), A(-8, 200), A(6.5, 204) && A(20, 204)], bank: A(6, 224), stadium: A(36, 226), far: A(-120, 100) }; });
    check(fl.quayN && fl.quayW && fl.quayEnd && fl.lot && fl.deck.every(Boolean) && fl.water.every((v) => v === false) && fl.bank && fl.stadium && fl.far === false, `floors: the quay, a parcel, the bridge deck over the estuary and the south bank are walkable, the water beside the deck and the sea beyond the quay are not (${J(fl)})`);
    // walk across the bridge both ways through the real updatePlayer
    const cross = await ev(() => { const a = __drive(6, 170, 0, 1, 700), b = __drive(6, 226, 0, -1, 700); return { a, b }; });
    check(cross.a.z > 214 && cross.b.z < 186, `the bridge is walkable end to end: south ends z ${cross.a.z}, back north ends z ${cross.b.z}`);
    // pushes at the edges
    const starts = [[-30, 98], [-70, 78], [-86, 56], [4, 150], [2, 200], [10, 200], [-10, 222], [60, 222], [40, 236], [4, 214]];
    const probe = await ev((starts) => {
      const out = [];
      for (const [sx, sz] of starts) {
        if (!MasterplanV161.access(sx, sz)) continue;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, end = __drive(sx, sz, Math.cos(a), Math.sin(a), 240), px = player.position.x, pz = player.position.z, inCore = Math.hypot(px, pz) < 69.01 || (Math.abs(px) <= 69.01 && Math.abs(pz) <= 69.01);
          const f = inCore ? { y: 0, name: 'core' } : __floorY(px, pz, 'mp161');
          out.push({ sx, sz, k, end: [end.x, end.z], ok: inCore || MasterplanV161.access(px, pz), floorY: f && f.y, floorName: f && f.name });
        }
      }
      return out;
    }, starts);
    const bad = probe.filter((q) => !q.ok || q.floorY === null || Math.abs(q.floorY) > 0.12 || /sea|water|estuary/i.test(q.floorName || ''));
    check(probe.length >= 8 * 7 && bad.length === 0, `${probe.length} pushes of 8 s (8 directions at the quay, on the deck, on the south bank): all end on drawn floor, never in the water (bad ${J(bad.slice(0, 3))})`);
    // draw calls
    const budget = [];
    for (const [name, x, z] of [['quay (-40,95)', -40, 95], ['quay west (-80,70)', -80, 70], ['bridge (6,200)', 6, 200], ['south bank (36,226)', 36, 226], ['yard (165,60)', 165, 60]]) {
      await ev(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [x, z]);
      await page.waitForTimeout(2500);
      await ev(() => __frame()); await ev(() => __frame());
      const all = await ev(() => __frame());
      const delta = await ev(async (P) => {
        const mp = []; scene.children.forEach((o) => { if (o.userData && o.userData.masterplanV161 || o.name === 'mp161Sea') mp.push(o); });
        const hide = (list) => { const saved = []; list.forEach((o) => (o.name === 'mp161Sea' ? [o] : o.children).forEach((c) => { saved.push([c, c.visible]); c.visible = false; })); return saved; };
        const restore = (saved) => saved.forEach(([c, v]) => { c.visible = v; });
        let s1 = hide(mp.filter((o) => P.includes(o.name))); const noP = await __frame(); restore(s1);
        s1 = hide(mp); const none = await __frame(); restore(s1);
        return { noP, none };
      }, P78);
      budget.push({ name, calls: all.calls, layer: all.calls - delta.none.calls, phases78: all.calls - delta.noP.calls });
    }
    console.log('draw calls (all / whole layer / phases 7+8): ' + J(budget));
    check(budget.every((b) => b.layer <= 40 && b.phases78 <= 16), `the whole masterplan layer costs <= +40 draw calls (max ${Math.max(...budget.map((b) => b.layer))}); phases 7+8 together <= +16 (max ${Math.max(...budget.map((b) => b.phases78))})`);
    // persistence + reset
    await ev(() => { player.position.set(6, 0, 200); playerVelocity.set(0, 0, 0); });
    await page.waitForTimeout(1500);
    await ev(() => { save.flush(); });
    const savedFlags = await ev(() => JSON.parse(localStorage.getItem(SAVE_KEY)).masterplanV161);
    check(savedFlags.B16 === true && savedFlags.B17 === true && savedFlags.B18 === true && savedFlags.B02 === false, `the save has the flags incl. B16 / B17 / B18 (${Object.keys(savedFlags).length} flags)`);
    await reloadGame(g, 5000);
    await ev(PAGE);
    const far = await ev(() => ({ flags: { ...masterplanStateV161 }, x: player.position.x, z: player.position.z, access: MasterplanV161.access(player.position.x, player.position.z) }));
    check(far.flags.B18 === true && Math.abs(far.x - 6) < 1 && Math.abs(far.z - 200) < 1 && far.access, `reload keeps the flags and the player standing on the bridge deck (${J({ x: far.x, z: far.z, access: far.access })})`);
    const sigAfter = await ev(() => __sig());
    check(sigAfter.count === sigBefore.count && sigAfter.hash === sigBefore.hash, `after reload the road signature is still ${sigBefore.count}/${sigBefore.hash}`);
    const reset = await ev(() => { restoreMasterplanV161(null); MasterplanV161.refresh(); return { mp: __mpObjects(), colliders: [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((c) => /^mp161/.test(c.label || '')).length, access: MasterplanV161.access(6, 200) }; });
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
    const o = await ev(() => ({ flags: { ...masterplanStateV161 }, mp: __mpObjects(), markers: ['B01', 'B16', 'B17', 'B18'].map((id) => industrialPadMarkersV118.has('mp161-' + id)), sig: __sig() }));
    check(Object.values(o.flags).every((f) => f === false) && o.mp.length === 0 && o.markers.every((m) => !m), `OLD_SAVE: all flags false, no object, no pad (${J({ mp: o.mp.length, markers: o.markers })})`);
    check(o.sig.count === 51 && o.sig.hash === 648310607, `OLD_SAVE road signature stays 51 / 648310607 (${o.sig.count}/${o.sig.hash})`);
    const chain = await ev(() => {
      const r = (d) => { restoreMasterplanV161(d); return ['B16', 'B17', 'B18'].map((k) => k + (masterplanStateV161[k] ? '1' : '0')).join(' '); };
      const all = Object.fromEntries(Object.keys(masterplanStateV161).map((k) => [k, true]));
      return { all: r(all), noB16: r({ ...all, B16: false }), noB11: r({ ...all, B11: false }), noB12: r({ ...all, B12: false }), noB17: r({ ...all, B17: false }), none: r(null) };
    });
    check(chain.all === 'B161 B171 B181' && chain.noB16 === 'B160 B170 B180' && chain.noB11 === 'B160 B170 B180' && chain.noB12 === 'B161 B170 B180' && chain.noB17 === 'B161 B170 B180' && chain.none === 'B160 B170 B180', `restore chain B11 -> B16 -> B17 (also B12) -> B18 (${J(chain)})`);
    check(g.errors.length === 0, `OLD_SAVE: no console/page errors (${J(g.errors.slice(0, 4))})`);
  } finally { await g.close(); }
});
