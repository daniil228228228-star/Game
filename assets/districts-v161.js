/* District identities v161 (2026-10-10 (13), "improve physics and design of every building", backlog CITY / DISTRICT BUILDINGS): INDUSTRIAL ZONE, BUSINESS CENTRE, WATERFRONT.
 *
 * makeDistrictIdentityGroupV363 built these three groups from generic props: 21 / 61 / 113 meshes (measured on the stage-16 world, 2026-10-10), NO collider at all (the player walked
 * through warehouses, towers and the pond: 6 / 8 / 1 of 8 directions reached the middle), the waterfront group sunk to y -0.12 and its piers floated 0.27 m off the quay while
 * ending on grass. The suburb identity was rebuilt in (8) (assets/buildings-v161.js); this file does the other three the same way: merged, solid where it is solid, same place,
 * same size, same level rules (the district level 1..3 drives the same counts as before):
 *   industrial : a concrete yard with a lane marking, two gabled warehouses (roller door, window, vent stack; the second grows with the level), 2 + lv shipping containers (ribbed,
 *                four colours), two storage tanks (band, domed roof, ladder), a floodlight
 *   business   : a plaza with a round pool in the middle, two glass towers (plinth, window floors, crown, mast; 3.2-5 m and 4.6-7 m by level), a low annex with a canopy, four
 *                planters and four lamps on the old radial slots
 *   waterfront : a quay (walk + coping + rail), a pond whose surface is animated (assets/infra-plants-v161.js addWater: the same vertex ripple as the water works), two piers that start
 *                AT the quay and end in the water (1.9 + 0.5 lv m), benches facing the water, four lamps, 2 + lv palms spread over the quay (the old row ran off it at level 3)
 * Physics: `userData.v161Footprint` = oriented boxes / circles (warehouses, containers, tanks, towers, annex, pool, planters, lamps, benches, palm trunks; the pond is solid except the
 * two pier corridors, the quay rail is the wall). Registered through `DistrictsV161.obstacles()` (rebuildStatic): player + agent only, no placement / camera flag (road and decor
 * planners read exactly what they read before). `DistrictsV161.blocks(x, z, margin)` lets the district infra pads keep clear of the solid parts.
 * `DistrictsV161.enabled = false` brings the old groups back.
 */
'use strict';
(() => {
  const IK = window.InfraV161 && window.InfraV161.kit;
  if (!IK) return;
  const { batch, mats, C, castOk, hall, floodLight, addWater, TAU } = IK;
  const SET = () => ({ Cn: batch(true), R: batch(true), P: batch(true), S: batch(true), L: batch(false), G: batch(false), W: batch(false) });
  const KEYS = ['Cn', 'R', 'P', 'S', 'L', 'G'];
  // run fn on a local set (origin = the part's own centre, front = -z), append it rotated by yaw at (x, z); footprints are moved the same way
  function local(M, fps, x, z, yaw, fn) {
    const T = SET(), fp = [];
    fn(T, fp);
    for (const k of KEYS) M[k].append(T[k], x, 0, z, yaw);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const f of fp) {
      const wx = x + f.x * c + f.z * s, wz = z - f.x * s + f.z * c;
      fps.push(f.r ? { x: wx, z: wz, r: f.r, tree: f.tree } : { x: wx, z: wz, hx: f.hx, hz: f.hz, yaw });
    }
  }
  function finish(g, M, fp, extra) {
    const MT = mats(), cast = castOk(), add = (m) => { if (m) g.add(m); return m; };
    add(M.Cn.toMesh(MT.concrete, { cast: false, name: 'v161DistrictConcrete' }));
    add(M.R.toMesh(MT.roof, { cast, name: 'v161DistrictRoof' }));
    add(M.P.toMesh(MT.paint, { cast, name: 'v161DistrictPaint' }));
    add(M.S.toMesh(MT.soft, { cast: false, name: 'v161DistrictSoft', soft: true }));
    add(M.L.toMesh(MT.lamp, { cast: false, receive: false, name: 'v161DistrictLamp', soft: true }));
    add(M.G.toMesh(MT.glass, { cast: false, receive: false, name: 'v161DistrictGlass', soft: true }));
    if (M.W) add(M.W.toMesh(MT.water, { cast: false, receive: false, name: 'v161DistrictWater', soft: true }));
    if (extra) extra(add);
    g.userData.v161Footprint = fp;
    g.userData.v161District = true;
    return g;
  }
  const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f).getHex();
  const cylRing = (B, x, z, r, y0, y1, c) => B.cyl(r, r, y1 - y0, 16, x, (y0 + y1) / 2, z, { c });

  // ================================================================================================ INDUSTRIAL ZONE
  const CONT = [0xd57d43, 0x5f95c8, 0xbac162, 0xb58acf];
  function warehouse(T, fp, w, d, h, wallC, roofC, doorC) {
    const hh = hall(null, { Cn: T.Cn, R: T.R, P: T.P, G: T.G, fp, cx: 0, cz: 0, w, d, h, wallC, roofC, doorX: w * 0.2, doorW: 0.42, doorH: h * 0.78, doorC, trim: C.white, windows: [-w * 0.3, -w * 0.08], ridge: 0.26 });
    // vent stack on the roof ridge side + a rain pipe: parts of the same wall
    T.P.cyl(0.11, 0.13, 0.75, 10, -w * 0.34, 0.1 + h + 0.45, d * 0.18, { c: 0x8f949a });
    T.P.cyl(0.15, 0.15, 0.06, 10, -w * 0.34, 0.1 + h + 0.86, d * 0.18, { c: 0xbfc7ce });
    T.P.ext(w / 2 - 0.02, w / 2 + 0.03, 0.1, 0.1 + h, d / 2 - 0.12, d / 2 - 0.06, 0x7d8690);
    return hh;
  }
  function container(T, fp, col, y) {
    const w = 0.66, hgt = 0.44, d = 0.44, y0 = y || 0.05, dk = shade(col, 0.78);
    T.P.ext(-w / 2, w / 2, y0, y0 + hgt, -d / 2, d / 2, col);
    for (let i = 0; i < 6; i++) { const x = -w / 2 + 0.07 + i * 0.104; T.P.ext(x - 0.018, x + 0.018, y0 + 0.03, y0 + hgt - 0.03, -d / 2 - 0.012, -d / 2, dk); T.P.ext(x - 0.018, x + 0.018, y0 + 0.03, y0 + hgt - 0.03, d / 2, d / 2 + 0.012, dk); }
    T.P.ext(-w / 2 - 0.01, w / 2 + 0.01, y0 + hgt, y0 + hgt + 0.02, -d / 2 - 0.01, d / 2 + 0.01, dk);
    T.P.ext(w / 2 - 0.005, w / 2 + 0.01, y0 + 0.03, y0 + hgt - 0.03, -0.1, 0.1, C.dark);   // doors end
    if (!y) fp.push({ x: 0, z: 0, hx: w / 2 + 0.02, hz: d / 2 + 0.02 });
  }
  function tank(P, S, fp, x, z, r, h) {
    P.cyl(r, r, h, 16, x, 0.05 + h / 2, z, { c: 0xc3c8cf });
    P.cyl(r + 0.02, r + 0.02, 0.07, 16, x, 0.05 + h * 0.5, z, { c: 0x6a8db2 });
    P.cyl(r * 0.25, r, 0.2, 16, x, 0.05 + h + 0.1, z, { c: 0xa9b0b8 });
    P.cyl(0.04, 0.04, 0.12, 8, x, 0.05 + h + 0.26, z, { c: C.dark });
    for (const sx of [-0.07, 0.07]) S.ext(x + sx - 0.012, x + sx + 0.012, 0.05, 0.05 + h + 0.05, z - r - 0.04, z - r - 0.015, C.rail);
    for (let k = 0; k < Math.floor(h / 0.17); k++) S.ext(x - 0.07, x + 0.07, 0.12 + k * 0.17, 0.14 + k * 0.17, z - r - 0.05, z - r - 0.025, C.rail);
    fp.push({ x, z, r: r + 0.04 });
  }
  function buildIndustrial(lv) {
    const g = new THREE.Group(); g.name = 'v161DistrictIndustrial';
    const M = SET(), fp = [];
    M.Cn.cyl(2.55, 2.6, 0.05, 28, 0, 0.025, 0, { c: 0x8b9097 });
    for (let i = -1; i <= 1; i++) M.Cn.ext(i * 0.42 - 0.07, i * 0.42 + 0.07, 0.05, 0.056, -0.95, 0.95, 0xe8dfc6);
    local(M, fp, -2.3, -0.5, Math.PI + 0.18, (T, f) => warehouse(T, f, 2.06, 1.46, 1.3, 0xb4b0a8, 0x6f7883, 0xd67f41));
    const s2 = 0.74 + 0.08 * lv;
    local(M, fp, 2.05, 0.65, Math.PI - 0.22, (T, f) => warehouse(T, f, 2.4 * s2, 1.7 * s2, 1.5 * s2, 0x9ea6ad, 0x56626f, 0x6a8db2));
    for (let i = 0; i < 2 + lv; i++) local(M, fp, -1.7 + i * 0.72, 2.35 - (i % 2) * 0.58, 0.06 * (i % 3 - 1), (T, f) => container(T, f, CONT[i % 4]));
    if (lv >= 3) local(M, fp, -1.7 + 0.72 * 2, 2.35 - 0 * 0.58, 0.0, (T) => container(T, [], CONT[1], 0.49));
    tank(M.P, M.S, fp, -0.8, -2.1, 0.42, 0.88); tank(M.P, M.S, fp, 0.4, -2.1, 0.42, 0.88);
    M.P.cyl(0.05, 0.05, 0.9, 8, -0.2, 0.55, -2.1, { rz: Math.PI / 2, c: 0x7d8690 });          // pipe between the tanks
    floodLight(M.P, M.L, fp, 3.05, -1.55, 2.2, 0);
    return finish(g, M, fp);
  }

  // ================================================================================================ BUSINESS CENTRE
  function glassTower(T, fp, w, H, body, win, yaw) {
    const y0 = 0.24;
    T.Cn.ext(-w * 0.69, w * 0.69, 0, y0, -w * 0.69, w * 0.69, 0xd8d1c6);
    T.P.ext(-w / 2, w / 2, y0, H, -w / 2, w / 2, body);
    const floors = Math.max(3, Math.floor((H - y0 - 0.5) / 0.46));
    for (let k = 0; k < floors; k++) {
      const yb = y0 + 0.3 + k * 0.46;
      T.P.ext(-w / 2 + 0.07, w / 2 - 0.07, yb, yb + 0.26, -w / 2 - 0.012, -w / 2, win); T.P.ext(-w / 2 + 0.07, w / 2 - 0.07, yb, yb + 0.26, w / 2, w / 2 + 0.012, win);
      T.P.ext(-w / 2 - 0.012, -w / 2, yb, yb + 0.26, -w / 2 + 0.07, w / 2 - 0.07, win); T.P.ext(w / 2, w / 2 + 0.012, yb, yb + 0.26, -w / 2 + 0.07, w / 2 - 0.07, win);
    }
    T.P.ext(-w * 0.35, w * 0.35, H, H + 0.22, -w * 0.35, w * 0.35, 0x2e4f70);
    T.P.ext(-w * 0.18, w * 0.18, H + 0.22, H + 0.5, -w * 0.18, w * 0.18, 0x6b7a8a);
    T.P.cyl(0.018, 0.018, 0.7, 6, 0, H + 0.85, 0, { c: C.dark });
    T.L.cyl(0.04, 0.04, 0.05, 8, 0, H + 1.22, 0);
    fp.push({ x: 0, z: 0, hx: w / 2 + 0.04, hz: w / 2 + 0.04 });
  }
  function planter(T, fp, x, z) {
    T.Cn.cyl(0.46, 0.5, 0.24, 14, x, 0.12, z, { c: 0xc9beb0 });
    T.P.cyl(0.38, 0.4, 0.04, 14, x, 0.26, z, { c: 0x6fb974 });
    T.P.ell(0.3, 0.2, 0.3, x, 0.42, z, { c: 0x5e9a52 }); T.P.ell(0.17, 0.12, 0.17, x + 0.12, 0.54, z - 0.05, { c: 0xf08ab0 });
    fp.push({ x, z, r: 0.5 });
  }
  function buildBusiness(lv) {
    const g = new THREE.Group(); g.name = 'v161DistrictBusiness';
    const M = SET(), fp = [];
    M.Cn.cyl(2.35, 2.4, 0.05, 28, 0, 0.025, 0, { c: 0xdcd7cf });
    for (const r of [1.5, 1.9]) M.Cn.ring(0, 0, r - 0.04, r + 0.04, 0.05, 0.057, 28, 0xc9c3b8);                       // paving rings
    // round pool in the middle (stone rim, still water)
    M.Cn.ring(0, 0, 0.5, 0.64, 0.05, 0.3, 20, 0xb4ab9a, { inner: true });
    M.W.cyl(0.5, 0.5, 0.02, 20, 0, 0.24, 0);
    local(M, fp, -2.35, -0.8, 0, (T, f) => glassTower(T, f, 1.3, 3.2 + 0.59 * lv, 0x4a6a8f, 0x9cc3e6));
    local(M, fp, 2.1, 0.55, 0, (T, f) => glassTower(T, f, 1.43, 4.6 + 0.83 * lv, 0x3e5878, 0x8fb6dc));
    local(M, fp, 0.35, -2.0, 0, (T, f) => {
      T.Cn.ext(-1.12, 1.12, 0, 0.08, -0.8, 0.8, 0xd5d0c6);
      T.P.ext(-1.075, 1.075, 0.08, 1.05, -0.75, 0.75, 0xbfcde0);
      T.P.ext(-1.15, 1.15, 1.05, 1.13, -0.82, 0.82, 0x6b7785);
      for (let k = 0; k < 5; k++) T.P.ext(-0.9 + k * 0.45, -0.9 + k * 0.45 + 0.3, 0.45, 0.85, 0.75, 0.762, 0x7fa7cf);          // window strip (+z face)
      T.P.ext(-0.35, 0.35, 0.08, 0.72, 0.75, 0.77, 0x3a4552);                                                                   // entrance
      T.P.ext(-0.55, 0.55, 0.86, 0.9, 0.75, 1.15, 0x59636f); T.P.ext(-0.52, -0.48, 0.1, 0.86, 1.1, 1.14, 0x59636f); T.P.ext(0.48, 0.52, 0.1, 0.86, 1.1, 1.14, 0x59636f);   // canopy + posts
      T.P.ext(-0.7, -0.2, 1.13, 1.33, -0.3, 0.2, 0xa9b0b8); T.P.ext(0.3, 0.8, 1.13, 1.28, -0.3, 0.2, 0xa9b0b8);               // roof units
      f.push({ x: 0, z: 0, hx: 1.12, hz: 0.82 });
    });
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i / 4 * TAU; local(M, fp, Math.cos(a) * 3.0, Math.sin(a) * 3.0, 0, (T, f) => planter(T, f, 0, 0)); floodLight(M.P, M.L, fp, Math.cos(a) * 4.1, Math.sin(a) * 4.1, 1.9, 0); }
    fp.push({ x: 0, z: 0, r: 0.68 });
    return finish(g, M, fp);
  }

  // ================================================================================================ WATERFRONT
  const WF = { quayZ0: 1.1, quayZ1: 2.7, pondZ1: 6.1, X: 4.1 };
  function buildWaterfront(lv) {
    const g = new THREE.Group(); g.name = 'v161DistrictWaterfront';
    const M = SET(), fp = [], X = WF.X;
    // quay: walk, coping on the water side; pond bed + low kerb round the pond
    M.Cn.ext(-4.3, 4.3, 0, 0.1, WF.quayZ0, WF.quayZ1, 0xd9d0c2);
    M.Cn.ext(-4.3, 4.3, 0.1, 0.13, WF.quayZ1 - 0.1, WF.quayZ1, 0xb8b0a2);
    M.P.ext(-X, X, 0, 0.035, WF.quayZ1, WF.pondZ1, 0x3f7f8f);                                                   // pond bed (hides the grass under the water)
    M.Cn.ext(-X - 0.12, -X, 0, 0.12, WF.quayZ1, WF.pondZ1 + 0.12, 0xb8b0a2); M.Cn.ext(X, X + 0.12, 0, 0.12, WF.quayZ1, WF.pondZ1 + 0.12, 0xb8b0a2); M.Cn.ext(-X - 0.12, X + 0.12, 0, 0.12, WF.pondZ1, WF.pondZ1 + 0.12, 0xb8b0a2);
    // quay rail: posts every 0.75 m with two rails, open at the two piers
    const pierW = 0.64, plen = 1.9 + 0.5 * lv, pierX = [-2.3, 2.3];
    const railRuns = [[-4.25, pierX[0] - pierW - 0.1], [pierX[0] + pierW + 0.1, pierX[1] - pierW - 0.1], [pierX[1] + pierW + 0.1, 4.25]];
    for (const [a, b] of railRuns) {
      const n = Math.max(1, Math.round((b - a) / 0.75));
      M.S.ext(a, b, 0.52, 0.56, WF.quayZ1 - 0.05, WF.quayZ1 - 0.01, C.rail); M.S.ext(a, b, 0.3, 0.33, WF.quayZ1 - 0.05, WF.quayZ1 - 0.01, C.rail);
      for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; M.S.ext(x - 0.025, x + 0.025, 0.13, 0.58, WF.quayZ1 - 0.06, WF.quayZ1, C.steelDark); }
    }
    // piers: start at the quay edge, deck above the coping, posts into the pond bed
    for (const px of pierX) {
      M.P.ext(px - pierW, px + pierW, 0.12, 0.17, WF.quayZ1 - 0.1, WF.quayZ1 + plen, 0xa17953);
      for (let k = 0; k <= 4; k++) { const z = WF.quayZ1 + 0.1 + k * (plen - 0.2) / 4; for (const sx of [-1, 1]) M.P.ext(px + sx * (pierW - 0.06) - 0.04, px + sx * (pierW - 0.06) + 0.04, 0.035, 0.12, z - 0.04, z + 0.04, 0x7b5b3b); }
      for (let k = 0; k < 7; k++) { const z = WF.quayZ1 + k * (plen - 0.1) / 6; M.S.ext(px - pierW, px + pierW, 0.17, 0.175, z, z + 0.012, 0x8a6643); }   // plank joints
    }
    // pond solid except the two pier corridors
    const left = [-X - 0.12, pierX[0] - pierW - 0.05], mid = [pierX[0] + pierW + 0.05, pierX[1] - pierW - 0.05], right = [pierX[1] + pierW + 0.05, X + 0.12];
    for (const [a, b] of [left, mid, right]) fp.push({ x: (a + b) / 2, z: (WF.quayZ1 - 0.04 + WF.pondZ1 + 0.12) / 2, hx: (b - a) / 2, hz: (WF.pondZ1 + 0.12 - WF.quayZ1 + 0.04) / 2, kind: 'pond' });
    for (const px of pierX) { const z0 = WF.quayZ1 + plen + 0.02, z1 = WF.pondZ1 + 0.12; if (z1 - z0 > 0.1) fp.push({ x: px, z: (z0 + z1) / 2, hx: pierW + 0.05, hz: (z1 - z0) / 2, kind: 'pond' }); }
    // benches facing the water
    for (const bx of [-1.65, 1.65]) local(M, fp, bx, 1.35, 0, (T, f) => {
      T.P.ext(-0.45, 0.45, 0.4, 0.48, -0.14, 0.14, 0x8f6c46); T.P.ext(-0.45, 0.45, 0.5, 0.78, -0.17, -0.1, 0x8f6c46);
      for (const sx of [-0.34, 0.34]) { T.P.ext(sx - 0.03, sx + 0.03, 0.1, 0.42, -0.12, -0.06, 0x555d68); T.P.ext(sx - 0.03, sx + 0.03, 0.1, 0.42, 0.06, 0.12, 0x555d68); }
      f.push({ x: 0, z: 0, hx: 0.47, hz: 0.17 });
    });
    for (const lx of [-3.2, -1.1, 1.1, 3.2]) floodLight(M.P, M.L, fp, lx, 1.5, 2.1);
    // palms spread over the quay
    const nP = 2 + lv;
    for (let i = 0; i < nP; i++) {
      const x = nP === 1 ? 0 : -3.1 + i * 6.2 / (nP - 1), z = 0.62, k = 0.9 + 0.08 * (i % 3);
      M.P.cyl(0.07 * k, 0.1 * k, 1.5 * k, 7, x, 0.75 * k, z, { c: 0x8a6a45, rz: 0.08 * (i % 2 ? 1 : -1) });
      for (let j = 0; j < 6; j++) { const a = j / 6 * TAU; M.P.ell(0.5 * k, 0.045, 0.14 * k, x + Math.cos(a) * 0.4 * k, 1.62 * k, z + Math.sin(a) * 0.4 * k, { ry: -a, rz: -0.25, c: j % 2 ? 0x65ae77 : 0x57a06a }); }
      M.P.ell(0.12, 0.11, 0.12, x, 1.58 * k, z, { c: 0x6b4a2f });
      fp.push({ x, z, r: 0.13, tree: true });
    }
    return finish(g, M, fp);
  }
  // the animated pond is added after the group is placed in the scene tree (needs the group object)
  function addPond(g) { return addWater(g, [{ x0: -WF.X, x1: WF.X, z0: WF.quayZ1 + 0.02, z1: WF.pondZ1, y: 0.075 }]); }

  function build(id, lv) {
    if (id === 'industrial') return buildIndustrial(lv);
    if (id === 'business') return buildBusiness(lv);
    if (id === 'waterfront') { const g = buildWaterfront(lv); addPond(g); return g; }
    return null;
  }

  // ---------------------------------------------------------------------------------------------- registry hook
  function obstacles() {
    const out = [];
    let map = null; try { map = cityWorldRuntime.districtIdentity; } catch (e) { return out; }
    if (!map) return out;
    for (const id of ['industrial', 'business', 'waterfront']) {
      const g = map.get(id);
      if (!g || !g.userData || !g.userData.v161District || g.visible === false || !g.parent) continue;
      g.updateMatrixWorld(true);
      (g.userData.v161Footprint || []).forEach((f, i) => {
        const w = new THREE.Vector3(f.x, 0, f.z).applyMatrix4(g.matrixWorld), pos = new THREE.Vector3(w.x, 0, w.z), label = `district-${id}-v161:${f.kind || ''}${i}`;
        if (f.r) out.push({ owner: g, category: f.tree ? 'tree' : 'cityBuilding', label, shape: 'circle', pos, radius: f.r });
        else out.push({ owner: g, category: 'cityBuilding', label, shape: 'obb', pos, hx: f.hx, hz: f.hz, yaw: g.rotation.y + (f.yaw || 0) });
      });
    }
    return out;
  }
  // is (x, z) within `margin` of a solid part? (used by the district infra pads to stay clear)
  function blocks(x, z, margin) {
    for (const o of obstacles()) {
      if (o.shape === 'circle') { if (Math.hypot(x - o.pos.x, z - o.pos.z) < o.radius + margin) return true; continue; }
      const sy = Math.sin(o.yaw || 0), cy = Math.cos(o.yaw || 0), dx = x - o.pos.x, dz = z - o.pos.z, lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
      if (Math.abs(lx) < o.hx + margin && Math.abs(lz) < o.hz + margin) return true;
    }
    return false;
  }

  window.DistrictsV161 = { enabled: true, version: 'v161-districts', build, obstacles, blocks, WF };
})();
