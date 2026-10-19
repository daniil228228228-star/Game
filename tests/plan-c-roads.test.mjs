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
  const rects = [], tris = [], medTris = [];
  for (const [key, c] of Object.entries(D.cells)) {
    const q = c.r && c.r.q || [], t = c.r && c.r.t || [];
    for (let i = 0; i < q.length; i += 6) if (q[i + 5] === CI.asph || q[i + 5] === CI.median || q[i + 5] === CI.medLawn || q[i + 5] === CI.lawnG || q[i + 5] === CI.walk) rects.push({ x0: q[i], z0: q[i + 1], x1: q[i + 2], z1: q[i + 3], ci: q[i + 5], key });
    for (let i = 0; i < t.length; i += 8) if (t[i + 7] === CI.asph || t[i + 7] === CI.ramp) tris.push({ p: t.slice(i, i + 6), key }); else if (t[i + 7] === CI.lawnG) medTris.push({ p: t.slice(i, i + 6), key });   // M2 zone median (drawn between kerb walls): the centre line of a motorway
    // Check the ACTUAL drawn decks too, including their near-zero toes. A
    // height > 0.2 exemption hid gaps between the flat and elevated meshes.
    const v = c.d?.v || [];
    for (let i = 0; i < v.length; i += 10) if (v[i + 9] === CI.asph) tris.push({ p: [v[i], v[i + 2], v[i + 3], v[i + 5], v[i + 6], v[i + 8]], key });
  }
  const asphRects = rects.filter((r) => r.ci === CI.asph);
  const inTri = (x, z, p) => { const s = (ax, az, bx, bz) => (x - bx) * (az - bz) - (ax - bx) * (z - bz); const d1 = s(p[0], p[1], p[2], p[3]), d2 = s(p[2], p[3], p[4], p[5]), d3 = s(p[4], p[5], p[0], p[1]); return !((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6)); };
  const cellOf = (x, z) => Math.floor(x / 60) + ',' + Math.floor(z / 60);
  const byCell = new Map(); for (const r of rects.filter((q) => q.ci !== CI.walk)) { (byCell.get(r.key) || byCell.set(r.key, []).get(r.key)).push(r); }
  const triByCell = new Map(); for (const t of tris) { (triByCell.get(t.key) || triByCell.set(t.key, []).get(t.key)).push(t); }
  const medAt = (x, z) => medTris.some((t) => Math.abs((t.p[0] + t.p[2] + t.p[4]) / 3 - x) < 8 && inTri(x, z, t.p));
  const asphaltAt = (x, z) => (byCell.get(cellOf(x, z)) || []).some((r) => x >= r.x0 - 1e-3 && x <= r.x1 + 1e-3 && z >= r.z0 - 1e-3 && z <= r.z1 + 1e-3) || (triByCell.get(cellOf(x, z)) || []).some((t) => inTri(x, z, t.p));
  // 1. every graph edge: asphalt under the centre line all along (the ring replaces the part inside a roundabout)
  const N = new Map(PLAN.nodes.map((n) => [n.id, n]));
  let samples = 0; const holes = [];
  for (const e of PLAN.edges) {
    if (e.split) continue;   // I2: the straight axis of the split street is a lawn island; its carriageways are checked below
    const a = N.get(e.a), b = N.get(e.b), L = Math.hypot(b.x - a.x, b.z - a.z);
    const rA = (D.graph.rings.find((q) => q[0] === e.a) || [0, 0, 0, 0])[3], rB = (D.graph.rings.find((q) => q[0] === e.b) || [0, 0, 0, 0])[3];   // inside a roundabout the island is not road
    const bR = (id) => { const b = (D.graph.bends || []).find((q) => q[0] === id); return b ? b[3] : 0; }, bA = bR(e.a), bB = bR(e.b);   // a bend: the axis leaves the straight edge at the tangent point (the arc is checked in 1e)
    for (let s = 0.3; s < L; s += 1.1) { if (s < rA || s > L - rB || s < bA || s > L - bB) continue; const x = a.x + (b.x - a.x) * s / L, z = a.z + (b.z - a.z) * s / L; if (e.cls === 'motorway' && Math.abs(x - 250) < 0.01 && z > 66.9) continue;   /* M2's trumpet end: the centre line is the widening median island (21 m taper, drawn as lawn) */ samples++; if (!asphaltAt(x, z) && !(e.cls === 'motorway' && (medAt(x, z) || (Math.abs(x - 250) < 0.01 && Math.abs(Math.abs(z) - 18.5) < 1.2))))   /* the tip of M2's median nose has zero width */ holes.push([e.id, R(x), R(z)]); }
  }
  check(holes.length === 0 && PLAN.edges.length === D.graph.edges.length, `data: asphalt under the centre line of all ${PLAN.edges.length} graph edges (${samples} samples, holes ${J(holes.slice(0, 6))})`);
  // 1e. bends: every two-leg corner is a circular arc; asphalt under the arc centre line all along and none at the old square corner's outer tip
  {
    const bad = [], BN = D.graph.bends || [];
    for (const [id, bx, bz, Rd] of BN) {
      const pb = PLAN.bends.find((q) => q.node === id), [A, B] = pb.arms, O = [bx + (A.dir[0] + B.dir[0]) * Rd, bz + (A.dir[1] + B.dir[1]) * Rd];
      for (let k = 0; k <= 20; k++) {
        const t = k / 20 * Math.PI / 2, x = O[0] + Rd * (-B.dir[0] * Math.cos(t) - A.dir[0] * Math.sin(t)), z = O[1] + Rd * (-B.dir[1] * Math.cos(t) - A.dir[1] * Math.sin(t));
        if (!asphaltAt(x, z) && !asphaltAt(x + 0.05, z) && !asphaltAt(x - 0.05, z) && !asphaltAt(x, z + 0.05)) bad.push([id, R(x), R(z)]);
      }
      const cx = bx + (A.dir[0] + B.dir[0]) * 1.2, cz = bz + (A.dir[1] + B.dir[1]) * 1.2;   // the square corner's centre area is no longer paved
      if (asphaltAt(bx + A.dir[0] * 0.5 + B.dir[0] * 0.5, bz + A.dir[1] * 0.5 + B.dir[1] * 0.5) && Rd > 3) bad.push([id, 'square corner still paved', R(cx), R(cz)]);
    }
    check(BN.length === PLAN.bends.length && BN.length >= 10 && bad.length === 0, `data: ${BN.length} bends (two-leg corners) are arcs of R ${BN.map((q) => q[3]).join('/')}: asphalt under the whole arc, the square corner is gone (${J(bad.slice(0, 4))})`);
  }
  // 1b. I2 split street: the band of every island carries asphalt all round (sampled between the island kerb and the outer outline), the island itself has none
  {
    const bad = [];
    for (const isl of D.graph.islands) {
      const n = isl.poly.length;
      for (let i = 0; i < n; i += 2) { const p = isl.poly[i], q = isl.outer[i], mx = (p[0] * 0.55 + q[0] * 0.45), mz = (p[1] * 0.55 + q[1] * 0.45); if (!asphaltAt(mx, mz) && Math.abs(mx - 250) > 7) bad.push([isl.side, i, +mx.toFixed(1), +mz.toFixed(1)]); }
      const cx = isl.poly.reduce((a, p) => a + p[0], 0) / n, cz = isl.poly.reduce((a, p) => a + p[1], 0) / n;
      if (asphaltAt(cx, cz)) bad.push([isl.side, 'island']);
    }
    check(D.graph.islands.length === 2 && bad.length === 0, `data: I2 split street: 2 islands, asphalt band all round, islands free of asphalt (${J(bad.slice(0, 4))})`);
  }
  // 1c. I2: a continuous way through the crossing for EACH direction separately. Flood fill over the drawn asphalt (0.5 m cells); eastbound may not use the
  //     northern (westbound) branches of the islands, westbound not the southern ones, so a one-way branch used against its sign is not a route.
  {
    const walk = (x0, z0, x1, z1, forbid) => {
      const key = (i, j) => i + ',' + j, S = 0.5, seen = new Set(), q = [[Math.round(x0 / S), Math.round(z0 / S)]]; seen.add(key(...q[0]));
      const ok = (x, z) => asphaltAt(x, z) && !forbid.some((f) => x >= f[0] && x <= f[2] && z >= f[1] && z <= f[3]);
      if (!ok(x0, z0)) return false;
      const gi = Math.round(x1 / S), gj = Math.round(z1 / S);
      while (q.length) {
        const [i, j] = q.pop(); if (Math.abs(i - gi) <= 1 && Math.abs(j - gj) <= 1) return true;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj, k = key(a, b); if (seen.has(k) || a * S < 185 || a * S > 312 || Math.abs(b * S) > 40) continue; if (ok(a * S, b * S)) { seen.add(k); q.push([a, b]); } }
      }
      return false;
    };
    const north = [[200, -10.9, 262, -5.9], [262, -10.9, 292, -5.9]], south = [[200, 5.9, 262, 10.9], [262, 5.9, 292, 10.9]];
    // right-hand traffic: eastbound uses the southern lane of the stub streets, westbound the northern one
    const eb = walk(196, 2.3, 298, 2.3, [[208, -10.9, 239, -5.9], [261.2, -10.9, 290, -5.9]]), wb = walk(298, -2.3, 196, -2.3, [[208, 5.9, 239, 10.9], [261.2, 5.9, 290, 10.9]]);
    void north; void south;
    check(eb && wb, `data: I2 has a continuous asphalt way across the crossing eastbound (${eb}) and westbound (${wb}), each avoiding the opposite one-way branches`);
  }
  // 1d. width profile (2026-10-18 (13)): where a street changes class away from a junction the DRAWN carriageway width changes by <= 0.14 m per metre along the axis (1:15 on both sides together)
  {
    const prof = [], widthAt = (x, z, ax) => { let w = 0; for (const sg of [-1, 1]) { let k = 0; while (k < 12 && (ax === 'z' ? asphaltAt(x + sg * (k + 0.1), z) : asphaltAt(x, z + sg * (k + 0.1)))) k += 0.2; w += k; } return w; };
    for (const n of PLAN.nodes) {
      if (n.legs !== 2) continue;
      const es = PLAN.edges.filter((e) => (e.a === n.id || e.b === n.id) && !e.split); if (es.length !== 2 || es[0].dir !== es[1].dir || es[0].cls === es[1].cls) continue;
      const ax = es[0].dir, ws = []; let worst = 0;
      for (let t = -25; t <= 70; t += 1) { const x = ax === "z" ? n.x : n.x + t, z = ax === "z" ? n.z + t : n.z; ws.push(widthAt(x, z, ax)); }
      const med = ws.map((w, i) => [ws[Math.max(0, i - 1)], w, ws[Math.min(ws.length - 1, i + 1)]].sort((p, q) => p - q)[1]);   // median of 3: one sample can land on a triangle seam
      for (let i = 1; i < med.length; i++) worst = Math.max(worst, Math.abs(med[i] - med[i - 1]));
      prof.push([n.x, n.z, +worst.toFixed(2)]);
    }
    check(prof.every(([, , w]) => w <= 0.4), `data: lane-drop transitions: the drawn width never jumps more than 0.4 m per metre (${J(prof)}; 1:15 on both sides = 0.13 m per metre, cell rounding 0.2)`);
  }
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
    if (cr.arm) { const j = J2.get(cr.id.split('-')[0]); const cross = j.arms.filter((a) => (a.dir[0] !== 0) !== (cr.arm[0] !== 0)).map((a) => PLAN.classes[a.cls].w / 2); const along = cr.setback != null ? cr.setback : Math.max(cross.length ? Math.max(...cross) : 0, j.boxZ || 0) + 2.2; px = j.at[0] + cr.arm[0] * along; pz = j.at[1] + cr.arm[1] * along; }
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
    const decks = [[0, -240, 'M1 over Главный пр.'], [250, -240, 'M2 over M1 (cloverleaf)']].map(([x, z, n]) => [n, top(x, z)]);
    check(top(250, 0) < 0.2 && top(250, -60) < 0.2, `heights: M2 is at ground level at the I2 crossing (z 0: ${top(250, 0)}, z -60: ${top(250, -60)}), no deck above the street`);
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
        if (prevSlope != null && ds > 1.5 && !/^FB/.test(r.id) && Math.abs(slope - prevSlope) / ds > 0.03) bad.push([r.id, 'kink', +(Math.abs(slope - prevSlope) / ds).toFixed(3), b]);
        prevSlope = slope;
      }
    }
    check(bad.length === 0, `heights: ${S.ribbons.length} decks / ramps / footbridges, ${steps} steps: grade <= 6.25 % (motorways) / 7 % (ramps) / 42 % (stair ramps of footbridges), vertical curvature smooth (${J(bad.slice(0, 4))})`);
    // ramps meet their roads: start / end height equals the height of the road they attach to (+-0.25)
    const mism = [];
    for (const [ic, kind, pts] of D.graph.ramps) { for (const end of [pts[0], pts[pts.length - 1]]) { const hs = D.surfaces(end[0], end[1]).filter((h) => Math.abs(h - end[2]) < 0.6); if (!hs.length && end[2] > 0.3) mism.push([ic, kind, end]); } }
    check(mism.length === 0, `heights: every ramp end above 0.3 m lies on a deck / ramp surface of its road (${J(mism.slice(0, 3))})`);
  }
  // 8b. right-hand traffic (2026-10-19): every bus shelter stands on the RIGHT of the traffic it serves (x east, z south: right of heading h = (-hz, hx)); on the one-way branches of I2 the direction is the branch's own
  //     (north branch westbound, south branch eastbound), elsewhere the line's heading; the circulation of every ring is counter-clockwise (graph ring sign -1)
  {
    const bad = []; let n = 0;
    for (const c of Object.values(D.cells)) { const st = c.f && c.f.stop || []; for (let i = 0; i < st.length; i += 4) {
      const x = st[i], z = st[i + 1]; n++; let best = null;
      for (const l of PLAN.transit.lines) for (let q = 0; q + 1 < l.pts.length; q++) { const a = l.pts[q], b = l.pts[q + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), h = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], t = Math.max(0, Math.min(L, (x - a[0]) * h[0] + (z - a[1]) * h[1])), d = Math.hypot(x - a[0] - h[0] * t, z - a[1] - h[1] * t); if (!best || d < best.d) best = { d, h, p: [a[0] + h[0] * t, a[1] + h[1] * t] }; }
      let h = best.h; if (Math.abs(x - 250) < 70 && Math.abs(best.p[1]) < 0.1 && Math.abs(z) > 6) h = z > 0 ? [1, 0] : [-1, 0];   // I2 one-way branches
      const side = (x - best.p[0]) * -h[1] + (z - best.p[1]) * h[0];
      if (side <= 0) bad.push([x, z]);
    } }
    check(n >= 25 && bad.length === 0, `right-hand traffic: all ${n} bus shelters stand on the right of their traffic (${J(bad.slice(0, 4))})`);
    check(D.graph.rings.length >= 6 && D.graph.rings.every((q) => q[5] === -1) && D.graph.minis.every((q) => q[5] === -1), `right-hand traffic: ${D.graph.rings.length} rings + ${D.graph.minis.length} mini rings circulate counter-clockwise (sign -1)`);
  }
  // 9. furniture: no lamp / signal / sign pole / shelter / tree stands in a lane, on a roundabout ring or on a ramp; stops stand on the sidewalk with no lamp inside
  {
    const A = []; for (const c of Object.values(D.cells)) { const q = c.r && c.r.q || []; for (let i = 0; i < q.length; i += 6) if (q[i + 5] === CI.asph) A.push([q[i], q[i + 1], q[i + 2], q[i + 3]]); }
    const W = [], WT = []; for (const c of Object.values(D.cells)) {
      const q = c.r?.q || [], t = c.r?.t || [];
      for (let i = 0; i < q.length; i += 6) if (q[i + 5] === CI.walk) W.push(q.slice(i, i + 4));
      for (let i = 0; i < t.length; i += 8) if (t[i + 7] === CI.walk) WT.push(t.slice(i, i + 6));
    }
    const inWalkTriangle = (x, z, p) => {
      const d = []; for (let i = 0; i < 3; i++) { const a = i * 2, b = (i + 1) % 3 * 2; d.push((x - p[b]) * (p[a + 1] - p[b + 1]) - (p[a] - p[b]) * (z - p[b + 1])); }
      return !(d.some((v) => v < -1e-6) && d.some((v) => v > 1e-6));
    };
    const inR = (L, x, z, m) => L.some((r) => x > r[0] + m && x < r[2] - m && z > r[1] + m && z < r[3] - m);
    const ramps = D.struct.ribbons.filter((r) => /^I\d\./.test(r.id) || /^M[12]$/.test(r.id));
    const nearRamp = (x, z) => ramps.some((r) => r.p.some((q, i) => i && Math.hypot(x - q[0], z - q[1]) < r.w / 2 + 0.4 && q[2] < 6));
    const rings = D.graph.rings.concat(D.graph.minis);
    const bad = [], stops = [], lamps = [];
    for (const [key, c] of Object.entries(D.cells)) {
      const f = c.f || {};
      for (const [kind, stride] of [['lamp', 3], ['sig', 3], ['pole', 4], ['stop', 4], ['tree', 4]]) {
        const a = f[kind] || [];
        for (let i = 0; i < a.length; i += stride) {
          const x = a[i], z = a[i + 1];
          if (kind === 'pole' && rings.some((r) => Math.hypot(x - r[1], z - r[2]) < 0.1)) continue;   // the roundabout sign stands on its island
          const onRing = rings.some((r) => { const d = Math.hypot(x - r[1], z - r[2]); return d > r[4] + 0.05 && d < r[3] - 0.05; });
          if (inR(A, x, z, 0.15) || onRing || nearRamp(x, z)) bad.push([kind, +x.toFixed(1), +z.toFixed(1)]);
          if (kind === 'stop') stops.push([x, z]); if (kind === 'lamp') lamps.push([x, z]);
        }
      }
    }
    check(bad.length === 0, `furniture: none of ${stops.length} shelters, ${lamps.length} lamps, signals, signs and trees stands in a lane, on a ring or on a ramp (${J(bad.slice(0, 5))})`);
    // furniture 2 (2026-10-18): the same scan against the drawn TRIANGLE asphalt (ramps, island bands, kerb returns), against the sidewalk for trees and against white paint for everything
    {
      const T = [], WT2 = [], M = [];
      for (const c of Object.values(D.cells)) {
        const t = c.r && c.r.t || [];
        for (let i = 0; i < t.length; i += 8) { if (t[i + 7] === CI.asph || t[i + 7] === CI.ramp) T.push(t.slice(i, i + 6)); else if (t[i + 7] === CI.walk) WT2.push(t.slice(i, i + 6)); }
        const q = c.p && c.p.q || []; for (let i = 0; i < q.length; i += 6) if (q[i + 5] === CI.white) M.push([q[i], q[i + 1], q[i + 2], q[i + 3]]);
      }
      const inT = (L, x, z) => L.some((p) => x >= Math.min(p[0], p[2], p[4]) && x <= Math.max(p[0], p[2], p[4]) && z >= Math.min(p[1], p[3], p[5]) && z <= Math.max(p[1], p[3], p[5]) && inWalkTriangle(x, z, p));
      const bad2 = [];
      for (const [key, c] of Object.entries(D.cells)) {
        const f = c.f || {};
        for (const [kind, stride] of [['lamp', 3], ['sig', 3], ['pole', 4], ['tree', 4]]) {
          const a = f[kind] || [];
          for (let i = 0; i < a.length; i += stride) {
            const x = a[i], z = a[i + 1];
            if (kind === 'pole' && rings.some((r) => Math.hypot(x - r[1], z - r[2]) < 0.1)) continue;
            const why = inT(T, x, z) ? 'asphalt' : kind === 'tree' && (inT(WT2, x, z) || inR(W, x, z, 0.0)) ? 'sidewalk' : M.some((m) => x > m[0] - 0.15 && x < m[2] + 0.15 && z > m[1] - 0.15 && z < m[3] + 0.15) ? 'paint' : null;
            if (why && !(kind === 'tree' && rings.some((r) => Math.hypot(x - r[1], z - r[2]) < r[4]))) bad2.push([kind, why, +x.toFixed(1), +z.toFixed(1)]);
          }
        }
      }
      // zebra bars (0.4-0.55 thick, < 2 long) never lie on a ramp lane
      const dseg2 = (px, pz, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l)) : 0; return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t); };
      for (const m of M) { const lx = m[2] - m[0], lz = m[3] - m[1]; if (Math.min(lx, lz) < 0.4 || Math.max(lx, lz) >= 2.0) continue; const cx = (m[0] + m[2]) / 2, cz = (m[1] + m[3]) / 2; for (const [ic, kind, pts, h] of D.graph.ramps) for (let i = 1; i < pts.length; i++) if (dseg2(cx, cz, pts[i - 1], pts[i]) < 1.5 && !PLAN.interchanges.some((ic) => (ic.terminals || []).some((t) => Math.hypot(t[0] - cx, t[1] - cz) < 9))) { bad2.push(['zebra bar', 'on ramp ' + ic + '/' + kind, +cx.toFixed(1), +cz.toFixed(1)]); break; } }
      check(bad2.length === 0, `furniture 2: no lamp, signal, sign or tree stands on triangle asphalt, no tree on a sidewalk, nothing on zebra / stop-line paint (${bad2.length}: ${J(bad2.slice(0, 6))})`);
    }
    const off = stops.filter(([x, z]) => !W.some((r) => x > r[0] - 0.05 && x < r[2] + 0.05 && z > r[1] - 0.05 && z < r[3] + 0.05) && !WT.some((p) => inWalkTriangle(x, z, p)));
    const lampInStop = lamps.filter(([x, z]) => stops.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 2.0));
    check(off.length === 0 && lampInStop.length === 0, `bus stops: all ${stops.length} shelters stand on a sidewalk, no lamp within 2 m (off ${J(off.slice(0, 3))}, lamp ${lampInStop.length})`);
    // no vertical support (pier, column, wall) of a deck inside a carriageway
    const walls = [];
    for (const c of Object.values(D.cells)) { const sq = c.d && c.d.s || []; for (let i = 0; i < sq.length; i += 9) { const b = Math.min(sq[i + 4], sq[i + 6]), t = Math.max(sq[i + 5], sq[i + 7]); if (b > 1.0 || t < 0.3 || t - b < 1.2) continue; for (const fr of [0, 0.5, 1]) { const x = sq[i] + (sq[i + 2] - sq[i]) * fr, z = sq[i + 1] + (sq[i + 3] - sq[i + 1]) * fr; if (inR(A, x, z, 0.25) && !D.surfaces(x, z).some((h) => h > 0.5 && false)) walls.push([+x.toFixed(1), +z.toFixed(1)]); } } }
    check(walls.length === 0, `decks: no pier / column / wall stands on the asphalt of a lane (${walls.length} ${J(walls.slice(0, 4))})`);
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
    check(st.cells >= 4 && st.meshes >= st.cells && st.meshes <= 2 * st.cells + 2 && st.furniture.lamp > 0 && st.furniture.sig > 0, `cells around the spawn built lazily: ${J(st)}`);
    const spawn = await ev(() => ({ x: player.position.x, z: player.position.z }));
    check(Math.hypot(spawn.x - 11, spawn.z + 11) < 1.5, `player starts on the circus beside the central ring (${spawn.x.toFixed(1)}, ${spawn.z.toFixed(1)})`);
    // all cells + real raycasts onto every edge of the graph
    await ev(() => { PlanCV161.R_BUILD = 900; PlanCV161.R_KEEP = 1200; PlanCV161.ensureNear(0, 0); });
    const all = await ev(() => PlanCV161.stats());
    check(all.cells === NCELLS && all.meshes >= NCELLS, `whole plan builds: ${all.cells} cells, ${all.tris} triangles`);
    const ray = await ev(() => {
      const D = PlanCDataV161, rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), roots = PlanCV161.root.children.filter((o) => o.isMesh && !o.isInstancedMesh);
      scene.updateMatrixWorld(true);
      let n = 0; const holes = [];
      for (const e of D.graph.edges) {
        const [id, , , cls, x0, z0, x1, z1] = e, L = Math.hypot(x1 - x0, z1 - z0);
        for (let s = 0.5; s < L; s += 6) {
          if (D.graph.rings.some((q) => (q[0] === e[1] && s < q[3] + 1) || (q[0] === e[2] && L - s < q[3] + 1))) continue;
          if ((D.graph.bends || []).some((q) => (q[0] === e[1] && s < q[3] + 1) || (q[0] === e[2] && L - s < q[3] + 1))) continue;   // bend: the arc replaces the corner   // inside a roundabout: island
          const x = x0 + (x1 - x0) * s / L, z = z0 + (z1 - z0) * s / L; n++;
          if (cls === 'motorway' && D.surfaces(x, z).some((h) => h > 0.08)) continue;
          if (cls === 'motorway' && Math.abs(x - 250) < 0.01 && Math.abs(Math.abs(z) - 18.5) < 1.2) continue;   // the tip of M2's median nose: zero width   // on a causeway: the deck is the surface (checked by the height tests)
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
    // every footbridge with the real controls (joystick vector through updatePlayer) from 8 approach directions: up, across, down, no stall > 0.5 s
    const fbs = await ev(() => PlanCDataV161.struct.ribbons.filter((r) => /^FB/.test(r.id)).map((r) => ({ id: r.id, p: r.p })));
    const fbRes = [];
    for (const fb of fbs) {
      const r = await page.evaluate(({ fb }) => {
        const out = { id: fb.id, runs: [] }, A = fb.p[0], B = fb.p[fb.p.length - 1], top = Math.max(...fb.p.map((q) => q[2]));
        const step = (tx, tz, rec) => {   // one joystick frame towards (tx, tz); the stall counter measures real movement
          const dx = tx - player.position.x, dz = tz - player.position.z, l = Math.hypot(dx, dz) || 1;
          camera.getWorldDirection(camForward); camForward.y = 0; camForward.normalize(); camRight.crossVectors(camForward, worldUp).normalize();
          joyVec.z = dx / l * camForward.x + dz / l * camForward.z; joyVec.x = dx / l * camRight.x + dz / l * camRight.z;
          const px = player.position.x, pz = player.position.z; updatePlayer(1 / 30);
          const moved = Math.hypot(player.position.x - px, player.position.z - pz);
          rec.still = moved < 0.02 ? rec.still + 1 : 0; rec.maxStill = Math.max(rec.maxStill, rec.still); rec.maxY = Math.max(rec.maxY, player.position.y);
        };
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, S = [A[0] + Math.cos(a) * 5, A[1] + Math.sin(a) * 5];
          if (fb.p.some((q) => q[2] > 0.8 && Math.hypot(q[0] - S[0], q[1] - S[1]) < 1.8)) continue;   // that side is under the ramp itself
          PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(S[0], S[1]);
          if (!PlanCDataV161.access(S[0], S[1])) continue;
          player.position.set(S[0], 0, S[1]); playerVelocity.set(0, 0, 0); PlanCV161.level = 0;
          const rec = { still: 0, maxStill: 0, maxY: 0 };
          for (let i = 0; i < 220 && Math.hypot(player.position.x - A[0], player.position.z - A[1]) > 0.9; i++) step(A[0], A[1], rec);
          rec.still = 0;
          for (let w = 1; w < fb.p.length; w++) { const q = fb.p[w]; for (let i = 0; i < 120 && Math.hypot(player.position.x - q[0], player.position.z - q[1]) > 0.8; i++) step(q[0], q[1], rec); }
          joyVec.x = joyVec.z = 0;
          out.runs.push({ k, maxStill: rec.maxStill, maxY: +rec.maxY.toFixed(2), far: +Math.hypot(player.position.x - B[0], player.position.z - B[1]).toFixed(1), y: +player.position.y.toFixed(2), top });
        }
        return out;
      }, { fb });
      fbRes.push(r);
    }
    const fbBad = fbRes.flatMap((r) => r.runs.filter((q) => q.maxStill > 15 || q.maxY < q.top - 0.35 || q.far > 1.5 || q.y > 0.15).map((q) => [r.id, q]));
    check(fbRes.length >= 5 && fbRes.every((r) => r.runs.length >= 3) && fbBad.length === 0, `footbridges ${fbRes.map((r) => r.id + ':' + r.runs.length).join(' ')}: joystick walk from the approach directions up, across and down without a stall > 0.5 s (${J(fbBad.slice(0, 3))})`);
    // the camera never ends up inside the ground along the shoreline (beach, river mouth, banks)
    const cam = await page.evaluate(async () => {
      const pts = []; for (let x = -290; x <= 0; x += 25) for (const z of [160, 185, 200, 206]) pts.push([x, z]); for (let z = 150; z <= 210; z += 12) for (const x of [-232, -220, -212, -204, -196]) pts.push([x, z]);
      const bad = []; let n = 0;
      for (const [x, z] of pts) {
        PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(x, z); if (!PlanCDataV161.access(x, z)) continue; n++;
        player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); PlanCV161.level = 0; camera.position.set(x + 9, 12, z + 12);
        for (let i = 0; i < 6; i++) { updatePlayer(1 / 30); await new Promise((r) => requestAnimationFrame(r)); }
        const d = camera.position.distanceTo(player.position);
        if (camera.position.y < 2 || camera.position.y > 30 || d < 5) bad.push([x, z, +camera.position.y.toFixed(1), +d.toFixed(1)]);
      }
      PlanCV161.R_BUILD = 128;
      return { n, bad };
    });
    check(cam.n > 40 && cam.bad.length === 0, `camera over the shoreline: ${cam.n} spots on beach / river mouth / banks, never below 2 m, never closer than 5 m to the player (${J(cam.bad.slice(0, 4))})`);
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
    // real phone view (the game's own camera), day and night, at every structure type
    if (SHOTS) {
      const spots = [['circus', 11, -11, 0], ['signal', 0, 112, 0], ['ring-n7', -232, -146, 0], ['I1-deck', 40, -240, 0], ['I1-under', 0, -222, 0], ['I2', 250, -30, 0], ['I3', 250, -200, 0], ['I4-bridge', 262, 180, 0], ['rail-under', -160, -112, 0], ['footbridge', 131, -9, 0], ['river-bridge', -190, 0, 0], ['station', -40, -100, 0], ['port', 120, 150, 0]];
      for (const night of [false, true]) {
        await ev((n) => { try { __TYCOON_V40__.setTime(n ? 22 : 12); } catch (_) {} }, night);
        for (const [name, x, z] of spots) {
          await ev(({ x, z }) => { PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(x, z); player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); PlanCV161.level = 0; for (let i = 0; i < 3; i++) updatePlayer(1 / 30); camera.position.set(x + 9, player.position.y + 12, z + 12); controls.target.set(x, player.position.y + 1, z); camera.lookAt(controls.target); }, { x, z });
          await page.waitForTimeout(1800);
          await page.screenshot({ path: path.join(SHOTS, `phone-${night ? 'night' : 'day'}-${name}.png`) });
        }
      }
      await ev(() => { try { __TYCOON_V40__.setTime(12); } catch (_) {} });
    }
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
    check(await ev(() => typeof window.__TYCOON_LANE_SIDE_V161__ === 'function' && window.__TYCOON_LANE_SIDE_V161__() === -1), 'right-hand traffic: the v82 kernel drives on the RIGHT in layout C (lane side -1: vehicles use +lane of samplePathV82 = right of the heading)');
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
    check(await ev(() => window.__TYCOON_LANE_SIDE_V161__() === 1), 'layout B keeps the old kernel lane side (+1: the old saves and plan B are unchanged)');
    check(g.errors.length === 0, `no console errors (${J(g.errors.slice(0, 3))})`);
  } finally { await g.close(); }
  const g2 = await openGame({ save: 'clear', waitMs: 4000 });   // harness default layout B on a fresh game
  try {
    check(await g2.page.evaluate(() => window.LAYOUT_V161 === 'B' && !window.PlanCV161), '?layout=B on a fresh game keeps layout B (the pre-C tests rely on it)');
  } finally { await g2.close(); }
});
