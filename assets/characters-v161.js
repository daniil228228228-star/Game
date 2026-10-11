/* Characters v161 (2026-10-11): better player + NPC animation, cheap. User: «улучшай ботов, строителей, лесопилки и самого игрока, анимацию бега».
 *
 * One additive overlay on top of the game's own pose code (nothing of the movement physics, speeds, collisions or balance is touched):
 *   before the base update the offsets written LAST frame are subtracted, after it the new offsets are added. The base code (lerps toward targets, absolute swings) therefore always
 *   sees clean values, and every layer that sets a pose (carry v123/v144, chop, jump) keeps working.
 * PLAYER (updatePlayer wrapper): forward run lean growing with the speed + push-off / braking lean from the acceleration, shoulder counter-twist against the leg swing, deeper elbow
 *   bend and a longer stride at speed, head kept level, idle breathing (chest + shoulders + head), back-load pose while logs are carried.
 * WORKERS / RESIDENTS (updateAmbientLife + updateLivingCity wrappers, no new meshes, rotations only): whole-body lean (rotation order YXZ: lean about the figure's own x), step bob,
 *   twist and a stronger leg / arm swing proportional to the REAL speed (measured from the position, not from the base code's flags); builders HAMMER (body dips with every strike),
 *   riggers crouch and turn the wrench, loaders carry the crate high, foremen stand upright; camp workers at the sawmill STACK (bend / lift cycle) while the saw runs; idle = breathing;
 *   far figures (> 48 m from the camera) get no overlay at all (offsets are zeroed once).
 * Variety: vest colour, skin tone and a hard-hat shade per worker (their materials are already per worker, no extra meshes / materials).
 * Foot dust: a pool of 8 puffs (was a new Points + geometry + material per footstep). Footstep sound: rate limited (>= 130 ms) and never while muted.
 * Loaded last (after feel-v161.js). `CharactersV161.state()` = plain-data snapshot for tests. */
(function () {
  'use strict';
  if (typeof updatePlayer !== 'function' || typeof updateAmbientLife !== 'function') return;
  const clamp = THREE.MathUtils.clamp, sin = Math.sin, abs = Math.abs;
  const FAR2 = 48 * 48;
  const api = { version: 'v161-characters', enabled: true, workers: 0, frames: 0 };

  /* ------------------------------------------------------------------------------------------------------ foot dust pool (<= 8 live) */
  const DUST_MAX = 8, DUST_PTS = 4, dust = { pool: [], live: 0, last: 0 };
  function dustMake() {
    const pos = new Float32Array(DUST_PTS * 3), geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xc8b28b, size: VISUAL_MOBILE ? 0.12 : 0.14, transparent: true, opacity: 0, depthWrite: false });
    const pts = new THREE.Points(geo, mat); pts.visible = false; pts.frustumCulled = false; pts.name = 'v161FootDust'; pts.userData.v161Soft = true;
    scene.add(pts);
    return { pts, pos, vel: new Float32Array(DUST_PTS * 3), life: 0 };
  }
  spawnFootDust = function (p) {   // same call signature as the game's (pos); reuses one of 8 pooled puffs, drops the new one when all are live
    let d = null;
    for (let i = 0; i < dust.pool.length; i++) if (dust.pool[i].life <= 0) { d = dust.pool[i]; break; }
    if (!d) { if (dust.pool.length >= DUST_MAX) return; d = dustMake(); dust.pool.push(d); }
    for (let i = 0; i < DUST_PTS; i++) {
      d.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.18; d.pos[i * 3 + 1] = 0.08 + Math.random() * 0.06; d.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.18;
      d.vel[i * 3] = (Math.random() - 0.5) * 0.55; d.vel[i * 3 + 1] = 0.35 + Math.random() * 0.45; d.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.55;
    }
    d.life = 0.34; d.pts.visible = true; d.pts.material.opacity = 0.5; d.pts.geometry.attributes.position.needsUpdate = true;
  };
  function dustTick(now) {
    const dt = dust.last ? clamp((now - dust.last) / 1000, 0, 0.1) : 0.016; dust.last = now;
    let live = 0;
    for (let i = 0; i < dust.pool.length; i++) {
      const d = dust.pool[i]; if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.pts.visible = false; d.pts.material.opacity = 0; continue; }
      live++;
      for (let k = 0; k < DUST_PTS; k++) { d.pos[k * 3] += d.vel[k * 3] * dt; d.pos[k * 3 + 1] += d.vel[k * 3 + 1] * dt; d.pos[k * 3 + 2] += d.vel[k * 3 + 2] * dt; d.vel[k * 3 + 1] -= 1.6 * dt; }
      d.pts.material.opacity = 0.5 * (d.life / 0.34);
      d.pts.geometry.attributes.position.needsUpdate = true;
    }
    dust.live = live;
  }
  (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push(dustTick);

  /* ------------------------------------------------------------------------------------------------------ footstep sound: rate limit + mute */
  let lastStep = 0;
  function wrapFootstep() {
    if (typeof sfx === 'undefined' || !sfx || typeof sfx.footstep !== 'function' || sfx.footstep.__cv) return;
    const base = sfx.footstep;
    sfx.footstep = function (alt) {
      const now = performance.now();
      if (typeof muted !== 'undefined' && muted) return;
      if (now - lastStep < 130) return;
      lastStep = now; api.steps = (api.steps || 0) + 1;
      return base.apply(this, arguments);
    };
    sfx.footstep.__cv = true;
  }

  /* ------------------------------------------------------------------------------------------------------ player overlay */
  const P = { lean: 0, carry: 0, prevSpeed: 0, accel: 0, t: 0, o: { torsoX: 0, torsoY: 0, torsoSY: 1, headX: 0, headY: 0, fL: 0, fR: 0, legL: 0, legR: 0, aLz: 0, aRz: 0, aLx: 0, aRx: 0, ffL: 0, ffR: 0 } };
  function playerPre() {
    const o = P.o;
    torso.rotation.x -= o.torsoX; torso.rotation.y -= o.torsoY; torso.scale.y /= o.torsoSY;
    head.rotation.x -= o.headX; head.rotation.y -= o.headY;
    forearmL.rotation.x -= o.fL; forearmR.rotation.x -= o.fR; legL.rotation.x -= o.legL; legR.rotation.x -= o.legR;
    armL.rotation.z -= o.aLz; armR.rotation.z -= o.aRz; armL.rotation.x -= o.aLx; armR.rotation.x -= o.aRx;
    o.torsoX = o.torsoY = o.headX = o.headY = o.fL = o.fR = o.legL = o.legR = o.aLz = o.aRz = o.aLx = o.aRx = 0; o.torsoSY = 1;
  }
  function playerPost(dt) {
    const o = P.o; P.t += dt;
    const vx = playerVelocity.x, vz = playerVelocity.z, actual = Math.hypot(vx, vz), s = playerMoveVisualSpeed;
    const moving = actual > 0.2 && playerGrounded;
    P.accel += ((actual - P.prevSpeed) / Math.max(0.001, dt) - P.accel) * clamp(dt * 8, 0, 1); P.prevSpeed = actual;
    const k = clamp(dt * 9, 0, 1);
    const leanT = moving ? 0.05 + 0.2 * s + clamp(P.accel * 0.012, -0.06, 0.08) : 0;   // x rotation > 0 = the top tips forward (figure faces +z)
    P.lean += (leanT - P.lean) * k;
    const logs = (typeof carriedLogs === 'number' && carriedLogs > 0);
    P.carry += ((logs ? 1 : 0) - P.carry) * clamp(dt * 8, 0, 1);
    o.torsoX = P.lean + P.carry * 0.07; torso.rotation.x += o.torsoX;
    o.headX = -(P.lean * 0.75 + P.carry * 0.05); head.rotation.x += o.headX;
    if (moving) {
      const c = sin(runCycle), twist = c * 0.2 * s;
      o.torsoY = twist; torso.rotation.y += twist; o.headY = -twist * 0.55; head.rotation.y += o.headY;
      o.fL = o.fR = -0.55 * s; forearmL.rotation.x += o.fL; forearmR.rotation.x += o.fR;   // elbows bend deeper the faster the run
      o.legL = c * 0.16 * s; o.legR = -o.legL; legL.rotation.x += o.legL; legR.rotation.x += o.legR;   // longer stride at speed (the base amplitude is 0.28..0.58)
    } else {
      const br = sin(P.t * 2.2), idle = 1 - clamp(actual / 0.4, 0, 1);   // idle breathing: chest swells, shoulders open, head floats
      o.torsoSY = 1 + 0.014 * br * idle; torso.scale.y *= o.torsoSY;
      o.aLz = -0.022 * br * idle; o.aRz = 0.022 * br * idle; armL.rotation.z += o.aLz; armR.rotation.z += o.aRz;
      o.headX += 0.016 * sin(P.t * 1.1) * idle; head.rotation.x += 0.016 * sin(P.t * 1.1) * idle;
    }
    if (P.carry > 0.02) {   // logs on the back: hands up at the straps
      o.aLx = P.carry * (-0.35 - armL.rotation.x) * 0.6; o.aRx = P.carry * (-0.35 - armR.rotation.x) * 0.6; armL.rotation.x += o.aLx; armR.rotation.x += o.aRx;
      forearmL.rotation.x += -0.8 * P.carry; forearmR.rotation.x += -0.8 * P.carry; o.fL -= 0.8 * P.carry; o.fR -= 0.8 * P.carry;
    }
  }
  const updatePlayerBase = updatePlayer;
  updatePlayer = function (dt) {
    if (!api.enabled) { if (api.applied) cleanAll(); return updatePlayerBase.apply(this, arguments); }
    api.applied = true;
    wrapFootstep();
    playerPre();
    const r = updatePlayerBase.apply(this, arguments);
    try { playerPost(dt); } catch (e) { /* cosmetic */ }
    api.frames++;
    return r;
  };

  /* ------------------------------------------------------------------------------------------------------ NPC overlay (workers + residents) */
  const VEST = [0xffd44d, 0xff8a2b, 0xc4e04a, 0xf2f4f8, 0xffb02e], SKIN = [0xffcfa0, 0xe8b88c, 0xc58c63, 0x9a6a4a, 0xf3d2b4], HAT_SHADE = [1, 0.92, 1.06, 0.84];
  function initEntity(e) {
    if (e.cv) return e.cv;
    const g = e.group;
    g.rotation.order = 'YXZ';
    e.cv = { ox: 0, oyaw: 0, oy: 0, sy: 1, olL: 0, olR: 0, oaL: 0, oaR: 0, px: g.position.x, pz: g.position.z, sp: 0, work: 0, stack: 0, carry: 0, t: Math.random() * 20, far: false };
    return e.cv;
  }
  function entityPre(e) {
    const c = e.cv; if (!c) return;
    const g = e.group;
    g.rotation.x -= c.ox; g.rotation.y -= c.oyaw; g.position.y -= c.oy; g.scale.y /= c.sy;
    e.legL.rotation.x -= c.olL; e.legR.rotation.x -= c.olR; e.armL.rotation.x -= c.oaL; e.armR.rotation.x -= c.oaR;
    c.ox = c.oyaw = c.oy = c.olL = c.olR = c.oaL = c.oaR = 0; c.sy = 1;
  }
  const _cam = { x: 0, z: 0 };
  function siteActive(e) {
    const b = e.workBuild;
    return !!(e.idle > 0 && b && b.entry && b.entry.underConstruction && !b.waitingForDelivery);
  }
  function sawRunning() { try { return !!(sawmillMillV161 && sawmillMillV161.userData.anim.running); } catch (_) { return false; } }
  function entityPost(e, dt) {
    const c = e.cv; if (!c) return;
    const g = e.group;
    const dx = g.position.x - _cam.x, dz = g.position.z - _cam.z;
    const dxp = g.position.x - c.px, dzp = g.position.z - c.pz; c.px = g.position.x; c.pz = g.position.z;
    c.far = !g.visible || dx * dx + dz * dz > FAR2;
    if (c.far) { c.sp = 0; return; }   // far figures: frozen at the base pose, no overlay
    c.t += dt;
    const sp = Math.hypot(dxp, dzp) / Math.max(0.001, dt);
    c.sp += (sp - c.sp) * clamp(dt * 10, 0, 1);
    const top = Math.max(0.5, (e.speed || 1) * 1.1), sn = clamp(c.sp / top, 0, 1), still = 1 - clamp(c.sp / 0.25, 0, 1);
    const isWorker = !!e.role, working = isWorker && siteActive(e) && still > 0.5;
    const carrying = !!(e._v80CargoProp && e._v80CargoProp.visible);
    const stacking = isWorker && !working && still > 0.5 && e.idle > 0 && sawRunning() && e.homeBase && Math.hypot(g.position.x - SAWMILL_POS.x, g.position.z - SAWMILL_POS.z) < 16;
    const kk = clamp(dt * 6, 0, 1);
    c.work += ((working ? 1 : 0) - c.work) * kk; c.stack += ((stacking ? 1 : 0) - c.stack) * kk; c.carry += ((carrying ? 1 : 0) - c.carry) * kk;
    const ph = e.phase || 0;
    let lean = 0.045 * sn + 0.15 * sn * sn, bob = abs(sin(ph)) * 0.035 * sn, twist = sin(ph) * 0.13 * sn;
    // work poses (blended)
    if (c.work > 0.01) {
      const role = e.role;
      const strike = role === 'builder' ? 0.14 + 0.13 * sin(ph) : role === 'rigger' ? 0.3 + 0.04 * sin(ph) : role === 'loader' ? 0.12 + 0.06 * sin(ph) : 0.02;
      lean += c.work * strike; twist += c.work * (role === 'builder' ? 0.1 * sin(ph + 1.2) : role === 'rigger' ? 0.16 * sin(ph) : 0);
    }
    if (c.stack > 0.01) {   // sawmill hand: bend to the pile, stand up with the board, ~2.4 s per board
      const cyc = 0.5 - 0.5 * Math.cos(c.t * 2.6);
      lean += c.stack * (0.08 + 0.42 * cyc); twist += c.stack * 0.18 * sin(c.t * 1.3);
    }
    if (c.carry > 0.01) lean -= c.carry * 0.06;
    g.rotation.x += (c.ox = lean); g.rotation.y += (c.oyaw = twist); g.position.y += (c.oy = bob);
    // breathing when standing
    if (still > 0.02) { c.sy = 1 + 0.012 * sin(c.t * 2.1 + (e.phase || 0)) * still; g.scale.y *= c.sy; }
    // limbs: stronger swing the faster the figure moves (proportional to the base swing and to the measured speed)
    c.olL = e.legL.rotation.x * 0.3 * sn; c.olR = e.legR.rotation.x * 0.3 * sn; e.legL.rotation.x += c.olL; e.legR.rotation.x += c.olR;
    let aL = e.armL.rotation.x * 0.22 * sn, aR = e.armR.rotation.x * 0.22 * sn;
    if (c.carry > 0.01) { aL += c.carry * (-0.95 - e.armL.rotation.x - aL); aR += c.carry * (-0.95 - e.armR.rotation.x - aR); }   // crate held high with both hands
    if (c.stack > 0.01) { const lift = sin(c.t * 2.6); aL += c.stack * (-0.5 - 0.5 * lift - e.armL.rotation.x - aL); aR += c.stack * (-0.5 - 0.5 * lift - e.armR.rotation.x - aR); }
    c.oaL = aL; c.oaR = aR; e.armL.rotation.x += aL; e.armR.rotation.x += aR;
  }

  function vary(w) {
    if (w.cvVaried || !w.group) return;
    w.cvVaried = true; api.workers++;
    const n = api.workers;
    try {
      const { vest, head, helmet, brim } = w.parts || {};   // refs from createWorkerNPC (child indices shifted when the boots moved onto the legs)
      if (vest && vest.material && vest.geometry && vest.geometry.type === 'BoxGeometry') vest.material.color.setHex(VEST[n % VEST.length]);
      if (head && head.material && head.geometry && head.geometry.type === 'SphereGeometry') head.material.color.setHex(SKIN[(n * 3 + 1) % SKIN.length]);
      const shade = HAT_SHADE[n % HAT_SHADE.length];
      if (shade < 1) { if (helmet && helmet.material) helmet.material.color.multiplyScalar(shade); if (brim && brim.material) brim.material.color.multiplyScalar(shade); }
    } catch (_) { /* cosmetic */ }
  }

  const list = () => (typeof npcWorkers !== 'undefined' ? npcWorkers : []);
  const residents = () => { try { return livingCityRuntime.residents; } catch (_) { return []; } };
  function camXZ() { _cam.x = camera.position.x; _cam.z = camera.position.z; }

  const createBase = createWorkerNPC;
  createWorkerNPC = function () { const w = createBase.apply(this, arguments); try { vary(w); initEntity(w); } catch (_) { /* cosmetic */ } return w; };
  for (const w of list()) { try { vary(w); initEntity(w); } catch (_) { /* cosmetic */ } }

  // switched off (CharactersV161.enabled = false): hand every figure back at exactly the base pose (the offsets written last frame are subtracted once), never leave the last overlay pose standing
  function cleanAll() {
    api.applied = false;
    for (const w of list()) if (w && w.cv) entityPre(w);
    for (const r of residents()) if (r && r.cv) entityPre(r);
    try { playerPre(); } catch (_) { /* cosmetic */ }
  }
  const ambientBase = updateAmbientLife;
  updateAmbientLife = function (dt) {
    if (!api.enabled) { if (api.applied) cleanAll(); return ambientBase.apply(this, arguments); }
    api.applied = true;
    const W = list();
    for (let i = 0; i < W.length; i++) { const w = W[i]; if (w && w.group && !w.cv) initEntity(w); entityPre(w); }
    const r = ambientBase.apply(this, arguments);
    camXZ();
    for (let i = 0; i < W.length; i++) { const w = W[i]; if (w && w.cv) { try { entityPost(w, dt); } catch (_) { /* cosmetic */ } } }
    return r;
  };
  if (typeof updateLivingCity === 'function') {
    const cityBase = updateLivingCity;
    updateLivingCity = function (dt) {
      if (!api.enabled) return cityBase.apply(this, arguments);
      const R = residents();
      for (let i = 0; i < R.length; i++) { const r = R[i]; if (r && r.group && r.legL) { if (!r.cv) initEntity(r); entityPre(r); } }
      const out = cityBase.apply(this, arguments);
      camXZ();
      for (let i = 0; i < R.length; i++) { const r = R[i]; if (r && r.cv) { try { entityPost(r, dt); } catch (_) { /* cosmetic */ } } }
      return out;
    };
  }

  api.dust = dust; api.player = P;
  api.state = function () {
    const W = list();
    return {
      dustLive: dust.live, dustPool: dust.pool.length, steps: api.steps || 0, frames: api.frames, playerLean: P.lean, playerCarry: P.carry,
      workers: W.map((w) => ({ role: w.role, far: w.cv ? w.cv.far : null, sp: w.cv ? w.cv.sp : 0, work: w.cv ? w.cv.work : 0, stack: w.cv ? w.cv.stack : 0, carry: w.cv ? w.cv.carry : 0, lean: w.group.rotation.x, bob: w.group.position.y })),
    };
  };
  window.CharactersV161 = api;
})();
