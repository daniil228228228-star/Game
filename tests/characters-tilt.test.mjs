// Character tilt / feet, CHANGELOG_V161.md 2026-10-11 (17) -- user: «Что с ними» (workers leaned ~30 deg like falling over, legs splayed). assets/characters-v161.js.
// ONE launch. The game's own update functions (updatePlayer / updateAmbientLife / updateLivingCity) are called synchronously with a fixed dt of 1/5, 1/15 and 1/30 s for 600 frames each
// (swiftshader ~3 fps vs a phone at 20-30 fps; the overlay clamps dt to 50 ms), for every worker role (walking and working), the sawmill stacker, residents and the player. Per frame:
//   - tilt = angle between the figure's up axis and world up (group for NPCs, torso for the player) <= 10 deg (bots <= ~7 deg by design: 6 deg lean + 3 deg sway, player <= 8 deg);
//   - lowest foot point within +-1 cm of the ground (NPCs: compass gait, the pelvis drops with the swing), no NaN; limb swing <= 0.8 rad (legs) / 0.7 rad (arms);
//   - after 120 idle frames the tilt is back at 0 (< 0.5 deg).
// SHOTS_DIR=dir writes a worker walking from the side and 3/4 (mid-stride, real overlay pose).
import { openGame, check } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const J = JSON.stringify;
const SAVE = { saveVersion: 20, stageIndex: 6, money: 5e6, planks: 30, concrete: 30, metal: 30, buildings: Array.from({ length: 6 }, (_, i) => ({ index: i, level: 1 })) };
const g = await openGame({ save: SAVE, waitMs: 9000 });
const { page } = g;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const res = await page.evaluate(() => {
  const DEG = 180 / Math.PI, up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), v = new THREE.Vector3();
  const tiltOf = (o) => { o.updateWorldMatrix(true, false); o.getWorldQuaternion(q); return v.copy(up).applyQuaternion(q).angleTo(up) * DEG; };
  const footY = (fig) => {   // lowest world y of the two feet (boots for workers, the leg boxes for residents)
    fig.group.updateMatrixWorld(true);
    let m = 1e9;
    for (const leg of [fig.legL, fig.legR]) {
      let part = null; leg.traverse((o) => { if (o.name === 'workerBootV161') part = o; });
      m = Math.min(m, new THREE.Box3().setFromObject(part || leg, true).min.y);
    }
    return m - (fig.role ? 0.015 : 0);   // boot sole of a worker stands 1.5 cm above the origin by construction
  };
  const out = [], fpsList = [5, 15, 30];
  const W = npcWorkers, R = livingCityRuntime.residents.filter((r) => r.legL);
  const roles = ['builder', 'rigger', 'foreman', 'loader'];
  const figs = [];
  for (const role of roles) { const w = W.find((x) => x.role === role); if (w) figs.push({ name: role + '-walk', e: w, mode: 'walk' }, { name: role + '-work', e: w, mode: 'work' }); }
  const stk = W.find((x) => x.homeBase && Math.hypot(x.homeBase.x - SAWMILL_POS.x, x.homeBase.z - SAWMILL_POS.z) < 16);
  if (stk) figs.push({ name: 'stacker', e: stk, mode: 'stack' });
  for (let i = 0; i < Math.min(2, R.length); i++) figs.push({ name: 'resident' + i, e: R[i], mode: 'walk' });
  const keepPlayer = player.position.clone();
  for (const f of figs) {
    for (const fps of fpsList) {
      const dt = 1 / fps, e = f.e, gr = e.group;
      if (f.mode === 'stack') { gr.position.set(e.homeBase.x, 0, e.homeBase.z); }
      let maxTilt = 0, maxFootHi = -1e9, minFootLo = 1e9, nan = 0, maxLeg = 0, maxArm = 0, moved = 0, p0 = gr.position.clone(), maxLean = 0, maxSway = 0;
      for (let i = 0; i < 600; i++) {
        camera.position.set(gr.position.x, 12, gr.position.z + 12); player.position.set(gr.position.x + 8, 0, gr.position.z + 8);
        if (f.mode !== 'stack') sawmillMillV161.userData.anim.running = false;
        if (f.mode === 'work') { e.workBuild = { entry: { underConstruction: true } }; e.idle = 1e6; e.target = new THREE.Vector3(gr.position.x, 0, gr.position.z); if (e.velocity) e.velocity.set(0, 0, 0); }
        else if (f.mode === 'stack') { sawmillMillV161.userData.anim.running = true; e.workBuild = null; e.idle = 1e6; e.target = new THREE.Vector3(e.homeBase.x, 0, e.homeBase.z); if (e.velocity) e.velocity.set(0, 0, 0); }
        else if (e.role) { e.workBuild = null; e.idle = 0; e.target = new THREE.Vector3(gr.position.x + (Math.floor(i / 150) % 2 ? -12 : 12), 0, gr.position.z + (Math.floor(i / 300) % 2 ? 10 : -10)); }
        updateAmbientLife(dt); updateLivingCity(dt);
        const t = tiltOf(gr), fy = footY(e);
        const bad = [gr.position.x, gr.position.y, gr.position.z, gr.rotation.x, gr.rotation.y, gr.rotation.z, e.legL.rotation.x, e.armL.rotation.x].some((x) => !Number.isFinite(x));
        if (bad || !Number.isFinite(t) || !Number.isFinite(fy)) nan++;
        maxTilt = Math.max(maxTilt, t); maxFootHi = Math.max(maxFootHi, fy); minFootLo = Math.min(minFootLo, fy);
        maxLean = Math.max(maxLean, Math.abs(gr.rotation.x)); maxSway = Math.max(maxSway, Math.abs(gr.rotation.z));
        maxLeg = Math.max(maxLeg, Math.abs(e.legL.rotation.x), Math.abs(e.legR.rotation.x)); maxArm = Math.max(maxArm, Math.abs(e.armL.rotation.x), Math.abs(e.armR.rotation.x));
        moved = Math.max(moved, gr.position.distanceTo(p0));
      }
      // idle: stand still, tilt returns to 0
      e.workBuild = null; e.idle = 1e6; e.target = new THREE.Vector3(gr.position.x, 0, gr.position.z); if (e.velocity) e.velocity.set(0, 0, 0);
      sawmillMillV161.userData.anim.running = false;
      let idleTilt = 0, idleFoot = 0;
      if (f.mode !== 'stack' && f.mode !== 'work') {
        for (let i = 0; i < 120; i++) { camera.position.set(gr.position.x, 12, gr.position.z + 12); e.idle = 1e6; e.target = new THREE.Vector3(gr.position.x, 0, gr.position.z); if (e.velocity) e.velocity.set(0, 0, 0); updateAmbientLife(dt); updateLivingCity(dt); }
        idleTilt = tiltOf(gr); idleFoot = footY(e);
      }
      out.push({ name: f.name, fps, maxTilt: +maxTilt.toFixed(2), lean: +(maxLean * DEG).toFixed(2), sway: +(maxSway * DEG).toFixed(2), footHi: +(maxFootHi * 100).toFixed(2), footLo: +(minFootLo * 100).toFixed(2), nan, leg: +maxLeg.toFixed(2), arm: +maxArm.toFixed(2), moved: +moved.toFixed(1), idleTilt: +idleTilt.toFixed(3), idleFoot: +(idleFoot * 100).toFixed(2), mode: f.mode });
    }
  }
  player.position.copy(keepPlayer);
  // the player: runs 300 frames, then stands 200 frames
  const pl = [];
  const camKeep = camera.position.clone();
  for (const fps of fpsList) {
    const dt = 1 / fps; let maxTilt = 0, nan = 0, maxLean = 0;
    player.position.set(0, 0, 14); playerVelocity.set(0, 0, 0);
    for (let i = 0; i < 600; i++) {
      joyVec.x = Math.sin(i / 40) * 0.3; joyVec.z = i < 400 ? (i % 200 < 100 ? 1 : 0.45) : 0;
      updatePlayer(dt);
      const t = tiltOf(torso); maxTilt = Math.max(maxTilt, t); if (!Number.isFinite(t)) nan++;
      maxLean = Math.max(maxLean, Math.abs(torso.rotation.x));
    }
    for (let i = 0; i < 120; i++) { joyVec.x = joyVec.z = 0; updatePlayer(dt); }
    pl.push({ fps, maxTilt: +maxTilt.toFixed(2), lean: +(maxLean * DEG).toFixed(2), nan, idleTilt: +tiltOf(torso).toFixed(3), idleRig: +tiltOf(characterRig).toFixed(3) });
  }
  joyVec.x = joyVec.z = 0;
  return { out, pl };
});
for (const r of res.out) console.log('npc', J(r));
for (const r of res.pl) console.log('player', J(r));
check(res.out.length >= 15, `${res.out.length} figure x fps runs of 600 frames`);
for (const r of res.out) {
  const t = `${r.name} @${r.fps} fps`;
  check(r.nan === 0, `${t}: no NaN`);
  check(r.maxTilt <= 10 && r.lean <= 6.2 && r.sway <= 3.1, `${t}: max tilt ${r.maxTilt} deg <= 10 (lean ${r.lean} <= 6, sway ${r.sway} <= 3)`);
  check(r.footHi <= 1 && r.footLo >= -1, `${t}: feet within +-1 cm of the ground (${r.footLo}..${r.footHi} cm)`);
  check(r.leg <= 0.8 && r.arm <= 1.05, `${t}: limb swing legs ${r.leg} <= 0.8, arms ${r.arm} <= 1.05 rad (arms up = carry / stack pose)`);
  if (r.mode === 'walk' && r.fps === 15 && !r.name.startsWith('resident')) check(r.moved > 3, `${t}: the figure really walked (${r.moved} m)`);
  if (r.mode === 'walk') check(r.idleTilt < 0.5 && r.idleFoot <= 1 && r.idleFoot >= -1, `${t}: idle tilt ${r.idleTilt} deg < 0.5, feet ${r.idleFoot} cm`);
}
for (const r of res.pl) {
  check(r.nan === 0 && r.maxTilt <= 10 && r.lean <= 8.1, `player @${r.fps} fps: max torso tilt ${r.maxTilt} deg <= 10 (lean ${r.lean} <= 8), no NaN`);
  check(r.idleTilt < 1.2 && r.idleRig < 0.01, `player @${r.fps} fps: idle torso tilt ${r.idleTilt} deg (breathing only), rig ${r.idleRig}`);
}

if (SHOTS) {   // a worker walking (real overlay pose, a few frames into a walk), side and 3/4
  const shots = await page.evaluate(() => {
    const out = {}, cv = renderer.domElement;
    const e = npcWorkers.find((x) => x.role === 'builder') || npcWorkers[0], gr = e.group;
    for (let i = 0; i < 90; i++) { camera.position.set(gr.position.x, 12, gr.position.z + 12); e.workBuild = null; e.idle = 0; e.target = new THREE.Vector3(gr.position.x + 12, 0, gr.position.z); updateAmbientLife(1 / 15); }
    gr.updateMatrixWorld(true);
    let top = gr; while (top.parent && top.parent !== scene) top = top.parent;
    const full = scene.children; scene.children = full.filter((o) => o.isLight || o === ground || o === top);
    try {
      const c = new THREE.Vector3(); gr.getWorldPosition(c); c.y += 0.85;
      const yaw0 = gr.rotation.y;
      const cam = new THREE.PerspectiveCamera(30, cv.width / cv.height, 0.1, 100);
      for (const [vname, ang] of [['side', Math.PI / 2], ['q34', Math.PI / 4]]) { const yaw = yaw0 + ang; cam.position.set(c.x + Math.sin(yaw) * 5.2, c.y + 0.3, c.z + Math.cos(yaw) * 5.2); cam.lookAt(c); cam.updateMatrixWorld(true); renderer.render(scene, cam); out['walk-' + vname] = cv.toDataURL('image/jpeg', 0.9); }
    } finally { scene.children = full; }
    return out;
  });
  for (const [k, u] of Object.entries(shots)) fs.writeFileSync(path.join(SHOTS, `tilt-${k}.jpg`), Buffer.from(u.split(',')[1], 'base64'));
  console.log('shots', Object.keys(shots).join(','));
}
check(g.errors.length === 0, `no console errors ${J(g.errors.slice(0, 3))}`);
await g.close();
