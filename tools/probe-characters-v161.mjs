// Limb pivot / drift probe for every figure type (2026-10-11 (16)). node tools/probe-characters-v161.mjs [--out DIR] [--frames 300]
// One launch (stage-6 save): per figure the local joint positions must stay at REST (limbs only rotate), the world distance between the limb pivot and its rest anchor is 0,
// rotation amplitude is recorded, plus the visual gap between the leg top and the torso bottom (world y), and side / 3/4 screenshots of the figures at the widest stride.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, REPO_ROOT } from '../tests/lib/harness.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const OUT = path.resolve(opt('out', path.join(REPO_ROOT, '..', 'shots'))); fs.mkdirSync(OUT, { recursive: true });
const N = +opt('frames', 300);
const SAVE = { saveVersion: 20, stageIndex: 6, money: 5e6, planks: 30, concrete: 30, metal: 30, buildings: Array.from({ length: 6 }, (_, i) => ({ index: i, level: 1 })) };
const g = await openGame({ save: SAVE, waitMs: 9000 });
const { page } = g;
const res = await page.evaluate(({ N }) => new Promise((done) => {
  const fig = [];
  const add = (kind, o, limbs) => { const rec = { kind, o, limbs: {}, drift: 0, n: 0 }; for (const [k, l] of Object.entries(limbs)) { if (l) rec.limbs[k] = { l, rest: l.position.clone(), restRot: { y: l.rotation.y, z: l.rotation.z }, min: 9, max: -9 }; } fig.push(rec); return rec; };
  add('player', null, { legL, legR, armL, armR });
  for (const w of npcWorkers) add('worker:' + w.role, w, { legL: w.legL, legR: w.legR, armL: w.armL, armR: w.armR });
  for (const r of (livingCityRuntime.residents || [])) if (r.legL) add('resident', r, { legL: r.legL, legR: r.legR, armL: r.armL, armR: r.armR });
  // rest-pose gap between the leg top and the torso bottom (world y, all rotations zero)
  const gaps = {};
  const gapOf = (o, torso, leg) => { const g = o.group; const sv = [o.legL.rotation.x, o.legR.rotation.x]; o.legL.rotation.x = o.legR.rotation.x = 0; g.updateMatrixWorld(true);
    const tb = new THREE.Box3().setFromObject(torso), lb = new THREE.Box3().setFromObject(leg); o.legL.rotation.x = sv[0]; o.legR.rotation.x = sv[1]; return { torsoMinY: +tb.min.y.toFixed(3), legMaxY: +lb.max.y.toFixed(3) }; };
  try { const w = npcWorkers[0]; const g0 = w.group; const torso = g0.children.find((c) => c.geometry && c.geometry.type === 'BoxGeometry' && Math.abs(c.geometry.parameters.height - 0.54) < 1e-6); gaps.worker = gapOf(w, torso, w.legL); } catch (e) { gaps.worker = String(e); }
  try { const r = livingCityRuntime.residents.find((x) => x.legL); const torso = r.group.children.find((c) => c.geometry && c.geometry.parameters && Math.abs(c.geometry.parameters.height - 0.46) < 1e-6); gaps.resident = gapOf(r, torso, r.legL); } catch (e) { gaps.resident = String(e); }
  window.__figs = fig;
  const phases = [['workers', () => { const w = npcWorkers[0]; player.position.set(w.group.position.x + 3, 0, w.group.position.z + 3); playerVelocity.set(0, 0, 0); }], ['residents', () => { const r = livingCityRuntime.residents.find((x) => x.legL); player.position.set(r.group.position.x + 3, 0, r.group.position.z + 3); playerVelocity.set(0, 0, 0); }], ['player', () => { joyVec.x = 0; joyVec.z = 1; }]];
  let pi = 0, f = 0, last = V54_STABILITY.frame; const near = {};
  const start = () => { phases[pi][1](); f = 0; };
  start();
  const tick = () => {
    if (V54_STABILITY.frame !== last) {
      last = V54_STABILITY.frame; f++;
      if (phases[pi][0] !== 'player') phases[pi][1]();
      for (const r of fig) {
        const isP = r.kind === 'player';
        if (!(isP ? phases[pi][0] === 'player' : (r.o.cv && !r.o.cv.far))) continue;
        r.n++;
        for (const [k, s] of Object.entries(r.limbs)) {
          const d = s.l.position.distanceTo(s.rest); if (d > r.drift) r.drift = d;
          s.min = Math.min(s.min, s.l.rotation.x); s.max = Math.max(s.max, s.l.rotation.x);
        }
      }
    }
    if (f >= N / 2) { joyVec.x = joyVec.z = 0; pi++; if (pi >= phases.length) { done({ gaps, rows: fig.map((r) => ({ kind: r.kind, n: r.n, drift: r.drift, amp: Object.fromEntries(Object.entries(r.limbs).map(([k, s]) => [k, +(s.max - s.min).toFixed(3)])) })) }); return; } start(); }
    requestAnimationFrame(tick);
  };
  tick(); setTimeout(() => done('timeout'), 150000);
}), { N });
fs.writeFileSync(path.join(OUT, 'probe-chars.json'), JSON.stringify(res, null, 1));
console.log('rest gaps', JSON.stringify(res.gaps));
const by = {}; for (const r of res.rows.filter((r) => r.n > 0)) { (by[r.kind] = by[r.kind] || []).push(r); }
for (const [k, a] of Object.entries(by)) console.log(k, 'n=' + a.length, 'maxDrift', Math.max(...a.map((r) => r.drift)).toExponential(2), 'ampLeg', Math.max(...a.map((r) => r.amp.legL || 0)), 'ampArm', Math.max(...a.map((r) => r.amp.armL || 0)), 'frames', Math.min(...a.map((r) => r.n)));
// screenshots at the widest stride (side + 3/4): a worker, a resident, the player (everything else is taken out of the scene for the render)
const shots = await page.evaluate(() => new Promise((done) => {
  const out = {}; const cv = renderer.domElement;
  const shoot = (obj, tag) => {
    let top = obj; while (top.parent && top.parent !== scene) top = top.parent;
    const full = scene.children; scene.children = full.filter((o) => o.isLight || o === ground || o === top);
    try {
      obj.updateMatrixWorld(true);
      const c = new THREE.Vector3(); obj.getWorldPosition(c); c.y += 0.8;
      const cam = new THREE.PerspectiveCamera(30, cv.width / cv.height, 0.1, 100);
      const yaw0 = obj.getWorldQuaternion(new THREE.Quaternion()); const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(yaw0); const base = Math.atan2(fwd.x, fwd.z);
      for (const [v, ang] of [['side', Math.PI / 2], ['q34', Math.PI / 4]]) {
        const yaw = base + ang; cam.position.set(c.x + Math.sin(yaw) * 3.4, c.y + 0.3, c.z + Math.cos(yaw) * 3.4); cam.lookAt(c); cam.updateMatrixWorld(true);
        renderer.render(scene, cam); out[tag + '-' + v] = cv.toDataURL('image/jpeg', 0.9);
      }
    } finally { scene.children = full; }
  };
  const t0 = performance.now(); let phase = 0, pt = performance.now();
  const tick = () => {
    const el = performance.now() - t0;
    if (phase === 0) { const w = npcWorkers[0]; player.position.set(w.group.position.x + 3, 0, w.group.position.z + 3); playerVelocity.set(0, 0, 0); const wk = npcWorkers.find((w) => w.cv && !w.cv.far && w.cv.sp > 0.6 && Math.abs(w.legL.rotation.x) > 0.8); if (wk) { shoot(wk.group, 'worker'); phase = 1; pt = performance.now(); } else if (el > 40000) phase = 1; }
    else if (phase === 1) { const r = livingCityRuntime.residents.find((x) => x.legL); player.position.set(r.group.position.x + 3, 0, r.group.position.z + 3); playerVelocity.set(0, 0, 0); const rs = livingCityRuntime.residents.find((x) => x.cv && !x.cv.far && x.cv.sp > 0.4 && Math.abs(x.legL.rotation.x) > 0.45 && x.group.visible); if (rs) { shoot(rs.group, 'resident'); phase = 2; joyVec.x = 0; joyVec.z = 1; } else if (performance.now() - pt > 40000) { phase = 2; joyVec.x = 0; joyVec.z = 1; } }
    else if (phase === 2) { if (Math.abs(legL.rotation.x) > 0.6) { shoot(characterRig, 'player'); joyVec.x = joyVec.z = 0; done(out); return; } if (el > 130000) { done(out); return; } }
    requestAnimationFrame(tick);
  };
  tick();
}));
for (const [k, u] of Object.entries(shots)) fs.writeFileSync(path.join(OUT, `${opt('tag', 'chars')}-${k}.jpg`), Buffer.from(u.split(',')[1], 'base64'));
console.log('shots', Object.keys(shots).join(','), 'errors', g.errors.length, g.errors.slice(0, 3).join(' | '));
await g.close();
