/* Masterplan C, step C1 "Каркас": the street skeleton of the new city (layout C only).
 * Everything here is DATA from assets/plan-c-data-v161.js (tools/masterplan/compile-plan-c.mjs); the layer only turns it into meshes:
 *   - one merged mesh per 60 m cell (ground + landscape + asphalt + kerbs + sidewalks + markings; vertex colours, one shared material),
 *     built lazily around the player, disposed when far away (PlanCV161.R_BUILD / R_KEEP);
 *   - instanced street furniture (lamps, signal heads, sign poles + plates, bus shelters, trees): 6 draw calls for the whole city;
 *   - the walkable floor is the compiled land (PlanCDataV161.floor / access); clamp() slides along the edge of the water like the plan B layer did.
 * Budget: whole layer <= +60 draw calls (frustum culled cells + 6 instanced meshes). No colliders, buildings or signal logic yet (C2/C3/C5).
 * Nothing runs unless window.LAYOUT_V161 === 'C' (assets/layout-v161.js): plan B saves are byte for byte as before.
 */
(() => {
  'use strict';
  if (window.LAYOUT_V161 !== 'C') return;
  const D = window.PlanCDataV161;
  if (!D) { console.error('plan C data missing'); return; }
  const CELL = D.cell, MAX_PER_TICK = 2, SLOPE_CI = D.palette.slope;
  const cells = new Map();            // key -> {mesh, cx, cz}
  const root = new THREE.Group(); root.name = 'planCV161'; root.userData.planCV161 = true;
  scene.add(root);
  // depth precision: the follow camera is 6-8 m from what matters, so the near plane 0.35 only costs bits (a 16-bit buffer resolves ~1 mm at 5 m but 9 mm at 15 m with near 0.35; 0.6 gives 1.7x (far stays 500: the sky dome is 400 m))
  try { if (typeof camera !== 'undefined' && camera.isPerspectiveCamera) { camera.near = 0.6; camera.updateProjectionMatrix(); } } catch (_) {}
  const api = { version: 1, enabled: true, root, cells, R_BUILD: 128, R_KEEP: 190, furniture: {}, lastBuilt: 0 };   // radii in metres around the player (tests / screenshots may widen them)
  window.PlanCV161 = api;

  // colours: palette entries are sRGB hex, the game renders linear
  const lin = D.colors.map((h) => new THREE.Color(h).convertSRGBToLinear());
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
  mat.userData.planCV161 = true;
  api.material = mat;
  // Shadow acne on decks (owner's iPhone, 2026-10-19: horizontal stripes / arcs on every ramp lane): the deck meshes both CAST and RECEIVE the sun's shadow, so each deck
  // compares its own surface with its own entry in the 1024 map (texel 0.14 m, a sloped lane differs by up to 0.1-0.3 m across one texel, more when the quality ladder halves the map).
  // The shadow pass of a deck therefore draws it SHADOW_PUSH metres deeper along the light (a real bridge shadow on the ground below is unchanged to within that thickness),
  // so a deck never shadows itself whatever the GPU's depth precision or the map size; walls / kerbs of the same mesh are pushed equally.
  const SHADOW_PUSH = 0.45;
  const deckDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  deckDepthMat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  mvPosition.z -= ' + SHADOW_PUSH.toFixed(3) + ';\n  gl_Position = projectionMatrix * mvPosition;'); };
  deckDepthMat.customProgramCacheKey = () => 'planCDeckDepth' + SHADOW_PUSH;
  api.deckDepthMaterial = deckDepthMat;

  // ---- old core that does not exist in layout C (the base ground is replaced by the cells; the dark disc and the spherical hills / skyline boxes are gated at their owners)
  function retireOldCore() {
    try { for (const c of (scene.userData.clouds || [])) c.visible = false; } catch (_) {}   // the old cloud blobs hang over the centre of the old island
    try { if (typeof ground !== 'undefined') ground.visible = false; if (typeof groundShadow !== 'undefined') groundShadow.visible = false; } catch (_) {}
  }

  // ---- cell meshes
  function buildCell(cx, cz) {
    const key = cx + ',' + cz, data = D.cells[key];
    if (!data) return null;
    let pos = [], nor = [], col = [];
    const dpos = [], dnor = [], dcol = [];
    let cur = 0;
    const slopeTris = [];   // grass banks get smooth (vertex-averaged) normals: flat shading of a cone around a loop read as alternating radial strips
    let tone = 1;   // the sun + ACES wash light colours out: grass and landscape are drawn 20 % darker than their palette entry
    const v = (x, y, z, nx, ny, nz, c) => { const P = cur ? dpos : pos, Nn = cur ? dnor : nor, C = cur ? dcol : col; P.push(x, y, z); Nn.push(nx, ny, nz); C.push(c.r * tone, c.g * tone, c.b * tone); };
    for (const layer of ['g', 'r', 'p', 'd']) {
      const L = data[layer]; if (!L) continue;
      cur = layer === 'd' ? 1 : 0; tone = layer === 'g' ? 0.8 : 1;
      const dv = L.v;
      if (dv) for (let i = 0; i < dv.length; i += 10) {
        const c = lin[dv[i + 9]];
        let ax = dv[i], ay = dv[i + 1], az = dv[i + 2], bx = dv[i + 3], by = dv[i + 4], bz = dv[i + 5], cx2 = dv[i + 6], cy2 = dv[i + 7], cz2 = dv[i + 8];
        let nx = (by - ay) * (cz2 - az) - (bz - az) * (cy2 - ay), ny = (bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az), nz = (bx - ax) * (cy2 - ay) - (by - ay) * (cx2 - ax);
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; [bx, cx2] = [cx2, bx]; [by, cy2] = [cy2, by]; [bz, cz2] = [cz2, bz]; }
        v(ax, ay, az, nx, ny, nz, c); v(bx, by, bz, nx, ny, nz, c); v(cx2, cy2, cz2, nx, ny, nz, c);
        if (cur && dv[i + 9] === SLOPE_CI) slopeTris.push(dpos.length / 3 - 3);
      }
      const ds = L.s;
      if (ds) for (let i = 0; i < ds.length; i += 9) {
        const x0 = ds[i], z0 = ds[i + 1], x1 = ds[i + 2], z1 = ds[i + 3], b0 = ds[i + 4], t0 = ds[i + 5], b1 = ds[i + 6], t1 = ds[i + 7], c = lin[ds[i + 8]];
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = dz / l, nz = -dx / l;
        v(x0, b0, z0, nx, 0, nz, c); v(x1, b1, z1, nx, 0, nz, c); v(x1, t1, z1, nx, 0, nz, c);
        v(x0, b0, z0, nx, 0, nz, c); v(x1, t1, z1, nx, 0, nz, c); v(x0, t0, z0, nx, 0, nz, c);
      }
      const q = L.q;
      if (q) for (let i = 0; i < q.length; i += 6) {
        const x0 = q[i], z0 = q[i + 1], x1 = q[i + 2], z1 = q[i + 3], y = q[i + 4], c = lin[q[i + 5]];
        v(x0, y, z0, 0, 1, 0, c); v(x0, y, z1, 0, 1, 0, c); v(x1, y, z1, 0, 1, 0, c);
        v(x0, y, z0, 0, 1, 0, c); v(x1, y, z1, 0, 1, 0, c); v(x1, y, z0, 0, 1, 0, c);
      }
      const t = L.t;
      if (t) for (let i = 0; i < t.length; i += 8) {
        let ax = t[i], az = t[i + 1], bx = t[i + 2], bz = t[i + 3], cx2 = t[i + 4], cz2 = t[i + 5];
        const y = t[i + 6], c = lin[t[i + 7]];
        if ((bx - ax) * (cz2 - az) - (bz - az) * (cx2 - ax) > 0) { [bx, cx2] = [cx2, bx]; [bz, cz2] = [cz2, bz]; }   // wind so that the face looks up
        v(ax, y, az, 0, 1, 0, c); v(bx, y, bz, 0, 1, 0, c); v(cx2, y, cz2, 0, 1, 0, c);
      }
      const w = L.w;
      if (w) for (let i = 0; i < w.length; i += 7) {
        const x0 = w[i], z0 = w[i + 1], x1 = w[i + 2], z1 = w[i + 3], y0 = w[i + 4], y1 = w[i + 5], c = lin[w[i + 6]];
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = dz / l, nz = -dx / l;
        v(x0, y0, z0, nx, 0, nz, c); v(x1, y0, z1, nx, 0, nz, c); v(x1, y1, z1, nx, 0, nz, c);
        v(x0, y0, z0, nx, 0, nz, c); v(x1, y1, z1, nx, 0, nz, c); v(x0, y1, z0, nx, 0, nz, c);
      }
    }
    if (slopeTris.length) {
      const key = (k) => Math.round(dpos[k * 3] * 50) + ',' + Math.round(dpos[k * 3 + 1] * 50) + ',' + Math.round(dpos[k * 3 + 2] * 50), acc = new Map();
      for (const t of slopeTris) for (let j = 0; j < 3; j++) { const k = key(t + j); let a = acc.get(k); if (!a) acc.set(k, a = [0, 0, 0]); a[0] += dnor[(t + j) * 3]; a[1] += dnor[(t + j) * 3 + 1]; a[2] += dnor[(t + j) * 3 + 2]; }
      for (const t of slopeTris) for (let j = 0; j < 3; j++) { const a = acc.get(key(t + j)), l = Math.hypot(a[0], a[1], a[2]) || 1; dnor[(t + j) * 3] = a[0] / l; dnor[(t + j) * 3 + 1] = a[1] / l; dnor[(t + j) * 3 + 2] = a[2] / l; }
    }
    const mk = (P, Nn, C, name, solid) => {
      if (!P.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.boundingBox = new THREE.Box3(new THREE.Vector3(cx * CELL, -3, cz * CELL), new THREE.Vector3((cx + 1) * CELL, 8, (cz + 1) * CELL));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3((cx + 0.5) * CELL, 2, (cz + 0.5) * CELL), CELL * 0.8);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name; mesh.receiveShadow = true; mesh.castShadow = !!solid; if (solid) mesh.customDepthMaterial = deckDepthMat; mesh.matrixAutoUpdate = false;
      mesh.userData.v83CollisionIgnore = true; mesh.userData.planCCell = key; mesh.userData.v152Skip = true; mesh.userData.planCSolid = !!solid;
      return mesh;
    };
    const ground = mk(pos, nor, col, 'planC_' + key, false), decks = mk(dpos, dnor, dcol, 'planCd_' + key, true);
    if (!ground && !decks) return null;
    return { ground, decks };
  }
  function addCell(cx, cz) {
    const key = cx + ',' + cz;
    if (cells.has(key)) return false;
    const built = buildCell(cx, cz);
    cells.set(key, { mesh: built && built.ground, decks: built && built.decks, cx, cz });
    if (built) for (const m of [built.ground, built.decks]) if (m) { root.add(m); m.updateMatrix(); }
    if (built && built.decks && typeof cameraSolidMeshes !== 'undefined' && Array.isArray(cameraSolidMeshes)) if (!cameraSolidMeshes.includes(built.decks)) cameraSolidMeshes.push(built.decks);   // the camera never goes through a wall / deck of the city
    return true;
  }
  function dropCell(key) {
    const c = cells.get(key); if (!c) return;
    for (const m of [c.mesh, c.decks]) if (m) { root.remove(m); m.geometry.dispose(); }
    if (c.decks && typeof cameraSolidMeshes !== 'undefined' && Array.isArray(cameraSolidMeshes)) { const i = cameraSolidMeshes.indexOf(c.decks); if (i >= 0) cameraSolidMeshes.splice(i, 1); }
    cells.delete(key);
  }

  // ---- instanced furniture
  const K = window.BuildingsV161 && window.BuildingsV161.kit;
  function mergeGeoms(parts) {   // parts: [{geo, color (sRGB hex), x, y, z}] -> one non-indexed vertex-coloured geometry
    const pos = [], nor = [], col = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo, c = new THREE.Color(p.color).convertSRGBToLinear();
      g.translate(p.x || 0, p.y || 0, p.z || 0);
      const a = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < a.length; i++) { pos.push(a[i]); nor.push(n[i]); }
      for (let i = 0; i < a.length / 3; i++) col.push(c.r, c.g, c.b);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }
  const box = (w, h, d, color, x, y, z) => ({ geo: new THREE.BoxGeometry(w, h, d), color, x, y, z });
  const cyl = (r0, r1, h, seg, color, x, y, z) => ({ geo: new THREE.CylinderGeometry(r1, r0, h, seg), color, x, y, z });
  const cone = (r, h, seg, color, x, y, z) => ({ geo: new THREE.ConeGeometry(r, h, seg), color, x, y, z });
  const PROTO = {
    lamp: () => mergeGeoms([cyl(0.07, 0.05, 3.5, 6, 0x4a4f55, 0, 1.75, 0), box(0.1, 0.1, 0.9, 0x4a4f55, 0, 3.45, 0.4), box(0.28, 0.1, 0.5, 0xf3e3a8, 0, 3.38, 0.78)]),
    sig: () => mergeGeoms([cyl(0.07, 0.07, 3.3, 6, 0x3a3f44, 0, 1.65, 0), box(0.1, 0.1, 0.9, 0x3a3f44, 0, 3.15, 0.35), box(0.3, 0.86, 0.28, 0x22252a, 0, 3.0, 0.8)]),
    pole: () => mergeGeoms([cyl(0.04, 0.04, 2.3, 5, 0x8d9298, 0, 1.15, 0)]),
    plate: () => mergeGeoms([box(0.6, 0.6, 0.04, 0xffffff, 0, 2.3, 0.04)]),
    stop: () => mergeGeoms([box(2.2, 0.08, 1.1, 0xe07a2f, 0, 2.3, 0), box(0.07, 2.3, 0.07, 0x4a4f55, -1.0, 1.15, 0.45), box(0.07, 2.3, 0.07, 0x4a4f55, 1.0, 1.15, 0.45), box(2.0, 1.6, 0.04, 0xaed0dc, 0, 1.3, -0.5), box(1.4, 0.07, 0.35, 0x8a6a45, 0, 0.5, -0.3)]),
    cat: () => mergeGeoms([cyl(0.1, 0.08, 6.0, 5, 0x5d6268, 0, 3.0, 0), box(0.08, 0.08, 2.0, 0x5d6268, 0, 5.6, 1.0), box(0.06, 0.06, 1.6, 0x2c2f33, 0, 5.2, 0.9)]),
    tree: () => mergeGeoms([cyl(0.14, 0.1, 1.1, 5, 0x6b4a2b, 0, 0.55, 0), cone(1.0, 1.9, 7, 0x3f7a3a, 0, 1.9, 0), cone(0.78, 1.5, 7, 0x4a8a42, 0, 2.8, 0)]),
  };
  const PLATE_COLORS = [0xd33a2e, 0xf1efe6, 0x2a6fb5, 0xe7c23a];   // stop / yield / roundabout / priority road
  const instances = {};
  let night = 0;
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x6d6a5e }), poolMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const poolGeo = new THREE.CircleGeometry(3.4, 16);
  api.setNight = (v) => { night = v; glowMat.color.setRGB(0.43 + 0.57 * v, 0.42 + 0.5 * v, 0.37 + 0.2 * v); poolMat.opacity = 0.2 * v; if (instances.lamppool) instances.lamppool.visible = v > 0.05; };
  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  function makeInstanced(name, count, fill, opts = {}) {
    let inst = instances[name];
    if (inst) { root.remove(inst); inst.dispose(); instances[name] = null; }
    if (!count) { api.furniture[name] = 0; return; }
    const geo = (opts.geo) || (PROTO[opts.proto || name]());
    const m = opts.material || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    inst = new THREE.InstancedMesh(geo, m, count);
    inst.name = 'planCfurn_' + name; inst.frustumCulled = false; inst.castShadow = !!opts.shadow; inst.receiveShadow = false; inst.userData.v83CollisionIgnore = true;
    fill(inst);
    inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    root.add(inst); instances[name] = inst; api.furniture[name] = count;
  }
  const geoCache = {};
  function sharedGeo(name) { return geoCache[name] || (geoCache[name] = PROTO[name]()); }
  let visibleSignalHeads=[];
  api.updateSignalLights=(state)=>{
    const inst=instances.signalLights;if(!inst)return;
    let changed=false;
    visibleSignalHeads.forEach((s,n)=>{const phase=state(s[3],[s[4],s[5]]);if(s.phase===phase)return;s.phase=phase;changed=true;
      ['red','amber','green'].forEach((color,k)=>{tint.setHex(color===phase?[0xff352a,0xffbc25,0x35e467][k]:0x20252a).convertSRGBToLinear();inst.setColorAt(n*3+k,tint);});
    });
    if(changed)inst.instanceColor.needsUpdate=true;
  };
  function rebuildFurniture() {
    const lists = { lamp: [], sig: [], pole: [], plate: [], stop: [], tree: [], cat: [] };
    for (const [key, c] of cells) {
      const f = D.cells[key] && D.cells[key].f; if (!f) continue;
      for (const k of Object.keys(lists)) { const src = k === 'plate' ? f.pole : f[k]; if (src) lists[k].push(src); }
    }
    const strideOf = { lamp: 4, sig: 3, pole: 4, plate: 4, stop: 4, tree: 4, cat: 3 };
    const count = (k) => lists[k].reduce((s, a) => s + a.length / strideOf[k], 0);
    const each = (k, fn) => { let n = 0; for (const a of lists[k]) for (let i = 0; i < a.length; i += strideOf[k]) fn(a, i, n++); };
    const setM = (inst, n, x, y, z, yaw, s = 1) => { dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); inst.setMatrixAt(n, dummy.matrix); };
    for (const k of ['lamp', 'sig', 'pole', 'stop']) makeInstanced(k, count(k), (inst) => each(k, (a, i, n) => setM(inst, n, a[i], k === 'lamp' ? a[i + 3] : 0, a[i + 1], a[i + 2])), { geo: sharedGeo(k), shadow: k === 'lamp' });
    visibleSignalHeads=D.graph.signalHeads.filter(s=>cells.has(Math.floor(s[0]/CELL)+','+Math.floor(s[1]/CELL))).map(s=>s.slice());
    makeInstanced('signalLights',visibleSignalHeads.length*3,inst=>visibleSignalHeads.forEach((s,n)=>{
      for(let k=0;k<3;k++)setM(inst,n*3+k,s[0]+Math.sin(s[2])*.96,3.3-k*.3,s[1]+Math.cos(s[2])*.96,s[2]);
    }),{geo:new THREE.BoxGeometry(.17,.17,.05),material:new THREE.MeshBasicMaterial({color:0xffffff})});
    api.updateSignalLights(window.PlanCTrafficV161?.state||(()=> 'red'));
    // lamp glow: the heads light up at night (one instanced box + one additive ground pool, both driven by isNightV40())
    const lampN = count('lamp');
    makeInstanced('lampglow', lampN, (inst) => each('lamp', (a, i, n) => setM(inst, n, a[i] + Math.sin(a[i + 2]) * 0.78, 3.36 + a[i + 3], a[i + 1] + Math.cos(a[i + 2]) * 0.78, a[i + 2])), { geo: new THREE.BoxGeometry(0.3, 0.06, 0.5), material: glowMat });
    makeInstanced('lamppool', lampN, (inst) => each('lamp', (a, i, n) => { dummy.position.set(a[i] + Math.sin(a[i + 2]) * 0.78, 0.13 + a[i + 3], a[i + 1] + Math.cos(a[i + 2]) * 0.78); dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); inst.setMatrixAt(n, dummy.matrix); }), { geo: poolGeo, material: poolMat });
    if (instances.lamppool) instances.lamppool.visible = night > 0.05;
    makeInstanced('cat', count('cat'), (inst) => each('cat', (a, i, n) => setM(inst, n, a[i], D.struct.railY, a[i + 1], a[i + 2])), { geo: sharedGeo('cat') });
    makeInstanced('plate', count('plate'), (inst) => each('plate', (a, i, n) => { setM(inst, n, a[i], 0, a[i + 1], a[i + 2]); tint.setHex(PLATE_COLORS[a[i + 3]] || 0xffffff).convertSRGBToLinear(); inst.setColorAt(n, tint); }), { geo: sharedGeo('plate'), material: new THREE.MeshStandardMaterial({ roughness: 0.6 }) });
    makeInstanced('tree', count('tree'), (inst) => each('tree', (a, i, n) => { const t = a[i + 3]; setM(inst, n, a[i], 0, a[i + 1], t * 6.28, a[i + 2]); tint.setRGB(0.78 + t * 0.35, 0.85 + t * 0.25, 0.75 + t * 0.3); inst.setColorAt(n, tint); }), { geo: sharedGeo('tree'), shadow: false });
  }

  // ---- build policy: cells within R_BUILD of the player, nearest first; far cells are disposed
  const wanted = (px, pz, r) => {
    const out = [];
    for (let cx = Math.floor((px - r) / CELL); cx <= Math.floor((px + r) / CELL); cx++) for (let cz = Math.floor((pz - r) / CELL); cz <= Math.floor((pz + r) / CELL); cz++) {
      const key = cx + ',' + cz; if (!D.cells[key]) continue;
      const dx = Math.max(cx * CELL - px, 0, px - (cx + 1) * CELL), dz = Math.max(cz * CELL - pz, 0, pz - (cz + 1) * CELL);
      if (Math.hypot(dx, dz) <= r) out.push({ cx, cz, d: Math.hypot((cx + 0.5) * CELL - px, (cz + 0.5) * CELL - pz) });
    }
    return out.sort((a, b) => a.d - b.d);
  };
  function ensureNear(x, z, maxBuild = Infinity) {
    let n = 0, changed = false;
    for (const w of wanted(x, z, api.R_BUILD)) { if (n >= maxBuild) break; if (!cells.has(w.cx + ',' + w.cz)) { addCell(w.cx, w.cz); n++; changed = true; } }
    for (const key of [...cells.keys()]) {
      const c = cells.get(key), dx = Math.max(c.cx * CELL - x, 0, x - (c.cx + 1) * CELL), dz = Math.max(c.cz * CELL - z, 0, z - (c.cz + 1) * CELL);
      if (Math.hypot(dx, dz) > api.R_KEEP) { dropCell(key); changed = true; }
    }
    if (changed) rebuildFurniture();
    return n;
  }
  api.ensureNear = ensureNear;
  api.deckMeshes = () => [...cells.values()].map((c) => c.decks).filter(Boolean);
  api.dropAll = () => { for (const k of [...cells.keys()]) dropCell(k); rebuildFurniture(); };
  api.refresh = (force) => { if (force) api.dropAll(); ensureNear(player.position.x, player.position.z); };
  api.stats = () => { let meshes = 0, tris = 0; for (const c of cells.values()) for (const m of [c.mesh, c.decks]) if (m) { meshes++; tris += m.geometry.attributes.position.count / 3; } return { cells: cells.size, meshes, tris, furniture: { ...api.furniture } }; };
  // the walkable floor: slide along the edge of the water like the plan B layer
  const SLIDE_STEP = 2;
  api.floor = D.floor; api.access = D.access;
  api.clamp = (x, z, margin = 1) => {
    const hint = api.level + Math.max(0, player.position.y);   // the walker's world height (inside updatePlayer the physics height is relative to the surface)
    const acc = (a, b) => D.access(a, b, 0.45, hint);
    if (acc(x, z)) return { x, z };
    const px = player.position.x, pz = player.position.z;
    if (acc(px, pz) || D.access(px, pz)) {
      const sx = x - px, sz = z - pz;
      if (Math.hypot(sx, sz) <= SLIDE_STEP) {
        const first = Math.abs(sx) >= Math.abs(sz) ? [[x, pz], [px, z]] : [[px, z], [x, pz]];
        for (const [cx, cz] of first) if (acc(cx, cz)) return { x: cx, z: cz };
        for (const f of [0.5, 0.25]) { const cx = px + sx * f, cz = pz + sz * f; if (acc(cx, cz)) return { x: cx, z: cz }; }
      }
      return { x: px, z: pz };
    }
    return { x: THREE.MathUtils.clamp(x, -GROUND_HALF + margin, GROUND_HALF - margin), z: THREE.MathUtils.clamp(z, -GROUND_HALF + margin, GROUND_HALF - margin) };
  };

  // the sky domes (radius 220 / 400 around the old core) follow the player: the plan is 600 m wide
  const domes = [];
  scene.children.forEach((o) => { if (o.isMesh && o.geometry && o.geometry.type === 'SphereGeometry' && o.geometry.parameters.radius >= 200 && Math.abs(o.position.x) < 1 && Math.abs(o.position.z) < 1) domes.push(o); });
  api.domes = domes;
  const followSky = () => { for (const d of domes) { d.position.x = player.position.x; d.position.z = player.position.z; } };
  // ---- old scenery (chop trees, random bushes / rocks of the island core) that stands on a street of the plan is retired through the core's own road-conflict flag
  const clsW = D.classes, edgesG = D.graph.edges, ringsG = D.graph.rings;
  function onStreet(x, z) {
    for (const r of ringsG) if (Math.hypot(x - r[1], z - r[2]) < r[3] + 3.2) return true;
    for (const e of edgesG) {
      const c = clsW[e[3]], half = c[0] / 2 + c[1] + 0.9;
      if (x < Math.min(e[4], e[6]) - half || x > Math.max(e[4], e[6]) + half || z < Math.min(e[5], e[7]) - half || z > Math.max(e[5], e[7]) + half) continue;
      return true;
    }
    return Math.hypot(x, z) < 25.5;   // the paved circus
  }
  api.onStreet = onStreet;
  let sceneryList = [], sceneryAt = 0;
  function syncScenery(now) {
    if (now - sceneryAt < 2000) return; sceneryAt = now;
    sceneryList = scene.children.filter((o) => o.userData && (o.userData.harvestableTree || o.userData.v64RandomScenery || o.userData.foliageKindV154 || o.userData.v37LegacyRoadside));
    let n = 0;
    for (const o of sceneryList) {
      if (o.userData.v161PlanCRetired) continue;
      if (Math.abs(o.position.x) > 90 || Math.abs(o.position.z) > 90) continue;
      if (onStreet(o.position.x, o.position.z)) { o.userData.v161PlanCRetired = true; o.userData.v84HiddenRoadConflict = true; o.visible = false; n++; }
    }
    api.retired = (api.retired || 0) + n;
  }
  api.syncScenery = (now = 1e9) => { sceneryAt = 0; syncScenery(now); };
  // ---- height layer: ONE function for the surface under a point (decks, causeways, ramps, footbridges), read by the player, the camera and the colliders
  window.groundHeightV161 = (x, z, hint = 0) => { const y = D.surfaceY(x, z, hint, 0.75); return y == null ? 0 : y; };
  api.level = 0;
  const baseUpdatePlayer = updatePlayer;
  updatePlayer = function (dt) {
    let lvl = api.level;
    if (player.position.y < lvl - 0.3) lvl = D.surfaceY(player.position.x, player.position.z, player.position.y, 0.75) || 0;   // someone put the player on the ground (reset / teleport)
    player.position.y -= lvl;                       // the game's physics works relative to the surface
    const r = baseUpdatePlayer.apply(this, arguments);
    const rel = player.position.y, x = player.position.x, z = player.position.z;
    let target = D.surfaceY(x, z, lvl, 0.75); if (target == null) target = 0;   // no surface at all (open water beside a river footbridge): fall, never hover at the old level
    // A normal descent along a stair-ramp is still grounded. The old 5 cm
    // threshold made every step of a 40% slope a fall, reducing air control.
    // Preserve WORLD height while airborne (including a real drop off a deck),
    // so moving over a rising surface cannot add its height to a jump twice.
    let worldY = rel + lvl;
    if (playerGrounded && lvl - target <= 0.45) worldY = rel + target;
    else if (playerGrounded) { playerGrounded = false; playerVerticalVelocity = Math.min(playerVerticalVelocity, 0); }
    player.position.y = worldY;
    if (playerGrounded) api.airborneBase = null;
    else if (!Number.isFinite(api.airborneBase)) api.airborneBase = lvl;
    // The core follow-camera just ran in the previous support frame. Translate
    // it to the new frame now, preserving the chosen zoom and the jump damping.
    const cameraLift = (target - lvl) * 0.72 + (worldY - rel - lvl) * 0.28;
    camera.position.y += cameraLift;
    controls.target.y += cameraLift;
    if (typeof camEyeTarget !== 'undefined') camEyeTarget.y += cameraLift;
    api.level = target;
    return r;
  };
  // parapets of decks / ramps / footbridges are solid only for a player at their level (the registry asks active())
  function syncColliders() {
    const reg = window.__TYCOON_V83_COLLISIONS__; if (!reg) return;
    reg.unregisterOwner(root);
    for (const q of D.struct.rails) {
      const dx = q[2] - q[0], dz = q[3] - q[1], len = Math.hypot(dx, dz); if (len < 0.05) continue;
      const lvl = q[4];
      reg.register({ owner: root, category: 'decor', label: 'planC:parapet', shape: 'obb', pos: new THREE.Vector3((q[0] + q[2]) / 2, 0, (q[1] + q[3]) / 2), hx: 0.15, hz: len / 2 + 0.05, yaw: Math.atan2(dx, dz), flags: { player: true, agent: false, camera: false, placement: false }, active: () => Math.abs(api.level - lvl) < 1.4 });
    }
  }
  api.syncColliders = syncColliders;
  // the camera never goes above the underside of a deck the player stands under
  if (typeof window.resolveCameraObstructionV85 === 'function') {
    const baseResolve = window.resolveCameraObstructionV85;
    window.resolveCameraObstructionV85 = function () {
      const r = baseResolve.apply(this, arguments);
      const cap = D.overhead(player.position.x, player.position.z, api.level);
      if (cap != null && camera.position.y > cap - 0.3 && camera.position.y > controls.target.y) {
        const before = camera.position.clone();
        // Pull along the already collision-tested sightline. Moving only y
        // could put the camera inside the abutment beside an underpass.
        const t = Math.max(0, Math.min(1, (cap - 0.3 - controls.target.y) / (camera.position.y - controls.target.y)));
        camera.position.lerpVectors(controls.target, before, t);
        if (typeof cameraResolverShiftV163 !== 'undefined') cameraResolverShiftV163.add(camera.position.clone().sub(before));
      }
      return r;
    };
  }
  retireOldCore();
  syncColliders();
  syncScenery(1e9);
  ensureNear(player.position.x, player.position.z);
  let last = 0;
  (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push((now) => {
    if (api.enabled) followSky();
    if (!api.enabled || document.hidden || now - last < 250) return;
    last = now;
    try { if (typeof ground !== 'undefined' && ground.visible) ground.visible = false; } catch (_) {}
    syncScenery(now);
    try { const n = typeof isNightV40 === 'function' && isNightV40() ? 1 : 0; if (Math.abs(n - night) > 0.01) api.setNight(night + (n - night) * 0.35); } catch (_) {}
    const t0 = performance.now();
    ensureNear(player.position.x, player.position.z, MAX_PER_TICK);
    api.lastBuilt = performance.now() - t0;
  });
})();
