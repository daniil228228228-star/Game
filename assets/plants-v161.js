/* Industrial plants v161 (2026-10-05 (6), "improve physics and design of every building, one at a time", family #2: concrete plant, metal yard, frame workshop).
 *
 * Benchmark = the sawmill v2 (assets/sawmill-v161.js): ONE coherent building per plant, a live work cycle driven by the game's own production timer, a readable
 * silhouette, details, merged meshes (about a dozen draw calls per plant instead of 74 / 14 / 11), pooled particles, levels 1..3 extend the SAME building.
 *
 *   concrete plant (buildConcretePlant -> PlantsV161.buildConcrete): batching plant on a slab. Cement silos on steel legs with conical bottoms, ladders and hazard bands
 *     (2 / 3 / 4 for level 1 / 2 / 3), a three-bin aggregate hopper with a feed belt, a skip hoist (bucket on inclined rails) that lifts aggregate to the hopper of a drum
 *     mixer, a water tank, a control cabin with windows, a roller table from the mixer chute to the loading plate. Level 2 adds the third silo and a canopy over the
 *     table, level 3 the fourth silo, a silo-top catwalk and a floodlight mast.
 *     Cycle = concretePlantTimer / interval (the timer the game credits `concrete` from): skip loads (dust) -> rises -> dumps into the hopper (dust) -> the drum mixes ->
 *     the chute forms the credited number of blocks -> they slide down the table and drop onto the pile on the loading plate in the frame the game credits them.
 *   metal yard (buildMetalYard -> PlantsV161.buildMetal): corrugated shed with a furnace (emissive glow, chimney smoke), a roller table, a cut-off wheel (pooled sparks) and
 *     a cooling rack; a slewing jib crane picks the cut beams off the rack and sets them on the pile on the loading plate. Level 2: the shed grows over the whole yard and gets
 *     a second furnace stack; level 3: an overhead hoist replaces the kicker that pushes the cut beam to the rack.
 *   frame workshop (production-chain-v161.js buildWorkshopProp -> PlantsV161.buildWorkshop): timber workshop with a door and shuttered windows, a circular saw table and a
 *     frame jig; three planks slide into the saw, the studs are nailed into a frame on the jig and the frame slides onto the stack beside the shed. Runs only while the real
 *     recipe runs (PRODUCTION_CHAIN_V161.phase()).
 * Piles on loading plates equal the real stock (floor(concrete) / floor(metal) / frames), at most STACK_CAP, one merged mesh whose draw range is the number: 0 = empty plate.
 * What is in flight (blocks / beams / a frame) is the number the game credits at the end of the cycle (latched at its start), at most 3; it lands in the slot of the pile it
 * will occupy, so the frame the game credits the item the picture does not jump. A full store (credit 0) stops the cycle.
 *
 * Physics: every group lists its real obstacles in `userData.v161Footprint` (local x, z, hx, hz; yaw 0), registered as oriented boxes by the v83 registry
 * (tycoon-v161.html, rebuildStatic) while the old STATIC_COLLIDERS circles stay for road / placement planning only (no player/agent flag).
 * Piles on plates are `v161Soft` and have no collider: the player stands ON the plate to pick up (that is the pad).
 * `PlantsV161.enabled = false` brings the old three plants back (the showcase tool uses it for before/after numbers).
 */
'use strict';
(() => {
  const FLOOR = 0.18;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const S = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  // ---------------------------------------------------------------------------------------------- palette: industrial grey / blue, yellow accents
  const C = {
    slab: 0x8b95a0, steel: 0x56697c, steelDark: 0x3a4857, steelLight: 0x8c9db0, silo: 0xc6d0da, siloCone: 0x9aa9b8, blue: 0x2f6a9b, yellow: 0xf0b21a, yellowDark: 0xd08f0c, black: 0x26303b,
    drum: 0xe3a41a, drumBand: 0x2b3a49, cabin: 0x41647f, roofDark: 0x39434e, white: 0xe9eef2, glass: 0x9cc5df, tank: 0x7fa8c8, bin1: 0xc7a76a, bin2: 0x98a3ad, bin3: 0xd7c493,
    brick: 0x7b3f2d, rust: 0x8c5a3a, beamSteel: 0x7f90a3, block1: 0x9aa2aa, block2: 0xaab1b8, block3: 0x8c949c, wood: 0xc79a5d, woodDark: 0x8d6a40, woodLight: 0xe0bf86, red: 0xb8442f,
    door: 0xd3a21d, siding: 0xd9cdb4,
  };

  // ---------------------------------------------------------------------------------------------- merged geometry batch (optionally vertex coloured)
  function batch(vc) {
    const pos = [], nor = [], uv = [], col = [], idx = [];
    const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), v = new THREE.Vector3();
    const xa = new THREE.Vector3(), ya = new THREE.Vector3(), za = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), ex = new THREE.Vector3(1, 0, 0);
    function addMatrix(geo, matrix, color) {
      n3.getNormalMatrix(matrix);
      const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, base = pos.length / 3;
      const rgb = vc ? lin(color === undefined ? 0xffffff : color) : null;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize(); nor.push(v.x, v.y, v.z);
        uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
        if (vc) col.push(rgb.r, rgb.g, rgb.b);
      }
      const I = geo.index;
      if (I) for (let k = 0; k < I.count; k++) idx.push(base + I.getX(k));
      else for (let k = 0; k < P.count; k++) idx.push(base + k);
      geo.dispose();
    }
    function add(geo, x, y, z, o) {
      o = o || {};
      q.setFromEuler(e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
      addMatrix(geo, m4.compose(p.set(x, y, z), q, sc), o.c);
    }
    // beam / slab between two points: local z runs a->b, w x h cross-section
    function bar(ax, ay, az, bx, by, bz, w, h, c) {
      za.set(bx - ax, by - ay, bz - az);
      const len = za.length(); if (len < 1e-4) return;
      za.multiplyScalar(1 / len);
      xa.crossVectors(Math.abs(za.y) > 0.98 ? ex : up, za).normalize();
      ya.crossVectors(za, xa).normalize();
      m4.makeBasis(xa, ya, za).setPosition((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      addMatrix(new THREE.BoxGeometry(w, h, len), m4, c);
    }
    // triangular gable infill (triangle in the z-y plane at x, base 2*hw at y0, apex h higher, thickness t along x)
    function gable(x, zc, y0, hw, h, t, c) {
      const g = [], gn = [], gi = [];
      const A = [t / 2, 0, -hw], B = [t / 2, 0, hw], Cc = [t / 2, h, 0], A2 = [-t / 2, 0, -hw], B2 = [-t / 2, 0, hw], C2 = [-t / 2, h, 0];
      const tri = (a, b, cc, hint) => {
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
        let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
        if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { const tmp = b; b = cc; cc = tmp; n = [-n[0], -n[1], -n[2]]; }
        const base = g.length / 3;
        for (const pt of [a, b, cc]) { g.push(pt[0], pt[1], pt[2]); gn.push(n[0], n[1], n[2]); }
        gi.push(base, base + 1, base + 2);
      };
      tri(A, B, Cc, [1, 0, 0]); tri(A2, B2, C2, [-1, 0, 0]);
      const sl = h / hw, nL = [0, 1, -sl], nR = [0, 1, sl];
      tri(A, Cc, C2, nL); tri(A, C2, A2, nL); tri(B, Cc, C2, nR); tri(B, C2, B2, nR);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(gn, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(g.length / 3 * 2).fill(0), 2));
      geo.setIndex(gi);
      add(geo, x, y0, zc, { c });
    }
    return {
      add, bar, gable,
      box: (w, h, d, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), x, y, z, o),
      cyl: (rt, rb, h, seg, x, y, z, o) => add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!(o && o.open)), x, y, z, o),
      sph: (r, x, y, z, o) => add(new THREE.SphereGeometry(r, 8, 6), x, y, z, o),
      get count() { return idx.length / 3; },
      toMesh(material, { cast = true, receive = true, name = '', soft = false } = {}) {
        if (!idx.length) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        if (vc) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeBoundingBox(); g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, material);
        mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.name = name;
        if (soft) mesh.userData.v161Soft = true;
        return mesh;
      },
    };
  }

  // ---------------------------------------------------------------------------------------------- shared materials (never disposed)
  let MATS = null;
  function mats() {
    if (MATS) return MATS;
    const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    const fam = (family, hex, opts) => share(createSurfaceMaterialV152(family, lin(hex), opts));
    MATS = {
      slab: fam('concrete', C.slab, { roughness: 0.95 }),
      corr: fam('corrugated', 0xb4c0cb, { roughness: 0.7, metalness: 0.12 }),
      corrDark: fam('corrugated', 0x5a6b7a, { roughness: 0.74, metalness: 0.16 }),
      cabin: fam('corrugated', C.cabin, { roughness: 0.7, metalness: 0.12 }),
      wood: fam('wood', 0xc59a60, { roughness: 0.9 }),
      siding: fam('siding', 0xd8c7a3, { roughness: 0.9 }),
      roof: fam('corrugated', 0x6a4a40, { roughness: 0.8, metalness: 0.14 }),
      paint: share(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.66, metalness: 0.16 })),
      glass: share(new THREE.MeshStandardMaterial({ color: lin(C.glass), emissive: lin(0x1b3a52), emissiveIntensity: 0.3, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.82, depthWrite: false })),
      lamp: share(new THREE.MeshStandardMaterial({ color: lin(0xfff0c2), emissive: lin(0xffc15a), emissiveIntensity: 0.8, roughness: 0.4 })),
      dust: share(new THREE.PointsMaterial({ color: 0xcfc6b4, size: 0.1, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false })),
      spark: share(new THREE.PointsMaterial({ color: 0xffb347, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending })),
      sawdust: share(new THREE.PointsMaterial({ color: 0xdcc592, size: 0.08, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false })),
    };
    return MATS;
  }

  // ---------------------------------------------------------------------------------------------- pooled points (dust / sparks)
  function makePoints(n, material, name) {
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), life = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -50;
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pa);
    const pts = new THREE.Points(g, material);
    pts.name = name; pts.frustumCulled = false;
    return { pts, pos, vel, life, n, acc: 0, live: 0, wasLive: false };
  }
  // advance every live point; `rate` points per second are emitted through spawn(i, o) while `emit` is true (never more than n live)
  function stepPoints(D, dt, emit, rate, gravity, floorY, spawn, A) {
    if (emit) D.acc += dt * rate;
    let live = 0;
    for (let i = 0; i < D.n; i++) {
      const o = i * 3;
      if (D.life[i] > 0) {
        D.life[i] -= dt;
        if (D.life[i] <= 0) { D.pos[o + 1] = -50; continue; }
        D.vel[o + 1] -= gravity * dt;
        D.pos[o] += D.vel[o] * dt; D.pos[o + 1] += D.vel[o + 1] * dt; D.pos[o + 2] += D.vel[o + 2] * dt;
        if (D.pos[o + 1] < floorY) { D.pos[o + 1] = floorY; D.vel[o] *= 0.3; D.vel[o + 1] = 0; D.vel[o + 2] *= 0.3; }
        live++;
      } else if (D.acc >= 1) {
        D.acc -= 1;
        spawn(i, o, A);
        live++;
      }
    }
    if (D.acc > 2) D.acc = 2;
    if (!emit) D.acc = 0;
    D.live = live;
    if (live || D.wasLive) D.pts.geometry.attributes.position.needsUpdate = true;
    D.wasLive = live > 0;
  }
  const rand = (A) => { A.seed = (Math.imul(A.seed, 1664525) + 1013904223) >>> 0; return A.seed / 4294967296; };

  // ---------------------------------------------------------------------------------------------- piles on the loading plates (equal the real stock)
  // slot geometry callbacks: add one item at slot i into batch b, `at(i)` gives the slot centre (pile frame) for the item that lands there
  const STACK_CAP = 24;
  const PILES = {
    concrete: {
      cap: STACK_CAP, per: 36, pose: { x: 0, y: 0.075, z: 3.1, rot: -0.18 },
      at: (i) => { const layer = Math.floor(i / 8), k = i % 8; return [((k % 4) - 1.5) * 0.45, 0.1 + layer * 0.205, (Math.floor(k / 4) - 0.5) * 0.3]; },
      item: (b, x, y, z, i) => b.box(0.42, 0.19, 0.27, x + ((i * 37) % 7 - 3) * 0.004, y, z, { c: [C.block1, C.block2, C.block3][i % 3], ry: ((i * 13) % 5 - 2) * 0.012 }),
    },
    metal: {
      cap: STACK_CAP, per: 108, pose: { x: 0, y: 0.075, z: 3.4, rot: -0.12 },
      at: (i) => { const layer = Math.floor(i / 4), k = i % 4; return [((i * 29) % 5 - 2) * 0.012, 0.075 + layer * 0.125, (k - 1.5) * 0.19]; },
      item: (b, x, y, z, i) => beamBoxes(b, x, y, z, i % 3 === 1 ? C.rust : C.beamSteel, 1.1),
    },
    frame: {
      cap: 16, per: 216,
      at: (i) => [0, 0.045 + i * 0.075, 0],
      item: (b, x, y, z, i) => frameBoxes(b, x, y, z, [C.wood, C.woodLight, C.wood][i % 3], ((i * 17) % 5 - 2) * 0.02),
    },
  };
  function beamBoxes(b, x, y, z, color, len) { // I-beam lying along x: web + two flanges (108 indices)
    b.box(len, 0.02, 0.14, x, y + 0.045, z, { c: color }); b.box(len, 0.02, 0.14, x, y - 0.045, z, { c: color }); b.box(len, 0.07, 0.025, x, y, z, { c: color });
  }
  function frameBoxes(b, x, y, z, color, yaw) { // flat wooden frame 0.9 x 0.6: 2 long rails, 2 end rails, 2 studs (216 indices)
    const o = { c: color, ry: yaw };
    const R = (dx, dz, w, d) => { const cs = Math.cos(yaw), sn = Math.sin(yaw); b.box(w, 0.06, d, x + dx * cs + dz * sn, y, z - dx * sn + dz * cs, o); };
    R(0, 0.265, 0.9, 0.07); R(0, -0.265, 0.9, 0.07); R(0.415, 0, 0.07, 0.46); R(-0.415, 0, 0.07, 0.46); R(0.14, 0, 0.06, 0.46); R(-0.14, 0, 0.06, 0.46);
  }
  function buildPile(kind) {
    const P = PILES[kind], b = batch(true);
    for (let i = 0; i < P.cap; i++) { const s = P.at(i); P.item(b, s[0], s[1], s[2], i); }
    const mesh = b.toMesh(mats().paint, { name: 'v161' + kind + 'Pile', soft: kind !== 'frame' });   // piles on loading plates are walkable (the pad is ON them); the frame stack has no pad and is solid
    mesh.frustumCulled = false;
    mesh.userData.drawPer = P.per;
    return mesh;
  }
  function setPile(mesh, n) { mesh.geometry.setDrawRange(0, n * mesh.userData.drawPer); mesh.visible = n > 0; }
  // slot (pile frame) -> group frame
  function pileToGroup(P, s) { const c = Math.cos(P.pose.rot), sn = Math.sin(P.pose.rot); return [P.pose.x + c * s[0] + sn * s[2], P.pose.y + s[1], P.pose.z - sn * s[0] + c * s[2]]; }
  // one in-flight item: own mesh per item (pool of 3), one slot's geometry at the origin
  function buildItem(kind, name) {
    const P = PILES[kind], b = batch(true);
    P.item(b, 0, 0, 0, 0);
    const m = b.toMesh(mats().paint, { name, soft: true });
    m.frustumCulled = false; m.visible = false;
    return m;
  }

  // ---------------------------------------------------------------------------------------------- label
  function addLabel(root, lines, y, sx, sy) {
    const label = makeLabelSprite(lines);
    label.position.set(0, y, 0);
    label.scale.set(sx, sy, 1);
    root.add(label);
    return label;
  }

  // =============================================================================================================================
  //  CONCRETE PLANT
  // =============================================================================================================================
  const CP = Object.freeze({
    SILO_X: [-1.3, -0.4, 0.5, 1.4], SILO_Z: -1.2, SILO_R: 0.4,
    MIX_X: 0.55, MIX_Z: 0.65, MIX_Y: 1.28,
    PIT: [-0.38, 0.42, 0.25], HEAD: [0.55, 2.3, 0.25],
    TABLE_A: [0.55, 0.69, 1.45], TABLE_B: [0.1, 0.69, 2.5],
    DUST_MAX: 12, BLOCKS_MAX: 3,
  });
  const CONCRETE_PH = Object.freeze({ LOAD0: 0.02, LOAD1: 0.12, RISE1: 0.40, DUMP1: 0.50, DESC1: 0.78, MIX0: 0.42, MIX1: 0.86, POUR0: 0.80, SLIDE0: 0.88, DROP0: 0.95 });

  function buildConcrete(level) {
    level = clamp(Math.floor(Number(level)) || 1, 1, 3);
    const M = mats(), root = new THREE.Group();
    root.name = 'v161ConcretePlant';
    root.userData.levelV161 = level;
    const SL = batch(false), P = batch(true), CB = batch(false), CR = batch(false), G = batch(false);
    const FL = FLOOR, nS = level + 1;

    // ---- slab + apron toward the loading plate + yellow edge stripes
    SL.box(4.0, 0.18, 3.7, 0.1, 0.09, 0);
    SL.box(1.9, 0.12, 0.62, 0, 0.06, 2.16);
    for (let i = 0; i < 13; i++) P.box(0.3, 0.012, 0.1, -1.75 + i * 0.3, FL + 0.006, 1.74, { c: C.yellow, ry: 0.7 });

    // ---- cement silos: steel legs + braces, conical bottom, ribbed body, hazard band, blue roof cone, filter vent, front ladder
    const r = CP.SILO_R, legH = 0.92, coneH = 0.5, bodyH = 1.7;
    const yCone = FL + legH, yBody = yCone + coneH, yTop = yBody + bodyH;
    for (let i = 0; i < nS; i++) {
      const x = CP.SILO_X[i], z = CP.SILO_Z;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.07, legH, 0.07, x + sx * 0.3, FL + legH / 2, z + sz * 0.3, { c: C.steelDark });
      for (const sz of [-1, 1]) { P.box(0.66, 0.05, 0.05, x, FL + 0.5, z + sz * 0.3, { c: C.steel }); P.box(0.66, 0.05, 0.05, x, yCone - 0.02, z + sz * 0.3, { c: C.steel }); }
      for (const sx of [-1, 1]) { P.box(0.05, 0.05, 0.66, x + sx * 0.3, FL + 0.5, z, { c: C.steel }); P.box(0.05, 0.05, 0.66, x + sx * 0.3, yCone - 0.02, z, { c: C.steel }); }
      for (const sz of [-1, 1]) { P.bar(x - 0.3, FL + 0.08, z + sz * 0.3, x + 0.3, FL + 0.5, z + sz * 0.3, 0.035, 0.035, C.steel); P.bar(x + 0.3, FL + 0.08, z + sz * 0.3, x - 0.3, FL + 0.5, z + sz * 0.3, 0.035, 0.035, C.steel); }
      P.cyl(r, 0.09, coneH, 16, x, yCone + coneH / 2, z, { c: C.siloCone });
      P.cyl(r, r, bodyH, 16, x, yBody + bodyH / 2, z, { c: C.silo });
      for (const k of [0.3, 0.8, 1.35]) P.cyl(r + 0.014, r + 0.014, 0.05, 16, x, yBody + k, z, { c: C.steelLight });
      P.cyl(r + 0.016, r + 0.016, 0.16, 16, x, yBody + 0.14, z, { c: C.yellow });
      P.cyl(0.07, r + 0.02, 0.3, 16, x, yTop + 0.15, z, { c: C.blue });
      P.cyl(0.085, 0.085, 0.2, 10, x, yTop + 0.4, z, { c: C.steelDark }); P.cyl(0.11, 0.07, 0.08, 10, x, yTop + 0.54, z, { c: C.steelLight });
      for (const sx of [-1, 1]) P.box(0.03, yTop - FL - 0.5, 0.03, x + sx * 0.14, (FL + 0.5 + yTop) / 2, z + r + 0.05, { c: C.steelDark });
      for (let k = 0; k < 11; k++) P.box(0.3, 0.022, 0.022, x, FL + 0.6 + k * 0.25, z + r + 0.05, { c: C.steelLight });
    }
    // ---- silo outlets: drops to a header pipe, up to the mixer hopper; the header reaches the last silo
    const lastX = CP.SILO_X[nS - 1], hz = -0.55, hy = 0.95;
    P.cyl(0.05, 0.05, lastX - CP.SILO_X[0] + 0.1, 10, (lastX + CP.SILO_X[0]) / 2, hy, hz, { c: C.steelLight, rz: Math.PI / 2 });
    for (let i = 0; i < nS; i++) P.bar(CP.SILO_X[i], yCone, CP.SILO_Z, CP.SILO_X[i], hy + 0.02, hz, 0.07, 0.07, C.steelLight);
    P.bar(CP.MIX_X, hy, hz, CP.MIX_X, 2.0, 0.05, 0.1, 0.1, C.steelLight);

    // ---- aggregate bins (3 compartments on legs, funnels) + feed belt under them
    const binX = [-1.65, -1.2, -0.75], binCol = [C.bin1, C.bin2, C.bin3], bz = 0.3;
    for (let i = 0; i < 3; i++) {
      P.box(0.42, 0.5, 0.42, binX[i], 1.05 + 0.25, bz, { c: binCol[i] });
      P.cyl(0.297, 0.07, 0.35, 4, binX[i], 0.7 + 0.175, bz, { c: C.steelLight, ry: Math.PI / 4 });
      P.box(0.44, 0.04, 0.44, binX[i], 1.56, bz, { c: C.steelDark });
    }
    for (const sx of [-1.88, -0.52]) for (const sz of [0.06, 0.54]) P.box(0.07, 1.4 - FL, 0.07, sx, (FL + 1.4) / 2, sz, { c: C.steelDark });
    P.box(1.4, 0.05, 0.05, -1.2, 1.4, 0.06, { c: C.steel }); P.box(1.4, 0.05, 0.05, -1.2, 1.4, 0.54, { c: C.steel });
    P.box(1.5, 0.06, 0.34, -1.2, 0.5, bz, { c: C.black });                                  // feed belt table under the funnels
    for (const sz of [-1, 1]) P.box(1.5, 0.12, 0.03, -1.2, 0.55, bz + sz * 0.18, { c: C.steel });
    for (const sx of [-1.8, -0.6]) P.box(0.06, 0.5 - FL, 0.3, sx, (FL + 0.5) / 2, bz, { c: C.steelDark });
    for (let i = 0; i < 9; i++) P.box(0.02, 0.012, 0.3, -1.88 + i * 0.17, 0.535, bz, { c: C.steelLight });   // belt ribs (static)

    // ---- skip hoist rails (pit -> hopper head)
    const pit = CP.PIT, head = CP.HEAD;
    for (const sz of [-1, 1]) {
      P.bar(pit[0], pit[1] - 0.12, pit[2] + sz * 0.17, head[0], head[1] + 0.02, head[2] + sz * 0.17, 0.05, 0.05, C.steel);
      P.bar(pit[0] + 0.12, FL, pit[2] + sz * 0.17, head[0] - 0.1, head[1] - 0.05, head[2] + sz * 0.17, 0.035, 0.035, C.steelDark);
    }
    for (let k = 0; k < 6; k++) { const t = (k + 0.5) / 6; P.box(0.04, 0.04, 0.38, lerp(pit[0], head[0], t), lerp(pit[1] - 0.12, head[1] + 0.02, t), pit[2], { c: C.steelDark }); }
    P.box(0.07, head[1] - FL, 0.07, head[0] + 0.12, (FL + head[1]) / 2, head[2] - 0.17, { c: C.steelDark }); P.box(0.07, head[1] - FL, 0.07, head[0] + 0.12, (FL + head[1]) / 2, head[2] + 0.17, { c: C.steelDark });
    P.box(0.07, 0.07, 0.4, head[0] + 0.12, head[1] + 0.03, head[2], { c: C.steelDark });

    // ---- drum mixer: stand, hopper, discharge chute
    const mx = CP.MIX_X, mz = CP.MIX_Z, my = CP.MIX_Y;
    for (const sx of [-0.5, 0.5]) for (const sz of [0.12, 1.18]) P.box(0.08, my - 0.5 - FL, 0.08, mx + sx, (FL + my - 0.5) / 2, sz, { c: C.steelDark });
    for (const sz of [0.12, 1.18]) P.box(1.1, 0.08, 0.08, mx, my - 0.48, sz, { c: C.steel });
    for (const sx of [-0.5, 0.5]) P.box(0.08, 0.08, 1.1, mx + sx, my - 0.48, 0.65, { c: C.steel });
    for (const sx of [-0.5, 0.5]) P.bar(mx + sx, FL + 0.05, 0.12, mx + sx, my - 0.5, 0.65, 0.04, 0.04, C.steel);
    P.cyl(0.36, 0.13, 0.42, 4, mx, 1.96, 0.18, { c: C.yellowDark, ry: Math.PI / 4 });         // hopper (square funnel)
    P.box(0.74, 0.04, 0.74, mx, 2.17, 0.18, { c: C.steelDark });
    for (const sx of [-0.3, 0.3]) P.box(0.05, 0.4, 0.05, mx + sx, 1.9, -0.1, { c: C.steelDark });
    P.cyl(0.17, 0.12, 0.3, 12, mx, 0.8, 1.38, { c: C.steelLight });                              // chute under the discharge cone
    // ---- output roller table (mixer chute -> loading plate): slope-free table with side rails, rollers, legs
    const A = CP.TABLE_A, B = CP.TABLE_B, dx = B[0] - A[0], dz = B[2] - A[2], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, px = uz, pz = -ux;
    P.bar(A[0], A[1] - 0.04, A[2], B[0], B[1] - 0.04, B[2], 0.5, 0.05, C.black);
    for (const s of [-1, 1]) P.bar(A[0] + px * 0.27 * s, A[1] + 0.02, A[2] + pz * 0.27 * s, B[0] + px * 0.27 * s, B[1] + 0.02, B[2] + pz * 0.27 * s, 0.04, 0.3, C.steel);   // side guards (0.3 m: a wall for the physics probe and the player)
    for (let k = 0; k < 9; k++) { const t = (k + 0.5) / 9; P.cyl(0.03, 0.03, 0.46, 8, lerp(A[0], B[0], t), A[1] - 0.005, lerp(A[2], B[2], t), { c: C.steelLight, rz: Math.PI / 2, ry: Math.atan2(ux, uz) }); }
    for (const t of [0.12, 0.9]) for (const s of [-1, 1]) P.box(0.06, A[1] - 0.06 - FL, 0.06, lerp(A[0], B[0], t) + px * 0.25 * s, (FL + A[1] - 0.06) / 2, lerp(A[2], B[2], t) + pz * 0.25 * s, { c: C.steelDark });

    // ---- water tank on legs, pipe to the mixer
    const tx = 1.65, tz = -0.2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.05, 0.85, 0.05, tx + sx * 0.22, FL + 0.425, tz + sz * 0.22, { c: C.steelDark });
    P.box(0.5, 0.04, 0.04, tx, FL + 0.45, tz - 0.22, { c: C.steel }); P.box(0.5, 0.04, 0.04, tx, FL + 0.45, tz + 0.22, { c: C.steel });
    P.cyl(0.32, 0.32, 0.5, 14, tx, FL + 0.85 + 0.25, tz, { c: C.tank });
    P.cyl(0.02, 0.32, 0.12, 14, tx, FL + 1.35 + 0.06, tz, { c: C.steelLight });
    P.bar(tx - 0.3, FL + 1.0, tz + 0.05, mx + 0.4, 1.7, 0.1, 0.05, 0.05, C.tank);

    // ---- control cabin (corrugated blue container) + roof, AC unit, windows, door, step
    const cx = 1.62, cz = 0.85, cw = 0.86, cd = 1.0, ch = 1.05;
    CB.box(cw, ch, cd, cx, FL + ch / 2, cz);
    P.box(cw + 0.14, 0.06, cd + 0.14, cx, FL + ch + 0.03, cz, { c: C.roofDark });
    P.box(0.3, 0.18, 0.3, cx + 0.22, FL + ch + 0.15, cz - 0.2, { c: C.white });
    P.box(cw + 0.02, 0.1, cd + 0.02, cx, FL + 0.05, cz, { c: C.black });
    for (let i = 0; i < 4; i++) P.box(0.08, 0.103, cd + 0.03, cx - cw / 2 + 0.1 + i * 0.2, FL + 0.05, cz, { c: C.yellow });
    G.box(0.02, 0.4, 0.6, cx - cw / 2 - 0.005, FL + 0.66, cz - 0.05);                        // west window (towards the mixer)
    P.box(0.04, 0.46, 0.66, cx - cw / 2 - 0.002, FL + 0.66, cz - 0.05, { c: C.white });
    G.box(0.36, 0.36, 0.02, cx - 0.2, FL + 0.66, cz + cd / 2 + 0.006);                       // front window
    P.box(0.42, 0.42, 0.03, cx - 0.2, FL + 0.66, cz + cd / 2 + 0.002, { c: C.white });
    P.box(0.3, 0.66, 0.04, cx + 0.25, FL + 0.43, cz + cd / 2 + 0.01, { c: C.door });
    P.box(0.5, 0.08, 0.22, cx + 0.25, FL + 0.04, cz + cd / 2 + 0.12, { c: C.steelLight });

    // ---- level 2: canopy over the output table; level 3: catwalk over the silo tops + floodlight mast
    const lamps = batch(false);
    if (level >= 2) {
      for (const [x, z] of [[-0.4, 1.55], [0.95, 1.55], [-0.4, 2.55], [0.95, 2.55]]) P.box(0.07, 1.7, 0.07, x, FL + 0.85, z, { c: C.steelDark });
      CR.bar(0.28, 1.95, 1.55, 0.28, 1.83, 2.65, 1.5, 0.06);
      P.box(1.52, 0.08, 0.06, 0.28, 1.86, 1.53, { c: C.yellow });
    }
    if (level >= 3) {
      const x0 = CP.SILO_X[0] - 0.2, x1 = CP.SILO_X[3] + 0.2, cwk = (x0 + x1) / 2, yw = yTop - 0.35;
      P.box(x1 - x0, 0.05, 0.34, cwk, yw, CP.SILO_Z + r + 0.2, { c: C.steelLight });
      for (let i = 0; i < 7; i++) P.box(0.04, 0.5, 0.04, x0 + i * (x1 - x0) / 6, yw + 0.27, CP.SILO_Z + r + 0.36, { c: C.yellow });
      P.box(x1 - x0, 0.04, 0.04, cwk, yw + 0.5, CP.SILO_Z + r + 0.36, { c: C.yellow });
      P.box(0.08, 3.1, 0.08, 1.95, FL + 1.55, 1.5, { c: C.steelDark });
      P.box(0.4, 0.1, 0.2, 1.95, FL + 3.15, 1.45, { c: C.steelDark });
      lamps.box(0.34, 0.06, 0.16, 1.95, FL + 3.1, 1.53);
    }

    // ---- static meshes
    const add = (m) => { if (m) root.add(m); return m; };
    add(SL.toMesh(M.slab, { name: 'v161ConcreteSlab', cast: false }));
    add(P.toMesh(M.paint, { name: 'v161ConcreteSteel' }));
    add(CB.toMesh(M.cabin, { name: 'v161ConcreteCabin' }));
    add(CR.toMesh(M.corrDark, { name: 'v161ConcreteCanopy' }));
    add(G.toMesh(M.glass, { name: 'v161ConcreteWindows', cast: false }));
    add(lamps.toMesh(M.lamp, { name: 'v161ConcreteFloodlight', cast: false }));

    // ---- animated parts: drum (rotates about its z axis), skip bucket, pooled dust, in-flight blocks, status beacon, pile
    const drumSpin = new THREE.Group();
    drumSpin.position.set(mx, my, mz);
    {
      const D = batch(true);
      D.cyl(0.46, 0.46, 0.62, 18, 0, 0, 0, { c: C.drum, rx: Math.PI / 2 });
      D.cyl(0.46, 0.2, 0.3, 18, 0, 0, 0.46, { c: C.yellowDark, rx: Math.PI / 2 });          // discharge cone (+z)
      D.cyl(0.22, 0.46, 0.3, 18, 0, 0, -0.46, { c: C.yellowDark, rx: Math.PI / 2 });         // inlet cone (-z)
      for (const z of [-0.2, 0.2]) D.cyl(0.475, 0.475, 0.07, 18, 0, 0, z, { c: C.drumBand, rx: Math.PI / 2 });
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; D.box(0.06, 0.025, 0.62, Math.cos(a) * 0.472, Math.sin(a) * 0.472, 0, { c: C.drumBand, rz: a - Math.PI / 2 }); }
      D.cyl(0.07, 0.07, 0.12, 10, 0, 0, 0.64, { c: C.steelLight, rx: Math.PI / 2 });         // hub on the discharge side
      drumSpin.add(D.toMesh(M.paint, { name: 'v161ConcreteDrum' }));
    }
    root.add(drumSpin);
    // skip bucket: tray with an open top, local origin at the floor centre, floor normal = +y (posed along the rails by the animation)
    const bucket = (() => {
      const b = batch(true);
      b.box(0.36, 0.04, 0.32, 0, 0, 0, { c: C.steelDark });
      b.box(0.04, 0.22, 0.32, -0.16, 0.11, 0, { c: C.yellowDark }); b.box(0.36, 0.22, 0.04, 0, 0.11, -0.14, { c: C.yellowDark }); b.box(0.36, 0.22, 0.04, 0, 0.11, 0.14, { c: C.yellowDark });
      b.box(0.04, 0.12, 0.32, 0.16, 0.06, 0, { c: C.yellowDark });
      b.box(0.28, 0.1, 0.24, 0, 0.09, 0, { c: C.bin1 });                                         // aggregate in the tray
      const m = b.toMesh(M.paint, { name: 'v161ConcreteSkip', soft: false });
      m.rotation.order = 'ZYX';
      return m;
    })();
    root.add(bucket);
    const dust = makePoints(CP.DUST_MAX, M.dust, 'v161ConcreteDust');
    root.add(dust.pts);
    const blocks = [];
    for (let k = 0; k < CP.BLOCKS_MAX; k++) { const m = buildItem('concrete', 'v161ConcreteBlock' + k); blocks.push(m); root.add(m); }
    const beaconMat = new THREE.MeshStandardMaterial({ color: lin(0x2e8b57), emissive: lin(0x17c05d), emissiveIntensity: 0.9, roughness: 0.4 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), beaconMat);
    beacon.name = 'v161ConcreteBeacon'; beacon.position.set(cx - 0.2, FL + ch + 0.13, cz + 0.2);
    root.add(beacon);
    const pile = buildPile('concrete');
    const pileGroup = new THREE.Group();
    pileGroup.name = 'v161ConcretePileGroup';
    pileGroup.position.set(PILES.concrete.pose.x, PILES.concrete.pose.y, PILES.concrete.pose.z); pileGroup.rotation.y = PILES.concrete.pose.rot;
    pileGroup.add(pile);
    root.add(pileGroup);
    const label = addLabel(root, [lang === 'ru' ? 'БЕТОННЫЙ ЗАВОД' : 'CONCRETE PLANT'], yTop + 0.95, 1.45, 0.597);

    root.userData.parts = { drumSpin, bucket, dust, blocks, beacon, beaconMat, pile };
    root.userData.anim = { p: 0, t: 0, spin: 0, running: false, k: 0, seed: 9137, dirty: true, shownPile: -1, pileAdded: 0, pileRemoved: 0 };
    // real obstacles (local x, z, hx, hz): silos (legs), bins + feed belt, skip rails, mixer, cabin, tank, output table, + canopy posts / mast
    const fp = [
      { x: (-1.75 + lastX + 0.45) / 2, z: -1.1, hx: (lastX + 0.45 + 1.75) / 2, hz: 0.55 },
      { x: 0.55, z: -0.28, hx: 0.17, hz: 0.38 },
      { x: -1.21, z: 0.3, hx: 0.7, hz: 0.31 },
      { x: -0.27, z: 0.25, hx: 0.27, hz: 0.2 },
      { x: 0.55, z: 0.66, hx: 0.57, hz: 0.7 },
      { x: 1.62, z: 0.9, hx: 0.47, hz: 0.57 },
      { x: 1.65, z: -0.2, hx: 0.3, hz: 0.3 },
      { x: 0.33, z: 1.92, hx: 0.47, hz: 0.6 },
    ];
    if (level >= 2) for (const [x, z] of [[-0.4, 1.55], [0.95, 1.55], [-0.4, 2.55], [0.95, 2.55]]) fp.push({ x, z, hx: 0.08, hz: 0.08 });
    if (level >= 3) fp.push({ x: 1.95, z: 1.5, hx: 0.1, hz: 0.1 });
    root.userData.v161Footprint = fp;
    root.userData.layout = { level, silos: nS, pileSlots: PILES.concrete.cap };
    const plant = { group: root, drumPivot: new THREE.Group(), label, v161: true, level };
    poseConcrete(plant, 0, false);
    return plant;
  }

  // phase helper for the concrete cycle: positions the skip, the in-flight blocks and the lamp for p in [0,1)
  function poseConcrete(plant, p, running) {
    const root = plant.group, Pt = root.userData.parts, A = root.userData.anim, PH = CONCRETE_PH;
    // skip bucket along the rails
    const pit = CP.PIT, head = CP.HEAD;
    let s = 0, tilt = 0;
    if (p < PH.LOAD1) s = 0;
    else if (p < PH.RISE1) s = S((p - PH.LOAD1) / (PH.RISE1 - PH.LOAD1));
    else if (p < PH.DUMP1) { s = 1; const u = (p - PH.RISE1) / (PH.DUMP1 - PH.RISE1); tilt = u < 0.4 ? S(u / 0.4) : u < 0.65 ? 1 : 1 - S((u - 0.65) / 0.35); }
    else if (p < PH.DESC1) s = 1 - S((p - PH.DUMP1) / (PH.DESC1 - PH.DUMP1));
    const alpha = Math.atan2(head[1] - pit[1], head[0] - pit[0]);
    Pt.bucket.position.set(lerp(pit[0], head[0], s) - Math.sin(alpha) * 0.1, lerp(pit[1], head[1], s) + Math.cos(alpha) * 0.1, pit[2]);
    Pt.bucket.rotation.set(0, 0, alpha - tilt * 1.7);
    // in-flight blocks (the credited number, latched at the start of the cycle)
    if (running && (p < 0.03 || A.k < 1)) A.k = concreteCreditV161();
    const Tm = CP.TABLE_A, Te = CP.TABLE_B, n = A.pileN || 0;
    const dxT = Te[0] - Tm[0], dzT = Te[2] - Tm[2], lenT = Math.hypot(dxT, dzT), perpX = dzT / lenT, perpZ = -dxT / lenT, yawT = Math.atan2(-dzT, dxT);
    for (let j = 0; j < Pt.blocks.length; j++) {
      const b = Pt.blocks[j];
      const on = running && j < A.k && p >= PH.POUR0;
      b.visible = on;
      if (!on) continue;
      const off = (j - (A.k - 1) / 2) * 0.3, slot = pileToGroup(PILES.concrete, PILES.concrete.at(Math.min(PILES.concrete.cap - 1, n + j)));
      let x, y, z, yaw, sc = 1;
      const y0 = Tm[1] + 0.04 + 0.095;
      if (p < PH.SLIDE0) { const u = (p - PH.POUR0) / (PH.SLIDE0 - PH.POUR0); sc = 0.2 + 0.8 * S(u); x = Tm[0] + perpX * off; z = Tm[2] + perpZ * off; y = Tm[1] + 0.04 + 0.095 * sc; yaw = Math.PI / 2; }
      else if (p < PH.DROP0) { const u = S((p - PH.SLIDE0) / (PH.DROP0 - PH.SLIDE0)); x = lerp(Tm[0], Te[0], u) + perpX * off; z = lerp(Tm[2], Te[2], u) + perpZ * off; y = y0; yaw = Math.PI / 2; }
      else {
        const u = S((p - PH.DROP0) / (1 - PH.DROP0)), ex0 = Te[0] + perpX * off, ez0 = Te[2] + perpZ * off;
        x = lerp(ex0, slot[0], u); z = lerp(ez0, slot[2], u); y = lerp(y0, slot[1], u) + 0.18 * Math.sin(Math.PI * u); yaw = lerp(Math.PI / 2, PILES.concrete.pose.rot, u);
      }
      b.position.set(x, y, z); b.rotation.set(0, yaw, 0); b.scale.setScalar(sc);
    }
  }

  // credited number of blocks for the cycle that is running (same formula as updateConcretePlant)
  function concreteCreditV161() {
    let n = 1;
    try { n = Math.min(1 + Math.floor(stats.prestige / 3), Math.max(0, concreteCapacity() - concrete)); } catch (e) { /* game not ready */ }
    return Math.max(1, Math.min(CP.BLOCKS_MAX, Math.floor(n) || 1));
  }
  function concreteIntervalV161() { return Math.max(2, CONCRETE_AUTO_INTERVAL / productionSpeedMultiplier() / industrialSpeedV161('concrete')); }

  function updateConcrete(dt) {
    const plant = typeof concretePlant !== 'undefined' ? concretePlant : null;
    if (!plant || !plant.v161) return;
    const root = plant.group, Pt = root.userData.parts, A = root.userData.anim;
    dt = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
    A.t += dt;
    // ---- the pile on the loading plate = real stock
    const real = Number.isFinite(concrete) ? Math.max(0, Math.floor(concrete)) : 0, n = Math.min(PILES.concrete.cap, real);
    if (n !== A.shownPile) { if (A.shownPile >= 0) { if (n > A.shownPile) A.pileAdded += n - A.shownPile; else A.pileRemoved += A.shownPile - n; } A.shownPile = n; setPile(Pt.pile, n); }
    A.pileN = n;
    // ---- the cycle: the game's own timer, only while the plant works (unlocked, room in the store)
    let running = false, p = A.p;
    try {
      running = concretePlantBuiltV118 && stageIndex >= CONCRETE_UNLOCK_STAGE && concrete < concreteCapacity();
      if (running) p = clamp(concretePlantTimer / concreteIntervalV161(), 0, 0.9999);
    } catch (e) { /* globals not ready */ }
    if (!running) { p = 0; A.k = 0; }
    A.running = running;
    if (!running && A.p !== 0) A.dirty = true;   // stopped: park everything once (no phase, no items)
    if (running || A.dirty) { A.dirty = false; A.p = p; poseConcrete(plant, p, running); }
    // ---- drum spin: ramps up while running, faster while it mixes
    const mixing = running && p >= CONCRETE_PH.MIX0 && p < CONCRETE_PH.MIX1;
    const target = running ? (mixing ? 3.2 : 1.1) : 0;
    A.spin += (target - A.spin) * Math.min(1, dt * 3);
    Pt.drumSpin.rotation.z += dt * A.spin;
    // ---- dust: at the bins while the skip loads, at the hopper while it dumps (pooled, <= 12)
    const loading = running && p >= CONCRETE_PH.LOAD0 && p < CONCRETE_PH.LOAD1, dumping = running && p >= CONCRETE_PH.RISE1 && p < CONCRETE_PH.DUMP1;
    stepPoints(Pt.dust, dt, loading || dumping, loading ? 8 : 16, 1.2, FLOOR + 0.02, (i, o, an) => {
      const src = dumping ? CP.HEAD : CP.PIT;
      Pt.dust.pos[o] = src[0] + (rand(an) - 0.5) * 0.3; Pt.dust.pos[o + 1] = src[1] + (dumping ? 0.0 : 0.15) + rand(an) * 0.1; Pt.dust.pos[o + 2] = src[2] + (rand(an) - 0.5) * 0.3;
      Pt.dust.vel[o] = (rand(an) - 0.5) * 0.5 + (dumping ? 0.2 : 0); Pt.dust.vel[o + 1] = 0.25 + rand(an) * 0.4; Pt.dust.vel[o + 2] = (rand(an) - 0.5) * 0.5;
      Pt.dust.life[i] = 0.7 + rand(an) * 0.5;
    }, A);
    // ---- status beacon: green while the plant works, amber when idle
    Pt.beaconMat.emissive.setHex(running ? 0x17c05d : 0xc78a1a); Pt.beaconMat.emissiveIntensity = running ? 0.7 + 0.3 * Math.sin(A.t * 4) : 0.45;
  }

  // =============================================================================================================================
  //  METAL YARD
  // =============================================================================================================================
  const MY = Object.freeze({
    MAST: [1.62, 1.585], JIB_Y: 2.95, RACK: [0.2, -0.35], LINE_Z: -1.15, BEAM_Y: 0.56, BEAM_L: 1.1,
    FURNACE_X: -1.35, MOUTH_X: -0.85, WHEEL: [0.82, -1.15], SPARKS_MAX: 12, BEAMS_MAX: 3,
  });
  const METAL_PH = Object.freeze({ HEAT0: 0.0, ROLL1: 0.10, SLIDE1: 0.34, CUT1: 0.50, KICK1: 0.60, JIB_TO_RACK0: 0.30, JIB_TO_RACK1: 0.52, HOOK_DOWN1: 0.64, HOOK_UP1: 0.70, SWING1: 0.84, LAND1: 0.985 });

  function buildMetal(level) {
    level = clamp(Math.floor(Number(level)) || 1, 1, 3);
    const M = mats(), root = new THREE.Group();
    root.name = 'v161MetalYard';
    root.userData.levelV161 = level;
    const SL = batch(false), P = batch(true), W = batch(false), R = batch(false), BR = batch(false), GL = batch(false), HOT = batch(false);
    const FL = FLOOR, ZF = -0.75, ZB = -1.65, EAVE = 1.72, RISE = 0.5, X0 = -1.95, X1 = level >= 2 ? 1.95 : 0.95;

    // ---- slab + apron toward the loading plate + edge stripes
    SL.box(4.0, 0.18, 3.4, 0, 0.09, 0);
    SL.box(2.0, 0.12, 0.9, 0, 0.06, 2.15);
    for (let i = 0; i < 13; i++) P.box(0.3, 0.012, 0.1, -1.8 + i * 0.3, FL + 0.006, 1.64, { c: C.yellow, ry: 0.7 });

    // ---- corrugated shed (open to the front): back + west wall, posts, plates, gabled roof on the long axis, gable infill
    const RCX = (X0 + X1) / 2, RLEN = X1 - X0 + 0.3, ZC = (ZF + ZB) / 2, HS = (ZF - ZB) / 2 + 0.2;
    W.box(X1 - X0, EAVE - FL, 0.06, RCX, (EAVE + FL) / 2, ZB);
    W.box(0.06, EAVE - FL, ZF - ZB, X0, (EAVE + FL) / 2, ZC);
    if (level >= 2) W.box(0.06, EAVE - FL, ZF - ZB, X1, (EAVE + FL) / 2, ZC);
    W.gable(X0, ZC, EAVE, (ZF - ZB) / 2, RISE, 0.06); if (level >= 2) W.gable(X1, ZC, EAVE, (ZF - ZB) / 2, RISE, 0.06);
    const postX = level >= 2 ? [X0, -0.55, 0.9, X1] : [X0, -0.55, X1];
    for (const x of postX) P.box(0.1, EAVE - FL, 0.1, x, (EAVE + FL) / 2, ZF, { c: C.steelDark });
    for (const x of level >= 2 ? [X0, X1] : [X0]) P.box(0.1, EAVE - FL, 0.1, x, (EAVE + FL) / 2, ZB, { c: C.steelDark });
    P.box(X1 - X0 + 0.1, 0.12, 0.1, RCX, EAVE, ZF, { c: C.steel });
    P.box(X1 - X0 + 0.1, 0.12, 0.1, RCX, EAVE, ZB, { c: C.steel });
    for (const x of postX) P.bar(x, EAVE, ZF, x, EAVE + RISE - 0.02, ZC, 0.07, 0.07, C.steelDark);
    P.box(RLEN, 0.1, 0.1, RCX, EAVE + RISE, ZC, { c: C.yellowDark });
    for (const sgn of [-1, 1]) R.bar(RCX, EAVE + RISE - 0.01, ZC, RCX, EAVE - 0.12, ZC + sgn * HS, RLEN, 0.06);
    P.box(RLEN - 0.2, 0.05, 0.28, RCX, EAVE + RISE + 0.1, ZC, { c: C.steelLight });
    // hazard stripe on the front plate
    for (let i = 0; i < Math.floor((X1 - X0) / 0.3); i++) P.box(0.14, 0.07, 0.012, X0 + 0.15 + i * 0.3, EAVE - 0.01, ZF + 0.052, { c: C.yellow, rz: 0.7 });

    // ---- furnace (refractory body, steel plates, chimney through the roof, glowing mouth) + roller table + cut-off station
    const fx = MY.FURNACE_X, fz = ZC - 0.05;
    P.box(1.0, 0.9, 0.8, fx, FL + 0.45, fz, { c: C.brick });
    P.box(1.06, 0.1, 0.86, fx, FL + 0.95, fz, { c: C.steelDark });
    P.box(1.04, 0.06, 0.84, fx, FL + 0.04, fz, { c: C.steelDark });
    for (const z of [-0.3, 0.3]) P.box(0.06, 0.85, 0.06, fx + 0.52, FL + 0.43, fz + z, { c: C.steelDark });
    P.cyl(0.13, 0.15, 3.1 - FL - 0.95, 12, fx - 0.1, (FL + 0.95 + 3.1) / 2, fz - 0.12, { c: C.steel });
    P.cyl(0.18, 0.13, 0.12, 12, fx - 0.1, 3.14, fz - 0.12, { c: C.steelDark });
    HOT.box(0.02, 0.36, 0.42, MY.MOUTH_X + 0.02, FL + 0.45, MY.LINE_Z + 0.0);
    HOT.box(0.44, 0.26, 0.02, fx + 0.02, FL + 0.4, fz + 0.41);                                  // peep-hole glow on the front face (the mouth faces east, away from the camera)
    const lz = MY.LINE_Z, ty = MY.BEAM_Y - 0.06;
    P.box(1.9, 0.08, 0.42, 0.1, ty - 0.04, lz, { c: C.steel });
    for (const sz of [-1, 1]) P.box(1.9, 0.1, 0.04, 0.1, ty + 0.01, lz + sz * 0.23, { c: C.steelDark });
    for (let i = 0; i < 8; i++) P.cyl(0.045, 0.045, 0.36, 8, -0.75 + i * 0.26, ty + 0.035, lz, { c: C.steelLight, rx: Math.PI / 2 });
    for (const x of [-0.8, 0.1, 1.0]) for (const sz of [-1, 1]) P.box(0.07, ty - 0.08 - FL, 0.07, x, (FL + ty - 0.08) / 2, lz + sz * 0.2, { c: C.steelDark });
    P.box(0.14, 1.4, 0.14, 1.15, FL + 0.7, lz - 0.2, { c: C.steelDark });                          // cut-off column
    P.box(0.14, 1.4, 0.14, 1.15, FL + 0.7, lz + 0.2, { c: C.steelDark });
    P.box(0.14, 0.1, 0.5, 1.15, FL + 1.42, lz, { c: C.yellowDark });
    // ---- cooling rack in front of the shed
    const rk = MY.RACK;
    for (const dx of [-0.35, 0.35]) { P.box(0.12, 0.34, 0.36, rk[0] + dx, FL + 0.17, rk[1], { c: C.steel }); P.box(0.16, 0.04, 0.4, rk[0] + dx, FL + 0.36, rk[1], { c: C.steelLight }); }

    // ---- level 2: second furnace stack + side wall; level 3: overhead hoist rail over the transfer
    if (level >= 2) {
      P.box(0.8, 0.8, 0.7, 1.55, FL + 0.4, ZB + 0.45, { c: C.brick });
      P.box(0.86, 0.08, 0.76, 1.55, FL + 0.84, ZB + 0.45, { c: C.steelDark });
      P.cyl(0.11, 0.13, 3.0 - FL - 0.84, 12, 1.55, (FL + 0.84 + 3.0) / 2, ZB + 0.45, { c: C.steel });
      P.cyl(0.16, 0.11, 0.1, 12, 1.55, 3.04, ZB + 0.45, { c: C.steelDark });
      HOT.box(0.36, 0.3, 0.02, 1.55, FL + 0.36, ZB + 0.8);
      for (let i = 0; i < 3; i++) P.box(0.1, 0.1, 0.1, 1.3 + i * 0.25, FL + 0.05, ZB + 0.93, { c: C.rust });
    }
    if (level >= 3) {
      for (const x of [0.62, -0.22]) P.box(0.08, EAVE - 0.06 - FL, 0.08, x, (FL + EAVE - 0.06) / 2, ZF - 0.05, { c: C.yellowDark });
      P.box(1.0, 0.1, 0.1, 0.2, EAVE - 0.2, ZF - 0.05, { c: C.yellowDark });
      P.bar(0.2, EAVE - 0.15, ZB + 0.15, 0.2, EAVE - 0.15, MY.RACK[1] + 0.1, 0.08, 0.1, C.steelLight);
      P.cyl(0.06, 0.06, 0.4, 8, 1.1, EAVE + 0.2, ZC, { c: C.red });                                // warning beacon post
    }

    // ---- jib crane (static column + slab; the jib is animated)
    const mxm = MY.MAST[0], mzm = MY.MAST[1];
    P.box(0.55, 0.08, 0.55, mxm, FL + 0.04, mzm, { c: C.steelDark });
    P.box(0.24, MY.JIB_Y - FL - 0.2, 0.24, mxm, (FL + MY.JIB_Y - 0.2) / 2, mzm, { c: C.yellowDark });
    for (let k = 0; k < 6; k++) P.box(0.245, 0.14, 0.245, mxm, FL + 0.3 + k * 0.5, mzm, { c: C.black });   // hazard-ish bands as dark rings on the yellow column
    P.cyl(0.2, 0.2, 0.14, 14, mxm, MY.JIB_Y - 0.12, mzm, { c: C.steelLight });

    // ---- static meshes
    const add = (m) => { if (m) root.add(m); return m; };
    add(SL.toMesh(M.slab, { name: 'v161MetalSlab', cast: false }));
    add(P.toMesh(M.paint, { name: 'v161MetalSteel' }));
    add(W.toMesh(M.corr, { name: 'v161MetalShedWalls' }));
    add(R.toMesh(M.corrDark, { name: 'v161MetalShedRoof' }));
    const glowMat = new THREE.MeshStandardMaterial({ color: lin(0x5a1d08), emissive: lin(0xff6a1f), emissiveIntensity: 0.3, roughness: 0.6 });
    const glow = add(HOT.toMesh(glowMat, { name: 'v161MetalGlow', cast: false }));

    // ---- animated parts: jib (rotating group with trolley, cable, hook), cut-off head, kicker, in-flight beams, sparks, pile
    const jib = new THREE.Group();
    jib.position.set(mxm, MY.JIB_Y, mzm);
    const reach = 2.7;
    {
      const J = batch(true);
      J.box(reach + 0.6, 0.14, 0.16, (reach - 0.6) / 2 + 0.0, 0, 0, { c: C.yellow });
      J.box(0.5, 0.34, 0.34, -0.55, -0.02, 0, { c: C.steelDark });
      J.box(0.14, 0.7, 0.14, 0, 0.42, 0, { c: C.yellowDark });
      J.bar(0, 0.75, 0, reach * 0.85, 0.07, 0, 0.04, 0.04, C.steelLight);
      J.bar(0, 0.75, 0, -0.5, 0.1, 0, 0.04, 0.04, C.steelLight);
      jib.add(J.toMesh(M.paint, { name: 'v161MetalJib' }));
    }
    const trolley = new THREE.Group();
    jib.add(trolley);
    {
      const T = batch(true);
      T.box(0.26, 0.1, 0.24, 0, -0.1, 0, { c: C.steelDark });
      trolley.add(T.toMesh(M.paint, { name: 'v161MetalTrolley' }));
    }
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 6), M.paint);
    cable.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(cable.geometry.attributes.position.count * 3).fill(0.2), 3));
    cable.name = 'v161MetalCable'; cable.castShadow = false;
    trolley.add(cable);
    const hook = (() => { const b = batch(true); b.box(0.16, 0.08, 0.1, 0, 0, 0, { c: C.steelLight }); b.box(0.06, 0.22, 0.06, 0, -0.1, 0, { c: C.yellowDark }); const m = b.toMesh(M.paint, { name: 'v161MetalHook', cast: false }); return m; })();
    trolley.add(hook);
    root.add(jib);

    const head = new THREE.Group();   // cut-off head (wheel + motor), plunges into the beam end
    head.position.set(MY.WHEEL[0], 0.95, MY.WHEEL[1]);
    {
      const wb = batch(true);
      wb.cyl(0.26, 0.26, 0.05, 20, 0, 0, 0, { c: 0xdfe3e8, rx: Math.PI / 2 });
      for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5; wb.box(0.06, 0.06, 0.05, Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0, { c: C.steelLight, rz: a }); }
      const wheel = wb.toMesh(M.paint, { name: 'v161MetalWheel' });
      head.userData.wheel = wheel; head.add(wheel);
      const hb = batch(true);
      hb.box(0.22, 0.2, 0.3, 0.3, 0.1, 0, { c: C.steelDark }); hb.bar(0.3, 0.1, 0, 0.5, 0.45, 0, 0.06, 0.06, C.yellowDark);
      head.add(hb.toMesh(M.paint, { name: 'v161MetalCutterArm' }));
    }
    root.add(head);
    const kicker = (() => { const b = batch(true); b.box(0.12, 0.14, 0.7, 0, 0, 0, { c: C.yellowDark }); const m = b.toMesh(M.paint, { name: 'v161MetalKicker', cast: false }); m.position.set(MY.RACK[0], MY.BEAM_Y, MY.LINE_Z - 0.25); return m; })();
    root.add(kicker);
    // hoist (level 3): trolley that carries the cut beam from the line to the rack
    let hoist = null;
    if (level >= 3) {
      hoist = new THREE.Group();
      const railY = EAVE - 0.2;
      const b = batch(true); b.box(0.24, 0.1, 0.24, 0, 0, 0, { c: C.steelDark });
      hoist.add(b.toMesh(M.paint, { name: 'v161MetalHoist' }));
      const hc = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), M.paint);
      hc.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(hc.geometry.attributes.position.count * 3).fill(0.2), 3));
      hc.name = 'v161MetalHoistCable'; hc.castShadow = false;
      const hb = batch(true); hb.box(0.2, 0.05, 0.1, 0, 0, 0, { c: C.yellowDark }); hb.box(0.04, 0.1, 0.04, 0, 0.07, 0, { c: C.steelLight });
      const hk = hb.toMesh(M.paint, { name: 'v161MetalHoistHook', cast: false });
      hoist.add(hc); hoist.add(hk);
      hoist.userData = { railY, cable: hc, hook: hk };
      hoist.position.set(0.2, railY, MY.LINE_Z);
      root.add(hoist);
    }
    const beams = [];
    for (let k = 0; k < MY.BEAMS_MAX; k++) {
      const m = buildItem('metal', 'v161MetalBeam' + k);
      m.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25, emissive: lin(0xff5a14), emissiveIntensity: 0 });
      beams.push(m); root.add(m);
    }
    const sparks = makePoints(MY.SPARKS_MAX, M.spark, 'v161MetalSparks');
    root.add(sparks.pts);
    const pile = buildPile('metal');
    const pileGroup = new THREE.Group();
    pileGroup.name = 'v161MetalPileGroup';
    pileGroup.position.set(PILES.metal.pose.x, PILES.metal.pose.y, PILES.metal.pose.z); pileGroup.rotation.y = PILES.metal.pose.rot;
    pileGroup.add(pile); root.add(pileGroup);
    const label = addLabel(root, [lang === 'ru' ? 'МЕТАЛЛОБАЗА' : 'STEEL YARD', lang === 'ru' ? '🔩 конструкционный металл' : '🔩 structural steel'], 3.95, 1.5, 0.62);

    root.userData.parts = { jib, trolley, cable, hook, head, wheel: head.userData.wheel, kicker, hoist, beams, sparks, pile, glow, glowMat };
    root.userData.anim = { p: 0, t: 0, spin: 0, running: false, k: 0, seed: 4421, dirty: true, shownPile: -1, pileAdded: 0, pileRemoved: 0, smokeT: 0, chimneys: level >= 2 ? [[fx - 0.1, 3.2, fz - 0.12], [1.55, 3.1, ZB + 0.45]] : [[fx - 0.1, 3.2, fz - 0.12]], reach, jibAngle: 0 };
    const fp = [
      { x: (X0 + X1) / 2, z: (ZB + ZF) / 2, hx: (X1 - X0) / 2 + 0.07, hz: (ZF - ZB) / 2 + 0.07 },   // the whole shed bay (back, side walls, furnace, table, cut-off station)
      { x: rk[0], z: rk[1], hx: 0.55, hz: 0.22 },
      { x: mxm, z: mzm, hx: 0.3, hz: 0.3 },
    ];
    if (level < 2) fp.push({ x: 1.15, z: MY.LINE_Z, hx: 0.12, hz: 0.28 });   // the cut-off column stands just east of the level-1 shed
    if (level >= 3) for (const x of [0.62, -0.22]) fp.push({ x, z: ZF - 0.05, hx: 0.07, hz: 0.07 });
    root.userData.v161Footprint = fp;
    root.userData.layout = { level, x0: X0, x1: X1, zb: ZB, zf: ZF };
    const plant = { group: root, cutterWheel: null, label, v161: true, level };
    poseMetal(plant, 0, false);
    return plant;
  }

  function metalCreditV161() {
    let n = 1;
    try { n = Math.min(1 + Math.floor(stats.prestige / 4), Math.max(0, metalCapacity() - metal)); } catch (e) { /* game not ready */ }
    return Math.max(1, Math.min(MY.BEAMS_MAX, Math.floor(n) || 1));
  }
  function metalIntervalV161() { return Math.max(2, METAL_AUTO_INTERVAL / productionSpeedMultiplier() / industrialSpeedV161('metal')); }

  const _jibTarget = new THREE.Vector3();
  // jib pose: world (plant-local) target point T (x,y,z of the HOOK); returns nothing, rotates the jib, moves the trolley and sizes the cable
  function aimJib(root, Tx, Ty, Tz, angleOverride) {
    const Pt = root.userData.parts, A = root.userData.anim, mxm = MY.MAST[0], mzm = MY.MAST[1];
    let th = angleOverride !== undefined ? angleOverride : Math.atan2(Tz - mzm, Tx - mxm);
    if (th < 0) th += Math.PI * 2;
    const rho = angleOverride !== undefined ? A.reachNow : Math.hypot(Tx - mxm, Tz - mzm);
    Pt.jib.rotation.y = -th;
    Pt.trolley.position.set(clamp(rho, 0.5, A.reach), 0, 0);
    const len = Math.max(0.1, MY.JIB_Y - 0.14 - Ty);
    Pt.cable.scale.set(1, len, 1); Pt.cable.position.set(0, -0.15 - len / 2, 0);
    Pt.hook.position.set(0, -0.15 - len - 0.04, 0);
    A.jibAngle = th; A.reachNow = rho;
    return th;
  }

  function poseMetal(plant, p, running) {
    const root = plant.group, Pt = root.userData.parts, A = root.userData.anim, PH = METAL_PH;
    const rk = MY.RACK, lz = MY.LINE_Z, by = MY.BEAM_Y, Lb = MY.BEAM_L, HANG = 0.34, highY = 2.45, cap = PILES.metal.cap;
    if (running && (p < 0.03 || A.k < 1)) A.k = metalCreditV161();
    const k = running ? A.k : 0, n = A.pileN || 0;
    const slotOf = (j) => pileToGroup(PILES.metal, PILES.metal.at(Math.min(cap - 1, n + j)));
    const s0 = slotOf(0), park = pileToGroup(PILES.metal, [0, 0.9, 0]);
    // ---- jib (hook centre): parked high over the pile -> swings to the rack -> lowers -> lifts the beam -> swings to the pile -> sets it down
    let jx = park[0], jy = highY, jz = park[2];
    if (running) {
      if (p < 0.10) jy = lerp(s0[1] + HANG, highY, S(p / 0.10));
      else if (p < PH.JIB_TO_RACK0) { /* parked */ }
      else if (p < PH.JIB_TO_RACK1) { const u = S((p - PH.JIB_TO_RACK0) / (PH.JIB_TO_RACK1 - PH.JIB_TO_RACK0)); jx = lerp(park[0], rk[0], u); jz = lerp(park[2], rk[1], u); }
      else if (p < PH.HOOK_DOWN1) { jx = rk[0]; jz = rk[1]; jy = lerp(highY, by + HANG, S((p - PH.JIB_TO_RACK1) / (PH.HOOK_DOWN1 - PH.JIB_TO_RACK1))); }
      else if (p < PH.HOOK_UP1) { jx = rk[0]; jz = rk[1]; jy = lerp(by + HANG, highY, S((p - PH.HOOK_DOWN1) / (PH.HOOK_UP1 - PH.HOOK_DOWN1))); }
      else if (p < PH.SWING1) { const u = S((p - PH.HOOK_UP1) / (PH.SWING1 - PH.HOOK_UP1)); jx = lerp(rk[0], s0[0], u); jz = lerp(rk[1], s0[2], u); }
      else if (p < PH.LAND1) { jx = s0[0]; jz = s0[2]; jy = lerp(highY, s0[1] + HANG, S((p - PH.SWING1) / (PH.LAND1 - PH.SWING1))); }
      else { jx = s0[0]; jz = s0[2]; jy = s0[1] + HANG; }
    }
    aimJib(root, jx, jy, jz);
    // ---- beams (the credited number): grow out of the furnace, slide to the cut-off, are pushed (kicker) / carried (hoist, level 3) to the rack, hang under the hook, land in their slots
    const mouth = MY.MOUTH_X + 0.03;
    const kickU = p < PH.CUT1 ? 0 : p < PH.KICK1 ? S((p - PH.CUT1) / (PH.KICK1 - PH.CUT1)) : 1;
    const hot = clamp(1 - (p - 0.08) / 0.62, 0, 1);
    const attach = 0.67, carried = p >= attach && p < PH.LAND1;
    for (let j = 0; j < Pt.beams.length; j++) {
      const b = Pt.beams[j];
      b.visible = j < k;
      if (!b.visible) continue;
      const off = (j - (k - 1) / 2) * 0.17, sj = slotOf(j);
      let x, y = by, z, yaw = 0, sx = 1;
      if (p < PH.ROLL1) { sx = Math.max(0.04, S(p / PH.ROLL1)); x = mouth + sx * Lb / 2; z = lz + off; }
      else if (p < PH.SLIDE1) { x = lerp(mouth + Lb / 2, rk[0], S((p - PH.ROLL1) / (PH.SLIDE1 - PH.ROLL1))); z = lz + off; }
      else if (p < attach) { x = rk[0]; z = lerp(lz, rk[1], kickU) + off; if (Pt.hoist) y = by + 0.2 * Math.sin(Math.PI * kickU); }
      else if (carried) {
        const u = p < PH.SWING1 ? 0 : S((p - PH.SWING1) / (PH.LAND1 - PH.SWING1)), w = S((p - PH.HOOK_UP1) / (PH.SWING1 - PH.HOOK_UP1));
        x = jx + (sj[0] - s0[0]) * u; z = jz + off * (1 - u) + (sj[2] - s0[2]) * u; y = jy - HANG + (sj[1] - s0[1]) * u;
        yaw = lerp(0, PILES.metal.pose.rot, p < PH.HOOK_UP1 ? 0 : w);
      } else { x = sj[0]; y = sj[1]; z = sj[2]; yaw = PILES.metal.pose.rot; }
      b.position.set(x, y, z); b.rotation.set(0, yaw, 0); b.scale.set(sx, 1, 1);
      b.material.emissiveIntensity = 1.1 * hot;
    }
    // ---- cut-off head plunges into the beam end while it cuts
    const cutU = p < PH.SLIDE1 ? 0 : p < PH.CUT1 ? (p - PH.SLIDE1) / (PH.CUT1 - PH.SLIDE1) : 0;
    Pt.head.position.y = lerp(0.98, 0.7, Math.sin(Math.PI * clamp((cutU - 0.25) / 0.5, 0, 1)));
    A.cutting = running && cutU > 0.25 && cutU < 0.75;
    // ---- kicker (levels 1-2) pushes the cut beam to the rack; level 3: the overhead hoist carries it
    const retract = p < PH.KICK1 ? 0 : S((p - PH.KICK1) / 0.1);
    if (Pt.hoist) {
      Pt.kicker.visible = false;
      const H = Pt.hoist, railY = H.userData.railY;
      let hz = lz, hy = 1.2;
      if (running) {
        if (p < PH.SLIDE1) { hz = lz; hy = 1.2; }
        else if (p < PH.SLIDE1 + 0.08) hy = lerp(1.2, by + 0.2, S((p - PH.SLIDE1) / 0.08));
        else if (p < PH.CUT1) hy = by + 0.2;
        else if (p < PH.KICK1) { hz = lerp(lz, rk[1], kickU); hy = by + 0.2 + 0.2 * Math.sin(Math.PI * kickU); }
        else if (p < PH.KICK1 + 0.1) { hz = rk[1]; hy = lerp(by + 0.2, 1.2, S((p - PH.KICK1) / 0.1)); }
        else if (p < 0.9) { hz = lerp(rk[1], lz, S((p - PH.KICK1 - 0.1) / (0.9 - PH.KICK1 - 0.1))); hy = 1.2; }
      }
      H.position.z = hz;
      const len = Math.max(0.1, railY - 0.1 - hy);
      H.userData.cable.scale.set(1, len, 1); H.userData.cable.position.y = -0.1 - len / 2;
      H.userData.hook.position.y = -0.1 - len - 0.03;
    } else {
      Pt.kicker.visible = true;
      Pt.kicker.position.z = lerp(lz - 0.3, rk[1] - 0.3 - 0.07, kickU) * (1 - retract) + (lz - 0.3) * retract;
    }
  }

  function updateMetal(dt) {
    const plant = typeof metalPlant !== 'undefined' ? metalPlant : null;
    if (!plant || !plant.v161) return;
    const root = plant.group, Pt = root.userData.parts, A = root.userData.anim;
    dt = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
    A.t += dt;
    const real = Number.isFinite(metal) ? Math.max(0, Math.floor(metal)) : 0, n = Math.min(PILES.metal.cap, real);
    if (n !== A.shownPile) { if (A.shownPile >= 0) { if (n > A.shownPile) A.pileAdded += n - A.shownPile; else A.pileRemoved += A.shownPile - n; } A.shownPile = n; setPile(Pt.pile, n); }
    A.pileN = n;
    let running = false, p = A.p;
    try {
      running = metalYardBuiltV118 && stageIndex >= METAL_UNLOCK_STAGE && metal < metalCapacity();
      if (running) p = clamp(metalPlantTimer / metalIntervalV161(), 0, 0.9999);
    } catch (e) { /* globals not ready */ }
    if (!running) { p = 0; A.k = 0; }
    A.running = running;
    if (!running && A.p !== 0) A.dirty = true;
    if (running || A.dirty) { A.dirty = false; A.p = p; poseMetal(plant, p, running); }
    const cutting = running && A.cutting;
    const target = running ? (cutting ? 22 : 4) : 0;
    A.spin += (target - A.spin) * Math.min(1, dt * 6);
    Pt.wheel.rotation.z += dt * A.spin;
    // furnace glow: dull when idle, bright while it heats and rolls
    const heat = running ? 0.55 + 0.45 * clamp(1 - A.p / 0.6, 0, 1) + 0.12 * Math.sin(A.t * 7) : 0.18;
    Pt.glowMat.emissiveIntensity = heat;
    stepPoints(Pt.sparks, dt, cutting, 24, 5.5, FLOOR + 0.02, (i, o, an) => {
      Pt.sparks.pos[o] = MY.WHEEL[0] + (rand(an) - 0.5) * 0.12; Pt.sparks.pos[o + 1] = 0.66; Pt.sparks.pos[o + 2] = MY.WHEEL[1] + (rand(an) - 0.5) * 0.12;
      Pt.sparks.vel[o] = 0.3 + rand(an) * 1.2; Pt.sparks.vel[o + 1] = 0.6 + rand(an) * 1.4; Pt.sparks.vel[o + 2] = (rand(an) - 0.5) * 1.6;
      Pt.sparks.life[i] = 0.3 + rand(an) * 0.3;
    }, A);
    if (running) {
      A.smokeT += dt;
      if (A.smokeT >= 1.8) {
        A.smokeT = 0;
        if (typeof spawnSmokePuff === 'function' && root.visible) for (const c of A.chimneys) { _jibTarget.set(c[0], c[1], c[2]); root.localToWorld(_jibTarget); spawnSmokePuff(_jibTarget); }
      }
    } else A.smokeT = 1.4;
  }

  // =============================================================================================================================
  //  FRAME WORKSHOP
  // =============================================================================================================================
  const FW = Object.freeze({ SAW: [-0.75, 0.95], JIG: [0.15, 0.95], STACK: [1.15, 0.55], DUST_MAX: 12, SHED: [-1.5, 0.55, -1.4, 0.2] });
  const FRAME_PH = Object.freeze({ SAW0: 0.02, SAW1: 0.38, BUILD1: 0.82, SLIDE1: 0.96 });

  function buildWorkshop() {
    const M = mats(), root = new THREE.Group();
    root.name = 'v161FrameWorkshop';
    const SL = batch(false), P = batch(true), WL = batch(false), RF = batch(false), G = batch(false), WD = batch(false);
    const FL = 0.16, X0 = FW.SHED[0], X1 = FW.SHED[1], ZB = FW.SHED[2], ZF = FW.SHED[3], EAVE = 1.3, RISE = 0.5;
    // ---- slab with a yellow edge
    SL.box(3.4, 0.16, 3.0, 0.0, 0.08, 0);
    for (let i = 0; i < 11; i++) P.box(0.3, 0.012, 0.1, -1.5 + i * 0.3, FL + 0.006, 1.42, { c: C.yellow, ry: 0.7 });
    // ---- the shed: timber walls on a plinth, framed door (front, east side), shuttered windows, gabled roof with the ridge along x
    const cx = (X0 + X1) / 2, cz = (ZB + ZF) / 2, w = X1 - X0, d = ZF - ZB;
    WL.box(w, EAVE - FL, d, cx, (EAVE + FL) / 2, cz);
    P.box(w + 0.1, 0.2, d + 0.1, cx, FL + 0.1, cz, { c: C.steelLight });
    for (const [x, z] of [[X0, ZB], [X1, ZB], [X0, ZF], [X1, ZF]]) P.box(0.14, EAVE - FL + 0.02, 0.14, x, (EAVE + FL) / 2, z, { c: C.woodDark });
    P.box(w + 0.1, 0.1, 0.12, cx, EAVE, ZF, { c: C.woodDark }); P.box(w + 0.1, 0.1, 0.12, cx, EAVE, ZB, { c: C.woodDark });
    // door: timber frame, plank leaf, handle, step
    const dx = X1 - 0.55, dw = 0.5, dh = 0.98;
    P.box(dw + 0.14, 0.07, 0.04, dx, FL + dh + 0.07, ZF + 0.02, { c: C.woodDark });
    for (const s of [-1, 1]) P.box(0.07, dh + 0.1, 0.04, dx + s * (dw / 2 + 0.035), FL + (dh + 0.1) / 2, ZF + 0.02, { c: C.woodDark });
    P.box(dw, dh, 0.03, dx, FL + dh / 2, ZF + 0.012, { c: 0x6d4528 });
    for (const s of [-1, 0, 1]) P.box(0.015, dh, 0.034, dx + s * 0.16, FL + dh / 2, ZF + 0.014, { c: 0x57361e });
    P.box(0.04, 0.12, 0.05, dx + 0.17, FL + 0.55, ZF + 0.04, { c: C.steelLight });
    P.box(0.7, 0.07, 0.3, dx, FL + 0.035, ZF + 0.2, { c: C.woodDark });
    // windows: pane + frame + two shutters (front, west wall)
    const win = (x, y, z, axis) => {
      const ww = 0.5, wh = 0.42;
      if (axis === 'z') {
        G.box(ww, wh, 0.02, x, y, z + 0.004);
        P.box(ww + 0.08, 0.05, 0.04, x, y + wh / 2 + 0.03, z + 0.01, { c: C.white }); P.box(ww + 0.08, 0.05, 0.05, x, y - wh / 2 - 0.03, z + 0.02, { c: C.white });
        for (const s of [-1, 1]) { P.box(0.05, wh + 0.1, 0.04, x + s * (ww / 2 + 0.03), y, z + 0.01, { c: C.white }); P.box(0.22, wh, 0.03, x + s * (ww / 2 + 0.17), y, z + 0.015, { c: C.red }); }
        P.box(0.03, wh, 0.03, x, y, z + 0.015, { c: C.white });
      } else {
        G.box(0.02, wh, ww, x - 0.004, y, z);
        P.box(0.04, 0.05, ww + 0.08, x - 0.01, y + wh / 2 + 0.03, z, { c: C.white }); P.box(0.05, 0.05, ww + 0.08, x - 0.02, y - wh / 2 - 0.03, z, { c: C.white });
        for (const s of [-1, 1]) { P.box(0.04, wh + 0.1, 0.05, x - 0.01, y, z + s * (ww / 2 + 0.03), { c: C.white }); P.box(0.03, wh, 0.22, x - 0.015, y, z + s * (ww / 2 + 0.17), { c: C.red }); }
      }
    };
    win(X0 + 0.55, FL + 0.78, ZF, 'z'); win(X0, FL + 0.78, cz, 'x');
    // roof: two corrugated planes + ridge cap + gable infill
    const HS = d / 2 + 0.2, RCX = cx, RLEN = w + 0.4;
    for (const s of [-1, 1]) RF.bar(RCX, EAVE + RISE - 0.01, cz, RCX, EAVE - 0.1, cz + s * HS, RLEN, 0.06);
    P.box(RLEN + 0.05, 0.07, 0.3, RCX, EAVE + RISE + 0.03, cz, { c: C.steelDark });
    WL.gable(X0, cz, EAVE, d / 2, RISE - 0.02, 0.06); WL.gable(X1, cz, EAVE, d / 2, RISE - 0.02, 0.06);
    P.box(0.5, 0.14, 0.06, X0 + 0.75, FL + EAVE + 0.15, ZF - 0.02, { c: C.woodDark });
    // ---- saw table (stationary circular saw): bench, fence, blade slot, blade hood; frame jig: table with corner stops
    const sw = FW.SAW, jg = FW.JIG;
    P.box(0.7, 0.07, 0.5, sw[0], FL + 0.62, sw[1], { c: C.steel });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.06, 0.6, 0.06, sw[0] + sx * 0.3, FL + 0.3, sw[1] + sz * 0.2, { c: C.steelDark });
    P.box(0.7, 0.06, 0.05, sw[0], FL + 0.7, sw[1] - 0.22, { c: C.yellowDark });
    P.box(0.3, 0.2, 0.26, sw[0] + 0.0, FL + 0.7, sw[1] - 0.05, { c: C.steelDark });
    for (const sx of [-1, 1]) P.box(0.04, 0.3, 0.04, sw[0] + sx * 0.1, FL + 0.86, sw[1] - 0.05, { c: C.steelLight });
    P.box(1.0, 0.07, 0.62, jg[0], FL + 0.52, jg[1], { c: C.woodDark });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.07, 0.5, 0.07, jg[0] + sx * 0.45, FL + 0.25, jg[1] + sz * 0.26, { c: C.woodDark });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.box(0.1, 0.07, 0.1, jg[0] + sx * 0.46, FL + 0.58, jg[1] + sz * 0.3, { c: C.yellowDark });
    // frame rack: three upright boards (back + two ends) around the stack of finished frames
    const rkx = FW.STACK[0], rkz = FW.STACK[1];
    P.box(1.08, 0.55, 0.04, rkx, FL + 0.275, rkz - 0.36, { c: C.wood });
    for (const sx of [-1, 1]) P.box(0.04, 0.55, 0.72, rkx + sx * 0.52, FL + 0.275, rkz - 0.0, { c: C.wood });
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.box(0.07, 0.62, 0.07, rkx + x * 0.52, FL + 0.31, rkz + z * 0.36, { c: C.woodDark });
    // a lamp bracket over the door
    P.box(0.06, 0.06, 0.2, dx, FL + dh + 0.25, ZF + 0.1, { c: C.steelDark });
    const lamps = batch(false); lamps.sph(0.07, dx, FL + dh + 0.2, ZF + 0.22);
    // ---- static meshes
    const add = (m) => { if (m) root.add(m); return m; };
    add(SL.toMesh(M.slab, { name: 'v161WorkshopSlab', cast: false }));
    add(P.toMesh(M.paint, { name: 'v161WorkshopTimber' }));
    add(WL.toMesh(M.siding, { name: 'v161WorkshopWalls' }));
    add(RF.toMesh(M.roof, { name: 'v161WorkshopRoof' }));
    add(G.toMesh(M.glass, { name: 'v161WorkshopWindows', cast: false }));
    add(lamps.toMesh(M.lamp, { name: 'v161WorkshopLamp', cast: false }));
    // ---- animated: saw blade (spins), the planks on the saw table (slide in), the frame on the jig (builds up, then slides to the stack), dust, stack
    const blade = (() => { const b = batch(true); b.cyl(0.2, 0.2, 0.03, 18, 0, 0, 0, { c: 0xdfe3e8, rz: Math.PI / 2 }); for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; b.box(0.03, 0.06, 0.05, 0, Math.cos(a) * 0.205, Math.sin(a) * 0.205, { c: C.steelLight, rx: a }); } const m = b.toMesh(M.paint, { name: 'v161WorkshopBlade' }); m.position.set(sw[0], FL + 0.86, sw[1] - 0.05); return m; })();
    root.add(blade);
    const planksMesh = (() => { const b = batch(true); for (let k = 0; k < 3; k++) b.box(0.8, 0.045, 0.1, 0, k * 0.05, (k - 1) * 0.13, { c: [C.woodLight, C.wood, C.woodLight][k] }); const m = b.toMesh(M.paint, { name: 'v161WorkshopPlanks', soft: true }); m.visible = false; return m; })();
    root.add(planksMesh);
    const frameMesh = (() => { const b = batch(true); frameBoxes(b, 0, 0, 0, C.woodLight, 0); const m = b.toMesh(M.paint, { name: 'v161WorkshopFrame', soft: true }); m.visible = false; m.userData.drawPer = 36; return m; })();
    root.add(frameMesh);
    const dust = makePoints(FW.DUST_MAX, M.sawdust, 'v161WorkshopDust');
    root.add(dust.pts);
    const pile = buildPile('frame');
    const pileGroup = new THREE.Group();
    pileGroup.name = 'v161WorkshopPileGroup'; pileGroup.position.set(FW.STACK[0], FL, FW.STACK[1]);
    pileGroup.add(pile); root.add(pileGroup);
    const label = addLabel(root, [lang === 'ru' ? 'КАРКАСНЫЙ ЦЕХ' : 'FRAME WORKSHOP', '📐 0/0'], 3.0, 1.5, 0.62);
    root.userData.parts = { blade, planksMesh, frameMesh, dust, pile };
    root.userData.anim = { p: 0, t: 0, spin: 0, running: false, seed: 777, dirty: true, shownPile: -1, pileAdded: 0, pileRemoved: 0 };
    root.userData.v161Footprint = [
      { x: cx, z: cz, hx: w / 2 + 0.1, hz: d / 2 + 0.1 },
      { x: sw[0], z: sw[1], hx: 0.38, hz: 0.3 },
      { x: jg[0], z: jg[1], hx: 0.52, hz: 0.36 },
      { x: FW.STACK[0], z: FW.STACK[1] - 0.0, hx: 0.55, hz: 0.4 },
    ];
    root.userData.layout = { x0: X0, x1: X1, zb: ZB, zf: ZF, door: [dx, ZF + 0.3] };
    const prop = { group: root, label, v161: true };
    poseWorkshop(root, 0, 0);
    return prop;
  }

  const frameSlotV161 = (n) => { const s = PILES.frame.at(Math.min(PILES.frame.cap - 1, n)); return [FW.STACK[0] + s[0], 0.16 + s[1], FW.STACK[1] + s[2]]; };

  function updateWorkshop(prop, dt) {
    if (!prop || !prop.v161) return;
    const root = prop.group, Pt = root.userData.parts, A = root.userData.anim;
    dt = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
    A.t += dt;
    const real = Number.isFinite(framesV161) ? Math.max(0, Math.floor(framesV161)) : 0, n = Math.min(PILES.frame.cap, real);
    if (n !== A.shownPile) { if (A.shownPile >= 0) { if (n > A.shownPile) A.pileAdded += n - A.shownPile; else A.pileRemoved += A.shownPile - n; } A.shownPile = n; setPile(Pt.pile, n); }
    A.pileN = n;
    let running = false, p = 0;
    try { const ph = window.PRODUCTION_CHAIN_V161 && window.PRODUCTION_CHAIN_V161.phase && window.PRODUCTION_CHAIN_V161.phase(); if (ph) { running = !!ph.active; p = clamp(ph.p, 0, 0.9999); } } catch (e) { /* chain layer not ready */ }
    if (!running) p = 0;
    A.running = running;
    if (!running && A.p !== 0) A.dirty = true;
    if (running || A.dirty) { A.dirty = false; A.p = p; poseWorkshop(root, p, n); }
    const sawing = running && p >= FRAME_PH.SAW0 && p < FRAME_PH.SAW1;
    A.cutting = sawing;
    A.spin += ((running ? (sawing ? 40 : 8) : 0) - A.spin) * Math.min(1, dt * 5);
    Pt.blade.rotation.x += dt * A.spin;
    stepPoints(Pt.dust, dt, sawing && p > 0.08, 14, 3.2, 0.18, (i, o, an) => {
      Pt.dust.pos[o] = FW.SAW[0] + (rand(an) - 0.5) * 0.1; Pt.dust.pos[o + 1] = 0.98 + rand(an) * 0.12; Pt.dust.pos[o + 2] = FW.SAW[1] - 0.05 + (rand(an) - 0.5) * 0.08;
      Pt.dust.vel[o] = (rand(an) - 0.5) * 0.5; Pt.dust.vel[o + 1] = 0.3 + rand(an) * 0.6; Pt.dust.vel[o + 2] = 0.3 + rand(an) * 0.6; Pt.dust.life[i] = 0.5 + rand(an) * 0.4;
    }, A);
  }

  function poseWorkshop(root, p, n) {
    const Pt = root.userData.parts, PH = FRAME_PH, sw = FW.SAW, jg = FW.JIG, FL = 0.16;
    // planks: three boards slide along the saw table through the blade (z towards -z), disappear when sawn
    const sawU = p < PH.SAW0 ? 0 : p < PH.SAW1 ? (p - PH.SAW0) / (PH.SAW1 - PH.SAW0) : 1;
    Pt.planksMesh.visible = p > 0 && p < PH.SAW1;
    if (Pt.planksMesh.visible) Pt.planksMesh.position.set(sw[0], FL + 0.7 + 0.025, lerp(sw[1] + 0.2, sw[1] - 0.12, S(sawU)));
    // frame on the jig: the six members appear one after the other, then it slides to the stack
    const bu = p < PH.SAW1 ? 0 : p < PH.BUILD1 ? (p - PH.SAW1) / (PH.BUILD1 - PH.SAW1) : 1;
    const parts = Math.min(6, Math.floor(bu * 6.0001));
    const slot = frameSlotV161(n);
    const slideU = p < PH.BUILD1 ? 0 : p < PH.SLIDE1 ? S((p - PH.BUILD1) / (PH.SLIDE1 - PH.BUILD1)) : 1;
    const dropU = p < PH.SLIDE1 ? 0 : S((p - PH.SLIDE1) / (1 - PH.SLIDE1));
    Pt.frameMesh.visible = parts > 0;
    Pt.frameMesh.geometry.setDrawRange(0, parts * 36);
    if (Pt.frameMesh.visible) {
      const x0 = jg[0], y0 = FL + 0.52 + 0.07, z0 = jg[1];
      const x = lerp(x0, slot[0], slideU), z = lerp(z0, slot[2], slideU), y = lerp(y0, slot[1] + 0.0, dropU) + 0.15 * Math.sin(Math.PI * slideU) * (1 - dropU);
      Pt.frameMesh.position.set(x, y, z);
    }
  }

  // ---------------------------------------------------------------------------------------------- registry hooks + level refresh
  function groupObstacles(group, label) {
    const fp = group && group.userData && group.userData.v161Footprint;
    if (!fp || !fp.length || group.visible === false) return [];
    group.updateMatrixWorld(true);
    const yaw = group.rotation.y, out = [];
    fp.forEach((f, i) => {
      const w = new THREE.Vector3(f.x, 0, f.z).applyMatrix4(group.matrixWorld);
      out.push({ owner: group, label: `${label}:${i}`, pos: new THREE.Vector3(w.x, 0, w.z), hx: f.hx, hz: f.hz, yaw });
    });
    return out;
  }
  function liveGroups() {
    const out = [];
    try { if (typeof concretePlant !== 'undefined' && concretePlant && concretePlant.v161) out.push([concretePlant.group, 'concrete-plant-v161']); } catch (e) { /* not declared yet */ }
    try { if (typeof metalPlant !== 'undefined' && metalPlant && metalPlant.v161) out.push([metalPlant.group, 'metal-yard-v161']); } catch (e) { /* not declared yet */ }
    try { const pr = window.PRODUCTION_CHAIN_V161 && window.PRODUCTION_CHAIN_V161.prop && window.PRODUCTION_CHAIN_V161.prop(); if (pr && pr.v161) out.push([pr.group, 'frame-workshop-v161']); } catch (e) { /* chain layer not ready */ }
    return out;
  }
  function obstacles() { const out = []; for (const [g, l] of liveGroups()) out.push(...groupObstacles(g, l)); return out; }
  // true when the static circle at `pos` (road/placement planning only) is replaced by real boxes for players/agents
  function ownsCollider(pos) {
    try {
      if (typeof sawmillObstaclesV161 === 'function' && typeof SAWMILL_POS !== 'undefined' && Math.hypot(pos.x - SAWMILL_POS.x, pos.z - SAWMILL_POS.z) < 0.01 && sawmillObstaclesV161().length) return true;
    } catch (e) { /* sawmill layer not ready */ }
    for (const [g] of liveGroups()) if (g.visible !== false && Math.hypot(pos.x - g.position.x, pos.z - g.position.z) < 0.01) return true;
    return false;
  }

  // (re)build the plants whose production level changed; cheap when nothing changed (compares one number each)
  function rebuild(kind) {
    const old = kind === 'concrete' ? concretePlant : metalPlant;
    if (!old || !old.v161) return;
    const lv = Math.min(3, industrialLevelV161(kind));
    if (old.level === lv) return;
    const fresh = kind === 'concrete' ? buildConcrete(lv) : buildMetal(lv);
    fresh.group.position.copy(kind === 'concrete' ? CONCRETE_PLANT_POS : METAL_YARD_POS);
    const oa = old.group.userData.anim;
    if (oa) { fresh.group.userData.anim.t = oa.t; fresh.group.userData.anim.spin = oa.spin; }
    scene.add(fresh.group);
    scene.remove(old.group);
    disposeObject3D(old.group);
    // the game keeps the object identity (labels, update loops read concretePlant / metalPlant)
    for (const k of Object.keys(fresh)) old[k] = fresh[k];
    try { window.__TYCOON_V83_COLLISIONS__?.rebuild?.(); } catch (e) { /* registry not up yet */ }
  }
  function refreshPlants() { if (!window.PlantsV161.enabled) return; rebuild('concrete'); rebuild('metal'); }

  // plain-data snapshots for the tests
  function snap(kind) {
    let g = null;
    try { g = kind === 'concrete' ? concretePlant : kind === 'metal' ? metalPlant : window.PRODUCTION_CHAIN_V161.prop(); } catch (e) { return null; }
    if (!g || !g.v161) return null;
    const A = g.group.userData.anim, Pt = g.group.userData.parts, out = { level: g.group.userData.levelV161 || 1, p: A.p, running: A.running, spin: A.spin, pile: { shown: A.shownPile, added: A.pileAdded, removed: A.pileRemoved, visible: Pt.pile.visible, range: Pt.pile.geometry.drawRange.count / Pt.pile.userData.drawPer }, k: A.k };
    if (Pt.blocks) out.inflight = Pt.blocks.filter((b) => b.visible).map((b) => ({ x: b.position.x, y: b.position.y, z: b.position.z }));
    if (Pt.beams) out.inflight = Pt.beams.filter((b) => b.visible).map((b) => ({ x: b.position.x, y: b.position.y, z: b.position.z }));
    if (Pt.frameMesh) out.inflight = Pt.frameMesh.visible ? [{ x: Pt.frameMesh.position.x, y: Pt.frameMesh.position.y, z: Pt.frameMesh.position.z, parts: Pt.frameMesh.geometry.drawRange.count / 36 }] : [];
    const D = Pt.dust || Pt.sparks; out.particles = { live: D ? D.live : 0, max: D ? D.n : 0 };
    if (Pt.bucket) out.bucket = { x: Pt.bucket.position.x, y: Pt.bucket.position.y };
    if (Pt.jib) out.jib = { angle: A.jibAngle, reach: A.reachNow, hookY: MY.JIB_Y + Pt.hook.position.y };   // world height of the hook
    if (Pt.planksMesh) out.planksVisible = Pt.planksMesh.visible;
    out.cutting = !!A.cutting;
    return out;
  }

  window.PlantsV161 = {
    enabled: true, version: 'v161-plants', FLOOR, PILES, CP, MY, FW, CONCRETE_PH, METAL_PH, FRAME_PH,
    buildConcrete, buildMetal, buildWorkshop, updateConcrete, updateMetal, updateWorkshop, refresh: refreshPlants, obstacles, ownsCollider, snap,
    pileSlotWorld: (kind, i) => (kind === 'frame' ? frameSlotV161(i) : pileToGroup(PILES[kind], PILES[kind].at(i))),   // group-frame position of slot i of the pile (the item lands there)
  };
})();
