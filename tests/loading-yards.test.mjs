// Loading yards, CHANGELOG_V161.md 2026-10-10 (12) -- user: "отдельно давай всю погрузку в другое место, а не на дороги, там бетон, металл, давай всё-таки не жестить и соблюдать структуру".
// ONE launch (a built-out save: every staged unlock built, stage 6), checked against the scene, not against the game's own audit objects:
//   A. no loading / pickup / drop point on a road: the pads (LOGISTICS_ZONES), the truck bays (cargoInfo(...).source), the log drop-off and the plank bay stand outside the carriageway of EVERY road
//      mesh (triangle-level distance, the same road groups the signature tests hash: v70 service roads, v113 starter surface, stage roads, transport access roads); a truck body footprint (1.15 x 2.11,
//      rotated by the bay yaw) overlaps no road triangle; the lead-in polyline leaves the lane at the lane node and runs through the yard gate;
//   B. physics: pads / bays / the whole lead-in outside every collider (the game's own gatherPhysicsCircles + resolvePlayerCircleCollisions), the yard obstacles (bollards / lamp / sign) are in the v83
//      registry, kerb / slab are walkable, every yard group <= 6 meshes, min y ~ 0, yards exist only with their building flag;
//   C. the stock on display is the real stock: concrete / metal piles and the plank yard stack at 0 / 1 / 5 / cap / more than cap = floor(stock) capped at STACK_CAP;
//   D. trucks reach and USE the bay: the real moveWorkVehicle (stepped synchronously) drives each cargo's delivery truck from its home to the bay (state 'loading' within 0.2 m of the stop, yaw along the bay),
//      the parked body is off the carriageway, the way out runs through the gate back to the lane node, other trucks' depot token is free again while it loads in the yard;
//   E. before / after table (printed): where every resource is picked up / dropped / stopped at and the nearest road distance.
import { openGame, check, waitForState } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = process.env.SHOTS_DIR || '';   // SHOTS_DIR=/some/dir: also writes pictures of every yard (stock 12, a truck in each bay) from above and from an angle

const J = JSON.stringify;
const SAVE = { saveVersion: 20, stageIndex: 6, money: 5e6, planks: 60, concrete: 60, metal: 60, buildings: Array.from({ length: 6 }, (_, i) => ({ index: i, level: 1 })) };
const g = await openGame({ save: SAVE, waitMs: 9000 });
const { page } = g;

await page.evaluate(() => {
  { const o = window.__TYCOON_V119__?.state?.owned; if (o) o.planks = o.concrete = o.metal = true; }
  try { syncDeliveryFleet(); syncDeliveryFleet(); } catch (e) { /* ignore */ }
  // road triangles (world XZ) of every road group the signature tests hash + the transport access roads
  const tris = [], names = new Set(['v70RefinedServiceRoads', 'v113UnifiedStarterRoadSurface', 'transportAccessRoads']);
  scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  scene.traverse((m) => {
    if (!m.isMesh) return;
    let hit = false; for (let p = m.parent; p; p = p.parent) { if (names.has(p.name) || p === cityWorldRuntime?.stageRoads || p === cityWorldRuntime?.transportAccessRoads) { hit = true; break; } }
    if (!hit) return;
    const geo = m.geometry, pa = geo.attributes.position, ix = geo.index, n = ix ? ix.count : pa.count;
    const W = (i) => { v.fromBufferAttribute(pa, i).applyMatrix4(m.matrixWorld); return [v.x, v.z]; };
    for (let i = 0; i + 2 < n; i += 3) {
      const a = W(ix ? ix.getX(i) : i), b = W(ix ? ix.getX(i + 1) : i + 1), c = W(ix ? ix.getX(i + 2) : i + 2);
      if (Math.min(a[0], b[0], c[0]) > -20) continue;   // only the industrial zone (x < -20) matters here
      tris.push({ t: [a, b, c], mesh: m.name || m.parent?.name || '?', minx: Math.min(a[0], b[0], c[0]), maxx: Math.max(a[0], b[0], c[0]), minz: Math.min(a[1], b[1], c[1]), maxz: Math.max(a[1], b[1], c[1]) });
    }
  });
  const inTri = (x, z, t) => { const d = (px, pz, a, b) => (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (pz - b[1]); const d1 = d(x, z, t[0], t[1]), d2 = d(x, z, t[1], t[2]), d3 = d(x, z, t[2], t[0]); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  const segD = (x, z, a, b) => { const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2)) : 0; return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t); };
  window.__roadDist = (x, z) => { // 0 inside the carriageway, else the distance to the nearest road edge; also names the nearest mesh group
    let best = Infinity, who = null;
    for (const T of tris) {
      if (x < T.minx - 6 || x > T.maxx + 6 || z < T.minz - 6 || z > T.maxz + 6) continue;
      let d; if (inTri(x, z, T.t)) d = 0; else d = Math.min(segD(x, z, T.t[0], T.t[1]), segD(x, z, T.t[1], T.t[2]), segD(x, z, T.t[2], T.t[0]));
      if (d < best) { best = d; who = T.mesh; if (d === 0) break; }
    }
    return { d: best, who };
  };
  // area (m2) of an oriented box (w x l, yaw = rotation.y of the body) lying on a road triangle, 5 cm raster
  window.__bodyOnRoad = (x, z, yaw, w, l) => {
    const c = Math.cos(yaw), s = Math.sin(yaw); let on = 0, all = 0;
    for (let a = -w / 2 + 0.025; a < w / 2; a += 0.05) for (let b = -l / 2 + 0.025; b < l / 2; b += 0.05) {
      const px = x + c * a + s * b, pz = z - s * a + c * b; all++;
      if (window.__roadDist(px, pz).d === 0) on++;
    }
    return +(on / all * w * l).toFixed(3);
  };
  window.__blocked = (x, z) => {
    const saved = playerVelocity.clone(); playerVelocity.set(0, 0, 0);
    const entries = gatherPhysicsCircles().filter((e) => e.category !== 'vehicle' && !String(e.label || '').startsWith('vehicle'));
    const r = resolvePlayerCircleCollisions(x, z, entries); playerVelocity.copy(saved);
    return !!r.hit;
  };
});

// ------------------------------------------------------------------------------------------------ A. points vs roads
const A = await page.evaluate(() => {
  const Y = window.YardsV161, S = Y.spec(), P = (v) => ({ x: +v.x.toFixed(2), z: +v.z.toFixed(2) });
  const rows = [];
  for (const k of ['planks', 'concrete', 'metal']) {
    const zone = LOGISTICS_ZONES[k], src = cargoInfo(k).source, st = S[k];
    const pad = P(zone.pos), stop = P(src), padR = window.__roadDist(zone.pos.x, zone.pos.z), stopR = window.__roadDist(src.x, src.z);
    rows.push({ k, pad, padRoad: +padR.d.toFixed(2), padWho: padR.who, stop, stopRoad: +stopR.d.toFixed(2), stopWho: stopR.who, onRoad: window.__bodyOnRoad(src.x, src.z, st.yaw, 1.15, 2.11), yawOk: true, sameAsSpec: Math.hypot(src.x - st.stop.x, src.z - st.stop.z) < 0.01, visible: zone.group.visible, yard: !!Y.yardGroup(k)?.visible, entry: serviceAccessGraph().find((n) => n.id === st.entry)?.p ? P(serviceAccessGraph().find((n) => n.id === st.entry).p) : null, lead: st.leadIn.map(P) });
  }
  const drop = P(SAWMILL_DROPOFF_POS), dr = window.__roadDist(SAWMILL_DROPOFF_POS.x, SAWMILL_DROPOFF_POS.z);
  const mines = ['concrete', 'metal'].map((k) => { const m = scene.getObjectByName('manualMineV119_' + k); if (!m) return null; const r = window.__roadDist(m.position.x, m.position.z); return { k, ...P(m.position), road: +r.d.toFixed(2) }; }).filter(Boolean);
  return { rows, drop, dropRoad: +dr.d.toFixed(2), mines, plankBayConst: P(PLANK_TRUCK_BAY_POS_V161), enabled: Y.enabled };
});
console.log('TABLE (after)', J(A));
check(A.enabled, 'YardsV161 is enabled');
for (const r of A.rows) {
  check(r.padRoad >= 0.6, `${r.k}: the pickup pad (${r.pad.x}, ${r.pad.z}) is ${r.padRoad} m from the nearest road mesh (${r.padWho}) -- outside the carriageway, no longer on the lane`);
  check(r.stopRoad >= 0.57 && r.onRoad <= 0.005, `${r.k}: the truck bay (${r.stop.x}, ${r.stop.z}) is ${r.stopRoad} m from the carriageway, the parked body (1.15 x 2.11) lies ${r.onRoad} m2 on road meshes`);
  check(r.sameAsSpec, `${r.k}: cargoInfo source == the yard's bay`);
  check(r.yard, `${r.k}: its yard is built and visible (the building stands)`);
  check(r.entry && Math.hypot(r.lead[0].x - r.entry.x, r.lead[0].z - r.entry.z) < 2.2, `${r.k}: the lead-in starts within 2.2 m of the lane node ${J(r.entry)}: ${J(r.lead[0])}`);
}
check(A.dropRoad >= 1.5, `the log drop-off (${A.drop.x}, ${A.drop.z}) is ${A.dropRoad} m from any road`);
check(Math.hypot(A.plankBayConst.x - A.rows[0].stop.x, A.plankBayConst.z - A.rows[0].stop.z) < 0.02, 'PLANK_TRUCK_BAY_POS_V161 is the plank yard bay');
for (const m of A.mines) check(m.road >= 1.5, `manual ${m.k} gathering pad (${m.x}, ${m.z}) is ${m.road} m from any road`);

// ------------------------------------------------------------------------------------------------ B. physics / meshes / flags
const B = await page.evaluate(() => {
  const Y = window.YardsV161, S = Y.spec(), out = { yards: {}, obstacles: [], blocked: [] };
  for (const k of ['planks', 'concrete', 'metal']) {
    const grp = Y.yardGroup(k); let meshes = 0; const bb = new THREE.Box3(); grp.traverse((m) => { if (m.isMesh) { meshes++; bb.expandByObject(m); } });
    out.yards[k] = { meshes, minY: +bb.min.y.toFixed(3), maxY: +bb.max.y.toFixed(2), x0: +bb.min.x.toFixed(2), x1: +bb.max.x.toFixed(2), z0: +bb.min.z.toFixed(2), z1: +bb.max.z.toFixed(2) };
    const pts = [['pad', k === 'planks' ? LOGISTICS_ZONES.planks.pos : LOGISTICS_ZONES[k].pos], ['bay', S[k].stop], ...S[k].leadIn.map((p, i) => ['lead' + i, p])];
    for (const [n, p] of pts) out.blocked.push({ k, n, hit: window.__blocked(p.x, p.z) });
  }
  out.obstacles = [...__TYCOON_V83_COLLISIONS__.registry.values()].filter((e) => String(e.label || '').startsWith('yard-')).map((e) => e.label);
  // flags: a yard exists only with its building
  const flags = {};
  const restore = { c: concretePlantBuiltV118, m: metalYardBuiltV118, s: sawmillBuiltV118 };
  concretePlantBuiltV118 = false; metalYardBuiltV118 = false; sawmillBuiltV118 = false; Y.sync();
  flags.hidden = ['planks', 'concrete', 'metal'].map((k) => Y.yardGroup(k).visible);
  concretePlantBuiltV118 = restore.c; metalYardBuiltV118 = restore.m; sawmillBuiltV118 = restore.s; Y.sync();
  flags.shown = ['planks', 'concrete', 'metal'].map((k) => Y.yardGroup(k).visible);
  out.flags = flags;
  return out;
});
for (const k of ['planks', 'concrete', 'metal']) {
  const y = B.yards[k];
  check(y.meshes <= 6 && y.meshes >= 3, `${k} yard: ${y.meshes} merged meshes (<= 6)`);
  check(y.minY >= -0.01 && y.minY <= 0.06, `${k} yard: min y ${y.minY} (on the ground, not floating or sunk)`);
}
check(B.blocked.every((b) => !b.hit), `pads, bays and every lead-in point are outside all colliders (${J(B.blocked.filter((b) => b.hit))})`);
check(B.obstacles.length === 12, `bollards / lamp / sign of the three yards are in the collision registry: ${B.obstacles.length} (want 12)`);
check(J(B.flags.hidden) === '[false,false,false]' && J(B.flags.shown) === '[true,true,true]', `a yard exists only with its building: hidden without ${J(B.flags.hidden)}, shown with ${J(B.flags.shown)}`);

// ------------------------------------------------------------------------------------------------ C. the stock on display is the real stock
const CAP = 24;
const shownNow = () => page.evaluate(() => ({ planks: YardsV161.snap().plankStack?.shown, outlet: plankStackV161?.shown, concrete: PlantsV161.snap('concrete')?.pile?.shown, metal: PlantsV161.snap('metal')?.pile?.shown, ranges: { y: YardsV161.snap().plankStack?.boards, c: PlantsV161.snap('concrete')?.pile?.range, m: PlantsV161.snap('metal')?.pile?.range } }));
for (const n of [0, 1, 5, CAP, 60]) {
  await page.evaluate((n) => { planks = n; concrete = n; metal = n; }, n);
  const want = Math.min(CAP, n);
  const ok = await waitForState(page, (w) => { const s = YardsV161.snap().plankStack, c = PlantsV161.snap('concrete')?.pile, m = PlantsV161.snap('metal')?.pile; return s && c && m && s.shown === w && c.shown === w && m.shown === w; }, want, { timeout: 25000 });
  const sh = await shownNow();
  check(ok && sh.planks === want && sh.concrete === want && sh.metal === want, `stock ${n}: plank yard stack ${sh.planks}, concrete pile ${sh.concrete}, metal pile ${sh.metal} boards/blocks/beams shown (want ${want}); the outlet stack ${sh.outlet}`);
  if (n === 0) check(await page.evaluate(() => !YardsV161.yardGroup('planks').getObjectByName('v161YardPlankStack').visible), 'stock 0: the plank yard shows an empty slab (no boards)');
}
await page.evaluate(() => { planks = 60; concrete = 60; metal = 60; });

// ------------------------------------------------------------------------------------------------ D. trucks reach and use the bay
const D = await page.evaluate(() => {
  const res = {};
  const Y = window.YardsV161, S = Y.spec();
  for (const k of ['planks', 'concrete', 'metal']) {
    const v = serviceVehicles.find((q) => q.userData?.role === 'delivery' && q.userData.fixedCargo === k && q.visible !== false);
    if (!v) { res[k] = { missing: true }; continue; }
    const ud = v.userData, st = S[k], source = cargoInfo(k).source.clone();
    const saved = { state: ud.state, path: ud.path, idx: ud.pathIndex, pos: v.position.clone(), yaw: v.rotation.y };
    ud.deliveryTicket = null; ud.assignedBuild = null; ud.cargo = k; ud.cargoSource = source; ud.currentSpeed = 0; ud.state = 'to_source';
    ud.path = buildRoadRoute(v.position, source); ud.pathIndex = 0;
    const pathLen = ud.path.length, last = ud.path[pathLen - 1], first = ud.path[0];
    // the route must contain the lead-in points in order and end on the bay
    const hasLead = st.leadIn.every((p) => ud.path.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.02));
    let steps = 0, loading = false, onRoadMax = 0, tokenDuring = null;
    ud.jobTarget = ud.home.clone();
    for (; steps < 9000; steps++) { moveWorkVehicle(v, 0.05); if (ud.state === 'loading') { loading = true; break; } }
    ud.waitTimer = 1e9;   // keep the truck standing in the bay while it is measured
    const stopDist = Math.hypot(v.position.x - st.stop.x, v.position.z - st.stop.z);
    // let the yaw settle (the loading pause: the truck stands), then measure
    for (let i = 0; i < 40; i++) moveWorkVehicle(v, 0.05);
    let dy = v.rotation.y - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const body = window.__bodyOnRoad(v.position.x, v.position.z, v.rotation.y, 1.15, 2.11);
    const netDist = window.__TYCOON_V65_TRAFFIC__.serviceNetworkDistance(v.position);
    // way out: loaded, route to a target on the lane network (the depot home), the first leg must be the lead-in reversed through the gate to the lane node
    ud.waitTimer = 0; ud.jobTarget = ud.home.clone(); ud.state = 'outbound'; ud.path = buildRoadRoute(v.position, ud.jobTarget); ud.pathIndex = 0;
    const outPath = ud.path.map((p) => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
    const entry = serviceAccessGraph().find((n) => n.id === st.entry).p;
    let reachedEntry = false, leftYard = false, outSteps = 0, maxRoadRun = 0;
    for (; outSteps < 9000; outSteps++) {
      moveWorkVehicle(v, 0.05);
      if (Math.hypot(v.position.x - entry.x, v.position.z - entry.z) < 0.35) { reachedEntry = true; break; }
    }
    leftYard = !Y.yardAt(v.position, 0);
    // restore: parked at home again, idle (the next truck must not queue behind this one: the game loop is not stepping while the test runs synchronously)
    v.position.copy(saved.pos); v.rotation.y = saved.yaw; ud.state = 'idle'; ud.path = saved.path; ud.pathIndex = saved.idx; ud.currentSpeed = 0; ud.waitTimer = 0;
    res[k] = { loading, steps, stopDist: +stopDist.toFixed(3), yawErrDeg: +(dy * 180 / Math.PI).toFixed(1), bodyOnRoad: body, netDist: +netDist.toFixed(2), hasLead, last: { x: +last.x.toFixed(2), z: +last.z.toFixed(2) }, first: { x: +first.x.toFixed(2), z: +first.z.toFixed(2) }, pathLen, reachedEntry, outSteps, leftYard, outHead: outPath.slice(0, 5) };
  }
  return res;
});
console.log('TRUCKS', J(D));
for (const k of ['planks', 'concrete', 'metal']) {
  const r = D[k];
  if (r.missing) { check(false, `${k}: a delivery truck exists`); continue; }
  check(r.loading && r.stopDist < 0.2, `${k}: the real truck reaches the bay and starts loading (${r.steps} steps of 0.05 s, ${r.stopDist} m from the bay point)`);
  check(Math.abs(r.yawErrDeg) < 35, `${k}: parked along the bay (yaw error ${r.yawErrDeg} deg)`);
  check(r.bodyOnRoad <= 0.01, `${k}: the parked body lies ${r.bodyOnRoad} m2 on the carriageway (the lay-by, not the lane)`);
  check(r.hasLead && r.last.x === +A.rows.find((a) => a.k === k).stop.x && r.last.z === +A.rows.find((a) => a.k === k).stop.z, `${k}: the route has the lead-in points and ends on the bay ${J(r.last)}`);
  check(r.reachedEntry && r.leftYard, `${k}: loaded truck leaves through the gate and reaches the lane node (${r.outSteps} steps)`);
}
check(D.planks.netDist > 2.2 && D.metal.netDist > 2.2, `plank / metal trucks wait ${D.planks.netDist} / ${D.metal.netDist} m off the service network (> 2.2 m: the single-lane depot token is free while they load); concrete ${D.concrete.netDist} m`);

// ------------------------------------------------------------------------------------------------ pictures (optional)
if (SHOTS) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => { planks = 12; concrete = 12; metal = 12; });
  await waitForState(page, () => { const s = YardsV161.snap().plankStack, c = PlantsV161.snap('concrete')?.pile, m = PlantsV161.snap('metal')?.pile; return s && c && m && s.shown === 12 && c.shown === 12 && m.shown === 12; }, null, { timeout: 25000 });
  const shots = await page.evaluate(() => {
    const Y = YardsV161, S = Y.spec(), cv = renderer.domElement, out = {};
    const saved = [];
    for (const k of ['planks', 'concrete', 'metal']) {
      const v = serviceVehicles.find((q) => q.userData?.role === 'delivery' && q.userData.fixedCargo === k && q.visible !== false); if (!v) continue;
      saved.push([v, v.position.clone(), v.rotation.y, v.userData.state]); v.position.copy(S[k].stop); v.rotation.y = S[k].yaw;
    }
    const shot = (tx, tz, dist, az, el, fov = 40) => { const cam = new THREE.PerspectiveCamera(fov, cv.width / cv.height, 0.3, 400); cam.position.set(tx + Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, tz + Math.cos(az) * Math.cos(el) * dist); cam.lookAt(tx, 0.3, tz); cam.updateMatrixWorld(true); renderer.render(scene, cam); return cv.toDataURL('image/jpeg', 0.88); };
    out.zone_top = shot(-43, -6.5, 36, 0, 1.5707);
    out.zone_iso = shot(-43, -5.5, 24, 0.5, 0.75);
    out.planks_top = shot(-50.6, -3.2, 9, 0, 1.5707); out.planks_iso = shot(-50.4, -3.2, 8.5, 0.9, 0.65);
    out.concrete_top = shot(-44.6, -5.8, 9, 0, 1.5707); out.concrete_iso = shot(-44.2, -5.4, 8.5, 0.5, 0.6); out.concrete_side = shot(-43.6, -8.5, 9, 3.14, 0.55);
    out.metal_top = shot(-35.0, -7.2, 10, 0, 1.5707); out.metal_iso = shot(-35.0, -6.6, 9, 0.7, 0.62); out.metal_side = shot(-34.0, -7.0, 8, 2.2, 0.5);
    for (const [v, p, y, st] of saved) { v.position.copy(p); v.rotation.y = y; }
    return out;
  });
  for (const [k, url] of Object.entries(shots)) fs.writeFileSync(path.join(SHOTS, `yards-${k}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('SHOTS written to', SHOTS);
}

// ------------------------------------------------------------------------------------------------ E. errors
check(g.errors.length === 0, `0 console errors (${J(g.errors.slice(0, 3))})`);
check(g.badResponses.length === 0, `0 4xx responses (${J(g.badResponses.slice(0, 3))})`);
await g.close();
