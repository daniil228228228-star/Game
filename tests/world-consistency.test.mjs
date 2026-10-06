// World consistency (CLAUDE.md "World consistency rules", 2026-10-05 (5)): the picture equals the game state, nothing exists without a reason, physics holds.
// ONE browser launch: a fresh game walked through the real flow (depot -> sawmill -> first house -> road -> second house -> concrete + metal, plus a stage jump),
// then a second page of the same browser with the OLD_SAVE fixture. Every scene fact is read from the real scene graph, nothing from the game's self-audit objects.
//   A. ROADS (HARD): every road mesh (service roads, stage roads, partial manual-road sections, driveways) belongs to a connected component that touches something real:
//        a building, the fleet yard, the sawmill (and its truck bay), a concrete / metal plant, an active pad (road pad, industrial pad, house pad) or the hub where the stage
//        roads start; no component floats free. A road END that touches no other road must lie inside such an anchor (no road to nowhere); the only documented exception is
//        DOCUMENTED_DEAD_ENDS below. Per state: nothing is paved for a building that does not stand yet (fresh + depot + sawmill: no link to the city, no north corridor, no
//        sawmill spur before the sawmill), and the full network of every old save is untouched (road mesh count + bbox hash of OLD_SAVE, and the service group of a finished
//        fresh game == the service group of OLD_SAVE, mesh for mesh).
//   B. STOCK (HARD): the plank stack on the pickup pad draws floor(planks) boards (cap 24) for 0/1/7.9/24/60; boards shown on the belt for ONE saw cut == the planks the game
//        credits for that cut, measured through the real animate loop for sawmill level 1/2/3 and prestige 0/3/6 (levels change the speed, not the yield).
//   C. TARGETS: every pad marker / compass / guidance target resolves to an existing scene object (HARD for pads and markers).
//   D. PHYSICS (KNOWN ISSUE lines, exit 0, unless resolved and listed in HARD_ALL: houses + sawmill + concrete plant + metal yard since 2026-10-05 (6), the factories stage 4 / 5 / 13 and the fleet yard (min y; boxes: buildings-physics B6) since 2026-10-06 (10); industrial pads hard): nothing floating (min y > +5 cm) or sunk (< -5 cm) among the buildings, colliders cover the real
//        footprint (rotated), no pad / pickup inside a collider.
// SHOTS_DIR=<dir> writes roads-after-fresh-sawmill-top.jpg (same camera as the "before" picture of the changelog) and sawmill-cut-boards.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, check, OLD_SAVE, SAVE_KEY } from './lib/harness.mjs';
import { installProbe } from '../tools/lib/buildings-probe-v161.mjs';

const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const J = JSON.stringify;
// service group of the old full network measured on commit 93573ed (OLD_SAVE, stage 1, every flag built): v70 + v113 + stage road meshes
const OLD_ROADS = { count: 51, hash: 648310607 };
const DOCUMENTED_DEAD_ENDS = []; // [{ id, why }] road ends that may touch nothing and no anchor; empty = none known

// ---------------------------------------------------------------------------------------------------------------- in-page helpers
const PAGE = () => {
  const W = (window.__WC = {});
  const r2 = (v) => +v.toFixed(2);
  const hashOf = (strs) => { let h = 5381; for (const s of strs.sort().join('|')) h = ((h << 5) + h + s.charCodeAt(0)) | 0; return h; };
  const bbStr = (o) => { const b = new THREE.Box3().setFromObject(o); return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => v.toFixed(2)).join(','); };
  const under = (o, roots) => { for (let p = o; p; p = p.parent) if (roots.includes(p)) return true; return false; };
  // same signature as tests/sawmill-area.test.mjs (road meshes of v70 + v113 + stage roads) and the service group alone
  W.sig = () => {
    scene.updateMatrixWorld(true);
    const all = [], svc = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      for (let p = o.parent; p; p = p.parent) {
        if (p.name === 'v70RefinedServiceRoads') { all.push(bbStr(o)); svc.push(bbStr(o)); break; }
        if (p.name === 'v113UnifiedStarterRoadSurface' || p === cityWorldRuntime?.stageRoads) { all.push(bbStr(o)); break; }
      }
    });
    return { count: all.length, hash: hashOf(all), svcCount: svc.length, svcHash: hashOf(svc) };
  };
  // ---- every road mesh with its footprint and ends
  W.roads = () => {
    scene.updateMatrixWorld(true);
    const roots = [];
    const addRoot = (name, o) => { if (o && o.isObject3D) roots.push({ name, o }); };
    addRoot('stage', cityWorldRuntime?.stageRoads); addRoot('service', cityWorldRuntime?.transportAccessRoads); addRoot('master', cityWorldRuntime?.masterRoads);
    if (typeof drivewayGroupV35 !== 'undefined') addRoot('driveway', drivewayGroupV35);
    if (typeof plotDrivewayGroupV352 !== 'undefined') addRoot('plotDriveway', plotDrivewayGroupV352);
    for (const c of scene.children) if (/^v122PartialRoad_/.test(c.name)) addRoot('partial', c);
    const seen = new Set(), pieces = [], v = new THREE.Vector3();
    for (const { name, o } of roots) o.traverse((m) => {
      if (!m.isMesh || seen.has(m)) return; seen.add(m);
      const u = m.userData || {}, mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (u.v95BoundaryEdge || u.v66ServiceEdge || u.v66ServiceCurb || u.v66LoadingStop) return;       // paint / curbs, not pavement
      if (!mat || mat.isMeshBasicMaterial || mat.transparent) return;                                    // paint, previews
      const c = mat.color; if (c && (c.r + c.g + c.b) / 3 > 0.55) return;                                // light = markings
      const b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3());
      if (s.y > 0.25 || Math.min(s.x, s.z) < 0.12 || b.max.y > 0.3) return;
      let ends = null;
      if (u.v66Endpoints) ends = u.v66Endpoints.map((p) => [r2(p.x), r2(p.z)]);
      else if (m.geometry?.parameters?.depth && m.geometry?.parameters?.width && m.geometry.type === 'BoxGeometry') {
        const d = m.geometry.parameters.depth / 2;
        ends = [-d, d].map((z) => { v.set(0, 0, z).applyMatrix4(m.matrixWorld); return [r2(v.x), r2(v.z)]; });
      } else if (u.v101CenterlinePoints?.length > 1) { const p = u.v101CenterlinePoints; ends = [p[0], p[p.length - 1]].map((q) => { v.set(q.x, 0, q.z).applyMatrix4(m.matrixWorld); return [r2(v.x), r2(v.z)]; }); }
      pieces.push({ root: name, hidden: m.visible === false, kind: Object.keys(u).filter((k) => u[k] === true).slice(0, 2).join('+') || m.geometry?.type, bb: [r2(b.min.x), r2(b.min.z), r2(b.max.x), r2(b.max.z)], ends, big: Math.max(s.x, s.z) });
    });
    // ---- anchors: the things a road is allowed to end at
    const anchors = [];
    const box = (kind, id, o, grow) => { if (!o || !o.isObject3D) return; const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return; anchors.push({ kind, id, bb: [r2(b.min.x - grow), r2(b.min.z - grow), r2(b.max.x + grow), r2(b.max.z + grow)] }); };
    const pt = (kind, id, p, grow) => { if (p && Number.isFinite(p.x)) anchors.push({ kind, id, bb: [r2(p.x - grow), r2(p.z - grow), r2(p.x + grow), r2(p.z + grow)] }); };
    for (const b of buildings) if (b.mesh) box('building', 'stage' + b.index, b.mesh, 3.4);
    box('fleet-yard', 'fleet', scene.getObjectByName('v116FleetYard') || scene.getObjectByName('v71FleetYard'), 1.2);
    if (sawmillBuiltV118 && sawmillMillV161) { box('sawmill', 'hall', sawmillMillV161, 5.6); pt('sawmill-bay', 'plankBay', PLANK_TRUCK_BAY_POS_V161, 2.8); }
    if (concretePlantBuiltV118 && typeof concretePlant !== 'undefined' && concretePlant?.group) box('concrete', 'plant', concretePlant.group, 4.5);
    if (metalYardBuiltV118 && typeof metalPlant !== 'undefined' && metalPlant?.group) box('metal', 'yard', metalPlant.group, 4.5);
    for (const [i, g] of roadPadMarkersV116) pt('road-pad', 'road' + i, g.position, 3.2);
    for (const [id, g] of industrialPadMarkersV118) pt('industrial-pad', id, g.position, 3.2);
    if (currentPad) pt('house-pad', 'stage' + currentPad.index, currentPad.pos, 3.2);
    if (stageIndex >= 1) pt('hub', 'hub', { x: 0, z: 0 }, 3.2);                                   // the root of the stage roads exists once a house does
    // ---- components (bbox contact within 0.12 m)
    const n = pieces.length, par = Array.from({ length: n }, (_, i) => i), find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    const touch = (a, b, e) => a.bb[0] <= b.bb[2] + e && b.bb[0] <= a.bb[2] + e && a.bb[1] <= b.bb[3] + e && b.bb[1] <= a.bb[3] + e;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (touch(pieces[i], pieces[j], 0.12)) par[find(i)] = find(j);
    const comps = new Map();
    pieces.forEach((p, i) => { const k = find(i); if (!comps.has(k)) comps.set(k, []); comps.get(k).push(i); });
    const inBox = (x, z, bb, e = 0) => x >= bb[0] - e && x <= bb[2] + e && z >= bb[1] - e && z <= bb[3] + e;
    const components = [...comps.values()].map((idx) => {
      const bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const i of idx) { const q = pieces[i].bb; bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[2]); bb[3] = Math.max(bb[3], q[3]); }
      const hit = anchors.filter((a) => touch({ bb }, a, 0)).map((a) => a.kind + ':' + a.id);
      // a component only counts as attached if one of ITS pieces touches the anchor (the merged bbox of a long L-shaped road would touch far-away things)
      const real = anchors.filter((a) => idx.some((i) => touch(pieces[i], a, 0))).map((a) => a.kind + ':' + a.id);
      return { n: idx.length, bb: bb.map(r2), anchors: real, hit: hit.length };
    });
    // ---- dead ends: a road END (deck end) that no other road piece covers and no anchor contains
    const deadEnds = [];
    pieces.forEach((p, i) => {
      if (!p.ends) return;
      for (const e of p.ends) {
        const covered = pieces.some((q, j) => j !== i && inBox(e[0], e[1], q.bb, 0.3));
        if (covered) continue;
        const anc = anchors.filter((a) => inBox(e[0], e[1], a.bb)).map((a) => a.kind + ':' + a.id);
        if (!anc.length) deadEnds.push({ at: e, root: p.root, kind: p.kind, bb: p.bb });
      }
    });
    W._pieces = pieces; W._anchors = anchors;
    const by = {}; for (const p of pieces) { const k = p.root + (p.hidden ? '(src)' : ''); by[k] = (by[k] || 0) + 1; }
    const sv = pieces.filter((p) => p.root === 'service');
    const ext = { svcMaxX: r2(Math.max(-1e9, ...sv.map((p) => p.bb[2]))), svcMinX: r2(Math.min(1e9, ...sv.map((p) => p.bb[0]))), svcMinZ: r2(Math.min(1e9, ...sv.map((p) => p.bb[1]))) };
    return { count: pieces.length, by, components, deadEnds, anchors: anchors.map((a) => a.kind + ':' + a.id), ...ext, svcCount: sv.length };
  };
  // ---- targets
  W.objectNear = (x, z, r = 3) => {
    let found = null;
    scene.traverse((o) => {
      if (found || !(o.isMesh || o.isSprite) || o === ground) return;
      for (let p = o; p; p = p.parent) if (p.visible === false) return;
      const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return;
      const s = b.getSize(new THREE.Vector3()); if (s.x > 40 || s.z > 40) return;
      if (x >= b.min.x - r && x <= b.max.x + r && z >= b.min.z - r && z <= b.max.z + r) found = o.name || o.type;
    });
    return found;
  };
  W.targets = () => {
    const out = [];
    const add = (id, p, hard) => { if (!p) { out.push({ id, none: true }); return; } out.push({ id, x: r2(p.x), z: r2(p.z), finite: Number.isFinite(p.x) && Number.isFinite(p.z), near: W.objectNear(p.x, p.z), hard }); };
    for (const [i, g] of roadPadMarkersV116) add('road-pad-' + i, g.position, true);
    for (const [id, g] of industrialPadMarkersV118) add('industrial-pad-' + id, g.position, true);
    if (currentPad) add('house-pad', currentPad.pos, true);
    try { const t = nextActionableTargetV117(); add('next-actionable:' + (t?.type || '-'), t?.pos, false); } catch (e) { out.push({ id: 'next-actionable', err: String(e) }); }
    try { const t = currentGuidanceTarget(); add('compass:' + (t?.type || '-'), t?.pos, false); } catch (e) { out.push({ id: 'compass', err: String(e) }); }
    for (const k of Object.keys(LOGISTICS_ZONES)) { const z = LOGISTICS_ZONES[k]; if (z.group?.visible) add('pickup-' + k, z.pos, true); }
    return out;
  };
  // ---- stock
  W.stack = () => {
    const z = LOGISTICS_ZONES.planks, m = z.group.getObjectByName('v161PlankStack'), g = m.geometry, per = 36, dr = g.drawRange, total = g.index ? g.index.count : g.attributes.position.count;
    return { shown: m.visible ? Math.min(dr.count, total) / per : 0, visible: m.visible, planks, boards: total / per };
  };
  // one saw cut through the real animate loop: boards visible on the belt at their peak == planks credited by the cut
  W.cut = (level, prestige) => new Promise((resolve) => {
    industrialLevelsV161.sawmill = level; refreshSawmillVisualsV161(); stats.prestige = prestige;
    sawmillAutoTimer = 0; logsInTransit.length = 0;
    const T0 = performance.now();
    const waitFrames = (n, fn) => { if (n <= 0) fn(); else requestAnimationFrame(() => waitFrames(n - 1, fn)); };
    waitFrames(6, () => {
      const lvl = sawmillMillV161.userData.levelV161, T = sawmillAutoInterval(), p0 = planks;
      sawmillAutoTimer = T * 0.9;
      let peak = 0, frames = 0;
      const tick = () => {
        frames++;
        const n = sawmillMillV161.userData.parts.boards.filter((b) => b.visible).length;
        if (planks === p0) peak = Math.max(peak, n);
        if (planks !== p0 || performance.now() - T0 > 60000) { resolve({ level, lvl, prestige, T: +T.toFixed(2), peak, credited: planks - p0, frames, perCycle: planksPerSawmillCycle(), shownN: sawmillMillV161.userData.anim.boardsN, timeout: planks === p0 }); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  // a truck route (the game's buildRoadRoute, the same function the fleet uses) must run on pavement: every vertex with x < xMax is within 1.0 m of a road deck axis, inside a road piece or inside the fleet yard
  W.route = (from, to, xMax) => {
    W.roads();
    const segs = W._pieces.filter((p) => p.ends), yard = W._anchors.filter((a) => a.kind === 'fleet-yard');
    const dseg = (px, pz, a, b) => { const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz, t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / l2)) : 0; return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t)); };
    const route = buildRoadRoute(new THREE.Vector3(from[0], 0, from[1]), new THREE.Vector3(to[0], 0, to[1]));
    const bad = [];
    for (const v of route) {
      if (v.x >= xMax) continue;
      const near = Math.min(1e9, ...segs.map((p) => dseg(v.x, v.z, p.ends[0], p.ends[1])));
      const inPiece = W._pieces.some((p) => v.x >= p.bb[0] - 0.4 && v.x <= p.bb[2] + 0.4 && v.z >= p.bb[1] - 0.4 && v.z <= p.bb[3] + 0.4);
      const inYard = yard.some((a) => v.x >= a.bb[0] && v.x <= a.bb[2] && v.z >= a.bb[1] && v.z <= a.bb[3]);
      if (!(near <= 1.0 || inPiece || inYard)) bad.push([r2(v.x), r2(v.z), r2(near)]);
    }
    return { n: route.length, checked: route.filter((v) => v.x < xMax).length, bad };
  };
  W.shot = (cx, cz, h) => { camera.position.set(cx, h, cz + 0.01); camera.lookAt(cx, 0, cz); camera.updateMatrixWorld(true); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/jpeg', 0.85); };
  W.shotMill = (camLocal, target) => {
    scene.updateMatrixWorld(true);
    const cp = sawmillMillV161.localToWorld(new THREE.Vector3(camLocal[0], camLocal[1], camLocal[2])), tp = sawmillMillV161.localToWorld(new THREE.Vector3(target[0], target[1], target[2]));
    camera.position.copy(cp); camera.lookAt(tp); camera.updateMatrixWorld(true); renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', 0.9);
  };
};
const save = (name, data) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data.split(',')[1], 'base64')); };

// ---------------------------------------------------------------------------------------------------------------- the checks shared by every state
const known = [];
const issue = (msg) => { known.push(msg); console.log('KNOWN ISSUE: ' + msg); };
const soft = (cond, msg) => { if (cond) console.log('ok: ' + msg); else issue(msg); };

function roadChecks(R, label, { expectNoLink = false } = {}) {
  const orphan = R.components.filter((c) => c.anchors.length === 0);
  check(orphan.length === 0, `${label}: every road piece belongs to a component that touches a building / yard / sawmill / plant / active pad / hub (${R.count} meshes ${J(R.by)}, ${R.components.length} components; orphans ${J(orphan.map((c) => c.bb))})`);
  const dead = R.deadEnds.filter((d) => !DOCUMENTED_DEAD_ENDS.some((x) => Math.hypot(x.at[0] - d.at[0], x.at[1] - d.at[1]) < 1));
  check(dead.length === 0, `${label}: no road end leads to nowhere (${dead.length} free ends outside every anchor ${J(dead.slice(0, 4).map((d) => [d.at, d.root, d.kind]))})`);
  if (expectNoLink) check(R.svcMaxX < -30, `${label}: no service road east of the cluster gate before the first house (max x ${R.svcMaxX}; the old network reached x 0.1)`);
}

// ================================================================================================================ launch
const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(PAGE);
await ev(installProbe);
const st = {};
const state = async (label, setup, wait = 4000) => { if (setup) await ev(setup); await page.waitForTimeout(wait); const R = await ev(() => __WC.roads()); st[label] = R; console.log(`--- state ${label}: road meshes ${R.count} ${J(R.by)} components ${R.components.length} dead ends ${R.deadEnds.length}`); return R; };

// ---- A. roads along the real flow
let R = await state('S0 fresh', null, 500);
check(R.count === 0, `S0 fresh game: no road mesh at all (${R.count})`);
await ev(() => { money = 1e9; planks = 500; buildIndustrialStepV118(industrialStepV118('depot')); });
R = await state('S1 depot', null);
roadChecks(R, 'S1 depot only', { expectNoLink: true });
check(R.svcMinX > -43 && R.svcMinZ > -2, `S1 depot only: nothing is paved toward the unbuilt sawmill, plants or city: service roads x ${R.svcMinX}..${R.svcMaxX}, z from ${R.svcMinZ} (the old network ran to x -48 / z -8 and east to 0.1)`);
const sigS1 = await ev(() => __WC.sig());
await ev(() => { buildIndustrialStepV118(industrialStepV118('sawmill')); });
R = await state('S2 depot + sawmill', null, 5000);
roadChecks(R, 'S2 depot + sawmill (the user screenshot)', { expectNoLink: true });
check(R.svcMinZ > -4.6 && R.svcMinX < -47, `S2 depot + sawmill: the sawmill spur is paved (x from ${R.svcMinX}) but the north corridor of the unbuilt plants is not (min z ${R.svcMinZ}, old network -8)`);
const sigS2 = await ev(() => __WC.sig());
check(sigS2.svcCount < 47 && sigS2.svcCount > sigS1.svcCount, `S2: ${sigS2.svcCount} service road meshes (old network: 47 at this state, hash -510574045): fewer than before, more than with the depot alone (${sigS1.svcCount})`);
console.log('S2 signature', J(sigS2));
if (SHOTS) save('roads-after-fresh-sawmill-top.jpg', await ev(() => __WC.shot(-25, 0, 110)));
const tS2 = await ev(() => __WC.targets());
const routeA = await ev(() => __WC.route([PLANK_TRUCK_BAY_POS_V161.x, PLANK_TRUCK_BAY_POS_V161.z], [-13.45 + INDUSTRIAL_ZONE_OFFSET_X, 6.62], 1e9));
check(routeA.checked >= 4 && routeA.bad.length === 0, `S2: the plank truck route plank bay -> fleet yard (${routeA.n} vertices) runs on the pruned roads (unpaved vertices ${J(routeA.bad)})`);
// first house arrives after the depot: the link to the city is paved once
await ev(() => { purchaseCurrentPad(); });
R = await state('S3 house 0 bought', null, 5000);
roadChecks(R, 'S3 first house bought (link to the city)');
check(R.svcMaxX > -5, `S3: the link to the city is paved once a house exists (service roads reach x ${R.svcMaxX})`);
await ev(() => { for (let i = 0; i < 40 && !manualRoadStagesV116.has(0); i++) { const p = globalThis.roadBuildPadPosV122(0); player.position.set(p.x, 0, p.z); buildManualRoadStageV116(0, p); } });
R = await state('S4 road of house 0', null, 4000);
roadChecks(R, 'S4 road of house 0');
await ev(() => { purchaseCurrentPad(); });
await page.waitForTimeout(2500);
await ev(() => { for (const b of buildings) for (let i = 0; i < 40 && !manualRoadStagesV116.has(b.index); i++) { const p = globalThis.roadBuildPadPosV122(b.index); player.position.set(p.x, 0, p.z); buildManualRoadStageV116(b.index, p); } });
R = await state('S5 two houses + roads', null, 4000);
roadChecks(R, 'S5 two houses with their roads');
const tS5 = await ev(() => __WC.targets());
const routeB = await ev(() => __WC.route([PLANK_TRUCK_BAY_POS_V161.x, PLANK_TRUCK_BAY_POS_V161.z], [buildings[0].mesh.position.x, buildings[0].mesh.position.z], -17.5));
check(routeB.checked >= 5 && routeB.bad.length === 0, `S5: the plank truck route plank bay -> house 0 is paved from the bay to the junction (${routeB.checked} of ${routeB.n} vertices checked, unpaved ${J(routeB.bad)})`);
const sigBefore = await ev(() => __WC.sig());
await ev(() => { buildIndustrialStepV118(industrialStepV118('concrete')); buildIndustrialStepV118(industrialStepV118('metal')); });
R = await state('S6 + concrete + metal', null, 5000);
roadChecks(R, 'S6 depot + sawmill + concrete + metal (full network)');
check(R.svcMinZ < -7.5, `S6: the north corridor exists once the plants stand (min z ${R.svcMinZ})`);
for (const [name, from, to] of [['concrete bay -> fleet yard', [-44.1, -7.2], [-7.75 + -32, 6.62]], ['metal bay -> fleet yard', [-39.3, -7.2], [-5.85 + -32, 6.62]], ['plank bay -> house 0', null, null]]) {
  const r = await ev(([f, t]) => __WC.route(f || [PLANK_TRUCK_BAY_POS_V161.x, PLANK_TRUCK_BAY_POS_V161.z], t || [buildings[0].mesh.position.x, buildings[0].mesh.position.z], f ? 1e9 : -17.5), [from, to]);
  check(r.checked >= 4 && r.bad.length === 0, `S6: truck route ${name} runs on pavement (${r.checked} of ${r.n} vertices checked, unpaved ${J(r.bad)})`);
}
const sigFull = await ev(() => __WC.sig());
// roads laid in advance for future stages: a stage jump without buildings must not pave anything
await ev(() => { stageIndex = 4; });
const R7 = await state('S7 stage jump to 4 (no building)', null, 4000);
check(R7.count === R.count, `a stage jump without buildings paves nothing in advance (${R.count} -> ${R7.count} road meshes)`);
await ev(() => { stageIndex = 2; });

// ---- B. stock: the plank stack and the boards of a saw cut
for (const n of [0, 1, 7.9, 24, 60]) {
  const s = await ev((n) => { planks = n; return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(__WC.stack())))); }, n);
  check(s.shown === Math.min(24, Math.floor(n)) && s.boards === 24, `pickup stack draws floor(planks) boards: planks ${n} -> ${s.shown} (cap 24)`);
}
const cuts = [];
await ev(() => { planks = 3; });
for (const [level, prestige] of [[1, 0], [2, 0], [3, 0], [1, 3], [2, 6], [3, 12]]) {
  const c = await ev(([l, p]) => __WC.cut(l, p), [level, prestige]);
  cuts.push(c);
  const expect = 1 + Math.floor(prestige / 3);
  const shownCap = Math.min(3, expect);
  console.log(`  cut level ${level} (mill ${c.lvl}) prestige ${prestige}: T ${c.T}s, peak boards on the belt ${c.peak}, planks credited ${c.credited}, perCycle() ${c.perCycle}, frames ${c.frames}${c.timeout ? ' TIMEOUT' : ''}`);
  check(!c.timeout && c.lvl === level && c.credited === expect && c.perCycle === expect, `sawmill level ${level}, prestige ${prestige}: one cut credits ${c.credited} plank(s) = the game's planksPerSawmillCycle() ${c.perCycle}`);
  if (expect <= 3) check(c.peak === c.credited, `sawmill level ${level}, prestige ${prestige}: the cut shows ${c.peak} board(s) on the belt == the ${c.credited} credited (real animate loop)`);
  else issue(`prestige ${prestige}: a cut credits ${c.credited} planks but the belt pool shows at most ${c.peak} boards (BOARDS_MAX 3, prestige >= 9)`);
}
await ev(() => { stats.prestige = 0; industrialLevelsV161.sawmill = 1; refreshSawmillVisualsV161(); sawmillAutoTimer = 0; });
if (SHOTS) {
  await ev(() => { planks = 7; sawmillAutoTimer = sawmillAutoInterval() * 0.78; });
  await page.waitForTimeout(600);
  // roof hidden for the picture only (the belt is under it); one board per cut at prestige 0, three at prestige 6
  for (const [name, prestige] of [['sawmill-cut-boards-prestige0.jpg', 0], ['sawmill-cut-boards-prestige6.jpg', 6]]) {
    save(name, await ev((pr) => {
      stats.prestige = pr; sawmillAutoTimer = 0; const mill = sawmillMillV161; mill.userData.anim.boardsN = 0; sawmillApplyPoseV161(mill, 0.01);
      mill.userData.parts.roof.visible = false;
      const p = 0.82; sawmillAutoTimer = sawmillAutoInterval() * p; sawmillApplyPoseV161(mill, p);
      const out = __WC.shotMill([2.6, 4.6, 5.6], [-0.5, 0.5, 1.3]);
      mill.userData.parts.roof.visible = true; stats.prestige = 0; sawmillAutoTimer = 0;
      return out;
    }, prestige));
  }
}

// ---- C. every pad / marker / target resolves to a real object
for (const [label, T] of [['S2', tS2], ['S5', tS5]]) {
  const hard = T.filter((t) => t.hard && !t.none);
  const miss = hard.filter((t) => !t.finite || !t.near);
  check(miss.length === 0, `${label}: every pad marker / pickup resolves to a drawn object (${hard.length} checked: ${hard.map((t) => t.id).join(', ')}; missing ${J(miss)})`);
  for (const t of T.filter((x) => !x.hard)) soft(!t.err && (t.none || (t.finite && t.near)), `${label}: ${t.id} ${t.none ? 'is null' : t.err ? 'threw ' + t.err : `at ${t.x},${t.z} resolves to ${t.near}`}`);
}

// ---- D. physics: floating / sunk, colliders, pads inside colliders (live world, S6)
await ev(() => __BLD_PROBE__.finishGrowth());
await page.waitForTimeout(2500);
const phys = await ev(() => {
  const P = __BLD_PROBE__, out = { groups: [], points: [] };
  const targets = [['sawmill', () => P.liveByName('v161SawmillMill')], ['fleet-yard', () => P.liveByName('v116FleetYard')], ['concrete-plant', () => concretePlant?.group], ['metal-yard', () => metalPlant?.group]];
  for (const b of buildings) targets.push(['stage' + b.index, () => b.mesh]);
  for (const [id, get] of targets) {
    const root = get();
    if (!root || !root.isObject3D) { out.groups.push({ id, missing: true }); continue; }
    // the plants (2026-10-05 (6)) are measured with the colliders they OWN (their wall / machine boxes), not with every neighbour collider near them
    out.groups.push({ id, ...(['sawmill', 'concrete-plant', 'metal-yard', 'stage4', 'stage5', 'stage13', 'fleet-yard'].includes(id) ? P.measure(root, P.ownEntries(root), id === 'fleet-yard' ? { sweep: false } : {}) : P.measureLive(root)), thin: id === 'fleet-yard' }); // 2026-10-06 (10): the factories and the fleet yard own their colliders too (the yard's fence is a thin line: only min y is measured here, tests/buildings-physics.test.mjs B6 checks the boxes)
  }
  out.points = P.workPoints().map((p) => ({ ...p, b: P.blockedAt(p.x, p.z) }));
  return out;
});
// measured clean on 2026-10-05 (4)/(5): floating / sunk for every group, everything for the houses (the hard family of buildings-physics); 2026-10-05 (6): and for the sawmill,
// the concrete plant and the metal yard. The rest of the colliders are the backlog of docs/BUILDINGS_V161.md.
const HARD_ALL = ['stage0', 'stage1', 'sawmill', 'concrete-plant', 'metal-yard', 'stage4', 'stage5', 'stage13', 'fleet-yard']; // 2026-10-05 (6): the industrial plants moved from the backlog to the hard checks (rotated wall boxes, tests/buildings-physics.test.mjs B2)
for (const r of phys.groups) {
  if (r.missing) { issue(`${r.id}: not found in the scene`); continue; }
  const hardAll = HARD_ALL.includes(r.id);
  const rep = (ok, msg, hard = hardAll) => (hard ? check(ok, `${r.id}: ${msg}`) : soft(ok, `${r.id}: ${msg}`));
  rep(r.minY >= -0.05 && r.minY <= 0.05, `nothing floating or sunk, min y ${r.minY} (|y| <= 5 cm)`, true);
  if (r.thin) continue;
  if (r.footprintArea > 1 && r.overlap !== null) rep(r.overlap >= 0.9, `colliders cover >= 90 % of the real (rotated) footprint (${Math.round(r.overlap * 100)} %, ${r.uncovered} m2 uncovered)`);
  if (r.footprintArea > 1) rep(r.outsideMax <= 1.0, `no invisible wall wider than 1 m beyond the walls (${r.outsideMax} m)`);
  if (r.footprintArea > 1) rep(r.sweepReached === 0, `the player cannot walk into the building (${r.sweepReached} of 8 directions got in)`);
}
for (const p of phys.points) (p.family === 'industrial' ? check : soft)(!p.b.hit, `${p.id} @${p.x},${p.z} is outside every collider (${p.b.hit ? 'pushed ' + p.b.moved + ' m by ' + p.b.by.join(', ') : 'free'})`);

check(g.errors.length === 0 && g.badResponses.length === 0, `fresh launch: no console errors / 4xx ${J([...g.errors, ...g.badResponses].slice(0, 3))}`);

// ---- OLD_SAVE (second page of the same browser): the full network of an old save is untouched
await page.close();
const page2 = await g.context.newPage();
const errors2 = [];
page2.on('pageerror', (e) => errors2.push('pageerror: ' + e.message));
page2.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('navigator.vibrate')) errors2.push('console.error: ' + m.text()); });
await page2.addInitScript(({ key, value }) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }, { key: SAVE_KEY, value: OLD_SAVE });
await page2.goto(g.url, { waitUntil: 'load' });
await page2.waitForTimeout(6000);
await page2.evaluate(PAGE);
await page2.evaluate(installProbe);
const oldState = await page2.evaluate(() => ({ stage: stageIndex, depot: fleetDepotBuiltV118, saw: sawmillBuiltV118, conc: concretePlantBuiltV118, metal: metalYardBuiltV118 }));
check(oldState.stage === 1 && oldState.depot && oldState.saw && oldState.conc && oldState.metal, `OLD_SAVE loads at stage 1 with every staged flag built ${J(oldState)}`);
const sigOld = await page2.evaluate(() => __WC.sig());
check(sigOld.count === OLD_ROADS.count && sigOld.hash === OLD_ROADS.hash, `OLD_SAVE: road meshes unchanged by the pruning: ${sigOld.count} meshes, hash ${sigOld.hash} (before ${OLD_ROADS.count} / ${OLD_ROADS.hash})`);
check(sigFull.svcCount === sigOld.svcCount && sigFull.svcHash === sigOld.svcHash, `a finished fresh game paves exactly the old full service network: ${sigFull.svcCount} meshes, hash ${sigFull.svcHash} == OLD_SAVE ${sigOld.svcCount} / ${sigOld.svcHash}`);
const Ro = await page2.evaluate(() => __WC.roads());
console.log(`--- OLD_SAVE: road meshes ${Ro.count} ${J(Ro.by)} components ${Ro.components.length} dead ends ${Ro.deadEnds.length}`);
{
  const orphan = Ro.components.filter((c) => c.anchors.length === 0);
  check(orphan.length === 0, `OLD_SAVE: every road piece belongs to a component that touches something real (orphans ${J(orphan.map((c) => c.bb))})`);
  for (const d of Ro.deadEnds) issue(`OLD_SAVE (full network kept as is): road end at ${J(d.at)} (${d.root} ${d.kind}) touches no other road and no building / pad`);
  const T = await page2.evaluate(() => __WC.targets());
  const miss = T.filter((t) => t.hard && !t.none && (!t.finite || !t.near));
  check(miss.length === 0, `OLD_SAVE: every pad marker / pickup resolves to a drawn object (${T.filter((t) => t.hard && !t.none).length} checked; missing ${J(miss)})`);
}
check(errors2.length === 0, `OLD_SAVE page: no console errors ${J(errors2.slice(0, 3))}`);

console.log(`\n${known.length} KNOWN ISSUE lines (unresolved items of the world-consistency rules)`);
await g.close();
