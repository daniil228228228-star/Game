/* Roundabout at the city hub (v161 layer, 2026-10-18, owner: "пипец реалистичный", "сверяй с реальными дорогами").
 *
 * Until now every road of the core started at ONE point (0,0): four to five streets crossed in a single point. Real towns put a circle there. This layer draws a
 * compact single-lane urban roundabout over the hub as soon as three or more streets arrive there (nothing without a reason: with one or two arms the hub stays a plain
 * road end / corner). The streets underneath are NOT re-laid: the ring is an overlay with a stronger polygon offset, so the old asphalt, kerb lines and dashes of the
 * old crossing are covered; the stage-road planner keeps every knee / junction >= ROUNDABOUT_KNEE_MIN_V161 away (tycoon-v161.html).
 *
 * Dimensions (game metres; roads are 2.36 m wide, a car is 2.14 m long, so ~0.4 of real size - see docs/ROAD_STANDARDS_V161.md):
 *   outer radius 4.6 (about 18 m inscribed diameter: the compact urban range 15-25 m), carriageway 2.4 m wide, mountable truck apron 0.5 m, raised central island r 1.7,
 *   kerb returns (entry flare) r 1.6, flush painted splitter islands on every arm, "give way" shark teeth on the entering lane, a zebra crossing about one car length
 *   from the circle, a roundabout sign. Circulation follows the kernel's own lane side (vehicles keep to the side lane<0 of samplePathV82 = clockwise seen from above):
 *   `route()` rewrites the part of a vehicle route that runs through the hub into an arc around the island.
 * Everything is merged: 3-4 meshes (asphalt, paint, island). The island is solid for the player (v161Prop group footprint -> PropsV161 -> v83 registry).
 */
(function () {
  'use strict';
  if (window.LAYOUT_V161 === 'C') return; // layout C: the central ring is part of plan C (assets/plan-c-v161.js)
  if (typeof THREE === 'undefined' || typeof scene === 'undefined' || !window.BuildingsV161 || !window.BuildingsV161.kit) return;
  if (window.RoundaboutV161) return;
  const K = window.BuildingsV161.kit, ctx = K.makeCtx(1);

  const P = {
    R: 4.6,          // outer radius of the carriageway
    APRON_IN: 1.7,   // central island kerb radius
    APRON_OUT: 2.2,  // truck apron outer radius
    HW: 1.18,        // half width of an arm (road 2.36 m)
    RK: 1.6,         // kerb return radius at the arm mouths
    LANE: 3.1,       // radius of the route arc (the kernel adds its own lane offset to the outside)
    MIN_ARMS: 3,
    SPLIT_APEX: 6.05,
    ZEBRA: [6.35, 7.15],
  };
  P.A = Math.sqrt((P.R + P.RK) ** 2 - (P.HW + P.RK) ** 2);   // distance along the arm where the kerb return meets the arm edge
  P.PHI = Math.atan2(P.HW + P.RK, P.A);                         // angular half width of the mouth on the ring
  const TAU = Math.PI * 2;
  const api = { enabled: true, params: P, arms: [], group: null, active: () => !!api.group, route, obstacles: () => [] };
  window.RoundaboutV161 = api;

  const mats = {};
  const vcMat = () => mats.vc || (mats.vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 }));
  const paintMat = () => mats.paint || (mats.paint = new THREE.MeshBasicMaterial({ color: 0xf7f4e8, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: 0 }));
  function asphaltMat() {
    if (mats.asphalt) return mats.asphalt;
    let src = null;
    try { const g = scene.getObjectByName('v113UnifiedStarterRoadSurface'); src = g && g.children.find((k) => k.isMesh && k.visible && k.material && k.geometry.attributes.position.count > 100); } catch (e) { /* road group not built yet */ }
    const m = src ? src.material.clone() : new THREE.MeshStandardMaterial({ color: 0x040507, roughness: 0.94, metalness: 0 });
    m.polygonOffset = true; m.polygonOffsetFactor = -6; m.polygonOffsetUnits = -6;
    if (src) mats.asphalt = m;   // a fallback is rebuilt next time, when the real road material exists
    return m;
  }

  // ------------------------------------------------------------------------------------------------ arms of the hub
  function detectArms() {
    let segs = [];
    try { segs = (window.__TYCOON_V84_ROADS__ && window.__TYCOON_V84_ROADS__.segments()) || []; } catch (e) { return []; }
    const ang = [];
    const addAng = (a) => { a = ((a % TAU) + TAU) % TAU; if (!ang.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.2)) ang.push(a); };
    for (const s of segs) {
      if (!s.a || !s.b || !/^stage/.test(s.role || '')) continue;   // only streets that are DRAWN: the master grid / service roads are not part of the hub
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, L = Math.hypot(dx, dz);
      if (L < 1.2) continue;
      const da = Math.hypot(s.a.x, s.a.z), db = Math.hypot(s.b.x, s.b.z);
      if (da < 0.08) addAng(Math.atan2(dz, dx));
      else if (db < 0.08) addAng(Math.atan2(-dz, -dx));
      else {   // a straight road passing through the hub
        const t = -(s.a.x * dx + s.a.z * dz) / (L * L);
        if (t > 0.02 && t < 0.98 && Math.hypot(s.a.x + dx * t, s.a.z + dz * t) < 0.08) { addAng(Math.atan2(dz, dx)); addAng(Math.atan2(-dz, -dx)); }
      }
    }
    return ang.sort((a, b) => a - b);
  }

  // ------------------------------------------------------------------------------------------------ geometry helpers
  const loc = (th, u, v) => [u * Math.cos(th) - v * Math.sin(th), u * Math.sin(th) + v * Math.cos(th)];
  function triUp(bt, a, b, c, y, color) {   // flat triangle at height y, normal up whatever the winding
    const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);   // y component of (B-A) x (C-A): > 0 = normal up
    const A = [a[0], y, a[1]], B = [b[0], y, b[1]], C = [c[0], y, c[1]];
    if (cr > 0) K.tri(bt, ctx, A, B, C, { color }); else K.tri(bt, ctx, A, C, B, { color });
  }
  function quadUp(bt, a, b, c, d, y, color) { triUp(bt, a, b, c, y, color); triUp(bt, a, c, d, y, color); }
  function stripe(bt, p, q, w, y, color) {   // painted line from p to q, width w
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz); if (L < 1e-4) return;
    const nx = -dz / L * w / 2, nz = dx / L * w / 2;
    quadUp(bt, [p[0] + nx, p[1] + nz], [q[0] + nx, q[1] + nz], [q[0] - nx, q[1] - nz], [p[0] - nx, p[1] - nz], y, color);
  }
  function arcPts(cx, cz, r, a0, a1, step) {
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step)), out = [];
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    return out;
  }
  const dAng = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  // outline of the paved area: ring arcs + kerb returns + (open) arm mouths; list of points, edge kinds 'k' (kerb, painted) / 'm' (mouth, no line)
  function outline(arms) {
    const pts = [], n = arms.length, STEP = 0.14;
    for (let k = 0; k < n; k++) {
      const th = arms[k], nx = arms[(k + 1) % n] + (k === n - 1 ? TAU : 0);
      const cm = loc(th, P.A, -(P.HW + P.RK)), cp = loc(th, P.A, P.HW + P.RK);
      // kerb return on the -v side: ring tangent -> arm edge
      let a0 = Math.atan2(-cm[1], -cm[0]), a1 = Math.atan2(loc(th, 0, 1)[1], loc(th, 0, 1)[0]);
      for (const p of arcPts(cm[0], cm[1], P.RK, a0, a0 + dAng(a0, a1), STEP)) pts.push({ x: p[0], z: p[1], k: 'k' });
      pts[pts.length - 1].k = 'm';
      // mouth chord, +v side kerb return: arm edge -> ring tangent
      a0 = Math.atan2(-loc(th, 0, 1)[1], -loc(th, 0, 1)[0]); a1 = Math.atan2(-cp[1], -cp[0]);
      for (const p of arcPts(cp[0], cp[1], P.RK, a0, a0 + dAng(a0, a1), STEP)) pts.push({ x: p[0], z: p[1], k: 'k' });
      // ring arc to the next arm
      const r0 = th + P.PHI, r1 = nx - P.PHI;
      if (r1 > r0 + 1e-3) { pts[pts.length - 1].k = 'k'; for (const p of arcPts(0, 0, P.R, r0, r1, 0.11).slice(0)) pts.push({ x: p[0], z: p[1], k: 'k' }); }
    }
    return pts;
  }

  // ------------------------------------------------------------------------------------------------ build
  function build(arms) {
    const g = new THREE.Group(); g.name = 'v161Roundabout';
    const asph = K.batch(false), paint = K.batch(false), isl = K.batch(true);
    const Y_A = 0.088, Y_P = 0.09;   // above the old v95 dashes (top 0.084)
    // 1. paved area: a fan from the hub over the outline (star shaped), asphalt of the road material
    const poly = outline(arms);
    const O = [0, 0];
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; triUp(asph, O, [a.x, a.z], [b.x, b.z], Y_A); }
    // 2. kerb lines along the ring and the kerb returns (inner side)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]; if (a.k === 'm') continue;
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz); if (L < 1e-4) continue;
      let nx = -dz / L, nz = dx / L; if (nx * (-(a.x + b.x) / 2) + nz * (-(a.z + b.z) / 2) < 0) { nx = -nx; nz = -nz; }
      const o = 0.045; stripe(paint, [a.x + nx * o, a.z + nz * o], [b.x + nx * o, b.z + nz * o], 0.05, Y_P, 0);
    }
    // 3. per arm: painted splitter island, give-way teeth on the entering lane, zebra crossing
    for (const th of arms) {
      const at = (u, v) => loc(th, u, v);
      const u0 = P.R + 0.1, u1 = P.SPLIT_APEX, hw0 = 0.34;
      for (const s of [-1, 1]) stripe(paint, at(u0, s * hw0), at(u1, 0), 0.05, Y_P);
      stripe(paint, at(u0, -hw0), at(u0, hw0), 0.05, Y_P);
      for (let j = 1; j <= 3; j++) { const u = u0 + (u1 - u0) * j / 4.4, h = hw0 * (1 - (u - u0) / (u1 - u0)) * 0.9; stripe(paint, at(u, -h), at(u + 0.18, 0), 0.035, Y_P); stripe(paint, at(u, h), at(u + 0.18, 0), 0.035, Y_P); }
      // give-way teeth on the entering lane (+v side): triangles with the apex towards the approaching vehicle
      const ue = Math.sqrt(P.R * P.R - 0.4 * 0.4) + 0.03;
      for (let v = 0.5; v < P.HW - 0.08; v += 0.26) { const a = at(ue, v), b = at(ue, v + 0.17), c = at(ue + 0.22, v + 0.085); triUp(paint, a, b, c, Y_P); }
      // zebra crossing: bars along the arm, one car length from the circle
      for (let v = -P.HW + 0.2; v < P.HW - 0.1; v += 0.46) { const a = at(P.ZEBRA[0], v), b = at(P.ZEBRA[0], v + 0.24), c = at(P.ZEBRA[1], v + 0.24), d = at(P.ZEBRA[1], v); quadUp(paint, a, b, c, d, Y_P); }
      // roundabout sign: a blue plate on a pole beside the entering lane
      const sp = at(P.ZEBRA[1] + 0.9, P.HW + 0.5);
      K.cyl(isl, ctx, sp[0], 0, sp[1], 0.025, 0.025, 1.1, 6, { color: 0x6b7480, cap: false });
      K.box(isl, ctx, sp[0], 1.18, sp[1], 0.36, 0.36, 0.03, { ry: -th + Math.PI / 2, color: 0xf2f0e6 });
      K.box(isl, ctx, sp[0], 1.18, sp[1], 0.3, 0.3, 0.036, { ry: -th + Math.PI / 2, color: 0x2a68b0 });
      K.box(isl, ctx, sp[0], 1.18, sp[1], 0.12, 0.12, 0.042, { ry: -th + Math.PI / 2, color: 0xf2f0e6 });
    }
    // 4. the central island: mountable apron, raised kerb, lawn, shrubs and one tree
    const N = 36;
    K.disc(isl, ctx, 0, 0, P.APRON_IN, P.APRON_OUT, 0.117, N, { color: 0xb2ada0 });
    K.cyl(isl, ctx, 0, 0.088, 0, P.APRON_OUT, P.APRON_OUT, 0.034, N, { color: 0xa39e92, cap: false });
    K.cyl(isl, ctx, 0, 0.117, 0, P.APRON_IN, P.APRON_IN, 0.13, N, { color: 0xc9c5b8, cap: false });
    K.disc(isl, ctx, 0, 0, P.APRON_IN - 0.16, P.APRON_IN, 0.247, N, { color: 0xd8d4c8 });
    K.disc(isl, ctx, 0, 0, 0, P.APRON_IN - 0.16, 0.24, N, { color: 0x5f8a49 });
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + 0.2, r = 1.12; K.blob(isl, ctx, Math.cos(a) * r, 0.37, Math.sin(a) * r, 0.2, 0.15, 0.2, 1, { color: i % 2 ? 0x3f7a45 : 0x4d8a4c }); }
    K.cyl(isl, ctx, 0, 0.24, 0, 0.07, 0.05, 0.85, 7, { color: 0x6b4c34 });
    K.blob(isl, ctx, 0, 1.38, 0, 0.5, 0.46, 0.5, 1, { color: 0x3f7f45 });
    K.blob(isl, ctx, 0.14, 1.72, 0.06, 0.32, 0.3, 0.32, 1, { color: 0x4d8f4b });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.5, r = 0.7; K.blob(isl, ctx, Math.cos(a) * r, 0.27, Math.sin(a) * r, 0.1, 0.05, 0.1, 0, { color: [0xe8d36a, 0xe58aa6, 0xf2f0e6][i % 3] }); }

    const add = (bt, material, name, ro, soft) => { const m = K.toMesh(bt, material, { name, receive: true, soft }); if (m) { m.renderOrder = ro; g.add(m); } return m; };
    add(asph, asphaltMat(), 'v161RoundaboutAsphalt', 7);
    add(paint, paintMat(), 'v161RoundaboutPaint', 8);
    add(isl, vcMat(), 'v161RoundaboutIsland', 0, true);
    g.userData.v161Prop = 'group'; g.userData.v161Footprint = [{ x: 0, z: 0, r: P.APRON_IN }];
    return g;
  }

  // ------------------------------------------------------------------------------------------------ route through the hub
  function route(path) {
    if (!api.enabled || !api.group || !path || path.length < 2) return path;
    const R = P.LANE, R2 = R * R;
    // 1. split every segment at the circle
    const pts = [];
    for (let i = 0; i < path.length; i++) {
      const b = path[i];
      if (i) {
        const a = path[i - 1], dx = b.x - a.x, dz = b.z - a.z, qa = dx * dx + dz * dz, qb = 2 * (a.x * dx + a.z * dz), qc = a.x * a.x + a.z * a.z - R2, disc = qb * qb - 4 * qa * qc;
        if (qa > 1e-9 && disc > 0) {
          const s = Math.sqrt(disc), t1 = (-qb - s) / (2 * qa), t2 = (-qb + s) / (2 * qa);
          for (const t of [t1, t2]) if (t > 1e-4 && t < 1 - 1e-4) pts.push({ x: a.x + dx * t, y: a.y + (b.y - a.y) * t, z: a.z + dz * t });
        }
      }
      pts.push({ x: b.x, y: b.y || 0, z: b.z });
    }
    const segInside = (i) => { const mx = (pts[i].x + pts[i + 1].x) / 2, mz = (pts[i].z + pts[i + 1].z) / 2; return mx * mx + mz * mz < R2 - 1e-6; };
    const segDist = (i) => { const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, q = dx * dx + dz * dz, t = q ? Math.max(0, Math.min(1, -(a.x * dx + a.z * dz) / q)) : 0; return Math.hypot(a.x + dx * t, a.z + dz * t); };
    const out = [];
    const push = (p) => { const l = out[out.length - 1]; if (l && Math.abs(l.x - p.x) < 1e-4 && Math.abs(l.z - p.z) < 1e-4) return; out.push(new THREE.Vector3(p.x, p.y || 0, p.z)); };
    let touched = false, i = 0;
    while (i < pts.length - 1) {
      if (!segInside(i)) { push(pts[i]); i++; continue; }
      let j = i, deep = Infinity;
      while (j < pts.length - 1 && segInside(j)) { deep = Math.min(deep, segDist(j)); j++; }
      const E = pts[i], X = pts[j], startsInside = i === 0 && E.x * E.x + E.z * E.z < R2 - 1e-3, endsInside = j === pts.length - 1 && X.x * X.x + X.z * X.z < R2 - 1e-3;
      touched = true;
      if (startsInside && endsInside) return path;   // the whole route lies on the island / ring: leave it alone
      if (endsInside) { push(E); i = pts.length; break; }
      if (!startsInside) {
        push(E);
        const a0 = Math.atan2(E.z, E.x), a1 = Math.atan2(X.z, X.x);
        let d = ((a1 - a0) % TAU + TAU) % TAU;           // increasing angle = the kernel's lane side (clockwise seen from above)
        if (d < 1e-3 && deep < 1.2) d = TAU;             // a U-turn through the island: the whole lap
        else if (d < 1e-3) d = 0;
        if (d > 0) { const n = Math.max(2, Math.ceil(d / 0.2)); for (let q = 1; q < n; q++) { const a = a0 + d * q / n; push({ x: Math.cos(a) * R, y: E.y, z: Math.sin(a) * R }); } }
      }
      push(X); i = j;
    }
    if (i === pts.length - 1) push(pts[i]);
    return touched && out.length >= 2 ? out : path;
  }

  // ------------------------------------------------------------------------------------------------ live
  let sig = '', lastAt = 0, lastStray = 0;
  function dispose() {
    if (!api.group) return;
    scene.remove(api.group);
    api.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    api.group = null;
  }
  function refresh(force) {
    let armsNow = [];
    try { armsNow = detectArms(); } catch (e) { armsNow = []; }
    const want = api.enabled && armsNow.length >= P.MIN_ARMS;
    const key = want ? armsNow.map((a) => a.toFixed(2)).join(',') : '';
    if (!force && key === sig) return;
    sig = key; api.arms = armsNow;
    dispose();
    if (want) {
      api.group = build(armsNow); scene.add(api.group);
      try { window.__TYCOON_V83_COLLISIONS__ && window.__TYCOON_V83_COLLISIONS__.rebuild(); } catch (e) { /* registry not up yet */ }
    }
  }
  // Legacy roadside benches / signs (tycoon-v161.html createRoadsideDetails) stand beside the OLD spiral path, not beside the real streets; since the hub moved they can sit on a street or in
  // the circle. A prop that overlaps the carriageway of a drawn street is hidden (no collider then: PropsV161 reads visible props only).
  function retireStrays() {
    let segs = [];
    try { segs = (window.__TYCOON_V84_ROADS__ && window.__TYCOON_V84_ROADS__.segments()) || []; } catch (e) { return; }
    const v = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.userData || !o.userData.v37LegacyRoadside || !o.userData.v161Prop || o.userData.v161Retired) return;
      o.getWorldPosition(v);
      let hit = api.group && Math.hypot(v.x, v.z) < P.R + 1.2;
      for (let i = 0; !hit && i < segs.length; i++) {
        const a = segs[i].a, b = segs[i].b, dx = b.x - a.x, dz = b.z - a.z, q = dx * dx + dz * dz, t = q ? Math.max(0, Math.min(1, ((v.x - a.x) * dx + (v.z - a.z) * dz) / q)) : 0;
        if (Math.hypot(v.x - a.x - dx * t, v.z - a.z - dz * t) < (segs[i].width || 2.36) / 2 + 0.8) hit = true;
      }
      if (hit) { o.visible = false; o.userData.v161Retired = true; }
    });
  }
  api.refresh = refresh; api.retireStrays = retireStrays;
  try { (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push((now) => { if (now - lastAt < 1000) return; lastAt = now; refresh(false); if (now - lastStray > 4000) { lastStray = now; retireStrays(); } }); } catch (e) { /* no tick list */ }

  // vehicles: every route the game builds goes around the island
  try {
    const base = buildRoadRoute;
    buildRoadRoute = function () { const r = base.apply(this, arguments); return r && api.group ? route(r) : r; };
  } catch (e) { /* the route builder is not assignable here: vehicles keep the straight route */ }
  try { refresh(true); } catch (e) { /* the hub cannot be read yet: the tick will retry */ }
})();
