/* Shop v161 (2026-10-05 (8), "improve physics and design of every building, one at a time", backlog #5: the SHOP = stage 2 of the main line, levels 1-10).
 *
 * buildShopV161(stage, height, baseSize, level) is the live builder of the `shop` archetype for the main-line STAGES entry (createBuildingMesh in tycoon-v161.html calls it instead of
 * buildShop + the three shared polish passes; the flags v161Complete / v44Detailed / v157Finish it sets make them, the v44 micro details and finish-v157 skip it). Other `shop`
 * users (city plots, bases, projects) keep the old builder. `ShopV161.enabled = false` brings the old shop back (the showcase tool uses it for before/after numbers).
 *
 * Design (a recognisable small corner shop; the sawmill v2 is the benchmark: one building, readable silhouette, details, merged meshes):
 *   facade    : cream plaster piers + lintel on a concrete plinth, two big shop windows (frame, mullions, sill, a display of NEUTRAL goods behind the glass - tins, jars, baskets,
 *               nothing that stands for a number the game shows) either side of a framed glass door with a step; brick side and back walls with a cream string course;
 *               striped red / cream awning with a scalloped valance over the whole front; sign board (navy, cream frame) on the raised front parapet with a shopping-basket icon
 *               built from geometry (no sprite, no texture); wall lantern; flat roof with parapet and coping, AC unit, vent, skylight; crates, barrel, bench and planters.
 *   levels    : the SAME building grows by ADDED parts - 1 corner shop, 2 outdoor display stand + chalkboard, 3 second floor (flat, set back, windows with shutters and flower boxes,
 *               terrace on the first roof), 4 stockroom annex on the side away from the upgrade pad (roller door, loading pallet, crates move in front of it), 5 rooftop billboard
 *               with the basket, bunting and two spotlights. Levels 6-10 are gold tiers (ShopV161.addGold, called by assets/late-game-v161.js): gold coping + second pip row (6),
 *               window / door / sign-board frames (7), pilasters + awning rod + roof cap (8), flag pole with a ball (9), the golden crown on the billboard (10).
 *   cost      : everything merged into one mesh per material (about 10 draw calls + the gold mesh instead of 98-129), shared materials flagged `sharedSurfaceV153`.
 *   physics   : `userData.v161Footprint` = the real wall boxes (main body, annex), registered by the v83 registry as oriented boxes with the building's yaw; the awning, steps, props,
 *               planters, bench, crates and the display stand are walkable. The upgrade pad stands outside the collider (the annex is on the other side).
 * The door (a mesh with userData.v161Door, centred on the facade) faces the driveway like the houses'. Front = +z, centred on the origin, k = baseSize / 2.6 scales everything uniformly.
 */
(() => {
  'use strict';
  if (!window.BuildingsV161 || !window.BuildingsV161.kit) return;
  const K = window.BuildingsV161.kit;
  const { batch, box, tri, quad, cone, cyl, blob, makeCtx, toMesh, lin, shade } = K;

  // ---------------------------------------------------------------------------------------------- shared materials (never disposed)
  let SM = null;
  function smats() {
    if (SM) return SM;
    const M = K.mats();
    const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    const fam = (family, color, opts) => share(createSurfaceMaterialV152(family, lin(color), opts));
    SM = {
      brick: fam('brick', 0xc2674a, { roughness: 0.9 }),
      plaster: fam('concrete', 0xf1e6cf, { roughness: 0.88 }),
      trim: M.trim, plinth: M.plinth, wood: M.wood, door: M.door, corr: M.corr, lamp: M.lamp, gold: M.gold, detail: M.detail,
      // shop glass: clearer than the houses' (0.82) so the display behind the window reads
      glass: share(new THREE.MeshStandardMaterial({ color: lin(0xb7dcee), emissive: lin(0x1b3a52), emissiveIntensity: 0.22, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.4, depthWrite: false })),
    };
    return SM;
  }

  // ---------------------------------------------------------------------------------------------- dimensions
  const DIM = { hw: 1.4, hd: 1.15, y0: 0.16, H1: 2.0, band: 0.7, st2: 1.55, annexW: 1.1, annexD: 1.6, annexH: 1.5 };
  const NAVY = 0x23415e, CREAM = 0xf6ecd4, RED = 0xd23c32, TRIM = 0xf6f1e6;

  function buildShopV161(stage, height, baseSize, level = 1) {
    const L = Math.max(1, Math.min(5, Math.floor(level) || 1));
    const k = (baseSize || 2.6) / 2.6;
    const M = smats();
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1;
    const { hw, hd, y0, H1, band, st2 } = DIM, zf = hd, yw1 = y0 + H1;
    const ctx = makeCtx(k);
    // which side is the upgrade pad on (local x sign)? The annex goes to the other side
    let padSide = 1;
    try {
      if (idx >= 0) {
        const axis = stageAccessAxisV92(idx), yaw = Math.atan2(-axis.x, -axis.z);
        const dir = stagePosition(idx).normalize(), tang = { x: -dir.z, z: dir.x };
        padSide = (tang.x * Math.cos(yaw) + tang.z * -Math.sin(yaw)) >= 0 ? 1 : -1;
      }
    } catch (_) { /* detached stage object */ }
    const gs = -padSide;
    const brandC = new THREE.Color(stage && stage.color != null ? stage.color : 0x5ab0ff).multiplyScalar(0.42).getHex();

    const bBr = batch(), bPl = batch(), bTr = batch(), bPn = batch(), bWd = batch(), bCo = batch(), bDt = batch(true), bGl = batch(), bLp = batch();
    const footprint = [{ x: 0, z: 0.02, hx: hw + 0.06, hz: hd + 0.08 }];                                                // walls + string course at the back, window sills and frames at the front
    const dims = { k, hw, hd, y0, yw1, zf, level: L, padSide, gs, top: yw1, billboardTop: 0 };
    const hasTop = L >= 3, annex = L >= 4;
    const yTop = hasTop ? yw1 + st2 : yw1;                                                                          // top roof level
    dims.top = yTop;

    // ---- plinth + ground apron + step
    box(bPn, ctx, 0, y0 / 2, 0, 2 * hw + 0.12, y0, 2 * hd + 0.12);
    box(bDt, ctx, 0, 0.02, zf + 0.34, 2 * hw + 0.3, 0.04, 0.58, { color: 0xd8d2c6 });                                // pavement in front
    box(bPn, ctx, 0, 0.05, zf + 0.2, 0.84, 0.1, 0.36);                                                               // door step (top 0.10)

    // ---- brick body (side + back walls, and the back of the display niches), cream plaster facade (0.3 thick: the window niches are real)
    const t = 0.3;
    box(bBr, ctx, 0, y0 - 0.02 + (H1 + 0.02) / 2, -t / 2, 2 * hw - 0.02, H1 + 0.02, 2 * hd - t);                       // brick body z -hd .. zf - t
    const px = (x0, x1, y1, y2) => box(bPl, ctx, (x0 + x1) / 2, (y1 + y2) / 2, zf - t / 2, x1 - x0, y2 - y1, t);     // facade piece [x0,x1] x [y1,y2]
    px(-hw, -1.28, y0, yw1); px(1.28, hw, y0, yw1);                                                                   // outer piers
    px(-0.42, -0.3, y0, yw1); px(0.3, 0.42, y0, yw1);                                                                  // door jambs
    px(-1.28, -0.42, y0, 0.74); px(0.42, 1.28, y0, 0.74);                                                              // window risers
    px(-hw, hw, 1.8, yw1);                                                                                             // lintel band
    px(-0.3, 0.3, 1.66, 1.8);                                                                                          // door head
    px(-hw, hw, yw1, yw1 + band);                                                                                      // raised front parapet = the sign band
    // string course + corner quoins on the brick walls
    for (const sx of [-1, 1]) box(bPl, ctx, sx * (hw + 0.015), yw1 - 0.1, -t / 2, 0.04, 0.2, 2 * hd - t + 0.04);
    box(bPl, ctx, 0, yw1 - 0.1, -hd - 0.015, 2 * hw + 0.08, 0.2, 0.04);
    for (const sx of [-1, 1]) for (let j = 0; j < 7; j++) box(bPl, ctx, sx * (hw - 0.07), y0 + 0.17 + j * 0.28, -hd + 0.07, j % 2 ? 0.2 : 0.14, 0.22, j % 2 ? 0.14 : 0.2);

    // ---- flat roof: deck, parapets (front = the sign band), coping
    const deckW = 2 * hw - 0.2;
    box(bDt, ctx, 0, yw1 + 0.015, -0.05, deckW, 0.03, 1.8, { color: 0x4a4f57 });
    const par = (cx, cz, w, d, y1, h) => { box(bPl, ctx, cx, y1 + h / 2, cz, w, h, d); box(bTr, ctx, cx, y1 + h + 0.02, cz, w + 0.06, 0.04, d + 0.06); };
    par(0, -hd + 0.1, 2 * hw, 0.2, yw1, 0.32);
    for (const sx of [-1, 1]) par(sx * (hw - 0.1), -0.05, 0.2, 1.8, yw1, 0.32);
    box(bTr, ctx, 0, yw1 + band + 0.02, zf - t / 2, 2 * hw + 0.1, 0.04, t + 0.08);                                    // coping of the sign band

    // ---- shop windows (two), frame, mullions, sill, glass and the display behind it
    const win = (cx, w) => {
      const x0 = cx - w / 2, x1 = cx + w / 2, wy0 = 0.74, wy1 = 1.8, wh = wy1 - wy0, wyc = (wy0 + wy1) / 2;
      for (const sx of [-1, 1]) box(bTr, ctx, cx + sx * (w / 2 - 0.03), wyc, zf - 0.03, 0.06, wh, 0.1);
      box(bTr, ctx, cx, wy0 + 0.03, zf - 0.03, w, 0.06, 0.1); box(bTr, ctx, cx, wy1 - 0.03, zf - 0.03, w, 0.06, 0.1);
      box(bTr, ctx, cx, wy0 + 0.3, zf - 0.04, w, 0.04, 0.06);                                                         // transom bar at the display height
      for (const m of [-1, 1]) box(bTr, ctx, cx + m * w / 6, wyc, zf - 0.045, 0.035, wh - 0.1, 0.05);
      box(bGl, ctx, cx, wyc, zf - 0.07, w - 0.08, wh - 0.08, 0.02);
      box(bTr, ctx, cx, wy0 - 0.035, zf + 0.05, w + 0.16, 0.07, 0.16);                                                // projecting sill
      // niche: back panel + two shelves (z zf - t .. zf - 0.1)
      box(bDt, ctx, cx, wyc, zf - t + 0.012, w - 0.06, wh - 0.06, 0.02, { color: 0xf0dcb0 });
      box(bDt, ctx, cx, 1.28, zf - t + 0.12, w - 0.06, 0.03, 0.22, { color: 0xb88a52 });
      box(bDt, ctx, cx, 0.98 + 0.0, zf - t + 0.12, w - 0.06, 0.03, 0.22, { color: 0xb88a52 });
      return { x0, x1, wy0, wy1 };
    };
    const wl = win(-0.85, 0.86), wr = win(0.85, 0.86);
    // neutral goods (the same on every level: they say nothing about stock): tins, jars, baskets with fruit, boxes, a bottle row
    const gz = zf - t + 0.12;
    const tin = (x, y, c) => cyl(bDt, ctx, x, y, gz, 0.045, 0.045, 0.1, 6, { color: c });
    for (let i = 0; i < 4; i++) { tin(-1.17 + i * 0.1, 1.295, [0xd23c32, 0xf2b522, 0x4f8a4a, 0x3a6fa8][i]); tin(-1.17 + i * 0.1, 1.395, [0xf2b522, 0xd23c32, 0x3a6fa8, 0x4f8a4a][i]); }
    for (let i = 0; i < 3; i++) cyl(bDt, ctx, -0.7 + i * 0.12, 1.295, gz, 0.04, 0.035, 0.2, 6, { color: [0x6aa84f, 0xe8d28a, 0x8a5a3a][i] });          // bottles
    for (let i = 0; i < 4; i++) cyl(bDt, ctx, -1.18 + i * 0.1, 0.995, gz, 0.04, 0.04, 0.09, 6, { color: [0xf2b522, 0xe8d28a, 0x6aa84f, 0xd23c32][i] });   // jars on the lower shelf
    for (let i = 0; i < 3; i++) { box(bDt, ctx, -1.15 + i * 0.28, 0.81, gz, 0.24, 0.14, 0.2, { color: [0xc9a063, 0xb88a52, 0xd8b678][i] }); }                     // boxes on the floor
    blob(bDt, ctx, -0.5, 0.8, gz, 0.07, 0.06, 0.07, 1, { color: 0xd23c32 });
    box(bDt, ctx, 0.85, 0.79, gz, 0.5, 0.1, 0.22, { color: 0xa8743f });                                                                                          // wicker basket
    for (let i = 0; i < 5; i++) blob(bDt, ctx, 0.65 + i * 0.1, 0.86, gz, 0.055, 0.05, 0.055, 0, { color: [0xd23c32, 0x6aa84f, 0xf2b522, 0xd23c32, 0xf08a30][i] });
    for (let i = 0; i < 3; i++) box(bDt, ctx, 0.52 + i * 0.3, 1.395, gz, 0.2, 0.2, 0.18, { color: [0xe8d28a, 0xf6ecd4, 0xc9a063][i] });                             // sacks / boxes on the shelf
    for (let i = 0; i < 4; i++) cyl(bDt, ctx, 0.5 + i * 0.12, 0.995, gz, 0.04, 0.04, 0.12, 6, { color: [0x3a6fa8, 0xe9505a, 0x6aa84f, 0xf2b522][i] });
    box(bDt, ctx, 0.85, 1.62, zf - t + 0.05, 0.5, 0.18, 0.02, { color: 0xd23c32 }); box(bDt, ctx, 0.85, 1.62, zf - t + 0.065, 0.42, 0.04, 0.01, { color: CREAM }); // hanging strip

    // ---- door: jambs + head frame, glass leaf (mesh with userData.v161Door), step, lantern, level pips
    for (const sx of [-1, 1]) box(bTr, ctx, sx * 0.3, y0 + 0.75, zf - 0.04, 0.05, 1.5, 0.1);
    box(bTr, ctx, 0, y0 + 1.5 + 0.035, zf - 0.04, 0.65, 0.07, 0.1);
    box(bDt, ctx, 0, y0 + 0.9, zf - t + 0.012, 0.6, 1.45, 0.02, { color: 0x4a3a30 });                                 // dark shop interior behind the glass door
    box(bGl, ctx, 0, y0 + 0.9, zf - 0.13, 0.5, 1.08, 0.02);                                                          // glass of the door (the wooden kick panel below is the door mesh)
    box(bTr, ctx, 0, y0 + 0.9, zf - 0.125, 0.03, 1.08, 0.03);
    box(bDt, ctx, 0, y0 + 1.15, zf - 0.105, 0.16, 0.1, 0.01, { color: 0xd23c32 });                                    // "OPEN" plate
    for (const sx of [-1, 1]) {                                                                                       // wall lanterns on the inner piers
      box(bDt, ctx, sx * 0.36, 1.5, zf + 0.04, 0.03, 0.03, 0.08, { color: 0x3b4350 });
      box(bLp, ctx, sx * 0.36, 1.43, zf + 0.09, 0.09, 0.13, 0.09);
    }
    for (let i = 0; i < L; i++) box(bDt, ctx, -0.2 + i * 0.1, 1.88, zf + 0.012, 0.055, 0.055, 0.02, { color: 0xe9b64a });                                          // level pips on the lintel

    // ---- striped awning (8 stripes) with scalloped valance, over the whole front
    {
      const nS = 8, ax0 = -1.5, ax1 = 1.5, sw = (ax1 - ax0) / nS, yh = 2.04, yl = 1.8, zb = zf + 0.02, zfr = zf + 0.74;
      for (let i = 0; i < nS; i++) {
        const x0 = ax0 + i * sw, x1 = x0 + sw, c = i % 2 ? CREAM : RED, cd = i % 2 ? 0xc9bd9f : 0x9c2a22;
        quad(bDt, ctx, [x0, yh, zb], [x0, yl, zfr], [x1, yl, zfr], [x1, yh, zb], { color: c });                       // top (faces up)
        quad(bDt, ctx, [x0, yh - 0.02, zb], [x1, yh - 0.02, zb], [x1, yl - 0.02, zfr], [x0, yl - 0.02, zfr], { color: cd }); // underside (faces down)
        quad(bDt, ctx, [x0, yl, zfr], [x0, yl - 0.1, zfr], [x1, yl - 0.1, zfr], [x1, yl, zfr], { color: c });          // valance
        tri(bDt, ctx, [x0, yl - 0.1, zfr], [(x0 + x1) / 2, yl - 0.18, zfr], [x1, yl - 0.1, zfr], { color: c });        // scallop
      }
      for (const sx of [-1, 1]) { // side flaps + brackets
        quad(bDt, ctx, [sx * ax1, yh, zb], [sx * ax1, yl, zfr], [sx * ax1, yl - 0.1, zfr], [sx * ax1, yh - 0.1, zb], { color: 0x9c2a22 });
        quad(bDt, ctx, [sx * ax1, yh - 0.1, zb], [sx * ax1, yl - 0.1, zfr], [sx * ax1, yl, zfr], [sx * ax1, yh, zb], { color: 0x9c2a22 });
        box(bDt, ctx, sx * 1.42, 1.7, zf + 0.35, 0.03, 0.03, 0.62, { rx: 0.35, color: 0x3b4350 });
      }
      box(bTr, ctx, 0, yh + 0.01, zb + 0.005, 3.04, 0.04, 0.04);                                                       // wall rail
    }

    // ---- sign board on the sign band: navy plate, cream frame, basket icon + text-like bars
    {
      const sy = yw1 + band / 2 + 0.02, sw2 = 2.5, sh = 0.52, sz = zf + 0.02;
      box(bDt, ctx, 0, sy, sz, sw2, sh, 0.05, { color: brandC });
      for (const sy2 of [-1, 1]) box(bDt, ctx, 0, sy + sy2 * (sh / 2 - 0.015), sz + 0.03, sw2, 0.03, 0.02, { color: CREAM });
      for (const sx of [-1, 1]) box(bDt, ctx, sx * (sw2 / 2 - 0.015), sy, sz + 0.03, 0.03, sh, 0.02, { color: CREAM });
      basket(bDt, ctx, -0.75, sy - 0.02, sz + 0.03, 0.44, 0xf2b522, 0xe9505a);
      { let lx = 0.0; // text-like bars: 'letters' of two heights with a word gap (no real text, no texture), all inside the board (x -0.2 .. 1.15)
        for (let i = 0; i < 10; i++) { const w = [0.07, 0.05, 0.09, 0.05, 0.07, 0.08, 0.05, 0.09, 0.06, 0.07][i], hh = i % 3 === 1 ? 0.14 : 0.2; if (i === 5) lx += 0.1; box(bDt, ctx, lx + w / 2, sy + 0.06 + (0.2 - hh) / 2, sz + 0.03, w, hh, 0.015, { color: CREAM }); lx += w + 0.04; }
      }
      box(bDt, ctx, 0.5, sy - 0.14, sz + 0.03, 1.4, 0.035, 0.012, { color: 0xf2b522 });
      dims.sign = { y: sy, z: sz, w: sw2, h: sh };
    }

    // ---- roof gear: AC unit with fan, vent pipe + cowl, skylight (on the top roof, at the back)
    {
      const ay = yTop + 0.03, bz = -hd + 0.62, ax = hasTop ? 0.62 : -0.55;
      box(bDt, ctx, ax, ay + 0.2, bz, 0.7, 0.4, 0.46, { color: 0xa5b0ba });
      cyl(bDt, ctx, ax, ay + 0.4, bz, 0.17, 0.17, 0.04, 8, { color: 0x4a4f57 });
      for (let i = -1; i <= 1; i++) box(bDt, ctx, ax, ay + 0.2 + i * 0.1, bz + 0.235, 0.5, 0.025, 0.012, { color: 0x6f7883 });
      cyl(bDt, ctx, -ax, ay, bz - 0.1, 0.05, 0.05, 0.4, 6, { color: 0x8a929b }); cyl(bDt, ctx, -ax, ay + 0.4, bz - 0.1, 0.09, 0.0, 0.07, 6, { color: 0x6f7883 });
      if (!hasTop) { box(bTr, ctx, 0.1, ay + 0.05, bz + 0.35, 0.56, 0.1, 0.56); box(bGl, ctx, 0.1, ay + 0.105, bz + 0.35, 0.44, 0.012, 0.44); }
    }

    // ---- level 2: outdoor display stand + chalkboard (in front of the window riser, below the glass), flower tubs
    if (L >= 2) {
      const sx = -0.85, sz = zf + 0.36;
      box(bWd, ctx, sx, 0.34, sz, 0.8, 0.06, 0.34);                                                                   // top
      for (const px2 of [-1, 1]) for (const pz of [-1, 1]) box(bWd, ctx, sx + px2 * 0.35, 0.16, sz + pz * 0.13, 0.05, 0.32, 0.05);
      box(bWd, ctx, sx, 0.52, sz + 0.06, 0.74, 0.05, 0.22, { rx: -0.0 });                                           // upper tier
      for (const px2 of [-1, 1]) box(bWd, ctx, sx + px2 * 0.33, 0.43, sz + 0.06, 0.04, 0.14, 0.04);
      for (let i = 0; i < 6; i++) blob(bDt, ctx, sx - 0.3 + i * 0.12, 0.42, sz - 0.04, 0.052, 0.045, 0.052, 0, { color: [0xd23c32, 0x6aa84f, 0xf2b522, 0xd23c32, 0xf08a30, 0x6aa84f][i] });
      for (let i = 0; i < 5; i++) blob(bDt, ctx, sx - 0.26 + i * 0.13, 0.6, sz + 0.06, 0.05, 0.045, 0.05, 0, { color: [0xf08a30, 0xf2b522, 0xd23c32, 0x6aa84f, 0xf2b522][i] });
      box(bDt, ctx, 0.85, 0.32, zf + 0.22, 0.42, 0.56, 0.04, { rx: -0.2, color: 0x2d3a34 }); box(bDt, ctx, 0.85, 0.32, zf + 0.22 + 0.015, 0.34, 0.48, 0.01, { rx: -0.2, color: 0xe8e4d6 }); // chalkboard (on the other window)
      for (const q of [-1, 1]) { cyl(bDt, ctx, q * 0.58, 0.04, zf + 0.62, 0.11, 0.09, 0.16, 8, { color: 0x8c6a48 }); blob(bDt, ctx, q * 0.58, 0.28, zf + 0.62, 0.15, 0.12, 0.15, 1, { color: 0x4f8a4a }); blob(bDt, ctx, q * 0.58 + 0.04, 0.38, zf + 0.62, 0.05, 0.05, 0.05, 0, { color: q > 0 ? 0xf08ab0 : 0xf2b522 }); }
    }

    // ---- level 3: second floor (brick, set back, 0.7 m terrace in front), windows with shutters + flower boxes, own flat roof + parapet
    if (hasTop) {
      const z2f = 0.15, z2b = -hd + 0.2, w2 = 2 * hw - 0.3;
      box(bBr, ctx, 0, yw1 + st2 / 2, (z2f + z2b) / 2, w2, st2, z2f - z2b);
      box(bPl, ctx, 0, yw1 + st2 / 2, z2f - 0.005, w2 - 0.2, st2 - 0.1, 0.03);                                         // plaster front face
      box(bPl, ctx, 0, yTop - 0.1, (z2f + z2b) / 2, w2 + 0.08, 0.2, z2f - z2b + 0.08);                                // string course
      for (const sx of [-0.62, 0.62]) {
        const wy = yw1 + 0.72, ww = 0.5, wh = 0.7;
        box(bTr, ctx, sx, wy, z2f + 0.015, ww + 0.14, wh + 0.14, 0.03); box(bGl, ctx, sx, wy, z2f + 0.035, ww, wh, 0.02);
        box(bTr, ctx, sx, wy, z2f + 0.05, 0.03, wh, 0.02); box(bTr, ctx, sx, wy + 0.1, z2f + 0.05, ww, 0.03, 0.02);
        box(bTr, ctx, sx, wy - wh / 2 - 0.09, z2f + 0.06, ww + 0.2, 0.05, 0.11);
        for (const q of [-1, 1]) box(bDt, ctx, sx + q * (ww / 2 + 0.19), wy, z2f + 0.03, 0.17, wh + 0.1, 0.035, { color: 0x4f7f5a });
        box(bDt, ctx, sx, wy - wh / 2 - 0.2, z2f + 0.1, ww + 0.1, 0.1, 0.14, { color: 0x6b4a2f });
        for (let i = 0; i < 4; i++) blob(bDt, ctx, sx + (i - 1.5) * 0.14, wy - wh / 2 - 0.12, z2f + 0.1, 0.05, 0.05, 0.05, 0, { color: [0xe9505a, 0xf6c445, 0xf08ab0, 0xe9505a][i] });
      }
      for (const sx of [-1, 1]) { // small side windows
        ctxWinSide(bTr, bGl, ctx, sx * (w2 / 2), yw1 + 0.75, -0.3, sx);
      }
      par(0, z2b + 0.1, w2, 0.2, yTop, 0.28);
      for (const sx of [-1, 1]) par(sx * (w2 / 2 - 0.1), (z2f + z2b) / 2, 0.2, z2f - z2b - 0.2, yTop, 0.28);
      par(0, z2f - 0.1, w2, 0.2, yTop, 0.28);
      box(bDt, ctx, 0, yTop + 0.015, (z2f + z2b) / 2, w2 - 0.4, 0.03, z2f - z2b - 0.4, { color: 0x4a4f57 });
      // terrace on the first roof: tubs with shrubs + a small table
      for (const q of [-1, 1]) { box(bDt, ctx, q * 0.95, yw1 + 0.12, 0.5, 0.5, 0.16, 0.2, { color: 0x8c6a48 }); blob(bDt, ctx, q * 0.95, yw1 + 0.3, 0.5, 0.26, 0.15, 0.1, 1, { color: 0x4f8a4a }); }
      cyl(bDt, ctx, 0.0, yw1 + 0.03, 0.5, 0.2, 0.2, 0.04, 8, { color: 0xe8e4d6 }); cyl(bDt, ctx, 0, yw1 + 0.03, 0.5, 0.025, 0.025, 0.3, 5, { color: 0x3b4350 }); cyl(bDt, ctx, 0, yw1 + 0.3, 0.5, 0.2, 0.2, 0.03, 8, { color: 0xe8e4d6 });
      dims.second = { z2f, z2b, w2, yTop };
    }

    // ---- level 4: stockroom annex on the side away from the upgrade pad: brick box with a roller door, small awning over it, pallet + crates in front, window on the outer wall
    if (annex) {
      const aw = DIM.annexW, ad = DIM.annexD, ah = DIM.annexH, ax = gs * (hw + aw / 2 - 0.05), az = -hd + 0.1 + ad / 2, aF = az + ad / 2, yA = y0 + ah;
      box(bPn, ctx, ax, y0 / 2, az, aw + 0.12, y0, ad + 0.12);
      box(bBr, ctx, ax, y0 - 0.02 + (ah + 0.02) / 2, az, aw, ah + 0.02, ad);
      box(bPl, ctx, ax, yA - 0.1, az, aw + 0.07, 0.2, ad + 0.07);                                                      // string course
      par(ax, az, aw + 0.0, ad + 0.0, yA, 0.2); box(bDt, ctx, ax, yA + 0.015, az, aw - 0.3, 0.03, ad - 0.3, { color: 0x4a4f57 });
      // roller door (corrugated) on the annex front + frame + a little awning
      box(bCo, ctx, ax, y0 + 0.52, aF + 0.02, 0.8, 1.04, 0.04);
      for (let i = 0; i < 6; i++) box(bTr, ctx, ax, y0 + 0.1 + i * 0.17, aF + 0.045, 0.8, 0.012, 0.012);
      for (const q of [-1, 1]) box(bTr, ctx, ax + q * 0.44, y0 + 0.54, aF + 0.03, 0.06, 1.08, 0.06);
      box(bTr, ctx, ax, y0 + 1.1, aF + 0.03, 0.94, 0.07, 0.06);
      { const nS = 4, x0 = ax - 0.5, sw = 1.0 / nS, yh = y0 + 1.3, yl = y0 + 1.15, zb = aF + 0.02, zfr = aF + 0.5;
        for (let i = 0; i < nS; i++) { const xa = x0 + i * sw, xb = xa + sw, c = i % 2 ? CREAM : 0x3a6fa8;
          quad(bDt, ctx, [xa, yh, zb], [xa, yl, zfr], [xb, yl, zfr], [xb, yh, zb], { color: c });
          quad(bDt, ctx, [xa, yh - 0.02, zb], [xb, yh - 0.02, zb], [xb, yl - 0.02, zfr], [xa, yl - 0.02, zfr], { color: shade(c, 0.8) });
          quad(bDt, ctx, [xa, yl, zfr], [xa, yl - 0.07, zfr], [xb, yl - 0.07, zfr], [xb, yl, zfr], { color: c }); } }
      ctxWinSide(bTr, bGl, ctx, gs * (hw - 0.05 + aw), y0 + 0.95, az, gs);
      // pallet + boxes + barrel in front of the annex (walkable props)
      box(bWd, ctx, ax, 0.05, aF + 0.4, 0.7, 0.1, 0.5);
      for (let i = 0; i < 3; i++) box(bDt, ctx, ax + (i - 1) * 0.21, 0.22, aF + 0.4, 0.2, 0.24, 0.3, { color: [0xc9a063, 0xb88a52, 0xd8b678][i] });
      box(bDt, ctx, ax, 0.44, aF + 0.4, 0.3, 0.2, 0.3, { color: 0xc9a063 });
      footprint.push({ x: ax, z: az, hx: aw / 2 + 0.04, hz: ad / 2 + 0.04 });
      dims.annex = { x: ax, z: az, w: aw, d: ad, front: aF, top: yA };
    }

    // ---- side props (crates + barrel + bench): on the annex side; from level 4 on they stand around the annex front instead (never inside its walls)
    if (!annex) {
      const bx = gs * (hw + 0.34), bz = 0.1;
      for (let i = 0; i < 2; i++) box(bWd, ctx, bx, 0.17 + i * 0.34, bz - 0.35 + (i ? 0.03 : 0), 0.36, 0.34, 0.36, { ry: i * 0.3 });
      box(bWd, ctx, bx + 0.02, 0.17, bz - 0.78, 0.34, 0.34, 0.34, { ry: -0.2 });
      cyl(bDt, ctx, bx, 0, bz + 0.15, 0.17, 0.17, 0.5, 8, { color: 0x6b4a2f }); box(bDt, ctx, bx, 0.18, bz + 0.15, 0.36, 0.025, 0.36, { color: 0x3b4350 }); box(bDt, ctx, bx, 0.38, bz + 0.15, 0.36, 0.025, 0.36, { color: 0x3b4350 });
      bench(bWd, bDt, ctx, bx, bz + 0.72, gs > 0 ? Math.PI / 2 : -Math.PI / 2);
    } else {
      const aF = dims.annex.front, ax = dims.annex.x;
      for (let i = 0; i < 2; i++) box(bWd, ctx, gs * 1.72, 0.17 + i * 0.34, aF + 0.3, 0.36, 0.34, 0.36, { ry: i * 0.3 });
      cyl(bDt, ctx, gs * 2.3, 0, aF + 0.28, 0.17, 0.17, 0.5, 8, { color: 0x6b4a2f }); box(bDt, ctx, gs * 2.3, 0.18, aF + 0.28, 0.36, 0.025, 0.36, { color: 0x3b4350 }); box(bDt, ctx, gs * 2.3, 0.38, aF + 0.28, 0.36, 0.025, 0.36, { color: 0x3b4350 });
      bench(bWd, bDt, ctx, gs * 2.0, aF + 1.05, 0);
    }

    // ---- level 5: rooftop billboard (two posts, board with the basket, spotlights) + string lights under the awning
    if (L >= 5) {
      const by = yTop + 0.03, bz = -hd + 0.55, bw = 1.7, bh = 0.64, bBot = by + 0.55;
      for (const sx of [-1, 1]) box(bDt, ctx, sx * 0.6, by + 0.3, bz, 0.07, 0.6, 0.07, { color: 0x3b4350 });
      box(bDt, ctx, 0, bBot + bh / 2, bz, bw, bh, 0.07, { color: brandC });
      box(bDt, ctx, 0, bBot + bh - 0.02, bz + 0.04, bw, 0.04, 0.02, { color: CREAM }); box(bDt, ctx, 0, bBot + 0.02, bz + 0.04, bw, 0.04, 0.02, { color: CREAM });
      for (const sx of [-1, 1]) box(bDt, ctx, sx * (bw / 2 - 0.02), bBot + bh / 2, bz + 0.04, 0.04, bh, 0.02, { color: CREAM });
      basket(bDt, ctx, -0.45, bBot + bh / 2, bz + 0.045, 0.4, 0xf2b522, 0xe9505a);
      for (let i = 0; i < 4; i++) box(bDt, ctx, 0.08 + i * 0.22, bBot + bh / 2 + 0.02, bz + 0.045, [0.16, 0.1, 0.18, 0.12][i], 0.14, 0.012, { color: CREAM });
      for (const sx of [-1, 1]) { box(bDt, ctx, sx * 0.4, bBot + bh + 0.12, bz + 0.12, 0.05, 0.2, 0.05, { color: 0x3b4350 }); box(bLp, ctx, sx * 0.4, bBot + bh + 0.22, bz + 0.2, 0.1, 0.1, 0.12); }
      dims.billboardTop = bBot + bh; dims.billboard = { y: bBot, h: bh, w: bw, z: bz };
      // string lights under the awning edge: a wire and 11 warm bulbs
      box(bDt, ctx, 0, 1.76, zf + 0.5, 2.7, 0.012, 0.012, { color: 0x3b4350 });
      for (let i = 0; i < 11; i++) box(bLp, ctx, -1.3 + i * 0.26, 1.72, zf + 0.5, 0.05, 0.06, 0.05);
    }

    // ---- assemble
    const group = new THREE.Group();
    group.name = 'shopV161';
    const add = (m) => { if (m) group.add(m); return m; };
    add(toMesh(bPn, M.plinth, { cast: false }));
    add(toMesh(bBr, M.brick, { cast: true }));
    add(toMesh(bPl, M.plaster, { cast: true }));
    add(toMesh(bTr, M.trim, { cast: false }));
    add(toMesh(bWd, M.wood, { soft: true }));                                                                          // crates, pallet, bench, display stand: props, walkable
    add(toMesh(bCo, M.corr, {}));
    add(toMesh(bDt, M.detail, { soft: true }));
    add(toMesh(bLp, M.lamp, { soft: true, receive: false }));
    add(toMesh(bGl, M.glass, { receive: false }));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.52 * k, 0.34 * k, 0.05 * k), M.door);          // the door's wooden kick panel under the glass, measured by the door tests
    door.position.set(0, (y0 + 0.17) * k, (zf - 0.13) * k);
    door.userData.v161Door = true; door.castShadow = false; door.receiveShadow = true;
    door.updateMatrix(); door.matrixAutoUpdate = false;
    group.add(door);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05 * k, 0.05 * k, 0.04 * k), M.gold);
    knob.position.set(0.2 * k, (y0 + 0.75) * k, (zf - 0.1) * k); knob.updateMatrix(); knob.matrixAutoUpdate = false; knob.userData.v161Soft = true; knob.userData.v161Knob = true;
    group.add(knob);

    const ud = group.userData;
    ud.v161Shop = true; ud.v161Complete = true; ud.v44Detailed = true; ud.v157Finish = true;
    ud.v161Footprint = footprint.map((f) => ({ x: f.x * k, z: f.z * k, hx: f.hx * k, hz: f.hz * k }));
    ud.v161Dims = dims;
    ud.levelV161 = L;
    return group;
  }

  // ---------------------------------------------------------------------------------------------- small parts
  // shopping basket icon: tapered body (wider at the top), woven bands, arched handle, two fruits; centre (cx, cy, z), width w, plain geometry on a sign board
  function basket(bt, ctx, cx, cy, z, w, c1, c2) {
    const h = w * 0.62, y1 = cy - h / 2, y2 = cy + h / 2 - w * 0.12, wb = w * 0.36, wt = w * 0.5;
    quad(bt, ctx, [cx - wb, y1, z], [cx + wb, y1, z], [cx + wt, y2, z], [cx - wt, y2, z], { color: c1 });
    for (let i = 1; i <= 2; i++) { const yy = y1 + (y2 - y1) * i / 3, ww = wb + (wt - wb) * i / 3; box(bt, ctx, cx, yy, z + 0.005, ww * 2 - 0.02, 0.018, 0.006, { color: shade(c1, 0.65) }); }
    box(bt, ctx, cx - wt * 0.62, (y2 + y2 + w * 0.34) / 2, z + 0.004, 0.028, w * 0.34, 0.012, { rz: 0.28, color: c1 });
    box(bt, ctx, cx + wt * 0.62, (y2 + y2 + w * 0.34) / 2, z + 0.004, 0.028, w * 0.34, 0.012, { rz: -0.28, color: c1 });
    box(bt, ctx, cx, y2 + w * 0.34, z + 0.004, wt * 0.72, 0.03, 0.012, { color: c1 });
    blob(bt, ctx, cx - wt * 0.35, y2 + 0.015, z + 0.02, w * 0.1, w * 0.1, 0.02, 0, { color: c2 });
    blob(bt, ctx, cx + wt * 0.3, y2 + 0.02, z + 0.02, w * 0.09, w * 0.09, 0.02, 0, { color: 0x6aa84f });
  }
  // park bench: seat + back + 2 legs; ry turns it
  function bench(bw, bd, ctx, x, z, ry) {
    ctx.at(x, 0, z, ry, () => {
      box(bw, ctx, 0, 0.26, 0, 0.78, 0.05, 0.28); box(bw, ctx, 0, 0.5, -0.12, 0.78, 0.18, 0.04);
      for (const q of [-1, 1]) { box(bd, ctx, q * 0.33, 0.12, 0, 0.05, 0.24, 0.24, { color: 0x3b4350 }); box(bd, ctx, q * 0.33, 0.38, -0.12, 0.05, 0.28, 0.04, { color: 0x3b4350 }); }
    });
  }
  // a small framed side window on a wall at x (facing +-x), centre (x, y, z)
  function ctxWinSide(bTr, bGl, ctx, x, y, z, sx) {
    ctx.at(x, y, z, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
      box(bTr, ctx, 0, 0, 0.01, 0.58, 0.68, 0.03); box(bGl, ctx, 0, 0, 0.03, 0.46, 0.56, 0.02); box(bTr, ctx, 0, 0, 0.045, 0.03, 0.56, 0.02); box(bTr, ctx, 0, 0, 0.045, 0.46, 0.03, 0.02);
      box(bTr, ctx, 0, -0.37, 0.05, 0.7, 0.05, 0.1);
    });
  }

  // ---------------------------------------------------------------------------------------------- gold tiers 6..10 (one extra mesh, like the house's)
  function addShopGold(group, stage, level) {
    const d = group.userData.v161Dims, M = smats();
    if (!d) return false;
    const ctx = makeCtx(d.k), bt = batch();
    const { hw, hd, y0, yw1, zf, top } = d, band = DIM.band;
    const sg = d.sign, bb = d.billboard;
    // 6: gold coping on the sign band + a second pip row (one pip per tier above 5) on the lintel
    box(bt, ctx, 0, yw1 + band + 0.065, zf - 0.15, 2 * hw + 0.12, 0.04, 0.34);
    for (let i = 0; i < level - 5; i++) box(bt, ctx, -0.2 + i * 0.1, 2.06, zf + 0.012, 0.055, 0.055, 0.02);
    // 7: gold frames: the two shop windows, the door head, the sign board
    if (level >= 7) {
      for (const cx of [-0.85, 0.85]) { box(bt, ctx, cx, 1.8 + 0.012, zf + 0.025, 0.96, 0.025, 0.03); box(bt, ctx, cx, 0.74 - 0.012, zf + 0.02, 0.96, 0.025, 0.03); for (const sx of [-1, 1]) box(bt, ctx, cx + sx * 0.46, 1.27, zf + 0.025, 0.025, 1.06, 0.03); }
      box(bt, ctx, 0, 1.8 - 0.005, zf + 0.03, 0.72, 0.025, 0.03);
      if (sg) { const e = 0.012; box(bt, ctx, 0, sg.y + sg.h / 2 + e, sg.z + 0.045, sg.w + 0.06, 0.03, 0.03); box(bt, ctx, 0, sg.y - sg.h / 2 - e, sg.z + 0.045, sg.w + 0.06, 0.03, 0.03); for (const sx of [-1, 1]) box(bt, ctx, sx * (sg.w / 2 + 0.03), sg.y, sg.z + 0.045, 0.03, sg.h + 0.06, 0.03); }
    }
    // 8: gold pilasters on the outer piers, awning rod, cap on the top parapet front
    if (level >= 8) {
      for (const sx of [-1, 1]) box(bt, ctx, sx * (hw - 0.05), y0 + (yw1 + band - y0) / 2, zf + 0.025, 0.06, yw1 + band - y0, 0.04);
      box(bt, ctx, 0, 1.8 + 0.0, zf + 0.76, 3.04, 0.035, 0.035);
      if (d.second) { const s2 = d.second; box(bt, ctx, 0, d.top + 0.355, s2.z2f - 0.1, s2.w2 + 0.1, 0.03, 0.26); }
    }
    // 9: a flag pole with a ball and a pennant on the roof corner
    if (level >= 9) {
      const px = -hw + 0.35, pz = -hd + 0.4;
      box(bt, ctx, px, top + 0.75, pz, 0.035, 1.5, 0.035);
      cone(bt, ctx, px, top + 1.5, pz, 0.05, 0.16, 6);
      quad(bt, ctx, [px, top + 1.4, pz], [px + 0.36, top + 1.3, pz], [px + 0.36, top + 1.1, pz], [px, top + 1.2, pz]);
      quad(bt, ctx, [px, top + 1.2, pz], [px + 0.36, top + 1.1, pz], [px + 0.36, top + 1.3, pz], [px, top + 1.4, pz]);
    }
    // 10: the golden crown. On the billboard when there is one (it always is: gold tiers use the level-5 silhouette), else in the middle of the roof
    if (level >= 10) {
      const cx = 0, cz = bb ? bb.z : -0.1, cy = bb ? bb.y + bb.h : top + 0.03;
      box(bt, ctx, cx, cy + 0.11, cz, 0.5, 0.22, 0.5); box(bt, ctx, cx, cy + 0.25, cz, 0.6, 0.06, 0.6);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 0.21 : 0.24; cone(bt, ctx, cx + Math.cos(a) * r, cy + 0.28, cz + Math.sin(a) * r, 0.06, i % 2 ? 0.2 : 0.32, 6); }
      cone(bt, ctx, cx, cy + 0.28, cz, 0.13, 0.36, 8);
    }
    const mesh = toMesh(bt, M.gold, { cast: true, soft: true, name: 'shopGoldV161' });
    if (mesh) group.add(mesh);
    group.userData.goldTierV161 = level;
    return true;
  }

  window.buildShopV161 = buildShopV161;
  window.ShopV161 = { enabled: true, buildShop: buildShopV161, addGold: addShopGold, dims: DIM, version: 'v161-shop' };
})();
