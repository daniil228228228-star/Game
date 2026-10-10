/* Props v161 (2026-10-10 (13), "improve physics and design of every building", backlog PROPS: lamps, benches, signs, hydrants, planters, transit stops).
 *
 * Measured on the stage-16 world (tools/probe-city-v161.mjs): about 19 street lamps (7 meshes each), 20 benches, signs, hydrants and the four transit stops stood without any collider (the
 * player walked through lamp posts and benches), and a transit stop was 28 meshes with a palm / bush / lamp pulled from the generic makers, min y -0.07.
 *   - SOLID PROPS: the makers tag what they return (`userData.v161Prop` = 'lamp' | 'bench' | 'sign' | 'hydrant' | 'planter'); `PropsV161.obstacles()` turns every visible tagged object in the scene into a
 *     small collider of its real size in the v83 registry (lamp pole r 0.13, bench seat 0.94 x 0.34, sign post r 0.08, hydrant r 0.15, planter r 0.5; scale and yaw of the object are applied).
 *     Player only (the pedestrians keep their routes), no placement / camera flag: road and decor planners read exactly what they read before. A light watcher (every 2 s, only counts the
 *     tagged objects) asks the registry to rebuild when lamps / benches appear or go (road lighting upgrades, district dressing), so no collider outlives its prop.
 *   - TRANSIT STOP (createTransitStopGroupV364): the same stop (walk plate, bay, sign pole and plate, from level 2 a roofed shelter with glass panes and a bench, zebra stripes, a palm / planter / lamp
 *     by district) as 4-5 merged meshes with real colliders (pole, shelter posts, bench, palm trunk / planter / lamp) instead of 28.
 * `PropsV161.enabled = false` brings the old stop back (the tags and colliders stay).
 */
'use strict';
(() => {
  const IK = window.InfraV161 && window.InfraV161.kit;
  if (!IK) return;
  const { batch, mats, C, castOk, TAU } = IK;
  const V3 = THREE.Vector3;

  // ---------------------------------------------------------------------------------------------- colliders of the tagged props
  const SHAPES = {
    lamp: { r: 0.13 },
    sign: { r: 0.08 },
    hydrant: { r: 0.15 },
    planter: { r: 0.5 },
    bench: { hx: 0.47, hz: 0.17, oz: -0.02 },
    benchSmall: { hx: 0.43, hz: 0.16 },
  };
  const _q = new THREE.Quaternion(), _s = new V3(), _p = new V3();
  function visibleUp(o) { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; }
  function collect(cb) {
    let sc = null; try { sc = scene; } catch (e) { return; }
    if (!sc) return;
    sc.updateMatrixWorld(true);
    sc.traverse((o) => { const k = o.userData && o.userData.v161Prop; if (k && visibleUp(o)) cb(o, k); });
  }
  function obstacles() {
    const out = [];
    collect((o, k) => {
      o.matrixWorld.decompose(_p, _q, _s);
      const yaw = 2 * Math.atan2(_q.y, _q.w);   // rotation about y only (props are never tilted)
      const sc = Math.max(0.2, (_s.x + _s.z) / 2);
      if (k === 'group') {
        (o.userData.v161Footprint || []).forEach((f, i) => {
          const w = new V3(f.x, 0, f.z).applyMatrix4(o.matrixWorld), pos = new V3(w.x, 0, w.z), label = `${o.name || 'prop'}-v161:${i}`;
          if (f.r) out.push({ owner: o, label, shape: 'circle', pos, radius: f.r * sc });
          else out.push({ owner: o, label, shape: 'obb', pos, hx: f.hx * sc, hz: f.hz * sc, yaw: yaw + (f.yaw || 0) });
        });
        return;
      }
      const sh = SHAPES[k]; if (!sh) return;
      const label = `prop-${k}-v161`;
      if (sh.r) out.push({ owner: o, label, shape: 'circle', pos: new V3(_p.x, 0, _p.z), radius: sh.r * sc });
      else {
        const cy = Math.cos(yaw), sy = Math.sin(yaw), oz = (sh.oz || 0) * sc;
        out.push({ owner: o, label, shape: 'obb', pos: new V3(_p.x + oz * sy, 0, _p.z + oz * cy), hx: sh.hx * sc, hz: sh.hz * sc, yaw });
      }
    });
    return out;
  }
  // a cheap watcher: when the number of tagged props changes, the registry is rebuilt once (the registry has no hook of its own for decor that other layers add)
  let lastSig = '', lastAt = 0;
  function watch(now) {
    if (now - lastAt < 2000) return;
    lastAt = now;
    let n = 0, h = 0;
    try { collect((o) => { n++; h = (h * 31 + Math.round(o.position.x * 10) + Math.round(o.position.z * 7)) | 0; }); } catch (e) { return; }
    const sig = n + ':' + h;
    if (sig === lastSig) return;
    const first = lastSig === '';
    lastSig = sig;
    if (!first) { try { window.__TYCOON_V83_COLLISIONS__ && window.__TYCOON_V83_COLLISIONS__.rebuild(); } catch (e) { /* registry not up yet */ } }
  }
  try { (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push(watch); } catch (e) { /* no tick list */ }

  // ---------------------------------------------------------------------------------------------- transit stop (createTransitStopGroupV364)
  const ROOF = { business: 0x4d6985, industrial: 0x69727d, waterfront: 0x6aa6c8, suburb: 0xc97760 };
  function buildTransitStop(cfg, lv, stop) {
    const g = new THREE.Group(); g.name = 'v161TransitStop';
    const M = mats(), a = stop.angle, base = stop.ring, curb = stop.curb;
    const t = new V3(-Math.sin(a), 0, Math.cos(a)), n = new V3(Math.cos(a), 0, Math.sin(a));
    const at = (kt, kn) => new V3(base.x + t.x * kt + n.x * kn, 0, base.z + t.z * kt + n.z * kn);
    const Cn = batch(true), P = batch(true), S = batch(true), G = batch(false), fp = [];
    const ry = -a;
    Cn.box(2.7, 0.06, 1.55, base.x, 0.064, base.z, { ry, c: 0xd6d0c5 });
    Cn.box(2.25, 0.025, 1.05, curb.x, 0.058, curb.z, { ry, c: 0x575d66 });
    // sign pole + plate (white, blue cross)
    const sp = at(-0.95, 0.08);
    P.cyl(0.05, 0.05, 1.38, 10, sp.x, 0.72, sp.z, { c: 0x69717b });
    P.box(0.42, 0.42, 0.07, sp.x, 1.30, sp.z, { ry, c: 0xeff4f7 });
    P.box(0.24, 0.03, 0.08, sp.x, 1.36, sp.z, { ry, c: 0x4d95d7 }); P.box(0.08, 0.03, 0.24, sp.x, 1.36, sp.z, { ry, c: 0x4d95d7 });
    fp.push({ x: sp.x, z: sp.z, r: 0.07 });
    if (lv >= 2) {
      const rc = at(0.18, -0.08), roofC = ROOF[cfg.id] || ROOF.suburb;
      P.box(1.36, 0.09, 0.92, rc.x, 1.30, rc.z, { ry, c: roofC });
      for (const side of [-0.42, 0.42]) {
        const pp = at(0.28 + side, -0.08), gp = at(0.28 + side, -0.19);
        P.box(0.07, 1.16, 0.07, pp.x, 0.58 + 0.03, pp.z, { c: 0x69717b });
        G.box(0.02, 0.78, 0.46, gp.x, 0.67 + 0.03, gp.z, { ry });
        fp.push({ x: pp.x, z: pp.z, r: 0.06 });
      }
      // bench under the roof (seat 0.9 x 0.28, back leaning), facing the road
      const bp = at(0.20, 0.30), by = ry + Math.PI;
      P.box(0.9, 0.08, 0.28, bp.x, 0.45, bp.z, { ry: by, c: 0x8f6c46 });
      const back = at(0.20, 0.30); back.x += Math.sin(by) * -0.12; back.z += Math.cos(by) * -0.12;
      P.box(0.9, 0.08, 0.28, back.x, 0.7, back.z, { ry: by, rx: -0.35, c: 0x8f6c46 });
      for (const sx of [-0.3, 0.3]) for (const sz of [-0.08, 0.08]) { const lp = new V3(bp.x + Math.cos(by) * sx + Math.sin(by) * sz, 0, bp.z - Math.sin(by) * sx + Math.cos(by) * sz); P.box(0.06, 0.42, 0.06, lp.x, 0.23, lp.z, { c: 0x555d68 }); }
      // the shelter bench has no collider: the Empire tower's upgrade pad (stage 9) stands 0.4 m from it, a pad must never be inside a collider
    }
    // zebra crossing in front of the bay
    const zs = new V3(curb.x - n.x * 0.04, 0, curb.z - n.z * 0.04);
    for (let i = -3; i <= 3; i++) S.box(0.16, 0.012, 0.48, zs.x + t.x * i * 0.22, 0.088, zs.z + t.z * i * 0.22, { ry, c: 0xf6f1e7 });
    // the district's own touch
    if (cfg.id === 'waterfront') {
      const pp = at(1.22, 0.88), k = 0.62;
      P.cyl(0.07 * k, 0.1 * k, 1.5 * k, 7, pp.x, 0.75 * k, pp.z, { c: 0x8a6a45, rz: 0.08 });
      for (let j = 0; j < 6; j++) { const aa = j / 6 * TAU; P.ell(0.5 * k, 0.045, 0.14 * k, pp.x + Math.cos(aa) * 0.4 * k, 1.62 * k, pp.z + Math.sin(aa) * 0.4 * k, { ry: -aa, rz: -0.25, c: j % 2 ? 0x69b073 : 0x57a06a }); }
      fp.push({ x: pp.x, z: pp.z, r: 0.1 });
    } else if (cfg.id === 'suburb') {
      const pp = at(1.05, 0.78);
      P.ell(0.5, 0.36, 0.5, pp.x, 0.36, pp.z, { c: 0x5e9a52 }); P.ell(0.3, 0.2, 0.3, pp.x + 0.2, 0.54, pp.z, { c: 0x6fb974 });
      fp.push({ x: pp.x, z: pp.z, r: 0.45 });
    } else if (cfg.id === 'business') {
      const lp = at(1.05, 0.36);
      P.cyl(0.04, 0.05, 1.95, 6, lp.x, 0.975, lp.z, { c: 0x6b747e }); P.box(0.34, 0.07, 0.18, lp.x, 1.98, lp.z, { c: 0x2c323a }); S.box(0.3, 0.03, 0.2, lp.x, 1.93, lp.z, { c: 0xffe3a6 });
      fp.push({ x: lp.x, z: lp.z, r: 0.1 });
    }
    const cast = castOk(), add = (m) => { if (m) g.add(m); };
    add(Cn.toMesh(M.concrete, { cast: false, name: 'v161TransitWalk' }));
    add(P.toMesh(M.paint, { cast, name: 'v161TransitPaint' }));
    add(S.toMesh(M.soft, { cast: false, name: 'v161TransitMarks', soft: true }));
    add(G.toMesh(M.glass, { cast: false, receive: false, name: 'v161TransitGlass', soft: true }));
    g.userData.v161Prop = 'group'; g.userData.v161Footprint = fp;
    return g;
  }

  window.PropsV161 = { enabled: true, version: 'v161-props', obstacles, buildTransitStop, watch, SHAPES };
})();
