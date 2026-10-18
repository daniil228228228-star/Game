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
  const CELL = D.cell, MAX_PER_TICK = 2;
  const cells = new Map();            // key -> {mesh, cx, cz}
  const root = new THREE.Group(); root.name = 'planCV161'; root.userData.planCV161 = true;
  scene.add(root);
  const api = { version: 1, enabled: true, root, cells, R_BUILD: 128, R_KEEP: 190, furniture: {}, lastBuilt: 0 };   // radii in metres around the player (tests / screenshots may widen them)
  window.PlanCV161 = api;

  // colours: palette entries are sRGB hex, the game renders linear
  const lin = D.colors.map((h) => new THREE.Color(h).convertSRGBToLinear());
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
  mat.userData.planCV161 = true;
  api.material = mat;

  // ---- old core that does not exist in layout C (the base ground is replaced by the cells; the dark disc and the spherical hills / skyline boxes are gated at their owners)
  function retireOldCore() {
    try { if (typeof ground !== 'undefined') ground.visible = false; if (typeof groundShadow !== 'undefined') groundShadow.visible = false; } catch (_) {}
  }

  // ---- cell meshes
  function buildCell(cx, cz) {
    const key = cx + ',' + cz, data = D.cells[key];
    if (!data) return null;
    const pos = [], nor = [], col = [];
    const v = (x, y, z, nx, ny, nz, c) => { pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c.r, c.g, c.b); };
    for (const layer of ['g', 'r', 'p']) {
      const L = data[layer]; if (!L) continue;
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
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(cx * CELL, -0.1, cz * CELL), new THREE.Vector3((cx + 1) * CELL, 0.2, (cz + 1) * CELL));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3((cx + 0.5) * CELL, 0, (cz + 0.5) * CELL), CELL * 0.72);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'planC_' + key; mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false;
    mesh.userData.v83CollisionIgnore = true; mesh.userData.planCCell = key; mesh.userData.v152Skip = true;
    return mesh;
  }
  function addCell(cx, cz) {
    const key = cx + ',' + cz;
    if (cells.has(key)) return false;
    const mesh = buildCell(cx, cz);
    cells.set(key, { mesh, cx, cz });
    if (mesh) { root.add(mesh); mesh.updateMatrix(); }
    return true;
  }
  function dropCell(key) {
    const c = cells.get(key); if (!c) return;
    if (c.mesh) { root.remove(c.mesh); c.mesh.geometry.dispose(); }
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
    sig: () => mergeGeoms([cyl(0.07, 0.07, 3.3, 6, 0x3a3f44, 0, 1.65, 0), box(0.1, 0.1, 0.9, 0x3a3f44, 0, 3.15, 0.35), box(0.3, 0.86, 0.28, 0x22252a, 0, 3.0, 0.8), box(0.17, 0.17, 0.05, 0xd33a2e, 0, 3.3, 0.96), box(0.17, 0.17, 0.05, 0x6b5a22, 0, 3.0, 0.96), box(0.17, 0.17, 0.05, 0x2a6b3a, 0, 2.7, 0.96)]),
    pole: () => mergeGeoms([cyl(0.04, 0.04, 2.3, 5, 0x8d9298, 0, 1.15, 0)]),
    plate: () => mergeGeoms([box(0.6, 0.6, 0.04, 0xffffff, 0, 2.3, 0.04)]),
    stop: () => mergeGeoms([box(2.2, 0.08, 1.1, 0xe07a2f, 0, 2.3, 0), box(0.07, 2.3, 0.07, 0x4a4f55, -1.0, 1.15, 0.45), box(0.07, 2.3, 0.07, 0x4a4f55, 1.0, 1.15, 0.45), box(2.0, 1.6, 0.04, 0xaed0dc, 0, 1.3, -0.5), box(1.4, 0.07, 0.35, 0x8a6a45, 0, 0.5, -0.3)]),
    tree: () => mergeGeoms([cyl(0.14, 0.1, 1.1, 5, 0x6b4a2b, 0, 0.55, 0), cone(1.0, 1.9, 7, 0x3f7a3a, 0, 1.9, 0), cone(0.78, 1.5, 7, 0x4a8a42, 0, 2.8, 0)]),
  };
  const PLATE_COLORS = [0xd33a2e, 0xf1efe6, 0x2a6fb5, 0xe7c23a];   // stop / yield / roundabout / priority road
  const instances = {};
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
  function rebuildFurniture() {
    const lists = { lamp: [], sig: [], pole: [], plate: [], stop: [], tree: [] };
    for (const [key, c] of cells) {
      const f = D.cells[key] && D.cells[key].f; if (!f) continue;
      for (const k of Object.keys(lists)) { const src = k === 'plate' ? f.pole : f[k]; if (src) lists[k].push(src); }
    }
    const strideOf = { lamp: 3, sig: 3, pole: 4, plate: 4, stop: 4, tree: 4 };
    const count = (k) => lists[k].reduce((s, a) => s + a.length / strideOf[k], 0);
    const each = (k, fn) => { let n = 0; for (const a of lists[k]) for (let i = 0; i < a.length; i += strideOf[k]) fn(a, i, n++); };
    const setM = (inst, n, x, y, z, yaw, s = 1) => { dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); inst.setMatrixAt(n, dummy.matrix); };
    for (const k of ['lamp', 'sig', 'pole', 'stop']) makeInstanced(k, count(k), (inst) => each(k, (a, i, n) => setM(inst, n, a[i], 0, a[i + 1], a[i + 2])), { geo: sharedGeo(k), shadow: k === 'lamp' });
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
  api.dropAll = () => { for (const k of [...cells.keys()]) dropCell(k); rebuildFurniture(); };
  api.refresh = (force) => { if (force) api.dropAll(); ensureNear(player.position.x, player.position.z); };
  api.stats = () => { let meshes = 0, tris = 0; for (const c of cells.values()) if (c.mesh) { meshes++; tris += c.mesh.geometry.attributes.position.count / 3; } return { cells: cells.size, meshes, tris, furniture: { ...api.furniture } }; };
  // the walkable floor: slide along the edge of the water like the plan B layer
  const SLIDE_STEP = 2;
  api.floor = D.floor; api.access = D.access;
  api.clamp = (x, z, margin = 1) => {
    if (D.access(x, z)) return { x, z };
    const px = player.position.x, pz = player.position.z;
    if (D.access(px, pz)) {
      const sx = x - px, sz = z - pz;
      if (Math.hypot(sx, sz) <= SLIDE_STEP) {
        const first = Math.abs(sx) >= Math.abs(sz) ? [[x, pz], [px, z]] : [[px, z], [x, pz]];
        for (const [cx, cz] of first) if (D.access(cx, cz)) return { x: cx, z: cz };
        for (const f of [0.5, 0.25]) { const cx = px + sx * f, cz = pz + sz * f; if (D.access(cx, cz)) return { x: cx, z: cz }; }
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
  retireOldCore();
  syncScenery(1e9);
  ensureNear(player.position.x, player.position.z);
  let last = 0;
  (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push((now) => {
    if (api.enabled) followSky();
    if (!api.enabled || document.hidden || now - last < 250) return;
    last = now;
    try { if (typeof ground !== 'undefined' && ground.visible) ground.visible = false; } catch (_) {}
    syncScenery(now);
    const t0 = performance.now();
    ensureNear(player.position.x, player.position.z, MAX_PER_TICK);
    api.lastBuilt = performance.now() - t0;
  });
})();
