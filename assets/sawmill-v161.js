/* v161 sawmill v2 (user, iPhone test: "бревна туда-сюда перемешаются нереалистично, добавь живой, конвейер тоже под крышу,
 * единое здание лесопилки, доведи до совершенства").
 *
 * ONE enclosed timber-frame building at SAWMILL_POS (yawed so its long axis is the log-belt axis; local +x points at the
 * generator camp, local +z faces the south pads):
 *   - solid boarded back and west walls with windows, a front wall with window openings and a big plank OUTLET, an open log
 *     LOADING BAY in the east gable (the game's log belt runs in under the roof and ends at the dock), gabled corrugated
 *     roof on king-post trusses, dust hood + exhaust stack through the roof, a lean-to attached to the front wall that roofs
 *     the end of the plank conveyor and the finished-plank stacks;
 *   - level 2: the same hall grows by a north annex (bigger roof section, ridge vent, second log pile, more stacks) and gets a
 *     trimmer saw over the plank belt; level 3: second trimmer saw, deeper lean-to with more stacks, lamp.
 * A real work cycle (no shuttling): a hoist on the runway beam lifts a log from the log pile onto the saw carriage, the carriage
 * moves ONE way slowly through the circular saw (the log gets shorter, the sawn part appears as 3 boards on the plank belt, sawdust
 * puffs), then the carriage returns fast while the hoist fetches the next log; the belt carries the boards out through the outlet
 * and onto the plank stack. The cycle phase is the game's own sawmill timer (sawmillAutoTimer / sawmillAutoInterval()), so the
 * speed follows level 1/2/3 and productionSpeedMultiplier(); the board reaches the stack in the frame the game credits the planks.
 * Everything is driven from updateSawmillMillV161(dt) (called by updateSawmill each frame): no allocations per frame, <= 12 pooled
 * sawdust points, chimney smoke through the game's own spawnSmokePuff() only while producing.
 * Only existing materials (createSurfaceMaterialV152 families), no textures. Static parts of one material are merged into one mesh.
 * Rebuilt by refreshSawmillVisualsV161() when industrialLevelV161('sawmill') changes (refreshIndustrialBadgesV161 -> every 700 ms and after load()).
 */
'use strict';

const SAWMILL_SPIN_V161 = 4.6; // rad/s of the main blade while cutting (slow enough not to strobe against 30-60 fps frames)
let sawmillMillV161 = null;     // THREE.Group currently in the scene
let sawmillMillLevelV161 = 0;
// Local layout (metres, mill frame). Exported for the test and for the scenery code.
const SAWMILL_L_V161 = Object.freeze({
  FLOOR: 0.22, EAVE: 2.5, X0: -2.4, X1: 2.3, ZF: 2.1,
  XB: -0.1,                       // plane of the saw blade (x)
  LOG_L: 1.5, LOG_R: 0.22,
  CX0: 0.95, APPROACH: 0.3, TRAVEL: 1.8,   // carriage (= log) centre x at the start of the pass; the blade is reached after APPROACH
  CRANE_X: 0.95, PILE_Z: -1.0, PILE_Y: 0.77, LOG_Z: -0.28, LOG_Y: 1.15,
  BELT_X: -0.85, BELT_W: 1.7, BELT_Z0: 0.2, BELT_Z1: 3.05, BELT_TOP: 0.62, BELT_TRAVEL: 2.4, RIB_PITCH: 0.3, BELT_END_DOCK: 2.0,
  DUST_MAX: 12,
});
// phases of one cycle (fractions of sawmillAutoInterval())
const SAWMILL_P_V161 = Object.freeze({ CUT0: 0.03, CUT1: 0.60, RET1: 0.70, BOARD0: 0.60, BOARD1: 0.97 });

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
    if (I) for (let k = 0; k < I.count; k++) idx.push(base + I.getX(k));
    else for (let k = 0; k < P.count; k++) idx.push(base + k);
    geo.dispose();
  }
  function add(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    q.setFromEuler(e.set(rx, ry, rz, 'XYZ'));
    addMatrix(geo, m4.compose(p.set(x, y, z), q, sc));
  }
  // beam / slab between two points: local z runs a->b, local y is "up" as far as the direction allows
  const xa = new THREE.Vector3(), ya = new THREE.Vector3(), za = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), ex = new THREE.Vector3(1, 0, 0);
  function bar(ax, ay, az, bx, by, bz, w, h) {
    za.set(bx - ax, by - ay, bz - az);
    const len = za.length(); if (len < 1e-4) return;
    za.multiplyScalar(1 / len);
    xa.crossVectors(Math.abs(za.y) > 0.98 ? ex : up, za).normalize();
    ya.crossVectors(za, xa).normalize();
    m4.makeBasis(xa, ya, za).setPosition((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    addMatrix(new THREE.BoxGeometry(w, h, len), m4);
  }
  // triangular gable infill: triangle in the (z, y) plane at x, base width 2*hw at y0, apex h higher, thickness t along x
  function gable(x, zc, y0, hw, h, t) {
    const g = [], gn = [], gu = [], gi = [];
    const A = [t / 2, 0, -hw], B = [t / 2, 0, hw], C = [t / 2, h, 0], A2 = [-t / 2, 0, -hw], B2 = [-t / 2, 0, hw], C2 = [-t / 2, h, 0];
    const tri = (a, b, c, hint) => {
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
      if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { const tmp = b; b = c; c = tmp; n = [-n[0], -n[1], -n[2]]; }
      const base = g.length / 3;
      for (const pt of [a, b, c]) { g.push(pt[0], pt[1], pt[2]); gn.push(n[0], n[1], n[2]); gu.push((pt[2] + hw) / (2 * hw) * 2, pt[1] / Math.max(h, 0.1)); }
      gi.push(base, base + 1, base + 2);
    };
    tri(A, B, C, [1, 0, 0]); tri(A2, B2, C2, [-1, 0, 0]);
    const sl = h / hw, nL = [0, 1, -sl], nR = [0, 1, sl];
    tri(A, C, C2, nL); tri(A, C2, A2, nL); tri(B, C, C2, nR); tri(B, C2, B2, nR);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(gn, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2));
    geo.setIndex(gi);
    add(geo, x, y0, zc);
  }
  return {
    add, bar, gable,
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
    b.box(radius * 0.16, radius * 0.3, 0.04, Math.cos(a) * radius, Math.sin(a) * radius, 0, 0, 0, a - Math.PI / 2);
  }
  b.cyl(radius * 0.16, radius * 0.16, 0.1, 12, 0, 0, 0, Math.PI / 2, 0, 0); // hub
  const spin = new THREE.Group();
  spin.add(b.toMesh(material, { name: 'v161SawBlade' }));
  return spin;
}

// a mesh that the animation scales (log, boards, cable): array material so the surface-UV scan leaves it alone, one explicit group
function sawmillAnimMeshV161(geo, materials, name, cast = true) {
  geo.clearGroups();
  const n = geo.index ? geo.index.count : geo.attributes.position.count;
  if (materials.length === 1) geo.addGroup(0, n, 0);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.name = name; mesh.castShadow = cast; mesh.receiveShadow = true;
  return mesh;
}

function buildSawmillMillV161(level) {
  level = Math.max(1, Math.min(3, Math.floor(Number(level)) || 1));
  const L = SAWMILL_L_V161;
  const { FLOOR, EAVE, X0, X1, ZF, XB } = L;
  const root = new THREE.Group();
  root.name = 'v161SawmillMill';
  root.userData.levelV161 = level;
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
  const paneMat = surf('metal', 0x1d2a36, { roughness: 0.25, metalness: 0.5 });
  const beltMat = surf('corrugated', 0x3a3f49, { roughness: 0.84, metalness: 0.16 });
  const ribMat = surf('wood', 0x6b4f33, { roughness: 0.9 });
  const barkMat = surf('wood', 0x7a5636, { roughness: 0.92 });
  const grainMat = surf('wood-end', 0xe6c28c, { roughness: 0.95 });
  const sawdustMat = new THREE.MeshStandardMaterial({ color: 0xcdb487, roughness: 1, metalness: 0 });
  const slabMat = createConcreteMaterial(0xcdbfa8);

  const T = sawmillBatchV161();   // structural timber
  const W = sawmillBatchV161();   // wall boarding
  const R = sawmillBatchV161();   // corrugated roof sheets
  const P = sawmillBatchV161();   // sawn planks / lumber stacks
  const M = sawmillBatchV161();   // metal: housing, hood, stack, belt frame, lamps
  const WN = sawmillBatchV161();  // window panes
  const LG = sawmillBatchV161();  // log sides
  const LC = sawmillBatchV161();  // log end grain
  const D = sawmillBatchV161();   // sawdust piles
  const FD = sawmillBatchV161();  // concrete slab
  const BK = sawmillBatchV161();  // plank belt table

  // ---- geometry of this level
  const ZB = level >= 2 ? -3.7 : -1.9;           // back wall: L2+ the hall grows north by an annex bay
  const DEP = ZF - ZB, ZC = (ZF + ZB) / 2;
  const RISE = level >= 2 ? 1.3 : 0.95;
  const HS = DEP / 2 + 0.4;                      // roof half span (eaves overhang 0.4)
  const RX0 = X0 - 0.45, RX1 = X1 + 0.3, RCX = (RX0 + RX1) / 2, RLEN = RX1 - RX0;
  const roofY = (z) => EAVE + RISE - RISE * Math.abs(z - ZC) / (DEP / 2);
  const LEAN_Z1 = level >= 3 ? 4.55 : 3.95;      // low edge of the lean-to over the plank stacks
  const LEAN_X0 = -2.75, LEAN_X1 = 0.3;
  const BENTS = [-2.4, -1.85, 0.2, 1.2, 2.3];   // bents stand beside the plank outlet (x -1.75..0.05), not in it

  // ---- slab: hall + lean-to
  FD.box(X1 - X0 + 0.6, 0.22, DEP + 0.6, (X0 + X1) / 2, 0.11, ZC - 0.1);
  FD.box(LEAN_X1 - LEAN_X0 + 0.1, 0.2, LEAN_Z1 - ZF + 0.2, (LEAN_X0 + LEAN_X1) / 2, 0.1, (ZF + LEAN_Z1) / 2 + 0.1);

  // ---- timber frame: posts, plates, tie beams, king-post trusses, knee braces, ridge, crane runway, saw carriage rails
  const postZ = level >= 2 ? [ZB, -1.9, ZF] : [ZB, ZF];
  for (const x of BENTS) for (const z of postZ) T.box(0.17, EAVE - FLOOR, 0.17, x, (EAVE + FLOOR) / 2, z);
  for (const z of postZ) T.box(X1 - X0 + 0.25, 0.16, 0.18, (X0 + X1) / 2, EAVE + 0.05, z);
  for (const x of BENTS) {
    T.box(0.15, 0.15, DEP, x, EAVE + 0.02, ZC);
    T.box(0.13, RISE - 0.1, 0.13, x, EAVE + 0.1 + (RISE - 0.1) / 2, ZC);                                        // king post
    for (const s of [-1, 1]) T.bar(x, EAVE + 0.05, ZC + s * (DEP / 2 + 0.1), x, EAVE + RISE - 0.02, ZC, 0.12, 0.12); // rafters
    T.bar(x, 1.75, ZF, x, EAVE + 0.04, ZF - 0.65, 0.11, 0.11);                                                   // knee braces
    T.bar(x, 1.75, ZB, x, EAVE + 0.04, ZB + 0.65, 0.11, 0.11);
  }
  T.box(RLEN - 0.2, 0.14, 0.16, RCX, EAVE + RISE + 0.04, ZC);                  // ridge beam
  T.box(0.16, 0.24, DEP, X1, 2.3, ZC);                                          // header of the loading bay (east gable)
  T.box(0.14, 0.2, DEP - 0.2, L.CRANE_X, 2.3, ZC);                              // hoist runway beam (along z)
  T.box(4.1, 0.1, 0.16, -0.1, 0.55, -0.52);                                     // saw carriage rail
  for (const x of [-1.9, -0.8, 0.3, 1.4]) T.box(0.13, 0.33, 0.13, x, FLOOR + 0.165, -0.52);
  T.box(1.95, 0.14, 0.14, -0.85, 1.95, ZF);                                     // lintel of the plank outlet

  // ---- roof sheets (two slabs with overhang) + ridge cap (+ vent) + lean-to roof
  for (const s of [-1, 1]) R.bar(RCX, EAVE + RISE - 0.01, ZC, RCX, EAVE - 0.2, ZC + s * HS, RLEN, 0.07);
  R.box(RLEN + 0.1, 0.1, 0.34, RCX, EAVE + RISE + 0.1, ZC);
  if (level >= 2) R.box(RLEN * 0.5, 0.24, 0.5, RCX, EAVE + RISE + 0.22, ZC);   // ridge vent
  const leanW = LEAN_X1 - LEAN_X0 + 0.3, leanCX = (LEAN_X0 + LEAN_X1) / 2;
  R.bar(leanCX, 1.98, ZF + 0.05, leanCX, 1.55, LEAN_Z1 + 0.2, leanW, 0.06);
  T.box(leanW - 0.2, 0.1, 0.1, leanCX, 1.93, ZF + 0.07);                       // ledger on the front wall
  T.box(leanW - 0.2, 0.1, 0.1, leanCX, 1.5, LEAN_Z1);                          // front beam
  for (const x of [LEAN_X0 + 0.15, (LEAN_X0 + LEAN_X1) / 2, LEAN_X1 - 0.15]) T.box(0.12, 1.5 - FLOOR, 0.12, x, (1.5 + FLOOR) / 2, LEAN_Z1);

  // ---- walls: back (north), west, front with the plank outlet + two window openings, gable infill over the east bay and the west wall
  W.box(X1 - X0 + 0.1, EAVE - FLOOR, 0.07, (X0 + X1) / 2, (EAVE + FLOOR) / 2, ZB);
  W.box(0.07, EAVE - FLOOR, DEP, X0, (EAVE + FLOOR) / 2, ZC);
  W.box(0.65, EAVE - FLOOR, 0.07, -2.075, (EAVE + FLOOR) / 2, ZF);             // front: west stub, full height
  W.box(2.25, 1.0 - FLOOR, 0.07, 1.175, (1.0 + FLOOR) / 2, ZF);                 // front: knee wall east of the outlet
  W.box(4.05, 0.5, 0.07, 0.275, 2.25, ZF);                                      // front: header band over outlet + windows
  for (const [x, w] of [[0.175, 0.25], [1.2, 0.2], [2.2, 0.2]]) W.box(w, 1.0, 0.07, x, 1.5, ZF); // front: studs between the window openings
  W.gable(X0, ZC, EAVE + 0.05, DEP / 2 - 0.02, RISE - 0.2, 0.07);
  W.gable(X1, ZC, EAVE + 0.05, DEP / 2 - 0.02, RISE - 0.2, 0.07);
  // windows: frame (timber) + dark pane, flush with the inside of the wall
  const win = (cx, cy, cz, w, h, axis) => {
    if (axis === 'x') { WN.box(0.02, h, w, cx, cy, cz); T.box(0.06, 0.06, w + 0.12, cx, cy + h / 2 + 0.03, cz); T.box(0.06, 0.06, w + 0.12, cx, cy - h / 2 - 0.03, cz); T.box(0.06, h, 0.06, cx, cy, cz - w / 2 - 0.03); T.box(0.06, h, 0.06, cx, cy, cz + w / 2 + 0.03); T.box(0.05, h, 0.04, cx, cy, cz); }
    else { WN.box(w, h, 0.02, cx, cy, cz); T.box(w + 0.12, 0.06, 0.06, cx, cy + h / 2 + 0.03, cz); T.box(w + 0.12, 0.06, 0.06, cx, cy - h / 2 - 0.03, cz); T.box(0.06, h, 0.06, cx - w / 2 - 0.03, cy, cz); T.box(0.06, h, 0.06, cx + w / 2 + 0.03, cy, cz); T.box(0.04, h, 0.05, cx, cy, cz); }
  };
  win(X0 + 0.02, 1.55, 0.5, 0.75, 0.6, 'x');
  win(X0 + 0.02, 1.55, -0.9, 0.75, 0.6, 'x');
  win(-1.2, 1.6, ZB + 0.02, 0.8, 0.6, 'z');
  win(0.7, 1.6, ZB + 0.02, 0.8, 0.6, 'z');
  if (level >= 2) win(X0 + 0.02, 1.55, -2.8, 0.75, 0.6, 'x');
  // sills/frames of the two front openings
  T.box(0.8, 0.07, 0.12, 0.7, 1.0, ZF + 0.02); T.box(0.8, 0.07, 0.12, 1.7, 1.0, ZF + 0.02);

  // ---- saw: blade on an arbor housing north of the carriage, dust hood, exhaust stack through the roof
  const bladeY = 1.5, bladeZ = -0.2;
  M.box(0.4, 0.6, 0.5, XB, bladeY, -0.95);
  M.cyl(0.05, 0.05, 0.55, 10, XB, bladeY, -0.45, Math.PI / 2, 0, 0);
  M.bar(XB - 0.2, FLOOR, -1.15, XB - 0.15, bladeY - 0.3, -1.0, 0.1, 0.1);
  M.bar(XB + 0.2, FLOOR, -1.15, XB + 0.15, bladeY - 0.3, -1.0, 0.1, 0.1);
  M.cyl(0.2, 0.55, 0.36, 4, XB, 2.2, bladeZ, 0, Math.PI / 4, 0);                // dust hood
  const ductTop = roofY(bladeZ) + 0.75;
  M.cyl(0.11, 0.11, ductTop - 2.35, 10, XB, (2.35 + ductTop) / 2, bladeZ, 0, 0, 0);
  M.cyl(0.04, 0.26, 0.2, 10, XB, ductTop + 0.1, bladeZ, 0, 0, 0);               // rain cap
  const blades = [];
  const blade = sawmillBladeV161(0.58, bladeMat);
  blade.position.set(XB, bladeY, bladeZ);
  root.add(blade);
  blades.push({ node: blade, mult: 1, baseY: bladeY, baseX: XB });
  // motor + transmission box against the west wall
  M.box(0.5, 0.42, 0.42, -2.05, FLOOR + 0.21, -1.0);
  M.cyl(0.14, 0.14, 0.12, 12, -2.05, FLOOR + 0.5, -1.0, 0, 0, 0);
  M.box(0.3, 0.5, 0.2, -2.1, FLOOR + 0.25, -0.35);                               // control cabinet

  // ---- plank belt (inside the hall, out through the outlet to the lean-to): table with side rails, legs, end rollers
  const BX = L.BELT_X, BW = L.BELT_W, BZ0 = L.BELT_Z0, BZ1 = L.BELT_Z1, BLEN = BZ1 - BZ0, BZM = (BZ0 + BZ1) / 2;
  BK.box(BW, 0.08, BLEN, BX, L.BELT_TOP - 0.06, BZM);
  for (const s of [-1, 1]) M.box(0.05, 0.14, BLEN, BX + s * (BW / 2 + 0.02), L.BELT_TOP - 0.01, BZM);
  for (const z of [0.4, 1.4, 2.4, 2.95]) for (const s of [-1, 1]) M.box(0.08, L.BELT_TOP - 0.1 - FLOOR, 0.08, BX + s * (BW / 2 - 0.08), FLOOR + (L.BELT_TOP - 0.1 - FLOOR) / 2, z);
  for (const z of [BZ0 + 0.04, BZ1 - 0.04]) M.cyl(0.07, 0.07, BW + 0.08, 10, BX, L.BELT_TOP - 0.08, z, 0, 0, Math.PI / 2);
  // log belt end: end stop + dock frame where the game's log belt (SAWMILL_BELT_END_V161) ends under the roof
  M.box(0.1, 0.5, 1.5, L.BELT_END_DOCK + 0.12, FLOOR + 0.25, 0);
  for (const z of [-0.78, 0.78]) M.box(0.08, 0.4, 0.08, L.BELT_END_DOCK + 0.05, FLOOR + 0.2, z);

  // ---- log pile at the intake (against the north wall, under the hoist) -- the middle log of the upper row is the one the hoist takes
  const LR = 0.2, LL = L.LOG_L;
  const pileLog = (x, y, z) => {
    LG.cyl(LR, LR, LL, 10, x, y, z, 0, 0, Math.PI / 2, true);
    for (const s of [-1, 1]) LC.circle(LR * 0.99, 10, x + s * (LL / 2 + 0.002), y, z, 0, s * Math.PI / 2, 0);
  };
  const pileX = L.CRANE_X;
  for (const z of [-1.6, -1.2, -0.8]) pileLog(pileX, FLOOR + LR, z);
  pileLog(pileX, FLOOR + LR + 0.35, -1.4);   // (-1.0 is the hoist's log)
  T.box(0.1, 0.4, 0.1, pileX - LL / 2 - 0.05, FLOOR + 0.2, -0.74); T.box(0.1, 0.4, 0.1, pileX + LL / 2 + 0.05, FLOOR + 0.2, -0.74);   // stakes in front of the pile
  if (level >= 2) { // second pile in the annex + loose logs
    for (const [z, row] of [[-2.7, 0], [-3.1, 0], [-3.5, 0], [-2.9, 1], [-3.3, 1]]) {
      const x = -1.0, y = FLOOR + LR + row * 0.35;
      LG.cyl(LR, LR, LL, 10, x, y, z, 0, 0, Math.PI / 2, true);
      for (const s of [-1, 1]) LC.circle(LR * 0.99, 10, x + s * (LL / 2 + 0.002), y, z, 0, s * Math.PI / 2, 0);
    }
  }

  // ---- lumber stacks (boards in layers with stickers); x = board length direction at yaw 0
  function pile(x, z, layers, yaw = 0, len = 1.5, wide = 3) {
    for (let i = 0; i < layers; i++) {
      const y = FLOOR + 0.045 + i * 0.085;
      for (let k = 0; k < wide; k++) {
        const dz = (k - (wide - 1) / 2) * 0.27, off = (i % 2 ? 0.05 : -0.04);
        P.add(new THREE.BoxGeometry(len, 0.07, 0.25), x + Math.cos(yaw) * off + Math.sin(yaw) * dz, y, z - Math.sin(yaw) * off + Math.cos(yaw) * dz, 0, yaw, 0);
      }
    }
    for (const s of [-0.5, 0, 0.5]) T.add(new THREE.BoxGeometry(0.05, layers * 0.085 + 0.02, 0.27 * wide + 0.04), x + Math.cos(yaw) * s * len * 0.9, FLOOR + (layers * 0.085 + 0.02) / 2, z - Math.sin(yaw) * s * len * 0.9, 0, yaw, 0);
  }
  pile(BX, 3.5, 5, 0, 1.5, 3);                    // at the end of the plank belt (boards slide onto it)
  pile(-2.05, 3.1, 4, Math.PI / 2, 1.3, 2);       // lean-to, west
  pile(-2.05, 0.6, 5, Math.PI / 2, 1.2, 2);       // inside the hall, west of the belt
  if (level >= 2) { pile(-1.0, -3.1, 6, 0, 1.4, 3); pile(0.9, -3.1, 6, 0, 1.4, 3); pile(-2.05, -2.0, 4, Math.PI / 2, 1.2, 2); }
  if (level >= 3) { pile(BX, 4.25, 4, 0, 1.5, 2); pile(-2.05, 4.2, 3, Math.PI / 2, 1.0, 1); pile(2.0, -3.0, 5, Math.PI / 2, 1.3, 3); }

  // ---- sawdust piles
  D.cyl(0.02, 0.5, 0.26, 9, XB + 0.3, FLOOR + 0.13, 0.55, 0, 0, 0);
  D.cyl(0.02, 0.4, 0.2, 8, XB - 0.35, FLOOR + 0.1, -0.05, 0, 0, 0);
  D.cyl(0.02, 0.34, 0.18, 8, -2.0, FLOOR + 0.09, 1.4, 0, 0, 0);

  // ---- level 2/3 saw stations on the plank belt (trimmers: blade plane across the board, axis along x)
  const trimmers = [];
  function trimmer(x, z, mult, post) {
    const y = L.BELT_TOP + 0.4;
    M.box(0.12, 1.5, 0.12, post, FLOOR + 0.75, z);                                // post beside the belt
    M.box(Math.abs(x - post) + 0.1, 0.1, 0.1, (x + post) / 2, y + 0.55, z);       // arm over the belt
    M.box(0.3, 0.3, 0.3, x + (post > x ? 0.25 : -0.25), y + 0.2, z);               // drive housing
    M.cyl(0.18, 0.4, 0.26, 4, x, y + 0.36, z, 0, Math.PI / 4, 0);                  // small hood
    const holder = new THREE.Group();
    holder.position.set(x, y, z); holder.rotation.y = Math.PI / 2;
    const b = sawmillBladeV161(0.36, bladeMat);
    holder.add(b); root.add(holder);
    blades.push({ node: b, mult, baseY: null });
    trimmers.push({ x, z });
  }
  if (level >= 2) trimmer(BX - 0.7, 1.55, -1.15, BX - 0.95);
  if (level >= 3) trimmer(BX + 0.7, 1.55, 1.3, BX + 0.95);
  if (level >= 3) { // work lamp on the east bay post
    M.box(0.06, 0.06, 0.4, X1 - 0.1, EAVE - 0.3, ZF - 0.25);
    M.cyl(0.06, 0.12, 0.1, 8, X1 - 0.1, EAVE - 0.36, ZF - 0.45, 0, 0, 0);
  }

  // ---- static meshes
  const add = (mesh) => { if (mesh) root.add(mesh); return mesh; };
  add(FD.toMesh(slabMat, { name: 'v161SawmillSlab', cast: false }));
  add(T.toMesh(timberMat, { name: 'v161SawmillFrame' }));
  add(W.toMesh(wallMat, { name: 'v161SawmillWall' }));
  const roof = add(R.toMesh(roofMat, { name: 'v161SawmillRoof' }));
  add(P.toMesh(plankMat, { name: 'v161SawmillPlanks' }));
  add(M.toMesh(metalMat, { name: 'v161SawmillMetal' }));
  add(WN.toMesh(paneMat, { name: 'v161SawmillWindows', cast: false }));
  add(LG.toMesh([barkMat], { name: 'v161SawmillLogs' }));
  add(LC.toMesh([grainMat], { name: 'v161SawmillLogEnds', cast: false }));
  add(D.toMesh(sawdustMat, { name: 'v161SawmillSawdust', cast: false }));
  const belt = add(BK.toMesh(beltMat, { name: 'v161SawBelt' }));

  // ---- animated parts -------------------------------------------------------------------------------------------------------
  // carriage (moves along x): skid under the log, two bunks, dogs, wheels
  const C = sawmillBatchV161();
  C.box(2.2, 0.1, 0.3, 0, 0.7, -0.52);
  for (const x of [-0.55, 0.55]) C.box(0.16, 0.2, 0.3, x, 0.82, -0.52);
  for (const x of [-0.7, 0.7]) C.box(0.08, 0.5, 0.08, x, 1.0, -0.62);
  for (const x of [-0.8, 0.8]) C.cyl(0.07, 0.07, 0.22, 10, x, 0.64, -0.52, Math.PI / 2, 0, 0);
  const carriage = add(C.toMesh(metalMat, { name: 'v161SawCarriage' }));
  // log: unit-length cylinder along x, scaled by the animation (bark + end grain materials)
  const logGeo = new THREE.CylinderGeometry(L.LOG_R, L.LOG_R, L.LOG_L, 14, 1, false);
  logGeo.rotateZ(Math.PI / 2);
  const log = new THREE.Mesh(logGeo, [barkMat, grainMat, grainMat]);
  log.name = 'v161SawLog'; log.castShadow = true; log.receiveShadow = true;
  root.add(log);
  // boards: three, lying along x on the plank belt, one behind the other along the belt direction
  const boards = [];
  for (let k = 0; k < 3; k++) {
    const b = sawmillAnimMeshV161(new THREE.BoxGeometry(1, 0.07, 0.3), [plankMat], 'v161SawBoard' + k);
    b.userData.z0 = 0.4 + 0.34 * k;
    b.visible = false; root.add(b); boards.push(b);
  }
  // belt ribs (animated by rewriting z of the vertices; a pitch-periodic pattern wrapped over the belt length)
  const ribs = (() => {
    const N = 9, rg = new THREE.BoxGeometry(L.BELT_W - 0.1, 0.025, 0.06), rp = rg.attributes.position, per = rp.count;
    const pos = new Float32Array(N * per * 3), nor = new Float32Array(N * per * 3), uvs = new Float32Array(N * per * 2), idx = [], baseZ = new Float32Array(per);
    for (let v = 0; v < per; v++) baseZ[v] = rp.getZ(v);
    for (let i = 0; i < N; i++) {
      for (let v = 0; v < per; v++) {
        const o = (i * per + v) * 3;
        pos[o] = rp.getX(v) + BX; pos[o + 1] = rp.getY(v) + L.BELT_TOP - 0.0125; pos[o + 2] = baseZ[v];
        nor[o] = rg.attributes.normal.getX(v); nor[o + 1] = rg.attributes.normal.getY(v); nor[o + 2] = rg.attributes.normal.getZ(v);
        uvs[(i * per + v) * 2] = rg.attributes.uv.getX(v); uvs[(i * per + v) * 2 + 1] = rg.attributes.uv.getY(v);
      }
      for (let k = 0; k < rg.index.count; k++) idx.push(i * per + rg.index.getX(k));
    }
    rg.dispose();
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pa);
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    const mesh = sawmillAnimMeshV161(g, [ribMat], 'v161SawBeltRibs', false);
    mesh.frustumCulled = false;
    root.add(mesh);
    return { mesh, pos, baseZ, N, per, off: -1 };
  })();
  // hoist: trolley on the runway beam, cable (scaled), hook with spreader
  const H = sawmillBatchV161();
  H.box(0.3, 0.12, 0.28, 0, 2.12, 0); H.box(0.05, 0.1, 0.34, 0.1, 2.2, 0); H.box(0.05, 0.1, 0.34, -0.1, 2.2, 0);
  const trolley = add(H.toMesh(metalMat, { name: 'v161SawTrolley' }));
  const Hk = sawmillBatchV161();
  Hk.box(0.5, 0.05, 0.1, 0, 0, 0); Hk.box(0.07, 0.12, 0.07, 0, 0.08, 0);
  for (const x of [-0.25, 0.25]) Hk.cyl(0.012, 0.012, 0.12, 4, x, -0.08, 0, 0, 0, 0);   // slings down to the log
  const hook = add(Hk.toMesh(metalMat, { name: 'v161SawHook' }));
  const cable = sawmillAnimMeshV161(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), [metalMat], 'v161SawCable', false);
  root.add(cable);
  // sawdust: pooled points (hard cap SAWDUST_MAX), positions rewritten in place
  const dust = (() => {
    const n = L.DUST_MAX, pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), life = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -50;
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pa);
    const m = new THREE.PointsMaterial({ color: 0xdcc592, size: 0.1, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.name = 'v161SawDust'; pts.frustumCulled = false;
    root.add(pts);
    return { pts, pos, vel, life, n, live: 0, acc: 0 };
  })();

  root.userData.parts = { log, carriage, boards, belt, ribs, trolley, hook, cable, roof, dust, blades };
  root.userData.anim = {
    p: 0, manualT: 0, t: 0, spin: 0, running: false, cutting: false, smokeT: 0, seed: 12345, dirty: true,
    chimney: new THREE.Vector3(XB, ductTop + 0.25, bladeZ),
  };
  // footprint (local) for tests / collision / decor clearing
  root.userData.layout = {
    level, zb: ZB, zf: ZF, x0: X0, x1: X1, zc: ZC, dep: DEP, leanZ1: LEAN_Z1, leanX0: LEAN_X0, leanX1: LEAN_X1,
    roof: { x0: RX0, x1: RX1, z0: ZC - HS, z1: ZC + HS }, trimmers,
    stackObb: { x: BX, z: 3.5, hx: 0.78, hz: 0.45 },
  };
  root.userData.spinners = blades.map((b) => ({ node: b.node, speed: SAWMILL_SPIN_V161 * b.mult }));
  root.userData.blades = blades;
  root.userData.primaryBlade = blade;
  return root;
}

/* ------------------------------------------------------------------------------------------------------------------------------
 * animation
 * ---------------------------------------------------------------------------------------------------------------------------- */
const sawmillTmpV161 = new THREE.Vector3();
function sawmillSmoothV161(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
function sawmillLerpV161(a, b, t) { return a + (b - a) * t; }

// Poses every moving part for cycle phase p in [0,1). No allocations.
function sawmillApplyPoseV161(mill, p) {
  const L = SAWMILL_L_V161, PH = SAWMILL_P_V161, S = sawmillSmoothV161, A = mill.userData.anim, P = mill.userData.parts;
  // --- saw carriage / log
  let travel = 0, cutting = false;
  if (p < PH.CUT0) travel = 0;
  else if (p < PH.CUT1) { travel = L.TRAVEL * (p - PH.CUT0) / (PH.CUT1 - PH.CUT0); cutting = travel > L.APPROACH; }
  else if (p < PH.RET1) travel = L.TRAVEL * (1 - S((p - PH.CUT1) / (PH.RET1 - PH.CUT1)));
  const cx = L.CX0 - travel;
  P.carriage.position.x = cx;
  const sawn = p < PH.CUT1 ? Math.max(0, travel - L.APPROACH) : L.LOG_L;   // length of the log that already is boards
  const log = P.log;
  if (p < PH.CUT1) { // on the carriage, getting shorter from its west end
    const west = Math.max(L.XB, cx - L.LOG_L / 2), east = cx + L.LOG_L / 2, len = east - west;
    log.visible = len > 0.02;
    if (log.visible) { log.scale.set(len / L.LOG_L, 1, 1); log.position.set((west + east) / 2, L.LOG_Y, L.LOG_Z); }
  } else { // next log: pops up on the pile, the hoist lifts it, carries it over the carriage and lowers it
    const g = Math.min(1, (p - PH.CUT1) / 0.02);
    let y, z;
    if (p < 0.68) { y = L.PILE_Y; z = L.PILE_Z; }
    else if (p < 0.73) { y = sawmillLerpV161(L.PILE_Y, 1.55, S((p - 0.68) / 0.05)); z = L.PILE_Z; }
    else if (p < 0.84) { y = 1.55; z = sawmillLerpV161(L.PILE_Z, L.LOG_Z, S((p - 0.73) / 0.11)); }
    else if (p < 0.90) { y = sawmillLerpV161(1.55, L.LOG_Y, S((p - 0.84) / 0.06)); z = L.LOG_Z; }
    else { y = L.LOG_Y; z = L.LOG_Z; }
    log.visible = true; log.scale.set(Math.max(0.001, g), 1, 1); log.position.set(L.CRANE_X, y, z);
  }
  // --- boards: grow from the blade onto the belt table, then ride out through the outlet onto the stack
  const u = p < PH.BOARD0 ? 0 : Math.min(1, (p - PH.BOARD0) / (PH.BOARD1 - PH.BOARD0));
  const sink = p > PH.BOARD1 ? Math.min(1, (p - PH.BOARD1) / (1 - PH.BOARD1)) : 0;
  for (let k = 0; k < 3; k++) {
    const b = P.boards[k];
    b.visible = sawn > 0.02 && sink < 1;
    if (!b.visible) continue;
    const z = b.userData.z0 + L.BELT_TRAVEL * u;
    const onStack = S((z - 2.95) / 0.3);
    b.scale.set(sawn, 1 - sink * 0.6, 1);
    b.position.set(L.XB - sawn / 2, L.BELT_TOP + 0.04 + onStack * 0.025 - sink * 0.03, z);
  }
  // --- belt ribs scroll while the boards ride (D is a multiple of the pitch: the pattern at u=0 and u=1 is identical)
  const off = (u * L.BELT_TRAVEL) % L.RIB_PITCH;
  const R = P.ribs;
  if (Math.abs(off - R.off) > 1e-4) {
    R.off = off;
    const span = R.N * L.RIB_PITCH;
    for (let i = 0; i < R.N; i++) {
      const zc = L.BELT_Z0 + 0.1 + ((i * L.RIB_PITCH + off) % span);
      for (let v = 0; v < R.per; v++) R.pos[(i * R.per + v) * 3 + 2] = R.baseZ[v] + zc;
    }
    R.mesh.geometry.attributes.position.needsUpdate = true;
  }
  // --- hoist: trolley along the runway, cable length follows the hook
  let tz = L.PILE_Z, hy = 1.95;
  if (p >= PH.CUT1) {
    if (p < 0.66) hy = sawmillLerpV161(1.95, L.PILE_Y + 0.32, S((p - PH.CUT1) / 0.06));
    else if (p < 0.68) hy = L.PILE_Y + 0.32;
    else if (p < 0.90) hy = log.position.y + 0.32;
    else if (p < 0.94) hy = sawmillLerpV161(L.LOG_Y + 0.32, 1.95, S((p - 0.90) / 0.04));
    if (p >= 0.73 && p < 0.94) tz = p < 0.84 ? sawmillLerpV161(L.PILE_Z, L.LOG_Z, S((p - 0.73) / 0.11)) : L.LOG_Z;
    else if (p >= 0.94) tz = sawmillLerpV161(L.LOG_Z, L.PILE_Z, S((p - 0.94) / 0.06));
  }
  const len = 2.06 - hy - 0.03;
  P.trolley.position.set(L.CRANE_X, 0, tz);
  P.hook.position.set(L.CRANE_X, hy, tz);
  P.cable.scale.set(1, len, 1); P.cable.position.set(L.CRANE_X, 2.06 - len / 2, tz);
  A.cutting = cutting;
}

function sawmillRandV161(A) { A.seed = (Math.imul(A.seed, 1664525) + 1013904223) >>> 0; return A.seed / 4294967296; }

function updateSawmillMillV161(dt) {
  const mill = sawmillMillV161, A = mill && mill.userData.anim;
  if (!A) return;
  const L = SAWMILL_L_V161;
  dt = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);
  A.t += dt;
  // ---- cycle phase: the game's own sawmill timer (level and productionSpeedMultiplier are inside sawmillAutoInterval())
  let T = 12;
  try { T = Math.max(2, sawmillAutoInterval()); } catch (e) { /* game not ready */ }
  let running = false, p = A.p;
  try {
    if (stageIndex >= 1) { running = true; p = Math.min(0.9999, Math.max(0, sawmillAutoTimer / T)); }
    else if (logsInTransit.length > 0) { running = true; A.manualT = (A.manualT + dt / T) % 1; p = A.manualT; }
  } catch (e) { /* globals not ready */ }
  A.running = running;
  if (running || A.dirty) { A.dirty = false; A.p = p; sawmillApplyPoseV161(mill, p); }
  const cutting = running && A.cutting;
  // ---- blades: spin up while producing, coast down when idle; a faint hum while cutting
  const target = running ? (cutting ? SAWMILL_SPIN_V161 : SAWMILL_SPIN_V161 * 0.55) : 0;
  A.spin += (target - A.spin) * Math.min(1, dt * 3);
  const blades = mill.userData.blades;
  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];
    b.node.rotation.z += dt * A.spin * b.mult;
    if (b.baseY !== null) b.node.position.y = b.baseY + (cutting ? Math.sin(A.t * 55) * 0.003 : 0);
  }
  // ---- sawdust (pooled)
  const D = mill.userData.parts.dust, n = D.n;
  if (cutting) D.acc += dt * 13;
  let live = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (D.life[i] > 0) {
      D.life[i] -= dt;
      if (D.life[i] <= 0) { D.pos[o + 1] = -50; continue; }
      D.vel[o + 1] -= 3.4 * dt;
      D.pos[o] += D.vel[o] * dt; D.pos[o + 1] += D.vel[o + 1] * dt; D.pos[o + 2] += D.vel[o + 2] * dt;
      if (D.pos[o + 1] < L.FLOOR + 0.02) { D.pos[o + 1] = L.FLOOR + 0.02; D.vel[o] *= 0.3; D.vel[o + 1] = 0; D.vel[o + 2] *= 0.3; }
      live++;
    } else if (D.acc >= 1) {
      D.acc -= 1;
      D.life[i] = 0.55 + sawmillRandV161(A) * 0.4;
      D.pos[o] = L.XB + (sawmillRandV161(A) - 0.5) * 0.14; D.pos[o + 1] = 0.98 + sawmillRandV161(A) * 0.3; D.pos[o + 2] = -0.12;
      D.vel[o] = (sawmillRandV161(A) - 0.5) * 0.7; D.vel[o + 1] = 0.5 + sawmillRandV161(A) * 0.9; D.vel[o + 2] = 0.5 + sawmillRandV161(A) * 0.8;
      live++;
    }
  }
  if (D.acc > 2) D.acc = 2;
  if (!cutting) D.acc = 0;
  D.live = live;
  if (live || D.wasLive) D.pts.geometry.attributes.position.needsUpdate = true;
  D.wasLive = live > 0;
  // ---- chimney smoke (the game's own puffs) only while the mill produces
  if (running) {
    A.smokeT += dt;
    if (A.smokeT >= 1.7) {
      A.smokeT = 0;
      if (typeof spawnSmokePuff === 'function' && mill.visible) { sawmillTmpV161.copy(A.chimney); mill.localToWorld(sawmillTmpV161); spawnSmokePuff(sawmillTmpV161); }
    }
  } else A.smokeT = 1.2;
}

// plain-data snapshot for tests
function sawmillStateV161() {
  const mill = sawmillMillV161; if (!mill) return null;
  const P = mill.userData.parts, A = mill.userData.anim;
  return {
    level: mill.userData.levelV161, p: A.p, running: A.running, cutting: A.cutting, spin: A.spin,
    log: { visible: P.log.visible, sx: P.log.scale.x, x: P.log.position.x, y: P.log.position.y, z: P.log.position.z },
    carriageX: P.carriage.position.x,
    boards: P.boards.map((b) => ({ visible: b.visible, sx: b.scale.x, x: b.position.x, y: b.position.y, z: b.position.z })),
    dustLive: P.dust.live, dustMax: P.dust.n, ribsOff: P.ribs.off,
    trolleyZ: P.trolley.position.z, hookY: P.hook.position.y,
  };
}

// oriented boxes of the real hall for the global collision registry (placement flag off: roads and planners are not affected)
function sawmillObstaclesV161() {
  const mill = sawmillMillV161; if (!mill || !mill.visible) return [];
  const lay = mill.userData.layout, yaw = mill.userData.yawV161, c = Math.cos(yaw), s = Math.sin(yaw);
  const toWorld = (lx, lz) => new THREE.Vector3(SAWMILL_POS.x + c * lx + s * lz, 0, SAWMILL_POS.z - s * lx + c * lz);
  const hall = { label: 'sawmill-hall-v161', pos: toWorld((lay.x0 + lay.x1) / 2, lay.zc), hx: (lay.x1 - lay.x0) / 2 + 0.12, hz: lay.dep / 2 + 0.12, yaw };
  const st = lay.stackObb, stack = { label: 'sawmill-stack-v161', pos: toWorld(st.x, st.z), hx: st.hx, hz: st.hz, yaw };
  return [hall, stack];
}

// decor bushes/flowers that stand inside the footprint (+ margin) are hidden; real harvestable trees are never touched (reported by the test)
function clearSawmillDecorV161(mill) {
  const lay = mill.userData.layout, yaw = mill.userData.yawV161, c = Math.cos(yaw), s = Math.sin(yaw);
  const x0 = lay.x0 - 0.7, x1 = lay.x1 + 0.6, z0 = lay.zb - 0.6, z1 = lay.leanZ1 + 0.5;
  let hidden = 0;
  for (const o of scene.children) {
    const ud = o.userData;
    if (!ud || !ud.foliageKindV154 || ud.harvestableTree || o.visible === false) continue;
    const dx = o.position.x - SAWMILL_POS.x, dz = o.position.z - SAWMILL_POS.z;
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (lx > x0 && lx < x1 && lz > z0 && lz < z1) { o.visible = false; ud.v161SawmillClearance = true; ud.v93RoadClearance = true; hidden++; } // v93RoadClearance: the camera-occlusion code must not make it visible again
  }
  mill.userData.decorHidden = hidden;
  return hidden;
}

// ---- tree keep-out (user, phone screenshot: choppable trees grow right against the mill) -------------------------------------------------
// Footprint of the LARGEST (level 3) building incl. overhangs and the lean-to, local frame; + 4 m margin = no tree (choppable or decorative) may stand there.
// The belt axis, the log drop-off point, the plank outlet/stacks and the level pads are all inside this rectangle. The generator camp trees (the log source,
// local x >= 6.5 on the belt axis) stay outside it by construction.
const SAWMILL_KEEP_V161 = Object.freeze({ x0: -2.85, x1: 2.6, z0: -4.15, z1: 4.75, margin: 4 });
let sawmillKeepCsV161 = null;
function sawmillLocalV161(x, z) {
  if (!sawmillKeepCsV161) {
    const u = new THREE.Vector3().subVectors(GENERATOR_POS, SAWMILL_POS).setY(0).normalize(), yaw = Math.atan2(-u.z, u.x);
    sawmillKeepCsV161 = [Math.cos(yaw), Math.sin(yaw)];
  }
  const dx = x - SAWMILL_POS.x, dz = z - SAWMILL_POS.z;
  return [sawmillKeepCsV161[0] * dx - sawmillKeepCsV161[1] * dz, sawmillKeepCsV161[1] * dx + sawmillKeepCsV161[0] * dz];
}
// distance (m) from a world point to the keep-out footprint rectangle (0 inside it)
function sawmillFootprintDistV161(x, z) {
  const K = SAWMILL_KEEP_V161, l = sawmillLocalV161(x, z);
  return Math.hypot(Math.max(K.x0 - l[0], 0, l[0] - K.x1), Math.max(K.z0 - l[1], 0, l[1] - K.z1));
}
function sawmillKeepOutV161(x, z, margin = SAWMILL_KEEP_V161.margin) { return sawmillFootprintDistV161(x, z) < margin; }

function sawmillIsTreeV161(o) {
  const ud = o.userData;
  if (!ud || o === sawmillMillV161) return false;
  if (typeof vegetationKindV154 === 'function') { try { return vegetationKindV154(o) === 'tree'; } catch (e) { /* fall through */ } }
  return !!ud.harvestableTree;
}
function sawmillFindTreeSpotV161(fromX, fromZ, trees) {
  let best = null, bd = Infinity;
  for (let r = 9; r <= 24; r += 1.5) {
    for (let k = 0; k < 48; k++) {
      const a = k * Math.PI * 2 / 48 + r * 0.37, x = SAWMILL_POS.x + Math.cos(a) * r, z = SAWMILL_POS.z + Math.sin(a) * r;
      const d = Math.hypot(x - fromX, z - fromZ);
      if (d >= bd) continue;
      if (Math.abs(x) > GROUND_HALF * 0.9 || Math.abs(z) > GROUND_HALF * 0.9) continue;
      if (sawmillKeepOutV161(x, z, SAWMILL_KEEP_V161.margin + 1.2)) continue;
      if (Math.hypot(x - GENERATOR_POS.x, z - GENERATOR_POS.z) < 7.5) continue;
      if (typeof distToNearestRoadSegment === 'function' && distToNearestRoadSegment(x, z) < 3.2) continue;
      if (Math.abs(x - (-8.7 + INDUSTRIAL_ZONE_OFFSET_X)) < 8.6 && Math.abs(z - 6.5) < 4.6) continue; // fleet yard
      let bad = false;
      for (const c of STATIC_COLLIDERS) if (Math.hypot(x - c.pos.x, z - c.pos.z) - c.radius < 2.2) { bad = true; break; }
      if (!bad) for (let i = 0; i < STAGES.length; i++) { const q = stagePosition(i); if (Math.hypot(x - q.x, z - q.z) < 4.6) { bad = true; break; } }
      if (!bad) for (const st of INDUSTRIAL_BUILD_STEPS_V118) if (Math.hypot(x - st.pos.x, z - st.pos.z) < 3.4) { bad = true; break; }
      if (!bad) for (const f of FIELD_UPGRADE_CONFIGS) if (Math.hypot(x - f.pos.x, z - f.pos.z) < 3.0) { bad = true; break; }
      if (!bad) for (const t of trees) if (Math.hypot(x - t.position.x, z - t.position.z) < 2.0) { bad = true; break; }
      if (bad) continue;
      bd = d; best = [x, z];
    }
  }
  return best;
}
// Moves every tree (choppable or decorative scene-level tree) that stands inside footprint + 4 m to the nearest legal spot on the edge of the clearing.
// Runs when the mill is built/rebuilt and every few seconds from refreshSawmillVisualsV161 (so a tree that appears later is caught too). Returns the number moved.
function relocateSawmillTreesV161() {
  const trees = [];
  for (const o of scene.children) if (sawmillIsTreeV161(o)) trees.push(o);
  let moved = 0;
  for (const o of trees) {
    const p = o.position;
    if (!sawmillKeepOutV161(p.x, p.z)) continue;
    if (Math.hypot(p.x - GENERATOR_POS.x, p.z - GENERATOR_POS.z) < 3.6) continue; // the generator camp ring is the log source, never touched
    const spot = sawmillFindTreeSpotV161(p.x, p.z, trees);
    if (!spot) { o.visible = false; o.userData.v161SawmillClearance = true; o.userData.v93RoadClearance = true; moved++; continue; }
    p.set(spot[0], p.y, spot[1]);
    if (o.userData.v161SawmillClearance) { o.visible = true; delete o.userData.v161SawmillClearance; delete o.userData.v93RoadClearance; } // hidden earlier for lack of a spot: it has one now
    o.userData.v161MovedByMill = true;
    moved++;
  }
  if (moved) { try { window.__TYCOON_V83_COLLISIONS__?.rebuild?.(); } catch (e) { /* registry not up yet */ } }
  return moved;
}

// (Re)build the mill for the current production level. Cheap when nothing changed (compares one number).
let sawmillTreeGuardAtV161 = 0;
function refreshSawmillVisualsV161() {
  if (!sawmillBuiltV118 || !sawmillMillV161) return;
  const now = performance.now();
  if (now - sawmillTreeGuardAtV161 > 2500) { sawmillTreeGuardAtV161 = now; try { relocateSawmillTreesV161(); } catch (e) { console.warn('[sawmill] tree guard', e); } }
  const lv = Math.min(3, industrialLevelV161('sawmill'));
  if (lv === sawmillMillLevelV161) return;
  const old = sawmillMillV161, oldA = old.userData.anim;
  scene.remove(old);
  disposeObject3D(old);
  const mill = installSawmillMillV161(lv);
  if (oldA) { const A = mill.userData.anim; A.p = oldA.p; A.manualT = oldA.manualT; A.spin = oldA.spin; A.t = oldA.t; }
}

function installSawmillMillV161(level) {
  const mill = buildSawmillMillV161(level);
  mill.position.copy(SAWMILL_POS);
  scene.add(mill);
  sawmillMillV161 = mill;
  sawmillMillLevelV161 = mill.userData.levelV161;
  sawmillBlade = mill.userData.primaryBlade; // legacy handle (tests/other layers may read it)
  sawmillApplyPoseV161(mill, mill.userData.anim.p);
  clearSawmillDecorV161(mill);
  try { mill.userData.treesMoved = relocateSawmillTreesV161(); } catch (e) { /* too early at boot (FIELD_UPGRADE_CONFIGS is declared later): the first refreshSawmillVisualsV161() after load() runs it */ }
  try { window.__TYCOON_V83_COLLISIONS__?.rebuild?.(); } catch (e) { /* registry not up yet: its own first rebuild reads sawmillObstaclesV161() */ }
  return mill;
}
