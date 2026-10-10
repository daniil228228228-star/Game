/* Factories + fleet yard v161 (2026-10-06 (10), "improve physics and design of every building, one at a time", backlog #7 + #8).
 *
 * FACTORIES: buildFactoryV161(stage, height, baseSize, level) is the live builder of the `factory` archetype for the three main-line STAGES entries (4 "Мини-завод", 5 "Завод", 13 "Технопарк";
 * createBuildingMesh in tycoon-v161.html calls it instead of buildFactory + the three shared polish passes; the flags v161Complete / v44Detailed / v157Finish it sets make them, the v44 micro details
 * and finish-v157 skip it). Other `factory` users (district plots, projects) keep the old builder. `FactoryV161.enabled = false` brings the old factory back (showcase before/after).
 * The old builder stretched the building 18 % per level (9-10.7 m at level 5); here every level ADDS parts to the SAME building (nothing is stretched, the height grows by the chimneys only).
 * All three are built in an "outward" frame like the warehouse: padLocal(idx) is the real upgrade pad in the building frame, the solid parts stay >= 0.95 m from it and the levels grow AWAY from it
 * (u = distance along the long axis away from the pad, x = gs * u). Front = +z (the driveway); the loading door stands within 0.4 m of the centre line (door dot >= 0.95).
 *   stage 4  mini factory : red-brick workshop, sawtooth roof with glazed north lights, rear chimney, loading door with a canopy, apron; 2 third bay + side door with a ramp, 3 water tank + pipe,
 *                           4 brick office annex, 5 second taller chimney + roof fans + name board + floodlights.
 *   stage 5 factory      : bigger brick hall, 3 sawtooth bays, tall chimney, loading dock with two doors; 2 fourth bay + horizontal tanks + pipe, 3 two tanks + office annex, 4 rear hall + second chimney,
 *                           5 pipe bridge + gantry crane + name board.
 *   stage 13 tech park   : steel-panel halls, glass office annex, stack(s), cooling tower with a live steam plume, pipe rack, gantry; see buildTech.
 * Gold 6-10 through FactoryV161.addGold (called from assets/late-game-v161.js): ridge / cornice trim, door frames, flag pole + pennant, golden crown at 10.
 * cost: everything merged into ~12 meshes (one per material), shared materials flagged `sharedSurfaceV153`; physics: `userData.v161Footprint` = the real wall boxes -> v83 registry oriented boxes.
 * Smoke: the building lists its chimney tops in userData.stackTops (the game's updateSmoke emits there; since 2026-10-06 (10) only while the building is complete = earning income).
 */
(() => {
  'use strict';
  if (!window.BuildingsV161 || !window.BuildingsV161.kit) return;
  const K = window.BuildingsV161.kit;
  const { batch, box, tri, quad, cone, cyl, disc, blob, makeCtx, toMesh, lin, shade } = K;

  // ---------------------------------------------------------------------------------------------- shared materials (never disposed)
  let SM = null;
  function smats() {
    if (SM) return SM;
    const M = K.mats();
    const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    const fam = (family, color, opts) => share(createSurfaceMaterialV152(family, lin(color), opts));
    SM = {
      brick4: fam('brick', 0xc2603f, { roughness: 0.92 }),
      brick5: fam('brick', 0xa9533a, { roughness: 0.92 }),
      panel: fam('corrugated', 0xb4c3d3, { roughness: 0.7 }),                       // pale steel panels (tech park)
      roof: fam('corrugated', 0x4b5562, { roughness: 0.68, side: THREE.DoubleSide }),
      roofT: fam('corrugated', 0x5d7087, { roughness: 0.62, side: THREE.DoubleSide }),
      steel: fam('metal', 0x6a7683, { roughness: 0.55 }),
      roller: fam('corrugated', 0xc3c9cf, { roughness: 0.6, metalness: 0.12 }),
      door: fam('metal', 0xd9792b, { roughness: 0.6 }),
      trim: M.trim, plinth: M.plinth, detail: M.detail, lamp: M.lamp, gold: M.gold,
      glass: share(new THREE.MeshStandardMaterial({ color: lin(0x9fd0e8), emissive: lin(0x1b3a52), emissiveIntensity: 0.26, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.6, depthWrite: false })),
    };
    return SM;
  }

  // palette (sRGB hex)
  const ORANGE = 0xf0902e, YELLOW = 0xf2b522, DARK = 0x2b2f36, WHITE = 0xf3f6f8, GREY = 0x8a97a3, BLUE = 0x2f6fb0, TEAL = 0x2fb0c4, NAVY = 0x23415e, STEEL = 0x77838f, BRICKD = 0x7a3a2a, RED = 0xc8402f;

  // ---------------------------------------------------------------------------------------------- helpers
  // where is the upgrade pad, in the building's local frame (x right, z front = towards the driveway)?
  function padLocal(idx) {
    try {
      if (!(idx >= 0)) return null;
      const axis = stageAccessAxisV92(idx), yaw = Math.atan2(-axis.x, -axis.z), bp = buildingPosition(idx), pp = upgradePadPosition(bp, idx);
      const dx = pp.x - bp.x, dz = pp.z - bp.z, c = Math.cos(yaw), s = Math.sin(yaw);
      return { x: dx * c - dz * s, z: dx * s + dz * c };
    } catch (_) { return null; }
  }
  function fq(bt, ctx, a, b, c, d, dir, o) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) quad(bt, ctx, a, b, c, d, o); else quad(bt, ctx, d, c, b, a, o);
  }
  function ftri(bt, ctx, a, b, c, dir, o) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * dir[0] + ny * dir[1] + nz * dir[2] >= 0) tri(bt, ctx, a, b, c, o); else tri(bt, ctx, a, c, b, o);
  }
  const bxr = (bt, ctx, x0, x1, y0, y1, z0, z1, o) => box(bt, ctx, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), o);

  // one drawing kit per building: batches + u-space helpers (u = away from the pad, world x = gs * u)
  function kit(k, gs) {
    const ctx = makeCtx(k);
    const X = (u) => gs * u, rx = (u0, u1) => (gs > 0 ? [u0, u1] : [-u1, -u0]);
    const B = { Pn: batch(), Wl: batch(), Rf: batch(), St: batch(), Tr: batch(), Dr: batch(), Dt: batch(true), Ct: batch(true), Lp: batch(), Gl: batch() };
    const o = { ctx, gs, k, X, rx, B, footprint: [], stackTops: [], chims: [] };
    o.bu = (bt, u0, u1, ya, yb, za, zb, op) => { const r = rx(u0, u1); bxr(bt, ctx, r[0], r[1], ya, yb, za, zb, op); };       // box by u / y / z ranges
    o.bx = (bt, u, y, z, w, h, d, op) => box(bt, ctx, X(u), y, z, w, h, d, op);                                                // box by centre
    o.P = (p) => [gs * p[0], p[1], p[2]];
    o.pq = (bt, a, b, c, d, dir, op) => fq(bt, ctx, o.P(a), o.P(b), o.P(c), o.P(d), [gs * dir[0], dir[1], dir[2]], op);        // quad in u-space, outward direction in u-space
    o.pt = (bt, a, b, c, dir, op) => ftri(bt, ctx, o.P(a), o.P(b), o.P(c), [gs * dir[0], dir[1], dir[2]], op);
    // tube along u (y, z = axis), n sides
    o.tubeU = (bt, u0, u1, y, z, r, n, op, caps = true) => {
      for (let i = 0; i < n; i++) {
        const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2, p = (u, a) => [X(u), y + Math.sin(a) * r, z + Math.cos(a) * r];
        fq(bt, ctx, p(u0, a0), p(u1, a0), p(u1, a1), p(u0, a1), [0, Math.sin(am), Math.cos(am)], op);
        if (caps) { ftri(bt, ctx, [X(u1), y, z], p(u1, a0), p(u1, a1), [gs, 0, 0], op); ftri(bt, ctx, [X(u0), y, z], p(u0, a0), p(u0, a1), [-gs, 0, 0], op); }
      }
    };
    // tube along z
    o.tubeZ = (bt, u, y, z0, z1, r, n, op, caps = true) => {
      for (let i = 0; i < n; i++) {
        const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, am = (a0 + a1) / 2, p = (z, a) => [X(u) + Math.cos(a) * r, y + Math.sin(a) * r, z];
        fq(bt, ctx, p(z0, a0), p(z1, a0), p(z1, a1), p(z0, a1), [Math.cos(am), Math.sin(am), 0], op);
        if (caps) { ftri(bt, ctx, [X(u), y, z1], p(z1, a0), p(z1, a1), [0, 0, 1], op); ftri(bt, ctx, [X(u), y, z0], p(z0, a0), p(z0, a1), [0, 0, -1], op); }
      }
    };
    // run fn in a frame at (u, z) looking outward: 'f' = +z (front), 'b' = -z, 'e' = +u (far end), 'p' = -u (pad side); the local +z is the outward direction
    o.at = (u, z, face, fn) => { const ang = { f: 0, b: Math.PI, e: gs * Math.PI / 2, p: -gs * Math.PI / 2 }[face]; ctx.at(X(u), 0, z, ang, fn); };
    return o;
  }

  // a framed window in a local frame whose +z is outwards: w x h, centre at (0, y)
  function windowLocal(o, x, y, w, h) {
    const { B, ctx } = o;
    box(B.Tr, ctx, x, y + h / 2 + 0.035, 0.022, w + 0.14, 0.07, 0.05); box(B.Tr, ctx, x, y - h / 2 - 0.02, 0.05, w + 0.18, 0.04, 0.1);               // lintel + projecting sill
    for (const s of [-1, 1]) box(B.Tr, ctx, x + s * (w / 2 + 0.035), y, 0.022, 0.07, h, 0.05);
    box(B.Gl, ctx, x, y, 0.008, w, h, 0.012);
    box(B.Dt, ctx, x, y, 0.016, 0.02, h, 0.012, { color: DARK }); box(B.Dt, ctx, x, y + h * 0.12, 0.016, w, 0.02, 0.012, { color: DARK });
  }

  // ---------------------------------------------------------------------------------------------- shared parts
  // chimney (tapered brick shaft with white bands and a dark rim) from yb up to top; registers the smoke top
  function chimney(o, u, z, yb, top, r0, r1, brickColor, withLadder = true) {
    const { B, ctx, X } = o, h = top - yb;
    cyl(B.Ct, ctx, X(u), yb, z, r0 + 0.1, r0 + 0.1, 0.16, 12, { color: shade(brickColor, 0.85) });                                              // base collar
    cyl(B.Ct, ctx, X(u), yb + 0.14, z, r0, r1, h - 0.14, 12, { color: brickColor });
    for (const t of [0.45, 0.8]) { const r = r0 + (r1 - r0) * t + 0.015; cyl(B.Ct, ctx, X(u), yb + 0.14 + (h - 0.14) * t, z, r, r, 0.07, 12, { color: 0xe9e1d0 }); }   // light bands
    cyl(B.Ct, ctx, X(u), top - 0.12, z, r1 + 0.05, r1 + 0.07, 0.13, 12, { color: 0x3a3f46 });                                                    // rim (0.01 above the shaft top: no coplanar caps)
    disc(B.Ct, ctx, X(u), z, 0, r1 + 0.03, top + 0.013, 12, { color: 0x1c2024 });                                                                // dark flue opening
    o.stackTops.push({ x: X(u) * o.k, y: (top + 0.12) * o.k, z: z * o.k });
    o.chims.push({ u, z, yb, top, r0, r1 });
  }
  // vertical storage tank with a conical cap, ladder, rail and a band; footprint = its bounding square
  function vTank(o, u, z, y0, r, h, color) {
    const { B, ctx, X } = o;
    cyl(B.Ct, ctx, X(u), y0, z, r, r, h, 14, { color });
    cone(B.Ct, ctx, X(u), y0 + h, z, r + 0.02, r * 0.5, 14, { color: shade(color, 0.85) });
    for (const t of [0.25, 0.75]) cyl(B.Ct, ctx, X(u), y0 + h * t, z, r + 0.012, r + 0.012, 0.05, 14, { color: 0x3a4048 });
    for (const s of [-1, 1]) box(B.Dt, ctx, X(u) + s * 0.05, y0 + h / 2, z + r + 0.015, 0.015, h, 0.02, { color: 0x30353b });
    for (let i = 0; i < 7; i++) box(B.Dt, ctx, X(u), y0 + 0.2 + i * (h - 0.3) / 6, z + r + 0.015, 0.1, 0.014, 0.02, { color: 0x30353b });
    o.footprint.push({ u0: u - r - 0.02, u1: u + r + 0.02, z0: z - r - 0.02, z1: z + r + 0.02 });
  }
  // barrels / pallet (neutral props, soft)
  function barrels(o, u, z, y0, cols) {
    const { B, ctx, X } = o;
    cols.forEach((c, i) => { cyl(B.Dt, ctx, X(u) + (i % 2) * 0.2 * o.gs, y0, z + Math.floor(i / 2) * 0.2, 0.085, 0.085, 0.24, 8, { color: c }); });
  }
  function pallet(o, u, z, y0, h, c1, c2, ry = 0) {
    const { B, ctx, X } = o;
    ctx.at(X(u), y0, z, ry, () => {
      box(B.Dt, ctx, 0, 0.03, 0, 0.34, 0.03, 0.34, { color: 0xa8743f }); box(B.Dt, ctx, 0, 0.075, 0, 0.34, 0.025, 0.34, { color: 0xa8743f });
      for (let i = 0; i < h; i++) box(B.Dt, ctx, 0, 0.12 + i * 0.13, 0, 0.3, 0.12, 0.3, { color: i % 2 ? c2 : c1 });
    });
  }
  function lamp(o, u, y, z, face) { o.at(u, z, face, () => { box(o.B.Lp, o.ctx, 0, y, 0.05, 0.08, 0.05, 0.06); box(o.B.Dt, o.ctx, 0, y + 0.04, 0.03, 0.1, 0.02, 0.06, { color: DARK }); }); }

  // sawtooth roof over [ua, ua + n * pitch] x [zr, zf]: slate slopes rising towards +u, glazed risers (north lights) at the high edge with a dark interior behind them, gable triangles in the wall material
  function sawtooth(o, ua, n, pitch, zr, zf, yw, th, oz) {
    const { B, ctx } = o;
    for (let i = 0; i < n; i++) {
      const a = ua + i * pitch, b = a + pitch;
      o.pq(B.Rf, [a, yw, zf + oz], [a, yw, zr - oz], [b, yw + th, zr - oz], [b, yw + th, zf + oz], [-th, pitch, 0]);                                  // slope
      o.pq(B.Gl, [b + 0.004, yw + 0.04, zf - 0.04], [b + 0.004, yw + 0.04, zr + 0.04], [b + 0.004, yw + th - 0.02, zr + 0.04], [b + 0.004, yw + th - 0.02, zf - 0.04], [1, 0, 0]);  // glazing
      o.pq(B.Dt, [b - 0.02, yw, zf - 0.04], [b - 0.02, yw, zr + 0.04], [b - 0.02, yw + th - 0.02, zr + 0.04], [b - 0.02, yw + th - 0.02, zf - 0.04], [1, 0, 0], { color: 0x23282f });   // dark interior
      const nm = Math.max(3, Math.round((zf - zr) / 0.55));
      for (let m = 0; m <= nm; m++) { const z = zr + 0.04 + (zf - zr - 0.08) * m / nm; o.bu(B.Tr, b - 0.01, b + 0.02, yw + 0.03, yw + th - 0.01, z - 0.012, z + 0.012); }   // mullions
      o.bu(B.Tr, b - 0.01, b + 0.03, yw + th - 0.03, yw + th + 0.01, zr + 0.02, zf - 0.02);                                                         // head rail
      o.pt(B.Wl, [a, yw, zf], [b, yw + th, zf], [b, yw, zf], [0, 0, 1]);                                                                              // gable triangles
      o.pt(B.Wl, [a, yw, zr], [b, yw, zr], [b, yw + th, zr], [0, 0, -1]);
    }
  }

  // ============================================================================================== BRICK FACTORIES (stage 4 and 5)
  const CFG = {
    4: { group: 'miniFactoryV161', brick: 'brick4', y0: 0.12, wallH: 1.3, pitch: 1.05, th: 0.5, zf: 1.18, zr: -1.18, u0: -0.75, teeth: [2, 3, 3, 3, 3], door: { u: -0.225, w: 0.8, h: 1.0 },
      chim: { u: -0.25, z: -0.7, r0: 0.26, r1: 0.17, top: 3.2 }, chim2: { z: -0.7, r0: 0.25, r1: 0.16, top: 3.65 }, tank: { r: 0.34, h: 1.25 }, pad: 0.95 },
    5: { group: 'factoryV161', brick: 'brick5', y0: 0.14, wallH: 1.5, pitch: 1.3, th: 0.62, zf: 1.45, zr: -1.45, u0: -1.05, teeth: [3, 4, 4, 4, 4], door: { u: -0.4, w: 0.95, h: 1.2 },
      chim: { u: 0.1, z: -0.85, r0: 0.34, r1: 0.21, top: 4.5 }, chim2: { z: -0.85, r0: 0.3, r1: 0.19, top: 4.85 }, tank: { r: 0.42, h: 1.5 }, pad: 1.0, rear: true },
  };

  function hall(o, c, ua, n, zr, zf, wallH, th, opt = {}) {
    const { B, ctx } = o, y0 = c.y0, yw = y0 + wallH, ub = ua + n * c.pitch, p = c.pitch;
    o.bu(B.Pn, ua - 0.06, ub + 0.06, 0, y0, zr - 0.06, zf + 0.06);                                                                             // plinth
    o.bu(B.Wl, ua, ub, y0, yw, zr, zf);                                                                                                           // brick walls
    o.bu(B.Dt, ua - 0.005, ub + 0.005, y0, y0 + 0.2, zr - 0.012, zf + 0.012, { color: BRICKD });                                                  // dark brick base band
    o.bu(B.Tr, ua - 0.04, ub + 0.04, yw - 0.13, yw + 0.03, zr - 0.05, zf + 0.05);                                                                 // cornice (all round)
    for (let i = 0; i <= n; i++) for (const z of [zr, zf]) { const u = ua + i * p; o.bu(B.Tr, u - 0.07, u + 0.07, y0, yw - 0.12, z - (z > 0 ? -0.0 : 0.05), z + (z > 0 ? 0.05 : 0.0)); }   // pilasters between the bays
    sawtooth(o, ua, n, p, zr, zf, yw + 0.03, th, 0.07);
    if (opt.backWindows) for (let i = 0; i < n; i++) o.at(ua + (i + 0.5) * p, zr, 'b', () => windowLocal(o, 0, y0 + 0.55, 0.42, 0.55));
    o.footprint.push({ u0: ua - 0.05, u1: ub + 0.05, z0: zr - 0.05, z1: zf + 0.05 });
    return { ub, yw };
  }

  function buildBrick(stage, height, baseSize, level) {
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1, c = CFG[idx === 5 ? 5 : 4];
    const L = Math.max(1, Math.min(5, Math.floor(level) || 1));
    const M = smats();
    const pl = padLocal(idx);
    const padSide = pl ? (pl.x >= 0 ? 1 : -1) : 1, gs = -padSide;
    const o = kit(1, gs), { B, ctx, X, bu, bx } = o;
    const { y0, wallH, pitch, th, zf, zr, u0 } = c;
    const n = c.teeth[L - 1], yw = y0 + wallH;
    const dims = { k: 1, level: L, gs, padSide, y0, yw, zf, zr, u0, n, pitch, th, top: 0 };
    const main = hall(o, c, u0, n, zr, zf, wallH, th), u1 = main.ub;
    dims.u1 = u1;

    // ---- front: loading door (the door mesh the tests measure stands in it), orange frame, canopy with hazard edge, lamps; apron with a nose
    const d = c.door, ud = d.u, dh = d.h, dw = d.w;
    {
      bu(B.Pn, ud - dw / 2 - 0.35, ud + dw / 2 + 0.35, 0, y0 + 0.01, zf, zf + 0.5);                                                                 // apron slab (walkable, 12-14 cm)
      bu(B.Tr, ud - dw / 2 - 0.37, ud + dw / 2 + 0.37, y0 + 0.01, y0 + 0.03, zf + 0.46, zf + 0.52);
      const hn = 9; for (let i = 0; i < hn; i++) { const u = ud - dw / 2 - 0.35 + (i + 0.5) * (dw + 0.7) / hn; bx(B.Dt, u, y0 + 0.032, zf + 0.49, (dw + 0.7) / hn + 0.001, 0.008, 0.05, { color: i % 2 ? DARK : YELLOW }); }
      bx(B.Dr, ud, y0 + dh / 2, zf + 0.025, dw, dh, 0.04);
      for (let r = 1; r < 6; r++) bx(B.Tr, ud, y0 + r * dh / 6, zf + 0.05, dw, 0.012, 0.012);
      for (const s of [-1, 1]) bx(B.Dt, ud + s * (dw / 2 + 0.045), y0 + dh / 2 + 0.03, zf + 0.04, 0.09, dh + 0.06, 0.08, { color: ORANGE });
      bx(B.Dt, ud, y0 + dh + 0.05, zf + 0.04, dw + 0.2, 0.09, 0.08, { color: ORANGE });
      
      for (const s of [-1, 1]) bx(B.Dt, ud + s * (dw / 2 + 0.2), y0 + 0.08, zf + 0.08, 0.1, 0.16, 0.1, { color: DARK });                              // bumpers
      lamp(o, ud, y0 + dh + 0.1, zf - 0.0, 'f');
      // canopy: a thin steel slab on two brackets, blue fascia
      bu(B.St, ud - dw / 2 - 0.3, ud + dw / 2 + 0.3, y0 + dh + 0.19, y0 + dh + 0.24, zf, zf + 0.5);
      bu(B.Dt, ud - dw / 2 - 0.3, ud + dw / 2 + 0.3, y0 + dh + 0.17, y0 + dh + 0.26, zf + 0.49, zf + 0.51, { color: BLUE });
      for (const s of [-1, 1]) bx(B.St, ud + s * (dw / 2 + 0.25), y0 + dh + 0.14, zf + 0.25, 0.03, 0.03, 0.5);
      var doorX = X(ud), doorY = y0 + 0.17, doorZ = zf + 0.045;
    }
    // ---- windows: front + back in every bay except the door bay, one on the pad-side end wall
    for (let i = 0; i < n; i++) {
      const uc = u0 + (i + 0.5) * pitch;
      if (i > 0) o.at(uc, zf, 'f', () => windowLocal(o, 0, y0 + 0.62, 0.42, 0.6));
      o.at(uc, zr, 'b', () => windowLocal(o, 0, y0 + 0.62, 0.42, 0.6));
    }
    o.at(u0, -0.1, 'p', () => windowLocal(o, 0, y0 + 0.62, 0.44, 0.6));
    // level pips on the front cornice (one per level, yellow)
    for (let i = 0; i < L; i++) bx(B.Dt, u0 + 0.2 + i * 0.11, yw - 0.06, zf + 0.056, 0.055, 0.055, 0.012, { color: YELLOW });
    // chimney (rises through the roof), neutral barrels + pallet by the apron
    chimney(o, c.chim.u, c.chim.z, yw + 0.1, c.chim.top, c.chim.r0, c.chim.r1, 0xb5503a);
    dims.chimTop = c.chim.top;
    barrels(o, ud + dw / 2 + 0.62, zf + 0.3, 0, [ORANGE, BLUE, ORANGE]);
    pallet(o, ud - dw / 2 - 0.5, zf + 0.26, 0, 2, 0xc9a063, 0xb88a52, 0.15);

    // ---- level 2: side door on the far end wall (rear half) with a ramp + the extra bay (n = 3)
    if (L >= 2) {
      const sz = zr + 0.62, dw2 = 0.8, dh2 = 1.0;
      o.at(u1, sz, 'e', () => {
        box(B.Dr, ctx, 0, y0 + dh2 / 2, 0.025, dw2, dh2, 0.04);
        for (let r = 1; r < 6; r++) box(B.Tr, ctx, 0, y0 + r * dh2 / 6, 0.05, dw2, 0.012, 0.012);
        for (const s of [-1, 1]) box(B.Dt, ctx, s * (dw2 / 2 + 0.045), y0 + dh2 / 2 + 0.03, 0.04, 0.09, dh2 + 0.06, 0.08, { color: ORANGE });
        box(B.Dt, ctx, 0, y0 + dh2 + 0.05, 0.04, dw2 + 0.2, 0.09, 0.08, { color: ORANGE });
      });
      lamp(o, u1, y0 + dh2 + 0.3, sz, 'e');
      // loading ramp (walkable wedge from the door sill down to the ground) with hazard rims
      const ru1 = u1 + 0.75, z0 = sz - 0.5, z1 = sz + 0.5, X0 = X(u1), X1 = X(ru1);
      bu(B.Pn, u1, u1 + 0.18, 0, y0 + 0.01, z0, z1);
      o.pq(B.Pn, [u1 + 0.18, y0 + 0.01, z0], [u1 + 0.18, y0 + 0.01, z1], [ru1, 0.005, z1], [ru1, 0.005, z0], [0, 1, 0]);
      o.pq(B.Pn, [u1 + 0.18, 0, z1], [ru1, 0, z1], [ru1, 0.005, z1], [u1 + 0.18, y0 + 0.01, z1], [0, 0, 1]);
      o.pq(B.Pn, [u1 + 0.18, 0, z0], [ru1, 0, z0], [ru1, 0.005, z0], [u1 + 0.18, y0 + 0.01, z0], [0, 0, -1]);
      for (const z of [z0 + 0.03, z1 - 0.03]) o.pq(B.Dt, [u1 + 0.18, y0 + 0.014, z - 0.025], [u1 + 0.18, y0 + 0.014, z + 0.025], [ru1, 0.012, z + 0.025], [ru1, 0.012, z - 0.025], [0, 1, 0], { color: YELLOW });
      pallet(o, ru1 + 0.25, sz + 0.1, 0, 3, 0xd8b678, 0xc9a063, -0.2);
    }
    // ---- level 3: vertical tank behind the back wall + a pipe into the hall
    if (L >= 3) {
      const tk = c.tank, tu = u1 - 0.85, tz = zr - tk.r - 0.12;
      vTank(o, tu, tz, 0, tk.r, tk.h, idx === 5 ? 0xb8c3ce : 0xc9d1d9);
      o.tubeZ(B.Ct, tu - tk.r * 0.55, y0 + 0.7, zr - 0.01, tz + tk.r * 0.1, 0.045, 8, { color: 0x7d8791 });                                       // pipe: tank -> back wall
      o.bx(B.Ct, tu - tk.r * 0.55, y0 + 0.7, zr - 0.05, 0.14, 0.14, 0.02, { color: STEEL });
      if (idx === 5) { vTank(o, tu - tk.r * 2 - 0.15, tz, 0, tk.r * 0.8, tk.h * 0.85, 0xc9d1d9); }
    }
    // ---- level 4: brick office annex on the far end (front half): flat roof with a parapet, 2 windows, small AC unit; stage 5 adds the rear hall + second chimney
    if (L >= 4) {
      const au0 = u1, au1 = u1 + (idx === 5 ? 1.25 : 1.0), az0 = 0.0, az1 = zf - 0.1, ah = idx === 5 ? 1.35 : 1.0, ya = y0 + ah;
      o.bu(B.Pn, au0 - 0.02, au1 + 0.06, 0, y0, az0 - 0.06, az1 + 0.06);
      o.bu(B.Wl, au0, au1, y0, ya, az0, az1);
      o.bu(B.Dt, au0, au1 + 0.005, y0, y0 + 0.18, az0 - 0.012, az1 + 0.012, { color: BRICKD });
      o.bu(B.Tr, au0, au1 + 0.04, ya - 0.04, ya + 0.1, az0 - 0.04, az1 + 0.05);                                                                   // parapet band
      o.bu(B.Dt, au0 + 0.05, au1 - 0.03, ya + 0.1, ya + 0.12, az0 + 0.03, az1 - 0.03, { color: 0x3b4048 });                                       // roof deck
      o.at((au0 + au1) / 2 + 0.1, az1, 'f', () => { windowLocal(o, -0.18, y0 + 0.62, 0.34, 0.55); windowLocal(o, 0.22, y0 + 0.62, 0.34, 0.55); });
      o.at(au1, (az0 + az1) / 2, 'e', () => { windowLocal(o, 0, y0 + 0.62, 0.4, 0.55); });
      o.bx(B.Dt, au0 + 0.4, ya + 0.22, az0 + 0.3, 0.45, 0.2, 0.3, { color: 0xa5b0ba });
      o.footprint.push({ u0: au0, u1: au1 + 0.05, z0: az0 - 0.05, z1: az1 + 0.05 });
      dims.annex = { u0: au0, u1: au1, z0: az0, z1: az1, ya };
      if (idx === 5 && c.rear) {
        const ru0 = u0 + 0.3, rn = 3, rzf = zr - 0.02, rzr = zr - 1.6, rw = 1.2, rth = 0.5;
        const rear = hall(o, Object.assign({}, c, { pitch: 1.2 }), ru0, rn, rzr, rzf, rw, rth, { backWindows: true });
        dims.rear = { u0: ru0, u1: rear.ub, z0: rzr, z1: rzf };
      }
    }
    // ---- level 5: second chimney + roof fans + name board along the front + floodlight masts at the apron ends
    if (L >= 5) {
      const ch = c.chim2, cu = idx === 5 ? u0 + 0.3 + 2.0 : u1 - 0.55, czz = idx === 5 ? zr - 0.9 : ch.z;
      const baseY = idx === 5 ? y0 + 1.2 + 0.1 : yw + 0.1;
      chimney(o, cu, czz, baseY, ch.top, ch.r0, ch.r1, 0xa94a36);
      dims.chimTop = Math.max(dims.chimTop, ch.top);
      // roof fans (round vents on the sawtooth ridge lines)
      for (let i = 0; i < 2; i++) { const fu = u0 + (i + 0.55) * pitch + 0.2; cyl(B.St, ctx, X(fu), yw + 0.03 + th * 0.6, zf - 0.38, 0.11, 0.11, 0.06, 10); cyl(B.Dt, ctx, X(fu), yw + 0.09 + th * 0.6, zf - 0.38, 0.1, 0.02, 0.05, 10, { color: DARK }); }
      // name board on the front wall above the windows: navy board, orange stripe, white bars (no text / texture)
      {
        const bu0 = u0 + pitch + 0.1, bu1 = u1 - 0.12, yy = yw - 0.25;
        bu(B.Dt, bu0, bu1, yy - 0.1, yy + 0.1, zf + 0.012, zf + 0.04, { color: NAVY }); bu(B.Dt, bu0, bu1, yy - 0.1, yy - 0.08, zf + 0.04, zf + 0.05, { color: ORANGE });
        let lu = bu0 + 0.12; const ws = [0.07, 0.05, 0.09, 0.05, 0.07, 0.09, 0.05, 0.08, 0.05, 0.07];
        for (let i = 0; i < ws.length; i++) { const w = ws[i], hh = i % 3 === 1 ? 0.08 : 0.11; if (i === 5) lu += 0.12; if (lu + w > bu1 - 0.1) break; bu(B.Dt, lu, lu + w, yy + 0.01 - hh / 2, yy + 0.01 + hh / 2, zf + 0.04, zf + 0.052, { color: WHITE }); lu += w + 0.045; }
      }
      for (const u of [u0 - 0.1, u1 + 0.25]) { const x = X(u), z = zf + 0.7; cyl(B.St, ctx, x, 0, z, 0.035, 0.028, 1.55, 6); bx(B.St, u, 1.55, z, 0.3, 0.035, 0.035); for (const s of [-1, 1]) { bx(B.Dt, u + s * 0.1, 1.6, z, 0.09, 0.06, 0.06, { color: DARK }); bx(B.Lp, u + s * 0.1, 1.6, z + 0.04, 0.07, 0.045, 0.02); } }
      dims.sign = { yy: yw - 0.25 };
    }

    // ---- assemble
    return assemble(o, M, idx === 5 ? M.brick5 : M.brick4, M.roof, c.group, 'brick' + idx, dims, { X: doorX, Y: doorY, Z: doorZ, w: 0.5, h: 0.34, u: ud }, L);
  }

  function assemble(o, M, wallMat, roofMat, name, kind, dims, door, L) {
    const { B } = o;
    const group = new THREE.Group();
    group.name = name;
    const add = (m) => { if (m) group.add(m); return m; };
    add(toMesh(B.Pn, M.plinth, { cast: false }));
    add(toMesh(B.Wl, wallMat, { cast: true }));
    add(toMesh(B.Rf, roofMat, { cast: true }));
    add(toMesh(B.St, M.steel, { cast: true }));
    add(toMesh(B.Tr, M.trim, { cast: false }));
    add(toMesh(B.Dr, M.roller, {}));
    add(toMesh(B.Ct, M.detail, { cast: true }));
    add(toMesh(B.Dt, M.detail, { soft: true }));
    add(toMesh(B.Lp, M.lamp, { soft: true, receive: false }));
    add(toMesh(B.Gl, M.glass, { receive: false }));
    const dm = new THREE.Mesh(new THREE.BoxGeometry(door.w, door.h, 0.04), M.door);             // the loading door's steel kick panel (measured by the door tests)
    dm.position.set(door.X, door.Y, door.Z);
    dm.userData.v161Door = true; dm.castShadow = false; dm.receiveShadow = true;
    dm.updateMatrix(); dm.matrixAutoUpdate = false;
    group.add(dm);
    const ud = group.userData, gs = o.gs;
    ud.v161Factory = kind; ud.v161Complete = true; ud.v44Detailed = true; ud.v157Finish = true;
    ud.v161Footprint = o.footprint.map((f) => { const r = o.rx(f.u0, f.u1); return { x: (r[0] + r[1]) / 2, z: (f.z0 + f.z1) / 2, hx: (r[1] - r[0]) / 2, hz: (f.z1 - f.z0) / 2 }; });
    ud.v161Dims = dims; dims.chims = o.chims; dims.doorU = door.u;
    ud.levelV161 = L;
    ud.stackTops = o.stackTops.map((t) => new THREE.Vector3(t.x, t.y, t.z));
    return group;
  }


  // ============================================================================================== TECH PARK (stage 13)
  const TP = { y0: 0.12, wallH: 1.5, zf: 0.5, zr: -1.25, u0: -2.1, ua: 1.5, annexU0: -1.0, annexU1: 0.8, annexZ1: 1.5, rise: 0.5 };

  // barrel roof with the ridge along u over [ua, ub] x [zr, zf]: n slices per side; planes -> bt, arched end triangles -> bw
  function barrelRoof(o, ua, ub, zr, zf, yw, rise, oz) {
    const { B } = o, zc = (zr + zf) / 2, hz = (zf - zr) / 2 + oz, N = 5, pts = [];
    for (let i = 0; i <= 2 * N; i++) { const t = (i / N) - 1, z = zc + t * hz, y = yw + rise * (1 - t * t) - (Math.abs(t) > 1 ? 0 : 0); pts.push([z, y]); }
    for (let i = 0; i < 2 * N; i++) { const a = pts[i], b = pts[i + 1], mz = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; o.pq(B.Rf, [ua - 0.08, a[1], a[0]], [ub + 0.08, a[1], a[0]], [ub + 0.08, b[1], b[0]], [ua - 0.08, b[1], b[0]], [0, 1, (mz - zc) / hz * 0.8]); }
    for (const [u, du] of [[ub, 1], [ua, -1]]) for (let i = 0; i < 2 * N; i++) o.pt(B.Wl, [u, yw, zc], [u, pts[i][1], pts[i][0]], [u, pts[i + 1][1], pts[i + 1][0]], [du, 0, 0]);
    return { zc };
  }

  function buildTech(stage, height, baseSize, level) {
    const L = Math.max(1, Math.min(5, Math.floor(level) || 1));
    const M = smats();
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1;
    const pl = padLocal(idx);
    const padSide = pl ? (pl.x >= 0 ? 1 : -1) : 1, gs = -padSide;
    const o = kit(1, gs), { B, ctx, X, bu, bx } = o;
    const { y0, wallH, zf, zr, u0, ua, rise } = TP, yw = y0 + wallH, zc = (zf + zr) / 2;
    const u1 = L >= 2 ? 3.3 : ua;                                                                       // hall A ends at ua, hall B (L2+) to 3.3
    const dims = { k: 1, level: L, gs, padSide, y0, yw, zf, zr, u0, top: 0 };
    const stackTop = (u, z, top, r) => { o.stackTops.push({ x: X(u), y: top + 0.12, z }); o.chims.push({ u, z, top, r1: r, tech: true }); };

    // ---- hall A: steel panel walls on a plinth, dark base band, teal stripe, barrel roof with a rooflight strip, ridge cap
    {
      bu(B.Pn, u0 - 0.06, ua + 0.06, 0, y0, zr - 0.06, zf + 0.06);
      bu(B.Wl, u0, ua, y0, yw, zr, zf);
      bu(B.St, u0 - 0.008, ua + 0.008, y0, y0 + 0.2, zr - 0.012, zf + 0.012);
      bu(B.Dt, u0 - 0.008, ua + 0.008, yw - 0.22, yw - 0.14, zr - 0.012, zf + 0.012, { color: TEAL });
      for (const u of [u0, ua]) for (const z of [zr, zf]) bu(B.Tr, u - 0.05, u + 0.05, y0, yw + 0.02, z - 0.05, z + 0.05);
      barrelRoof(o, u0, ua, zr, zf, yw + 0.02, rise, 0.06);
      // rooflight strip on the crown: glass band + ribs
      bu(B.Gl, u0 + 0.25, ua - 0.25, yw + 0.02 + rise - 0.01, yw + 0.02 + rise + 0.03, zc - 0.22, zc + 0.22);
      for (let i = 0; i <= 6; i++) { const u = u0 + 0.25 + (ua - u0 - 0.5) * i / 6; bu(B.Tr, u - 0.012, u + 0.012, yw + 0.02 + rise - 0.01, yw + 0.02 + rise + 0.045, zc - 0.24, zc + 0.24); }
      o.footprint.push({ u0: u0 - 0.05, u1: ua + 0.05, z0: zr - 0.05, z1: zf + 0.05 });
      // windows strip on the back wall + the pad-side end wall
      for (let i = 0; i < 4; i++) o.at(u0 + 0.5 + i * 0.85, zr, 'b', () => windowLocal(o, 0, y0 + 0.85, 0.5, 0.45));
      o.at(u0, -0.35, 'p', () => windowLocal(o, 0, y0 + 0.85, 0.5, 0.45));
      // front: roller door on the right part (next to the annex) with a hazard apron
      {
        const du = 1.12, dw = 0.62, dh = 0.95;
        bx(B.Dr, du, y0 + dh / 2, zf + 0.025, dw, dh, 0.04);
        for (let r = 1; r < 6; r++) bx(B.Tr, du, y0 + r * dh / 6, zf + 0.05, dw, 0.012, 0.012);
        for (const s of [-1, 1]) bx(B.Dt, du + s * (dw / 2 + 0.04), y0 + dh / 2 + 0.03, zf + 0.04, 0.08, dh + 0.06, 0.08, { color: TEAL });
        bx(B.Dt, du, y0 + dh + 0.05, zf + 0.04, dw + 0.16, 0.08, 0.08, { color: TEAL });
        lamp(o, du, y0 + dh + 0.2, zf, 'f');
        bu(B.Pn, du - dw / 2 - 0.2, du + dw / 2 + 0.2, 0, y0 + 0.01, zf, zf + 0.45);
        for (let i = 0; i < 7; i++) { const u = du - dw / 2 - 0.2 + (i + 0.5) * (dw + 0.4) / 7; bx(B.Dt, u, y0 + 0.014, zf + 0.42, (dw + 0.4) / 7 + 0.001, 0.008, 0.06, { color: i % 2 ? DARK : YELLOW }); }
      }
      o.at(u0 + 0.5, zf, 'f', () => { windowLocal(o, 0, y0 + 0.85, 0.5, 0.5); });
    }
    // ---- glass office annex in front of hall A: curtain wall with steel mullions, white slab roof with a teal edge, entrance door (the door mesh the tests measure)
    {
      const a0 = TP.annexU0, a1 = TP.annexU1, z0 = zf, z1 = TP.annexZ1, ah = L >= 3 ? 2.2 : 1.3, ya = y0 + ah;
      bu(B.Pn, a0 - 0.06, a1 + 0.06, 0, y0, z0, z1 + 0.06);
      bu(B.Ct, a0 + 0.05, a1 - 0.05, y0, ya, z0, z1 - 0.045, { color: 0x3e5668 });                                     // dark interior volume behind the glass (solid: the collider covers it)
      const storeys = L >= 3 ? 2 : 1, sh = (ah - 0.0) / storeys;
      for (let s = 0; s < storeys; s++) {
        const yb = y0 + s * sh + (s ? 0.1 : 0.0), yt = y0 + (s + 1) * sh - 0.1;
        bu(B.Gl, a0 + 0.04, a1 - 0.04, yb + 0.12, yt, z1 - 0.012, z1);                                              // front glass
        for (const u of [a0, a1]) bu(B.Gl, u - 0.006, u + 0.006, yb + 0.12, yt, z0, z1);                           // side glass
        const nm = Math.max(3, Math.round((a1 - a0) / 0.33));
        for (let i = 0; i <= nm; i++) { const u = a0 + (a1 - a0) * i / nm; bu(B.St, u - 0.014, u + 0.014, yb + 0.1, yt + 0.02, z1 - 0.03, z1 + 0.012); }
        bu(B.Tr, a0 - 0.02, a1 + 0.02, yt, yt + 0.1, z0, z1 + 0.04);                                                // floor / roof slab
        bu(B.Dt, a0 - 0.02, a1 + 0.02, yb, yb + 0.12, z1 - 0.01, z1 + 0.03, { color: s ? TEAL : DARK });            // spandrel
        for (const u of [a0, a1]) bu(B.St, u - 0.03, u + 0.03, yb + 0.1, yt + 0.02, z1 - 0.03, z1 + 0.03);
      }
      bu(B.Dt, a0 - 0.03, a1 + 0.03, ya + 0.0, ya + 0.12, z0 - 0.0, z1 + 0.06, { color: WHITE });                      // roof slab (white) over the last storey
      bu(B.Dt, a0 - 0.03, a1 + 0.03, ya + 0.1, ya + 0.14, z1 + 0.03, z1 + 0.06, { color: TEAL });
      // entrance: glass door + sidelights, steel frame, canopy plate; the kick plate is userData.v161Door
      {
        const eu = (a0 + a1) / 2 - 0.0, w = 0.62;
        bx(B.St, eu, y0 + 0.5, z1 + 0.015, w + 0.12, 1.0, 0.03);
        bx(B.Gl, eu, y0 + 0.62, z1 + 0.034, w - 0.04, 0.82, 0.012);
        bx(B.St, eu, y0 + 0.62, z1 + 0.045, 0.02, 0.82, 0.02);
        bx(B.St, eu, y0 + 1.06, z1 + 0.2, w + 0.5, 0.04, 0.4);
        bx(B.Dt, eu, y0 + 1.06, z1 + 0.4, w + 0.5, 0.05, 0.02, { color: TEAL });
        for (const s of [-1, 1]) bx(B.St, eu + s * (w / 2 + 0.22), y0 + 0.53, z1 + 0.38, 0.03, 1.06, 0.03);
        bx(B.Lp, eu, y0 + 1.02, z1 + 0.25, 0.1, 0.02, 0.1);
        var doorX = X(eu), doorY = y0 + 0.1, doorZ = z1 + 0.04;
      }
      for (let i = 0; i < L; i++) bu(B.Dt, a0 + 0.12 + i * 0.1, a0 + 0.17 + i * 0.1, ya + 0.14, ya + 0.19, z1 + 0.0, z1 + 0.04, { color: YELLOW });     // level pips on the roof edge
      o.footprint.push({ u0: a0 - 0.02, u1: a1 + 0.02, z0: z0, z1: z1 + 0.04 });
      dims.annex = { u0: a0, u1: a1, ya, z1 };
    }
    // ---- tall steel stack behind hall A (red / white bands) + a small boiler house at its foot
    {
      const su = 1.0, sz = zr - 0.4, top = 3.3, r0 = 0.2, r1 = 0.15;
      bu(B.Pn, su - 0.34, su + 0.34, 0, y0, sz - 0.34, sz + 0.34);
      cyl(B.Ct, ctx, X(su), y0, sz, r0, r1, top - y0, 12, { color: 0xd9dde1 });
      for (let i = 0; i < 3; i++) { const t0 = 0.55 + i * 0.15, rr = r0 + (r1 - r0) * t0 + 0.01; cyl(B.Ct, ctx, X(su), y0 + (top - y0) * t0, sz, rr, rr, (top - y0) * 0.07, 12, { color: i % 2 ? 0xd9dde1 : RED }); }
      cyl(B.Ct, ctx, X(su), top - 0.1, sz, r1 + 0.04, r1 + 0.05, 0.11, 12, { color: 0x3a3f46 }); disc(B.Ct, ctx, X(su), sz, 0, r1 + 0.02, top + 0.013, 12, { color: 0x1c2024 });
      for (const a of [0, 2.1, 4.2]) bu(B.St, su + Math.cos(a) * 0.0 - 0.01, su + 0.01, y0 + 0.3, y0 + 1.3, sz + (a === 0 ? 0.22 : -0.22) - 0.01, sz + (a === 0 ? 0.22 : -0.22) + 0.01);
      stackTop(su, sz, top, r1);
      dims.stackTop = top;
      o.footprint.push({ u0: su - 0.25, u1: su + 0.25, z0: sz - 0.25, z1: sz + 0.25 });
    }
    // ---- level 2: hall B (sawtooth steel with north lights) on the far end, side roller door with a ramp
    if (L >= 2) {
      const bu0 = ua, bu1 = 3.3, p = 0.9, n = 2, bh = 1.35, ybw = y0 + bh, bzr = zr + 0.1, bzf = zf - 0.1;
      bu(B.Pn, bu0 - 0.02, bu1 + 0.06, 0, y0, bzr - 0.06, bzf + 0.06);
      bu(B.Wl, bu0, bu1, y0, ybw, bzr, bzf);
      bu(B.St, bu0, bu1 + 0.008, y0, y0 + 0.2, bzr - 0.012, bzf + 0.012);
      bu(B.Dt, bu0, bu1 + 0.008, ybw - 0.2, ybw - 0.13, bzr - 0.012, bzf + 0.012, { color: TEAL });
      bu(B.Tr, bu0 - 0.02, bu1 + 0.04, ybw - 0.02, ybw + 0.04, bzr - 0.04, bzf + 0.04);
      sawtooth(o, bu0, n, p * (bu1 - bu0) / (n * p), bzr, bzf, ybw + 0.04, 0.5, 0.06);
      for (let i = 0; i < n; i++) o.at(bu0 + (i + 0.5) * (bu1 - bu0) / n, bzf, 'f', () => windowLocal(o, 0, y0 + 0.8, 0.5, 0.45));
      for (let i = 0; i < n; i++) o.at(bu0 + (i + 0.5) * (bu1 - bu0) / n, bzr, 'b', () => windowLocal(o, 0, y0 + 0.8, 0.5, 0.45));
      const sz = -0.35, dw2 = 0.75, dh2 = 0.98;
      o.at(bu1, sz, 'e', () => {
        box(B.Dr, ctx, 0, y0 + dh2 / 2, 0.025, dw2, dh2, 0.04);
        for (let r = 1; r < 6; r++) box(B.Tr, ctx, 0, y0 + r * dh2 / 6, 0.05, dw2, 0.012, 0.012);
        for (const s of [-1, 1]) box(B.Dt, ctx, s * (dw2 / 2 + 0.045), y0 + dh2 / 2 + 0.03, 0.04, 0.09, dh2 + 0.06, 0.08, { color: TEAL });
        box(B.Dt, ctx, 0, y0 + dh2 + 0.05, 0.04, dw2 + 0.2, 0.09, 0.08, { color: TEAL });
      });
      o.footprint.push({ u0: bu0, u1: bu1 + 0.05, z0: bzr - 0.05, z1: bzf + 0.05 });
      dims.hallB = { u1: bu1 };
    }
    // ---- level 3: cooling tower with a steam plume + pipe rack from the tower to hall A
    if (L >= 3) {
      const cu = 2.15, cz = -1.95, rb = 0.62, rw = 0.45, rt = 0.54, ch = 2.0;
      const ring = (yb, h, ra, rb2, col) => cyl(B.Ct, ctx, X(cu), yb, cz, ra, rb2, h, 16, { color: col });
      ring(y0, ch * 0.5, rb, rw, 0xc6ccd2); ring(y0 + ch * 0.5, ch * 0.5, rw, rt, 0xc6ccd2);
      cyl(B.Ct, ctx, X(cu), y0 + ch - 0.04, cz, rt + 0.03, rt + 0.03, 0.08, 16, { color: 0x4a525b });
      disc(B.Ct, ctx, X(cu), cz, 0, rt + 0.0, y0 + ch + 0.045, 16, { color: 0x20282f });
      for (let i = 0; i < 4; i++) cyl(B.Ct, ctx, X(cu), y0 + ch * (0.12 + i * 0.2), cz, rb - (rb - rw) * Math.min(1, (0.12 + i * 0.2) * 2) + 0.012, rb - (rb - rw) * Math.min(1, (0.12 + i * 0.2) * 2) + 0.012, 0.03, 16, { color: 0x8c96a0 });
      stackTop(cu, cz, y0 + ch, rt);
      // pipe rack: two pipes (teal / grey) on posts from the tower to the back wall of hall A
      const pz = zr - 0.2;
      o.tubeU(B.Ct, 1.2, cu - rt * 0.8, y0 + 0.62, pz, 0.06, 8, { color: TEAL });
      o.tubeU(B.Ct, 1.2, cu - rt * 0.8, y0 + 0.82, pz, 0.045, 8, { color: 0x8c96a0 });
      for (const u of [1.45, 1.8]) { bx(B.St, u, (y0 + 0.62) / 2, pz, 0.04, y0 + 0.62, 0.04); }
      o.tubeZ(B.Ct, 1.2, y0 + 0.62, pz, zr - 0.0, 0.06, 8, { color: TEAL });
      o.footprint.push({ u0: cu - rb - 0.02, u1: cu + rb + 0.02, z0: cz - rb - 0.02, z1: cz + rb + 0.02 });
      dims.cool = { u: cu, z: cz, top: y0 + ch };
    }
    // ---- level 4: gantry portal over the east yard (two legs, a beam, a trolley with a hook) + a second, taller stack
    if (L >= 4) {
      const gu = 3.95, gz0 = -1.0, gz1 = 0.7, gy = 2.0;
      for (const z of [gz0, gz1]) { bx(B.St, gu, gy / 2, z, 0.08, gy, 0.08); bx(B.St, gu + 0.2, gy / 2, z, 0.05, gy, 0.05); bx(B.St, gu - 0.2, gy / 2, z, 0.05, gy, 0.05); bu(B.St, gu - 0.2, gu + 0.2, gy * 0.5, gy * 0.5 + 0.03, z - 0.02, z + 0.02); }
      bu(B.Dt, gu - 0.07, gu + 0.07, gy, gy + 0.12, gz0 - 0.08, gz1 + 0.08, { color: YELLOW });                       // beam
      bu(B.St, gu - 0.05, gu + 0.05, gy - 0.06, gy, 0.0, 0.18);                                                         // trolley
      bx(B.St, gu, gy - 0.5, 0.09, 0.012, 0.9, 0.012); bx(B.Dt, gu, gy - 0.98, 0.09, 0.09, 0.07, 0.09, { color: DARK });   // cable + hook
      // container under the gantry (neutral, solid)
      bu(B.Ct, gu - 0.3, gu + 0.3, y0, y0 + 0.42, -0.25, 0.6, { color: 0x2f6fb0 });
      o.footprint.push({ u0: gu - 0.3, u1: gu + 0.3, z0: -0.25, z1: 0.6 });
      const su = 0.5, sz = zr - 0.4, top = 3.65;
      cyl(B.Ct, ctx, X(su), y0, sz, 0.17, 0.13, top - y0, 12, { color: 0xd9dde1 });
      for (let i = 0; i < 2; i++) { cyl(B.Ct, ctx, X(su), top - 0.55 - i * 0.3, sz, 0.145 - i * 0.002, 0.145 - i * 0.002, 0.14, 12, { color: i ? 0xd9dde1 : RED }); }
      cyl(B.Ct, ctx, X(su), top - 0.1, sz, 0.17, 0.18, 0.11, 12, { color: 0x3a3f46 }); disc(B.Ct, ctx, X(su), sz, 0, 0.14, top + 0.013, 12, { color: 0x1c2024 });
      stackTop(su, sz, top, 0.13); dims.stackTop = top;
      o.footprint.push({ u0: su - 0.2, u1: su + 0.2, z0: sz - 0.2, z1: sz + 0.2 });
    }
    // ---- level 5: hall C behind hall A (flat roof with solar panels), name board + beacon on the annex roof
    if (L >= 5) {
      const cu0 = u0 + 0.4, cu1 = 1.2, czf = zr - 0.9, czr = zr - 2.3, ch2 = 1.2, yc = y0 + ch2;
      bu(B.Pn, cu0 - 0.06, cu1 + 0.06, 0, y0, czr - 0.06, czf + 0.06);
      bu(B.Wl, cu0, cu1, y0, yc, czr, czf);
      bu(B.St, cu0, cu1, y0, y0 + 0.2, czr - 0.012, czf + 0.012);
      bu(B.Dt, cu0, cu1, yc - 0.2, yc - 0.13, czr - 0.012, czf + 0.012, { color: TEAL });
      bu(B.Tr, cu0 - 0.03, cu1 + 0.03, yc, yc + 0.07, czr - 0.03, czf + 0.03);
      bu(B.Dt, cu0 + 0.04, cu1 - 0.04, yc + 0.07, yc + 0.09, czr + 0.04, czf - 0.04, { color: 0x3b4048 });
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const pu = cu0 + 0.14 + i * 0.5; ctx.at(X(pu + 0.2), yc + 0.12, czr + 0.35 + j * 0.6, 0, () => box(B.Dt, ctx, 0, 0, 0, 0.42, 0.03, 0.5, { color: 0x24405e, rx: -0.35 })); }
      for (let i = 0; i < 3; i++) o.at(cu0 + 0.4 + i * 0.7, czr, 'b', () => windowLocal(o, 0, y0 + 0.62, 0.45, 0.4));
      o.footprint.push({ u0: cu0 - 0.05, u1: cu1 + 0.05, z0: czr - 0.05, z1: czf + 0.05 });
      dims.hallC = { czr };
      // name board on the annex roof: navy board with white bars on two posts, a beacon
      const a0 = TP.annexU0, a1 = TP.annexU1, ya = dims.annex.ya, bz = TP.annexZ1 - 0.15;
      bu(B.Dt, a0 + 0.12, a1 - 0.12, ya + 0.12, ya + 0.46, bz - 0.02, bz + 0.02, { color: NAVY });
      bu(B.Dt, a0 + 0.12, a1 - 0.12, ya + 0.12, ya + 0.145, bz + 0.02, bz + 0.035, { color: TEAL });
      let lu = a0 + 0.3; const ws = [0.09, 0.06, 0.11, 0.06, 0.09, 0.1, 0.06, 0.11, 0.06]; for (let i = 0; i < ws.length; i++) { const w = ws[i], hh = i % 3 === 1 ? 0.12 : 0.18; if (i === 5) lu += 0.12; if (lu + w > a1 - 0.25) break; bu(B.Dt, lu, lu + w, ya + 0.3 - hh / 2, ya + 0.3 + hh / 2, bz + 0.02, bz + 0.034, { color: WHITE }); lu += w + 0.05; }
      for (const u of [a0 + 0.2, a1 - 0.2]) bx(B.St, u, ya + 0.3, bz - 0.04, 0.03, 0.4, 0.03);
      bx(B.St, (a0 + a1) / 2, ya + 0.62, bz - 0.04, 0.03, 0.3, 0.03); bx(B.Lp, (a0 + a1) / 2, ya + 0.8, bz - 0.04, 0.07, 0.07, 0.07);
      dims.beacon = { y: ya + 0.8 };
    }
    dims.top = Math.max(dims.stackTop || 0, dims.cool ? dims.cool.top : 0);
    return assemble(o, M, M.panel, M.roofT, 'techParkV161', 'tech', dims, { X: doorX, Y: doorY, Z: doorZ, w: 0.5, h: 0.2, u: (TP.annexU0 + TP.annexU1) / 2 }, L);
  }

  function buildFactoryV161(stage, height, baseSize, level = 1) {
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1;
    if (idx === 13 && typeof buildTech === 'function') return buildTech(stage, height, baseSize, level);
    return buildBrick(stage, height, baseSize, level);
  }


  // ============================================================================================== gold tiers 6-10
  function addGold(group, stage, level) {
    const d = group.userData.v161Dims, M = smats(), kind = group.userData.v161Factory;
    if (!d) return false;
    const o = kit(1, d.gs), { B, ctx, X, bu, bx } = o, bt = B.Tr, gs = d.gs;
    const tech = kind === 'tech';
    const front = tech ? TP.annexZ1 : d.zf;
    const du = d.doorU, y0 = d.y0;
    let maxY = 0;                                                                                          // highest gold point of the tiers below the crown: the crown always stands >= 0.22 m above it
    const crown = (cx, cy, cz) => {                                                                       // pedestal, rim band, 8 points + a taller middle point
      const ex = Math.max(0, maxY + 0.22 - (cy + 0.91));
      box(bt, ctx, cx, cy + (0.17 + ex) / 2 + 0.0, cz, 0.42, 0.34 + ex, 0.42); cy += ex; box(bt, ctx, cx, cy + 0.38, cz, 0.56, 0.07, 0.56);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 0.2 : 0.23; cone(bt, ctx, cx + Math.cos(a) * r, cy + 0.41, cz + Math.sin(a) * r, 0.06, i % 2 ? 0.2 : 0.34, 6); }
      cone(bt, ctx, cx, cy + 0.41, cz, 0.13, 0.5, 8);
    };
    const flag = (px, pz, py, h) => {
      maxY = Math.max(maxY, py + h + 0.12);
      box(bt, ctx, px, py + h / 2, pz, 0.03, h, 0.03); cone(bt, ctx, px, py + h, pz, 0.045, 0.12, 6);
      quad(bt, ctx, [px, py + h - 0.06, pz], [px + gs * 0.3, py + h - 0.12, pz], [px + gs * 0.3, py + h - 0.3, pz], [px, py + h - 0.24, pz]);
      quad(bt, ctx, [px, py + h - 0.24, pz], [px + gs * 0.3, py + h - 0.3, pz], [px + gs * 0.3, py + h - 0.12, pz], [px, py + h - 0.06, pz]);
    };
    const ring = (c, y, dr = 0.02, hh = 0.045) => { const r = c.r0 ? c.r0 + (c.r1 - c.r0) * Math.max(0, Math.min(1, (y - c.yb) / (c.top - c.yb))) : c.r1; cyl(bt, ctx, X(c.u), y, c.z, r + dr, r + dr, hh, 14); maxY = Math.max(maxY, y + hh); };
    if (!tech) {
      const { u0, u1, yw, zf, zr, pitch, th, n } = d;
      // 6: gold cornice line along the front + rings on the chimney tops + a second pip row
      bu(bt, u0 - 0.03, u1 + 0.03, yw - 0.145, yw - 0.125, zf + 0.052, zf + 0.062);
      for (const c of d.chims) ring(c, yw + 0.3, 0.06, 0.05);
      for (let i = 0; i < level - 5; i++) bx(bt, u0 + 0.2 + i * 0.11, yw - 0.13 - 0.07, zf + 0.06, 0.05, 0.05, 0.012);
      // 7: gold frames on the loading door + gold roof-ridge strips on every north-light peak + gold bands on the chimneys
      if (level >= 7) {
        const dw = CFG[d.n && d.zf > 1.3 ? 5 : 4].door.w, dh = CFG[d.zf > 1.3 ? 5 : 4].door.h;
        bu(bt, du - dw / 2 - 0.1, du + dw / 2 + 0.1, y0 + dh + 0.095, y0 + dh + 0.12, zf + 0.075, zf + 0.095);
        for (const s of [-1, 1]) bu(bt, du + s * (dw / 2 + 0.045) - 0.012, du + s * (dw / 2 + 0.045) + 0.012, y0, y0 + dh + 0.12, zf + 0.075, zf + 0.095);
        for (let i = 0; i < n; i++) bu(bt, u0 + (i + 1) * pitch - 0.01, u0 + (i + 1) * pitch + 0.05, yw + 0.03 + th + 0.01, yw + 0.03 + th + 0.05, zr - 0.06, zf + 0.07);
        for (const c of d.chims) { const r = c.r0 + (c.r1 - c.r0) * 0.15 + 0.03; cyl(bt, ctx, X(c.u), c.yb + 0.6, c.z, r, r, 0.03, 14); maxY = Math.max(maxY, c.yb + 0.63); }
      }
      // 8: gold base line on the plinth + gold rim on the loading canopy and corner pilasters' caps
      if (level >= 8) {
        bu(bt, u0 - 0.06, u1 + 0.06, y0 - 0.0, y0 + 0.03, zf + 0.06, zf + 0.075);
        bu(bt, du - 0.7, du + 0.7, y0 + 1.0 + 0.24, y0 + 1.0 + 0.27, zf + 0.5, zf + 0.53);
        for (let i = 0; i <= n; i++) bu(bt, u0 + i * pitch - 0.085, u0 + i * pitch + 0.085, yw - 0.14, yw - 0.115, zf, zf + 0.06);
      }
      // 9 + 10: flag + crown on the annex roof (the gold tiers use the level-5 silhouette, so the annex exists)
      if (d.annex) {
        const a = d.annex;
        if (level >= 9) flag(X(a.u1 - 0.18), a.z0 + 0.2, a.ya + 0.12, 0.55);
        if (level >= 10) crown(X((a.u0 + a.u1) / 2 + 0.05), a.ya + 0.12, (a.z0 + a.z1) / 2 + 0.1);
      }
    } else {
      const { u0, yw, annex } = d, a0 = TP.annexU0, a1 = TP.annexU1, ya = annex.ya, z1 = annex.z1;
      // 6: gold line on the annex roof edge + rings on the stacks + a second pip row
      bu(bt, a0 - 0.03, a1 + 0.03, ya + 0.12, ya + 0.15, z1 + 0.055, z1 + 0.07);
      for (const c of d.chims) if (!c.tech || c.r1 < 0.2) ring(c, yw + 0.35, 0.035, 0.04);
      for (let i = 0; i < level - 5; i++) bu(bt, a0 + 0.12 + i * 0.1, a0 + 0.17 + i * 0.1, ya + 0.2, ya + 0.25, z1 + 0.0, z1 + 0.04);
      // 7: gold frame on the glass entrance + gold line along hall A's front eave
      if (level >= 7) {
        const eu = (a0 + a1) / 2, w = 0.62;
        bu(bt, eu - w / 2 - 0.09, eu + w / 2 + 0.09, y0 + 1.04, y0 + 1.07, z1 + 0.035, z1 + 0.055);
        for (const s of [-1, 1]) bu(bt, eu + s * (w / 2 + 0.06) - 0.012, eu + s * (w / 2 + 0.06) + 0.012, y0, y0 + 1.07, z1 + 0.035, z1 + 0.055);
        bu(bt, u0 - 0.01, TP.ua + 0.01, yw - 0.145, yw - 0.125, TP.zf + 0.014, TP.zf + 0.03);
      }
      // 8: gold spandrel stripe on the annex + gold crest on the barrel-roof ridge cap
      if (level >= 8) {
        bu(bt, a0 - 0.03, a1 + 0.03, y0 + (ya - y0) / (d.level >= 3 ? 2 : 1) - 0.04, y0 + (ya - y0) / (d.level >= 3 ? 2 : 1) - 0.01, z1 - 0.0, z1 + 0.05);
        bu(bt, u0 + 0.2, TP.ua - 0.2, yw + 0.02 + TP.rise + 0.03, yw + 0.02 + TP.rise + 0.06, (TP.zr + TP.zf) / 2 - 0.3, (TP.zr + TP.zf) / 2 - 0.26);
      }
      if (level >= 9) flag(X(a1 - 0.2), z1 - 0.45, ya + 0.12, 0.4);
      if (level >= 10) crown(X((u0 + TP.ua) / 2 - 0.2), yw + 0.02 + TP.rise + 0.03, (TP.zr + TP.zf) / 2);
    }
    const mesh = toMesh(bt, M.gold, { cast: true, soft: true, name: 'factoryGoldV161' });
    if (mesh) group.add(mesh);
    group.userData.goldTierV161 = level;
    return true;
  }


  // ============================================================================================== FLEET YARD (backlog #8)
  // rebuildParkingV65 (tycoon-v161.html) keeps the lot slab and the road throat and calls FleetYardV161.build(group, {OX, homes, label}) instead of the old 40 loose fence / post / bay meshes (<= 9 merged meshes).
  // The driving yard stays where it was (lot x -46.66..-34.74, z 4.86..8.68); the service building now extends behind it to z 10.62. Trucks drive in from the service lane z = 4.45 straight into their six bays across the whole front, so the front is the open "mouth" of the
  // yard and nothing solid stands on a truck line); the fence now closes the west, east and rear sides and is solid, the rear strip behind the truck tails holds the service garage (3 roller doors), the guard /
  // dispatcher booth, a fuel pump and a wash stand; front corner pillars carry floodlights; an entrance sign stands on a T-post between the lift and concrete bays. All lines on the slab are decals of the
  // yard mesh (no road meshes). Everything is neutral (no stock).
  // The service garage used to be only 0.74u deep, while a service truck is about
  // 2.20u long.  Keep the doors and manoeuvring lane in their original positions,
  // but extend the building behind the yard so a truck can physically fit inside.
  const FLEET = { lotTop: 0.069, hw: 5.86, zFront: 4.98, zRear: 8.68, gz0: 7.92, gz1: 10.62 };
  // Canonical public bounds for later placement/road/audit layers. Keeping these values in one
  // descriptor prevents a visual garage resize from leaving the old 9.0u keep-out rectangle behind.
  window.__TYCOON_FLEET_BOUNDS_V161__ = Object.freeze({
    lotMinZ: 4.86,
    lotMaxZ: FLEET.zRear,
    garageMinZ: FLEET.gz0,
    garageMaxZ: FLEET.gz1,
    halfWidth: FLEET.hw + 0.32
  });
  let FM = null;
  function fleetMats() {
    if (FM) return FM;
    const M = smats(), share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    FM = { lamp: share(new THREE.MeshStandardMaterial({ color: lin(0xfff0c8), emissive: lin(0xffc860), emissiveIntensity: 0.4, roughness: 0.4 })),
      beacon: share(new THREE.MeshStandardMaterial({ color: lin(0xffb030), emissive: lin(0xff8a00), emissiveIntensity: 0.3, roughness: 0.4 })) };
    return FM;
  }
  function buildFleetYard(g, p) {
    const M = smats(), FMat = fleetMats(), o = kit(1, 1), { B, ctx, bu, bx } = o;
    const { lotTop, hw, zFront, zRear, gz0, gz1 } = FLEET;
    const cx = -8.70 + p.OX, xW = cx - hw, xE = cx + hw, obs = [];
    const Lf = batch(), A = { Pn: batch(), Wl: batch(), Tr: batch(), Dt: batch(true), Gl: batch(), Bn: batch() };    // A = the rear amenities (booth, fuel pump, wash stand): their own meshes, hidden while the base garage stands there
    const ob = (label, x0, x1, z0, z1) => obs.push({ label, pos: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2), hx: Math.abs(x1 - x0) / 2, hz: Math.abs(z1 - z0) / 2, yaw: 0 });
    const post = (x, z, h = 1.12) => { bx(B.St, x, h / 2, z, 0.07, h, 0.07); bx(B.Dt, x, h + 0.015, z, 0.1, 0.03, 0.1, { color: 0x3a4048 }); };
    // welded-mesh fence run: ax 'x' = along x at z = c, 'z' = along z at x = c; rails top / middle / bottom, pickets every 0.16 m, posts every <= 1.25 m
    const fence = (ax, c, a0, a1, label) => {
      const len = a1 - a0, mid = (a0 + a1) / 2, n = Math.max(1, Math.ceil(len / 1.25)), pn = Math.floor(len / 0.16);
      for (const y of [1.03, 0.56, 0.1]) { if (ax === 'x') bx(B.St, mid, y, c, len, 0.032, 0.032); else bx(B.St, c, y, mid, 0.032, 0.032, len); }
      for (let i = 0; i <= pn; i++) { const t = a0 + 0.08 + (len - 0.16) * i / Math.max(1, pn); if (ax === 'x') bx(B.St, t, 0.57, c, 0.014, 0.92, 0.014); else bx(B.St, c, 0.57, t, 0.014, 0.92, 0.014); }
      for (let i = 0; i <= n; i++) { const t = a0 + len * i / n; if (ax === 'x') post(t, c); else post(c, t); }
      if (ax === 'x') ob(label, a0, a1, c - 0.08, c + 0.08); else ob(label, c - 0.08, c + 0.08, a0, a1);
    };
    const boothX0 = cx + 0.65, boothX1 = cx + 2.25;
    // ---- sides + rear fence (solid)
    fence('z', xW, zFront + 0.12, zRear, 'fleet:fenceW');
    fence('z', xE, zFront + 0.12, zRear, 'fleet:fenceE');
    fence('x', zRear, boothX1, xE, 'fleet:fenceR');
    // (the rear run west of the booth is the service garage's back wall now: a fence at z 8.68 would cross its bays)
    // ---- front corner pillars = floodlight masts (concrete base with hazard stripes, steel pole, lamp bar)
    for (const [x, sgn] of [[xW, 1], [xE, -1]]) {
      bx(B.Pn, x, 0.5, zFront, 0.34, 1.0, 0.34); bx(B.Pn, x, 1.03, zFront, 0.42, 0.06, 0.42);
      for (let i = 0; i < 4; i++) bx(B.Dt, x, 0.1 + i * 0.2, zFront, 0.352, 0.1, 0.352, { color: i % 2 ? 0x2b2f36 : 0xf2b522 });
      cyl(B.St, ctx, x, 1.06, zFront, 0.05, 0.035, 1.5, 6);
      bx(B.St, x + sgn * 0.12, 2.56, zFront, 0.34, 0.035, 0.05);
      for (const q of [0, 1, 2]) { bx(B.Dt, x + sgn * (0.02 + q * 0.12), 2.62, zFront, 0.1, 0.07, 0.07, { color: 0x2b2f36 }); bx(Lf, x + sgn * (0.02 + q * 0.12), 2.62, zFront + 0.04, 0.08, 0.05, 0.02); }
      ob('fleet:pillar', x - 0.19, x + 0.19, zFront - 0.19, zFront + 0.19);
    }
    // ---- rear strip: service garage (3 roller-door bays aligned with the first three homes), flat roof with a canopy, lamps
    // 2026-10-06 (11) v2: the user deepened it to z 10.62 (FLEET.gz1) so a truck fits - but the block was SOLID (painted doors on a full wall box): nothing could stand inside. Now the three bays are hollow:
    // opening 1.60 x 1.52 m (truck 1.15 x 1.28 x 2.11 + 0.22 m under the lintel), 2.5 m deep (0.19 m spare at the door and at the back wall), walls 0.10 m; the colliders are the real walls
    // (back, both ends, four piers between the openings). The lot's rear fence run that used to cross this corner is gone - the garage closes it.
    {
      const gx0 = xW - 0.03, gx1 = cx + 0.5, h = 1.8, oz = 0.22, t = 0.10, hOpen = 1.62, fl = 0.1;
      const doorW = 1.60; // 1.15 m truck body + 0.22 m on each side
      const doors = [p.homes[0].x, p.homes[1].x, p.homes[2].x];
      bx(B.Pn, (gx0 + gx1) / 2, 0.05, (gz0 + gz1) / 2, gx1 - gx0 + 0.08, 0.1, gz1 - gz0 + 0.06);                       // floor slab
      for (const dx of doors) bu(B.Dt, dx - doorW / 2, dx + doorW / 2, fl, fl + 0.004, gz0 + t, gz1 - t, { color: 0x4a525b });  // darker bay floors
      // walls: back, west + east end, piers between the openings, lintel band over all of them
      bu(B.Wl, gx0, gx1, fl, h, gz1 - t, gz1);
      bu(B.Wl, gx0, gx0 + t, fl, h, gz0, gz1); bu(B.Wl, gx1 - t, gx1, fl, h, gz0, gz1);
      const edges = [gx0]; for (const dx of doors) edges.push(dx - doorW / 2, dx + doorW / 2); edges.push(gx1);
      const piers = []; for (let i = 0; i < edges.length; i += 2) piers.push([edges[i], edges[i + 1]]);
      for (const [x0, x1] of piers) bu(B.Wl, x0, x1, fl, hOpen, gz0, gz0 + t);
      bu(B.Wl, gx0, gx1, hOpen, h, gz0, gz0 + t);
      bu(B.Dt, gx0, gx1, fl, 0.3, gz0 - 0.012, gz0 + 0.0, { color: 0x4a525b });
      bu(B.Tr, gx0 - 0.04, gx1 + 0.04, h - 0.1, h + 0.04, gz0 - 0.04, gz1 + 0.04);
      o.pq(B.Rf, [gx0 - 0.04, h + 0.04, gz0 - oz], [gx1 + 0.04, h + 0.04, gz0 - oz], [gx1 + 0.04, h + 0.1, gz1], [gx0 - 0.04, h + 0.1, gz1], [0, 1, -0.1]);
      bu(B.Dt, gx0 - 0.04, gx1 + 0.04, h - 0.02, h + 0.06, gz0 - oz - 0.012, gz0 - oz + 0.012, { color: BLUE });
      bu(B.Dt, gx0 - 0.04, gx1 + 0.04, h + 0.06, h + 0.075, gz0 - oz - 0.012, gz0 - oz + 0.012, { color: ORANGE });
      doors.forEach((dx, i) => {
        for (let r = 0; r < 3; r++) bx(B.Tr, dx, hOpen - 0.05 - r * 0.045, gz0 + t / 2, doorW - 0.04, 0.025, t + 0.02);               // the rolled-up shutter drum under the lintel
        for (const sg of [-1, 1]) bx(B.Dt, dx + sg * (doorW / 2 + 0.03), fl + (hOpen - fl) / 2, gz0 - 0.02, 0.06, hOpen - fl, 0.05, { color: ORANGE });
        bx(B.Dt, dx, hOpen + 0.03, gz0 - 0.02, doorW + 0.12, 0.06, 0.05, { color: ORANGE });
        for (let k2 = 0; k2 <= i; k2++) bx(B.Dt, dx - i * 0.045 + k2 * 0.09, (hOpen + h) / 2, gz0 - 0.06, 0.055, 0.055, 0.012, { color: YELLOW });
        bx(Lf, dx, h - 0.16, (gz0 + gz1) / 2, 0.16, 0.04, 1.4);                                                                       // ceiling lamp bar over each bay
      });
      ob('fleet:garage back', gx0, gx1, gz1 - t, gz1); ob('fleet:garage west', gx0, gx0 + t, gz0, gz1); ob('fleet:garage east', gx1 - t, gx1, gz0, gz1);
      piers.forEach(([x0, x1], i) => ob('fleet:garage pier' + i, x0, x1, gz0, gz0 + t));
      p.garage = { x0: gx0, x1: gx1, h, doorW, hOpen, bays: doors.slice(), interior: [gz0 + t, gz1 - t] };
    }
    // ---- guard / dispatcher booth: windows all round on the front, door on the left, flat roof with an overhang and a beacon
    {
      const bz0 = 7.88, bz1 = 8.66, h = 1.5, x0 = boothX0, x1 = boothX1;
      bx(A.Pn, (x0 + x1) / 2, 0.05, (bz0 + bz1) / 2, x1 - x0 + 0.08, 0.1, bz1 - bz0 + 0.06);
      bu(A.Wl, x0, x1, 0.1, h, bz0, bz1);
      bu(A.Tr, x0 - 0.1, x1 + 0.04, h, h + 0.07, bz0 - 0.16, bz1 + 0.05);
      bu(A.Dt, x0 - 0.1, x1 + 0.04, h + 0.0, h + 0.07, bz0 - 0.16 - 0.012, bz0 - 0.16 + 0.012, { color: BLUE });
      // front: window band (glass over a dark interior so the box is solid + readable) and the door
      bu(A.Dt, x0 + 0.05, x1 - 0.05, 0.62, 1.38, bz0 - 0.016, bz0 + 0.0, { color: 0x2f4352 });
      bu(A.Gl, x0 + 0.05, x1 - 0.05, 0.62, 1.38, bz0 - 0.03, bz0 - 0.016);
      for (let i = 0; i <= 4; i++) { const x = x0 + 0.05 + (x1 - x0 - 0.1) * i / 4; bu(A.Tr, x - 0.015, x + 0.015, 0.6, 1.4, bz0 - 0.05, bz0 - 0.03); }
      bu(A.Tr, x0 + 0.03, x1 - 0.03, 0.58, 0.64, bz0 - 0.08, bz0 - 0.03); bu(A.Tr, x0 + 0.03, x1 - 0.03, 1.38, 1.42, bz0 - 0.05, bz0 - 0.03);
      bx(A.Dt, x0 + 0.38, 0.1 + 0.4, bz0 - 0.03, 0.4, 0.8, 0.04, { color: 0x3d5f86 });               // door (left), steel blue
      bx(A.Dt, x0 + 0.38, 0.52, bz0 - 0.055, 0.26, 0.4, 0.012, { color: 0x9fd0e8 });
      bu(A.Pn, x0 + 0.1, x0 + 0.66, 0, 0.1, bz0 - 0.3, bz0 - 0.03);                                     // step
      for (const [sx, face] of [[x1, 1], [x0, -1]]) { bu(A.Dt, sx + (face > 0 ? 0.0 : -0.016), sx + (face > 0 ? 0.016 : 0.0), 0.62, 1.2, bz0 + 0.12, bz1 - 0.12, { color: 0x2f4352 }); }
      // beacon + antenna on the roof
      cyl(A.Bn, ctx, x1 - 0.2, h + 0.07, bz1 - 0.2, 0.06, 0.05, 0.12, 8); bx(A.Dt, x0 + 0.3, h + 0.35, bz1 - 0.2, 0.02, 0.56, 0.02, { color: 0x6f7780 });
      ob('fleet:booth', x0, x1, bz0, bz1);
    }
    // ---- fuel pump island + wash stand along the rear fence (solid props, neutral)
    {
      const px = cx + 3.4, pz = 8.2;
      bx(A.Pn, px, 0.06, pz, 0.8, 0.12, 0.5);
      bx(A.Dt, px, 0.66, pz, 0.34, 1.08, 0.26, { color: 0xd9433a });
      bx(A.Dt, px, 1.0, pz - 0.14, 0.24, 0.16, 0.01, { color: 0x1e262d });                      // display (south face is -z: front of the pump looks at the lane)
      bx(A.Dt, px, 0.6, pz - 0.14, 0.26, 0.05, 0.012, { color: WHITE });
      bx(A.Dt, px, 1.23, pz, 0.38, 0.06, 0.3, { color: 0x3a4048 });
      bx(A.Dt, px + 0.2, 0.64, pz - 0.1, 0.05, 0.3, 0.05, { color: 0x20242a });                   // nozzle holster
      for (const sx of [-0.34, 0.34]) bx(A.Dt, px + sx, 0.28, pz - 0.2, 0.07, 0.34, 0.07, { color: YELLOW });  // bollards
      ob('fleet:pump', px - 0.4, px + 0.4, pz - 0.25, pz + 0.25);
      const wx = cx + 4.75, wz = 8.3;
      bx(A.Pn, wx, 0.05, wz, 0.5, 0.1, 0.4);
      bx(A.Dt, wx, 0.5, wz, 0.26, 0.8, 0.22, { color: 0x2f6fb0 });
      cyl(A.Dt, ctx, wx - 0.0, 0.9, wz - 0.13, 0.12, 0.12, 0.06, 10, { color: 0x20242a });         // hose reel
      bx(A.Dt, wx + 0.18, 0.6, wz - 0.12, 0.03, 0.5, 0.03, { color: 0x20242a });                  // lance
      ob('fleet:wash', wx - 0.25, wx + 0.25, wz - 0.2, wz + 0.2);
    }
    // ---- entrance sign on a GATE GANTRY (2026-10-06 (11): it used to stand on the garage roof): a steel beam between the two floodlight pillars 2.12 m above the slab (trucks are 1.28 m high), navy board with an
    // orange frame on two short posts above the beam, two spot lamps; the board faces the lane, the game's label sprite stands on its right half
    {
      const sx = cx, sz = zFront, by = 2.12 + 0.34 + 0.12;
      bx(B.St, cx, 2.12, sz, (xE - xW) - 0.3, 0.07, 0.07);
      for (const q of [-1, 1]) bx(B.St, sx + q * 1.05, 2.12 + 0.2, sz, 0.06, 0.4, 0.06);
      bx(B.Dt, sx, by, sz, 2.5, 0.62, 0.06, { color: NAVY });
      bx(B.Dt, sx, by + 0.34, sz - 0.02, 2.6, 0.05, 0.09, { color: ORANGE }); bx(B.Dt, sx, by - 0.34, sz - 0.02, 2.6, 0.05, 0.09, { color: ORANGE });
      { const tx = sx - 0.85, ty = by - 0.05, tz = sz - 0.04;
        bx(B.Dt, tx - 0.07, ty + 0.04, tz, 0.5, 0.26, 0.02, { color: WHITE }); bx(B.Dt, tx + 0.27, ty, tz, 0.2, 0.2, 0.02, { color: ORANGE }); bx(B.Dt, tx + 0.29, ty + 0.04, tz - 0.012, 0.09, 0.07, 0.012, { color: 0x9fd0e8 });
        for (const wx of [-0.22, 0.05, 0.27]) bx(B.Dt, tx + wx, ty - 0.12, tz, 0.09, 0.09, 0.02, { color: 0x20242a }); }
      for (const q of [-1, 1]) { bx(B.Dt, sx + q * 0.7, by + 0.5, sz - 0.2, 0.12, 0.07, 0.07, { color: 0x2b2f36 }); bx(Lf, sx + q * 0.7, by + 0.47, sz - 0.24, 0.09, 0.05, 0.02); bx(B.St, sx + q * 0.7, by + 0.4, sz - 0.1, 0.03, 0.03, 0.22); }
      p.sign = { x: sx + 0.45, y: by, z: sz - 0.12 }; // 2026-10-10 (14): 5 cm further off the board face (the plate is a billboard, an oblique view cut its edge into the frame)
    }
    // ---- painted decals on the lot slab: bay separators (white), stop bars (yellow), arrows, hazard chevrons in front of the throat, edge line
    {
      const y0 = lotTop, y1 = lotTop + 0.0035, W = WHITE;
      const xs = p.homes.map((h) => h.x), pitch = xs.length > 1 ? xs[1] - xs[0] : 1.9;
      for (let i = 0; i <= xs.length; i++) { const x = xs[0] - pitch / 2 + i * pitch; bx(B.Dt, x, y0 + 0.00175, 6.62, 0.045, 0.0035, 1.95, { color: W }); }
      for (const x of xs) {
        bx(B.Dt, x, y0 + 0.00175, 5.62, 1.45, 0.0035, 0.05, { color: YELLOW });
        // arrow: shaft + head (up the bay = +z), white
        bx(B.Dt, x, y0 + 0.00175, 5.34, 0.07, 0.0035, 0.3, { color: W });
        o.pt(B.Dt, [x - 0.15, y1, 5.5], [x + 0.15, y1, 5.5], [x, y1, 5.82], [0, 1, 0], { color: W });
      }
      // hazard chevrons across the mouth in front of the entrance sign (diagonal yellow / dark bars on a black band)
      for (let i = 0; i < 14; i++) { const x = cx - 1.4 + i * 0.2; o.pq(B.Dt, [x, y1, 5.06], [x + 0.1, y1, 5.06], [x + 0.2, y1, 5.2], [x + 0.1, y1, 5.2], [0, 1, 0], { color: i % 2 ? 0x2b2f36 : YELLOW }); }
      bx(B.Dt, cx, y0 + 0.00175, 5.2, 2.8, 0.0035, 0.02, { color: YELLOW }); bx(B.Dt, cx, y0 + 0.00175, 5.06, 2.8, 0.0035, 0.02, { color: YELLOW });
      // edge line along the rear + side fences inside the slab
      bx(B.Dt, cx, y0 + 0.00175, 7.82, hw * 2 - 0.3, 0.0035, 0.03, { color: YELLOW });
    }
    // ---- sliding gate shown OPEN: the leaf is parked inside along the west fence on its carriage, the track runs along the whole mouth (a flat steel rail trucks drive over)
    {
      const lx = xW + 0.14, lz0 = zFront + 0.4, lz1 = zFront + 2.05, mid = (lz0 + lz1) / 2;
      bx(B.St, cx, 0.073, zFront + 0.02, hw * 2 - 0.5, 0.012, 0.035);
      for (const y of [1.0, 0.1]) bx(B.St, lx, y, mid, 0.05, 0.05, lz1 - lz0);
      for (const z of [lz0, lz1]) bx(B.St, lx, 0.55, z, 0.05, 0.95, 0.05);
      for (let i = 1; i < 9; i++) bx(B.St, lx, 0.55, lz0 + (lz1 - lz0) * i / 9, 0.016, 0.9, 0.016);
      const dz = lz1 - lz0, dl = Math.hypot(dz, 0.9), th = Math.atan2(0.9, dz);
      bx(B.St, lx, 0.55, mid, 0.03, 0.03, dl, { rx: th });
      for (const z of [lz0 + 0.12, lz1 - 0.12]) { bx(B.Dt, lx, 0.07, z, 0.1, 0.05, 0.1, { color: 0x20242a }); }
      for (let i = 0; i < 6; i++) bx(B.Dt, lx - 0.032, 0.97, lz0 + (i + 0.5) * dz / 6, 0.012, 0.07, dz / 6 + 0.001, { color: i % 2 ? 0x2b2f36 : YELLOW });
      ob('fleet:gate leaf', lx - 0.07, lx + 0.07, lz0 - 0.03, lz1 + 0.03);
    }
    // ---- wheel stops (low concrete blocks, walkable) at the rear end of every bay
    for (const h of p.homes) { bx(B.Pn, h.x, 0.102, h.z + 0.92, 0.88, 0.065, 0.13); }

    const add = (m) => { if (m) g.add(m); return m; };
    add(toMesh(B.Pn, M.plinth, { cast: false }));
    add(toMesh(B.Wl, M.panel, { cast: true }));
    add(toMesh(B.Rf, M.roof, { cast: true }));
    add(toMesh(B.St, M.steel, { cast: true }));
    add(toMesh(B.Tr, M.trim, { cast: false }));
    add(toMesh(B.Dr, M.roller, {}));
    add(toMesh(B.Dt, M.detail, { soft: true, cast: false }));
    add(toMesh(Lf, FMat.lamp, { soft: true, receive: false, name: 'fleetLampV161' }));
    add(toMesh(B.Gl, M.glass, { receive: false }));
    const am = new THREE.Group(); am.name = 'yardAmenitiesV161';
    for (const m of [toMesh(A.Pn, M.plinth, { cast: false }), toMesh(A.Wl, M.panel, { cast: true }), toMesh(A.Tr, M.trim, { cast: false }), toMesh(A.Dt, M.detail, { soft: true, cast: false }),
      toMesh(A.Gl, M.glass, { receive: false }), toMesh(A.Bn, FMat.beacon, { soft: true, receive: false, name: 'fleetBeaconV161' })]) if (m) am.add(m);
    g.add(am); g.userData.v161Amenities = am;
    g.userData.v161Fleet = true;
    g.userData.v161Obstacles = obs;
    g.userData.v161Garage = p.garage || null;                                                                 // the service garage's real dimensions (tests / probes)
    return p;
  }
  // world-space oriented boxes for the v83 registry (rebuildStatic): the fence runs, pillars, garage, booth, pump, wash stand and the sign post of the live yard; player + agent only (placement / camera off:
  // the road planners keep the old fleet-yard keep-out parcel exactly as before)
  // the base garage (level >= 2: 5 or 6 bays, back wall at z 8.23) stands where the booth / pump / wash stand: while it does, those three are not drawn and not solid
  function amenitiesHidden() { try { return Number(baseLevel('garage')) >= 2; } catch (e) { return false; } }
  function fleetObstacles() {
    try {
      const g = scene.getObjectByName('v116FleetYard');
      if (!g || !g.userData.v161Obstacles) return [];
      const hide = amenitiesHidden();
      return g.userData.v161Obstacles.filter((b) => !(hide && /^fleet:(booth|pump|wash)/.test(b.label))).map((b) => ({ owner: g, label: b.label, pos: b.pos, hx: b.hx, hz: b.hz, yaw: b.yaw }));
    } catch (e) { return []; }
  }
  // live: floodlights glow at night, the beacon on the booth blinks (shared materials, 90 ms tick, no per-frame allocation)
  let fleetT = 0;
  function fleetTick(now) {
    if (now - fleetT < 90) return; fleetT = now;
    try { const y = scene.getObjectByName('v116FleetYard'), am = y && y.userData.v161Amenities, hide = amenitiesHidden(); if (am && am.visible === hide) { am.visible = !hide; try { __TYCOON_V83_COLLISIONS__.rebuild(); } catch (e) { /* registry not ready */ } } } catch (e) { /* no yard yet */ }
    if (!FM) return;
    let night = false; try { night = isNightV40(); } catch (e) { /* layer not ready */ }
    FM.lamp.emissiveIntensity += ((night ? 1.3 : 0.35) - FM.lamp.emissiveIntensity) * 0.08;
    FM.beacon.emissiveIntensity = (Math.floor(now / 550) % 2) ? 1.8 : 0.25;
  }
  (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push(fleetTick);

  window.buildFactoryV161 = buildFactoryV161;
  window.FactoryV161 = { enabled: true, build: buildFactoryV161, addGold, padLocal, version: 'v161-factory' };
  window.FleetYardV161 = { enabled: true, build: buildFleetYard, obstacles: fleetObstacles, version: 'v161-fleet-yard' };
})();
