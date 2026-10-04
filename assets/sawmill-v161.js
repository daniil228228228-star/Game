/* v161 sawmill redesign (user, iPhone test: "лесопилка не выглядит как реальная, делай ее редизайн").
 *
 * The old mill was one siding box with a gable roof and a window row -- it read as a house. This module builds the
 * mill that stands at SAWMILL_POS as an open timber-frame sawmill:
 *   - post-and-beam shed with king-post trusses and a corrugated gable roof (open on the front and on both gables),
 *   - the log conveyor from the generator camp runs straight into a saw carriage (the whole mill is yawed so its
 *     long axis is the belt axis; conveyorData / dropoff / pads / collider are untouched),
 *   - a log on the carriage, a big circular saw blade on an arbor housing (spins), dust hood + exhaust stack through the roof,
 *   - a plank conveyor leading out of the saw to stacked sawn planks, lumber stacks under the roof, a sawdust pile,
 *   - a pyramid of round logs (end grain visible) on the west side as the log yard.
 *   level 2: bigger roof with ridge vent, a second (edger) saw with its own exhaust duct, more stacks; level 3: third (cross-cut) saw,
 *   lean-to roof over the plank stacks, more stacks, a work lamp.
 * Only existing materials/helpers (createWoodMaterial & co with the game's textures), no new textures. Every static
 * piece of one material is merged into ONE mesh (the old mill was ~45 meshes, this one is 12-18), logs/caps use
 * material arrays so the surface-UV scan keeps their smooth normals.
 * Rebuilt by refreshSawmillVisualsV161() when industrialLevelV161('sawmill') changes (called from
 * refreshIndustrialBadgesV161, which also runs on a 700 ms interval and after load()).
 */
'use strict';

const SAWMILL_SPIN_V161 = 4.2; // rad/s: slow enough that 16 teeth do not strobe against 30-60 fps frames
let sawmillMillV161 = null;     // THREE.Group currently in the scene
let sawmillMillLevelV161 = 0;

function sawmillBatchV161() {
  const pos = [], nor = [], uv = [], idx = [];
  const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), v = new THREE.Vector3();
  function addMatrix(geo, matrix) {
    n3.getNormalMatrix(matrix);
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize(); nor.push(v.x, v.y, v.z);
      uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
    }
    const I = geo.index;
    for (let k = 0; k < I.count; k++) idx.push(base + I.getX(k));
    geo.dispose();
  }
  function add(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    q.setFromEuler(e.set(rx, ry, rz, 'XYZ'));
    addMatrix(geo, m4.compose(p.set(x, y, z), q, sc));
  }
  // beam / slab between two points: local z runs a->b, local y is "up" as far as the direction allows
  const xa = new THREE.Vector3(), ya = new THREE.Vector3(), za = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function bar(ax, ay, az, bx, by, bz, w, h) {
    za.set(bx - ax, by - ay, bz - az);
    const len = za.length(); if (len < 1e-4) return;
    za.multiplyScalar(1 / len);
    xa.crossVectors(Math.abs(za.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : up, za).normalize();
    ya.crossVectors(za, xa).normalize();
    m4.makeBasis(xa, ya, za).setPosition((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    addMatrix(new THREE.BoxGeometry(w, h, len), m4);
  }
  return {
    add, bar,
    box: (w, h, d, x, y, z, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz),
    cyl: (rt, rb, h, seg, x, y, z, rx, ry, rz, open) => add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!open), x, y, z, rx, ry, rz),
    circle: (r, seg, x, y, z, rx, ry, rz) => add(new THREE.CircleGeometry(r, seg), x, y, z, rx, ry, rz),
    get count() { return idx.length / 3; },
    toMesh(material, { cast = true, receive = true, name = '' } = {}) {
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, material);
      if (Array.isArray(material)) g.addGroup(0, idx.length, 0); // array material: the surface-UV scan skips it, normals stay smooth
      mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.name = name;
      return mesh;
    },
  };
}

// circular saw blade (disc + teeth merged into one mesh), axis = local z; the caller spins the returned group about z
function sawmillBladeV161(radius, material) {
  const b = sawmillBatchV161();
  b.cyl(radius, radius, 0.05, 28, 0, 0, 0, Math.PI / 2, 0, 0);
  const teeth = 18;
  for (let i = 0; i < teeth; i++) {
    const a = i * Math.PI * 2 / teeth;
    b.box(radius * 0.16, radius * 0.3, 0.04, Math.cos(a) * radius * 1.0, Math.sin(a) * radius * 1.0, 0, 0, 0, a - Math.PI / 2);
  }
  // hub
  b.cyl(radius * 0.16, radius * 0.16, 0.1, 12, 0, 0, 0, Math.PI / 2, 0, 0);
  const spin = new THREE.Group();
  const mesh = b.toMesh(material, { name: 'v161SawBlade' });
  spin.add(mesh);
  return spin;
}

function buildSawmillMillV161(level) {
  level = Math.max(1, Math.min(3, Math.floor(Number(level)) || 1));
  const root = new THREE.Group();
  root.name = 'v161SawmillMill';
  root.userData.levelV161 = level;
  root.userData.spinners = [];
  // yaw so local +x points at the generator camp (the belt axis) and local +z faces south/the pads
  const u = new THREE.Vector3().subVectors(GENERATOR_POS, SAWMILL_POS).setY(0).normalize();
  root.rotation.y = Math.atan2(-u.z, u.x);
  root.userData.yawV161 = root.rotation.y;

  // createXMaterial() whitens every tint by 50-70 %, which can only give pastel colours; the mill wants real rust/dark timber,
  // so the same surface families (same textures) are tinted directly.
  const surf = (family, hex, opts = {}) => createSurfaceMaterialV152(family, new THREE.Color(hex), opts);
  const timberMat = surf('wood', 0x8a6646, { roughness: 0.9 });
  const wallMat = surf('wood', 0xb58a5a, { roughness: 0.9 });
  const plankMat = surf('wood', 0xe3c590, { roughness: 0.9 });
  const roofMat = surf('corrugated', 0xa5604b, { roughness: 0.78, metalness: 0.2 });
  const metalMat = surf('metal', 0x929ba6, { roughness: 0.62 });
  const bladeMat = surf('metal', 0xe6e9ee, { roughness: 0.3, metalness: 0.7 });
  const barkMat = surf('wood', 0x7a5636, { roughness: 0.92 });
  const grainMat = surf('wood-end', 0xe6c28c, { roughness: 0.95 });
  const sawdustMat = new THREE.MeshStandardMaterial({ color: 0xcdb487, roughness: 1, metalness: 0 });

  const T = sawmillBatchV161();   // structural timber
  const W = sawmillBatchV161();   // back wall boarding
  const R = sawmillBatchV161();   // corrugated roof sheets
  const P = sawmillBatchV161();   // sawn planks / lumber stacks
  const M = sawmillBatchV161();   // metal: arbor housing, hood, stack, plank conveyor
  const LG = sawmillBatchV161();  // log sides
  const LC = sawmillBatchV161();  // log end grain
  const D = sawmillBatchV161();   // sawdust

  const FLOOR = 0.22, EAVE = 2.55;
  const RW = level >= 2 ? 2.14 : 1.98, RH = level >= 2 ? 1.12 : 0.95; // roof half-width / rise (L2+: bigger roof)
  const ROOF_LEN = level >= 2 ? 5.7 : 5.3;

  // ---- base: foundation + sandy floor slab
  const found = createFoundation(5.0, 3.8, 0.18, 0xcdbfa8);
  root.add(found);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.04, 4.3), createConcreteMaterial(0xd0bb92));
  floor.position.set(0, 0.2, 0.1); floor.receiveShadow = true; root.add(floor);

  // ---- timber frame: 6 posts, plates, tie beams, king-post trusses, knee braces, ridge
  const POSTX = [-2.3, 0, 2.3], POSTZ = [-1.7, 1.7];
  for (const x of POSTX) for (const z of POSTZ) T.box(0.17, EAVE - FLOOR, 0.17, x, (EAVE + FLOOR) / 2, z);
  for (const z of POSTZ) T.box(4.95, 0.16, 0.18, 0, EAVE + 0.05, z);
  for (const x of POSTX) {
    T.box(0.15, 0.15, 3.7, x, EAVE + 0.02, 0);
    T.box(0.13, RH - 0.1, 0.13, x, EAVE + 0.1 + (RH - 0.1) / 2, 0);            // king post
    for (const s of [-1, 1]) T.bar(x, EAVE + 0.05, s * 1.85, x, EAVE + RH - 0.02, 0, 0.12, 0.12); // rafters
    for (const s of [-1, 1]) T.bar(x, 1.75, s * 1.7, x, EAVE + 0.04, s * 1.05, 0.11, 0.11);        // knee braces
  }
  T.box(ROOF_LEN - 0.2, 0.14, 0.16, 0, EAVE + RH + 0.04, 0);                 // ridge beam
  for (const s of [-1, 1]) T.bar(-2.3, 0.3, s * 1.7, 2.3, 0.3, s * 1.7, 0.08, 0.08); // low rails (front/back)

  // ---- roof sheets (two slabs with overhang) + ridge cap
  for (const s of [-1, 1]) R.bar(0, EAVE + RH - 0.01, 0, 0, EAVE - 0.02, s * (RW + 0.0), ROOF_LEN, 0.07);
  R.box(ROOF_LEN + 0.1, 0.1, 0.34, 0, EAVE + RH + 0.1, 0, 0, 0, 0); // ridge cap (flat; reads as the folded sheet cap)
  if (level >= 2) { // clerestory ridge vent
    R.box(ROOF_LEN * 0.5, 0.22, 0.5, 0, EAVE + RH + 0.2, 0);
  }
  // ---- back wall boarding (north), low, so the interior stays readable from the front
  W.box(4.7, 1.25, 0.07, 0, FLOOR + 0.625, -1.8);
  W.box(0.07, 1.0, 3.2, -2.46, FLOOR + 0.5, 0);    // west gable half-wall

  // ---- saw carriage on the belt axis (z = 0): trestles, two deck boards with the blade slot between them
  const XB = -1.15; // blade x
  for (const x of [-2.0, -1.15, -0.3]) for (const z of [-0.36, 0.36]) T.box(0.13, 0.6, 0.13, x, FLOOR + 0.3, z);
  T.box(2.3, 0.12, 0.44, XB, 0.87, -0.28);
  T.box(2.3, 0.12, 0.44, XB, 0.87, 0.28);
  T.bar(-2.25, 0.6, -0.5, 0.15, 0.6, -0.5, 0.1, 0.1);
  T.bar(-2.25, 0.6, 0.5, 0.15, 0.6, 0.5, 0.1, 0.1);
  // log clamped on the carriage + the slab already cut off beside it
  const LOGR = 0.27, LOGL = 1.9;
  LG.cyl(LOGR, LOGR, LOGL, 12, XB - 0.1, 0.93 + LOGR, -0.2, 0, 0, Math.PI / 2, true);
  for (const s of [-1, 1]) LC.circle(LOGR * 0.99, 12, XB - 0.1 + s * (LOGL / 2 + 0.002), 0.93 + LOGR, -0.2, 0, s * Math.PI / 2, 0);
  P.box(1.9, 0.07, 0.4, XB - 0.1, 0.96, 0.3);
  T.box(0.12, 0.3, 0.12, XB - 1.0, 1.1, 0.3); T.box(0.12, 0.3, 0.12, XB + 0.8, 1.1, -0.55); // log dogs
  T.bar(0.9, 0.34, 0, 0.0, 0.88, 0, 0.8, 0.06); // skid ramp from the belt end up to the carriage

  // ---- circular saw (blade spins about its own z axis) on an arbor housing behind it
  const bladeY = 1.55;
  M.box(0.55, 0.6, 0.5, XB, bladeY, -0.92);
  M.cyl(0.05, 0.05, 0.8, 10, XB, bladeY, -0.55, Math.PI / 2, 0, 0);
  M.bar(XB - 0.3, FLOOR, -1.1, XB - 0.15, bladeY - 0.2, -0.95, 0.1, 0.1);
  M.bar(XB + 0.3, FLOOR, -1.1, XB + 0.15, bladeY - 0.2, -0.95, 0.1, 0.1);
  // dust hood over the blade + exhaust stack through the roof
  M.cyl(0.2, 0.52, 0.42, 4, XB, bladeY + 0.78, 0.02, 0, Math.PI / 4, 0);
  M.cyl(0.11, 0.11, EAVE + RH + 0.55 - (bladeY + 0.98), 10, XB, (bladeY + 0.98 + EAVE + RH + 0.55) / 2, 0.02, 0, 0, 0);
  M.cyl(0.04, 0.26, 0.2, 10, XB, EAVE + RH + 0.65, 0.02, 0, 0, 0); // rain cap
  const blade = sawmillBladeV161(0.58, bladeMat);
  blade.position.set(XB, bladeY, 0.0);
  root.add(blade);
  root.userData.spinners.push({ node: blade, speed: SAWMILL_SPIN_V161 });
  root.userData.primaryBlade = blade;

  // ---- plank conveyor out of the saw to the front stack
  const CZ0 = 0.55, CZ1 = 2.3, CY = 0.88;
  M.box(0.66, 0.08, CZ1 - CZ0, XB, CY, (CZ0 + CZ1) / 2);
  for (const s of [-1, 1]) M.box(0.05, 0.1, CZ1 - CZ0, XB + s * 0.33, CY + 0.06, (CZ0 + CZ1) / 2);
  for (const z of [0.8, 1.5, 2.2]) for (const s of [-1, 1]) M.box(0.08, CY - FLOOR, 0.08, XB + s * 0.28, FLOOR + (CY - FLOOR) / 2, z);
  for (let i = 0; i < 6; i++) M.cyl(0.045, 0.045, 0.6, 8, XB, CY + 0.06, CZ0 + 0.15 + i * 0.3, 0, 0, Math.PI / 2);
  for (const z of [0.9, 1.45, 2.0]) P.box(0.5, 0.05, 0.14, XB, CY + 0.12, z);

  // ---- lumber stacks: boards in layers with stickers, 3 boards wide (x = board length direction)
  function pile(x, z, layers, yaw = 0, len = 1.5, wide = 3) {
    for (let i = 0; i < layers; i++) {
      const y = FLOOR + 0.045 + i * 0.085;
      for (let k = 0; k < wide; k++) {
        const dz = (k - (wide - 1) / 2) * 0.27;
        const off = (i % 2 ? 0.05 : -0.04); // staggered board ends
        P.add(new THREE.BoxGeometry(len, 0.07, 0.25), x + Math.cos(yaw) * off + Math.sin(yaw) * dz, y, z - Math.sin(yaw) * off + Math.cos(yaw) * dz, 0, yaw, 0);
      }
    }
    for (const s of [-0.5, 0, 0.5]) T.add(new THREE.BoxGeometry(0.05, layers * 0.085 + 0.02, 0.27 * wide + 0.04), x + Math.cos(yaw) * s * len * 0.9, FLOOR + (layers * 0.085 + 0.02) / 2, z - Math.sin(yaw) * s * len * 0.9, 0, yaw, 0);
  }
  pile(-1.5, -1.1, 6, 0, 1.5);                      // under the roof, against the back wall (all levels)
  pile(XB, 2.85, 6, 0.04, 1.35);                    // at the end of the plank conveyor
  pile(0.45, 3.0, 4, -0.08, 1.4);
  if (level >= 2) { pile(0.35, -1.12, 7, 0.0, 1.3); pile(-2.2, 3.05, 5, 0.12, 1.2); }
  if (level >= 3) { pile(-1.15, 3.9, 5, 0.03, 1.3); pile(0.7, 4.0, 3, -0.1, 1.3); }

  // ---- log yard on the west side: 4-3-2-1 pyramid of round logs lying along z (end grain faces the viewer)
  const yardX = -3.55, yardZ = 0.1, LR = 0.22, LL = 2.2;
  const rows = [[4, 0], [3, 1], [2, 2], [1, 3]];
  for (const [n, r] of rows) for (let i = 0; i < n; i++) {
    const x = yardX + (i - (n - 1) / 2) * (LR * 2.04), y = FLOOR + LR + r * LR * 1.78;
    LG.cyl(LR, LR, LL, 10, x, y, yardZ, Math.PI / 2, 0, 0, true);
    for (const s of [-1, 1]) LC.circle(LR * 0.99, 10, x, y, yardZ + s * (LL / 2 + 0.002), 0, s > 0 ? 0 : Math.PI, 0);
  }
  T.box(0.14, 0.14, LL + 0.2, yardX - 0.95, FLOOR + 0.07, yardZ); T.box(0.14, 0.14, LL + 0.2, yardX + 0.95, FLOOR + 0.07, yardZ); // sleepers
  T.box(0.14, 0.5, 0.14, yardX - 1.2, FLOOR + 0.25, yardZ - LL / 2 - 0.1); T.box(0.14, 0.5, 0.14, yardX + 1.2, FLOOR + 0.25, yardZ - LL / 2 - 0.1); // stakes
  if (level >= 2) { // loose logs on the ground beside the pyramid
    for (const [x, z, r] of [[-3.2, 1.75, 0.2], [-3.65, 1.9, 0.2]]) {
      LG.cyl(r, r, 1.6, 10, x, FLOOR + r, z, 0, 0.35, Math.PI / 2, true);
      for (const s of [-1, 1]) LC.circle(r * 0.99, 10, x + Math.cos(0.35) * s * 0.802, FLOOR + r, z - Math.sin(0.35) * s * 0.802, 0, s * Math.PI / 2 + 0.35, 0);
    }
  }

  // ---- sawdust
  D.cyl(0.02, 0.62, 0.32, 9, XB - 0.15, FLOOR + 0.16, 0.95, 0, 0, 0);
  D.cyl(0.02, 0.38, 0.2, 8, XB + 0.5, FLOOR + 0.1, 0.78, 0, 0, 0);
  D.cyl(0.02, 0.34, 0.18, 8, XB - 0.9, FLOOR + 0.09, 1.1, 0, 0, 0);
  D.cyl(0.02, 0.5, 0.26, 9, XB + 0.2, FLOOR + 0.13, -0.95, 0, 0, 0);

  // ---- level 2: second (edger) saw on its own bench, behind the belt; its own small hood
  if (level >= 2) {
    T.box(1.0, 0.1, 0.78, 1.55, 0.82, -1.2);
    for (const sx of [-0.42, 0.42]) for (const sz of [-0.3, 0.3]) T.box(0.1, 0.6, 0.1, 1.55 + sx, FLOOR + 0.3, -1.2 + sz);
    M.box(0.4, 0.36, 0.36, 1.55, 1.05, -1.38);
    M.cyl(0.1, 0.34, 0.3, 4, 1.55, 1.78, -1.03, 0, Math.PI / 4, 0);
    M.cyl(0.08, 0.08, 2.06, 8, 1.55, 2.96, -1.03, 0, 0, 0);          // edger exhaust duct up through the roof
    M.cyl(0.03, 0.2, 0.18, 8, 1.55, 4.0, -1.03, 0, 0, 0);            // rain cap
    const b2 = sawmillBladeV161(0.38, bladeMat);
    b2.position.set(1.55, 1.2, -1.03);
    root.add(b2);
    root.userData.spinners.push({ node: b2, speed: -SAWMILL_SPIN_V161 * 1.15 });
    D.cyl(0.02, 0.4, 0.2, 8, 1.55, FLOOR + 0.1, -0.7, 0, 0, 0);
  }
  // ---- level 3: cross-cut saw (blade axis along x) next to the plank conveyor, second exhaust stack, lean-to over the plank stacks, work lamp
  if (level >= 3) {
    T.box(0.85, 0.1, 0.8, -2.05, 0.82, 1.25);
    for (const sx of [-0.35, 0.35]) for (const sz of [-0.3, 0.3]) T.box(0.1, 0.6, 0.1, -2.05 + sx, FLOOR + 0.3, 1.25 + sz);
    M.box(0.34, 0.34, 0.4, -2.38, 1.12, 1.25);
    const holder = new THREE.Group();
    holder.position.set(-2.05, 1.3, 1.25); holder.rotation.y = Math.PI / 2;
    const b3 = sawmillBladeV161(0.32, bladeMat);
    holder.add(b3);
    root.add(holder);
    root.userData.spinners.push({ node: b3, speed: SAWMILL_SPIN_V161 * 1.3 });
    // lean-to roof over the front stacks (4 posts + one sloped corrugated sheet)
    for (const [x, z] of [[-1.9, 3.7], [0.0, 3.7], [-1.9, 4.5], [0.0, 4.5]]) T.box(0.12, 1.5 + (z > 4 ? -0.18 : 0), 0.12, x, FLOOR + (1.5 + (z > 4 ? -0.18 : 0)) / 2, z);
    R.add(new THREE.BoxGeometry(2.5, 0.06, 1.35), -0.95, FLOOR + 1.5, 4.1, Math.atan2(0.18, 0.8), 0, 0);
    // work lamp on the front-right post
    M.box(0.06, 0.06, 0.4, 2.3, EAVE - 0.25, 2.0);
    M.cyl(0.06, 0.12, 0.1, 8, 2.3, EAVE - 0.3, 2.2, 0, 0, 0);
  }

  const add = (mesh) => { if (mesh) root.add(mesh); return mesh; };
  add(T.toMesh(timberMat, { name: 'v161SawmillFrame' }));
  add(W.toMesh(wallMat, { name: 'v161SawmillWall' }));
  add(R.toMesh(roofMat, { name: 'v161SawmillRoof' }));
  add(P.toMesh(plankMat, { name: 'v161SawmillPlanks' }));
  add(M.toMesh(metalMat, { name: 'v161SawmillMetal' }));
  add(LG.toMesh([barkMat], { name: 'v161SawmillLogs' }));
  add(LC.toMesh([grainMat], { name: 'v161SawmillLogEnds', cast: false }));
  add(D.toMesh(sawdustMat, { name: 'v161SawmillSawdust', cast: false }));
  return root;
}

function updateSawmillMillV161(dt) {
  const list = sawmillMillV161?.userData?.spinners;
  if (!list) return;
  for (const s of list) s.node.rotation.z += dt * s.speed;
}

// (Re)build the mill for the current production level. Cheap when nothing changed (compares one number).
function refreshSawmillVisualsV161() {
  if (!sawmillBuiltV118 || !sawmillMillV161) return;
  const lv = Math.min(3, industrialLevelV161('sawmill'));
  if (lv === sawmillMillLevelV161) return;
  const old = sawmillMillV161;
  scene.remove(old);
  disposeObject3D(old);
  installSawmillMillV161(lv);
}

function installSawmillMillV161(level) {
  const mill = buildSawmillMillV161(level);
  mill.position.copy(SAWMILL_POS);
  scene.add(mill);
  sawmillMillV161 = mill;
  sawmillMillLevelV161 = mill.userData.levelV161;
  sawmillBlade = mill.userData.primaryBlade; // legacy handle (tests/other layers may read it)
  return mill;
}
