// No browser/WebGL. Executes the shipped Plan C layer, compiled mesh data, the
// actual core vertical-physics block and integrity function in a Node VM.
// Horizontal motion is a controlled fixture, NOT a joystick/end-to-end test.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const THREE = require('../vendor/three_r128/three.min.js');
const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('tycoon-v161.html', root), 'utf8');
const fn = (name) => {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  const end = html.indexOf('\n}', start);
  return html.slice(start, end + 2);
};
const core = fn('updatePlayer');
const vertical = core.slice(0, core.indexOf('  let inZ ='));
const cameraFrame = core.slice(core.indexOf('  const levelV161='), core.indexOf('  camEyeTarget.set('));
assert.ok(cameraFrame.includes('cameraJumpLift'));
let now = 0;
const ctx = { THREE, console, Math, Number, Map, Set, performance: { now: () => now }, document: { hidden: false },
  scene: new THREE.Scene(), player: new THREE.Object3D(), camera: new THREE.PerspectiveCamera(),
  controls: { target: new THREE.Vector3() }, camEyeTarget: new THREE.Vector3(), cameraResolverShiftV163: new THREE.Vector3(),
  cameraSolidMeshes: [], playerVelocity: new THREE.Vector3(), desiredPlayerVelocity: new THREE.Vector3(),
  PLAYER_SPAWN_POS: new THREE.Vector3(11, 0, -11), PLAYER_MAX_AIR_HEIGHT: 4.5,
  PLAYER_JUMP_SPEED: 6.35, PLAYER_GRAVITY: 21.5, GROUND_HALF: 70,
  playerGrounded: true, playerVerticalVelocity: 0, playerJumpRequested: false,
  playerAirTime: 0, playerJumps: 0, playerLandingCompression: 0, dx: 0, dz: 0,
  serviceVehicles: [], npcWorkers: [], haptic() {}, resolveCameraObstructionV85() {},
};
const visibility = [];
ctx.document.addEventListener = (event, handler) => { if (event === 'visibilitychange') visibility.push(handler); };
ctx.keys = new Set(); ctx.joyVec = { x: 0, z: 0 }; ctx.joyKnob = { style: {} };
ctx.clock = { getDelta: () => 0 }; ctx.save = () => {}; ctx.setTimeout = () => 0;
ctx.window = ctx;
ctx.LAYOUT_V161 = 'C';
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('assets/plan-c-data-v161.js', root), 'utf8'), ctx);
vm.runInContext(fn('playerSurfaceLevelV161') + '\nvar integrityAuditTimer=0;\n' + fn('auditRuntimeIntegrity'), ctx);
const hideStart = html.indexOf("document.addEventListener('visibilitychange', () => {");
vm.runInContext(html.slice(hideStart, html.indexOf('\n});', hideStart) + 4), ctx);
const resumeStart = html.indexOf('  function installResumeComfortV52(){');
vm.runInContext(html.slice(resumeStart, html.indexOf('\n  }', resumeStart) + 4) + '\ninstallResumeComfortV52();', ctx);
vm.runInContext(vertical + `
  player.position.x += dx; player.position.z += dz;
${cameraFrame}
  controls.target.set(player.position.x,1.5+cameraJumpLift,player.position.z);
  camEyeTarget.copy(controls.target); camera.position.copy(controls.target).add(new THREE.Vector3(8,4,8));
}`, ctx);
const resolverStart = html.indexOf('  function resolveCameraObstructionV85Impl(');
const resolverSource = html.slice(resolverStart, html.indexOf('\n  }', resolverStart) + 4);
ctx.camToCam = new THREE.Vector3(); ctx.cameraRaycaster = new THREE.Raycaster();
ctx.CAMERA_OBSTRUCTION_BUFFER = 0.35; ctx.desiredCameraDistance = 13;
vm.runInContext('var cameraSafeDistanceV163=null,cameraBlockedUntilV163=0;\n' + resolverSource + '\nresolveCameraObstructionV85=resolveCameraObstructionV85Impl;', ctx);
vm.runInContext(fs.readFileSync(new URL('assets/plan-c-v161.js', root), 'utf8'), ctx);
const D = ctx.PlanCDataV161, C = ctx.PlanCV161;
const bridges = D.struct.ribbons.filter((r) => /^FB/.test(r.id));
const reset = (x, z, y = 0) => {
  ctx.player.position.set(x, y, z); C.level = y; C.airborneBase = null;
  ctx.playerGrounded = true; ctx.playerVerticalVelocity = 0; ctx.playerJumpRequested = false; ctx.dx = ctx.dz = 0;
};
const tick = (dt = 1 / 30) => { now += dt * 1000; ctx.auditRuntimeIntegrity(dt); ctx.updatePlayer(dt); };
const near = (a, b, msg, eps = 0.015) => assert.ok(Math.abs(a - b) <= eps, msg + ` (${a}, wanted ${b})`);

for (const bridge of bridges) {
  const top = bridge.p.reduce((a, b) => b[2] > a[2] ? b : a);
  reset(top[0], top[1], top[2]);
  for (let i = 0; i < 360; i++) tick();
  near(ctx.player.position.y, top[2], bridge.id + ' stands for 12 s without an integrity drop');
  near(ctx.controls.target.y, top[2] + 1.5, bridge.id + ' camera eye follows the full support height');
  ctx.document.hidden = true; for (const handler of visibility) handler();
  near(ctx.player.position.y, top[2], bridge.id + ' hide preserves its support height');
  ctx.document.hidden = false; for (const handler of visibility) handler();
  near(ctx.player.position.y, top[2], bridge.id + ' resume preserves its support height');
  ctx.playerJumpRequested = true;
  let peak = top[2];
  for (let i = 0; i < 120; i++) { tick(); peak = Math.max(peak, ctx.player.position.y); near(ctx.player.position.x, top[0], 'jump is not reset to spawn'); }
  assert.ok(peak > top[2] + 0.6, bridge.id + ' really jumped above the deck');
  near(ctx.player.position.y, top[2], bridge.id + ' lands on the same deck');
  assert.ok(ctx.playerGrounded);
  // Both directions, 15/30/60 Hz. Use actual support physics with measured mesh
  // coordinates, advancing a small horizontal fixture step along each segment.
  for (const hz of [15, 30, 60]) for (const reverse of [false, true]) {
    const points = reverse ? [...bridge.p].reverse() : bridge.p;
    reset(points[0][0], points[0][1]);
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.ceil(len / (5.9 / hz));
      ctx.dx = (b[0] - a[0]) / n; ctx.dz = (b[1] - a[1]) / n;
      for (let i = 0; i < n; i++) { tick(1 / hz); assert.ok(ctx.playerGrounded, `${bridge.id}: stair descent is grounded (${hz} Hz)`); }
    }
    ctx.dx = ctx.dz = 0;
    for (let i = 0; i < hz; i++) tick(1 / hz);
    near(ctx.player.position.y, 0, bridge.id + ' reaches ground at either toe');
  }
  // Jump sideways off the deck; crossing a change in support cannot boost the
  // jump or let the integrity audit mistake a legitimate fall for corruption.
  reset(top[0], top[1], top[2]); ctx.playerJumpRequested = true;
  for (let i = 0; i < 5; i++) tick();
  const alongX = Math.abs(bridge.p.at(-1)[0] - bridge.p[0][0]) > 1;
  ctx.dx = alongX ? 0 : 0.16; ctx.dz = alongX ? 0.16 : 0;
  for (let i = 0; i < 90; i++) { if (i === 15) ctx.dx = ctx.dz = 0; tick(); }
  assert.ok(Math.hypot(ctx.player.position.x - top[0], ctx.player.position.z - top[1]) < 16, 'fall never respawns the player');
  near(ctx.player.position.y, C.level, bridge.id + ' falls and lands on the surface below');
  assert.ok(ctx.playerGrounded && C.level < top[2] - 1, 'lands below the bridge');
  console.log('PASS ' + bridge.id + ': idle, pause/resume, jump, fall, both ramp directions at 15/30/60 Hz, camera height');
}
// The real wrapper must keep the camera on its sightline under the M1 deck.
reset(0, -240); ctx.controls.target.set(0, 1.5, -240); ctx.camera.position.set(12, 12, -228);
C.ensureNear(0, -240); ctx.scene.updateMatrixWorld(true);
ctx.cameraResolverShiftV163.set(0, 0, 0);
const before = ctx.camera.position.clone().sub(ctx.controls.target);
ctx.resolveCameraObstructionV85();
const after = ctx.camera.position.clone().sub(ctx.controls.target);
near(after.clone().cross(before).length(), 0, 'underpass ceiling preserves the viewing line');
assert.ok(ctx.camera.position.y <= D.overhead(0, -240, 0) - 0.3 + 1e-6);
near(ctx.cameraResolverShiftV163.x, ctx.camera.position.x - 12, 'camera correction records x too');
console.log('PASS underpass camera ceiling preserves its tested sightline');
reset(0, -240, 5.3); ctx.player.position.y = NaN; ctx.auditRuntimeIntegrity(2);
near(ctx.player.position.x, 11, 'invalid player state resets to spawn'); near(C.level, 0, 'invalid state clears stale deck support');
// Legacy layout remains flat even if a stale optional object is present.
ctx.LAYOUT_V161 = 'B'; reset(5, 5, 3); ctx.auditRuntimeIntegrity(2); near(ctx.player.position.y, 0, 'B stays flat');
console.log('PASS legacy B integrity uses y=0');
export { ctx };
