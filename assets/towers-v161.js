/* Offices + towers v161 (2026-10-06 (11), "improve physics and design of every building, one at a time", backlog #10 + #11).
 *
 * OFFICES: buildOfficeV161(stage, height, baseSize, level) is the live builder of the `office` archetype for the four main-line STAGES entries (6 "Офис", 7 "Бизнес-центр", 11 "Исследовательский центр",
 * 14 "Конгресс-центр"); TOWERS: buildTowerV161 is the live builder of the `tower` archetype for stages 8 "Небоскрёб", 9 "Империя", 12 "Гранд-отель", 15 "Финансовый квартал". createBuildingMesh in
 * tycoon-v161.html calls them instead of buildOffice / buildTower + the three shared polish passes (the flags v161Complete / v44Detailed / v157Finish make those skip them). City / base / project
 * buildings that share the archetypes keep the old builders. `OfficeTowerV161.enabled = false` brings the old ones back (showcase before / after).
 * The old builders stretched ONE slab by 18 % per level (offices 8.7 -> 15-20 m "pencils", towers 20 -> 34 m at L5, 28-51 m with the crown) and duplicated the crown / gold; here every level ADDS floors from a
 * repeated floor module, wings, setbacks and roof gear to the SAME building, the height grows by whole floors only (<= 1.6 m per level), the golden crown exists exactly once (level 10, from addGold).
 * Everything is drawn in an "outward" frame like the warehouse / factories: padLocal(idx) is the real upgrade pad in the building frame (all eight pads are on local +x), the solid parts stay >= 0.95 m from it
 * and the wings / growth go AWAY from it (u = distance along the long axis away from the pad, world x = gs * u, front = +z = the driveway, the entrance niche stands within ~0.5 m of the road axis).
 * Window grid = vertex-coloured merged quads (no textures): glass panes with per-pane tone, spandrel bands and mullions / fins; a subset of panes (30-45 %) is a second mesh with ONE shared emissive material
 * that glows at night (isNightV40(), 90 ms tick, no per-frame allocation); the aviation light on a mast blinks through a second shared material (emissive only, no real light).
 *   stage 6  office            : cream concrete + violet-blue glass slab, ground-floor lobby with a revolving door in a niche and a canopy, wing (L3), setback top floor + terrace (L4), service core + sign (L5)
 *   stage 7  business centre   : TWIN wings joined by a glazed atrium (L1 wing A, L2 wing B, L3 atrium, L5 rooftop terrace with pergola)
 *   stage 11 research centre   : white panel lab block + teal glass, round lab drum (L2) with an observatory dome (L3), solar roof (L4), satellite dish + bridge (L5)
 *   stage 14 convention centre : stone hall with a colonnade portico (L1 4 columns, L4 6), wings (L2, L4), central glazed rotunda + dome (L3), flag poles (L5)
 *   stage 8  skyscraper        : base podium + tapering glass shaft with setback tiers, antenna with an aviation light
 *   stage 9  Empire            : art-deco stone piers + bronze glass, ziggurat tiers, stepped cap + mast; the golden crown only at level 10
 *   stage 12 grand hotel       : wide slab with balcony slabs, porte-cochere, banquet wing, rooftop sign
 *   stage 15 financial quarter : cluster of up to three towers on a plaza podium with a skybridge, heliport / spires at level 5
 * Gold 6-10 through OfficeTowerV161.addGold (called from assets/late-game-v161.js): gold line / pips (6), canopy + door frame + fin caps (7), spandrel stripes (8), mast / spire (9), the crown (10).
 * cost: ~9-12 merged meshes per building (one per material), shared materials flagged `sharedSurfaceV153`; physics: `userData.v161Footprint` = the real wall boxes (the shaft stands inside the podium) -> v83
 * registry oriented boxes; lobby / porch / steps / plaza / canopy / planters are walkable.
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
      wall: { cream: fam('concrete', 0xe7e0d2, { roughness: 0.9 }), white: fam('concrete', 0xeef1f4, { roughness: 0.85 }), stone: fam('concrete', 0xd2c5a6, { roughness: 0.92 }), sand: fam('concrete', 0xd9c79c, { roughness: 0.9 }), slate: fam('concrete', 0xaab2bd, { roughness: 0.88 }) },
      steel: fam('metal', 0x66717e, { roughness: 0.5 }),
      plinth: M.plinth, trim: M.trim, detail: M.detail, glass: M.glass, lamp: M.lamp, gold: M.gold,
      // opaque curtain wall: vertex colours = pane tones (a glass look without an environment map)
      curtain: share(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.18, emissive: lin(0x12202e), emissiveIntensity: 0.22 })),
      // the lit panes: ONE material shared by every office / tower; emissive follows the day (windowTick)
      win: share(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1, emissive: lin(0xffc874), emissiveIntensity: 0.0 })),
      // aviation light: emissive only, blinks (windowTick)
      beacon: share(new THREE.MeshStandardMaterial({ color: lin(0xff4a3a), emissive: lin(0xff2a1a), emissiveIntensity: 0.3, roughness: 0.4 })),
      // the glazed lobby / atrium: the shared transparent glass family
      lobby: share(new THREE.MeshStandardMaterial({ color: lin(0x8fc4e0), emissive: lin(0x1b3a52), emissiveIntensity: 0.3, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55, depthWrite: false })),
    };
    return SM;
  }

  // palettes (sRGB hex): glass tones, spandrel, fins, the accent of the sign
  const PAL = {
    6: { wall: 'cream', glass: [0x4a6a9a, 0x5b7eae, 0x6d92bd], spand: 0xe4ded0, fin: 0xf4f1ea, core: 0x3b4a63, acc: 0xa561d9, dark: 0x2c3447, lit: 0xffe2a8 },
    7: { wall: 'white', glass: [0x3d6f8d, 0x4d8099, 0x5f98ac], spand: 0xcfd5da, fin: 0xeef2f5, core: 0x2f4a5e, acc: 0x8a4fd0, dark: 0x27323f, lit: 0xffe2a8 },
    11: { wall: 'white', glass: [0x3b8793, 0x4b9aa6, 0x60b0b9], spand: 0xf1f5f6, fin: 0xffffff, core: 0x2d5560, acc: 0x2fb0c4, dark: 0x26343b, lit: 0xdff4ff },
    14: { wall: 'stone', glass: [0x65798a, 0x778c9c, 0x8ea3b2], spand: 0xd6c9a8, fin: 0xe9dec2, core: 0x4a5560, acc: 0xa8845a, dark: 0x3a3a3c, lit: 0xffe2a8 },
    8: { wall: 'slate', glass: [0x384e8c, 0x4963a6, 0x607abd], spand: 0x3c4352, fin: 0xcfd6e2, core: 0x2c3858, acc: 0x8a5cff, dark: 0x252a38, lit: 0xffe2a8 },
    9: { wall: 'stone', glass: [0x2f4a52, 0x3e5b64, 0x4e6c76], spand: 0xdfd3b0, fin: 0xeadfbd, core: 0x24363d, acc: 0xa87d3c, dark: 0x2a2a2c, lit: 0xffd98a },
    12: { wall: 'sand', glass: [0x5b7288, 0x6c8398, 0x7e96ab], spand: 0xf2ead8, fin: 0xf6f0e2, core: 0x44566a, acc: 0x23415e, dark: 0x303846, lit: 0xffe2a8 },
    15: { wall: 'slate', glass: [0x52718a, 0x67879f, 0x7c9db4], spand: 0x3d4753, fin: 0xd0d9e1, core: 0x34475a, acc: 0x7d99ad, dark: 0x252d38, lit: 0xdff0ff },
  };
  const WHITE = 0xf3f6f8, NAVY = 0x23415e, DARK = 0x2b2f36, GREY = 0x8a97a3, GREEN = 0x4f8a3f, GREEN2 = 0x5f9c46, PLANT = 0x7a828c;

  // ---------------------------------------------------------------------------------------------- helpers
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
  const hash = (a, b, c) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

  // one drawing kit per building: batches + u-space helpers (u = away from the pad, world x = gs * u)
  function kit(gs, pal, stageIdx) {
    const ctx = makeCtx(1);
    const X = (u) => gs * u, rx = (u0, u1) => (gs > 0 ? [u0, u1] : [-u1, -u0]);
    const B = { Pn: batch(), Wl: batch(), Cw: batch(true), Lit: batch(true), Tr: batch(), St: batch(), Dt: batch(true), Gl: batch(), Lp: batch(), Bn: batch() };
    const o = { ctx, gs, X, rx, B, pal, idx: stageIdx, footprint: [], dims: {} };
    const bxr = (bt, x0, x1, y0, y1, z0, z1, op) => box(bt, ctx, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), op);
    o.bu = (bt, u0, u1, ya, yb, za, zb, op) => { const r = rx(u0, u1); bxr(bt, r[0], r[1], ya, yb, za, zb, op); };      // box by u / y / z ranges
    o.bx = (bt, u, y, z, w, h, d, op) => box(bt, ctx, X(u), y, z, w, h, d, op);                                           // box by centre
    o.P = (p) => [gs * p[0], p[1], p[2]];
    o.pq = (bt, a, b, c, d, dir, op) => fq(bt, ctx, o.P(a), o.P(b), o.P(c), o.P(d), [gs * dir[0], dir[1], dir[2]], op);   // quad in u-space, outward direction in u-space
    // run fn in a frame at (u, z) looking outward: 'f' = +z (front), 'b' = -z, 'e' = +u (far end), 'p' = -u (pad side); the local +z is the outward direction
    o.at = (u, z, face, fn) => { const ang = { f: 0, b: Math.PI, e: gs * Math.PI / 2, p: -gs * Math.PI / 2 }[face]; ctx.at(X(u), 0, z, ang, fn); };
    o.fp = (u0, u1, z0, z1) => o.footprint.push({ u0, u1, z0, z1 });
    return o;
  }

  // ---------------------------------------------------------------------------------------------- facade: glass panes + spandrels + mullions / fins on one wall
  // frame: centre of the wall (u, z) looking outward; W = wall width; hs = floor heights (first may be the lobby); f = { cols, finEvery, litP, seed, sp: spandrel fraction, deep: fin depth }
  function facadeW(o, wx, wz, ang, W, yb, hs, f = {}, tag = 70) {
    const { B, ctx, pal } = o, cols = f.cols || Math.max(2, Math.round(W / (f.cw || 0.42))), cw = W / cols, litP = f.litP === undefined ? 0.34 : f.litP;
    const seed = f.seed || 0, total = hs.reduce((s, v) => s + v, 0), pier = f.pier || 0;
    ctx.at(wx, 0, wz, ang, () => {
      let y0 = yb;
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i], sp = Math.min(h * 0.4, i === 0 && f.lobby ? 0.34 : h * (f.sp === undefined ? 0.28 : f.sp)), t = i / Math.max(1, hs.length - 1);
        box(B.Dt, ctx, 0, y0 + sp / 2, 0.017, W, sp, 0.034, { color: f.spandColor || pal.spand, skip: [0, 1, 3, 5] });
        for (let j = 0; j < cols; j++) {
          const x0 = -W / 2 + j * cw + 0.014, x1 = -W / 2 + (j + 1) * cw - 0.014, r = hash(seed + i, j, tag);
          const base = pal.glass[r < 0.33 ? 0 : r < 0.7 ? 1 : 2], col = mix(base, 0xcfe6f7, 0.1 + 0.2 * t);
          const ya = y0 + sp, yb2 = y0 + h - 0.005;
          quad(B.Cw, ctx, [x0, ya, 0.006], [x1, ya, 0.006], [x1, yb2, 0.006], [x0, yb2, 0.006], { color: col });
          if (litP > 0 && hash(seed + 31 + i, j, tag + 7) < litP) quad(B.Lit, ctx, [x0 + 0.02, ya + 0.03, 0.013], [x1 - 0.02, ya + 0.03, 0.013], [x1 - 0.02, yb2 - 0.03, 0.013], [x0 + 0.02, yb2 - 0.03, 0.013], { color: mix(pal.glass[2], 0xffffff, 0.35) });
        }
        y0 += h;
      }
      for (let j = 0; j <= cols; j++) {
        const x = -W / 2 + j * cw, deep = f.finEvery && j % f.finEvery === 0, edge = j === 0 || j === cols;
        if (edge && f.noEdge) continue;
        const d = deep ? (f.deep || 0.1) : 0.054;
        box(B.Dt, ctx, x, yb + total / 2, d / 2, deep ? 0.05 : 0.03, total, d, { color: f.finColor || pal.fin, skip: [2, 3, 5] });
      }
      if (pier) for (let j = 0; j <= cols; j += pier) { const x = -W / 2 + j * cw; box(B.Dt, ctx, x, yb + total / 2, 0.06, 0.09, total, 0.12, { color: f.finColor || pal.fin, skip: [3, 5] }); }
    });
  }
  const FACE_ANG = (gs) => ({ f: 0, b: Math.PI, e: gs * Math.PI / 2, p: -gs * Math.PI / 2 });
  function facade(o, face, u, z, W, yb, hs, f = {}) { facadeW(o, o.X(u), z, FACE_ANG(o.gs)[face], W, yb, hs, f, face.charCodeAt(0)); }

  // a solid slab (core + facades on the listed faces + corner posts + roof slab with a parapet); returns the top y of the walls
  // p: { u0, u1, z0, z1, yb, hs, faces, f, fp, roof (default true), posts }
  function slab(o, p) {
    const { B, pal } = o, W = p.u1 - p.u0, Dp = p.z1 - p.z0, top = p.yb + p.hs.reduce((s, v) => s + v, 0);
    o.bu(B.Wl, p.u0, p.u1, p.yb, top, p.z0, p.z1);
    const f = Object.assign({ seed: p.seed || (p.u0 * 7 + p.z0 * 13 + p.yb * 5) | 0 }, p.f || {});
    const fc = (p.faces || 'fbpe');
    if (fc.includes('f')) facade(o, 'f', (p.u0 + p.u1) / 2, p.z1, W, p.yb, p.hs, Object.assign({}, f, { seed: f.seed + 1 }));
    if (fc.includes('b')) facade(o, 'b', (p.u0 + p.u1) / 2, p.z0, W, p.yb, p.hs, Object.assign({}, f, { seed: f.seed + 2, finEvery: 0, litP: (f.litP === undefined ? 0.34 : f.litP) * 0.7 }));
    if (fc.includes('p')) facade(o, 'p', p.u0, (p.z0 + p.z1) / 2, Dp, p.yb, p.hs, Object.assign({}, f, { seed: f.seed + 3, finEvery: 0 }));
    if (fc.includes('e')) facade(o, 'e', p.u1, (p.z0 + p.z1) / 2, Dp, p.yb, p.hs, Object.assign({}, f, { seed: f.seed + 4, finEvery: 0 }));
    if (p.posts !== false) for (const uu of [p.u0, p.u1]) for (const zz of [p.z0, p.z1]) o.bu(B.Dt, uu - 0.035, uu + 0.035, p.yb, top, zz - 0.035, zz + 0.035, { color: pal.fin, skip: [3] });
    if (p.roof !== false) {
      o.bu(B.Tr, p.u0 - 0.035, p.u1 + 0.035, top, top + 0.07, p.z0 - 0.035, p.z1 + 0.035);                                          // roof slab / cornice
      o.bu(B.Dt, p.u0 + 0.03, p.u1 - 0.03, top + 0.07, top + 0.075, p.z0 + 0.03, p.z1 - 0.03, { color: 0x4a4f57, skip: [0, 1, 3, 4, 5] });  // dark roofing
      for (const [a, b, c, d] of [[p.u0 - 0.035, p.u1 + 0.035, p.z1 - 0.01, p.z1 + 0.035], [p.u0 - 0.035, p.u1 + 0.035, p.z0 - 0.035, p.z0 + 0.01]]) o.bu(B.Tr, a, b, top + 0.07, top + 0.15, c, d);
      for (const [a, b, c, d] of [[p.u0 - 0.035, p.u0 - 0.01, p.z0 - 0.035, p.z1 + 0.035], [p.u1 + 0.01, p.u1 + 0.035, p.z0 - 0.035, p.z1 + 0.035]]) o.bu(B.Tr, a, b, top + 0.07, top + 0.15, c, d);
    }
    if (p.fp !== false) o.fp(p.u0 - 0.02, p.u1 + 0.02, p.z0 - 0.02, p.z1 + 0.02);
    return top;
  }

  // ---------------------------------------------------------------------------------------------- shared parts
  function bush(o, u, y, z, s) { blob(o.B.Dt, o.ctx, o.X(u), y + s * 0.5, z, s, s * 0.8, s, 0, { color: GREEN }); blob(o.B.Dt, o.ctx, o.X(u) + s * 0.4, y + s * 0.35, z + s * 0.25, s * 0.6, s * 0.5, s * 0.6, 0, { color: GREEN2 }); }
  function planter(o, u, z, y = 0.1, w = 0.34, d = 0.3) { o.bx(o.B.Dt, u, y + 0.08, z, w, 0.16, d, { color: PLANT }); bush(o, u, y + 0.15, z, Math.min(w, d) * 0.5); }
  // forecourt slab (low, walkable): steps in front of the niche + a paved apron to the road end
  function forecourt(o, u, w, zf, zEnd) {
    const { B } = o;
    o.bu(B.Pn, u - w / 2, u + w / 2, 0, 0.05, zf - 0.02, zEnd);
    o.bu(B.Pn, u - 0.62, u + 0.62, 0, 0.1, zf - 0.02, zf + 0.26);                                    // two shallow steps up to the door
  }
  // sign board with white bars (no text / texture) on a wall in the local frame: navy plate + accent stripe
  function signPlate(o, u, z, y, w, h, acc) {
    const { B } = o;
    o.at(u, z, 'f', () => {
      box(B.Dt, o.ctx, 0, y, 0.05, w, h, 0.03, { color: NAVY });
      box(B.Dt, o.ctx, 0, y - h / 2 + 0.012, 0.067, w, 0.024, 0.01, { color: acc });
      let lu = -w / 2 + 0.1; const ws = [0.07, 0.05, 0.09, 0.05, 0.07, 0.09, 0.05, 0.08, 0.05, 0.07];
      for (let i = 0; i < ws.length; i++) { const ww = ws[i], hh = i % 3 === 1 ? 0.05 : 0.075; if (i === 5) lu += 0.1; if (lu + ww > w / 2 - 0.08) break; box(B.Dt, o.ctx, lu + ww / 2, y + 0.005, 0.067, ww, hh, 0.01, { color: WHITE }); lu += ww + 0.04; }
    });
  }
  // the entrance: a niche (0.9 wide, 0.5 deep) in the front wall of the ground floor, a revolving door drum in it, a canopy above, steps + planters; returns the door record
  // blk = the front block { u0, u1, z0, z1 (front wall), yb, h0 }; ud = door centre (u)
  function entrance(o, blk, ud, opt = {}) {
    const { B, pal, ctx } = o, { u0, u1, z0, z1, yb, h0 } = blk, nw = 0.45, nd = 0.5, dh = Math.min(0.92, h0 - 0.2);
    const f = { lobby: true, litP: 0.5, seed: 91, cols: undefined };
    // ground floor: the core stops 0.5 m behind the front wall; two flanks reach the front; the niche back is a glass wall
    o.bu(B.Wl, u0, u1, yb, yb + h0, z0, z1 - nd);
    o.bu(B.Wl, u0, ud - nw, yb, yb + h0, z1 - nd, z1); o.bu(B.Wl, ud + nw, u1, yb, yb + h0, z1 - nd, z1);
    if (ud - nw - u0 > 0.2) facade(o, 'f', (u0 + ud - nw) / 2, z1, ud - nw - u0, yb, [h0], Object.assign({}, f, { cw: 0.32, finEvery: 0, noEdge: false }));
    if (u1 - ud - nw > 0.2) facade(o, 'f', (ud + nw + u1) / 2, z1, u1 - ud - nw, yb, [h0], Object.assign({}, f, { cw: 0.32, finEvery: 0, seed: 92 }));
    facade(o, 'f', ud, z1 - nd, nw * 2, yb, [h0], { lobby: true, litP: 0, cols: 2, seed: 93 });                                                   // the glass back wall of the niche
    o.fp(u0 - 0.02, u1 + 0.02, z0 - 0.02, z1 - nd); o.fp(u0 - 0.02, ud - nw, z1 - nd - 0.04, z1 + 0.0); o.fp(ud + nw, u1 + 0.02, z1 - nd - 0.04, z1 + 0.0);
    // revolving door: a drum (glass cylinder = the door mesh, steel roof disc + four fins) in the niche
    const dz = z1 - nd + 0.33;
    o.bu(B.Dt, ud - nw, ud - nw + 0.04, yb, yb + dh + 0.18, z1 - nd, z1, { color: pal.dark }); o.bu(B.Dt, ud + nw - 0.04, ud + nw, yb, yb + dh + 0.18, z1 - nd, z1, { color: pal.dark });   // door jambs
    o.bu(B.Dt, ud - nw, ud + nw, yb + dh + 0.16, yb + dh + 0.2, z1 - nd, z1, { color: pal.dark });                                                // lintel
    cyl(B.Dt, ctx, o.X(ud), yb + dh + 0.01, dz, 0.3, 0.3, 0.035, 12, { color: pal.dark });                                                        // drum roof
    cyl(B.Dt, ctx, o.X(ud), yb + 0.005, dz, 0.3, 0.3, 0.02, 12, { color: pal.dark, cap: false });
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; box(B.Dt, ctx, o.X(ud) + Math.cos(a) * 0.12, yb + dh / 2, dz + Math.sin(a) * 0.12, 0.24, dh, 0.014, { color: 0xb9c6d0, ry: -a }); }
    // canopy: a thin slab above the door, 0.6 m out, two slim posts at the corners
    const cy = yb + dh + 0.3, cz1 = z1 + (opt.canopy === undefined ? 0.62 : opt.canopy), cw = opt.cw || 0.85;
    if (!opt.bare) {
      o.bu(B.Tr, ud - cw, ud + cw, cy, cy + 0.045, z1 - 0.02, cz1);
      o.bu(B.Dt, ud - cw, ud + cw, cy + 0.045, cy + 0.065, cz1 - 0.03, cz1, { color: pal.acc });
      for (const s of [-1, 1]) o.bu(B.St, ud + s * (cw - 0.06) - 0.017, ud + s * (cw - 0.06) + 0.017, 0.05, cy, cz1 - 0.08, cz1 - 0.046);
      forecourt(o, ud, cw * 2 - 0.1, z1, cz1 + 0.04);
      for (const s of [-1, 1]) planter(o, ud + s * (cw + 0.28), z1 + 0.28);
    }
    o.dims.door = { u: ud, y: yb + dh / 2 + 0.02, z: dz, r: 0.27, h: dh - 0.04, front: z1, canopyY: cy, canopyZ: cz1, canopyHalf: cw };
    return o.dims.door;
  }

  // rooftop gear on the roof of a slab: mech box with fans, optional antenna mast + aviation light, optional solar panels / planters / pergola
  function mech(o, y, u0, u1, z0, z1, h = 0.32) {
    const { B } = o;
    o.bu(B.Dt, u0, u1, y, y + h, z0, z1, { color: 0xb8bec6 });
    o.bu(B.Dt, u0 - 0.02, u1 + 0.02, y + h, y + h + 0.03, z0 - 0.02, z1 + 0.02, { color: 0x6f7780 });
    for (let k = 0; k < 2; k++) { const cu = u0 + (u1 - u0) * (0.28 + k * 0.44); cyl(B.Dt, o.ctx, o.X(cu), y + h + 0.03, (z0 + z1) / 2, 0.1, 0.1, 0.05, 10, { color: 0x4a5058 }); }
    o.bu(B.Dt, u0 + 0.05, u0 + 0.14, y + h + 0.03, y + h + 0.2, z0 + 0.05, z0 + 0.14, { color: 0x9ea6af });                            // vent stub
    return y + h + 0.06;
  }
  function antenna(o, u, z, y, h, light = true) {
    const { B } = o;
    cyl(B.St, o.ctx, o.X(u), y, z, 0.026, 0.014, h, 6);
    o.bx(B.St, u, y + h * 0.62, z, 0.2, 0.014, 0.014);
    if (light) o.bx(B.Bn, u, y + h + 0.03, z, 0.06, 0.06, 0.06);
    o.dims.antennaTop = Math.max(o.dims.antennaTop || 0, y + h + 0.06);
    o.dims.beaconAt = { u, y: y + h + 0.03, z };
  }
  function pergola(o, y, u0, u1, z0, z1, pal) {
    const { B } = o;
    for (const uu of [u0, u1]) for (const zz of [z0, z1]) o.bu(B.Dt, uu - 0.02, uu + 0.02, y, y + 0.46, zz - 0.02, zz + 0.02, { color: pal.fin });
    for (let k = 0; k <= 5; k++) { const uu = u0 + (u1 - u0) * k / 5; o.bu(B.Dt, uu - 0.012, uu + 0.012, y + 0.46, y + 0.5, z0 - 0.05, z1 + 0.05, { color: pal.fin }); }
  }
  function solar(o, y, u0, u1, z0, z1, rows, cols) {
    const { B, ctx } = o;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const cu = u0 + (u1 - u0) * (j + 0.5) / cols, cz = z0 + (z1 - z0) * (i + 0.5) / rows;
      ctx.at(o.X(cu), y, cz, 0, () => box(B.Dt, ctx, 0, 0.07, 0, (u1 - u0) / cols - 0.07, 0.025, (z1 - z0) / rows - 0.1, { color: 0x24405e, rx: -0.3 }));
    }
  }


  // an n-gon drum (lab rotunda / dome drum): solid core + a window facade on every facet; centre (u, z), circumscribed radius r
  function drum(o, u, z, r, n, yb, hs, f = {}) {
    const { B, ctx } = o, top = yb + hs.reduce((s, v) => s + v, 0), ra = r * Math.cos(Math.PI / n), W = 2 * r * Math.sin(Math.PI / n), cxw = o.X(u);
    cyl(B.Wl, ctx, cxw, yb, z, r, r, top - yb, n);
    for (let i = 0; i < n; i++) { const am = (i + 0.5) * 2 * Math.PI / n; facadeW(o, cxw + Math.cos(am) * ra, z + Math.sin(am) * ra, Math.PI / 2 - am, W, yb, hs, Object.assign({ cols: f.cols || 2, finEvery: 0, seed: 40 + i }, f), 90 + i); }
    cyl(B.Tr, ctx, cxw, top, z, r + 0.04, r + 0.04, 0.07, n);
    return top + 0.07;
  }
  function dome(o, u, z, r, y, color) { blob(o.B.Dt, o.ctx, o.X(u), y, z, r, r * 0.9, r, 1, { color }); }
  // mast with a beacon on the top; returns the tip height
  function mast(o, u, z, y, h, light = true) {
    cyl(o.B.St, o.ctx, o.X(u), y, z, 0.03, 0.016, h, 6);
    o.bx(o.B.St, u, y + h * 0.55, z, 0.22, 0.014, 0.014); o.bx(o.B.St, u, y + h * 0.55, z, 0.014, 0.014, 0.22);
    if (light) o.bx(o.B.Bn, u, y + h + 0.035, z, 0.07, 0.07, 0.07);
    o.dims.masts = o.dims.masts || []; o.dims.masts.push({ u, z, y0: y, h });
    return y + h + 0.07;
  }
  // where the pad is (u-space: u = -|x|) and the smallest u a solid box spanning z0..z1 may start at (>= 1.0 m from the pad)
  function limiter(pl) {
    const pu = -Math.abs(pl ? pl.x : 2), pz = pl ? pl.z : 0;
    return (z0, z1, cl = 1.0) => { const dz = Math.max(0, z0 - pz, pz - z1); return pu + Math.sqrt(Math.max(0, cl * cl - dz * dz)); };
  }

  function setup(stage, kind) {
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1;
    const pl = padLocal(idx) || { x: 2, z: 0 };
    const gs = pl.x >= 0 ? -1 : 1, pal = PAL[idx] || PAL[kind === 'office' ? 6 : 8];
    const o = kit(gs, pal, idx);
    o.pl = pl; o.minU = limiter(pl); o.M = smats(); o.dims.gs = gs; o.dims.pad = { u: -Math.abs(pl.x), z: pl.z };
    return o;
  }
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const rep = (n, v) => Array.from({ length: Math.max(0, n) }, () => v);

  // ============================================================================================== OFFICES
  // each returns after drawing; o.dims collects the anchors the gold tiers / tests read: dims.top (highest point), dims.main { u0, u1, z1 }, dims.roofY, dims.canopy, dims.goldLine
  function office6(o, L) {
    const { B, pal } = o, fh = 0.72, h0 = 1.2, yb = 0.1, zr = -0.95, zf = 1.0, u0 = Math.max(-0.8, o.minU(zr, zf)), u1 = 0.9, ud = 0.05;
    const nB = [2, 3, 4, 4, 5][L - 1], nT = [0, 0, 0, 1, 2][L - 1];
    o.bu(B.Pn, u0 - 0.1, u1 + 0.1, 0, 0.1, zr - 0.1, zf + 0.02);                                               // plinth slab
    entrance(o, { u0, u1, z0: zr, z1: zf, yb, h0 }, ud);
    // ground-floor sides + rear (the front is the entrance block above), body floors
    facade(o, 'b', (u0 + u1) / 2, zr, u1 - u0, yb, [h0, ...rep(nB, fh)], { seed: 3, finEvery: 0, lobby: true });
    facade(o, 'p', u0, (zr + zf) / 2, zf - zr, yb, [h0, ...rep(nB, fh)], { seed: 5, finEvery: 0, lobby: true });
    facade(o, 'e', u1, (zr + zf) / 2, zf - zr, yb, [h0, ...rep(nB, fh)], { seed: 6, finEvery: 0, lobby: true });
    const top1 = slab(o, { u0, u1, z0: zr, z1: zf, yb: yb + h0, hs: rep(nB, fh), faces: 'f', f: { finEvery: 2, deep: 0.1 }, fp: false, posts: true });
    let roofY = top1, top = top1 + 0.15, mu0 = u0, mu1 = u1, mz1 = zf;
    // wing (L3+), recessed 0.3 from the front
    if (L >= 3) {
      const wn = [0, 0, 2, 3, 3][L - 1], wu1 = 1.85, wz0 = -0.7, wz1 = 0.7;
      o.bu(B.Pn, u1 - 0.02, wu1 + 0.1, 0, 0.1, wz0 - 0.1, wz1 + 0.1);
      const wtop = slab(o, { u0: u1, u1: wu1, z0: wz0, z1: wz1, yb, hs: [h0, ...rep(wn, fh)], faces: 'fbe', f: { lobby: true, litP: 0.4, finEvery: 2 }, seed: 20 });
      mech(o, wtop + 0.075, u1 + 0.25, u1 + 0.7, wz0 + 0.2, wz0 + 0.55, 0.26);
      o.dims.wing = { u0: u1, u1: wu1, z0: wz0, z1: wz1, top: wtop };
    }
    // top tier (L4+): inset 0.16 sides, 0.35 front (terrace), 0.12 rear
    if (nT) {
      const tu0 = u0 + 0.16, tu1 = u1 - 0.16, tz0 = zr + 0.12, tz1 = zf - 0.35;
      const t2 = slab(o, { u0: tu0, u1: tu1, z0: tz0, z1: tz1, yb: roofY + 0.075, hs: rep(nT, fh), faces: 'fbpe', f: { finEvery: 2, litP: 0.4 }, fp: false, seed: 30 });
      roofY = t2; top = t2 + 0.15; mu0 = tu0; mu1 = tu1; mz1 = tz1;
      for (const s of [-1, 1]) planter(o, (u0 + u1) / 2 + s * 0.45, zf - 0.17, top1 + 0.075 - 0.1 + 0.1, 0.5, 0.2);   // terrace planters on the body roof in front of the setback
      if (L >= 5) pergola(o, top1 + 0.075, u0 + 0.3, u0 + 0.8, zf - 0.26, zf - 0.08, pal);
    }
    // roof gear: mechanical box on the top roof, antenna from L3, service core + sign from L5
    top = Math.max(top, mech(o, roofY + 0.075, mu0 + 0.25, mu0 + 0.9, -0.55, -0.1, 0.34));
    if (L >= 3) top = Math.max(top, mast(o, mu1 - 0.2, -0.65, roofY + 0.075, 0.95));
    if (L >= 5) {
      const cn = slab(o, { u0: 0.1, u1: 0.65, z0: zr - 0.28, z1: zr, yb: yb, hs: [h0, ...rep(nB, fh), 0.55], faces: 'bpe', f: { cols: 1, litP: 0.2, finEvery: 0 }, fp: true, seed: 50 });
      top = Math.max(top, cn + 0.15);
      signPlate(o, (u0 + u1) / 2 + 0.0, zf, yb + h0 + 0.33, 1.1, 0.16, pal.acc);
    }
    o.dims.corners = [u0, u1].map((u) => ({ u, z: zf, y0: yb + h0, y1: top1 }));
    o.dims.main = { u0, u1, z1: zf, z0: zr }; o.dims.roofY = roofY; o.dims.top = top; o.dims.cornY = yb + h0 + nB * fh; o.dims.goldLine = { u0, u1, y: yb + h0 + 0.02, z: zf + 0.036 };
    o.dims.crown = { u: (mu0 + mu1) / 2 + 0.1, z: -0.1 + 0.0, y: roofY + 0.075 + 0.34 + 0.06 };
    if (L < 5) signPlate(o, (u0 + u1) / 2, zf, yb + h0 + 0.33, 1.1, 0.16, pal.acc);
  }

  function office7(o, L) {
    const { B, pal } = o, fh = 0.72, h0 = 1.2, yb = 0.1, zr = -1.0, zf = 1.45, au0 = 0.0, au1 = 0.7, uA0 = Math.max(-1.0, o.minU(zr, zf)), uB1 = 2.2, ud = 0.35;
    const nA = [3, 4, 5, 6, 6][L - 1], nB = [0, 3, 4, 5, 6][L - 1], nAt = [0, 0, 3, 4, 5][L - 1];
    o.bu(B.Pn, uA0 - 0.1, uB1 + 0.1, 0, 0.1, zr - 0.1, zf + 0.02);
    // wing A (pad side) and wing B: full height blocks with the atrium between them (flush front)
    const topA = slab(o, { u0: uA0, u1: au0, z0: zr, z1: zf, yb, hs: [h0, ...rep(nA, fh)], faces: 'fbp', f: { lobby: true, finEvery: 2, litP: 0.4 }, seed: 11 });
    let top = topA, topB = 0;
    if (nB) topB = slab(o, { u0: au1, u1: uB1, z0: zr, z1: zf, yb, hs: [h0, ...rep(nB, fh)], faces: 'fbe', f: { lobby: true, finEvery: 2, litP: 0.4 }, seed: 12 });
    top = Math.max(top, topB);
    // atrium: the entrance hall (ground floor, L1+) and, from L3, a glass volume nAt floors high between the wings
    const azr = zr + 0.1, azf = zf;
    entrance(o, { u0: au0, u1: au1, z0: azr, z1: azf, yb, h0 }, ud, { canopy: 0.42, cw: 0.55 });
    facade(o, 'b', (au0 + au1) / 2, azr, au1 - au0, yb, [h0], { cols: 2, lobby: true, finEvery: 0, seed: 17 });
    let atTop = yb + h0;
    if (nAt) {
      atTop = slab(o, { u0: au0, u1: au1, z0: azr, z1: azf, yb: yb + h0, hs: rep(nAt, fh), faces: 'f', f: { cols: 2, finEvery: 1, deep: 0.07, litP: 0.5, sp: 0.12 }, fp: false, roof: false, posts: false, seed: 14 });
      facade(o, 'b', (au0 + au1) / 2, azr, au1 - au0, yb + h0, rep(nAt, fh), { cols: 2, finEvery: 0, litP: 0.3, sp: 0.12, seed: 18 });
      o.bu(B.Gl, au0, au1, atTop + 0.02, atTop + 0.03, azr, azf);                                          // glass roof over steel ribs
      for (let k = 0; k <= 3; k++) { const uu = au0 + (au1 - au0) * k / 3; o.bu(B.St, uu - 0.015, uu + 0.015, atTop, atTop + 0.06, azr, azf); }
      o.bu(B.St, au0, au1, atTop, atTop + 0.06, azr, azr + 0.03); o.bu(B.St, au0, au1, atTop, atTop + 0.06, azf - 0.03, azf);
      top = Math.max(top, atTop + 0.06);
    } else {
      o.bu(B.Tr, au0 - 0.03, au1 + 0.03, atTop, atTop + 0.07, azr - 0.03, azf + 0.03);
    }
    // wing roofs: mech boxes + antenna
    top = Math.max(top, mech(o, topA + 0.075, uA0 + 0.25, uA0 + 0.7, -0.6, -0.15, 0.3));
    if (nB) mech(o, topB + 0.075, au1 + 0.3, au1 + 0.8, -0.6, -0.15, 0.3);
    if (L >= 3) top = Math.max(top, mast(o, uA0 + 0.2, 0.2, topA + 0.075, 0.9));
    // L5: rooftop terrace on the atrium roof: pergola + planters; sign over the entrance
    signPlate(o, (au0 + au1) / 2, azf, yb + h0 + 0.33, 0.62, 0.15, pal.acc);
    if (L >= 5) {
      pergola(o, atTop + 0.06, au0 + 0.08, au1 - 0.08, azr + 0.3, azf - 0.3, pal);
      planter(o, (au0 + au1) / 2, azf - 0.12, atTop + 0.06, 0.4, 0.16);
    }
    for (const uu of [uA0 + 0.5, uB1 - 0.6]) planter(o, uu, zf + 0.26, 0.1, 0.5, 0.3);
    o.dims.corners = [{ u: uA0, z: zf, y0: yb + h0, y1: topA }, { u: uB1, z: zf, y0: yb + h0, y1: topB || topA }];
    o.dims.main = { u0: uA0, u1: uB1, z1: zf, z0: zr }; o.dims.roofY = topB || topA; o.dims.top = top; o.dims.goldLine = { u0: uA0, u1: au0, y: yb + h0 + 0.02, z: zf + 0.036 };
    o.dims.crown = { u: (au1 + uB1) / 2, z: -0.45, y: (topB || topA) + 0.075 + 0.3 + 0.06 };
    if (!nB) o.dims.crown = { u: uA0 + 0.5, z: -0.4, y: topA + 0.075 + 0.3 + 0.06 };
  }

  function office11(o, L) {
    const { B, pal } = o, fh = 0.72, h0 = 1.2, yb = 0.1, zr = -1.1, zf = 1.0, u0 = Math.max(-2.5, o.minU(zr, zf)), u1 = 0.6, ud = -0.05;
    const nB = [1, 2, 2, 2, 3][L - 1], nD = [0, 2, 3, 3, 3][L - 1], cu = 1.45, cz = -0.1, r = 0.8;
    const sp = { spandColor: 0xf1f5f6 };
    o.bu(B.Pn, u0 - 0.1, u1 + 0.1, 0, 0.1, zr - 0.1, zf + 0.02);
    entrance(o, { u0, u1, z0: zr, z1: zf, yb, h0 }, ud, { cw: 0.7 });
    facade(o, 'b', (u0 + u1) / 2, zr, u1 - u0, yb, [h0, ...rep(nB, fh)], { seed: 3, finEvery: 0, lobby: true, sp: 0.4 });
    facade(o, 'p', u0, (zr + zf) / 2, zf - zr, yb, [h0, ...rep(nB, fh)], { seed: 5, finEvery: 0, lobby: true, sp: 0.4 });
    const top1 = slab(o, { u0, u1, z0: zr, z1: zf, yb: yb + h0, hs: rep(nB, fh), faces: 'f', f: { finEvery: 3, sp: 0.42, litP: 0.4 }, fp: false });
    facade(o, 'e', u1, (zr + zf) / 2, zf - zr, yb, [h0, ...rep(nB, fh)], { seed: 6, finEvery: 0, lobby: true, sp: 0.4 });
    let top = top1 + 0.15, roofY = top1;
    if (nD) {
      const dtop = drum(o, cu, cz, r, 8, yb, [h0, ...rep(nD, fh)], { sp: 0.35, litP: 0.45 });
      o.bu(B.Pn, cu - r - 0.05, cu + r + 0.05, 0, 0.1, cz - r - 0.05, cz + r + 0.05);
      // octagon footprint: four boxes through the centre (0, 45, 90, 135 degrees), each as long as the across-flats width and as wide as one facet
      const ra = r * Math.cos(Math.PI / 8), W = 2 * r * Math.sin(Math.PI / 8);
      for (let k = 0; k < 4; k++) o.footprint.push({ u: cu, z: cz, hx: ra + 0.02, hz: W / 2 + 0.02, yaw: k * Math.PI / 4, round: true });
      top = Math.max(top, dtop + 0.07);
      if (L >= 3) { dome(o, cu, cz, r * 0.72, dtop + 0.02, 0xf0f4f6); cyl(B.Dt, o.ctx, o.X(cu), dtop, cz, r * 0.8, r * 0.8, 0.03, 8, { color: 0x6f7780 }); top = Math.max(top, dtop + r * 0.72 + 0.1); o.dims.crown = { u: cu, z: cz, y: dtop + r * 0.72 * 0.9 + 0.05 }; o.dims.domeTop = dtop + r * 0.65; }
      o.dims.drum = { u: cu, z: cz, r, top: dtop };
      // glazed link between block and drum
      o.bu(B.Gl, u1, cu - ra, yb + 0.3, yb + 0.3 + h0 - 0.2, cz - 0.3, cz + 0.3);
    }
    // roof of the block: solar panels (L4), satellite dish + greenhouse (L5), mech box
    if (L >= 4) solar(o, roofY + 0.075, u0 + 0.3, u0 + 1.6, zr + 0.2, zr + 0.85, 2, 3);
    top = Math.max(top, mech(o, roofY + 0.075, u0 + 1.9, u0 + 2.5, 0.1, 0.55, 0.3));
    if (L >= 5) {
      // satellite dish: cone-shaped dish on a post, tilted
      ctx2(o, u0 + 0.45, 0.5, roofY + 0.075, () => {
        cyl(B.St, o.ctx, 0, 0, 0, 0.03, 0.025, 0.4, 6); cyl(B.Dt, o.ctx, 0, 0.42, 0, 0.3, 0.04, 0.12, 12, { color: 0xeef1f3, cap: false });
      });
      top = Math.max(top, roofY + 0.075 + 0.62);
      o.bu(B.Gl, u0 + 1.0, u0 + 1.9, roofY + 0.075, roofY + 0.4, 0.25, 0.7);                                  // rooftop greenhouse
      o.bu(B.Dt, u0 + 1.0, u0 + 1.9, roofY + 0.075, roofY + 0.12, 0.25, 0.7, { color: 0xdfe6e8 });
      o.bu(B.St, u0 + 0.995, u0 + 1.905, roofY + 0.4, roofY + 0.43, 0.245, 0.705);
      top = Math.max(top, roofY + 0.45);
    }
    top = Math.max(top, mast(o, u0 + 2.4, -0.8, roofY + 0.075, 0.9));
    o.dims.corners = [u0, u1].map((u) => ({ u, z: zf, y0: yb + h0, y1: top1 }));
    o.dims.main = { u0, u1: cu + r, z1: zf, z0: zr }; o.dims.roofY = roofY; o.dims.top = top; o.dims.goldLine = { u0, u1, y: yb + h0 + 0.02, z: zf + 0.036 };
    if (!o.dims.crown) o.dims.crown = { u: u0 + 1.2, z: -0.7, y: roofY + 0.075 + 0.06 };
    signPlate(o, u1 - 0.8, zf, yb + h0 + 0.33, 1.0, 0.16, pal.acc);
  }
  // run fn in a frame at u-space (u, z) standing on y
  function ctx2(o, u, z, y, fn) { o.ctx.at(o.X(u), y, z, 0, fn); }

  function office14(o, L) {
    const { B, pal, ctx } = o, fh = 0.72, h0 = 1.4, yb = 0.1, zr = -1.2, zf = 1.0, u0 = -1.5, u1 = 1.5, ud = 0;
    const nH = [1, 2, 2, 2, 3][L - 1], cols = L >= 4 ? 6 : 4;
    const stone = { spandColor: pal.spand, finColor: pal.fin };
    o.bu(B.Pn, u0 - 0.1, u1 + 0.1, 0, 0.1, zr - 0.1, zf + 0.02);
    entrance(o, { u0, u1, z0: zr, z1: zf, yb, h0 }, ud, { bare: true, cw: 0.5 });
    facade(o, 'b', 0, zr, u1 - u0, yb, [h0, ...rep(nH, fh)], { seed: 3, finEvery: 2, lobby: true });
    facade(o, 'p', u0, (zr + zf) / 2, zf - zr, yb, [h0, ...rep(nH, fh)], { seed: 5, finEvery: 0, lobby: true });
    facade(o, 'e', u1, (zr + zf) / 2, zf - zr, yb, [h0, ...rep(nH, fh)], { seed: 6, finEvery: 0, lobby: true });
    const top1 = slab(o, { u0, u1, z0: zr, z1: zf, yb: yb + h0, hs: rep(nH, fh), faces: 'f', f: { finEvery: 2, deep: 0.12, cols: 8, litP: 0.4 }, fp: false });
    let top = top1 + 0.15, roofY = top1;
    // portico: columns in front of the entrance niche, entablature + pediment above (soft: columns are thin)
    {
      const pz = zf + 0.5, pu0 = cols === 6 ? -1.15 : -0.9, pu1 = -pu0, ph = h0 + 0.35;
      for (let k = 0; k < cols; k++) { const uu = pu0 + (pu1 - pu0) * k / (cols - 1); cyl(B.Tr, ctx, o.X(uu), yb, pz, 0.075, 0.065, ph, 10); o.bx(B.Tr, uu, yb + 0.03, pz, 0.2, 0.06, 0.2); o.bx(B.Tr, uu, yb + ph + 0.02, pz, 0.2, 0.05, 0.2); }
      o.bu(B.Tr, pu0 - 0.18, pu1 + 0.18, yb + ph + 0.04, yb + ph + 0.2, zf - 0.02, pz + 0.16);                // entablature
      o.bu(B.Pn, pu0 - 0.25, pu1 + 0.25, 0, 0.06, zf + 0.0, pz + 0.3); o.bu(B.Pn, pu0 - 0.1, pu1 + 0.1, 0, 0.12, zf + 0.0, pz + 0.12);   // steps
      // pediment triangle (front), in the wall material
      const hw = (pu1 - pu0) / 2 + 0.18, cuu = 0, yy = yb + ph + 0.2;
      o.pq(B.Wl, [cuu - hw, yy, pz + 0.16], [cuu + hw, yy, pz + 0.16], [cuu + hw * 0.0 + 0.0, yy + 0.32, pz + 0.16], [cuu, yy + 0.32, pz + 0.16], [0, 0, 1]);
      o.pq(B.Tr, [cuu - hw - 0.04, yy, pz + 0.17], [cuu + hw + 0.04, yy, pz + 0.17], [cuu, yy + 0.36, pz + 0.17], [cuu, yy + 0.36, pz + 0.17], [0, 0, 1]);
      top = Math.max(top, yy + 0.36);
      o.dims.canopy = { u: 0, y: yb + ph + 0.04, z1: zf, cz1: pz + 0.16, half: Math.abs(pu1) + 0.18 };
    }
    // wings (L2 west = pad side, L4 east): lower blocks
    if (L >= 2) { const wt = slab(o, { u0: -2.35, u1: u0, z0: -1.0, z1: 0.7, yb, hs: [h0, fh], faces: 'fbp', f: { lobby: true, litP: 0.35, finEvery: 2 }, seed: 21 }); o.bu(B.Pn, -2.45, u0, 0, 0.1, -1.1, 0.8); top = Math.max(top, wt); }
    if (L >= 4) { const wt = slab(o, { u0: u1, u1: 2.35, z0: -1.0, z1: 0.7, yb, hs: [h0, fh], faces: 'fbe', f: { lobby: true, litP: 0.35, finEvery: 2 }, seed: 22 }); o.bu(B.Pn, u1, 2.45, 0, 0.1, -1.1, 0.8); }
    // central glazed rotunda + dome (L3+)
    if (L >= 3) {
      const rt = drum(o, 0, -0.2, 0.75, 16, roofY + 0.075, [0.9, 0.0001].slice(0, 1), { cols: 2, finEvery: 0, sp: 0.1, litP: 0.5 });
      cyl(B.Dt, ctx, o.X(0), rt, -0.2, 0.8, 0.8, 0.03, 16, { color: 0x6f7780 });
      dome(o, 0, -0.2, 0.62, rt + 0.03, 0x86a69c);
      top = Math.max(top, rt + 0.62 * 0.9 + 0.1);
      o.dims.crown = { u: 0, z: -0.2, y: rt + 0.62 * 0.9 + 0.03 }; o.dims.domeTop = rt + 0.62 * 0.9;
      o.bx(B.St, 0, rt + 0.62 * 0.9 + 0.2, -0.2, 0.02, 0.4, 0.02);
    }
    // L5: flag poles on the plaza
    if (L >= 5) {
      for (const uu of [-1.45, 1.45]) { cyl(B.St, ctx, o.X(uu), 0.1, zf + 0.45, 0.025, 0.018, 1.8, 6); quad(B.Dt, ctx, [o.X(uu), 1.7, zf + 0.45], [o.X(uu) + o.gs * 0.34, 1.62, zf + 0.45], [o.X(uu) + o.gs * 0.34, 1.4, zf + 0.45], [o.X(uu), 1.48, zf + 0.45], { color: pal.acc }); quad(B.Dt, ctx, [o.X(uu), 1.48, zf + 0.45], [o.X(uu) + o.gs * 0.34, 1.4, zf + 0.45], [o.X(uu) + o.gs * 0.34, 1.62, zf + 0.45], [o.X(uu), 1.7, zf + 0.45], { color: pal.acc }); }
    }
    top = Math.max(top, mech(o, roofY + 0.075, u0 + 0.35, u0 + 0.9, -1.0, -0.6, 0.3));
    for (const s of [-1, 1]) planter(o, s * 1.35, zf + 0.9, 0.1, 0.45, 0.3);
    o.dims.corners = [u0, u1].map((u) => ({ u, z: zf, y0: yb + h0, y1: top1 }));
    o.dims.main = { u0, u1, z1: zf, z0: zr }; o.dims.roofY = roofY; o.dims.top = top; o.dims.goldLine = { u0, u1, y: yb + h0 + 0.02, z: zf + 0.036 };
    if (!o.dims.crown) o.dims.crown = { u: 0, z: -0.2, y: roofY + 0.075 + 0.06 };
  }

  // ============================================================================================== TOWERS
  // a stack of floors as one tier; returns the roof y (top of the roof slab)
  function tier(o, t, yb, n, f) {
    return slab(o, { u0: t.u0, u1: t.u1, z0: t.z0, z1: t.z1, yb, hs: rep(n, t.fh), faces: 'fbpe', f: Object.assign({ finEvery: 2, litP: 0.36 }, f || {}), fp: false, seed: t.seed || 7 });
  }
  // podium of every tower: lobby floor (with the entrance niche + canopy) and nP more floors, walls on all four sides; returns the podium roof y
  function podium(o, P, opt = {}) {
    const { B } = o, yb = 0.1, hs = [P.h0, ...rep(P.nP, P.fh)];
    o.bu(B.Pn, P.u0 - 0.1, P.u1 + 0.1, 0, 0.1, P.z0 - 0.1, P.z1 + 0.02);
    entrance(o, { u0: P.u0, u1: P.u1, z0: P.z0, z1: P.z1, yb, h0: P.h0 }, P.ud, { canopy: opt.canopy, cw: opt.cw || 0.7, bare: opt.bare });
    facade(o, 'b', (P.u0 + P.u1) / 2, P.z0, P.u1 - P.u0, yb, hs, { seed: 3, finEvery: 0, lobby: true, pier: opt.pier ? 1 : 0 });
    facade(o, 'p', P.u0, (P.z0 + P.z1) / 2, P.z1 - P.z0, yb, hs, { seed: 5, finEvery: 0, lobby: true });
    facade(o, 'e', P.u1, (P.z0 + P.z1) / 2, P.z1 - P.z0, yb, hs, { seed: 6, finEvery: 0, lobby: true });
    const top = slab(o, { u0: P.u0, u1: P.u1, z0: P.z0, z1: P.z1, yb: yb + P.h0, hs: rep(P.nP, P.fh), faces: 'f', f: { finEvery: 2, litP: 0.4, pier: opt.pier ? 1 : 0 }, fp: false });
    return top;
  }

  function tower8(o, L) {
    const { B, pal } = o, fh = 0.8, h0 = 1.3, zr = -0.95, zf = 0.95, u0 = Math.max(-1.05, o.minU(zr, zf)), u1 = u0 + 2.2, cu = (u0 + u1) / 2;
    const ptop = podium(o, { u0, u1, z0: zr, z1: zf, h0, nP: 1, fh, ud: cu });
    const nA = [5, 6, 6, 6, 6][L - 1], nB = [0, 1, 3, 4, 5][L - 1], nC = [0, 0, 0, 2, 4][L - 1];
    let y = ptop + 0.075;
    const TA = { u0: cu - 0.75, u1: cu + 0.75, z0: -0.65, z1: 0.55, fh }, TB = { u0: cu - 0.55, u1: cu + 0.55, z0: -0.5, z1: 0.4, fh }, TC = { u0: cu - 0.36, u1: cu + 0.36, z0: -0.36, z1: 0.26, fh };
    y = tier(o, TA, y, nA); o.dims.cornY = y; let corners = TA;
    if (nB) { y = tier(o, TB, y + 0.075, nB); corners = TB; }
    if (nC) { y = tier(o, TC, y + 0.075, nC); corners = TC; }
    o.dims.shaft = { u0: TA.u0, u1: TA.u1, z0: TA.z0, z1: TA.z1, y0: ptop + 0.075, y1: y, cu };
    const topT = nC ? TC : nB ? TB : TA;
    // roof: mech + mast with the aviation light
    const roofY = y + 0.075;
    mech(o, roofY, topT.u0 + 0.12, topT.u0 + 0.5, topT.z0 + 0.1, topT.z0 + 0.4, 0.2);
    const tip = mast(o, cu + 0.1, -0.05, roofY, 1.5 + (nC ? 0.5 : 0));
    // plaza: planters + two bollards
    for (const s of [-1, 1]) planter(o, cu + s * 1.0, zf + 0.5, 0.1, 0.4, 0.3);
    o.dims.main = { u0, u1, z1: zf, z0: zr }; o.dims.roofY = roofY; o.dims.top = tip; o.dims.goldLine = { u0, u1, y: 0.1 + h0 + 0.02, z: zf + 0.036 };
    o.dims.crownRing = { u: cu + 0.1, z: -0.05, y: tip - 0.3 }; o.dims.corners = [corners.u0, corners.u1].map((u) => ({ u, z: corners.z1, y0: ptop + 0.075, y1: y }));
  }

  function tower9(o, L) {
    const { B, pal } = o, fh = 0.8, h0 = 1.4, zr = -0.95, zf = 1.15, u0 = Math.max(-0.65, o.minU(zr, zf)), u1 = u0 + 1.9, cu = (u0 + u1) / 2;
    const ptop = podium(o, { u0, u1, z0: zr, z1: zf, h0, nP: 1, fh, ud: cu }, { cw: 0.6, pier: true });
    const nA = [5, 6, 6, 6, 6][L - 1], nB = [0, 2, 3, 4, 5][L - 1], nC = [0, 0, 0, 2, 4][L - 1], f = { cw: 0.3, finEvery: 1, deep: 0.09, litP: 0.4 };
    let y = ptop + 0.075;
    const TA = { u0: cu - 0.72, u1: cu + 0.72, z0: -0.7, z1: 0.6, fh }, TB = { u0: cu - 0.54, u1: cu + 0.54, z0: -0.52, z1: 0.42, fh }, TC = { u0: cu - 0.36, u1: cu + 0.36, z0: -0.34, z1: 0.24, fh };
    y = tier(o, TA, y, nA, f); let corners = TA;
    if (nB) { y = tier(o, TB, y + 0.075, nB, f); corners = TB; }
    if (nC) { y = tier(o, TC, y + 0.075, nC, f); corners = TC; }
    const topT = nC ? TC : nB ? TB : TA;
    o.dims.shaft = { u0: TA.u0, u1: TA.u1, z0: TA.z0, z1: TA.z1, y0: ptop + 0.075, y1: y, cu };
    // stepped stone cap (ziggurat top) + mast
    let cy = y + 0.075;
    for (const [w, h] of [[0.5, 0.2], [0.34, 0.2], [0.2, 0.18]]) { o.bu(B.Wl, cu - w, cu + w, cy, cy + h, topT.z0 + 0.1 - 0.0 + (0.34 - w) * 0.4, topT.z1 - 0.1 - (0.34 - w) * 0.4); cy += h; }
    for (const [w] of [[0.5], [0.34]]) o.bu(B.Tr, cu - w - 0.02, cu + w + 0.02, cy - 0.0 - (w === 0.5 ? 0.58 : 0.38) - 0.0, cy - (w === 0.5 ? 0.58 : 0.38) + 0.03, topT.z0 + 0.08, topT.z1 - 0.08);
    const tip = mast(o, cu, (topT.z0 + topT.z1) / 2, cy, 1.6);
    // deco: corner piers rising above every tier + bronze trim bands at the tier tops
    for (const t of [TA, nB ? TB : null, nC ? TC : null]) { if (!t) continue; for (const uu of [t.u0, t.u1]) o.bu(B.Dt, uu - 0.06, uu + 0.06, ptop + 0.075, ptop + 0.075 + nA * fh, t.z1 - 0.06, t.z1 + 0.05, { color: pal.fin }); break; }
    for (const s of [-1, 1]) planter(o, cu + s * 0.95, zf + 0.5, 0.1, 0.4, 0.3);
    o.dims.main = { u0, u1, z1: zf, z0: zr }; o.dims.roofY = y + 0.075; o.dims.top = tip; o.dims.goldLine = { u0, u1, y: 0.1 + h0 + 0.02, z: zf + 0.036 };
    o.dims.crownRing = { u: cu, z: (topT.z0 + topT.z1) / 2, y: tip - 0.3 }; o.dims.corners = [corners.u0, corners.u1].map((u) => ({ u, z: corners.z1, y0: ptop + 0.075, y1: y }));
  }

  function tower12(o, L) {
    const { B, pal, ctx } = o, fh = 0.7, h0 = 1.3, zr = -0.7, zf = 0.8, u0 = Math.max(-1.8, o.minU(zr, zf)), u1 = u0 + 3.8, cu = (u0 + u1) / 2;
    const n = [5, 7, 9, 11, 13][L - 1], hs = [h0, ...rep(n, fh)];
    o.bu(B.Pn, u0 - 0.1, u1 + 0.1, 0, 0.1, zr - 0.1, zf + 0.02);
    entrance(o, { u0, u1, z0: zr, z1: zf, yb: 0.1, h0 }, cu, { canopy: 0.9, cw: 0.85 });
    facade(o, 'b', cu, zr, u1 - u0, 0.1, hs, { seed: 3, finEvery: 2, lobby: true });
    facade(o, 'p', u0, (zr + zf) / 2, zf - zr, 0.1, hs, { seed: 5, finEvery: 0, lobby: true });
    facade(o, 'e', u1, (zr + zf) / 2, zf - zr, 0.1, hs, { seed: 6, finEvery: 0, lobby: true });
    const top = slab(o, { u0, u1, z0: zr, z1: zf, yb: 0.1 + h0, hs: rep(n, fh), faces: 'f', f: { finEvery: 2, cw: 0.38, litP: 0.45, sp: 0.3 }, fp: false });
    // balcony slabs along the front and the back on every floor (white, 0.14 m deep), a glass rail on top of each
    for (let i = 1; i <= n; i++) { const y = 0.1 + h0 + (i - 1) * fh; o.bu(B.Tr, u0 + 0.05, u1 - 0.05, y - 0.01, y + 0.03, zf, zf + 0.14); o.bu(B.Dt, u0 + 0.05, u1 - 0.05, y + 0.03, y + 0.17, zf + 0.12, zf + 0.135, { color: 0xbfd6e4 }); }
    // porte-cochere columns on the long canopy
    for (const s of [-1, 1]) for (const k of [0, 1]) { const cz = zf + 0.9 - 0.08; cyl(B.Tr, ctx, o.X(cu + s * (0.85 - 0.06 - k * 0.0) ), 0.1, cz, 0.04, 0.04, 1.08, 8); break; }
    // banquet wing (L2+) with a pool deck on its roof (L3+); L4+ pergola
    if (L >= 2) {
      const bu1 = u1 + 1.05, bz0 = -0.55, bz1 = 0.7, wt = slab(o, { u0: u1, u1: bu1, z0: bz0, z1: bz1, yb: 0.1, hs: [h0, fh], faces: 'fbe', f: { lobby: true, litP: 0.4, finEvery: 2 }, seed: 25 });
      o.bu(B.Pn, u1, bu1 + 0.1, 0, 0.1, bz0 - 0.1, bz1 + 0.1);
      if (L >= 3) { o.bu(B.Dt, u1 + 0.2, bu1 - 0.15, wt + 0.075, wt + 0.085, bz0 + 0.2, bz1 - 0.2, { color: 0x4aa8d8, skip: [0, 1, 3, 4, 5] }); planter(o, bu1 - 0.1, bz1 - 0.1, wt + 0.075 - 0.1 + 0.1, 0.25, 0.2); }
      if (L >= 4) pergola(o, wt + 0.075, u1 + 0.1, u1 + 0.5, bz0 + 0.1, bz0 + 0.4, pal);
    }
    // roof: sign board on posts (hotel board: navy with white bars), mech, two masts
    const roofY = top + 0.075;
    o.bu(B.Dt, cu - 0.8, cu + 0.8, roofY + 0.25, roofY + 0.6, zf - 0.28, zf - 0.24, { color: NAVY }); o.bu(B.Dt, cu - 0.8, cu + 0.8, roofY + 0.25, roofY + 0.28, zf - 0.26, zf - 0.22, { color: pal.acc });
    for (let i = 0; i < 9; i++) o.bu(B.Dt, cu - 0.66 + i * 0.16, cu - 0.58 + i * 0.16, roofY + 0.36, roofY + 0.49, zf - 0.24, zf - 0.22, { color: WHITE });
    for (const s of [-1, 1]) o.bu(B.St, cu + s * 0.7 - 0.02, cu + s * 0.7 + 0.02, roofY, roofY + 0.28, zf - 0.27, zf - 0.23);
    mech(o, roofY, u0 + 0.3, u0 + 0.9, zr + 0.15, zr + 0.5, 0.3);
    const tip = mast(o, u1 - 0.3, -0.3, roofY, 1.1);
    o.dims.main = { u0, u1, z1: zf, z0: zr }; o.dims.roofY = roofY; o.dims.top = Math.max(tip, roofY + 0.6); o.dims.goldLine = { u0, u1, y: 0.1 + h0 + 0.02, z: zf + 0.036 };
    o.dims.crownRing = { u: u1 - 0.3, z: -0.3, y: tip - 0.3 }; o.dims.corners = [u0, u1].map((u) => ({ u, z: zf, y0: 0.1 + h0, y1: top }));
    o.dims.shaft = { u0, u1, z0: zr, z1: zf, y0: 0.1 + h0, y1: top, cu };
  }

  function tower15(o, L) {
    const { B, pal, ctx } = o, fh = 0.8, h0 = 1.3, zr = -1.0, zf = 1.0, u0 = -2.2, u1 = 2.0, ud = 0.1;
    const ptop = podium(o, { u0, u1, z0: zr, z1: zf, h0, nP: 1, fh, ud }, { cw: 0.7 });
    const y0 = ptop + 0.075;
    const T1 = { u0: -0.45, u1: 0.65, z0: -0.7, z1: 0.3, fh }, T2 = { u0: 1.0, u1: 1.8, z0: -0.55, z1: 0.2, fh }, T3 = { u0: -1.8, u1: -1.05, z0: -0.5, z1: 0.2, fh };
    const n1 = [5, 7, 8, 9, 10][L - 1], n2 = [0, 4, 5, 6, 7][L - 1], n3 = [0, 0, 4, 5, 6][L - 1], f = { cw: 0.28, finEvery: 3, litP: 0.4 };
    const y1 = tier(o, T1, y0, n1, f); let top = y1, tips = [];
    let y2 = 0, y3 = 0;
    if (n2) { y2 = tier(o, T2, y0, n2, f); top = Math.max(top, y2); }
    if (n3) { y3 = tier(o, T3, y0, n3, f); top = Math.max(top, y3); }
    // roof plaza: planters + two trees (blobs) + a lamp row
    for (const uu of [-0.9, 0.5, 1.4]) planter(o, uu, 0.75, y0 - 0.1 + 0.1, 0.4, 0.25);
    // skybridge T1 - T2 (L4+): a glass box on a steel frame between the towers at floor 6
    if (L >= 4 && n2) {
      const by = y0 + 5 * fh + 0.05, bh = 0.34;
      o.bu(B.St, T1.u1 - 0.02, T2.u0 + 0.02, by, by + 0.05, -0.38, -0.12); o.bu(B.Gl, T1.u1 - 0.02, T2.u0 + 0.02, by + 0.05, by + bh, -0.38, -0.12); o.bu(B.St, T1.u1 - 0.02, T2.u0 + 0.02, by + bh, by + bh + 0.04, -0.4, -0.1);
      o.dims.bridge = { u0: T1.u1, u1: T2.u0, y: by };
    }
    // roofs: mech + spires with aviation lights (L5: one on each tower), heliport on the low tower (L5)
    const tip1 = mast(o, 0.1, -0.2, y1 + 0.075, L >= 5 ? 1.9 : 1.2);
    top = Math.max(top, tip1);
    if (n2) { mech(o, y2 + 0.075, T2.u0 + 0.12, T2.u0 + 0.5, T2.z0 + 0.1, T2.z0 + 0.35, 0.2); if (L >= 5) mast(o, 1.4, -0.2, y2 + 0.075, 1.0); }
    if (n3) {
      if (L >= 5) { cyl(B.Dt, ctx, o.X(-1.42), y3 + 0.075, -0.15, 0.3, 0.3, 0.03, 16, { color: 0x4a4f57 }); o.bu(B.Dt, -1.52, -1.48, y3 + 0.105, y3 + 0.112, -0.3, 0.0, { color: WHITE }); o.bu(B.Dt, -1.36, -1.32, y3 + 0.105, y3 + 0.112, -0.3, 0.0, { color: WHITE }); o.bu(B.Dt, -1.52, -1.32, y3 + 0.105, y3 + 0.112, -0.17, -0.13, { color: WHITE }); }
      else mech(o, y3 + 0.075, T3.u0 + 0.12, T3.u0 + 0.5, T3.z0 + 0.1, T3.z0 + 0.35, 0.2);
    }
    o.dims.main = { u0, u1, z1: zf, z0: zr }; o.dims.roofY = y1 + 0.075; o.dims.top = top; o.dims.goldLine = { u0, u1, y: 0.1 + h0 + 0.02, z: zf + 0.036 };
    o.dims.crownRing = { u: 0.1, z: -0.2, y: tip1 - 0.3 }; o.dims.corners = [T1.u0, T1.u1].map((u) => ({ u, z: T1.z1, y0, y1 }));
    o.dims.shaft = { u0: T1.u0, u1: T1.u1, z0: T1.z0, z1: T1.z1, y0, y1, cu: 0.1 };
  }

  // ============================================================================================== assembly
  function assemble(o, kind, L, name, stageIdx) {
    const M = o.M, B = o.B, group = new THREE.Group();
    group.name = name;
    const add = (m) => { if (m) group.add(m); return m; };
    add(toMesh(B.Pn, M.plinth, { cast: false }));
    add(toMesh(B.Wl, M.wall[o.pal.wall], { cast: true }));
    add(toMesh(B.Cw, M.curtain, { cast: true, name: 'curtainWallV161' }));
    add(toMesh(B.Lit, M.win, { receive: false, name: 'litWindowsV161' }));
    add(toMesh(B.Tr, M.trim, { cast: false }));
    add(toMesh(B.St, M.steel, { cast: false }));
    add(toMesh(B.Dt, M.detail, { soft: true, cast: false }));
    add(toMesh(B.Gl, M.lobby, { receive: false }));
    add(toMesh(B.Lp, M.lamp, { soft: true, receive: false }));
    add(toMesh(B.Bn, M.beacon, { soft: true, receive: false, name: 'aviationLightV161' }));
    const d = o.dims.door;
    // the revolving door: a glass drum (the mesh the door tests measure) standing in the entrance niche
    const dm = new THREE.Mesh(new THREE.CylinderGeometry(d.r, d.r, d.h, 12), M.lobby);
    dm.position.set(o.X(d.u), d.y, d.z); dm.userData.v161Door = true; dm.userData.v161Soft = true; dm.castShadow = false; dm.receiveShadow = false;
    dm.updateMatrix(); dm.matrixAutoUpdate = false;
    group.add(dm);
    const ud = group.userData;
    ud.v161Complete = true; ud.v44Detailed = true; ud.v157Finish = true;
    if (kind === 'office') ud.v161Office = name; else ud.v161Tower = name;
    ud.v161Footprint = o.footprint.map((f) => {
      if (f.u !== undefined) return { x: o.X(f.u), z: f.z, hx: f.hx, hz: f.hz, yaw: f.yaw || 0 };
      const r = o.rx(f.u0, f.u1), pad = 0.04; return { x: (r[0] + r[1]) / 2, z: (f.z0 + f.z1) / 2, hx: (r[1] - r[0]) / 2 + pad, hz: (f.z1 - f.z0) / 2 + pad };    // +4 cm: the facade quads / fins stand 1-5 cm proud of the core
    });
    ud.v161Dims = o.dims; o.dims.level = L; o.dims.idx = stageIdx;
    ud.levelV161 = L;
    return group;
  }

  const OFFICE = { 6: office6, 7: office7, 11: office11, 14: office14 }, TOWER = { 8: tower8, 9: tower9, 12: tower12, 15: tower15 };
  const NAMES = { 6: 'officeV161', 7: 'businessCentreV161', 11: 'researchCentreV161', 14: 'conventionCentreV161', 8: 'skyscraperV161', 9: 'empireTowerV161', 12: 'grandHotelV161', 15: 'financialQuarterV161' };
  function buildOfficeV161(stage, height, baseSize, level = 1) {
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1, fn = OFFICE[idx] || office6, L = Math.max(1, Math.min(5, Math.floor(level) || 1));
    const o = setup(stage, 'office'); fn(o, L);
    return assemble(o, 'office', L, NAMES[idx] || 'officeV161', idx);
  }
  function buildTowerV161(stage, height, baseSize, level = 1) {
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1, fn = TOWER[idx] || tower8, L = Math.max(1, Math.min(5, Math.floor(level) || 1));
    const o = setup(stage, 'tower'); fn(o, L);
    return assemble(o, 'tower', L, NAMES[idx] || 'skyscraperV161', idx);
  }

  // ============================================================================================== gold tiers 6-10
  function addGold(group, stage, level) {
    const d = group.userData.v161Dims, M = smats();
    if (!d) return false;
    const o = kit(d.gs, PAL[d.idx] || PAL[6], d.idx), { B, ctx } = o, bt = B.Tr, tower = !!group.userData.v161Tower;
    let maxY = 0;
    const mastRings = (m, n) => { for (let i = 0; i < n; i++) { const y = m.y0 + m.h * (0.12 + i * 0.1); cyl(bt, ctx, o.X(m.u), y, m.z, 0.05, 0.05, 0.035, 8); maxY = Math.max(maxY, y + 0.035); } };
    // 6: a gold line along the lobby cornice + one gold pip per tier above 5 beside the sign, rings on the first mast
    const gl = d.goldLine;
    o.bu(bt, gl.u0 + 0.05, gl.u1 - 0.05, gl.y, gl.y + 0.03, gl.z - 0.004, gl.z + 0.026);
    for (let i = 0; i < level - 5; i++) o.bx(bt, (gl.u0 + gl.u1) / 2 - 0.6 + i * 0.1, gl.y + 0.2, gl.z + 0.02, 0.05, 0.05, 0.012);
    if (d.masts && d.masts[0]) mastRings(d.masts[0], 1);
    // 7: gold canopy edge + door jambs + a second ring
    if (level >= 7) {
      const dr = d.door, cw = (d.canopy && d.canopy.half) || 0.7;
      if (d.canopy) o.bu(bt, -d.canopy.half, d.canopy.half, d.canopy.y + 0.215, d.canopy.y + 0.245, d.canopy.cz1 - 0.02, d.canopy.cz1 + 0.01);
      else o.bu(bt, dr.u - cw, dr.u + cw, dr.canopyY + 0.065, dr.canopyY + 0.1, dr.canopyZ - 0.02, dr.canopyZ + 0.01);
      for (const s of [-1, 1]) o.bu(bt, dr.u + s * 0.46 - 0.012, dr.u + s * 0.46 + 0.012, 0.1, 0.1 + dr.h + 0.1, dr.front - 0.52, dr.front - 0.5 + 0.0);
      if (d.masts && d.masts[0]) mastRings(d.masts[0], 2);
    }
    // 8: gold corner fins up the front corners of the shaft / main block + a gold stripe at the roof edge
    if (level >= 8) {
      for (const c of d.corners || []) { o.bu(bt, c.u - 0.025, c.u + 0.025, c.y0, c.y1, c.z + 0.05, c.z + 0.075); maxY = Math.max(maxY, c.y1); }
      const c0 = (d.corners || [])[0];
      if (c0) { const cs = d.corners; o.bu(bt, Math.min(...cs.map((c) => c.u)), Math.max(...cs.map((c) => c.u)), c0.y1 - 0.0, c0.y1 + 0.02, c0.z + 0.04, c0.z + 0.06); }
      if (d.masts && d.masts[0]) mastRings(d.masts[0], 3);
    }
    // 9: a gold spire sleeve on the first mast + a pennant (offices) / a gold needle (towers)
    if (level >= 9) {
      const m = d.masts && d.masts[0];
      if (m) {
        cyl(bt, ctx, o.X(m.u), m.y0 + m.h * 0.55, m.z, 0.045, 0.02, m.h * 0.38, 8); maxY = Math.max(maxY, m.y0 + m.h * 0.93);
        const px = o.X(m.u), py = m.y0 + m.h * 0.8;
        quad(bt, ctx, [px, py, m.z], [px + o.gs * 0.26, py - 0.05, m.z], [px + o.gs * 0.26, py - 0.17, m.z], [px, py - 0.12, m.z]); quad(bt, ctx, [px, py - 0.12, m.z], [px + o.gs * 0.26, py - 0.17, m.z], [px + o.gs * 0.26, py - 0.05, m.z], [px, py, m.z]);
      }
    }
    // 10: the crown (exactly once): a block crown on the roof of an office, a ring crown around the spire of a tower; always >= 0.2 m above every other gold part
    if (level >= 10) {
      if (!tower) {
        const c = d.crown; let cy = c.y;
        const ex = Math.max(0, maxY + 0.22 - (cy + 0.91));
        o.bx(bt, c.u, cy + (0.17 + ex) / 2, c.z, 0.42, 0.34 + ex, 0.42); cy += ex; o.bx(bt, c.u, cy + 0.38, c.z, 0.56, 0.07, 0.56);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 0.2 : 0.23; cone(bt, ctx, o.X(c.u) + Math.cos(a) * r, cy + 0.41, c.z + Math.sin(a) * r, 0.06, i % 2 ? 0.2 : 0.34, 6); }
        cone(bt, ctx, o.X(c.u), cy + 0.41, c.z, 0.13, 0.5, 8);
      } else {
        const c = d.crownRing, cy = Math.max(c.y, maxY + 0.0 - 0.1) + 0.0;
        // a ring of four thin bars + eight points around the mast (the mast and its aviation light stay visible in the middle)
        const R = 0.27;
        for (const [a0, a1] of [[0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2]]) { const x0 = Math.cos(a0 * Math.PI) * R, z0 = Math.sin(a0 * Math.PI) * R, x1 = Math.cos(a1 * Math.PI) * R, z1 = Math.sin(a1 * Math.PI) * R; box(bt, ctx, o.X(c.u) + (x0 + x1) / 2, cy + 0.03, c.z + (z0 + z1) / 2, Math.abs(x1 - x0) + 0.04, 0.06, Math.abs(z1 - z0) + 0.04); }
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 0.23 : 0.27; cone(bt, ctx, o.X(c.u) + Math.cos(a) * r, cy + 0.06, c.z + Math.sin(a) * r, 0.07, i % 2 ? 0.3 : 0.5, 6); }
        maxY = Math.max(maxY, cy + 0.56);
      }
    }
    const mesh = toMesh(bt, M.gold, { cast: true, soft: true, name: 'officeTowerGoldV161' });
    if (mesh) group.add(mesh);
    group.userData.goldTierV161 = level;
    return true;
  }

  // ============================================================================================== live: night windows + aviation light (shared materials, 90 ms tick, no per-frame allocation)
  let tickT = 0;
  function windowTick(now) {
    if (now - tickT < 90) return; tickT = now;
    if (!SM) return;
    let night = false; try { night = isNightV40(); } catch (e) { /* layer not ready */ }
    SM.win.emissiveIntensity += ((night ? 0.95 : 0.0) - SM.win.emissiveIntensity) * 0.08;
    SM.curtain.emissiveIntensity += ((night ? 0.1 : 0.22) - SM.curtain.emissiveIntensity) * 0.08;
    SM.beacon.emissiveIntensity = (Math.floor(now / 700) % 2) ? 1.9 : 0.2;
  }
  (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push(windowTick);

  window.buildOfficeV161 = buildOfficeV161;
  window.buildTowerV161 = buildTowerV161;
  window.OfficeTowerV161 = { enabled: true, buildOffice: buildOfficeV161, buildTower: buildTowerV161, addGold, padLocal, smats, version: 'v161-offices-towers' };
})();
