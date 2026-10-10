/* Warehouse + logistics terminal v161 (2026-10-05 (9), "improve physics and design of every building, one at a time", backlog #6: stage 3 "Склад" and stage 10 "Логистический терминал", levels 1-10).
 *
 * buildLogisticsV161(stage, height, baseSize, level) is the live builder of the `warehouse` archetype for the two main-line STAGES entries (createBuildingMesh in tycoon-v161.html calls it instead of
 * buildWarehouse + the three shared polish passes; the flags v161Complete / v44Detailed / v157Finish it sets make them, the v44 micro details and finish-v157 skip it). Other `warehouse` users (the fire
 * station, the logistics-hub project, district industrial plots, the base modules) keep the old builder. `LogisticsV161.enabled = false` brings the old building back (the showcase tool uses it for before/after).
 *
 * Both buildings are built in an "outward" frame: the upgrade pad of the stage stands at a fixed place beside the building (padLocal), so the solid hall touches the pad side only up to a fixed limit and every
 * level GROWS AWAY from the pad (u = distance along the long axis away from the pad; x = gs * u). Front = +z (the driveway), the door/bay row faces it. k = baseSize / ref scales everything uniformly.
 *
 * WAREHOUSE (stage 3, a big logistics shed, pale blue-grey corrugated cladding, dark blue roof, white trim, safety orange / yellow accents):
 *   hall      : long gabled shed (ridge along the long axis) with a skylight strip, ridge cap, eave gutters, roof turbines; roller-door bays along the front on a concrete loading dock (bumpers, hazard-striped
 *               edge, dock leveller plate, ramp at one end, steps at the other), small office annex on the pad side (windows, entrance door = the door the tests measure, sign, AC unit), pallets, crates,
 *               a parked forklift (all NEUTRAL props: the warehouse has a storage meaning in the game - builtWarehouseLevels() raises the concrete / metal / frame caps - but no stock number is drawn here).
 *   levels    : 1 shed with 2 bays; 2 third bay (longer hall + roof); 3 steel canopy over the front dock + side dock with a leveller on the end wall; 4 side canopy (lean-to) over a pallet yard behind the side dock;
 *               5 roof monitor (glass lantern), name board along the eaves, floodlight masts. 6-10 gold trim (LogisticsV161.addGold): ridge cap + pips, door frames, canopy rims, pennant, crown on the ridge.
 * TERMINAL (stage 10, a modern hub: slate-blue steel panels, white aluminium, big glass curtain wall, orange accents):
 *   see buildTerminal below (glass office storey over truck gates numbered 1-3 under a long canopy, control tower with a glass cabin, container stacks, gantry light masts, painted lane markings on the apron slab).
 * cost: everything merged into ~12 meshes (one per material), shared materials flagged `sharedSurfaceV153`; physics: `userData.v161Footprint` = the real wall boxes (+ container stacks) -> v83 registry oriented boxes.
 */
(() => {
  'use strict';
  if (!window.BuildingsV161 || !window.BuildingsV161.kit) return;
  const K = window.BuildingsV161.kit;
  const { batch, box, tri, quad, cone, cyl, blob, makeCtx, toMesh, lin, shade } = K;
  const V3 = THREE.Vector3;

  // ---------------------------------------------------------------------------------------------- shared materials (never disposed)
  let SM = null;
  function smats() {
    if (SM) return SM;
    const M = K.mats();
    const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    const fam = (family, color, opts) => share(createSurfaceMaterialV152(family, lin(color), opts));
    SM = {
      wall: fam('corrugated', 0xc3cfda, { roughness: 0.74 }),                  // pale blue-grey cladding
      wallDeep: fam('corrugated', 0x6f879c, { roughness: 0.7 }),               // slate-blue cladding (terminal)
      roof: fam('corrugated', 0x4f6479, { roughness: 0.66, side: THREE.DoubleSide }),
      roller: fam('corrugated', 0xaab6c1, { roughness: 0.6, metalness: 0.12 }),
      steel: fam('metal', 0x5d6b7a, { roughness: 0.55 }),
      trim: M.trim, plinth: M.plinth, wood: M.wood, lamp: M.lamp, detail: M.detail, gold: M.gold,
      door: fam('metal', 0x3d5f86, { roughness: 0.6 }),
      glass: share(new THREE.MeshStandardMaterial({ color: lin(0x9fd0e8), emissive: lin(0x1b3a52), emissiveIntensity: 0.26, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.62, depthWrite: false })),
    };
    return SM;
  }

  // palette (sRGB hex)
  const NAVY = 0x23415e, BLUE = 0x2f6fb0, ORANGE = 0xea8a2f, YELLOW = 0xf2b522, DARK = 0x2b2f36, WHITE = 0xf3f6f8, GREY = 0x8a97a3, CONC = 0xb7b7b1;

  // ---------------------------------------------------------------------------------------------- helpers
  // where is the upgrade pad, in the building's local frame (x right, z front = towards the driveway)? null when the stage object is not a live main-line stage
  function padLocal(idx) {
    try {
      if (!(idx >= 0)) return null;
      const axis = stageAccessAxisV92(idx), yaw = Math.atan2(-axis.x, -axis.z), bp = buildingPosition(idx), pp = upgradePadPosition(bp, idx);
      const dx = pp.x - bp.x, dz = pp.z - bp.z, c = Math.cos(yaw), s = Math.sin(yaw);
      return { x: dx * c - dz * s, z: dx * s + dz * c };
    } catch (_) { return null; }
  }
  // quad facing a direction: the order of the four corners is swapped when the winding would face away (so mirrored layouts need no care)
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
  // box by x / y / z ranges
  const bxr = (bt, ctx, x0, x1, y0, y1, z0, z1, o) => box(bt, ctx, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), o);
  // one seven-segment digit (1, 2, 3) of height h, centred at (cx, cy) on a plane at z (facing +z)
  function digit(bt, ctx, n, cx, cy, z, h, color) {
    const w = h * 0.55, t = h * 0.14, hh = h / 2 - t / 2;
    const seg = { a: [0, hh, w - t, t], b: [w / 2 - t / 2, hh / 2, t, hh - t / 2], c: [w / 2 - t / 2, -hh / 2, t, hh - t / 2], d: [0, -hh, w - t, t], e: [-w / 2 + t / 2, -hh / 2, t, hh - t / 2], f: [-w / 2 + t / 2, hh / 2, t, hh - t / 2], g: [0, 0, w - t, t] };
    const on = { 1: 'bc', 2: 'abged', 3: 'abgcd' }[n] || '';
    for (const s of on) { const q = seg[s]; box(bt, ctx, cx + q[0], cy + q[1], z, q[2], q[3], 0.012, { color }); }
  }
  // gable roof with the ridge along x: x0..x1 (wall faces), eaves at zf / zr (wall faces), wall top yw, ridge yr, overhangs ox (gable ends) / oz (eaves). Roof planes -> bt, gable triangles -> bw
  function gableX(bt, bw, ctx, x0, x1, zf, zr, yw, yr, ox, oz) {
    const zc = (zf + zr) / 2, tn = (yr - yw) / (zf - zc), ye = yw - oz * tn, xa = x0 - ox, xb = x1 + ox;
    quad(bt, ctx, [xa, ye, zf + oz], [xb, ye, zf + oz], [xb, yr, zc], [xa, yr, zc]);
    quad(bt, ctx, [xb, ye, zr - oz], [xa, ye, zr - oz], [xa, yr, zc], [xb, yr, zc]);
    tri(bw, ctx, [x1, yw, zf], [x1, yw, zr], [x1, yr, zc]);
    tri(bw, ctx, [x0, yw, zr], [x0, yw, zf], [x0, yr, zc]);
    return { zc, tn, ye, xa, xb };
  }
  // a point on the front slope of such a roof: t 0 = eave .. 1 = ridge, z of the eave line = zf + oz
  const slopeFront = (g, zf, oz, yr, t, x) => [x, g.ye + (yr - g.ye) * t, zf + oz + (g.zc - (zf + oz)) * t];
  const slopeBack = (g, zr, oz, yr, t, x) => [x, g.ye + (yr - g.ye) * t, zr - oz + (g.zc - (zr - oz)) * t];

  // ============================================================================================== WAREHOUSE (stage 3)
  const W = { y0: 0.14, wallH: 1.7, rise: 0.4, zf: 1.0, zr: -1.2, ox: 0.12, oz: 0.22, uh0: 0.35, pitch: 1.1, padLimit: 1.02, dockH: 0.2, dockD: 0.62, annexH: 1.3, annexZ0: -0.5 };

  function buildWarehouse(stage, height, baseSize, level = 1) {
    const L = Math.max(1, Math.min(5, Math.floor(level) || 1));
    const k = (baseSize || 2.2) / 2.2;
    const M = smats();
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1;
    const pl = padLocal(idx);
    const padSide = pl ? (pl.x >= 0 ? 1 : -1) : 1, gs = -padSide;                          // growth direction
    const X = (u) => gs * u;
    const { y0, wallH, rise, zf, zr, ox, oz, uh0, pitch, dockH, dockD, annexH, annexZ0 } = W;
    const yw = y0 + wallH, yr = yw + rise, zc = (zf + zr) / 2;
    const nBays = L >= 2 ? 3 : 2, uh1 = uh0 + nBays * pitch + 0.1;
    const ua0 = -W.padLimit, ua1 = uh0;                                                     // office annex on the pad side
    const ctx = makeCtx(k);
    const bWl = batch(), bRf = batch(), bRl = batch(), bSt = batch(), bTr = batch(), bPn = batch(), bWd = batch(), bDt = batch(true), bLp = batch(), bGl = batch(), bDr = batch();
    const footprint = [];
    const dims = { k, level: L, gs, padSide, y0, yw, yr, zf, zr, zc, uh0, uh1, nBays, ua0, ua1, dockH, top: yr };
    const rx = (u0, u1) => (gs > 0 ? [u0, u1] : [-u1, -u0]);                                // u range -> sorted x range
    const bu = (bt, u0, u1, ya, yb, za, zb, o) => { const r = rx(u0, u1); bxr(bt, ctx, r[0], r[1], ya, yb, za, zb, o); };

    // ---- foundation: plinth under annex + hall, front apron slab
    bu(bPn, ua0 - 0.06, uh1 + 0.06, 0, y0, zr - 0.06, zf + 0.06);
    // ---- hall walls: pale corrugated cladding on a plinth, dark base band, white corner posts
    bu(bWl, uh0, uh1, y0, yw, zr, zf);
    bu(bSt, uh0 - 0.01, uh1 + 0.01, y0, y0 + 0.2, zr - 0.012, zf + 0.012);                    // dark base band (steel)
    for (const u of [uh0, uh1]) for (const z of [zr, zf]) bu(bTr, u - 0.045, u + 0.045, y0, yw, z - 0.045, z + 0.045);
    // gable roof + ridge cap + gutters, gable end triangles
    const rg = gableX(bRf, bWl, ctx, rx(uh0, uh1)[0], rx(uh0, uh1)[1], zf, zr, yw, yr, ox, oz);
    { const r = rx(uh0 - ox, uh1 + ox); bxr(bTr, ctx, r[0], r[1], yr, yr + 0.045, zc - 0.07, zc + 0.07); }
    for (const z of [zf + oz + 0.01, zr - oz - 0.01]) { const r = rx(uh0 - ox, uh1 + ox); bxr(bSt, ctx, r[0], r[1], rg.ye - 0.045, rg.ye + 0.02, z - 0.03, z + 0.03); }
    // skylight strip: two glass bands inset on both slopes (t 0.5..0.82), ribs between
    {
      const xa = rx(uh0 + 0.18, uh1 - 0.18)[0], xb = rx(uh0 + 0.18, uh1 - 0.18)[1];
      const lift = 0.012;
      const sf = (t, x) => { const p = slopeFront(rg, zf, oz, yr, t, x); return [p[0], p[1] + lift, p[2]]; }, sb = (t, x) => { const p = slopeBack(rg, zr, oz, yr, t, x); return [p[0], p[1] + lift, p[2]]; };
      fq(bGl, ctx, sf(0.5, xa), sf(0.5, xb), sf(0.84, xb), sf(0.84, xa), [0, 1, 0.3]);
      fq(bGl, ctx, sb(0.5, xa), sb(0.5, xb), sb(0.84, xb), sb(0.84, xa), [0, 1, -0.3]);
      for (let i = 0; i <= nBays; i++) { const x = gs * (uh0 + 0.18 + (uh1 - uh0 - 0.36) * i / nBays); for (const f of [sf, sb]) fq(bTr, ctx, f(0.5, x - 0.012), f(0.5, x + 0.012), f(0.84, x + 0.012), f(0.84, x - 0.012), [0, 1, f === sf ? 0.3 : -0.3]); }
      for (const f of [sf, sb]) for (const t of [0.5, 0.84]) fq(bTr, ctx, f(t - 0.01, xa), f(t - 0.01, xb), f(t + 0.01, xb), f(t + 0.01, xa), [0, 1, f === sf ? 0.3 : -0.3]);
    }
    // roof turbines on the ridge (neutral vents)
    for (let i = 0; i < (L >= 5 ? 4 : 2); i++) { const u = uh0 + 0.55 + i * ((uh1 - uh0 - 1.1) / Math.max(1, (L >= 5 ? 3 : 1))); const x = X(u); cyl(bSt, ctx, x, yr, zc - 0.4, 0.07, 0.07, 0.1, 8); blob(bDt, ctx, x, yr + 0.2, zc - 0.4, 0.11, 0.1, 0.11, 1, { color: 0x9aa7b2 }); cyl(bSt, ctx, x, yr + 0.09, zc - 0.4, 0.015, 0.015, 0.04, 6); }
    footprint.push({ u0: uh0 - 0.05, u1: uh1 + 0.05, z0: zr - 0.05, z1: zf + 0.05 });
    dims.rf = rg;

    // ---- front: roller-door bays on a loading dock
    const dockU0 = uh0 - 0.02, dockU1 = uh1;
    bu(bPn, dockU0, dockU1, 0, dockH, zf, zf + dockD);                                      // dock slab
    bu(bTr, dockU0 - 0.02, dockU1 + 0.02, dockH, dockH + 0.02, zf + dockD - 0.05, zf + dockD + 0.02);   // nosing
    // hazard stripe along the nose: alternating yellow / dark blocks
    { const n = Math.round((dockU1 - dockU0) / 0.12); for (let i = 0; i < n; i++) { const u = dockU0 + (i + 0.5) * (dockU1 - dockU0) / n, x = X(u); box(bDt, ctx, x, dockH + 0.004, zf + dockD - 0.03, (dockU1 - dockU0) / n + 0.001, 0.012, 0.07, { color: i % 2 ? DARK : YELLOW }); } }
    for (let i = 0; i < nBays; i++) {
      const u = uh0 + 0.5 + i * pitch + 0.05, x = X(u), dw = 0.82, dh = 1.12, yb = dockH;
      box(bDr, ctx, x, yb + dh / 2, zf + 0.02, dw, dh, 0.04);                                // roller shutter
      for (let r = 1; r < 6; r++) box(bTr, ctx, x, yb + r * dh / 6, zf + 0.045, dw, 0.012, 0.012);   // slat lines
      for (const q of [-1, 1]) box(bDt, ctx, x + q * (dw / 2 + 0.04), yb + dh / 2 + 0.03, zf + 0.04, 0.08, dh + 0.06, 0.08, { color: ORANGE });    // orange frame
      box(bDt, ctx, x, yb + dh + 0.04, zf + 0.04, dw + 0.16, 0.08, 0.08, { color: ORANGE });
      box(bDt, ctx, x, yb + dh + 0.14, zf + 0.04, 0.2, 0.1, 0.02, { color: BLUE });          // bay number plate (blue)
      box(bLp, ctx, x, yb + dh + 0.25, zf + 0.07, 0.12, 0.05, 0.06);                         // dock light
      for (const q of [-1, 1]) box(bDt, ctx, x + q * 0.34, dockH + 0.08, zf + 0.08, 0.1, 0.16, 0.08, { color: DARK });                      // wall bumpers beside the door
    }
    // dock leveller plate in front of the middle bay: raised steel plate with yellow rim and a hinge line
    { const u = uh0 + 0.5 + pitch + 0.05, x = X(u), z0 = zf + 0.04; box(bDt, ctx, x, dockH + 0.012, z0 + 0.2, 0.7, 0.025, 0.4, { color: 0x7d8a97 }); box(bDt, ctx, x, dockH + 0.026, z0 + 0.4, 0.7, 0.012, 0.03, { color: YELLOW }); for (const q of [-1, 1]) box(bDt, ctx, x + q * 0.35, dockH + 0.026, z0 + 0.2, 0.03, 0.012, 0.4, { color: YELLOW }); }
    // ramp at the far (gs) end of the dock: a wedge from dock height down to the ground, with hazard rim
    {
      const u0 = dockU1, u1 = dockU1 + 0.72, z0 = zf + 0.08, z1 = zf + dockD, X0 = X(u0), X1 = X(u1);
      fq(bPn, ctx, [X0, dockH, z0], [X0, dockH, z1], [X1, 0.005, z1], [X1, 0.005, z0], [0, 1, 0]);
      fq(bPn, ctx, [X0, 0, z1], [X1, 0, z1], [X1, 0.005, z1], [X0, dockH, z1], [0, 0, 1]);
      fq(bPn, ctx, [X0, 0, z0], [X1, 0, z0], [X1, 0.005, z0], [X0, dockH, z0], [0, 0, -1]);
      for (const z of [z0 + 0.02, z1 - 0.02]) fq(bDt, ctx, [X0, dockH + 0.004, z - 0.02], [X0, dockH + 0.004, z + 0.02], [X1, 0.012, z + 0.02], [X1, 0.012, z - 0.02], [0, 1, 0], { color: YELLOW });
      dims.ramp = { u0, u1 };
    }
    // steps at the annex end of the dock (two low steps)
    for (let i = 0; i < 2; i++) bu(bPn, uh0 - 0.42 + i * 0.14, uh0 - 0.02, 0, 0.07 * (2 - i) + 0.0 + 0.06 * i, zf + 0.12, zf + 0.5);
    // pallets with wrapped boxes on the dock (neutral), a crate pair at the dock end
    const pallet = (u, z, h, c1, c2, ry = 0) => {
      const x = X(u);
      ctx.at(x, dockH, z, ry, () => {
        box(bWd, ctx, 0, 0.03, 0, 0.34, 0.03, 0.34); box(bWd, ctx, 0, 0.075, 0, 0.34, 0.025, 0.34); for (const q of [-1, 0, 1]) box(bWd, ctx, q * 0.14, 0.015, 0, 0.05, 0.03, 0.34);
        for (let i = 0; i < h; i++) box(bDt, ctx, 0, 0.12 + i * 0.13, 0, 0.3, 0.12, 0.3, { color: i % 2 ? c2 : c1 });
        box(bDt, ctx, 0, 0.1 + h * 0.065 + 0.0, 0, 0.312, h * 0.13 + 0.02, 0.312, { color: 0xeef3f7 });   // stretch wrap (pale shell under the boxes colour: a thin film band)
      });
    };
    pallet(uh0 + 0.38, zf + 0.3, 2, 0xc9a063, 0xb88a52, 0.2); pallet(uh0 + 0.22, zf + 0.3, 1, 0xd8b678, 0xc9a063, -0.1);

    // ---- office annex (pad side): flat roof with parapet, entrance door, windows, sign, AC unit
    {
      const ya = y0 + annexH, za0 = annexZ0;
      bu(bWl, ua0, ua1, y0, ya, za0, zf);
      bu(bSt, ua0 - 0.01, ua1 + 0.01, y0, y0 + 0.16, za0 - 0.012, zf + 0.012);
      bu(bTr, ua0 - 0.05, ua1 + 0.05, ya, ya + 0.05, za0 - 0.05, zf + 0.05);               // roof edge
      bu(bRl, ua0 + 0.05, ua1 - 0.05, ya, ya + 0.025, za0 + 0.05, zf - 0.05);              // roof deck (dark)
      for (const z of [za0, zf]) for (const u of [ua0, ua1]) bu(bTr, u - 0.04, u + 0.04, y0, ya, z - 0.04, z + 0.04);
      // entrance: framed steel door (the kick-plate mesh below is userData.v161Door), glass pane, small canopy
      const ue = -0.2, xe = X(ue);
      box(bTr, ctx, xe, y0 + 0.5, zf + 0.012, 0.5, 1.0, 0.03);                             // door surround
      box(bGl, ctx, xe, y0 + 0.64, zf + 0.036, 0.3, 0.52, 0.012);
      box(bDt, ctx, xe, y0 + 0.64, zf + 0.04, 0.012, 0.52, 0.01, { color: WHITE });
      box(bDt, ctx, xe + gs * 0.15, y0 + 0.5, zf + 0.04, 0.025, 0.12, 0.03, { color: GREY });   // handle
      box(bSt, ctx, xe, y0 + 1.06, zf + 0.22, 0.7, 0.04, 0.46);                             // entrance canopy plate
      for (const q of [-1, 1]) box(bSt, ctx, xe + q * 0.3, y0 + 1.0, zf + 0.09, 0.02, 0.1, 0.18, { rx: 0.4 });
      box(bLp, ctx, xe + gs * 0.36, y0 + 0.95, zf + 0.06, 0.07, 0.1, 0.07);
      // front window + side window (facing the pad)
      const win = (cx, cy, z, w, h) => { box(bTr, ctx, cx, cy, z + 0.012, w + 0.1, h + 0.1, 0.03); box(bGl, ctx, cx, cy, z + 0.032, w, h, 0.012); box(bDt, ctx, cx, cy, z + 0.036, 0.012, h, 0.008, { color: WHITE }); box(bTr, ctx, cx, cy - h / 2 - 0.07, z + 0.05, w + 0.16, 0.04, 0.1); };
      win(X(-0.85), y0 + 0.72, zf, 0.42, 0.46);
      ctx.at(X(ua0), 0, 0.2, gs > 0 ? -Math.PI / 2 : Math.PI / 2, () => win(0, y0 + 0.7, 0, 0.42, 0.44));
      ctx.at(X(ua0), 0, -0.2, gs > 0 ? -Math.PI / 2 : Math.PI / 2, () => win(0, y0 + 0.7, 0, 0.36, 0.44));
      // blue sign band with an orange stripe along the top of the front wall (no text, no texture)
      box(bDt, ctx, X((ua0 + ua1) / 2), ya - 0.15, zf + 0.02, ua1 - ua0 - 0.06, 0.2, 0.025, { color: BLUE });
      box(bDt, ctx, X((ua0 + ua1) / 2), ya - 0.04, zf + 0.025, ua1 - ua0 - 0.06, 0.03, 0.015, { color: ORANGE });
      for (let i = 0; i < L; i++) box(bDt, ctx, X(ua0 + 0.2 + i * 0.1), ya - 0.15, zf + 0.04, 0.05, 0.05, 0.012, { color: YELLOW });   // level pips on the band
      // AC unit + vent on the annex roof
      box(bDt, ctx, X(ua0 + 0.5), ya + 0.13, za0 + 0.4, 0.5, 0.2, 0.34, { color: 0xa5b0ba }); cyl(bDt, ctx, X(ua0 + 0.5), ya + 0.23, za0 + 0.4, 0.11, 0.11, 0.03, 8, { color: DARK });
      footprint.push({ u0: ua0 - 0.05, u1: ua1, z0: za0 - 0.05, z1: zf + 0.05 });
      dims.annex = { ya, ua0, ua1, za0 };
      var doorX = xe, doorY = y0 + 0.17, doorZ = zf + 0.03;
    }

    // ---- neutral props around the building: crates + barrels at the annex, a parked forklift in front of the ramp end
    {
      const cr = (u, z, ry, h = 1) => { for (let i = 0; i < h; i++) box(bWd, ctx, X(u), 0.17 + i * 0.34, z, 0.34, 0.34, 0.34, { ry: ry + i * 0.3 }); };
      cr(-0.62, zf + 0.34, 0.1, 2); cr(-0.3, zf + 0.62, -0.2, 1);
      cyl(bDt, ctx, X(-1.0), 0, zf + 0.34, 0.15, 0.15, 0.42, 8, { color: BLUE }); box(bDt, ctx, X(-1.0), 0.14, zf + 0.34, 0.31, 0.02, 0.31, { color: DARK });
      // forklift: chassis, counterweight, cab frame, mast + forks, wheels
      const fu = uh1 + 0.55, fz = zf + 1.28;
      ctx.at(X(fu), 0, fz, gs > 0 ? 2.7 : -2.7, () => {
        box(bDt, ctx, 0, 0.17, 0, 0.3, 0.16, 0.46, { color: YELLOW }); box(bDt, ctx, 0, 0.27, -0.2, 0.3, 0.2, 0.12, { color: ORANGE });
        for (const q of [-1, 1]) { box(bDt, ctx, q * 0.13, 0.46, -0.05, 0.02, 0.3, 0.02, { color: DARK }); box(bDt, ctx, q * 0.13, 0.46, 0.12, 0.02, 0.3, 0.02, { color: DARK }); }
        box(bDt, ctx, 0, 0.62, 0.03, 0.3, 0.025, 0.2, { color: DARK });
        box(bDt, ctx, 0, 0.3, 0.1, 0.12, 0.1, 0.1, { color: DARK });
        box(bDt, ctx, 0, 0.3, 0.27, 0.22, 0.5, 0.025, { color: DARK });
        for (const q of [-1, 1]) { box(bDt, ctx, q * 0.07, 0.04, 0.39, 0.03, 0.025, 0.24, { color: 0x6f7883 }); box(bDt, ctx, q * 0.07, 0.15, 0.28, 0.025, 0.28, 0.02, { color: 0x6f7883 }); }
        for (const q of [-1, 1]) for (const zz of [-0.12, 0.15]) { cyl(bDt, ctx, q * 0.17, 0.06, zz, 0.06, 0.06, 0.05, 8, { color: 0x20242a }); }
        box(bLp, ctx, 0, 0.64, -0.06, 0.04, 0.04, 0.04);
      });
    }

    // ---- level 3: steel canopy over the dock, side dock with a leveller on the end wall
    if (L >= 3) {
      const cy = y0 + 1.45, cz0 = zf, cz1 = zf + dockD + 0.12;
      const r = rx(uh0 - 0.1, uh1 + 0.1);
      bxr(bSt, ctx, r[0], r[1], cy, cy + 0.05, cz0, cz1);                                                       // flat canopy plate (rim)
      bxr(bWl, ctx, r[0] + 0.02, r[1] - 0.02, cy + 0.05, cy + 0.07, cz0 + 0.02, cz1 - 0.02);
      bxr(bDt, ctx, r[0], r[1], cy - 0.005, cy + 0.04, cz1 - 0.012, cz1 + 0.012, { color: BLUE });              // blue fascia
      for (const u of [uh0 + 0.02, (uh0 + uh1) / 2, uh1 - 0.02]) { box(bSt, ctx, X(u), cy / 2 + dockH / 2, cz1 - 0.05, 0.05, cy - dockH, 0.05); box(bDt, ctx, X(u), dockH + 0.2, cz1 - 0.05, 0.062, 0.4, 0.062, { color: YELLOW }); }   // posts with hazard sleeves
      for (let i = 0; i < nBays; i++) box(bLp, ctx, X(uh0 + 0.55 + i * pitch), cy - 0.02, cz1 - 0.2, 0.14, 0.03, 0.08);
      // side dock on the end wall (u = uh1, facing outward): a roller door, a raised slab with a leveller + hazard edge, bumpers
      const sz0 = zc - 0.62, sz1 = zc + 0.62, su1 = uh1 + 0.52;
      bu(bPn, uh1, su1, 0, dockH, sz0, sz1);
      bu(bTr, su1 - 0.04, su1 + 0.02, dockH, dockH + 0.02, sz0 - 0.02, sz1 + 0.02);
      ctx.at(X(uh1), 0, zc, gs > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
        box(bDr, ctx, 0, dockH + 0.56, 0.02, 0.82, 1.12, 0.04); for (let r2 = 1; r2 < 6; r2++) box(bTr, ctx, 0, dockH + r2 * 1.12 / 6, 0.045, 0.82, 0.012, 0.012);
        for (const q of [-1, 1]) box(bDt, ctx, q * 0.45, dockH + 0.59, 0.04, 0.08, 1.18, 0.08, { color: ORANGE }); box(bDt, ctx, 0, dockH + 1.16, 0.04, 0.98, 0.08, 0.08, { color: ORANGE });
        box(bDt, ctx, 0, dockH + 1.28, 0.04, 0.2, 0.1, 0.02, { color: BLUE }); box(bLp, ctx, 0, dockH + 1.39, 0.07, 0.12, 0.05, 0.06);
        box(bDt, ctx, 0, dockH + 0.012, 0.3, 0.7, 0.025, 0.4, { color: 0x7d8a97 }); box(bDt, ctx, 0, dockH + 0.026, 0.5, 0.7, 0.012, 0.03, { color: YELLOW });
        for (const q of [-1, 1]) box(bDt, ctx, q * 0.5, dockH + 0.08, 0.1, 0.12, 0.16, 0.08, { color: DARK });
      });
      for (let i = 0; i < 9; i++) { const zz = sz0 + (i + 0.5) * (sz1 - sz0) / 9; box(bDt, ctx, X(su1 - 0.03), dockH + 0.004, zz, 0.07, 0.012, (sz1 - sz0) / 9 + 0.001, { color: i % 2 ? DARK : YELLOW }); }
      dims.sideDock = { u1: su1, z0: sz0, z1: sz1 };
    }

    // ---- level 4: side canopy (lean-to) over a pallet yard beyond the side dock: 4 posts, sloped roof attached to the end wall
    if (L >= 4) {
      const u0 = uh1, u1 = uh1 + 1.2, z0 = zr + 0.1, z1 = zf - 0.1, yHi = yw - 0.18, yLo = yHi - 0.3;
      const x0 = X(u0), x1 = X(u1);
      fq(bRf, ctx, [x0, yHi, z0], [x0, yHi, z1], [x1, yLo, z1], [x1, yLo, z0], [0, 1, 0]);
      fq(bTr, ctx, [x0, yHi - 0.02, z0], [x0, yHi - 0.02, z1], [x1, yLo - 0.02, z1], [x1, yLo - 0.02, z0], [0, -1, 0]);
      for (const z of [z0, z1]) { fq(bTr, ctx, [x0, yHi, z - 0.02], [x0, yHi, z + 0.02], [x1, yLo, z + 0.02], [x1, yLo, z - 0.02], [0, 1, 0]); }
      fq(bDt, ctx, [x1, yLo, z0], [x1, yLo, z1], [x1, yLo + 0.08, z1], [x1, yLo + 0.08, z0], [gs, 0, 0], { color: BLUE });
      for (const z of [z0 + 0.05, z1 - 0.05]) box(bSt, ctx, x1 - gs * 0.05, yLo / 2, z, 0.06, yLo, 0.06);
      box(bSt, ctx, X(uh1 + 0.6), (yHi + yLo) / 2 - 0.03, (z0 + z1) / 2, 0.04, 0.04, z1 - z0 - 0.1);
      // pallet yard: neutral stacks + a drum row on the floor under the canopy
      pallet(uh1 + 0.85, zc - 0.55, 3, 0xb88a52, 0xc9a063, 0.1); pallet(uh1 + 0.85, zc + 0.0, 2, 0xd8b678, 0xb88a52, -0.15); pallet(uh1 + 0.85, zc + 0.55, 3, 0xc9a063, 0xd8b678, 0.05);
      for (let i = 0; i < 3; i++) cyl(bDt, ctx, X(uh1 + 1.07), 0, zr + 0.28 + i * 0.22, 0.08, 0.08, 0.26, 8, { color: [BLUE, ORANGE, BLUE][i] });
      dims.sideCanopy = { u1, z0, z1 };
    }

    // ---- level 5: roof monitor (glass lantern on the ridge), name board along the eaves, two floodlight masts at the dock
    if (L >= 5) {
      const mu0 = uh0 + 0.4, mu1 = uh1 - 0.4, mz = 0.34, yb = yr - 0.02, yt = yr + 0.3;
      bu(bTr, mu0, mu1, yb, yb + 0.08, zc - mz, zc + mz);
      for (const sz of [-1, 1]) { bu(bGl, mu0 + 0.04, mu1 - 0.04, yb + 0.08, yt, zc + sz * (mz - 0.02) - 0.006, zc + sz * (mz - 0.02) + 0.006); for (let i = 0; i <= nBays; i++) { const u = mu0 + 0.04 + (mu1 - mu0 - 0.08) * i / nBays; bu(bTr, u - 0.015, u + 0.015, yb + 0.08, yt, zc + sz * (mz - 0.02) - 0.02, zc + sz * (mz - 0.02) + 0.02); } }
      for (const u of [mu0 + 0.02, mu1 - 0.02]) bu(bGl, u - 0.006, u + 0.006, yb + 0.08, yt, zc - mz + 0.04, zc + mz - 0.04);
      bu(bRl, mu0 - 0.1, mu1 + 0.1, yt, yt + 0.045, zc - mz - 0.1, zc + mz + 0.1);
      // name board on the front eave: blue board, orange stripe, white "letter" bars
      { const u0 = uh0 + 0.1, u1 = uh1 - 0.1, yy = yw - 0.2; bu(bDt, u0, u1, yy - 0.14, yy + 0.14, zf + 0.012, zf + 0.04, { color: NAVY }); bu(bDt, u0, u1, yy - 0.14, yy - 0.115, zf + 0.04, zf + 0.05, { color: ORANGE });
        let lu = u0 + 0.12; const widths = [0.07, 0.05, 0.08, 0.05, 0.07, 0.08, 0.05, 0.08, 0.05, 0.07, 0.06, 0.08];
        for (let i = 0; i < widths.length; i++) { const w = widths[i], hh = i % 3 === 1 ? 0.12 : 0.17; if (i === 6) lu += 0.12; if (lu + w > u1 - 0.1) break; bu(bDt, lu, lu + w, yy + 0.02 - hh / 2 + 0.03, yy + 0.02 + hh / 2 + 0.03, zf + 0.04, zf + 0.052, { color: WHITE }); lu += w + 0.045; } }
      for (const u of [uh0 + 0.05, uh1 + 0.5]) { const x = X(u), z = zf + dockD + 0.28; cyl(bSt, ctx, x, 0, z, 0.04, 0.03, 1.7, 6); box(bSt, ctx, x, 1.7, z, 0.34, 0.04, 0.04); for (const q of [-1, 1]) { box(bDt, ctx, x + q * 0.12, 1.76, z, 0.1, 0.07, 0.07, { color: DARK }); box(bLp, ctx, x + q * 0.12, 1.76, z + 0.045, 0.08, 0.05, 0.02); } }
      dims.monitor = { yt };
    }

    // ---- assemble
    const group = new THREE.Group();
    group.name = 'warehouseV161';
    const add = (m) => { if (m) group.add(m); return m; };
    add(toMesh(bPn, M.plinth, { cast: false }));
    add(toMesh(bWl, M.wall, { cast: true }));
    add(toMesh(bRf, M.roof, { cast: true }));
    add(toMesh(bRl, M.roof, { cast: false }));
    add(toMesh(bSt, M.steel, { cast: true }));
    add(toMesh(bTr, M.trim, { cast: false }));
    add(toMesh(bDr, M.roller, {}));
    add(toMesh(bWd, M.wood, { soft: true }));
    add(toMesh(bDt, M.detail, { soft: true }));
    add(toMesh(bLp, M.lamp, { soft: true, receive: false }));
    add(toMesh(bGl, M.glass, { receive: false }));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.44 * k, 0.34 * k, 0.04 * k), M.door);       // the entrance door's steel kick panel under the glass (measured by the door tests)
    door.position.set(doorX * k, doorY * k, doorZ * k);
    door.userData.v161Door = true; door.castShadow = false; door.receiveShadow = true;
    door.updateMatrix(); door.matrixAutoUpdate = false;
    group.add(door);

    const ud = group.userData;
    ud.v161Logistics = 'warehouse'; ud.v161Complete = true; ud.v44Detailed = true; ud.v157Finish = true;
    ud.v161Footprint = footprint.map((f) => { const r = rx(f.u0, f.u1); return { x: (r[0] + r[1]) / 2 * k, z: (f.z0 + f.z1) / 2 * k, hx: (r[1] - r[0]) / 2 * k, hz: (f.z1 - f.z0) / 2 * k }; });
    ud.v161Dims = dims;
    ud.levelV161 = L;
    return group;
  }

  // ============================================================================================== TERMINAL (stage 10)
  const T = { y0: 0.12, hg: 1.45, zf: 1.15, zr: -1.35, padLimit: 2.95, gateW: 0.95, gateH: 1.12, canopyD: 1.15, upZ0: -1.0, upZ1: 0.62, upH: 0.98 };
  const GATE_U = [-2.2, -0.95, 1.45];                         // gates 1, 2 (level 1), 3 (level 2+); the glass lobby entrance sits between 2 and 3

  function buildTerminal(stage, height, baseSize, level = 1) {
    const L = Math.max(1, Math.min(5, Math.floor(level) || 1));
    const k = (baseSize || 2.6) / 2.6;
    const M = smats();
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1;
    const pl = padLocal(idx);
    const padSide = pl ? (pl.x >= 0 ? 1 : -1) : 1, gs = -padSide;
    const X = (u) => gs * u;
    const { y0, hg, zf, zr, gateW, gateH, canopyD, upZ0, upZ1, upH } = T;
    const yg = y0 + hg, yu = yg + upH, zc = (zf + zr) / 2;
    const ua = -T.padLimit, uM = L >= 2 ? 2.2 : 0.8;                                       // body from the pad limit to uM
    const ctx = makeCtx(k);
    const bPn = batch(), bWl = batch(), bRl = batch(), bSt = batch(), bTr = batch(), bDr = batch(), bDt = batch(true), bCt = batch(true), bLp = batch(), bGl = batch(), bWd = batch();
    const footprint = [];
    const dims = { k, level: L, gs, padSide, y0, yg, yu, zf, zr, zc, ua, uM, top: yu + 0.1, gates: L >= 2 ? 3 : 2 };
    const rx = (u0, u1) => (gs > 0 ? [u0, u1] : [-u1, -u0]);
    const bu = (bt, u0, u1, ya, yb, za, zb, o) => { const r = rx(u0, u1); bxr(bt, ctx, r[0], r[1], ya, yb, za, zb, o); };

    // ---- apron slab with painted lane marks (decals in the detail batch: flat boxes, no road meshes)
    const slabU1 = uM + (L >= 2 ? 1.75 : 0.2), slabZ1 = zf + canopyD + 0.35;
    bu(bPn, ua - 0.1, slabU1, 0, y0, zr - 0.1, slabZ1);
    { const y = y0 + 0.003;
      for (const gu of GATE_U.slice(0, L >= 2 ? 3 : 2)) {                                  // painted bay box in front of each gate: white outline + yellow chevron bar
        bu(bDt, gu - 0.5, gu + 0.5, y, y + 0.004, zf + 0.12, zf + 0.15, { color: WHITE }); bu(bDt, gu - 0.5, gu - 0.47, y, y + 0.004, zf + 0.12, zf + 0.95, { color: WHITE }); bu(bDt, gu + 0.47, gu + 0.5, y, y + 0.004, zf + 0.12, zf + 0.95, { color: WHITE });
        for (let i = 0; i < 4; i++) bu(bDt, gu - 0.34 + i * 0.18, gu - 0.22 + i * 0.18, y, y + 0.004, zf + 0.66, zf + 0.74, { color: YELLOW });
      }
      for (let i = 0; i < 12; i++) bu(bDt, ua + 0.1 + i * 0.32, ua + 0.3 + i * 0.32, y, y + 0.004, slabZ1 - 0.12, slabZ1 - 0.09, { color: WHITE });   // dashed lane line along the apron edge
      bu(bDt, ua - 0.05, slabU1 - 0.05, y, y + 0.004, slabZ1 - 0.04, slabZ1 - 0.0, { color: YELLOW });
    }
    // ---- ground body: slate-blue steel panels, dark base band, white corner posts, flat roof with parapet
    bu(bWl, ua, uM, y0, yg, zr, zf);
    bu(bSt, ua - 0.01, uM + 0.01, y0, y0 + 0.18, zr - 0.012, zf + 0.012);
    for (const u of [ua, uM]) for (const z of [zr, zf]) bu(bTr, u - 0.05, u + 0.05, y0, yg, z - 0.05, z + 0.05);
    bu(bTr, ua - 0.03, uM + 0.03, yg - 0.1, yg, zr - 0.03, zf + 0.03);                      // roof edge band (white)
    bu(bRl, ua + 0.02, uM - 0.02, yg, yg + 0.025, zr + 0.02, zf - 0.02);                   // roof deck (dark)
    for (const z of [zr, zf]) bu(bTr, ua, uM, yg + 0.025, yg + 0.1, z - 0.03, z + 0.03);   // parapet front / back
    for (const u of [ua, uM]) bu(bTr, u - 0.03, u + 0.03, yg + 0.025, yg + 0.1, zr, zf);
    footprint.push({ u0: ua - 0.05, u1: uM + 0.05, z0: zr - 0.05, z1: zf + 0.05 });
    // ---- gates: opening in the facade (dark recess, roller shutter, orange frame, number plate with a seven-segment digit, light, bumpers)
    GATE_U.slice(0, L >= 2 ? 3 : 2).forEach((gu, gi) => {
      const x = X(gu), yb = y0 + 0.04;
      box(bDt, ctx, x, yb + gateH / 2, zf + 0.012, gateW + 0.04, gateH, 0.02, { color: 0x1d2229 });
      box(bDr, ctx, x, yb + gateH / 2 - 0.1, zf + 0.03, gateW - 0.04, gateH - 0.2, 0.03);   // shutter, raised 0.2: a visible dark gap under it
      for (let r = 1; r < 5; r++) box(bTr, ctx, x, yb + r * (gateH - 0.2) / 5 - 0.1, zf + 0.05, gateW - 0.04, 0.012, 0.012);
      for (const q of [-1, 1]) box(bDt, ctx, x + q * (gateW / 2 + 0.03), yb + gateH / 2, zf + 0.04, 0.07, gateH + 0.04, 0.06, { color: ORANGE });
      box(bDt, ctx, x, yb + gateH + 0.04, zf + 0.04, gateW + 0.14, 0.07, 0.06, { color: ORANGE });
      box(bDt, ctx, x, yb + gateH + 0.19, zf + 0.025, 0.3, 0.2, 0.02, { color: NAVY });
      digit(bDt, ctx, gi + 1, x, yb + gateH + 0.19, zf + 0.04, 0.15, WHITE);
      for (const q of [-1, 1]) box(bDt, ctx, x + q * (gateW / 2 + 0.17), yb + 0.08, zf + 0.09, 0.1, 0.16, 0.12, { color: DARK });
      box(bLp, ctx, x, yb + gateH + 0.36, zf + 0.04, 0.12, 0.04, 0.04);
    });
    // ---- glass lobby entrance on the ground floor (between gates 2 and 3): glass door + sidelights in a dark steel frame (the kick plate is userData.v161Door)
    {
      const lu = 0.15, x = X(lu), w = 0.95;
      box(bSt, ctx, x, y0 + 0.55, zf + 0.01, w + 0.1, 1.1, 0.03);
      box(bGl, ctx, x, y0 + 0.66, zf + 0.03, w - 0.06, 0.92, 0.012);
      for (const q of [-1, 0, 1]) box(bSt, ctx, x + q * w / 3, y0 + 0.66, zf + 0.04, 0.025, 0.92, 0.02);
      box(bSt, ctx, x, y0 + 1.2, zf + 0.04, w + 0.14, 0.06, 0.06);
      box(bDt, ctx, x, y0 + 1.0, zf + 0.045, 0.4, 0.04, 0.01, { color: BLUE });
      var doorX = x, doorY = y0 + 0.1, doorZ = zf + 0.04;
    }
    // ---- upper office storey: glass curtain wall (all round) with steel mullions + white spandrels, white roof slab, level pips
    {
      const u0 = ua + 0.2, u1 = uM - 0.2, z0 = upZ0, z1 = upZ1;
      bu(bTr, u0, u1, yg + 0.1, yg + 0.16, z0, z1);                                          // floor slab (white)
      bu(bSt, u0, u1, yg + 0.16, yg + 0.2, z0, z1);                                          // dark sill band
      bu(bTr, u0 - 0.1, u1 + 0.1, yu, yu + 0.07, z0 - 0.1, z1 + 0.1);                        // roof slab with overhang
      bu(bDt, u0 - 0.1, u1 + 0.1, yu + 0.07, yu + 0.095, z1 + 0.1 - 0.02, z1 + 0.1, { color: BLUE }); // blue edge line on the front
      const gy0 = yg + 0.2, gy1 = yu;
      bu(bGl, u0, u1, gy0, gy1, z1 - 0.012, z1);                                             // front glass
      bu(bGl, u0, u1, gy0, gy1, z0, z0 + 0.012);                                             // rear glass
      for (const u of [u0, u1]) bu(bGl, u - 0.006, u + 0.006, gy0, gy1, z0, z1);             // side glass
      const n = Math.max(2, Math.round((u1 - u0) / 0.34));
      for (let i = 0; i <= n; i++) { const u = u0 + (u1 - u0) * i / n; bu(bSt, u - 0.014, u + 0.014, gy0, gy1, z1 - 0.025, z1 + 0.012); bu(bSt, u - 0.014, u + 0.014, gy0, gy1, z0 - 0.012, z0 + 0.02); }
      for (const z of [z0, z1]) for (const y of [(gy0 + gy1) / 2]) bu(bSt, u0, u1, y - 0.012, y + 0.012, z - 0.014, z + 0.014);
      for (const z of [z0, z1]) for (const u of [u0, u1]) bu(bSt, u - 0.03, u + 0.03, gy0, gy1, z - 0.03, z + 0.03);
      for (let i = 0; i < L; i++) bu(bDt, u0 + 0.1 + i * 0.1, u0 + 0.15 + i * 0.1, yu + 0.015, yu + 0.06, z1 + 0.103, z1 + 0.115, { color: YELLOW }); // level pips on the roof edge
      dims.up = { u0, u1, z0, z1 };
      // rooftop kit on the ground roof behind: AC units + vents (neutral)
      for (let i = 0; i < 2; i++) { box(bDt, ctx, X(u0 + 0.4 + i * 1.1), yg + 0.14, zr + 0.22, 0.5, 0.2, 0.28, { color: 0xa5b0ba }); cyl(bDt, ctx, X(u0 + 0.4 + i * 1.1), yg + 0.24, zr + 0.22, 0.1, 0.1, 0.03, 8, { color: DARK }); }
    }
    // ---- canopy over the truck bays: flat white slab with a blue fascia and a lamp strip, steel columns with hazard sleeves
    {
      const cu0 = ua - 0.1, cu1 = uM + 0.1, cy = yg - 0.02, cz0 = zf, cz1 = zf + canopyD;
      bu(bTr, cu0, cu1, cy - 0.06, cy + 0.02, cz0, cz1);
      bu(bDt, cu0, cu1, cy - 0.07, cy + 0.03, cz1 - 0.012, cz1 + 0.012, { color: BLUE });
      bu(bDt, cu0, cu1, cy + 0.03, cy + 0.045, cz1 - 0.012, cz1 + 0.012, { color: ORANGE });
      const pu = [ua + 0.1, ...GATE_U.slice(0, L >= 2 ? 3 : 2).slice(0, -1).map((u, i, a) => (u + GATE_U[i + 1]) / 2), uM - 0.1];
      for (const u of pu) { box(bSt, ctx, X(u), cy / 2, cz1 - 0.08, 0.07, cy, 0.07); box(bDt, ctx, X(u), y0 + 0.2, cz1 - 0.08, 0.085, 0.4, 0.085, { color: YELLOW }); box(bDt, ctx, X(u), y0 + 0.2, cz1 - 0.08, 0.087, 0.07, 0.087, { color: DARK }); }
      for (let i = 0; i < 6; i++) bu(bLp, cu0 + 0.35 + i * ((cu1 - cu0 - 0.7) / 5) - 0.06, cu0 + 0.35 + i * ((cu1 - cu0 - 0.7) / 5) + 0.06, cy - 0.075, cy - 0.06, cz1 - 0.3, cz1 - 0.2);
      dims.canopy = { cu0, cu1, cy, cz1 };
    }
    // ---- level 2: container stack A on the yard (neutral stacks; solid, so they are colliders)
    const container = (u, z, h, c1, c2, c3) => {
      const L0 = 0.78, W0 = 0.3, H0 = 0.32, cols = [c1, c2, c3];
      for (let i = 0; i < h; i++) {
        const c = cols[i % 3], y = y0 + i * H0, x = X(u);
        box(bCt, ctx, x, y + H0 / 2, z, L0, H0, W0, { color: c });
        box(bCt, ctx, x, y + H0 + 0.005, z, L0 - 0.04, 0.01, W0 - 0.04, { color: shade(c, 0.78) });
        for (let r = 0; r < 9; r++) { const uu = (r - 4) * (L0 - 0.1) / 8; box(bCt, ctx, x + gs * uu, y + H0 / 2, z + W0 / 2 + 0.004, 0.012, H0 - 0.04, 0.008, { color: shade(c, 0.78) }); box(bCt, ctx, x + gs * uu, y + H0 / 2, z - W0 / 2 - 0.004, 0.012, H0 - 0.04, 0.008, { color: shade(c, 0.78) }); }
        box(bCt, ctx, x + gs * (L0 / 2 + 0.004), y + H0 / 2, z, 0.008, H0 - 0.04, W0 - 0.03, { color: shade(c, 0.9) });
      }
      footprint.push({ u0: u - 0.4, u1: u + 0.4, z0: z - 0.16, z1: z + 0.16 });
    };
    const yu0 = uM + 0.55;
    if (L >= 2) { container(yu0, zr + 0.22, 1, 0x2f6fb0, 0xd0553a, 0x9aa5b1); container(yu0, zr + 0.62, 1, 0xd0553a, 0x2f6fb0, 0xe8873a); container(yu0, zr + 1.02, 2, 0x4f8a6a, 0xe8873a, 0x2f6fb0); }
    if (L >= 3) { container(yu0 + 0.86, zr + 0.22, 2, 0xe8873a, 0x2f6fb0, 0xd0553a); container(yu0 + 0.86, zr + 0.62, 3, 0x9aa5b1, 0x4f8a6a, 0xd0553a); container(yu0 + 0.86, zr + 1.02, 1, 0x2f6fb0, 0xe8873a, 0x9aa5b1); }
    if (L >= 5) { container(yu0, zr + 1.42, 3, 0xd0553a, 0x9aa5b1, 0x2f6fb0); container(yu0 + 0.86, zr + 1.42, 2, 0x2f6fb0, 0xe8873a, 0x4f8a6a); }
    // ---- level 3: control tower on the roof: concrete shaft, glass cabin with a flat white roof, radar dish, mast, red/white beacon
    if (L >= 3) {
      const tu = uM - 0.95, tz = zr + 0.5, x = X(tu), ty0 = yu + 0.07, sh = 0.82, cb0 = ty0 + sh, ch = 0.4;
      box(bTr, ctx, x, ty0 + sh / 2, tz, 0.34, sh, 0.34);
      for (let i = 0; i < 3; i++) box(bSt, ctx, x, ty0 + 0.22 + i * 0.26, tz + 0.172, 0.2, 0.05, 0.006);
      box(bTr, ctx, x, cb0 + 0.025, tz, 0.78, 0.05, 0.78);                                    // cabin floor
      box(bGl, ctx, x, cb0 + 0.05 + ch / 2, tz, 0.72, ch, 0.72);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(bSt, ctx, x + sx * 0.36, cb0 + 0.05 + ch / 2, tz + sz * 0.36, 0.035, ch, 0.035);
      for (const sa of [0, 1]) for (const q of [-1, 0, 1]) { box(bSt, ctx, x + (sa ? q * 0.24 : 0), cb0 + 0.05 + ch / 2, tz + (sa ? 0 : q * 0.24) + (sa ? 0.36 : 0) * 0, 0.015, ch, 0.015); }
      box(bSt, ctx, x, cb0 + 0.05 + ch * 0.55, tz, 0.74, 0.02, 0.74);
      box(bTr, ctx, x, cb0 + 0.05 + ch + 0.03, tz, 0.9, 0.06, 0.9);                          // cabin roof
      box(bDt, ctx, x, cb0 + 0.05 + ch + 0.065, tz + 0.45, 0.9, 0.03, 0.012, { color: BLUE });
      cyl(bSt, ctx, x - gs * 0.2, cb0 + ch + 0.11, tz, 0.016, 0.016, 0.38, 6);                // mast
      box(bLp, ctx, x - gs * 0.2, cb0 + ch + 0.5, tz, 0.05, 0.05, 0.05);
      cyl(bSt, ctx, x + gs * 0.22, cb0 + ch + 0.11, tz + 0.1, 0.02, 0.02, 0.16, 6);           // radar dish on a stalk
      box(bDt, ctx, x + gs * 0.22, cb0 + ch + 0.3, tz + 0.1, 0.2, 0.11, 0.025, { color: 0xd8dfe5, rx: -0.3 });
      dims.tower = { x: tu, z: tz, roofY: cb0 + 0.05 + ch + 0.06 };
    }
    // ---- level 4: two gantry light masts at the front corners of the apron + a guard booth with a striped barrier at the apron entrance
    if (L >= 4) {
      for (const [u, z] of [[ua + 0.05, slabZ1 - 0.15], [slabU1 - 0.15, slabZ1 - 0.15]]) {
        const x = X(u); cyl(bSt, ctx, x, y0, z, 0.05, 0.035, 2.35, 6); box(bSt, ctx, x, y0 + 2.35, z, 0.5, 0.04, 0.05);
        for (let i = 0; i < 3; i++) { box(bDt, ctx, x + (i - 1) * 0.16, y0 + 2.42, z, 0.12, 0.08, 0.06, { color: DARK }); box(bLp, ctx, x + (i - 1) * 0.16, y0 + 2.42, z + 0.035, 0.1, 0.06, 0.02); }
        box(bDt, ctx, x, y0 + 0.2, z, 0.12, 0.4, 0.12, { color: YELLOW }); box(bDt, ctx, x, y0 + 0.1, z, 0.122, 0.07, 0.122, { color: DARK });
      }
      const bu0 = uM + 0.5, bz = slabZ1 - 0.5, x = X(bu0);
      box(bTr, ctx, x, y0 + 0.4, bz, 0.4, 0.8, 0.4); box(bGl, ctx, x, y0 + 0.52, bz + 0.202, 0.3, 0.3, 0.01); box(bGl, ctx, x + gs * 0.202, y0 + 0.52, bz, 0.01, 0.3, 0.3); box(bTr, ctx, x, y0 + 0.83, bz, 0.5, 0.05, 0.5); box(bDt, ctx, x, y0 + 0.86, bz + 0.22, 0.5, 0.02, 0.012, { color: ORANGE });
      const ax = x - gs * 0.38; for (let i = 0; i < 6; i++) box(bDt, ctx, ax - gs * (0.02 + i * 0.06), y0 + 0.32, bz, 0.06, 0.04, 0.04, { color: i % 2 ? WHITE : 0xd23c32 });
      footprint.push({ u0: bu0 - 0.22, u1: bu0 + 0.22, z0: bz - 0.22, z1: bz + 0.22 });
    }
    // ---- level 5: sign board on the glass storey roof + solar array on the ground roof
    if (L >= 5) {
      const u0 = ua + 0.4, u1 = uM - 0.5, z = upZ1 + 0.1;
      bu(bDt, u0, u1, yu + 0.07, yu + 0.37, z - 0.02, z + 0.02, { color: NAVY }); bu(bDt, u0, u1, yu + 0.07, yu + 0.095, z + 0.02, z + 0.035, { color: ORANGE });
      let lu = u0 + 0.3; for (let i = 0; i < 10 && lu < u1 - 0.3; i++) { const w = [0.09, 0.06, 0.11, 0.06, 0.09, 0.1, 0.06, 0.11, 0.06, 0.09][i], hh = i % 3 === 1 ? 0.12 : 0.18; if (i === 5) lu += 0.15; bu(bDt, lu, lu + w, yu + 0.22 - hh / 2, yu + 0.22 + hh / 2, z + 0.02, z + 0.034, { color: WHITE }); lu += w + 0.06; }
      for (let i = 0; i < 4; i++) { const pu = ua + 0.35 + i * 0.5; bu(bDt, pu, pu + 0.42, yg + 0.045, yg + 0.075, zr + 0.45, zr + 0.8, { color: 0x24405e }); }
    }

    // ---- assemble
    const group = new THREE.Group();
    group.name = 'terminalV161';
    const add = (m) => { if (m) group.add(m); return m; };
    add(toMesh(bPn, M.plinth, { cast: false }));
    add(toMesh(bWl, M.wallDeep, { cast: true }));
    add(toMesh(bRl, M.roof, { cast: false }));
    add(toMesh(bSt, M.steel, { cast: true }));
    add(toMesh(bTr, M.trim, { cast: true }));
    add(toMesh(bDr, M.roller, {}));
    add(toMesh(bCt, M.detail, { cast: true }));
    add(toMesh(bWd, M.wood, { soft: true }));
    add(toMesh(bDt, M.detail, { soft: true }));
    add(toMesh(bLp, M.lamp, { soft: true, receive: false }));
    add(toMesh(bGl, M.glass, { receive: false }));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.5 * k, 0.2 * k, 0.04 * k), M.door);
    door.position.set(doorX * k, doorY * k, doorZ * k);
    door.userData.v161Door = true; door.castShadow = false; door.receiveShadow = true;
    door.updateMatrix(); door.matrixAutoUpdate = false;
    group.add(door);
    const ud = group.userData;
    ud.v161Logistics = 'terminal'; ud.v161Complete = true; ud.v44Detailed = true; ud.v157Finish = true;
    ud.v161Footprint = footprint.map((f) => { const r = rx(f.u0, f.u1); return { x: (r[0] + r[1]) / 2 * k, z: (f.z0 + f.z1) / 2 * k, hx: (r[1] - r[0]) / 2 * k, hz: (f.z1 - f.z0) / 2 * k }; });
    ud.v161Dims = dims;
    ud.levelV161 = L;
    return group;
  }

  function addTerminalGold(bt, ctx, d, level, bu, X) {
    const { yg, yu, y0, zf, canopy, ua, uM } = d;
    // 6: gold rim line on the canopy fascia + a second row of pips
    bu(canopy.cu0, canopy.cu1, canopy.cy + 0.045, canopy.cy + 0.06, zf + T.canopyD - 0.015, zf + T.canopyD + 0.015);
    for (let i = 0; i < level - 5; i++) bu(d.up.u0 + 0.1 + i * 0.1, d.up.u0 + 0.15 + i * 0.1, yu + 0.015, yu + 0.06, d.up.z1 + 0.1 + 0.0, d.up.z1 + 0.125);
    // 7: gold frames on the gates and the lobby door
    if (level >= 7) {
      GATE_U.slice(0, d.gates).forEach((gu) => { const yb = y0 + 0.04; bu(gu - T.gateW / 2 - 0.05, gu + T.gateW / 2 + 0.05, yb + T.gateH + 0.075, yb + T.gateH + 0.1, zf + 0.07, zf + 0.09); for (const q of [-1, 1]) bu(gu + q * (T.gateW / 2 + 0.03) - 0.012, gu + q * (T.gateW / 2 + 0.03) + 0.012, yb, yb + T.gateH + 0.1, zf + 0.07, zf + 0.09); });
      bu(0.15 - 0.55, 0.15 + 0.55, y0 + 1.23, y0 + 1.26, zf + 0.07, zf + 0.09);
    }
    // 8: gold mullion band on the glass storey (two bars) + gold column caps
    if (level >= 8) {
      bu(d.up.u0, d.up.u1, yu - 0.02, yu + 0.0, d.up.z1 + 0.0, d.up.z1 + 0.03);
      bu(d.up.u0, d.up.u1, yg + 0.2, yg + 0.22, d.up.z1 + 0.0, d.up.z1 + 0.03);
      for (const u of [ua + 0.1, uM - 0.1]) bu(u - 0.05, u + 0.05, canopy.cy - 0.1, canopy.cy - 0.06, zf + T.canopyD - 0.13, zf + T.canopyD - 0.03);
    }
    // 9: a flag pole with a pennant on the corner of the glass roof (the tower stands behind it from level 3)
    if (level >= 9) {
      const px = X(d.up.u0 + 0.3), pz = d.up.z1 - 0.1;
      box(bt, ctx, px, yu + 0.07 + 0.55, pz, 0.03, 1.1, 0.03); cone(bt, ctx, px, yu + 0.07 + 1.1, pz, 0.045, 0.14, 6);
      const gs = d.gs;
      quad(bt, ctx, [px, yu + 1.08, pz], [px + gs * 0.34, yu + 1.0, pz], [px + gs * 0.34, yu + 0.8, pz], [px, yu + 0.88, pz]);
      quad(bt, ctx, [px, yu + 0.88, pz], [px + gs * 0.34, yu + 0.8, pz], [px + gs * 0.34, yu + 1.0, pz], [px, yu + 1.08, pz]);
    }
    // 10: the golden crown on the control tower cabin roof (tower exists from level 3 and the gold tiers use the level-5 silhouette)
    if (level >= 10 && d.tower) {
      const cx = X(d.tower.x), cz = d.tower.z, cy = d.tower.roofY;
      box(bt, ctx, cx, cy + 0.1, cz, 0.5, 0.2, 0.5); box(bt, ctx, cx, cy + 0.24, cz, 0.6, 0.06, 0.6);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 0.21 : 0.24; cone(bt, ctx, cx + Math.cos(a) * r, cy + 0.27, cz + Math.sin(a) * r, 0.06, i % 2 ? 0.2 : 0.34, 6); }
      cone(bt, ctx, cx, cy + 0.27, cz, 0.13, 0.4, 8);
    }
  }

  // ============================================================================================== dispatcher + gold
  function buildLogisticsV161(stage, height, baseSize, level = 1) {
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1;
    if (idx === 10 && typeof buildTerminal === 'function') return buildTerminal(stage, height, baseSize, level);
    return buildWarehouse(stage, height, baseSize, level);
  }

  function addGold(group, stage, level) {
    const d = group.userData.v161Dims, M = smats();
    if (!d) return false;
    const ctx = makeCtx(d.k), bt = batch();
    const gs = d.gs, X = (u) => gs * u;
    const bu = (u0, u1, ya, yb, za, zb) => { const a = gs > 0 ? [u0, u1] : [-u1, -u0]; bxr(bt, ctx, a[0], a[1], ya, yb, za, zb); };
    if (group.userData.v161Logistics === 'terminal') addTerminalGold(bt, ctx, d, level, bu, X);
    else {
      const { uh0, uh1, yw, yr, zf, zr, zc, dockH, y0 } = d, ox = W.ox;
      // 6: gold ridge cap + a second row of pips on the annex sign band
      bu(uh0 - ox - 0.02, uh1 + ox + 0.02, yr + 0.045, yr + 0.085, zc - 0.1, zc + 0.1);
      for (let i = 0; i < level - 5; i++) bu(d.ua0 + 0.2 + i * 0.1, d.ua0 + 0.25 + i * 0.1, d.annex.ya - 0.27, d.annex.ya - 0.22, zf + 0.02, zf + 0.04);
      // 7: gold frames on the roller doors + annex door head
      if (level >= 7) {
        for (let i = 0; i < d.nBays; i++) { const u = uh0 + 0.5 + i * W.pitch + 0.05; bu(u - 0.47, u + 0.47, dockH + 1.12, dockH + 1.15, zf + 0.075, zf + 0.095); bu(u - 0.47, u - 0.43, dockH, dockH + 1.15, zf + 0.075, zf + 0.095); bu(u + 0.43, u + 0.47, dockH, dockH + 1.15, zf + 0.075, zf + 0.095); }
        bu(-0.2 - 0.27, -0.2 + 0.27, y0 + 1.0, y0 + 1.03, zf + 0.025, zf + 0.04);
      }
      // 8: gold rim on the front eave + dock nosing, post caps / canopy rim from level 3
      if (level >= 8) {
        bu(uh0 - ox, uh1 + ox, d.rf.ye - 0.07, d.rf.ye - 0.045, zf + W.oz + 0.012, zf + W.oz + 0.04);
        bu(uh0 - 0.02, uh1 + 0.02, dockH + 0.02, dockH + 0.035, zf + W.dockD - 0.0, zf + W.dockD + 0.025);
        for (const u of [uh0 + 0.02, (uh0 + uh1) / 2, uh1 - 0.02]) bu(u - 0.04, u + 0.04, y0 + 1.45 - 0.0, y0 + 1.5, zf + W.dockD + 0.0, zf + W.dockD + 0.12);
      }
      // 9: a flag pole with a pennant on the annex roof
      if (level >= 9) {
        const px = X((d.ua0 + d.ua1) / 2 - 0.2), pz = d.annex.za0 + 0.2, ya = d.annex.ya;
        box(bt, ctx, px, ya + 0.6, pz, 0.03, 1.2, 0.03); cone(bt, ctx, px, ya + 1.2, pz, 0.045, 0.14, 6);
        quad(bt, ctx, [px, ya + 1.1, pz], [px + gs * 0.34, ya + 1.02, pz], [px + gs * 0.34, ya + 0.82, pz], [px, ya + 0.9, pz]);
        quad(bt, ctx, [px, ya + 0.9, pz], [px + gs * 0.34, ya + 0.82, pz], [px + gs * 0.34, ya + 1.02, pz], [px, ya + 1.1, pz]);
      }
      // 10: the golden crown on the middle of the ridge (a block that reaches into the roof, rim band, 8 points)
      if (level >= 10) {
        const cx = X((uh0 + uh1) / 2), cy = d.monitor ? d.monitor.yt + 0.045 : yr, cz = zc;
        box(bt, ctx, cx, cy + 0.0, cz, 0.5, 0.2, 0.5); box(bt, ctx, cx, cy + 0.14, cz, 0.6, 0.06, 0.6);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 0.21 : 0.24; cone(bt, ctx, cx + Math.cos(a) * r, cy + 0.17, cz + Math.sin(a) * r, 0.06, i % 2 ? 0.2 : 0.34, 6); }
        cone(bt, ctx, cx, cy + 0.17, cz, 0.13, 0.4, 8);
      }
    }
    const mesh = toMesh(bt, M.gold, { cast: true, soft: true, name: 'logisticsGoldV161' });
    if (mesh) group.add(mesh);
    group.userData.goldTierV161 = level;
    return true;
  }

  window.buildLogisticsV161 = buildLogisticsV161;
  window.LogisticsV161 = { enabled: true, build: buildLogisticsV161, addGold, padLocal, dims: { warehouse: W }, version: 'v161-logistics' };
})();
