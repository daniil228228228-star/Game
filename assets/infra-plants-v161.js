/* City backbone plants v161 (2026-10-10 (13), "improve physics and design of every building", backlog #9: POWER PLANT and WATER WORKS).
 *
 * Until now the two district-infra pads (assets/district-infra-v161.js "plant" steps, game v42 `makePowerPlantV42` / `makeWaterWorksV42`) sat beside a flat 0.5 m "site" slab with a few posts and
 * a "NOT BUILT" plate, and the finished plant was a grey box with a few cylinders. Now the plant is a small real facility that exists exactly while the player has paid for it:
 *   level 0, nothing bought     : NOTHING stands there (the pad is the only mark; no empty slab, no sign: rule 2 of the world-consistency rules)
 *   level 0, pad bought (timer) : the fenced yard with its gate and the first module as a formwork + a swaying crane (construction)
 *   level n (1..3)              : n modules; the one being paid for (pending timer) stands next to them as formwork + crane
 * POWER PLANT (7.1 x 5.7 m, gate on the pad side): L1 = substation hall (gabled, door, windows, hazard plate), 1 transformer on a plinth (tank, radiator fins, conservator, 3 porcelain bushings),
 *   a lattice pylon with 2 cross-arms, insulator strings and 3 wires to the transformer, fence + gate gantry with the lightning-bolt plate, 2 flood lights;  L2 = + a 2nd transformer,
 *   the generator shed (ribbed walls, flat gable roof, a spinning roof ventilator) and the first stack;  L3 = + a 3rd transformer and the 2nd stack.
 * WATER WORKS (7.1 x 5.6 m): L1 = pump house (gabled, door, windows) + a round ground tank (ribs, domed roof, ladder, vent) + pipes;  L2 = + a 2nd tank and a settling basin with an animated
 *   blue water surface and a paddle aerator;  L3 = + a water tower on a braced frame (tank, band, cone roof, ladder) and a 2nd basin.
 * The picture follows the state: module count = plant level (v42State.powerPlantLevel / waterPlantLevel), formwork = the pending timer, the red roof beacon = supply ratio < 0.8 (the game's own
 * rule), the ventilator / paddle speed = the plant mode (ECO / NORMAL / BOOST) and the label shows the real demand / capacity numbers (label made by the game, see makePowerPlantV42).
 * Physics: `userData.v161Footprint` lists the solid parts (fence runs with the gate gap, hall, transformers, shed, stacks, pylon, basins, tanks, tower, posts, lamp poles); the yard is
 * walkable through the gate, the pad (6.5 m north of the centre) stands outside every collider. Registered through `InfraV161.obstacles()` (rebuildStatic), placement / camera off.
 * ~9 meshes per plant: concrete, roof, paint (solid details), soft paint (fence, wires: no wall mass), glass, lamp, 2 rotors, beacon, [water, crane].
 * `InfraV161.enabled = false` brings the old flat models back (the game rebuilds them through refreshV42World(true)).
 */
'use strict';
(() => {
  const TAU = Math.PI * 2;
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  // ---------------------------------------------------------------------------------------------- merged geometry batch (vertex coloured, y of box/cyl = centre)
  function batch(vc) {
    const pos = [], nor = [], uv = [], col = [], idx = [];
    const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), v = new THREE.Vector3();
    function add(geo, x, y, z, o) {
      o = o || {};
      q.setFromEuler(e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'));
      sc.set(o.sx || 1, o.sy || 1, o.sz || 1);
      m4.compose(p.set(x, y, z), q, sc); n3.getNormalMatrix(m4);
      const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, base = pos.length / 3;
      const rgb = vc ? lin(o.c === undefined ? 0xffffff : o.c) : null;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m4); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize(); nor.push(v.x, v.y, v.z);
        uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
        if (vc) col.push(rgb.r, rgb.g, rgb.b);
      }
      const I = geo.index;
      if (I) for (let k = 0; k < I.count; k++) idx.push(base + I.getX(k)); else for (let k = 0; k < P.count; k++) idx.push(base + k);
      geo.dispose();
    }
    function quad(a, b, c, d, n, color) {
      const base = pos.length / 3, rgb = vc ? lin(color === undefined ? 0xffffff : color) : null;
      for (const P of [a, b, c, d]) { pos.push(P[0], P[1], P[2]); nor.push(n[0], n[1], n[2]); uv.push(0, 0); if (vc) col.push(rgb.r, rgb.g, rgb.b); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    function tri(a, b, c, n, color) {
      const base = pos.length / 3, rgb = vc ? lin(color === undefined ? 0xffffff : color) : null;
      for (const P of [a, b, c]) { pos.push(P[0], P[1], P[2]); nor.push(n[0], n[1], n[2]); uv.push(0, 0); if (vc) col.push(rgb.r, rgb.g, rgb.b); }
      idx.push(base, base + 1, base + 2);
    }
    const api = {
      add, quad, tri,
      box: (w, h, d, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), x, y, z, o),
      // box from extents
      ext: (x0, x1, y0, y1, z0, z1, c, o) => add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Object.assign({ c }, o || {})),
      cyl: (rt, rb, h, seg, x, y, z, o) => add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false), x, y, z, o),
      cone: (r, h, seg, x, y0, z, o) => add(new THREE.ConeGeometry(r, h, seg, 1, false), x, y0 + h / 2, z, o),
      ell: (rx, ry, rz, x, y, z, o) => add(new THREE.SphereGeometry(1, 10, 6), x, y, z, Object.assign({ sx: rx, sy: ry, sz: rz }, o || {})),
      // thin bar from a to b (arrays [x,y,z]) of square section t
      seg(a, b, t, c) {
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
        if (L < 1e-4) return;
        add(new THREE.BoxGeometry(L, t, t), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, { ry: Math.atan2(-dz, dx), rz: Math.atan2(dy, Math.hypot(dx, dz)), c });
      },
      // annulus band r0..r1 from y0 to y1 about (cx, cz): top + outer wall (+ inner when r0 > 0 and o.inner)
      ring(cx, cz, r0, r1, y0, y1, seg, c, o) {
        o = o || {};
        for (let i = 0; i < seg; i++) {
          const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
          const P = (r, cc, ss, y) => [cx + cc * r, y, cz + ss * r];
          quad(P(r0, c0, s0, y1), P(r0, c1, s1, y1), P(r1, c1, s1, y1), P(r1, c0, s0, y1), [0, 1, 0], c);
          quad(P(r1, c0, s0, y0), P(r1, c0, s0, y1), P(r1, c1, s1, y1), P(r1, c1, s1, y0), [(c0 + c1) / 2, 0, (s0 + s1) / 2], c);
          if (o.inner) quad(P(r0, c0, s0, y0), P(r0, c1, s1, y0), P(r0, c1, s1, y1), P(r0, c0, s0, y1), [-(c0 + c1) / 2, 0, -(s0 + s1) / 2], c);
        }
      },
      // copy another batch into this one, rotated by yaw about y and moved by (ox, oy, oz); `src.raw` is its flat arrays (both must be vertex coloured or both not)
      append(src, ox, oy, oz, yaw) {
        const R = src.raw, c = Math.cos(yaw || 0), sn = Math.sin(yaw || 0), base = pos.length / 3;
        for (let i = 0; i < R.pos.length; i += 3) { pos.push(R.pos[i] * c + R.pos[i + 2] * sn + ox, R.pos[i + 1] + oy, -R.pos[i] * sn + R.pos[i + 2] * c + oz); nor.push(R.nor[i] * c + R.nor[i + 2] * sn, R.nor[i + 1], -R.nor[i] * sn + R.nor[i + 2] * c); }
        for (let i = 0; i < R.uv.length; i++) uv.push(R.uv[i]);
        if (vc) for (let i = 0; i < R.col.length; i++) col.push(R.col[i]);
        for (let i = 0; i < R.idx.length; i++) idx.push(base + R.idx[i]);
      },
      get raw() { return { pos, nor, uv, col, idx }; },
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
    return api;
  }

  // ---------------------------------------------------------------------------------------------- shared materials (never disposed)
  let MATS = null;
  function mats() {
    if (MATS) return MATS;
    const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    const fam = (family, opts) => share(createSurfaceMaterialV152(family, lin(0xffffff), Object.assign({ vertexColors: true }, opts)));
    MATS = {
      concrete: fam('concrete', { roughness: 0.93 }),
      roof: fam('roof', { roughness: 0.86, side: THREE.DoubleSide }),
      paint: share(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.14 })),
      soft: share(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 })),
      lamp: share(new THREE.MeshStandardMaterial({ color: lin(0xfff0c2), emissive: lin(0xffb84a), emissiveIntensity: 0.35, roughness: 0.4 })),
      glass: share(new THREE.MeshStandardMaterial({ color: lin(0x9ccbe6), emissive: lin(0x1b3a52), emissiveIntensity: 0.3, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.8, depthWrite: false })),
      water: share(new THREE.MeshStandardMaterial({ color: lin(0x3fa7dc), emissive: lin(0x0d4a6e), emissiveIntensity: 0.38, roughness: 0.1, metalness: 0.22, transparent: true, opacity: 0.9 })),
      beacon: share(new THREE.MeshStandardMaterial({ color: lin(0xff5148), emissive: lin(0xff2f24), emissiveIntensity: 1.1, roughness: 0.4 })),
    };
    return MATS;
  }
  const castOk = () => { try { return !VISUAL_MOBILE; } catch (e) { return true; } };

  // ---------------------------------------------------------------------------------------------- shared pieces
  const C = {
    slab: 0x9d9b94, path: 0xc3c0b6, kerb: 0xb5b2a8, wall: 0xd7d3c8, plinth: 0x9a968b, dark: 0x2c323a, steel: 0x8b97a4, steelDark: 0x626d79, hazard: 0xf2c230, orange: 0xe08b32, white: 0xf2eee6,
    pole: 0x6b747e, rail: 0xc9ccd0, wood: 0xa8743f, cone: 0xf07a2a, brick: 0xb35a3c,
  };
  // the fence line: posts every ~0.9 m, plinth, two rails; `gap` = [a, b] along the run (x for the north run) left open for the gate. Appends the solid boxes (thin) to `fp`.
  function fenceRun(S, fp, x0, z0, x1, z1, gap) {
    const horizontal = Math.abs(z1 - z0) < 1e-6, L = horizontal ? Math.abs(x1 - x0) : Math.abs(z1 - z0), dir = horizontal ? Math.sign(x1 - x0) : Math.sign(z1 - z0);
    const parts = gap ? [[0, gap[0]], [gap[1], L]] : [[0, L]];
    for (const [a, b] of parts) {
      if (b - a < 0.05) continue;
      const n = Math.max(1, Math.round((b - a) / 0.9)), step = (b - a) / n;
      const P = (t) => (horizontal ? [x0 + dir * t, z0] : [x0, z0 + dir * t]);
      const A = P(a), B = P(b), cx = (A[0] + B[0]) / 2, cz = (A[1] + B[1]) / 2;
      const len = b - a;
      if (horizontal) { S.box(len, 0.2, 0.1, cx, 0.2, cz, { c: C.plinth }); S.box(len, 0.045, 0.045, cx, 0.74, cz, { c: C.rail }); S.box(len, 0.035, 0.035, cx, 0.5, cz, { c: C.rail }); }
      else { S.box(0.1, 0.2, len, cx, 0.2, cz, { c: C.plinth }); S.box(0.045, 0.045, len, cx, 0.74, cz, { c: C.rail }); S.box(0.035, 0.035, len, cx, 0.5, cz, { c: C.rail }); }
      for (let i = 0; i <= n; i++) { const pp = P(a + i * step); S.box(0.07, 0.72, 0.07, pp[0], 0.46, pp[1], { c: C.steelDark }); }
      fp.push(horizontal ? { x: cx, z: cz, hx: len / 2, hz: 0.07 } : { x: cx, z: cz, hx: 0.07, hz: len / 2 });
    }
  }
  // gate gantry over the opening: two brick posts, a beam, the plate (drawn on the pad side = -z face)
  function gateGantry(P, S, L, fp, gx0, gx1, zf, plate, Cn) {
    const mid = (gx0 + gx1) / 2;
    for (const gx of [gx0, gx1]) { P.ext(gx - 0.11, gx + 0.11, 0.1, 2.05, zf - 0.11, zf + 0.11, C.brick); P.ext(gx - 0.15, gx + 0.15, 2.05, 2.12, zf - 0.15, zf + 0.15, C.plinth); fp.push({ x: gx, z: zf, hx: 0.12, hz: 0.12 }); }
    P.ext(gx0 - 0.15, gx1 + 0.15, 1.78, 1.86, zf - 0.07, zf + 0.07, C.steelDark);
    plate(P, S, L, mid, 1.86, zf - 0.075, gx1 - gx0 + 0.3);
    // hazard stripes across the threshold
    for (let i = 0; i < 6; i++) { const x = gx0 + 0.1 + i * ((gx1 - gx0 - 0.2) / 5); Cn.ext(x - 0.06, x + 0.06, 0.1, 0.108, zf - 0.04, zf + 0.34, i % 2 ? C.dark : C.hazard); }
    Cn.ext(gx0, gx1, 0, 0.05, zf - 0.3, zf + 0.0, C.kerb);   // apron step in front of the gate (the slab is 0.1 high)
  }
  // flood light on a pole at (x, z), head facing the yard
  function floodLight(P, L, fp, x, z, h, y0) {
    y0 = y0 === undefined ? 0.1 : y0;
    P.cyl(0.04, 0.05, h, 6, x, y0 + h / 2, z, { c: C.pole });
    P.ext(x - 0.17, x + 0.17, y0 + h, y0 + h + 0.07, z - 0.09, z + 0.09, C.dark);
    L.ext(x - 0.15, x + 0.15, y0 + h - 0.03, y0 + h + 0.0, z - 0.1, z + 0.1, undefined);
    fp.push({ x, z, r: 0.1 });
  }
  // construction of ONE module: formwork slab, 4 corner posts + top frame, 3 cones, a few boards. (x0..x1, z0..z1) = the future module's footprint
  function formwork(S, P, fp, x0, x1, z0, z1) {
    P.ext(x0, x1, 0.1, 0.17, z0, z1, 0x7f7c74);
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) S.ext(x - 0.04, x + 0.04, 0.1, 1.15, z - 0.04, z + 0.04, C.orange);
    S.ext(x0 - 0.02, x1 + 0.02, 1.1, 1.15, z0 - 0.02, z0 + 0.02, C.orange); S.ext(x0 - 0.02, x1 + 0.02, 1.1, 1.15, z1 - 0.02, z1 + 0.02, C.orange);
    S.ext(x0 - 0.02, x0 + 0.02, 1.1, 1.15, z0, z1, C.orange); S.ext(x1 - 0.02, x1 + 0.02, 1.1, 1.15, z0, z1, C.orange);
    S.ext(x0 - 0.02, x1 + 0.02, 0.62, 0.66, z0 - 0.02, z0 + 0.02, C.wood);
    const cx = (x0 + x1) / 2;
    for (const dx of [-0.55, 0, 0.55]) { P.cone(0.1, 0.36, 8, cx + dx, 0.1, z0 - 0.35, { c: C.cone }); S.cyl(0.075, 0.09, 0.05, 8, cx + dx, 0.31, z0 - 0.35, { c: C.white }); }
  }
  // a small mobile crane (separate mesh, swings about its mast): mast + jib + counterweight + hook line
  function craneMesh(x, z) {
    const K = batch(true);
    K.ext(-0.25, 0.25, 0, 0.16, -0.25, 0.25, C.steelDark);
    K.ext(-0.08, 0.08, 0.16, 2.6, -0.08, 0.08, C.hazard);
    K.ext(-0.45, 1.9, 2.55, 2.65, -0.06, 0.06, C.hazard);
    K.seg([0.0, 2.6, 0], [1.2, 2.58, 0], 0.03, C.hazard);
    K.ext(-0.55, -0.25, 2.5, 2.7, -0.12, 0.12, C.dark);
    K.ext(1.78, 1.82, 1.4, 2.55, -0.01, 0.01, C.dark);
    K.ext(1.7, 1.9, 1.3, 1.42, -0.06, 0.06, C.dark);
    const m = K.toMesh(mats().soft, { cast: false, name: 'v161InfraCrane', soft: true });
    m.position.set(x, 0.1, z);
    return m;
  }

  // ---------------------------------------------------------------------------------------------- gabled hall (walls into the concrete batch, roof into the roof batch)
  // centred (cx, cz), size w (x) x d (z), wall height h above the slab (0.1), roof ridge along x. Door and windows on the -z face. Returns {top}.
  function hall(K, cfg) {
    const { Cn, R, P, G, fp, cx, cz, w, d, h, wallC, roofC, doorX, trim, windows, ridge } = cfg, dw = cfg.doorW || 0.3, dh = cfg.doorH || 0.98, doorC = cfg.doorC || 0x4a5560;
    const y0 = 0.1, y1 = y0 + h, hw = d / 2, ovh = 0.14, tn = ridge || 0.42;
    Cn.ext(cx - w / 2 - 0.05, cx + w / 2 + 0.05, y0, y0 + 0.14, cz - hw - 0.05, cz + hw + 0.05, C.plinth);
    Cn.ext(cx - w / 2, cx + w / 2, y0, y1, cz - hw, cz + hw, wallC);
    // gable triangles (x ends)
    for (const sx of [-1, 1]) {
      const xe = cx + sx * (w / 2), n = [sx, 0, 0];
      const a = [xe, y1, cz - hw], b = [xe, y1, cz + hw], c = [xe, y1 + hw * tn, cz];
      if (sx > 0) Cn.tri(a, c, b, n, wallC); else Cn.tri(a, b, c, n, wallC);
    }
    // roof planes + soffit
    const ye = y1 - ovh * tn, yr = y1 + hw * tn, hz = hw + ovh, xa = cx - w / 2 - ovh, xb = cx + w / 2 + ovh, ss = Math.hypot(1, tn);
    R.quad([xa, ye, cz + hz], [xb, ye, cz + hz], [xb, yr, cz], [xa, yr, cz], [0, tn / ss, 1 / ss], roofC);
    R.quad([xa, yr, cz], [xb, yr, cz], [xb, ye, cz - hz], [xa, ye, cz - hz], [0, tn / ss, -1 / ss], roofC);
    R.quad([xa, ye, cz - hz], [xb, ye, cz - hz], [xb, ye, cz + hz], [xa, ye, cz + hz], [0, -1, 0], roofC);
    P.ext(xa, xb, yr - 0.02, yr + 0.05, cz - 0.05, cz + 0.05, C.dark);
    // door + frame + step on the -z face
    const zf = cz - hw;
    P.ext(doorX - dw, doorX + dw, y0, y0 + dh, zf - 0.04, zf, trim);
    P.ext(doorX - dw + 0.05, doorX + dw - 0.05, y0, y0 + dh - 0.06, zf - 0.07, zf - 0.04, doorC);
    P.ext(doorX - dw - 0.02, doorX + dw + 0.02, y0, y0 + 0.04, zf - 0.34, zf - 0.07, C.plinth);
    P.ext(doorX - dw - 0.04, doorX + dw + 0.04, y0 + dh + 0.02, y0 + dh + 0.07, zf - 0.24, zf, C.dark);
    for (const wx of windows) {
      P.ext(wx - 0.27, wx + 0.27, y0 + 0.5, y0 + 0.98, zf - 0.04, zf, trim);
      G.ext(wx - 0.22, wx + 0.22, y0 + 0.55, y0 + 0.93, zf - 0.055, zf - 0.04, undefined);
    }
    fp.push({ x: cx, z: cz, hx: w / 2 + 0.05, hz: hw + 0.05 });   // walls + plinth rim
    return { top: yr, zf };
  }

  // ---------------------------------------------------------------------------------------------- bolt / droplet plates (gate gantry)
  function boltPlate(P, S, L, x, yb, zf, wide) {
    const w = Math.min(wide, 1.7), h = 0.52, z = zf - 0.01;
    P.ext(x - w / 2, x + w / 2, yb + 0.02, yb + 0.02 + h, zf - 0.03, zf, C.dark);
    P.ext(x - w / 2 + 0.04, x + w / 2 - 0.04, yb + 0.06, yb - 0.02 + h, z - 0.02, z, C.hazard);
    // the bolt: three bars
    const bx = x - w / 2 + 0.28;
    S.seg([bx + 0.1, yb + h - 0.06, z - 0.03], [bx - 0.05, yb + h * 0.5, z - 0.03], 0.05, C.dark);
    S.seg([bx - 0.07, yb + h * 0.5, z - 0.03], [bx + 0.1, yb + h * 0.5 - 0.0, z - 0.03], 0.05, C.dark);
    S.seg([bx + 0.1, yb + h * 0.5, z - 0.03], [bx - 0.04, yb + 0.09, z - 0.03], 0.05, C.dark);
    for (let i = 0; i < 4; i++) P.ext(x + 0.0 + i * 0.2 - 0.04, x + i * 0.2 + 0.08, yb + 0.1, yb + h - 0.1, z - 0.03, z - 0.02, i % 2 ? C.dark : C.hazard);
  }
  function dropPlate(P, S, L, x, yb, zf, wide) {
    const w = Math.min(wide, 1.7), h = 0.52, z = zf - 0.01;
    P.ext(x - w / 2, x + w / 2, yb + 0.02, yb + 0.02 + h, zf - 0.03, zf, C.dark);
    P.ext(x - w / 2 + 0.04, x + w / 2 - 0.04, yb + 0.06, yb - 0.02 + h, z - 0.02, z, 0x2f7fb8);
    const bx = x - w / 2 + 0.3;
    S.ell(0.1, 0.1, 0.03, bx, yb + h * 0.38, z - 0.04, { c: C.white });
    S.cone(0.09, 0.22, 10, bx, yb + h * 0.38, z - 0.04, { sz: 0.3, c: C.white });
    for (let i = 0; i < 4; i++) P.ext(x + 0.0 + i * 0.2 - 0.04, x + i * 0.2 + 0.08, yb + 0.1, yb + h - 0.1, z - 0.03, z - 0.02, i % 2 ? C.white : 0x8fc8ee);
  }

  // ================================================================================================ POWER PLANT
  const PW = { X: 3.55, Z: 2.85, GX: [-0.9, 0.9] };
  const TR = [{ x: 2.35, z: -1.7 }, { x: 2.35, z: -0.55 }, { x: 2.35, z: 0.6 }];
  const HALL = { cx: -1.9, cz: 1.85, w: 2.8, d: 1.5, h: 1.3 };
  const SHED = { x0: 0.4, x1: 3.3, z0: 1.5, z1: 2.7, h: 1.05 };
  const STACKS = [{ x: -0.1, z: 1.78 }, { x: -0.1, z: 2.38 }];
  const PYLON = { x: -2.55, z: -0.9 };

  function transformer(P, Cn, S, fp, x, z) {
    Cn.ext(x - 0.62, x + 0.62, 0.1, 0.17, z - 0.52, z + 0.52, C.plinth);
    P.ext(x - 0.46, x + 0.46, 0.17, 0.98, z - 0.34, z + 0.34, 0x7d8f86);
    P.ext(x - 0.49, x + 0.49, 0.9, 0.98, z - 0.37, z + 0.37, 0x6a7a72);
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) P.ext(x + sx * 0.5 - 0.035, x + sx * 0.5 + 0.035, 0.26, 0.9, z - 0.3 + i * 0.2, z - 0.3 + i * 0.2 + 0.05, 0x93a79c);
    P.cyl(0.11, 0.11, 0.62, 10, x - 0.2, 1.1, z + 0.0, { rz: Math.PI / 2, c: 0x6a7a72 });   // conservator
    for (let i = -1; i <= 1; i++) { P.cyl(0.04, 0.06, 0.3, 8, x + 0.22, 1.13, z + i * 0.2, { c: 0xb4724a }); P.cyl(0.03, 0.035, 0.05, 6, x + 0.22, 1.31, z + i * 0.2, { c: C.dark }); }
    fp.push({ x, z, hx: 0.55, hz: 0.42 });
  }
  function lattice(P, S, fp, x, z, H) {
    const b = 0.3, t = 0.1;   // half base / half top
    const leg = (sx, sz) => [[x + sx * b, 0.1, z + sz * b], [x + sx * t, 0.1 + H, z + sz * t]];
    const legs = [leg(-1, -1), leg(1, -1), leg(1, 1), leg(-1, 1)];
    for (const [a, c] of legs) P.seg(a, c, 0.045, C.steel);
    const at = (k, y) => { const f = (y - 0.1) / H, h = b + (t - b) * f; return [[x - h, y, z - h], [x + h, y, z - h], [x + h, y, z + h], [x - h, y, z + h]][k]; };
    for (const y of [0.55, 1.25, 1.95, 2.65]) for (let k = 0; k < 4; k++) P.seg(at(k, y), at((k + 1) % 4, y), 0.03, C.steel);
    for (const [y0, y1] of [[0.1, 0.55], [0.55, 1.25], [1.25, 1.95], [1.95, 2.65]]) for (let k = 0; k < 4; k++) P.seg(at(k, y0), at((k + 1) % 4, y1), 0.025, C.steelDark);
    P.ext(x - 0.22, x + 0.22, 0.1, 0.18, z - 0.22, z + 0.22, C.plinth);
    // cross arms + insulator strings (3 phases on the top arm)
    P.ext(x - 0.04, x + 0.04, H - 0.02, H + 0.06, z - 0.85, z + 0.85, C.steel);
    P.ext(x - 0.04, x + 0.04, H - 0.58, H - 0.5, z - 0.6, z + 0.6, C.steel);
    for (const dz of [-0.8, 0, 0.8]) { for (let j = 0; j < 4; j++) P.cyl(0.045, 0.045, 0.06, 8, x, H - 0.1 - j * 0.085, z + dz, { c: 0xd9c9a8 }); }
    P.cone(0.05, 0.16, 6, x, H + 0.06, z, { c: C.steel });
    fp.push({ x, z, hx: 0.34, hz: 0.34 });
  }
  function stack(P, fp, x, z, ph) {
    P.cyl(0.3, 0.3, 0.12, 12, x, 0.16, z, { c: C.plinth });
    const hh = 3.0, bands = [C.brick, C.white, C.brick, C.white, C.brick];
    for (let i = 0; i < bands.length; i++) { const y0 = 0.22 + i * (hh / bands.length), rb = 0.24 - i * 0.012, rt = 0.24 - (i + 1) * 0.012; P.cyl(rt, rb, hh / bands.length, 12, x, y0 + hh / bands.length / 2, z, { c: bands[i] }); }
    P.cyl(0.17, 0.2, 0.1, 12, x, 0.22 + hh + 0.05, z, { c: C.dark });
    fp.push({ x, z, r: 0.26 });
  }


  // ---------------------------------------------------------------------------------------------- rotating parts (separate meshes, own axis)
  // roof ventilator ("whirligig"): core + 8 pitched vanes + cap, axis y
  function ventilatorMesh(r) {
    const K = batch(true);
    K.cyl(r * 0.16, r * 0.16, 0.26, 8, 0, 0.13, 0, { c: C.steel });
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; K.box(r * 0.9, 0.2, 0.022, Math.cos(a) * r * 0.5, 0.15, Math.sin(a) * r * 0.5, { ry: -a, rx: 0.55, c: C.rail }); }
    K.cone(r * 0.4, 0.14, 8, 0, 0.26, 0, { c: C.steelDark });
    const m = K.toMesh(mats().soft, { cast: false, name: 'v161InfraRotor', soft: true });
    m.userData.v161Rotor = { axis: 'y', base: 3.2 };
    return m;
  }
  // paddle aerator across a basin (axis z): axle, two end discs, 6 slats
  function paddleMesh(len) {
    const K = batch(true), R = 0.26;
    K.cyl(0.035, 0.035, len, 8, 0, 0, 0, { rx: Math.PI / 2, c: C.steelDark });
    for (const sz of [-1, 1]) K.cyl(R, R, 0.03, 12, 0, 0, sz * (len / 2 - 0.12), { rx: Math.PI / 2, c: C.steel });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; K.box(0.05, 0.14, len - 0.24, Math.cos(a) * (R - 0.04), Math.sin(a) * (R - 0.04), 0, { rz: a, c: 0xe3eef2 }); }
    const m = K.toMesh(mats().soft, { cast: false, name: 'v161InfraPaddle', soft: true });
    m.userData.v161Rotor = { axis: 'z', base: 1.1 };
    return m;
  }
  const beaconMesh = (x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mats().beacon);
    m.position.set(x, y, z); m.name = 'v161InfraBeacon'; m.userData.v161Soft = true; m.userData.v161Beacon = true; m.castShadow = false;
    return m;
  };

  // ---------------------------------------------------------------------------------------------- assembling a plant
  function assemble(g, B, o) {
    const M = mats(), cast = castOk();
    const add = (m) => { if (m) g.add(m); return m; };
    add(B.Cn.toMesh(M.concrete, { cast: false, name: 'v161InfraConcrete' }));
    add(B.R.toMesh(M.roof, { cast, name: 'v161InfraRoof' }));
    add(B.P.toMesh(M.paint, { cast, name: 'v161InfraPaint' }));
    add(B.S.toMesh(M.soft, { cast: false, name: 'v161InfraSoft', soft: true }));
    add(B.L.toMesh(M.lamp, { cast: false, receive: false, name: 'v161InfraLamp', soft: true }));
    add(B.G.toMesh(M.glass, { cast: false, receive: false, name: 'v161InfraGlass', soft: true }));
    const rotors = [];
    for (const r of o.rotors || []) {
      const m = r.paddle ? paddleMesh(r.len) : ventilatorMesh(r.r); m.position.set(r.x, r.y, r.z); add(m);
      rotors.push({ mesh: m, axis: m.userData.v161Rotor.axis, base: m.userData.v161Rotor.base * (r.k || 1) });
    }
    let crane = null;
    if (o.crane) { crane = craneMesh(o.crane[0], o.crane[1]); add(crane); }
    if (o.beacon) add(beaconMesh(o.beacon[0], o.beacon[1], o.beacon[2]));
    let water = null;
    if (o.water && o.water.length) water = add(waterMesh(o.water));
    g.userData.v161Footprint = B.fp;
    g.userData.v161Plant = { kind: o.kind, level: o.level, pending: !!o.pending, modules: o.modules, mode: o.mode, rotors: rotors.length, water: !!water, crane: !!crane, beacon: !!o.beacon };
    LIVE.push({ group: g, kind: o.kind, rotors, crane, water, mode: o.mode });
    return g;
  }
  const MODE_K = { eco: 0.55, normal: 1, boost: 1.7 };
  const LIVE = [];

  // animated water: a grid per basin, vertices lifted by two travelling waves (the vertex heights are rewritten ~20 times a second, only for plants near the player)
  const WATER_STEP = 0.3;
  function waterMesh(rects) {
    const pos = [], nor = [], uv = [], idx = [], meta = [];
    for (const r of rects) {
      const nx = Math.max(2, Math.round((r.x1 - r.x0) / WATER_STEP)), nz = Math.max(2, Math.round((r.z1 - r.z0) / WATER_STEP)), base = pos.length / 3;
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = r.x0 + (r.x1 - r.x0) * i / nx, z = r.z0 + (r.z1 - r.z0) * j / nz;
        pos.push(x, r.y, z); nor.push(0, 1, 0); uv.push(i / nx, j / nz);
        const edge = Math.min(i, nx - i, j, nz - j) === 0 ? 0 : 1;   // the border stays flat: it meets the basin wall
        meta.push(x, z, r.y, edge);
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeBoundingBox(); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mats().water);
    m.name = 'v161InfraWater'; m.receiveShadow = false; m.castShadow = false; m.userData.v161Soft = true; m.userData.v161WaterMeta = meta;
    return m;
  }
  let _acc = 0, _phase = 0;
  function animate(dt) {
    if (!LIVE.length) return;
    for (let i = LIVE.length - 1; i >= 0; i--) if (!LIVE[i].group.parent) LIVE.splice(i, 1);   // removed / rebuilt plants leave the list (no leak)
    const t = performance.now() * 0.001;
    _acc += dt;
    const doWater = _acc >= 0.05; if (doWater) _acc = 0;
    let near = null; try { near = player.position; } catch (e) { /* not ready */ }
    for (const p of LIVE) {
      const gp = p.group.position;
      if (p.group.visible === false) continue;
      if (near && Math.hypot(near.x - gp.x, near.z - gp.z) > 70) continue;   // out of sight: nothing moves, nothing is rewritten
      const k = MODE_K[p.mode] || 1;
      for (const r of p.rotors) r.mesh.rotation[r.axis] += dt * r.base * k;
      if (p.crane) p.crane.rotation.y = Math.sin(t * 0.6) * 0.55;
      if (p.water && doWater) {
        const meta = p.water.userData.v161WaterMeta, pa = p.water.geometry.attributes.position;
        for (let v = 0, n = pa.count; v < n; v++) {
          const x = meta[v * 4], z = meta[v * 4 + 1], y0 = meta[v * 4 + 2], e = meta[v * 4 + 3];
          pa.setY(v, y0 + e * (0.011 * Math.sin(x * 4.1 + t * 1.7) * Math.cos(z * 3.4 - t * 1.3) + 0.006 * Math.sin((x + z) * 6.3 - t * 2.6)));
        }
        pa.needsUpdate = true; p.water.userData.v161WaterT = t;
      }
    }
    const Mt = mats();
    let night = false; try { night = isNightV40(); } catch (e) { /* layer not ready */ }
    Mt.lamp.emissiveIntensity += ((night ? 1.2 : 0.3) - Mt.lamp.emissiveIntensity) * 0.08;
    Mt.beacon.emissiveIntensity = 1.1 + Math.sin(t * 6) * 0.55;
  }

  // ================================================================================================ POWER PLANT (layout: see the header)
  function buildPower(level, pending, info) {
    info = info || {};
    level = Math.max(0, Math.min(3, level | 0));
    const g = new THREE.Group(); g.name = 'v161PowerPlant';
    g.userData.v161Plant = { kind: 'power', level, pending: !!pending };
    if (level === 0 && !pending) { g.userData.v161Footprint = []; return g; }
    const Cn = batch(true), R = batch(true), P = batch(true), S = batch(true), L = batch(false), G = batch(false), fp = [];
    const X = PW.X, Z = PW.Z, rotors = [];
    Cn.ext(-X, X, 0, 0.1, -Z, Z, C.slab);
    Cn.ext(-0.55, 0.55, 0.1, 0.104, -Z, 0.5, C.path); Cn.ext(-1.5, 0.55, 0.1, 0.104, 0.5, 1.0, C.path);
    fenceRun(S, fp, -X + 0.05, -Z + 0.05, X - 0.05, -Z + 0.05, [X - 0.05 + PW.GX[0], X - 0.05 + PW.GX[1]]);
    fenceRun(S, fp, -X + 0.05, -Z + 0.05, -X + 0.05, Z - 0.05);
    fenceRun(S, fp, X - 0.05, -Z + 0.05, X - 0.05, Z - 0.05);
    fenceRun(S, fp, -X + 0.05, Z - 0.05, X - 0.05, Z - 0.05);
    gateGantry(P, S, L, fp, PW.GX[0], PW.GX[1], -Z + 0.05, boltPlate, Cn);
    floodLight(P, L, fp, -X + 0.3, -Z + 0.35, 2.3); floodLight(P, L, fp, X - 0.3, -Z + 0.35, 2.3);
    const next = pending ? level + 1 : 0;
    let hallTop = 0;
    if (level >= 1) {
      const h = hall(null, { Cn, R, P, G, fp, cx: HALL.cx, cz: HALL.cz, w: HALL.w, d: HALL.d, h: HALL.h, wallC: C.wall, roofC: 0x4d5a68, doorX: HALL.cx + 0.7, trim: C.white, windows: [HALL.cx - 0.9, HALL.cx - 0.15] });
      hallTop = h.top;
      P.ext(HALL.cx + 1.0, HALL.cx + 1.3, 0.1, 0.9, HALL.cz - HALL.d / 2 - 0.02, HALL.cz - HALL.d / 2 + 0.02, 0xa6aab0);       // louvre panel
      rotors.push({ x: HALL.cx - 0.7, y: hallTop + 0.04, z: HALL.cz, r: 0.2 });
      transformer(P, Cn, S, fp, TR[0].x, TR[0].z);
      lattice(P, S, fp, PYLON.x, PYLON.z, 3.4);
      for (let i = 0; i < 3; i++) S.seg([PYLON.x, 3.02, PYLON.z + (i - 1) * 0.8], [TR[0].x + 0.22, 1.34, TR[0].z + (i - 1) * 0.2], 0.022, C.dark);
    }
    if (level >= 2) {
      transformer(P, Cn, S, fp, TR[1].x, TR[1].z);
      for (let i = 0; i < 3; i++) { const z0 = TR[0].z + (i - 1) * 0.2, z1 = TR[1].z + (i - 1) * 0.2; S.seg([TR[0].x + 0.22, 1.34, z0], [TR[0].x + 0.22, 1.62, (z0 + z1) / 2], 0.02, C.dark); S.seg([TR[0].x + 0.22, 1.62, (z0 + z1) / 2], [TR[1].x + 0.22, 1.34, z1], 0.02, C.dark); }
      const sc = (SHED.x0 + SHED.x1) / 2, sw = SHED.x1 - SHED.x0, sd = SHED.z1 - SHED.z0, st = hall(null, { Cn, R, P, G, fp, cx: sc, cz: (SHED.z0 + SHED.z1) / 2, w: sw, d: sd, h: SHED.h, wallC: 0xc5c9c2, roofC: 0x56626f, doorX: sc - 0.8, trim: C.white, windows: [sc + 0.1, sc + 0.9], ridge: 0.22 });
      for (let i = 0; i < 8; i++) P.ext(SHED.x0 + 0.2 + i * 0.35 - 0.03, SHED.x0 + 0.2 + i * 0.35 + 0.03, 0.2, SHED.h + 0.06, SHED.z0 - 0.07, SHED.z0 - 0.04, 0xaeb3ab);   // wall ribs
      for (let i = 0; i < 3; i++) P.ext(SHED.x1 + 0.0, SHED.x1 + 0.03, 0.2, SHED.h + 0.06, SHED.z0 + 0.2 + i * 0.35, SHED.z0 + 0.26 + i * 0.35, 0xaeb3ab);
      rotors.push({ x: sc + 0.3, y: st.top + 0.04, z: (SHED.z0 + SHED.z1) / 2, r: 0.22 });
      stack(P, fp, STACKS[0].x, STACKS[0].z);
    }
    if (level >= 3) {
      transformer(P, Cn, S, fp, TR[2].x, TR[2].z);
      for (let i = 0; i < 3; i++) { const z0 = TR[1].z + (i - 1) * 0.2, z1 = TR[2].z + (i - 1) * 0.2; S.seg([TR[1].x + 0.22, 1.34, z0], [TR[1].x + 0.22, 1.62, (z0 + z1) / 2], 0.02, C.dark); S.seg([TR[1].x + 0.22, 1.62, (z0 + z1) / 2], [TR[2].x + 0.22, 1.34, z1], 0.02, C.dark); }
      stack(P, fp, STACKS[1].x, STACKS[1].z);
    }
    let crane = null;
    if (next) {
      const f = next === 1 ? [HALL.cx - HALL.w / 2, HALL.cx + HALL.w / 2, HALL.cz - HALL.d / 2, HALL.cz + HALL.d / 2]
        : next === 2 ? [SHED.x0, SHED.x1, SHED.z0, SHED.z1] : [TR[2].x - 0.62, TR[2].x + 0.62, TR[2].z - 0.52, TR[2].z + 0.52];
      formwork(S, P, fp, f[0], f[1], f[2], f[3]);
      if (next === 1) formwork(S, P, fp, TR[0].x - 0.62, TR[0].x + 0.62, TR[0].z - 0.52, TR[0].z + 0.52);
      if (next === 2) formwork(S, P, fp, TR[1].x - 0.62, TR[1].x + 0.62, TR[1].z - 0.52, TR[1].z + 0.52);
      crane = [0.15, 0.9]; fp.push({ x: 0.15, z: 0.9, hx: 0.27, hz: 0.27 });
    }
    const ratio = info.ratio == null ? 1 : info.ratio;
    return assemble(g, { Cn, R, P, S, L, G, fp }, { kind: 'power', level, pending, rotors: rotors.map((r) => Object.assign(r, { k: 1 })), crane, mode: info.mode || 'normal', modules: level,
      beacon: level > 0 && ratio < 0.8 ? [HALL.cx + 1.25, hallTop + 0.12, HALL.cz] : null });
  }

  // ================================================================================================ WATER WORKS
  const WW = { X: 3.55, Z: 2.8, GX: [-0.85, 0.85] };
  const PUMP = { cx: -2.45, cz: 1.95, w: 1.9, d: 1.3, h: 1.2 };
  const TANKS = [{ x: 0.95, z: 1.95, r: 0.85, h: 1.45 }, { x: 2.65, z: 1.95, r: 0.72, h: 1.3 }];
  const TOWER = { x: -0.75, z: 1.95 };
  const BASINS = [{ x: -2.0, z: -0.95, w: 2.6, d: 1.5 }, { x: 2.0, z: -0.95, w: 2.6, d: 1.5 }];
  const WATER_Y = 0.42;

  function groundTank(P, Cn, S, fp, t) {
    const { x, z, r, h } = t, y0 = 0.1;
    Cn.cyl(r + 0.07, r + 0.07, 0.12, 18, x, y0 + 0.06, z, { c: C.plinth });
    P.cyl(r, r, h, 18, x, y0 + h / 2, z, { c: 0x6f9fb5 });
    for (const f of [0.34, 0.68]) P.cyl(r + 0.025, r + 0.025, 0.09, 18, x, y0 + h * f, z, { c: C.white });
    P.cyl(r * 0.2, r, 0.28, 18, x, y0 + h + 0.14, z, { c: 0x58798a });
    P.cyl(r * 0.2, r * 0.2, 0.1, 10, x, y0 + h + 0.33, z, { c: C.steelDark });
    P.cyl(r * 0.06, r * 0.06, 0.16, 6, x + r * 0.55, y0 + h + 0.12, z + r * 0.2, { c: C.dark });
    for (const sx of [-0.1, 0.1]) P.ext(x + sx - 0.015, x + sx + 0.015, y0, y0 + h + 0.1, z - r - 0.05, z - r - 0.02, C.rail);   // ladder rails
    for (let k = 0; k < Math.floor((h + 0.1) / 0.22); k++) P.ext(x - 0.1, x + 0.1, y0 + 0.14 + k * 0.22, y0 + 0.17 + k * 0.22, z - r - 0.06, z - r - 0.03, C.rail);
    fp.push({ x, z, r: r + 0.05 });
  }
  function waterTower(P, Cn, S, fp, x, z) {
    const y0 = 0.1, H = 2.4, b = 0.5, t = 0.34;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { Cn.ext(x + sx * b - 0.12, x + sx * b + 0.12, y0, y0 + 0.16, z + sz * b - 0.12, z + sz * b + 0.12, C.plinth); P.seg([x + sx * b, y0 + 0.1, z + sz * b], [x + sx * t, y0 + H, z + sz * t], 0.075, C.steel); }
    const at = (sx, sz, y) => { const f = (y - y0) / H, hh = b + (t - b) * f; return [x + sx * hh, y, z + sz * hh]; };
    for (const y of [0.85, 1.6, 2.4]) for (const [a, c] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) P.seg(at(a[0], a[1], y), at(c[0], c[1], y), 0.045, C.steel);
    for (const [y0b, y1b] of [[0.1, 0.85], [0.85, 1.6], [1.6, 2.4]]) for (const [a, c] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) P.seg(at(a[0], a[1], y0b + (y1b - y0b) * 0), at(c[0], c[1], y1b), 0.03, C.steelDark);
    P.cyl(0.06, 0.06, H, 8, x, y0 + H / 2, z, { c: 0x2f7fb8 });                                           // riser pipe
    P.cyl(0.08, 0.08, 0.16, 8, x, y0 + 0.4, z, { rz: Math.PI / 2, c: C.orange });                          // valve wheel
    const yb = y0 + H + 0.06;
    P.cyl(0.78, 0.3, 0.26, 16, x, yb + 0.13, z, { c: 0x58798a });
    P.cyl(0.78, 0.78, 0.72, 16, x, yb + 0.26 + 0.36, z, { c: 0x6f9fb5 });
    P.cyl(0.8, 0.8, 0.09, 16, x, yb + 0.26 + 0.28, z, { c: C.white });
    P.cyl(0.05, 0.84, 0.42, 16, x, yb + 0.98 + 0.21, z, { c: 0x58798a });
    P.cyl(0.05, 0.05, 0.12, 6, x, yb + 1.45, z, { c: C.dark });
    for (const sx of [-0.1, 0.1]) P.ext(x + sx - 0.015, x + sx + 0.015, y0, yb + 0.95, z - b - 0.05, z - b - 0.02, C.rail);
    fp.push({ x, z, hx: b + 0.05, hz: b + 0.05 });
  }
  function basin(Cn, P, S, fp, bs, water, rotors) {
    const { x, z, w, d } = bs, th = 0.14, top = 0.52;
    Cn.ext(x - w / 2, x + w / 2, 0.1, top, z - d / 2, z - d / 2 + th, 0xb9b6ac); Cn.ext(x - w / 2, x + w / 2, 0.1, top, z + d / 2 - th, z + d / 2, 0xb9b6ac);
    Cn.ext(x - w / 2, x - w / 2 + th, 0.1, top, z - d / 2 + th, z + d / 2 - th, 0xb9b6ac); Cn.ext(x + w / 2 - th, x + w / 2, 0.1, top, z - d / 2 + th, z + d / 2 - th, 0xb9b6ac);
    Cn.ext(x - w / 2 + th, x + w / 2 - th, 0.1, 0.16, z - d / 2 + th, z + d / 2 - th, 0x8f9aa0);                       // basin floor under the water
    P.ext(x - w / 2 - 0.02, x + w / 2 + 0.02, top, top + 0.05, z - d / 2 - 0.02, z - d / 2 + th + 0.02, C.rail);    // coping (front + back)
    P.ext(x - w / 2 - 0.02, x + w / 2 + 0.02, top, top + 0.05, z + d / 2 - th - 0.02, z + d / 2 + 0.02, C.rail);
    water.push({ x0: x - w / 2 + th, x1: x + w / 2 - th, z0: z - d / 2 + th, z1: z + d / 2 - th, y: WATER_Y });
    // aerator bridge: deck across the short axis, two posts, the paddle wheel dips into the water
    P.ext(x - 0.06, x + 0.06, top + 0.05, top + 0.12, z - d / 2, z + d / 2, C.steelDark);
    for (const sz of [-1, 1]) P.ext(x - 0.2, x + 0.2, top + 0.12, top + 0.16, z + sz * (d / 2 - th * 0.5) - 0.06, z + sz * (d / 2 - th * 0.5) + 0.06, C.steelDark);
    rotors.push({ paddle: true, len: d - 2 * th - 0.1, x, y: top + 0.17, z });
    fp.push({ x, z, hx: w / 2, hz: d / 2 });
  }
  function buildWater(level, pending, info) {
    info = info || {};
    level = Math.max(0, Math.min(3, level | 0));
    const g = new THREE.Group(); g.name = 'v161WaterWorks';
    g.userData.v161Plant = { kind: 'water', level, pending: !!pending };
    if (level === 0 && !pending) { g.userData.v161Footprint = []; return g; }
    const Cn = batch(true), R = batch(true), P = batch(true), S = batch(true), L = batch(false), G = batch(false), fp = [], water = [], rotors = [];
    const X = WW.X, Z = WW.Z;
    Cn.ext(-X, X, 0, 0.1, -Z, Z, C.slab);
    Cn.ext(-0.55, 0.55, 0.1, 0.104, -Z, 0.9, C.path);
    fenceRun(S, fp, -X + 0.05, -Z + 0.05, X - 0.05, -Z + 0.05, [X - 0.05 + WW.GX[0], X - 0.05 + WW.GX[1]]);
    fenceRun(S, fp, -X + 0.05, -Z + 0.05, -X + 0.05, Z - 0.05);
    fenceRun(S, fp, X - 0.05, -Z + 0.05, X - 0.05, Z - 0.05);
    fenceRun(S, fp, -X + 0.05, Z - 0.05, X - 0.05, Z - 0.05);
    gateGantry(P, S, L, fp, WW.GX[0], WW.GX[1], -Z + 0.05, dropPlate, Cn);
    floodLight(P, L, fp, -X + 0.3, -Z + 0.35, 2.3); floodLight(P, L, fp, X - 0.3, -Z + 0.35, 2.3);
    const next = pending ? level + 1 : 0;
    let hallTop = 0;
    const pipe = (a, b) => S.seg(a, b, 0.17, 0x3f86b3);
    if (level >= 1) {
      const h = hall(null, { Cn, R, P, G, fp, cx: PUMP.cx, cz: PUMP.cz, w: PUMP.w, d: PUMP.d, h: PUMP.h, wallC: 0xdfe6e6, roofC: 0x3f6f8f, doorX: PUMP.cx + 0.45, trim: C.white, windows: [PUMP.cx - 0.5] });
      hallTop = h.top;
      rotors.push({ x: PUMP.cx - 0.3, y: hallTop + 0.04, z: PUMP.cz, r: 0.18 });
      groundTank(P, Cn, S, fp, TANKS[0]);
      pipe([PUMP.cx + PUMP.w / 2 - 0.1, 0.42, TANKS[0].z], [TANKS[0].x - TANKS[0].r + 0.1, 0.42, TANKS[0].z]);
    }
    if (level >= 2) {
      groundTank(P, Cn, S, fp, TANKS[1]);
      pipe([TANKS[0].x + TANKS[0].r - 0.1, 0.42, TANKS[0].z], [TANKS[1].x - TANKS[1].r + 0.1, 0.42, TANKS[1].z]);
      basin(Cn, P, S, fp, BASINS[0], water, rotors);
      pipe([PUMP.cx - 0.2, 0.3, PUMP.cz - PUMP.d / 2 + 0.05], [PUMP.cx - 0.2, 0.3, BASINS[0].z + BASINS[0].d / 2 - 0.05]);
    }
    if (level >= 3) {
      waterTower(P, Cn, S, fp, TOWER.x, TOWER.z);
      basin(Cn, P, S, fp, BASINS[1], water, rotors);
      pipe([TANKS[1].x, 0.3, TANKS[1].z - TANKS[1].r + 0.05], [TANKS[1].x, 0.3, BASINS[1].z + BASINS[1].d / 2 - 0.05]);
    }
    let crane = null;
    if (next) {
      const f = next === 1 ? [PUMP.cx - PUMP.w / 2, PUMP.cx + PUMP.w / 2, PUMP.cz - PUMP.d / 2, PUMP.cz + PUMP.d / 2]
        : next === 2 ? [BASINS[0].x - BASINS[0].w / 2, BASINS[0].x + BASINS[0].w / 2, BASINS[0].z - BASINS[0].d / 2, BASINS[0].z + BASINS[0].d / 2]
          : [BASINS[1].x - BASINS[1].w / 2, BASINS[1].x + BASINS[1].w / 2, BASINS[1].z - BASINS[1].d / 2, BASINS[1].z + BASINS[1].d / 2];
      formwork(S, P, fp, f[0], f[1], f[2], f[3]);
      if (next === 1) formwork(S, P, fp, TANKS[0].x - TANKS[0].r, TANKS[0].x + TANKS[0].r, TANKS[0].z - TANKS[0].r, TANKS[0].z + TANKS[0].r);
      if (next === 2) formwork(S, P, fp, TANKS[1].x - TANKS[1].r, TANKS[1].x + TANKS[1].r, TANKS[1].z - TANKS[1].r, TANKS[1].z + TANKS[1].r);
      if (next === 3) formwork(S, P, fp, TOWER.x - 0.55, TOWER.x + 0.55, TOWER.z - 0.55, TOWER.z + 0.55);
      crane = [0.1, 0.55]; fp.push({ x: 0.1, z: 0.55, hx: 0.27, hz: 0.27 });
    }
    const ratio = info.ratio == null ? 1 : info.ratio;
    return assemble(g, { Cn, R, P, S, L, G, fp }, { kind: 'water', level, pending, rotors: rotors.map((r) => Object.assign(r, { k: 1 })), crane, water, mode: info.mode || 'normal', modules: level,
      beacon: level > 0 && ratio < 0.8 ? [PUMP.cx + 0.6, hallTop + 0.12, PUMP.cz] : null });
  }

  // ---------------------------------------------------------------------------------------------- registry hook (tycoon-v161.html rebuildStatic)
  function obstacles() {
    const out = [];
    let groups = [];
    try { const w = window.__TYCOON_V42__.world; groups = [w.power, w.water]; } catch (e) { return out; }
    for (const g of groups) {
      const fp = g && g.userData && g.userData.v161Footprint;
      if (!fp || !fp.length || g.visible === false || !g.parent) continue;
      g.updateMatrixWorld(true);
      fp.forEach((f, i) => {
        const w = new THREE.Vector3(f.x, 0, f.z).applyMatrix4(g.matrixWorld), pos = new THREE.Vector3(w.x, 0, w.z);
        const label = `${g.userData.v161Plant.kind}-plant-v161:${i}`;
        if (f.r) out.push({ owner: g, label, shape: 'circle', pos, radius: f.r });
        else out.push({ owner: g, label, shape: 'obb', pos, hx: f.hx, hz: f.hz, yaw: g.rotation.y });
      });
    }
    return out;
  }

  // generic animated water for other layers (assets/districts-v161.js waterfront): a mesh made by waterMesh(rects) of a group is rippled by animate() while the group stays in the scene
  function addWater(group, rects, mode) { const m = waterMesh(rects); group.add(m); LIVE.push({ group, kind: 'water', rotors: [], crane: null, water: m, mode: mode || 'normal' }); return m; }
  const kit = { batch, mats, C, castOk, hall, lattice, floodLight, fenceRun, addWater, waterMesh, lin, TAU };
  window.InfraV161 = { enabled: true, version: 'v161-infra-plants', buildPower, buildWater, obstacles, animate, mats, kit, live: LIVE, SPEC: { PW, WW, HALL, SHED, TR, STACKS, PYLON, PUMP, TANKS, TOWER, BASINS } };
})();
