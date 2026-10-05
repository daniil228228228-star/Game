/* Buildings v161 (2026-10-05 (4), "improve physics and design of every building, one at a time"): FIRST FAMILY = houses.
 *
 * buildHouseV161(stage, height, baseSize, level) is the live builder of the `house` archetype (createBuildingMesh in tycoon-v161.html calls it instead of the
 * old buildHouse + the three shared polish passes; v44 micro details and finish-v157 are skipped by the flags set below). Differences to the old house:
 *   - design: cream siding on a concrete plinth, gabled terracotta roof with eaves, fascia, rake boards and a ridge cap, framed door with a hood/balcony,
 *     stoop + step, framed windows with sills (+ shutters, flower boxes from level 2), brick chimney, lamp/mailbox, hedges (3+), garage wing (4+), bay window,
 *     side dormers and a picket fence with a gate (5). The silhouette grows by ADDING parts, not by stretching the walls (the old L5 house was a 4.1 m tower).
 *   - cost: every part is merged into one mesh per material (about a dozen draw calls instead of 99-142), materials are shared and never disposed, geometry
 *     has no coplanar overlaps.
 *   - physics: `userData.v161Footprint` lists the oriented wall boxes (local x, z, hx, hz); the v83 collision registry (registerRoot) turns them into real
 *     player/agent colliders and keeps the old whole-mesh box only for placement/camera, so porch, steps, hedges, fence and mailbox are walkable.
 *   - gold tiers 6..10 (BuildingsV161.addHouseGold, called by assets/late-game-v161.js): gold ridge cap + knob (6), sills + door frame (7), eaves/rake trim +
 *     porch posts (8), spire (9), crown on the ridge (10).
 * `BuildingsV161.enabled = false` brings the old house back (the showcase tool uses it for before/after numbers).
 */
(() => {
  'use strict';
  const V3 = THREE.Vector3;
  const M4 = THREE.Matrix4;
  const _t = new M4(), _r = new M4(), _s = new M4(), _m = new M4(), _e = new THREE.Euler(), _v = new V3(), _n = new V3(), _a = new V3(), _b = new V3(), _c = new V3();

  // ------------------------------------------------------------------------------------------------ batches (merged geometry)
  const FACES = [
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  ];
  const UVQ = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const batch = (vc = false) => ({ pos: [], nor: [], uv: [], col: [], idx: [], vc });
  // colours are authored as sRGB hex; the game renders with sRGBEncoding + ACES, so material / vertex colours go in as linear values (a raw hex looks washed out)
const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const rgb = (hex) => { const c = lin(hex); return [c.r, c.g, c.b]; };

  // context: P0 = uniform scale baked into every vertex (stage size), P = current parent transform (a Matrix4)
  function makeCtx(k) {
    const ctx = { P0: new M4().makeScale(k, k, k), P: new M4(), k };
    ctx.at = (x, y, z, ry = 0, fn) => { // run fn with a parent frame T(x,y,z) * Ry(ry)
      const saved = ctx.P; ctx.P = new M4().copy(saved).multiply(_t.makeTranslation(x, y, z)).multiply(_r.makeRotationY(ry)); fn(); ctx.P = saved;
    };
    return ctx;
  }
  function pushVert(bt, ctx, M, px, py, pz, nx, ny, nz, u, v, color) {
    _v.set(px, py, pz).applyMatrix4(M);
    bt.pos.push(_v.x, _v.y, _v.z);
    _n.set(nx, ny, nz).transformDirection(M);
    bt.nor.push(_n.x, _n.y, _n.z);
    bt.uv.push(u, v);
    if (bt.vc) bt.col.push(color[0], color[1], color[2]);
  }
  // box centred at (cx,cy,cz), size w,h,d, optional Euler rotation (rx,ry,rz) about its own centre; skip = face indices not emitted
  function box(bt, ctx, cx, cy, cz, w, h, d, o = {}) {
    const color = bt.vc ? rgb(o.color ?? 0xffffff) : null;
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
    _m.copy(ctx.P0).multiply(ctx.P).multiply(_t.makeTranslation(cx, cy, cz)).multiply(_r.makeRotationFromEuler(_e)).multiply(_s.makeScale(w / 2, h / 2, d / 2));
    const M = new M4().copy(_m);
    // normals: rotation only (the scale is per-axis on axis-aligned faces)
    const N = new M4().copy(ctx.P0).multiply(ctx.P).multiply(_r.makeRotationFromEuler(_e));
    for (let f = 0; f < 6; f++) {
      if (o.skip && o.skip.includes(f)) continue;
      const F = FACES[f], base = bt.pos.length / 3;
      for (let i = 0; i < 4; i++) {
        const q = F.v[i];
        _v.set(q[0], q[1], q[2]).applyMatrix4(M);
        bt.pos.push(_v.x, _v.y, _v.z);
        _n.set(F.n[0], F.n[1], F.n[2]).transformDirection(N);
        bt.nor.push(_n.x, _n.y, _n.z);
        bt.uv.push(UVQ[i][0], UVQ[i][1]);
        if (bt.vc) bt.col.push(color[0], color[1], color[2]);
      }
      bt.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // triangle (a,b,c given in the current frame), flat normal from the winding (counter-clockwise seen from outside)
  function tri(bt, ctx, a, b, c, o = {}) {
    const color = bt.vc ? rgb(o.color ?? 0xffffff) : null;
    _m.copy(ctx.P0).multiply(ctx.P);
    const base = bt.pos.length / 3;
    _a.set(a[0], a[1], a[2]).applyMatrix4(_m); _b.set(b[0], b[1], b[2]).applyMatrix4(_m); _c.set(c[0], c[1], c[2]).applyMatrix4(_m);
    _n.subVectors(_b, _a).cross(_v.subVectors(_c, _a)).normalize();
    for (const p of [_a, _b, _c]) { bt.pos.push(p.x, p.y, p.z); bt.nor.push(_n.x, _n.y, _n.z); bt.uv.push(0, 0); if (bt.vc) bt.col.push(color[0], color[1], color[2]); }
    bt.idx.push(base, base + 1, base + 2);
  }
  const quad = (bt, ctx, a, b, c, d, o) => { tri(bt, ctx, a, b, c, o); tri(bt, ctx, a, c, d, o); };
  // cone / cylinder-ish spike: n-sided pyramid with apex above the centre (y up), base radius r
  function cone(bt, ctx, cx, cy, cz, r, h, n = 6, o = {}) {
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
      tri(bt, ctx, [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r], [cx, cy + h, cz], [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r], o);
    }
  }
  // low-poly blob (hedge / bush / flower): icosahedron scaled to (sx,sy,sz)
  const ICO = {};
  function blob(bt, ctx, cx, cy, cz, sx, sy, sz, detail, o = {}) {
    const key = detail; let g = ICO[key]; if (!g) { g = new THREE.IcosahedronGeometry(1, detail).toNonIndexed(); ICO[key] = g; }
    const p = g.attributes.position, color = bt.vc ? rgb(o.color ?? 0xffffff) : null;
    _m.copy(ctx.P0).multiply(ctx.P).multiply(_t.makeTranslation(cx, cy, cz)).multiply(_s.makeScale(sx, sy, sz));
    for (let i = 0; i < p.count; i += 3) {
      const base = bt.pos.length / 3;
      _a.fromBufferAttribute(p, i).applyMatrix4(_m); _b.fromBufferAttribute(p, i + 1).applyMatrix4(_m); _c.fromBufferAttribute(p, i + 2).applyMatrix4(_m);
      _n.subVectors(_b, _a).cross(_v.subVectors(_c, _a)).normalize();
      for (const q of [_a, _b, _c]) { bt.pos.push(q.x, q.y, q.z); bt.nor.push(_n.x, _n.y, _n.z); bt.uv.push(0, 0); if (bt.vc) bt.col.push(color[0], color[1], color[2]); }
      bt.idx.push(base, base + 1, base + 2);
    }
  }
  // gable roof prism, ridge along z: wall half width hw0, overhang ovh, wall top yw, slope tan, half depth hd (incl. overhang); roof planes only (no end faces)
  function roofPlanes(bt, ctx, hw0, ovh, yw, tn, hd, o) {
    const hw = hw0 + ovh, ye = yw - ovh * tn, yr = yw + hw0 * tn;
    const A = [-hw, ye, hd], B = [hw, ye, hd], C = [hw, ye, -hd], D = [-hw, ye, -hd], R1 = [0, yr, hd], R2 = [0, yr, -hd];
    quad(bt, ctx, B, C, R2, R1, o);      // +x slope
    quad(bt, ctx, A, R1, R2, D, o);      // -x slope
    // soffit (underside), so the eaves are not see-through from a low camera
    quad(bt, ctx, D, C, B, A, o);
    return { hw, ye, yr };
  }

  // ------------------------------------------------------------------------------------------------ materials (shared, never disposed)
  let MATS = null;
  function mats() {
    if (MATS) return MATS;
    const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    const fam = (family, color, opts) => share(createSurfaceMaterialV152(family, lin(color), opts));
    MATS = {
      siding: [fam('siding', 0xf2e4bc, { roughness: 0.9 }), fam('siding', 0xeedfb6, { roughness: 0.9 })],
      roof: [fam('roof', 0xc24d32, { roughness: 0.88, side: THREE.DoubleSide }), fam('roof', 0xaa3f2b, { roughness: 0.88, side: THREE.DoubleSide })],
      trim: fam('concrete', 0xfbf7ee, { roughness: 0.85 }),
      plinth: fam('concrete', 0xbab1a3, { roughness: 0.95 }),
      brick: fam('brick', 0xd0603f, { roughness: 0.9 }),
      wood: fam('wood', 0xa8743f, { roughness: 0.88 }),
      door: fam('wood', 0x7d4528, { roughness: 0.8 }),
      corr: fam('corrugated', 0xf2efe6, { roughness: 0.6, metalness: 0.1 }),
      detail: share(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04 })),
      glass: share(new THREE.MeshStandardMaterial({ color: lin(0x9ccbe6), emissive: lin(0x1b3a52), emissiveIntensity: 0.3, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.82, depthWrite: false })),
      lamp: share(new THREE.MeshStandardMaterial({ color: lin(0xffe3a6), emissive: lin(0xffa93a), emissiveIntensity: 0.9, roughness: 0.4 })),
      gold: share(new THREE.MeshStandardMaterial({ color: lin(0xf2b522), metalness: 0.45, roughness: 0.32, emissive: lin(0x8a5200), emissiveIntensity: 0.5 })),
    };
    return MATS;
  }

  function toMesh(bt, material, o = {}) {
    if (!bt.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bt.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bt.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(bt.uv, 2));
    if (bt.vc) g.setAttribute('color', new THREE.Float32BufferAttribute(bt.col, 3));
    g.setIndex(bt.idx);
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = !!o.cast; m.receiveShadow = o.receive !== false;
    if (o.soft) m.userData.v161Soft = true;
    if (o.name) m.name = o.name;
    m.updateMatrix(); m.matrixAutoUpdate = false;
    return m;
  }

  // ------------------------------------------------------------------------------------------------ the house
  const DARK = 0x3b4350;
  function houseDims(L) {
    const two = L >= 3;
    const W = two ? 2.3 : 2.0, D = 1.8, st = 1.45, y0 = 0.22, n = two ? 2 : 1;
    return { W, D, st, y0, n, H: st * n, tn: 0.78, ovh: 0.26, ovhZ: 0.3 };
  }

  function buildHouseV161(stage, height, baseSize, level = 1) {
    const L = Math.max(1, Math.min(5, Math.floor(level) || 1));
    const k = (baseSize || 2.2) / 2.2;
    const M = mats();
    const idx = typeof STAGES !== 'undefined' ? STAGES.indexOf(stage) : -1;
    const alt = idx === 1 ? 1 : 0;
    const dm = houseDims(L), { W, D, st, y0, n, H, tn, ovh, ovhZ } = dm;
    const hw0 = W / 2, hd0 = D / 2, yw = y0 + H, zf = hd0;
    const ctx = makeCtx(k);

    // which side is the upgrade pad on (local x sign)? Garage / bay go to the other side so the pad stays reachable
    let padSide = 1;
    try {
      if (idx >= 0) {
        const axis = stageAccessAxisV92(idx), yaw = Math.atan2(-axis.x, -axis.z);
        const dir = stagePosition(idx).normalize(), tang = { x: -dir.z, z: dir.x };
        padSide = (tang.x * Math.cos(yaw) + tang.z * -Math.sin(yaw)) >= 0 ? 1 : -1;
      }
    } catch (_) { /* detached stage object */ }
    const gs = -padSide; // garage side

    const bSid = batch(), bTrim = batch(), bRoof = batch(), bPlin = batch(), bBrick = batch(), bWood = batch(), bCorr = batch(), bDet = batch(true), bGlass = batch(), bLamp = batch();
    const dims = { W, D, yw, zf, k, level: L, sills: [], padSide, gs, posts: [] };
    const footprint = [{ x: 0, z: 0, hx: hw0 + 0.05, hz: hd0 + 0.05 }];

    // ---- plinth + walls
    box(bPlin, ctx, 0, 0.11, 0, W + 0.12, 0.22, D + 0.12);
    box(bSid, ctx, 0, y0 - 0.02 + (H + 0.02) / 2, 0, W - 0.06, H + 0.02, D);   // 3 cm narrower than the gable triangles: its top edge stays under the roof plane (no flicker line)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(bTrim, ctx, sx * (hw0 - 0.01), y0 + (H - 0.06) / 2, sz * (hd0 - 0.01), 0.1, H - 0.06, 0.1);          // corner boards
    if (n > 1) { box(bTrim, ctx, 0, y0 + st, 0, W + 0.07, 0.07, D + 0.07); }                                                                      // belt board between the storeys

    // ---- roof (front gable, ridge along z): planes + gable triangles in siding + fascia + rake boards + ridge cap
    const ridge = roofPlanes(bRoof, ctx, hw0, ovh, yw, tn, hd0 + ovhZ, {});
    // gable triangles sit 1.2 cm under the roof planes (an edge exactly on the plane draws a thin z-fight line)
    tri(bSid, ctx, [-hw0, yw - 0.012, zf], [hw0, yw - 0.012, zf], [0, ridge.yr - 0.012, zf]);
    tri(bSid, ctx, [hw0, yw - 0.012, -zf], [-hw0, yw - 0.012, -zf], [0, ridge.yr - 0.012, -zf]);
    const slopeLen = Math.hypot(ridge.hw, ridge.yr - ridge.ye), th = Math.atan2(ridge.yr - ridge.ye, ridge.hw);
    for (const sx of [-1, 1]) {
      box(bTrim, ctx, sx * ridge.hw, ridge.ye - 0.03, 0, 0.045, 0.1, 2 * (hd0 + ovhZ) + 0.02);                                                    // eaves fascia
      for (const sz of [-1, 1]) box(bTrim, ctx, sx * ridge.hw / 2, (ridge.ye + ridge.yr) / 2 + 0.045, sz * (hd0 + ovhZ), slopeLen + 0.04, 0.09, 0.05, { rz: -sx * th }); // rake boards
    }
    box(bDet, ctx, 0, ridge.yr + 0.04, 0, 0.13, 0.08, 2 * (hd0 + ovhZ) + 0.06, { color: alt ? 0x6f2418 : 0x7d2b1c });                                // ridge cap
    for (const sx of [-1, 1]) box(bDet, ctx, sx * ridge.hw, ridge.ye - 0.1, 0, 0.07, 0.07, 2 * (hd0 + ovhZ) - 0.1, { color: 0x6c747d });            // gutters

    // ---- door + frame + stoop
    const doorH = 1.1, doorW = 0.5, doorX = 0;
    box(bTrim, ctx, doorX - doorW / 2 - 0.045, y0 + doorH / 2 + 0.03, zf + 0.025, 0.07, doorH + 0.06, 0.05);
    box(bTrim, ctx, doorX + doorW / 2 + 0.045, y0 + doorH / 2 + 0.03, zf + 0.025, 0.07, doorH + 0.06, 0.05);
    box(bTrim, ctx, doorX, y0 + doorH + 0.07, zf + 0.03, doorW + 0.2, 0.09, 0.07);
    box(bPlin, ctx, 0, 0.11, zf + 0.22, 1.0, 0.22, 0.44);                                                    // stoop: top at the door sill level (0.22)
    box(bPlin, ctx, 0, 0.055, zf + 0.54, 1.1, 0.11, 0.22);                                                   // one step
    // door hood (levels 1-2) / balcony over the porch (3+)
    if (L < 3) {
      box(bRoof, ctx, 0, y0 + doorH + 0.25, zf + 0.3, 1.1, 0.05, 0.62, { rx: 0.28 });
      for (const sx of [-1, 1]) box(bTrim, ctx, sx * 0.44, y0 + doorH + 0.12, zf + 0.12, 0.05, 0.05, 0.3, { rx: -0.5 });
    } else {
      const by = y0 + st;                                                                                      // balcony floor = second storey floor
      box(bWood, ctx, 0, by - 0.03, zf + 0.34, 1.5, 0.07, 0.68);
      for (const sx of [-1, 1]) { box(bTrim, ctx, sx * 0.68, y0 + st / 2 + 0.02, zf + 0.6, 0.08, st - 0.08, 0.08); dims.posts.push([sx * 0.68, y0 + st / 2 + 0.02, zf + 0.6, st - 0.08]); }
      box(bTrim, ctx, 0, by + 0.42, zf + 0.68, 1.5, 0.05, 0.05);                                               // balcony rails
      for (const sx of [-1, 1]) box(bTrim, ctx, sx * 0.75, by + 0.42, zf + 0.34, 0.05, 0.05, 0.68);
      for (let i = -3; i <= 3; i++) box(bTrim, ctx, i * 0.23, by + 0.2, zf + 0.68, 0.03, 0.4, 0.03);
      box(bGlass, ctx, 0, by + 0.5, zf + 0.012, 0.48, 0.9, 0.02);                                              // balcony door
      box(bTrim, ctx, 0, by + 0.5, zf + 0.025, 0.04, 0.9, 0.03);
      box(bTrim, ctx, 0, by + 0.97, zf + 0.03, 0.7, 0.07, 0.05);
    }

    // ---- windows (frame, muntins, glass, sill) in the frame T(x,y,z)*Ry(ry); z is outwards
    const win = (x, y, z, ry, w, h, o2 = {}) => {
      ctx.at(x, y, z, ry, () => {
        box(bTrim, ctx, 0, h / 2 + 0.03, 0.02, w + 0.14, 0.06, 0.05); box(bTrim, ctx, 0, -h / 2 - 0.03, 0.02, w + 0.14, 0.06, 0.05);
        for (const sx of [-1, 1]) box(bTrim, ctx, sx * (w / 2 + 0.035), 0, 0.02, 0.07, h, 0.05);
        box(bTrim, ctx, 0, 0, 0.03, 0.025, h, 0.02); box(bTrim, ctx, 0, 0.0, 0.03, w, 0.025, 0.02);
        box(bGlass, ctx, 0, 0, 0.005, w, h, 0.02);
        box(bTrim, ctx, 0, -h / 2 - 0.075, 0.06, w + 0.2, 0.04, 0.1);                                           // projecting sill
        if (o2.shutters) for (const sx of [-1, 1]) box(bDet, ctx, sx * (w / 2 + 0.17), 0, 0.03, 0.15, h + 0.08, 0.035, { color: o2.shutters });
        if (o2.flowers) {
          box(bDet, ctx, 0, -h / 2 - 0.19, 0.1, w + 0.1, 0.1, 0.14, { color: 0x6b4a2f });
          const cols = [0xe9505a, 0xf6c445, 0xf08ab0, 0xe9505a, 0xffffff];
          for (let i = 0; i < 5; i++) blob(bDet, ctx, (i - 2) * (w + 0.04) / 5.2, -h / 2 - 0.1, 0.1, 0.045, 0.05, 0.045, 0, { color: cols[i] });
          for (let i = 0; i < 4; i++) blob(bDet, ctx, (i - 1.5) * (w + 0.04) / 4.2, -h / 2 - 0.12, 0.1, 0.06, 0.04, 0.05, 0, { color: 0x3f7d3c });
        }
      });
      dims.sills.push({ x, y: y - h / 2 - 0.075, z, ry, w });
    };
    const shut = L >= 2 ? new THREE.Color(stage?.color ?? 0x6fcf6f).multiplyScalar(0.5).getHex() : 0;
    const flw = L >= 2;
    const wy = y0 + 0.82, wy2 = y0 + st + 0.82, wh = 0.46, ww = 0.34, wx = W / 2 - 0.46;
    win(-wx, wy, zf, 0, ww, wh, { shutters: shut, flowers: flw });
    win(wx, wy, zf, 0, ww, wh, { shutters: shut, flowers: flw });
    for (const sx of [-1, 1]) win(sx * (hw0 - 0.03), wy, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, ww, wh, { shutters: shut });
    win(0, wy, -zf, Math.PI, ww, wh);
    if (n > 1) {
      win(-wx, wy2, zf, 0, ww, wh, { shutters: shut });
      win(wx, wy2, zf, 0, ww, wh, { shutters: shut });
      for (const sx of [-1, 1]) for (const z of [-0.35, 0.4]) win(sx * (hw0 - 0.03), wy2, z, sx > 0 ? Math.PI / 2 : -Math.PI / 2, ww, wh);
    }
    if (L >= 2) { // attic window in the front gable
      const ay = yw + 0.28;
      ctx.at(0, ay, zf, 0, () => { box(bTrim, ctx, 0, 0, 0.02, 0.4, 0.4, 0.05); box(bGlass, ctx, 0, 0, 0.05, 0.28, 0.28, 0.02); box(bTrim, ctx, 0, 0, 0.065, 0.025, 0.28, 0.02); box(bTrim, ctx, 0, 0, 0.065, 0.28, 0.025, 0.02); });
    }

    // ---- chimney (brick, with a cap) on the side opposite to the garage
    {
      const cx = -gs * (hw0 - 0.62), cz = -0.35, ys = yw + (hw0 - Math.abs(cx)) * tn, top = ridge.yr + 0.42;
      box(bBrick, ctx, cx, (ys - 0.2 + top) / 2, cz, 0.34, top - ys + 0.2, 0.34);
      box(bPlin, ctx, cx, top + 0.035, cz, 0.44, 0.07, 0.44);
    }

    // ---- lights
    for (const sx of [-1, 1]) { box(bLamp, ctx, sx * 0.5, y0 + 1.0, zf + 0.06, 0.08, 0.11, 0.08); box(bDet, ctx, sx * 0.5, y0 + 1.0, zf + 0.015, 0.05, 0.05, 0.03, { color: DARK }); }

    // ---- level pips next to the door (1..5) so the level reads at a glance
    for (let i = 0; i < L; i++) box(bDet, ctx, 0.52 + i * 0.075, y0 + 0.2, zf + 0.012, 0.05, 0.05, 0.02, { color: 0xe9b64a });

    // ---- garage wing (level 4+) on the side away from the upgrade pad, with a sectional door and a concrete apron
    if (L >= 4) {
      const gw = 1.05, gd = 1.45, gcx = gs * (hw0 + gw / 2 - 0.05), gcz = -0.22, gyw = y0 + 1.25, gzf = gcz + gd / 2;
      box(bPlin, ctx, gcx, 0.11, gcz, gw + 0.1, 0.22, gd + 0.1);
      box(bSid, ctx, gcx, y0 - 0.02 + (1.25 + 0.02) / 2, gcz, gw, 1.27, gd);
      const gh = gw / 2, gtn = 0.62;
      ctx.at(gcx, 0, gcz, 0, () => {
        roofPlanes(bRoof, ctx, gh, 0.2, gyw, gtn, gd / 2 + 0.2, {});
        tri(bSid, ctx, [-gh, gyw - 0.012, gd / 2], [gh, gyw - 0.012, gd / 2], [0, gyw + gh * gtn - 0.012, gd / 2]);
        tri(bSid, ctx, [gh, gyw - 0.012, -gd / 2], [-gh, gyw - 0.012, -gd / 2], [0, gyw + gh * gtn - 0.012, -gd / 2]);
      });
      box(bCorr, ctx, gcx, y0 + 0.5, gzf + 0.02, 0.8, 0.98, 0.04);
      box(bTrim, ctx, gcx, y0 + 1.02, gzf + 0.03, 0.9, 0.07, 0.05);
      for (const sx of [-1, 1]) box(bTrim, ctx, gcx + sx * 0.44, y0 + 0.5, gzf + 0.03, 0.06, 1.0, 0.05);
      box(bPlin, ctx, gcx, 0.02, gzf + 0.42, 0.95, 0.04, 0.8);                                                // apron
      win(gcx, y0 + 0.85, gcz - gd / 2, Math.PI, 0.3, 0.3);
      footprint.push({ x: gcx, z: gcz, hx: gw / 2 + 0.05, hz: gd / 2 + 0.05 });
      dims.garage = { x: gcx, z: gcz, w: gw, d: gd, yw: gyw };
    }

    // ---- bay window (level 5) on the front, opposite to the garage
    if (L >= 5) {
      const bx = -gs * (hw0 - 0.4), bw = 0.7, bd = 0.34, bh = 1.05, bz = zf + bd / 2 - 0.02;   // clear of the door: a player standing on the step is not touching the bay
      box(bPlin, ctx, bx, 0.07, bz, bw + 0.08, 0.14, bd + 0.08);
      box(bSid, ctx, bx, 0.14 + bh / 2, bz, bw, bh, bd);
      box(bRoof, ctx, bx, 0.14 + bh + 0.08, bz, bw + 0.16, 0.05, bd + 0.16, { rx: 0.0 });
      box(bTrim, ctx, bx, 0.14 + bh + 0.03, bz, bw + 0.06, 0.05, bd + 0.06);
      box(bGlass, ctx, bx, 0.14 + bh / 2 + 0.02, bz + bd / 2 + 0.005, bw - 0.16, bh - 0.3, 0.02);
      box(bTrim, ctx, bx, 0.14 + bh / 2 + 0.02, bz + bd / 2 + 0.02, 0.03, bh - 0.3, 0.02);
      for (const sx of [-1, 1]) box(bTrim, ctx, bx + sx * (bw / 2 - 0.06), 0.14 + bh / 2 + 0.02, bz + bd / 2 + 0.02, 0.05, bh - 0.26, 0.04);
      footprint.push({ x: bx, z: bz, hx: bw / 2 + 0.03, hz: bd / 2 + 0.03 });
    }

    // ---- side dormers (level 5), one per slope, small gable roof with the ridge pointing out of the slope
    if (L >= 5) {
      for (const sx of [-1, 1]) {
        const dx = sx * 0.62, dz = 0.12, ys = yw + (hw0 - 0.62) * tn;
        ctx.at(dx, ys - 0.02, dz, sx > 0 ? Math.PI / 2 : -Math.PI / 2, () => {
          box(bSid, ctx, 0, 0.055, 0, 0.5, 0.61, 0.34);
          roofPlanes(bRoof, ctx, 0.25, 0.1, 0.36, 0.7, 0.26, {});
          tri(bSid, ctx, [-0.25, 0.348, 0.17], [0.25, 0.348, 0.17], [0, 0.36 + 0.25 * 0.7 - 0.012, 0.17]);
          box(bTrim, ctx, 0, 0.1, 0.18, 0.32, 0.3, 0.03); box(bGlass, ctx, 0, 0.1, 0.19, 0.24, 0.22, 0.01);
        });
      }
    }

    // ---- yard: lamp post + mailbox (2+), hedges (3+), picket fence with a gate (5)
    if (L >= 2) {
      const lx = -gs * 1.28, lz = zf + 0.62;
      box(bDet, ctx, lx, 0.5, lz, 0.05, 1.0, 0.05, { color: DARK }); box(bDet, ctx, lx, 0.03, lz, 0.16, 0.06, 0.16, { color: DARK });
      box(bLamp, ctx, lx, 1.06, lz, 0.14, 0.14, 0.14); box(bDet, ctx, lx, 1.16, lz, 0.19, 0.04, 0.19, { color: DARK });
      const mx = gs * 1.28, mz = zf + 0.62;
      box(bDet, ctx, mx, 0.3, mz, 0.05, 0.6, 0.05, { color: 0x6a4a2e }); box(bDet, ctx, mx, 0.66, mz, 0.2, 0.14, 0.3, { color: 0x3a5f8f }); box(bDet, ctx, mx + 0.11, 0.72, mz + 0.05, 0.02, 0.1, 0.05, { color: 0xd23b30 });
    }
    if (L >= 3) {
      for (const sx of [-1, 1]) {
        const hx = sx * 0.86;
        blob(bDet, ctx, hx, 0.2, zf + 0.34, 0.3, 0.2, 0.2, 1, { color: 0x4f8a4a });
        blob(bDet, ctx, hx + sx * 0.3, 0.19, zf + 0.34, 0.28, 0.19, 0.2, 1, { color: 0x5e9a52 });
        for (let i = 0; i < 3; i++) blob(bDet, ctx, hx + (i - 1) * 0.16, 0.34, zf + 0.46, 0.04, 0.04, 0.04, 0, { color: [0xf6c445, 0xe9505a, 0xffffff][i] });
      }
    }
    if (L >= 5) {
      const fz = zf + 0.78, ws = 0.8; // gate gap |x| < ws
      for (const sx of [-1, 1]) {
        const x0 = sx * ws, x1 = sx * 1.62, len = Math.abs(x1 - x0), mid = (x0 + x1) / 2;
        box(bDet, ctx, mid, 0.14, fz, len, 0.04, 0.03, { color: 0xf4efe4 }); box(bDet, ctx, mid, 0.34, fz, len, 0.04, 0.03, { color: 0xf4efe4 });
        const cnt = Math.round(len / 0.14);
        for (let i = 0; i <= cnt; i++) box(bDet, ctx, x0 + sx * i * (len / cnt), 0.23, fz, 0.06, 0.42, 0.025, { color: 0xf4efe4 });
        box(bDet, ctx, x1, 0.25, fz, 0.07, 0.5, 0.07, { color: 0xe8dfcf });
      }
      for (const sx of [-1, 1]) box(bDet, ctx, sx * ws, 0.25, fz, 0.07, 0.5, 0.07, { color: 0xe8dfcf });
    }

    // ---- assemble
    const group = new THREE.Group();
    group.name = 'houseV161';
    const add = (m) => { if (m) group.add(m); };
    add(toMesh(bPlin, M.plinth, { cast: false }));
    add(toMesh(bSid, M.siding[alt], { cast: true }));
    add(toMesh(bRoof, M.roof[alt], { cast: true }));
    add(toMesh(bTrim, M.trim, { cast: false }));
    add(toMesh(bBrick, M.brick, { cast: true }));
    add(toMesh(bWood, M.wood, {}));
    add(toMesh(bCorr, M.corr, {}));
    add(toMesh(bDet, M.detail, { soft: true }));
    add(toMesh(bLamp, M.lamp, { soft: true, receive: false }));
    add(toMesh(bGlass, M.glass, { receive: false }));
    const doorMat = M.door;
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW * k, doorH * k, 0.05 * k), doorMat);
    door.position.set(doorX * k, (y0 + doorH / 2) * k, (zf + 0.03) * k);
    door.userData.v161Door = true; // tests/house-door.test.mjs measures door-to-driveway from this mesh
    door.castShadow = false; door.receiveShadow = true;
    door.updateMatrix(); door.matrixAutoUpdate = false;
    group.add(door);
    // knob (gold material from the late-game layer would be a 12th call: reuse the lamp batch instead)
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05 * k, 0.05 * k, 0.04 * k), M.gold);
    knob.position.set((doorX + 0.17) * k, (y0 + 0.55) * k, (zf + 0.065) * k); knob.updateMatrix(); knob.matrixAutoUpdate = false; knob.userData.v161Soft = true; knob.userData.v161Knob = true;
    group.add(knob);

    const ud = group.userData;
    ud.v161House = true; ud.v161Complete = true; ud.v44Detailed = true; ud.v157Finish = true; // skip the shared polish passes and the generic layers
    ud.v161Footprint = footprint.map((f) => ({ x: f.x * k, z: f.z * k, hx: f.hx * k, hz: f.hz * k }));
    ud.v161Dims = dims;
    ud.levelV161 = L;
    return group;
  }

  // ------------------------------------------------------------------------------------------------ neighbourhood mini house (makeMiniHouse in tycoon-v161.html)
  // 4 meshes (siding body + gable ends, roof, vertex-coloured trim/door/chimney, glass) instead of 5; same footprint (collider circle r 0.92 stays), front = +z.
  const MINI = { siding: new Map(), roof: new Map() };
  function buildMiniHouseV161(color = 0xd9b28b, accent = 0x874d3a) {
    const M = mats();
    const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    let ms = MINI.siding.get(color); if (!ms) { ms = share(createSurfaceMaterialV152('siding', lin(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex()), { roughness: 0.9 })); MINI.siding.set(color, ms); }
    let mr = MINI.roof.get(accent); if (!mr) { mr = share(createSurfaceMaterialV152('roof', lin(accent), { roughness: 0.88, side: THREE.DoubleSide })); MINI.roof.set(accent, mr); }
    const ctx = makeCtx(1), bS = batch(), bR = batch(), bD = batch(true), bG = batch();
    const W = 1.5, D = 1.25, y0 = 0.14, H = 0.95, hw0 = W / 2, zf = D / 2, yw = y0 + H, tn = 0.72;
    box(bD, ctx, 0, 0.07, 0, W + 0.1, 0.14, D + 0.1, { color: 0xb9b0a2 });
    box(bS, ctx, 0, y0 - 0.02 + (H + 0.02) / 2, 0, W - 0.04, H + 0.02, D);
    const r = roofPlanes(bR, ctx, hw0, 0.16, yw, tn, zf + 0.16, {});
    tri(bS, ctx, [-hw0, yw - 0.01, zf], [hw0, yw - 0.01, zf], [0, r.yr - 0.01, zf]);
    tri(bS, ctx, [hw0, yw - 0.01, -zf], [-hw0, yw - 0.01, -zf], [0, r.yr - 0.01, -zf]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(bD, ctx, sx * (hw0 - 0.01), y0 + (H - 0.06) / 2, sz * (zf - 0.01), 0.07, H - 0.06, 0.07, { color: 0xfaf6ec });
    for (const sx of [-1, 1]) box(bD, ctx, sx * r.hw, r.ye - 0.03, 0, 0.04, 0.08, 2 * (zf + 0.16), { color: 0xfaf6ec });
    box(bD, ctx, 0, r.yr + 0.03, 0, 0.1, 0.06, 2 * (zf + 0.16) + 0.04, { color: 0x6a2a1c });
    box(bD, ctx, 0, y0 + 0.38, zf + 0.012, 0.3, 0.76, 0.04, { color: 0x6b4a3a });            // door
    box(bD, ctx, 0, y0 + 0.4, zf + 0.002, 0.4, 0.82, 0.02, { color: 0xfaf6ec });             // door frame
    box(bD, ctx, 0, 0.07, zf + 0.2, 0.7, 0.14, 0.3, { color: 0xb9b0a2 });                    // stoop
    for (const sx of [-1, 1]) {
      box(bD, ctx, sx * 0.5, y0 + 0.56, zf + 0.005, 0.38, 0.38, 0.02, { color: 0xfaf6ec });
      box(bG, ctx, sx * 0.5, y0 + 0.56, zf + 0.016, 0.3, 0.3, 0.015);
      box(bD, ctx, sx * 0.5, y0 + 0.56, zf + 0.026, 0.025, 0.3, 0.01, { color: 0xfaf6ec });
      box(bD, ctx, sx * 0.5, y0 + 0.4, zf + 0.04, 0.42, 0.04, 0.07, { color: 0xfaf6ec });     // sill
    }
    { const cy = r.yr - 0.42 * tn; box(bD, ctx, -0.42, (cy - 0.05 + r.yr + 0.2) / 2, -0.25, 0.2, r.yr + 0.25 - cy, 0.2, { color: 0xa8432d }); } // chimney, standing on the slope
    const g = new THREE.Group(); g.name = 'miniHouseV161';
    const add = (m) => { if (m) g.add(m); };
    add(toMesh(bS, ms, { cast: !VISUAL_MOBILE })); add(toMesh(bR, mr, { cast: !VISUAL_MOBILE })); add(toMesh(bD, M.detail, {})); add(toMesh(bG, M.glass, { receive: false }));
    g.userData.v161MiniHouse = true;
    return g;
  }

  // ------------------------------------------------------------------------------------------------ gold tiers 6..10 for the house
  function addHouseGold(group, stage, level) {
    const d = group.userData.v161Dims, M = mats();
    if (!d) return false;
    const k = d.k, ctx = makeCtx(k), bt = batch(), bd = houseDims(5);
    const { W, D, y0, tn, ovh, ovhZ } = bd, hw0 = W / 2, hd0 = D / 2, yw = d.yw, zf = d.zf;
    const yr = yw + hw0 * tn, ye = yw - ovh * tn, hwR = hw0 + ovh;
    // 6: gold ridge cap + a small plaque row (a second row of pips)
    box(bt, ctx, 0, yr + 0.095, 0, 0.17, 0.05, 2 * (hd0 + ovhZ) + 0.1);
    for (let i = 0; i < Math.max(0, level - 5); i++) box(bt, ctx, 0.52 + i * 0.075, y0 + 0.3, zf + 0.012, 0.05, 0.05, 0.02);
    // 7: gold sills + door lintel
    if (level >= 7) {
      for (const s of d.sills) ctx.at(s.x, 0, s.z, s.ry, () => box(bt, ctx, 0, s.y + 0.026, 0.06, s.w + 0.24, 0.022, 0.12));
      box(bt, ctx, 0, y0 + 1.1 + 0.125, zf + 0.04, 0.78, 0.04, 0.09);
    }
    // 8: gold eaves / rake trim + porch posts
    if (level >= 8) {
      const slopeLen = Math.hypot(hwR, yr - ye), th = Math.atan2(yr - ye, hwR);
      for (const sx of [-1, 1]) {
        box(bt, ctx, sx * (hwR + 0.012), ye - 0.07, 0, 0.03, 0.035, 2 * (hd0 + ovhZ) + 0.04);
        for (const sz of [-1, 1]) box(bt, ctx, sx * hwR / 2, (ye + yr) / 2 + 0.105, sz * (hd0 + ovhZ + 0.005), slopeLen + 0.04, 0.03, 0.06, { rz: -sx * th });
      }
      for (const p of d.posts) box(bt, ctx, p[0], p[1], p[2], 0.1, p[3] + 0.02, 0.1);
      for (const sx of [-1, 1]) box(bt, ctx, sx * (0.5 + 0.07), y0 + 0.57, zf + 0.04, 0.03, 1.2, 0.03);
    }
    // 9: spire with a small ball on the rear end of the ridge
    if (level >= 9) {
      box(bt, ctx, 0, yr + 0.5, -hd0 + 0.25, 0.035, 0.9, 0.035);
      cone(bt, ctx, 0, yr + 0.92, -hd0 + 0.25, 0.07, 0.2, 6);
      box(bt, ctx, 0, yr + 0.62, -hd0 + 0.25, 0.3, 0.025, 0.025);
    }
    // 10: the golden crown on the ridge: a block that reaches down into the roof, a rim band, 8 points
    if (level >= 10) {
      const cy = yr;
      box(bt, ctx, 0, cy - 0.02, 0, 0.6, 0.46, 0.6);
      box(bt, ctx, 0, cy + 0.2, 0, 0.7, 0.07, 0.7);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, r = i % 2 ? 0.27 : 0.3;
        cone(bt, ctx, Math.cos(a) * r, cy + 0.235, Math.sin(a) * r, 0.075, i % 2 ? 0.2 : 0.32, 6);
      }
      cone(bt, ctx, 0, cy + 0.235, 0, 0.16, 0.42, 8);
    }
    const mesh = toMesh(bt, M.gold, { cast: true, soft: true, name: 'houseGoldV161' });
    if (mesh) group.add(mesh);
    group.userData.goldTierV161 = level;
    return true;
  }

  // ------------------------------------------------------------------------------------------------ registry hook: footprint boxes -> world oriented boxes
  // returns [{pos:Vector3, hx, hz, yaw}] in world space for a mesh carrying userData.v161Footprint (root yaw only, as createBuildingMesh sets it)
  function footprintWorld(root) {
    const fp = root?.userData?.v161Footprint;
    if (!fp || !fp.length) return null;
    root.updateMatrixWorld(true);
    const yaw = root.rotation ? root.rotation.y : 0, out = [];
    for (const f of fp) {
      const p = new V3(f.x, 0, f.z).applyMatrix4(root.matrixWorld);
      const sx = root.scale ? root.scale.x : 1, sz = root.scale ? root.scale.z : 1;
      out.push({ pos: new V3(p.x, 0, p.z), hx: f.hx * sx, hz: f.hz * sz, yaw });
    }
    return out;
  }

  window.buildHouseV161 = buildHouseV161;
  window.buildMiniHouseV161 = buildMiniHouseV161;
  window.BuildingsV161 = { enabled: true, buildHouse: buildHouseV161, addHouseGold, footprintWorld, mats, version: 'v161-buildings-houses' };
})();
