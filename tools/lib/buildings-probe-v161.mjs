// Shared browser-side probe for tools/showcase-v161.mjs and tests/buildings-physics.test.mjs (2026-10-05 (4), "improve physics and design of every building").
// `installProbe` is serialised into the page (page.evaluate(installProbe)) and defines window.__BLD_PROBE__. Everything it measures is read from the REAL scene:
// meshes come from the game's own builders (createBuildingMesh / live groups), colliders come from the real v83 registry (registerRoot = what rebuildStatic
// does for every stage building) and are driven through the game's own resolvePlayerCircleCollisions().
//
// Definitions used by the report (all in world metres, 0.1 m raster):
//   footprint F  = XZ cells enclosed by WALLS: the near-vertical triangles (|normal.y| < 0.35) of visible, opaque, not `userData.v161Soft` meshes that reach at least
//                  0.12 m into the torso band y 0.3..1.2 m are rasterised as line segments, the cells that cannot be reached from outside by a 4-connected flood
//                  fill are the footprint (walls, wings, garages, tanks, silos; fences/hedges are tagged soft; components under 0.12 m2 (posts) are dropped).
//                  This reads the real triangles, so merged meshes and rotated buildings are measured the same way as one box per mesh.
//   collider C   = XZ cells covered by the registry entries with the `player` flag that belong to the building (owner === root, or - for live industrial
//                  groups - non-tree/decor entries whose centre is inside the group bounds + 2.5 m)
//   overlap      = |F and C| / |F|;  uncovered = |F minus C| (m2);  outside = |C minus F| (m2), outsideMax = max distance from a C-only cell to F (m)
//   sweep        = a player circle (PLAYER_RADIUS) walked from 8 directions towards the footprint centre through resolvePlayerCircleCollisions with ONLY the
//                  building's own entries; reached = the player centre ever stood inside an F cell
export function installProbe() {
  const P = (window.__BLD_PROBE__ = {});
  const CELL = 0.1;
  const BAND0 = 0.3, BAND1 = 1.2;

  const visibleUp = (o, root) => { for (let p = o; p; p = p.parent) { if (p.visible === false) return false; if (p === root) break; } return true; };
  const round = (v, n = 2) => (Number.isFinite(v) ? +v.toFixed(n) : v);

  // ---------------------------------------------------------------------------------------------- isolation
  let hidden = null;
  P.isolate = (keep = []) => {
    if (hidden) return;
    hidden = [];
    const keepSet = new Set(keep);
    for (const o of scene.children) {
      if (o.isLight || o === ground || keepSet.has(o) || o.isCamera) continue;
      if (o.visible) { hidden.push(o); o.visible = false; }
    }
  };
  P.restore = () => { for (const o of hidden || []) o.visible = true; hidden = null; };

  // ---------------------------------------------------------------------------------------------- parts / raster helpers
  function collectParts(root) {
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const lb = o.geometry.boundingBox;
      if (!lb || !Number.isFinite(lb.min.x)) return;
      const wb = lb.clone().applyMatrix4(o.matrixWorld);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const transparent = !!(m && m.transparent && (m.opacity ?? 1) < 0.95);
      parts.push({ o, lb, wb, inv: o.matrixWorld.clone().invert(), visible: visibleUp(o, root), transparent, soft: !!o.userData?.v161Soft, sprite: false });
    });
    return parts;
  }
  function massParts(parts) {
    return parts.filter((p) => p.visible && !p.transparent && !p.soft && p.wb.max.y > BAND0 && p.wb.min.y < BAND1 && p.wb.min.y > -5);
  }
  function rasterBounds(parts, extra) {
    const b = new THREE.Box3();
    for (const p of parts) b.union(p.wb);
    b.min.x -= extra; b.min.z -= extra; b.max.x += extra; b.max.z += extra;
    return b;
  }
  function makeGrid(b) {
    const nx = Math.max(1, Math.ceil((b.max.x - b.min.x) / CELL)), nz = Math.max(1, Math.ceil((b.max.z - b.min.z) / CELL));
    return { x0: b.min.x, z0: b.min.z, nx, nz, cx: (i) => b.min.x + (i + 0.5) * CELL, cz: (j) => b.min.z + (j + 0.5) * CELL };
  }
  function rasterMass(grid, mass) {
    const nx = grid.nx, nz = grid.nz, W = new Uint8Array(nx * nz);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const mark = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(len / 0.03));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, i = Math.floor((x0 + (x1 - x0) * t - grid.x0) / CELL), j = Math.floor((z0 + (z1 - z0) * t - grid.z0) / CELL);
        if (i >= 0 && j >= 0 && i < nx && j < nz) W[j * nx + i] = 1;
      }
    };
    for (const p of mass) {
      const g = p.o.geometry, pos = g.attributes.position, idx = g.index, m = p.o.matrixWorld;
      const count = idx ? idx.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        const lo = Math.min(a.y, b.y, c.y), hi = Math.max(a.y, b.y, c.y);
        if (Math.min(hi, BAND1) - Math.max(lo, BAND0) < 0.12) continue;
        e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2);
        const L = n.length(); if (L < 1e-6) continue;
        if (Math.abs(n.y / L) >= 0.35) continue;
        // longest horizontal edge of the triangle = its footprint on the ground
        const P = [a, b, c]; let best = 0, bi = 0, bj = 1;
        for (let u = 0; u < 3; u++) for (let v = u + 1; v < 3; v++) { const d = Math.hypot(P[u].x - P[v].x, P[u].z - P[v].z); if (d > best) { best = d; bi = u; bj = v; } }
        if (best > 1e-4) mark(P[bi].x, P[bi].z, P[bj].x, P[bj].z);
      }
    }
    // flood from the border over non-wall cells; everything not reached is enclosed (or wall)
    const out = new Uint8Array(nx * nz), stack = [];
    const push = (i, j) => { if (i < 0 || j < 0 || i >= nx || j >= nz) return; const k = j * nx + i; if (out[k] || W[k]) return; out[k] = 1; stack.push(k); };
    for (let i = 0; i < nx; i++) { push(i, 0); push(i, nz - 1); }
    for (let j = 0; j < nz; j++) { push(0, j); push(nx - 1, j); }
    while (stack.length) { const k = stack.pop(), i = k % nx, j = (k / nx) | 0; push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1); }
    const F = new Uint8Array(nx * nz);
    for (let k = 0; k < F.length; k++) F[k] = out[k] ? 0 : 1;
    // drop tiny components (posts, poles): 8-connected, < 12 cells
    const seen = new Uint8Array(nx * nz);
    for (let k0 = 0; k0 < F.length; k0++) {
      if (!F[k0] || seen[k0]) continue;
      const comp = [k0]; seen[k0] = 1;
      for (let q = 0; q < comp.length; q++) {
        const k = comp[q], i = k % nx, j = (k / nx) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const kk = jj * nx + ii; if (F[kk] && !seen[kk]) { seen[kk] = 1; comp.push(kk); }
        }
      }
      if (comp.length < 12) for (const k of comp) F[k] = 0;
    }
    return F;
  }
  function inEntry(e, x, z) {
    if (e.shape === 'obb') {
      const yaw = Number(e.yaw) || 0, sy = Math.sin(yaw), cy = Math.cos(yaw), dx = x - e.pos.x, dz = z - e.pos.z;
      const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
      return Math.abs(lx) <= e.hx && Math.abs(lz) <= e.hz;
    }
    return Math.hypot(x - e.pos.x, z - e.pos.z) <= e.radius;
  }
  function rasterEntries(grid, entries) {
    const C = new Uint8Array(grid.nx * grid.nz);
    for (const e of entries) {
      const r = e.shape === 'obb' ? Math.hypot(e.hx, e.hz) : e.radius;
      const i0 = Math.max(0, Math.floor((e.pos.x - r - grid.x0) / CELL)), i1 = Math.min(grid.nx - 1, Math.floor((e.pos.x + r - grid.x0) / CELL));
      const j0 = Math.max(0, Math.floor((e.pos.z - r - grid.z0) / CELL)), j1 = Math.min(grid.nz - 1, Math.floor((e.pos.z + r - grid.z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!C[j * grid.nx + i] && inEntry(e, grid.cx(i), grid.cz(j))) C[j * grid.nx + i] = 1;
    }
    return C;
  }
  // chamfer distance (cells) from every cell to the nearest F cell
  function distanceTo(grid, F) {
    const INF = 1e9, d = new Float32Array(grid.nx * grid.nz).fill(INF), nx = grid.nx, nz = grid.nz;
    for (let k = 0; k < F.length; k++) if (F[k]) d[k] = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) { v = Math.min(v, d[k - nx] + 1); if (i > 0) v = Math.min(v, d[k - nx - 1] + 1.4142); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + 1.4142); }
      d[k] = v;
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i; let v = d[k];
      if (i < nx - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < nz - 1) { v = Math.min(v, d[k + nx] + 1); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + 1.4142); if (i > 0) v = Math.min(v, d[k + nx - 1] + 1.4142); }
      d[k] = v;
    }
    return d;
  }

  // ---------------------------------------------------------------------------------------------- registry access
  const reg = () => window.__TYCOON_V83_COLLISIONS__;
  P.ownEntries = (root) => {
    const out = [];
    for (const e of reg().registry.values()) if (e.flags?.player && e.owner === root) out.push(e);
    return out;
  };
  P.nearEntries = (box, margin = 2.5) => {
    const out = [];
    for (const e of reg().registry.values()) {
      if (!e.flags?.player || ['tree', 'decor', 'decorSoft', 'vehicle', 'construction'].includes(e.category)) continue;
      const r = e.shape === 'obb' ? Math.hypot(e.hx, e.hz) : e.radius;
      if (e.pos.x + r < box.min.x - margin || e.pos.x - r > box.max.x + margin || e.pos.z + r < box.min.z - margin || e.pos.z - r > box.max.z + margin) continue;
      if (e.pos.x < box.min.x - margin || e.pos.x > box.max.x + margin || e.pos.z < box.min.z - margin || e.pos.z > box.max.z + margin) continue;
      out.push(e);
    }
    return out;
  };

  // ---------------------------------------------------------------------------------------------- measurement
  // root: Object3D already in the scene at its final place, matrices updated. entries: the colliders that belong to it.
  P.measure = (root, entries, opts = {}) => {
    const parts = collectParts(root);
    const parked = parts.filter((p) => p.visible && p.wb.max.y < -5).length;  // pooled objects parked under the world (sawdust, boards): not part of the building
    const vis = parts.filter((p) => p.visible && p.wb.max.y >= -5);
    const box = new THREE.Box3();
    for (const p of vis) box.union(p.wb);
    // lowest / highest point of the visible geometry, ignoring the flat contact-shadow discs (transparent) and ground decals
    const solid = vis.filter((p) => !p.transparent);
    let minY = Infinity, maxY = -Infinity;
    for (const p of solid) { minY = Math.min(minY, p.wb.min.y); maxY = Math.max(maxY, p.wb.max.y); }
    let tris = 0, pairs = new Set();
    for (const p of vis) {
      const g = p.o.geometry; tris += (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3;
      pairs.add(g.uuid + '|' + (Array.isArray(p.o.material) ? p.o.material.map((m) => m.uuid).join(',') : p.o.material?.uuid));
    }
    const geos = new Set(vis.map((p) => p.o.geometry.uuid)), mats = new Set(vis.map((p) => (Array.isArray(p.o.material) ? p.o.material[0] : p.o.material)?.uuid));
    const mass = massParts(parts);
    const out = {
      meshes: vis.length, parked, allMeshes: parts.length, geometries: geos.size, materials: mats.size, tris: Math.round(tris), pairs: pairs.size,
      box: { min: [round(box.min.x), round(box.min.y), round(box.min.z)], max: [round(box.max.x), round(box.max.y), round(box.max.z)] },
      size: [round(box.max.x - box.min.x), round(box.max.y - box.min.y), round(box.max.z - box.min.z)],
      minY: round(minY, 3), maxY: round(maxY, 2), massParts: mass.length,
    };
    const ge = rasterBounds(parts.filter((p) => p.visible), 0.2);
    const eBox = new THREE.Box3().copy(ge);
    for (const e of entries) { const r = e.shape === 'obb' ? Math.hypot(e.hx, e.hz) : e.radius; eBox.expandByPoint(new THREE.Vector3(e.pos.x - r, 0, e.pos.z - r)); eBox.expandByPoint(new THREE.Vector3(e.pos.x + r, 0, e.pos.z + r)); }
    eBox.min.x -= 0.3; eBox.min.z -= 0.3; eBox.max.x += 0.3; eBox.max.z += 0.3;
    const grid = makeGrid(eBox);
    const F = rasterMass(grid, mass), C = rasterEntries(grid, entries);
    let nF = 0, nC = 0, nFC = 0, cxs = 0, czs = 0;
    for (let j = 0; j < grid.nz; j++) for (let i = 0; i < grid.nx; i++) {
      const k = j * grid.nx + i;
      if (F[k]) { nF++; cxs += grid.cx(i); czs += grid.cz(j); }
      if (C[k]) nC++;
      if (F[k] && C[k]) nFC++;
    }
    const A = CELL * CELL;
    out.footprintArea = round(nF * A); out.colliderArea = round(nC * A);
    out.overlap = nF ? round(nFC / nF, 3) : null;
    out.uncovered = round((nF - nFC) * A);
    out.outside = round((nC - nFC) * A);
    const d = distanceTo(grid, F);
    let outMax = 0;
    for (let k = 0; k < C.length; k++) if (C[k] && !F[k]) outMax = Math.max(outMax, d[k] * CELL);
    out.outsideMax = round(outMax);
    out.colliders = entries.map((e) => ({ label: e.label, shape: e.shape, x: round(e.pos.x), z: round(e.pos.z), r: e.shape === 'obb' ? undefined : round(e.radius), hx: e.hx && round(e.hx), hz: e.hz && round(e.hz), yaw: e.yaw && round(e.yaw, 3), flags: Object.keys(e.flags || {}).filter((k) => e.flags[k]).join('+') }));
    out.center = nF ? [round(cxs / nF), round(czs / nF)] : null;
    // swept player test through the centre from 8 directions, only the building's own colliders
    if (nF && opts.sweep !== false) {
      const cx = cxs / nF, cz = czs / nF;
      const R = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 3;
      const saved = playerVelocity.clone();
      const rows = [];
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4, dx = Math.sin(a), dz = Math.cos(a);
        let x = cx + dx * R, z = cz + dz * R, reached = false, minD = 1e9;
        for (let s = 0; s < Math.ceil(R / 0.1) + 40; s++) {
          const nxp = x - dx * 0.1, nzp = z - dz * 0.1;
          playerVelocity.set(-dx * 4, 0, -dz * 4);
          const r = resolvePlayerCircleCollisions(nxp, nzp, entries);
          x = r.x; z = r.z;
          const i = Math.floor((x - grid.x0) / CELL), j = Math.floor((z - grid.z0) / CELL);
          if (i >= 0 && j >= 0 && i < grid.nx && j < grid.nz) { const dd = d[j * grid.nx + i] * CELL; if (dd < minD) minD = dd; if (F[j * grid.nx + i]) reached = true; }
        }
        rows.push({ a: Math.round(a * 180 / Math.PI), reached, endDist: round(Math.hypot(x - cx, z - cz)), minToMass: round(minD) });
      }
      playerVelocity.copy(saved);
      out.sweep = rows;
      out.sweepReached = rows.filter((r) => r.reached).length;
    }
    return out;
  };

  // ---------------------------------------------------------------------------------------------- showing
  const viewSpecs = {
    front: (f, r) => ({ dir: new THREE.Vector3(f.x, 0.18, f.z), up: new THREE.Vector3(0, 1, 0) }),
    side: (f, r) => ({ dir: new THREE.Vector3(r.x, 0.18, r.z), up: new THREE.Vector3(0, 1, 0) }),
    top: (f, r) => ({ dir: new THREE.Vector3(0.0001, 1, 0.0001), up: new THREE.Vector3(-f.x, 0, -f.z) }),
    iso: (f, r) => ({ dir: new THREE.Vector3(f.x * 0.72 + r.x * 0.72, 0.62, f.z * 0.72 + r.z * 0.72), up: new THREE.Vector3(0, 1, 0) }),
  };
  // `only`: render just these scene children (+ lights and the ground) by swapping scene.children for the synchronous render: the game's own loop re-shows
  // roads/foliage it manages, so hiding with .visible is not reliable
  P.shoot = (root, views, { yaw = null, focusFrac = 0.5, only = [root] } = {}) => {
    const keep = new Set(only), full = scene.children;
    scene.children = full.filter((o) => o.isLight || o === ground || keep.has(o));
    try { return shootInner(root, views, yaw, focusFrac); } finally { scene.children = full; }
  };
  const shootInner = (root, views, yaw, focusFrac) => {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const p of collectParts(root)) if (p.visible && p.wb.max.y >= -5 && !(p.transparent && p.wb.max.y < 0.1)) box.union(p.wb);
    if (box.isEmpty()) box.setFromObject(root);
    const c = box.getCenter(new THREE.Vector3()); c.y = box.min.y + (box.max.y - box.min.y) * focusFrac;
    const th = yaw ?? root.rotation.y;
    const f = { x: Math.sin(th), z: Math.cos(th) }, r = { x: Math.cos(th), z: -Math.sin(th) };
    const cv = renderer.domElement, cam = new THREE.PerspectiveCamera(34, cv.width / cv.height, 0.3, 400);
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const calls = {}, shots = {};
    const saveCam = null;
    for (const v of views) {
      const spec = viewSpecs[v](f, r), dir = spec.dir.clone().normalize();
      cam.up.copy(spec.up);
      let lo = 2, hi = 120;
      for (let k = 0; k < 22; k++) {
        const D = (lo + hi) / 2;
        cam.position.copy(c).addScaledVector(dir, D); cam.lookAt(c); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
        let ok = true;
        for (const p of corners) { const q = p.clone().project(cam); if (Math.abs(q.x) > 0.94 || Math.abs(q.y) > 0.94 || q.z > 1) { ok = false; break; } }
        if (ok) hi = D; else lo = D;
      }
      cam.position.copy(c).addScaledVector(dir, hi * 1.02); cam.lookAt(c); cam.updateMatrixWorld(true);
      renderer.render(scene, cam);
      shots[v] = cv.toDataURL('image/jpeg', 0.86);
      if (v === 'iso') {
        const a = renderer.info.render.calls, ta = renderer.info.render.triangles;
        const was = root.visible; root.visible = false; renderer.render(scene, cam); const b = renderer.info.render.calls, tb = renderer.info.render.triangles; root.visible = was;
        calls.draw = a - b; calls.tris = ta - tb;
      }
    }
    return { shots, calls };
  };

  // ---------------------------------------------------------------------------------------------- stage buildings (isolated)
  // mesh from the game's real builder chain (createBuildingMesh = BUILDERS + polish + v44 + finish + late-game wrappers), placed at the origin
  P.stageMesh = (i, L) => {
    const m = createBuildingMesh(STAGES[i], L);
    m.position.set(0, 0, 0);
    m.scale.set(1, 1, 1); m.visible = true;
    scene.add(m);
    m.updateMatrixWorld(true);
    P.forceScan();
    return m;
  };
  // assets/surface-world-v152.js scan() bakes the physical UVs of new meshes on its own 1.5 s tick; an isolated shot must look like the finished game, so the
  // visual ticks are run now with a clock that is always ahead of their throttle
  P.forceScan = () => { P._T = (P._T || performance.now()) + 1700; for (const t of window.__TYCOON_VISUAL_TICKS__ || []) { try { t(P._T); } catch (e) { /* */ } } };
  // neighbourhood mini house (makeMiniHouse), placed at the origin with the collider the game registers for it (circle r 0.92)
  P.miniMesh = (color, accent) => { const m = makeMiniHouse(color, accent); m.position.set(0, 0, 0); scene.add(m); m.updateMatrixWorld(true); P.forceScan(); return m; };
  P.miniEntries = () => [{ shape: 'circle', pos: new THREE.Vector3(0, 0, 0), radius: 0.92, label: 'miniHouse', flags: { player: true } }];
  P.liveByName = (name) => scene.getObjectByName(name);
  P.liveByExpr = (expr) => { try { return new Function('return (' + expr + ')')() || null; } catch (e) { return null; } };
  P.dropMesh = (m) => { try { reg().unregisterOwner(m); } catch (_) { /* */ } scene.remove(m); disposeObject3D(m); };
  P.registerStage = (m, i) => reg().registerRoot(m, 'building', 'probe:stage' + i, { shrink: 0.93 }); // the same call v83 rebuildStatic makes for every built stage building
  P.doorInfo = (m, i) => {
    let door = null; m.traverse((o) => { if (o.userData?.v161Door) door = o; });
    if (!door) return null;
    const w = new THREE.Vector3(); door.getWorldPosition(w);
    const pos = buildingPosition(i), end = stageRoadEndpointV367(i), ox = w.x - m.position.x, oz = w.z - m.position.z;
    const door2 = { x: pos.x + ox, z: pos.z + oz };
    const l1 = Math.hypot(ox, oz) || 1, l2 = Math.hypot(end.x - pos.x, end.z - pos.z) || 1;
    return { dist: round(Math.hypot(door2.x - end.x, door2.z - end.z)), dot: round((ox * (end.x - pos.x) + oz * (end.z - pos.z)) / (l1 * l2), 3), radius: round(stageAccessRadiusV92(i)) };
  };
  P.stageInfo = () => ({ n: STAGES.length, maxLevel: MAX_BUILDING_LEVEL, names: STAGES.map((s) => s.nameEn), arch: STAGES.map((s) => s.archetype), base: STAGES.map((s) => s.baseSize), height: STAGES.map((s) => s.height) });

  // ---------------------------------------------------------------------------------------------- live scene survey (everything the player can see)
  // the late-game world: every staged unlock built, all districts developed, every growth finished (the LATE save is an old-format save: staged flags already true)
  P.buildOut = () => {
    const log = [];
    const T = (name, fn) => { try { const r = fn(); log.push(name + ':' + (r === undefined ? 'ok' : r)); } catch (e) { log.push(name + ':ERR ' + e.message); } };
    money = 5e8; planks = 5000; concrete = 500; metal = 500;
    T('steps', () => { let n = 0; for (const s of (typeof INDUSTRIAL_BUILD_STEPS_V118 !== 'undefined' ? INDUSTRIAL_BUILD_STEPS_V118 : [])) { try { if (buildIndustrialStepV118(s)) n++; } catch (e) { /* */ } } return n; });
    T('districts', () => { for (const d of CITY_DISTRICTS) cityState.districts[d.id] = Math.max(2, cityState.districts[d.id] || 0); ensureInfrastructureStateV37(); for (const d of CITY_DISTRICTS) cityState.districtRoads[d.id].level = Math.max(1, cityState.districtRoads[d.id].level || 0); cityState.population = Math.max(cityState.population || 0, 400); });
    T('sync', () => { syncLivingCityActors(); for (const fn of ['refreshResidentialWorld', 'refreshCivicWorld', 'refreshPoliceWorld', 'refreshSchoolWorld', 'refreshKindergartenWorld', 'refreshNeighborhoodWorld', 'refreshCommercialWorld', 'refreshFireWorld', 'refreshLandPlotWorld', 'refreshBaseWorld', 'refreshSpecialProjectWorld']) { try { globalThis[fn]?.(); } catch (e) { /* */ } } });
    return log;
  };
  P.finishGrowth = () => {
    for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; }
    for (let i = growingMeshes.length - 1; i >= 0; i--) { growingMeshes[i].mesh.visible = true; growingMeshes[i].mesh.scale.set(1, 1, 1); growingMeshes.splice(i, 1); }
    try { __TYCOON_V83_COLLISIONS__.rebuild(); } catch (e) { /* */ }
  };
  // is a player circle standing exactly at (x,z) pushed by anything solid (vehicles ignored: they move)?
  P.blockedAt = (x, z) => {
    const saved = playerVelocity.clone(); playerVelocity.set(0, 0, 0);
    const entries = gatherPhysicsCircles().filter((e) => e.category !== 'vehicle' && !String(e.label || '').startsWith('vehicle'));
    const r = resolvePlayerCircleCollisions(x, z, entries);
    playerVelocity.copy(saved);
    const by = entries.filter((e) => { const rr = resolvePlayerCircleCollisions(x, z, [e]); return rr.hit; }).map((e) => e.label || e.kind || e.category || '?');
    return { hit: !!r.hit, by: by.slice(0, 3), moved: +Math.hypot(r.x - x, r.z - z).toFixed(2) };
  };
  // every place the player or a worker is sent to stand: pickups, drop-offs, upgrade pads, stage pads, industrial pads
  P.workPoints = () => {
    const pts = [];
    const add = (id, p, family) => { if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) pts.push({ id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), family }); };
    for (const k of Object.keys(LOGISTICS_ZONES)) add('pickup:' + k, LOGISTICS_ZONES[k].pos, 'industrial');
    add('sawmill-dropoff', SAWMILL_DROPOFF_POS, 'industrial');
    for (const b of buildings) if (b.upgradePad?.pos) add('upgrade-pad:stage' + b.index, b.upgradePad.pos, STAGES[b.index].archetype === 'house' ? 'house' : 'stage');
    for (const s of (typeof INDUSTRIAL_BUILD_STEPS_V118 !== 'undefined' ? INDUSTRIAL_BUILD_STEPS_V118 : [])) if (s.pos && industrialPadMarkersV118?.has?.(s.id)) add('industrial-pad:' + s.id, s.pos, 'industrial');
    for (const f of (typeof FIELD_UPGRADE_CONFIGS !== 'undefined' ? FIELD_UPGRADE_CONFIGS : [])) add('field-pad:' + (f.key || f.id || ''), f.pos, 'industrial');
    return pts;
  };
  P.roots = [];
  P.survey = () => {
    const rows = []; P.roots = [];
    const skip = (o) => o.isLight || o === ground || o.isCamera || o.userData?.harvestableTree || o.userData?.foliageKindV154 || o.isSprite || o.userData?.v64RandomScenery;
    for (const o of scene.children) {
      if (skip(o)) continue;
      let meshes = 0, tris = 0; o.traverse((m) => { if (m.isMesh) { meshes++; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3; } });
      if (meshes < 3) continue;
      const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) continue;
      const s = b.getSize(new THREE.Vector3());
      if (s.x > 60 || s.z > 60) continue; // roads / terrain layers
      P.roots.push(o);
      rows.push({ idx: rows.length, name: o.name || '', type: o.type, visible: o.visible, parent: o.parent === scene ? 'scene' : '?', meshes, tris: Math.round(tris), cx: round((b.min.x + b.max.x) / 2, 1), cz: round((b.min.z + b.max.z) / 2, 1), w: round(s.x, 1), h: round(s.y, 1), d: round(s.z, 1), minY: round(b.min.y, 2), ud: Object.keys(o.userData || {}).slice(0, 5).join(',') });
    }
    const colliders = [...reg().registry.values()].filter((e) => !['tree', 'decor', 'decorSoft', 'vehicle'].includes(e.category)).map((e) => ({ id: e.id, label: e.label, cat: e.category, shape: e.shape, x: round(e.pos.x, 1), z: round(e.pos.z, 1), r: e.shape === 'obb' ? undefined : round(e.radius), hx: e.hx && round(e.hx), hz: e.hz && round(e.hz), yaw: e.yaw && round(e.yaw, 2), flags: Object.keys(e.flags || {}).filter((k) => e.flags[k]).join('+'), owner: e.owner ? (e.owner.name || e.owner.type) : '' }));
    return { groups: rows, colliders, statics: STATIC_COLLIDERS.map((c) => [round(c.pos.x, 1), round(c.pos.z, 1), c.radius]) };
  };
  P.groupBox = (o) => { const b = new THREE.Box3().setFromObject(o); return b; };
  // a live scene group: real position, only the colliders next to it
  P.measureLive = (root, extra = []) => {
    const box = new THREE.Box3();
    for (const p of collectParts(root)) if (p.visible && p.wb.max.y >= -5) box.union(p.wb);
    const own = P.ownEntries(root), near = P.nearEntries(box, 2.5);
    const set = new Set([...own, ...near, ...extra]);
    return P.measure(root, [...set]);
  };
  P.shootLive = (root, views, opts) => P.shoot(root, views, { ...(opts || {}), only: [root] });
  P.findNamed = (name) => scene.getObjectByName(name);
  P.sceneChildAt = (cx, cz, tol = 1.5) => scene.children.find((o) => { if (o.isLight || o === ground || o.isSprite) return false; const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return false; const s = b.getSize(new THREE.Vector3()); if (s.x > 60 || s.z > 60) return false; return Math.abs((b.min.x + b.max.x) / 2 - cx) < tol && Math.abs((b.min.z + b.max.z) / 2 - cz) < tol; });
  return true;
}
