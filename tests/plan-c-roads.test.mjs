// Masterplan C, step C1 "Каркас": the street skeleton of layout C.  node tests/plan-c-roads.test.mjs   (SHOTS_DIR=dir writes screenshots)
//   offline  : compile --check, every graph edge has asphalt under its centre line in the compiled data, no overlapping asphalt quads, roundabouts + islands, crossings painted,
//              walkable floor (land / sea / river / bridge)
//   launch 1 : fresh game (no save) = layout C: the layer builds cells around the spawn, real raycasts from above hit every edge of the graph (all cells built), roundabout rings,
//              draw-call delta of the whole layer <= 60 at 10 places (layer hidden vs shown, same camera), old road systems / ring / backdrop / legacy roadside are silent,
//              walk to the plan's far edges (clampPlayerBoundsV161 + updatePlayer), saved with layoutV161 = 'C' and still C after a reload, console clean
//   launch 2 : late save flagged C (stage 16, all districts): no mesh in any old road group
//   launch 3 : plan B regression: OLD_SAVE (no layoutV161) stays on layout B, no PlanCV161, road signature 51 / -720375465, ?layout=B keeps B on a fresh game
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { openGame, reloadGame, check, OLD_SAVE } from './lib/harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const J = JSON.stringify;

// ================================ offline ================================
const compile = spawnSync('node', ['tools/masterplan/compile-plan-c.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
check(compile.status === 0, `compile-plan-c --check: ${(compile.stdout + compile.stderr).trim().slice(0, 120)}`);
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/masterplan/plan-C.json'), 'utf8'));
const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/plan-c-data-v161.js'), 'utf8'), ctx);
const D = ctx.window.PlanCDataV161;
const CI = D.palette, NCELLS = Object.keys(D.cells).length;
check(Object.keys(D.cells).length > 100 && D.cell === 60, `data: ${Object.keys(D.cells).length} cells of ${D.cell} m`);
{
  // collect asphalt: rectangles of the union (palette asph, y 0.05) and triangles (ring, ramps) per cell
  const rects = [], tris = [];
  for (const [key, c] of Object.entries(D.cells)) {
    const q = c.r && c.r.q || [], t = c.r && c.r.t || [];
    for (let i = 0; i < q.length; i += 6) if (q[i + 5] === CI.asph || q[i + 5] === CI.median || q[i + 5] === CI.medLawn || q[i + 5] === CI.walk) rects.push({ x0: q[i], z0: q[i + 1], x1: q[i + 2], z1: q[i + 3], ci: q[i + 5], key });
    for (let i = 0; i < t.length; i += 8) if (t[i + 7] === CI.asph || t[i + 7] === CI.ramp) tris.push({ p: t.slice(i, i + 6), key });
  }
  const asphRects = rects.filter((r) => r.ci === CI.asph);
  const inTri = (x, z, p) => { const s = (ax, az, bx, bz) => (x - bx) * (az - bz) - (ax - bx) * (z - bz); const d1 = s(p[0], p[1], p[2], p[3]), d2 = s(p[2], p[3], p[4], p[5]), d3 = s(p[4], p[5], p[0], p[1]); return !((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6)); };
  const cellOf = (x, z) => Math.floor(x / 60) + ',' + Math.floor(z / 60);
  const byCell = new Map(); for (const r of rects.filter((q) => q.ci !== CI.walk)) { (byCell.get(r.key) || byCell.set(r.key, []).get(r.key)).push(r); }
  const triByCell = new Map(); for (const t of tris) { (triByCell.get(t.key) || triByCell.set(t.key, []).get(t.key)).push(t); }
  const asphaltAt = (x, z) => (byCell.get(cellOf(x, z)) || []).some((r) => x >= r.x0 - 1e-3 && x <= r.x1 + 1e-3 && z >= r.z0 - 1e-3 && z <= r.z1 + 1e-3) || (triByCell.get(cellOf(x, z)) || []).some((t) => inTri(x, z, t.p));
  // 1. every graph edge: asphalt under the centre line all along (the ring replaces the part inside a roundabout)
  const N = new Map(PLAN.nodes.map((n) => [n.id, n]));
  let samples = 0; const holes = [];
  for (const e of PLAN.edges) {
    const a = N.get(e.a), b = N.get(e.b), L = Math.hypot(b.x - a.x, b.z - a.z);
    const rA = (D.graph.rings.find((q) => q[0] === e.a) || [0, 0, 0, 0])[3], rB = (D.graph.rings.find((q) => q[0] === e.b) || [0, 0, 0, 0])[3];   // inside a roundabout the island is not road
    for (let s = 0.3; s < L; s += 1.1) { if (s < rA || s > L - rB) continue; if (e.cls === 'motorway' && D.surfaces(a.x + (b.x - a.x) * s / L, a.z + (b.z - a.z) * s / L).some((h) => h > 0.2)) continue; const x = a.x + (b.x - a.x) * s / L, z = a.z + (b.z - a.z) * s / L; samples++; if (!asphaltAt(x, z)) holes.push([e.id, R(x), R(z)]); }
  }
  check(holes.length === 0 && PLAN.edges.length === D.graph.edges.length, `data: asphalt under the centre line of all ${PLAN.edges.length} graph edges (${samples} samples, holes ${J(holes.slice(0, 6))})`);
  // 2. no overlapping asphalt rectangles (the union is decomposed)
  let overlaps = 0;
  for (const list of byCell.values()) { list.sort((p, q) => p.x0 - q.x0); for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].x0 < list[i].x1 - 1e-3; j++) { const ox = Math.min(list[i].x1, list[j].x1) - Math.max(list[i].x0, list[j].x0), oz = Math.min(list[i].z1, list[j].z1) - Math.max(list[i].z0, list[j].z0); if (ox > 0.01 && oz > 0.01) overlaps++; } }
  check(overlaps === 0, `data: no two asphalt rectangles overlap (${asphRects.length} rectangles, ${overlaps} overlaps)`);
  // 3. roundabouts: the ring is asphalt all around, the island is not
  const bad = [];
  for (const [id, x, z, Rr, Ri] of D.graph.rings) {
    for (let k = 0; k < 24; k++) { const an = k / 24 * Math.PI * 2 + 0.07, m = (Rr + Ri) / 2; if (!asphaltAt(x + Math.cos(an) * m, z + Math.sin(an) * m)) bad.push([id, 'ring', k]); }
    if (asphaltAt(x, z)) bad.push([id, 'island']);
  }
  check(D.graph.rings.length === PLAN.counts.roundabouts && bad.length === 0, `data: ${D.graph.rings.length} roundabouts, ring asphalt all round, island free (${J(bad.slice(0, 4))})`);
  // 4. crossings: white paint close to every zebra of the plan that has a setback / an axis
  const paint = []; for (const [key, c] of Object.entries(D.cells)) { const q = c.p && c.p.q || []; for (let i = 0; i < q.length; i += 6) if (q[i + 5] === CI.white) paint.push([(q[i] + q[i + 2]) / 2, (q[i + 1] + q[i + 3]) / 2]); }
  const J2 = new Map(PLAN.junctions.map((j) => [j.id, j]));
  let zebras = 0; const missing = [];
  for (const cr of PLAN.crossings) {
    let px, pz;
    if (cr.arm) { const j = J2.get(cr.id.split('-')[0]); const cross = j.arms.filter((a) => (a.dir[0] !== 0) !== (cr.arm[0] !== 0)).map((a) => PLAN.classes[a.cls].w / 2); const along = cr.setback != null ? cr.setback : (cross.length ? Math.max(...cross) : 0) + 2.2; px = j.at[0] + cr.arm[0] * along; pz = j.at[1] + cr.arm[1] * along; }
    else { px = cr.at[0]; pz = cr.at[1]; }
    zebras++;
    if (!paint.some((p) => Math.hypot(p[0] - px, p[1] - pz) < 2.4)) missing.push(cr.id);
  }
  check(missing.length === 0, `data: ${zebras} crossings of the plan all have white bars (${missing.length} missing ${J(missing.slice(0, 5))})`);
  // 5. floor
  check(D.access(0, 100) && D.access(150, -60) && D.access(-280, 0) && !D.floor(0, 230) && !D.floor(-210, -100) && D.floor(-210, 0) && D.floor(-210, -240) && !D.floor(400, 0), 'data: floor = land of the plan (land yes, sea / river no, bridge over the river yes, outside the map no)');
  // 6. vehicles on the real widths: car 1.4 x 2.14, truck 1.15 x 2.11, clearance >= 0.25 m
  {
    const CAR = { w: 1.4, l: 2.14 }, TRUCK = { w: 1.15, l: 2.11 }, CLR = 0.25, bad = [];
    for (const [cls, [w, sw, med, lanes]] of Object.entries(D.classes)) {
      if (cls === 'motorway') { /* lanes below */ }
      const lane = cls === 'ramp' ? w : (w - med) / 2 / lanes;
      // two cars in opposite lanes (centred): gap between them and to the kerb
      const toKerb = (lane - CAR.w) / 2, between = lane - CAR.w;
      if (toKerb < CLR - 1e-9 || between < 2 * CLR - 1e-9) bad.push(`${cls}: lane ${lane.toFixed(2)} -> kerb ${toKerb.toFixed(2)}, cars ${between.toFixed(2)}`);
    }
    check(bad.length === 0, `vehicles: in every street class two cars in opposite lanes keep >= 0.25 m to each other and to the kerb (${J(bad)}; lanes ${J(Object.fromEntries(Object.entries(D.classes).map(([k, v]) => [k, +(k === 'ramp' ? v[0] : (v[0] - v[2]) / 2 / v[3]).toFixed(2)])))})`);
    const swath = (rc, V) => { const outer = Math.hypot(rc + V.w / 2, V.l * 0.7), inner = Math.sqrt(Math.max(0, rc * rc - (V.l * 0.6) ** 2)) - V.w / 2; return outer - inner; };
    const rb = [];
    for (const [id, x, z, R, Ri] of D.graph.rings.concat(D.graph.minis)) {
      const lane = R - Ri, rc = (R + Ri) / 2, mini = D.graph.minis.some((m) => m[0] === id), central = !mini && R >= 14;
      const need = Math.max(swath(rc, TRUCK), swath(rc, CAR)) + 2 * CLR;
      if (lane < (central ? 5.0 : 2.6) - 1e-9 || Ri < 1.8 - 1e-9 || lane < need - 1e-9) rb.push([id, +lane.toFixed(2), +Ri.toFixed(2), +need.toFixed(2)]);
      // a car and a truck side by side in the two-lane ring, or entering from the adjacent arms: each lane alone must hold the vehicle with clearance
      if (central && lane / 2 < CAR.w + 2 * CLR - 1e-9) rb.push([id, 'two lanes too narrow', lane / 2]);
    }
    check(rb.length === 0, `roundabouts: circulatory lane >= 2.6 (central 2-lane ring >= 5.0), island r >= 1.8, swept path of a car / truck + 0.25 m both sides fits ${J(rb)} (${D.graph.rings.length} rings + ${D.graph.minis.length} minis)`);
    // ramps: radius >= 13 everywhere, no turn > 9 degrees per plan step (G1), ramp lane >= 2.8
    const rr = [];
    for (const [ic, kind, pts] of D.graph.ramps) for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1], ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]); if (ab < 0.05 || bc < 0.05) continue;
      const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2, R = ar < 1e-9 ? 1e9 : ab * bc * Math.hypot(a[0] - c[0], a[1] - c[1]) / (4 * ar);
      const turn = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])); const t = Math.min(turn, 2 * Math.PI - turn) * 57.3;
      if (R < 13 || t > 9) rr.push([ic, kind, +R.toFixed(1), +t.toFixed(1), b]);
    }
    check(rr.length === 0 && D.classes.ramp[0] >= 2.8, `ramps: radius >= 13 m and no kink > 9 deg per step on all ${D.graph.ramps.length} ramps, ramp lane ${D.classes.ramp[0]} m (${J(rr.slice(0, 3))})`);
  }
  // 7. every painted mark belongs to a complete group: zebra = >= 4 bars across the carriageway, stop line spans the lane, no lone short mark
  {
    const marks = [];
    for (const c of Object.values(D.cells)) { const q = c.p && c.p.q || []; for (let i = 0; i < q.length; i += 6) if (q[i + 5] === CI.white) marks.push({ x0: q[i], z0: q[i + 1], x1: q[i + 2], z1: q[i + 3] }); }
    const onBorder = (m) => [m.x0, m.x1].some((v) => Math.abs(v / 60 - Math.round(v / 60)) < 1e-6) || [m.z0, m.z1].some((v) => Math.abs(v / 60 - Math.round(v / 60)) < 1e-6);
    const dim = (m) => ({ lx: m.x1 - m.x0, lz: m.z1 - m.z0 });
    const bars = marks.filter((m) => { const d = dim(m); return Math.min(d.lx, d.lz) > 0.4 && Math.max(d.lx, d.lz) < 2.0; });
    const stops = marks.filter((m) => { const d = dim(m); return Math.min(d.lx, d.lz) >= 0.3 && Math.min(d.lx, d.lz) <= 0.45 && Math.max(d.lx, d.lz) >= 1.9; });
    const other = marks.filter((m) => !bars.includes(m) && !stops.includes(m));
    const orient = (m) => (m.x1 - m.x0) > (m.z1 - m.z0) ? 'h' : 'v';
    const seen = new Set(), lone = [];
    for (const b of bars) {
      if (seen.has(b)) continue;
      const grp = [b]; seen.add(b);
      for (let k = 0; k < grp.length; k++) for (const o of bars) if (!seen.has(o) && orient(o) === orient(grp[k]) && Math.abs(o.x0 - grp[k].x0) < 1.3 && Math.abs(o.z0 - grp[k].z0) < 1.3) { seen.add(o); grp.push(o); }
      if (grp.length < 4 && !grp.some(onBorder)) lone.push([+b.x0.toFixed(1), +b.z0.toFixed(1), grp.length]);
    }
    check(lone.length === 0 && bars.length > 400, `paint: all ${bars.length} zebra bars sit in groups of >= 4 (lone ${J(lone.slice(0, 4))})`);
    // a stop line must be at least one lane wide (>= 1.9) and have a zebra bar group within 4 m in front of it
    const orphan = stops.filter((s) => !bars.some((b) => Math.hypot((b.x0 + b.x1) / 2 - (s.x0 + s.x1) / 2, (b.z0 + b.z1) / 2 - (s.z0 + s.z1) / 2) < 5));
    check(orphan.length === 0, `paint: ${stops.length} stop lines all span >= 1.9 m and stand behind a zebra (${J(orphan.slice(0, 3))})`);
    const short = other.filter((m) => { if (onBorder(m)) return false; const d = dim(m); return Math.max(d.lx, d.lz) < 0.55; });
    check(short.length === 0, `paint: no isolated mark shorter than 0.55 m outside the dash / tooth patterns (${short.length}, ${J(short.slice(0, 3))})`);
  }
  // 8. height layer (offline): deck clearance, grades, smooth vertical curves, ramps meet their roads
  {
    const S = D.struct, top = (x, z) => Math.max(...D.surfaces(x, z));
    const decks = [[0, -240, 'M1 over Главный пр.'], [250, 0, 'M2 over Центральная магистраль'], [250, -240, 'M2 over M1 (cloverleaf)']].map(([x, z, n]) => [n, top(x, z)]);
    check(decks.every(([, h]) => h - 0.8 >= 4.5 - 1e-6), `heights: every motorway deck over a road leaves >= 4.5 m headroom (deck tops ${J(decks.map(([n, h]) => [n, +h.toFixed(2)]))}, slab 0.8)`);
    check(S.openings.every(([x, half, clear]) => clear >= 2.8) && S.openings.filter(([x, half, clear]) => clear >= 4.5).length >= 7, `heights: rail embankment ${S.railY} m high with ${S.openings.length} openings (${S.openings.filter((o) => o[2] >= 4.5).length} road openings with 4.5 m headroom, ${S.openings.filter((o) => o[2] < 4.5).length} station tunnels)`);
    const bad = [], LIM = (id) => /^M[12]$/.test(id) ? 0.0625 : /^FB/.test(id) ? 0.42 : 0.07;
    let steps = 0;
    for (const r of S.ribbons) {
      let prevSlope = null;
      for (let i = 1; i < r.p.length; i++) {
        const a = r.p[i - 1], b = r.p[i], ds = Math.hypot(b[0] - a[0], b[1] - a[1]); if (ds < 0.05) continue;
        const slope = (b[2] - a[2]) / ds; steps++;
        if (Math.abs(slope) > LIM(r.id) + 1e-3) bad.push([r.id, 'grade', +(slope * 100).toFixed(1), b]);
        if (prevSlope != null && !/^FB/.test(r.id) && Math.abs(slope - prevSlope) / ds > 0.03) bad.push([r.id, 'kink', +(Math.abs(slope - prevSlope) / ds).toFixed(3), b]);
        prevSlope = slope;
      }
    }
    check(bad.length === 0, `heights: ${S.ribbons.length} decks / ramps / footbridges, ${steps} steps: grade <= 6.25 % (motorways) / 7 % (ramps) / 42 % (stair ramps of footbridges), vertical curvature smooth (${J(bad.slice(0, 4))})`);
    // ramps meet their roads: start / end height equals the height of the road they attach to (+-0.25)
    const mism = [];
    for (const [ic, kind, pts] of D.graph.ramps) { for (const end of [pts[0], pts[pts.length - 1]]) { const hs = D.surfaces(end[0], end[1]).filter((h) => Math.abs(h - end[2]) < 0.6); if (!hs.length && end[2] > 0.3) mism.push([ic, kind, end]); } }
    check(mism.length === 0, `heights: every ramp end above 0.3 m lies on a deck / ramp surface of its road (${J(mism.slice(0, 3))})`);
  }
  check(D.graph.signals.length === PLAN.counts.signals && D.graph.stops.length === PLAN.counts.busStops, `data: ${D.graph.signals.length} signal junctions and ${D.graph.stops.length} bus stops from the plan`);
}
function R(n) { return Math.round(n * 10) / 10; }

const PAGE = () => {
  window.__sig = () => {
    const roads = [];
    scene.traverse((o) => { if (!o.isMesh) return; for (let p = o.parent; p; p = p.parent) { if (p.name === 'v70RefinedServiceRoads' || p.name === 'v113UnifiedStarterRoadSurface' || p === cityWorldRuntime?.stageRoads) { roads.push(o); break; } } });
    scene.updateMatrixWorld(true);
    const strs = roads.map((o) => { const b = new THREE.Box3().setFromObject(o); return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => v.toFixed(2)).join(','); }).sort();
    let h = 5381; for (const s of strs.join('|')) h = ((h << 5) + h + s.charCodeAt(0)) | 0;
    return { count: roads.length, hash: h };
  };
  // meshes in the old road groups (any depth): must be 0 in layout C
  window.__oldRoadMeshes = () => {
    const names = ['v86CanonicalStageRoads', 'v70RefinedServiceRoads', 'v113UnifiedStarterRoadSurface', 'v113StableMasterRoads', 'v59OuterRoad', 'v35Driveways', 'v352PlotDriveways', 'v161Roundabout'];
    const out = {};
    scene.traverse((o) => { if (!names.includes(o.name) && !o.userData?.v59Network && !o.userData?.v59District) return; let m = 0; o.traverse((x) => { if (x.isMesh) m++; }); const k = o.name || (o.userData.v59District ? 'v59District' : 'v59Network'); out[k] = (out[k] || 0) + m; });
    return out;
  };
  window.__visibleLegacy = () => { let n = 0, back = 0; scene.traverse((o) => { if (o.userData?.v37LegacyRoadside && o.visible) { let v = true; for (let p = o; p; p = p.parent) if (p.visible === false) v = false; if (v) n++; } if (o.userData?.v161Backdrop && o.visible) back++; }); return { legacy: n, backdrop: back, rings: ['plotRing', 'outerRingRoad', 'shoreRing', 'waterRing', 'innerPlaza'].filter((k) => { try { return eval(k).parent === scene; } catch (_) { return false; } }) }; };
  window.__calls = () => {
    const root = PlanCV161.root, keep = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    root.visible = true; renderer.render(scene, camera); const withC = renderer.info.render.calls, trisWith = renderer.info.render.triangles;
    root.visible = false; renderer.render(scene, camera); const without = renderer.info.render.calls, trisWithout = renderer.info.render.triangles;
    root.visible = true; renderer.shadowMap.autoUpdate = keep;
    return { delta: withC - without, withC, without, tris: trisWith - trisWithout };
  };
  window.__drive = (sx, sz, dx, dz, steps) => {
    player.position.set(sx, 0, sz); playerVelocity.set(0, 0, 0); if (window.PlanCV161) PlanCV161.level = 0;
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const ys = [];
    for (let i = 0; i < steps; i++) {
      camera.getWorldDirection(camForward); camForward.y = 0; camForward.normalize(); camRight.crossVectors(camForward, worldUp).normalize();
      joyVec.z = dx * camForward.x + dz * camForward.z; joyVec.x = dx * camRight.x + dz * camRight.z;
      updatePlayer(1 / 30); if (i % 20 === 0) ys.push(+player.position.y.toFixed(2));
    }
    joyVec.x = joyVec.z = 0; playerVelocity.set(0, 0, 0);
    return { x: +player.position.x.toFixed(2), z: +player.position.z.toFixed(2), y: +player.position.y.toFixed(2), ys };
  };
};

const shot = async (page, name, x, z, d, el, az) => {
  if (!SHOTS) return;
  await page.evaluate(({ x, z }) => { PlanCV161.R_BUILD = 400; PlanCV161.R_KEEP = 900; PlanCV161.ensureNear(x, z); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }, { x, z });
  const url = await page.evaluate(({ x, z, d, el, az }) => {
    const fog0 = scene.fog; scene.fog = null;
    const cv = renderer.domElement, cam = new THREE.PerspectiveCamera(50, cv.width / cv.height, 0.3, 900), E = el * Math.PI / 180, A = az * Math.PI / 180;
    cam.position.set(x + Math.sin(A) * Math.cos(E) * d, Math.sin(E) * d, z + Math.cos(A) * Math.cos(E) * d); cam.up.set(0, 1, 0); cam.lookAt(x, 0, z); cam.updateMatrixWorld(true);
    renderer.render(scene, cam); const u = cv.toDataURL('image/jpeg', 0.88); scene.fog = fog0; PlanCV161.R_BUILD = 128; PlanCV161.R_KEEP = 190; return u;
  }, { x, z, d, el, az });
  fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
};

async function run(fn) { try { await fn(); } catch (e) { console.error('FAIL: launch crashed: ' + (e && e.stack || e)); process.exitCode = 1; } }

// ================================ launch 1: fresh game = layout C ================================
await run(async () => {
  const g = await openGame({ save: 'clear', layout: null, waitMs: 6000 });   // the game decides: no save -> C
  const { page } = g, ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    check(await ev(() => window.LAYOUT_V161 === 'C' && !!window.PlanCV161 && !window.MasterplanV161 && !window.RoundaboutV161), 'fresh game (no save) = layout C: PlanCV161 present, plan B layer and the hub roundabout layer silent');
    const st = await ev(() => PlanCV161.stats());
    check(st.cells >= 4 && st.meshes === st.cells && st.furniture.lamp > 0 && st.furniture.sig > 0, `cells around the spawn built lazily: ${J(st)}`);
    const spawn = await ev(() => ({ x: player.position.x, z: player.position.z }));
    check(Math.hypot(spawn.x - 11, spawn.z + 11) < 1.5, `player starts on the circus beside the central ring (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)})`);
    // all cells + real raycasts onto every edge of the graph
    await ev(() => { PlanCV161.R_BUILD = 900; PlanCV161.R_KEEP = 1200; PlanCV161.ensureNear(0, 0); });
    const all = await ev(() => PlanCV161.stats());
    check(all.cells === NCELLS && all.meshes <= NCELLS, `whole plan builds: ${all.cells} cells, ${all.tris} triangles`);
    const ray = await ev(() => {
      const D = PlanCDataV161, rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), roots = PlanCV161.root.children.filter((o) => o.isMesh && !o.isInstancedMesh);
      scene.updateMatrixWorld(true);
      let n = 0; const holes = [];
      for (const e of D.graph.edges) {
        const [id, , , cls, x0, z0, x1, z1] = e, L = Math.hypot(x1 - x0, z1 - z0);
        for (let s = 0.5; s < L; s += 6) {
          if (D.graph.rings.some((q) => (q[0] === e[1] && s < q[3] + 1) || (q[0] === e[2] && L - s < q[3] + 1))) continue;   // inside a roundabout: island
          const x = x0 + (x1 - x0) * s / L, z = z0 + (z1 - z0) * s / L; n++;
          if (cls === 'motorway' && D.surfaces(x, z).some((h) => h > 0.2)) continue;   // on a causeway: the deck is the surface (checked by the height tests)
          rc.set(new THREE.Vector3(x, 1, z), down);
          const hit = rc.intersectObjects(roots, false)[0];
          // a drawn street: the highest surface under the centre line is asphalt height (or the median / ramp / paint just above it), never the grass 5 cm below
          if (!hit || hit.point.y < 0.045 || hit.point.y > 0.13) holes.push([id, +x.toFixed(1), +z.toFixed(1), hit ? +hit.point.y.toFixed(3) : null]);
        }
      }
      return { n, holes: holes.slice(0, 8), count: holes.length };
    });
    check(ray.count === 0, `raycast from above: every graph edge is drawn (${ray.n} rays on 221 edges, holes ${J(ray.holes)})`);
    const rings = await ev(() => {
      const D = PlanCDataV161, rc = new THREE.Raycaster(), roots = PlanCV161.root.children.filter((o) => o.isMesh && !o.isInstancedMesh), out = [];
      for (const [id, x, z, R, Ri] of D.graph.rings) {
        let ok = 0;
        for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283 + 0.2, m = (R + Ri) / 2; rc.set(new THREE.Vector3(x + Math.cos(a) * m, 5, z + Math.sin(a) * m), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObjects(roots, false)[0]; if (h && h.point.y > 0.045 && h.point.y < 0.07) ok++; }
        out.push(ok);
      }
      return out;
    });
    check(rings.length === 6 && rings.every((n) => n >= 11), `roundabouts: the ring of all 6 is drawn at asphalt height (${J(rings)})`);
    // draw-call budget: the whole layer, layer hidden vs shown with the same camera, at ten places (the game's own radius)
    await ev(() => { PlanCV161.R_BUILD = 128; PlanCV161.R_KEEP = 190; });
    const spots = [[11, -11], [0, 0], [0, -230], [250, -240], [250, 0], [250, 160], [-232, -160], [-40, -110], [120, 180], [-200, 190], [-100, -200]];
    const worst = { delta: 0 }; const rows = [];
    for (const [x, z] of spots) {
      const r = await ev(({ x, z }) => { player.position.set(x, 0, z); PlanCV161.ensureNear(x, z); for (const c of [...PlanCV161.cells.values()]) { /* settle */ } camera.position.set(x + 12, 16, z + 14); camera.lookAt(x, 0, z); camera.updateMatrixWorld(true); return __calls(); }, { x, z });
      rows.push(r.delta); if (r.delta > worst.delta) Object.assign(worst, r, { at: [x, z] });
    }
    check(worst.delta <= 60, `draw calls: the whole plan C layer costs <= 60 at ${spots.length} places (${J(rows)})`);
    // calls with everything built and the camera high over the centre (frustum culling does the rest)
    const wide = await ev(() => { PlanCV161.R_BUILD = 900; PlanCV161.R_KEEP = 1200; PlanCV161.ensureNear(0, 0); camera.position.set(0, 140, 60); camera.lookAt(0, 0, -20); camera.updateMatrixWorld(true); const r = __calls(); PlanCV161.R_BUILD = 128; PlanCV161.R_KEEP = 190; return r; });
    console.log('INFO: high camera over the centre with all cells built: +' + wide.delta + ' calls, +' + wide.tris + ' triangles (frustum culled)');
    // old systems are silent
    const old = await ev(() => ({ roads: __oldRoadMeshes(), vis: __visibleLegacy(), sig: __sig() }));
    check(Object.values(old.roads).every((n) => n === 0) && old.sig.count === 0, `layout C: old road groups are empty (${J(old.roads)}, stage/service/starter meshes ${old.sig.count})`);
    check(old.vis.legacy === 0 && old.vis.backdrop === 0 && old.vis.rings.length === 0, `layout C: no legacy roadside, no hills / skyline boxes, no island rings (${J(old.vis)})`);
    // the base ground and the shadow disc are replaced by the cells
    check(await ev(() => ground.visible === false && groundShadow.visible === false), 'the old 140 m ground and its shadow disc are off (cells carry the ground)');
    // walking: land outside the old ground is walkable, water is not
    const walk = await ev(() => {
      const out = {};
      out.land = clampPlayerBoundsV161(150, 100, 1.2);
      player.position.set(100, 0, 150);
      out.sea = clampPlayerBoundsV161(100, 230, 1.2);
      out.walkEast = __drive(60, -20, 1, 0, 300);
      out.walkSea = __drive(0, 150, 0, 1, 300);
      out.walkRiver = __drive(-170, 20, -1, 0, 300);
      out.walkBridge = __drive(-170, 0, -1, 0, 300);
      out.far = __drive(0, -300, 0, -1, 200);
      return out;
    });
    check(walk.land.x === 150 && walk.land.z === 100, `clamp: a point on the land outside the old ground stays (${J(walk.land)})`);
    check(walk.sea.z < 230, `clamp: the sea is not walkable (${J(walk.sea)})`);
    check(walk.walkEast.x > 100, `walk east past the old ground edge on the plan (x ${walk.walkEast.x})`);
    check(walk.walkSea.z < 211 && walk.walkSea.z > 195, `walk south stops at the water (z ${walk.walkSea.z})`);
    check(walk.walkRiver.x > -222 && walk.walkRiver.x < -190, `walk west stops at the river (x ${walk.walkRiver.x})`);
    check(walk.walkBridge.x < -230, `walk west along the Central magistral crosses the river on the bridge (x ${walk.walkBridge.x})`);
    // height layer in the game: walk up a causeway and over a footbridge, through underpasses, no walking through the embankment
    const hw = await ev(() => {
      const out = {};
      PlanCV161.ensureNear(-120, -240); out.m1 = __drive(-120, -240, 1, 0, 800);
      PlanCV161.ensureNear(123, 0); out.fb = __drive(123.6, -60, 0, 1, 700);
      out.under = [-232, -160, -80, 250].map((x) => { PlanCV161.ensureNear(x, -120); return __drive(x, -150, 0, 1, 260).z; });
      PlanCV161.ensureNear(-120, -120); out.blockedEmb = __drive(-120, -150, 0, 1, 260).z;
      PlanCV161.ensureNear(40, -240); out.parapet = __drive(40, -240, 0, -1, 120);   // on the M1 deck pushing north into the parapet
      out.parapetS = __drive(40, -240, 0, 1, 120);
      return out;
    });
    check(Math.max(...hw.m1.ys) >= 5.2 && hw.m1.x > 20, `walk east along M1 climbs to the deck over the avenue (max y ${Math.max(...hw.m1.ys)}, x ${hw.m1.x}) and steps are smooth (${J(hw.m1.ys.slice(0, 8))}...)`);
    check(Math.max(...hw.fb.ys) >= 5.0 && hw.fb.z > 80 && hw.fb.y < 0.2, `walk along footbridge FB3 across the Central magistral: up to ${Math.max(...hw.fb.ys)} m and back down (end z ${hw.fb.z}, y ${hw.fb.y})`);
    check(hw.under.every((z) => z > -118), `walk south through the 4 underpasses of the rail embankment (end z ${J(hw.under)})`);
    check(hw.blockedEmb < -124, `the embankment between the underpasses is solid (end z ${hw.blockedEmb})`);
    check(hw.parapet.z >= -246.6 && hw.parapet.z <= -233.4 && hw.parapet.y > 3 && hw.parapetS.z <= -233.4 && hw.parapetS.y > 3, `the player on the M1 deck is held by the parapets (z ${hw.parapet.z} / ${hw.parapetS.z}, y ${hw.parapet.y})`);
    const under = await ev(() => { player.position.set(0, 0, -215); PlanCV161.level = 0; PlanCV161.ensureNear(0, -240); const r = __drive(0, -215, 0, -1, 200); for (let i = 0; i < 40; i++) updatePlayer(1 / 30); return { z: r.z, y: player.position.y, lvl: PlanCV161.level, under: PlanCDataV161.overhead(0, -240, 0) }; });
    check(under.z < -250 && Math.abs(under.y) < 0.1 && under.under != null && under.under >= 4.5 - 0.01, `walk north on the avenue UNDER the M1 deck: stays on the street (z ${under.z}, y ${under.y}), headroom ${under.under}`);
    // pictures
    await shot(page, 'plan-c-01-circus', 11, -11, 28, 40, 30);
    await shot(page, 'plan-c-02-ring-top', 0, 0, 50, 90, 0);
    await shot(page, 'plan-c-03-ring-n7', -232, -160, 45, 60, 0);
    await shot(page, 'plan-c-04-diamond-I1', 0, -240, 90, 90, 0);
    await shot(page, 'plan-c-05-clover-I3', 250, -240, 140, 90, 0);
    await shot(page, 'plan-c-06-station', -40, -120, 110, 90, 0);
    await shot(page, 'plan-c-07-port', 140, 215, 120, 60, 0);
    await shot(page, 'plan-c-08-river-bridge', -210, 0, 60, 55, 20);
    await ev(() => { PlanCV161.R_BUILD = 900; PlanCV161.R_KEEP = 1200; });
    await shot(page, 'plan-c-00-whole-city', 0, -60, 1000, 90, 0);
    await ev(() => { PlanCV161.R_BUILD = 128; PlanCV161.R_KEEP = 190; });
    // save field and reload
    const saved = await ev(() => { save(); return JSON.parse(localStorage.getItem(SAVE_KEY)).layoutV161; });
    check(saved === 'C', `save writes layoutV161 = 'C' (${saved})`);
    const errs = await reloadGame(g, 6000);
    check(await ev(() => window.LAYOUT_V161 === 'C' && !!window.PlanCV161 && PlanCV161.stats().cells >= 4), 'reload of the C save stays on layout C');
    check(errs.length === 0, `no console errors on reload (${J(errs.slice(0, 2))})`);
    check(g.errors.length === 0, `no console errors in launch 1 (${J(g.errors.slice(0, 3))})`);
    check(g.badResponses.length === 0, 'no 4xx');
  } finally { await g.close(); }
});

// ================================ launch 2: late save flagged C ================================
await run(async () => {
  const LATE_C = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 500, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })), layoutV161: 'C', cityState: { reputation: 90, districts: { suburb: 3, industrial: 3, business: 3, waterfront: 3 } } };
  const g = await openGame({ save: LATE_C, layout: null, waitMs: 9000 });
  const { page } = g, ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    check(await ev(() => window.LAYOUT_V161 === 'C'), 'a save with layoutV161 = C is layout C');
    const old = await ev(() => ({ roads: __oldRoadMeshes(), sig: __sig(), vis: __visibleLegacy() }));
    check(Object.values(old.roads).every((n) => n === 0) && old.sig.count === 0, `late C save (stage 16, 4 districts at level 3): old road groups stay empty (${J(old.roads)}, ${old.sig.count})`);
    check(old.vis.legacy === 0 && old.vis.backdrop === 0, `late C save: no legacy roadside / backdrop (${J(old.vis)})`);
    const calls = await ev(() => { player.position.set(11, 0, -11); PlanCV161.ensureNear(11, -11); camera.position.set(23, 16, 3); camera.lookAt(11, 0, -11); camera.updateMatrixWorld(true); return __calls(); });
    check(calls.delta <= 60, `late C save: layer draw calls ${calls.delta} <= 60`);
    check(g.errors.length === 0, `no console errors (${J(g.errors.slice(0, 3))})`);
  } finally { await g.close(); }
});

// ================================ launch 3: plan B is untouched ================================
await run(async () => {
  const g = await openGame({ save: OLD_SAVE, layout: null, waitMs: 6000 });   // old save without layoutV161: the game decides -> B
  const { page } = g, ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    check(await ev(() => window.LAYOUT_V161 === 'B' && !window.PlanCV161 && !!window.MasterplanV161 && !!window.RoundaboutV161), 'OLD_SAVE (no layoutV161) = layout B: no PlanCV161, plan B + roundabout layers loaded');
    const sig = await ev(() => __sig());
    check(sig.count === 51 && sig.hash === -720375465, `OLD_SAVE road signature stays 51 / -720375465 (${sig.count}/${sig.hash})`);
    const vis = await ev(() => ({ ground: ground.visible, backdrop: (() => { let n = 0; scene.traverse((o) => { if (o.userData?.v161Backdrop && o.visible) n++; }); return n; })(), planC: scene.children.some((o) => o.userData?.planCV161) }));
    check(vis.ground === true && vis.backdrop > 0 && vis.planC === false, `layout B keeps its ground, hills and skyline and has no plan C object (${J(vis)})`);
    const save = await ev(() => { save(); return JSON.parse(localStorage.getItem(SAVE_KEY)).layoutV161; });
    check(save === 'B', `a B game saves layoutV161 = 'B' (${save})`);
    check(g.errors.length === 0, `no console errors (${J(g.errors.slice(0, 3))})`);
  } finally { await g.close(); }
  const g2 = await openGame({ save: 'clear', waitMs: 4000 });   // harness default layout B on a fresh game
  try {
    check(await g2.page.evaluate(() => window.LAYOUT_V161 === 'B' && !window.PlanCV161), '?layout=B on a fresh game keeps layout B (the pre-C tests rely on it)');
  } finally { await g2.close(); }
});
