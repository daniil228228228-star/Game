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
    for (const sx of [-1, 1]) { if (L >= 4 && sx === gs) continue; win(sx * (hw0 - 0.03), wy, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, ww, wh, { shutters: shut }); }   // (no window into the garage)
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

    // ---- garage wing (level 4+) on the side away from the upgrade pad (2026-10-06 (11), user: "Гаражи тонкие ... В них даже не залезет машина"): a real hollow single bay. Inside: 1.9 x 2.75 m, clear height
    // ~1.3 m, door opening 1.8 x 1.15 m (the game's car is 1.4 x 2.14 x 0.66 m: opening >= car + 0.4 m, depth >= car + 0.5 m, height >= car + 0.3 m); thin walls (0.1 m), the sectional door is rolled up under the
    // header so the empty bay shows; walls are separate footprint boxes (back wall, outer wall, inner wall, two front pillars), the interior and the doorway are walkable.
    if (L >= 4) {
      const gw = 2.2, gd = 2.85, gwt = 0.1, gyw = y0 + 1.4, gzf = zf + 0.25, gz1 = gzf, gz0 = gzf - gd, gcz = (gz0 + gz1) / 2, gx0 = hw0, gx1 = hw0 + gw, gcx = gs * (gx0 + gx1) / 2;
      const gxo = gs * (gx1 - gwt / 2), gxi = gs * (gx0 + gwt / 2 + 0.02), wy1 = y0 - 0.02, wh = gyw - wy1, wyc = (wy1 + gyw) / 2, pw = 0.2, doorH = 1.15;
      box(bPlin, ctx, gcx, 0.11, gcz, gw + 0.1, 0.22, gd + 0.1);
      box(bSid, ctx, gcx, wyc, gz0 + gwt / 2, gw, wh, gwt);                                       // back wall
      box(bSid, ctx, gxo, wyc, gcz, gwt, wh, gd);                                                 // outer side wall
      box(bSid, ctx, gxi, wyc, gcz, gwt, wh, gd);                                                 // inner side wall (shared with the house where they meet)
      for (const sx of [0, 1]) { const px = gs * (sx ? gx1 - pw / 2 : gx0 + pw / 2); box(bSid, ctx, px, wyc, gz1 - 0.06, pw, wh, 0.12); box(bTrim, ctx, px, wyc, gz1 + 0.005, pw + 0.04, wh, 0.03); }   // front pillars + trim
      box(bSid, ctx, gcx, y0 + doorH + (gyw - y0 - doorH) / 2, gz1 - 0.06, gw - 2 * pw, gyw - y0 - doorH, 0.12);   // header over the opening
      box(bTrim, ctx, gcx, y0 + doorH + 0.05, gz1 + 0.005, gw - 2 * pw + 0.04, 0.08, 0.03);
      box(bCorr, ctx, gcx, y0 + doorH - 0.07, gz1 - 0.12, gw - 2 * pw - 0.1, 0.12, 0.12);        // the rolled-up sectional door (a coil under the header): the bay is shown open and empty
      for (let q = 0; q < 3; q++) box(bTrim, ctx, gcx, y0 + 0.22 + q * 0.18, gz0 + gwt + 0.01, gw - 2 * gwt - 0.2, 0.025, 0.02);   // inner back wall: three wainscot rails (the bay reads as a room)
      const gh = gw / 2, gtn = 0.55;
      ctx.at(gcx, 0, gcz, 0, () => {
        roofPlanes(bRoof, ctx, gh, 0.2, gyw, gtn, gd / 2 + 0.2, {});
        tri(bSid, ctx, [-gh, gyw - 0.012, gd / 2], [gh, gyw - 0.012, gd / 2], [0, gyw + gh * gtn - 0.012, gd / 2]);
        tri(bSid, ctx, [gh, gyw - 0.012, -gd / 2], [-gh, gyw - 0.012, -gd / 2], [0, gyw + gh * gtn - 0.012, -gd / 2]);
      });
      box(bLamp, ctx, gcx, gyw - 0.17, gcz, 0.3, 0.04, 0.1);                                      // ceiling light inside
      box(bPlin, ctx, gcx, 0.055, gz1 + 0.12, gw - 0.3, 0.11, 0.24);                              // threshold step
      box(bPlin, ctx, gcx, 0.02, gz1 + 0.6, gw - 0.3, 0.04, 0.8);                                 // concrete apron
      win(gcx, y0 + 0.85, gz0, Math.PI, 0.3, 0.3);
      footprint.push({ x: gcx, z: gz0 + gwt / 2, hx: gw / 2 + 0.05, hz: gwt / 2 + 0.06 });
      footprint.push({ x: gxo, z: gcz, hx: gwt / 2 + 0.06, hz: gd / 2 + 0.05 });
      footprint.push({ x: gxi, z: gcz, hx: gwt / 2 + 0.03, hz: gd / 2 + 0.05 });
      for (const sx of [0, 1]) footprint.push({ x: gs * (sx ? gx1 - pw / 2 : gx0 + pw / 2), z: gz1 - 0.05, hx: pw / 2 + 0.03, hz: 0.1 });
      const ix0 = gs > 0 ? gx0 + gwt : -(gx1 - gwt), ix1 = gs > 0 ? gx1 - gwt : -(gx0 + gwt);
      dims.garage = { x: gcx, z: gcz, w: gw, d: gd, yw: gyw, inner: { x0: ix0, x1: ix1, z0: gz0 + gwt, z1: gz1, h: gyw - 0.17 - 0.22 }, door: { w: gw - 2 * pw, h: doorH }, k };
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

  // ------------------------------------------------------------------------------------------------ extra primitives (shared with assets/shop-v161.js through BuildingsV161.kit)
  // vertical n-gon prism / frustum standing on y0 (r0 at the bottom, r1 at the top), optional cap; same winding rules as cone()
  function cyl(bt, ctx, cx, y0, cz, r0, r1, h, n = 8, o = {}) {
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      quad(bt, ctx, [cx + c0 * r0, y0, cz + s0 * r0], [cx + c0 * r1, y0 + h, cz + s0 * r1], [cx + c1 * r1, y0 + h, cz + s1 * r1], [cx + c1 * r0, y0, cz + s1 * r0], o);
      if (o.cap !== false && r1 > 0) tri(bt, ctx, [cx, y0 + h, cz], [cx + c1 * r1, y0 + h, cz + s1 * r1], [cx + c0 * r1, y0 + h, cz + s0 * r1], o);
    }
  }
  // flat horizontal disc / ring at height y (facing up)
  function disc(bt, ctx, cx, cz, r0, r1, y, n = 28, o = {}) {
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      if (r0 <= 0) tri(bt, ctx, [cx, y, cz], [cx + c1 * r1, y, cz + s1 * r1], [cx + c0 * r1, y, cz + s0 * r1], o);
      else quad(bt, ctx, [cx + c0 * r0, y, cz + s0 * r0], [cx + c1 * r0, y, cz + s1 * r0], [cx + c1 * r1, y, cz + s1 * r1], [cx + c0 * r1, y, cz + s0 * r1], o);
    }
  }
  const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f).getHex();

  // ------------------------------------------------------------------------------------------------ neighbourhood mini house (makeMiniHouse in tycoon-v161.html) + the suburb district
  // 2026-10-05 (8), backlog #4: three variants of one small family house in the style of the main house (cream siding, red roofs, framed windows with shutters, picket fence / hedge,
  // mailbox, lamp): 0 = front gable + door hood, 1 = side gable (ridge across the front) + gabled porch, 2 = front gable + flat porch + side shed. Front = +z, centred on the origin.
  // Everything is merged into 5 vertex-coloured batches (siding S, roof R, soft detail D, glass G, lamp L) so a whole district is 5-6 draw calls.
  const MINI_V = [
    { wall: 0xf1e3bd, roof: 0xc24d32, shut: 0x4f7f5a, door: 0x7a3f2a, fence: 0xfaf6ec },
    { wall: 0xe8e1cf, roof: 0x5f7690, shut: 0x2f5f7a, door: 0x33506b, fence: 0xdfe8ee },
    { wall: 0xf3dcab, roof: 0x9a4e33, shut: 0x8a3b2e, door: 0x5e3b2a, fence: 0xfaf6ec },
  ];
  const miniBatches = () => ({ S: batch(true), R: batch(true), D: batch(true), G: batch(), L: batch() });
  // writes one house into the batches in the current ctx frame; returns the wall boxes (local x, z, hx, hz) = the real solid parts
  function miniHouseParts(B, ctx, v, wallC, roofC) {
    const V = MINI_V[v], side = v === 1, TRIM = 0xfaf6ec, PL = 0xb9b0a2, BRICK = 0xa8432d;
    const W = side ? 1.64 : 1.5, D = side ? 1.16 : 1.25, y0 = 0.14, H = side ? 0.9 : 0.95, hw0 = W / 2, zf = D / 2, yw = y0 + H, tn = side ? 0.8 : 0.72, ovh = 0.16;
    const fp = [{ x: 0, z: 0, hx: hw0 + 0.04, hz: zf + 0.04 }];
    const doorX = v === 2 ? -0.3 : 0;
    box(B.D, ctx, 0, y0 / 2, 0, W + 0.1, y0, D + 0.1, { color: PL });                                                  // plinth
    box(B.S, ctx, 0, y0 - 0.02 + (H + 0.02) / 2, 0, W - 0.04, H + 0.02, D, { color: wallC });                          // walls (the solid part)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(B.D, ctx, sx * (hw0 - 0.01), y0 + (H - 0.06) / 2, sz * (zf - 0.01), 0.07, H - 0.06, 0.07, { color: TRIM });
    // ---- roof
    let ridgeY, eaveY, roofHalf;
    const rd = shade(roofC, 0.78);
    if (!side) {
      const r = roofPlanes(B.R, ctx, hw0, ovh, yw, tn, zf + ovh, { color: roofC }); ridgeY = r.yr; eaveY = r.ye; roofHalf = r.hw;
      tri(B.S, ctx, [-hw0, yw - 0.01, zf], [hw0, yw - 0.01, zf], [0, r.yr - 0.01, zf], { color: wallC });
      tri(B.S, ctx, [hw0, yw - 0.01, -zf], [-hw0, yw - 0.01, -zf], [0, r.yr - 0.01, -zf], { color: wallC });
      for (const sx of [-1, 1]) box(B.D, ctx, sx * r.hw, r.ye - 0.03, 0, 0.04, 0.08, 2 * (zf + ovh), { color: TRIM });
      box(B.D, ctx, 0, r.yr + 0.03, 0, 0.1, 0.06, 2 * (zf + ovh) + 0.04, { color: rd });
    } else {
      ctx.at(0, 0, 0, Math.PI / 2, () => {                                                                              // ridge along the wall: frame turned by 90 degrees
        const r = roofPlanes(B.R, ctx, zf, ovh, yw, tn, hw0 + ovh, { color: roofC }); ridgeY = r.yr; eaveY = r.ye; roofHalf = r.hw;
        tri(B.S, ctx, [-zf, yw - 0.01, hw0], [zf, yw - 0.01, hw0], [0, r.yr - 0.01, hw0], { color: wallC });
        tri(B.S, ctx, [zf, yw - 0.01, -hw0], [-zf, yw - 0.01, -hw0], [0, r.yr - 0.01, -hw0], { color: wallC });
        for (const sx of [-1, 1]) box(B.D, ctx, sx * r.hw, r.ye - 0.03, 0, 0.04, 0.08, 2 * (hw0 + ovh), { color: TRIM });
        box(B.D, ctx, 0, r.yr + 0.03, 0, 0.1, 0.06, 2 * (hw0 + ovh) + 0.04, { color: rd });
      });
    }
    // ---- chimney (brick) standing on the slope
    {
      const cx = side ? 0.5 : -0.42, cz = side ? -0.12 : -0.25;
      const ys = side ? yw + (zf - Math.abs(cz)) * tn : yw + (hw0 - Math.abs(cx)) * tn, top = ridgeY + 0.2;
      box(B.D, ctx, cx, (ys - 0.15 + top) / 2, cz, 0.2, top - ys + 0.15, 0.2, { color: BRICK });
      box(B.D, ctx, cx, top + 0.025, cz, 0.27, 0.05, 0.27, { color: TRIM });
    }
    // ---- door, stoop, porch
    box(B.D, ctx, doorX, y0 + 0.4, zf + 0.002, 0.4, 0.82, 0.02, { color: TRIM });                                       // door frame
    box(B.D, ctx, doorX, y0 + 0.38, zf + 0.014, 0.3, 0.76, 0.03, { color: V.door });                                    // door
    box(B.L, ctx, doorX + 0.09, y0 + 0.38, zf + 0.04, 0.03, 0.03, 0.02);                                                // knob (lit batch: no extra material)
    box(B.D, ctx, doorX, 0.07, zf + 0.2, 0.7, 0.14, 0.3, { color: PL });                                                // stoop (top = door sill)
    if (v === 0) {                                                                                                     // hood on two brackets
      box(B.D, ctx, doorX, y0 + 0.97, zf + 0.22, 0.74, 0.04, 0.5, { rx: 0.3, color: roofC });                         // (soft detail batch: a thin tilted slab must not read as a wall)
      for (const sx of [-1, 1]) box(B.D, ctx, doorX + sx * 0.3, y0 + 0.86, zf + 0.1, 0.03, 0.03, 0.22, { rx: -0.5, color: TRIM });
    } else if (v === 1) {                                                                                              // small gabled porch on two posts
      for (const sx of [-1, 1]) box(B.D, ctx, doorX + sx * 0.36, y0 + 0.44, zf + 0.46, 0.05, 0.88, 0.05, { color: TRIM });
      ctx.at(doorX, 0, zf + 0.27, 0, () => {
        roofPlanes(B.R, ctx, 0.44, 0.06, y0 + 0.86, 0.75, 0.3, { color: roofC });
        tri(B.S, ctx, [-0.44, y0 + 0.86 - 0.01, 0.3], [0.44, y0 + 0.86 - 0.01, 0.3], [0, y0 + 0.86 + 0.44 * 0.75 - 0.01, 0.3], { color: wallC });
      });
    } else {                                                                                                           // flat porch roof, posts, rail
      box(B.D, ctx, doorX, y0 + 0.9, zf + 0.3, 0.86, 0.05, 0.62, { color: TRIM });
      for (const sx of [-1, 1]) box(B.D, ctx, doorX + sx * 0.38, y0 + 0.44, zf + 0.56, 0.045, 0.88, 0.045, { color: TRIM });
    }
    // ---- windows (frame plate + glass + muntins + sill + shutters); frame T(x,y,z)*Ry(ry), z outwards
    const win = (x, z, ry, ww, wh, shutters = true) => ctx.at(x, y0 + 0.56, z, ry, () => {
      box(B.D, ctx, 0, 0, 0.005, ww + 0.08, wh + 0.08, 0.02, { color: TRIM });
      box(B.G, ctx, 0, 0, 0.016, ww, wh, 0.015);
      box(B.D, ctx, 0, 0, 0.026, 0.025, wh, 0.01, { color: TRIM }); box(B.D, ctx, 0, 0, 0.026, ww, 0.025, 0.01, { color: TRIM });
      box(B.D, ctx, 0, -wh / 2 - 0.06, 0.035, ww + 0.12, 0.035, 0.07, { color: TRIM });
      if (shutters) for (const sx of [-1, 1]) box(B.D, ctx, sx * (ww / 2 + 0.12), 0, 0.02, 0.1, wh + 0.04, 0.025, { color: V.shut });
    });
    if (v === 0) { win(-0.5, zf, 0, 0.28, 0.32); win(0.5, zf, 0, 0.28, 0.32); }
    else if (v === 1) { win(-0.6, zf, 0, 0.3, 0.32); win(0.6, zf, 0, 0.3, 0.32); }
    else { win(0.36, zf, 0, 0.34, 0.32); }
    if (v !== 2) win(hw0 - 0.028, 0, Math.PI / 2, 0.26, 0.28, false); win(-hw0 + 0.028, 0, -Math.PI / 2, 0.26, 0.28, false);
    // ---- side shed (variant 2): a closed little storeroom with a mono-pitch roof, solid
    if (v === 2) {
      const sx0 = hw0 - 0.04, sw = 0.6, sd = 0.9, scx = sx0 + sw / 2, scz = -0.1, sh = 0.62, sy = y0 - 0.02;
      box(B.D, ctx, scx, y0 / 2, scz, sw + 0.08, y0, sd + 0.08, { color: PL });
      box(B.S, ctx, scx, sy + (sh + 0.02) / 2, scz, sw, sh + 0.02, sd, { color: wallC });
      const yh = y0 + sh + 0.12, yl = y0 + sh - 0.02;
      quad(B.R, ctx, [sx0 - 0.02, yh, scz + sd / 2 + 0.1], [scx + sw / 2 + 0.1, yl, scz + sd / 2 + 0.1], [scx + sw / 2 + 0.1, yl, scz - sd / 2 - 0.1], [sx0 - 0.02, yh, scz - sd / 2 - 0.1], { color: roofC });
      tri(B.S, ctx, [sx0, yh - 0.01, scz + sd / 2], [scx + sw / 2, yl - 0.01, scz + sd / 2], [scx + sw / 2, yh - 0.01, scz + sd / 2], { color: wallC });
      box(B.D, ctx, scx, y0 + 0.28, scz + sd / 2 + 0.005, 0.32, 0.5, 0.02, { color: V.door });                       // shed door
      box(B.D, ctx, scx, y0 + 0.28, scz + sd / 2 - 0.004, 0.38, 0.56, 0.01, { color: TRIM });
      fp.push({ x: scx, z: scz, hx: sw / 2 + 0.04, hz: sd / 2 + 0.04 });
    }
    // ---- yard: picket fence (0, 2) or hedge (1) along the front and the two sides, a gate gap at the path, path slabs, corner shrubs, mailbox, lamp
    const fz = zf + 0.64, fw = 0.84, gap = 0.2;
    const hedge = (x, z, k = 1) => { blob(B.D, ctx, x, 0.15, z, 0.2 * k, 0.15, 0.17, 1, { color: 0x4f8a4a }); blob(B.D, ctx, x + 0.1, 0.13, z, 0.15 * k, 0.12, 0.15, 1, { color: 0x5e9a52 }); };
    const picket = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0), cnt = Math.max(2, Math.round(len / 0.11));
      ctx.at((x0 + x1) / 2, 0, (z0 + z1) / 2, ang, () => {
        box(B.D, ctx, 0, 0.12, 0, len, 0.03, 0.02, { color: V.fence }); box(B.D, ctx, 0, 0.28, 0, len, 0.03, 0.02, { color: V.fence });
        for (let i = 0; i <= cnt; i++) box(B.D, ctx, -len / 2 + i * len / cnt, 0.19, 0.012, 0.045, 0.34, 0.018, { color: V.fence });
      });
    };
    const post = (x, z) => box(B.D, ctx, x, 0.22, z, 0.06, 0.44, 0.06, { color: shade(V.fence, 0.92) });
    if (v === 1) {                                                                                                     // hedge along the front, short picket returns
      for (let x = -fw + 0.1; x <= fw - 0.05; x += 0.2) if (Math.abs(x - doorX) > gap + 0.05) hedge(x, fz, 1);
      picket(-fw, fz, -fw, zf + 0.12); picket(fw, fz, fw, zf + 0.12);
    } else {
      picket(-fw, fz, doorX - gap, fz); picket(doorX + gap, fz, fw, fz); picket(-fw, fz, -fw, zf + 0.12); picket(fw, fz, fw, zf + 0.12);
      for (const x of [-fw, fw, doorX - gap, doorX + gap]) post(x, fz);
    }
    for (const sx of [-1, 1]) hedge(sx * (hw0 - 0.12), zf + 0.2, 0.9);                                                 // shrubs at the front corners
    box(B.D, ctx, doorX, 0.012, (zf + 0.35 + fz) / 2, 0.3, 0.024, fz - zf - 0.35, { color: 0xd6cdbf });               // path slabs
    { const mx = fw + 0.14, mz = fz - 0.05;                                                                            // mailbox
      box(B.D, ctx, mx, 0.28, mz, 0.04, 0.56, 0.04, { color: 0x6a4a2e }); box(B.D, ctx, mx, 0.6, mz, 0.18, 0.12, 0.26, { color: 0x3a5f8f }); box(B.D, ctx, mx + 0.1, 0.65, mz + 0.04, 0.02, 0.09, 0.05, { color: 0xd23b30 }); }
    { const lx = -fw - 0.12, lz = fz - 0.05;                                                                           // lamp post
      box(B.D, ctx, lx, 0.36, lz, 0.04, 0.72, 0.04, { color: 0x3b4350 }); box(B.D, ctx, lx, 0.01, lz, 0.12, 0.02, 0.12, { color: 0x3b4350 });
      box(B.L, ctx, lx, 0.8, lz, 0.1, 0.1, 0.1); box(B.D, ctx, lx, 0.87, lz, 0.14, 0.03, 0.14, { color: 0x3b4350 }); }
    return { fp, reach: Math.max(hw0 + (v === 2 ? 0.64 : 0), fw + 0.2), fz };
  }
  const miniMats = () => {
    const M = mats();
    if (!M.sidingVC) {
      const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
      M.sidingVC = share(createSurfaceMaterialV152('siding', lin(0xffffff), { roughness: 0.9, vertexColors: true }));
      M.roofVC = share(createSurfaceMaterialV152('roof', lin(0xffffff), { roughness: 0.88, side: THREE.DoubleSide, vertexColors: true }));
    }
    return M;
  };
  const miniMeshes = (B, M, g) => {
    const add = (m) => { if (m) g.add(m); };
    add(toMesh(B.S, M.sidingVC, { cast: !VISUAL_MOBILE })); add(toMesh(B.R, M.roofVC, { cast: !VISUAL_MOBILE })); add(toMesh(B.D, M.detail, { soft: true }));
    add(toMesh(B.G, M.glass, { receive: false })); add(toMesh(B.L, M.lamp, { soft: true, receive: false }));
  };
  const miniVariantFor = (color, accent) => { const h = ((color >>> 0) * 31 + (accent >>> 0) * 17) >>> 0; return h % 2; };
  function buildMiniHouseV161(color = 0xd9b28b, accent = 0x874d3a, variant) {
    const M = miniMats(), v = Number.isInteger(variant) ? ((variant % 3) + 3) % 3 : miniVariantFor(color, accent);
    const ctx = makeCtx(1), B = miniBatches();
    const wall = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHex();
    const parts = miniHouseParts(B, ctx, v, wall, accent);
    const g = new THREE.Group(); g.name = 'miniHouseV161';
    miniMeshes(B, M, g);
    g.userData.v161MiniHouse = true; g.userData.v161Variant = v; g.userData.v161Footprint = parts.fp;
    return g;
  }

  // ---- the suburb district (makeDistrictIdentityGroupV363, id 'suburb'): lawn + path, 4+lv trees, 3 planters, 2+lv mini houses on the old ring (same angles, radii, yaw, scale 0.9)
  // 6 meshes in total (ground, soft detail with trees / planters / fences / hedges, siding, roof, glass, lamps) instead of ~96. Houses are solid (wall boxes + shed), tree trunks are small circles.
  const SUBURB_HOUSE_SCALE = 0.9;
  function buildSuburbV161(lv) {
    const M = miniMats(), g = new THREE.Group(); g.name = 'suburbV161';
    const ctx = makeCtx(1), B = miniBatches(), gnd = batch(true);
    disc(gnd, ctx, 0, 0, 0, 2.25, 0.03, 28, { color: 0x72b25f });                                                      // lawn
    disc(gnd, ctx, 0, 0, 1.05, 1.32, 0.05, 28, { color: 0xdccfc2 });                                                   // path ring
    const solids = [], trunks = [];
    // planters (3, as before: r 1.85, start pi/6)
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 6 + i / 3 * Math.PI * 2, x = Math.cos(a) * 1.85, z = Math.sin(a) * 1.85;
      cyl(B.D, ctx, x, 0, z, 0.5, 0.44, 0.24, 12, { color: 0xc9beb0 }); cyl(B.D, ctx, x, 0.24, z, 0.4, 0.36, 0.04, 12, { color: 0x7fbf73 });
      blob(B.D, ctx, x, 0.4, z, 0.3, 0.2, 0.3, 1, { color: 0x5e9a52 }); blob(B.D, ctx, x + 0.1, 0.5, z - 0.05, 0.16, 0.12, 0.16, 1, { color: 0xf08ab0 });
    }
    // trees (4+lv, r 3.2): deciduous / conifer alternating, sizes vary by index, base exactly on the ground
    const nTrees = 4 + lv;
    for (let i = 0; i < nTrees; i++) {
      const a = i / nTrees * Math.PI * 2, x = Math.cos(a) * 3.2, z = Math.sin(a) * 3.2, k = 0.9 + 0.12 * (i % 3);
      if (i % 2 === 0) {
        cyl(B.D, ctx, x, 0, z, 0.1 * k, 0.07 * k, 0.9 * k, 6, { color: 0x6b4a2f });
        blob(B.D, ctx, x, 1.35 * k, z, 0.62 * k, 0.55 * k, 0.62 * k, 1, { color: 0x6ea95d }); blob(B.D, ctx, x + 0.18 * k, 1.75 * k, z - 0.1 * k, 0.4 * k, 0.36 * k, 0.4 * k, 1, { color: 0x7dbb6a });
      } else {
        cyl(B.D, ctx, x, 0, z, 0.09 * k, 0.07 * k, 0.45 * k, 6, { color: 0x6b4a2f });
        for (let j = 0; j < 3; j++) cone(B.D, ctx, x, (0.35 + j * 0.5) * k, z, (0.62 - j * 0.14) * k, 0.8 * k, 8, { color: [0x3f7d4a, 0x468a50, 0x4f9657][j] });
      }
      trunks.push({ x, z, r: 0.2 });
    }
    // houses on the old ring, variant by index (colours of the old palette family, geometry of the three variants)
    const nHouses = 2 + lv, variants = [];
    for (let i = 0; i < nHouses; i++) {
      const a = -Math.PI * 0.32 + i * (Math.PI / (1 + lv)), hx = Math.cos(a) * 5.2, hz = Math.sin(a) * 5.0, yaw = -a + Math.PI / 2, v = i % 3, V = MINI_V[v];
      variants.push(v);
      let parts = null;
      const c2 = makeCtx(1);
      c2.P = new M4().makeTranslation(hx, 0, hz).multiply(new M4().makeRotationY(yaw)).multiply(new M4().makeScale(SUBURB_HOUSE_SCALE, SUBURB_HOUSE_SCALE, SUBURB_HOUSE_SCALE));
      parts = miniHouseParts(B, c2, v, V.wall, V.roof);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const f of parts.fp) solids.push({ x: hx + (f.x * cy + f.z * sy) * SUBURB_HOUSE_SCALE, z: hz + (-f.x * sy + f.z * cy) * SUBURB_HOUSE_SCALE, hx: f.hx * SUBURB_HOUSE_SCALE, hz: f.hz * SUBURB_HOUSE_SCALE, yaw });
    }
    g.add(toMesh(gnd, M.detail, { soft: true }));
    miniMeshes(B, M, g);
    g.userData.v161Suburb = true; g.userData.v161Solids = solids; g.userData.v161Trunks = trunks; g.userData.v161Houses = nHouses; g.userData.v161Trees = nTrees; g.userData.v161Variants = variants;
    return g;
  }
  // world boxes / circles of the suburb group (registry hook, tycoon-v161.html rebuildStatic): houses + sheds = oriented boxes, trunks = circles
  function districtObstacles() {
    const out = [];
    let map = null; try { map = cityWorldRuntime.districtIdentity; } catch (_) { return out; }
    const g = map && map.get && map.get('suburb');
    if (!g || !g.userData || !g.userData.v161Suburb || g.visible === false) return out;
    g.updateMatrixWorld(true);
    const p = new V3();
    (g.userData.v161Solids || []).forEach((s, i) => { p.set(s.x, 0, s.z).applyMatrix4(g.matrixWorld); out.push({ owner: g, category: 'cityBuilding', label: `suburb:house${i}`, shape: 'obb', pos: new V3(p.x, 0, p.z), hx: s.hx, hz: s.hz, yaw: s.yaw }); });
    (g.userData.v161Trunks || []).forEach((t, i) => { p.set(t.x, 0, t.z).applyMatrix4(g.matrixWorld); out.push({ owner: g, category: 'tree', label: `suburb:tree${i}`, shape: 'circle', pos: new V3(p.x, 0, p.z), radius: t.r }); });
    return out;
  }
  // the registry also needs the mini houses of the neighbourhood ring (refreshNeighborhoodWorld): their wall boxes in world space
  function neighborhoodObstacles() {
    const out = [];
    let map = null; try { map = cityWorldRuntime.neighborhoods; } catch (_) { return out; }
    if (!map) return out;
    for (const [id, grp] of map) {
      if (!grp || grp.visible === false) continue;
      grp.updateMatrixWorld(true);
      for (const h of grp.children) {
        if (!h.userData || !h.userData.v161MiniHouse) continue;
        const boxes = footprintWorld(h) || [];
        boxes.forEach((b, i) => out.push({ owner: grp, category: 'cityBuilding', label: `miniHouse:${id}:${i}`, shape: 'obb', pos: b.pos, hx: b.hx, hz: b.hz, yaw: b.yaw }));
      }
    }
    return out;
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
      out.push({ pos: new V3(p.x, 0, p.z), hx: f.hx * sx, hz: f.hz * sz, yaw: yaw + (f.yaw || 0) });
    }
    return out;
  }

  window.buildHouseV161 = buildHouseV161;
  window.buildMiniHouseV161 = buildMiniHouseV161;
  window.buildSuburbV161 = buildSuburbV161;
  // the shared kit: assets/shop-v161.js builds its meshes with the same merged-geometry helpers
  const kit = { batch, box, tri, quad, cone, cyl, disc, blob, roofPlanes, makeCtx, toMesh, mats, lin, rgb, shade, M4, V3 };
  window.BuildingsV161 = { enabled: true, buildHouse: buildHouseV161, addHouseGold, footprintWorld, districtObstacles, neighborhoodObstacles, mats, kit, version: 'v161-buildings-houses-suburb' };
})();
